// Background download of the EmbeddingGemma 2 q4 text model (docs/embedder-daemon-design.md §1, Decision 3):
// pinned revision, every file size + hash verified, resumable (HTTP Range into <file>.part, streamed to disk with
// backpressure), atomic rename, verified once per REVISION (.verified.json), one downloader at a time
// (.download.lock: dead-pid / stale takeover, heartbeat, owner-checked release; a 2nd caller gets code EBUSY).
// Node's global fetch ignores HTTPS_PROXY before Node 24 (NODE_USE_ENV_PROXY=1 there) — documented, no deps.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync, closeSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODEL_ID, modelDir } from "./embed-recipe.mjs";

export { MODEL_ID };
export const REVISION = "daa72c51243991dfcaf9f9137d2c573d8f7790c0";
// COLDSTART_MODEL_URL: a mirror (corporate proxy) or, in tests, a dead port so nothing ever reaches the network.
export const defaultBaseUrl = process.env.COLDSTART_MODEL_URL || `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/`;
export const defaultDir = modelDir;
/** hash kind: "gitsha1" = git blob id sha1("blob <size>\0" + bytes) — what Hugging Face lists for non-LFS files. */
export const FILES = [
  { path: "config.json", size: 5031, gitsha1: "b267dcb270ba41f67a8d14001bf470f23a9525fb" },
  { path: "tokenizer_config.json", size: 1599, gitsha1: "a9afd12fb3ca2c418fd405320ace85ad46748d03" },
  { path: "tokenizer.json", size: 32170510, sha256: "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4" },
  { path: "onnx/model_q4.onnx", size: 490742, sha256: "f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9" },
  { path: "onnx/model_q4.onnx_data", size: 174028800, sha256: "c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49" },
];
const LOCK_STALE_MS = 10 * 60_000, HEARTBEAT_MS = 30_000, STALL_MS = 60_000, PROGRESS_MS = 250;

const size = (p) => { try { return statSync(p).size; } catch { return -1; } };
const rm = (p) => { try { unlinkSync(p); } catch { /* gone */ } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const busy = (msg) => Object.assign(new Error(msg), { code: "EBUSY" });

/** Fast (stat only) — safe on every hook call. `have` counts partial .part bytes. */
export function modelStatus({ dir = modelDir(), files = FILES } = {}) {
  let have = 0, total = 0; const missing = [];
  for (const f of files) {
    total += f.size;
    const s = size(join(dir, f.path));
    if (s === f.size) have += s; else { missing.push(f.path); have += Math.max(0, Math.min(size(join(dir, f.path) + ".part"), f.size)); }
  }
  return { ready: missing.length === 0, have, total, missing };
}

async function hashFile(path, f) {
  const h = createHash(f.gitsha1 ? "sha1" : "sha256");
  if (f.gitsha1) h.update(`blob ${f.size}\0`);
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex") === (f.gitsha1 ?? f.sha256);
}

// ---------------------------------------------------------------- lock
function takeLock(dir) {
  const lp = join(dir, ".download.lock");
  for (let i = 0; i < 3; i++) {
    try { const fd = openSync(lp, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let pid = NaN, age = 0;
      try { pid = parseInt(readFileSync(lp, "utf8"), 10); age = Date.now() - statSync(lp).mtimeMs; } catch { continue; } // vanished → retry
      if (pid === process.pid || (Number.isInteger(pid) && alive(pid) && age < LOCK_STALE_MS)) throw busy(`model download already running (pid ${pid})`);
      // stale: rename is atomic, so exactly one contender wins the takeover
      try { renameSync(lp, `${lp}.stale-${process.pid}`); rm(`${lp}.stale-${process.pid}`); } catch { /* lost the race */ }
      if (i === 2) throw busy("could not take the model download lock");
    }
  }
  const beat = setInterval(() => { try { const t = new Date(); utimesSync(lp, t, t); } catch { /* gone */ } }, HEARTBEAT_MS);
  beat.unref();
  return () => {
    clearInterval(beat);
    try { if (parseInt(readFileSync(lp, "utf8"), 10) === process.pid) unlinkSync(lp); } catch { /* not ours / gone */ }
  };
}

// ---------------------------------------------------------------- verified record
function readVerified(dir) {
  try { const v = JSON.parse(readFileSync(join(dir, ".verified.json"), "utf8")); const r = v && typeof v === "object" ? v[REVISION] : null; return r && typeof r === "object" ? r : {}; } catch { return {}; }
}
function writeVerified(dir, rec) {
  const p = join(dir, ".verified.json"), tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ [REVISION]: rec })); renameSync(tmp, p);
}

