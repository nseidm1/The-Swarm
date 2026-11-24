// tasks-code.mjs - PROGRAMMING QUESTIONS, where parity is equivalent FUNCTION. Each asks for a small JavaScript function, a
// correction to one, what one prints, or what is wrong with one. They are made from a seed, in families whose details change (the
// step, the tie rule, the separator), so there is no list to learn.
//   write-*   "Write a function ..."            equivalent when the two functions return the same for every input (they are run)
//   fix       "This is wrong. Correct it."      the same
//   trace     "What does this print?"           equivalent when the two give the same value
//   bug       "What is the bug?"                an answer in words: a decision model says whether the two say the same thing
// Every family carries a function of its own that does what the question asks (`ok`). It is NOT the mark: the mark is whatever the
// larger model writes. It is here so that the checks can prove the questions can be answered and the inputs tell functions apart.
//   FAMILIES[i](t) -> { group, name, ask, ok (source), bad (source, with one flaw), flaw (the flaw, in words), inputs }
const words = [
  'river',
  'stone',
  'amber',
  'cloud',
  'maple',
  'ember',
  'north',
  'quiet',
  'salt',
  'fern',
  'an',
  'of',
  'it',
  'meadow',
  'lantern',
  'a',
];
const ints = (t, n, lo = -9, hi = 20) => Array.from({ length: n }, () => t.int(lo, hi));
const lists = (t, lo, hi) => [
  [],
  [t.int(lo, hi)],
  ints(t, 2, lo, hi),
  ints(t, 3, lo, hi),
  ints(t, 5, lo, hi),
  ints(t, 6, lo, hi),
  ints(t, 9, lo, hi),
  ints(t, 12, lo, hi),
  [3, 3, 3, 3],
  [0, 0, 1, 0],
  ints(t, 7, 0, 3),
  ints(t, 10, 0, 2),
];
const phrase = (t, n) => Array.from({ length: n }, () => t.pick(words)).join(' ');
const texts = (t) => [
  '',
  'a',
  phrase(t, 1),
  phrase(t, 2),
  phrase(t, 3),
  phrase(t, 5),
  phrase(t, 8),
  '  ' + phrase(t, 3) + '  ',
  phrase(t, 2) + '  ' + phrase(t, 2),
  'An Of IT ' + phrase(t, 2),
];

