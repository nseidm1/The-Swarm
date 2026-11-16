// tasks.mjs - THE QUESTIONS, AND WHAT IT MEANS FOR TWO ANSWERS TO THEM TO BE EQUIVALENT. Parity is equivalence, and what is being
// brought to parity is PROGRAMMING: so the questions are programming questions (tasks-code.mjs), and two answers are equivalent
// when they FUNCTION the same.
//   a function asked for      the two functions are run on the same inputs, and are equivalent when every call gives the same
//   a value asked for         the two values are read off the replies and are the same value, however written
//   an answer in words        a decision model (Kev) says whether the two say fundamentally the same thing
// Nothing here is marked against a right answer: the larger model's reply is the mark (support/equivalent.mjs).
// Every question is MADE, from a seed, so there is no list to learn by heart:
//   train      the questions a brief or an arrangement is chosen on
//   held       questions of the same kinds from another seed, never used to choose anything: what is reported
//   tasks({ split: 'train' | 'held', each: 6, kinds: [...], seed, focus })
//     -> [{ id, kind, type ('code' | 'value' | 'open'), split, seed, ask, equivalent(refReply, reply, ctx), show(reply), wrap(final) }]
import { CODE_KINDS } from './tasks-code.mjs';
import { codeEquivalent, openEquivalent, codeOf, codeWhole } from './support/equivalent.mjs';

const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const tools = (r) => ({
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
const graderFor = (type, among) => (answer) =>
  type === 'number'
    ? number(Number(answer))
    : type === 'choice'
      ? choice(String(answer), among)
      : exact(String(answer));

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gia', 'Hugo', 'Ines', 'Jon', 'Kai', 'Lena'];
const THINGS = ['apples', 'pencils', 'tickets', 'bricks', 'stamps', 'cards', 'bolts', 'seeds'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
    return { ask: `${t.mix(facts).join(' ')} Who is the ${which}?`, want, grade: choice(want, who) };
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
    return {
      ask:
        rows
          .map((r) => `${r.n} sold ${r.q1} units in the first quarter, ${r.q2} in the second and ${r.q3} in the third.`)
          .join(' ') +
        ` How many more units did ${row.n} sell in ${name[q]} than in ${name[other]}? (Give a negative number if fewer.)`,
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
          want: ball,
        };
      },
      () => {
        const n = t.int(5, 40);
        return {
          ask: `${n} machines take ${n} minutes to make ${n} parts. How many minutes do 100 machines take to make 100 parts?`,
          want: n,
        };
      },
      () => {
        const days = t.int(12, 60);
        return {
          ask: `A patch of moss doubles in size every day. It takes ${days} days to cover a whole wall. On which day did it cover half the wall? Give the number of the day.`,
          want: days - 1,
        };
      },
      () => {
        const pos = t.int(2, 9);
        return {
          ask: `In a race you overtake the runner who is in position ${pos}. What position are you in now? Give the number.`,
          want: pos,
        };
      },
      () => {
        const n = t.int(3, 9);
        return {
          ask: `A drawer holds ${n * 2} black socks and ${n * 3} white socks, mixed. Without looking, how many socks must you take out to be certain of a matching pair?`,
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
      want,
      grade: number(want),
    };
  },
};
// THE QUESTIONS ASKED ARE PROGRAMMING ONES (tasks-code.mjs): writing a function, correcting one, saying what one prints, saying
// what is wrong with one. The older kinds (arithmetic, days, traps) are kept under REASONING and can still be asked (--kinds).
const ALL = {
  ...CODE_KINDS,
  trace: KINDS.trace,
  ...Object.fromEntries(Object.entries(KINDS).filter(([k]) => k !== 'trace')),
};
export const KIND_NAMES = [...Object.keys(CODE_KINDS), 'trace'];
export const REASONING = Object.keys(KINDS).filter((k) => k !== 'trace');
export const SEEDS = { train: 1009, held: 7919 };

// focus: { kind: so many more of it } - a kind the swarm is not equivalent on is asked more of (train only: the held questions
// never change with what was found)
// Every question carries the three things parity needs, whatever kind it is:
//   equivalent(refReply, reply, { kev }) -> { grade }   is this reply fundamentally equivalent to the larger model's reply?
//                                                       right (equivalent)  wrong (different)  unsure (it gave no answer)
//                                                       noref (the larger model gave none, or nothing here can compare them)
//   usable(reply)                                       does this reply hold an answer at all (a whole function, a value, a sentence)?
//   show(reply)                                         the answer in a reply, short, for a person to read
//   wrap(final)                                         what one slot settled on, put as a reply, so that it can be compared too
export function tasks({ split = 'train', each = 6, kinds = KIND_NAMES, seed, focus = {} } = {}) {
  const from = seed !== undefined ? seed : SEEDS[split] !== undefined ? SEEDS[split] : Date.now() % 1e6;
  const out = [];
  kinds.forEach((kind) => {
    const r = rng(from + Object.keys(ALL).indexOf(kind) * 131);
    const t = tools(r);
    const n = each + (split === 'train' ? Number(focus[kind]) || 0 : 0);
    for (let i = 0; i < n; i++) {
      const made = ALL[kind](t, i);
      const base = {
        id: split + '-' + from + '-' + kind + '-' + (i + 1),
        kind,
        split,
        seed: from,
        ask: made.ask,
        type: made.type || 'value',
      };
      if (made.type === 'code')
        out.push({
          ...base,
          name: made.name,
          inputs: made.inputs,
          ok: made.ok,
          equivalent: (refReply, reply) => codeEquivalent(refReply, reply, made),
          usable: (reply) => codeWhole(reply, made.name),
          show: (reply) => {
            const c = codeOf(reply);
            return c
              ? c.split('\n')[0].slice(0, 70) + (c.includes('\n') ? ' ... (' + c.split('\n').length + ' lines)' : '')
              : '';
          },
          wrap: (final) => '```js\n' + final + '\n```',
        });
      else if (made.type === 'open')
        out.push({
          ...base,
          flaw: made.flaw,
          equivalent: (refReply, reply, ctx) => openEquivalent(made.ask, refReply, reply, ctx),
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
          want: made.want,
          grade: made.grade,
          read,
          gradeFor,
          equivalent: async (refReply, reply) => {
            const theirs = read(refReply);
            return { grade: theirs ? gradeFor(theirs)(reply) : 'noref' };
          },
          usable: (reply) => !!read(reply),
          show: read,
          wrap: (final) => 'ANSWER: ' + final,
        });
      }
    }
  });
  return out;
}
