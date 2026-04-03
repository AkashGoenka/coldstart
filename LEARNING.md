# Learning Doc: What Was Built and How It Works

This document is written for you to read after the agent built `coldstart-mcp/`
from scratch. It explains every component, the decisions that shaped it, and the
data flows that connect everything together.

---

## 1. Why this exists

The original `coldstart` tool produced `coldstart_map.json` — a static JSON blob
that AI agents were supposed to read at the start of every session. The problem:
agents don't use a JSON blob well. They either ignore it or dump it wholesale into
their context window, wasting tokens on irrelevant domains.

The insight that drove the rewrite: **agents need answers to questions, not raw
data**. The question "find files related to authentication" has a precise answer.
An MCP server can answer it directly. A JSON file cannot.

`coldstart-mcp` is that MCP server. It runs locally, receives tool calls from
the agent, and returns ranked file lists in milliseconds.

---

## 2. Repository structure

```
coldstart-mcp/
├── src/
│   ├── types.ts              All TypeScript interfaces (IndexedFile, Edge, CodebaseIndex, ...)
│   ├── constants.ts          Regex patterns for 12 languages, domain keywords, stop words
│   ├── index.ts              CLI entrypoint — argument parsing, pipeline orchestration, MCP start
│   ├── indexer/
│   │   ├── walker.ts         Recursive filesystem walk, skips excluded dirs, returns WalkedFile[]
│   │   ├── parser.ts         Applies language regex patterns to extract imports/exports/domain
│   │   ├── resolver.ts       Converts import specifiers to resolved file IDs (edges)
│   │   ├── graph.ts          Builds adjacency lists, PageRank, BFS depth
│   │   └── git.ts            Parses git log to compute file co-change scores
│   ├── search/
│   │   ├── tokenizer.ts      Splits camelCase/snake_case, removes stop words
│   │   ├── tfidf.ts          Builds weighted TF-IDF index over file documents
│   │   └── ranker.ts         Combines TF-IDF + PageRank + co-change + heuristics into score
│   ├── server/
│   │   ├── mcp.ts            Creates MCP Server, registers tools, connects stdio transport
│   │   └── tools.ts          Handler functions for get-overview, find-files, trace-deps, get-structure
│   └── cache/
│       └── disk-cache.ts     Serialize/deserialize CodebaseIndex to ~/.coldstart/indexes/
└── tests/
    ├── parser.test.ts        26 tests covering all 4 fixture languages
    ├── resolver.test.ts      Tests relative resolution, external skip, unresolved tracking
    ├── ranker.test.ts        Tests scoring logic, domain filter, penalties, limit
    └── fixtures/             Small multi-language project (TS, Python, Go, Rust)
```

---

## 3. The data model

The central type is `CodebaseIndex`:

```typescript
interface CodebaseIndex {
  rootDir: string;
  files: Map<string, IndexedFile>;    // relativePath → file metadata
  edges: Edge[];                       // all resolved import edges
  outEdges: Map<string, string[]>;    // fileId → files it imports
  inEdges: Map<string, string[]>;     // fileId → files that import it
  pagerank: Map<string, number>;      // fileId → PageRank score
  cochange: Map<string, Map<string, number>>; // fileId → fileId → co-change score
  tfidf: Map<string, Map<string, number>>;    // fileId → term → tfidf score
  idf: Map<string, number>;           // term → IDF
  indexedAt: number;
  gitHead: string;
}
```

Every `IndexedFile` has:
- `id`: the relative path (used as a stable key everywhere)
- `language`, `domain`, `archRole`, `isEntryPoint`
- `exports[]`: names the file publicly exposes
- `imports[]`: raw import specifiers (unresolved strings)
- `hash`, `lineCount`, `tokenEstimate`
- `centrality`, `depth`: computed by graph phase

---

## 4. The indexing pipeline (in order)

### Step 1: Walk (`walker.ts`)

Recursively reads directories. Skips `node_modules`, `.git`, symlinks, hidden
directories, user-specified excludes. Matches files by extension against
`EXTENSION_TO_LANGUAGE` (maps `.ts` → `typescript`, `.py` → `python`, etc.).

Returns `WalkedFile[]`: `{ absolutePath, relativePath, language }`.

### Step 2: Parse (`parser.ts`)

For each file: reads content, applies the language's `importPatterns` and
`exportPatterns` from `LANGUAGE_CONFIGS`, then:

- **Imports**: run each regex pattern, collect all capturing group 1 matches.
  Special cases: Go multiline imports (block `import ( ... )` → split on `"`),
  Python comma-separated (`import os, sys` → split on `,`).

- **Exports**: run export patterns. Special cases: `export default` / `module.exports`
  set `hasDefaultExport = true`. Python `__all__` lists are parsed as literal
  arrays. Python and Ruby private functions (underscore prefix) are excluded.

