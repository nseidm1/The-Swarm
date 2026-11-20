// tasks-logic.mjs - HARDER QUESTIONS OF LOGIC, MADE HERE, each with its own right answer. The kinds training already asks of logic
// (tasks.mjs: day, order, trap) are short: the swarm is at parity on nearly all of them while a standard benchmark of logic finds
// it far under the larger model (measured 2026-11-19: 32% against 88%). These ask the same sorts of reasoning such a benchmark
// asks (who tells the truth along a chain, when someone was free, a date some days away, whether an argument is valid, an order
// from clues), at about that difficulty. None is a benchmark's question: every one is made from a seed, here, with names and
// numbers of its own, and its answer is worked out by the program that made it. So the swarm is marked against what is right, not
// against the larger model, and can be better than it.
//   logicTasks({ split, each, kinds }) -> [{ id, kind, split, ask, want, among, good(reply) -> { grade, score } }]
//   answerOf(reply, among)             -> the one of `among` a reply settles on ('' where it names none, or does not settle)
// Not asked by a pass yet: training/class-train.mjs asks them (a class trained as a class). A kind joins a pass by being named in
// training/equivalence.json and given to tasks.mjs.
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const tools = (r) => ({
  int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
  pick: (list) => list[Math.floor(r() * list.length)],
  mix: (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  },
});
const NAMES = [
  'Ada',
  'Ben',
  'Cleo',
  'Dev',
  'Esme',
  'Finn',
  'Gia',
  'Hugo',
  'Ines',
  'Jon',
  'Kai',
  'Lena',
  'Milo',
  'Nora',
];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const options = (list) => list.map((x, i) => '(' + LETTERS[i] + ') ' + x).join('\n');
const pad = (n) => String(n).padStart(2, '0');
const clock = (h) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm');

