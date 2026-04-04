export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'csharp' | 'cpp' | 'ruby' | 'php' | 'swift' | 'kotlin' | 'dart';
export type EdgeType = 'import' | 'dynamic-import' | 'reexport' | 'mod-decl' | 'include';
export type ArchRole = 'router' | 'service' | 'repository' | 'middleware' | 'controller' | 'model' | 'util' | 'config' | 'test' | 'types' | 'entry' | 'unknown';
export interface IndexedFile {
    id: string;
    path: string;
    relativePath: string;
    language: Language;
    domain: string;
    exports: string[];
    hasDefaultExport: boolean;
    imports: string[];
    hash: string;
    lineCount: number;
    tokenEstimate: number;
    isEntryPoint: boolean;
    archRole: ArchRole;
    centrality: number;
    depth: number;
}
export interface Edge {
    from: string;
    to: string;
    type: EdgeType;
    specifier: string;
}
export interface TFIDFVector {
    fileId: string;
    terms: Map<string, number>;
}
export interface CodebaseIndex {
    rootDir: string;
    files: Map<string, IndexedFile>;
    edges: Edge[];
    outEdges: Map<string, string[]>;
    inEdges: Map<string, string[]>;
    pagerank: Map<string, number>;
    cochange: Map<string, Map<string, number>>;
    tfidf: Map<string, Map<string, number>>;
    idf: Map<string, number>;
    indexedAt: number;
    gitHead: string;
}
export interface QueryResult {
    path: string;
    relativePath: string;
    score: number;
    domain: string;
    language: Language;
    exports: string[];
    centrality: number;
    archRole: ArchRole;
    isEntryPoint: boolean;
    reasons: string[];
}
export interface LanguageConfig {
    extensions: string[];
    importPatterns: RegExp[];
    exportPatterns: RegExp[];
}
export interface WalkedFile {
    absolutePath: string;
    relativePath: string;
    language: Language;
}
export interface ParsedFile {
    imports: string[];
    exports: string[];
    hasDefaultExport: boolean;
    hash: string;
    lineCount: number;
    tokenEstimate: number;
    domain: string;
    isEntryPoint: boolean;
    archRole: ArchRole;
    contentTokens: string[];
}
export interface CacheMeta {
    rootDir: string;
    gitHead: string;
    fileCount: number;
    timestamp: number;
    version: string;
}
//# sourceMappingURL=types.d.ts.map