// The embedder daemon (docs/embedder-daemon-design.md §1): ONE per machine, holds EmbeddingGemma 2 q4, answers
// query-embed requests over a local socket and backfills each registered repo's file + note vectors into that
// repo's store (hooks/vector-store.mjs) in the background. Spawned detached by hooks/embed-client.mjs.
//
// Invariants: restart never re-embeds (store is content-keyed; reconcile embeds only what is missing) · a repo is
// embedded only from the keeper's saved sketches (no sketches → nothing to do) · queries jump the backfill queue ·
// never exits mid-backfill; idle exit after IDLE_MS with no queries and no work · a newer protocol replaces us.
import "./regex-engine.mjs";
import { connect, createServer } from "node:net";
import { Worker } from "node:worker_threads";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, PROTOCOL, RECIPE, ROLES, embedKey, embedderHome, modelDir, socketPath, vectorsDir } from "./embed-recipe.mjs";
import { embedderDisabled, encodeVec, request } from "./embed-client.mjs";
import { openWriter } from "./vector-store.mjs";
import { cleanBody } from "./recall-gate.mjs";

const HOME = embedderHome();
const IDLE_MS = +(process.env.COLDSTART_EMBEDDER_IDLE_MS || 90 * 60_000);
// caps: queries/sketches are cut at 512 tokens, notes at 2048 (TOKEN_CAPS) — a 2048-token note is ~4 s at 2 threads,
// well inside the watchdog; 16 × 512-token queries likewise
const FLUSH_ROWS = 32, WATCHDOG_MS = 60_000, MAX_TEXTS = 16, MAX_CHARS = 8_000;
const WORKER = fileURLToPath(new URL("./embed-worker.mjs", import.meta.url));
const THREADS = Math.min(4, Math.max(1, Math.floor(cpus().length / 2)));
const PACE = +(process.env.COLDSTART_EMBEDDER_PACE || 1); // backfill sleeps PACE × each item's run time → ~50% duty
const SELF = fileURLToPath(import.meta.url);
const day = () => Math.floor(Date.now() / 86_400_000);

