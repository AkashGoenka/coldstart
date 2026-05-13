# Low-convention language survey: Go, Rust, C++, Groovy

Honest assessment of whether coldstart-mcp needs additional resolver work for
these four languages. The framing question: do convention-driven (non-import)
references account for a non-trivial fraction of file-to-file relationships in
real-world projects, or are explicit imports / includes / `use` / `mod` already
covering essentially everything?

TL;DR — three "no significant gap" and one "minor gap" (Qt .ui in C++, niche).
Detailed reasoning per language follows.

---

## 1. Go

**Verdict: no significant gap.**

### What the existing resolver handles (`src/indexer/resolvers/go.ts`)

- Per-file walk-up to find the governing `go.mod` / `go.work` (handles
  multi-module repos and modules above/below rootDir).
- `go.work` `use` directives (multi-module workspaces).
- `go.mod` `replace` directives that redirect to local paths (`./vendored/foo`).
- Module-local import paths resolved to a package directory, then to any `.go`
  file in that dir.

### What was investigated for gaps

Scouted `~/benchmark/repos/hugo` (890 .go files, large mature app).

| Convention                                                | Evidence in hugo                                                                                            | Verdict             |
|-----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|---------------------|
| DI libraries (wire / fx / dig)                            | `grep -l 'go.uber.org/fx\|google/wire\|uber-go/dig' --include='*.go' .` → **zero matches.** No `wire.go`.   | Not used here       |
| HTTP router patterns (gin / echo / chi)                   | Zero matches for `gin.Engine`, `echo.New()`, `chi.NewRouter`. Hugo uses stdlib only.                        | Already covered     |
| Protobuf / gRPC code generation                           | Zero `.proto` files; zero `*.pb.go`.                                                                        | N/A here            |
| Struct tags (`json:"foo"`, `mapstructure:",squash"`)      | Present, but they describe field naming — not file references.                                              | Out of scope        |
| Plugin registries (`RegisterFuncs` / `http.HandleFunc`)   | Calls exist, but registration is **always an explicit function reference**, captured by the import edge.    | Already covered     |
| `//go:generate` directives                                | Build-time only; generated files are committed and re-indexed as normal Go.                                 | Out of scope        |
| Interface→impl wiring (Spring-style)                      | Go interfaces are satisfied implicitly with **no declaration site**. There is nothing to resolve.           | Architecturally N/A |

DI libraries (wire/fx) DO exist in the Go ecosystem and would be a candidate
convention if a real benchmark target used one — but they don't appear in the
current corpus, and even when present, `wire.go` files are themselves Go imports
of the providers they wire, so the import graph already covers ~all edges.

### Recommendation

No work. Go's import model is explicit and structural; the existing resolver
already does the right thing. Spending resolver work here would be solving an
unobserved problem.

---

## 2. Rust

**Verdict: no significant gap.**

### What the existing resolver handles

- `src/indexer/resolvers/rust.ts`:
  - **`mod foo;` declarations** → sibling `./foo.rs` or `./foo/mod.rs`.
  - **Cross-crate `use` paths** through workspace members (`use other_crate::sub::Thing`
    → `other_crate/src/sub.rs`).
- `src/indexer/rust-workspace.ts`:
  - Cargo workspace discovery with glob member patterns (`crates/*`).
  - Hyphen-to-underscore name normalisation (`tokio-util` → `tokio_util`).
  - Single-crate fallback when no `[workspace]` section.
- `src/indexer/extractors/rust.ts` filters in-crate prefixes (`crate::`, `super::`,
  `self::`, std/core/alloc), so the resolver only sees cross-file specifiers.

### What was investigated for gaps

Scouted `~/benchmark/repos/ripgrep` (100 .rs files, 10-crate workspace).

