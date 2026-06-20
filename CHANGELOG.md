# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - Unreleased

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
- **`init` rewritten around a single `coldstart.md`.** `coldstart init` writes one
  `coldstart.md` (CLI or MCP flavor) at the repo root carrying all agent guidance;
  Claude Code gets `@coldstart.md` wired into `CLAUDE.md`, other apps wire it
  manually. No per-IDE rules files, no skill. `init` also warms the index in the
  background so the first lookup is instant.

### Fixed
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
