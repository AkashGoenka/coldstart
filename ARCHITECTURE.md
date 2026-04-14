# Architecture — coldstart-mcp (v4)

This document captures the *current* architecture after the simplification pass.

---

## Core thesis

`coldstart-mcp` is a **routing layer** for AI agents, not a semantic search engine.

It answers structural questions quickly:
- Where does code for a domain live?
- What does this file connect to?
- Is this file worth opening?

The tool intentionally avoids behavioral summaries and heavy ranking systems.

---

## Why the project was downscoped

Real-world testing on a ~5800-file codebase showed:
- Agent-native `rg`/grep was already strong for textual lookup.
- The old `find-files` stack (TF-IDF + PageRank + co-change) added complexity but did not consistently improve outcomes.
- The highest value came from structural metadata and graph traversal.

So the system was reduced to 3 focused MCP tools:
1. `get-overview`
2. `trace-deps`
3. `get-structure`

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

2. **Parse** (`indexer/parser.ts`, `indexer/ts-parser.ts`)
   - **TypeScript/JavaScript**: Tree-sitter (node-tree-sitter + tree-sitter-typescript) for symbol-level extraction — functions, classes, interfaces, type aliases, constants, methods. Tracks intra-file call relationships, extends/implements chains.
   - **Other languages**: Regex-based extraction of imports and exports (unchanged).
   - Derives metadata: domain, architectural role, entry-point flag, hash, line count, token estimate.

3. **Resolve** (`indexer/resolver.ts`)
   - Resolves internal import specifiers to file IDs.
   - Supports extension probing, index-file fallback, and tsconfig/jsconfig path aliases.

4. **Graph** (`indexer/graph.ts`)
   - Builds adjacency maps (`outEdges`, `inEdges`).
   - Computes BFS depth from entry points.
   - Derives `importedByCount` from in-degree.

5. **Serve** (`server/mcp.ts`, `server/tools.ts`)
   - Exposes the 3 MCP tools over stdio.
   - All tool responses come from in-memory index data (no file reads per tool call).

---

## Data model highlights

`CodebaseIndex` contains:
- `files` map (indexed file metadata)
- `edges` list (file-level import edges)
- `symbolEdges` list (symbol-level: calls, extends, implements, exports)
- `outEdges` and `inEdges` (file-level adjacency)
- `indexedAt`, `gitHead`

Key per-file signals used by tools:
- `domain`, `archRole`, `isEntryPoint`, `depth`, `importedByCount`
- `symbols: SymbolNode[]` — per-file list of extracted symbols (TS/JS only)

`SymbolNode` captures:
- `id` (`fileId#symbolName`), `name`, `kind` (function/class/interface/type/constant/method)
- `startLine`, `endLine`
- `isExported`, `calls[]`, `extendsName?`, `implementsNames[]`

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

1. **Tree-sitter for TS/JS, regex for everything else**
   - TS/JS get symbol-level accuracy (exact function/class/interface extraction, line numbers, call tracking).
   - Other languages keep broad coverage with zero native dependencies.
   - node-tree-sitter chosen over web-tree-sitter for simpler Node.js API (no WASM loading boilerplate).

2. **Full rebuild over incremental indexing**
   - Pros: low complexity, predictable correctness.
   - Cons: recomputation cost on large codebases.

3. **Structural answers over semantic summaries**
   - Pros: less drift, clearer contract, easier to validate.
   - Cons: agent still needs to open files for implementation details.

---

## What this project is and is not

It is:
- A local MCP indexing + routing service.
- A fast structural context provider for coding agents.

It is not:
- A replacement for code reading.
- A semantic RAG/embedding platform.
- A behavioral summarization system.

