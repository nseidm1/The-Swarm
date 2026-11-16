// review.mjs - THE PASS LOOKS AT ITSELF, AND CHANGES HOW IT TRAINS. At set points in a pass (the policy says which) the trainer asks
// of its own run what a person watching would ask: is the measurement steady enough to judge a change by? Are answers being lost
// in drafting, or in choosing between drafts? Has anything been kept lately? It measures those, and applies the policy's RULES:
// each says, when a number passes a mark, change one setting of the policy, within bounds, and why. The rules are data
// (training/policy.json), the settings they change are data (this configuration's record), and every change is written down with
// its reason. No program is changed, and a person can add a rule, or the next version of this step can, without touching one.
//   node training/review.mjs --at 05-swarm-train [--noise 12]     look, and apply the rules      --dry: say, change nothing
// --noise n: ask the swarm n train questions again with another draw, to see how many answers change by themselves.
import fs from 'node:fs';
import path from 'node:path';
import { arg, has, RESULTS, WORK, WORKC, openSwarm, questions, run, needReference, paired } from './support/bench.mjs';
import { readState } from './state.mjs';
import { readPolicy, setPolicy, at as valueAt } from './policy.mjs';
import { readLearned } from '../src/index.mjs';
import { readSafe } from './support/recover.mjs';

// ---- what is measured (a metric a rule names and this does not know is simply not there, and that rule does nothing)
export function metricsOf({ report, learned, state, noise }) {
  const m = {};
  if (report && report.compared) {
    const differ = (report.wrong || 0) + (report.unsure || 0);
    m['ceiling.noSlotHadItShare'] = Math.max(0, differ - (report.lost || 0)) / report.compared;
    m['ceiling.lostShare'] = (report.lost || 0) / report.compared;
    m['swarm.equivalentShare'] = report.right / report.compared;
  }
  if (noise !== undefined && noise !== null) m['noise.answers'] = noise;
  // how many passes in a row, up to now, kept nothing
  const kept = new Set(((learned && learned.ledger) || []).map((e) => e.pass));
  let dry = 0;
  for (let p = state.pass; p >= 1 && !kept.has(p); p--) dry++;
  m['pass.keptNothingFor'] = dry;
  // PROGRESS: the percentage toward parity at the end of the last pass, and for how many passes it has not risen
  const pcs = ((learned && learned.passes) || []).map((x) => x.percent).filter((x) => typeof x === 'number');
  if (pcs.length) {
    m['progress.percent'] = pcs[pcs.length - 1];
    let flat = 0;
    for (let i = pcs.length - 1; i >= 1 && pcs[i] <= Math.max(...pcs.slice(0, i)); i--) flat++;
    m['progress.passesWithoutGain'] = flat;
  }
  return m;
}
const OPS = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
};
// what a rule would set, from what is there now and what was measured: a number, or "metric+1", "current+0.5", "current*1.4"
export function valueOf(to, current, metric) {
  if (typeof to === 'number') return to;
  const m = /^(metric|current)\s*([+*-])\s*([\d.]+)$/.exec(String(to));
  if (!m) return undefined;
  const base = m[1] === 'metric' ? metric : Number(current) || 0;
  const n = Number(m[3]);
  return m[2] === '+' ? base + n : m[2] === '-' ? base - n : base * n;
}
// the changes the rules call for: [{ rule, set, from, to, why }]
export function changesFor(policy, metrics) {
  const out = [];
  for (const r of (policy.review && policy.review.rules) || []) {
    const w = r.when || {};
    const metric = metrics[w.metric];
    if (metric === undefined || !OPS[w.op] || !OPS[w.op](metric, w.value)) continue;
    const t = r.then || {};
    const current = valueAt(policy, t.set);
    let to = valueOf(t.to, current, metric);
    if (to === undefined || Number.isNaN(to)) continue;
    if (t.min !== undefined) to = Math.max(t.min, to);
    if (t.max !== undefined) to = Math.min(t.max, to);
    to = Math.round(to * 100) / 100;
    if (to === current) continue;
    const shown = Math.round(metric * 100) / 100;
    out.push({
      rule: r.id,
      set: t.set,
      from: current,
      to,
      why: String(r.why || '')
        .replace(/\{metric%\}/g, Math.round(metric * 100) + '%')
        .replace(/\{metric\}/g, String(shown)),
    });
  }
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const state = readState();
  const policy = readPolicy(state);
  const when = arg('at', '');
  if (when && !((policy.review && policy.review.after) || []).includes(when)) {
    console.log('The policy asks for no review after ' + when + '.');
    process.exit(2);
  }
  const report = readSafe(path.join(RESULTS, 'swarm-train.json'), null);
  // HOW MANY ANSWERS CHANGE BY THEMSELVES? A few train questions asked again with another draw, against what was measured
  let noise;
  const n = Number(arg('noise', 0));
  if (n > 0) {
    const list = questions('train', Number(arg('each', 6)));
    const sample = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
    const rowsOf = (file) => {
      try {
        return fs
          .readFileSync(path.join(WORK, file), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    };
    const was = [
      ...new Map(
        rowsOf('swarm-runs.jsonl')
          .filter((r) => r.split === 'train' && r.seed === state.seeds.train)
          .map((r) => [r.id, r]),
      ).values(),
    ];
    if (was.length && sample.length) {
      const ref = needReference(sample, 'train');
      const swarm = await openSwarm(undefined, { seed: 2 });
      try {
        const again = await run(
          sample,
          async (t) => ({ reply: (await swarm.answer([{ role: 'user', content: t.ask }])).reply }),
          { ref },
        );
        const p = paired(was, again);
        noise = Math.round(((p.wins + p.losses) * list.length) / sample.length);
        console.log(
          'Asked ' +
            sample.length +
            ' train questions again with another draw: ' +
            (p.wins + p.losses) +
            ' answers changed (' +
            noise +
            ' in ' +
            list.length +
            ').',
        );
      } finally {
        await swarm.stop();
      }
    }
  }
  const metrics = metricsOf({ report, learned: readLearned(), state, noise });
  for (const [k, v] of Object.entries(metrics)) console.log('measured  ' + k.padEnd(28) + Math.round(v * 100) / 100);
  const changes = changesFor(policy, metrics);
  const done = [];
  for (const c of changes) {
    console.log(
      (has('dry') ? 'would set ' : 'set       ') +
        c.set +
        ': ' +
        JSON.stringify(c.from) +
        ' -> ' +
        JSON.stringify(c.to) +
        '   ' +
        c.why,
    );
    if (!has('dry')) {
      const e = setPolicy(c.set, c.to, { why: c.why, rule: c.rule });
      if (e) done.push(e);
    }
  }
  if (!changes.length) console.log('The rules call for no change to how this swarm is trained.');
  fs.mkdirSync(WORKC, { recursive: true });
  fs.writeFileSync(
    path.join(WORKC, 'review.json'),
    JSON.stringify(
      { at: new Date().toISOString(), pass: state.pass + 1, when, metrics, changes: has('dry') ? changes : done },
      null,
      2,
    ),
  );
}
