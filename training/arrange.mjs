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
//   flow      the order of steps itself: answers sent back to their drafters, a loop of checking and revising, a decision that
//             narrows before the one that settles, a second writer with the decider picking the reply, a step taken out
//   plan      one worked answer for each different answer; the checks passed over when the drafts agree; drafts of code
//             compared by what they do, or as text
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
import { mark, readPlan } from './support/plan-file.mjs';
import { readBriefs, saveLearned, SERVING } from '../src/index.mjs';
import { flowOf } from '../src/orchestrate.mjs';
import { runTrial } from './support/trial.mjs';
import { readPolicy } from './policy.mjs';

// an arrangement is known by its shape, not its words: who is where, at what stage, seeing what, how hot; and the plan
export const shapeOf = (b) =>
  briefHash(
    JSON.stringify({
      slots: b.slots.map((s) => [s.id, s.member, s.stage, s.sees || '', s.temperature ?? '', s.maxTokens ?? '']),
      plan: Object.fromEntries(Object.entries(b.plan || {}).sort()),
      flow: b.flow || null,
    }),
  );

// every arrangement one step from this one: [{ name, briefs }]
export function steps(b, { cap = SERVING.slots, members = [...new Set(b.slots.map((s) => s.member))].sort() } = {}) {
  // the flow first: with nothing measured to point anywhere, a pass tries the order of steps before it tries who sits where
  const out = [...flowMoves(b)];
  const used = (m, slots = b.slots) => slots.filter((s) => s.member === m).length;
  const withSlots = (slots) => ({ ...b, slots });
  const drafts = b.slots.filter((s) => s.stage === 'draft');
  const checks = b.slots.filter((s) => s.stage === 'check');
  for (const s of b.slots) {
    // move: to another model (any of them), where it has a slot to spare
    for (const m of members)
      if (m !== s.member && used(m) < cap)
        out.push({
          name: 'move ' + s.id + ' to ' + m,
          briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, member: m } : x))),
        });
  }
  const writers = b.slots.filter((s) => s.stage === 'write');
  for (const s of [...drafts, ...checks, ...(writers.length === 1 ? writers : [])]) {
    // add (a second writer means two replies are written, and the decider picks between them): a copy of this role on a model with a slot to spare, sampled more freely so that it is not the same voice twice
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
  // A SLOT CAN CHANGE ITS PART: a drafter becomes a checker, a checker a drafter (told what a slot of that part on its own model,
  // or failing that the other, is told). Which model does which part is not fixed
  const like = (stage, m) =>
    b.slots.find((x) => x.stage === stage && x.member === m) || b.slots.find((x) => x.stage === stage);
  if (drafts.length > 2)
    for (const s of drafts) {
      const model = like('check', s.member);
      if (model)
        out.push({
          name: s.id + ' checks instead of drafting',
          briefs: withSlots(
            b.slots.map((x) =>
              x.id === s.id
                ? { ...x, stage: 'check', brief: model.brief, purpose: model.purpose, sees: model.sees }
                : x,
            ),
          ),
        });
    }
  for (const s of checks) {
    const model = like('draft', s.member);
    if (model)
      out.push({
        name: s.id + ' drafts instead of checking',
        briefs: withSlots(
          b.slots.map((x) =>
            x.id === s.id
              ? Object.fromEntries(
                  Object.entries({
                    ...x,
                    stage: 'draft',
                    brief: model.brief,
                    purpose: model.purpose,
                    sees: undefined,
                    temperature: 0.7,
                  }).filter(([, v]) => v !== undefined),
                )
              : x,
          ),
        ),
      });
  }
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
    ['byBehaviour', true], // drafts of code agree by what they do (run on the same calls), or by how they read
  ]) {
    const now = b.plan && b.plan[key] !== undefined ? b.plan[key] : dflt;
    out.push({ name: 'plan: ' + key + ' ' + !now, briefs: { ...b, plan: { ...b.plan, [key]: !now } } });
  }
  // how the matter is settled (training/replay.mjs says, from the last measurement, what each would have won)
  for (const way of ['kev', 'most', 'kev-if-confident', 'kev-unless-majority'])
    if (((b.plan || {}).decideBy || 'kev') !== way)
      out.push({ name: 'plan: decide by ' + way, briefs: { ...b, plan: { ...b.plan, decideBy: way } } });
  // an arrangement must still be able to answer: two drafters at least, and no model asked for more slots than it has
  return out
    .filter(
      (c) =>
        c.briefs.slots.filter((s) => s.stage === 'draft').length >= 2 &&
        members.every((m) => used(m, c.briefs.slots) <= cap),
    )
    .map((c) => ({ ...c, hash: shapeOf(c.briefs) }));
}

