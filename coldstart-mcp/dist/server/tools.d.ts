import type { CodebaseIndex } from '../types.js';
export declare function handleGetOverview(index: CodebaseIndex, params: {
    domain_filter?: string;
}): object;
export declare function handleFindFiles(index: CodebaseIndex, params: {
    query: string;
    domain?: string;
    limit?: number;
    prefer_source?: boolean;
}): object;
export declare function handleTraceDeps(index: CodebaseIndex, params: {
    file_path: string;
    direction?: 'imports' | 'importers' | 'both';
    depth?: number;
}): object;
export declare function handleGetStructure(index: CodebaseIndex, params: {
    file_path: string;
}): object;
//# sourceMappingURL=tools.d.ts.map