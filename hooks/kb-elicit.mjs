#!/usr/bin/env node
/**
 * kb-elicit.mjs — Stop + SubagentStop hook. Notebook capture, trigger-timed.
 *
 * v5 (2026-07-17): the always-fire gate is gone. Every Stop updates per-file
 * EVIDENCE RECORDS (hooks/evidence.mjs — edit/read/gs tiers; mentions and
 * .coldstartignore'd files never count) and advances the TRIGGER state machine
 * (hooks/trigger.mjs — score/arm, fire on descent/surge, cap, .git HEAD
 * drift). Most stops exit silently. When the trigger fires:
 *
 *   descent/surge → NON-BLOCKING: the capture payload is written to a pending
 *     file; kb-recall.mjs (UserPromptSubmit) delivers it with the user's next
 *     prompt. The stop itself is never blocked — no more answer-then-homework
 *     agitation (upstream #76721 sidestepped).
 *   cap / head-drift → BLOCKING Stop (backlog rescue / commit boundary): the
 *     payload rides the classic block decision.
 *   SubagentStop → BLOCKING as before (a subagent has no next prompt); the
 *     restate-deliverable tail prevents the #61 return-value hijack.
 *
 * The payload (hooks/capture-payload.mjs) is the finalized v5 checklist:
 * worklist + decide-time rules only; spec formats live behind `kb write`.
 * Worklists annotate per file: evidence tier, existing-note state (from
 * `kb status --json`), and "no consumers in import graph" (from `coldstart
 * consumers --json`, fail-open — surfacing the graph's blind spot so agents
 * know when an observed usage fact is worth recording).
 *
 * Hooks never author or parse markdown — all note facts come from `coldstart
 * kb`. Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";

import { extractEvidence, segmentStats } from "./evidence.mjs";
import { initialState, step } from "./trigger.mjs";
import { loadIgnore } from "./ignore.mjs";
import { buildCapturePayload } from "./capture-payload.mjs";
import {
  worklistEntries, freshNotedSet, gitHead, logCaptureEvent, writePendingCapture,
} from "./elicit-core.mjs";

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
    const root = String(input.cwd || "");
    setLogRoot(root);

    // Guard 1: already inside a hook-induced continuation → let it stop.
    if (input.stop_hook_active === true) { log("SKIP stop_hook_active"); process.exit(0); }

    // Guard 0: no identifiable session → fail open.
    const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!sid) { log("SKIP no-session-id"); process.exit(0); }

    const aid = String(input.agent_id || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main";
    const isSubagent = input.hook_event_name === "SubagentStop";

    // On SubagentStop, transcript_path is the PARENT's transcript (confirmed:
    // claude-code#11396); the sub's own lives at
    // <parent-transcript-stem>/subagents/agent-<agent_id>.jsonl.
    let transcriptPath = String(input.transcript_path || "");
    if (isSubagent) {
      const own = String(input.agent_transcript_path || "") ||
        (aid !== "main" && transcriptPath
          ? join(transcriptPath.replace(/\.jsonl$/, ""), "subagents", `agent-${aid}.jsonl`)
          : "");
      if (!own || !existsSync(own)) {
        log(`SKIP subagent-transcript-missing session=${sid} agent=${aid} tried=${own || "n/a"}`);
        process.exit(0);
      }
      transcriptPath = own;
    }
    if (!transcriptPath || !existsSync(transcriptPath)) { log("SKIP no-transcript"); process.exit(0); }

    const ignore = loadIgnore(root);
    const marker = join(tmpdir(), `coldstart-kb-${sid}-${aid}.json`);
    let state = null;
    try {
      const parsed = JSON.parse(readFileSync(marker, "utf8"));
      if (parsed && parsed.v === 2) state = parsed;
    } catch { /* first Stop of this session (or a pre-v5 marker: start fresh) */ }
    if (!state) state = initialState();

    // This stop's transcript slice (everything since the last processed line).
    const text = readFileSync(transcriptPath, "utf8");
    const lines = text.split("\n");
    // A transcript SHORTER than our stored offset was replaced out from under us
    // — Claude Code's /compact rewrites it far shorter (also log rotation). The
    // offset now points past the end, so slice() would return an empty segment
    // and silently drop this turn's (and every later turn's) evidence until the
    // line count grows back. Reset to reprocess the new transcript from its start.
    if (state.lineCount > lines.length) state.lineCount = 0;
    const segment = lines.slice(state.lineCount).join("\n");
    state.lineCount = lines.length;

    // Evidence: contentRead tiers only, ignore-filtered. Mentions never count.
    const raw = extractEvidence(segment, root);
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
      logCaptureEvent(root, { event: "fire", reason: "subagent", session: sid, agent: aid, files: fresh.length });
      log(`FIRE subagent session=${sid} agent=${aid} files=${fresh.length}`);
      process.stdout.write(JSON.stringify({ decision: "block", reason: payload }));
      process.exit(0);
    }

    // --- Main path: trigger state machine -------------------------------------
    const head = gitHead(root);
    const headDrift = Boolean(state.head && head && head !== state.head);
    state.head = head || state.head;

    const stats = segmentStats(segment);
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
      score: decision.score, files: decision.files.length, stop: next.stop, fires: next.fires,
    });
    log(`FIRE ${decision.fire} mode=${decision.mode} session=${sid} score=${decision.score} files=${decision.files.length}`);

    if (decision.mode === "block") {
      const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "block" });
      process.stdout.write(JSON.stringify({ decision: "block", reason: payload }));
    } else {
      // Non-blocking: kb-recall delivers this with the user's next prompt.
      const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "inject" });
      writePendingCapture(sid, decision.fire, payload);
    }
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
