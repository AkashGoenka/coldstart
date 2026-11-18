/**
 * src/embedder/sketch.ts — the file text the embedder embeds. Must stay byte-identical to the pilot's A2 texts
 * (~/coldstart-rag build-texts.ts; checked 1897/1897 on jmri 2026-11-16) — the re-rank weights were fit on them.
 */
import { describe, it, expect } from 'vitest';
import { sketchText, sketchFilter, sketchesJsonl } from '../src/embedder/sketch.js';

describe('sketchText (A2)', () => {
  it('path as title, names in source order, deduped, Owner. qualifier stripped', () => {
    const syms = [
      { name: 'Foo.bar', startLine: 20 },
      { name: 'Foo', startLine: 1 },
      { name: 'Foo.baz', startLine: 10 },
      { name: 'Other.bar', startLine: 30 }, // bare name repeats → once
      { name: 'Foo', startLine: 40 },
    ];
    expect(sketchText('src/Foo.java', syms)).toBe('title: src/Foo.java | text: Foo baz bar');
  });
  it('no symbols → explicit placeholder', () => {
    expect(sketchText('README.md', [])).toBe('title: README.md | text: (no symbols)');
  });
  it('does not mutate the caller\'s symbol order', () => {
    const syms = [{ name: 'b', startLine: 2 }, { name: 'a', startLine: 1 }];
    sketchText('x.ts', syms);
    expect(syms.map((s) => s.name)).toEqual(['b', 'a']);
  });
});

describe('sketchFilter — data files get no vector', () => {
  const file = (n: number, test = false) => ({ symbols: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, startLine: i + 1 })), isTestFile: test });
  const mk = (entries: Array<[string, any]>) => ({ files: new Map(entries) }) as any;
  it('keeps code and symbol-less docs/site files; drops data extensions, bulk data dirs, tests', () => {
    const bulk: Array<[string, any]> = Array.from({ length: 101 }, (_, i) => [`data/raw/x${i}.txt`, file(0)]);
    const ix = mk([['src/a.ts', file(3)], ['README.md', file(0)], ['site/index.html', file(0)], ['pom.xml', file(0)],
      ['data/prices.csv', file(0)], ['tests/a.test.ts', file(2, true)], ...bulk]);
    const keep = sketchFilter(ix);
    expect(['src/a.ts', 'README.md', 'site/index.html'].every(keep) && !keep('pom.xml')).toBe(true);
    expect(['data/prices.csv', 'tests/a.test.ts', 'data/raw/x0.txt'].some(keep)).toBe(false);
    const jsonl = sketchesJsonl(ix);
    expect(jsonl.split('\n').filter(Boolean).length).toBe(3);
  });
  it('a file WITH symbols is kept even inside a bulk dir or with a data-ish extension', () => {
    const bulk: Array<[string, any]> = Array.from({ length: 101 }, (_, i) => [`gen/x${i}.txt`, file(0)]);
    const ix = mk([['gen/real.py', file(2)], ['layout.xml', file(1)], ...bulk]);
    expect(sketchFilter(ix)('gen/real.py')).toBe(true);
    expect(sketchFilter(ix)('layout.xml')).toBe(true);
  });
  it('data files WITH symbols are dropped in a bulk dir (raw XBRL dumps carry XML symbols)', () => {
    const bulk: Array<[string, any]> = Array.from({ length: 101 }, (_, i) => [`raw/x${i}.xml`, file(4)]);
    const ix = mk([['pom.xml', file(2)], ['src/Main.java', file(5)], ...bulk]);
    const keep = sketchFilter(ix);
    expect(keep('raw/x0.xml')).toBe(false);
    expect(keep('pom.xml') && keep('src/Main.java')).toBe(true);
  });
});

describe('sketchFilter — vendor code is never embedded', () => {
  const f = (lineCount = 10, tokenEstimate = 100) => ({ symbols: [{ name: 'x', startLine: 1 }], isTestFile: false, lineCount, tokenEstimate });
  it('drops vendored trees, *.min.*, minified-by-shape bundles; keeps first-party code', () => {
    const ix = { files: new Map<string, any>([
      ['src/app.ts', f()], ['vendor/lib/a.php', f()], ['node_modules/x/i.js', f()], ['third_party/z/z.cc', f()],
      ['web/chart.min.js', f()], ['web/nifty.js', f(2, 4000)], ['.venv/lib/site-packages/p/m.py', f()],
    ]) } as any;
    const keep = sketchFilter(ix);
    expect(keep('src/app.ts')).toBe(true);
    for (const p of ['vendor/lib/a.php', 'node_modules/x/i.js', 'third_party/z/z.cc', 'web/chart.min.js', 'web/nifty.js', '.venv/lib/site-packages/p/m.py'])
      expect(keep(p), p).toBe(false);
  });
});
