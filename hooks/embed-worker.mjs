// One model PROCESS for the embedder daemon (hooks/embedder-daemon.mjs forks it with an IPC channel): the main
// lane (backfill + queries while no backfill runs) and the query lane (queries only, alive while backfill has work)
// are both this file. It holds an ONNX session and NO tokenizer: the daemon tokenizes once for both lanes and sends
// token ids (the tokenizer used to be loaded in each process; it cost more than the q4 session itself).
// A process, not a worker_thread: a process exit returns ORT's whole peak arena, which the lane's exit and the main
// reload after backfill exist for, and the watchdog can SIGKILL a stuck run — terminate() on a worker_thread mid-run
// ABORTS the whole process (libc++abi Napi::Error, measured 3/3 on M1 Pro, 2026-11-22).
// session.run blocks this process's JS thread for the whole run, so the daemon's socket stays responsive. Calls run
// strictly one at a time, in arrival order.
//
// IPC (serialization "advanced", typed arrays travel as-is): {id, op: "embed", plans} → Float32Array[] (plans from
// embed-runtime's `plan`; windowed plans pooled here) · {id, op: "sums", rows} → Float64Array[] (unnormalised, one
// padded run — the daemon's per-window backfill). Every reply carries this process's rss (MB). argv[2] is JSON
// {dir, threads, protocol}: a daemon of another PROTOCOL (an older one still running after an update) gets exit 3
// instead of a process that speaks a different IPC. Never outlives the daemon: the IPC channel closes when the daemon
// dies, even on kill -9 → "disconnect" → exit.
import "./regex-engine.mjs";
import { embedPlanned, loadSession } from "./embed-runtime.mjs";
import { PROTOCOL } from "./embed-recipe.mjs";

process.on("disconnect", () => process.exit(0));
const { dir, threads, protocol } = JSON.parse(process.argv[2] || "{}");
if (protocol !== PROTOCOL) { process.stderr.write(`embed-worker: daemon protocol ${protocol} ≠ ${PROTOCOL} — exiting\n`); process.exit(3); }
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const send = (m) => { if (process.connected) process.send(m); else process.exit(0); };

const session = await loadSession({ dir, threads });
send({ type: "ready", rss: rss() });
let chain = Promise.resolve();
process.on("message", (m) => {
  chain = chain.then(async () => {
    try {
      const out = m.op === "sums" ? await session.sums(m.rows)
        : m.op === "embed" ? await embedPlanned(m.plans, session.sums)
        : (() => { throw new Error(`unknown op: ${m.op}`); })();
      send({ type: "result", id: m.id, out, rss: rss() });
    } catch (e) {
      send({ type: "error", id: m.id, error: String(e?.message || e), rss: rss() });
    }
  });
});
