// The embedder daemon (docs/embedder-daemon-design.md §1): ONE per machine, holds EmbeddingGemma 2 q4, answers
// query-embed requests over a local socket and backfills each registered repo's file + note vectors into that
// repo's store (hooks/vector-store.mjs) in the background. Spawned detached by hooks/embed-client.mjs.
//
// Invariants: restart never re-embeds (store is content-keyed; reconcile embeds only what is missing) · a repo is
// embedded only from the keeper's saved sketches (no sketches → nothing to do) · queries jump the backfill queue ·
// never exits mid-backfill; idle exit after IDLE_MS with no queries and no work · a newer protocol replaces us.
// The model never runs in this process: MAIN (backfill, + queries when alone) and a query-only LANE that lives
// exactly while backfill has work are child processes (hooks/embed-worker.mjs) — see "model processes + scheduler".
// They die with us: the IPC channel closes even on kill -9. Step 4b, docs/embedder-daemon-design.md.
import "./regex-engine.mjs";
import { connect, createServer } from "node:net";
import { execFileSync, fork } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os"; // namespace: a named import of availableParallelism fails to LINK on Node < 18.14
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, PROTOCOL, RECIPE, ROLES, TOKEN_CAPS, WINDOWED_ROLES, embedKey, threadPlan, embedderHome, modelDir, socketPath, vectorsDir } from "./embed-recipe.mjs";
import { embedderDisabled, encodeVec, request } from "./embed-client.mjs";
import { openWriter } from "./vector-store.mjs";
import { poolSums } from "./embed-runtime.mjs"; // pure pooling only: the model loads in the model processes
import { cleanBody } from "./recall-gate.mjs";

const HOME = embedderHome();
const IDLE_MS = +(process.env.COLDSTART_EMBEDDER_IDLE_MS || 90 * 60_000);
// caps: queries/sketches are cut at 512 tokens; notes run in 1024-token windows (TOKEN_CAPS), ONE window per backfill
// call (~1.2 s at 4 threads, ~2.4 s at 2), well inside the watchdog; 16 × 512-token queries likewise
const FLUSH_ROWS = 32, WATCHDOG_MS = +(process.env.COLDSTART_EMBEDDER_WATCHDOG_MS || 60_000), MAX_TEXTS = 16, MAX_CHARS = 8_000;
const WORKER = fileURLToPath(new URL("./embed-worker.mjs", import.meta.url));
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
const state = { pid: process.pid, protocol: PROTOCOL, recipe: RECIPE, startedAt: Date.now(), threads: null, laneThreads: null, perfCores: null,
  model: { status: "loading" }, selfBenchMs: null, lastQueryAt: 0, queries: 0, failures: 0, repos: {} };
