// loop.mjs - TRAINING, QUESTION BY QUESTION. The larger model has answered every train question; that answer is the mark. Each
// question is put to the swarm and stays in hand until the swarm's reply is at parity with it, or what can be tried runs out:
//   1  the swarm answers as it stands. At parity: on to the next question
//   2  not at parity: where the answer was lost is read from the slots (no drafter had it; a slot had it and it was not chosen; it
//      was settled and the writer changed it), and that orders what is tried: another brief for a slot that failed, another
//      configuration of the check and decide steps (what a checker sees, how the matter is settled, a model beside the decider,
//      the flow), the writer. One change at a time, the same question asked again with it
//   3  a change that brings this question to parity is asked again on questions already at parity (the same kind first, then
//      the latest). If none of those is lost it is KEPT: the arrangement is now that one, for every question after. If one is
//      lost it is not kept, and the next change is tried
//   4  changes are tried in rounds: every single change, then each combined with the `beam` that came closest, and so on, until
//      parity. Only when a round brings the question no closer is it written down as not reached, and the loop moves on
// What is tried is the plan's (training/plan.mjs: its order, and what a person pinned or skipped on the page); what the loop adds
// is WHEN: for the question in hand, by where that question was lost. The small models are never shown the larger model's answer:
// only the grading is. What is kept is what the spec is made of (src/learned), and a swarm built from it has no larger model beside it.
// With `--cap` or `--drop` set, a question is left after that many changes, and a change tried on that many questions with no parity is left out.
//   node training/loop.mjs --each 6            the train questions, one at a time
//   node training/loop.mjs --beam 3 --guard 6  closest built on per round; questions asked again before a change is kept
//   node training/loop.mjs --pool              what could be tried from here, by area; nothing is asked
//   node training/loop.mjs --explain           what would be tried first on each question the last loop did not reach
// It carries on where it stopped: every finished question is written down (.work/train/<configuration>/loop.json).
import fs from 'node:fs';
import path from 'node:path';
import { decideByOf } from '../src/orchestrate.mjs';

