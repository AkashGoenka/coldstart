#!/usr/bin/env node
/**
 * cursor-find-preguard.mjs — Cursor preToolUse entry for exact find re-runs.
 * Wire as: node <abs>/cursor-find-preguard.mjs   (hook: preToolUse)
 *
 * Top-level imports stay node:-builtin-only (via run-hook); the real handler is
 * dynamic-imported inside the thunk so its parse-time errors are caught + fail-open.
 */
import { runHook } from "./cursor-run-hook.mjs";

await runHook(async (input) => {
  const { default: handle } = await import("./cursor-preguard-handler.mjs");
  return handle(input);
});
