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
  RESULTS,
} from './support/bench.mjs';
import { readState, writeState, candHash } from './state.mjs';
import { mark } from './support/plan-file.mjs';
import { readBriefs, saveLearned } from '../src/index.mjs';

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
if (arg('teacher') === 'claude') {
  if (!has('spend-claude')) {
    console.log('A teacher spends on the Claude plan of this machine. Say --spend-claude to allow it.');
    process.exit(2);
  }
  // what this slot got wrong the last time the swarm was measured
  const runs = path.join(WORK, 'swarm-runs.jsonl');
  const missed = [];
  if (fs.existsSync(runs))
    for (const l of fs.readFileSync(runs, 'utf8').split('\n').filter(Boolean).slice(-400)) {
      const r = JSON.parse(l);
      if (r.split !== 'train') continue; // the held questions are never shown to anything that writes a brief
      const s = (r.trace || []).find((x) => x.slot === slotId);
      if (s && r.grade !== 'right')
        missed.push({ wanted: r.want, slotSaid: String(s.out).slice(-500), reply: String(r.reply).slice(-200) });
    }
  const ask =
    'A small language model (2 to 3 billion parameters) fills one role among eight in a group that answers questions together. ' +
    'Its role: ' +
    slot.stage +
    '. It is told this, and nothing else, before it is shown its input:\n\n' +
    slot.brief +
    '\n\nHere is what it wrote on questions the group then got wrong, with the answer that was wanted:\n' +
    JSON.stringify(missed.slice(-8), null, 1) +
    '\n\nWrite three different replacements for what it is told. Each must be plain instructions a small model can follow, under 110 words, ' +
    'general (never mention these questions or their answers), and must keep the rule that the last line starts with ANSWER: and holds only the answer' +
    (slot.stage === 'write'
      ? ' (this role is the exception: it writes the reply a person reads and has no ANSWER line)'
      : '') +
    '. Reply with JSON only: [{"name":"...","brief":"..."}]';
  try {
    const out = execFileSync('claude', ['-p', '--model', arg('claude-model', 'claude-sonnet-5-5'), ask], {
      encoding: 'utf8',
      timeout: 240000,
      maxBuffer: 4 * 2 ** 20,
    });
    const got = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
    cands.push(
      ...got
        .filter((c) => c && typeof c.brief === 'string' && c.brief.length > 40)
        .map((c) => ({ name: 'teacher: ' + String(c.name).slice(0, 40), brief: c.brief })),
    );
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
    'No candidates for ' + slotId + '. Write some in training/candidates/' + slotId + '.json, or name a teacher.',
  );
  process.exit(2);
}

// ---- measure
// parity is measured against the larger model's answers: it must have answered both sets of questions already
const refs = { train: needReference(of('train'), 'train'), held: needReference(of('held'), 'held') };
const mine = (m) => m.slot === slotId && m.kind !== 'arrangement';
mark((m) => mine(m) && cands.some((c) => c.name === m.what), 'running');
const swarm = await openSwarm(briefs);
const measure = async (c, split) => {
  swarm.setBriefs(withBrief(c));
  return count(
    // every answer is written down as it comes, under a name that says which briefs and which questions: a run that stopped
    // partway carries on, and a candidate already measured is not measured again
    await run(of(split), async (t) => ({ reply: (await swarm.answer([{ role: 'user', content: t.ask }])).reply }), {
      ref: refs[split],
      name: 'try-' + swarmName(withBrief(c), split, (of(split)[0] || {}).seed),
    }),
  );
};
let verdict;
try {
  const now = await measure({}, 'train');
  console.log(line('as it is (train)', now));
  let best = null;
  for (const c of cands) {
    c.train = await measure(c, 'train');
    console.log(line(c.name.slice(0, 22) + ' (train)', c.train));
    if (c.train.score > now.score && (!best || c.train.score > best.train.score)) best = c;
  }
  if (!best) verdict = { kept: false, why: 'no candidate scored higher on the train questions', now };
  else {
    const heldNow = await measure({}, 'held');
    const heldBest = await measure(best, 'held');
    console.log(line('as it is (held)', heldNow));
    console.log(line(best.name.slice(0, 22) + ' (held)', heldBest));
    const kept = heldBest.score >= heldNow.score;
    verdict = {
      kept,
      why: kept
        ? 'higher on train, not lower on held'
        : 'higher on train but lower on held: it had learned the train questions',
      now,
      best: { name: best.name, train: best.train },
      heldNow,
      heldBest,
    };
    if (kept) {
      const next = withBrief(best);
      next.version = (briefs.version || 1) + 1;
      // kept: the arrangement as it now is, and the entry that says what changed and on what evidence (src/learned.mjs)
      const c2 = (c) => ({ right: c.right, wrong: c.wrong });
      saveLearned(next, {
        pass: state.pass + 1,
        kind: best.brief ? 'brief' : 'plan',
        slot: slotId,
        what: best.name,
        from: best.from || undefined,
        why: 'higher on train, not lower on held',
        train: { before: c2(now), after: c2(best.train) },
        held: { before: c2(heldNow), after: c2(heldBest) },
      });
    }
  }
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
    })),
    keptHash: verdict.kept ? candHash(cands.find((c) => c.name === verdict.best.name)) : undefined,
    ...verdict,
    now: verdict.now && { right: verdict.now.right, wrong: verdict.now.wrong },
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
          why:
            c.name === keptName
              ? verdict.why
              : verdict.best && verdict.best.name === c.name
                ? verdict.why
                : c.train.score > verdict.now.score
                  ? 'higher on train, but another candidate was higher'
                  : 'not higher on the train questions',
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
