/**
 * coldstart init — wire coldstart into a project.
 *
 * Model: a single `coldstart.md` lives at the repo root and carries ALL the
 * agent-facing guidance. Clients pull it in by reference, so future wording
 * changes touch only coldstart.md, never the client's own rules file.
 *
 * init asks two things (or takes `--experience` / `--client` flags):
 *   1. EXPERIENCE — how the agent invokes coldstart:
 *        - `cli` (recommended) → runs `coldstart find` / `coldstart gs` (shell).
 *        - `mcp`               → calls the `find` / `gs` MCP tools (no shell).
 *      This selects the coldstart.md flavor and the hook matcher surface.
 *   2. CLIENT — which tool to wire (never auto-detected; the user always picks):
 *        - Claude Code → CLAUDE.md imports `@coldstart.md`; find/gs hooks in
 *          `.claude/settings.json`. (MCP experience also writes `.mcp.json`.)
 *        - Cursor      → `.cursor/rules/coldstart.mdc` references coldstart.md;
 *          (MCP) `.cursor/mcp.json`. No hooks — Cursor's after-hooks are
 *          notification-only, so the nudge can't be delivered.
 *        - Codex       → AGENTS.md points at coldstart.md; find/gs hooks in
 *          `.codex/hooks.json` (Claude-style, same handlers). (MCP) writes
 *          `[mcp_servers.coldstart]` into `.codex/config.toml`.
 *        - Other       → write coldstart.md only; print wiring directions.
 *
 * Hooks (the find-dedup guard + behavioral nudge) are the same shipped handlers
 * for Claude and Codex — both share Claude's `permissionDecision`/
 * `additionalContext` protocol. Tools that can't deliver the nudge get rules +
 * MCP only, and we tell the user it "works best on Claude Code or Codex".
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ensureKeeper } from './keeper.js';

const __filename = fileURLToPath(import.meta.url);

const DIVIDER = '─'.repeat(60);
const IMPORT_LINE = '@coldstart.md';

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// coldstart.md content — one doc, two invocation flavors
// ---------------------------------------------------------------------------

export function coldstartMd(mode: 'cli' | 'mcp'): string {
  const cli = mode === 'cli';
  const find = cli ? '`coldstart find <terms...>`' : 'the `find` tool';
  const gs = cli ? '`coldstart gs <file>`' : 'the `gs` tool';
  const invocation = cli
    ? 'Two local, instant shell commands'
    : 'Two local, instant MCP tools';
  const flags = cli
    ? `## Load-bearing flags
- \`find --path GLOB\` — scope to a glob (\`--path 'app/**/*.py'\`); \`,\` to combine, \`!\` to exclude.
- \`find --tests\` — include test files (excluded by default).
- \`gs --match TERM\` — on a god-file, filter to one area (\`--match tile\`); \`a|b\` = OR, \`/regex/\` = regex.
- \`gs --view symbols|imports|importers|callers\` — one section instead of the full page.
- \`gs <file> --symbol a,b\` — deliver named method bodies inline + caller/callee pointers.

## Batch independent lookups in one call
\`coldstart find auth; coldstart find 'session cookie'; coldstart gs src/auth/service.ts\`
`
    : `## Load-bearing params
- \`find\` \`path\` — scope to a glob (\`app/**/*.py\`); \`,\` to combine, \`!\` to exclude.
- \`gs\` \`match\` — on a god-file, filter to one area (\`tile\`); \`a|b\` = OR, \`/regex/\` = regex.
- \`gs\` \`view\` (symbols|imports|importers|callers) — one section instead of the full page.
- \`gs\` \`symbol\` (\`a,b\`) — deliver named method bodies inline + caller/callee pointers.
`;

  return `# coldstart — fast codebase navigation

${invocation} that answer "where does this live?" and "what is this file?" without a model call. Reach for them BEFORE Grep/Glob/Read when orienting in a codebase or locating code.

- ${find} — locate the files relevant to a concept. Pass EVERY salient identifier (symbol, domain noun, the rare token you half-remember), not one keyword. Ranks files by how many of your terms they cover.
- ${gs} — drill into one file: its symbols (with line ranges), who imports it, who calls each symbol, and name-related neighbors. This is the answer to "who uses this file / who calls this symbol" — not grep.

## Flow
1. ${find} on a concept → pick the best path.
2. ${gs} on that file → shape + who uses it.
3. \`Read\` only for the implementation inside a method body.

${flags}
## Reading the output
- Top files are marked \`▸ <path>  [covered/total]\` — how many of your query terms they cover — with a \`Role:\` line (which terms each defines/imports) and an inline preview of the body lines where your terms cluster. Often enough to answer WITHOUT a Read.
- A \`Wired:\` line shows relations: \`uses\`/\`used by\` = import edges; \`near\` = a name-reference relation the import graph can't see (the files share a rare identifier/string token — migration↔model, config-by-name, cross-language). Treat wired files as one unit: if one is worth opening, the others usually belong in your answer too.
- "no indexed file contains any of [...]" = those identifiers aren't in the repo. Don't grep spelling variants.
- \`gs\` Importers with \`match\` lists every file whose content references the term — exhaustive, so a subsystem absent from it does NOT use the symbol. Don't grep to re-verify.

## Stop rule
Ran \`gs\` on 5+ files for one question → you're enumerating. Go back to \`find\` with a sharper \`path\` scope or a different concept token.

## When NOT to use it
- A literal string/phrase/regex inside file bodies → Grep.
- Reading an implementation → Read, after \`gs\` gives the shape.
`;
}

