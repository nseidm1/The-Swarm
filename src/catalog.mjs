// catalog.mjs - WHAT THE SWARM IS MADE OF NOW, AND THE ONE ENTRY IT IS TO A PROGRAM THAT LISTS MODELS.
// The swarm is two to four small models (in places `a`, `b`, and `c` and `d` where they are filled), a model that decides, and a larger model it is being brought to parity
// with. Which models those are is CHOSEN (config.json), from the ones listed in models.json: every file there is pinned the way a
// careful program pins any download (a repository, a revision, a size and a SHA-256).
//   MEMBERS    { a, b[, c, d] }: the small models, each served by llama.cpp with several slots
//   DECIDER    the decision model for the decide step (the one src/config.json names)
//   TARGET     the larger model
//   ENGINE     the llama.cpp build that runs the small models (and a target that is a GGUF file)
// The places are named for where they sit in the arrangement, not for the model in them: a slot is `a-critic`, whichever model
// is in place a.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SERVED_NAME = 'the-swarm';
// TURNS WITH TOOLS (src/tools.mjs; "tools" in src/config.json, the dashboard's Configuration): "swarm" decides them, every drafter
// proposing the next action and the decider picking where they differ; or one of the small models takes them alone, named by its
// id (so that it is the same model when the places move up). Where nothing is chosen, or the one named is no longer in the swarm,
// it is the model in place a, as before ("lead" says that too). SWARM_TOOLS sets it too.
//   toolsOf(setting, members) -> 'swarm' | the place of the one model that takes them
const here = (name) => fileURLToPath(new URL('./' + name, import.meta.url));
export const MODELS_FILE = here('models.json');
export const CONFIG_FILE = process.env.SWARM_CONFIG || here('config.json');
export const REGISTRY = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
export const ENGINE = REGISTRY.engine;

// THE PLACES A SMALL MODEL CAN SIT IN. Two at least (a swarm is more than one model), and up to four: every small model added
// makes mistakes of its own, which more slots on the same models do not, and all of them together still take a fraction of the
// larger model's memory. What they cost is time: the model servers share one machine.
export const PLACES = ['a', 'b', 'c', 'd'];
export function readConfig() {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* the first of each */
  }
  const pick = (list, id) => list.find((m) => m.id === id) || list[0];
  const out = {
    a: pick(REGISTRY.small, c.a).id,
    b: pick(REGISTRY.small, c.b || (REGISTRY.small[1] || {}).id).id,
  };
  // a third and a fourth small model, where they are named and are models that can be chosen (no place is left empty between)
  for (const k of PLACES.slice(2)) {
    if (!REGISTRY.small.find((m) => m.id === c[k])) break;
    out[k] = c[k];
  }
  out.decider = pick(REGISTRY.deciders, c.decider).id;
  out.target = pick(REGISTRY.targets, c.target).id;
  // who takes turns with tools, and whether each small model is served with its adapter: the page's choices, kept as they are
  // (they were left out here, so the page said "decided by the swarm" while the swarm went on giving them to its lead, and the
  // adapters switch reached nothing)
  if (typeof c.tools === 'string' && c.tools) out.tools = c.tools;
  if (c.adapters === true) out.adapters = true;
  // the judge of equivalence apart from the decider, where one is chosen: kept as it is (it was left out here too, so the page said
  // a judge was chosen while every session went on reading answers in words with the decider: found 2026-11-18, Kev 0.8B reading
  // and failing its check, 42 questions not compared, with Jeffan 4B chosen as the judge)
  if (typeof c.judge === 'string' && REGISTRY.deciders.find((m) => m.id === c.judge)) out.judge = c.judge;
  return out;
}
// the places of a configuration that hold a small model, in order
export const placesOf = (config) => PLACES.filter((k) => config[k]);
// set one or more of a, b, decider, target; an id that is not in models.json is refused
// the configuration as it is written to its file: as the repository's formatter would write it (a short list on one line), so a
// configuration chosen on the page and committed passes the format check
export const configText = (c) =>
  JSON.stringify(c, null, 2).replace(/\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g, (all, inner) => {
    const one = '[' + inner.split(/,\n\s+/).join(', ') + ']';
    return one.length <= 80 ? one : all;
  }) + '\n';
export function writeConfig(patch) {
  const next = { ...readConfig() };
  for (const [k, list] of [
    ...PLACES.map((p) => [p, REGISTRY.small]),
    ['decider', REGISTRY.deciders],
    ['target', REGISTRY.targets],
  ]) {
    if (patch[k] === undefined) continue;
    // a third or fourth place can be emptied (null or ''); the first two cannot
    if ((patch[k] === null || patch[k] === '') && PLACES.indexOf(k) >= 2) {
      delete next[k];
      continue;
    }
    if (!list.find((m) => m.id === patch[k])) throw new Error('no ' + k + ' called ' + patch[k]);
    if (PLACES.indexOf(k) >= 2 && !next[PLACES[PLACES.indexOf(k) - 1]])
      throw new Error('place ' + PLACES[PLACES.indexOf(k) - 1] + ' is empty: fill it first');
    next[k] = patch[k];
  }
  if (patch.judge !== undefined) {
    if (patch.judge === null || patch.judge === '') delete next.judge;
    else if (!REGISTRY.deciders.find((m) => m.id === patch.judge)) throw new Error('no judge called ' + patch.judge);
    else next.judge = patch.judge;
  }
  // no place is left empty between two that are filled: the ones after it move up
  const small = PLACES.map((p) => next[p]).filter(Boolean);
  for (const [i, p] of PLACES.entries()) {
    if (small[i]) next[p] = small[i];
    else delete next[p];
  }
  let about = '';
  try {
    about = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).about || '';
  } catch {
    /* none */
  }
  // written whole or not at all
  fs.writeFileSync(CONFIG_FILE + '.tmp', configText({ ...(about ? { about } : {}), ...next }));
  fs.renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE);
  return next;
}

