#!/bin/sh
# Run once per clone: uses the versioned hooks and sets where each branch is pushed.
set -e
cd "$(git rev-parse --show-toplevel)"
chmod +x tools/hooks/* tools/private-check.sh
git config core.hooksPath tools/hooks
git config remote.pushDefault private          # every branch goes to the private remote...
git config branch.main.pushRemote origin       # ...except main, which goes to the public one
git config alias.push-main '!git push origin main && git push private main'   # releases: both remotes
echo "Hooks installed (core.hooksPath = tools/hooks). Release with: git push-main"
