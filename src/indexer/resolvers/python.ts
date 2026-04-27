import { dirname, resolve, join, relative } from 'node:path';
import { fileExists, tryResolveBase } from './shared.js';

/**
 * Python resolver: handles relative imports (starting with `.`) and
 * __init__.py directory packages. Absolute module names (stdlib/pip) are
 * not resolvable to local files and are skipped.
 */
export async function resolvePython(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string>,
): Promise<string | null> {
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
  if (!isRelative) return null;

  const base = resolve(dirname(fromFile), specifier);

  const initPy = join(base, '__init__.py');
  if (await fileExists(initPy)) {
    const rel = relative(rootDir, initPy).replace(/\\/g, '/');
    if (fileIdSet.has(rel)) return rel;
  }

  return tryResolveBase(base, fileIdSet, rootDir);
}
