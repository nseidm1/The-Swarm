// arrange.mjs - THE ARRANGEMENT ITSELF IS TRAINED, NOT ONLY WHAT EACH SLOT IS TOLD. Which model drafts and which checks, how many
// slots draft, whether a checker sees the work or only the answers, how freely a drafter samples: there are countless ways to lay
// two small models out, and the one that reaches parity with the larger model is found by trying them. Every pass tries a few it has
// never tried, and keeps one only by the same rule a brief is kept by:
//   1  each new arrangement, and the arrangement as it is, on the TRAIN questions (the models are started once)
//   2  the best of them against the arrangement as it is, on the HELD questions
//   3  kept only if it scored higher on train AND did not score lower on held
// An arrangement that was measured and not kept is never measured again (state.json), so pass after pass the search moves on.
// What can change (each is one step from the arrangement as it is; a kept step is where the next pass starts from):
//   move      a slot to the other model
//   add       a drafter or a checker, on a model with a slot to spare (a copy of a role, sampled more freely)
//   drop      a drafter (never below two) or a checker
//   sees      a checker shown the work, or only the answers
//   heat      a drafter's temperature, up or down
//   plan      one worked answer for each different answer; the checks passed over when the drafts agree
//   node training/arrange.mjs                 try a few (--tries 4)
//   node training/arrange.mjs --list          every step from here, and which have been tried
import fs from 'node:fs';
import path from 'node:path';
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
  RESULTS,
} from './support/bench.mjs';
import { readState, writeState, briefHash } from './state.mjs';
import { writeSafe } from './support/recover.mjs';
import { mark, readPlan } from './support/plan-file.mjs';
import { BRIEFS_FILE, readBriefs, SERVING } from '../src/index.mjs';

// an arrangement is known by its shape, not its words: who is where, at what stage, seeing what, how hot; and the plan
export const shapeOf = (b) =>
  briefHash(
    JSON.stringify({
      slots: b.slots.map((s) => [s.id, s.member, s.stage, s.sees || '', s.temperature ?? '', s.maxTokens ?? '']),
      plan: Object.fromEntries(Object.entries(b.plan || {}).sort()),
    }),
  );

// every arrangement one step from this one: [{ name, briefs }]
export function steps(b, { cap = SERVING.slots, members = ['a', 'b'] } = {}) {
  const out = [];
  const used = (m, slots = b.slots) => slots.filter((s) => s.member === m).length;
  const other = (m) => members.find((x) => x !== m);
  const withSlots = (slots) => ({ ...b, slots });
  const drafts = b.slots.filter((s) => s.stage === 'draft');
  const checks = b.slots.filter((s) => s.stage === 'check');
  for (const s of b.slots) {
    // move: to the other model, where it has a slot to spare
    if (used(other(s.member)) < cap)
      out.push({
        name: 'move ' + s.id + ' to ' + other(s.member),
        briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, member: other(s.member) } : x))),
      });
  }
  for (const s of [...drafts, ...checks]) {
    // add: a copy of this role on a model with a slot to spare, sampled more freely so that it is not the same voice twice
    for (const m of members) {
      if (used(m) >= cap) continue;
      const id = s.id + '-' + m + '-2';
      if (b.slots.find((x) => x.id === id)) continue;
      const at = b.slots.findIndex((x) => x.id === s.id);
      const copy = { ...s, id, member: m, temperature: Math.round(((s.temperature ?? 0.4) + 0.3) * 10) / 10 };
      out.push({
        name: 'add a second ' + s.id + ' on ' + m,
        briefs: withSlots([...b.slots.slice(0, at + 1), copy, ...b.slots.slice(at + 1)]),
      });
    }
  }
  if (drafts.length > 2)
    for (const s of drafts) out.push({ name: 'drop ' + s.id, briefs: withSlots(b.slots.filter((x) => x.id !== s.id)) });
  for (const s of checks) {
    out.push({ name: 'drop ' + s.id, briefs: withSlots(b.slots.filter((x) => x.id !== s.id)) });
    const sees = s.sees === 'finals' ? undefined : 'finals';
    out.push({
      name: s.id + ' sees ' + (sees ? 'only the answers' : 'the work as well'),
      briefs: withSlots(
        b.slots.map((x) =>
          x.id === s.id ? Object.fromEntries(Object.entries({ ...x, sees }).filter(([, v]) => v !== undefined)) : x,
        ),
      ),
    });
  }
  for (const s of drafts)
    for (const d of [0.3, -0.3]) {
      const t = Math.round(((s.temperature ?? 0.4) + d) * 10) / 10;
      if (t < 0 || t > 1.2) continue;
      out.push({
        name: s.id + ' at temperature ' + t,
        briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, temperature: t } : x))),
      });
    }
  for (const [key, dflt] of [
    ['onePerAnswer', false],
    ['agreeSkipsChecks', true],
  ]) {
    const now = b.plan && b.plan[key] !== undefined ? b.plan[key] : dflt;
    out.push({ name: 'plan: ' + key + ' ' + !now, briefs: { ...b, plan: { ...b.plan, [key]: !now } } });
  }
  // an arrangement must still be able to answer: two drafters at least, and no model asked for more slots than it has
  return out
    .filter(
      (c) =>
        c.briefs.slots.filter((s) => s.stage === 'draft').length >= 2 &&
        members.every((m) => used(m, c.briefs.slots) <= cap),
    )
    .map((c) => ({ ...c, hash: shapeOf(c.briefs) }));
}

