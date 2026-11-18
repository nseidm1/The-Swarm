// behave.mjs - WHICH DRAFTS DO THE SAME? Four drafts of a function are never the same text, so comparing them as text says they
// all disagree: every question then goes the long way round (checks, a decision), and "the answer most slots gave" means
// nothing. What a function IS is what it does. So where code is asked for, the drafts are RUN on the same calls, and drafts that
// give the same results are one answer:
//   1  one slot writes calls to try (ordinary ones and awkward ones). It is not asked for the results: nobody knows them
//   2  every draft is run on those calls, where it can reach nothing (sandbox.mjs)
//   3  drafts that return the same for every call are one behaviour. All of them the same: agreed. Otherwise the checkers and the
//      decider are shown one draft for each behaviour, and exactly where they part
// Nothing here says which behaviour is RIGHT. It says which drafts are the same answer, and what the difference between the
// others is. A draft that does not run at all is no answer.
// Only JavaScript is run. Anything else, a machine that cannot run it safely (Node older than 20), or calls that could not be
// read, and the drafts are compared as text, as before.
import { callsOf, sandboxReady, printedBy } from './sandbox.mjs';

// A QUESTION THAT ASKS WHAT A PROGRAM PRINTS: its first line asks what it prints, outputs or logs, and the program calls
// console.log. The program is the last fenced block of the question where it has one, else everything after its first blank line.
// -> the program, or '' (SwOA specification R.4.1)
export function programOf(question) {
  const q = String(question || '');
  const first = q.split(/\r?\n/)[0] || '';
  if (!/\b(print|prints|printed|output|outputs|log|logs)\b/i.test(first) || !/\bconsole\.log\s*\(/.test(q)) return '';
  const blocks = [...q.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.trim());
  const code = blocks.length
    ? blocks[blocks.length - 1]
    : q
        .split(/\r?\n\s*\r?\n/)
        .slice(1)
        .join('\n\n');
  return /\bconsole\.log\s*\(/.test(code) && code.length <= 4000 ? code.trim() : '';
}
// what it prints, where the sandbox can run at all (sandbox.mjs printedBy; SwOA specification R.4.2): { text } or null
export const printed = async (code) => ((await sandboxReady()) ? printedBy(code) : null);

export const PROBE_BRIEF =
  'You are given a request for a function. Do not write the function. Write ten calls to it that would show whether a version ' +
  'of it is correct: a few ordinary ones, then awkward ones (an empty input, one item, zero, negative numbers, repeats, the ' +
  'smallest and largest cases the request mentions). One call on each line, as JavaScript, using the name the request gives ' +
  'the function, with literal arguments only. Nothing else: no results, no comments, no explanation.';

export const EXPECT_BRIEF =
  'You are given a request for a function, and some calls to it. Do not write the function. For each call, work out from the ' +
  'request alone what a correct function returns. Write one line for each call: the call exactly as given, then =>, then the ' +
  'result as a JavaScript literal. Nothing else: no working, no comments.';

// what a slot said each call should give: { call: the result, as it wrote it }
export function expectedIn(text, calls) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/`/g, '').trim();
    for (const c of calls) {
      const at = line.indexOf(c);
      if (at < 0 || out[c] !== undefined) continue;
      const rest = line.slice(at + c.length).replace(/^\s*(?:=>|->|→|returns|gives|===?|:)\s*/i, '');
      if (rest === line.slice(at + c.length)) continue; // no sign between the call and a result
      const value = rest.replace(/\s*\/\/.*$/, '').replace(/[;\s]+$/, '');
      if (value) out[c] = value;
    }
  }
  return out;
}
// is what a function returned (as JSON text) the value a slot wrote (as a JavaScript literal)?
const literal = (text) => {
  const t = String(text).trim();
  for (const s of [
    t,
    t.replace(/'/g, '"'),
    t.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"'),
  ]) {
    try {
      return JSON.stringify(JSON.parse(s));
    } catch {
      /* the next way of reading it */
    }
  }
  return t === 'undefined' ? '"__undefined__"' : t;
};
const sameValue = (v, want) => literal(v) === literal(want);

// the function the drafts define: the name most of them give one (a name the question itself uses wins a tie)
export function nameOf(codes, question = '') {
  const count = new Map();
  for (const c of codes) {
    const names = new Set(
      [
        ...String(c).matchAll(
          /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
        ),
      ].map((m) => m[1] || m[2]),
    );
    for (const n of names) count.set(n, (count.get(n) || 0) + 1);
  }
  const inQuestion = (n) => (new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(question) ? 1 : 0);
  return ([...count.entries()].sort((a, b) => b[1] - a[1] || inQuestion(b[0]) - inQuestion(a[0]))[0] || [''])[0];
}

// the calls in what the probing slot wrote: each line's `name( ... )`, whole (its brackets close), a literal call and nothing more
export function callsIn(text, name, { most = 12 } = {}) {
  if (!name) return [];
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/`/g, '');
    const at = line.indexOf(name + '(');
    if (at < 0) continue;
    let depth = 0;
    let end = -1;
    let quote = '';
    for (let i = at + name.length; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const call = line.slice(at, end + 1);
    // literal arguments only: a call that names anything else (another function, a variable) is not one to run
    const args = call
      .slice(name.length)
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/\b(?:true|false|null|undefined|NaN|Infinity)\b/g, '0')
      .replace(/[A-Za-z_$][\w$]*\s*:/g, '0:');
    if (/[A-Za-z_$]/.test(args.replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?n?\b/gi, '0')) || call.length > 240) continue;
    if (!out.includes(call)) out.push(call);
    if (out.length >= most) break;
  }
  return out;
}

