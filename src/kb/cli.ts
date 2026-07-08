/**
 * `coldstart kb <verb>` — the notebook's CLI surface. Same reader discipline
 * as find/gs: stdout carries only the answer, diagnostics go to stderr.
 *
 *   kb search <words...> [--max N] [--json] [--hook] [--no-index]
 *   kb lookup <path> [symbol] [--json]
 *   kb write <spec.json | ->  [--into ID] [--new] [--force] [--session S]
 *   kb status [--paths a,b,c] [--json]
 *   kb lint  [--json] [--no-index]
 *   kb render [--id ID]
 *   kb init
 *   kb migrate
 *
 * Exit codes: 0 ok · 1 bad input/error · 2 not found · 3 write returned
 * candidates (two-phase gate: re-run with --into <id> or --new).
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { ensureKeeper } from '../keeper.js';
import { setupNotebook, wireClaudeKbHooks } from '../init.js';
import { kbSearch, renderSearchPage, renderResultsPage, renderCompactPage, shouldImplantTop } from './search.js';
import { loadKbNotesIndex } from './notes-index.js';
import { kbWrite, type WriteSpec } from './write.js';
import { kbLookup, renderLookup } from './lookup.js';
import { kbLint, lintSummary } from './lint.js';
import { kbCommit } from './commit.js';
import { stampAnchors, freshnessLine } from './freshness.js';
import { loadAll, renderIds, initSkeleton, notebookExists, notebookDir, logMetric } from './store.js';
import { KB_RAW_VERSION } from './raw-log.js';

function err(...args: unknown[]): void {
  process.stderr.write(args.join(' ') + '\n');
}
function out(s: string): void {
  process.stdout.write(s + '\n');
}

interface KbFlags {
  root: string;
  json: boolean;
  hook: boolean;
  noIndex: boolean;
  max?: number;
  into?: string;
  isNew: boolean;
  force: boolean;
  commit: boolean;
  id?: string;
  paths?: string[];
  session?: string;
  message?: string;
}

function parseKbArgs(argv: string[]): { positional: string[]; flags: KbFlags } {
  const positional: string[] = [];
  const flags: KbFlags = { root: '.', json: false, hook: false, noIndex: false, isNew: false, force: false, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--root': flags.root = argv[++i] ?? '.'; break;
      case '--json': flags.json = true; break;
      case '--hook': flags.hook = true; break;
      case '--no-index': flags.noIndex = true; break;
      case '--max': flags.max = Number(argv[++i]) || undefined; break;
      case '--into': flags.into = argv[++i]; break;
      case '--new': flags.isNew = true; break;
      case '--force': flags.force = true; break;
      case '--commit-notebook': flags.commit = true; break;
      case '--id': flags.id = argv[++i]; break;
      case '--paths': flags.paths = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--session': flags.session = argv[++i]; break;
      case '-m': case '--message': flags.message = argv[++i]; break;
      default:
        if (a.startsWith('--')) err(`[coldstart kb] unknown flag: ${a}`);
        else positional.push(a);
    }
  }
  flags.root = resolve(flags.root);
  return { positional, flags };
}

const USAGE = `usage: coldstart kb <verb>
  search <words...>   find notes (words, symbols, or file names — tried BEFORE find; --max N widens the default 8)
  lookup <path> [sym] everything known at an exact address (file card, facets, flows, lessons)
  write <spec.json|-> save/correct a note from a JSON spec (see coldstart.md)
  status [--paths ..] notebook overview, or per-path notes+freshness (--json for hooks)
  lint                mechanical worklist (dead anchors, duplicate flows, orphans)
  render [--id ID]    re-fold .raw → derived md
  commit [-m "msg"]   deliberate publish: commit ONLY the notebook .raw to git
  init                create the notebook skeleton in this repo
  migrate             verify the .raw format version`;

export async function runKb(argv: string[]): Promise<number> {
  const verb = argv[0];
  const { positional, flags } = parseKbArgs(argv.slice(1));
  const root = flags.root;

  switch (verb) {
    case 'search': return cmdSearch(positional, flags);
    case 'lookup': return cmdLookup(positional, flags);
    case 'write': return cmdWrite(positional, flags);
    case 'status': return cmdStatus(flags);
    case 'lint': return cmdLint(flags);
    case 'render': {
      if (!requireNotebook(root)) return 2;
      const ids = renderIds(root, flags.id ? [flags.id] : undefined);
      out(`kb render: ${ids.length} note${ids.length === 1 ? '' : 's'} rendered`);
      return 0;
    }
    case 'commit': {
      if (!requireNotebook(root)) return 2;
      const res = kbCommit(root, flags.message);
      if (res.kind === 'error') { err(res.message); return 1; }
      out(res.message);
      return 0;
    }
    case 'init': return cmdInit(root, flags.commit);
    case 'migrate': {
      if (!requireNotebook(root)) return 2;
      out(`kb migrate: format v${KB_RAW_VERSION} — nothing to migrate.`);
      return 0;
    }
    default:
      err(USAGE);
      return 1;
  }
}

function requireNotebook(root: string): boolean {
  if (notebookExists(root)) return true;
  err(`[coldstart kb] no notebook at ${notebookDir(root)} — run \`coldstart kb init\` first`);
  return false;
}

async function cmdSearch(words: string[], flags: KbFlags): Promise<number> {
  const query = words.join(' ').trim();
  if (!query) { err('usage: coldstart kb search <words...> — plain task words work; so do symbols and file names'); return 1; }
  if (!notebookExists(flags.root)) {
    // Empty KB → no tax: tell the agent to go straight to find.
    out(`No notebook in this repo yet. Use \`coldstart find\` as usual.`);
    return 0;
  }

  // The keeper maintains the notes index (lane 2 + absence stamps); the reader
  // only picks it up from disk — the code index is NEVER loaded here (C1).
  // Hook mode skips the keeper spawn (latency budget) but still reads the
  // sidecar: the convergence implant gate lives there. Absent → null → the
  // gate degrades to dominance-only.
  let notesIndex = null;
  if (!flags.noIndex) {
    if (!flags.hook) await ensureKeeper(flags.root);
    notesIndex = loadKbNotesIndex(flags.root);
  }

  const result = await kbSearch(flags.root, query, {
    notesIndex,
    // Tool mode is a search engine (wide page, previews + openable paths, one
    // Read for depth); hook mode stays narrow — injected context is re-read
    // every turn, so its page must stay small.
    maxResults: flags.max ?? (flags.hook ? 3 : 8),
    source: flags.hook ? 'hook' : 'tool',
    strongOnly: flags.hook, // an arbitrary user sentence must not inject weak grazes
  });
  for (const w of result.warnings) err(`[coldstart kb] ${w}`);

  // Every injection decision grows the calibration corpus (implant thresholds
  // are re-derived from real runs, never hand-maintained).
  if (flags.hook && result.hits.length) {
    logMetric(flags.root, 'inject-log', {
      query: query.slice(0, 200),
      top: result.hits[0].note.id,
      implant: shouldImplantTop(result),
      convergence: result.hits[0].convergence,
      strongTerms: result.hits[0].strongTerms,
      scores: result.hits.map((h) => Math.round(h.score * 100) / 100),
    });
  }

  if (flags.json) {
    out(JSON.stringify({
      query,
      terms: result.terms,
      omitted: result.omitted ?? 0,
      maxUsed: result.maxUsed,
      hits: result.hits.map((h) => ({
        id: h.note.id, type: h.note.type, kind: h.note.kind, title: h.note.title,
        status: h.note.status, tier: h.note.status !== 'active' ? 'superseded' : h.tier === 1 ? 'stale' : 'fresh',
        updated: h.note.updated, score: Math.round(h.score * 100) / 100,
        anchors: h.stamped, absence: h.absence,
        page: renderSearchPage(flags.root, query, { ...result, hits: [h] }),
      })),
    }, null, 2));
  } else if (flags.hook) {
    // Tiered injection: full body for a gate-passing top hit (kills the
    // fetch turn), titles + gists for the rest.
    out(renderCompactPage(query, result));
  } else {
    out(renderResultsPage(query, result));
  }
  return 0;
}

function cmdLookup(positional: string[], flags: KbFlags): number {
  const [path, symbol] = positional;
  if (!path) { err('usage: coldstart kb lookup <path> [symbol] — exact repo-relative path, optional top-level symbol'); return 1; }
  if (!requireNotebook(flags.root)) return 2;
  const result = kbLookup(flags.root, path, symbol);
  for (const w of result.warnings) err(`[coldstart kb] ${w}`);
  if (flags.json) { out(JSON.stringify(result, null, 2)); }
  else out(renderLookup(result));
  return result.fileNote || result.flows.length || result.lessons.length ? 0 : 2;
}

/** Read all of stdin. readFileSync(0) throws EAGAIN whenever stdin is a pipe
 *  that is momentarily empty (always for specs > the 64KB pipe buffer, and
 *  timing-dependent at any size when the writer is slow) — the stream API
 *  waits instead. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function cmdWrite(positional: string[], flags: KbFlags): Promise<number> {
  const src = positional[0];
  if (!src) { err('usage: coldstart kb write <spec.json | -> [--into ID] [--new]'); return 1; }
  let raw = '';
  try {
    raw = src === '-' ? await readStdin() : readFileSync(src, 'utf8');
  } catch (e) {
    err(`[coldstart kb] cannot read spec: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  let spec: WriteSpec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    err(`[coldstart kb] spec is not valid JSON: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  initSkeleton(flags.root); // first write creates the notebook
  const result = await kbWrite(flags.root, spec, { into: flags.into, isNew: flags.isNew, force: flags.force, session: flags.session });

  if (result.status === 'error') { err(`[coldstart kb] ${result.message}`); return 1; }
  if (result.status === 'candidates') {
    const lines = [
      'kb write: possible existing notes for this concept —',
      ...result.candidates.map((c) => `  --into ${c.id}   [${c.type}] ${c.title}${c.summary ? ` — ${c.summary}` : ''}`),
      '',
      result.message,
    ];
    out(lines.join('\n'));
    return 3;
  }
  // Path warnings ride on STDOUT — the writing agent must see and fix them
  // now (a typo'd path is a silently dangling link forever after).
  const warned = result.warnings?.length
    ? '\n' + result.warnings.map((w) => `warning: ${w}`).join('\n')
    : '';
  out(`kb write: ${result.op} → ${result.id}${warned}`);
  return 0;
}

function cmdStatus(flags: KbFlags): number {
  if (!requireNotebook(flags.root)) return flags.json ? (out('{"notes":[],"paths":[]}'), 0) : 2;
  const { notes, warnings } = loadAll(flags.root);

  if (flags.paths?.length) {
    const perPath = flags.paths.map((p) => {
      const anchored = notes
        .filter((n) => n.anchors.some((a) => a.path === p))
        .map((n) => {
          const stamped = stampAnchors(flags.root, n.anchors.filter((a) => a.path === p));
          return {
            id: n.id, type: n.type, title: n.title, status: n.status,
            state: stamped[0]?.state ?? 'unverified',
          };
        });
      return { path: p, notes: anchored };
    });
    if (flags.json) out(JSON.stringify({ paths: perPath }, null, 2));
    else {
      for (const { path, notes: anchored } of perPath) {
        out(`${path}: ${anchored.length ? anchored.map((n) => `${n.id} [${n.type} · ${n.state}]`).join(', ') : '(no notes)'}`);
      }
    }
    return 0;
  }

  const byType = { file: 0, flow: 0, lesson: 0 };
  let flagged = 0, superseded = 0;
  for (const n of notes) {
    byType[n.type]++;
    if (n.status !== 'active') superseded++;
    else if (stampAnchors(flags.root, n.anchors).some((s) => s.state === 'changed' || s.state === 'missing')) flagged++;
  }
  if (flags.json) {
    out(JSON.stringify({ total: notes.length, byType, flagged, superseded, warnings: warnings.length }, null, 2));
  } else {
    out(`notebook: ${notes.length} notes (${byType.file} file · ${byType.flow} flow · ${byType.lesson} lesson) · ${flagged} flagged stale · ${superseded} superseded/retracted${warnings.length ? ` · ${warnings.length} raw warnings (run kb lint)` : ''}`);
  }
  return 0;
}

async function cmdLint(flags: KbFlags): Promise<number> {
  if (!requireNotebook(flags.root)) return 2;
  const notesIndex = flags.noIndex ? null : loadKbNotesIndex(flags.root);
  const findings = await kbLint(flags.root, notesIndex);
  if (flags.json) out(JSON.stringify({ findings }, null, 2));
  else out(lintSummary(findings));
  return 0;
}

// ---------------------------------------------------------------------------
// kb init — a thin alias over `coldstart init`'s shared notebook setup. Kept
// for muscle memory: sets up the notebook files + git wiring + Claude hooks,
// but NOT coldstart.md or the find/gs hooks (that's the full `coldstart init`).
// ---------------------------------------------------------------------------

function cmdInit(root: string, commit: boolean): number {
  setupNotebook(root, commit); // skeleton + .gitattributes + gitignore (prints status to stderr)
  const kb = wireClaudeKbHooks(root);
  const kbLine = typeof kb === 'string'
    ? `- .claude/settings.json ${kb}: recall on UserPromptSubmit + capture on Stop/SubagentStop`
    : `- HOOKS NOT WIRED: ${kb.error}`;
  out(`kb init: notebook ready at ${notebookDir(root)}
${kbLine}
- for the full setup (coldstart.md + find/gs hooks), run \`coldstart init\`
- try it: \`coldstart kb search <words>\` · \`coldstart kb write <spec.json>\` · \`coldstart kb status\``);
  return 0;
}
