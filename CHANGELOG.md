# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-08

Major release. The package is renamed, the CLI is now the primary surface, and the
process model is rebuilt around a single background keeper with stateless readers.

### Changed (BREAKING)
- **Package renamed `coldstart-mcp` → `coldstart`.** The CLI is the primary surface
  now; MCP is the no-shell fallback. `coldstart-mcp` on npm is deprecated and
  redirects here. The `coldstart-mcp` binary name is retained as an alias, so
  existing MCP configs keep working. Migrate with
  `npm uninstall -g coldstart-mcp && npm install -g coldstart --legacy-peer-deps && coldstart init`.
- **Tools/commands renamed to `find` + `gs`** (matching the CLI verbs):
  `get-overview` → `find`, `get-structure` → `gs`. Exposed identically as CLI
  commands (`coldstart find` / `coldstart gs`, the primary path) and as MCP tools
  (`find` / `gs`, for no-shell clients) with byte-identical output.
- **Tool surface reduced from 4 to 2.** `trace-deps` and `trace-impact` are gone;
  their jobs (file-level import graph, symbol-level callers/implementors/extenders)
  fold into `gs`. A single file-scoped `gs` call returns symbols (with per-symbol
  cross-file callers), 1-hop outbound imports, and reverse importers. `view` takes
  `full` (default) / `symbols` / `imports` / `importers` / `callers`.
- **One keeper, thin readers — the HTTP-serving daemon is removed.** The background
  process (`coldstart --daemon`) now *only* keeps the on-disk cache fresh
  (watch → patch/rebuild → save); it serves nothing. `find`/`gs` and the stdio MCP
  server are stateless readers over that cache, lazy-spawning the keeper. No more
  bridge, HTTP server, or port. The lockfile drops `port`; `status` is HTTP-free
  (lockfile PID + cache `meta.json` mtime); the `doctor` command is removed (its
  "is my index fresh?" job is covered by `status`).
- **`init` rewritten around a single `coldstart.md`, multi-client.** `coldstart init`
  asks two things — experience (`cli`/`mcp`) and client (`claude`/`cursor`/`codex`/
  `other`, never auto-detected) — and writes one `coldstart.md` at the repo root
  carrying all agent guidance. **Claude Code, Codex, and Cursor are all first-class**
  — each gets platform-specific find/gs navigation hooks plus notebook recall/capture
  hooks: Claude via `.claude/settings.json`, Codex via `.codex/hooks.json` (with an
  `AGENTS.md` section), Cursor via `.cursor/hooks.json` (with a `.cursor/rules/coldstart.mdc`
  rule). Other clients get `coldstart.md` + printed directions. All writers merge
  idempotently. `init` also warms the index in the background so the first lookup is instant.
- **Cache format v18 — consumer-scoped, gzipped, generational.** The single giant
  JSON blob is replaced by gzipped segments split by consumer (find / gs / keeper)
  over an interned file table, written in atomic **generations** (`meta.json` names
  the current one and is written last; the previous generation is kept). Readers
  load a **profile** — `find` loads a fraction of what the keeper needs — and can
  never persist a partial index or read a mixed-generation cache. Old caches
  auto-invalidate on first run. Measured on a 16k-file repo: disk 132 → 8.9 MB,
  load 885 → ~350 ms.
- **The cache TTL is removed.** Time never invalidates a correct index. Validity is
  now format version + git HEAD + startup reconcile + the live watcher (see Added).

### Added
- **Startup reconcile — the index is always fresh, without a TTL.** When the keeper
  starts, it stat-checks every indexed file against a `[mtime, size]` fingerprint
  stamped at parse time (~100–200 ms for 16k files) and diffs git against the
  indexed HEAD (untracked via porcelain; non-git repos fall back to a walk), then
  **patches** exactly what changed while nothing was watching. A branch switch that
  used to force a 96 s rebuild on a 16k-file repo is now a ~3 s patch.
- **Readers never build.** `find`/`gs`/MCP wait for the keeper's cache on a miss
  (progress to stderr) and for its reconcile re-save on git-HEAD drift, instead of
  silently running a full build inline — possibly several concurrently. In-process
  build survives only as the no-keeper fallback and `coldstart index`.
