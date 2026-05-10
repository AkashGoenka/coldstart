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
  // Suffix index for qualified names: fileId → Map<suffix, fullExportName>.
  // Java methods are stored as "Class.method"; Ruby as "Class::method" or "Module::Class".
  // Bare callees ("method") need to resolve back to the qualified export.
  // If a file has two exports with the same suffix (rare in practice), drop both
  // from the suffix index so we don't pick arbitrarily.
  const suffixIndexByFile = new Map<string, Map<string, string>>();
  for (const [id, file] of allFiles) {
    exportsByFile.set(id, new Set(file.exports));
    const suffixMap = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const exp of file.exports) {
      // Split on last '.' or '::'. Tree-sitter Java/Ruby extractors don't mix separators.
      const dotIdx = exp.lastIndexOf('.');
      const colonIdx = exp.lastIndexOf('::');
      const sepIdx = Math.max(dotIdx, colonIdx);
      if (sepIdx <= 0) continue;
      const sepLen = colonIdx === sepIdx ? 2 : 1;
      const suffix = exp.slice(sepIdx + sepLen);
      if (!suffix) continue;
      if (suffixMap.has(suffix)) ambiguous.add(suffix);
      else suffixMap.set(suffix, exp);
    }
    for (const a of ambiguous) suffixMap.delete(a);
    suffixIndexByFile.set(id, suffixMap);
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
        // Try to resolve against imported files.
        // Pass 1: direct export match (TS/JS, anything that exports bare names).
        let resolved: string | null = null;
        for (const importedId of importedFileIds) {
          if (exportsByFile.get(importedId)?.has(callee)) {
            resolved = `${importedId}#${callee}`;
            break;
          }
        }
        // Pass 2: suffix match against qualified exports (Java/Ruby). Only resolve
        // if exactly one imported file's suffix index contains this callee — else
        // we'd be guessing.
        if (!resolved) {
          let matchFile: string | null = null;
          let matchFull: string | null = null;
          let multiple = false;
          for (const importedId of importedFileIds) {
            const full = suffixIndexByFile.get(importedId)?.get(callee);
            if (full) {
              if (matchFile) { multiple = true; break; }
              matchFile = importedId;
              matchFull = full;
            }
          }
          if (matchFile && matchFull && !multiple) {
            resolved = `${matchFile}#${matchFull}`;
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
