# Architecture — coldstart

This document captures the *current* architecture (post the `find`/`gs` + keeper refactor). For the user-facing overview see [README.md](./README.md).

---

## Core thesis

coldstart is a **routing layer** for AI agents, not a semantic search engine. It answers structural questions fast:

- Where does the code for a concept live? → `find`
- What's in this file, what does it import, and who uses it? → `gs`

It deliberately avoids behavioral summaries, embeddings, and heavy ranking. The agent brings the semantics; coldstart brings token → file retrieval over a static index.

---

## Process model: one keeper, thin readers

The big idea: a single background **keeper** keeps an on-disk cache fresh; everything that answers queries is a stateless **reader** over that cache. There is no HTTP server, no port, no bridge.

```
            keeper  (coldstart --daemon)          ← the only stateful process
            watch repo → patch/rebuild → save
                       │  on-disk cache
        ┌──────────────┼───────────────┐
   coldstart find   coldstart gs    MCP server (stdio)
   (read → print)   (read → print)  (read → reply, mtime-reload)
```

### Keeper (`src/index.ts` `runKeeper`, `src/index-manager.ts`)
- Spawned as `coldstart --daemon`, one per absolute repo root. **Lazy-spawned** by the first reader (`src/keeper.ts` `ensureKeeper`), not by the user.
- Watches the repo, patches or rebuilds the index, debounce-saves it to the disk cache. **It serves nothing** — readers never talk to it; they read the cache it writes.
- Logs to `~/.coldstart/daemon/<basename>-<hash>.log` (rotated at 1 MB, previous run in `.log.prev`). Exits cleanly when its lockfile is removed.

### CLI readers (`coldstart find` / `gs` / `index`, `src/cli.ts`)
- Pure readers: load the cache, run the same engine the MCP reader uses, print the result, exit.
- On cache miss or git-HEAD drift they lazily build + save (not concurrency-safe — fine for sequential CLI use; `coldstart index` is the single-writer prep step).
- They call `ensureKeeper` first, so a background keeper is alive to keep the cache live for uncommitted edits.

### MCP reader (default invocation, `src/server/mcp.ts` + `src/index.ts` `makeCacheReader`)
- A long-lived stdio MCP server. Reads the keeper's cache and **mtime-reloads** when it changes. The keeper is the single freshness authority; the server has no watcher of its own.
- Exposes `find` and `gs` with output byte-identical to the CLI.

### Lockfile (`src/daemon-lock.ts`)
- Path: `~/.coldstart/daemon/<basename>-<hash>.json`, where `<basename>` is the root's directory name and `<hash>` is the first 16 hex chars of `sha256(absolute_path)`.
- Contents: `{ pid, rootDir, version }`. **No port** — the keeper serves nothing. `version` lets a reader replace a keeper left by an older coldstart (cache-format compatibility).
- A separate **spawn lock** (`.spawn`, opened `O_CREAT | O_EXCL`) ensures only one reader spawns the keeper when several start in parallel.

### `status` / `restart`
- `coldstart status` (`src/status.ts`) lists every keeper's lockfile, checks liveness with `process.kill(pid, 0)`, and reports index freshness from the cache `meta.json` mtime — no network probe. This also covers the old `doctor` "is my index fresh?" use case.
- `coldstart restart [--all]` (`src/restart.ts`) SIGTERMs (5 s grace, then SIGKILL) and clears the lockfile; the next lookup respawns a fresh keeper.

---

## Index pipeline

`walk → parse → resolve → graph → save`.

1. **Walk** (`indexer/walker.ts`) — discover source files by extension; skip hidden dirs, symlinks, and files over the size threshold.

2. **Parse** (`indexer/parser.ts`, `indexer/extractors/`) — Tree-sitter for TS/JS/JSX/TSX/Java/Kotlin/Ruby/Python/Go/Rust/C#/PHP/C++/Groovy/YAML/TOML/XML. SFC script blocks are extracted from Vue/Svelte/Astro before TS parsing. GraphQL, `.env`, and AngularJS 1.x use regex extractors. Swift/Dart are not indexed. Extractors share node helpers (`extractors/node-helpers.ts`) and a parser factory (`extractors/parser-factory.ts`) so each language file is just its grammar + capture logic.