// which to try this pass: ones never tried, a different kind of step first so that a pass does not spend itself on one idea
export function pickSteps(all, tried, n) {
  const fresh = all.filter((c) => !tried.includes(c.hash));
  const kind = (c) => c.name.split(' ')[0].replace(/:$/, '');
  const out = [];
  const seen = new Set();
  for (const c of fresh) if (!seen.has(kind(c)) && out.length < n) (seen.add(kind(c)), out.push(c));
  for (const c of fresh) if (!out.includes(c) && out.length < n) out.push(c);
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const briefs = readBriefs();
  const state = readState();
  const tried = state.tried._arrangement || [];
  const all = steps(briefs);
  if (has('list')) {
    for (const c of all) console.log((tried.includes(c.hash) ? 'tried  ' : '       ') + c.name);
    console.log(
      '\n' +
        all.length +
        ' steps from the arrangement as it is; ' +
        all.filter((c) => tried.includes(c.hash)).length +
        ' tried.',
    );
    process.exit(0);
  }
  const each = Number(arg('each', 6));
  // the plan chose which steps to try, from where the answers were lost (plan.mjs). A step is known by its name: if a brief was
  // kept since the plan was written the same step is still the same step. With no plan, a few of different kinds.
  const plan = readPlan();
  const planned =
    plan && plan.pass === state.pass + 1
      ? plan.moves
          .filter((m) => m.kind === 'arrangement')
          .map((m) => all.find((c) => c.name === m.what && !tried.includes(c.hash)))
          .filter(Boolean)
      : [];
  const cands = planned.length ? planned : pickSteps(all, tried, Number(arg('tries', 4)));
  const mine = (m) => m.kind === 'arrangement';
  mark((m) => mine(m) && cands.some((c) => c.name === m.what), 'running');
  if (!cands.length) {
    console.log(
      'Every step from this arrangement has been tried and not kept. It moves on when a brief changes, or a step is kept.',
    );
    process.exit(0);
  }
  // parity is measured against the larger model's answers: it must have answered both sets of questions already
  const refs = {
    train: needReference(questions('train', each), 'train'),
    held: needReference(questions('held', each), 'held'),
  };
  const swarm = await openSwarm(briefs);
  const measure = async (b, split) => {
    swarm.setBriefs(b);
    return count(
      await run(
        questions(split, each),
        async (t) => ({ reply: (await swarm.answer([{ role: 'user', content: t.ask }])).reply }),
        { ref: refs[split], name: 'try-' + swarmName(b, split, (questions(split, each)[0] || {}).seed) },
      ),
    );
  };
  let verdict;
  try {
    const now = await measure(briefs, 'train');
    console.log(line('as it is (train)', now));
    let best = null;
    for (const c of cands) {
      c.train = await measure(c.briefs, 'train');
      console.log(line(c.name.slice(0, 24) + ' (train)', c.train));
      if (c.train.score > now.score && (!best || c.train.score > best.train.score)) best = c;
    }
    if (!best) verdict = { kept: false, why: 'no arrangement tried scored higher on the train questions', now };
    else {
      const heldNow = await measure(briefs, 'held');
      const heldBest = await measure(best.briefs, 'held');
      console.log(line('as it is (held)', heldNow));
      console.log(line(best.name.slice(0, 24) + ' (held)', heldBest));
      const kept = heldBest.score >= heldNow.score;
      verdict = {
        kept,
        why: kept ? 'higher on train, not lower on held' : 'higher on train but lower on held',
        now,
        best: { name: best.name, train: best.train },
        heldNow,
        heldBest,
      };
      if (kept)
        writeSafe(BRIEFS_FILE, JSON.stringify({ ...best.briefs, version: (briefs.version || 1) + 1 }, null, 2) + '\n');
    }
  } finally {
    await swarm.stop();
  }
  console.log(
    '\nThe arrangement: ' +
      (verdict.kept ? 'KEPT "' + verdict.best.name + '"' : 'left as it is') +
      ' (' +
      verdict.why +
      ')',
  );
  const c2 = (c) => c && { right: c.right, wrong: c.wrong };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.appendFileSync(
    path.join(RESULTS, 'arrangement-history.jsonl'),
    JSON.stringify({
      at: new Date().toISOString(),
      pass: state.pass + 1,
      each,
      tried: cands.map((c) => ({ name: c.name, train: c2(c.train) })),
      kept: verdict.kept,
      why: verdict.why,
      name: verdict.best && verdict.best.name,
      now: c2(verdict.now),
      heldNow: c2(verdict.heldNow),
      heldBest: c2(verdict.heldBest),
    }) + '\n',
  );
  finished();
  const fresh = readState();
  const keptName = verdict.kept ? verdict.best.name : '';
  for (const c of cands)
    mark((m) => mine(m) && m.what === c.name, c.name === keptName ? 'kept' : c.train ? 'not kept' : 'planned', {
      result: c.train
        ? {
            now: c2(verdict.now),
            train: c2(c.train),
            why:
              verdict.best && verdict.best.name === c.name
                ? verdict.why
                : c.train.score > verdict.now.score
                  ? 'higher on train, but another arrangement was higher'
                  : 'not higher on the train questions',
          }
        : undefined,
    });
  fresh.tried._arrangement = [
    ...new Set([
      ...(fresh.tried._arrangement || []),
      ...cands.filter((c) => c.train && c.name !== keptName).map((c) => c.hash),
    ]),
  ];
  writeState(fresh);
}
