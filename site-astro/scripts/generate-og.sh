#!/bin/bash
# Regenerates public/og.png (the 1200x630 social card) from scripts/og.html.
# Run after changing the card copy:  bash scripts/generate-og.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEMPLATE_FILE="$SCRIPT_DIR/og.html"
OUTPUT_FILE="$REPO_ROOT/public/og.png"

# chrome-devtools refuses to write outside its allowed workspace roots, so the
# screenshot lands in TMPDIR and is copied into the repo afterwards.
TEMP_PNG="${TMPDIR:-/tmp}/coldstart-og-$$.png"

# A leftover temp file from an earlier run would let a FAILED capture copy a
# stale card into the repo unnoticed. Start from nothing and clean up on exit.
rm -f "$TEMP_PNG"
trap 'rm -f "$TEMP_PNG"' EXIT

[ -f "$TEMPLATE_FILE" ] || { echo "ERROR: missing template $TEMPLATE_FILE" >&2; exit 1; }

echo "Rendering $TEMPLATE_FILE ..."
chrome-devtools new_page "file://$TEMPLATE_FILE" --timeout 10000 >/dev/null

# resize_page silently does not apply; emulate is the one that takes effect.
chrome-devtools emulate --viewport "1200x630" >/dev/null

VIEWPORT=$(chrome-devtools evaluate_script "() => [window.innerWidth, window.innerHeight].join('x')")
echo "Viewport: $VIEWPORT"
case "$VIEWPORT" in
  *1200x630*) ;;
  *) echo "ERROR: viewport is not 1200x630 (got: $VIEWPORT)" >&2; exit 1 ;;
esac

# Block until webfonts are actually loaded — otherwise the card renders in
# fallback faces and the serif headline silently becomes something else.
chrome-devtools evaluate_script "async () => { await document.fonts.ready; return document.fonts.status; }" >/dev/null
sleep 1

echo "Capturing ..."
chrome-devtools take_screenshot --filePath "$TEMP_PNG" >/dev/null

[ -f "$TEMP_PNG" ] || { echo "ERROR: screenshot was not written to $TEMP_PNG" >&2; exit 1; }

# Fail loudly on a wrong-sized card rather than committing it.
if command -v sips >/dev/null 2>&1; then
  W=$(sips -g pixelWidth "$TEMP_PNG" | awk '/pixelWidth/{print $2}')
  H=$(sips -g pixelHeight "$TEMP_PNG" | awk '/pixelHeight/{print $2}')
  echo "Captured: ${W}x${H}"
  if [ "$W" != "1200" ] || [ "$H" != "630" ]; then
    echo "ERROR: expected 1200x630, got ${W}x${H} — not writing $OUTPUT_FILE" >&2
    exit 1
  fi
fi

cp "$TEMP_PNG" "$OUTPUT_FILE"
echo "✓ Wrote $OUTPUT_FILE"
echo "  Now open it and check the text is not clipped before committing."
