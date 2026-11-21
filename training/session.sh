#!/bin/bash
# session.sh - ONE TRAINING PASS, one step at a time (two at once would share the machine and spoil each other's times).
# A PASS IS ONE TIME THROUGH THE TRAIN QUESTIONS, ONE QUESTION AT A TIME (training/loop.mjs): the larger model's answers are the
# mark, each question stays in hand until the swarm is at parity on it, and the pass ends by measuring on questions held back.
# IT IS BUILT TO GET TO THE END. Hours on one machine with several models loaded will go wrong somewhere, so: what a dead session
# left running is stopped first; a model server that stops is started again; a step that fails is run again and carries on from
# the answers it had; a pass that stopped is resumed, not begun again; and a step that cannot be put right is written down and
# the pass goes on. Every way back that was taken is on the record (.work/train/recovery.jsonl), and on the page.
# A pass begins from what the last one left (training/state.json) and ends by leaving the same for the next: so running this
# again is not the same pass again. It has new train questions, more of the kinds the swarm answered differently on, the slots in the order
# the last pass found them worst, new reading from arXiv on what was weak, arrangements no pass has tried, and nothing
# measured twice.
#   bash training/session.sh                   one pass
#   bash training/session.sh                   pass after pass, until it is stopped
#   PASSES=3 bash training/session.sh          three, each starting from the one before, and then it ends
#   TEACHER=claude bash training/session.sh    let a large model turn the reading and the failures into candidate briefs
#                                              (spends on this machine's Claude plan; without it, candidates are written by hand)
#   EACH=8 bash training/session.sh            questions of each kind (default: the policy's, 6)
#   CAP=12 bash training/session.sh            changes tried on one question before it is left as not reached (default: none, until parity)
#   GUARD=10 bash training/session.sh          questions already at parity asked again before a change is kept (default 6)
#   SWARM_DECIDER=http://127.0.0.1:8009 ...    a decider already running somewhere, in place of the one this session loads itself
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
# how many questions of each kind: the one named (EACH), else the trainer's policy (training/policy.json: questions.each)
EACH=${EACH:-$("$NODE" -e "import('./training/policy.mjs').then(p=>console.log((p.readPolicy().questions||{}).each||6))" 2>/dev/null || echo 6)}
# THE MODELS LIVE AS LONG AS THE SESSION. Nothing is loaded before it and nothing is left loaded after it. The two small models and
# the larger one are started and stopped by each step that uses them; the decider, which every swarm step needs, is started here
# and unloaded when the session ends, however it ends (finished, stopped from the page, or interrupted). A decider someone named
# (SWARM_DECIDER, or SWARM_KEV, its old name) is theirs: it is used and left alone.
# FIRST, WHAT THE CONFIGURED SWARM NEEDS: the engine, the two small models, the decider and the larger model, fetched and made ready
# where they are missing (training/setup.mjs). It recovers by itself where it can, and where it cannot it says what to do.
mkdir -p .work/train
# what a session that died left running is stopped before this one loads its own: it would hold the memory this one needs
"$NODE" training/support/recover.mjs reap
"$NODE" training/setup.mjs > .work/train/setup.out 2>&1 || { cat .work/train/setup.out; echo "$(date +%H:%M:%S) NOT READY: see above. Nothing was trained."; exit 1; }
cat .work/train/setup.out
export KEV_RUN=${KEV_RUN:-$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.DECIDER.run))")}
SWARM_DECIDER=${SWARM_DECIDER:-$SWARM_KEV}
DECIDER_STARTED=
decider_down() { [ -n "$DECIDER_STARTED" ] && bash training/decider.sh stop > /dev/null 2>&1; DECIDER_STARTED=; judge_down; }
JUDGE_PORT=
judge_down() { [ -n "$JUDGE_PORT" ] && pkill -f -- "--port $JUDGE_PORT( |$)" > /dev/null 2>&1; JUDGE_PORT=; }
trap decider_down EXIT
trap 'exit 143' TERM INT
# (a swarm configured with no decision model, the decider `none`, starts none: a small model of the swarm decides)
NO_DECIDER=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.NO_DECIDER?1:''))")
if [ -n "$NO_DECIDER" ]; then
  unset SWARM_DECIDER SWARM_KEV
  echo "$(date +%H:%M:%S) No decision model in this swarm: where the drafts differ, a small model of it decides."
elif [ -z "$SWARM_DECIDER" ]; then
  if bash training/decider.sh ready; then
    mkdir -p .work/train
    # its usual port, or the next one free if something else has that
    DECIDER_PORT=${DECIDER_PORT:-$("$NODE" training/support/recover.mjs port 8009)}
    bash training/decider.sh serve "$DECIDER_PORT" > .work/train/decider.log 2>&1 &
    DECIDER_STARTED=1
    export SWARM_DECIDER="http://127.0.0.1:$DECIDER_PORT"
    for _ in $(seq 1 180); do
      "$NODE" -e "fetch('$SWARM_DECIDER/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
      sleep 5
    done
    if "$NODE" -e "fetch('$SWARM_DECIDER/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
      echo "$(date +%H:%M:%S) The decider loaded for this session at $SWARM_DECIDER"
    else
      # it did not come up: the trainers try again before each question, and say so; until it does, the answer most slots gave stands
      echo "$(date +%H:%M:%S) The decider did not come up at $SWARM_DECIDER (see .work/train/decider.log). The trainers will try to start it again."
    fi
  else
    echo "$(date +%H:%M:%S) NO DECIDER: it is not installed here (bash training/decider.sh install). The answer most slots gave will stand."
  fi
