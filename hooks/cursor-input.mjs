/**
 * cursor-input.mjs — adapt a Cursor hook payload into the neutral shape the
 * shared detectors (canonical-find-key.mjs, coldstart-call.mjs, the nudge/preguard
 * cores) already understand.
 *
 * The detector core was written against the Claude/Codex payload surface, which
 * Cursor mostly matches (snake_case tool_input/tool_output/session_id). Cursor
 * diverges in exactly three places, all handled here so the core stays untouched:
 *
 *   1. Shell tool name — Cursor calls terminal commands `Shell`; the detectors
 *      key on `tool === "Bash"`. We rename Shell → Bash. (Read/Grep/Glob pass
 *      through unchanged.)
 *   2. MCP tool name — Cursor's MCP tool name differs from Codex's
 *      `mcp__coldstart__<tool>`. We normalize a coldstart find/gs MCP call to that
 *      canonical name so normalizeColdstartCall picks it up. NOTE: Cursor's exact
 *      MCP tool_name convention is unconfirmed (no MCP-experience probe yet); the
 *      matcher below is deliberately broad and is the one knob to revisit.
 *   3. Repo root — Cursor supplies `workspace_roots` (array), not `cwd`, on most
 *      events. We derive a single `cwd` for the core (which reads input.cwd).
 *
 * The OUTPUT envelope differs too, but that is re-wrapped by each handler, not here.
 */

const CANON_FIND = "mcp__coldstart__find";
const CANON_GS = "mcp__coldstart__gs";

/** Best-effort: is this Cursor MCP tool_name a coldstart find/gs call? */
function canonicalMcpName(toolName, toolInput) {
  const n = String(toolName || "").toLowerCase();
  if (!n.includes("coldstart")) return null; // only touch obviously-coldstart MCP tools
  const tin = toolInput && typeof toolInput === "object" ? toolInput : {};
  if (n.endsWith("find") || "query" in tin || "domain_filter" in tin) return CANON_FIND;
  if (n.endsWith("gs") || "file_path" in tin || "file" in tin) return CANON_GS;
  return null;
}

/** The repo root Cursor is operating on. */
export function cursorRoot(input) {
  if (input && typeof input.cwd === "string" && input.cwd) return input.cwd;
  const roots = input && input.workspace_roots;
  if (Array.isArray(roots) && roots.length && typeof roots[0] === "string") return roots[0];
  return "";
}

/**
 * Return a shallow copy of the Cursor payload with `tool_name`, `cwd`, and
 * `agent_id` normalized to the neutral shape. tool_input / tool_output /
 * session_id / prompt / transcript_path are already compatible and pass through.
 *
 * @param {any} input parsed Cursor hook stdin payload
 * @returns {any} neutral-shaped payload for the shared detectors
 */
export function adaptCursorInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const tin = src.tool_input && typeof src.tool_input === "object" ? src.tool_input : {};

  let toolName = String(src.tool_name || "");
  const mcp = canonicalMcpName(toolName, tin);
  if (mcp) {
    toolName = mcp;
  } else if (toolName === "Shell") {
    toolName = "Bash";
  }

  return {
    ...src,
    tool_name: toolName,
    cwd: cursorRoot(src),
    // Cursor scopes subagents via subagent_id; main-loop events have none → "".
    agent_id: String(src.agent_id || src.subagent_id || ""),
  };
}
