# file-dependency graph experiment

A clean-room file-dependency graph for a Python repo, built independently of
coldstart, then diffed against coldstart's own graph to use one as a check on
the other. Run against [arches](https://github.com/archesproject/arches).

## The idea

Walk every source file, find what it imports, resolve each import to a real
file on disk, draw an edge, repeat. Tests and migrations are excluded so the
picture stays legible. The standalone builder uses Python's stdlib `ast` and
deliberately shares **none** of coldstart's resolution code — so when the two
graphs disagree, the disagreement is signal, not a shared bug.

## Files

| file | what it does |
|---|---|
| `standalone_pygraph.py` | clean-room builder: `ast` imports → resolved file edges → JSON |
| `export_coldstart.mjs`  | runs coldstart's `buildIndex` on the repo, exports its graph to the same JSON shape |
| `compare.py`            | diffs the two edge sets (agreement, misses, hubs) → `comparison.md` |
| `classify_misses.py`    | buckets coldstart's missed edges by root cause |
| `render_svg.py`         | static SVG of a graph (pure-stdlib force layout) |
| `viewer.html`           | interactive viewer — open it, load a `*.json`, drag/zoom (offline, zero deps) |

## How to reproduce

```bash
# from repo root
npm run build
cd experiments/file-graph
python3 standalone_pygraph.py ../arches-repo arches_standalone.json
node export_coldstart.mjs ../arches-repo arches_coldstart.json   # use an ABSOLUTE root
python3 compare.py arches_standalone.json arches_coldstart.json comparison.md
python3 classify_misses.py ../arches-repo arches_standalone.json arches_coldstart.json
python3 render_svg.py arches_standalone.json standalone.svg "standalone"
python3 render_svg.py arches_coldstart.json  coldstart.svg  "coldstart"
```

## Results on arches (261 shared `.py` files)

| | standalone (ast) | coldstart (before) | coldstart (after submodule fix) |
|---|---|---|---|
| edges | 1035 | 904 | 1010 |
| agreed | — | 895 | 1001 |
| std-only (missed) | — | 140 | 34 |
| cold-only | — | 9 | 9 |
| **Jaccard** | — | **0.857** | **0.959** |

Coldstart's Python resolution was already solid — 86% edge agreement, only **9**
edges it found that the standalone didn't (and those are *correct*: Django
synthetic edges, see below). The story was in the **140 edges coldstart missed**.
Fixing the submodule gap (below) recovered **106** of them, lifting agreement to
**0.959**; the remaining 34 are the nested-import judgment call.

### Why coldstart missed those 140 edges

Decomposed by where the import statement actually lives (no overlap):

| count | cause | example | fixed? |
|---|---|---|---|
| 94 | **`from pkg import submodule`** — a **top-level** import that coldstart resolved to the package `__init__.py`, never to the submodule file | `from arches.app.models import models` loses the edge to `models.py` | yes |
| ~13 | relative-import variant of the same submodule pattern | `from . import models` | yes |
| 33 | edge exists **only** as a nested / deferred import (function-local) | `tasks.py` imports `resource.py` / etl modules inside Celery task bodies | no (judgment call) |

The 94 are the important part: they are **already in the top import block** —
coldstart just mis-resolved them. The single biggest symptom was
`arches/app/models/models.py`, depended on by **118** files (standalone) but
only **47** in coldstart, because the common arches idiom
`from arches.app.models import models` was recorded as just the module path
`arches.app.models` and mapped to the package `__init__.py`.

The 33 nested-only misses are concentrated in files that *intentionally* defer
imports (Celery task runners, circular-import-prone modules), so the top block
is genuinely incomplete there — but capturing them is a semantics choice, not a
clear bug, so it's left unfixed.

### The fix

`src/indexer/extractors/python.ts` now also emits `module.name` candidate
specifiers for each name in a `from module import name, ...` statement (joining
without an extra dot for bare relative dots). The resolver already knows how to
resolve a submodule path, so when `pkg/sub.py` exists the edge is recovered;
symbol imports (`from x import SomeClass`) simply don't resolve and add no edge.
Result: 0.857 → 0.959 Jaccard, +106 edges, **zero** new false edges.

Tradeoff: symbol imports now also emit a non-resolving `module.SomeClass`
candidate, which inflates coldstart's internal *unresolved* counter (a `--probe`
quality signal) even though edge correctness improves. The clean follow-up is to
pass structured import data (module + names) to the resolver so submodule
candidates are tried as bonus edges without counting toward unresolved.

### What coldstart got that the naive parser couldn't

The 9 coldstart-only edges are all **Django synthetic edges** — string config
in `settings.py` (`ROOT_URLCONF = "arches.urls"`,
`WSGI_APPLICATION = "arches.wsgi.application"`, auth backends, middleware) and
celery wiring. A pure import parser can't see these; coldstart's framework
awareness adds them. Real value-add.

## What this is good for

1. **A resolver oracle.** An independent graph turned "the resolver feels weak"
   into two specific, quantified issues in `src/indexer/extractors/python.ts`:
   - **(fixed)** `import_from_statement` recorded only the module text — now
     also emits `module.name` submodule candidates. Recovered 106 edges and
     restored `models.py`'s true hub rank (47 → ~118).
   - **(open, by choice)** imports are read only from `root.namedChildren`, so
     deferred/nested imports are skipped. Real for Celery/circular-import files;
     left unfixed because it's a semantics decision.
2. **An architecture lens.** Both graphs independently agree the gravitational
   center of arches is `models.py` / `system_settings.py` / `betterJSONSerializer.py`
   — the hub list is nearly identical. Visualizing it (`viewer.html` or the
   SVGs) makes the layering and the few mega-hubs obvious.

## Caveats

- One language (Python), absolute imports rooted at the repo root. Other repos
  with `src/` layouts or namespace packages would need root detection.
- The standalone builder keeps an edge to *both* the package `__init__.py` and
  the submodule for `from pkg import sub`; that's a modeling choice, not gospel.
- **Pass coldstart an absolute root.** A relative root breaks the Python
  resolver's walk-up loop (it compares `dir === rootDir` and
  `parent.startsWith(rootDir)` against an absolute path) — this dropped
  coldstart to 31 edges before the fix. The real CLI always passes
  `resolve(cliRoot)`, so this only bites custom harnesses, but it's a sharp edge.
