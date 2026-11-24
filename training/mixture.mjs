// mixture.mjs - THE ADAPTERS OF A MIXTURE ARE MADE HERE, one for each slot that drafts. What an adapter is taught was found one
// question at a time (training/prove.mjs, 2026-11-23), and each line below is a thing that failed when it was left out:
//   MANY QUESTIONS. A kind has six train questions in a pass; an adapter of six questions asked four ways learned those six
//     and answered a seventh 0 times of 3. More are made of each kind, by the maker the pass's own come from (--each).
//   THE SLOT'S OWN REQUEST. The module is asked each question once and every drafting slot's request is kept, word for word.
//   ITS OWN RIGHT ANSWER FIRST. Where the slot's answer was right it is the example: its own working, which it can follow.
//     Taught the larger model's short answers alone, a slot that had worked a question out step by step stopped doing so
//     and was wrong 3 times of 3.
//   THE LARGER MODEL'S WHERE IT WAS WRONG. It is asked that same request, and its answer is the example where it is right
//     by the question's own standard: what the slot lacks, from the model the module is trained toward.
//   EVERY KIND OF THE CLASS. An adapter taught one kind gained 36 points there and lost 17 on the kinds it was not taught.
//   ONE FOR EACH SLOT. Each slot has its own brief and so its own requests; its adapter is of those.
// An adapter made here is ON NOWHERE. It is written into the record (<adapters>/<model>/mix.json), loaded under its name, and
// tried as a move of the arrangement (arrange.mjs adapterMoves): kept on a slot, for a class of input, only where held
// questions gain beyond their error.
//   node training/mixture.mjs make [--each 24] [--kinds a,b] [--min 40] [--lr 5e-5] [--epochs 2]
//   node training/mixture.mjs list
// rowsOf, newestBySlot, mixFilesOf are the pure parts, tested.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestBySlot, mixFilesOf, readMix } from './mix-record.mjs';

