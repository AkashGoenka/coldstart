// Inference worker for the embedder daemon. onnxruntime-node's session.run blocks the calling JS thread for
// the whole run (verified: a daemon running an 8-text batch answered no pings for 400 ms, so a client thought
// it dead and spawned a second daemon writing the same store). Running the model here keeps the daemon's
// socket responsive and lets the daemon's watchdog actually kill a stuck run (worker.terminate()).
import "./regex-engine.mjs";
import { parentPort, workerData } from "node:worker_threads";
import { loadEmbedder } from "./embed-runtime.mjs";

const embedder = await loadEmbedder(workerData);
parentPort.postMessage({ type: "ready" });
parentPort.on("message", async ({ id, texts, role }) => {
  try {
    const vecs = await embedder.embed(texts, role);
    parentPort.postMessage({ type: "result", id, vecs }, vecs.map((v) => v.buffer));
  } catch (e) {
    parentPort.postMessage({ type: "error", id, error: String(e?.message || e) });
  }
});
