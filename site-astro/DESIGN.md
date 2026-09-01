# coldstart — site design language

> Spec for the coldstartmcp.dev revamp. The bar, borrowed from EpicInfographics'
> design-language template: **someone with zero taste, following only this file,
> should produce something recognizably coldstart.** Nothing here is "make it
> look nice" — every rule is a hex, a px, or a prohibition.
>
> Rendered once at `/specimen/`. Approve the spec and that page, not a stack of
> variations.
>
> **v2** — revised after review. Changes: the gradient now uses the real accent
> hues instead of two near-identical blacks; body copy is near-white instead of
> grey; surfaces are translucent and the paper note card is gone; the full-bleed
> separator from `/how-it-works/` is adopted; §7 is specified from real Claude
> Code screenshots; §10 (the exportable loop) is new.

---

## 0. What's actually wrong today

Verified in the browser on 2026-09-01, not asserted.

**Content is hidden behind JavaScript on more than one page.** On `/demo/`,
every child of `.recall.reveal` is `opacity:0` in the inline `<style>` of
`src/pages/demo/index.astro` and only gets `.in` when an `IntersectionObserver`
at `threshold:0.2` fires `runTimeline`. A full-page capture is ~2000px of void.
Even scrolling normally you wait through a ~15s cumulative `data-t` countdown
per section, because each `.term.live` types itself character by character
before the next item may appear.

`/how-it-works/` has the same class of bug — 16 elements at `opacity:0`,
including several `.temp-item`, which is the ~700px blank region mid-page.

This is not a timing problem to tune. The mechanism goes (§6).

**The palette is banded, not blended.** `--frost` owns navigation sections,
`--ember` owns the one notebook section. The temperature idea is stated in a CSS
comment and applied as two mutually exclusive zones, so the page never shows
both at once — which is the whole product.

**Everything is centered.** `.hero` is `text-align:center`, `.hero-in` is
`max-width:920px;margin:0 auto`, and `.navsec > .wrap > .rise:first-child` is
`max-width:720px;margin:0 auto;text-align:center`.

**Tokens drift across two stylesheets.** `landing.css` and `docs.css` each
declare their own `:root` and already disagree: `--wrap` is `1120px` in one and
`1080px` in the other, and `docs.css` redeclares `--frost`/`--ember` again at
line 306. A site-wide field is not buildable until this is one file.

**The AI tells, named honestly.** Serif display on near-black with one bright
accent is a current default AI look. So are: the radial glow behind the hero,
the dot-grid backdrop, `01 ·`/`02 ·` numbered eyebrows, and macOS traffic-light
dots on every terminal — which grab more attention than the content beside them.

---

## 1. The thesis

coldstart is an instrument. It measures a codebase exactly (cold) and remembers
what was learned (warm). The site is built on a **temperature axis** that is
literal and continuous rather than sectioned:

- The page is lit by **frost from the left edge and ember from the right**, as
  one fixed field, on every page.
- The two-column layout **carries** that axis: left is the argument and the
  exact evidence, right is the artifact — terminal, note, panel.
- **Nothing is opaque.** Every surface is a translucent wash, so panels sit
  *inside* the field instead of on top of it. This is the rule that makes a note
  card match the background rather than punch out of it.
- The one memorable element is the **seam** (§5).

Everything else stays quiet.

---

## 2. Palette

| Token | Value | Role |
|---|---|---|
| `--ground` | `#0b0e14` | base, under the field |
| `--frost` | `#4fbfe0` | **cold accent** — the index, `find`/`gs` |
| `--ember` | `#ef9448` | **warm accent** — the notebook, notes, inline code |
| `--ok` | `#7ec89a` | state only: `[fresh]`, shell prompt, tool-call dots |
| `--text` | `#eef3fa` | **all prose**, 17:1 |
| `--muted` | `#a8b6c9` | secondary metadata and captions, 9.5:1 |
| `--faint` | `#7f8da2` | mono labels and eyebrows only — **never a sentence** |
| `--surface` | `rgba(255,255,255,.035)` | cards, terminals, panels |
| `--line` | `rgba(255,255,255,.09)` | hairlines, borders, separators |
| `--wash-frost` | `rgba(79,191,224,.07)` | index-flavoured surfaces |
| `--wash-ember` | `rgba(239,148,72,.07)` | note-flavoured surfaces |
| `--edge-ember` | `rgba(239,148,72,.22)` | the note card's border |

