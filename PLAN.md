# Plan: Rebuild coldstart as a TypeScript MCP Server

## Context

The current coldstart tool (Go indexer + static JSON map) hasn't gained traction despite multiple iterations. The approach is wrong: agents don't need a giant JSON blob — they need **answers to questions**. We're rebuilding as a **local MCP server** that any AI agent (Claude Code, Cursor, Copilot) can query directly. Regex-only parsing for maximum language coverage (12+ languages), TF-IDF + PageRank for ranking (no ML), git co-change history as a signal. The tool is a **routing layer** — it returns file pointers, not behavioral summaries.

---

## Project Structure

New directory: `coldstart-mcp/` at repo root (separate from existing `indexer-node/`).

```
coldstart-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts                      # All interfaces and types
│   ├── index.ts                      # CLI entrypoint + MCP server init
│   ├── constants.ts                  # Stop words, domain keywords, language configs
│   ├── indexer/
│   │   ├── walker.ts                 # Filesystem traversal
│   │   ├── parser.ts                 # Multi-language regex parser (all patterns in one file)
│   │   ├── resolver.ts              # Import resolution (relative, aliases, barrels, dynamic, index.tsx)
│   │   ├── graph.ts                  # Dependency graph construction + PageRank
│   │   └── git.ts                    # Git co-change analysis via git log
│   ├── search/
│   │   ├── tfidf.ts                  # TF-IDF index builder
│   │   ├── ranker.ts                 # Combined scoring (TF-IDF + PageRank + co-change + heuristics)
│   │   └── tokenizer.ts             # Query tokenization, stop word removal, camelCase splitting
│   ├── server/
│   │   ├── mcp.ts                    # MCP server setup using @modelcontextprotocol/sdk
│   │   └── tools.ts                  # Tool definitions + handlers (get-overview, find-files, trace-deps, get-structure)
│   └── cache/
│       └── disk-cache.ts             # Persist index to ~/.coldstart/, detect staleness via git HEAD + file hashes
└── tests/
    ├── parser.test.ts
    ├── resolver.test.ts
    ├── ranker.test.ts
    └── fixtures/                     # Small multi-language test project
        ├── typescript/
        ├── python/
        ├── go/
        └── rust/
```

---

## Implementation Steps (ordered for autonomous execution)

### Step 1: Project scaffolding
- Create `coldstart-mcp/` directory
- `package.json` with deps: `@modelcontextprotocol/sdk`, `glob` (no native deps)
- `tsconfig.json` targeting ES2022, NodeNext modules
- `src/types.ts` — all interfaces:
  - `IndexedFile` (id, path, language, domain, exports, imports, hash, centrality, etc.)
  - `Edge` (from, to, type)
  - `CodebaseIndex` (files, edges, graph, tfidf vectors, pagerank scores, co-change scores)
  - `QueryResult` (path, score, domain, exports, reasons)
  - `Language` union type (12 languages)
  - `LanguageConfig` (extensions, import patterns, export patterns)

### Step 2: Constants and language configs
- `src/constants.ts`:
  - `LANGUAGE_CONFIGS`: Map of language → { extensions, importPatterns, exportPatterns }
  - All ~30 regex patterns for 12 languages (TS/JS, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, Swift, Kotlin, Dart)
  - `DOMAIN_KEYWORDS`: Reuse from existing parser.js (auth, payments, db, api, ui, utils, config, test, types, queue, cache, email, upload, search)
  - `STOP_WORDS`: common terms to skip in queries
  - `DEFAULT_EXCLUDES`: node_modules, dist, build, .git, .next, etc.
  - `EXTENSION_TO_LANGUAGE`: Map .ts → typescript, .py → python, etc.

Import patterns per language:
```
JS/TS:    import X from 'Y', require('Y'), import('Y'), export { X } from 'Y'
Python:   from X import Y, import X
Go:       import "X", import ( "X" \n "Y" )
Rust:     use X::Y, mod X, extern crate X
Java:     import com.foo.Bar
C#:       using System.Foo
C/C++:    #include "file.h"
Ruby:     require 'X', require_relative 'X'
PHP:      use App\Models\X, require_once 'X'
Swift:    import Foundation
Kotlin:   import com.foo.bar
Dart:     import 'package:X/Y.dart'
```

