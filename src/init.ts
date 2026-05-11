/**
 * coldstart-mcp init — Interactive setup for Claude Code and Cursor.
 *
 * Usage: npx coldstart-mcp init
 *
 * Detects IDE from project structure, then writes MCP config and agent rules.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';

const DIVIDER = '─'.repeat(60);

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// Rules content (same for Claude and Cursor)
// ---------------------------------------------------------------------------

const RULES_CONTENT = `# Codebase navigation — coldstart MCP tools

You have 4 MCP tools (\`get-overview\`, \`get-structure\`, \`trace-deps\`, \`trace-impact\`).
Reach for them before Read/Grep/Glob/Bash. Per-tool details are in the tool descriptions — these are the cross-tool rules:

- **Typical flow:** \`get-overview\` → \`get-structure\` (one promising file) → \`trace-deps\` / \`trace-impact\` to expand → \`Read\` only when you need implementation.
- **Stop when data is sufficient.** Don't re-query to confirm what you already found.
- **Fall back to grep** only for string literals, exact call sites, or dynamic dispatch — not as your default discovery method.
`;

// ---------------------------------------------------------------------------
// Skill content (Claude Code only)
// ---------------------------------------------------------------------------

const SKILL_CONTENT = `---
name: trace-files
description: Answer questions about how code works, trace flows, find where things happen, understand architecture, or locate relevant files in an unfamiliar codebase
---

## Instructions

You have 4 coldstart MCP tools. Use them before Read/Grep/Glob/Bash:

- **get-overview**: Find files by keyword/symbol/path. Returns 7 ranked file paths — nothing else.
- **get-structure**: Drill into a candidate file. Returns its symbols + 1-hop internal imports as compact text. Use this AFTER get-overview, BEFORE Read.
- **trace-deps**: For a known file, returns imports/importers (depth 1-3). Use \`direction: "importers"\` to scope refactor blast radius, or raise \`depth\` to reach beyond get-structure's 1 hop.
- **trace-impact**: Find callers/implementors of a specific symbol before refactoring it.

## Exploration strategy

1. Start with \`get-overview\` to shortlist files.
2. Call \`get-structure\` on the most promising candidate to see its shape (symbols + internal imports) before opening it.
3. To expand the graph: \`trace-deps\` for file-level imports/importers; \`trace-impact\` for symbol-level callers.
4. \`Read\` the file only when you need actual implementation details.
5. If results span multiple distinct areas (different top-level directories, separate concerns like UI vs data layer vs API), spawn one sub-agent per area.
6. If results cluster in one area, proceed inline — no sub-agents needed.

When spawning sub-agents, include these instructions in each sub-agent prompt:

> You have coldstart MCP tools available: get-overview, get-structure, trace-deps, trace-impact.
> Use these BEFORE Read/Grep/Glob/Bash.
> Flow: get-overview → get-structure on a candidate → trace-deps/trace-impact to expand → Read only if needed.
> Report file paths with line numbers for all key findings.

## Anti-patterns

- Don't raise \`max_results\` above 7. If the right file isn't in the top 7, refine the query — pagination won't fix a bad query.
- Don't Read a file just to inspect its shape or imports — call \`get-structure\` instead.
- Don't Read a file just to find who imports it — call \`trace-deps\` with \`direction: "importers"\`.
- Don't use \`find\` or \`ls\` via Bash when get-overview can do the job.

## Task

$ARGUMENTS
`;

const MDC_FRONTMATTER = `---
description: Codebase navigation with coldstart MCP tools
alwaysApply: true
---

`;

// ---------------------------------------------------------------------------
// File writers
// ---------------------------------------------------------------------------

function buildMcpEntry(cwd: string) {
  return { command: 'npx', args: ['-y', 'coldstart-mcp', '--root', cwd] };
}

function mergeMcpJson(filePath: string, cwd: string): 'created' | 'merged' {
  let config: Record<string, unknown> = { mcpServers: {} };
  let existed = false;
  if (fs.existsSync(filePath)) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      config = { mcpServers: {} };
    }
    if (!config.mcpServers) config.mcpServers = {};
    existed = true;
  }
  (config.mcpServers as Record<string, unknown>).coldstart = buildMcpEntry(cwd);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  return existed ? 'merged' : 'created';
}

function writeClaudeMd(cwd: string): 'created' | 'appended' | 'skipped' {
  const filePath = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.includes('coldstart MCP tools')) return 'skipped';
    fs.appendFileSync(filePath, '\n---\n\n' + RULES_CONTENT);
    return 'appended';
  }
  fs.writeFileSync(filePath, RULES_CONTENT);
  return 'created';
}

function writeClaudeSkill(cwd: string): 'created' | 'updated' {
  const skillDir = path.join(cwd, '.claude', 'skills', 'trace-files');
  const filePath = path.join(skillDir, 'SKILL.md');
  const existed = fs.existsSync(filePath);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(filePath, SKILL_CONTENT);
  return existed ? 'updated' : 'created';
}

function writeCursorRule(cwd: string): 'created' | 'updated' {
  const rulesDir = path.join(cwd, '.cursor', 'rules');
  const filePath = path.join(rulesDir, 'coldstart-mcp.mdc');
  const existed = fs.existsSync(filePath);
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(filePath, MDC_FRONTMATTER + RULES_CONTENT);
  return existed ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// Setup routines
// ---------------------------------------------------------------------------

function setupClaude(cwd: string): void {
  const mcpResult = mergeMcpJson(path.join(cwd, '.mcp.json'), cwd);
  const mdResult = writeClaudeMd(cwd);
  const skillResult = writeClaudeSkill(cwd);
  out(`  .mcp.json                              — ${mcpResult}`);
  out(`  CLAUDE.md                              — ${mdResult}`);
  out(`  .claude/skills/trace-files/SKILL.md    — ${skillResult}`);
}

function setupCursor(cwd: string): void {
  const mcpResult = mergeMcpJson(path.join(cwd, '.cursor', 'mcp.json'), cwd);
  const ruleResult = writeCursorRule(cwd);
  out(`  .cursor/mcp.json                 — ${mcpResult}`);
  out(`  .cursor/rules/coldstart-mcp.mdc  — ${ruleResult}`);
}

function setupFiles(cwd: string): void {
  const mcpPath = path.join(cwd, 'coldstart-mcp.json');
  const rulesPath = path.join(cwd, 'coldstart-rules.md');
  fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { coldstart: buildMcpEntry(cwd) } }, null, 2) + '\n');
  fs.writeFileSync(rulesPath, RULES_CONTENT);
  out('  coldstart-mcp.json   — copy the mcpServers entry into your IDE\'s MCP config file');
  out('  coldstart-rules.md   — copy the contents into your IDE\'s rules/instructions file');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const hasClaude = fs.existsSync(path.join(home, '.claude'));
  const hasCursor =
    fs.existsSync(path.join(home, '.cursor')) ||
    fs.existsSync('/Applications/Cursor.app');

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (question: string): Promise<string> => {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase();
  };

  out('');
  out('coldstart-mcp init');
  out(DIVIDER);
  out('');

  type Target = 'claude' | 'cursor' | 'both' | 'files';
  let target: Target;

  if (hasClaude && hasCursor) {
    out('Detected: Claude Code and Cursor');
    out('');
    out('Will write:');
    out('  .mcp.json, CLAUDE.md, .claude/skills/trace-files/SKILL.md');
    out('  .cursor/mcp.json, .cursor/rules/coldstart-mcp.mdc');
    out('');
    const answer = await ask('Set up for both? [Y/n] ');
    target = (answer === '' || answer === 'y') ? 'both' : 'files';
  } else if (hasClaude) {
    out('Detected: Claude Code');
    out('');
    out('Will write:');
    out('  .mcp.json                            — MCP server config (merge if exists)');
    out('  CLAUDE.md                            — agent rules (append if exists, create if not)');
    out('  .claude/skills/trace-files/SKILL.md  — auto-invoked exploration skill');
    out('');
    const answer = await ask('Proceed? [Y/n] ');
    target = (answer === '' || answer === 'y') ? 'claude' : 'files';
  } else if (hasCursor) {
    out('Detected: Cursor');
    out('');
    out('Will write:');
    out('  .cursor/mcp.json                 — MCP server config (merge if exists)');
    out('  .cursor/rules/coldstart-mcp.mdc  — agent rules');
    out('');
    const answer = await ask('Proceed? [Y/n] ');
    target = (answer === '' || answer === 'y') ? 'cursor' : 'files';
  } else {
    out('No IDE detected (.claude/ or .cursor/ not found).');
    out('');
    out('  1  Claude Code  (.mcp.json + CLAUDE.md)');
    out('  2  Cursor       (.cursor/mcp.json + .cursor/rules/coldstart-mcp.mdc)');
    out('  3  Both');
    out('  4  Generate files to copy manually');
    out('');
    const answer = await ask('Choose [1/2/3/4]: ');
    const map: Record<string, Target> = { '1': 'claude', '2': 'cursor', '3': 'both', '4': 'files' };
    target = map[answer] ?? 'files';
  }

  rl.close();

  out('');

  if (target === 'claude' || target === 'both') setupClaude(cwd);
  if (target === 'cursor' || target === 'both') setupCursor(cwd);
  if (target === 'files') setupFiles(cwd);

  out('');
  out(DIVIDER);
  out('Done. Full docs: https://github.com/AkashGoenka/coldstart');
  out('');
}
