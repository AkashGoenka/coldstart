/**
 * `coldstart graph` — generate a single self-contained HTML file that draws the
 * repo's file graph, then open it in the default browser. No server, no build
 * step, no dependencies: the page is HTML + CSS + one canvas script with the
 * payload baked in, so it also works over email, in a gist, or offline.
 *
 * Like `kb view`, this is a one-shot generate-and-open — the snapshot is
 * accurate at generation time; re-run to refresh.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import type { CodebaseIndex } from '../types.js';
import { loadCoChange } from '../indexer/cochange.js';
import { loadAll, notebookExists } from '../kb/store.js';
import { buildGraphPayload, type GraphNoteAnchors, type GraphStats } from './dump.js';
import { GRAPH_TEMPLATE } from './view-template.js';

/** Notebook notes reduced to "which files does this note join". Absent or
 *  unreadable notebook is not an error — the graph just has no note edges. */
function noteAnchors(root: string): GraphNoteAnchors[] {
  if (!notebookExists(root)) return [];
  try {
    const { notes } = loadAll(root);
    const out: GraphNoteAnchors[] = [];
    for (const n of notes ?? []) {
      if (n.status && n.status !== 'active') continue;
      const paths = [...new Set((n.anchors ?? []).map((a) => a.path).filter(Boolean))];
      if (paths.length < 2) continue;
      out.push({ title: n.title ?? n.id, paths });
    }
    return out;
  } catch {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Bake the payload into the template. `</` inside the JSON is escaped so a
 *  path or note title containing `</script>` cannot close the script block. */
export function renderGraphHtml(template: string, repo: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return template
    .replace('__TITLE__', () => `${escapeHtml(repo)} — codebase graph`)
    // The CLI page stands alone; only the website build fills this in.
    .replace('<!--__HOME_LINK__-->', '')
    .replace('__DATA_JSON__', () => json);
}

/** Best-effort open in the OS default browser. Never throws. */
function openInBrowser(file: string): void {
  // Windows goes through rundll32 rather than `cmd /c start`: cmd re-parses its
  // own command line, so a path containing `&`, `^` or `|` would be interpreted
  // instead of opened. The path here is attacker-influencable in the ordinary
  // sense (it derives from the repo location and from `--out`), and rundll32
  // takes it as a single literal argument with no shell in between.
  const cmd =
    process.platform === 'darwin' ? { bin: 'open', args: [file] }
    : process.platform === 'win32'
      ? { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', file] }
    : { bin: 'xdg-open', args: [file] };
  try {
    const child = execFile(cmd.bin, cmd.args, { windowsHide: true }, () => {});
    child.unref();
  } catch { /* ignore — the path is printed regardless */ }
}

/** Keep the generated page out of the user's commits when it lands in the
 *  default location. A `--out` elsewhere is the caller's business. */
function ignoreGraphHtml(dir: string): void {
  const gi = join(dir, '.gitignore');
  try {
    const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    if (!cur.split('\n').some((l) => l.trim() === 'graph.html')) {
      writeFileSync(gi, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + 'graph.html\n');
    }
  } catch { /* non-fatal */ }
}

export interface GraphViewOptions {
  /** Where to write. Defaults to `<root>/.coldstart/graph.html`. */
  out?: string;
  /** Open in the browser after writing (default true). */
  open?: boolean;
  /** Override the cache dir the co-change sidecar is read from (tests). */
  cacheDir?: string;
}

export function defaultGraphPath(root: string): string {
  return join(root, '.coldstart', 'graph.html');
}

/** Returns the written path plus the stats worth printing. */
export function graphView(
  root: string,
  index: CodebaseIndex,
  opts: GraphViewOptions = {},
): { path: string; stats: GraphStats } {
  const repo = basename(root) || 'repo';
  const { payload, stats } = buildGraphPayload(
    repo, index, loadCoChange(root, opts.cacheDir), noteAnchors(root),
  );
  const html = renderGraphHtml(GRAPH_TEMPLATE, repo, { [repo]: payload });

  const outPath = opts.out ? opts.out : defaultGraphPath(root);
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, html);
  if (!opts.out) ignoreGraphHtml(outDir);
  if (opts.open !== false) openInBrowser(outPath);
  return { path: outPath, stats };
}
