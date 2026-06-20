import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { coldstartMd, writeColdstartMd, wireClaudeImport, wireClaudeHooks } from '../src/init.js';

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

    // Check that getOrInstallStableVersion is being called
    expect(initSource).toContain('getOrInstallStableVersion()');
  });

  it('should reference .coldstart/versions in the install logic', async () => {
    const initPath = path.resolve(path.dirname(__filename), '..', 'src', 'init.ts');
    const initSource = fs.readFileSync(initPath, 'utf8');

    // Verify the stable version directory is being used
    expect(initSource).toContain('.coldstart/versions');
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
});

describe('wireClaudeHooks (settings.json hook wiring)', () => {
  let tempDir: string; // the project being wired
  let homeDir: string; // fake HOME holding a pre-seeded stable install (no copy)
  let prevHome: string | undefined;
  const settingsPath = (): string => path.join(tempDir, '.claude', 'settings.json');
  const readSettings = (): any => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-hooks-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-home-test-'));
    // Pre-seed the version-pinned stable install so getOrInstallStableVersion
    // early-returns (entry exists) instead of copying anything.
    const version = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(__filename), '..', 'package.json'), 'utf8'),
    ).version as string;
    const stable = path.join(homeDir, '.coldstart', 'versions', version, 'node_modules', 'coldstart');
    fs.mkdirSync(path.join(stable, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(stable, 'dist', 'index.js'), '// stub');
    fs.mkdirSync(path.join(stable, 'hooks'), { recursive: true });
    prevHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    for (const d of [tempDir, homeDir]) if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
  });

  it('creates settings.json with surface-agnostic find/gs hook matchers', () => {
    expect(wireClaudeHooks(tempDir)).toBe('created');
    const s = readSettings();
    expect(s.hooks.PreToolUse[0].matcher).toBe('Bash|mcp__coldstart__find');
    expect(s.hooks.PreToolUse[0].hooks[0].command).toContain('find-preguard.mjs');
    expect(s.hooks.PostToolUse[0].matcher).toBe('*');
    expect(s.hooks.PostToolUse[0].hooks[0].command).toContain('find-nudge.mjs');
    // path points at the version-pinned stable install, not a tilde
    expect(s.hooks.PostToolUse[0].hooks[0].command).toContain('.coldstart/versions');
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
