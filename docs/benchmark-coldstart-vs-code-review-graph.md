# Benchmark: coldstart vs code-review-graph

A repeatable test protocol for comparing the two tools across token cost, response quality, and round-trip efficiency. Run each query through both tools against the same codebase and score using the rubric below.

---

## Scoring rubric

| Dimension | 2 pts | 1 pt | 0 pts |
|---|---|---|---|
| **Precision** | Correct file/symbol in top 3 results | Correct answer present but buried | Not found |
| **Depth** | Answered with line numbers / signatures, no follow-up needed | Correct file found, but needed a second call to get structure | Required 3+ calls |
| **Noise** | ≤2 irrelevant results | 3–5 irrelevant | >5 irrelevant |
| **Round-trips** | 1 tool call to fully answer | 2 calls | 3+ calls |
| **Token cost** | Measure response payload in tokens (lower is better, record raw number) |

Max score per query: **8 pts** (token cost recorded separately, not scored).

---

## How to measure token cost

After each tool call, note the **response payload size**. The easiest way:

```bash
echo -n '<paste JSON response here>' | wc -c
```

Or use the context panel in Claude Code — watch the "Messages" token counter before and after the call. The delta is the response cost.

---

## Test queries

These 8 queries cover the full range of agent navigation tasks. Run each against both tools.

---

### Q1 — Named component lookup (single exact name)

**Task:** Find the file that defines `GroupHubActionMenu`.

| Tool | Query |
|---|---|
| coldstart | `get-overview` → `domain_filter: "GroupHubActionMenu"` |
| code-review-graph | `semantic_search_nodes_tool` → `"GroupHubActionMenu"` |

**Expected:** Single correct file path with no follow-up needed.
**What this tests:** Precision on exact PascalCase component names.

---

### Q2 — Concept search (no exact name known)

**Task:** Find files related to authentication and tokens.

| Tool | Query |
|---|---|
| coldstart | `get-overview` → `domain_filter: "[auth|login|jwt] token"` |
| code-review-graph | `semantic_search_nodes_tool` → `"authentication token"` |

**Expected:** 3–8 relevant files, minimal noise.
**What this tests:** Conceptual keyword matching vs semantic embedding quality.

---

### Q3 — File structure inspection

**Task:** What does `GroupHubActionMenu.tsx` export, and how many lines is it?

| Tool | Query |
|---|---|
| coldstart | `get-structure` → `file_path: "GroupHubActionMenu.tsx"` |
| code-review-graph | `semantic_search_nodes_tool` → filter to file, inspect returned nodes |

**Expected:** Export list, line count, symbol signatures without reading the file.
**What this tests:** Depth of per-file metadata returned in a single call.

---

### Q4 — Dependency tracing (who imports X)

**Task:** What files import `GroupHubActionMenu`?

| Tool | Query |
|---|---|
| coldstart | `trace-deps` → `file_path: "GroupHubActionMenu.tsx", direction: "importers"` |
| code-review-graph | `query_graph_tool` or `get_impact_radius_tool` |

**Expected:** List of importing files at depth 1.
**What this tests:** Import graph traversal accuracy and noise.

---

### Q5 — Blast radius (change impact)

**Task:** If `handleError` in `GroupHubActionMenu` is changed, what else is affected?

| Tool | Query |
|---|---|
| coldstart | `trace-impact` → `symbol: "handleError", file: "GroupHubActionMenu.tsx"` |
| code-review-graph | `get_impact_radius_tool` → `"handleError"` |

**Expected:** Transitive symbol list with relationship types.
**What this tests:** Symbol-level impact graph depth and accuracy.

---

### Q6 — Ambiguous name (multiple matches)

**Task:** Find all files related to `ActionMenu` (many components share this pattern).

| Tool | Query |
|---|---|
| coldstart | `get-overview` → `domain_filter: "ActionMenu"` |
| code-review-graph | `semantic_search_nodes_tool` → `"ActionMenu"` |

**Expected:** Multiple results; tool should surface all variants without collapsing them.
**What this tests:** Handling of common/shared naming patterns, noise ratio.

---

### Q7 — Framework convention file (generic filename)

**Task:** Find the page layout file for the grouphubs section.

| Tool | Query |
|---|---|
| coldstart | `get-overview` → `domain_filter: "grouphubs layout"` |
| code-review-graph | `semantic_search_nodes_tool` → `"grouphubs layout page"` |

**Expected:** `GroupHubsPage.tsx` or equivalent, not every `layout.tsx` in the repo.
**What this tests:** Handling of generic filenames where path/directory is the signal.

---

### Q8 — Multi-hop: find, inspect, trace

**Task (3 steps):** Find the action menu for a single GroupHub, inspect its exports, then find what imports it.

| Tool | Steps |
|---|---|
| coldstart | `get-overview` → `get-structure` → `trace-deps` |
| code-review-graph | `semantic_search_nodes_tool` → inspect returned nodes → `query_graph_tool` |

**Expected:** All 3 answered correctly. Record total round-trips and cumulative token cost.
**What this tests:** End-to-end agent workflow efficiency.

---

## Scorecard template

Copy this for each run:

```
Query: Q1 — Named component lookup
Codebase: <name>
Date: <date>

coldstart
  Precision:    /2
  Depth:        /2
  Noise:        /2
  Round-trips:  /2
  Token cost:   ~X tokens (response payload)
  Total:        /8

code-review-graph
  Precision:    /2
  Depth:        /2
  Noise:        /2
  Round-trips:  /2
  Token cost:   ~X tokens (response payload)
  Total:        /8

Notes:
```

---

## What to watch for

- **coldstart advantages:** Fewer total tool definitions loaded (lower baseline cost), compact file-path responses, fast on exact name lookups via compound token indexing.
- **code-review-graph advantages:** Returns line numbers and signatures in the search response itself (saves a follow-up `get-structure` call), semantic search handles typos and synonyms better.
- **Key tradeoff:** coldstart requires a second call (`get-structure`) to get line numbers. code-review-graph returns them upfront but at higher per-result token cost. Q3 and Q8 will surface this clearly.
- **Token cost caveat:** code-review-graph has 30+ tool definitions loaded at all times (~8.9k tokens baseline). coldstart has 4 (~1.5k tokens). For long sessions with many tool calls, this baseline difference compounds.
