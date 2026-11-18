// state.mjs - WHAT ONE TRAINING SESSION LEAVES FOR THE NEXT. A session that starts from nothing learns the same things again; this
// file is how it does not. It stays on this machine (never committed: only finished specs go upstream), and every trainer reads it (what was read, in training/state.json; the rest, for
// each configuration against each larger model, in training/states/):
//   pass        how many sessions have ended
//   target      the larger model the swarm is being brought to parity with (a rung of training/targets.json)
//   seeds       what the questions are made from. The train seed changes every pass (new questions each time, so a brief cannot
//               learn a list); the held seed stays while one target is being chased (so passes can be compared), and changes when
//               the target does
//   focus       kinds of question the swarm answered differently from the target on last pass: more of those are asked on the train split next pass
//   tried       for each slot, the briefs that were measured and not kept: never measured again
//   order       the slots, worst first, as the last pass found them: the next pass works on them in that order
//   questions   what arXiv is asked: the standing questions, and those the last pass's weak kinds added
//   seen        arXiv ids already read
//   ideas       what the reading turned into, each with what became of it (open, tried, kept, dropped)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REGISTRY, readConfig, CONFIG_ID } from '../src/catalog.mjs';
import { writeSafe, readSafe } from './support/recover.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_FILE = process.env.SWARM_STATE || path.join(HERE, 'state.json');

export const STANDING = [
  'all:"multi-agent debate" AND all:"language models" AND all:reasoning',
  'all:"self-consistency" AND all:"chain of thought" AND all:"small language models"',
  'all:"mixture of agents" AND all:LLM',
  'all:"LLM ensemble" AND all:"small models" AND all:"large model"',
  'all:"self-verification" AND all:"language models" AND all:reasoning AND all:errors',
  'all:"prompt optimization" AND all:"automatic" AND all:"small language models"',
  'all:"LLM-as-a-judge" AND all:"answer selection" AND all:reliability',
  'all:"model cascade" AND all:"language models" AND all:routing AND all:cost',
];
const fresh = () => ({
  pass: 0,
  target: '',
  seeds: { train: 1009, held: 7919 },
  focus: {},
  tried: {},
  order: [],
  questions: [...STANDING],
  seen: [],
  ideas: [],
  history: [],
});
// WHAT IS REMEMBERED IS REMEMBERED FOR ONE CONFIGURATION. What was READ belongs to everyone (the questions put to arXiv, the
// papers seen, the ideas they turned into): that stays in training/state.json. Everything else is true of these two small models
// and this decider against this larger model, and of no other: which pass it is, the questions' seeds, the kinds to ask more of,
// what was measured and not kept, the order of slots, how each pass ended, and what became of each idea HERE. That is kept in a
// file of that configuration's own (training/states/<a>+<b>+<decider>--<target>.json), so a swarm of other models starts with
// nothing tried, and coming back to this one finds it as it was left.
const SHARED = ['questions', 'seen', 'ideas'];
export const STATES_DIR = process.env.SWARM_STATES_DIR || path.join(HERE, 'states');
const safe = (s) => String(s).replace(/[^\w.+-]+/g, '_');
export const stateFileOf = (target = readConfig().target, config = CONFIG_ID) =>
  path.join(STATES_DIR, safe(config) + '--' + safe(target) + '.json');
