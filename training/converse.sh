#!/usr/bin/env bash
# converse.sh - ONE CONVERSATION PASS, as the page's card starts it (ui/swarm_ui.py /converse/start).
# First, what the configured lineup needs is fetched and made ready where it is missing (training/setup.mjs --small: the engine
# and the small models; a conversation pass asks no larger model). A pass once ended in its first second because a model that
# had just been chosen was not on the disk, and said so only in a log (2026-11-24). Then the pass itself: the class of input that
# is a conversation, on the made-up people's kinds.
#   bash training/converse.sh <kinds> <out.json>
set -u
cd "$(dirname "$0")/.."
NODE=${NODE:-node}
mkdir -p .work/train
"$NODE" training/setup.mjs --small > .work/train/setup.out 2>&1 || { cat .work/train/setup.out; echo "NOT READY: what the lineup needs could not be made ready. No pass was run."; exit 1; }
cat .work/train/setup.out
"$NODE" training/classes.mjs --only talk --kinds "$1" --figures --out "$2"
