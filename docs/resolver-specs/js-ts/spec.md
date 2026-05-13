# JS/TS framework-convention resolver — research spec

**Status:** research-only. No production code changes. POC at `./poc.ts`, evidence at `./poc-output.txt`.

## Scope

The existing TS/JS pipeline (`src/indexer/ts-parser.ts` + `src/indexer/resolvers/generic.ts`) covers explicit `import`/`require` and re-exports well. This spec defines synthetic edges for **convention-based** references where no import exists. Pattern is identical to the Ruby/Rails resolver in `src/indexer/extractors/ruby.ts` (`RAILS_ASSOCIATION_METHODS`, `extractRoutesImports`, `extraImportsTargets`): detect convention surface form, deterministically map name/path → file, push to a synthetic-edge list consumed by `graph.ts`.

## Existing-coverage check (done before writing this spec)

Grepped `src/indexer/` for `next`, `app-router`, `pages-router`, `sveltekit`, `nuxt`, `nestjs`, `@module`, `@injectable`, `src/routes`. **Zero hits.** Only `.nuxt` is listed in `src/constants.ts` (excluded from walking — correct). Vue/Svelte/Astro have script-block extraction in `src/indexer/parser.ts` `extractSfcScripts` / `extractAstroFrontmatter`, so any component referenced in `<template>` that is also imported in `<script>` already gets a normal edge through `ts-parser`. **The gaps below are all new ground.**

Frameworks confirmed present in benchmark repos:

| Repo | Framework | Status |
|---|---|---|
| `~/benchmark/repos/cal/cal.com-coldstart` | Next.js 16 (app + pages router, both) | primary FS-routing target |
| `~/benchmark/repos/terraforming-mars/terraforming-mars-coldstart` | Vue 3 + bespoke HTTP server (no Express) | Vue template TN, glob-loading TN |
| `/tmp/nest-typescript-starter` | NestJS starter | DI smoke test |
| `/tmp/sveltekit-realworld` | SvelteKit | FS-routing |

NestJS production code in the benchmark suite: **none**. Nuxt: **none**. Treat both as lower-priority once concrete benchmark gain is known.

---

## Framework 1 — Next.js app router (PRIORITY 1)

### Convention surface form (filesystem, no AST)

Anything under `app/` (or `src/app/`) matching one of the special filenames is a route node:

- `page.{js,jsx,ts,tsx}` — leaf, renders URL
- `layout.{js,jsx,ts,tsx}` — wraps all descendant pages and nested layouts
- `loading.{js,jsx,ts,tsx}` — suspense fallback for sibling page
- `error.{js,jsx,ts,tsx}` — error boundary for sibling page
- `not-found.{js,jsx,ts,tsx}` — 404 boundary for sibling page
- `template.{js,jsx,ts,tsx}` — like layout but re-mounted per navigation
- `route.{js,ts}` — HTTP handler (replaces `page`)
- `default.{js,jsx,ts,tsx}` — fallback for unmatched parallel slot

Path segments:

- `(group)` — route group, transparent to URL, opaque to layout nesting (a layout inside `(group)/` still wraps only children of that dir)
- `[id]` / `[...slug]` / `[[...slug]]` — dynamic; same nesting rules
- `@slot` — parallel route slot; `default.tsx` siblings to the slot's `page.tsx` become a layout-time fallback
- `(.)foo`, `(..)foo`, `(...)foo` — intercepting routes; treat as normal pages for nesting

### Name/path → target mapping

For each `page.tsx` (or `route.ts`) at `app/.../<dir>/page.tsx`:

1. **Walk ancestors up to the `app/` root.** For each ancestor dir, if it contains `layout.{ts,tsx,js,jsx}`, emit synthetic edge `page → layout`.
2. **Same-dir siblings:** if `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx` exist in the page's dir, emit `page → sibling`.
3. **Parallel slots:** for any sibling dir named `@slot`, emit `parent layout → slot/page.tsx` and `parent layout → slot/default.tsx` if either exists.

For each `layout.tsx`: emit edges to ancestor layouts (same walk).

### Pages router (legacy, also present in cal)

`pages/**/*.{js,jsx,ts,tsx}` except `pages/api/**`:

