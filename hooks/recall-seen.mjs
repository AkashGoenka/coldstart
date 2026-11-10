/**
 * recall-seen.mjs — per-session dedup state for the recall hooks.
 *
 * 61% of notebook injections re-showed a note the SAME session had already
 * been given (worst case 12x). That is pure tax: the title and gist are
 * already in the agent's context, so the repeat buys nothing and pushes the
 * page toward the host's size cap. Each recall hook remembers the ids it has
 * shown and passes them to `kb search --seen`, which drops them from the page
 * it would otherwise have rendered (no backfill; all-seen => inject nothing).
 *
 * "Seen" = shown by recall OR written by this session (`kb write --session`,
 * logged to the notebook's capture.jsonl) — a note the agent just wrote is in
 * its context already, and re-injecting it was the most common wrong injection.
 *
 * Reset on COMPACTION, not on a clock. After a compact the session id is
 * unchanged but the agent's context is gone, so a previously-shown note is
 * genuinely absent again and SHOULD be re-injectable. The signal is each
 * host's own compaction hook (recall-compact.mjs: Claude PreCompact, Codex
 * PostCompact, Cursor preCompact) calling resetSeen. NOT the transcript: Claude
 * Code transcripts are append-only (a compact appends a compact_boundary line,
 * the file never shrinks), so the old shrink check never fired in real use.
 *
 * Shared by kb-recall.mjs (Claude), cursor-kb-recall.mjs and
 * codex-kb-recall.mjs so the three cannot drift. Every function is fail-open:
 * any error leaves dedup OFF rather than blocking recall.
 */

import { readFileSync, writeFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
/** capture.jsonl is append-only and unbounded; only its tail can hold this
 *  session's writes since the last compaction. */
const CAPTURE_TAIL_BYTES = 512 * 1024;
/** os.tmpdir(), NOT literal /tmp — that path is reserved for the find_nudge
 *  state file, which the nudge handler reads back by an agreed literal path. */
export const seenPath = (sid) => join(tmpdir(), `coldstart-recall-seen-${sid}.json`);

function readState(sid) {
  try {
    const st = JSON.parse(readFileSync(seenPath(sid), "utf8"));
    return st && typeof st === "object" ? st : null;
  } catch { return null; }
}

function tail(path, bytes) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start ? text.slice(text.indexOf("\n") + 1) : text; // drop a cut first line
  } finally { closeSync(fd); }
}

/** Note ids this session wrote at or after `since` (ms epoch). */
function writtenIds(root, sid, since) {
  if (!root) return [];
  try {
    const path = join(root, ".coldstart", "notebook", ".metrics", "capture.jsonl");
    const out = [];
    for (const line of tail(path, CAPTURE_TAIL_BYTES).split("\n")) {
      if (!line.includes(sid)) continue; // cheap pre-filter before JSON.parse
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev?.event !== "write" || ev.session !== sid || typeof ev.id !== "string") continue;
      if (Date.parse(ev.ts) >= since) out.push(ev.id);
    }
    return out;
  } catch { return []; }
}

/**
 * Ids already in this session's context: shown since the last compaction
 * (within the TTL) plus written since the last compaction. `root` is the repo
 * root (for capture.jsonl); `log` is optional (each host has its own).
 * Returns { ids, since } — pass `since` back to writeSeen.
 */
export function readSeen(sid, root, log) {
  if (!sid) return { ids: [], since: 0 };
  try {
    const st = readState(sid);
    const since = Number(st?.since) || 0;
    const live = st && Array.isArray(st.ids) && Date.now() - (st.ts || 0) <= SEEN_TTL_MS;
    const shown = live ? st.ids : [];
    const written = writtenIds(root, sid, since);
    if (written.length) log?.(`seen: ${written.length} note(s) written this session`);
    return { ids: [...new Set([...shown, ...written])], since };
  } catch { return { ids: [], since: 0 }; }
}

export function writeSeen(sid, ids, since = 0) {
  if (!sid) return;
  try {
    writeFileSync(seenPath(sid), JSON.stringify({
      ids: [...new Set(ids)].slice(-200), // bounded; a session never shows this many
      since,
      ts: Date.now(),
    }));
  } catch { /* fail-open: dedup is an optimisation, never a gate */ }
}

/** A compaction happened: everything shown or written before NOW is out of the
 *  agent's context again. Returns how many shown ids were cleared. */
export function resetSeen(sid) {
  if (!sid) return 0;
  const n = Array.isArray(readState(sid)?.ids) ? readState(sid).ids.length : 0;
  writeSeen(sid, [], Date.now());
  return n;
}

/** Note ids on a rendered pointer page — each hit carries `→ open: …/<id>.md`.
 *  Read back off the rendered text so the hooks need no structured output. */
export function idsInPage(page) {
  return [...page.matchAll(/→ open:\s*\S*?notes\/([\w.-]+)\.md/g)].map((m) => m[1]);
}

/** The `--seen a,b,c` argv fragment, or [] when there is nothing to exclude. */
export function seenArgs(ids) {
  return ids.length ? ["--seen", ids.join(",")] : [];
}