**The field.** One fixed pseudo-element — *not* `background-attachment:fixed`,
which paints only the first viewport and is unreliable on iOS Safari:

```css
body::before{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:
    radial-gradient(78% 88% at  -6% 26%, rgba(79,191,224,.20), transparent 66%),
    radial-gradient(78% 88% at 106% 74%, rgba(239,148,72,.19), transparent 66%),
    linear-gradient(102deg,#0a1019 0%,#0b0e14 48%,#150f09 100%);
}
```

Below 860px the axis rotates to vertical (frost top, ember bottom) — the same
two glows at `50% -4%` and `50% 104%`.

**Text contrast.** Body copy is `--text`. Grey is for labels and captions, never
for a paragraph. This is the single rule that most changes how the site reads:
the previous pass set leads at `#93a2ba`, and light grey prose on a dark ground
is both hard to read and the thing that made the page feel washed out.

**Usage rules.**
- Sections do not have a temperature. A section may contain both accents, and
  most should.
- Inline `<code>` is `--ember` on `rgba(239,148,72,.09)`. This matches Claude
  Code's own inline-code treatment, so the demo panel and the prose agree.
- `--ok` is state, never decoration.
- No third accent hue, ever.
- **No opaque surface** except the Claude Code panel (§7), which is a replica.
- The paper stock (`--paper`, `--paper-ink`, `--paper-line`) is **retired**.

---

## 3. Typography

One change, and it's the risk: **drop the serif.** Newsreader on near-black is
borrowed editorial gravitas, and it is the most recognizable single marker of
AI-generated design right now. coldstart's world is an instrument panel.

| Role | Face | Weights | Where |
|---|---|---|---|
| Display | **Archivo** (variable, width axis) | 500–700, `wdth` 112 | h1, h2, h3 |
| Body | **IBM Plex Sans** | 400, 500, 600 | all prose |
| Utility | **JetBrains Mono** | 400, 500, 700 | terminals, code, labels, data |

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

| Step | Size / line-height | Tracking | Use |
|---|---|---|---|
| d1 | `clamp(34px, 4.6vw, 56px)` / 1.08 | `-0.02em` | h1, once per page |
| d2 | `clamp(26px, 3.2vw, 38px)` / 1.15 | `-0.015em` | section h2 |
| d3 | `21px` / 1.3 | `-0.01em` | card titles |
| lead | `18px` / 1.62 | `0` | lead paragraphs, in `--text` |
| body | `16px` / 1.7 | `0` | prose |
| mono | `13px` / 1.8 | `0` | terminal output |
| label | `11.5px` / 1.4 | `0.16em`, uppercase | eyebrows, captions |

Comparable numbers get `tabular-nums`. Prose is never centered, never past 66ch.

---

## 4. Layout system

**The hard left rail.** One text edge for the whole site. Nothing is centered.

```
├── 1120px wrap, 12 columns, 24px gutter ──────────────────────────┤

┌─ col 1 ──────────────── col 5 ┊ col 6 ─────────────── col 12 ─┐
│ EYEBROW                       ┊                               │
│ A heading that sits on the    ┊   ┌───────────────────────┐   │
│ left rail and stops at 5 cols ┊   │  the artifact         │   │
│                               ┊   │  terminal / note /    │   │
│ Lead copy, ≤66ch, ragged      ┊   │  panel / diagram      │   │
│ right, never centered.        ┊   └───────────────────────┘   │
└───────────────────────────────┴───────────────────────────────┘
   frost edge                   ┊                     ember edge
                            the seam
```

Two section types, and only two:

- **`.split`** — 5 / 7. Argument left, artifact right. Left column is
  `position:sticky; top:56px` on ≥1024px, so the claim holds while a long
  terminal scrolls past. The default.
- **`.plain`** — one column, constrained to columns 1–8. FAQ, install, closing
  CTA. Still on the left rail; the right third stays open for the ember edge.
  **Not** a centered column.

**Separator.** Sections are divided by a **full-bleed hairline**, lifted from
`/how-it-works/`, which is the one piece of the current site worth keeping:

```css
section{padding:84px 0;}
section + section{border-top:1px solid var(--line);}
```

It marks the boundary without banding the background — the field stays
continuous underneath. No section ever sets its own background colour.

**Mobile (<860px).** `.split` collapses to one column, artifact under argument,
sticky off, seam and ticks hidden, field rotated vertical.

---

## 5. Signature device — the seam

