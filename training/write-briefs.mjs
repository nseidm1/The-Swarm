// write-briefs.mjs - NEW BRIEFS FOR THE SLOTS THAT ARE FAILING, WRITTEN BY THE LARGER MODEL ITSELF. Without this a pass could only
// try the briefs a person had written down (training/candidates), and once those were tried the slots the plan found failing (a
// drafter that gives no answer, a checker that turns good answers away) had nothing left to try: measured on the first long
// session, every candidate was tried by its fifth pass and the brief steps had nothing to do after.
// So each pass: for the slots the plan names (its findings: weak drafters, silent ones, checkers worse than the drafts), the larger
// model this swarm is being brought to parity with is shown the slot's brief, what it wrote on train questions the swarm got wrong
// and the answer wanted, and writes three new briefs. They go to this configuration's own candidates
// (.work/train/<configuration>/candidates/<slot>.json), and the brief steps try them by the same rule as any other: kept only on
// evidence. It runs on this machine (no spend); the target is started for it and stopped after.
//   node training/write-briefs.mjs [--slots a-steps,a-critic] [--most 3]
// SWARM_LOCAL_TEACHER=0 turns it off. Where the larger model cannot be served, nothing is written and the pass goes on.
import fs from 'node:fs';
import path from 'node:path';
import { arg, openAlone, WORK, WORKC } from './support/bench.mjs';
import { missesOf, briefAsk, candidatesIn } from './support/teach.mjs';
import { readBriefs } from '../src/index.mjs';
import { readState, candHash } from './state.mjs';
import { readPlan } from './support/plan-file.mjs';

export const CANDIDATES = path.join(WORKC, 'candidates');
// the slots worth new briefs: those the plan's findings name, worst first, at most `most`
export function slotsToTeach(plan, briefs, most = 3) {
  const ids = new Set(briefs.slots.map((s) => s.id));
  const out = [];
  for (const f of (plan && plan.findings) || [])
    if (
      f.slot &&
      ids.has(f.slot) &&
      /^(weak-draft|silent|check-worse|writer-changed)/.test(f.id) &&
      !out.includes(f.slot)
    )
      out.push(f.slot);
  return out.slice(0, most);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  if (process.env.SWARM_LOCAL_TEACHER === '0') {
    console.log('The larger model writes no briefs (SWARM_LOCAL_TEACHER=0).');
    process.exit(0);
  }
  const briefs = readBriefs();
  const state = readState();
  const named = String(arg('slots', '')).split(',').filter(Boolean);
  const slots = named.length ? named : slotsToTeach(readPlan(), briefs, Number(arg('most', 3)));
  if (!slots.length) {
    console.log('The plan names no slot that is failing: no briefs to write.');
    process.exit(0);
  }
  let teacher;
  try {
    teacher = await openAlone('target');
  } catch (e) {
    console.log(
      'The larger model could not be served to write briefs: ' +
        String(e.message || e).slice(0, 160) +
        '. Nothing written.',
    );
    process.exit(0);
  }
  fs.mkdirSync(CANDIDATES, { recursive: true });
  try {
    for (const id of slots) {
      const slot = briefs.slots.find((s) => s.id === id);
      const missed = missesOf(WORK, id, { seed: state.seeds.train });
      if (!slot || !missed.length) {
        console.log(id + ": no misses of its on this pass's train questions to show.");
        continue;
      }
      let text = '';
      try {
        text = String(
          (await teacher.ask([{ role: 'user', content: briefAsk(slot, missed) }], { maxTokens: 1600 })).text || '',
        );
      } catch (e) {
        console.log(id + ': the larger model did not answer (' + String(e.message || e).slice(0, 100) + ')');
        continue;
      }
      const file = path.join(CANDIDATES, id + '.json');
      let have = [];
      try {
        have = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        have = [];
      }
      const tried = state.tried[id] || [];
      const fresh = candidatesIn(text, 'the larger model').filter(
        (c) => c.brief !== slot.brief && !tried.includes(candHash(c)) && !have.some((x) => x.brief === c.brief),
      );
      fs.writeFileSync(file, JSON.stringify([...have, ...fresh], null, 2) + '\n');
      console.log(
        id +
          ': ' +
          fresh.length +
          ' new brief(s) from ' +
          missed.length +
          ' misses' +
          (fresh.length ? ': ' + fresh.map((c) => c.name).join('; ') : ''),
      );
    }
  } finally {
    await teacher.stop();
  }
}
