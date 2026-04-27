# Architecture — coldstart-mcp (v8)

This document captures the *current* architecture.

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

---

## Runtime architecture

### Startup pipeline

1. **Walk** (`indexer/walker.ts`)
   - Recursively discovers source files by extension.
   - Skips hidden directories, symlinks, and files above size threshold.

2. **Parse** (`indexer/parser.ts`, `indexer/ts-parser.ts`, `indexer/extractors/`)
   - **TypeScript/JavaScript**: Tree-sitter (tree-sitter-typescript) — functions, classes, interfaces, type aliases, constants, methods. Tracks intra-file call relationships, extends/implements chains.
   - **Java**: Tree-sitter (tree-sitter-java) — classes, interfaces, enums, records, methods, constructors. Tracks method invocations, extends, implements chains. Extracts static final constants. Public methods are marked `isExported: true` and included in the exports list for cross-file call edge resolution. Wildcard imports are dropped at parse time.
   - **Ruby**: Tree-sitter (tree-sitter-ruby) — classes, modules, methods, constants, singleton methods. Detects Rails DSLs (associations, callbacks, includes/extends). `require_relative` paths are normalised with a `./` prefix so the resolver treats them as relative to the importing file rather than as external gem names.
   - **Python**: Tree-sitter (tree-sitter-python) — classes, top-level functions, methods. Respects `__all__` for export list; excludes underscore-prefixed private names.
   - **Go**: Tree-sitter (tree-sitter-go) — structs (as class), interfaces, top-level functions, methods, constants/vars. Exports determined by uppercase-first identifier convention.
   - **Rust**: Tree-sitter (tree-sitter-rust) — pub structs/enums (as class), pub traits (as interface), pub functions, pub type aliases. Tracks `impl Trait for Struct` to populate `implementsNames`. Module declarations treated as imports.
   - **C#**: Tree-sitter (tree-sitter-c-sharp) — public classes, interfaces, structs, enums, records, public methods. Extracts base type list for extends/implements. Captures `using` directives as imports.
   - **PHP**: Tree-sitter (tree-sitter-php) — classes, interfaces, traits, public methods. Extracts `extends`/`implements` clauses. Captures `use` namespace imports.
   - **Kotlin**: Tree-sitter (tree-sitter-kotlin) — classes, interfaces (detected via `interface` keyword in `class_declaration`), object declarations, top-level functions, methods. Public by default unless explicitly private/protected.
   - **TypeScript/JavaScript enhancements**: `export default <identifier>` (bare identifier form) now correctly marks the referenced symbol as exported in addition to setting `hasDefaultExport = true`.
   - **Other languages** (Swift, Dart, C++): Walked by the filesystem scanner but not parsed — files appear in the index with empty imports/exports/symbols. No stable tree-sitter grammar npm packages available.
   - Derives metadata: hash, line count, token estimate.

