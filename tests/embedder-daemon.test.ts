/**
 * Embedder daemon lifecycle (hooks/embedder-daemon.mjs + hooks/embed-client.mjs) — one test per bug the step-2
 * verifier reproduced (B1–B4), plus client basics. Real model, real processes: needs the model files (skipped
 * otherwise). Isolation: a temp COLDSTART_HOME, and a temp model dir of SYMLINKS to the real files, so the
 * daemon's writes (.verified.json, lock) land in the temp dir and the real model cache is only ever read.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — plain ESM hook modules
import { request, ensureEmbedder, embedTexts, registerRepo, notifyEmbedder } from '../hooks/embed-client.mjs';
// @ts-ignore
import { MODEL_ID, RECIPE, DIM, embedKey, socketPath, vectorsDir } from '../hooks/embed-recipe.mjs';
// @ts-ignore
import { openReader } from '../hooks/vector-store.mjs';

const SRC_MODEL = process.env.COLDSTART_TEST_MODEL_DIR ?? join(homedir(), '.cache', 'coldstart', 'models', MODEL_ID);
const FILES = ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model_q4.onnx', 'onnx/model_q4.onnx_data'];
const HAVE_MODEL = FILES.every((f) => existsSync(join(SRC_MODEL, f)));
const DAEMON = fileURLToPath(new URL('../hooks/embedder-daemon.mjs', import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => Promise<T> | T, ms = 60_000, every = 200): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(every); }
}

let root: string, home: string, models: string, cacheDir: string;
const saved = { ...process.env };
function linkModel(into: string, { corruptTokenizer = false } = {}) {
  const d = join(into, MODEL_ID);
  mkdirSync(join(d, 'onnx'), { recursive: true });
  for (const f of FILES) {
    if (corruptTokenizer && f === 'tokenizer.json') continue;
    symlinkSync(join(SRC_MODEL, f), join(d, f));
  }
  if (corruptTokenizer) writeFileSync(join(d, 'tokenizer.json'), '{ not json'); // wrong size → downloader must fetch → fails
}
function makeCache(texts: string[]) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'meta.json'), JSON.stringify({ gen: 1 }));
  writeFileSync(join(cacheDir, 'g1-sketches.jsonl'), texts.map((t, i) => JSON.stringify({ path: `f${i}.ts`, text: `title: f${i}.ts | text: ${t}` })).join('\n') + '\n');
}
const status = () => request({ op: 'status' }, { connectMs: 300, budgetMs: 1500 });
const repoStatus = async () => (await status())?.repos?.[root];
const stopAll = async () => { await request({ op: 'stop' }, { connectMs: 200, budgetMs: 1000 }); await until(async () => !(await request({ op: 'ping' }, { connectMs: 100, budgetMs: 200 })), 10_000).catch(() => {}); };

beforeEach(() => {
  // short base: the socket path must stay under ~100 bytes
  const base = mkdtempSync(join(tmpdir(), 'ed-'));
  root = join(base, 'repo'); home = join(base, 'h'); models = join(base, 'm'); cacheDir = join(base, 'cache');
  mkdirSync(join(root, '.coldstart', 'notebook', 'notes'), { recursive: true });
  Object.assign(process.env, { COLDSTART_HOME: home, COLDSTART_MODEL_DIR: models, COLDSTART_EMBEDDER: '1', COLDSTART_EMBEDDER_PACE: '0',
    COLDSTART_MODEL_URL: 'http://127.0.0.1:9/' }); // any download attempt fails fast — never the network
});
afterEach(async () => {
  await stopAll();
  process.env = { ...saved };
  rmSync(join(root, '..'), { recursive: true, force: true });
});

describe('embed client (no daemon)', () => {
  it('no daemon → null fast; embedder off → disabled and nothing created', async () => {
    const t0 = Date.now();
    expect(await request({ op: 'ping' }, { connectMs: 200, budgetMs: 200 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(600);
    process.env.COLDSTART_EMBEDDER = '0';
    expect(await ensureEmbedder()).toBe('disabled');
    await notifyEmbedder('sketches-saved', root, cacheDir);
    expect(existsSync(home)).toBe(false);
  });
  it('a listener that accepts and never replies → null within the budget', async () => {
    mkdirSync(join(home, 'embedder'), { recursive: true });
    const conns: any[] = [];
    const srv: Server = createServer((c) => { conns.push(c); /* silent: accepts, never replies */ });
    await new Promise<void>((r) => srv.listen(socketPath(), r));
    try {
      const t0 = Date.now();
      expect(await request({ op: 'ping' }, { connectMs: 200, budgetMs: 300 })).toBeNull();
      expect(Date.now() - t0).toBeLessThan(900);
    } finally { conns.forEach((c) => c.destroy()); await new Promise((r) => srv.close(r)); }
  });
});

