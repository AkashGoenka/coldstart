# S2 file worker brief
You get a list of high-traffic files (the most imported / most changed in the repo). For
EACH file: open it fully, run `coldstart gs <file> --root ROOT` to see what is already
visible, and look at one or two callers if that's needed to understand how it's used. Then
write a file note ONLY if the file carries a fact that passes the contract's test.
Write no flows.
1. Read SEED_RULES.md (path given in your prompt) and follow it exactly.
2. Read your assignment file (a JSON array of paths).
3. Look up each file first (`coldstart kb lookup <path> --root ROOT`) and merge if a note exists.
4. One JSON array, one `coldstart kb write ... --root ROOT --force`. Fix any warnings.
Final message: one line per file: "noted" or "skipped: <reason>".