export const LOGIC_KINDS = {
  // a chain of people, each saying whether the one before tells the truth: one slip and the answer flips
  lies(t) {
    const n = t.int(4, 7);
    const who = t.mix(NAMES).slice(0, n);
    let truth = t.pick([true, false]);
    const said = [`${who[0]} ${truth ? 'tells the truth' : 'lies'}.`];
    for (let i = 1; i < n; i++) {
      const claims = t.pick([true, false]); // what this one says of the one before: that they tell the truth, or that they lie
      said.push(`${who[i]} says ${who[i - 1]} ${claims ? 'tells the truth' : 'lies'}.`);
      truth = claims === truth; // they tell the truth exactly when what they say is so
    }
    return {
      ask: `${said.join(' ')} Does ${who[n - 1]} tell the truth? Answer Yes or No.`,
      again: `Answer Yes or No: does ${who[n - 1]} tell the truth? This is what is known. ${said.join(' ')}`,
      want: truth ? 'Yes' : 'No',
      among: ['Yes', 'No'],
    };
  },
  // a day accounted for but one stretch: when could they have gone?
  free(t) {
    const name = t.pick(NAMES);
    const place = t.pick(['the museum', 'the bakery', 'the library', 'the market', 'the pool', 'the cinema']);
    const where = t.mix([
      'working at the office',
      'at the gym',
      'having lunch at a cafe',
      'on a train',
      'at the dentist',
      'at a class',
      'walking in the park',
    ]);
    const seers = t.mix(NAMES.filter((x) => x !== name));
    const wake = t.int(5, 8);
    const parts = t.int(4, 5);
    const cuts = [wake];
    for (let i = 0; i < parts; i++) cuts.push(cuts[i] + t.int(1, 3));
    const gap = t.int(0, parts - 1);
    const told = [];
    const slots = [];
    for (let i = 0; i < parts; i++) {
      slots.push(`${clock(cuts[i])} to ${clock(cuts[i + 1])}`);
      if (i !== gap) told.push(`${seers[i]} saw ${name} ${where[i]} from ${clock(cuts[i])} to ${clock(cuts[i + 1])}.`);
    }
    const shown = t.mix(slots).slice(0, 4);
    if (!shown.includes(slots[gap])) shown[t.int(0, 3)] = slots[gap];
    const facts =
      `${name} woke up at ${clock(wake)}.\n${t.mix(told).join('\n')}\n` +
      `${place[0].toUpperCase() + place.slice(1)} was closed after ${clock(cuts[parts])}.\n` +
      `Options:\n${options(shown)}\nAnswer with the letter of the one option.`;
    return {
      ask: `Today ${name} went to ${place}. Between what times could they have gone?\nWe know that:\n` + facts,
      again: `Between what times could ${name} have gone to ${place} today? This much is known:\n` + facts,
      want: LETTERS[shown.indexOf(slots[gap])],
      among: LETTERS.slice(0, 4),
    };
  },
  // a date some days before or after a given one, across the end of a month or a year
  date(t) {
    const year = t.int(1990, 2030);
    const start = new Date(Date.UTC(year, t.int(0, 11), t.int(1, 28)));
    const n = t.int(3, 60) * t.pick([1, -1]);
    const at = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
    const moved = (k) => new Date(start.getTime() + k * 86400000);
    const right = at(moved(n));
    const wrong = [...new Set([at(moved(-n)), at(moved(n + 1)), at(moved(n - 1)), at(moved(n + 7)), at(moved(n + 30))])]
      .filter((x) => x !== right)
      .slice(0, 3);
    const shown = t.mix([right, ...wrong]);
    const tail = `\nOptions:\n${options(shown)}\nAnswer with the letter of the one option.`;
    return {
      ask:
        `Today is ${at(start)} (month/day/year). What is the date ${Math.abs(n)} days ${n > 0 ? 'from now' : 'ago'}?` +
        tail,
      again:
        `What is the date ${Math.abs(n)} days ${n > 0 ? 'from now' : 'ago'}, if today is ${at(start)} (month/day/year)?` +
        tail,
      want: LETTERS[shown.indexOf(right)],
      among: LETTERS.slice(0, shown.length),
    };
  },
  // an argument in made-up words, so that only its form can be judged: does the conclusion follow?
  valid(t) {
    const [a, b, c] = t.mix(['blickets', 'wugs', 'daxes', 'tovers', 'gorps', 'zimbs', 'frells', 'plonks']).slice(0, 3);
    const x = t.pick(NAMES);
    const one = (s) => s.replace(/s$/, '');
    const forms = [
      [true, `All ${a} are ${b}. All ${b} are ${c}.`, `all ${a} are ${c}`],
      [true, `No ${b} are ${c}. All ${a} are ${b}.`, `no ${a} are ${c}`],
      [true, `All ${b} are ${c}. Some ${a} are ${b}.`, `some ${a} are ${c}`],
      [true, `All ${a} are ${b}. ${x} is not a ${one(b)}.`, `${x} is not a ${one(a)}`],
      [true, `All ${a} are ${b}. ${x} is a ${one(a)}.`, `${x} is a ${one(b)}`],
      [false, `All ${a} are ${b}. All ${c} are ${b}.`, `all ${a} are ${c}`],
      [false, `All ${a} are ${b}. ${x} is a ${one(b)}.`, `${x} is a ${one(a)}`],
      [false, `All ${a} are ${b}. Some ${b} are ${c}.`, `some ${a} are ${c}`],
      [false, `No ${a} are ${b}. No ${b} are ${c}.`, `no ${a} are ${c}`],
      [false, `All ${a} are ${b}. ${x} is not a ${one(a)}.`, `${x} is not a ${one(b)}`],
    ];
    const [ok, given, so] = t.pick(forms);
    return {
      ask:
        `Consider this argument. ${given} Therefore, ${so}.\n` +
        `Is the argument deductively valid or invalid, given only what it states? Answer valid or invalid.`,
      again:
        `Answer valid or invalid: given only what it states, is this argument deductively valid or invalid? ` +
        `${given} Therefore, ${so}.`,
      want: ok ? 'valid' : 'invalid',
      among: ['valid', 'invalid'],
    };
  },
  // an order from clues, three to five things on a shelf: the clues fix one order and no other
  deduce(t) {
    const all = ['red', 'green', 'blue', 'yellow', 'white', 'black', 'orange'];
    const n = t.int(3, 5);
    const ordinal = ['leftmost', 'second from the left', 'third from the left', 'fourth from the left', 'rightmost'];
    const place = (i) => (i === n - 1 ? 'rightmost' : ordinal[i]);
    const perms = (list) =>
      list.length < 2
        ? [list]
        : list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
    const row = t.mix(all).slice(0, n); // left to right
    const unique = (tests) => perms([...row].sort()).filter((p) => tests.every((f) => f(p))).length === 1;
    // each neighbouring pair, said one way or the other: together they fix the order. Then one of them gives way to where a book
    // stands, where that still leaves one order and no other, so that the clues are not all of one sort
    let clues = row.slice(0, -1).map((l, i) => {
      const r = row[i + 1];
      return {
        says: t.pick([true, false])
          ? `The ${l} book is to the left of the ${r} book.`
          : `The ${r} book is to the right of the ${l} book.`,
        test: (p) => p.indexOf(l) < p.indexOf(r),
      };
    });
    const out = t.int(0, n - 2);
    const fixed = t.pick([out, out + 1]);
    const swapped = [
      ...clues.filter((_, i) => i !== out),
      { says: `The ${row[fixed]} book is the ${place(fixed)}.`, test: (p) => p[fixed] === row[fixed] },
    ];
    let given = -1;
    if (unique(swapped.map((c) => c.test))) {
      clues = swapped;
      given = fixed;
    }
    const asked = t.pick([...Array(n).keys()].filter((i) => i !== given));
    const shown = [...row].sort();
    const shelf = `On a shelf there are ${n} books in a row: ${shown.map((x) => (/^[aeiou]/.test(x) ? 'an ' : 'a ') + x + ' book').join(', ')}.`;
    const told = t
      .mix(clues)
      .map((c) => c.says)
      .join(' ');
    const tail = `\nOptions:\n${options(shown.map((x) => 'The ' + x + ' book'))}\nAnswer with the letter of the one option.`;
    return {
      ask: `${shelf}\n${told}\nWhich book is the ${place(asked)}?` + tail,
      again: `Which book is the ${place(asked)}? ${shelf}\n${told}` + tail,
      want: LETTERS[shown.indexOf(row[asked])],
      among: LETTERS.slice(0, n),
    };
  },
};
export const LOGIC_KIND_NAMES = Object.keys(LOGIC_KINDS);
export const LOGIC_SEEDS = { train: 4801, held: 9203 };

