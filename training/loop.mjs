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
//   4  best first, until parity: changes are tried from the closest arrangement open, and one that comes closer (with partial
//      credit: of code, more of the inputs right) is built on at once. Only when no arrangement open has a change left is the
//      question written down as not reached, and the loop moves on
// HOW it searches (the order, what is left out, how far it goes before it builds on what came closer) is a policy, not code
// (training/loop-policy.mjs). Every few questions that needed a change the larger model is shown the loop's record and proposes a
// change to it; the change is tried, and kept only where the search did at least as well. The policy is carried from pass to
// pass (.work/train/<configuration>/loop-policy.json), so the search goes on improving.
// What is tried is the plan's (training/plan.mjs: its order, and what a person pinned or skipped on the page); what the loop adds
// is WHEN: for the question in hand, by where that question was lost. The small models are never shown the larger model's answer:
// only the grading is. What is kept is what the spec is made of (src/learned), and a swarm built from it has no larger model beside it.
// With `--cap` or `--drop` set, a question is left after that many changes, and a change tried on that many questions with no parity is left out.
//   node training/loop.mjs --each 6            the train questions, one at a time
//   node training/loop.mjs --beam 3 --guard 6  closer arrangements kept open; questions asked again before a change is kept
//   node training/loop.mjs --pool              what could be tried from here, by area; nothing is asked
//   node training/loop.mjs --explain           what would be tried first on each question the last loop did not reach
// It carries on where it stopped: every finished question is written down (.work/train/<configuration>/loop.json).
import fs from 'node:fs';
import path from 'node:path';
import { decideByOf, classOf as inputClassOf, briefsFor, KIND_PARTS } from '../src/orchestrate.mjs';
import {
  normal as normalPolicy,
  reviewAsk,
  proposalOf,
  recordOf,
  verdictOf,
  suggestAsk,
  suggestionsOf,
} from './loop-policy.mjs';

