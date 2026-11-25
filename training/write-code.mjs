// write-code.mjs - TRAINING WRITES CODE. An instrument (src/instruments.mjs) is code a person wrote for an operation a person
// foresaw; which of them is on is training's to find. This is the step before that: the code itself is found by training.
// For a kind of question a class is short on, a model is asked for one function, `answer(question)`, that works the answer
// out from the question's own text and gives nothing where it cannot read the whole of it. What comes back is not trusted:
//   1. IT IS RUN (src/written.mjs, where it can reach nothing) on training's own questions of that kind. The writer was SHOWN
//      some of them with their right answers; it is vetted on the ones it was NOT shown, so a function that only holds the
//      answers it saw is refused here and costs no held question.
//   2. IT MUST BE WRONG NOWHERE: on a question of its kind it answers rightly or not at all, and on every other question of
//      the class it gives nothing or what that question's own standard calls right. One wrong answer and it is refused.
//      It must answer enough of the unseen ones to be worth a run before every request (policy: writeCover).
//   3. A function that passes is A MOVE like any other (arrange.mjs writtenMoves): scored on the train questions, and kept
//      only where the HELD questions gain, on two draws, by the one rule (keep.mjs). Held questions are never shown to the
//      writer and never used to vet.
// A function that is refused is said why, on what it was shown only, and asked again, a few times (policy: writeTries).
// What was written, refused or kept is in <record>-written.json, with the code.
//   kindsShort(rows, tasks, most)       which kinds to write for: the most wrong first, where a right answer is known
//   writeAsk(kind, shown) / againAsk    what the writer is asked
//   codeIn(text)                        the function in a reply, or ''
//   vet(code, { seen, unseen, others }) -> { ok, why, right, wrong, silent, n, failed: [...] }
//   writeFor(kind, tasks, others, ask)  the whole of it for one kind -> { kind, ok, code?, tries: [...] }
import { answersOf, WRITTEN_NAME } from '../src/written.mjs';
import { outputsOf } from '../src/sandbox.mjs';
import { bare } from '../src/instruments.mjs';

// A QUESTION CODE CAN BE WRITTEN FOR: one message, no tools, and a right answer that is a short text (so that the writer can
// be shown what right looks like). A conversation, a request for code and a turn with tools are not.
// (and A TURN OF A CONVERSATION where the last message is the person's and the conversation says what the right answer is,
// one answer: the function is given that last message, as the module gives it, and is vetted by the conversation's own
// reading of the reply. A turn that cannot be answered from its last message alone ("and double that?") is one the
// function must be silent on, which vetting holds it to.)
export const wantOf = (t) =>
  typeof (t || {}).want === 'string'
    ? t.want
    : typeof (t || {}).want === 'number' && Number.isFinite(t.want)
      ? String(t.want)
      : Array.isArray((t || {}).answers) && t.answers.length === 1 && !(t.answers2 || []).length
        ? String(t.answers[0])
        : null;
export const writable = (t) =>
  !!t &&
  !t.tools &&
  typeof t.ask === 'string' &&
  typeof t.good === 'function' &&
  wantOf(t) !== null &&
  (!t.turns ||
    (t.turns.length > 0 &&
      t.turns[t.turns.length - 1].role === 'user' &&
      t.turns[t.turns.length - 1].content === t.ask));

// the kinds of a class the swarm was wrong on, the most wrong first: [{ kind, wrong, n }], at most `most`
export function kindsShort(rows, tasks, most = 2, skip = []) {
  const by = new Map();
  for (const [i, r] of (rows || []).entries()) {
    const t = tasks[i];
    if (!t || !writable(t) || skip.includes(t.kind)) continue;
    const k = by.get(t.kind) || { kind: t.kind, wrong: 0, n: 0 };
    k.n++;
    if (!r.counted) k.wrong++;
    by.set(t.kind, k);
  }
  return [...by.values()]
    .filter((k) => k.wrong > 0 && k.n >= 4)
    .sort((a, b) => b.wrong - a.wrong || b.n - a.n || a.kind.localeCompare(b.kind))
    .slice(0, most);
}

