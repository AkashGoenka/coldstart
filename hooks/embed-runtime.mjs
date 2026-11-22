// Text-only EmbeddingGemma 2 q4 on native onnxruntime-node, without transformers.js: tokenizer.json → token ids
// (`loadTokenizer`) → ONNX run (empty image/video/audio features) → attention-masked mean pool → L2 (`loadSession`).
// Step 0 (docs/embedder-daemon-design.md Decision 1): vectors match transformers.js to cos ≥ 0.999999.
// The two halves load in DIFFERENT processes: the embedder daemon holds the one tokenizer and plans every text
// (token ids, truncation, windows); its model processes (hooks/embed-worker.mjs) hold only a session and get ids.
// The tokenizer is the official Rust `tokenizers` (napi prebuilts for every platform onnxruntime-node ships; ~120 MB
// footprint vs ~300 MB for the JS `@huggingface/tokenizers` it replaced, ids identical on 809 real texts,
// 2026-11-22). No JS fallback: both natives are optional deps, and a machine where either won't load gets
// "model unavailable" → the recall gate's BM25 path, as with the embedder off.
// Module top level loads no runtime (the daemon imports `poolSums` from here before anything loads).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIM, TOKEN_CAPS, WINDOWED_ROLES, ROLES, modelDir } from "./embed-recipe.mjs";

export const MODEL_FILES = ["tokenizer.json", "tokenizer_config.json", "onnx/model_q4.onnx", "onnx/model_q4.onnx_data"];
export const runtimeAvailable = async () => { try { await import("onnxruntime-node"); await import("tokenizers"); return true; } catch { return false; } };
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

/** Load the tokenizer once. → {plan, windows, tokens}. `plan(text, role)` (async) → {tokens, rows, windowed}:
 *  `rows` are the id rows to run — ONE row when the text fits its role's cap (or is truncated to it:
 *  code_query/file_doc), else (WINDOWED_ROLES) cap-sized windows, each re-opened with <bos> (only the last keeps
 *  <eos>), to be summed one run each and pooled with `poolSums`. */
export async function loadTokenizer({ dir = modelDir() } = {}) {
  const m = await import("tokenizers");
  const tok = (m.Tokenizer ?? m.default?.Tokenizer).fromFile(join(dir, "tokenizer.json"));
  const encode = async (text) => (await tok.encode(text)).getIds();
  const bos = (await encode(""))[0]; // the template wraps every text as <bos> … <eos>

  async function plan(text, role) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown embed role: ${role}`);
    const cap = TOKEN_CAPS[role], ids = Array.from(await encode(ROLES[role] + text));
    if (ids.length <= cap) return { tokens: ids.length, rows: [ids], windowed: false };
    if (!WINDOWED_ROLES.has(role)) return { tokens: ids.length, rows: [ids.slice(0, cap)], windowed: false };
    const body = ids[0] === bos ? ids.slice(1) : ids, rows = [];
    for (let s = 0; s < body.length; s += cap - 1) rows.push([bos, ...body.slice(s, s + cap - 1)]);
    return { tokens: ids.length, rows, windowed: true };
  }
  return {
    plan,
    /** The windows of a WINDOWED_ROLES text past its cap; null when it runs as one row. */
    windows: async (text, role) => { const p = await plan(text, role); return p.windowed ? p.rows : null; },
    tokens: async (text) => (await encode(text)).length,
  };
}

/** Load the ONNX session once. `threads` = intra-op threads for every run (the daemon picks it). → {sums, release} */
export async function loadSession({ dir = modelDir(), threads = 2 } = {}) {
  const ort = await import("onnxruntime-node");
  const sess = await ort.InferenceSession.create(join(dir, "onnx/model_q4.onnx"), { intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: "all",
    // memory patterns are planned per input SHAPE and kept; every text length is a new shape → off saves ~140 MB of
    // peak on the notebook workload, same speed, bit-identical vectors (2026-11-19 bench)
    enableMemPattern: false });
  const empty = new ort.Tensor("float32", new Float32Array(0), [0, 512]);

  /** One padded run over id rows; returns, per row, the UNNORMALISED sum of its token states (mean-pool numerator). */
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
  return { sums, release: () => sess.release?.() };
}

/** plans (from `plan`) → unit Float32Array(768) each. Single-row plans: one padded batch run (as always). Windowed:
 *  one run per window (bounded memory: attention is quadratic), pooled TOKEN-WEIGHTED — one mean over every token,
 *  which approximates embedding the whole text in one run. Shared by `loadEmbedder` and the model process, so every
 *  path gives bit-identical vectors. */
export async function embedPlanned(plans, sums) {
  const out = new Array(plans.length), short = plans.map((p, i) => i).filter((i) => !plans[i].windowed);
  if (short.length) (await sums(short.map((i) => plans[i].rows[0]))).forEach((v, k) => { out[short[k]] = unit(v); });
  for (let i = 0; i < plans.length; i++) {
    if (out[i]) continue;
    const parts = [];
    for (const row of plans[i].rows) parts.push((await sums([row]))[0]);
    out[i] = poolSums(parts);
  }
  return out;
}

/** Tokenizer + session in ONE process (tests, offline tools). The daemon splits them across processes instead. */
export async function loadEmbedder({ dir = modelDir(), threads = 2 } = {}) {
  const [tk, s] = await Promise.all([loadTokenizer({ dir }), loadSession({ dir, threads })]);
  /** texts → unit Float32Array(768) each (see `plan` for truncation vs windows). */
  const embed = async (texts, role) => embedPlanned(await Promise.all(texts.map((t) => tk.plan(t, role))), s.sums);
  return { embed, plan: tk.plan, windows: tk.windows, tokens: tk.tokens, release: s.release };
}
