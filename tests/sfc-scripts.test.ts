/**
 * extractSfcScripts is a forward scan that replaced a regex
 * (/<script(?:\s[^>]*)?>[\s\S]*?<\/script(?:\s[^>]*)?>/gi) which was cubic on
 * a Vue/Svelte/Astro file full of unclosed `<script ` tags. The scan must find
 * exactly the blocks the regex found — this pins it against the regex itself.
 */
import { describe, it, expect } from 'vitest';
import { extractSfcScripts } from '../src/indexer/parser.js';

// The old implementation stripped the tags off each match with two
// `.replace`s; capturing the body is the same result (the open tag always
// starts the match, the lazy body ends at the first valid close tag) and
// avoids a one-pass `<script` removal, which code scanning reads as an
// incomplete HTML sanitizer.
function viaOldRegex(content: string): string | null {
  const blocks: string[] = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.length > 0 ? blocks.join('\n') : null;
}

describe('extractSfcScripts', () => {
  it('handles the real shapes: setup, lang attrs, two blocks, odd end tags', () => {
    const vue = `<template><div/></template>
<script lang="ts">export default { name: 'A' }</script>
<script setup>const a = 1</script >
<style>.x{}</style>`;
    expect(extractSfcScripts(vue)).toBe(`export default { name: 'A' }\nconst a = 1`);
    expect(extractSfcScripts('<SCRIPT>x()</script\t\n junk>')).toBe('x()');
    expect(extractSfcScripts('<scripts>no</scripts>')).toBeNull();
    expect(extractSfcScripts('<template/>')).toBeNull();
  });

  it('agrees with the regex it replaced on 50,000 random tag soups', () => {
    const parts = ['<script', '</script', '<SCRIPT', '</Script', '>', ' ', '\t', '\n', 'x', 's', '<', '/', 'a=1', ' '];
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let matched = 0;
    for (let i = 0; i < 50_000; i++) {
      let s = '';
      const n = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < n; k++) s += parts[Math.floor(rnd() * parts.length)];
      const want = viaOldRegex(s);
      if (want !== null) matched++;
      expect(extractSfcScripts(s), JSON.stringify(s)).toBe(want);
    }
    expect(matched).toBeGreaterThan(300); // the soup really exercises matches
  });

  it('is linear on a megabyte of unclosed tags (the regex was n³)', () => {
    const t0 = performance.now();
    extractSfcScripts('<script '.repeat(130_000));
    extractSfcScripts('<script>' + '</script '.repeat(110_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
