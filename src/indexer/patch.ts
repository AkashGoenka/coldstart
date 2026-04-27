import { stat } from 'node:fs/promises';
import { relative, extname } from 'node:path';
import type { CodebaseIndex, IndexedFile, ParsedFile, DomainToken, Language } from '../types.js';
import { EXTENSION_TO_LANGUAGE } from '../constants.js';
import { parseFile, buildFileId } from './parser.js';
import { buildFileDomains, isTestPath } from './tokenize.js';
import { resolveImportsForFiles } from './resolvers/index.js';
import { buildSymbolEdges } from './symbol-edges.js';

/**
 * Incrementally patches the in-memory index for a set of changed files.
 * Mutates `index` in place. Called after the file watcher debounce fires
 * and the changed set size is within PATCH_THRESHOLD.
 *
 * Correctness guarantees:
 * - Pre-plan phase determines outcome (delete/update/skip) BEFORE any index mutation.
 *   This prevents stripping state for files that fail to parse.
 * - Deletion removes both outgoing AND incoming flat edges, plus fileId from
 *   every importer's outEdges array (no stale graph pointers).
 * - inEdges of import targets are updated via set-diff (no duplicates).
 * - tokenDocFreq is patched via per-file token diff.
 * - symbolEdges are replaced wholesale for each changed file.
 * - importedByCount and transitiveImportedByCount are recomputed at the end.
 */

type FilePlan =
  | { action: 'delete' }
  | { action: 'update'; parsed: ParsedFile; lang: Language; relPath: string }
  | { action: 'skip' };

