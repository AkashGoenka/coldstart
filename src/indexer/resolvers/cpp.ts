import { dirname, join, resolve } from 'node:path';
import { tryResolveBase } from './shared.js';

/**
 * C++ resolver: handles relative #include "path/to/file.h" directives.
 *
 * Only relative includes (quoted strings) are stored as imports by the
 * extractor — angle-bracket system headers (<vector>, <stdio.h>) are skipped.
 *
 * Resolution order:
 *   1. Relative to the including file's directory
 *   2. Relative to rootDir (common for project-wide include roots)
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

  // Fall back to rootDir-relative (project-wide include root)
  const fromRoot = join(rootDir, specifier);
  return tryResolveBase(fromRoot, fileIdSet, rootDir);
}
