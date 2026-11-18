#!/bin/sh
# mlx-setup.sh - THE TRAINER FOR ADAPTERS: MLX, and the small models' original weights it trains from. Apple silicon only.
# llama.cpp's own trainer cannot train the swarm's small models (training/adapters.mjs says why); MLX can, from each model's
# original weights. Everything goes under .work/mlx, nothing system-wide:
#   .work/mlx/venv        python with mlx-lm (the trainer) and gguf (to hand an adapter to llama.cpp)
#   .work/mlx/python      the Python uv fetched for it, where it fetched one (never into the machine's own ~/.local/share/uv)
#   .work/mlx/hf/<dir>    each model's original weights, at the revision training/originals.json pins
#   sh training/mlx-setup.sh            install, and fetch the weights of the small models the swarm is made of (src/config.json)
#   sh training/mlx-setup.sh --all      install, and fetch every listed model's weights (tens of gigabytes)
#   sh training/mlx-setup.sh --no-fetch install only (Pretrain fetches what each model it trains needs, as it needs it)
# Then: node training/adapters.mjs ready
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
M="$ROOT/.work/mlx"
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || { echo "MLX runs on Apple silicon only."; exit 1; }
mkdir -p "$M"
# uv where there is one (it brings its own python, and a venv it makes has no pip); else a python 3.10 or newer from the PATH
UV=$(command -v uv || true)
[ -n "$UV" ] || [ ! -x "$ROOT/.work/kev/uvenv/bin/uv" ] || UV="$ROOT/.work/kev/uvenv/bin/uv"
# (a venv whose Python does not run is made again from nothing: one left by an install that was interrupted, or whose Python has
# since been taken out. Over a venv that is there, uv and python both refuse without --clear)
if ! "$M/venv/bin/python" -I -c 'import sys' 2>/dev/null; then
  if [ -n "$UV" ]; then
    # (a Python uv fetched, never the machine's own: on an Apple silicon Mac that may be an Intel one, which has no MLX)
    UV_CACHE_DIR="$M/uv-cache" UV_PYTHON_INSTALL_DIR="$M/python" UV_PYTHON_PREFERENCE=only-managed "$UV" venv --clear --python 3.13 "$M/venv"
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "Needs python 3.10 or newer, or uv."; exit 1; }
    python3 -m venv --clear "$M/venv"
  fi
fi
if ! "$M/venv/bin/python" -I -c 'import mlx_lm, gguf' 2>/dev/null; then
  if [ -n "$UV" ]; then
    UV_CACHE_DIR="$M/uv-cache" "$UV" pip install --python "$M/venv/bin/python" 'mlx-lm==0.32.2' 'gguf==0.19.0'
  else
    "$M/venv/bin/python" -m pip install --quiet 'mlx-lm==0.32.2' 'gguf==0.19.0'
  fi
fi
"$M/venv/bin/python" -I -c 'import mlx.core as mx, mlx_lm; print("MLX", mx.__version__, "on", mx.default_device(), "- mlx-lm", mlx_lm.__version__)'
[ "$1" = "--no-fetch" ] && exit 0
# each model's repository, revision and folder, read from training/originals.json (one place): the swarm's own small models, or
# with --all every one listed; a model it says cannot be trained is not fetched. (No file-name expansion from here: the include
# patterns are for the download, not this folder)
set -f
ALL=$([ "$1" = "--all" ] && echo 1 || echo 0) node -e '
Promise.all([import("./training/adapters.mjs"), import("./src/catalog.mjs")]).then(([{ ORIGINALS }, { MEMBERS }]) => {
  const mine = new Set(Object.values(MEMBERS).map((m) => m.file.split("/").pop()));
  for (const [file, o] of Object.entries(ORIGINALS))
    if (!o.cannot && (process.env.ALL === "1" || mine.has(file))) console.log(o.repo, o.revision, o.dir, ...(o.include || []));
});' | while read -r REPO REV DIR INCLUDE; do
  if [ -f "$M/hf/$DIR/config.json" ]; then echo "$DIR is here."; continue; fi
  echo "Fetching $REPO at $REV..."
  # (only the files named, where a repository holds a second copy of the weights: unquoted on purpose, one file a word)
  # shellcheck disable=SC2086
  HF_HOME="$M/hf-home" HF_HUB_DISABLE_TELEMETRY=1 "$M/venv/bin/hf" download "$REPO" --revision "$REV" --local-dir "$M/hf/$DIR" $INCLUDE >/dev/null
done
echo "Ready: node training/adapters.mjs ready"