// THE EXAMPLES OF ONE QUESTION: each drafting slot's request, once, with its own answer where that was right (own(text) ->
// boolean), else marked to be asked of the larger model. calls: [{ slot, stage, messages, text }] of roles in `roles`
// -> [{ slot, id, kind, messages, own: text | null }]
export async function rowsOf(t, calls, own) {
  const seen = new Set();
  const out = [];
  for (const c of calls || []) {
    if (!Array.isArray(c.messages) || !c.messages.length) continue;
    if (c.messages.some((m) => m.role === 'tool' || Array.isArray(m.tool_calls))) continue;
    const key = c.slot + '|' + JSON.stringify(c.messages);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      slot: c.slot,
      id: t.id,
      kind: t.kind,
      messages: c.messages,
      own: c.text && (await own(c.text)) ? c.text : null,
    });
  }
  return out;
}
// A MESSAGE AS A CHAT TEMPLATE TAKES IT: a tool call's arguments as the thing they are, not as text. A request carries them as
// text (JSON), and a template refuses that (found 2026-11-22: the drafters' adapter, the role with the most examples, was not
// trained at all). Arguments that are not JSON are kept as text under one name, so the example is still one a template takes.
export function forTemplate(m) {
  if (!m || !Array.isArray(m.tool_calls)) return m;
  const calls = m.tool_calls.map((t) => {
    const f = t && t.function;
    if (!f || typeof f.arguments !== 'string') return t;
    let a;
    try {
      a = JSON.parse(f.arguments);
    } catch {
      a = null;
    }
    if (!a || typeof a !== 'object' || Array.isArray(a)) a = { text: f.arguments };
    return { ...t, function: { ...f, arguments: a } };
  });
  return { ...m, tool_calls: calls };
}
// the last line of an answer that says anything, where it is short enough to be an answer and not an argument ('' otherwise)
export function closingLine(text) {
  const last =
    String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || '';
  return last.length <= 100 ? last : '';
}
// (the record itself is read in mix-record.mjs, which adapters.mjs reads too: this file runs adapters.mjs, and a file that
// waits on one that waits on it never starts)
export { newestBySlot, mixFilesOf, readMix };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const B = await import('./support/bench.mjs');
  const A = await import('./adapters.mjs');
  const { MEMBERS, TARGET, CONFIG_KEY } = await import('../src/catalog.mjs');
  const { readBriefs, ROLE_OF_STAGE } = await import('../src/index.mjs');
  const { finalOf } = await import('../src/read.mjs');
  const { messagesOf } = await import('./tasks.mjs');
  const cmd = process.argv[2];
  const work = path.join(B.REPO_ROOT, '.work');
  // (what the page's card follows while this runs: .work/pretrain/live.json, as the other makers of adapters write it)
  const liveFile = path.join(work, 'pretrain', 'live.json');
  const live = { pid: process.pid, startedAt: Date.now(), phase: 'diagnosing', step: '', roles: {}, models: [] };
  const say = (x, phase) => {
    console.log(new Date().toTimeString().slice(0, 8) + ' ' + x);
    try {
      live.step = x;
      if (phase) live.phase = phase;
      fs.mkdirSync(path.dirname(liveFile), { recursive: true });
      fs.writeFileSync(liveFile + '.tmp', JSON.stringify(live));
      fs.renameSync(liveFile + '.tmp', liveFile);
    } catch {
      /* the page goes without */
    }
  };
  const model = (() => {
    const m = Object.values(MEMBERS)[0];
    return { name: m.name, file: path.join(B.modelsDir(), m.file) };
  })();
  const dir = A.adapterDir(work, TARGET.id, model);
  if (cmd === 'list') {
    for (const a of newestBySlot(readMix(dir))) console.log(a.slot + '  ' + a.name + '  ' + a.gguf);
    process.exit(0);
  }
  if (cmd !== 'make') {
    console.log('node training/mixture.mjs make [--each 24] [--kinds a,b] [--min 40] [--lr 5e-5] [--epochs 2] | list');
    process.exit(2);
  }
  if (!A.mlxReady(model, work).ok) {
    say(model.name + ' cannot be trained here: ' + A.mlxReady(model, work).why);
    process.exit(3);
  }
  const kinds = String(B.arg('kinds', '')).split(',').filter(Boolean);
  const each = Number(B.arg('each', 24));
  const tasks = B.questions('train', each).filter(
    (t) =>
      typeof t.good === 'function' &&
      !t.tools &&
      !['open', 'talk'].includes(t.type) &&
      (!kinds.length || kinds.includes(t.kind)),
  );
  const marker = readBriefs().marker;
  const rightBy = async (t, x) => {
    try {
      return !!x && ((await t.good(t.wrap(x), {})) || {}).grade === 'right';
    } catch {
      return false;
    }
  };
  // 1  the module, asked each question once: every drafting slot's request and its own answer
  const calls = new Map();
  let cur = null;
  const swarm = await B.openSwarm(readBriefs(), {
    seed: 1,
    adapters: false,
    onAsk: (c) => cur && ROLE_OF_STAGE[c.stage] === 'draft' && calls.set(cur, [...(calls.get(cur) || []), c]),
  });
  const rows = [];
  try {
    for (const [i, t] of tasks.entries()) {
      if (i % 25 === 0)
        say('Asking the module, to keep what each drafting slot is asked: ' + (i + 1) + ' of ' + tasks.length);
      cur = t.id;
      await B.askSwarm(swarm, t, messagesOf(t));
      cur = null;
      rows.push(
        ...(await rowsOf(t, calls.get(t.id) || [], (text) => rightBy(t, finalOf(text, marker, t.type === 'code')))).map(
          (r) => ({
            ...r,
            t,
          }),
        ),
      );
    }
  } finally {
    await swarm.stop();
  }
  // 2  the larger model, asked what each slot got wrong
  const need = rows.filter((r) => !r.own);
  const examples = rows
    .filter((r) => r.own)
    .map((r) => ({
      slot: r.slot,
      id: r.id,
      kind: r.kind,
      from: 'own',
      messages: [...r.messages.map(forTemplate), { role: 'assistant', content: r.own }],
    }));
  if (need.length) {
    const big = await B.openAlone('target');
    try {
      for (const [i, r] of need.entries()) {
        if (i % 50 === 0) say('Asking ' + TARGET.name + ' what the slots got wrong: ' + (i + 1) + ' of ' + need.length);
        let text = '';
        try {
          text = String((await big.ask(r.messages, { maxTokens: 900 })).text || '');
        } catch {
          text = '';
        }
        const final = text ? finalOf(text, marker, r.t.type === 'code') : '';
        let ok = await rightBy(r.t, final);
        if (!ok && !final) {
          const last = closingLine(text);
          if (last && (await rightBy(r.t, last))) {
            text = text.trimEnd() + '\n\n' + marker + ' ' + last;
            ok = true;
          }
        }
        if (ok)
          examples.push({
            slot: r.slot,
            id: r.id,
            kind: r.kind,
            from: 'larger',
            messages: [...r.messages.map(forTemplate), { role: 'assistant', content: text }],
          });
      }
    } finally {
      await big.stop();
    }
  }
  // 3  an adapter for each slot that has enough
  const record = readMix(dir);
  const least = Number(B.arg('min', 40));
  const stamp = new Date().toISOString();
  const version = Object.keys(record.adapters).length
    ? Math.max(...Object.keys(record.adapters).map((n) => Number(n.split('@')[1]) || 0)) + 1
    : 1;
  let made = 0;
  for (const slot of [...new Set(examples.map((e) => e.slot))].sort()) {
    const mine = examples.filter((e) => e.slot === slot);
    if (mine.length < least) {
      say(slot + ': ' + mine.length + ' examples, fewer than ' + least + ': no adapter');
      continue;
    }
    const name = slot + '@' + version;
    const out = path.join(dir, 'mix', name);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const ds = path.join(out, 'examples.jsonl');
    fs.writeFileSync(ds, mine.map((e) => JSON.stringify(e)).join('\n') + '\n');
    say('Training the adapter of ' + slot + ' on ' + mine.length + ' examples', 'training');
    const r = A.trainAdapter(model, ds, out, {
      work,
      iters: Math.round(mine.length * Number(B.arg('epochs', 2))),
      lr: B.arg('lr', '5e-5'),
    });
    if (!r.ok) {
      say(slot + ': NOT trained: ' + r.why);
      continue;
    }
    made++;
    record.adapters[name] = {
      slot,
      gguf: r.gguf,
      at: stamp,
      configuration: CONFIG_KEY,
      examples: mine.length,
      own: mine.filter((e) => e.from === 'own').length,
      larger: mine.filter((e) => e.from === 'larger').length,
      kinds: [...new Set(mine.map((e) => e.kind))].length,
      valLoss: r.valLoss,
      perplexity: r.perplexity,
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mix.json'), JSON.stringify(record, null, 1));
    say(
      slot +
        ': ' +
        name +
        ', validation loss ' +
        JSON.stringify(r.valLoss) +
        ' (' +
        record.adapters[name].own +
        ' its own, ' +
        record.adapters[name].larger +
        " the larger model's)",
    );
  }
  say(
    made ? made + ' adapters made. None is on: each is tried as a move of the arrangement.' : 'No adapter was made.',
    'done',
  );
  process.exit(made ? 0 : 3);
}
