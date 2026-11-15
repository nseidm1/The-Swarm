// index.mjs - THE SWARM, AS A BLACK BOX. A message goes in; a reply comes out. What happens between (two small models, every slot
// of each, drafting and checking and deciding) is not the caller's concern, and the caller cannot tell it from one model.
//
//   import { createSwarm } from 'the-swarm';
//   const swarm = await createSwarm({ llamaServer, modelsDir });      // starts both models
//   const swarm = await createSwarm({ attach: { a: 'http://127.0.0.1:8081', b: 'http://127.0.0.1:8082' } });
//   const swarm = await createSwarm({ ..., kev: 'http://127.0.0.1:8009' });   // a decision model for the decide step (decider.mjs)
//   const { reply } = await swarm.answer([{ role: 'user', content: 'What is 17 x 23?' }]);
//   const { base, port } = await swarm.serve();                       // the same thing, as a server that speaks like llama.cpp
//   await swarm.stop();
//
//   serveSwarm(entry, engine, opts)   for a program that already starts llama.cpp models one at a time and wants this in the
//                                     same place: it takes what such a call takes and gives back what such a call gives back
//                                     ({ ok, port, pid, base, args, loadMs } or { ok: false, why }).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MEMBERS, SERVING, ENTRY, SERVED_NAME } from './catalog.mjs';
import { attachMember, startMember, modelFile } from './members.mjs';
import { answer as orchestrate } from './orchestrate.mjs';
import { serve as serveHttp } from './server.mjs';
import { kevDecider } from './decider.mjs';

export { MEMBERS, SERVING, ENTRY, SERVED_NAME, modelFile };
export { DECIDER, TARGET, REGISTRY, readConfig, writeConfig, CONFIG_ID } from './catalog.mjs';
export const BRIEFS_FILE = fileURLToPath(new URL('./briefs.json', import.meta.url));
export const readBriefs = (file = BRIEFS_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));
// what was measured of the swarm (training/publish.mjs writes it): for a model card to show
export const readTrained = () => {
  try {
    return JSON.parse(fs.readFileSync(fileURLToPath(new URL('./trained.json', import.meta.url)), 'utf8'));
  } catch {
    return null;
  }
};

export async function createSwarm(opts = {}) {
  let briefs = opts.briefs || readBriefs(opts.briefsFile);
  const slots = opts.slots || SERVING.slots;
  const members = {};
  const started = [];
  const stop = async () => {
    for (const s of servers.splice(0)) await s.close();
    for (const m of started.splice(0)) m.stop();
  };
  const servers = [];
  for (const key of Object.keys(MEMBERS)) {
    const at = opts.attach && opts.attach[key];
    if (at) {
      members[key] = attachMember(MEMBERS[key], at, slots);
      continue;
    }
    const r = await startMember(MEMBERS[key], { ...opts, slots, file: opts.files && opts.files[key] });
    if (!r.ok) {
      await stop();
      throw new Error(r.why);
    }
    members[key] = r.member;
    members[key].pid = r.pid;
    started.push(r.member);
  }
  // the decision model for the decide step, where one is named (opts.kev, or SWARM_KEV): an address that answers /v1/systemone
  const kevBase = opts.kev !== undefined ? opts.kev : process.env.SWARM_KEV || '';
  const decide = opts.decide || (kevBase ? kevDecider({ base: kevBase, timeoutMs: opts.kevTimeoutMs }) : null);
  const ask = (slot, messages) => {
    const m = members[slot.member];
    if (!m) throw new Error('no member called ' + slot.member);
    const { maxTokens, temperature, top_p, top_k } = slot;
    const params = { maxTokens, timeoutMs: opts.timeoutMs };
    for (const [k, v] of Object.entries({ temperature, top_p, top_k })) if (v !== undefined) params[k] = v;
    return m.ask(slot.id, messages, params);
  };
  let last = null;
  const swarm = {
    members,
    kev: kevBase || (opts.decide ? 'given' : ''),
    get briefs() {
      return briefs;
    },
    // the trainer swaps what the slots are told without starting the models again
    setBriefs(b) {
      briefs = b;
    },
    async answer(messages, o = {}) {
      last = await orchestrate(messages, {
        briefs: o.briefs || briefs,
        ask,
        decide,
        onStep: o.onStep,
        onStart: o.onStart,
      });
      return last;
    },
    // one member alone, told nothing: what the swarm is measured against, and where a turn with tools goes
    alone: (key, messages, params) => members[key].ask('alone', messages, params),
    last: () => last,
    alive: async () => (await Promise.all(Object.values(members).map((m) => m.alive()))).every(Boolean),
    async serve(o = {}) {
      const s = await serveHttp(swarm, { lead: opts.lead || 'a', ...o });
      servers.push(s);
      return s;
    },
    stop,
  };
  return swarm;
}

// THE SAME PLACE A llama.cpp MODEL GOES: (entry, engine, { stateDir, onLine, waitMs }) -> { ok, port, pid, base, args, loadMs }.
// `engine.file` is the llama-server program the caller already has; the members' files are looked for in opts.modelsDir.
const running = new Set();
export async function serveSwarm(entry = ENTRY, engine = {}, opts = {}) {
  const t0 = Date.now();
  try {
    const swarm = await createSwarm({ llamaServer: engine.file, flags: engine.pre, ...opts });
    const s = await swarm.serve({ port: opts.port });
    running.add(swarm);
    return {
      ok: true,
      port: s.port,
      base: s.base,
      pid: process.pid,
      pids: Object.values(swarm.members)
        .map((m) => m.pid)
        .filter(Boolean),
      args:
        'swarm ' +
        entry.id +
        ' (' +
        Object.keys(swarm.members).join(' + ') +
        ', ' +
        (opts.slots || SERVING.slots) +
        ' slots each)',
      loadMs: Date.now() - t0,
      stop: async () => {
        running.delete(swarm);
        await swarm.stop();
      },
    };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  }
}
export const stopSwarms = async () => {
  for (const s of [...running]) await s.stop();
  running.clear();
};
