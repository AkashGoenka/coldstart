/**
 * The prompt reducer (hooks/prompt-terms.mjs) — port of the pilot reducer's
 * shipped `fix` variant. Parity with the pilot's saved output was checked once
 * on all 57 pilot prompts (57/57); these pin the rules that made it.
 */
import { describe, it, expect } from 'vitest';
import { reducePrompt, isId, promptModelLoadMs, loadPromptModel } from '../hooks/prompt-terms.mjs';

describe('isId', () => {
  it('accepts identifier shapes', () => {
    for (const w of ['buildRichPage', 'cache_dir', 'src/server/find.ts', 'CACHE_VERSION', 'v18', 'IO', 'ab.cd']) expect(isId(w), w).toBe(true);
  });
  it('rejects prose compounds, abbreviations and plain words', () => {
    for (const w of ['multi-file', 'symbol-table', 'e.g', 'e.g.', 'i.e.', 'Hello', 'cache']) expect(isId(w), w).toBe(false);
  });
});

describe('reducePrompt', () => {
  it('loads the model lazily', () => {
    // vitest may share the module across files; only assert the shape.
    const before = promptModelLoadMs();
    expect(before === null || typeof before === 'number').toBe(true);
    expect(loadPromptModel()).toBeGreaterThanOrEqual(0);
    expect(typeof promptModelLoadMs()).toBe('number');
  });

  it('keeps identifiers with exact spelling', () => {
    const r = reducePrompt('Why does buildRichPage read cache_dir from src/server/find.ts when CACHE_VERSION is v18?');
    expect(r.ids).toEqual(['buildRichPage', 'cache_dir', 'src/server/find.ts', 'CACHE_VERSION', 'v18']);
    expect(r.terms.slice(0, 5)).toEqual(r.ids);
  });

  it('treats multi-file and e.g. as prose, not ids', () => {
    const r = reducePrompt('a multi-file change, e.g. the resolver');
    expect(r.ids).toEqual([]);
    expect(r.terms).not.toContain('multi-file');
    expect(r.terms).not.toContain('e.g');
  });

  it('turns a quoted 2-4 word UI label into a CamelCase id', () => {
    const r = reducePrompt("Where is the 'Listen on Beans' menu item handled?");
    expect(r.ids).toContain('ListenOnBeans');
    expect(reducePrompt("click 'Save' then 'one two three four five'").ids).toEqual([]);
  });

  it('keeps nouns, drops verbs and adverbs', () => {
    const r = reducePrompt('please quickly rewrite the parser and update the watcher');
    expect(r.nouns).toEqual(expect.arrayContaining(['parser', 'watcher']));
    for (const w of ['quickly', 'rewrite', 'update', 'please']) expect(r.terms).not.toContain(w);
  });

  it('skips prompts with fewer than 2 terms', () => {
    for (const p of ['go ahead', 'yes do it', '', '   ']) expect(reducePrompt(p).skip, p).toBe(true);
    expect(reducePrompt('fix the keeper watcher').skip).toBe(false);
  });

  it('dedupes ids and nouns case-insensitively', () => {
    const r = reducePrompt('the IndexManager and indexmanager handle the Watcher; watcher events matter');
    expect(r.ids).toEqual(['IndexManager']);
    const lower = r.terms.map((t) => t.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(r.nouns.filter((n) => n.toLowerCase() === 'watcher')).toHaveLength(1);
  });

  it('strips backticks, trailing punctuation and possessive', () => {
    const r = reducePrompt("check `ensureKeeper`, then runKeeper's loop (see index-manager.ts).");
    expect(r.ids).toEqual(['ensureKeeper', 'runKeeper', 'index-manager.ts']);
    // tokens inside an identifier span are not re-added as nouns
    expect(r.nouns).not.toContain('index');
  });

  it('finishes a 20k-char prompt fast', () => {
    reducePrompt('warm up the model');
    const p = 'The keeper rebuilds the IndexManager cache when the watcher sees src/foo_bar.ts change. '.repeat(240);
    expect(p.length).toBeGreaterThan(20_000);
    const t0 = performance.now();
    const r = reducePrompt(p);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.ids).toEqual(['IndexManager', 'src/foo_bar.ts']);
  });
});

describe('ALL-CAPS gate', () => {
  it('drops emphasis words, keeps acronyms and caps identifiers', () => {
    const r = reducePrompt('Do NOT change the JSON parser, ONLY fix the MCP API. You MUST NEVER touch the DB. IMPORTANT: NOT_FOUND and HTTP2');
    for (const w of ['NOT', 'ONLY', 'MUST', 'NEVER', 'IMPORTANT']) expect(r.terms).not.toContain(w);
    for (const w of ['JSON', 'MCP', 'API', 'DB', 'NOT_FOUND', 'HTTP2']) expect(r.ids).toContain(w);
  });
  it('emphasis-only prompt reduces to nothing → skip', () => {
    expect(reducePrompt('NOT NOW, ONLY THIS').skip).toBe(true);
  });
});

describe('long tokens', () => {
  it('drops a pasted token longer than MAX_ID_LEN', () => {
    const jwt = 'eyJ' + 'a_B9'.repeat(40);
    const r = reducePrompt(`the parseQuery call fails with token ${jwt}`);
    expect(r.ids).toContain('parseQuery');
    expect(r.ids).not.toContain(jwt);
  });
});
