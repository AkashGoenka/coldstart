import { basename, extname } from 'node:path';
import type { CodebaseIndex, QueryResult } from '../types.js';
import { tokenizeQuery } from './tokenizer.js';
import { queryTFIDF } from './tfidf.js';

export interface FindFilesOptions {
  domain?: string;
  limit?: number;           // default 5, max 10
  preferSource?: boolean;   // penalize test/type files harder
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

// Penalty multipliers
const PENALTY_TEST = 0.6;
const PENALTY_TYPE_DEF = 0.7;
const PENALTY_GENERATED = 0.5;

// Score bonuses
const BONUS_EXACT_PATH = 50;
const BONUS_TOKEN_BASENAME = 5;
const BONUS_TOKEN_EXPORT = 4;
const BONUS_MULTI_TERM = 2;
const BONUS_DOMAIN = 8;
const BOOST_COCHANGE = 0.15;  // 15% boost

// Weight factors for combined score
const WEIGHT_TFIDF = 0.35;
const WEIGHT_PAGERANK = 0.15;

export function findFiles(
  query: string,
  index: CodebaseIndex,
  options: FindFilesOptions = {},
): QueryResult[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const queryLower = query.toLowerCase();
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) return [];

  // TF-IDF raw scores
  const tfidfRaw = queryTFIDF(tokens, { vectors: index.tfidf, idf: index.idf });

  // Normalize TF-IDF and PageRank to 0-100 range
  const maxTFIDF = Math.max(...tfidfRaw.values(), 0.0001);
  const prValues = [...index.pagerank.values()];
  const maxPR = Math.max(...prValues, 0.0001);

  const scored: Array<{ id: string; score: number; reasons: string[] }> = [];

  for (const [id, file] of index.files) {
    if (options.domain && file.domain !== options.domain) continue;

    const reasons: string[] = [];
    let score = 0;

    // --- Exact phrase match in path ---
    if (file.relativePath.toLowerCase().includes(queryLower)) {
      score += BONUS_EXACT_PATH;
      reasons.push(`exact path match: "${queryLower}"`);
    }

    // --- TF-IDF score ---
    const tfidfScore = ((tfidfRaw.get(id) ?? 0) / maxTFIDF) * 100 * WEIGHT_TFIDF;
    if (tfidfScore > 0) {
      score += tfidfScore;
      reasons.push(`tfidf: ${tfidfScore.toFixed(1)}`);
    }

    // --- PageRank score ---
    const prScore = ((index.pagerank.get(id) ?? 0) / maxPR) * 100 * WEIGHT_PAGERANK;
    if (prScore > 0.5) {
      score += prScore;
      reasons.push(`pagerank: ${prScore.toFixed(1)}`);
    }

    // --- Per-token basename match ---
    const base = basename(file.relativePath, extname(file.relativePath)).toLowerCase();
    let tokenBasenameMatches = 0;
    for (const tok of tokens) {
      if (base.includes(tok)) {
        score += BONUS_TOKEN_BASENAME;
        tokenBasenameMatches++;
      }
    }
    if (tokenBasenameMatches > 0) {
      reasons.push(`basename match (${tokenBasenameMatches} tokens): +${tokenBasenameMatches * BONUS_TOKEN_BASENAME}`);
    }

    // --- Per-token export match ---
    let tokenExportMatches = 0;
    for (const tok of tokens) {
      for (const exp of file.exports) {
        if (exp.toLowerCase().includes(tok)) {
          score += BONUS_TOKEN_EXPORT;
          tokenExportMatches++;
          break; // one match per token is enough
        }
      }
    }
    if (tokenExportMatches > 0) {
      reasons.push(`export match (${tokenExportMatches} tokens): +${tokenExportMatches * BONUS_TOKEN_EXPORT}`);
    }

    // --- Multi-term intersection bonus ---
    const matchingTermCount = tokens.filter(tok =>
      base.includes(tok) ||
      file.relativePath.toLowerCase().includes(tok) ||
      file.exports.some(e => e.toLowerCase().includes(tok)) ||
      file.domain.includes(tok),
    ).length;
    if (matchingTermCount > 1) {
      const bonus = (matchingTermCount - 1) * BONUS_MULTI_TERM;
      score += bonus;
      reasons.push(`multi-term intersection (${matchingTermCount}): +${bonus}`);
    }

    // --- Domain match ---
    if (tokens.some(tok => file.domain.includes(tok))) {
      score += BONUS_DOMAIN;
      reasons.push(`domain match: ${file.domain}`);
    }

    if (score > 0) {
      scored.push({ id, score, reasons });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // --- Co-change boost: top result boosts files that co-change with it ---
  if (scored.length > 1) {
    const topId = scored[0].id;
    const topCoChange = index.cochange.get(topId);
    if (topCoChange) {
      for (let i = 1; i < scored.length; i++) {
        const coScore = topCoChange.get(scored[i].id) ?? 0;
        if (coScore > 0.1) {
          const boost = scored[i].score * BOOST_COCHANGE * coScore;
          scored[i].score += boost;
          scored[i].reasons.push(`co-change with top result: +${boost.toFixed(1)}`);
        }
      }
      // Re-sort after co-change adjustment
      scored.sort((a, b) => b.score - a.score);
    }
  }

  // Apply penalties and build results
  const results: QueryResult[] = [];
  for (const { id, score, reasons } of scored.slice(0, limit * 3)) {
    const file = index.files.get(id)!;
    let finalScore = score;

    // Penalties
    const relLower = file.relativePath.toLowerCase();
    if (/\.test\.|\.spec\.|__tests__|_test\./.test(relLower)) {
      finalScore *= options.preferSource ? PENALTY_TEST * 0.8 : PENALTY_TEST;
      reasons.push('penalty: test file');
    } else if (relLower.endsWith('.d.ts')) {
      finalScore *= PENALTY_TYPE_DEF;
      reasons.push('penalty: type definition file');
    } else if (/generated|\.gen\.|\.pb\.|\.proto\./.test(relLower)) {
      finalScore *= PENALTY_GENERATED;
      reasons.push('penalty: generated file');
    }

    results.push({
      path: file.path,
      relativePath: file.relativePath,
      score: Math.round(finalScore * 100) / 100,
      domain: file.domain,
      language: file.language,
      exports: file.exports.slice(0, 20), // cap at 20
      centrality: Math.round((index.pagerank.get(id) ?? 0) * 10000) / 10000,
      archRole: file.archRole,
      isEntryPoint: file.isEntryPoint,
      reasons,
    });
  }

  // Final sort by score after penalties, trim to limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
