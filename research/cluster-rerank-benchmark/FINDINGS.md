# Cluster-rerank — research findings & journey

A working doc that walks from the original question through to where we are now. Written so a fresh reader (or future-you) can pick up without re-reading the chat transcript.

---

## 1. Where this started

A proposal had been drafted to extend `get-overview` with two new sections, **appended** to the ranked results (never score-merged into the primary ranking):

- **Section 2 "Structural Adjacents"** — files outside the top-K that share importers or importees with the top-ranked results. Ranked by cosine / Resource-Allocation. Gated on coverage of Section 1.
- **Section 3 "Vocabulary Surface"** — high-IDF symbols from matched files, returned as query-refinement suggestions.

The proposal rested on spot-checks done a few days earlier against the django source. Those spot-checks were tainted in two ways:

1. **django is framework source** — the relationships between its files are not typical of an application codebase.
2. **The v1 synthetic-edge resolvers had not yet shipped** — Rails `has_many`/`belongs_to`, Python convention edges, etc. The graph was missing real connections that exist in production application repos.

By 2026-05-19 the v1 resolver work (PRs #35–38) was merged. The brief: re-run the analysis on **bias-clean target repos** — mastodon (Rails + JS) and arches (Python/Django) — to see whether the original empirical claims still hold.

The brief named four claims to verify:

- **C1**: Caller bridges (files importing ≥2 top-K) surface meaningful structural adjacents on broad queries.
- **C2**: Dependency bridges (files imported by ≥2 top-K) by raw count are dominated by generic high-fanout utilities — predicting we'd need IDF normalization.
- **C3**: Zero pairwise overlap among top-K correctly flags isolated candidates as token-leak noise.
- **C4**: Synthetic-edge resolver work materially increased graph density (Rails models should now show non-trivial edges even without explicit imports).

And it specified the methodology: 7 queries across the two repos, run via `explore-cluster.ts`, with per-query analysis questions Q1–Q6.

---

## 2. The reframe

About a third of the way in, it became clear the 4-claim framing was answering the wrong question. The real productionization question is:

> When the lexical scorer returns a top-K, can graph structure (a) **prune noise from inside top-K** and (b) **surface missing relatives from outside top-K** — gated on query-match confidence so weak queries don't get worse?

The 4 claims are *inputs* to that decision, not the decision itself. From this point the analysis kept the brief's raw-data structure but reframed the conclusions around three actionable questions:

1. Does the bridge channel recover canonical files that GO misses?
2. Is there a cheap signal that predicts when bridges will help vs. degrade?
3. What surface should this take — a new section in `get-overview`, or an indirect confidence signal layered on top?

---

## 3. How we agreed to think about the data

Mid-session, the user articulated the operating principle the rest of this work is held to:

> "Data has to make sense to me at an elementary level before I'll agree to put it in practice. Like — I used concentration of query terms in a file to indicate how concentrated a file is with given keywords, then divided it by total existing tokens (just like chemistry)."

Codified as a rule:

- **Every metric has a numerator and a denominator with concrete, physical meaning.**
- **Every metric answers a one-sentence question about what's actually happening between files.**
- **If the number changes, a human reading the codebase should be able to perceive what changed.**

Anything we propose to add to the methodology must extend this contract. The metric table below is the load-bearing list for this benchmark:

| Metric | Numerator | Denominator | One-sentence meaning |
|---|---|---|---|
| **Concentration** (existing scorer) | matched tokens in file | total tokens in file's domainMap | How dominantly is this file about the query? |
| **GO recall T1@N** | tier-1 labeled files in GO's top N | tier-1 labels for this query | Did GO catch the must-have files in its first N slots? |
| **Cohesion density (importers)** | top-K pairs sharing ≥1 importer | K·(K-1)/2 (all possible pairs in top-K) | Pick two random top-K files — what's the chance some third file in the codebase imports both of them? |
| **Cohesion density (any)** | top-K pairs sharing importer OR importee | K·(K-1)/2 | Same, but allowing either direction. |
| **Mean inEdges** | Σ inEdges across top-K | K | On average, how many files reach into each top-K candidate? Near zero = leaf-heavy top-K (migrations, scripts). |
| **Caller-bridge max count** | max # of candidates that any single outside file imports | (raw count) | How concentrated is the "orchestrator pull"? High = one file ties many top-K together. |
| **Dep-bridge max count** | max # of candidates that import any single outside file | (raw count) | How concentrated is the shared-dependency pull? High = one file is the common backbone. |

Anything new added to `analyze.mjs` should extend this table. If a proposed metric can't be expressed as numerator/denominator/one-sentence-meaning, it doesn't belong.

A second methodological commitment that came out of this session: **separate data capture from data analysis.** `capture-evidence.ts` dumps complete graph evidence per query as JSON. All metrics in `analyze.mjs` read those dumps. Re-running an analysis takes a second. Adding a new metric never requires re-indexing. This is meant to be reused across all future benchmark work on coldstart, not just this one.

---

## 4. What we did

1. **Built coldstart** at commit `0580f80f` (the current state of `claude/verify-bias-clean-repos-XLDJL`).
2. **Cloned target repos**: mastodon (4936 files) and arches (1041 files).
3. **Designed the dump schema** (`capture-evidence.ts`). Per query: every edge, every non-empty pair-overlap, every bridge file's full relationship to candidates, and a `tokenDocFreq` snapshot.
4. **Ran 7 queries** — 4 mastodon, 3 arches:

   | Repo | Query | Intent |
   |---|---|---|
   | mastodon/q1 | "timeline status feed" | broad, central domain |
   | mastodon/q2 | "media upload attachment" | tight, specific |
   | mastodon/q3 | "follower relationship account" | exercises Rails synthetic edges |
   | mastodon/q4 | "people I follow" | deliberately weak vocab |
   | arches/q1 | "resource model graph" | broad, central to Arches |
   | arches/q2 | "permission group user" | cross-cutting |
   | arches/q3 | "ontology concept relationship" | Arches-specific, weak vocab |

5. **Labeled tier 1/2/3 files per query** by inspecting repo structure. Tier 1 = "agent would be frustrated to miss this." Tier 2 = useful adjacent context. Tier 3 = tangentially related.
6. **Computed metrics** against labels via `analyze.mjs`.

---

## 5. What we found

### Finding 1 — GO@7 is weaker on these queries than the 82% baseline implies

Only **2 of 7 queries** got at least 25% of tier-1 files into GO's top 7. The 82% baseline must come from queries with stronger vocabulary matches; these 7 are deliberately mixed and they expose holes. This doesn't mean GO is broken — it means there's a real population of queries where GO falls short, and those are exactly where the cluster signal matters most.

### Finding 2 — Bridges genuinely recover canonical missing files

In **5 of 7 queries**, the bridges section pulled tier-1 files that GO@20 completely missed:

| Query | What GO@20 missed | What bridges recovered |
|---|---|---|
| mastodon/q1 | reducers/timelines.js, home_timeline/index.jsx | both, as caller-bridges (counts 4 and 4) |
| mastodon/q2 | media_attachment.rb (the model — top-K was 17 migrations!) | recovered as dep-bridge |
| mastodon/q3 | account.rb, follow.rb (Rails models) | both, as dep-bridges via `has_many`/`belongs_to` synthetic edges |
| mastodon/q4 | follow_button.tsx | recovered as dep-bridge |
| arches/q1 | models/resource.py, views/graph.py | both, as caller-bridges |

This is the strongest result in the benchmark. The bridge channel is doing real work, not decoration.

### Finding 3 — Cohesion density is a *failure detector*, not a quality predictor

| Density (importers) | T1@7 outcome |
|---|---|
| 0.00 (mastodon/q2, q4) | 0%, 0% |
| 0.02–0.04 (mastodon/q3, arches/q1, q3) | 0%, 25%, 0% |
| 0.05 (arches/q2) | 67% |
| 0.10 (mastodon/q1) | 25% |

Zero density consistently predicts GO failure. High density does **not** consistently predict GO success. So density is useful one-directionally: "if density < 0.03, the top-K is structurally diffuse and GO@7 is probably untrustworthy."

### Finding 4 — Top-K shape (mean inEdges) is the cleanest mode-switch for bridges

- **Leaf-heavy top-K** (mean inEdges < 1.0, mostly candidates with zero importers — migrations, scripts):
  - Caller bridges collapse to zero (no orchestrator to find).
  - **Dep bridges become the only recovery channel** and they surface canonical models (m/q2 → media_attachment.rb; m/q4 → follow_button.tsx).
- **Hub-heavy top-K** (mean inEdges ≥ 3):
  - Caller bridges thrive — they pull in feature pages, controllers, tests.
  - Dep bridges are mixed (generic utils + domain models).

This directly contradicts the proposal's plan to IDF-down-weight dep bridges as "generic noise" — that rule would break exactly the cases (m/q2) where dep bridges are the only thing that works.

### Finding 5 — Cohesion as a noise filter has too many false positives

The "drop loner top-K candidates as noise" rule from C3 misfires on:

- **Hub files with unique importer sets** (m/q1 rank-1 `status_lists.js`: zero overlap, but it IS the canonical reducer).
- **Entry-point files by design** (controllers in Rails have inEdges=0 because routes call them — m/q3 ranks 12 and 14).
- **Whole top-Ks that are isolated by design** (m/q2's migrations — pairwise overlap is uniformly zero; cohesion can't discriminate noise from "this is what migrations look like").

Path-pattern noise filtering (locales, fixtures, generated) is much cleaner than graph-cohesion filtering. Keep cohesion for "is top-K coherent?" — drop it as a per-file noise signal.

### Finding 6 — Synthetic-edge resolvers materially shipped (C4 held cleanly)

| File | inEdges count | Evidence |
|---|---|---|
| mastodon `app/models/account.rb` | (in dep-bridges count=4 for q3) | Multiple Rails candidates have resolved `belongs_to :account` |
| mastodon `app/models/account_relationship_severance_event.rb` | 5 | Direct edges resolved |
| arches `models/models.py` | 87 | Python convention edges |
| arches `models/concept.py` | 20 | Python convention edges |
| arches `utils/permission_backend.py` | 40 | — |

Pre-resolver these would have been near zero. C4 is the only claim that held cleanly.

### Claim-by-claim verdict (the original brief's framing)

| Claim | Verdict | Notes |
|---|---|---|
| C1 — caller bridges meaningful on broad queries | **HELD** | m/q1, m/q3, a/q1 all surface canonical orchestrators. Fails when top-K is leaf-heavy (m/q2, m/q4) but that's a top-K-shape issue, not a claim defect. |
| C2 — dep bridges by raw count dominated by generic utils | **PARTIAL/MISLEADING** | True for hub-heavy top-Ks. False for leaf-heavy top-Ks where the canonical model surfaces. IDF reweighting as a blanket rule would degrade m/q2. |
| C3 — zero overlap flags noise | **FAILED as written** | Too many false positives (hub reducers, controllers). Useful as a *top-K-wide* signal, not a per-file filter. |
| C4 — synthetic-edge resolvers shipped real density | **HELD** | All spot checks non-trivial. |

---

## 6. Where we are now

Three things crystallized:

**1. GO is near its static ceiling for these query shapes.** When the lexical scorer's top-K is leaf-heavy, no token-level improvement fixes it — the relevant files simply don't share enough text with the query. Pushing GO further yields diminishing returns. Path-token-leak issues (`settings.py` ranking high for unrelated queries) are not worth fixing on their own merits.

**2. Cluster signals are real, but should probably be used as an indirect confidence layer rather than a direct feature surface.** The right shape for productionization, drawing from the user's framing:

```
GO returns:
  results: [...top-K...],
  confidence: "high" | "medium" | "low",
  rationale: "12/20 candidates have no incoming imports — top-K may be leaf-heavy"
```

The agent decides what to do with confidence — drill into get-structure for high-confidence results, or expand the query for low-confidence ones. The cluster computation tells GO when to flag itself as uncertain, rather than the cluster output being shipped to the agent as a new section.

That said, the "two appended sections" framing is still on the table. The data doesn't kill it — it just means we'd need to ship the confidence dial AND the sections, with the sections gated on confidence.

**3. Threshold values are not yet earned by data.** 7 queries is too small. Before any production change, the benchmark needs to scale.

---

## 7. Where to continue from

Numbered roughly in order of leverage:

### Immediate

1. **Spot-check at least 2 query label sets against your own judgment.** Labels are solo (Claude). I made at least one mistake — `mastodon/q2`'s tier-1 includes `api/v1/media_controller.rb` and `upload_area.tsx`, both of which appear not to be in the index (probably because the walker filtered them; spot-check on disk shows they exist). Start with `mastodon/q3` (the richest example). If you redraw labels meaningfully, re-run `node analyze.mjs` — picture may change. If labels are roughly right, scale.

2. **Decide the product shape.** Do you want clusters surfaced to agents as new sections of get-overview output, OR used purely as an internal confidence dial on existing GO output? The data leans toward the confidence dial, but it's a product call.

### Next benchmark round

3. **Scale to ~30 queries.** Add a third repo (something pure-TS like Next.js or VSCode) to break the Rails/Python bias. Mix in:
   - Tight-vocab control queries that GO should already win cleanly (baseline check).
   - Single-canonical-file queries ("fix bug in X.tsx") to measure precision@1.
   - Cross-stack queries that don't naturally cluster (validate that low cohesion really means low).

4. **Stress-test the confidence threshold.** From the 7-query data, candidate rules:
   - `mean_inEdges < 1.0` → confidence = low
   - `density(importers) > 0.05 AND mean_inEdges ≥ 3.0` → high
   - else → medium
   Pick thresholds from the scaled data, not these 7 points.

### Engineering (later)

5. **Prototype the confidence field** on a coldstart branch. Don't touch ranking. Just add the field to get-overview's JSON response, log it in daemon mode, and dogfood for a week against your daily workflow.

6. **Conditional bridge mode.** If you do ship the two appended sections: when top-K is leaf-heavy, dep-bridges use raw count; when hub-heavy, apply IDF reweighting. Implement only after the confidence layer ships and we have field data.

### Explicitly NOT doing (decisions logged)

- **Don't fix path-token-leak primary-scorer bugs** (e.g. `settings.py` ranking high for "ontology concept relationship"). GO is at its ceiling; effort better spent on the cluster layer.
- **Don't use cohesion to filter "loner" candidates from top-K.** Too many false positives on hub-like canonical files. Path-pattern filtering (locales, fixtures, generated) is the right level for noise removal.
- **Don't IDF-reweight dep-bridges as a blanket rule.** m/q2 showed that's exactly where they shine. Conditional on top-K shape only.

---

## 8. Open questions / things worth a second pair of eyes

- The "T1 not seen in dump" diagnostic in `analyze.mjs` is approximate. To know definitively whether a labeled tier-1 file is indexed, we'd need to either (a) add an "all-paths" sidecar to the dump, or (b) check across all dumps for any mention. Worth deciding which.
- The labels themselves are a single person's judgment of "what would an agent want." There may be value in cross-validating with two or three labelers on the same queries before scaling — small effort, big confidence boost.
- The benchmark currently treats "get-overview returned the file" and "the bridge channel returned the file" as equivalent for recall. If the product shape is the confidence dial (option 2 above), bridges aren't being shown to the agent at all — they're internal-only. In that case the right metric becomes "does the confidence signal correctly predict GO precision?" rather than "does the union recover tier-1?"
- We have not yet looked at Section 3 ("Vocabulary Surface") of the original proposal at all. The dump captures `tokenDocFreqSnap` so the analysis is possible without re-indexing — just not done yet.
