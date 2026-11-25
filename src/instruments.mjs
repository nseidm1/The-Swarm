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
import { FORMS } from './forms.mjs';

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

// ---- four more, each a whole question read sentence by sentence -------------------------------------------------------------
// The four above read one operand beside words of asking. These read a question that is nothing but statements of a fixed
// kind and what is asked of them, every sentence of it: one sentence that is not understood, and the question is not ours.
// They were written from training's own questions (measured 2026-11-25: of the kinds no model here could write a function
// for, these are the ones the swarm was wrong on, 12 of 24 held questions), and no benchmark's question was read for them.
const sentencesOf = (q) =>
  String(q)
    .split(/\n+|(?<=[.?!])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

// WHO TELLS THE TRUTH: "Ada tells the truth." or "Ada lies."; then "Milo says Ada tells the truth." or "... says Ada lies.";
// asked "Does Nora tell the truth?". Each person is settled from the one they speak of; Yes or No.
function liesIn(q) {
  const truth = new Map();
  const says = [];
  let asked = null;
  for (const x of sentencesOf(q)) {
    let m;
    if ((m = /^([A-Z][\w'-]*) (tells the truth|lies)\.$/.exec(x))) truth.set(m[1], m[2] !== 'lies');
    else if ((m = /^([A-Z][\w'-]*) says (?:that )?([A-Z][\w'-]*) (tells the truth|lies)\.$/.exec(x)))
      says.push({ who: m[1], of: m[2], honest: m[3] !== 'lies' });
    else if ((m = /^Does ([A-Z][\w'-]*) tell the truth\?$/.exec(x))) {
      if (asked) return null;
      asked = m[1];
    } else if (!/^(?:Answer|Reply|Say) (?:with )?(?:Yes or No|yes or no)\.?$/.test(x)) return null;
  }
  if (!asked || !truth.size || !says.length) return null;
  for (let turn = 0; turn <= says.length; turn++)
    for (const c of says) {
      if (!truth.has(c.of)) continue;
      // (who says a true thing tells the truth: saying "lies" of a liar, or "tells the truth" of one who does)
      const v = truth.get(c.of) === c.honest;
      if (truth.has(c.who) && truth.get(c.who) !== v) return null; // the statements do not agree: not ours to settle
      truth.set(c.who, v);
    }
  return truth.has(asked) ? (truth.get(asked) ? 'Yes' : 'No') : null;
}

// A WORD, AND WHAT IS DONE TO IT IN TURN: 'Take the word "silver". Reverse it. Then remove its last letter. What is left?'
function wordIn(q) {
  const ss = sentencesOf(q);
  const first = /^(?:Take|Start with|Begin with) the word ["“']([A-Za-z]+)["”']\.$/.exec(ss[0] || '');
  if (!first || ss.length < 3) return null;
  if (!/^(?:What is left|What do you (?:get|have)|What is the result|What remains)\?$/.test(ss[ss.length - 1]))
    return null;
  const N = { one: 1, two: 2, three: 3, four: 4 };
  let w = first[1];
  for (const x of ss.slice(1, -1)) {
    const t = x.replace(/^(?:Then|Next|After that|Now|Finally),? /i, '').replace(/^./, (c) => c.toUpperCase());
    let m;
    if (/^Reverse it\.$/.test(t)) w = [...w].reverse().join('');
    else if (/^(?:Write|Put) it in (?:capital letters|capitals|upper ?case(?: letters)?)\.$/.test(t))
      w = w.toUpperCase();
    else if (/^(?:Write|Put) it in (?:small letters|lower ?case(?: letters)?)\.$/.test(t)) w = w.toLowerCase();
    else if ((m = /^Remove its (first|last) (?:(one|two|three|four|\d) )?letters?\.$/.exec(t))) {
      const n = m[2] ? N[m[2]] || Number(m[2]) : 1;
      if (!(n >= 1) || n >= w.length) return null;
      w = m[1] === 'first' ? w.slice(n) : w.slice(0, -n);
    } else if (/^Double it\.$/.test(t)) w = w + w;
    else return null;
  }
  return w || null;
}

// THINGS IN A ROW, AND WHERE EACH STANDS: "On a shelf there are 5 books in a row: a black book, a green book, ...", then
// "The green book is to the right of the white book.", "The red book is the leftmost.", "The yellow book is the third from
// the left."; asked "Which book is the second from the left?", with lettered options or without. Every way of ordering them
// is tried; where the statements leave one thing only in the place asked, that is the answer.
const PLACE = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
function rowIn(q) {
  const head = /^[\s\S]*?\bthere are (\d+|three|four|five|six|seven) ([a-z]+) in a row: ([^.\n]+)\./i.exec(String(q));
  if (!head) return null;
  const items = head[3].split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) =>
    x
      .trim()
      .replace(/^(?:an?|the) /i, '')
      .toLowerCase(),
  );
  const n = items.length;
  const said = { three: 3, four: 4, five: 5, six: 6, seven: 7 }[head[1].toLowerCase()] || Number(head[1]);
  if (n < 2 || n > 7 || n !== said || new Set(items).size !== n) return null;
  const at = (name) => items.indexOf(String(name).trim().replace(/^the /i, '').toLowerCase());
  // (a place as it is said: the leftmost, the rightmost, the third from the left, the second from the right) -> index, or -1
  const placeOf = (t) => {
    const x = t.toLowerCase();
    if (x === 'leftmost' || x === 'first from the left') return 0;
    if (x === 'rightmost' || x === 'first from the right') return n - 1;
    const m = /^(second|third|fourth|fifth|sixth|seventh) from the (left|right)$/.exec(x);
    if (!m || PLACE[m[1]] > n) return -1;
    return m[2] === 'left' ? PLACE[m[1]] - 1 : n - PLACE[m[1]];
  };
  const rules = [];
  let asked = -1;
  const options = [];
  for (const x of sentencesOf(String(q).slice(head[0].length))) {
    let m;
    if ((m = /^The ([a-z ]+?) is (?:somewhere )?to the (left|right) of the ([a-z ]+?)\.$/i.exec(x))) {
      const a = at(m[1]);
      const b = at(m[3]);
      if (a < 0 || b < 0) return null;
      rules.push(m[2].toLowerCase() === 'left' ? (pos) => pos[a] < pos[b] : (pos) => pos[a] > pos[b]);
    } else if ((m = /^The ([a-z ]+?) is the ([a-z ]+)\.$/i.exec(x))) {
      const a = at(m[1]);
      const k = placeOf(m[2]);
      if (a < 0 || k < 0) return null;
      rules.push((pos) => pos[a] === k);
    } else if ((m = /^Which [a-z]+ is the ([a-z ]+)\?$/i.exec(x))) {
      asked = placeOf(m[1]);
      if (asked < 0) return null;
    } else if ((m = /^\(([A-H])\) (?:The )?([a-z ]+?)\.?$/i.exec(x)))
      options.push({ letter: m[1].toUpperCase(), item: at(m[2]) });
    else if (!/^Options:$/i.test(x) && !/^Answer with the letter of the one option\.?$/i.test(x)) return null;
  }
  if (asked < 0 || options.some((o) => o.item < 0)) return null;
  const found = new Set();
  const pos = new Array(n).fill(-1);
  const used = new Array(n).fill(false);
  const place = (i) => {
    if (i === n) {
      if (rules.every((r) => r(pos))) found.add(pos.indexOf(asked));
      return;
    }
    for (let k = 0; k < n; k++) {
      if (used[k]) continue;
      used[k] = true;
      pos[i] = k;
      place(i + 1);
      used[k] = false;
    }
    pos[i] = -1;
  };
  place(0);
  if (found.size !== 1) return null; // (none, or more than one: the statements do not settle it)
  const it = [...found][0];
  if (!options.length) return 'The ' + items[it];
  const o = options.filter((x) => x.item === it);
  return o.length === 1 ? o[0].letter : null;
}

// A DATE, SO MANY DAYS OR WEEKS ON OR BACK: "Today is 04/13/2017 (month/day/year). What is the date 44 days ago?", with
// lettered options (the letter of the one that is that date) or without (the date, written as today's is).
function dateIn(q) {
  const ss = sentencesOf(q);
  const t = /^Today is (\d{1,2})\/(\d{1,2})\/(\d{4}) \((month\/day\/year|day\/month\/year)\)\.$/.exec(ss[0] || '');
  const w =
    /^What (?:is the date|date (?:is|was|will it be)) (\d+) (day|week)s? (ago|from now|from today|later|earlier|before today)\?$/i.exec(
      ss[1] || '',
    );
  if (!t || !w) return null;
  const mdy = t[4] === 'month/day/year';
  const [mo, da] = mdy ? [Number(t[1]), Number(t[2])] : [Number(t[2]), Number(t[1])];
  const start = new Date(Date.UTC(Number(t[3]), mo - 1, da));
  if (start.getUTCMonth() !== mo - 1 || start.getUTCDate() !== da) return null; // (no such day)
  const back = /ago|earlier|before/i.test(w[3]);
  const days = Number(w[1]) * (/week/i.test(w[2]) ? 7 : 1) * (back ? -1 : 1);
  const d = new Date(start.getTime() + days * 86400000);
  const two = (v) => String(v).padStart(2, '0');
  const write = (x) =>
    (mdy
      ? two(x.getUTCMonth() + 1) + '/' + two(x.getUTCDate())
      : two(x.getUTCDate()) + '/' + two(x.getUTCMonth() + 1)) +
    '/' +
    x.getUTCFullYear();
  const want = write(d);
  const options = [];
  for (const x of ss.slice(2)) {
    const m = /^\(([A-H])\) (\d{1,2})\/(\d{1,2})\/(\d{4})\.?$/.exec(x);
    if (m) options.push({ letter: m[1], date: two(m[2]) + '/' + two(m[3]) + '/' + m[4] });
    else if (!/^Options:$/i.test(x) && !/^Answer with the letter of the one option\.?$/i.test(x)) return null;
  }
  if (!options.length) return want;
  const o = options.filter((x) => x.date === want);
  return o.length === 1 ? o[0].letter : null;
}

// FOUR MORE THAT READ A WHOLE QUESTION. Each reads the wordings it knows into a form, and the form is worked out by the code
// that works out a form a model filled (forms.mjs): one way of working it out, however the question was read.
// WHEN SOMEONE WAS FREE: woke at, seen from..to (several), closed after; lettered stretches of time
function freeIn(q) {
  const f = { awakeFrom: '', seen: [], closedAfter: '' };
  const T = '(\\d{1,2}(?:am|pm))';
  let asked = false;
  for (const x of sentencesOf(q)) {
    let m;
    if (/^Today [A-Z][\w'-]* went to [a-z ]+\.$/.test(x) || /^We know that:$/.test(x) || /^Options:$/.test(x)) continue;
    if (/^\([A-H]\) /.test(x) || /^Answer with the letter of the one option\.?$/.test(x)) continue;
    if (/^Between what times could (?:they|he|she|[A-Z][\w'-]*) have gone(?: to [a-z ]+)?(?: today)?\?$/.test(x))
      asked = true;
    else if ((m = new RegExp("^[A-Z][\\w'-]* woke up at " + T + '\\.$').exec(x))) f.awakeFrom = m[1];
    else if ((m = new RegExp("^[A-Z][\\w'-]* saw [A-Z][\\w'-]* [a-z ]+ from " + T + ' to ' + T + '\\.$').exec(x)))
      f.seen.push({ from: m[1], to: m[2] });
    else if ((m = new RegExp('^The [a-z ]+ was closed after ' + T + '\\.$').exec(x))) f.closedAfter = m[1];
    else return null;
  }
  return asked && f.awakeFrom && f.closedAfter ? FORMS.free.answer(f, q) : null;
}
// WHO IS THE TALLEST: "Jon is shorter than Ada.", "Esme is taller than Ada."; "Who is the second tallest?"
const LESS = { shorter: 1, younger: 1, lighter: 1, slower: 1, smaller: 1, cheaper: 1 };
const MORE = { taller: 1, older: 1, heavier: 1, faster: 1, bigger: 1, larger: 1, dearer: 1 };
const MOST = {
  tallest: 'greatest',
  oldest: 'greatest',
  heaviest: 'greatest',
  fastest: 'greatest',
  biggest: 'greatest',
  largest: 'greatest',
  shortest: 'least',
  youngest: 'least',
  lightest: 'least',
  slowest: 'least',
  smallest: 'least',
  cheapest: 'least',
};
function orderIn(q) {
  const f = { comparisons: [], asked: null };
  for (const x of sentencesOf(q)) {
    let m;
    if ((m = /^([A-Z][\w'-]*) is ([a-z]+er) than ([A-Z][\w'-]*)\.$/.exec(x))) {
      if (LESS[m[2]]) f.comparisons.push({ lesser: m[1], greater: m[3] });
      else if (MORE[m[2]]) f.comparisons.push({ lesser: m[3], greater: m[1] });
      else return null;
    } else if ((m = /^Who is the (?:(second|third|fourth|fifth) )?([a-z]+est)\?$/.exec(x))) {
      if (f.asked || !MOST[m[2]]) return null;
      f.asked = { rank: m[1] ? PLACE[m[1]] : 1, from: MOST[m[2]] };
    } else return null;
  }
  return f.asked && f.comparisons.length ? FORMS.order.answer(f, q) : null;
}
// HOW MANY MORE IN ONE QUARTER THAN ANOTHER: "Ines sold 116 units in the first quarter, 749 in the second and 521 in the
// third."; "How many more units did Ines sell in the third quarter than in the second quarter?"
function moreIn(q) {
  const Q = { first: 0, second: 1, third: 2 };
  const sold = new Map();
  let asked = null;
  for (const x of sentencesOf(q)) {
    let m;
    if (
      (m = /^([A-Z][\w'-]*) sold (\d+) units in the first quarter, (\d+) in the second and (\d+) in the third\.$/.exec(
        x,
      ))
    ) {
      if (sold.has(m[1])) return null;
      sold.set(m[1], [m[2], m[3], m[4]].map(Number));
    } else if (
      (m =
        /^How many more units did ([A-Z][\w'-]*) sell in the (first|second|third) quarter than in the (first|second|third) quarter\?$/.exec(
          x,
        ))
    ) {
      if (asked) return null;
      asked = m;
    } else if (!/^\(Give a negative number if fewer\.\)$/.test(x)) return null;
  }
  if (!asked || !sold.has(asked[1]) || asked[2] === asked[3]) return null;
  const row = sold.get(asked[1]);
  return FORMS.more.answer({ first: row[Q[asked[2]]], second: row[Q[asked[3]]] }, q);
}
// DOES THE ARGUMENT HOLD: "Consider this argument. All tovers are wugs. Ben is not a tover. Therefore, Ben is not a wug."
function validIn(q) {
  const read = (s) => {
    let m;
    if ((m = /^(All|No|Some) ([a-z]+) are (not )?([a-z]+)$/i.exec(s))) {
      const w = m[1].toLowerCase();
      if (m[3] && w !== 'some') return null;
      return { says: m[3] ? 'someNot' : w, subject: m[2], predicate: m[4] };
    }
    if ((m = /^([A-Z][\w'-]*) is (not )?an? ([a-z]+)$/.exec(s)))
      return { says: m[2] ? 'isNot' : 'is', subject: m[1], predicate: m[3] };
    return null;
  };
  const f = { premises: [], conclusion: null };
  let asked = false;
  for (const x of sentencesOf(q)) {
    if (/^Consider this argument\.$/.test(x) || /^Answer valid or invalid\.$/.test(x)) continue;
    if (/^Is the argument deductively valid or invalid, given only what it states\?$/.test(x)) {
      asked = true;
      continue;
    }
    const m = /^Therefore, (.+)\.$/.exec(x);
    const s = read(m ? m[1].replace(/^[a-z]/, (c) => c.toUpperCase()) : x.replace(/\.$/, ''));
    if (!s || (m && f.conclusion) || (!m && f.conclusion)) return null;
    if (m) f.conclusion = s;
    else f.premises.push(s);
  }
  return asked && f.conclusion && f.premises.length ? FORMS.valid.answer(f, q) : null;
}
const INSTRUMENTS = [
  { id: 'sum', name: 'worked out as a sum', of: sumIn },
  { id: 'truth', name: 'worked out as an expression of true and false', of: truthIn },
  { id: 'sorted', name: 'put in order by the alphabet', of: sortedIn },
  { id: 'closed', name: 'each bracket left open closed, the last opened first', of: closedIn },
  { id: 'lies', name: 'of who tells the truth, each settled from the one they speak of', of: liesIn, whole: true },
  { id: 'word', name: 'of a word and what is done to it in turn', of: wordIn, whole: true },
  { id: 'row', name: 'of things in a row, settled by trying every order', of: rowIn, whole: true },
  { id: 'date', name: 'of a date so many days on or back', of: dateIn, whole: true },
  { id: 'free', name: 'of when someone was free, from where they were seen', of: freeIn, whole: true },
  { id: 'order', name: 'of who is the tallest, from things compared two at a time', of: orderIn, whole: true },
  { id: 'more', name: 'of how many more one figure is than another', of: moreIn, whole: true },
  { id: 'valid', name: 'of whether an argument holds, by trying every world', of: validIn, whole: true },
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
// (the ones that read a whole question of a fixed kind, sentence by sentence: the later four)
export const INSTRUMENT_WHOLE = INSTRUMENTS.filter((it) => it.whole).map((it) => it.id);
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
