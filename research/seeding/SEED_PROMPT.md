# Seed a coldstart notebook (orchestrator prompt)

Paste everything below the line into Claude Code, run from the root of a repository that
has coldstart installed (`coldstart kb init` done). You (the orchestrator, any model) never
write notes yourself; you run four stages with subagents and check their output. Expected
cost for a 300–700-file repo: 1 Sonnet mapper, ~10–12 Haiku investigators, 1 Sonnet
consolidator, 1 Haiku hub-fill; about 40 file notes + 10–13 flows + a few absences.

---

You are seeding this repository's coldstart notebook before any agent has worked here.
Future agents arrive cold; these notes are what they see first, next to `coldstart find`
results and when their prompt matches a note. The seed is the top-level picture (entry
points, how requests reach handlers, auth, how to extend, the core mechanisms) plus notes
on the files that matter. NOT a note per file. Real task work will refine it later.

ROOT = the current repository root. SCRATCH = a new directory outside the repository
(e.g. `$TMPDIR/coldstart-seed`). Run every coldstart command with `--root ROOT`.

## Safety rules for every subagent you start
- Give it ONLY Bash, Read, Grep and Glob. If your host lets you set an allowed-tools list
  for subagents, set it; do not rely on the prompt alone (cheap models reach for session,
  messaging and scheduling tools when those are visible).
- It must never modify code, run the project, or install anything.
- It must never copy secret values into notes or scratch files.

## The note contract (paste this section verbatim into EVERY subagent prompt)

<contract>
THE ONE TEST: before you keep a sentence, ask: could a cold agent have guessed this from
the file path, the file name and the symbol list that `coldstart gs <file>` prints? If yes,
delete it. A note pays off only when it says what those leave out.

BAD: "users_controller.rb: controller that handles user API requests. Defines index, show,
create and update." GOOD: "Every action authenticates by app API key, not user session
(`before_action :authenticate_app!` reads X-App-Key). `create` is an upsert keyed on email
and never returns 409; it enqueues WelcomeMailerJob only for new rows, so replays are safe."

WORTH WRITING: where execution starts and what boots in what order; where config/env is
read and what fails without it; how a request/command/event reaches its handler (routing
convention, middleware/filter ORDER, wiring the import graph can't see: registries, naming
conventions, reflection, DI, decorators, routes in config); where auth, permissions,
validation, transactions, caching, rate limits are enforced (name the symbol) and what
bypasses them; side effects, idempotency, ordering, swallowed errors, surprising defaults;
invariants; "to add a new X you must touch A, B and C" when the parts don't point at each
other; a design reason only if the code or a comment shows it.

