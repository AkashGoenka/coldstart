// All shared interfaces and types for coldstart-mcp

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'cpp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'dart';

export type EdgeType =
  | 'import'
  | 'dynamic-import'
  | 'reexport'
  | 'mod-decl'      // Rust mod declarations
  | 'include';      // C/C++ #include

export type ArchRole =
  | 'router'
  | 'service'
  | 'repository'
  | 'middleware'
  | 'controller'
  | 'model'
  | 'util'
  | 'config'
  | 'test'
  | 'types'
  | 'entry'
  | 'unknown';

export interface IndexedFile {
  id: string;               // relative path, used as stable key
  path: string;             // absolute path
  relativePath: string;     // relative to root
  language: Language;
  domain: string;           // inferred from path/content (auth, payments, db, …)
  exports: string[];        // named exports extracted by parser
  hasDefaultExport: boolean;
  imports: string[];        // raw import specifiers
  hash: string;             // MD5 of content
  lineCount: number;
  tokenEstimate: number;    // content.length / 4
  isEntryPoint: boolean;
  archRole: ArchRole;
  centrality: number;       // PageRank score (set after graph phase)
  depth: number;            // BFS depth from entry points (set after graph phase)
}

export interface Edge {
  from: string;             // file id
  to: string;               // file id
  type: EdgeType;
  specifier: string;        // raw import string
}

export interface TFIDFVector {
  fileId: string;
  terms: Map<string, number>; // term → tf-idf score
}

export interface CodebaseIndex {
  rootDir: string;
  files: Map<string, IndexedFile>;       // id → IndexedFile
  edges: Edge[];
  outEdges: Map<string, string[]>;       // fileId → [fileId] (imports)
  inEdges: Map<string, string[]>;        // fileId → [fileId] (importers)
  pagerank: Map<string, number>;         // fileId → score
  cochange: Map<string, Map<string, number>>; // fileId → fileId → score
  tfidf: Map<string, Map<string, number>>;    // fileId → term → score
  idf: Map<string, number>;             // term → idf score
  indexedAt: number;                    // Date.now()
  gitHead: string;                      // HEAD commit hash or ''
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
  reasons: string[];        // human-readable scoring breakdown
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
}

export interface CacheMeta {
  rootDir: string;
  gitHead: string;
  fileCount: number;
  timestamp: number;
  version: string;
}
