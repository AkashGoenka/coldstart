import { dirname, join } from 'node:path';
import { toFileId, tryResolveBase } from './shared.js';

/**
 * Python resolver: handles both relative and absolute imports.
 *
 * Relative imports (starting with '.'):
 *   from .models import User    → specifier '.models'  → {dirname}/models.py
 *   from ..utils import X       → specifier '..utils'  → {parent_dir}/utils.py
 *   from . import X             → specifier '.'        → {dirname}/__init__.py
 *
 * Absolute imports (project-internal):
 *   from django.db.models import Model → specifier 'django.db.models'
 *   → dots to slashes → try {rootDir}/django/db/models.py or __init__.py
 *
 * Stdlib and third-party package names simply won't exist under rootDir and
 * will return null — no explicit exclusion list needed.
 */
export async function resolvePython(
  specifier: string,
  fromFile: string,
  fileIdSet: Set<string>,
  rootDir: string,
  _aliasMap: Map<string, string[]>,
): Promise<string | null> {
  if (specifier.startsWith('.')) {
    // Count leading dots: '.' = 1, '..' = 2, '.models' = 1, '..utils' = 2
    let dots = 0;
    while (dots < specifier.length && specifier[dots] === '.') dots++;
    const module = specifier.slice(dots); // '' for bare '.', 'models' for '.models'

    // dots=1 → current package (dirname of file)
    // dots=2 → parent package
    let base = dirname(fromFile);
    for (let i = 1; i < dots; i++) {
      base = dirname(base);
    }

    if (!module) {
      // from . import X — the package __init__.py
      const id = toFileId(join(base, '__init__.py'), rootDir);
      if (fileIdSet.has(id)) return id;
      return null;
    }

    // Convert dotted submodule to path: 'utils.helpers' → 'utils/helpers'
    return tryResolveBase(join(base, module.replace(/\./g, '/')), fileIdSet, rootDir);
  }

  // Absolute import: 'django.db.models' → try walking up from the file's own
  // directory, looking for {ancestor}/<path> or {ancestor}/src/<path>. This
  // handles repos where the project source lives in a subdirectory of rootDir
  // (e.g. /repos/django/django-coldstart/django/...) and multi-project repos.
  const relPath = specifier.replace(/\./g, '/');
  let dir = dirname(fromFile);
  for (let i = 0; i < 64; i++) {
    const direct = await tryResolveBase(join(dir, relPath), fileIdSet, rootDir);
    if (direct) return direct;
    const srcLayout = await tryResolveBase(join(dir, 'src', relPath), fileIdSet, rootDir);
    if (srcLayout) return srcLayout;
    if (dir === rootDir) break;
    const parent = dirname(dir);
    if (parent === dir || !parent.startsWith(rootDir)) break;
    dir = parent;
  }
  return null;
}