- Every file under `pages/` is a route. There is no per-dir layout convention (apps use `_app.tsx`); emit `page → _app.tsx` and, if present in the same parent chain, `page → _document.tsx`. Both files live directly under `pages/`.
- `pages/_error.tsx` — global error boundary. Optional edge from every page; **skip** to avoid edge explosion (would touch every page in the repo).
- `pages/api/**` route files have no view layer; no synthetic edges to emit.

### Edge cases

| Case | Handling |
|---|---|
| `(group)` segment | Skip for URL formation; **does** participate in layout nesting (its `layout.tsx` wraps children) |
| `@slot` segment | Acts as named slot; `default.tsx` only as parallel-route fallback edge |
| `[param]`, `[...slug]` | Treat as opaque segment for nesting |
| `(.)`, `(..)`, `(...)` intercepting | Treat as normal page; intercept relationship not modeled |
| Multiple file extensions | Disambiguate by extension preference order `.tsx > .ts > .jsx > .js` |
| `app/` lives in monorepo subdir | Walk up to find nearest `next.config.{js,ts,mjs}` or `package.json` with `"next"` dep, anchor `app/` there |

### Out-of-scope (v2)

**URL-string fetch matching.** Calling code does `fetch('/api/foo')` and that should edge to `app/api/foo/route.ts`. Requires extracting fetch-call URL literals across the codebase, normalizing dynamic segment placeholders. **Defer.** Low-precision (string matching), high false-positive rate without per-URL validation.

### Stoplist (for this framework only)

- Imports from `next`, `next/*` → never resolve to a file in the repo; existing generic resolver already drops them.
- Files under `app/` not matching the special filenames (e.g. random `.tsx` co-located in a route dir) — **not** routes; do not emit synthetic edges *from* them. They are referenced via normal imports from `page.tsx`.

### Integration sketch

New file `src/indexer/extractors/nextjs-routing.ts`:

```ts
export interface NextRouteEdge {
  from: string;  // absolute file path
  to: string;    // absolute file path
  kind: 'layout' | 'sibling' | 'parallel-fallback' | 'app-wrapper';
}

export function findNextRoutes(rootDir: string, allFiles: string[]): NextRouteEdge[]
```

Hooked into the graph build (`src/indexer/graph.ts`) **after** parse-and-resolve but before the final edge dedupe pass. Same shape as Rails associations: synthetic file→file edges, no symbol attribution required (route nesting is a file-level relation).

Trigger detection: presence of `package.json` containing `"next"` in `dependencies` or `devDependencies`, or presence of `next.config.{js,ts,mjs}`. Apply to the directory tree under that package.json.

### Per-framework priority: HIGHEST

Next.js is dominant in the benchmark suite (cal). Layout/error/loading nesting is invisible to import-only analysis and shapes user navigation queries directly ("where is the layout for the booking page").

---

## Framework 2 — SvelteKit FS routing (PRIORITY 2)

### Convention surface form

Under `src/routes/`:

- `+page.svelte` / `+page.{ts,js}` — page leaf (paired files)
- `+layout.svelte` / `+layout.{ts,js}` — layout
- `+page.server.{ts,js}` — server load
- `+layout.server.{ts,js}` — server layout load
- `+server.{ts,js}` — API handler (no view)
- `+error.svelte` — error boundary

Group dirs: `(group)` — transparent to URL, **also** transparent to layout nesting? No — same as Next.js, layout inside group wraps children of that dir.

Slot syntax: SvelteKit uses `[id]`, `[...slug]`, `[[optional]]`. Same handling as Next.

### Mapping

For `+page.svelte`:
- edge to nearest `+page.{ts,js}` sibling (server/client pair) if exists
- edge to nearest `+page.server.{ts,js}` sibling
- walk ancestors, emit edges to every `+layout.svelte` and `+layout.server.{ts,js}` until `src/routes/` root
- sibling `+error.svelte` → edge

For `+server.ts`: walk ancestors for `+layout.server.{ts,js}` only (no view).

### Trigger

`svelte.config.{js,ts}` exists OR `@sveltejs/kit` in package.json.

### Per-framework priority: 2

No benchmark repo uses it today, but SvelteKit is conventional enough that the rules transfer mechanically from Next.js. Implement when next benchmark suite includes one.

---

## Framework 3 — Nuxt 3 FS routing (PRIORITY 3)

### Convention surface form

