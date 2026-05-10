/**
 * JVM resolver: handles Java + Kotlin (same import syntax, same package layout).
 *
 * Imports like `com.example.user.UserRepository` map to a file path. We build
 * a one-time fully-qualified-class-name index from fileIdSet so each lookup is
 * O(1):
 *   <source-root>/com/example/user/UserRepository.java → "com.example.user.UserRepository"
 *
 * Source roots are discovered by regex on each .java/.kt path. The pattern
 * covers Maven (`src/main/java/`), Gradle, and Kotlin Multiplatform source
 * sets (`src/<set>/{java,kotlin}/`).
 *
 * Wildcard imports (com.foo.*) and Kotlin star imports return null.
 */

const SRC_LANG_RE = /(^|\/)src\/[^/]+\/(?:java|kotlin|groovy)\//;
const EXPLICIT_MARKERS = ['/target/generated-sources/', '/build/generated-sources/'];
const JVM_EXTENSIONS = ['.java', '.kt'];

interface FqcnIndex {
  // FQCN → fileId, e.g. "org.apache.kafka.common.Utils" → "clients/src/main/java/org/apache/kafka/common/Utils.java"
  byFqcn: Map<string, string>;
}

const indexCache = new WeakMap<Set<string>, FqcnIndex>();

function buildFqcnIndex(fileIdSet: Set<string>): FqcnIndex {
  const cached = indexCache.get(fileIdSet);
  if (cached) return cached;
  const byFqcn = new Map<string, string>();

  for (const id of fileIdSet) {
    let ext: string | undefined;
    for (const e of JVM_EXTENSIONS) {
      if (id.endsWith(e)) { ext = e; break; }
    }
    if (!ext) continue;

    // Find where the package path starts (right after the source-root marker)
    let pkgStart: number | null = null;
    const m = SRC_LANG_RE.exec(id);
    if (m) {
      pkgStart = m.index + m[0].length;
    } else {
      for (const marker of EXPLICIT_MARKERS) {
        const idx = id.indexOf(marker);
        if (idx !== -1) { pkgStart = idx + marker.length; break; }
      }
    }

    // Files outside any recognized source root: derive FQCN from the full path.
    // First-write-wins: don't overwrite a structured-source-root entry with a
    // less-structured one.
    const stem = id.slice(pkgStart ?? 0, id.length - ext.length);
    const fqcn = stem.replace(/\//g, '.');
    if (!byFqcn.has(fqcn)) byFqcn.set(fqcn, id);
  }

  const result: FqcnIndex = { byFqcn };
  indexCache.set(fileIdSet, result);
  return result;
}

export async function resolveJava(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  _rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  if (specifier.endsWith('.*')) return null;

  const { byFqcn } = buildFqcnIndex(fileIdSet);

  const direct = byFqcn.get(specifier);
  if (direct) return direct;

  // Static imports (org.foo.Bar.CONSTANT) and inner classes (com.foo.Outer.Inner)
  // — strip the last segment and retry once.
  const lastDot = specifier.lastIndexOf('.');
  if (lastDot !== -1) {
    const trimmed = byFqcn.get(specifier.slice(0, lastDot));
    if (trimmed) return trimmed;
  }

  return null;
}

// Kotlin uses the same package/import semantics as Java; reuse the resolver.
export const resolveKotlin = resolveJava;
