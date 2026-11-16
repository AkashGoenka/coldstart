#!/usr/bin/env bash
# hubs.sh <root> [N] — rank source files by importedBy (coldstart graph) + git churn.
# Excludes tests, migrations, vendored/generated and non-code files.
root=${1:?root}; n=${2:-25}
cd "$root" || exit 1
git ls-files | grep -E '\.(rb|ts|tsx|js|jsx|go|py|rs|java|kt|php|cs|ex|exs|erb|vue|svelte)$' \
  | grep -v -E '(^|/)(spec|test|tests|__tests__|testdata|fixtures|vendor|node_modules|dist|build|db/migrate|migrations|generated)/|_test\.go$|\.test\.|\.spec\.|\.d\.ts$' \
  | while read -r f; do
      ib=$(coldstart gs "$f" --root "$root" --view importers 2>/dev/null | grep -o 'importedBy: [0-9]*' | head -1 | grep -o '[0-9]*')
      ch=$(git log --oneline -- "$f" 2>/dev/null | wc -l)
      echo "$(( ${ib:-0} * 3 + ch )) ${ib:-0} $ch $f"
    done | sort -rn | head -"$n"
