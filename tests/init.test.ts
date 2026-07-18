import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  coldstartMd,
  writeColdstartMd,
  wireClaudeImport,
  wireClaudeHooks,
  wireCodexHooks,
  wireCursorHooks,
  wireCursorRule,
  wireCodexAgents,
  wireCodexMcp,
  wireJsonMcp,
} from '../src/init.js';

// We can't easily test runInit interactively, but we can test that the
// MCP entry structure is correct when it's generated. This is a basic
// smoke test that validates the new node-form entries are being written.

describe('init MCP entry format', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-init-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should generate node-form MCP entries, not npx-form', async () => {
    // Read the latest init.ts and verify that buildMcpEntry generates node-form entries
    // by checking the source directly

    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // Check that buildMcpEntry function no longer returns 'npx' command
    expect(initSource).not.toMatch(/command:\s*['"]npx['"]/);

    // Check that it now returns 'node' command
    expect(initSource).toMatch(/command:\s*['"]node['"]/);

    // Check that the path is resolved from the running install
    expect(initSource).toContain('installRoot()');
  });

  it('points at the running install, not a copied version dir', async () => {
    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // The version-pinned copy is gone: no versions dir, no tree copy. Pointing
    // at the live install means `npm uninstall` disables the wired hooks.
    expect(initSource).not.toContain("'.coldstart', 'versions'");
    expect(initSource).not.toContain('cpSync');
  });

  it('should pass node_modules path as absolute, not tilde-expanded', async () => {
    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // The function should use path.join to create absolute paths
    expect(initSource).toContain('path.join(');
  });
});

describe('coldstart.md content flavors', () => {
  it('cli flavor uses shell commands; mcp flavor uses tools', () => {
    const cli = coldstartMd('cli');
    const mcp = coldstartMd('mcp');
    expect(cli).toContain('`coldstart find <terms...>`');
    expect(cli).not.toContain('the `find` tool');
    expect(mcp).toContain('the `find` tool');
    expect(mcp).not.toContain('`coldstart find <terms...>`');
  });

  it('describes the real Wired vocabulary, not the removed ~ shares rendering', () => {
    for (const mode of ['cli', 'mcp'] as const) {
      const md = coldstartMd(mode);
      expect(md).toContain('`Wired:`');
      expect(md).toContain('`near`');
      expect(md).not.toContain('~ shares');
    }
  });
});

describe('init wiring (coldstart.md import model)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-wire-test-'));
  });
  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  it('writeColdstartMd creates coldstart.md with the requested flavor', () => {
    const res = writeColdstartMd(tempDir, 'cli');
    expect(res).toBe('created');
    const body = fs.readFileSync(path.join(tempDir, 'coldstart.md'), 'utf8');
    expect(body).toContain('coldstart find');
    // second write is an update, not a create
    expect(writeColdstartMd(tempDir, 'cli')).toBe('updated');
  });

  it('wireClaudeImport creates CLAUDE.md with @coldstart.md when absent', () => {
    const res = wireClaudeImport(tempDir);
    expect(res).toBe('created');
    const body = fs.readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');
    expect(body).toContain('@coldstart.md');
  });

  it('wireClaudeImport appends the import to an existing CLAUDE.md', () => {
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# My rules\n\nSome guidance.\n');
    const res = wireClaudeImport(tempDir);
    expect(res).toBe('added');
    const body = fs.readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');
    expect(body).toContain('Some guidance.');
    expect(body).toContain('@coldstart.md');
  });

  it('wireClaudeImport is idempotent when the import already exists', () => {
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Rules\n\n@coldstart.md\n');
    expect(wireClaudeImport(tempDir)).toBe('present');
    // exactly one occurrence — no duplicate import appended
    const body = fs.readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8');
    expect(body.match(/@coldstart\.md/g)!.length).toBe(1);
  });

  it('wireClaudeImport is NOT fooled by a prose mention of @coldstart.md (2.2.0 dogfood bug)', () => {
    // Claude Code does not resolve imports inside code spans — a backticked
    // mention is documentation, not wiring. Found live: coldstart's own
    // CLAUDE.md describes the import and init skipped adding the real line.
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'),
      '# Rules\n\nSetup writes `@coldstart.md` into CLAUDE.md automatically.\n');
    expect(wireClaudeImport(tempDir)).toBe('added');
    const lines = fs.readFileSync(path.join(tempDir, 'CLAUDE.md'), 'utf8').split('\n');
    expect(lines.some((l) => l.trim() === '@coldstart.md')).toBe(true);
  });
});

