import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * kb-elicit.mjs always-fire contract (2026-07-05): the deep-read gate is GONE.
 * ANY touched repo file — windowed Read, Bash cat/sed, Edit — elicits; only a
 * session that touched nothing fast-exits. Tested by spawning the real hook
 * with a fixture transcript, exactly as Claude Code would.
 */
const HOOK = fileURLToPath(new URL('../hooks/kb-elicit.mjs', import.meta.url));

let root: string;
let transcript: string;
let sid = 0;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-elicit-'));
  transcript = path.join(root, 'transcript.jsonl');
  sid++;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function assistantLine(tools: Array<{ name: string; input: Record<string, unknown> }>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: tools.map((t) => ({ type: 'tool_use', name: t.name, input: t.input })) },
  });
}

function runHook(lines: string[]): string {
  fs.writeFileSync(transcript, lines.join('\n') + '\n');
  const payload = JSON.stringify({
    session_id: `elicit-test-${process.pid}-${sid}`,
    cwd: root,
    transcript_path: transcript,
    hook_event_name: 'Stop',
  });
  return execFileSync('node', [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });
}

describe('kb-elicit always-fire', () => {
  it('a WINDOWED Read alone elicits (the q8 regression: offset/limit reads used to fast-exit)', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.py'), 'x = 1\n');
    const out = runHook([
      assistantLine([{ name: 'Read', input: { file_path: path.join(root, 'src/app.py'), offset: 10, limit: 40 } }]),
    ]);
    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('src/app.py');
    expect(res.reason).toContain('MERGE vs NEW is YOUR decision');
  });

  it('a Bash cat/sed path elicits when the file exists; nonexistent shell tokens are ignored', () => {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib/util.ts'), 'export {}\n');
    const out = runHook([
      assistantLine([{ name: 'Bash', input: { command: `cat lib/util.ts && sed -n '1,5p' lib/missing.ts` } }]),
    ]);
    const res = JSON.parse(out);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('lib/util.ts');
    expect(res.reason).not.toContain('lib/missing.ts');
  });

  it('an Edit counts as touched', () => {
    fs.writeFileSync(path.join(root, 'main.go'), 'package main\n');
    const out = runHook([
      assistantLine([{ name: 'Edit', input: { file_path: path.join(root, 'main.go'), old_string: 'a', new_string: 'b' } }]),
    ]);
    expect(JSON.parse(out).decision).toBe('block');
  });

  it('FAST-EXIT only when zero repo files were touched', () => {
    const out = runHook([
      assistantLine([{ name: 'Bash', input: { command: 'git status && npm test' } }]),
      assistantLine([{ name: 'Read', input: { file_path: '/somewhere/else/entirely.md' } }]),
    ]);
    expect(out.trim()).toBe(''); // no stdout → stop allowed
  });

  it('.coldstart/ internals never count as touched', () => {
    fs.mkdirSync(path.join(root, '.coldstart'), { recursive: true });
    fs.writeFileSync(path.join(root, '.coldstart/kb-hook.log'), 'log\n');
    const out = runHook([
      assistantLine([{ name: 'Read', input: { file_path: path.join(root, '.coldstart/kb-hook.log') } }]),
    ]);
    expect(out.trim()).toBe('');
  });
});
