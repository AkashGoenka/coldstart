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
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ensureKeeper } from './keeper.js';
import { initSkeleton, logMetric } from './kb/store.js';

const __filename = fileURLToPath(import.meta.url);

const DIVIDER = '─'.repeat(60);
const IMPORT_LINE = '@coldstart.md';

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// coldstart.md content — two checked-in flavors under templates/, one written
// per experience. Editing docs = editing plain markdown (templates/coldstart.
// {cli,mcp}.md), not escaped TS template strings. templates/ ships in the npm
// package (package.json "files") beside dist/, so it resolves from the running
// install. Trade-off: the ~shared prose lives in both files — keep them in sync
// when you edit shared guidance (only the find/gs phrasing + notebook commands
// genuinely differ between flavors).
// ---------------------------------------------------------------------------

/** Absolute path to a flavored coldstart.md template. templates/ sits beside
 *  dist/ in both the checkout and the published package (dist/init.js → ..). */
function coldstartMdTemplatePath(mode: 'cli' | 'mcp'): string {
  return path.resolve(path.dirname(path.dirname(__filename)), 'templates', `coldstart.${mode}.md`);
}

/** The coldstart.md body for a flavor, read from its checked-in template. */
export function coldstartMd(mode: 'cli' | 'mcp'): string {
  return fs.readFileSync(coldstartMdTemplatePath(mode), 'utf8');
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
// Notebook (kb) setup — skeleton, git wiring, and the Claude recall/capture
// hooks. Shared by `coldstart init` (always) and the `coldstart kb init` alias.
// ---------------------------------------------------------------------------

// The notebook recall (UserPromptSubmit) + capture (Stop/SubagentStop) hook
// entry files, in the shipped hooks/ dir. Distinct from the find/gs hooks, so
// they merge into settings.json independently.
const KB_HOOK_RECALL = 'kb-recall.mjs';
const KB_HOOK_ELICIT = 'kb-elicit.mjs';

/** True if a hook-array entry is one of OUR kb hooks (by filename) — so re-init
 *  strips + refreshes instead of duplicating. */
function isKbHookEntry(entry: unknown): boolean {
  const hooks = (entry as { hooks?: unknown })?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const cmd = (h as { command?: unknown })?.command;
    return typeof cmd === 'string' && (cmd.includes(KB_HOOK_RECALL) || cmd.includes(KB_HOOK_ELICIT));
  });
}

/**
 * Merge the notebook recall/capture hooks into `.claude/settings.json`.
 * Idempotent (strips prior kb entries, re-adds), preserves the find/gs hooks
 * and any foreign entries, fail-safe on invalid JSON. Points at the same
 * version-pinned stable hooks dir the find/gs hooks use (survives npm update).
 */
export function wireClaudeKbHooks(cwd: string): 'created' | 'updated' | { error: string } {
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
      return { error: `${filePath} is not valid JSON — left untouched; wire the kb hooks manually` };
    }
  }
  const hooksCfg = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>;
  const stripOurs = (arr: unknown): unknown[] => (Array.isArray(arr) ? arr : []).filter((e) => !isKbHookEntry(e));
  const entry = (file: string): unknown => ({ hooks: [{ type: 'command', command: `node ${path.join(hooksDir, file)}` }] });
  hooksCfg.UserPromptSubmit = [...stripOurs(hooksCfg.UserPromptSubmit), entry(KB_HOOK_RECALL)];
  hooksCfg.Stop = [...stripOurs(hooksCfg.Stop), entry(KB_HOOK_ELICIT)];
  hooksCfg.SubagentStop = [...stripOurs(hooksCfg.SubagentStop), entry(KB_HOOK_ELICIT)];
  settings.hooks = hooksCfg;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}

/** Is any `.raw` note file already git-tracked? If so the repo is (or was)
 *  sharing its notebook — adding an ignore line would create a confusing
 *  tracked-but-ignored divergence, so we leave it shared. */
