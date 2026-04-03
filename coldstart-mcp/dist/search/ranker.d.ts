import type { CodebaseIndex, QueryResult } from '../types.js';
export interface FindFilesOptions {
    domain?: string;
    limit?: number;
    preferSource?: boolean;
}
export declare function findFiles(query: string, index: CodebaseIndex, options?: FindFilesOptions): QueryResult[];
//# sourceMappingURL=ranker.d.ts.map