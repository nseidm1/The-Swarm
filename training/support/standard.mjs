// standard.mjs - THE STANDARD FOR A QUESTION THAT HAS NONE OF ITS OWN (docs/swoa-parity.md, 4). A reply in a conversation, a piece of
// advice, an agent's next step: no program can say whether one is good. There the larger model's answers are the standard, and
// not one of them: it is asked the same question up to three times (baseline.mjs: its first answer, --self, --third), and
//   the standard   is the answers that agree with each other, read the way an answer of the swarm's is read against them
//   no standard    where none of its answers agrees with another: the question is left out of training and counted apart
// One answer alone is the standard as it always was (nothing says otherwise). Measured 2026-11-18: asked a second time, the larger
// model's answer was equivalent to its first on 17 of 36 questions in conversation; "Why did my deploy fail last night?", with
// nothing shown, drew a different cause each time (its two answers read 0.02 against each other).
// A reply is good when it is equivalent to one of the standard's answers; it is read at the reader's line, with nothing read as
// undecided above it (support/equivalent.mjs atLine).
//   answersOf(runsFile, { target, ids })                 -> Map(id -> [answers, in the order asked])
//   standardOf(answers, same)                            -> { idx: [which answers], none }
//   standardsFor({ list, answers, same, file, by })       -> Map(id -> { answers: [texts], none }), kept in `file`
//   againstStandard(t, standard, reply, ctx)             -> a grade, as t.equivalent gives one
import fs from 'node:fs';

// the larger model's answers on record for these questions (training/support/bench.mjs rowsTo: baseline-runs.jsonl), newest of
// each label: its first answer, the one it gave asked again, and the third
export function answersOf(runsFile, { target, ids }) {
  const labels = [target, target + '-self', target + '-third'];
  const got = new Map();
  let text = '';
  try {
    text = fs.readFileSync(runsFile, 'utf8');
  } catch {
    return new Map();
  }
  for (const l of text.split('\n')) {
    if (!l || !l.includes(target)) continue;
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    const k = labels.indexOf(r.label);
    if (k < 0 || !ids.has(r.id) || !String(r.reply || '').trim()) continue;
    const mine = got.get(r.id) || [];
    mine[k] = String(r.reply);
    got.set(r.id, mine);
  }
  return new Map([...got].map(([id, a]) => [id, a.filter((x) => x !== undefined)]));
}

// which of a question's answers are its standard: with one, that one; with more, every answer that agrees with another (same(a,
// b) -> true | false | null where it could not be read; an answer that could not be read against any other agrees with none)
export async function standardOf(answers, same) {
  if (answers.length <= 1) return { idx: answers.length ? [0] : [], none: !answers.length };
  const agrees = answers.map(() => false);
  for (let i = 0; i < answers.length; i++)
    for (let j = i + 1; j < answers.length; j++)
      if ((await same(answers[i], answers[j])) === true) agrees[i] = agrees[j] = true;
  const idx = agrees.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  return { idx, none: !idx.length };
}

// the standards of these questions, worked out once and kept: a question is worked out again when it has more answers than it
// had, or another reader reads now (by). same(t, a, b) -> true | false | null
export async function standardsFor({ list, answers, same, file, by = '' }) {
  let kept = { by, standards: {} };
  try {
    const was = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (was && was.by === by && was.standards) kept = was;
  } catch {
    /* none kept */
  }
  const out = new Map();
  let worked = 0;
  for (const t of list) {
    const mine = answers.get(t.id) || [];
    let s = kept.standards[t.id];
    if (!s || s.of !== mine.length) {
      const r = await standardOf(mine, (a, b) => same(t, a, b));
      s = { of: mine.length, idx: r.idx, none: r.none };
      kept.standards[t.id] = s;
      worked++;
    }
    out.set(t.id, { answers: s.idx.map((i) => mine[i]).filter((x) => x !== undefined), none: !!s.none });
  }
  if (worked && file)
    fs.writeFileSync(file, JSON.stringify({ ...kept, by, at: new Date().toISOString() }, null, 1) + '\n');
  out.worked = worked;
  return out;
}

// a reply against a question's standard: good when it is equivalent to one of the standard's answers; otherwise the nearest of
// them says how it fell short (its reading, the part it was lost on)
export async function againstStandard(t, standard, reply, ctx = {}) {
  let best = null;
  for (const a of standard.answers) {
    const g = await t.equivalent(a, reply, { ...ctx, atLine: true });
    if (g.grade === 'right') return { ...g, of: standard.answers.length };
    if (g.grade === 'noref') continue;
    if (!best || (typeof g.p === 'number' ? g.p : -1) > (typeof best.p === 'number' ? best.p : -1)) best = g;
  }
  return best ? { ...best, of: standard.answers.length } : { grade: 'noref' };
}
