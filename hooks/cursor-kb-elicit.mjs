#!/usr/bin/env node
/**
 * cursor-kb-elicit.mjs — Cursor stop + subagentStop notebook capture, v5
 * TRIGGER-TIMED (ported from kb-elicit.mjs 2026-07-17; the v4 always-fire
 * walker is gone).
 *
 * Cursor's stop fires per turn (like Claude's Stop), so the FULL trigger
 * machine applies: every stop updates per-file evidence records
 * (evidence.mjs extractCursorEvidence — edit/read/gs tiers; mentions and
 * .coldstartignore'd files never count) and advances trigger.mjs. Most stops
 * exit silently. Fires:
 *
 *   descent/surge → NON-BLOCKING: payload → pending file; cursor-kb-recall
 *     (beforeSubmitPrompt) delivers it with the user's next prompt via
 *     additional_context.
 *   cap → also non-blocking (same rationale as the Claude hook: replay showed
 *     dense sessions starve descent; blocking each cap re-created v4 agitation).
 *   head-drift → BLOCKING via {followup_message} (commit boundary: the work
 *     just landed, capture before it goes stale).
 *   subagentStop → one-shot BLOCKING with the restate-deliverable tail (#61).
 *
 * Cursor specifics vs the Claude hook:
 *   - Input: root from workspace_roots (cursor-input.mjs); loop_count>0 =
 *     hook-continued turn → never process (replaces stop_hook_active).
 *   - Transcript: conversation JSONL with NO tool_result records — evidence is
 *     call-level, compensated by stat-existence checks on every claim (see
 *     extractCursorEvidence). Sliced incrementally by lineCount, same as Claude.
 *   - Output: block = {followup_message} (auto-submits a continuation turn);
 *     silence = plain exit 0.
 *
 * Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";

import { extractCursorEvidence, segmentStatsCursor } from "./evidence.mjs";
import { initialState, step } from "./trigger.mjs";
import { loadIgnore } from "./ignore.mjs";
import { buildCapturePayload } from "./capture-payload.mjs";
import {
  worklistEntries, freshNotedSet, gitHead, logCaptureEvent, writePendingCapture,
} from "./elicit-core.mjs";
import { cursorRoot } from "./cursor-input.mjs";

// hooks/ sits beside dist/ in both the repo and the published package.
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// --- Logging -----------------------------------------------------------------
let LOG_FILE = join(tmpdir(), "coldstart-kb-hook.log");
function setLogRoot(root) { if (root) LOG_FILE = join(root, ".coldstart", "kb-hook.log"); }
function log(msg) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] elicit: ${msg}\n`); } catch { /* never fail logging */ }
}

// --- stdin ---------------------------------------------------------------------
function readStdin() {
  return new Promise((res) => {
    let data = "";
    let settled = false;
    const done = () => { if (!settled) { settled = true; res(data); } };
    try {
      if (process.stdin.isTTY) return done();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", done);
      process.stdin.on("error", done);
      setTimeout(done, 2000).unref?.();
    } catch { done(); }
  });
}

process.on("uncaughtException", (e) => { log(`uncaught ${e?.stack || e}`); process.exit(0); });
process.on("unhandledRejection", (e) => { log(`unhandled ${e?.stack || e}`); process.exit(0); });

