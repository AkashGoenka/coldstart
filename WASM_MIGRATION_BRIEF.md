# WASM parse-engine migration — work brief (self-contained)

> This branch (`spike/wasm-extractor`) prototypes running coldstart's Tree-sitter
> parsing on **web-tree-sitter (WASM)** instead of the native `node-tree-sitter`
> bindings, behind a `COLDSTART_WASM=1` flag. This doc is the complete handoff —
> no external context required.

## Why (the payoff)

Switching the parse engine to WASM retires coldstart's entire native-build
problem class at once:
- the `npm install` **peer-dependency hang** (conflicting `tree-sitter` peer
  ranges across grammars — today only `--legacy-peer-deps` avoids it);
- **npm 12's** install-script / node-gyp block (a fresh `npm i` under npm 12
  leaves kotlin's native binding unbuilt → `parser.ts` throws on import → the
  whole indexer fails to load);
- the **kotlin prebuild gap** (kotlin ships no native prebuild);
- and it makes any future standalone binary trivial (`.wasm` is inert data).

It keeps coldstart a plain `npm i` package. `.wasm` grammars need no node-gyp,
no install scripts, and no per-grammar peer dep.

## What the spike already proved (10 real repos, `--probe`)

- **Parse/extract is byte-identical** native vs WASM. Same grammar source → same
  AST → identical extracted symbols/imports. Verified on ~40k+ files across 10
  languages (e.g. every one of 3,158 ruby files in a mastodon checkout, incl.
  all six >32 KB; 2,036 java files). Quality is a non-issue.
- **WASM is FASTER through the full pipeline on all 10 repos: 1.0–2.5×**
  (php 2.5×, ruby/go 1.9×, python 1.6×, ts 1.5×, java 1.2×). Reason: coldstart
  is walk-heavy, and node-tree-sitter's cost is JS↔C++ node-accessor
  marshalling on the walk; web-tree-sitter's accessors are cheaper, which more
  than offsets its ~1.6× slower raw parse.

The old "WASM is too slow" assumption was never benchmarked and is false for
this workload.

## Architecture already committed on this branch

Single seam: `src/indexer/extractors/parser-factory.ts` →
`makeParser(grammar, wasmSpec?)`.
- Native mode (default, `COLDSTART_WASM` unset): unchanged — builds a native
  `node-tree-sitter` parser. **540/540 tests must stay green here.**
- WASM mode (`COLDSTART_WASM=1`): returns a wrapper parser that
  (a) accepts the same `parse(string | chunkCallback)` shapes the extractors
  already call (it reconstructs the >32 KB chunk-callback into a full string —
  web-tree-sitter has no 32 KB cap), and
  (b) **deletes the previous Tree on each parse** — web-tree-sitter 0.26.10 has
  NO auto-GC (leaking trees grew RSS to 644 MB over ~6k parses). Bounding to one
  live tree is safe because extraction is fully synchronous per file.
- `ensureParsersReady()` (awaited at the top of `parseFile` in
  `src/indexer/parser.ts`) does the one-time async grammar load; no-op in native.
- Each wasm-capable extractor passes a `wasmSpec` to `makeParser` pointing at the
  `.wasm` that ships inside its own npm package.
- `parseJavaContent` was split into `parseJavaContent` + exported
  `extractJavaFromRoot` (behavior-preserving) so extraction can run on either
  engine's tree.

10 grammars ship a `.wasm` in-package and are already wired. **3 do NOT**
(c#, kotlin, xml) and currently fall back to native under `COLDSTART_WASM=1`.

## Remaining work

1. **Set up.** `npm install --legacy-peer-deps` (MANDATORY — plain install
   hangs). If the container has **npm 12**, add `--allow-scripts` so kotlin's
   native binding compiles (else native-mode tests can't run). Confirm
   `npm test` is **540/540 green** and `npx tsc --noEmit` is clean before
   changing anything.

2. **Build the 3 missing `.wasm`.** `npm i -g tree-sitter-cli`, then
   `tree-sitter build --wasm` (toolless since CLI 0.26 — auto-downloads
   wasi-sdk) against each grammar's `src/`:
   - `tree-sitter-c-sharp` (has `src/parser.c` + `src/scanner.c`) — low risk
   - `@tree-sitter-grammars/tree-sitter-xml` — multi-grammar; build the `xml/`
     sub-grammar (dtd separate, not needed) — low/med risk
   - `tree-sitter-kotlin` (external `src/scanner.c`) — **the likely failure
     point.** If it won't build under wasi-sdk, document why and leave kotlin on
     native-fallback (note it in the PR).

3. **Vendor + wire.** Commit the built `.wasm` into the repo (e.g.
   `vendor/wasm/`), and give the c#/kotlin/xml extractors a `wasmSpec` in
   `makeParser(...)` resolving to the vendored path (the other 10 resolve via
   `require.resolve('<pkg>/<file>.wasm')` — for vendored ones resolve against the
   repo path instead).

4. **Fix the ruby resolver order-sensitivity (orthogonal, real bug).**
   `src/indexer/resolvers/ruby.ts:183` builds the FQCN→file autoload index with
   `idx.set(key, fileId)` = last-write-wins, iterating files in
   parse-completion order. Native and WASM complete parses in different (each
   deterministic) orders → ambiguous/duplicate Rails class names resolve to
   different winners → a small constant edge-count delta (measured +72 / 0.8% on
   a single mastodon copy; native and wasm each perfectly deterministic).
   **Fix:** sort the file list by path (stable key) before building the index so
   resolution is order-independent. This makes BOTH engines deterministic AND
   identical. Add/adjust a ruby resolver test.

5. **Self-verify** (the container has none of the original benchmark repos —
   they were local). `git clone` a few public repos and run the harness at
   `scripts/wasm-probe-compare.mjs` (added on this branch):
   ```
   git clone --depth 1 https://github.com/BurntSushi/ripgrep /tmp/ripgrep
   git clone --depth 1 https://github.com/gohugoio/hugo /tmp/hugo
   git clone --depth 1 https://github.com/django/django /tmp/django
   git clone --depth 1 https://github.com/laravel/framework /tmp/laravel
   git clone --depth 1 https://github.com/bitcoin/bitcoin /tmp/bitcoin
   git clone --depth 1 https://github.com/mastodon/mastodon /tmp/mastodon
   npm run build
   node scripts/wasm-probe-compare.mjs /tmp/ripgrep /tmp/hugo /tmp/django /tmp/laravel /tmp/bitcoin /tmp/mastodon
   ```
   Expect: byte-identical resolution native vs WASM on each (after the ruby fix,
   mastodon too), and WASM parse time ≥ native. Small ≤ a-few-edge deltas on
   go/cpp are inherent parallel-parse jitter — re-run the baseline against itself
   to confirm the noise floor before treating any delta as real.

## Guardrails

- **Native stays the default.** WASM is opt-in via `COLDSTART_WASM=1`. Do not
  flip the default in this PR.
- **Do NOT merge or push to `main`.** Commit to `spike/wasm-extractor`; open a
  **draft** PR summarizing results (including whether kotlin's `.wasm` built).
- Keep `web-tree-sitter` as it is in `package.json` (a devDependency) unless you
  intend to make WASM the default — that's a separate decision.
