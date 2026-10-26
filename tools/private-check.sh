#!/bin/sh
# Lists the files that mention a term of the local git config `privacy.terms` (extended regexps separated
# by "|", case-insensitive), in the working tree, or in the index with --cached. Run it before merging into main.
terms=$(git config --get privacy.terms)
[ -n "$terms" ] || { echo "private-check: no privacy.terms configured in this clone."; exit 0; }
files=$(git grep -l -i -E "$terms" $1 -- . 2>/dev/null)
if [ -n "$files" ]; then
  echo "private-check: files that mention a private term:"
  for f in $files; do printf '  %-32s %s\n' "$f" "$(git grep -c -i -E "$terms" $1 -- "$f" | cut -d: -f2) lines"; done
else
  echo "private-check: no file mentions a private term."
fi
