#!/usr/bin/env bash
# dump.sh <root> — print every active note body (frontmatter stripped), one after another.
d="$1/.coldstart/notebook/notes"
for f in "$d"/*.md; do
  [ "$(basename "$f")" = _index.md ] && continue
  grep -q '^status: active' "$f" || continue
  echo "=================== $(basename "$f" .md)"
  awk 'BEGIN{c=0} /^---$/{c++; next} c>=2' "$f"
done