// ---------------------------------------------------------------------------
// Stable install resolution + MCP entry (printed for no-shell / other clients)
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a stable install of coldstart. If
 * `~/.coldstart/versions/<version>/` already has it, reuse it; otherwise copy
 * the running install there. `init` always runs from a complete on-disk
 * install (npx cache, global, or local devDep), so the source tree exists.
 */
function getOrInstallStableVersion(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (!home) throw new Error('Could not determine HOME directory');

  const pkgPath = path.resolve(path.dirname(path.dirname(__filename)), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string; name?: string };
  const version = pkg.version;
  if (!version) throw new Error('Could not determine version from package.json');
  // Derive the install dir name from package.json so the rename (coldstart-mcp →
  // coldstart) — or any future rename — doesn't break stable-install resolution.
  const pkgName = pkg.name ?? 'coldstart';

  const versionDir = path.join(home, '.coldstart', 'versions', version);
  const entryPath = path.join(versionDir, 'node_modules', pkgName, 'dist', 'index.js');
  if (fs.existsSync(entryPath)) return entryPath;

  const running = fs.realpathSync(process.argv[1]);
  const sourceNm = path.resolve(running, '..', '..', '..');
  if (!fs.existsSync(path.join(sourceNm, pkgName, 'package.json'))) {
    throw new Error(`Cannot locate the running ${pkgName} install from ${running}.`);
  }

  out(`Copying coldstart-mcp@${version} to ~/.coldstart/versions/${version}/ …`);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.cpSync(sourceNm, path.join(versionDir, 'node_modules'), { recursive: true });
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Copy completed but entry file not found at ${entryPath}`);
  }
  return entryPath;
}

function mcpServerEntry(cwd: string): { command: string; args: string[] } {
  const entryPath = getOrInstallStableVersion();
  return { command: 'node', args: [entryPath, '--root', cwd] };
}

/**
 * Absolute path to the shipped hooks dir, inside the version-pinned stable
 * install (sibling of `dist/`). Pinning to the stable copy means the path we
 * write into settings.json survives a later `npm update`/uninstall of the live
 * package. Throws (same as mcpServerEntry) if no install can be located.
 */
function resolveHooksDir(): string {
  const entryPath = getOrInstallStableVersion(); // <stable>/node_modules/<pkg>/dist/index.js
  return path.join(path.dirname(path.dirname(entryPath)), 'hooks');
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function writeColdstartMd(cwd: string, mode: 'cli' | 'mcp'): 'created' | 'updated' {
  const filePath = path.join(cwd, 'coldstart.md');
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, coldstartMd(mode));
  return existed ? 'updated' : 'created';
}

/** Ensure CLAUDE.md exists and imports coldstart.md via `@coldstart.md`. */
export function wireClaudeImport(cwd: string): 'created' | 'added' | 'present' {
  const filePath = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Project guidance\n\n${IMPORT_LINE}\n`);
    return 'created';
  }
  const existing = fs.readFileSync(filePath, 'utf8');
  if (existing.includes(IMPORT_LINE)) return 'present';
  const sep = existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(filePath, `${sep}\n${IMPORT_LINE}\n`);
  return 'added';
}