// CALLS WHEN THE PROBING SLOT GAVE NONE (measured 2026-11-16: on 7 of 12 questions it wrote the function instead of calls, and the
// drafts were compared as text, so drafts that do the same counted as different answers). Built with no model: the function's
// parameters, read from the drafts; the literal examples the question itself gives ("aaabcc", [1, 2, 3]); and, for each
// parameter, ordinary and awkward values of the kind its name says. A call that fails in every draft is dropped later.
const DEFAULTS = [
  [
    /text|str|string|word|sentence|line|name|^s$|input|message|title|code|path|url|char/i,
    ['""', '"a"', '"aaabcc"', '"Hello, World"', '"  two  words "', '"a(b)[c]{d}"'],
  ],
  [
    /list|arr|array|items|numbers|nums|values|^xs$|data|elements|scores|grid|rows|matrix/i,
    ['[]', '[1]', '[1, 2, 3, 4, 5]', '[3, 1, 2, 2, 3]', '[-2, 0, 7]'],
  ],
  [
    /^n$|num|count|^k$|size|amount|index|limit|times|steps|^x$|^y$|^a$|^b$|year|day|month|width|height|length/i,
    ['0', '1', '2', '-3', '10'],
  ],
];
const ANY = ['""', '[]', '0', '"abc"', '[1, 2, 2]'];
export function paramsOf(codes, name) {
  for (const c of codes) {
    const esc = name.replace(/\$/g, '\\$');
    const m =
      String(c).match(new RegExp('function\\s*\\*?\\s*' + esc + '\\s*\\(([^)]*)\\)')) ||
      String(c).match(new RegExp('\\b' + esc + '\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(([^)]*)\\)')) ||
      String(c).match(new RegExp('\\b' + esc + '\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>'));
    if (m)
      return m[1]
        .split(',')
        .map((p) => p.replace(/=.*$/, '').replace(/[{}[\].\s]/g, ''))
        .filter(Boolean);
  }
  return [];
}
export function callsFrom(question, codes, name, { most = 10 } = {}) {
  if (!name) return [];
  const params = paramsOf(codes, name);
  if (!params.length) return [];
  // the question's own examples: strings in double quotes, and arrays of literals
  const q = String(question || '');
  const strings = [...q.matchAll(/"((?:[^"\\\n]|\\.){0,80})"/g)].map((m) => JSON.stringify(m[1]));
  const arrays = [...q.matchAll(/\[[^[\]\n]{0,120}\]/g)]
    .map((m) => m[0])
    .filter((a) => {
      try {
        return Array.isArray(JSON.parse(a.replace(/'/g, '"')));
      } catch {
        return false;
      }
    });
  const valuesFor = (p) => {
    const kind = DEFAULTS.find(([re]) => re.test(p));
    const own = kind && kind[1][0] === '""' ? strings : kind && kind[1][0] === '[]' ? arrays : [];
    return [...new Set([...own, ...(kind ? kind[1] : ANY)])];
  };
  const vals = params.map(valuesFor);
  const n = Math.min(most, Math.max(...vals.map((v) => v.length)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const call = name + '(' + vals.map((v) => v[i % v.length]).join(', ') + ')';
    if (!out.includes(call)) out.push(call);
  }
  return out;
}

const short = (v) => (v.length > 60 ? v.slice(0, 57) + '...' : v);
const said = (o) => (o.e ? 'it fails' : short(o.v));

// drafts: [{ letter, final }] -> null (they could not be tried: compare them as text), or
//   { name, calls, by: { letter: signature | '' (it does not run) }, groups: [[letters]], summary,
//     differ(sigs, { as }) -> text: the calls on which those behaviours part, and what each gave,
//     sigOf(code) -> the signature of another piece of code on the same calls ('' when it does not run) }
export async function behaviours({
  question = '',
  drafts = [],
  probeText = '',
  run = callsOf,
  ready = sandboxReady,
} = {}) {
  if (drafts.length < 2 || !(await ready())) return null;
  const name = nameOf(
    drafts.map((d) => d.final),
    question,
  );
  let calls = callsIn(probeText, name);
  // the probing slot gave too few: calls from the question and the drafts themselves (callsFrom)
  if (calls.length < 3)
    calls = [
      ...new Set([
        ...calls,
        ...callsFrom(
          question,
          drafts.map((d) => d.final),
          name,
        ),
      ]),
    ].slice(0, 12);
  if (calls.length < 3) return null;
  const outs = {};
  await Promise.all(drafts.map(async (d) => (outs[d.letter] = await run(d.final, name, calls))));
  const ran = drafts.filter((d) => outs[d.letter]);
  if (ran.length < 2) return null;
  // a call that fails in every draft that runs says nothing about any of them (it was most likely not a call to make)
  const keep = calls.map((_, i) => !ran.every((d) => outs[d.letter][i].e));
  if (keep.filter(Boolean).length < 2) return null;
  const sigFor = (o) => (o ? JSON.stringify(o.filter((_, i) => keep[i]).map((x) => (x.e ? 'E' : x.v))) : '');
  const by = {};
  for (const d of drafts) by[d.letter] = sigFor(outs[d.letter]);
  const groups = [];
  for (const d of ran) {
    const g = groups.find((x) => by[x[0]] === by[d.letter]);
    if (g) g.push(d.letter);
    else groups.push([d.letter]);
  }
  // what each behaviour gave, by its signature: answers written later are known by theirs
  const outsBySig = new Map();
  for (const d of ran) outsBySig.set(by[d.letter], outs[d.letter]);
  const dead = drafts.filter((d) => !outs[d.letter]).map((d) => d.letter);
  return {
    name,
    calls: calls.filter((_, i) => keep[i]),
    by,
    groups,
    summary:
      'Ran ' +
      ran.length +
      ' drafts on ' +
      keep.filter(Boolean).length +
      ' calls: ' +
      (groups.length === 1
        ? 'they all do the same'
        : groups.length + ' behaviours (' + groups.map((g) => g.join(', ')).join(' | ') + ')') +
      (dead.length ? '. ' + dead.join(', ') + ' did not run' : '') +
      '.',
    // where answers part: `sigs` are what each did (by[letter], or sigOf(code)); `as` the letters to call them by
    differ(sigs, { most = 5, as = sigs } = {}) {
      const rows = sigs.map((s) => outsBySig.get(s)).filter(Boolean);
      const names = as.filter((_, i) => outsBySig.get(sigs[i]));
      if (rows.length < 2) return '';
      const lines = [];
      calls.forEach((c, i) => {
        if (!keep[i] || lines.length >= most) return;
        const vals = rows.map((o) => said(o[i]));
        if (new Set(vals).size > 1) lines.push(c + '  ->  ' + names.map((l, k) => l + ': ' + vals[k]).join('   '));
      });
      return lines.length
        ? 'Each answer was run on the same calls. They give different results on:\n' + lines.join('\n')
        : '';
    },
    // on how many of the calls does this behaviour give what was expected? want: { call: the result, as text }
    matches(sig, want) {
      const o = outsBySig.get(sig);
      if (!o) return 0;
      let n = 0;
      calls.forEach((c, i) => {
        if (want[c] !== undefined && !o[i].e && sameValue(o[i].v, want[c])) n++;
      });
      return n;
    },
    async sigOf(code) {
      const o = await run(code, name, calls);
      const sig = sigFor(o);
      if (sig) outsBySig.set(sig, o);
      return sig;
    },
  };
}
