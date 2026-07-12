# Architecture — coldstart

This document captures the *current* architecture (post the `find`/`gs` + keeper refactor and the 2.0 freshness track). For the user-facing overview see [README.md](./README.md).

---

## Core thesis

coldstart is a **routing layer** for AI agents, not a semantic search engine. It answers structural questions fast:

- Where does the code for a concept live? → `find`
- What's in this file, what does it import, and who uses it? → `gs`

It deliberately avoids behavioral summaries, embeddings, and heavy ranking. The agent brings the semantics; coldstart brings token → file retrieval over a static index.

Two properties follow from that and drive everything below:

1. **`find` must be as fast as grep** — an agent reaches for the cheapest tool; if `find` is slower than `rg`, it loses on reflex, not merit.
2. **The index must always be fresh, without a TTL** — time never invalidates a correct index. Validity is *format version + git HEAD + reconcile + live watcher*, never "it's been 24 hours."

---

## Process model: one keeper, thin readers

A single background **keeper** keeps an on-disk cache fresh; everything that answers queries is a stateless **reader** over that cache. There is no HTTP server, no port, no bridge.

```
            keeper  (coldstart --daemon)          ← the only stateful process
            reconcile at start → watch repo → patch/rebuild → save
                       │  on-disk cache (generational segments)
        ┌──────────────┼───────────────┐
   coldstart find   coldstart gs    MCP server (stdio)
   (read → print)   (read → print)  (read → reply, mtime-reload)
```

### Keeper (`src/index.ts` `runKeeper`, `src/index-manager.ts`)
- Spawned as `coldstart --daemon`, one per absolute repo root. **Lazy-spawned** by the first reader (`src/keeper.ts` `ensureKeeper`), not by the user.
- On startup it **reconciles** (see below), then watches the repo, patches or rebuilds the index, and debounce-saves it to the disk cache. **It serves nothing** — readers never talk to it; they read the cache it writes.
- Logs to `~/.coldstart/daemon/<basename>-<hash>.log` (rotated at 1 MB, previous run in `.log.prev`). The keeper ignores `--quiet` — its log is its only observability channel. Exits cleanly when its lockfile is removed or taken over.

### Readers never build (`src/keeper.ts` `waitForKeeperCache` / `waitForCacheAdvance`)
Readers do **not** build the index in-process. On a cache miss they `ensureKeeper` and wait for the keeper's first save (up to 180 s, progress to stderr); on git-HEAD drift they wait up to 12 s for the keeper's reconcile to re-save. The only reader that builds inline is the `'no-keeper'` fallback — no live keeper *after a spawn attempt* (e.g. spawning is blocked in the environment). This kills the old failure mode where a CLI call could silently kick off a full 90-second build — and where several readers did it concurrently.

- **CLI readers** (`coldstart find` / `gs` / `index`, `src/cli.ts`) — load the cache under a partial **load profile** (see Caching), run the same engine the MCP reader uses, print, exit. `coldstart index` remains the explicit single-writer prep step.
- **MCP reader** (default invocation, `src/server/mcp.ts` + `src/index.ts` `makeCacheReader`) — a long-lived stdio MCP server. Reads the keeper's cache and **mtime-reloads** when it changes. The keeper is the single freshness authority; the server has no watcher of its own.

### Lockfile (`src/daemon-lock.ts`)
- Path: `~/.coldstart/daemon/<basename>-<hash>.json` — `<basename>` is the root's directory name, `<hash>` the first 16 hex chars of `sha256(absolute_path)`.
- Contents: `{ pid, rootDir, version }`. **No port** — the keeper serves nothing. `version` lets a reader replace a keeper left by an older coldstart.
- A separate **spawn lock** (`.spawn`, opened `O_CREAT | O_EXCL`) ensures only one reader spawns the keeper when several start in parallel.
- The keeper watches its own lockfile with **pid-ownership semantics** (`watchOwnLockfile`): lockfile gone → exit; lockfile present but holding a *foreign pid* → a replacement has taken over, exit. `fs.watch` can miss delete events, so a 30 s poll backstop re-checks. This closes the observed failure where a keeper survived its lockfile's deletion and co-wrote the cache with its replacement.