- **Ripgrep recall engine.** `find`'s repo-wide reference scan resolves a real
  ripgrep — `COLDSTART_RG` → PATH → bundled `@vscode/ripgrep` → editor-app copies —
  verifies it, and persists the winner in `~/.coldstart/searcher.json` (stat-revalidated,
  auto-re-resolved on failure). Fallbacks: `git grep` → `grep` → pure-Node scan.
  Warm `find` on a 16k-file repo: ~3.8 s → ~2 s, parity with a raw `rg` sweep.
- **Self-checking index.** After every incremental patch the index is linted against
  structural invariants (edge endpoints exist, adjacency mirrors edges, …); a
  violation triggers an automatic rebuild. After every save a rotating 50-file
  fingerprint audit catches watcher-missed events and re-patches the drift.
- **Keeper observability.** `keeper-state.json` (last reconcile/patch/rebuild/save)
  and `repair.jsonl` (append-only failure log, 256 KB cap, survives restarts) are
  written beside the cache; `coldstart status` renders both. `coldstart restart`
  gains `--root <dir>`. The patch threshold now scales with repo size
  (max(30, 20% of indexed files)).
- **Notebook (experimental): `coldstart kb`.** A repo-local, agent-written knowledge
  base under `.coldstart/notebook/` — append-only `.raw` log as source of truth,
  derived Markdown notes, anchor-freshness stamps from the index (a keeper-derived
  `kb-notes.json` sidecar; `kb search` never loads the code index), two-phase
  `kb write` (candidates → `--into <id>` or `--new`), plus capture/recall hooks
  wired by `init` for Claude Code, Codex, and Cursor. The read/write surface is also
  exposed as MCP tools (`kb_search` / `kb_lookup` / `kb_write` / `kb_status`) for
  no-shell clients; `kb commit` stays CLI/human-only. Verbs: `search` / `lookup` /
  `write` / `commit` / `status` / `lint` / `render` / `view` / `init` / `migrate`
  (`kb view` opens a single-file HTML browser of the notebook).
- **`gs` returns the enclosing method body on a `--match`/`--symbol` miss** instead
  of an empty result.
- **Navigation + notebook hooks wired by `init` (Claude Code, Codex, Cursor).**
  A PostToolUse/`postToolUse` nudge that flags search behaviour going wrong, a
  PreToolUse/`preToolUse` guard that denies an exact `find` re-run, plus notebook
  capture (session/subagent end) and recall (prompt time). Merged idempotently —
  every other setting and any foreign hooks are preserved; a malformed config is
  left untouched. The handlers are surface-agnostic: a shared `normalizeColdstartCall`
  rewrites an MCP `find`/`gs` call into the equivalent CLI command string, so the
  detectors run unchanged whether the agent reached coldstart via the CLI or the MCP
  tools. Claude/Codex/Cursor share one protocol-neutral detector core, differing only
  in input adaptation, transcript walk, and output envelope. Hooks point at the running
  install (`installRoot()`) — no version-pinned copy — so `npm update` is picked up
  automatically and `npm uninstall` disables them. The hooks ship in the package (`hooks/`).

### Fixed
- **Keeper could outlive a deleted/taken-over lockfile.** `fs.watch` can miss the
  lockfile delete event, leaving an orphan keeper co-writing the cache with its
  replacement. The keeper now also polls its lockfile (30 s) and exits when the file
  is gone or names a foreign PID.
- **Hidden/excluded dirs leaked into the index via patch.** The watcher and
  reconcile's porcelain pass could feed `patchIndex` paths the walker would never
  visit (`.claude/settings.json`, `.coldstart/` notebook writes, `node_modules/`).
  The patch now mirrors the walker's directory rules. Regression test:
  `tests/patch-hidden-dirs.test.ts`.
- **Stale-HEAD reader stalls.** Two paths could save a cache whose recorded git HEAD
  predated a checkout (reconcile-clean-with-drift, and the live-watcher path), making
  every subsequent reader wait out the full drift window. HEAD is now refreshed at
  save time.
