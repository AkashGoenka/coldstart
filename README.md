# coldstart

coldstart is a lightweight navigation layer for AI agents.

It answers one question: **which files are relevant to this task?** No embeddings, no graph, no model to run or maintain. Just a fast, static index over your codebase — file paths, symbol names, exports — built once, queried instantly.

Agents are already good at reading code, tracing logic, and reasoning about structure. What they don't need is another system trying to do that for them. coldstart stays out of the way: find the file, hand it off, done.

**4 tools. Minimal context overhead. No infrastructure to babysit.**

---

## Installation

Requires Node.js 18+.

**Run once from inside your project:**

```bash
npx -y coldstart-mcp@latest init
```

This installs coldstart-mcp into `~/.coldstart/versions/<version>/` and writes a `.mcp.json` pointing directly at it. After that, every MCP startup is a direct `node` invocation — fast, no per-session npm overhead.

coldstart detects your IDE (Claude Code or Cursor) and writes the right files automatically:

| IDE | MCP config | Agent rules |
|-----|-----------|-------------|
| Claude Code | `.mcp.json` — merged if exists | `CLAUDE.md` — appended if exists |
| Cursor | `.cursor/mcp.json` — merged if exists | `.cursor/rules/coldstart-mcp.mdc` |
| Neither detected | `coldstart-mcp.json` + `coldstart-rules.md` to copy manually |

Re-running `init` is safe — it never duplicates entries.

### Migrating from a previous version

If your `.mcp.json` was written by an earlier release and uses `"command": "npx"`, you have two options:

1. **Re-run init** (recommended):
   ```bash
   npx -y coldstart-mcp@latest init
   ```

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
npx coldstart-mcp doctor          # is the current project's daemon healthy?
npx coldstart-mcp status          # list every daemon on the machine
npx coldstart-mcp restart         # kill the current project's daemon (next tool call respawns)
npx coldstart-mcp restart --all   # kill every running daemon
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

### `get-overview`

Required params:
- `domain_filter` (string) — One or more keywords relevant to your task. Matched against each file's indexed tokens (derived from filename, path segments, exports, and imports). Bare words are AND logic; bracket groups are OR synonyms: `"[auth|login|jwt] payment"` = any auth synonym AND payment. Pluralization is automatic: `"workspace"` also matches `"workspaces"`.

Optional params:
- `max_results` (number, default 7) — cap on returned files. Don't raise this to "see more" — refine the query instead.
- `include_tests` (boolean, default false) — include test files in results

Returns a ranked list of relative file paths (under `results`). Test files are excluded by default — pass `include_tests: true` to include them.

### `trace-deps`

Required params:
- `file_path` (string)

Optional params:
- `direction`: `imports` | `importers` | `both` (default `both`)
- `depth`: `1-3` (default `1`)

Returns transitive dependency relationships and lightweight metadata per file: path, language, exports (up to 10), and `importedByCount`.

### `get-structure`

Required params:
- `file_path` (string)

Returns a compact text block describing the file's structure:
- Header line with relative path, line count, and `importedBy` count
- `Symbols:` section — one symbol per line with `kind name [startLine-endLine]`, methods indented under their parent class, plus `extends` / `implements` clauses where applicable
- `Imports:` section — internal repo paths only (external/library imports stripped). If a file has more than 15 internal imports, only the count is shown with a pointer to use `trace-deps` for the full list.
- `Next:` pointer suggesting the natural follow-up call (`trace-deps` for importers, `trace-impact` on a symbol, or `Read` for implementation).

Use this AFTER `get-overview` surfaces a candidate file, to decide whether to open it. Prefer this over `Read` when you only need shape or imports.

### `trace-impact`

Required params:
- `symbol` (string)

Optional params:
- `file` (string) — disambiguate when symbol appears in multiple files
- `depth` (1-10, default 3) — max transitive depth to trace

Returns all symbols that directly or transitively depend on the target (with relationship types: `calls`, `extends`, `implements`), full dependency chain paths, summary counts, and affected files list.

Use this to locate where a symbol is defined and find every caller, implementor, and extender without opening their files. Also useful for blast-radius checks before a refactor.

**Confidence notes:**
- `calls` edges are resolved cross-file for named function/constant calls — if `login` in `auth.ts` calls `hashPassword` exported from `utils.ts`, that edge is fully qualified and will appear in impact results.
- Member expression calls (`this.method()`, `api.method()`) collapse to the property name only and are not cross-file resolved — they will not appear in impact results unless a same-file symbol matches the name.
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

During a full rebuild, tool calls are served from the previous snapshot and a `_indexStatus: "rebuilding"` field is added to responses. Changes that arrive mid-rebuild are collected and applied as a follow-up patch — no changes are silently dropped.

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
6. `trace-impact` call edges: member expression calls (`this.method()`, `api.method()`) are not cross-file resolved — these callers will not appear in impact results. Named function calls matched to an import are fully resolved.
7. The daemon is per-project and per-machine. Each project root gets its own daemon process and its own in-memory index — there's no sharing across projects. And the daemon binds to `127.0.0.1` only, so two machines accessing the same project (e.g. via NFS) each spin up a separate daemon.