describe('wireClaudeHooks (settings.json hook wiring)', () => {
  let tempDir: string; // the project being wired
  // Hooks are wired against the running install (this repo). In tests, init.ts's
  // module path resolves the package root to the repo, so hook commands point at
  // <repo>/hooks — no HOME lookup, no version-pinned copy.
  const hooksDir = path.resolve(path.dirname(__filename), '..', 'hooks');
  const settingsPath = (): string => path.join(tempDir, '.claude', 'settings.json');
  const readSettings = (): any => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-hooks-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  it('creates settings.json with surface-agnostic find/gs hook matchers', () => {
    expect(wireClaudeHooks(tempDir)).toBe('created');
    const s = readSettings();
    expect(s.hooks.PreToolUse[0].matcher).toBe('Bash|mcp__coldstart__find');
    expect(s.hooks.PreToolUse[0].hooks[0].command).toContain('find-preguard.mjs');
    expect(s.hooks.PostToolUse[0].matcher).toBe('*');
    expect(s.hooks.PostToolUse[0].hooks[0].command).toContain('find-nudge.mjs');
    // path points at the running install's hooks dir (absolute), not a tilde
    expect(s.hooks.PostToolUse[0].hooks[0].command).toContain(hooksDir);
  });

  it('merges into existing settings without clobbering and is idempotent', () => {
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        permissions: { allow: ['Read(*)'] },
        hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node /other.mjs' }] }] },
      }),
    );
    expect(wireClaudeHooks(tempDir)).toBe('updated');
    expect(wireClaudeHooks(tempDir)).toBe('updated'); // re-run
    const s = readSettings();
    expect(s.permissions).toEqual({ allow: ['Read(*)'] }); // preserved
    // foreign hook kept + exactly one of ours (no duplication across re-runs)
    expect(s.hooks.PostToolUse).toHaveLength(2);
    expect(s.hooks.PostToolUse.filter((e: any) => e.matcher === 'Write')).toHaveLength(1);
    expect(s.hooks.PostToolUse.filter((e: any) => e.matcher === '*')).toHaveLength(1);
    expect(s.hooks.PreToolUse).toHaveLength(1);
  });

  it('refuses to clobber a malformed settings.json', () => {
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ not valid json');
    const res = wireClaudeHooks(tempDir);
    expect(typeof res).toBe('object');
    expect((res as { error: string }).error).toContain('not valid JSON');
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ not valid json'); // untouched
  });
});

describe('rules-file writers (reference coldstart.md, never duplicate it)', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-rules-test-'));
  });
  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  it('wireCursorRule writes an always-applied .mdc with the full guidance inlined', () => {
    expect(wireCursorRule(tempDir, 'cli')).toBe('created');
    const body = fs.readFileSync(path.join(tempDir, '.cursor', 'rules', 'coldstart.mdc'), 'utf8');
    expect(body).toContain('alwaysApply: true');
    // full doc body is embedded, not an unresolved @file reference
    expect(body).not.toContain('@coldstart.md');
    expect(body).toContain(coldstartMd('cli'));
    // re-run overwrites in place (no duplication)
    expect(wireCursorRule(tempDir, 'cli')).toBe('updated');
    const again = fs.readFileSync(path.join(tempDir, '.cursor', 'rules', 'coldstart.mdc'), 'utf8');
    expect(again.split('alwaysApply: true').length - 1).toBe(1);
  });

  it('wireCodexAgents creates AGENTS.md with the full guidance inlined in a marked section', () => {
    expect(wireCodexAgents(tempDir, 'cli')).toBe('created');
    const body = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8');
    expect(body).toContain('<!-- coldstart:start -->');
    expect(body).toContain('<!-- coldstart:end -->');
    // full doc body is embedded, not a pointer to a sibling coldstart.md file
    expect(body).toContain(coldstartMd('cli'));
  });

  it('wireCodexAgents refreshes its block in place and preserves other content', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# AGENTS.md\n\nMy own house rules.\n');
    expect(wireCodexAgents(tempDir, 'cli')).toBe('updated');
    expect(wireCodexAgents(tempDir, 'cli')).toBe('updated'); // idempotent re-run
    const body = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8');
    expect(body).toContain('My own house rules.'); // foreign content preserved
    expect(body.match(/<!-- coldstart:start -->/g)!.length).toBe(1); // exactly one block
  });
});

