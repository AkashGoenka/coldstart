# Round 1: test_track (Rails, 366 files): judgment

Every note was checked claim by claim against the code by a Sonnet verifier
(`sN.verdicts.json`). I spot-checked 7 of the "wrong" verdicts myself and all 7 held up,
and the verifier independently caught the false route-param "bug" I had found by hand.

| Strategy | Notes | M | T | W | M % | W % | Agents |
|---|---|---|---|---|---|---|---|
| S1 map → topics | 61 (50 file, 11 flow) | 58 | 2 | 1 | 95 | 2 | 1 Sonnet + 10 Haiku |
| S2 hubs → flows | 28 (23 file, 5 flow) | 24 | 1 | 3 | 85 | 11 | 5 Haiku + 1 Sonnet |
| S3 questions | 53 (30 file, 17 flow, 6 lesson) | 43 | 6 | 4 | 81 | 8 | 1 Sonnet + 5 Haiku |
| S4 task replay | 41 (27 file, 11 flow, 3 lesson) | 27 | 6 | 8 | 65 | 20 | 5 Haiku |
| S5 single agent | 26 (11 file, 13 flow, 2 lesson) | 23 | 3 | 0 | 88 | 0 | 1 Sonnet |

M = meaningful (says something the path/name/`gs` don't), T = true but thin, W = wrong.

## What each strategy is good and bad at

**S1 (map → topics) is the best overall.** The mapper partitioning work by topic is what
keeps flows distinct (one per topic, almost no duplicates) and what drives depth: each
Haiku worker spent its whole budget on one mechanism. Workers told to *verify the
mapper's hint, never copy it* corrected 5+ wrong hints, almost always by reading the
specs. Its one W is telling: the mapper's **overview** note, written from a skim before any
tracing ("clients compute variants locally"), contradicted by its own topic flow. →
The overview must be written LAST, from verified worker output.

**S5 (one Sonnet agent) is the cleanest and the cheapest**, and the only one with the
onboarding layer: "how the app boots, processes run and which env vars matter" and "how
to add a new API endpoint". It is breadth-first, so it is thinner per mechanism than S1,
and it won't scale to a medium repo in one context. → Its *onboarding topics* belong in
every mapper's topic list.

**S2 (hubs first)** writes excellent file notes (per-file deep reads), but graph
centrality ≠ what a newcomer needs: it has **no auth/CORS flow at all**, because the
concern files (`cors_support.rb`, the base controllers) are not hubs. Its W's are all
*inferred consequences* ("nullify leaves NULLs", but the column is `null: false`).
→ Hub ranking is a good *supplement* (catch central files no topic covered), not a driver.

**S3 (newcomer questions)** finds the right territory but produces **duplicate flows**
(two notes for deterministic assignment, two for decision hiding) because independent
workers answer overlapping questions, and **question-shaped artifacts** ("no api v5 in
this repo", because my question said "e.g. v5").

**S4 (task replay) is the worst.** Replaying a commit puts the worker in a "what's wrong
here?" frame, and it produced **false bugs** (routes "pass nil", the path "never supplies"
params: both are Rails' nested-param naming, which the worker didn't know), repeated across
6 notes by two workers independently. Recent commits are also often cosmetic (admin page
caps, flash component), which yields trivia. → Drop S4 as a strategy.

## Failure modes, ranked by damage (all feed SEED_RULES v2)

1. **Wrong "bug" or inconsistency claims** (S4 ×6, S2): the most dangerous note, because
   a future agent will "fix" working code. Rule: never assert a bug unless a spec or a run
   shows it.
2. **Framework defaults the worker doesn't know** (Rails nested params; `belongs_to`
   required by default under `load_defaults`): the root of most W's.
3. **Inferred consequences** ("so destroying leaves NULLs", "so duplicates hide the
   warning"): the code fact is right, the "so…" is wrong. Rule: state what the code does;
   state a consequence only if you traced it or a spec shows it.
4. **Over-generalisation** ("always", "every write path", "unless force" applied to two
   filters when only one has it).
5. **Duplicate flows** from parallel workers with overlapping scope (S3).
6. **Last-writer-wins file summaries**: parallel workers overwrite one another's summary
   on shared files (split.rb was rewritten by 5 workers in S1).
7. **Artifacts and trivia**: question-shaped absences, `.rubocop_todo.yml` entries,
   memoization trivia, generic Rails conventions.
8. Haiku workers made stray session-tool calls → restrict tools in the prompt.

## Coverage of the newcomer picture

| Topic | S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|
| What the system is + entry points | W | – | – | – | ✓ |
| Boot / processes / env vars | partial | partial | – | – | ✓ |
| Auth (API + admin) | ✓ | partial | ✓ | partial | ✓ |
| Core domain mechanisms | ✓✓ | ✓ | ✓✓ | ✓ | ✓ |
| How to extend (add endpoint, etc.) | – | – | ✓ (artifact) | – | ✓ |
| Background jobs | ✓ | ✓ | ✓ | ✓ | ✓ |

## Decision for round 2

Build **S6 = S1's structure + S5's onboarding topics + a consolidation stage**:
1. Mapper (Sonnet): topic list that MUST include the onboarding topics (entry/boot/env,
   request → handler, auth, how to extend), plus the domain mechanisms. No notes.
2. Topic workers (Haiku): trace and write FACTS to scratch JSON, not to the notebook.
3. Consolidator (Sonnet): one note per file (merging facts from every worker), one flow per
   mechanism (dedup), drop bug claims without evidence, drop framework-generic facts, then
   write the overview LAST from the verified flows.
4. Hub check: any top-15 hub with no note gets a file worker.

Compare S6 against S1 (unchanged) on nerimity-server (TS) and faynoSync (Go).