One hairline running the full viewport height at the column-6 gutter,
`background: var(--seam)` (frost→ember, top to bottom), `opacity: .34`.

- At each section's start it grows a **tick**: an 11px stub, a frost dot on the
  line, and the section's short label in `label` type, sitting 34px above the
  content so it rides in the separator gap.
- The ticks are the page's table of contents, and the only place a section index
  appears — which retires the `01 ·`/`02 ·` eyebrows, since the landing sections
  are not a sequence and never were.
- Hidden below 860px.

This is the whole flourish budget. Another decorative element means one goes.

---

## 6. Motion

- **Content is never hidden by default.** No `opacity:0` waiting on JS. A reveal
  is CSS-only or it doesn't ship. This is the hard rule §0 violates today, and
  the specimen is verified at zero `opacity:0` elements.
- Allowed: hover transitions ≤160ms, the scroll progress hairline, seam ticks
  brightening as their section enters view.
- Not allowed: typewriter effects, staggered line reveals, cumulative delay
  budgets, parallax, ambient floating shapes.
- `prefers-reduced-motion: reduce` disables all of it, with identical content.

Motion for **marketing** is a separate artifact, not a page behaviour — see §10.

---

## 7. The demo page — Claude Code panel

**Static, fully rendered.** The whole session is present on load. No typing, no
scroll triggers. Screenshot-able, works with JS off, scannable in three seconds.

Layout: one `.split` — transcript left (cols 1–8), commentary rail right (cols
9–12) with short annotations pointing at specific turns. The argument lives in
the rail so the panel stays a faithful replica carrying no marketing copy.

Two panels stacked, the same repo on two different days:
1. **Cold** — no note yet. `find` → `gs` → answer → the Stop hook writes a note.
2. **Warm** — same question, note recalled, zero tool calls.

**Chrome, specified from real screenshots.** The panel keeps its **own neutral
ground** rather than the site's field — it is a replica, so it should read as
the real thing sitting on the page, not a themed imitation.

| Part | Value |
|---|---|
| Panel ground | `#1f1f1f` |
| Prompt chip | `#2e2e2e`, radius 6, padding `10px 14px`, text `#f2f2f2` |
| Tool output box | `#1a1a1a`, 1px `#383838`, radius 6 |
| Gutter label | `IN` / `OUT`, mono 10px, `#6e6e6e`, right-aligned in a 34px column |
| Output text | mono 12px, `#cfcfcf`; elision `… +N lines` in `#6e6e6e` |
| Rail line | 1px `#383838`, dots 7px |
| Dot — tool call | `#7ec89a` (green) |
| Dot — thinking / prose | `#6b6b6b` |
| Tool header | `Bash` bold `#f2f2f2`, argument in mono `#8a8a8a` |
| Prose | `#e3e3e3`, 13.5px |
| Inline code | `#d9a05b` on `rgba(255,255,255,.06)`, radius 4 |
| Input bar | `#242424`, 1px `rgba(239,148,72,.45)`, send button `#a8604a` |

Output is real, unedited command output from this repo — same rule as today's
page. **No traffic-light dots anywhere**, on this panel or on any terminal.

---

## 8. Do / Don't

**Do**
- Start every section on the left rail.
- Put frost and ember in the same viewport.
- Set body copy in `--text`.
- Use real command output from this repo.
- Give comparable data `tabular-nums`.
- Label a terminal with its repo and branch — that's information.
- Ship keyboard focus with a frost ring.

**Don't**
- Don't set body copy in grey.
- Don't centre prose. Anywhere.
- Don't give a section its own background colour.
- Don't make a surface opaque (except the replica panel).
- Don't hide content behind an IntersectionObserver.
- Don't use `01 ·`/`02 ·` numbering unless the items are genuinely ordered.
- Don't draw traffic-light dots.
- Don't add a radial glow behind a heading.
- Don't use emoji as iconography, or introduce a third accent hue.

---

## 9. Build order

Each step ends with a rendered screenshot check, not a CSS read.

1. **`tokens.css`** — one `:root` imported by every page shell. Delete the
   duplicate blocks in `landing.css` and `docs.css`; settle `--wrap` at 1120px.
   Nothing looks different; this unblocks everything else.
2. **The field, the seam, the separator** — and remove per-section backgrounds
   and the dot grid. First visible change, site-wide.
3. **Contrast pass** — leads and prose to `--text`, grey confined to labels.
   Cheap, and the most immediately noticeable improvement.
