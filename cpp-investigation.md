# C++ Resolution Investigation — bitcoin/bitcoin

## TL;DR

The probe reports **28.2 % C++ resolution** on bitcoin (169 / 599 imports). The
headline number is misleading in two ways:

1. **What it does count** — virtually 100 % of the unresolved imports are
   from a single vendored dependency (`src/leveldb/`). They are
   project-internal headers that *can* be resolved if the resolver knew
   to treat `src/leveldb/` and `src/leveldb/include/` as extra include
   roots. Fixing this is a ~10-line change to `resolveCpp` and lifts the
   visible ratio to **~98 %**.
2. **What it doesn't count** — bitcoin's *core* (everything outside
   `src/leveldb`, `src/secp256k1`, `src/crc32c`, `src/minisketch`,
   `src/crypto/ctaes`) uses **angle-bracket** `#include <...>` for all
   project-internal headers. The extractor at `src/indexer/extractors/cpp.ts:95`
   intentionally drops every angle-bracket include as "system header", so
   ~11 800 real project edges in bitcoin core are silently missing from
   the graph entirely. They never show up in the probe's denominator,
   which is why core resolution looks "perfect" (0 imports, 0 unresolved)
   while in practice the dep graph for bitcoin core has zero coverage.

If we treat the headline 28 % as the question, this is a small, worthwhile
fix. If we treat "are we actually building a useful C++ import graph for
this repo" as the question, the angle-bracket policy is the bigger
problem and the fix is larger.

---

## Method

- Probe: `node dist/index.js --probe --root /tmp/bitcoin > /tmp/bitcoin-probe.json`
- Repo: `bitcoin/bitcoin` HEAD (depth 1), 1 480 C/C++ source files, 1 508
  picked up by the walker.
- For each top unresolved specifier I located the file it would have
  pointed to on disk, and re-ran `resolveCpp` against a hypothetical set of
  extra include roots.

Probe summary for `cpp`:

| field         | value |
|---------------|-------|
| files         | 1 508 |
| totalImports  | 599   |
| resolved      | 169   |
| unresolved    | 430   |
| resolvedRatio | 0.282 |

`totalImports = 599` reflects **only quoted** `#include "..."`. The repo
actually contains **12 215 angle-bracket and 892 quoted** include
directives across `src/`. The extractor drops the 12k angle-bracket ones
before they ever reach the resolver.

---

## Where the 169 "resolved" come from

| source top-dir            | resolved edges |
|---------------------------|---------------:|
| `src/secp256k1/src`       | 85 |
| `src/minisketch/src`      | 39 |
| `src/crc32c/src`          | 32 |
| `src/secp256k1/examples`  | 5  |
| `src/crypto/ctaes`        | 3  |
| `src/secp256k1/contrib`   | 2  |
| `contrib/devtools/...`    | 2  |
| `src/minisketch/doc`      | 1  |
| **bitcoin core**          | **0** |
| **`src/leveldb/`**        | **0** |

Every currently-resolved C++ edge in the index lives in a vendored
dependency that uses same-directory or parent-directory quoted includes
(`#include "../foo.h"`, `#include "foo.h"`). Nothing in bitcoin's
actual source resolves.

---

## Breakdown of the 430 unresolved

I classified the full set of 72 unique unresolved specifiers (430
occurrences total). The probe's `topUnresolved` truncates at 30, so I
re-ran the extractor + resolver in-process to enumerate the long tail.

| category | specifiers | occurrences | category total |
|----------|-----------:|------------:|---------------:|
| **Vendored leveldb internals** — file *exists* under `src/leveldb/` or `src/leveldb/include/`; just not searched. Includes the `leveldb/`, `db/`, `util/`, `port/`, `table/`, `helpers/memenv/` prefixes. | 61 | **421** | 97.9 % |
| **Real third-party**, not vendored: `gtest/gtest.h` (7), `benchmark/benchmark.h` (1). Bitcoin links these from system libs — there is no source on disk and no fix possible. | 2 | **8** | 1.9 % |
| **Genuine bug in source**: `sys/time.h` (1) is written with quotes in `src/crypto/ctaes/bench.c` but is a libc header — should be angle-bracketed upstream. Cannot fix. | 1 | **1** | 0.2 % |

So **421 of 430 unresolved (97.9 %) are project-adjacent vendored
headers** that we could resolve with one tweak. The remaining 9 are
genuinely external.

### Detail of the vendored-leveldb prefixes

| prefix in `#include "…"` | where the file actually lives | example specifier (count) |
|---|---|---|
| `leveldb/X.h`            | `src/leveldb/include/leveldb/X.h` | `leveldb/env.h` (35) |
| `util/X.h`               | `src/leveldb/util/X.h`            | `util/coding.h` (23) |
| `db/X.h`                 | `src/leveldb/db/X.h`              | `db/filename.h` (13) |
| `port/X.h`               | `src/leveldb/port/X.h`            | `port/port.h` (19) |
| `table/X.h`              | `src/leveldb/table/X.h`           | `table/block.h` (6)  |
| `helpers/memenv/X.h`     | `src/leveldb/helpers/memenv/X.h`  | (2) |

All of these would resolve if `src/leveldb/` and `src/leveldb/include/`
were tried as fallback include roots. Same pattern applies to vendored
crc32c (`src/crc32c/include/`) — its public headers like
`crc32c/crc32c.h` (3 occurrences) are also unresolved today.

---

## Achievable resolution % if we fix it

I simulated adding `src/leveldb`, `src/leveldb/include`, and
`src/crc32c/include` as fallback include roots in `resolveCpp`:

