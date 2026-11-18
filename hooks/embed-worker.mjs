// One model PROCESS for the embedder daemon (hooks/embedder-daemon.mjs forks it with an IPC channel): the main
// lane (backfill + queries while no backfill runs) and the query lane (queries only, alive while backfill has work)
// are both this file. A process, not a worker_thread: ORT keeps its peak arena, and measured on M1 Pro a terminated
// worker_thread gave back only ~1.2 of 1.76 GB (daemon stayed at 561 MB vs 48 MB before load) — a process exit
// returns everything, which is what the lane's exit and the main reload after backfill exist for.
// session.run blocks this process's JS thread for the whole run, so the daemon's socket stays responsive and its
// watchdog can SIGKILL a stuck run. Calls run strictly one at a time, in arrival order.
//
// IPC (serialization "advanced", typed arrays travel as-is): {id, op: "embed", texts, role} → Float32Array[] ·
// {id, op: "windows", text, role} → number[][] | null · {id, op: "plan", text, role} → {tokens, windows} (the
// daemon's lane-start rule reads the token count) · {id, op: "sums", ids} → Float64Array (unnormalised).
// Every reply carries this process's rss (MB). Never outlives the daemon: the IPC channel closes when the daemon
// dies, even on kill -9 → "disconnect" → exit.
import "./regex-engine.mjs";
import { loadEmbedder } from "./embed-runtime.mjs";
import { ROLES } from "./embed-recipe.mjs";

process.on("disconnect", () => process.exit(0));
const { dir, threads } = JSON.parse(process.argv[2] || "{}");
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const send = (m) => { if (process.connected) process.send(m); else process.exit(0); };

const embedder = await loadEmbedder({ dir, threads });
send({ type: "ready", rss: rss() });
let chain = Promise.resolve();
process.on("message", (m) => {
  chain = chain.then(async () => {
    try {
      const out = m.op === "plan" ? { tokens: embedder.tokens(ROLES[m.role] + m.text), windows: embedder.windows(m.text, m.role) }
        : m.op === "windows" ? embedder.windows(m.text, m.role)
        : m.op === "sums" ? await embedder.sumWindow(m.ids)
        : await embedder.embed(m.texts, m.role);
      send({ type: "result", id: m.id, out, rss: rss() });
    } catch (e) {
      send({ type: "error", id: m.id, error: String(e?.message || e), rss: rss() });
    }
  });
});