export const FAMILIES = [
  (t) => {
    const k = t.int(2, 4);
    const from = t.pick([0, 1]);
    return {
      group: 'write-arrays',
      name: 'sumEvery',
      ask: `Write a JavaScript function \`sumEvery(numbers)\` that returns the sum of every ${k === 2 ? 'second' : k === 3 ? 'third' : 'fourth'} number in the array, starting with the ${from ? 'second' : 'first'} one. An empty array gives 0.`,
      ok: `function sumEvery(numbers) {\n  let total = 0;\n  for (let i = ${from}; i < numbers.length; i += ${k}) total += numbers[i];\n  return total;\n}`,
      bad: `function sumEvery(numbers) {\n  let total = 0;\n  for (let i = ${from ? 0 : 1}; i < numbers.length; i += ${k}) total += numbers[i];\n  return total;\n}`,
      flaw: `it starts at the ${from ? 'first' : 'second'} number instead of the ${from ? 'second' : 'first'}`,
      inputs: lists(t, -9, 20).map((l) => [l]),
    };
  },
  (t) => {
    const k = t.int(3, 5); // more than the shortest arrays tried, so that wrapping round the length matters
    const dir = t.pick(['left', 'right']);
    const body =
      dir === 'left'
        ? `return list.slice(n).concat(list.slice(0, n));`
        : `return list.slice(list.length - n).concat(list.slice(0, list.length - n));`;
    return {
      group: 'write-arrays',
      name: 'rotate',
      ask: `Write a JavaScript function \`rotate(list)\` that returns a new array with the items moved ${k} place${k > 1 ? 's' : ''} to the ${dir}, the ones pushed off one end coming back at the other. It must work for arrays shorter than ${k + 1} items, and must not change the array it is given.`,
      ok: `function rotate(list) {\n  if (list.length === 0) return [];\n  const n = ${k} % list.length;\n  ${body}\n}`,
      bad: `function rotate(list) {\n  const n = ${k};\n  ${body}\n}`,
      flaw: `it does not wrap the shift round the length, so an array shorter than the shift comes back wrong`,
      inputs: [[1, 2], [1, 2, 3], [1, 2, 3, 4], ...lists(t, 0, 9)].map((l) => [l]),
    };
  },
  (t) => {
    const keep = t.pick(['first', 'last']);
    return {
      group: 'write-arrays',
      name: 'dedupe',
      ask: `Write a JavaScript function \`dedupe(list)\` that returns a new array with repeated values removed, keeping the ${keep} occurrence of each value and otherwise keeping the order.`,
      ok:
        keep === 'first'
          ? `function dedupe(list) {\n  return list.filter((x, i) => list.indexOf(x) === i);\n}`
          : `function dedupe(list) {\n  return list.filter((x, i) => list.lastIndexOf(x) === i);\n}`,
      bad:
        keep === 'first'
          ? `function dedupe(list) {\n  return list.filter((x, i) => list.lastIndexOf(x) === i);\n}`
          : `function dedupe(list) {\n  return list.filter((x, i) => list.indexOf(x) === i);\n}`,
      flaw: `it keeps the ${keep === 'first' ? 'last' : 'first'} occurrence of each value instead of the ${keep}`,
      inputs: lists(t, 0, 4).map((l) => [l]),
    };
  },
  (t) => {
    const tie = t.pick(['smallest', 'largest']);
    return {
      group: 'write-arrays',
      name: 'mostCommon',
      ask: `Write a JavaScript function \`mostCommon(numbers)\` that returns the number that appears most often in the array. If several appear equally often, return the ${tie} of them. An empty array gives null.`,
      ok: `function mostCommon(numbers) {\n  if (numbers.length === 0) return null;\n  const count = new Map();\n  for (const n of numbers) count.set(n, (count.get(n) || 0) + 1);\n  let best = null;\n  for (const [n, c] of count) {\n    if (best === null || c > count.get(best) || (c === count.get(best) && n ${tie === 'smallest' ? '<' : '>'} best)) best = n;\n  }\n  return best;\n}`,
      bad: `function mostCommon(numbers) {\n  if (numbers.length === 0) return null;\n  const count = new Map();\n  for (const n of numbers) count.set(n, (count.get(n) || 0) + 1);\n  let best = null;\n  for (const [n, c] of count) {\n    if (best === null || c > count.get(best)) best = n;\n  }\n  return best;\n}`,
      flaw: `on a tie it returns whichever number it met first, not the ${tie}`,
      inputs: lists(t, 0, 4).map((l) => [l]),
    };
  },
  (t) => {
    const n = t.int(2, 4);
    return {
      group: 'write-strings',
      name: 'countLong',
      ask: `Write a JavaScript function \`countLong(text)\` that returns how many words in the text have more than ${n} letters. Words are separated by one or more spaces, and the text may begin or end with spaces.`,
      ok: `function countLong(text) {\n  return text.split(' ').filter((w) => w.length > ${n}).length;\n}`,
      bad: `function countLong(text) {\n  return text.split(' ').filter((w) => w.length >= ${n}).length;\n}`,
      flaw: `it counts words of ${n} letters too: the test should be more than ${n}, not ${n} or more`,
      inputs: ['a be sea four fives sixsix sevenly', 'to the oak tree', ...texts(t)].map((x) => [x]),
    };
  },
  (t) => {
    const ones = t.pick([true, false]);
    return {
      group: 'write-strings',
      name: 'runLength',
      ask: `Write a JavaScript function \`runLength(text)\` that shortens a string by replacing each run of the same character with the character followed by how many times it repeats${ones ? '' : ', except that a character on its own is left without a number'}. For example "aaabcc" becomes "${ones ? 'a3b1c2' : 'a3bc2'}". An empty string stays empty.`,
      ok: `function runLength(text) {\n  let out = '';\n  for (let i = 0; i < text.length; ) {\n    let j = i;\n    while (j < text.length && text[j] === text[i]) j++;\n    out += text[i] + (${ones ? 'true' : 'j - i > 1'} ? String(j - i) : '');\n    i = j;\n  }\n  return out;\n}`,
      bad: `function runLength(text) {\n  let out = '';\n  for (let i = 0; i < text.length; ) {\n    let j = i;\n    while (j < text.length && text[j] === text[i]) j++;\n    out += text[i] + (${ones ? 'j - i > 1' : 'true'} ? String(j - i) : '');\n    i = j;\n  }\n  return out;\n}`,
      flaw: ones
        ? `it leaves the 1 off a character that is on its own`
        : `it writes a 1 after a character that is on its own`,
      inputs: ['', 'a', 'ab', 'aab', 'aaabcc', 'abcabc', 'zzzzzzzzzzzz', 'aabbaa', 'a  b', '112233'].map((x) => [x]),
    };
  },
  (t) => {
    const set = t.pick(['()', '()[]', '()[]{}']);
    const pairs = set.match(/../g);
    const src = (strict) =>
      `function isBalanced(text) {\n  const close = { ${pairs.map((p) => `'${p[1]}': '${p[0]}'`).join(', ')} };\n  const open = [];\n  for (const c of text) {\n    if (${pairs.map((p) => `c === '${p[0]}'`).join(' || ')}) open.push(c);\n    else if (close[c]) {\n      if (open.pop() !== close[c]) return false;\n    }\n  }\n  return ${strict ? 'open.length === 0' : 'true'};\n}`;
    return {
      group: 'write-strings',
      name: 'isBalanced',
      ask: `Write a JavaScript function \`isBalanced(text)\` that returns true when every bracket in the text is closed by the right kind of bracket in the right order, and false otherwise. The brackets are ${pairs.map((p) => p[0] + ' ' + p[1]).join(', ')}; every other character is ignored. A text with no brackets is balanced.`,
      ok: src(true),
      bad: src(false),
      flaw: `it does not check that every opening bracket was closed, so a text that ends with one still open is called balanced`,
      inputs: ['', 'abc', '()', ')(', '(()', '(a)(b)', '([)]', '([])', '{[()]}', '((', '())', 'a(b]c', '[', ']'].map(
        (x) => [x],
      ),
    };
  },
  (t) => {
    const k = t.pick([4, 10, 20]); // even, so that there is a number exactly halfway
    const tie = t.pick(['up', 'down']);
    return {
      group: 'write-numbers',
      name: 'roundTo',
      ask: `Write a JavaScript function \`roundTo(n)\` that rounds a whole number to the nearest multiple of ${k}. A number exactly halfway between two multiples goes ${tie} (towards ${tie === 'up' ? 'the larger' : 'the smaller'} one). It must work for negative numbers.`,
      ok: `function roundTo(n) {\n  const low = Math.floor(n / ${k}) * ${k};\n  const rest = n - low;\n  return rest * 2 ${tie === 'up' ? '>=' : '>'} ${k} ? low + ${k} : low;\n}`,
      bad: `function roundTo(n) {\n  const low = Math.floor(n / ${k}) * ${k};\n  const rest = n - low;\n  return rest * 2 ${tie === 'up' ? '>' : '>='} ${k} ? low + ${k} : low;\n}`,
      flaw: `a number exactly halfway goes ${tie === 'up' ? 'down' : 'up'} instead of ${tie}`,
      inputs: [
        0, 1, 2, 3, 5, 6, 7, 10, 12, 13, 15, 25, 30, 37, 38, 50, 99, -1, -2, -3, -5, -6, -10, -12, -13, -25, -30, -38,
      ].map((x) => [x]),
    };
  },
  (t) => {
    const once = t.pick([true, false]);
    return {
      group: 'write-numbers',
      name: 'digitSum',
      ask: `Write a JavaScript function \`digitSum(n)\` that adds up the digits of a whole number that is zero or more${once ? '' : ', and if the result has more than one digit adds up its digits again, and so on until one digit is left'}. For example ${once ? '987 gives 24' : '987 gives 6 (9 + 8 + 7 = 24, then 2 + 4 = 6)'}.`,
      ok: once
        ? `function digitSum(n) {\n  let total = 0;\n  for (const d of String(n)) total += Number(d);\n  return total;\n}`
        : `function digitSum(n) {\n  while (n > 9) {\n    let total = 0;\n    for (const d of String(n)) total += Number(d);\n    n = total;\n  }\n  return n;\n}`,
      bad: once
        ? `function digitSum(n) {\n  while (n > 9) {\n    let total = 0;\n    for (const d of String(n)) total += Number(d);\n    n = total;\n  }\n  return n;\n}`
        : `function digitSum(n) {\n  let total = 0;\n  for (const d of String(n)) total += Number(d);\n  return total;\n}`,
      flaw: once
        ? `it keeps adding the digits of the result until one digit is left, where it should add them once`
        : `it adds the digits only once, where it should go on until one digit is left`,
      inputs: [0, 5, 9, 10, 19, 99, 123, 987, 1000, 9999, 55555, 123456789].map((x) => [x]),
    };
  },
  (t) => {
    const units = t.pick([
      [
        ['h', 3600],
        ['m', 60],
        ['s', 1],
      ],
      [
        ['d', 86400],
        ['h', 3600],
        ['m', 60],
      ],
    ]);
    const small = units[2][0];
    const src = (us) =>
      `function toSeconds(text) {\n  const size = { ${us.map(([u, n]) => `${u}: ${n}`).join(', ')} };\n  let total = 0;\n  for (const m of text.matchAll(/(\\d+)([${us.map(([u]) => u).join('')}])/g)) total += Number(m[1]) * size[m[2]];\n  return total;\n}`;
    return {
      group: 'write-parsing',
      name: 'toSeconds',
      ask: `Write a JavaScript function \`toSeconds(text)\` that turns a length of time written like "${'2' + units[0][0] + '30' + units[1][0]}" into a number of seconds. The parts are whole numbers followed by ${units.map(([u, n]) => u + ' (' + n + ' second' + (n > 1 ? 's' : '') + ')').join(', ')}; any of them may be missing, and they come in that order. An empty string gives 0.`,
      ok: src(units),
      bad: src(units.slice(0, 2)),
      flaw: `it does not know the unit ${small}, so that part of the time is treated as nothing`,
      inputs: [
        '',
        '5' + small,
        '2' + units[0][0],
        '10' + units[1][0],
        '1' + units[0][0] + '1' + units[1][0],
        '2' + units[0][0] + '30' + units[1][0],
        '1' + units[0][0] + '5' + small,
        '3' + units[0][0] + '45' + units[1][0] + '10' + small,
        '0' + units[0][0],
        '90' + units[1][0],
        '100' + small,
      ].map((x) => [x]),
    };
  },
  (t) => {
    const wins = t.pick(['first', 'last']);
    const sep = t.pick([';', ',', '&']);
    const src = (w) =>
      `function parsePairs(text) {\n  const out = {};\n  for (const part of text.split('${sep}')) {\n    const at = part.indexOf('=');\n    if (at < 0) continue;\n    const key = part.slice(0, at);\n    ${w === 'first' ? 'if (key in out) continue;\n    ' : ''}out[key] = part.slice(at + 1);\n  }\n  return out;\n}`;
    return {
      group: 'write-parsing',
      name: 'parsePairs',
      ask: `Write a JavaScript function \`parsePairs(text)\` that turns text like "a=1${sep}b=2" into the object { a: "1", b: "2" }. Pairs are separated by "${sep}", and a key is separated from its value by the first "=" in the pair (a value may contain "="). A part with no "=" is skipped. If a key appears more than once, the ${wins} one wins. An empty string gives an empty object.`,
      ok: src(wins),
      bad: src(wins === 'first' ? 'last' : 'first'),
      flaw: `when a key appears more than once it keeps the ${wins === 'first' ? 'last' : 'first'} value, not the ${wins}`,
      inputs: [
        '',
        'a=1',
        `a=1${sep}b=2`,
        `a=1${sep}a=2`,
        `a=1${sep}b=2${sep}a=3`,
        `x=1=2`,
        `nokey${sep}a=1`,
        `a=`,
        `=1`,
        `a=1${sep}${sep}b=2`,
        `k=v${sep}k=w${sep}j=z${sep}k=x`,
      ].map((x) => [x]),
    };
  },
];
export const GROUPS = [...new Set(FAMILIES.map((f) => f({ int: (a) => a, pick: (l) => l[0] }).group))];

