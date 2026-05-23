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
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const DIVIDER = '─'.repeat(60);

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// Rules content (same for Claude and Cursor)
// ---------------------------------------------------------------------------

const RULES_CONTENT = `# Codebase navigation — coldstart MCP tools

You have 2 MCP tools: \`get-overview\` (GO) and \`get-structure\` (GS). Reach for them before Read/Grep/Glob/Bash. Per-tool details are in the tool descriptions — these are the cross-tool rules:

- **GO is the entry point.** It matches your query against DECLARED NAMES (filenames, path segments, exported symbols) — not file bodies. Each result is \`{ path, matched }\`; \`matched\` is the codebase's own identifiers, sorted rarest-first.
- **After GO, two paths:**
  1. If a result \`path\` is the file you want → \`get-structure\` on it (use \`match\` to scope a god-file; use \`view\` to halve output). \`Read\` only when you need implementation.
  2. If a leading \`matched\` token names what you are looking for → grep that token across the repo. The matched token is the codebase's name for your concept; lifting it into a grep finds usages, callers, and in-body references GO does not index.
- **Use GO's evidence fields instead of follow-up calls:**
  - \`path: "<glob>"\` to scope before ranking (e.g. \`"src/auth/**"\`, \`"**/*.htm"\`, \`"src/**,!**/legacy/**"\`).
  - \`with_importers: true\` to attach one-hop reverse context per result.
  - \`callers_for: "<file>"\` (or list) to attach symbol-level callers for files you have already decided to drill into. This replaces "who calls X" round-trips.
- **Do not reformulate GO repeatedly.** The top results are the best declared-name matches. If they're not what you want, the answer is in bodies/strings/templates/SQL/config — grep is the right next move (use \`path\`-style file-type scoping). GO indexes filenames/paths/exports only.
- **grep is a peer of these tools, not a last resort.** Use it for: matched-token navigation, string literals, exact call sites, dynamic dispatch, and content inside non-code files (templates, SQL, config).
- **Stop when data is sufficient.** Don't re-query to confirm what you already found.
`;

const MDC_FRONTMATTER = `---
description: Codebase navigation with coldstart MCP tools
alwaysApply: true
---

`;

// ---------------------------------------------------------------------------
// Stable install resolution and MCP entry builders
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a stable install of coldstart-mcp.
 *
 * If `~/.coldstart/versions/<version>/` already has the install, reuse it.
 * Otherwise, copy the running install's node_modules into that directory.
 * `init` always runs from a complete on-disk install (npx cache, global, or
 * local devDep), so the source tree is guaranteed to exist.
 */
function getOrInstallStableVersion(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (!home) {
    throw new Error('Could not determine HOME directory');
  }

  const pkgPath = path.resolve(path.dirname(path.dirname(__filename)), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  const version = pkg.version;
  if (!version) {
    throw new Error('Could not determine version from package.json');
  }

  const versionDir = path.join(home, '.coldstart', 'versions', version);
  const entryPath = path.join(versionDir, 'node_modules', 'coldstart-mcp', 'dist', 'index.js');

  if (fs.existsSync(entryPath)) {
    return entryPath;
  }

  // argv[1] → .../<install_root>/node_modules/coldstart-mcp/dist/index.js
  // realpath resolves .bin/ symlinks; three dirnames up is the node_modules root.
  const running = fs.realpathSync(process.argv[1]);
  const sourceNm = path.resolve(running, '..', '..', '..');
  if (!fs.existsSync(path.join(sourceNm, 'coldstart-mcp', 'package.json'))) {
    throw new Error(`Cannot locate the running coldstart-mcp install from ${running}.`);
  }

  out(`Copying coldstart-mcp@${version} to ~/.coldstart/versions/${version}/ …`);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.cpSync(sourceNm, path.join(versionDir, 'node_modules'), { recursive: true });

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Copy completed but entry file not found at ${entryPath}`);
  }
  return entryPath;
}

function buildMcpEntry(cwd: string): { command: string; args: string[] } {
  const entryPath = getOrInstallStableVersion();
  return { command: 'node', args: [entryPath, '--root', cwd] };
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
  out(`  .mcp.json   — ${mcpResult}`);
  out(`  CLAUDE.md   — ${mdResult}`);
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
