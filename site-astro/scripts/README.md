# OG Card Generation

## Overview

This directory contains the source and generation script for `public/og.png`, the social media preview card (1200×630) shown when coldstart links are shared.

## Files

- **`og.html`** — The card template. Self-contained HTML + CSS that renders the card design. Uses Google Fonts (Newsreader, IBM Plex Sans, JetBrains Mono) loaded over HTTPS.
- **`generate-og.sh`** — Bash script that drives Chrome via `chrome-devtools-cli` to render the template and save the screenshot.

## Regenerating the Card

```bash
cd site-astro
bash scripts/generate-og.sh
```

This will:
1. Open the template in Chrome
2. Set the viewport to 1200×630
3. Wait for web fonts to load
4. Capture a screenshot
5. Save it to `public/og.png`

## Design Details

The card is built from the live site's design system:

- **Background:** Dark (`#070a11`)
- **Wordmark:** Snowflake icon (cyan) + "coldstart" (Newsreader serif)
- **Kicker:** "CODEBASE MEMORY FOR AI CODING AGENTS" (JetBrains Mono, cyan, uppercase, letterspaced)
- **Headline:** "Your agent relearns your codebase from <span style="color: #4fbfe0">scratch</span> — every <span style="color: #ef9448">session.</span>" (Newsreader serif, 48px)
  - "scratch" accented in frost cyan (`#4fbfe0`)
  - "session" accented in warm amber (`#ef9448`)
- **Sub-lines:** Two lines in IBM Plex Sans, muted gray, explaining the value proposition
- **Bottom rule:** Subtle gradient from cyan to amber

All colors and fonts match the live homepage design in `src/styles/landing.css`.

## Prerequisites

The generation script requires `chrome-devtools-cli` to be running. This is installed and wired automatically by the Claude Code CLI when the project is initialized with `coldstart init`.

To check if the server is running:
```bash
chrome-devtools status
```

## Notes

- The HTML file is self-contained and renderable locally (`file://` URL).
- Google Fonts are loaded over HTTPS, so the machine must have internet access during generation.
- The script captures only the viewport (no scrolling), which is exactly 1200×630, matching the target card size.
- No further editing is needed unless the text, colors, or layout change on the homepage.