// THE FLOW IS PART OF THE ARRANGEMENT: what happens in what order, how often, and what settles it (src/orchestrate.mjs). Every flow
// one change from this one: the answers sent back to those who wrote them, a loop of checking and revising, a decision that
// narrows before the one that settles, a step taken out, a loop made longer or undone. A kept change is where the next pass
// starts from, so pass after pass the flow can grow into shapes nobody wrote down.
const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
export function flowMoves(b) {
  const f = flowOf(b);
  const out = [];
  const put = (name, flow) => out.push({ name: 'flow: ' + name, briefs: { ...b, flow } });
  const without = (i) => [...f.slice(0, i), ...f.slice(i + 1)];
  const label = (s) => (s.do === 'repeat' ? 'loop' : s.do === 'decide' ? (s.keep ? 'narrowing' : 'decision') : s.do);
  f.forEach((s, i) => {
    const nth = f.slice(0, i).filter((x) => x.do === s.do).length;
    const many = f.filter((x) => x.do === s.do).length > 1;
    const which = many ? ' (the ' + ORD[Math.min(nth, 4)] + ')' : '';
    const next = f[i + 1];
    if (s.do === 'check') {
      if (!(next && next.do === 'revise'))
        put('the answers go back to the drafters after the check' + which, [
          ...f.slice(0, i + 1),
          { do: 'revise' },
          ...f.slice(i + 1),
        ]);
      put('check and revise again while the answers differ, twice at most' + which, [
        ...f.slice(0, i),
        { do: 'repeat', upTo: 2, steps: [{ do: 'check' }, { do: 'revise' }] },
        ...f.slice(i + (next && next.do === 'revise' ? 2 : 1)),
      ]);
      put('no check' + which, without(i));
    }
    if (s.do === 'try' && !f.some((x) => x.do === 'expect'))
      put('say what each call should give, and back the answer that gives it', [
        ...f.slice(0, i + 1),
        { do: 'expect' },
        ...f.slice(i + 1),
      ]);
    if (s.do === 'expect') put('no saying what each call should give', without(i));
    if (s.do === 'revise') put('no revising' + which, without(i));
    // A DECISION CAN STAND ANYWHERE. One that keeps the likeliest two, straight after any step that leaves answers standing
    // (after the drafts and before they are run; after they are run; after the answers come back): what follows has less to weigh
    if (['draft', 'try', 'expect', 'revise'].includes(s.do) && !(next && next.do === 'decide'))
      put('keep the likeliest two straight after the ' + s.do + which, [
        ...f.slice(0, i + 1),
        { do: 'decide', keep: 2 },
        ...f.slice(i + 1),
      ]);
    // A STEP CAN CHANGE PLACES with the one before it (never the first drafts, never the writing)
    const prev = f[i - 1];
    if (
      i >= 2 &&
      s.do !== 'write' &&
      !(s.do === 'decide' && !s.keep) &&
      prev &&
      prev.do !== 'draft' &&
      prev.do !== s.do
    )
      put('the ' + label(s) + which + ' before the ' + label(prev), [...f.slice(0, i - 1), s, prev, ...f.slice(i + 1)]);
    // the answers go back to ONE model's drafters only: the other's stand as they are
    if (s.do === 'revise' && !s.slots)
      for (const m of [...new Set(b.slots.map((x) => x.member))].sort()) {
        const mine = b.slots.filter((x) => x.stage === 'draft' && x.member === m).map((x) => x.id);
        if (mine.length && mine.length < b.slots.filter((x) => x.stage === 'draft').length)
          put('only the drafters on ' + m + ' answer again' + which, [
            ...f.slice(0, i),
            { ...s, slots: mine },
            ...f.slice(i + 1),
          ]);
      }
    if (s.do === 'decide' && s.keep) put('no narrowing' + which, without(i));
    if (s.do === 'decide' && !s.keep && !f.some((x) => x.do === 'decide' && x.keep))
      put('decide twice: keep the likeliest two, check those again, then decide', [
        ...f.slice(0, i),
        { do: 'decide', keep: 2 },
        { do: 'check' },
        ...f.slice(i),
      ]);
    if (s.do === 'repeat') {
      const upTo = s.upTo || 2;
      if (upTo < 3)
        put('the loop' + which + ' ' + (upTo + 1) + ' times at most', [
          ...f.slice(0, i),
          { ...s, upTo: upTo + 1 },
          ...f.slice(i + 1),
        ]);
      put('the loop' + which + ' undone: its steps once', [...f.slice(0, i), ...(s.steps || []), ...f.slice(i + 1)]);
    }
  });
  if (b.flow)
    out.push({
      name: 'flow: the plain one (draft, try, check, decide, write)',
      briefs: (({ flow, ...rest }) => rest)(b),
    });
  // a flow must still begin with a draft and be able to settle on something
  return out.filter((c) => !c.briefs.flow || (c.briefs.flow[0] && c.briefs.flow[0].do === 'draft'));
}

