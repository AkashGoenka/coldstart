/**
 * Embedder daemon lifecycle (hooks/embedder-daemon.mjs + hooks/embed-client.mjs) — one test per bug the step-2
 * verifier reproduced (B1–B4), plus client basics. Real model, real processes: needs the model files (skipped
 * otherwise). Isolation: a temp COLDSTART_HOME, and a temp model dir of SYMLINKS to the real files, so the
 * daemon's writes (.verified.json, lock) land in the temp dir and the real model cache is only ever read.
 * Step 4b (query lane): the lane starts on a query during backfill and answers it fast, exits when backfill drains,
 * MAIN reloads to shed its arena, per-window backfill vectors equal the one-call path, no orphan after kill -9.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — plain ESM hook modules
import { request, ensureEmbedder, embedTexts, registerRepo, notifyEmbedder } from '../hooks/embed-client.mjs';
// @ts-ignore
import { MODEL_ID, RECIPE, DIM, embedKey, socketPath, vectorsDir, defaultRepoCacheDir, threadPlan } from '../hooks/embed-recipe.mjs';
// @ts-ignore
import { openReader } from '../hooks/vector-store.mjs';
// @ts-ignore
import { runGate, cleanBody } from '../hooks/recall-gate.mjs';
// @ts-ignore
import { loadEmbedder } from '../hooks/embed-runtime.mjs';
import { appendRecord } from '../src/kb/raw-log.js';
import { renderIds } from '../src/kb/store.js';

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

describe('thread plan (step 4b)', () => {
  it('MAIN never drops to 1 thread on >= 4 perf cores, and MAIN + lane never oversubscribe them', () => {
    const t = Object.fromEntries([1, 2, 3, 4, 6, 8, 10].map((p) => [p, threadPlan(p)]));
    expect(t).toEqual({ 1: { main: 1, lane: 1 }, 2: { main: 1, lane: 1 }, 3: { main: 1, lane: 1 }, 4: { main: 2, lane: 2 },
      6: { main: 4, lane: 2 }, 8: { main: 4, lane: 2 }, 10: { main: 4, lane: 2 } });
    for (const p of [4, 6, 8, 10, 16]) expect(threadPlan(p).main + threadPlan(p).lane).toBeLessThanOrEqual(p);
  });
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

  it('recall gate: notes-only repo (no keeper cache) → first prompt falls back, daemon embeds the notes, then ok', async () => {
    linkModel(models);
    process.env.COLDSTART_EMBEDDER = ''; // the gate needs no opt-in — only an explicit off stops it
    for (const n of ['keeper', 'watcher']) {
      appendRecord(root, { id: `note-${n}`, type: 'lesson', op: 'put', kind: 'gotcha', title: `About the ${n}`, body: `The ${n} debounces saves and patches the index.`, anchors: [] });
    }
    renderIds(root);
    const prompt = 'how does the keeper debounce saves?';
    expect(await runGate({ root, prompt, transcriptPath: '' })).toMatchObject({ status: 'unavailable', reason: 'vectors-stale(2)' });
    await until(async () => (await repoStatus())?.status === 'done');
    expect(existsSync(join(vectorsDir(defaultRepoCacheDir(root)), 'manifest.json'))).toBe(true); // unregistered repo → the default cache path
    const g = await runGate({ root, prompt, transcriptPath: '' });
    expect(g).toMatchObject({ status: 'ok', ids: expect.arrayContaining(['note-keeper', 'note-watcher']) });
    expect(g.ms).toBeLessThan(3000);
    process.env.COLDSTART_EMBEDDER = '0';
    expect(await runGate({ root, prompt, transcriptPath: '' })).toEqual({ status: 'unavailable', reason: 'embedder-off' });
  }, 120_000);

  it('a daemon the gate started (no opt-in) embeds notes only — file sketches wait for the opt-in', async () => {
    linkModel(models); makeCache(['alpha beta', 'gamma delta']);
    process.env.COLDSTART_EMBEDDER = '';
    registerRepo(root, cacheDir); // as a keeper save would, before the gate's prompt
    appendRecord(root, { id: 'note-k', type: 'lesson', op: 'put', kind: 'gotcha', title: 'About k', body: 'k body.', anchors: [] });
    renderIds(root);
    expect(await runGate({ root, prompt: 'about k', transcriptPath: '' })).toMatchObject({ reason: 'vectors-stale(1)' });
    const s = await until(async () => { const r = await repoStatus(); return r?.status === 'done' && r; });
    expect(s).toMatchObject({ total: 1, done: 1 }); // the 2 sketches were not queued
    expect((await runGate({ root, prompt: 'about k', transcriptPath: '' })).status).toBe('ok'); // found via the registration
  }, 120_000);

  it('a repo re-registered with a new cache dir moves the daemon to the new store', async () => {
    linkModel(models); makeCache(['one']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await repoStatus())?.status === 'done');
    const moved = join(cacheDir, '..', 'cache2');
    rmSync(moved, { recursive: true, force: true });
    cpSync(cacheDir, moved, { recursive: true, filter: (p: string) => !p.includes('vectors') });
    await notifyEmbedder('sketches-saved', root, moved);
    await until(() => openReader(vectorsDir(moved), { recipe: RECIPE, dim: DIM }).get([embedKey('file_doc', 'title: f0.ts | text: one')]).size === 1, 30_000);
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

// Step 4b — the query lane. Long notes (5000 words → several note_doc windows each) keep MAIN busy for many seconds.
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const WORDS = ['keeper', 'watcher', 'cache', 'socket', 'vector', 'session', 'cookie', 'refresh', 'daemon', 'notebook', 'window', 'gate'];
const longNote = (seed: number, words = 5000) => Array.from({ length: words }, (_, i) => WORDS[(i * 7 + seed) % WORDS.length] + (i % 9 ? '' : String(i % 23))).join(' ');
function writeNotes(n: number) {
  const dir = join(root, '.coldstart', 'notebook', 'notes');
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `long-${i}.md`), `---\nid: long-${i}\n---\n${longNote(i)}\n`);
}
const FIND_Q = 'where does the keeper refresh the session cookie after the socket reconnects and the cache is saved again for the next index '.repeat(5);

describe.skipIf(!HAVE_MODEL)('embedder daemon query lane (real model)', () => {
  it('lane starts on a query during backfill, answers within budget, exits on drain; MAIN reloads; per-window vectors = one call', async () => {
    linkModel(models); makeCache(['x']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await status())?.mainBusy === 'backfill', 60_000, 50);
    const first = await embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 }); // finds MAIN mid-item → lane starts
    expect(first?.length).toBe(1);
    const up = await until(async () => { const s = await status(); return s?.lane?.state === 'ready' && s; }, 30_000, 100);
    expect(up.repos[root].status).toBe('embedding'); // backfill still running
    const lanePid = up.lane.pid;
    const ms: number[] = [];
    for (let i = 0; i < 4; i++) { const t = Date.now(); expect(await embedTexts([FIND_Q + i], 'code_query', { budgetMs: 5000 })).not.toBeNull(); ms.push(Date.now() - t); }
    expect(Math.max(...ms)).toBeLessThan(1500); // a window on MAIN is ~3 s; the lane answers in ~0.25 s
    // drain → lane exits, MAIN is reloaded (new pid, less RSS than its peak during backfill)
    let mainPeak = 0;
    const after = await until(async () => {
      const s = await status(); if (s?.mainPid === up.mainPid) mainPeak = Math.max(mainPeak, s.rss.main);
      return s?.repos?.[root]?.status === 'done' && !s.lane && s.mainPid !== up.mainPid && s;
    }, 120_000, 250);
    await until(() => !alive(lanePid) && !alive(up.mainPid), 5_000, 50); // killed; reaped a moment later
    expect(after.rss.main).toBeLessThan(mainPeak);
    expect(after.laneStarts).toBe(1);
    // queries still served by MAIN alone
    expect(await embedTexts(['session cookie'], 'code_query', { budgetMs: 3000 })).not.toBeNull();
    // per-window backfill (one call per window, pooled in the daemon) == the runtime's one-call windowed embed
    const md = readFileSync(join(root, '.coldstart', 'notebook', 'notes', 'long-0.md'), 'utf8');
    const text = cleanBody(md.slice(md.indexOf('\n---\n') + 5).trim());
    const e = await loadEmbedder({ dir: join(models, MODEL_ID), threads: 4 });
    expect((await e.windows(text, 'note_doc')).length).toBeGreaterThanOrEqual(3);
    const [ref] = await e.embed([text], 'note_doc');
    await e.release();
    const stored = [...openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get([embedKey('note_doc', text)]).values()][0] as Float32Array;
    expect(stored.reduce((a, x, j) => a + x * ref[j], 0)).toBeGreaterThan(0.99999);
  }, 300_000);

  it('watchdog: a stuck run on the lane kills the lane; the next query during backfill gets a fresh one', async () => {
    process.env.COLDSTART_EMBEDDER_WATCHDOG_MS = '4500'; // a 2048 window on MAIN is ~3 s; 16 × 512 tokens on the lane ~16 s
    linkModel(models); makeCache(['x']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await status())?.mainBusy === 'backfill', 60_000, 50);
    void embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 });
    const s = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    const long = Array.from({ length: 16 }, (_, i) => `function ${i} `.repeat(600));
    expect(await embedTexts(long, 'code_query', { budgetMs: 30_000 })).toBeNull(); // stuck → error reply
    await until(() => !alive(s.lane.pid), 10_000, 100);
    expect(await embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 })).not.toBeNull();
    const s2 = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    expect(s2.lane.pid).not.toBe(s.lane.pid);
    expect(s2.laneStarts).toBe(2);
  }, 120_000);

  it('a lane that grew past its RSS margin is replaced (backfill still running)', async () => {
    process.env.COLDSTART_EMBEDDER_RSS_MARGIN_MB = '40'; // a 384-token query grows a fresh lane ~90 MB
    linkModel(models); makeCache(['x']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await status())?.mainBusy === 'backfill', 60_000, 50);
    void embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 });
    const s = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    expect(await embedTexts([FIND_Q.repeat(3)], 'note_query', { budgetMs: 30_000 })).not.toBeNull(); // answered, THEN retired
    await until(() => !alive(s.lane.pid), 10_000, 100);
    const s2 = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    expect(s2.laneStarts).toBe(2);
    expect(s2.repos[root].status).toBe('embedding');
  }, 120_000);

  it('a MAIN crash mid-item retries the item once on a fresh MAIN — the store ends complete', async () => {
    linkModel(models); makeCache(['a', 'b']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    const s = await until(async () => { const x = await status(); return x?.mainBusy === 'backfill' && x; }, 60_000, 50);
    process.kill(s.mainPid, 'SIGKILL');
    await until(async () => (await repoStatus())?.status === 'done', 180_000, 250);
    const keys = [0, 1, 2].map((i) => { const md = readFileSync(join(root, '.coldstart', 'notebook', 'notes', `long-${i}.md`), 'utf8'); return embedKey('note_doc', cleanBody(md.slice(md.indexOf('\n---\n') + 5).trim())); });
    keys.push(...['a', 'b'].map((t, i) => embedKey('file_doc', `title: f${i}.ts | text: ${t}`)));
    await until(() => openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get(keys).size === keys.length, 10_000);
    expect(readFileSync(join(home, 'embedder', 'embedder.log'), 'utf8')).toMatch(/retrying once/);
  }, 240_000);

  it('after a watchdog kill of MAIN the next items still land (the dying process is never reused)', async () => {
    process.env.COLDSTART_EMBEDDER_WATCHDOG_MS = '4500'; // 16 × 512-token texts on MAIN take ~9 s at 4 threads
    linkModel(models); makeCache(['a']);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await repoStatus())?.status === 'done');
    const long = Array.from({ length: 16 }, (_, i) => `function ${i} `.repeat(600));
    const stuck = embedTexts(long, 'code_query', { budgetMs: 30_000 });
    await wait(300);
    makeCache(['a', 'b', 'c', 'd']); await notifyEmbedder('sketches-saved', root, cacheDir); // queued behind the stuck run
    expect(await stuck).toBeNull();
    const keys = ['a', 'b', 'c', 'd'].map((t, i) => embedKey('file_doc', `title: f${i}.ts | text: ${t}`));
    await until(() => openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get(keys).size === 4, 60_000, 250);
  }, 120_000);

  it('a hung (SIGSTOPped) lane does not hold queries until the watchdog: MAIN answers them too', async () => {
    linkModel(models); makeCache(['x']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await status())?.mainBusy === 'backfill', 60_000, 50);
    void embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 });
    const s = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    process.kill(s.lane.pid, 'SIGSTOP');
    try {
      const t0 = Date.now();
      const a = embedTexts([FIND_Q + 'a'], 'code_query', { budgetMs: 30_000 }); // only the (hung) lane has it...
      await wait(1300);
      const b = embedTexts([FIND_Q + 'b'], 'code_query', { budgetMs: 30_000 }); // ...until this one sees the lane hung
      expect((await a)?.length).toBe(1);
      expect((await b)?.length).toBe(1);
      expect(Date.now() - t0).toBeLessThan(15_000); // the watchdog is 60 s
    } finally { try { process.kill(s.lane.pid, 'SIGCONT'); } catch { /* gone */ } }
  }, 120_000);

  it('small notes (one short item at a time, small backlog) never start a lane', async () => {
    linkModel(models);
    const dir = join(root, '.coldstart', 'notebook', 'notes');
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `s-${i}.md`), `---\nid: s-${i}\n---\n${longNote(i, 500)}\n`);
    await notifyEmbedder('notes-changed', root, cacheDir);
    let asked = 0;
    await until(async () => {
      const x = await status();
      if (x?.mainBusy === 'backfill' && asked < 3) { asked++; await embedTexts([FIND_Q], 'code_query', { budgetMs: 5000 }); }
      return x?.repos?.[root]?.status === 'done' && x;
    }, 60_000, 30);
    expect(asked).toBeGreaterThan(0);
    expect((await status()).laneStarts).toBe(0);
  }, 120_000);

  it('kill -9 of the daemon leaves no model process behind (MAIN and lane)', async () => {
    linkModel(models); makeCache(['x']); writeNotes(3);
    await notifyEmbedder('sketches-saved', root, cacheDir);
    await until(async () => (await status())?.mainBusy === 'backfill', 60_000, 50);
    void embedTexts([FIND_Q], 'code_query', { budgetMs: 30_000 });
    const s = await until(async () => { const x = await status(); return x?.lane?.state === 'ready' && x; }, 30_000, 100);
    process.kill(s.pid, 'SIGKILL');
    await until(() => !alive(s.pid) && !alive(s.mainPid) && !alive(s.lane.pid), 20_000, 100);
  }, 120_000);
});
