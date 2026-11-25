// tasks.mjs - THE QUESTIONS, AND WHAT IT MEANS FOR TWO ANSWERS TO THEM TO BE EQUIVALENT. Parity is equivalence, and what is being
// brought to parity is THE WORK OF A SEAT ON A TEAM (The Crew): programming (tasks-code.mjs), where two answers are equivalent
// when they FUNCTION the same, and the conversation around it (tasks-crew.mjs), where two replies are equivalent when they
// understand the person the same way and do the same thing for them.
//   a function asked for      the two functions are run on the same inputs, and are equivalent when every call gives the same
//   a value asked for         the two values are read off the replies and are the same value, however written
//   an answer in words        a decision model (the judge, else the decider) says whether the two say fundamentally the same thing
//   a reply in a conversation the same act (both help, or both ask), the same substance, and no convention of the conversation
//                             broken that the larger model kept (support/equivalent.mjs: talkEquivalent)
// Nothing here is marked against a right answer: the larger model's reply is the mark (support/equivalent.mjs).
// Every question is MADE, from a seed, so there is no list to learn by heart:
//   train      the questions a brief or an arrangement is chosen on
//   held       questions of the same kinds from another seed, never used to choose anything: what is reported
//   tasks({ split: 'train' | 'held', each: 6, kinds: [...], seed, focus })
//     -> [{ id, kind, type ('code' | 'value' | 'open' | 'talk'), split, seed, ask, equivalent(refReply, reply, ctx), show(reply), wrap(final) }]
//   messagesOf(task) -> what is sent: the question alone, or a conversation's system line and its turns
import { CODE_KINDS, PY_KINDS, pyLit } from './tasks-code.mjs';
import fs from 'node:fs';
import { CREW_KINDS, CREW_KIND_NAMES, ownQuestion } from './tasks-crew.mjs';
import {
  codeEquivalent,
  openEquivalent,
  talkEquivalent,
  codeOf,
  codeWhole,
  pyEquivalent,
  pyCodeOf,
} from './support/equivalent.mjs';
import { TOOL_KINDS, sameStep, stepGood } from './tasks-tools.mjs';
import { RULE_KINDS, rulesHeld } from './tasks-rules.mjs';
import { CHAT_KINDS, CHAT_KIND_NAMES, CONVENTIONS, conventionsHeld } from './tasks-chat.mjs';
import { CALL_KINDS } from './tasks-calls.mjs';
import { SEARCH_KINDS } from './tasks-search.mjs';
import { LOGIC_KINDS, logicTask, asShown } from './tasks-logic.mjs';
import { LATER_KINDS } from './tasks-later.mjs';
import { EXACT_KINDS, setWordings } from './tasks-exact.mjs';
// (the wordings the larger model wrote in this pass, where a session names their file: training/wordings.mjs)
if (process.env.SWARM_WORDINGS) {
  try {
    setWordings(JSON.parse(fs.readFileSync(process.env.SWARM_WORDINGS, 'utf8')));
  } catch {
    /* none written yet: the questions are worded as this repository words them */
  }
}

