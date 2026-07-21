#!/usr/bin/env node
/**
 * codex-kb-elicit.mjs — Codex Stop + SubagentStop notebook capture, v5
 * evidence (ported 2026-07-17; the v4 path-mention walker is gone).
 *
 * HOST CONSTRAINT: Codex's Stop does NOT fire per turn — in the TUI it fires
 * once at session EXIT, and `codex exec` is one Stop by construction
 * (confirmed live 2026-07-13). A multi-stop trigger (arm/descent) has
 * nothing to time against here, and a pending-file handoff has no next prompt
 * to ride. So Codex capture is ONE-SHOT: at the session's single Stop, build
 * the v5 worklist and deliver it BLOCKING ({decision:"block"} re-prompts the
 * agent before exit). If Codex ever moves to per-turn Stops, port the trigger
 * machine from cursor-kb-elicit.mjs — the evidence/state plumbing here is
 * already shaped for it.
 *
 * What v5 changes vs the old walker:
 *   - EVIDENCE TIERS, result-confirmed: extractCodexEvidence pairs
 *     custom_tool_call → *_output by call_id and classifies the shell commands
 *     inside tools.exec_command (read verbs vs sed -i vs mentions) +
 *     apply_patch file headers as edits. Grep/path mentions NEVER make the
 *     worklist (v4's biggest noise source).
 *   - .coldstartignore filtering at the evidence layer.
 *   - The v5 checklist payload (capture-payload.mjs) with per-file tier +
 *     note-state + consumers annotations — same as Claude/Cursor.
 *   - Session-cumulative marker (v2 state, lineCount-sliced): a resumed thread
 *     only offers files not already offered.
 *
 * Self-contained + fail-open: ANY error → exit 0 → the stop is allowed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";

import { extractCodexEvidence } from "./evidence.mjs";
import { loadIgnore } from "./ignore.mjs";
import { buildCapturePayload } from "./capture-payload.mjs";
import { worklistEntries, logCaptureEvent } from "./elicit-core.mjs";

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

    const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!sid) { log("SKIP no-session-id"); process.exit(0); }

    const aid = String(input.agent_id || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main";
    const isSubagent = input.hook_event_name === "SubagentStop";

    // Codex supplies the child's own rollout as agent_transcript_path on
    // SubagentStop. Its transcript_path is the parent's rollout at that event.
    let transcriptPath = String(input.transcript_path || "");
    if (isSubagent) {
      const own = String(input.agent_transcript_path || "");
      if (!own || !existsSync(own)) {
        log(`SKIP subagent-transcript-missing session=${sid} agent=${aid} tried=${own || "n/a"}`);
        process.exit(0);
      }
      transcriptPath = own;
    }
    // Ephemeral Codex runs deliberately expose no transcript path. Fail open.
    if (!transcriptPath || !existsSync(transcriptPath)) { log("SKIP no-transcript"); process.exit(0); }

    const ignore = loadIgnore(root);
    // Session-cumulative v2 state: which files were already offered, and how
    // far into the rollout the last Stop read (a resumed thread appends).
    const marker = join(tmpdir(), `coldstart-codex-kb-${sid}-${aid}.json`);
    let state = null;
    try {
      const parsed = JSON.parse(readFileSync(marker, "utf8"));
      if (parsed && parsed.v === 2) state = parsed;
    } catch { /* first Stop of this session (or a pre-v5 marker: start fresh) */ }
    if (!state) state = { v: 2, lineCount: 0, files: {} };

    const text = readFileSync(transcriptPath, "utf8");
    const lines = text.split("\n");
    const segment = lines.slice(state.lineCount).join("\n");
    state.lineCount = lines.length;

    // Evidence: contentRead tiers only, ignore-filtered. Mentions never count.
    const raw = extractCodexEvidence(segment, root);
    const offered = new Set(Object.keys(state.files));
    const fresh = [];
    for (const [rel, r] of raw) {
      if (r.reads + r.edits + r.gs === 0) continue;
      if (ignore(rel)) continue;
      if (offered.has(rel)) continue;
      fresh.push(rel);
      state.files[rel] = { ...r, captured: true };
    }
    // Most-worked first, same ranking as contentReadFiles.
    fresh.sort((a, b) => (state.files[b].edits - state.files[a].edits) || (state.files[b].events - state.files[a].events));
    writeFileSync(marker, JSON.stringify(state));

    if (!fresh.length) {
      log(`FAST-EXIT no-new-files session=${sid} agent=${aid} event=${input.hook_event_name || "?"}`);
      process.exit(0);
    }

    const entries = worklistEntries(CLI, root, fresh, state.files, log);
    const payload = buildCapturePayload({
      root, cli: CLI, sid, entries,
      envelope: isSubagent ? "subagent" : "block",
    });
    logCaptureEvent(root, {
      event: "fire", reason: isSubagent ? "subagent" : "session-end", session: sid,
      agent: aid, files: fresh.length, host: "codex",
    });
    log(`FIRE ${isSubagent ? "subagent" : "session-end"} session=${sid} agent=${aid} files=${fresh.length} promptBytes=${payload.length}`);
    process.stdout.write(JSON.stringify({ decision: "block", reason: payload }));
  } catch (e) {
    log(`handler ${e?.stack || e}`); // fail-open: no stdout → stop allowed
  }
  process.exit(0);
})();
