// plan.mjs - THE PLAN FOR THIS PASS: what will be tried, in what order, and why. A pass is not a fixed list of things to try. It
// looks at where the swarm's answers differed from the larger model's and where in the arrangement they were lost, and from that
// chooses its moves:
//   1  DIAGNOSE   from the measurement of the swarm on this pass's train questions (measure.mjs): were the drafts short of the
//                 larger model's answer, did a checker turn a draft away from it, did the decider have it on the table and choose
//                 another, did the writer change it, did a slot say nothing
//   2  CHOOSE     every move open to it is scored by how many of those answers it could win back: another brief for a slot
//                 (training/candidates, and the ideas the reading left), a change to the plan, and every arrangement one step
//                 from this one (arrange.mjs). A move an earlier pass measured and did not keep is not chosen again
//   3  FOLLOW     the session runs the moves in the plan's order; improve.mjs and arrange.mjs mark each as it is measured
// It is written twice in a pass: first from what the last pass left (so that there is a plan before anything is measured), and
// again once this pass has measured the swarm on its own questions. The page shows it as it stands.
//   node training/plan.mjs make       write the plan           node training/plan.mjs show      print it
//   node training/plan.mjs slots      the slots whose briefs are in the plan, in order (for session.sh)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafe } from './support/recover.mjs';
import { AREAS, areaOf, focusWeight, readSteer } from './support/steer.mjs';
import { PLAN_FILE, readPlan, writePlan, mark } from './support/plan-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n = (x, one, many) => x + ' ' + (x === 1 ? one : many || one + 's');

// ---- 1: WHERE THE ANSWERS WERE LOST. `report` is what measure.mjs saved: counts, and each slot on its own account.
// A finding is { id, stage, slot?, answers (how many answers it accounts for), text }.
export function diagnose(report) {
  if (!report || !report.slots || !report.compared) return [];
  const out = [];
  const slots = Object.entries(report.slots).map(([id, o]) => ({ id, ...o }));
  const differ = report.wrong + (report.unsure || 0);
  const rate = (o) => (o.ran ? o.right / o.ran : 0);
  const drafts = slots.filter((s) => s.stage === 'draft');
  const bestDraft = drafts.reduce((a, s) => Math.max(a, rate(s)), 0);
  // no slot had the larger model's answer: nothing downstream could have settled on it
  const nobody = Math.max(0, differ - (report.lost || 0));
  if (nobody)
    out.push({
      id: 'drafts-short',
      stage: 'draft',
      answers: nobody,
      text:
        'On ' +
        n(nobody, 'question') +
        " no slot had the larger model's answer. Checking and deciding cannot find what no draft wrote: the drafts are the limit.",
    });
  for (const s of drafts)
    if (s.ran && bestDraft - rate(s) >= 0.15)
      out.push({
        id: 'weak-draft:' + s.id,
        stage: 'draft',
        slot: s.id,
        // a drafter that is behind costs fewer answers than it is behind by: the other drafters cover much of it
        answers: Math.max(1, Math.min(differ, Math.round(((bestDraft - rate(s)) * s.ran) / 2))),
        text:
          s.id + " had the larger model's answer " + s.right + ' times of ' + s.ran + ', well under the best drafter.',
      });
  for (const s of slots.filter((x) => x.stage === 'check'))
    if (s.ran && rate(s) < bestDraft)
      out.push({
        id: 'check-worse:' + s.id,
        stage: 'check',
        slot: s.id,
        answers: Math.max(1, Math.round((bestDraft - rate(s)) * s.ran)),
        text:
          s.id +
          " had the larger model's answer " +
          s.right +
          ' times of ' +
          s.ran +
          ': less often than the best draft it was checking. It is turning answers away from the mark.',
      });
  for (const s of slots.filter((x) => x.stage === 'decide'))
    if (s.threwAway)
      out.push({
        id: 'decider-threw:' + s.id,
        stage: 'decide',
        slot: s.id,
        answers: s.threwAway,
        text:
          "The decider had the larger model's answer on the table " +
          n(s.hadRight, 'time') +
          ' and chose another ' +
          n(s.threwAway, 'time') +
          '.',
      });
  for (const s of slots.filter((x) => x.stage === 'write'))
    if (s.changed)
      out.push({
        id: 'writer-changed:' + s.id,
        stage: 'write',
        slot: s.id,
        answers: s.changed,
        text: 'The writer changed the settled answer ' + n(s.changed, 'time') + '.',
      });
  // CUT OFF: a slot that stops at its token limit on most questions is losing answers to the limit, not to its brief
  for (const s of slots)
    if (s.ran >= 5 && (s.capped || 0) / s.ran >= 0.4)
      out.push({
        id: 'capped:' + s.id,
        stage: s.stage,
        slot: s.id,
        // the cut-off answers that were not the larger model's: some of them would have been, given room to finish
        answers: Math.max(1, Math.round(Math.min(s.capped, s.ran - s.right) / 2)),
        text:
          s.id + ' stopped at its token limit ' + n(s.capped, 'time') + ' of ' + s.ran + ': its answers are cut off.',
      });
  // AN ECHO: a drafter that does what another drafter on its own model does, nearly always, adds no answer of its own
  for (const s of drafts)
    if ((s.paired || 0) >= 5 && (s.echo || 0) / s.paired >= 0.8)
      out.push({
        id: 'echo:' + s.id,
        stage: 'draft',
        slot: s.id,
        answers: Math.max(1, Math.round((nobody * s.echo) / s.paired / 3)),
        text:
          s.id +
          ' gave the same answer as another drafter on its model ' +
          s.echo +
          ' times of ' +
          s.paired +
          ': a slot that echoes adds no answer a draft could win.',
      });
  // THE DECIDER NOT ANSWERING IN TIME: each time, the answer most slots gave stood in its place
  for (const s of slots.filter((x) => x.stage === 'decide'))
    if (s.timedOut && s.timedOut / s.ran >= 0.1)
      out.push({
        id: 'decider-slow:' + s.id,
        stage: 'decide',
        slot: s.id,
        answers: Math.max(1, Math.round(s.timedOut / 2)),
        text:
          'The decider did not answer in time ' +
          n(s.timedOut, 'time') +
          ' of ' +
          s.ran +
          ': the answer most slots gave stood instead. Its wait now grows with how long it takes.',
      });
  for (const s of slots)
    if (s.silent && s.stage !== 'write')
      out.push({
        id: 'silent:' + s.id,
        stage: s.stage,
        slot: s.id,
        answers: Math.max(1, Math.round(s.silent / 2)),
        text: s.id + ' gave no answer ' + n(s.silent, 'time') + ' of ' + s.ran + '.',
      });
  return out.sort((a, b) => b.answers - a.answers);
}

