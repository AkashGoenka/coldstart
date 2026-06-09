# coldstart

coldstart is a lightweight navigation layer for AI agents.

It answers one question: **which files are relevant to this task?** No embeddings, no graph, no model to run or maintain. Just a fast, static index over your codebase — file paths, symbol names, exports — built once, queried instantly.

Agents are already good at reading code, tracing logic, and reasoning about structure. What they don't need is another system trying to do that for them. coldstart stays out of the way: find the file, hand it off, done.

**2 tools. Minimal context overhead. No infrastructure to babysit.**

---

## Installation

Requires Node.js 18+.

**Install globally, then run init once from inside your project:**

```bash
npm install -g coldstart-mcp --legacy-peer-deps
coldstart-mcp init
```

`init` copies the global install into `~/.coldstart/versions/<version>/` and writes a `.mcp.json` pointing directly at that path. After that, every MCP startup is a direct `node` invocation — fast, no per-session npm overhead.

> **Why `--legacy-peer-deps`?** The tree-sitter grammar packages under-declare their peer-dep ranges (some say `^0.21.x`, others say `^0.22.x`). Without the flag, npm's strict resolver enters a long retry loop on fresh installs and can appear to hang. The flag tells npm to use our declared versions as-is — exactly what we test against. We can't set this from inside the package (npm reads install config only from the user's environment, never from the package being installed).

coldstart detects your IDE (Claude Code or Cursor) and writes the right files automatically:

| IDE | MCP config | Agent rules |
|-----|-----------|-------------|
| Claude Code | `.mcp.json` — merged if exists | `CLAUDE.md` — appended if exists |
| Cursor | `.cursor/mcp.json` — merged if exists | `.cursor/rules/coldstart-mcp.mdc` |
| Neither detected | `coldstart-mcp.json` + `coldstart-rules.md` to copy manually |

Re-running `init` is safe — it never duplicates entries.

### Upgrading

```bash
npm install -g coldstart-mcp@latest --legacy-peer-deps
coldstart-mcp init
```

The second command re-runs init from the new install, which rewrites `.mcp.json` to point at the new versioned path under `~/.coldstart/versions/`. The version-stamped lockfile then triggers the old daemon to shut down on the next tool call and a fresh daemon spawns from the new binary.

### Migrating from a previous version

If your `.mcp.json` was written by an earlier release and uses `"command": "npx"`, you have two options:

1. **Re-run init** (recommended) — see the install/upgrade commands above.

2. **Automatic on next launch**: starting in v1.4.0, coldstart-mcp detects legacy `npx`-style entries in `.mcp.json` at startup and rewrites them to use direct `node` (with a backup file). The current session keeps running on the slow path; the next session is fast.

To opt out of auto-migration: set `COLDSTART_NO_AUTO_MIGRATE=1` in the MCP entry's `env`.

> **Note on `--root`:** Modern MCP clients (Claude Code, Cursor) advertise the workspace via `roots/list` during the handshake — coldstart auto-detects the project path from that. `--root` is a fallback for older clients, direct CLI use, or pinning a specific subdirectory of a monorepo.
>
> **Caveat for some IDEs:** the daemon is keyed by absolute path, so if one client passes `--root /work/myproj` and another opens the same project but `roots/list` returns a different form (trailing slash, symlinked path that doesn't resolve, or a workspace root that's a parent of the project), they'll spawn two separate daemons indexing overlapping content. For init-generated configs, leave `--root` unset and let `roots/list` handle it. If you see duplicate daemons in `~/.coldstart/daemon/`, this is the usual cause.

---

## How it runs

By default coldstart runs in **bridge + daemon** mode. The first time an MCP client connects, the bridge spawns a small background daemon process that holds the index in memory; subsequent client sessions for the same project reuse it. This means you don't pay the indexing cost every time the AI client restarts.

```
AI client ──stdio──> coldstart bridge ──HTTP──> coldstart daemon
                                                     │
                                                     └── live index in memory
```

- **One daemon per project root.** Identified by the absolute path (no daemon sharing across projects).
- **Lockfile:** `~/.coldstart/daemon/<basename>-<hash>.json` records `{pid, port, rootDir}`.
- **Log file:** `~/.coldstart/daemon/<basename>-<hash>.log` captures the daemon's full stderr (parse progress, errors, watcher events). The previous run is preserved at `.log.prev`. Each file caps at 1 MB.
- **Idle daemon:** stays alive across client restarts. Nothing pings it shut — it sits at near-zero CPU and a few MB of RAM until invoked.
- **First-call latency:** the bridge waits up to 180s for the daemon to finish its initial index, then proxies tool calls.

**Daemon management:**

```bash
coldstart-mcp doctor          # is the current project's daemon healthy?
coldstart-mcp status          # list every daemon on the machine
coldstart-mcp restart         # kill the current project's daemon (next tool call respawns)
coldstart-mcp restart --all   # kill every running daemon
```

`doctor` exits 0 on PASS and 1 on FAIL — easy to wire into scripts. `restart` is the right answer when *anything* feels off; a fresh daemon loads the disk cache (or rebuilds if missing). Upgrading the package is automatic — the bridge version-checks the running daemon and respawns it from your new binary; you don't need to restart anything by hand.

As of v1.4.3 the daemon's log lines (parse progress, errors, watcher events) stream into your AI client's Output panel in real time, so you'll usually see what's happening without `tail`. The full log still lives at `~/.coldstart/daemon/<basename>-<hash>.log` (rotated at 1 MB; previous run in `.log.prev`) for crash postmortems.

If you want to avoid the daemon entirely (e.g. for debugging or in environments where spawning detached processes is awkward), pass `--no-daemon` and coldstart runs as a single stdio process — same tools, no background state.

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for deeper recovery procedures.

---

## How it indexes

There is no separate indexing step. On first run coldstart automatically:

1. Walks the filesystem and parses all source files in batches of 100 — progress is logged to stderr every 500 files so you can see it's alive on large repos
2. Resolves imports and builds a dependency graph
3. Caches the index to `~/.coldstart/indexes/<basename>-<hash>/` (`meta.json` + `graph.json` + `files-N.json` chunks)
4. Starts a file watcher — index stays live for the entire daemon session, no restarts needed

On a repo like Apache Kafka (~6k Java files) expect ~22s and ~42k edges on first run; subsequent starts load from cache instantly.

---

## Development

```bash
npm install
npm run build
node dist/index.js --root /path/to/project --no-daemon

npm test
npm run test:watch
npm run dev          # watch mode for TypeScript
```

To test against a live MCP client:
```bash
npx @modelcontextprotocol/inspector node dist/index.js --root . --no-daemon
```

`--no-daemon` is recommended during development — it keeps the index in the same process so logs, breakpoints, and crashes are visible.

---

## Tool reference

coldstart exposes **two** tools. `get-overview` finds the files; `get-structure` tells you everything about one file — its shape, what it imports, and who uses it. The older `trace-deps` and `trace-impact` tools are gone; their jobs (file-level import graph, symbol-level callers/implementors/extenders) are now folded into `get-structure`.

### `get-overview` (GO)

Locate files by matching your query against **declared names** — filenames, directory path segments, and exported symbol names. GO does not match file *bodies* (comments, docstrings, string literals, template/HTML/SQL content); for those, grep is the right tool.

Required params:
- `query` (string) — concept tokens for what you're looking for. Bare words are AND logic; bracket groups are OR synonyms: `"[auth|login|jwt] payment"` = any auth synonym AND payment. Naming-variant tolerant — case, separators, and plural ≡ singular are handled automatically (`LoadStaging` ≡ `load_staging` ≡ `load-staging`; `tile` ≡ `tiles`). (`domain_filter` is still accepted as a deprecated alias.)

Optional params:
- `max_results` (number, default 10) — page size. Don't raise this to "see more" — refine the query or lift a rare `[matched]` token into the next query instead.
- `include_tests` (boolean, default false) — include test files (excluded by default).
- `path` (string) — minimatch-style glob to scope where to look (`"arches/app/**/*.py"`, `"src/auth/**"`). Comma-combine; prefix `!` to exclude. Filters before ranking.
- `page` (number, default 1) — results page. Prefer reformulating `query` over paging deep.

Output: one result per line as `<path> [tok1, tok2, ...]`. The bracketed tokens are the indexed name tokens that matched, sorted rarest-first — the leftmost are the highest-signal identifiers (rare enough that grepping them reliably finds usages). If your query words don't appear in any `[matched]` list, the concept isn't in any declared name (it lives in bodies/strings/templates) — switch to grep rather than reformulating GO.

### `get-structure` (GS)

Drill into a single known file. This is the right tool for **"what's in this file"**, **"who does this file import"**, and **"who uses this file / who calls this symbol"** — no separate call needed.

Required params:
- `file_path` (string) — the file to inspect.

Optional params:
- `view` (string, default `full`) — which sections to return. `full` = all four below. Narrow to one section to save bytes: `symbols` (shape only, no callers), `imports` (outbound only), `importers` (inbound only), `callers` (per-symbol cross-file callers, expanded).
- `match` (string) — filter all sections by name. Substring (case-insensitive) by default; `|` ORs substrings (`"resource|tile"`); wrap in slashes for regex (`"/^handle/"`). Use on god-files to avoid a wall of output.

The `full` view returns four compact sections:
- **Symbols** — top-level symbols + per-class methods (`kind name [startLine-endLine]`, with `extends`/`implements`). Each exported symbol is annotated with its cross-file callers (inline if one, a newline-per-caller block if several). For huge files (>20 symbols, no `match`), symbols are reordered most-used-first and truncated to the top 15.
- **Imports** — 1-hop internal outbound dependencies (external/library imports stripped).
- **Importers** — 1-hop reverse: files in this repo that import this one (capped at 20).
- (Callers are shown inline with symbols in `full`; request `view: "callers"` for the expanded per-symbol form.)

Use this AFTER `get-overview` surfaces a candidate file. Prefer it over `Read` when you need shape, neighbors, or usage — reach for `Read` only for implementation details inside a method body.

**Caller-resolution confidence:**
- `calls` edges are resolved cross-file for named function/constant calls — if `login` in `auth.ts` calls `hashPassword` exported from `utils.ts`, that edge is fully qualified and appears in the callers.
- Member-expression calls (`this.method()`, `api.method()`) collapse to the property name and are not cross-file resolved — they won't appear unless a same-file symbol matches the name.
- Nested functions one level deep inside components/functions are indexed (e.g. `UserProfile.handleSubmit`). Deeper closures are not.
- Inheritance (`extends`/`implements`) chains are fully resolved.

---

## Supported languages and frameworks

TypeScript, JavaScript, Vue, Svelte, Astro, AngularJS 1.x, Java, Ruby (with Rails-aware edges: `has_many`/`belongs_to` associations, `routes.rb` resources, controller↔views), Python, Go, Rust, C#, PHP, Kotlin, C++, GraphQL, YAML, TOML, XML, Groovy (including Gradle DSL), `.env` files.

**Not indexed:** Swift, Dart — no extension mapping; these file types are not walked or parsed.

---

## CLI flags

```txt
--root        Fallback project root directory (default: .). Ignored if the MCP client provides a workspace root.
--exclude     Additional directory names to skip (repeatable)
--include     Restrict walk to subdirectory (repeatable)
--cache-dir   Override cache directory (default: ~/.coldstart/indexes/)
--quiet       Suppress stderr logging (including parse progress output)
--no-cache    Skip reading/writing the disk cache and always build a fresh index.
              The live file watcher still runs — only disk persistence is disabled.
--no-daemon   Run as a single stdio process. No background daemon, no port, no
              lockfile. Useful for development, debugging, or restricted environments.
--daemon      Internal flag. The bridge spawns a child with this flag to run the
              daemon HTTP server. You should not need to pass it manually.
```

---

## Live index updates

Once the daemon is running, the index stays current automatically — no restarts required.

1. A recursive `fs.watch` listener runs on the project root (native Node.js, no extra deps).
2. Events are debounced over a 400 ms window and deduplicated by path.
3. Only files whose extension maps to an indexed language are considered (SVG, JSON, CSS, images, etc. are ignored).
4. A SHA-256 content check filters out false-positive events (editor atomic saves, `git checkout` mtime touches).

**Decision after the debounce settles:**

| Changed files | Action |
|--------------|--------|
| 0 (no real content change) | No-op |
| 1 – 30 | Incremental patch (~2–5 ms per file) |
| > 30 | Full rebuild in background |
| Git HEAD changed | Full rebuild always |

During a full rebuild, tool calls are served from the previous snapshot. Changes that arrive mid-rebuild are collected and applied as a follow-up patch — no changes are silently dropped.

---

## Cache behavior

Indexes are stored at `~/.coldstart/indexes/<basename>-<hash>/`, split into three artifact types:
- `meta.json` — schema version, root path, git HEAD, file count, timestamp. Written last as an atomic commit marker; read first on startup to decide whether the rest of the cache is worth loading.
- `graph.json` — file-level and symbol-level edges, adjacency maps, token document frequencies.
- `files-N.json` — per-file metadata (exports, imports, symbols, domain map) in chunks of 5,000 entries. Large repos produce multiple chunks (`files-0.json`, `files-1.json`, …). Chunks are written in parallel alongside `graph.json`; `meta.json` is committed last.

The cache is reused when:
- `CACHE_VERSION` matches the running binary
- Git HEAD has not changed since the index was built

Bumping `CACHE_VERSION` (in `src/constants.ts`) auto-invalidates every cache on the next run. The cache TTL is **24 hours** and acts as a safety net only — the file watcher is the primary freshness signal during an active daemon session.

To force a fresh index for a single run, pass `--no-cache`. To wipe everything for a clean slate, remove `~/.coldstart/`.

---

## Limitations

1. Dynamic/computed import patterns (e.g., `import(variable)`) may not be resolved.
2. It is a routing layer, not a behavior summarizer — no semantic analysis or code summaries.
3. Hidden directories and files over 1 MB are skipped by default.
4. Barrel detection (TS/JS only) uses re-export ratio; non-TS/JS barrel-style files are not detected.
5. Swift and Dart are not indexed — they have no extension mapping and are not walked.
6. `get-structure` caller edges: member-expression calls (`this.method()`, `api.method()`) are not cross-file resolved — these callers won't appear under a symbol. Named function calls matched to an import are fully resolved.
7. The daemon is per-project and per-machine. Each project root gets its own daemon process and its own in-memory index — there's no sharing across projects. And the daemon binds to `127.0.0.1` only, so two machines accessing the same project (e.g. via NFS) each spin up a separate daemon.
