#!/bin/bash
# run.sh - THE WHOLE RUN: ONE START, THREE FIGURES. The module as configured is evaluated; it is pretrained and evaluated again;
# its arrangement is trained (where asked) and it is evaluated a third time; each on the same questions, so that the three can
# be set side by side (training/evaluate.mjs --variant; the Evaluate card). Started and stopped by the page's one button, or:
#   bash training/run.sh [--limit N | --proof] [--train classes|off] [--train-minutes M] [--items a,b]
# A STEP WHOSE RESULT IS ON RECORD IS PASSED OVER: the run is opened where it was left (.work/run/<configuration>/status.txt,
# as a pass is), so Stop and Start carry on. A run asked for at another size, or of another configuration, begins again.
# A STEP THAT CANNOT BE TAKEN IS SAID AND THE RUN GOES ON: a model that cannot be pretrained here leaves the second figure
# unmeasured, and the third is then of the trained arrangement without an adapter, which the card says.
# Each step is one of the programs the page's cards follow (evaluate.sh, adapters.mjs, session.sh), started as the page starts it
# and written down where the page looks (.work/<job>/ui-run.json), so each card shows its step while it runs.
# (Pretraining is roles.mjs, which the page follows where it follows adapters.mjs: the same live.json.)
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
LIMIT=20; PROOF=; TRAIN=classes; MINUTES=120; ITEMS=
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT=$2; shift 2 ;;
    --proof) PROOF=1; shift ;;
    --train) TRAIN=$2; shift 2 ;;
    --train-minutes) MINUTES=$2; shift 2 ;;
    --items) ITEMS=$2; shift 2 ;;
    *) echo "run.sh: not understood: $1"; exit 2 ;;
  esac
done
pick_node() {
  local c v
  for c in "${NODE:-}" node $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -t/ -k7 -V -r); do
    [ -n "$c" ] || continue
    v=$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || continue
    [ "$v" -ge 20 ] && { echo "$c"; return 0; }
  done
  return 1
}
NODE=$(pick_node) || { echo "No Node 20 or later was found."; exit 1; }
export NODE
KEY=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.CONFIG_KEY))") || exit 1
SIZE=$([ -n "$PROOF" ] && echo "--proof" || echo "--limit $LIMIT")
ASK="$SIZE${ITEMS:+ --items $ITEMS}"
LIMJ=$([ -n "$PROOF" ] && echo -1 || echo "$LIMIT")
# (what each step runs, and where the run keeps its place: its own programs and .work, or a test's)
EVALUATE=${RUN_EVALUATE:-sh training/evaluate.sh}
PRETRAIN=${RUN_PRETRAIN:-$NODE training/roles.mjs train}
SESSION=${RUN_SESSION:-bash training/session.sh}
WORK=${RUN_WORK:-.work}
WHAT="$KEY | $ASK | train $TRAIN"
. training/support/steps.sh
open_pass "$WORK/run/$KEY" 1 "$WHAT"
say() { echo "$(date +%H:%M:%S) $1"; }
now() { date "+%Y-%m-%d %H:%M:%S"; }
# step <name> <the page's job> <its ui-run.json's own fields, as JSON without braces> <command...>
# One step: passed over where it ended well; else started as the page starts that job, written down where its card looks, and
# waited for. Exit 3 is a step that refused (nothing to pretrain, no adapter to measure): said, and the run goes on.
step() {
  local name=$1 job=$2 keep=$3; shift 3
  if grep -qF "END   $name exit 0 " "$OUT/status.txt"; then echo "$(now | cut -c12-) SKIP  $name" >> "$OUT/status.txt"; return 0; fi
  local t0 code pid
  t0=$(date +%s)
  echo "$(now | cut -c12-) START $name" >> "$OUT/status.txt"
  mkdir -p "$WORK/$job"
  "$@" > "$OUT/$name.out" 2>&1 &
  pid=$!
  printf '{%s"pid": %s, "at": "%s", "whole": true}' "${keep:+$keep, }" "$pid" "$(now)" > "$WORK/$job/ui-run.json"
  CHILD=$pid
  wait "$pid"; code=$?
  CHILD=
  echo "$(now | cut -c12-) END   $name exit $code $(( ($(date +%s) - t0) / 60 )) min" >> "$OUT/status.txt"
  return "$code"
}
CHILD=
trap '[ -n "$CHILD" ] && kill -TERM "$CHILD" 2>/dev/null; echo "$(now | cut -c12-) STOPPED" >> "$OUT/status.txt"; exit 143' TERM INT
say "The whole run of $KEY: $ASK, training the arrangement: $TRAIN"

