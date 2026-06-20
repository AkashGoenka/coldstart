# coldstart

Fast codebase navigation for AI agents. It answers one question: **which files are relevant to this task?**

No embeddings, no model to run, no service to babysit. Just a static index over your codebase — file paths, symbol names, exports, and the import/call graph — built once and queried in milliseconds. Agents are already good at reading and reasoning about code; what they waste tokens on is *finding* the right file. coldstart does that part, hands the file off, and gets out of the way.

**Two operations. Two surfaces (CLI + MCP). One background process that keeps the index fresh.**

---

## The two operations

| | What it answers | Replaces |
|---|---|---|
| **`find <terms>`** | "Which files are about this?" — ranks files by how many of your query terms they cover (filenames, path segments, exported symbols, plus a repo-wide name-reference pass). | a flurry of `grep`/`glob` while orienting |
| **`gs <file>`** | "What is this file?" — top-level symbols with line ranges, who imports it, who calls each symbol, and name-related neighbors. | reading a whole file just to learn its shape and usage |

The intended flow: **`find`** a concept → pick the best path → **`gs`** that file for its shape and who uses it → `Read` only for the implementation inside a method body.

---

## Two ways to call it, identical output

coldstart ships as one binary with two front doors:

- **CLI (primary)** — `coldstart find …` / `coldstart gs …`. For any shell-capable agent (Claude Code, Cursor, terminal use). This is the fast path.
- **MCP (for no-shell clients)** — the `find` and `gs` MCP tools, byte-identical output. For clients like Claude Desktop that have no shell.

Same engine, same index, same results. Pick whichever your agent can reach.

---

## Install

Requires Node.js 18+.

```bash
npm install -g coldstart --legacy-peer-deps
cd your-project
coldstart init
```

`init` writes a single `coldstart.md` at your repo root (the agent-facing guidance) and wires it in:

- **Claude Code** → ensures `CLAUDE.md` imports it via `@coldstart.md`.
- **Any other app** → writes `coldstart.md` only, and prints the MCP server entry to paste into your client's config.

It then warms the index in the background, so your first lookup is instant. Re-running `init` is safe — it never duplicates entries.

> **Why `--legacy-peer-deps`?** The tree-sitter grammar packages under-declare their peer-dep ranges (some say `^0.21.x`, others `^0.22.x`). Without the flag npm's strict resolver enters a long retry loop on a cold cache and can appear to hang. The flag tells npm to use our tested versions as-is. We can't set it from inside the package — npm reads install config only from your environment.

### Upgrading

```bash
npm install -g coldstart@latest --legacy-peer-deps
coldstart init   # re-run in each project to refresh coldstart.md
```

A version stamp in the keeper's lockfile makes the old background keeper shut down on the next lookup; a fresh one spawns from the new binary. No manual restart needed.

> **Migrating from `coldstart-mcp`:** the package was renamed `coldstart-mcp` → **`coldstart`** at 2.0.0 (the CLI is now the primary surface). `coldstart-mcp` is deprecated but still installs; switch with `npm uninstall -g coldstart-mcp && npm install -g coldstart --legacy-peer-deps && coldstart init`. The `coldstart-mcp` binary name is kept as an alias, so existing MCP configs keep working.

---

## Using it

### `find` — locate the files for a concept

```bash
coldstart find auth session cookie
```

Pass **every salient identifier** from your task — the symbol, the domain noun, the rare token you half-remember — not one distilled keyword. `find` ranks files by how many of your terms each one covers and shows, per file, which terms it defines vs. imports and a preview of the lines where they cluster. Often that's enough to answer without opening anything.

**Flags:**
- `--path GLOB` — scope to a glob (`--path 'app/**/*.py'`); comma-combine, `!` to exclude.
- `--tests` — include test files (excluded by default).
- `--via` — show the name-reference relations (`near` edges) that the import graph can't see.
- `--json` — machine-readable output.

### `gs` — drill into one file

```bash
coldstart gs src/auth/service.ts
```

