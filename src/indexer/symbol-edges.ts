import type { IndexedFile, SymbolEdge } from '../types.js';

/**
 * Build symbol-level edges for a set of files.
 *
 * For each symbol:
 * - exports: file → symbol (for exported symbols)
 * - calls: resolved to a qualified "fileId#name" edge where the callee name
 *   matches an export of one of the file's resolved imports; bare names that
 *   cannot be resolved are kept as-is (external/dynamic calls).
 * - extends / implements: stored as bare names (resolved at query time)
 *
 * @param files      The files to build edges for.
 * @param outEdges   File-level import graph: fileId → [importedFileId, ...]
 * @param allFiles   Full file map used to look up exports of imported files.
 *                   For buildIndex this is the same set as `files`; for patch
 *                   it is the full index.files map (includes unchanged files).
 */
export function buildSymbolEdges(
  files: IndexedFile[],
  outEdges: Map<string, string[]>,
  allFiles: Map<string, IndexedFile>,
): SymbolEdge[] {
  // Pre-build export lookup: fileId → Set<exportedSymbolName>
  const exportsByFile = new Map<string, Set<string>>();
  for (const [id, file] of allFiles) {
    exportsByFile.set(id, new Set(file.exports));
  }

  const edges: SymbolEdge[] = [];

  for (const file of files) {
    const importedFileIds = outEdges.get(file.id) ?? [];

    for (const sym of file.symbols) {
      // exports: file → symbol
      if (sym.isExported) {
        edges.push({ from: file.id, to: sym.id, type: 'exports' });
      }

      // calls: resolve bare name → qualified id where possible
      for (const callee of sym.calls) {
        // Already qualified (intra-file resolution in ts-parser produces "fileId#name")
        if (callee.includes('#')) {
          edges.push({ from: sym.id, to: callee, type: 'calls' });
          continue;
        }
        // Try to resolve against imported files
        let resolved: string | null = null;
        for (const importedId of importedFileIds) {
          if (exportsByFile.get(importedId)?.has(callee)) {
            resolved = `${importedId}#${callee}`;
            break;
          }
        }
        edges.push({ from: sym.id, to: resolved ?? callee, type: 'calls' });
      }

      // extends / implements
      if (sym.extendsName) {
        edges.push({ from: sym.id, to: sym.extendsName, type: 'extends' });
      }
      for (const iface of sym.implementsNames) {
        edges.push({ from: sym.id, to: iface, type: 'implements' });
      }
    }
  }

  return edges;
}
