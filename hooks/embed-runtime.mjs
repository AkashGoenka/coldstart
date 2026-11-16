// Text-only EmbeddingGemma 2 q4 on native onnxruntime-node, without transformers.js: tokenizer.json via
// @huggingface/tokenizers → ONNX run (empty image/video/audio features) → attention-masked mean pool → L2.
// Step 0 (docs/embedder-daemon-design.md Decision 1): vectors match transformers.js to cos ≥ 0.999999.
// Only the embedder daemon loads this (~0.7 GB resident); everything else asks the daemon.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MAX_TOKENS, ROLES, modelDir } from "./embed-recipe.mjs";

export const MODEL_FILES = ["tokenizer.json", "tokenizer_config.json", "onnx/model_q4.onnx", "onnx/model_q4.onnx_data"];
export const runtimeAvailable = async () => { try { await import("onnxruntime-node"); return true; } catch { return false; } };
export const modelFilesPresent = (dir = modelDir()) => MODEL_FILES.every((f) => existsSync(join(dir, f)));

/** Load once. `threads` = intra-op threads for every run (the daemon picks it). */
export async function loadEmbedder({ dir = modelDir(), threads = 2 } = {}) {
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tok = new Tokenizer(JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")), JSON.parse(readFileSync(join(dir, "tokenizer_config.json"), "utf8")));
  const sess = await ort.InferenceSession.create(join(dir, "onnx/model_q4.onnx"), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all" });
  const empty = new ort.Tensor("float32", new Float32Array(0), [0, 512]);

  const encode = (text) => { const ids = tok.encode(text).ids; return ids.length > MAX_TOKENS ? ids.slice(0, MAX_TOKENS) : ids; };

  /** texts → unit Float32Array(768) each. Batch = one padded run; the daemon mostly sends one text at a time. */
  async function embed(texts, role) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
    const enc = texts.map((t) => encode(ROLES[role] + t)), B = enc.length, L = Math.max(...enc.map((e) => e.length));
    const ids = new BigInt64Array(B * L), mask = new BigInt64Array(B * L);
    enc.forEach((e, b) => e.forEach((id, i) => { ids[b * L + i] = BigInt(id); mask[b * L + i] = 1n; }));
    const out = await sess.run({
      input_ids: new ort.Tensor("int64", ids, [B, L]), attention_mask: new ort.Tensor("int64", mask, [B, L]),
      image_features: empty, video_features: empty, audio_features: empty,
    }, ["last_hidden_state"]);
    const h = out.last_hidden_state.data, D = out.last_hidden_state.dims[2];
    return enc.map((e, b) => {
      const v = new Float32Array(D);
      for (let i = 0; i < e.length; i++) { const o = (b * L + i) * D; for (let j = 0; j < D; j++) v[j] += h[o + j]; }
      let n = 0; for (let j = 0; j < D; j++) n += v[j] * v[j]; n = Math.sqrt(n) || 1;
      for (let j = 0; j < D; j++) v[j] /= n;
      return v;
    });
  }
  return { embed, tokens: (text) => encode(text).length, release: () => sess.release?.() };
}
