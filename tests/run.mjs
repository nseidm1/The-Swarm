// run.mjs - THE MODULE, CHECKED WITHOUT A MODEL. Two stand-in servers answer as llama.cpp's server does, from a script each check
// sets: so what is checked is the swarm's own conduct (what goes in, what comes out, which slots ran, what happens when one
// fails), not how clever a model is. That is the trainers' business.
//   node tests/run.mjs
import { WORK_DIR } from './env.mjs'; // first: the trainers' working folder is the checks' own
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSwarm, serveSwarm, stopSwarms, ENTRY, MEMBERS, readBriefs } from '../src/index.mjs';
import { finalOf, plain, tally } from '../src/read.mjs';
import { tasks, KIND_NAMES } from '../training/tasks.mjs';
import { slotReport } from '../training/measure.mjs';

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tests-'));
let passed = 0;
const failed = [];
const check = (name, ok, detail) => {
  if (ok) passed++;
  else failed.push(name);
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok ? '' : '\n      ' + JSON.stringify(detail).slice(0, 700)));
};

// a stand-in for one model's server: `script(body)` says what it replies; it counts how many it holds at once
function standIn() {
  // tokens: what number the server gives a piece of text (a real server is asked what opens a tool call: /tokenize)
  const s = { script: () => 'ANSWER: 42', calls: [], now: 0, most: 0, delay: 30, down: false, tokens: {} };
  const server = http.createServer((req, res) => {
    if (req.url === '/health') return res.writeHead(s.down ? 503 : 200).end('{}');
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (req.url === '/tokenize') {
        const t = s.tokens[body.content];
        return res
          .writeHead(t ? 200 : 404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ tokens: t || [] }));
      }
      s.calls.push(body);
      s.now++;
      s.most = Math.max(s.most, s.now);
      await new Promise((r) => setTimeout(r, s.delay));
      s.now--;
      const out = s.script(body);
      if (out === null) return res.writeHead(500).end('{"error":"stand-in failure"}');
      if (body.tools)
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: body.tools[0].function.name, arguments: '{}' } },
                  ],
                },
              },
            ],
          }),
        );
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: out } }],
          usage: { completion_tokens: 5 },
        }),
      );
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ s, base: 'http://127.0.0.1:' + server.address().port, close: () => server.close() }),
    ),
  );
}
const lfm = await standIn();
const bonsai = await standIn();
const briefs = readBriefs();
const { PROBE_BRIEF } = await import('../src/behave.mjs');
// which slot a request is for, told from what it was told first (the slot that writes calls to try is not one of the plan's slots)
const roleOf = (body) =>
  briefs.slots.find((x) => body.messages[0].content.startsWith(x.brief)) ||
  (body.messages[0].content.startsWith(PROBE_BRIEF) ? { id: 'probe', stage: 'probe' } : undefined);
const reset = () => {
  for (const m of [lfm, bonsai])
    Object.assign(m.s, { calls: [], most: 0, now: 0, down: false, script: () => 'ANSWER: 42' });
};
const swarm = await createSwarm({ attach: { a: lfm.base, b: bonsai.base } });
const Q = [{ role: 'user', content: 'What is six times seven?' }];

