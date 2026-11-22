/**
 * hooks/embed-runtime.mjs past a role's token cap (real model; skipped without it). Code queries and file sketches
 * are TRUNCATED; notes and note queries are embedded in windows pooled token-weighted, so their tail still counts
 * (the recall gate was fit on untruncated note vectors — see TOKEN_CAPS in hooks/embed-recipe.mjs).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore — plain ESM hook modules
import { loadEmbedder } from '../hooks/embed-runtime.mjs';
// @ts-ignore
import { MODEL_ID, TOKEN_CAPS } from '../hooks/embed-recipe.mjs';

const DIR = process.env.COLDSTART_TEST_MODEL_DIR ?? join(homedir(), '.cache', 'coldstart', 'models', MODEL_ID);
const HAVE = ['tokenizer.json', 'tokenizer_config.json', 'onnx/model_q4.onnx', 'onnx/model_q4.onnx_data'].every((f) => existsSync(join(DIR, f)));
const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

describe.skipIf(!HAVE)('embed runtime past the token cap', () => {
  let e: any;
  beforeAll(async () => { e = await loadEmbedder({ dir: DIR, threads: 4 }); }, 60_000);
  const head = 'The keeper watches the repo and saves the cache. '.repeat(8);
  const tail = 'Completely different subject: astronomy, telescopes and the orbits of distant comets. '.repeat(60);

  it('code_query: a tail past 512 tokens is ignored (truncation)', async () => {
    const base = head + 'x '.repeat(600);
    expect(await e.tokens(base)).toBeGreaterThan(TOKEN_CAPS.code_query);
    const [a] = await e.embed([base], 'code_query');
    const [b] = await e.embed([base + tail], 'code_query');
    expect(cos(a, b)).toBeGreaterThan(0.99999);
  }, 60_000);

  it('note_doc: a tail past the window still moves the vector, and the result is unit length', async () => {
    const base = head.repeat(30); // past the note_doc cap → windowed
    expect(await e.tokens(base)).toBeGreaterThan(TOKEN_CAPS.note_doc);
    const [a] = await e.embed([base], 'note_doc');
    const [b] = await e.embed([base + tail], 'note_doc');
    expect(Math.abs(cos(b, b) - 1)).toBeLessThan(1e-5);
    expect(cos(a, b)).toBeLessThan(0.999);
  }, 120_000);

  it('within the cap nothing changed: batch of short texts = each alone', async () => {
    const [x, y] = await e.embed(['session cookie refresh', 'keeper save cache'], 'note_doc');
    const [x1] = await e.embed(['session cookie refresh'], 'note_doc');
    expect(cos(x, x1)).toBeGreaterThan(0.9999);
    expect(cos(x, y)).toBeLessThan(0.99);
  }, 60_000);
});
