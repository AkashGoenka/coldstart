# Seeding a coldstart notebook: what works

**Question.** Before any agent has worked in a repo, can cheap agents (Sonnet/Haiku) write
a notebook good enough that recall, embeddings and `find` summaries help from the first
prompt? And which strategy writes the most *meaningful* notes, meaning notes that say
something the path, the file name and `coldstart gs` don't already say?

**Answer.** Yes, with one caveat. The recommended pipeline (`SEED_PROMPT.md`) produces
about 60 notes per 500-file repo, using 2 Sonnet and ~13 Haiku subagents in ~6 minutes.
~93% are meaningful and ~2% thin. A single verifier finds a wrong claim in 3–5% of notes,
**but a second, independent check found a different set of errors of about the same
size**, so the real rate before auditing is closer to ~10%. The final claim-audit stage
fixed 6 of them on one repo. Expect a seed to be mostly right, not fully right: notes are
cheap to correct, and real task work corrects them over time.

## What was tested

| Round | Repo | Stack | Strategies |
|---|---|---|---|
| 1 | Betterment/test_track (366 files) | Rails | S1–S5, rules v1 |
| 2 | Nerimity/nerimity-server (631) | TS: Express, socket.io, Prisma, Redis | S1, S6, rules v2 |
| 2 | ku9nov/faynoSync (463) | Go: gin, Mongo, Redis, S3 | S1, S6, rules v2 |

Strategies: **S1** map → one Haiku worker per topic writes notes. **S2** rank hub files by
graph + churn → Haiku per batch, then Sonnet writes flows. **S3** Sonnet writes newcomer
questions → Haiku answers and writes notes. **S4** replay past commits as tasks. **S5** one
Sonnet agent does everything. **S6** map → Haiku investigators write *facts* (not notes) →
one Sonnet consolidator writes the notebook under a budget → hub-fill.

Every one of ~560 notes was checked claim by claim against the code by a Sonnet verifier
(`results/*/*.verdicts.json`); I spot-checked the verifiers' "wrong" calls and read samples
for meaningfulness myself.

## Results

Round 1 (Rails, rules v1): S1 95% M / 2% W · S5 88% / 0% · S2 85% / 11% · S3 81% / 8% ·
**S4 65% / 20%** (dropped). → `results/test_track/JUDGMENT.md`

Round 2 (TS + Go, rules v2): S1 88–89% M / 3–4% W · **S6 93% M / 4–5% W**, fewer thin notes,
no overwrites, a real overview. → `results/ROUND2.md`

## The lessons (the part worth keeping)

**1. The contract matters more than the model.** Haiku writes dense, verified, non-obvious
notes when it is given (a) the one test, "could a cold agent guess this from the name and
`gs`?", (b) a concrete list of what is worth writing (boot order, middleware order, where a
rule is enforced and what bypasses it, side effects, invariants, how to extend), and (c) a
bad/good example pair. Without (a), notes restate file names.

**2. Wrong notes have a small number of causes, and each can be named in the prompt:**
- *False bug claims*: a worker sees two files "disagree" and reports a bug, when it's a
  framework convention (Rails renames nested route params). The single most damaging note
  type, because the next agent "fixes" working code. Fix: never claim a bug without a
  test or a run, and give workers a `suspected` channel. Round 2 had zero false-bug notes.
- *Framework defaults* (required `belongs_to`, default scopes, gin's `Use` ordering).
- *Inferred consequences*: "so destroying it leaves NULLs" when the column is NOT NULL.
- *Universal words*: "only", "every", "never" without checking every caller. This is what
  still causes most of the remaining errors. Fix: the Stage-5 audit greps each one.
- *Defaults and key meanings*: "a missing key means off" when it means on.

**3. Partition the work, then have one writer.** Topic partitioning (S1) is what makes
flows distinct and deep; question-driven fan-out (S3) duplicates them. But parallel
workers writing the notebook directly overwrite each other's file summaries (last writer
wins), so the best shape is workers → facts → one consolidator (S6).

**4. The overview must be written last.** The one wrong note in S1's best round-1 run was
the mapper's overview, written from a skim before any tracing. Written last, from the
verified flows, it becomes an accurate subsystem map.

**5. Seed the onboarding layer explicitly.** Topic lists drift toward domain mechanisms.
Only the single-agent run wrote "how the app boots / which env vars matter" and "how to
add an endpoint" on its own. The mapper is now required to start with four onboarding
topics: boot, request → handler, auth, how to extend.

**6. Graph centrality is a supplement, not a driver.** Hub-first (S2) missed auth and CORS
entirely because those files aren't hubs, and in Go `importedBy` is ~0 for central files
(imports are per package). Hubs work as a final check: "which central file has no note?"

**7. Don't replay history.** Task replay (S4) primes workers to hunt for problems and
produced the most wrong notes; recent commits are also often cosmetic.

**8. Budget the seed.** Investigators produce facts on every file they open (111 files on
faynoSync). A seed should be ~40 file notes chosen by how much a cold agent would act
differently, plus one flow per mechanism. The rest is for real task work.

## Things a shipped `coldstart kb seed` must handle

- **Tool allowlist for workers.** Haiku workers repeatedly tried session tools despite the
  prompt forbidding them (send_message, create_session, archive_session,
  interrupt_session, list_sessions). All were denied by the permission layer, but a
  shipped command must start workers with an explicit allowlist (Bash Read Grep Glob).
- **`kb write --force` is not idempotent for flows/lessons without an id**: a re-run coins
  `<id>-2` copies (41 duplicates across two notebooks). Either make write dedupe identical
  re-puts, or keep the prompt's "write once, fix by id" rule and the lint/retract step.
- **Concurrent file-note writes are last-writer-wins on `summary`.** That's fine with one
  writer, but it argues against letting parallel workers write directly.
- **Provenance.** Seeded notes are not task-born. It may be worth tagging them (e.g.
  `origin: seed`) so recall can weight them and repair can prefer replacing them.
- **Usage.** A full run is ~15 subagents. Two runs hit the 5-hour limit mid-way. Interrupted
  agents resume from their transcript; the handoff file made recovery trivial.

## Files

- `SEED_PROMPT.md`: the deliverable, a self-contained orchestrator prompt (S6 + audit).
- `SEED_RULES.md`: the v2 note contract (v1 kept for comparison).
- `STRATEGIES.md`, `briefs/`: the strategies and worker briefs as tested.
- `results/`: every notebook, every verdict, the round-1 judgment and the round-2 comparison.
- `scripts/hubs.sh`, `scripts/dump.sh`: hub ranking and note dumping.
- `HANDOFF.md`: running log for resuming the work.

## Not done (next steps)

- A second, differently-prompted audit pass (per-flow-step role check) and measuring the
  combined catch rate. One pass catches roughly half of the wrong claims.

- Medium repos (1–3k files): the budget and topic count probably need to scale (2 mappers by
  area, or 15–20 topics). Untested.
- Embedding check: whether seeded notes actually win recall against real prompts (you ruled
  this out of scope for now; the notebooks in `results/` are ready for it).
- Implementing this as `coldstart kb seed` (orchestrating `claude -p` workers with an
  allowlist, writing `origin: seed`).