3. **Resolve** (`indexer/resolvers/`)
   - Per-language resolver files mirror the `extractors/` structure — one file per language, dispatched by `resolvers/index.ts`.
   - **TypeScript/JavaScript** (and C#, PHP, Kotlin, etc.): relative path resolution, extension probing, index-file fallback, tsconfig/jsconfig path alias support.
   - **Java**: converts fully-qualified class names (`com.example.User`) to file paths by trying common source roots in order: `src/main/java/`, `src/java/`, `src/`, `app/src/main/java/`, project root. Wildcard imports (`com.foo.*`) are skipped at extraction time — they cannot resolve to a single file.
   - **Ruby**: relative paths (normalised to `./` prefix by the extractor for `require_relative`) resolve from the importing file's directory. Non-relative requires try `lib/` and `app/` load roots before giving up — external gems are left unresolved.
   - **Go**: tries the specifier relative to the project root (covers module-internal paths).
   - **Rust**: tries `<specifier>.rs` then `<specifier>/mod.rs` relative to the importing file.
   - **Python**: relative paths only; tries `__init__.py` directory packages.
   - Exposes `resolveImportsForFiles(files, fileIdSet, rootDir)` for incremental patching against a pre-built fileIdSet.

4. **Graph** (`indexer/graph.ts`)
   - Builds adjacency maps (`outEdges`, `inEdges`).
   - Derives `importedByCount` from in-degree.

5. **Serve** (`server/mcp.ts`, `server/tools.ts`)
   - Exposes the 4 MCP tools over stdio.
   - All tool responses come from in-memory index data (no file reads per tool call).
   - `trace-impact` additionally queries symbol-level edges (calls, extends, implements) to compute transitive dependents.
   - Reads the active index via `IndexManager.getContext()` — always gets the latest live snapshot.
   - Surfaces `_indexStatus: "rebuilding"` in responses when a full rebuild is in progress.

### Live update loop (post-startup)

After the server starts, the index is kept current in-memory for the entire session:

6. **Watch** (`watcher.ts`)
   - Starts a recursive `fs.watch` on the project root (native Node.js, no extra deps).
   - Debounces events over 400 ms, deduplicates by path.
   - Filters to indexed-language extensions only — SVG, JSON, CSS, images, etc. are ignored.

7. **Manage** (`index-manager.ts`)
   - Receives debounced batches from the watcher.
   - Routes to incremental patch or full rebuild based on batch size:
     - 1–30 files changed → incremental patch
     - >30 files changed → full rebuild
     - Git HEAD changed → full rebuild always
   - Swaps the active index atomically after rebuild completes.
   - Collects changes that arrive mid-rebuild into a pending set; applies them as a follow-up batch after the rebuild finishes.
   - Writes the updated index to disk (debounced, 5 s after last change).

8. **Patch** (`indexer/patch.ts`)
   - Pre-plan phase determines `delete / update / skip` for each file *before* touching the index — parse failures leave old state intact.
   - For each updated file: strips old edges, re-parses, resolves imports against the full fileIdSet, rebuilds tokenDocFreq and symbolEdges.
   - For deleted files: removes all flat edges (`from` and `to`), cleans importers' outEdges arrays, removes from all maps.
   - Recomputes `importedByCount` and `transitiveImportedByCount` for affected files after all patches are applied.

---

## Data model highlights

`CodebaseIndex` contains:
- `files` map (indexed file metadata)
- `edges` list (file-level import edges)
- `symbolEdges` list (symbol-level: calls, extends, implements, exports)
- `outEdges` and `inEdges` (file-level adjacency maps)
- `tokenDocFreq` (IDF scoring map)
- `indexedAt`, `gitHead`

Key per-file signals used by tools:
- `domains: DomainToken[]`, `importedByCount`, `transitiveImportedByCount`, `isBarrel`, `reexportRatio`
- `symbols: SymbolNode[]` — per-file list of extracted symbols (all supported languages)

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

**Startup reuse conditions:**
- Cache version matches schema version (`CACHE_VERSION` in `constants.ts`)
- Git HEAD has not changed since the index was built (branch switch or new commit forces a rebuild)

**TTL:** 24 hours — safety net only. The file watcher is the primary freshness mechanism during a session. The in-memory index is kept current regardless of TTL.

**Cache writes:** Triggered lazily (5 s after last patch or rebuild) to avoid hammering disk during rapid AI-agent write bursts. Disabled when `--no-cache` is set.

---

## Design tradeoffs

1. **AST-only parsing via Tree-sitter across all supported languages**
   - All indexed languages use Tree-sitter for symbol-level accuracy (exact function/class/interface extraction, line numbers, call tracking).
   - Unsupported languages (Swift, Dart, C++) are walked but not parsed due to unavailable stable tree-sitter grammar npm packages.
   - node-tree-sitter chosen over web-tree-sitter for simpler Node.js API (no WASM loading boilerplate).

2. **Hybrid incremental patch + full rebuild**
   - Small changes (≤30 files): incremental patch in ~2–5 ms per file. Graph correctness ensured by pre-plan phase, serial edge diffing, and deferred count recomputation.
   - Large changes (>30 files) or git HEAD changes: full rebuild. Cleaner than attempting large multi-file graph patches; still fast on modern hardware (~5 s for 5k files).
   - Changes mid-rebuild are queued and applied as a follow-up patch — no silent drops.

3. **Structural answers over semantic summaries**
   - Pros: less drift, clearer contract, easier to validate.
   - Cons: agent still needs to open files for implementation details.

4. **Zero external dependencies for live updates**
   - File watching uses Node.js native `fs.watch` (FSEvents on macOS, inotify on Linux) — no chokidar or polling.
   - The 400 ms debounce handles editor atomic-save patterns (temp file + rename).

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
- A symbol-level dependency analyzer for TS/JS/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin, with accurate export detection via Tree-sitter AST parsing.
- A live index service — the in-memory graph stays current via file watching and incremental patching throughout the session.

It is not:
- A replacement for code reading.
- A semantic RAG/embedding platform.
- A behavioral summarization system.
