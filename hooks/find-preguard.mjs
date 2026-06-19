#!/usr/bin/env node
/**
 * find-preguard.mjs — PreToolUse entry. DENIES an exact `coldstart find` re-run.
 * Wire as: node <abs>/find-preguard.mjs   (matcher: Bash, PreToolUse)
 *
 * Top-level imports stay node:-builtin-only (via run-hook); the real handler is
 * dynamic-imported inside the thunk so its parse-time errors are caught + fail-open.
 */
import { runHook } from "./run-hook.mjs";

await runHook(async (input) => {
  const { default: handle } = await import("./preguard-handler.mjs");
  return handle(input);
});