describe.skipIf(!HAVE_MODEL)('embedder daemon lifecycle (real model)', () => {
  it('backfills, then a restart re-embeds nothing; stored vectors equal fresh ones', async () => {
    linkModel(models); makeCache(['alpha beta', 'gamma delta', 'session cookie refresh', 'keeper save cache']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    const r = await until(async () => { const s = await repoStatus(); return s?.status === 'done' && s; });
    expect(r).toMatchObject({ total: 4, done: 4 });
    await stopAll();
    expect(await ensureEmbedder()).toBe('spawned');
    const r2 = await until(async () => { const s = await repoStatus(); return s?.lastReconcileAt && s; });
    expect(r2).toMatchObject({ total: 4, done: 4, queued: 0 });
    const log = readFileSync(join(home, 'embedder', 'embedder.log'), 'utf8');
    expect(log).toMatch(/4\/4 stored, 0 to embed/);
    const text = 'title: f2.ts | text: session cookie refresh';
    const stored = openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get([embedKey('file_doc', text)]);
    const [fresh] = (await embedTexts([text], 'file_doc', { budgetMs: 5000 }))!;
    const v = [...stored.values()][0] as Float32Array;
    expect(v.reduce((a, x, j) => a + x * fresh[j], 0)).toBeGreaterThan(0.9999);
  }, 120_000);

  it('B1: answers pings while a long inference runs, so clients never spawn a second daemon', async () => {
    linkModel(models); makeCache(['x']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    const first = await until(async () => { const s = await status(); return s?.model?.status === 'ready' && s; });
    const long = Array.from({ length: 16 }, (_, i) => `function ${i} `.repeat(600));
    const job = embedTexts(long, 'code_query', { budgetMs: 60_000 });
    await wait(150); // inference in flight
    const pings = await Promise.all(Array.from({ length: 5 }, () => request({ op: 'ping' }, { connectMs: 200, budgetMs: 300 })));
    expect(pings.every((p: any) => p?.pid === first.pid)).toBe(true);
    expect(await ensureEmbedder()).toBe('running');
    expect((await job)?.length).toBe(16);
  }, 120_000);

  it('B2: a daemon shutting down never deletes a replacement daemon\'s socket', async () => {
    linkModel(models); makeCache(['x']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    const a = await until(async () => { const s = await status(); return s?.model?.status === 'ready' && s; });
    unlinkSync(socketPath()); // A is now unreachable; B takes over the path
    const b = spawn(process.execPath, [DAEMON], { env: process.env, stdio: 'ignore', detached: true }); b.unref();
    const pb = await until(async () => { const p = await request({ op: 'ping' }); return p && p.pid !== a.pid && p; });
    process.kill(a.pid, 'SIGTERM'); // A's graceful shutdown must leave B's socket alone
    await until(() => { try { process.kill(a.pid, 0); return false; } catch { return true; } }, 10_000);
    expect((await request({ op: 'ping' }))?.pid).toBe(pb.pid);
  }, 120_000);

  it('B3: a model that cannot be obtained → daemon exits, and clients cool down instead of respawning', async () => {
    linkModel(models, { corruptTokenizer: true }); // the re-download it triggers fails (dead COLDSTART_MODEL_URL)
    makeCache(['x']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(() => { try { return JSON.parse(readFileSync(join(home, 'embedder', 'state.json'), 'utf8')).model?.status === 'unavailable'; } catch { return false; } }, 60_000);
    await until(async () => !(await request({ op: 'ping' }, { connectMs: 100, budgetMs: 200 })), 10_000);
    expect(await ensureEmbedder()).toBe('cooldown');
  }, 120_000);

  it('B4: a store wiped under a running daemon is rebuilt on the next reconcile', async () => {
    linkModel(models); makeCache(['one', 'two', 'three']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await repoStatus())?.status === 'done');
    rmSync(vectorsDir(cacheDir), { recursive: true, force: true });
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => { const s = await repoStatus(); return s?.status === 'done' && s.done === 3 && existsSync(join(vectorsDir(cacheDir), 'manifest.json')); });
    const keys = ['one', 'two', 'three'].map((t, i) => embedKey('file_doc', `title: f${i}.ts | text: ${t}`));
    await until(() => openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get(keys).size === 3, 10_000);
  }, 120_000);
});
