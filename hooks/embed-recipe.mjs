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
export const MAX_TOKENS = 512;
export const DIM = 768;
export const RECIPE = "gemma2-q4-mean-l2-t512-v1";
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
