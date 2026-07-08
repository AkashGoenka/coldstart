/**
 * codex-preguard-handler.mjs — Codex PreToolUse guard for `coldstart find`.
 *
 * `coldstart find` is a PURE function of its term-SET: reordering terms, changing
 * case, or repeating a term yields byte-identical output (every ranking stage is
 * set/sum based, sort is deterministic by score then unique path). So an exact
 * re-query is PROVABLY redundant on a static index: its result is already in the
 * agent's context. This handler canonicalizes a PROPOSED find (lowercase → dedup
 * → SORT terms, + significant flags) and, if that canonical key was already run
 * SUCCESSFULLY this session, DENIES the call before it costs a generation.
 *
 * Safety:
 *   - Only EXACT term-set+flag matches are blocked. Add/drop a term, or change
 *     --path/--tests, and it's a different query that legitimately differs → allowed.
 *   - Registration happens in the PostToolUse hook (find-nudge) and ONLY on a
 *     successful, non-empty result — so retrying a FAILED/empty find is never blocked.
 *   - Flags are folded into the key, so a scoped re-query (`--path ...`) never
 *     collides with the unscoped one. Bias is toward specificity: a missed dup just
 *     falls back to the PostToolUse late-catch; a false block is the error we avoid.
 *   - Fail-open: any error → return null and the call proceeds (runHook swallows).
 *
 * State is shared with find-nudge: /tmp/find_nudge_{session}_{agent}.json,
 * list key `seen_find_queries`.
 *
 * Ported 1:1 from find-preguard.py.
 */

import { readFileSync } from "node:fs";
import { canonicalFindKey } from "./canonical-find-key.mjs";
import { normalizeColdstartCall } from "./coldstart-call.mjs";

const REASON =
  "You have ALREADY run this exact `coldstart find` earlier in this session — same " +
  "terms (order/case/repeats don't change the result), same scope. `find` is deterministic " +
  "on a static index, so re-running it returns the IDENTICAL ranked page you already have in " +
  "context. Re-read that earlier find result and answer, or search a GENUINELY different " +
  "term-set (add/drop a salient identifier, or add `--path` to scope it). Do not re-run the " +
  "same query.";

/**
 * @param {any} input parsed PreToolUse stdin payload
 * @returns {object|null} a permissionDecision:"deny" envelope, or null to allow
 */
export default function handle(input) {
  const tin = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  // Normalize so a `mcp__coldstart__find` call is deduped against a CLI `coldstart
  // find` (and vice-versa) using the same canonical key. Non-coldstart Bash falls
  // through to canonicalFindKey, which returns null for anything that isn't a find.
  const { tool, cmd } = normalizeColdstartCall(input.tool_name || "", tin);
  if (tool !== "Bash") return null;
  const key = canonicalFindKey(cmd);
  if (!key) return null;

  const sid = input.session_id || "default";
  const aid = input.agent_id || "";
  const skey = aid ? `${sid}_${aid}` : sid;
  const stateFile = `/tmp/find_nudge_${skey}.json`;

  let st = {};
  try {
    st = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    st = {};
  }
  const seen = Array.isArray(st.seen_find_queries) ? st.seen_find_queries : [];
  if (!seen.includes(key)) return null; // never run before → allow

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: REASON,
    },
  };
}
