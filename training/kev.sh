#!/bin/bash
# kev.sh - the decider script's old name, from when Kev was the only decider. A session started before the rename calls it by this
# name until that session ends; everything it does is training/decider.sh's.
exec bash "$(dirname "$0")/decider.sh" "$@"
