// roles.mjs - AN ADAPTER FOR EACH ROLE: pretraining that knows the arrangement. The swarm's small model does several jobs (it
// drafts, it checks, it writes the reply), each asked in its own words by its slot's brief. One adapter taught the larger
// model's answers to plain questions teaches none of those jobs as the swarm asks them. So:
//   1  DIAGNOSE. The train questions that carry a standard of their own are put to the swarm once, as it stands and without
//      adapters, and every slot's request is kept with its answer (src/index.mjs onAsk): what it was asked, in full
//   2  MARK. Each slot's answer is marked right or wrong as the reply is (measure.mjs slotReport: `same` on the trace)
//   3  EXAMPLES, BY ROLE (roleOf a stage: src/index.mjs ROLE_OF_STAGE). A slot's request with the answer it gave is an example
//      for its role where that answer was right: a draft or a check that had the answer; a reply written without changing a
//      right answer. What a role did when it worked, on exactly what it is asked. (Not yet: what it should have said where it
//      failed; the larger model answers the question, not the slot's request, so it has no label for that.)
//   4  TRAIN. One adapter for each role that has enough examples (--min, 8), with MLX as adapters.mjs trains its one
//      (trainAdapter), kept beside the model's own adapter: <adapters>/<larger model>/<model>/roles/<role>/ and roles.json
// The swarm is then served with all of them on one load, each request naming its role's (src/index.mjs roleLoras), where the
// configuration serves adapters. Whether that is better is the evaluation's to say (evaluate.mjs --variant pretrained).
//   node training/roles.mjs train [--limit N] [--iters N] [--min N]     examplesOf and roleOfCall are the pure parts, tested
import fs from 'node:fs';
import path from 'node:path';
import { ROLE_OF_STAGE } from '../src/index.mjs';

