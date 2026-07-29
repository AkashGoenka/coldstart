/**
 * recall-query.mjs — turn a raw UserPromptSubmit payload into a recall QUERY.
 *
 * The hosts do not hand us the user's words. They hand us the user's words
 * WRAPPED IN HARNESS TELEMETRY: the file that happens to be open in the editor,
 * the current selection, a finished subagent's summary, the expansion of a
 * slash command. That text is file- and symbol-rich, so `kb search --hook`
 * treats it as if the user had named those files — most damagingly through the
 * path-name override in src/kb/search.ts, which boosts a note past every
 * eligibility gate when the query string contains its anchor path. A stale-open
 * editor tab then hijacks recall for turns at a time.
 *
 * So: strip the wrappers (tag AND content) before the query is built, and
 * before truncation — a 1.5KB <ide_selection> ahead of a short question would
 * otherwise eat the whole MAX_QUERY_CHARS budget and leave the real ask cut off.
 *
 * Only a NAMED set of tags is stripped. Anything else — including XML or HTML
 * the user pasted deliberately — is left alone; over-stripping would silently
 * drop real questions, which is the failure this is meant to prevent.
 *
 * Fail-open: on any error the raw text is returned unchanged.
 */

/** Harness-emitted wrappers, union across Claude Code / Cursor / Codex. A tag
 *  a given host never emits simply never matches. */
export const HARNESS_TAGS = [
  // Claude Code
  "system-reminder",
  "ide_opened_file",
  "ide_selection",
  "ide_diagnostics",
  "task-notification",
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "command-name",
  "command-message",
  "command-args",
  "user-prompt-submit-hook",
  // Cursor
  "browser_instruction",
  // Codex
  "environment_context",
  "user_instructions",
];

const NAMES = HARNESS_TAGS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// Well-formed pair, content included. Non-greedy, /s so it spans newlines.
const PAIRED = new RegExp(`<(${NAMES})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
// Leftovers: self-closing, or a lone open/close tag from a truncated payload.
const LONE = new RegExp(`<\\/?(?:${NAMES})(?:\\s[^>]*)?\\/?>`, "gi");

/**
 * Strip harness wrappers from a raw prompt.
 * @param {string} raw
 * @returns {string} the user's own text; "" when nothing but telemetry remains.
 */
export function stripHarnessWrappers(raw) {
  try {
    let s = String(raw ?? "");
    if (!s) return "";
    // Nested wrappers (a system-reminder inside a task-notification) need more
    // than one pass; bounded so a pathological payload cannot spin.
    for (let i = 0; i < 4; i++) {
      const next = s.replace(PAIRED, " ");
      if (next === s) break;
      s = next;
    }
    return s.replace(LONE, " ").replace(/[ \t]+/g, " ").trim();
  } catch {
    return String(raw ?? "");
  }
}

/**
 * The full prompt → query pipeline: strip, THEN truncate.
 * @param {string} raw raw `input.prompt`
 * @param {number} maxChars
 * @returns {string} "" when there is nothing left to search for.
 */
export function recallQuery(raw, maxChars) {
  return stripHarnessWrappers(raw).slice(0, maxChars).trim();
}