// the kinds: for each, t (seeded tools) and i (which question of the kind this is) -> a question
const pickIn = (group, i) => {
  const of = FAMILIES.filter((f) => f({ int: (a) => a, pick: (l) => l[0] }).group === group);
  return of[i % of.length];
};
const write = (group) => (t, i) => {
  const f = pickIn(group, i)(t);
  return {
    ask: f.ask + ' Give the function in one code block.',
    type: 'code',
    name: f.name,
    inputs: f.inputs,
    ok: f.ok,
  };
};
// THE SAME FAMILIES, ASKED FOR IN PYTHON (py-arrays, py-strings, py-numbers, py-parsing). Every question here asked for
// JavaScript, and what a module is asked for elsewhere is mostly Python: adapters taught on these questions gained 24 points
// on them and none on two Python benchmarks (measured 2026-11-23). The question is the family's, said for Python; the
// answer is run in Python and marked against what the family's own function gives on the same inputs.
// Asked three ways in turn, the ways such a function is usually asked for: plainly; as a function with a docstring to
// complete; and as a task with tests it should pass (the tests are the family's own function on its first inputs).
export const pyNameOf = (name) => name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
// a value as Python writes it
export const pyLit = (v) =>
  v === null || v === undefined
    ? 'None'
    : v === true
      ? 'True'
      : v === false
        ? 'False'
        : Array.isArray(v)
          ? '[' + v.map(pyLit).join(', ') + ']'
          : typeof v === 'object'
            ? '{' +
              Object.entries(v)
                .map(([k, x]) => JSON.stringify(k) + ': ' + pyLit(x))
                .join(', ') +
              '}'
            : JSON.stringify(v);
