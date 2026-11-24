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

// A QUESTION CODE CAN BE WRITTEN FOR: one message, no tools, and a right answer that is a short text (so that the writer can
// be shown what right looks like). A conversation, a request for code and a turn with tools are not.
export const writable = (t) =>
  !!t &&
  !t.turns &&
  !t.tools &&
  typeof t.ask === 'string' &&
  (typeof t.want === 'string' || (typeof t.want === 'number' && Number.isFinite(t.want))) &&
  typeof t.good === 'function';

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
  '- It returns the answer as a string, written exactly as the right answers below are written.\n' +
  '- Plain JavaScript only: no require, no import, no console, no clock, no random numbers.\n' +
  '- Reply with the whole function in one ```js block and nothing else.';
const exampleOf = (t) => 'Question:\n' + t.ask + '\nRight answer: ' + t.want;
export const writeAsk = (kind, shown) => [
  { role: 'system', content: 'You write small, exact JavaScript functions.' },
  {
    role: 'user',
    content:
      'Below are ' +
      shown.length +
      ' questions of one kind, each with its right answer. Write one JavaScript function `' +
      WRITTEN_NAME +
      '(question)` that takes the text of any question of this kind and returns its answer, worked out by code.\n\n' +
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
            .map(
              (f) =>
                'Question:\n' +
                f.ask +
                '\nIt returned: ' +
                (f.got === null ? 'null' : f.got) +
                '\nRight answer: ' +
                f.want,
            )
            .join('\n\n')
        : '') +
      '\n\nWrite it again, the whole function, in one ```js block. It is also run on questions of this kind you have not been shown, so it must read the question, not remember these.',
  },
];

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
    .map((t, i) => ({ ask: t.ask, want: t.want, got: got[i], mark: mSeen[i] }))
    .filter((f) => f.mark !== 'right');
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
  if (out.seenRight < seen.length) return { ok: false, why: 'it returned null for a question it was shown', ...out };
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
export async function writeFor(kind, own, others, ask, { tries = 3, show = 4, cover = 0.5, say = () => {} } = {}) {
  const nShown = Math.max(2, Math.min(show, Math.floor(own.length / 2)));
  const seen = own.slice(0, nShown);
  const unseen = own.slice(nShown);
  const out = { kind, ok: false, shown: seen.length, tries: [] };
  if (unseen.length < 2)
    return { ...out, why: 'too few questions of this kind to vet a function on ones it was not shown' };
  let messages = writeAsk(kind, seen);
  for (let i = 0; i < tries; i++) {
    say('writing code for the kind "' + kind + '", try ' + (i + 1) + ' of ' + tries);
    let text = '';
    try {
      text = await ask(messages);
    } catch (e) {
      out.tries.push({ ok: false, why: 'the writer gave no reply: ' + String((e && e.message) || e).slice(0, 120) });
      continue;
    }
    const code = codeIn(text);
    const v = await vet(code, { seen, unseen, others }, { cover });
    const { failed, ...kept } = v;
    out.tries.push(kept);
    if (v.ok) return { ...out, ok: true, code };
    if (!code) messages = writeAsk(kind, seen);
    else messages = againAsk(kind, seen, code, v);
  }
  return { ...out, why: (out.tries[out.tries.length - 1] || {}).why || 'nothing was written' };
}