// ---- 2: WHAT EACH MOVE COULD WIN BACK. A move is scored by the findings it speaks to, each worth the answers it accounts for.
const stageOf = (briefs, id) => (briefs.slots.find((s) => s.id === id) || {}).stage;
// a brief or plan candidate for a slot
function briefAnswers(findings, slot, stage, cand) {
  let a = 0;
  const why = [];
  for (const f of findings) {
    const hit =
      f.slot === slot ||
      (f.id === 'drafts-short' && stage === 'draft') ||
      // one worked answer for each different answer changes what the checks and the decider are shown
      (cand.plan && cand.plan.onePerAnswer !== undefined && (f.stage === 'decide' || f.stage === 'check'));
    if (hit) ((a += f.answers), why.push(f.id));
  }
  return { a, why };
}
// an arrangement step (arrange.mjs names them: move, add a second, drop, sees, at temperature, plan:)
function stepAnswers(findings, briefs, name) {
  let a = 0;
  const why = [];
  const about = briefs.slots.find((s) => name.includes(s.id + ' ') || name.endsWith(s.id));
  const stage = about && about.stage;
  for (const f of findings) {
    let w = 0;
    // THE THREE FINDINGS ONLY A NAMED MOVE ANSWERS: a cut-off slot by more room, an echo by sampling it differently, moving it or
    // telling it what another drafter is told; the decider's timeouts by nothing here (the wait now grows with the decider)
    if (/^(capped|echo|decider-slow):/.test(f.id)) {
      if (f.id.startsWith('capped:')) w = about && about.id === f.slot && / with a token limit of /.test(name) ? 1 : 0;
      else if (f.id.startsWith('echo:'))
        w = about && about.id === f.slot && /at temperature|^move | drafts as /.test(name) ? 1 : 0;
      if (w) ((a += w * f.answers), why.push(f.id));
      continue;
    }
    // (more room answers a slot cut off, or one that gave no answer, and nothing else)
    if (/ with a token limit of /.test(name)) {
      if (f.id.startsWith('silent:') && about && about.id === f.slot) ((a += f.answers), why.push(f.id));
      continue;
    }
    if (/^flow: /.test(name)) {
      // a change to the order of steps: sending answers back or looping gives a draft that was wrong a second go; narrowing
      // before deciding gives the decider less to get wrong; dropping a check that turns answers away stops it doing so
      const again = /answers go back to the drafters|check and revise again|times at most/.test(name);
      if (again)
        w =
          f.id === 'drafts-short'
            ? 0.9
            : f.stage === 'draft'
              ? 0.6
              : f.stage === 'check' || f.stage === 'decide'
                ? 0.4
                : 0;
      else if (/keep the likeliest two|settle it if the decider is sure|narrow|settling early/.test(name))
        w = f.stage === 'decide' ? 1 : f.stage === 'check' ? 0.5 : 0;
      else if (/^flow: a check, straight after/.test(name)) w = f.stage === 'decide' ? 0.6 : 0;
      else if (/what each call should give/.test(name)) w = f.stage === 'decide' ? 1 : f.stage === 'check' ? 0.5 : 0;
      else if (/^flow: no check/.test(name)) w = f.stage === 'check' ? 0.6 : 0;
    } else if (/^add a second/.test(name) && stage === 'write') {
      w = f.stage === 'write' ? 1 : 0;
    } else if (f.id === 'drafts-short') {
      if (/^add a second/.test(name) && stage === 'draft') w = 1;
      else if (/at temperature/.test(name)) w = 0.6;
      else if (/^move /.test(name) && stage === 'draft') w = 0.5;
    } else if (f.stage === 'draft' && f.slot) {
      if (about && about.id === f.slot && /^(move|drop) |at temperature/.test(name)) w = 1;
    } else if (f.stage === 'check') {
      if (about && about.id === f.slot && /^(drop|move) | sees /.test(name)) w = 1;
      else if (/^add a second/.test(name) && stage === 'check') w = 0.4;
    } else if (f.stage === 'decide') {
      if (/^plan: onePerAnswer/.test(name)) w = 1;
      else if (/ sees /.test(name)) w = 0.5;
      else if (/^add a second/.test(name) && stage === 'check') w = 0.5;
    } else if (f.id.startsWith('silent:') && about && about.id === f.slot && /^(move|drop) /.test(name)) w = 1;
    w = /at temperature|^move | drafts as /.test(name) ? 1 : 0;
    if (w) ((a += w * f.answers), why.push(f.id));
  }
  return { a: Math.round(a * 10) / 10, why };
}
const TECHNIQUE = [
  [/ with a token limit of /, 'More room to answer'],
  [/^flow: .*(go back to the drafters|no revising)/, 'Answers go back to those who wrote them'],
  [/^flow: .*(settle it if the decider is sure|settling early)/, 'The decider earlier in the flow'],
  [/^flow: .*keep the likeliest two/, 'More than one decision'],
  [/^flow: a check, straight after/, 'A check somewhere else'],
  [/^flow: .*(again while|the loop)/, 'A loop of checking and revising'],
  [/^flow: .*(decide twice|narrowing)/, 'More than one decision'],
  [/^flow: .*what each call should give/, 'Tests written apart from the code'],
  [/^flow: /, 'The order of steps'],
  [/^add a second/, 'One more voice'],
  [/^drop /, 'One voice fewer'],
  [/^move /, 'The other model in this role'],
  [/ sees /, 'What a checker is shown'],
  [/at temperature/, 'How freely a drafter samples'],
  [/^plan: onePerAnswer/, 'One worked answer for each different answer'],
  [/^plan: agreeSkipsChecks/, 'Whether agreeing drafts are still checked'],
  [/^plan: decide by/, 'How the matter is settled'],
  [/^plan: byBehaviour/, 'Whether drafts of code agree by what they do'],
];
const techniqueOf = (name) => (TECHNIQUE.find(([re]) => re.test(name)) || [, 'A change to the arrangement'])[1];