// Hook entry files (in the shipped hooks/ dir). The PostToolUse nudge fires
// search-behaviour advice; the PreToolUse guard denies an exact find re-run.
const HOOK_PRE = 'find-preguard.mjs';
const HOOK_POST = 'find-nudge.mjs';

// PreToolUse matcher — surface-agnostic: fires for the CLI `coldstart find`
// (Bash) AND the `mcp__coldstart__find` tool. A plain regex alternation, so it
// works in both Claude's and Codex's matcher engine unchanged.
const PRE_MATCHER = 'Bash|mcp__coldstart__find';

interface HookCommand {
  type: 'command';
  command: string;
}
interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}
interface HookSet {
  PreToolUse: HookMatcher[];
  PostToolUse: HookMatcher[];
}

/** True if a hook-array entry is one WE wrote (by entry filename), so re-running
 *  init can strip + refresh it instead of duplicating it. */
function isColdstartHookEntry(entry: unknown): boolean {
  const hooks = (entry as { hooks?: unknown })?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const cmd = (h as { command?: unknown })?.command;
    return typeof cmd === 'string' && (cmd.includes(HOOK_PRE) || cmd.includes(HOOK_POST));
  });
}

/**
 * Build the coldstart hook entries (find-dedup guard + behavioral nudge).
 * `postMatcher` differs by engine: Claude uses `*` for match-all, Codex uses the
 * regex `.*`. Everything else is identical — the shipped handlers are the same.
 */
function coldstartHooks(hooksDir: string, postMatcher: string): HookSet {
  const preCmd = `node ${path.join(hooksDir, HOOK_PRE)}`;
  const postCmd = `node ${path.join(hooksDir, HOOK_POST)}`;
  return {
    PreToolUse: [{ matcher: PRE_MATCHER, hooks: [{ type: 'command', command: preCmd }] }],
    PostToolUse: [{ matcher: postMatcher, hooks: [{ type: 'command', command: postCmd }] }],
  };
}

/** Merge our hook entries into an existing `hooks` config object, stripping any
 *  prior coldstart entries first (idempotent re-run) and preserving foreign ones. */
function mergeHooks(hooksCfg: Record<string, unknown>, entries: HookSet): void {
  const stripOurs = (arr: unknown): unknown[] =>
    (Array.isArray(arr) ? arr : []).filter((e) => !isColdstartHookEntry(e));
  hooksCfg.PreToolUse = [...stripOurs(hooksCfg.PreToolUse), ...entries.PreToolUse];
  hooksCfg.PostToolUse = [...stripOurs(hooksCfg.PostToolUse), ...entries.PostToolUse];
}

/**
 * Register the find/gs search hooks in the project's `.claude/settings.json`.
 *
 * Merges (never clobbers): preserves every other setting and any non-coldstart
 * hooks. Idempotent — strips our prior entries (matched by entry filename) and
 * re-adds them, so a re-run refreshes a stale hook path without duplicating.
 * Fail-safe — if settings.json exists but is not valid JSON, we leave it alone
 * and report, rather than overwrite a file the user owns.
 */
export function wireClaudeHooks(cwd: string): 'created' | 'updated' | { error: string } {
  let hooksDir: string;
  try {
    hooksDir = resolveHooksDir();
  } catch (e) {
    return { error: `could not resolve a stable install path (${e})` };
  }

  const dir = path.join(cwd, '.claude');
  const filePath = path.join(dir, 'settings.json');

  let settings: Record<string, unknown> = {};
  const existed = fs.existsSync(filePath);
  if (existed) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
    } catch {
      return { error: `${filePath} is not valid JSON — left untouched; wire hooks manually` };
    }
  }

  const hooksCfg =
    settings.hooks && typeof settings.hooks === 'object'
      ? (settings.hooks as Record<string, unknown>)
      : {};
  mergeHooks(hooksCfg, coldstartHooks(hooksDir, '*'));
  settings.hooks = hooksCfg;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}

/**
 * Register the find/gs search hooks in the project's `.codex/hooks.json`.
 *
 * Codex hooks are Claude-style: same `PreToolUse`/`PostToolUse` events, the same
 * `permissionDecision: "deny"` (guard) and `hookSpecificOutput.additionalContext`
 * (nudge), and the same `tool_name`/`tool_input`/`tool_response` stdin — so the
 * SAME shipped handlers run unchanged. The only differences vs Claude: the file
 * lives at `.codex/hooks.json` with a top-level `hooks` object, and Codex's
 * match-all is the regex `.*` (Claude uses `*`).
 */