// THE ONE OF `among` A REPLY SETTLES ON. A letter: the last one given in brackets, or after "answer", or standing alone at the end.
// A word: the last of the words named. '' where none is named. (The last, not the first: a reply reasons, then answers.)
export function answerOf(reply, among) {
  const text = String(reply || '');
  if (among.every((x) => /^[A-E]$/.test(x))) {
    const set = among.join('');
    const found = [
      ...text.matchAll(
        new RegExp(
          '\\(([' +
            set +
            '])\\)|(?:answer|option)\\s*(?:is|:)?\\s*\\**([' +
            set +
            '])\\b|^\\s*\\**([' +
            set +
            '])[.)*]*\\s*$',
          'gim',
        ),
      ),
    ];
    const last = found[found.length - 1];
    return last ? last[1] || last[2] || last[3] : '';
  }
  // (the longest first: "invalid" is not also "valid")
  const words = [...among].sort((a, b) => b.length - a.length);
  const found = [...text.matchAll(new RegExp('\\b(' + words.join('|') + ')\\b', 'gi'))];
  const last = found[found.length - 1];
  return last ? among.find((x) => x.toLowerCase() === last[1].toLowerCase()) : '';
}

export function logicTasks({ split = 'train', each = 10, kinds = LOGIC_KIND_NAMES, seed } = {}) {
  const from = seed !== undefined ? seed : LOGIC_SEEDS[split];
  const out = [];
  for (const kind of kinds) {
    const t = tools(rng(from + LOGIC_KIND_NAMES.indexOf(kind) * 977));
    for (let i = 0; i < each; i++) {
      const made = LOGIC_KINDS[kind](t);
      out.push({
        id: `${split}-${from}-${kind}-${i + 1}`,
        kind,
        split,
        seed: from,
        ask: made.ask,
        type: 'value',
        want: made.want,
        among: made.among,
        // GOOD, BY THE QUESTION'S OWN STANDARD: the reply settles on the answer the program worked out
        good: async (reply) => {
          const got = answerOf(reply, made.among);
          return { grade: got === made.want ? 'right' : 'wrong', score: got === made.want ? 1 : 0, got };
        },
      });
    }
  }
  return out;
}

