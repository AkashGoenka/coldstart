/**
 * Durable capture worklist — the coverage/trim half.
 *
 * The capture hook (hooks/capture-payload.mjs) drops the session's worklist as a
 * DURABLE pair in the repo notebook — unlike the old tmpdir manifest, which was
 * a one-shot blob lost to compaction:
 *   .coldstart/notebook/.worklist-<sid>.json   structured scope (source of truth)
 *   .coldstart/notebook/.worklist-<sid>.md      the prose checklist the agent re-Reads
 * Both are gitignored (src/kb/store.ts initSkeleton).
 *
 * SESSION+AGENT-SCOPED: the pair is keyed by the SAME identity as the tmpdir
 * evidence marker, `<sid>-<aid>` (main agent is aid="main"; each subagent gets
 * its own aid) — NOT one shared file per repo, and NOT by sid alone. A subagent
 * shares its parent's session id, so sid-only keying would make a subagent's
 * capture clobber the main agent's worklist and its `kb write` clear the main
 * agent's coverage. Each agent stream therefore reads and writes ONLY its own
 * worklist. `kb write --session <sid> --agent <aid>` finalizes against
 * `.worklist-<sid>-<aid>.json` (aid defaults to "main"). A write with NO session
 * touches no worklist at all (returns null): the capture payload always prints
 * `--session`/`--agent`, so a session-less write is by definition outside capture
 * — and picking "the freshest worklist" to mutate would let a stray hand write
 * clear or downgrade another agent's active checklist. `--session` stays the bare
 * sid so the flow-evidence check (write-guide.flowEvidenceCount, which unions
 * markers across a session's agents) is unaffected.
 *
 * This module is the reader/trimmer. After a `kb write` batch it credits the
 * file notes just written, reports which worked files still lack a note (a flow
 * does NOT cover them), and then CLEARS the pair (all captured) or TRIMS it to
 * what is left — so a stale snapshot with a frozen denominator never lingers to
 * mislead a later write. Regeneration is the hook's job: the next capture fire
 * re-diffs against live note freshness and rewrites the pair, so a file missed
 * in one pass reappears next time.
 *
 * CONTRACT TWIN: hooks/capture-payload.mjs writes this pair — keep the paths
 * (`<sid>-<aid>` keyed, with the legacy unkeyed fallback) and the .json shape
 * (ts, sid, aid, files:[{path,tier,needsNote}], wrote:[]) in step. Everything here
 * is best-effort: a missing/malformed worklist prints nothing and never fails a write.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { notebookDir } from './raw-log.js';

interface WorklistFile { path: string; tier: string; needsNote: boolean }
interface Worklist { ts: number; sid?: string; aid?: string; files: WorklistFile[]; wrote: string[] }

const LIST_MAX = 8;

/** Filesystem-safe slug — mirrors the sanitize kb-elicit.mjs applies to
 *  session_id / agent_id, so a `--session`/`--agent` value from any surface keys
 *  the same file the hook wrote. */
function slug(s?: string): string {
  return String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
}

/** The worklist key = the tmpdir marker identity, `<sid>-<aid>` (aid defaults to
 *  "main"). Empty only when no session id is known at all. */
function agentKey(sid?: string, aid?: string): string {
  const s = slug(sid);
  return s ? `${s}-${slug(aid) || 'main'}` : '';
}

export function worklistJsonPath(root: string, sid?: string, aid?: string): string {
  const k = agentKey(sid, aid);
  return join(notebookDir(root), k ? `.worklist-${k}.json` : '.worklist.json');
}
export function worklistMdPath(root: string, sid?: string, aid?: string): string {
  const k = agentKey(sid, aid);
  return join(notebookDir(root), k ? `.worklist-${k}.md` : '.worklist.md');
}

/**
 * Resolve the worklist JSON file this write should finalize against.
 *   - `--session <sid> [--agent <aid>]` → that agent's own file (the capture
 *     path). aid defaults to "main", so a plain `--session` finalizes the main
 *     agent's worklist, never a subagent's.
 *   - NO session → null. A session-less write is outside capture (the payload
 *     always carries `--session`/`--agent`); mutating "the freshest worklist"
 *     would let a stray hand write clear or downgrade an active checklist.
 * Returns null when there is nothing to finalize against.
 */
function resolveJsonPath(root: string, sid?: string, aid?: string): string | null {
  if (!slug(sid)) return null;
  const p = worklistJsonPath(root, sid, aid);
  return existsSync(p) ? p : null;
}

function load(jsonPath: string): Worklist | null {
  try {
    const w = JSON.parse(readFileSync(jsonPath, 'utf8')) as Worklist;
    if (!Array.isArray(w?.files)) return null;
    w.wrote = Array.isArray(w.wrote) ? w.wrote : [];
    return w;
  } catch {
    return null;
  }
}

function clearWorklist(jsonPath: string): void {
  for (const p of [jsonPath, jsonPath.replace(/\.json$/, '.md')]) {
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
 * Finalize a whole write batch against THIS AGENT's durable worklist: credit
 * every file note written, report coverage, then clear (all captured) or trim
 * (some left) the pair. `writtenPaths` = the file-note paths this batch actually
 * wrote; `sid`+`aid` select the agent's own worklist (see resolveJsonPath) so a
 * subagent never trims the main agent's list.
 * Returns the coverage line to print, or null when there is no worklist to
 * compare against (a manual write outside capture, or a session that never
 * armed). Called ONCE per `kb write` invocation — the batch is the one place
 * the whole worklist is visible at once.
 */
export function finalizeBatchCoverage(root: string, writtenPaths: string[], sid?: string, aid?: string): string | null {
  const jsonPath = resolveJsonPath(root, sid, aid);
  if (!jsonPath) return null;
  const w = load(jsonPath);
  if (!w) return null;
  for (const p of writtenPaths) if (!w.wrote.includes(p)) w.wrote.push(p);

  const wrote = new Set(w.wrote);
  const outstanding = w.files.filter((f) => f.needsNote);
  const done = outstanding.filter((f) => wrote.has(f.path));
  const left = outstanding.filter((f) => !wrote.has(f.path));
  const already = w.files.length - outstanding.length;

  if (!left.length) clearWorklist(jsonPath);
  else trim(jsonPath, w, left);

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
function trim(jsonPath: string, w: Worklist, left: WorklistFile[]): void {
  try {
    writeFileSync(jsonPath, JSON.stringify({ ...w, files: left, wrote: [] }));
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
    writeFileSync(jsonPath.replace(/\.json$/, '.md'), md);
  } catch {
    /* best-effort */
  }
}
