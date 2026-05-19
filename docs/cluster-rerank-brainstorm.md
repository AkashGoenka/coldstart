# get-overview cluster rerank — brainstorming brief

A self-contained writeup so I can think out loud with someone outside the
coldstart codebase. Skip to **Open questions** at the end if you're short on
time.

## What coldstart-mcp is

A lightweight MCP server that helps coding agents navigate a repo. It builds a
static index (tree-sitter ASTs across ~10 languages, file-level import graph)
and exposes four tools:

- `get-overview(domain_filter)` — token-match files against a free-text query, return a ranked list of file paths
- `get-structure(file)` — compact symbol/imports view of one file
- `trace-deps(file)` — file-level import graph (what does X import / who imports X)
- `trace-impact(symbol)` — find all callers/implementors of a symbol

The product hypothesis is that an agent answering "where should I make this
change?" wants **a coherent slice of the repo**, not a list of files whose
filenames happen to contain the query terms.

It's deliberately a static **evidence ranker**, not a classifier. No LLM
enrichment, no semantic embeddings, no "this is the auth file" labels. Just
combine cheap structural signals (token match, imports, exports, neighbor
density) into a single ranking.

## What we're trying to achieve

Today `get-overview` works on token matches alone. Two failure modes:

1. **Token-leak noise.** A file like `membershipMiddleware.ts` heavily imports
   from `grouphub/*`; it scores high for the query "grouphub" even though it
   isn't the grouphub UI. Token signals leak in directions they shouldn't.
2. **Missed neighbors.** A file genuinely central to the query (an i18n
   middleware, a settings file) may have very few query tokens in its path or
   exports but is imported by every file that does. Token ranking can't see it.

**The proposal:** use the existing in-memory import graph as a second-pass
signal *over the token-matched candidates*.

If it works well enough, two consequences:

- The graph signal becomes default in `get-overview` instead of something the
  agent has to remember to invoke via `trace-deps`. (Benchmarks show the agent
  often skips `trace-deps` entirely.)
- `trace-deps` arguably consolidates into `get-overview` — 4 tools → 3.

## What I've proposed

Three graph-derived signals, all computed over the top-K token candidates:

### 1. Shared importer bridges

Find files **outside** the candidate set that import ≥N of the candidates.
These are bridges that "see" multiple candidates together — typically tests,
controllers, or orchestration files. Promote them into the result.