// THE PLAN. `candidates(slotId)` gives that slot's candidates ([{ name, brief?, plan?, from? }]); `steps` is every arrangement
// one step from this one ([{ name, hash }]); `tried` is state.tried; `hashOf` names a candidate the way state.tried does.
export function makePlan({
  state,
  briefs,
  report,
  reportIsThisPass = false,
  candidates = () => [],
  steps = [],
  hashOf = () => '',
  names = {},
  tries = 4,
  wild = [],
  replayed = null,
  weight = {},
  now = new Date(),
  steer = { focus: {}, pin: [], skip: [] },
  elsewhere = { arrangements: new Map(), briefs: [] },
}) {
  // what a person asked for (support/steer.mjs): areas leaned on or left out, moves pinned first, moves skipped
  const fw = (area) => focusWeight(steer, area);
  const findings = diagnose(report);
  const tried = state.tried || {};
  // a brief another configuration kept, for a slot of the same name here, is one more candidate for it
  const ownCandidates = candidates;
  candidates = (id) => [
    ...ownCandidates(id),
    ...elsewhere.briefs
      .filter((b) => b.slot === id)
      .map((b) => ({ name: b.name, brief: b.brief, from: '', elsewhere: b.config })),
  ];
  const moves = [];
  // briefs and plan changes, slot by slot
  const bySlot = [];
  for (const s of briefs.slots) {
    const open = candidates(s.id).filter(
      (c) => ((c.brief && c.brief !== s.brief) || c.plan) && !(tried[s.id] || []).includes(hashOf(c)),
    );
    if (!open.length) continue;
    // (how much each kind of move counts for is the trainer's policy, which a pass's review of itself can change)
    const scored = open.map((c) => {
      let x = briefAnswers(findings, s.id, s.stage, c);
      if (c.elsewhere) x = { a: x.a + 100, why: ['elsewhere:' + c.elsewhere, ...x.why] };
      return { c, ...x, a: Math.round(x.a * (weight[c.brief ? 'brief' : 'plan'] ?? 1) * fw('briefs') * 10) / 10 };
    });
    bySlot.push({ slot: s, scored, a: Math.max(...scored.map((x) => x.a)) });
  }
  // the slot the measurement points at first; with nothing measured, the checkers first (a wrong check undoes a right draft)
  const rank = (s) => ({ check: 0, write: 1, draft: 2 })[s.stage] ?? 3;
  bySlot.sort((x, y) => y.a - x.a || rank(x.slot) - rank(y.slot));
  for (const g of bySlot)
    for (const x of g.scored.sort((p, q) => q.a - p.a))
      moves.push({
        id: 'brief:' + g.slot.id + ':' + hashOf(x.c),
        kind: x.c.brief ? 'brief' : 'plan',
        slot: g.slot.id,
        stage: g.slot.stage,
        model: names[g.slot.member] || g.slot.member,
        technique: x.c.brief ? 'What the slot is told' : 'A change to the plan',
        what: x.c.name,
        from: x.c.from || '',
        answers: x.a,
        why: x.why,
        status: 'planned',
      });
  // arrangements: the ones that speak to the findings first; then one of each kind of step, so a pass does not spend itself on one idea
  const fresh = steps.filter((c) => !(tried._arrangement || []).includes(c.hash));
  const scoredSteps = fresh
    .map((c, i) => {
      let x = stepAnswers(findings, briefs, c.name);
      // a way of choosing between the answers is not guessed at: the last measurement, replayed, says what it would have won
      const way = /^plan: decide by (.+)$/.exec(c.name);
      if (way && replayed) {
        const gain = (replayed.ways[way[1]] ?? 0) - replayed.actual;
        x = { a: Math.max(0, gain), why: gain > 0 ? ['replay'] : [] };
      } else if (way) x = { a: 0, why: [] };
      const kindOf = /^flow: /.test(c.name) ? 'flow' : /^plan: /.test(c.name) ? 'plan' : 'arrangement';
      // KEPT IN ANOTHER CONFIGURATION: evidence from elsewhere, measured here before anything the measurement only suggests
      const kept = elsewhere.arrangements.get(c.name);
      if (kept && kept.length)
        x = {
          a: x.a + 100 + Math.max(...kept.map((k) => k.gain)),
          why: ['elsewhere:' + kept.map((k) => k.config).join(','), ...x.why],
        };
      return { c, i, ...x, a: Math.round(x.a * (weight[kindOf] ?? 1) * fw(areaOf('arrangement', c.name)) * 10) / 10 };
    })
    .filter((x) => fw(areaOf('arrangement', x.c.name)) > 0);
  const kind = (c) => techniqueOf(c.name);
  // (what was kept elsewhere goes in whatever the dedup below would say: it is the strongest evidence a plan has)
  const picked = scoredSteps.filter((x) => x.why.some((w) => String(w).startsWith('elsewhere:'))).slice(0, tries);
  const seen = new Set();
  for (const x of [...scoredSteps].sort((p, q) => q.a - p.a || p.i - q.i))
    if (picked.length < tries && x.a > 0 && !seen.has(kind(x.c) + (x.why[0] || '')))
      (seen.add(kind(x.c) + (x.why[0] || '')), picked.push(x));
  const kinds = new Set(picked.map((x) => kind(x.c)));
  for (const x of scoredSteps)
    if (picked.length < tries && !picked.includes(x) && !kinds.has(kind(x.c))) (kinds.add(kind(x.c)), picked.push(x));
  for (const x of scoredSteps) if (picked.length < tries && !picked.includes(x)) picked.push(x);
  for (const x of picked)
    moves.push({
      id: 'arrange:' + x.c.hash,
      kind: 'arrangement',
      technique: techniqueOf(x.c.name),
      what: x.c.name,
      hash: x.c.hash,
      answers: x.a,
      why: x.why,
      status: 'planned',
    });
  for (const c of wild.filter((c) => !(tried._arrangement || []).includes(c.hash) && fw('several') > 0))
    moves.push({
      id: 'arrange:' + c.hash,
      kind: 'arrangement',
      technique: 'Several changes at once',
      what: c.name,
      hash: c.hash,
      answers: 0,
      why: [],
      status: 'planned',
    });
  // briefs left out by the focus; skipped moves never; pinned moves first, in the order they were pinned, wherever they came from
  let kept = moves.filter((m) => !steer.skip.includes(m.id) && (m.kind !== 'brief' || fw('briefs') > 0));
  const pool = [
    ...kept,
    ...briefs.slots.flatMap((s) =>
      candidates(s.id)
        .filter((c) => ((c.brief && c.brief !== s.brief) || c.plan) && !(tried[s.id] || []).includes(hashOf(c)))
        .map((c) => ({
          id: 'brief:' + s.id + ':' + hashOf(c),
          kind: c.brief ? 'brief' : 'plan',
          slot: s.id,
          stage: s.stage,
          model: names[s.member] || s.member,
          technique: 'What the slot is told',
          what: c.name,
          from: c.from || '',
          answers: 0,
          why: [],
          status: 'planned',
        })),
    ),
    ...steps
      .filter((c) => !(tried._arrangement || []).includes(c.hash))
      .map((c) => ({
        id: 'arrange:' + c.hash,
        kind: 'arrangement',
        technique: techniqueOf(c.name),
        what: c.name,
        hash: c.hash,
        answers: 0,
        why: [],
        status: 'planned',
      })),
    ...wild.map((c) => ({
      id: 'arrange:' + c.hash,
      kind: 'arrangement',
      technique: 'Several changes at once',
      what: c.name,
      hash: c.hash,
      answers: 0,
      why: [],
      status: 'planned',
    })),
  ];
  const pinned = steer.pin
    .map((id) => pool.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => ({ ...m, pinned: true }));
  kept = [...pinned, ...kept.filter((m) => !steer.pin.includes(m.id))];
  moves.length = 0;
  moves.push(...kept);
  moves.forEach((m, i) => (m.order = i + 1));
  return {
    pass: state.pass + 1,
    at: now.toISOString(),
    basedOn: !report ? 'nothing' : reportIsThisPass ? 'this-pass' : 'last-pass',
    // THE GAP, AND WHERE IT IS. How far the swarm is from the larger model on these questions, and of what remains, how much
    // could be had by choosing better between the answers already on the table (a slot had it, the reply did not) and how much
    // needs better answers to be written at all (no slot had it). The moves below are ranked by which of those they speak to
    gap:
      report && report.compared
        ? {
            percent: Math.floor((1000 * report.right) / report.compared) / 10,
            reachableByChoosing: Math.floor((1000 * (report.right + (report.lost || 0))) / report.compared) / 10,
            toClose: report.compared - report.right,
            choosing: report.lost || 0,
            drafting: Math.max(0, report.compared - report.right - (report.lost || 0)),
          }
        : null,
    measured: report
      ? { compared: report.compared, equivalent: report.right, differ: report.wrong, none: report.unsure || 0 }
      : null,
    findings,
    // what the last measurement would have been under each way of choosing between the answers (training/replay.mjs)
    replayed: replayed
      ? { compared: replayed.compared, actual: replayed.actual, ceiling: replayed.ceiling, ways: replayed.ways }
      : null,
    focus: Object.entries(state.focus || {}).map(([kind, more]) => ({ kind, more })),
    moves,
    // WHAT A PERSON CAN STEER (support/steer.mjs): the areas, what is asked of them now, and every move open to this pass with its
    // area, for the page to pin or skip any of them
    steer: { areas: AREAS, focus: steer.focus, pin: steer.pin, skip: steer.skip },
    catalog: pool
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        area: areaOf(m.kind, m.what),
        what: m.what,
        slot: m.slot || '',
        technique: m.technique,
        answers: m.answers || 0,
      })),
    open: {
      arrangements: fresh.length,
      arrangementsTried: steps.length - fresh.length,
    },
  };
}

