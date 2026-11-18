#!/bin/sh
# evaluate.sh - EVALUATE THE SWARM against the larger model on standard benchmarks (training/evaluate.mjs says how). Started by the
# page's Evaluate the swarm, or by hand:
#   sh training/evaluate.sh [--limit N] [--items crew,math]
# With no --items it asks every body of work that has a standard task.
# First what it needs: the harnesses its tasks are measured by, each installed here the first time (lm-evaluation-harness
# 0.4.13 in .work/lmeval; for calling functions and searching, the tool tests, bfcl-eval 2026.3.23, in .work/bfcl; and for the
# web search test the search that stands behind it, SearXNG at a pinned revision, in .work/searxng), the configured
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
# WHAT IT INSTALLS, IT INSTALLS INTO ITS OWN FOLDER, AND AGAIN WHERE IT IS BROKEN. A harness is here when its Python can import it.
# Where it cannot (never installed, an install that was interrupted, a Python that has since been taken out), its venv is made
# again from nothing (--clear: over a venv that is there, uv and python both refuse otherwise). The Python uv fetches for it goes
# into that harness's folder (UV_PYTHON_INSTALL_DIR), not the machine's own ~/.local/share/uv: the Uninstall Helper takes the
# folder out whole. And it is always one uv fetched (only-managed), never the machine's: on an Apple silicon Mac the machine's may
# be an Intel one.
# what the tasks of this run need installed: "lmeval", "bfcl", "searxng", or several
NEEDS=$("$NODE" training/evaluate.mjs --needs "$@" 2>/dev/null || echo lmeval)
UV=$(command -v uv || true)
[ -n "$UV" ] || [ ! -x "$ROOT/.work/kev/uvenv/bin/uv" ] || UV="$ROOT/.work/kev/uvenv/bin/uv"
case " $NEEDS " in *" bfcl "*)
  # (the package pins numpy 1.26, which has no build for Python 3.13 or newer; soundfile is needed by one of its own handlers
  # and not named by it)
  if ! "$T/venv/bin/python" -I -c 'import bfcl_eval, soundfile' 2>/dev/null; then
    say "Installing the tool tests (bfcl-eval 2026.3.23) into .work/bfcl (once)"
    mkdir -p "$T"
    if [ -n "$UV" ]; then
      UV_CACHE_DIR="$T/uv-cache" UV_PYTHON_INSTALL_DIR="$T/python" UV_PYTHON_PREFERENCE=only-managed "$UV" venv --clear --python 3.12 "$T/venv"
      UV_CACHE_DIR="$T/uv-cache" "$UV" pip install --python "$T/venv/bin/python" 'bfcl-eval==2026.3.23' soundfile
    else
      PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || true)
      [ -n "$PY" ] || { say "Needs Python 3.10 to 3.12, or uv, to install the tool tests"; exit 1; }
      "$PY" -m venv --clear "$T/venv"
      "$T/venv/bin/python" -m pip install --quiet 'bfcl-eval==2026.3.23' soundfile
    fi
    "$T/venv/bin/python" -I -c 'import bfcl_eval, soundfile' || { say "The tool tests did not install: the log says why"; exit 1; }
  fi ;;
esac
case " $NEEDS " in *" searxng "*)
  # THE SEARCH BEHIND THE WEB SEARCH TEST (training/search.json pins it; training/support/search.mjs serves it for the run): SearXNG,
  # at the pinned revision, with what it needs and a Python of its own, all in .work/searxng. Nothing of it is in the swarm.
  X="$ROOT/.work/searxng"
  SX_REPO=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync('training/search.json','utf8')).searxng.repo)")
  SX_REV=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync('training/search.json','utf8')).searxng.rev)")
  if [ "$(cat "$X/.rev" 2>/dev/null)" != "$SX_REV" ] || ! "$X/venv/bin/python" -I -c 'import flask, lxml, msgspec, yaml' 2>/dev/null; then
    say "Installing the search behind the web search test (SearXNG) into .work/searxng (once)"
    mkdir -p "$X"
    rm -f "$X/.rev"
    [ -d "$X/src/.git" ] || git clone -q "$SX_REPO" "$X/src"
    git -C "$X/src" cat-file -e "$SX_REV^{commit}" 2>/dev/null || git -C "$X/src" fetch -q origin "$SX_REV" 2>/dev/null || git -C "$X/src" fetch -q --unshallow origin 2>/dev/null || git -C "$X/src" fetch -q origin
    git -C "$X/src" checkout -q "$SX_REV"
    if [ -n "$UV" ]; then
      UV_CACHE_DIR="$X/uv-cache" UV_PYTHON_INSTALL_DIR="$X/python" UV_PYTHON_PREFERENCE=only-managed "$UV" venv --clear --python 3.12 "$X/venv"
      UV_CACHE_DIR="$X/uv-cache" "$UV" pip install --python "$X/venv/bin/python" -r "$X/src/requirements.txt"
    else
      python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { say "Needs Python 3.10 or newer, or uv, to install the search behind the web search test"; exit 1; }
      python3 -m venv --clear "$X/venv"
      "$X/venv/bin/python" -m pip install --quiet -r "$X/src/requirements.txt"
    fi
    "$X/venv/bin/python" -I -c 'import flask, lxml, msgspec, yaml' || { say "The search behind the web search test did not install: the log says why"; exit 1; }
    echo "$SX_REV" > "$X/.rev"
  fi ;;
esac
case " $NEEDS " in *" lmeval "*) NEED_LMEVAL=1 ;; *) NEED_LMEVAL= ;; esac
if [ -n "$NEED_LMEVAL" ] && ! "$L/venv/bin/python" -I -c 'import lm_eval' 2>/dev/null; then
  say "Installing lm-evaluation-harness 0.4.13 into .work/lmeval (once)"
  mkdir -p "$L"
  if [ -n "$UV" ]; then
    UV_CACHE_DIR="$L/uv-cache" UV_PYTHON_INSTALL_DIR="$L/python" UV_PYTHON_PREFERENCE=only-managed "$UV" venv --clear --python 3.13 "$L/venv"
    UV_CACHE_DIR="$L/uv-cache" "$UV" pip install --python "$L/venv/bin/python" 'lm_eval[api,ifeval,math]==0.4.13' evaluate
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { say "Needs Python 3.10 or newer, or uv, to install lm-evaluation-harness"; exit 1; }
    python3 -m venv --clear "$L/venv"
    "$L/venv/bin/python" -m pip install --quiet 'lm_eval[api,ifeval,math]==0.4.13' evaluate
  fi
  "$L/venv/bin/python" -I -c 'import lm_eval' || { say "lm-evaluation-harness did not install: the log says why"; exit 1; }
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
