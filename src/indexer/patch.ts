import { stat } from 'node:fs/promises';
import { relative, extname } from 'node:path';
import type { CodebaseIndex, IndexedFile, ParsedFile, Language } from '../types.js';
import { EXTENSION_TO_LANGUAGE, DEFAULT_EXCLUDES } from '../constants.js';
import { parseFile, buildFileId } from './parser.js';
import { buildFileDomains, isTestPath } from './tokenize.js';
import { resolveImportsForFiles, buildPackageIndex } from './resolvers/index.js';
import { buildSymbolEdges } from './symbol-edges.js';
import { buildContentTokenPostings } from './content-tokens.js';
import { baseIndexedFile } from './indexed-file.js';
import { addRailsSyntheticEdges } from './rails-synthetic.js';
import { addLaravelSyntheticEdges } from './laravel-synthetic.js';
import { addCSharpSyntheticEdges } from './csharp-synthetic.js';
import { addDjangoSyntheticEdges } from './django-synthetic.js';

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

    // Mirror the walker's directory rules: it never descends into hidden or
    // excluded dirs, so a patch must not index files from them either. Both
    // batch producers leak such paths otherwise — the watcher (live edit to
    // .claude/settings.json) and reconcile (porcelain lists it as untracked).
    // Hidden FILES at the root (.rubocop.yml) are walked, so only dir
    // segments are filtered.
    const dirSegments = relPath.split('/').slice(0, -1);
    if (dirSegments.some((s) => s.startsWith('.') || DEFAULT_EXCLUDES.has(s))) continue;

    const fileId = buildFileId(relPath);

    // Check existence first (covers deletions)
    let liveStat: Awaited<ReturnType<typeof stat>> | null = null;
    try { liveStat = await stat(absPath); } catch { /* deleted */ }

    if (!liveStat) {
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
      // Refresh the fingerprint anyway: a touch-without-change moved mtime,
      // and a stale stamp would make reconcile/audit re-flag this file forever.
      oldFile.mtimeMs = liveStat.mtimeMs;
      oldFile.sizeBytes = liveStat.size;
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
      for (const token of Object.keys(oldFile.domainMap)) {
        const count = index.tokenDocFreq.get(token) ?? 0;
        if (count <= 1) index.tokenDocFreq.delete(token);
        else index.tokenDocFreq.set(token, count - 1);
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

    // Remove symbolEdges pointing INTO the deleted file (other files' calls /
    // extends / re-exports of its symbols). Phase 1 only strips edges FROM
    // changed files; the callers aren't in the change set, and a dangling
    // se.to fails the invariant lint and forces a full rebuild on every
    // delete of a referenced file.
    const deletedPrefix = fileId + '#';
    index.symbolEdges = index.symbolEdges.filter(
      se => se.to !== fileId && !se.to.startsWith(deletedPrefix),
    );

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
      ...baseIndexedFile(fileId, absPath, relPath, lang, parsed),
      domainMap: buildFileDomains(relPath, parsed.exports),
      importedByCount: oldFile?.importedByCount ?? 0,
      transitiveImportedByCount: oldFile?.transitiveImportedByCount ?? 0,
      isBarrel: false,
      isTestFile: isTestPath(relPath),
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
    // Build the JVM package index from the FULL set (not just newFiles) so a
    // changed Java/Kotlin file resolves against unchanged ones by declared package.
    const pkgById = buildPackageIndex([...index.files.values()]);
    const { edges: newEdges } = await resolveImportsForFiles(newFiles, fileIdSet, rootDir, pkgById);

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
          for (const [token, ev] of Object.entries(file.domainMap)) {
            if (ev.filename === 0 && ev.path === 0) {
              delete file.domainMap[token];
            } else {
              file.domainMap[token] = { ...ev, symbol: 0 };
            }
          }
        }
      }

      if (!file.isBarrel) {
        for (const token of Object.keys(file.domainMap)) {
          index.tokenDocFreq.set(token, (index.tokenDocFreq.get(token) ?? 0) + 1);
        }
      }

      for (const edge of buildSymbolEdges([file], index.outEdges, index.files)) {
        index.symbolEdges.push(edge);
      }
    }

    // -----------------------------------------------------------------------
    // Phase 5.5: Refresh synthetic (convention) edges. Phase 1 stripped the
    // outgoing edges of every changed file, INCLUDING its synthetic
    // Rails/Django/Laravel/C# convention edges — so without this, editing a
    // convention file deletes its association/view/route edges until the next
    // full rebuild. The synthetic passes are idempotent (each seeds a `seen`
    // set from the existing edges and only adds what's missing), so re-running
    // them over the full file set re-creates exactly the stripped edges with no
    // duplication. Gate on the languages that actually changed so a
    // non-convention edit (e.g. a TS file in a Rails repo) pays nothing.
    const changedLangs = new Set(newFiles.map(f => f.language));
    if (changedLangs.has('ruby') || changedLangs.has('php') ||
        changedLangs.has('csharp') || changedLangs.has('python')) {
      const allFiles = [...index.files.values()];
      const before = index.edges.length;
      if (changedLangs.has('ruby'))   await addRailsSyntheticEdges(allFiles, index.edges, fileIdSet, rootDir);
      if (changedLangs.has('php'))    await addLaravelSyntheticEdges(allFiles, index.edges, fileIdSet, rootDir);
      if (changedLangs.has('csharp')) await addCSharpSyntheticEdges(allFiles, index.edges, fileIdSet, rootDir);
      if (changedLangs.has('python')) await addDjangoSyntheticEdges(allFiles, index.edges, fileIdSet, rootDir);
      // Sync the newly-added synthetic edges into the graph maps + recompute set.
      for (let i = before; i < index.edges.length; i++) {
        const e = index.edges[i];
        const out = index.outEdges.get(e.from) ?? [];
        if (!out.includes(e.to)) out.push(e.to);
        index.outEdges.set(e.from, out);
        if (!index.inEdges.has(e.to)) index.inEdges.set(e.to, []);
        const inn = index.inEdges.get(e.to)!;
        if (!inn.includes(e.from)) inn.push(e.from);
        affectedIds.add(e.from);
        affectedIds.add(e.to);
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

  // -------------------------------------------------------------------------
  // Phase 8: Rebuild content-token postings (cheap full pass — df window 2–5
  // means almost any edit can move tokens in or out of the postings)
  // -------------------------------------------------------------------------
  index.contentTokenPostings = buildContentTokenPostings(index.files.values());

  index.indexedAt = Date.now();
}
