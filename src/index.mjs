// index.mjs - THE SWARM, AS A BLACK BOX. A message goes in; a reply comes out. What happens between (two small models, every slot
// of each, drafting and checking and deciding) is not the caller's concern, and the caller cannot tell it from one model.
//
//   import { createSwarm } from 'the-swarm';
//   const swarm = await createSwarm({ llamaServer, modelsDir });      // starts both models
//   const swarm = await createSwarm({ attach: { a: 'http://127.0.0.1:8081', b: 'http://127.0.0.1:8082' } });
//   const swarm = await createSwarm({ ..., decider: 'http://127.0.0.1:8009' });   // a decision model for the decide step (decider.mjs)
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
import { MEMBERS, SERVING, ENTRY, SERVED_NAME, TOOLS, toolsOf, NO_DECIDER } from './catalog.mjs';
import { attachMember, startMember, modelFile } from './members.mjs';
import { answer as orchestrate } from './orchestrate.mjs';
import { textOf } from './read.mjs';
import { serve as serveHttp } from './server.mjs';
import { deciderAt } from './decider.mjs';
import { fromSpec, readSpec, recipeSha256 } from './spec.mjs';
import { answerTools } from './tools.mjs';
import { behaviours, printed } from './behave.mjs';
import { readLearned, saveLearned, notePass, learnedFile, LEARNED_DIR } from './learned.mjs';

