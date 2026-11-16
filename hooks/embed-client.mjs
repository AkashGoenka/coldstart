// Client side of the embedder daemon (docs/embedder-daemon-design.md §1, §4). Used by hooks, the keeper and the
// CLI. Rules: never throws, never blocks past its budget, never waits for the daemon to exist — a missing or
// slow daemon is `null` and the caller falls back to today's behaviour.
//
// Wire format: one JSON object per line each way. Vectors travel as base64 little-endian float32.
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PROTOCOL, disabledFlagPath, enabledFlagPath, embedderHome, socketPath } from "./embed-recipe.mjs";

export const encodeVec = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
export const decodeVec = (s) => { const b = Buffer.from(s, "base64"); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

// OPT-IN while the build is being verified (2026-11-16): runs only with COLDSTART_EMBEDDER=1 or after
// `init --embedder` (writes enabledFlagPath). COLDSTART_EMBEDDER=0 / `init --no-embedder` always win.
// Flip to opt-out (installed by default, design Decision 3) once its surfaces pass their evals.
export const embedderDisabled = () => process.env.COLDSTART_EMBEDDER === "0" || existsSync(disabledFlagPath()) ||
  !(process.env.COLDSTART_EMBEDDER === "1" || existsSync(enabledFlagPath()));

/** One request → one reply, or null on any failure / timeout. */
export function request(msg, { connectMs = 200, budgetMs = 300 } = {}) {
  return new Promise((done) => {
    let settled = false, buf = "";
    let sock = null, t1 = null, t2 = null;
    const finish = (v) => { if (settled) return; settled = true; clearTimeout(t1); clearTimeout(t2); try { sock?.destroy(); } catch { /* gone */ } done(v); };
    const sp = socketPath();
    // a socket (or its dir) owned by another user is not our daemon: never send it our texts
    if (process.platform !== "win32" && typeof process.getuid === "function") {
      try { if (statSync(sp).uid !== process.getuid() || statSync(dirname(sp)).uid !== process.getuid()) { done(null); return; } } catch { /* absent → connect fails below */ }
    }
    sock = connect(sp);
    t1 = setTimeout(() => finish(null), connectMs);
    t2 = setTimeout(() => finish(null), connectMs + budgetMs);
    sock.on("connect", () => { clearTimeout(t1); sock.write(JSON.stringify(msg) + "\n"); });
    sock.on("data", (d) => { buf += d; const nl = buf.indexOf("\n"); if (nl >= 0) { try { finish(JSON.parse(buf.slice(0, nl))); } catch { finish(null); } } });
    sock.on("error", () => finish(null));
    sock.on("close", () => finish(null));
  });
}

/** Query vectors for `texts` under `role`, or null (daemon absent / busy / over budget). */
export async function embedTexts(texts, role, opts) {
  const r = await request({ op: "embed", role, texts }, opts);
  return r?.ok && Array.isArray(r.vecs) ? r.vecs.map(decodeVec) : null;
}

// ---------------------------------------------------------------- registration + spawn

/** Persist this repo for the daemon (one file per repo → no shared-file contention; survives daemon restarts). */
export function registerRepo(root, cacheDir) {
  const abs = resolve(root), dir = join(embedderHome(), "repos");
  const p = join(dir, createHash("sha256").update(abs).digest("hex").slice(0, 16) + ".json");
  const body = JSON.stringify({ root: abs, cacheDir: resolve(cacheDir) });
  try { if (readFileSync(p, "utf8") === body) return; } catch { /* new */ }
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, body); renameSync(tmp, p); } catch { /* best effort */ }
}

const DAEMON_ENTRY = fileURLToPath(new URL("./embedder-daemon.mjs", import.meta.url));
const SPAWN_STALE_MS = 60_000, MODEL_RETRY_MS = 10 * 60_000;

/** Spawn the daemon detached unless one answers or another process is already spawning it. Never waits. */
export async function ensureEmbedder({ connectMs = 200 } = {}) {
  if (embedderDisabled()) return "disabled";
  const live = await request({ op: "ping" }, { connectMs, budgetMs: 200 });
  if (live && (live.protocol ?? 0) >= PROTOCOL) return "running"; // same or NEWER protocol: never kill a newer daemon
  if (live) { // older protocol: ask it to go, then spawn ours (its exit frees the socket)
    await request({ op: "stop" }, { connectMs, budgetMs: 2000 });
    for (let i = 0; i < 20 && (await request({ op: "ping" }, { connectMs: 100, budgetMs: 100 })); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const home = embedderHome(), lock = join(home, "spawn.lock");
  // the last daemon could not load the model (bad download, no network): don't respawn it on every save
  try { const m = JSON.parse(readFileSync(join(home, "state.json"), "utf8")).model; if (m?.status === "unavailable" && Date.now() - m.failedAt < MODEL_RETRY_MS) return "cooldown"; } catch { /* no state */ }
  try { mkdirSync(home, { recursive: true, mode: 0o700 }); } catch { return "error"; }
  for (let attempt = 0; attempt < 2; attempt++) {
    try { closeSync(openSync(lock, "wx")); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > SPAWN_STALE_MS) { unlinkSync(lock); continue; } } catch { continue; }
      return "spawning"; // someone else is on it
    }
  }
  try {
    const child = spawn(process.execPath, [DAEMON_ENTRY], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    // The daemon removes spawn.lock once it listens; the stale takeover covers a daemon that dies first.
    return "spawned";
  } catch { try { unlinkSync(lock); } catch { /* gone */ } return "error"; }
}

/** Fire-and-forget: tell the daemon something changed for a repo, spawning it if needed. */
export async function notifyEmbedder(op, root, cacheDir, extra = {}) {
  if (embedderDisabled()) return;
  registerRepo(root, cacheDir);
  const r = await request({ op, root: resolve(root), ...extra }, { connectMs: 200, budgetMs: 500 });
  if (!r) await ensureEmbedder(); // a fresh daemon reconciles every registered repo on start
}
