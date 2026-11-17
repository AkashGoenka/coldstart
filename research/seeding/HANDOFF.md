# Notebook seeding research: handoff

**Goal (from the user):** find the best strategy and prompt for SEEDING a coldstart notebook
before any agent has worked in a repo: project-level notes (how it works, entry points,
routing, auth, rendering, the core domain mechanisms) plus file-single notes for the files
that matter, so recall/embeddings/find summaries help from the first prompt. Not a note
per file. Workers are cheap models (Sonnet/Haiku). The ONLY judge is meaningfulness: does
a note say something the path, name and `gs` output don't already say? No retrieval
evals. Start with small repos, then medium, and skip large ones.

## Layout
- `SEED_RULES.md`: shared note contract given to every worker (the meaningfulness bar).
- `STRATEGIES.md`: S1–S5 definitions + the judging rubric (M meaningful / T thin / W wrong).
- `briefs/`: per-strategy worker briefs.
- `scripts/hubs.sh`: S2 file ranking (importedBy×3 + git churn).
- `results/`: per repo × strategy, exported notes + judgments (added as rounds finish).

## Environment (recreate in a fresh container)
```
cd ~/coldstart && npm ci && npm run build && npm link       # `coldstart` on PATH
mkdir -p /home/user/repos && cd /home/user/repos
git clone --depth 300 https://github.com/Betterment/test_track.git      # Rails, 366 files
git clone --depth 300 https://github.com/Nerimity/nerimity-server.git   # TS,    631 files
git clone --depth 300 https://github.com/ku9nov/faynoSync.git           # Go,    463 files
# one copy per strategy: cp -r test_track test_track__s1 ... (each gets its own notebook)
# `coldstart kb init` writes .claude/settings.json into the repo: delete it.
```
Medium candidates for round 3: csa-admin-org/csa-admin (Rails), funmusicplace/mirlo (TS),
spatiumnorth/spatiumddi (Python).

Write mechanics learned: `coldstart kb write <json> --root R --force`. File notes merge
BY PATH and the summary is last-writer-wins, so parallel workers must `kb lookup` first and
merge text. Copies live outside the repo (the container is ephemeral; the notes worth
keeping get exported into `results/`).

## Findings so far (round 1, from reading notes against code)
- The contract works: even Haiku writes dense, verified gotchas (CORS `end_with?` suffix
  match lets evilexample.org in; SAML `find_or_initialize_by`+`update!` auto-creates admins;
  `AppVersionType#cast` swallows errors while `serialize` raises).
- Topic workers told to "verify the hint, never copy it" caught 5+ wrong mapper hints,
  usually by reading the specs. Keep that instruction and tell workers to use specs.
- FAILURES to fix in the prompt:
  1. Duplicate flows from parallel workers (S3 has two flows for deterministic assignment).
     → need a consolidation stage, or one owner per topic/file.
  2. File-note summaries are last-writer-wins: parallel workers overwrite each other's text.
  3. Question-shaped artifacts: "no api v5 in this repo" (my question said "e.g. v5").
  4. Generic framework knowledge ("Rails maps Api::V5::Foo to …") and trivia (.rubocop_todo).
  5. WRONG "bug" claims: S4 c3 wrote that v3/v4 routes pass nil because routes say
     `param: :timestamp` and controllers read `params[:build_timestamp]`. False: Rails names
     a nested resource's parent param `build_timestamp`. A note claiming a bug is the most
     dangerous kind → rule: never assert a bug/inconsistency unless you ran it or a spec shows it.
  6. Haiku makes stray session-tool calls (list_sessions, send_message) → restrict tools.
- Idea for S6 (round 2): workers write FACTS to scratch JSON, not to the notebook; one
  Sonnet consolidator merges per-file facts into one note per file and dedups flows.
- 2026-11-16 the user's 5-hour limit was hit mid-run (work bills plan usage, not credits).
  Interrupted agents were resumed with SendMessage on 2026-11-17.

## Status log
- Round 1 (test_track, all 5 strategies): workers launched. S5 done (26 notes). S1 mapper
  done (10 topics + overview flow). S3 questions done (15). S1×10, S2×5 and S3×5 workers running;
  S4 (10 commits, 5 workers) waiting for free subagent slots (cap: 20 concurrent).
- Round 1 DONE: results/test_track/JUDGMENT.md (S1 best 95% M / 2% W; S5 cleanest; S4 worst
  20% W, dropped). Notebooks exported to results/test_track/sN/.
- SEED_RULES.md is now v2 (evidence rules); v1 kept as SEED_RULES.v1.md.
- Round 2 (2026-11-17): S1 (v2 rules) vs S6 (map → investigators write facts → Sonnet
  consolidator → hub-fill) on nerimity-server (TS) and faynoSync (Go). Copies:
  /home/user/repos/<repo>__s1, __s6; scratch /home/user/scratch/<repo>-s1|s6. Mappers launched.
  Go note: imports are per package, so hubs.sh importedBy is ~0 for central Go files.
- Round 2 progress (2026-11-17): all 4 mappers done (topics.json in each scratch dir).
  Launched: faynoSync S6 investigators t1–t12, nerimity S6 t1–t8 (facts → SCRATCH/facts-tN.json).
  QUEUED (not yet launched): nerimity S6 t9–t12; nerimity S1 t1–t10; faynoSync S1 t1–t11
  (S1 workers use briefs/S1-topic-worker.md and write to the notebook directly).
  After investigators: S6 consolidator (briefs/S6-consolidator.md, Sonnet) per repo, then
  hub-fill for hubs with no note, then VERIFIER on all 4 notebooks.
  To check which investigators finished: ls /home/user/scratch/<repo>-s6/facts-*.json
- SAFETY (must-fix for any real `seed` command): Haiku workers repeatedly call session tools
  despite "use only Bash/Read/Grep/Glob" in the prompt: send_message ×3, list_sessions,
  create_session, archive_session (placeholder id). All were denied by the permission
  classifier; nothing happened. A shipped seeding command must launch workers with an
  explicit tool allowlist (e.g. `claude -p --allowedTools "Bash Read Grep Glob"`), never
  rely on prompt wording.
- 2026-11-17 later: all S1 workers done (both repos). S6 consolidators done: faynoSync 61
  notes, nerimity 60. TOOLING TRAP found: re-running `kb write --force` without ids on
  flows/lessons coins `<id>-2` copies (41 byte-identical dups, retracted). Rule added to
  S6-consolidator.md ("WRITE ONCE"). faynoSync S6 hub-fill running (8 uncovered hubs).
  Verifiers running: nerimity s1+s6, faynoSync s1 (s6 after hub-fill) → results/<repo>/.
