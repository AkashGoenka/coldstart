// Text-only EmbeddingGemma 2 q4 on native onnxruntime-node, without transformers.js: tokenizer.json via
// @huggingface/tokenizers → ONNX run (empty image/video/audio features) → attention-masked mean pool → L2.
// Step 0 (docs/embedder-daemon-design.md Decision 1): vectors match transformers.js to cos ≥ 0.999999.
// Only the embedder daemon loads this (~0.7 GB resident); everything else asks the daemon.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIM, TOKEN_CAPS, WINDOWED_ROLES, ROLES, modelDir } from "./embed-recipe.mjs";

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

  const encodeAll = (text) => tok.encode(text).ids;
  const bos = encodeAll("")[0]; // the template wraps every text as <bos> … <eos>; windows re-open with <bos>, only the last keeps <eos>

  /** One padded run; returns, per row, the UNNORMALISED sum of its token states (mean-pool numerator). */
  async function sums(rows) {
    const B = rows.length, L = Math.max(...rows.map((e) => e.length));
    const ids = new BigInt64Array(B * L), mask = new BigInt64Array(B * L);
    rows.forEach((e, b) => e.forEach((id, i) => { ids[b * L + i] = BigInt(id); mask[b * L + i] = 1n; }));
    const out = await sess.run({
      input_ids: new ort.Tensor("int64", ids, [B, L]), attention_mask: new ort.Tensor("int64", mask, [B, L]),
      image_features: empty, video_features: empty, audio_features: empty,
    }, ["last_hidden_state"]);
    const h = out.last_hidden_state.data, D = out.last_hidden_state.dims[2];
    return rows.map((e, b) => {
      const v = new Float64Array(D);
      for (let i = 0; i < e.length; i++) { const o = (b * L + i) * D; for (let j = 0; j < D; j++) v[j] += h[o + j]; }
      return v;
    });
  }
  const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };

  /** texts → unit Float32Array(768) each. Texts within the role's cap: one padded batch run (as always).
   *  Longer: truncated, except WINDOWED_ROLES (notes) — split into cap-sized windows, each re-opened with <bos>, run one window at a time
   *  (bounded memory: attention is quadratic), and pooled TOKEN-WEIGHTED across windows — i.e. one mean over
   *  every token, which approximates embedding the whole text in one run. */
  async function embed(texts, role) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
    const cap = TOKEN_CAPS[role], windowed = WINDOWED_ROLES.has(role);
    const enc = texts.map((t) => { const ids = encodeAll(ROLES[role] + t); return windowed || ids.length <= cap ? ids : ids.slice(0, cap); });
    const out = new Array(texts.length), short = enc.map((e, i) => i).filter((i) => enc[i].length <= cap);
    if (short.length) (await sums(short.map((i) => enc[i]))).forEach((v, k) => { out[short[k]] = unit(v); });
    for (let i = 0; i < enc.length; i++) {
      if (out[i]) continue;
      const body = enc[i][0] === bos ? enc[i].slice(1) : enc[i], acc = new Float64Array(DIM);
      for (let s = 0; s < body.length; s += cap - 1) {
        const [v] = await sums([[bos, ...body.slice(s, s + cap - 1)]]);
        for (let j = 0; j < DIM; j++) acc[j] += v[j];
      }
      out[i] = unit(acc);
    }
    return out;
  }
  return { embed, tokens: (text) => encodeAll(text).length, release: () => sess.release?.() };
}
