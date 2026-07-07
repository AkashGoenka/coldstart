/**
 * Concurrency-stress regressions (2026-07-08 stress run):
 *
 * 1. Derived md writes are ATOMIC (temp + rename) — a reader of notes/<id>.md
 *    or _index.md must never see a truncated file while a concurrent kb write
 *    re-renders it. writeFileSync alone opens with O_TRUNC, so the stress
 *    hammer caught readers observing an EMPTY _index.md (2/840 reads).
 *    Atomicity itself can't be asserted single-threaded; what CAN be pinned:
 *    the rename target is correct, content is complete, and no temp files
 *    leak into notes/ (they'd pollute directory listings forever).
 *
 * 2. `kb write -` reads stdin via the stream API, not readFileSync(0) —
 *    fd-0 reads throw EAGAIN whenever stdin is a pipe that is momentarily
 *    empty (always for specs > the 64KB pipe buffer; timing-dependent below
 *    it). Spawns the real built CLI with a paced >64KB pipe write.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { kbWrite } from '../src/kb/write.js';
import { writeNoteMd, writeIndexMd, loadNote, notesDir, initSkeleton } from '../src/kb/store.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-atomic-'));
  initSkeleton(root);
  fs.writeFileSync(path.join(root, 'seed.ts'), 'export function seed(): number { return 1 }\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('atomic derived-md writes', () => {
  it('writeNoteMd + writeIndexMd land complete content with no temp-file leftovers', async () => {
    const res = await kbWrite(root, {
      type: 'file-hub',
      path: 'seed.ts',
      facets: [{ symbol: 'seed', detail: 'returns one' }],
    });
    expect(res.status).toBe('written');
    const id = (res as { id: string }).id;

    const entries = fs.readdirSync(notesDir(root));
    expect(entries).toContain(`${id}.md`);
    expect(entries).toContain('_index.md');
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([]);

    const md = fs.readFileSync(path.join(notesDir(root), `${id}.md`), 'utf8');
    expect(md).toContain('**seed**');
    const idx = fs.readFileSync(path.join(notesDir(root), '_index.md'), 'utf8');
    expect(idx.startsWith('# Notebook index')).toBe(true);
    expect(idx).toContain('seed.ts');
    expect(idx.endsWith('\n')).toBe(true);
  });

  it('re-render overwrites in place (rename onto an existing md)', async () => {
    await kbWrite(root, { type: 'file-hub', path: 'seed.ts', facets: [{ symbol: 'seed', detail: 'v1' }] });
    const res = await kbWrite(root, { type: 'file-hub', path: 'seed.ts', facets: [{ symbol: 'seed', detail: 'v2 corrected' }] }, { force: true });
    expect(res.status).toBe('written');
    const { note } = loadNote(root, (res as { id: string }).id);
    const md = fs.readFileSync(writeNoteMd(root, note!), 'utf8');
    expect(md).toContain('v2 corrected');
    expect(fs.readdirSync(notesDir(root)).filter((e) => e.includes('.tmp-'))).toEqual([]);
    writeIndexMd(root);
    expect(fs.readdirSync(notesDir(root)).filter((e) => e.includes('.tmp-'))).toEqual([]);
  });
});

describe('kb write - reads stdin as a stream (EAGAIN regression)', () => {
  const cliJs = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const haveDist = fs.existsSync(cliJs);

  it.skipIf(!haveDist)('accepts a >64KB spec through a paced pipe', async () => {
    const detail = 'lorem payload '.repeat(8000); // ~112KB — past the pipe buffer
    const spec = JSON.stringify({
      type: 'file-hub',
      path: 'seed.ts',
      facets: [{ symbol: 'bigSeed', detail }],
    });
    const child = spawn(process.execPath, [cliJs, 'kb', 'write', '-', '--root', root]);
    let out = '';
    let errS = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errS += d));
    // Paced chunks so the pipe drains mid-stream — the exact shape that made
    // readFileSync(0) throw EAGAIN.
    for (let i = 0; i < spec.length; i += 16384) {
      child.stdin.write(spec.slice(i, i + 16384));
      await new Promise((r) => setTimeout(r, 5));
    }
    child.stdin.end();
    const code = await new Promise<number>((r) => child.on('close', r));
    expect(errS).not.toContain('EAGAIN');
    expect(code).toBe(0);
    expect(out).toContain('kb write: put');
  }, 30_000);
});
