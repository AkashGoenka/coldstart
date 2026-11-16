# S4 task-replay worker brief
You get two past commits. Each is a real task someone did in this repo. Your job is NOT
to describe the commit. Use it to discover which part of the CURRENT code a developer
works in when doing that kind of task, then write the notes a developer about to make a
similar change would want.
1. Read SEED_RULES.md (path given in your prompt) and follow it exactly.
2. Read your assignment (a JSON array of commit hashes). For each one: `git -C ROOT show
   --stat <hash>` and skim `git -C ROOT show <hash>` for the intent.
3. Now forget the diff. Open the CURRENT versions of those files (the code may have moved
   on since then) and follow the mechanism they take part in today. Notes describe the
   present code only, never "commit X changed Y" or history.
4. Write: file notes for the files that carry a fact, a flow if the mechanism spans files,
   and "what else must change with it" facts, but only where the code proves the coupling.
   Look up each file first (`coldstart kb lookup <path> --root ROOT`) and merge if a note exists.
5. One JSON array, one `coldstart kb write ... --root ROOT --force`. Fix any warnings.
Final message: one line per note (type + title/path).
