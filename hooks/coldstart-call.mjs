/**
 * coldstart-call.mjs — normalize a tool call into the shape the detectors expect.
 *
 * coldstart is reachable two ways with IDENTICAL semantics:
 *   - CLI  : Bash `coldstart find <terms>` / `coldstart gs <file> --symbol <s>`
 *   - MCP  : tools `mcp__coldstart__find {query}` / `mcp__coldstart__gs {file_path,...}`
 *
 * The nudge/preguard detectors were written against the CLI surface: they key on
 * `tool === "Bash"` and run regexes over the command STRING. Rather than fork the
 * detector logic per surface, this normalizer rewrites an MCP coldstart call into
 * the equivalent CLI command string and reports it as a Bash call. Every downstream
 * regex (FIND_RE/GS_RE/GS_FILE_RE/SEARCH_RE) and the canonical-find-key then run
 * UNCHANGED — same logic, regardless of which surface the agent used.
 *
 * Non-coldstart calls pass through untouched (tool name + `tool_input.command`).
 *
 * The MCP tool name is `mcp__<serverKey>__<tool>`; the benchmark wires coldstart
 * under the server key `coldstart` (see the arm's `.mcp.json`). If you key it
 * differently, change MCP_SERVER_KEY below — that is the only surface-specific knob.
 */

const MCP_SERVER_KEY = "coldstart";
const MCP_FIND = `mcp__${MCP_SERVER_KEY}__find`;
const MCP_GS = `mcp__${MCP_SERVER_KEY}__gs`;

function str(v) {
  return typeof v === "string" ? v : "";
}

/**
 * @param {string} toolName  input.tool_name
 * @param {any}    toolInput input.tool_input (already coerced to {} if missing)
 * @returns {{ tool: string, cmd: string }}
 *   For an MCP coldstart find/gs call: { tool: "Bash", cmd: "<synthesized CLI command>" }.
 *   For anything else: { tool: <toolName>, cmd: <tool_input.command or ""> }.
 */
export function normalizeColdstartCall(toolName, toolInput) {
  const tin = toolInput && typeof toolInput === "object" ? toolInput : {};

  if (toolName === MCP_FIND) {
    // find accepts `query` (alias `domain_filter`); `path` scopes it (folded into the dedup key).
    const query = str(tin.query) || str(tin.domain_filter);
    const path = str(tin.path) ? ` --path ${str(tin.path)}` : "";
    return { tool: "Bash", cmd: `coldstart find ${query}${path}`.trim() };
  }

  if (toolName === MCP_GS) {
    // gs needs the file as the first token after `gs` (GS_FILE_RE), plus the flags
    // that the detectors look at (--symbol drives the slice/re-guess detectors).
    const file = str(tin.file_path) || str(tin.file) || str(tin.file_name);
    const symbol = str(tin.symbol) ? ` --symbol ${str(tin.symbol)}` : "";
    const match = str(tin.match) ? ` --match ${str(tin.match)}` : "";
    const view = str(tin.view) ? ` --view ${str(tin.view)}` : "";
    return { tool: "Bash", cmd: `coldstart gs ${file}${symbol}${match}${view}`.trim() };
  }

  return { tool: toolName || "", cmd: str(tin.command) };
}
