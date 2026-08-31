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
  describeInflight, inflightPath,
} from '../src/inflight.js';
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