// A QUESTION PUT AS A STANDARD TEST PUTS IT: three worked examples of its kind as earlier turns, each closing "So the answer is
// X.", then the question. The examples are made here from a seed of their own (never a question that is asked), and say little of
// the working: what they show is the form a reply is to end with. Put this way a question is a conversation to the module (its
// class of input is `talk`), which is how such a test reaches it.
//   shown(t, { shots }) -> messages
//   closedRight(reply, t) -> whether the reply says "the answer is" and then the right answer, as a harness reads it: what
//                            follows those words, up to the last character of the line
const said = (kind, want) => (LOGIC_KINDS[kind] && /^[A-E]$/.test(want) ? '(' + want + ')' : want);
export function shown(t, { shots = 3 } = {}) {
  const r = tools(rng(31337 + LOGIC_KIND_NAMES.indexOf(t.kind) * 53));
  const out = [];
  for (let i = 0; i < shots; i++) {
    const made = LOGIC_KINDS[t.kind](r);
    out.push({ role: 'user', content: made.ask });
    out.push({
      role: 'assistant',
      content:
        "Let's think step by step. Taking what is given one piece at a time, and keeping what follows from each, " +
        'only one answer fits. So the answer is ' +
        said(t.kind, made.want) +
        '.',
    });
  }
  out.push({ role: 'user', content: t.ask });
  return out;
}
export function closedRight(reply, t) {
  // (and a harness that shows its examples as one block reads a reply to its first empty line and no further)
  const m = String(reply || '')
    .split(/\n[ \t]*\n/)[0]
    .match(/(?<=the answer is )(.*)(?=.)/);
  return !!m && m[1].trim() === said(t.kind, t.want);
}

// ---- ANY QUESTION WITH AN ANSWER OF ITS OWN, PUT AS A STANDARD TEST PUTS IT (tasks.mjs asks some of each such kind this way):
// worked examples of its kind as earlier turns, each closing "So the answer is X.", then the question. It reaches the module as
// a conversation, which is the class of input most standard tests reach it as, and one a pass never asked: every train question
// was a single message (measured 2026-11-19: 14 of the 23 benchmark tasks arrive as conversations, and on those the swarm's
// replies were right and unread). Its standard is its own, and strict: the reply must SAY the answer the way the examples do,
// in its first block, as a harness reads it.
//   asShown(t, examples) -> the question in that shape: { ...t, id + '-shown', shape: 'shown', turns, good, readable, ... }
//   saidIn(reply)        -> what follows "the answer is" in the reply's first block ('' where it does not say so)
const WORKING =
  "Let's think step by step. Taking what is given one piece at a time, and keeping what follows from each, only one answer fits. So the answer is ";
const sayOf = (x) => (x.among && /^[A-E]$/.test(String(x.want)) ? '(' + x.want + ')' : String(x.want));
export function saidIn(reply) {
  const m = String(reply || '')
    .split(/\n[ \t]*\n/)[0]
    .match(/(?<=the answer is )(.*)(?=.)/);
  return m ? m[1].trim() : '';
}
export function asShown(t, examples) {
  const turns = [];
  for (const e of examples) {
    turns.push({ role: 'user', content: e.ask });
    turns.push({ role: 'assistant', content: WORKING + sayOf(e) + '.' });
  }
  turns.push({ role: 'user', content: t.ask });
  const right = (said) =>
    !!said && (t.among || !t.gradeFor ? said === sayOf(t) : t.gradeFor(String(t.want))(said) === 'right');
  return {
    ...t,
    id: t.id + '-shown',
    shape: 'shown',
    // (the question's standard as it is plainly asked: what an answer holds, however it is put. classes.mjs marks drafts by it)
    plainGood: t.good,
    turns,
    again: null,
    // GOOD: the reply says, as the examples say it, the answer the question was made with
    good: async (reply) => {
      const said = saidIn(reply);
      return { grade: right(said) ? 'right' : 'wrong', score: right(said) ? 1 : 0, got: said };
    },
    // (whether a reader of that form finds an answer in the reply at all: a reply that has none is unread, not wrong)
    readable: (reply) => !!saidIn(reply),
    equivalent: async (refReply, reply) => {
      const theirs = saidIn(refReply);
      return { grade: theirs ? (saidIn(reply) === theirs ? 'right' : 'wrong') : 'noref' };
    },
    usable: (reply) => String(reply || '').trim().length > 0,
    show: (reply) =>
      String(reply || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-160),
    wrap: (final) => final,
  };
}
// a logic question as a pass's list holds one (tasks.mjs): what was made, with its standard and what the trainers ask of a question
export function logicTask(base, made) {
  const got = (reply) => answerOf(reply, made.among);
  return {
    ...base,
    again: made.again || null,
    want: made.want,
    among: made.among,
    read: got,
    equivalent: async (refReply, reply) => ({
      grade: got(refReply) ? (got(reply) === got(refReply) ? 'right' : 'wrong') : 'noref',
    }),
    usable: (reply) => !!got(reply),
    good: async (reply) => ({
      grade: got(reply) === made.want ? 'right' : 'wrong',
      score: got(reply) === made.want ? 1 : 0,
      got: got(reply),
    }),
    show: (reply) =>
      String(reply || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-160),
    wrap: (final) => final,
  };
}
