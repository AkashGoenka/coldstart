/**
 * `coldstart kb view` — generate a single self-contained HTML file that browses
 * the notebook, then open it in the default browser. No server: this is a
 * one-shot generate-and-open. Freshness is computed NOW (whole-file hash
 * tripwire, same as `status`), so the snapshot is accurate at generation time;
 * re-run to refresh.
 *
 * The client is an embedded, dependency-free HTML/JS app (VIEW_TEMPLATE); this
 * module only produces the baked JSON data and drops it into the template.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { loadAll, notebookDir } from './store.js';
import { renderNote } from './render.js';
import { stampAnchors } from './freshness.js';
import type { FoldedNote } from './types.js';

type FreshState = 'fresh' | 'unverified' | 'changed' | 'missing';
const RANK: Record<FreshState, number> = { fresh: 0, unverified: 1, changed: 2, missing: 3 };

/** Strip renderNote's frontmatter + leading `# title` to get just the body md. */
function bodyMarkdown(note: FoldedNote): string {
  const md = renderNote(note);
  const m = md.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  let body = m ? m[1] : md;
  body = body.replace(/^\s*#\s+.*\n?/, ''); // drop the first H1 (dupes the title)
  return body.trim();
}

/** FoldedNote → the flat shape the client expects (mirrors the extract script). */
function toClientNote(root: string, note: FoldedNote) {
  const stamped = stampAnchors(root, note.anchors).map((a) => ({
    path: a.path,
    symbols: a.symbols,
    hash: a.hash,
    state: a.state as FreshState,
  }));
  let roll: FreshState = stamped.length ? 'fresh' : 'unverified';
  for (const a of stamped) if (RANK[a.state] > RANK[roll]) roll = a.state;

  const body = bodyMarkdown(note);
  const outLinks = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]))];

  return {
    id: note.id,
    type: note.type,
    character: note.character ?? null,
    title: note.title,
    aliases: note.aliases ?? [],
    status: note.status,
    updated: note.updated ?? '',
    edits: note.edits ?? 0,
    anchors: stamped,
    freshness: roll,
    dir: stamped[0] ? dirname(stamped[0].path) : '(unanchored)',
    outLinks,
    body,
    backlinks: [] as string[],
  };
}

/** Build the `{ summary, notes }` payload the template bakes in. */
export function buildViewData(root: string, generated: string) {
  const { notes: folded } = loadAll(root);
  const notes = folded
    .filter((n) => n.status !== 'retracted')
    .map((n) => toClientNote(root, n));

  const byId = new Map(notes.map((n) => [n.id, n]));
  for (const n of notes) {
    for (const l of n.outLinks) {
      const t = byId.get(l);
      if (t && l !== n.id && !t.backlinks.includes(n.id)) t.backlinks.push(n.id);
    }
  }
  notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const byType: Record<string, number> = {};
  const byFreshness: Record<string, number> = {};
  for (const n of notes) {
    byType[n.type] = (byType[n.type] || 0) + 1;
    byFreshness[n.freshness] = (byFreshness[n.freshness] || 0) + 1;
  }
  return { summary: { total: notes.length, byType, byFreshness, repo: basename(root), generated }, notes };
}

/** Bake data into the template. `</` is neutralized so note text can't break the script tag. */
export function renderViewHtml(template: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return template.replace('__DATA_JSON__', () => json);
}

/** Best-effort open in the OS default browser. Never throws. */
function openInBrowser(file: string): void {
  const cmd =
    process.platform === 'darwin' ? { bin: 'open', args: [file] }
    : process.platform === 'win32' ? { bin: 'cmd', args: ['/c', 'start', '', file] }
    : { bin: 'xdg-open', args: [file] };
  try {
    const child = execFile(cmd.bin, cmd.args, () => {});
    child.unref();
  } catch { /* ignore — the path is printed regardless */ }
}

/** Ensure the notebook .gitignore excludes the generated index.html. */
function ignoreIndexHtml(root: string): void {
  const gi = join(notebookDir(root), '.gitignore');
  try {
    const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    if (!cur.split('\n').some((l) => l.trim() === 'index.html')) {
      writeFileSync(gi, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + 'index.html\n');
    }
  } catch { /* non-fatal */ }
}

export interface ViewOptions {
  open?: boolean;
  generated: string; // ISO date, injected by the caller (cli stamps it)
}

/** Returns the written file path. */
export function kbView(root: string, template: string, opts: ViewOptions): string {
  const data = buildViewData(root, opts.generated);
  const html = renderViewHtml(template, data);
  const outPath = join(notebookDir(root), 'index.html');
  writeFileSync(outPath, html);
  ignoreIndexHtml(root);
  if (opts.open !== false) openInBrowser(outPath);
  return outPath;
}
