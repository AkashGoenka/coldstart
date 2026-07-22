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

export const MAX_WORKLIST = 30;

const noop = () => {};

// --- Annotation sources (fail-open: absence of data = absence of annotation) ---
export function noteAnnotations(cli, root, files, log = noop) {
  try {
    const raw = execFileSync(
      "node", [cli, "kb", "status", "--json", "--paths", files.join(","), "--root", root],
      { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
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
      { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
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
      cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
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
