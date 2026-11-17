#!/bin/sh
# mlx-setup.sh - THE TRAINER FOR ADAPTERS: MLX, and the small models' original weights it trains from. Apple silicon only.
# llama.cpp's own trainer cannot train the swarm's small models (training/adapters.mjs says why); MLX can, from each model's
# original weights. Everything goes under .work/mlx, nothing system-wide:
#   .work/mlx/venv        python with mlx-lm (the trainer) and gguf (to hand an adapter to llama.cpp)
#   .work/mlx/hf/<dir>    each model's original weights, at the revision training/originals.json pins (about 13 GB for the three it can train)
#   sh training/mlx-setup.sh            install, and fetch every model's weights
#   sh training/mlx-setup.sh --no-fetch install only
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
if [ ! -x "$M/venv/bin/python" ]; then
  if [ -n "$UV" ]; then
    UV_CACHE_DIR="$M/uv-cache" "$UV" venv --python 3.13 "$M/venv"
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "Needs python 3.10 or newer, or uv."; exit 1; }
    python3 -m venv "$M/venv"
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
# each model's repository, revision and folder, read from training/originals.json (one place); a model it says cannot be trained
# is not fetched. (No file-name expansion from here: the include patterns are for the download, not this folder)
set -f
node -e '
import("./training/adapters.mjs").then(({ ORIGINALS }) => {
  for (const o of Object.values(ORIGINALS)) if (!o.cannot) console.log(o.repo, o.revision, o.dir, ...(o.include || []));
});' | while read -r REPO REV DIR INCLUDE; do
  if [ -f "$M/hf/$DIR/config.json" ]; then echo "$DIR is here."; continue; fi
  echo "Fetching $REPO at $REV..."
  # (only the files named, where a repository holds a second copy of the weights: unquoted on purpose, one file a word)
  # shellcheck disable=SC2086
  HF_HOME="$M/hf-home" HF_HUB_DISABLE_TELEMETRY=1 "$M/venv/bin/hf" download "$REPO" --revision "$REV" --local-dir "$M/hf/$DIR" $INCLUDE >/dev/null
done
echo "Ready: node training/adapters.mjs ready"
