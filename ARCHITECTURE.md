# Architecture — coldstart-mcp

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
2. `get-structure`
3. `trace-deps`
4. `trace-impact`

Removed:
- PageRank signals
- Git co-change scoring
- TF-IDF + co-occurrence ranking pipeline

`get-overview` does have a lightweight ranking layer — convergence scoring (how many independent sources: filename, path, symbol agree on a concept) combined with IDF as a tiebreaker. This is different in kind from the old stack: no graph signals, no co-change, no model. It runs in-memory over the static index in microseconds.

---

## Process model

By default `coldstart-mcp` runs as **two processes** per project:

```
AI client ──stdio──> bridge (per AI session) ──HTTP──> daemon (per project root)
                                                            │
                                                            └── live index in memory
```

### Bridge (`src/server/bridge.ts`)
- Spawned by the AI client over stdio, one per AI session.
- Speaks the standard MCP stdio protocol on its client-facing side.
- On its other side, opens an HTTP/MCP connection (`StreamableHTTPClientTransport`) to a local daemon.
- Lazy-connects to the daemon on the first tool call so MCP `initialize` completes immediately — even if the daemon is still indexing.
- Acts as a thin proxy: `listTools`/`callTool` calls forward straight through.

### Daemon (`src/server/http-daemon.ts`, `src/index-manager.ts`)
- Long-lived background process. One daemon per absolute project root.
- Spawned automatically by the first bridge that finds no live daemon. Re-used by all subsequent bridges for the same root.
- Holds the index, runs the file watcher, manages patch/rebuild — all entirely separate from any AI client lifecycle.
- HTTP server binds to `127.0.0.1` on a random ephemeral port. Each AI session gets its own MCP `Server + Transport` pair on the daemon side, but they all share the same `getContext` closure (same live index).

### Lockfile (`src/daemon-lock.ts`)
- Path: `~/.coldstart/daemon/<basename>-<hash>.json` — `<basename>` is the directory name of the project root, `<hash>` is the first 16 hex chars of `sha256(absolute_path)`. The basename prefix is human-readable; the hash disambiguates collisions and makes the file safe to grep.
- Contents: `{ pid, port, rootDir }`. `rootDir` was added so the `status` subcommand can show absolute paths; pre-existing lockfiles without it still work and fall back to the basename for display.
- Bridges check the lockfile, verify the PID is alive (`process.kill(pid, 0)`), and probe the port (`GET /mcp`) before reusing it. A stale lockfile triggers respawn.
- A separate **spawn lock** (`<basename>-<hash>.spawn`, opened with `O_CREAT | O_EXCL`) ensures only one bridge spawns the daemon when several start in parallel; the rest wait on the lockfile.

