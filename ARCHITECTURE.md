# Architecture — coldstart-mcp

This document explains the reasoning behind every significant decision in the
MCP server rewrite. Not what the code does — the README covers that — but why
it was built this way, what was considered and rejected, and where the limits are.

---

## Why MCP server instead of static JSON map

The original `coldstart` produced a `coldstart_map.json` file. Agents were
instructed to read it at the start of every session and use it for routing.

It didn't work well. The problems:

**Agents don't use a JSON blob effectively.** A 3MB JSON file gets pasted into
context and the agent tries to scan it like a human reading a document. It finds
what it needs inconsistently. Structured data is not the same as answerable questions.

**The whole blob is included even when only 5 files are relevant.** A query about
authentication doesn't need the payments, queue, and upload domains in context.
The JSON approach has no way to return a slice — it's all-or-nothing.

**Agents need answers, not data.** The right abstraction is: "given a query,
return the 5 most relevant files". That's a function call, not a file read.

The MCP server addresses all three issues. Agents call `find-files` with a query
and get back exactly the files they need. No blob, no manual scanning, no context
waste. The server runs locally, results return in milliseconds, and no network
calls leave the machine.

---

## Why regex instead of AST / tree-sitter

AST parsing gives precise results. Regex gives approximate results. We chose
regex for three reasons:

**Coverage.** 12 languages with one pattern file, zero native dependencies.
Tree-sitter requires compiled native modules per language. Adding Rust, Java,
Kotlin, Dart to tree-sitter support adds weeks of work and platform-specific
build complexity. Regex adds 3 patterns per language.

**The accuracy bar is lower than it appears.** The tool's job is routing:
return the right 5 files out of 5,000. For routing, 80–90% import/export
accuracy is sufficient. If a file has 10 exports and regex captures 8, the
agent still gets pointed to the right file. The edge cases where regex fails
(complex barrel re-exports, dynamic import patterns, macro-generated exports in
Rust) are also the cases where any parser would struggle.

**Zero native dependencies.** The binary is `node dist/index.js`. No native
node modules, no tree-sitter, no platform-specific compilation step. Works on
every platform Node supports.

The upgrade path to tree-sitter is clean: `src/indexer/parser.ts` is the only
file that would change. The rest of the system (graph, ranking, MCP server)
doesn't know or care how imports were extracted. If regex proves insufficient on
a real codebase, swap the parser — don't redesign the system.

---

## Why TF-IDF + PageRank instead of embeddings

Three search approaches were considered: keyword search, TF-IDF + graph signals,
and vector embeddings.

**Pure keyword search** was rejected because it doesn't handle vocabulary
mismatch. A query for "authentication" misses a file called `session-manager.ts`
that has no `auth` in the name but handles sessions. TF-IDF with camelCase
splitting partially addresses this by decomposing identifiers into subwords.

**Vector embeddings** were rejected for three reasons:
- They require a local ML model (ollama, sentence-transformers) or an API call
- They add 300–500MB of model weight and a GPU dependency to a zero-dep tool
- For code navigation, structural signals (PageRank, path matching, exports) are
  more precise than semantic similarity for most queries

**TF-IDF + PageRank + git co-change** gives approximately 80% of the quality of
embeddings for code routing queries, with zero ML dependencies and fully offline
operation. The signal sources are complementary:

- **TF-IDF**: rewards files whose identifiers (basename, exports, directory)
  match query tokens
- **PageRank**: rewards files that are imported by many other files — structural
  importance, not just keyword presence
- **Git co-change**: rewards files that frequently change alongside the current
  top result — captures coupling that import edges miss

The combined score is:
```
score = exactPathMatch(+50)
      + tfidf(normalized 0-100) × 0.35
      + pagerank(normalized 0-100) × 0.15
      + perTokenBasenameMatch × 5
      + perTokenExportMatch × 4
      + multiTermIntersectionBonus × 2
      + domainMatch(+8)
      + cochangeBoost(top result) × 0.15
```

Penalties applied after: test files ×0.6, `.d.ts` files ×0.7, generated files ×0.5.

The upgrade path to embeddings is: replace `src/search/ranker.ts` and add a
local embedding call. The interface (`findFiles(query, index)`) doesn't change.

---

## The routing layer principle

