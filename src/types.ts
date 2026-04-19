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

// Symbol-level types (TS/JS only, v4)
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'constant' | 'method';

export type SymbolEdgeType = 'calls' | 'extends' | 'implements' | 'exports';

export interface SymbolNode {
  id: string;               // fileId + '#' + name, e.g. "src/auth.ts#AuthService"
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  isExported: boolean;
  calls: string[];          // names called within body (identifier-level, intra-file resolved to full IDs)
  extendsName?: string;     // class only: parent class name
  implementsNames: string[]; // class only: interface names
}

export interface SymbolEdge {
  from: string;         // symbolId or fileId
  to: string;           // symbolId or fileId
  type: SymbolEdgeType;
}

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
  domains: string[];        // semantic keywords from path segments, exports, imports
  exports: string[];        // named exports extracted by parser
  hasDefaultExport: boolean;
  imports: string[];        // raw import specifiers
  hash: string;             // MD5 of content
  lineCount: number;
  tokenEstimate: number;    // content.length / 4
  isEntryPoint: boolean;
  archRole: ArchRole;
  importedByCount: number;  // number of files that import this file (set after graph phase)
  transitiveImportedByCount: number; // importedByCount bubbled through barrel files
  isBarrel: boolean;        // true if this is an index.ts re-export barrel
  depth: number;            // BFS depth from entry points (set after graph phase)
  symbols: SymbolNode[];    // symbol-level nodes within this file (TS/JS only)
}

export interface Edge {
  from: string;             // file id
  to: string;               // file id
  type: EdgeType;
  specifier: string;        // raw import string
}

export interface CodebaseIndex {
  rootDir: string;
  files: Map<string, IndexedFile>;       // id → IndexedFile
  edges: Edge[];                         // file-level import edges
  symbolEdges: SymbolEdge[];             // symbol-level edges (calls, extends, implements, exports)
  outEdges: Map<string, string[]>;       // fileId → [fileId] (imports)
  inEdges: Map<string, string[]>;        // fileId → [fileId] (importers)
  tokenDocFreq: Map<string, number>;     // token → number of files containing that token (for IDF scoring)
  indexedAt: number;                    // Date.now()
  gitHead: string;                      // HEAD commit hash or ''
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
  isEntryPoint: boolean;
  archRole: ArchRole;
  symbols: SymbolNode[];    // symbol-level nodes (TS/JS only, empty for other languages)
}

export interface CacheMeta {
  rootDir: string;
  gitHead: string;
  fileCount: number;
  timestamp: number;
  version: string;
}
