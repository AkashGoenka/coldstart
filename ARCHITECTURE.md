# Architecture — coldstart

This document explains the reasoning behind every significant decision in this
project. Not what the code does — the README covers that — but why it was built
this way, what was considered and rejected, and where the boundaries are.

---

## The problem

AI agents like Cursor and Claude Code have no memory between sessions. Every new
conversation starts cold. The agent re-reads the same files repeatedly to answer
the same routing questions — "where is authentication handled", "what does this
module export", "which files touch payments" — before it can answer anything useful.

On a codebase with 5,000+ files this cold start costs tens of thousands of tokens
per session. Multiplied across dozens of sessions per week, it becomes the single
largest source of unnecessary token consumption.

The insight is simple: these routing questions have stable answers. The answer to
"where is authentication handled" does not change unless someone moves the auth
files. So compute it once, store it, and let the agent read the result instead of
re-discovering it every time.

---

## What this project is

A static snapshot of your codebase structure, written to disk as a JSON file,
readable by any AI tool.

That is the complete definition. It is not a search engine, not a recommendation
system, not a vector database, not a RAG pipeline. Every time the scope expanded
during design, it was pulled back to this definition.

---

## Why Go

The indexer needs to walk and parse 5,000+ files. Three languages were considered:

**Python** was rejected on speed. An interpreted language with a GIL processes
files sequentially in practice. At 5,000 files a Python indexer takes 30–60
seconds. Acceptable for a one-time run but painful for pre-commit hooks or CI.

**Rust** was rejected on complexity. Rust's performance advantages over Go are
real but irrelevant for this workload — the bottleneck is filesystem I/O, not
CPU computation. Rust would take 3x longer to write for no measurable benefit
in this context.

**Go** was chosen because it is compiled, has first-class concurrency via
goroutines, ships as a single binary with no runtime dependency, and is simple
enough to read and modify without deep Go expertise. The indexer runs 16
goroutines in parallel and processes 5,000 files in 2–4 seconds.

---

## Why regex and not AST

AST parsing with tree-sitter was the first instinct. It was rejected for the
initial version for one reason: it solves a problem we have not confirmed exists.

The cold start problem requires knowing:
- What files exist
- What they import and export
- Which domain they belong to
- How files depend on each other

Regex answers all four questions adequately. It does not answer them perfectly —
dynamic imports are missed, barrel re-exports are sometimes incomplete, multiline
edge cases occasionally fail — but adequately is sufficient to solve the cold
start problem.

AST parsing adds a day of implementation work, a non-trivial external dependency,
and significant parser complexity in exchange for precision on edge cases we may
never encounter in practice.

The right time to add tree-sitter is after running the regex version on a real
codebase and identifying specific failures. Not before.

The extension point is clean: `parser/typescript.go` is the only file that would
change. The rest of the system is parser-agnostic.

---

## Why no LLM for summaries

The first natural extension was LLM-generated semantic summaries — running each
file through an API to produce a human-readable description of what it does.

This was rejected on a fundamental principle: if the goal is to reduce token
consumption, spending tokens to generate summaries creates a conservation problem.
The summarisation cost is paid once and amortised over many queries, so the
economics can work — but only if retrieval is precise enough that the agent
receives 3–5 summaries per query rather than hundreds.

More importantly, LLM summaries are unnecessary for routing decisions. An agent
deciding whether to open a file does not need prose. It needs structured signal:
what does this file export, what does it call, which domain does it belong to.
That signal is derivable from structure alone — no LLM required, no token cost,
fully deterministic.

If richer summaries are needed in a future version, AST-derived structured data
(function signatures, call chains, type definitions) generates them for free
without any API call.

---

## Why no vector search

Vector similarity search was considered and rejected for the initial version for
the same reason as AST: it solves a scale problem we have not confirmed exists.

Keyword search across 5,000 file summaries is fast enough and precise enough for
a codebase of that size. The query for "jwt" returns a manageable result set.
Vector search becomes necessary when:

