#!/bin/bash
# decider.sh - THE DECISION MODEL FOR THE DECIDE STEP, ON THIS MACHINE: it fetches and starts whichever decider src/config.json
# names, by the recipe its entry in src/models.json gives (serve.kind). None is part of the swarm or shipped
# with it: each lives entirely inside .work (never committed): its source, a Python of its own, its packages, and its weights.
# Nothing is installed on the machine outside that folder.
#   kev        Kev (github.com/jaredpalmer/kev, Apache-2.0), any of its sizes, in .work/kev; its weights come on first serve
#   startlux-mlx  a StartLux Decision model (github.com/StartLuxLabs/StartLux-Decision, server Apache-2.0, weights CC-BY-NC-4.0) on
#              Apple silicon through MLX, in .work/deciders/<id>: the server at a pinned commit, the MLX build at a pinned revision
#   llama      a decision model its maker ships as a GGUF file for stock llama.cpp, whose llama-server answers /v1/systemone itself:
#              the pinned file in .work/deciders/<id>, served by the llama-server the swarm already uses, with the maker's flags
#   cuda       not started here: its maker's instructions are in its entry, for a machine with an NVIDIA GPU
# Every one answers the same request (POST /v1/systemone), so the swarm asks each the same way.
#   bash training/decider.sh install          fetch the configured decider and build its environment (once)
#   bash training/decider.sh ready            exit 0 when the configured decider is installed here
#   bash training/decider.sh serve [port]     start it at 127.0.0.1:8009 (or the port given)
#   bash training/decider.sh stop
# Then name it to the swarm:   SWARM_DECIDER=http://127.0.0.1:8009 bash training/session.sh
# DECIDER_ID picks one other than the configured decider; KEV_RUN still picks a Kev size directly. DECIDER_NO_PORT_FILE=1 starts
# one without writing the port file: a decider started beside the session's own (decider-replay.mjs) must not take its place there.
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD
NODE=${NODE:-node}
K=$ROOT/.work/kev
# the decider and its recipe (training/support/decider-env.mjs)
eval "$("$NODE" training/support/decider-env.mjs)" || exit 1
# one port file for whichever decider is up: the trainers and the page look there
PORT_FILE=$ROOT/.work/decider/port
mkdir -p "$K" "$ROOT/.work/decider"
# a Python of the decider's own, never the machine's: on an Apple silicon Mac the machine's may be an Intel one, which has no torch or MLX
export UV_PYTHON_PREFERENCE=only-managed
ARM=
[ "$(uname -s)" = Darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && ARM="arch -arm64"
uv_in() { # uv_in <folder>: a uv of that folder's own, made the first time
  [ -x "$1/uvenv/bin/uv" ] || { mkdir -p "$1" && python3 -m venv "$1/uvenv" && "$1/uvenv/bin/pip" install -q uv; } || return 1
  echo "$ARM $1/uvenv/bin/uv"
}
cmd=$1; shift
case "$D_KIND" in
  kev)
    RUN=${KEV_RUN:-${D_RUN:-jaredpalmer/kev-4b@v1.0}}
    export UV_CACHE_DIR=$K/uv-cache UV_PYTHON_INSTALL_DIR=$K/python HF_HOME=$K/hf
    UV="$ARM $K/uvenv/bin/uv"
    case "$cmd" in
      install)
        cd "$K" || exit 1
        [ -d src/.git ] || git clone --depth 1 https://github.com/jaredpalmer/kev.git src || exit 1
        UV=$(uv_in "$K") || exit 1
        cd src && $UV python install 3.13 && $UV sync --extra serve
        ;;
      ready) [ -x "$K/uvenv/bin/uv" ] && [ -d "$K/src/.venv" ] ;;
      serve)
        PORT=${1:-8009}
        [ -x "$K/uvenv/bin/uv" ] || { echo "Kev is not installed here. First: bash training/decider.sh install"; exit 1; }
        cd "$K/src" || exit 1
        [ -n "$DECIDER_NO_PORT_FILE" ] || echo "$PORT" > "$PORT_FILE"
        exec $UV run --extra serve python -m kev.serve --run "$RUN" --host 127.0.0.1 --port "$PORT"
        ;;
      stop) pkill -f "kev[.]serve .*--port $(cat "$PORT_FILE" 2>/dev/null || echo 8009)" && echo "Kev stopped." || echo "Kev was not running." ;;
      *) echo "decider.sh install | ready | serve [port] | stop"; exit 2 ;;
    esac
    ;;
  startlux-mlx)
    H=$ROOT/.work/deciders/startlux           # the server and its Python, shared by every StartLux size
    M=$ROOT/.work/deciders/$D_ID/model         # this size's weights
    export UV_CACHE_DIR=$H/uv-cache UV_PYTHON_INSTALL_DIR=$H/python HF_HOME=$H/hf
    case "$cmd" in
      install)
        [ -n "$ARM" ] || { echo "$D_NAME runs through MLX, on an Apple silicon Mac only."; exit 1; }
        mkdir -p "$H" && cd "$H" || exit 1
        [ -d src/.git ] || git clone -q "$D_CODE" src || exit 1
        git -C src fetch -q origin "$D_CODE_REV" 2>/dev/null; git -C src checkout -q "$D_CODE_REV" || exit 1
        UV=$(uv_in "$H") || exit 1
        [ -x venv/bin/python ] || $UV venv -q --python 3.13 venv || exit 1
        VIRTUAL_ENV=$H/venv $UV pip install -q -e "src[mlx]" huggingface_hub || exit 1
        # the weights, at the pinned revision: written whole, and only once
        if [ ! -f "$M/.complete" ]; then
          mkdir -p "$M" && $ARM "$H/venv/bin/python" -c "
