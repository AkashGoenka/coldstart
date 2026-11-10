---
paths:
  - "site-astro/**"
  - "src/graph/**"
  - "scripts/graph-viewer/**"
---

# Site (`site-astro/`) and graph viewer

**Site:** the Astro marketing site on coldstartmcp.dev (the old static `site/` is retired). Home (`src/pages/index.astro`), docs (`src/pages/docs.astro`), and blog (`src/pages/blog/`, content in `src/content/blog/`) share `Nav.astro`/`Footer.astro`/`Head.astro`; `landing.css` styles the home page, `docs.css` styles docs + blog. **When a change is meaningful to an outside user** (a command's behavior/flags change, a new `kb` subcommand ships, the notebook's guarantees change, the npm package name changes) — update `site-astro/src/pages/docs.astro` (and `index.astro` if it affects the pitch). Routine internal refactors don't need a site update.

**Frontend/site work tooling:** when reshaping `site-astro/` UI —
- Load the `frontend-design` skill (Anthropic plugin, installed globally) before making aesthetic/typography/layout calls. It's built to counter templated-default choices — exactly the risk `DESIGN.md`'s own self-critique note flags in the current design.
- Use the `chrome-devtools-cli` skill (`.claude/skills/chrome-devtools-cli/`) to drive a live browser from the shell — `chrome-devtools navigate_page`, `take_screenshot`, `take_snapshot`, `evaluate_script`, etc. — for visual verification, instead of ad hoc headless-Chrome invocations.
- Always verify UI changes by actually rendering the page (dev server + one of the above), never by reading the CSS/markup alone.

**Graph viewer (`src/graph/`, `coldstart graph`):** `dump.ts` (index + co-change sidecar + note anchors → one payload; adaptive directory banding, 4 named relation kinds), `view.ts` (bake + write + open), `view-template.ts` (**GENERATED** — edit `scripts/graph-viewer/sphere.template.html` and re-run `scripts/graph-viewer/build-template.mjs`, never hand-edit). Human-only, deliberately NOT an MCP tool, same as `kb view`. The page is dependency-free HTML/CSS/canvas with the payload inlined. `scripts/graph-viewer/build-site-page.mjs` emits `site-astro/src/graph-page.html` (no note edges — the notebook is private), which the Astro route `src/pages/graph/index.astro` inlines; it is a route and not a `public/` file because `astro dev` 404s on `/graph/` when the file only exists at `public/graph/index.html`.
