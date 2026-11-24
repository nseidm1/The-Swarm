// wide.mjs - THE LARGER MODEL WRITES THE PYTHON TASKS. Training's Python questions were eleven families written here, and an
// adapter taught them learned eleven kinds of function: 25 points better on held questions of those families, and no better
// that forty questions of two Python benchmarks could show (2026-11-24). The module is trained toward the larger model, and
// the larger model can say what it can do: it is asked for many small tasks of many sorts, and each is checked before it is
// believed, as its wordings are (wordings.mjs):
//   1  it is asked for tasks of one sort at a time: a name, the arguments, what the function returns, and calls to try it by;
//   2  it SOLVES each twice, asked two of the ways the question will be asked (plainly, and as a docstring to complete);
//   3  both solutions are run on the calls, boxed (src/langs.mjs). A task is kept where both ran, most calls returned, and the
//      two gave the same on every call. What they gave is the task's standard: a function is right where it gives the same.
// A task whose two solutions differ is one the larger model itself is not sure of, and it teaches nothing.
// Nothing of a benchmark is read or written here: the tasks are the larger model's own.
//   node training/wide.mjs make [--n 120] [--per 6] [--sorts a,b]      -> .work/library/wide/<larger model>/python.json
//   node training/wide.mjs list
// tasksIn and agreed are the pure parts, tested.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the sorts of task asked for, one at a time: breadth is the point
export const SORTS = [
  'lists of numbers',
  'strings and characters',
  'words in a sentence',
  'dictionaries',
  'sorting and ordering',
  'searching and counting',
  'arithmetic and number theory',
  'dates and times written as text',
  'parsing small formats',
  'sets and duplicates',
  'nested lists and matrices',
  'tuples and pairs',
  'validation and checks that return True or False',
  'converting between units or formats',
  'recursion on simple structures',
  'ranges, sequences and series',
  'text cleaning and formatting',
  'grouping and tallying',
  'bit and base conversions',
  'simple simulations of rules',
];
export const askFor = (sort, n, not = []) =>
  'Write ' +
  n +
  ' small Python programming tasks about ' +
  sort +
  '. Each is one pure function of its arguments: no input, no files, no randomness, no clock, no printing. Make them ' +
  'different from each other, and of mixed difficulty: some a beginner solves in three lines, some that need care with an ' +
  'edge case.' +
  (not.length ? ' Do not use these names, they are taken: ' + not.slice(-60).join(', ') + '.' : '') +
  '\n\nFor each task write ONE line of JSON and nothing else, with exactly these keys:\n' +
  '{"name": "snake_case_name", "args": "a, b", "does": "returns ... (one or two sentences that say exactly what it ' +
  'returns, with its edge cases; it must read on from the words: a function that)", "calls": ["snake_case_name(1, 2)", ' +
  '"..."]}\n\n"calls" holds six calls with literal arguments, ordinary ones and awkward ones (empty, zero, negative, ' +
  'repeated), each a Python expression that calls the function. No other text, no code fences, no numbering.';