const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const tools = (r, split = 'train') => ({
  split,
  int: (a, b) => a + Math.floor(r() * (b - a + 1)),
  pick: (list) => list[Math.floor(r() * list.length)],
  mix: (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
});

// ---- reading a reply
const NUM = /-?\d[\d,]*(?:\.\d+)?/g;
const nums = (s) => (String(s).match(NUM) || []).map((x) => Number(x.replace(/,/g, ''))).filter(Number.isFinite);
// the part of a reply that says what it settled on: its last line with anything in it, or the sentence that says "answer"
const settled = (reply) => {
  const lines = String(reply || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const named = lines.filter((l) => /\banswer\b|\btherefore\b|\bso\b|\bis\b|=/i.test(l));
  return { first: lines[0] || '', last: lines[lines.length - 1] || '', named, all: lines.join('\n') };
};
// a number: right when the reply's first line or its last line settles on it
const number = (want) =>
  tagged('number', (reply) => {
    const s = settled(reply);
    const first = nums(s.first);
    const last = nums(s.last);
    const every = nums(s.all);
    if (!every.length) return 'unsure';
    const near = (v) => Math.abs(v - want) < 1e-6 * Math.max(1, Math.abs(want));
    if ((last.length && near(last[last.length - 1])) || (first.length && near(first[0]))) return 'right';
    // it says the number somewhere and settles on nothing else in its first or last line
    if (!first.length && !last.length && every.some(near)) return 'right';
    return 'wrong';
  });
// one of several words: right when the one wanted is the last of them the reply names (or the first, in a reply that leads with it)
const choice = (want, among) =>
  tagged(
    'choice',
    (reply) => {
      const text = String(reply || '').toLowerCase();
      const at = among
        .map((w) => ({
          w,
          first: text.search(new RegExp('\\b' + w.toLowerCase() + '\\b')),
          last: text.lastIndexOf(w.toLowerCase()),
        }))
        .filter((x) => x.first >= 0);
      if (!at.length) return 'unsure';
      if (at.length === 1) return at[0].w === want ? 'right' : 'wrong';
      // it names several (it showed its work): the line that settles is its first line or its last, when that line names only one
      const s = settled(reply);
      for (const line of [s.last, s.first]) {
        const inLine = among.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(line));
        if (inLine.length === 1) return inLine[0] === want ? 'right' : 'wrong';
      }
      const end = [...at].sort((a, b) => b.last - a.last)[0].w;
      return end === want ? 'right' : 'unsure';
    },
    among,
  );
const exact = (want) =>
  tagged('exact', (reply) => {
    const text = String(reply || '')
      .toLowerCase()
      .replace(/[`*"']/g, '');
    if (
      new RegExp('(^|[^a-z0-9])' + want.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(
        text,
      )
    )
      return 'right';
    return /\b(not sure|cannot|can't|could not|couldn't|do not know|don't know|unclear)\b/.test(text)
      ? 'unsure'
      : 'wrong';
  });

// WHAT A REPLY SETTLED ON, read without knowing what was wanted. The swarm is trained to give the answer the LARGER MODEL gives,
// so the larger model's reply has to be read for its answer, and then any other reply graded against that.
//   readAs(type, among, ask)(reply) -> the answer as text, or '' when the reply settles on nothing
//   graderFor(type, among)(answer)  -> a grader against that answer: right (equivalent), wrong (different), unsure (none)
function tagged(type, fn, among) {
  fn.type = type;
  fn.among = among;
  return fn;
}
const readAs = (type, among, ask) => (reply) => {
  const s = settled(reply);
  if (type === 'number') {
    const last = nums(s.last);
    const first = nums(s.first);
    const every = nums(s.all);
    const v = last.length
      ? last[last.length - 1]
      : first.length
        ? first[0]
        : every.length
          ? every[every.length - 1]
          : null;
    return v === null ? '' : String(v);
  }
  if (type === 'choice') {
    const text = s.all.toLowerCase();
    const named = among.filter((w) => new RegExp('\\b' + w.toLowerCase() + '\\b').test(text));
    if (named.length <= 1) return named[0] || '';
    for (const line of [s.last, s.first]) {
      const inLine = among.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(line));
      if (inLine.length === 1) return inLine[0];
    }
    return [...named].sort((a, b) => text.lastIndexOf(b.toLowerCase()) - text.lastIndexOf(a.toLowerCase()))[0];
  }
  // a word put through changes: the last word in the reply made of the question's own letters, one short of them
  const src = ((String(ask).match(/"([A-Za-z]+)"/) || [])[1] || '').toLowerCase();
  const bag = (w) => w.toLowerCase().split('').sort().join('');
  const words = (s.all.replace(/[`*"']/g, '').match(/[A-Za-z]{2,}/g) || []).reverse();
  for (const w of words) {
    if (w.length !== src.length - 1) continue;
    const rest = src.split('');
    if (
      w
        .toLowerCase()
        .split('')
        .every((c) => rest.includes(c) && rest.splice(rest.indexOf(c), 1))
    )
      return w;
  }
  return bag(src) ? '' : '';
};
// a series (words in an order, or brackets in an order): right when the reply holds it, in that order, however it parts the
// items (a space, a comma, a line); the marks of a series of brackets are compared with nothing between them
const series = (want) =>
  tagged('series', (reply) => {
    const letters = /[a-z0-9]/i.test(want);
    const flat = (x) =>
      letters
        ? ' ' +
          String(x || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim() +
          ' '
        : String(x || '').replace(/[\s,`'"]+/g, '');
    if (!flat(reply).trim()) return 'unsure';
    return flat(reply).includes(flat(want)) ? 'right' : 'wrong';
  });
const graderFor = (type, among) => (answer) =>
  type === 'number'
    ? number(Number(answer))
    : type === 'choice'
      ? choice(String(answer), among)
      : type === 'series'
        ? series(String(answer))
        : exact(String(answer));

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gia', 'Hugo', 'Ines', 'Jon', 'Kai', 'Lena'];
const THINGS = ['apples', 'pencils', 'tickets', 'bricks', 'stamps', 'cards', 'bolts', 'seeds'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// EACH KIND SAYS ITS QUESTION A SECOND WAY (again), from the same numbers and names: how it is put changes (what is asked comes
// first where it came last, or the facts are led into another way) and nothing of what it asks. Every number, name and step is
// there, in the same order; nothing more is drawn from the seed for it, so the first wording is made exactly as it was.
const KINDS = {
  // several operations in a row: one slip and the whole thing is wrong
  chain(t) {
    const a = t.int(12, 60),
      b = t.int(3, 9),
      c = t.int(11, 90),
      d = t.int(2, 6),
      e = t.int(5, 40);
    const want = (a * b - c) * d + e;
    return {
      ask: `Start with ${a}. Multiply it by ${b}. Subtract ${c}. Multiply the result by ${d}. Add ${e}. What number do you have?`,
      again: `What number do you have at the end of these steps? Start with ${a}. Multiply it by ${b}. Subtract ${c}. Multiply the result by ${d}. Add ${e}.`,
      want,
      grade: number(want),
    };
  },
  // a word problem with a number in it that is not needed
  shop(t) {
    const who = t.pick(NAMES),
      thing = t.pick(THINGS);
    const boxes = t.int(3, 9),
      per = t.int(6, 24),
      gave = t.int(5, 30),
      price = t.int(2, 9),
      age = t.int(20, 60);
    const left = boxes * per - gave;
    const want = left * price;
    return {
      ask: `${who}, who is ${age}, buys ${boxes} boxes of ${thing} with ${per} in each box, gives ${gave} of them away, and sells every one that is left for $${price} each. How many dollars does ${who} take in?`,
      again: `How many dollars does ${who} take in? Here is what happened: ${who}, who is ${age}, buys ${boxes} boxes of ${thing} with ${per} in each box, gives ${gave} of them away, and sells every one that is left for $${price} each.`,
      want,
      grade: number(want),
    };
  },
  // rates: the answer is not the average of the two
  rate(t) {
    const a = t.pick([2, 3, 4, 6]),
      b = t.pick([3, 4, 6, 12].filter((x) => x !== a));
    const want = Math.round(((a * b) / (a + b)) * 60);
    return {
      ask: `One pump fills a tank in ${a} hours. A second pump fills the same tank in ${b} hours. Running both together, how many minutes does it take to fill the tank?`,
      again: `Work out how many minutes it takes to fill a tank with two pumps running together. One pump fills the tank in ${a} hours. The second pump fills the same tank in ${b} hours.`,
      want,
      grade: number(want),
    };
  },
  // a day of the week some days on
  day(t) {
    const from = t.int(0, 6),
      n = t.int(9, 200);
    const want = DAYS[(from + n) % 7];
    return {
      ask: `Today is ${DAYS[from]}. What day of the week will it be ${n} days from now?`,
      again: `What day of the week will it be ${n} days from now, if today is ${DAYS[from]}?`,
      want,
      grade: choice(want, DAYS),
    };
  },
  // who is first, from statements given out of order
  order(t) {
    const who = t.mix(NAMES).slice(0, 5); // tallest first
    const facts = [];
    for (let i = 0; i < 4; i++)
      facts.push(i % 2 ? `${who[i + 1]} is shorter than ${who[i]}.` : `${who[i]} is taller than ${who[i + 1]}.`);
    const which = t.pick(['tallest', 'shortest', 'second tallest']);
    const want = which === 'tallest' ? who[0] : which === 'shortest' ? who[4] : who[1];
    const told = t.mix(facts).join(' ');
    return {
      ask: `${told} Who is the ${which}?`,
      again: `Who is the ${which}? These are the facts. ${told}`,
      want,
      grade: choice(want, who),
    };
  },
  // counting letters: a thing small models get wrong by guessing
  letters(t) {
    const word = t.pick([
      'strawberry',
      'bookkeeper',
      'mississippi',
      'committee',
      'parallel',
      'assessment',
      'banana',
      'possession',
      'cappuccino',
      'referee',
    ]);
    const letter = t.pick([...new Set(word)].filter((c) => word.split(c).length - 1 >= 2));
    const want = word.split(letter).length - 1;
    return {
      ask: `How many times does the letter "${letter}" appear in the word "${word}"?`,
      again: `Look at the word "${word}". How many times is the letter "${letter}" in it?`,
      want,
      grade: number(want),
    };
  },
  // what a short program prints: every step must be followed
  trace(t) {
    const n = t.int(4, 8),
      m = t.int(2, 4),
      k = t.int(1, 5);
    let x = k;
    for (let i = 1; i <= n; i++) x = i % m === 0 ? x - i : x + i * 2;
    return {
      ask: `What does this print?\n\nlet x = ${k};\nfor (let i = 1; i <= ${n}; i++) {\n  if (i % ${m} === 0) x = x - i;\n  else x = x + i * 2;\n}\nconsole.log(x);`,
      want: x,
      grade: number(x),
    };
  },
  // read a figure out of a passage with others near it
  extract(t) {
    const rows = t
      .mix(NAMES)
      .slice(0, 4)
      .map((n) => ({ n, q1: t.int(100, 900), q2: t.int(100, 900), q3: t.int(100, 900) }));
    const row = t.pick(rows),
      q = t.pick(['q1', 'q2', 'q3']);
    const other = t.pick(['q1', 'q2', 'q3'].filter((x) => x !== q));
    const want = row[q] - row[other];
    const name = { q1: 'the first quarter', q2: 'the second quarter', q3: 'the third quarter' };
    const told = rows
      .map((r) => `${r.n} sold ${r.q1} units in the first quarter, ${r.q2} in the second and ${r.q3} in the third.`)
      .join(' ');
    const asked = `How many more units did ${row.n} sell in ${name[q]} than in ${name[other]}? (Give a negative number if fewer.)`;
    return {
      ask: told + ' ' + asked,
      again: asked + ' The figures: ' + told,
      want,
      grade: number(want),
    };
  },
  // the first answer that comes to mind is wrong
  trap(t) {
    const all = [
      () => {
        const d = t.int(2, 9) * 10,
          total = d + 2 * t.int(1, 4) * 5;
        const ball = (total - d) / 2;
        return {
          ask: `A notebook and a pen cost ${total} cents together. The notebook costs ${d} cents more than the pen. How many cents does the pen cost?`,
          again: `How many cents does the pen cost, if a notebook and a pen cost ${total} cents together and the notebook costs ${d} cents more than the pen?`,
          want: ball,
        };
      },
      () => {
        const n = t.int(5, 40);
        return {
          ask: `${n} machines take ${n} minutes to make ${n} parts. How many minutes do 100 machines take to make 100 parts?`,
          again: `How many minutes do 100 machines take to make 100 parts, given that ${n} machines take ${n} minutes to make ${n} parts?`,
          want: n,
        };
      },
      () => {
        const days = t.int(12, 60);
        return {
          ask: `A patch of moss doubles in size every day. It takes ${days} days to cover a whole wall. On which day did it cover half the wall? Give the number of the day.`,
          again: `On which day did a patch of moss cover half of a wall, if it doubles in size every day and takes ${days} days to cover the whole wall? Give the number of the day.`,
          want: days - 1,
        };
      },
      () => {
        const pos = t.int(2, 9);
        return {
          ask: `In a race you overtake the runner who is in position ${pos}. What position are you in now? Give the number.`,
          again: `What position are you in after you overtake the runner who is in position ${pos} in a race? Give the number.`,
          want: pos,
        };
      },
      () => {
        const n = t.int(3, 9);
        return {
          ask: `A drawer holds ${n * 2} black socks and ${n * 3} white socks, mixed. Without looking, how many socks must you take out to be certain of a matching pair?`,
          again: `How many socks must you take out, without looking, to be certain of a matching pair, from a drawer that holds ${n * 2} black socks and ${n * 3} white socks, mixed?`,
          want: 3,
        };
      },
    ];
    const made = t.pick(all)();
    return { ...made, grade: number(made.want) };
  },
  // put a word through two changes
  string(t) {
    const word = t.pick([
      'planet',
      'garden',
      'silver',
      'window',
      'forest',
      'candle',
      'bridge',
      'pocket',
      'thunder',
      'marble',
    ]);
    const up = t.pick([true, false]);
    const want = (up ? word.toUpperCase() : word).split('').reverse().join('').slice(0, -1);
    return {
      ask: `Take the word "${word}". ${up ? 'Write it in capital letters. ' : ''}Reverse it. Then remove its last letter. What is left?`,
      again: `What is left of the word "${word}" after these steps, taken in this order? ${up ? 'Write it in capital letters. ' : ''}Reverse it. Then remove its last letter.`,
      want,
      grade: exact(want),
    };
  },
  // a unit changed twice
  units(t) {
    const km = t.int(3, 30) * 6,
      mins = t.pick([20, 30, 40, 45, 90]);
    const want = Math.round((km / (mins / 60)) * 100) / 100;
    return {
      ask: `A cyclist rides ${km} kilometres in ${mins} minutes at a steady speed. What is the speed in kilometres per hour?`,
      again: `What is the speed, in kilometres per hour, of a cyclist who rides ${km} kilometres in ${mins} minutes at a steady speed?`,
      want,
      grade: number(want),
    };
  },
  // a date sum across a month's end
  count(t) {
    const from = t.int(2, 20),
      to = from + t.int(15, 70);
    const all = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const by = t.pick([3, 4, 6, 7]);
    const want = all.filter((x) => x % by === 0).length;
    return {
      ask: `How many whole numbers from ${from} to ${to}, counting both ends, can be divided by ${by} with nothing left over?`,
      again: `Count the whole numbers from ${from} to ${to}, both ends included, that can be divided by ${by} with nothing left over. How many are there?`,
      want,
      grade: number(want),
    };
  },
};
// THE QUESTIONS ASKED ARE PROGRAMMING ONES (tasks-code.mjs): writing a function, correcting one, saying what one prints, saying
// what is wrong with one. The older kinds (arithmetic, days, traps) are kept under REASONING and can still be asked (--kinds).
// (new kinds go last: a kind's questions are made from where it stands in this list)
const ALL = {
  ...CODE_KINDS,
  trace: KINDS.trace,
  ...Object.fromEntries(Object.entries(KINDS).filter(([k]) => k !== 'trace')),
  ...CREW_KINDS,
  ...TOOL_KINDS,
  // (the families a SwOA's proof measures and training did not ask: instructions a program checks, calling functions, search)
  ...RULE_KINDS,
  ...CALL_KINDS,
  ...SEARCH_KINDS,
  // (harder questions of logic, each with its own answer: tasks-logic.mjs. Last, so that no earlier kind's questions change)
  ...LOGIC_KINDS,
  // (questions that are an operation code does exactly: tasks-exact.mjs. After them, for the same reason)
  ...Object.fromEntries(
    Object.entries(EXACT_KINDS).map(([k, make]) => [
      k,
      (t) => {
        const m = make(t);
        return {
          ...m,
          grade:
            m.as === 'number'
              ? number(Number(m.want))
              : m.among
                ? choice(String(m.want), m.among)
                : series(String(m.want)),
        };
      },
    ]),
  ),
  // (functions asked for in Python: tasks-code.mjs PY_KINDS. LAST, so that no earlier kind's questions change: a kind's
  // questions are seeded by where it stands here)
  ...PY_KINDS,
  // (made-up people in conversation, each reply read against conventions: tasks-chat.mjs. After every other, for the same
  // reason: no earlier kind's questions change)
  ...CHAT_KINDS,
  // (kinds added after passes had been measured: tasks-later.mjs. After EVERY other, always: no earlier kind's questions
  // change, which tests/run.mjs holds by their hash)
  ...LATER_KINDS,
};
// the programming kinds, and with them the conversation a seat on a team carries: what a pass asks, unless its record says otherwise
export const CODE_KIND_NAMES = [...Object.keys(CODE_KINDS), 'trace', ...Object.keys(PY_KINDS)];
// WHAT THE SWARM IS TRAINED ON IS EVERY BODY OF WORK (equivalence.json): The Crew, Code, Math, Logic, Reasoning, Instructions,
// Tools, Search. Each is a list of kinds, and a pass asks the kinds of them all. NOTHING IS CHOSEN (console ruling 2026-11-18;
// a person once ticked which, and a pass asked those alone): the module chooses its arrangement by the class of a request, not
// by the body of work, and a change is kept when its class got better with no kind falling, so a kind a pass does not ask is a
// kind nothing protects. What a pass asks more of is what it measured the swarm short on (focus), not what somebody picked.
export const EQUIVALENCE = JSON.parse(fs.readFileSync(new URL('./equivalence.json', import.meta.url), 'utf8'));
export const BODIES = EQUIVALENCE.targets.map((t) => t.id);
// the kinds of the bodies of work named, in the order the kinds are made in: of every one, where none is named. A name that is
// not one of them is passed over, and with none left it is every one
export function kindsFor(ids = BODIES) {
  const of = (list) => EQUIVALENCE.targets.filter((t) => (list || []).includes(t.id));
  const picked = of(ids).length ? of(ids) : EQUIVALENCE.targets;
  const want = new Set(picked.flatMap((t) => t.kinds));
  return Object.keys(ALL).filter((k) => want.has(k));
}
export const KIND_NAMES = kindsFor();
// THE BODIES OF WORK A LIST OF KINDS COVERS: those whose every kind is among them (Code's are among The Crew's, so a pass that
// asks The Crew's covers both). What a pass asked is said by this, from the pass's own questions, and never from a setting
export const bodiesOf = (kinds) =>
  EQUIVALENCE.targets.filter((t) => t.kinds.length && t.kinds.every((k) => (kinds || []).includes(k))).map((t) => t.id);
// THE QUESTIONS A PERSON WROTE for each body of work (training/questions/<id>.json, edited from the page): { id: [{ ask,
// mode }] }, of every one where none is named. They are asked beside the ones made: an addition, never a filter. A file that is
// missing or will not read is no questions.
export const QUESTIONS_DIR = process.env.SWARM_QUESTIONS_DIR || new URL('./questions/', import.meta.url).pathname;
export const MOST_OWN = 200;
export function readOwn(ids = BODIES) {
  const out = {};
  const named = (ids || []).filter((i) => BODIES.includes(i));
  for (const id of named.length ? named : BODIES) {
    try {
      const j = JSON.parse(fs.readFileSync(QUESTIONS_DIR.replace(/\/?$/, '/') + id + '.json', 'utf8'));
      const list = (Array.isArray(j.questions) ? j.questions : [])
        .filter((q) => q && String(q.ask || '').trim())
        .slice(0, MOST_OWN)
        .map((q) => ({
          ask: String(q.ask).trim().slice(0, 2000),
          ...(q.mode === 'developer' ? { mode: 'developer' } : {}),
        }));
      if (list.length) out[id] = list;
    } catch {
      /* none written */
    }
  }
  return out;
}
export { CREW_KIND_NAMES, CHAT_KIND_NAMES };
// what is sent for a question: the question alone, or (a conversation) the system line a seat is given and the turns so far
// DOES A QUESTION CARRY A STANDARD OF ITS OWN? Then an answer to it is graded against the question (good), and the larger model's
// answer is one more answer graded the same way: not the mark (docs/swoa-parity.md, 4)
export const ownStandard = (t) => !!t && typeof t.good === 'function';
export const messagesOf = (t) =>
  t.turns
    ? [...(t.system ? [{ role: 'system', content: t.system }] : []), ...t.turns]
    : [{ role: 'user', content: t.ask }];
export const REASONING = Object.keys(KINDS).filter((k) => k !== 'trace');
export const SEEDS = { train: 1009, held: 7919 };

// focus: { kind: so many more of it } - a kind the swarm is not equivalent on is asked more of (train only: the held questions
// never change with what was found)
// Every question carries the three things parity needs, whatever kind it is:
//   equivalent(refReply, reply, { reader }) -> { grade }   is this reply fundamentally equivalent to the larger model's reply?
//                                                       right (equivalent)  wrong (different)  unsure (it gave no answer)
//                                                       noref (the larger model gave none, or nothing here can compare them)
//   usable(reply)                                       does this reply hold an answer at all (a whole function, a value, a sentence)?
//   show(reply)                                         the answer in a reply, short, for a person to read
//   wrap(final)                                         what one slot settled on, put as a reply, so that it can be compared too
// EVERY QUESTION A SECOND WAY. Equivalence that holds for one wording of a question and not for another is not fundamental. The
// second wording changes how the question is put and nothing of what it asks: the description of what the function does is
// word for word the same, and so is every number, name, rule and argument of the other kinds (each kind that is not a
// programming question says its own second wording, from the same draw: `again`). A question with no second wording is left
// out: a few of a conversation's (a message there is no other way to put) and of an agent's steps (those that end on what a
// tool returned).
export function reword(ask) {
  const s = String(ask);
  const fix = 'This function is meant to do the following, and it is wrong.\n\nWhat it should do: ';
  if (s.startsWith(fix)) {
    const body =
      'There is a mistake in the function below.\n\nIt is supposed to work like this: ' + s.slice(fix.length);
    if (body.endsWith('Give the corrected function, in one code block, with the same name.'))
      return body.replace(
        /Give the corrected function, in one code block, with the same name\.$/,
        'Put it right. Reply with the whole corrected function, keeping its name, in one code block.',
      );
    if (/In one or two sentences, what is the bug\? Do not rewrite the function\.$/.test(body))
      return body.replace(
        /In one or two sentences, what is the bug\? Do not rewrite the function\.$/,
        'Say what the mistake is, in a sentence or two. Do not write the function out again.',
      );
    return null;
  }
  // (a function asked for in Python: said again as a plain request)
  const py = /^Write a Python function (`[^`]+`) that /.exec(s);
  if (py) return 'I need a function in Python, ' + py[1] + '. It ' + s.slice(py[0].length);
  const write = /^Write a JavaScript function (`[^`]+`) that /.exec(s);
  if (write) return 'I need a function in JavaScript, ' + write[1] + '. It ' + s.slice(write[0].length);
  if (s.startsWith('What does this print?\n\n'))
    return (
      'Read this short JavaScript program and say what number it prints.\n\n' +
      s.slice('What does this print?\n\n'.length)
    );
  return null;
}
export const reworded = (list) =>
  list
    .map((t) => {
      // a conversation carries its own second wording (tasks-crew.mjs): the last message put another way, the rest as it was
      // (a step in an agent's work is put another way where its last turn is the person's own; one whose question is followed by
      // a search and what it returned gives its turns whole, the question put another way and the rest as they were: againTurns).
      // A kind whose answer is a value or a piece kept to rules says its own second wording too (again); a programming question
      // is put another way by its form (reword)
      const ask = t.type === 'talk' || t.type === 'tool' || t.type === 'chat' ? t.again : t.again || reword(t.ask);
      const turns = t.againTurns || (t.turns && ask ? [...t.turns.slice(0, -1), { role: 'user', content: ask }] : null);
      return {
        ...t,
        id: t.id + '~2',
        split: 'reworded',
        refId: t.id,
        ask,
        ...(turns && ask ? { turns } : {}),
      };
    })
    .filter((t) => t.ask);

// own: the questions a person wrote ({ id: [{ ask, mode }] }, readOwn), asked after the ones made: the first, third, fifth ... are
// train questions and the second, fourth ... held ones, so that what the swarm is measured on is never what it was chosen on
export function tasks({
  split = 'train',
  each = 6,
  kinds = KIND_NAMES,
  seed,
  focus = {},
  tiers = {},
  own = {},
  shown = 0,
} = {}) {
  const from = seed !== undefined ? seed : SEEDS[split] !== undefined ? SEEDS[split] : Date.now() % 1e6;
  const out = [];
  kinds.forEach((kind) => {
    const r = rng(from + Object.keys(ALL).indexOf(kind) * 131);
    const t = tools(r, split);
    // A BAR THAT IS HELD TIGHTENS: a kind the swarm has been at parity on for several passes is asked more of (tiers), on train
    // and held alike. The questions it was at parity on stay; more are added after them.
    const n =
      each + (split === 'train' ? Number(focus[kind]) || 0 : 0) + (Number(tiers[kind]) || 0) * Math.ceil(each / 2);
    for (let i = 0; i < n; i++) {
      const made = ALL[kind](t, i);
      const base = {
        // (a question worded by one of the larger model's wordings is another question than the one this place held before: it
        // says which wording, so that no answer kept for the one is taken for the other)
        id: split + '-' + from + '-' + kind + '-' + (i + 1) + (made.tag ? '.w' + made.tag : ''),
        kind,
        split,
        seed: from,
        ask: made.ask,
        type: made.type || 'value',
      };
      if (made.type === 'code' && made.lang === 'python')
        // A FUNCTION ASKED FOR IN PYTHON (tasks-code.mjs PY_KINDS): run in Python, marked against the family's own function
        out.push({
          ...base,
          name: made.name,
          pyName: made.pyName,
          lang: 'python',
          inputs: made.inputs,
          ok: made.ok,
          ...(made.calls ? { calls: made.calls, expected: made.expected } : {}),
          equivalent: (refReply, reply) => pyEquivalent(refReply, reply, made, { lit: pyLit }),
          good: async (reply) => {
            const g = await pyEquivalent('', reply, made, { refIsOk: true, lit: pyLit });
            return { ...g, score: g.grade === 'right' ? 1 : typeof g.share === 'number' ? g.share : 0 };
          },
          usable: (reply) => new RegExp('def\\s+' + made.pyName + '\\s*\\(').test(pyCodeOf(reply, made.pyName)),
          toSpec: async (reply) =>
            (await pyEquivalent('', reply, made, { refIsOk: true, lit: pyLit })).grade === 'right',
          show: (reply) => {
            const c = pyCodeOf(reply, made.pyName);
            return c
              ? c.split('\n')[0].slice(0, 70) + (c.includes('\n') ? ' ... (' + c.split('\n').length + ' lines)' : '')
              : '';
          },
          wrap: (final) => '```python\n' + final + '\n```',
        });
      else if (made.type === 'code')
        out.push({
          ...base,
          name: made.name,
          inputs: made.inputs,
          ok: made.ok,
          equivalent: (refReply, reply) => codeEquivalent(refReply, reply, made),
          // GOOD, BY THE QUESTION'S OWN STANDARD (docs/swoa-parity.md, 4): the reply's function behaves as the question's correct
          // solution on the question's inputs. Its score is the share of them on which it does
          good: async (reply) => {
            const g = await codeEquivalent('```js\n' + made.ok + '\n```', reply, made);
            return { ...g, score: g.grade === 'right' ? 1 : typeof g.share === 'number' ? g.share : 0 };
          },
          usable: (reply) => codeWhole(reply, made.name),
          // does this reply's function do what the question says (what the question's own reference function does)?
          toSpec: async (reply) => (await codeEquivalent('```js\n' + made.ok + '\n```', reply, made)).grade === 'right',
          show: (reply) => {
            const c = codeOf(reply);
            return c
              ? c.split('\n')[0].slice(0, 70) + (c.includes('\n') ? ' ... (' + c.split('\n').length + ' lines)' : '')
              : '';
          },
          wrap: (final) => '```js\n' + final + '\n```',
        });
      else if (made.type === 'talk')
        out.push({
          ...base,
          mode: made.mode,
          system: made.system,
          turns: made.turns,
          again: made.again,
          limit: made.limit,
          claims: made.claims,
          equivalent: (refReply, reply, ctx) => talkEquivalent(made, refReply, reply, ctx),
          // a reply in a conversation can be two words ("You're welcome!"): anything said at all
          usable: (reply) => String(reply || '').trim().length > 1,
          show: (reply) =>
            String(reply || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
          wrap: (final) => final,
        });
      else if (made.type === 'tool')
        // A STEP IN AN AGENT'S WORK (tasks-tools.mjs): sent with its tools; the next step is the answer, the larger model's the mark
        out.push({
          ...base,
          mode: made.mode,
          system: made.system,
          turns: made.turns,
          tools: made.tools,
          again: made.again,
          ...(made.againTurns ? { againTurns: made.againTurns } : {}),
          equivalent: async (refReply, reply) => sameStep(refReply, reply),
          // (good: the step this point in the work needs, where the question was made knowing it: tasks-tools.mjs stepGood)
          ...(made.needs ? { needs: made.needs, good: async (reply) => stepGood(made.needs, reply) } : {}),
          usable: (reply) => String(reply || '').trim().length > 0,
          show: (reply) =>
            String(reply || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
          wrap: (final) => final,
        });
      else if (made.type === 'rules')
        // A REQUEST WITH RULES A PROGRAM CHECKS (tasks-rules.mjs): good when every rule holds; its score is the share that do. Two
        // replies are equivalent when they keep and break the same rules
        out.push({
          ...base,
          again: made.again || null,
          rules: made.rules.map((r) => ({ id: r.id, says: r.says })),
          good: async (reply) => {
            if (!String(reply || '').trim()) return { grade: 'unsure', score: 0 };
            const held = rulesHeld(made.rules, reply);
            const broke = made.rules.filter((r, k) => !held[k]).map((r) => r.id);
            return {
              grade: broke.length ? 'wrong' : 'right',
              score: held.filter(Boolean).length / held.length,
              ...(broke.length ? { why: 'it broke: ' + broke.join(', ') } : {}),
            };
          },
          equivalent: async (refReply, reply) =>
            !String(refReply || '').trim()
              ? { grade: 'noref' }
              : {
                  grade:
                    JSON.stringify(rulesHeld(made.rules, refReply)) === JSON.stringify(rulesHeld(made.rules, reply))
                      ? 'right'
                      : 'wrong',
                },
          toSpec: async (reply) => rulesHeld(made.rules, reply).every(Boolean),
          usable: (reply) => String(reply || '').trim().length > 1,
          show: (reply) =>
            String(reply || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
          wrap: (final) => final,
        });
      else if (made.type === 'chat')
        // A MADE-UP PERSON IN CONVERSATION (tasks-chat.mjs): good when every convention of that conversation holds, the answer
        // asked for among them; its score is the share that do, and what it missed is said (missed: the conventions' ids), so
        // that a pass can carry what was short into the next. Two replies are equivalent when they keep and miss the same
        out.push({
          ...base,
          ask: made.turns[made.turns.length - 1].content,
          type: 'chat',
          system: made.system,
          turns: made.turns,
          person: made.person,
          again: made.again || null,
          // (what the conversation says the right answer is, where it asks for one: for the code training writes, which is
          // shown examples with their answers. Never sent to a model that answers)
          answers: Array.isArray(made.answer) ? made.answer.map(String) : null,
          answers2: Array.isArray(made.answer2) ? made.answer2.map(String) : null,
          conventions: made.conventions.map((id) => ({ id, says: CONVENTIONS[id].says })),
          good: async (reply) => {
            if (!String(reply || '').trim()) return { grade: 'unsure', score: 0, missed: [...made.conventions] };
            const held = conventionsHeld(made, reply);
            const missed = made.conventions.filter((id, k) => !held[k]);
            return {
              grade: missed.length ? 'wrong' : 'right',
              score: held.filter(Boolean).length / held.length,
              missed,
              ...(missed.length ? { why: 'it missed: ' + missed.join(', ') } : {}),
            };
          },
          equivalent: async (refReply, reply) =>
            !String(refReply || '').trim()
              ? { grade: 'noref' }
              : {
                  grade:
                    JSON.stringify(conventionsHeld(made, refReply)) === JSON.stringify(conventionsHeld(made, reply))
                      ? 'right'
                      : 'wrong',
                },
          toSpec: async (reply) => conventionsHeld(made, reply).every(Boolean),
          usable: (reply) => String(reply || '').trim().length > 1,
          show: (reply) =>
            String(reply || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
          wrap: (final) => final,
        });
      else if (made.among)
        // A QUESTION OF LOGIC WITH ITS OWN ANSWER (tasks-logic.mjs): one of a few options, or one of two words
        out.push(logicTask(base, made));
      else if (made.type === 'open')
        out.push({
          ...base,
          flaw: made.flaw,
          equivalent: (refReply, reply, ctx) => openEquivalent(made.ask, refReply, reply, ctx),
          // (good: the reply says the flaw the question was made with, as the reader reads it; its score is that reading)
          ...(made.flaw
            ? {
                good: async (reply, ctx) => {
                  const g = await openEquivalent(made.ask, 'The mistake: ' + made.flaw + '.', reply, ctx);
                  return { ...g, ...(typeof g.p === 'number' ? { score: g.p } : {}) };
                },
                toSpec: async (reply, ctx) => {
                  const g = await openEquivalent(made.ask, 'The mistake: ' + made.flaw + '.', reply, ctx);
                  return g.grade === 'noref' ? null : g.grade === 'right';
                },
              }
            : {}),
          // an answer in words says something: a reply cut off after a word or two does not
          usable: (reply) =>
            String(reply || '')
              .trim()
              .split(/\s+/).length >= 6,
          show: (reply) =>
            String(reply || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
          wrap: (final) => final,
        });
      else {
        const read = readAs(made.grade.type, made.grade.among, made.ask);
        const gradeFor = graderFor(made.grade.type, made.grade.among);
        out.push({
          ...base,
          again: made.again || null,
          want: made.want,
          grade: made.grade,
          read,
          gradeFor,
          equivalent: async (refReply, reply) => {
            const theirs = read(refReply);
            return { grade: theirs ? gradeFor(theirs)(reply) : 'noref' };
          },
          usable: (reply) => !!read(reply),
          // (good: the reply gives the question's own answer)
          ...(made.want === undefined
            ? {}
            : {
                good: async (reply) => {
                  const grade = gradeFor(String(made.want))(reply);
                  return { grade, score: grade === 'right' ? 1 : 0 };
                },
              }),
          toSpec: async (reply) => (made.want === undefined ? null : gradeFor(String(made.want))(reply) === 'right'),
          show: read,
          wrap: (final) => 'ANSWER: ' + final,
        });
      }
    }
    // AND SOME OF THE KIND PUT AS A STANDARD TEST PUTS A QUESTION (shown: how many; tasks-logic.mjs asShown says why): further
    // questions of the kind, not the ones above again, each after three worked examples made from a seed of their own. Only a
    // kind whose questions carry an answer of their own in a word, a number or an option.
    if (shown > 0 && !/-shown$/.test(kind)) {
      const more = tasks({ split, each: n + shown, kinds: [kind], seed: from }).slice(n);
      const examples = tasks({ split, each: 3, kinds: [kind], seed: from + 7919 });
      if (
        more.length &&
        more.every((x) => x.type === 'value' && x.want !== undefined) &&
        examples.every((x) => x.want !== undefined)
      )
        for (const x of more) out.push(asShown(x, examples));
    }
  });
  // the questions a person wrote
  for (const [target, list] of Object.entries(own || {}))
    (list || []).forEach((q, i) => {
      if (i % 2 !== (split === 'held' ? 1 : 0) || !String((q && q.ask) || '').trim()) return;
      const made = ownQuestion(target, q, i);
      out.push({
        id: split + '-own-' + target + '-' + (i + 1),
        kind: 'own-' + target,
        split,
        seed: from,
        ask: made.ask,
        type: 'talk',
        mode: made.mode,
        system: made.system,
        turns: made.turns,
        again: null,
        limit: made.limit,
        claims: made.claims,
        equivalent: (refReply, reply, ctx) => talkEquivalent(made, refReply, reply, ctx),
        usable: (reply) => String(reply || '').trim().length > 1,
        show: (reply) =>
          String(reply || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160),
        wrap: (final) => final,
      });
    });
  return out;
}
