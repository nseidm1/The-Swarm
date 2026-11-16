# steps.sh - HOW ONE STEP OF A PASS IS RUN (sourced by session.sh; it needs OUT, the pass's folder, and NODE).
# A STEP THAT FAILS IS RUN AGAIN, twice at most, after what it left running is stopped. It does not start from nothing: a
# trainer writes every answer down as it comes, and carries on from them. A step that says it has nothing to do (exit 2) is not
# a fault. A step that still fails is written down and the pass goes on: the steps after it say plainly what they lack.
run() { # run <name> <script> [args...]
  local name=$1; shift
  if grep -qF "END   $name exit 0 " "$OUT/status.txt"; then
    echo "$(date +%H:%M:%S) SKIP  $name" >> "$OUT/status.txt"; return 0
  fi
  local attempt code t0
  for attempt in 1 2 3; do
    t0=$(date +%s)
    echo "$(date +%H:%M:%S) START $name" >> "$OUT/status.txt"
    if [ "$attempt" = 1 ]; then "$NODE" "$@" > "$OUT/$name.out" 2>&1; else "$NODE" "$@" >> "$OUT/$name.out" 2>&1; fi
    code=$?
    echo "$(date +%H:%M:%S) END   $name exit $code $(( ($(date +%s) - t0) / 60 )) min" >> "$OUT/status.txt"
    if [ "$code" = 0 ] || [ "$code" = 2 ]; then return "$code"; fi
    [ "$attempt" = 3 ] && break
    echo "--- it stopped (exit $code): run again, carrying on from what it had written down ---" >> "$OUT/$name.out"
    "$NODE" training/support/recover.mjs reap --keep-kev > /dev/null 2>&1
    "$NODE" -e "import('./training/support/recover.mjs').then(r=>r.note('$name','it stopped (exit $code): run again, carrying on',{kind:'step',attempt:$attempt}))" > /dev/null
    sleep $((attempt * ${STEP_WAIT:-5}))
  done
  return "$code"
}

# open_pass <this configuration's folder> <the number of the pass> <what the configuration is, in a line>
# THE PASS IS OPENED WHERE IT WAS LEFT. Each configuration (these small models, this decider, this larger model) has a folder of
# its own, and each of its passes a folder in that. If this pass was begun before and did not finish, it is the same pass: its
# status is kept, and run() passes over the steps that ended well. Otherwise it is begun: an empty status, and nothing of an
# earlier attempt's output. Sets OUT. Stopping, training another configuration and coming back finds this one as it was.
open_pass() {
  OUT=$1/pass-$2; mkdir -p "$OUT"
  if [ -f "$OUT/status.txt" ] && ! grep -q " DONE$" "$OUT/status.txt" && [ "$(cat "$OUT/config" 2>/dev/null)" = "$3" ]; then
    echo "$(date +%H:%M:%S) RESUMED this pass had stopped: carrying on" >> "$OUT/status.txt"
    "$NODE" -e "import('./training/support/recover.mjs').then(r=>r.note('pass $2','it had stopped: carried on from where it was',{kind:'resumed'}))" > /dev/null 2>&1
  else
    rm -f "$OUT"/*.out; : > "$OUT/status.txt"; echo "$3" > "$OUT/config"
  fi
}
