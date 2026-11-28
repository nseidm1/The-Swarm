#!/usr/bin/env node
// made-by.mjs - WHAT MADE A STEP OF THE WHOLE RUN, so that Carry on does again what was touched (training/run.sh).
// A step used to be passed over because the run's status said it had ended well. That is true of the step and says
// nothing of the programs: a trainer changed since then was not run again, and the old arrangement was measured as if
// it were the new trainer's. So each step that ends well is written down WITH WHAT MADE IT: every program it runs and
// every program those bring in (read from their import lines, so the list keeps itself), the module's own files, and
// what else it reads (the policy, the questions, the leads a probe left, the arrangement an evaluation measures).
// Carried on, a step is passed over only where all of that is as it was; otherwise it is done again, and the status says
// which files changed. A step downstream needs no rule of its own: an evaluation is made by the arrangement it measures,
// so where training kept something new the trained module is measured again, and where it kept nothing it is not.
//   node training/support/made-by.mjs print <step>            its fingerprint
//   node training/support/made-by.mjs changed <step> <dir>    nothing where it is as recorded in <dir>/made; else one line: what changed
//   node training/support/made-by.mjs record <step> <dir>     write it down (run.sh, when the step ends well)
//   node training/support/made-by.mjs adopt <step> <dir>      write it down only where nothing is recorded (a run begun before this was)
//   node training/support/made-by.mjs list <step>             the files, one a line
//   node training/support/made-by.mjs status <dir>            for the page: {step: what changed}, for each step it would do again
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// every program a program brings in, and theirs: `import ... from './x.mjs'`, `export ... from`, `import('./x.mjs')`
export function closureOf(entries, root = ROOT) {
  const seen = new Set();
  const todo = entries.map((e) => path.resolve(root, e));
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    if (!/\.m?js$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const to = path.resolve(path.dirname(f), m[2]);
      if (to.startsWith(root + path.sep)) todo.push(to);
    }
  }
  return [...seen];
}
const inDir = (dir, test) => {
  const d = path.join(ROOT, dir);
  return fs.existsSync(d)
    ? fs
        .readdirSync(d)
        .filter((f) => test.test(f))
        .map((f) => path.join(d, f))
    : [];
};
// the module's own files: how it answers (the same set an evaluation names its kept answers by)
const MODULE = () => inDir('src', /\.mjs$/);
const configKey = async () => (await import('../../src/catalog.mjs')).CONFIG_KEY;

// WHAT EACH STEP IS MADE BY: -> { files: [absolute paths], also: { name: text } (things that are not whole files) }
export async function madeBy(step) {
  const also = {};
  let files = [];
  if (/evaluate/.test(step)) {
    // (an evaluation: its program and what that brings in, the scripts that ask the tools tests, the search it pins, the module)
    files = [
      ...closureOf(['training/evaluate.mjs']),
      path.join(ROOT, 'training/evaluate.sh'),
      ...inDir('training/support', /\.(py|sh)$/),
      ...inDir('training', /^search\.json$/),
      ...MODULE(),
    ];
    // (the trained module is made by the arrangement it measures: the briefs training left, not the ledger beside them)
    if (/trained/.test(step)) {
      const f = path.join(ROOT, 'src', 'learned', (await configKey()) + '.json');
      try {
        also['the arrangement training left'] = sha(
          JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8')).briefs || null),
        );
      } catch {
        also['the arrangement training left'] = 'none';
      }
    }
  } else if (/adapters/.test(step)) files = [...closureOf(['training/mixture.mjs']), ...MODULE()];
  else if (/train/.test(step)) {
    // (training: the session and every trainer it starts, what they bring in, the policy and questions they read, the module,
    // and the leads a probe left for this configuration, which the class stage tries first)
    const started = [
      ...fs.readFileSync(path.join(ROOT, 'training/session.sh'), 'utf8').matchAll(/\b(training\/[\w/.-]+\.mjs)\b/g),
    ].map((m) => m[1]);
    files = [
      ...closureOf([...new Set(started)]),
      path.join(ROOT, 'training/session.sh'),
      path.join(ROOT, 'training/support/steps.sh'),
      ...inDir('training', /\.json$/),
      ...MODULE(),
    ];
    const leads = path.join(ROOT, 'training', 'results', await configKey(), 'leads.json');
    also['the leads a probe left'] = fs.existsSync(leads) ? sha(fs.readFileSync(leads)) : 'none';
  } else files = MODULE();
  // (a test's own input, where it names one for this step: MADE_BY_ALSO="<step>=<file>")
  const extra = String(process.env.MADE_BY_ALSO || '')
    .split(',')
    .map((x) => x.split('='))
    .find((x) => x[0] === step);
  if (extra && extra[1]) also['MADE_BY_ALSO'] = fs.existsSync(extra[1]) ? sha(fs.readFileSync(extra[1])) : 'none';
  const parts = {};
  for (const f of [...new Set(files)].filter((f) => fs.existsSync(f)).sort()) parts[rel(f)] = sha(fs.readFileSync(f));
  for (const [k, v] of Object.entries(also)) parts['(' + k + ')'] = v;
  return { step, fingerprint: sha(JSON.stringify(parts)).slice(0, 16), parts };
}
const fileOf = (dir, step) => path.join(dir, 'made', step + '.json');
export function recorded(dir, step) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(dir, step), 'utf8'));
  } catch {
    return null;
  }
}
// what changed since it was written down: '' where nothing did (or nothing is written down: there is nothing to differ from)
export function changedOf(was, now) {
  if (!was || was.fingerprint === now.fingerprint) return '';
  const names = new Set([...Object.keys(was.parts || {}), ...Object.keys(now.parts)]);
  const diff = [...names].filter((n) => (was.parts || {})[n] !== now.parts[n]).sort();
  const show = diff.slice(0, 4).map((n) => (n.startsWith('(') ? n.slice(1, -1) : n));
  return (
    show.join(', ') +
    (diff.length > 4 ? ' and ' + (diff.length - 4) + ' more' : '') +
    (diff.length === 1 ? ' has' : ' have') +
    ' changed since it was done'
  );
}
export function record(dir, now) {
  fs.mkdirSync(path.join(dir, 'made'), { recursive: true });
  fs.writeFileSync(fileOf(dir, now.step), JSON.stringify({ ...now, at: new Date().toISOString() }, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, step, dir] = process.argv.slice(2);
  // status <dir>: for the page, in one start: each step written down there that Carry on would do again, and why (JSON)
  if (cmd === 'status' && step) {
    const out = {};
    for (const name of ['1-evaluate-as-configured', '2-make-adapters', '3-train-classes', '4-evaluate-trained']) {
      const was = recorded(step, name);
      const why = was ? changedOf(was, await madeBy(name)) : '';
      if (why) out[name] = why;
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  if (!cmd || !step) {
    console.log(
      "usage: node training/support/made-by.mjs print|list <step> | changed|record|adopt <step> <the run's folder>",
    );
    process.exit(cmd ? 2 : 0);
  }
  const now = await madeBy(step);
  if (cmd === 'print') console.log(now.fingerprint);
  else if (cmd === 'list') console.log(Object.keys(now.parts).join('\n'));
  else if (cmd === 'changed') {
    const why = changedOf(recorded(dir, step), now);
    if (why) console.log(why);
  } else if (cmd === 'record') record(dir, now);
  else if (cmd === 'adopt') {
    if (!recorded(dir, step)) record(dir, now);
  } else process.exit(2);
}
