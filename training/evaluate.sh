#!/bin/sh
# evaluate.sh - EVALUATE THE SWARM against the larger model on standard benchmarks (training/evaluate.mjs says how). Started by the
# page's Evaluate the swarm, or by hand:
#   sh training/evaluate.sh [--limit N] [--items crew,math]
# First what it needs: the harnesses what is chosen is measured by, each installed here the first time (lm-evaluation-harness
# 0.4.13 in .work/lmeval; for calling functions and searching, the tool tests, bfcl-eval 2026.3.23, in .work/bfcl), the configured
# models (training/setup.mjs, as a training session readies them) and the decider, loaded for this run and unloaded when it ends.
# A training session and an evaluation cannot run at once: each needs the models, and the memory, to itself.
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NODE=${NODE:-node}
L="$ROOT/.work/lmeval"
T="$ROOT/.work/bfcl"
mkdir -p "$ROOT/.work/eval"
# what it is doing before the evaluation itself begins, for the page (training/evaluate.mjs writes the rest)
say() {
  echo "$(date +%H:%M:%S) $1"
  printf '{"phase":"preparing","step":"%s","startedAt":%s000,"tasks":[]}' "$1" "$(date +%s)" > .work/eval/live.json.tmp && mv .work/eval/live.json.tmp .work/eval/live.json
}
# which harnesses what is chosen needs ("lmeval", "bfcl", or both)
NEEDS=$("$NODE" training/evaluate.mjs --needs "$@" 2>/dev/null || echo lmeval)
UV=$(command -v uv || true)
[ -n "$UV" ] || [ ! -x "$ROOT/.work/kev/uvenv/bin/uv" ] || UV="$ROOT/.work/kev/uvenv/bin/uv"
case " $NEEDS " in *" bfcl "*)
  # (the package pins numpy 1.26, which has no build for Python 3.13 or newer; soundfile is needed by one of its own handlers
  # and not named by it)
  if ! "$T/venv/bin/python" -I -c 'import bfcl_eval, soundfile' 2>/dev/null; then
    say "Installing the tool tests (bfcl-eval 2026.3.23) into .work/bfcl (once)"
    if [ -n "$UV" ]; then
      UV_CACHE_DIR="$T/uv-cache" "$UV" venv --python 3.12 "$T/venv"
      UV_CACHE_DIR="$T/uv-cache" "$UV" pip install --python "$T/venv/bin/python" 'bfcl-eval==2026.3.23' soundfile
    else
      PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
      [ -n "$PY" ] || { say "Needs Python 3.10 to 3.12, or uv, to install the tool tests"; exit 1; }
      "$PY" -m venv "$T/venv"
      "$T/venv/bin/python" -m pip install --quiet 'bfcl-eval==2026.3.23' soundfile
    fi
  fi ;;
esac
case " $NEEDS " in *" lmeval "*) NEED_LMEVAL=1 ;; *) NEED_LMEVAL= ;; esac
if [ -n "$NEED_LMEVAL" ] && ! "$L/venv/bin/python" -I -c 'import lm_eval' 2>/dev/null; then
  say "Installing lm-evaluation-harness 0.4.13 into .work/lmeval (once)"
  if [ -n "$UV" ]; then
    UV_CACHE_DIR="$L/uv-cache" "$UV" venv --python 3.13 "$L/venv"
    UV_CACHE_DIR="$L/uv-cache" "$UV" pip install --python "$L/venv/bin/python" 'lm_eval[api,ifeval,math]==0.4.13' evaluate
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { say "Needs Python 3.10 or newer, or uv, to install lm-evaluation-harness"; exit 1; }
    python3 -m venv "$L/venv"
    "$L/venv/bin/python" -m pip install --quiet 'lm_eval[api,ifeval,math]==0.4.13' evaluate
  fi
fi
"$NODE" training/support/recover.mjs reap
say "Making the configured models ready (fetching any that are missing)"
"$NODE" training/setup.mjs > .work/eval/setup.out 2>&1 || { cat .work/eval/setup.out; say "Not ready: $(grep -i failed .work/eval/setup.out | head -1 | tr -d '"\\')"; exit 1; }
export KEV_RUN=${KEV_RUN:-$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.DECIDER.run))")}
DECIDER_STARTED=
decider_down() { [ -n "$DECIDER_STARTED" ] && bash training/decider.sh stop > /dev/null 2>&1; DECIDER_STARTED=; }
trap decider_down EXIT
trap 'exit 143' TERM INT
if [ -z "$SWARM_DECIDER" ] && bash training/decider.sh ready; then
  say "Loading the decider"
  DECIDER_PORT=${DECIDER_PORT:-$("$NODE" training/support/recover.mjs port 8009)}
  bash training/decider.sh serve "$DECIDER_PORT" > .work/eval/decider.log 2>&1 &
  DECIDER_STARTED=1
  export SWARM_DECIDER="http://127.0.0.1:$DECIDER_PORT"
  for _ in $(seq 1 180); do
    "$NODE" -e "fetch('$SWARM_DECIDER/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
    sleep 5
  done
fi
"$NODE" training/evaluate.mjs "$@"
