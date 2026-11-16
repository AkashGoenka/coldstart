/**
 * src/embedder/sketch.ts — the file text the embedder embeds. Must stay byte-identical to the pilot's A2 texts
 * (~/coldstart-rag build-texts.ts; checked 1897/1897 on jmri 2026-11-16) — the re-rank weights were fit on them.
 */
import { describe, it, expect } from 'vitest';
import { sketchText } from '../src/embedder/sketch.js';

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