// SEVERAL CHANGES AT ONCE. One step at a time cannot reach an arrangement whose parts only help together (a loop is worth little
// with checkers that say nothing; a narrowing decision is worth little before answers are run). So a pass also tries a few
// arrangements that are `depth` changes from this one, the changes drawn by lot from all that are open: endless variations, and
// which ones a pass draws depends only on its number, so a pass that is run again tries the same ones. How many, and how deep,
// is the trainer's policy (trials.wild, trials.depth), which its review of itself raises when nothing has been kept for a while.
export function wildMoves(b, { n = 1, depth = 2, seed = 1, tried = [] } = {}) {
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0), x / 2 ** 32);
  const out = [];
  for (let k = 0; k < n * 6 && out.length < n; k++) {
    let cur = b;
    const names = [];
    for (let d = 0; d < depth; d++) {
      const open = steps(cur);
      if (!open.length) break;
      const pick = open[Math.floor(rnd() * open.length)];
      names.push(pick.name);
      cur = pick.briefs;
    }
    const hash = shapeOf(cur);
    if (names.length === depth && hash !== shapeOf(b) && !tried.includes(hash) && !out.some((c) => c.hash === hash))
      out.push({ name: 'several: ' + names.join('; then ').replace(/flow: /g, ''), briefs: cur, hash });
  }
  return out;
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
  const policy = readPolicy(state);
  const all = [
    ...steps(briefs),
    ...wildMoves(briefs, { n: policy.trials.wild || 0, depth: policy.trials.depth || 2, seed: state.pass + 1, tried }),
  ];
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
  const cands = planned.length
    ? planned
    : pickSteps(all, tried, Number(arg('tries', readPolicy().trials.arrangements || 4)));
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
  let verdict;
  try {
    verdict = await runTrial({
      swarm,
      base: briefs,
      cands,
      of: (split) => questions(split, each),
      refs,
      policy: readPolicy(),
    });
    if (verdict.kept) {
      const best = verdict.winner;
      saveLearned(
        { ...best.briefs, version: (briefs.version || 1) + 1 },
        {
          pass: state.pass + 1,
          kind: /^flow: /.test(best.name) ? 'flow' : /^plan: /.test(best.name) ? 'plan' : 'arrangement',
          what: best.name.replace(/^flow: /, ''),
          why: verdict.why,
          train: { before: verdict.now, after: verdict.best.train, wins: best.pair.wins, losses: best.pair.losses },
          held: { before: verdict.heldNow, after: verdict.heldBest },
        },
      );
    }
    delete verdict.winner;
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
  delete verdict.cands;
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
                : c.train.stopped
                  ? 'stopped: it could no longer win by ' + verdict.margin
                  : c.pair && c.pair.net >= verdict.margin
                    ? 'won on train, but another arrangement won by more'
                    : 'did not win ' + verdict.margin + ' more answers than it lost on train',
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
