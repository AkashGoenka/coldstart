/**
 * Store — notebook layout, skeleton creation, load-all-folded (with an mtime
 * memo for long-lived readers), and md writing.
 *
 * Layout (docs/notebook-kb-implementation-plan.md §2):
 *   .coldstart/notebook/
 *     okf.yaml           committed   (okf_version + coldstart_kb format major)
 *     .raw/<id>.jsonl    committed   (merge=union — the source of truth)
 *     notes/<id>.md      git-ignored (derived render)
 *     .metrics/*.jsonl   git-ignored (miss-log, capture events)
 *     .gitignore         committed
 *
 * The hidden `.coldstart/` dir keeps the notebook out of the code index
 * (walker skips hidden dirs), out of `find`, and out of rg/fd defaults.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FoldedNote } from './types.js';
import { fold } from './fold.js';
import { renderNote } from './render.js';
import { notebookDir, rawDir, rawPath, readLog, listIds } from './raw-log.js';

export { notebookDir, rawDir, rawPath } from './raw-log.js';

export function notesDir(root: string): string {
  return join(notebookDir(root), 'notes');
}
export function notePath(root: string, id: string): string {
  return join(notesDir(root), `${id}.md`);
}
export function metricsDir(root: string): string {
  return join(notebookDir(root), '.metrics');
}

export function notebookExists(root: string): boolean {
  return existsSync(notebookDir(root));
}

/** Create the on-disk skeleton (idempotent). Does NOT touch hooks/coldstart.md —
 *  that is `kb init`'s wiring layer. */
export function initSkeleton(root: string): void {
  mkdirSync(rawDir(root), { recursive: true });
  mkdirSync(notesDir(root), { recursive: true });
  mkdirSync(metricsDir(root), { recursive: true });
  const okf = join(notebookDir(root), 'okf.yaml');
  if (!existsSync(okf)) writeFileSync(okf, 'okf_version: "0.1"\ncoldstart_kb: 1\n');
  const gi = join(notebookDir(root), '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, 'notes/\n.metrics/\n');
}

export interface LoadResult {
  notes: FoldedNote[];
  warnings: string[];
}

// mtime memo so a long-lived reader (MCP server) doesn't re-fold unchanged logs.
const foldMemo = new Map<string, { mtimeMs: number; note: FoldedNote | null; warnings: string[] }>();

/** Fold one note from its `.raw` log. null when the log is absent/empty. */
export function loadNote(root: string, id: string): { note: FoldedNote | null; warnings: string[] } {
  const p = rawPath(root, id);
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(p).mtimeMs;
  } catch {
    return { note: null, warnings: [] };
  }
  const memo = foldMemo.get(p);
  if (memo && memo.mtimeMs === mtimeMs) return { note: memo.note, warnings: memo.warnings };

  const { records, warnings: readWarnings } = readLog(root, id);
  const { note, warnings: foldWarnings } = fold(id, records);
  const entry = { mtimeMs, note, warnings: [...readWarnings, ...foldWarnings] };
  foldMemo.set(p, entry);
  return { note: entry.note, warnings: entry.warnings };
}

/** Fold every note in the notebook. Search consumes THIS — md is never load-bearing. */
export function loadAll(root: string): LoadResult {
  const notes: FoldedNote[] = [];
  const warnings: string[] = [];
  for (const id of listIds(root)) {
    const { note, warnings: w } = loadNote(root, id);
    warnings.push(...w);
    if (note) notes.push(note);
  }
  return { notes, warnings };
}

/** Render one folded note to its derived md file. */
export function writeNoteMd(root: string, note: FoldedNote): string {
  mkdirSync(notesDir(root), { recursive: true });
  const p = notePath(root, note.id);
  writeFileSync(p, renderNote(note));
  return p;
}

/** Re-fold + re-render the given ids (or all). Returns rendered ids. */
export function renderIds(root: string, ids?: string[]): string[] {
  const targets = ids && ids.length ? ids : listIds(root);
  const rendered: string[] = [];
  for (const id of targets) {
    const { note } = loadNote(root, id);
    if (note) {
      writeNoteMd(root, note);
      rendered.push(id);
    }
  }
  return rendered;
}

/** Append a metrics event (miss-log, capture events). Best-effort, never throws. */
export function logMetric(root: string, file: 'miss-log' | 'capture', event: Record<string, unknown>): void {
  try {
    mkdirSync(metricsDir(root), { recursive: true });
    appendFileSync(join(metricsDir(root), `${file}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch {
    /* metrics must never break a query */
  }
}
