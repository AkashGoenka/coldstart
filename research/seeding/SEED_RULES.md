# Seed-note contract (shared by every seeding strategy)

You are writing the FIRST notes in this repository's notebook. Nobody has worked here
with coldstart yet. Future coding agents will arrive cold, and these notes are what they
see first: next to `coldstart find` results, at the start of a turn when the prompt
matches, and in `coldstart kb search`. Real task work will replace your notes over time,
but until then they are the only map.

## The one test every sentence must pass

Before you keep a sentence, ask: **could a cold agent have guessed this from the file
path, the file name and the symbol list that `coldstart gs <file>` prints?** If yes, delete
it. That agent already has those for free. A note pays off only when it says what those
leave out.

BAD (restates the name, worthless):
> `app/controllers/api/v1/users_controller.rb` — Controller that handles user-related API
> requests. Defines index, show, create and update actions for users.

GOOD (things you only learn by reading it):
> Every action here authenticates by app API key, not by user session: `before_action
> :authenticate_app!` reads the `X-App-Key` header, and there is no user login on the API
> side at all. `create` is an upsert keyed on `email` (it never returns 409), and it
> enqueues `WelcomeMailerJob` only when the row was new, so replaying the request is safe.

## What is worth writing down (look for these)

- **Entry and boot:** where execution starts, what gets initialized and in what order,
  where config/env is read, and what fails if it's missing.
- **How a request/command/event reaches its handler:** routing convention, middleware or
  filter ORDER, where the handler is chosen. Especially wiring the import graph can't see:
  string registries, naming conventions, reflection, DI containers, decorators, routes
  declared in config, templates that reference code by name.
- **Where a cross-cutting rule lives:** auth, permissions, validation, transactions,
  caching, rate limits, tenancy. Name the exact symbol that enforces it, and what bypasses it.
- **Behavior a reader would get wrong:** side effects (writes, enqueues, emits, caches),
  idempotency, ordering, error handling that swallows, defaults that surprise, a legacy or
  deprecated path still live, a dead path that looks live.
- **Invariants:** what must stay true, and what breaks if it doesn't.
- **How to extend:** "to add a new X you must touch A, B and C", ONLY when you saw that the
  parts are not discoverable from one another.
- **Why:** a non-obvious design choice, ONLY if the code or a comment shows the reason.

## Evidence rules (most wrong notes break one of these)

1. **State what the code DOES, not what it implies.** "`has_many :splits, dependent:
   :nullify`" is a fact. "So destroying an app leaves splits with NULL owners" is an
   inference, and it was wrong (the column is `null: false`, so it raises). Write a
   consequence only if you traced it to the end or a spec/test shows it.
2. **Never claim a bug, a mismatch or dead wiring** ("this route passes nil", "the path
   never supplies X", "this selector matches nothing") unless a spec/test or a run shows it.
   Mismatches you see between two files are almost always a framework convention you don't
   know. Example: in Rails, `resources :builds, param: :timestamp` gives nested routes
   `params[:build_timestamp]`, so a controller reading that key is correct. A false bug
   note is the most damaging note there is: the next agent will "fix" working code.
3. **Know the framework's defaults before you contradict them.** Required `belongs_to`,
   default scopes on associations, nested-param naming, middleware order, decorator
   registration, init/`init()` order, and so on. If you are not sure what the framework
   does, describe only what the code says.
4. **No universal words without checking every path.** "always", "never", "every",
   "only", "unless X" need you to have looked at every caller or branch. One unchecked
   path makes the claim wrong. Say "on the X path" instead.
5. **Specs and tests are evidence.** When a spec asserts the behavior, cite it.

## Never write

- Generic framework knowledge any developer of that stack already has ("Rails maps
  `Api::V5::Foo` to `app/controllers/api/v5/foo_controller.rb`").
- Trivia nobody acts on: lint-config entries, memoization details, display fallbacks,
  typo-level observations.
- Absence lessons for things nobody would expect to exist ("no api v5"). An absence is
  worth a lesson only when a developer would plausibly assume it IS there (caching,
  retries, rate limiting, authorization, a scheduled job, a test suite for X).
- "This file contains / defines / is responsible for / handles …" followed by its name.
- A list of the file's functions, classes, imports or importers. The graph has them.
- Generic quality words: "robust", "clean", "well-structured", "core", "central".
- Guesses: "likely", "probably", "seems to", "presumably". If you didn't verify it, leave it out.
- Anything from a file you didn't open. Every claim comes from code you read.
- Secret VALUES (keys, tokens, passwords, env contents). Naming the variable is fine.

## Which files deserve a note

Not every file. Write a file note only when the file holds at least one fact from the
"worth writing down" list. Skip trivial files (plain models with only fields, generated
code, simple re-exports, tests, fixtures, migrations), unless one carries a real gotcha.
A short, dense note beats a long, padded one: 2–5 sentences per file is the target.

## Note shapes (exactly as `coldstart kb write` expects)

File note (single purpose, the default):
```json
{"type":"file-single","path":"<repo-relative path>",
 "summary":"2-5 dense sentences that pass the test above",
 "anchors":[{"path":"<same path>","symbols":["TheSymbolsTheSummaryIsAbout"]}]}
