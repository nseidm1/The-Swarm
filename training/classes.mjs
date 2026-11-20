// classes.mjs - EACH CLASS OF INPUT, TRAINED AS A CLASS: the stage of a pass before it goes question by question (loop.mjs).
//
// An arrangement belongs to a class of input (src/orchestrate.mjs classOf: tools, talk, code, words), so the class is what a
// change is kept for. Going question by question finds a change on one question and then checks it on its class; what lifts a
// whole class without mending the one question in hand is never seen that way (measured 2026-11-19: 57 changes tried one question
// at a time and none kept, where four candidates scored on forty questions of one class found a setting worth 82.5 points on the
// held questions, paired error 6.1). So, for each class this pass has questions of:
//   1. HOW IT STANDS, in three figures over the same questions: on how many some slot's draft had a good answer, on how many the
//      swarm settled on one, and on how many the reply is good as it is read (and how many replies a reader finds no answer in
//      at all). Where answers are lost says what to change: drafting, choosing, or how the reply is written out.
//   2. CANDIDATES, each the class's arrangement with one thing changed (training/arrange.mjs steps, the ones the trainer's policy
//      names for this stage), scored on the SAME train questions. Slot answers are reused between them, so a change to how the
//      matter is settled or written costs no model's time.
//   3. THE BEST OF THEM, where it beats the swarm as it stands on the train questions, is asked the HELD questions of the class,
//      and so is the swarm as it stands. It is kept, as a change is kept (src/learned.mjs), where it is better there by more than
//      twice its paired error and by at least the policy's least gain. Then again from what was kept, a few rounds.
// A question counts only where it carries a standard of its own (tasks.mjs ownStandard): nothing here is marked against the
// larger model, so nothing here needs it loaded, and the swarm can come out ahead of it. No benchmark's question is asked.
//   node training/classes.mjs [--sample N] [--tries N] [--rounds N] [--only talk,words] [--dry]
// It writes <results>/classes.json (what the page shows) as it goes. --dry keeps nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// THE QUESTIONS OF A CLASS A STAGE ASKS: up to `most`, taken kind by kind in turn so that every kind of the class is among them
export function sampleOf(list, most) {
  const by = new Map();
  for (const t of list) by.set(t.kind, [...(by.get(t.kind) || []), t]);
  const out = [];
  for (let i = 0; out.length < most && [...by.values()].some((q) => q.length > i); i++)
    for (const q of by.values()) if (q[i] && out.length < most) out.push(q[i]);
  return out;
}
// what a list of rows comes to: { n, anySlot, settled, counted, unread (null where no question says what a reader reads) }
export function figuresOf(rows) {
  const sum = (f) => rows.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
  const read = rows.filter((x) => x.unread !== null);
  return {
    n: rows.length,
    anySlot: sum((x) => x.any),
    settled: sum((x) => x.settled),
    counted: sum((x) => x.counted),
    unread: read.length ? read.filter((x) => x.unread).length : null,
    // (and kind by kind: where no slot has the answer is where an adapter may have something to teach, adapters.mjs aimOf)
    kinds: Object.fromEntries(
      [...new Set(rows.map((x) => x.kind).filter(Boolean))].map((k) => {
        const of = rows.filter((x) => x.kind === k);
        return [
          k,
          { n: of.length, anySlot: of.filter((x) => x.any).length, counted: of.filter((x) => x.counted).length },
        ];
      }),
    ),
    seconds: Math.round(rows.reduce((a, x) => a + (x.ms || 0), 0) / 1000),
  };
}
// the gain of one arrangement over another on the same questions, and its paired error: { gain, error }
export function pairedGain(a, b) {
  const d = a.map((x, i) => (x.counted ? 1 : 0) - (b[i].counted ? 1 : 0));
  const mean = d.reduce((s, x) => s + x, 0) / Math.max(1, d.length);
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1));
  return { gain: mean, error: sd / Math.sqrt(Math.max(1, d.length)) };
}
// WHICH MOVES THIS STAGE TRIES, of all that are one change from an arrangement: those a pattern of the policy names, in the
// policy's order, each once, at most `most`
export function candidatesOf(moves, patterns, most) {
  // (the first move each pattern names, pattern by pattern; then the second of each, and so on: one pattern that names many
  // moves, a drafter on each model, does not crowd the others out)
  const named = (patterns || []).map((p) => moves.filter((m) => new RegExp(p, 'i').test(m.name)));
  const out = [];
  for (let i = 0; out.length < most && named.some((list) => list.length > i); i++)
    for (const list of named) if (list[i] && !out.includes(list[i]) && out.length < most) out.push(list[i]);
  return out;
}
// kept or not: better on the held questions by more than twice the paired error, and by at least the least gain
export const worthKeeping = (g, least = 0) => !!g && g.gain > 0 && g.gain > 2 * g.error && g.gain >= least;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const B = await import('./support/bench.mjs');
  const { readBriefs, saveLearned } = await import('../src/index.mjs');
  const { briefsFor, classOf, CLASSES } = await import('../src/orchestrate.mjs');
  const { messagesOf, ownStandard } = await import('./tasks.mjs');
  const { steps } = await import('./arrange.mjs');
  const policy = JSON.parse(fs.readFileSync(path.join(HERE, 'policy.json'), 'utf8'));
  const P = policy.classes || {};
  const sample = Number(B.arg('sample', P.sample || 24));
  const tries = Number(B.arg('tries', P.tries || 6));
  const rounds = Number(B.arg('rounds', P.rounds || 2));
  const least = Number((policy.loop || {}).classMinGain || 0);
  const only = B.arg('only') ? String(B.arg('only')).split(',') : null;
  // (--out names another file: a trial that is not the configuration's record)
  const OUT = B.arg('out') || path.join(B.RESULTS, 'classes.json');
  const classIs = (t) => classOf(messagesOf(t), { tools: t.tools });
  // (a standard a program holds: one that needs a reader of answers in words is the larger model's or the decider's to give)
  const mine = (split) => B.questions(split).filter((t) => ownStandard(t) && !['open', 'talk'].includes(t.type));
  const train = mine('train');
  const held = mine('held');

  let stored = readBriefs();
  const record = { at: new Date().toISOString(), sample, tries, rounds, dry: B.has('dry'), classes: {} };
  const save = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT + '.tmp', JSON.stringify(record, null, 1));
    fs.renameSync(OUT + '.tmp', OUT);
  };
  // (asked with a candidate, the class's stored arrangement must not stand over it: the candidate IS the class's arrangement)
  const asClass = (K, b) => ({
    ...stored,
    kinds: { ...(stored.kinds || {}), [K]: { slots: b.slots, plan: b.plan, flow: b.flow } },
  });
  const swarm = await B.openSwarm(stored, { seed: Number(B.arg('seed', 1)), reuse: true });
  // one question under one arrangement: what was drafted, settled and replied, each marked by the question's own standard
  const ask = async (t, briefs) => {
    swarm.setBriefs(briefs);
    const got = await B.askSwarm(swarm, t, messagesOf(t));
    // (a draft's answer and the settled one are marked for what they hold, however they are put: the question as it is plainly
    // marked where it has a stricter standard for its reply; code is marked as the reply it would be)
    const plain = t.plainGood || t.good;
    const as = (x) => (t.wrap ? t.wrap(String(x || '')) : String(x || ''));
    const right = async (x) => !!String(x || '').trim() && (await plain(as(x))).grade === 'right';
    const drafts = (got.trace || []).filter((r) => r.stage === 'draft' && r.final);
    let any = false;
    for (const d of drafts) if (!any && (await right(d.final))) any = true;
    return {
      id: t.id,
      kind: t.kind,
      any,
      settled: await right(got.decided),
      counted: (await t.good(got.reply)).grade === 'right',
      unread: typeof t.readable === 'function' ? !t.readable(got.reply) : null,
      path: got.path,
      ms: got.ms,
    };
  };
  const all = async (list, briefs, said) => {
    const out = [];
    for (const [i, t] of list.entries()) {
      out.push(await ask(t, briefs));
      B.live({ trainer: 'classes', step: said + ', question ' + (i + 1) + ' of ' + list.length });
    }
    return out;
  };

  try {
    for (const K of CLASSES.filter((c) => !only || only.includes(c))) {
      const tr = sampleOf(
        train.filter((t) => classIs(t) === K),
        sample,
      );
      const he = sampleOf(
        held.filter((t) => classIs(t) === K),
        sample,
      );
      if (tr.length < 4 || he.length < 4) {
        record.classes[K] = {
          skipped: 'fewer than four questions of this class carry a standard of their own',
          train: tr.length,
          held: he.length,
        };
        save();
        continue;
      }
      const C = (record.classes[K] = {
        train: tr.length,
        held: he.length,
        kinds: [...new Set(tr.map((t) => t.kind))],
        rounds: [],
        kept: [],
      });
      console.log(
        'class ' + K + ': ' + tr.length + ' train questions, ' + he.length + ' held, of ' + C.kinds.length + ' kinds',
      );
      let base = briefsFor(stored, '', K);
      let baseRows = await all(tr, asClass(K, base), 'The class ' + K + ' as it stands');
      C.asItStands = figuresOf(baseRows);
      save();
      console.log('  as it stands: ' + JSON.stringify(C.asItStands));
      for (let round = 0; round < rounds; round++) {
        const R = { candidates: [] };
        C.rounds.push(R);
        let best = null;
        for (const m of candidatesOf(steps(base), P.moves, tries)) {
          const rows = await all(tr, asClass(K, m.briefs), 'The class ' + K + ': ' + m.name);
          const g = pairedGain(rows, baseRows);
          R.candidates.push({ name: m.name, ...figuresOf(rows), gain: g.gain, error: g.error });
          save();
          console.log(
            '  ' +
              m.name +
              ': counted ' +
              figuresOf(rows).counted +
              ' of ' +
              rows.length +
              ' (' +
              (g.gain * 100).toFixed(1) +
              ' points)',
          );
          if (g.gain > 0 && (!best || g.gain > best.g.gain)) best = { m, rows, g };
        }
        if (!best) break;
        // ON THE HELD QUESTIONS, which it was not chosen on: the swarm as it stands and the best, the same questions for both
        const heldBase = await all(he, asClass(K, base), 'The class ' + K + ' as it stands, held questions');
        const heldBest = await all(
          he,
          asClass(K, best.m.briefs),
          'The class ' + K + ': ' + best.m.name + ', held questions',
        );
        const hg = pairedGain(heldBest, heldBase);
        const keep = worthKeeping(hg, least);
        Object.assign(R, {
          best: best.m.name,
          held: { asItStood: figuresOf(heldBase), with: figuresOf(heldBest), gain: hg.gain, error: hg.error },
          kept: keep,
        });
        console.log(
          '  best: ' +
            best.m.name +
            '; on held ' +
            (hg.gain * 100).toFixed(1) +
            ' points (paired error ' +
            (hg.error * 100).toFixed(1) +
            '): ' +
            (keep ? 'kept' : 'not kept'),
        );
        if (!keep) {
          save();
          break;
        }
        base = best.m.briefs;
        baseRows = best.rows;
        C.kept.push(best.m.name);
        C.after = figuresOf(baseRows);
        if (!B.has('dry')) {
          stored = asClass(K, base);
          stored = { ...stored, version: (stored.version || 0) + 1 };
          saveLearned(stored, {
            what: best.m.name,
            class: K,
            by: 'the class stage',
            gain: hg.gain,
            error: hg.error,
            questions: he.length,
          });
        }
        save();
      }
    }
  } finally {
    await swarm.stop();
  }
  record.done = new Date().toISOString();
  save();
  B.live({ trainer: 'classes', step: 'Each class trained as a class' });
  console.log('written: ' + OUT);
}
