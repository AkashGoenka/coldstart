import type { IndexedFile, Edge } from '../types.js';
export interface ResolveResult {
    edges: Edge[];
    unresolved: Array<{
        from: string;
        specifier: string;
    }>;
}
export declare function resolveImports(files: IndexedFile[], rootDir: string): Promise<ResolveResult>;
//# sourceMappingURL=resolver.d.ts.map