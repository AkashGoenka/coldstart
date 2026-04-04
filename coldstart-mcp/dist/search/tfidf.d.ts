import type { IndexedFile } from '../types.js';
export interface TFIDFIndex {
    vectors: Map<string, Map<string, number>>;
    idf: Map<string, number>;
}
/**
 * Build TF-IDF index over all files.
 * TF is raw weighted term count normalized by document length.
 * IDF = log(N / df + 1) (smooth to avoid division by zero).
 */
export declare function buildTFIDFIndex(files: IndexedFile[], contentTokensByFile?: Map<string, string[]>): TFIDFIndex;
/**
 * Query the TF-IDF index. Returns fileId → raw score.
 */
export declare function queryTFIDF(queryTokens: string[], index: TFIDFIndex): Map<string, number>;
//# sourceMappingURL=tfidf.d.ts.map