- `pages/**/*.vue` — route (Vue file directly, no `+page.vue` prefix)
- `layouts/**/*.vue` — named layouts; referenced by string in `<script setup>`:
  ```ts
  definePageMeta({ layout: 'custom' });   // → layouts/custom.vue
  ```
- `middleware/**/*.ts` — named middleware, similar string-ref pattern
- `app.vue` — root wrapper (always present if used)

### Mapping

For each `pages/**/*.vue`:
1. Scan the file's `<script setup>` (already extracted) for `definePageMeta({ layout: '<name>' })` literal. Resolve `<name>` to `layouts/<name>.vue`. Emit edge.
2. If no `definePageMeta`, default layout is `layouts/default.vue`; emit edge if file exists.
3. Edge from every page to `app.vue` if it exists.

### Edge cases

- `layout: false` — disables; emit no edge.
- `layout` value is a computed/non-literal expression — skip, do not guess.
- Nuxt 2 (`nuxt` 2.x) — different config; out of scope unless a benchmark needs it.

### Trigger

`nuxt.config.{js,ts,mjs}` OR `nuxt` in package.json `dependencies`/`devDependencies`.

### Per-framework priority: 3 (no current benchmark)

---

## Framework 4 — NestJS DI (PRIORITY 4)

### What's already covered (no work needed)

`@Module({ imports, controllers, providers, exports })` array entries are class identifiers that the same file already imports normally. coldstart's TS resolver already produces those edges. **Don't re-emit.**

Constructor injection by **concrete class** is also covered: the controller `import { FooService }` produces the edge, regardless of `@Injectable()`.

### What's missing

**Token / interface DI.** Provider registered as `{ provide: FOO_TOKEN, useClass: FooImpl }` or `{ provide: 'IFoo', useClass: FooImpl }` and consumed via `@Inject(FOO_TOKEN) private foo: IFoo`. The token is the link — but if both consumer and producer import the token from the same constants file, the import graph already shows them as siblings of that token file. **Marginal additional value.** Treat as v2.

The genuinely-missing case: **module re-export chains.** `ModuleA imports: [ModuleB]`, `ModuleB exports: [SharedService]`, consumer in ModuleA injects `SharedService` without importing it directly (NestJS injector resolves through module graph). The consumer file has no import for `SharedService`. Edge candidate: `consumer → SharedService file` via module-graph traversal.

### Mapping (if implemented)

1. Parse every file with an `@Module({ ... })` decorator into `{ imports: Module[], providers: Service[], exports: Service[] }`.
2. Build module-level provider visibility map.
3. For each `@Inject(Token)` / typed constructor param, if the consumer's owning module's transitive imports expose a provider for that token, emit `consumer → provider file`.

### Per-framework priority: LOW

Complex parse, narrow benefit (only files with token-based or re-exported DI gain edges). Recommend skipping in v1 unless a benchmark proves it matters. The `@Module` arrays case already works through normal imports.

### Stoplist

`@nestjs/common`, `@nestjs/core`, `reflect-metadata`.

---

## Framework 5 — Vue/Svelte/Astro template component refs (PRIORITY 5 — mostly already covered)

### Status check (done)

Sampled `~/benchmark/repos/terraforming-mars/terraforming-mars-coldstart/src/client/components/Awards.vue`:

```html
<template>
  <Award v-for="award in awards" ... />
</template>
<script lang="ts">
import Award from '@/client/components/Award.vue';
export default defineComponent({ components: { Award }, ... });
</script>
```

The `<Award>` template reference is **already covered** by the existing script-extraction (`extractSfcScripts` in `src/indexer/parser.ts`) producing a normal `import Award from '...Award.vue'` edge.

### Residual gap

**Globally-registered components** (`app.component('GlobalThing', GlobalThing)` in `main.ts`) referenced from any template without a local script import. These are rare in modern (Vue 3 + `<script setup>`) code but appear in older codebases. Detection:

1. Scan a `main.ts` / `app.ts` / Nuxt-plugin file for `app.component(<string>, <ident>)` calls. Build a name→file map (`ident` resolved through the normal import in the same file).
2. For each SFC, regex-scan the `<template>` block for `<PascalCaseTag ...>` not present in the script's imports/components map. If a name matches the global registry, emit edge.