- **Keeper log was always empty** — the daemon inherited `--quiet` from its spawner;
  it now ignores it (the log is its only observability channel).
- **`find` untracked-file coverage + single-threaded scans.** The grep pass now also
  searches untracked files and runs single-threaded per term — measured faster and
  it stops stealing cores from the agent.
- **Convention-edge freshness on incremental patch.** Editing a single Rails/Django/
  Laravel/C# convention file used to drop that file's synthetic convention edges
  (and reference fields) until the next full rebuild, because the incremental patch
  stripped them and never rebuilt them. `patchIndex` now re-runs the idempotent
  synthetic-edge passes, and a shared `baseIndexedFile()` keeps the buildIndex /
  runProbe / patch construction sites from drifting. Regression test:
  `tests/patch-synthetic-freshness.test.ts`.

### Internal
- Dedup pass: shared tree-sitter node helpers (`extractors/node-helpers.ts`), a
  shared parser factory (`extractors/parser-factory.ts`), and a `MAX_DIR_WALK_DEPTH`
  constant replace ~20 copied helpers, 13 hand-rolled parser singletons, and a magic
  number. Dead code removed (`bridge`, `http-daemon`, `doctor`, `scoring`, `glob`,
  the skill, plus several unused helpers).

## [1.5.0] - 2026-05-22

Resolver-focused release: coldstart reconstructs more of the import/reference graph across more languages, so `get-overview`, `trace-deps`, and `trace-impact` surface relationships that convention-over-configuration frameworks previously hid. All changes are backward-compatible — no config or API changes; reindex happens automatically on startup.

### Added
- **Broader convention-aware resolution.** Frameworks wire much of their coupling by convention (name→file rules resolved at runtime), leaving no import text to follow. This release teaches coldstart those conventions so the edges show up in the graph:
  - **Rails** — synthetic edges for `has_many` / `belongs_to` / `has_one` / `has_and_belongs_to_many` associations (gated to `app/models/`), `config/routes.rb` resource/route → controller edges, and bidirectional controller↔view folder pairing.
  - **Ruby constant autoload** — nesting-aware constant resolution following Ruby's lexical `Module.nesting` lookup. A bare `Invite` inside `module Members` now resolves to `Members::Invite` (e.g. `app/models/members/invite.rb`) instead of missing it or binding to a top-level `Invite` homonym. Same technique as Packwerk's `ConstantResolver` and Shopify's Rubydex.
  - **C# / PHP / Python** — additional convention edges (DI/container resolution, framework reference patterns) and a Python WSGI/ASGI bucket split.
- **JVM same-package short-name qualification (Java + Kotlin).** Bare type references to classes in the same package are now qualified to their fully-qualified name and resolved, recovering intra-package edges that short-name references previously dropped.
- **`trace-impact` call-site line numbers.** `trace-impact` now reports the exact line of each caller/implementor/extender, so you can jump straight to the reference rather than re-scanning the file.

### Changed
- **Resolver hygiene** — consistent Rails fileId conventions and the Python WSGI/ASGI bucket split, plus per-specifier synthetic-edge counts surfaced in `--probe` output for easier auditing.

### Scope & non-goals
- Resolution stays deliberately lightweight: constant/type references only — no method-dispatch tracing, `constantize`/reflection, or polymorphic resolution (the runtime-dynamic tail that's genuinely unrecoverable statically). coldstart is an evidence ranker for navigation, not a replacement for a language server.

## [1.4.4] - 2026-05-13

### Changed
- **Install instructions switched from `npx` to global install.** The recommended setup is now `npm install -g coldstart-mcp --legacy-peer-deps` followed by `coldstart-mcp init`. The previous `npx -y coldstart-mcp@latest init` could hang indefinitely on fresh machines: tree-sitter grammar packages declare conflicting `peerDependencies` ranges (`^0.21.x` vs `^0.22.x`), and npm's strict resolver enters a long retry loop when there's no lockfile to anchor resolution — exactly the condition `npx` creates. We can't set `--legacy-peer-deps` from inside the package (npm reads install config only from the user's environment), so the flag must come from the install command. README + TROUBLESHOOTING updated. No code changes.

