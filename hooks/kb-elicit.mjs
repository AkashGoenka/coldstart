#!/usr/bin/env node
/**
 * kb-elicit.mjs — Stop + SubagentStop hook. Notebook capture, trigger-timed.
 *
 * v5 (2026-07-17): the always-fire gate is gone. Every Stop updates per-file
 * EVIDENCE RECORDS (hooks/evidence.mjs — edit/read/gs tiers; mentions and
 * .coldstartignore'd files never count) and advances the TRIGGER state machine
 * (hooks/trigger.mjs — score/arm, fire on descent, cap, .git HEAD
 * drift). Most stops exit silently. When the trigger fires:
 *
 *   descent → NON-BLOCKING: the capture payload is written to a pending
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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";

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

// --- Subagent transcript resolution ------------------------------------------
/**
 * Resolve a subagent's transcript, supporting both flat and nested layouts.
 * - Flat: stem/subagents/agent-id.jsonl
 * - Nested (parallel/batched): stem/subagents/workflows/wf_id/agent-id.jsonl
 * Returns "" if the subagents dir is absent or no match is found.
 */
function resolveSubagentTranscript(parentTranscriptPath, agentId) {
  const stem = parentTranscriptPath.replace(/\.jsonl$/, "");
  const flatPath = join(stem, "subagents", `agent-${agentId}.jsonl`);

  // First try flat path.
  if (existsSync(flatPath)) return flatPath;

  // Recursive search for nested layout.
  const filename = `agent-${agentId}.jsonl`;
  const subagentsDir = join(stem, "subagents");
  try {
    if (!existsSync(subagentsDir)) return "";
    // Use recursive option to walk all depths.
    const entries = readdirSync(subagentsDir, { recursive: true, withFileTypes: false });
    for (const entry of entries) {
      if (typeof entry === "string" && entry.endsWith(filename)) {
        const fullPath = join(subagentsDir, entry);
        if (existsSync(fullPath)) return fullPath;
      }
    }
  } catch { /* permission/read error: return empty */ }
  return "";
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

// --- Manual capture (`--manual --root <dir>`) --------------------------------
// The `/capture-notes` command runs this to fire capture ON DEMAND, bypassing
// the trigger score gate. There is no hook stdin, so we self-discover the
// session: the freshest marker in tmpdir whose recorded (relative) files still
// resolve under <root> is this repo's active session. We then emit the SAME
// capture payload an automatic fire would, built from accumulated evidence.
// READ-ONLY — never mutates the marker, so it cannot perturb automatic firing.
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function markerMtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }
function freshestMarkerUnderRoot(root) {
  let names;
  try { names = readdirSync(tmpdir()); } catch { return null; }
  const markers = names
    .filter((n) => /^coldstart-kb-.+-main\.json$/.test(n))
    .map((n) => ({ n, p: join(tmpdir(), n), mtime: 0 }))
    .map((m) => ({ ...m, mtime: markerMtime(m.p) }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const m of markers) {
    let state;
    try { state = JSON.parse(readFileSync(m.p, "utf8")); } catch { continue; }
    const files = state && state.files ? Object.keys(state.files) : [];
    if (!files.length) continue;
    // Belongs to THIS repo iff a recorded file still resolves under root.
    if (files.some((rel) => existsSync(join(root, rel)))) {
      return { sid: m.n.slice("coldstart-kb-".length, -"-main.json".length), state };
    }
  }
  return null;
}
if (process.argv.includes("--manual")) {
  try {
    const rootArg = argValue("--root");
    const root = rootArg ? resolve(rootArg) : process.cwd();
    setLogRoot(root);
    const found = freshestMarkerUnderRoot(root);
    if (!found) {
      process.stdout.write(
        "No notebook-capture evidence for this repo yet — it accrues as you read and edit files.\n" +
        "Do a turn or two of real work here, then run /capture-notes again.\n",
      );
      log(`MANUAL no-marker root=${root}`);
      process.exit(0);
    }
    const { sid, state } = found;
    const files = Object.keys(state.files).filter((rel) => !state.files[rel].captured);
    if (!files.length) {
      process.stdout.write("Everything worked on so far is already captured — nothing new to write right now.\n");
      log(`MANUAL nothing-new session=${sid}`);
      process.exit(0);
    }
    const entries = worklistEntries(CLI, root, files, state.files, log);
    const payload = buildCapturePayload({ root, cli: CLI, sid, entries, envelope: "manual" });
    logCaptureEvent(root, { event: "fire", reason: "manual", session: sid, files: files.length });
    log(`FIRE manual session=${sid} files=${files.length}`);
    process.stdout.write(payload + "\n");
    process.exit(0);
  } catch (e) {
    log(`MANUAL error ${e?.stack || e}`);
    process.stdout.write("Could not assemble a capture worklist right now.\n");
    process.exit(0);
  }
}

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

    // Guard: compaction subagents read transcripts, not code—skip silently.
    if (isSubagent && aid.startsWith("acompact")) {
      log(`SKIP compaction-agent session=${sid} agent=${aid}`);
      process.exit(0);
    }

    // On SubagentStop, transcript_path is the PARENT's transcript (confirmed:
    // claude-code#11396); the sub's own lives at stem/subagents/agent-id.jsonl
    // (flat) or stem/subagents/workflows/wf_id/agent-id.jsonl (nested).
    let transcriptPath = String(input.transcript_path || "");
    if (isSubagent) {
      const own = String(input.agent_transcript_path || "") ||
        (aid !== "main" && transcriptPath
          ? resolveSubagentTranscript(transcriptPath, aid)
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
    const freshMarker = !state; // no valid prior marker: we're attaching, not resuming our own place
    if (!state) state = initialState();

    // This stop's transcript slice (everything since the last processed line).
    const text = readFileSync(transcriptPath, "utf8");
    const lines = text.split("\n");
    // A newline-terminated transcript splits to a phantom trailing "" — counting
    // it as a consumed line would push the offset one past the last real line and
    // silently skip the FIRST line appended next stop (dropping a tool_use → its
    // file's evidence). Trim it so the offset tracks real lines only.
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    // A transcript SHORTER than our stored offset was replaced out from under us
    // — Claude Code's /compact rewrites it far shorter (also log rotation). The
    // offset now points past the end, so slice() would return an empty segment
    // and silently drop this turn's (and every later turn's) evidence until the
    // line count grows back. Reset to reprocess the new transcript from its start.
    if (state.lineCount > lines.length) state.lineCount = 0;

    // Fresh attach to an ALREADY-LARGE transcript → baseline, fire NOTHING.
    // When the OS clears the tmp marker between days, the next Stop starts fresh
    // but the on-disk transcript still holds the WHOLE session. Reprocessing it
    // from line 0 treats all of history as this turn's work and dumps the entire
    // file set into one cap "blob" (the stop=1 cap fires we saw on resumed
    // sessions). A genuine first Stop, by contrast, has a tiny transcript (this
    // turn only) and must still be processed so its evidence can build toward
    // arming. So baseline ONLY when a fresh marker meets a large transcript:
    // snapshot the offset + HEAD and start watching from here. Subagents keep
    // their own one-shot path below (a fresh aid-marker is normal — never baseline).
    const RESUMED_ATTACH_LINES = 400; // a first turn is tens of lines; a resume is thousands
    if (freshMarker && !isSubagent && lines.length > RESUMED_ATTACH_LINES) {
      state.lineCount = lines.length;
      state.head = gitHead(root) || state.head;
      writeFileSync(marker, JSON.stringify(state));
      logCaptureEvent(root, { event: "baseline", session: sid, lines: lines.length });
      log(`BASELINE fresh-marker-large-transcript session=${sid} lines=${lines.length}`);
      process.exit(0);
    }

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
