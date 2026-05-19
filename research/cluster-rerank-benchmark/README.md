# Cluster-rerank benchmark

Research scratch, not product code. Investigates whether import-graph signals (caller bridges, dependency bridges, pairwise cohesion) can productionize as either (a) two new sections of `get-overview` output or (b) an indirect confidence signal layered on top of the existing scorer.

**Read `FINDINGS.md` first** for the why, the findings, and where to pick up.
This README is purely operational.

---

## What's in here

```
research/cluster-rerank-benchmark/
├── README.md                  # this file — how to run
├── FINDINGS.md                # the journey: context, methodology, findings, next steps
├── capture-evidence.ts        # per-query JSON dump script
├── analyze.mjs                # consumes dumps + labels → metrics report
├── labels.json                # tier 1/2/3 file labels per query
└── evidence/
    ├── mastodon/q1...q4.json  # raw per-query evidence dumps
    └── arches/q1...q3.json
```

---

## Prerequisites

```bash
# from coldstart repo root
npm install --legacy-peer-deps     # tree-sitter peer-dep ranges conflict on cold cache
npm run build

# target repos cloned as siblings of coldstart (or anywhere; just pass absolute paths)
cd /tmp
git clone --depth 1 https://github.com/mastodon/mastodon.git
git clone --depth 1 https://github.com/archesproject/arches.git
```

---

## Common workflows

### Re-analyze with current data (cheap, ~1 second)
```bash
cd research/cluster-rerank-benchmark
node analyze.mjs
```
Re-reads `labels.json` and `evidence/*/*.json`. No re-indexing. Edit `labels.json` and rerun to see how tier choices move the numbers.

### Add a new query against an existing repo (~30 seconds per query)
```bash
# from coldstart repo root
npx tsx research/cluster-rerank-benchmark/capture-evidence.ts \
  /tmp/mastodon \
  research/cluster-rerank-benchmark/evidence/mastodon \
  "your new query string"
```
The script indexes the target repo (~13s for mastodon, ~6s for arches) and writes a fresh JSON dump per query. Then add tier labels for the new query to `labels.json` under `mastodon.qN` (next free qN) and re-run `analyze.mjs`.

To run multiple queries in one indexing pass (recommended):
```bash
npx tsx research/cluster-rerank-benchmark/capture-evidence.ts \
  /tmp/mastodon \
  research/cluster-rerank-benchmark/evidence/mastodon \
  "query one" "query two" "query three"
```

### Add a new target repo
1. Clone it locally.
2. Create `evidence/<repo-name>/` directory.
3. Run `capture-evidence.ts` against it as above.
4. Add a `<repo-name>` block to `labels.json`.
5. Re-run `analyze.mjs`.

`analyze.mjs` auto-discovers any subdirectory under `evidence/`.

### Try a new metric without re-indexing
The dumps contain everything needed to compute any metric over the import graph. Edit `analyze.mjs`, add a new block in the per-query loop, give it a numerator/denominator with a one-sentence physical meaning, surface it in the summary table. See FINDINGS.md "How we think about metrics" for the rule we're holding ourselves to.

---

## Evidence JSON schema (v1)

One file per query, written by `capture-evidence.ts`. Sparse where it makes sense — only non-empty pairs and only non-isolated bridge files are stored.

```jsonc
{
  "schemaVersion": 1,
  "query": "follower relationship account",
  "repo": "/tmp/mastodon",
  "coldstartCommit": "0580f80f...",
  "fileCount": 4936,
  "indexedAt": "2026-05-19T...",
  "goMeta": {
    "fallback": false,                   // true if GO fell back to reverse-substring
    "truncated": true,                   // true if more than max_results matched
    "excluded_test_files": 189,          // tests filtered from top-K
    "note": null
  },
  "K": 20,                               // size of top-K returned

  "candidates": [                        // top-K from get-overview
    {
      "rank": 1,
      "path": "app/...",
      "fileId": "...",
      "isTestFile": false,
      "inEdges":  ["fileId", "fileId", ...],   // who imports me
      "outEdges": ["fileId", ...],             // what I import
      "inEdgesCount":  21,
      "outEdgesCount": 6
    }
    // ... K entries
  ],

  "pairwise": {                          // SPARSE: only pairs with non-empty overlap
    "2-3": {
      "sharedImporters":  ["fileId", "fileId"],   // files that import both candidate 2 AND 3
      "sharedImportees":  ["fileId"]              // files that BOTH 2 and 3 import
    }
    // ... only non-empty entries
  },

  "bridgeRaw": {                         // SPARSE: only files with >=1 candidate edge
    "<fileId>": {
      "path": "app/...",
      "importsHowManyCandidates": 4,           // this file imports 4 of the top-K
      "importedByHowManyCandidates": 0,        // no top-K file imports this one
      "whichCandidatesItImports": [1, 5, 8, 12],   // ranks
      "whichCandidatesImportIt": []
    }
    // ... one entry per related outside file
  },

  "tokenDocFreqSnap": {                  // for any token in any candidate's domainMap
    "follower": 47,                      // future IDF experiments don't need re-index
    "account":  312
    // ...
  }
}
```

---

## Known issues

- **`npx tsx` install race**: running two `npx tsx capture-evidence.ts` jobs in parallel on a cold cache can collide on the tsx install. Run sequentially the first time, or pre-install tsx.
- **MCP daemon spawn**: harmless log noise on first invocation (`{"method":"roots/list",...}`). Doesn't affect the dump output.
- **"T1 not seen in dump" labels**: `analyze.mjs` flags any tier-1 path that appears neither as a candidate nor as a bridge file. This is approximate — a file that's indexed but has zero relation to this query's top-K won't be in the dump. To confirm whether a flagged file is actually indexed, search across all dumps: `grep -l "your/file/path" evidence/*/*.json`.
- **Labels are solo (Claude). Spot-check needed.** See `FINDINGS.md` for the specific weak labels we already flagged.