// ---------------------------------------------------------------- download one file into .part
async function fetchPart(url, part, f, signal, onBytes) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let have = size(part);
    if (have > f.size) { rm(part); have = -1; }
    if (have === f.size) return;
    const ctl = new AbortController(), abort = () => ctl.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let stall = setTimeout(() => ctl.abort(new Error(`stalled > ${STALL_MS / 1000}s`)), STALL_MS);
    try {
      const res = await fetch(url, { redirect: "follow", signal: ctl.signal, headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
      if (res.status === 416) { await res.body?.cancel(); rm(part); continue; } // our .part is bogus: restart
      if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`);
      const append = have > 0 && res.status === 206;
      let written = append ? have : 0;
      const meter = new Transform({ transform(chunk, _e, cb) {
        clearTimeout(stall); stall = setTimeout(() => ctl.abort(new Error(`stalled > ${STALL_MS / 1000}s`)), STALL_MS);
        written += chunk.length;
        if (written > f.size) return cb(new Error(`${f.path}: server sent more than ${f.size} bytes`));
        onBytes(written); cb(null, chunk);
      } });
      await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part, { flags: append ? "a" : "w" }));
      return;
    } finally { clearTimeout(stall); signal?.removeEventListener("abort", abort); }
  }
  throw new Error(`${f.path}: server rejected the resume range twice`);
}

/** Resolves when every file is present AND verified. Rejects with code EBUSY if another process is downloading. */
export async function ensureModel({ dir = modelDir(), files = FILES, baseUrl = defaultBaseUrl, onProgress, signal } = {}) {
  mkdirSync(dir, { recursive: true });
  const release = takeLock(dir);
  try {
    const verified = readVerified(dir), total = files.reduce((a, f) => a + f.size, 0);
    let done = 0, last = 0;
    const progress = (file, have, force = false) => {
      const now = Date.now(); if (!onProgress || (!force && now - last < PROGRESS_MS)) return; last = now;
      onProgress({ file, have, total: files.find((x) => x.path === file)?.size ?? 0, overallHave: done + have, overallTotal: total });
    };
    for (const f of files) {
      const dst = join(dir, f.path), part = dst + ".part";
      mkdirSync(dirname(dst), { recursive: true });
      if (size(dst) === f.size) {
        if (verified[f.path]) { done += f.size; continue; }
        if (await hashFile(dst, f)) { verified[f.path] = true; writeVerified(dir, verified); done += f.size; continue; }
        rm(dst); // right size, wrong bytes
      }
      signal?.throwIfAborted();
      await fetchPart(baseUrl + f.path, part, f, signal, (have) => progress(f.path, have));
      if (size(part) !== f.size) throw new Error(`${f.path}: expected ${f.size} bytes, got ${size(part)} (will resume)`);
      if (!(await hashFile(part, f))) { rm(part); throw new Error(`${f.path}: hash mismatch — discarded`); }
      if (existsSync(dst)) rm(dst);
      renameSync(part, dst);
      verified[f.path] = true; writeVerified(dir, verified);
      done += f.size; progress(f.path, 0, true);
    }
  } finally { release(); }
}
