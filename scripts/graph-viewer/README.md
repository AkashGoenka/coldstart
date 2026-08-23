# Graph viewer — design source

The viewer that `coldstart graph` opens. It ships from `src/graph/`; what lives here is the
**HTML design source** plus the two scripts that bake it.

- `sphere.template.html` — the whole viewer: markup, CSS, and the canvas script, with
  `/*__DATA__*/null` standing in for the payload so the file stays openable in a browser while you
  iterate on it.
- `build-template.mjs` — bakes that HTML into `src/graph/view-template.ts`. **Run it after every
  change to the HTML**, or the shipped viewer keeps the old design. tsc does not copy non-`.ts`
  assets into `dist/`, which is why the template ships as a string constant.
- `build-site-page.mjs` — generates `site-astro/src/graph-page.html`, which the Astro route
  `src/pages/graph/index.astro` inlines to serve `/graph/` on coldstartmcp.dev. Same viewer, this
  repo's own graph baked in, a link home added, and **no notebook edges** — the notebook is private
  working memory, not marketing copy. It is a route rather than a file in `public/` because
  `astro dev` serves `public/` by exact path and 404s on `/graph/`, the URL the nav links to.

```sh
# edit sphere.template.html, then:
node scripts/graph-viewer/build-template.mjs   # → src/graph/view-template.ts
npm run build                                  # → dist/
coldstart graph                                # try it
node scripts/graph-viewer/build-site-page.mjs  # → the site page
```

The data half lives in `src/graph/dump.ts` and is covered by `tests/graph.test.ts`.

## What it shows

**Globe.** Every indexed file is one point, connected or not. Latitude is the directory: bands are
allocated equal-area (y is uniform on a sphere, so a band's share of `y` is its share of surface),
and seats are a pure function of the data, so a file sits in the same place on every reload. There
are deliberately no edges and no standing labels here — hovering names a file, and that is all.

**2D explorer.** Clicking a point opens a **sliding two-level window**:

- the **centre** is the file you came from, with its neighbours around it;
- clicking a neighbour **opens** it in place, fanned out with its own neighbours;
- clicking one of *those* slides the window along — the opened file becomes the centre.

The picture therefore never accumulates hops; it always shows exactly two levels. Once something is
opened the layout switches from a ring to a **spine**: centre on the left, opened on the right, each
fanning into its own half of the screen, with the relation between them drawn down the middle.

Every edge is named, which is the point of the thing:

| relation | source | example label |
|---|---|---|
| imports / imported by | `index.edges` | `imports` |
| calls / called by | `index.symbolEdges` (`calls`), aggregated per file pair | `calls save(), load()` |
| moves together | `cochange.json` sidecar, top 3 partners | `moves together · 13 of 42 commits` |
| same note | each notebook note's `anchors` | `same note · <note title>` |

File-level edges are all plain `import`, so the verbs come from symbol edges. `extends`/`implements`
are skipped: their `to` is a bare name, not resolvable to a file.

## Things that will bite you if you change it

- **Directory bands are adaptive, not fixed-depth.** A fixed two-segment cut put 1,093 of arches's
  1,615 files into `arches/app` — one band swallowing two thirds of the sphere. `assignClusters`
  splits any band over 13% one segment deeper and folds the slivers back together.
- **Ring and fan radii come from the arc they need**, never a constant. A 44-neighbour hub and a
  4-neighbour leaf cannot share a radius.
- **Filenames reserve their label boxes before relation labels are placed**, and node *dots* are
  reserved in a separate list from label boxes. Merging those two lists makes every node's label
  collide with its own dot and disappear.
- **No white in the data palette.** It is the brightest value on a dark ground, so it out-shouts
  every hue regardless of which directory happens to receive it, and the explorer already spends
  white on hover and labels. A colour used for interaction should not also encode data.
- **Palette lightness is compensated per hue** (amber `l: 0.56` against violet `l: 0.70`) so the
  sphere reads as evenly lit; equal HSL lightness does not look equally bright.
- Colours are grouped into six **contiguous zones**, not cycled per band — cycling throws away the
  latitude ordering and produces confetti. Two sets ship, `aurora` (default) and `jewel`; switch
  with `setPalette('jewel')` in the console.

## Known limits

- Zone size follows a band's file count, not its importance: `tests/fixtures` (149 files) gets a
  whole colour zone.
- The symbol-level neighbourhood is not drawn, because `self.method()` / `this.method()` calls do
  not resolve — a 15-method class currently yields about five disconnected pairs.
