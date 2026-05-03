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

const RULES_CONTENT = `# Codebase navigation — use coldstart MCP tools

Before searching or opening files, use the coldstart MCP tools to orient yourself.
This saves tokens and avoids broad, speculative file reads.

## The 4 tools

1. **\`get-overview\`** — Find files by domain/token keywords (filename, path, exports, imports).
   - Pass \`domain_filter\` with specific code tokens from your task.
   - Bare words = AND logic: "auth payment" matches files with both tokens.
   - Bracket groups = OR synonyms: "[auth|login|jwt] payment" = any auth term AND payment.
   - Pluralization is automatic: "workspace" also matches "workspaces".
   - Results show \`path\` and \`sources\` (which tokens matched).
   - Call iteratively: if truncated, either call \`get-structure\` on a visible file or narrow the query.
   - \`max_results\` defaults to 10 (increase sparingly; large result sets waste context).
   - \`include_tests\` (default false) — set true if searching for test files.

2. **\`get-structure\`** — Inspect a single file's shape WITHOUT reading it.
   - Returns: exports, imports, symbols with line numbers, language, line count, token estimate.
   - Fast way to decide if a file is relevant before opening it.

3. **\`trace-deps\`** — Follow dependency chains WITHOUT opening files.
   - \`direction="imports"\`: what does this file depend on?
   - \`direction="importers"\`: what depends on this file?
   - Use \`depth=2\` or \`depth=3\` for transitive chains.

4. **\`trace-impact\`** — Understand blast radius of symbol changes.
   - Returns known static dependents: symbols that directly or transitively call, extend, or implement the target.
   - Named function calls are resolved cross-file. Member expression calls (\`this.x()\`, \`obj.x()\`) are not — use \`trace-deps\` to find file-level importers when call graph coverage is uncertain.
   - Use before refactoring to scope affected code without reading dependent files.

## Workflow examples

**Starting a task with a known concept (e.g. "fix the auth flow"):**
1. \`get-overview(domain_filter="[auth|login|jwt]")\`
2. \`get-structure\` on a promising file
3. Read the file only if confirmed relevant

**Understanding how a component connects:**
1. \`get-structure(file_path="path/to/file.ts")\`
2. \`trace-deps(file_path="path/to/file.ts", direction="importers")\`
3. Read dependent files if needed

**Before refactoring a function or class:**
1. \`trace-impact(symbol="MyFunction")\`
2. Review affected symbols and dependencies
3. Make targeted edits

## When to fall back to grep/rg

Use grep only when coldstart tools don't answer the question:
- Searching for a specific string literal inside file contents
- Looking for all call sites of a function by exact name across the whole repo
- Searching inside comments or string values

In all other cases, prefer coldstart tools first.

# These rules are a starting point — adapt them to your model and project as you see fit.
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
  out(`  .mcp.json  — ${mcpResult}`);
  out(`  CLAUDE.md  — ${mdResult}`);
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
    out('  .mcp.json, CLAUDE.md');
    out('  .cursor/mcp.json, .cursor/rules/coldstart-mcp.mdc');
    out('');
    const answer = await ask('Set up for both? [Y/n] ');
    target = (answer === '' || answer === 'y') ? 'both' : 'files';
  } else if (hasClaude) {
    out('Detected: Claude Code');
    out('');
    out('Will write:');
    out('  .mcp.json   — MCP server config (merge if exists)');
    out('  CLAUDE.md   — agent rules (append if exists, create if not)');
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
