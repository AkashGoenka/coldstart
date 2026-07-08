/**
 * cursor-nudge-handler.mjs — Cursor postToolUse nudge for `find`/`gs`, CLI + MCP.
 *
 * The DETECTION logic (the 6 search-behaviour detectors + the seen_find_queries
 * registration that the preguard denies against) is shared and reused verbatim
 * from codex-nudge-handler.mjs. See that file for the detector documentation.
 *
 * Cursor-specific work is only at the boundary:
 *   - INPUT  : adaptCursorInput renames Shell→Bash, normalizes the MCP tool name,
 *              and sets cwd from workspace_roots — so every regex/threshold and the
 *              shared state file (/tmp/find_nudge_<session>.json) work unchanged.
 *   - OUTPUT : Cursor's postToolUse envelope is a top-level `{additional_context}`,
 *              not Codex's `hookSpecificOutput.additionalContext`. We re-wrap.
 *
 * Fail-open: null → no nudge.
 */

import { adaptCursorInput } from "./cursor-input.mjs";
import codexNudge from "./codex-nudge-handler.mjs";

/**
 * @param {any} input parsed Cursor postToolUse stdin payload
 * @returns {object|null} a Cursor additional_context envelope, or null
 */
export default function handle(input) {
  const result = codexNudge(adaptCursorInput(input));
  if (!result) return null;

  const ctx = result.hookSpecificOutput && result.hookSpecificOutput.additionalContext;
  if (!ctx) return null;

  return { additional_context: ctx };
}