EVIDENCE RULES (most wrong notes break one of these):
1. State what the code DOES, not what it implies. A consequence ("so destroying X leaves
   NULLs") only if you traced it to the end or a test shows it.
2. Never claim a bug, mismatch or dead wiring ("this passes nil", "this selector matches
   nothing", "this branch is unreachable") unless a test or a run shows it. A mismatch you
   see between two files is almost always a framework convention you don't know (Rails
   nested routes rename params; gin's router.Use only affects routes registered after it).
   Put such things in "suspected", never in a note. A false bug note makes the next agent
   "fix" working code.
3. Know the framework default before contradicting it (required associations, default
   scopes, nested-param naming, middleware order, init order). Unsure → describe only what
   the code says.
4. "always/never/every/only/unless" need every caller or branch checked (grep the symbol).
   One unchecked path makes the claim wrong. Otherwise say "on the X path".
5. Tests are evidence: cite them when they assert the behavior.

NEVER WRITE: "This file contains/defines/handles…"; lists of functions, imports or
importers (the graph has them); quality words (robust, clean, core); guesses (likely,
probably, seems); anything from a file you didn't open; generic framework knowledge any
developer of the stack has; trivia nobody acts on (lint config, memoization, display
fallbacks); absences nobody would expect to exist (only write an absence a developer would
plausibly assume IS there: caching, retries, rate limits, authorization, a scheduled job,
tests for X); secret values.
</contract>

## Stage 0: candidates (you, no model calls)
1. `coldstart index --root ROOT` (wait for it).
2. Rank likely hub files: for each tracked source file (skip tests, migrations, vendored,
   generated, fixtures), score = 3 × importedBy (from `coldstart gs <f> --root ROOT
   --view importers`, first line) + number of commits touching it (`git log --oneline --
   <f> | wc -l`). Keep the top 20 in SCRATCH/hubs.txt. Note: in Go, imports are per package,
   so importedBy is ~0 for central files and commit count is the signal.

## Stage 1: mapper (ONE Sonnet subagent; writes no notes)
Prompt it with the contract plus:
> Orient yourself in ROOT (README, manifests, entry points, the routing/command table, the
> top of the tree). HUBS are in SCRATCH/hubs.txt. Produce 8–12 TOPICS, each a mechanism
> spanning files that a developer would ask about. The list MUST begin with these
> onboarding topics, adapted to the repo (drop one only if the repo truly has none):
> (1) what the system is, its entry points/processes, and how it boots (config/env);
> (2) how a request/command/event reaches its handler (routing, middleware order);
> (3) how auth and permissions are enforced; (4) how to add the most common new thing
> (endpoint, command, page, job). Then the repo's own domain mechanisms. Every hub should
> fall under some topic's seeds unless trivial. Each topic: 2–6 seed files and a one-line
> hint ONLY if you read something non-obvious (hints get verified; a wrong hint costs a
> correction, a missing one costs nothing). Save SCRATCH/topics.json as
> [{"id":"t1","topic":"…","seeds":["path"],"hint":"…"}]. Write no notes.

## Stage 2: investigators (ONE Haiku subagent PER topic, in parallel)
Prompt each with the contract plus:
> You trace ONE topic: SCRATCH/<id>.json (write each topic to its own file first). Start
> at the seeds and follow calls, middleware, callbacks, config and tests until you can
> explain the mechanism end to end. The hint is unverified: check it, never copy it. Do NOT
> run `coldstart kb write`. Save ONE JSON file, SCRATCH/facts-<id>.json:
> {"topic":"…",
>  "flow":{"title":"how …","summary":"first sentence = the cross-file fact",
>          "steps":[{"path":"…","symbols":["…"],"role":"…"}],
>          "invariants":["…"],"verified":["every step file you opened"]} or null,
>  "files":[{"path":"…","symbols":["what the facts are about"],
>            "facts":["one verified non-obvious fact each"],
>            "evidence":["test or code path:line"]}],
>  "absences":[{"title":"no … in this repo","body":"what you searched, where","terms":["…"]}],
>  "suspected":["looks like a bug/mismatch but unproven; NEVER in facts"]}
> Record facts for every file you read that carries one, 1–4 facts per file. Use
> `coldstart find <terms> --root ROOT` and `coldstart gs <file> --root ROOT` to see what is
> already visible. Final message: the facts file path and fact count.

Check each facts file parses (`python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' <f>`);
re-run a topic whose file is missing or invalid.

## Stage 3: consolidator (ONE Sonnet subagent; the only writer)
Prompt it with the contract plus:
> Investigators each traced one topic into SCRATCH/facts-*.json; several describe the same
> files. Turn them into the notebook.
> 1. Read every facts file. Group facts by path and flows by mechanism.
> 2. BUDGET: at most 40 file notes. Rank paths by how much a cold agent working there would
>    act differently for knowing the facts: entry points, routers/middleware, auth and
>    permission enforcers, core write paths, files several topics touched come first; leaf
>    helpers with one minor fact last. Dropped files' facts may still feed a flow.
> 3. FILE NOTES, one per chosen path, 2–5 dense sentences merging all investigators' facts;
>    drop duplicates, trivia and generic framework knowledge. Shape:
>    {"type":"file-single","path":"…","summary":"…","anchors":[{"path":"…","symbols":["…"]}]}
>    Use {"type":"file-hub","path":"…","facets":[{"symbol":"…","detail":"…"}]} only for
>    grab-bag files with no single purpose.
> 4. FLOWS, one per mechanism; merge two flows about the same mechanism under one title
>    phrased the way a developer would ask. Keep a flow only if its first sentence is a
>    cross-file fact. Shape: {"type":"flow","title":"how …","summary":"…","steps":[…],
>    "invariants":[…],"verified":[every step path]}. "verified" is what files the note;
>    a step path missing from it is invisible to `kb lookup`.
> 5. CHECK before writing: open the code for any fact that claims a bug or mismatch, uses
>    always/never/every/only, or states a consequence. Narrow or drop it if the code does
>    not back it. Where investigators contradict each other, read the code and keep the
>    right one. "suspected" items never become notes.
> 6. OVERVIEW LAST: one flow "how <project> is put together": what it does, its entry
>    points/processes, and which subsystem owns what, as steps pointing at each subsystem's
>    entry file. Build it ONLY from the flows you just verified. It is a map, keep it short.
> 7. Absences: keep those a developer would expect to exist; merge per-topic "no tests for
>    X" into one lesson. Shape: {"type":"lesson","kind":"absence","title":"no …",
>    "body":"…","scope":{"terms":["…"]}}.
> 8. WRITE ONCE: everything in one JSON array (flows first) via `coldstart kb write <file>
>    --root ROOT --force`. Re-running it with flows/lessons that carry no "id" creates
>    `-2` duplicates; to fix anything afterwards, re-put only that note WITH its "id".
>    Fix any warning it prints that way. Final message: counts by type plus every fact you
>    dropped as wrong (one line each).

## Stage 4: hub-fill (ONE Haiku subagent) and checks (you)
1. For each path in SCRATCH/hubs.txt: `coldstart kb lookup <path> --root ROOT`. Collect
   those with no file note.
2. Give that list to one Haiku subagent with the contract plus: "For each file: read it
   fully, run `coldstart gs`, and write a file note ONLY if it carries a fact that passes
   the contract; skip type/constant-only files. One `kb write --force`."
3. `coldstart kb lint --root ROOT`: if it reports duplicate flows that are byte-identical
   copies (`<id>` and `<id>-2`), retract the `-2` one
   (`{"op":"retract","id":"<id>-2","target":{"kind":"note"}}`).
4. `coldstart kb repair --root ROOT`: fix anything it surfaces by re-putting with the id.
## Stage 5: claim audit (ONE Sonnet subagent; do not skip)
In testing, 3–5% of seeded notes still carried a wrong claim, and nearly all were of two
kinds. Have one Sonnet subagent (contract + this) audit them:
> Open every active note in ROOT/.coldstart/notebook/notes/. Select each sentence that
> (a) uses a universal word: only, every, all, never, always, none, sole, "not behind",
> "no other"; or (b) states a default or what a key/flag/missing value means ("defaults
> to", "when unset", "keyed on", "is a string/number", "means off/on"). For each one,
> grep the code for every caller/branch/definition involved and check it. Any claim that
> does not hold: correct the note (re-put with its "id", same shape, the fixed sentence)
> or narrow it ("on the X path"). Never leave a wrong claim in place because it looks
> harmless. Final message: each corrected claim, before → after.

## Stage 6: report
6. Report: note counts by type, files covered, facts dropped as wrong, and the overview's id.
   `coldstart kb commit` when the human wants the seed shared with the team.
