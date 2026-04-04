# Architecture — coldstart-mcp (v3)

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

2. **Parse** (`indexer/parser.ts`)
   - Regex-based extraction of imports and exports across supported languages.
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
- `edges` list
- `outEdges` and `inEdges`
- `indexedAt`, `gitHead`

Key per-file signals now used by tools:
- `domain`
- `archRole`
- `isEntryPoint`
- `depth`
- `importedByCount`

This keeps the model small, inspectable, and stable.

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

1. **Regex over AST**
   - Pros: broad language coverage, zero native dependencies, fast startup.
   - Cons: misses some dynamic and advanced syntax patterns.

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

