# Two-tool convergence — implementation plan

**Status:** IMPLEMENTED on `feat/two-tool-convergence` (committed `bf06780`, 327 tests green). Historical plan kept for rationale.

> **Implementation diverged from this draft in one key way:** the plan proposed folding TD's import-graph and TI's caller info into *per-result evidence on `get-overview`* (`with_importers`/`callers_for`). What actually shipped folds them into **`get-structure`** instead — GO stayed a pure file-locator (`query`, `path`, `page`), and GS gained `view: full` returning symbols + callers + imports + importers in one file-scoped call. See README / ARCHITECTURE for the as-built contract. The rest of this document is the original plan.

## Goal

Reduce coldstart's tool surface from 4 (GO, GS, TD, TI) to 2 (GO, GS). Fold TD's import-graph info and TI's caller-of-exports info into per-result evidence on GO. Sharpen GS for god-file navigation. Re-shape descriptions and runtime rules so agent uses the new surface correctly.

Rationale across the May 2026 arches v2 per-call drill (27 queries):
- TD/TI adoption is low; agent grep-navigates instead.
- The agent's productive route is GO → grep with matched tokens → Read. Coldstart's value is being a high-signal token-emitter + ranker that feeds the agent's grep loop, not a separate navigation tool.
- Two tools with richer per-call intent (path glob, scoped evidence, symbol match) cover what 4 tools do today, with less description surface to ignore.

Parked alternatives (do not re-open without new evidence): body-grep at query time (see `feedback_body_grep_parked` memory), coverage-of-query as separate ranking signal (subsumed by `path` glob), `intent` enum on GO (language-specific, classifier-shaped).

## Target tool surface

### `get-overview` (GO)

| param | type | required | semantics |
|---|---|---|---|
| `query` | string | yes | Natural-language tokens (current `domain_filter`). |
| `path` | glob string | no | Scope where to look. Minimatch-style: `**/*.py`, `arches/app/**/*.htm`, `!**/tests/**`. |
| `with_importers` | bool | no, default false | Cheap. Attach `importers: [paths]` per result from the existing import graph. Folds TD. |
| `callers_for` | string \| string[] | no | Expensive. For each named file, compute callers of its exported symbols and attach as evidence. Folds TI, scoped per agent request to avoid blanket noise. |

Output changes:
- Page size = 10 (was 7).
- Remove docFreq counts from emitted matched array (`dropdown(2)` → `dropdown`). Internal ranking still uses docFreq.

### `get-structure` (GS)

| param | type | required | semantics |
|---|---|---|---|
| `file` | string | yes | File to look inside. |
| `match` | string | no | Filters BOTH symbols and imports. Substring by default; `/regex/` if wrapped. Solves the god-file 90-line-dump (q17). |
| `view` | enum | no, default `both` | `symbols` / `imports` / `both`. Lets agent ask for just one section. |

### Removed

- `trace-deps` — value folded into GO's `with_importers`.
- `trace-impact` — value folded into GO's `callers_for`.

## Phases

### Phase 1 — Groundwork (mechanical, no surface change)

| Change | Files | Risk |
|---|---|---|
| 1.1 Walk-all-languages for path/filename tokens. Extend `parser.ts:494` token-only template branch to cover all extensions the walker sees but doesn't currently index (.htm, .html, .css, .scss, .json, .md, etc.). Filename + path tokens only; no AST. | `src/indexer/walker.ts`, `src/indexer/parser.ts`, `src/constants.ts` | Low |
| 1.2 Page size = 10 in GO output. | `src/server/get-overview.ts` slice logic | Trivial |
| 1.3 Remove docFreq counts from emitted matched array. | `src/server/get-overview.ts` output build | Trivial |

**Validation:** spot-check arches q01/q14/q18 only. Confirm `sidenav.htm`/`concept-select.htm`/`javascript.htm` now appear in GO output. No full benchmark.

### Phase 2 — Additive new fields (no removals)

| Change | Files | Risk |
|---|---|---|
| 2.1 GO `path` field (minimatch glob). | `src/server/get-overview.ts`, `src/server/index.ts` (description) | Medium |
| 2.2 GO `with_importers` + `callers_for` fields. Pull from existing import/call-graph indices into result evidence. | `src/server/get-overview.ts`, evidence-builder helper | Medium |
| 2.3 GS `match` field (substring or `/regex/`), applies to symbols and imports. | `src/server/get-structure.ts`, `src/server/index.ts` (description) | Low |
| 2.4 GS `view` field. | `src/server/get-structure.ts` | Low |

**Validation:** none. Per session decision: the new fields are the convergent primary surface; agent will try them by default once they exist and descriptions ship. Phase 3 end-state validation covers uptake check.

### Phase 3 — Convergence (destructive)

| Change | Files | Risk |
|---|---|---|
| 3.1 Hard-remove TD and TI as top-level tools. Underlying graph indices stay (now consumed by GO's evidence builder). | `src/server/trace-deps.ts`, `src/server/trace-impact.ts`, `src/server/index.ts` tool registration | High |
| 3.2 Full description and `RULES_CONTENT` rewrite. Reflect 2-tool surface, teach `with_importers` / `callers_for` / `path` / `match` use patterns, remove TD/TI references. | `src/server/index.ts` | High |
| 3.3 Description review pass via separate LLM. Validate clarity, find ambiguities before benchmark. | n/a (review-only) | Low |

**Validation:** full arches benchmark (27 queries) via drive-vscode + v2 per-call methodology on a 4-5 query sample. Sample should cover the distinct failure shapes seen in this session: coverage (q14), ranking (q22), vocab (q05), agent-loop (q25), god-file (q17), sparse-rare (q09). Compare to v2 baseline.

If 2-tool surface performs at parity or better than 4-tool baseline → ship. If regression on any sampled failure shape → fix description and re-run before merging.

## Open decisions (locked)

- Glob library: minimatch-style (`**`, `!`-prefix negation).
- GS `match`: substring default, `/regex/` when wrapped.
- `with_importers` and `callers_for` defaults: both off, opt-in.
- TD/TI removal: hard-remove in Phase 3, no deprecation period (coldstart isn't widely deployed).
- Description review: separate LLM pass before benchmark.

## Branch strategy

Feature branch: `feat/two-tool-convergence`. Each phase a commit (or PR into the branch). Merge to main only after Phase 3 validation passes.

## Bonus — after plan is locked

Clean `coldstart/research/`. Keep `route-viz/build.py` (load-bearing for future drills) and `cluster-rerank-benchmark/evidence/` (historical data). Sweep and delete superseded wip docs. List specifics before deleting.

## References

- v2 per-call drill JSONLs: `~/.claude/projects/-Users-akashgoenka-benchmark-repos-arches-arches-coldstart/`
- v2 instructions used to produce per-call evidence: `/tmp/route-viz-batch/INSTRUCTIONS_v2.md`
- Parked-and-recorded: `feedback_body_grep_parked` (don't re-propose), `feedback_payload_without_description_is_dead_bytes` (description must ship with schema)
- Walker coverage gap origin: `project_walker_extension_coverage_gap`
- Phase boundary state: `project_graph_rerank_exploration`