const RULES =
  'Rules:\n' +
  '- It must work the answer out from what the question says. Other questions of this kind have other names, numbers and details, so nothing from these examples may be written into it.\n' +
  '- Where a question is not of this kind, or any part of it cannot be read, it must return null. It must never guess.\n' +
  '- It returns the answer as a string, written exactly as the answers below are written.\n' +
  '- It is called with ONE string, the text of the question: often a single line, not several.\n' +
  '- Plain JavaScript only: no require, no import, no console, no clock, no random numbers.\n' +
  '- Reply with the whole function in one ```js block and nothing else.';
// AN EXAMPLE IS SHOWN AS THE CALL IT IS: the string the function is given, as a string, and what it must return. It was shown as
// "Question:", a line break, the text, and a function written from that wanted two lines of a question that has one, and
// returned null for every question it was shown (measured 2026-11-25: sorting, five tries, the same first check each time).
const FORM = { now: process.env.SWARM_WRITE_FORM || 'plain' };
export const setExampleForm = (f) => (FORM.now = f === 'call' ? 'call' : 'plain');
const exampleOf = (t) =>
  FORM.now === 'call'
    ? WRITTEN_NAME + '(' + JSON.stringify(bare(t.ask)) + ')\n// must return ' + JSON.stringify(wantOf(t))
    : 'Question:\n' + bare(t.ask) + '\nRight answer: ' + wantOf(t);
export const writeAsk = (kind, shown) => [
  { role: 'system', content: 'You write small, exact JavaScript functions.' },
  {
    role: 'user',
    content:
      'Below are ' +
      shown.length +
      ' questions of one kind, each with the answer the function must return for it. Write that JavaScript function, `' +
      WRITTEN_NAME +
      '(question)`: it takes the text of any question of this kind and returns its answer, worked out by code.\n\n' +
      RULES +
      '\n\n' +
      shown.map(exampleOf).join('\n\n'),
  },
];
// asked again: what it wrote, and where it failed ON WHAT IT WAS SHOWN (never an unseen question: it would be learned by heart)
export const againAsk = (kind, shown, code, verdict) => [
  ...writeAsk(kind, shown),
  { role: 'assistant', content: '```js\n' + code + '\n```' },
  {
    role: 'user',
    content:
      'That function was run and is not kept: ' +
      verdict.why +
      '.' +
      (verdict.failed && verdict.failed.length
        ? '\n\n' +
          verdict.failed
            .slice(0, 4)
            .map((f) =>
              FORM.now === 'call'
                ? WRITTEN_NAME +
                  '(' +
                  JSON.stringify(bare(f.ask)) +
                  ')\n// returned ' +
                  (f.got === null ? 'null' : JSON.stringify(f.got)) +
                  (f.at ? ': ' + f.at : '') +
                  '\n// must return ' +
                  JSON.stringify(f.want)
                : 'Question:\n' +
                  bare(f.ask) +
                  '\nIt returned: ' +
                  (f.got === null ? 'null' : f.got) +
                  (f.at ? ' (' + f.at + ')' : '') +
                  '\nRight answer: ' +
                  f.want,
            )
            .join('\n\n')
        : '') +
      '\n\nWrite it again, the whole function, in one ```js block. It is also run on questions of this kind you have not been shown, so it must read the question, not remember these. Questions of this kind are worded in several ways: do not depend on the exact sentence. Find what the question gives (the numbers, the words, the names) by pattern wherever it stands in the sentence, and return null only where it cannot be found.',
  },
];

