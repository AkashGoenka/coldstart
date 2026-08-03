/**
 * Durable capture worklist — the coverage/trim half.
 *
 * The capture hook (hooks/capture-payload.mjs) drops the session's worklist as a
 * DURABLE pair in the repo notebook — unlike the old tmpdir manifest, which was
 * a one-shot blob lost to compaction:
 *   .coldstart/notebook/.worklist.json   structured scope (source of truth)
 *   .coldstart/notebook/.worklist.md     the prose checklist the agent re-Reads
 * Both are gitignored (src/kb/store.ts initSkeleton).
 *
 * This module is the reader/trimmer. After a `kb write` batch it credits the
 * file notes just written, reports which worked files still lack a note (a flow
 * does NOT cover them), and then CLEARS the pair (all captured) or TRIMS it to
 * what is left — so a stale snapshot with a frozen denominator never lingers to
 * mislead a later write. Regeneration is the hook's job: the next capture fire
 * re-diffs against live note freshness and rewrites the pair, so a file missed
 * in one pass reappears next time.
 *
 * CONTRACT TWIN: hooks/capture-payload.mjs writes this pair — keep the paths and
 * the .json shape (ts, files:[{path,tier,needsNote}], wrote:[]) in step.
 * Everything here is best-effort: a missing/malformed worklist prints nothing
 * and never fails a write.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { notebookDir } from './raw-log.js';

interface WorklistFile { path: string; tier: string; needsNote: boolean }
interface Worklist { ts: number; sid?: string; files: WorklistFile[]; wrote: string[] }

const LIST_MAX = 8;

export function worklistJsonPath(root: string): string { return join(notebookDir(root), '.worklist.json'); }
export function worklistMdPath(root: string): string { return join(notebookDir(root), '.worklist.md'); }

function load(root: string): Worklist | null {
  try {
    const w = JSON.parse(readFileSync(worklistJsonPath(root), 'utf8')) as Worklist;
    if (!Array.isArray(w?.files)) return null;
    w.wrote = Array.isArray(w.wrote) ? w.wrote : [];
    return w;
  } catch {
    return null;
  }
}

function clearWorklist(root: string): void {
  for (const p of [worklistJsonPath(root), worklistMdPath(root)]) {
    try { if (existsSync(p)) unlinkSync(p); } catch { /* best-effort */ }
  }
}

/** The paths a spec puts a FILE note on. A flow verifies files but gives none of
 *  them the file note the worklist asks for, so flows/lessons contribute none —
 *  which is exactly how a flow written INSTEAD of the file notes shows up as
 *  still-outstanding coverage. */
export function specPaths(spec: unknown): string[] {
  const s = spec as { type?: string; path?: string; op?: string };
  if (!s || s.op === 'retract' || typeof s.path !== 'string') return [];
  return s.type === 'file-single' || s.type === 'file-hub' ? [s.path] : [];
}

/**
 * Finalize a whole write batch against the durable worklist: credit every file
 * note written, report coverage, then clear (all captured) or trim (some left)
 * the pair. `writtenPaths` = the file-note paths this batch actually wrote.
 * Returns the coverage line to print, or null when there is no worklist to
 * compare against (a manual write outside capture, or a session that never
 * armed). Called ONCE per `kb write` invocation — the batch is the one place
 * the whole worklist is visible at once.
 */
export function finalizeBatchCoverage(root: string, writtenPaths: string[]): string | null {
  const w = load(root);
  if (!w) return null;
  for (const p of writtenPaths) if (!w.wrote.includes(p)) w.wrote.push(p);

  const wrote = new Set(w.wrote);
  const outstanding = w.files.filter((f) => f.needsNote);
  const done = outstanding.filter((f) => wrote.has(f.path));
  const left = outstanding.filter((f) => !wrote.has(f.path));
  const already = w.files.length - outstanding.length;

  if (!left.length) clearWorklist(root);
  else trim(root, w, left);

  if (!outstanding.length) return null;
  const lines = [
    `capture coverage: ${done.length} of ${outstanding.length} worklist files noted` +
      (already ? ` (${already} more already had a fresh note)` : ''),
  ];
  if (left.length) {
    const shown = left.slice(0, LIST_MAX).map((f) => `${f.path} [${f.tier}]`).join(', ');
    lines.push(`  still without a file note: ${shown}${left.length > LIST_MAX ? `, +${left.length - LIST_MAX} more` : ''}`);
    lines.push('  each is a file you worked this session — write its note, or say in your reply why it needs none. A flow does not cover them.');
  }
  return lines.join('\n');
}

/** Rewrite the pair down to what is still outstanding, so a re-Read mid-session
 *  shows only the remaining work (and never a frozen full snapshot). The next
 *  capture fire regenerates the full checklist + contract if work remains. */
function trim(root: string, w: Worklist, left: WorklistFile[]): void {
  try {
    writeFileSync(worklistJsonPath(root), JSON.stringify({ ...w, files: left, wrote: [] }));
    const md = [
      '# Capture worklist — still outstanding',
      '',
      'Files you worked this session that still have no note. Write each one (or say why it needs none):',
      '',
      ...left.map((f) => `- ${f.path}   [${f.tier}]`),
      '',
      'Note shapes + how to write a batch in one call: run `kb write` with no spec for the full guide.',
      '',
    ].join('\n');
    writeFileSync(worklistMdPath(root), md);
  } catch {
    /* best-effort */
  }
}
