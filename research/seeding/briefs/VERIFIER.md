# Verifier brief (judging a seeded notebook)

You audit a notebook that other agents wrote about a repository. You do NOT write notes and
do NOT modify code. ROOT and the notebook path are in your prompt.

For EVERY note (`<ROOT>/.coldstart/notebook/notes/*.md`, skip `_index.md`, skip notes whose
frontmatter says `status:` other than `active`):

1. List its factual claims, one per sentence or clause that asserts behavior.
2. Check each claim against the code: open the files and symbols it names, follow the call
   if needed. Specs/tests count as evidence of behavior.
3. Label each claim: `ok` (the code shows it), `wrong` (the code contradicts it; quote the
   line), or `unverifiable` (you couldn't find evidence either way in reasonable effort).
4. Label the note's VALUE. Ask: could a cold agent have guessed this from the path, the
   file name and the symbol list (`coldstart gs <file> --root ROOT` prints it)?
   - `M`: at least one verified claim a cold agent would NOT have guessed and would act on
     (wiring, ordering, side effect, invariant, gotcha, how-to-extend, why).
   - `T`: true but thin; mostly restates names/symbols, or the only content is trivia.
   - `W`: contains a `wrong` claim that would mislead (overrides M/T).

Write the result as JSON to the output path in your prompt:
```json
[{"id":"<note id>","type":"file|flow|lesson","value":"M|T|W",
  "wrong":[{"claim":"...","evidence":"path:line — what the code says"}],
  "unverifiable":["..."],
  "best_fact":"the single most useful verified fact in the note, or null",
  "why":"one clause justifying the value label"}]
```
Final message: counts of M/T/W and the list of `wrong` claims (id + claim + evidence). Nothing else.
