# coldstart-mcp

Lightweight navigation layer for AI agents. Answers one question: which files are relevant to this task? Fast static index over file paths, symbol names, and exports — queried via two operations, `find` (ranked file paths matched against declared names: filenames, path segments, exported symbols, plus a repo-wide grep-recall pass) and `gs` (for a single file: top-level symbols with per-symbol cross-file callers, 1-hop internal imports, and reverse importers; `view: "full"` is the default and returns all of it in one call). Both are exposed two ways with identical output: as **CLI commands** (`coldstart find` / `coldstart gs`) for shell-capable agents — the primary path — and as **MCP tools** (`find` / `gs`) for no-shell clients like Claude Desktop.

**Architecture — one keeper, thin readers.** The query surfaces are stateless readers over an on-disk cache; a single background **keeper** process keeps that cache fresh. It does NOT serve queries.
- **Keeper** (`coldstart --daemon`, `src/index.ts` runKeeper + `src/index-manager.ts`): watches the repo, patches/rebuilds the index, debounce-saves it to the disk cache. Lazy-spawned by the first reader (`src/keeper.ts` ensureKeeper); logs to `~/.coldstart/daemon/<root>.log`; exits when its lockfile is removed. The lock carries pid/rootDir/version (no port — it serves nothing).
- **CLI readers** (`coldstart find`/`gs`, `src/cli.ts`): load the cache, run the same engine, print, exit. They `ensureKeeper` so uncommitted edits stay live.
- **MCP reader** (default invocation, `src/server/mcp.ts` + `src/index.ts` makeCacheReader): a long-lived stdio server that reads the keeper's cache and mtime-reloads when it changes. The keeper is the single freshness authority; the server has no watcher of its own.

For Rails repos: the Ruby parser emits synthetic edges for `has_many`/`belongs_to`/`has_one`/`has_and_belongs_to_many` (gated to `app/models/`), parses `config/routes.rb` resources, and adds bidirectional controller↔views edges. Polymorphic associations and gem-backed models stay unresolved (runtime DSL).

**Index pipeline:** walk → parse (Tree-sitter for TS/JS/JSX/TSX/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin/C++/YAML/TOML/XML/Groovy; SFC script blocks extracted from Vue/Svelte/Astro before TS parsing; GraphQL/.env/AngularJS 1.x via regex extractors; Swift/Dart not indexed) → resolve imports → build graph (including cross-file call edge resolution) → save cache.

**Live updates:** the keeper's `fs.watch` listener keeps the cache current. Changes are debounced (400 ms), then either patched incrementally (≤30 files, ~2–5 ms/file) or trigger a full background rebuild (>30 files), and the cache is re-saved ~5 s after edits settle. No restarts required.

**Setup:** `coldstart init` writes a single `coldstart.md` at the repo root (CLI- or MCP-flavored) carrying all agent guidance. For Claude Code it wires `@coldstart.md` into CLAUDE.md; for any other app it writes coldstart.md for manual wiring. (No skill, no per-IDE rules files.)

Key files:

- `src/index.ts` — entry point, index pipeline, keeper + MCP-reader wiring
- `src/keeper.ts` — ensureKeeper (lazy-spawn the background keeper)
- `src/cli.ts` — CLI readers (`find`/`gs`/`index`)
- `src/indexer/` — walk / parse / resolve / graph / patch
- `src/server/find.ts` — the `find` engine (buildRichPage), shared by CLI + MCP
- `src/server/tools.ts` — `gs` handler + symbol-body slicing
- `src/server/mcp.ts` — MCP tool defs + stdio server
- `src/index-manager.ts` — keeper state machine (watch → patch vs rebuild → save, atomic swap)
- `src/watcher.ts` — debounced `fs.watch` wrapper
- `src/status.ts` / `src/restart.ts` — keeper liveness/freshness + lifecycle control
- `src/init.ts` — coldstart.md generation + CLAUDE.md import wiring
- `src/cache/disk-cache.ts` — on-disk cache (24 h TTL, safety net only)
- `src/types.ts`, `src/constants.ts`
