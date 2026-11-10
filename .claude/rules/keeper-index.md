---
paths:
  - "src/index.ts"
  - "src/index-manager.ts"
  - "src/keeper*.ts"
  - "src/daemon-lock.ts"
  - "src/watcher.ts"
  - "src/status.ts"
  - "src/restart.ts"
  - "src/cli.ts"
  - "src/cache/**"
  - "src/indexer/**"
  - "src/server/**"
  - "hooks/regex-engine.mjs"
  - "vendor/wasm/**"
---

# Keeper, cache, freshness, parsing

**Architecture — one keeper, thin readers.** The query surfaces are stateless readers over an on-disk cache; a single background **keeper** process keeps that cache fresh. It does NOT serve queries.
- **Keeper** (`coldstart --daemon`, `src/index.ts` runKeeper + `src/index-manager.ts`): watches the repo, patches/rebuilds the index, debounce-saves it to the disk cache. Lazy-spawned by the first reader (`src/keeper.ts` ensureKeeper); logs to `~/.coldstart/daemon/<root>.log`; exits when its lockfile is removed, a foreign pid takes over the lock, or **its own entry binary disappears** (`watchOwnBinary` in `src/daemon-lock.ts` — a 15 s poll, two consecutive misses, so a keeper self-reaps within ~30 s of an `npm uninstall`/moved install, the only shutdown path once the CLI is gone). The lock carries pid/rootDir/version (no port — it serves nothing).
- **CLI readers** (`coldstart find`/`gs`, `src/cli.ts`): load the cache under a load profile, run the same engine, print, exit. They `ensureKeeper` so uncommitted edits stay live. **Readers NEVER build**: cache miss → wait for the keeper's first save (180 s); git-HEAD drift → wait for its reconcile re-save (12 s); in-process build only on the no-keeper fallback.
- **MCP reader** (default invocation, `src/server/mcp.ts` + `src/index.ts` makeCacheReader): a long-lived stdio server that reads the keeper's cache and mtime-reloads when it changes. The keeper is the single freshness authority; the server has no watcher of its own.

**Freshness (no TTL).** Validity = CACHE_VERSION + git HEAD + reconcile + live watcher. At keeper start, `src/indexer/reconcile.ts` stat-walks every indexed file against its `[mtimeMs,size]` fingerprint (stamped in baseIndexedFile) + git-diffs against the indexed HEAD, then patches exactly the changed set (branch switch = ~3 s patch). After every patch, `src/indexer/invariants.ts` lints the index (violation → auto-rebuild); after every save, a rotating 50-file fingerprint audit re-patches watcher-missed drift. `keeper-state.json` (last reconcile/patch/rebuild/save) + `repair.jsonl` (failures) sit beside the cache; `status` renders both. The keeper watches its own lockfile with pid-ownership + a 30 s poll backstop (foreign pid → exit).

**Live updates:** the keeper's `fs.watch` listener keeps the cache current. Changes are debounced (400 ms), then either patched incrementally (≤ max(30, 20% of repo) files, ~2–5 ms/file) or trigger a full background rebuild, and the cache is re-saved ~5 s after edits settle — in atomic generations (`g<N>-` segments; `meta.json` names the gen and commits last; mixed-generation reads impossible). Patch mirrors the walker's dir rules (hidden/excluded dir segments rejected — the watcher/porcelain can feed paths the walker never would). No restarts required.

**`find` speed:** the repo-wide reference scan resolves a real ripgrep (`src/server/searcher.ts`: COLDSTART_RG → PATH → bundled @vscode/ripgrep → editor-app copies; winner persisted in `~/.coldstart/searcher.json`), falling back to git grep → grep → Node scan.

**Index pipeline:** walk → parse (Tree-sitter via **web-tree-sitter (WASM)**; all 15 grammars are inert `.wasm` vendored in `vendor/wasm/`, loaded once by `ensureParsersReady()` in `src/indexer/parser.ts`, no per-grammar peer-dep / node-gyp / install scripts → plain `npm i` for TS/JS/JSX/TSX/Java/Ruby/Python/Go/Rust/C#/PHP/Kotlin/C++/YAML/TOML/XML/Groovy; SFC script blocks extracted from Vue/Svelte/Astro before TS parsing; GraphQL/.env/AngularJS 1.x via regex extractors; Swift/Dart not indexed) → resolve imports → build graph (including cross-file call edge resolution) → save cache.

For Rails repos: the Ruby parser emits synthetic edges for `has_many`/`belongs_to`/`has_one`/`has_and_belongs_to_many` (gated to `app/models/`), parses `config/routes.rb` resources, and adds bidirectional controller↔views edges. Polymorphic associations and gem-backed models stay unresolved (runtime DSL).

**Parse time limit (`src/indexer/parse-guard.ts`):** each file's synchronous parse (tree-sitter + extractors + content tokens) runs as ONE `vm` call with a 5 s `timeout` (`COLDSTART_PARSE_TIMEOUT_MS` overrides). The `vm` watchdog lives on its own thread, so it stops a spin that has killed the event loop — JS, regex and wasm alike (a timer or signal handler cannot). A timed-out file is indexed by path only (`timedOut`), logged + `parse-timeout` in `repair.jsonl`, and retried only when its fingerprint changes. After a timeout `resetParsers()` MUST swap in fresh tree-sitter parsers: a parser stopped mid-parse stays broken (`RuntimeError: Aborted()` on every later file of that grammar) — `tests/parse-timeout.test.ts` proves both. No `await` may sit inside the guarded section (the Rust workspace lookup runs before it). Cost ~60 µs/file (~9% of the parse phase, measured on monica). **In front of it, V8's linear regex fallback (`hooks/regex-engine.mjs`)** sets `--enable-experimental-regexp-engine-on-excessive-backtracks` process-wide, so a backtracking regex that blows up is re-run on V8's linear engine and the file is still FULLY indexed (the time limit only gets you path-only). It covers only regexes created after it is set, so it MUST be the first import of `src/index.ts` (CLI, MCP and keeper all start there) and of every hook script `init` wires — `tests/regex-engine.test.ts` pins that, derived from init's hook constants. Regexes it cannot run (backreferences, lookarounds) keep backtracking; the time limit is their net. Index output measured byte-identical with it on vs off (monica/ripgrep/serilog/coldstart), same speed.

**Co-change (`src/indexer/cochange.ts`):** "edited together" pairs from `git log --name-status -M`, keyed on HEAD (history only moves when a commit lands, so an edit never re-walks). Renames are carried FORWARD over the whole window (`-M` only labels the rename commit; older commits still say the old path), so a renamed file keeps its history instead of splitting in two. Sidecar `cochange.json` beside the cache, plain JSON so `saveCachedIndex`'s `*.gz` sweep spares it. Store 8 partners / show 3 / min support 2 / 12k-commit window — all measured, don't re-derive. `gs` renders "Edited together" in EVERY view: narrowing asks for less of the file, not for fewer channels.