let stateDirty = true;
function writeState() {
  if (!stateDirty) return; stateDirty = false;
  Object.assign(state, memState());
  state.idleExitAt = state.lastActivityAt + IDLE_MS;
  try { const p = join(HOME, "state.json"), tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 1)); renameSync(tmp, p); } catch { /* best effort */ }
}
/** rssMB = daemon + its model processes (what the machine pays); the parts beside it. */
function memState() {
  const daemon = Math.round(process.memoryUsage().rss / 1048576);
  const live = (m) => (m && !m.dead ? m.rssMB : 0);
  return { rssMB: daemon + live(main) + live(lane) + live(nextMain),
    rss: { daemon, main: live(main), lane: live(lane), reloading: live(nextMain) },
    lane: lane ? { state: lane.state, pid: lane.pid, rssMB: lane.rssMB, served: lane.served } : null, laneStarts };
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

// ---------------------------------------------------------------- model processes + scheduler
// Two lanes, each a model PROCESS (hooks/embed-worker.mjs; why a process and not a thread: see its header).
//  MAIN  — backfill, and queries whenever no query lane is up. One call at a time, driven by pump(). A long note is
//          run window by window (each 1024-token window its own call, pooled here with poolSums), so a query
//          waiting in the main queue slots in between windows instead of behind the whole note.
//  LANE  — queries only, alive exactly while backfill has work: started the first time a query finds MAIN busy with a
//          backfill item (until the lane is ready the query keeps its place in the main queue — whichever lane gets
//          to it first answers it); exits once every repo's queue is empty and nothing is in flight; replaced when
//          its RSS grows RSS_MARGIN_MB past its fresh-load RSS (a huge pasted prompt grew its arena).
//  Whenever every queue is empty (backfill drained, or after a huge query on MAIN), MAIN is reloaded if it has grown
//  the same way: a fresh process loads beside it, the old one keeps serving until the swap at the top of pump(), then
//  is killed while idle — no query is ever dropped or made to wait for the load — so its peak arena goes back to the
//  OS. Never while the lane is alive (old MAIN + new MAIN + lane at once peaked ~2 GB). No time-based rules for the
//  lane's life: work duration is machine-dependent; the lane starts by the TOKEN size of MAIN's in-flight item.
function perfCores() {
  if (process.platform === "darwin") {
    for (const k of ["hw.perflevel0.physicalcpu", "hw.physicalcpu"]) {
      try { const n = +execFileSync("sysctl", ["-n", k], { encoding: "utf8", timeout: 2000, windowsHide: true }).trim(); if (n > 0) return n; } catch { /* next */ }
    }
  }
  // no perf/efficiency split known: assume 2-way SMT. availableParallelism is Node ≥ 18.14.
  const logical = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.floor(logical / 2));
}
const PERF_CORES = perfCores();
const { main: BACKFILL_THREADS, lane: LANE_THREADS } = threadPlan(PERF_CORES); // table: threadPlan in embed-recipe.mjs
// A model process "has grown" once its RSS is this far past its own fresh-load RSS (~470–530 MB on M1 Pro, ~120 MB of
// it the tokenizer's JS heap). 200: a 384-token gate query adds ~90, 512 tokens ~105, 1024 tokens ~255, one 2048
// window ~700 — so ordinary queries never trigger a reload, a long pasted prompt or note windows do.
const RSS_MARGIN_MB = +(process.env.COLDSTART_EMBEDDER_RSS_MARGIN_MB || 200);

let nextId = 0;
/** Fork one model process. → handle {name, ready: Promise, call(msg), kill(), dead, rssMB, inflight} */
function spawnModel(name, threads) {
  const m = { name, threads, inflight: new Map(), rssMB: 0, dead: false, isReady: false, pid: null, onExit: null };
  const t0 = performance.now();
  let die = null;
  const child = fork(WORKER, [JSON.stringify({ dir: modelDir(), threads })], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true });
  m.pid = child.pid;
  m.ready = new Promise((ready, fail) => {
    child.on("message", (msg) => {
      if (msg.rss) m.rssMB = msg.rss;
      if (msg.type === "ready") { m.isReady = true; m.readyRssMB = msg.rss; m.loadMs = Math.round(performance.now() - t0); return ready(m); }
      const p = m.inflight.get(msg.id); if (!p) return; m.inflight.delete(msg.id);
      if (msg.type === "result") p.res(msg.out); else p.rej(new Error(msg.error));
    });
    die = (why) => {
      if (m.dead) return; m.dead = true;
      const e = new Error(`${name} model process ${why}`);
      for (const p of m.inflight.values()) p.rej(e);
      m.inflight.clear(); fail(e); m.onExit?.(m);
    };
    child.on("error", (e) => { die(e.message); m.kill(); }); // an IPC/spawn error leaves a process we can't use
    child.on("exit", (code, sig) => die(`exited (${code ?? sig})`));
  });
  m.ready.catch(() => {}); // callers that care await it; an unawaited failure is not a crash
  m.call = (msg) => new Promise((res, rej) => {
    if (m.dead || !m.isReady) return rej(new Error(`${name} model process not running`));
    const id = ++nextId; m.inflight.set(id, { res, rej, at: performance.now() });
    try { child.send({ id, ...msg }); } catch (e) { m.inflight.delete(id); rej(e); }
  });
  // DEAD SYNCHRONOUSLY: the 'exit' event comes later, and until then ensureMain/call must not hand this process to
  // the next call (verifier: after a watchdog kill the NEXT item was lost on the dying process too).
  m.kill = () => { die?.("killed"); try { child.kill("SIGKILL"); } catch { /* gone */ } };
  /** ms the oldest call in flight has been running (0 when idle). */
  m.oldestMs = () => { let t = Infinity; for (const p of m.inflight.values()) t = Math.min(t, p.at); return t === Infinity ? 0 : performance.now() - t; };
  return m;
}