// ---- 1: the black box
{
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'Six times seven is 42.' : 'six sevens\nANSWER: 42');
  const got = await swarm.answer(Q);
  check(
    'a message goes in and one reply comes out',
    got.ok && got.reply === 'Six times seven is 42.' && got.decided === '42',
    got,
  );
  const ran = got.trace.map((r) => r.slot);
  check(
    'when every draft reaches the same answer the checks are passed over, and the reply is written from it',
    got.path === 'agreed' &&
      ran.length === 5 &&
      ran.filter((x) => /direct|steps|other-way/.test(x)).length === 4 &&
      ran.includes('a-writer'),
    ran,
  );
}
// ---- 2: every slot of both models when the drafts disagree
{
  reset();
  lfm.s.delay = bonsai.s.delay = 60;
  lfm.s.script = (b) => {
    const r = roleOf(b);
    return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'ANSWER: 41' : 'work\nANSWER: 42';
  };
  bonsai.s.script = (b) => (roleOf(b).id === 'b-direct' ? 'ANSWER: 48' : 'because\nANSWER: 42');
  const got = await swarm.answer(Q);
  const ran = got.trace.map((r) => r.slot).sort();
  check(
    'when the drafts disagree every slot of the plan is used (four on one model, three on the other), and with no decision model named the answer most slots gave is the reply',
    ran.length === 7 &&
      briefs.slots.length === 7 &&
      !briefs.slots.some((x) => x.stage === 'judge') &&
      got.decided === '42' &&
      got.path === 'most' &&
      got.reply === 'It is 42.',
    { ran, path: got.path, decided: got.decided },
  );
  check(
    'a model never holds more conversations at once than it has slots, and the drafts do run side by side',
    lfm.s.most >= 2 && lfm.s.most <= 4 && bonsai.s.most >= 2 && bonsai.s.most <= 4,
    { a: lfm.s.most, b: bonsai.s.most },
  );
  const slotOf = {};
  for (const c of lfm.s.calls) (slotOf[roleOf(c).id] = slotOf[roleOf(c).id] || new Set()).add(c.id_slot);
  check(
    "each slot of the plan keeps to one of the server's slots, and no two share one",
    Object.values(slotOf).every((x) => x.size === 1) && new Set(Object.values(slotOf).map((x) => [...x][0])).size === 4,
    Object.fromEntries(Object.entries(slotOf).map(([k, v]) => [k, [...v]])),
  );
  const checker = bonsai.s.calls.find((c) => roleOf(c).id === 'b-recompute');
  const critic = lfm.s.calls.find((c) => roleOf(c).id === 'a-critic');
  const seen = (c) => c.messages[c.messages.length - 1].content;
  check(
    'a checker is shown the question and the lettered answers: the critic with their work, the one that puts answers back without it',
    /Answer A:/.test(seen(critic)) &&
      /work/.test(seen(critic)) &&
      /six times seven/.test(seen(checker)) &&
      /Its final answer: 41/.test(seen(checker)) &&
      !/\nwork\n/.test(seen(checker)),
    { critic: seen(critic).slice(0, 200), checker: seen(checker).slice(0, 200) },
  );
  check(
    'each model is asked with its own sampling, as its page says',
    lfm.s.calls[0].top_k === 50 &&
      lfm.s.calls[0].repeat_penalty === 1.1 &&
      bonsai.s.calls[0].presence_penalty === 1.5 &&
      lfm.s.calls.find((c) => roleOf(c).id === 'a-steps').temperature === 0.3,
    {},
  );
}
// ---- 3: failure
{
  reset();
  bonsai.s.script = () => null; // one model answers nothing
  lfm.s.script = (b) => {
    const r = roleOf(b);
    return r.stage === 'write'
      ? 'It is 42.'
      : r.id === 'a-direct'
        ? 'ANSWER: 41'
        : r.id === 'a-steps'
          ? 'ANSWER: 42'
          : 'A slips\nANSWER: 42';
  };
  const got = await swarm.answer(Q);
  check(
    'with one model failing the other carries on: no ruling, so the answer most slots gave stands',
    got.ok && got.path === 'most' && got.decided === '42' && got.reply === 'It is 42.',
    { path: got.path, decided: got.decided, reply: got.reply },
  );
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? null : 'six sevens are forty-two\nANSWER: 42');
  const un = await swarm.answer(Q);
  check(
    'with no reply written, the answer and its work are the reply',
    un.ok && /42$/.test(un.reply) && /six sevens/.test(un.reply) && /unwritten/.test(un.path),
    un.reply,
  );
  reset();
  lfm.s.script = bonsai.s.script = () => null;
  const none = await swarm.answer(Q);
  check(
    'with nothing answering, it says so and does not make a reply up',
    none.ok === false && none.reply === '',
    none,
  );
}
// ---- 4: the same thing as a server, in the place a llama.cpp model goes
{
  reset();
  lfm.s.script = (b) => (roleOf(b) && roleOf(b).stage === 'write' ? 'Forty-two.' : 'ANSWER: 42');
  const s = await swarm.serve();
  const post = (body) =>
    fetch(s.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const r = await (await post({ messages: Q })).json();
  const models = await (await fetch(s.base + '/v1/models')).json();
  const health = await fetch(s.base + '/health');
  check(
    'as a server it answers as a model server does: health, one model, and a chat completion',
    health.status === 200 &&
      models.data.length === 1 &&
      r.choices[0].message.content === 'Forty-two.' &&
      r.choices[0].finish_reason === 'stop' &&
      r.swarm.path === 'agreed',
    r,
  );
  const st = await (await post({ messages: Q, stream: true })).text();
  const pieces = st
    .split('\n\n')
    .filter((l) => l.startsWith('data: {'))
    .map((l) => JSON.parse(l.slice(6)).choices[0]);
  check(
    'asked to stream, the reply comes as events that add up to it and end as a stream ends',
    pieces.map((p) => p.delta.content || '').join('') === 'Forty-two.' &&
      pieces[pieces.length - 1].finish_reason === 'stop' &&
      /data: \[DONE\]/.test(st),
    st.slice(0, 300),
  );
  const before = lfm.s.calls.length + bonsai.s.calls.length;
  const tool = await (
    await post({ messages: Q, tools: [{ type: 'function', function: { name: 'look', parameters: {} } }] })
  ).json();
  check(
    'a request that carries tools goes to one model, untouched, and its tool call comes straight back',
    tool.choices[0].message.tool_calls[0].function.name === 'look' &&
      lfm.s.calls.length + bonsai.s.calls.length === before + 1 &&
      lfm.s.calls[lfm.s.calls.length - 1].tools.length === 1,
    tool,
  );
  bonsai.s.down = true;
  check('its health says so when a model stops answering', (await fetch(s.base + '/health')).status === 503, {});
  const bad = await post({ nothing: 1 });
  check('a request with no messages is refused, not answered', bad.status === 400, bad.status);
  await s.close();
}
// ---- 5: the slot it drops into
{
  const none = await serveSwarm(ENTRY, { file: '/nowhere/llama-server' }, { modelsDir: '/nowhere' });
  check(
    'started where a model is started, with no model files, it gives the reason back in the shape such a call gives',
    none.ok === false && /not here/.test(none.why),
    none,
  );
  reset();
  const up = await serveSwarm(ENTRY, {}, { attach: { a: lfm.base, b: bonsai.base } });
  const ok =
    up.ok &&
    typeof up.port === 'number' &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(up.base) &&
    typeof up.loadMs === 'number' &&
    typeof up.args === 'string';
  const r =
    ok &&
    (await (
      await fetch(up.base + '/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: Q }) })
    ).json());
  check(
    'started where a model is started, it gives back a port and an address that answers',
    ok && r.choices[0].message.content.length > 0,
    up,
  );
  await stopSwarms();
  check(
    'its entry for a list of models has what such an entry has, and its members are pinned (a revision, a size, a SHA-256)',
    ENTRY.id &&
      ENTRY.engine === 'swarm' &&
      ENTRY.memGb > 0 &&
      ENTRY.plain.length > 40 &&
      Object.values(MEMBERS).every(
        (m) =>
          /^[0-9a-f]{40}$/.test(m.rev) && m.bytes > 1e8 && /^[0-9a-f]{64}$/.test(m.sha256) && m.file.endsWith('.gguf'),
      ),
    ENTRY,
  );
}
// ---- 6: reading answers, and the questions
{
  check(
    'an answer is read from the last line that carries the marker, and two that read the same are the same',
    finalOf('ANSWER: 7\nno\n**ANSWER:** 4,200.0 apples') === '4,200.0 apples' &&
      plain('4,200.0 apples') === plain('$4200') &&
      plain('Tuesday.') === plain('the answer is tuesday') &&
      tally([
        { slot: 'a', final: '42' },
        { slot: 'b', final: '41' },
        { slot: 'c', final: '42.0' },
      ])[0].by.length === 2,
    [finalOf('x\nANSWER: 4'), plain('4,200.0 apples')],
  );
  const a = tasks({ split: 'train', each: 5 });
  const b = tasks({ split: 'train', each: 5 });
  const h = tasks({ split: 'held', each: 5 });
  check(
    'the questions are programming questions, made from a seed: the same again for the same split, others for the held split, every kind present (writing a function, correcting one, what one prints, what is wrong with one)',
    JSON.stringify(a.map((t) => t.ask)) === JSON.stringify(b.map((t) => t.ask)) &&
      a.some((t, i) => t.ask !== h[i].ask) &&
      new Set(a.map((t) => t.kind)).size === KIND_NAMES.length &&
      ['write-arrays', 'write-strings', 'write-numbers', 'write-parsing', 'fix', 'bug', 'trace'].every((k) =>
        KIND_NAMES.includes(k),
      ) &&
      a.filter((t) => t.type === 'code').length >= 20,
    KIND_NAMES,
  );
  // ---- the older kinds, whose answer is a value: read off a reply and compared as a value
  const { REASONING } = await import('../training/tasks.mjs');
  const vals = tasks({ split: 'train', each: 4, kinds: [...REASONING, 'trace'] }).concat(
    tasks({ split: 'held', each: 4, kinds: [...REASONING, 'trace'] }),
  );
  const wrongOf = (t) =>
    typeof t.want === 'number'
      ? String(t.want + 7)
      : t.kind === 'string'
        ? 'zzz'
        : t.kind === 'day'
          ? t.want === 'Monday'
            ? 'Friday'
            : 'Monday'
          : 'Zed';
  const off = vals.filter(
    (t) =>
      t.grade('Working it through.\nThe answer is ' + t.want + '.') !== 'right' ||
      t.grade(String(t.want)) !== 'right' ||
      t.grade('I think it is ' + wrongOf(t)) === 'right' ||
      t.grade('I could not work it out.') !== 'unsure' ||
      t.read('Working it through.\nThe answer is ' + t.want + '.') === '' ||
      t.read('I could not work it out.') !== '',
  );
  const v = vals.find((t) => typeof t.want === 'number');
  const other = String(v.want + 7);
  const eq = async (t, theirs, ours, ctx) => (await t.equivalent(theirs, ours, ctx)).grade;
  check(
    "where a value is asked for, the larger model's value is read off its reply, whatever it is, and another reply is equivalent when it gives that same value: a value that is wrong but is the larger model's counts as equivalent",
    off.length === 0 &&
      (await eq(v, 'I make it ' + other + '.', 'The answer is ' + other)) === 'right' &&
      (await eq(v, 'I make it ' + other + '.', 'The answer is ' + v.want)) === 'wrong' &&
      (await eq(v, 'I make it ' + other, 'No idea.')) === 'unsure' &&
      (await eq(v, 'No idea.', 'It is 4')) === 'noref',
    off.slice(0, 3).map((x) => [x.id, x.want]),
  );
  // ---- PARITY IS EQUIVALENT FUNCTION: two functions are equivalent when they do the same, however they are written
  const { FAMILIES } = await import('../training/tasks-code.mjs');
  const { outputsOf, codeOf, openEquivalent } = await import('../training/support/equivalent.mjs');
  const code = [...a, ...h].filter((t) => t.type === 'code');
  const block = (src) => 'Here it is.\n\n```js\n' + src + '\n```\n';
  const w = code.find((t) => t.name === 'sumEvery');
  const rewritten = w.ok
    .replace(/total/g, 'acc')
    .replace('function sumEvery(numbers) {', '// another way of writing it\nconst sumEvery = (numbers) => {');
  const differs = await w.equivalent(block(w.ok), block(w.ok.replace('+= numbers[i]', '+= numbers[i] + 1')));
  check(
    'two functions are equivalent when they return the same for every input, however differently they are written; they are not when one input parts them, and that input is kept',
    (await eq(w, block(w.ok), block(rewritten))) === 'right' &&
      differs.grade === 'wrong' &&
      Array.isArray(differs.input) &&
      differs.theirs !== differs.ours &&
      codeOf(block(rewritten)).startsWith('// another way'),
    differs,
  );
  check(
    'a reply with no function that runs gave no answer; when the larger model wrote none there is nothing to be equivalent to; and a function that never returns is stopped, not waited for',
    (await eq(w, block(w.ok), 'I would use a loop.')) === 'unsure' &&
      (await eq(w, block(w.ok), block('function other() { return 1; }'))) === 'unsure' &&
      (await eq(w, 'I would use a loop.', block(w.ok))) === 'noref' &&
      (await eq(w, block(w.ok), block('function sumEvery(numbers) { while (true) {} }'))) === 'wrong',
    w.id,
  );
  const mark = path.join(state, 'escaped.txt');
  const sly =
    "try { const p = this.constructor.constructor('return process')(); p.mainModule.require('fs').writeFileSync(" +
    JSON.stringify(mark) +
    ", 'x'); } catch (e) {}\ntry { require('fs').writeFileSync(" +
    JSON.stringify(mark) +
    ", 'x'); } catch (e) {}\nfunction sumEvery(numbers) { return 1; }";
  const slyOut = await outputsOf(sly, 'sumEvery', w.inputs);
  check(
    "a model's code is run where it can reach nothing: it cannot write a file, by require or by climbing out of where it runs",
    !fs.existsSync(mark) && (slyOut === null || slyOut.every((o) => o.v === '1')),
    slyOut && slyOut.slice(0, 2),
  );
  const probe =
    "function sumEvery(x) { const seen = []; try { seen.push(typeof process, typeof require, typeof fetch); } catch (e) { seen.push('threw'); } for (const climb of [() => this.constructor.constructor('return process')(), () => ({}).constructor.constructor('return process')(), () => eval('process')]) { try { seen.push(typeof climb()); } catch (e) { seen.push('blocked'); } } return seen; }";
  const probed = await outputsOf(probe, 'sumEvery', [[1]]);
  check(
    'and it has nothing of the process that runs it to reach: no process, no require, no network, and no way to make its way out to them',
    probed && probed[0].v === JSON.stringify(['undefined', 'undefined', 'undefined', 'blocked', 'blocked', 'blocked']),
    probed,
  );
  // every family: the function that does what is asked runs on every input, and the inputs tell it from the one with the flaw
  const seeded = (n) => {
    let x = n;
    return {
      int: (lo, hi) => lo + ((x = (x * 9301 + 49297) % 233280) % (hi - lo + 1)),
      pick: (l) => l[(x = (x * 9301 + 49297) % 233280) % l.length],
    };
  };
  const weak = [];
  for (let k = 0; k < FAMILIES.length; k++)
    for (const n of [3, 17]) {
      const fam = FAMILIES[k](seeded(n + k));
      const good = await outputsOf(fam.ok, fam.name, fam.inputs);
      const bad = await outputsOf(fam.bad, fam.name, fam.inputs);
      if (!good || good.some((o) => o.e) || !bad || !good.some((o, x) => o.v !== bad[x].v))
        weak.push(fam.name + '/' + n);
    }
  check(
    'every kind of function asked for can be written (one that does what is asked runs on every input), and the inputs tell it apart from the same function with one flaw',
    weak.length === 0 && FAMILIES.length >= 10,
    weak,
  );
  const fx = code.find((t) => t.kind === 'fix');
  check(
    'a function to be corrected is given with what it should do, and the correction is compared the same way: by running it',
    /it is wrong/.test(fx.ask) &&
      /```js\nfunction /.test(fx.ask) &&
      (await eq(fx, block(fx.ok), block(fx.ok))) === 'right',
    fx.ask.slice(0, 120),
  );
  // ---- an answer in words: a decision model says whether the two say the same thing
  const bug = [...a, ...h].find((t) => t.kind === 'bug');
  const kq = { calls: [], p: 0.9 };
  const ksrv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      kq.calls.push(JSON.parse(Buffer.concat(parts).toString('utf8')));
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ answers: { same: { type: 'noul', noul: kq.p } } }));
    });
  });
  await new Promise((ok) => ksrv.listen(0, '127.0.0.1', ok));
  const kev = 'http://127.0.0.1:' + ksrv.address().port;
  const yes = await eq(bug, 'It keeps the wrong occurrence.', 'The filter keeps the other occurrence of each value.', {
    kev,
  });
  kq.p = 0.1;
  const no = await eq(bug, 'It keeps the wrong occurrence.', 'The loop is off by one.', { kev });
  ksrv.close();
  check(
    'an answer in words cannot be run, so a decision model is asked one thing: do the two say fundamentally the same? With none to ask, the question is not compared, and with no answer given there is none',
    bug.type === 'open' &&
      /what is the bug/.test(bug.ask) &&
      yes === 'right' &&
      no === 'wrong' &&
      kq.calls[0].questions.same.type === 'noul' &&
      /It keeps the wrong occurrence/.test(kq.calls[0].state.first) &&
      /DATA/.test(kq.calls[0].state.guidance) &&
      (await eq(bug, 'x', 'y', {})) === 'noref' &&
      (await eq(bug, 'x', '', { kev })) === 'unsure' &&
      (await openEquivalent('q', '', 'y', { kev })).grade === 'noref',
    [yes, no],
  );
  // ---- marking a run, and each slot
  const { run: runRows, count } = await import('../training/support/bench.mjs');
  const [q1, q2, q3, q4] = code;
  const says = {
    [q1.id]: block(q1.ok.replace(/\n/g, '\n ')),
    [q2.id]: block(q2.ok.replace(/return /, 'return 0 && ')),
    [q3.id]: 'Not sure.',
    [q4.id]: block(q4.ok),
  };
  const rows = await runRows([q1, q2, q3, q4], async (q) => ({ reply: says[q.id] }), {
    ref: new Map([
      [q1.id, block(q1.ok)],
      [q2.id, block(q2.ok)],
      [q3.id, block(q3.ok)],
      [q4.id, 'I cannot write that.'],
    ]),
  });
  const c = count(rows);
  const self = await runRows([q1, q3], async (q) => ({ reply: says[q.id] }), { self: true });
  check(
    "every reply is marked against the larger model's reply: equivalent, different (with the input that parts them), no answer; a question the larger model gave no answer to is not counted; and the larger model is its own mark",
    rows.map((r) => r.grade).join() === 'right,wrong,unsure,noref' &&
      c.compared === 3 &&
      c.right === 1 &&
      rows[1].partsOn &&
      /function/.test(rows[0].ref) &&
      self[0].grade === 'right' &&
      self[1].grade === 'unsure',
    rows.map((r) => [r.grade, r.ref, r.partsOn]),
  );
  const trace = [
    { slot: 'd1', stage: 'draft', final: q1.ok.replace(/\n/g, '\n  '), ms: 5 },
    { slot: 'd2', stage: 'draft', final: 'function ' + q1.name + '() { return 7; }', ms: 5 },
    { slot: 'j', stage: 'decide', final: 'function ' + q1.name + '() { return 7; }', ms: 5 },
  ];
  const rep = await slotReport(
    [{ id: q1.id, refReply: block(q1.ok), grade: 'wrong', path: 'decided', decided: trace[2].final, trace }],
    { [q1.id]: q1 },
  );
  check(
    "each slot is marked the same way, and the mark is kept beside what it wrote: a draft equivalent to the larger model's that the decider passed over is counted as lost",
    rep.lost === 1 &&
      rep.slots.d1.right === 1 &&
      rep.slots.d2.right === 0 &&
      rep.slots.j.threwAway === 1 &&
      trace[0].same === true &&
      trace[1].same === false,
    rep,
  );
}
// ---- 6b: an answer that is code goes through the plan as code
{
  reset();
  const fn = 'function add(a, b) {\n  return a + b;\n}';
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write'
      ? 'Here is a tidier version:\n\n```js\nconst add = (a, b) => a + b + 0;\n```'
      : 'Adding the two.\n\n```js\n' + fn + '\n```';
  bonsai.s.script = () => 'It adds.\n\n```js\n' + fn.replace('  return', '  // the sum\n  return') + '\n```';
  const got = await swarm.answer([{ role: 'user', content: 'Write add(a, b).' }]);
  const asked = await swarm.answer([{ role: 'user', content: 'Write add(a, b).' }], {
    briefs: { ...briefs, plan: { ...briefs.plan, writeCode: true } },
  });
  check(
    "where the answer is code, a slot's answer is its last code block; drafts whose code reads the same but for comments and spacing agree; code goes out as it was settled with no slot asked to write it again; and where the plan does ask the writer, code it rewrote is put back",
    got.ok &&
      got.path === 'agreed' &&
      got.decided === fn &&
      got.reply === '```js\n' + fn + '\n```' &&
      !got.trace.some((r) => r.stage === 'write') &&
      got.trace.filter((r) => r.stage === 'draft').length === 4 &&
      asked.path === 'agreed+code-restored' &&
      asked.reply === got.reply &&
      asked.trace.some((r) => r.stage === 'write'),
    { path: got.path, reply: got.reply, asked: asked.path },
  );
  check(
    'a line that settles the answer after quoted code is the answer, not the code quoted',
    finalOf('Given:\n```js\nlet x = 1;\n```\nit prints 3.\nANSWER: 3') === '3' &&
      finalOf('ANSWER: see below\n```js\nlet x = 1;\n```') === 'let x = 1;',
    finalOf('a\n```js\nb\n```\nANSWER: 3'),
  );
}
// ---- 6c: what a real pass showed (2026-11-15): a writer that answers with a tool call, checkers that cannot write a function
// out again in one turn, a larger model whose reply is cut off, and a zero that is written -0
{
  const { isToolCall, letterOf } = await import('../src/read.mjs');
  const { codeWhole, codeEquivalent } = await import('../training/support/equivalent.mjs');
  reset();
  const good = 'function add(a, b) {\n  return a + b;\n}';
  const bad = 'function add(a, b) {\n  return a - b;\n}';
  const block = (c) => 'So:\n\n```js\n' + c + '\n```';
  const call =
    "<|tool_call_start|>[code_block(code='" + good.replace(/\n/g, '\\n') + "', max_length=100)]<|tool_call_end|>";
  // the drafts disagree (A is right, B, C and D share a slip); both checkers say A, by its letter alone; the writer calls a tool
  lfm.s.script = (b) => {
    const r = roleOf(b);
    return r.stage === 'write'
      ? call
      : r.stage === 'check'
        ? 'A adds. B, C and D subtract.\nANSWER: A'
        : r.id === 'a-direct'
          ? block(good)
          : block(bad);
  };
  bonsai.s.script = (b) =>
    roleOf(b).stage === 'check' ? 'Quoting B:\n```js\n' + bad + '\n```\nOnly A holds.\n**ANSWER: (A)**' : block(bad);
  // (the plan here asks the writer to write code out, which by itself it no longer does)
  const got = await swarm.answer([{ role: 'user', content: 'Write add(a, b).' }], {
    briefs: { ...briefs, plan: { ...briefs.plan, writeCode: true } },
  });
  const checks = got.trace.filter((r) => r.stage === 'check');
  check(
    'a writer that answers with a call to a tool is not taken for a reply: what was settled goes out as it stands, and the path says so',
    got.ok &&
      !isToolCall(got.reply) &&
      /^```js\n/.test(got.reply) &&
      /tool-call/.test(got.path) &&
      isToolCall(call) &&
      !isToolCall('It is 42.') &&
      isToolCall('{"name": "run", "arguments": {}}'),
    { path: got.path, reply: got.reply.slice(0, 120) },
  );
  check(
    'a checker may name the answer it finds correct by its letter, and that counts as that answer whole, though it quoted other code on the way; where the answers are themselves letters a letter is an answer',
    checks.length === 2 &&
      checks.every((c) => c.ok && c.picked === 'A' && c.final === good) &&
      letterOf('x\nANSWER: b.') === 'B' &&
      letterOf('ANSWER: 42') === '' &&
      letterOf('ANSWER: Z') === '' &&
      letterOf('no line') === '' &&
      briefs.slots.filter((x) => x.stage === 'check').every((x) => /its letter/.test(x.brief)),
    checks.map((c) => [c.slot, c.ok, c.picked, c.final.slice(0, 30)]),
  );
  // (with no decision model the answer most slots gave stands: three drafts and no checker for the slip, one draft and both checkers for A)
  check(
    'the checkers that named A by letter are counted with the draft that wrote it',
    got.trace.filter((r) => !['probe', 'run'].includes(r.stage)).length === 7 &&
      typeof got.decided === 'string' &&
      [good, bad].includes(got.decided),
    { decided: got.decided, path: got.path },
  );
  // a reply cut off partway through its function is no answer, and nothing is compared with it
  const cut = '```js\nfunction add(a, b) {\n  const n = 5;';
  const code = tasks({ split: 'held', each: 1 }).find((t) => t.type === 'code');
  const open = tasks({ split: 'held', each: 1 }).find((t) => t.type === 'open');
  const value = tasks({ split: 'held', each: 1 }).find((t) => t.type === 'value');
  const { run: runRows } = await import('../training/support/bench.mjs');
  const whole = '```js\n' + code.ok + '\n```';
  const cutReply = whole.slice(0, Math.floor(whole.length / 2));
  const own = await runRows(
    [code, code],
    (() => {
      let i = 0;
      return async () => ({ reply: i++ ? cutReply : whole });
    })(),
    { self: true, who: 'target' },
  );
  const against = await runRows([code], async () => ({ reply: whole }), {
    ref: new Map([[code.id, cutReply]]),
    who: 'a',
  });
  check(
    "the larger model's reply is the mark only where it holds an answer: a function cut off partway is code and is no answer, a sentence cut off after a word is none, and a question it gave none to is not compared for anyone",
    codeWhole(block(good), 'add') &&
      !codeWhole(cut, 'add') &&
      !codeWhole(block(good), 'sub') &&
      !codeWhole('no code here', 'add') &&
      code.usable(whole) &&
      !code.usable(cutReply) &&
      open &&
      !open.usable('The') &&
      open.usable('The loop starts at one, so the first item is never counted.') &&
      value &&
      !value.usable('') &&
      own[0].grade === 'right' &&
      own[1].grade === 'unsure' &&
      against[0].grade === 'noref',
    { own: own.map((r) => r.grade), against: against[0].grade },
  );
  const z = await codeEquivalent(
    block('function z(n) {\n  return n * 0;\n}'),
    block('function z(n) {\n  return 0;\n}'),
    { name: 'z', inputs: [[-1], [3]] },
  );
  const nz = await codeEquivalent(block('function z(n) {\n  return 1;\n}'), block('function z(n) {\n  return 0;\n}'), {
    name: 'z',
    inputs: [[-1]],
  });
  check(
    'a zero written -0 is the same number as 0, and a different number is still different',
    z.grade === 'right' && nz.grade === 'wrong',
    { z, nz },
  );
}
// ---- 6d: DRAFTS OF CODE ARE ONE ANSWER WHEN THEY DO THE SAME, not when they read the same
{
  const { nameOf, callsIn, behaviours } = await import('../src/behave.mjs');
  const { codeOf } = await import('../training/support/equivalent.mjs');
  const fenced = (c) => 'So:\n\n```js\n' + c + '\n```';
  const CALLS = 'Here are the calls:\n1. `add(1, 2)`\nadd(0, 0)\nadd(-3, 5)\nadd(2.5, 1)\nadd(7, 7)';
  const W = [{ role: 'user', content: 'Write a JavaScript function add(a, b) that returns the sum.' }];
  // four drafts written four ways that all add
  reset();
  const ways = {
    'a-direct': 'function add(a, b) {\n  return a + b;\n}',
    'a-steps': 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}',
    'b-direct': 'const add = (x, y) => y + x;',
    'b-other-way': 'function add(a, b) {\n  return b - -a;\n}',
  };
  lfm.s.script = (b) => fenced(ways[roleOf(b).id] || ways['a-direct']);
  bonsai.s.script = (b) => (roleOf(b).stage === 'probe' ? CALLS : fenced(ways[roleOf(b).id] || ways['b-direct']));
  const same = await swarm.answer(W);
  check(
    'four drafts of a function written four different ways, that do the same on the calls tried, are one answer: agreed, with no check, no decision and no writer, and what was tried is in the trace',
    same.ok &&
      same.path === 'agreed' &&
      same.tried &&
      same.tried.groups.length === 1 &&
      same.tried.calls.length === 5 &&
      !same.trace.some((r) => ['check', 'decide', 'write'].includes(r.stage)) &&
      same.trace.find((r) => r.stage === 'run').ok &&
      /they all do the same/.test(same.trace.find((r) => r.stage === 'run').out) &&
      same.reply === '```js\n' + ways['a-direct'] + '\n```',
    { path: same.path, tried: same.tried, run: same.trace.find((r) => r.stage === 'run') },
  );
  // one adds, two subtract in different words, one does not parse; the checkers run out of room and are asked for a letter
  reset();
  const bad1 = 'function add(a, b) {\n  return a - b;\n}';
  const bad2 = 'const add = (a, b) => a - b;';
  const broken = 'function add(a, b) {\n  return a - ;\n}';
  const seenBy = [];
  const checker = (b) => {
    const last = b.messages[b.messages.length - 1].content;
    if (/ran out of room/.test(last)) return 'ANSWER: A';
    seenBy.push(last);
    return 'Let me take each in turn. Answer A adds the two numbers. Answer B ... and so on, at length, without ever getting to a last line';
  };
  lfm.s.script = (b) =>
    roleOf(b).stage === 'check' ? checker(b) : fenced(roleOf(b).id === 'a-direct' ? ways['a-direct'] : bad1);
  bonsai.s.script = (b) =>
    roleOf(b).stage === 'probe'
      ? CALLS
      : roleOf(b).stage === 'check'
        ? checker(b)
        : fenced(roleOf(b).id === 'b-direct' ? bad2 : broken);
  const split = await swarm.answer(W);
  const cks = split.trace.filter((r) => r.stage === 'check');
  check(
    'drafts that do different things are different answers however alike they read, drafts that do the same are one however different, and a draft that does not run is none: the checkers are shown one answer for each behaviour and the calls on which they part',
    split.tried &&
      split.tried.groups.length === 2 &&
      split.tried.groups[0].join() === 'A' &&
      split.tried.groups[1].join() === 'B,C' &&
      /D did not run/.test(split.trace.find((r) => r.stage === 'run').out) &&
      seenBy.length === 2 &&
      seenBy.every(
        (t) =>
          /Answer A:/.test(t) &&
          /Answer B:/.test(t) &&
          !/Answer C:/.test(t) &&
          !/Answer D:/.test(t) &&
          /different results on:\nadd\(1, 2\) {2}-> {2}A: 3 {3}B: -1/.test(t),
      ),
    { groups: split.tried && split.tried.groups, shown: (seenBy[0] || '').slice(-200) },
  );
  check(
    'a checker that ran out of room before it answered is asked for its answer in one line, on the same slot, and its letter counts as that answer; the answer the most slots hold by behaviour stands, and code goes out as it was settled',
    cks.length === 2 &&
      cks.every((c) => c.ok && c.concluded && c.picked === 'A' && c.final === ways['a-direct']) &&
      split.decided === ways['a-direct'] &&
      split.path === 'most' &&
      split.reply === '```js\n' + ways['a-direct'] + '\n```' &&
      !split.trace.some((r) => r.stage === 'write'),
    { cks: cks.map((c) => [c.slot, c.ok, c.concluded, c.picked]), path: split.path },
  );
  // told not to run anything, it runs nothing
  const plainSwarm = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, runCode: false });
  reset();
  lfm.s.script = (b) => fenced(ways[roleOf(b).id] || ways['a-direct']);
  bonsai.s.script = (b) => fenced(ways[roleOf(b).id] || ways['b-direct']);
  const off = await plainSwarm.answer(W);
  await plainSwarm.stop();
  check(
    'told not to run code (runCode: false, or SWARM_RUN_CODE=0) the swarm runs nothing a model wrote and asks for no calls: drafts are compared as text, as before',
    off.ok &&
      off.tried === null &&
      !off.trace.some((r) => ['probe', 'run'].includes(r.stage)) &&
      off.path !== 'agreed' &&
      lfm.s.calls.concat(bonsai.s.calls).every((c) => !c.messages[0].content.startsWith(PROBE_BRIEF)),
    { path: off.path },
  );
  // reading the calls a slot wrote, and the function the drafts define
  const read = callsIn(
    '1. `add(1, 2)`\nadd(x, 2)\nadd([1, [2]], { a: 1 })\nadd("a)", 1) // text\nfoo(1)\nadd(evil(), 1)\nadd(1, 2)\nadd(3,\nconsole.log(add(true, null));',
    'add',
  );
  const none = await behaviours({
    question: 'q',
    drafts: [
      { letter: 'A', final: ways['a-direct'] },
      { letter: 'B', final: bad1 },
    ],
    probeText: 'no calls here',
  });
  const two = await behaviours({
    question: 'q',
    drafts: [
      { letter: 'A', final: ways['a-direct'] },
      { letter: 'B', final: bad1 },
    ],
    probeText: CALLS,
  });
  check(
    'the calls to try are read from what a slot wrote: whole calls to the function, with literal arguments only, each once; with too few to go on nothing is run; and a call on which two drafts part is named with what each gave',
    read.join(' | ') === 'add(1, 2) | add([1, [2]], { a: 1 }) | add("a)", 1) | add(true, null)' &&
      nameOf([ways['a-direct'], bad2, 'function helper() {}\nfunction add(a, b) {}'], 'Write add') === 'add' &&
      none === null &&
      two &&
      two.groups.length === 2 &&
      /add\(0, 0\)/.test(two.differ([two.by.A, two.by.B], { as: ['A', 'B'] })) === false &&
      /add\(1, 2\) {2}-> {2}A: 3 {3}B: -1/.test(two.differ([two.by.A, two.by.B], { as: ['A', 'B'] })) &&
      (await two.sigOf(ways['b-direct'])) === two.by.A &&
      (await two.sigOf(broken)) === '',
    { read, differ: two && two.differ([two.by.A, two.by.B], { as: ['A', 'B'] }) },
  );
  // a reply that gives the function and then shows it in use
  const withExample =
    'Here it is:\n\n```js\n' +
    ways['a-direct'] +
    '\n```\n\nFor example:\n\n```js\nconsole.log(add(1, 2)); // 3\n```\n\nIt adds.';
  check(
    'the code in a reply is the block that defines the function, not a block after it that only shows it in use: for a slot inside the swarm and for the grader alike',
    finalOf(withExample, 'ANSWER:', true) === ways['a-direct'] &&
      codeOf(withExample, 'add') === ways['a-direct'] &&
      codeOf(withExample) === ways['a-direct'] &&
      codeOf('```js\nfunction helper() {}\n```\n```js\nlet x = 1;\n```', 'add') === 'function helper() {}' &&
      codeOf('```\nlet x = 1;\n```') === 'let x = 1;',
    finalOf(withExample, 'ANSWER:', true),
  );
}
// ---- 6e: THE FLOW: the order of steps is part of the arrangement, and is not fixed
{
  const { flowOf, DEFAULT_FLOW } = await import('../src/orchestrate.mjs');
  const { steps, flowMoves, shapeOf } = await import('../training/arrange.mjs');
  const withFlow = (flow, more = {}) => ({ ...briefs, ...more, flow });
  const lastOf = (b) => b.messages[b.messages.length - 1].content;
  const revising = (b) => /Weigh them/.test(lastOf(b));
  // the answers go back to those who wrote them, who then agree
  reset();
  const back = [];
  lfm.s.script = (b) => {
    const r = roleOf(b);
    if (r.stage === 'write') return 'It is 42.';
    if (revising(b)) return (back.push([r.id, lastOf(b)]), 'On reflection.\nANSWER: 42');
    return r.id === 'a-direct' ? 'ANSWER: 41' : 'work\nANSWER: 42';
  };
  bonsai.s.script = (b) => {
    const r = roleOf(b);
    if (revising(b)) return (back.push([r.id, lastOf(b)]), 'ANSWER: 42');
    return r.id === 'b-direct'
      ? 'ANSWER: 48'
      : r.stage === 'check'
        ? 'A slips at the first line.\nANSWER: 42'
        : 'because\nANSWER: 42';
  };
  const once = await swarm.answer(Q, {
    briefs: withFlow([{ do: 'draft' }, { do: 'check' }, { do: 'revise' }, { do: 'decide' }, { do: 'write' }]),
  });
  const mine = back.find(([id]) => id === 'a-direct');
  check(
    'a flow can send the answers back to the slots that wrote them: each is shown the different answers, which was its own and what the checkers said, and answers again; when they then agree nothing is left to decide',
    once.ok &&
      once.path === 'converged' &&
      once.decided === '42' &&
      once.reply === 'It is 42.' &&
      once.trace.filter((r) => r.stage === 'revise').length === 4 &&
      back.length === 4 &&
      mine &&
      /Yours was Answer A\./.test(mine[1]) &&
      /What those who checked them said/.test(mine[1]) &&
      /A slips at the first line/.test(mine[1]) &&
      !once.trace.some((r) => r.stage === 'decide'),
    { path: once.path, revise: once.trace.filter((r) => r.stage === 'revise').length },
  );
  // a loop: check and revise again while the answers differ
  reset();
  let rounds = 0;
  lfm.s.script = (b) => {
    const r = roleOf(b);
    if (r.stage === 'write') return 'It is 42.';
    if (revising(b)) return r.id === 'a-direct' && rounds < 4 ? (rounds++, 'ANSWER: 41') : (rounds++, 'ANSWER: 42');
    return r.id === 'a-direct' ? 'ANSWER: 41' : 'ANSWER: 42';
  };
  bonsai.s.script = (b) => (revising(b) ? (rounds++, 'ANSWER: 42') : 'ANSWER: 42');
  const loop = [
    { do: 'draft' },
    { do: 'repeat', upTo: 3, steps: [{ do: 'check' }, { do: 'revise' }] },
    { do: 'decide' },
    { do: 'write' },
  ];
  const looped = await swarm.answer(Q, { briefs: withFlow(loop) });
  const rv = looped.trace.filter((r) => r.stage === 'revise');
  check(
    'a flow can loop: its steps are done again while the answers still differ, each round marked, and no more once they are the same',
    looped.ok &&
      looped.path === 'converged' &&
      rv.length === 8 &&
      rv.filter((r) => r.round === 1).length === 4 &&
      rv.filter((r) => r.round === 2).length === 4 &&
      !rv.some((r) => r.round === 3) &&
      looped.trace.filter((r) => r.stage === 'check').length === 4,
    { path: looped.path, rounds: rv.map((r) => r.round) },
  );
  // more than one decision: the likeliest two are kept, checked again, and then one is picked
  reset();
  const seenCheck = [];
  lfm.s.script = (b) => {
    const r = roleOf(b);
    if (r.stage === 'check') return (seenCheck.push(lastOf(b)), 'ANSWER: 42');
    return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'ANSWER: 41' : 'ANSWER: 42';
  };
  bonsai.s.script = (b) => {
    const r = roleOf(b);
    if (r.stage === 'check') return (seenCheck.push(lastOf(b)), 'ANSWER: 42');
    return r.id === 'b-direct' ? 'ANSWER: 48' : 'ANSWER: 42';
  };
  const asked = [];
  const judge = async ({ question, answers }) => {
    asked.push({ question, finals: answers.map((x) => x.final) });
    // the first time it leans to 48, then 42, with 41 last; asked again of the two it picks 42
    const probs = Object.fromEntries(
      answers.map((x) => [
        x.letter,
        x.final === '48' ? 0.45 : x.final === '42' ? (answers.length === 2 ? 0.7 : 0.4) : 0.15,
      ]),
    );
    const top = answers.slice().sort((x, y) => probs[y.letter] - probs[x.letter])[0];
    return { ok: true, letter: top.letter, final: top.final, probs, ms: 1 };
  };
  const judged = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, decide: judge });
  const twice = await judged.answer(Q, {
    briefs: withFlow([{ do: 'draft' }, { do: 'decide', keep: 2 }, { do: 'check' }, { do: 'decide' }, { do: 'write' }]),
  });
  check(
    'a flow can hold more than one decision: the first keeps the likeliest two answers and settles nothing, the checkers are then shown only those two, and the second picks between them',
    twice.ok &&
      asked.length === 2 &&
      asked[0].finals.join() === '41,42,48' &&
      asked[1].finals.join() === '42,48' &&
      twice.decided === '42' &&
      /narrowed/.test(twice.path) &&
      seenCheck.length === 2 &&
      seenCheck.every(
        (t) => !/Its final answer: 41/.test(t) && /Its final answer: 42/.test(t) && /Its final answer: 48/.test(t),
      ) &&
      twice.trace.filter((r) => r.stage === 'decide').length === 2 &&
      /Kept the 2 likeliest/.test(twice.trace.find((r) => r.stage === 'decide').out),
    { asked, path: twice.path },
  );
  // more than one reply written, and the decider picks
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'The product is 42.' : 'ANSWER: 42');
  bonsai.s.script = (b) =>
    roleOf(b) && roleOf(b).stage === 'write' ? 'It is 42, since six sevens are 42.' : 'ANSWER: 42';
  const writerB = { ...briefs.slots.find((x) => x.stage === 'write'), id: 'b-writer', member: 'b' };
  const pickReply = async ({ question, answers }) =>
    /Which reply/.test(question)
      ? { ok: true, letter: 'B', final: answers[1].final, probs: { A: 0.3, B: 0.7 }, ms: 1 }
      : judge({ question, answers });
  const two = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, decide: pickReply });
  const wrote = await two.answer(Q, { briefs: { ...briefs, slots: [...briefs.slots, writerB] } });
  await two.stop();
  await judged.stop();
  check(
    'where more than one slot writes the reply, every reply is written and the decider picks which one is sent',
    wrote.ok &&
      wrote.trace.filter((r) => r.stage === 'write').length === 2 &&
      wrote.reply === 'It is 42, since six sevens are 42.' &&
      /\+picked/.test(wrote.path) &&
      wrote.path.startsWith('agreed'),
    { path: wrote.path, reply: wrote.reply },
  );
  // the arrangement search can change the flow, one step at a time, and from there again
  const names = (b) => flowMoves(b).map((c) => c.name);
  const first = flowMoves(briefs);
  const loopMove = first.find((c) => /check and revise again/.test(c.name));
  const second = flowMoves(loopMove.briefs);
  const all = steps(briefs);
  check(
    'the search over arrangements reaches the flow: answers sent back, a loop, a decision that narrows first, a step taken out, a second writer; from a flow it has kept it goes on (a longer loop, the loop undone, back to the plain flow); and a flow is part of what makes two arrangements different',
    flowOf(briefs) === DEFAULT_FLOW &&
      names(briefs).length === 8 &&
      names(briefs).some((n) => /what each call should give/.test(n)) &&
      names(briefs).some((n) => /straight after the draft/.test(n)) &&
      names(briefs).some((n) => /the check before the try/.test(n)) &&
      names(briefs).some((n) => /go back to the drafters/.test(n)) &&
      names(briefs).some((n) => /decide twice/.test(n)) &&
      names(briefs).some((n) => /no check/.test(n)) &&
      !names(briefs).some((n) => /plain one/.test(n)) &&
      second.some((c) => /3 times at most/.test(c.name) && c.briefs.flow.find((x) => x.do === 'repeat').upTo === 3) &&
      second.some(
        (c) => /undone/.test(c.name) && c.briefs.flow.map((x) => x.do).join() === 'draft,try,check,revise,decide,write',
      ) &&
      second.some((c) => /plain one/.test(c.name) && c.briefs.flow === undefined) &&
      shapeOf(loopMove.briefs) !== shapeOf(briefs) &&
      all.some((c) => /add a second a-writer on b/.test(c.name)) &&
      all.filter((c) => /^flow: /.test(c.name)).length === 8 &&
      all.some(
        (c) =>
          /a-steps checks instead of drafting/.test(c.name) &&
          c.briefs.slots.find((x) => x.id === 'a-steps').stage === 'check',
      ) &&
      all.some((c) => /b-recompute drafts instead of checking/.test(c.name)) &&
      /^flow: /.test(all[0].name) &&
      first.every((c) => c.briefs.flow[0].do === 'draft'),
    { first: names(briefs), second: second.map((c) => c.name) },
  );
}
// ---- 6f: WHAT ONE SWARM HAS LEARNED is kept for that swarm, with the proof of each thing
{
  const {
    readLearned,
    saveLearned,
    notePass,
    learnedFile,
    LEARNED_DIR,
    readBriefs: readNow,
    BRIEFS_FILE,
  } = await import('../src/index.mjs');
  const base = JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8'));
  const before = readNow();
  const noneYet = readLearned();
  const better = {
    ...base,
    version: 2,
    slots: base.slots.map((x) => (x.id === 'a-critic' ? { ...x, brief: 'A better brief.' } : x)),
  };
  const ev = {
    train: { before: { right: 10, wrong: 8 }, after: { right: 12, wrong: 6 } },
    held: { before: { right: 5, wrong: 7 }, after: { right: 5, wrong: 7 } },
  };
  saveLearned(better, {
    pass: 1,
    kind: 'brief',
    slot: 'a-critic',
    what: 'a better brief',
    from: '2601.00001',
    why: 'higher on train, not lower on held',
    ...ev,
  });
  const grown = {
    ...better,
    version: 3,
    flow: [{ do: 'draft' }, { do: 'check' }, { do: 'revise' }, { do: 'decide' }, { do: 'write' }],
  };
  saveLearned(grown, {
    pass: 2,
    kind: 'flow',
    what: 'the answers go back to the drafters after the check',
    why: 'higher on train, not lower on held',
    ...ev,
  });
  notePass({ pass: 2, at: '2026-11-15', equivalent: 9, compared: 12, level: false }, grown);
  const mine = readLearned();
  // another pair of small models, or another larger model, has learned nothing of this
  const other = readLearned('some+other+pair', 'another-target');
  saveLearned(
    base,
    { pass: 1, kind: 'plan', what: 'x', ...ev },
    { config: 'some+other+pair', target: 'another-target' },
  );
  // a file half written: the last good copy
  fs.writeFileSync(learnedFile(), '{"briefs": {"slots": [');
  const afterCrash = readLearned();
  check(
    'what a swarm learns is kept for that configuration against that larger model, apart from every other: the arrangement as it now stands is what it runs, each kept change is on its ledger in order with the evidence it was kept on, where each pass left it is beside them, and a file half written is read from its last good copy',
    noneYet === null &&
      before.version === base.version &&
      !before.flow &&
      mine.ledger.length === 2 &&
      mine.ledger[0].n === 1 &&
      mine.ledger[1].kind === 'flow' &&
      mine.ledger[0].from === '2601.00001' &&
      mine.ledger[0].train.after.right === 12 &&
      typeof mine.ledger[0].at === 'string' &&
      mine.passes.length === 1 &&
      mine.passes[0].equivalent === 9 &&
      readNow().version === 3 &&
      readNow().flow.length === 5 &&
      other === null &&
      readLearned('some+other+pair', 'another-target').ledger.length === 1 &&
      readLearned().ledger.length === 2 &&
      afterCrash &&
      afterCrash.ledger.length === 2 &&
      LEARNED_DIR.startsWith(WORK_DIR) &&
      readNow(BRIEFS_FILE).version === base.version,
    { ledger: mine.ledger.map((x) => [x.n, x.kind, x.what]), dir: LEARNED_DIR },
  );
  // put back: the checks after this one start from briefs.json, as the ones before did
  fs.rmSync(LEARNED_DIR, { recursive: true, force: true });
}
// ---- 6g: WHAT A CONFIGURATION REMEMBERS OF ITS TRAINING is its own; what was read is everyone's
{
  const { readState, writeState, seedState, stateFileOf, STATES_DIR, STATE_FILE } =
    await import('../training/state.mjs');
  const { TARGET } = await import('../src/catalog.mjs');
  const start = readState();
  const idea = { pass: 1, from: '2601.00001', slot: 'a-critic', name: 'an idea', hash: 'h1' };
  writeState({
    ...start,
    pass: 3,
    tried: { 'a-critic': ['x', 'y'], _arrangement: ['s1'] },
    order: ['a-critic'],
    history: [{ pass: 3 }],
    seen: ['2601.00001'],
    ideas: [
      { ...idea, status: 'dropped' },
      { ...idea, hash: 'h2', status: 'open' },
    ],
  });
  const mine = readState();
  const shared = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  // the same folder, another larger model: nothing tried, the same reading
  const otherFile = stateFileOf('another-target');
  const seeded = seedState('another-target', { seeds: { train: 5, held: 6 }, tried: {}, order: [], history: [] });
  const again = seedState('another-target', { seeds: { train: 9, held: 9 } });
  const other = JSON.parse(fs.readFileSync(otherFile, 'utf8'));
  check(
    'what a configuration remembers of its training is kept for that configuration against that larger model (which pass it is, what was tried and not kept, the order of slots, how each pass ended, what became of each idea), while what was read is kept once for all; another target starts with nothing tried and is not written over once it has a record',
    start.pass === 0 &&
      mine.pass === 3 &&
      mine.tried['a-critic'].length === 2 &&
      mine.history.length === 1 &&
      mine.ideas.length === 2 &&
      mine.ideas[0].status === 'dropped' &&
      mine.ideas[1].status === 'open' &&
      shared.pass === undefined &&
      shared.tried === undefined &&
      shared.seen.join() === '2601.00001' &&
      shared.ideas.length === 2 &&
      shared.ideas[0].status === undefined &&
      fs.existsSync(stateFileOf(TARGET.id)) &&
      seeded === true &&
      again === false &&
      other.pass === 0 &&
      other.seeds.held === 6 &&
      Object.keys(other.tried).length === 0 &&
      STATES_DIR.startsWith(WORK_DIR) &&
      STATE_FILE.startsWith(WORK_DIR),
    { mine: { pass: mine.pass, ideas: mine.ideas.map((i) => i.status) }, shared: Object.keys(shared) },
  );
  // put back: the checks after this one find no record, as the ones before did
  fs.rmSync(STATES_DIR, { recursive: true, force: true });
  fs.rmSync(STATE_FILE, { force: true });
  fs.rmSync(STATE_FILE + '.bak', { force: true });
}
// ---- 6h: what a real pass showed the second time (2026-11-15): a model that cannot be left able to call a tool, drafts cut off,
// a measurement that moved by itself, and a rule for keeping a change that judged by less than that
{
  const { expectedIn } = await import('../src/behave.mjs');
  const { paired } = await import('../training/support/bench.mjs');
  // the token that opens a tool call is found once and forbidden in every request; a seed makes the same slot draw the same
  reset();
  lfm.s.tokens = { '<|tool_call_start|>': [64400], '<tool_call>': [9, 9] };
  const seeded = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, seed: 7 });
  await seeded.answer(Q);
  await seeded.answer(Q);
  const mineCalls = lfm.s.calls.filter((c) => roleOf(c) && roleOf(c).id === 'a-direct');
  const otherCalls = lfm.s.calls.filter((c) => roleOf(c) && roleOf(c).id === 'a-steps');
  await seeded.stop();
  check(
    'a model that has a token for opening a tool call is not left able to use it (the server is asked for its number once, and it is forbidden in every request; a marker that is more than one token is left alone); and with a seed the same slot asked the same thing is asked to draw the same, each slot its own',
    lfm.s.calls.every((c) => JSON.stringify(c.logit_bias) === '[[64400,false]]') &&
      bonsai.s.calls.every((c) => c.logit_bias === undefined) &&
      mineCalls.length === 2 &&
      Number.isInteger(mineCalls[0].seed) &&
      mineCalls[0].seed === mineCalls[1].seed &&
      otherCalls[0].seed !== mineCalls[0].seed &&
      swarm &&
      true,
    { bias: lfm.s.calls[0].logit_bias, seeds: [mineCalls[0].seed, otherCalls[0].seed] },
  );
  lfm.s.tokens = {};
  // a draft that ran out of room before it answered is asked for its answer
  reset();
  lfm.s.script = (b) => {
    const last = b.messages[b.messages.length - 1].content;
    if (/ran out of room/.test(last)) return 'ANSWER: 42';
    return roleOf(b).stage === 'write'
      ? 'It is 42.'
      : roleOf(b).id === 'a-steps'
        ? 'First I note that six is... and then again, checking, and again'
        : 'ANSWER: 42';
  };
  bonsai.s.script = () => 'ANSWER: 42';
  const cut = await swarm.answer(Q);
  const st = cut.trace.find((r) => r.slot === 'a-steps');
  check(
    'a draft that ran out of room before it answered is asked once more for its answer alone, on the same slot, and that answer counts',
    cut.ok &&
      st.ok &&
      st.concluded &&
      st.final === '42' &&
      /Asked for its answer/.test(st.out) &&
      cut.path === 'agreed' &&
      cut.trace.filter((r) => r.stage === 'draft').length === 4,
    { st: [st.ok, st.concluded, st.final], path: cut.path },
  );
  // tests written apart from the code: one slot says what each call should give, and the answer that gives it is backed
  reset();
  const good = 'function add(a, b) {\n  return a + b;\n}';
  const bad = 'function add(a, b) {\n  return a - b;\n}';
  const fenced = (c) => 'So:\n\n```js\n' + c + '\n```';
  const CALLS = 'add(1, 2)\nadd(0, 0)\nadd(-3, 5)\nadd(7, 7)';
  const role = (b) =>
    roleOf(b) ||
    (/work out from the request alone/.test(b.messages[0].content)
      ? { id: 'expect', stage: 'expect' }
      : { id: '?', stage: '?' });
  lfm.s.script = (b) =>
    role(b).stage === 'expect'
      ? 'add(1, 2) => 3\nadd(0, 0) => 0\n`add(-3, 5)` => 2\nadd(7, 7) => 15'
      : fenced(role(b).id === 'a-direct' ? good : bad);
  bonsai.s.script = (b) => (role(b).stage === 'probe' ? CALLS : fenced(bad));
  const W = [{ role: 'user', content: 'Write a JavaScript function add(a, b) that returns the sum.' }];
  const flow = [{ do: 'draft' }, { do: 'try' }, { do: 'expect' }, { do: 'decide' }, { do: 'write' }];
  const exp = await swarm.answer(W, { briefs: { ...briefs, flow } });
  const er = exp.trace.find((r) => r.stage === 'expect');
  check(
    'a flow can ask one slot what each call should give, from the question alone: the answers are counted against it, the one that gives it on the most calls is backed (three drafts that share a slip do not outvote it), and a slot that is wrong about one call does not sink the answer',
    exp.ok &&
      er &&
      er.ok &&
      er.picked === 'A' &&
      /Answer A gives that on 3 of 4 calls; Answer B gives that on 1 of 4 calls/.test(er.out) &&
      exp.decided === bad &&
      exp.path === 'most' &&
      JSON.stringify(
        expectedIn('add(1, 2) => 3\nadd(1,2) -> 9\n- add(0, 0) returns 0; // zero\nadd(5, 5)', [
          'add(1, 2)',
          'add(0, 0)',
          'add(5, 5)',
        ]),
      ) === '{"add(1, 2)":"3","add(0, 0)":"0"}',
    { picked: er && er.picked, out: er && er.out.slice(-160), decided: exp.decided === good, path: exp.path },
  );
  // (three drafts hold the slip and one draft plus the expectation hold the sum: the slip still has more; with a decider, the count is before it)
  const p = paired(
    [
      { id: 1, grade: 'right' },
      { id: 2, grade: 'wrong' },
      { id: 3, grade: 'wrong' },
      { id: 4, grade: 'right' },
    ],
    [
      { id: 1, grade: 'wrong' },
      { id: 2, grade: 'right' },
      { id: 3, grade: 'right' },
      { id: 5, grade: 'right' },
    ],
  );
  check(
    'a change is judged question by question on the same questions: the answers it wins, the answers it loses, and questions it did not answer not counted',
    p.wins === 2 && p.losses === 1 && p.net === 1,
    p,
  );
}
// ---- 6i: THE TRAINER'S OWN SETTINGS AND RULES ARE DATA, and a pass that looks at itself changes them, each change with its reason
{
  const { readPolicy, setPolicy, basePolicy } = await import('../training/policy.mjs');
  const { metricsOf, changesFor, valueOf } = await import('../training/review.mjs');
  const { readState, STATES_DIR, STATE_FILE } = await import('../training/state.mjs');
  const { runTrial } = await import('../training/support/trial.mjs');
  const base = basePolicy();
  const noisy = metricsOf({
    report: { compared: 56, right: 31, wrong: 25, unsure: 0, lost: 6 },
    learned: { ledger: [] },
    state: { pass: 2 },
    noise: 3,
  });
  const ch = changesFor(base, noisy);
  const steady = changesFor(
    base,
    metricsOf({
      report: { compared: 56, right: 50, wrong: 6, lost: 1 },
      learned: { ledger: [{ pass: 2 }] },
      state: { pass: 2 },
      noise: 0,
    }),
  );
  const custom = changesFor(
    {
      ...base,
      review: {
        rules: [
          {
            id: 'mine',
            when: { metric: 'swarm.equivalentShare', op: '<', value: 0.9 },
            then: { set: 'trials.arrangements', to: 'current*2', max: 6 },
            why: 'only {metric%}',
          },
        ],
      },
    },
    noisy,
  );
  check(
    'a pass that looks at itself measures its own run (how many answers change by themselves, whether answers are lost in drafting or in choosing, how long nothing has been kept) and the rules, which are data, say what to change in how it trains and why: within bounds, and a rule added to the data works without any program changing',
    Math.abs(noisy['ceiling.noSlotHadItShare'] - 19 / 56) < 1e-9 &&
      noisy['pass.keptNothingFor'] === 2 &&
      ch.find((c) => c.set === 'keep.margin').to === 4 &&
      /differed by 3 answers/.test(ch.find((c) => c.set === 'keep.margin').why) &&
      ch.find((c) => c.set === 'moves.weight.flow').to === 1.5 &&
      /34%/.test(ch.find((c) => c.set === 'moves.weight.flow').why) &&
      ch.find((c) => c.set === 'trials.arrangements').to === 6 &&
      steady.length === 1 &&
      steady[0].set === 'keep.margin' &&
      steady[0].to === 1 &&
      custom.length === 1 &&
      custom[0].to === 6 &&
      custom[0].why === 'only 55%' &&
      valueOf('metric+1', 0, 3) === 4 &&
      valueOf('current*1.4', 500, 0) === 700 &&
      valueOf('nonsense', 1, 1) === undefined,
    { ch, steady },
  );
  const e = setPolicy('keep.margin', 4, { why: 'three answers changed by themselves', rule: 'noise-sets-the-margin' });
  const now = readPolicy();
  const again = setPolicy('keep.margin', 4, { why: 'x' });
  const st = readState();
  check(
    "a change to how a swarm is trained is made on that configuration's own record, with what it was, what it is, which rule and why; the settings every swarm starts from are untouched; and setting a thing to what it already is changes nothing",
    base.keep.margin === 2 &&
      now.keep.margin === 4 &&
      now.trials.arrangements === base.trials.arrangements &&
      e.from === 2 &&
      e.to === 4 &&
      again === null &&
      st.policyLog.length === 1 &&
      st.policyLog[0].rule === 'noise-sets-the-margin' &&
      basePolicy().keep.margin === 2,
    { e, log: st.policyLog },
  );
  fs.rmSync(STATES_DIR, { recursive: true, force: true });
  fs.rmSync(STATE_FILE, { force: true });
  fs.rmSync(STATE_FILE + '.bak', { force: true });
  // the one rule for keeping a change: question by question, by the margin, stopped when it cannot win, the baseline measured once
  const qs = tasks({ split: 'train', each: 6 })
    .filter((t) => t.type === 'value')
    .slice(0, 6);
  const hs = tasks({ split: 'held', each: 6 })
    .filter((t) => t.type === 'value')
    .slice(0, 6);
  const refs = {
    train: new Map(qs.map((t) => [t.id, 'ANSWER: ' + t.want])),
    held: new Map(hs.map((t) => [t.id, 'ANSWER: ' + t.want])),
  };
  let asked = 0;
  // a stand-in swarm: an arrangement is right on the questions its name says (r = right on so many of the first)
  const fakeSwarm = {
    cur: null,
    setBriefs(b) {
      this.cur = b;
    },
    async answer(msgs) {
      asked++;
      const all = [...qs, ...hs];
      const i = all.findIndex((t) => t.ask === msgs[0].content);
      const t = all[i];
      const n = i < qs.length ? i : i - qs.length;
      return { reply: 'ANSWER: ' + (n < this.cur.r ? t.want : 'no'), trace: [], path: 'x' };
    },
  };
  const B = (r, tag) => ({ slots: [{ id: 's', brief: tag }], r });
  const trial = (margin, cands) =>
    runTrial({
      swarm: fakeSwarm,
      base: B(3, 'base'),
      cands,
      of: (s) => (s === 'train' ? qs : hs),
      refs,
      policy: { keep: { margin }, trials: { stopEarly: true } },
    });
  const t1 = await trial(2, [
    { name: 'one better', briefs: B(4, 'c1') },
    { name: 'worse', briefs: B(0, 'c2') },
  ]);
  const askedAfterFirst = asked;
  const t2 = await trial(2, [{ name: 'three better', briefs: B(6, 'c3') }]);
  const t3 = await trial(1, [{ name: 'one better', briefs: B(4, 'c1') }]);
  check(
    'a change is kept only if it wins by the margin the policy sets, question by question; one that wins by less is not kept, and is kept when the margin is less; a trial that can no longer win is stopped partway; and the swarm as it is, once measured, is not measured again',
    t1.kept === false &&
      /no candidate won 2 more/.test(t1.why) &&
      t1.cands[1].train.stopped === true &&
      t1.cands[1].train.rows.length < 6 &&
      t2.kept === true &&
      t2.best.pair.wins === 3 &&
      t2.best.pair.losses === 0 &&
      /won 3 answers and lost 0/.test(t2.why) &&
      t3.kept === true &&
      asked <= askedAfterFirst + 30 &&
      askedAfterFirst <= 6 + 6 + 6,
    { t1: t1.why, stopped: t1.cands[1].train.rows.length, t2: t2.why, asked, askedAfterFirst },
  );
}
// ---- 6j: several changes at once, drawn by lot, and the same lot for the same pass
{
  const { wildMoves, steps, shapeOf } = await import('../training/arrange.mjs');
  const { makePlan } = await import('../training/plan.mjs');
  const { answer: orchestrate, flowOf } = await import('../src/orchestrate.mjs');
  const w1 = wildMoves(briefs, { n: 3, depth: 2, seed: 5 });
  const w1b = wildMoves(briefs, { n: 3, depth: 2, seed: 5 });
  const w2 = wildMoves(briefs, { n: 3, depth: 3, seed: 6 });
  const one = new Set(steps(briefs).map((c) => c.hash));
  // every arrangement the search can reach in one change, or several, still answers
  let broke = '';
  for (const c of [...steps(briefs), ...w1, ...w2]) {
    try {
      const got = await orchestrate(Q, { briefs: c.briefs, ask: async () => ({ text: 'ANSWER: 42' }) });
      if (!got.ok || got.decided !== '42') broke = broke || c.name;
    } catch (e) {
      broke = broke || c.name + ': ' + e.message;
    }
  }
  const plan = makePlan({ state: { pass: 0, tried: {} }, briefs, steps: steps(briefs), wild: w1, tries: 4 });
  check(
    'a pass also tries arrangements that are several changes from here at once, the changes drawn by lot from all that are open: the same pass draws the same ones, another pass others; none is one a single change reaches; each is in the plan as what it is; and every arrangement the search can reach, by one change or several, still answers',
    w1.length === 3 &&
      w1.map((c) => c.name).join('|') === w1b.map((c) => c.name).join('|') &&
      w1.map((c) => c.name).join('|') !== w2.map((c) => c.name).join('|') &&
      w1.every((c) => /^several: .+; then .+/.test(c.name) && c.hash !== shapeOf(briefs)) &&
      w2.every((c) => c.name.split('; then ').length === 3) &&
      broke === '' &&
      plan.moves.filter((m) => m.technique === 'Several changes at once').length === 3 &&
      steps(briefs).length >= 40,
    { w1: w1.map((c) => c.name), broke, n: steps(briefs).length },
  );
}
// ---- 7: one worked answer for each different answer
{
  reset();
  lfm.s.script = (b) => {
    const r = roleOf(b);
    return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'slipped\nANSWER: 41' : 'work\nANSWER: 42';
  };
  bonsai.s.script = (b) => (roleOf(b).id === 'b-direct' ? 'same slip\nANSWER: 41' : 'because\nANSWER: 42');
  const got = await swarm.answer(Q, { briefs: { ...briefs, plan: { ...briefs.plan, onePerAnswer: true } } });
  const critic = lfm.s.calls.find((c) => roleOf(c).id === 'a-critic');
  const seen = critic.messages[critic.messages.length - 1].content;
  check(
    'with the plan set so, a checker is shown one worked answer for each different answer, not every draft: it cannot count heads',
    got.ok &&
      (seen.match(/^Answer [A-H]:/gm) || []).length === 2 &&
      /Its final answer: 41/.test(seen) &&
      /Its final answer: 42/.test(seen),
    seen.slice(0, 400),
  );
}
// ---- 7b: the decide step is a decision model (Kev); no slot judges
{
  const { requestOf, readAnswers, decisionOf } = await import('../src/decider.mjs');
  const kev = { calls: [], reply: null, status: 200 };
  const ksrv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      kev.calls.push({ url: req.url, body: JSON.parse(Buffer.concat(parts).toString('utf8')) });
      res.writeHead(kev.status, { 'content-type': 'application/json' }).end(JSON.stringify(kev.reply));
    });
  });
  await new Promise((ok) => ksrv.listen(0, '127.0.0.1', ok));
  const withKev = await createSwarm({
    attach: { a: lfm.base, b: bonsai.base },
    kev: 'http://127.0.0.1:' + ksrv.address().port,
  });
  const disagree = () => {
    reset();
    lfm.s.script = (b) => {
      const r = roleOf(b);
      return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'slipped\nANSWER: 41' : 'work\nANSWER: 42';
    };
    bonsai.s.script = (b) => (roleOf(b).id === 'b-direct' ? 'same slip\nANSWER: 41' : 'because\nANSWER: 42');
  };
  // as Kev's own page shows an answer: a choice with a probability for each option, and a yes/no as one number
  const says = (pA, pB, okB = 0.9) => ({
    model: 'kev-latest',
    answers: {
      pick: { type: 'choice', choice: pA > pB ? 'A' : 'B', confidence: 0.5, probabilities: { A: pA, B: pB } },
      ok_A: { type: 'noul', noul: 0.1 },
      ok_B: { type: 'noul', noul: okB },
    },
    usage: { input_tokens: 300, output_tokens: 40 },
    latency_ms: 150,
  });
  disagree();
  kev.reply = says(0.12, 0.88);
  const got = await withKev.answer(Q);
  const sent = kev.calls[0];
  const row = got.trace.find((r) => r.slot === 'kev-decide');
  check(
    'with a decision model named, the decide step is one request to it: the question, one entry for each different answer and what the checkers said as state, a choice among the answers and a yes/no for each',
    sent.url === '/v1/systemone' &&
      sent.body.model === 'kev-latest' &&
      /six times seven/.test(sent.body.state.question) &&
      sent.body.state.answers.length === 2 &&
      sent.body.state.checks.length === 2 &&
      sent.body.questions.pick.type === 'choice' &&
      Object.keys(sent.body.questions.pick.criteria).join() === 'A,B' &&
      sent.body.questions.ok_B.type === 'noul' &&
      /DATA/.test(sent.body.state.guidance),
    sent.body,
  );
  check(
    'what it picks is the ruling, with its probabilities kept on the trace',
    got.decided === '42' &&
      got.path === 'decided' &&
      row.ok &&
      row.stage === 'decide' &&
      row.probs.B === 0.88 &&
      row.final === '42' &&
      got.reply === 'It is 42.',
    { decided: got.decided, row },
  );
  // four slots said 42 and two said 41: Kev may rule against the most given answer, and its ruling stands
  disagree();
  kev.reply = says(0.9, 0.1);
  const against = await withKev.answer(Q);
  disagree();
  kev.reply = says(0.48, 0.52, 0.2);
  const narrow = await withKev.answer(Q);
  const nrow = narrow.trace.find((r) => r.slot === 'kev-decide');
  check(
    'it is the only decider: it may rule against what most slots said, and a narrow lead is still its decision, kept as narrow for training',
    against.decided === '41' &&
      against.path === 'decided-against-most' &&
      narrow.decided === '42' &&
      nrow.ok &&
      /narrowly/.test(nrow.out),
    [against.path, against.decided, nrow],
  );
  disagree();
  kev.status = 503;
  const down = await withKev.answer(Q);
  kev.status = 200;
  check(
    'when it does not answer, the answer most slots gave stands: the swarm never fails for want of it, and no slot is asked to judge',
    down.ok &&
      down.decided === '42' &&
      down.path === 'most' &&
      /Kev answered 503/.test(down.trace.find((r) => r.slot === 'kev-decide').out) &&
      !down.trace.some((r) => r.stage === 'judge'),
    down.trace.map((r) => r.slot),
  );
  reset();
  const before = kev.calls.length;
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'It is 42.' : 'ANSWER: 42');
  await withKev.answer(Q);
  check(
    'it is not asked when every draft agrees: nothing is in dispute',
    kev.calls.length === before,
    kev.calls.length - before,
  );
  const req = requestOf({
    question: 'q',
    answers: [
      { letter: 'A', final: '1', work: 'x'.repeat(5000) },
      { letter: 'C', final: '2', work: '' },
    ],
    checks: ['y'.repeat(5000)],
  });
  check(
    'what is sent is kept short enough for a small decision model, and an answer in another shape is still read',
    req.state.answers[0].work.length < 1300 &&
      req.state.checks[0].length < 900 &&
      decisionOf(
        readAnswers({ pick: 'C' }, [
          { letter: 'A', final: '1' },
          { letter: 'C', final: '2' },
        ]),
        [
          { letter: 'A', final: '1' },
          { letter: 'C', final: '2' },
        ],
      ).final === '2' &&
      decisionOf(readAnswers({ answers: { pick: { choice: 'Z' } } }, [{ letter: 'A', final: '1' }]), [
        { letter: 'A', final: '1' },
      ]).ok === false,
    req.state.answers[0].work.length,
  );
  check(
    'a decision model is named by its address, and a swarm made without one has none',
    briefs.plan.decide === undefined && swarm.kev === '' && withKev.kev.startsWith('http'),
    briefs.plan,
  );
  await withKev.stop();
  ksrv.close();
}
// ---- 7c: the arrangement itself is trained: every layout one step from this one, and none tried twice
{
  const { steps, pickSteps, shapeOf } = await import('../training/arrange.mjs');
  const all = steps(briefs);
  const names = all.map((c) => c.name);
  const ok = (b) =>
    b.slots.filter((x) => x.stage === 'draft').length >= 2 &&
    ['a', 'b'].every((m) => b.slots.filter((x) => x.member === m).length <= 4);
  check(
    'from the arrangement as it is there are many others one step away: a slot moved to the other model, a drafter or a checker added where a model has a slot to spare, one dropped, what a checker sees, how freely a drafter samples, the plan',
    all.length > 20 &&
      ['move ', 'add ', 'drop ', 'sees ', 'temperature', 'plan: '].every((k) => names.some((n) => n.includes(k))) &&
      new Set(all.map((c) => c.hash)).size === all.length &&
      all.every((c) => c.hash !== shapeOf(briefs)),
    names,
  );
  check(
    'every one of them can still answer: two drafters at least, and no model asked for more slots than it has',
    all.every((c) => ok(c.briefs)) && !names.some((n) => /to a$/.test(n)) && names.some((n) => /to b$/.test(n)),
    names.filter((n) => /^move/.test(n)),
  );
  const first = pickSteps(all, [], 4);
  const next = pickSteps(
    all,
    first.map((c) => c.hash),
    4,
  );
  check(
    'a pass tries a few of different kinds, and the next pass tries others: nothing is measured twice',
    first.length === 4 &&
      new Set(first.map((c) => c.name.split(' ')[0])).size === 4 &&
      next.length === 4 &&
      !next.some((c) => first.some((f) => f.hash === c.hash)) &&
      pickSteps(
        all,
        all.map((c) => c.hash),
        4,
      ).length === 0,
    [first.map((c) => c.name), next.map((c) => c.name)],
  );
  const added = all.find((c) => /^add a second a-critic on b$/.test(c.name));
  reset();
  lfm.s.script = (b) => {
    const r = roleOf(b);
    return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'ANSWER: 41' : 'work\nANSWER: 42';
  };
  const got = await swarm.answer(Q, { briefs: added.briefs });
  check(
    'an arrangement with a slot added runs as the black box it was: the same message in, a reply out, the new slot at work',
    got.ok && got.reply === 'It is 42.' && got.trace.some((r) => r.slot === 'a-critic-b-2' && r.member === 'b'),
    got.trace.map((r) => r.slot),
  );
}
// ---- 7d: making ready: a file is fetched, and a fetch that goes wrong recovers by itself
{
  const { fetchFile } = await import('../training/setup.mjs');
  const { createHash } = await import('node:crypto');
  const whole = Buffer.from('a model file, pretending. '.repeat(4000));
  const sum = createHash('sha256').update(whole).digest('hex');
  const seen = [];
  let spoil = 0; // so many answers are sent with a byte changed
  let fail = false;
  const fsrv = http.createServer((req, res) => {
    seen.push(req.headers.range || '');
    if (fail) return res.writeHead(500).end();
    const from = req.headers.range ? Number(/bytes=(\d+)-/.exec(req.headers.range)[1]) : 0;
    let part = whole.subarray(from);
    if (spoil > 0) {
      spoil--;
      part = Buffer.from(part);
      part[part.length - 1] ^= 1;
    }
    res.writeHead(from ? 206 : 200, { 'content-length': part.length });
    res.end(part);
  });
  await new Promise((ok) => fsrv.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + fsrv.address().port + '/m.gguf';
  const at = (n) => path.join(state, 'fetch-' + n, 'm.gguf');
  const get = (n) => fetchFile({ url, dest: at(n), bytes: whole.length, sha256: sum, what: 'a model' });
  const fresh = await get(1);
  const again = await get(1);
  fs.mkdirSync(path.dirname(at(2)), { recursive: true });
  fs.writeFileSync(at(2) + '.part', whole.subarray(0, 30000));
  seen.length = 0;
  const resumed = await get(2);
  const range = seen[0];
  spoil = 1;
  const healed = await get(3);
  fs.mkdirSync(path.dirname(at(4)), { recursive: true });
  fs.writeFileSync(at(4) + '.part', Buffer.concat([whole, whole]));
  const restarted = await get(4);
  check(
    'a file is fetched and kept only if it is the size and the SHA-256 it should be; one already here is not fetched again; one that stopped carries on from where it stopped; one that arrives wrong is thrown away and fetched once more; and a part that cannot be this file is started again',
    fresh.ok &&
      !fresh.already &&
      again.already === true &&
      resumed.ok &&
      range === 'bytes=30000-' &&
      healed.ok &&
      restarted.ok &&
      [1, 2, 3, 4].every(
        (n) =>
          createHash('sha256')
            .update(fs.readFileSync(at(n)))
            .digest('hex') === sum && !fs.existsSync(at(n) + '.part'),
      ),
    { fresh, again, resumed, range, healed, restarted },
  );
  fs.mkdirSync(path.dirname(at(5)), { recursive: true });
  fs.writeFileSync(at(5) + '.part', whole.subarray(0, 5000));
  fail = true;
  const down = await get(5);
  fsrv.close();
  check(
    'where it cannot be fetched it stops and says why in a sentence, and what had arrived is kept for the next run to carry on from',
    down.ok === false &&
      /could not be fetched/.test(down.why) &&
      /carries on/.test(down.why) &&
      !fs.existsSync(at(5)) &&
      fs.statSync(at(5) + '.part').size === 5000,
    down,
  );
}
// ---- 7e: GETTING TO THE END: every fault has a way back, the way back is taken, and it is written down
{
  const { again, kindOf, writeSafe, readSafe, checkpoint, briefKey, RECOVERY_LOG, reap } =
    await import('../training/support/recover.mjs');
  const { startMember } = await import('../src/members.mjs');
  const { openTarget } = await import('../training/target.mjs');
  const { execFileSync } = await import('node:child_process');
  const FAKE = fileURLToPath(new URL('./fake-llama-server.mjs', import.meta.url));
  const model = path.join(state, 'm.gguf');
  fs.writeFileSync(model, 'x');
  const M = { key: 'a', name: 'A model', file: 'm.gguf', serve: ['--reasoning-budget', '0'], sampling: {} };
  const took = [];
  const onRecover = (what, did, more) => took.push({ what, did, ...more });
  const msg = [{ role: 'user', content: 'hello' }];
  // a server that stops in the middle of the work
  const up = await startMember(M, { llamaServer: FAKE, file: model, slots: 2, waitMs: 20000, onRecover });
  const before = (await up.member.ask('s', msg)).text;
  await fetch(up.member.base + '/die');
  await new Promise((r) => setTimeout(r, 300));
  const [x, y] = await Promise.all([up.member.ask('s', msg), up.member.ask('t', msg)]);
  check(
    'a model server that stops in the middle of the work is started again and the question is asked again; two slots waiting on it share the one restart; and it is written down',
    up.ok &&
      /^pid \d+/.test(before) &&
      x.text.split(' ')[1] !== before.split(' ')[1] &&
      x.text.split(' ')[1] === y.text.split(' ')[1] &&
      up.member.revived === 1 &&
      took.filter((t) => t.kind === 'gone').length === 1,
    { before, after: x.text, took },
  );
  up.member.stop();
  // a server that will not start: an older llama.cpp, a machine short of memory, a start that fails once
  const old = await startMember(M, {
    llamaServer: FAKE,
    file: model,
    slots: 2,
    flags: ['--old'],
    waitMs: 20000,
    onRecover,
  });
  const oldSaid = old.ok ? (await old.member.ask('s', msg)).text : '';
  if (old.ok) old.member.stop();
  const tight = await startMember(M, {
    llamaServer: FAKE,
    file: model,
    slots: 2,
    contextPerSlot: 4096,
    flags: ['--memory', '5000'],
    waitMs: 20000,
    onRecover,
  });
  const tightSaid = tight.ok ? (await tight.member.ask('s', msg)).text : '';
  if (tight.ok) tight.member.stop();
  const flaky = await startMember(M, {
    llamaServer: FAKE,
    file: model,
    slots: 1,
    flags: ['--fail-once', path.join(state, 'failed-once')],
    waitMs: 20000,
    onRecover,
  });
  if (flaky.ok) flaky.member.stop();
  const never = await startMember(M, {
    llamaServer: FAKE,
    file: model,
    slots: 2,
    contextPerSlot: 4096,
    flags: ['--memory', '10'],
    waitMs: 20000,
    onRecover,
  });
  check(
    'a server that will not start is tried the way that fits why: without a flag an older llama.cpp does not know; with less context where memory is short; once more where the cause may pass; and where nothing helps it stops and says why',
    old.ok &&
      / flags none /.test(oldSaid) &&
      tight.ok &&
      / ctx 4096 /.test(tightSaid) &&
      tight.contextPerSlot === 2048 &&
      flaky.ok &&
      never.ok === false &&
      /failed to allocate/.test(never.why) &&
      ['flag', 'memory', 'start'].every((k) => took.some((t) => t.kind === k)),
    { oldSaid, tightSaid, never: never.why, kinds: took.map((t) => t.kind) },
  );
  // the larger model: a reply with nothing in it, and a server that stops
  took.length = 0;
  const rung = {
    id: 't',
    name: 'A larger model',
    model: 'target',
    serve: { program: 'fake-llama-server.mjs', where: [path.dirname(FAKE)], args: ['--port', '{port}', '--unk', '1'] },
  };
  const tg = await openTarget(rung, { onRecover, waitMs: 20000 });
  const first = await tg.ask(msg);
  await fetch(tg.base + '/die');
  await new Promise((r) => setTimeout(r, 300));
  const second = await tg.ask(msg);
  const picky = await tg.ask(msg, { usable: () => false });
  tg.stop();
  check(
    'the larger model is asked again, with another draw, when its reply holds nothing; started again when its server stops; and when it still gives nothing usable that is handed back as it is, to be left out',
    first.draws === 2 &&
      / temp 0.4$/.test(first.text) &&
      /^pid/.test(second.text) &&
      second.text.split(' ')[1] !== first.text.split(' ')[1] &&
      picky.draws === 3 &&
      took.filter((t) => t.kind === 'empty').length >= 1 &&
      took.filter((t) => t.kind === 'gone').length === 1,
    { first, second, picky: picky.draws, took: took.map((t) => t.kind) },
  );
  // a larger model better served with a flag its engine may not know: with it where it can be, without it where it cannot
  took.length = 0;
  const flagged = {
    id: 'f',
    name: 'A flagged model',
    model: 'target',
    serve: {
      program: 'fake-llama-server.mjs',
      where: [path.dirname(FAKE)],
      args: ['--port', '{port}', '--reasoning-budget', '0', '--old'],
      optional: ['--reasoning-budget', '0'],
    },
  };
  const fg = await openTarget(flagged, { onRecover, waitMs: 20000 });
  const fgSaid = (await fg.ask(msg)).text;
  fg.stop();
  const flagTook = took.slice();
  // a server that says it is restarting is waited for, not replaced
  took.length = 0;
  const busyRung = {
    id: 'b',
    name: 'A busy model',
    model: 'target',
    serve: { program: 'fake-llama-server.mjs', where: [path.dirname(FAKE)], args: ['--port', '{port}', '--busy', '1'] },
  };
  const bz = await openTarget(busyRung, { onRecover, waitMs: 20000 });
  const bzSaid = await bz.ask(msg);
  bz.stop();
  check(
    'a larger model whose server says it is restarting is waited for and asked again the same way, by the same server, and that is written down',
    /^pid \d+/.test(bzSaid.text) &&
      bzSaid.draws === 1 &&
      took.filter((t) => t.kind === 'busy').length === 1 &&
      !took.some((t) => t.kind === 'gone'),
    { bzSaid, took },
  );
  const { REGISTRY } = await import('../src/catalog.mjs');
  const nemo = REGISTRY.targets.find((t) => t.id === 'nemotron35-30b');
  check(
    'a larger model is served the way it was learned to be served (Nemotron without drafts, as The Crew found), and where its engine does not know the flag it is served without, and that is written down',
    / flags none /.test(fgSaid) &&
      flagTook.some((t) => t.kind === 'flag') &&
      nemo.serve.args.includes('--no-drafts') &&
      nemo.serve.optional.includes('--no-drafts') &&
      /drafts/.test(nemo.serve.why),
    { fgSaid, took },
  );
  // a trainer that stops midway carries on from what it had written down
  const { run: runRows, finished } = await import('../training/support/bench.mjs');
  const qs = tasks({ split: 'train', each: 1 })
    .filter((t) => t.type === 'value' || t.type === 'code')
    .slice(0, 5);
  const asked = [];
  const answer = async (q) => {
    asked.push(q.id);
    return { reply: 'ANSWER: 1' };
  };
  let stopped = false;
  try {
    await runRows(qs, answer, {
      self: true,
      who: 'x',
      name: 'check-resume',
      onRow: () => {
        if (asked.length === 3) throw new Error('the trainer was stopped');
      },
    });
  } catch {
    stopped = true;
  }
  const firstAsked = asked.length;
  const rows = await runRows(qs, answer, { self: true, who: 'x', name: 'check-resume' });
  const other = await runRows(qs, answer, { self: true, who: 'x', name: 'check-other' });
  finished();
  const afresh = checkpoint('check-resume').have.size;
  check(
    'a trainer that stops partway has every answer it got written down, and run again asks only what is left; answers to another thing are not taken for these; and when it has finished the checkpoint is gone',
    stopped &&
      firstAsked === 3 &&
      rows.length === 5 &&
      asked.length === 3 + 2 + 5 &&
      new Set(rows.map((r) => r.id)).size === 5 &&
      other.length === 5 &&
      afresh === 0 &&
      briefKey({ slots: [{ brief: 'a' }] }) !== briefKey({ slots: [{ brief: 'b' }] }),
    { firstAsked, total: asked.length, afresh },
  );
  // a file half written, and the general way back
  const sf = path.join(state, 'state.json');
  writeSafe(sf, JSON.stringify({ pass: 1 }));
  writeSafe(sf, JSON.stringify({ pass: 2 }));
  fs.writeFileSync(sf, '{"pass": 3, "half');
  let n = 0;
  const healed = [];
  const got = await again(
    'a thing',
    async () => {
      if (++n < 3) throw new Error(n === 1 ? 'connect ECONNREFUSED 127.0.0.1:1' : 'The operation timed out');
      return 'done';
    },
    { heal: async (kind) => healed.push(kind), wait: 1 },
  );
  let gaveUp = '';
  try {
    await again(
      'a thing',
      async () => {
        throw new Error('the model answered 400: bad request');
      },
      { heal: async () => healed.push('never'), wait: 1 },
    );
  } catch (e) {
    gaveUp = e.message;
  }
  const reread = readSafe(sf);
  const log = fs
    .readFileSync(RECOVERY_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  check(
    'a file is written whole or not at all, and one that will not read is read from the last good copy; a fault is told by its kind and its way back taken, while a fault with no way back is not retried; and every way back taken is on the record',
    reread.pass === 1 &&
      readSafe(path.join(state, 'none.json'), 7) === 7 &&
      got === 'done' &&
      healed.join() === 'gone,hung' &&
      /400/.test(gaveUp) &&
      kindOf('failed to allocate memory') === 'memory' &&
      log.some((r) => /last good copy/.test(r.did)) &&
      log.some((r) => r.kind === 'resumed') &&
      log.filter((r) => r.what === 'a thing').length === 2 &&
      RECOVERY_LOG.startsWith(WORK_DIR),
    { read: reread, healed, gaveUp, log: log.length },
  );
  // a step of a pass: run again when it fails, passed over when it is done, and not retried when it has nothing to do
  const out = path.join(state, 'pass');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'status.txt'), '');
  fs.writeFileSync(
    path.join(state, 'flaky.mjs'),
    "import fs from 'node:fs';\nconst f = process.argv[2];\nif (fs.existsSync(f)) {\n  console.log('carried on');\n  process.exit(0);\n}\nfs.writeFileSync(f, '');\nconsole.log('stopped');\nprocess.exit(1);\n",
  );
  fs.writeFileSync(path.join(state, 'bad.mjs'), 'process.exit(7);\n');
  fs.writeFileSync(path.join(state, 'none.mjs'), 'process.exit(2);\n');
  const sh = (body) =>
    execFileSync(
      'bash',
      [
        '-c',
        'cd ' +
          JSON.stringify(path.resolve(path.dirname(FAKE), '..')) +
          ' && OUT=' +
          JSON.stringify(out) +
          ' NODE=' +
          JSON.stringify(process.execPath) +
          ' STEP_WAIT=0 && . training/support/steps.sh && ' +
          body,
      ],
      { encoding: 'utf8' },
    );
  sh(
    'run 01-flaky ' +
      JSON.stringify(path.join(state, 'flaky.mjs')) +
      ' ' +
      JSON.stringify(path.join(state, 'flag')) +
      '; run 02-bad ' +
      JSON.stringify(path.join(state, 'bad.mjs')) +
      '; run 03-none ' +
      JSON.stringify(path.join(state, 'none.mjs')) +
      '; true',
  );
  sh(
    'run 01-flaky ' +
      JSON.stringify(path.join(state, 'flaky.mjs')) +
      ' ' +
      JSON.stringify(path.join(state, 'flag')) +
      '; true',
  );
  const status = fs.readFileSync(path.join(out, 'status.txt'), 'utf8');
  const stepNotes = fs
    .readFileSync(RECOVERY_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.kind === 'step');
  const count = (re) => (status.match(re) || []).length;
  check(
    'a step that fails is run again and carries on (its output kept, with the stop marked); one that keeps failing is tried three times, written down, and the pass goes on; one with nothing to do is not retried; and on a resumed pass a step that ended well is passed over',
    count(/START 01-flaky/g) === 2 &&
      count(/END {3}01-flaky exit 0/g) === 1 &&
      count(/START 02-bad/g) === 3 &&
      count(/END {3}02-bad exit 7/g) === 3 &&
      count(/START 03-none/g) === 1 &&
      count(/SKIP {2}01-flaky/g) === 1 &&
      stepNotes.length === 3 &&
      /stopped[\s\S]*it stopped \(exit 1\)[\s\S]*carried on/.test(
        fs.readFileSync(path.join(out, '01-flaky.out'), 'utf8'),
      ),
    status,
  );
  // THE CHECKS STOP NOTHING: a process that looks exactly like one of this folder's model servers is found, and is left running
  {
    const { spawn } = await import('node:child_process');
    const root = path.resolve(path.dirname(FAKE), '..');
    const decoy = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', 'llama-server', path.join(root, '.work', 'models', 'decoy.gguf')],
      { stdio: 'ignore' },
    );
    await new Promise((r) => setTimeout(r, 400));
    const found = reap({ keepKev: true }).some((r) => r.pid === String(decoy.pid));
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try {
      process.kill(decoy.pid, 0);
    } catch {
      alive = false;
    }
    decoy.kill();
    check(
      "the checks stop no real process: run beside a live session, what looks like one of this folder's model servers is found and left running (the recovery code the checks exercise would otherwise stop the session's own servers)",
      process.env.SWARM_NO_REAP === '1' && found && alive,
      { found, alive },
    );
  }
  check(
    "what a dead session left running is found by what it was started with, and nothing of anyone else's is counted",
    Array.isArray(reap({ dry: true })) && reap({ dry: true }).every((r) => /\.work|--name target/.test(r.cmd)),
    reap({ dry: true }),
  );
}
// ---- 7g: every name a file takes from another is one that file gives (a trainer that only runs from the shell is not loaded here)
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = ['src', 'training', 'training/support', 'bin'].flatMap((d) =>
    fs
      .readdirSync(path.join(root, d))
      .filter((n) => n.endsWith('.mjs'))
      .map((n) => path.join(root, d, n)),
  );
  const missing = [];
  let seen = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      const src = fs.readFileSync(target, 'utf8');
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (!name) continue;
        seen++;
        const given =
          new RegExp('export\\s+(?:async\\s+)?(?:const|let|function\\*?|class)\\s+' + name + '\\b').test(src) ||
          new RegExp('export\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}').test(src);
        if (!given) missing.push(path.relative(root, file) + ' takes ' + name + ' from ' + path.relative(root, target));
      }
    }
  }
  check(
    'every name one file takes from another is a name that file gives, in the trainers that only run from the shell as well',
    seen > 100 && missing.length === 0,
    missing,
  );
}

