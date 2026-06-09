# coldstart-mcp

Lightweight navigation layer for AI agents. Answers one question: which files are relevant to this task? Fast static index over file paths, symbol names, and exports — built once, queried instantly via two MCP tools: `get-overview` (GO — ranked file paths matched against declared names: filenames, path segments, exported symbols) and `get-structure` (GS — for a single file: top-level symbols with per-symbol cross-file callers, 1-hop internal imports, and reverse importers). The file-level import graph and the symbol-level caller/implementor/extender lookups that used to be separate `trace-deps`/`trace-impact` tools are now folded into `get-structure` (`view: "full"`, the default, returns all of it in one call).

For Rails repos: the Ruby parser emits synthetic edges for `has_many`/`belongs_to`/`has_one`/`has_and_belongs_to_many` (gated to `app/models/`), parses `config/routes.rb` resources, and adds bidirectional controller↔views edges. Polymorphic associations and gem-backed models stay unresolved (runtime DSL).

**Startup pipeline:** walk → parse (Tree-sitter for TS/JS/JSX/TSX/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin/C++/YAML/TOML/XML/Groovy; SFC script blocks extracted from Vue/Svelte/Astro before TS parsing; GraphQL/.env/AngularJS 1.x via regex extractors; Swift/Dart not indexed) → resolve imports → build graph (including cross-file call edge resolution) → serve.

**Live updates:** after startup, a native `fs.watch` listener keeps the in-memory index current for the entire session. File changes are debounced (400 ms), then either patched incrementally (≤30 files, ~2–5 ms/file) or trigger a full background rebuild (>30 files). No restarts required.

Key files:

- `src/index.ts` — entry point, startup pipeline
- `src/indexer/` — walk / parse / resolve / graph / patch
- `src/server/` — MCP protocol + tool handlers
- `src/watcher.ts` — debounced `fs.watch` wrapper
- `src/index-manager.ts` — live index state machine (patch vs rebuild routing, atomic swap)
- `src/cache/disk-cache.ts` — on-disk cache (24 h TTL, safety net only)
- `src/types.ts`, `src/constants.ts`