export { MEMBERS, SERVING, ENTRY, SERVED_NAME, TOOLS, toolsOf, modelFile };
export { DECIDER, TARGET, REGISTRY, readConfig, writeConfig, CONFIG_ID } from './catalog.mjs';
export const BRIEFS_FILE = fileURLToPath(new URL('./briefs.json', import.meta.url));
// THE ARRANGEMENT THE SWARM RUNS: what this configuration has learned against its larger model (learned.mjs), or, where it has
// learned nothing yet, the arrangement every swarm starts from (briefs.json). A file named is read as it is.
// THE ARRANGEMENT A SWARM STARTS FROM, for the places that are filled: briefs.json, whatever the configuration has learned since.
// What training kept is measured against it (training/evaluate.mjs --default asks the swarm as it started)
// WHICH PLACES SHARE A LOAD: { place: { with: the first place served the same way, places: how many share it (on that first
// place; 1 on the others) } }. sameAs(place) says how a place is served; off, every place has its own.
export function sharedLoads(keys, sameAs, on = true) {
  const out = {};
  for (const k of keys) {
    const first = on ? keys.find((j) => j in out && out[j].with === j && sameAs(j) === sameAs(k)) : undefined;
    out[k] = { with: first || k, places: 1 };
    if (first) out[first].places += 1;
  }
  return out;
}
export const startBriefs = () => withPlaces(JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8')), Object.keys(MEMBERS));
export const readBriefs = (file) => {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const learned = readLearned();
  return learned ? kindsAsSpecified(learned.briefs) : startBriefs();
};
// A CLASS'S OWN ARRANGEMENT HOLDS ITS SLOTS, PLAN AND FLOW, AND NOTHING ELSE (SwOA specification 4.3, `kinds`): anything else found
// there (a mark a migration once left, a field a later version adds) is not part of what the module runs, and not part of its hash
export const KIND_KEYS = ['slots', 'plan', 'flow'];
export function kindsAsSpecified(briefs) {
  if (!briefs || !briefs.kinds) return briefs;
  const kinds = {};
  for (const [c, k] of Object.entries(briefs.kinds))
    if (k && typeof k === 'object')
      kinds[c] = Object.fromEntries(KIND_KEYS.filter((p) => p in k).map((p) => [p, k[p]]));
  return { ...briefs, kinds };
}
// THE STARTING ARRANGEMENT FOR THE PLACES THAT ARE FILLED. briefs.json is written for two. A third or fourth small model begins as
// two more DRAFTERS (told what the first model's plain drafter and the second's other-way drafter are told): drafting is where
// another model's different mistakes count, and what else it should do is for training to find. Slots on a place that is not
// filled are left out.
// DOES THIS SWARM HAVE NO DECISION MODEL? As the caller says (opts.modelDecides); else as its spec says (a decider `none`); else
// as the configuration says, unless the caller gives a decider or names where one runs: an address that is empty names none
// (the trainers pass the address they found, and with no decision model that is '': read as "one was named", a swarm
// configured with none decided nothing and let the answer most slots held stand, found 2026-11-19 on its first real question)
export function modelDecidesOf(opts = {}, spec = null, noDecider = false) {
  if (opts.modelDecides !== undefined) return !!opts.modelDecides;
  if (spec) return ((spec.decider || {}).id || spec.decider) === 'none';
  const named = opts.decider !== undefined ? opts.decider : opts.kev;
  return !!noDecider && !opts.decide && !named;
}
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
// WHICH ROLE'S ADAPTER A SLOT IS ASKED WITH, by its stage: a drafter asked again to revise is still drafting; a stage that has no
// adapter of its own (a part, a probe, the small model that settles a tie) is asked of the model as it is.
export const ROLE_OF_STAGE = { draft: 'draft', revise: 'draft', check: 'check', write: 'write' };
// { role: file } -> [[role, file]] in a fixed order (the order the server loads them in, which is their ids)
export const roleFilesOf = (map) =>
  Object.entries(map || {})
    .filter(([, f]) => f)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
// the `lora` field of one request: every loaded adapter named, the one of this stage's role at 1 and the rest at 0
export const loraFor = (ids, stage) => {
  const role = ROLE_OF_STAGE[stage];
  return Object.entries(ids)
    .sort(([, a], [, b]) => a - b)
    .map(([r, id]) => ({ id, scale: r === role ? 1 : 0 }));
};
export async function createSwarm(opts = {}) {
  // FROM A SPEC (spec.mjs): its members, its arrangement and its serving, exactly; nothing from this machine's configuration
  const S = opts.spec ? fromSpec(opts.spec, { adaptersDir: opts.adaptersDir, anyAdapters: opts.anyAdapters }) : null;
  // (the adapters a spec pins, found and checked by fromSpec, unless the caller names its own)
  if (S && Object.keys(S.loras || {}).length && !opts.loras) opts = { ...opts, loras: S.loras };
  // (and the adapters of each role, where the spec pins them so)
  if (S && Object.keys(S.roleLoras || {}).length && !opts.roleLoras) opts = { ...opts, roleLoras: S.roleLoras };
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
  // (which loaded adapter is which role's, for each place served with one for each role: { key: { role: id } })
  const roleIds = {};
  const started = [];
  const stop = async () => {
    for (const s of servers.splice(0)) await s.close();
    for (const m of started.splice(0)) m.stop();
  };
  const servers = [];
  // ONE MODEL IN SEVERAL PLACES IS LOADED ONCE (sharedLoads): its places share one server, started with as many slots as they
  // have between them, so each slot of the arrangement still keeps to a server slot of its own. Two loads of one model answer
  // as one does, so the second bought nothing but its memory (measured 2026-11-21, LFM3 1.7B in two places on 24 kept benchmark
  // prompts: 2.07 GB resident in place of 3.29, 13 right of 18 where two loads had 14, and 7.9 s a question where they took
  // 6.8: a third less memory for a sixth more time). opts.shareLoads false, or SWARM_SHARE_LOADS=0, loads each place apart.
  // Places share a load where they would be served alike in every way: the same model, file, adapter and template.
  const served = (key) => ({
    jinja: opts.jinja !== undefined ? opts.jinja : toolMode === 'swarm' || key === toolLead,
    lora: (opts.loras && opts.loras[key]) || '',
    roles: JSON.stringify(roleFilesOf(opts.roleLoras && opts.roleLoras[key])),
    file: (opts.files && opts.files[key]) || '',
  });
  const share = sharedLoads(
    Object.keys(MEM).filter((k) => !(opts.attach && opts.attach[k])),
    (k) => JSON.stringify([MEM[k].id, MEM[k].file, served(k)]),
    opts.shareLoads !== undefined ? opts.shareLoads : process.env.SWARM_SHARE_LOADS !== '0',
  );
  for (const key of Object.keys(MEM)) {
    const at = opts.attach && opts.attach[key];
    if (at) {
      members[key] = attachMember(MEM[key], at, slots);
      continue;
    }
    // (a place whose model another place has loaded is that load)
    if (share[key].with !== key) {
      members[key] = members[share[key].with];
      if (roleIds[share[key].with]) roleIds[key] = roleIds[share[key].with];
      continue;
    }
    // (a server that takes turns with tools reads and writes calls in its model's own template: --jinja)
    const jinja = opts.jinja !== undefined ? opts.jinja : toolMode === 'swarm' || key === toolLead;
    // (a member with a trained adapter, opts.loras: { key: its GGUF LoRA }, is served with it: training/adapters.mjs lorasFor)
    // AN ADAPTER FOR EACH ROLE, ON ONE LOAD (opts.roleLoras: { key: { draft: file, check: file, write: file } }; training/roles.mjs).
    // Every one of them is loaded and none applied; each request then names the one its slot's role has (ask, below). Measured
    // 2026-11-22 on llama.cpp build 12110: the chat endpoint takes an adapter per request and the base model comes back on the
    // same slot after; a request that names none gets ALL of them at full strength, so every request names them; requests with
    // different adapters do not share a batch (2.7 times slower mixed), and slots that run together are of one role.
    const roleFiles = roleFilesOf(opts.roleLoras && opts.roleLoras[key]);
    const lora = roleFiles.length ? null : opts.loras && opts.loras[key];
    if (roleFiles.length) roleIds[key] = Object.fromEntries(roleFiles.map(([role], i) => [role, i]));
    const r = await startMember(MEM[key], {
      ...opts,
      jinja,
      slots: slots * share[key].places,
      file: opts.files && opts.files[key],
      ...(lora ? { flags: [...(opts.flags || []), '--lora', lora] } : {}),
      ...(roleFiles.length
        ? {
            flags: [
              ...(opts.flags || []),
              '--lora',
              roleFiles.map(([, f]) => f).join(','),
              '--lora-init-without-apply',
            ],
          }
        : {}),
    });
    if (!r.ok) {
      await stop();
      throw new Error(r.why);
    }
    members[key] = r.member;
    members[key].pid = r.pid;
    started.push(r.member);
  }
  // the decision model for the decide step, where one is named (opts.decider, or SWARM_DECIDER): an address that answers
  // /v1/systemone, whichever decision model it is. (opts.kev and SWARM_KEV, the names from when Kev was the only one, still work)
  const named = opts.decider !== undefined ? opts.decider : opts.kev;
  // A SWARM WITH NO DECISION MODEL (opts.modelDecides; a spec whose decider is `none`; else the configuration's): nothing is
  // asked to decide, wherever one may be running, and a slot of the swarm settles what the drafts differ on
  const modelDecides = modelDecidesOf(opts, S, NO_DECIDER);
  const deciderBase = modelDecides
    ? ''
    : named !== undefined
      ? named
      : process.env.SWARM_DECIDER || process.env.SWARM_KEV || '';
  const decideRaw =
    opts.decide ||
    (deciderBase ? deciderAt({ base: deciderBase, timeoutMs: opts.deciderTimeoutMs ?? opts.kevTimeoutMs }) : null);
  // WHERE CODE IS ASKED FOR, THE DRAFTS ARE RUN to see which of them do the same (behave.mjs): in a process of their own that can
  // reach nothing (sandbox.mjs). opts.runCode: false, or SWARM_RUN_CODE=0, and nothing a model wrote is ever run: the drafts are
  // compared as text.
  const behave =
    opts.behave !== undefined
      ? opts.behave
      : opts.runCode === false || process.env.SWARM_RUN_CODE === '0'
        ? null
        : behaviours;
  const reuse =
    opts.reuse && opts.seed !== undefined
      ? { map: new Map(), hits: 0, misses: 0, savedMs: 0, limit: opts.reuse === true ? 4000 : Number(opts.reuse) }
      : null;
  // the decider is reused the same way: the same choices put to it the same way are decided as they were (only a decision it made)
  const decide =
    reuse && decideRaw
      ? async (input) => {
          const key = 'decide|' + JSON.stringify(input);
          const had = reuse.map.get(key);
          if (had) {
            reuse.hits++;
            reuse.decided = (reuse.decided || 0) + 1;
            reuse.savedMs += had.ms;
            return JSON.parse(JSON.stringify(had.r));
          }
          reuse.misses++;
          const t0 = Date.now();
          const r = await decideRaw(input);
          if (r && r.ok) {
            reuse.map.set(key, { r: JSON.parse(JSON.stringify(r)), ms: Date.now() - t0 });
            if (reuse.map.size > reuse.limit) reuse.map.delete(reuse.map.keys().next().value);
          }
          return r;
        }
      : decideRaw;
  const ask = (slot, messages, extra = {}) => {
    const m = members[slot.member];
    if (!m) throw new Error('no member called ' + slot.member);
    const { maxTokens, temperature, top_p, top_k } = slot;
    const params = { maxTokens, timeoutMs: opts.timeoutMs, ...extra };
    // (the adapter of this slot's role, where its model is served with one for each role: every adapter named, one at full strength)
    const ids = roleIds[slot.member];
    if (ids) params.lora = loraFor(ids, slot.stage);
    for (const [k, v] of Object.entries({ temperature, top_p, top_k })) if (v !== undefined) params[k] = v;
    // opts.seed: the same slot asked the same thing draws the same answer. A program that serves people leaves it off; the
    // trainers set it, because a measurement that changes by itself from one run to the next cannot say whether a change helped
    if (opts.seed !== undefined) {
      const last = messages[messages.length - 1];
      params.seed = seedOf(opts.seed + '|' + slot.id + '|' + messages.length + '|' + textOf(last && last.content));
    }
    // WHAT EACH SLOT WAS ASKED, AND WHAT IT SAID, for whoever asks to be told (opts.onAsk): the record a role's adapter is
    // trained from (training/roles.mjs). Nothing kept what a slot was asked; only what it answered was on the trace
    const told = (pr) =>
      opts.onAsk
        ? pr.then((r) => {
            try {
              opts.onAsk({
                slot: slot.id,
                stage: slot.stage,
                member: slot.member,
                messages,
                text: (r && (r.text || r.content)) || '',
              });
            } catch {
              /* a listener that fails does not fail the answer */
            }
            return r;
          })
        : pr;
    if (!reuse) return told(m.ask(slot.id, messages, params));
    // REUSED WHERE NOTHING CHANGED (opts.reuse, the trainers only): with a seed, the same slot on the same model asked the same
    // thing with the same sampling draws the same answer, so a try that changes one slot need not ask the others again. Keyed by
    // all of that; only an answer that came back is kept; what it took is counted as saved
    const key = JSON.stringify([slot.member, params, messages]);
    const had = reuse.map.get(key);
    if (had) {
      reuse.hits++;
      reuse.savedMs += had.ms;
      reuse.map.delete(key);
      reuse.map.set(key, had);
      return told(Promise.resolve({ ...had.r }));
    }
    reuse.misses++;
    const t0 = Date.now();
    return told(m.ask(slot.id, messages, params)).then((r) => {
      if (r && (r.text || r.content || r.calls)) {
        reuse.map.set(key, { r: { ...r }, ms: Date.now() - t0 });
        if (reuse.map.size > reuse.limit) reuse.map.delete(reuse.map.keys().next().value);
      }
      return r;
    });
  };
  let last = null;
  const swarm = {
    members,
    decider: deciderBase || (opts.decide ? 'given' : ''),
    // (the name from when Kev was the only decider)
    get kev() {
      return this.decider;
    },
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
        // (the swarm's small models, largest first: who rewrites a reply that described the answer instead of giving it)
        others: Object.keys(members).sort((x, y) => (Number(MEM[y]?.params) || 0) - (Number(MEM[x]?.params) || 0)),
        decide,
        modelDecides,
        behave,
        // (a program the question asks the output of is run where drafts may be run at all: SwOA specification R.4)
        print: behave ? printed : null,
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
          ...(o.parallel_tool_calls !== undefined ? { parallel_tool_calls: o.parallel_tool_calls } : {}),
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
        parallel_tool_calls: o.parallel_tool_calls,
        briefs: o.briefs || briefs,
        ask,
        decide,
        lead: opts.lead || 'a',
        // (where the step is a reply, the answer procedure writes it, shown what the tools returned: SwOA specification T.9)
        answerReply: (shown) =>
          orchestrate(shown, {
            briefs: o.briefs || briefs,
            ask,
            others: Object.keys(members).sort((x, y) => (Number(MEM[y]?.params) || 0) - (Number(MEM[x]?.params) || 0)),
            decide,
            modelDecides,
            behave,
            print: behave ? printed : null,
          }),
      });
      return last;
    },
    // one member alone, told nothing: what the swarm is measured against, and where a turn with tools goes
    alone: (key, messages, params) => members[key].ask('alone', messages, params),
    last: () => last,
    // what reuse saved: answers given again without asking, and the milliseconds they first took
    get reused() {
      return reuse
        ? { hits: reuse.hits, misses: reuse.misses, savedMs: reuse.savedMs, decided: reuse.decided || 0 }
        : null;
    },
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
      // (each process once: places that share a load are one)
      pids: [...new Set(Object.values(swarm.members).map((m) => m.pid))].filter(Boolean),
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
