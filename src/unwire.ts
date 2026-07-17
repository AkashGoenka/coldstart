/**
 * coldstart unwire — the reverse of `coldstart init`.
 *
 * `npm uninstall` cannot clean the per-repo artifacts init wrote (npm fires no
 * pre/postuninstall reliably, and a global uninstall has no registry of which
 * repos were inited). So, like husky, coldstart ships an explicit reverse
 * command. It removes ONLY coldstart-owned markers from the files init touched —
 * never clobbering user content in shared files — using the SAME detectors init
 * uses for idempotent re-runs (isColdstartHookEntry / isKbHookEntry /
 * isCodexHookEntry / isCursorHookEntry / stripCodexColdstartTable). Symmetry:
 * init writes → unwire removes.
 *
 * Scope: all four clients are swept unconditionally (init doesn't record which
 * client was wired), so unwire cleans whatever it finds and reports "absent" for
 * the rest. The notebook (`.coldstart/notebook/`) is KEPT by default — it's
 * committed/shared user data; `--purge` opts in to deleting it plus its git
 * plumbing (the `.coldstart/` gitignore line + the merge=union gitattribute).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  IMPORT_LINE,
  AGENTS_START,
  AGENTS_END,
  isColdstartHookEntry,
  isKbHookEntry,
  isCodexHookEntry,
  isCursorHookEntry,
  stripCodexColdstartTable,
} from './init.js';

const DIVIDER = '─'.repeat(60);

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

/** What happened to one artifact. `absent` = nothing of ours was there. */
type Result = 'removed' | 'stripped' | 'absent' | { error: string };

function label(res: Result): string {
  if (typeof res === 'object') return `NOT changed: ${res.error}`;
  return res;
}

// ---------------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------------

/** Delete a file if it exists. */
function removeFile(filePath: string): 'removed' | 'absent' {
  if (!fs.existsSync(filePath)) return 'absent';
  fs.unlinkSync(filePath);
  return 'removed';
}

/** Best-effort remove a directory only if it is now empty. Walks up the given
 *  chain (child → parent) so `.cursor/rules` then `.cursor` both go if empty. */
function rmEmptyDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* best-effort — a non-empty or busy dir just stays */
    }
  }
}

/** Read a JSON config file. Distinguishes missing (existed:false) from invalid
 *  (error set) so we can leave a user-owned malformed file untouched. */
function readJson(filePath: string): { config: Record<string, unknown>; existed: boolean; error?: string } {
  if (!fs.existsSync(filePath)) return { config: {}, existed: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object') return { config: parsed as Record<string, unknown>, existed: true };
    return { config: {}, existed: true };
  } catch {
    return { config: {}, existed: true, error: `${filePath} is not valid JSON — left untouched` };
  }
}

/**
 * Strip coldstart-owned entries from a hooks-map config (Claude settings.json,
 * Codex/Cursor hooks.json). For each listed event key, filter out entries `isOurs`
 * matches; drop keys that become empty. Prune the hooks map, then any leftover
 * keys named in `ownedTopKeys` (e.g. Cursor's `version`, which init sets) once the
 * map is empty; delete the file if the whole config is then empty.
 *
 * Returns 'stripped' if we removed anything, 'absent' if there was nothing of
 * ours, or an error for invalid JSON.
 */
function stripHooksConfig(
  filePath: string,
  hooksKey: string,
  events: string[],
  isOurs: (entry: unknown) => boolean,
  ownedTopKeys: string[] = [],
): Result {
  const { config, existed, error } = readJson(filePath);
  if (!existed) return 'absent';
  if (error) return { error };

  const hooksCfg =
    config[hooksKey] && typeof config[hooksKey] === 'object'
      ? (config[hooksKey] as Record<string, unknown>)
      : null;
  if (!hooksCfg) return 'absent';

  let changed = false;
  for (const ev of events) {
    const arr = hooksCfg[ev];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((e) => !isOurs(e));
    if (kept.length === arr.length) continue;
    changed = true;
    if (kept.length === 0) delete hooksCfg[ev];
    else hooksCfg[ev] = kept;
  }
  if (!changed) return 'absent';

  // Prune the now-empty hooks map, then any coldstart-owned top-level keys that
  // only exist because we wrote the hooks (Cursor's `version`).
  if (Object.keys(hooksCfg).length === 0) {
    delete config[hooksKey];
    for (const k of ownedTopKeys) delete config[k];
  } else {
    config[hooksKey] = hooksCfg;
  }

  if (Object.keys(config).length === 0) {
    fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  }
  return 'stripped';
}

