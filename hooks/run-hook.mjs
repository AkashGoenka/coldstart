#!/usr/bin/env node
/**
 * run-hook.mjs — crash-resilient wrapper for coldstart Claude Code hook entries.
 *
 * Adapted from context-mode's run-hook.mjs (MIT). The whole point: a coldstart
 * hook must NEVER block a tool call or spam the user, no matter what breaks —
 * a parse error, a missing dep, a malformed stdin payload, a thrown handler.
 * Claude Code surfaces a non-zero hook exit as a "non-blocking hook error" on
 * EVERY matching tool call, so a single bad deploy would nag the user forever.
 * This wrapper guarantees exit 0 and fail-open (no output = no decision = the
 * tool proceeds normally) on any failure.
 *
 * Three layers of protection:
 *   1. This file imports ONLY node: built-ins, so it cannot fail at parse time.
 *   2. process-level uncaughtException / unhandledRejection nets, installed
 *      before any handler runs, catch async throws the try/catch would miss.
 *   3. The handler is invoked inside a try; any throw is logged and we exit 0.
 *      Load your real handler via dynamic import INSIDE the handler thunk so its
 *      own parse-time import errors are caught here too (see usage below).
 *
 * Failures log to <configDir>/coldstart/hook-errors.log, where configDir honors
 * $CLAUDE_CONFIG_DIR (incl. a leading ~) and falls back to ~/.claude.
 *
 * Usage — keep the entry file's top-level imports to node: built-ins only:
 *     #!/usr/bin/env node
 *     import { runHook } from "./run-hook.mjs";
 *     await runHook(async (input) => {
 *       const { default: handle } = await import("./pretooluse-handler.mjs");
 *       return handle(input); // return an object → printed as JSON to stdout
 *     });
 *
 * The handler receives the parsed stdin payload (or {} if stdin was empty/bad)
 * and may return:
 *   - undefined / null  → no stdout (fail-open: tool proceeds)
 *   - a string          → written to stdout verbatim
 *   - an object         → JSON.stringify'd to stdout (e.g. a PreToolUse
 *                         permissionDecision, or PostToolUse additionalContext)
 */

import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";

// Inlined so this wrapper stays dependency-free (parse-time-proof).
function resolveClaudeConfigDir() {
  const envVal = process.env.CLAUDE_CONFIG_DIR;
  if (envVal) {
    if (envVal.startsWith("~")) return join(homedir(), envVal.replace(/^~[/\\]?/, ""));
    return envVal;
  }
  return resolve(homedir(), ".claude");
}

function logError(err) {
  try {
    const dir = resolve(resolveClaudeConfigDir(), "coldstart");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] pid=${process.pid} ${err?.stack || err?.message || String(err)}\n`;
    appendFileSync(resolve(dir, "hook-errors.log"), line);
  } catch {
    /* never fail logging */
  }
}

// Safety nets BEFORE any handler code runs. Static top-level imports in the
// ENTRY file would bypass these, which is why the entry must dynamic-import its
// real handler from inside the thunk.
process.on("uncaughtException", (err) => {
  logError(err);
  process.exit(0);
});
process.on("unhandledRejection", (err) => {
  logError(err);
  process.exit(0);
});

/** Read all of stdin. Resolves to "" if stdin is closed/empty. */
function readStdin() {
  return new Promise((res) => {
    let data = "";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      res(data);
    };
    try {
      if (process.stdin.isTTY) return done();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", done);
      process.stdin.on("error", done);
      // Hard ceiling so a wedged pipe can never hang the tool call.
      setTimeout(done, 2000).unref?.();
    } catch {
      done();
    }
  });
}

/**
 * Run a hook handler with full crash-resilience. Reads + parses stdin, invokes
 * the handler, prints its return value, and ALWAYS exits 0.
 *
 * @param {(input: any) => Promise<unknown> | unknown} handler
 */
export async function runHook(handler) {
  let input = {};
  try {
    const raw = await readStdin();
    if (raw && raw.trim()) input = JSON.parse(raw);
  } catch (e) {
    // Malformed/absent payload is non-fatal — hand the handler {} and let it
    // decide. Most handlers no-op without the fields they need.
    logError(e);
  }

  try {
    const out = await handler(input);
    if (out == null) {
      // fail-open / no-op: emit nothing, tool proceeds normally.
    } else if (typeof out === "string") {
      process.stdout.write(out);
    } else {
      process.stdout.write(JSON.stringify(out));
    }
  } catch (e) {
    logError(e);
    // Swallow: no stdout means no hook decision → the tool is not blocked.
  }
  process.exit(0);
}