fi
# THE JUDGE OF EQUIVALENCE, APART FROM THE DECIDER ("judge" in src/config.json; src/catalog.mjs JUDGE): started beside it, on a port
# of its own and without taking the decider's port file, so that the swarm's own decider does not grade the answers it chose.
# Where none is named, or it cannot be made ready here, the decider reads them, as before, and that is said.
JUDGE_ID=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.JUDGE?c.JUDGE.id:''))")
if [ -n "$JUDGE_ID" ] && [ -z "$SWARM_JUDGE" ]; then
  if DECIDER_ID="$JUDGE_ID" bash training/decider.sh ready || DECIDER_ID="$JUDGE_ID" bash training/decider.sh install > .work/train/judge.log 2>&1; then
    JUDGE_PORT=$("$NODE" training/support/recover.mjs port 8010)
    DECIDER_ID="$JUDGE_ID" DECIDER_NO_PORT_FILE=1 bash training/decider.sh serve "$JUDGE_PORT" >> .work/train/judge.log 2>&1 &
    for _ in $(seq 1 180); do
      "$NODE" -e "fetch('http://127.0.0.1:$JUDGE_PORT/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
      sleep 5
    done
    if "$NODE" -e "fetch('http://127.0.0.1:$JUDGE_PORT/v1/models',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
      export SWARM_JUDGE="http://127.0.0.1:$JUDGE_PORT"
      echo "$(date +%H:%M:%S) $JUDGE_ID judges equivalence, apart from the decider, at $SWARM_JUDGE"
    else
      judge_down
      echo "$(date +%H:%M:%S) $JUDGE_ID did not come up (see .work/train/judge.log): the decider judges equivalence this session."
    fi
  else
    echo "$(date +%H:%M:%S) $JUDGE_ID could not be made ready here (see .work/train/judge.log): the decider judges equivalence this session."
  fi