// WHERE A QUESTION'S ANSWER WAS LOST, from its row once every slot's answer is marked (measure.mjs slotReport writes `same`):
//   writing    it was settled, and the writer's reply no longer said it
//   choosing   a drafter or a checker had it, and it was not what was settled
//   drafting   no slot had it
export function lostAt(row) {
  const tr = row.trace || [];
  if (tr.some((s) => s.stage === 'write' && s.same === false)) return 'writing';
  if (tr.some((s) => (s.stage === 'draft' || s.stage === 'check' || s.stage === 'revise') && s.same)) return 'choosing';
  return 'drafting';
}
// the areas of change (support/steer.mjs), in the order they are tried for each way of losing an answer
export const AREAS_FOR = {
  drafting: ['slots', 'briefs', 'flow', 'loops', 'decider', 'several'],
  choosing: ['decider', 'loops', 'flow', 'briefs', 'slots', 'several'],
  writing: ['slots', 'briefs', 'flow', 'decider', 'loops', 'several'],
};
// THE KIND OF A CHANGE, which is what is learned: how often changes of each kind have brought a question to parity
export function classOf(m) {
  const n = String(m.name || '');
  if (m.kind === 'brief')
    return /^the larger model: /.test(n) ? 'a brief by the larger model' : 'a brief from the reading';
  if (/^plan: decide by /.test(n)) return 'another way of deciding';
  if (/^plan: a model (settles|decides)/.test(n)) return 'a model beside the decider';
  if (/token limit/.test(n)) return 'more room to answer';
  if (/temperature/.test(n)) return 'a drafter sampled otherwise';
  if (/ drafts as .* does$/.test(n)) return 'a drafter told what another is told';
  if (/^add /.test(n)) return 'one more slot';
  if (/^move /.test(n)) return 'a slot on another model';
  if (/^drop /.test(n)) return 'one slot fewer';
  if (/checks instead|drafts instead| sees /.test(n)) return 'a slot in another role';
  if (/^several: /.test(n)) return 'several changes at once';
  if (/^flow: /.test(n)) return 'the flow';
  return 'the plan';
}
const CHOOSING_ONLY = /^plan: decide by |^plan: a model (settles|decides)|keep the likeliest|settle it if the decider/;
// WHAT THIS QUESTION'S OWN RECORD SAYS WILL HELP, before anything is asked (measured 2026-11-16: on 12 questions every one of 60
// changes tried was a brief, in a fixed order, and none reached parity; the record had already said what would):
//   choosing   a slot had the answer: each way of deciding is replayed on the record (training/replay.mjs); one that picks the
//              right answer from the same drafts comes first, one that would not is not tried; a model beside the decider where
//              it was close or overruled the majority; a brief for a slot that already had the answer is not tried
//   drafting   no slot had it: more room for a slot cut off at its token limit comes first; then what makes other drafts (sampling,
//              one more drafter, the answers sent back); a change to how the matter is decided cannot help, and is not tried
//   writing    it was settled and the writer lost it: the settled answer handed over as it is comes first
// -> { lost, failed, prio(m): 0 | 1 | 2 | 3, skip(m): bool }
export function evidenceOf(row, briefs = {}, { replay = null } = {}) {
  const lost = lostAt(row);
  const tr = row.trace || [];
  const slots = Object.fromEntries((briefs.slots || []).map((s) => [s.id, s]));
  const failed = tr.filter((s) => (s.stage === 'draft' || s.stage === 'check') && s.same === false).map((s) => s.slot);
  const had = new Set(tr.filter((s) => s.same === true).map((s) => s.slot));
  const capped = new Set(
    tr.filter((s) => slots[s.slot] && s.tokens && s.tokens >= (slots[s.slot].maxTokens || 1e9)).map((s) => s.slot),
  );
  // (the decide step's own row: `decide`, or `kev-decide` in a record written before the decider had a name of its own)
  const decided = tr.find((s) => s.stage === 'decide' && (s.slot === 'decide' || s.slot === 'kev-decide'));
  const now = decideByOf((briefs.plan || {}).decideBy);
  const ways = lost === 'choosing' && replay ? replay([row]).ways : null;
  // the slot a change is to: named on a brief, or the first word of an arrangement's name ("c-direct with a token limit of 1100")
  const slotOf = (m) => m.slot || ((m.name || '').split(' ')[0] in slots ? (m.name || '').split(' ')[0] : '');
  const prio = (m) => {
    const n = m.name || '';
    const sl = slotOf(m);
    if (lost === 'writing') return /settled answer goes out as it is/.test(n) ? 0 : m.stage === 'write' ? 1 : 3;
    if (lost === 'choosing') {
      const w = (n.match(/^plan: decide by (.+)$/) || [])[1];
      if (w && ways && ways[w]) return 0;
      if (/^plan: a model settles it where the decider is close/.test(n) && decided && decided.close) return 1;
      if (/^plan: a model settles it where the decider parts from most/.test(n) && row.path === 'decided-against-most')
        return 1;
      if (/^plan: a model|keep the likeliest|settle it if the decider|onePerAnswer true/.test(n)) return 2;
      return 3;
    }
    if (sl && capped.has(sl) && /token limit/.test(n)) return 0;
    if (
      /temperature|^add a .* on |the answers go back|check and revise/.test(n) &&
      (!sl || (slots[sl] || {}).stage === 'draft')
    )
      return 1;
    if (m.kind === 'brief' && m.stage === 'draft') return 2;
    return 3;
  };
  const skip = (m) => {
    const n = m.name || '';
    if (lost === 'drafting') return CHOOSING_ONLY.test(n);
    if (lost === 'choosing') {
      const w = (n.match(/^plan: decide by (.+)$/) || [])[1];
      if (w && (w === now || (ways && !ways[w]))) return true;
      return m.kind === 'brief' && had.has(slotOf(m));
    }
    return false;
  };
  return { lost, failed, prio, skip };
}
// HOW CLOSE A ROW CAME TO PARITY, as one number to compare: the answer lost later in the flow (writing beats choosing beats
// drafting), then more slots holding the larger model's answer, then more of the decider's probability on that answer
export function closeness(row, ev = null) {
  const lost = (ev && ev.lost) || lostAt(row);
  const tr = row.trace || [];
  const holders = tr.filter(
    (s) => (s.stage === 'draft' || s.stage === 'check' || s.stage === 'revise') && s.same === true,
  );
  const decided = tr.find((s) => s.stage === 'decide' && s.probs && (s.slot === 'decide' || s.slot === 'kev-decide'));
  const p = decided ? Math.max(0, ...holders.map((s) => decided.probs[s.letter] || 0)) : 0;
  return { drafting: 0, choosing: 1, writing: 2 }[lost] * 100 + Math.min(9, holders.length) * 10 + Math.round(p * 9);
}
// how well a kind of change has done: the mean of a Beta(1, 1) on what it reached against what it was tried on
const rate = (c) => ((c ? c.reached : 0) + 1) / ((c ? c.tried : 0) + 2);
// WHAT IS TRIED ON THIS QUESTION, IN ORDER: what a person pinned; what this question's own record says will help (evidenceOf);
// the area of change for where its answer was lost; the kinds of change that have reached parity most often (learned, question
// after question and pass after pass); what has been tried least; the plan's own order. A change the record rules out, or one
// dropped after `drop` questions with no parity, is not in the order at all.
export function orderFor(
  pool,
  { lost = 'drafting', prio = () => 3, skip = () => false, moves = {}, classes = {}, pin = [], drop = 6 } = {},
) {
  const areas = AREAS_FOR[lost] || AREAS_FOR.drafting;
  const rank = (m) => {
    const a = areas.indexOf(m.area);
    return [
      pin.includes(m.id) ? pin.indexOf(m.id) : 1e6,
      prio(m),
      a < 0 ? areas.length : a,
      -rate(classes[classOf(m)]),
      (moves[m.key] || {}).tried || 0,
      m.order ?? 1e6,
    ];
  };
  const sorted = pool
    .filter((m) => !skip(m) && !((moves[m.key] || {}).tried >= drop && !(moves[m.key] || {}).reached))
    .map((m) => [m, rank(m)])
    .sort((x, y) => {
      for (let i = 0; i < x[1].length; i++) if (x[1][i] !== y[1][i]) return x[1][i] - y[1][i];
      return 0;
    })
    .map(([m]) => m);
  // ONE OF EACH IDEA BEFORE A SECOND OF ANY (what the record says will help is never held back): the same flow change at six
  // places, or one more drafter on each of three models, would otherwise spend a question's eight tries on one idea
  const idea = (m) =>
    classOf(m) +
    ':' +
    String(m.name || '')
      .replace(/, (straight )?after .*$|, before .*$/, '')
      .replace(/^add a second [\w-]+ on [abcd]$/, 'add')
      .replace(/^([\w-]+) at temperature .*$/, 'heat');
  const first = [];
  const later = [];
  const seen = new Set();
  for (const m of sorted) {
    if (prio(m) === 0 || !seen.has(idea(m))) {
      seen.add(idea(m));
      first.push(m);
    } else later.push(m);
  }
  return [...first, ...later];
}
// the questions already at parity that a change is asked again on before it is kept: the same kind first, then the latest
export function guardOf(reached, t, n) {
  const same = reached.filter((r) => r.t.kind === t.kind).reverse();
  const rest = reached.filter((r) => r.t.kind !== t.kind).reverse();
  return [...same, ...rest].slice(0, n);
}

