/**
 * Evidence collection must understand the absolute paths its own host emits.
 *
 * On Windows, Claude Code / Cursor / Codex all report `file_path` as
 * `D:\repo\src\a.ts`. The old normRel tested `s.startsWith("/")`, so a Windows
 * path fell through to the "already relative" branch and was returned VERBATIM
 * — it matched no repo file, and every Windows session collected zero
 * evidence. Nothing threw; capture simply never had anything to work with,
 * which is why it survived so long undetected.
 *
 * These assertions run the platform's own absolute-path shape through the real
 * exported entry point, so they stay meaningful on macOS and Linux too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractEvidence } from '../hooks/evidence.mjs';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-evidence-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2;\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

let nextId = 0;

/**
 * A complete Claude Code tool call: the assistant's tool_use PLUS the user
 * tool_result that confirms it. extractEvidence deliberately commits nothing
 * until the result arrives (an errored or interrupted call proves nothing), so
 * a fixture with only the first half records no evidence at all.
 */
function toolCall(name: string, input: Record<string, unknown>): string {
  const id = `t${++nextId}`;
  return [
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
    }),
  ].join('\n');
}

describe('evidence collection accepts the host\'s native absolute paths', () => {
  it('an OS-native absolute file_path resolves to a forward-slash repo id', () => {
    // path.join gives `D:\root\src\a.ts` on Windows, `/root/src/a.ts` on POSIX
    // — exactly what each host actually emits on that platform.
    const ev = extractEvidence(toolCall('Read', { file_path: path.join(root, 'src', 'a.ts') }), root);
    expect(ev.get('src/a.ts')?.reads).toBe(1);
  });

  it('an edit through a native absolute path is recorded as an edit', () => {
    const ev = extractEvidence(toolCall('Write', { file_path: path.join(root, 'src', 'b.ts') }), root);
    expect(ev.get('src/b.ts')?.edits).toBe(1);
  });

  it('a repo-relative path still works, with or without a leading ./', () => {
    const ev = extractEvidence(
      [toolCall('Read', { file_path: 'src/a.ts' }), toolCall('Read', { file_path: './src/b.ts' })].join('\n'),
      root,
    );
    expect(ev.get('src/a.ts')?.reads).toBe(1);
    expect(ev.get('src/b.ts')?.reads).toBe(1);
  });

  it('a file outside the repo contributes nothing', () => {
    const outside = path.join(path.dirname(root), 'somewhere-else', 'x.ts');
    const ev = extractEvidence(toolCall('Read', { file_path: outside }), root);
    expect([...ev.keys()]).toEqual([]);
  });

  it('a sibling root sharing a name prefix is not treated as inside', () => {
    // `<root>-backup/x.ts` — the old `root + "/"` prefix test got this wrong.
    const sibling = path.join(`${root}-backup`, 'x.ts');
    const ev = extractEvidence(toolCall('Read', { file_path: sibling }), root);
    expect([...ev.keys()]).toEqual([]);
  });

  it('native separators inside a relative path are normalised to the id form', () => {
    const nativeRel = ['src', 'a.ts'].join(path.sep);
    const ev = extractEvidence(toolCall('Read', { file_path: nativeRel }), root);
    expect(ev.get('src/a.ts')?.reads).toBe(1);
  });
});
