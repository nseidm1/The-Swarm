// improve.mjs - ONE SLOT'S BRIEF, MADE BETTER OR LEFT ALONE. A slot is told one thing (its brief, in src/briefs.json). This takes
// other things it could be told, measures the whole swarm with each in its place, and keeps a new one only if it holds up on
// questions it was not chosen on:
//   1  every candidate, and the brief as it is, on the TRAIN questions (the models are started once; only the words change)
//   2  the best candidate against the brief as it is, on the HELD questions
//   3  kept only if it scored higher on train AND did not score lower on held. Otherwise nothing changes, and that is written down
// The score is right minus wrong, for the reply a person reads: a brief that makes its own slot look better and the reply worse
// is not better.
// Where candidates come from:
//   training/candidates/<slot>.json     [{ "name": "...", "brief": "..." }]  written by a person after reading the slot's failures
//   --teacher claude --spend-claude     a large model is shown the brief and the questions the slot got wrong, and writes three
//                                       (uses the Claude Code on this machine, on its owner's plan: it is never run without the flag)
//   node training/improve.mjs --slot a-critic
//   node training/improve.mjs --slot b-recompute --teacher claude --spend-claude --each 4
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { missesOf, briefAsk, candidatesIn } from './support/teach.mjs';
import {
  arg,
  has,
  openSwarm,
  needReference,
  swarmName,
  finished,
  questions,
  run,
  count,
  line,
  REPO_ROOT,
  WORK,
  WORKC,
  RESULTS,
} from './support/bench.mjs';
import { readState, writeState, candHash } from './state.mjs';
import { mark } from './support/plan-file.mjs';
import { readBriefs, saveLearned } from '../src/index.mjs';
import { runTrial, whyOf } from './support/trial.mjs';
import { readPolicy } from './policy.mjs';

const slotId = arg('slot', '');
const briefs = readBriefs();
const slot = briefs.slots.find((s) => s.id === slotId);
if (!slot) {
  console.log('--slot takes one of: ' + briefs.slots.map((s) => s.id).join(', '));
  process.exit(2);
}
const each = Number(arg('each', 6));
const of = (split) => questions(split, each);
// a candidate is another brief for this slot, a change to the plan, or both
const withBrief = (c) => ({
  ...briefs,
  plan: { ...briefs.plan, ...(c.plan || {}) },
  slots: briefs.slots.map((s) => (s.id === slotId && c.brief ? { ...s, brief: c.brief } : s)),
});

// ---- the candidates
const file = path.join(REPO_ROOT, 'training', 'candidates', slotId + '.json');
let cands = [];
if (fs.existsSync(file)) cands = JSON.parse(fs.readFileSync(file, 'utf8'));
// and those the larger model wrote for this configuration (write-briefs.mjs)
const own = path.join(WORKC, 'candidates', slotId + '.json');
if (fs.existsSync(own))
  try {
    cands.push(...JSON.parse(fs.readFileSync(own, 'utf8')));
  } catch {
    /* half written: none */
  }
if (arg('teacher') === 'claude') {
  if (!has('spend-claude')) {
    console.log('A teacher spends on the Claude plan of this machine. Say --spend-claude to allow it.');
    process.exit(2);
  }
  const ask = briefAsk(slot, missesOf(WORK, slotId));
  try {
    const out = execFileSync('claude', ['-p', '--model', arg('claude-model', 'claude-sonnet-5-5'), ask], {
      encoding: 'utf8',
      timeout: 240000,
      maxBuffer: 4 * 2 ** 20,
    });
    const got = candidatesIn(out, 'teacher');
    if (!got.length) throw new Error('no briefs in its reply');
    cands.push(...got);
  } catch (e) {
    console.log('The teacher gave nothing usable: ' + String(e.message).slice(0, 160));
  }
}
// a brief an earlier pass measured and did not keep is not measured again (--again does)
const state = readState();
const before = state.tried[slotId] || [];
const real = (c) => (c.brief && c.brief !== slot.brief) || c.plan;
const known = cands.filter((c) => real(c) && before.includes(candHash(c))).length;
cands = cands.filter((c) => real(c) && (has('again') || !before.includes(candHash(c))));
if (known) console.log(known + ' candidate(s) were measured by an earlier pass and not kept: passed over.');
if (!cands.length) {
  console.log(
    'No candidates for ' +
      slotId +
      '. Write some in training/candidates/' +
      slotId +
      '.json, let the larger model write some (node training/write-briefs.mjs), or name a teacher.',
  );
  process.exit(2);
}

// ---- measure
// parity is measured against the larger model's answers: it must have answered both sets of questions already
const refs = { train: needReference(of('train'), 'train'), held: needReference(of('held'), 'held') };
const mine = (m) => m.slot === slotId && m.kind !== 'arrangement';
mark((m) => mine(m) && cands.some((c) => c.name === m.what), 'running');
const swarm = await openSwarm(briefs);
let verdict;
try {
  for (const c of cands) c.briefs = withBrief(c);
  verdict = await runTrial({ swarm, base: withBrief({}), cands, of, refs, policy: readPolicy(), width: 22 });
  if (verdict.kept) {
    const best = verdict.winner;
    const next = { ...best.briefs, version: (briefs.version || 1) + 1 };
    // kept: the arrangement as it now is, and the entry that says what changed and on what evidence (src/learned.mjs)
    saveLearned(next, {
      pass: state.pass + 1,
      kind: best.brief ? 'brief' : 'plan',
      slot: slotId,
      what: best.name,
      from: best.from || undefined,
      why: verdict.why,
      train: { before: verdict.now, after: verdict.best.train, wins: best.pair.wins, losses: best.pair.losses },
      held: { before: verdict.heldNow, after: verdict.heldBest },
    });
  }
  delete verdict.winner;
} finally {
  await swarm.stop();
}
console.log(
  '\n' +
    slotId +
    ': ' +
    (verdict.kept ? 'KEPT "' + verdict.best.name + '"' : 'left as it is') +
    ' (' +
    verdict.why +
    ')',
);
fs.mkdirSync(RESULTS, { recursive: true });
fs.appendFileSync(
  path.join(RESULTS, 'briefs-history.jsonl'),
  JSON.stringify({
    at: new Date().toISOString(),
    slot: slotId,
    each,
    tried: cands.map((c) => ({
      name: c.name,
      from: c.from,
      train: c.train && { right: c.train.right, wrong: c.train.wrong },
      pair: c.pair,
      stopped: (c.train && c.train.stopped) || undefined,
    })),
    keptHash: verdict.kept ? candHash(cands.find((c) => c.name === verdict.best.name)) : undefined,
    ...verdict,
    cands: undefined,
  }) + '\n',
);
finished();
// what was measured and not kept, for every pass after this one
const keptName = verdict.kept ? verdict.best.name : '';
for (const c of cands)
  mark((m) => mine(m) && m.what === c.name, c.name === keptName ? 'kept' : c.train ? 'not kept' : 'planned', {
    result: c.train
      ? {
          now: { right: verdict.now.right, wrong: verdict.now.wrong },
          train: { right: c.train.right, wrong: c.train.wrong },
          why: whyOf(c, verdict),
        }
      : undefined,
  });
const fresh = readState();
fresh.tried[slotId] = [
  ...new Set([
    ...(fresh.tried[slotId] || []),
    ...cands.filter((c) => c.train && c.name !== keptName).map((c) => candHash(c)),
  ]),
];
writeState(fresh);