Export patterns per language:
```
JS/TS:    export function/class/const/default, module.exports
Python:   def X(), class X (top-level, non-underscore), __all__
Go:       func X (uppercase), type X (uppercase)
Rust:     pub fn/struct/enum/trait/type/mod
Java:     public class/interface/enum
C#:       public class/interface/struct/enum/record
C/C++:    class/struct/enum (in .h files = public API)
Ruby:     def X, class X, module X
PHP:      public function X, class X
Swift:    public/open func/class/struct/enum/protocol
Kotlin:   class/interface/fun/object/val (public by default)
Dart:     class/mixin/extension/enum (no underscore prefix = public)
```

### Step 3: Filesystem walker
- `src/indexer/walker.ts`:
  - Recursive directory walk, skip DEFAULT_EXCLUDES + user excludes
  - Match files by extension using EXTENSION_TO_LANGUAGE map
  - Return array of `{ absolutePath, relativePath, language }`
  - Handle symlinks (skip), permission errors (skip with warning)
  - Support `--include` to restrict to subdirectories

### Step 4: Multi-language parser
- `src/indexer/parser.ts`:
  - Single `parseFile(filePath, language)` function
  - Read file content (UTF-8, skip files > 1MB)
  - Apply language-specific import regex patterns → extract import specifiers
  - Apply language-specific export regex patterns → extract export names
  - Compute MD5 hash of content
  - Estimate tokens (~content.length / 4)
  - Infer domain from path segments + keyword matching in first 2000 chars
  - Detect entry points (index, main, app, server, entry, start)
  - Detect architectural role from path conventions (router, service, repository, middleware)
  - Handle special cases:
    - Dynamic imports: capture directory portion from template literals
    - Barrel/re-exports: `export { X } from './Y'` and `export * from './Y'`
    - Go multiline imports: `import ( ... )`
    - Python `__all__`: parse list literal
    - Go uppercase = exported
    - C/C++: .h files are export surface, .c/.cpp are implementation
    - Dart/Python: underscore prefix = private

### Step 5: Import resolver
- `src/indexer/resolver.ts`:
  - `resolveImports(files: IndexedFile[], rootDir: string)` → `Edge[]`
  - For each file's imports:
    1. Skip external packages (no `.` or `..` prefix, and not a path alias)
    2. Load tsconfig.json/jsconfig.json path aliases once, apply string replacement
    3. Resolve relative path from importing file's directory
    4. Try extensions: .ts, .tsx, .js, .jsx, .mjs, .cjs, .py, .go, .rs, .java, .cs, .cpp, .c, .h, .rb, .php, .swift, .kt, .dart
    5. Try directory/index: path/index.{ts,tsx,js,jsx,py,go,...}
    6. Python: try path/__init__.py
    7. For barrel files (file is re-exporting): follow the chain to actual source
    8. For dynamic imports with directory pattern: link to all files in that directory
    9. Return resolved edges + list of unresolved imports (for debugging)
  - Language-specific resolution:
    - Go: module path from go.mod, resolve relative to module root
    - Python: relative imports (from . import X), PYTHONPATH
    - Rust: mod declarations map to files (mod auth → auth.rs or auth/mod.rs)
    - Java: package path → directory path (com.foo.Bar → com/foo/Bar.java)

### Step 6: Dependency graph + PageRank
- `src/indexer/graph.ts`:
  - Build adjacency lists (outgoing + incoming) from edges
  - `computePageRank(nodes, edges, damping=0.85, iterations=20, epsilon=0.0001)`:
    - Initialize all nodes to 1/N
    - Handle dangling nodes (no outlinks) — distribute their mass evenly
    - Iterate: PR_new[v] = (1-d)/N + d * sum(PR[u]/outlinks[u]) + d * danglingMass/N
    - Stop when delta < epsilon or max iterations reached
  - `findHotNodes(inlinks, threshold=5)` → files imported by 5+ others
  - `detectCycles(adjOut)` → DFS-based cycle detection
  - `computeDepth(entryPoints, adjOut)` → BFS from entry points, return depth per node

