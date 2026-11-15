// catalog.mjs - WHAT THE SWARM IS MADE OF NOW, AND THE ONE ENTRY IT IS TO A PROGRAM THAT LISTS MODELS.
// The swarm is two small models (in places `a` and `b`), a model that decides, and a larger model it is being brought to parity
// with. Which models those are is CHOSEN (config.json), from the ones listed in models.json: every file there is pinned the way a
// careful program pins any download (a repository, a revision, a size and a SHA-256).
//   MEMBERS    { a, b }: the two small models, each served by llama.cpp with several slots
//   DECIDER    the decision model (Kev) for the decide step
//   TARGET     the larger model
//   ENGINE     the llama.cpp build that runs the small models (and a target that is a GGUF file)
// The places are named for where they sit in the arrangement, not for the model in them: a slot is `a-critic`, whichever model
// is in place a.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SERVED_NAME = 'the-swarm';
const here = (name) => fileURLToPath(new URL('./' + name, import.meta.url));
export const MODELS_FILE = here('models.json');
export const CONFIG_FILE = process.env.SWARM_CONFIG || here('config.json');
export const REGISTRY = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
export const ENGINE = REGISTRY.engine;

export function readConfig() {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* the first of each */
  }
  const pick = (list, id) => list.find((m) => m.id === id) || list[0];
  return {
    a: pick(REGISTRY.small, c.a).id,
    b: pick(REGISTRY.small, c.b || (REGISTRY.small[1] || {}).id).id,
    decider: pick(REGISTRY.deciders, c.decider).id,
    target: pick(REGISTRY.targets, c.target).id,
  };
}
// set one or more of a, b, decider, target; an id that is not in models.json is refused
export function writeConfig(patch) {
  const next = { ...readConfig() };
  for (const [k, list] of [
    ['a', REGISTRY.small],
    ['b', REGISTRY.small],
    ['decider', REGISTRY.deciders],
    ['target', REGISTRY.targets],
  ]) {
    if (patch[k] === undefined) continue;
    if (!list.find((m) => m.id === patch[k])) throw new Error('no ' + k + ' called ' + patch[k]);
    next[k] = patch[k];
  }
  let about = '';
  try {
    about = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).about || '';
  } catch {
    /* none */
  }
  // written whole or not at all
  fs.writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify({ ...(about ? { about } : {}), ...next }, null, 2) + '\n');
  fs.renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE);
  return next;
}

const CONFIG = readConfig();
const small = (id) => REGISTRY.small.find((m) => m.id === id);
export const MEMBERS = { a: { ...small(CONFIG.a), key: 'a' }, b: { ...small(CONFIG.b), key: 'b' } };
export const DECIDER = REGISTRY.deciders.find((m) => m.id === CONFIG.decider);
export const TARGET = REGISTRY.targets.find((m) => m.id === CONFIG.target);
// the swarm as it is configured, in a word: results are kept apart by this, so that one arrangement's are never read as another's
export const CONFIG_ID = [CONFIG.a, CONFIG.b, CONFIG.decider].join('+');

export const fileUrl = (m, base = 'https://huggingface.co') => base + '/' + m.repo + '/resolve/' + m.rev + '/' + m.file;
export const engineBuild = (platform = process.platform, arch = process.arch) =>
  ENGINE.builds[platform + '-' + arch] || null;
export const engineUrl = (b) => ENGINE.site + '/releases/download/' + ENGINE.tag + '/' + b.asset;

// HOW EACH MEMBER IS SERVED: so many slots, each with so much context. llama.cpp shares one context between its slots, so the
// server is started with slots x contextPerSlot.
// A SLOT ANSWERS; IT DOES NOT THINK AT LENGTH FIRST. Many small models now reason before they reply, and at length: LFM2.5 2.6B
// took 3,700 tokens and 22 seconds of thought over a small function, and with an ordinary allowance ran out before saying
// anything at all; served with no thinking it answered the same question in a quarter of a second (measured 2026-11-15,
// llama.cpp b12110). A slot has a narrow job and others to check it, so every small model is served with its thinking off
// (`--reasoning-budget 0`, in models.json) unless its entry says otherwise.
export const SERVING = { slots: 4, contextPerSlot: 4096 };

// THE ENTRY: one item in a list of models, in the shape The Crew's llama.cpp models have (an id, a name, what it takes, what
// to say about it), with engine 'swarm' and its members in place of one file. Its memory is a first estimate (the two files
// read into memory, and the contexts), to be replaced by a measurement.
const gb = (n) => Math.round((n / 2 ** 30) * 10) / 10;
export const ENTRY = {
  id: 'swarm-' + CONFIG.a + '+' + CONFIG.b,
  engine: 'swarm',
  family: 'Swarm',
  name: 'The Swarm',
  size: 'Two small models',
  params: Math.round((MEMBERS.a.params + MEMBERS.b.params) * 10) / 10,
  memGb: Math.round(((gb(MEMBERS.a.bytes) + gb(MEMBERS.b.bytes)) * 1.25 + 1) * 10) / 10,
  pace: 'steady',
  badge: 'Swarm',
  members: [MEMBERS.a, MEMBERS.b],
  decider: DECIDER,
  bytes: MEMBERS.a.bytes + MEMBERS.b.bytes,
  plain:
    'Two small models (' +
    MEMBERS.a.name +
    ' and ' +
    MEMBERS.b.name +
    ') that draft, check each other and settle on one answer. Trained toward parity with a much larger model: to answer as it answers, in a fraction of its memory.',
};
