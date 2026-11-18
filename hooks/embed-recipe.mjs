// Shared constants for the embedder daemon and its clients (docs/embedder-daemon-design.md). Plain ESM, no deps:
// hooks, the keeper and the CLI all import this, the daemon included.
//
// RECIPE names everything that changes a vector besides its text (model, dtype, token cap, pooling, runtime
// glue). Bump it when any of those change: every key changes → the store rebuilds, deliberately, never silently.
import { createHash } from "node:crypto";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, join, resolve } from "node:path";

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
export const DTYPE = "q4";
export const DIM = 768;
/** Token cap per role (hooks/embed-runtime.mjs). Within it: one run, as always. Past it: code queries + file
 *  sketches are TRUNCATED; roles in WINDOWED_ROLES (notes, note queries) are instead split into windows of this size, each run alone, and
 *  pooled token-weighted (≈ one mean over the whole text). Why not one whole-text run: attention is quadratic — the
 *  6034-token note took 18 s at 4 threads and ~4 GB RSS, 8192 tokens 69.5 s at 2 threads (past the 60 s watchdog).
 *  Why not truncate: the recall gate was fit on untruncated vectors. Measured on the 200 v3 gate prompts vs whole-
 *  text vectors: truncate@2048 → 198/200 decisions, windows@2048 → 199/200 (the one long note: cos 0.986).
 *  Why 1024 and not 2048 (v4, 2026-11-19): peak RSS is set by the longest run and kept (ORT arena) — on the real notebook
 *  workload 1505 MB @2048 → 1006 @1024 (866 with enableMemPattern off) at the same speed, and the shipped gate on
 *  1024-windowed notes matched the 2048 decisions 577/580 (v1/v2/v3), ranking ±1. 512 lost a little (v3 gate 146 → 144),
 *  overlap hurt, structure-split / head-only / best-chunk scoring gave no consistent gain
 *  (~/coldstart-rag/scripts/pilot-window/). */
export const WINDOWED_ROLES = new Set(["note_query", "note_doc"]);
export const TOKEN_CAPS = { note_query: 1024, note_doc: 1024, code_query: 512, file_doc: 512 };
export const RECIPE = "gemma2-q4-mean-l2-win1024-mp0-v4";
/** Threads for the daemon's two model processes, from the machine's PERFORMANCE core count (owner, step 4b):
 *  query lane 2, MAIN (backfill) min(4, perf − 2) — the two never oversubscribe the perf cores (4+4 on 8 perf cores
 *  stalled one window 38 s). perf 4 → 2+2 · 6 → 4+2 · ≥ 8 → 4+2. perf ≤ 3 → 1+1 (MAIN at 1 thread costs ~2x:
 *  find 405 vs 213 ms, gate 1357 vs 724 — no better split exists there). */
export function threadPlan(perf) {
  const p = Math.max(1, Math.floor(perf) || 1);
  return p >= 4 ? { main: Math.min(4, p - 2), lane: 2 } : { main: 1, lane: 1 };
}
/** Bumped when the socket protocol changes incompatibly; a newer daemon replaces an older one, never the reverse. */
export const PROTOCOL = 1;

/** role → prefix the model sees. file_doc texts already carry `title: <path> | text:` (src/embedder/sketch.ts). */
export const ROLES = {
  note_query: "task: search result | query: ",
  note_doc: "title: none | text: ",
  code_query: "task: code retrieval | query: ",
  file_doc: "",
};

/** Key of the vector for `text` under `role` — what the store is indexed by. 32 hex chars. */
export function embedKey(role, text) {
  if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
  return createHash("sha256").update([RECIPE, MODEL_ID, DTYPE, role, text].join("\0")).digest("hex").slice(0, 32);
}

// ---- paths (MIRROR src/constants.ts coldstartHome + src/cache/disk-cache.ts getCacheDir) ----
export function coldstartHome() {
  const o = process.env.COLDSTART_HOME;
  return o && o.trim() ? o : join(homedir(), ".coldstart");
}
export function defaultRepoCacheDir(root) {
  const abs = resolve(root);
  return join(coldstartHome(), "indexes", `${basename(abs)}-${createHash("sha256").update(abs).digest("hex").slice(0, 16)}`);
}
export const embedderHome = () => join(coldstartHome(), "embedder");
export const vectorsDir = (repoCacheDir) => join(repoCacheDir, "vectors");
export const modelDir = () => join(process.env.COLDSTART_MODEL_DIR || join(homedir(), ".cache", "coldstart", "models"), MODEL_ID);

/** Per-user endpoint. Windows: named pipes are machine-global, so the name carries a hash of user + home.
 *  Unix: a socket in the 0700 embedder home, unless that path is too long for sun_path (~104 bytes on macOS). */
export function socketPath() {
  let user = ""; try { user = userInfo().username; } catch { /* no passwd entry */ }
  const tag = createHash("sha256").update(`${user}\0${coldstartHome()}`).digest("hex").slice(0, 16);
  if (process.platform === "win32") return `\\\\.\\pipe\\coldstart-embedder-${tag}`;
  const p = join(embedderHome(), "embedder.sock");
  if (Buffer.byteLength(p) < 100) return p;
  // too long for sun_path: a PER-USER short dir (never a shared /tmp name another user could pre-create).
  // macOS tmpdir() is already per-user; Linux prefers XDG_RUNTIME_DIR (0700, per user), else /tmp/coldstart-<uid>.
  const uid = typeof process.getuid === "function" ? process.getuid() : "u";
  const base = process.env.XDG_RUNTIME_DIR || (process.platform === "darwin" ? tmpdir() : join("/tmp", `coldstart-${uid}`));
  return join(base, `coldstart-embedder-${tag}.sock`);
}

/** Opt-out: `COLDSTART_EMBEDDER=0` (tests, kill switch) or `init --no-embedder` (writes this file). */
export const disabledFlagPath = () => join(embedderHome(), "disabled");
export const enabledFlagPath = () => join(embedderHome(), "enabled");
