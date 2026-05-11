import { dirname, join, resolve } from 'node:path';
import { tryResolveBase } from './shared.js';
import { getCppIncludeRoots } from '../cpp-include-roots.js';

/**
 * C++ resolver: handles both #include "path/to/file.h" and #include <path/to/file.h>.
 *
 * The extractor passes both quoted and angle-bracket includes (after filtering
 * out stdlib/third-party), since modern CMake projects use angle-brackets for
 * their own internal headers when they set up include roots via
 * include_directories() / target_include_directories().
 *
 * Resolution order:
 *   1. Relative to the including file's directory (for quoted includes)
 *   2. For each include root discovered from CMakeLists.txt (walk-up from file)
 *   3. Fallback to rootDir-relative
 */
export async function resolveCpp(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  // Try relative to the including file first
  const fromDir = resolve(dirname(fromFile), specifier);
  const result = tryResolveBase(fromDir, fileIdSet, rootDir);
  if (result) return result;

  // Try each include root from CMakeLists.txt
  const includeRoots = await getCppIncludeRoots(dirname(fromFile), rootDir);
  for (const root of includeRoots) {
    const candidate = join(root, specifier);
    const resolved = tryResolveBase(candidate, fileIdSet, rootDir);
    if (resolved) return resolved;
  }

  // Fall back to rootDir-relative (project-wide include root)
  const fromRoot = join(rootDir, specifier);
  return tryResolveBase(fromRoot, fileIdSet, rootDir);
}
