#!/usr/bin/env node
/**
 * cursor-find-nudge.mjs — Cursor postToolUse entry. Emits search nudges + registers
 * successful find keys for the preToolUse guard.
 * Wire as: node <abs>/cursor-find-nudge.mjs   (hook: postToolUse)
 *
 * Top-level imports stay node:-builtin-only (via run-hook); the real handler is
 * dynamic-imported inside the thunk so its parse-time errors are caught + fail-open.
 */
import { runHook } from "./cursor-run-hook.mjs";

await runHook(async (input) => {
  const { default: handle } = await import("./cursor-nudge-handler.mjs");
  return handle(input);
});
