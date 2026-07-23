# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.4] - 2026-07-23

### Changed
- **Package metadata now says "memory."** The npm `description` and `keywords` still
  carried the pre-2.0 "fast static navigation" framing and contained no *memory* token
  at all, so npm search — and the aggregators that crawl those fields — had nothing to
  match "codebase memory" or "agent memory" against. Both now lead with the notebook and
  name the supported clients. No behaviour change.

### Added
- **`server.json` — listing in the official MCP registry.** `registry.modelcontextprotocol.io`
  is the canonical index MCP-aware clients enumerate. Publishing there requires an
  `mcpName` in `package.json` that the registry validates against the *published npm
  tarball*, so the entry can only reference a version that already exists on npm — which
  is why this ships as its own release.

## [2.2.3] - 2026-07-22

### Added
- **`/capture-notes` — capture notes on demand.** Capture is trigger-timed, but you
  sometimes know a moment is worth recording before the score crosses the threshold —
  a hard-won debugging insight, a confirmed absence, a decision that didn't touch many
  files. `/capture-notes` fires the *same* capture flow immediately: same worklist, same
  checklist, only the trigger threshold is skipped. It never forces a write — the agent
  still decides what (if anything) is worth a note. Wired by `coldstart init` for all
  three clients: a `/capture-notes` slash command for **Claude Code** and **Cursor**, and
  a repo-scoped `capture-notes` **skill** for **Codex** (invoke with `$capture-notes`) —
  Codex's custom prompts are global and deprecated, so a skill is the supported surface
  there. `coldstart unwire` removes all of them. Runs by hand too:
  `node <install>/hooks/kb-elicit.mjs --manual`.

  Implemented as a `--manual` branch on the existing capture hook rather than a second
  capture path: with no hook stdin it self-discovers the session (the freshest marker
  whose recorded files resolve under the root, which also prevents picking up another
  repo's session) and is **read-only on that marker**, so an on-demand capture can never
  perturb automatic firing.

## [2.2.2] - 2026-07-22

### Fixed
- **Notebook capture fires reliably again.** The Stop-hook trigger had over-tightened:
  descent required *two* consecutive quiet stops and a prose-heavy "synthesis" turn
  counted as *active*, so on real sessions capture never descended and collapsed onto
  the git-HEAD-drift path alone. Descent now needs a single quiet stop
  (`DESCENT_QUIET = 1`), synthesis turns count as quiet, and the redundant surge path
  was removed. (#83)
- **Subagent capture no longer silently skips workflow-nested transcripts.** Claude
  Code writes parallel/batched subagent transcripts under
  `subagents/workflows/wf_*/agent-<id>.jsonl`; the resolver only looked at the flat
  `subagents/agent-<id>.jsonl` path and logged `subagent-transcript-missing`. It now
  resolves both layouts recursively and skips compaction (`acompact*`) agents. (#83)
- **Resume no longer dumps a diluted capture blob.** When the OS cleared the tmp
  session marker (e.g. a session resumed days later) and the transcript was already
  large, the hook reprocessed the entire history as this-turn work and cap-fired an
  over-broad worklist. A fresh marker meeting a >400-line transcript now baselines the
  offset instead. Also fixes an off-by-one where a trailing empty split element
  inflated the stored line count and dropped the first line of the next slice. (#83)

### Added
- **`coldstart status` reports install health.** It prints the installed version and
  warns when a keeper is running an older version than the installed binary
  (remedy: `coldstart restart`) or when a repo's wired hook paths no longer exist
  because a node/nvm or npm-prefix change moved the global install
  (remedy: `coldstart init`). Turns "the update didn't take" into a one-command
  diagnosis.
- **The notebook `kb view` stays live.** Once `index.html` has been generated, the
  background keeper re-renders it whenever notes change, so a plain browser reload
  shows the latest — no need to re-run the command. The file is never created
  automatically; that stays the explicit `kb view`.

## [2.2.1] - 2026-07-18

### Fixed
- **Notebook capture now survives Claude Code `/compact`.** The Stop-hook capture
  pipeline slices the session transcript by a stored line offset. `/compact`
  rewrites the transcript to a far shorter compacted version, so the stored offset
  pointed *past* the new end — `slice()` returned empty and every subsequent turn's
  evidence was silently dropped (files stayed `captured`, the trigger never
  re-armed) for the rest of the session. A shrink guard now resets the offset when
  the transcript is shorter than expected, reprocessing the compacted transcript
  from its start. (#81)
- **`init` no longer skips Claude wiring when `CLAUDE.md` only *mentions*
  `@coldstart.md` in prose.** The `wireClaudeImport` idempotency check matched the
  import substring anywhere in the file, so a prose reference counted as "already
  wired" and the real import was never added. The check is now per line. (#80)

## [2.2.0] - 2026-07-18

### Changed
- **Trigger-timed notebook capture (v5).** The always-fire Stop gate is gone. Every
  Stop updates per-file evidence records (edit/read/gs tiers; mentions and
  `.coldstartignore`'d files never count) and advances a trigger state machine
  (score = uncaptured reads + 2×settled edits + active stops; arm at 10, fire on
  descent / surge / cap). Most stops exit silently. Descent and surge fire
  **non-blocking** — the capture payload is delivered with the user's next prompt
  via the recall hook, so the stop itself is never interrupted; only a git-HEAD
  drift (a manual commit boundary) blocks. `.coldstartignore` moved under
  `.coldstart/`. Cursor, Codex, and the MCP `kb_write` surface were brought to v5
  parity. (#77, #79)

## [2.1.1] - 2026-07-13

### Fixed
- **Recall now surfaces a note when the prompt names its file path.** The recall
  hook (`kb search --hook`, the `UserPromptSubmit` injector) previously stayed
  silent when a user asked about a file directly — e.g. *"what does
  `arches/urls.py` do"* — even when a fresh, on-point note existed. Two causes:
  `parseTerms` splits on `.` and whitespace but **not `/`**, so a `/`-glued path
  fails its alnum token filter and is discarded (and a sub-3-char extension like
  `py` is dropped) — a bare path yields zero terms; and even space-separated, a
  path's words are common in a themed notebook and fail the hook-mode rarity gate.
  A **path-name override** now admits any note whose anchor path appears in the
  (squash-normalized) prompt as a strong, discriminating hit that bypasses the
  rarity and suppression gates and leads its freshness tier. Scoped to recall
  only — `find` and tool-mode `kb search` are unchanged. A minimum path length
  keeps trivially short paths from grazing arbitrary prose. (#75)

## [2.1.0] - 2026-07-12

### Changed
- **WASM-only parse engine — `node-tree-sitter` dropped entirely.** Every grammar
  now parses on **web-tree-sitter (WASM)**; the native `tree-sitter` core and all
  14 native grammar packages are removed from `package.json`. `.wasm` grammars are
  inert data — no node-gyp, no install scripts, no per-grammar peer-dep — so the
  whole native-build problem class is retired at once: the peer-dependency install
  hang, npm 12's install-script/node-gyp block, and the kotlin prebuild gap. All 15
  grammars are vendored in `vendor/wasm/` (12 copied from the grammar packages' own
  shipped wasm; c#/kotlin/xml built from source). Behaviour is byte-identical to the
  native engine (proven on ~12 repos with the natives pruned from `node_modules` —
  edge counts match exactly) and 1.3–3.6× faster through the walk-heavy parse+extract
  phase. **This makes coldstart a plain `npm i` package — the `--legacy-peer-deps`
  flag is no longer needed once this ships to npm.** (#68, supersedes the opt-in
  `COLDSTART_WASM=1` prototype in the closed #67.)

### Added
- **`coldstart unwire` — the reverse of `init`.** `npm uninstall` can't clean the
  per-repo artifacts `init` writes (npm fires no reliable pre/postuninstall, and a
  global uninstall has no registry of inited repos), so — like husky — coldstart
  ships an explicit reverse command. It strips only coldstart-owned markers from the
  files `init` touched (reusing `init`'s own idempotency detectors, so removal is
  symmetric with how it writes), never clobbering user content in shared files:
  hook entries, the `@coldstart.md` import, the `AGENTS.md` block, the
  `[mcp_servers.coldstart]` table, and fully-owned files (`coldstart.md`,
  `.cursor/rules/coldstart.mdc`). All four clients are swept unconditionally. The
  **notebook is kept by default** (committed/shared user data); `--purge` also
  deletes `.coldstart/notebook/` and its git plumbing. Idempotent — a second run
  reports all-absent and exits 0. (#69)

### Changed
- **Tighter notebook capture prompt (flow notes + partial-read guard).** A 22-flow
  audit on a real human-use notebook found ~32% of flow notes were feature
  inventories, single-file mechanisms, or bare call-chains, and ~3% of file notes
  overclaimed from partial reads. The elicit prompt now fires a **flow** note on what
  the repo *is* (the relationship between files is itself the knowledge), not what the
  session did — gated on naming the one fact a reader of all the file notes would still
  miss, and leading the flow's summary with it — with an explicit never-a-flow list
  (feature parts-list, one-file mechanism, gotcha-free chain). New rules forbid
  asserting a method/branch/config key not verified this session or describing a file
  not actually read. All clients inherit via the shared detector core. (#70)
- **Long-session capture no longer drops notes; search checkpoint gated on writes.**
  The capture hook's once-per-session marker became a per-file session delta, so a long
  chat that reads many files still elicits a note at the end; the search-quality nudge
  now fires only when a git-fingerprint write actually happened. (#64)

### Internal
- Grammars are loaded via **static imports** so a bundler (bun) can embed them,
  ahead of the WASM cutover. (#65)
- Added a Google Analytics (GA4) tag to the marketing site's home and docs pages. (#66)

## [2.0.3] - 2026-07-10

### Changed
- **Unified install + setup docs; inline guidance for Cursor & Codex.** `init` now
  embeds the full coldstart guidance **inline** in the client's own rules file for
  Cursor (`.cursor/rules/coldstart.mdc`) and Codex (`AGENTS.md`) — neither resolves
  `@file` references — instead of a separate `coldstart.md` they'd never read. Claude
  Code and Other still get `coldstart.md` + an `@coldstart.md` import. Install and
  setup instructions unified across README, site, and the generated guidance. (#63)

## [2.0.2] - 2026-07-10

### Added
- **Branch-reactive notebook notes.** Notes now react to the checked-out branch:
  anchors absent on this branch are demoted (the note isn't served as truth for code
  that isn't here), and byte-exact file renames are followed so a moved anchor keeps
  its freshness instead of going stale. (#58)

### Changed
- **Capture gated on task durability across all host hooks.** A note is elicited only
  after a session did real, durable work — not on trivial or aborted turns — uniformly
  across the Claude/Codex/Cursor capture hooks. (#59)
- **Site redesign** — dark, terminal-native home page, new snowflake logo, docs reskin,
  and SEO metadata. (#60)
- **README leads with self-maintaining knowledge** — the pitch opens on the notebook
  (durable, agent-written, freshness-checked) rather than navigation alone. (#62)

### Fixed
- **Subagent capture restates its deliverable last.** On `SubagentStop`, the capture
  hook's block-decision message was becoming the subagent's last message — so a finder
  subagent returned "no note" instead of its findings and the parent re-asked. The hook
  now restates the deliverable last on `SubagentStop` only. (#61)

## [2.0.1] - 2026-07-09

### Changed
- Moved the **Install** section to the top of the README (right after the intro),
  ahead of the conceptual sections.
- Added a `homepage` field pointing to the docs site
  (https://akashgoenka.github.io/coldstart/) and a `bugs` issues link, so the npm
  package page links to the site instead of falling back to the repo.

### Fixed
- Bumped the transitive `fast-uri` dependency `3.1.2 → 3.1.3` (CVE-2026-13676).
  Not exploitable here — `ajv` uses it only for JSON-Schema `uri`-format validation,
  not host-based security decisions — but this clears the Snyk alert.

## [2.0.0] - 2026-07-08

Major release. The package is renamed, the CLI is now the primary surface, and the
process model is rebuilt around a single background keeper with stateless readers.

### Changed (BREAKING)
- **Package renamed `coldstart-mcp` → `@cstart/coldstart`.** The CLI is the primary
  surface now; MCP is the no-shell fallback. `coldstart-mcp` on npm is deprecated and
  points here. The `coldstart` and `coldstart-mcp` binary names are both retained, so
  the CLI command is still `coldstart` and existing MCP configs keep working. Migrate with
  `npm uninstall -g coldstart-mcp && npm install -g @cstart/coldstart --legacy-peer-deps && coldstart init`.
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
