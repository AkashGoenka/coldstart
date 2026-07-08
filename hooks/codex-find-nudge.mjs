#!/usr/bin/env node
/**
 * codex-find-nudge.mjs — Codex PostToolUse entry. Emits search nudges + registers
 * successful find keys for the PreToolUse guard.
 * Wire as: node <abs>/find-nudge.mjs   (matcher: *, PostToolUse)
 *
 * Top-level imports stay node:-builtin-only (via run-hook); the real handler is
 * dynamic-imported inside the thunk so its parse-time errors are caught + fail-open.
 */
import { runHook } from "./codex-run-hook.mjs";

await runHook(async (input) => {
  const { default: handle } = await import("./codex-nudge-handler.mjs");
  return handle(input);
});
