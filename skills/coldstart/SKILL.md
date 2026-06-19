---
name: coldstart
description: Find which files are relevant to a task BEFORE reading or grepping. Use coldstart whenever you need to locate code by concept (a feature, symbol, model, route, config), trace who uses/calls/imports a file, or map an unfamiliar codebase. Reach for it first instead of Grep/Glob/find — it matches concepts against indexed filenames, path segments, and exported symbols across the whole repo in one fast local call, and tells you who depends on a file. Two commands: `coldstart go` (locate files) and `coldstart gs` (drill into one file).
---

# coldstart

A static codebase navigator. It answers two questions fast and locally (no model call):
- **`go`** — which files are relevant to this concept?
- **`gs`** — for one file: its symbols, who imports it, who calls each symbol, and name-related neighbors.

Use it BEFORE Read/Grep/Glob when you're orienting in a codebase or finding where something lives. It's ~10× cheaper than bash-grep for concept lookups and it sees the import graph, which grep cannot.

## The flow

1. `coldstart go <concept>` → pick the best path from the result.
2. `coldstart gs <that file>` → see its shape + who uses it.
3. `Read` only when you need the actual implementation inside a method body.

## Commands

```
coldstart go <query...> [--path GLOB] [--tests] [--max N] [--json]
coldstart gs <file>     [--match TERM] [--view full|symbols|imports|importers|callers] [--json]
```

Load-bearing flags:
- **`--path`** (`go`) — scope to a glob, e.g. `--path 'arches/app/**/*.py'`. Comma-combine; `!` to exclude. Sharper than a broad query.
- **`--tests`** (`go`) — include test files (excluded by default).
- **`--match`** (`gs`) — on a big/god-file, filter to one area: `coldstart gs models.py --match tile`. Substring (case-insensitive); `a|b` to OR; `/regex/` for regex.
- **`--view`** (`gs`) — narrow the output: `symbols` / `imports` / `importers` / `callers` instead of the default `full`.

Run `coldstart go --help` for the rest.

## Use ONE bash call for independent lookups

Don't serialize lookups that don't depend on each other — batch them in a single command so they cost one turn:

```
coldstart go authentication; coldstart go 'session cookie'; coldstart gs src/auth/service.ts
```

## Pipe to trim before output enters context

A god-file's full structure is large. If you only need one area, filter or slice:

```
coldstart gs arches/app/models/models.py --match tile | head -40
coldstart go payment --max 5
```

Don't pull a whole god-file's structure when you need one slice of it.

## Reading the output

**`go` results** are grouped into sections by WHERE the query matched (file/dir names; code/symbol names; both). **Sections are categories, NOT a ranking** — the best match can sit in any section, so scan all of them. Each line is `<path> matched: [tok1, tok2, ...]` — the matched name tokens, rarest-first (leftmost = strongest signal).

Annotations carry real relations:
- `← imported by X (also listed)` — an import edge between two shown results.
- `~ shares \`token\` with X (also listed)` — the two share a rare identifier/string the import graph can't see (migration↔model twins, config-by-name, cross-language pairs). **Treat a linked pair as one unit: if one is worth reading, fetch the other in the same step.**

**Content presence:** if a query word matches no declared name, `go` reports where that word lives in file *bodies* — naming the files (rare word), giving a count (common word), or stating it appears **NOWHERE**. Trust the nowhere line: the identifier doesn't exist in this repo — don't grep spelling variants of it.

**`gs` Importers with `--match`** additionally lists EVERY indexed file (any language) whose content references the matched term. That subsection IS the complete "who uses X" answer — it is exhaustive over indexed content, so a subsystem absent from it does NOT use the symbol. Don't grep to re-enumerate or re-verify use-sites.

**`gs` Related** = files sharing rare tokens with this one when no import edge connects them. First-class neighbors (Django migrations↔models, cross-language pairs); the shared token shown is the reason.

## Stop rule

If you've run `gs` on 5+ files for one question, you're enumerating — go back to `go` with a sharper `--path` or a different concept token instead of drilling further.

## When NOT to use it

- Searching for a literal string/phrase/regex inside file bodies (comments, templates, SQL) → that's Grep. (But check `go`'s Content-presence line first — it may already tell you the file or that the string is absent.)
- Reading an implementation → that's Read, after `gs` gives you the shape.
