// members-probe.mjs - WHO COULD DRAFT WHAT NO SLOT DRAFTS? The arrangement search re-wires the slots of the models the swarm is made
// of; it cannot change which models those are (a configuration is the unit everything is kept by). On the first long session no
// slot drafted the larger model's answer on 19 of 70 train questions, and nothing that checks or decides can find an answer no
// draft holds. Another small model makes other mistakes, so the cheapest way to know whether one would help is to ask it exactly
// those questions, alone.
// Each pass: every small model that is on this machine (its file is in the models folder) and not in the swarm is asked the train
// questions no slot answered as the larger model did, and how many it answers equivalently is written down
// (.work/train/<configuration>/members.json) and shown on the page. Adding one stays a person's choice (the pills): nothing is
// fetched, and the configuration is not changed.
//   node training/members-probe.mjs [--each 6] [--most 24]
import fs from 'node:fs';
import path from 'node:path';
import { arg, questions, reference, llamaServer, modelsDir, kevAddress, WORK, WORKC } from './support/bench.mjs';
import { REGISTRY, MEMBERS, CONFIG_ID, TARGET } from '../src/catalog.mjs';
import { startMember, modelFile } from '../src/members.mjs';
import { messagesOf } from './tasks.mjs';
import { lastTrainRows } from './replay.mjs';
import { readState } from './state.mjs';
import { readerOk, readerMark } from './support/reader-file.mjs';

export const MEMBERS_FILE = path.join(WORKC, 'members.json');
// the train questions no slot answered as the larger model did
export const gapOf = (rows) =>
  rows.filter(
    (r) =>
      r.grade !== 'noref' &&
      (r.trace || []).some((t) => t.stage === 'draft') &&
      !(r.trace || []).some((t) => (t.stage === 'draft' || t.stage === 'revise') && t.same === true),
  );

if (import.meta.url === 'file://' + process.argv[1]) {
  const state = readState();
  const each = Number(arg('each', 6));
  const rows = lastTrainRows(WORK, state.seeds.train, CONFIG_ID, TARGET.id);
  const gap = gapOf(rows).slice(0, Number(arg('most', 24)));
  const inSwarm = new Set(Object.values(MEMBERS).map((m) => m.id));
  const here = REGISTRY.small.filter((m) => !inSwarm.has(m.id) && modelFile(m, modelsDir()));
  const notHere = REGISTRY.small.filter((m) => !inSwarm.has(m.id) && !modelFile(m, modelsDir()));
  const out = {
    at: new Date().toISOString(),
    pass: state.pass + 1,
    gap: gap.length,
    of: rows.length,
    models: [],
    notHere: notHere.map((m) => ({ id: m.id, name: m.name, bytes: m.bytes })),
  };
  if (!gap.length || !here.length) {
    out.why = !gap.length
      ? "Every train question had a slot that drafted the larger model's answer."
      : 'No other small model is on this machine to ask. Fetching one is your call (the pills).';
    fs.mkdirSync(WORKC, { recursive: true });
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(out.why);
    process.exit(0);
  }
  const tasks = new Map(questions('train', each).map((t) => [t.id, t]));
  const ref = reference([...tasks.values()]);
  const kev = await kevAddress();
  for (const m of here) {
    const r = await startMember(m, {
      llamaServer: llamaServer(),
      modelsDir: modelsDir(),
      slots: 1,
      contextPerSlot: 8192,
    });
    if (!r.ok) {
      out.models.push({ id: m.id, name: m.name, why: r.why });
      continue;
    }
    let drafts = 0;
    let asked = 0;
    try {
      for (const row of gap) {
        const t = tasks.get(row.id);
        const theirs = ref.get(row.id);
        if (!t || !theirs) continue;
        if ((t.type === 'open' || t.type === 'talk') && !readerOk(WORKC, t.type)) continue;
        asked++;
        let reply = '';
        try {
          reply = String(
            (
              await r.member.ask('alone', messagesOf(t), {
                maxTokens: 700,
                seed: 1,
                ...(t.tools ? { tools: t.tools } : {}),
              })
            ).text || '',
          );
        } catch {
          reply = '';
        }
        const g = reply
          ? await t.equivalent(theirs, reply, { kev: process.env.SWARM_JUDGE || kev, mark: readerMark(WORKC, t.type) })
          : { grade: 'unsure' };
        if (g.grade === 'right') drafts++;
      }
    } finally {
      await r.member.stop();
    }
    out.models.push({ id: m.id, name: m.name, drafts, asked });
    console.log(
      m.name + ': answered ' + drafts + ' of the ' + asked + ' questions no slot drafted, as the larger model did.',
    );
  }
  out.models.sort((a, b) => (b.drafts || 0) - (a.drafts || 0));
  fs.mkdirSync(WORKC, { recursive: true });
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(out, null, 2) + '\n');
}
