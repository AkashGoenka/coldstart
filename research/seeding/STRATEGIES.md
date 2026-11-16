# Seeding strategies under test

Every worker gets `SEED_RULES.md` (the note contract) verbatim, plus its strategy-specific
brief below. `<ROOT>` = the repo copy for that strategy, `<SCRATCH>` = a scratch dir.
Budget per strategy and repo: about 20–30 notes, so the strategies compare fairly.

## S1: Map, then topics (top-down)
1. **Mapper (Sonnet, writes no notes except an overview flow).** Reads the README, the
   tree, the manifests (Gemfile/package.json/go.mod), the entry points and the routing table.
   Produces a JSON list of 6–10 TOPICS, each a cross-cutting mechanism a developer would ask
   about ("how an API request is authenticated", "how a split assignment is decided"), with
   2–6 seed files per topic. May write ONE overview flow ("how <project> is put together")
   listing the entry points and subsystems, if that passes the contract's test.
2. **Topic workers (Haiku, 1 per topic, parallel).** Trace the topic through the code,
   starting from the seed files and following calls. Write one flow for the topic plus file
   notes for files on the path that carry a fact.

## S2: Hubs first (bottom-up, mechanical selection)
1. **Selection (script, no model).** Rank source files (tests, migrations, generated code
   and vendored code excluded) by `importedBy + cross-file callers + git commits touching
   the file`. Take the top 25.
2. **File workers (Haiku, 5 files each, parallel).** One file note per file that has a fact.
   No flows.
3. **Flow synthesizer (Sonnet).** Reads the file notes plus the code they cite, and writes
   3–6 flows for mechanisms that span those files.

## S3: Newcomer questions
1. **Question generator (Sonnet, writes nothing).** From the README, tree and manifests,
   writes the 12–15 questions a new developer on this project would ask in their first
   week, with concrete nouns from this repo ("where is the visitor's split assignment
   persisted?", "how do I add a new admin page?").
2. **Answer workers (Haiku, 3 questions each, parallel).** Answer each question by
   exploring the code. Then write the notes a future agent asking that question would want:
   a flow if the answer spans files, file notes for the files that answer it, an absence
   lesson if the answer is "it doesn't exist".

## S4: Task replay (from git history)
1. **Selection (script + me).** Pick ~10 non-trivial past commits (feature or fix, ≥ 2
   source files, not dependency bumps), spread across subsystems.
2. **Replay workers (Haiku, 2 commits each, parallel).** For each commit: read its message
   and `git show --stat`, treat it as the task "someone needs to do a change like this", and
   study the CURRENT code the change lives in (the present, not the diff's past). Write the
   notes a developer about to make a similar change would need: where it lives, what else
   must change with it, what is easy to get wrong.

## S5: Single agent (baseline)
One Sonnet agent with the whole job: explore the repo and write the 20–30 most useful
notes. Shows whether fan-out buys anything.

## How notebooks are judged
For each note I read the note and the code it cites, and label every note:
- **M — meaningful:** carries at least one verified fact the path, name and `gs` output
  don't give (wiring, ordering, side effect, invariant, gotcha, how-to-extend, why).
- **T — thin:** true, but mostly a restatement of the name/symbols, with at most a sliver
  of real content.
- **W — wrong:** contains a claim the code contradicts (one wrong claim makes it W).

Plus, per notebook: did it cover the things a newcomer needs (entry/boot, routing, auth,
the core domain mechanism, how to extend)? And what did it cost (agents, wall time)?
