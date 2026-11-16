// replay.mjs - WATCH BEFORE ACTING. One measurement of the swarm records, for every question, what each slot answered, which of
// those answers do the same, what the decider's probabilities were, and which answers were equivalent to the larger model's.
// From that record alone, with no model asked again, it can be said what the reply WOULD have been under another way of
// choosing between the answers: the answer most slots hold; the decider always; the decider only where it is sure; the decider
// only where no answer has a clear majority; one slot alone. A ten-minute trial for each becomes a moment's arithmetic, and only
// a way that would have won goes on to a real trial (which is still what decides whether it is kept).
// It can replay only what choosing changes. A change to what a slot is told, or to the flow, makes different answers: those are
// tried for real.
//   node training/replay.mjs            the last measurement of the swarm on the train questions, replayed
import fs from 'node:fs';
import path from 'node:path';

const plain = (s) => String(s || '').replace(/\s+/g, '');
// the answers standing at the end, by slot (its latest), with how many hold each and whether it was equivalent
function standing(row) {
  const latest = new Map();
  for (const t of row.trace || []) if ((t.stage === 'draft' || t.stage === 'revise') && t.final) latest.set(t.slot, t);
  const drafts = [...latest.values()];
  const checks = (row.trace || []).filter((t) => t.stage === 'check' && t.final);
  const keyOf = (t) => (t.does ? 'does:' + t.does : plain(t.final));
  const groups = new Map();
  const add = (t, kind) => {
    const k = keyOf(t);
    const g = groups.get(k) || { key: k, drafts: 0, checks: 0, same: false, letters: [] };
    g[kind]++;
    if (t.same === true) g.same = true;
    if (t.letter) g.letters.push(t.letter);
    groups.set(k, g);
  };
  drafts.forEach((t) => add(t, 'drafts'));
  checks.forEach((t) => add(t, 'checks'));
  const decide = (row.trace || []).find((t) => t.stage === 'decide' && t.of !== 'replies' && t.final);
  return { groups: [...groups.values()], drafts, decide, keyOf };
}
// THE WAYS OF CHOOSING that can be replayed, each a setting of the plan (src/orchestrate.mjs: plan.decideBy)
export const WAYS = {
  kev: 'the decider always',
  most: 'the answer most slots hold',
  'kev-if-confident': 'the decider where it gives its choice 0.6 or more, else the answer most slots hold',
  'kev-unless-majority': 'the answer most slots hold where more than half hold it, else the decider',
};
export function replay(rows) {
  const out = {
    compared: 0,
    actual: 0,
    ceiling: 0,
    ways: Object.fromEntries(Object.keys(WAYS).map((k) => [k, 0])),
    slots: {},
  };
  for (const row of rows) {
    if (row.grade === 'noref' || !row.trace) continue;
    out.compared++;
    if (row.grade === 'right') out.actual++;
    const { groups, drafts, decide } = standing(row);
    if (!groups.length) continue;
    if (groups.some((g) => g.same)) out.ceiling++;
    for (const t of drafts) {
      out.slots[t.slot] = out.slots[t.slot] || 0;
      if (t.same === true) out.slots[t.slot]++;
    }
    const byVotes = [...groups].sort((a, b) => b.drafts + b.checks - (a.drafts + a.checks));
    const most = byVotes[0];
    const voters = groups.reduce((n, g) => n + g.drafts + g.checks, 0);
    // what the decider chose, where it was asked; where it was not (the answers agreed) there was one answer
    const kev = decide ? decide.same === true : most.same;
    const top = decide && decide.probs ? Math.max(...Object.values(decide.probs)) : 1;
    const won = {
      kev,
      most: most.same,
      'kev-if-confident': decide && top < 0.6 ? most.same : kev,
      'kev-unless-majority': (most.drafts + most.checks) * 2 > voters ? most.same : kev,
    };
    for (const k of Object.keys(WAYS)) if (won[k]) out.ways[k]++;
  }
  return out;
}
// the rows of the swarm's last whole measurement on the train questions of this pass
export function lastTrainRows(work, seed, cfg, target) {
  try {
    const rows = fs
      .readFileSync(path.join(work, 'swarm-runs.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return [
      ...new Map(
        rows
          .filter(
            (r) =>
              r.split === 'train' &&
              r.seed === seed &&
              r.label === 'swarm' &&
              (!cfg || r.cfg === cfg) &&
              (!target || r.target === target),
          )
          .map((r) => [r.id, r]),
      ).values(),
    ];
  } catch {
    return [];
  }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const { WORK } = await import('./support/bench.mjs');
  const { readState, targetOf } = await import('./state.mjs');
  const { CONFIG_ID } = await import('../src/catalog.mjs');
  const { readBriefs } = await import('../src/index.mjs');
  const rows = lastTrainRows(WORK, readState().seeds.train, CONFIG_ID, targetOf().id);
  if (!rows.length) {
    console.log('The swarm has not been measured on the train questions of this pass: nothing to replay.');
    process.exit(2);
  }
  const r = replay(rows);
  const now = (readBriefs().plan || {}).decideBy || 'kev';
  console.log(
    r.compared +
      ' questions. As it was: ' +
      r.actual +
      ' equivalent. If the best answer on the table were always chosen: ' +
      r.ceiling +
      '.',
  );
  for (const [k, n] of Object.entries(r.ways))
    console.log('  ' + String(n).padStart(3) + '  ' + WAYS[k] + (k === now ? '   (as it is)' : ''));
  for (const [k, n] of Object.entries(r.slots).sort((a, b) => b[1] - a[1]))
    console.log('  ' + String(n).padStart(3) + '  ' + k + ' alone');
}