```
`symbols` are the identifiers your summary talks about. They make the note findable by
name. List only the ones the summary is about, not every symbol in the file.

File note for a grab-bag file with no single purpose (utils, helpers, a big models file),
one facet per symbol that has something non-obvious:
```json
{"type":"file-hub","path":"<path>",
 "facets":[{"symbol":"SomeFn","detail":"the non-obvious thing about THIS symbol"}]}
```

Flow note: how the system behaves across files. Write one ONLY when the fact spans
files and no single file note would carry it:
```json
{"type":"flow","title":"how <X> happens",
 "summary":"FIRST sentence = the cross-file fact a reader of the file notes would still miss. Then 1-3 more.",
 "steps":[{"path":"<file>","symbols":["entrySymbol"],"role":"what this hop does in the chain"}],
 "invariants":["what must hold across the chain"],
 "verified":["every step file you actually opened"]}
```
`verified` is what files the flow note at each path. A step file left out of `verified` is
invisible to `kb lookup`. Titles are lowercase "how …" or a plain statement of the
mechanism, phrased the way a developer would ask about it.

Confirmed absence (you looked and it is NOT there, a useful fact for planning):
```json
{"type":"lesson","kind":"absence","title":"no <thing> in this repo",
 "body":"what you searched for, where, and that it is not there",
 "scope":{"terms":["terms","you","searched"]}}
```

## Writing

1. Before writing a file note, run `coldstart kb lookup <path> --root <ROOT>`. If a note
   exists, another agent wrote it: keep its facts and ADD yours in one merged summary.
   Your write replaces the summary text, so dropping theirs loses knowledge.
2. Put all your notes in ONE JSON array in a file, flows first, and write them once:
   ```bash
   cat > <SCRATCH>/notes-<yourname>.json <<'JSON'
   [ {...}, {...} ]
   JSON
   coldstart kb write <SCRATCH>/notes-<yourname>.json --root <ROOT> --force
   ```
3. Read the command's output. Fix any WARNING it prints with one more write (same path or
   id, fields merge).

## Tools

Use ONLY Bash, Read, Grep and Glob. Never call session, messaging, scheduling or agent
tools. Never run code that changes the repository.

- `coldstart find <terms...> --root <ROOT>`: ranked files for a concept. Pass several identifiers.
- `coldstart gs <file> --root <ROOT>`: a file's symbols, importers, callers and related files.
  Use it to see what is ALREADY visible, so you don't repeat it.
- Read / Grep / Glob for the code itself.
- Run all commands from inside `<ROOT>`, or pass `--root <ROOT>`.
