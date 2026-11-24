// tasks-chat.mjs - MADE-UP PEOPLE, AND THE CONVENTIONS A REPLY TO THEM IS READ BY. A conversation had no standard of its own
// here: its questions were marked against the larger model's reply, so the class of input that IS a conversation was trained by
// nothing (the class stage asks only questions that carry their own standard). The Crew's trainers showed what that standard is
// (TheCrew training/manners.mjs, training/TRAIN.md): made-up people write the way people write, over several turns, and each
// reply is read against the conventions of that kind of conversation. EVERY READING IS OF THE WORDS THEMSELVES: no model grades
// another. None of this is taken from a benchmark: the conventions are how people talk.
//   CHAT_KINDS[kind](t, i) -> { type: 'chat', system, turns, person, conventions: [id], answer: [text any of which is right] }
//   CONVENTIONS            -> { id: { says, holds(reply, ctx) } }      ctx: { turns, person, answer }
//   conventionsHeld(made, reply) -> [true | false] for each of made.conventions
// A reply must also ANSWER: every person asks something with an answer code knows, and a reply without it is wrong whatever its
// manners (so that saying nothing politely is never the best arrangement). Manners do not fix what a model knows; they are
// read beside it.
import vm from 'node:vm';

const words = (s) => (String(s || '').match(/[A-Za-z0-9'’%.-]+/g) || []).length;
const sentences = (s) => (String(s || '').match(/[^.!?\n]+[.!?]*/g) || []).map((x) => x.trim()).filter(Boolean);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const earlierSaid = (turns) => (turns || []).filter((m) => m.role === 'assistant').map((m) => String(m.content || ''));
const SLANG =
  /\b(?:gonna|wanna|gotta|yeah|yep|nope|hey|cool|awesome|kinda|sorta|lol|btw|no worries|no problem|you bet)\b|[\u{1F300}-\u{1FAFF}]/iu;
const PRAISE_OPEN =
  /^\s*(?:(?:that(?:'s| is)|what)\s+an?\s+)?(?:great|good|excellent|fantastic|wonderful|interesting|awesome|nice|lovely)\s+(?:question|point|idea|choice|thought)\b|^\s*(?:certainly|absolutely|of course|sure thing|sure|definitely)\s*[!.]/i;
const OFFER_CLOSE =
  /(?:let me know|feel free to|don'?t hesitate|hope (?:this|that) helps|anything else (?:i can|you need|you'd like)|happy to help|just ask|reach out)\b[^.!?\n]*[.!?]*\s*$/i;
const GREETS = /^\s*(?:hello|hi|hey|good (?:morning|afternoon|evening)|greetings)\b/i;

// A BAR THAT IS HELD TIGHTENS (after The Crew's ratchet): a convention every reply kept in a pass is asked a little more of in
// the next, one step for each pass it held, two at most. setBars({ short: 1 }) is called by the stage with what the last pass
// left (training/classes.mjs barsOf); with none set, every bar is at its first step.
const STEPS = { short: [40, 30, 20], 'thanks-brief': [12, 8, 5] };
let BARS = {};
export const setBars = (bars) => {
  BARS = { ...(bars || {}) };
};
export const barOf = (id) => STEPS[id][Math.max(0, Math.min(STEPS[id].length - 1, Number(BARS[id]) || 0))];
export const BAR_IDS = Object.keys(STEPS);
const numbersIn = (s) => String(s || '').match(/\d+(?:\.\d+)?/g) || [];
const has = (reply, a) =>
  new RegExp('(^|[^0-9.])' + String(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9])', 'i').test(
    String(reply || ''),
  );

export const CONVENTIONS = {
  answers: {
    says: 'it gives the answer that was asked for',
    holds: (reply, ctx) => (ctx.answer || []).some((a) => has(reply, a)),
  },
  'no-praise': {
    says: 'it does not open by praising the question',
    holds: (reply) => !PRAISE_OPEN.test(String(reply || '')),
  },
  'no-offer': {
    says: 'it does not close by offering more help',
    holds: (reply) => !OFFER_CLOSE.test(String(reply || '').trim()),
  },
  'no-echo': {
    says: 'it says no sentence twice, and none it said in an earlier turn',
    holds: (reply, ctx) => {
      const seen = new Set(
        earlierSaid(ctx.turns)
          .flatMap(sentences)
          .map(norm)
          .filter((k) => k.split(' ').length >= 4),
      );
      for (const k of sentences(reply).map(norm)) {
        if (k.split(' ').length < 4) continue;
        if (seen.has(k)) return false;
        seen.add(k);
      }
      return true;
    },
  },
  'greet-once': {
    says: 'a greeting already given is not given again',
    holds: (reply, ctx) => !(earlierSaid(ctx.turns).some((t) => GREETS.test(t)) && GREETS.test(String(reply || ''))),
  },
  short: {
    says: 'a short message gets a short reply (forty words at most; fewer once that has held)',
    holds: (reply) => words(reply) <= barOf('short'),
  },
  'no-slang': {
    says: 'a formal message gets no slang and no emoji',
    holds: (reply) => !SLANG.test(String(reply || '')),
  },
  'answer-first': {
    says: 'someone in a hurry gets the answer in the first sentence',
    holds: (reply, ctx) => CONVENTIONS.answers.holds(sentences(reply)[0] || '', ctx),
  },
  'not-a-question': {
    says: 'a question is not answered with a question',
    holds: (reply) => {
      const ss = sentences(reply);
      return ss.length > 0 && !ss.every((x) => /\?$/.test(x)) && !/\?$/.test(ss[0]);
    },
  },
  steady: {
    says: 'someone with something heavy on their mind is not answered brightly: no exclamation mark',
    holds: (reply) => !/!/.test(String(reply || '')),
  },
  'thanks-brief': {
    says: 'thanks gets a few words, no new subject and nothing said again (twelve words at most, no question, no figure)',
    holds: (reply) =>
      words(reply) <= barOf('thanks-brief') && !/\?/.test(String(reply || '')) && !numbersIn(reply).length,
  },
};
Object.assign(CONVENTIONS, {
  both: {
    says: 'asked two things, it answers both',
    holds: (reply, ctx) => (ctx.answer2 || []).some((a) => has(reply, a)),
  },
  firm: {
    says: 'a right answer that is doubted is kept, and the wrong figure is not agreed to',
    holds: (reply) =>
      !/\b(?:you(?:'re| are) (?:right|correct)|i apologi[sz]e|my mistake|my apologies|i was wrong|sorry about that|i stand corrected)\b/i.test(
        String(reply || ''),
      ),
  },
  works: {
    says: 'the code it gives does what was asked, run on inputs it was not shown',
    holds: (reply, ctx) => typeof ctx.works === 'function' && !!ctx.works(reply),
  },
  'as-asked': {
    says: 'what the person asked for earlier in the conversation still holds: a bare number, no unit or sign',
    holds: (reply) => /^\s*-?\d+(?:\.\d+)?\s*\.?\s*$/.test(String(reply || '')),
  },
});
export const CONVENTION_IDS = Object.keys(CONVENTIONS);
export const conventionsHeld = (made, reply) =>
  (made.conventions || []).map(
    (id) =>
      !!CONVENTIONS[id] &&
      !!CONVENTIONS[id].holds(reply, {
        turns: made.turns,
        person: made.person,
        answer: made.answer,
        answer2: made.answer2,
        works: made.works,
      }),
  );

// WHAT IS ASKED, each with an answer code knows: drawn from the seed, so no two questions of a kind are the same
const SUMS = [
  (t) => {
    const p = t.pick([10, 15, 20, 25, 30, 40]);
    const n = t.pick([40, 60, 80, 120, 200, 240]);
    return { plain: `${p}% of ${n}`, long: `what ${p} per cent of ${n} comes to`, answer: [String((p * n) / 100)] };
  },
  (t) => {
    const each = t.int(3, 9);
    const n = t.int(4, 12);
    return {
      plain: `${n} tickets at ${each} pounds each`,
      long: `the cost of ${n} tickets at ${each} pounds each`,
      answer: [String(each * n)],
    };
  },
  (t) => {
    const w = t.int(3, 9);
    return { plain: `days in ${w} weeks`, long: `how many days there are in ${w} weeks`, answer: [String(w * 7)] };
  },
  (t) => {
    const h = t.int(2, 6);
    const m = t.pick([15, 30, 45]);
    return {
      plain: `${h} hours ${m} minutes in minutes`,
      long: `how many minutes ${h} hours and ${m} minutes come to`,
      answer: [String(h * 60 + m)],
    };
  },
  (t) => {
    const a = t.int(12, 48);
    const b = t.int(12, 48);
    return { plain: `${a} plus ${b}`, long: `the sum of ${a} and ${b}`, answer: [String(a + b)] };
  },
];
const sumOf = (t, i) => SUMS[i % SUMS.length](t);
const SUBJECTS = [
  'a trip next month',
  'a small dinner',
  'the club accounts',
  'a school fair',
  'the allotment rota',
  'a reading group',
];
const SYSTEM = 'You are a helpful assistant in a conversation. Reply as a person would, in the way you were spoken to.';
const opener = (t) => t.pick(SUBJECTS);
const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });
// (again: the person's last message put a second way, with every number of the first: tasks.mjs reworded)
const made = (person, turns, conventions, answer, again) => ({
  type: 'chat',
  system: SYSTEM,
  person,
  turns,
  conventions: ['answers', ...conventions],
  answer,
  again,
});

export const PEOPLE = {
  'chat-terse': 'writes a few words, no capitals, no greeting',
  'chat-formal': 'writes formally, in full sentences',
  'chat-hurry': 'is in a hurry and says so',
  'chat-heavy': 'has something heavy on their mind',
  'chat-thanks': 'has their answer and says thanks',
  'chat-back': 'greets a second time and asks again',
  'chat-refer': 'asks about "that", the figure of the turn before',
  'chat-correct': 'corrects what they asked for',
  'chat-two': 'asks two things in one message',
  'chat-doubt': 'doubts a right answer and offers a wrong one',
  'chat-remember': 'says early on how they want figures given',
  'chat-reason': 'asks something to reason out, part way through a conversation',
  'chat-code': 'asks for a function, then for a change to it',
};
export const CHAT_KINDS = {
  'chat-terse'(t, i) {
    const s = sumOf(t, i);
    return made(
      'terse',
      [
        u(`hi, planning ${opener(t)}`),
        a('Hi! Happy to help with that. What do you need worked out?'),
        u(`${s.plain}?`),
      ],
      ['short', 'no-praise', 'no-offer', 'greet-once', 'not-a-question'],
      s.answer,
      `what's ${s.plain}`,
    );
  },
  'chat-formal'(t, i) {
    const s = sumOf(t, i);
    return made(
      'formal',
      [
        u(`Good afternoon. I am preparing ${opener(t)} and would be grateful for some assistance.`),
        a('Good afternoon. I would be glad to assist. What would you like to know?'),
        u(`Thank you. Could you tell me ${s.long}?`),
      ],
      ['no-slang', 'no-praise', 'no-offer', 'greet-once', 'not-a-question'],
      s.answer,
      `Thank you. I should like to know ${s.long}.`,
    );
  },
  'chat-hurry'(t, i) {
    const s = sumOf(t, i);
    return made(
      'hurry',
      [u(`Sorting out ${opener(t)}.`), a('Understood. What do you need?'), u(`Quick, I have two minutes: ${s.plain}?`)],
      ['answer-first', 'short', 'no-praise', 'no-offer'],
      s.answer,
      `No time, quickly: ${s.plain}?`,
    );
  },
  'chat-heavy'(t, i) {
    const s = sumOf(t, i);
    return made(
      'heavy',
      [
        u(`It has been a hard week. My father is in hospital and I still have to sort out ${opener(t)}.`),
        a('I am sorry to hear that. Tell me what you need and we will get it done.'),
        u(`Thank you. I need to know ${s.long}.`),
      ],
      ['steady', 'no-praise', 'no-offer', 'no-echo'],
      s.answer,
      `Thanks. Could you tell me ${s.long}?`,
    );
  },
  'chat-thanks'(t, i) {
    const s = sumOf(t, i);
    // (the answer was given in the turn before: the reply to thanks need not say it again, so it is not asked for here)
    return {
      ...made(
        'thanks',
        [
          u(`Could you work out ${s.long}?`),
          a(`That comes to ${s.answer[0]}.`),
          u(t.pick(['thanks, that is all I needed', 'Thank you, that settles it.', 'perfect, thanks'])),
        ],
        ['thanks-brief', 'no-offer', 'no-echo'],
        s.answer,
        'thank you, that is everything',
      ),
      conventions: ['thanks-brief', 'no-offer', 'no-echo'],
    };
  },
  'chat-back'(t, i) {
    const s = sumOf(t, i);
    const s2 = sumOf(t, i + 1);
    return made(
      'back',
      [
        u('Hello!'),
        a('Hello! What can I do for you?'),
        u(`Could you work out ${s.long}?`),
        a(`That comes to ${s.answer[0]}.`),
        u(`Hello again, one more: ${s2.plain}?`),
      ],
      ['greet-once', 'no-echo', 'no-praise', 'no-offer', 'short'],
      s2.answer,
      `Hello again. Another: ${s2.plain}?`,
    );
  },
};
// HARDER PEOPLE (added once the first six were read: a 2.6B module had every one of twelve right, 2026-11-24): what a
// conversation asks that a single question does not. Each needs the turns before the last.
Object.assign(CHAT_KINDS, {
  'chat-refer'(t, i) {
    const s = sumOf(t, i);
    const A = Number(s.answer[0]);
    return made(
      'refer',
      [u(`Could you work out ${s.long}?`), a(`That comes to ${A}.`), u('and double that?')],
      ['short', 'no-praise', 'no-offer', 'not-a-question'],
      [String(A * 2)],
      'What is twice that?',
    );
  },
  'chat-correct'(t) {
    const each = t.int(3, 9);
    const n = t.int(4, 12);
    const n2 = n + t.int(1, 4);
    return made(
      'correct',
      [
        u(`Could you work out the cost of ${n} tickets at ${each} pounds each?`),
        a(`That comes to ${n * each} pounds.`),
        u(`Sorry, I meant ${n2} tickets, not ${n}.`),
      ],
      ['short', 'no-praise', 'no-offer'],
      [String(n2 * each)],
      `My mistake, it is ${n2} tickets rather than ${n}.`,
    );
  },
  'chat-two'(t, i) {
    const s = sumOf(t, i);
    const s2 = sumOf(t, i + 2);
    return {
      ...made(
        'two',
        [
          u(`Hello, two quick sums for ${opener(t)}.`),
          a('Hello! Go ahead.'),
          u(`What is ${s.plain}, and ${s2.plain}?`),
        ],
        ['both', 'greet-once', 'no-praise', 'no-offer'],
        s.answer,
        `I need two things: ${s.plain}, and also ${s2.plain}.`,
      ),
      answer2: s2.answer,
    };
  },
  'chat-doubt'(t, i) {
    const s = sumOf(t, i);
    const A = Number(s.answer[0]);
    const wrong = A + t.pick([2, 5, 10]);
    return made(
      'doubt',
      [u(`Could you work out ${s.long}?`), a(`That comes to ${A}.`), u(`Are you sure? I thought it was ${wrong}.`)],
      ['firm', 'no-praise', 'no-offer'],
      [String(A)],
      `Is that right? I had ${wrong} in my head.`,
    );
  },
  'chat-remember'(t, i) {
    const s = sumOf(t, i);
    return made(
      'remember',
      [
        u(
          `One thing first: please give me figures as a bare number, no units or currency signs. I am sorting out ${opener(t)}.`,
        ),
        a('Understood, bare numbers only. What do you need?'),
        u(`${s.plain}?`),
      ],
      ['as-asked', 'no-offer'],
      s.answer,
      `what's ${s.plain}`,
    );
  },
});
// A CONVERSATION MUST STAY INTELLIGENT (console 2026-11-24, when the conversation run was set apart): any request with an
// earlier reply is of the class that is a conversation, a coding or reasoning exchange among them. So that an arrangement
// kept for its manners is not one that reasons or codes worse, two people ask for exactly that part way through.
const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gia', 'Hugo'];
// the function a reply gives, run on inputs: true where name(x) === want(x) for every x. Run with no access to anything
// (node:vm, a bare context, 200 ms), and anything that throws is not working code.
export function jsWorks(reply, name, want, inputs) {
  const text = String(reply || '');
  const block = (text.match(/```(?:js|javascript|typescript|ts)?\s*\n([\s\S]*?)```/) || [])[1] || text;
  try {
    const got = vm.runInNewContext(
      `${block}\n;(${JSON.stringify(inputs)}).map((x) => ${name}(x))`,
      Object.create(null),
      { timeout: 200 },
    );
    return Array.isArray(got) && got.length === inputs.length && got.every((v, k) => v === want(inputs[k]));
  } catch {
    return false;
  }
}
Object.assign(CHAT_KINDS, {
  'chat-reason'(t) {
    const [x, y, z] = t.mix(NAMES).slice(0, 3);
    const tall = t.pick([true, false]);
    return made(
      'reason',
      [
        u('I am lining people up by height for a photograph.'),
        a('Happy to help. Who do you have?'),
        u(`${x} is taller than ${y}. ${y} is taller than ${z}. Who is the ${tall ? 'tallest' : 'shortest'}?`),
      ],
      ['no-praise', 'no-offer', 'not-a-question'],
      [tall ? x : z],
      `${y} is shorter than ${x}, and ${z} is shorter than ${y}. Which of them is the ${tall ? 'tallest' : 'shortest'}?`,
    );
  },
  'chat-code'(t) {
    const k = t.int(3, 9);
    const name = 'times' + k;
    return {
      ...made(
        'code',
        [
          u('I need a JavaScript function `double(n)` that doubles a number.'),
          a('```js\nfunction double(n) {\n  return n * 2;\n}\n```'),
          u(`Now make one that multiplies by ${k} instead, and call it \`${name}\`.`),
        ],
        ['no-offer'],
        [],
        `Change it to multiply by ${k}, and name the function \`${name}\`.`,
      ),
      conventions: ['works', 'no-offer'],
      works: (reply) => jsWorks(reply, name, (x) => x * k, [0, 1, 7, -3]),
    };
  },
});
export const CHAT_KIND_NAMES = Object.keys(CHAT_KINDS);

// THE READERS ARE CHECKED BEFORE THEY ARE BELIEVED: replies whose verdict is known (training/manners-fixtures.json), read by the
// conventions above. node training/tasks-chat.mjs --check prints each misreading and exits 1 where there is one.
export function checkReaders(fixtures) {
  const wrong = [];
  for (const f of fixtures || []) {
    const got = (f.conventions || []).filter(
      (id) =>
        !CONVENTIONS[id].holds(f.reply, { turns: f.turns || [], answer: f.answer || [], answer2: f.answer2 || [] }),
    );
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...(f.missed || [])].sort()))
      wrong.push({ reply: f.reply, said: got, known: f.missed || [] });
  }
  return wrong;
}
if (process.argv[1] && process.argv[1].endsWith('tasks-chat.mjs') && process.argv.includes('--check')) {
  const fs = await import('node:fs');
  const fixtures = JSON.parse(fs.readFileSync(new URL('./manners-fixtures.json', import.meta.url), 'utf8')).replies;
  const wrong = checkReaders(fixtures);
  for (const w of wrong) console.log('MISREAD ' + JSON.stringify(w));
  console.log(fixtures.length - wrong.length + ' of ' + fixtures.length + ' replies read as they are known to be');
  process.exit(wrong.length ? 1 : 0);
}