export async function patchIndex(
  index: CodebaseIndex,
  changedAbsPaths: Set<string>,
  rootDir: string,
): Promise<void> {
  // Current fileIdSet — used for import resolution of patched files
  const fileIdSet = new Set<string>(index.files.keys());

  // Track which file IDs were touched (for importedByCount recomputation)
  const affectedIds = new Set<string>();

  // -------------------------------------------------------------------------
  // Phase 0: Pre-plan — decide delete/update/skip for every file in the batch
  //          WITHOUT touching the index yet. This ensures state is only
  //          stripped when we know we can successfully replace it.
  // -------------------------------------------------------------------------
  const plans = new Map<string, { absPath: string; fileId: string; plan: FilePlan }>();

  for (const absPath of changedAbsPaths) {
    const ext = extname(absPath).toLowerCase();
    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (!lang) continue;

    const relPath = relative(rootDir, absPath).replace(/\\/g, '/');
    const fileId = buildFileId(relPath);

    // Check existence first (covers deletions)
    let exists = true;
    try { await stat(absPath); } catch { exists = false; }

    if (!exists) {
      plans.set(fileId, { absPath, fileId, plan: { action: 'delete' } });
      continue;
    }

    const parsed = await parseFile(absPath, lang, fileId);
    if (!parsed) {
      // Parse failed — skip this file entirely. Index state is preserved.
      plans.set(fileId, { absPath, fileId, plan: { action: 'skip' } });
      continue;
    }

    // Hash check: if content is identical, this was a false-positive watch event
    const oldFile = index.files.get(fileId);
    if (oldFile && oldFile.hash === parsed.hash) {
      plans.set(fileId, { absPath, fileId, plan: { action: 'skip' } });
      continue;
    }

    plans.set(fileId, { absPath, fileId, plan: { action: 'update', parsed, lang, relPath } });
  }

  // -------------------------------------------------------------------------
  // Phase 1: Strip old data — only for files planned as 'delete' or 'update'
  // -------------------------------------------------------------------------
  for (const { fileId, plan } of plans.values()) {
    if (plan.action === 'skip') continue;

    affectedIds.add(fileId);
    const oldFile = index.files.get(fileId);
    if (!oldFile) continue; // new file — nothing old to remove

    // Remove outgoing flat edges (from === fileId)
    index.edges = index.edges.filter(e => e.from !== fileId);

    // Remove fileId from each import target's inEdges
    const oldOutgoing = index.outEdges.get(fileId) ?? [];
    for (const targetId of oldOutgoing) {
      const importers = index.inEdges.get(targetId);
      if (importers) {
        const i = importers.indexOf(fileId);
        if (i !== -1) importers.splice(i, 1);
      }
    }
    index.outEdges.set(fileId, []);

    // Decrement tokenDocFreq for old file's tokens (skip barrel files)
    if (!oldFile.isBarrel) {
      const seen = new Set<string>();
      for (const dt of oldFile.domains as DomainToken[]) {
        if (seen.has(dt.token)) continue;
        seen.add(dt.token);
        const count = index.tokenDocFreq.get(dt.token) ?? 0;
        if (count <= 1) index.tokenDocFreq.delete(dt.token);
        else index.tokenDocFreq.set(dt.token, count - 1);
      }
    }

    // Remove symbolEdges originating from this file or its symbols
    const prefix = fileId + '#';
    index.symbolEdges = index.symbolEdges.filter(
      se => se.from !== fileId && !se.from.startsWith(prefix),
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2: Apply deletions — clean up all graph pointers to deleted files
  // -------------------------------------------------------------------------
  for (const { fileId, plan } of plans.values()) {
    if (plan.action !== 'delete') continue;

    // Files that imported the deleted file
    const deletedImporters = index.inEdges.get(fileId) ?? [];

    // Remove ALL flat edges pointing to this deleted file (incoming edges)
    index.edges = index.edges.filter(e => e.to !== fileId);

    // Remove fileId from each importer's outEdges array
    for (const importerId of deletedImporters) {
      const importerOut = index.outEdges.get(importerId);
      if (importerOut) {
        const i = importerOut.indexOf(fileId);
        if (i !== -1) importerOut.splice(i, 1);
      }
      affectedIds.add(importerId);
    }

    index.files.delete(fileId);
    index.outEdges.delete(fileId);
    index.inEdges.delete(fileId);
    fileIdSet.delete(fileId);
  }

  // -------------------------------------------------------------------------
  // Phase 3: Apply updates — build new index entries
  // -------------------------------------------------------------------------
  const newFiles: IndexedFile[] = [];

  for (const { absPath, fileId, plan } of plans.values()) {
    if (plan.action !== 'update') continue;
    const { parsed, lang, relPath } = plan;
    const oldFile = index.files.get(fileId);

    const newFile: IndexedFile = {
      id: fileId,
      path: absPath,
      relativePath: relPath,
      language: lang,
      domains: buildFileDomains(relPath, parsed.exports),
      exports: parsed.exports,
      hasDefaultExport: parsed.hasDefaultExport,
      imports: parsed.imports,
      hash: parsed.hash,
      lineCount: parsed.lineCount,
      tokenEstimate: parsed.tokenEstimate,
      importedByCount: oldFile?.importedByCount ?? 0,
      transitiveImportedByCount: oldFile?.transitiveImportedByCount ?? 0,
      isBarrel: false,
      isTestFile: isTestPath(relPath),
      symbols: parsed.symbols,
      reexportRatio: parsed.reexportRatio,
    };

    index.files.set(fileId, newFile);
    fileIdSet.add(fileId);
    if (!index.inEdges.has(fileId)) index.inEdges.set(fileId, []);
    index.outEdges.set(fileId, []);
    newFiles.push(newFile);
  }

  if (newFiles.length === 0 && affectedIds.size === 0) return; // nothing actionable

  // -------------------------------------------------------------------------
  // Phase 4: Resolve imports for updated files, rebuild edges + inEdges
  // -------------------------------------------------------------------------
  if (newFiles.length > 0) {
    const { edges: newEdges } = await resolveImportsForFiles(newFiles, fileIdSet, rootDir);

    for (const edge of newEdges) {
      index.edges.push(edge);

      // outEdges
      const out = index.outEdges.get(edge.from) ?? [];
      if (!out.includes(edge.to)) out.push(edge.to);
      index.outEdges.set(edge.from, out);

      // inEdges
      if (!index.inEdges.has(edge.to)) index.inEdges.set(edge.to, []);
      const inn = index.inEdges.get(edge.to)!;
      if (!inn.includes(edge.from)) inn.push(edge.from);
    }

    // -----------------------------------------------------------------------
    // Phase 5: Barrel detection + tokenDocFreq + symbolEdges for new files
    // -----------------------------------------------------------------------
    for (const file of newFiles) {
      if (file.language === 'typescript' || file.language === 'javascript') {
        file.isBarrel = (
          (file.reexportRatio ?? 0) > 0.5 &&
          (index.inEdges.get(file.id)?.length ?? 0) > 1 &&
          file.exports.length > 0
        );
        if (file.isBarrel) {
          file.domains = (file.domains as DomainToken[])
            .map(dt => ({ token: dt.token, sources: dt.sources.filter(s => s !== 'symbol') }))
            .filter(dt => dt.sources.length > 0);
        }
      }

      if (!file.isBarrel) {
        const seen = new Set<string>();
        for (const dt of file.domains as DomainToken[]) {
          if (seen.has(dt.token)) continue;
          seen.add(dt.token);
          index.tokenDocFreq.set(dt.token, (index.tokenDocFreq.get(dt.token) ?? 0) + 1);
        }
      }

      for (const edge of buildSymbolEdges([file], index.outEdges, index.files)) {
        index.symbolEdges.push(edge);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 6: Recompute importedByCount for affected files + their neighbours
  // -------------------------------------------------------------------------
  const recomputeSet = new Set<string>(affectedIds);
  for (const fileId of affectedIds) {
    for (const id of index.inEdges.get(fileId) ?? []) recomputeSet.add(id);
    for (const id of index.outEdges.get(fileId) ?? []) recomputeSet.add(id);
  }
  for (const fileId of recomputeSet) {
    const file = index.files.get(fileId);
    if (file) file.importedByCount = index.inEdges.get(fileId)?.length ?? 0;
  }

  // -------------------------------------------------------------------------
  // Phase 7: Recompute transitiveImportedByCount (cheap full pass)
  // -------------------------------------------------------------------------
  for (const file of index.files.values()) {
    file.transitiveImportedByCount = file.importedByCount;
  }
  for (const file of index.files.values()) {
    if (!file.isBarrel) continue;
    for (const childId of index.outEdges.get(file.id) ?? []) {
      const child = index.files.get(childId);
      if (child) child.transitiveImportedByCount += file.importedByCount;
    }
  }

  index.indexedAt = Date.now();
}