### Step 7: Git co-change analysis
- `src/indexer/git.ts`:
  - Run `git log --name-only --pretty=format:"COMMIT" -n 100` (last 100 commits)
  - Parse output → list of commits, each with list of changed files
  - For each file pair in the same commit, increment co-change counter
  - Normalize: `cochange(A,B) = commits_together / max(commits_A, commits_B)`
  - Return `Map<string, Map<string, number>>` (file → file → score)
  - Graceful fallback: if not a git repo or git not available, return empty map

### Step 8: TF-IDF index
- `src/search/tfidf.ts`:
  - `buildTFIDFIndex(files: IndexedFile[])`:
    - For each file, build document = tokenize(path segments) + tokenize(exports) + tokenize(domain)
    - Tokenizer: split camelCase/PascalCase/snake_case, lowercase, remove extension
    - Compute document frequency (DF) for each term
    - Compute TF-IDF: `tf * log(N / df)`
    - Weight by source: path basename × 5, path directory × 3, exports × 4, domain × 1
  - `queryTFIDF(query: string[], index)` → Map<fileId, score>

### Step 9: Query tokenizer
- `src/search/tokenizer.ts`:
  - Split query on whitespace
  - Split camelCase/PascalCase tokens (GroupHub → group, hub)
  - Split snake_case tokens
  - Remove stop words
  - Lowercase everything
  - Return unique tokens

### Step 10: Combined ranker
- `src/search/ranker.ts`:
  - `findFiles(query: string, index: CodebaseIndex, options?)` → `QueryResult[]`
  - Steps:
    1. Tokenize query
    2. Score each file:
       - Exact phrase match in path → +50
       - TF-IDF score (normalized 0-100) × 0.35
       - PageRank (normalized 0-100) × 0.15
       - Per-token path basename match → +5 each
       - Per-token export match → +4 each
       - Multi-term intersection bonus → +2 per additional matching term
       - Domain match → +8
       - Co-change boost: if file co-changes with top result → +15%
    3. Penalties:
       - Test files (.test., .spec., __tests__) → ×0.6
       - Type definition files (.d.ts) → ×0.7
       - Generated files → ×0.5
    4. Sort by score descending, return top N with reasons

### Step 11: MCP server + tool definitions
- `src/server/mcp.ts`:
  - Initialize MCP server using `@modelcontextprotocol/sdk`
  - Connect via stdio transport (standard for Claude Code / Cursor)
  - Register 4 tools from tools.ts

- `src/server/tools.ts`:
  - **`get-overview`**: No required params. Optional `domain_filter`. Returns: total files, language breakdown, domains with file counts and inter-domain edges, entry points, top 5 hot nodes.
  - **`find-files`**: Required: `query` (string). Optional: `domain` (string), `limit` (number, default 5, max 10), `prefer_source` (boolean). Returns: ranked file list with path, domain, exports, centrality, reasons array.
  - **`trace-deps`**: Required: `file_path` (string). Optional: `direction` ("imports" | "importers" | "both", default "both"), `depth` (number, default 1, max 3). Returns: direct imports/importers with metadata, optional transitive deps at depth 2-3.
  - **`get-structure`**: Required: `file_path` (string). Returns: full file metadata — language, domain, exports (named + default), imports (external + internal with resolved paths), line count, token estimate, hash, architectural role, centrality score.

### Step 12: CLI entrypoint
- `src/index.ts`:
  - Parse args: `--root`, `--exclude`, `--include`, `--cache-dir` (default ~/.coldstart), `--quiet`, `--no-cache`
  - On start:
    1. Check disk cache (if not --no-cache). If valid, load index from cache.
    2. Otherwise: run full indexing pipeline (walk → parse → resolve → graph → pagerank → git → tfidf)
    3. Save index to disk cache
    4. Start MCP server on stdio
  - Log indexing stats to stderr (file count, language breakdown, time elapsed)

