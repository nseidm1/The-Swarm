#!/bin/bash
# session.sh - ONE TRAINING PASS, one step at a time (two at once would share the machine and spoil each other's times).
# IT IS BUILT TO GET TO THE END. Hours on one machine with several models loaded will go wrong somewhere, so: what a dead session
# left running is stopped first; a model server that stops is started again; a step that fails is run again and carries on from
# the answers it had; a pass that stopped is resumed, not begun again; and a step that cannot be put right is written down and
# the pass goes on. Every way back that was taken is on the record (.work/train/recovery.jsonl), and on the page.
# A pass begins from what the last one left (training/state.json) and ends by leaving the same for the next: so running this
# again is not the same pass again. It has new train questions, more of the kinds the swarm answered differently on, the slots in the order
# the last pass found them worst, new reading from arXiv on what was weak, arrangements no pass has tried, and nothing
# measured twice.
#   bash training/session.sh                   one pass
#   PASSES=3 bash training/session.sh          three, each starting from the one before
#   TEACHER=claude bash training/session.sh    let a large model turn the reading and the failures into candidate briefs
#                                              (spends on this machine's Claude plan; without it, candidates are written by hand)
#   EACH=8 bash training/session.sh            questions of each kind (default 6: 72 held questions)
#   TRIES=6 bash training/session.sh           arrangements tried each pass (default 4)
#   SWARM_KEV=http://127.0.0.1:8009 ...        a Kev already running somewhere, in place of the one this session loads itself
# Before it: nothing. It fetches and makes ready what the configured swarm needs (training/setup.mjs): the engine, the models,
# the decider. Which models those are is in src/config.json (the page's pills change it).
cd "$(dirname "$0")/.." || exit 1
# A NODE THAT CAN RUN A MODEL'S CODE SAFELY (20 or later): the one named (NODE), the one on the PATH, or the newest that nvm has.
# An older one would start, and then compare no code at all.
pick_node() {
  local c v
  for c in "${NODE:-}" node $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -t/ -k7 -V -r); do
    [ -n "$c" ] || continue
    v=$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || continue
    [ "$v" -ge 20 ] && { echo "$c"; return 0; }
  done
  return 1
}
NODE=$(pick_node) || { echo "No Node 20 or later was found (the one on the PATH is $(node -v 2>/dev/null || echo missing)). The trainers need it to run a model's code safely."; exit 1; }
echo "$(date +%H:%M:%S) Node: $NODE ($("$NODE" -v))"
EACH=${EACH:-6}
# THE MODELS LIVE AS LONG AS THE SESSION. Nothing is loaded before it and nothing is left loaded after it. The two small models and
# the larger one are started and stopped by each step that uses them; Kev, which every swarm step needs, is started here and
# unloaded when the session ends, however it ends (finished, stopped from the page, or interrupted). A Kev that someone named
# (SWARM_KEV) is theirs: it is used and left alone.
# FIRST, WHAT THE CONFIGURED SWARM NEEDS: the engine, the two small models, the decider and the larger model, fetched and made ready
# where they are missing (training/setup.mjs). It recovers by itself where it can, and where it cannot it says what to do.
mkdir -p .work/train
# what a session that died left running is stopped before this one loads its own: it would hold the memory this one needs
"$NODE" training/support/recover.mjs reap
"$NODE" training/setup.mjs > .work/train/setup.out 2>&1 || { cat .work/train/setup.out; echo "$(date +%H:%M:%S) NOT READY: see above. Nothing was trained."; exit 1; }
cat .work/train/setup.out
export KEV_RUN=${KEV_RUN:-$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.DECIDER.run))")}
KEV_STARTED=
kev_down() { [ -n "$KEV_STARTED" ] && bash training/kev.sh stop > /dev/null 2>&1; KEV_STARTED=; }
trap kev_down EXIT
trap 'exit 143' TERM INT
if [ -z "$SWARM_KEV" ]; then
  if [ -x .work/kev/uvenv/bin/uv ]; then
    mkdir -p .work/train
    # its usual port, or the next one free if something else has that
    KEV_PORT=${KEV_PORT:-$("$NODE" training/support/recover.mjs port 8009)}
    bash training/kev.sh serve "$KEV_PORT" > .work/train/kev.log 2>&1 &
    KEV_STARTED=1
    export SWARM_KEV="http://127.0.0.1:$KEV_PORT"
    for _ in $(seq 1 180); do
      "$NODE" -e "fetch('$SWARM_KEV/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
      sleep 5
    done
    if "$NODE" -e "fetch('$SWARM_KEV/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
      echo "$(date +%H:%M:%S) Kev loaded for this session at $SWARM_KEV"
    else
      # it did not come up: the trainers try again before each question, and say so; until it does, the answer most slots gave stands
      echo "$(date +%H:%M:%S) Kev did not come up at $SWARM_KEV (see .work/train/kev.log). The trainers will try to start it again."
    fi
  else
    echo "$(date +%H:%M:%S) NO KEV: it is not installed here (bash training/kev.sh install). The answer most slots gave will stand."
  fi
