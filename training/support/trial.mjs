// trial.mjs - ONE RULE FOR KEEPING A CHANGE, used for a brief, a change to the plan, an arrangement and a flow alike:
//   1  the swarm as it is, on the TRAIN questions (measured once in a pass: bench.mjs keeps it)
//   2  each candidate on the same questions, compared QUESTION BY QUESTION: the answers it wins (equivalent to the larger model's
//      now, not before) less the answers it loses. A candidate that can no longer win by the margin is stopped there
//   3  the best of those that win by the margin (the trainer's policy: keep.margin), against the swarm as it is, on the HELD questions
//   4  kept only if it does no worse there
// The margin is not fixed in this file. It is the trainer's policy (policy.mjs), which a pass's review of itself can change.
import { run, count, line, paired, swarmName } from './bench.mjs';

export async function runTrial({ swarm, base, cands, of, refs, policy, width = 24 }) {
  const margin = Math.max(1, Number(policy.keep && policy.keep.margin) || 1);
  const stopEarly = !(policy.trials && policy.trials.stopEarly === false);
  const measure = async (briefs, split, until) => {
    swarm.setBriefs(briefs);
    const list = of(split);
    const rows = await run(
      list,
      async (t) => {
        const got = await swarm.answer([{ role: 'user', content: t.ask }]);
        return {
          reply: got.reply,
          decided: got.decided,
          path: got.path,
          trace: got.trace,
          tried: got.tried || undefined,
        };
      },
      { ref: refs[split], name: 'try-' + swarmName(briefs, split, (list[0] || {}).seed), until },
    );
    return { ...count(rows), rows, stopped: !!rows.stopped };
  };
  const now = await measure(base, 'train');
  console.log(line('as it is (train)', now));
  let best = null;
  for (const c of cands) {
    // it cannot be kept once the answers it could still win would not bring it to the margin
    const cannot = (rows, left) => stopEarly && paired(now.rows, rows).net + left < margin;
    c.train = await measure(c.briefs, 'train', cannot);
    c.pair = paired(now.rows, c.train.rows);
    console.log(
      line(c.name.slice(0, width) + ' (train)', c.train) +
        '   wins ' +
        c.pair.wins +
        ', loses ' +
        c.pair.losses +
        (c.train.stopped ? '   stopped: it could no longer win by ' + margin : ''),
    );
    if (!c.train.stopped && c.pair.net >= margin && (!best || c.pair.net > best.pair.net)) best = c;
  }
  const c2 = (c) => c && { right: c.right, wrong: c.wrong };
  if (!best)
    return {
      kept: false,
      why: 'no candidate won ' + margin + ' more answers than it lost on the train questions',
      now: c2(now),
      margin,
      cands,
    };
  const heldNow = await measure(base, 'held');
  const heldBest = await measure(best.briefs, 'held');
  console.log(line('as it is (held)', heldNow));
  console.log(line(best.name.slice(0, width) + ' (held)', heldBest));
  const kept = heldBest.score >= heldNow.score;
  return {
    kept,
    why: kept
      ? 'won ' + best.pair.wins + ' answers and lost ' + best.pair.losses + ' on train, and did no worse on held'
      : 'won on train but did worse on held: it had learned the train questions',
    now: c2(now),
    best: { name: best.name, train: c2(best.train), pair: best.pair },
    winner: best,
    heldNow: c2(heldNow),
    heldBest: c2(heldBest),
    margin,
    cands,
  };
}

// what became of one candidate, in words, for the plan and the record
export const whyOf = (c, verdict) =>
  verdict.best && verdict.best.name === c.name
    ? verdict.why
    : c.train && c.train.stopped
      ? 'stopped partway: it could no longer win by ' + verdict.margin
      : c.pair && c.pair.net >= verdict.margin
        ? 'won on train, but another candidate won by more'
        : 'did not win ' +
          verdict.margin +
          ' more answers than it lost on train' +
          (c.pair ? ' (won ' + c.pair.wins + ', lost ' + c.pair.losses + ')' : '');
