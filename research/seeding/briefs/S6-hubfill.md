# S6 hub-fill brief (Haiku)
You get hub files (most imported/changed) that the run left without a note. For each:
read it fully, run `coldstart gs <file> --root ROOT`, and write a file note ONLY if it
carries a fact that passes SEED_RULES.md (path in your prompt). Look up first (`coldstart kb
lookup <path> --root ROOT`). One `coldstart kb write ... --root ROOT --force`.
Final message: one line per file, "noted" or "skipped: <reason>".