4. **Type swap** — Archivo in, Newsreader out, apply the scale.
5. **Landing to `.split`/`.plain`** — kill the centering, retire the numbered
   eyebrows, drop the traffic lights.
6. **Demo page rebuild** — §7. Delete `runTimeline`, `typeCommand`, and the
   `opacity:0` rules outright.
7. **`/how-it-works/`** — same `opacity:0` bug, same fix.
8. **Docs, blog, graph, live** — carry tokens and grid through.

---

## 10. The exportable loop (marketing)

The demo **page** stays static per §6. The animation is a **separate artifact**
rendered from the same markup, so the page can never regress into the
blank-and-waiting state that §0 describes.

- Render `/demo/` in headless Chrome at a fixed viewport, drive one scripted
  pass (prompt → tool call → output → answer → note written → recall), capture a
  screencast, encode to MP4 + GIF. This is the EpicInfographics approach
  (Playwright + ffmpeg) and `chrome-devtools screencast_start/stop` can do it
  from the shell already.
- Target: **12–20s, silent, seamless loop, ≤1200px wide.** Short enough to
  autoplay in a timeline, long enough to show cold → warm.
- The loop must be legible with no audio and no captions: the two panels side by
  side, the second one visibly shorter, ending on `0 tool calls`.
- Outputs live in `site-astro/public/` and are reusable in the README, the npm
  page, and the GitHub social preview — one asset, four surfaces.

---

## 11. Calibration — measured against the reference class

Not opinion. Computed styles pulled from live pages on 2026-09-01 with an
identical probe (`getComputedStyle` over every element, leaf text nodes only for
colour/size counts). Reference class = developer-tool sites, chosen because they
share coldstart's constraints: invisible product, no photography budget,
skeptical audience. WordPress/Webflow templates were deliberately NOT sampled —
they are engineered to be generic, which is the opposite of the brief.

### The table

| Site | Ground | h1 px | h1 lh | h1 tracking | Body | Body colour | Faces | Distinct radii | Weights |
|---|---|---|---|---|---|---|---|---|---|
| linear.app | `#08090a` | 64 | **1.00** | −0.022em | 15 / 1.6 | `#8a8f98` | 2 | 5 | 400, 510 |
| resend.com | `#000` | 96 | **1.00** | −0.010em | 18 / 1.5 | `#a1a4a5` | 6 | 5 | 400 |
| vercel.com | `#000` | 64 | **1.00** | −0.060em | 16 / 1.5 | `#a1a1a1` | 2 | **1** | 400, 450, 500 |
| tailwindcss.com | — | 96 | **1.00** | −0.050em | 18 / 1.56 | grey | 2 | 5 | 400, 500 |
| bun.sh | `#0d0a0c` | 68 | **0.92** | −0.020em | 18 / 1.55 | `#a8a8a5` | 3 | **2** | 400, 700 |
| railway.com | `#13111c` | 54 | 1.12 | −0.036em | 18 / 1.6 | `#fff` @65% | 4 | 5 | 400, 500 |
| clerk.com | `#f7f7f8` | 64 | 1.13 | −0.025em | 18 / 1.56 | `#5e5f6e` | 3 | 5 | 400, 500 |
| val.town | `#fff` | 48 | 1.20 | −0.025em | 18 / 1.6 | `#000` | 3 | 3 | 400, 700 |
| **coldstart today** | `#070a11` | **44** | **1.20** | −0.010em | 18 / 1.65 | `#8b9ab2` | 5 | 5 | 400, 500, 600, 700 |
| **specimen v2** | `#0b0e14` | 56 | 1.08 | −0.020em | 18 / 1.62 | **`#eef3fa`** | 6 | 5 | 400, 500, 600, 700 |

### Where the live site is an outlier

1. **h1 is 44px — the smallest in the set.** The band is 48–96, clustered at
   64. The specimen's 56 is inside it.
2. **h1 line-height 1.20 is the loosest in the set**, tied with val.town. Five
   of eight sit at exactly **1.00**, and bun goes to 0.92. This is a large part
   of why reference headlines read "engineered" — the specimen's 1.08 is close
   but could go to 1.00 at d1.
3. **Tracking −0.01em is the loosest.** Everyone else is −0.02 to −0.06.
4. **Four font weights and five radii.** Vercel ships essentially **one** radius
   (6px, 57 uses) and three weights; bun uses two radii. Consistency at this
   level is most of what reads as "designed." → **Pick two radii and two
   weights and enforce them.**