// WHERE A QUESTION'S ANSWER WAS LOST, from its row once every slot's answer is marked (measure.mjs slotReport writes `same`):
//   writing    it was settled, and the writer's reply no longer said it
//   choosing   a drafter or a checker had it, and it was not what was settled
//   drafting   no slot had it
export function lostAt(row) {
  const tr = row.trace || [];
  // (a writer that described the answer instead of giving it lost it in writing, whatever the reply was marked: src/read.mjs)
  if (tr.some((s) => s.stage === 'write' && (s.same === false || s.describes))) return 'writing';
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
  if (m.area === 'library') return 'a found arrangement';
  if (m.area === 'suggested') return 'a suggestion of the larger model';
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
  const described = tr.some((s) => s.stage === 'write' && s.describes);
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
  // the drafts were run in the sandbox and more than one behaviour stood (the try step's own row, or the drafts' behaviours)
  const ranApart =
    tr.some((s) => s.stage === 'run' && (s.behaviours || 0) > 1) ||
    new Set(tr.filter((s) => s.does).map((s) => s.does)).size > 1;
  // the slot a change is to: named on a brief, or the first word of an arrangement's name ("c-direct with a token limit of 1100")
  const slotOf = (m) => m.slot || ((m.name || '').split(' ')[0] in slots ? (m.name || '').split(' ')[0] : '');
  // -> [priority, the reason in words]: what the record says about this change, said where it is shown being tried
  // A THIN REPLY: not code, and less than half as long as the larger model's (the answer there, the reason and what to do gone)
  const wordsIn = (x) =>
    String(x || '')
      .split(/\s+/)
      .filter(Boolean).length;
  const thin =
    !!row.refReply &&
    !/```/.test(String(row.refReply)) &&
    wordsIn(row.reply || row.decided) * 2 < wordsIn(row.refReply);
  const judged = (m) => {
    const n = m.name || '';
    const sl = slotOf(m);
    if (thin && /writes the reply in full/.test(n))
      return [
        0,
        "the reply is less than half as long as the larger model's (" +
          wordsIn(row.reply || row.decided) +
          ' words against ' +
          wordsIn(row.refReply) +
          '): this writes it in full',
      ];
    if (lost === 'writing') {
      // (what went wrong at the writer: it changed the settled answer, or it described the answer instead of giving it)
      const what = described
        ? 'the writer described the answer instead of giving it'
        : 'the writer changed a settled answer';
      return /settled answer goes out as it is/.test(n)
        ? [0, what + ': this hands it over as it is']
        : m.stage === 'write'
          ? [1, what + ': this changes the writer']
          : [3, ''];
    }
    // WHERE THE DRAFTS WERE RUN AND DO DIFFERENT THINGS, the swarm can tell which is right from the question alone: one slot says
    // what each call should give, the answer that gives it is backed, and the revisions are shown the count (orchestrate.mjs
    // expect). Aimed at the mistake itself, where more drafts or more room only draw again. (The larger model's own behaviour is
    // never what the swarm is shown: it is the mark, and a swarm built from the spec has no larger model beside it)
    if (/say what each call should give/.test(n) && ranApart)
      return [
        0,
        'the drafts were run and do different things: this says, from the question alone, what each call should give',
      ];
    if (lost === 'choosing') {
      const w = (n.match(/^plan: decide by (.+)$/) || [])[1];
      if (w && ways && ways[w])
        return [0, "replayed on this answer's own record, deciding this way picks the right draft"];
      if (/^plan: a model settles it where the decider is close/.test(n) && decided && decided.close)
        return [1, 'the decider was close to the right draft'];
      if (/^plan: a model settles it where the decider parts from most/.test(n) && row.path === 'decided-against-most')
        return [1, 'the decider overruled most of the drafts'];
      if (/^plan: a model|keep the likeliest|settle it if the decider|onePerAnswer true/.test(n))
        return [2, 'a slot had the answer and it was not chosen: this changes how it is chosen'];
      return [3, ''];
    }
    if (sl && capped.has(sl) && /token limit/.test(n)) return [0, sl + ' was cut off at its token limit'];
    if (
      /temperature|^add a .* on |the answers go back|check and revise/.test(n) &&
      (!sl || (slots[sl] || {}).stage === 'draft')
    )
      return [1, 'no slot had the answer: this makes other drafts'];
    if (m.kind === 'brief' && m.stage === 'draft') return [2, 'no slot had the answer: another brief for a drafter'];
    return [3, ''];
  };
  const prio = (m) => judged(m)[0];
  const because = (m) => judged(m)[1];
  // what the record itself rules out (skipRecord), and with it what the default policy leaves out (skip: how the matter is decided,
  // where no slot had the answer). The loop applies its own policy over skipRecord (tuned), so that a policy can turn that off
  const skipRecord = (m) => {
    const n = m.name || '';
    if (lost === 'choosing') {
      const w = (n.match(/^plan: decide by (.+)$/) || [])[1];
      if (w && (w === now || (ways && !ways[w]))) return true;
      return m.kind === 'brief' && had.has(slotOf(m));
    }
    return false;
  };
  const skip = (m) => skipRecord(m) || (lost === 'drafting' && CHOOSING_ONLY.test(m.name || ''));
  return { lost, failed, prio, skip, skipRecord, because };
}
// the train questions whose mark the larger model did not give again (baseline.mjs --self --split train writes them), for these
// questions only (the seed they were drawn with): a record for other questions says nothing about these
export function unstableOf(file, seed) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(r.seed === seed && Array.isArray(r.disagreed) ? r.disagreed : []);
  } catch {
    return new Set();
  }
}
// HOW CLOSE A ROW CAME TO PARITY, as one number to compare: the answer lost later in the flow (writing beats choosing beats
// drafting), then more slots holding the larger model's answer, then more of the decider's probability on that answer, then (with
// partial credit) how near the nearest answer came: of code, the share of inputs on which it gives what the larger model's gives;
// of words, the reader's probability. Without that last, a question no slot drafts reads the same after every change, and the
// search has nothing to build on (measured 2026-11-16: 99 tries on one question, every one "0 slots had the answer")
const sharesOf = (row) =>
  (row.trace || [])
    .filter((s) => (s.stage === 'draft' || s.stage === 'check' || s.stage === 'revise') && typeof s.share === 'number')
    .map((s) => s.share);
const bestShare = (row) => {
  const xs = sharesOf(row);
  return xs.length ? Math.max(...xs) : null;
};
// AND HOW NEAR THEY ALL CAME: the mean share over every slot's answer. Two arrangements whose nearest answer is as near read the same
// by the best alone, and the search had nothing to climb (measured 2026-11-17: 44 tries in a row on one code question, none
// closer); one where more of the drafts behave like the larger model's on more inputs is now the closer, by a fraction under 1
const meanShare = (row) => {
  const xs = sharesOf(row);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
export function closeness(row, ev = null, { partial = false } = {}) {
  const lost = (ev && ev.lost) || lostAt(row);
  const tr = row.trace || [];
  const holders = tr.filter(
    (s) => (s.stage === 'draft' || s.stage === 'check' || s.stage === 'revise') && s.same === true,
  );
  const decided = tr.find((s) => s.stage === 'decide' && s.probs && (s.slot === 'decide' || s.slot === 'kev-decide'));
  const p = decided ? Math.max(0, ...holders.map((s) => decided.probs[s.letter] || 0)) : 0;
  const share = partial ? bestShare(row) || 0 : 0;
  return (
    { drafting: 0, choosing: 1, writing: 2 }[lost] * 1000 +
    Math.min(9, holders.length) * 100 +
    Math.round(p * 9) * 10 +
    Math.round(share * 9) +
    (partial ? Math.round((meanShare(row) || 0) * 99) / 100 : 0)
  );
}
// the same, in parts a person can read: where the answer was lost, how many slots had it (which), the decider's probability on
// it, and how near the nearest answer came
export function nearOf(row, ev = null) {
  const lost = (ev && ev.lost) || lostAt(row);
  const tr = row.trace || [];
  const holders = tr.filter(
    (s) => (s.stage === 'draft' || s.stage === 'check' || s.stage === 'revise') && s.same === true,
  );
  const decided = tr.find((s) => s.stage === 'decide' && s.probs && (s.slot === 'decide' || s.slot === 'kev-decide'));
  const p = decided ? Math.max(0, ...holders.map((s) => decided.probs[s.letter] || 0)) : null;
  const slots = [...new Set(holders.map((s) => s.slot).filter(Boolean))].slice(0, 8);
  const share = bestShare(row);
  const mean = meanShare(row);
  return {
    lost,
    had: holders.length,
    ...(slots.length ? { slots } : {}),
    ...(p == null ? {} : { p: Math.round(p * 100) / 100 }),
    ...(share == null ? {} : { share: Math.round(share * 100) / 100 }),
    ...(mean == null ? {} : { mean: Math.round(mean * 100) / 100 }),
    ...(row.path ? { path: String(row.path).slice(0, 60) } : {}),
  };
}
// LIKE A CHANGE KEPT RECENTLY: it names a slot a kept change acted on, or most of its words are the kept change's. What worked is
// where the next question starts looking (a slot moved to c brought a question to parity: moving its sibling to c, or giving it
// a second drafter there, comes before a brief no question has been brought to parity by)
const wordsOf = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/^several: /, '')
    .split(/[^\w-]+/)
    .filter(Boolean);
export function likeKept(m, recent = []) {
  const w = new Set(wordsOf(m.name));
  for (const k of [...recent].reverse()) {
    if ((k.slots || []).some((s) => w.has(String(s).toLowerCase()))) return k;
    const kw = new Set(wordsOf(k.what));
    const both = [...w].filter((x) => kw.has(x)).length;
    if (both && both / new Set([...w, ...kw]).size >= 0.5) return k;
  }
  return null;
}
// the policy's own say on what cannot help where the answer was lost: the writer, unless it was lost in the writing; how the
// matter is decided, unless a slot had the answer and it was not chosen
export function tuned(ev, briefs = {}, policy = normalPolicy({})) {
  const slots = Object.fromEntries((briefs.slots || []).map((s) => [s.id, s]));
  const slotOf = (m) =>
    m.slot ||
    ((m.name || '').replace(/^move /, '').split(' ')[0] in slots
      ? (m.name || '').replace(/^move /, '').split(' ')[0]
      : '');
  const base = ev.skipRecord || ev.skip || (() => false);
  return {
    ...ev,
    skip: (m) => {
      if (base(m)) return true;
      const sl = slotOf(m);
      if (
        policy.skipWriterUnlessWriting &&
        ev.lost !== 'writing' &&
        (m.stage === 'write' || (sl && (slots[sl] || {}).stage === 'write'))
      )
        return true;
      if (policy.skipDecidingUnlessChoosing && ev.lost !== 'choosing' && CHOOSING_ONLY.test(m.name || '')) return true;
      return false;
    },
  };
}
// WHY A CHANGE IS TRIED WHERE IT IS, in words: each thing that put it at its place in the order (orderFor's ranking, said)
export function reasonsOf(
  m,
  ev = {},
  { moves = {}, classes = {}, pin = [], policy = normalPolicy({}), recent = [] } = {},
) {
  const out = [];
  if (pin.includes(m.id)) out.push('pinned on the page');
  const b = ev.because ? ev.because(m) : '';
  if (b) out.push(b);
  const like = policy.momentumRecent ? likeKept(m, recent.slice(-policy.momentumRecent)) : null;
  if (like) out.push('like the change kept for ' + ((like.question || {}).id || 'a question') + ' (' + like.what + ')');
  const lost = ev.lost || 'drafting';
  const a = (policy.areas[lost] || policy.areas.drafting).indexOf(m.area);
  if (a >= 0)
    out.push((a === 0 ? 'the first area' : 'area ' + (a + 1)) + ' for an answer lost in ' + lost + ' (' + m.area + ')');
  const c = classes[classOf(m)];
  out.push(
    c && c.tried
      ? classOf(m) +
          ' has reached parity ' +
          c.reached +
          ' of ' +
          c.tried +
          ' times' +
          (c.tried < policy.learnedMinTried ? ' (too few to count yet)' : '')
      : classOf(m) + ': not tried before, so untested',
  );
  const t = (moves[m.key] || {}).tried || 0;
  out.push(
    t ? 'this change tried on ' + t + ' question' + (t === 1 ? '' : 's') + ' before' : 'this change never tried before',
  );
  return out;
}
// how well a kind of change has done: the mean of a Beta(1, 1) on what it reached against what it was tried on
const rate = (c) => ((c ? c.reached : 0) + 1) / ((c ? c.tried : 0) + 2);
// what a kind of change adds to a run, in steps of 5 seconds (finer is noise): an untimed kind counts as adding nothing
export const costOf = (c) => (c && c.timed ? Math.round(c.secs / c.timed / 5) : 0);
// seconds a try takes: the median of the last few
const paceOf = (xs = []) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
// WHAT IS TRIED ON THIS QUESTION, IN ORDER, as the policy ranks it (loop-policy.mjs `order`): by default what a person pinned; what
// this question's own record says will help (evidenceOf); what is like a change kept recently; the kinds of change that have
// reached parity most often (once tried enough to count); the area of change for where its answer was lost; what makes runs
// slower last; what has been tried least; the plan's own order. A change the record or the policy rules out, or one dropped after
// `drop` questions with no parity, is not in the order at all.
export function orderFor(
  pool,
  {
    lost = 'drafting',
    prio = () => 3,
    skip = () => false,
    moves = {},
    classes = {},
    pin = [],
    drop = 6,
    policy = normalPolicy({}),
    recent = [],
  } = {},
) {
  const areas = policy.areas[lost] || policy.areas.drafting;
  const near = (m) => (policy.momentumRecent ? likeKept(m, recent.slice(-policy.momentumRecent)) : null);
  const KEY = {
    pin: (m) => (pin.includes(m.id) ? pin.indexOf(m.id) : 1e6),
    evidence: (m) => prio(m),
    momentum: (m) => (near(m) ? 0 : 1),
    learned: (m) => {
      const c = classes[classOf(m)];
      return c && c.tried >= policy.learnedMinTried ? -rate(c) : -0.5;
    },
    area: (m) => {
      const a = areas.indexOf(m.area);
      return a < 0 ? areas.length : a;
    },
    cost: (m) => costOf(classes[classOf(m)]),
    fresh: (m) => (moves[m.key] || {}).tried || 0,
    plan: (m) => m.order ?? 1e6,
  };
  const rank = (m) => policy.order.map((k) => KEY[k](m));
  const sorted = pool
    .filter((m) => !skip(m) && !((moves[m.key] || {}).tried >= drop && !(moves[m.key] || {}).reached))
    .map((m) => [m, rank(m)])
    .sort((x, y) => {
      for (let i = 0; i < x[1].length; i++) if (x[1][i] !== y[1][i]) return x[1][i] - y[1][i];
      return 0;
    })
    .map(([m]) => m);
  // ONE OF EACH IDEA BEFORE A SECOND OF ANY (what the record says will help, and what is like a kept change, are never held
  // back): the same flow change at six places, or one more drafter on each of three models, would otherwise spend a question's
  // tries on one idea
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
    if (prio(m) === 0 || near(m) || !seen.has(idea(m))) {
      seen.add(idea(m));
      first.push(m);
    } else later.push(m);
  }
  return [...first, ...later];
}
// the questions already at parity that a change is asked again on before it is kept: the same kind first, then the latest
// and of those, first the questions changes have lost most often: a change that is going to lose one loses it on its first check,
// not its third (measured 2026-11-16: 23 of 26 changes that reached parity on one question lost the same other one, asked third,
// so each failure cost three runs)
// NO KIND IS TRAINED ON NOTHING WITHOUT SAYING SO (docs/swoa-classes.md, coverage). Before a pass trains, each spec kind
// in it is counted: how many of its questions can be compared with the larger model at all, which needs the larger model's answer
// and, for an answer in words or a reply in a conversation, a reader whose check is believed (training/readers.mjs). A kind with
// none is not trained, and before this it was not said: on 2026-11-18 Kev 0.8B failed its check and 42 questions of 7 kinds were
// "not compared" for a whole pass. Per kind and not per class, because a class can be partly compared (trace and agent were).
//   coverageOf(list, { ref: Map of the larger model's answers, readerOk: (type) -> bool })
//     -> [{ kind, n, compared, why }] in the order the kinds first appear; why says what is missing where compared is 0
export function coverageOf(list, { ref = new Map(), readerOk = () => true } = {}) {
  const by = new Map();
  for (const t of list || []) {
    const k = by.get(t.kind) || { kind: t.kind, n: 0, compared: 0, noRef: 0, noReader: 0, type: t.type };
    k.n++;
    const hasRef = ref && ref.get(t.id) !== undefined;
    const needsReader = t.type === 'open' || t.type === 'talk';
    if (!hasRef) k.noRef++;
    else if (needsReader && !readerOk(t.type)) k.noReader++;
    else k.compared++;
    by.set(t.kind, k);
  }
  return [...by.values()].map(({ kind, n, compared, noRef, noReader, type }) => ({
    kind,
    n,
    compared,
    why: compared
      ? ''
      : noReader >= noRef
        ? 'the reader of ' + (type === 'talk' ? 'replies in a conversation' : 'answers in words') + ' is not believed'
        : 'the larger model has not answered them',
  }));
}

// A RESUMED PASS ASKS AGAIN WHAT IT COULD NOT COMPARE BEFORE (found 2026-11-18): a pass carried on from its record keeps every
// question's state, and "not compared" counts as finished. A question set down as not compared because its reader was not
// believed (Kev 0.8B, 15 of 20) stayed so after a judge that passes its check (Jeffan 4B) was chosen and the pass started again:
// the coverage gate found all 84 comparable while 42 of them were never asked. So, on carrying on, a not-compared question that
// can be compared now (the larger model answered it, and its reader is believed) is taken off the record, and asked again.
//   reopenComparable(st, list, comparable: (t) -> bool) -> the ids taken off (st is changed in place)
export function reopenComparable(st, list, comparable) {
  if (!st || !Array.isArray(st.questions)) return [];
  const byId = new Map((list || []).map((t) => [t.id, t]));
  const ids = st.questions
    .filter((q) => q.state === 'not compared' && byId.has(q.id) && comparable(byId.get(q.id)))
    .map((q) => q.id);
  if (!ids.length) return [];
  const gone = new Set(ids);
  st.questions = st.questions.filter((q) => !gone.has(q.id));
  if (Array.isArray(st.rows)) st.rows = st.rows.filter((r) => !gone.has(r.id));
  if (st.inHand && gone.has(st.inHand.id)) st.inHand = null;
  return ids;
}

// A BRIEF MAY NOT QUOTE ITS OWN QUESTION (docs/swoa-classes.md, step 4): what is particular to the question a change was found on
// (a name it gives, a number, a quoted string), beyond what its class's other questions share, has no place in what a slot is told
// for every question of the class. Found 2026-11-18: "When the distance from the lower multiple is exactly half the step ... round up"
// drafted every question asked in words, because it brought one rounding question to parity.
//   specificTokens(t, others) -> the tokens particular to question t (others: the other questions of its class)
//   quotesQuestion(newBriefs, oldBriefs, tokens) -> the first token a brief that changed now carries, or ''
const textOfQ = (t) =>
  String(t.ask || '') +
  ' ' +
  (t.turns || [])
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join(' ');
export function specificTokens(t, others = []) {
  const grab = (text) => {
    const out = new Set();
    for (const m of text.matchAll(/`([^`\n]{2,40})`/g)) out.add(m[1].trim());
    for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g)) out.add(m[1]);
    for (const m of text.matchAll(/(?:^|[^\w.])(-?\d+(?:\.\d+)?)(?![\w.])/g))
      if (Math.abs(Number(m[1])) > 10 || /[.-]/.test(m[1])) out.add(m[1]);
    // a quoted phrase, but not a common word in quotes ('all', "are": refused the larger model's briefs that used the word in its
    // plain sense, measured 2026-11-18) and not the stretch between two apostrophes ("doesn't ... they're"): it counts when it is
    // more than one word, or carries a digit or a sign, or is a single word of 6 letters or more
    for (const m of text.matchAll(/(?:["“]([^"”\n]{3,40})["”]|(?<![A-Za-z])'([^'\n]{3,40})'(?![A-Za-z]))/g)) {
      const p = (m[1] || m[2]).trim();
      if (/\s/.test(p) || /[^A-Za-z]/.test(p) || p.length >= 6) out.add(p);
    }
    return out;
  };
  const mine = grab(textOfQ(t));
  const common = new Set();
  for (const o of others) for (const x of grab(textOfQ(o))) common.add(x);
  return [...mine].filter((x) => x && !common.has(x));
}
export function quotesQuestion(newBriefs, oldBriefs, tokens = []) {
  if (!tokens.length) return '';
  const was = new Map(((oldBriefs && oldBriefs.slots) || []).map((x) => [x.id, x.brief]));
  const told = ((newBriefs && newBriefs.slots) || [])
    .filter((x) => x.brief && x.brief !== was.get(x.id))
    .map((x) => x.brief);
  for (const tok of tokens) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^\\w])' + esc + '($|[^\\w])');
    if (told.some((b) => re.test(b))) return tok;
  }
  return '';
}

export function guardOf(reached, t, n, lost = {}, pairs = {}) {
  const same = reached.filter((r) => r.t.kind === t.kind).reverse();
  const rest = reached.filter((r) => r.t.kind !== t.kind).reverse();
  // (the one THIS question's changes have broken most comes first, then the one changes have lost most: a change that will be
  // turned down is turned down on its first check. Ranked by losses overall alone, a question another question had broken eleven
  // times was asked first on every try, and passed, before the one that was failing every time)
  const pairOf = (r) => pairs[t.id + '>' + r.t.id] || 0;
  return [...same, ...rest]
    .map((r, k) => ({ r, k }))
    .sort((x, y) => pairOf(y.r) - pairOf(x.r) || (lost[y.r.t.id] || 0) - (lost[x.r.t.id] || 0) || x.k - y.k)
    .map((x) => x.r)
    .slice(0, n);
}