- **Domain inference**: score each domain in `DOMAIN_KEYWORDS` by counting
  keyword hits in the path (×3) and first 2000 chars of content (×1). Highest
  score wins.

- **Architectural role**: match path against `ARCH_ROLE_PATTERNS`
  (router, service, repository, middleware, controller, model, util, config, test, types).

- **Entry point detection**: check if basename (without extension) is in
  `ENTRY_POINT_NAMES` (index, main, app, server, entry, start, ...).

### Step 3: Resolve imports (`resolver.ts`)

Turns raw import specifiers into `Edge[]` (from: fileId, to: fileId).

For each file's imports:
1. Skip external packages (don't start with `.` or `/` and don't match tsconfig aliases)
2. Apply tsconfig.json / jsconfig.json path alias substitution (loaded once from rootDir)
3. Resolve to absolute path from the importing file's directory
4. Try: exact match → append extensions → try index files → `__init__.py` (Python) → `mod.rs` (Rust)
5. Convert resolved absolute path back to relative file ID
6. If found in the file set → create Edge. Otherwise → add to `unresolved[]`

Files are processed in parallel batches of 50.

### Step 4: Build graph (`graph.ts`)

Creates `outEdges` and `inEdges` Maps from the edge list. Deduplicates (so
multiple imports of the same file don't create multiple edges).

### Step 5: PageRank (`graph.ts`)

Standard iterative PageRank with dangling-node handling:

```
For each iteration:
  danglingMass = sum of scores for nodes with no outlinks
  For each node v:
    inSum = sum(score[u] / outlinks[u]) for all u that link to v
    newScore[v] = (1 - d) / N + d * inSum + d * danglingMass / N
  Stop when total delta < epsilon
```

Default: damping=0.85, maxIterations=20, epsilon=0.0001.

Files imported by many other files accumulate high scores. Entry points and
widely-used utilities tend to rank highest.

### Step 6: Git co-change (`git.ts`)

Runs `git log --name-only --pretty=format:COMMIT -n 100`.
Parses output into commits (each is a list of changed files).
Counts how many times each file pair appears in the same commit.

```
cochange(A, B) = commits_together(A, B) / max(commits_A, commits_B)
```

Commits touching more than 50 files are skipped (likely mechanical changes
like formatting or dependency updates, not meaningful co-change signal).

Falls back to an empty Map if git is unavailable or the directory isn't a repo.

### Step 7: TF-IDF (`tfidf.ts`)

Builds a weighted bag-of-terms document for each file:
- basename (without extension) tokenized at weight 5
- directory path segments tokenized at weight 3
- export names tokenized at weight 4
- domain name at weight 1

Token weights are summed, then normalized by total document weight to get TF.
IDF = `log(N / (df + 1)) + 1` (smooth log IDF).

TF-IDF score for each term = TF × IDF.

Tokenization (from `tokenizer.ts`): split on whitespace/punctuation, then split
camelCase (`getUserById` → `get`, `user`, `by`, `id`), then split
snake_case/kebab-case, then deduplicate, remove stop words, lowercase.

---

## 5. The ranking algorithm (`ranker.ts`)

`findFiles(query, index, options)` → `QueryResult[]`

```
tokens = tokenize(query)

For each file:
  score = 0

  // Exact phrase in path (strong signal)
  if relativePath.includes(query.toLowerCase()): score += 50

  // TF-IDF component
  tfidfScore = sum(tfidf[file][token] for token in tokens) / maxTFIDF * 100
  score += tfidfScore * 0.35

  // PageRank component
  prScore = pagerank[file] / maxPR * 100
  score += prScore * 0.15

  // Per-token path basename match
  for token in tokens:
    if basename.includes(token): score += 5

  // Per-token export match
  for token in tokens:
    if any export contains token: score += 4

  // Multi-term intersection bonus
  matchCount = number of tokens matching path/exports/domain
  if matchCount > 1: score += (matchCount - 1) * 2

  // Domain match
  if any token matches file.domain: score += 8

Sort by score descending.

// Co-change boost (applied to already-sorted list)
topFile = results[0]
For each other file:
  coScore = cochange[topFile][file] (0 if not present)
  if coScore > 0.1: score += score * 0.15 * coScore

Re-sort.

// Penalties
test files (.test., .spec., __tests__): score *= 0.6
type definition files (.d.ts): score *= 0.7
generated files: score *= 0.5

Return top N (default 5, max 10).
```

---

## 6. The four MCP tools

All handlers live in `tools.ts`. They receive the `CodebaseIndex` and the
parsed tool parameters. They never call the filesystem — everything comes
from the in-memory index.

### `get-overview`

Aggregates: file count, language counts, domain counts (with optional filter),
inter-domain edge counts, entry points, and top-5 files by PageRank.

The inter-domain edges section is useful for understanding coupling: a high
`auth → db` count means your auth layer talks directly to the database a lot.

### `find-files`

Calls `findFiles()` from `ranker.ts`. Returns the result array with score
and reasons included so the agent can see why each file was returned.

### `trace-deps`

Given a file path, collects its imports and/or importers by traversing
`outEdges` and `inEdges`. Supports depth 1–3 for transitive chains.

Uses BFS (visited set) to avoid cycles. Returns metadata for each dependency
including its own domain and archRole — useful for understanding architectural
direction (service → repository is expected; repository → service is a warning).

### `get-structure`

Returns everything known about a single file. The internal imports section
shows both the raw specifier and the resolved path. External imports (not
resolved to any indexed file) are listed separately — these are npm packages
or stdlib imports.

---

## 7. The MCP server (`mcp.ts`)

Uses `@modelcontextprotocol/sdk`. The pattern:

```typescript
const server = new Server({ name, version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...] }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // dispatch to tool handler
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
const transport = new StdioServerTransport();
await server.connect(transport);
```

The server communicates over stdin/stdout using the MCP protocol. This is how
Claude Code and Cursor discover and call it — they launch the process, send
JSON-RPC messages to stdin, and read responses from stdout. Logs go to stderr
so they don't interfere with the protocol.

---

## 8. The disk cache (`disk-cache.ts`)

Cache key: MD5 of the resolved root directory path (first 16 chars). This gives
a stable directory name per project.

Serialization: `Map` and nested `Map` are not JSON-serializable, so the
serializer converts them to plain objects before `JSON.stringify`, and the
deserializer reconstructs the Maps from `Object.entries`.

Staleness logic (checked on startup):
1. `CACHE_VERSION` string mismatch → re-index (schema changed)
2. git HEAD changed → re-index (likely new commits)
3. timestamp older than 1 hour → re-index

Cache saves happen after a successful full index. On cache load failure (corrupt
file, missing file, version mismatch), the indexer falls back to a full rebuild
silently.

---

## 9. Language support — how patterns work

Each language has `importPatterns` and `exportPatterns` in `LANGUAGE_CONFIGS`.
Patterns are `RegExp` objects. The parser iterates each pattern with a reset
regex (`new RegExp(pattern.source, pattern.flags)`) to avoid stateful `lastIndex`
bugs.

**TypeScript/JavaScript**: covers `import X from 'Y'`, `require('Y')`,
`import('Y')`, `export ... from 'Y'` for imports; `export function/class/const/...`
and `export { X }` for exports.

**Python**: `from X import Y` and `import X` for imports; `def`, `class`, and
`__all__` for exports. Private symbols (underscore prefix) are excluded.

**Go**: `import "X"` and multiline `import ( ... )` blocks. Exports are
uppercase-first identifiers in `func`, `type`, `var`, `const` declarations.

**Rust**: `use X::Y`, `mod X`, `extern crate X` for imports. `pub fn/struct/enum/
trait/type/mod` for exports.

The remaining 8 languages follow similar patterns adapted to their syntax.

---

## 10. Tests

**`parser.test.ts`**: Reads the actual fixture files from `tests/fixtures/`,
calls `parseFile()` directly, asserts on the returned imports, exports, domain,
and hash. Covers TypeScript, Python, Go, Rust across 13 test cases.

**`resolver.test.ts`**: Creates synthetic `IndexedFile[]` arrays in memory,
calls `resolveImports()` against the fixture directory, asserts on edge targets
and unresolved lists. Doesn't require running the full pipeline.

**`ranker.test.ts`**: Builds a minimal `CodebaseIndex` with 6 synthetic files,
calls `findFiles()` with various queries, asserts on result order, score
properties, domain filtering, limit enforcement, and penalty application.

All 26 tests pass. Test runner is Vitest (configured via `vitest.config.ts`).

---

## 11. What to do next

**Try it on a real project**:

```bash
cd coldstart-mcp
node dist/index.js --root /path/to/your-project
```

Then configure it in Claude Code's MCP settings and call `find-files` from a
conversation. The `reasons` field in results tells you exactly why each file
ranked.

**If ranking is wrong for your codebase**: look at the `reasons` array. If
TF-IDF is dominating and producing noise, check whether the export names and
directory structure provide enough signal. Consider adding domain-specific terms
to `DOMAIN_KEYWORDS` in `constants.ts`.

**If import resolution is incomplete**: run with `--no-cache` and add
`console.error` logging in `resolver.ts` to see unresolved imports. The most
common cause is tsconfig path aliases not being picked up — check that
`tsconfig.json` is at the root you're passing to `--root`.

**If you want to add a language**: add an entry to `LANGUAGE_CONFIGS` in
`constants.ts` and to `EXTENSION_TO_LANGUAGE`. The rest of the pipeline is
language-agnostic.