## [1.4.3] - 2026-05-12

### Fixed
- **Version-mismatch restart (#1):** Daemon now writes its package version to the lockfile. Bridge compares versions before attaching; on mismatch, old daemon is SIGTERM'd (5s grace, then SIGKILL fallback) and a new daemon spawns. Fixes silent stale-code execution after package upgrades.
- **Cache dir self-heal (#2):** Daemon watches `~/.coldstart/indexes/<x>/` parent and triggers a full rebuild if `meta.json` is deleted (e.g., user runs `rm -rf ~/.coldstart/indexes/<x>/`). Existence-check prevents loop (daemon's own writes don't trigger rebuild).
- **Daemon lockfile auto-cleanup (#6):** Daemon watches `~/.coldstart/daemon/` and exits cleanly if its own lockfile is deleted (e.g., user runs `rm ~/.coldstart/daemon/foo.json`). Prevents zombie daemons consuming ~100MB when lockfile is manually cleaned.
- **Bridge tails daemon log to stderr (#4):** Bridge now watches the daemon's logfile and streams new lines to `process.stderr` in real-time. Daemon startup output (walking, parsing, resolving) is now visible in the IDE's Output panel instead of disappearing to `~/.coldstart/daemon/<x>.log`. The bridge poll-waits up to 5 s for the log file to appear (it's created async by the spawned daemon) and uses positional `readSync` from a tracked offset, so the tailer is event-driven (zero CPU at idle) and never re-reads bytes already streamed. Log rotation is detected via size-shrink and offset resets to 0.

### Added
- **`coldstart-mcp doctor` subcommand (#3):** Health check for the daemon running on cwd. Hits `/status`, reports PASS (exit 0) or FAIL (exit 1) with brief diagnostics (no daemon, stale PID, unreachable HTTP, index build failure).
- **`coldstart-mcp restart [--all]` subcommand (#5):** Kill daemons and clean lockfiles. Without `--all`, restarts the daemon for cwd; with `--all`, restarts all daemons the user has running.

## [1.4.2] - 2026-05-12

### Fixed
- `init` no longer runs a second `npm install --prefix ~/.coldstart/versions/<v>/`. That install hung indefinitely on npm's dep resolver oscillating between `tree-sitter ^0.21` (needed by `@tree-sitter-grammars/tree-sitter-xml` and `tree-sitter-c-sharp`) and `tree-sitter ^0.22` (our direct dep). With no lockfile in an empty `--prefix`, npm's idealTree algorithm cycles 89,000+ `placeDep ROOT` lines without converging.
- `init` now copies the already-resolved `node_modules` from the running install (npx cache, global, or local devDep) into `~/.coldstart/versions/<version>/` via `fs.cpSync`. First-run cost drops from "indefinite hang" to 2–5 s. No network, no compile, no npm involvement.

## [1.4.1] - 2026-05-12

### Fixed
- `npx coldstart-mcp@latest init` crashed with `ReferenceError: __filename is not defined`. The package ships as ESM (`"type": "module"`), where `__filename`/`__dirname` are CommonJS-only. `src/init.ts` and `src/migrate.ts` now derive `__filename` from `import.meta.url` via `fileURLToPath`.

## [1.4.0] - 2026-05-12

### Changed
- `coldstart-mcp init` now writes `.mcp.json` entries using direct `node` invocation against a stable install at `~/.coldstart/versions/<version>/`. Previously used `npx -y coldstart-mcp` which caused MCP startup timeouts on machines where `npm exec`'s integrity-check tax exceeded the 30 s MCP timeout.
- Server auto-migrates legacy `.mcp.json` entries on startup. If your config has `"command": "npx"`, it gets rewritten on first launch (with backup). Opt out via `COLDSTART_NO_AUTO_MIGRATE=1`.

### Why
- Fixes "MCP connection timed out after 30000ms" reported by users on common configurations.
- See `NPX_COLD_START_2026-05-11.md` for the diagnosis.
