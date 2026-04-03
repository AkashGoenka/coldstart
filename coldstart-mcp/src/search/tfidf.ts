import { basename, extname, dirname } from 'node:path';
import type { IndexedFile } from '../types.js';
import { tokenize } from './tokenizer.js';

// Weights for different document fields
const WEIGHT_BASENAME = 5;
const WEIGHT_DIR = 3;
const WEIGHT_EXPORT = 4;
const WEIGHT_DOMAIN = 1;

/**
 * Build a document representation for a file (weighted bag of terms).
 */
function buildDocument(file: IndexedFile): Map<string, number> {
  const termFreq = new Map<string, number>();

  function addTerms(tokens: string[], weight: number): void {
    for (const t of tokens) {
      termFreq.set(t, (termFreq.get(t) ?? 0) + weight);
    }
  }

  // Basename (highest weight)
  const base = basename(file.relativePath, extname(file.relativePath));
  addTerms(tokenize(base), WEIGHT_BASENAME);

  // Directory path segments
  const dir = dirname(file.relativePath);
  const dirSegments = dir.split(/[/\\]/).filter(s => s !== '.' && s.length > 0);
  for (const seg of dirSegments) {
    addTerms(tokenize(seg), WEIGHT_DIR);
  }

  // Exports
  for (const exp of file.exports) {
    addTerms(tokenize(exp), WEIGHT_EXPORT);
  }

  // Domain
  if (file.domain && file.domain !== 'unknown') {
    addTerms(tokenize(file.domain), WEIGHT_DOMAIN);
  }

  return termFreq;
}

export interface TFIDFIndex {
  // fileId → term → tf-idf score
  vectors: Map<string, Map<string, number>>;
  // term → idf
  idf: Map<string, number>;
}

/**
 * Build TF-IDF index over all files.
 * TF is raw weighted term count normalized by document length.
 * IDF = log(N / df + 1) (smooth to avoid division by zero).
 */
export function buildTFIDFIndex(files: IndexedFile[]): TFIDFIndex {
  const N = files.length;
  if (N === 0) return { vectors: new Map(), idf: new Map() };

  // Build raw term-freq docs
  const docs = new Map<string, Map<string, number>>();
  for (const file of files) {
    docs.set(file.id, buildDocument(file));
  }

  // Compute document frequency per term
  const df = new Map<string, number>();
  for (const termFreq of docs.values()) {
    for (const term of termFreq.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Compute IDF
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log(N / (count + 1)) + 1);
  }

  // Compute TF-IDF vectors
  const vectors = new Map<string, Map<string, number>>();
  for (const [fileId, termFreq] of docs) {
    // Normalize TF by total weighted count in doc
    const total = [...termFreq.values()].reduce((s, v) => s + v, 0);
    const vector = new Map<string, number>();
    for (const [term, freq] of termFreq) {
      const tf = freq / (total || 1);
      const idfScore = idf.get(term) ?? 1;
      vector.set(term, tf * idfScore);
    }
    vectors.set(fileId, vector);
  }

  return { vectors, idf };
}

/**
 * Query the TF-IDF index. Returns fileId → raw score.
 */
export function queryTFIDF(
  queryTokens: string[],
  index: TFIDFIndex,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const [fileId, vector] of index.vectors) {
    let score = 0;
    for (const token of queryTokens) {
      score += vector.get(token) ?? 0;
    }
    if (score > 0) scores.set(fileId, score);
  }

  return scores;
}
