import { relative } from 'node:path';
import { buildFileId } from './parser.js';
import type { Edge, IndexedFile } from '../types.js';

/**
 * C# synthetic edges:
 *   - Partial class/struct/interface/record declarations: when multiple files
 *     declare the same partial type (same name and namespace), emit bidirectional
 *     synthetic file-level edges between all pairs.
 */
export async function addCSharpSyntheticEdges(
  indexedFiles: IndexedFile[],
  edges: Edge[],
  fullFileIdSet: Set<string>,
  rootDir: string,
): Promise<void> {
  const csharpFiles = indexedFiles.filter(f => f.language === 'csharp');
  if (csharpFiles.length === 0) return;

  // Build a map: (namespace?, name) → fileId[]
  const partialsByKey = new Map<string, string[]>();
  for (const f of csharpFiles) {
    if (!f.partialDeclarations?.length) continue;
    for (const decl of f.partialDeclarations) {
      const key = `${decl.namespace ?? ''}::${decl.name}`;
      let arr = partialsByKey.get(key);
      if (!arr) { arr = []; partialsByKey.set(key, arr); }
      arr.push(f.id);
    }
  }

  // For each partial declaration group with 2+ files, emit bidirectional edges
  const seen = new Set<string>();
  for (const e of edges) seen.add(`${e.from}|${e.to}`);

  for (const [key, fileIds] of partialsByKey) {
    if (fileIds.length < 2) continue;
    // Extract the type name for the specifier
    const typeName = key.split('::')[1];
    for (let i = 0; i < fileIds.length; i++) {
      for (let j = i + 1; j < fileIds.length; j++) {
        const fromId = fileIds[i];
        const toId = fileIds[j];
        // Bidirectional: i→j and j→i
        for (const [from, to] of [[fromId, toId], [toId, fromId]]) {
          const edgeKey = `${from}|${to}`;
          if (seen.has(edgeKey) || !fullFileIdSet.has(from) || !fullFileIdSet.has(to)) continue;
          seen.add(edgeKey);
          edges.push({ from, to, type: 'import', specifier: `partial:${typeName}` });
        }
      }
    }
  }
}