1. The codebase grows beyond ~10,000 files and keyword results become noisy
2. Queries are semantic rather than keyword-based ("how does session management
   work" rather than "session")

Neither condition is confirmed until the tool is used on a real codebase.

The embedding model that powers vector search (sentence-transformers/all-MiniLM)
is lightweight and runs locally — so when the time comes the addition is not
onerous. But adding it before it is needed adds dependency weight, setup
complexity, and a local model download to a tool whose current setup is three
commands.

---

## Why no local retrieval server

A local HTTP server that Cursor queries instead of reading the full JSON file was
designed in detail and rejected before implementation.

The argument for it: the full JSON file grows with codebase size, eventually
becoming too large to read in full. A server returns only relevant slices.

The argument against it: this is an optimisation for a problem that does not exist
yet. At 5,000 files `coldstart_map.json` is 1–3MB. Cursor reads it in full and
uses the content it needs. No server required.

The server becomes necessary above ~10,000 files where the map size starts
defeating the purpose of having a compact context artifact. That threshold is
documented in the limitations section of the README. When you hit it, the
retrieval server is the right next step — not before.

The more important reason to reject it early: a server introduces a process that
must be running for the tool to work. A JSON file always works. Operational
simplicity is a feature.

---

## Why the map is a flat JSON file and not a database

Three storage formats were considered: JSON file, SQLite database, and a
dedicated vector database (LanceDB, ChromaDB).

SQLite and vector databases were rejected because they cannot be read by an AI
agent without a query interface. A JSON file can be read by anything — Cursor,
Claude.ai, a bash script, a CI pipeline, a human. The portability is the point.

A secondary benefit: JSON files can be committed to git. The map becomes a
versionable artifact. You can diff it to see how your architecture has changed,
roll it back, and share it across a team without any infrastructure.

---

## The scope that was rejected

During design the following were proposed and explicitly rejected for the initial
version. They are documented here so future contributors understand why they are
not present and can evaluate whether the conditions that would justify them have
been met.

**Confidence scoring on retrieval results** — adds complexity to solve an
inference accuracy problem that may not exist in practice. Build the simple
version first.

**Staleness detection with automatic re-indexing** — the hash field on each node
provides the data needed for this. A file watcher or git hook is sufficient for
keeping the map fresh without building automatic detection into the indexer itself.

**Multi-language support beyond TypeScript/JavaScript** — the parser is the only
language-specific component. Adding a language means adding one file. The
architecture supports it cleanly but the initial version targets the most common
AI agent codebase language.

**GraphQL support** — GraphQL files have no imports or exports in the traditional
sense. The useful data (type definitions, query names, mutation names) requires
a GraphQL-specific parser. Worth adding if your codebase has significant GraphQL
surface area. The extension point is `parser/graphql.go`.

**Token budgeting on responses** — the idea of hard-capping what an agent receives
per query is architecturally sound but requires the retrieval server to enforce.
Implemented at the `.cursorrules` level as a soft instruction instead.

---

## The natural upgrade path

If the regex indexer proves insufficient, the upgrade sequence is:

```
1. Regex parser (current)
   ↓ if: missing exports, incomplete edges, domain tagging is wrong
2. Tree-sitter AST parser
   ↓ if: map is too large to read in full (>10k files)
3. Local retrieval server with keyword search
   ↓ if: keyword search returns too many results (noisy at scale)
4. Vector embeddings with local model (cocoindex-code or similar)
```

Each step is justified by a specific observed failure in the previous step, not
by theoretical possibility of that failure.

---

## What Cursor already does and why this is still useful

Cursor maintains an internal index of your codebase. It uses embeddings stored
in a cloud service and retrieves relevant files before sending them to the model.

This solves a different problem. Cursor's index determines which files to include
in context. It does not gate how many files are included or compress what gets
sent. Once Cursor decides a file is relevant it sends the full raw source.

This project sits at a different layer. It gives the agent a compact structural
map that answers routing questions without opening any file. The agent reads the
map, identifies the one or two files actually relevant to the question, and opens
only those.

The two are complementary. Cursor's index helps it find files. This map helps it
decide which files are worth finding.

---

## The principle that constrained every decision

> Solve the problem you have. Not the problem you might have at 10x scale.
> Not the problem that would exist if the first version worked perfectly.
> The problem you have, right now, with the codebase you have.

Every rejected feature in this document was rejected by applying that principle.
The cold start problem is real and present. The retrieval precision problem at
20,000 files is hypothetical. Build for the real problem first.