# 1  THE MODULE AS CONFIGURED
step 1-evaluate-as-configured eval "\"limit\": $LIMJ" $EVALUATE --variant base $ASK
[ $? = 0 ] || say "The module as configured was not evaluated (see $OUT/1-evaluate-as-configured.out): the other figures have nothing to stand beside."

# 2  PRETRAINED: an adapter for each role of slot, from what each slot is asked (training/roles.mjs)
step 2-pretrain pretrain "" $PRETRAIN
case $? in 0) ;; 3) say "No adapter was made, or none made the module better on held questions: the pretrained module is the module as configured." ;; *) say "Pretraining did not end well (see $OUT/2-pretrain.out): where no adapter was made, the second figure is not taken." ;; esac
step 3-evaluate-pretrained eval "\"limit\": $LIMJ" $EVALUATE --variant pretrained $ASK
case $? in 0) ;; 3) say "No adapter is served: the pretrained figure is the first figure, and is not taken again." ;; *) say "The pretrained module was not evaluated (see $OUT/3-evaluate-pretrained.out)." ;; esac

# 3  PRETRAINED AND TRAINED: the class stage, for so many minutes at most; what it kept by then is kept
# (its time ends the session AND the step the session waits on: a shell acts on a signal only when what it waits on ends, so
# the signal to the session alone left the stage running to its own end, 17 minutes past 20, 2026-11-22)
if [ "$TRAIN" = classes ]; then
  if ! grep -qF "END   4-train-classes exit 0 " "$OUT/status.txt"; then
    ( sleep $((MINUTES * 60 + 1)); P=$(cat "$WORK/train/ui-run.json" 2>/dev/null | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).pid)}catch{}})"); [ -n "$P" ] && { kill -TERM "$P" 2>/dev/null; pkill -TERM -P "$P" 2>/dev/null; } ) > /dev/null 2>&1 &
    WATCH=$!
  fi
  # (the arrangement is trained on the module AS PRETRAINED, the adapters that are served on: a change is then kept where it
  # betters that module, the one the third figure is of. Trained without them and evaluated with them, 2026-11-22, the
  # third figure was of a module nothing had tried)
  SWARM_ADAPTERS=on PASSES=1 SESSION_STEPS=classes step 4-train-classes train "\"passes\": 1, \"first\": 1, \"classes\": []" $SESSION
  code=$?
  # (the watch on its time is ended with it, and the wait it was in: left alone it would hold the run's output open)
  if [ -n "$WATCH" ]; then pkill -P "$WATCH" 2>/dev/null; kill "$WATCH" 2>/dev/null; fi
  # (stopped by its time: what the class stage kept is kept, and the step counts as taken)
  if [ "$code" != 0 ]; then say "The class stage ended at exit $code (its $MINUTES minutes, or a fault: see $OUT/4-train-classes.out). What it kept is measured."; fi
  step 5-evaluate-trained eval "\"limit\": $LIMJ" $EVALUATE --variant trained $ASK
  [ $? = 0 ] || say "The trained module was not evaluated (see $OUT/5-evaluate-trained.out)."
else
  say "Training the arrangement was not asked for: the third figure is not taken."
fi
echo "$(now | cut -c12-) DONE" >> "$OUT/status.txt"
say "The run is done: the Evaluate card sets what was measured side by side."
