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
    if (/^flow: /.test(name)) {
      // a change to the order of steps: sending answers back or looping gives a draft that was wrong a second go; narrowing
      // before deciding gives the decider less to get wrong; dropping a check that turns answers away stops it doing so
      const again = /go back to the drafters|check and revise again|times at most/.test(name);
      if (again)
        w =
          f.id === 'drafts-short'
            ? 0.9
            : f.stage === 'draft'
              ? 0.6
              : f.stage === 'check' || f.stage === 'decide'
                ? 0.4
                : 0;
      else if (/decide twice|narrow/.test(name)) w = f.stage === 'decide' ? 1 : 0;
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
    if (w) ((a += w * f.answers), why.push(f.id));
  }
  return { a: Math.round(a * 10) / 10, why };
}
const TECHNIQUE = [
  [/^flow: .*(go back to the drafters|no revising)/, 'Answers go back to those who wrote them'],
  [/^flow: .*(again while|the loop)/, 'A loop of checking and revising'],
  [/^flow: .*(decide twice|narrowing)/, 'More than one decision'],
  [/^flow: /, 'The order of steps'],
  [/^add a second/, 'One more voice'],
  [/^drop /, 'One voice fewer'],
  [/^move /, 'The other model in this role'],
  [/ sees /, 'What a checker is shown'],
  [/at temperature/, 'How freely a drafter samples'],
  [/^plan: onePerAnswer/, 'One worked answer for each different answer'],
  [/^plan: agreeSkipsChecks/, 'Whether agreeing drafts are still checked'],
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
  now = new Date(),
}) {
  const findings = diagnose(report);
  const tried = state.tried || {};
  const moves = [];
  // briefs and plan changes, slot by slot
  const bySlot = [];
  for (const s of briefs.slots) {
    const open = candidates(s.id).filter(
      (c) => ((c.brief && c.brief !== s.brief) || c.plan) && !(tried[s.id] || []).includes(hashOf(c)),
    );
    if (!open.length) continue;
    const scored = open.map((c) => ({ c, ...briefAnswers(findings, s.id, s.stage, c) }));
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
  const scoredSteps = fresh.map((c, i) => ({ c, i, ...stepAnswers(findings, briefs, c.name) }));
  const kind = (c) => techniqueOf(c.name);
  const picked = [];
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
  moves.forEach((m, i) => (m.order = i + 1));
  return {
    pass: state.pass + 1,
    at: now.toISOString(),
    basedOn: !report ? 'nothing' : reportIsThisPass ? 'this-pass' : 'last-pass',
    measured: report
      ? { compared: report.compared, equivalent: report.right, differ: report.wrong, none: report.unsure || 0 }
      : null,
    findings,
    focus: Object.entries(state.focus || {}).map(([kind, more]) => ({ kind, more })),
    moves,
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
    const { steps } = await import('./arrange.mjs');
    const { RESULTS, arg } = await import('./support/bench.mjs');
    const state = readState();
    const briefs = readBriefs();
    const report = readSafe(path.join(RESULTS, 'swarm-train.json'), null);
    const mine = !!report && report.seed === state.seeds.train && (!report.cfg || report.cfg === CONFIG_ID);
    const usable =
      report && (!report.cfg || report.cfg === CONFIG_ID) && (!report.target || report.target === TARGET.id);
    const candidates = (slotId) => {
      const list = readSafe(path.join(ROOT, 'training', 'candidates', slotId + '.json'), []);
      return Array.isArray(list) ? list : [];
    };
    const plan = writePlan({
      ...makePlan({
        state,
        briefs,
        report: usable ? report : null,
        reportIsThisPass: mine,
        candidates,
        steps: steps(briefs),
        hashOf: candHash,
        names: { a: MEMBERS.a.name, b: MEMBERS.b.name },
        tries: Number(arg('tries', 4)),
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
