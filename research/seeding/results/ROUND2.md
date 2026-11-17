# Round 2: S1 vs S6 on a TypeScript and a Go repo (v2 note rules)

Repos: nerimity-server (TS chat backend: Express + socket.io + Prisma + Redis, 631 files)
and faynoSync (Go update server: gin + Mongo + Redis + S3, 463 files). Both strategies used
SEED_RULES v2. Every note checked claim by claim by a Sonnet verifier; "W" is applied
strictly (any wrong claim, even when the verifier called it harmless).

| Repo | Strategy | Active notes | M | T | W | M % | W % |
|---|---|---|---|---|---|---|---|
| nerimity | S1 map → topic workers write | 72 | 63 | 6 | 3 | 88 | 4 |
| nerimity | S6 map → facts → consolidator | 60 | 56 | 1 | 3 | 93 | 5 |
| faynoSync | S1 | 73 | 65 | 6 | 2 | 89 | 3 |
| faynoSync | S6 (+ hub-fill) | 67 | 62 | 2 | 3 | 93 | 4.5 |

## Findings

1. **Accuracy is the same (3–5% of notes carry a wrong claim) and is now low on every stack.**
   The v2 evidence rules held across Rails, TS and Go: no false-bug notes at all in round 2
   (round 1's worst failure, 20% in S4), and workers routed doubts into "suspected" instead of
   asserting them (dozens of times).
2. **What still goes wrong is narrow and mechanical.** Of the 11 wrong notes:
   - 7 are universal claims that missed a caller: "only X", "not behind CheckPermission",
     "the only route using scopes", "called only from".
   - 3 misread a default or a key: a missing Redis key means *on*, not off; private skipping
     is keyed on a flag, not on the URL; a Date that is serialised as a number.
   - 1 is a minor wrong path.
   → A final audit that greps the code for every universal/default claim would catch most of
   them cheaply. This is now Stage 5 of SEED_PROMPT.md.
3. **The consolidator did not lower the wrong rate, but it removed real errors before they
   landed** (a false "only CreateTeamUser passes the DB", "moderators" that were really
   owner/ADMIN, five untraced inferences) and **cut the thin notes** (T: 6 → 1–2). Its
   value is structural:
   - one writer → no last-writer-wins overwrites (S1 workers overwrote `split.rb`,
     `latest.go` and others while working in parallel);
   - a budget → ~40 file notes chosen by importance instead of whatever each worker touched
     (S6 investigators produced facts on 69 and 111 files);
   - a real overview → S6's overview is a short subsystem map. S1's ended up as a deep boot
     note: very good, but not a map.
4. **Hub-fill pays off on Go**, where the import graph can't rank files (imports are per
   package): 8 of faynoSync's top-15 hubs had no note after consolidation (model.go,
   update.go, tuf storage), 6 of them got useful notes.
5. **Tooling trap:** re-running `kb write --force` with flows/lessons that carry no id
   creates `<id>-2` copies (41 byte-identical duplicates across the two S6 notebooks). The
   prompt now says "write once, fix by id", and Stage 4 lints and retracts exact copies.
6. **Verifier strictness varies**: one verifier kept notes with 3 wrong claims at M ("harmless").
   Numbers above re-apply the strict rule by hand. A shipped audit must make "any wrong claim →
   correct or retract" the instruction, not a judgment call.

## Cost (subagents per repo)

| Strategy | Sonnet | Haiku | Wall time |
|---|---|---|---|
| S1 | 1 mapper | 10–11 topic workers | ~3 min (parallel) |
| S6 | 1 mapper + 1 consolidator | 12 investigators + 1 hub-fill | ~6 min (two serial Sonnet stages) |

## Verdict

**Ship S6 + a claim audit** (SEED_PROMPT.md). S1 is a close second and cheaper: if a
single-pass seed is wanted, S1 with the same audit stage is acceptable, but it has the
overwrite and duplicate problems S6 avoids by having one writer.
