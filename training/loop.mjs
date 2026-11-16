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
//   4  after `cap` changes with no parity the question is written down as not reached, with where it was lost, and the loop
//      moves on. A question is never asked for ever
// What is tried is the plan's (training/plan.mjs: its order, and what a person pinned or skipped on the page); what the loop adds
// is WHEN: for the question in hand, by where that question was lost. The small models are never shown the larger model's answer:
// only the grading is. What is kept is what the spec is made of (src/learned), and a swarm built from it has no larger model beside it.
// A change tried on `drop` questions that never brought one to parity is left out for the rest of the pass, and by passes after.
//   node training/loop.mjs --each 6            the train questions, one at a time
//   node training/loop.mjs --cap 8 --guard 6   changes tried on a question; questions asked again before a change is kept
//   node training/loop.mjs --pool              what could be tried from here, by area; nothing is asked
// It carries on where it stopped: every finished question is written down (.work/train/<configuration>/loop.json).
import fs from 'node:fs';
import path from 'node:path';

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
  drafting: ['briefs', 'slots', 'flow', 'decider', 'loops', 'several'],
  choosing: ['decider', 'loops', 'flow', 'briefs', 'slots', 'several'],
  writing: ['slots', 'briefs', 'flow', 'decider', 'loops', 'several'],
};
const WRITER = /writer|settled answer|write/i;
// WHAT IS TRIED ON THIS QUESTION, IN ORDER: what a person pinned; then by where the answer was lost (its area, and within the briefs
// the slots that failed it); then what has been tried least; then the plan's own order. A change left out (dropped, skipped) is
// not in the order at all.
export function orderFor(pool, { lost = 'drafting', failed = [], moves = {}, pin = [], drop = 6 } = {}) {
  const areas = AREAS_FOR[lost] || AREAS_FOR.drafting;
  const rank = (m) => {
    const a = areas.indexOf(m.area);
    // a change to a slot that failed this question comes before one to a slot that did not; for a lost reply, the writer's first
    // and where no drafter had it, a drafter's before a checker's
    const near =
      lost === 'writing'
        ? WRITER.test(m.name) || m.stage === 'write'
          ? 0
          : 1
        : m.slot && failed.includes(m.slot)
          ? lost === 'drafting' && m.stage !== 'draft'
            ? 1
            : 0
          : lost === 'drafting' && m.stage === 'draft'
            ? 1
            : 2;
    return [
      pin.includes(m.id) ? pin.indexOf(m.id) : 1e6,
      near,
      a < 0 ? areas.length : a,
      (moves[m.key] || {}).tried || 0,
      m.order ?? 1e6,
    ];
  };
  return pool
    .filter((m) => !((moves[m.key] || {}).tried >= drop && !(moves[m.key] || {}).reached))
    .map((m) => [m, rank(m)])
    .sort((x, y) => {
      for (let i = 0; i < x[1].length; i++) if (x[1][i] !== y[1][i]) return x[1][i] - y[1][i];
      return 0;
    })
    .map(([m]) => m);
}
// the questions already at parity that a change is asked again on before it is kept: the same kind first, then the latest
export function guardOf(reached, t, n) {
  const same = reached.filter((r) => r.t.kind === t.kind).reverse();
  const rest = reached.filter((r) => r.t.kind !== t.kind).reverse();
  return [...same, ...rest].slice(0, n);
}

