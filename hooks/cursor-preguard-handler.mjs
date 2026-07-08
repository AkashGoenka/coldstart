/**
 * cursor-preguard-handler.mjs — Cursor preToolUse guard for `coldstart find`.
 *
 * Same policy as the Codex/Claude preguard: an EXACT re-run of a `coldstart find`
 * already run successfully this session is provably redundant on a static index,
 * so we DENY it before it costs a generation. See codex-preguard-handler.mjs for
 * the full rationale — the DETECTION logic is shared and reused verbatim here.
 *
 * Cursor-specific work is only at the boundary:
 *   - INPUT  : adaptCursorInput renames Shell→Bash / normalizes the MCP tool name
 *              so the shared canonical-find-key logic runs unchanged.
 *   - OUTPUT : Cursor's preToolUse envelope is `{permission:"deny", agent_message}`,
 *              not Codex's `hookSpecificOutput.permissionDecision`. We re-wrap.
 *
 * State (seen_find_queries in /tmp/find_nudge_<session>.json) is shared with the
 * nudge, exactly as on the other platforms. Fail-open: null → the call proceeds.
 */

import { adaptCursorInput } from "./cursor-input.mjs";
import codexPreguard from "./codex-preguard-handler.mjs";

/**
 * @param {any} input parsed Cursor preToolUse stdin payload
 * @returns {object|null} a Cursor deny envelope, or null to allow
 */
export default function handle(input) {
  const decision = codexPreguard(adaptCursorInput(input));
  if (!decision) return null;

  const reason =
    decision.hookSpecificOutput && decision.hookSpecificOutput.permissionDecisionReason;
  if (!reason) return null;

  return {
    permission: "deny",
    agent_message: reason, // model-facing: why the call was blocked + what to do
    user_message: "coldstart: blocked an exact duplicate `find` (result already in context).",
  };
}
