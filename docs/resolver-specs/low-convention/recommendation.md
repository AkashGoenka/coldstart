# Recommendation: low-convention languages

**Bottom line: do not invest resolver work in Go, Rust, C++, or Groovy at this
time.**

## Per-language one-liners

- **Go** — explicit module imports cover everything observed in hugo. DI
  libraries (wire/fx) absent from corpus; even when present they're
  themselves Go imports already on the graph. **No work.**
- **Rust** — `mod` + cross-crate `use` already handled. Macros and attribute
  routes are intra-file or compile-time-only. **No work.**
- **C++** — `#include` (quoted + angle-bracket + CMake include roots) already
  handled. The only real gap is Qt `.ui` → `.cpp` pairing (~1.4% of files in
  bitcoin, zero elsewhere). Mini-spec is in `survey.md` but **not worth
  shipping** without a second Qt-heavy benchmark target.
- **Groovy** — no Grails / Groovy-app-code repos in the benchmark corpus.
  Building a resolver against zero observed use is premature. **No work.**

## If only one slot were open

The single most-defensible piece of work in this group is the **Qt `.ui` ↔
`.cpp` pairing** (mini-specced in `survey.md`, section 3). It would touch
~19 files in bitcoin and zero in any other current benchmark — small enough
that the cost of building, testing, and maintaining the rule exceeds the
recall improvement. Park until a second Qt repo enters the corpus.

## Where resolver effort should go instead

The parallel specs being written for Ruby/Python/Java/PHP/JS-TS target
frameworks where 30–80% of cross-file references are convention-driven
(Rails `has_many`, Django URL routes, Spring `@Autowired`, Laravel facades,
Next.js file routing). The opportunity-cost ratio is not close:
expected-recall-per-engineering-hour is an order of magnitude higher there
than anywhere in the Go/Rust/C++/Groovy quartet.

## Watchlist (things that would change this answer)

- A Go application using `google/wire` or `uber-go/fx` enters the benchmark
  corpus, and post-hoc analysis shows the DI graph supplies >10% of relevant
  files beyond what plain imports already do.
- A second Qt-heavy C++ repo enters the corpus, doubling the Qt-pairing
  evidence base.
- A real Grails application enters the corpus.
- Coldstart starts being used outside the current benchmark distribution
  on Go/Rust/C++ codebases with materially different convention profiles
  (e.g. Kubernetes-style Go with heavy code generation).
