/**
 * Startup reconcile — answers "which files changed while no keeper was
 * watching?" so a loaded cache can be PATCHED instead of discarded. This is
 * the freshness mechanism that replaced the deleted cache TTL: validity is
 * version + this reconcile + the keeper's live watcher.
 *
 * Two detectors, both always relevant:
 *
 *   stale/deleted — a stat-walk over every indexed file, comparing live
 *     [mtimeMs, size] against the fingerprint stamped at parse time. Runs
 *     unconditionally (~100-200ms for 16k files): git alone would miss files
 *     that were indexed dirty and then reverted (clean tree, stale index),
 *     and gitignored-but-indexed files.
 *
 *   new files — a stat-walk can't see files the index has never met. git
 *     (diff against the stored HEAD + porcelain for untracked) supplies them
 *     cheaply; non-git repos or git failure fall back to a directory walk.
 *
 * Known blind spot (accepted): an edit that preserves both mtime and size is
 * invisible to the fingerprint, and a NEW gitignored file in a git repo is
 * invisible to porcelain. The live watcher catches both from spawn onward.
 *
 * Returns null only when even the walk fails — caller does a full rebuild.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodebaseIndex } from '../types.js';
import { getGitHead, getGitChangedFiles, getGitDirtyFiles } from './git.js';
import { walkDirectory } from './walker.js';
import { DEFAULT_EXCLUDES } from '../constants.js';

export interface ReconcileResult {
  /** Absolute paths — feed straight to patchIndex (it plans delete/update/skip itself). */
  changed: Set<string>;
  /** One line for the keeper log / repair log / status. */
  reason: string;
}

/** Live stat vs stored fingerprint. true = index no longer reflects this file. */
async function isStale(absPath: string, mtimeMs?: number, sizeBytes?: number): Promise<boolean> {
  try {
    const st = await stat(absPath);
    if (mtimeMs === undefined || sizeBytes === undefined) return true; // never stamped — re-parse to be safe
    return st.mtimeMs !== mtimeMs || st.size !== sizeBytes;
  } catch {
    return true; // gone — patch plans a delete
  }
}

export async function reconcileChanges(
  index: CodebaseIndex,
  rootDir: string,
  excludes: string[] = [],
  includes: string[] = [],
): Promise<ReconcileResult | null> {
  const changed = new Set<string>();

  // ---- stale/deleted: fingerprint stat-walk over the indexed files ---------
  for (const f of index.files.values()) {
    if (await isStale(f.path, f.mtimeMs, f.sizeBytes)) changed.add(f.path);
  }
  const staleCount = changed.size;

  // ---- new files: git fast path, directory-walk fallback -------------------
  const indexed = new Set<string>();
  for (const f of index.files.values()) indexed.add(f.path);

  let newSource: string;
  const head = await getGitHead(rootDir);
  const committed = head && index.gitHead && head !== index.gitHead
    ? await getGitChangedFiles(rootDir, index.gitHead)
    : head ? [] : null;
  const dirty = head ? await getGitDirtyFiles(rootDir) : null;

  if (committed !== null && dirty !== null) {
    newSource = head === index.gitHead ? 'git-status' : 'git-diff+status';
    for (const rel of [...committed, ...dirty]) {
      // The walker never descends into hidden/excluded dirs — porcelain does
      // (.claude/settings.json is a real untracked file). Without this filter
      // every keeper start "discovers" it and pays a no-op patch + re-save.
      const dirSegments = rel.split('/').slice(0, -1);
      if (dirSegments.some((s) => s.startsWith('.') || DEFAULT_EXCLUDES.has(s) || excludes.includes(s))) continue;
      const abs = join(rootDir, rel);
      if (indexed.has(abs) || changed.has(abs)) continue; // known file — stat-walk already judged it
      try {
        await stat(abs);
        changed.add(abs); // exists but never indexed → new (patch filters non-indexable extensions)
      } catch { /* listed but gone and never indexed — nothing to do */ }
    }
  } else {
    newSource = 'fs-walk';
    try {
      const walked = await walkDirectory({ rootDir, excludes, includes });
      for (const wf of walked) {
        if (!indexed.has(wf.absolutePath)) changed.add(wf.absolutePath);
      }
    } catch {
      // Can't even enumerate the repo — no safe patch set exists.
      return null;
    }
  }

  const reason = `reconcile(${newSource}): ${staleCount} stale/deleted + ${changed.size - staleCount} new`;
  return { changed, reason };
}