/** Remove `mcpServers.coldstart` from a JSON MCP config, pruning empties and
 *  deleting the file if it becomes empty. */
function unwireJsonMcp(cwd: string, relFile: string): Result {
  const filePath = path.join(cwd, relFile);
  const { config, existed, error } = readJson(filePath);
  if (!existed) return 'absent';
  if (error) return { error };

  const servers =
    config.mcpServers && typeof config.mcpServers === 'object'
      ? (config.mcpServers as Record<string, unknown>)
      : null;
  if (!servers || !('coldstart' in servers)) return 'absent';

  delete servers.coldstart;
  if (Object.keys(servers).length === 0) delete config.mcpServers;
  else config.mcpServers = servers;

  if (Object.keys(config).length === 0) fs.unlinkSync(filePath);
  else fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  return 'stripped';
}

// ---------------------------------------------------------------------------
// Per-artifact reversers
// ---------------------------------------------------------------------------

/** Remove the `@coldstart.md` import line from CLAUDE.md (leave the rest). */
function unwireClaudeImport(cwd: string): Result {
  const filePath = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) return 'absent';
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const kept = lines.filter((l) => l.trim() !== IMPORT_LINE);
  if (kept.length === lines.length) return 'absent';
  // Collapse a blank-line run left behind, then trim trailing blanks.
  const collapsed: string[] = [];
  for (const l of kept) {
    if (l.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  const next = collapsed.join('\n');
  // If only init's own scaffold heading is left, init created the file — remove it.
  if (next.trim() === '' || next.trim() === '# Project guidance') fs.unlinkSync(filePath);
  else fs.writeFileSync(filePath, next + '\n');
  return 'stripped';
}

/** Excise the `<!-- coldstart:start -->…<!-- coldstart:end -->` block from
 *  AGENTS.md, preserving the rest of the user's file. */
function unwireCodexAgents(cwd: string): Result {
  const filePath = path.join(cwd, 'AGENTS.md');
  if (!fs.existsSync(filePath)) return 'absent';
  const text = fs.readFileSync(filePath, 'utf8');
  const start = text.indexOf(AGENTS_START);
  if (start === -1) return 'absent';
  const end = text.indexOf(AGENTS_END, start);
  if (end === -1) return 'absent';
  const before = text.slice(0, start).replace(/\n+$/, '\n');
  const after = text.slice(end + AGENTS_END.length).replace(/^\n+/, '');
  let next = before + (after ? '\n' + after : '');
  if (next.trim() === '# AGENTS.md') next = ''; // only our scaffold remained
  if (next.trim() === '') fs.unlinkSync(filePath);
  else fs.writeFileSync(filePath, next.endsWith('\n') ? next : next + '\n');
  return 'stripped';
}

/** Strip `[mcp_servers.coldstart]` from .codex/config.toml. */
function unwireCodexMcp(cwd: string): Result {
  const filePath = path.join(cwd, '.codex', 'config.toml');
  if (!fs.existsSync(filePath)) return 'absent';
  const before = fs.readFileSync(filePath, 'utf8');
  const after = stripCodexColdstartTable(before).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  if (after.replace(/\s+/g, '') === before.replace(/\s+/g, '')) return 'absent';
  const trimmed = after.replace(/\n+$/, '');
  if (trimmed === '') fs.unlinkSync(filePath);
  else fs.writeFileSync(filePath, trimmed + '\n');
  return 'stripped';
}

/** Drop the `.coldstart/` line from .gitignore (added by init's private default). */
function removeNotebookGitignore(cwd: string): Result {
  const giPath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(giPath)) return 'absent';
  const lines = fs.readFileSync(giPath, 'utf8').split('\n');
  const kept = lines.filter((l) => { const t = l.trim(); return t !== '.coldstart/' && t !== '.coldstart'; });
  if (kept.length === lines.length) return 'absent';
  fs.writeFileSync(giPath, kept.join('\n'));
  return 'stripped';
}