(Academic name: *co-citation*. I avoid the term in the codebase because it
implies academic-paper semantics that don't quite map; we just say "shared
importer".)

### 2. Shared dependency bridges

Find files **outside** the candidate set that are imported by ≥N of the
candidates. These are typically a shared utility / domain primitive that
multiple candidates depend on. Promote them too.

(Academic name: *bibliographic coupling*.)

### 3. Cluster cohesion rerank

Among the top-K candidates themselves, compute pairwise overlap of importers
and imports. Candidates that share neighbors with several other candidates are
"in the cluster"; candidates with zero overlap are structurally isolated —
likely token-leak noise — and get downweighted.

### Hard constraints I've already burned myself on

- **No single-import boost (N≥2 only).** With N=1, any file that imports one
  candidate gets promoted, which reproduces the `membershipMiddleware` failure
  mode in a new form.
- **No role/capability labels.** Static analysis can't defend a categorical
  claim like "this is the auth controller". Use signals as ranking weights,
  never as classifications.
- **No raw count ranking on shared-dependency bridges.** Generic utilities
  (`utils/exceptions`, `regex_helper`) are imported by half the codebase, so
  count alone surfaces them above the actually-relevant shared dependency.
  Probable fix: rank by `count / total-importers` (graph-IDF) — fraction of
  the file's total importers that are in the candidate set.

## Findings so far (spot-checks on Django, 2026-05-14)

I wrote a one-shot exploratory script (`explore-cluster.ts`) that, for a
single query, dumps:

- top-20 GO results with `importedBy` / `importsOut` counts
- pairwise importer-intersection matrix
- pairwise import-intersection matrix
- top-30 shared-importer bridges
- top-30 shared-dependency bridges
- structural reachability of ground-truth files

Two Django queries:

**"translation locale internationalization"** (broad, cross-cutting)

- Shared-importer bridges worked well. Tests dominated the top — tests
  naturally import the unit under test alongside collaborators, so test
  density looks like a useful cohesion proxy.
- Recovered `django/views/i18n.py` which GO had missed entirely.

**"password hasher"** (tight, specific)

- Shared-dependency bridges recovered `django/utils/crypto.py`, which GO
  missed. But ranking those bridges by raw count buried it under generic
  high-fanout files (`django/conf`, `core/exceptions`).
- Cohesion rerank flagged `django/conf/global_settings.py` (GO rank 2) as
  pairwise-overlap ~0 with the rest of the cluster — structurally isolated,
  token-leak noise. Correct downweight.

**Hard ceiling I hit: settings & discovery files are unreachable via imports.**

`django/middleware/locale.py` and `django/templatetags/i18n.py` had **zero
edges** in either direction. They're referenced from `settings.py` as string
literals (`"django.middleware.locale.LocaleMiddleware"`) and via
templatetag-registry discovery. No amount of graph reranking finds them —
the resolver never emitted the edges in the first place.

This is the same shape as the Rails autoload problem we just shipped a fix
for: framework conventions reference files by name, not import, so an
import-only resolver under-emits edges. Each framework needs synthetic-edge
passes. Specs queued for Python (Django settings strings), JVM, C#, PHP. JS/TS
dropped (too churn-prone).

**This is why cluster work is currently deprioritized.** Tuning cluster
thresholds on a graph that's missing the framework edges would be tuning on a
distorted signal — we'd over-fit to noise structure.

## Where this fits in the broader product picture

There's a structural symmetry I want to name explicitly:

- **Resolver work** = making the graph more *complete* (every relevant edge
  exists)
- **Cluster work** = exploiting the graph to *rank better* (use the edges we
  have)

Both improve `get-overview`'s output. The cluster work depends on the
resolver work being good enough that the signal isn't dominated by missing
edges.

Order of operations:

1. Ship resolver easy-halves across Python / JVM / C# / PHP (Ruby shipped)
2. Re-run cluster spot-checks on the same Django queries with the new edges
   present — see whether cohesion ranking holds up
3. Then design v1 of the cluster rerank with the assumption that v2/v3/v4 will
   re-tune against benchmark data

## Open questions I want to brainstorm

1. **Is the "shared importer + shared dependency + cohesion" trio the right
   decomposition,** or am I missing a fourth signal? E.g., 2-hop reachability,
   PageRank-style propagation, modularity / community detection on the
   candidate subgraph.

2. **Cohesion metric choice.** I'm currently picturing pairwise Jaccard over
   importer-sets and import-sets per candidate, averaged. Are there better
   off-the-shelf cluster-quality metrics for sparse directed graphs at small
   K (≤20)?

3. **The "graph-IDF" fix for shared-dependency bridges.** Is `count /
   total-importers` the right normalization? `log(N) / fanout` style?

4. **Result presentation.** Should bridges be promoted into the single ranked
   list (just with a higher score) or surfaced as a separate "related" section?
   Agents seem to do better with one list. But mixing token-matched candidates
   with graph-promoted bridges in one ranking means score-comparing two
   different scales.

5. **Page size.** GO currently returns 7. Cluster signals can confidently
   surface bridges outside top-K — does the page extend dynamically when
   confidence is high, or do bridges replace lower-confidence token matches?

6. **Iteration harness.** Benchmark runs are expensive (Sonnet calls per
   prompt × ~30 prompts × multiple arms). Is there a cheaper proxy — e.g., a
   ground-truth coverage metric over a curated set of "I know what files
   should be in this cluster" queries — that we could iterate against before
   spending benchmark $$?

7. **Resolver vs cluster sequencing.** I've committed to resolvers first
   because cluster signal needs accurate edges. But is there a version where
   we ship cluster v1 against the current graph, accept it'll be worse on
   framework-heavy repos, and let the resolver work be additive? Risk: tuning
   on bad data bakes in wrong thresholds.

## Constraints worth knowing

- Pure Node, distributed via npm. No language runtimes (no Sorbet, no javac).
  Rules out SCIP indexers as third-party deps.
- Static analysis only. No LLM in the indexing path. (LLM is the *agent*
  consuming the output; the index itself must be deterministic and cheap.)
- One-time cold index is ~1–4s on typical repos; live updates via `fs.watch`
  patch in ~2–5 ms/file. We can spend graph compute at index time but not at
  query time (queries should stay sub-100ms).
- Multi-language. Whatever cluster mechanism we design has to work on JS/TS,
  Python, Ruby, Java, Kotlin, Go, Rust, C#, PHP, C++.
