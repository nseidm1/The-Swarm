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
      // (a script may answer a turn with tools as a model would: { tool_calls } or { content })
      if (body.tools)
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            choices: [
              {
                message:
                  out && typeof out === 'object'
                    ? {
                        role: 'assistant',
                        content: out.content || '',
                        ...(out.tool_calls ? { tool_calls: out.tool_calls } : {}),
                      }
                    : {
                        role: 'assistant',
                        content: '',
                        tool_calls: [
                          {
                            id: 'c1',
                            type: 'function',
                            function: { name: body.tools[0].function.name, arguments: '{}' },
                          },
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
  const reader = 'http://127.0.0.1:' + ksrv.address().port;
  const yes = await eq(bug, 'It keeps the wrong occurrence.', 'The filter keeps the other occurrence of each value.', {
    reader,
  });
  kq.p = 0.1;
  const no = await eq(bug, 'It keeps the wrong occurrence.', 'The loop is off by one.', { reader });
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
      (await eq(bug, 'x', '', { reader })) === 'unsure' &&
      (await openEquivalent('q', '', 'y', { reader })).grade === 'noref',
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
  // too few calls from the slot: calls are built from the drafts' parameters (behave.mjs callsFrom), so the drafts are still run;
  // and where even those cannot be had (no function the drafts define), nothing is run
  const none = await behaviours({
    question: 'q',
    drafts: [
      { letter: 'A', final: ways['a-direct'] },
      { letter: 'B', final: bad1 },
    ],
    probeText: 'no calls here',
  });
  const nothing = await behaviours({
    question: 'q',
    drafts: [
      { letter: 'A', final: '42' },
      { letter: 'B', final: '41' },
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
    'the calls to try are read from what a slot wrote: whole calls to the function, with literal arguments only, each once; with too few, calls are built from the parameters of the drafts, and with none to be had nothing is run; and a call on which two drafts part is named with what each gave',
    read.join(' | ') === 'add(1, 2) | add([1, [2]], { a: 1 }) | add("a)", 1) | add(true, null)' &&
      nameOf([ways['a-direct'], bad2, 'function helper() {}\nfunction add(a, b) {}'], 'Write add') === 'add' &&
      none &&
      none.groups.length === 2 &&
      nothing === null &&
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
      names(briefs).length === 20 &&
      // the decider between the drafts and the checks, both ways; and every other step in every place it can go
      names(briefs).some((n) => /keep the likeliest two, straight after the draft/.test(n)) &&
      names(briefs).some((n) => /settle it if the decider is sure, else go on, straight after the try/.test(n)) &&
      names(briefs).some((n) => /a check, straight after the decision/.test(n)) &&
      names(briefs).some((n) => /the answers go back to the drafters, straight after the draft/.test(n)) &&
      names(briefs).some((n) => /what each call should give/.test(n)) &&
      names(briefs).some((n) => /straight after the draft/.test(n)) &&
      names(briefs).some((n) => /the check before the try/.test(n)) &&
      names(briefs).some((n) => /go back to the drafters/.test(n)) &&
      names(briefs).some((n) => /no check/.test(n)) &&
      !names(briefs).some((n) => /plain one/.test(n)) &&
      second.some((c) => /3 times at most/.test(c.name) && c.briefs.flow.find((x) => x.do === 'repeat').upTo === 3) &&
      second.some(
        (c) => /undone/.test(c.name) && c.briefs.flow.map((x) => x.do).join() === 'draft,try,check,revise,decide,write',
      ) &&
      second.some((c) => /plain one/.test(c.name) && c.briefs.flow === undefined) &&
      shapeOf(loopMove.briefs) !== shapeOf(briefs) &&
      all.some((c) => /add a second a-writer on b/.test(c.name)) &&
      all.filter((c) => /^flow: /.test(c.name)).length === 20 &&
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
// ---- 6i: THE TRAINER'S OWN SETTINGS ARE DATA: what every configuration starts with, and a configuration's own over them
{
  const { readPolicy, basePolicy } = await import('../training/policy.mjs');
  const base = basePolicy();
  const { configText } = await import('../src/catalog.mjs');
  check(
    "the configuration is written as the repository's formatter writes it (a short list on one line), so one chosen on the page and committed passes the format check",
    configText({ a: 'x', equivalence: ['crew', 'math'] }) === '{\n  "a": "x",\n  "equivalence": ["crew", "math"]\n}\n',
    configText({ a: 'x', equivalence: ['crew', 'math'] }),
  );
  const mine = readPolicy({ policy: { loop: { cap: 12 } } });
  check(
    "how the trainer trains is data: the loop's limits (changes tried on a question, questions asked again before a keep, when a change is dropped), what the plan lists first, and how much each kind of move counts for; a configuration's own setting stands over the one every configuration starts with, and leaves the rest as they are; nothing of the old way is left in it (no margin, no screen, no review rules)",
    base.questions.each === 6 &&
      base.loop.cap === 8 &&
      base.loop.guard === 6 &&
      base.loop.drop === 6 &&
      base.plan.arrangements >= 1 &&
      base.moves.weight.brief === 1 &&
      base.ratchet.passes >= 1 &&
      mine.loop.cap === 12 &&
      mine.loop.guard === 6 &&
      readPolicy({}).loop.cap === 8 &&
      !('keep' in base) &&
      !('review' in base) &&
      !('trials' in base),
    { base: Object.keys(base), mine: mine.loop },
  );
}
// ---- 6j: several changes at once, drawn by lot, and the same lot for the same pass
{
  const { wildMoves, steps, shapeOf } = await import('../training/arrange.mjs');
  const { makePlan } = await import('../training/plan.mjs');
  const { answer: orchestrate, flowOf } = await import('../src/orchestrate.mjs');
  const w1 = wildMoves(briefs, { n: 3, depth: 2 });
  const w1b = wildMoves(briefs, { n: 3, depth: 2 });
  // what was tried is not taken again: the next three in the list
  const w1c = wildMoves(briefs, { n: 3, depth: 2, tried: w1.map((c) => c.hash) });
  const w2 = wildMoves(briefs, { n: 3, depth: 3 });
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
      w1c.length === 3 &&
      !w1c.some((c) => w1.some((x) => x.hash === c.hash)) &&
      w1.map((c) => c.name).join('|') !== w2.map((c) => c.name).join('|') &&
      w1.every((c) => /^several: .+; then .+/.test(c.name) && c.hash !== shapeOf(briefs)) &&
      w2.every((c) => c.name.split('; then ').length === 3) &&
      broke === '' &&
      plan.moves.filter((m) => m.technique === 'Several changes at once').length === 3 &&
      steps(briefs).length >= 40,
    { w1: w1.map((c) => c.name), broke, n: steps(briefs).length },
  );
}
// ---- 6k: MORE THAN TWO SMALL MODELS: two to four places, each a model of its own
{
  const { readConfig, writeConfig, placesOf, configId, REGISTRY, CONFIG_FILE } = await import('../src/catalog.mjs');
  const { withPlaces } = await import('../src/index.mjs');
  const { steps, wildMoves } = await import('../training/arrange.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const start = readConfig();
  const [m3, m4] = REGISTRY.small.filter((m) => m.id !== start.a && m.id !== start.b);
  const refuse = (patch) => {
    try {
      writeConfig(patch);
      return false;
    } catch {
      return true;
    }
  };
  const noGap = refuse({ d: m4.id });
  const three = writeConfig({ c: m3.id });
  const four = writeConfig({ d: m4.id });
  const up = writeConfig({ c: null });
  const noA = refuse({ a: null });
  const two = writeConfig({ c: '' });
  check(
    'a swarm is two to four small models: a third and a fourth can be added (in order, no place left empty), each is part of what the configuration is called, taking one out moves the next up, the first two cannot be emptied, and with the others out it is the two it was',
    CONFIG_FILE.startsWith(WORK_DIR) &&
      noGap &&
      placesOf(three).join() === 'a,b,c' &&
      configId(three) === [start.a, start.b, m3.id, start.decider].join('+') &&
      placesOf(four).join() === 'a,b,c,d' &&
      up.c === m4.id &&
      up.d === undefined &&
      noA &&
      two.c === undefined &&
      configId(two) === configId(start) &&
      JSON.stringify(readConfig()) === JSON.stringify(start),
    { three, four, up, two },
  );
  const b3 = withPlaces(briefs, ['a', 'b', 'c']);
  const b4 = withPlaces(briefs, ['a', 'b', 'c', 'd']);
  const mine = b3.slots.filter((x) => x.member === 'c');
  const all3 = steps(b3);
  let broke = '';
  const seen = [];
  for (const c of [
    { name: 'as it is', briefs: b3 },
    { name: 'four', briefs: b4 },
    ...all3,
    ...wildMoves(b3, { n: 4, depth: 3, seed: 9 }),
  ]) {
    try {
      const got = await orchestrate(Q, {
        briefs: c.briefs,
        ask: async (slot) => (
          c.name === 'as it is' && seen.push(slot.member),
          { text: slot.member === 'c' ? 'ANSWER: 41' : 'ANSWER: 42' }
        ),
      });
      if (!got.ok || got.decided !== '42') broke = broke || c.name;
    } catch (e) {
      broke = broke || c.name + ': ' + e.message;
    }
  }
  check(
    'a third small model begins as two drafters of its own, after the other drafters and told what theirs are told; slots on a place that is not filled are left out; the search moves slots to and from every model; and every arrangement it can reach with three models, by one change or several, still answers',
    mine.length === 2 &&
      mine.every((x) => x.stage === 'draft') &&
      mine.map((x) => x.id).join() === 'c-direct,c-other-way' &&
      mine[0].brief === briefs.slots.find((x) => x.id === 'a-direct').brief &&
      b3.slots.filter((x) => x.stage === 'draft').length === 6 &&
      b4.slots.filter((x) => x.stage === 'draft').length === 8 &&
      withPlaces(b3, ['a', 'b']).slots.length === briefs.slots.length &&
      all3.some((c) => /^move a-critic to c$/.test(c.name)) &&
      all3.some((c) => /^move c-direct to a$|^move c-direct to b$/.test(c.name)) &&
      all3.some((c) => /c-direct checks instead of drafting/.test(c.name)) &&
      all3.length > steps(briefs).length &&
      broke === '' &&
      seen.includes('c'),
    { mine: mine.map((x) => x.id), n: all3.length, broke },
  );
}
// ---- 6l: taken from how The Crew is trained: watch before acting, check the reader, name every flip, ask it two ways, tighten what holds
{
  const { replay, WAYS } = await import('../training/replay.mjs');
  const { knownPairs, checkReader } = await import('../training/readers.mjs');
  const { reword, reworded } = await import('../training/tasks.mjs');
  const { flipsBetween } = await import('../training/pass.mjs');
  const { makePlan } = await import('../training/plan.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const { run: runRows, reference, WORKC } = await import('../training/support/bench.mjs');
  // one measurement, replayed under each way of choosing between the answers
  const d = (slot, final, same, does) => ({ slot, stage: 'draft', final, same, does });
  const rows = [
    // three hold a slip, one has it; the decider (unsure) chose the slip: only "the best on the table" would have won
    {
      id: 1,
      grade: 'wrong',
      trace: [
        d('a1', 'x', false, 's1'),
        d('a2', 'x', false, 's1'),
        d('b1', 'x', false, 's1'),
        d('b2', 'y', true, 's2'),
        { stage: 'decide', final: 'x', same: false, probs: { A: 0.4, D: 0.35 } },
      ],
    },
    // two and two; the decider, sure, chose rightly
    {
      id: 2,
      grade: 'right',
      trace: [
        d('a1', 'p', true, 't1'),
        d('a2', 'p', true, 't1'),
        d('b1', 'q', false, 't2'),
        d('b2', 'q', false, 't2'),
        { stage: 'decide', final: 'p', same: true, probs: { A: 0.9, C: 0.1 } },
      ],
    },
    // three have it, one does not; the decider, unsure, chose the one
    {
      id: 3,
      grade: 'wrong',
      trace: [
        d('a1', 'm', true, 'u1'),
        d('a2', 'm', true, 'u1'),
        d('b1', 'm', true, 'u1'),
        d('b2', 'n', false, 'u2'),
        { stage: 'decide', final: 'n', same: false, probs: { A: 0.45, D: 0.55 } },
      ],
    },
    // all agree: nobody was asked to choose
    {
      id: 4,
      grade: 'right',
      trace: [d('a1', 'k', true, 'v1'), d('a2', 'k', true, 'v1'), d('b1', 'k', true, 'v1'), d('b2', 'k', true, 'v1')],
    },
    { id: 5, grade: 'noref', trace: [d('a1', 'z', null, 'w1')] },
  ];
  const r = replay(rows);
  const plan = makePlan({ state: { pass: 0, tried: {} }, briefs, steps: steps(briefs), replayed: r, tries: 3 });
  const ways = plan.moves.filter((m) => /^plan: decide by /.test(m.what));
  check(
    'one measurement can be replayed to say what the reply would have been under another way of choosing between the answers, with no model asked again: the decider always is what happened; the others are counted from what each slot answered and whether it was equivalent; and the plan tries first the way replay says would have won',
    r.compared === 4 &&
      r.actual === 2 &&
      r.ways.decider === 2 &&
      r.ways.most === 3 &&
      r.ways['decider-if-confident'] === 3 &&
      r.ways['decider-unless-majority'] === 3 &&
      r.ceiling === 4 &&
      r.slots.b2 === 2 &&
      Object.keys(WAYS).length === 4 &&
      ways.length >= 1 &&
      ways[0].answers === 1 &&
      ways[0].why.includes('replay') &&
      plan.replayed.actual === 2 &&
      !plan.moves.some((m) => m.what === 'plan: decide by decider'),
    { r, ways: ways.map((m) => [m.what, m.answers]) },
  );
  // the plan's ways of choosing, in the swarm itself
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'It is 42.' : roleOf(b).id === 'a-direct' ? 'ANSWER: 41' : 'ANSWER: 42';
  bonsai.s.script = () => 'ANSWER: 42';
  let asked = 0;
  const forSlip = async ({ answers }) => (
    asked++,
    { ok: true, letter: answers[0].letter, final: answers[0].final, probs: { A: 0.55, B: 0.45 }, ms: 1 }
  );
  const sw = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, decide: forSlip });
  const go = async (decideBy) => sw.answer(Q, { briefs: { ...briefs, plan: { ...briefs.plan, decideBy } } });
  const [always, most, sure, major] = [
    await go('decider'),
    await go('most'),
    await go('decider-if-confident'),
    await go('decider-unless-majority'),
  ];
  await sw.stop();
  check(
    'how the matter is settled is a setting of the plan: the decider always; the answer most slots hold, with the decider not asked; the decider only where it is sure; the decider only where no answer has more than half the slots behind it',
    always.decided === '41' &&
      most.decided === '42' &&
      !most.trace.some((t) => t.stage === 'decide') &&
      sure.decided === '42' &&
      /Not taken \(it gave its choice 0\.55\)/.test(sure.trace.find((t) => t.stage === 'decide').out) &&
      major.decided === '42' &&
      /more than half/.test(major.trace.find((t) => t.stage === 'decide').out) &&
      asked === 3 &&
      most.path === 'most',
    { always: always.decided, most: most.decided, sure: sure.decided, major: major.decided, asked },
  );
  // the reader of answers in words is checked on pairs anyone can judge
  const pairs = knownPairs();
  const truth = (a2, b2) => pairs.find((p) => p.a === a2 && p.b === b2).same;
  const sound = await checkReader({
    reader: 'x',
    pairs,
    judge: async (q, a2, b2) => ({ grade: truth(a2, b2) ? 'right' : 'wrong' }),
  });
  // one that leans to yes but leans further where the answers are the same: read well once the line is put where it tells them apart
  const leaning = await checkReader({
    reader: 'x',
    pairs,
    judge: async (q, a2, b2) => ({ grade: 'right', p: truth(a2, b2) ? 0.95 : 0.7 }),
  });
  // one that only sees what an answer is ABOUT: it says the same to a paraphrase and to a near-miss alike. Four in five overall,
  // and still not believed: it misreads every near-miss
  const topical = await checkReader({
    reader: 'x',
    pairs,
    judge: async (q, a2, b2) => ({
      grade: pairs.find((p) => p.a === a2 && p.b === b2).kind !== 'different' ? 'right' : 'wrong',
    }),
  });
  const yesMan = await checkReader({ reader: 'x', pairs, judge: async () => ({ grade: 'right' }) });
  const silent = await checkReader({ reader: 'x', pairs, judge: async () => ({ grade: 'noref' }) });
  const open = tasks({ split: 'held', each: 1 }).find((t) => t.type === 'open');
  fs.mkdirSync(WORKC, { recursive: true });
  fs.writeFileSync(path.join(WORKC, 'reader.json'), JSON.stringify({ ok: false }));
  const unread = await runRows(
    [open],
    async () => ({ reply: 'The loop starts at one, so the first item is never counted at all.' }),
    { ref: new Map([[open.id, 'The bug is that the loop starts at one and so misses the first item.']]), who: 'a' },
  );
  fs.rmSync(path.join(WORKC, 'reader.json'));
  check(
    'a reader is checked before it is believed: given paraphrases (the same answer in other words), near-misses (one fact changed) and different answers, one that tells them apart is believed, one that only sees what an answer is about is not (however it reads overall), one that says yes to everything is not, and neither is one that does not answer; and while it is not believed, answers in words are not compared',
    pairs.length >= 8 &&
      pairs.some((p) => p.same) &&
      pairs.some((p) => !p.same) &&
      sound.ok &&
      sound.right === sound.asked &&
      pairs.filter((p) => p.kind === 'near').length >= 4 &&
      pairs.filter((p) => p.kind === 'paraphrase').length >= 4 &&
      topical.right / topical.asked >= 0.8 &&
      !topical.ok &&
      topical.kinds.near.right === 0 &&
      leaning.ok &&
      leaning.mark > 0.7 &&
      leaning.atHalf < leaning.right &&
      !yesMan.ok &&
      yesMan.missed.length > 0 &&
      !silent.ok &&
      silent.asked === 0 &&
      unread[0].grade === 'noref' &&
      /failed its own check/.test(unread[0].markWhy || ''),
    { sound, yesMan: [yesMan.right, yesMan.asked], unread: unread[0].grade },
  );
  // no flip goes unnamed
  const fl = flipsBetween({ heldRight: ['q1', 'q2', 'q3'], heldAsked: ['q1', 'q2', 'q3', 'q4'] }, [
    { id: 'q1', grade: 'right' },
    { id: 'q2', grade: 'wrong' },
    { id: 'q3', grade: 'unsure' },
    { id: 'q4', grade: 'right' },
    { id: 'q5', grade: 'right' },
  ]);
  check(
    'an answer that was equivalent at the end of the last pass and is not now is named, and so is one won: a total that did not move (three, and three) can hide two lost and one won; a question that was not asked then is neither',
    fl.lost.join() === 'q2,q3' && fl.won.join() === 'q4',
    fl,
  );
  // every question a second way, and a bar that is held asked more of
  const held = tasks({ split: 'held', each: 2 });
  const second = reworded(held);
  const w = held.find((t) => t.kind === 'write-arrays');
  const body = w.ask.replace(/^Write a JavaScript function `[^`]+` that /, '');
  const refs = reference(second);
  const more = tasks({ split: 'held', each: 2, tiers: { fix: 2 } });
  check(
    "every held question has a second wording that changes how it is put and nothing of what it asks, and is compared with the larger model's answer to the first; and a kind that is asked more of keeps the questions it had and adds to them",
    second.length === held.length &&
      second.every(
        (t, i) =>
          t.ask !== held[i].ask &&
          t.refId === held[i].id &&
          t.id === held[i].id + '~2' &&
          t.split === 'reworded' &&
          t.name === held[i].name,
      ) &&
      reword(w.ask).endsWith(body) &&
      reword(w.ask).startsWith('I need a function in JavaScript') &&
      reword('How long is a piece of string?') === null &&
      refs instanceof Map &&
      more.filter((t) => t.kind === 'fix').length === 4 &&
      more.filter((t) => t.kind === 'bug').length === 2 &&
      more
        .filter((t) => t.kind === 'fix')
        .slice(0, 2)
        .map((t) => t.ask)
        .join() ===
        held
          .filter((t) => t.kind === 'fix')
          .map((t) => t.ask)
          .join(),
    { n: second.length, sample: reword(w.ask).slice(0, 70) },
  );
}
// ---- 6m: STOPPING AND STARTING, FOR EACH CONFIGURATION, GOES ON FROM WHERE IT WAS LEFT
{
  const { configKey, CONFIG_KEY, readConfig, REGISTRY } = await import('../src/catalog.mjs');
  const { RESULTS, WORKC, swarmName } = await import('../training/support/bench.mjs');
  const { PLAN_FILE } = await import('../training/support/plan-file.mjs');
  const { stateFileOf } = await import('../training/state.mjs');
  const { learnedFile } = await import('../src/index.mjs');
  const { execFileSync } = await import('node:child_process');
  const cfg = readConfig();
  const otherSmall = REGISTRY.small.find((m) => m.id !== cfg.a && m.id !== cfg.b).id;
  const otherTarget = REGISTRY.targets.find((m) => m.id !== cfg.target).id;
  const keys = [
    configKey(cfg),
    configKey({ ...cfg, b: otherSmall }),
    configKey({ ...cfg, target: otherTarget }),
    configKey({ ...cfg, c: otherSmall }),
  ];
  check(
    "everything a configuration's training leaves is kept under its own name, apart from every other's: the pass it is in, its plan, its review and reader, its results, what it remembers and what it has learned; another small model, another larger model or a third model is another name",
    new Set(keys).size === 4 &&
      keys[0] === CONFIG_KEY &&
      [RESULTS, WORKC, PLAN_FILE, stateFileOf(), learnedFile()].every((p) => p.includes(CONFIG_KEY)) &&
      swarmName(briefs, 'train', 1).includes(cfg.a) &&
      stateFileOf(otherTarget) !== stateFileOf() &&
      learnedFile('x+y+z', 't') !== learnedFile(),
    { keys },
  );
  // a pass stopped partway, another configuration trained for a while, and the first come back to
  const top = path.join(state, 'passes');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ok = path.join(state, 'ok.mjs');
  fs.writeFileSync(ok, "import fs from 'node:fs';\nfs.appendFileSync(process.argv[2], process.argv[3] + '\\n');\n");
  const ran = path.join(state, 'ran.txt');
  const sh = (body) =>
    execFileSync(
      'bash',
      [
        '-c',
        'cd ' +
          JSON.stringify(root) +
          ' && NODE=' +
          JSON.stringify(process.execPath) +
          ' STEP_WAIT=0 && . training/support/steps.sh && ' +
          body,
      ],
      { encoding: 'utf8' },
    );
  const step = (name, tag) => 'run ' + name + ' ' + JSON.stringify(ok) + ' ' + JSON.stringify(ran) + ' ' + tag;
  const A = JSON.stringify(path.join(top, 'config-a'));
  const B = JSON.stringify(path.join(top, 'config-b'));
  // configuration A: two steps done, then it is stopped (the third never starts)
  sh('open_pass ' + A + ' 1 "a vs t" && ' + step('01-one', 'A1') + ' && ' + step('02-two', 'A2'));
  // configuration B, meanwhile: its own pass, from its own beginning
  sh('open_pass ' + B + ' 1 "b vs t" && ' + step('01-one', 'B1'));
  // back to A: the same pass; what was done is passed over, and it goes on
  sh(
    'open_pass ' +
      A +
      ' 1 "a vs t" && ' +
      step('01-one', 'A1again') +
      ' && ' +
      step('02-two', 'A2again') +
      ' && ' +
      step('03-three', 'A3') +
      ' && echo "x DONE" >> "$OUT/status.txt"',
  );
  // and B again: its one step is not done twice either
  sh('open_pass ' + B + ' 1 "b vs t" && ' + step('01-one', 'B1again') + ' && ' + step('02-two', 'B2'));
  // A, finished, started once more: a finished pass is not carried on (the next pass has another number; the same number begins anew)
  sh('open_pass ' + A + ' 1 "a vs t" && ' + step('01-one', 'A1new'));
  const did = fs.readFileSync(ran, 'utf8').trim().split('\n');
  const statusA = fs.readFileSync(path.join(top, 'config-a', 'pass-1', 'status.txt'), 'utf8');
  check(
    'stopping, training another configuration and coming back goes on from where it was left: each configuration has its own pass, a step that ended well is not done again, the pass goes on from the step it stopped before, the other configuration is untouched by it, and a pass that finished is not carried on',
    did.join() === 'A1,A2,B1,A3,B2,A1new' &&
      /RESUMED/.test(fs.readFileSync(path.join(top, 'config-b', 'pass-1', 'status.txt'), 'utf8')) &&
      !/DONE/.test(statusA) &&
      /START 01-one/.test(statusA),
    { did },
  );
}
// ---- 6n: PROGRESS TOWARD PARITY IS A PERCENTAGE, parity is 100 and nothing less, and a pass plans from the gap
{
  const { parity: par, percentOf } = await import('../training/state.mjs');
  const { makePlan } = await import('../training/plan.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const rows = (right, wrong) => [
    ...Array(right).fill({ grade: 'right', kind: 'fix' }),
    ...Array(wrong).fill({ grade: 'wrong', kind: 'fix' }),
  ];
  const report = {
    compared: 56,
    right: 31,
    wrong: 25,
    unsure: 0,
    lost: 6,
    slots: { 'a-direct': { stage: 'draft', ran: 56, right: 14, silent: 0, ms: 1 } },
  };
  const plan = makePlan({
    state: { pass: 0, tried: {} },
    briefs,
    report,
    reportIsThisPass: true,
    steps: steps(briefs),
    tries: 2,
  });
  check(
    'how far the swarm is toward parity is a percentage of the answers that are equivalent, rounded down so that 100 is said only when every answer is; a pass states its gap (how much is on the table and not chosen, how much no slot had)',
    par(rows(9, 3)).percent === 75 &&
      par(rows(1999, 1)).percent === 99.9 &&
      par(rows(3, 0)).percent === 100 &&
      par(rows(3, 0)).level === true &&
      par(rows(1999, 1)).level === false &&
      percentOf(0, 0) === 0 &&
      plan.gap.percent === 55.3 &&
      plan.gap.reachableByChoosing === 66 &&
      plan.gap.toClose === 25 &&
      plan.gap.choosing === 6 &&
      plan.gap.drafting === 19,
    { gap: plan.gap },
  );
}
// ---- 6o: what the first long session showed (2026-11-16): every change to the flow had been judged on nothing
{
  const { briefKey } = await import('../training/support/recover.mjs');
  const { swarmName } = await import('../training/support/bench.mjs');
  const { shapeOf, steps } = await import('../training/arrange.mjs');
  const withFlow = {
    ...briefs,
    flow: [
      { do: 'draft' },
      { do: 'try' },
      { do: 'decide', keep: 2 },
      { do: 'check' },
      { do: 'decide' },
      { do: 'write' },
    ],
  };
  const other = {
    ...briefs,
    flow: [{ do: 'draft' }, { do: 'try' }, { do: 'check' }, { do: 'revise' }, { do: 'decide' }, { do: 'write' }],
  };
  const names = new Set(steps(briefs).map((c) => swarmName(c.briefs, 'train', 1)));
  check(
    'a measurement is named for the flow it was made with: an arrangement with another flow is not handed the measurement of the one it came from (it was, and every flow tried scored exactly what the swarm as it was scored); every arrangement one change away has a name of its own; and one without a flow keeps the name it had',
    briefKey(withFlow) !== briefKey(briefs) &&
      briefKey(withFlow) !== briefKey(other) &&
      swarmName(withFlow, 'train', 1) !== swarmName(briefs, 'train', 1) &&
      names.size === steps(briefs).length &&
      !names.has(swarmName(briefs, 'train', 1)) &&
      briefKey({ ...briefs }) === briefKey(briefs) &&
      shapeOf(withFlow) !== shapeOf(briefs),
    { n: names.size, of: steps(briefs).length },
  );
  // the decider between the drafts and the checks, settling it only if it is sure
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'It is 42.' : roleOf(b).id === 'a-direct' ? 'ANSWER: 41' : 'ANSWER: 42';
  bonsai.s.script = () => 'ANSWER: 42';
  let conf = 0.9;
  const asked = [];
  const decider = async ({ answers }) => (
    asked.push(answers.length),
    {
      ok: true,
      letter: answers[1].letter,
      final: answers[1].final,
      probs: { [answers[0].letter]: 1 - conf, [answers[1].letter]: conf },
      ms: 1,
    }
  );
  const sw = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, decide: decider });
  const early = {
    ...briefs,
    flow: [{ do: 'draft' }, { do: 'decide', sure: 0.75 }, { do: 'check' }, { do: 'decide' }, { do: 'write' }],
  };
  const sure = await sw.answer(Q, { briefs: early });
  conf = 0.6;
  const unsure = await sw.answer(Q, { briefs: early });
  await sw.stop();
  check(
    'the decider can stand between the drafts and the checks: where it is sure it settles the matter there and the checks are passed over; where it is not, nothing is settled or thrown away, the checks run, and it is asked again after them',
    sure.decided === '42' &&
      sure.path === 'decided-early' &&
      !sure.trace.some((t) => t.stage === 'check') &&
      sure.trace.filter((t) => t.stage === 'decide').length === 1 &&
      unsure.trace.filter((t) => t.stage === 'check').length === 2 &&
      unsure.trace.filter((t) => t.stage === 'decide').length === 2 &&
      /Not sure enough/.test(unsure.trace.find((t) => t.stage === 'decide').out) &&
      unsure.decided === '42',
    { sure: sure.path, unsure: unsure.trace.map((t) => t.stage) },
  );
  // a rule changes how a pass trains once in that pass
}
// ---- 6p: the work of a seat on a team: conversation, and what it means for two replies to be equivalent
{
  const {
    tasks: make,
    KIND_NAMES: NAMES,
    CODE_KIND_NAMES,
    CREW_KIND_NAMES,
    EQUIVALENCE,
    kindsFor,
    messagesOf,
    reworded,
  } = await import('../training/tasks.mjs');
  const { talkEquivalent, faultsOf } = await import('../training/support/equivalent.mjs');
  const { talkPairs, checkReader } = await import('../training/readers.mjs');
  const tr = make({ split: 'train', each: 6, kinds: CREW_KIND_NAMES });
  const he = make({ split: 'held', each: 6, kinds: CREW_KIND_NAMES });
  const follow = he.find((t) => t.turns.length === 3);
  const ticket = tr.find((t) => /A ticket is attached/.test(t.system));
  const again = reworded(he);
  check(
    'a seat on a team is written to in a conversation, so that is what is asked: six kinds in the two modes (an everyday question, something it cannot do or must ask about, a piece of writing, conversation itself; a question of good practice, their own project), each sent as a seat is sent one (a system line that says who is speaking and how to reply, then the turns), some with earlier turns and some with a ticket attached; the held ones are made from other requests than the train ones; and each is put a second way with the rest of the conversation as it was',
    CREW_KIND_NAMES.join() === 'answer,request,piece,talk,practice,shown' &&
      tr.length === 36 &&
      tr.every((t) => t.type === 'talk' && t.limit > 0 && /YOUR REPLY/.test(t.system)) &&
      new Set(tr.filter((t) => t.mode === 'simple').map((t) => t.kind)).size === 4 &&
      new Set(tr.filter((t) => t.mode === 'developer').map((t) => t.kind)).size === 2 &&
      messagesOf(tr[0])[0].role === 'system' &&
      messagesOf(tr[0]).slice(-1)[0].content === tr[0].ask &&
      messagesOf({ ask: 'x' }).length === 1 &&
      follow &&
      messagesOf(follow).length === 4 &&
      ticket &&
      /can you take it|what does it need/.test(ticket.ask) &&
      !he.some((t) => tr.some((x) => x.ask === t.ask)) &&
      JSON.stringify(make({ split: 'held', each: 6, kinds: CREW_KIND_NAMES }).map((t) => t.ask)) ===
        JSON.stringify(he.map((t) => t.ask)) &&
      again.length >= 30 &&
      again.every(
        (t) =>
          t.turns[t.turns.length - 1].content === t.ask &&
          t.ask !== he.find((x) => x.id === t.refId).ask &&
          t.turns.length === he.find((x) => x.id === t.refId).turns.length,
      ) &&
      // the kinds that were there before are made as they were: what was measured stays comparable
      JSON.stringify(make({ split: 'held', each: 3, kinds: CODE_KIND_NAMES }).map((t) => t.ask)) ===
        JSON.stringify(
          make({ split: 'held', each: 3 })
            .filter((t) => CODE_KIND_NAMES.includes(t.kind))
            .map((t) => t.ask),
        ),
    { n: tr.length, again: again.length },
  );
  check(
    'what the swarm is to be equivalent on is chosen from a list kept as data: The Crew (programming and the conversation around it) where nothing is chosen, and with it or in its place Math, Logic and Reasoning; a pass asks the kinds of all that are chosen, and a name that is not on the list is passed over',
    EQUIVALENCE.targets.map((t) => t.id).join() === 'crew,math,logic,reasoning' &&
      NAMES.join() === [...CODE_KIND_NAMES, ...CREW_KIND_NAMES, 'agent'].join() &&
      kindsFor(['crew']).join() === NAMES.join() &&
      kindsFor([]).join() === NAMES.join() &&
      kindsFor(['nothing']).join() === NAMES.join() &&
      kindsFor(['math']).slice().sort().join() === 'chain,count,rate,shop,units' &&
      kindsFor(['math', 'crew']).length === NAMES.length + 5 &&
      kindsFor(['logic', 'reasoning']).length === 6 &&
      make({ split: 'held', each: 2, kinds: kindsFor(['math', 'logic', 'reasoning']) }).length === 22 &&
      EQUIVALENCE.targets.every((t) =>
        t.kinds.every((k) => make({ split: 'train', each: 1, kinds: [k] }).length === 1),
      ),
    kindsFor(['math', 'logic']),
  );
  // the conduct of a reply, read off its words
  const about = { limit: 20, claims: true, simple: true };
  check(
    "the conventions of the conversation are read off the words, with no model: a reply that says it did what it cannot do, runs well past the length asked, opens by praising the question, closes by offering more help, or uses the words of the trade to someone who is not a developer; saying that it cannot book, or a piece written in the person's own voice, is none of these",
    faultsOf('All done! I have booked your table for four on Friday.', about).includes(
      'says it did something it cannot do',
    ) &&
      faultsOf('Your reservation is confirmed for 7pm.', about).length === 1 &&
      faultsOf('I cannot book it for you, but the restaurant takes bookings by phone.', about).length === 0 &&
      faultsOf("I've paid the rent and I would like the boiler fixed this week.", { limit: 120 }).length === 0 &&
      faultsOf('Great question! Rabbits can eat celery.', about)[0] === 'opens by praising the question' &&
      faultsOf('Rabbits can eat celery. Let me know if you need anything else!', about)[0] ===
        'closes by offering more help' &&
      faultsOf('Rabbits can eat celery. Did you want to know about the leaves too?', about).length === 0 &&
      faultsOf(Array(30).fill('word').join(' '), about)[0] === 'longer than was asked for' &&
      faultsOf(Array(22).fill('word').join(' '), about).length === 0 &&
      faultsOf('Check the API endpoint.', about)[0] === "uses a developer's words" &&
      faultsOf('Check the API endpoint.', { limit: 20 }).length === 0,
    faultsOf('All done! I have booked your table for four on Friday.', about),
  );
  // a decider that says what the test tells it to: one request, three yes-or-no questions
  const said = { same: 0.9, firstAsks: 0.1, secondAsks: 0.1 };
  const sent = [];
  const fetchImpl = async (url, o) => (
    sent.push({ url, body: JSON.parse(o.body) }),
    {
      ok: true,
      json: async () => ({ answers: Object.fromEntries(Object.entries(said).map(([k, v]) => [k, { noul: v }])) }),
    }
  );
  const t = tr.find((x) => x.kind === 'request');
  const eq = (ref, mine, more = {}) => talkEquivalent(t, ref, mine, { reader: 'http://reader', fetchImpl, ...more });
  const ok = await eq(
    'You will need to book it yourself: ring the restaurant.',
    'I cannot book it. Phone them and ask for the table.',
  );
  said.secondAsks = 0.9;
  const asked = await eq('Ring the restaurant and ask for the table.', 'Which restaurant did you have in mind?');
  said.firstAsks = 0.9;
  const bothAsk = await eq('Which town are you in?', 'Whereabouts are you?');
  Object.assign(said, { firstAsks: 0.1, secondAsks: 0.1, same: 0.3 });
  const other = await eq('Ring the restaurant.', 'Use the booking website.');
  said.same = 0.9;
  const claimed = await eq('Ring the restaurant and ask for the table.', 'I have booked the table for you.');
  const bothClaim = await eq('I have booked it.', 'I have booked the table for you.');
  const marked = await eq('Ring them.', 'Phone them.', { mark: 0.95 });
  check(
    "two replies in a conversation are equivalent when they do the same thing for the person, and that is three things: the same act (one that only asks where the other answered understood the message differently, whatever else it says), the same substance (the decision model says so, in the same request), and no convention broken that the larger model's reply kept (a fault they share is not a difference: the larger model's reply is the mark). The part it was lost on is said. With no decision model the question is not compared, and with no reply there is no answer",
    ok.grade === 'right' &&
      asked.grade === 'wrong' &&
      asked.part === 'act' &&
      asked.p === 0 &&
      /asked where the larger model answered/.test(asked.why) &&
      bothAsk.grade === 'right' &&
      other.grade === 'wrong' &&
      other.part === 'substance' &&
      claimed.grade === 'wrong' &&
      claimed.part === 'conduct' &&
      claimed.faults[0] === 'says it did something it cannot do' &&
      bothClaim.grade === 'right' &&
      marked.grade === 'wrong' &&
      marked.part === 'substance' &&
      sent.length === 7 &&
      sent[0].url === 'http://reader/v1/systemone' &&
      Object.keys(sent[0].body.questions).join() === 'same,firstAsks,secondAsks' &&
      sent[0].body.questions.same.type === 'noul' &&
      sent[0].body.state.message === t.ask &&
      /cannot book/.test(sent[0].body.state.setting) &&
      /DATA/.test(sent[0].body.state.guidance) &&
      (await talkEquivalent(t, 'x', 'y', {})).grade === 'noref' &&
      (await eq('x', '')).grade === 'unsure' &&
      (await eq('', 'y')).grade === 'noref' &&
      (await t.equivalent('Ring them.', 'Phone them.', { reader: 'http://reader', fetchImpl })).grade === 'right' &&
      t.usable('Sure!') &&
      !t.usable(''),
    { ok, asked, other, claimed },
  );
  // the reader of replies in a conversation is checked on pairs anyone can judge, before it is believed
  const pairs = talkPairs();
  const fair = await checkReader({
    reader: 'k',
    pairs,
    judge: async (task, a, b) => ({ grade: 'x', p: pairs.find((p) => p.a === a && p.b === b).same ? 0.85 : 0.2 }),
  });
  const blind = await checkReader({ reader: 'k', pairs, judge: async () => ({ grade: 'right', p: 0.9 }) });
  const topicalTalk = await checkReader({
    reader: 'k',
    pairs,
    judge: async (task, a, b) => ({
      grade: 'x',
      p: pairs.find((p) => p.a === a && p.b === b).kind === 'different' ? 0.2 : 0.85,
    }),
  });
  const { readerOk, readerMark, READER_FILE } = await import('../training/support/reader-file.mjs');
  const rdir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-reader-'));
  fs.writeFileSync(READER_FILE(rdir), JSON.stringify({ ok: true, mark: 0.75, talk: { ok: false, mark: 0.6 } }));
  check(
    'the reader of replies in a conversation is tried on pairs anyone can judge (the same help said two ways; near-misses with one fact changed; another fact, a refusal, a question back, a claim to have done it), and is believed apart from the reader of answers in words: one can fail its check while the other is believed, and each has its own line',
    pairs.length === 18 &&
      pairs.filter((p) => p.same).length === 7 &&
      pairs.filter((p) => p.kind === 'near').length === 4 &&
      pairs.every((p) => p.task.system && p.task.turns.length === 1) &&
      fair.ok &&
      fair.right === 18 &&
      !blind.ok &&
      blind.right === 11 &&
      !topicalTalk.ok &&
      topicalTalk.kinds.near.right === 0 &&
      readerOk(rdir) &&
      readerOk(rdir, 'open') &&
      !readerOk(rdir, 'talk') &&
      readerMark(rdir) === 0.75 &&
      readerMark(rdir, 'talk') === 0.6 &&
      readerOk(path.join(rdir, 'none'), 'talk'),
    { fair: fair.right, blind: blind.right },
  );
  // the swarm itself answers a conversation: every slot is shown the system line the seat was given
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'Ring the restaurant: I cannot book it for you.' : 'ANSWER: ring the restaurant';
  bonsai.s.script = () => 'ANSWER: ring the restaurant';
  const sw = await createSwarm({ attach: { a: lfm.base, b: bonsai.base } });
  const got = await sw.answer(messagesOf(t));
  await sw.stop();
  check(
    'the swarm takes a conversation as it is sent to a seat: every slot is shown the system line the seat was given (who is speaking, what it cannot do, how the reply is shaped), and one reply comes out',
    got.ok &&
      got.reply === 'Ring the restaurant: I cannot book it for you.' &&
      lfm.s.calls.length > 0 &&
      [...lfm.s.calls, ...bonsai.s.calls].every(
        (c) =>
          /You cannot book, buy, pay/.test(c.messages[0].content) &&
          /The person set this for the conversation/.test(c.messages[0].content),
      ),
    { reply: got.reply, calls: lfm.s.calls.length },
  );
  // which kinds a pass asks: what its record says; a record from before there was a choice ends its pass on programming
  const { readState, writeState } = await import('../training/state.mjs');
  const { questions } = await import('../training/support/bench.mjs');
  const { readConfig, writeConfig } = await import('../src/catalog.mjs');
  const was = readState();
  const kindsOf = (list) => [...new Set(list.map((q) => q.kind))].join();
  writeState({ ...was, kinds: ['chain', 'order'], history: [{ pass: 1 }] });
  const byRecord = kindsOf(questions('held', 2));
  const older = { ...was, history: [{ pass: 1 }] };
  delete older.kinds;
  writeState(older);
  const before = kindsOf(questions('held', 2));
  const fresh = { ...was, history: [] };
  delete fresh.kinds;
  writeState(fresh);
  const cfg = readConfig();
  writeConfig({ equivalence: ['math'] });
  const chosen = kindsOf(questions('held', 2));
  const kept = readConfig().equivalence;
  writeConfig({ a: cfg.a });
  const stillKept = readConfig().equivalence;
  writeConfig({ equivalence: ['crew'] });
  const first = kindsOf(questions('held', 2));
  // the questions a person wrote: read from their own folder, asked after the ones made, every second one held back
  const { readOwn, QUESTIONS_DIR, MOST_OWN } = await import('../training/tasks.mjs');
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(QUESTIONS_DIR, 'crew.json'),
    JSON.stringify({
      questions: [
        { ask: 'Move my dentist to Friday.' },
        { ask: 'Is a fixed sleep a fix for a flaky test?', mode: 'developer' },
        { ask: '   ' },
        { ask: 'thanks!' },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(QUESTIONS_DIR, 'math.json'),
    JSON.stringify({ questions: [{ ask: 'What is 17 times 23?' }, { ask: 'Half of 3 is?' }] }),
  );
  fs.writeFileSync(path.join(QUESTIONS_DIR, 'logic.json'), '{ not json');
  const own = readOwn(['crew', 'math', 'logic']);
  const ownTr = make({ split: 'train', each: 1, kinds: ['answer'], own }).filter((x) => x.kind.startsWith('own-'));
  const ownHe = make({ split: 'held', each: 1, kinds: ['answer'], own }).filter((x) => x.kind.startsWith('own-'));
  writeState({ ...was, kinds: ['answer'], own: { math: [{ ask: 'What is 2 + 2?' }] }, history: [{ pass: 1 }] });
  const fromRecord = questions('held', 1)
    .concat(questions('train', 1))
    .filter((x) => x.kind.startsWith('own-'))
    .map((x) => x.ask);
  writeState({ ...was, kinds: ['answer'], history: [] });
  writeConfig({ equivalence: ['crew'] });
  const firstPass = questions('train', 1)
    .filter((x) => x.kind.startsWith('own-'))
    .map((x) => x.ask);
  const crewTr = ownTr.filter((x) => x.kind === 'own-crew');
  writeState(was);
  check(
    'a person can write questions of their own for each body of work (one file each, edited from the page): blank ones and a file that will not read are no questions; the first, third ... are train questions and the second, fourth ... held, so nothing measured is what was chosen on; for The Crew each goes to the seat its mode names, for the others with a plain instruction to answer; each is judged as a reply in a conversation; a pass asks those its record kept, and a first pass those written now',
    MOST_OWN === 200 &&
      Object.keys(own).join() === 'crew,math' &&
      own.crew.length === 3 &&
      crewTr.map((x) => x.ask).join('|') === 'Move my dentist to Friday.|thanks!' &&
      ownHe
        .filter((x) => x.kind === 'own-crew')
        .map((x) => x.ask)
        .join() === 'Is a fixed sleep a fix for a flaky test?' &&
      ownHe.find((x) => x.kind === 'own-crew').mode === 'developer' &&
      crewTr[0].mode === 'simple' &&
      /cannot book/.test(crewTr[0].system) &&
      crewTr[0].claims &&
      ownTr.find((x) => x.kind === 'own-math').system ===
        'Answer the question. Give the answer itself first, then as much working as it needs, and nothing after it.' &&
      ownTr.find((x) => x.kind === 'own-math').limit === 0 &&
      [...ownTr, ...ownHe].every((x) => x.type === 'talk' && typeof x.equivalent === 'function' && x.again === null) &&
      reworded(ownHe).length === 0 &&
      fromRecord.join() === 'What is 2 + 2?' &&
      firstPass.join('|') === 'Move my dentist to Friday.|thanks!',
    { train: ownTr.map((x) => x.id), held: ownHe.map((x) => x.id), fromRecord, firstPass },
  );
  check(
    'a pass asks the kinds its record names, so that it ends on the questions it began with whatever is chosen meanwhile; a record from before there was a choice ends its pass on the programming questions; a first pass asks what is chosen; and the choice is kept in the configuration through a change of model',
    byRecord === 'chain,order' &&
      before === CODE_KIND_NAMES.join() &&
      chosen.split(',').sort().join() === 'chain,count,rate,shop,units' &&
      kept.join() === 'math' &&
      stillKept.join() === 'math' &&
      first === NAMES.join(),
    { byRecord, before, chosen, kept },
  );
}
// ---- 6q: more deciders: every one takes the same request, and each says how it is started and where it can run
{
  const { REGISTRY } = await import('../src/catalog.mjs');
  const { spawnSync } = await import('node:child_process');
  const ds = REGISTRY.deciders;
  const envOf = (id) =>
    spawnSync(process.execPath, ['training/support/decider-env.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, DECIDER_ID: id },
    }).stdout;
  const deciderSh = (id, ...a) =>
    spawnSync('bash', ['training/decider.sh', ...a], {
      encoding: 'utf8',
      env: { ...process.env, DECIDER_ID: id, NODE: process.execPath },
    });
  const cuda = deciderSh('karpo-31b', 'serve', '8999');
  // one llama.cpp serves: named to the decider script with its file and flags; not served before its file is fetched and checked
  const llamaEnv = envOf('jeffan-4b');
  // (only where its file is not here: where it is, serve would start it, and wait on it)
  const llamaHere = fs.existsSync(path.join('.work', 'deciders', 'jeffan-4b', '.complete'));
  const llamaServe = llamaHere ? { status: 1, stdout: '' } : deciderSh('jeffan-4b', 'serve', '8999');
  const quoted = spawnSync(
    'bash',
    [
      '-c',
      'eval "$(DECIDER_ID=startlux-4b "$0" training/support/decider-env.mjs)"; printf %s "$D_KIND|$D_WEIGHTS_REV|$D_NAME"',
      process.execPath,
    ],
    { encoding: 'utf8' },
  ).stdout;
  check(
    "there are many deciders to choose from: each carries its score on the community Decision Index and the entry it was scored as, where it can run (an Apple silicon Mac, an NVIDIA GPU), and how the swarm starts it (Kev, StartLux through MLX) or, where the swarm cannot, its maker's own instructions; every file it fetches is pinned to a revision; and the decider script refuses to start one that needs another machine, saying what it needs",
    ds.length === 23 &&
      ds.every(
        (x) =>
          x.index &&
          Number.isFinite(x.index.score) &&
          x.index.as &&
          Array.isArray(x.runsOn) &&
          x.runsOn.length &&
          x.serve &&
          x.license &&
          x.needs,
      ) &&
      ds.filter((x) => x.serve.kind === 'kev').length === 4 &&
      ds
        .filter((x) => x.serve.kind === 'startlux-mlx')
        .map((x) => x.id)
        .sort()
        .join() === 'startlux-27b,startlux-2b,startlux-4b,startlux-9b' &&
      ds
        .filter((x) => x.serve.kind === 'startlux-mlx')
        .every(
          (x) =>
            /^[0-9a-f]{40}$/.test(x.serve.weightsRev) &&
            /^[0-9a-f]{40}$/.test(x.serve.codeRev) &&
            x.serve.bytes > 1e9 &&
            x.runsOn.join() === 'mac' &&
            /NC/.test(x.license),
        ) &&
      // the ones llama.cpp serves (its llama-server answers /v1/systemone itself): one pinned GGUF file and the maker's flags, on a Mac
      ds.filter((x) => x.serve.kind === 'llama').length >= 3 &&
      ds
        .filter((x) => x.serve.kind === 'llama')
        .every(
          (x) =>
            /^[0-9a-f]{40}$/.test(x.serve.weightsRev) &&
            /^[0-9a-f]{64}$/.test(x.serve.sha256) &&
            x.serve.bytes > 1e9 &&
            x.serve.file.endsWith('.gguf') &&
            Array.isArray(x.serve.args) &&
            x.runsOn.includes('mac'),
        ) &&
      ds
        .filter((x) => x.serve.kind === 'cuda')
        .every((x) => x.runsOn.join() === 'cuda' && /^[0-9a-f]{40}$/.test(x.serve.weightsRev) && x.serve.how) &&
      Math.max(...ds.map((x) => x.index.score)) === ds.find((x) => x.id === 'karpo-31b').index.score &&
      quoted === 'startlux-mlx|56f18acdc9502c44fdb80234c09a2276e3398916|StartLux Decision 4B' &&
      /D_KIND='kev'/.test(envOf('')) &&
      cuda.status === 1 &&
      /is not started by the swarm: it needs an NVIDIA GPU with 80 GB/.test(cuda.stdout) &&
      /SWARM_DECIDER=/.test(cuda.stdout) &&
      deciderSh('karpo-31b', 'ready').status === 1 &&
      /D_KIND='llama'/.test(llamaEnv) &&
      /D_FILE='Jeffan-4B-2010-Q4_K_M\.gguf'/.test(llamaEnv) &&
      /D_ARGS='-c 8192 -b 8192 -ub 8192 -np 1 --cache-ram 0'/.test(llamaEnv) &&
      (llamaHere || (llamaServe.status === 1 && /is not installed here/.test(llamaServe.stdout))),
    { n: ds.length, cuda: cuda.stdout.slice(0, 120), llama: llamaServe.stdout.slice(0, 120) },
  );
}
// ---- 6r: the eight ways the search was given more to try, after the first long session (2026-11-16)
{
  const { steps, shapeOf } = await import('../training/arrange.mjs');
  const { examplesFor } = await import('../src/orchestrate.mjs');
  const { briefKey } = await import('../training/support/recover.mjs');
  // 1: the settled answer handed over as it is
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'Rewritten: it is 41.' : 'six sevens\nANSWER: 42');
  bonsai.s.script = () => 'because\nANSWER: 42';
  const asked = await swarm.answer(Q, { briefs: { ...briefs, plan: { ...briefs.plan, writeAs: 'settled' } } });
  const wrote = await swarm.answer(Q, { briefs });
  const moves = steps(briefs).map((c) => c.name);
  check(
    'with writeAs "settled" the writer is passed over and the settled answer goes out as it stands, with the work behind it (the writer had changed it on 6 of 70); without it the writer writes as before; and the search can turn it on and off',
    !asked.trace.some((r) => r.stage === 'write') &&
      /ANSWER: 42|\b42\b/.test(asked.reply) &&
      !/41/.test(asked.reply) &&
      /\+as-settled/.test(asked.path) &&
      wrote.trace.some((r) => r.stage === 'write') &&
      moves.includes('plan: the settled answer goes out as it is') &&
      steps({ ...briefs, plan: { ...briefs.plan, writeAs: 'settled' } }).some(
        (c) => c.name === 'plan: the writer writes the reply again',
      ),
    { asked: asked.reply, path: asked.path },
  );
  // 3: worked examples
  const pool = [
    {
      kind: 'write-arrays',
      ask: 'Write a JavaScript function `sumAll(xs)` that adds every number in an array.',
      answer: '```js\nfunction sumAll(xs){return xs.reduce((a,b)=>a+b,0)}\n```',
    },
    { kind: 'trace', ask: 'What does this print? let x = 2; console.log(x * 3);', answer: '6' },
    {
      kind: 'write-strings',
      ask: 'Write a JavaScript function `shout(s)` that upper-cases a string.',
      answer: '```js\nconst shout=(s)=>s.toUpperCase()\n```',
    },
  ];
  const q = 'Write a JavaScript function `sumEven(xs)` that adds the even numbers in an array.';
  const two = examplesFor({ examples: 2 }, pool, q);
  const withPool = { ...briefs, examples: pool };
  const shown = { ...withPool, slots: withPool.slots.map((s) => (s.id === 'a-direct' ? { ...s, examples: 2 } : s)) };
  check(
    'a slot with examples is shown the worked examples nearest the question (by the words they share, code with code), as substance and not a format; none without; the pool is part of what is measured only where a slot is shown it; and the search offers showing them to each drafter, then four, or none again',
    /WORKED EXAMPLES/.test(two) &&
      two.indexOf('sumAll') > 0 &&
      (two.match(/EXAMPLE \d/g) || []).length === 2 &&
      two.indexOf('sumAll') < (two.indexOf('shout') < 0 ? 1e9 : two.indexOf('shout')) &&
      !/console\.log\(x \* 3\)/.test(two) &&
      examplesFor({}, pool, q) === '' &&
      examplesFor({ examples: 2 }, [], q) === '' &&
      briefKey(withPool) === briefKey(briefs) &&
      briefKey(shown) !== briefKey(withPool) &&
      briefKey({ ...shown, examples: pool.slice(0, 1) }) !== briefKey(shown) &&
      steps(withPool).some((c) => c.name === 'a-direct sees 2 worked examples') &&
      !steps(briefs).some((c) => /worked examples/.test(c.name)) &&
      steps(shown).some((c) => c.name === 'a-direct sees 4 worked examples') &&
      steps(shown).some((c) => c.name === 'a-direct sees no worked examples') &&
      shapeOf(shown) !== shapeOf(withPool),
    two.slice(0, 300),
  );
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'It is 42.' : 'ANSWER: 42');
  bonsai.s.script = () => 'ANSWER: 42';
  await swarm.answer([{ role: 'user', content: q }], {
    briefs: { ...shown, plan: { ...shown.plan, byBehaviour: false } },
  });
  const sysOf = (id) => ((lfm.s.calls.find((c) => roleOf(c).id === id) || {}).messages || [{}])[0].content || '';
  check(
    'and the slot shown them is told them in its own instructions; the others are not',
    /WORKED EXAMPLES/.test(sysOf('a-direct')) && !/WORKED EXAMPLES/.test(sysOf('a-steps')),
    [sysOf('a-direct').slice(-200), sysOf('a-steps').slice(-120)],
  );
  const { examplePool } = await import('../training/support/examples.mjs');
  const qs = tasks({ split: 'train', each: 3, kinds: ['write-arrays', 'trace'] });
  const ref = new Map(qs.map((x, i) => [x.id, 'answer ' + 'x'.repeat(10 * (i + 1))]));
  const ep = examplePool({ list: qs, ref, perKind: 2 });
  check(
    "the pool is the larger model's own answers to train questions, the shortest two of each kind; never a held question",
    ep.length === 4 &&
      ep.filter((x) => x.kind === 'trace').length === 2 &&
      ep.every((x) => qs.some((t) => t.ask === x.ask)) &&
      ep.find((x) => x.kind === 'write-arrays').answer.length <=
        Math.min(...qs.filter((t) => t.kind === 'write-arrays').map((t) => ref.get(t.id).length)) &&
      examplePool({ list: tasks({ split: 'held', each: 2, kinds: ['trace'] }), ref: new Map() }).length === 0,
    ep.map((x) => x.kind),
  );
  // 4: a drafter told what another is told
  const rep = steps(briefs).filter((c) => / drafts as /.test(c.name));
  check(
    'a drafter can be told what another drafter is told, on its own model (with every slot in use, the way to have more of the best drafter is in place of the weakest), each such arrangement a different one',
    rep.length >= 6 &&
      new Set(rep.map((c) => c.hash)).size === rep.length &&
      rep.every((c) => {
        const [s, t] = c.name.split(' drafts as ');
        const x = c.briefs.slots.find((y) => y.id === s);
        const y = briefs.slots.find((z) => z.id === t.replace(' does', ''));
        return x.brief === y.brief && x.member === briefs.slots.find((z) => z.id === s).member;
      }),
    rep.map((c) => c.name).slice(0, 4),
  );
  // 2: briefs written by the larger model
  const { slotsToTeach } = await import('../training/write-briefs.mjs');
  const { missesOf, briefAsk, candidatesIn } = await import('../training/support/teach.mjs');
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-teach-'));
  const mk = (split, id, grade, same) =>
    JSON.stringify({
      split,
      seed: 5,
      id,
      grade,
      ask: 'Q ' + id,
      ref: 'R',
      refReply: 'the wanted answer ' + id,
      trace: [{ slot: 'a-steps', stage: 'draft', out: 'I wrote ' + id, same }],
    });
  fs.writeFileSync(
    path.join(wdir, 'swarm-runs.jsonl'),
    [
      mk('train', 't1', 'wrong', false),
      mk('held', 'h1', 'wrong', false),
      mk('train', 't2', 'right', true),
      mk('train', 't3', 'wrong', false),
    ].join('\n') + '\n',
  );
  const missed = missesOf(wdir, 'a-steps', { seed: 5 });
  const said = candidatesIn(
    'Sure:\n[{"name":"plainer","brief":"Answer the question in a few short steps and end with a line that starts ANSWER: and holds only the answer."},{"name":"short","brief":"too short"}]',
    'the larger model',
  );
  check(
    "when the slots the plan found failing have no briefs left to try, the larger model writes new ones: it is shown the slot's brief, what it wrote on TRAIN questions the swarm got wrong and the answer wanted (never a held question), and its reply is read for briefs a small model can follow",
    slotsToTeach(
      {
        findings: [
          { id: 'silent:a-steps', slot: 'a-steps' },
          { id: 'drafts-short', stage: 'draft' },
          { id: 'check-worse:a-critic', slot: 'a-critic' },
          { id: 'decider-threw:decide', slot: 'decide' },
        ],
      },
      briefs,
    ).join() === 'a-steps,a-critic' &&
      missed.map((x) => x.question).join() === 'Q t3,Q t1' &&
      missed[0].wanted === 'the wanted answer t3' &&
      /ANSWER:/.test(
        briefAsk(
          briefs.slots.find((s) => s.id === 'a-steps'),
          missed,
        ),
      ) &&
      /never mention these questions/.test(briefAsk(briefs.slots[0], missed)) &&
      said.length === 1 &&
      said[0].name === 'the larger model: plainer' &&
      candidatesIn('no json here').length === 0,
    { missed, said },
  );
  // 5: who could draft what nobody drafts
  const { gapOf } = await import('../training/members-probe.mjs');
  const rowsG = [
    {
      id: 'a',
      grade: 'wrong',
      trace: [
        { stage: 'draft', same: false },
        { stage: 'draft', same: false },
      ],
    },
    { id: 'b', grade: 'wrong', trace: [{ stage: 'draft', same: true }] },
    {
      id: 'c',
      grade: 'right',
      trace: [
        { stage: 'draft', same: false },
        { stage: 'revise', same: true },
      ],
    },
    { id: 'd', grade: 'noref', trace: [{ stage: 'draft', same: false }] },
  ];
  check(
    'the questions another small model is asked are those no slot drafted as the larger model did (a revision that got there counts as drafted)',
    gapOf(rowsG)
      .map((r) => r.id)
      .join() === 'a',
    gapOf(rowsG).map((r) => r.id),
  );
  // 7: another decider put the same choices
  const { choicesOf, replayWith } = await import('../training/decider-replay.mjs');
  const recRow = (id, nowRight, rightFinal) => ({
    id,
    ask: 'What is it?',
    trace: [
      { slot: 'a-direct', stage: 'draft', final: '41', out: 'w\nANSWER: 41', same: rightFinal === '41' },
      { slot: 'b-direct', stage: 'draft', final: '42', out: 'w\nANSWER: 42', same: rightFinal === '42' },
      { slot: 'a-critic', stage: 'check', final: 'B', out: 'B is right' },
      {
        slot: 'decide',
        stage: 'decide',
        final: nowRight ? rightFinal : rightFinal === '41' ? '42' : '41',
        same: nowRight,
      },
    ],
  });
  const recs = [
    recRow('r1', true, '42'),
    recRow('r2', false, '42'),
    recRow('r3', true, '41'),
    {
      id: 'r4',
      ask: 'x',
      trace: [
        { slot: 'a', stage: 'draft', final: '1', same: false },
        { slot: 'k', stage: 'decide', final: '1', same: false },
      ],
    },
  ];
  const alwaysB = async ({ answers }) => ({ ok: true, letter: answers.find((x) => x.final === '42').letter });
  const res = await replayWith(alwaysB, recs);
  check(
    "another decider can be put the choices recorded in a measurement, with nothing else run: the distinct answers that stood, which of them was the larger model's, and what Kev chose; it is counted against Kev (recovered where Kev missed, lost where Kev had it); a choice with only one answer, or none of them the mark, is not put",
    choicesOf(recs[0]).answers.length === 2 &&
      choicesOf(recs[0]).checks.length === 1 &&
      choicesOf(recs[3]) === null &&
      res.asked === 3 &&
      res.nowRight === 2 &&
      res.theirsRight === 2 &&
      res.recovered === 1 &&
      res.lost === 1,
    res,
  );
}
// ---- 6t: a person steers the plan: areas leaned on or left out, moves pinned first or skipped; and the decider inside loops
{
  const { makePlan } = await import('../training/plan.mjs');
  const { areaOf, focusWeight, readSteer, AREAS } = await import('../training/support/steer.mjs');
  const { steps, flowMoves } = await import('../training/arrange.mjs');
  const all = steps(briefs);
  const loops = flowMoves(briefs).filter((c) => areaOf('arrangement', c.name) === 'loops');
  const state0 = { pass: 3, tried: {}, focus: {} };
  const plan0 = makePlan({ state: state0, briefs, steps: all, tries: 4 });
  const pinId = plan0.catalog.find((m) => /tournament/.test(m.what)).id;
  const skipId = plan0.moves.find((m) => m.kind === 'arrangement').id;
  const plan1 = makePlan({
    state: state0,
    briefs,
    steps: all,
    tries: 4,
    steer: { focus: {}, pin: [pinId], skip: [skipId] },
  });
  const only = makePlan({
    state: state0,
    briefs,
    steps: all,
    tries: 6,
    steer: { focus: { loops: 'only' }, pin: [], skip: [] },
  });
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-steer-'));
  fs.writeFileSync(
    path.join(wdir, 'steer.json'),
    JSON.stringify({ focus: { flow: 'more' }, pin: ['arrange:x'], skip: 'not a list' }),
  );
  const rs = readSteer(wdir);
  check(
    'a person can steer the plan from outside: every move open to the pass is listed with its area (briefs, slots, flow, decider placement, decider loops, several at once); a pinned move is measured first even if the plan had not chosen it, a skipped one never; an area marked only leaves the others out, more counts three times, less a quarter; and a steering record that will not read in part is read as far as it goes',
    AREAS.map((a) => a.id).join() === 'briefs,slots,flow,decider,loops,several' &&
      plan0.catalog.length >= all.length &&
      plan0.catalog.every((m) => m.id && m.area && m.what) &&
      plan0.steer.areas.length === 6 &&
      plan1.moves[0].id === pinId &&
      plan1.moves[0].pinned === true &&
      !plan1.moves.some((m) => m.id === skipId) &&
      only.moves.length > 0 &&
      only.moves.every((m) => m.kind !== 'arrangement' || areaOf('arrangement', m.what) === 'loops' || m.pinned) &&
      focusWeight({ focus: { flow: 'more' } }, 'flow') === 3 &&
      focusWeight({ focus: { flow: 'less' } }, 'flow') === 0.25 &&
      focusWeight({ focus: { loops: 'only' } }, 'slots') === 0 &&
      rs.focus.flow === 'more' &&
      rs.pin.join() === 'arrange:x' &&
      rs.skip.length === 0 &&
      readSteer(path.join(wdir, 'none')).pin.length === 0,
    { first: plan1.moves[0], only: only.moves.map((m) => m.what).slice(0, 4) },
  );
  // the decider inside a loop: each runs on the engine as it is, and a loop stops once something is settled
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'It is 42.' : roleOf(b).id === 'a-direct' ? 'ANSWER: 41' : 'ANSWER: 42';
  bonsai.s.script = () => 'ANSWER: 42';
  const sure = async ({ answers }) => ({
    ok: true,
    letter: answers.find((x) => x.final === '42').letter,
    final: '42',
    probs: Object.fromEntries(answers.map((x) => [x.letter, x.final === '42' ? 0.9 : 0.1])),
    ms: 1,
  });
  const sw = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, decide: sure });
  const ran = [];
  for (const c of loops) {
    const got = await sw.answer(Q, { briefs: { ...c.briefs, plan: { ...c.briefs.plan, byBehaviour: false } } });
    ran.push({
      name: c.name.slice(6, 40),
      ok: got.ok,
      decided: got.decided,
      decides: got.trace.filter((r) => r.stage === 'decide').length,
    });
  }
  await sw.stop();
  check(
    'three arrangements put the decider inside a loop, in the area of their own: a narrowing loop (keep the likeliest two, send them back), asking the decider first and again after a check and a revision, and a tournament (three, then two); each answers as the black box it is',
    loops.length === 3 &&
      ran.every((r) => r.ok && r.decided === '42' && r.decides >= 1) &&
      loops.some((c) => JSON.stringify(c.briefs.flow).includes('"keep":3')),
    ran,
  );
}

// ---- 6x: A TURN WITH TOOLS, DECIDED BY THE SWARM (tools.mjs; "tools": "swarm" in the configuration). Every drafter proposes the
// next action; a call the caller did not offer, or with arguments that are not an object, is left out; the same ones are one; where
// they differ the decider picks; and it goes back as tool_calls, streamed or not. With "lead", the lead's own turn, as before.
{
  const { actionOf, actionText, parseAction, sameAction } = await import('../src/tools.mjs');
  const TOOLS_ = [
    {
      type: 'function',
      function: { name: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    },
    {
      type: 'function',
      function: { name: 'ls', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    },
  ];
  const call = (name, args) => ({
    tool_calls: [
      {
        id: 'x',
        type: 'function',
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
      },
    ],
  });
  const AGENT = [
    { role: 'system', content: 'You are a coding agent. Use the tools.' },
    { role: 'user', content: 'What does src/a.js export?' },
  ];
  const decideAsked = [];
  const decide = async (input) => (
    decideAsked.push(input),
    { ok: true, letter: 'B', final: input.answers[1].final, ms: 1 }
  );
  reset();
  // drafters on a: read src/a.js (twice, one with ./), on b: one calls a tool not offered, one lists the folder
  lfm.s.script = (b) =>
    b.tools
      ? call('read', b.messages.length && b.temperature > 0.5 ? { path: './src/a.js' } : { path: 'src/a.js' })
      : 'ANSWER: 42';
  let nb = 0;
  bonsai.s.script = (b) =>
    b.tools ? (nb++ % 2 ? call('ls', { path: 'src' }) : call('rm', { path: 'src' })) : 'ANSWER: 42';
  const sw = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, tools: 'swarm', decide });
  const got = await sw.answerTools(AGENT, { tools: TOOLS_ });
  const left = got.trace.filter((r) => !r.ok).map((r) => r.out);
  const banNone = [...lfm.s.calls, ...bonsai.s.calls].filter((b) => b.tools).every((b) => !b.logit_bias);
  // over the address, as an agent would ask: not streamed and streamed
  const srvT = await sw.serve({ port: 0 });
  const post = (o) =>
    fetch(srvT.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: AGENT, tools: TOOLS_, ...o }),
    });
  const plainR = await (await post({})).json();
  const streamed = await (await post({ stream: true })).text();
  // all drafters agree: no decider asked
  reset();
  lfm.s.script = (b) => (b.tools ? call('read', { path: 'src/a.js' }) : 'ANSWER: 42');
  bonsai.s.script = (b) => (b.tools ? call('read', { path: ' src/a.js ' }) : 'ANSWER: 42');
  const before = decideAsked.length;
  const agreed = await sw.answerTools(AGENT, { tools: TOOLS_ });
  // every drafter replies in words: a reply
  lfm.s.script = bonsai.s.script = (b) => (b.tools ? { content: 'It exports add and sub.' } : 'ANSWER: 42');
  const worded = await sw.answerTools(AGENT, { tools: TOOLS_ });
  await srvT.close();
  await sw.stop();
  // with "lead": the lead's turn, as it came
  reset();
  lfm.s.script = (b) => (b.tools ? call('ls', { path: '.' }) : 'ANSWER: 42');
  const lead = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, tools: 'lead' });
  const lg = await lead.answerTools(AGENT, { tools: TOOLS_ });
  const bonsaiAsked = bonsai.s.calls.length;
  await lead.stop();
  // given to another of the small models, by its id: that one alone takes the turn
  reset();
  bonsai.s.script = (b) => (b.tools ? call('ls', { path: 'src' }) : 'ANSWER: 42');
  const byB = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, tools: MEMBERS.b.id });
  const bg = await byB.answerTools(AGENT, { tools: TOOLS_ });
  const lfmAskedB = lfm.s.calls.length;
  const gone = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, tools: 'not-in-this-swarm' });
  const goneLead = gone.toolLead;
  await byB.stop();
  await gone.stop();
  check(
    'a turn with tools is decided by the swarm when the configuration says so, or taken by the one small model it names (by its id; the model in place a where the one named is not in the swarm): every drafter proposes the next step with the tools offered (nothing forbidden), a call to a tool not offered is left out, the same step is one however its path is written, the decider picks where steps differ and is not asked where they agree, a reply in words is a reply; it goes back as tool_calls, streamed or not; with "lead" the lead alone takes the turn',
    got.ok &&
      got.path === 'tools-decided' &&
      got.calls.length === 1 &&
      got.calls[0].function.name === 'ls' &&
      decideAsked[0].answers.length === 2 &&
      left.some((x) => /rm, which is not one of the tools offered/.test(x)) &&
      banNone &&
      plainR.choices[0].finish_reason === 'tool_calls' &&
      plainR.choices[0].message.tool_calls[0].function.name === 'ls' &&
      plainR.choices[0].message.content === null &&
      /"tool_calls":\[\{"index":0/.test(streamed) &&
      /"finish_reason":"tool_calls"/.test(streamed) &&
      /\[DONE\]/.test(streamed) &&
      agreed.path === 'tools-agreed' &&
      decideAsked.length === before + 0 + 0 + (agreed.path === 'tools-agreed' ? 0 : 1) &&
      worded.ok &&
      worded.calls.length === 0 &&
      worded.reply === 'It exports add and sub.' &&
      lg.ok &&
      lg.path === 'tools-lead' &&
      lg.calls[0].function.name === 'ls' &&
      bonsaiAsked === 0 &&
      byB.toolLead === 'b' &&
      bg.ok &&
      bg.trace[0].member === 'b' &&
      bg.calls[0].function.name === 'ls' &&
      lfmAskedB === 0 &&
      goneLead === 'a' &&
      sameAction(
        parseAction('CALL read {"path":"./src/a.js"}'),
        parseAction(actionText(actionOf(call('read', { path: 'src/a.js' }).valueOf(), TOOLS_))),
      ) &&
      !sameAction(parseAction('CALL read {"path":"src/b.js"}'), parseAction('CALL read {"path":"src/a.js"}')) &&
      actionOf(call('read', 'not json'), TOOLS_).bad &&
      sameAction(parseAction('It is add.'), parseAction('Add and sub.')) &&
      !sameAction(parseAction('It is add.'), parseAction('CALL ls {}')),
    {
      path: got.path,
      calls: got.calls,
      left,
      plain: plainR.choices && plainR.choices[0],
      agreed: agreed.path,
      worded: worded.reply,
      lead: lg.path,
    },
  );
}
// ---- 6y: AN AGENT'S STEP AS A QUESTION (tasks-tools.mjs): asked with its tools, put to the swarm as a turn with tools, and graded
// equivalent when the swarm takes the larger model's step
{
  const { tasks: make2, reworded: again2 } = await import('../training/tasks.mjs');
  const { sameStep, AGENT_TOOLS } = await import('../training/tasks-tools.mjs');
  const { askSwarm } = await import('../training/support/bench.mjs');
  const held = make2({ split: 'held', each: 6, kinds: ['agent'] });
  const train = make2({ split: 'train', each: 6, kinds: ['agent'] });
  const g = async (r, s) => (await held[0].equivalent(r, s)).grade;
  const asked = [];
  const fake = {
    answer: async () => ({ reply: 'words' }),
    answerTools: async (m, o) => (
      asked.push(o.tools.length),
      {
        ok: true,
        text: 'CALL read {"path":"src/math.js"}',
        decided: 'CALL read {"path":"src/math.js"}',
        path: 'tools-agreed',
        trace: [],
      }
    ),
  };
  const viaSwarm = await askSwarm(fake, held[0], [{ role: 'user', content: held[0].ask }]);
  const viaWords = await askSwarm(fake, { ask: 'x' }, [{ role: 'user', content: 'x' }]);
  check(
    "an agent's next step is a kind of question for The Crew: made from a seed (other files and names on held and train), sent with the tools an agent has and what it has done and seen so far, put to the swarm as a turn with tools, and equivalent when it is the larger model's step: the same tool on the same file, the same words written, the same change made, or a reply where it replied; a step put another way only where the person spoke last",
    held.length === 6 &&
      held.every((t) => t.type === 'tool' && t.tools === AGENT_TOOLS && t.turns.length >= 1) &&
      held.some((t) => t.turns.some((x) => x.role === 'tool')) &&
      JSON.stringify(held.map((t) => t.ask)) !== JSON.stringify(train.map((t) => t.ask)) &&
      (await g('CALL read {"path":"src/math.js"}', 'CALL read {"path": "./src/math.js"}')) === 'right' &&
      (await g('CALL read {"path":"src/math.js"}', 'CALL read {"path":"src/cart.js"}')) === 'wrong' &&
      (await g('CALL read {"path":"src/math.js"}', 'CALL ls {"path":"src"}')) === 'wrong' &&
      (await g(
        'CALL edit {"path":"a.js","old":"function add","new":"function sum"}',
        'CALL edit {"path":"a.js","old":"add","new":"sum"}',
      )) === 'right' &&
      (await g(
        'CALL edit {"path":"a.js","old":"add","new":"sum"}',
        'CALL edit {"path":"a.js","old":"add","new":"total"}',
      )) === 'wrong' &&
      (await g('It does: it returns 0.', 'Yes, an empty list gives 0.')) === 'right' &&
      (await g('It does.', 'CALL read {"path":"a.js"}')) === 'wrong' &&
      (await g('', 'CALL read {"path":"a.js"}')) === 'unsure' &&
      sameStep('CALL write {"path":"x.txt","content":"hello"}', 'CALL write {"path":"x.txt","content":" hello "}')
        .grade === 'right' &&
      viaSwarm.reply === 'CALL read {"path":"src/math.js"}' &&
      asked[0] === AGENT_TOOLS.length &&
      viaWords.reply === 'words' &&
      again2(held).every((t) => t.turns[t.turns.length - 1].role === 'user'),
    { n: held.length, viaSwarm: viaSwarm.reply },
  );
}
// ---- 6z: AN UNDECIDED READING IS SAID TO BE ONE, and decides nothing; a near-miss is made from an answer; a step's words loosely
{
  const { openEquivalent, talkEquivalent, UNDECIDED } = await import('../training/support/equivalent.mjs');
  const { paired, judgeAddress } = await import('../training/support/bench.mjs');
  const judgeWas = process.env.SWARM_JUDGE;
  delete process.env.SWARM_JUDGE;
  const byDecider = judgeAddress('http://decider');
  process.env.SWARM_JUDGE = 'http://judge';
  const byJudge = judgeAddress('http://decider');
  if (judgeWas === undefined) delete process.env.SWARM_JUDGE;
  else process.env.SWARM_JUDGE = judgeWas;
  const { nearMissOf } = await import('../training/readers.mjs');
  const { sameStep } = await import('../training/tasks-tools.mjs');
  const said = (p) => async () => ({
    ok: true,
    json: async () => ({ answers: { same: { noul: p }, firstAsks: { noul: 0.1 }, secondAsks: { noul: 0.1 } } }),
  });
  const g = async (p, mark = 0.6) => openEquivalent('q', 'a', 'b', { reader: 'x', mark, fetchImpl: said(p) });
  const near = await g(0.65);
  const yes = await g(0.8);
  const no = await g(0.3);
  const talk = await talkEquivalent({ turns: [{ role: 'user', content: 'hi' }] }, 'a', 'b', {
    reader: 'x',
    mark: 0.6,
    fetchImpl: said(0.55),
  });
  const pr = paired(
    [
      { id: 'q1', grade: 'wrong', undecided: true },
      { id: 'q2', grade: 'wrong' },
      { id: 'q3', grade: 'right' },
    ],
    [
      { id: 'q1', grade: 'right' },
      { id: 'q2', grade: 'right' },
      { id: 'q3', grade: 'wrong', undecided: true },
    ],
  );
  check(
    "a reading close to the reader's line, either side, is undecided: graded different (so it cannot claim parity that is not there) and marked, in answers in words and in conversations alike; an undecided answer before or after is neither a win nor a loss when a change is weighed; a near-miss is an answer with one number changed; a step's written words are the same without case or end punctuation",
    UNDECIDED === 0.1 &&
      byDecider === 'http://decider' &&
      byJudge === 'http://judge' &&
      near.grade === 'wrong' &&
      near.undecided === true &&
      yes.grade === 'right' &&
      !yes.undecided &&
      no.grade === 'wrong' &&
      !no.undecided &&
      talk.grade === 'wrong' &&
      talk.undecided === true &&
      pr.wins === 1 &&
      pr.losses === 0 &&
      nearMissOf('Six minutes, or 6 at most') === 'Six minutes, or 7 at most' &&
      nearMissOf('Ask for four at 7pm') === 'Ask for four at 8pm' &&
      nearMissOf('none here') === null &&
      sameStep(
        'CALL write {"path":"notes.txt","content":"hello"}',
        'CALL write {"path":"notes.txt","content":"Hello!"}',
      ).grade === 'right' &&
      sameStep(
        'CALL write {"path":"notes.txt","content":"hello"}',
        'CALL write {"path":"Notes.txt","content":"goodbye"}',
      ).grade === 'wrong',
    { near, yes, no, talk, pr },
  );
}
// ---- 6w: A SWARM FROM ITS SPEC: the output spec holds what a swarm is made of, so a program can make the swarm it describes (a
// chooser like The Crew's offers spec.card and starts it with serveSwarm({ ...card, spec })); a spec changed since it was written,
// or not one at all, is refused
{
  const { readSpec, recipeSha256 } = await import('../src/spec.mjs');
  const told = briefs.slots.map((x) =>
    x.stage === 'write' ? { ...x, brief: 'From the spec: write the reply. ' + x.brief } : x,
  );
  const recipe = {
    members: Object.fromEntries(Object.entries(MEMBERS).slice(0, 2)),
    decider: { id: 'kev-4b', name: 'Kev 4B', serve: { kind: 'kev' } },
    engine: { name: 'llama.cpp' },
    serving: { slots: 3, contextPerSlot: 2048 },
    briefs: { ...briefs, slots: told },
  };
  const spec = {
    spec: { format: 'the-swarm/spec', version: 2, recipeSha256: recipeSha256(recipe) },
    recipe,
    card: { id: 'swarm-x', engine: 'swarm' },
  };
  reset();
  const seen = [];
  lfm.s.script = (b) => (
    seen.push(b.messages[0].content),
    b.messages[0].content.startsWith('From the spec') ? 'Six times seven is 42.' : 'ANSWER: 42'
  );
  const fromIt = await createSwarm({ spec, attach: { a: lfm.base, b: bonsai.base } });
  const got = await fromIt.answer(Q);
  const up = await serveSwarm({ ...spec.card, spec }, {}, { attach: { a: lfm.base, b: bonsai.base } });
  const listed = up.ok ? await (await fetch(up.base + '/v1/models')).json() : null;
  if (up.ok) await up.stop();
  await fromIt.stop();
  const refused = (s2) => {
    try {
      readSpec(s2);
      return '';
    } catch (e) {
      return e.message;
    }
  };
  const changed = { ...spec, recipe: { ...recipe, serving: { slots: 6, contextPerSlot: 2048 } } };
  const unpinned = {
    ...spec,
    spec: { ...spec.spec, recipeSha256: undefined },
    recipe: { ...recipe, members: { a: { id: 'x' }, b: recipe.members.b } },
  };
  check(
    "a swarm is made from its spec alone: its members, its arrangement (every slot told what the spec says) and its serving, and offered as a model by the call a chooser starts a model with; a spec changed after it was written (its hash no longer its recipe's), one of a format or version not read, and one whose small models are not pinned are each refused, saying why",
    fromIt.briefs.slots.find((x) => x.stage === 'write').brief.startsWith('From the spec') &&
      seen.some((x) => x.startsWith('From the spec')) &&
      got.reply === 'Six times seven is 42.' &&
      up.ok &&
      listed &&
      listed.data &&
      listed.data.length === 1 &&
      /does not match its hash/.test(refused(changed)) &&
      /not a swarm spec/.test(refused({ spec: { format: 'other' } })) &&
      /version 9/.test(refused({ ...spec, spec: { ...spec.spec, version: 9 } })) &&
      /not pinned/.test(refused(unpinned)),
    { reply: got.reply, up: up.ok, changed: refused(changed) },
  );
}
// ---- 6v: what the measurement held and no finding read: answers cut off at the token limit, a drafter that echoes another on its
// own model, the decider not answering in time; each found, and each answered by a move that speaks to it
{
  const { slotReport } = await import('../training/measure.mjs');
  const { diagnose, makePlan } = await import('../training/plan.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const b = {
    ...briefs,
    slots: briefs.slots.map((x) =>
      x.id === 'a-steps' ? { ...x, maxTokens: 700 } : { ...x, maxTokens: x.maxTokens || 700 },
    ),
  };
  const task = {
    equivalent: async (ref, text) => ({ grade: String(text).trim() === String(ref).trim() ? 'right' : 'wrong' }),
    wrap: (x) => x,
  };
  const rows = [];
  for (let i = 0; i < 8; i++)
    rows.push({
      id: 'q' + i,
      refReply: '1',
      grade: i < 4 ? 'right' : 'wrong',
      path: i % 4 === 0 ? 'most' : 'decided',
      decided: i < 4 ? '1' : '2',
      tried: { groups: [['A', 'B'], ['C'], ['D']] },
      trace: [
        { slot: 'a-direct', member: 'a', stage: 'draft', letter: 'A', final: '2', tokens: 300, ms: 1 },
        { slot: 'a-steps', member: 'a', stage: 'draft', letter: 'B', final: '2', tokens: 700, ms: 1 },
        { slot: 'b-direct', member: 'b', stage: 'draft', letter: 'C', final: i < 4 ? '1' : '3', tokens: 200, ms: 1 },
        { slot: 'b-other-way', member: 'b', stage: 'draft', letter: 'D', final: '4', tokens: 200, ms: 1 },
        i % 4 === 0
          ? { slot: 'decide', member: 'decider', stage: 'decide', final: '', ok: false, timedOut: true, ms: 1 }
          : { slot: 'decide', member: 'decider', stage: 'decide', final: i < 4 ? '1' : '2', ok: true, ms: 1 },
      ],
    });
  const byId = Object.fromEntries(rows.map((r) => [r.id, task]));
  const rep = await slotReport(rows, byId, { briefs: b });
  const report = { compared: 8, right: 4, wrong: 4, lost: 0, ...rep };
  const found = diagnose(report);
  const ids = found.map((f) => f.id);
  const plan = makePlan({ state: { pass: 2, tried: {} }, briefs: b, steps: steps(b), report, tries: 40 });
  const forCap = plan.moves.find((m) => (m.why || []).includes('capped:a-steps'));
  const forEcho = plan.moves.filter((m) => (m.why || []).includes('echo:a-steps')).map((m) => m.what);
  check(
    'what the measurement held and no finding read is found and answered: a slot stopping at its token limit on most questions (cut off), a drafter that does what another on its own model does nearly always (an echo), the decider not answering in time; a cut-off slot is answered by more room to answer, an echo by sampling it differently, moving it or telling it what another drafter is told',
    rep.slots['a-steps'].capped === 8 &&
      !rep.slots['a-direct'].capped &&
      rep.slots['a-steps'].echo === 8 &&
      rep.slots['b-direct'].echo === undefined &&
      rep.slots['decide'].timedOut === 2 &&
      ids.includes('capped:a-steps') &&
      ids.includes('echo:a-steps') &&
      ids.includes('decider-slow:decide') &&
      !ids.includes('echo:b-direct') &&
      forCap &&
      /a-steps with a token limit of 1100/.test(forCap.what) &&
      forCap.technique === 'More room to answer' &&
      forEcho.length > 0 &&
      forEcho.every((w) => /at temperature|^move | drafts as /.test(w)),
    { ids, cap: forCap && forCap.what, forEcho },
  );
}
// ---- 6u: each configuration keeps its own record, but what one kept is measured first by the others
{
  const { makePlan } = await import('../training/plan.mjs');
  const { transferred, otherLearned } = await import('../training/support/across.mjs');
  const { LEARNED_DIR } = await import('../src/learned.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const all = steps(briefs);
  const target = all[all.length - 1];
  const slot = briefs.slots[0];
  fs.mkdirSync(LEARNED_DIR, { recursive: true });
  const other = 'other-a+other-b+kev-4b--nemotron35-30b';
  const theirBriefs = {
    ...briefs,
    slots: briefs.slots.map((s) => (s.id === slot.id ? { ...s, brief: 'Told differently elsewhere.' } : s)),
  };
  fs.writeFileSync(
    path.join(LEARNED_DIR, other + '.json'),
    JSON.stringify({
      config: 'other-a+other-b+kev-4b',
      target: 'nemotron35-30b',
      briefs: theirBriefs,
      ledger: [
        { n: 1, pass: 2, kind: 'arrangement', what: target.name, train: { wins: 4, losses: 1 } },
        { n: 2, pass: 3, kind: 'brief', slot: slot.id, what: 'a shorter brief', train: { wins: 2, losses: 0 } },
        { n: 3, pass: 3, kind: 'brief', slot: 'no-such-slot', what: 'x', train: { wins: 1, losses: 0 } },
      ],
    }),
  );
  fs.writeFileSync(path.join(LEARNED_DIR, 'broken--nemotron35-30b.json'), '{ not json');
  const t = transferred('this-config--nemotron35-30b', briefs);
  const mineOnly = transferred(other, briefs);
  const state0 = { pass: 3, tried: {}, focus: {} };
  const plain0 = makePlan({ state: state0, briefs, steps: all, tries: 3 });
  const plan = makePlan({ state: state0, briefs, steps: all, tries: 3, elsewhere: t });
  const arr = plan.moves.find((m) => m.what === target.name);
  const br = plan.moves.find(
    (m) => m.kind === 'brief' && m.slot === slot.id && (m.why || []).some((w) => /^elsewhere:/.test(w)),
  );
  check(
    "each configuration keeps its own record, but what another kept is evidence here: an arrangement kept elsewhere is planned first by this one (to be measured, never adopted), a brief kept elsewhere for a slot of the same name is one of that slot's candidates, a slot this configuration does not have takes nothing, its own record is never read as another's, and a record that will not read is passed over",
    otherLearned('this-config--nemotron35-30b').length === 1 &&
      t.arrangements.get(target.name)?.[0]?.gain === 3 &&
      t.briefs.length === 1 &&
      t.briefs[0].brief === 'Told differently elsewhere.' &&
      mineOnly.briefs.length === 0 &&
      mineOnly.arrangements.size === 0 &&
      !plain0.moves.slice(0, 1).some((m) => m.what === target.name) &&
      arr &&
      arr.why[0] === 'elsewhere:' + other &&
      plan.moves.filter((m) => m.kind === 'arrangement')[0].what === target.name &&
      !!br,
    {
      arr: arr && arr.why,
      briefs: t.briefs.length,
      first: plan.moves.filter((m) => m.kind === 'arrangement')[0]?.what,
    },
  );
  fs.rmSync(path.join(LEARNED_DIR, other + '.json'), { force: true });
  fs.rmSync(path.join(LEARNED_DIR, 'broken--nemotron35-30b.json'), { force: true });
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
// ---- 7a: the decider's wait fits the decider, and a timeout is asked once more (StartLux through MLX: 5.8 s at the median, and
// every failure in 40 decisions was the fixed 8-second wait)
{
  const { deciderAt } = await import('../src/decider.mjs');
  let delay = 60;
  let calls = 0;
  const slow = http.createServer((req, res) => {
    calls++;
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        if (!res.destroyed)
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ answers: { pick: { choice: 'A', probabilities: { A: 0.8, B: 0.2 } } } }));
      }, delay),
    );
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + slow.address().port;
  const answers = [
    { letter: 'A', final: '1', work: '' },
    { letter: 'B', final: '2', work: '' },
  ];
  // a wait of 40 ms against a decider that takes 60: the first ask times out, the second (80 ms) is answered
  const d1 = deciderAt({ base, timeoutMs: 40, maxTimeoutMs: 400 });
  const r1 = await d1({ question: 'q', answers });
  const c1 = calls;
  // after decisions that took about 60 ms, the next waits three times the slowest of them (at least 40)
  const grown = d1.waitMs();
  // a decider that will not answer in time even when asked again decides nothing, and says it was asked again
  delay = 1000;
  const d2 = deciderAt({ base, timeoutMs: 30, maxTimeoutMs: 60 });
  const r2 = await d2({ question: 'q', answers });
  // a decider that is down is not asked again: nothing to wait for
  const d3 = deciderAt({ base: 'http://127.0.0.1:1', timeoutMs: 30, maxTimeoutMs: 400 });
  const r3 = await d3({ question: 'q', answers });
  slow.close();
  check(
    "the decider's wait fits the decider: a decision that times out is asked once more with twice the wait and then stands; the wait grows to three times the slowest recent decision; a decider that times out twice decides nothing and says it was asked again; one that is down is not asked again",
    r1.ok &&
      r1.letter === 'A' &&
      r1.retried === true &&
      c1 === 2 &&
      grown >= 150 &&
      grown <= 400 &&
      r2.ok === false &&
      r2.retried === true &&
      /did not answer/.test(r2.why) &&
      r3.ok === false &&
      !r3.retried,
    { r1: [r1.ok, r1.retried, c1], grown, r2: [r2.ok, r2.retried], r3: [r3.ok, r3.retried, r3.why] },
  );
}
// ---- 7b: the decide step is the decider, whichever decision model is named; no slot judges
{
  const { requestOf, readAnswers, decisionOf } = await import('../src/decider.mjs');
  const dec = { calls: [], reply: null, status: 200 };
  const ksrv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      dec.calls.push({ url: req.url, body: JSON.parse(Buffer.concat(parts).toString('utf8')) });
      res.writeHead(dec.status, { 'content-type': 'application/json' }).end(JSON.stringify(dec.reply));
    });
  });
  await new Promise((ok) => ksrv.listen(0, '127.0.0.1', ok));
  const withDecider = await createSwarm({
    attach: { a: lfm.base, b: bonsai.base },
    decider: 'http://127.0.0.1:' + ksrv.address().port,
  });
  const disagree = () => {
    reset();
    lfm.s.script = (b) => {
      const r = roleOf(b);
      return r.stage === 'write' ? 'It is 42.' : r.id === 'a-direct' ? 'slipped\nANSWER: 41' : 'work\nANSWER: 42';
    };
    bonsai.s.script = (b) => (roleOf(b).id === 'b-direct' ? 'same slip\nANSWER: 41' : 'because\nANSWER: 42');
  };
  // as a decision model answers (Kev's own page shows it so): a choice with a probability for each option, and a yes/no as one number
  const says = (pA, pB, okB = 0.9) => ({
    model: 'decider',
    answers: {
      pick: { type: 'choice', choice: pA > pB ? 'A' : 'B', confidence: 0.5, probabilities: { A: pA, B: pB } },
      ok_A: { type: 'noul', noul: 0.1 },
      ok_B: { type: 'noul', noul: okB },
    },
    usage: { input_tokens: 300, output_tokens: 40 },
    latency_ms: 150,
  });
  disagree();
  dec.reply = says(0.12, 0.88);
  const got = await withDecider.answer(Q);
  const sent = dec.calls[0];
  const row = got.trace.find((r) => r.slot === 'decide');
  check(
    'with a decision model named, the decide step is one request to it: the question, one entry for each different answer and what the checkers said as state, a choice among the answers and a yes/no for each',
    sent.url === '/v1/systemone' &&
      sent.body.model === 'decider' &&
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
  // four slots said 42 and two said 41: the decider may rule against the most given answer, and its ruling stands
  disagree();
  dec.reply = says(0.9, 0.1);
  const against = await withDecider.answer(Q);
  disagree();
  dec.reply = says(0.48, 0.52, 0.2);
  const narrow = await withDecider.answer(Q);
  const nrow = narrow.trace.find((r) => r.slot === 'decide');
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
  dec.status = 503;
  const down = await withDecider.answer(Q);
  dec.status = 200;
  check(
    'when it does not answer, the answer most slots gave stands: the swarm never fails for want of it, and no slot is asked to judge',
    down.ok &&
      down.decided === '42' &&
      down.path === 'most' &&
      /The decider answered 503/.test(down.trace.find((r) => r.slot === 'decide').out) &&
      !down.trace.some((r) => r.stage === 'judge'),
    down.trace.map((r) => r.slot),
  );
  reset();
  const before = dec.calls.length;
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? 'It is 42.' : 'ANSWER: 42');
  await withDecider.answer(Q);
  check(
    'it is not asked when every draft agrees: nothing is in dispute',
    dec.calls.length === before,
    dec.calls.length - before,
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
    briefs.plan.decide === undefined &&
      swarm.decider === '' &&
      withDecider.decider.startsWith('http') &&
      withDecider.kev === withDecider.decider,
    briefs.plan,
  );
  await withDecider.stop();
  ksrv.close();
}
// ---- 7c: the arrangement itself is trained: every layout one step from this one, and none tried twice
{
  const { steps, shapeOf } = await import('../training/arrange.mjs');
  const all = steps(briefs);
  const names = all.map((c) => c.name);
  const { SERVING } = await import('../src/catalog.mjs');
  const ok = (b) =>
    b.slots.filter((x) => x.stage === 'draft').length >= 2 &&
    ['a', 'b'].every((m) => b.slots.filter((x) => x.member === m).length <= SERVING.slots);
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
    // (six slots a model since 2026-11-16: a model with four in use has room for a slot moved to it, and one with six none)
    all.every((c) => ok(c.briefs)) &&
      names.some((n) => /to b$/.test(n)) &&
      steps({
        ...briefs,
        slots: [
          ...briefs.slots,
          ...[1, 2].map((i) => ({ ...briefs.slots.find((s) => s.member === 'a'), id: 'pad-' + i })),
        ],
      }).every((c) => !/to a$/.test(c.name) || ok(c.briefs)) &&
      SERVING.slots === 6,
    names.filter((n) => /^move/.test(n)),
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
    const found = reap({ keepDecider: true }).some((r) => r.pid === String(decoy.pid));
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
      decide: slot('decide', 10, 6, { hadRight: 8, threwAway: 2 }),
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
      ids.includes('decider-threw:decide') &&
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
      plan.moves.find((m) => m.what === 'one for each').why.includes('decider-threw:decide') &&
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
  // a model in parts (too large for one file on Hugging Face) is pinned part by part, every part in the first one's folder
  const { filesOf, modelFile } = await import('../src/members.mjs');
  const pinned = (m) =>
    /^[0-9a-f]{40}$/.test(m.rev) &&
    filesOf(m).reduce((n, f) => n + f.bytes, 0) > 1e8 &&
    filesOf(m).every(
      (f) =>
        /^[0-9a-f]{64}$/.test(f.sha256) &&
        f.bytes > 0 &&
        f.file.endsWith('.gguf') &&
        path.dirname(f.file) === path.dirname(m.file),
    ) &&
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
      // the larger models are 27B and up (to 180B): a target is the model a swarm of small ones is brought level with
      REGISTRY.targets.every((t) => t.params >= 27 && t.params <= 180) &&
      MEMBERS.a.id === readConfig().a &&
      MEMBERS.b.id === readConfig().b &&
      DECIDER.id === readConfig().decider &&
      MEMBERS.a.key === 'a' &&
      // each list names each model once; a model in two lists (Bonsai 2 27B is a small model and a larger one) is the
      // same pinned file in both
      [REGISTRY.small, REGISTRY.targets, REGISTRY.deciders].every(
        (l) => new Set(l.map((m) => m.id)).size === l.length,
      ) &&
      REGISTRY.small.every((m) => {
        const t = REGISTRY.targets.find((x) => x.id === m.id);
        return !t || (t.repo === m.repo && t.rev === m.rev && t.file === m.file && t.sha256 === m.sha256);
      }) &&
      ['bonsai2-2b', 'bonsai2-4b', 'bonsai2-9b', 'bonsai2-27b'].every((id) => REGISTRY.small.some((m) => m.id === id)),
    REGISTRY.small.map((m) => m.id),
  );
  // a model in parts is here only when every part is, beside the first
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-parts-'));
  const split = REGISTRY.targets.find((t) => (t.parts || []).length);
  const [first, ...rest] = filesOf(split);
  fs.mkdirSync(path.join(dir, path.dirname(first.file)), { recursive: true });
  fs.writeFileSync(path.join(dir, first.file), '');
  const withoutRest = modelFile(split, dir);
  for (const f of rest) fs.writeFileSync(path.join(dir, f.file), '');
  const withAll = modelFile(split, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  check(
    'a model in parts is found only when every part is beside the first, and llama.cpp is given the first',
    withoutRest === '' && withAll === path.join(dir, first.file),
    { withoutRest, withAll },
  );
}
// ---- 9a: a small model beside the decider in the decide step (plan.decideWith)
{
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const { steps } = await import('../training/arrange.mjs');
  // two drafters on a say 42, one on b says 41; a checker on b is the slot the model beside the decider is asked as
  const base = {
    marker: 'ANSWER:',
    flow: [{ do: 'draft' }, { do: 'decide' }],
    plan: { writeAs: 'settled' },
    slots: [
      { id: 'a1', member: 'a', stage: 'draft', brief: 'Answer.' },
      { id: 'a2', member: 'a', stage: 'draft', brief: 'Answer another way.' },
      { id: 'b1', member: 'b', stage: 'draft', brief: 'Answer.' },
      { id: 'b-check', member: 'b', stage: 'check', brief: 'Check.' },
    ],
  };
  const run = async ({ how, weight, decider, judge }) => {
    const judged = [];
    const got = await orchestrate(Q, {
      briefs: {
        ...base,
        plan: { ...base.plan, ...(how ? { decideWith: { how, ...(weight ? { weight } : {}) } } : {}) },
      },
      ask: async (slot, msgs) => {
        if (slot.stage === 'judge') {
          const shown = msgs[msgs.length - 1].content;
          judged.push({ member: slot.member, shown });
          const block = shown
            .split(/\n\n(?=Answer [A-Z]:)/)
            .find((x) => judge !== null && new RegExp('Its final answer: ' + judge + '$').test(x.trim()));
          const want = block ? block.match(/^Answer ([A-Z]):/)[1] : '';
          return { text: want ? 'Put back, it holds.\nANSWER: ' + want : 'I cannot tell.' };
        }
        return { text: slot.member === 'a' ? 'six sevens\nANSWER: 42' : 'six sevens\nANSWER: 41' };
      },
      decide: async ({ answers }) => {
        const L = (f) => answers.find((x) => x.final === f).letter;
        const probs = Object.fromEntries(Object.entries(decider.probs).map(([f, p]) => [L(f), p]));
        return { ok: true, letter: L(decider.pick), final: decider.pick, probs, close: !!decider.close };
      },
    });
    return {
      decided: got.decided,
      judged,
      row: got.trace.find((r) => r.slot === 'decide-judge'),
      deciderRow: got.trace.find((r) => r.slot === 'decide'),
    };
  };
  const closeCall = await run({
    how: 'if-close',
    decider: { pick: '41', probs: { 41: 0.55, 42: 0.45 }, close: true },
    judge: '42',
  });
  const sureCall = await run({ how: 'if-close', decider: { pick: '41', probs: { 41: 0.9, 42: 0.1 } }, judge: '42' });
  const silent = await run({
    how: 'if-close',
    decider: { pick: '41', probs: { 41: 0.55, 42: 0.45 }, close: true },
    judge: null,
  });
  const withIt = await run({ how: 'together', decider: { pick: '41', probs: { 41: 0.6, 42: 0.4 } }, judge: '42' });
  const light = await run({
    how: 'together',
    weight: 0.1,
    decider: { pick: '41', probs: { 41: 0.6, 42: 0.4 } },
    judge: '42',
  });
  const odds = await run({ how: 'if-at-odds', decider: { pick: '41', probs: { 41: 0.8, 42: 0.2 } }, judge: '42' });
  const agrees = await run({ how: 'if-at-odds', decider: { pick: '42', probs: { 41: 0.2, 42: 0.8 } }, judge: '41' });
  const alone = await run({ decider: { pick: '41', probs: { 41: 0.55, 42: 0.45 }, close: true }, judge: '42' });
  const names = steps(base).map((c) => c.name);
  const on = steps({ ...base, plan: { ...base.plan, decideWith: { how: 'together' } } }).map((c) => c.name);
  check(
    "a small model can stand beside the decider in the decide step: where the decider is close it chooses between the decider's two likeliest and settles it (not asked where the decider is sure; where it names nothing the decider's pick stands); asked with the decider, its pick adds its weight to the decider's probability; where the decider parts from most it chooses between the two; it is asked as the slot the plan names (a checker by default), and the search can add, change and take it away",
    closeCall.decided === '42' &&
      closeCall.row &&
      closeCall.row.stage === 'judge' &&
      closeCall.row.member === 'b' &&
      closeCall.row.final === '42' &&
      /the model beside it chose/.test(closeCall.deciderRow.out) &&
      closeCall.judged.length === 1 &&
      (closeCall.judged[0].shown.match(/Answer [A-Z]:/g) || []).length === 2 &&
      sureCall.decided === '41' &&
      !sureCall.judged.length &&
      silent.decided === '41' &&
      silent.judged.length === 1 &&
      withIt.decided === '42' &&
      withIt.judged.length === 1 &&
      light.decided === '41' &&
      odds.decided === '42' &&
      odds.judged.length === 1 &&
      agrees.decided === '42' &&
      !agrees.judged.length &&
      alone.decided === '41' &&
      !alone.judged.length &&
      names.includes('plan: a model settles it where the decider is close') &&
      names.includes('plan: a model decides with the decider') &&
      names.includes('plan: a model settles it where the decider parts from most') &&
      on.includes('plan: the decider decides alone') &&
      on.includes('plan: the model beside the decider is a (as a1)') &&
      !on.includes('plan: a model decides with the decider'),
    {
      closeCall: closeCall.decided,
      sure: sureCall.decided,
      silent: silent.decided,
      withIt: withIt.decided,
      light: light.decided,
      odds: odds.decided,
      agrees: agrees.decided,
      on,
    },
  );
}

// ---- 9b: training question by question (training/loop.mjs): a question stays in hand until it is at parity
{
  const { runLoop, orderFor, lostAt, guardOf, tallyOf } = await import('../training/loop.mjs');
  // a made-up swarm: what it answers right depends on which changes its arrangement carries (briefs.has)
  const list = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => ({ id, kind: i < 3 ? 'math' : 'fix' }));
  const rightWith = {
    q1: () => true, // at parity as it stands
    q2: (has) => has.includes('better-draft') && !has.includes('breaks-q1'), // a change brings it there
    q3: (has) => has.includes('breaks-q1') || has.includes('side-model'), // the first change that works loses q1
    q4: () => false, // nothing brings it there
    q5: () => null, // the larger model gave no answer
  };
  const POOL = [
    { key: 'noop', name: 'noop', area: 'briefs', slot: 'a1', kind: 'brief', order: 0 },
    { key: 'better-draft', name: 'better-draft', area: 'briefs', slot: 'a1', kind: 'brief', order: 1 },
    { key: 'breaks-q1', name: 'breaks-q1', area: 'decider', kind: 'arrangement', order: 2 },
    { key: 'side-model', name: 'side-model', area: 'decider', kind: 'arrangement', order: 3 },
  ];
  const poolOf = (b) =>
    POOL.filter((m) => !b.has.includes(m.key)).map((m) => ({
      ...m,
      id: m.key,
      briefs: { ...b, has: [...b.has, m.key] },
    }));
  const asked = [];
  const kept = [];
  const written = [];
  const attempt = async (b, t, at) => {
    asked.push({ id: t.id, has: b.has.join('+'), attempt: at.attempt, guard: at.guard || '' });
    const ok = rightWith[t.id](b.has);
    const lostIn = t.id === 'q3' ? { stage: 'draft', same: true } : { stage: 'draft', same: false };
    return { id: t.id, grade: ok === null ? 'noref' : ok ? 'right' : 'wrong', trace: [lostIn] };
  };
  const opts = {
    list,
    poolOf,
    attempt,
    keep: async (b, e) => kept.push({ v: b.version, ...e }),
    cap: 3,
    guard: 6,
    drop: 2,
  };
  const st = await runLoop({
    ...opts,
    briefs: { version: 1, has: [] },
    onQuestion: (q, row, cur) => written.push(JSON.parse(JSON.stringify(cur))),
  });
  const q = Object.fromEntries(st.questions.map((x) => [x.id, x]));
  const t = tallyOf(st);
  // stopped after two questions, and carried on from what was written down: nothing finished is asked again
  const keptFirst = kept.map((k) => k.what).join();
  const before = asked.length;
  const again = await runLoop({ ...opts, briefs: { version: 2, has: ['better-draft'] }, resume: written[1] });
  const reAsked = asked.slice(before).filter((x) => !x.guard && (x.id === 'q1' || x.id === 'q2'));
  check(
    'training goes question by question: a question at parity as the swarm stands is passed; one that is not stays in hand while changes are tried on it one at a time, ordered by where its answer was lost, and the change that brings it to parity is asked again on the questions already there and kept only if none is lost; a change that reaches parity here and loses one is not kept, and the next is tried; after the cap the question is written down as not reached and the loop moves on; a question the larger model did not answer is not compared; a change that keeps failing is dropped; what is kept is the arrangement for every question after; and a loop that stopped carries on without asking a finished question again',
    q.q1.state === 'at parity' &&
      q.q1.attempts.length === 1 &&
      q.q2.state === 'reached' &&
      q.q2.lostAt === 'drafting' &&
      q.q2.attempts.map((a) => a.move).join() === ',noop,better-draft' &&
      q.q2.attempts[2].kept === true &&
      q.q2.attempts[2].guard.asked === 1 &&
      q.q3.state === 'reached' &&
      q.q3.lostAt === 'choosing' &&
      q.q3.attempts[1].move === 'breaks-q1' &&
      q.q3.attempts[1].grade === 'right' &&
      q.q3.attempts[1].lostOn === 'q2' &&
      !q.q3.attempts[1].kept &&
      q.q3.attempts[2].move === 'side-model' &&
      q.q3.attempts[2].kept === true &&
      q.q4.state === 'not reached' &&
      q.q4.attempts.length <= 4 &&
      q.q5.state === 'not compared' &&
      keptFirst === 'better-draft,side-model' &&
      kept[1].v === 3 &&
      /brought q3 to parity/.test(kept[1].why) &&
      st.briefs.has.join() === 'better-draft,side-model' &&
      asked.filter((x) => x.id === 'q4' && !x.guard).every((x) => /better-draft/.test(x.has) || x.attempt === 0) &&
      st.moves.noop.tried === 2 &&
      !orderFor(poolOf({ has: [] }), { moves: st.moves, drop: 2 }).some((m) => m.key === 'noop') &&
      orderFor(poolOf({ has: [] }), { lost: 'choosing' })[0].area === 'decider' &&
      orderFor(poolOf({ has: [] }), { lost: 'drafting' })[0].area === 'briefs' &&
      orderFor(poolOf({ has: [] }), { lost: 'drafting', pin: ['side-model'] })[0].key === 'side-model' &&
      lostAt({
        trace: [
          { stage: 'draft', same: true },
          { stage: 'write', same: false },
        ],
      }) === 'writing' &&
      guardOf([{ t: { id: 'x', kind: 'fix' } }, { t: { id: 'y', kind: 'math' } }], { kind: 'math' }, 1)[0].t.id ===
        'y' &&
      t.atParity === 1 &&
      t.reached === 2 &&
      t.notReached === 1 &&
      t.notCompared === 1 &&
      t.kept === 2 &&
      !reAsked.length &&
      again.questions.length === 5,
    {
      states: st.questions.map((x) => x.id + ':' + x.state),
      kept: kept.map((k) => k.what),
      tally: t,
      q3: q.q3.attempts,
      reAsked,
    },
  );
}

// ---- 9c: training learns how to train: changes chosen from the question's own record, kinds of change learned, partial progress built on
{
  const { evidenceOf, orderFor, classOf, runLoop } = await import('../training/loop.mjs');
  const { replay } = await import('../training/replay.mjs');
  const { callsFrom, behaviours } = await import('../src/behave.mjs');
  const slots = [
    { id: 'a1', member: 'a', stage: 'draft', maxTokens: 700 },
    { id: 'a2', member: 'a', stage: 'draft', maxTokens: 700 },
    { id: 'b1', member: 'b', stage: 'draft', maxTokens: 700 },
    { id: 'chk', member: 'b', stage: 'check', maxTokens: 700 },
  ];
  const b = { slots, plan: {} };
  const M = (name, kind = 'arrangement', area = 'slots', slot) => ({ key: name, id: name, name, kind, area, slot });
  const pool = [
    M('a1 with a token limit of 1100'),
    M('b1 with a token limit of 1100'),
    M('a1 at temperature 0.7'),
    M('add a second a1 on b'),
    M('add a second a1 on c'),
    M('plan: decide by most', 'arrangement', 'decider'),
    M('plan: decide by decider-unless-majority', 'arrangement', 'decider'),
    M('plan: a model settles it where the decider is close', 'arrangement', 'decider'),
    M('flow: keep the likeliest two, straight after the draft', 'arrangement', 'decider'),
    M('flow: keep the likeliest two, straight after the try', 'arrangement', 'decider'),
    M('a better brief', 'brief', 'briefs', 'a1'),
    M('a brief for the one that had it', 'brief', 'briefs', 'b1'),
  ];
  // drafting: no slot had it, a1 was cut off at its limit
  const drafting = {
    path: 'decided',
    trace: [
      { stage: 'draft', slot: 'a1', final: 'x', same: false, tokens: 700, letter: 'A' },
      { stage: 'draft', slot: 'a2', final: 'y', same: false, tokens: 90, letter: 'B' },
      { stage: 'draft', slot: 'b1', final: 'z', same: false, tokens: 120, letter: 'C' },
      { stage: 'decide', slot: 'decide', final: 'x', same: false, probs: { A: 0.5, B: 0.3, C: 0.2 } },
    ],
  };
  const dEv = evidenceOf(drafting, b, { replay });
  const dOrder = orderFor(pool, dEv).map((m) => m.name);
  // choosing: two drafts hold the right answer, the decider took another, narrowly
  const choosing = {
    path: 'decided-against-most',
    trace: [
      { stage: 'draft', slot: 'a1', final: 'x', same: false, letter: 'A' },
      { stage: 'draft', slot: 'a2', final: 'y', same: true, letter: 'B' },
      { stage: 'draft', slot: 'b1', final: 'y', same: true, letter: 'B' },
      { stage: 'decide', slot: 'decide', final: 'x', same: false, close: true, probs: { A: 0.52, B: 0.48 } },
    ],
  };
  const cEv = evidenceOf(choosing, b, { replay });
  const cOrder = orderFor(pool, cEv).map((m) => m.name);
  // learned: a kind of change that has reached parity often comes before one that has not, all else equal
  const learnt = orderFor([M('a better brief', 'brief', 'briefs', 'a1'), M('a2 at temperature 0.7')], {
    lost: 'drafting',
    classes: {
      'a drafter sampled otherwise': { tried: 4, reached: 3 },
      'a brief from the reading': { tried: 4, reached: 0 },
    },
  }).map((m) => m.name);
  // built on: a change that put the answer on the table (drafting became choosing) is kept under the next one that reaches parity
  const steps = [];
  const built = await runLoop({
    list: [{ id: 'q', kind: 'k' }],
    briefs: { version: 1, has: [], slots, plan: {} },
    cap: 4,
    poolOf: (bb) =>
      ['room', 'decide']
        .filter((k) => !bb.has.includes(k))
        .map((k) => ({
          key: k,
          id: k,
          name: k === 'room' ? 'a1 with a token limit of 1100' : 'plan: decide by most',
          kind: 'arrangement',
          area: k === 'room' ? 'slots' : 'decider',
          briefs: { ...bb, has: [...bb.has, k] },
        })),
    attempt: async (bb) => {
      steps.push(bb.has.join('+'));
      const has = (k) => bb.has.includes(k);
      // with room a1 drafts the right answer but the decider still takes another; with room and deciding by most, parity
      return has('room') && has('decide')
        ? { grade: 'right', trace: [] }
        : has('room')
          ? { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: true, final: 'y' }] }
          : {
              grade: 'wrong',
              path: 'decided',
              trace: [{ stage: 'draft', slot: 'a1', same: false, final: 'x', tokens: 700 }],
            };
    },
    lostOf: async (row, bb) => evidenceOf(row, bb, { replay }),
  });
  const q = built.questions[0];
  // calls built from the question and the drafts, where the probing slot gave none
  const calls = callsFrom(
    'Write `runLength(text)`: for example "aaabcc" becomes "a3bc2".',
    ['function runLength(text) { return text; }'],
    'runLength',
  );
  const ranAll = await behaviours({
    question: 'Write a function `double(list)` that doubles each number, for example [1, 2] becomes [2, 4].',
    drafts: [
      { letter: 'A', final: 'function double(list) { return list.map((x) => x * 2); }' },
      { letter: 'B', final: 'function double(list) { const o = []; for (const x of list) o.push(x + x); return o; }' },
      { letter: 'C', final: 'function double(list) { return list.map((x) => x * 3); }' },
    ],
    probeText: 'function double(list) { return list.map((x) => x * 2); }',
  });
  check(
    "training learns how to train: where no slot had the answer, more room for a slot cut off at its limit comes first, then other drafts, and a change to how the matter is decided is not tried; where a slot had it, a way of deciding that the question's own record replays as right comes first, one it replays as wrong is not tried, a model beside a decider that was close comes next, and a brief for a slot that already had the answer is not tried; one of each idea before a second; the kinds of change that have reached parity more often come sooner; a change that put the answer on the table is built on, and kept with the one that then reaches parity; and where the probing slot gave no calls, calls are made from the question's own examples and the drafts' parameters, so drafts that do the same are one answer",
    dEv.lost === 'drafting' &&
      dOrder[0] === 'a1 with a token limit of 1100' &&
      !dOrder.includes('b1 with a token limit of 1100') === false &&
      dOrder.indexOf('b1 with a token limit of 1100') > dOrder.indexOf('a1 at temperature 0.7') &&
      !dOrder.some((n) => /decide by|a model settles|keep the likeliest/.test(n)) &&
      dOrder.indexOf('add a second a1 on c') > dOrder.indexOf('a better brief') &&
      cEv.lost === 'choosing' &&
      cOrder[0] === 'plan: decide by most' &&
      cOrder.slice(0, 2).every((n) => /^plan: decide by /.test(n)) &&
      replay([choosing]).ways['decider-unless-majority'] === 1 &&
      cOrder[2] === 'plan: a model settles it where the decider is close' &&
      !cOrder.includes('a brief for the one that had it') &&
      cOrder.indexOf('flow: keep the likeliest two, straight after the try') > cOrder.indexOf('a better brief') &&
      classOf(M('the larger model: draft', 'brief')) === 'a brief by the larger model' &&
      classOf(M('plan: decide by most')) === 'another way of deciding' &&
      learnt[0] === 'a2 at temperature 0.7' &&
      q.state === 'reached' &&
      q.attempts[1].builtOn === true &&
      q.attempts[2].on.join() === 'a1 with a token limit of 1100' &&
      built.kept[0].what === 'several: a1 with a token limit of 1100 + plan: decide by most' &&
      built.classes['more room to answer'].tried === 1 &&
      built.classes['another way of deciding'].reached === 1 &&
      steps.join('|') === '|room|room+decide' &&
      calls.length >= 3 &&
      calls.includes('runLength("aaabcc")') &&
      calls.includes('runLength("")') &&
      ranAll &&
      ranAll.groups.length === 2 &&
      ranAll.groups.some((g) => g.join() === 'A,B'),
    {
      dOrder,
      cOrder,
      learnt,
      q: q.attempts,
      kept: built.kept.map((k) => k.what),
      steps,
      calls,
      groups: ranAll && ranAll.groups,
    },
  );
}

// ---- 9d: the code and its checks name no one decision model: the decider is whichever the configuration names
{
  const { decideByOf } = await import('../src/orchestrate.mjs');
  const { evidenceOf } = await import('../training/loop.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const { reap } = await import('../training/support/recover.mjs');
  const { spawn } = await import('node:child_process');
  // a plan, or a record, from when Kev was the only decider reads as the same thing under the decider's name
  const oldTrace = {
    path: 'decided-against-most',
    trace: [
      { stage: 'draft', slot: 'a1', final: 'x', same: false, letter: 'A' },
      { stage: 'draft', slot: 'a2', final: 'y', same: true, letter: 'B' },
      {
        stage: 'decide',
        slot: 'kev-decide',
        member: 'kev',
        final: 'x',
        same: false,
        close: true,
        probs: { A: 0.51, B: 0.49 },
      },
    ],
  };
  const ev = evidenceOf(oldTrace, {
    slots: [
      { id: 'a1', stage: 'draft' },
      { id: 'a2', stage: 'draft' },
    ],
    plan: {},
  });
  const oldPlan = steps({ ...briefs, plan: { ...briefs.plan, decideBy: 'kev-if-confident' } }).map((c) => c.name);
  // a dead session's decider is stopped whatever it is: Kev's server, StartLux's, or a decision model llama.cpp serves
  const root = path.resolve('.');
  const decoys = [
    ['startlux-decide', 'serve', path.join(root, '.work', 'deciders', 'startlux', 'x')],
    ['llama-server', '-m', path.join(root, '.work', 'deciders', 'jeffan-4b', 'j.gguf')],
  ].map((a) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', ...a], { stdio: 'ignore' }));
  await new Promise((r) => setTimeout(r, 400));
  const seen = reap({ dry: true }).map((r) => r.pid);
  const kept = reap({ dry: true, keepDecider: true }).map((r) => r.pid);
  for (const d of decoys) d.kill();
  check(
    "the code and its checks name no one decision model: the decide step is the decider's, whichever is configured (its slot is `decide`, its ways of settling are 'decider', 'decider-if-confident', 'decider-unless-majority'); a plan or a record from when Kev was the only decider reads the same under the new names; and a dead session's decider is stopped whatever it is (Kev, StartLux, or one llama.cpp serves), and kept where asked",
    decideByOf() === 'decider' &&
      decideByOf('kev') === 'decider' &&
      decideByOf('kev-if-confident') === 'decider-if-confident' &&
      decideByOf('most') === 'most' &&
      ev.lost === 'choosing' &&
      ev.prio({ name: 'plan: a model settles it where the decider is close' }) === 1 &&
      !oldPlan.includes('plan: decide by decider-if-confident') &&
      oldPlan.includes('plan: decide by decider') &&
      !oldPlan.some((n) => /\bkev\b/.test(n)) &&
      decoys.every((d) => seen.includes(String(d.pid))) &&
      decoys.every((d) => !kept.includes(String(d.pid))),
    { ev: ev.lost, oldPlan: oldPlan.filter((n) => /decide by/.test(n)), seen: seen.length, kept: kept.length },
  );
}

await swarm.stop();
lfm.close();
bonsai.close();
console.log('\n' + (failed.length ? failed.length + ' FAILED, ' : 'all ') + passed + ' passed.');
process.exit(failed.length ? 1 : 0);
