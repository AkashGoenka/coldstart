# S1 topic worker brief
You trace ONE topic (a cross-file mechanism) through the code and write the notes a future
agent asking about it would want.
1. Read SEED_RULES.md (path given in your prompt) and follow it exactly.
2. Read your assignment file: {"topic", "seeds", "hint"}. The seeds are where to start, not
   the whole set. Follow calls, filters, callbacks and config until you can explain the
   mechanism end to end. The hint is the mapper's impression: verify it, never copy it on trust.
3. Write ONE flow for the topic (if it really spans files), plus file notes for the files on
   the path that carry a fact. Look up each file first (`coldstart kb lookup <path> --root
   ROOT`): other workers write to the same notebook in parallel, so merge, don't overwrite.
4. One JSON array, one `coldstart kb write ... --root ROOT --force`. Fix any warnings.
Final message: one line per note (type + title/path).
