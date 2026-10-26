#!/bin/sh
# Lists the files that mention a private term (docs/private/private-terms on the local "family" branch),
# in the working tree, or in the index with --cached. Run it before merging anything into main.
terms=$(git show refs/heads/family:docs/private/private-terms 2>/dev/null | grep -v '^#' | grep -v '^$' | paste -sd'|' -)
[ -n "$terms" ] || { echo "private-check: no private terms found (no local 'family' branch?)"; exit 0; }
files=$(git grep -l -i -E "$terms" $1 -- . ':!docs/private' 2>/dev/null)
if [ -n "$files" ]; then
  echo "private-check: files that mention a private term:"
  for f in $files; do printf '  %-32s %s\n' "$f" "$(git grep -c -i -E "$terms" $1 -- "$f" | cut -d: -f2) lines"; done
else
  echo "private-check: no file mentions a private term."
fi
