// Embed the frozen notebook + every eval prompt (alone AND with its last 3 exchanges) + the two gate criteria.
//   npx tsx embed.ts gemma2 [gemma granite-s]        (default: all three)
// Runs locally on CPU with transformers.js (ONNX). Models download once into model-cache/ (gitignored).
// Configs (pooling, prefixes, max length) come from each model's own sentence-transformers config, as in the v2 eval.
// Keys written to work/vectors/<model>.json: doc|<noteId>, P|<itemId> (prompt), H|<itemId> (history), CRIT|true, CRIT|false.
import { writeFileSync, mkdirSync } from "node:fs";
import { pipeline, env, AutoModel, AutoTokenizer } from "@huggingface/transformers";
import { loadItems, loadNotes, cleanBody, historyText, CRITERIA, p } from "./lib.ts";
env.cacheDir = new URL("./model-cache/", import.meta.url).pathname;

type Cfg = { hf: string; license: string; pooling: "cls" | "mean" | "model"; maxTokens: number; queryPrefix?: string; docPrefix?: string };
export const MODELS: Record<string, Cfg> = {
  // EmbeddingGemma 2 (Apache-2.0): feature-extraction + mean pooling per its card; prefixes on both sides.
  gemma2: { hf: "onnx-community/embeddinggemma-2-ONNX", license: "Apache-2.0", pooling: "mean", maxTokens: 8192,
    queryPrefix: "task: search result | query: ", docPrefix: "title: none | text: " },
  // EmbeddingGemma 1 (Gemma license: download on first use, never bundle). Pooling + dense layers live INSIDE the ONNX graph
  // (output sentence_embedding), so it must NOT go through the feature-extraction pipeline.
  gemma: { hf: "onnx-community/embeddinggemma-300m-ONNX", license: "Gemma", pooling: "model", maxTokens: 2048,
    queryPrefix: "task: search result | query: ", docPrefix: "title: none | text: " },
  // granite-embedding-small-english-r2 (Apache-2.0, 48M): CLS pooling, no prefixes.
  "granite-s": { hf: "onnx-community/granite-embedding-small-english-r2-ONNX", license: "Apache-2.0", pooling: "cls", maxTokens: 8192 },
};

async function loadEmbedder(cfg: Cfg) {
  const pre = (role: "query" | "doc") => (role === "query" ? cfg.queryPrefix : cfg.docPrefix) ?? "";
  if (cfg.pooling === "model") {
    const tok: any = await AutoTokenizer.from_pretrained(cfg.hf), model: any = await AutoModel.from_pretrained(cfg.hf, { dtype: "fp32" });
    return async (texts: string[], role: "query" | "doc") => {
      const rows = (await model(tok(texts.map((t) => pre(role) + t), { padding: true, truncation: true, max_length: cfg.maxTokens }))).sentence_embedding.tolist() as number[][];
      return rows.map((v) => { const n = Math.hypot(...v); return v.map((x) => x / n); }); };
  }
  const fe: any = await pipeline("feature-extraction", cfg.hf, { dtype: "fp32" });
  // some tokenizers ship no cap (granite r2: 1e30) → an over-long note runs past the position limit; clamp like sentence-transformers
  if (!(fe.tokenizer.model_max_length <= cfg.maxTokens)) Object.defineProperty(fe.tokenizer, "model_max_length", { value: cfg.maxTokens });
  return async (texts: string[], role: "query" | "doc") => (await fe(texts.map((t) => pre(role) + t), { pooling: cfg.pooling, normalize: true })).tolist() as number[][];
}

const items = loadItems(), notes = loadNotes();
const texts = [
  ...notes.map((n) => ({ key: `doc|${n.id}`, role: "doc" as const, text: cleanBody(n.body) })),
  ...items.map((q) => ({ key: `P|${q.id}`, role: "query" as const, text: q.prompt })),
  ...items.map((q) => ({ key: `H|${q.id}`, role: "query" as const, text: historyText(q) })),
  ...Object.entries(CRITERIA).map(([k, t]) => ({ key: `CRIT|${k}`, role: "query" as const, text: t })),
];
mkdirSync(p("vectors"), { recursive: true });
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS)) {
  const cfg = MODELS[name]; if (!cfg) throw new Error(`unknown model ${name}; one of ${Object.keys(MODELS).join(", ")}`);
  const t0 = performance.now(), embed = await loadEmbedder(cfg), loadMs = performance.now() - t0;
  const vecs: number[][] = new Array(texts.length); let dim = 0;
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].text.length - texts[b].text.length);
  for (let s = 0; s < order.length;) {
    const len = texts[order[s]].text.length, bs = len < 1500 ? 16 : 1, idx = order.slice(s, s + bs); // long texts one at a time: granite's ONNX builds a batch×L×L mask that overflows 4 GB
    for (const role of ["query", "doc"] as const) { const sub = idx.filter((i) => texts[i].role === role); if (!sub.length) continue;
      (await embed(sub.map((i) => texts[i].text), role)).forEach((v, j) => { vecs[sub[j]] = v; dim = v.length; }); }
    s += bs; process.stdout.write(`  ${name} ${Math.min(s, order.length)}/${order.length}\r`);
  }
  const encodeMs = performance.now() - t0 - loadMs, lat: number[] = [];
  for (const q of items.slice(0, 20)) { const a = performance.now(); await embed([q.prompt], "query"); lat.push(performance.now() - a); }
  lat.sort((a, b) => a - b);
  const f = new Float32Array(texts.length * dim); vecs.forEach((v, i) => f.set(v, i * dim));
  writeFileSync(p("vectors", `${name}.f32`), Buffer.from(f.buffer));
  writeFileSync(p("vectors", `${name}.json`), JSON.stringify({ model: cfg.hf, license: cfg.license, dim, pooling: cfg.pooling, maxTokens: cfg.maxTokens,
    queryPrefix: cfg.queryPrefix ?? null, docPrefix: cfg.docPrefix ?? null, loadMs, encodeMs, msPerQuery: lat[Math.floor(lat.length / 2)], keys: texts.map((t) => t.key) }));
  console.log(`\n${name}: ${texts.length} texts (${notes.length} notes, ${items.length} prompts ×2, 2 criteria) in ${(encodeMs / 1000).toFixed(0)} s · one query ≈ ${lat[Math.floor(lat.length / 2)].toFixed(0)} ms`);
}
