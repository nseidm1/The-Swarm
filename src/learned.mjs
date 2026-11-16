// learned.mjs - WHAT ONE SWARM HAS LEARNED, AND THE PROOF OF EACH THING. briefs.json is where every swarm starts: what each slot is
// told, the plan, the flow. What training then finds is true of ONE configuration (these two small models, this decider) against
// ONE larger model: a brief that helps LFM2.5 beside Bonsai toward Nemotron is not thereby right for another pair. So what is
// learned is kept apart, one file for each configuration and target (src/learned/<a>+<b>+<decider>--<target>.json):
//   briefs    the arrangement as it now stands: every slot, the plan, the flow. This is what the swarm runs
//   ledger    every change that was KEPT, in order, with the evidence it was kept on: what changed, where it came from, and the
//             answers equivalent to the larger model's before and after, on the questions it was chosen on and on the held ones
//   passes    where it stood against the larger model at the end of each pass
// Nothing is in the ledger that was not measured, and nothing is kept that did not do better on train and no worse on held. The
// output spec of a swarm is this file read out.
//   readBriefs()   (index.mjs) reads the learned arrangement of the configured swarm, or briefs.json where it has learned nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_ID, TARGET } from './catalog.mjs';

// (the checks point this at a folder of their own, so that what a real swarm has learned is never read or written by a check)
export const LEARNED_DIR = process.env.SWARM_LEARNED_DIR || fileURLToPath(new URL('./learned/', import.meta.url));
const safe = (s) => String(s).replace(/[^\w.+-]+/g, '_');
export const learnedFile = (config = CONFIG_ID, target = TARGET.id) =>
  path.join(LEARNED_DIR, safe(config) + '--' + safe(target) + '.json');

export function readLearned(config = CONFIG_ID, target = TARGET.id) {
  for (const f of [learnedFile(config, target), learnedFile(config, target) + '.bak']) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && j.briefs && Array.isArray(j.briefs.slots)) return j;
    } catch {
      /* the next */
    }
  }
  return null;
}
// written whole or not at all, with the last good copy kept
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(body, null, 2) + '\n');
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  } catch {
    /* no last good copy this time */
  }
  fs.renameSync(file + '.tmp', file);
}
const blank = (briefs, config, target) => ({ config, target, briefs, ledger: [], passes: [] });

// A CHANGE THAT WAS KEPT: the arrangement as it now is, and the entry that says what changed and on what evidence
//   entry: { pass, kind ('brief' | 'plan' | 'arrangement' | 'flow'), slot?, what, from? (a paper), why,
//            train: { before: { right, wrong }, after }, held: { before, after } }
export function saveLearned(briefs, entry, { config = CONFIG_ID, target = TARGET.id, now = new Date() } = {}) {
  const cur = readLearned(config, target) || blank(briefs, config, target);
  const next = {
    ...cur,
    briefs,
    ledger: [...cur.ledger, { n: cur.ledger.length + 1, at: now.toISOString(), ...entry }],
  };
  write(learnedFile(config, target), next);
  return next;
}
// where it stood at the end of a pass: { pass, at, equivalent, compared, differ, none, level }
export function notePass(done, briefs, { config = CONFIG_ID, target = TARGET.id } = {}) {
  const cur = readLearned(config, target) || blank(briefs, config, target);
  const next = { ...cur, passes: [...cur.passes.filter((p) => p.pass !== done.pass), done] };
  write(learnedFile(config, target), next);
  return next;
}
