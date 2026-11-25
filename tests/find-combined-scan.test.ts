import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { collectCoverage } from '../src/server/find.js';
import type { CodebaseIndex } from '../src/types.js';

/**
 * find's ripgrep body lane runs ONE `rg -l` carrying every term, then tests each candidate file per term
 * (scanCombinedRg). It must produce the SAME file → terms table as the old one-scan-per-term path
 * (COLDSTART_FIND_SCAN=perterm). Each fixture below is a case where a cheaper shortcut breaks:
 *   - overlap: `rg -o` multi-pattern matches are non-overlapping, "panelogix" would hide `logix`
 *   - nesting: Reporter ⊂ Reporters ⊂ ExpressionReporter
 *   - case folds rg -i applies that a naive lowercase misses: ſ (U+017F) ~ s, K (U+212A) ~ k
 *   - encodings rg transcodes: UTF-16 LE/BE with a BOM (the one real bug found while verifying), UTF-8 BOM
 * Without any ripgrep on the machine both modes take the same fallback, so the equality still holds.
 */
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-scan-')); });
afterEach(() => { delete process.env['COLDSTART_FIND_SCAN']; fs.rmSync(root, { recursive: true, force: true }); });

function fixtureIndex(files: Record<string, string | Buffer>): CodebaseIndex {
  const map = new Map<string, { path: string; symbols: { name: string }[] }>();
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    map.set(rel, { path: abs, symbols: [] });
  }
  return { rootDir: root, files: map } as unknown as CodebaseIndex;
}

const table = (cov: Map<string, Set<string>>): Record<string, string[]> =>
  Object.fromEntries([...cov].map(([f, s]) => [f, [...s].sort()]).sort(([a], [b]) => (a as string).localeCompare(b as string)));

async function bothModes(index: CodebaseIndex, terms: string[]) {
  process.env['COLDSTART_FIND_SCAN'] = 'perterm';
  const perterm = table(await collectCoverage(index, root, terms));
  delete process.env['COLDSTART_FIND_SCAN'];
  const combined = table(await collectCoverage(index, root, terms));
  return { perterm, combined };
}

const utf16be = (s: string): Buffer => { const le = Buffer.from('﻿' + s, 'utf16le'); return Buffer.from(le).swap16(); };

describe('find combined rg scan = per-term scans', () => {
  const index = () => fixtureIndex({
    'src/overlap.ts': 'export const a = panelogix;\n',
    'src/nested.ts': 'export class Reporters {}\nexport const e = ExpressionReporter;\n',
    'src/longs.ts': 'export const s = "ſtate";\n',
    'src/kelvin.ts': 'export const k = "Kelvin";\n',
    'src/crlf.ts': 'export const c = 1;\r\nfrobnicate();\r\n',
    'src/utf16le.ts': Buffer.from('﻿export const u = "zebracorn frobnicate";\n', 'utf16le'),
    'src/utf16be.ts': utf16be('export const b = "quokkafy";\n'),
    'src/utf8bom.ts': '﻿export const m = "quokkafy zebracorn";\n',
    'src/plain.ts': 'export const p = "nothing to see";\n',
  });

  it.each([
    [['panel', 'logix']],
    [['Reporter', 'Reporters', 'ExpressionReporter']],
    [['state', 'kelvin']],
    [['frobnicate', 'zebracorn']],
    [['quokkafy', 'zebracorn', 'frobnicate']],
    [['ogix', 'pane', 'elvin', 'tate']],
  ])('identical table for %j', async (terms) => {
    const { perterm, combined } = await bothModes(index(), terms);
    expect(combined).toEqual(perterm);
  });

  it('finds terms hidden from a match-attribution shortcut and in UTF-16 files', async () => {
    const { combined } = await bothModes(index(), ['panel', 'logix', 'quokkafy', 'frobnicate']);
    expect(combined['src/overlap.ts']).toEqual(['logix', 'panel']);
    expect(combined['src/utf16be.ts']).toEqual(['quokkafy']);
    expect(combined['src/utf16le.ts']).toEqual(['frobnicate']);
    expect(combined['src/plain.ts']).toBeUndefined();
  });
});
