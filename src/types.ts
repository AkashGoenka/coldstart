// All shared interfaces and types for coldstart-mcp

export type DomainEvidence = { filename: number; path: number; symbol: number };

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
  | 'dart'
  | 'vue'
  | 'svelte'
  | 'astro'
  | 'graphql'
  | 'yaml'
  | 'toml'
  | 'env'
  | 'xml'
  | 'groovy'
  | 'erb'
  | 'haml'
  | 'slim';

export type EdgeType =
  | 'import'
  | 'dynamic-import'
  | 'reexport'
  | 'mod-decl'      // Rust mod declarations
  | 'include';      // C/C++ #include

// Symbol-level types (TS/JS only, v4)
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'constant' | 'method';

export type SymbolEdgeType = 'calls' | 'extends' | 'implements' | 'exports';

/** A call site: a callee name (post-resolution, may be a symbolId) and the line in the caller where it appears.
 *  line === 0 means the line is unknown (older index, or an extractor that has not yet been backfilled). */
export interface CallSite {
  name: string;
  line: number;
}

export interface SymbolNode {
  id: string;               // fileId + '#' + name, e.g. "src/auth.ts#AuthService"
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  isExported: boolean;
  calls: CallSite[];        // call sites within body (intra-file resolved to full IDs in .name)
  extendsName?: string;     // class only: parent class name
  implementsNames: string[]; // class only: interface names
  annotations?: string[];   // Java only: annotation names attached to this symbol
}

export interface SymbolEdge {
  from: string;         // symbolId or fileId
  to: string;           // symbolId or fileId
  type: SymbolEdgeType;
  line?: number;        // call-site line in the `from` symbol's file (calls edges only; 0/undefined = unknown)
}

export interface IndexedFile {
  id: string;               // relative path, used as stable key
  path: string;             // absolute path
  relativePath: string;     // relative to root
  language: Language;
  domainMap: Record<string, DomainEvidence>;  // token → evidence counts per source
  exports: string[];        // named exports extracted by parser
  hasDefaultExport: boolean;
  imports: string[];        // raw import specifiers
  hash: string;             // MD5 of content
  lineCount: number;
  tokenEstimate: number;    // content.length / 4
  importedByCount: number;  // number of files that import this file (set after graph phase)
  transitiveImportedByCount: number; // importedByCount + one barrel hop (not a full transitive closure)
  isBarrel: boolean;        // true if this is an index.ts re-export barrel
  isTestFile: boolean;      // true if any path segment is a test/automation directory
  symbols: SymbolNode[];    // symbol-level nodes within this file (TS/JS only)
  reexportRatio?: number;   // TS/JS only: ratio of re-export statements to total export statements
  constantReferences?: string[];  // Ruby only: FQCNs to resolve via autoload
  partialDeclarations?: Array<{ kind: 'class' | 'struct' | 'interface' | 'record'; name: string; namespace?: string }>;  // C# only: partial type declarations
  eloquentRelations?: Array<{ targetClass: string; line: number }>;  // PHP only: Eloquent relationship class references
  containerResolutions?: Array<{ targetClass: string; line: number }>;  // PHP only: DI container class references
  djangoConventionRefs?: Array<{ kind: string; value: string }>;  // Python only: Django convention string refs (middleware, auth backends, etc.)
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
  symbols: SymbolNode[];    // symbol-level nodes (TS/JS only, empty for other languages)
  reexportRatio?: number;   // TS/JS only
  constantReferences?: string[];  // Ruby only: FQCNs to resolve via autoload
  partialDeclarations?: Array<{ kind: 'class' | 'struct' | 'interface' | 'record'; name: string; namespace?: string }>;  // C# only: partial type declarations
  eloquentRelations?: Array<{ targetClass: string; line: number }>;  // PHP only: Eloquent relationship class references
  containerResolutions?: Array<{ targetClass: string; line: number }>;  // PHP only: DI container class references
  djangoConventionRefs?: Array<{ kind: string; value: string }>;  // Python only: Django convention string refs
}

export interface CacheMeta {
  rootDir: string;
  gitHead: string;
  fileCount: number;
  timestamp: number;
  version: string;
}
