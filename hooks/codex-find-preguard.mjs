#!/usr/bin/env node
/**
 * codex-find-preguard.mjs — Codex PreToolUse entry for exact find re-runs.
 * Wire as: node <abs>/find-preguard.mjs   (matcher: Bash, PreToolUse)
 *
 * Top-level imports stay node:-builtin-only (via run-hook); the real handler is
 * dynamic-imported inside the thunk so its parse-time errors are caught + fail-open.
 */
import { runHook } from "./codex-run-hook.mjs";

await runHook(async (input) => {
  const { default: handle } = await import("./codex-preguard-handler.mjs");
  return handle(input);
});