// WHERE A FUNCTION GAVE UP, for each question it returned nothing for. A writer told only "it returned null" wrote the same
// fault again, five times: it cannot see its function run. So the function is run once more with every `return null` made
// to say which line it is, and the writer is shown that line: "it gave up at: if (lines.length < 2) return null;". Also
// said: that it threw, or that it reached its end with nothing returned.
//   gaveUpAt(code, questions) -> [ '' | 'the line it returned null at' | 'it threw an error' | ... ] one for each question
export async function gaveUpAt(code, questions, { timeoutMs = 20000 } = {}) {
  const lines = String(code || '').split('\n');
  const marked = lines.map((l, i) => l.replace(/\breturn\s+null\b/g, 'return "__gaveup_' + (i + 1) + '__"')).join('\n');
  const out = await outputsOf(
    marked,
    WRITTEN_NAME,
    questions.map((q) => [bare(q)]),
    { timeoutMs },
  );
  if (!out) return questions.map(() => 'it could not be run');
  return out.map((o) => {
    if (!o || o.e)
      return 'it threw an error while it ran (a value it used was not there, or a pattern did not match and was used all the same)';
    let v;
    try {
      v = JSON.parse(o.v);
    } catch {
      return '';
    }
    const m = typeof v === 'string' && /^__gaveup_(\d+)__$/.exec(v);
    if (m) return 'it returned null at this line: `' + (lines[Number(m[1]) - 1] || '').trim().slice(0, 160) + '`';
    if (v === '__undefined__' || v === undefined)
      return 'it reached its end, or a bare `return`, with nothing returned';
    if (v === null) return 'it returned a null that is not written as `return null`';
    if (typeof v !== 'string' && typeof v !== 'number')
      return 'it returned something that is neither a string nor a number';
    return '';
  });
}

// the function in a reply: the first fenced block that declares `answer`, else the reply itself where it does; '' otherwise
export function codeIn(text) {
  const s = String(text || '');
  const declares = (c) =>
    new RegExp('\\b(?:function\\s+' + WRITTEN_NAME + '\\b|(?:const|let|var)\\s+' + WRITTEN_NAME + '\\s*=)').test(c);
  for (const m of s.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)) if (declares(m[1])) return m[1].trim();
  const open = /```[a-zA-Z]*\s*\n([\s\S]*)$/.exec(s); // (a block that was never closed: the reply ran out)
  if (open && declares(open[1])) return '';
  return declares(s) && !/```/.test(s) ? s.trim() : '';
}

