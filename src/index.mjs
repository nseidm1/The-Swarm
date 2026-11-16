// index.mjs - THE SWARM, AS A BLACK BOX. A message goes in; a reply comes out. What happens between (two small models, every slot
// of each, drafting and checking and deciding) is not the caller's concern, and the caller cannot tell it from one model.
//
//   import { createSwarm } from 'the-swarm';
//   const swarm = await createSwarm({ llamaServer, modelsDir });      // starts both models
//   const swarm = await createSwarm({ attach: { a: 'http://127.0.0.1:8081', b: 'http://127.0.0.1:8082' } });
//   const swarm = await createSwarm({ ..., kev: 'http://127.0.0.1:8009' });   // a decision model for the decide step (decider.mjs)
//   const swarm = await createSwarm({ ..., runCode: false });   // never run a draft: compare drafts of code as text (behave.mjs)
//   const { reply } = await swarm.answer([{ role: 'user', content: 'What is 17 x 23?' }]);
//   const { base, port } = await swarm.serve();                       // the same thing, as a server that speaks like llama.cpp
//   await swarm.stop();
//
//   serveSwarm(entry, engine, opts)   for a program that already starts llama.cpp models one at a time and wants this in the
//                                     same place: it takes what such a call takes and gives back what such a call gives back
//                                     ({ ok, port, pid, base, args, loadMs } or { ok: false, why }).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MEMBERS, SERVING, ENTRY, SERVED_NAME, TOOLS, toolsOf } from './catalog.mjs';
import { attachMember, startMember, modelFile } from './members.mjs';
import { answer as orchestrate } from './orchestrate.mjs';
import { serve as serveHttp } from './server.mjs';
import { kevDecider } from './decider.mjs';
import { fromSpec, readSpec, recipeSha256 } from './spec.mjs';
import { answerTools } from './tools.mjs';
import { behaviours } from './behave.mjs';
import { readLearned, saveLearned, notePass, learnedFile, LEARNED_DIR } from './learned.mjs';

