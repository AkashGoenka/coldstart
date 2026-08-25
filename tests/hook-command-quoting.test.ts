/**
 * Hook/command paths must be shell-quoted, or every hook is dead on Windows.
 *
 * A hook `command` is a shell string. The hosts hand it to a POSIX shell even
 * on Windows (Claude Code runs hooks through Git Bash), which strips every
 * backslash in an unquoted Windows path:
 *
 *   node C:\Users\me\...\hooks\find-nudge.mjs  ->  node C:Usersme...find-nudge.mjs
 *
 * node then resolves that drive-relative remainder against the cwd and the hook
 * dies with `Cannot find module` on EVERY fire. Hooks fail open, so nothing
 * surfaces — a real report had 5,555 fires and 0 successes across two weeks
 * before anyone noticed the layer was gone.
 *
 * Two guards, in the spirit of windows-hide-coverage.test.ts:
 *   1. behavioural — the wiring writers actually emit a quoted, resolvable path
 *      (and it survives a real `sh` round-trip where one is available);
 *   2. static — no new `node ${...}` command string can be added unquoted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  wireClaudeHooks,
  wireCodexHooks,
  wireCursorHooks,
  wireClaudeKbHooks,
  USER_COMMANDS,
} from '../src/init.js';

const ROOT = path.resolve(path.dirname(__filename), '..');

/** Every `command` string anywhere in a wired hooks config, at any nesting. */
function allCommands(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) allCommands(child, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'command' && typeof value === 'string') out.push(value);
      else allCommands(value, out);
    }
  }
  return out;
}

/** `node "<path>"[ args]` -> the path, or null if it isn't quoted. */
function quotedScript(command: string): string | null {
  const m = /^node "([^"]+)"(\s|$)/.exec(command);
  return m ? m[1] : null;
}

/** What a POSIX shell actually passes to node — the whole point of the fix.
 *  Skipped (returns null) where no usable `sh` exists. */
function shellArgv(command: string): string[] | null {
  try {
    const printer = command.replace(/^node\b/, 'printf "%s\\n"');
    const raw = execFileSync('sh', ['-c', printer], { encoding: 'utf8', windowsHide: true });
    return raw.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

describe('hook command paths are shell-quoted', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-quoting-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const writers: Array<[string, (cwd: string) => unknown, string[]]> = [
    ['wireClaudeHooks', wireClaudeHooks, ['.claude', 'settings.json']],
    ["wireClaudeKbHooks", wireClaudeKbHooks, ['.claude', 'settings.json']],
    ['wireCodexHooks', wireCodexHooks, ['.codex', 'hooks.json']],
    ['wireCursorHooks', wireCursorHooks, ['.cursor', 'hooks.json']],
  ];

  for (const [name, wire, configPath] of writers) {
    it(`${name} writes quoted paths that resolve to a real hook file`, () => {
      wire(tempDir);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ...configPath), 'utf8'));
      const commands = allCommands(config);
      expect(commands.length).toBeGreaterThan(0);

      for (const command of commands) {
        const script = quotedScript(command);
        expect(script, `unquoted hook command: ${command}`).not.toBeNull();
        // A quoted path is only useful if it still points at a shipped hook.
        expect(fs.existsSync(script as string), `hook script missing: ${script}`).toBe(true);
      }
    });

    it(`${name} commands survive a POSIX shell intact`, () => {
      wire(tempDir);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ...configPath), 'utf8'));
      for (const command of allCommands(config)) {
        const argv = shellArgv(command);
        if (argv === null) return; // no usable `sh` here — the static guard still applies
        expect(argv[0], `sh mangled the path in: ${command}`).toBe(quotedScript(command));
        expect(fs.existsSync(argv[0])).toBe(true);
      }
    });
  }

  it('slash-command invocations quote their path too', () => {
    for (const [key, cmd] of Object.entries(USER_COMMANDS)) {
      const invocation = cmd.invocation('$SID');
      expect(quotedScript(invocation), `unquoted invocation for ${key}: ${invocation}`).not.toBeNull();
    }
  });
});

describe('static guard: no unquoted node-command strings', () => {
  const sources = ['src/init.ts', 'hooks/capture-payload.mjs'];

  for (const rel of sources) {
    it(`${rel}: every interpolated node command is quoted`, () => {
      const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      // `node ${expr}` / `node {{PLACEHOLDER}}` with no opening quote before it.
      const unquoted = [...content.matchAll(/(?<!")\bnode (\$\{|\{\{)/g)].map(
        (m) => content.slice(0, m.index).split('\n').length,
      );
      expect(
        unquoted,
        `unquoted node command path at line(s): ${unquoted.join(', ')} — wrap it in double quotes`,
      ).toEqual([]);
    });
  }
});
