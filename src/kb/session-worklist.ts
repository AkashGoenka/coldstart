/**
 * Capture coverage — telling the writing agent how much of its worklist it noted.
 *
 * The gap this closes: the capture checklist hands the agent a worklist of every
 * file it worked on, but `kb write` only ever sees ONE spec, so nothing could
 * report "you wrote 8 notes for 30 worked files". The agent's own count is the
 * one thing it cannot check — it is mid-heredoc, and under-capture is silent by
 * construction. So the hook drops the worklist in tmpdir when it builds the
 * capture prompt, and every `kb write --session <sid>` prints the running ratio.
 *
 * CONTRACT TWIN: hooks/capture-payload.mjs (worklistManifestPath) writes this
 * file; keep the name and shape in step. Everything here is best-effort — a
 * missing, stale or malformed manifest prints nothing and never fails a write.
 *
 * Local only. The manifest lives in tmpdir, never in the repo: it is scratch
 * state for one session, not a record, and nothing about it is transmitted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface WorklistFile { path: string; tier: string; needsNote: boolean }
interface Manifest { ts: number; files: WorklistFile[]; wrote: string[] }

/** Manifests older than this are a resumed/unrelated session — ignore them. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Below this share of outstanding files, name the skips. */
const LOW_COVERAGE = 0.5;
const LIST_MAX = 6;

function manifestPath(sid: string): string {
  return join(tmpdir(), `coldstart-kb-worklist-${sid}.json`);
}

function load(sid: string): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(sid), 'utf8')) as Manifest;
    if (!Array.isArray(m?.files) || !m.files.length) return null;
    if (typeof m.ts === 'number' && Date.now() - m.ts > MAX_AGE_MS) return null;
    m.wrote = Array.isArray(m.wrote) ? m.wrote : [];
    return m;
  } catch {
    return null;
  }
}

/** Paths this spec puts a note on. Flow steps do NOT count: a flow verifies
 *  files, it does not give any of them the file note rule 5 asks for. */
export function specPaths(spec: unknown): string[] {
  const s = spec as { type?: string; path?: string };
  if (!s || typeof s.path !== 'string') return [];
  return s.type === 'file-single' || s.type === 'file-hub' ? [s.path] : [];
}

/**
 * Record this write against the session worklist and return the coverage line
 * to print, or null when there is no manifest to compare against (no --session,
 * a manual `kb write` outside capture, a session that never armed).
 */
export function noteCoverage(sid: string | undefined, spec: unknown): string | null {
  if (!sid) return null;
  const m = load(sid);
  if (!m) return null;

  for (const p of specPaths(spec)) if (!m.wrote.includes(p)) m.wrote.push(p);
  try { writeFileSync(manifestPath(sid), JSON.stringify(m)); } catch { /* best-effort */ }

  const outstanding = m.files.filter((f) => f.needsNote);
  if (!outstanding.length) return null;
  const wrote = new Set(m.wrote);
  const done = outstanding.filter((f) => wrote.has(f.path));
  const left = outstanding.filter((f) => !wrote.has(f.path));
  const already = m.files.length - outstanding.length;

  const lines = [
    `capture coverage: ${done.length} of ${outstanding.length} worklist files noted` +
      (already ? ` (${already} more already had a fresh note)` : ''),
  ];
  if (left.length) {
    const shown = left.slice(0, LIST_MAX).map((f) => `${f.path} [${f.tier}]`).join(', ');
    lines.push(`  not noted yet: ${shown}${left.length > LIST_MAX ? `, +${left.length - LIST_MAX} more` : ''}`);
  }
  // The nudge fires only on the low end, and asks for a REASON rather than more
  // notes: a deliberate skip is a fine answer, an invisible one is not. Chained
  // writes each print this, so the last line of the block carries the real tally.
  if (left.length && done.length / outstanding.length < LOW_COVERAGE) {
    lines.push('  if those need no note, say which and why in your reply — an unexplained skip reads as a forgotten one.');
  }
  return lines.join('\n');
}
