#!/usr/bin/env bash
# serve.sh - THE MODULE SERVED AT AN ADDRESS, as the page's button starts it (ui/swarm_ui.py /serve/start).
# First what the configured lineup needs is fetched and made ready where it is missing (training/setup.mjs --small: the
# engines and the small models), so a lineup that was just chosen can be served with one press. Then the module's own
# server takes this process's place (bin/swarm.mjs serve).
#   bash bin/serve.sh [port]
set -u
cd "$(dirname "$0")/.."
NODE=${NODE:-node}
mkdir -p .work/train
"$NODE" training/setup.mjs --small > .work/train/setup.out 2>&1 || { cat .work/train/setup.out; echo "NOT READY: what the lineup needs could not be made ready. The module is not served."; exit 1; }
exec "$NODE" bin/swarm.mjs serve --port "${1:-8090}"