/** One call under the watchdog: a run past WATCHDOG_MS kills that model process (the caller's lane restarts it). */
async function guarded(m, msg) {
  let wd;
  const stuck = new Promise((_, rej) => { wd = setTimeout(() => rej(Object.assign(new Error(`inference stuck > ${WATCHDOG_MS / 1000}s`), { stuck: true })), WATCHDOG_MS); });
  try { return await Promise.race([m.call(msg), stuck]); }
  catch (e) { if (e.stuck) { log(`watchdog: ${m.name} inference stuck — killing its model process`); m.kill(); } throw e; }
  finally { clearTimeout(wd); }
}

let main = null, nextMain = null, mainBusyWith = null; // null | "query" | "backfill"
let mainItemTokens = 0; // token count of MAIN's in-flight backfill item (0 = not known yet)
// Lane start rule (by TOKENS, not wall clock). MAIN at 4 threads: 128 tok 136 ms, 384 398, 512 545, 1024 1240, one
// 2048 window 3170. A query that finds MAIN mid-item waits for (the rest of) that item, so a lane is worth its ~1.2 s
// start + ~540 MB only when that wait is long or keeps recurring: the item in flight is > 1024 tokens (≥ 4x find's
// 300 ms budget; every windowed note), or more than LANE_BACKLOG items are still queued (sustained backfill: even
// 512-token sketches make each query wait up to ~0.55 s, item after item). One small note from `kb write` → no lane.
const LANE_ITEM_TOKENS = 1024, LANE_BACKLOG = 8;
const HUNG_LANE_MS = 1000; // lane's oldest call older than this → a new query ALSO queues on MAIN (first answer wins)
let lane = null, laneStarts = 0;
let modelReady = false;
const queries = []; // the MAIN queue: {role, texts, done, retried?}
let wake = null;
const kick = () => { const w = wake; wake = null; w?.(); };
const sleep = (ms) => new Promise((r) => { const t = setTimeout(() => { wake = null; r(); }, ms); wake = () => { clearTimeout(t); r(); }; });

/** MAIN, respawned if it died (crash, or the watchdog killed it). */
async function ensureMain() {
  if (main && !main.dead) return main;
  log("main model process gone — starting a fresh one");
  main = spawnModel("main", BACKFILL_THREADS);
  try { return await main.ready; } catch (e) { log(`model worker restart failed: ${e.message}`); shutdown("model worker failed"); throw e; }
}
const callMain = async (msg) => guarded(await ensureMain(), msg);

const queuedItems = () => { let n = 0; for (const r of repos.values()) n += r.queue.length; return n; };
const laneWorthIt = () => mainBusyWith === "backfill" && (mainItemTokens > LANE_ITEM_TOKENS || queuedItems() > LANE_BACKLOG);
const backfillWork = () => mainBusyWith === "backfill" || [...repos.values()].some((r) => r.queue.length || r.reconcile);

function startLane() {
  const m = lane = spawnModel("lane", LANE_THREADS); laneStarts++;
  m.state = "starting"; m.served = 0; m.pending = new Set();
  m.onExit = () => { if (lane === m) lane = null; };
  m.ready.then(() => {
    if (lane !== m) return;
    m.state = "ready"; m.limitMB = m.readyRssMB + RSS_MARGIN_MB;
    log(`query lane up in ${m.loadMs} ms (${LANE_THREADS} threads, ${m.readyRssMB} MB, restart past ${m.limitMB} MB)`);
    for (const q of queries.splice(0)) if (!q.answered) serveOnLane(q); // whatever MAIN hasn't taken yet
    laneCheck();
  }, (e) => { log(`query lane failed to start: ${e.message}`); if (lane === m) lane = null; });
}

