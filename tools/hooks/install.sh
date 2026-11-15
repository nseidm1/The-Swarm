#!/bin/sh
# install.sh - point this clone's git at the hooks kept in the repository (tools/hooks), so they are the same for everyone who
# runs this once. It changes one setting of this clone only (core.hooksPath) and nothing outside it.
#   sh tools/hooks/install.sh            install
#   git config --unset core.hooksPath    undo
set -eu
cd "$(git rev-parse --show-toplevel)"
chmod +x tools/hooks/pre-commit
git config core.hooksPath tools/hooks
echo "Installed: commits in this clone now format their staged files first (tools/hooks/pre-commit)."