// RUN AND JUDGED. seen: the questions the writer was shown; unseen: the others of its kind; others: every other question of
// the class code could be asked. Each question's own standard says whether an answer is right.
export async function vet(code, { seen = [], unseen = [], others = [] } = {}, { cover = 0.5, timeoutMs = 20000 } = {}) {
  const no = (why, more = {}) => ({
    ok: false,
    why,
    right: 0,
    wrong: 0,
    silent: 0,
    n: unseen.length,
    failed: [],
    ...more,
  });
  if (!code) return no('no function called ' + WRITTEN_NAME + ' was in the reply');
  if (code.length > 12000) return no('it is too long to be a rule and not a list');
  const all = [...seen, ...unseen, ...others];
  const got = await answersOf(
    code,
    all.map((t) => t.ask),
    { timeoutMs },
  );
  if (!got)
    return no('it could not be run (it does not parse, never ends, or declares no function ' + WRITTEN_NAME + ')');
  const mark = async (t, a) => (a === null ? 'silent' : (await t.good(a)).grade === 'right' ? 'right' : 'wrong');
  const marks = [];
  for (const [i, t] of all.entries()) marks.push(await mark(t, got[i]));
  const part = (from, n) => marks.slice(from, from + n);
  const mSeen = part(0, seen.length);
  const mUnseen = part(seen.length, unseen.length);
  const mOthers = part(seen.length + unseen.length, others.length);
  const count = (m, w) => m.filter((x) => x === w).length;
  // (what the writer may be told: only what it was shown)
  const failed = seen
    .map((t, i) => ({ ask: t.ask, want: wantOf(t), got: got[i], mark: mSeen[i] }))
    .filter((f) => f.mark !== 'right');
  // (and for each it gave nothing for, where it gave up)
  if (failed.some((f) => f.got === null)) {
    const silent = failed.filter((f) => f.got === null);
    const at = await gaveUpAt(
      code,
      silent.map((f) => f.ask),
      { timeoutMs },
    );
    silent.forEach((f, i) => (f.at = at[i] || ''));
  }
  const out = {
    right: count(mUnseen, 'right'),
    wrong: count(mUnseen, 'wrong'),
    silent: count(mUnseen, 'silent'),
    n: unseen.length,
    seenRight: count(mSeen, 'right'),
    seen: seen.length,
    elsewhere: count(mOthers, 'wrong'),
    failed,
  };
  const need = Math.max(1, Math.ceil(cover * unseen.length));
  if (count(mSeen, 'wrong')) return { ok: false, why: 'it gave a wrong answer to a question it was shown', ...out };
  if (out.wrong)
    return { ok: false, why: 'it gave a wrong answer to a question of this kind it had not been shown', ...out };
  if (out.elsewhere)
    return { ok: false, why: 'it answered a question of another kind, wrongly, where it should return null', ...out };
  // (silent on a question it was shown is not a fault: a function that reads some of a kind and is silent on the rest
  // is wrong nowhere. It is told which, where it is asked again for answering too few.)
  // (what it is told matters: a function that answered none of what it was SHOWN does not read the questions at all, and
  // "too few of the unseen ones" sent the writer looking for other wordings when its function read none. Measured
  // 2026-11-25: a sorting function that wanted two lines of a one-line question, refused three times for the wrong reason)
  if (seen.length && out.seenRight === 0)
    return {
      ok: false,
      why: 'it returned null for every question it was shown, so it does not read them: run it in your head on the first one and find where it gives up',
      ...out,
    };
  if (out.seenRight < seen.length && out.right < need)
    return {
      ok: false,
      why:
        'it returned null for ' +
        (seen.length - out.seenRight) +
        ' of the ' +
        seen.length +
        ' questions it was shown (listed below) and answered ' +
        out.right +
        ' of ' +
        unseen.length +
        ' it was not shown; at least ' +
        need +
        ' are needed',
      ...out,
    };
  if (out.right < need)
    return {
      ok: false,
      why:
        'it answered ' +
        out.right +
        ' of ' +
        unseen.length +
        ' questions of this kind it had not been shown, and at least ' +
        need +
        ' are needed',
      ...out,
    };
  return { ok: true, why: '', ...out };
}

// ONE KIND, THE WHOLE OF IT: shown half of its train questions (at least two, at most `show`), vetted on the rest and on the
// class's other questions, asked again where refused. ask(messages) -> text is the writer.
//   -> { kind, ok, code?, id?, shown, tries: [{ ok, why, right, wrong, silent, n, elsewhere }] }
//
// A FRESH TRY IS SHOWN OTHER QUESTIONS. A function passed on its first try or, almost always, not at all: told what was wrong,
// the writer wrote the same fault again (measured 2026-11-25, 21 kinds, three ways of telling it: 8, 9 and 5 passed, one of
// them on a second try). So tries are not one long correction. Every other try starts again, shown a different part of the
// kind's train questions (`fresh`: 'rotate'), so that it is another function and not the last one mended; the try after
// each is told what was wrong with that one. 'chain' is the one long correction, as it was.
export async function writeFor(
  kind,
  own,
  others,
  ask,
  { tries = 3, show = 6, cover = 0.5, say = () => {}, fresh = 'rotate' } = {},
) {
  const nShown = Math.max(2, Math.min(show, Math.floor(own.length / 2)));
  // (which questions a try is shown: the first nShown; a fresh try, the next nShown round the list)
  const shownFor = (k) => own.map((_, i) => own[(i + k * nShown) % own.length]).slice(0, nShown);
  let seen = shownFor(0);
  let unseen = own.filter((t) => !seen.includes(t));
  const out = { kind, ok: false, shown: seen.length, tries: [] };
  if (unseen.length < 2)
    return { ...out, why: 'too few questions of this kind to vet a function on ones it was not shown' };
  let messages = writeAsk(kind, seen);
  let lastCode = '';
  for (let i = 0; i < tries; i++) {
    if (fresh === 'rotate' && i > 0 && i % 2 === 0) {
      seen = shownFor(i / 2);
      unseen = own.filter((t) => !seen.includes(t));
      messages = writeAsk(kind, seen);
    }
    say('writing code for the kind "' + kind + '", try ' + (i + 1) + ' of ' + tries);
    let text = '';
    try {
      text = await ask(messages);
    } catch (e) {
      out.tries.push({ ok: false, why: 'the writer gave no reply: ' + String((e && e.message) || e).slice(0, 120) });
      continue;
    }
    const code = codeIn(text);
    if (code) lastCode = code;
    const v = await vet(code, { seen, unseen, others }, { cover });
    const { failed, ...kept } = v;
    out.tries.push(kept);
    if (v.ok) return { ...out, ok: true, code };
    if (!code) messages = writeAsk(kind, seen);
    else messages = againAsk(kind, seen, code, v);
  }
  // (what it last wrote is kept with the refusal: read, it says why a function came to nothing)
  return {
    ...out,
    why: (out.tries[out.tries.length - 1] || {}).why || 'nothing was written',
    ...(lastCode ? { refused: lastCode.slice(0, 6000) } : {}),
  };
}