// THE LIBRARY OF FOUND ARRANGEMENTS: every arrangement that brought a question to parity and lost none already there, kept across
// passes and across Clear training state (.work/library/<configuration>.json). Each question short of parity tries them first,
// the ones that have brought the most questions to parity before the rest: what worked is the likeliest secret to the next.
//   [{ names: [change names, in the order applied], what, from: { question, pass }, reached: [question ids], tried }]
export function rankLibrary(lib = []) {
  return lib
    .map((e, k) => ({ e, k }))
    .sort((x, y) => (y.e.reached || []).length - (x.e.reached || []).length || y.k - x.k)
    .map((x) => x.e);
}
// an arrangement of the library applied on top of the swarm as it stands: each change found by its name among those open from
// there, in order. What cannot be found (already part of it, or no longer offered) is passed over; nothing found, nothing to try
export function applyNames(poolOf, briefs, names = []) {
  let base = briefs;
  const used = [];
  for (const n of names) {
    const m = poolOf(base).find((x) => x.name === n);
    if (!m) continue;
    base = m.briefs;
    used.push(n);
  }
  return used.length ? { briefs: base, names: used } : null;
}
// a library entry for what was just kept, or the one it repeats: one entry for each set of changes
export function addToLibrary(lib, names, from) {
  const key = [...names].sort().join(' + ');
  const had = lib.find((e) => [...e.names].sort().join(' + ') === key);
  if (had) {
    if (!had.reached.includes(from.question)) had.reached.push(from.question);
    return had;
  }
  const e = {
    names: [...names],
    what: names.length > 1 ? 'several: ' + names.join(' + ') : names[0],
    from,
    reached: [from.question],
    tried: 0,
  };
  lib.push(e);
  return e;
}

