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
import { callsOf, sandboxReady } from './sandbox.mjs';

export const PROBE_BRIEF =
  'You are given a request for a function. Do not write the function. Write ten calls to it that would show whether a version ' +
  'of it is correct: a few ordinary ones, then awkward ones (an empty input, one item, zero, negative numbers, repeats, the ' +
  'smallest and largest cases the request mentions). One call on each line, as JavaScript, using the name the request gives ' +
  'the function, with literal arguments only. Nothing else: no results, no comments, no explanation.';

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

const short = (v) => (v.length > 60 ? v.slice(0, 57) + '...' : v);
const said = (o) => (o.e ? 'it fails' : short(o.v));

// drafts: [{ letter, final }] -> null (they could not be tried: compare them as text), or
//   { name, calls, by: { letter: signature | '' (it does not run) }, groups: [[letters]], summary,
//     differ(letters) -> text: the calls on which those drafts part, and what each gave,
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
  const calls = callsIn(probeText, name);
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
    differ(letters, { most = 5 } = {}) {
      const mine = letters.filter((l) => outs[l]);
      const lines = [];
      calls.forEach((c, i) => {
        if (!keep[i] || lines.length >= most) return;
        const vals = mine.map((l) => said(outs[l][i]));
        if (new Set(vals).size > 1) lines.push(c + '  ->  ' + mine.map((l, k) => l + ': ' + vals[k]).join('   '));
      });
      return lines.length
        ? 'Each answer was run on the same calls. They give different results on:\n' + lines.join('\n')
        : '';
    },
    async sigOf(code) {
      return sigFor(await run(code, name, calls));
    },
  };
}
