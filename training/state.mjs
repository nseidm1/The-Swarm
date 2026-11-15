// state.mjs - WHAT ONE TRAINING SESSION LEAVES FOR THE NEXT. A session that starts from nothing learns the same things again; this
// file is how it does not. training/state.json is committed, and every trainer reads it:
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
import { REGISTRY, readConfig } from '../src/catalog.mjs';
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
// read whole, or from the last good copy: a session stopped in the middle of writing it does not cost the next one its memory
export function readState() {
  return { ...fresh(), ...(readSafe(STATE_FILE, {}) || {}) };
}
export const writeState = (s) => writeSafe(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
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
export const candHash = (c) => briefHash(String(c.brief || '') + (c.plan ? ' ' + JSON.stringify(c.plan) : ''));

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
  return {
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
