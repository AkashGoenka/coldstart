import { join, relative } from 'node:path';
import { fileExists } from './shared.js';

/**
 * Java resolver: converts fully-qualified class names to file paths.
 *
 * Java imports look like `com.example.user.UserRepository` — not file paths.
 * We convert dots to slashes and try common Maven/Gradle/Android source roots.
 * Wildcard imports (com.foo.*) are silently skipped — they can't map to one file.
 */

const JAVA_SOURCE_ROOTS = [
  'src/main/java',   // Maven standard layout
  'src/java',        // Gradle alternate
  'src',             // simple projects
  'app/src/main/java', // Android
  '',                // project root fallback
];

export async function resolveJava(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string>,
): Promise<string | null> {
  if (specifier.endsWith('.*')) return null;

  const filePath = specifier.replace(/\./g, '/') + '.java';

  for (const srcRoot of JAVA_SOURCE_ROOTS) {
    const candidate = srcRoot
      ? join(rootDir, srcRoot, filePath)
      : join(rootDir, filePath);
    if (await fileExists(candidate)) {
      const rel = relative(rootDir, candidate).replace(/\\/g, '/');
      if (fileIdSet.has(rel)) return rel;
    }
  }

  return null;
}
