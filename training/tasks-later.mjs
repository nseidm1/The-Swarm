// tasks-later.mjs - KINDS OF QUESTION ADDED AFTER PASSES HAD BEEN MEASURED. A kind's questions are seeded by where the kind
// stands among all kinds (tasks.mjs ALL), so these stand LAST: no earlier kind's questions change by one letter, and a test
// holds that. And a class's figures are told twice from the day one is added (equivalence.json `since`; classes.mjs
// figuresOf `earlier`): of every kind, and of the kinds as they were, so that a figure of an earlier pass is still set
// beside one of its own measure.
// Each has an answer its maker works out, and is a thing code can work out whole (src/forms.mjs track, path).
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
const THINGS = ['red ball', 'blue ball', 'green ball', 'yellow ball', 'white ball', 'black ball', 'pink ball'];
export const LATER_KINDS = {
  // who holds what after things have changed hands: one slip and the answer is another
  swap(t) {
    const n = t.int(3, 5);
    const who = t.mix(NAMES).slice(0, n);
    const things = t.mix(THINGS).slice(0, n);
    const has = [...things];
    const start = `${who.map((w, i) => `${w} has the ${things[i]}`).join(', ')}.`;
    const said = [];
    for (let i = 0; i < t.int(3, 5); i++) {
      const [a, b] = t.mix([...Array(n).keys()]).slice(0, 2);
      said.push(`${i ? 'Then ' : ''}${who[a]} and ${who[b]} swap.`);
      [has[a], has[b]] = [has[b], has[a]];
    }
    const k = t.int(0, n - 1);
    const byThing = t.pick([true, false]);
    return byThing
      ? {
          ask: `${start} ${said.join(' ')} Who has the ${things[k]} now?`,
          again: `Who has the ${things[k]} at the end? At the start: ${start} ${said.join(' ')}`,
          want: who[has.indexOf(things[k])],
          among: who,
        }
      : {
          ask: `${start} ${said.join(' ')} What does ${who[k]} have now?`,
          again: `What does ${who[k]} have at the end? At the start: ${start} ${said.join(' ')}`,
          want: has[k].replace(' ball', ''),
          among: things.map((x) => x.replace(' ball', '')),
        };
  },
  // steps and turns, and whether they lead back to where they began
  path(t) {
    const dir = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let face = 0;
    let x = 0;
    let y = 0;
    const said = [];
    const go = (steps) => {
      said.push(`Take ${steps} step${steps === 1 ? '' : 's'} forward.`);
      x += dir[face][0] * steps;
      y += dir[face][1] * steps;
    };
    const turn = (how) => {
      said.push(how === 1 ? 'Turn right.' : how === 3 ? 'Turn left.' : 'Turn around.');
      face = (face + how) % 4;
    };
    const a = t.int(1, 9);
    const b = t.int(1, 9);
    // (half of them come back: out, across, back across, and home; the others miss by a length or by a wrong turn)
    const home = t.pick([true, false]);
    const miss = home ? '' : t.pick(['across', 'home', 'turn']);
    go(a);
    turn(t.pick([1, 3]));
    go(b);
    turn(2);
    go(miss === 'across' ? b + t.int(1, 3) : b);
    const toSouth = (2 - face + 4) % 4; // (the turn that faces the way home)
    turn(miss === 'turn' ? (toSouth === 1 ? 3 : 1) : toSouth);
    go(miss === 'home' ? a + t.int(1, 3) : a);
    const back = x === 0 && y === 0;
    return {
      ask: `You start at a point, facing north. ${said.join(' ')} Are you back at the point you started from? Answer Yes or No.`,
      again: `Answer Yes or No: are you back where you started? You start at a point, facing north. ${said.join(' ')}`,
      want: back ? 'Yes' : 'No',
      among: ['Yes', 'No'],
    };
  },
  // ---- THREE KINDS THAT ARE HARDER WAYS OF ASKING WHAT TRAINING ALREADY ASKS (2026-11-28). Training's questions of a date,
  // of words to order and of brackets to close were right 6 of 6, and the same three things asked another way were not:
  // a probe of made questions read 21 of 48 for dates of several steps, 3 of 16 for words to order told as a story, and 1 of
  // 48 for brackets with the question after them. A change that mends such a question can only be kept where training asks
  // one. No standard test's question was read for these: the wordings and the things in them are this file's own.
  // a date reached by two or three lengths of time, one after another; the day told is sometimes not today
  dates(t) {
    const MONTH = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const pad = (n) => String(n).padStart(2, '0');
    const at = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
    const long = (d) => `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    const day = 86400000;
    // (a month or a year on: the same day of the month; the day told is never past the 28th, so that every month has it)
    const step = (d, s) =>
      s.unit === 'day'
        ? new Date(d.getTime() + s.n * day)
        : s.unit === 'week'
          ? new Date(d.getTime() + 7 * s.n * day)
          : new Date(
              Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + s.n * (s.unit === 'year' ? 12 : 1), d.getUTCDate()),
            );
    const today = new Date(Date.UTC(t.int(1990, 2034), t.int(0, 11), t.int(1, 28)));
    const sign = () => t.pick([1, -1]);
    // (the months and years first, the days last: a step of months is taken from a day every month has)
    const steps = t.pick([true, false])
      ? [
          { unit: 'month', n: t.int(1, 6) * sign() },
          { unit: t.pick(['day', 'week']), n: t.int(2, 40) * sign() },
        ]
      : [
          { unit: 'year', n: t.int(1, 3) * sign() },
          { unit: 'month', n: t.int(1, 6) * sign() },
          { unit: 'day', n: t.int(2, 40) * sign() },
        ];
    const shift = t.pick([0, 0, -1, 2]);
    const told = new Date(today.getTime() + shift * day);
    const walk = (list, from = today) => list.reduce((d, s) => step(d, s), from);
    const right = at(walk(steps));
    // (what a slip gives: the first length alone, the last one taken the other way, the day told taken for today, a day out)
    const wrong = [
      ...new Set([
        at(walk(steps.slice(0, 1))),
        at(walk(steps.map((s, i) => (i === steps.length - 1 ? { ...s, n: -s.n } : s)))),
        at(walk(steps, told)),
        at(new Date(walk(steps).getTime() + day)),
        at(walk(steps.map((s) => ({ ...s, n: -s.n })))),
      ]),
    ]
      .filter((x) => x !== right)
      .slice(0, 3);
    const shown = t.mix([right, ...wrong]);
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
    const tail = `\nOptions:\n${shown.map((x, i) => `(${LETTERS[i]}) ${x}`).join('\n')}\nAnswer with the letter of the one option.`;
    const say = (s) => `${Math.abs(s.n)} ${s.unit}${Math.abs(s.n) === 1 ? '' : 's'} ${s.n < 0 ? 'earlier' : 'later'}`;
    const chain = steps.map(say).join(', and then ');
    const first =
      shift === 0
        ? `Today is ${long(told)}.`
        : shift === -1
          ? `Yesterday was ${long(told)}.`
          : `The day after tomorrow is ${long(told)}.`;
    return {
      ask: `${first} Start from today and go to the date ${chain}. What is that date, written month/day/year?` + tail,
      again: `What is the date ${chain} than today, written month/day/year? ${first}` + tail,
      want: LETTERS[shown.indexOf(right)],
      among: LETTERS.slice(0, shown.length),
    };
  },
  // words to put in order, told as a story and not set out as a list: the words have to be picked out before they are ordered
  listed(t) {
    const STEMS = ['mar', 'man', 'con', 'cor', 'pre', 'pro', 'sta', 'ste', 'tra', 'tri', 'bal', 'bar', 'gra', 'gro'];
    const ENDS = [
      'ble',
      'der',
      'dle',
      'ket',
      'low',
      'ner',
      'ple',
      'row',
      'ter',
      'tle',
      'ton',
      'vel',
      'cent',
      'dent',
      'fold',
      'kind',
      'ling',
      'mont',
      'pact',
      'rant',
      'ward',
    ];
    const stems = t.mix(STEMS).slice(0, t.int(3, 5));
    const n = t.int(5, 12);
    const set = new Set();
    while (set.size < n) set.add(t.pick(stems) + t.pick(ENDS));
    const words = [...set];
    const want = [...words].sort().join(' ');
    const and = (w) => w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
    const tell = t.pick([
      (w) =>
        `A clerk has labels reading ${and(w)}. In what order do they go in a drawer kept by the alphabet? Give the labels in that order on one line.`,
      (w) =>
        `The jars on a shelf are marked ${and(w)}. A list of them kept in dictionary order is wanted. Write the marks in that order, on one line, a space between each.`,
      (w) =>
        `Rooms in an old inn are named ${and(w)}. The register lists them alphabetically. Write the names as the register has them, on one line.`,
    ]);
    return {
      ask: tell(words),
      again: `Write these on one line in alphabetical order, a space between each. They are the names on some boxes in a store: ${and(words)}.`,
      want,
      as: 'exact',
    };
  },
  // brackets left open, with the asking after them and not before: more of them open, and more closed on the way
  unclosed(t) {
    const OPEN = ['(', '[', '{', '<'];
    const SHUT = { '(': ')', '[': ']', '{': '}', '<': '>' };
    const open = t.int(2, 7);
    const seq = [];
    const stack = [];
    let closed = t.int(1, 6);
    while (stack.length < open || closed > 0) {
      // (one more that stays open, or one opened and closed at once: what is left open is not simply what was written)
      if (stack.length < open && (closed === 0 || t.pick([true, false]))) {
        const o = t.pick(OPEN);
        seq.push(o);
        stack.push(o);
      } else {
        const o = t.pick(OPEN);
        seq.push(o, SHUT[o]);
        closed--;
      }
    }
    const want = [...stack]
      .reverse()
      .map((o) => SHUT[o])
      .join(' ');
    const run = seq.join(' ');
    const tell = t.pick([
      (q) =>
        `These brackets are not all closed: ${q}\nWrite only the brackets that must come next so that every bracket is closed in the right order.`,
      (q) =>
        `A typesetter set this line of brackets and stopped part way: ${q}\nWhich brackets are still to be set, in order, to close everything that is open? Give only those brackets.`,
      (q) =>
        `Here is the start of a line: ${q}\nIt is to be finished so that each bracket is closed, the last opened first. What is missing?`,
    ]);
    return {
      ask: tell(run),
      again: `The line ${run} was left unfinished. Write, in order, the closing brackets it still needs.`,
      want,
      as: 'exact',
    };
  },
};
export const LATER_KIND_NAMES = Object.keys(LATER_KINDS);
