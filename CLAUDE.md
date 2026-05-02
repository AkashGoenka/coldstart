# coldstart-mcp

Lightweight navigation layer for AI agents. Answers one question: which files are relevant to this task? Fast static index over file paths, symbol names, and exports — built once, queried instantly via four MCP tools: `get-overview`, `get-structure`, `trace-deps`, `trace-impact`.

**Startup pipeline:** walk → parse (Tree-sitter for TS/JS/JSX/TSX/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin/C++; SFC script blocks extracted from Vue/Svelte/Astro before TS parsing; AngularJS 1.x via regex extractor; Swift/Dart not parsed) → resolve imports → build graph (including cross-file call edge resolution) → serve over stdio.

**Live updates:** after startup, a native `fs.watch` listener keeps the in-memory index current for the entire session. File changes are debounced (400 ms), then either patched incrementally (≤30 files, ~2–5 ms/file) or trigger a full background rebuild (>30 files). No restarts required.

Key files:
- `src/index.ts` — entry point, startup pipeline
- `src/indexer/` — walk / parse / resolve / graph / patch
- `src/server/` — MCP protocol + tool handlers
- `src/watcher.ts` — debounced `fs.watch` wrapper
- `src/index-manager.ts` — live index state machine (patch vs rebuild routing, atomic swap)
- `src/cache/disk-cache.ts` — on-disk cache (24 h TTL, safety net only)
- `src/types.ts`, `src/constants.ts`
