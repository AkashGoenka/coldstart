# coldstart

Eliminate the AI agent cold start problem. Scans your TypeScript/JavaScript
codebase once and produces a `coldstart_map.json` file that AI agents read
instead of re-discovering your codebase from scratch on every session.

---

## What it does

Walks your codebase concurrently (16 goroutines), extracts imports, exports, domain
tags, and token estimates for every file, resolves dependency edges between files,
and writes everything to a single JSON file on disk.

That file sits in your project root. Your AI agent reads it at the start of every
session and knows where everything lives without opening a single source file.

---

## Requirements

- Go 1.22 or later — https://go.dev/dl
- Python 3.8 or later (for the query tool only)
- No other dependencies

---

## Setup

**1. Clone or copy this folder into your project**

```bash
cp -r coldstart /your/project/tools/coldstart
cd /your/project/tools/coldstart
```

**2. Build the indexer binary**

```bash
go build -o coldstart .
```

This produces a single binary. You only need Go installed for this step.
After building, the binary runs standalone with no runtime required.

**3. Run it against your codebase**

```bash
./coldstart --root /path/to/your/project
```

That is it. `coldstart_map.json` is written to your current directory.

---

## CLI flags

```
--root       Path to your project root            (default: .)
--output     Where to write the map file          (default: coldstart_map.json)
--exclude    Extra directories to skip            (default: none)
--workers    Number of parallel goroutines        (default: 16)
--quiet      Suppress output, just write the file (default: false)
```

**Examples**

```bash
# Basic run
./coldstart --root ./my-project

# Custom output path
./coldstart --root ./my-project --output ./docs/coldstart_map.json

# Skip additional directories
./coldstart --root ./my-project --exclude "storybook,e2e,fixtures"

# Silent mode for CI
./coldstart --root ./my-project --quiet
```

Already excluded by default: `node_modules`, `dist`, `build`, `.git`, `.next`,
`.turbo`, `coverage`, `__pycache__`.

---

## Querying the map

Once `coldstart_map.json` exists, use `query.py` to interrogate it from the terminal.
No dependencies required — pure Python stdlib.

```bash
# Overall summary
python query.py --summary

# All files in a domain
python query.py --domain auth

# Full metadata for a specific file
python query.py --file src/auth/middleware.ts

# Most imported files across the codebase
python query.py --hot

# Circular dependency check
python query.py --cycles

# Search by keyword, export name, or domain
python query.py --search "jwt"

# What breaks if this file changes?
python query.py --impact src/utils/token.ts
```

---

## Using with Cursor

Add this to your `.cursorrules` file in the project root:

```
Before exploring any file, read coldstart_map.json at the project root.
Use the clusters object to identify which domain contains the relevant files.
Use hot_nodes to identify high-value shared modules.
Only open a raw source file when you need implementation details or are
about to modify it. Do not open files just to understand what they export
or which domain they belong to — the map already contains that.
```

---

## Using with Claude.ai

Paste the map directly into chat at the start of a session:

```
Here is my codebase map. Use it to understand structure before answering.
Only ask to read specific files if the map is insufficient.

<coldstart_map>
[paste contents of coldstart_map.json here]
</coldstart_map>
```

For large maps, paste only the relevant cluster:

```bash
python query.py --domain auth | pbcopy
# then paste just that section into chat
```

---

## Keeping the map fresh

Run the indexer whenever your codebase structure changes meaningfully —
new files added, modules reorganised, major refactors. For routine edits
to existing files the map stays accurate enough.

**Git pre-commit hook (optional)**

```bash
# .git/hooks/pre-commit
#!/bin/sh
./tools/coldstart/coldstart --root . --quiet
git add coldstart_map.json
```

**GitHub Actions (optional)**

```yaml
name: Refresh codebase map
on:
  push:
    branches: [main]
jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: |
          cd tools/coldstart
          go build -o coldstart .
          ./coldstart --root ${{ github.workspace }} --quiet
      - uses: actions/upload-artifact@v4
        with:
          name: codebase-map
          path: coldstart_map.json
```

---

## Visualising the map

Open `dashboard.html` in any browser. Click "Load coldstart_map.json" and select
your map file. You get an interactive graph coloured by domain — click any node
to see its imports, exports, and dependents.

---

## Limitations

These are the boundaries beyond which this tool is not the right solution.
Be honest about whether you have hit them before adding complexity.

**1. Codebase size above ~10,000 files**

The map file itself becomes large enough that pasting it into an AI context
defeats the purpose. At 10k files `coldstart_map.json` is typically 4–8MB.
At that point you need a local retrieval server that returns only relevant
slices — a different tool, not an extension of this one.

**2. Highly dynamic import patterns**

The parser resolves relative imports (`./auth/middleware`) but does not handle
dynamic imports (`import(variable)`), dependency injection containers, barrel
re-exports that alias symbols, or module federation. If your codebase relies
heavily on these patterns the dependency graph will be incomplete.

**3. Monorepos with complex workspace structures**

If your project uses Turborepo, Nx, or Yarn workspaces with cross-package
imports resolved through `tsconfig.json` path aliases, those cross-package
edges will not be resolved. The map is accurate within each package but blind
to inter-package dependencies.

**4. Questions requiring implementation detail**

The map contains exports, imports, domain tags, and token estimates. It does
not contain what functions actually do, what logic they implement, or what
side effects they produce. For questions like "why does this function return
null sometimes" the agent must read the raw file. The map tells it which file
to read — it does not replace reading it.

**5. Accuracy degrades with stale maps**

If files have changed significantly since the last index run, the map may
point the agent to the wrong files or describe exports that no longer exist.
Run the indexer after any structural change. The `hash` field on each node
lets you manually check which files have drifted — but there is no automatic
staleness detection in this version.

**6. TypeScript and JavaScript only**

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` files are indexed. Python, Go,
Rust, Java, and all other languages are ignored. If your codebase is polyglot,
the map will be a partial picture.

**7. Not a substitute for good agent prompting**

The map reduces cold start cost. It does not make a poorly prompted agent
accurate. If the agent is given bad instructions alongside a good map it will
still produce bad output. The map is context — it does not fix reasoning.

---

## What this tool is not

It is not a semantic search engine. It is not a vector database. It is not
a recommendation system. It is not a replacement for Cursor's internal index.

It is a static snapshot of your codebase structure, written to disk, readable
by any tool, owned entirely by you. That is all it needs to be.
