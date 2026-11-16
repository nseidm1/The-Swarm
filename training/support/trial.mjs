// trial.mjs - ONE RULE FOR KEEPING A CHANGE, used for a brief, a change to the plan, an arrangement and a flow alike:
//   1  the swarm as it is, on the TRAIN questions (measured once in a pass: bench.mjs keeps it)
//   2  each candidate on the same questions, compared QUESTION BY QUESTION: the answers it wins (equivalent to the larger model's
//      now, not before) less the answers it loses. A candidate that can no longer win by the margin is stopped there
//   3  the best of those that win by the margin (the trainer's policy: keep.margin), against the swarm as it is, on the HELD questions
//   4  kept only if it does no worse there
// The margin is not fixed in this file. It is the trainer's policy (policy.mjs), which a pass's review of itself can change.
// Two more things keep a pass fast and its keeps real (2026-11-16):
//   SCREENED FIRST (trials.screen, questions): a candidate is first asked a few train questions, most of them ones the swarm as it
//      is gets wrong (where a win could be) and some it gets right (where a loss would show). Only one that is no worse there is
//      asked the rest. Most candidates lose; each one that loses costs a few questions, not seventy
//   CONFIRMED WITH ANOTHER DRAW (keep.confirm): before a change is kept, it and the swarm as it is are asked the train questions
//      again with another draw. A change that won with one draw and does not win with another was luck, and is not kept
import { run, count, line, paired, swarmName, askSwarm } from './bench.mjs';
import { messagesOf } from '../tasks.mjs';

// the questions a candidate is screened on: the swarm's misses first (in a fixed order), then some it gets right
export function screenOf(rows, n) {
  const order = (r) => [...String(r.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const sorted = [...rows].sort((a, b) => order(a) - order(b));
  const wrong = sorted.filter((r) => r.grade !== 'right' && r.grade !== 'noref');
  const right = sorted.filter((r) => r.grade === 'right');
  const w = Math.min(wrong.length, Math.ceil((n * 2) / 3));
  return new Set([...wrong.slice(0, w), ...right.slice(0, n - w)].map((r) => r.id));
}

export async function runTrial({ swarm, base, cands, of, refs, policy, width = 24 }) {
  const margin = Math.max(1, Number(policy.keep && policy.keep.margin) || 1);
  const stopEarly = !(policy.trials && policy.trials.stopEarly === false);
  const screenN = Math.max(0, Number(policy.trials && policy.trials.screen) || 0);
  const confirm = !(policy.keep && policy.keep.confirm === false);
  const measure = async (briefs, split, until, { only = null, draw = 0 } = {}) => {
    swarm.setBriefs(briefs);
    const list = of(split).filter((t) => !only || only.has(t.id));
    const rows = await run(
      list,
      async (t) => {
        const got = await askSwarm(swarm, t, messagesOf(t));
        return {
          reply: got.reply,
          decided: got.decided,
          path: got.path,
          trace: got.trace,
          tried: got.tried || undefined,
        };
      },
      {
        ref: refs[split],
        name:
          'try-' +
          (only ? 'screen' + only.size + '-' : '') +
          swarmName(briefs, split, (list[0] || {}).seed) +
          (draw ? '-draw' + draw : ''),
        until,
      },
    );
    return { ...count(rows), rows, stopped: !!rows.stopped };
  };
  const now = await measure(base, 'train');
  console.log(line('as it is (train)', now));
  // screening only pays where the train questions are many more than the screen
  const screen = screenN && now.rows.length >= screenN * 2 ? screenOf(now.rows, screenN) : null;
  const nowScreen = screen ? now.rows.filter((r) => screen.has(r.id)) : null;
  let best = null;
  let screenedOut = 0;
  for (const c of cands) {
    if (screen) {
      const s = await measure(c.briefs, 'train', null, { only: screen });
      c.screen = paired(nowScreen, s.rows);
      if (c.screen.net < 0) {
        screenedOut++;
        c.screenedOut = true;
        console.log(
          (c.name.slice(0, width) + ' (screen)').padEnd(width + 9) +
            '   wins ' +
            c.screen.wins +
            ', loses ' +
            c.screen.losses +
            ' of ' +
            screen.size +
            ': worse than the swarm as it is, not asked the rest',
        );
        continue;
      }
    }
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
  let kept = heldBest.score >= heldNow.score;
  // with another draw: does it still win?
  let again = null;
  if (kept && confirm && swarm.setSeed) {
    const seed = swarm.seed;
    try {
      swarm.setSeed((Number(seed) || 1) + 7919);
      const a = await measure(base, 'train', null, { draw: 2 });
      const b = await measure(best.briefs, 'train', null, { draw: 2 });
      again = paired(a.rows, b.rows);
      console.log('with another draw: wins ' + again.wins + ', loses ' + again.losses);
      if (again.net <= 0) kept = false;
    } finally {
      swarm.setSeed(seed);
    }
  }
  return {
    kept,
    screenedOut,
    again,
    why: kept
      ? 'won ' +
        best.pair.wins +
        ' answers and lost ' +
        best.pair.losses +
        ' on train, did no worse on held' +
        (again ? ', and won again with another draw (' + again.wins + ' to ' + again.losses + ')' : '')
      : again && again.net <= 0
        ? 'won with one draw and not with another (' + again.wins + ' to ' + again.losses + '): it was luck'
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
    : c.screenedOut
      ? 'screened out: worse than the swarm as it is on the questions it was screened on (won ' +
        c.screen.wins +
        ', lost ' +
        c.screen.losses +
        ')'
      : c.train && c.train.stopped
        ? 'stopped partway: it could no longer win by ' + verdict.margin
        : c.pair && c.pair.net >= verdict.margin
          ? 'won on train, but another candidate won by more'
          : 'did not win ' +
            verdict.margin +
            ' more answers than it lost on train' +
            (c.pair ? ' (won ' + c.pair.wins + ', lost ' + c.pair.losses + ')' : '');
