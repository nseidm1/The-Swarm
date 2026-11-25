// instruments.mjs - WHAT CODE DOES EXACTLY, CODE DOES. Some questions ARE an operation: put these words in order, work this sum
// out, say what this expression of true and false comes to, close these brackets. A small model does them by guessing (measured
// 2026-11-22 on standard tests, one 1.2B model: 0 of 20 words sorted, 0 of 20 brackets closed; the module of two of them 1 and
// 1). Asked to write a program for it, the same model printed its own guess from inside the program, and whether it wrote a
// program at all turned on a label before the question. Nothing a model writes is needed for these: the operation is read from
// the question itself and done here, by code, and what it gives is the answer.
//   instrumentFor(question) -> { id, name, answer, shows } or null
// An instrument applies only where the question, as it is written, states the operation and gives everything it needs. Where it
// does not apply, nothing changes. Nothing here guesses: an input it cannot read whole is no input, and the question goes the
// way every other question goes. NONE IS ON UNTIL TRAINING TURNS IT ON (plan.instruments: the ids training kept for a class
// of input, by the rule it keeps every change by): a module as it is configured asks its models, and what an instrument
// is worth to it is measured on training's own questions before a benchmark ever sees it.

// ---- sums -----------------------------------------------------------------------------------------------------------------
// an expression of numbers, + - * / and round brackets, read by a parser of its own (nothing is evaluated as code)
function sumOf(text) {
  const s = String(text).replace(/\s+/g, '');
  if (!s || !/^[-+*/().\d]+$/.test(s) || !/\d/.test(s) || !/[-+*/]/.test(s.slice(1))) return null;
  let i = 0;
  const num = () => {
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('no number');
    i += m[0].length;
    return Number(m[0]);
  };
  const unary = () => {
    if (s[i] === '-') return (i++, -unary());
    if (s[i] === '+') return (i++, unary());
    if (s[i] === '(') {
      i++;
      const v = add();
      if (s[i] !== ')') throw new Error('no closing bracket');
      i++;
      return v;
    }
    return num();
  };
  const mul = () => {
    let v = unary();
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const r = unary();
      if (op === '/' && r === 0) throw new Error('division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  function add() {
    let v = mul();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = mul();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = add();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  } catch {
    return null;
  }
}
// WORDS OF ASKING: what a question may hold beside the thing to work on and still be nothing but the operation. A word that
// is not one of these (a name, a thing, a unit) means the question is about something, and is not ours.
const ASKING = new Set(
  (
    'a an and answer as be calculate can come compute could determine do does equal equals evaluate evaluates expression ' +
    'figure find following for get give help here how i if in is it its kindly me much need now number of one out please ' +
    'provide question result show simplify so solve state statement sum task tell that the this to total truth value ' +
    'what whether which work would you your q'
  ).split(' '),
);
// is what is left of a question, the operand taken out, only words of asking (and signs that ask: = ? . , : !)?
const onlyAsking = (rest, also = []) =>
  String(rest)
    .toLowerCase()
    .replace(/[=?.,:!'"`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => ASKING.has(w) || also.includes(w));
// THE QUESTION HOLDS ONE SUM AND, BESIDE IT, ONLY WORDS OF ASKING. The sum is the one run of numbers, signs and round brackets
// that works out; a date written with strokes or dashes is no sum.
function sumIn(q0) {
  // (operators said in words: "98 plus 45", "95 times 45", "6 divided by 3")
  const q = (
    /\d\s+(?:plus|minus|times|multiplied by|divided by)\s+-?\d/i.test(q0)
      ? q0
          .replace(/\bplus\b/gi, '+')
          .replace(/\bminus\b/gi, '-')
          .replace(/\b(?:times|multiplied by)\b/gi, '*')
          .replace(/\bdivided by\b/gi, '/')
      : q0
  )
    // (a share of a number, as it is written: "15% of 60", "15 per cent of 60". It is the sum 15 / 100 * 60, and a small
    // model asked it after other talk worked 15 * 0.15: measured 2026-11-24, three of twelve such turns)
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|per ?cent)\s+of\s+(\d+(?:\.\d+)?)/gi, '($1 / 100 * $2)');
  // (a date, as dates are written: 3/4/2020, 2020-11-22; with no space in it. A sum of the same numbers has its spaces or its brackets)
  if (/(?:^|[^\d/])\d{1,2}\/\d{1,2}\/\d{2,4}(?![\d/])|(?:^|[^\d-])\d{4}-\d{1,2}-\d{1,2}(?![\d-])/.test(q)) return null;
  const runs = [...q.matchAll(/[-+(\d][-+*/().\d\s]*/g)]
    .map((m) => ({ text: m[0].trim().replace(/[.]+$/, ''), at: m.index, len: m[0].length }))
    .filter((x) => /\d/.test(x.text));
  if (runs.length !== 1) return null;
  const v = sumOf(runs[0].text);
  if (v === null) return null;
  const rest = q.slice(0, runs[0].at) + ' ' + q.slice(runs[0].at + runs[0].len);
  return onlyAsking(rest) ? v : null;
}

// ---- true and false -------------------------------------------------------------------------------------------------------
function truthOf(text) {
  const toks = String(text).match(/\(|\)|\b(?:True|False|not|and|or)\b|\S+/g) || [];
  if (
    !toks.length ||
    toks.some((t) => !/^(?:\(|\)|True|False|not|and|or)$/.test(t)) ||
    !toks.some((t) => /^(?:not|and|or)$/.test(t))
  )
    return null;
  let i = 0;
  const atom = () => {
    const t = toks[i++];
    if (t === 'True') return true;
    if (t === 'False') return false;
    if (t === '(') {
      const v = or();
      if (toks[i++] !== ')') throw new Error('no closing bracket');
      return v;
    }
    throw new Error('not a value');
  };
  // (as Python reads it: not binds tighter than and, and tighter than or)
  const not = () => (toks[i] === 'not' ? (i++, !not()) : atom());
  const and = () => {
    let v = not();
    while (toks[i] === 'and') {
      i++;
      const r = not();
      v = v && r;
    }
    return v;
  };
  function or() {
    let v = and();
    while (toks[i] === 'or') {
      i++;
      const r = and();
      v = v || r;
    }
    return v;
  }
  try {
    const v = or();
    return i === toks.length ? (v ? 'True' : 'False') : null;
  } catch {
    return null;
  }
}
// THE QUESTION HOLDS ONE SUCH EXPRESSION AND, BESIDE IT, ONLY WORDS OF ASKING. Two runs of True and False (as in "is this True
// or False? not True and False") are two expressions, and it is not said which is asked: none
function truthIn(q) {
  const runs = [
    ...q.matchAll(/(?:\(|\)|\b(?:True|False|not|and|or)\b)(?:\s*(?:\(|\)|\b(?:True|False|not|and|or)\b))*/g),
  ]
    .map((m) => ({ text: m[0], at: m.index, len: m[0].length }))
    .filter((x) => /\b(?:True|False)\b/.test(x.text));
  // ("... True or False?" names the two answers there are: it is part of the asking, where another run is the expression)
  const named = (x) => /^True\s+or\s+False$/.test(x.text.trim());
  const exprs = runs.length > 1 ? runs.filter((x) => !named(x)) : runs;
  if (exprs.length !== 1) return null;
  const v = truthOf(exprs[0].text);
  if (v === null) return null;
  let rest = q.slice(0, exprs[0].at) + ' ' + q.slice(exprs[0].at + exprs[0].len);
  if (runs.length > 1) rest = rest.replace(/\bTrue\s+or\s+False\b/, ' ');
  return onlyAsking(rest.replace(/\btrue or false\b/i, ' ')) ? v : null;
}

// ---- words in order -------------------------------------------------------------------------------------------------------
// "Sort the following words alphabetically: List: b a c" -> "a b c". AN INSTRUCTION, not a question about sorting: the verb
// stands at the head of a sentence ("Why do dictionaries sort words alphabetically: is it convention?" is no instruction, and
// was answered "convention is it"), and what follows the last colon is a list, not a question. The words are parted by
// commas, semicolons, bars or lines where the list has them, else by white space; an item with no letter or digit in it is no
// word (a list parted by bars came back with the bars sorted in). In order as a dictionary has them (by character, lower case).
const SORT_VERB =
  /(?:^|[.!?\n]\s*|^[A-Za-z ]{1,20}:\s*)(?:please\s+|kindly\s+|could you\s+|can you\s+|would you\s+)*(?:sort|order|arrange|put|organi[sz]e|list|rank|alphabeti[sz]e)\b/i;
const SORT_HOW =
  /\b(?:alphabetical(?:ly)?|alphabetic|alphabeti[sz]e|dictionary order|lexicographic(?:al)?(?:ly)?|from a to z|by the alphabet)\b/i;
// (or a request put as a question: "What is the alphabetical order of these words: ...", "Give me the alphabetical list of ...",
// "How would you alphabetize ...". Not a question ABOUT sorting, which asks why, whether or when)
const SORT_ASK =
  /(?:^|[.!?\n]\s*)(?:what is|what's|what would be|give me|show me|i need|how would you|how do (?:i|you)|can you give me|tell me)\b[^:\n?]{0,60}\b(?:alphabetical|alphabeti[sz]e|lexicographic)/i;
function sortedIn(q) {
  if (!(SORT_VERB.test(q) || SORT_ASK.test(q)) || !SORT_HOW.test(q)) return null;
  if (/(?:^|[.!?\n]\s*)(?:why|whether|when|should|is it|are)\b/i.test(q)) return null;
  if (/\b(?:reverse|reversed|descending|backwards?|from z to a)\b/i.test(q)) return null;
  const at = q.lastIndexOf(':');
  if (at < 0) return null;
  const list = q.slice(at + 1).trim();
  if (!list || /\?\s*$/.test(list)) return null;
  const lines = list
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const [parts, glue] =
    lines.length > 1
      ? [lines.map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s+/, '')), ' ']
      : list.includes(',')
        ? [list.split(','), ', ']
        : list.includes(';')
          ? [list.split(';'), '; ']
          : list.includes('|')
            ? [list.split('|'), ' | ']
            : [list.replace(/[.]$/, '').split(/\s+/), ' '];
  const words = parts.map((w) => w.trim().replace(/[.]$/, '')).filter(Boolean);
  if (words.length < 2 || words.some((w) => w.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N}'’&.-]*$/u.test(w))) return null;
  const key = (w) => w.toLowerCase();
  return [...words].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).join(glue);
}

// ---- brackets closed ------------------------------------------------------------------------------------------------------
// "Complete the rest of the sequence, making sure that the parentheses are closed properly. Input: [ { (" -> ") } ]"
const PAIR = { '(': ')', '[': ']', '{': '}', '<': '>' };
function closedIn(q) {
  // (it speaks of closing, completing, finishing, balancing, or of what is missing)
  if (!/\b(?:clos(?:e|es|ed|ing)|complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?|balanc(?:e|es|ed|ing)|missing)\b/i.test(q))
    return null;
  // the run of brackets the question ends with (after its last colon, or simply at its end): all of it brackets and white space
  // (or that it begins with: "( [ { needs its closing brackets"; one run, at its end or at its head, and words for the rest)
  const m = /([()[\]{}<>][()[\]{}<>\s]*)$/.exec(q) || /^([()[\]{}<>][()[\]{}<>\s]*)/.exec(q);
  if (!m) return null;
  const before = q.slice(0, m.index) + ' ' + q.slice(m.index + m[1].length);
  if (!/[A-Za-z]/.test(before) || /[()[\]{}<>]/.test(before)) return null; // (brackets elsewhere, with words between: not one run)
  const stack = [];
  for (const ch of m[1].replace(/\s+/g, '')) {
    if (PAIR[ch]) stack.push(ch);
    else if (!stack.length || PAIR[stack.pop()] !== ch) return null; // (it closes what was never opened: not ours to mend)
  }
  if (!stack.length) return null;
  return stack
    .reverse()
    .map((ch) => PAIR[ch])
    .join(' ');
}

const INSTRUMENTS = [
  { id: 'sum', name: 'worked out as a sum', of: sumIn },
  { id: 'truth', name: 'worked out as an expression of true and false', of: truthIn },
  { id: 'sorted', name: 'put in order by the alphabet', of: sortedIn },
  { id: 'closed', name: 'each bracket left open closed, the last opened first', of: closedIn },
];
// THE QUESTION AS AN INSTRUMENT READS IT: what was asked, without what a form puts round it. A label before it ("Q:",
// "Question:") is taken off, and so are the lines at its end that only say where the answer goes: a short label and a colon
// with nothing after ("A:", "Answer:", "Sorted:", "Output:"), or "A: Let's think step by step." (Measured 2026-11-22 on a
// benchmark by other contributors: the same sorting and bracket tasks, laid out with such a line at the end, were read on
// none of 2,900 questions.)
export const bare = (question) => {
  let q = String(question || '')
    .replace(/\r/g, '')
    .trim()
    .replace(/^Q(?:uestion)?:\s*/i, '');
  for (;;) {
    const cut = q
      .replace(/\n+[ \t]*[A-Za-z][A-Za-z ]{0,19}:[ \t]*(?:Let'?s think step by step\.?)?[ \t]*$/i, '')
      .trimEnd();
    if (cut === q) break;
    q = cut;
  }
  return q.trim();
};
// which are on: true (every one), or a list of their ids (plan.instruments, as training kept them); nothing, and none is
export const INSTRUMENT_IDS = INSTRUMENTS.map((it) => it.id);
export const INSTRUMENT_NAMES = Object.fromEntries(INSTRUMENTS.map((it) => [it.id, it.name]));
export const instrumentsOn = (on) =>
  on === true ? INSTRUMENT_IDS : Array.isArray(on) ? INSTRUMENT_IDS.filter((id) => on.includes(id)) : [];
export function instrumentFor(question, on = true) {
  const q = bare(question);
  if (!q || q.length > 2000) return null;
  const ids = instrumentsOn(on);
  for (const it of INSTRUMENTS) {
    if (!ids.includes(it.id)) continue;
    const answer = it.of(q);
    if (answer !== null && answer !== undefined && answer !== '') return { id: it.id, name: it.name, answer };
  }
  return null;
}
