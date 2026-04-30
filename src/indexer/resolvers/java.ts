import { join } from 'node:path';

/**
 * Java resolver: converts fully-qualified class names to file paths.
 *
 * Java imports look like `com.example.user.UserRepository` — not file paths.
 * We convert dots to slashes and look up the result directly in fileIdSet.
 *
 * For multi-module projects (Maven/Gradle), source files live under roots like
 * `clients/src/main/java` or `core/src/test/java`. We discover these roots by
 * scanning fileIdSet once and stripping well-known suffixes from each .java path.
 *
 * Wildcard imports (com.foo.*) are silently skipped — they can't map to one file.
 */

const SOURCE_ROOT_MARKERS = [
  '/src/main/java/',
  '/src/test/java/',
  '/src/java/',
  '/target/generated-sources/',
  '/build/generated-sources/',
  '/src/',
];

// Cache per fileIdSet instance (keyed by Set reference identity via WeakMap)
const rootCache = new WeakMap<Set<string>, string[]>();

function getSourceRoots(fileIdSet: Set<string>): string[] {
  if (rootCache.has(fileIdSet)) return rootCache.get(fileIdSet)!;

  const roots = new Set<string>();
  for (const p of fileIdSet) {
    if (!p.endsWith('.java')) continue;
    for (const marker of SOURCE_ROOT_MARKERS) {
      // Check with leading slash (mid-path) and without (path starts with marker)
      const slashless = marker.slice(1);
      let idx = p.indexOf(marker);
      if (idx !== -1) {
        roots.add(p.slice(0, idx + marker.length));
        break;
      } else if (p.startsWith(slashless)) {
        roots.add(slashless);
        break;
      }
    }
    // fallback: file at root level (no marker found)
  }

  // Always include root-level fallback
  roots.add('');

  const result = Array.from(roots);
  rootCache.set(fileIdSet, result);
  return result;
}

function tryResolve(specifier: string, fileIdSet: Set<string>, sourceRoots: string[]): string | null {
  const filePath = specifier.replace(/\./g, '/') + '.java';
  for (const srcRoot of sourceRoots) {
    const candidate = srcRoot ? join(srcRoot, filePath) : filePath;
    const normalized = candidate.replace(/\\/g, '/');
    if (fileIdSet.has(normalized)) return normalized;
  }
  return null;
}

export async function resolveJava(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  _rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  if (specifier.endsWith('.*')) return null;

  const sourceRoots = getSourceRoots(fileIdSet);

  // Try the specifier as-is (normal class import)
  const direct = tryResolve(specifier, fileIdSet, sourceRoots);
  if (direct) return direct;

  // Strip the last segment and retry — handles:
  //   static imports: org.apache.kafka.foo.Bar.CONSTANT → Bar.java
  //   inner classes:  com.foo.Outer.Inner → Outer.java
  const lastDot = specifier.lastIndexOf('.');
  if (lastDot !== -1) {
    const trimmed = specifier.slice(0, lastDot);
    const withoutLast = tryResolve(trimmed, fileIdSet, sourceRoots);
    if (withoutLast) return withoutLast;
  }

  return null;
}