// THE TASKS IN WHAT IT WROTE: each line that is such an object, with a name, what it does, and calls that call it; none twice
export function tasksIn(text, taken = []) {
  const out = [];
  const seen = new Set(taken);
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw
      .trim()
      .replace(/^```\w*$/, '')
      .replace(/,$/, '');
    if (!l.startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const name = String((o && o.name) || '');
    if (!/^[a-z_][a-z0-9_]{1,40}$/.test(name) || seen.has(name)) continue;
    const does = String(o.does || '')
      .trim()
      .replace(/^a function that\s+/i, '');
    const calls = (Array.isArray(o.calls) ? o.calls : [])
      .map(String)
      .filter((c) => c.startsWith(name + '(') && c.endsWith(')'));
    if (does.length < 12 || does.length > 400 || calls.length < 4) continue;
    seen.add(name);
    out.push({
      name,
      args: String(o.args || '').trim(),
      does: /[.!?]$/.test(does) ? does : does + '.',
      calls: calls.slice(0, 8),
    });
  }
  return out;
}
// TWO RUNS OF A TASK'S CALLS AGREE: both ran, more than half the calls returned (a function that fails everywhere says
// nothing), and each call gave the same in both, or failed in both. same(a, b): are two values one value
// -> the standard ([{ v } | { e: true }]), or null
export function agreed(one, two, same = (a, b) => a === b) {
  if (!Array.isArray(one) || !Array.isArray(two) || one.length !== two.length || !one.length) return null;
  if (one.filter((r) => !r.e).length * 2 <= one.length) return null;
  for (let i = 0; i < one.length; i++) {
    if (!!one[i].e !== !!two[i].e) return null;
    if (!one[i].e && !same(one[i].v, two[i].v)) return null;
  }
  return one.map((r) => (r.e ? { e: true } : { v: r.v }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const B = await import('./support/bench.mjs');
  const { pyAskOf } = await import('./tasks-code.mjs');
  const { pyCodeOf } = await import('./support/equivalent.mjs');
  const L = await import('../src/langs.mjs');
  const { TARGET } = await import('../src/catalog.mjs');
  const cmd = process.argv[2];
  const file = B.wideFile();
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { tasks: [] };
    }
  };
  const say = (x) => console.log(new Date().toTimeString().slice(0, 8) + ' ' + x);
  if (cmd === 'list') {
    for (const t of read().tasks) console.log(t.sort + '  ' + t.name + '(' + t.args + ')  ' + t.does.slice(0, 80));
    console.log(read().tasks.length + ' tasks in ' + file);
    process.exit(0);
  }
  if (cmd !== 'make') {
    console.log('node training/wide.mjs make [--n 120] [--per 6] [--sorts a,b] | list');
    process.exit(2);
  }
  if (!(await L.langReady('python'))) {
    say('Python cannot be run here, boxed: a task cannot be checked, and none is written.');
    process.exit(3);
  }
  const want = Number(B.arg('n', 120));
  const per = Number(B.arg('per', 6));
  const sorts = String(B.arg('sorts', '')).split(',').filter(Boolean);
  const record = read();
  const canon = (v) => {
    try {
      return JSON.stringify(JSON.parse(v));
    } catch {
      return String(v);
    }
  };
  const big = await B.openAlone('target');
  const u = (content) => [{ role: 'user', content }];
  let asked = 0;
  let refused = 0;
  try {
    for (let round = 0; record.tasks.length < want && round < 6; round++) {
      for (const sort of sorts.length ? sorts : SORTS) {
        if (record.tasks.length >= want) break;
        let text = '';
        try {
          text = String(
            (
              await big.ask(
                u(
                  askFor(
                    sort,
                    per,
                    record.tasks.map((t) => t.name),
                  ),
                ),
                { maxTokens: 1800 },
              )
            ).text || '',
          );
        } catch {
          text = '';
        }
        const found = tasksIn(
          text,
          record.tasks.map((t) => t.name),
        );
        for (const t of found) {
          asked++;
          const solve = async (i) => {
            try {
              const r = await big.ask(u(pyAskOf(i, t.name, t.args, t.does, [])), { maxTokens: 900 });
              const code = pyCodeOf(String(r.text || ''), t.name);
              return code ? await L.callsIn('python', code, t.name, t.calls) : null;
            } catch {
              return null;
            }
          };
          const one = await solve(0);
          const two = one ? await solve(1) : null;
          const expected = agreed(one, two, (a, b) => canon(a) === canon(b));
          if (!expected) {
            refused++;
            continue;
          }
          record.tasks.push({ ...t, sort, expected });
          record.at = new Date().toISOString();
          record.by = TARGET.name;
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify(record, null, 1));
          fs.renameSync(file + '.tmp', file);
        }
        say(
          sort +
            ': it wrote ' +
            found.length +
            '; ' +
            record.tasks.length +
            ' tasks kept so far, ' +
            refused +
            ' refused (its two solutions differed or did not run)',
        );
      }
    }
  } finally {
    await big.stop();
  }
  say(record.tasks.length + ' tasks written by ' + TARGET.name + ', of ' + asked + ' it proposed: ' + file);
  process.exit(record.tasks.length ? 0 : 3);
}
