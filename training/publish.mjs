// publish.mjs - WHAT WAS MEASURED, WHERE A MODEL CARD CAN SHOW IT. Reads the newest results on the HELD questions (the swarm and each
// small model alone, each by how many of its answers were equivalent to the larger model's: parity is every one) and writes src/trained.json, which ships with the module: a program
// that lists the swarm as a model reads it (readTrained()) and shows "so many right of so many", against what it is measured
// against. Only held results are published: the train questions are what the briefs were chosen on.
//   node training/publish.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, REPO_ROOT, aloneLabel } from './support/bench.mjs';
import { MEMBERS, DECIDER } from '../src/catalog.mjs';
import { readBriefs } from '../src/index.mjs';
import { readState, readTargets } from './state.mjs';

const read = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS, name + '-held.json'), 'utf8'));
  } catch {
    return null;
  }
};
// how many of the larger model's answers this one's were equivalent to; at parity when every one was
const brief = (r) =>
  r && {
    atParity: r.compared > 0 && r.right === r.compared,
    equivalent: r.right,
    different: r.wrong,
    none: r.unsure,
    of: r.compared,
    secondsEach: r.seconds,
    at: r.at,
  };
const swarm = read('swarm');
// the target being chased, the ones the swarm has reached parity with, and how the last pass stood against its target
const state = readState();
const names = Object.fromEntries(readTargets().map((t) => [t.id, t.name]));
const last = state.history[state.history.length - 1] || null;
const out = {
  briefs: readBriefs().version,
  pass: state.pass,
  target: last && {
    id: last.target,
    name: names[last.target] || last.target,
    atParity: last.level,
    equivalent: last.equivalent,
    of: last.compared,
  },
  atParityWith: [...new Set(state.history.filter((h) => h.level).map((h) => names[h.target] || h.target))],
  swarm: brief(swarm),
  paths: swarm && swarm.paths,
  swarmOf: { ...Object.fromEntries(Object.entries(MEMBERS).map(([k, m]) => [k, m.id])), decider: DECIDER.id },
  alone: Object.fromEntries(Object.keys(MEMBERS).map((k) => [k, brief(read(aloneLabel(k)))])),
};
fs.writeFileSync(path.join(REPO_ROOT, 'src', 'trained.json'), JSON.stringify(out, null, 2) + '\n');
const say = (n, r) =>
  console.log(
    n.padEnd(16) +
      (r && r.of
        ? (r.atParity ? 'at parity: ' : 'not at parity: ') + r.equivalent + ' of ' + r.of + ' answers equivalent'
        : 'not measured'),
  );
if (out.target) console.log('Parity with ' + out.target.name + ': every answer fundamentally equivalent to its answer');
say('the swarm', out.swarm);
for (const [k, m] of Object.entries(MEMBERS)) say(m.name + ' alone', out.alone[k]);
