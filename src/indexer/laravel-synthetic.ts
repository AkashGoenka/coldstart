import { dirname, resolve, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildFileId } from './parser.js';
import { resolvePHP } from './resolvers/php.js';
import type { Edge, IndexedFile } from '../types.js';

/**
 * Laravel synthetic edges:
 *   - Eloquent relationships (hasMany, belongsTo, etc) gated to app/Models/:
 *     Parse class string references in relationship method arguments and emit edges.
 *   - Container resolutions (app(), resolve(), bind(), singleton()):
 *     Parse class string references in any PHP file and emit edges to DI container registrations.
 */
export async function addLaravelSyntheticEdges(
  indexedFiles: IndexedFile[],
  edges: Edge[],
  fullFileIdSet: Set<string>,
  rootDir: string,
): Promise<void> {
  const phpFiles = indexedFiles.filter(f => f.language === 'php');
  if (phpFiles.length === 0) return;

  // Find Laravel app root by looking for an app/ directory in walked files
  let appRoot: string | null = null;
  for (const f of phpFiles) {
    const idx = f.path.lastIndexOf('/app/');
    if (idx >= 0) {
      appRoot = f.path.substring(0, idx);
      break;
    }
  }
  if (!appRoot) return;

  const seen = new Set<string>();
  for (const e of edges) seen.add(`${e.from}|${e.to}`);

  // Helper: load PSR-4 mapping to resolve class names to file IDs
  async function resolveClassToFileId(
    fqcn: string,
    fromFile: string,
  ): Promise<string | null> {
    // Remove leading backslash if present
    const normalized = fqcn.replace(/^\\/, '');

    // Use the existing PHP resolver — returns file ID (relative path)
    return resolvePHP(normalized, fromFile, fullFileIdSet, rootDir, new Map());
  }

  // A. Eloquent relationships — gated to app/Models/
  for (const f of phpFiles) {
    // Only process files under app/Models/
    if (!f.relativePath.includes('app/Models/')) continue;
    if (!f.eloquentRelations?.length) continue;

    for (const rel of f.eloquentRelations) {
      const targetId = await resolveClassToFileId(rel.targetClass, f.path);
      if (!targetId || targetId === f.id) continue;

      const key = `${f.id}|${targetId}`;
      if (seen.has(key) || !fullFileIdSet.has(targetId)) continue;

      seen.add(key);
      edges.push({
        from: f.id,
        to: targetId,
        type: 'import',
        specifier: `convention:eloquent`,
      });
    }
  }

  // B. Container resolutions — anywhere in the codebase
  for (const f of phpFiles) {
    if (!f.containerResolutions?.length) continue;

    for (const res of f.containerResolutions) {
      const targetId = await resolveClassToFileId(res.targetClass, f.path);
      if (!targetId || targetId === f.id) continue;

      const key = `${f.id}|${targetId}`;
      if (seen.has(key) || !fullFileIdSet.has(targetId)) continue;

      seen.add(key);
      edges.push({
        from: f.id,
        to: targetId,
        type: 'import',
        specifier: `convention:container`,
      });
    }
  }
}