// A SLOT'S CALL FOR A TRACE ENTRY: the request of that slot, on that question, whose answer is the entry's (its output as it
// came back). A slot asked twice on one question (a retry, a revision) has two calls: the text says which.
export function callOf(calls, s) {
  const mine = (calls || []).filter((c) => c.slot === s.slot && c.text);
  return mine.find((c) => c.text === s.out) || (mine.length === 1 ? mine[0] : null);
}
// THE EXAMPLES OF ONE QUESTION, BY ROLE. row: what the swarm did ({ id, kind, grade, trace: [{ slot, stage, out, same }] });
// calls: every slot's request on it ([{ slot, stage, member, messages, text }]). -> [{ role, id, kind, member, messages }]
// where messages ends with the slot's own answer. Only what was right: a drafter or checker whose answer was (same === true); a
// writer whose reply left a right answer right (same === true and the reply itself right).
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
export function examplesOf(row, calls) {
  const out = [];
  const seen = new Set();
  for (const s of (row && row.trace) || []) {
    const role = ROLE_OF_STAGE[s.stage];
    if (!role || s.same !== true) continue;
    if (role === 'write' && row.grade !== 'right') continue;
    const c = callOf(calls, s);
    if (!c || !Array.isArray(c.messages) || !c.messages.length) continue;
    const key = role + '|' + JSON.stringify(c.messages);
    if (seen.has(key)) continue; // (two slots asked the very same thing teach it once)
    seen.add(key);
    out.push({
      role,
      id: row.id,
      kind: row.kind,
      member: c.member,
      messages: [...c.messages.map(forTemplate), { role: 'assistant', content: c.text }],
    });
  }
  return out;
}
// how many examples each role has, and of how many questions: { role: { examples, questions } }
export function countByRole(examples) {
  const by = {};
  for (const e of examples) {
    const o = (by[e.role] = by[e.role] || { examples: 0, ids: new Set() });
    o.examples++;
    o.ids.add(e.id);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { examples: v.examples, questions: v.ids.size }]));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const B = await import('./support/bench.mjs');
  const { slotReport } = await import('./measure.mjs');
  const { messagesOf } = await import('./tasks.mjs');
  const { readerMark } = await import('./support/reader-file.mjs');
  const A = await import('./adapters.mjs');
  const { MEMBERS, TARGET, CONFIG_KEY } = await import('../src/catalog.mjs');
  const { readBriefs } = await import('../src/index.mjs');
  if (process.argv[2] !== 'train') {
    console.log('node training/roles.mjs train [--limit N] [--iters N] [--min N]');
    process.exit(2);
  }
  const work = path.join(B.REPO_ROOT, '.work');
  const limit = Number(B.arg('limit', 0));
  const iters = Number(B.arg('iters', 100));
  const least = Number(B.arg('min', 8));
  // WHAT THE PAGE'S PRETRAIN CARD FOLLOWS (.work/pretrain/live.json), as adapters.mjs writes it
  const liveFile = path.join(work, 'pretrain', 'live.json');
  const live = { pid: process.pid, startedAt: Date.now(), phase: 'diagnosing', step: '', roles: {}, models: [] };
  const write = () => {
    fs.mkdirSync(path.dirname(liveFile), { recursive: true });
    fs.writeFileSync(liveFile + '.tmp', JSON.stringify(live));
    fs.renameSync(liveFile + '.tmp', liveFile);
  };
  const say = (step, phase) => {
    live.step = step;
    if (phase) live.phase = phase;
    write();
    console.log(new Date().toTimeString().slice(0, 8) + ' ' + step);
  };
  // the models that can be trained here, each once (a model in several places is one model)
  const models = [
    ...new Map(
      Object.entries(MEMBERS).map(([k, m]) => [
        m.file,
        { key: k, name: m.name, file: path.join(B.modelsDir(), m.file) },
      ]),
    ).values(),
  ];
  const can = models.filter((m) => A.mlxReady(m, work).ok);
  for (const m of models.filter((x) => !can.includes(x)))
    console.log('not trained: ' + m.name + ': ' + A.mlxReady(m, work).why);
  if (!can.length) {
    say("None of the swarm's small models can be trained here: nothing was asked.", 'done');
    process.exit(3);
  }
  // 1  DIAGNOSE: the train questions with a standard of their own (marked without a reader), as the swarm stands, no adapters
  const all = B.questions('train').filter(
    (t) => typeof t.good === 'function' && t.type !== 'open' && t.type !== 'talk',
  );
  const list = limit > 0 ? all.slice(0, limit) : all;
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const ref = B.reference(list);
  const calls = new Map();
  let cur = '';
  const swarm = await B.openSwarm(readBriefs(), {
    adapters: false,
    onAsk: (c) => {
      if (!cur) return;
      calls.set(cur, [...(calls.get(cur) || []), c]);
    },
  });
  let rows = [];
  try {
    say(
      'Asking the swarm ' + list.length + ' train questions as it stands, keeping what each slot is asked',
      'diagnosing',
    );
    let n = 0;
    rows = await B.run(
      list,
      async (t) => {
        cur = t.id;
        calls.delete(t.id);
        const got = await B.askSwarm(swarm, t, messagesOf(t));
        cur = '';
        n++;
        if (n % 10 === 0) say('Asked ' + n + ' of ' + list.length + ' train questions');
        return {
          reply: got.reply,
          decided: got.decided,
          path: got.path,
          trace: got.trace,
          tried: got.tried || undefined,
        };
      },
      { ref },
    );
    // 2  MARK each slot's answer
    await slotReport(rows, byId, {
      reader: B.judgeAddress(swarm.decider),
      briefs: swarm.briefs,
      markOf: (t) => readerMark(B.WORKC, t.type),
    });
  } finally {
    await swarm.stop();
  }
  // 3  EXAMPLES, by role
  const examples = rows.flatMap((r) => examplesOf(r, calls.get(r.id) || []));
  const counts = countByRole(examples);
  const right = rows.filter((r) => r.grade === 'right').length;
  console.log(
    'diagnosed: ' +
      rows.length +
      ' questions, ' +
      right +
      ' right; ' +
      [...calls.values()].reduce((a, c) => a + c.length, 0) +
      ' slot requests kept; examples by role: ' +
      (Object.entries(counts)
        .map(([k, v]) => k + ' ' + v.examples + ' (of ' + v.questions + ' questions)')
        .join(', ') || 'none'),
  );
  // 4  TRAIN one adapter for each role with enough examples, for each model that can be trained
  const server = B.llamaServer();
  const beside = server && path.isAbsolute(server) ? path.join(path.dirname(server), 'llama-perplexity') : '';
  const perplexityBin = beside && fs.existsSync(beside) ? beside : 'llama-perplexity';
  let trained = 0;
  for (const m of can) {
    const dir = A.adapterDir(work, TARGET.id, m);
    const keys = Object.entries(MEMBERS)
      .filter(([, x]) => x.file === path.basename(m.file))
      .map(([k]) => k);
    const mine = examples.filter((e) => keys.includes(e.member));
    const record = {
      at: new Date().toISOString(),
      model: m.name,
      target: TARGET.name,
      configuration: CONFIG_KEY,
      questions: rows.length,
      right,
      iters,
      roles: {},
    };
    for (const role of [...new Set(Object.values(ROLE_OF_STAGE))].sort()) {
      const ex = mine.filter((e) => e.role === role);
      if (ex.length < least) {
        record.roles[role] = {
          ok: false,
          examples: ex.length,
          why: 'fewer than ' + least + ' examples of this role came out right',
        };
        console.log(m.name + ', ' + role + ': not trained (' + ex.length + ' examples, ' + least + ' needed)');
        continue;
      }
      const out = path.join(dir, 'roles', role);
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      const ds = path.join(out, 'examples.jsonl');
      fs.writeFileSync(
        ds,
        ex.map((e) => JSON.stringify({ id: e.id, kind: e.kind, messages: e.messages })).join('\n') + '\n',
      );
      say('Training ' + m.name + "'s adapter for the role " + role + ' on ' + ex.length + ' examples', 'training');
      const r = A.trainAdapter(m, ds, out, { work, iters, perplexityBin });
      record.roles[role] = {
        ok: !!r.ok,
        examples: r.examples || ex.length,
        ...(r.ok ? { gguf: r.gguf, seconds: r.seconds, valLoss: r.valLoss, perplexity: r.perplexity } : { why: r.why }),
      };
      live.roles[role] = record.roles[role];
      write();
      console.log(
        m.name +
          ', ' +
          role +
          ': ' +
          (r.ok
            ? 'trained in ' + r.seconds + ' s, perplexity ' + JSON.stringify(r.perplexity)
            : 'NOT trained: ' + r.why),
      );
      if (r.ok) trained++;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'roles.json'), JSON.stringify(record, null, 1));
  }
  say(
    trained
      ? trained + ' adapters trained, one for each role that had enough examples'
      : 'No role had enough examples: no adapter was trained',
    'done',
  );
  process.exit(trained ? 0 : 3);
}