### Daemon logging (`src/daemon-log.ts`)
- Path: `~/.coldstart/daemon/<basename>-<hash>.log` (current run) and `.log.prev` (previous run, retained for postmortem).
- The daemon is spawned with `stdio: 'ignore'`, so without a file backing log the entire stderr stream would be lost. `attachDaemonLogger(rootDir)` is the first call inside `runDaemon` — it opens the log file (rotating any existing `.log` to `.log.prev` first), then monkey-patches `process.stderr.write` so every existing `log(...)` call site is captured without per-callsite changes.
- Rotation: a `setInterval` (60 s, `unref()`'d) checks the file size; when it crosses 1 MB, the current stream is closed, the file moves to `.log.prev`, and a fresh stream opens. Worst case per project is ~2 MB across both files.
- Failure mode: rotation is best-effort. Any I/O error inside the rotation loop is swallowed so a log issue can never crash the daemon.

### Status subcommand (`src/status.ts`)
- Invoked as `coldstart-mcp status`. Reads every `*.json` in `~/.coldstart/daemon/`, probes `isDaemonAlive` (a zero-signal `process.kill(pid, 0)`), `GET /mcp`, and `GET /status` per entry in parallel, then prints a fixed-width table with columns: root path, PID, port, status (`ok` / `alive, http unreachable` / `dead (stale lock)`), index state, log size, and log path.
- The `GET /status` endpoint on the daemon returns `{ state: 'building' | 'ready' | 'rebuilding' | 'failed', fileCount, startedAt, indexBuildMs }`. The CLI renders this as `ready (N files)`, `rebuilding (N files)`, `building`, or `failed`. Daemons predating the endpoint render as `?` — no regression.
- Output is intentionally plain stdout text so it's grep-friendly. A `--json` flag is a future option without breaking the human form.

### `--no-daemon` mode
Bypasses the bridge/daemon split entirely. The single CLI process runs the stdio MCP server *and* holds the index *and* runs the watcher — same code paths, just no IPC. Used for development, debugging, and environments where spawning detached processes is undesirable.

### Why split it
The daemon survives across AI client restarts — index build cost is paid once per machine boot (or after a `CACHE_VERSION` bump), not on every new session. Two AI sessions on the same project share one index instead of holding two copies.

---

## Indexing pipeline (daemon side)

### Startup pipeline

1. **Walk** (`indexer/walker.ts`)
   - Recursively discovers source files by extension.
   - Skips hidden directories, symlinks, and files above size threshold.

2. **Parse** (`indexer/parser.ts`, `indexer/extractors/`)
   - Files are processed in batches of 100 (via `Promise.all` per batch, sequential across batches). This keeps peak memory at O(batch_size) instead of O(total_files) — relevant when running alongside a large local LLM. Parse progress is logged to stderr every 500 files and always at 100%.
   - **TypeScript/JavaScript**: Tree-sitter (tree-sitter-typescript) — functions, classes, interfaces, type aliases, constants, methods. Tracks intra-file call relationships, extends/implements chains.
   - **Java**: Tree-sitter (tree-sitter-java) — classes, interfaces, enums, records, methods, constructors. Tracks method invocations, extends, implements chains. Extracts static final constants. Public methods are marked `isExported: true` and included in the exports list for cross-file call edge resolution. Wildcard imports are dropped at parse time.
   - **Ruby**: Tree-sitter (tree-sitter-ruby) — classes, modules, methods, constants, singleton methods. Detects Rails DSLs (associations, callbacks, includes/extends). `require_relative` paths are normalised with a `./` prefix so the resolver treats them as relative to the importing file rather than as external gem names.
   - **Rails-aware Ruby edges** (gated to repos with a `Gemfile` and `app/models/`):
     - `has_many` / `belongs_to` / `has_one` / `has_and_belongs_to_many` calls in `app/models/*.rb` emit synthetic relative imports to the target model (`has_many :comments` → `./comment`). Class names are derived with simple pluralization rules (`ies → y`, `es → ""` after `s/x/z/sh/ch`, trailing `s`); `:class_name => "..."` overrides are honoured.
     - `config/routes.rb` is parsed for `resources :foo` and explicit HTTP verb calls (`get '/x', to: 'foo#index'`); each emits an edge to the corresponding controller under `app/controllers/`.
     - Controller↔views pairing is added at graph-build time (`addRailsControllerViewEdges` in `graph.ts`): every `app/controllers/X_controller.rb` gets bidirectional file edges to all files under `app/views/X/`.
     - Polymorphic associations, gem-backed models, and namespaced targets remain unresolved — these are runtime DSL artefacts the static index can't follow. Specs, migrations, and locale YAMLs are deliberately not linked: grep handles them at edit time.
   - **Python**: Tree-sitter (tree-sitter-python) — classes, top-level functions, methods. Respects `__all__` for export list; excludes underscore-prefixed private names.
   - **Go**: Tree-sitter (tree-sitter-go) — structs (as class), interfaces, top-level functions, methods, constants/vars. Exports determined by uppercase-first identifier convention.
   - **Rust**: Tree-sitter (tree-sitter-rust) — pub structs/enums (as class), pub traits (as interface), pub functions, pub type aliases. Tracks `impl Trait for Struct` to populate `implementsNames`. Module declarations and `use` paths to workspace-member crates are emitted as imports; external-crate `use` paths are filtered out at parse time against the workspace member set.
   - **C#**: Tree-sitter (tree-sitter-c-sharp) — public classes, interfaces, structs, enums, records, public methods. Extracts base type list for extends/implements. Captures `using` directives as imports.
   - **PHP**: Tree-sitter (tree-sitter-php) — classes, interfaces, traits, public methods. Extracts `extends`/`implements` clauses. Captures `use` namespace imports.
   - **Kotlin**: Tree-sitter (tree-sitter-kotlin) — classes, interfaces (detected via `interface` keyword in `class_declaration`), object declarations, top-level functions, methods. Public by default unless explicitly private/protected.
   - **C++**: Tree-sitter (tree-sitter-cpp) — classes, structs, functions, methods, namespaces.
   - **GraphQL** (`extractors/graphql.ts`): regex-based extractor — operations (query/mutation/subscription), fragments, type-system definitions (type/input/interface/enum/union/scalar/directive). No call tracking; symbols only.
   - **YAML** (`extractors/yaml.ts`): Tree-sitter extractor — top-level keys and one-level-nested keys as exported symbols.
   - **TOML** (`extractors/toml.ts`): Tree-sitter extractor — sections, keys, and array-of-tables as symbols.
   - **XML** (`extractors/xml.ts`): Tree-sitter extractor — element attributes and text content as symbols.
   - **Groovy** (`extractors/groovy.ts`): Tree-sitter extractor — classes, methods, and closures. Covers Gradle DSL and Jenkinsfile DSL.
   - **`.env` files** (`extractors/env.ts`): regex-based extractor — variable names as exported symbols. Detected by filename pattern (`.env`, `.env.local`, `.env.production`, etc.) rather than file extension.
   - **Vue/Svelte/Astro (SFC)**: script block extracted from the SFC source before handing off to the TypeScript/JavaScript parser. The rest of the file (template, style) is ignored.
   - **AngularJS 1.x**: regex-based extractor (no AST) for `.service()`, `.controller()`, `.factory()`, `.directive()` module registrations — applied as a post-pass on TypeScript/JavaScript files to cover legacy Angular 1 codebases.
   - **TypeScript/JavaScript enhancements**: `export default <identifier>` (bare identifier form) correctly marks the referenced symbol as exported in addition to setting `hasDefaultExport = true`.
   - **Not indexed** (Swift, Dart): no extension mapping in `EXTENSION_TO_LANGUAGE` — these file types are not walked or parsed.
   - Derives metadata: hash, line count, token estimate.

3. **Resolve** (`indexer/resolvers/`)
   - Per-language resolver files mirror the `extractors/` structure — one file per language, dispatched by `resolvers/index.ts`.
   - **TypeScript/JavaScript** (and C#, PHP, Kotlin, etc.): relative path resolution, extension probing, index-file fallback, tsconfig/jsconfig path alias support.
   - **Java**: converts fully-qualified class names (`com.example.User`) to file paths. Source roots are discovered at startup by scanning file IDs for well-known markers (`/src/main/java/`, `/src/test/java/`, `/src/java/`, `/target/generated-sources/`, `/build/generated-sources/`, `/src/`) — checked both with and without a leading slash to handle Maven projects whose file IDs start at `src/main/java/` directly. Also strips the last FQN segment to resolve static imports and inner class references (`org.foo.Outer.Inner` → `Outer.java`). Wildcard imports (`com.foo.*`) are skipped at extraction time — they cannot resolve to a single file.
   - **Ruby**: relative paths (normalised to `./` prefix by the extractor for `require_relative`) resolve from the importing file's directory. Non-relative requires try `lib/` and `app/` load roots before giving up — external gems are left unresolved. `path:` gems in `Gemfile` are resolved as local source roots.
   - **Go**: strips the module path prefix (read from `go.mod`), handles `vendor/` paths, skips `_test.go` file self-imports, and falls back to relative-to-project-root resolution for multi-module layouts. `go.work` workspace files are parsed to discover all module roots in a monorepo.
   - **PHP**: standard namespace-to-path resolution via `composer.json` autoload maps. `path` repos in `composer.json` `repositories` are resolved as local source roots.
   - **Rust**: `mod` declarations resolve to sibling `<specifier>.rs` or `<specifier>/mod.rs`. Cross-crate `use crate_name::path::to::Thing` paths walk up from the importing file to find the nearest workspace `Cargo.toml`, parse its `[workspace] members` (with glob expansion for patterns like `crates/*`), and map crate names to each member's `src/` root. The resolver tries progressively shallower paths so `use tokio::sync::Mutex` lands on `tokio/src/sync.rs` (the trailing `Mutex` is a symbol, not a file). Crate names with `-` are normalised to `_` to match Rust identifier form.
   - **Python**: handles relative imports (counts leading dots to walk up directories), absolute imports mapped to project-relative paths, and `__init__.py` directory packages.
   - **npm workspaces**: `workspaces` field in `package.json` is parsed to discover all package roots; cross-package imports resolve correctly.
   - Exposes `resolveImportsForFiles(files, fileIdSet, rootDir)` for incremental patching against a pre-built fileIdSet.

4. **Graph** (`indexer/graph.ts`)
   - Builds adjacency maps (`outEdges`, `inEdges`).
   - Derives `importedByCount` from in-degree.

5. **Serve** (`server/mcp.ts`, `server/tools.ts`, `server/http-daemon.ts`)
   - Tool definitions are exported as `TOOL_DEFINITIONS` and shared by both the stdio path (`--no-daemon`) and the HTTP daemon path.
   - All tool responses come from in-memory index data (no file reads per tool call).
   - `trace-impact` additionally queries symbol-level edges (calls, extends, implements) to compute transitive dependents.
   - Reads the active index via `IndexManager.getContext()` — always returns the latest live snapshot.
   - Surfaces `_indexStatus: "rebuilding"` in responses when a full rebuild is in progress.

### Live update loop (post-startup)

After the daemon's index is ready, it is kept current in-memory for the entire daemon lifetime:

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
- `domainMap: Record<string, DomainEvidence>`, `importedByCount`, `transitiveImportedByCount`, `isBarrel`, `reexportRatio`
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

**Cache path:** `~/.coldstart/indexes/<basename>-<hash>/`

`<basename>` is the directory name of the project root; `<hash>` is the first 16 hex chars of `sha256(absolute_path)`. Both are present so the directory listing is human-readable while remaining collision-safe.

**Artifacts (three-file format):**
- `meta.json` — schema version, root path, git HEAD, file count, timestamp. Tiny; read first to decide whether the full cache is worth loading. Written last — acts as the atomic commit marker (a partial write leaves no `meta.json`, so load fails safely).
- `graph.json` — file-level edges, symbol edges, adjacency maps (`outEdges`/`inEdges`), token document frequencies. Loaded only if `meta.json` validates.
- `files-N.json` — per-file metadata (exports, imports, symbols, domain map) in chunks of 5,000 entries. Large repos produce `files-0.json`, `files-1.json`, etc. Written in parallel alongside `graph.json`, then merged on load.

Reading `meta.json` first lets the daemon decide cache reuse before touching the (potentially multi-MB) graph and file payloads.

**Startup reuse conditions:**
- `CACHE_VERSION` matches schema version (in `constants.ts`)
- Git HEAD has not changed since the index was built (branch switch or new commit forces a rebuild)

**TTL:** 24 hours — safety net only. The file watcher is the primary freshness mechanism during a session. The in-memory index is kept current regardless of TTL.

**Cache writes:** Triggered lazily (5 s after last patch or rebuild) to avoid hammering disk during rapid AI-agent write bursts. Disabled when `--no-cache` is set.

**Daemon lockfile:** Separate path — `~/.coldstart/daemon/<basename>-<hash>.json` — see "Process model" above. Cache directory and daemon directory are independent; wiping one does not affect the other.

---

## Design tradeoffs

1. **AST-only parsing via Tree-sitter across most supported languages**
   - Tree-sitter languages get symbol-level accuracy (exact function/class/interface extraction, line numbers, call tracking).
   - GraphQL, `.env`, and AngularJS 1.x use regex extraction — Tree-sitter gives no useful symbols for those file shapes.
   - Swift and Dart are not indexed at all — no stable tree-sitter grammar npm packages and no extension mapping.
   - node-tree-sitter chosen over web-tree-sitter for simpler Node.js API (no WASM loading boilerplate).

2. **Hybrid incremental patch + full rebuild**
   - Small changes (≤30 files): incremental patch in ~2–5 ms per file. Graph correctness ensured by pre-plan phase, serial edge diffing, and deferred count recomputation.
   - Large changes (>30 files) or git HEAD changes: full rebuild. Cleaner than attempting large multi-file graph patches; still fast on modern hardware (~5 s for 5k files).
   - Changes mid-rebuild are queued and applied as a follow-up patch — no silent drops.

3. **Bridge ↔ daemon split**
   - Pros: index survives AI client restarts; multiple sessions share one in-memory copy.
   - Cons: more moving parts; lockfile and port hygiene to maintain. `--no-daemon` is the escape hatch when this complexity is unwelcome.

4. **Structural answers over semantic summaries**
   - Pros: less drift, clearer contract, easier to validate.
   - Cons: agent still needs to open files for implementation details.

5. **Zero external dependencies for live updates**
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

**Use case:** Navigation — locate where a symbol is defined and find every caller, implementor, or extender, without reading their files. Secondary use: blast-radius assessment before a refactor.

---

## What this project is and is not

It is:
- A local MCP indexing + routing service.
- A fast structural context provider for coding agents.
- A symbol-level dependency analyzer for the languages listed in [README.md](./README.md).
- A live, daemon-backed index — the in-memory graph stays current via file watching and incremental patching across the daemon's lifetime, not just one AI session.

It is not:
- A replacement for code reading.
- A semantic RAG/embedding platform.
- A behavioral summarization system.
- A networked/multi-machine service — the daemon is per-host, bound to `127.0.0.1`.
