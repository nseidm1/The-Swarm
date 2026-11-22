// tasks-exact.mjs - QUESTIONS THAT ARE AN OPERATION, MADE HERE, each with the answer its own maker worked out. Some of what a
// module is asked is not a matter of judgement: a sum, an expression of true and false, words to put in order, brackets to
// close. A small model guesses at these and code does them exactly (src/instruments.mjs). Whether a module USES an instrument
// is for training to say, on questions like these, by the rule it keeps every change by (training/keep.mjs): an instrument is
// turned on for a class of input where the class got better with it on held questions, and not otherwise.
// None is a benchmark's question. Every one is made from a seed, here, in wordings of this file's own (several for each kind,
// so that an instrument is kept for reading the operation and not one sentence), and its answer is worked out by the code
// below, which is not the instrument's: a module that reads the operation wrongly is marked wrong.
//   EXACT_KINDS: { kind: (t) -> { ask, again, want, as: 'number' | 'exact' } }   t: { int, pick, mix } (tasks.mjs)
const WORDS = [
  'amber',
  'anchor',
  'basil',
  'beacon',
  'birch',
  'cedar',
  'cinder',
  'clover',
  'copper',
  'dapple',
  'delta',
  'ember',
  'fennel',
  'ferry',
  'garnet',
  'ginger',
  'harbor',
  'hazel',
  'indigo',
  'ivory',
  'jasper',
  'juniper',
  'kettle',
  'lantern',
  'linen',
  'maple',
  'marrow',
  'nectar',
  'nickel',
  'olive',
  'onyx',
  'pebble',
  'pepper',
  'quartz',
  'quiver',
  'raven',
  'russet',
  'saffron',
  'sorrel',
  'tansy',
  'thistle',
  'umber',
  'velvet',
  'violet',
  'walnut',
  'willow',
  'yarrow',
  'zephyr',
  'zinc',
  'meadow',
  'mead',
  'cedarwood',
];
const OPEN = ['(', '[', '{', '<'];
const SHUT = { '(': ')', '[': ']', '{': '}', '<': '>' };

export const EXACT_KINDS = {
  // a sum of whole numbers with brackets: worked out by the usual order (inside brackets first, then times, then plus and minus)
  sum(t) {
    const n = () => t.int(-9, 9);
    const op = () => t.pick(['+', '-', '*']);
    const group = () => `(${n()} ${op()} ${n()} ${op()} ${n()})`;
    const expr = t.pick([
      `${group()} ${op()} ${group()}`,
      `(${group()} ${op()} ${n()}) ${op()} ${n()}`,
      `${n()} ${op()} ${group()} ${op()} ${n()}`,
    ]);
    // (worked out here by a reading of its own: numbers, brackets, times before plus and minus)
    const toks = expr.match(/-?\d+|[-+*()]/g);
    let i = 0;
    const atom = () => {
      if (toks[i] === '(') {
        i++;
        const v = add();
        i++;
        return v;
      }
      return Number(toks[i++]);
    };
    const mul = () => {
      let v = atom();
      while (toks[i] === '*') {
        i++;
        v *= atom();
      }
      return v;
    };
    function add() {
      let v = mul();
      while (toks[i] === '+' || toks[i] === '-') {
        const o = toks[i++];
        const r = mul();
        v = o === '+' ? v + r : v - r;
      }
      return v;
    }
    const want = add();
    const how = t.pick([
      (e) => `${e} =`,
      (e) => `What is ${e}?`,
      (e) => `Work this out: ${e} =`,
      (e) => `Calculate ${e}`,
    ]);
    return { ask: how(expr), again: `Give the value of this as one number: ${expr}`, want, as: 'number' };
  },
  // an expression of True and False: not before and, and before or
  truth(t) {
    const v = () => t.pick(['True', 'False']);
    const maybeNot = (x) => (t.pick([true, false, false]) ? `not ${x}` : x);
    const pair = () => `( ${maybeNot(v())} ${t.pick(['and', 'or'])} ${maybeNot(v())} )`;
    const expr = t.pick([
      `${maybeNot(pair())} ${t.pick(['and', 'or'])} ${maybeNot(v())}`,
      `${maybeNot(v())} ${t.pick(['and', 'or'])} ${maybeNot(pair())}`,
      `not ${pair()} ${t.pick(['and', 'or'])} ${pair()}`,
    ]);
    const toks = expr.match(/\(|\)|True|False|not|and|or/g);
    let i = 0;
    const atom = () => {
      const k = toks[i++];
      if (k === '(') {
        const x = or();
        i++;
        return x;
      }
      return k === 'True';
    };
    const not = () => (toks[i] === 'not' ? (i++, !not()) : atom());
    const and = () => {
      let x = not();
      while (toks[i] === 'and') {
        i++;
        const r = not();
        x = x && r;
      }
      return x;
    };
    function or() {
      let x = and();
      while (toks[i] === 'or') {
        i++;
        const r = and();
        x = x || r;
      }
      return x;
    }
    const want = or() ? 'True' : 'False';
    const how = t.pick([(e) => `${e} is`, (e) => `${e} =`, (e) => `What does this come to, True or False? ${e}`]);
    return {
      ask: how(expr),
      again: `Say True or False: what is the value of ${expr}`,
      want,
      as: 'exact',
      among: ['True', 'False'],
    };
  },
  // words to put in the order of the alphabet
  sorted(t) {
    const words = t.mix(WORDS).slice(0, t.int(4, 9));
    const want = [...words].sort().join(' ');
    const how = t.pick([
      (w) => `Sort these words alphabetically: ${w.join(' ')}`,
      (w) => `Put the following words in alphabetical order: ${w.join(', ')}`,
      (w) => `Arrange these in dictionary order. Words: ${w.join(' ')}`,
      (w) => `Here are some words. Order them alphabetically and write them on one line: ${w.join(' ')}`,
    ]);
    return {
      ask: how(words),
      again: `Write these words on one line in alphabetical order, with a space between each: ${words.join(' ')}`,
      want,
      as: 'exact',
    };
  },
  // brackets left open, to close in the right order
  closed(t) {
    const depth = t.int(2, 5);
    const stack = [];
    const seq = [];
    // (some opened and closed on the way, so that what is left open is not simply what was written)
    for (let k = 0; k < depth + t.int(0, 3); k++) {
      const o = t.pick(OPEN);
      seq.push(o);
      stack.push(o);
      if (stack.length > depth || (stack.length > 1 && t.pick([true, false, false]))) seq.push(SHUT[stack.pop()]);
    }
    if (!stack.length) {
      seq.push('(');
      stack.push('(');
    }
    const want = [...stack]
      .reverse()
      .map((o) => SHUT[o])
      .join(' ');
    const how = t.pick([
      (q) => `Complete this sequence so that every bracket is closed properly: ${q}`,
      (q) => `Some of these brackets are still open. Write what closes them, in the right order. Sequence: ${q}`,
      (q) => `Finish the sequence, making sure the parentheses are closed properly. Input: ${q}`,
    ]);
    return {
      ask: how(seq.join(' ')),
      again: `Which closing brackets, in order, complete this so that every bracket is closed properly? ${seq.join(' ')}`,
      want,
      as: 'exact',
    };
  },
};
export const EXACT_KIND_NAMES = Object.keys(EXACT_KINDS);