export { PLAN_FILE, readPlan, writePlan, mark };

if (import.meta.url === 'file://' + process.argv[1]) {
  const what = process.argv[2];
  if (what === 'make') {
    const { readState, candHash } = await import('./state.mjs');
    const { readBriefs } = await import('../src/index.mjs');
    const { MEMBERS, CONFIG_ID, TARGET } = await import('../src/catalog.mjs');
    const { steps, wildMoves } = await import('./arrange.mjs');
    const { RESULTS, arg } = await import('./support/bench.mjs');
    const state = readState();
    const policy = (await import('./policy.mjs')).readPolicy(state);
    // with the pool of worked examples the arrangement step will have (support/examples.mjs), so that the plan ranks those moves too
    const briefs = (await import('./support/examples.mjs')).withExamples(readBriefs(), {
      each: Number(arg('each', 6)),
    });
    const report = readSafe(path.join(RESULTS, 'swarm-train.json'), null);
    const mine = !!report && report.seed === state.seeds.train && (!report.cfg || report.cfg === CONFIG_ID);
    const usable =
      report && (!report.cfg || report.cfg === CONFIG_ID) && (!report.target || report.target === TARGET.id);
    const { replay, lastTrainRows } = await import('./replay.mjs');
    const { WORK } = await import('./support/bench.mjs');
    const replayOf = () => {
      const rows = lastTrainRows(WORK, state.seeds.train, CONFIG_ID, TARGET.id);
      return rows.length ? replay(rows) : null;
    };
    // a slot's candidates: those a person wrote (training/candidates), and those the larger model wrote for this configuration
    // (write-briefs.mjs)
    const { WORKC } = await import('./support/bench.mjs');
    const candidates = (slotId) =>
      [
        readSafe(path.join(ROOT, 'training', 'candidates', slotId + '.json'), []),
        readSafe(path.join(WORKC, 'candidates', slotId + '.json'), []),
      ].flatMap((x) => (Array.isArray(x) ? x : []));
    const { WORKC: WORKC_ } = await import('./support/bench.mjs');
    const { CONFIG_KEY } = await import('../src/catalog.mjs');
    const { transferred } = await import('./support/across.mjs');
    const plan = writePlan({
      ...makePlan({
        steer: readSteer(WORKC_),
        elsewhere: transferred(CONFIG_KEY, briefs),
        state,
        briefs,
        report: usable ? report : null,
        reportIsThisPass: mine,
        candidates,
        steps: steps(briefs),
        replayed: mine ? replayOf() : null,
        // and a few that are several changes from here at once (how many and how deep: the policy)
        wild: wildMoves(briefs, {
          n: policy.trials.wild || 0,
          depth: policy.trials.depth || 2,
          tried: (state.tried || {})._arrangement || [],
        }),
        hashOf: candHash,
        names: Object.fromEntries(Object.entries(MEMBERS).map(([k, m]) => [k, m.name])),
        tries: Number(arg('tries', policy.trials.arrangements || 4)),
        weight: policy.moves.weight || {},
      }),
      config: CONFIG_ID,
      target: TARGET.id,
    });
    console.log(
      'The plan for pass ' +
        plan.pass +
        ', from ' +
        (plan.basedOn === 'this-pass'
          ? "this pass's measurement"
          : plan.basedOn === 'last-pass'
            ? 'what the last pass measured'
            : 'nothing measured yet') +
        ':',
    );
    for (const f of plan.findings) console.log('  found   ' + f.text);
    for (const m of plan.moves)
      console.log(
        '  ' +
          String(m.order).padStart(2) +
          '  ' +
          m.kind.padEnd(12) +
          (m.slot ? m.slot.padEnd(14) : ''.padEnd(14)) +
          m.what +
          (m.answers ? '   (could win back ' + m.answers + ')' : ''),
      );
    if (!plan.moves.length) console.log('  Nothing is left to try from here: write candidates, or read what is new.');
  } else if (what === 'slots') {
    const plan = readPlan();
    console.log(plan ? [...new Set(plan.moves.filter((m) => m.slot).map((m) => m.slot))].join(' ') : '');
  } else if (what === 'show') {
    console.log(JSON.stringify(readPlan(), null, 2));
  } else {
    console.log('plan.mjs make [--tries 4] | slots | show');
    process.exit(2);
  }
}
