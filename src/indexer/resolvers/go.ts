import { join, relative } from 'node:path';
import { fileExists } from './shared.js';

/**
 * Go resolver: tries the specifier as a path relative to the project root.
 * Go module-internal imports (e.g. `github.com/org/repo/pkg/foo`) are
 * resolved by stripping the module prefix — but since we only have the
 * raw specifier here, we try the full path relative to rootDir as a
 * best-effort heuristic.
 */
export async function resolveGo(
  specifier: string,
  _fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string>,
): Promise<string | null> {
  const candidate = join(rootDir, specifier);
  if (await fileExists(candidate + '.go')) {
    const rel = relative(rootDir, candidate + '.go').replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }
  return null;
}
