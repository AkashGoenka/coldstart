# coldstart

coldstart is a lightweight navigation layer for AI agents.

It answers one question: **which files are relevant to this task?** No embeddings, no graph, no model to run or maintain. Just a fast, static index over your codebase — file paths, symbol names, exports — built once, queried instantly.

Agents are already good at reading code, tracing logic, and reasoning about structure. What they don't need is another system trying to do that for them. coldstart stays out of the way: find the file, hand it off, done.

**4 tools. Minimal context overhead. No infrastructure to babysit.**

---

## Getting started

Requires Node.js 18+.

**Run init from your project root:**

```bash
npx coldstart-mcp@latest init
```

coldstart detects your IDE (Claude Code or Cursor) and writes the right files automatically:

| IDE | MCP config | Agent rules |
|-----|-----------|-------------|
| Claude Code | `.mcp.json` — merged if exists | `CLAUDE.md` — appended if exists |
| Cursor | `.cursor/mcp.json` — merged if exists | `.cursor/rules/coldstart-mcp.mdc` |
| Neither detected | `coldstart-mcp.json` + `coldstart-rules.md` to copy manually |

Re-running `init` is safe — it never duplicates entries.

> **Note on `--root`:** The server auto-detects your project path from the MCP handshake. `--root` is a fallback for older clients or direct CLI use.

---

## How it starts

There is no separate indexing step. On first run coldstart automatically:

1. Walks the filesystem and parses all source files in batches of 100 — progress is logged to stderr every 500 files so you can see it's alive on large repos
2. Resolves imports and builds a dependency graph
3. Caches the index to `~/.coldstart/indexes/<hash-of-root>/`
4. Starts the MCP server over stdio
5. Starts a file watcher — index stays live for the entire session, no restarts needed

On a repo like Apache Kafka (~6k Java files) expect ~22s and ~42k edges on first run; subsequent starts load from cache instantly.

---

## Development

```bash
npm install
npm run build
node dist/index.js --root /path/to/project

npm test
npm run test:watch
npm run dev          # watch mode for TypeScript
```

To test against a live MCP client:
```bash
npx @modelcontextprotocol/inspector node dist/index.js --root .
```

---

## Tool reference

### `get-overview`

Required params:
- `domain_filter` (string) — One or more keywords relevant to your task. Matched against each file's indexed tokens (derived from filename, path segments, exports, and imports). Bare words are AND logic; bracket groups are OR synonyms: `"[auth|login|jwt] payment"` = any auth synonym AND payment. Pluralization is automatic: `"workspace"` also matches `"workspaces"`.

Optional params:
- `max_results` (number, default 10) — cap on returned files
- `include_tests` (boolean, default false) — include test files in results

Returns a compact list of matching files with `path` and `sources` (token sources: filename | path | symbol | import).

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

Returns per-file metadata:
- language, named exports + default export flag
- internal imports (resolved) and external imports
- line count, token estimate, hash
- `importedByCount`, direct imports count
- symbol summary including function signatures, class definitions, methods, interfaces, and type aliases with line numbers

### `trace-impact`

Required params:
- `symbol` (string)

Optional params:
- `file` (string) — disambiguate when symbol appears in multiple files
- `depth` (1-10, default 3) — max transitive depth to trace

Returns all symbols that directly or transitively depend on the target (with relationship types: `calls`, `extends`, `implements`), full dependency chain paths, summary counts, and affected files list.

Use this before refactoring to understand blast radius without reading all dependent files.

**Confidence notes:**
- `calls` edges are resolved cross-file for named function/constant calls — if `login` in `auth.ts` calls `hashPassword` exported from `utils.ts`, that edge is fully qualified and will appear in impact results.
- Member expression calls (`this.method()`, `api.method()`) collapse to the property name only and are not cross-file resolved — they will not appear in impact results unless a same-file symbol matches the name.
- Nested functions one level deep inside components/functions are indexed (e.g. `UserProfile.handleSubmit`). Deeper closures are not.
- Inheritance (`extends`/`implements`) chains are fully resolved.

---

## How indexing works

1. Walk source files (skip hidden dirs, symlinks, large files)
2. Parse files with language-specific strategies:
   - **TypeScript/JavaScript** (Tree-sitter): functions, classes, interfaces, methods, call relationships, nested handlers, re-export ratio
   - **Vue/Svelte/Astro** (SFC): script block extracted, then parsed as TypeScript/JavaScript
   - **AngularJS 1.x** (regex): `.service()`, `.controller()`, `.factory()`, `.directive()` registrations
   - **Java** (Tree-sitter): classes, interfaces, enums, records, methods, constructors, static fields, call tracking
   - **Ruby** (Tree-sitter): classes, modules, methods, constants, Rails DSLs, inheritance chains
   - **Python** (Tree-sitter): classes, top-level functions, methods; respects `__all__`; excludes `_private` names
   - **Go** (Tree-sitter): structs, interfaces, top-level functions, methods, constants/vars; go.work workspace support
   - **Rust** (Tree-sitter): pub structs/enums, pub traits, pub functions, pub type aliases; impl blocks for implements relationships
   - **C#** (Tree-sitter): public classes, interfaces, structs, enums, records, public methods; base-type list for extends/implements
   - **PHP** (Tree-sitter): classes, interfaces, traits, public methods; extends/implements clauses; composer path-repos
   - **Kotlin** (Tree-sitter): classes, interfaces, object declarations, top-level functions, methods; public by default
   - **C++** (Tree-sitter): classes, structs, functions, methods, namespaces
3. Resolve internal imports to graph edges (including tsconfig/jsconfig aliases, npm workspaces, Ruby Gemfile path gems)
4. Build graph adjacency maps and compute in-degree (`importedByCount`)
5. Extract symbol-level relationships (calls, extends, implements, exports); cross-file call edges resolved by matching bare call names against the exports of each file's resolved imports

**Currently supported languages and frameworks:** TypeScript, JavaScript, Vue, Svelte, Astro, AngularJS 1.x, Java, Ruby, Python, Go, Rust, C#, PHP, Kotlin, C++.

**Not yet supported:** Swift, Dart — files are walked but not parsed.

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
```

---

## Live index updates

Once the MCP server is running, the index stays current automatically — no restarts required.

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

Indexes are stored in `~/.coldstart/indexes/<hash-of-root>/` and reused when:
- Schema/version matches
- Git HEAD has not changed since the index was built

The cache TTL is **24 hours** and acts as a safety net only. The file watcher is the primary freshness signal during an active session.

---

## Limitations

1. Dynamic/computed import patterns (e.g., `import(variable)`) may not be resolved.
2. It is a routing layer, not a behavior summarizer — no semantic analysis or code summaries.
3. Hidden directories and files over 1 MB are skipped by default.
4. Barrel detection (TS/JS only) uses re-export ratio; non-TS/JS barrel-style files are not detected.
5. Swift and Dart files are walked but not parsed — no exports/symbols extracted.
6. `trace-impact` call edges: member expression calls (`this.method()`, `api.method()`) are not cross-file resolved — these callers will not appear in impact results. Named function calls matched to an import are fully resolved.
