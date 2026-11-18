// learned.mjs - WHAT ONE SWARM HAS LEARNED, AND THE PROOF OF EACH THING. briefs.json is where every swarm starts: what each slot is
// told, the plan, the flow. What training then finds is true of ONE configuration (these two small models, this decider) against
// ONE larger model: a brief that helps LFM2.5 beside Bonsai toward Nemotron is not thereby right for another pair. So what is
// learned is kept apart, one file for each configuration and target (src/learned/<a>+<b>+<decider>--<target>.json):
//   briefs    the arrangement as it now stands: every slot, the plan, the flow. This is what the swarm runs
//   ledger    every change that was KEPT, in order, with the evidence it was kept on: what changed, where it came from, and the
//             answers equivalent to the larger model's before and after, on the questions it was chosen on and on the held ones
//   passes    where it stood against the larger model at the end of each pass
// Nothing is in the ledger that was not measured, and nothing is kept that did not do better on train and no worse on held. The
// SoRA spec of a swarm (docs/sora.md) is this file read out.
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

// WHAT WAS LEARNED, MOVED TO THE CLASS IT WAS LEARNED ON (docs/sora-classes.md, migration). Until classes, every kept
// change went into the one shared arrangement, so a brief written for one code question ran on every input. This moves the
// learned slots, plan and flow into briefs.kinds[<class>], for the class most kept changes were found on, and puts the starting
// arrangement back as the shared one: what every class with no arrangement of its own runs. Changes found on another class are
// named, not carried (they are built into the same arrangement and cannot be taken apart without asking again): training finds
// them again for their own class. Pure: given the learned file, the class of each spec kind, and the starting arrangement.
//   learned       a learned file (readLearned)
//   classOfKind   { <spec kind>: <class> } (training/migrate-classes.mjs works it out with src/orchestrate.mjs classOf)
//   start         the starting arrangement for the configured places (index.mjs readBriefs of briefs.json, withPlaces)
//   -> { learned: the file to write, moved: <class> | null, dropped: [ledger n], already: bool }
export function toClasses(learned, { classOfKind = {}, start, now = new Date() } = {}) {
  if (!learned || !learned.briefs) return { learned, moved: null, dropped: [], already: false };
  if (learned.migrated) return { learned, moved: null, dropped: [], already: true };
  const classOf = (e) => classOfKind[(e && e.question && e.question.kind) || ''] || null;
  const ledger = (learned.ledger || []).map((e) => ({ ...e, class: classOf(e) }));
  const count = {};
  for (const e of ledger) if (e.class) count[e.class] = (count[e.class] || 0) + 1;
  const moved = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b))[0] || null;
  if (!moved) return { learned, moved: null, dropped: [], already: false };
  const b = learned.briefs;
  const own = { slots: b.slots, plan: b.plan, ...(b.flow ? { flow: b.flow } : {}), provisional: true };
  const shared = { ...b, slots: start.slots, plan: start.plan, version: (Number(b.version) || 1) + 1 };
  delete shared.flow;
  if (start.flow) shared.flow = start.flow;
  shared.kinds = { ...(b.kinds || {}), [moved]: own };
  const dropped = ledger.filter((e) => e.class && e.class !== moved).map((e) => e.n);
  return {
    learned: {
      ...learned,
      briefs: shared,
      ledger,
      migrated: {
        at: now.toISOString(),
        to: moved,
        dropped,
        why: 'every kept change had gone into the shared arrangement',
      },
    },
    moved,
    dropped,
    already: false,
  };
}
// written as every learned file is: whole, with the last good copy kept
export function writeLearned(body, { config = CONFIG_ID, target = TARGET.id } = {}) {
  write(learnedFile(config, target), body);
  return body;
}