### `status` / `restart`
- `coldstart status` (`src/status.ts`) lists every keeper's lockfile, checks liveness with `process.kill(pid, 0)`, and reports index freshness from the cache `meta.json` mtime — no network probe. It also renders the keeper's **event stamps** (last reconcile / patch / rebuild / save, from `keeper-state.json`) and the tail of the **repair log** (`repair.jsonl`), so "is my index fresh, and *why*?" is answerable without reading the daemon log.
- `coldstart restart [--all] [--root <dir>]` (`src/restart.ts`) SIGTERMs (5 s grace, then SIGKILL) and clears the lockfile; the next lookup respawns a fresh keeper. `--root` targets a specific repo's keeper from anywhere.

### `init` / `unwire` (`src/init.ts`, `src/unwire.ts`)
- `coldstart init` writes the agent guidance and wires the chosen client (Claude / Codex / Cursor / Other) — see [README.md](./README.md) for the per-client surface.
- `coldstart unwire` (#69) is its **explicit reverse** — `npm uninstall` can't clean per-repo artifacts (npm fires no reliable pre/postuninstall; a global uninstall has no registry of inited repos). It reuses `init`'s own idempotency detectors (`isColdstartHookEntry` / `isKbHookEntry` / `isCodexHookEntry` / `isCursorHookEntry` / `stripCodexColdstartTable`), so removal is **symmetric with how `init` writes**: it strips only coldstart-owned markers (hook entries, the `@coldstart.md` import, the `AGENTS.md` block, the `[mcp_servers.coldstart]` table) and deletes fully-owned files (`coldstart.md`, `.cursor/rules/coldstart.mdc`), never touching user content in shared files. All four clients are swept unconditionally; the notebook is **kept by default** (committed user data), with `--purge` opting into deleting it and its git plumbing. Idempotent — a second run reports all-absent.

---

## Startup reconcile (`src/indexer/reconcile.ts`)

The freshness mechanism that replaced the deleted cache TTL. When the keeper starts and a cache loads, it answers **"which files changed while no keeper was watching?"** and patches exactly those, instead of discarding the index.

Two detectors, both always on:

- **Stale/deleted** — a fingerprint stat-walk over every indexed file, comparing live `[mtimeMs, size]` against the fingerprint stamped at parse time (`baseIndexedFile`). Runs unconditionally (~100–200 ms for 16k files): git alone would miss files that were indexed dirty and then reverted, and gitignored-but-indexed files.
- **New files** — a stat-walk can't see files the index has never met. `git diff --no-renames` against the stored HEAD plus `porcelain -uall` for untracked files supplies them cheaply; non-git repos (or git failure) fall back to a directory walk.

The changed set feeds the normal patch/rebuild decision: ≤ threshold → patch + invariant lint + save; above it → full rebuild. A branch switch that touches a few dozen files is now a **~2–4 s patch** instead of a full rebuild (measured on a 16k-file repo: 96 s → 3.5 s with the keeper dead, 2.1 s with it alive).

Accepted blind spots: an edit preserving both mtime and size is invisible to the fingerprint; a *new* gitignored file in a git repo is invisible to porcelain. The live watcher catches both from spawn onward, and the post-save audit (below) backstops the first.

---

## Recall engine — which ripgrep runs `find`'s scan (`src/server/searcher.ts`)

`find`'s repo-wide name-reference pass is a per-term scan; its speed decides whether `find` competes with raw grep. Resolution order, fastest first:

1. `COLDSTART_RG` env var — explicit override, never second-guessed
2. `rg` on PATH
3. bundled `@vscode/ripgrep` (regular dependency, registry-only, no install scripts)
4. editor-app copies — VS Code / Cursor ship a ripgrep inside the app bundle; the Claude Code binary *is* ripgrep when invoked with `argv0=rg`

Every candidate must answer `--version` with `ripgrep ...` before it wins. The winner is persisted in `~/.coldstart/searcher.json` (machine-global); later runs revalidate with a stat instead of re-probing, and a scan-time spawn failure invalidates and re-resolves once. No ripgrep at all → `git grep` → `grep` → pure-Node scan. Scans run single-threaded per term (`-j2` overall) — measured faster than thread fan-out for this workload, and it keeps `find` from stealing cores from the agent.

---

## Index pipeline

`walk → parse → resolve → graph → save`.

1. **Walk** (`indexer/walker.ts`) — discover source files by extension; skip hidden dirs, symlinks, and files over the size threshold.

2. **Parse** (`indexer/parser.ts`, `indexer/extractors/`) — Tree-sitter, run on **web-tree-sitter (WASM)** for TS/JS/JSX/TSX/Java/Kotlin/Ruby/Python/Go/Rust/C#/PHP/C++/Groovy/YAML/TOML/XML. SFC script blocks are extracted from Vue/Svelte/Astro before TS parsing. GraphQL, `.env`, and AngularJS 1.x use regex extractors. Swift/Dart are not indexed. Extractors share node helpers (`extractors/node-helpers.ts`) and a wasm-only parser factory (`extractors/parser-factory.ts` — `makeParser` + `ensureParsersReady`). Each file is stamped with its `[mtimeMs, size]` fingerprint at parse time — the raw material for reconcile and the audit.

   **Parse engine — WASM-only (as of #68).** The native `node-tree-sitter` bindings and all 14 native grammar packages were removed; every grammar is now an inert `.wasm` vendored in `vendor/wasm/` (12 copied verbatim from the grammar npm packages' shipped wasm, 3 — c#/kotlin/xml — built from source). `ensureParsersReady()` (awaited at the top of `parseFile`, so it covers build/patch/reconcile alike) drains and loads each newly-registered grammar once, and **throws** on a missing vendored wasm — no native fallback, so a broken grammar errors loudly instead of false-passing. `wrapWasmParser` deletes the previous tree each parse (web-tree-sitter 0.26.10 has no auto-GC) and reconstructs the >32 KB chunk-callback into a full string (WASM has no 32 KB cap). Why: `.wasm` needs no node-gyp, no install scripts, and no per-grammar peer-dep, which retires coldstart's whole native-build problem class (the peer-dep install hang, npm 12's node-gyp block, the kotlin prebuild gap) and keeps it a plain `npm i`. Behaviour is byte-identical to the native engine (proven with the natives pruned from `node_modules` — index edge counts match exactly across ~12 repos), and 1.3–3.6× faster through the walk-heavy extract phase (node-tree-sitter's cost was JS↔C++ accessor marshalling on the walk). `web-tree-sitter` is the only remaining Tree-sitter dependency.

3. **Resolve** (`indexer/resolvers/`) — per-language import resolution, one file per language dispatched by `resolvers/index.ts`. Each resolver **walks up from the file's own directory** to find its config (`tsconfig`, `go.mod`/`go.work`, `composer.json`, `Gemfile`, `Cargo.toml`, `package.json` workspaces), never anchoring to the repo root. Java/Kotlin use an FQCN → fileId index for fast same-package and fully-qualified resolution.

4. **Graph** (`indexer/graph.ts`) — build adjacency maps (`outEdges`/`inEdges`), resolve cross-file call edges, derive `importedByCount`. **Synthetic convention edges** are added here for framework conventions that resolve names at runtime (no import text to follow):
   - **Rails** — `has_many`/`belongs_to`/`has_one`/`has_and_belongs_to_many` (gated to `app/models/`), `config/routes.rb` resources → controllers, and bidirectional controller↔view folder edges.
   - **Django / Laravel / C#** — analogous convention-reference passes.
   - All synthetic passes are **idempotent** (seed a `seen` set from existing edges, add only what's missing), so they're safe to re-run during an incremental patch.

5. **Save** (`cache/disk-cache.ts`) — write the cache (see Caching).

### `baseIndexedFile` — one shape, three call sites
The parser-derived fields of an `IndexedFile` are constructed by `baseIndexedFile()` (`indexer/indexed-file.ts`), shared by **buildIndex**, **runProbe**, and **patchIndex**. This is an invariant: the three sites must not drift, or incremental patches silently lose fields (this caused the convention-edge freshness bug — see below).

---

## Live updates

The keeper's `fs.watch` listener (native Node, FSEvents on macOS / inotify on Linux; `src/watcher.ts`) keeps the cache current:

1. Events debounced over 400 ms, deduplicated by path, filtered to indexed-language extensions, and SHA-256 content-checked (filters editor atomic-save and `git checkout` mtime touches).
2. Decision after the debounce settles, with `threshold = patchThreshold(fileCount) = max(30, ⌈20% of indexed files⌉)` (`src/constants.ts`):

   | Changed files | Action |
   |---|---|
   | 0 (no real change) | no-op |
   | ≤ threshold | incremental patch (`indexer/patch.ts`) + invariant lint |
   | > threshold | background full rebuild |

   A branch switch while the keeper is live arrives as ordinary watch events and follows the same rule — usually a patch. `IndexManager` refreshes the index's `gitHead` at save time, so the saved cache never carries a pre-checkout HEAD (which would make every reader wait out the 12 s drift window).
3. Rebuilds are atomic: tool calls are served from the previous snapshot until the swap; changes arriving mid-rebuild are queued and applied as a follow-up patch (no silent drops). A failed rebuild is logged to `repair.jsonl` and retried with backoff (60 s × attempt, max 3).
4. The cache re-saves ~5 s after the last change.

### Patch must mirror the walker's directory rules
The watcher and reconcile's porcelain pass can hand `patchIndex` paths the walker would never descend into — `.coldstart/` notebook writes, `.claude/settings.json`, `node_modules/`. The patch rejects any path with a dir segment starting with `.` or listed in `DEFAULT_EXCLUDES` (hidden *files* at the root still index — only directory segments are filtered). Without this the index diverges from what a rebuild would produce. Regression test: `tests/patch-hidden-dirs.test.ts`.

### Patch must re-run synthetic passes (freshness invariant)
`patchIndex` Phase 1 strips a changed file's outgoing edges — *including* its synthetic convention edges. So after re-resolving imports, the patch **re-runs the idempotent synthetic-edge passes** over the full file set, gated to the changed languages. Without this, editing a single Rails/Django/Laravel/C# convention file would delete its convention edges until the next full rebuild. Regression test: `tests/patch-synthetic-freshness.test.ts`. **Do not remove the synthetic re-run from patch, and keep the three `baseIndexedFile` call sites in sync.**

### Invariant lint, audit, repair
- **Invariant lint** (`indexer/invariants.ts`) runs after every patch: edge endpoints exist, adjacency maps mirror the edge list, symbol-edge and posting targets exist (sampled). Any violation → log to `repair.jsonl` and fall back to a full rebuild. One deliberate exception: `extends`/`implements` targets are *bare class names* by design — only `#`-qualified refs and `exports.from` assert file existence, otherwise any repo with inheritance would rebuild forever.
- **Fingerprint audit** (`index-manager.ts` `auditFingerprints`) — after each cache save, stat a rotating 50-file window of the index and compare fingerprints; drifted files are re-patched. Catches watcher-missed events over time without ever stat-walking everything at once.
- **Observability files** (`src/keeper-state.ts`), written beside the cache segments:
  - `keeper-state.json` — last reconcile/patch/rebuild/save stamps, one record, atomic overwrite (writes serialized through a promise chain).
  - `repair.jsonl` — append-only failure log (patch-failed / rebuild-failed / invariant-violation / reconcile-failed), 256 KB cap, survives keeper restarts. `coldstart status` renders both.

---

## Caching (`src/cache/disk-cache.ts`, format v18)

**Path:** `~/.coldstart/indexes/<basename>-<hash>/`. The old format stored one giant JSON blob (132 MB on a 16k-file repo) that every reader parsed in full even though `find` needs a fraction of it. v18 splits the index by **consumer**, gzips each segment, and interns every file path once (a `fileTable`; everything else refers to files by integer index):

| Segment | Consumer | Contents |
|---|---|---|
| `meta.json` | all | version, gitHead, counts, **generation number**. Written **last** (commit marker), read first. |
| `g<N>-table.json.gz` | all | the fileTable (relative paths) |
| `g<N>-core-<n>.json.gz` | find+gs | slim per-file tuples: language, line/import counts, flags, slim symbols (no `calls[]`), contentTokens — 5000 files per chunk |
| `g<N>-graph.json.gz` | find+gs | file edges, adjacency, contentToken postings — serialized, no longer rebuilt on load |
| `g<N>-callgraph.json.gz` | gs | symbolEdges |
| `g<N>-build-<n>.json.gz` | keeper | domainMap, exports, raw imports, hashes, per-symbol `calls[]`, resolver fields — everything needed to *patch*, never to query |
| `g<N>-buildmeta.json.gz` | keeper | tokenDocFreq |
| `fingerprints.json` | keeper | per-file `[mtimeMs, size]` aligned to the fileTable — reconcile's input |

**Load profiles:** `'find'` (table+core+graph) · `'gs'` (+callgraph) · `'full'` (+build+fingerprints). A partial load stamps `index.profile`, and `saveCachedIndex` **refuses to persist a partial index** — a reader can never clobber the keeper's full cache. Measured on the 16k-file repo: disk 132 → 8.9 MB, load 885 → ~350 ms.

**Generations:** every save writes a fresh `g<N>-` segment set, commits it by writing `meta.json` (which names the generation) **last and atomically**, then sweeps generations older than N−1. A reader that opened `meta.json` mid-save can still load its full generation; mixed-generation reads (new fileTable + old chunk = silently misaligned data) are structurally impossible. `keeper-state.json` / `repair.jsonl` / `kb-notes.json` deliberately don't match the sweep patterns.

**Validity:** `CACHE_VERSION` (in `src/constants.ts`) matches + git HEAD handling above. Bumping `CACHE_VERSION` auto-invalidates every cache on the next run. **There is no TTL** — time never invalidates a correct index; reconcile and the watcher keep it correct instead.

---

## Notebook (`src/kb/`)

A repo-local knowledge base written and read by agents: `coldstart kb search|lookup|write|commit|status|lint|render|init|migrate`. The full design contract and solutioning live in internal design docs (`docs/` is untracked); architecture-relevant points only:

- **Storage:** `.coldstart/notebook/` — one append-only `.raw/<id>.jsonl` event log **per note** as source of truth (commit it; merges are union), with human-readable Markdown notes *derived* from it (`kb render`; hand-edits are blown away). Hidden dir → structurally outside the code index. A note's content is a pure fold of its log (ts-ordered, tie-broken by canonical JSON), so a same-branch append and a cross-branch git merge are the same operation.
- **Concurrency (stress-validated):** multiple sessions write safely with no lock. Per-note logs mean distinct notes never contend; same-log appends are single O_APPEND writes (validated at 30 concurrent ~100KB records). Freshly-coined flow/lesson ids are created with `O_EXCL` — a coin race loses EEXIST and re-coins, so two same-moment captures become two visible notes, never a silent merge (`--into` merges stay non-exclusive). The fold **unions** anchor symbol lists (concurrent writers each stamp arrays built from the state they saw; replace semantics dropped symbols). Derived md (`notes/<id>.md`, `_index.md`) is written temp+rename — readers never see a truncated note. `kb write -` reads stdin as a stream (fd-0 `readFileSync` throws EAGAIN on pipes). Regression suites: `tests/kb-store-atomic.test.ts`, `tests/kb-concurrent-create.test.ts`.
- **Decoupled from the code index:** `kb search` never loads the code index. The keeper derives a small `kb-notes.json` sidecar (anchor-symbol inventories + absence stamps for freshness rendering) — refreshed single-flight at watch start, on `.raw` batches, and post-save. kb readers degrade gracefully (freshness marks only) until the first stamp exists.
- **Git publishing:** `kb commit` is the one sanctioned path to git — it pathspec-commits only the notebook's committed surface (`.raw/`, `okf.yaml`, `.gitignore`), so note-writing cadence never rides inside feature commits, and it respects an owner's decision to gitignore the notebook entirely.
- **Capture/recall hooks** (`hooks/kb-elicit.mjs`, `hooks/kb-recall.mjs`): Stop/SubagentStop elicits a note only when the session did deep reads (whole-file Reads / `gs` calls — "needs a read you haven't done? then don't write"); UserPromptSubmit injects, on a strong title/alias/anchor match only, a compact title+gist block (6 KB cap, framed as reference data, never instructions). Wired by `coldstart kb init` (the main `init` wires only the find/gs hooks).

---

## Data model highlights

`CodebaseIndex`: `files` map, `edges` (file-level), `symbolEdges` (`calls`/`extends`/`implements`/`exports`), `outEdges`/`inEdges` adjacency, `tokenDocFreq` (IDF), `contentTokenPostings`, `gitHead`, `indexedAt`, `profile`.

Per-file signals: `domainMap`, `importedByCount`, `transitiveImportedByCount`, `isBarrel`, `mtimeMs`/`sizeBytes` (fingerprint), `symbols: SymbolNode[]`. `SymbolNode`: `id` (`fileId#name`), `name`, `kind`, `startLine`/`endLine`, `isExported`, `calls[]`, `extendsName?`, `implementsNames[]`.

---

## What this is and is not

It **is** a local, static, offline index + routing layer for coding agents — a fast structural context provider and one-hop symbol-level dependency view.

It is **not** a replacement for code reading, a semantic RAG/embedding platform, a behavioral summarizer, or a networked/multi-machine service.
