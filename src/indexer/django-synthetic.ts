import { resolvePython } from './resolvers/python.js';
import type { Edge, IndexedFile } from '../types.js';

/**
 * Django synthetic edges:
 *   - Settings.py dotted-string references (MIDDLEWARE, AUTHENTICATION_BACKENDS, etc.)
 *   - URLs.py include() calls with string arguments
 *   - importlib.import_module() with literal string arguments
 *
 * These emit specifiers with convention:django prefix, resolved via Python's
 * absolute import resolver (walking up from the file dir to find package roots).
 */
export async function addDjangoSyntheticEdges(
  indexedFiles: IndexedFile[],
  edges: Edge[],
  fullFileIdSet: Set<string>,
  rootDir: string,
): Promise<void> {
  const pythonFiles = indexedFiles.filter(f => f.language === 'python');
  if (pythonFiles.length === 0) return;

  const seen = new Set<string>();
  for (const e of edges) seen.add(`${e.from}|${e.to}`);

  // Process each Python file that has Django convention references
  for (const f of pythonFiles) {
    if (!f.djangoConventionRefs?.length) continue;

    for (const ref of f.djangoConventionRefs) {
      // ref.value is a dotted string like 'django.middleware.locale.LocaleMiddleware'.
      // resolvePython returns a fileId (relative path) directly, not an absolute path.
      // If full path doesn't resolve, retry with the trailing segment stripped (so
      // 'django.middleware.locale.LocaleMiddleware' falls back to 'django.middleware.locale').
      let targetId = await resolvePython(ref.value, f.path, fullFileIdSet, rootDir, new Map());
      if (!targetId) {
        const lastDot = ref.value.lastIndexOf('.');
        if (lastDot > 0) {
          targetId = await resolvePython(ref.value.slice(0, lastDot), f.path, fullFileIdSet, rootDir, new Map());
        }
      }
      if (!targetId || targetId === f.id) continue;

      const key = `${f.id}|${targetId}`;
      if (seen.has(key) || !fullFileIdSet.has(targetId)) continue;

      seen.add(key);
      edges.push({
        from: f.id,
        to: targetId,
        type: 'import',
        specifier: `convention:django:${ref.kind}`,
      });
    }
  }
}