// the family's words, for Python: its lists, its None, its True and False, its dict
export const pySays = (text, name) =>
  text
    .replaceAll('`' + name + '(', '`' + pyNameOf(name) + '(')
    .replace(/\bnew array\b/g, 'new list')
    .replace(/\barrays\b/g, 'lists')
    .replace(/\barray\b/g, 'list')
    .replace(/\bgives null\b/g, 'gives None')
    .replace(/\breturns true\b/g, 'returns True')
    .replace(/\bfalse otherwise\b/g, 'False otherwise')
    .replace(/the object \{ a: "1", b: "2" \}/g, 'the dict {"a": "1", "b": "2"}')
    .replace(/\bobject\b/g, 'dict');
const pyWrite = (group) => (t, i) => {
  const f = pickIn(group, i)(t);
  const name = pyNameOf(f.name);
  const args = (f.ask.match(/`[A-Za-z]+\(([^)]*)\)`/) || [])[1] || '';
  const does = pySays(f.ask.replace(/^Write a JavaScript function `[^`]+` that /, ''), f.name);
  // (the family's own function, run here on its first inputs: this file's code, not a model's)
  let shown = [];
  try {
    const fn = new Function(f.ok + '\nreturn ' + f.name + ';')();
    shown = f.inputs
      .slice(1, 4)
      .map(
        (a) => 'assert ' + name + '(' + a.map(pyLit).join(', ') + ') == ' + pyLit(fn(...JSON.parse(JSON.stringify(a)))),
      );
  } catch {
    shown = [];
  }
  const ask =
    i % 3 === 0 || !shown.length
      ? 'Write a Python function `' + name + '(' + args + ')` that ' + does + ' Give the function in one code block.'
      : i % 3 === 1
        ? 'Write a solution to the following problem. Give the whole function in one code block.\n```python\ndef ' +
          name +
          '(' +
          args +
          '):\n    """' +
          does.replace(/^./, (c) => c.toUpperCase()) +
          '"""\n```'
        : 'Here is your task: write a Python function `' +
          name +
          '(' +
          args +
          ')` that ' +
          does +
          ' Your code should pass these tests:\n\n' +
          shown.join('\n');
  return { ask, type: 'code', lang: 'python', name: f.name, pyName: name, inputs: f.inputs, ok: f.ok };
};
export const PY_KINDS = Object.fromEntries(GROUPS.map((g) => [g.replace(/^write-/, 'py-'), pyWrite(g)]));
export const CODE_KINDS = {
  ...Object.fromEntries(GROUPS.map((g) => [g, write(g)])),
  // a function with one flaw, and what it should do: give it back corrected
  fix(t, i) {
    const f = FAMILIES[(i * 3 + 1) % FAMILIES.length](t);
    return {
      ask: `This function is meant to do the following, and it is wrong.\n\nWhat it should do: ${f.ask.replace(/^Write a JavaScript function `[^`]+` that /, 'It ')}\n\n\`\`\`js\n${f.bad}\n\`\`\`\n\nGive the corrected function, in one code block, with the same name.`,
      type: 'code',
      name: f.name,
      inputs: f.inputs,
      ok: f.ok,
    };
  },
  // the same, asked in words: what is wrong with it? (an answer that cannot be run)
  bug(t, i) {
    const f = FAMILIES[(i * 5 + 2) % FAMILIES.length](t);
    return {
      ask: `This function is meant to do the following, and it is wrong.\n\nWhat it should do: ${f.ask.replace(/^Write a JavaScript function `[^`]+` that /, 'It ')}\n\n\`\`\`js\n${f.bad}\n\`\`\`\n\nIn one or two sentences, what is the bug? Do not rewrite the function.`,
      type: 'open',
      flaw: f.flaw,
    };
  },
};