3. **Resolve** (`indexer/resolvers/`) — per-language import resolution, one file per language dispatched by `resolvers/index.ts`. Each resolver **walks up from the file's own directory** to find its config (`tsconfig`, `go.mod`/`go.work`, `composer.json`, `Gemfile`, `Cargo.toml`, `package.json` workspaces), never anchoring to the repo root. Java/Kotlin use an FQCN → fileId index for fast same-package and fully-qualified resolution.

4. **Graph** (`indexer/graph.ts`) — build adjacency maps (`outEdges`/`inEdges`), resolve cross-file call edges, derive `importedByCount`. **Synthetic convention edges** are added here for framework conventions that resolve names at runtime (no import text to follow):
   - **Rails** — `has_many`/`belongs_to`/`has_one`/`has_and_belongs_to_many` (gated to `app/models/`), `config/routes.rb` resources → controllers, and bidirectional controller↔view folder edges.
   - **Django / Laravel / C#** — analogous convention-reference passes.
   - All synthetic passes are **idempotent** (seed a `seen` set from existing edges, add only what's missing), so they're safe to re-run during an incremental patch.

5. **Save** (`cache/disk-cache.ts`) — write the cache (see below).

### `baseIndexedFile` — one shape, three call sites
The parser-derived fields of an `IndexedFile` are constructed by `baseIndexedFile()` (`indexer/indexed-file.ts`), shared by **buildIndex**, **runProbe**, and **patchIndex**. This is an invariant: the three sites must not drift, or incremental patches silently lose fields (this caused the convention-edge freshness bug — see below).

---

## Live updates

The keeper's `fs.watch` listener (native Node, FSEvents on macOS / inotify on Linux; `src/watcher.ts`) keeps the cache current:

1. Events debounced over 400 ms, deduplicated by path, filtered to indexed-language extensions, and SHA-256 content-checked (filters editor atomic-save and `git checkout` mtime touches).
2. Decision after the debounce settles:

   | Changed files | Action |
   |---|---|
   | 0 (no real change) | no-op |
   | 1–30 | incremental patch (`indexer/patch.ts`) |
   | > 30 | background full rebuild |
   | git HEAD changed | full rebuild |

3. Rebuilds are atomic: tool calls are served from the previous snapshot until the swap; changes arriving mid-rebuild are queued and applied as a follow-up patch (no silent drops).
4. The cache re-saves ~5 s after the last change.

### Patch must re-run synthetic passes (freshness invariant)
`patchIndex` Phase 1 strips a changed file's outgoing edges — *including* its synthetic convention edges. So after re-resolving imports, the patch **re-runs the idempotent synthetic-edge passes** over the full file set, gated to the changed languages. Without this, editing a single Rails/Django/Laravel/C# convention file would delete its convention edges until the next full rebuild. The regression test is `tests/patch-synthetic-freshness.test.ts`. **Do not remove the synthetic re-run from patch, and keep the three `baseIndexedFile` call sites in sync.**

---

## Caching

**Path:** `~/.coldstart/indexes/<basename>-<hash>/`, three artifact types:
- `meta.json` — schema version, root path, git HEAD, file count, timestamp. Written **last** as the atomic commit marker; read **first** to decide whether the rest is worth loading.
- `graph.json` — file + symbol edges, adjacency maps, token document frequencies.
- `files-N.json` — per-file metadata in chunks (large repos produce `files-0.json`, `files-1.json`, …).

**Reused when** `CACHE_VERSION` (in `src/constants.ts`) matches and git HEAD is unchanged. Bumping `CACHE_VERSION` auto-invalidates every cache on the next run. The 24 h TTL is a safety net only — the keeper's watcher is the primary freshness signal. The cache directory and the keeper lockfile directory are independent; wiping one doesn't affect the other.

---

## Data model highlights

`CodebaseIndex`: `files` map, `edges` (file-level), `symbolEdges` (`calls`/`extends`/`implements`/`exports`), `outEdges`/`inEdges` adjacency, `tokenDocFreq` (IDF), `gitHead`, `indexedAt`.

Per-file signals: `domainMap`, `importedByCount`, `transitiveImportedByCount`, `isBarrel`, `symbols: SymbolNode[]`. `SymbolNode`: `id` (`fileId#name`), `name`, `kind`, `startLine`/`endLine`, `isExported`, `calls[]`, `extendsName?`, `implementsNames[]`.

---

## What this is and is not

It **is** a local, static, offline index + routing layer for coding agents — a fast structural context provider and one-hop symbol-level dependency view.

It is **not** a replacement for code reading, a semantic RAG/embedding platform, a behavioral summarizer, or a networked/multi-machine service.