/** Drop the notebook merge=union line from .gitattributes. */
function removeNotebookGitattributes(cwd: string): Result {
  const gaPath = path.join(cwd, '.gitattributes');
  if (!fs.existsSync(gaPath)) return 'absent';
  const line = '.coldstart/notebook/.raw/*.jsonl merge=union';
  const lines = fs.readFileSync(gaPath, 'utf8').split('\n');
  const kept = lines.filter((l) => l.trim() !== line);
  if (kept.length === lines.length) return 'absent';
  const next = kept.join('\n').replace(/\n+$/, '');
  if (next.trim() === '') fs.unlinkSync(gaPath);
  else fs.writeFileSync(gaPath, next + '\n');
  return 'stripped';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const CLAUDE_HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop'];
const CURSOR_HOOK_EVENTS = ['preToolUse', 'postToolUse', 'beforeSubmitPrompt', 'stop', 'subagentStop'];

export async function runUnwire(): Promise<void> {
  const cwd = process.cwd();
  const argv = process.argv.slice(3); // tokens after `unwire`
  const purge = argv.includes('--purge');

  out('');
  out('coldstart unwire');
  out(DIVIDER);
  out(`  Removing coldstart-owned wiring from ${cwd}`);
  out('');

  // Claude Code
  out('  Claude Code');
  out(`    coldstart.md  — ${label(removeFile(path.join(cwd, 'coldstart.md')))}`);
  out(`    CLAUDE.md     — ${label(unwireClaudeImport(cwd))} @coldstart.md import`);
  out(`    settings.json — ${label(stripHooksConfig(
    path.join(cwd, '.claude', 'settings.json'), 'hooks', CLAUDE_HOOK_EVENTS,
    (e) => isColdstartHookEntry(e) || isKbHookEntry(e)))} find/gs + notebook hooks`);
  out(`    .mcp.json     — ${label(unwireJsonMcp(cwd, '.mcp.json'))} MCP server`);

  // Codex
  out('  Codex');
  out(`    AGENTS.md     — ${label(unwireCodexAgents(cwd))} coldstart block`);
  out(`    hooks.json    — ${label(stripHooksConfig(
    path.join(cwd, '.codex', 'hooks.json'), 'hooks', CLAUDE_HOOK_EVENTS, isCodexHookEntry))} Codex hooks`);
  out(`    config.toml   — ${label(unwireCodexMcp(cwd))} [mcp_servers.coldstart]`);

  // Cursor
  out('  Cursor');
  out(`    coldstart.mdc — ${label(removeFile(path.join(cwd, '.cursor', 'rules', 'coldstart.mdc')))}`);
  out(`    hooks.json    — ${label(stripHooksConfig(
    path.join(cwd, '.cursor', 'hooks.json'), 'hooks', CURSOR_HOOK_EVENTS, isCursorHookEntry, ['version']))} Cursor hooks`);
  out(`    mcp.json      — ${label(unwireJsonMcp(cwd, path.join('.cursor', 'mcp.json')))} MCP server`);

  // Notebook
  out('  Notebook');
  if (purge) {
    const nb = path.join(cwd, '.coldstart', 'notebook');
    let nbRes: Result = 'absent';
    if (fs.existsSync(nb)) { fs.rmSync(nb, { recursive: true, force: true }); nbRes = 'removed'; }
    out(`    .coldstart/notebook — ${label(nbRes)} (--purge: notes deleted)`);
    out(`    .coldstartignore — ${label(removeFile(path.join(cwd, '.coldstartignore')))}`);
    out(`    .gitignore    — ${label(removeNotebookGitignore(cwd))} .coldstart/ line`);
    out(`    .gitattributes — ${label(removeNotebookGitattributes(cwd))} merge=union line`);
    rmEmptyDirs(path.join(cwd, '.coldstart'));
  } else {
    out('    .coldstart/notebook — KEPT (committed/shared notes; use --purge to delete)');
  }

  // Tidy up now-empty coldstart dirs (best-effort).
  rmEmptyDirs(
    path.join(cwd, '.cursor', 'rules'),
    path.join(cwd, '.cursor'),
    path.join(cwd, '.claude'),
    path.join(cwd, '.codex'),
  );

  out('');
  out(DIVIDER);
  out('Unwired. Re-add anytime with: coldstart init');
  if (!purge) out('The notebook was kept — `coldstart unwire --purge` also deletes it.');
  out('');
}