**Confidence: low**. Easy to false-positive on plain HTML elements styled as PascalCase. Recommend NOT implementing without a benchmark target.

### Auto-imports (Nuxt, `unplugin-vue-components`)

Nuxt 3 + components plugin auto-imports `components/**/*.vue` by filename. Same problem shape: the SFC has no import for `<MyButton>` but `components/MyButton.vue` exists. Detection:

1. Trigger on `nuxt.config` OR `unplugin-vue-components` dep.
2. Build name→file map from `components/**/*.vue` filename (PascalCase).
3. Template-scan SFCs for PascalCase tags not in script imports; resolve via map.

**Risk:** regex template scanning is fragile (comments, slots, dynamic `<component :is>`). Defer until benchmark gain measured.

### Per-framework priority: 5 (low)

---

## Framework 6 — Glob-loaded directories (Express/Koa, custom) (PRIORITY 6 — no benchmark evidence)

### Convention surface form

```js
// routes/index.js
const fs = require('fs');
const path = require('path');
const router = require('express').Router();
fs.readdirSync(__dirname)
  .filter(f => f !== 'index.js' && f.endsWith('.js'))
  .forEach(f => router.use('/' + f.replace('.js',''), require('./' + f)));
module.exports = router;
```

Tree-sitter sees only `require('express')` and the local require pattern; the auto-loaded siblings are invisible.

### Detection heuristic

In any file:
1. Top-level call to `fs.readdirSync(__dirname)` (or `require('fs').readdirSync(__dirname)`).
2. Followed by `.forEach`/`.map` that calls `require()` / dynamic `import()` with a path expression built from the iterated filename.
3. If both conditions met, emit synthetic edges from this file to **every sibling file in the same directory** matching the filter extension(s).

### Mapping

`from = the index file`, `to = each sibling .js/.ts (excluding index file itself)`.

### Confidence

Medium. The pattern is recognizable. False positives possible if the dir is scanned for non-import purposes (logging, validation). Mitigation: require the loop body to contain `require(` or `import(` syntactically.

### Benchmark evidence

`terraforming-mars`: routes are **explicitly imported** in `src/server/server/requestProcessor.ts` (verified — see `poc-output.txt`). **No glob-loading present.** No current benchmark proves this matters.

### Per-framework priority: 6 (defer)

---

## Stoplist (global, for this resolver family)

Never emit synthetic edges to:
- `next`, `next/*`
- `@nestjs/*`
- `svelte`, `@sveltejs/*`
- `vue`, `vue-router`, `pinia`, `@vue/*`
- `nuxt`, `@nuxt/*`
- `react`, `react-dom`, `react/*`, `react-dom/*`
- Node stdlib: `fs`, `path`, `crypto`, `http`, `https`, `node:*`
- `express`, `koa`, `fastify` (the lib itself)

Existing generic resolver in `src/indexer/resolvers/generic.ts` already drops un-resolvable specifiers, so most of this is automatic. Listed here for clarity.

---

## Integration plan (when this leaves research)

1. **Trigger detection** in `src/indexer/walker.ts` (or a new `src/indexer/frameworks/detect.ts`): single pass over package.json files in the repo, build a `FrameworkContext` per directory subtree.
2. **One extractor per framework** under `src/indexer/extractors/nextjs-routing.ts`, `sveltekit-routing.ts`, etc. Each emits a list of synthetic `{from, to, kind}` edges.
3. **Wire into graph** in `src/indexer/graph.ts`, dedupe against existing edges from `imports`.
4. **Patch path** (`src/indexer/patch.ts`): when a `page.tsx` / `layout.tsx` is added or removed, re-run the routing extractor for that subtree only (not full rebuild).
5. **Tests**: per-framework fixture under `test/fixtures/` (Next.js minimal app dir, SvelteKit minimal, Nuxt minimal). Snapshot edge list.

## Priority order summary

1. Next.js app + pages router (cal-driven)
2. SvelteKit (mechanical port of Next.js logic, defer until benchmark)
3. Nuxt (defer)
4. NestJS DI (low value, defer)
5. Vue/Svelte/Astro template refs (mostly already covered; auto-imports defer)
6. Glob-loaded dirs (defer; no benchmark evidence)

The only framework with current benchmark-driven need is **Next.js**. The rest is sequencing for when the suite grows.