| Convention                                | Evidence                                                                                       | Verdict          |
|-------------------------------------------|------------------------------------------------------------------------------------------------|------------------|
| `mod` declarations                        | 111 in ripgrep. Spot-checked `mod flags;` in `crates/core/main.rs` → resolves to `flags/mod.rs`. Existing resolver branch handles this. | Already covered  |
| Web framework macros (`#[get("/x")]`, …)  | Zero matches in ripgrep (it's a CLI). Even where they appear (axum/actix/rocket), they're attribute macros on a function in the **same** file — no cross-file edge. | No file-edge gap |
| Cargo workspace `path = "..."` deps       | Already handled by `rust-workspace.ts` member expansion.                                       | Already covered  |
| `#[path = "..."]` mod-path override       | Zero matches in ripgrep. Rare in real codebases.                                              | Marginal, skip   |
| `#[derive(...)]` / proc macros            | Internal to compiler; no cross-file ref (the trait `impl` is generated, not in another file). | Architecturally N/A |
| Serde `#[serde(rename = "x")]`            | Field-level renaming; no file ref.                                                            | Out of scope     |

### Recommendation

No work. The Rust resolver already handles the two real conventions (`mod` +
workspace `use`), and the macro-heavy parts of Rust are intra-file or
compile-time-only.

---

## 3. C++

**Verdict: minor gap (Qt MOC / `.ui` form pairing). Probably skip.**

### What the existing resolver handles

- `src/indexer/resolvers/cpp.ts` + `src/indexer/cpp-include-roots.ts`:
  - Relative `#include "foo.h"` from the including file's dir.
  - `#include <qt/foo.h>` style — angle-bracket includes resolved against
    include roots parsed from ancestor `CMakeLists.txt`
    (`include_directories()` and `target_include_directories()`).
  - CMake variable expansion (`${CMAKE_CURRENT_SOURCE_DIR}`,
    `${CMAKE_SOURCE_DIR}`, `${PROJECT_SOURCE_DIR}`) and basic generator
    expressions (`$<BUILD_INTERFACE:...>`).
  - Multi-CMakeLists walk-up (nested projects inherit ancestor roots).

### What was investigated for gaps

Scouted `~/benchmark/repos/bitcoin/bitcoin-no-mcp` (1395 .cpp/.h files, ~136 in
`src/qt/`).

| Convention                                       | Evidence in bitcoin                                                                                                   | Verdict                            |
|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|------------------------------------|
| Standard `#include "x.h"` / `<x.h>`              | Bulk of references; already covered.                                                                                  | Already covered                    |
| Qt MOC (`Q_OBJECT` in header)                    | 60 headers carry `Q_OBJECT`. MOC generates `moc_*.cpp` (not present in source — generated at build).                  | Generated; no source file to link  |
| Qt `.ui` forms                                   | 19 `.ui` files. Each consumed via `#include <qt/forms/ui_<name>.h>` (generated header). **Source `.ui` pairs 1:1 with same-base `.cpp`** (e.g. `sendcoinsdialog.ui` ↔ `sendcoinsdialog.cpp`). Currently coldstart sees neither edge (.ui isn't parsed; ui_*.h doesn't exist on disk). | Minor real gap                     |
| Macro factory registrations (`REGISTER_FACTORY(Foo)`) | Zero matches in bitcoin. Pattern exists in some C++ codebases (LLVM passes, etc.) but is project-specific.       | Skip — too project-specific        |
| `BOOST_AUTO_TEST_SUITE(name)`                    | Present (~5+ uses), but the symbol `name` does not refer to a file — it's a test-suite label.                         | No file ref                        |
| CMake `add_executable(foo a.cpp b.cpp)`          | Build-relationship, not call/include relationship. Already implicit via includes between a.cpp and b.cpp.             | Out of scope                       |
| Forward declarations                             | Same-language declaration→definition is intra-language semantic; not a separate file edge beyond the include.         | Out of scope                       |

### Mini-spec for the Qt `.ui` gap (if work were warranted)

- **Surface form**: a `.ui` file `src/qt/forms/<name>.ui` is implicitly consumed
  by `src/qt/<name>.cpp` (and its `.h`) whenever the `.cpp` `#includes` a header
  matching `ui_<name>.h` (anywhere in include paths).
- **Resolution rule**: when extracting includes, detect specifier of the form
  `**/ui_<name>.h` where the include target does NOT resolve to a real file;
  emit a synthetic edge to `**/forms/<name>.ui` if such a file exists in the
  fileIdSet.
- **Stoplist**: only fire on Qt projects (gate on the include path containing
  `forms/ui_` or on any `Q_OBJECT` present in the same translation unit's
  header).
- **Edge case**: nested namespaces, non-default form locations — keep narrow.
- **Scale**: 19/1395 files in bitcoin = **1.4% of files**. Niche.

### Recommendation

**Skip.** The gap is real but tiny (~1–2% of files in Qt apps; zero in non-Qt
C++). Qt apps are also rare in the current benchmark corpus (one repo). The
existing C++ resolver covers the high-volume case (regular `#include`) well.

---

## 4. Groovy

**Verdict: no real gap to address; insufficient real-world coverage to justify
work.**

### What the existing resolver handles

There is no dedicated Groovy resolver. Groovy files are not currently indexed
by coldstart (Groovy is listed under "regex extractors" in CLAUDE.md but no
language-specific resolver exists).

### What was investigated for gaps

Searched `~/benchmark/repos/` for Groovy-heavy codebases.

| Finding                                                                 | Detail                                                                          |
|-------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| `*.groovy` files across **all** benchmark repos                         | 6 — and **all** are `Jenkinsfile-helper.groovy` in CI/ops directories.          |
| `*.gradle` / `*.gradle.kts` files                                       | Present in kafka (build configs), but these are build-system files, not app code. |
| Grails app (`grails` keyword in `.groovy` source)                       | **Zero matches across all benchmark repos.**                                    |

There is no Grails (or other convention-heavy Groovy framework) application
in the current corpus. The Groovy that does appear is:

1. **Jenkinsfile DSL** — CI pipeline declarations. References plugins by string
   name; no file→file graph relevance.
2. **Gradle DSL** (`build.gradle`) — declares JVM dependencies, plugins,
   sub-projects. Sub-project references (`include 'foo'` in `settings.gradle`)
   ARE file references, but the JVM resolver covers the resulting Java/Kotlin
   files — the gradle file itself is a config artifact, not a node in the
   call/import graph.

### Candidate Grails conventions (documented for completeness; not specced)

If a Grails app entered the corpus later, the pattern would mirror Rails:
- `grails-app/controllers/FooController.groovy` ↔ `grails-app/views/foo/*.gsp`
- `grails-app/domain/Foo.groovy` GORM associations (`hasMany`, `belongsTo`)
- `UrlMappings.groovy` routes
The Ruby-resolver pattern (`RAILS_ASSOCIATION_METHODS` in
`src/indexer/extractors/ruby.ts`) is the right template.

### Recommendation

**Skip.** No benchmark target uses Groovy as an application language. Building
a Grails resolver against zero observed use is exactly the "manufactured work"
the brief warned against. Revisit only if a Grails / Gradle-Groovy
application-code repo lands in the corpus.

---

## Cross-cutting observation

These four languages share a property that distinguishes them from
Ruby/Python/Java/PHP/JS-TS: they have **explicit, lexical, file-resolvable**
reference mechanisms (`import "..."`, `mod foo;` + `use crate::...`, `#include`).
The convention-over-configuration frameworks that drive the Ruby/Python/Java/PHP
resolver work simply don't have widespread analogues here — `wire`/`fx` exist
for Go but aren't ubiquitous; Rust macros are mostly intra-file; Qt MOC is one
narrow C++ instance; Grails is moribund in modern Groovy.

The honest answer is: the explicit-import philosophy of these languages is
doing the work that resolver heuristics have to do in IoC-heavy ecosystems.
