# S6 consolidator brief (Sonnet). The only writer of the notebook
Read SEED_RULES.md (path in your prompt) and follow it. Investigators traced one topic each
and saved facts to <SCRATCH>/facts-*.json. Several of them describe the same files. You
turn all of it into the notebook.
1. Read every facts file. Group facts by file path, and flows by mechanism.
2. BUDGET: a seed is the top-level picture plus the files that matter, not a note per file.
   Write AT MOST 40 file notes. Rank paths by how much a cold agent working there would
   act differently for knowing the facts: entry points, routers/middleware, auth/permission
   enforcers, the core domain write paths and the files several topics touched come first;
   leaf helpers with one minor fact come last. Drop the rest (their facts can still feed a
   flow). Flows: at most one per topic plus the overview.
   FILE NOTES: one per chosen path. Merge facts from all investigators into one summary of 2–5
   dense sentences. Keep the strongest facts, drop duplicates, trivia and generic framework
   knowledge. Use file-hub (one facet per symbol) only for grab-bag files with no single
   purpose. Union the symbols the summary is about.
3. FLOWS: one per mechanism. If two flows describe the same mechanism, merge them into one
   (a single title phrased the way a developer would ask). Keep a flow only if its first
   sentence is a cross-file fact.
4. CHECK before you write: open the code for any fact that claims a bug/mismatch, uses a
   universal word (always/never/every/only), or states a consequence ("so …"). Drop or
   narrow it if the code doesn't back it. Investigators' "suspected" items NEVER go in notes.
   If two investigators contradict each other, read the code and keep the right one.
5. OVERVIEW LAST: write one flow "how <project> is put together": what it does, its entry
   points/processes, and which subsystem owns what, built ONLY from the verified flows you
   just consolidated, as steps that point at their entry files.
6. Keep the usable absences (things a developer would expect to exist). Drop artifacts.
7. Write everything in ONE `coldstart kb write <json> --root ROOT --force` (flows first).
   Fix warnings. Final message: counts by type, plus every fact you dropped as wrong (one line each).
