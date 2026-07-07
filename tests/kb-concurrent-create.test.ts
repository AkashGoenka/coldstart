/**
 * Concurrency-stress regressions (2026-07-08 stress run), part 2:
 *
 * 3. coinId race — two sessions creating a same-title flow at the same moment
 *    both list the raw dir before either creates a file, coin the SAME id,
 *    and their records silently merge into one note (10 concurrent creates
 *    folded down to 4 notes in the stress run). Fix: a freshly-coined id is
 *    created with O_EXCL; the loser re-coins. Verified here at the appendRecord
 *    seam (deterministic) and end-to-end with 10 real concurrent CLI processes.
 *
 * 4. anchor-symbols lost-update — the fold REPLACED an anchor's symbols array
 *    per record, so concurrent facet writers (each stamping an array built
 *    from the stale note state they saw) dropped each other's symbols
 *    (20 writers → 4 symbols survived). Fix: fold unions symbols by name;
 *    pruning = retract the anchor, re-put it with the trimmed list.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fold } from '../src/kb/fold.js';
import { appendRecord, readLog, listIds } from '../src/kb/raw-log.js';
import { initSkeleton } from '../src/kb/store.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-kb-conc-'));
  initSkeleton(root);
  fs.writeFileSync(path.join(root, 'seed.ts'), 'export function seed(): number { return 1 }\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('exclusive create for freshly-coined ids', () => {
  it('appendRecord with exclusive throws EEXIST when the log already exists', () => {
    const input = { id: 'race-probe', type: 'flow', op: 'put', title: 'race probe', summary: 's' } as const;
    appendRecord(root, { ...input }, { exclusive: true });
    expect(() => appendRecord(root, { ...input }, { exclusive: true })).toThrowError(/EEXIST/);
    // Non-exclusive append to an existing log stays legal (merges, --into etc.).
    expect(() => appendRecord(root, { ...input })).not.toThrow();
    expect(readLog(root, 'race-probe').records).toHaveLength(2);
  });

  const cliJs = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const haveDist = fs.existsSync(cliJs);

  it.skipIf(!haveDist)('10 concurrent same-title creates yield 10 distinct notes, never a silent merge', async () => {
    const write = (i: number): Promise<{ code: number; out: string }> =>
      new Promise((res) => {
        const p = spawn(process.execPath, [cliJs, 'kb', 'write', '-', '--root', root, '--new']);
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stdin.end(JSON.stringify({
          type: 'flow',
          title: 'concurrent same title collision probe',
          summary: `writer ${i} distinct concept`,
          steps: [{ path: 'seed.ts', role: 'entry' }],
        }));
        p.on('close', (code) => res({ code: code ?? -1, out }));
      });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => write(i)));
    expect(rs.filter((r) => r.code === 0)).toHaveLength(10);
    const ids = rs.map((r) => (r.out.match(/put → (\S+)/) ?? [])[1]).filter(Boolean);
    expect(new Set(ids).size).toBe(10);
    // one record per log — nothing merged
    for (const id of ids) expect(readLog(root, id).records).toHaveLength(1);
    expect(listIds(root)).toHaveLength(10);
  }, 60_000);
});

describe('fold unions anchor symbols', () => {
  const rec = (over: Record<string, unknown>): Record<string, unknown> => ({
    v: 1, id: 'seed-note', type: 'file', op: 'put', ...over,
  });

  it('concurrent-shaped records (each stamping a stale symbols array) keep every symbol', () => {
    // Writer A saw symbols []; writer B also saw [] — neither array carries the
    // other's symbol. Pre-fix, B's array replaced A's.
    const { note } = fold('seed-note', [
      rec({ ts: '2026-07-08T00:00:01Z', character: 'hub', anchors: [{ path: 'seed.ts', symbols: ['fnA'] }], facets: [{ symbol: 'fnA', detail: 'a' }] }),
      rec({ ts: '2026-07-08T00:00:02Z', anchors: [{ path: 'seed.ts', symbols: ['fnB'] }], facets: [{ symbol: 'fnB', detail: 'b' }] }),
      rec({ ts: '2026-07-08T00:00:03Z', anchors: [{ path: 'seed.ts', symbols: ['fnC'] }], facets: [{ symbol: 'fnC', detail: 'c' }] }),
    ]);
    expect(note!.anchors[0].symbols).toEqual(['fnA', 'fnB', 'fnC']);
    expect(note!.facets.map((f) => f.symbol)).toEqual(['fnA', 'fnB', 'fnC']);
  });

  it('hash/head still update and duplicate symbols do not accumulate', () => {
    const { note } = fold('seed-note', [
      rec({ ts: '2026-07-08T00:00:01Z', character: 'hub', anchors: [{ path: 'seed.ts', symbols: ['fnA'], hash: 'sha256:old' }] }),
      rec({ ts: '2026-07-08T00:00:02Z', anchors: [{ path: 'seed.ts', symbols: ['fnA', 'fnB'], hash: 'sha256:new' }] }),
    ]);
    expect(note!.anchors[0].symbols).toEqual(['fnA', 'fnB']);
    expect(note!.anchors[0].hash).toBe('sha256:new');
  });

  it('pruning escape hatch: retract the anchor, re-put the trimmed list', () => {
    const { note } = fold('seed-note', [
      rec({ ts: '2026-07-08T00:00:01Z', character: 'hub', anchors: [{ path: 'seed.ts', symbols: ['fnA', 'renamedAway'] }] }),
      rec({ ts: '2026-07-08T00:00:02Z', op: 'retract', target: { kind: 'anchor', key: 'seed.ts' } }),
      rec({ ts: '2026-07-08T00:00:03Z', anchors: [{ path: 'seed.ts', symbols: ['fnA'] }] }),
    ]);
    expect(note!.anchors[0].symbols).toEqual(['fnA']);
  });
});
