/** Prompt-time file injection (hooks/file-inject.mjs) skip rules + find re-rank helpers (src/embedder/rerank.ts). */
import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — plain ESM hook module
import { injectSkipReason, MAX_TERMS } from '../hooks/file-inject.mjs';
import { queryShape, applyOrder, rerankTop } from '../src/embedder/rerank.js';

const saved = process.env.COLDSTART_EMBEDDER;
afterEach(() => { process.env.COLDSTART_EMBEDDER = saved; });

describe('file injection skip rules', () => {
  it('silent without the embedder opt-in (vitest default COLDSTART_EMBEDDER=0)', () => {
    process.env.COLDSTART_EMBEDDER = '0';
    expect(injectSkipReason('Why does the recall gate stay silent when the daemon is cold?')).toBe('embedder-off');
  });
  it('opted in: approvals and slash commands skip, a task goes', () => {
    process.env.COLDSTART_EMBEDDER = '1';
    expect(injectSkipReason('go ahead')).toBe('few-terms');
    expect(injectSkipReason('yes')).toBe('few-terms');
    expect(injectSkipReason('   ')).toBe('empty');
    expect(injectSkipReason('/capture-notes')).toBe('slash-command');
    expect(injectSkipReason('/plugin:cmd arg')).toBe('slash-command');
    expect(injectSkipReason('/Users/x/src/fooBar.ts is broken in parseQuery')).toBeNull(); // a path, not a command
    expect(injectSkipReason('Why does the recall gate stay silent when the embedder daemon is cold?')).toBeNull();
  });
});

describe('file injection term cap', () => {
  it('MAX_TERMS bounds a huge paste (B3)', () => { expect(MAX_TERMS).toBeLessThanOrEqual(40); });
});

describe('find re-rank helpers', () => {
  it('queryShape: the pilot rule (≥ 40% identifier-like tokens → id)', () => {
    expect(queryShape('how does the keeper save the cache')).toBe('prose');
    expect(queryShape('buildRichPage collectCoverage find')).toBe('id');
    expect(queryShape('src/server/find.ts rerank')).toBe('id');
    expect(queryShape('MATCHED_SYM_CAP hub cap god file')).toBe('prose'); // 1/5 id-like
  });
  it('applyOrder: re-ranked pool first, the rest in original order', () => {
    const ranked = ['a', 'b', 'c', 'd', 'e'].map((p) => [p, 0] as const);
    expect(applyOrder(ranked, ([p]) => p, ['c', 'a', 'b']).map(([p]) => p)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
  it('applyOrder: files outside the pool (tests under find --tests) keep their exact slot (B2)', () => {
    const ranked = ['a', 'T1', 'b', 'c', 'T2', 'd'].map((p) => [p, 0] as const);
    expect(applyOrder(ranked, ([p]) => p, ['c', 'b', 'a']).map(([p]) => p)).toEqual(['c', 'T1', 'b', 'a', 'T2', 'd']);
  });
  it('rerankTop: embedder off → null (today\'s order kept)', async () => {
    process.env.COLDSTART_EMBEDDER = '0';
    const r = await rerankTop({ files: new Map() } as any, '/nonexistent', ['a', 'b'], { weight: 1.5, queryText: 'x' });
    expect(r).toBeNull();
  });
});