// ---------------------------------------------------------------- logging + state
const logPath = join(HOME, "embedder.log");
function log(msg) {
  try {
    if (existsSync(logPath) && statSync(logPath).size > 1 << 20) renameSync(logPath, logPath + ".1");
    appendFileSync(logPath, `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch { /* logging never kills the daemon */ }
}
const state = { pid: process.pid, protocol: PROTOCOL, recipe: RECIPE, startedAt: Date.now(), threads: THREADS,
  model: { status: "loading" }, selfBenchMs: null, lastQueryAt: 0, queries: 0, failures: 0, repos: {} };
let stateDirty = true;
function writeState() {
  if (!stateDirty) return; stateDirty = false;
  state.rssMB = Math.round(process.memoryUsage().rss / 1048576);
  state.idleExitAt = state.lastActivityAt + IDLE_MS;
  try { const p = join(HOME, "state.json"), tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 1)); renameSync(tmp, p); } catch { /* best effort */ }
}
const touchActivity = () => { state.lastActivityAt = Date.now(); stateDirty = true; };

// ---------------------------------------------------------------- repos
/** root → {root, cacheDir, writer, queue: item[], total, done, status, pending: rows[] } */
const repos = new Map();
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

function loadRegistrations() {
  const dir = join(HOME, "repos");
  let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    const r = readJson(join(dir, f));
    if (!r?.root || !r?.cacheDir) continue;
    const have = repos.get(r.root);
    if (!have) repos.set(r.root, { root: r.root, cacheDir: r.cacheDir, queue: [], pending: [], total: 0, done: 0, status: "registered", reconcile: true });
    else if (have.cacheDir !== r.cacheDir) { // re-registered elsewhere (keeper --cache-dir): follow it to the new store
      flush(have);
      Object.assign(have, { cacheDir: r.cacheDir, writer: null, queue: [], pending: [], reconcile: true });
      log(`${r.root}: cache dir now ${r.cacheDir}`);
    }
  }
}

/** Every note, ANY status — retracted/superseded stay searchable and can be revived (design §3 Notes). */
function readNotes(root) {
  const dir = join(root, ".coldstart", "notebook", "notes"), out = [];
  let files = []; try { files = readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith(".md") || f === "_index.md") continue;
    let md; try { md = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/), id = fm?.[1].match(/^id: (.+)$/m)?.[1]?.trim();
    if (!id) continue;
    const text = cleanBody(md.slice(fm[0].length).trim());
    if (text) out.push({ key: embedKey("note_doc", text), role: "note_doc", text, kind: "note", id });
  }
  return out;
}

function readSketches(cacheDir) {
  const gen = readJson(join(cacheDir, "meta.json"))?.gen;
  if (!Number.isFinite(gen)) return null;
  let body;
  try { body = readFileSync(join(cacheDir, `g${gen}-sketches.jsonl`), "utf8"); } catch {
    // the keeper's sweep may have moved on between our two reads: one retry on the new meta
    const g2 = readJson(join(cacheDir, "meta.json"))?.gen;
    try { body = readFileSync(join(cacheDir, `g${g2}-sketches.jsonl`), "utf8"); } catch { return null; }
  }
  const out = [];
  for (const line of body.split("\n")) {
    if (!line) continue;
    try { const { path, text } = JSON.parse(line); out.push({ key: embedKey("file_doc", text), role: "file_doc", text, kind: "file", id: path }); } catch { /* skip */ }
  }
  return out;
}

function reconcile(repo) {
  repo.reconcile = false;
  // File sketches only with the opt-in (COLDSTART_EMBEDDER=1 / `init --embedder`): a daemon the recall gate spawned
  // (no opt-in needed) embeds NOTES only. No sketches either way (no keeper save yet, cache dir absent): still embed
  // the notes, but never sweep, since a missing sketch set would make every stored file vector look dead.
  const files = !embedderDisabled() && existsSync(repo.cacheDir) ? readSketches(repo.cacheDir) : null;
  const notes = readNotes(repo.root);
  if (!files && !notes.length) { repo.status = "no-sketches"; return; }
  // the store was wiped under us (cache cleared): drop the in-memory writer or it would claim everything is stored
  if (repo.writer && !existsSync(join(vectorsDir(repo.cacheDir), "manifest.json"))) { repo.writer = null; repo.pending = []; }
  repo.writer ??= openWriter(vectorsDir(repo.cacheDir), { recipe: RECIPE, dim: DIM });
  const items = [...new Map([...notes, ...(files ?? [])].map((it) => [it.key, it])).values()]; // notes first
  const current = new Set(items.map((it) => it.key)), stored = repo.writer.storedKeys(), today = day();
  repo.writer.markSeen([...current].filter((k) => stored.has(k)), today);
  if (files) {
    const sweep = repo.writer.maybeSweep({ today, currentKeys: current });
    if (sweep.compacted) log(`compacted ${repo.root}: ${sweep.rows} rows kept, ${sweep.dead} dead dropped`);
  }
  const pendingKeys = new Set(repo.pending.map((r) => r.key));
  repo.queue = items.filter((it) => !stored.has(it.key) && !pendingKeys.has(it.key));
  repo.total = items.length; repo.done = repo.total - repo.queue.length;
  repo.status = repo.queue.length ? "embedding" : "done";
  repo.lastReconcileAt = Date.now();
  log(`reconcile ${repo.root}: ${repo.done}/${repo.total} stored, ${repo.queue.length} to embed`);
}

function flush(repo) {
  if (!repo.pending.length || !repo.writer) return;
  try { repo.writer.append(repo.pending); } catch (e) {
    log(`append failed ${repo.root}: ${e.message}`); state.failures++;
    if (e.code === "ENOENT") { repo.writer = null; repo.reconcile = true; } // store dir vanished → reopen + re-diff
  }
  repo.pending = [];
}

function publishRepos() {
  for (const r of repos.values()) state.repos[r.root] = { total: r.total, done: r.done, queued: r.queue.length, status: r.status, lastReconcileAt: r.lastReconcileAt ?? null };
  stateDirty = true;
}

// ---------------------------------------------------------------- scheduler (one inference at a time)
// The model runs in a worker thread (hooks/embed-worker.mjs): session.run blocks its thread for the whole run,
// and on this thread that silenced the socket → clients spawned a second daemon on the same store.
let worker = null, nextId = 0;
const inflight = new Map();
function startWorker() {
  return new Promise((ready, fail) => {
    const w = new Worker(WORKER, { workerData: { dir: modelDir(), threads: THREADS } });
    const failAll = (e) => { for (const p of inflight.values()) p.rej(e); inflight.clear(); if (worker === w) worker = null; fail(e); };
    w.on("message", (m) => {
      if (m.type === "ready") return ready(w);
      const p = inflight.get(m.id); if (!p) return; inflight.delete(m.id);
      if (m.type === "result") p.res(m.vecs); else p.rej(new Error(m.error));
    });
    w.on("error", failAll);
    w.on("exit", (code) => failAll(new Error(`model worker exited (${code})`)));
  });
}
const embedder = { embed: (texts, role) => new Promise((res, rej) => {
  if (!worker) return rej(new Error("model worker not running"));
  const id = ++nextId; inflight.set(id, { res, rej }); worker.postMessage({ id, texts, role });
}) };
let modelReady = false;
const queries = []; // {role, texts, done}
let wake = null;
const kick = () => { const w = wake; wake = null; w?.(); };
const sleep = (ms) => new Promise((r) => { const t = setTimeout(() => { wake = null; r(); }, ms); wake = () => { clearTimeout(t); r(); }; });

async function guarded(texts, role) {
  let wd;
  const stuck = new Promise((_, rej) => { wd = setTimeout(() => rej(Object.assign(new Error(`inference stuck > ${WATCHDOG_MS / 1000}s`), { stuck: true })), WATCHDOG_MS); });
  try { return await Promise.race([embedder.embed(texts, role), stuck]); }
  catch (e) {
    if (e.stuck) { // the watchdog is real now: kill the worker and load a fresh one
      log("watchdog: inference stuck — restarting the model worker");
      const w = worker; worker = null; await w?.terminate();
      try { worker = await startWorker(); } catch (err) { log(`model worker restart failed: ${err.message}`); shutdown("model worker failed"); }
    }
    throw e;
  } finally { clearTimeout(wd); }
}

async function pump() {
  for (;;) {
    if (queries.length) {
      const q = queries.shift();
      try { q.done({ ok: true, vecs: (await guarded(q.texts, q.role)).map(encodeVec) }); }
      catch (e) { state.failures++; q.done({ ok: false, error: String(e.message || e) }); }
      continue;
    }
    const repo = [...repos.values()].find((r) => r.reconcile) ;
    if (repo) { try { reconcile(repo); } catch (e) { repo.status = "error"; log(`reconcile failed ${repo.root}: ${e.stack || e}`); } publishRepos(); continue; }
    const busy = [...repos.values()].find((r) => r.queue.length);
    if (busy) {
      const it = busy.queue.shift(), t0 = performance.now();
      try {
        const [vec] = await guarded([it.text], it.role);
        busy.pending.push({ key: it.key, vec, kind: it.kind, id: it.id, day: day() });
        busy.done++;
      } catch (e) { state.failures++; log(`embed failed ${it.id}: ${e.message}`); }
      if (busy.pending.length >= FLUSH_ROWS || !busy.queue.length) flush(busy);
      if (!busy.queue.length) busy.status = "done";
      publishRepos(); touchActivity();
      if (PACE > 0) await sleep((performance.now() - t0) * PACE); // a query cuts the pause short
      continue;
    }
    await sleep(60_000);
  }
}

function embedNow(role, texts) {
  return new Promise((done) => { queries.push({ role, texts, done }); kick(); });
}

// ---------------------------------------------------------------- socket
async function handle(msg) {
  switch (msg?.op) {
    case "ping": return { ok: true, protocol: PROTOCOL, pid: process.pid, model: state.model.status };
    case "status": writeState(); return { ok: true, ...state, rssMB: Math.round(process.memoryUsage().rss / 1048576) };
    case "embed": {
      if (!Object.hasOwn(ROLES, msg.role) || !Array.isArray(msg.texts) || !msg.texts.length || msg.texts.length > MAX_TEXTS || msg.texts.some((t) => typeof t !== "string" || t.length > MAX_CHARS)) return { ok: false, error: "bad embed request" };
      if (!modelReady) return { ok: false, error: `model ${state.model.status}` };
      state.queries++; state.lastQueryAt = Date.now(); touchActivity();
      return embedNow(msg.role, msg.texts);
    }
    case "register": case "sketches-saved": case "notes-changed": {
      loadRegistrations();
      const r = repos.get(msg.root);
      if (r) { r.reconcile = true; touchActivity(); kick(); }
      return { ok: !!r };
    }
    case "touched": { // find returned these files → embed them first
      const r = repos.get(msg.root); if (!r || !Array.isArray(msg.paths)) return { ok: false };
      const want = new Set(msg.paths), front = r.queue.filter((it) => want.has(it.id));
      if (front.length) { r.queue = [...front, ...r.queue.filter((it) => !want.has(it.id))]; kick(); }
      return { ok: true, moved: front.length };
    }
    case "stop": setTimeout(() => shutdown("stop requested"), 10); return { ok: true };
    default: return { ok: false, error: "unknown op" };
  }
}

const server = createServer((sock) => {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", async (d) => {
    buf += d;
    if (buf.length > 4 << 20) { sock.destroy(); return; } // request cap
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let reply; try { reply = await handle(JSON.parse(line)); } catch (e) { reply = { ok: false, error: String(e.message || e) }; }
      if (!sock.destroyed) sock.write(JSON.stringify(reply) + "\n");
    }
  });
  sock.on("error", () => {});
});

let stopping = false;
function shutdown(why) {
  if (stopping) return; stopping = true;
  log(`exit: ${why}`);
  for (const r of repos.values()) flush(r);
  writeState();
  // B2: only touch OUR socket. A replacement daemon may already be listening at this path — and on Unix
  // server.close() itself unlinks the PATH (libuv), so when the path is no longer ours we must not close at all
  // (process.exit below unlinks nothing).
  let ours = process.platform === "win32";
  if (!ours && sockIno !== null) { try { ours = statSync(socketPath()).ino === sockIno; } catch { ours = false; } }
  if (ours) { try { server.close(); } catch { /* not listening */ } }
  try { const p = join(HOME, "daemon.json"); if (readJson(p)?.pid === process.pid) unlinkSync(p); } catch { /* gone */ }
  setTimeout(() => process.exit(0), 50);
}

// ---------------------------------------------------------------- start
let sockIno = null;
const releaseSpawnLock = () => { try { unlinkSync(join(HOME, "spawn.lock")); } catch { /* not ours / gone */ } };
const exitEarly = (why) => { log(why); releaseSpawnLock(); process.exit(0); };
/** true if ANY process accepts connections at the path (even one too busy to answer a ping). */
const someoneListening = (sp) => new Promise((res) => {
  const s = connect(sp); const t = setTimeout(() => { s.destroy(); res(true); }, 300); // accepting but slow → alive
  s.on("connect", () => { clearTimeout(t); s.destroy(); res(true); });
  s.on("error", () => { clearTimeout(t); res(false); });
});
async function listen() {
  const sp = socketPath();
  const other = await request({ op: "ping" }, { connectMs: 200, budgetMs: 300 });
  if (other && (other.protocol ?? 0) >= PROTOCOL) exitEarly(`another daemon (pid ${other.pid}) is serving — exiting`);
  if (other) {
    await request({ op: "stop" }, { connectMs: 200, budgetMs: 2000 });
    for (let i = 0; i < 30 && (await someoneListening(sp)); i++) await new Promise((r) => setTimeout(r, 100)); // wait for it to go
  }
  // never steal a socket someone still accepts on — a busy daemon may just be slow to answer the ping
  if (await someoneListening(sp)) exitEarly("socket is held by a live listener that did not answer — exiting");
  if (process.platform !== "win32") {
    mkdirSync(dirname(sp), { recursive: true, mode: 0o700 });
    if (existsSync(sp)) { try { unlinkSync(sp); } catch { /* raced */ } } // no listener: stale file
  }
  await new Promise((res, rej) => { server.once("error", rej); server.listen(sp, () => { server.off("error", rej); res(); }); });
  if (process.platform !== "win32") { try { chmodSync(sp, 0o600); sockIno = statSync(sp).ino; } catch { /* best effort */ } }
}

async function main() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try { await listen(); } catch (e) { exitEarly(`listen failed: ${e.message} — exiting`); }
  releaseSpawnLock();
  writeFileSync(join(HOME, "daemon.json"), JSON.stringify({ pid: process.pid, protocol: PROTOCOL, startedAt: state.startedAt }));
  touchActivity();
  log(`start: protocol ${PROTOCOL}, recipe ${RECIPE}, ${THREADS} thread(s)`);
  setInterval(writeState, 2000).unref();
  setInterval(() => { // idle exit — never with work pending
    const work = queries.length || [...repos.values()].some((r) => r.queue.length || r.reconcile || r.pending.length);
    if (!work && state.model.status !== "downloading" && Date.now() - state.lastActivityAt > IDLE_MS) shutdown("idle");
  }, Math.min(60_000, IDLE_MS / 2)).unref();
  let misses = 0; // self-reap after an uninstall (keeper's watchOwnBinary, design "Lessons")
  setInterval(() => { if (existsSync(SELF)) misses = 0; else if (++misses >= 2) shutdown("own entry file gone"); }, 15_000).unref();
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    const { modelStatus, ensureModel } = await import("./embed-model.mjs");
    for (let tries = 0; !modelStatus({ dir: modelDir() }).ready || tries === 0; tries++) {
      state.model = { status: "downloading" }; stateDirty = true;
      try { // also hashes once (.verified.json) when the files were fetched by an older coldstart
        await ensureModel({ dir: modelDir(), onProgress: (p) => { state.model = { status: "downloading", have: p.overallHave, total: p.overallTotal }; stateDirty = true; } });
        break;
      } catch (e) {
        if (e?.code !== "EBUSY" || tries > 60) throw e;
        state.model = { status: "download-busy" }; stateDirty = true; // another process is downloading: wait for it
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
    const t0 = performance.now();
    worker = await startWorker();
    modelReady = true;
    state.model = { status: "ready", loadMs: Math.round(performance.now() - t0) };
    const t1 = performance.now(); await embedder.embed(["where is the session cookie refreshed after login"], "code_query");
    state.selfBenchMs = Math.round(performance.now() - t1); stateDirty = true;
    log(`model ready in ${state.model.loadMs} ms; self-bench query ${state.selfBenchMs} ms`);
  } catch (e) {
    // B3: don't linger as a model-less daemon that clients mistake for a working one. Exit; clients see
    // model.failedAt in state.json and wait MODEL_RETRY_MS before spawning a retry.
    state.model = { status: "unavailable", error: String(e?.message || e), failedAt: Date.now() }; stateDirty = true;
    log(`model unavailable: ${e?.stack || e}`);
    shutdown("model unavailable");
    return;
  }
  loadRegistrations();
  pump().catch((e) => { log(`pump crashed: ${e.stack || e}`); shutdown("pump crashed"); });
}

main();
