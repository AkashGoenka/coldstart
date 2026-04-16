# Architecture — coldstart-mcp (v4)

This document captures the *current* architecture after the simplification pass.

---

## Core thesis

`coldstart-mcp` is a **routing layer** for AI agents, not a semantic search engine.

It answers structural questions quickly:
- Where does code for a domain live?
- What does this file connect to?
- Is this file worth opening?
- What will break if I change this symbol?

The tool intentionally avoids behavioral summaries and heavy ranking systems.

---

## Why the project was downscoped

Real-world testing on a ~5800-file codebase showed:
- Agent-native `rg`/grep was already strong for textual lookup.
- The old `find-files` stack (TF-IDF + PageRank + co-change) added complexity but did not consistently improve outcomes.
- The highest value came from structural metadata and graph traversal.

So the system was reduced to 4 focused MCP tools:
1. `get-overview`
2. `trace-deps`
3. `get-structure`
4. `trace-impact`

Removed:
- Query ranking pipeline
- TF-IDF index
- PageRank signals
- Git co-change scoring
- Tokenizer and stop-word machinery

---

## Runtime architecture

1. **Walk** (`indexer/walker.ts`)
   - Recursively discovers source files by extension.
   - Skips hidden directories, symlinks, and files above size threshold.

2. **Parse** (`indexer/parser.ts`, `indexer/ts-parser.ts`, `indexer/extractors/java.ts`, `indexer/extractors/ruby.ts`)
   - **TypeScript/JavaScript**: Tree-sitter (node-tree-sitter + tree-sitter-typescript) for symbol-level extraction — functions, classes, interfaces, type aliases, constants, methods. Tracks intra-file call relationships, extends/implements chains.
   - **Java**: Tree-sitter (tree-sitter-java) for classes, interfaces, enums, records, methods, constructors. Tracks method invocations, extends, implements chains. Extracts static final constants.
   - **Ruby**: Tree-sitter (tree-sitter-ruby) for classes, modules, methods, constants, singleton methods. Detects Rails DSLs (associations, callbacks, includes/extends). Tracks method calls, inheritance, and Rails relationships.
   - **Other languages**: Regex-based extraction of imports and exports.
   - Derives metadata: domain, architectural role, entry-point flag, hash, line count, token estimate.

3. **Resolve** (`indexer/resolver.ts`)
   - Resolves internal import specifiers to file IDs.
   - Supports extension probing, index-file fallback, and tsconfig/jsconfig path aliases.

4. **Graph** (`indexer/graph.ts`)
   - Builds adjacency maps (`outEdges`, `inEdges`).
   - Computes BFS depth from entry points.
   - Derives `importedByCount` from in-degree.

5. **Serve** (`server/mcp.ts`, `server/tools.ts`)
   - Exposes the 4 MCP tools over stdio.
   - All tool responses come from in-memory index data (no file reads per tool call).
   - `trace-impact` additionally queries symbol-level edges (calls, extends, implements) to compute transitive dependents.

---

## Data model highlights

`CodebaseIndex` contains:
- `files` map (indexed file metadata)
- `edges` list (file-level import edges)
- `symbolEdges` list (symbol-level: calls, extends, implements, exports)
- `outEdges` and `inEdges` (file-level adjacency maps)
- `indexedAt`, `gitHead`

Key per-file signals used by tools:
- `domain`, `archRole`, `isEntryPoint`, `depth`, `importedByCount`
- `symbols: SymbolNode[]` — per-file list of extracted symbols (TS/JS/Java/Ruby)

`SymbolNode` captures:
- `id` (`fileId#symbolName`), `name`, `kind` (function/class/interface/type/constant/method)
- `startLine`, `endLine`
- `isExported`, `calls[]`, `extendsName?`, `implementsNames[]`

`SymbolEdge` captures symbol-level relationships:
- `from` and `to` (symbol IDs or names)
- `type`: `'calls'`, `'extends'`, `'implements'`, `'exports'`
- Used by `trace-impact` to compute transitive dependents and build dependency chains

---

## Caching strategy

Cache path:
- `~/.coldstart/indexes/<hash-of-root>/`

Artifacts:
- `meta.json`
- `index.json`

Reuse conditions today:
- Cache version matches schema version
- Cache age is within TTL (1 hour)

Otherwise the index is rebuilt from scratch.

---

## Design tradeoffs

1. **Tree-sitter for TS/JS/Java/Ruby, regex for everything else**
   - TS/JS/Java/Ruby get symbol-level accuracy (exact function/class/interface extraction, line numbers, call tracking).
   - Other languages keep broad coverage with regex-based fallback (no heavy dependencies).
   - node-tree-sitter chosen over web-tree-sitter for simpler Node.js API (no WASM loading boilerplate).
   - Java and Ruby added for common enterprise/Rails codebases where symbol tracking is especially valuable.

2. **Full rebuild over incremental indexing**
   - Pros: low complexity, predictable correctness.
   - Cons: recomputation cost on large codebases.

3. **Structural answers over semantic summaries**
   - Pros: less drift, clearer contract, easier to validate.
   - Cons: agent still needs to open files for implementation details.

---

## Symbol-level impact analysis (`trace-impact`)

`trace-impact` is designed to answer: "What will break if I change this symbol?"

**Implementation:**
1. Find target symbol across all indexed files
2. Build reverse adjacency map of symbol-level edges (excluding `exports`)
3. BFS traversal from target to collect all transitive dependents
4. Resolve symbol IDs to human-readable info (name, file, kind)
5. Return results with relationship types and full dependency paths

**Relationship types tracked:**
- `calls` — symbol is invoked by another
- `extends` — symbol is inherited by a class
- `implements` — symbol implements an interface (for Ruby: includes/extends modules)

**Use case:** Before refactoring a public function or interface, understand the full blast radius without manually reading dependent files.

---

## What this project is and is not

It is:
- A local MCP indexing + routing service.
- A fast structural context provider for coding agents.
- A symbol-level dependency analyzer for TS/JS/Java/Ruby.

It is not:
- A replacement for code reading.
- A semantic RAG/embedding platform.
- A behavioral summarization system.