fi
# TRAINING IS CONTINUOUS. One pass follows another, each beginning from what the last one left, until it is stopped on purpose
# (the dashboard's Stop training, or this process being stopped). PASSES=n runs n and ends; PASSES=0, the default, does not end.
# It is not left to spin: a pass that is over in under a minute did no work (something it needs is missing), so the next waits a
# little longer each time, and after five such in a row the session stops and says so.
PASSES=${PASSES:-0}
N=0
QUICK=0
while [ "$PASSES" = 0 ] || [ "$N" -lt "$PASSES" ]; do
  N=$((N + 1))
  T_PASS=$(date +%s)
  # the models may have changed (a swarm that reached parity goes on to the next, larger model): what it needs is made ready
  if [ "$N" -gt 1 ]; then
    "$NODE" training/setup.mjs > .work/train/setup.out 2>&1 || { cat .work/train/setup.out; echo "$(date +%H:%M:%S) NOT READY for the next pass: see above."; break; }
  fi
  P=$("$NODE" -e "import('./training/state.mjs').then(s=>console.log(s.readState().pass+1))")
  # THE PASS'S OWN FOLDER IS THIS CONFIGURATION'S: its steps, and what each printed. Another choice of models has another folder, so
  # stopping, training another swarm for a while and coming back finds this pass where it stopped
  KEY=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.CONFIG_KEY))")
  CFG=$("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(c.CONFIG_ID+' vs '+c.TARGET.id))")
  . training/support/steps.sh
  # A PASS THAT STOPPED IS CARRIED ON, NOT BEGUN AGAIN (steps.sh: open_pass). Its steps that ended well are passed over and it goes on
  # from the one it stopped in, which itself carries on from the answers it had written down
  open_pass ".work/train/$KEY" "$P" "$CFG"
  run 00-begin        training/pass.mjs begin
  # THE PLAN, before anything is measured: from what the last pass left
  run 00-plan         training/plan.mjs make ${TRIES:+--tries "$TRIES"}
  # the reader of answers in words is checked on pairs anyone can judge, before its grades are believed (training/readers.mjs)
  run 00-reader       training/readers.mjs
  # what has been published on what the last pass left open
  if [ -n "$TEACHER" ]; then run 01-research training/research.mjs --teacher "$TEACHER" --spend-claude
  else run 01-research training/research.mjs; fi
  # THE MARK IS THE LARGER MODEL'S OWN ANSWERS, not right answers: it answers the held questions and this pass's train questions
  # first, and everything after is graded by whether it gives the same answer. Each small model alone is graded the same way.
  # A model does not change, so one that has answered these questions is not asked again
  run 02-target       training/baseline.mjs --who target --split held --each "$EACH"
  run 02-target-train training/baseline.mjs --who target --split train --each "$EACH"
  # THE LARGER MODEL AGAINST ITSELF: the held questions again, another draw, graded against its own first answers (the noise floor)
  run 02-target-self  training/baseline.mjs --who target --self --split held --each "$EACH"
  # and this pass's train questions again: where it does not give its own answer again, the mark is partly a draw, and the loop
  # marks that question (it is searched until parity all the same: training/loop.mjs never moves on before)
  run 02-target-self-train training/baseline.mjs --who target --self --split train --each "$EACH"
  # AND A THIRD TIME, the questions that carry no standard of their own (a reply in a conversation, an agent's step): the standard
  # for such a question is the answers the larger model agrees with itself on, of its three (training/support/standard.mjs)
  run 02-target-third training/baseline.mjs --who target --third --split held --each "$EACH"
  run 02-target-third-train training/baseline.mjs --who target --third --split train --each "$EACH"
  for K in $("$NODE" -e "import('./src/catalog.mjs').then(c=>console.log(Object.keys(c.MEMBERS).join(' ')))"); do
    run "03-$K-alone" training/baseline.mjs --who "$K" --split held --each "$EACH"
  done
  # NEW BRIEFS FOR THE SLOTS THAT FAILED LAST TIME, written by the larger model itself from what they got wrong (write-briefs.mjs; no
  # spend): more for the loop to try. Then the plan, with them in it: the plan says WHAT can be tried and in what order
  run 07-write-briefs training/write-briefs.mjs
  run 07-plan         training/plan.mjs make ${TRIES:+--tries "$TRIES"}
  # EACH CLASS OF INPUT, TRAINED AS A CLASS (training/classes.mjs), before training goes question by question: for each class the
  # pass has questions of, how it stands (did some slot have the answer, did the swarm settle on it, is the reply good as it is
  # read), then a few candidate arrangements scored on the same questions, the best confirmed on held questions and kept where
  # it is better there. Only questions that carry a standard of their own are asked, and no benchmark's.
  # (TRAIN_CLASSES=words,code: only those classes of input are trained, here and question by question; the Train card's boxes)
  run 08-classes      training/classes.mjs ${TRAIN_CLASSES:+--only "$TRAIN_CLASSES"}
  # TRAINING, QUESTION BY QUESTION (training/loop.mjs). Each train question is put to the swarm and stays in hand until its reply
  # is at parity with the larger model's: where it is not, changes are tried one at a time on that question (another brief, the
  # check and decide steps configured another way, the writer), by where its answer was lost; a change that brings it to parity
  # and loses no question already there is kept, and is the arrangement for every question after. CAP changes at most (8).
  # This is the whole of training: there is no measuring everything, then trying, then measuring again.
  run 10-questions    training/loop.mjs --each "$EACH" ${CAP:+--cap "$CAP"} ${GUARD:+--guard "$GUARD"} ${TRAIN_CLASSES:+--only-classes "$TRAIN_CLASSES"}
  # A KIND WITH NOTHING TO COMPARE STOPS THE PASS (exit 3, training/loop.mjs coverageOf): training it would train nothing and say only
  # "not compared". The pass stays open; started again (a judge named, or SKIP_KINDS=a,b to leave those kinds out) it carries on
  if [ $? = 3 ]; then
    echo "$(date +%H:%M:%S) STOPPED: a kind of question has nothing to compare (see $OUT/10-questions.out)" >> "$OUT/status.txt"
    echo "Stopped: a kind of question has nothing to compare. $OUT/10-questions.out says which, and what to do."
    break
  fi
  # what the swarm cannot try on its own, measured for a person to decide: whether another small model on this machine drafts what
  # no slot drafts (members-probe.mjs), and whether another decider whose weights are here, or one of the swarm's own small models, would have chosen better (decider-replay.mjs)
  run 12-members      training/members-probe.mjs --each "$EACH"
  run 12-deciders     training/decider-replay.mjs --installed --members
  # the swarm as the loop left it, on questions it was never trained on: this is what is reported
  run 21-swarm-held   training/measure.mjs --split held --each "$EACH"
  # and every held question put a second way: equivalence that holds for one wording only is not fundamental
  run 21-swarm-reworded training/measure.mjs --split reworded --each "$EACH"
  run 22-end          training/pass.mjs end
  run 23-publish      training/publish.mjs
  echo "$(date +%H:%M:%S) DONE" >> "$OUT/status.txt"
  if [ $(( $(date +%s) - T_PASS )) -lt 60 ]; then
    QUICK=$((QUICK + 1))
    if [ "$QUICK" -ge 5 ]; then echo "$(date +%H:%M:%S) STOPPED: five passes in a row were over in under a minute. Nothing is being trained: see the steps of $OUT."; break; fi
    sleep $((QUICK * 20))
  else
    QUICK=0
  fi
done