export { MEMBERS, SERVING, ENTRY, SERVED_NAME, TOOLS, toolsOf, modelFile };
export { DECIDER, TARGET, REGISTRY, readConfig, writeConfig, CONFIG_ID } from './catalog.mjs';
export const BRIEFS_FILE = fileURLToPath(new URL('./briefs.json', import.meta.url));
// THE ARRANGEMENT THE SWARM RUNS: what this configuration has learned against its larger model (learned.mjs), or, where it has
// learned nothing yet, the arrangement every swarm starts from (briefs.json). A file named is read as it is.
export const readBriefs = (file) => {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const learned = readLearned();
  return learned ? learned.briefs : withPlaces(JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8')), Object.keys(MEMBERS));
};
// THE STARTING ARRANGEMENT FOR THE PLACES THAT ARE FILLED. briefs.json is written for two. A third or fourth small model begins as
// two more DRAFTERS (told what the first model's plain drafter and the second's other-way drafter are told): drafting is where
// another model's different mistakes count, and what else it should do is for training to find. Slots on a place that is not
// filled are left out.
export function withPlaces(briefs, places) {
  const slots = briefs.slots.filter((s) => places.includes(s.member));
  const drafters = briefs.slots.filter((s) => s.stage === 'draft');
  for (const p of places) {
    if (slots.some((s) => s.member === p) || !drafters.length) continue;
    const like = [drafters[0], drafters[drafters.length - 1]].filter((s, i, all) => all.indexOf(s) === i);
    for (const s of like)
      slots.splice(
        slots.reduce((at, x, i) => (x.stage === 'draft' ? i + 1 : at), 0),
        0,
        { ...s, id: p + '-' + s.id.replace(/^[a-z]-/, ''), member: p },
      );
  }
  return { ...briefs, slots };
}
export { readLearned, saveLearned, notePass, learnedFile, LEARNED_DIR };
export { fromSpec, readSpec, recipeSha256 };
// what was measured of the swarm (training/publish.mjs writes it): for a model card to show
export const readTrained = () => {
  try {
    return JSON.parse(fs.readFileSync(fileURLToPath(new URL('./trained.json', import.meta.url)), 'utf8'));
  } catch {
    return null;
  }
};

const seedOf = (text) => createHash('sha256').update(text).digest().readUInt32BE(0) >>> 1;
export async function createSwarm(opts = {}) {
  // FROM A SPEC (spec.mjs): its members, its arrangement and its serving, exactly; nothing from this machine's configuration
  const S = opts.spec ? fromSpec(opts.spec) : null;
  const MEM = S ? S.members : MEMBERS;
  let briefs = opts.briefs || (S && S.briefs) || readBriefs(opts.briefsFile);
  const slots = opts.slots || (S && S.slots) || SERVING.slots;
  if (S && S.contextPerSlot && !opts.contextPerSlot) opts = { ...opts, contextPerSlot: S.contextPerSlot };
  // TURNS WITH TOOLS (tools.mjs): "swarm" decides them; otherwise one small model takes them alone (named by its id, or its place;
  // "lead": opts.lead, else place a). opts.tools, else the spec's, else the configuration's
  const setting = opts.tools || (S && S.tools) || TOOLS;
  const toolLead =
    setting === 'swarm' ? opts.lead || 'a' : toolsOf(setting === 'lead' ? opts.lead || 'a' : setting, MEM);
  const toolMode = setting === 'swarm' ? 'swarm' : 'lead';
  const members = {};
  const started = [];
  const stop = async () => {
    for (const s of servers.splice(0)) await s.close();
    for (const m of started.splice(0)) m.stop();
  };
  const servers = [];
  for (const key of Object.keys(MEM)) {
    const at = opts.attach && opts.attach[key];
    if (at) {
      members[key] = attachMember(MEM[key], at, slots);
      continue;
    }
    // (a server that takes turns with tools reads and writes calls in its model's own template: --jinja)
    const jinja = opts.jinja !== undefined ? opts.jinja : toolMode === 'swarm' || key === toolLead;
    const r = await startMember(MEM[key], { ...opts, jinja, slots, file: opts.files && opts.files[key] });
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
  // WHERE CODE IS ASKED FOR, THE DRAFTS ARE RUN to see which of them do the same (behave.mjs): in a process of their own that can
  // reach nothing (sandbox.mjs). opts.runCode: false, or SWARM_RUN_CODE=0, and nothing a model wrote is ever run: the drafts are
  // compared as text.
  const behave =
    opts.behave !== undefined
      ? opts.behave
      : opts.runCode === false || process.env.SWARM_RUN_CODE === '0'
        ? null
        : behaviours;
  const ask = (slot, messages, extra = {}) => {
    const m = members[slot.member];
    if (!m) throw new Error('no member called ' + slot.member);
    const { maxTokens, temperature, top_p, top_k } = slot;
    const params = { maxTokens, timeoutMs: opts.timeoutMs, ...extra };
    for (const [k, v] of Object.entries({ temperature, top_p, top_k })) if (v !== undefined) params[k] = v;
    // opts.seed: the same slot asked the same thing draws the same answer. A program that serves people leaves it off; the
    // trainers set it, because a measurement that changes by itself from one run to the next cannot say whether a change helped
    if (opts.seed !== undefined) {
      const last = messages[messages.length - 1];
      params.seed = seedOf(
        opts.seed + '|' + slot.id + '|' + messages.length + '|' + String((last && last.content) || ''),
      );
    }
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
    // and asks with another draw (a change that wins with one draw and not another was luck): the seed the slots are asked with
    setSeed(n) {
      opts.seed = n;
    },
    get seed() {
      return opts.seed;
    },
    async answer(messages, o = {}) {
      last = await orchestrate(messages, {
        briefs: o.briefs || briefs,
        ask,
        decide,
        behave,
        onStep: o.onStep,
        onStart: o.onStart,
      });
      return last;
    },
    // A TURN WITH TOOLS: decided by the swarm (tools: "swarm"), or the lead's alone (tools: "lead"), as an action either way
    toolMode,
    toolLead,
    async answerTools(messages, o = {}) {
      if (toolMode !== 'swarm') {
        const t1 = Date.now();
        const r = await members[toolLead].ask('alone', messages, {
          maxTokens: 700,
          tools: o.tools,
          ...(o.tool_choice !== undefined ? { tool_choice: o.tool_choice } : {}),
        });
        const { actionOf, actionText } = await import('./tools.mjs');
        const action = actionOf({ content: r.content, tool_calls: r.calls }, o.tools);
        last = {
          ok: !action.bad,
          path: 'tools-lead',
          text: action.bad ? '' : actionText(action),
          decided: action.bad ? '' : actionText(action),
          reply: action.reply || '',
          action,
          calls: (r.calls || []).filter(() => !action.bad),
          trace: [
            {
              slot: 'lead',
              member: toolLead,
              stage: 'draft',
              ms: Date.now() - t1,
              tokens: r.tokens,
              ok: !action.bad,
              final: action.bad ? '' : actionText(action),
              out: action.bad ? 'Left out: ' + action.bad : actionText(action),
            },
          ],
          ms: Date.now() - t1,
        };
        return last;
      }
      last = await answerTools(messages, {
        tools: o.tools,
        tool_choice: o.tool_choice,
        briefs: o.briefs || briefs,
        ask,
        decide,
        lead: opts.lead || 'a',
      });
      return last;
    },
    // one member alone, told nothing: what the swarm is measured against, and where a turn with tools goes
    alone: (key, messages, params) => members[key].ask('alone', messages, params),
    last: () => last,
    alive: async () => (await Promise.all(Object.values(members).map((m) => m.alive()))).every(Boolean),
    async serve(o = {}) {
      const s = await serveHttp(swarm, { lead: toolLead, ...o });
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
    // (an entry that carries its spec, as a chooser's card does: { ...spec.card, spec }, makes that swarm)
    const swarm = await createSwarm({
      llamaServer: engine.file,
      flags: engine.pre,
      ...(entry && entry.spec ? { spec: entry.spec } : {}),
      ...opts,
    });
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