// read whole, or from the last good copy: a session stopped in the middle of writing it does not cost the next one its memory
export function readState() {
  const shared = readSafe(STATE_FILE, {}) || {};
  const mine = readSafe(stateFileOf(), null);
  // (a folder from before this was kept apart has it all in the one file: that is where a configuration with no file starts)
  const s = { ...fresh(), ...shared, ...(mine || {}) };
  const became = (mine && mine.ideaStatus) || null;
  s.ideas = (shared.ideas || []).map((i) => ({ ...i, status: became ? became[i.hash] || 'open' : i.status || 'open' }));
  delete s.ideaStatus;
  return s;
}
export function writeState(s) {
  const mine = Object.fromEntries(Object.entries(s).filter(([k]) => !SHARED.includes(k)));
  mine.config = CONFIG_ID;
  mine.target = readConfig().target;
  mine.ideaStatus = Object.fromEntries(
    (s.ideas || []).filter((i) => i.status && i.status !== 'open').map((i) => [i.hash, i.status]),
  );
  fs.mkdirSync(STATES_DIR, { recursive: true });
  writeSafe(stateFileOf(), JSON.stringify(mine, null, 2) + '\n');
  // what was read, for everyone: an idea's fate is not part of it
  const shared = {
    questions: s.questions || [],
    seen: s.seen || [],
    ideas: (s.ideas || []).map(({ status, ...i }) => i),
  };
  writeSafe(STATE_FILE, JSON.stringify(shared, null, 2) + '\n');
}
// where a configuration that has reached parity begins against the next, larger model: a new record, with held questions nothing
// has been chosen on. Not written over one that is already there.
export function seedState(target, init) {
  const f = stateFileOf(target);
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(STATES_DIR, { recursive: true });
  writeSafe(f, JSON.stringify({ ...init, config: CONFIG_ID, target, pass: 0 }, null, 2) + '\n');
  return true;
}
// the larger models, smallest first: the ladder the swarm climbs (src/models.json)
export const readTargets = () => [...REGISTRY.targets].sort((x, y) => x.params - y.params);
// the one being chased: the one configured (src/config.json)
export function targetOf() {
  const id = readConfig().target;
  return REGISTRY.targets.find((t) => t.id === id) || REGISTRY.targets[0];
}
export const briefHash = (text) =>
  createHash('sha256').update(String(text).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
// a candidate is known by what it would change: the words of a brief, a change to the plan, or both
// (an addition to a brief is told apart by its own words: support/teach.mjs withAddition)
export const candHash = (c) =>
  briefHash(String(c.brief || '') + (c.add ? ' +' + c.add : '') + (c.plan ? ' ' + JSON.stringify(c.plan) : ''));

// PARITY IS EQUIVALENCE, NOT A SCORE. The swarm is at parity with the larger model when, for the same question, its answer is
// FUNDAMENTALLY EQUIVALENT to the larger model's: the same thing said, whatever the wording, the layout or the working. It is not
// a share to be raised past a bar: one answer that is not equivalent is a place where the swarm and the larger model are not the
// same, and the swarm is not at parity while there is one. Nor is it correctness: the larger model's answer is the mark,
// whatever it is.
// Rows are marked against the larger model already (bench.mjs run): right = equivalent, wrong = a different answer, unsure = the
// swarm settled on nothing, noref = the larger model settled on nothing (not counted). How equivalence is decided for the kinds
// of question asked here is in tasks.mjs (a number is the same number, however written; a day is the same day; a word the same
// word).
//   parity(rows) -> { compared, equivalent, differ, none, level (every one equivalent), trailing: kinds with any that are not }
export const percentOf = (equivalent, compared) => (compared ? Math.floor((1000 * equivalent) / compared) / 10 : 0);
export function parity(rows) {
  const kinds = {};
  let equivalent = 0;
  let differ = 0;
  let none = 0;
  for (const r of rows) {
    if (r.grade === 'noref') continue;
    const k = (kinds[r.kind] = kinds[r.kind] || { equivalent: 0, asked: 0 });
    k.asked++;
    if (r.grade === 'right') (equivalent++, k.equivalent++);
    else if (r.grade === 'wrong') differ++;
    else none++;
  }
  const compared = equivalent + differ + none;
  if (!compared) return null;
  const spec = rows.filter((r) => r.refToSpec === true && r.grade !== 'noref');
  return {
    // the same count on the questions where the larger model's own answer does what the question says
    onSpec: { compared: spec.length, equivalent: spec.filter((r) => r.grade === 'right').length },
    // PROGRESS TOWARD PARITY: the share of the answers that are equivalent, as a percentage. Parity is 100 and nothing less: it is
    // rounded DOWN, so that 100 is said only when every answer is equivalent
    percent: percentOf(equivalent, compared),
    compared,
    equivalent,
    differ,
    none,
    level: equivalent === compared,
    // the kinds of question on which some answer is not equivalent, the furthest first
    trailing: Object.entries(kinds)
      .filter(([, k]) => k.equivalent < k.asked)
      .sort((a, b) => b[1].asked - b[1].equivalent - (a[1].asked - a[1].equivalent))
      .map(([kind, k]) => ({ kind, differ: k.asked - k.equivalent, of: k.asked })),
  };
}