### Step 13: Disk cache
- `src/cache/disk-cache.ts`:
  - Cache location: `~/.coldstart/indexes/[hash-of-root-dir]/`
  - Files: `index.json` (full index), `meta.json` (git HEAD, file count, timestamp)
  - Staleness check:
    1. Compare git HEAD commit
    2. Compare file count (quick structural change check)
    3. If HEAD changed: re-index (could optimize to incremental later)
  - Cache TTL: 1 hour default (re-index if older)

### Step 14: Tests
- `tests/parser.test.ts`: Test import/export extraction for each of 12 languages with fixture files
- `tests/resolver.test.ts`: Test relative resolution, barrel files, index.tsx, path aliases, dynamic imports
- `tests/ranker.test.ts`: Test scoring with synthetic file set, verify top results for known queries
- `tests/fixtures/`: Small multi-language project with known structure for integration testing

### Step 15: Rewrite README.md and ARCHITECTURE.md
Update the docs at the **repo root** to reflect the new MCP server approach. Read the code you just built in `coldstart-mcp/` so the docs match reality.

**README.md** should cover:
- What it does (local MCP server that AI agents query for codebase navigation)
- How to install (`npx coldstart-mcp --root .`)
- How to configure in Claude Code (MCP settings JSON) and Cursor (MCP config)
- The 4 MCP tools: `get-overview`, `find-files`, `trace-deps`, `get-structure` — with example inputs/outputs
- Supported languages (all 12)
- How ranking works (one paragraph: TF-IDF + PageRank + git co-change, no ML)
- Caching behavior
- Limitations (same honest style as current README)

**ARCHITECTURE.md** should cover:
- Why MCP server over static JSON map (agents need answers, not data dumps)
- Why regex over AST/tree-sitter (30 patterns cover 12 languages, 80-90% accuracy is enough for routing, zero native deps)
- Why TF-IDF + PageRank over embeddings (no ML deps, works offline, 80% as good)
- How the ranking algorithm works (tokenization → TF-IDF → PageRank → co-change → combined score)
- Why the tool is a routing layer, not a knowledge layer (returns pointers, never behavioral summaries)
- The natural upgrade path (regex → tree-sitter for specific languages, TF-IDF → embeddings if keyword search proves noisy)
- What was tried before and why it didn't work (static JSON map — too much data, agents don't use it well)

Keep the same writing style as the existing docs — direct, honest, no marketing fluff. Explain decisions by stating what was rejected and why.

---

## Dependencies (package.json)

```json
{
  "name": "coldstart-mcp",
  "version": "2.0.0",
  "type": "module",
  "bin": { "coldstart-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

Zero native dependencies. Only MCP SDK + TypeScript + vitest for tests.

---

## Verification

1. **Build**: `cd coldstart-mcp && npm install && npm run build` should succeed with no errors
2. **Unit tests**: `npm test` — parser extracts correct imports/exports for all 12 languages, ranker returns expected top files
3. **Integration test**: Run against the coldstart repo itself:
   - `node dist/index.js --root /Users/akashgoenka/coldstart` should index successfully
   - Query "parser typescript" should return parser-related files as top results
4. **MCP test**: Configure in Claude Code's MCP settings, verify tools appear and respond to queries
5. **Multi-language test**: Run against a mixed-language fixture project, verify cross-language import detection works

---

## Model Recommendation for Scheduled Task

- **Model**: `claude-sonnet-4-6` (Sonnet 4.6)
- **Why**: This is a well-defined implementation task with a detailed plan. Sonnet 4.6 is fast, good at following structured plans, and significantly cheaper than Opus. The plan has enough detail that Sonnet won't need to make architectural decisions — it just needs to execute.
- **Thinking effort**: Not applicable for Sonnet in scheduled tasks — it uses extended thinking automatically when needed.
- **Estimated time**: 30-60 minutes for full implementation
- **Max turns**: Set to 200 (there are ~14 files to create, each with moderate complexity)
