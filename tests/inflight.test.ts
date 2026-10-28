/**
 * Tests for the in-flight record — the thing that names what a hung build was
 * chewing on. The ordering test is the important one: the first version of
 * this feature marked at the call site and confidently reported an innocent
 * file while a different one span the CPU.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  markInflight, clearInflight, readInflight, readStaleInflight,
  describeInflight, inflightPath, slowFileMs, SLOW_FILE_MS,
} from '../src/inflight.js';
import { buildProgressLine } from '../src/keeper.js';
import { parseFile } from '../src/indexer/parser.js';

const DEAD_PID = 0x7ffffff0; // above any real pid on either platform

describe('inflight record', () => {
  let home: string;
  let root: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.COLDSTART_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inflight-home-'));
    process.env.COLDSTART_HOME = home;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inflight-root-'));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.COLDSTART_HOME;
    else process.env.COLDSTART_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records the unit of work, creating the cache dir on first write', () => {
    expect(fs.existsSync(inflightPath(root))).toBe(false);
    markInflight(root, 'parse', 'app/models/poison.rb');
    const rec = readInflight(root);
    expect(rec?.phase).toBe('parse');
    expect(rec?.file).toBe('app/models/poison.rb');
    expect(rec?.pid).toBe(process.pid);
  });

  it('is overwritten in place — it answers "what now", not "what happened"', () => {
    markInflight(root, 'parse', 'a.ts');
    markInflight(root, 'parse', 'b.ts');
    expect(readInflight(root)?.file).toBe('b.ts');
  });

  it('clearing it means a completed build can never read as a hang', () => {
    markInflight(root, 'graph');
    clearInflight(root);
    expect(readInflight(root)).toBeNull();
    expect(readStaleInflight(root)).toBeNull();
  });

  it('a record from a LIVE process is ordinary progress, not a failure', () => {
    markInflight(root, 'parse', 'a.ts'); // stamps our own (live) pid
    expect(readInflight(root)).not.toBeNull();
    expect(readStaleInflight(root)).toBeNull();
  });

  it('a record OUTLIVING its process is the smoking gun', () => {
    markInflight(root, 'parse', 'app/models/poison.rb');
    const p = inflightPath(root);
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    rec.pid = DEAD_PID;
    fs.writeFileSync(p, JSON.stringify(rec));

    const died = readStaleInflight(root);
    expect(died).not.toBeNull();
    expect(describeInflight(died!)).toBe('parse app/models/poison.rb');
  });

  it('carries the build percentage, so status and init can show it', () => {
    markInflight(root, 'parse', 'config/x.rb', { done: 4000, total: 12512 });
    const rec = readInflight(root)!;
    expect(describeInflight(rec)).toBe('parse 4,000 / 12,512 (31%) config/x.rb');
    // A death names how far it got, too.
    expect(describeInflight({ ...rec, pid: DEAD_PID })).toContain('4,000 / 12,512');
  });

  it('times a file from its FIRST mark — a second mark on the same file must not reset the clock', () => {
    markInflight(root, 'parse', 'slow.rb', { done: 1, total: 2 });
    const first = readInflight(root)!.fileSince!;
    markInflight(root, 'parse', 'slow.rb', { done: 1, total: 2 }); // content-token pass
    expect(readInflight(root)!.fileSince).toBe(first);
    markInflight(root, 'parse', 'next.rb', { done: 2, total: 2 });
    expect(readInflight(root)!.fileSince).toBeGreaterThanOrEqual(first);
    expect(readInflight(root)!.file).toBe('next.rb');
  });

  it('a file is only called slow past SLOW_FILE_MS', () => {
    const rec = { pid: process.pid, phase: 'parse' as const, file: 'a.rb', at: 0, fileSince: 1_000 };
    expect(slowFileMs(rec, 1_000 + SLOW_FILE_MS - 1)).toBeNull();
    expect(slowFileMs(rec, 1_000 + SLOW_FILE_MS)).toBe(SLOW_FILE_MS);
    expect(slowFileMs({ ...rec, file: undefined }, 1e12)).toBeNull();
  });

  it('init prints count, file and elapsed time, and flags a stuck file', () => {
    const rec = { pid: process.pid, phase: 'parse' as const, file: 'config/x.rb', at: 0, fileSince: 0, done: 4000, total: 12512 };
    expect(buildProgressLine(rec, 41_000, 5_000))
      .toBe('[coldstart] parsing 4,000 / 12,512 (31%) · config/x.rb · 41s');
    expect(buildProgressLine(rec, 41_000, 12_000))
      .toBe('[coldstart] parsing 4,000 / 12,512 (31%) · config/x.rb · 41s (slow: 12s on this file)');
    expect(buildProgressLine({ pid: process.pid, phase: 'resolve', at: 0 }, 50_000))
      .toBe('[coldstart] resolving imports · 50s');
    // No record, or one left by a dead process, is not progress.
    expect(buildProgressLine(null, 5_000)).toBe('[coldstart] keeper is building the index… · 5s');
    expect(buildProgressLine({ ...rec, pid: DEAD_PID }, 5_000)).toBe('[coldstart] keeper is building the index… · 5s');
  });

  it('survives a corrupt record rather than taking the caller down', () => {
    fs.mkdirSync(path.dirname(inflightPath(root)), { recursive: true });
    fs.writeFileSync(inflightPath(root), '{not json');
    expect(readInflight(root)).toBeNull();
    expect(readStaleInflight(root)).toBeNull();
  });

  it('parseFile announces work AFTER its awaits, so a batch cannot mis-attribute', async () => {
    // The bug this pins: parseFile awaits a grammar load and a file read. The
    // caller runs 100 files through Promise.all, so if the mark is set at the
    // call site every file in the batch marks itself before ANY of them
    // reaches the CPU-bound section — and the record then names the last file
    // started rather than the one actually running.
    const file = path.join(root, 'sample.ts');
    fs.writeFileSync(file, 'export const alpha = 1;\n');

    const order: string[] = [];
    order.push('call-site');
    await parseFile(file, 'typescript', 'sample.ts', () => order.push('on-work'));

    // onWork fired, and strictly after the call site — i.e. past the awaits.
    expect(order).toContain('on-work');
    expect(order[0]).toBe('call-site');
  });

  it('two files parsed concurrently each announce their own work', async () => {
    const a = path.join(root, 'a.ts');
    const b = path.join(root, 'b.ts');
    fs.writeFileSync(a, 'export const a = 1;\n');
    fs.writeFileSync(b, 'export const b = 2;\n');

    const announced: string[] = [];
    await Promise.all([
      parseFile(a, 'typescript', 'a.ts', () => announced.push('a.ts')),
      parseFile(b, 'typescript', 'b.ts', () => announced.push('b.ts')),
    ]);
    expect(announced).toContain('a.ts');
    expect(announced).toContain('b.ts');
  });
});
