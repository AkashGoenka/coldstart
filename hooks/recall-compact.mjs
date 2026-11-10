#!/usr/bin/env node
/**
 * recall-compact.mjs — the compaction hook for ALL three hosts: Claude Code
 * PreCompact, Codex PostCompact, Cursor preCompact.
 *
 * After a compaction the agent's context no longer holds the notes recall
 * showed it (or the notes it wrote), so they must become re-injectable. This
 * hook is the only reset signal: Claude Code transcripts are append-only and
 * the old "transcript shrank" check never fired in real use.
 *
 * Observational only. It prints nothing and ALWAYS exits 0: Codex's PreCompact
 * treats a non-zero exit as "defer compaction", so even though Codex is wired
 * on PostCompact, a failure here must never be able to block a compaction.
 */

// MUST stay the first import: it only covers regexes created after it.
import "./regex-engine.mjs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { resetSeen } from "./recall-seen.mjs";
import { cursorRoot } from "./cursor-input.mjs";

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

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

(async () => {
  try {
    const raw = await readStdin();
    const input = raw && raw.trim() ? JSON.parse(raw) : {};
    // session_id is what every recall hook keys the seen file on; Cursor also
    // sends conversation_id, the fallback if a build ever omits session_id.
    const sid = String(input.session_id || input.conversation_id || "").replace(/[^\w-]/g, "");
    if (!sid) process.exit(0);
    const cleared = resetSeen(sid);
    const root = cursorRoot(input);
    if (root) {
      try {
        appendFileSync(join(root, ".coldstart", "kb-hook.log"),
          `[${new Date().toISOString()}] recall: compaction (${input.hook_event_name || "?"}, ` +
          `trigger=${input.trigger || "?"}) session=${sid}: cleared ${cleared} seen ids\n`);
      } catch { /* never fail logging */ }
    }
  } catch { /* fail-open */ }
  process.exit(0);
})();
