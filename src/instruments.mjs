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
// the question is a sum and nothing else: its text, less a label before it and "=" (or "= ?", "is") after it
function sumIn(q0) {
  // (operators said in words: "98 plus 45", "95 times 45", "6 divided by 3")
  const q = /\d\s+(?:plus|minus|times|multiplied by|divided by)\s+-?\d/i.test(q0)
    ? q0
        .replace(/\bplus\b/gi, '+')
        .replace(/\bminus\b/gi, '-')
        .replace(/\b(?:times|multiplied by)\b/gi, '*')
        .replace(/\bdivided by\b/gi, '/')
    : q0;
  const m =
    /^(?:[A-Za-z ]{0,40}:\s*)?(?:what is\s+|compute\s+|calculate\s+|evaluate\s+)?([-+*/().\d\s]{3,400}?)\s*(?:=\s*\??|\?)?\s*$/i.exec(
      q,
    );
  return m ? sumOf(m[1]) : null;
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
function truthIn(q) {
  const m = /^(?:[A-Za-z ]{0,40}:\s*)?((?:\(|\)|\s|\b(?:True|False|not|and|or)\b)+?)\s*(?:is|=)\s*\??\s*$/.exec(q);
  return m ? truthOf(m[1]) : null;
}

// ---- words in order -------------------------------------------------------------------------------------------------------
// "Sort the following words alphabetically: List: b a c" -> "a b c". The words are what follows the last colon, parted by white
// space or by commas; in order as a dictionary has them (by character, lower case; a shorter word before a longer one it begins)
function sortedIn(q) {
  if (
    !/\b(?:sort|order|arrange|put)\b[^:\n]{0,80}\b(?:alphabetical(?:ly)?|alphabetic|in alphabetical order|dictionary order)\b/i.test(
      q,
    )
  )
    return null;
  if (/\b(?:reverse|descending|backwards?)\b/i.test(q)) return null;
  const at = q.lastIndexOf(':');
  if (at < 0) return null;
  const list = q
    .slice(at + 1)
    .trim()
    .replace(/[.?]$/, '');
  if (!list || /\n/.test(list)) return null;
  const byComma = list.includes(',');
  const words = (byComma ? list.split(',') : list.split(/\s+/)).map((w) => w.trim()).filter(Boolean);
  if (words.length < 2 || words.some((w) => w.length > 40 || (byComma ? false : /[,;:]/.test(w)))) return null;
  const key = (w) => w.toLowerCase();
  const out = [...words].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return out.join(byComma ? ', ' : ' ');
}

// ---- brackets closed ------------------------------------------------------------------------------------------------------
// "Complete the rest of the sequence, making sure that the parentheses are closed properly. Input: [ { (" -> ") } ]"
const PAIR = { '(': ')', '[': ']', '{': '}', '<': '>' };
function closedIn(q) {
  if (
    !/\b(?:clos(?:e|ed|ing)|complete|balanc(?:e|ed))\b[^\n]{0,120}\b(?:parenthes[ie]s|brackets?|braces?|sequence)\b|\b(?:parenthes[ie]s|brackets?)\b[^\n]{0,80}\bclosed\b/i.test(
      q,
    )
  )
    return null;
  const at = q.lastIndexOf(':');
  if (at < 0) return null;
  const seq = q.slice(at + 1).trim();
  if (!seq || !/^[()[\]{}<>\s]+$/.test(seq)) return null;
  const stack = [];
  for (const ch of seq.replace(/\s+/g, '')) {
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