function notebookRawTracked(cwd: string): boolean {
  try {
    const listed = execFileSync('git', ['ls-files', '.coldstart/notebook/.raw'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return listed.trim().length > 0;
  } catch {
    return false; // not a git repo, or git unavailable — treat as untracked
  }
}

const NOTEBOOK_IGNORE_LINE = '.coldstart/';
const hasNotebookIgnore = (text: string): boolean =>
  text.split('\n').some((l) => { const t = l.trim(); return t === '.coldstart/' || t === '.coldstart'; });

/** Privacy default: add `.coldstart/` to the repo's root .gitignore so the
 *  notebook stays local. Skipped when `.raw` is already tracked (don't flip an
 *  existing shared repo). */
function addNotebookGitignore(cwd: string): 'added' | 'present' | 'kept-shared' {
  if (notebookRawTracked(cwd)) return 'kept-shared';
  const giPath = path.join(cwd, '.gitignore');
  let gi = '';
  try { gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : ''; } catch { /* create below */ }
  if (hasNotebookIgnore(gi)) return 'present';
  fs.appendFileSync(giPath, (gi && !gi.endsWith('\n') ? '\n' : '') + NOTEBOOK_IGNORE_LINE + '\n');
  return 'added';
}

/** Opt-in to share: drop the `.coldstart/` ignore line if we (or the user) added
 *  it, so `.raw` becomes committable. The inner notebook .gitignore still keeps
 *  notes/ + .metrics/ out. */
function removeNotebookGitignore(cwd: string): 'removed' | 'absent' {
  const giPath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(giPath)) return 'absent';
  const lines = fs.readFileSync(giPath, 'utf8').split('\n');
  const kept = lines.filter((l) => { const t = l.trim(); return t !== '.coldstart/' && t !== '.coldstart'; });
  if (kept.length === lines.length) return 'absent';
  fs.writeFileSync(giPath, kept.join('\n'));
  return 'removed';
}

/** merge=union on the append-only .raw logs — concurrent appends conflict at
 *  EOF under naive merge; union keeps both sides and the ts-sorted fold makes
 *  interleave order irrelevant. */
function ensureGitattributes(cwd: string): void {
  const gaPath = path.join(cwd, '.gitattributes');
  const line = '.coldstart/notebook/.raw/*.jsonl merge=union';
  let ga = '';
  try { ga = fs.existsSync(gaPath) ? fs.readFileSync(gaPath, 'utf8') : ''; } catch { /* create below */ }
  if (ga.includes(line)) return;
  try {
    fs.appendFileSync(gaPath, (ga && !ga.endsWith('\n') ? '\n' : '') + line + '\n');
  } catch (e) {
    out(`  (could not write .gitattributes: ${e instanceof Error ? e.message : e})`);
  }
}

/**
 * Notebook file setup — client-agnostic. Creates the skeleton, sets the
 * merge=union attribute, and applies the storage choice: private by default
 * (gitignore `.coldstart/`), or committable when `commit` is set. Does NOT wire
 * hooks — those are Claude-specific (see wireClaudeKbHooks).
 */
export function setupNotebook(cwd: string, commit: boolean): void {
  initSkeleton(cwd);
  ensureGitattributes(cwd);
  if (commit) {
    const r = removeNotebookGitignore(cwd);
    out(`  notebook      — shared: .raw + okf.yaml committable, publish with \`coldstart kb commit\`${r === 'removed' ? ' (removed prior ignore rule)' : ''}`);
  } else {
    const r = addNotebookGitignore(cwd);
    const note =
      r === 'kept-shared' ? 'left shared (.raw already git-tracked)'
      : r === 'added' ? 'private: .coldstart/ gitignored (share later with `coldstart init --commit-notebook`)'
      : 'private: .coldstart/ already gitignored';
    out(`  notebook      — ${note}`);
  }
  logMetric(cwd, 'capture', { event: 'init' });
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
  const kb = wireClaudeKbHooks(cwd);
  out(typeof kb === 'object'
    ? `  settings.json — notebook hooks NOT wired: ${kb.error}`
    : `  settings.json — ${kb} notebook recall + capture hooks (UserPromptSubmit + Stop/SubagentStop)`);
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
  // Storage default is private (notebook gitignored); --commit-notebook opts in
  // to committing .raw so the notebook can be shared with the team.
  const commitNotebook = argv.includes('--commit-notebook');

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

  // The notebook is always set up (files + git wiring); hooks are Claude-only
  // and were wired above in setupClaude. Codex/Cursor kb wiring lands later.
  setupNotebook(cwd, commitNotebook);

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
