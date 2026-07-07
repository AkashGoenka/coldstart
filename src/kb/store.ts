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
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, appendFileSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
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

/** Temp-file + rename — a concurrent reader sees the old content or the new,
 *  never a truncated file (agents Read notes/<id>.md and _index.md directly,
 *  and writes race across sessions). Dot-prefixed temp names stay outside the
 *  note-id namespace (ids must start [a-z0-9]). */
function writeFileAtomic(p: string, data: string): void {
  const tmp = join(dirname(p), `.tmp-${process.pid}-${basename(p)}`);
  writeFileSync(tmp, data);
  renameSync(tmp, p);
}

/** Render one folded note to its derived md file. */
export function writeNoteMd(root: string, note: FoldedNote): string {
  mkdirSync(notesDir(root), { recursive: true });
  const p = notePath(root, note.id);
  writeFileAtomic(p, renderNote(note));
  writeIndexMd(root);
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

/**
 * The notebook's table of contents — `notes/_index.md`, one line per active
 * note, regenerated mechanically on every write/render (never by an LLM).
 * The wiki-entrypoint pattern: an agent reads this page first and follows
 * links, so retrieval works even with zero search. Leading underscore keeps
 * it outside the note-id namespace (ids must start [a-z0-9]).
 */
export function writeIndexMd(root: string): string {
  const active = loadAll(root).notes.filter((n) => n.status === 'active');
  const files = active.filter((n) => n.type === 'file');
  const flows = active.filter((n) => n.type === 'flow');
  const lessons = active.filter((n) => n.type === 'lesson');
  const lines = [
    '# Notebook index',
    '',
    `${active.length} active note${active.length === 1 ? '' : 's'} (${files.length} file · ${flows.length} flow · ${lessons.length} lesson)`,
  ];
  if (files.length) {
    lines.push('', '## Files', '');
    for (const n of files) {
      const path = n.anchors[0]?.path ?? n.title;
      const facets = n.facets.length ? ` — ${n.facets.map((f) => f.symbol).join(', ')}` : '';
      lines.push(`- [${path}](${n.id}.md) (${n.character ?? 'file'})${facets}`);
    }
  }
  if (flows.length) {
    lines.push('', '## Flows', '');
    for (const n of flows) lines.push(`- [${n.title}](${n.id}.md)`);
  }
  if (lessons.length) {
    lines.push('', '## Lessons', '');
    for (const n of lessons) lines.push(`- [${n.title}](${n.id}.md)${n.kind ? ` (${n.kind})` : ''}`);
  }
  mkdirSync(notesDir(root), { recursive: true });
  const p = join(notesDir(root), '_index.md');
  writeFileAtomic(p, lines.join('\n') + '\n');
  return p;
}

/** Append a metrics event (miss-log, capture, inject decisions). Best-effort, never throws. */
export function logMetric(root: string, file: 'miss-log' | 'capture' | 'inject-log', event: Record<string, unknown>): void {
  try {
    mkdirSync(metricsDir(root), { recursive: true });
    appendFileSync(join(metricsDir(root), `${file}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch {
    /* metrics must never break a query */
  }
}
