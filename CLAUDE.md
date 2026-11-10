# coldstart-mcp

Lightweight navigation layer for AI agents. Answers one question: which files are relevant to this task? A fast static index over file paths, symbol names and exports, queried two ways: `find` (ranked file paths matched against declared names plus a repo-wide grep-recall pass) and `gs` (one file: symbols with cross-file callers, imports, importers, and an **"Edited together"** section from git history, which is a habit and NOT a dependency edge). Both ship as **CLI commands** (`coldstart find` / `coldstart gs`, the primary path) and as **MCP tools** with identical output, for no-shell clients.

**Detailed rules live in `.claude/rules/`** and load automatically when you open a matching file: `keeper-index.md` (keeper, cache, freshness, parsing), `notebook.md` (`src/kb/`, note shape, capture), `hooks.md` (capture/recall/co-change hooks), `init-unwire.md` (`init`/`unwire`), `site.md` (`site-astro/`, graph viewer). If you are PLANNING a change in one of those areas before opening a file there, read the rules file first.

**Architecture: one keeper, thin readers.** Query surfaces are stateless readers over an on-disk cache; one background **keeper** process (`coldstart --daemon`, `src/index.ts` runKeeper + `src/index-manager.ts`) watches the repo, patches/rebuilds the index and saves the cache. It does NOT serve queries. It is lazy-spawned by the first reader (`src/keeper.ts` ensureKeeper). **Readers NEVER build**: cache miss → wait for the keeper's first save; git-HEAD drift → wait for its reconcile re-save; in-process build only on the no-keeper fallback. The MCP reader (`src/server/mcp.ts`) mtime-reloads the keeper's cache and has no watcher of its own. There is no TTL: validity = CACHE_VERSION + git HEAD + reconcile + live watcher.

**Index pipeline:** walk → parse (web-tree-sitter WASM, 15 grammars vendored in `vendor/wasm/`, no native deps) → resolve imports → build graph (incl. cross-file call edges) → save cache.

**Rules that bite anywhere:**
- `hooks/regex-engine.mjs` MUST be the first import of `src/index.ts` and of every hook script `init` wires (`tests/regex-engine.test.ts`).
- Hooks never import from `dist/`; shared logic the TS side needs lives in `hooks/` (e.g. `hooks/note-shape.mjs`).
- The note shape is frozen in ONE table, `hooks/note-shape.mjs`. Never delete a shipped `check` id.
- `src/graph/view-template.ts` is GENERATED: never hand-edit it.
- `kb view` and `coldstart graph` are human-only, never MCP tools. `kb commit` is CLI-only.
- **When a change is meaningful to an outside user** (a command's behavior/flags change, a new `kb` subcommand ships, the notebook's guarantees change, the npm package name changes), update `site-astro/src/pages/docs.astro` (and `index.astro` if it affects the pitch). Routine internal refactors don't need a site update.

Key files:

- `src/index.ts` — entry point, index pipeline, keeper + MCP-reader wiring
- `src/keeper.ts` — ensureKeeper (lazy-spawn the background keeper)
- `src/cli.ts` — CLI readers (`find`/`gs`/`index`)
- `src/indexer/` — walk / parse / resolve / graph / patch / reconcile / invariants / parse-guard / cochange
- `src/server/find.ts` — the `find` engine (buildRichPage), shared by CLI + MCP
- `src/server/searcher.ts` — ripgrep resolution for find's scan pass
- `src/server/tools.ts` — `gs` handler + symbol-body slicing
- `src/server/mcp.ts` — MCP tool defs + stdio server
- `src/index-manager.ts` — keeper state machine (watch → patch vs rebuild → save, atomic swap)
- `src/watcher.ts` — debounced `fs.watch` wrapper
- `src/status.ts` / `src/restart.ts` — keeper liveness/freshness + lifecycle control
- `src/init.ts` / `src/unwire.ts` — wire / unwire a repo for Claude Code, Codex, Cursor, Other
- `src/indexer/extractors/parser-factory.ts` — wasm-only parser factory (`makeParser` + `ensureParsersReady`)
- `src/cache/disk-cache.ts` — on-disk cache v18 (consumer-scoped gzipped segments, generations, load profiles, NO TTL)
- `src/keeper-state.ts` — keeper-state.json + repair.jsonl (observability beside the cache)
- `src/kb/` — notebook: store / raw-log / fold / render / search / write / freshness / notes-index / lint / repair / cli
- `hooks/` — capture (`kb-elicit.mjs`), recall (`kb-recall.mjs`), nudges, co-change nudge, per-host entrypoints
- `src/graph/` — `coldstart graph` viewer
- `src/types.ts`, `src/constants.ts`
- `site-astro/` — the Astro marketing site on coldstartmcp.dev

@coldstart.md
