# Recall eval: how well do embedding models find (and gate) notebook notes?

A local, self-contained eval for the notebook's auto-recall. For each real prompt typed in a repo, it asks two things:

1. **Finding** — when a prompt needed a note, is the right one among the 3 a system would show?
2. **Gating** — can the system tell *when* to show notes at all, better than never showing any?

It compares BM25 (what `kb search --hook` ships today) with three local embedding models, each given either the
prompt alone or the prompt plus the last 3 exchanges:

| model | size | license | notes |
|---|---|---|---|
| EmbeddingGemma 2 (`onnx-community/embeddinggemma-2-ONNX`) | 740M | Apache-2.0 | the lead candidate |
| EmbeddingGemma 1 (`onnx-community/embeddinggemma-300m-ONNX`) | 308M | Gemma license (download on first use, never bundle) | |
| granite-embedding-small-english-r2 | 48M | Apache-2.0 | smallest |

Everything runs on CPU in Node (transformers.js / ONNX). There is no Python and no network after the first model
download. This folder is **not** part of the npm package (root `package.json` `files` ships only `dist`, `hooks`,
`templates` and `vendor/wasm`).

## Privacy

All data goes to `work/` (gitignored): real prompts, agent replies and notes from the repo being measured. It never
leaves the machine. Share only the `results.md` numbers.

## Steps

```bash
cd eval/recall
npm install                                   # transformers.js + tsx, pinned by package-lock.json

# 1. build the eval set from this machine's transcripts + the repo's notebook (150 prompts)
npx tsx build.ts --repo /absolute/path/to/repo

# 2. label it: follow LABELLING.md in a Claude Code session (main label → blind Sonnet review → settle)
npx tsx compare-review.ts                     # lists the disagreements to settle

# 3. ONLY after every prompt is labelled and settled: run the models
npx tsx embed.ts                              # all three; or e.g. `npx tsx embed.ts gemma2`
npx tsx score.ts                              # writes work/results.md

# 4. once the numbers look right: keep ONLY results.md, delete everything else (eval set, labels, vectors, models)
npx tsx score.ts --clean
```

Requirements: Node ≥ 20, Claude Code transcripts in `~/.claude/projects/` for the repo, a coldstart notebook in the
repo (`.coldstart/notebook/.raw/`). `build.ts` reads the notebook through this checkout's `src/kb` (no build step).

Costs, measured on an M-series Mac with 161 notes and 300 prompts:

| model | download (on disk) | embed everything | one query | peak RAM |
|---|---|---|---|---|
| EmbeddingGemma 2 | 3.2 GB | 3.6 min | ~30 ms | 4.2 GB |
| EmbeddingGemma 1 | 1.5 GB | 1.9 min | ~23 ms | 2.0 GB |
| granite-small | 188 MB | 0.6 min | ~7 ms | not measured |

Models are cached in `model-cache/` (gitignored). `WORK=/some/dir` points every script at another set.

## Reading `results.md`

Every prompt scores **1 point** when the system showed 3 notes and one was right, or stayed quiet when nothing was
needed. **"Never show a note" is the baseline to beat.**

- **Top 1 / 3 / 5**: of the prompts that needed a note, how often the right one is first / in the first 3 / first 5.
- **Top 3 vs BM25**: on how many prompts the model got it and BM25 didn't, and the reverse. "could be luck" means
  the split is not clearly better than a coin flip (sign test, p ≥ 0.05).
- **Tells apart**: take one prompt that needed a note and one that didn't. How often does the gate rate the first one
  higher? 50% = coin flip, 100% = perfect.
- **Fixed rule**: decided in advance, nothing fitted. **Fitted cutoff**: the best line, picked on half the prompts and
  scored on the other half. This is the fairest best case.
- **History gain real?**: whether adding the last 3 exchanges improves "tells apart" by more than luck (bootstrap,
  95%).

## Reference: coldstart's own set (2026-11-10, 300 prompts, 108 needed a note)

Running this suite on the frozen coldstart set reproduces the original eval exactly:

- **Finding, top 3 of 108 (prompt → with history):** BM25 49 → 51 · granite-small 56 → 60 ·
  EmbeddingGemma 1 56 → 63 · **EmbeddingGemma 2 60 → 68**. EmbeddingGemma 2 top 5: 72 vs BM25 58.
- **Gating:** never showing scores 192. The shipped BM25 rule scores 120, and 69 with history. The best gate is
  EmbeddingGemma 2's "how close the best note is" with a fitted cutoff: 201, i.e. +9, which is within luck. History
  helps every gate tell the cases apart (EmbeddingGemma 2: 65% → 72%), but no single score with one cutoff beats
  silence clearly.
- **What a second repo answers:** does EmbeddingGemma 2 still find more than BM25 on notes that aren't about
  coldstart itself, and does the gate picture change on a normal product codebase? (coldstart's prompts are unusually
  chatty: 64% needed no note.)
