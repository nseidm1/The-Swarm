// steer.mjs - WHAT A PERSON HAS ASKED THE PLAN TO DO. The plan chooses its moves from what a measurement showed; a person looking
// from outside can see an opportunity it does not. So each configuration has a steering record (.work/train/<configuration>/
// steer.json), written from the dashboard:
//   focus   { <area>: 'more' | 'only' | 'less' }   which areas of the search to lean on: moves in an area marked more count for three
//           times as much when the plan ranks them, less a quarter; with any area marked only, moves of other areas are left out
//   pin     [<move id>]   moves to measure next, in that order, ahead of anything the plan chose (and beyond how many it tries)
//   skip    [<move id>]   moves never to measure
// A move is known by its id in the plan (brief:<slot>:<hash> for a brief, arrange:<hash> for an arrangement). Each is still kept
// only on evidence, by the same rule as any other: steering decides what is tried, never what is kept.
import fs from 'node:fs';
import path from 'node:path';

export const AREAS = [
  { id: 'briefs', name: 'Briefs', about: 'What each slot is told' },
  {
    id: 'slots',
    name: 'Slots',
    about: 'Which model sits where, what a checker sees, how freely a drafter samples, the writer',
  },
  { id: 'flow', name: 'Flow', about: 'The order of steps: checks, answers sent back, loops of checking' },
  {
    id: 'decider',
    name: 'Decider placement',
    about:
      'Where the decision model stands, and how it settles: early if sure, narrowing to two, by vote, with a model beside it',
  },
  {
    id: 'loops',
    name: 'Decider loops',
    about: 'The decision model inside a loop: narrowing and sending back, asking again after a check, a tournament',
  },
  { id: 'several', name: 'Several at once', about: 'Arrangements several changes away at once' },
];
// the area a move belongs to, from its kind and its name
export function areaOf(kind, name = '') {
  if (kind === 'brief' || kind === 'plan-candidate') return 'briefs';
  const n = String(name);
  if (/^several: /.test(n)) return 'several';
  if (/^flow: (a narrowing loop|ask the decider first|a tournament)/.test(n)) return 'loops';
  if (
    /^flow: .*(keep the likeliest|settle it if the decider|decision)/.test(n) ||
    /^plan: (decide by |a model (settles|decides)|the decider decides alone|the model beside the decider)/.test(n)
  )
    return 'decider';
  if (/^flow: /.test(n)) return 'flow';
  return 'slots';
}
export const steerFile = (work) => path.join(work, 'steer.json');
export function readSteer(work) {
  try {
    const j = JSON.parse(fs.readFileSync(steerFile(work), 'utf8'));
    return {
      focus: j.focus && typeof j.focus === 'object' ? j.focus : {},
      pin: Array.isArray(j.pin) ? j.pin.map(String) : [],
      skip: Array.isArray(j.skip) ? j.skip.map(String) : [],
    };
  } catch {
    return { focus: {}, pin: [], skip: [] };
  }
}
// how much a move of this area counts for, under the focus; 0 leaves it out
export function focusWeight(steer, area) {
  const f = (steer && steer.focus) || {};
  const only = Object.keys(f).filter((k) => f[k] === 'only');
  if (only.length && !only.includes(area)) return 0;
  return f[area] === 'more' || f[area] === 'only' ? 3 : f[area] === 'less' ? 0.25 : 1;
}
