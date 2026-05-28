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

| | standalone (ast) | coldstart |
|---|---|---|
| edges | 1035 | 904 |
| agreed | — | 895 |
| **Jaccard** | — | **0.857** |

Coldstart's Python resolution is solid — 86% edge agreement, only **9** edges
it found that the standalone didn't (and those are *correct*: Django synthetic
edges, see below). The story is in the **140 edges coldstart missed**.

### Why coldstart missed 140 edges

| count* | cause | example |
|---|---|---|
| 94 | **`from pkg import submodule`** resolved to the package `__init__.py`, never to the submodule file | `from arches.app.models import models` loses the edge to `models.py` |
| 48 | **only top-level imports captured** — function-local / deferred imports skipped | `betterJSONSerializer` imported inside a method in `datatypes/base.py` |
| 20 | relative-import variant of the submodule pattern | `from . import models` |

\* buckets overlap because one target can be reached via several statements.

The single biggest symptom: `arches/app/models/models.py` is depended on by
**118** files (standalone) but coldstart only sees **47** — because the common
arches idiom is `from arches.app.models import models`, and coldstart records
only the module path `arches.app.models`, mapping it to the package
`__init__.py`.

### What coldstart got that the naive parser couldn't

The 9 coldstart-only edges are all **Django synthetic edges** — string config
in `settings.py` (`ROOT_URLCONF = "arches.urls"`,
`WSGI_APPLICATION = "arches.wsgi.application"`, auth backends, middleware) and
celery wiring. A pure import parser can't see these; coldstart's framework
awareness adds them. Real value-add.

## What this is good for

1. **A resolver oracle.** An independent graph turns "the resolver feels weak"
   into two specific, quantified, fixable bugs. Both are in
   `src/indexer/extractors/python.ts`:
   - `import_from_statement` records only the module text (line ~320). Also
     emit `module + "." + name` candidates so the resolver can pick up
     submodule imports (it already knows how to resolve them).
   - imports are read only from `root.namedChildren` (line ~318). Walk all
     descendants to capture deferred/nested imports.
   Fixing #1 alone should recover ~94 edges and restore `models.py`'s true hub
   rank.
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