export function wireCodexHooks(cwd: string): 'created' | 'updated' | { error: string } {
  let hooksDir: string;
  try {
    hooksDir = resolveHooksDir();
  } catch (e) {
    return { error: `could not resolve a stable install path (${e})` };
  }

  const dir = path.join(cwd, '.codex');
  const filePath = path.join(dir, 'hooks.json');

  let config: Record<string, unknown> = {};
  const existed = fs.existsSync(filePath);
  if (existed) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') config = parsed as Record<string, unknown>;
    } catch {
      return { error: `${filePath} is not valid JSON — left untouched; wire hooks manually` };
    }
  }

  const hooksCfg =
    config.hooks && typeof config.hooks === 'object'
      ? (config.hooks as Record<string, unknown>)
      : {};
  mergeHooks(hooksCfg, coldstartHooks(hooksDir, '.*'));
  config.hooks = hooksCfg;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// Rules-file writers — each references coldstart.md, never duplicates it
// ---------------------------------------------------------------------------

/** Write `.cursor/rules/coldstart.mdc` — an always-applied rule that pulls in
 *  coldstart.md via Cursor's `@file` reference. Overwritten on re-run (it owns
 *  this file), so guidance edits flow through coldstart.md. */
export function wireCursorRule(cwd: string): 'created' | 'updated' {
  const dir = path.join(cwd, '.cursor', 'rules');
  const filePath = path.join(dir, 'coldstart.mdc');
  const existed = fs.existsSync(filePath);
  const body = `---
description: coldstart — fast codebase navigation (find/gs) before grep/read
alwaysApply: true
---

Before grepping or reading files to orient in this codebase, use coldstart
(\`find\` to locate files, \`gs\` to inspect one). Full guidance:

@coldstart.md
`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, body);
  return existed ? 'updated' : 'created';
}

const AGENTS_START = '<!-- coldstart:start -->';
const AGENTS_END = '<!-- coldstart:end -->';

/** Ensure AGENTS.md carries a coldstart section pointing at coldstart.md.
 *  AGENTS.md has no import directive, so we inject a marked block and refresh it
 *  in place on re-run (idempotent), preserving everything else in the file. */
export function wireCodexAgents(cwd: string): 'created' | 'updated' {
  const filePath = path.join(cwd, 'AGENTS.md');
  const block = `${AGENTS_START}
## Codebase navigation (coldstart)

Before grepping or reading files to orient in this repo, use coldstart. Read
\`coldstart.md\` at the repo root for the find/gs workflow and follow it.
${AGENTS_END}`;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# AGENTS.md\n\n${block}\n`);
    return 'created';
  }
  const existing = fs.readFileSync(filePath, 'utf8');
  const start = existing.indexOf(AGENTS_START);
  if (start !== -1) {
    const end = existing.indexOf(AGENTS_END, start);
    if (end !== -1) {
      const next = existing.slice(0, start) + block + existing.slice(end + AGENTS_END.length);
      fs.writeFileSync(filePath, next);
      return 'updated';
    }
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(filePath, `${sep}\n${block}\n`);
  return 'updated';
}

// ---------------------------------------------------------------------------
// MCP config writers (only used for the `mcp` experience)
// ---------------------------------------------------------------------------

/** Merge `{ mcpServers: { coldstart: entry } }` into a JSON MCP config (used for
 *  Claude's `.mcp.json` and Cursor's `.cursor/mcp.json` — identical shape).
 *  Fail-safe on invalid JSON; preserves other servers and keys. */
export function wireJsonMcp(
  cwd: string,
  relFile: string,
  entry: { command: string; args: string[] },
): 'created' | 'updated' | { error: string } {
  const filePath = path.join(cwd, relFile);
  let config: Record<string, unknown> = {};
  const existed = fs.existsSync(filePath);
  if (existed) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') config = parsed as Record<string, unknown>;
    } catch {
      return { error: `${filePath} is not valid JSON — left untouched; add the MCP server manually` };
    }
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object'
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  servers.coldstart = entry;
  config.mcpServers = servers;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}

/** Remove an existing `[mcp_servers.coldstart]` table (and any sub-tables) from
 *  TOML text, so we can append a fresh one without duplicating. Conservative:
 *  drops the header line and everything until the next top-level `[` or EOF. */