// THE LOOP, over anything that can answer and be graded (the trainer below hands it the swarm; the checks hand it a made-up one):
//   attempt(briefs, t, note) -> a graded row { grade: 'right' | 'wrong' | 'unsure' | 'noref', trace, ... }
//   lostOf(row)              -> { lost, failed }    where it was lost, and the slots that did not have it
//   poolOf(briefs)           -> [{ id, key, name, area, slot, stage, order, briefs }]   every change open from this arrangement
//   keep(briefs, entry)      the change is kept: written down as what the swarm now is
//   onQuestion(q, row, st)   a question is finished (st: what the loop holds, to be written down and carried on from)
export async function runLoop({
  list,
  briefs,
  poolOf,
  attempt,
  lostOf = async (row) => ({ lost: lostAt(row), failed: [] }),
  keep = async () => {},
  onQuestion = () => {},
  onAttempt = () => {},
  cap = 8,
  guard = 6,
  drop = 6,
  pin = [],
  resume = null,
}) {
  const st = resume || { questions: [], rows: [], moves: {}, kept: [] };
  const done = new Set(st.questions.map((q) => q.id));
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const reached = st.questions
    .filter((q) => q.reached)
    .map((q) => ({ t: byId[q.id], row: st.rows.find((r) => r.id === q.id) }))
    .filter((r) => r.t && r.row);
  let pool = poolOf(briefs);
  for (const t of list) {
    if (done.has(t.id)) continue;
    const n = st.questions.length + 1;
    let row = await attempt(briefs, t, { n, of: list.length, attempt: 0, cap, move: '' });
    const q = { id: t.id, kind: t.kind, attempts: [{ move: '', grade: row.grade }] };
    if (row.grade === 'noref') q.state = 'not compared';
    else if (row.grade === 'right') q.state = 'at parity';
    else {
      const { lost, failed } = await lostOf(row);
      q.lostAt = lost;
      const order = orderFor(pool, { lost, failed, moves: st.moves, pin, drop }).slice(0, cap);
      for (const [i, m] of order.entries()) {
        onAttempt({ q, m, n: i + 1 });
        const r = await attempt(m.briefs, t, { n, of: list.length, attempt: i + 1, cap, move: m.name });
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
        const a = { move: m.name, id: m.id, area: m.area, grade: r.grade };
        q.attempts.push(a);
        if (r.grade !== 'right') continue;
        mv.reached++;
        // at parity here: does it hold on the questions that were already there?
        const again = guardOf(reached, t, guard);
        const rows = [];
        let lostN = 0;
        for (const g of again) {
          const gr = await attempt(m.briefs, g.t, {
            n,
            of: list.length,
            attempt: i + 1,
            cap,
            move: m.name,
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
        const entry = {
          kind: m.kind,
          slot: m.slot || undefined,
          what: m.name,
          from: m.from || undefined,
          question: { id: t.id, kind: t.kind, lostAt: lost, attempt: i + 1, guard: rows.length },
          why:
            'it brought ' +
            t.id +
            ' to parity (lost in ' +
            lost +
            ', change ' +
            (i + 1) +
            ' tried), and ' +
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
        again.forEach((g, j) => {
          g.row = rows[j];
          const at = st.rows.findIndex((x) => x.id === g.t.id);
          if (at >= 0) st.rows[at] = rows[j];
        });
        row = r;
        pool = poolOf(briefs);
        break;
      }
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
  const { messagesOf } = await import('./tasks.mjs');
  const { plain } = await import('../src/read.mjs');
  const { writeSafe, readSafe } = await import('./support/recover.mjs');

  const each = Number(arg('each', 6));
  // how many changes on a question, how many questions asked again before a keep, when a change is dropped: the policy's
  // (training/policy.json: loop), unless named here
  const { readPolicy } = await import('./policy.mjs');
  const lp = readPolicy().loop || {};
  const cap = Number(arg('cap', process.env.CAP || lp.cap || 8));
  const guard = Number(arg('guard', process.env.GUARD || lp.guard || 6));
  const drop = Number(arg('drop', lp.drop || 6));
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
  const kev = judgeAddress(swarm.kev);
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
      pin: steer.pin,
      resume,
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
      lostOf: async (row) => {
        await slotReport([row], byId, { kev, briefs: swarm.briefs });
        const failed = (row.trace || [])
          .filter((s) => (s.stage === 'draft' || s.stage === 'check') && s.same === false)
          .map((s) => s.slot);
        return { lost: lostAt(row), failed };
      },
      onAttempt: ({ m }) => mark((x) => x.id === m.id || (x.kind === 'arrangement' && x.what === m.name), 'running'),
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
          of: list.length,
          ...tallyOf(cur),
          list: cur.questions,
          kept: cur.kept,
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
  const rep = await slotReport(st.rows, byId, { kev, briefs: st.briefs });
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
  writeState(fresh);
  B.finished();
  fs.rmSync(FILE, { force: true });
}
