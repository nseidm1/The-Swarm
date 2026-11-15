#!/bin/bash
# kev.sh - KEV, THE DECISION MODEL FOR THE DECIDE STEP, ON THIS MACHINE. Kev (github.com/jaredpalmer/kev, Apache-2.0) is not part
# of the swarm and is not shipped with it: this fetches and runs it beside the swarm, entirely inside .work/kev (never committed):
# its source, a Python of its own, its packages, and its weights. Nothing is installed on the machine outside that folder.
#   bash training/kev.sh install          clone Kev and build its environment (once; a few minutes)
#   bash training/kev.sh serve [port]     run Kev-4B at 127.0.0.1:8009 (the first run fetches the weights: several GB)
#   bash training/kev.sh stop
# Then name it to the swarm:   SWARM_KEV=http://127.0.0.1:8009 bash training/session.sh
# KEV_RUN picks the size (the session passes the one configured in src/config.json); the default is the pinned Kev-4B 1.0.
cd "$(dirname "$0")/.." || exit 1
K=$PWD/.work/kev
RUN=${KEV_RUN:-jaredpalmer/kev-4b@v1.0}
# a Python of Kev's own, never the machine's: on an Apple silicon Mac the machine's may be an Intel one, which has no torch
export UV_CACHE_DIR=$K/uv-cache UV_PYTHON_INSTALL_DIR=$K/python UV_PYTHON_PREFERENCE=only-managed HF_HOME=$K/hf
UV="$K/uvenv/bin/uv"
[ "$(uname -s)" = Darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && UV="arch -arm64 $K/uvenv/bin/uv"
case "$1" in
  install)
    mkdir -p "$K" && cd "$K" || exit 1
    [ -d src/.git ] || git clone --depth 1 https://github.com/jaredpalmer/kev.git src || exit 1
    [ -x uvenv/bin/uv ] || { python3 -m venv uvenv && ./uvenv/bin/pip install -q uv; } || exit 1
    cd src && $UV python install 3.13 && $UV sync --extra serve
    ;;
  serve)
    PORT=${2:-8009}
    [ -x "$K/uvenv/bin/uv" ] || { echo "Kev is not installed here. First: bash training/kev.sh install"; exit 1; }
    cd "$K/src" || exit 1
    echo "$PORT" > "$K/port"
    exec $UV run --extra serve python -m kev.serve --run "$RUN" --host 127.0.0.1 --port "$PORT"
    ;;
  stop)
    pkill -f "kev[.]serve .*--port $(cat "$K/port" 2>/dev/null || echo 8009)" && echo "Kev stopped." || echo "Kev was not running."
    ;;
  *) echo "kev.sh install | serve [port] | stop"; exit 2 ;;
esac