from huggingface_hub import snapshot_download
snapshot_download('$D_WEIGHTS', revision='$D_WEIGHTS_REV', local_dir='$M')" || exit 1
          echo "$D_WEIGHTS@$D_WEIGHTS_REV" > "$M/.complete"
        fi
        ;;
      ready) [ -x "$H/venv/bin/startlux-decide" ] && [ "$(cat "$M/.complete" 2>/dev/null)" = "$D_WEIGHTS@$D_WEIGHTS_REV" ] ;;
      serve)
        PORT=${1:-8009}
        [ -x "$H/venv/bin/startlux-decide" ] && [ -f "$M/.complete" ] || { echo "$D_NAME is not installed here. First: bash training/decider.sh install"; exit 1; }
        [ -n "$DECIDER_NO_PORT_FILE" ] || echo "$PORT" > "$PORT_FILE"
        exec $ARM "$H/venv/bin/startlux-decide" serve --model "$M" --backend mlx --host 127.0.0.1 --port "$PORT" --name "$D_ID"
        ;;
      stop) pkill -f "startlux-decide serve .*--port $(cat "$PORT_FILE" 2>/dev/null || echo 8009)" && echo "$D_NAME stopped." || echo "$D_NAME was not running." ;;
      *) echo "decider.sh install | ready | serve [port] | stop"; exit 2 ;;
    esac
    ;;
  llama)
    M=$ROOT/.work/deciders/$D_ID              # its one GGUF file, at the pinned revision
    F=$M/$D_FILE
    case "$cmd" in
      install)
        mkdir -p "$M" || exit 1
        if [ "$(cat "$M/.complete" 2>/dev/null)" != "$D_WEIGHTS@$D_WEIGHTS_REV" ]; then
          # fetched to a part (carried on from where it stopped), checked against its SHA-256, and only then put in place
          curl -fsSL --retry 3 -C - -o "$F.part" "https://huggingface.co/$D_WEIGHTS/resolve/$D_WEIGHTS_REV/$D_FILE" || exit 1
          [ "$(shasum -a 256 "$F.part" | cut -d' ' -f1)" = "$D_SHA256" ] || { rm -f "$F.part"; echo "$D_FILE arrived wrong (its SHA-256 does not match); fetch it again."; exit 1; }
          mv "$F.part" "$F" && echo "$D_WEIGHTS@$D_WEIGHTS_REV" > "$M/.complete"
        fi
        ;;
      ready) [ -f "$F" ] && [ "$(cat "$M/.complete" 2>/dev/null)" = "$D_WEIGHTS@$D_WEIGHTS_REV" ] ;;
      serve)
        PORT=${1:-8009}
        [ -f "$F" ] && [ -f "$M/.complete" ] || { echo "$D_NAME is not installed here. First: bash training/decider.sh install"; exit 1; }
        [ -n "$D_LLAMA" ] || { echo "$D_NAME needs llama-server, and none is here. Train once from the dashboard (it fetches llama.cpp), or put llama-server on the PATH."; exit 1; }
        [ -n "$DECIDER_NO_PORT_FILE" ] || echo "$PORT" > "$PORT_FILE"
        # shellcheck disable=SC2086  # the maker's flags, word by word
        exec "$D_LLAMA" -m "$F" $D_ARGS --host 127.0.0.1 --port "$PORT"
        ;;
      stop) pkill -f "llama-server -m $F .*--port $(cat "$PORT_FILE" 2>/dev/null || echo 8009)" && echo "$D_NAME stopped." || echo "$D_NAME was not running." ;;
      *) echo "decider.sh install | ready | serve [port] | stop"; exit 2 ;;
    esac
    ;;
  *)
    case "$cmd" in
      ready) exit 1 ;;
      stop) echo "Nothing of $D_NAME's runs here." ;;
      *) echo "$D_NAME is not started by the swarm: it needs $D_NEEDS. Its maker's instructions: $D_HOW. Then name it: SWARM_DECIDER=http://<host>:<port>"; exit 1 ;;
    esac
    ;;
esac