describe('Cursor hooks', () => {
  let tempDir: string;
  const hooksDir = path.resolve(path.dirname(__filename), '..', 'hooks');
  const hooksPath = (): string => path.join(tempDir, '.cursor', 'hooks.json');
  const readHooks = (): any => JSON.parse(fs.readFileSync(hooksPath(), 'utf8'));

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-cursor-test-'));
  });
  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  it('wireCursorHooks writes flat {command} entries for all four hooks at the live install', () => {
    expect(wireCursorHooks(tempDir)).toBe('created');
    const c = readHooks();
    expect(c.version).toBe(1);
    // Cursor entries are flat {command} — no matcher, no nested hooks.
    expect(c.hooks.preToolUse[0].command).toContain('cursor-find-preguard.mjs');
    expect(c.hooks.preToolUse[0].command).toContain(hooksDir);
    expect(c.hooks.preToolUse[0].matcher).toBeUndefined();
    expect(c.hooks.postToolUse[0].command).toContain('cursor-find-nudge.mjs');
    expect(c.hooks.beforeSubmitPrompt[0].command).toContain('cursor-kb-recall.mjs');
    expect(c.hooks.stop[0].command).toContain('cursor-kb-elicit.mjs');
    expect(c.hooks.subagentStop[0].command).toContain('cursor-kb-elicit.mjs');
  });

  it('wireCursorHooks merges + is idempotent, preserving foreign hooks', () => {
    fs.mkdirSync(path.join(tempDir, '.cursor'), { recursive: true });
    fs.writeFileSync(hooksPath(), JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: 'node /mine/guard.mjs' }],
        afterFileEdit: [{ command: 'node /mine/format.mjs' }],
      },
    }));
    expect(wireCursorHooks(tempDir)).toBe('updated');
    expect(wireCursorHooks(tempDir)).toBe('updated');
    const c = readHooks();
    expect(c.hooks.preToolUse).toHaveLength(2); // foreign + exactly one of ours
    expect(c.hooks.preToolUse.filter((e: any) => e.command.includes('/mine/guard.mjs'))).toHaveLength(1);
    expect(c.hooks.preToolUse.filter((e: any) => e.command.includes('cursor-find-preguard'))).toHaveLength(1);
    expect(c.hooks.afterFileEdit[0].command).toContain('/mine/format.mjs'); // untouched
    expect(c.hooks.stop).toHaveLength(1);
  });

  it('wireCursorHooks refuses to clobber malformed hooks.json', () => {
    fs.mkdirSync(path.join(tempDir, '.cursor'), { recursive: true });
    fs.writeFileSync(hooksPath(), '{ nope');
    const res = wireCursorHooks(tempDir);
    expect((res as { error: string }).error).toContain('not valid JSON');
    expect(fs.readFileSync(hooksPath(), 'utf8')).toBe('{ nope');
  });
});

