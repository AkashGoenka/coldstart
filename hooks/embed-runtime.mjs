// Text-only EmbeddingGemma 2 q4 on native onnxruntime-node, without transformers.js: tokenizer.json via
// @huggingface/tokenizers → ONNX run (empty image/video/audio features) → attention-masked mean pool → L2.
// Step 0 (docs/embedder-daemon-design.md Decision 1): vectors match transformers.js to cos ≥ 0.999999.
// Only the embedder daemon's model processes (hooks/embed-worker.mjs) load this (~0.5 GB fresh: ~120 MB of it is the
// tokenizer's JS heap; grows with the longest run); everything else asks the daemon. Module top level loads no
// runtime (the daemon imports `poolSums` from here without loading the model).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIM, TOKEN_CAPS, WINDOWED_ROLES, ROLES, modelDir } from "./embed-recipe.mjs";

export const MODEL_FILES = ["tokenizer.json", "tokenizer_config.json", "onnx/model_q4.onnx", "onnx/model_q4.onnx_data"];
export const runtimeAvailable = async () => { try { await import("onnxruntime-node"); return true; } catch { return false; } };
export const modelFilesPresent = (dir = modelDir()) => MODEL_FILES.every((f) => existsSync(join(dir, f)));

/** Unnormalised sum → unit Float32Array. */
export const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
/** Per-window token sums (in window order) → the token-weighted mean, L2-normalised. Shared by `embed` and the
 *  daemon's per-window backfill, so both paths give bit-identical vectors. */
export function poolSums(parts) {
  const acc = new Float64Array(DIM);
  for (const v of parts) for (let j = 0; j < DIM; j++) acc[j] += v[j];
  return unit(acc);
}

/** Load once. `threads` = intra-op threads for every run (the daemon picks it). */
export async function loadEmbedder({ dir = modelDir(), threads = 2 } = {}) {
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tok = new Tokenizer(JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")), JSON.parse(readFileSync(join(dir, "tokenizer_config.json"), "utf8")));
  const sess = await ort.InferenceSession.create(join(dir, "onnx/model_q4.onnx"), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all",
    // memory patterns are planned per input SHAPE and kept; every text length is a new shape → off saves ~140 MB of
    // peak on the notebook workload, same speed, bit-identical vectors (2026-11-19 bench)
    enableMemPattern: false });
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
  /** Windows of a WINDOWED_ROLES text past its cap, each re-opened with <bos> (only the last keeps <eos>); null when
   *  the text fits one run (or the role truncates). The daemon runs each window as its own call (`sumWindow`) so
   *  queries can slot in between windows, then pools them with `poolSums` — the same arithmetic as `embed`. */
  function windows(text, role) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
    const cap = TOKEN_CAPS[role], ids = encodeAll(ROLES[role] + text);
    if (!WINDOWED_ROLES.has(role) || ids.length <= cap) return null;
    const body = ids[0] === bos ? ids.slice(1) : ids, out = [];
    for (let s = 0; s < body.length; s += cap - 1) out.push([bos, ...body.slice(s, s + cap - 1)]);
    return out;
  }
  const sumWindow = async (ids) => (await sums([ids]))[0];

  /** texts → unit Float32Array(768) each. Texts within the role's cap: one padded batch run (as always).
   *  Longer: truncated, except WINDOWED_ROLES (notes) — split into cap-sized windows (`windows`), run one window at a
   *  time (bounded memory: attention is quadratic), and pooled TOKEN-WEIGHTED across windows — i.e. one mean over
   *  every token, which approximates embedding the whole text in one run. */
  async function embed(texts, role) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
    const cap = TOKEN_CAPS[role];
    const wins = texts.map((t) => windows(t, role));
    const enc = texts.map((t, i) => { if (wins[i]) return null; const ids = encodeAll(ROLES[role] + t); return ids.length <= cap ? ids : ids.slice(0, cap); });
    const out = new Array(texts.length), short = enc.map((e, i) => i).filter((i) => enc[i]);
    if (short.length) (await sums(short.map((i) => enc[i]))).forEach((v, k) => { out[short[k]] = unit(v); });
    for (let i = 0; i < texts.length; i++) {
      if (out[i]) continue;
      const parts = [];
      for (const w of wins[i]) parts.push(await sumWindow(w));
      out[i] = poolSums(parts);
    }
    return out;
  }
  return { embed, windows, sumWindow, tokens: (text) => encodeAll(text).length, release: () => sess.release?.() };
}