(async () => {
  let input = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) input = JSON.parse(raw);
  } catch (e) { log(`bad stdin ${e}`); }

  try {
    const root = String(cursorRoot(input) || "");
    setLogRoot(root);
    if (!root) { log("SKIP no-root"); process.exit(0); }

    // Hook-continued turn (followup_message re-fires stop on a new generation):
    // never process — the capture turn's own stop must not advance the trigger.
    const lc = typeof input.loop_count === "number" ? input.loop_count : 0;
    if (lc > 0) { log(`SKIP hook-continuation loop_count=${lc}`); process.exit(0); }

    const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!sid) { log("SKIP no-session-id"); process.exit(0); }

    const aid = String(input.subagent_id || input.agent_id || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main";
    const isSubagent = String(input.hook_event_name || "") === "subagentStop";

    // Belt-and-suspenders vs a double-fire within one turn: generation_id is
    // unique per turn; a second stop for the same generation is a duplicate.
    const tid = String(input.generation_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (tid) {
      const turnMarker = join(tmpdir(), `coldstart-cursor-kb-turn-${tid}-${aid}.done`);
      if (existsSync(turnMarker)) { log(`SKIP duplicate-generation ${tid}`); process.exit(0); }
      try { writeFileSync(turnMarker, String(Date.now())); } catch { /* best effort */ }
    }

    // subagentStop supplies the child's own transcript as agent_transcript_path;
    // stop's transcript_path is the main conversation JSONL.
    let transcriptPath = String(input.transcript_path || "");
    if (isSubagent) {
      const own = String(input.agent_transcript_path || "");
      if (!own || !existsSync(own)) {
        log(`SKIP subagent-transcript-missing session=${sid} agent=${aid} tried=${own || "n/a"}`);
        process.exit(0);
      }
      transcriptPath = own;
    }
    if (!transcriptPath || !existsSync(transcriptPath)) { log("SKIP no-transcript"); process.exit(0); }

    const ignore = loadIgnore(root);
    const marker = join(tmpdir(), `coldstart-cursor-kb-${sid}-${aid}.json`);
    let state = null;
    try {
      const parsed = JSON.parse(readFileSync(marker, "utf8"));
      if (parsed && parsed.v === 2) state = parsed;
    } catch { /* first stop of this session (or a pre-v5 marker: start fresh) */ }
    if (!state) state = initialState();

    // This stop's transcript slice (everything since the last processed line).
    const text = readFileSync(transcriptPath, "utf8");
    const lines = text.split("\n");
    const segment = lines.slice(state.lineCount).join("\n");
    state.lineCount = lines.length;

    // Evidence: contentRead tiers only, ignore-filtered. Mentions never count.
    const raw = extractCursorEvidence(segment, root);
    const delta = new Map();
    for (const [rel, r] of raw) {
      if (r.reads + r.edits + r.gs === 0) continue;
      if (ignore(rel)) continue;
      delta.set(rel, r);
    }

    // --- Subagent path: one-shot, no trigger. Offer once, block-deliver. ------
    if (isSubagent) {
      const offered = new Set(Object.keys(state.files));
      const fresh = [...delta.keys()].filter((rel) => !offered.has(rel));
      for (const rel of fresh) state.files[rel] = { ...delta.get(rel), captured: true };
      writeFileSync(marker, JSON.stringify(state));
      if (!fresh.length) { log(`FAST-EXIT subagent no-new-files session=${sid} agent=${aid}`); process.exit(0); }
      const entries = worklistEntries(CLI, root, fresh, Object.fromEntries(fresh.map((rel) => [rel, delta.get(rel)])), log);
      const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "subagent" });
      logCaptureEvent(root, { event: "fire", reason: "subagent", session: sid, agent: aid, files: fresh.length, host: "cursor" });
      log(`FIRE subagent session=${sid} agent=${aid} files=${fresh.length}`);
      process.stdout.write(JSON.stringify({ followup_message: payload }));
      process.exit(0);
    }

    // --- Main path: trigger state machine -------------------------------------
    const head = gitHead(root);
    const headDrift = Boolean(state.head && head && head !== state.head);
    state.head = head || state.head;

    const stats = segmentStatsCursor(segment);
    const freshNoted = freshNotedSet(CLI, root, [...delta.keys()].filter((rel) => !state.files[rel]), log);

    const { state: next, decision } = step(state, {
      delta,
      synthesis: stats.synthesis,
      freshNoted,
      headDrift,
    });
    writeFileSync(marker, JSON.stringify(next));

    if (!decision) {
      log(`TICK session=${sid} stop=${next.stop} active=${next.activeStops} quiet=${next.quietRun} armed=${next.armed} files=${Object.keys(next.files).length} delta=${delta.size}`);
      process.exit(0);
    }

    const entries = worklistEntries(CLI, root, decision.files, next.files, log);
    logCaptureEvent(root, {
      event: "fire", reason: decision.fire, mode: decision.mode, session: sid,
      score: decision.score, files: decision.files.length, stop: next.stop, fires: next.fires, host: "cursor",
    });
    log(`FIRE ${decision.fire} mode=${decision.mode} session=${sid} score=${decision.score} files=${decision.files.length}`);

    if (decision.mode === "block") {
      const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "block" });
      process.stdout.write(JSON.stringify({ followup_message: payload }));
    } else {
      // Non-blocking: cursor-kb-recall delivers this with the user's next prompt.
      const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "inject" });
      writePendingCapture(sid, decision.fire, payload);
    }
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