describe('Codex hooks + MCP writers', () => {
  let tempDir: string;
  const hooksDir = path.resolve(path.dirname(__filename), '..', 'hooks');
  const hooksPath = (): string => path.join(tempDir, '.codex', 'hooks.json');
  const readHooks = (): any => JSON.parse(fs.readFileSync(hooksPath(), 'utf8'));

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-codex-test-'));
  });
  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  it('wireCodexHooks writes separate Codex navigation and notebook entries', () => {
    expect(wireCodexHooks(tempDir)).toBe('created');
    const c = readHooks();
    expect(c.hooks.PreToolUse[0].matcher).toBe('Bash|mcp__coldstart__find');
    expect(c.hooks.PreToolUse[0].hooks[0].command).toContain('codex-find-preguard.mjs');
    expect(c.hooks.PostToolUse[0].matcher).toBe('.*'); // Codex match-all, not '*'
    expect(c.hooks.PostToolUse[0].hooks[0].command).toContain('codex-find-nudge.mjs');
    expect(c.hooks.PostToolUse[0].hooks[0].command).toContain(hooksDir);
    expect(c.hooks.UserPromptSubmit[0].hooks[0].command).toContain('codex-kb-recall.mjs');
    expect(c.hooks.Stop[0].hooks[0].command).toContain('codex-kb-elicit.mjs');
    expect(c.hooks.SubagentStop[0].hooks[0].command).toContain('codex-kb-elicit.mjs');
    expect(JSON.stringify(c)).not.toContain('node /other');
  });

  it('wireCodexHooks merges + is idempotent, preserving foreign hooks', () => {
    fs.mkdirSync(path.join(tempDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      hooksPath(),
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node /x.mjs' }] }] } }),
    );
    expect(wireCodexHooks(tempDir)).toBe('updated');
    expect(wireCodexHooks(tempDir)).toBe('updated');
    const c = readHooks();
    expect(c.hooks.PostToolUse).toHaveLength(2);
    expect(c.hooks.PostToolUse.filter((e: any) => e.matcher === 'Edit')).toHaveLength(1);
    expect(c.hooks.PostToolUse.filter((e: any) => e.matcher === '.*')).toHaveLength(1);
    expect(c.hooks.PreToolUse).toHaveLength(1);
    expect(c.hooks.UserPromptSubmit).toHaveLength(1);
    expect(c.hooks.Stop).toHaveLength(1);
    expect(c.hooks.SubagentStop).toHaveLength(1);
  });

  it('replaces legacy shared hook entries while preserving foreign hooks', () => {
    fs.mkdirSync(path.join(tempDir, '.codex'), { recursive: true });
    fs.writeFileSync(hooksPath(), JSON.stringify({ hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /old/find-preguard.mjs' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /old/kb-recall.mjs' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node /foreign/stop.mjs' }] }],
    } }));
    expect(wireCodexHooks(tempDir)).toBe('updated');
    const body = JSON.stringify(readHooks());
    expect(body).not.toContain('/old/');
    expect(body).toContain('/foreign/stop.mjs');
    expect(body).toContain('codex-kb-recall.mjs');
  });

  it('wireCodexHooks refuses to clobber malformed hooks.json', () => {
    fs.mkdirSync(path.join(tempDir, '.codex'), { recursive: true });
    fs.writeFileSync(hooksPath(), '{ nope');
    const res = wireCodexHooks(tempDir);
    expect((res as { error: string }).error).toContain('not valid JSON');
    expect(fs.readFileSync(hooksPath(), 'utf8')).toBe('{ nope');
  });

  it('wireCodexMcp writes a [mcp_servers.coldstart] table and replaces it on re-run', () => {
    expect(wireCodexMcp(tempDir, { command: 'node', args: ['/abs/index.js', '--root', tempDir] })).toBe('created');
    let toml = fs.readFileSync(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.coldstart]');
    expect(toml).toContain('command = "node"');
    expect(toml).toContain('--root');
    // re-run replaces, never duplicates the table
    expect(wireCodexMcp(tempDir, { command: 'node', args: ['/abs/index.js', '--root', tempDir] })).toBe('updated');
    toml = fs.readFileSync(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
    expect(toml.match(/\[mcp_servers\.coldstart\]/g)!.length).toBe(1);
  });

  it('wireCodexMcp preserves existing TOML content', () => {
    fs.mkdirSync(path.join(tempDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.codex', 'config.toml'),
      'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "uvx"\nargs = ["other"]\n',
    );
    wireCodexMcp(tempDir, { command: 'node', args: ['/abs/index.js'] });
    const toml = fs.readFileSync(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('model = "gpt-5"');
    expect(toml).toContain('[mcp_servers.other]');
    expect(toml).toContain('[mcp_servers.coldstart]');
  });

  it('wireJsonMcp merges into a JSON MCP config and is fail-safe', () => {
    const r = wireJsonMcp(tempDir, path.join('.cursor', 'mcp.json'), { command: 'node', args: ['/abs/index.js'] });
    expect(r).toBe('created');
    const cfg = JSON.parse(fs.readFileSync(path.join(tempDir, '.cursor', 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.coldstart.command).toBe('node');
    // malformed → untouched + error
    fs.writeFileSync(path.join(tempDir, '.mcp.json'), '{ bad');
    const bad = wireJsonMcp(tempDir, '.mcp.json', { command: 'node', args: [] });
    expect((bad as { error: string }).error).toContain('not valid JSON');
  });
});