| state                                | resolved | unresolved | ratio |
|--------------------------------------|---------:|-----------:|------:|
| current                              | 169      | 430        | 28.2 % |
| + extra include roots (this fix)     | 590      | 9          | **98.5 %** |
| upper bound (everything but gtest/benchmark) | 591 | 8 | 98.7 % |

The "+ extra include roots" run leaves only:

- 7 × `gtest/gtest.h` (external)
- 1 × `benchmark/benchmark.h` (external)
- 1 × `sys/time.h` (upstream code style bug)

---

## Proposed code changes (not implemented)

### Option A — small, fixes the headline number (recommended if doing anything)

Make `resolveCpp` accept a precomputed list of extra include roots and
try them after the existing two strategies.

1. **Detect vendored include roots once at startup.** During the walk
   (or just before resolution), scan the indexed file IDs for the
   pattern `*/include/*/*.h`. Every directory matching `<X>/include/` is
   an include root, and so is its parent `<X>/`. For bitcoin this finds
   `src/leveldb/include` and `src/crc32c/include`. Also auto-add every
   directory that contains a `CMakeLists.txt` *and* has subdirectories
   that are referenced by `<subdir>/foo.h` quoted-include patterns —
   that picks up `src/leveldb/` itself (which has `db/`, `util/`,
   `port/`, `table/` subtrees referenced as `db/foo.h` etc.). A simpler
   heuristic that works for bitcoin: any directory that contains both
   `CMakeLists.txt` and an `include/` subdir is an additional root, and
   so is its `include/`.

2. **Pass the list to `resolveCpp`.** Smallest signature change is to
   thread it through the existing `aliasMap` parameter (currently
   unused for C++) or add a new resolver-level context object.

3. **`resolveCpp` becomes**: try file-relative, then rootDir-relative,
   then each extra include root in declared order. First hit wins.

   ```ts
   // pseudocode, ~10 LOC
   for (const inc of extraIncludeRoots) {
     const r = tryResolveBase(join(rootDir, inc, specifier), fileIdSet, rootDir);
     if (r) return r;
   }
   ```

That's it. Probe ratio goes 28 % → 98 %.

### Option B — also fix the angle-bracket blind spot (bigger, optional)

If we also want bitcoin-core edges to exist at all:

1. In `src/indexer/extractors/cpp.ts`, the `preproc_include` branch
   currently only reads `string_literal` children (quoted form).
   Tree-sitter exposes `system_lib_string` for angle-bracket includes.
   Capture both, but tag the angle-bracket ones so the resolver can
   tell them apart.

2. In `resolveCpp`, for angle-bracket specifiers, **skip the
   file-relative step** (it's never how angle-bracket lookup works) and
   go straight to the include-root list. Add bitcoin-style "src is the
   include root" to the auto-detected list: any directory that is the
   *common ancestor* of >50 % of all C++ files in the repo. For bitcoin
   this picks `src/` cleanly.

3. Unresolved angle-bracket specifiers should be **silently dropped**
   if they look like stdlib (no slash and no extension, e.g. `vector`,
   `optional`) or match a known third-party prefix (`boost/`, `Qt`,
   `event2/`, `openssl/`, `kj/`). Otherwise they remain unresolved.

I tested this experimentally on bitcoin core (the non-vendored
subset): of 11 843 angle-bracket includes, **7 236 (61 %) would
resolve against `src/`** as the root, and another ~3 600 are stdlib /
boost / Qt / openssl that we'd skip. The remaining ~970 are mostly
`bitcoin-build-config.h` (generated at CMake configure time, not in the
source tree — 65 hits), Qt headers I hadn't enumerated, and
`mp/`/`kj/` (a vendored libmultiprocess copy nested at
`src/ipc/libmultiprocess/include/`).

Option B is the difference between "we have an edge graph that
describes the leveldb fork" and "we have an edge graph that describes
bitcoin." The extractor change is small (one branch in one switch),
but the resolver gains a new code path and we'd want to validate
against another CMake repo (LLVM, KDE, …) to confirm the include-root
heuristic doesn't misfire elsewhere.

---

## Is it worth doing?

**Option A: marginal.** It moves a number on a probe but the edges it
creates are entirely *inside vendored leveldb*. An AI agent navigating
bitcoin almost certainly does not need to trace leveldb's internal call
graph — that subtree is intentionally a black box for downstream
consumers. Anyone using `get-overview` or `trace-deps` on bitcoin is
asking about bitcoin code, not leveldb code. So the headline-number
improvement is real but the user-visible improvement is small. Cost is
~10 LOC. I'd only do it if the probe ratio itself is something we
publish or use to gate quality (e.g. CI threshold), or as a stepping
stone toward Option B.

**Option B: high value, larger change.** This is the one that actually
makes coldstart useful on the bulk of large C++ codebases. The current
extractor policy ("angle-bracket = system") is correct for some C/C++
projects (small utilities, header-only libs) but is exactly wrong for
the modern CMake convention (bitcoin, LLVM, KDE, Chromium, anything
using `target_include_directories(... PUBLIC include)`). Without it, on
bitcoin we have a parser that reads 1 508 C++ files and produces ~0
edges for the core — the navigation tools degrade to filename grep.
Cost is bigger: extractor change + resolver change + an include-root
detection heuristic + a stdlib/3p suppression list. Realistically a day
or two of work plus validation on a second large CMake repo.

**Recommendation:** skip Option A as an isolated change — it lifts a
metric without lifting utility. Open an issue scoped to Option B if
"useful on big CMake C++ codebases" is on the roadmap; if it isn't, the
honest move is to document that C++ support is best-effort and works
best on repos that use quoted includes.