// JUDGED WHERE IT ACTS. A function answers one kind of question and is silent on every other, and a class has only a few held
// questions of any one kind (six): on the first trial a function that took its kind from 4 to 6 of 6 held questions was a
// gain of 5.6 points over the class with an error of 3.9, which no rule can tell from chance (2026-11-24). So a change that
// puts a function on is confirmed on the class's held questions AND on more held questions of that function's kind, made
// from the held seed as the others are. They are held questions like any other: never shown to the writer, never used to
// vet, and asked of the swarm as it stands and of the change alike. The rule a change is kept by is not changed.
//   kindsAdded(base, cand)                   the kinds a candidate has a function for that the arrangement it came from has not
//   moreHeldOf(kinds, held, make, extra, ok) -> the further held questions, `extra` of each kind (make: tasks.mjs tasks)
export const kindsAdded = (base, cand) => {
  const of = (b) => (Array.isArray(((b || {}).plan || {}).written) ? b.plan.written : []).map((w) => w.kind);
  const had = of(base);
  return [...new Set(of(cand).filter((k) => k && !had.includes(k)))];
};
export function moreHeldOf(kinds, held, make, extra = 18, ok = () => true) {
  if (!(extra > 0)) return [];
  return (kinds || []).flatMap((kind) => {
    const had = (held || []).filter((t) => t.kind === kind);
    if (!had.length) return [];
    return make({ split: 'held', each: had.length + extra, kinds: [kind], seed: had[0].seed })
      .filter((t) => ok(t) && !(held || []).some((x) => x.id === t.id))
      .slice(0, extra);
  });
}

// MORE TRAIN QUESTIONS OF A KIND, FOR THE WRITING. A kind is asked in several wordings, and of six train questions the writer
// was shown three: a function that read those three wordings answered none of the others and was refused (measured
// 2026-11-25, the larger model: sorting, closing brackets, a sum and six more kinds, each "0 of 3 it had not been shown").
// Train questions are made from a seed, so more of the kind are made for the writing alone: more to be shown, more to be
// vetted on. They are train questions; the held ones are not touched.
//   poolFor(kind, own, make, size) -> own and further train questions of the kind, `size` in all where so many can be made
export function poolFor(kind, own, make, size = 16) {
  if (!own.length || !(size > own.length)) return own;
  const more = make({ split: 'train', each: size, kinds: [kind], seed: own[0].seed }).filter(
    (t) => writable(t) && !own.some((x) => x.id === t.id || x.ask === t.ask),
  );
  return [...own, ...more].slice(0, size);
}