const CONFIG = readConfig();
const small = (id) => REGISTRY.small.find((m) => m.id === id);
export const MEMBERS = Object.fromEntries(placesOf(CONFIG).map((k) => [k, { ...small(CONFIG[k]), key: k }]));
export function toolsOf(setting, members = MEMBERS) {
  const places = Object.keys(members);
  if (setting === 'swarm') return 'swarm';
  if (places.includes(setting)) return setting;
  const byId = places.find((k) => (members[k] || {}).id === setting);
  return byId || (places.includes('a') ? 'a' : places[0] || 'a');
}
export const TOOLS = process.env.SWARM_TOOLS || CONFIG.tools || 'lead';
export const DECIDER = REGISTRY.deciders.find((m) => m.id === CONFIG.decider);
// THE JUDGE OF EQUIVALENCE ("judge" in src/config.json): a decision model apart from the decider, which reads whether the swarm's
// answers in words say what the larger model's say. Where none is named (or it is the decider), the decider reads them, and the
// swarm's own decider grades the answers it chose. null then.
// A SWARM WITH NO DECISION MODEL (the decider `none`, src/models.json): one of its own small models decides, and nothing is loaded
// to decide. A third of a swarm's memory was its decider (measured 2026-11-19)
export const NO_DECIDER = !!DECIDER && (DECIDER.serve || {}).kind === 'none';
export const JUDGE =
  (CONFIG.judge && CONFIG.judge !== CONFIG.decider && REGISTRY.deciders.find((m) => m.id === CONFIG.judge)) || null;
export const TARGET = REGISTRY.targets.find((m) => m.id === CONFIG.target);
// the swarm as it is configured, in a word: results are kept apart by this, so that one arrangement's are never read as another's
// THE POINT OF THE SWARM, IN ONE NUMBER: the memory it takes against the memory the larger model takes, in GB. An estimate from
// what is on record, the same one the page draws (ui/data.py footprint): the small models' files, a quarter more, and a
// gigabyte of context; the decider's listed size; the larger model's listed size. -> { swarm, target, saved, savedGb }, or null
export function footprintOf(members = MEMBERS, decider = DECIDER, target = TARGET) {
  const r1 = (x) => Math.round(x * 10) / 10;
  // (a model that fills several places is loaded once, src/index.mjs sharedLoads: its file counts once)
  const once = [
    ...new Map(
      Object.values(members || {})
        .filter(Boolean)
        .map((m, i) => [m.id || m.file || i, m]),
    ).values(),
  ];
  const files = once.reduce((n, m) => n + (m.bytes || 0), 0) / 2 ** 30;
  const tbytes =
    ((target && target.bytes) || 0) + ((target && target.parts) || []).reduce((n, p) => n + ((p && p.bytes) || 0), 0);
  const tgt = (target && target.memGb) || (tbytes ? r1((tbytes / 2 ** 30) * 1.1) : 0);
  if (!files || !tgt) return null;
  const swarm = r1(r1(files * 1.25 + 1) + ((decider && decider.memGb) || 0));
  return { swarm, target: tgt, saved: r1(100 - (100 * swarm) / tgt), savedGb: r1(tgt - swarm) };
}
export const configId = (config) => [...placesOf(config).map((k) => config[k]), config.decider].join('+');
export const CONFIG_ID = configId(CONFIG);
// one swarm against one larger model, as the name of a folder or a file: everything that is kept of its training is kept under
// this, apart from every other configuration's, so that stopping, choosing other models and coming back finds it as it was left
const safeName = (s) => String(s).replace(/[^\w.+-]+/g, '_');
export const configKey = (config) => safeName(configId(config)) + '--' + safeName(config.target);
export const CONFIG_KEY = configKey(CONFIG);

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
// SIX SLOTS, NOT FOUR (2026-11-16): with eight slots on two models every one was in use, and the arrangements that move a slot to
// the other model or add a second of a role could no longer be tried. A 2-3B model's context for two more conversations is a
// few hundred megabytes. SWARM_SLOTS sets another number.
export const SERVING = { slots: Math.max(1, Number(process.env.SWARM_SLOTS) || 6), contextPerSlot: 4096 };

// THE ENTRY: one item in a list of models, in the shape The Crew's llama.cpp models have (an id, a name, what it takes, what
// to say about it), with engine 'swarm' and its members in place of one file. Its memory is a first estimate (the two files
// read into memory, and the contexts), to be replaced by a measurement.
const gb = (n) => Math.round((n / 2 ** 30) * 10) / 10;
const all = Object.values(MEMBERS);
const names = all.map((m) => m.name);
export const ENTRY = {
  id: 'swarm-' + all.map((m) => m.id).join('+'),
  engine: 'swarm',
  family: 'Swarm',
  name: 'The Swarm',
  size: ['Two', 'Three', 'Four'][all.length - 2] + ' small models',
  params: Math.round(all.reduce((n, m) => n + m.params, 0) * 10) / 10,
  memGb: Math.round((all.reduce((n, m) => n + gb(m.bytes), 0) * 1.25 + 1) * 10) / 10,
  pace: 'steady',
  badge: 'Swarm',
  members: all,
  decider: DECIDER,
  bytes: all.reduce((n, m) => n + m.bytes, 0),
  plain:
    ['Two', 'Three', 'Four'][all.length - 2] +
    ' small models (' +
    names.slice(0, -1).join(', ') +
    ' and ' +
    names[names.length - 1] +
    ') that draft, check each other and settle on one answer. Trained toward parity with a much larger model: to answer as it answers, in a fraction of its memory.',
};
