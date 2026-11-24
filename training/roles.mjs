// roles.mjs - AN ADAPTER FOR EACH ROLE: pretraining that knows the arrangement. The swarm's small model does several jobs (it
// drafts, it checks, it writes the reply), each asked in its own words by its slot's brief. One adapter taught the larger
// model's answers to plain questions teaches none of those jobs as the swarm asks them. So:
//   1  DIAGNOSE. The train questions that carry a standard of their own are put to the swarm once, as it stands and without
//      adapters, and every slot's request is kept with its answer (src/index.mjs onAsk): what it was asked, in full
//   2  MARK. Each slot's answer is marked right or wrong as the reply is (measure.mjs slotReport: `same` on the trace)
//   3  EXAMPLES, BY ROLE (roleOf a stage: src/index.mjs ROLE_OF_STAGE). A slot's request with the answer it gave is an example
//      for its role where that answer was right: a draft or a check that had the answer; a reply written without changing a
//      right answer. What a role did when it worked, on exactly what it is asked. (What it should have said where it
//      failed is 3b.)
//   3b TAUGHT WHERE IT FAILED. The larger model is asked the very request of each slot whose answer was not right, and where
//      its answer is right it is an example for that role too (lessonsOf): what the role lacks, from the model it is trained toward
//   4  TRAIN. One adapter for each role that has enough examples (--min, 8), with MLX as adapters.mjs trains its one
//      (trainAdapter), kept beside the model's own adapter: <adapters>/<larger model>/<model>/roles/<role>/ and roles.json
// The swarm is then served with all of them on one load, each request naming its role's (src/index.mjs roleLoras), where the
// configuration serves adapters. Whether that is better is the evaluation's to say (evaluate.mjs --variant pretrained).
//   5  JUDGE. Each is served only where the module is better with it on held questions (rolesServed): a stage does no worse
//      than the one before
//   node training/roles.mjs train [--limit N] [--iters N] [--min N]     examplesOf and rolesServed are the pure parts, tested
//   node training/roles.mjs judge [--sample N]                          the adapters there are, judged again, none trained
import fs from 'node:fs';
import path from 'node:path';
import { ROLE_OF_STAGE } from '../src/index.mjs';