// THE LOOP, over anything that can answer and be graded (the trainer below hands it the swarm; the checks hand it a made-up one):
//   attempt(briefs, t, note) -> a graded row { grade: 'right' | 'wrong' | 'unsure' | 'noref', trace, seconds?, ... }
//   lostOf(row, briefs)      -> evidenceOf(row, briefs): where it was lost, and what its record says will help
//   poolOf(briefs)           -> [{ id, key, name, area, slot, stage, order, briefs }]   every change open from this arrangement
//   keep(briefs, entry)      the change is kept: written down as what the swarm now is
//   onQuestion(q, row, st)   a question is finished (st: what the loop holds, to be written down and carried on from)
//   policy                   how it searches (loop-policy.mjs), held in st.policy and changed as it goes
//   review(prompt) -> text   the larger model, asked to review the search and propose a policy (null: the policy is not reviewed)
//   onPolicy(policy, event)  the policy changed, or a trial ended: written down
//   library, onLibrary(lib)  the arrangements found so far (tried first on every question), and where to write it as it grows
// A QUESTION IS NOT LEFT SHORT OF PARITY. The loop moves on only when the question in hand is at parity (or `cap`, a bound only a
// person sets, runs out). Where every arrangement open has been tried, the search widens: what the beam closed is opened again,
// then every arrangement tried on the question is built on. A mark the larger model did not give again is searched the same way.
// THE MARKS THE QUESTIONS THEMSELVES PROVE WRONG: a question of code is made with its correct solution (training/tasks-code.mjs
// ok) and the inputs it is tried on; where the larger model's answer does not give what that solution gives on every one, the mark
// is wrong. Measured 2026-11-17: Nemotron 3.5 Lightning 30B wrong on 7 of a pass's 30 code questions (toSeconds("5m") 0, wanted
// 300), and 3 of the 5 changes one run kept were won on them, the swarm taught the larger model's mistakes.
// -> Map(id -> { share, input, theirs, wanted }) for those questions
// A DEGENERATE REPLY: one that is mostly the same few characters over and over (measured 2026-11-18: the 30B answered "What is in
// the docs folder?" with one three-character phrase repeated to its token limit). Of a reply's four-character pieces, fewer than one
// in ten different, over at least sixty characters
export function degenerate(text) {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 60) return false;
  const seen = new Set();
  for (let i = 0; i + 4 <= s.length; i++) seen.add(s.slice(i, i + 4));
  return seen.size < 0.1 * (s.length - 3);
}
export async function wrongMarksOf(list, ref, equivalent = null) {
  const eq = equivalent || (await import('./support/equivalent.mjs')).codeEquivalent;
  const out = new Map();
  for (const t of list) {
    const reply = ref && (ref.get ? ref.get(t.id) : ref[t.id]);
    // (a degenerate mark is no answer to be equivalent to, whatever the question)
    if (reply && degenerate(reply)) {
      out.set(t.id, { share: 0, degenerate: true });
      continue;
    }
    // A QUESTION MADE WITH ITS ANSWER (training/tasks.mjs: what a short program prints, a count, a figure read out of a passage)
    // grades the mark with its own grader: where the larger model's reply is not that answer, the mark is wrong (measured
    // 2026-11-18: trace-5 prints 7, the swarm said 7, and the larger model's reply opened with 13 and ended on 5; it was searched
    // 61 times for a parity that meant copying the mistake)
    if (reply && t.want !== undefined && typeof t.grade === 'function') {
      try {
        if ((await t.grade(reply)) === 'wrong') out.set(t.id, { share: 0, wanted: String(t.want) });
      } catch {
        /* its grader could not read it: the mark stands */
      }
      continue;
    }
    if (!t.ok || !t.name || !Array.isArray(t.inputs) || !reply) continue;
    try {
      const g = await eq('```js\n' + t.ok + '\n```', reply, { name: t.name, inputs: t.inputs });
      if (g.grade === 'wrong' || g.grade === 'unsure')
        out.set(t.id, {
          share: g.share ?? 0,
          ...(g.input ? { input: g.input, theirs: g.ours, wanted: g.theirs } : {}),
        });
    } catch {
      /* nothing could be run here: the mark stands */
    }
  }
  return out;
}
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
  beam,
  unstable = new Set(),
  // the questions whose mark the question's own correct solution proves wrong (wrongMarksOf): answered once and set aside, never
  // searched, and never a question a change must not lose
  wrongMarks = new Map(),
  policy = {},
  policyLog = [],
  trial = null,
  review = null,
  onPolicy = async () => {},
  library = [],
  onLibrary = async () => {},
  // THE HELD GUARD (docs/swoa-classes.md, step 4): held questions, with the larger model's answers, a change must not lose before it
  // is kept: up to heldGuard of its own class, in their order. Used only to accept a change, never to find one
  heldQs = [],
  heldGuard = 4,
  // the larger model writing new briefs for a slot that failed on this question: teach(slot, missed) -> [{ name, brief }], written
  // where the pool reads candidates (null: never)
  teach = null,
  // a question beyond rearranging (adaptAfter tries, the larger model's briefs among them): onBeyond(q, t) makes the next lever ready
  onBeyond = async () => {},
  // after every try on a question still in hand: st, with st.inHand (where its search stands), to be written down so that a stopped
  // run carries on from that try instead of searching the question again from its first
  onTry = async () => {},
}) {
  const st = resume || { questions: [], rows: [], moves: {}, kept: [] };
  st.classes = st.classes || JSON.parse(JSON.stringify(classes || {}));
  st.policy = normalPolicy({ ...(st.policy || policy || {}), ...(beam !== undefined ? { beam } : {}) });
  st.policyLog = st.policyLog || [...policyLog];
  st.library = st.library || JSON.parse(JSON.stringify(library || []));
  st.tryN = st.tryN || 0;
  st.tryLog = st.tryLog || [];
  st.reopen = st.reopen || [];
  st.pairs = st.pairs || {};
  st.swapped = st.swapped || {};
  // a trial carried from before (a pass that ended, or Clear training state, with a proposal still on trial): it starts again here
  if (!st.trial && trial && trial.from && trial.taken)
    st.trial = { from: normalPolicy(trial.from), taken: trial.taken, startTry: st.tryN, before: [] };
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const doneIds = () =>
    new Set(st.questions.filter((q) => q.state !== 'reopened' && q.state !== 'set aside').map((q) => q.id));
  // (a question finished before its mark was found wrong keeps its record, flagged: it is no longer one a change must not lose)
  for (const q of st.questions) if (wrongMarks.has(q.id) && !q.markWrong) q.markWrong = wrongMarks.get(q.id);
  const reached = st.questions
    .filter((q) => q.reached && !wrongMarks.has(q.id))
    .map((q) => ({ t: byId[q.id], row: st.rows.find((r) => r.id === q.id) }))
    .filter((r) => r.t && r.row);
  // every try counted, for the policy: what came of it (kept 10, at parity but lost one already there 3, closer 1, nothing 0)
  const counted = (kind) => {
    st.tryN++;
    st.tryLog.push({ n: st.tryN, s: { kept: 10, parity: 3, closer: 1 }[kind] || 0 });
    if (st.tryLog.length > 1200) st.tryLog.splice(0, st.tryLog.length - 1200);
  };
  // THE CLASS OF A QUESTION (tools, talk, code or words: what the running swarm itself tells from the request, src/orchestrate.mjs
  // classOf, given the same messages and tools the question is asked with), and the arrangement a question of that class is asked
  // with: its own (briefs.kinds[class]) where one was kept, else the shared one
  const kindOfT = (t) => inputClassOf(t.turns || [{ role: 'user', content: t.ask }], { tools: t.tools });
  const flat = (b, k) => briefsFor(b, '', k);
  const ownOf = (nb) => Object.fromEntries(KIND_PARTS.map((p) => [p, nb[p] === undefined ? null : nb[p]]));
  // the arrangement a change made for a question of class k, folded back: ALWAYS into that class's own arrangement (made the first
  // time from the shared one), never into the shared one, which every class with none of its own runs (docs/swoa-classes.md, step
  // 3). Before, a change went into the shared arrangement unless it lost a question of another class: so briefs written for one code
  // question drafted every essay
  // (what a change sets outside a class's parts, its slots, plan and flow, belongs to every class and goes where it always did, to
  // the shared arrangement: the pool of worked examples, the marker)
  const fold = (nb, k, base) => {
    const out = { ...base };
    for (const key of Object.keys(nb))
      if (!KIND_PARTS.includes(key) && key !== 'kinds' && key !== 'version') out[key] = nb[key];
    return { ...out, kinds: { ...(base.kinds || {}), [k]: ownOf(nb) } };
  };
  // whether a change to the arrangement of kind k can change how a question of kind k2 is answered: both on the same arrangement
  const shares = (b, k, k2) => k === k2 || (!(b.kinds && b.kinds[k]) && !(b.kinds && b.kinds[k2]));
  // THE NEXT QUESTION: one sent back in hand; else the next not yet finished; else one SET ASIDE (it stopped coming closer while others
  // waited), first one the arrangement has changed since, and last one it has not, which gets as many tries again (givenUp)
  const asideOf = () => st.questions.filter((x) => x.state === 'set aside');
  for (;;) {
    const done = doneIds();
    const aside0 = asideOf();
    let t = st.reopen.length
      ? byId[st.reopen.shift()]
      : list.find((x) => !done.has(x.id) && !aside0.some((a) => a.id === x.id));
    let lastChance = false;
    if (!t && aside0.length) {
      const changed = aside0.find((a) => (a.asideAt || 0) < (briefs.version || 1));
      t = byId[(changed || aside0[0]).id];
      lastChance = !changed;
    }
    if (!t) break;
    let pol = st.policy;
    const K = kindOfT(t);
    const eb = flat(briefs, K);
    // what is particular to this question among its class's (specificTokens): a change whose briefs carry it is refused, untried
    const specific = specificTokens(
      t,
      list.filter((x) => x.id !== t.id && kindOfT(x) === K),
    );
    const n = st.questions.filter((x) => x.state !== 'reopened' && x.state !== 'set aside' && x.id !== t.id).length + 1;
    let row = await attempt(eb, t, { n, of: list.length, attempt: 0, cap, move: '' });
    const was = st.questions.find((x) => x.id === t.id);
    const q = {
      id: t.id,
      kind: t.kind,
      asked: K,
      attempts: [{ move: '', grade: row.grade, ...(row.seconds ? { seconds: row.seconds } : {}) }],
      ...(unstable.has(t.id) ? { unstable: true } : {}),
      ...(st.trial ? { onTrial: true } : {}),
      ...(was ? { again: (was.again || 0) + 1, lostTo: was.lostTo } : {}),
      ...(was && was.state === 'set aside' ? { setAside: (was.setAside || 0) + 1 } : {}),
    };
    // A STOPPED RUN CARRIES ON FROM ITS LAST TRY: where this question's search was written down on the same arrangement
    const carry = st.inHand && st.inHand.id === t.id && st.inHand.version === (briefs.version || 1) ? st.inHand : null;
    st.inHand = null;
    // A MARK PROVED WRONG: the larger model's answer does not do what the question asks (its own correct solution says so, input
    // by input). Parity there would teach the swarm the larger model's mistake: it is answered, written down, and not searched
    if (wrongMarks.has(t.id)) {
      q.state = 'mark wrong';
      q.markWrong = wrongMarks.get(t.id);
    } else if (row.grade === 'noref') {
      q.state = 'not compared';
      // (and why: the larger model gave nothing to compare with, or the reader of its kind failed its own check this pass)
      if (row.why) q.why = row.why;
    } else if (row.grade === 'right') q.state = 'at parity';
    else {
      const ev0 = tuned(await lostOf(row, eb), eb, pol);
      const lost = ev0.lost;
      q.lostAt = lost;
      const score = (r, ev) => closeness(r, ev, { partial: pol.partialCredit });
      const node0 = (over) => ({ tried: new Set(), spent: false, ...over });
      // WHEN THE QUESTIONS A CHANGE LOSES ARE SWAPPED (kept, and they go back in hand): one question lost `swapAfter` times; or, where
      // every question this one's changes have broken is among the same few (`stableMax` at most: a standing conflict, repairs aimed at
      // it having failed), those losses together reaching `stableAfter`. One already swapped for this question is never swapped back
      const swapOk = (ids) => {
        if (!ids.length || ids.some((id) => st.swapped[id + '>' + t.id])) return false;
        const lostOf_ = (id) => st.pairs[t.id + '>' + id] || 0;
        if (ids.length === 1 && pol.swapAfter > 0 && lostOf_(ids[0]) + 1 >= pol.swapAfter) return true;
        const set = [...new Set([...Object.keys(q.broke || {}), ...ids])];
        return (
          pol.stableAfter > 0 &&
          set.length <= pol.stableMax &&
          set.reduce((sum, k) => sum + lostOf_(k), 0) + 1 >= pol.stableAfter
        );
      };
      const branchOk = (ids) =>
        pol.kindBranch &&
        ids.length > 0 &&
        !(briefs.kinds && briefs.kinds[K]) &&
        ids.every((id) => byId[id] && kindOfT(byId[id]) !== K);
      const root = node0({
        base: eb,
        ev: ev0,
        chain: [],
        score: score(row, ev0),
        near: nearOf(row, ev0),
        seconds: row.seconds,
        depth: 1,
      });
      q.near = root.near;
      const open = [root];
      const seen = new Set();
      const triedArr = [];
      // the last answer short of parity: what the failing drafters wrote, for the larger model to write briefs from
      let lastRow = row;
      let i = 0;
      let won = false;
      const recent = st.kept;
      const trim = () => {
        const built = open.filter((x) => x !== root && !x.spent).sort((x, y) => y.score - x.score);
        for (const x of built.slice(pol.beam)) {
          x.spent = true;
          x.trimmed = true;
        }
      };
      // ONE TRY: an arrangement asked on this question, its outcome counted, and what follows from it (kept; at parity but losing one
      // already there, built on; closer, built on)
      // a win without one of its parts at a time, applied to the swarm as it stood when the question began: dropped where the
      // question is still at parity and every question already there holds. -> { combo, briefs, rows, dropped } or null
      const prune = async (combo0, again, rows0) => {
        let cur = combo0;
        let curB = null;
        let curRows = rows0;
        const dropped = [];
        for (let k = 0; k < cur.length && cur.length > 1;) {
          const cand = cur.filter((_, j) => j !== k);
          const ap = applyNames(poolOf, eb, cand);
          if (!ap || ap.names.length !== cand.length) {
            k++;
            continue;
          }
          const note = { n, of: list.length, attempt: i, cap, move: cand.join(' + '), prune: cur[k] };
          const r = await attempt(ap.briefs, t, note);
          q.attempts.push({ move: 'without ' + cur[k], grade: r.grade, prune: true });
          if (r.grade !== 'right') {
            k++;
            continue;
          }
          const rr = [];
          let holds = true;
          for (const g of again) {
            const gr = await attempt(ap.briefs, g.t, { ...note, guard: g.t.id });
            rr.push(gr);
            if (gr.grade !== 'right') {
              holds = false;
              break;
            }
          }
          if (!holds) {
            k++;
            continue;
          }
          dropped.push(cur[k]);
          cur = cand;
          curB = ap.briefs;
          curRows = rr;
        }
        return dropped.length ? { combo: cur, briefs: curB, rows: curRows, dropped } : null;
      };
      const tryOne = async (node, m, combo, newBriefs, method, extra = {}) => {
        seen.add([...combo].sort().join(' + '));
        // A BRIEF THAT QUOTES ITS OWN QUESTION IS REFUSED BEFORE IT IS ASKED: it costs no try (docs/swoa-classes.md, step 4)
        const quoted = quotesQuestion(newBriefs, node.base, specific);
        if (quoted) {
          q.specific = (q.specific || 0) + 1;
          st.specificRefused = (st.specificRefused || 0) + 1;
          console.log('  refused ' + combo.join(' + ').slice(0, 70) + ' (a brief quotes the question: ' + quoted + ')');
          return { closer: false };
        }
        i++;
        onAttempt({ q, m, n: i });
        const r = await attempt(newBriefs, t, {
          n,
          of: list.length,
          attempt: i,
          round: node.depth,
          cap,
          move: combo.join(' + '),
          ...(node.chain.length ? { on: [...node.chain] } : {}),
          method,
          pace: { seconds: paceOf(st.paceS), left: extra.left ?? null, ...(cap < Infinity ? { cap } : {}) },
          ...(q.unstable ? { unstable: true } : {}),
          ...(st.trial ? { trial: st.trial.taken.map((x) => x.knob) } : {}),
          ...(q.broke ? { broke: q.broke } : {}),
          ...(st.library.length ? { library: st.library.length } : {}),
          ...(st.suggest ? { suggest: st.suggest } : {}),
          tried: q.attempts
            .slice(1)
            .slice(-8)
            .map((x) => ({
              move: (x.on ? x.on.join(' + ') + ' + ' : '') + x.move,
              grade: x.grade,
              round: x.round,
              ...(x.closer ? { closer: true } : {}),
              ...(x.lostOn ? { lostOn: x.lostOn } : {}),
              ...(x.library ? { library: true } : {}),
              ...(x.suggested ? { suggested: true } : {}),
              ...(x.taught ? { taught: true } : {}),
              ...(x.near ? { near: x.near } : {}),
            })),
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
        if (r.seconds && node.seconds) {
          cls.secs = Math.round(((cls.secs || 0) + (r.seconds - node.seconds)) * 10) / 10;
          cls.timed = (cls.timed || 0) + 1;
        }
        if (r.wallSeconds || r.seconds) st.paceS = [...(st.paceS || []), r.wallSeconds ?? r.seconds].slice(-10);
        const a = {
          move: m.name,
          id: m.id,
          area: m.area,
          kind: classOf(m),
          grade: r.grade,
          round: node.depth,
          ...(node.chain.length ? { on: [...node.chain] } : {}),
          method,
          ...(extra.library ? { library: true } : {}),
          ...(extra.suggested ? { suggested: true } : {}),
          ...(extra.taught ? { taught: true } : {}),
          ...(r.seconds ? { seconds: r.seconds } : {}),
          ...(r.seconds && node.seconds ? { added: Math.round((r.seconds - node.seconds) * 10) / 10 } : {}),
        };
        q.attempts.push(a);
        let outcome = 'none';
        if (r.grade !== 'right') {
          if (r.grade !== 'noref') {
            const ev2 = tuned(await lostOf(r, newBriefs), newBriefs, pol);
            const s2 = score(r, ev2);
            a.near = nearOf(r, ev2);
            const nd = node0({
              base: newBriefs,
              ev: ev2,
              chain: combo,
              score: s2,
              near: a.near,
              seconds: r.seconds,
              depth: node.depth + 1,
              ...(node.broken ? { broken: true } : {}),
              ...(node.rank ? { rank: node.rank, repairOf: node.repairOf } : {}),
            });
            if (s2 > node.score) {
              a.closer = true;
              outcome = 'closer';
              open.push(nd);
              trim();
            } else triedArr.push(nd);
          }
          counted(outcome);
          q.sinceSuggest = (q.sinceSuggest || 0) + 1;
          q.sinceTeach = (q.sinceTeach || 0) + 1;
          lastRow = r;
          return { closer: outcome === 'closer' };
        }
        mv.reached++;
        cls.reached++;
        let what = combo.join(' + ');
        // at parity here: does it hold on the questions that were already there? (the one changes lose most, first)
        // (the change goes into this class's own arrangement only, so only this class's questions can lose by it)
        const again = guardOf(
          reached.filter((x) => kindOfT(x.t) === K),
          t,
          guard,
          st.lostOn || {},
          st.pairs || {},
        );
        let rows = [];
        const lostIds = [];
        for (const [gk, g] of again.entries()) {
          const gr = await attempt(newBriefs, g.t, {
            n,
            of: list.length,
            attempt: i,
            round: node.depth,
            cap,
            move: what,
            guard: g.t.id,
            ...(node.chain.length ? { on: [...node.chain] } : {}),
            method,
            guarded: { n: gk + 1, of: again.length },
          });
          rows.push(gr);
          if (gr.grade !== 'right') {
            lostIds.push(g.t.id);
            // A STANDING CONFLICT MAY BE SWAPPED: while what it has lost could still be swapped, the rest are asked too; if that is all
            // it loses, the change is kept and those questions go back in hand
            if (!swapOk(lostIds) && !branchOk(lostIds)) break;
          }
        }
        a.guard = { asked: rows.length, of: again.length, lost: lostIds.length };
        // KEPT FOR ITS KIND ONLY: where every question it lost is of the other kind (code, or words), it is kept as this kind's own
        // arrangement, and those questions keep the one they were at parity with: nothing is lost, and nothing goes back in hand
        const branch = lostIds.length > 0 && rows.length === again.length && branchOk(lostIds);
        const swap = !branch && lostIds.length > 0 && rows.length === again.length && swapOk(lostIds);
        if (lostIds.length && !swap && !branch) {
          a.lostOn = lostIds[0];
          mv.lostElsewhere++;
          st.lostOn = st.lostOn || {};
          st.lostOn[a.lostOn] = (st.lostOn[a.lostOn] || 0) + 1;
          st.pairs[t.id + '>' + a.lostOn] = (st.pairs[t.id + '>' + a.lostOn] || 0) + 1;
          q.broke = q.broke || {};
          q.broke[a.lostOn] = (q.broke[a.lostOn] || 0) + 1;
          a.nearParity = true;
          counted('parity');
          if (!pol.brokeBudget || (q.brokeTries || 0) >= pol.brokeBudget) return { closer: false };
          // WHAT IS BUILT ON IT IS AIMED AT THE QUESTION IT BROKE: this question is at parity with it already, so the next changes are
          // ranked by where the broken one was lost in its check (drafting, choosing, writing), not by where this one had been. Ranked
          // by this question's own record, eight changes in a row on rotate were drafting changes, and each broke dedupe as the last had
          const failed = rows.find((x) => x.grade !== 'right');
          const repair = failed ? tuned(await lostOf(failed, newBriefs), newBriefs, pol) : null;
          open.push(
            node0({
              base: newBriefs,
              ev: node.ev,
              ...(repair ? { rank: repair, repairOf: a.lostOn } : {}),
              chain: combo,
              broken: true,
              score: 100000 + rows.length - 1,
              near: { ...nearOf(r, node.ev), parity: true, broke: a.lostOn },
              seconds: r.seconds,
              depth: node.depth + 1,
            }),
          );
          trim();
          return { closer: true };
        }
        // THE SMALLEST WIN: a win of several changes is tried without each of its parts, and what is kept is the smallest that
        // still reaches parity and loses none of the questions already there (arrangements had only grown: six changes deep, every
        // part of them slowing every question after, and none known to be needed)
        if (pol.prune && combo.length > 1 && !swap && !branch) {
          const pr = await prune(combo, again, rows);
          if (pr) {
            a.pruned = pr.dropped;
            combo = pr.combo;
            newBriefs = pr.briefs;
            rows = pr.rows;
            what = combo.join(' + ');
          }
        }
        // THE HELD GUARD (docs/swoa-classes.md, step 4): on up to heldGuard held questions of this class, it must lose none that the
        // arrangement as it stands answers at parity. Held answers decide only whether a change is kept, never which one is found
        const hq = heldGuard > 0 ? heldQs.filter((h) => kindOfT(h) === K).slice(0, heldGuard) : [];
        if (hq.length) {
          st.heldBase = st.heldBase || {};
          const hk = (briefs.version || 1) + '|' + K;
          const hb = (st.heldBase[hk] = st.heldBase[hk] || {});
          const lostHeld = [];
          let askedHeld = 0;
          let keptHeld = 0;
          const at = { n, of: list.length, attempt: i, round: node.depth, cap, method };
          for (const h of hq) {
            if (hb[h.id] === undefined)
              hb[h.id] = (
                await attempt(flat(briefs, K), h, { ...at, move: 'held, as it stands', guard: h.id, held: true })
              ).grade;
            if (hb[h.id] !== 'right') continue;
            askedHeld++;
            const hr = await attempt(newBriefs, h, { ...at, move: what, guard: h.id, held: true });
            if (hr.grade === 'right') keptHeld++;
            else {
              lostHeld.push(h.id);
              break;
            }
          }
          a.heldGuard = { asked: askedHeld, kept: keptHeld, lost: lostHeld.length };
          if (lostHeld.length) {
            a.lostOnHeld = lostHeld[0];
            mv.lostElsewhere++;
            counted('parity');
            console.log('  not kept: it lost the held question ' + lostHeld[0] + ', at parity as the swarm stood');
            return { closer: false };
          }
        }
        // KEPT: the arrangement is now this one, for this question and every one after
        briefs = branch
          ? {
              ...briefs,
              kinds: { ...(briefs.kinds || {}), [K]: ownOf(newBriefs) },
              version: (briefs.version || 1) + 1,
            }
          : { ...fold(newBriefs, K, briefs), version: (briefs.version || 1) + 1 };
        a.kept = true;
        mv.kept = (mv.kept || 0) + 1;
        const several = combo.length > 1;
        const ids = new Set((newBriefs.slots || []).map((s) => s.id));
        const entry = {
          kind: extra.library ? 'library' : several ? 'several' : m.kind,
          slot: m.slot || undefined,
          what: several ? 'several: ' + what : combo[0],
          from: m.from || undefined,
          slots: wordsOf(what).filter((w) => ids.has(w)),
          question: { id: t.id, kind: t.kind, lostAt: lost, attempt: i, round: node.depth, guard: rows.length },
          ...(a.added !== undefined ? { addedSeconds: a.added } : {}),
          ...(extra.library ? { fromLibrary: extra.library.from } : {}),
          ...(a.pruned ? { pruned: a.pruned } : {}),
          ...(swap ? { swapped: lostIds.join(', ') } : {}),
          ...(branch ? { kindOnly: K, wouldLose: lostIds.join(', ') } : {}),
          class: K,
          ...(a.heldGuard ? { heldGuard: a.heldGuard } : {}),
          why:
            'it brought ' +
            t.id +
            ' to parity (lost in ' +
            lost +
            ', change ' +
            i +
            ' tried' +
            (extra.library
              ? ', an arrangement found on ' + extra.library.from.question
              : several
                ? ', on top of ' + node.chain.join(' and ')
                : '') +
            '), and ' +
            (branch
              ? 'of the ' +
                rows.length +
                ' already at parity asked again it lost only ' +
                lostIds.join(' and ') +
                ', ' +
                (K === 'code' ? 'asked in words' : 'asked for code') +
                ': it is kept for questions ' +
                (K === 'code' ? 'asking for code' : 'in words') +
                ' only, as their own arrangement, and those keep the one they were at parity with'
              : swap
                ? 'of the ' +
                  rows.length +
                  ' already at parity asked again it lost only ' +
                  lostIds.join(' and ') +
                  ', lost ' +
                  lostIds.reduce((sum, k) => sum + (st.pairs[t.id + '>' + k] || 0), 0) +
                  " times before by this question's changes: " +
                  (lostIds.length === 1 ? 'that one goes' : 'those go') +
                  ' back in hand'
                : rows.length
                  ? 'the ' +
                    rows.length +
                    ' question' +
                    (rows.length === 1 ? '' : 's') +
                    ' already at parity asked again with it stayed there'
                  : 'no question was at parity before it to lose'),
        };
        st.kept.push({ ...entry, briefs: briefs.version });
        await keep(briefs, entry);
        // the library grows (or the entry it repeats is credited with one more question)
        addToLibrary(st.library, combo, { question: t.id, pass: undefined, lostAt: lost, class: K });
        await onLibrary(st.library);
        again.forEach((g, k) => {
          if (!rows[k] || (branch && kindOfT(g.t) !== K)) return;
          const at = st.rows.findIndex((x) => x.id === g.t.id);
          if (at >= 0) st.rows[at] = rows[k];
        });
        if (swap) {
          for (const lostId of lostIds) {
            st.swapped[t.id + '>' + lostId] = true;
            const lq = st.questions.find((x) => x.id === lostId);
            if (lq) {
              lq.state = 'reopened';
              lq.reached = false;
              lq.lostTo = t.id;
            }
            const ri = reached.findIndex((x) => x.t.id === lostId);
            if (ri >= 0) reached.splice(ri, 1);
            st.reopen.push(lostId);
          }
          q.swapped = lostIds.join(', ');
        }
        row = r;
        won = true;
        counted('kept');
        return { closer: true };
      };
      // WHERE THE SEARCH STANDS, written down after every try: the question's record, what was tried, and each arrangement open or
      // tried by the changes that make it (rebuilt from the swarm as it stands when carried on: applyNames)
      const ser = (x) => ({
        chain: x.chain,
        ev: x.ev,
        ...(x.rank ? { rank: x.rank, repairOf: x.repairOf } : {}),
        score: x.score,
        near: x.near,
        seconds: x.seconds,
        depth: x.depth,
        ...(x.broken ? { broken: true } : {}),
        ...(x.spent ? { spent: true } : {}),
        ...(x.trimmed ? { trimmed: true } : {}),
        tried: [...x.tried],
      });
      const snapshot = () => ({
        id: t.id,
        version: briefs.version || 1,
        i,
        q: JSON.parse(JSON.stringify(q)),
        seen: [...seen],
        root: [...root.tried],
        open: open.filter((x) => x !== root).map(ser),
        wide: triedArr.map(ser),
      });
      const checkpoint = async () => {
        if (won) return;
        st.inHand = snapshot();
        await onTry(st);
      };
      // every try counted toward setting the question aside (tries in a row that brought it neither closer nor to parity), then
      // written down
      const tryIt = async (...args) => {
        const out = await tryOne(...args);
        q.sinceGain = out.closer || won ? 0 : (q.sinceGain || 0) + 1;
        await checkpoint();
        return out;
      };
      // SET ASIDE: `setAsideAfter` tries in a row with nothing closer and no parity, while another question waits (one not yet
      // finished, one sent back, or one set aside that the arrangement has changed since). It comes back after them, on the
      // arrangement they leave; where nothing has changed by then, it gets as many tries again (givenUp) (measured 2026-11-17: 44
      // tries in a row on one question, none closer, while 78 questions waited)
      const others = () =>
        st.reopen.length > 0 ||
        list.some((x) => x.id !== t.id && !doneIds().has(x.id) && !asideOf().some((a) => a.id === x.id)) ||
        asideOf().some((a) => a.id !== t.id && (a.asideAt || 0) < (briefs.version || 1));
      const stalled = () =>
        !won && !lastChance && pol.setAsideAfter > 0 && (q.sinceGain || 0) >= pol.setAsideAfter && others();
      // ITS LAST CHANCE IS BOUNDED TOO: a question set aside that comes back with nothing changed since gets as many tries again, and
      // where they bring it nothing closer it is written down as not reached and the pass goes on (measured 2026-11-18: an agent's
      // step came back last, nothing could measure it closer, and 1,255 tries went to it)
      // AND SO IS ONE NOTHING ELSE WAITS ON: a question that came back because the arrangement changed, with every other question
      // set aside on the arrangement as it stands, cannot be set aside (there is nowhere to go), so it was searched without end
      // (measured 2026-11-18: train-1009-answer-5 came back on version 17, the other 35 set aside were all set aside on 17, and 2,281
      // tries went to it). Nothing waiting is its last chance: as many tries, then not reached; a question on its first visit with
      // nothing waiting gets twice as many, the tries it would have had before being set aside and the ones after
      const givenUp = () =>
        !won &&
        pol.setAsideAfter > 0 &&
        (lastChance || (!others() && (q.sinceGain || 0) >= pol.setAsideAfter * ((q.setAside || 0) > 0 ? 1 : 2))) &&
        (q.sinceGain || 0) >= pol.setAsideAfter;
      const stop = () => stalled() || givenUp();
      const tick = async () => {
        await policyTick(st, { review, onPolicy, current: q });
        pol = st.policy;
        // the larger model's help comes half as often each time it brings this question nothing (helpBackoff): each costs it
        // started, asked and stopped
        const every = (base, dry) => base * (pol.helpBackoff ? 2 ** (dry || 0) : 1);
        if (!won && review && pol.suggestEvery && (q.sinceSuggest || 0) >= every(pol.suggestEvery, q.suggestDry))
          await suggest();
        if (
          !won &&
          teach &&
          pol.teachEvery &&
          (q.sinceTeach || 0) >= every(pol.teachEvery, q.teachDry) &&
          lostAt(lastRow) !== 'writing'
        )
          await teachNow();
        // BEYOND REARRANGING: so many tries, the larger model's teaching among them, and still short of parity. Flagged once, with
        // the evidence, and the next lever made ready (adapters.mjs): it never moves on before parity all the same
        if (!won && pol.adaptAfter && i >= pol.adaptAfter && (q.taught || 0) > 0 && !q.beyond) {
          q.beyond = { at: i, lostAt: lostAt(lastRow), taught: q.taught, closest: root.near };
          q.beyond.ready = (await onBeyond(q, t)) || null;
        }
      };
      // NEW BRIEFS FOR THE QUESTION'S OWN FAILURE: where no slot drafts the answer, rearranging slots cannot help (measured 2026-11-17:
      // 53 suggested changes on such a question, none kept, none closer). After `teachEvery` failed tries the larger model is shown
      // what the failing drafters wrote and the answer wanted, and writes new briefs for them: general instructions, never this
      // question (support/teach.mjs briefAsk). They join the pool and are tried at once, on top of the closest arrangement
      const teachNow = async () => {
        q.sinceTeach = 0;
        const node = open.filter((x) => !x.spent).sort((x, y) => y.score - x.score || x.depth - y.depth)[0] || root;
        const slotsById = Object.fromEntries((node.base.slots || []).map((x) => [x.id, x]));
        // the slots to teach: where no slot drafted the answer, the drafters that missed it; where one did and it was not chosen,
        // the checkers (who did not show it up), then the drafters whose answers stood instead
        const lostNow = lostAt(lastRow);
        const tr0 = (lastRow.trace || []).filter((x) => slotsById[x.slot]);
        // THE DRAFTERS NEAREST THE ANSWER FIRST: by the share of inputs their answer already gets as the larger model's does (of
        // words, the reader's probability), then the order they ran. Taken in order, the first two were always the first model's
        // (measured 2026-11-17 on question 6: three rounds of briefs naming the missing idea went to the 1.2B model's two drafters,
        // at 53% and nothing, while the 3B model's drafter at 87% was never taught)
        const nearest = (xs) =>
          xs
            .map((x, k) => ({ x, k }))
            .sort((p1, p2) => (p2.x.share ?? -1) - (p1.x.share ?? -1) || p1.k - p2.k)
            .map((p1) => p1.x);
        const failing = [
          ...new Set(
            (lostNow === 'choosing'
              ? [
                  ...tr0.filter((x) => x.stage === 'check'),
                  ...nearest(tr0.filter((x) => x.stage === 'draft' && x.same === false)),
                ]
              : nearest(tr0.filter((x) => x.stage === 'draft' && x.same === false))
            ).map((x) => x.slot),
          ),
        ].slice(0, 2);
        const tc = (st.teach = st.teach || {
          asked: 0,
          seconds: 0,
          briefs: 0,
          tried: 0,
          kept: 0,
          closer: 0,
          failed: 0,
        });
        let gained = false;
        for (const sid of failing) {
          if (won || i >= cap) break;
          const tr = (lastRow.trace || []).find((x) => x.slot === sid && (x.stage === 'draft' || x.stage === 'check'));
          const missed = [
            {
              question: String(t.ask || '').slice(0, 600),
              slotWrote: String((tr && (tr.out || tr.final)) || '(nothing)').slice(-500),
              wanted: String(lastRow.refReply || lastRow.ref || '').slice(0, 600),
            },
          ];
          const t0 = Date.now();
          let cands = [];
          try {
            cands = (await teach(slotsById[sid], missed, lostNow)) || [];
            tc.asked++;
            if (cands.refused) tc.refused = (tc.refused || 0) + cands.refused;
            q.taught = (q.taught || 0) + 1;
          } catch {
            tc.failed++;
          }
          tc.seconds = Math.round((tc.seconds + (Date.now() - t0) / 1000) * 10) / 10;
          tc.briefs += cands.length;
          const names = new Set(cands.map((c) => c.name));
          for (const m of poolOf(node.base).filter((x) => x.slot === sid && names.has(x.name))) {
            if (won || i >= cap) break;
            const combo = [...node.chain, m.name];
            if (seen.has([...combo].sort().join(' + '))) continue;
            const method = {
              area: m.area,
              kind: 'a brief the larger model wrote for this failure',
              from: node.near,
              place: 1,
              open: cands.length,
              reasons: [
                (lostNow === 'choosing'
                  ? 'a slot had the answer and it was not chosen'
                  : 'no slot drafted the answer') +
                  ' for ' +
                  pol.teachEvery +
                  ' tries: the larger model wrote new briefs for ' +
                  sid,
                ...((cands.find((c) => c.name === m.name) || {}).why
                  ? ['what went wrong: ' + cands.find((c) => c.name === m.name).why]
                  : []),
              ],
            };
            const out = await tryIt(node, m, combo, m.briefs, method, { taught: true });
            tc.tried++;
            if (won || out.closer) gained = true;
            if (won) tc.kept++;
            else if (out.closer) tc.closer++;
            await policyTick(st, { review, onPolicy, current: q });
            pol = st.policy;
          }
        }
        q.teachDry = gained ? 0 : (q.teachDry || 0) + 1;
        if (!gained) tc.dry = (tc.dry || 0) + 1;
      };
      // THE LARGER MODEL SUGGESTS WHAT TO TRY: after `suggestEvery` failed tries it is shown this question, what was tried and how close
      // each came, the arrangement the next tries build on, the found arrangements, and the changes still open from it by name. What
      // it names is tried at once, on top of that arrangement: each try is its own test, so no trial is needed. What a suggestion
      // costs (the larger model started, asked, stopped) and what its tries came to are counted, for the page and for the review
      const suggest = async () => {
        q.sinceSuggest = 0;
        const node = open.filter((x) => !x.spent).sort((x, y) => y.score - x.score || x.depth - y.depth)[0] || root;
        const opts = orderFor(poolOf(node.base), {
          ...(node.rank || node.ev),
          moves: st.moves,
          classes: st.classes,
          pin,
          drop,
          policy: pol,
          recent,
        })
          .filter((m) => !seen.has([...node.chain, m.name].sort().join(' + ')))
          .slice(0, 80)
          .map((m) => m.name);
        if (!opts.length) return;
        const sg = (st.suggest = st.suggest || { asked: 0, seconds: 0, tried: 0, kept: 0, closer: 0, failed: 0 });
        const t0 = Date.now();
        const took = () => Math.round((Date.now() - t0) / 100) / 10;
        let text = '';
        try {
          text = await review(
            suggestAsk({
              question: { id: t.id, kind: t.kind, ask: String(t.ask || '').slice(0, 700) },
              lostAt: lost,
              on: node.chain,
              near: node.near,
              tried: q.attempts
                .slice(1)
                .slice(-24)
                .map((x) => ({
                  tried: (x.on ? x.on.join(' + ') + ' + ' : '') + x.move,
                  came: x.kept
                    ? 'kept'
                    : x.grade === 'right'
                      ? 'at parity, lost ' + x.lostOn
                      : x.closer
                        ? 'closer'
                        : 'no closer',
                  ...(x.near ? { near: x.near } : {}),
                })),
              library: st.library.slice(-10).map((e) => ({ what: e.what, broughtToParity: (e.reached || []).length })),
              broke: q.broke || null,
              open: opts,
            }),
            'suggest',
          );
        } catch {
          sg.failed++;
          sg.seconds = Math.round((sg.seconds + took()) * 10) / 10;
          return;
        }
        sg.asked++;
        sg.seconds = Math.round((sg.seconds + took()) * 10) / 10;
        const { picks, why } = suggestionsOf(text, opts);
        const log = {
          at: new Date().toISOString(),
          question: t.id,
          picks: picks.map((x) => x.join(' + ')),
          why,
          seconds: took(),
          came: [],
        };
        st.suggestLog = [...(st.suggestLog || []), log].slice(-30);
        for (const [pk, names] of picks.entries()) {
          if (won || i >= cap) break;
          const ap = applyNames(poolOf, node.base, names);
          if (!ap) continue;
          const combo = [...node.chain, ...ap.names];
          if (seen.has([...combo].sort().join(' + '))) continue;
          const nm = ap.names.join(' + ');
          const m = { key: 'suggested:' + nm, id: 'suggested:' + nm, name: nm, area: 'suggested', kind: 'suggested' };
          const method = {
            area: 'suggested',
            kind: 'a suggestion of the larger model',
            from: node.near,
            place: pk + 1,
            open: picks.length,
            reasons: [
              'suggested by the larger model after ' + pol.suggestEvery + ' failed tries' + (why ? ': ' + why : ''),
            ],
          };
          const out = await tryIt(node, m, combo, ap.briefs, method, { suggested: true, left: picks.length - pk - 1 });
          sg.tried++;
          if (won) sg.kept++;
          else if (out.closer) sg.closer++;
          log.came.push(won ? 'kept' : out.closer ? 'closer' : 'no closer');
          await policyTick(st, { review, onPolicy, current: q });
          pol = st.policy;
        }
        q.sinceSuggest = 0;
        const gained = log.came.some((c) => c !== 'no closer');
        q.suggestDry = gained ? 0 : (q.suggestDry || 0) + 1;
        if (!gained) sg.dry = (sg.dry || 0) + 1;
      };

      // CARRIED ON: the search as it was written down after its last try (or when it was set aside), on the same arrangement
      const held = carry || (st.asideSearch && st.asideSearch[t.id]);
      if (st.asideSearch) delete st.asideSearch[t.id];
      if (held && held.version === (briefs.version || 1)) {
        Object.assign(q, held.q, { id: t.id, kind: t.kind, asked: K });
        i = held.i;
        for (const k of held.seen) seen.add(k);
        for (const k of held.root) root.tried.add(k);
        const back = (x) => {
          const ap = x.chain.length ? applyNames(poolOf, eb, x.chain) : null;
          if (x.chain.length && (!ap || ap.names.length !== x.chain.length)) return null;
          return node0({ ...x, base: ap ? ap.briefs : eb, tried: new Set(x.tried) });
        };
        open.push(...held.open.map(back).filter(Boolean));
        triedArr.push(...held.wide.map(back).filter(Boolean));
        q.carried = (q.carried || 0) + 1;
      }
      // (back from being set aside, it starts its count again: as many tries as set it aside, not none; on a changed arrangement too,
      // or the count it left with set it aside again, or gave it up, after its first try)
      if (lastChance || (q.setAside || 0) > 0) q.sinceGain = 0;
      // FIRST, THE LIBRARY: every arrangement found so far, on top of the swarm as it stands, the most successful first
      for (const [k, e] of rankLibrary(st.library).entries()) {
        if (won || i >= cap || stop()) break;
        // (a found arrangement is tried only on questions of the class it was found on: docs/swoa-classes.md, step 3)
        // (an entry from before entries named their class: the question it was found on, or one of the same kind, gives it)
        const fromQ =
          e.from &&
          (byId[e.from.question] || list.find((x) => x.kind && String(e.from.question).includes('-' + x.kind + '-')));
        const libClass = (e.from && e.from.class) || (fromQ ? kindOfT(fromQ) : null);
        if (libClass !== K) continue;
        const ap = applyNames(poolOf, eb, e.names);
        if (!ap || seen.has([...ap.names].sort().join(' + '))) continue;
        e.tried = (e.tried || 0) + 1;
        const m = {
          key: 'library:' + e.what,
          id: 'library:' + e.what,
          name: ap.names.join(' + '),
          area: 'library',
          kind: 'library',
        };
        const method = {
          area: 'library',
          kind: 'a found arrangement',
          from: root.near,
          place: k + 1,
          open: st.library.length,
          reasons: [
            'found on ' +
              e.from.question +
              ', and it has brought ' +
              e.reached.length +
              ' question' +
              (e.reached.length === 1 ? '' : 's') +
              ' to parity',
            'the found arrangements are tried first on every question, the most successful first',
          ],
        };
        await tryIt(root, m, ap.names, ap.briefs, method, { library: e, left: st.library.length - k - 1 });
        await tick();
      }
      // THEN THE SEARCH, best first, until parity
      while (!won && i < cap && !stop()) {
        let node = open.filter((x) => !x.spent).sort((x, y) => y.score - x.score || x.depth - y.depth)[0];
        if (node && node.broken && (q.brokeTries || 0) >= pol.brokeBudget) {
          node.spent = true;
          continue;
        }
        if (!node) {
          // EVERY ARRANGEMENT OPEN TRIED, AND STILL SHORT OF PARITY: the search widens rather than moves on. What the beam closed is
          // opened again; then every arrangement tried on this question becomes one to build on, the closest first
          const closed = open.filter((x) => x.trimmed);
          if (closed.length) {
            for (const x of closed) x.spent = x.trimmed = false;
          } else if (triedArr.length) {
            const wide = triedArr.splice(0).sort((x, y) => y.score - x.score);
            open.push(...wide);
          } else break;
          q.widened = (q.widened || 0) + 1;
          continue;
        }
        const aim = node.rank || node.ev;
        const opts = orderFor(poolOf(node.base), {
          ...aim,
          moves: st.moves,
          classes: st.classes,
          pin,
          drop,
          policy: pol,
          recent,
        }).filter((m) => !node.tried.has(m.name) && !seen.has([...node.chain, m.name].sort().join(' + ')));
        if (!opts.length) {
          node.spent = true;
          continue;
        }
        q.rounds = Math.max(q.rounds || 1, node.depth);
        let taken = 0;
        for (const m of opts) {
          if (won || i >= cap || stop() || (pol.batch && taken >= pol.batch)) break;
          if (node.broken && (q.brokeTries || 0) >= pol.brokeBudget) break;
          if (node.broken) q.brokeTries = (q.brokeTries || 0) + 1;
          taken++;
          node.tried.add(m.name);
          const combo = [...node.chain, m.name];
          const method = {
            area: m.area,
            kind: classOf(m),
            from: node.near,
            place: node.tried.size,
            open: node.tried.size - taken + opts.length,
            reasons: [
              ...(node.rank
                ? [
                    'aimed at ' +
                      node.repairOf +
                      ', which the arrangement it builds on breaks (lost in ' +
                      node.rank.lost +
                      ' there)',
                  ]
                : []),
              ...reasonsOf(m, aim, { moves: st.moves, classes: st.classes, pin, policy: pol, recent }),
            ],
          };
          const out = await tryIt(node, m, combo, m.briefs, method, { left: opts.length - taken });
          await tick();
          if (out.closer && pol.batch) break;
        }
      }
      q.state = row.grade === 'right' ? 'reached' : 'not reached';
      if (!won) q.exhausted = i < cap;
      if (givenUp()) {
        q.state = 'not reached';
        q.exhausted = false;
        q.gaveUp = { after: q.sinceGain, at: i };
      }
      if (stalled()) {
        q.state = 'set aside';
        q.asideAt = briefs.version || 1;
        q.exhausted = false;
        st.asideSearch = { ...(st.asideSearch || {}), [t.id]: snapshot() };
      }
    }
    st.inHand = null;
    q.reached = row.grade === 'right' && q.state !== 'mark wrong';
    q.briefs = briefs.version;
    if (q.reached) reached.push({ t, row });
    const at = st.questions.findIndex((x) => x.id === q.id);
    if (at >= 0) st.questions[at] = q;
    else st.questions.push(q);
    const ra = st.rows.findIndex((x) => x.id === t.id);
    if (ra >= 0) st.rows[ra] = row;
    else st.rows.push(row);
    await onQuestion(q, row, st, briefs);
  }
  return { ...st, briefs };
}
// THE POLICY, AFTER EVERY TRY: a trial running for `trialTries` tries is judged (the mean of what its tries came to against as many
// before it: kept 10, at parity but losing one 3, closer 1); with none running, every `reviewTries` tries the larger model reviews
// the search. Counted in tries, not questions: a night of two long questions had one review, and its trial never ended
export async function policyTick(
  st,
  { review = null, onPolicy = async () => {}, now = () => new Date().toISOString(), current = null } = {},
) {
  const pol = st.policy;
  st.tryN = st.tryN || 0;
  st.tryLog = st.tryLog || [];
  if (st.trial) {
    if (st.tryN - st.trial.startTry < pol.trialTries) return;
    const tr = st.trial;
    const during = st.tryLog.filter((x) => x.n > tr.startTry).map((x) => x.s);
    const v = verdictOf(tr.before, during);
    if (!v.keep) st.policy = tr.from;
    const ev = { at: now(), event: v.keep ? 'kept' : 'put back', taken: tr.taken, verdict: v };
    st.policyLog.push(ev);
    st.trial = null;
    st.reviewedAtTry = st.tryN;
    await onPolicy(st.policy, ev, st.trial);
    return;
  }
  if (!review || st.tryN - (st.reviewedAtTry || 0) < pol.reviewTries) return;
  await reviewNow(st, { review, onPolicy, now, current });
}
// THE LARGER MODEL REVIEWS THE SEARCH, now: shown the record (with the question in hand, where there is one), the knobs, the library
// and what came of earlier proposals; what it proposes goes on trial
export async function reviewNow(
  st,
  { review, onPolicy = async () => {}, now = () => new Date().toISOString(), current = null } = {},
) {
  const pol = st.policy;
  st.reviewedAtTry = st.tryN || 0;
  let text = '';
  try {
    text = await review(
      reviewAsk(
        pol,
        recordOf(st, current),
        (st.policyLog || []).filter((x) => x.taken || x.refused),
      ),
    );
  } catch (e) {
    const ev = { at: now(), event: 'no review', why: String((e && e.message) || e).slice(0, 160) };
    st.policyLog.push(ev);
    await onPolicy(st.policy, ev, st.trial);
    return;
  }
  const p = proposalOf(text, pol);
  if (!p.taken.length) {
    const ev = {
      at: now(),
      event: 'nothing proposed',
      ...(p.refused.length ? { refused: p.refused } : {}),
      ...(p.ideas.length ? { ideas: p.ideas } : {}),
      ...(p.read ? {} : { why: 'the reply held no JSON' }),
    };
    st.policyLog.push(ev);
    await onPolicy(st.policy, ev, st.trial);
    return;
  }
  st.trial = {
    from: pol,
    taken: p.taken,
    startTry: st.tryN || 0,
    before: (st.tryLog || []).slice(-pol.trialTries).map((x) => x.s),
  };
  st.policy = p.policy;
  const ev = {
    at: now(),
    event: 'on trial',
    ...(current ? { during: current.id } : {}),
    taken: p.taken,
    ...(p.refused.length ? { refused: p.refused } : {}),
    ...(p.ideas.length ? { ideas: p.ideas } : {}),
  };
  st.policyLog.push(ev);
  await onPolicy(st.policy, ev, st.trial);
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
    markWrong: by('mark wrong'),
    setAside: by('set aside'),
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
  // kinds a person chose to train without this pass (--skip-kinds a,b; SKIP_KINDS in session.sh): left out, and said so
  const skipKinds = new Set(
    String(arg('skip-kinds', process.env.SKIP_KINDS || ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const list = questions('train', each).filter((t) => !skipKinds.has(t.kind));
  if (skipKinds.size) console.log('Left out of this pass, as asked: ' + [...skipKinds].join(', ') + '.');
  // what each question asks: a brief that names a function one of them asks for is passed over (support/teach.mjs givesAway)
  const asks = list.map((t) => t.ask || '');
  // THE QUESTIONS WHOSE MARK IS NOT STABLE: the larger model asked them again (session.sh 02-target-self-train) and did not give an
  // answer equivalent to its own first one. Measured on the held questions, it was equivalent to itself on 56 of 84; on the kinds
  // of conversation, as few as 1 in 6
  const unstable = unstableOf(path.join(B.RESULTS, TARGET.id + '-self-train.json'), (list[0] || {}).seed);
  if (unstable.size)
    console.log(
      unstable.size +
        ' of ' +
        list.length +
        ' train questions have a mark the larger model did not give again: they are marked, and searched until parity like the rest.',
    );
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
    // (one written before briefs that give a question away were refused is passed over the same way)
    return out.filter((c) => c && !givesAway(c.brief, asks));
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
  // THE HELD QUESTIONS THE HELD GUARD ASKS (docs/swoa-classes.md, step 4), with the larger model's answers to them (session.sh
  // 02-target): graded as the train questions are. Where it has not answered them, there is no held guard this pass
  const heldAll = questions('held', each);
  const heldRef = B.reference(heldAll);
  for (const [k, v] of heldRef) ref.set(k, v);
  const heldQs = heldAll.filter((t) => heldRef.get(t.id) !== undefined);
  const heldGuard = Number(arg('held-guard', lp.heldGuard ?? 4));
  console.log(
    heldQs.length
      ? 'Held guard: a change is kept only if it loses none of up to ' +
          heldGuard +
          ' held questions of its class at parity.'
      : 'Held guard: the larger model has not answered the held questions, so changes are kept on the train questions alone.',
  );
  // THE COVERAGE GATE (coverageOf): the reader's verdict made current first (a judge chosen since its check is checked now), then
  // every kind counted. A kind with nothing to compare stops the pass before anything is trained: exit 3, which session.sh stops on
  B.readerCurrent(list);
  const { readerOk } = await import('./support/reader-file.mjs');
  const cover = coverageOf(list, { ref, readerOk: (type) => readerOk(WORKC, type) });
  console.log('Comparable, by kind: ' + cover.map((c) => c.kind + ' ' + c.compared + '/' + c.n).join(', '));
  const bare = cover.filter((c) => c.compared === 0);
  if (bare.length) {
    console.log(
      'NOT TRAINED: ' +
        bare.map((c) => c.kind + ' (' + c.n + ' questions: ' + c.why + ')').join('; ') +
        '.\nA pass would train nothing on them and say only "not compared". Name a judge that passes its check (src/config.json "judge";' +
        ' training/readers.mjs checks it), or leave them out of this pass deliberately: --skip-kinds ' +
        bare.map((c) => c.kind).join(',') +
        ' (SKIP_KINDS=... in a session).',
    );
    process.exit(3);
  }
  // (and the marks the questions' own correct solutions prove wrong: answered once and set aside)
  const wrongMarks = await wrongMarksOf(list, ref);
  if (wrongMarks.size)
    console.log(
      wrongMarks.size +
        ' of ' +
        list.length +
        ' train questions have a mark that does not do what the question asks (its own correct solution, or its own answer, says so): they are answered once and set aside, never searched.',
    );
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
  if (resume) {
    const again = reopenComparable(
      resume,
      list,
      (t) => ref.get(t.id) !== undefined && (!(t.type === 'open' || t.type === 'talk') || readerOk(WORKC, t.type)),
    );
    if (again.length)
      console.log(
        again.length +
          ' questions this pass had set down as not compared can be compared now (' +
          [...new Set(again.map((id) => (list.find((t) => t.id === id) || {}).kind))].join(', ') +
          '): they are asked again.',
      );
  }
  if (resume)
    console.log(
      'Carrying on: ' +
        resume.questions.filter((x) => x.state !== 'set aside').length +
        ' of ' +
        list.length +
        ' questions were finished' +
        (resume.inHand ? ', and ' + resume.inHand.id + ' carries on from try ' + resume.inHand.i : '') +
        '.',
    );
  // THE LOOP'S OWN POLICY, as it has evolved (loop-policy.mjs): carried from pass to pass in this configuration's folder, started
  // from the defaults and what training/policy.json names. A pass carried on from a stop carries on with the policy it had
  const { normal: normalP, defaults: defaultsP } = await import('./loop-policy.mjs');
  // (in .work/library, which Clear training state keeps: what the search has learned about searching is not training state. A policy
  // written before it moved is read from its old place once)
  const LIB = path.join(REPO_ROOT, '.work', 'library');
  const PFILE = path.join(LIB, CONFIG_KEY + '-policy.json');
  const kept = readSafe(PFILE, null) || readSafe(path.join(WORKC, 'loop-policy.json'), null);
  const startPolicy = normalP({
    ...defaultsP(),
    ...(lp.beam ? { beam: Number(lp.beam) } : {}),
    ...((kept && kept.policy) || {}),
  });
  const policyLog = (kept && kept.log) || [];
  let carriedTrial = (kept && kept.trial) || null;
  const writePolicy = (pol, ev, trial) => {
    if (ev) policyLog.push(ev);
    if (trial !== undefined) carriedTrial = trial;
    fs.mkdirSync(LIB, { recursive: true });
    writeSafe(
      PFILE,
      JSON.stringify(
        { policy: pol, log: policyLog.slice(-60), ...(carriedTrial ? { trial: carriedTrial } : {}) },
        null,
        2,
      ),
    );
  };
  // THE LIBRARY OF FOUND ARRANGEMENTS (also in .work/library, kept by Clear): tried first on every question, grown by every keep
  const LFILE = path.join(LIB, CONFIG_KEY + '.json');
  // EVERY WIN, CUMULATIVE (.work/library/<configuration>-wins.jsonl, kept by Clear): each kept change with the question it brought to
  // parity, whatever run it was found in. The spec reads it, so the spec holds everything training has found; and the library is
  // made whole from it at every start (a session started before an entry was added could have written over it)
  const WFILE = path.join(LIB, CONFIG_KEY + '-wins.jsonl');
  const wins = fs.existsSync(WFILE)
    ? fs
        .readFileSync(WFILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
  const library = (readSafe(LFILE, null) || {}).arrangements || [];
  for (const w of wins) {
    const what = String(w.what || '');
    const names = what.startsWith('several: ') ? what.slice(9).split(' + ') : [what];
    if (what && (w.question || {}).id)
      addToLibrary(library, names, { question: w.question.id, lostAt: w.question.lostAt });
  }
  if (library.length)
    console.log(
      library.length +
        ' found arrangement' +
        (library.length === 1 ? '' : 's') +
        ' in the library: each question tries them first.',
    );
  const writeLibrary = (lib) => {
    fs.mkdirSync(LIB, { recursive: true });
    // (merged with what is on disk, never written over it: an entry added there by anything else stays)
    for (const e of (readSafe(LFILE, null) || {}).arrangements || []) {
      const had = lib.find((x) => [...x.names].sort().join(' + ') === [...e.names].sort().join(' + '));
      if (!had) lib.push(e);
      else for (const q of e.reached || []) if (!had.reached.includes(q)) had.reached.push(q);
    }
    writeSafe(
      LFILE,
      JSON.stringify(
        { arrangements: lib.map((e) => ({ ...e, from: { ...e.from, pass: e.from.pass ?? pass } })) },
        null,
        2,
      ),
    );
  };
  // the larger model, asked to review the search: started for it and stopped after (64 GB holds it beside the swarm; where it
  // cannot be served, the review is written down as not made and the policy stays as it is). SWARM_LOOP_REVIEW=0 turns it off
  // THE LARGER MODEL, KEPT LOADED THROUGH A QUESTION: started the first time it is asked (a review, a suggestion, briefs), asked again
  // as it stands, and stopped when the question ends (64 GB holds it beside the swarm). A start each time cost more than an answer
  let teacherOpen = null;
  const getTeacher = async () => (teacherOpen = teacherOpen || (await B.openAlone('target')));
  const releaseTeacher = async () => {
    const t = teacherOpen;
    teacherOpen = null;
    if (t) await t.stop();
  };
  const review =
    process.env.SWARM_LOOP_REVIEW === '0'
      ? null
      : async (prompt, kind = 'review') => {
          console.log(
            kind === 'suggest'
              ? '  SUGGEST the larger model is shown this question and what was tried, and asked what to try next'
              : "  REVIEW the larger model is shown the loop's record and asked how the search could do better",
          );
          const teacher = await getTeacher();
          return String((await teacher.ask([{ role: 'user', content: prompt }], { maxTokens: 1200 })).text || '');
        };
  // written at the start too, so that the page shows the policy the search runs by from its first question
  if (!kept) writePolicy(startPolicy);
  // NEW BRIEFS FOR A SLOT THAT FAILED ON THE QUESTION IN HAND, by the larger model (as write-briefs.mjs does once a pass, from a
  // pass's misses): added to this configuration's candidates, where the pool reads them, and returned for the loop to try
  const { teachAsk, candidatesIn, refuseGiveaways, givesAway } = await import('./support/teach.mjs');
  const teach =
    process.env.SWARM_LOOP_REVIEW === '0'
      ? null
      : async (slot, missed, lost = 'drafting') => {
          console.log(
            '  TEACH the larger model says what went wrong for ' + slot.id + ' on this question, and writes new briefs',
          );
          const teacher = await getTeacher();
          const text = String(
            (await teacher.ask([{ role: 'user', content: teachAsk(slot, missed, lost) }], { maxTokens: 1800 })).text ||
              '',
          );
          // (a brief that gives this question away is refused, said, and counted: support/teach.mjs givesAway)
          const { kept: fresh, refused } = refuseGiveaways(
            candidatesIn(text, 'the larger model'),
            missed.map((x) => x.question),
          );
          for (const c of refused) console.log('  REFUSED "' + c.name + '": ' + c.refused);
          const file = path.join(WORKC, 'candidates', slot.id + '.json');
          let have = [];
          try {
            have = JSON.parse(fs.readFileSync(file, 'utf8'));
          } catch {
            /* none yet */
          }
          const add = fresh.filter((c) => !have.some((h) => h.brief === c.brief));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          writeSafe(file, JSON.stringify([...have, ...add], null, 2));
          add.refused = refused.length;
          return add;
        };
  const swarm = await openSwarm(readBriefs(), { reuse: true });
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
      heldQs,
      heldGuard,
      briefs: readBriefs(),
      poolOf,
      cap,
      guard,
      drop,
      beam,
      pin: steer.pin,
      resume,
      unstable,
      wrongMarks,
      ...(arg('beam') ? { beam } : {}),
      policy: startPolicy,
      policyLog: [...policyLog],
      trial: resume && resume.trial ? null : carriedTrial,
      library,
      onLibrary: async (lib) => writeLibrary(lib),
      teach,
      // BEYOND REARRANGING: the larger model's train answers as a dataset, and whether each small model can be trained here
      onBeyond: async (q) => {
        // (whether MLX can train each one here: training an adapter takes minutes a model and nothing tries one as a change yet,
        // so it is not started from here; node training/adapters.mjs train does it)
        const { exportDataset, mlxReady } = await import('./adapters.mjs');
        const dir = path.join(LIB, CONFIG_KEY + '-adapters');
        const ds = exportDataset(list, ref, path.join(dir, 'train.jsonl'), messagesOf);
        const { MEMBERS } = await import('../src/catalog.mjs');
        const trainable = Object.values(MEMBERS).map((m) =>
          mlxReady({ name: m.name, file: path.join(B.modelsDir(), m.file) }, path.join(REPO_ROOT, '.work')),
        );
        const ready = { dataset: path.relative(REPO_ROOT, ds.file), examples: ds.examples, trainable };
        writeSafe(
          path.join(dir, q.id + '.json'),
          JSON.stringify({ question: q.id, at: new Date().toISOString(), ...q.beyond, ...ready }, null, 2),
        );
        console.log(
          '  BEYOND REARRANGING ' +
            q.id +
            ': ' +
            ds.examples +
            ' train answers made ready; ' +
            trainable.map((x) => x.model + (x.ok ? ' can be trained here' : ': ' + x.why)).join('; '),
        );
        return ready;
      },
      review,
      onPolicy: async (pol, ev, tr) => {
        // (a trial on is carried in the file, so that a pass that ends, or Clear training state, does not lose it)
        writePolicy(pol, ev, tr ? { from: tr.from, taken: tr.taken } : null);
        const say = {
          'on trial': 'ON TRIAL',
          kept: 'POLICY KEPT',
          'put back': 'POLICY PUT BACK',
          'nothing proposed': 'NO PROPOSAL',
          'no review': 'NO REVIEW',
        }[ev.event];
        console.log(
          '  ' +
            say +
            (ev.taken
              ? ' ' +
                ev.taken.map((x) => x.knob + ' ' + JSON.stringify(x.from) + ' -> ' + JSON.stringify(x.to)).join('; ')
              : '') +
            (ev.verdict ? ' (' + ev.verdict.during + ' against ' + ev.verdict.before + ' before)' : '') +
            (ev.why ? ': ' + ev.why : ''),
        );
      },
      // what kinds of change have reached parity, learned on every question of every pass of this configuration
      classes: state.loopClasses || {},
      attempt: async (b, t, at) => {
        swarm.setBriefs(b);
        const r0 = swarm.reused || { hits: 0, savedMs: 0 };
        // (and, on a try, the arrangement being asked: the page draws it while the try runs, marked as not kept)
        live({
          loop: {
            ...at,
            // the class of the question asked (orchestrate.mjs classOf): the page draws that class's arrangement, and compares a try
            // against it rather than against the shared one
            class: inputClassOf(t.turns || [{ role: 'user', content: t.ask }], { tools: t.tools }),
            reused: r0,
            ...(at.attempt
              ? { briefs: { version: b.version, slots: b.slots, plan: b.plan || {}, flow: b.flow || null } }
              : {}),
          },
        });
        const t0 = Date.now();
        const [row] = await run([t], async (x) => pick(await askSwarm(swarm, x, messagesOf(x))), {
          ref,
          at: { n: at.n, of: at.of },
        });
        // what the run costs in full: the time it took, and what the answers it reused first took
        const r1 = swarm.reused || r0;
        row.seconds = Math.round((Date.now() - t0 + (r1.savedMs - r0.savedMs)) / 100) / 10;
        row.reusedSeconds = Math.round((r1.savedMs - r0.savedMs) / 100) / 10;
        // and what it took on the clock: what the pace is told in (counted at full cost it read 140 s a try against a real 10 s)
        row.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;
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
        // and the cumulative record of every win, which Clear training state keeps
        fs.mkdirSync(LIB, { recursive: true });
        fs.appendFileSync(
          WFILE,
          JSON.stringify({ at: new Date().toISOString(), pass, ...entry, config: CONFIG_ID, target: TARGET.id }) + '\n',
        );
        console.log('  KEPT "' + entry.what + '": ' + entry.why);
      },
      // where the question in hand stands, after every try: a stopped run carries on from that try
      onTry: async (cur) => writeSafe(FILE, JSON.stringify({ pass, seed: (list[0] || {}).seed, each, st: cur })),
      onQuestion: async (q, row, cur) => {
        await releaseTeacher();
        writeSafe(FILE, JSON.stringify({ pass, seed: (list[0] || {}).seed, each, st: cur }));
        save('questions', {
          pass,
          cfg: CONFIG_ID,
          target: TARGET.id,
          cap,
          guard,
          ...(skipKinds.size ? { skippedKinds: [...skipKinds] } : {}),
          classes: cur.classes,
          of: list.length,
          ...tallyOf(cur),
          list: cur.questions,
          changes: cur.kept,
          // the loop's policy as it stands, what is on trial, and what became of each proposal
          loopPolicy: cur.policy,
          trial: cur.trial
            ? {
                taken: cur.trial.taken,
                done: (cur.tryN || 0) - (cur.trial.startTry || 0),
                of: cur.policy.trialTries,
                unit: 'tries',
              }
            : null,
          policyLog: policyLog.slice(-30),
          // what the larger model's suggestions of what to try have cost and come to
          suggest: cur.suggest || null,
          teach: cur.teach || null,
          // the loop as it runs: tries this pass, what was kept from the library and from suggestions, questions back in hand
          tries: cur.tryN || 0,
          reviewedAtTry: cur.reviewedAtTry || 0,
          reopen: cur.reopen || [],
          suggestLog: (cur.suggestLog || []).slice(-10),
          moves: Object.values(cur.moves),
        });
      },
    });
  } finally {
    live({ loop: null });
    await releaseTeacher();
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
      ' not reached' +
      (cap < Infinity ? ' after ' + cap + ' changes each' : ', no combination bringing them closer') +
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
    st.rows.map((r) => ({ label: 'swarm', briefs: st.briefs.version, adapters: swarm.adapters || [], ...r })),
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