function stripCodexColdstartTable(toml: string): string {
  const lines = toml.split('\n');
  const out: string[] = [];
  let skipping = false;
  const isColdstartHeader = (l: string): boolean =>
    /^\s*\[\[?mcp_servers\.coldstart(\..*)?\]\]?\s*$/.test(l);
  const isTableHeader = (l: string): boolean => /^\s*\[\[?[^\]]+\]\]?\s*$/.test(l);
  for (const line of lines) {
    if (skipping) {
      if (isColdstartHeader(line)) continue; // a coldstart sub-table — keep skipping
      if (isTableHeader(line)) skipping = false; // a different table — stop skipping
      else continue; // body of the coldstart table — drop
    }
    if (isColdstartHeader(line)) {
      skipping = true;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Write `[mcp_servers.coldstart]` into `.codex/config.toml` (Codex's MCP config).
 *  Hand-rolled minimal TOML merge — no dependency: strip a prior coldstart table,
 *  then append a fresh one. Other config is preserved verbatim. */
export function wireCodexMcp(
  cwd: string,
  entry: { command: string; args: string[] },
): 'created' | 'updated' {
  const dir = path.join(cwd, '.codex');
  const filePath = path.join(dir, 'config.toml');
  const existed = fs.existsSync(filePath);
  let content = existed ? fs.readFileSync(filePath, 'utf8') : '';
  content = stripCodexColdstartTable(content).replace(/\n+$/, '');

  const args = entry.args.map((a) => JSON.stringify(a)).join(', ');
  const block = `[mcp_servers.coldstart]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${args}]\n`;

  const next = content.length ? `${content}\n\n${block}` : block;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, next);
  return existed ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// Setup routines — one per client, keyed off the chosen experience
// ---------------------------------------------------------------------------

type Experience = 'cli' | 'mcp';
type Client = 'claude' | 'cursor' | 'codex' | 'other';

const FLAVOR = (exp: Experience): string => (exp === 'cli' ? 'CLI flavor' : 'MCP flavor');

/** Resolve + report the MCP entry, or null + a printed reason on failure. */
function mcpEntryOrNull(cwd: string): { command: string; args: string[] } | null {
  try {
    return mcpServerEntry(cwd);
  } catch (e) {
    out(`  (could not resolve a stable install path for the MCP server: ${e})`);
    return null;
  }
}

function reportHooks(label: string, res: 'created' | 'updated' | { error: string }): void {
  if (typeof res === 'object') out(`  ${label} — search hooks NOT wired: ${res.error}`);
  else out(`  ${label} — ${res} find/gs search hooks (PreToolUse + PostToolUse)`);
}

function setupClaude(cwd: string, exp: Experience): void {
  out(`  coldstart.md  — ${writeColdstartMd(cwd, exp)} (${FLAVOR(exp)})`);
  const imp = wireClaudeImport(cwd);
  out(`  CLAUDE.md     — ${imp === 'present' ? 'already imports @coldstart.md' : `${imp} @coldstart.md import`}`);
  if (exp === 'mcp') {
    const entry = mcpEntryOrNull(cwd);
    if (entry) {
      const r = wireJsonMcp(cwd, '.mcp.json', entry);
      out(typeof r === 'object' ? `  .mcp.json — NOT written: ${r.error}` : `  .mcp.json     — ${r} coldstart MCP server`);
    }
  }
  reportHooks('settings.json', wireClaudeHooks(cwd));
}

function setupCodex(cwd: string, exp: Experience): void {
  out(`  coldstart.md  — ${writeColdstartMd(cwd, exp)} (${FLAVOR(exp)})`);
  out(`  AGENTS.md     — ${wireCodexAgents(cwd)} coldstart navigation section`);
  if (exp === 'mcp') {
    const entry = mcpEntryOrNull(cwd);
    if (entry) out(`  config.toml   — ${wireCodexMcp(cwd, entry)} [mcp_servers.coldstart]`);
  }
  reportHooks('hooks.json', wireCodexHooks(cwd));
}

function setupCursor(cwd: string, exp: Experience): void {
  out(`  coldstart.md  — ${writeColdstartMd(cwd, exp)} (${FLAVOR(exp)})`);
  out(`  coldstart.mdc — ${wireCursorRule(cwd)} .cursor/rules rule (references @coldstart.md)`);
  if (exp === 'mcp') {
    const entry = mcpEntryOrNull(cwd);
    if (entry) {
      const r = wireJsonMcp(cwd, path.join('.cursor', 'mcp.json'), entry);
      out(typeof r === 'object' ? `  .cursor/mcp.json — NOT written: ${r.error}` : `  mcp.json      — ${r} .cursor coldstart MCP server`);
    }
  }
  out('');
  out('  Note: Cursor hooks are not wired — its after-tool hooks are');
  out('  notification-only, so the behavioral nudge can\'t be delivered.');
  out('  coldstart works best on Claude Code or Codex (full hook support).');
}

function setupOther(cwd: string, exp: Experience): void {
  out(`  coldstart.md  — ${writeColdstartMd(cwd, exp)} (${FLAVOR(exp)})`);
  out('');
  out('  Wire it into your client:');
  out('  1. Add coldstart.md to your client\'s rules / instructions / skill');
  out('     (whatever your app uses — point it at this file or paste its contents).');
  if (exp === 'mcp') {
    out('  2. Add the MCP server entry to your client\'s MCP config:');
    out('');
    const entry = mcpEntryOrNull(cwd);
    if (entry) {
      out('       ' + JSON.stringify({ mcpServers: { coldstart: entry } }, null, 2).split('\n').join('\n       '));
    }
  } else {
    out('  2. Make sure the `coldstart` CLI is on PATH so the agent can run');
    out('     `coldstart find` / `coldstart gs` (npm i -g coldstart).');
  }
  out('');
  out('  Note: behavioral hooks (the find-dedup guard + nudge) need a host that');
  out('  supports Claude-style hooks. coldstart works best on Claude Code or Codex.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Read `--flag value` or `--flag=value` from an argv slice. */
function readFlag(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === flag) return argv[i + 1]?.trim().toLowerCase();
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1).trim().toLowerCase();
  }
  return undefined;
}

function parseExperience(v: string | undefined): Experience | undefined {
  if (v === 'cli' || v === '1') return 'cli';
  if (v === 'mcp' || v === '2') return 'mcp';
  return undefined;
}

function parseClient(v: string | undefined): Client | undefined {
  if (v === 'claude' || v === 'claude-code' || v === '1') return 'claude';
  if (v === 'cursor' || v === '2') return 'cursor';
  if (v === 'codex' || v === '3') return 'codex';
  if (v === 'other' || v === 'others' || v === '4') return 'other';
  return undefined;
}

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const argv = process.argv.slice(3); // tokens after `init`

  let experience = parseExperience(readFlag(argv, '--experience'));
  let client = parseClient(readFlag(argv, '--client'));

  out('');
  out('coldstart init');
  out(DIVIDER);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (q: string): Promise<string> => (await rl.question(q)).trim().toLowerCase();

  if (!experience) {
    out('');
    out('How will the agent invoke coldstart?');
    out('');
    out('  1  CLI  (recommended)  — runs `coldstart find` / `coldstart gs` (shell)');
    out('  2  MCP                 — calls the `find` / `gs` MCP tools (no shell)');
    out('');
    experience = parseExperience(await ask('Choose [1/2]: ')) ?? 'cli';
  }

  if (!client) {
    out('');
    out('Which client are you wiring coldstart into?');
    out('');
    out('  1  Claude Code  — rules import + find/gs hooks');
    out('  2  Cursor       — rules + MCP (no hooks; see note)');
    out('  3  Codex        — rules + find/gs hooks');
    out('  4  Other        — coldstart.md + wiring directions');
    out('');
    client = parseClient(await ask('Choose [1/2/3/4]: ')) ?? 'other';
  }

  rl.close();
  out('');

  switch (client) {
    case 'claude':
      setupClaude(cwd, experience);
      break;
    case 'cursor':
      setupCursor(cwd, experience);
      break;
    case 'codex':
      setupCodex(cwd, experience);
      break;
    default:
      setupOther(cwd, experience);
  }

  // Warm the index now, while the user is here at setup, so the first lookup
  // isn't a cold build. ensureKeeper spawns the background keeper (detached) and
  // returns immediately; the keeper walks + indexes + watches from here on.
  // Best-effort — a spawn failure just means the first query builds lazily.
  out('');
  out('Indexing this repo in the background — your first lookup will be instant.');
  await ensureKeeper(cwd);

  out('');
  out(DIVIDER);
  out('Done. Full docs: https://github.com/AkashGoenka/coldstart');
  out('');
}