fi
for N in $(seq 1 "${PASSES:-1}"); do
  P=$("$NODE" -e "import('./training/state.mjs').then(s=>console.log(s.readState().pass+1))")
  OUT=.work/train/pass-$P; mkdir -p "$OUT"
  # A PASS THAT STOPPED IS CARRIED ON, NOT BEGUN AGAIN. If this pass was started before, for the same swarm and target, and did not
  # finish, its steps that ended well are passed over and it goes on from the one it stopped in (which itself carries on from the
  # answers it had written down). A pass for another choice of models is begun afresh.
  CFG=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.CONFIG_ID+' vs '+c.TARGET.id))")
  if [ -f "$OUT/status.txt" ] && ! grep -q " DONE$" "$OUT/status.txt" && [ "$(cat "$OUT/config" 2>/dev/null)" = "$CFG" ]; then
    echo "$(date +%H:%M:%S) RESUMED this pass had stopped: carrying on" >> "$OUT/status.txt"
    "$NODE" -e "import('./training/support/recover.mjs').then(r=>r.note('pass $P','it had stopped: carried on from where it was',{kind:'resumed'}))" > /dev/null
  else
    rm -f "$OUT"/*.out; : > "$OUT/status.txt"; echo "$CFG" > "$OUT/config"
  fi
  . training/support/steps.sh
  run 00-begin        training/pass.mjs begin
  # THE PLAN, before anything is measured: from what the last pass left
  run 00-plan         training/plan.mjs make ${TRIES:+--tries "$TRIES"}
  # what has been published on what the last pass left open
  if [ -n "$TEACHER" ]; then run 01-research training/research.mjs --teacher "$TEACHER" --spend-claude
  else run 01-research training/research.mjs; fi
  # THE MARK IS THE LARGER MODEL'S OWN ANSWERS, not right answers: it answers the held questions and this pass's train questions
  # first, and everything after is graded by whether it gives the same answer. Each small model alone is graded the same way.
  # A model does not change, so one that has answered these questions is not asked again
  run 02-target       training/baseline.mjs --who target --split held --each "$EACH"
  run 02-target-train training/baseline.mjs --who target --split train --each "$EACH"
  run 03-a-alone   training/baseline.mjs --who a --split held --each "$EACH"
  run 04-b-alone training/baseline.mjs --who b --split held --each "$EACH"
  # the swarm as it is, on this pass's train questions: where each slot is failing
  run 05-swarm-train  training/measure.mjs --split train --each "$EACH"
  # THE PLAN, AGAIN, now that this pass has measured the swarm on its own questions: where the answers were lost decides what is
  # tried and in what order
  # THE PASS LOOKS AT ITSELF: is the measurement steady, where are answers lost, has anything been kept lately? The policy's rules
  # then change how this swarm is trained (the margin a change must win by, what the plan favours, how many arrangements are
  # tried): data, on this configuration's record, each change with its reason. No program is changed
  run 05-review       training/review.mjs --at 05-swarm-train --noise "${NOISE:-12}" --each "$EACH"
  run 06-plan         training/plan.mjs make ${TRIES:+--tries "$TRIES"}
  # the slots the plan names, in its order (with a teacher, every slot: it writes candidates the plan could not have known)
  for S in $([ -n "$TEACHER" ] && "$NODE" training/pass.mjs order || "$NODE" training/plan.mjs slots); do
    if [ -n "$TEACHER" ]; then run "10-improve-$S" training/improve.mjs --slot "$S" --each "$EACH" --teacher "$TEACHER" --spend-claude
    elif [ -f "training/candidates/$S.json" ]; then run "10-improve-$S" training/improve.mjs --slot "$S" --each "$EACH"; fi
  done
  # then the arrangement itself: a few layouts no pass has tried (which model drafts and which checks, how many, what a checker
  # sees, how freely a drafter samples), kept by the same rule a brief is
  run 15-arrange      training/arrange.mjs --each "$EACH" ${TRIES:+--tries "$TRIES"}
  run 16-review       training/review.mjs --at 15-arrange
  # the swarm as it now is: train again (the order of slots for the next pass comes from this), then held (what is reported)
  run 20-swarm-train  training/measure.mjs --split train --each "$EACH"
  run 21-swarm-held   training/measure.mjs --split held --each "$EACH"
  run 22-end          training/pass.mjs end
  run 23-publish      training/publish.mjs
  echo "$(date +%H:%M:%S) DONE" >> "$OUT/status.txt"
done