/** Retire the lane when it has grown, stop it when backfill is done — never with a query in flight. */
function laneCheck() {
  const m = lane; if (!m || m.state === "starting") return;
  if (m.state === "ready" && m.rssMB > m.limitMB) { m.state = "retiring"; log(`query lane at ${m.rssMB} MB > ${m.limitMB} MB — replacing it`); }
  if (m.inflight.size) return;
  const work = backfillWork();
  if (m.state === "retiring" || !work) {
    lane = null; m.kill();
    if (!work) { log(`query lane exit: backfill drained (${m.served} queries served)`); kick(); } // kick: pump may now reload MAIN
    else startLane(); // restarted, not ended: backfill still has work
  }
}

function serveOnLane(q) {
  const m = lane;
  m.pending.add(q);
  guarded(m, { op: "embed", texts: q.texts, role: q.role }).then(
    (vecs) => { m.served++; q.done({ ok: true, vecs: vecs.map(encodeVec) }); },
    (e) => {
      if (q.answered) return; // MAIN answered it already (hung-lane double queue)
      if (!e.stuck && !q.retried) { q.retried = true; if (!queries.includes(q)) queries.unshift(q); kick(); return; } // lane died under it: MAIN answers
      state.failures++; q.done({ ok: false, error: String(e.message || e) });
    },
  ).finally(() => { m.pending.delete(q); laneCheck(); });
}

/** A new query: the lane if it's up, else the main queue — and if MAIN is mid-backfill-item, start the lane. */
function embedNow(role, texts) {
  return new Promise((resolve) => {
    const q = { role, texts, answered: false, done: (r) => { if (q.answered) return; q.answered = true; resolve(r); } };
    if (lane?.state === "ready") {
      serveOnLane(q);
      if (lane.oldestMs() <= HUNG_LANE_MS) return;
      // the lane looks hung (SIGSTOP, swap storm…) and the watchdog only fires at WATCHDOG_MS: queue this query AND
      // every one still waiting on the lane on MAIN too — whichever answers first wins
      for (const p of lane.pending) if (!p.answered && p !== q && !queries.includes(p)) queries.push(p);
    }
    queries.push(q);
    if (!lane && laneWorthIt()) startLane();
    kick();
  });
}

async function serveQueryOnMain(q) {
  if (q.answered) return; // the lane got there first
  mainBusyWith = "query";
  try { q.done({ ok: true, vecs: (await callMain({ op: "embed", texts: q.texts, role: q.role })).map(encodeVec) }); }
  catch (e) { state.failures++; q.done({ ok: false, error: String(e.message || e) }); }
  finally { mainBusyWith = null; }
}

/** One backfill item on MAIN → its vector. Long notes go window by window, queries served in between. */
async function embedItem(it) {
  mainBusyWith = "backfill";
  try {
    mainItemTokens = 0;
    const plan = WINDOWED_ROLES.has(it.role) ? await callMain({ op: "plan", text: it.text, role: it.role }) : null;
    mainItemTokens = plan ? plan.tokens : TOKEN_CAPS[it.role]; // non-windowed roles are cut at their cap
    if (queries.length && !lane && laneWorthIt()) startLane(); // a query that came in while we tokenized
    const wins = plan?.windows;
    if (!wins) return (await callMain({ op: "embed", texts: [it.text], role: it.role }))[0];
    const parts = [];
    for (const ids of wins) {
      while (queries.length) { await serveQueryOnMain(queries.shift()); mainBusyWith = "backfill"; }
      parts.push(await callMain({ op: "sums", ids }));
    }
    return poolSums(parts);
  } finally { mainBusyWith = null; mainItemTokens = 0; }
}

