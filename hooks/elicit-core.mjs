/**
 * elicit-core.mjs — protocol-neutral v5 capture helpers, shared by the three
 * host elicit hooks (kb-elicit / cursor-kb-elicit / codex-kb-elicit) and the
 * recall hooks that deliver pending captures.
 *
 * Everything here is host-independent: worklist annotation (kb status +
 * consumers, both fail-open), fresh-note discounting, the git-HEAD
 * fingerprint, capture metrics, and the pending-file handoff between a
 * non-blocking fire and the next-prompt recall channel. What stays per-host:
 * input adaptation, the transcript walk (see evidence.mjs's per-host
 * extractors), and the output envelope.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from "node:fs";

import { MAX_CAPTURE_FILES } from "./trigger.mjs";
// One source of truth: the display cap equals what a fire claims, so the prompt
// never shows fewer (or more) files than the fire marks captured.
export const MAX_WORKLIST = MAX_CAPTURE_FILES;

const noop = () => {};

// --- Annotation sources (fail-open: absence of data = absence of annotation) ---
export function noteAnnotations(cli, root, files, log = noop) {
  try {
    const raw = execFileSync(
      "node", [cli, "kb", "status", "--json", "--paths", files.join(","), "--root", root],
      { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const byPath = new Map();
    for (const entry of JSON.parse(raw).paths || []) byPath.set(entry.path, entry.notes || []);
    return byPath;
  } catch (e) {
    log(`kb status unavailable (${String(e).split("\n")[0]}) — annotating as no-notes`);
    return new Map();
  }
}

export function consumerCounts(cli, root, files, log = noop) {
  try {
    const raw = execFileSync(
      "node", [cli, "consumers", "--json", "--paths", files.join(","), "--root", root],
      { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const byPath = new Map();
    for (const entry of JSON.parse(raw).paths || []) byPath.set(entry.path, entry.consumers);
    return byPath;
  } catch (e) {
    log(`consumers unavailable (${String(e).split("\n")[0]}) — no graph annotation`);
    return new Map();
  }
}

export function worklistEntries(cli, root, files, stateFiles, log = noop) {
  const listed = files.slice(0, MAX_WORKLIST);
  const notes = noteAnnotations(cli, root, listed, log);
  const consumers = consumerCounts(cli, root, listed, log);
  return listed.map((rel) => {
    const f = stateFiles[rel] || {};
    const tier = f.edits > 0 ? `edited ×${f.edits}` : f.reads > 0 ? "read" : "skimmed";
    return {
      path: rel,
      tier,
      notes: (notes.get(rel) || []).map((n) => ({ id: n.id, type: n.type, state: n.state })),
      noConsumers: consumers.get(rel) === 0,
    };
  });
}

/** Fresh-noted set for score discounting: files whose EVERY anchored note is fresh. */
export function freshNotedSet(cli, root, files, log = noop) {
  if (!files.length) return new Set();
  const notes = noteAnnotations(cli, root, files, log);
  const fresh = new Set();
  for (const rel of files) {
    const anchored = notes.get(rel) || [];
    if (anchored.length && anchored.every((n) => n.state === "fresh")) fresh.add(rel);
  }
  return fresh;
}

// --- Repo observation: HEAD fingerprint (catches MANUAL commits too) -----------
export function gitHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).trim();
  } catch { return ""; }
}

// --- Capture metrics -----------------------------------------------------------
export function logCaptureEvent(root, event) {
  try {
    const dir = join(root, ".coldstart", "notebook", ".metrics");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "capture.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  } catch { /* metrics never wedge a stop */ }
}

// --- Marker recovery: where did this session last OFFER work? -------------------
// The trigger marker lives in the OS temp dir, which is swept every few days, so
// a session resumed across days loses its read offset repeatedly (measured in
// this repo: 24 losses across 8 sessions, all spanning 5-11 days). capture.jsonl
// is the durable twin — in-repo, append-only, stamped with session + ts — so it
// still knows what happened after the marker is gone.
//
// FIRE events ONLY. A fire is the one event meaning "these files were actually
// put in front of the agent". A stop that merely PROCESSED evidence banked it in
// the marker, which is exactly what got swept; treating that as covered would
// skip work nobody was ever asked about. Same reason the old `baseline` events
// don't count: they mark discarded history, not offered history.
export function lastFireAt(root, sid) {
  if (!sid) return null;
  try {
    const raw = readFileSync(join(root, ".coldstart", "notebook", ".metrics", "capture.jsonl"), "utf8");
    let last = null;
    for (const line of raw.split("\n")) {
      // Cheap pre-filter: skip JSON.parse on the (many) lines of other sessions.
      if (!line || !line.includes(sid)) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.session !== sid || d.event !== "fire") continue;
      if (typeof d.ts === "string" && (last === null || d.ts > last)) last = d.ts;
    }
    return last;
  } catch { return null; }
}

/** First transcript line stamped AFTER isoTs, i.e. the first line not yet offered.
 *  Both sides are `new Date().toISOString()` (fixed-width, UTC, Z-suffixed), so
 *  lexicographic order is chronological order and no Date parsing is needed.
 *  Returns 0 when NO line carries a timestamp at all: with no way to place the
 *  boundary the safe answer is replay, never skip. */
// Whitespace-tolerant: Claude Code writes compact JSON, but a miss here degrades
// to a full replay, and no host should be able to cause that by pretty-printing.
const TRANSCRIPT_TS = /"timestamp"\s*:\s*"(\d[^"]*)"/;
export function lineIndexAfter(lines, isoTs) {
  let sawTs = false;
  for (let i = 0; i < lines.length; i++) {
    const m = TRANSCRIPT_TS.exec(lines[i]);
    if (!m) continue;
    sawTs = true;
    if (m[1] > isoTs) return i;
  }
  return sawTs ? lines.length : 0;
}

// --- Pending-capture handoff ---------------------------------------------------
// A descent fire writes its worklist payload here instead of blocking the
// stop; the host's next-prompt recall hook consumes it (capture first, then the
// user's request). One file per session id — a second fire before delivery
// overwrites (the later worklist supersedes). Same path scheme across hosts;
// host session ids never collide (host-distinct formats).
export function pendingPath(sid) {
  return join(tmpdir(), `coldstart-kb-pending-${sid}.json`);
}

export function writePendingCapture(sid, reason, payload) {
  writeFileSync(pendingPath(sid), JSON.stringify({ ts: Date.now(), reason, payload }));
}

/** Consume (delete) the pending capture for this session. Stale pendings
 *  (>24h — e.g. a session resumed days later) are dropped. */
export function takePendingCapture(sid) {
  if (!sid) return "";
  const pf = pendingPath(sid);
  try {
    if (!existsSync(pf)) return "";
    const pending = JSON.parse(readFileSync(pf, "utf8"));
    unlinkSync(pf);
    if (Date.now() - (pending.ts || 0) > 24 * 3600 * 1000) return "";
    return String(pending.payload || "");
  } catch { return ""; }
}