Returns the file's symbols (with line ranges), its 1-hop internal imports, who imports it, and per-symbol cross-file callers — in one call. This is the answer to **"who uses this file / who calls this symbol"**; it is not a grep.

**Flags:**
- `--symbol a,b` — deliver the named method bodies inline, plus their caller/callee pointers.
- `--match TERM` — on a god-file, filter to one area (`--match tile`); `a|b` = OR, `/regex/` = regex.
- `--view symbols|imports|importers|callers` — return one section instead of the full page (`full` is the default).
- `--json` — machine-readable output.

### Batch independent lookups in one shell call

```bash
coldstart find auth; coldstart find 'session cookie'; coldstart gs src/auth/service.ts
```

---

## How it stays fresh

coldstart is **one keeper, thin readers**:

```
            ┌─────────────────────────────────────────────┐
            │  keeper  (coldstart --daemon)                │
            │  watches repo → patch/rebuild → save cache   │   ← keeps the cache fresh, serves nothing
            └───────────────────────┬─────────────────────┘
                                    │ on-disk cache
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
  coldstart find            coldstart gs                  MCP server
  (reads cache, prints)     (reads cache, prints)   (reads cache, stdio to client)
```

- A single **keeper** process per repo watches the filesystem and keeps the on-disk cache current. It does **not** answer queries.
- The CLI readers (`find`/`gs`) and the MCP server are **stateless readers** over that cache. The first reader for a repo lazily spawns the keeper, so even uncommitted edits stay live.
- No HTTP, no ports, no bridge. The keeper logs to `~/.coldstart/daemon/<root>.log` and exits when its lockfile is removed.

Edits are debounced (400 ms), then **patched incrementally** (≤30 changed files, ~2–5 ms/file) or trigger a **background full rebuild** (>30 files, served from the last good index until the swap). The cache re-saves ~5 s after edits settle. Branch switches / large pulls force a rebuild via a git-HEAD check.

### Lifecycle commands

```bash
coldstart status         # list keepers on this machine: alive? index freshness?
coldstart restart        # kill the current repo's keeper (respawns on next lookup)
coldstart restart --all  # kill every keeper
coldstart index          # build + save the cache once, up front (single-writer prep)
```

`restart` is the right move whenever anything feels stale — a fresh keeper reloads the cache (or rebuilds if missing). `status` also covers the old "is my index fresh?" check: it reads the cache `meta.json` mtime, no network probe.

---

## Supported languages

TypeScript, JavaScript, JSX/TSX, Vue, Svelte, Astro, AngularJS 1.x, Java, Kotlin, Ruby (Rails-aware: `has_many`/`belongs_to` associations, `routes.rb` resources, controller↔view edges), Python (Django convention edges), Go, Rust, C#, PHP (Laravel convention edges), C++, Groovy (incl. Gradle DSL), GraphQL, YAML, TOML, XML, and `.env` files.

**Not indexed:** Swift, Dart — no extension mapping; these files are not walked or parsed.

---

## When *not* to reach for it

- A literal string / phrase / regex inside file bodies → **Grep**.
- Reading an implementation → **Read**, after `gs` gives you the shape.
- `find` says *"no indexed file contains any of […]"* → those identifiers aren't in the repo. Don't grep spelling variants.

---

## Development

```bash
npm install
npm run build
npm test

# run a query from your build:
node dist/index.js find auth --root .

# run the MCP server in a single process (no background keeper) for debugging:
node dist/index.js --root . --no-daemon
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the index pipeline and process model, and [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for recovery procedures.

---

## Limitations

1. It's a routing layer, not a behavior summarizer — no semantic analysis or code summaries.
2. `gs` callers are one-hop and file-scoped. Member-expression calls (`this.method()`, `api.method()`) aren't cross-file resolved; named function/constant calls are. Chase further hops by calling `gs` on the caller files.
3. Dynamic/computed imports (`import(variable)`) and runtime-DSL references (polymorphic associations, gem/reflection-backed models) stay unresolved.
4. Hidden directories and files over 1 MB are skipped.
5. The keeper is per-repo and per-machine — no sharing across projects or hosts.

## License

MIT
