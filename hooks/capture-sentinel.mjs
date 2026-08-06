/**
 * capture-sentinel.mjs — the marker `/capture-notes` command bodies carry so a
 * host's own pre-prompt recall hook can recognize "this submitted prompt IS
 * the capture command" and run `kb-elicit.mjs --manual` itself with the real
 * session id it already has (Cursor/Codex have no way to pass a session id
 * INTO the command the way Claude's `!`-expansion does). Wording in the
 * command body can drift; this string must not — it is grepped verbatim
 * against the raw submitted prompt.
 */
export const CAPTURE_SENTINEL = "<!-- coldstart:capture-notes -->";