The tool returns file pointers. It never returns behavioral summaries or
implementation descriptions. This is intentional and non-negotiable.

Why: behavioral summaries go stale. A summary that says "handles user login by
checking the database and returning a JWT" is wrong the moment someone refactors
the function to use Redis sessions instead. Structural metadata (exports, imports,
domain, centrality) stays accurate as long as the file structure doesn't change.

The agent's job is to read source code. This tool's job is to tell the agent
which source code is worth reading. Keeping that distinction sharp keeps the tool
simple and its cache valid longer.

---

## How the indexing pipeline works

```
1. Walk(rootDir)
   → WalkedFile[] (path, language)
   Skip: node_modules, .git, symlinks, files > 1MB

2. Parse(file, language) [parallel, 50 files at a time]
   → imports[], exports[], hash, lineCount, domain, archRole, isEntryPoint
   Method: apply language-specific regex patterns from LANGUAGE_CONFIGS

3. ResolveImports(files, rootDir)
   → Edge[] (from, to, type, specifier)
   Method: try exact path → try extensions → try index files → apply tsconfig aliases
   Unresolved imports are collected but not fatal

4. BuildGraph(edges)
   → outEdges Map, inEdges Map

5. ComputePageRank(graph, damping=0.85, iterations=20)
   → pagerank Map<fileId, score>
   Standard PageRank with dangling-node handling

6. ComputeDepth(entryPoints, graph)
   → depth Map<fileId, number>
   BFS from entry points (index.ts, main.ts, app.ts, ...)

7. GitCoChange(rootDir, last 100 commits)
   → cochange Map<fileA, Map<fileB, normalizedScore>>
   Score = commits_together / max(commits_A, commits_B)

8. BuildTFIDF(files)
   → tfidf Map<fileId, Map<term, score>>, idf Map<term, score>
   Document = tokenize(basename)×5 + tokenize(dir)×3 + tokenize(exports)×4 + domain×1
```

Total time on a 5,000-file TypeScript codebase: ~3–6 seconds.

---

## Cache design

Cache location: `~/.coldstart/indexes/<md5-of-root-path>/`

Files:
- `meta.json`: gitHead, fileCount, timestamp, version
- `index.json`: full serialized index (Maps serialized as objects)

Staleness check order:
1. Schema version mismatch → re-index
2. git HEAD changed → re-index
3. Age > 1 hour → re-index
4. Otherwise → use cache

The git HEAD check catches the common case: after a `git pull` or new commit,
the index rebuilds automatically on next agent startup. The 1-hour TTL is a
fallback for projects not using git.

Cache invalidation is intentionally coarse — full re-index, no incremental
updates. Incremental indexing requires tracking which files changed, resolving
import chains that might be affected by transitive changes, and invalidating
partial TF-IDF vectors. The complexity is not justified until re-indexing time
becomes a real problem (it won't be until ~50,000 files).

---

## What was tried before and why it didn't work

**v1: Go static JSON map.** Produced `coldstart_map.json`. Agents were slow to
read it effectively, included too much irrelevant context, and couldn't query it
at different granularities. The map was a data dump, not a service.

**v2: Node.js JSON map with query.py.** Better tooling, same fundamental
problem. query.py helped human developers but agents still needed to invoke it
as a subprocess and parse its output. Awkward. Not native to the agent's tool
use protocol.

**v3 (this): MCP server.** Native to how Claude Code and Cursor call tools.
Agents call `find-files`, get structured JSON back, stop looking. No subprocess,
no blob parsing, no context waste.

---

## The natural upgrade path

```
Current: regex parsing + TF-IDF + PageRank (this version)
   ↓ if: missing exports are causing wrong file routing
Tree-sitter AST for specific languages (drop-in parser swap)
   ↓ if: TF-IDF results are noisy / vocabulary mismatch is frequent
Local embeddings (replace ranker.ts, add ollama/transformers.js call)
   ↓ if: query latency from embedding generation is unacceptable
Pre-computed embedding index (build at index time, not query time)
```

Each step is justified by a specific observed failure. Not theoretical possibility.

---

## What this tool is not

Not a knowledge layer. Not a semantic summarizer. Not a code intelligence engine.

It is a routing layer. It tells agents which files to read. That is the complete
scope. Every design decision was made to make that scope work well, without
accumulating complexity for problems that haven't been confirmed.