5. **Five typefaces resolved**, including `Arial` and `Times` — fallbacks
   leaking, meaning some elements never get the intended face.

### The grey-text finding, quantified

**Seven of eight reference sites use grey body copy.** The specimen's near-white
`#eef3fa` is now the outlier in the other direction.

The problem with the live site's grey was never that it was grey — it's that
it's **blue**:

| | Body grey | R−B spread |
|---|---|---|
| vercel | `#a1a1a1` | **0** |
| bun | `#a8a8a5` | 3 |
| linear | `#8a8f98` | 14 |
| **coldstart** | `#8b9ab2` | **39** |

coldstart's grey carries roughly **3× the chroma** of Linear's. A saturated blue
grey on a blue-black ground has low hue separation from its own background,
which is what reads as washed out. The reference class uses near-neutral greys
against near-neutral grounds — only lightness separates them.

Second contributing factor: the live site sets **leads and body both to muted**
with no brighter tier above. Linear runs a four-step ramp topped by `#f7f8f8`
carrying emphasis. Without that top step nothing anchors the scale.

**Rule:** near-white body copy is the committed default (§2). Grey body copy is
permitted only if (a) the grey is near-neutral — R−B spread under ~15 — and (b)
a brighter tier exists above it doing emphasis.

### Gradients — the corrected finding

A first pass reading only `body` and the hero element reported all eight sites
flat. **That was wrong**, and the error is worth recording: gradients are used
heavily, but almost never as wallpaper.

| Site | Radial | Linear | **Large-area (>600×300)** |
|---|---|---|---|
| linear.app | 7 | **51** | **1** |
| vercel.com | 1 | 6 | **1** (+1 canvas) |
| railway.com | 0 | 4 | **1** |
| tailwindcss.com | 12 | 11 | 8 |

Linear carries **58 gradients and exactly one is page-scale.** The other 57 are
component-scale: button fills, card edges, hairline borders. That is where the
polish comes from — *gradient as an edge treatment, not as atmosphere.*

**Two rules follow:**

- **At most ONE page-scale gradient.** The specimen currently runs two (a frost
  radial and an ember radial). That is more atmosphere than any reference site
  except tailwind. → Use the **flat ramp** shape, which puts both temperatures
  in a single gradient, instead of two opposing blobs.
- **Use gradients freely at component scale** — hairlines, borders, small fills.
  The seam (§5) is already exactly this move and should be joined by others.

---

## 12. Settled decisions

These are decided. Do not re-open them, re-derive them, or offer alternatives.

| Decision | Value |
|---|---|
| **Field shape** | Single `linear-gradient(90deg, …)` ramp — **one** page-scale gradient, never two blobs |
| Field frost | `rgba(79,191,224,.20)` at 0%, transparent by 42% |
| Field ember | `rgba(239,148,72,.19)` at 100%, transparent by 58% |
| **Body copy** | Near-white `--text #eef3fa`. Grey body copy is NOT adopted. |
| **Radii — exactly two** | `6px` components (buttons, chips, inline code, small boxes) · `10px` panels (cards, terminals, the Claude Code panel) |
| **Font weights — exactly two** | `400` body · `600` display. No 500, no 700. |
| **Display** | Archivo, `wdth 112`, **d1 line-height `1.00`** |
| **Demo page** | Static Claude Code replica. `runTimeline`/`typeCommand`/`opacity:0` deleted, not tuned. |
| **Marketing GIF** | Rendered offline from the page. Never an in-page animation. |
| **Seam** | Kept. |

The committed field, verbatim:

```css
body::before{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:
    linear-gradient(90deg,
      rgba(79,191,224,.20) 0%, transparent 42%,
      transparent 58%, rgba(239,148,72,.19) 100%),
    #0b0e14;
}
@media(max-width:860px){
  body::before{background:
    linear-gradient(180deg,
      rgba(79,191,224,.20) 0%, transparent 42%,
      transparent 58%, rgba(239,148,72,.19) 100%),
    #0b0e14;}
}
```

### Radius and weight migration

The live site currently ships **five** radii (`4, 8, 9, 13, 50`) and **four**
weights (`400, 500, 600, 700`). Collapse them:

| Found | Becomes |
|---|---|
| `4px`, `6px` | `6px` |
| `8px`, `9px`, `10px`, `12px`, `13px`, `14px` | `10px` |
| `50%` / `9999px` on a pill or dot | unchanged — a circle is not a radius choice |
| weight `500` | `400` |
| weight `700` | `600` |