/** Swap in a reloaded MAIN once it's ready (called only between calls, so the old one is idle). */
function swapMain() {
  if (!nextMain?.isReady) return;
  const old = main; main = nextMain; nextMain = null;
  log(`main model process reloaded: ${old?.rssMB ?? "?"} MB → ${main.rssMB} MB (load ${main.loadMs} ms)`);
  old?.kill();
}

async function pump() {
  for (;;) {
    swapMain();
    if (queries.length) { await serveQueryOnMain(queries.shift()); continue; }
    const repo = [...repos.values()].find((r) => r.reconcile) ;
    if (repo) { try { reconcile(repo); } catch (e) { repo.status = "error"; log(`reconcile failed ${repo.root}: ${e.stack || e}`); } publishRepos(); continue; }
    const busy = [...repos.values()].find((r) => r.queue.length);
    if (busy) {
      const it = busy.queue.shift(), t0 = performance.now();
      try {
        const vec = await embedItem(it);
        busy.pending.push({ key: it.key, vec, kind: it.kind, id: it.id, day: day() });
        busy.done++;
      } catch (e) {
        // a crash / watchdog kill mid-item: try it once more (on a fresh MAIN) before dropping it, so the store
        // self-heals instead of waiting for the next notification while status says "done"
        if (!it.retried) { it.retried = true; busy.queue.unshift(it); log(`embed failed ${it.id}: ${e.message} — retrying once`); }
        else { state.failures++; log(`embed failed ${it.id}: ${e.message} — dropped until the next reconcile`); }
      }
      if (busy.pending.length >= FLUSH_ROWS || !busy.queue.length) flush(busy);
      if (!busy.queue.length) busy.status = "done";
      publishRepos(); touchActivity();
      if (PACE > 0) await sleep((performance.now() - t0) * PACE); // a query cuts the pause short
      continue;
    }
    // every queue empty, nothing in flight on MAIN: stop the lane (once its queries answer) and shed MAIN's arena
    laneCheck();
    if (!lane && !nextMain && main && !main.dead && main.rssMB > main.readyRssMB + RSS_MARGIN_MB) {
      const m = nextMain = spawnModel("main", BACKFILL_THREADS);
      m.ready.then(kick, (e) => { log(`main reload failed (keeping the old process): ${e.message}`); if (nextMain === m) nextMain = null; });
    }
    await sleep(60_000);
  }
}

// ---------------------------------------------------------------- socket
async function handle(msg) {
  switch (msg?.op) {
    case "ping": return { ok: true, protocol: PROTOCOL, pid: process.pid, model: state.model.status };
    case "status": return { ok: true, ...state, ...memState(), mainPid: main?.pid ?? null, mainBusy: mainBusyWith };
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
  for (const m of [main, lane, nextMain]) m?.kill(); // they'd exit on the IPC disconnect anyway; don't make them wait
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

async function start() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  try { await listen(); } catch (e) { exitEarly(`listen failed: ${e.message} — exiting`); }
  releaseSpawnLock();
  writeFileSync(join(HOME, "daemon.json"), JSON.stringify({ pid: process.pid, protocol: PROTOCOL, startedAt: state.startedAt }));
  touchActivity();
  Object.assign(state, { threads: BACKFILL_THREADS, laneThreads: LANE_THREADS, perfCores: PERF_CORES });
  log(`start: protocol ${PROTOCOL}, recipe ${RECIPE}, ${BACKFILL_THREADS} thread(s) main / ${LANE_THREADS} query lane (${PERF_CORES} perf cores)`);
  setInterval(writeState, 2000).unref();
  setInterval(() => { // idle exit — never with work pending
    const work = queries.length || lane?.inflight.size || [...repos.values()].some((r) => r.queue.length || r.reconcile || r.pending.length);
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
    main = spawnModel("main", BACKFILL_THREADS);
    await main.ready;
    modelReady = true;
    state.model = { status: "ready", loadMs: Math.round(performance.now() - t0) };
    const t1 = performance.now(); await callMain({ op: "embed", texts: ["where is the session cookie refreshed after login"], role: "code_query" });
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

start();