// WHICH ROLES' ADAPTERS ARE SERVED: A STAGE DOES NO WORSE THAN THE ONE BEFORE. An adapter that makes its own training answers
// likelier (trainAdapter's check) may still make the module worse: the first whole run lost 21 questions of 460 with three such
// adapters on. So each is JUDGED AS ANY CHANGE IS (classes.mjs worthKeeping): held questions are asked of the module without
// adapters, then with each role's alone; the roles that gained, best first, are added one at a time, each kept only where the
// module with it is better again than the module so far. None may pass, and the pretrained module is then the module as it was.
//   roles: [names]; ask(set) -> rows [{ counted }] of the module served with that set's adapters ([]: none);
//   gainOf(rows, than) -> { gain, error }; worth(g) -> boolean
// -> { served: [roles], rows, base, single: [{ role, without, with, gain, error, worth }], added: [{ role, gain, error, kept }] }
export async function rolesServed(roles, ask, gainOf, worth) {
  const count = (rows) => rows.filter((x) => x.counted).length;
  const base = await ask([]);
  const single = [];
  for (const role of roles) {
    const rows = await ask([role]);
    const g = gainOf(rows, base);
    // (and kind by kind, [without, with]: where an adapter gains and where it loses is what the next one is aimed by)
    const kinds = {};
    for (const [i, r] of rows.entries()) {
      if (r.kind === undefined) continue;
      const k = (kinds[r.kind] = kinds[r.kind] || [0, 0]);
      k[0] += base[i].counted ? 1 : 0;
      k[1] += r.counted ? 1 : 0;
    }
    single.push({
      role,
      rows,
      without: count(base),
      with: count(rows),
      gain: g.gain,
      error: g.error,
      worth: !!worth(g),
      ...(Object.keys(kinds).length ? { kinds } : {}),
    });
  }
  let served = [];
  let rows = base;
  const added = [];
  for (const x of single.filter((s) => s.worth).sort((a, b) => b.gain - a.gain)) {
    const next = served.length ? await ask([...served, x.role]) : x.rows;
    const g = served.length ? gainOf(next, rows) : { gain: x.gain, error: x.error };
    const kept = served.length ? !!worth(g) : true;
    added.push({ role: x.role, gain: g.gain, error: g.error, kept });
    if (kept) {
      served = [...served, x.role];
      rows = next;
    }
  }
  return { served, rows, base, single: single.map(({ rows: _, ...s }) => s), added };
}
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
// WHERE A ROLE FAILED, THE LARGER MODEL IS ASKED THE SLOT'S OWN REQUEST. What a role got right teaches it nothing it lacks (an
// adapter of such examples alone was judged on held questions and none was served, 2026-11-23). The module is trained toward
// the larger model, and the larger model can be asked anything a slot is asked: the brief, the question, the drafts a checker
// is shown, word for word. Its answer, where it is right by the question's own standard, is what that slot should have said.
//   lessonsOf(row, calls) -> [{ role, id, kind, member, slot, messages }]: each drafting or checking slot's request on this
//     question whose own answer was not right (wrong, or none). Not a writer's (it is right when it changes nothing, which is
//     no answer to learn), and not a request with a tool's call or result in it (asked without the tools it would be another
//     request). The very same request is one lesson.
//   pickLessons(lessons, most) -> at most `most`, kind by kind in turn: every kind the module is weak in gets some before
//     any gets many.
//   taughtBy(lesson, text) -> the example: the slot's request, answered as the larger model answered it.
export function lessonsOf(row, calls) {
  const out = [];
  const seen = new Set();
  for (const s of (row && row.trace) || []) {
    const role = ROLE_OF_STAGE[s.stage];
    if ((role !== 'draft' && role !== 'check') || s.same === true) continue;
    // (a slot that said nothing has a request too, and no text to find it by: its one request on this question)
    const all = (calls || []).filter((x) => x.slot === s.slot);
    const c = callOf(calls, s) || (all.length === 1 ? all[0] : null);
    if (!c || !Array.isArray(c.messages) || !c.messages.length) continue;
    if (c.messages.some((m) => m.role === 'tool' || Array.isArray(m.tool_calls))) continue;
    const key = role + '|' + JSON.stringify(c.messages);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, id: row.id, kind: row.kind, member: c.member, slot: s.slot, messages: c.messages });
  }
  return out;
}
export function pickLessons(lessons, most) {
  if (!(most > 0)) return [];
  const by = new Map();
  for (const l of lessons) by.set(l.kind, [...(by.get(l.kind) || []), l]);
  const out = [];
  for (let i = 0; out.length < most && [...by.values()].some((q) => q.length > i); i++)
    for (const q of by.values()) if (q[i] && out.length < most) out.push(q[i]);
  return out;
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
export const taughtBy = (lesson, text) => ({
  role: lesson.role,
  id: lesson.id,
  kind: lesson.kind,
  member: lesson.member,
  taught: true,
  messages: [...lesson.messages, { role: 'assistant', content: String(text) }],
});
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
  const cmd = process.argv[2];
  if (cmd !== 'train' && cmd !== 'judge') {
    console.log('node training/roles.mjs train [--limit N] [--iters N] [--min N] [--sample N] [--no-judge]');
    console.log(
      'node training/roles.mjs judge [--sample N]     which of the adapters there are is served, by held questions',
    );
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
  // 5  JUDGE: which of them the module is served with (rolesServed). Written into each model's roles.json (served, judged).
  // `node training/roles.mjs judge` judges the adapters there are, without training them again
  const judgeRoles = async () => {
    const { sampleOf, pairedGain, worthKeeping } = await import('./classes.mjs');
    const { ownStandard } = await import('./tasks.mjs');
    const leastGain = Number(
      (JSON.parse(fs.readFileSync(path.join(B.REPO_ROOT, 'training', 'policy.json'), 'utf8')).loop || {})
        .classMinGain || 0,
    );
    const held = sampleOf(
      B.questions('held').filter((t) => ownStandard(t) && !['open', 'talk'].includes(t.type)),
      Number(B.arg('sample', 72)),
    );
    const recordOf = (m) =>
      JSON.parse(fs.readFileSync(path.join(A.adapterDir(work, TARGET.id, m), 'roles.json'), 'utf8'));
    const roleNames = [
      ...new Set(
        can.flatMap((m) =>
          Object.entries(recordOf(m).roles)
            .filter(([, r]) => r.ok)
            .map(([k]) => k),
        ),
      ),
    ].sort();
    const ask = async (set) => {
      const swarm2 = await B.openSwarm(readBriefs(), {
        seed: 1,
        adapters: set.length > 0,
        lorasWith: () => ({}),
        roleLorasWith: (...a) =>
          Object.fromEntries(
            Object.entries(A.roleLorasFor(...a, { judging: true }))
              .map(([k, by]) => [k, Object.fromEntries(Object.entries(by).filter(([r]) => set.includes(r)))])
              .filter(([, by]) => Object.keys(by).length),
          ),
      });
      const out = [];
      try {
        for (const [i, t] of held.entries()) {
          if (i % 12 === 0)
            say(
              'Judging the adapters on held questions: ' +
                (set.length ? 'with ' + set.join(' and ') : 'without them') +
                ', question ' +
                (i + 1) +
                ' of ' +
                held.length,
              'judging',
            );
          const got = await B.askSwarm(swarm2, t, messagesOf(t));
          out.push({ id: t.id, kind: t.kind, counted: (await t.good(got.reply)).grade === 'right' });
        }
      } finally {
        await swarm2.stop();
      }
      return out;
    };
    const verdict = await rolesServed(roleNames, ask, pairedGain, (g) => worthKeeping(g, leastGain));
    const right = (rows) => rows.filter((x) => x.counted).length;
    for (const m of can) {
      const f = path.join(A.adapterDir(work, TARGET.id, m), 'roles.json');
      const rec = recordOf(m);
      for (const [k, r] of Object.entries(rec.roles)) if (r.ok) r.served = verdict.served.includes(k);
      rec.judged = {
        at: new Date().toISOString(),
        questions: held.length,
        without: right(verdict.base),
        with: right(verdict.rows),
        served: verdict.served,
        single: verdict.single,
        added: verdict.added,
      };
      fs.writeFileSync(f, JSON.stringify(rec, null, 1));
    }
    for (const s of verdict.single)
      console.log(
        'judged, ' +
          s.role +
          ': ' +
          s.without +
          ' of ' +
          held.length +
          ' held questions right without it, ' +
          s.with +
          ' with it (' +
          (s.gain * 100).toFixed(1) +
          ' points, paired error ' +
          (s.error * 100).toFixed(1) +
          '): ' +
          (verdict.served.includes(s.role) ? 'served' : 'not served'),
      );
    say(
      verdict.served.length
        ? 'Served with the adapter of: ' +
            verdict.served.join(', ') +
            ' (' +
            right(verdict.rows) +
            ' of ' +
            held.length +
            ' held questions right, ' +
            right(verdict.base) +
            ' without)'
        : 'No adapter made the module better on held questions: none is served, and the pretrained module is the module as configured',
      'done',
    );
  };
  if (cmd === 'judge') {
    await judgeRoles();
    process.exit(0);
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
  // (what the swarm takes in memory, measured while this step serves it: support/measure-memory.mjs watchMemory)
  const { watchMemory } = await import('./support/measure-memory.mjs');
  const { CONFIG_ID: MEM_CONFIG, footprintOf: memEstimate } = await import('../src/catalog.mjs');
  const memStop = watchMemory(swarm, {
    file: path.join(B.WORKC, 'memory.json'),
    config: MEM_CONFIG,
    target: (memEstimate() || {}).target,
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
    memStop();
    await swarm.stop();
  }
  // 3  EXAMPLES, by role
  const examples = rows.flatMap((r) => examplesOf(r, calls.get(r.id) || []));
  // 3b  TAUGHT WHERE IT FAILED (lessonsOf): the larger model is asked what each failing slot was asked, and its answer is an
  // example for that role where it is right by the question's own standard. --teach N: at most so many requests (0: none)
  const teachMost = B.has('no-teach') ? 0 : Number(B.arg('teach', 160));
  const lessons = pickLessons(
    rows.flatMap((r) => lessonsOf(r, calls.get(r.id) || [])),
    teachMost,
  );
  const teaching = { asked: 0, right: 0, kinds: {} };
  const missed = [];
  if (lessons.length) {
    const { finalOf } = await import('../src/read.mjs');
    const marker = readBriefs().marker;
    const big = await B.openAlone('target');
    try {
      for (const [i, l] of lessons.entries()) {
        if (i % 10 === 0)
          say(
            'Asking ' + TARGET.name + ' what the slots that failed were asked: ' + (i + 1) + ' of ' + lessons.length,
            'teaching',
          );
        const t = byId[l.id];
        let text = '';
        try {
          text = String((await big.ask(l.messages, { maxTokens: 900 })).text || '');
        } catch {
          text = '';
        }
        teaching.asked++;
        const k = (teaching.kinds[l.kind] = teaching.kinds[l.kind] || { asked: 0, right: 0 });
        k.asked++;
        let final = text ? finalOf(text, marker, t.type === 'code') : '';
        const rightBy = async (x) => {
          try {
            return !!x && ((await t.good(t.wrap(x), {})) || {}).grade === 'right';
          } catch {
            return false;
          }
        };
        let ok = await rightBy(final);
        // (it answered and did not close as the slot is told to: 174 of 366 answers not counted, 2026-11-23. Its last line,
        // where that is short and right, is the answer, and the example closes with it as a slot's answer must to be read)
        if (!ok && !final) {
          const last = closingLine(text);
          if (last && (await rightBy(last))) {
            final = last;
            text = text.trimEnd() + '\n\n' + marker + ' ' + last;
            ok = true;
          }
        }
        if (!ok) {
          // (what it said where it was not right, for a person to read: was it wrong, or not read?)
          missed.push({
            id: l.id,
            kind: l.kind,
            role: l.role,
            final: String(final).slice(0, 160),
            tail: text.slice(-240),
          });
          continue;
        }
        teaching.right++;
        k.right++;
        examples.push(taughtBy({ ...l, messages: l.messages.map(forTemplate) }, text));
      }
    } finally {
      await big.stop();
    }
    fs.mkdirSync(B.WORKC, { recursive: true });
    fs.writeFileSync(path.join(B.WORKC, 'taught-missed.json'), JSON.stringify(missed, null, 1));
    console.log(
      'taught where it failed: ' +
        TARGET.name +
        ' was asked ' +
        teaching.asked +
        " of the failing slots' own requests and was right on " +
        teaching.right +
        '; by kind: ' +
        Object.entries(teaching.kinds)
          .map(([k, v]) => k + ' ' + v.right + ' of ' + v.asked)
          .join(', '),
    );
  }
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
      teaching,
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
        taught: ex.filter((e) => e.taught).length,
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
  if (trained && !B.has('no-judge')) {
    await judgeRoles();
    // (the step ended well either way: a run carried on does not pretrain again because nothing passed)
    process.exit(0);
  }
  say(
    trained
      ? trained + ' adapters trained, one for each role that had enough examples'
      : 'No role had enough examples: no adapter was trained',
    'done',
  );
  process.exit(trained ? 0 : 3);
}