// THE LOOP, over anything that can answer and be graded (the trainer below hands it the swarm; the checks hand it a made-up one):
//   attempt(briefs, t, note) -> a graded row { grade: 'right' | 'wrong' | 'unsure' | 'noref', trace, ... }
//   lostOf(row, briefs)      -> evidenceOf(row, briefs): where it was lost, and what its record says will help
//   poolOf(briefs)           -> [{ id, key, name, area, slot, stage, order, briefs }]   every change open from this arrangement
//   keep(briefs, entry)      the change is kept: written down as what the swarm now is
//   onQuestion(q, row, st)   a question is finished (st: what the loop holds, to be written down and carried on from)
export async function runLoop({
  list,
  briefs,
  poolOf,
  attempt,
  lostOf = async (row, b) => evidenceOf(row, b),
  keep = async () => {},
  onQuestion = () => {},
  onAttempt = () => {},
  cap = Infinity,
  guard = 6,
  drop = Infinity,
  pin = [],
  resume = null,
  classes = {},
  beam = 3,
}) {
  const st = resume || { questions: [], rows: [], moves: {}, kept: [] };
  st.classes = st.classes || JSON.parse(JSON.stringify(classes || {}));
  const done = new Set(st.questions.map((q) => q.id));
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const reached = st.questions
    .filter((q) => q.reached)
    .map((q) => ({ t: byId[q.id], row: st.rows.find((r) => r.id === q.id) }))
    .filter((r) => r.t && r.row);
  for (const t of list) {
    if (done.has(t.id)) continue;
    const n = st.questions.length + 1;
    let row = await attempt(briefs, t, { n, of: list.length, attempt: 0, cap, move: '' });
    const q = { id: t.id, kind: t.kind, attempts: [{ move: '', grade: row.grade }] };
    if (row.grade === 'noref') q.state = 'not compared';
    else if (row.grade === 'right') q.state = 'at parity';
    else {
      const ev0 = await lostOf(row, briefs);
      const lost = ev0.lost;
      q.lostAt = lost;
      // UNTIL PARITY, NOT FOR A NUMBER OF TRIES. Every change open from the arrangement is tried on this question, in the order its
      // record gives; then every change on top of the ones that brought it closest, and so on: a search in rounds over
      // combinations, each round built on the `beam` changes that got closest in the round before (closer: the answer lost later
      // in the flow, more slots holding the larger model's answer, more of the decider's probability on it). It ends at parity, or
      // when a whole round brings it no closer than where that round began: then no combination within reach does, and that is
      // written down. `cap` (none by default) is a bound a person may set; nothing else stops it early.
      let frontier = [{ base: briefs, ev: ev0, chain: [], score: closeness(row, ev0) }];
      const seen = new Set();
      let i = 0;
      let done = false;
      for (let round = 1; frontier.length && !done && i < cap; round++) {
        const next = [];
        for (const node of frontier) {
          if (done || i >= cap) break;
          for (const m of orderFor(poolOf(node.base), {
            ...node.ev,
            moves: st.moves,
            classes: st.classes,
            pin,
            drop,
          })) {
            if (done || i >= cap) break;
            const combo = [...node.chain, m.name];
            const key = [...combo].sort().join(' + ');
            if (seen.has(key)) continue;
            seen.add(key);
            i++;
            onAttempt({ q, m, n: i });
            const r = await attempt(m.briefs, t, {
              n,
              of: list.length,
              attempt: i,
              round,
              cap,
              move: combo.join(' + '),
            });
            const mv = (st.moves[m.key] = st.moves[m.key] || {
              id: m.id,
              name: m.name,
              area: m.area,
              slot: m.slot,
              tried: 0,
              reached: 0,
              lostElsewhere: 0,
            });
            mv.tried++;
            const cls = (st.classes[classOf(m)] = st.classes[classOf(m)] || { tried: 0, reached: 0 });
            cls.tried++;
            const a = {
              move: m.name,
              id: m.id,
              area: m.area,
              kind: classOf(m),
              grade: r.grade,
              round,
              ...(node.chain.length ? { on: [...node.chain] } : {}),
            };
            q.attempts.push(a);
            if (r.grade !== 'right') {
              if (r.grade === 'noref') continue;
              // how close it came: carried into the next round only if closer than what it was tried on
              const ev2 = await lostOf(r, m.briefs);
              const score = closeness(r, ev2);
              if (score > node.score) {
                a.closer = true;
                next.push({ base: m.briefs, ev: ev2, chain: combo, score });
              }
              continue;
            }
            mv.reached++;
            cls.reached++;
            const what = combo.join(' + ');
            // at parity here: does it hold on the questions that were already there?
            const again = guardOf(reached, t, guard);
            const rows = [];
            let lostN = 0;
            for (const g of again) {
              const gr = await attempt(m.briefs, g.t, {
                n,
                of: list.length,
                attempt: i,
                round,
                cap,
                move: what,
                guard: g.t.id,
              });
              rows.push(gr);
              if (gr.grade !== 'right') {
                lostN++;
                a.lostOn = g.t.id;
                break; // one lost is enough: it is not kept
              }
            }
            a.guard = { asked: rows.length, of: again.length, lost: lostN };
            if (lostN) {
              mv.lostElsewhere++;
              continue;
            }
            // KEPT: the arrangement is now this one, for this question and every one after
            briefs = { ...m.briefs, version: (briefs.version || 1) + 1 };
            a.kept = true;
            mv.kept = (mv.kept || 0) + 1;
            const several = node.chain.length > 0;
            const entry = {
              kind: several ? 'several' : m.kind,
              slot: m.slot || undefined,
              what: several ? 'several: ' + what : m.name,
              from: m.from || undefined,
              question: { id: t.id, kind: t.kind, lostAt: lost, attempt: i, round, guard: rows.length },
              why:
                'it brought ' +
                t.id +
                ' to parity (lost in ' +
                lost +
                ', change ' +
                i +
                ' tried, in round ' +
                round +
                (several ? ', on top of ' + node.chain.join(' and ') + ', which brought it closer' : '') +
                '), and ' +
                (rows.length
                  ? 'the ' +
                    rows.length +
                    ' question' +
                    (rows.length === 1 ? '' : 's') +
                    ' already at parity asked again with it stayed there'
                  : 'no question was at parity before it to lose'),
            };
            st.kept.push({ ...entry, briefs: briefs.version });
            await keep(briefs, entry);
            again.forEach((g, k) => {
              g.row = rows[k];
              const at = st.rows.findIndex((x) => x.id === g.t.id);
              if (at >= 0) st.rows[at] = rows[k];
            });
            row = r;
            done = true;
          }
        }
        // the next round: on top of the `beam` changes that came closest
        frontier = next.sort((x, y) => y.score - x.score).slice(0, beam);
        q.rounds = round;
      }
      if (!done) q.exhausted = i < cap;
      q.state = row.grade === 'right' ? 'reached' : 'not reached';
    }
    q.reached = row.grade === 'right';
    q.briefs = briefs.version;
    if (q.reached) reached.push({ t, row });
    st.questions.push(q);
    st.rows.push(row);
    await onQuestion(q, row, st, briefs);
  }
  return { ...st, briefs };
}
// what the loop found, in numbers
export function tallyOf(st) {
  const by = (s) => st.questions.filter((q) => q.state === s).length;
  const asked = st.questions.reduce(
    (n, q) => n + q.attempts.length + q.attempts.reduce((k, a) => k + ((a.guard || {}).asked || 0), 0),
    0,
  );
  return {
    questions: st.questions.length,
    atParity: by('at parity'),
    reached: by('reached'),
    notReached: by('not reached'),
    notCompared: by('not compared'),
    kept: st.kept.length,
    asked,
    lostAt: Object.fromEntries(
      ['drafting', 'choosing', 'writing'].map((k) => [k, st.questions.filter((q) => q.lostAt === k).length]),
    ),
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const B = await import('./support/bench.mjs');
  const {
    arg,
    questions,
    needReference,
    openSwarm,
    run,
    askSwarm,
    count,
    line,
    save,
    rowsTo,
    live,
    judgeAddress,
    WORKC,
    REPO_ROOT,
  } = B;
  const { readBriefs, saveLearned } = await import('../src/index.mjs');
  const { CONFIG_ID, CONFIG_KEY, TARGET } = await import('../src/catalog.mjs');
  const { readState, writeState, candHash } = await import('./state.mjs');
  const { steps } = await import('./arrange.mjs');
  const { withExamples } = await import('./support/examples.mjs');
  const { areaOf, readSteer } = await import('./support/steer.mjs');
  const { transferred } = await import('./support/across.mjs');
  const { readPlan, mark } = await import('./support/plan-file.mjs');
  const { slotReport } = await import('./measure.mjs');
  const { replay } = await import('./replay.mjs');
  const { messagesOf } = await import('./tasks.mjs');
  const { plain } = await import('../src/read.mjs');
  const { writeSafe, readSafe } = await import('./support/recover.mjs');

  const each = Number(arg('each', 6));
  // how many changes on a question, how many questions asked again before a keep, when a change is dropped: the policy's
  // (training/policy.json: loop), unless named here
  const { readPolicy } = await import('./policy.mjs');
  const lp = readPolicy().loop || {};
  // no limit by default: a question stays in hand until parity, or until no combination brings it closer
  const num = (v) => (v === undefined || v === null || v === '' ? Infinity : Number(v));
  const cap = num(arg('cap', process.env.CAP || lp.cap));
  const guard = Number(arg('guard', process.env.GUARD || lp.guard || 6));
  const drop = num(arg('drop', lp.drop));
  const beam = Number(arg('beam', lp.beam || 3));
  const list = questions('train', each);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const state = readState();
  const pass = state.pass + 1;
  const steer = readSteer(WORKC);
  const plan = readPlan();
  const planned = plan && plan.pass === pass ? [...(plan.moves || []), ...(plan.catalog || [])] : [];
  const orderOf = (id, name) => {
    const at = planned.findIndex((m) => m.id === id || (m.kind === 'arrangement' && m.what === name));
    return at < 0 ? 1e6 : at;
  };
  // EVERY CHANGE OPEN FROM AN ARRANGEMENT: another brief for a slot (written by a person, by the larger model, or kept by another
  // configuration), and every arrangement one change away (training/arrange.mjs: slots, the check and decide steps, the flow)
  const tried = state.tried || {};
  const fileCands = (slot) => {
    const out = [];
    for (const f of [
      path.join(REPO_ROOT, 'training', 'candidates', slot + '.json'),
      path.join(WORKC, 'candidates', slot + '.json'),
    ])
      try {
        out.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
      } catch {
        /* none there, or half written */
      }
    return out;
  };
  const poolOf = (b0) => {
    const b = withExamples(b0, { each });
    const out = [];
    const moved = transferred(CONFIG_KEY, b).briefs;
    for (const s of b.slots) {
      const cands = [
        ...fileCands(s.id),
        ...moved.filter((x) => x.slot === s.id).map((x) => ({ name: x.name, brief: x.brief })),
      ];
      for (const c of cands) {
        if (!((c.brief && c.brief !== s.brief) || c.plan)) continue;
        const h = candHash(c);
        const id = 'brief:' + s.id + ':' + h;
        if ((tried[s.id] || []).includes(h) || steer.skip.includes(id)) continue;
        if (
          c.plan &&
          Object.entries(c.plan).every(([k, v]) => JSON.stringify((b.plan || {})[k]) === JSON.stringify(v)) &&
          !c.brief
        )
          continue;
        out.push({
          id,
          key: id,
          hash: h,
          kind: c.brief ? 'brief' : 'plan',
          name: c.name,
          from: c.from,
          area: areaOf(c.brief ? 'brief' : 'plan-candidate', c.name),
          slot: s.id,
          stage: s.stage,
          order: orderOf(id, c.name),
          briefs: {
            ...b,
            plan: { ...b.plan, ...(c.plan || {}) },
            slots: b.slots.map((x) => (x.id === s.id && c.brief ? { ...x, brief: c.brief } : x)),
          },
        });
      }
    }
    for (const c of steps(b)) {
      const id = 'arrange:' + c.hash;
      if ((tried._arrangement || []).includes(c.hash) || steer.skip.includes(id)) continue;
      out.push({
        id,
        key: 'arrange:' + c.name,
        hash: c.hash,
        kind: 'arrangement',
        name: c.name,
        area: areaOf('arrangement', c.name),
        order: orderOf(id, c.name),
        briefs: c.briefs,
      });
    }
    return out;
  };

  // --pool: what could be tried from the arrangement as it stands, by area, and nothing asked
  if (B.has('pool')) {
    const pool = poolOf(readBriefs());
    const by = {};
    for (const m of pool) by[m.area] = (by[m.area] || 0) + 1;
    console.log(
      pool.length +
        ' changes open from this arrangement: ' +
        Object.entries(by)
          .map(([k, v]) => v + ' ' + k)
          .join(', ') +
        '.',
    );
    for (const lost of Object.keys(AREAS_FOR))
      console.log(
        '  lost in ' +
          lost +
          ', first: ' +
          orderFor(pool, { lost, pin: steer.pin })
            .slice(0, 3)
            .map((m) => m.name)
            .join(' | '),
      );
    process.exit(0);
  }
  // --explain: for each question the last loop did not reach, what would now be tried first, from its own record; nothing is asked
  if (B.has('explain')) {
    const { replay } = await import('./replay.mjs');
    const was = readSafe(path.join(WORKC, 'loop.json'), null);
    const b0 = readBriefs();
    const pool = poolOf(b0);
    for (const row of ((was && was.st && was.st.rows) || []).filter(
      (r) => r.grade !== 'right' && r.grade !== 'noref',
    )) {
      const ev = evidenceOf(row, b0, { replay });
      const order = orderFor(pool, { ...ev, classes: readState().loopClasses || {} }).slice(0, cap);
      console.log(row.id + ' (lost in ' + ev.lost + '):');
      for (const m of order) console.log('  ' + ev.prio(m) + '  ' + m.name.slice(0, 90));
    }
    process.exit(0);
  }
  const ref = needReference(list, 'train');
  // WHAT THE OLD RULE DROPPED IS NOT DROPPED BY THIS ONE. Before training went question by question, a change was tried on the
  // whole train set and written down as not kept if it did not win there by a margin. Such a change can still bring one question
  // to parity and lose none, so those lists do not say what this loop needs to know: they are cleared, once for a configuration.
  if (state.triedBy !== 'question') {
    const n = Object.values(state.tried || {}).reduce((k, v) => k + (Array.isArray(v) ? v.length : 0), 0);
    state.tried = {};
    state.triedBy = 'question';
    writeState(state);
    if (n)
      console.log(
        n +
          ' changes an earlier pass tried on the whole train set and did not keep are open again: that rule no longer decides.',
      );
  }
  const FILE = path.join(WORKC, 'loop.json');
  const had = readSafe(FILE, null);
  const resume = had && had.pass === pass && had.seed === (list[0] || {}).seed && had.each === each ? had.st : null;
  if (resume)
    console.log('Carrying on: ' + resume.questions.length + ' of ' + list.length + ' questions were finished.');
  const swarm = await openSwarm(readBriefs());
  const reader = judgeAddress(swarm.decider);
  const pick = (got) => ({
    reply: got.reply,
    decided: got.decided,
    path: got.path,
    trace: got.trace,
    tried: got.tried || undefined,
  });
  let st;
  try {
    st = await runLoop({
      list,
      briefs: readBriefs(),
      poolOf,
      cap,
      guard,
      drop,
      beam,
      pin: steer.pin,
      resume,
      // what kinds of change have reached parity, learned on every question of every pass of this configuration
      classes: state.loopClasses || {},
      attempt: async (b, t, at) => {
        swarm.setBriefs(b);
        live({ loop: at });
        const [row] = await run([t], async (x) => pick(await askSwarm(swarm, x, messagesOf(x))), {
          ref,
          at: { n: at.n, of: at.of },
        });
        console.log(
          (at.attempt ? '  ' + (at.guard ? 'again ' : 'try ' + at.attempt + ' ') : '') +
            row.grade.padEnd(7) +
            (at.guard || t.id).padEnd(22) +
            (at.move ? at.move.slice(0, 70) : String(row.path).padEnd(22) + plain(row.decided).slice(0, 30)),
        );
        return row;
      },
      // every slot's answer marked against the larger model's, then what the record says will help (evidenceOf, with the replay)
      lostOf: async (row, b) => {
        await slotReport([row], byId, { reader, briefs: b || swarm.briefs });
        return evidenceOf(row, b || swarm.briefs, { replay });
      },
      // one move is being tried at a time: the one before goes back to planned (its result is written when the pass ends)
      onAttempt: ({ m }) => {
        mark((x) => x.status === 'running', 'planned');
        mark((x) => x.id === m.id || (x.kind === 'arrangement' && x.what === m.name), 'running');
      },
      keep: async (b, entry) => {
        saveLearned(b, { pass, ...entry });
        console.log('  KEPT "' + entry.what + '": ' + entry.why);
      },
      onQuestion: async (q, row, cur) => {
        writeSafe(FILE, JSON.stringify({ pass, seed: (list[0] || {}).seed, each, st: cur }));
        save('questions', {
          pass,
          cfg: CONFIG_ID,
          target: TARGET.id,
          cap,
          guard,
          classes: cur.classes,
          of: list.length,
          ...tallyOf(cur),
          list: cur.questions,
          changes: cur.kept,
          moves: Object.values(cur.moves),
        });
      },
    });
  } finally {
    live({ loop: null });
    await swarm.stop();
  }
  const t = tallyOf(st);
  console.log(
    '\n' +
      t.questions +
      ' questions: ' +
      t.atParity +
      ' at parity as the swarm stood, ' +
      t.reached +
      ' brought to parity by a change (' +
      t.kept +
      ' kept), ' +
      t.notReached +
      ' not reached after ' +
      cap +
      ' changes each' +
      (t.notCompared ? ', ' + t.notCompared + ' not compared' : '') +
      '. The swarm was asked ' +
      t.asked +
      ' times.',
  );
  // THE TRAIN MEASUREMENT IS WHAT THE LOOP LEFT: every question's standing answer, with each slot's own marked
  const c = count(st.rows);
  const rep = await slotReport(st.rows, byId, { reader, briefs: st.briefs });
  console.log(line('swarm (train)', c));
  rowsTo(
    'swarm-runs.jsonl',
    st.rows.map((r) => ({ label: 'swarm', briefs: st.briefs.version, ...r })),
  );
  save('swarm-train', {
    who: 'swarm',
    split: 'train',
    seed: list.length ? list[0].seed : null,
    briefs: st.briefs.version,
    cfg: CONFIG_ID,
    target: TARGET.id,
    ...c,
    ...rep,
  });
  // what was tried, on the plan and for the passes after: a change tried on `drop` questions that brought none to parity is not
  // tried again
  const fresh = readState();
  for (const m of Object.values(st.moves)) {
    const mine = (x) => x.id === m.id || (x.kind === 'arrangement' && x.what === m.name);
    const why =
      (m.kept ? 'kept: ' : '') +
      'tried on ' +
      m.tried +
      ' question' +
      (m.tried === 1 ? '' : 's') +
      ', brought ' +
      m.reached +
      ' to parity' +
      (m.lostElsewhere
        ? ', lost a question already at parity ' + m.lostElsewhere + ' time' + (m.lostElsewhere === 1 ? '' : 's')
        : '');
    mark(mine, m.kept ? 'kept' : 'not kept', {
      result: { questions: { tried: m.tried, reached: m.reached, lostElsewhere: m.lostElsewhere }, why },
    });
    if (!m.kept && m.tried >= drop && !m.reached) {
      const [kind, a, b] = String(m.id).split(':');
      const key = kind === 'brief' ? a : '_arrangement';
      const h = kind === 'brief' ? b : a;
      fresh.tried[key] = [...new Set([...(fresh.tried[key] || []), h])];
    }
  }
  // what was learned about which kinds of change reach parity goes on to the next pass
  fresh.loopClasses = st.classes;
  writeState(fresh);
  B.finished();
  fs.rmSync(FILE, { force: true });
}