// ---- 7f: THE PLAN: a pass chooses what to try from where the answers were lost, and follows it
{
  const { diagnose, makePlan, readPlan, writePlan, mark } = await import('../training/plan.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const { candHash } = await import('../training/state.mjs');
  const briefs = readBriefs();
  const slot = (stage, ran, right, more = {}) => ({ stage, ran, right, silent: 0, ms: 1, ...more });
  // the drafts are short of the mark, the decider threw two away, one checker is worse than the drafts it checks
  const report = {
    compared: 20,
    right: 12,
    wrong: 7,
    unsure: 1,
    lost: 3,
    slots: {
      'a-direct': slot('draft', 20, 12),
      'a-steps': slot('draft', 20, 11),
      'b-direct': slot('draft', 20, 6),
      'b-other-way': slot('draft', 20, 11),
      'a-critic': slot('check', 10, 3),
      'b-recompute': slot('check', 10, 7),
      'kev-decide': slot('decide', 10, 6, { hadRight: 8, threwAway: 2 }),
      'a-writer': slot('write', 20, 20),
    },
  };
  const found = diagnose(report);
  const ids = found.map((x) => x.id);
  check(
    'a measurement is read for where the answers were lost: no slot had it, a drafter well under the best, a checker worse than the drafts it checks, a decider that had it and chose another; the largest first, and nothing is found where nothing is measured',
    ids[0] === 'drafts-short' &&
      found[0].answers === 5 &&
      ids.includes('weak-draft:b-direct') &&
      ids.includes('check-worse:a-critic') &&
      !ids.includes('check-worse:b-recompute') &&
      ids.includes('decider-threw:kev-decide') &&
      !ids.some((i) => i.startsWith('writer')) &&
      found.every((x, i) => !i || found[i - 1].answers >= x.answers) &&
      diagnose(null).length === 0 &&
      diagnose({ slots: {}, compared: 0 }).length === 0,
    found,
  );
  const cands = {
    'a-writer': [{ name: 'writer: say less', brief: 'Write the reply.' }],
    'b-direct': [{ name: 'drafter: test first', brief: 'Write a test, then the answer.', from: '2601.00001' }],
    'a-critic': [
      { name: 'critic: four checks', brief: 'Check four things.' },
      { name: 'one for each', plan: { onePerAnswer: true } },
    ],
  };
  const state = { pass: 2, focus: { fix: 4 }, tried: {} };
  const args = {
    state,
    briefs,
    candidates: (id) => cands[id] || [],
    steps: steps(briefs),
    hashOf: candHash,
    names: { a: 'Model A', b: 'Model B' },
    tries: 4,
  };
  const plan = makePlan({ ...args, report, reportIsThisPass: true });
  const blind = makePlan({ ...args, report: null });
  const again = makePlan({
    ...args,
    report,
    reportIsThisPass: true,
    state: {
      ...state,
      tried: {
        'b-direct': [candHash(cands['b-direct'][0])],
        _arrangement: plan.moves.filter((m) => m.kind === 'arrangement').map((m) => m.hash),
      },
    },
  });
  const order = (p) => [...new Set(p.moves.filter((m) => m.slot).map((m) => m.slot))];
  const arr = (p) => p.moves.filter((m) => m.kind === 'arrangement');
  check(
    'the plan is made from the findings: the slot they point at comes first and the one they do not comes last, each move says what it speaks to, the arrangements chosen are ones that could win those answers back; with nothing measured the checkers come first; and what an earlier pass measured and did not keep is not chosen again',
    plan.basedOn === 'this-pass' &&
      order(plan)[0] === 'b-direct' &&
      order(plan).slice(-1)[0] === 'a-writer' &&
      plan.moves[0].why.includes('drafts-short') &&
      plan.moves[0].from === '2601.00001' &&
      plan.moves[0].model === 'Model B' &&
      plan.moves.find((m) => m.what === 'one for each').why.includes('decider-threw:kev-decide') &&
      arr(plan).length === 4 &&
      arr(plan).filter((m) => m.answers > 0).length >= 3 &&
      arr(plan)[0].answers >= arr(plan)[3].answers &&
      plan.moves.every((m, i) => m.order === i + 1 && m.status === 'planned') &&
      blind.basedOn === 'nothing' &&
      blind.findings.length === 0 &&
      order(blind)[0] === 'a-critic' &&
      arr(blind).length === 4 &&
      !again.moves.some((m) => m.slot === 'b-direct') &&
      !arr(again).some((m) => arr(plan).some((x) => x.hash === m.hash)) &&
      plan.focus[0].kind === 'fix',
    { order: order(plan), arr: arr(plan).map((m) => [m.what, m.answers]), blind: order(blind) },
  );
  writePlan(plan);
  const first = plan.moves[0];
  mark((m) => m.what === first.what && m.slot === first.slot, 'running');
  const during = readPlan().moves[0].status;
  mark((m) => m.what === first.what && m.slot === first.slot, 'kept', {
    result: { why: 'higher on train, not lower on held' },
  });
  const after = readPlan();
  check(
    'a move is marked as it is measured, and what became of it stays with the plan: being measured, then kept or not kept with what it scored; the other moves are untouched',
    during === 'running' &&
      after.moves[0].status === 'kept' &&
      /higher on train/.test(after.moves[0].result.why) &&
      after.moves.slice(1).every((m) => m.status === 'planned') &&
      mark(() => false, 'kept') === 0,
    after.moves[0],
  );
}
// ---- 8: parity with a larger model, and what one pass leaves the next
{
  const { parity, readTargets } = await import('../training/state.mjs');
  const { endPass, orderOf } = await import('../training/pass.mjs');
  const row = (id, kind, grade) => ({ id, kind, grade });
  // each row is the swarm's answer marked against the larger model's: right = the same answer
  const far = [
    row('1', 'trap', 'wrong'),
    row('2', 'trap', 'unsure'),
    row('3', 'chain', 'right'),
    row('4', 'chain', 'right'),
    row('5', 'day', 'right'),
    row('6', 'day', 'noref'),
  ];
  const near = [...Array(9)].map((_, i) => row('n' + i, 'chain', 'right')).concat([row('n9', 'trap', 'wrong')]);
  const pf = parity(far);
  const pn = parity(near);
  const all = parity(near.slice(0, 9).concat([row('q', 'day', 'noref')]));
  check(
    "parity is equivalence, not a share: the swarm is at parity only when EVERY answer is equivalent to the larger model's, and one that is not is enough to say it is not",
    pf.compared === 5 &&
      pf.equivalent === 3 &&
      pf.differ === 1 &&
      pf.none === 1 &&
      pf.level === false &&
      pf.trailing[0].kind === 'trap' &&
      pf.trailing[0].differ === 2 &&
      pn.equivalent === 9 &&
      pn.compared === 10 &&
      pn.level === false &&
      all.level === true &&
      all.compared === 9 &&
      pf.share === undefined &&
      pf.bar === undefined &&
      parity([row('x', 'day', 'noref')]) === null,
    { pf, pn, all },
  );
  const targets = [
    { id: 'small', name: 'Small' },
    { id: 'large', name: 'Large' },
  ];
  const state = {
    pass: 2,
    target: 'small',
    seeds: { train: 1009, held: 7919 },
    focus: {},
    tried: { j: ['x'] },
    order: [],
    questions: [],
    seen: ['a'],
    ideas: [],
    history: [],
  };
  const train = {
    slots: {
      'a-critic': { stage: 'check', ran: 10, right: 9 },
      'a-writer': { stage: 'write', ran: 10, right: 10, changed: 4 },
      'a-steps': { stage: 'draft', ran: 10, right: 3 },
      'a-direct': { stage: 'draft', ran: 10, right: 8 },
    },
  };
  const e1 = endPass(state, { swarmRows: far, train, briefs, targets });
  check(
    'a pass that ends short of parity leaves for the next: new train questions, the same held ones, more of the kind it differed on, a search for that kind, the slots worst first, and what was already tried',
    e1.next.pass === 3 &&
      e1.next.target === 'small' &&
      e1.next.seeds.train !== 1009 &&
      e1.next.seeds.held === 7919 &&
      e1.next.focus.trap === 4 &&
      e1.next.questions.some((q) => /cognitive reflection/.test(q)) &&
      e1.next.order[0] === 'a-writer' &&
      e1.next.order.indexOf('a-steps') < e1.next.order.indexOf('a-direct') &&
      e1.next.tried.j[0] === 'x' &&
      e1.done.level === false &&
      e1.done.equivalent === 3 &&
      e1.done.compared === 5,
    e1.next,
  );
  const whole = near.slice(0, 9);
  const e2 = endPass(state, { swarmRows: whole, train, briefs, targets });
  const e3 = endPass({ ...state, target: 'large' }, { swarmRows: whole, train, briefs, targets });
  const e6 = endPass(state, { swarmRows: near, train, briefs, targets });
  check(
    'a pass that ends at parity names the next, larger model and meets it on held questions nothing was chosen on; at parity with the largest there is, it stays and says so; nine equivalent of ten is not parity',
    e2.climbed.id === 'large' &&
      e2.next.target === 'large' &&
      e2.next.seeds.held !== 7919 &&
      e3.climbed === null &&
      e3.next.target === 'large' &&
      e3.done.level === true &&
      e6.done.level === false &&
      e6.climbed === null &&
      e6.next.target === 'small',
    [e2.next, e3.next],
  );
  const e4 = endPass(state, { swarmRows: [row('x', 'day', 'noref')], train, briefs, targets });
  check(
    'with no answers from the larger model a pass does not call itself at parity',
    e4.done.level === false && e4.parity === null && e4.next.target === 'small',
    e4.done,
  );
  const more = tasks({ split: 'train', each: 2, seed: 5, focus: { fix: 3 } });
  const heldSame = tasks({ split: 'held', each: 2, seed: 5, focus: { fix: 3 } });
  check(
    'a kind the swarm trails on is asked more of on the train questions, never on the held ones, and another seed makes other questions',
    more.filter((t) => t.kind === 'fix').length === 5 &&
      heldSame.filter((t) => t.kind === 'fix').length === 2 &&
      tasks({ split: 'train', each: 2, seed: 6 })[0].ask !== more[0].ask &&
      more[0].seed === 5,
    more.length,
  );
  const rungs = readTargets();
  const { targetOf } = await import('../training/state.mjs');
  const { servingOf } = await import('../training/target.mjs');
  const { REGISTRY, readConfig, MEMBERS, DECIDER } = await import('../src/catalog.mjs');
  const pinned = (m) =>
    /^[0-9a-f]{40}$/.test(m.rev) &&
    m.bytes > 1e8 &&
    /^[0-9a-f]{64}$/.test(m.sha256) &&
    m.file.endsWith('.gguf') &&
    m.license;
  check(
    'the larger models are a ladder, smallest first, and the one configured is the one chased; a GGUF target is served by llama.cpp from its pinned file, with a wide context and one slot',
    rungs.every((t, i) => i === 0 || t.params >= rungs[i - 1].params) &&
      targetOf().id === readConfig().target &&
      rungs.filter((t) => t.engine === 'llama').every(pinned) &&
      servingOf(
        rungs.find((t) => t.engine === 'llama'),
        { llamaServer: '/x/llama-server', modelsDir: '/nowhere' },
      ).program === '' &&
      /is not here/.test(
        servingOf(
          rungs.find((t) => t.engine === 'llama'),
          { modelsDir: '/nowhere' },
        ).missing,
      ) &&
      orderOf(null, briefs.slots)[0] === 'a-critic',
    rungs.map((t) => t.id),
  );
  check(
    'every model that can be chosen is pinned (a repository, a revision, a size, a SHA-256, a licence), there are small models from several makers, several deciders and several targets, and the swarm is made of the ones chosen',
    REGISTRY.small.length >= 12 &&
      REGISTRY.small.every(pinned) &&
      new Set(REGISTRY.small.map((m) => m.by.split(',')[0])).size >= 6 &&
      REGISTRY.deciders.length >= 3 &&
      REGISTRY.targets.length >= 8 &&
      MEMBERS.a.id === readConfig().a &&
      MEMBERS.b.id === readConfig().b &&
      DECIDER.id === readConfig().decider &&
      MEMBERS.a.key === 'a' &&
      new Set([...REGISTRY.small, ...REGISTRY.targets, ...REGISTRY.deciders].map((m) => m.id)).size ===
        REGISTRY.small.length + REGISTRY.targets.length + REGISTRY.deciders.length,
    REGISTRY.small.map((m) => m.id),
  );
}
await swarm.stop();
lfm.close();
bonsai.close();
console.log('\n' + (failed.length ? failed.length + ' FAILED, ' : 'all ') + passed + ' passed.');
process.exit(failed.length ? 1 : 0);
