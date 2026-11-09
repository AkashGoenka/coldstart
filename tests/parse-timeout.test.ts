/**
 * A file that hangs the parser is skipped after the time limit; the build
 * carries on. See src/indexer/parse-guard.ts.
 *
 * The hang is real (a synchronous spin, the event loop blocked), planted by
 * making the content-token scan spin on a marker string — the same place, and
 * the same kind of spin, as the backtracking-regex hangs of #165 and #181.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HANG_MARKER = '__COLDSTART_TEST_HANG__';

vi.mock('../src/indexer/content-tokens.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/indexer/content-tokens.js')>();
  return {
    ...real,
    extractContentTokens: (content: string, id: string) => {
      if (content.includes(HANG_MARKER)) { for (;;) { /* spin: the event loop is dead */ } }
      return real.extractContentTokens(content, id);
    },
  };
});

import { runWithTimeout, ParseTimeoutError } from '../src/indexer/parse-guard.js';
import { parseFile } from '../src/indexer/parser.js';
import { buildIndex } from '../src/index.js';
import { readRepairTail } from '../src/keeper-state.js';

let tmp: string;
let prevHome: string | undefined;
let prevMs: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-parse-timeout-'));
  prevHome = process.env.COLDSTART_HOME;
  prevMs = process.env.COLDSTART_PARSE_TIMEOUT_MS;
  process.env.COLDSTART_HOME = path.join(tmp, 'home');
  process.env.COLDSTART_PARSE_TIMEOUT_MS = '300';
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COLDSTART_HOME; else process.env.COLDSTART_HOME = prevHome;
  if (prevMs === undefined) delete process.env.COLDSTART_PARSE_TIMEOUT_MS; else process.env.COLDSTART_PARSE_TIMEOUT_MS = prevMs;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, body: string): string {
  const p = path.join(tmp, 'repo', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

describe('runWithTimeout', () => {
  it('stops a catastrophic regex and a plain spin', () => {
    const t = Date.now();
    // A backreference: V8's linear fallback (hooks/regex-engine.mjs, switched
    // on in this process by importing src/index.ts) cannot run it, so it still
    // backtracks forever — exactly the case this time limit is the net for.
    // Built from pieces at runtime ON PURPOSE: it is a deliberate backtracking
    // bomb (the input this guard exists for), and as a literal CodeQL's
    // js/redos flags it as a vulnerability. tests/regex-safety.test.ts keeps
    // its known-bad regexes as strings for the same reason.
    const bomb = new RegExp(['^(a+)+', '\\1$'].join(''));
    expect(() => runWithTimeout(() => bomb.test('a'.repeat(32) + '!'), 200)).toThrow(ParseTimeoutError);
    expect(() => runWithTimeout(() => { for (;;) { /* spin */ } }, 200)).toThrow(ParseTimeoutError);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('returns the value and rethrows other errors unchanged', () => {
    expect(runWithTimeout(() => 42, 1000)).toBe(42);
    const boom = new TypeError('boom');
    expect(() => runWithTimeout(() => { throw boom; }, 1000)).toThrow(boom);
  });
});

describe('parseFile under the time limit', () => {
  it('a hanging file comes back path-only and flagged, not hung', async () => {
    const p = write('src/hang.ts', `export const x = 1; // ${HANG_MARKER}\n`);
    const parsed = await parseFile(p, 'typescript', 'src/hang.ts');
    expect(parsed?.timedOut).toBe(true);
    expect(parsed?.symbols).toEqual([]);
    expect(parsed?.exports).toEqual([]);
    expect(parsed?.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('tree-sitter stopped mid-parse leaves later parses byte-identical', async () => {
    // Real files in several grammars: the baseline, before anything is stopped.
    const samples: Array<[string, Parameters<typeof parseFile>[1]]> = [
      ['src/indexer/parser.ts', 'typescript'],
      ['src/index.ts', 'typescript'],
      ['hooks/evidence.mjs', 'javascript'],
    ];
    const py = write('m.py', 'import os\n\nclass A:\n    def f(self):\n        return os.getcwd()\n\ndef g():\n    return A()\n');
    const rb = write('m.rb', 'class Foo < Bar\n  has_many :items\n  def baz; end\nend\n');
    const all: Array<[string, Parameters<typeof parseFile>[1]]> = [
      ...samples.map(([rel, lang]) => [path.resolve(__dirname, '..', rel), lang] as [string, typeof lang]),
      [py, 'python'], [rb, 'ruby'],
    ];
    const baseline = [];
    for (const [abs, lang] of all) baseline.push(await parseFile(abs, lang, abs));

    // A big file whose tree-sitter parse alone takes ~70ms (measured), run
    // first after ~1-2ms of hashing/splitting. Limits of 3..17ms therefore
    // stop it INSIDE the wasm parse — the case where a half-updated parser
    // could poison later files.
    const big = write('big.ts', Array.from({ length: 4000 }, (_, i) =>
      `export function fn${i}(a: number, b: string): number { if (a > ${i}) { return a + b.length; } return ${i}; }`).join('\n'));
    let stopped = 0;
    for (let ms = 3; ms < 18; ms++) {
      process.env.COLDSTART_PARSE_TIMEOUT_MS = String(ms);
      if ((await parseFile(big, 'typescript', 'big.ts'))?.timedOut) stopped++;
    }
    expect(stopped).toBeGreaterThan(10);

    process.env.COLDSTART_PARSE_TIMEOUT_MS = '30000';
    const after = [];
    for (const [abs, lang] of all) after.push(await parseFile(abs, lang, abs));
    expect(after).toEqual(baseline);
    // And the big file itself parses fully once given time.
    const full = await parseFile(big, 'typescript', 'big.ts');
    expect(full?.timedOut).toBeUndefined();
    expect(full?.exports.length).toBe(4000);
  }, 60_000);
});

describe('a build with one hanging file', () => {
  it('finishes, indexes the rest fully, the hanging file by path, and logs it', async () => {
    for (let i = 0; i < 30; i++) write(`src/a${i}.ts`, `export const f${i} = () => ${i};\n`);
    write('src/hang.ts', `export const stuck = 1; // ${HANG_MARKER}\n`);
    const root = path.join(tmp, 'repo');

    const t = Date.now();
    const index = await buildIndex(root, [], [], true);
    expect(Date.now() - t).toBeLessThan(10_000);

    expect(index.files.size).toBe(31);
    const hang = [...index.files.values()].find(f => f.relativePath === 'src/hang.ts');
    expect(hang).toBeDefined();
    expect(hang!.exports).toEqual([]);
    const normal = [...index.files.values()].find(f => f.relativePath === 'src/a7.ts');
    expect(normal!.exports).toContain('f7');

    const repairs = readRepairTail(root, 5);
    expect(repairs.some(r => r.event === 'parse-timeout' && r.detail.includes('src/hang.ts'))).toBe(true);
  }, 30_000);
});
