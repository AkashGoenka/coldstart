/**
 * Embedding re-rank of `find`'s top files (pilot-find, 2026-11-15/16). find's own ranking is kept as one vote; the
 * cosine between the query vector and each file's sketch vector (src/embedder/sketch.ts, stored by the embedder
 * daemon) is the other. Fusion = weighted RRF, k = 10, over find's top 25 non-test files:
 *     score(f) = 1/(10 + findRank) + w/(10 + embRank)
 * Weights were FIT on arches benchmark prompts and confirmed (fixed) on jmri:
 *   - agent find, prose-shaped terms   w = 0.75
 *   - agent find, identifier-shaped    w = 0     (no gain measured → not re-ranked at all)
 *   - prompt-time injection (reduced terms to find, FULL prompt embedded)  w = 1.5
 * The prose/identifier rule is the pilot's own (build-eval.ts `shape`), the one the weights were fit against.
 *
 * Never blocks: embedder off/not opted in, daemon absent or over budget, or too few stored vectors → null, and the
 * caller keeps today's order. Readers never build: a missing file vector is NOT embedded here (the daemon's backfill
 * owns that); such a file simply gets no embedding vote.
 */
import { embedderDisabled, embedTexts, ensureEmbedder, repoCacheDir } from '../../hooks/embed-client.mjs';
import { openReader } from '../../hooks/vector-store.mjs';
import { DIM, RECIPE, TOKEN_CAPS, embedKey, vectorsDir } from '../../hooks/embed-recipe.mjs';
import type { CodebaseIndex } from '../types.js';
import { sketchFilter, sketchText } from './sketch.js';

export const RERANK_TOP = 25;
export const RRF_K = 10;
export const W_PROSE = 0.75;
export const W_PROMPT = 1.5;
/** Below this share of the pool with stored vectors the embedding vote is too partial to trust. */
const MIN_VECTOR_SHARE = 0.5;

/** The pilot's shape rule: ≥ 40% identifier-like tokens → "id". */
export function queryShape(terms: string): 'id' | 'prose' {
  const toks = terms.split(/[\s,]+/).filter(Boolean);
  const idLike = toks.filter((t) => /[a-z][A-Z]|_|\.|\/|^[A-Z][a-z]+[A-Z]|^[A-Z0-9_]{3,}$|\(/.test(t)).length;
  return idLike / Math.max(1, toks.length) >= 0.4 ? 'id' : 'prose';
}

export interface RerankResult {
  order: string[];        // the pool, re-ordered
  pool: number;           // files considered
  withVec: number;        // of which had a stored vector
  ms: number;
}

export interface RerankOpts {
  weight: number;
  /** text embedded as the query (role code_query); agent find = its terms, injection = the full user prompt */
  queryText: string;
  cacheDir?: string;
  budgetMs?: number;
}

/** Re-rank the first RERANK_TOP non-test paths of `ranked`. Returns null when it can't (see header). */
export async function rerankTop(index: CodebaseIndex, root: string, ranked: readonly string[], o: RerankOpts): Promise<RerankResult | null> {
  if (o.weight <= 0 || embedderDisabled()) return null;
  const t0 = Date.now();
  const pool = ranked.filter((rel) => !index.files.get(rel)?.isTestFile).slice(0, RERANK_TOP);
  if (pool.length < 2) return null;
  // data files never get a vector (sketchFilter): they don't count against the share, and inside the pool they get
  // no embedding vote, so they sink below files that have one (a data dump is never the answer to a prose query)
  const sketched = sketchFilter(index);
  const cacheDir = o.cacheDir ?? repoCacheDir(root);
  let vecs: Map<string, Float32Array>;
  const keyOf = new Map<string, string>();
  try {
    for (const rel of pool) keyOf.set(rel, embedKey('file_doc', sketchText(rel, index.files.get(rel)!.symbols)));
    vecs = openReader(vectorsDir(cacheDir), { recipe: RECIPE, dim: DIM }).get([...keyOf.values()]);
  } catch { return null; }
  // a file sketchFilter now excludes may still have a vector from an older backfill: it gets no vote either
  const withVec = pool.filter((rel) => sketched(rel) && vecs.has(keyOf.get(rel)!));
  const eligible = pool.filter(sketched).length;
  if (withVec.length < Math.max(2, eligible * MIN_VECTOR_SHARE)) return null;

  // code_query is truncated at its token cap by the daemon; cap chars too so a pasted log doesn't ship megabytes
  const q = await embedTexts([o.queryText.slice(0, TOKEN_CAPS.code_query * 8)], 'code_query', { connectMs: 200, budgetMs: o.budgetMs ?? 300 });
  // warm the daemon for next time without waiting here; a CLI caller awaits settleWarm() before it exits
  // (process.exit right after find would otherwise kill the spawn — B1, verifier 2026-11-17)
  if (!q) { warm = ensureEmbedder().catch(() => undefined); return null; }
  const qv = q[0];
  const cos = (v: Float32Array) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * qv[i]; return s; };
  const sim = new Map(withVec.map((rel) => [rel, cos(vecs.get(keyOf.get(rel)!)!)]));
  const embRank = new Map([...withVec].sort((a, b) => sim.get(b)! - sim.get(a)!).map((rel, i) => [rel, i + 1]));
  const fused = (rel: string, i: number) => 1 / (RRF_K + i + 1) + (embRank.has(rel) ? o.weight / (RRF_K + embRank.get(rel)!) : 0);
  const scored = pool.map((rel, i) => ({ rel, s: fused(rel, i), i }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return { order: scored.map((x) => x.rel), pool: pool.length, withVec: withVec.length, ms: Date.now() - t0 };
}

/**
 * `ranked` with the pool's SLOTS refilled in the re-ranked order; every other entry (test files under `find --tests`,
 * the tail past the pool) keeps its exact position. Moving the pool to the front instead buried every test file below
 * position 25 (B2, verifier 2026-11-17).
 */
export function applyOrder<T>(ranked: readonly T[], key: (x: T) => string, order: readonly string[]): T[] {
  const inPool = new Set(order);
  const byKey = new Map(ranked.map((x) => [key(x), x]));
  let k = 0;
  return ranked.map((x) => (inPool.has(key(x)) ? byKey.get(order[k++])! : x));
}

let warm: Promise<unknown> | null = null;
/** Resolves once a daemon warm-up started by rerankTop has been handed off (bounded by ensureEmbedder's own timeouts). */
export function settleWarm(): Promise<unknown> { return warm ?? Promise.resolve(); }
