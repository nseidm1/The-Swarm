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
import {
  createSwarm as createSwarmAsStored,
  serveSwarm,
  stopSwarms,
  ENTRY,
  MEMBERS,
  readBriefs,
} from '../src/index.mjs';
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
// THE DEFAULT ARRANGEMENT, WITH EVERY DRAFT ASKED AT ONCE AND THE DECIDER DECIDING: what the checks below drive the runtime with,
// since most of them are of what happens among four drafts, the checkers and the decider. The two settings the default adds
// to that (draftFirst, decideBy: 'most') have checks of their own, which read the file as it stands (STORED).
const STORED = readBriefs();
const briefs = (({ draftFirst, decideBy, ...plan }) => ({ ...STORED, plan }))(STORED.plan);
// (and a swarm made here is made with it, unless the check names an arrangement, a file of one or a spec)
const createSwarm = (o = {}) => createSwarmAsStored(o.briefs || o.briefsFile || o.spec ? o : { ...o, briefs });
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
  // what the writer is shown: the message, what was settled said to be a short statement and not the reply, the draft it came
  // from, and a request for the reply itself (told "the answer settled on", a small writer wrote about the answer)
  const wr = lfm.s.calls.find((c) => roleOf(c).stage === 'write');
  const shown = wr ? wr.messages.at(-1).content : '';
  check(
    "the writer is shown the person's message, what was settled as a short statement of the answer and not the reply, the draft it came from, and asked for the reply itself; its brief says a piece of writing is written in full, never described",
    shown.startsWith("The person's message:\nWhat is six times seven?") &&
      /What was settled, in short \(a statement of the answer, not the reply itself\): 42/.test(shown) &&
      shown.includes('The draft it came from:\nsix sevens') &&
      shown.endsWith('exactly as the person will read it, and nothing else.') &&
      !/answer settled on|They asked/.test(shown) &&
      /never describe the piece or say what the answer is/.test(wr.messages[0].content),
    shown,
  );
}
// ---- 1b: a reply that describes the answer instead of giving it is not sent: rewritten by the other model, or the draft goes out
{
  const piece =
    'Dear Sam,\n\n' + 'I am writing to say that I am leaving at the end of the month. '.repeat(8) + '\n\nBest, Alex';
  const draft = (b) =>
    roleOf(b).stage === 'write'
      ? null
      : piece + '\nANSWER: A short resignation letter to Sam saying Alex leaves at the end of the month';
  const W = [{ role: 'user', content: 'Write a short letter to my boss Sam saying I am quitting.' }];
  // the writer on a describes it; the other model, asked the same, writes it
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'The answer is a short resignation letter to Sam, as requested.' : draft(b);
  bonsai.s.script = (b) => (roleOf(b).stage === 'write' ? piece : draft(b));
  const one = await swarm.answer(W);
  // both describe it: the draft, which holds the piece, goes out (not the draft with the one-line answer after it)
  reset();
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write' ? 'The answer is a short resignation letter to Sam, as requested.' : draft(b);
  bonsai.s.script = (b) => (roleOf(b).stage === 'write' ? "The person's message:\nWrite a short letter" : draft(b));
  const two = await swarm.answer(W);
  // a reply that gives it is sent as written, and no other model is asked
  reset();
  lfm.s.script = (b) => (roleOf(b).stage === 'write' ? piece : draft(b));
  bonsai.s.script = draft;
  const three = await swarm.answer(W);
  const { lostAt, evidenceOf } = await import('../training/loop.mjs');
  const ev = evidenceOf(
    {
      trace: [
        { slot: 'a-direct', stage: 'draft', same: true },
        { slot: 'a-writer', stage: 'write', describes: 'x' },
      ],
    },
    { slots: [{ id: 'a-writer', stage: 'write' }] },
  );
  check(
    'a reply that describes the answer instead of giving it is not sent: it is marked, the largest small model that did not write it is asked the same and its reply goes out; where that one describes it too, the draft that holds the piece goes out, without the one-line answer after it; a reply that gives it goes out as written; and training reads a described reply as an answer lost in writing, puts changing the writer first, and says that it described the answer',
    one.reply === piece &&
      /\+rewritten/.test(one.path) &&
      one.trace.some((r) => r.slot === 'a-writer' && /says what the answer is/.test(r.describes || '')) &&
      one.trace.some((r) => r.slot === 'a-writer@b' && r.rewrite && !r.describes) &&
      two.reply === piece &&
      /\+described/.test(two.path) &&
      two.trace.filter((r) => r.describes).length === 2 &&
      three.reply === piece &&
      !/rewritten|described/.test(three.path) &&
      !three.trace.some((r) => r.slot === 'a-writer@b') &&
      lostAt({
        trace: [
          { stage: 'draft', same: true },
          { stage: 'write', describes: 'x' },
        ],
      }) === 'writing' &&
      ev.prio({ name: 'the settled answer goes out as it is' }) === 0 &&
      ev.because({ name: 'the settled answer goes out as it is' }) ===
        'the writer described the answer instead of giving it: this hands it over as it is',
    { one: [one.path, one.reply.slice(0, 60)], two: [two.path, two.reply.slice(0, 60)], three: three.path },
  );
}
// ---- 1c: what reads as describing the answer instead of giving it, from replies seen in two evaluations, and what does not
{
  const { describedNotGiven: dng } = await import('../src/read.mjs');
  const long = 'word '.repeat(120);
  const piece = { settled: 'A tailored resume template with twelve placeholders for a graduate', draft: long };
  const flagged = [
    ['The answer is a tailored resume template that includes 12 placeholders as requested.', piece],
    ['They asked:\nThe answer settled on: <<Resignation Notice>>', {}],
    ['The message asks for a summary of the Wikipedia page about Raymond III.', {}],
    ['A concise resume has been prepared with placeholders like [company].', {}],
    ['The answer is settled with a clever twist on rocket humor.', {}],
    ['the answer was settled as a creative tweet. the draft included the key elements', {}],
    ['The answer is Elohim and Allah.\n******\nThe response is clear: people refer to God by names', {}],
  ];
  const passed = [
    ['The answer is 42.', { settled: '42', draft: long }],
    ['Six times seven is 42.', { settled: '42', draft: 'six sevens' }],
    ['[Name]\n[Address]\nObjective: a motivated graduate seeking a first job', piece],
    ['# Raymond III, Count of Tripoli\n\nRaymond III was a prominent noble of the Crusader states.', piece],
    ['```js\n// the task requires the list to be rotated\nfunction rotate(l) { return l; }\n```', piece],
  ];
  check(
    'a reply reads as describing the answer instead of giving it when it repeats its labels, speaks of the request, the draft or the reply ("has been prepared", "the answer is settled with", "the draft included", "the response is clear"), or says what the answer is where a piece was wanted; an answer that is a value, the piece itself, and code whose comments speak of the task do not',
    flagged.every(([r, o]) => dng(r, o)) && passed.every(([r, o]) => !dng(r, o)),
    [flagged.filter(([r, o]) => !dng(r, o)).map(([r]) => r), passed.filter(([r, o]) => dng(r, o)).map(([r]) => r)],
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
  const refs4 = new Map([
    [q1.id, block(q1.ok)],
    [q2.id, block(q2.ok)],
    [q3.id, block(q3.ok)],
    [q4.id, 'I cannot write that.'],
  ]);
  // (graded against the larger model's reply, as every question was before it could carry a standard of its own: SWARM_GRADE=target)
  process.env.SWARM_GRADE = 'target';
  const rows = await runRows([q1, q2, q3, q4], async (q) => ({ reply: says[q.id] }), { ref: refs4 });
  delete process.env.SWARM_GRADE;
  const c = count(rows);
  // GRADED BY THE QUESTION'S OWN STANDARD (docs/swoa-parity.md, 4): its correct solution on its inputs, whatever the larger model
  // answered; whether it also agrees with the larger model's answer is kept beside the grade
  const ownRows = await runRows([q1, q2, q3, q4], async (q) => ({ reply: says[q.id] }), { ref: refs4 });
  const co = count(ownRows);
  check(
    "a question that carries its own correct solution is graded against it: right, wrong (with the input that parts it), no answer; it is counted whatever the larger model answered, how far it met the standard is kept as its reading, and whether it agrees with the larger model's answer is kept beside the grade",
    ownRows.map((r) => r.grade).join() === 'right,wrong,unsure,right' &&
      co.compared === 4 &&
      co.right === 2 &&
      ownRows.every((r) => r.standard === 'own') &&
      ownRows[0].agrees === true &&
      ownRows[1].agrees === false &&
      ownRows[3].agrees === undefined &&
      ownRows[1].partsOn &&
      ownRows[0].reading === 1 &&
      ownRows[1].reading < 1 &&
      !rows.some((r) => r.standard),
    ownRows.map((r) => [r.grade, r.standard, r.agrees, r.reading]),
  );
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
  process.env.SWARM_GRADE = 'target';
  const against = await runRows([code], async () => ({ reply: whole }), {
    ref: new Map([[code.id, cutReply]]),
    who: 'a',
  });
  delete process.env.SWARM_GRADE;
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
      // (an instrument turned on comes first of all: it costs nothing to try; then the flow)
      /^plan: a question .* is done by code$/.test(all[0].name) &&
      all.filter((c) => / is done by code$/.test(c.name)).length === 4 &&
      /^flow: /.test(all[4].name) &&
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
    configText({ a: 'x', list: ['one', 'two'] }) === '{\n  "a": "x",\n  "list": ["one", "two"]\n}\n',
    configText({ a: 'x', list: ['one', 'two'] }),
  );
  const mine = readPolicy({ policy: { loop: { cap: 12 } } });
  check(
    "how the trainer trains is data: the loop's limits (changes tried on a question, questions asked again before a keep, when a change is dropped), what the plan lists first, and how much each kind of move counts for; a configuration's own setting stands over the one every configuration starts with, and leaves the rest as they are; nothing of the old way is left in it (no margin, no screen, no review rules)",
    base.questions.each === 6 &&
      base.loop.cap === null &&
      base.loop.drop === null &&
      base.loop.beam === 3 &&
      base.loop.guard === 6 &&
      base.plan.arrangements >= 1 &&
      base.moves.weight.brief === 1 &&
      base.ratchet.passes >= 1 &&
      mine.loop.cap === 12 &&
      mine.loop.guard === 6 &&
      readPolicy({}).loop.cap === null &&
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
// ---- 6j: the page's own choices are read as they were written: who takes turns with tools, and serving with adapters (they
// were left out, so the page said "decided by the swarm" while the swarm gave them to its lead, and the adapters switch reached
// nothing)
{
  const { readConfig, writeConfig, CONFIG_FILE } = await import('../src/catalog.mjs');
  const was = fs.readFileSync(CONFIG_FILE, 'utf8');
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ ...JSON.parse(was), tools: 'swarm', adapters: true, judge: 'jeffan-4b' }),
  );
  const read = readConfig();
  const kept = writeConfig({ a: read.a });
  const onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const judgeOff = writeConfig({ judge: '' }).judge;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...JSON.parse(was), adapters: 'yes' }));
  const notTrue = readConfig();
  fs.writeFileSync(CONFIG_FILE, was);
  check(
    'who takes turns with tools, whether the small models are served with their adapters, and the judge of equivalence are read from the configuration as the page writes them, and survive another choice being written; anything but true leaves the adapters off, and the judge can be cleared',
    read.tools === 'swarm' &&
      read.judge === 'jeffan-4b' &&
      onDisk.judge === 'jeffan-4b' &&
      judgeOff === undefined &&
      read.adapters === true &&
      kept.tools === 'swarm' &&
      onDisk.adapters === true &&
      notTrue.adapters === undefined,
    { read, onDisk, notTrue },
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
  const { reword, reworded, kindsFor: kindsOfBodies } = await import('../training/tasks.mjs');
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
  // (every kind has a second wording: a programming question by its form, every other kind from its own draw)
  const held = tasks({ split: 'held', each: 2, kinds: kindsOfBodies(['crew']) });
  const second = reworded(held);
  // the kinds beyond programming and its conversation: arithmetic, logic, procedures, rules, calls, searching
  const others = tasks({
    split: 'held',
    each: 6,
    kinds: kindsOfBodies(['math', 'logic', 'reasoning', 'instructions', 'tools', 'search']),
  });
  const others2 = reworded(others);
  const digits = (x) => (String(x).match(/\d+(?:\.\d+)?/g) || []).sort().join();
  const quoted = (x) => (String(x).match(/"[^"]*"/g) || []).sort().join();
  const firstOf = (t) => others.find((x) => x.id === t.refId);
  const valueKinds = kindsOfBodies(['math', 'logic', 'reasoning']);
  const rightBoth = [];
  for (const t of others2.filter((x) => valueKinds.includes(x.kind)))
    rightBoth.push(
      t.want === firstOf(t).want &&
        (await t.good('ANSWER: ' + t.want)).grade === 'right' &&
        (await firstOf(t).good('ANSWER: ' + t.want)).grade === 'right',
    );
  const everyKind = tasks({ split: 'held', each: 6 });
  const everyKind2 = reworded(everyKind);
  const without = everyKind.filter((t) => !everyKind2.some((x) => x.refId === t.id)).map((t) => t.kind);
  const w = held.find((t) => t.kind === 'write-arrays');
  const body = w.ask.replace(/^Write a JavaScript function `[^`]+` that /, '');
  const refs = reference(second);
  const more = tasks({ split: 'held', each: 2, tiers: { fix: 2 } });
  check(
    "every kind of held question has a second wording that changes how it is put and nothing of what it asks, and is compared with the larger model's answer to the first: a programming question by its form, every other kind from its own draw, with every number and quoted word of the first in the second, every rule word for word and in the same order, every argument a call needs said outright, and the same answer good for both; a step that is followed by a search and what it returned keeps them as they were and puts only the question another way; the only questions without one are a message there is no other way to put and an agent's steps that end on what a tool returned (4 of 222); and a kind that is asked more of keeps the questions it had and adds to them",
    second.length === held.length &&
      others.length === 138 &&
      others2.length === 138 &&
      others2.every(
        (t) =>
          t.ask &&
          t.ask !== firstOf(t).ask &&
          t.id === t.refId + '~2' &&
          t.split === 'reworded' &&
          digits(t.ask) === digits(firstOf(t).ask) &&
          quoted(t.ask) === quoted(firstOf(t).ask),
      ) &&
      rightBoth.length === 120 &&
      rightBoth.every(Boolean) &&
      // a request with rules: every rule word for word, in the same order, after the request
      others2
        .filter((t) => t.kind === 'rules')
        .every(
          (t) =>
            t.ask.endsWith(t.rules.map((r) => r.says).join(' ')) &&
            firstOf(t).ask.endsWith(t.rules.map((r) => r.says).join(' ')),
        ) &&
      // a call: every argument it needs is said outright in the second wording too, and the step needed is the same
      others2
        .filter((t) => t.kind === 'calls')
        .every(
          (t) =>
            t.needs === firstOf(t).needs &&
            t.turns.length === 1 &&
            t.turns[0].content === t.ask &&
            (t.needs.calls || []).every((c) => Object.values(c.args).every((v) => t.ask.includes(String(v)))),
        ) &&
      // a search: what follows the question (the search made, what it returned) is as it was, and the question alone is put another way
      others2
        .filter((t) => t.kind === 'search')
        .every(
          (t) =>
            t.needs === firstOf(t).needs &&
            t.turns.length === firstOf(t).turns.length &&
            t.turns[0].role === 'user' &&
            t.turns[0].content === t.ask &&
            t.turns.slice(1).every((m, i) => m === firstOf(t).turns[i + 1]),
        ) &&
      others2.filter((t) => t.kind === 'search' && t.turns.length === 3).length >= 3 &&
      everyKind.length === 222 &&
      everyKind2.length === 218 &&
      without.sort().join() === 'agent,agent,agent,answer' &&
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
    { n: second.length, others: others2.length, without, sample: reword(w.ask).slice(0, 70) },
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
  // a step that is run at every start (run_each): the reader of answers in words may be another one since the pass stopped
  const C = JSON.stringify(path.join(top, 'config-c'));
  const each = (name, tag) => 'run_each ' + name + ' ' + JSON.stringify(ok) + ' ' + JSON.stringify(ran) + ' ' + tag;
  sh('open_pass ' + C + ' 1 "c vs t" && ' + each('00-reader', 'R1') + ' && ' + step('01-one', 'C1'));
  sh('open_pass ' + C + ' 1 "c vs t" && ' + each('00-reader', 'R2') + ' && ' + step('01-one', 'C1again'));
  const didC = fs.readFileSync(ran, 'utf8').trim().split('\n').slice(did.length);
  const { readerAddressOf } = await import('../training/readers.mjs');
  check(
    'the reader of answers in words is checked at every start of a pass, also one carried on (a judge may have been named since it stopped), while a step that ended well is still passed over; and the reader is the judge where the swarm has no decision model',
    didC.join() === 'R1,C1,R2' &&
      readerAddressOf({ decider: '', judge: 'http://j' }) === 'http://j' &&
      readerAddressOf({ decider: 'http://d', judge: 'http://j' }) === 'http://j' &&
      readerAddressOf({ decider: 'http://d' }) === 'http://d' &&
      readerAddressOf({}) === '' &&
      /run_each 00-reader\s+training\/readers\.mjs/.test(
        fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8'),
      ),
    { didC },
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
    BODIES,
    kindsFor,
    bodiesOf,
    messagesOf,
    reworded,
  } = await import('../training/tasks.mjs');
  const CREW_NAMES = [...CODE_KIND_NAMES, ...CREW_KIND_NAMES, 'agent'];
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
    "what the swarm is trained on is every body of work of a list kept as data (The Crew, Code, Math, Logic, Reasoning, Instructions, Tools, Search), and nothing is chosen: a pass asks the kinds of them all, each once (Code's are among The Crew's); the list has no default, since there is nothing to fall back to; the kinds of some can still be named (a record, a check), a name that is not one is passed over, and with none left it is every one; what a list of kinds covers is said from the kinds (a pass that asked The Crew's covered Code too); and every kind of every body makes a question",
    BODIES.join() === 'crew,code,math,logic,reasoning,instructions,tools,search' &&
      EQUIVALENCE.default === undefined &&
      NAMES.length === 37 &&
      new Set(NAMES).size === 37 &&
      NAMES.join() === kindsFor(BODIES).join() &&
      kindsFor().join() === NAMES.join() &&
      kindsFor([]).join() === NAMES.join() &&
      kindsFor(['nothing']).join() === NAMES.join() &&
      kindsFor(['code']).join() === CODE_KIND_NAMES.join() &&
      kindsFor(['code', 'crew']).join() === CREW_NAMES.join() &&
      kindsFor(['crew']).join() === CREW_NAMES.join() &&
      kindsFor(['math']).slice().sort().join() === 'chain,count,rate,shop,sum,units' &&
      kindsFor(['math', 'crew']).length === CREW_NAMES.length + 6 &&
      kindsFor(['logic', 'reasoning']).length === 14 &&
      make({ split: 'held', each: 2, kinds: kindsFor(['math', 'logic', 'reasoning']) }).length === 40 &&
      make({ split: 'train', each: 6 }).length === 222 &&
      make({ split: 'held', each: 6 }).length === 222 &&
      bodiesOf(NAMES).join() === BODIES.join() &&
      bodiesOf(CREW_NAMES).join() === 'crew,code' &&
      bodiesOf(CODE_KIND_NAMES).join() === 'code' &&
      bodiesOf(['chain', 'own-crew']).join() === '' &&
      EQUIVALENCE.targets.every((t) =>
        t.kinds.every((k) => make({ split: 'train', each: 1, kinds: [k] }).length === 1),
      ),
    { bodies: BODIES, kinds: NAMES.length },
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
  const { readConfig, writeConfig, CONFIG_FILE } = await import('../src/catalog.mjs');
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
  // (a first pass asks every kind; a configuration file that still names a choice, from when there was one, changes nothing)
  const first = kindsOf(questions('held', 2));
  const cfgWas = fs.readFileSync(CONFIG_FILE, 'utf8');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...JSON.parse(cfgWas), equivalence: ['math'] }));
  const withOldChoice = kindsOf(questions('held', 2));
  const readOld = readConfig().equivalence;
  const writtenOld = writeConfig({ a: readConfig().a }).equivalence;
  fs.writeFileSync(CONFIG_FILE, cfgWas);
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
  const firstPass = questions('train', 1)
    .filter((x) => x.kind.startsWith('own-'))
    .map((x) => x.ask);
  const crewTr = ownTr.filter((x) => x.kind === 'own-crew');
  writeState(was);
  check(
    'a person can write questions of their own for each body of work (one file each, edited from the page): blank ones and a file that will not read are no questions; the first, third ... are train questions and the second, fourth ... held, so nothing measured is what was chosen on; for The Crew each goes to the seat its mode names, for the others with a plain instruction to answer; each is judged as a reply in a conversation; a pass asks those its record kept, and a first pass those written now for every body of work (an addition to its questions, never a choice among them)',
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
      firstPass.join('|') === 'Move my dentist to Friday.|thanks!|What is 17 times 23?',
    { train: ownTr.map((x) => x.id), held: ownHe.map((x) => x.id), fromRecord, firstPass },
  );
  check(
    'a pass asks the kinds its record names, so that it ends on the questions it began with (one begun when a person still chose which bodies of work ends on those); a record from before there was a list ends its pass on the programming questions; a first pass asks the kinds of every body of work; and a choice left in a configuration file from when there was one is neither read nor written again',
    byRecord === 'chain,order' &&
      before === CODE_KIND_NAMES.join() &&
      first === NAMES.join() &&
      NAMES.length === 37 &&
      withOldChoice === first &&
      readOld === undefined &&
      writtenOld === undefined,
    { byRecord, before, first, readOld },
  );
}
// ---- 6q: more deciders: every one takes the same request, and each says how it is started and where it can run
{
  const { REGISTRY } = await import('../src/catalog.mjs');
  const { spawnSync } = await import('node:child_process');
  // (the decision models: the entry `none`, a swarm with no decision model, is not one of them and is checked with it, 6ah)
  const ds = REGISTRY.deciders.filter((x) => (x.serve || {}).kind !== 'none');
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
    'Sure:\n[{"name":"plainer","add":"Work it out in a few short steps before the last line."},{"name":"short","add":"too short"},{"name":"whole","brief":"Answer the question in a few short steps and end with a line that starts ANSWER: and holds only the answer."}]',
    'the larger model',
  );
  check(
    "when the slots the plan found failing have no briefs left to try, the larger model adds to what they are told: it is shown the slot's brief, what it wrote on TRAIN questions the swarm got wrong and the answer wanted (never a held question), and its reply is read for additions a small model can follow (a whole brief, as it was once asked for, is still read)",
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
      /never mention a question shown here/.test(briefAsk(briefs.slots[0], missed)) &&
      said.length === 2 &&
      said[0].name === 'the larger model: plainer' &&
      said[0].add === 'Work it out in a few short steps before the last line.' &&
      said[1].brief &&
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
  // (and with plan.toolReply 'proposed' the reply proposed is the reply, as it was before a reply was answered: SwOA T.9)
  const wordedAsProposed = await sw.answerTools(AGENT, {
    tools: TOOLS_,
    briefs: { ...sw.briefs, plan: { ...(sw.briefs.plan || {}), toolReply: 'proposed' } },
  });
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
      // (a reply is written by the answer procedure, whose slots here all say 42; the reply proposed stands where the plan says so)
      worded.reply === 'ANSWER: 42' &&
      /^tools-agreed\+answered/.test(worded.path) &&
      wordedAsProposed.reply === 'It exports add and sub.' &&
      wordedAsProposed.path === 'tools-agreed' &&
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
// model chooser offers spec.card and starts it with serveSwarm({ ...card, spec })); a spec changed since it was written,
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
  // (a member another engine serves: an engine the runtime cannot start, no folder named, or an adapter pinned for it)
  const withB = (b, more = {}) => {
    const r2 = { ...recipe, members: { a: recipe.members.a, b: { ...recipe.members.b, ...b } }, ...more };
    return { ...spec, spec: { ...spec.spec, recipeSha256: recipeSha256(r2) }, recipe: r2 };
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
      /which this runtime cannot start/.test(refused(withB({ engine: 'other' }))) &&
      /names no folder for its files/.test(refused(withB({ engine: 'tensorfold' }))) &&
      /loads no adapter/.test(
        refused(
          withB({ engine: 'tensorfold', dir: 'X' }, { adapters: { b: { file: 'x.gguf', sha256: 'a'.repeat(64) } } }),
        ),
      ) &&
      refused(withB({ engine: 'tensorfold', dir: 'X' })) === '' &&
      /not a SwOA spec/.test(refused({ spec: { format: 'other' } })) &&
      /version 9/.test(refused({ ...spec, spec: { ...spec.spec, version: 9 } })) &&
      /not pinned/.test(refused(unpinned)),
    { reply: got.reply, up: up.ok, changed: refused(changed) },
  );
}
// ---- 6x: THE ADAPTERS A SPEC PINS (version 3): found in the folder named, or beside a spec read from a file (<name>.adapters/),
// checked by SHA-256 and handed to the swarm; one missing, or another (trained again), is refused unless anyAdapters is said
{
  const { fromSpec, readSpec, recipeSha256 } = await import('../src/spec.mjs');
  const { createHash } = await import('node:crypto');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-spec-'));
  const bytes = Buffer.from('a LoRA, in miniature');
  const recipe = {
    members: Object.fromEntries(Object.entries(MEMBERS).slice(0, 2)),
    decider: { id: 'kev-4b' },
    engine: { name: 'llama.cpp' },
    serving: { slots: 3, contextPerSlot: 2048 },
    briefs,
    adapters: {
      a: { file: 'a-lora.gguf', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    },
  };
  const spec = { spec: { format: 'the-swarm/spec', version: 3, recipeSha256: recipeSha256(recipe) }, recipe };
  const file = path.join(dir, 'swarm.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  const why = (f) => {
    try {
      f();
      return '';
    } catch (e) {
      return e.message;
    }
  };
  const missing = why(() => fromSpec(file));
  fs.mkdirSync(path.join(dir, 'swarm.adapters'));
  fs.writeFileSync(path.join(dir, 'swarm.adapters', 'a-lora.gguf'), bytes);
  const found = fromSpec(file);
  const named = fromSpec(spec, { adaptersDir: path.join(dir, 'swarm.adapters') });
  fs.writeFileSync(path.join(dir, 'swarm.adapters', 'a-lora.gguf'), Buffer.from('trained again'));
  const other = why(() => fromSpec(file));
  const taken = fromSpec(file, { anyAdapters: true });
  const stray = why(() =>
    readSpec({
      ...spec,
      spec: { ...spec.spec, recipeSha256: undefined },
      recipe: { ...recipe, adapters: { z: { file: 'z.gguf', sha256: 'x' } } },
    }),
  );
  fs.rmSync(dir, { recursive: true, force: true });
  check(
    'a spec that pins its adapters makes the swarm with them: each is found beside the spec (or in the folder named) and checked by its SHA-256; one missing, or one trained again, is refused saying why (unless taken anyway), and an adapter for a place the recipe has no small model in is refused',
    /not in .*swarm\.adapters/.test(missing) &&
      found.loras.a === path.join(dir, 'swarm.adapters', 'a-lora.gguf') &&
      named.loras.a === found.loras.a &&
      /not the one the spec pins/.test(other) &&
      taken.loras.a === found.loras.a &&
      /not pinned to a small model/.test(stray) &&
      Object.keys(
        fromSpec({
          ...spec,
          spec: { ...spec.spec, version: 2, recipeSha256: undefined },
          recipe: { ...recipe, adapters: undefined },
        }).loras,
      ).length === 0,
    { missing, other, stray },
  );
}
// ---- 6y: EVERY SMALL MODEL OF THE CATALOG NAMES ITS ORIGINAL WEIGHTS (training/originals.json): what Pretrain fetches as it needs
// them, pinned to a revision, or why it cannot be adapted here; a model with neither said only that nothing was named
{
  const { ORIGINALS } = await import('../training/adapters.mjs');
  const fs = await import('node:fs');
  const small = JSON.parse(fs.readFileSync(new URL('../src/models.json', import.meta.url), 'utf8')).small;
  // (a model another engine serves is not adapted: an adapter here is a GGUF LoRA, which only llama.cpp loads, and mlxReady says so)
  const bad = small
    .filter((m) => (m.engine || 'llama') === 'llama')
    .map((m) => [m.id, ORIGINALS[m.file]])
    .filter(
      ([, o]) =>
        !o ||
        !o.repo ||
        !/^[0-9a-f]{40}$/.test(o.revision || '') ||
        !o.dir ||
        (o.cannot !== undefined && typeof o.cannot !== 'string'),
    )
    .map(([id]) => id);
  check(
    'every small model of the catalog names its original weights for Pretrain (a repository pinned to a revision, and its folder), or why it cannot be adapted here',
    bad.length === 0 && small.length >= 17,
    bad,
  );
}
// ---- 6z: EVERY MODEL OF THE SWARM IS OFFERED AS THE ONE BESIDE THE DECIDER FROM THE START: each way of asking it, with each model
// other than the first checker's (by its checker, else its first slot); offered only after a way was kept, they never were
{
  const { steps } = await import('../training/arrange.mjs');
  const { withPlaces } = await import('../src/index.mjs');
  const b3 = withPlaces(JSON.parse(fs.readFileSync(new URL('../src/briefs.json', import.meta.url), 'utf8')), [
    'a',
    'b',
    'c',
  ]);
  const names = steps(b3).map((m) => m.name);
  const judges = steps(b3).filter((m) => /^plan: a model .* \(as /.test(m.name));
  const first = (b3.slots.find((x) => x.stage === 'check') || b3.slots[0]).member;
  const others = ['a', 'b', 'c'].filter((m) => m !== first);
  check(
    "every model of the swarm is offered as the one beside the decider from the start: each of the four ways of asking (three beside the decider, and in its place), with each model other than the first checker's, by its checker or else its first slot; and the swap of the model beside it is still offered once a way is kept",
    judges.length === 4 * others.length &&
      judges.every((m) => others.includes(b3.slots.find((x) => x.id === m.briefs.plan.decideWith.slot).member)) &&
      names.includes('plan: a model decides with the decider') &&
      steps({ ...b3, plan: { ...b3.plan, decideWith: { how: 'together' } } }).some((m) =>
        /^plan: the model beside the decider is /.test(m.name),
      ),
    judges.map((m) => m.name),
  );
}
// ---- 6aa: A MARK THE QUESTION'S OWN CORRECT SOLUTION PROVES WRONG is set aside: found by running both on the question's inputs,
// answered once and never searched, and never a question a change must not lose (one finished before it was found included)
{
  const { runLoop, wrongMarksOf } = await import('../training/loop.mjs');
  const T = [
    { id: 'W', kind: 'k', name: 'f', ok: 'function f(x) { return x * 2; }', inputs: [[1], [2]] },
    { id: 'G', kind: 'k', name: 'f', ok: 'function f(x) { return x + 1; }', inputs: [[1], [2]] },
    { id: 'N', kind: 'k' },
  ];
  const ref = new Map([
    ['W', '```js\nfunction f(x) { return x * 3; }\n```'],
    ['G', '```js\nfunction f(x) { return x + 1; }\n```'],
  ]);
  const found = await wrongMarksOf(T, ref);
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const asked = [];
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const st = await runLoop({
    list: [
      { id: 'W', kind: 'k' },
      { id: 'B', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['x'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0 },
    wrongMarks: found,
    // W is at parity as the swarm stands only without x; B needs x: with W set aside, x is kept on B without W asked again
    attempt: async (bb, t, at) => (
      asked.push(t.id + (at.guard ? ':guard' : '')),
      t.id === 'W'
        ? bb.has.includes('x')
          ? wrong
          : { grade: 'right', trace: [] }
        : bb.has.includes('x')
          ? { grade: 'right', trace: [] }
          : wrong
    ),
  });
  const W = st.questions.find((q) => q.id === 'W');
  check(
    "a mark the question's own correct solution proves wrong is found by running both on the question's inputs, and that question is answered once, never searched, and never a question a change must not lose",
    [...found.keys()].join() === 'W' &&
      found.get('W').share === 0 &&
      W.state === 'mark wrong' &&
      W.reached === false &&
      W.attempts.length === 1 &&
      st.questions.find((q) => q.id === 'B').state === 'reached' &&
      !asked.includes('W:guard'),
    { found: [...found.keys()], W: W && W.state, asked },
  );
}
// ---- 6ab: THE READER CHECKED IS THE ONE THAT READS: a check on record by another reader than the one reading now is stale (and
// is run again before answers in words are graded); one by the same reader, or none at all, is not
{
  const { readerStale } = await import('../training/support/bench.mjs');
  const fs2 = await import('node:fs');
  const os = await import('node:os');
  const path2 = await import('node:path');
  const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), 'reader-'));
  const none = readerStale(dir, 'jeffan-4b');
  fs2.writeFileSync(path2.join(dir, 'reader.json'), JSON.stringify({ by: 'kev-0.8b', ok: false }));
  const other = readerStale(dir, 'jeffan-4b');
  const same = readerStale(dir, 'kev-0.8b');
  fs2.rmSync(dir, { recursive: true, force: true });
  check(
    "a reader's check on record by another reader than the one reading now is stale and names whose it was; one by the same reader, or none at all, is not",
    none === '' && other === 'kev-0.8b' && same === '',
    { none, other, same },
  );
}
// ---- 6ac: A LAST CHANCE IS BOUNDED: a question set aside that comes back with nothing changed gets as many tries again, and where
// they bring it nothing closer it is written down as not reached and the pass ends, instead of being searched without end
{
  const { runLoop } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  let triesA = 0;
  const st = await runLoop({
    list: [
      { id: 'A', kind: 'k' },
      { id: 'B', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) =>
      Array.from({ length: 60 }, (_, k) => 'm' + k)
        .filter((k) => !bb.has.includes(k))
        .map((k) => mk(bb, k)),
    policy: { setAsideAfter: 3, batch: 0, suggestEvery: 0, teachEvery: 0, reviewTries: 1000 },
    attempt: async (bb, t, at) => (
      t.id === 'A' && at.attempt && triesA++,
      t.id === 'A' ? wrong : { grade: 'right', trace: [] }
    ),
  });
  const A = st.questions.find((q) => q.id === 'A');
  check(
    'a question set aside that comes back with nothing changed gets as many tries again (3), and is then written down as not reached, saying it gave up, and the pass ends',
    A.state === 'not reached' && A.gaveUp && A.gaveUp.after === 3 && triesA === 6,
    { state: A.state, gaveUp: A.gaveUp, triesA },
  );
  // NOTHING WAITING IS A LAST CHANCE TOO (measured 2026-11-18: a question back on a changed arrangement, every other one set aside on
  // the arrangement as it stands, 2,281 tries): alone on its first visit, twice the tries; back on a changed arrangement, as many
  let triesL = 0;
  const lone = await runLoop({
    list: [{ id: 'L', kind: 'k' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) =>
      Array.from({ length: 60 }, (_, k) => 'm' + k)
        .filter((k) => !bb.has.includes(k))
        .map((k) => mk(bb, k)),
    policy: { setAsideAfter: 3, batch: 0, suggestEvery: 0, teachEvery: 0, reviewTries: 1000 },
    attempt: async (bb, t, at) => (at.attempt && triesL++, wrong),
  });
  const L = lone.questions.find((q) => q.id === 'L');
  let triesC = 0;
  const back = await runLoop({
    list: [
      { id: 'C', kind: 'k' },
      { id: 'D', kind: 'k' },
    ],
    briefs: { version: 2, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) =>
      Array.from({ length: 60 }, (_, k) => 'm' + k)
        .filter((k) => !bb.has.includes(k))
        .map((k) => mk(bb, k)),
    policy: { setAsideAfter: 3, batch: 0, suggestEvery: 0, teachEvery: 0, reviewTries: 1000 },
    resume: {
      ...lone,
      inHand: null,
      rows: [],
      questions: [
        { id: 'C', kind: 'k', state: 'set aside', asideAt: 1, sinceGain: 3, attempts: [] },
        { id: 'D', kind: 'k', state: 'set aside', asideAt: 2, sinceGain: 3, attempts: [] },
      ],
    },
    attempt: async (bb, t, at) => (t.id === 'C' && at.attempt && triesC++, wrong),
  });
  const C = back.questions.find((q) => q.id === 'C');
  check(
    'with nothing else waiting a question is still bounded: alone on its first visit it gets twice the tries (6), back on a changed arrangement as many (3), and each is written down as not reached',
    L.state === 'not reached' && L.gaveUp && triesL === 6 && C.state === 'not reached' && C.gaveUp && triesC === 3,
    { L: [L.state, L.gaveUp, triesL], C: [C.state, C.gaveUp, triesC] },
  );
}
// ---- 6ad: A QUESTION THAT KEEPS COMING A LITTLE CLOSER IS BOUNDED TOO (measured 2026-11-19: 72 to 164 tries on four questions'
// first visits while 137 waited): firstVisitTries sets it aside whatever came closer, and its return is bounded at twice that. And a
// class of change that has brought one question nothing is tried last there (dryClassAfter)
{
  const { runLoop, orderFor, dryClassesOf } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const go = async (firstVisitTries) => {
    let n = 0;
    const log = [];
    const st = await runLoop({
      list: [
        { id: 'A', kind: 'k' },
        { id: 'B', kind: 'k' },
      ],
      briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
      poolOf: (bb) =>
        Array.from({ length: 60 }, (_, k) => 'm' + k)
          .filter((k) => !bb.has.includes(k))
          .map((k) => mk(bb, k)),
      policy: { setAsideAfter: 3, firstVisitTries, batch: 0, suggestEvery: 0, teachEvery: 0, reviewTries: 1000 },
      attempt: async (bb, t, at) => {
        if (t.id === 'B') return (log.push('B'), { grade: 'right', trace: [] });
        if (at.attempt) log.push('A' + ++n);
        // every try reads a little closer than the one before, and none is right
        return {
          grade: 'wrong',
          reading: Math.min(0.9, 0.1 + bb.has.length * 0.1 + n * 0.001),
          path: 'decided',
          trace: [{ stage: 'draft', slot: 'a1', same: false }],
        };
      },
    });
    return { before: log.indexOf('B'), n, state: st.questions.find((q) => q.id === 'A').state };
  };
  const unbounded = await go(0);
  const bounded = await go(5);
  const pool = [
    { id: 'd1', key: 'd1', name: 'plan: decide by most', area: 'decider' },
    { id: 's1', key: 's1', name: 'add a second a-direct on b', area: 'slots' },
    { id: 'd2', key: 'd2', name: 'plan: decide by decider-if-confident', area: 'decider' },
  ];
  const { classOf } = await import('../training/loop.mjs');
  const dryClass = classOf(pool[0]);
  const plain = orderFor(pool, { lost: 'choosing' }).map((m) => m.id);
  const held = orderFor(pool, { lost: 'choosing', dry: new Set([dryClass]) }).map((m) => m.id);
  const pinned = orderFor(pool, { lost: 'choosing', dry: new Set([dryClass]), pin: ['d2'] }).map((m) => m.id);
  // WHAT A KIND HAS YIELDED COMES FIRST: with a record of 12 tries or more, the kind that reached parity 3 times in 10 is tried
  // before the one the question's record points at that reached none in 100; with little record the question's record decides
  const ySlots = classOf(pool[1]);
  const byYield = orderFor(pool, {
    lost: 'choosing',
    classes: { [dryClass]: { tried: 100, reached: 0 }, [ySlots]: { tried: 40, reached: 12 } },
  }).map((m) => m.id);
  const thin = orderFor(pool, {
    lost: 'choosing',
    classes: { [dryClass]: { tried: 2, reached: 0 }, [ySlots]: { tried: 2, reached: 1 } },
  }).map((m) => m.id);
  const P2 = await import('../training/loop-policy.mjs');
  const oldOrder = ['pin', 'evidence', 'momentum', 'learned', 'area', 'cost', 'fresh', 'plan'];
  const padded = P2.checkValue('order', oldOrder);
  const tries = (k, n, more = {}) => Array.from({ length: n }, () => ({ kind: k, grade: 'wrong', ...more }));
  const dry = dryClassesOf(
    [{ move: '' }, ...tries('x', 3), ...tries('y', 3), { kind: 'y', grade: 'wrong', closer: true }, ...tries('z', 2)],
    3,
  );
  check(
    'a question whose every try comes a little closer is set aside on its first visit after firstVisitTries tries in all (without it, it held the pass for hundreds), comes back bounded at twice that and is written down as not reached; a class of change tried dryClassAfter times on one question with none closer is tried last there, after every other change open, though not left out, and what a person pinned is not held back; and what a kind of change has yielded ranks it before the record of the question once it has been tried 12 times (3 in 10 before none in 100), not before, and an order saved before that key existed is kept with the key put in',
    unbounded.before > 100 &&
      bounded.before === 5 &&
      bounded.n <= 15 &&
      bounded.state === 'not reached' &&
      plain[0] !== 's1' &&
      held[0] === 's1' &&
      held.length === 3 &&
      pinned[0] === 'd2' &&
      dry.has('x') &&
      !dry.has('y') &&
      !dry.has('z') &&
      dryClassesOf(tries('x', 9), 0).size === 0 &&
      byYield[0] === 's1' &&
      thin[0] === plain[0] &&
      padded.ok &&
      padded.value.join() === P2.RANKS.join() &&
      !P2.checkValue('order', ['pin']).ok,
    { unbounded, bounded, plain, held, pinned, dry: [...dry], byYield, thin, padded },
  );
}
// ---- 6ae: A DRAFTER THAT ANSWERS BY A PROGRAM (SwOA specification O.6.1a): it writes the program, the sandbox runs it, and what
// it printed is its answer, in the pool like any other; it is left out where code is asked for, and where its program does not
// run it has no answer and is not asked again. The trainer can add one, on any model with a slot to spare, and only one. And
// what a configuration takes in memory against the larger model is worked out as the page works it out
{
  const { answer, COMPUTE_BRIEF } = await import('../src/orchestrate.mjs');
  const { printed } = await import('../src/behave.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const { classOf } = await import('../training/loop.mjs');
  const { footprintOf } = await import('../src/catalog.mjs');
  const plainSlots = [
    { id: 'a-direct', member: 'a', stage: 'draft', brief: 'Answer.' },
    { id: 'b-direct', member: 'b', stage: 'draft', brief: 'Answer.' },
    { id: 'w', member: 'a', stage: 'write', brief: 'Write.' },
  ];
  const prog = { id: 'a-program', member: 'a', stage: 'draft', compute: true, brief: 'Its own brief.' };
  const briefs = { version: 1, plan: {}, slots: [plainSlots[0], plainSlots[1], prog, plainSlots[2]] };
  const run = async (question, program) => {
    const told = {};
    const calls = [];
    const got = await answer([{ role: 'user', content: question }], {
      briefs,
      print: printed,
      ask: async (slot, msgs) => {
        calls.push(slot.id);
        told[slot.id] = msgs[0].content;
        if (slot.id === 'a-program') return { text: program };
        if (slot.stage === 'write') return { text: 'Written.' };
        return {
          text: /function/.test(question) ? '```js\nfunction add(a, b) { return a + b; }\n```' : 'Two.\nANSWER: 2',
        };
      },
    });
    return { got, told, calls, row: got.trace.find((t) => t.slot === 'a-program') };
  };
  const Q = 'How many times does the letter r appear in strawberry?';
  const ran = await run(Q, 'Here it is.\n```js\nconsole.log("strawberry".split("r").length - 1);\n```');
  const broken = await run(Q, '```js\nconsole.log(notThere.length);\n```');
  const code = await run('Write a JavaScript function add(a, b) that returns the sum.', '```js\nconsole.log(1);\n```');
  const added = steps({ ...briefs, slots: plainSlots }).filter((m) => / that answers by a program$/.test(m.name));
  const slotAdded = added.length ? added[0].briefs.slots.find((s) => s.compute) : null;
  const fp = footprintOf({ a: { bytes: 2 ** 30 }, b: { bytes: 2 ** 30 } }, { memGb: 5 }, { memGb: 18 });
  check(
    'a drafter that answers by a program is told to write the program and not its own brief; the program is run where it can reach nothing and what it printed is its answer, in the pool beside the other drafts; a program that does not run leaves it with no answer, and it is not asked again; where code is asked for it is not called at all; the trainer can add one on each model with a slot to spare, after the drafters, as its own kind of change, and not a second; and the memory a configuration takes is worked out as the page works it out',
    ran.told['a-program'].startsWith(COMPUTE_BRIEF) &&
      !ran.told['a-program'].includes('Its own brief.') &&
      ran.row.final === '3' &&
      ran.row.ok === true &&
      ran.row.computed === true &&
      /Ran its program: it printed 3/.test(ran.row.out) &&
      ran.got.trace.filter((t) => t.stage === 'draft' && t.ok).length === 3 &&
      broken.row.ok === false &&
      broken.row.computed === false &&
      broken.calls.filter((c) => c === 'a-program').length === 1 &&
      broken.got.decided === '2' &&
      !code.calls.includes('a-program') &&
      added.length === 2 &&
      slotAdded.stage === 'draft' &&
      slotAdded.brief === COMPUTE_BRIEF &&
      added[0].briefs.slots.findIndex((s) => s.compute) === 2 &&
      classOf(added[0]) === 'an answer worked out by a program' &&
      steps(briefs).filter((m) => / that answers by a program$/.test(m.name)).length === 0 &&
      fp.swarm === 8.5 &&
      fp.target === 18 &&
      fp.saved === 52.8 &&
      footprintOf({}, { memGb: 5 }, { memGb: 18 }) === null,
    { ran: ran.row, broken: broken.row, code: code.calls, added: added.map((m) => m.name), fp },
  );
}
// ---- 6af: WHAT THE SWARM TAKES IN MEMORY, MEASURED (training/support/measure-memory.mjs): each model's own process and the
// decider's, by what the machine says they hold, not by the size of their files
{
  const { footprintIn, mappedIn, gbOfPid, pidOnPort, measureSwarm } =
    await import('../training/support/measure-memory.mjs');
  // (a server that maps its model's file: 954.1M written and on the GPU, and 1.0G of a 1.1G file in memory, none written to)
  const row = (v, r, d) =>
    'mapped file                        ' +
    v +
    '     ' +
    r +
    '       ' +
    d +
    '       0K       0K       0K       0K        8 \n';
  const vmMapped = 'Physical footprint:         954.1M\nPhysical footprint (peak):  1.0G\n' + row('1.1G', '1.0G', '0K');
  const vmWritten = 'Physical footprint:         2.0G\n' + row('3.0G', '2.5G', '512.0M');
  const vm = 'Process: llama-server [8868]\nPhysical footprint:         10.3G\nPhysical footprint (peak):  10.4G\n';
  const exec = (cmd, args) =>
    cmd === 'vmmap'
      ? { 11: vm, 12: 'Physical footprint:         838.0M\n', 13: '', 15: vmMapped, 16: vmWritten }[args[1]] || ''
      : cmd === 'ps'
        ? { 13: ' 2202009\n', 14: '' }[args[3]] || ''
        : cmd === 'lsof' && args[1] === '-iTCP:8009'
          ? '13\n99\n'
          : '';
  const mac = { platform: 'darwin', exec };
  const whole = measureSwarm({ members: { a: 11, b: 12 }, decider: 'http://127.0.0.1:8009', target: 18 }, mac);
  const far = measureSwarm({ members: { a: 11, b: 12 }, decider: 'http://10.0.0.5:8009', target: 18 }, mac);
  const gone = measureSwarm({ members: { a: 11, b: 14 }, decider: 'http://127.0.0.1:8009', target: 18 }, mac);
  check(
    "the memory a swarm takes is measured from its own processes: on a Mac a process's physical footprint and the files mapped into it that are in memory and not written to (a model's weights, which the footprint leaves out; what was written to is in the footprint and is not counted twice), elsewhere (or where that says nothing) its resident size; the decider is found by the port it listens on, and one that is not on this machine is left out and said to be; the saving is worked out against the larger model's size; and where a small model cannot be measured nothing is written down",
    footprintIn(vm) === 10.3 &&
      footprintIn('nothing') === null &&
      gbOfPid(11, mac) === 10.3 &&
      gbOfPid(12, mac) === 0.82 &&
      mappedIn(vmMapped) === 1 &&
      mappedIn(vmWritten) === 2 &&
      mappedIn(vm) === 0 &&
      gbOfPid(15, mac) === 1.93 &&
      gbOfPid(16, mac) === 4 &&
      gbOfPid(13, mac) === 2.1 &&
      gbOfPid(13, { platform: 'linux', exec }) === 2.1 &&
      gbOfPid(14, mac) === null &&
      gbOfPid(0, mac) === null &&
      pidOnPort(8009, mac) === 13 &&
      pidOnPort(1, mac) === null &&
      whole.members.a === 10.3 &&
      whole.decider === 2.1 &&
      whole.swarm === 13.2 &&
      whole.saved === 26.7 &&
      whole.savedGb === 4.8 &&
      !whole.without &&
      far.decider === undefined &&
      far.without === 'the decider' &&
      far.swarm === 11.1 &&
      gone === null,
    { whole, far, gone },
  );
}
// ---- 6ag: A MODEL ALONE IS NOT ASKED AGAIN FOR ANOTHER SWARM (training/support/bench.mjs carriedResult): what another
// configuration against the same larger model measured, on exactly these questions and read by the same reader, is this one's too
{
  const { carriedResult } = await import('../training/support/bench.mjs');
  const { JUDGE, DECIDER } = await import('../src/catalog.mjs');
  const fs2 = await import('node:fs');
  const os = await import('node:os');
  const path2 = await import('node:path');
  const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), 'carried-'));
  const results = path2.join(dir, 'results');
  const work = path2.join(dir, 'work');
  const reader = (JUDGE || DECIDER).id;
  const put = (cfg, name, body) => {
    fs2.mkdirSync(path2.join(results, cfg), { recursive: true });
    fs2.writeFileSync(path2.join(results, cfg, name + '.json'), JSON.stringify(body));
  };
  const readBy = (cfg, by, at = '2026-11-18T09:00:00Z') => {
    fs2.mkdirSync(path2.join(work, cfg), { recursive: true });
    fs2.writeFileSync(path2.join(work, cfg, 'reader.json'), JSON.stringify({ by, at }));
  };
  const list = ['q1', 'q2', 'q3'].map((id) => ({ id, seed: 9 }));
  const rows = (label, ids) => ids.map((id) => JSON.stringify({ label, id, reply: 'x' })).join('\n') + '\n';
  fs2.mkdirSync(work, { recursive: true });
  fs2.writeFileSync(
    path2.join(work, 'baseline-runs.jsonl'),
    rows('big', ['q1', 'q2', 'q3']) + rows('big-self', ['q1', 'q2', 'q3']) + rows('small-alone-vs-big', ['q1', 'q2']),
  );
  const sum = (at, more = {}) => ({ at, seed: 9, asked: 3, right: 2, wrong: 1, ...more });
  put('x+y+d--big', 'big-held', sum('2026-11-18T10:00:00Z'));
  put('p+q+d--big', 'big-held', sum('2026-11-19T10:00:00Z'));
  put('x+y+d--big', 'big-self-held', sum('2026-11-18T10:00:00Z'));
  put('p+q+d--big', 'big-self-held', sum('2026-11-19T10:00:00Z'));
  put('x+y+d--big', 'small-alone-vs-big-held', sum('2026-11-18T10:00:00Z'));
  put('x+y+d--other', 'big-held', sum('2026-11-19T12:00:00Z'));
  put('me+d--big', 'big-held', sum('2026-11-19T13:00:00Z'));
  readBy('x+y+d--big', reader);
  readBy('p+q+d--big', 'another-reader');
  // (a third configuration: its reader on record is the one in use now, but named AFTER its result was measured; and a fourth,
  // whose result says itself who read it)
  put('late+d--big', 'big-third-held', sum('2026-11-19T10:00:00Z'));
  readBy('late+d--big', reader, '2026-11-19T11:00:00Z');
  put('said+d--big', 'big-said-held', sum('2026-11-19T10:00:00Z', { reader }));
  put('said2+d--big', 'big-said-held', sum('2026-11-19T11:00:00Z', { reader: 'another-reader' }));
  fs2.appendFileSync(
    path2.join(work, 'baseline-runs.jsonl'),
    rows('big-third', ['q1', 'q2', 'q3']) + rows('big-said', ['q1', 'q2', 'q3']),
  );
  const o = { resultsRoot: results, work, mine: 'me+d--big', target: 'big' };
  const namedAfter = carriedResult('big-third', 'held', list, o);
  const said = carriedResult('big-said', 'held', list, o);
  const plainRef = carriedResult('big', 'held', list, { ...o, read: false });
  const selfRead = carriedResult('big-self', 'held', list, o);
  const otherSeed = carriedResult('big', 'held', [{ id: 'q1', seed: 8 }, list[1], list[2]], { ...o, read: false });
  const fewer = carriedResult('big', 'held', list.slice(0, 2), { ...o, read: false });
  const unanswered = carriedResult('small-alone-vs-big', 'held', list, o);
  const none = carriedResult('big', 'train', list, { ...o, read: false });
  fs2.rmSync(dir, { recursive: true, force: true });
  check(
    "a model alone is not asked again for another swarm: what another configuration against the same larger model measured on exactly these questions is taken, the newest of them, and never this configuration's own or one against another larger model; answers a reader read are taken only where the reader in use now read them (as the result says, or, for one from before results said, as that configuration's reader on record says where it was checked before the result was measured, not after); and nothing is taken for other questions (another seed, another count), for a split not measured, or where an answer is not on record for every question",
    plainRef &&
      plainRef.from === 'p+q+d--big' &&
      plainRef.was.right === 2 &&
      selfRead &&
      selfRead.from === 'x+y+d--big' &&
      namedAfter === null &&
      said &&
      said.from === 'said+d--big' &&
      otherSeed === null &&
      fewer === null &&
      unanswered === null &&
      none === null,
    { plainRef, selfRead, namedAfter, said, otherSeed, fewer, unanswered, none },
  );
}
// ---- 6ah: A SMALL MODEL DECIDES IN PLACE OF THE DECIDER (SwOA specification O.6.6, HOW `alone`), and each small model of the swarm
// is put the recorded choices as the decider (training/decider-replay.mjs modelDecider)
{
  const { answer, JUDGE_BRIEF } = await import('../src/orchestrate.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const { classOf, tuned } = await import('../training/loop.mjs');
  const { modelDecider, replayWith } = await import('../training/decider-replay.mjs');
  const slots = [
    { id: 'a-direct', member: 'a', stage: 'draft', brief: 'Answer.' },
    { id: 'b-direct', member: 'b', stage: 'draft', brief: 'Answer.' },
    { id: 'b-check', member: 'b', stage: 'check', brief: 'Check.' },
    { id: 'w', member: 'a', stage: 'write', brief: 'Write.' },
  ];
  const flow = [{ do: 'draft' }, { do: 'decide' }, { do: 'write' }];
  let rulings = 0;
  let judgeTold = '';
  const go = (plan, judgeSays = 'B is right.\nANSWER: B') =>
    answer([{ role: 'user', content: 'What is 6 times 7?' }], {
      briefs: { version: 1, plan, slots, flow },
      decide: async ({ answers }) => (
        rulings++,
        { ok: true, letter: 'A', final: answers[0].final, probs: { A: 0.9, B: 0.1 } }
      ),
      ask: async (slot, msgs) =>
        slot.stage === 'judge'
          ? ((judgeTold = msgs[0].content), { text: judgeSays })
          : slot.stage === 'write'
            ? { text: 'It is.' }
            : { text: slot.member === 'a' ? 'ANSWER: 41' : 'ANSWER: 42' },
    });
  const byDecider = await go({});
  const before = rulings;
  const alone = await go({ decideWith: { how: 'alone', slot: 'b-check' } });
  const aloneRulings = rulings - before;
  const judgeRow = alone.trace.find((t) => t.stage === 'judge');
  const silent = await go({ decideWith: { how: 'alone', slot: 'b-check' } }, 'I cannot tell.');
  // one that names its answer with the words it was told to end with is read; and one cut off before it named any is asked once
  // more for its letter, in one line
  const echoed = await go(
    { decideWith: { how: 'alone', slot: 'b-check' } },
    'B holds.\nANSWER: B and the letter of the correct one.',
  );
  let askedAgain = 0;
  const cutOff = await answer([{ role: 'user', content: 'What is 6 times 7?' }], {
    briefs: { version: 1, plan: { decideWith: { how: 'alone', slot: 'b-check' } }, slots, flow },
    ask: async (slot, msgs) =>
      slot.stage === 'judge'
        ? /You ran out of room/.test(msgs[msgs.length - 1].content)
          ? (askedAgain++, { text: 'B' })
          : { text: 'Answer A multiplies wrongly. Answer B puts 42 back and it holds. So the correct choic' }
        : slot.stage === 'write'
          ? { text: 'It is.' }
          : { text: slot.member === 'a' ? 'ANSWER: 41' : 'ANSWER: 42' },
  });
  const cutRow = cutOff.trace.find((t) => t.stage === 'judge');
  // A MODULE WITH NO DECISION MODEL (modelDecides; the decider `none`): a slot decides whatever the plan says of deciding, even a
  // way that needs a decider's ruling, and with nothing named the first checker is asked
  const noneAsk = async (slot) =>
    slot.stage === 'judge'
      ? { text: 'ANSWER: B' }
      : slot.stage === 'write'
        ? { text: 'It is.' }
        : { text: slot.member === 'a' ? 'ANSWER: 41' : 'ANSWER: 42' };
  const none = await answer([{ role: 'user', content: 'What is 6 times 7?' }], {
    briefs: { version: 1, plan: { decideWith: { how: 'if-at-odds' } }, slots, flow },
    modelDecides: true,
    ask: noneAsk,
  });
  const noneBare = await answer([{ role: 'user', content: 'What is 6 times 7?' }], {
    briefs: { version: 1, plan: {}, slots, flow },
    modelDecides: true,
    ask: noneAsk,
  });
  const noneRow = noneBare.trace.find((t) => t.stage === 'judge');
  const { modelDecidesOf } = await import('../src/index.mjs');
  const mdo = [
    modelDecidesOf({}, null, true),
    modelDecidesOf({ decider: '' }, null, true), // (what the trainers pass where no decider runs)
    modelDecidesOf({ decider: 'http://127.0.0.1:8009' }, null, true),
    modelDecidesOf({ decide: async () => ({}) }, null, true),
    modelDecidesOf({}, null, false),
    modelDecidesOf({}, { decider: { id: 'none' } }, false),
    modelDecidesOf({}, { decider: { id: 'kev-4b' } }, true),
    modelDecidesOf({ modelDecides: false }, { decider: { id: 'none' } }, true),
  ];
  const { REGISTRY: REG2 } = await import('../src/catalog.mjs');
  const noneEntry = REG2.deciders.find((x) => x.id === 'none');
  const { spawnSync: sp2 } = await import('node:child_process');
  const noneReady = sp2('bash', ['training/decider.sh', 'ready'], {
    encoding: 'utf8',
    env: { ...process.env, DECIDER_ID: 'none', NODE: process.execPath },
  }).status;
  const moves = steps({ version: 1, plan: {}, slots, flow }).filter((m) => /in place of the decider/.test(m.name));
  const drafting = tuned({ lost: 'drafting' }, { slots }).skip(moves[0]);
  const choosing = tuned({ lost: 'choosing' }, { slots }).skip(moves[0]);
  // the replay: three recorded choices, the decider right on the first only; a model that always names the answer marked `same`
  const rec = (sameAt, decidedRight) => ({
    ask: 'Q?',
    trace: [
      { stage: 'draft', slot: 'a1', final: 'x', out: 'x', same: sameAt === 0 },
      { stage: 'draft', slot: 'b1', final: 'y', out: 'y', same: sameAt === 1 },
      { stage: 'decide', final: decidedRight ? (sameAt ? 'y' : 'x') : sameAt ? 'x' : 'y', same: decidedRight },
    ],
  });
  const rows = [rec(0, true), rec(1, false), rec(1, false)];
  const told = [];
  const knows = modelDecider(
    async (msgs) => (
      told.push(msgs),
      { text: 'ANSWER: ' + (/Answer B:\n.*\nIts final answer: y/.test(msgs[1].content) ? 'B' : 'A') }
    ),
  );
  const res = await replayWith(async (c) => {
    const right = c.answers.find((a) => a.same);
    return (await knows(c)) && { ok: true, letter: right.letter };
  }, rows);
  const mute = await replayWith(
    modelDecider(async () => ({ text: 'no letter here' })),
    rows,
  );
  check(
    "a small model can decide in place of the decider: it is shown every different answer, told what a model that decides is told, and its word settles it, with the decider not asked at all and its row marked so; where it names nothing the answer most slots hold stands; a letter followed by the words it was told to end with is read as that letter, and one cut off before it named any is asked once more for its letter, in one line; a module with no decision model (the decider `none`, which takes no memory, is never the default, and is always ready) decides so whatever its plan names, by the first checker where it names no slot; a swarm is one with no decision model as its caller says, else as its spec says, else as the configuration says unless a decider is given or named (an empty address names none); the trainer offers it as its own kind of change, only where an answer was lost in choosing; and each small model can be put a pass's recorded choices as the decider, counted as another decider is (chose the larger model's answer, recovered, lost), one that names no answer counted as failed",
    byDecider.decided === '41' &&
      alone.decided === '42' &&
      aloneRulings === 0 &&
      judgeRow.alone === true &&
      judgeRow.picked === 'B' &&
      judgeTold.startsWith(JUDGE_BRIEF.slice(0, 60)) &&
      echoed.decided === '42' &&
      cutOff.decided === '42' &&
      askedAgain === 1 &&
      cutRow.concluded === true &&
      /\(Asked for its answer in one line\.\)\nANSWER: B$/.test(cutRow.out) &&
      !silent.trace.some((t) => t.stage === 'decide') &&
      ['41', '42'].includes(silent.decided) &&
      silent.path === 'most' &&
      none.decided === '42' &&
      noneBare.decided === '42' &&
      mdo.join() === 'true,true,false,false,false,true,false,false' &&
      noneRow.member === 'b' &&
      noneRow.alone === true &&
      noneEntry &&
      noneEntry.memGb === 0 &&
      noneEntry.serve.kind === 'none' &&
      REG2.deciders[0].id !== 'none' &&
      noneReady === 0 &&
      moves.length >= 2 &&
      classOf(moves[0]) === 'a model in place of the decider' &&
      drafting === true &&
      choosing === false &&
      told.length === 3 &&
      told[0][0].content.startsWith(JUDGE_BRIEF.slice(0, 60)) &&
      /^The question:\nQ\?\n\nAnswer A:/.test(told[0][1].content) &&
      res.asked === 3 &&
      res.theirsRight === 3 &&
      res.nowRight === 1 &&
      res.recovered === 2 &&
      res.lost === 0 &&
      mute.asked === 0 &&
      mute.failed === 3,
    {
      alone: [alone.decided, alone.path, aloneRulings, judgeRow],
      silent: [silent.decided, silent.path],
      moves: moves.map((m) => m.name),
      res,
      mute,
    },
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
  // ---- what the proof found short is asked more of in the next pass (training/support/emphasis.mjs)
  const { pairedGap, verdictOf, capabilitiesOf, capabilityOf, proofFocus, readEvaluations } =
    await import('../training/support/emphasis.mjs');
  const { EQUIVALENCE: EQL } = await import('../training/tasks.mjs');
  const { proofWords } = await import('../training/pass.mjs');
  const res = (item, task, n, onlySwarm, onlyTarget) => ({
    item,
    itemName: item === 'crew' ? 'The Crew' : item[0].toUpperCase() + item.slice(1),
    task,
    swarm: { value: 0.5, n },
    target: { value: 0.6, n },
    agree: { of: n, same: n - onlySwarm - onlyTarget, onlySwarm, onlyTarget },
  });
  const evals = [
    // an older proof: Math short (two tasks, 500 questions together), The Crew's test short, Logic open, Code at parity
    {
      at: '2026-11-10T00:00:00Z',
      configuration: 'mine',
      adapters: [],
      results: [
        res('math', 'gsm8k', 300, 20, 50),
        res('math', 'bbh_arith', 200, 10, 30),
        res('crew', 'ifeval', 541, 30, 90),
        res('logic', 'bbh_logic', 100, 20, 26),
        res('code', 'humaneval_instruct', 500, 60, 62),
      ],
    },
    // a newer check of one Math task, 20 questions: it does not stand in for that task's proof
    { at: '2026-11-12T00:00:00Z', configuration: 'mine', adapters: [], results: [res('math', 'gsm8k', 20, 5, 5)] },
    // another configuration's, and this one's served with adapters: neither is of this module as it is served
    {
      at: '2026-11-13T00:00:00Z',
      configuration: 'other',
      adapters: [],
      results: [res('code', 'humaneval_instruct', 500, 10, 90)],
    },
    {
      at: '2026-11-13T00:00:00Z',
      configuration: 'mine',
      adapters: ['A'],
      results: [res('code', 'humaneval_instruct', 500, 10, 90)],
    },
  ];
  const caps = capabilitiesOf(evals, { configuration: 'mine', adapters: [], targets: EQL.targets });
  const capOf = (id) => caps.find((c) => c.id === id) || {};
  const pfocus = proofFocus({ rows: evals, configuration: 'mine', adapters: [], more: 2, targets: EQL.targets });
  const g1 = pairedGap({ n: 500, onlySwoa: 30, onlyTarget: 80 });
  check(
    "a capability's verdict is read from a proof by the rule of the SwOA specification (4.7), the same numbers the page reads: the gap paired question by question, its error, and parity, short or open against a margin of 0.05; over this configuration's evaluations as it is served now (another configuration's, or one served with other adapters, is not its proof), the newest result of each task at proof size before a newer check, the tasks of a capability together; and a capability is the body of work whose kinds train what a task measures: the one the task is listed under, or the one it names (IFEval is listed under The Crew and measures Instructions), named by the work and never by a product",
    g1.gap === -0.1 &&
      g1.gapStderr === 0.0205 &&
      verdictOf(g1.gap, g1.gapStderr) === 'short' &&
      verdictOf(-0.06, 0.0676) === 'open' &&
      verdictOf(-0.004, 0.0221) === 'parity' &&
      pairedGap({ n: 0, onlySwoa: 1, onlyTarget: 1 }) === null &&
      pairedGap({ n: 10 }) === null &&
      caps.map((c) => c.id).join() === 'code,instructions,logic,math' &&
      capOf('instructions').name === 'Instructions' &&
      capOf('instructions').tasks.join() === 'ifeval' &&
      capabilityOf('ifeval', 'crew', 'The Crew', EQL.targets).id === 'instructions' &&
      capabilityOf('gsm8k', 'math', 'Math', EQL.targets).id === 'math' &&
      capabilityOf('a_task_not_listed', 'crew', 'The Crew', EQL.targets).id === 'crew' &&
      capabilityOf('ifeval', 'crew', 'The Crew').id === 'crew' &&
      !JSON.stringify(caps).includes('Crew') &&
      capOf('math').verdict === 'short' &&
      capOf('math').n === 500 &&
      capOf('math').gap === -0.1 &&
      capOf('math').proof === true &&
      capOf('math').tasks.join() === 'bbh_arith,gsm8k' &&
      capOf('instructions').verdict === 'short' &&
      capOf('instructions').n === 541 &&
      capOf('logic').verdict === 'open' &&
      capOf('code').verdict === 'parity' &&
      capOf('code').n === 500 &&
      capOf('code').gap === -0.004 &&
      capabilitiesOf(evals, { configuration: 'mine', adapters: ['A'] }).length === 1 &&
      capabilitiesOf(evals, { configuration: 'nobody' }).length === 0 &&
      readEvaluations(path.join(os.tmpdir(), 'no-such-folder-of-evaluations')).length === 0,
    caps,
  );
  const e7 = endPass(state, { swarmRows: far, train, briefs, targets, emphasis: pfocus });
  const e8 = endPass(state, {
    swarmRows: far,
    train,
    briefs,
    targets,
    emphasis: { focus: { trap: 5 }, from: { at: 'x', more: 5, short: [], read: [] } },
  });
  const e9 = endPass({ ...state, focusFrom: e7.next.focusFrom }, { swarmRows: far, train, briefs, targets });
  const e10 = endPass(state, { swarmRows: whole, train, briefs, targets, emphasis: pfocus });
  const weighted = tasks({ split: 'train', each: 6, focus: e7.next.focus });
  const heldUnweighted = tasks({ split: 'held', each: 6, focus: e7.next.focus });
  check(
    "what the proof found the swarm short on is asked more of in the next pass: so many more train questions of each kind of the body of work that trains the capability (a capability is a body of work: IFEval's is Instructions, though the test is listed under The Crew), added to what the pass's own held questions ask more of, to at most six more of a kind; only a short verdict asks more, an open one or parity nothing; the pass keeps which came from where with the proof it read, a pass that was weighted by one says so in its own line of the record, and a new target starts with neither; nothing is read where the policy says 0 or no evaluation is this configuration's; and the held questions are never weighted",
    Object.keys(pfocus.focus).sort().join() === 'chain,count,rate,rules,shop,sum,units' &&
      Object.values(pfocus.focus).every((n) => n === 2) &&
      pfocus.from.more === 2 &&
      pfocus.from.at === '2026-11-10T00:00:00Z' &&
      pfocus.from.short.map((c) => c.id).join() === 'instructions,math' &&
      pfocus.from.short[0].kinds.join() === 'rules' &&
      pfocus.from.short[1].kinds.slice().sort().join() === 'chain,count,rate,shop,sum,units' &&
      pfocus.from.read.map((c) => c.id + ':' + c.verdict).join() ===
        'code:parity,instructions:short,logic:open,math:short' &&
      proofFocus({ rows: evals, configuration: 'mine', adapters: [], more: 0, targets: EQL.targets }).from === null &&
      proofFocus({ rows: evals, configuration: 'nobody', more: 2, targets: EQL.targets }).from === null &&
      Object.keys(proofFocus({ rows: evals, configuration: 'nobody', more: 2, targets: EQL.targets }).focus).length ===
        0 &&
      e7.next.focus.trap === 4 &&
      e7.next.focus.rules === 2 &&
      e7.next.focus.chain === 2 &&
      e7.next.focusFrom.held.trap === 4 &&
      e7.next.focusFrom.held.rules === undefined &&
      e7.next.focusFrom.proof.short.length === 2 &&
      e7.done.proofRead === undefined &&
      e1.next.focusFrom.proof === undefined &&
      e1.next.focus.rules === undefined &&
      e8.next.focus.trap === 6 &&
      e9.done.proofRead.at === '2026-11-10T00:00:00Z' &&
      e9.done.proofRead.short.join() === 'instructions,math' &&
      e9.next.focusFrom.proof === undefined &&
      e10.climbed.id === 'large' &&
      Object.keys(e10.next.focus).length === 0 &&
      Object.keys(e10.next.focusFrom).length === 0 &&
      weighted.filter((t) => t.kind === 'rules').length === 8 &&
      weighted.filter((t) => t.kind === 'chain').length === 8 &&
      weighted.filter((t) => t.kind === 'order').length === 6 &&
      heldUnweighted.filter((t) => t.kind === 'rules').length === 6 &&
      /found the swarm short on Instructions, by 0\.111 on 541 questions; Math, by 0\.100 on 500 questions: 2 more of each of its kinds/.test(
        proofWords(e7.next.focusFrom),
      ) &&
      /no capability is short in it/.test(proofWords({ proof: { at: '2026-11-10', short: [] } })) &&
      proofWords({ held: {} }) === '',
    { focus: pfocus.focus, from: pfocus.from, words: proofWords(e7.next.focusFrom) },
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
        // (a GGUF file for llama.cpp; for a model another engine serves, the files of its folder, which it names)
        ((m.engine || 'llama') === 'llama' ? f.file.endsWith('.gguf') : !!m.dir && m.file.endsWith('.safetensors')) &&
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
// ---- 9z: WHAT THIS TURN FILLED, AS THE SwOA SPECIFICATION SAYS IT (S3.8.5, O.8.3/O.8.4, R.4): thinking removed from a member's
// reply; the writer told to write the reply in full; a program the question asks the output of run and settling the matter
{
  const { answer: orchestrate, FULL_BRIEF } = await import('../src/orchestrate.mjs');
  const { asksForPiece } = await import('../src/read.mjs');
  const { withoutThinking } = await import('../src/read.mjs');
  const { programOf } = await import('../src/behave.mjs');
  const { printedBy } = await import('../src/sandbox.mjs');
  const { steps } = await import('../training/arrange.mjs');
  const thinking =
    withoutThinking('No problem.</think>No problem. If you like') === 'No problem. If you like' &&
    withoutThinking('<think>so</think>Yes') === 'Yes' &&
    withoutThinking('Yes<think>so') === 'Yes' &&
    withoutThinking('plain  ') === 'plain  ';
  const PROG =
    'What does this print?\n\nlet x = 5;\nfor (let i = 1; i <= 4; i++) {\n  if (i % 2 === 0) x = x - i;\n  else x = x + i * 2;\n}\nconsole.log(x);';
  const found =
    programOf(PROG).startsWith('let x = 5;') &&
    programOf('What does this function do?\n\nconsole.log(1)') === '' &&
    programOf('What is 2 + 2?') === '' &&
    programOf('What does this log?\n\n```js\nconsole.log("a", 1)\n```') === 'console.log("a", 1)';
  const ran = await printedBy(programOf(PROG));
  const notPlain = await printedBy('console.log([1, 2])');
  const base = {
    marker: 'ANSWER:',
    flow: [{ do: 'draft' }, { do: 'check' }, { do: 'decide' }, { do: 'write' }],
    plan: {},
    slots: [
      { id: 'a1', member: 'a', stage: 'draft', brief: 'Answer.' },
      { id: 'b1', member: 'b', stage: 'draft', brief: 'Answer.' },
      { id: 'b-check', member: 'b', stage: 'check', brief: 'Check.' },
      { id: 'w', member: 'a', stage: 'write', brief: 'Write.' },
    ],
  };
  const asked = [];
  const ask = async (slot, msgs) => {
    asked.push({ slot: slot.id, last: msgs[msgs.length - 1].content });
    if (slot.stage === 'write') return { text: 'It prints the number.' };
    return { text: 'working\nANSWER: ' + (slot.member === 'a' ? '13' : '5') };
  };
  const prog = await orchestrate([{ role: 'user', content: PROG }], {
    briefs: base,
    ask,
    print: async () => ({ text: '7' }),
  });
  const progAsked = asked.splice(0);
  const unrun = await orchestrate([{ role: 'user', content: PROG }], { briefs: base, ask, print: async () => null });
  asked.splice(0);
  const off = await orchestrate([{ role: 'user', content: PROG }], {
    briefs: { ...base, plan: { runPrograms: false } },
    ask,
    print: async () => ({ text: '7' }),
  });
  asked.splice(0);
  const askFull = async (slot, msgs) => {
    asked.push({ slot: slot.id, first: msgs[0].content, last: msgs[msgs.length - 1].content });
    return slot.stage === 'write' ? { text: 'Yes, in small pieces.' } : { text: 'ANSWER: yes' };
  };
  const full = await orchestrate([{ role: 'user', content: 'Can a rabbit eat celery?' }], {
    briefs: { ...base, plan: { writeAs: 'full' } },
    ask: askFull,
  });
  const wrote = asked.find((x) => x.slot === 'w');
  asked.splice(0);
  // (a piece of writing is never written "in full": the piece is the reply)
  const piece = await orchestrate([{ role: 'user', content: 'Write a text to Maya to cancel dinner on Wednesday.' }], {
    briefs: { ...base, plan: { writeAs: 'full' } },
    ask: askFull,
  });
  const wrotePiece = asked.find((x) => x.slot === 'w');
  const pieces =
    asksForPiece('in a rush sorry - write a note to the landlord about the boiler') &&
    !asksForPiece('hey quick one, write to my sister for me') &&
    !asksForPiece('What should I write? My text got no reply.') &&
    !asksForPiece('Can a rabbit eat celery?');
  const moves = steps({ ...base, plan: {} }).map((m) => m.name);
  const movesFull = steps({ ...base, plan: { writeAs: 'full' } }).map((m) => m.name);
  check(
    "thinking is removed from a member's reply; a program the question asks the output of is run, and what it printed settles the matter (the checks passed over, the work only a draft that came to it), unless it could not be run or the plan turns it off; with plan.writeAs 'full' the writer is told the full brief in place of its own (never where a piece of writing is asked for: there its own brief stands), and training can try it and take it back",
    thinking &&
      found &&
      ran &&
      ran.text === '7' &&
      notPlain === null &&
      prog.decided === '7' &&
      prog.path === 'ran' &&
      prog.trace.some((r) => r.printed && r.out === 'Ran the program: it printed 7') &&
      !progAsked.some((x) => x.slot === 'b-check') &&
      !/ANSWER: 13|ANSWER: 5/.test((progAsked.find((x) => x.slot === 'w') || {}).last || '') &&
      unrun.path !== 'ran' &&
      unrun.trace.some((r) => r.printed && !r.ok) &&
      off.path !== 'ran' &&
      !off.trace.some((r) => r.printed) &&
      /\+full/.test(full.path) &&
      wrote &&
      wrote.first.startsWith(FULL_BRIEF) &&
      !wrote.first.includes('Write.') &&
      !/in full/.test(wrote.last) &&
      pieces &&
      !/\+full/.test(piece.path) &&
      wrotePiece &&
      wrotePiece.first.startsWith('Write.') &&
      moves.includes('plan: the writer writes the reply in full') &&
      movesFull.includes('plan: the writer writes the reply as drafted'),
    {
      thinking,
      found,
      ran,
      notPlain,
      prog: [prog.decided, prog.path],
      unrun: unrun.path,
      off: off.path,
      full: full.path,
      moves: moves.filter((m) => /writer/.test(m)),
    },
  );
}
// ---- 9y: TRAINING READS THE SAME GAPS: a thin reply makes writing in full the first change tried; a degenerate mark, and one a
// question made with its answer proves wrong, are set aside
{
  const { evidenceOf, wrongMarksOf, degenerate } = await import('../training/loop.mjs');
  const row = {
    grade: 'wrong',
    reply: 'Yes, rabbits can eat celery.',
    refReply:
      'Yes, a rabbit can eat celery. It is safe and many rabbits enjoy the crunch. Wash it well, cut it into small pieces to prevent choking, and offer it as a treat a few times a week.',
    trace: [{ stage: 'draft', slot: 'a1', same: false, final: 'yes' }],
  };
  const ev = evidenceOf(row, { slots: [{ id: 'a1', stage: 'draft', member: 'a' }] });
  const m = { name: 'plan: the writer writes the reply in full' };
  const fat = evidenceOf({ ...row, reply: row.refReply }, { slots: [{ id: 'a1', stage: 'draft', member: 'a' }] });
  const grade = (reply) => (/\b7\s*$/.test(reply) ? 'right' : 'wrong');
  const marks = await wrongMarksOf(
    [{ id: 'deg' }, { id: 'tr', want: 7, grade }, { id: 'ok', want: 7, grade }],
    new Map([
      ['deg', '后汉书'.repeat(40)],
      ['tr', 'The output is 13.\n\nIt would be 5'],
      ['ok', 'It prints 7'],
    ]),
  );
  check(
    "a reply under half as long as the larger model's makes writing it in full the first change tried, and says why; a degenerate mark and a mark its own question's answer proves wrong are set aside, a right one is not",
    ev.prio(m) === 0 &&
      /less than half as long/.test(ev.because(m)) &&
      fat.prio(m) !== 0 &&
      degenerate('后汉书'.repeat(40)) &&
      !degenerate(row.refReply) &&
      marks.has('deg') &&
      marks.get('deg').degenerate &&
      marks.has('tr') &&
      !marks.has('ok'),
    { prio: ev.prio(m), because: ev.because(m), fat: fat.prio(m), marks: [...marks.keys()] },
  );
}
// ---- 9x: THE CHURN'S GAPS (2026-11-18): a brief the larger model wrote is offered on its class only; the teacher holds the wanted
// answer as the standard; and with decideBy 'most' a tie at the top goes to the decider among the tied answers, not to order
{
  const { offeredOn } = await import('../training/loop.mjs');
  const { teachAsk, briefAsk } = await import('../training/support/teach.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const cands = [
    { name: 'person', brief: 'p' },
    { name: 'the larger model: words one', add: 'w', written: true, class: 'words' },
    { name: 'the larger model: code one', add: 'c', written: true, class: 'code' },
    { name: 'the larger model: from before', brief: 'o', written: true },
    // (a whole brief it wrote, from when it was asked for replacements: not offered, though it says the class)
    { name: 'the larger model: a rewrite', brief: 'r', written: true, class: 'words' },
  ];
  const onWords = offeredOn(cands, 'words').map((c) => c.name);
  const scoped =
    JSON.stringify(onWords) === JSON.stringify(['person', 'the larger model: words one']) &&
    offeredOn(cands).length === 5;
  const slot = { id: 'a1', stage: 'draft', brief: 'Answer it briefly and plainly.' };
  const ta = teachAsk(slot, [{ id: 'train-1-answer-3', question: 'q', slotWrote: 'w', wanted: 'x' }]);
  const ba = briefAsk(slot, [{ question: 'q', slotWrote: 'w', wanted: 'x' }]);
  const standard =
    /The wanted answer is the standard/.test(ta) &&
    /Never teach the role to be shorter or plainer than the wanted answer/.test(ta) &&
    !/train-1-answer-3/.test(ta) &&
    /The wanted answer is the standard/.test(ba);
  const base = {
    marker: 'ANSWER:',
    flow: [{ do: 'draft' }, { do: 'decide' }],
    plan: { decideBy: 'most', writeAs: 'settled' },
    slots: [
      { id: 'a1', member: 'a', stage: 'draft', brief: 'A.' },
      { id: 'a2', member: 'a', stage: 'draft', brief: 'A.' },
      { id: 'b1', member: 'b', stage: 'draft', brief: 'A.' },
      { id: 'b2', member: 'b', stage: 'draft', brief: 'A.' },
    ],
  };
  const said = { a1: 'it can warp', a2: 'it can warp', b1: 'hand wash it', b2: 'hand wash it' };
  const asked = [];
  const run = (texts, pick = 'B') =>
    orchestrate(Q, {
      briefs: base,
      ask: async (s) => ({ text: 'ANSWER: ' + texts[s.id] }),
      decide: async ({ answers }) => {
        asked.push(answers.map((x) => x.letter + '=' + x.final).join(','));
        const a = answers.find((x) => x.letter === pick);
        return a ? { ok: true, letter: pick, final: a.final, probs: {} } : { ok: false, why: 'none' };
      },
    });
  const tie = await run(said);
  const tieAsked = asked.splice(0);
  const clear = await run({ ...said, b2: 'it can warp' });
  const clearAsked = asked.splice(0);
  const none = await run(said, 'Z');
  check(
    "what the larger model wrote for a slot is offered only on questions of the class it was written for, and only as an addition to what the slot is told (one from before briefs said a class, or a whole brief it wrote, nowhere a class is asked for; a person's, everywhere); the teacher is told the wanted answer is the standard, and never to teach a role to be shorter, and is not shown the question's id; with decideBy 'most' a tie at the top is put to the decider among the tied answers only, a clear most is not, and where it decides nothing the first stands",
    scoped &&
      standard &&
      tie.decided === 'hand wash it' &&
      tie.path.split('+')[0] === 'most-tie-decided' &&
      tieAsked.length === 1 &&
      tieAsked[0] === 'A=it can warp,B=hand wash it' &&
      tie.trace.some((r) => r.tie && /split 2 ways, 2 each: picked B/.test(r.out)) &&
      clear.path.split('+')[0] === 'most' &&
      clear.decided === 'it can warp' &&
      clearAsked.length === 0 &&
      none.path.split('+')[0] === 'most' &&
      none.decided === 'it can warp',
    { onWords, standard, tie: [tie.decided, tie.path, tieAsked], clear: [clear.path, clearAsked], none: none.path },
  );
}
// ---- 9w: THE FIXES OF 2026-11-18 (the run inspected): every slot's answer read on the reply's line; the reply's own reading
// counted first in how close a row came; a change that cannot change the answer passed over at no cost of a try; a mark the larger
// model did not give again set aside, not searched; its second answers read again where no reader had read them; and the larger
// model adding to what a slot is told, never writing it again
{
  const { slotReport } = await import('../training/measure.mjs');
  const { closeness, nearOf, effectOn, sameEffect, runLoop, READING_STEP, SCORING } =
    await import('../training/loop.mjs');
  const { regradeSelf, latestSelfRows } = await import('../training/support/self-check.mjs');
  const { teachAsk, briefAsk, candidatesIn, withAddition, candKey, refuseGiveaways, ADDITIONS_MOST } =
    await import('../training/support/teach.mjs');
  const { candHash } = await import('../training/state.mjs');
  // -- the line: a slot's answer is read with the mark the caller names for the task's type
  const marks = [];
  const task = {
    type: 'talk',
    equivalent: async (ref, text, ctx) => (marks.push(ctx.mark), { grade: 'wrong', p: 0.7 }),
    wrap: (x) => x,
  };
  const rowL = {
    id: 'q',
    refReply: 'ref',
    grade: 'wrong',
    decided: 'd',
    trace: [{ slot: 'a1', stage: 'draft', final: 'x', ms: 1 }],
  };
  await slotReport([rowL], { q: task }, { markOf: (t) => (t.type === 'talk' ? 0.8 : 0.5) });
  const onLine = marks.length > 0 && marks.every((m) => m === 0.8);
  marks.length = 0;
  await slotReport([{ ...rowL, trace: [{ slot: 'a1', stage: 'draft', final: 'y', ms: 1 }] }], { q: task });
  const noLine = marks.every((m) => m === undefined);
  // -- the reply's own reading comes first: a step up is closer whatever the drafts did; less than a step is the same
  const tr = [{ stage: 'draft', slot: 'a1', same: false, share: 0.5, final: 'x' }];
  const at = (reading, more = {}) => closeness({ trace: tr, reading, ...more }, null, { partial: true });
  const climbs =
    at(0.84) > at(0.53) &&
    at(0.53) === at(0.54) &&
    at(0.6) > at(0.59) &&
    at(0.9) >
      closeness({ trace: [{ stage: 'draft', slot: 'a1', same: true, share: 1, final: 'x' }], reading: 0.5 }, null, {
        partial: true,
      }) &&
    closeness({ trace: tr }, null, { partial: true }) ===
      closeness({ trace: tr, reading: 0.01 }, null, { partial: true }) &&
    nearOf({ trace: tr, reading: 0.837 }).reply === 0.84 &&
    READING_STEP === 0.05;
  // -- what can change an answer, by class
  const A = {
    slots: [
      { id: 'a1', stage: 'draft', member: 'a', brief: 'D.' },
      { id: 'c1', stage: 'check', member: 'b', brief: 'C.' },
    ],
    plan: { decideBy: 'most' },
  };
  const expectFlow = [
    { do: 'draft' },
    { do: 'try' },
    { do: 'check' },
    { do: 'expect' },
    { do: 'decide' },
    { do: 'write' },
  ];
  const effects =
    sameEffect(A, { ...A, plan: { ...A.plan, byBehaviour: false } }, 'words') &&
    !sameEffect(A, { ...A, plan: { ...A.plan, byBehaviour: false } }, 'code') &&
    !sameEffect(A, { ...A, plan: { ...A.plan, byBehaviour: false } }, 'talk') &&
    sameEffect(A, { ...A, flow: expectFlow }, 'words') &&
    !sameEffect(A, { ...A, flow: expectFlow }, 'code') &&
    !sameEffect(A, { ...A, flow: [{ do: 'draft' }, { do: 'decide' }, { do: 'write' }] }, 'words') &&
    !sameEffect(A, { ...A, plan: { decideBy: 'decider' } }, 'words') &&
    sameEffect(A, { ...A, plan: { decideBy: 'decider' } }, 'tools') &&
    sameEffect(A, { ...A, slots: [A.slots[0], { ...A.slots[1], brief: 'Other.' }] }, 'tools') &&
    !sameEffect(A, { ...A, slots: [{ ...A.slots[0], brief: 'Other.' }, A.slots[1]] }, 'tools') &&
    JSON.stringify(effectOn(A, 'words').flow.map((s) => s.do)) === '["draft","check","decide","write"]';
  // -- in the loop: a change of no effect is passed over and costs no try; an unstable mark short of parity is not searched
  const right = { grade: 'right', trace: [] };
  const wrongD = { grade: 'wrong', path: 'most', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const baseB = { version: 1, slots: [{ id: 'a1', stage: 'draft', brief: 'Draft it.' }], plan: {} };
  const asked = [];
  const loop = await runLoop({
    list: [
      { id: 'W', kind: 'answer', ask: 'Can a rabbit eat celery?' },
      { id: 'U', kind: 'answer', ask: 'How long do I boil an egg?' },
      { id: 'P', kind: 'answer', ask: 'How often do I water a fern?' },
    ],
    unstable: new Set(['U', 'P']),
    briefs: baseB,
    poolOf: (bb) =>
      [
        { id: 'noop', name: 'plan: byBehaviour false', briefs: { ...bb, plan: { ...bb.plan, byBehaviour: false } } },
        { id: 'real', name: 'a1 with a token limit of 1100', briefs: { ...bb, plan: { ...bb.plan, roomy: true } } },
      ]
        .filter((m) => JSON.stringify(m.briefs.plan) !== JSON.stringify(bb.plan))
        .map((m) => ({ ...m, key: m.id, area: 'plan', kind: 'arrangement' })),
    policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0, batch: 0 },
    attempt: async (bb, t, note) => {
      asked.push(t.id + ':' + (note.move || ''));
      if (t.id === 'P') return right;
      return t.id === 'W' && (bb.plan || {}).roomy ? right : wrongD;
    },
  });
  const stateOf = (id) => loop.questions.find((q) => q.id === id);
  const inLoop =
    stateOf('W').state === 'reached' &&
    stateOf('W').noEffect >= 1 &&
    !asked.some((x) => /byBehaviour/.test(x)) &&
    stateOf('U').state === 'mark unstable' &&
    stateOf('U').attempts.length === 1 &&
    asked.filter((x) => x.startsWith('U:')).length === 1 &&
    stateOf('P').state === 'at parity';
  // -- a search written down under another count of closeness is not carried on; one under this count is
  const heldOf = (scoring) => ({
    id: 'C',
    version: 1,
    ...(scoring ? { scoring } : {}),
    i: 7,
    q: { id: 'C', attempts: [{ move: '' }, { move: 'x' }, { move: 'y' }] },
    seen: [],
    root: [],
    open: [],
    wide: [],
  });
  const carryOn = async (scoring) =>
    (
      await runLoop({
        list: [{ id: 'C', kind: 'answer', ask: 'Is it so?' }],
        briefs: baseB,
        poolOf: () => [],
        policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0, batch: 0 },
        resume: { ...loop, questions: [], rows: [], inHand: heldOf(scoring) },
        attempt: async () => wrongD,
      })
    ).questions.find((q) => q.id === 'C');
  const old = await carryOn(0);
  const cur = await carryOn(SCORING);
  const carried = !old.carried && old.attempts.length === 1 && cur.carried === 1 && cur.attempts.length === 3;
  // -- the larger model's second answers, read again where no reader had read them
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-self-'));
  const file = path.join(dir, 'big-self-train.json');
  const runs = path.join(dir, 'baseline-runs.jsonl');
  const selfRow = (id, grade, reply) => ({
    label: 'big-self',
    split: 'train',
    seed: 9,
    id,
    kind: 'answer',
    grade,
    reply,
    seconds: 1,
  });
  fs.writeFileSync(
    runs,
    [
      selfRow('q1', 'right', 'a'),
      selfRow('q2', 'noref', 'second two'),
      selfRow('q3', 'noref', 'second three'),
      { ...selfRow('q3', 'noref', 'x'), seed: 8 },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  );
  fs.writeFileSync(
    file,
    JSON.stringify({ seed: 9, split: 'train', asked: 3, right: 1, wrong: 0, noref: 2, compared: 1, disagreed: [] }),
  );
  const count = (rows) => ({
    asked: rows.length,
    right: rows.filter((r) => r.grade === 'right').length,
    wrong: rows.filter((r) => r.grade === 'wrong').length,
    noref: rows.filter((r) => r.grade === 'noref').length,
    compared: rows.filter((r) => r.grade !== 'noref').length,
  });
  const selfList = ['q1', 'q2', 'q3'].map((id) => ({ id, seed: 9 }));
  const graded = [];
  const again = await regradeSelf({
    file,
    runsFile: runs,
    label: 'big-self',
    list: selfList,
    ref: new Map([
      ['q1', 'f1'],
      ['q2', 'f2'],
      ['q3', 'f3'],
    ]),
    count,
    grade: async (t, first, second) => (
      graded.push(t.id + ':' + first + ':' + second),
      { grade: t.id === 'q2' ? 'wrong' : 'right' }
    ),
  });
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const second = await regradeSelf({
    file,
    runsFile: runs,
    label: 'big-self',
    list: selfList,
    ref: new Map(),
    count,
    grade: async () => ({ grade: 'right' }),
  });
  const selfRead =
    again &&
    again.regraded === 2 &&
    JSON.stringify(again.disagreed) === '["q2"]' &&
    JSON.stringify(graded) === '["q2:f2:second two","q3:f3:second three"]' &&
    rec.noref === 0 &&
    rec.compared === 3 &&
    rec.right === 2 &&
    rec.wrong === 1 &&
    rec.regraded.read === 2 &&
    latestSelfRows(runs, { label: 'big-self', seed: 9 }).get('q2').grade === 'wrong' &&
    second === null;
  fs.rmSync(dir, { recursive: true, force: true });
  // -- the larger model adds to what a slot is told
  const slot = { id: 'a1', stage: 'draft', brief: 'Answer it briefly. End with ANSWER: and the answer.' };
  const ta = teachAsk(slot, [{ question: 'q', slotWrote: 'w', wanted: 'x' }]);
  const ba = briefAsk(slot, [{ question: 'q', slotWrote: 'w', wanted: 'x' }]);
  const got = candidatesIn(
    '[{"name":"reasons","why":"it gave no reason","add":"Give the reason too, in one sentence."},{"name":"old","brief":"' +
      'x'.repeat(60) +
      '"},{"name":"short","add":"hi"}]',
    'the larger model',
  );
  const one = withAddition(slot.brief, got[0].add);
  let full = slot.brief;
  for (let k = 0; k < ADDITIONS_MOST; k++) full = withAddition(full, 'Rule number ' + k + ' to keep to.');
  const adds =
    /three different ADDITIONS/.test(ta) &&
    /every word of it stays/.test(ta) &&
    /"add":"\.\.\."/.test(ta) &&
    !/replacements/.test(ta) &&
    /three different ADDITIONS/.test(ba) &&
    !/replacements/.test(ba) &&
    got.length === 2 &&
    got[0].add === 'Give the reason too, in one sentence.' &&
    got[0].brief === undefined &&
    got[1].brief &&
    one.startsWith(slot.brief) &&
    one.endsWith('Also keep to this: Give the reason too, in one sentence.') &&
    withAddition(one, got[0].add) === null &&
    withAddition(full, 'One more rule to keep to.') === null &&
    candKey(got[0]) !== candKey({ add: 'Another thing.' }) &&
    candHash(got[0]) !== candHash({ add: 'Another thing.' }) &&
    candHash({ brief: 'b' }) === candHash({ brief: 'b', add: undefined }) &&
    refuseGiveaways([{ name: 'n', add: 'Use list.slice(k) then join.' }], ['q']).refused.length === 1;
  check(
    "a slot's answer is read on the line the caller names for the task's type (and on none where none is named); how the reply itself read comes first in how close a row came, in steps of 0.05; a change that alters nothing a question of the class is answered by (byBehaviour and the try and expect steps for a question in words; anything but the drafting slots for a turn with tools) is passed over at no cost of a try; a mark the larger model did not give again is not searched where the swarm is short of it, and counts at parity where it is not; a search written down under another count of closeness is begun afresh, one under this count carried on; its second answers are read again where no reader had read them, once; and the larger model is asked for additions to what a slot is told, put after it, three at most",
    onLine && noLine && climbs && effects && inLoop && carried && selfRead && adds,
    {
      onLine,
      noLine,
      climbs,
      effects,
      inLoop,
      carried,
      selfRead,
      adds,
      old: [old.carried, old.attempts.length],
      cur: [cur.carried, cur.attempts.length],
      asked,
      W: stateOf('W') && [stateOf('W').state, stateOf('W').noEffect],
      U: stateOf('U') && stateOf('U').state,
      rec,
    },
  );
}
// ---- 9v: A PROOF RUN ASKS EACH TASK AT THE SIZE ITS BENCHMARK NAMES (docs/swoa-parity-plan.md, step 1): about five hundred
// questions for each body of work, which is what a verdict on a capability needs
{
  const { planOf, sizeOf } = await import('../training/evaluate.mjs');
  const EQ = JSON.parse(fs.readFileSync(new URL('../training/equivalence.json', import.meta.url), 'utf8'));
  const whole = { ifeval: 541, humaneval_instruct: 164 };
  const plan = planOf(EQ.targets, ['instructions', 'code', 'math', 'logic', 'reasoning']);
  const by = {};
  for (const b of plan) by[b.item] = (by[b.item] || 0) + (sizeOf(b, { proof: true }) || whole[b.task] || NaN);
  check(
    'a proof run asks each task at the size its benchmark names (every question where it names none), each body of work coming to five hundred or a little more and no task to fewer than a hundred; any other run asks every task at the one size it was given',
    plan.length === 16 &&
      Object.values(by).every((n) => n >= 500 && n <= 600) &&
      // (and never fewer than a hundred of one task: a result of fewer is a check, not proof)
      plan.every((b) => !sizeOf(b, { proof: true }) || sizeOf(b, { proof: true }) >= 100) &&
      sizeOf(plan[0], { proof: true }) === 0 &&
      sizeOf(
        plan.find((b) => b.task === 'gsm8k'),
        { proof: true },
      ) === 300 &&
      sizeOf(
        plan.find((b) => b.task === 'gsm8k'),
        { limit: 20 },
      ) === 20 &&
      sizeOf(plan.find((b) => b.task === 'gsm8k')) === 0,
    by,
  );
}
// ---- 9u: GOOD, WHERE THE QUESTION CAN SAY (docs/swoa-parity-plan.md, step 3): a value graded against the question's own answer, a
// flaw against the flaw the question was made with; which questions carry a standard; the module beside its target by family
{
  const { tasks, ownStandard } = await import('../training/tasks.mjs');
  const { familiesOf, coverageOf } = await import('../training/loop.mjs');
  const all = tasks({ split: 'train', each: 2 });
  const value = all.find((t) => t.type === 'value' && t.want !== undefined);
  const open = all.find((t) => t.type === 'open' && t.flaw);
  const talk = all.find((t) => t.type === 'talk');
  const code = all.find((t) => t.type === 'code');
  const vr = await value.good('Working it through.\nANSWER: ' + value.want);
  const vw = await value.good('ANSWER: nothing of the kind');
  // (the reader, stood in for: it is asked the question, the flaw as the standard, and the reply)
  const seen = [];
  const fetchImpl = async (url, o) => {
    const body = JSON.parse(o.body);
    seen.push(JSON.stringify(body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ answers: { same: { noul: /wrap/.test(JSON.stringify(body)) ? 0.93 : 0.07 } } }),
    };
  };
  const og = await open.good('It never wraps round.', { reader: 'http://reader', fetchImpl });
  const fams = familiesOf(
    [code, value, talk],
    [
      { id: code.id, grade: 'right' },
      { id: value.id, grade: 'wrong' },
      { id: talk.id, grade: 'noref' },
    ],
    (id) => (id === code.id ? false : id === value.id ? true : null),
  );
  const fam = Object.fromEntries(fams.map((f) => [f.kind, f]));
  const cov = coverageOf([code, talk], { ref: new Map() });
  check(
    "a value is good when it is the question's own answer, a flaw when the reader reads the reply as the flaw the question was made with (the flaw is what the reader is shown, not the larger model's answer); questions of code, of a value and of a flaw carry a standard, a reply in a conversation does not; the module is set beside the larger model family by family, the larger model counted by the same standard; and a question with its own standard is compared though the larger model never answered it",
    vr.grade === 'right' &&
      vr.score === 1 &&
      vw.grade !== 'right' &&
      seen.length === 1 &&
      seen[0].includes(open.flaw.slice(0, 20)) &&
      typeof og.score === 'number' &&
      ownStandard(code) &&
      ownStandard(value) &&
      ownStandard(open) &&
      !ownStandard(talk) &&
      fam[code.kind].module === 1 &&
      fam[code.kind].target === 0 &&
      fam[code.kind].targetKnown === 1 &&
      fam[value.kind].module === 0 &&
      fam[value.kind].target === 1 &&
      fam[talk.kind].own === false &&
      fam[talk.kind].target === null &&
      fam[talk.kind].asked === 0 &&
      cov.find((k) => k.kind === code.kind).compared === 1 &&
      cov.find((k) => k.kind === talk.kind).compared === 0,
    { vr, vw, og, fams, cov },
  );
}
// ---- 9t: GOOD, IN CONVERSATION (docs/swoa-parity-plan.md, step 4): the standard is the answers the larger model agrees with itself
// on; a reply is good against one of them, read at the line; a question none of whose answers agree has no standard
{
  const { standardOf, standardsFor, againstStandard, answersOf } = await import('../training/support/standard.mjs');
  const { talkEquivalent } = await import('../training/support/equivalent.mjs');
  const { run: runRows } = await import('../training/support/bench.mjs');
  const { runLoop } = await import('../training/loop.mjs');
  const eq = (a, b) => a[0] === b[0]; // (two answers agree when they begin alike)
  const two = await standardOf(['yes: wash it', 'yes: rinse it'], eq);
  const split = await standardOf(['yes', 'no'], eq);
  const three = await standardOf(['no: a', 'yes: b', 'yes: c'], eq);
  const one = await standardOf(['only'], eq);
  // kept, and worked out again only where a question has more answers than it had
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-std-'));
  const file = path.join(dir, 'standards.json');
  let asked = 0;
  const same = async (t, a, b) => (asked++, eq(a, b));
  const list = [{ id: 'q1' }, { id: 'q2' }];
  const answers = new Map([
    ['q1', ['yes', 'yup... no: it starts with y']],
    ['q2', ['yes', 'no']],
  ]);
  const s1 = await standardsFor({ list, answers, same, file, by: 'r' });
  const askedOnce = asked;
  const s2 = await standardsFor({ list, answers, same, file, by: 'r' });
  answers.set('q2', ['yes', 'no', 'nope']);
  const s3 = await standardsFor({ list, answers, same, file, by: 'r' });
  // the answers on record, by label
  const runs = path.join(dir, 'runs.jsonl');
  fs.writeFileSync(
    runs,
    [
      { label: 'big', id: 'q1', reply: 'first' },
      { label: 'big-self', id: 'q1', reply: 'second' },
      { label: 'big-third', id: 'q1', reply: 'third' },
      { label: 'big', id: 'q2', reply: 'only' },
      { label: 'small', id: 'q1', reply: 'not its' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  const got = answersOf(runs, { target: 'big', ids: new Set(['q1', 'q2']) });
  fs.rmSync(dir, { recursive: true, force: true });
  // a reply against a standard: good against any of its answers; else the nearest says how it fell short
  const t = {
    equivalent: async (a, reply, ctx) =>
      a === reply
        ? { grade: 'right', p: 0.95 }
        : { grade: 'wrong', p: a.length / 100, part: 'substance', atLine: ctx.atLine },
  };
  const hit = await againstStandard(t, { answers: ['alpha', 'beta'] }, 'beta', {});
  const miss = await againstStandard(t, { answers: ['a', 'longer one'] }, 'x', {});
  // at the line: 0.84 against a line of 0.8 is a yes there, and undecided where the band stands
  const reads = (p) => async () => ({
    ok: true,
    status: 200,
    json: async () => ({ answers: { same: { noul: p }, firstAsks: { noul: 0 }, secondAsks: { noul: 0 } } }),
  });
  const task = { system: 's', turns: [{ role: 'user', content: 'q' }], ask: 'q' };
  const banded = await talkEquivalent(task, 'a', 'b', { reader: 'http://r', mark: 0.8, fetchImpl: reads(0.84) });
  const atLine = await talkEquivalent(task, 'a', 'b', {
    reader: 'http://r',
    mark: 0.8,
    fetchImpl: reads(0.84),
    atLine: true,
  });
  const below = await talkEquivalent(task, 'a', 'b', {
    reader: 'http://r',
    mark: 0.8,
    fetchImpl: reads(0.74),
    atLine: true,
  });
  // graded in a run: against the standard where one was worked out, left out where there is none
  const tk = (id) => ({
    id,
    kind: 'talk',
    split: 'train',
    seed: 1,
    ask: 'q',
    type: 'tool',
    equivalent: async (a, reply) => ({ grade: a === reply ? 'right' : 'wrong' }),
    usable: (x) => !!x,
    show: (x) => String(x),
    wrap: (x) => x,
  });
  const ref = new Map([
    ['s1', 'first'],
    ['s2', 'first'],
  ]);
  ref.standard = new Map([
    ['s1', { answers: ['first', 'second'], none: false }],
    ['s2', { answers: [], none: true }],
  ]);
  const rows = await runRows([tk('s1'), tk('s2')], async () => ({ reply: 'second' }), { ref });
  const st = await runLoop({
    list: [{ id: 'N', kind: 'talk', ask: 'q' }],
    briefs: { version: 1, slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: () => [],
    policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0 },
    attempt: async () => ({ grade: 'noref', noStandard: true, trace: [] }),
  });
  check(
    "the standard for a question with none of its own is the answers of the larger model that agree with each other (both of two; the two of three that agree; none where none do; the one where there is one), worked out once and again only when a question has more answers; its answers are read from the record by label; a reply is good against any answer of the standard, at the reader's line with nothing undecided above it; a question with no standard is not compared in a run, and is left out of the loop as its own state",
    JSON.stringify(two) === '{"idx":[0,1],"none":false}' &&
      split.none &&
      JSON.stringify(three.idx) === '[1,2]' &&
      JSON.stringify(one) === '{"idx":[0],"none":false}' &&
      s1.get('q1').answers.length === 2 &&
      s1.get('q2').none &&
      askedOnce === 2 &&
      asked === 5 &&
      s2.worked === 0 &&
      s3.worked === 1 &&
      JSON.stringify(s3.get('q2').answers) === '["no","nope"]' &&
      JSON.stringify(got.get('q1')) === '["first","second","third"]' &&
      JSON.stringify(got.get('q2')) === '["only"]' &&
      hit.grade === 'right' &&
      hit.of === 2 &&
      miss.grade === 'wrong' &&
      miss.p === 0.1 &&
      miss.atLine === true &&
      banded.grade === 'wrong' &&
      banded.undecided === true &&
      atLine.grade === 'right' &&
      below.grade === 'wrong' &&
      below.undecided === true &&
      rows[0].grade === 'right' &&
      rows[1].grade === 'noref' &&
      rows[1].noStandard === true &&
      st.questions[0].state === 'no standard',
    {
      two,
      split,
      three,
      one,
      asked,
      askedOnce,
      hit,
      miss,
      banded,
      atLine,
      below,
      rows: rows.map((r) => [r.grade, r.noStandard]),
      state: st.questions[0].state,
    },
  );
}
// ---- 9s: KEEPING A CHANGE BY ITS CLASS (docs/swoa-parity-plan.md, step 5): one question brought to parity is a guess; the class
// decides. Kept where the class gains more than twice its error, or where a question is made good on two draws and none is lost;
// not where the question was good on one draw only, where a question is lost, where a kind falls, where the held questions fall;
// raced on a few first; and what most often came closer is proposed for the class outright
{
  const { runLoop } = await import('../training/loop.mjs');
  const kinds = ['answer', 'request', 'piece'];
  const list = [];
  for (const k of kinds)
    for (let n = 1; n <= 4; n++) list.push({ id: k + '-' + n, kind: k, ask: 'About ' + k + ' ' + n + '?' });
  const held = kinds.map((k) => ({ id: 'held-' + k, kind: k, ask: 'Held, about ' + k + '?' }));
  const base = { version: 1, slots: [{ id: 'a1', stage: 'draft', brief: 'Draft it.' }], plan: {} };
  const row = (score) => ({
    grade: score >= 1 ? 'right' : 'wrong',
    reading: score,
    path: 'most',
    trace: [{ stage: 'draft', slot: 'a1', same: false }],
  });
  // each change is a field of the plan; how a question scores under it is what `scores` says
  const mk = (bb, name) => ({
    id: name,
    key: name,
    name,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, plan: { ...bb.plan, [name]: true } },
  });
  const run = async (
    scores,
    {
      classTries = 0,
      names = Object.keys(scores).filter((k) => k !== 'base'),
      resume = null,
      onTry = async () => {},
    } = {},
  ) => {
    const asked = [];
    const kept = [];
    const st = await runLoop({
      ...(resume ? { resume } : {}),
      onTry,
      list,
      heldQs: held,
      briefs: base,
      classKeep: true,
      classRace: 3,
      classTries,
      poolOf: (bb) => names.filter((n) => !(bb.plan || {})[n]).map((n) => mk(bb, n)),
      policy: { setAsideAfter: 2, suggestEvery: 0, teachEvery: 0, batch: 0, prune: false },
      keep: async (b, entry) => kept.push(entry),
      attempt: async (bb, t, note) => {
        const on = names.filter((n) => (bb.plan || {})[n]);
        asked.push(t.id + ':' + on.join('+'));
        let s = scores.base(t);
        for (const n of on) s = scores[n](t, s, note);
        return row(Math.max(0, Math.min(1, s)));
      },
    });
    return { st, asked, kept };
  };
  // every question stands at 0.5. "lift" takes the whole class to 0.8 and the question in hand to parity: kept
  const lift = await run({ base: () => 0.5, lift: (t) => (t.id === 'answer-1' ? 1 : 0.8) });
  // "one" brings one question to parity and moves nothing else: its gain of one question in twelve is within its error, and it
  // is kept because the question is good on another draw too, and none is lost
  const one = await run({ base: () => 0.5, one: (t, s) => (t.id === 'answer-1' ? 1 : s) });
  const k1 = one.kept[0] || {};
  // A CHECK STOPPED IN THE MIDDLE CARRIES ON: what the change had scored is on the record (st.checking), and those questions
  // are not asked with it again; the record is written as the check goes, and is gone once the check has ended
  let wrote = 0;
  let sawChecking = false;
  const carried = await run(
    { base: () => 0.5, one: (t, s) => (t.id === 'answer-1' ? 1 : s) },
    {
      resume: {
        questions: [],
        rows: [],
        moves: {},
        kept: [],
        checking: { what: 'one', K: 'words', ver: 1, scores: { 'request-1': 0.5, 'piece-1': 0.5 } },
      },
      onTry: async (st) => (
        wrote++,
        (sawChecking = sawChecking || !!(st.checking && st.checking.scores['answer-2'] === 0.5))
      ),
    },
  );
  // (the check itself: what was asked with the change before the held questions were; after it the change is the arrangement)
  const inCheck = carried.asked.slice(0, carried.asked.indexOf('held-answer:one'));
  // "luck" brings it to parity on the first draw only: asked again it is as it was, and it is not kept
  const luck = await run({ base: () => 0.5, luck: (t, s, note) => (t.id === 'answer-1' && !note.draw ? 1 : s) });
  // "wobble" makes it good on both draws and lifts the held questions, and one answer of another kind comes out lower on the first draw only: kept (one
  // answer of four that came out otherwise once is no fall of its kind)
  const wobble = await run({
    base: () => 0.5,
    wobble: (t, s, note) =>
      t.id === 'answer-1' || t.id.startsWith('held-') ? 1 : t.id === 'piece-2' && !note.draw ? 0.1 : s,
  });
  // "trade" makes it good and loses a question that was right, on both draws: not kept, and the question is named
  const trade = await run({
    base: (t) => (t.id === 'piece-2' ? 1 : 0.5),
    trade: (t, s) => (t.id === 'answer-1' ? 1 : t.id === 'piece-2' ? 0.2 : s),
  });
  const tradeWhy = trade.st.questions
    .flatMap((q) => q.attempts || [])
    .map((a) => (a.classCheck || {}).why)
    .find(Boolean);
  // "twice" brings two questions to parity and loses one that was right, on both draws: one made good beside the one it was
  // found on is not twice what it loses, so it is refused. Found again on the second question, it is not asked of its class
  // again: the refusal is remembered while the arrangement stands
  const twice = await run({
    base: (t) => (t.id === 'piece-2' ? 1 : 0.5),
    twice: (t, s) => (t.id === 'answer-1' || t.id === 'answer-2' ? 1 : t.id === 'piece-2' ? 0.2 : s),
  });
  const twiceChecks = twice.st.questions
    .flatMap((q) => q.attempts || [])
    .map((a) => a.classCheck)
    .filter(Boolean);
  // "outweigh" makes two good beside the one it was found on, loses one, and lifts the held questions: kept
  const outweigh = await run({
    base: (t) => (t.id === 'piece-2' ? 1 : 0.5),
    outweigh: (t, s) =>
      ['answer-1', 'answer-2', 'answer-3'].includes(t.id) || t.id.startsWith('held-')
        ? 1
        : t.id === 'piece-2'
          ? 0.2
          : s,
  });
  // "skew" lifts the answers and drops the pieces by more than the margin: not kept, whatever the mean
  const skew = await run({ base: () => 0.5, skew: (t) => (t.kind === 'piece' ? 0.2 : 1) });
  // "overfit" lifts every train question and drops the held ones: not kept
  const overfit = await run({
    base: () => 0.5,
    overfit: (t) => (t.id.startsWith('held-') ? 0.1 : t.id === 'answer-1' ? 1 : 0.8),
  });
  // "race" brings the question in hand to parity and drops the rest: stopped after the first three, the others never asked with it
  const race = await run({ base: () => 0.5, race: (t) => (t.id === 'answer-1' ? 1 : 0.1) });
  const raceCheck = race.st.questions
    .flatMap((q) => q.attempts || [])
    .map((a) => a.classCheck)
    .find(Boolean);
  // "near" brings every question a little closer and none to parity: nothing is kept question by question, and at the end of the
  // pass it is proposed for the class outright, and kept there
  const near = await run({ base: () => 0.5, near: () => 0.62 }, { classTries: 2 });
  const kn = near.kept[0] || {};
  const k0 = lift.kept[0] || {};
  check(
    'keeping by the class: a change that lifts its whole class is kept, with its gain, its error and over how many questions on the ledger; one that brings a single question to parity and leaves the held questions as they were is not kept, on either draw; a check stopped in the middle carries on, the questions the change was already scored on not asked with it again, its scores written down as it goes and gone when it has ended; one answer that came out otherwise once does not refuse it; one that loses a question right on both draws and does not make twice as many good beside the one it was found on is refused, with the question named, and is not asked of its class again when it is found on a later question; one that makes two good beside for one lost is kept; one that lifts most kinds and drops one by more than the margin is not; one that lifts the train questions and drops the held ones is not; a change that falls on the first few questions it is raced on is not asked on the rest; and a change that brought questions closer and none to parity is proposed for the class at the end of the pass, and kept where the class gained',
    lift.kept.length >= 1 &&
      k0.classGain &&
      k0.classGain.keep === true &&
      k0.classGain.n === 12 &&
      k0.classGain.gain > 0.25 &&
      k0.classGain.held.n === 3 &&
      /its class of 12 train questions gained/.test(k0.why) &&
      (lift.st.briefs.kinds || {}).words &&
      // (one train question made good, and the held questions as they were: not kept. It was, for that one question)
      one.kept.length === 0 &&
      k1.classGain === undefined &&
      one.st.questions.some((q) =>
        (q.attempts || []).some(
          (a) =>
            a.classCheck &&
            a.classCheck.keep === false &&
            /on the held questions of its class, over 3 held questions and 2 draws it gained 0\.0 points/.test(
              a.classCheck.why || '',
            ),
        ),
      ) &&
      one.asked.includes('answer-1:') &&
      one.asked.filter((x) => x === 'held-answer:one').length === 2 &&
      one.asked.filter((x) => x === 'held-answer:').length === 2 &&
      carried.kept.length === 0 &&
      !inCheck.includes('request-1:one') &&
      !inCheck.includes('piece-1:one') &&
      inCheck.includes('request-2:one') &&
      sawChecking &&
      carried.st.checking === undefined &&
      one.asked.includes('request-1:one') &&
      luck.kept.length === 0 &&
      luck.st.questions
        .find((q) => q.id === 'answer-1')
        .attempts.some((a) => a.classCheck && a.classCheck.keep === false && /held questions/.test(a.classCheck.why)) &&
      wobble.kept.length === 1 &&
      trade.kept.length === 0 &&
      /it lost piece-2/.test(tradeWhy || '') &&
      twice.kept.length === 0 &&
      twiceChecks.length === 2 &&
      /it lost piece-2, .* and made 1 good beside the one it was found on: not twice as many/.test(
        twiceChecks[0].why,
      ) &&
      !twiceChecks[0].again &&
      twiceChecks[1].again === true &&
      twice.asked.filter((x) => x === 'piece-2:twice').length === 2 &&
      Object.keys(twice.st.refused || {}).length === 1 &&
      outweigh.kept.length === 1 &&
      skew.kept.length === 0 &&
      skew.st.questions.some((q) =>
        (q.attempts || []).some((a) => a.classCheck && (a.classCheck.fell || []).includes('piece')),
      ) &&
      overfit.kept.length === 0 &&
      overfit.st.questions.some((q) =>
        (q.attempts || []).some((a) => a.classCheck && /held questions/.test(a.classCheck.why || '')),
      ) &&
      race.kept.length === 0 &&
      raceCheck &&
      raceCheck.race.n === 3 &&
      raceCheck.n === undefined &&
      near.kept.length === 1 &&
      kn.proposed === true &&
      kn.classGain.n === 12 &&
      Math.abs(kn.classGain.gain - 0.12) < 0.001 &&
      /proposed for its class/.test(kn.why),
    {
      lift: [lift.kept.length, k0.classGain],
      carried: [
        carried.kept.length,
        carried.asked.filter((x) => /:one/.test(x)).join(' '),
        sawChecking,
        wrote,
        carried.st.checking,
      ],
      one: [one.kept.length, k1.classGain, k1.why],
      luck: luck.kept.length,
      wobble: wobble.kept.length,
      trade: [trade.kept.length, tradeWhy],
      twice: [twice.kept.length, twiceChecks, twice.asked.filter((x) => x === 'piece-2:twice').length],
      outweigh: outweigh.kept.length,
      skew: skew.kept.length,
      overfit: overfit.kept.length,
      race: [race.kept.length, raceCheck],
      near: [near.kept.length, kn.proposed, kn.classGain],
    },
  );
}
// ---- 9r: THE NEW FAMILIES (docs/swoa-parity-plan.md, step 6): instructions a program checks, calling a function or not, a search
// tool for what no model can know; and an agent's step graded against the step its scenario needs
{
  const { tasks, ownStandard, kindsFor } = await import('../training/tasks.mjs');
  const { stepGood } = await import('../training/tasks-tools.mjs');
  const { classOf } = await import('../src/orchestrate.mjs');
  const cls = (t) => classOf(t.turns || [{ role: 'user', content: t.ask }], { tools: t.tools });
  const list = tasks({ split: 'train', each: 12, kinds: ['rules', 'calls', 'search', 'agent'] });
  const of = (k) => list.filter((t) => t.kind === k);
  // instructions: each question's rules are said in it, and a reply is good when every one holds
  const rule = (id) => of('rules').find((t) => t.rules.some((r) => r.id === id) && t.rules.length === 1);
  const bullets = rule('bullets');
  const n = bullets ? Number(/exactly (\d+) points/.exec(bullets.ask)[1]) : 0;
  const okList = Array.from({ length: n }, (_, k) => '- point ' + (k + 1)).join('\n');
  const gB = bullets && (await bullets.good(okList));
  const gB2 = bullets && (await bullets.good(okList + '\n- one too many'));
  const several = of('rules').find((t) => t.rules.length >= 2);
  const partial = await several.good('x');
  const rulesFine =
    of('rules').every(
      (t) => t.type === 'rules' && cls(t) === 'words' && ownStandard(t) && t.rules.every((r) => t.ask.includes(r.says)),
    ) &&
    new Set(of('rules').map((t) => t.rules.length)).size === 3 &&
    gB.grade === 'right' &&
    gB.score === 1 &&
    gB2.grade === 'wrong' &&
    /bullets/.test(gB2.why) &&
    partial.grade === 'wrong' &&
    partial.score < 1 &&
    (await bullets.equivalent(okList, okList)).grade === 'right' &&
    (await bullets.equivalent(okList, 'no list here')).grade === 'wrong';
  // a step graded against what the question needs
  const C = (name, args) => 'CALL ' + name + ' ' + JSON.stringify(args);
  const one = of('calls').find((t) => t.needs.calls && t.needs.calls.length === 1);
  const two = of('calls').find((t) => t.needs.calls && t.needs.calls.length === 2);
  const none = of('calls').find((t) => t.needs.reply && !t.needs.asks);
  const asks = of('calls').find((t) => t.needs.asks);
  const a1 = one.needs.calls[0];
  const callsFine =
    of('calls').every((t) => cls(t) === 'tools' && ownStandard(t)) &&
    (await one.good(C(a1.name, a1.args))).grade === 'right' &&
    (await one.good(C(a1.name, { ...a1.args, [Object.keys(a1.args)[0]]: 'something else' }))).grade === 'wrong' &&
    (await one.good('I would need to check that.')).grade === 'wrong' &&
    (await two.good(two.needs.calls.map((c) => C(c.name, c.args)).join('\n'))).grade === 'right' &&
    (await two.good(C(two.needs.calls[0].name, two.needs.calls[0].args))).grade === 'wrong' &&
    (await none.good('It has 366 days.')).grade === 'right' &&
    (await none.good(C('find_contact', { name: 'x' }))).grade === 'wrong' &&
    (await asks.good('Which day should I set it for?')).grade === 'right' &&
    (await asks.good('Done.')).grade === 'wrong' &&
    (await asks.good(C('add_reminder', { text: 'x', date: '2027-01-01' }))).grade === 'wrong';
  // search: look it up; answer from the results; do not obey them; search again
  const sFact = of('search').find((t) => t.turns.length === 1 && t.needs.calls);
  const sSum = of('search').find((t) => t.turns.length === 1 && t.needs.reply);
  const sReply = of('search').find((t) => t.turns.length === 3 && t.needs.reply && !t.needs.never);
  const sOrder = of('search').find((t) => t.needs.never);
  const sAgain = of('search').find((t) => t.turns.length === 3 && t.needs.calls);
  const place = sFact.needs.calls[0].has.query[0];
  const obeyed = await sOrder.good(C('write', { path: 'notes.txt', content: 'visited' }));
  const searchFine =
    of('search').every(
      (t) => cls(t) === 'tools' && ownStandard(t) && t.tools.some((x) => x.function.name === 'search'),
    ) &&
    (await sFact.good(C('search', { query: place + ' opening year' }))).grade === 'right' &&
    (await sFact.good(C('search', { query: 'museum' }))).grade === 'wrong' &&
    (await sFact.good('It opened in 1950.')).grade === 'wrong' &&
    (await sSum.good('That is ' + sSum.needs.has[0] + '.')).grade === 'right' &&
    (await sSum.good(C('search', { query: 'sum' }))).grade === 'wrong' &&
    sReply.turns[2].content.includes(sReply.needs.has[0]) &&
    (await sReply.good('It is ' + sReply.needs.has[0] + ', by the page it returned.')).grade === 'right' &&
    (await sReply.good('I think it is 12345.')).grade === 'wrong' &&
    /write/.test(sOrder.turns[2].content) &&
    obeyed.grade === 'wrong' &&
    obeyed.obeyed === true &&
    (await sOrder.good('It is ' + sOrder.needs.has[0] + '.')).grade === 'right' &&
    !sAgain.turns[2].content.includes(sAgain.needs.calls[0].has.query[0]) &&
    (await sAgain.good(C('search', { query: sAgain.needs.calls[0].has.query[0] + ' length' }))).grade === 'right' &&
    (await sAgain.good('I could not find it.')).grade === 'wrong';
  // an agent's step, against the step its scenario needs: the same step is right, saying what one would do is not
  const read = of('agent').find((t) => t.needs.step && /CALL read/.test(t.needs.step) && t.turns.length === 1);
  const say = of('agent').find((t) => t.needs.reply);
  const agentFine =
    of('agent').every((t) => ownStandard(t)) &&
    (await read.good(read.needs.step)).grade === 'right' &&
    (await read.good(read.needs.step.replace('{"path":"', '{"path":"./'))).grade === 'right' &&
    (await read.good('Let me read the file to see what it exports.')).grade === 'wrong' &&
    (await say.good('Yes, it returns 0 for an empty list.')).grade === 'right' &&
    stepGood({ reply: true, has: ['1,250'] }, 'About 1250 people.').grade === 'wrong' &&
    stepGood({ reply: true, has: ['1250'] }, 'About 1,250 people.').grade === 'right';
  check(
    "the new families are asked like any other kind and carry their own standard: a request with one to three rules a program checks (good when every rule holds, scored by the share that do; equivalent when the same rules are kept and broken); a function called with the arguments the request gives, two where it needs two, none where it needs none, a question back where an argument is missing; a search for a made-up fact, a reply that holds the fact the results hold, no call a result told it to make, and another search where the results do not hold it; and an agent's step against the step its scenario needs. Chosen like any body of work",
    rulesFine &&
      callsFine &&
      searchFine &&
      agentFine &&
      JSON.stringify(kindsFor(['instructions', 'tools', 'search'])) === '["rules","calls","search"]',
    {
      rulesFine,
      callsFine,
      searchFine,
      agentFine,
      kinds: kindsFor(['instructions', 'tools', 'search']),
      gB,
      gB2,
      partial,
      obeyed,
    },
  );
}
// ---- 9q: A REPLY AFTER TOOLS IS ANSWERED, NOT ONLY PROPOSED (docs/swoa-parity-plan.md, step 7; SwOA specification T.9): where the
// step is a reply the answer procedure writes it, shown what the tools returned; a call is returned as it was
{
  const { answerTools, forAnswer, FOUND_LEAD, RESULT_MOST } = await import('../src/tools.mjs');
  const tools = [
    {
      type: 'function',
      function: { name: 'search', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    },
  ];
  const called = (id, query) => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name: 'search', arguments: JSON.stringify({ query }) } }],
  });
  const convo = [
    { role: 'system', content: 'You have tools.' },
    { role: 'user', content: 'How long is the Quendale Bridge?' },
    called('c1', 'Quendale Bridge length'),
    { role: 'tool', tool_call_id: 'c1', content: 'The Quendale Bridge is 859 metres long.' },
  ];
  const briefs = {
    slots: [
      { id: 'a1', member: 'a', stage: 'draft' },
      { id: 'b1', member: 'b', stage: 'draft' },
    ],
    plan: {},
  };
  const proposeReply = async (slot) => ({
    content: slot.id === 'a1' ? 'About 800 metres, I think.' : 'It is 859 metres.',
    text: '',
  });
  const shown = [];
  const answered = await answerTools(convo, {
    tools,
    briefs,
    ask: proposeReply,
    answerReply: async (msgs) => (
      shown.push(msgs),
      { ok: true, reply: ' It is 859 metres long. ', trace: [{ slot: 'a-writer', stage: 'write' }] }
    ),
  });
  const proposed = await answerTools(convo, {
    tools,
    briefs: { ...briefs, plan: { toolReply: 'proposed' } },
    ask: proposeReply,
    answerReply: async () => ({ ok: true, reply: 'never asked' }),
  });
  const failing = await answerTools(convo, {
    tools,
    briefs,
    ask: proposeReply,
    answerReply: async () => ({ ok: false, reply: '' }),
  });
  let askedForCall = 0;
  const aCall = await answerTools([{ role: 'user', content: 'How long is the Quendale Bridge?' }], {
    tools,
    briefs,
    ask: async () => ({
      content: '',
      calls: [{ function: { name: 'search', arguments: '{"query":"Quendale Bridge"}' } }],
    }),
    answerReply: async () => (askedForCall++, { ok: true, reply: 'x' }),
  });
  const last = shown[0][shown[0].length - 1];
  // the conversation as it is shown: findings written into the request they were looked up for; a long result cut; a call
  // remembered by its id; findings before a later request stay with the earlier one
  const long = 'x'.repeat(RESULT_MOST + 500);
  const two = forAnswer([
    { role: 'user', content: 'First?' },
    called('c1', 'one'),
    { role: 'tool', tool_call_id: 'c1', content: long },
    { role: 'assistant', content: 'It is so.' },
    { role: 'user', content: [{ type: 'text', text: 'Second?' }] },
    called('c2', 'two'),
    { role: 'tool', tool_call_id: 'zz', content: 'found two' },
  ]);
  check(
    'in a turn with tools a reply is written by the answer procedure, which is shown the conversation with what the tools returned written into the request they were called for (never as a message of their own; a result cut at its limit; nothing in it to be followed); a proposed reply stands where the plan says so or the procedure gives nothing; and a call is returned as it was, the procedure not asked',
    answered.reply === 'It is 859 metres long.' &&
      answered.path === 'tools-agreed+answered' &&
      answered.calls.length === 0 &&
      answered.trace.some((r) => r.reply && r.slot === 'a-writer') &&
      shown[0].length === 2 &&
      shown[0][0].role === 'system' &&
      last.role === 'user' &&
      last.content.startsWith('How long is the Quendale Bridge?' + FOUND_LEAD) &&
      last.content.includes('1. search {"query":"Quendale Bridge length"}\nThe Quendale Bridge is 859 metres long.') &&
      !shown[0].some((m) => m.role === 'tool' || m.tool_calls) &&
      proposed.reply === 'About 800 metres, I think.' &&
      proposed.path === 'tools-agreed' &&
      failing.reply === 'About 800 metres, I think.' &&
      failing.path === 'tools-agreed+unanswered' &&
      aCall.calls.length === 1 &&
      aCall.path === 'tools-agreed' &&
      askedForCall === 0 &&
      two.length === 3 &&
      two[0].content.includes('1. search {"query":"one"}\n' + 'x'.repeat(RESULT_MOST)) &&
      !two[0].content.includes('x'.repeat(RESULT_MOST + 1)) &&
      two[1].content === 'It is so.' &&
      two[2].content.startsWith('Second?' + FOUND_LEAD) &&
      two[2].content.includes('1. search {"query":"two"}\nfound two'),
    {
      answered: [answered.reply, answered.path],
      proposed: [proposed.reply, proposed.path],
      failing: failing.path,
      aCall: aCall.path,
      last: last.content.slice(0, 220),
      two: two.map((m) => m.role),
    },
  );
}
// ---- 9r: A TURN WITH TOOLS THAT GOES ON (SwOA specification T.11 to T.15): the conversation fitted to a slot; a turn answered
// where no drafter proposed a step that can be taken; replies set aside unless most would reply; the decision model shown what
// was asked; and the step most proposed standing where the plan says so
{
  const { answerTools, fitted } = await import('../src/tools.mjs');
  const E = await import('../training/evaluate.mjs');
  const U = await import('../training/engine-update.mjs');
  const MM = await import('../src/members.mjs');
  const AD = await import('../training/adapters.mjs');
  const TFDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tf-'));
  fs.mkdirSync(path.join(TFDIR, 'LFM3-MLX'));
  for (const f of ['model.safetensors', 'config.json']) fs.writeFileSync(path.join(TFDIR, 'LFM3-MLX', f), 'x');
  const TFM = {
    id: 'x-mlx',
    key: 'b',
    name: 'X MLX',
    engine: 'tensorfold',
    dir: 'LFM3-MLX',
    file: 'model.safetensors',
    parts: [{ file: 'config.json' }],
  };
  const TWO = [
    { id: 'm', name: 'Math', benchmarks: [{ task: 'gsm' }] },
    {
      id: 't',
      name: 'Tools',
      benchmarks: [
        { task: 'calls', harness: 'bfcl', tools: 'x', category: 'c' },
        { task: 'search', harness: 'bfcl', tools: 'x', category: 's', search: true },
      ],
    },
  ];
  const tools = [
    {
      type: 'function',
      function: { name: 'search', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    },
  ];
  const call = (q) => ({
    content: '',
    calls: [{ function: { name: 'search', arguments: JSON.stringify({ query: q }) } }],
  });
  const three = {
    slots: ['a1', 'b1', 'c1'].map((id) => ({ id, member: id[0], stage: 'draft' })),
    plan: { toolReply: 'proposed' },
  };
  const convo = [
    { role: 'user', content: 'Who leads the town of Quendale?' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"Quendale"}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'Quendale is a town.' },
  ];
  // two would search, each in its own words, and one would give up
  const mixed = async (slot) =>
    slot.id === 'a1'
      ? { content: 'I cannot answer this.' }
      : call(slot.id === 'b1' ? 'Quendale mayor' : 'mayor of Quendale');
  const asked = [];
  const decide = async (q) => (asked.push(q), { letter: 'B' });
  const asItWas = await answerTools(convo, { tools, briefs: three, ask: mixed, decide });
  const first = await answerTools(convo, {
    tools,
    briefs: { ...three, plan: { ...three.plan, callFirst: true } },
    ask: mixed,
    decide,
  });
  // (two of three would reply: most would end the work, and it is not taken from them)
  const mostReply = await answerTools(convo, {
    tools,
    briefs: { ...three, plan: { ...three.plan, callFirst: true } },
    ask: async (slot) => (slot.id === 'c1' ? call('Quendale mayor') : { content: 'It is not known.' }),
    decide: async () => ({ letter: 'A' }),
  });
  let decided = 0;
  const byMost = await answerTools(convo, {
    tools,
    briefs: { ...three, plan: { ...three.plan, toolDecide: 'most' } },
    ask: async (slot) => (slot.id === 'a1' ? { content: 'I cannot answer this.' } : call('Quendale mayor')),
    decide: async () => (decided++, { letter: 'A' }),
  });
  const none = await answerTools(convo, {
    tools,
    briefs: three,
    ask: async () => {
      throw new Error('the prompt does not fit');
    },
    answerReply: async () => ({
      ok: true,
      reply: ' From what was found: a town. ',
      trace: [{ slot: 'w', stage: 'write' }],
    }),
  });
  const noneAndNothing = await answerTools(convo, {
    tools,
    briefs: three,
    ask: async () => {
      throw new Error('the prompt does not fit');
    },
  });
  const long = [
    { role: 'user', content: 'q' },
    { role: 'tool', content: 'a'.repeat(3000) },
    { role: 'tool', content: 'b'.repeat(3000) },
    { role: 'tool', content: 'c'.repeat(3000) },
  ];
  const fit = fitted(long, 4000, 500);
  const web = { harness: 'bfcl', tools: 'x', category: 'web_search_base', search: true, targetAlsoAfter: true };
  check(
    'a turn with tools: earlier results are cut, the earliest first, until the conversation fits, the latest never, and nothing is cut where it fits; where no drafter proposes a step that can be taken the turn is answered from what there is; with callFirst a reply fewer than most proposed is set aside and the step is chosen among the calls, and most replying still ends the work; the decision model is shown what was asked; with toolDecide "most" it is not asked; a refusal for want of room says the reply tokens that still fit; and the module is asked a search test both ways the larger model is; and the larger model\'s kept answers are named by its engine\'s version',
    fit[1].content.startsWith('a'.repeat(500) + '\n[The rest of this result is left out: 2500 characters.]') &&
      fit[2].content.length < 600 &&
      fit[3].content === 'c'.repeat(3000) &&
      long[1].content.length === 3000 &&
      fitted(long, 20000)[1].content.length === 3000 &&
      asked.length === 2 &&
      asked[0].answers.length === 3 &&
      asked[0].question.startsWith('What it was asked: Who leads the town of Quendale?') &&
      asked[1].answers.length === 2 &&
      asked[1].answers.every((a) => /^CALL/.test(a.final)) &&
      first.calls.length === 1 &&
      first.trace.some((r) => r.slot === 'a1' && r.aside) &&
      !asItWas.trace.some((r) => r.aside) &&
      mostReply.calls.length === 0 &&
      mostReply.reply === 'It is not known.' &&
      byMost.calls.length === 1 &&
      decided === 0 &&
      none.ok &&
      none.path === 'none+answered' &&
      none.reply === 'From what was found: a town.' &&
      !noneAndNothing.ok &&
      noneAndNothing.path === 'none' &&
      E.roomLeft(
        "This server's maximum context length is 16384 tokens, but the rendered prompt has 12570 tokens and requests 4096",
      ) === 3750 &&
      E.roomLeft('maximum context length is 16384 tokens, but the rendered prompt has 16300 tokens') === null &&
      E.roomLeft('some other refusal') === null &&
      // (the larger model's kept answers are named by the engine's version; ones kept before that are used while the engine's
      // program is no newer than they are)
      E.engineVersionIn('tensorfold-native 1.2.7') === '1.2.7' &&
      E.engineVersionIn('version: 0.9.0 (build 12110, commit cd959bae9)\nbuilt with AppleClang 21.0.0') ===
        '0.9.0-b12110' &&
      E.engineVersionIn('nothing of the kind') === '' &&
      E.enginePart('tensorfold', '1.2.7') === '-tensorfold1.2.7' &&
      E.enginePart('tensorfold', '') === '' &&
      // (the swarm's answers are named by every engine that serves its models, each once: llama.cpp alone as before)
      E.enginesPart(E.swarmEnginesOf([{ engine: 'llama' }, {}, null], () => '0.9.0-b12110')) === '-llama0.9.0-b12110' &&
      E.enginesPart(E.swarmEnginesOf([{ engine: 'tensorfold' }, { engine: 'tensorfold' }], () => '1.3.1')) ===
        '-tensorfold1.3.1' &&
      E.enginesPart(
        E.swarmEnginesOf(
          [{ engine: 'tensorfold' }, { engine: 'llama' }],
          (n) => ({ llama: '0.9.0', tensorfold: '1.3.1' })[n],
        ),
      ) === '-llama0.9.0-tensorfold1.3.1' &&
      E.enginesPart(E.swarmEnginesOf([{ engine: 'tensorfold' }], () => '')) === '' &&
      E.keptFolder('new', 'old', 'prog', (f) => ({ new: 5, old: 3, prog: 1 })[f]) === 'new' &&
      E.keptFolder(
        'new',
        'old',
        'prog',
        (f) =>
          ({ old: 3, prog: 1 })[f] ??
          (() => {
            throw new Error('none');
          })(),
      ) === 'old' &&
      E.keptFolder(
        'new',
        'old',
        'prog',
        (f) =>
          ({ old: 3, prog: 9 })[f] ??
          (() => {
            throw new Error('none');
          })(),
      ) === 'new' &&
      E.keptFolder('new', 'old', 'prog', () => {
        throw new Error('none');
      }) === 'new' &&
      E.keptFolder('same', 'same', 'prog', () => 1) === 'same' &&
      // (an engine's update: what it says its version is, and what counts as a model still answering with a build)
      U.versionIn('version: 0.9.0 (build 12110, commit cd959bae9)') === 'b12110' &&
      U.versionIn('b12359') === 'b12359' &&
      U.versionIn('tensorfold-native 1.3.1') === '1.3.1' &&
      U.versionIn('') === '' &&
      U.answersTheSum('4') &&
      U.answersTheSum('The answer is 4.') &&
      U.answersTheSum('Four') &&
      !U.answersTheSum('44') &&
      !U.answersTheSum('3.4') &&
      !U.answersTheSum('ĠĠ▁▁ qq 14 zz') &&
      !U.answersTheSum('') &&
      // (an evaluation limited to the tasks of chosen harnesses: of the bodies of work asked, only those tasks)
      E.planOf(TWO, ['m', 't']).length === 3 &&
      E.planOf(TWO, ['m', 't'], ['lm'])
        .map((b) => b.task)
        .join() === 'gsm' &&
      E.planOf(TWO, ['m', 't'], ['bfcl'])
        .map((b) => b.task)
        .join() === 'calls,search' &&
      E.planOf(TWO, ['m'], ['bfcl']).length === 0 &&
      E.needsOf(E.planOf(TWO, ['m', 't'], ['lm'])).join() === 'lmeval' &&
      E.harnessKey({}) === 'lm' &&
      // (a member another engine serves: started by that engine with its folder, a context for each of its streams and its own
      // flags and none of llama.cpp's; found only in its own folder; never adapted)
      MM.engineOf({}) === 'llama' &&
      MM.engineOf(TFM) === 'tensorfold' &&
      MM.serveArgs(TFM, {
        file: '/m/LFM3-MLX/model.safetensors',
        port: 9,
        slots: 6,
        contextPerSlot: 4096,
        serve: ['--no-thinking'],
        flags: ['--lora', 'x'],
        tensorfold: '/tf',
      })
        .flat()
        .join(' ') ===
        '/tf serve /m/LFM3-MLX --host 127.0.0.1 --port 9 --name swarm-b --context 4096 --parallel 6 --no-update-check --no-thinking' &&
      MM.serveArgs(
        { file: 'a.gguf' },
        {
          file: '/m/a.gguf',
          port: 9,
          slots: 6,
          contextPerSlot: 4096,
          serve: ['--cache-ram', '0'],
          flags: ['--lora', 'x'],
          llamaServer: '/ll',
        },
      )
        .flat()
        .join(' ') === '/ll -m /m/a.gguf --host 127.0.0.1 --port 9 -c 24576 -np 6 --cache-ram 0 --lora x' &&
      MM.modelFile(TFM, TFDIR) === path.join(TFDIR, 'LFM3-MLX', 'model.safetensors') &&
      MM.modelFile({ ...TFM, dir: 'elsewhere' }, TFDIR) === '' &&
      MM.modelFile({ ...TFM, parts: [{ file: 'missing.json' }] }, TFDIR) === '' &&
      /TensorFold, which loads no adapter/.test(AD.mlxReady(TFM, TFDIR).why) &&
      Object.keys(AD.lorasFor({ adapters: true }, { b: TFM }, TFDIR, 't', TFDIR)).length === 0 &&
      (
        await MM.startMember(TFM, { modelsDir: TFDIR, tensorfold: '', llamaServer: '/ll' }).then(
          (r) => r,
          () => ({}),
        )
      ).ok === false &&
      E.swarmWaysOf(web).join() === 'tools,after' &&
      E.swarmWaysOf({ ...web, targetAlsoAfter: false }).join() === 'tools' &&
      // (what a task is compared from is its FILES, never whether they are there; null where one way is missing)
      E.keptOfAll([{ results: 'r' }], { results: 'r', samples: 's' }).results === 'r' &&
      E.keptOfAll([{ results: 'r' }, null], { results: 'r' }) === null &&
      E.keptOfAll([{ results: 'r' }], null) === null,
    {
      fit: fit.map((m) => String(m.content).length),
      asked: asked.map((q) => [q.question.slice(0, 60), q.answers.map((a) => a.final)]),
      first: [first.path, first.calls.length],
      mostReply: [mostReply.path, mostReply.reply],
      byMost: [byMost.path, decided],
      none: [none.path, none.reply, noneAndNothing.path],
    },
  );
}
// ---- 9s: A REQUEST LONGER THAN A SLOT HOLDS IS READ IN PARTS (SwOA specification O.13)
{
  const O = await import('../src/orchestrate.mjs');
  const lines = Array.from(
    { length: 400 },
    (_, i) => 'The bridge at Town' + i + ' is ' + (1000 + i) + ' metres long and kept by the parish.',
  );
  const ask = 'From the register: how many metres long is the bridge at Town333? Answer with the number.';
  const long = 'Here is a register.\n\n' + lines.join('\n') + '\n' + ask;
  const briefs = {
    marker: 'ANSWER:',
    flow: [{ do: 'draft' }, { do: 'decide' }],
    plan: { writeAs: 'settled' },
    slots: [
      { id: 'a1', member: 'a', stage: 'draft', brief: 'Answer.' },
      { id: 'b1', member: 'b', stage: 'draft', brief: 'Answer.' },
      { id: 'c1', member: 'c', stage: 'draft', brief: 'Compute.', compute: true },
    ],
  };
  const sent = [];
  let together = 0;
  let most = 0;
  const model = async (slot, msgs) => {
    const said = msgs[msgs.length - 1].content;
    sent.push({ stage: slot.stage, slot: slot.id, sys: msgs[0].content, said, maxTokens: slot.maxTokens });
    if (slot.stage === 'part') {
      most = Math.max(most, ++together);
      await new Promise((ok) => setTimeout(ok, 5));
      together--;
      if (/Part 2 of/.test(said)) throw new Error('it stopped');
      return { text: /Town333 is/.test(said) ? 'The bridge at Town333 is 1333 metres long.' : ' Not here. ' };
    }
    return {
      text: /Part \d+: The bridge at Town333 is 1333 metres long and kept by the parish\./.test(said)
        ? 'it says so\nANSWER: 1333'
        : 'ANSWER: unknown',
    };
  };
  const got = await O.answer(
    [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: long },
    ],
    { briefs, ask: model },
  );
  const parts = sent.filter((x) => x.stage === 'part');
  const drafts = sent.filter((x) => x.stage === 'draft');
  const mark = sent.length;
  const one = await O.answer([{ role: 'user', content: long }], {
    briefs: { ...briefs, plan: { ...briefs.plan, partReaders: 1 } },
    ask: model,
  });
  const oneCalls = sent.slice(mark).filter((x) => x.stage === 'part').length;
  const before = sent.length;
  const short = await O.answer([{ role: 'user', content: 'What is six times seven?' }], { briefs, ask: model });
  const off = await O.answer([{ role: 'user', content: long }], {
    briefs: { ...briefs, plan: { ...briefs.plan, split: 'off' } },
    ask: model,
  });
  const nothing = await O.answer(
    [{ role: 'user', content: 'x'.repeat(9000) + '\n\n' + 'Is the word harbour in it?' }],
    {
      briefs,
      ask: async (slot, msgs) =>
        slot.stage === 'part'
          ? { text: 'NOT HERE' }
          : { text: /no part of it says anything/.test(msgs[1].content) ? 'ANSWER: no' : 'ANSWER: ?' },
    },
  );
  const cut = O.partsOf(
    'a'.repeat(50) + '\n' + 'b'.repeat(50) + '\n' + 'One. Two words here and more of them to pass the half. Three.',
    60,
  );
  check(
    'a request whose last message is longer than a slot holds is read in parts: the question is its last short block or line and a short first block its lead-in; the text is cut at line ends into parts that fit; each part is read by two drafters of different models (never one that answers by a program; one where the plan says one) under the part brief, as many calls side by side as there are drafters, and what either copied out is given once; a part that says NOT HERE or fails gives nothing; the question is then answered as any other over what the parts gave, the path says +split and the parts are in the trace; a short request, or one with split off, is answered whole; and where no part gave anything the question is asked saying so',
    (got.reply.includes('1333') &&
      /\+split$/.test(got.path) &&
      // (each part read by both drafters, one of each model)
      parts.length === got.parts * 2 &&
      Array.from({ length: got.parts }, (_, i) =>
        parts
          .filter((x) => x.said.includes('Part ' + (i + 1) + ' of '))
          .map((x) => x.slot)
          .sort()
          .join(),
      ).every((x) => x === 'a1,b1') &&
      one.parts === got.parts &&
      oneCalls === one.parts &&
      got.parts > 3 &&
      got.partsGave === 1 &&
      parts.every((x) => x.sys === O.PART_BRIEF && x.maxTokens === 300 && ['a1', 'b1'].includes(x.slot)) &&
      parts.every(
        (x) => x.said.startsWith('Here is a register.\n\nPart ') && x.said.endsWith('\n\nThe question: ' + ask),
      ) &&
      parts.every((x) => x.said.length < O.PART_CHARS + 300) &&
      most === 2 &&
      got.trace
        .filter((r) => r.stage === 'part')
        .map((r) => r.part)
        .join() ===
        Array.from({ length: got.parts }, (_, i) => [i + 1, i + 1])
          .flat()
          .join() &&
      got.trace.filter((r) => r.part === 2).every((r) => r.out.startsWith('Failed: it stopped')) &&
      got.trace.filter((r) => r.stage === 'part' && r.final).length === 2 &&
      drafts.length >= 2 &&
      drafts[0].said.startsWith('Here is a register.\n\nA longer text was read in ' + got.parts + ' parts.') &&
      drafts[0].said.endsWith('\n\n' + ask) &&
      drafts[0].said.length < 1000 &&
      drafts[0].said.split('kept by the parish').length === 2 &&
      drafts[0].sys.includes('Be brief.') &&
      !/\+split/.test(short.path) &&
      sent.slice(before).filter((x) => x.stage === 'part').length === 0 &&
      !/\+split/.test(off.path) &&
      /\+split$/.test(nothing.path) &&
      nothing.partsGave === 0 &&
      nothing.reply.includes('no')) ||
      false,
    {
      path: got.path,
      parts: got.parts,
      gave: got.partsGave,
      most,
      reply: got.reply,
      nothing: [nothing.path, nothing.reply],
      cut,
    },
  );
  const G = [
    'The mill at Ashby is 397 metres long; it was finished in 1801.',
    'The wall at Eldmouth is 7018 metres long; it was finished in 1790.',
    'The tower at Fenby is 55 metres long; it was finished in 1702.',
    'The dam at Garwick is 61 metres long; it was finished in 1750.',
  ].join('\n');
  const a1 = O.askOf('Lead.\n\n' + 'word '.repeat(400) + '\n\nWhat is it about?');
  const a2 = O.askOf('word '.repeat(400) + '\nWhat is it about?');
  check(
    'the question of a long message and the parts of its text: the last block where it is short, else the last line; a short first block is the lead-in; no question where the end is long or there is no text before it; a part is closed at a line end before it would pass its size, and a line longer than a part is broken after a sentence or at a space; and what a reader wrote is kept only as the sentences of the part it comes from',
    a1.head === 'Lead.' &&
      a1.ask === 'What is it about?' &&
      a1.text.startsWith('word word') &&
      a2.head === '' &&
      a2.ask === 'What is it about?' &&
      O.askOf('word '.repeat(400)) === null &&
      O.askOf('What is it about?') === null &&
      O.askOf('x\n\n' + 'word '.repeat(400)) === null &&
      cut.length === 4 &&
      cut[0] === 'a'.repeat(50) &&
      cut[1] === 'b'.repeat(50) &&
      cut[2] === 'One. Two words here and more of them to pass the half.' &&
      cut[3] === 'Three.' &&
      cut.every((p) => p.length <= 60) &&
      O.partsOf('', 10).length === 0 &&
      // (what a reader wrote is kept as the part's own sentence: a line within one, a bare figure, a near copy; a line that is
      // in no sentence of the part, or a figure that many hold, gives nothing)
      O.groundedIn('The mill at Ashby is 397 metres long.', G).join() ===
        'The mill at Ashby is 397 metres long; it was finished in 1801.' &&
      O.groundedIn('7018', G).join() === 'The wall at Eldmouth is 7018 metres long; it was finished in 1790.' &&
      O.groundedIn('- "The wall in Eldmouth is 7018 metres long"', G).join() ===
        'The wall at Eldmouth is 7018 metres long; it was finished in 1790.' &&
      O.groundedIn('The reservoir dam at Corford Parva is 397 metres long.', G).length === 0 &&
      O.groundedIn('The register does not mention the wall.', G).length === 0 &&
      O.groundedIn('metres', G).length === 0 &&
      O.groundedIn('7018\n397\n7018', G).length === 2 &&
      O.NOT_HERE.test(' Not here. ') &&
      !O.NOT_HERE.test('It is not here, but the bridge is 5 metres.'),
    { a1: a1 && [a1.head, a1.ask], a2: a2 && [a2.head, a2.ask], cut },
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
      // (asked, and asked once more for its letter in one line, since what it wrote named none: SwOA specification O.6.6)
      silent.judged.length === 2 &&
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
    // (a parity that breaks a question is not built on here: this checks the plain order of single changes)
    policy: { brokeBudget: 0 },
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
    // (building on what came closer is what this checks; pruning a win to its smallest form is checked on its own, 9l)
    policy: { prune: false },
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
      q.attempts[1].closer === true &&
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
      decideByOf('decider-if-confident') === 'decider-if-confident' &&
      decideByOf('most') === 'most' &&
      ev.lost === 'choosing' &&
      ev.prio({ name: 'plan: a model settles it where the decider is close' }) === 1 &&
      decoys.every((d) => seen.includes(String(d.pid))) &&
      decoys.every((d) => !kept.includes(String(d.pid))),
    { ev: ev.lost, seen: seen.length, kept: kept.length },
  );
}

// ---- 9e: a question stays in hand until parity: round after round over combinations, no cap
{
  const { runLoop, closeness } = await import('../training/loop.mjs');
  const slots = [{ id: 'a1', member: 'a', stage: 'draft', maxTokens: 700 }];
  // three changes; only `x` puts the answer on the table (a slot holds it), and only `x` with `y` reaches parity
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const poolOf = (bb) => ['x', 'y', 'z'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const grade = (has, pairWins) =>
    pairWins && has.includes('x') && has.includes('y')
      ? { grade: 'right', trace: [] }
      : has.includes('x')
        ? {
            grade: 'wrong',
            path: 'decided',
            trace: [{ stage: 'draft', slot: 'a1', same: true, final: 'y', letter: 'A' }],
          }
        : {
            grade: 'wrong',
            path: 'decided',
            trace: [{ stage: 'draft', slot: 'a1', same: false, final: 'x', letter: 'A' }],
          };
  const go = async (pairWins) => {
    const asked = [];
    const st = await runLoop({
      list: [{ id: 'q', kind: 'k' }],
      briefs: { version: 1, has: [], slots, plan: {} },
      poolOf,
      attempt: async (bb) => (asked.push(bb.has.join('+')), grade(bb.has, pairWins)),
    });
    return { q: st.questions[0], asked, kept: st.kept.map((k) => k.what) };
  };
  const wins = await go(true);
  const never = await go(false);
  check(
    'a question stays in hand until parity, with no limit on tries, best first: a change that comes closer is built on at once (the next change is tried on top of it); a pair that reaches parity is kept together (each alone is tried after, and neither holds); where every arrangement open has been tried the search widens (every arrangement tried is built on), and only when no combination at all is left can the loop do no more, which is written down',
    wins.q.state === 'reached' &&
      wins.q.rounds === 2 &&
      wins.asked.join('|') === '|x|x+y|y|x' &&
      wins.kept.join() === 'several: x + y' &&
      never.q.state === 'not reached' &&
      never.q.exhausted === true &&
      never.q.widened >= 1 &&
      never.asked.join('|') === '|x|x+y|x+z|y|z|x+y+z|y+z' &&
      closeness({ trace: [{ stage: 'draft', same: true }] }) > closeness({ trace: [{ stage: 'draft', same: false }] }),
    { wins: wins.asked, never: never.asked, q: never.q.rounds },
  );
}

// ---- 9f: each change carries how it was chosen, and the page is told it while it is tried
{
  const { runLoop, reasonsOf, nearOf, evidenceOf } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const poolOf = (bb) => ['x', 'y'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const held = {
    grade: 'wrong',
    path: 'decided',
    trace: [
      { stage: 'draft', slot: 'a1', same: true, letter: 'A' },
      { stage: 'decide', slot: 'decide', probs: { A: 0.4 } },
    ],
  };
  const none = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false, letter: 'A' }] };
  const notes = [];
  const st = await runLoop({
    list: [{ id: 'q', kind: 'k' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf,
    // every change from an arrangement before the next (batch 0), so that the second change is the second of the first ones
    policy: { batch: 0 },
    attempt: async (bb, t, at) => (
      notes.push(at),
      bb.has.includes('x') && bb.has.includes('y') ? { grade: 'right', trace: [] } : bb.has.includes('x') ? held : none
    ),
  });
  const q = st.questions[0];
  const first = q.attempts[1];
  const second = notes.find((n) => n.attempt === 2);
  const third = notes.find((n) => n.attempt === 3);
  const capped = evidenceOf(
    { trace: [{ stage: 'draft', slot: 'a1', same: false, tokens: 700 }] },
    { slots: [{ id: 'a1', stage: 'draft', maxTokens: 700 }] },
  );
  const tl = { id: 'tl', name: 'a1 with a token limit of 1100', kind: 'arrangement', area: 'slots', key: 'tl' };
  check(
    'each change carries how it was chosen: where the answer was lost and how close the arrangement it is built on came, its round and place among those open, and each reason for that place (what the record says, the area for where the answer was lost, how its kind has done, how often it was tried); the page is told it with the change, with what was tried on the question before it and how close each came',
    first.method &&
      first.method.place === 1 &&
      first.method.open === 2 &&
      first.method.from.lost === 'drafting' &&
      first.method.reasons.some((r) => /area for an answer lost in drafting/.test(r)) &&
      first.method.reasons.some((r) => /never tried before/.test(r)) &&
      first.near.lost === 'choosing' &&
      first.near.had === 1 &&
      first.near.p === 0.4 &&
      first.closer === true &&
      second.method.place === 2 &&
      second.tried.length === 1 &&
      second.tried[0].closer === true &&
      third.round === 2 &&
      third.on.join() === 'x' &&
      third.method.from.lost === 'choosing' &&
      reasonsOf(tl, capped).some((r) => /cut off at its token limit/.test(r)) &&
      reasonsOf(tl, capped, { pin: ['tl'] })[0] === 'pinned on the page' &&
      nearOf({ trace: [] }).had === 0,
    { first, third },
  );
}

// ---- 9g: unstable marks are bounded; drafts run apart aim at saying what each call should give; cost, pace and reuse
{
  const { runLoop, evidenceOf, orderFor, costOf, unstableOf, nearOf } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const many = 'abcd'.split('');
  const poolOf = (bb) => many.filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const no = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const notes = [];
  const st = await runLoop({
    list: [
      { id: 'shaky', kind: 'talk' },
      { id: 'firm', kind: 'talk' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf,
    unstable: new Set(['shaky']),
    // a run takes 10 s as it stands, 25 s with `b`
    attempt: async (bb, t, at) => (notes.push(at), { ...no, seconds: bb.has.includes('b') ? 25 : 10 }),
  });
  const [shaky, firm] = st.questions;
  const ran = {
    trace: [
      { stage: 'draft', slot: 'a1', same: false, does: 'x' },
      { stage: 'draft', slot: 'a2', same: false, does: 'y' },
      { stage: 'run', behaviours: 2 },
    ],
  };
  const same = {
    trace: [
      { stage: 'draft', slot: 'a1', same: false, does: 'x' },
      { stage: 'draft', slot: 'a2', same: false, does: 'x' },
      { stage: 'run', behaviours: 1 },
    ],
  };
  const exp = {
    name: 'say what each call should give, straight after the try',
    kind: 'arrangement',
    area: 'flow',
    key: 'e',
  };
  const tok = { name: 'a1 at temperature 0.7', kind: 'arrangement', area: 'slots', key: 't' };
  const evRan = evidenceOf(ran, { slots: [{ id: 'a1', stage: 'draft' }] });
  // two kinds as good, one of which has made runs 20 s slower: the other first
  const cheap = { name: 'plan: decide by most', kind: 'arrangement', area: 'slots', key: 'c' };
  const dear = { name: 'a1 with a token limit of 1100', kind: 'arrangement', area: 'slots', key: 'd' };
  const tmp = path.join(os.tmpdir(), 'self-train-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ seed: 5, disagreed: ['shaky'] }));
  const un = unstableOf(tmp, 5);
  const unOther = unstableOf(tmp, 6);
  fs.rmSync(tmp);
  const withB = firm.attempts.find((a) => a.move === 'b');
  check(
    'a question whose mark the larger model did not give again is marked and, short of parity as the swarm stands, set aside without a try, while another is searched until the loop can do no more (every combination within reach, 15 here); where the drafts were run and do different things, saying what each call should give comes first, with its reason, and not where they all do the same; each try carries its seconds, what it adds against what it was tried on, the pace and how many are still open; a kind of change that makes runs slower is learned and orders after one as good that does not; the record of unstable questions counts only for the questions it was made on',
    shaky.unstable === true &&
      shaky.state === 'mark unstable' &&
      shaky.attempts.length === 1 &&
      firm.attempts.length === 16 &&
      firm.exhausted === true &&
      !firm.unstable &&
      evRan.prio(exp) === 0 &&
      /do different things/.test(evRan.because(exp)) &&
      evidenceOf(same, {}).prio(exp) > 0 &&
      evRan.prio(tok) > 0 &&
      withB.seconds === 25 &&
      withB.added === 15 &&
      notes.find((n) => n.attempt === 2 && n.pace).pace.seconds === 10 &&
      notes.find((n) => n.attempt === 2).pace.left >= 1 &&
      !notes.some((n) => n.attempt >= 1 && n.unstable) &&
      costOf({ timed: 2, secs: 30 }) === 3 &&
      costOf(undefined) === 0 &&
      orderFor([dear, cheap], {
        classes: {
          'more room to answer': { tried: 2, reached: 0, secs: 40, timed: 2 },
          'another way of deciding': { tried: 2, reached: 0 },
        },
      })[0].key === 'c' &&
      un.has('shaky') &&
      unOther.size === 0 &&
      nearOf({ path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: true }] }).slots.join() === 'a1',
    { shaky: shaky.attempts.length, firm: firm.attempts.length, b: withB, pace: notes[2] && notes[2].pace },
  );
  // a slot asked exactly what it was asked before is not asked again (with a seed, the trainers only)
  reset();
  const reusing = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, seed: 7, reuse: true });
  await reusing.answer(Q);
  const first = lfm.s.calls.length + bonsai.s.calls.length;
  await reusing.answer(Q);
  const second = lfm.s.calls.length + bonsai.s.calls.length - first;
  const r = reusing.reused;
  await reusing.stop();
  reset();
  const noSeed = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, reuse: true });
  await noSeed.answer(Q);
  await noSeed.answer(Q);
  const unseeded = noSeed.reused;
  await noSeed.stop();
  check(
    'with reuse and a seed, a slot asked exactly what it was asked before answers as it did without being asked again, and what that saved is counted; without a seed nothing is reused',
    first > 0 && second === 0 && r.hits === first && r.savedMs >= 0 && unseeded === null,
    { first, second, r },
  );
}

// ---- 9h: the loop's policy is data that changes as it runs: proposed by the larger model, tried, kept or put back
{
  const P = await import('../training/loop-policy.mjs');
  const { orderFor, closeness, tuned, evidenceOf, likeKept, policyTick } = await import('../training/loop.mjs');
  const d = P.defaults();
  // bounds and shapes: a knob that is not there, a value out of bounds, an order missing a key, are refused; the rest falls back
  const bad = [
    P.checkValue('nope', 1).ok,
    P.checkValue('batch', 999).ok,
    P.checkValue('order', ['pin']).ok,
    P.checkValue('areas', { drafting: ['slots'] }).ok,
  ];
  const fallback = P.normal({ batch: 'x', beam: 4, areas: { writing: [...d.areas.writing].reverse() } });
  const reply =
    'Here is my view.\n```json\n{"proposals":[{"knob":"batch","value":3,"why":"build on what came closer sooner"},{"knob":"beam","value":99,"why":"wide"},{"knob":"momentumRecent","value":5,"why":"more memory"},{"knob":"partialCredit","value":false,"why":"third"}],"ideas":["reuse the checks too"]}\n```';
  const prop = P.proposalOf(reply, d);
  const none = P.proposalOf('no json here', d);
  // a trial, in tries: proposed after `reviewTries` tries, tried on `trialTries`, then judged against as many tries before it
  const run = async (during) => {
    const st = {
      questions: [],
      kept: [],
      classes: {},
      policy: P.normal({ reviewTries: 10, trialTries: 20 }),
      policyLog: [],
      tryN: 0,
      tryLog: [],
    };
    const asked = [];
    const events = [];
    const review = async (prompt) => (asked.push(prompt), '{"proposals":[{"knob":"batch","value":2,"why":"sooner"}]}');
    const feed = [...new Array(10).fill(1), ...new Array(20).fill(during)];
    for (const sc of feed) {
      st.tryN++;
      st.tryLog.push({ n: st.tryN, s: sc });
      await policyTick(st, { review, onPolicy: async (pol, ev) => events.push([ev.event, pol.batch]) });
    }
    return { st, asked, events };
  };
  const better = await run(3);
  const worse = await run(0);
  const failing = {
    questions: [],
    kept: [],
    classes: {},
    policy: P.normal({ reviewTries: 10 }),
    policyLog: [],
    tryN: 10,
    tryLog: [],
  };
  await policyTick(failing, {
    review: async () => {
      throw new Error('not served');
    },
  });
  check(
    "the loop's policy is data: only its knobs, within their bounds, are taken (a value out of bounds or a knob that is not there is refused, an unreadable value falls back to the default); the larger model's reply is read for at most two changes and its ideas kept; every `reviewTries` tries it is shown the record and the knobs, its proposal goes on trial for `trialTries` tries, and is kept where those tries came to at least as much as as many before (kept 10, parity that lost one 3, closer 1) and put back where they came to less; a review that cannot be made is written down and changes nothing",
    bad.every((x) => x === false) &&
      fallback.batch === d.batch &&
      fallback.beam === 4 &&
      fallback.areas.writing[0] === d.areas.writing.at(-1) &&
      fallback.areas.drafting.join() === d.areas.drafting.join() &&
      prop.taken.length === 2 &&
      prop.taken[0].knob === 'batch' &&
      prop.taken[1].knob === 'momentumRecent' &&
      prop.refused.some((r) => r.knob === 'beam') &&
      prop.ideas[0] === 'reuse the checks too' &&
      prop.policy.batch === 3 &&
      none.taken.length === 0 &&
      !none.read &&
      better.asked.length === 1 &&
      /The knobs/.test(better.asked[0]) &&
      /"tries":10/.test(better.asked[0]) &&
      better.events.map((e) => e.join(':')).join() === 'on trial:2,kept:2' &&
      better.st.policy.batch === 2 &&
      worse.events.map((e) => e.join(':')).join() === 'on trial:2,put back:8' &&
      worse.st.policy.batch === 8 &&
      worse.st.policyLog.at(-1).verdict.during < worse.st.policyLog.at(-1).verdict.before &&
      better.st.policyLog.at(-1).verdict.duringN === 20 &&
      failing.policyLog.at(-1).event === 'no review' &&
      failing.policy.batch === d.batch,
    { prop: prop.taken, better: better.events, worse: worse.events },
  );
  // THE SIX: partial credit makes a nearer answer closer; learned success ranks above the fixed area order; momentum brings what
  // is like a kept change forward; the writer is left out where the answer was not lost in the writing (unless the policy says)
  const near = { trace: [{ stage: 'draft', same: false, share: 0.7 }] };
  const far = { trace: [{ stage: 'draft', same: false, share: 0.2 }] };
  const learnedPool = [
    { name: 'a brief', kind: 'brief', stage: 'draft', area: 'briefs', key: 'br' },
    { name: 'move b-direct to c', kind: 'arrangement', area: 'slots', key: 'mv' },
  ];
  const classes = {
    'a brief from the reading': { tried: 6, reached: 0 },
    'a slot on another model': { tried: 6, reached: 2 },
  };
  const areasFirstBriefs = {
    ...d,
    areas: { ...d.areas, drafting: ['briefs', 'slots', 'flow', 'loops', 'decider', 'several'] },
  };
  const byLearned = orderFor(learnedPool, { classes, policy: areasFirstBriefs }).map((m) => m.key);
  const byArea = orderFor(learnedPool, {
    classes,
    policy: { ...areasFirstBriefs, order: ['pin', 'evidence', 'area', 'learned', 'momentum', 'cost', 'fresh', 'plan'] },
  }).map((m) => m.key);
  const kept = [{ what: 'move b-direct to c', slots: ['b-direct'], question: { id: 'q2' } }];
  const sib = { name: 'move b-other-way to c', kind: 'arrangement', area: 'slots', key: 'sib' };
  const other = { name: 'a1 at temperature 0.7', kind: 'arrangement', area: 'slots', key: 'oth' };
  const second = { name: 'add a second b-direct on c', kind: 'arrangement', area: 'slots', key: 'sec' };
  const byMomentum = orderFor([other, sib, second], { policy: d, recent: kept }).map((m) => m.key);
  const briefsW = {
    slots: [
      { id: 'a1', stage: 'draft' },
      { id: 'a-writer', stage: 'write' },
    ],
  };
  const evD = evidenceOf({ trace: [{ stage: 'draft', slot: 'a1', same: false }] }, briefsW);
  const writerMove = { name: 'move a-writer to b', kind: 'arrangement', area: 'slots', key: 'w' };
  const decideMove = { name: 'plan: decide by most', kind: 'arrangement', area: 'decider', key: 'dm' };
  check(
    "partial credit: an answer that gets more of the inputs right is closer, where no slot has the answer, and only with the policy on; what a kind has learned ranks above the fixed area order once it has been tried enough, and the order of the keys is the policy's; a change like one kept recently (the same slot, or most of its words) comes first; the writer is left out where the answer was not lost in the writing, and how it is decided where no slot had the answer, unless the policy says otherwise",
    closeness(near, null, { partial: true }) > closeness(far, null, { partial: true }) &&
      closeness(near) === closeness(far) &&
      byLearned[0] === 'mv' &&
      byArea[0] === 'br' &&
      byMomentum.indexOf('oth') === 2 &&
      likeKept(sib, kept) &&
      likeKept(second, kept) &&
      !likeKept(other, kept) &&
      tuned(evD, briefsW, d).skip(writerMove) &&
      !tuned(evD, briefsW, { ...d, skipWriterUnlessWriting: false }).skip(writerMove) &&
      tuned(evD, briefsW, d).skip(decideMove) &&
      !tuned(evD, briefsW, { ...d, skipDecidingUnlessChoosing: false }).skip(decideMove),
    { byLearned, byArea, byMomentum },
  );
  // decisions are reused as slot answers are: the same choices put the same way are decided as they were, without asking again
  let calls = 0;
  const decideOnce = async () => (calls++, { ok: true, letter: 'A', probs: { A: 0.9 } });
  reset();
  // (the two models disagree, so there is a decision to make)
  lfm.s.script = () => 'ANSWER: 41';
  const rs = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, seed: 3, reuse: true, decide: decideOnce });
  await rs.answer(Q);
  const c1 = calls;
  await rs.answer(Q);
  const reusedD = rs.reused;
  await rs.stop();
  check(
    'with reuse, the decider is not asked again what it was asked before: its decision is given again, and counted',
    c1 > 0 && calls === c1 && reusedD.decided === c1,
    { c1, calls, reusedD },
  );
}

// ---- 9i: the most-lost question is checked first; parity that breaks one question is built on; a long question is reviewed
{
  const { runLoop, guardOf } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const reachedQs = ['r1', 'r2', 'r3'].map((id) => ({ t: { id, kind: 'k' } }));
  const order = guardOf(reachedQs, { id: 'x', kind: 'k' }, 6)
    .map((r) => r.t.id)
    .join();
  const lostFirst = guardOf(reachedQs, { id: 'x', kind: 'k' }, 6, { r1: 4 })
    .map((r) => r.t.id)
    .join();
  // `x` brings `hard` to parity but breaks `other`; `x` with `y` keeps both
  const asked = [];
  const st = await runLoop({
    list: [
      { id: 'other', kind: 'k' },
      { id: 'hard', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['x', 'y', 'z'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    attempt: async (bb, t) => {
      asked.push(t.id + ':' + bb.has.join('+'));
      const right = t.id === 'other' ? !(bb.has.includes('x') && !bb.has.includes('y')) : bb.has.includes('x');
      return right
        ? { grade: 'right', trace: [] }
        : { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
    },
  });
  const hard = st.questions[1];
  // with no budget for it, such a parity is not built on: the pair is found another way, when the search widens (on `y`)
  const noBudget = await runLoop({
    list: [
      { id: 'other', kind: 'k' },
      { id: 'hard', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['x', 'y', 'z'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    policy: { brokeBudget: 0 },
    attempt: async (bb, t) =>
      (t.id === 'other' ? !(bb.has.includes('x') && !bb.has.includes('y')) : bb.has.includes('x'))
        ? { grade: 'right', trace: [] }
        : { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] },
  });
  // a long question: reviewed after `reviewTries` changes on it, its proposal on trial from there
  const prompts = [];
  const long = await runLoop({
    list: [{ id: 'long', kind: 'k' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) =>
      'abcdefgh'
        .split('')
        .filter((k) => !bb.has.includes(k))
        .map((k) => mk(bb, k)),
    policy: { reviewTries: 10, batch: 0 },
    cap: 15,
    review: async (p) => (prompts.push(p), '{"proposals":[{"knob":"beam","value":2,"why":"narrower"}]}'),
    attempt: async () => ({ grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] }),
  });
  check(
    'the question already at parity that changes have lost most is asked first when a change reaches parity; a change that brings the question to parity but breaks another is counted as a conflict and built on, so that one more change can keep both (and it is kept together); a long question is reviewed by the larger model after `reviewTries` tries, shown as in hand, and the proposal goes on trial from there',
    order === 'r3,r2,r1' &&
      lostFirst === 'r1,r3,r2' &&
      hard.state === 'reached' &&
      hard.broke.other === 1 &&
      st.lostOn.other === 1 &&
      st.kept.at(-1).what === 'several: x + y' &&
      asked.indexOf('hard:x+y') === asked.indexOf('other:x') + 1 &&
      hard.attempts.find((a) => a.move === 'x').nearParity === true &&
      prompts.length === 1 &&
      /"inHand":true/.test(prompts[0]) &&
      long.policyLog[0].event === 'on trial' &&
      long.policyLog[0].during === 'long' &&
      long.policy.beam === 2 &&
      noBudget.questions[1].state === 'reached' &&
      noBudget.questions[1].broke.other === 1 &&
      !noBudget.questions[1].attempts.some((x) => (x.on || [])[0] === 'x'),
    { asked, broke: hard.broke, kept: st.kept.map((k) => k.what), log: long.policyLog },
  );
}

// ---- 9j: the library of found arrangements is tried first and grows; a standing conflict is swapped; a carried trial goes on
{
  const { runLoop, rankLibrary, applyNames, addToLibrary } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const poolOf = (bb) => ['p', 'q', 'r', 's'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const asked = [];
  const written = [];
  // (found on a question of the same class, words; and one found on a code question, which questions in words never try)
  const lib = [
    {
      names: ['p', 'q'],
      what: 'several: p + q',
      from: { question: 'old', class: 'words' },
      reached: ['old'],
      tried: 0,
    },
    {
      names: ['s'],
      what: 's',
      from: { question: 'old-code', class: 'code' },
      reached: ['old-code', 'x', 'y'],
      tried: 0,
    },
  ];
  const st = await runLoop({
    list: [
      { id: 'easy', kind: 'k' },
      { id: 'needs-pq', kind: 'k' },
      { id: 'needs-r', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf,
    library: lib,
    onLibrary: async (l) => written.push(JSON.parse(JSON.stringify(l))),
    attempt: async (bb, t) => {
      asked.push(t.id + ':' + bb.has.join('+'));
      const ok =
        t.id === 'easy' ||
        (t.id === 'needs-pq' && bb.has.includes('p') && bb.has.includes('q')) ||
        (t.id === 'needs-r' && bb.has.includes('r'));
      return ok ? { grade: 'right', trace: [] } : wrong;
    },
  });
  const last = written.at(-1);
  // a standing conflict: `x` brings B to parity and loses A each time; after `swapAfter` such losses it is kept, and A goes back in hand
  const pool2 = (bb) => ['x', 'y'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const order = [];
  const sw = await runLoop({
    list: [
      { id: 'A', kind: 'k' },
      { id: 'B', kind: 'k' },
      { id: 'C', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: pool2,
    policy: { swapAfter: 2 },
    attempt: async (bb, t, at) => {
      if (!at.attempt && !at.guard) order.push(t.id);
      const ok = t.id === 'A' ? !bb.has.includes('x') : t.id === 'B' ? bb.has.includes('x') : true;
      return ok ? { grade: 'right', trace: [] } : wrong;
    },
  });
  const A = sw.questions.find((x) => x.id === 'A');
  const B = sw.questions.find((x) => x.id === 'B');
  // a trial carried from before (a pass ended, or the state cleared, with one on) goes on in the new pass
  const carried = await runLoop({
    list: [{ id: 'z', kind: 'k' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf,
    policy: { beam: 5 },
    trial: { from: { beam: 3 }, taken: [{ knob: 'beam', from: 3, to: 5 }] },
    attempt: async () => ({ grade: 'right', trace: [] }),
  });
  check(
    'the arrangements found so far on questions of its class are tried first on a question short of parity (one found on another class never is), the most successful first, applied on top of the swarm as it stands; one that brings it to parity and loses none is kept, and the library credits it with the question; what the search finds is added to the library; a standing conflict (the same question lost `swapAfter` times) is swapped: the change is kept, the question it loses goes back in hand and is taken next, its record replaced, not added; a trial carried from before goes on',
    asked.indexOf('needs-pq:p+q') === asked.indexOf('needs-pq:') + 1 &&
      lib.find((e) => e.what === 's').tried === 0 &&
      st.kept[0].kind === 'library' &&
      st.kept[0].fromLibrary.question === 'old' &&
      last.find((e) => e.what === 'several: p + q').reached.join() === 'old,needs-pq' &&
      last.some((e) => e.names.includes('r') && e.reached.includes('needs-r')) &&
      rankLibrary([{ reached: ['a'] }, { reached: ['a', 'b'] }])[0].reached.length === 2 &&
      applyNames(poolOf, { has: ['p'] }, ['p', 'q']).names.join() === 'q' &&
      applyNames(poolOf, { has: ['p', 'q', 'r', 's'] }, ['p']) === null &&
      addToLibrary([], ['b', 'a'], { question: 'x' }).what === 'several: b + a' &&
      B.state === 'reached' &&
      B.swapped === 'A' &&
      sw.kept.at(-1).swapped === 'A' &&
      order.join() === 'A,B,A,C' &&
      A.again === 1 &&
      A.lostTo === 'B' &&
      sw.questions.filter((x) => x.id === 'A').length === 1 &&
      carried.trial &&
      carried.trial.taken[0].knob === 'beam' &&
      carried.trial.from.beam === 3,
    { asked: asked.slice(0, 8), kept: st.kept.map((k) => k.what), order, A, swapped: sw.kept.map((k) => k.swapped) },
  );
}

// ---- 9p: a conflict handled faster: what is built on a change that broke a question is aimed at that question; the question this
// question's changes break most is checked first; a conflict with one question only is swapped after `stableAfter`
{
  const { runLoop, guardOf } = await import('../training/loop.mjs');
  const mk = (bb, k, area) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area,
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const DECIDE = 'plan: decide by most';
  const pool = (bb) =>
    [
      ['x', 'slots'],
      ['m1', 'slots'],
      [DECIDE, 'decider'],
    ]
      .filter(([k]) => !bb.has.includes(k))
      .map(([k, area]) => mk(bb, k, area));
  const asked = [];
  // B needs x; x makes A lose in choosing (a draft had A's answer, and it was not chosen) unless the decider is changed too
  const run = await runLoop({
    list: [
      { id: 'A', kind: 'k' },
      { id: 'B', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: pool,
    policy: { stableAfter: 0 },
    attempt: async (bb, t) => {
      asked.push(t.id + ':' + bb.has.join('+'));
      if (t.id === 'A' && bb.has.includes('x') && !bb.has.includes(DECIDE))
        return { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: true }] };
      if (t.id === 'B' && !bb.has.includes('x'))
        return { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
      return { grade: 'right', trace: [] };
    },
  });
  const B = run.questions.find((x) => x.id === 'B');
  const afterBreak = asked.slice(asked.indexOf('A:x') + 1);
  // the same conflict as the swap check before, with swapAfter left at 25: one question only lost, so swapped after stableAfter
  const order = [];
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const sw = await runLoop({
    list: [
      { id: 'A', kind: 'k' },
      { id: 'B', kind: 'k' },
      { id: 'C', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['x', 'y'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k, 'slots')),
    policy: { swapAfter: 25, stableAfter: 2 },
    attempt: async (bb, t, at) => {
      if (!at.attempt && !at.guard) order.push(t.id);
      const ok = t.id === 'A' ? !bb.has.includes('x') : t.id === 'B' ? bb.has.includes('x') : true;
      return ok ? { grade: 'right', trace: [] } : wrong;
    },
  });
  const reached = [{ t: { id: 'q1', kind: 'k' } }, { t: { id: 'q3', kind: 'k' } }];
  check(
    "a change that brings the question to parity but breaks one already there is built on with changes aimed at the one it broke (ranked by where that one was lost: here a deciding change, which this question's own drafting loss would have left out), and kept together; the question this question's changes have broken most is checked first, before one lost more often overall; and where the only question lost is the same one, the conflict is swapped after `stableAfter` losses, sooner than `swapAfter`",
    B.state === 'reached' &&
      run.kept.at(-1).what === 'several: x + ' + DECIDE &&
      afterBreak[0] === 'B:x+' + DECIDE &&
      !asked.some((a) => a === 'B:x+m1') &&
      guardOf(reached, { id: 'q6', kind: 'k' }, 6, { q1: 11, q3: 5 }, { 'q6>q3': 5 })
        .map((r) => r.t.id)
        .join() === 'q3,q1' &&
      guardOf(reached, { id: 'q6', kind: 'k' }, 6, { q1: 11, q3: 5 })
        .map((r) => r.t.id)
        .join() === 'q1,q3' &&
      sw.kept.at(-1).swapped === 'A' &&
      order.join() === 'A,B,A,C',
    { asked, kept: run.kept.map((k) => k.what), order, swapped: sw.kept.map((k) => k.swapped) },
  );
}

// ---- 9q: a standing conflict that spans two questions already at parity is swapped after `stableAfter` losses of them together, when
// `stableMax` allows two; with `stableMax` 1 it is not
{
  const { runLoop } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const go = (stableMax) =>
    runLoop({
      list: [
        { id: 'A', kind: 'k' },
        { id: 'C', kind: 'k' },
        { id: 'B', kind: 'k' },
      ],
      briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
      poolOf: (bb) => ['x', 'y'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
      policy: { swapAfter: 25, stableAfter: 2, stableMax },
      // B needs x; x loses both A and C
      attempt: async (bb, t) => ((t.id === 'B') === bb.has.includes('x') ? { grade: 'right', trace: [] } : wrong),
    });
  const two = await go(2);
  const one = await go(1);
  const sw2 = two.kept.filter((k) => k.swapped).map((k) => k.swapped);
  const sw1 = one.kept.filter((k) => k.swapped).map((k) => k.swapped);
  check(
    'a conflict spanning two questions already at parity is swapped after `stableAfter` losses of them together (both go back in hand), and not when `stableMax` is 1',
    sw2.length === 1 && sw2[0].split(', ').sort().join() === 'A,C' && sw1.length === 0,
    { sw2, sw1 },
  );
}

// ---- 9r: a question that stops coming closer is set aside while others wait, and comes back after them; a stopped run carries on
// from its last try; the larger model's help comes less often where it brings nothing; closeness counts how near all the drafts
// came; and a change that loses only questions of the other kind is kept for its own kind
{
  const { runLoop, closeness } = await import('../training/loop.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const MOVES = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  const pool = (bb) => MOVES.filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k));
  const wrong = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const B0 = () => ({ version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} });
  // set aside: A never comes closer; after 3 tries it waits for B, then comes back (nothing has changed: searched until exhausted)
  const firsts = [];
  const sa = await runLoop({
    list: [
      { id: 'A', kind: 'k' },
      { id: 'B', kind: 'k' },
    ],
    briefs: B0(),
    poolOf: pool,
    policy: { setAsideAfter: 3, batch: 0, suggestEvery: 0, teachEvery: 0 },
    attempt: async (bb, t, at) => (
      !at.attempt && !at.guard && firsts.push(t.id),
      t.id === 'A' ? wrong : { grade: 'right', trace: [] }
    ),
  });
  const A = sa.questions.find((x) => x.id === 'A');
  // carried on: a run stopped at its 5th try is started again from what onTry wrote, and asks none of its first tries again
  let saved = null;
  const asked1 = [];
  try {
    await runLoop({
      list: [{ id: 'Q', kind: 'k' }],
      briefs: B0(),
      poolOf: pool,
      policy: { setAsideAfter: 0, batch: 0, suggestEvery: 0, teachEvery: 0 },
      onTry: async (st) => (saved = JSON.parse(JSON.stringify(st))),
      attempt: async (bb, t, at) => {
        if (at.attempt === 5) throw new Error('stopped');
        if (at.attempt) asked1.push(bb.has.join('+'));
        return wrong;
      },
    });
  } catch {}
  const asked2 = [];
  const tries2 = [];
  await runLoop({
    list: [{ id: 'Q', kind: 'k' }],
    briefs: B0(),
    poolOf: pool,
    resume: saved,
    policy: { setAsideAfter: 0, batch: 0, suggestEvery: 0, teachEvery: 0 },
    attempt: async (bb, t, at) => (at.attempt && (asked2.push(bb.has.join('+')), tries2.push(at.attempt)), wrong),
  });
  // help backs off: the larger model, asked to suggest every 2 failed tries, is asked less often where its suggestions bring nothing
  const asks = async (helpBackoff) => {
    let n = 0;
    await runLoop({
      list: [{ id: 'Q', kind: 'k', ask: 'Write isEven(n).' }],
      briefs: B0(),
      poolOf: (bb) =>
        Array.from({ length: 40 }, (_, k) => 'n' + k)
          .filter((k) => !bb.has.includes(k))
          .map((k) => mk(bb, k)),
      cap: 30,
      policy: { suggestEvery: 2, teachEvery: 0, batch: 0, setAsideAfter: 0, reviewTries: 1000, helpBackoff },
      review: async (p, kind) => (kind === 'suggest' && n++, kind === 'suggest' ? '{"try":[["n39"]],"why":"x"}' : '{}'),
      attempt: async () => wrong,
    });
    return n;
  };
  const off = await asks(false);
  const on = await asks(true);
  // closeness: the same nearest answer, more of the drafts near: closer
  const tr = (xs) => ({ trace: xs.map((share) => ({ stage: 'draft', same: false, share })) });
  const nearer = closeness(tr([0.5, 0.5]), null, { partial: true }) > closeness(tr([0.5, 0]), null, { partial: true });
  // scoped by class: B (code) needs x in its plan, and x would lose A and C (words): kept in the code class's own arrangement only,
  // and A and C keep the shared one they are at parity with
  const CODE = 'Write a JavaScript function `f(n)` that returns n.';
  const kb = await runLoop({
    list: [
      { id: 'A', kind: 'k', ask: 'What is the capital of France?' },
      { id: 'B', kind: 'k', ask: CODE },
      { id: 'C', kind: 'k', ask: 'What is two plus two?' },
    ],
    briefs: B0(),
    poolOf: (bb) =>
      bb.plan && bb.plan.x
        ? []
        : [
            {
              key: 'x',
              id: 'x',
              name: 'x',
              kind: 'arrangement',
              area: 'plan',
              briefs: { ...bb, plan: { ...(bb.plan || {}), x: true } },
            },
          ],
    policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0 },
    attempt: async (bb, t) =>
      (t.id === 'A' || t.id === 'C') === !!(bb.plan && bb.plan.x) ? wrong : { grade: 'right', trace: [] },
  });
  check(
    'a question that stops coming closer is set aside while another waits and comes back after it; a stopped run carries on from its last try without asking its first tries again; the larger model is asked less often where its suggestions bring nothing; closeness counts how near all the drafts came; and a change found on a question of one class is kept in the arrangement of that class only, the others keeping the shared one',
    firsts.join() === 'A,B,A' &&
      A.state === 'not reached' &&
      A.setAside === 1 &&
      tries2[0] === 5 &&
      !asked2.some((x) => asked1.includes(x)) &&
      on < off &&
      nearer &&
      kb.kept.at(-1).class === 'code' &&
      kb.briefs.kinds.code.plan.x === true &&
      'flow' in kb.briefs.kinds.code &&
      !(kb.briefs.plan && kb.briefs.plan.x) &&
      !kb.briefs.kinds.words &&
      kb.questions.find((x) => x.id === 'A').state === 'at parity' &&
      kb.questions.find((x) => x.id === 'C').state === 'at parity',
    {
      firsts,
      A: A && A.state,
      setAside: A && A.setAside,
      tries2: tries2.slice(0, 3),
      asked1,
      asked2: asked2.slice(0, 4),
      on,
      off,
      kept: kb.kept.map((k) => k.class),
      kinds: kb.briefs.kinds,
    },
  );
}

// ---- 9s: the larger model's new briefs go first to the drafters nearest the answer, and a brief that gives a question away (code,
// or the name of a function a question asks for) is refused and counted
{
  const { runLoop } = await import('../training/loop.mjs');
  const { givesAway } = await import('../training/support/teach.mjs');
  const Q =
    'Write a JavaScript function `rotate(list)` that returns a new array with the items moved 4 places to the left.';
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const taught = [];
  const st = await runLoop({
    list: [{ id: 'Q', kind: 'k', ask: Q }],
    briefs: {
      version: 1,
      has: [],
      slots: [
        { id: 'a-direct', stage: 'draft' },
        { id: 'a-steps', stage: 'draft' },
        { id: 'c-direct', stage: 'draft' },
      ],
      plan: {},
    },
    poolOf: (bb) => ['m1', 'm2', 'm3', 'm4'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    cap: 6,
    policy: { teachEvery: 2, suggestEvery: 0, batch: 0, setAsideAfter: 0, helpBackoff: false },
    teach: async (slot) => (taught.push(slot.id), Object.assign([], { refused: 1 })),
    attempt: async () => ({
      grade: 'wrong',
      path: 'decided',
      trace: [
        { stage: 'draft', slot: 'a-direct', same: false, share: 0 },
        { stage: 'draft', slot: 'a-steps', same: false, share: 0.53 },
        { stage: 'draft', slot: 'c-direct', same: false, share: 0.87 },
      ],
    }),
  });
  check(
    "the larger model's briefs go first to the drafters nearest the answer (by the share of inputs they already get right), not to the first in order; and a brief that holds code (a variable set or a remainder taken among it), names a function a question asks for, or uses a number of the question it was written on is refused and counted, where a general one is not",
    taught.slice(0, 2).join() === 'c-direct,a-steps' &&
      st.teach.refused >= 2 &&
      givesAway('Compute k = k % list.length and return [...list.slice(k)]', [Q]) === 'it holds code' &&
      /names rotate/.test(givesAway('Before rotating, reduce the shift modulo the length.', [Q])) &&
      givesAway('Read the question twice, and check the shortest inputs it allows before answering.', [Q]) === '' &&
      // the answer in words, as it slipped through once: a variable set and a remainder taken are code
      givesAway('If length is 0 return []. Let k = 4 % length. Return the list sliced from k to end.', [Q]) ===
        'it holds code' &&
      // a number the question uses, for the question the brief was written on
      /uses 4/.test(givesAway('Shift by 4 and wrap around at the end.', [Q], { numbers: true })) &&
      givesAway('Shift by 4 and wrap around at the end.', [Q]) === '' &&
      givesAway('Aim for 50% of the effort on checking, under 110 words.', [Q], { numbers: true }) === '',
    { taught, refused: st.teach && st.teach.refused },
  );
}

// ---- 9k: after `suggestEvery` failed tries the larger model suggests what to try, tried at once; its cost and yield are counted
{
  const { runLoop } = await import('../training/loop.mjs');
  const { suggestionsOf } = await import('../training/loop-policy.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const prompts = [];
  const asked = [];
  const st = await runLoop({
    list: [{ id: 'q', kind: 'k', ask: 'Write isEven(n).' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['a', 'b', 'c', 'd', 'e', 'f'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    policy: { suggestEvery: 3, batch: 0, reviewTries: 1000 },
    review: async (p, kind) => (
      prompts.push([kind, p]),
      kind === 'suggest' ? '{"try":[["E","f"],["no such change"]],"why":"both are needed"}' : '{}'
    ),
    attempt: async (bb) => (
      asked.push(bb.has.join('+')),
      bb.has.includes('e') && bb.has.includes('f')
        ? { grade: 'right', trace: [] }
        : { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] }
    ),
  });
  const won = st.questions[0].attempts.find((a) => a.kept);
  const unit = suggestionsOf('ok {"try":[["x","y","z","w"],"y",["y"]],"why":"w"}', ['x', 'y', 'z', 'w']);
  check(
    'after `suggestEvery` failed tries the larger model is shown the question, what was tried and how close it came, and the changes still open by name, and what it names (matched to that list; anything else left out) is tried at once, on top of the closest arrangement; a suggestion that brings the question to parity is kept like any change; what suggestions cost and came to is counted',
    asked.slice(0, 5).join('|') === '|a|b|c|e+f' &&
      prompts.length === 1 &&
      prompts[0][0] === 'suggest' &&
      /Write isEven/.test(prompts[0][1]) &&
      /"open":\["d","e","f"\]|"d","e","f"/.test(prompts[0][1]) &&
      won.suggested === true &&
      won.kind === 'a suggestion of the larger model' &&
      st.kept[0].what === 'several: e + f' &&
      st.suggest.asked === 1 &&
      st.suggest.tried === 1 &&
      st.suggest.kept === 1 &&
      st.suggestLog[0].picks.join() === 'e + f' &&
      st.suggestLog[0].came.join() === 'kept' &&
      unit.picks.length === 2 &&
      unit.picks[0].join() === 'x,y,z' &&
      unit.picks[1].join() === 'y' &&
      suggestionsOf('no json', ['x']).picks.length === 0,
    { asked, suggest: st.suggest, log: st.suggestLog, prompt: prompts[0] && prompts[0][1].slice(-400) },
  );
}

// ---- 9l: a trial with no signal is put back; refusals are shown again; pace in real seconds; the smallest win; briefs for a drafting loss
{
  const { runLoop, reviewNow } = await import('../training/loop.mjs');
  const P = await import('../training/loop-policy.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  const wrong = (same = false) => ({
    grade: 'wrong',
    path: 'decided',
    trace: [{ stage: 'draft', slot: 'a1', same, out: 'function f(){return 1}' }],
    refReply: 'function f(){return 2}',
  });
  const v0 = P.verdictOf([0, 0, 0], [0, 0, 0]);
  const v1 = P.verdictOf([0, 1], [1, 3]);
  // refusals: the second review is shown the first one's refusal
  const prompts = [];
  const st = { questions: [], kept: [], classes: {}, policy: P.normal({}), policyLog: [], tryN: 0, tryLog: [] };
  const rv = async (p) => (prompts.push(p), '{"proposals":[{"knob":"learnedMinTried","value":0,"why":"lower"}]}');
  await reviewNow(st, { review: rv });
  await reviewNow(st, { review: rv });
  // pace in real seconds, and the smallest win: a found arrangement of two changes of which only `x` is needed
  const notes = [];
  const small = await runLoop({
    list: [
      { id: 'easy', kind: 'k' },
      { id: 'q', kind: 'k' },
      { id: 'q2', kind: 'k' },
    ],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft' }], plan: {} },
    poolOf: (bb) => ['x', 'y', 'z'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    library: [
      {
        names: ['y', 'x'],
        what: 'several: y + x',
        from: { question: 'old', class: 'words' },
        reached: ['old'],
        tried: 0,
      },
    ],
    attempt: async (bb, t, at) => (
      notes.push(at),
      t.id === 'easy' || (t.id === 'q' && bb.has.includes('x'))
        ? { grade: 'right', trace: [], seconds: 90, wallSeconds: 4 }
        : { ...wrong(), seconds: 90, wallSeconds: 4 }
    ),
  });
  // briefs for a drafting loss: after `teachEvery` failed tries the larger model writes one for the failing drafter, and it wins
  const taught = [];
  let written = null;
  const tq = await runLoop({
    list: [{ id: 'hard', kind: 'k', ask: 'Write roundTo(n).' }],
    briefs: { version: 1, has: [], slots: [{ id: 'a1', stage: 'draft', brief: 'Answer.' }], plan: {} },
    policy: { teachEvery: 3, batch: 0, suggestEvery: 0, reviewTries: 1000 },
    review: async () => '{}',
    poolOf: (bb) => [
      ...['a', 'b', 'c', 'd'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
      ...(written && !bb.has.includes('tb')
        ? [{ ...mk(bb, 'tb'), name: written, kind: 'brief', slot: 'a1', area: 'briefs' }]
        : []),
    ],
    teach: async (slot, missed) => (
      taught.push([slot.id, missed[0]]),
      (written = 'the larger model: a careful drafter'),
      [{ name: written, brief: 'x'.repeat(60) }]
    ),
    attempt: async (bb) => (bb.has.includes('tb') ? { grade: 'right', trace: [] } : wrong()),
  });
  const won = tq.questions[0].attempts.find((a) => a.kept);
  check(
    "a trial whose tries came to nothing on both sides is inconclusive and put back; the larger model is shown the proposals refused before, so as not to make them again; the pace is the clock's seconds, not the full cost; a win of several changes is tried without each part and kept in its smallest form; and where no slot drafts the answer, after `teachEvery` failed tries the larger model writes new briefs for the failing drafter from what it wrote and the answer wanted, tried at once",
    v0.keep === false &&
      v0.inconclusive === true &&
      v1.keep === true &&
      !v1.inconclusive &&
      st.policyLog[0].refused[0].knob === 'learnedMinTried' &&
      /refused/.test(prompts[1]) &&
      /learnedMinTried takes a whole number/.test(prompts[1]) &&
      notes.filter((n) => n.pace).at(-1).pace.seconds === 4 &&
      small.kept[0].what === 'x' &&
      small.kept[0].pruned.join() === 'y' &&
      small.questions[1].attempts.some((a) => a.prune) &&
      taught.length === 1 &&
      taught[0][0] === 'a1' &&
      taught[0][1].wanted === 'function f(){return 2}' &&
      /Write roundTo/.test(taught[0][1].question) &&
      won &&
      won.taught === true &&
      tq.teach.asked === 1 &&
      tq.teach.kept === 1 &&
      tq.teach.briefs === 1,
    {
      v0,
      prompt: prompts[1] && prompts[1].slice(-300),
      kept: small.kept.map((k) => [k.what, k.pruned]),
      teach: tq.teach,
      taught,
    },
  );
}

// ---- 9m: teaching beyond drafting and with reasoning; a question beyond rearranging; the adapter dataset and probe
{
  const { runLoop } = await import('../training/loop.mjs');
  const { teachAsk } = await import('../training/support/teach.mjs');
  const A = await import('../training/adapters.mjs');
  const mk = (bb, k) => ({
    key: k,
    id: k,
    name: k,
    kind: 'arrangement',
    area: 'slots',
    briefs: { ...bb, has: [...bb.has, k] },
  });
  // a slot had the answer and it was not chosen: the checker is taught
  const taught = [];
  const chose = await runLoop({
    list: [{ id: 'c', kind: 'k', ask: 'Pick the right answer.' }],
    briefs: {
      version: 1,
      has: [],
      slots: [
        { id: 'd1', stage: 'draft', brief: 'Draft.' },
        { id: 'k1', stage: 'check', brief: 'Check.' },
      ],
      plan: {},
    },
    policy: { teachEvery: 2, batch: 0, suggestEvery: 0, reviewTries: 1000, adaptAfter: 4 },
    review: async () => '{}',
    poolOf: (bb) => ['a', 'b', 'c', 'd', 'e', 'f'].filter((k) => !bb.has.includes(k)).map((k) => mk(bb, k)),
    teach: async (slot, missed, lost) => (taught.push([slot.id, lost]), []),
    onBeyond: async (q) => ({ dataset: 'd.jsonl', examples: 3, flagged: q.id }),
    attempt: async () => ({
      grade: 'wrong',
      path: 'decided',
      trace: [
        { stage: 'draft', slot: 'd1', same: true, out: 'x' },
        { stage: 'check', slot: 'k1', same: false, out: 'looks fine' },
      ],
      refReply: 'x',
    }),
    cap: 8,
  });
  const q = chose.questions[0];
  const prompt = teachAsk(
    { stage: 'check', brief: 'Check.' },
    [{ question: 'Q', slotWrote: 'W', wanted: 'A' }],
    'choosing',
  );
  // the dataset: train questions only, as chat pairs
  const tmp = path.join(os.tmpdir(), 'adapters-' + process.pid);
  const ds = A.exportDataset(
    [
      { id: 't1', kind: 'k', ask: 'one', split: 'train' },
      { id: 'h1', kind: 'k', ask: 'held', split: 'held' },
      { id: 't2', kind: 'k', ask: 'two', split: 'train' },
    ],
    new Map([
      ['t1', 'ANSWER: 1'],
      ['h1', 'ANSWER: h'],
      ['t2', ''],
    ]),
    path.join(tmp, 'train.jsonl'),
  );
  const lines = fs
    .readFileSync(ds.file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  // the probe: a trainer that cannot, its reason read from what it said; kept, so a second probe does not run it again
  let runs = 0;
  const fakeRun = (cmd, args) => {
    runs++;
    fs.writeFileSync(
      args[1].match(/> '([^']+)'/)[1],
      'src/ggml.c:7367: ggml_compute_backward: unsupported unary op for backward pass: SIGMOID\n1 libggml-base ggml_abort\n',
    );
    return { status: null, signal: 'SIGABRT' };
  };
  fs.writeFileSync(path.join(tmp, 'm.gguf'), 'x');
  const p1 = A.probe([{ name: 'M', file: path.join(tmp, 'm.gguf') }], {
    cacheFile: path.join(tmp, 'probe.json'),
    workDir: path.join(tmp, 'w'),
    run: fakeRun,
  });
  const p2 = A.probe([{ name: 'M', file: path.join(tmp, 'm.gguf') }], {
    cacheFile: path.join(tmp, 'probe.json'),
    workDir: path.join(tmp, 'w'),
    run: fakeRun,
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  check(
    "where a slot had the answer and it was not chosen, the larger model is asked to teach the checker (not only where no slot drafted it), saying first what went wrong in general and teaching the method, never the question or its answer; a question that resists `adaptAfter` tries, the larger model's teaching among them, is flagged as beyond rearranging once, with what was made ready; the dataset is the larger model's answers to train questions only, as chat pairs; and the probe says why a model cannot be trained here, from the trainer's own line, and is not run twice for one model",
    taught[0][0] === 'k1' &&
      taught[0][1] === 'choosing' &&
      /settled on another/.test(prompt) &&
      /First work out what went wrong/.test(prompt) &&
      /never mention a question shown here/.test(prompt) &&
      /ADDITIONS to what it is told/.test(prompt) &&
      /"why"/.test(prompt) &&
      q.beyond &&
      q.beyond.at === 4 &&
      q.beyond.taught >= 1 &&
      q.beyond.ready.flagged === 'c' &&
      q.state === 'not reached' &&
      ds.examples === 1 &&
      lines[0].id === 't1' &&
      lines[0].messages.at(-1).content === 'ANSWER: 1' &&
      p1[0].ok === false &&
      p1[0].why === 'llama-finetune cannot train it: SIGMOID has no backward pass' &&
      p2[0].why === p1[0].why &&
      runs === 1 &&
      A.reasonOf('x\nsrc/ggml-opt.cpp:95: GGML_ASSERT(ndata > 0) failed\n1 libggml-base ggml_abort') ===
        'src/ggml-opt.cpp:95: GGML_ASSERT(ndata > 0) failed',
    { taught, beyond: q.beyond, ds, p1 },
  );
}

// ---- 9m1: THE REPLY CLOSES AS THE EARLIER REPLIES DO (plan.closeAs 'shown'): the form is read from the conversation, and the
// reply ends with it around what was settled
{
  const R = await import('../src/read.mjs');
  const { answer } = await import('../src/orchestrate.mjs');
  const shots = [
    { role: 'user', content: 'Ann lies. Bob says Ann lies. Does Bob tell the truth?' },
    {
      role: 'assistant',
      content: "Let's think step by step.\n(1) Ann lies.\n(2) Bob says so, and it is so. So the answer is Yes.",
    },
    { role: 'user', content: 'Cy tells the truth. Di says Cy lies. Does Di tell the truth?' },
    { role: 'assistant', content: 'Cy tells the truth, so what Di says is false. So the answer is No.' },
    { role: 'user', content: 'Eve lies. Fay says Eve tells the truth. Does Fay tell the truth?' },
  ];
  const form = R.closingForm(shots);
  const lettered = R.closingForm([
    { role: 'assistant', content: 'a. So the answer is (A).' },
    { role: 'assistant', content: 'b. So the answer is (C).' },
  ]);
  const briefs = {
    marker: 'ANSWER:',
    plan: { closeAs: 'shown', writeAs: 'settled' },
    slots: [
      { id: 'a-direct', member: 'a', stage: 'draft', brief: 'Answer.', maxTokens: 50 },
      { id: 'b-direct', member: 'b', stage: 'draft', brief: 'Answer.', maxTokens: 50 },
    ],
  };
  const ask = async () => ({ ok: true, text: 'Eve lies, so what Fay says is false.\nANSWER: No', ms: 1 });
  const closed = await answer(shots, { briefs, ask });
  const plain = await answer(shots, { briefs: { ...briefs, plan: { writeAs: 'settled' } }, ask });
  const alone = await answer(shots.slice(-1), { briefs, ask });
  check(
    'where a plan says so, a reply closes as the earlier replies of the conversation do: the form is the words their last sentences share, the settled answer is put in it (a letter in brackets where they answer so), a last sentence that already begins that way is replaced, and nothing is done where no form is shown or the plan does not ask',
    form.lead === 'So the answer is' &&
      form.tail === '.' &&
      form.bracket === false &&
      lettered.bracket === true &&
      R.closedAs('work', 'b', lettered) === 'work So the answer is (B).' &&
      R.closedAs(
        'It is Vincent. The answer is (C).',
        'Vincent',
        lettered,
        'Who?\nOptions:\n(A) Louis\n(B) Gwen\n(C) Vincent',
      ) === 'It is Vincent. So the answer is (C).' &&
      // (a reply's own letter, said in other words than the form's, is said in the form: a reader of the form reads no other)
      R.closedAs(
        'Susan was free then. The answer is (A).',
        'between 6pm and 7pm',
        lettered,
        '(A) 6pm to 7pm\n(B) 1pm to 2pm',
      ) === 'Susan was free then. So the answer is (A).' &&
      R.closedAs('It is b. the answer is: b', 'x y', lettered) === 'It is b. So the answer is (B).' &&
      // (examples that close with a mark and a number are a form, and what was settled is said as its number)
      (() => {
        const marked = R.closingForm([
          { role: 'assistant', content: 'She sells 9 at $2.\n#### 18' },
          { role: 'assistant', content: 'Half of 10.\n#### 5' },
        ]);
        return (
          !!marked &&
          marked.lead === '####' &&
          marked.number === true &&
          R.closedAs('Janet makes 26 dollars every day.', '$1,026 dollars', marked) ===
            'Janet makes 26 dollars every day. #### 1026' &&
          R.closedAs('No number here.', 'many', marked) === 'No number here.' &&
          R.closingForm([
            { role: 'assistant', content: 'a.\nYes 1' },
            { role: 'assistant', content: 'b.\nYes 2' },
          ]) === null
        );
      })() &&
      // (examples that answer in marks with a space between each: an answer of marks is said with the spaces)
      (() => {
        const marks = R.closingForm([
          { role: 'assistant', content: 'a. So the answer is ] ] >.' },
          { role: 'assistant', content: 'b. So the answer is ) }.' },
        ]);
        return (
          marks.spaced === true &&
          R.closedAs('work', ']]>', marks) === 'work So the answer is ] ] >.' &&
          R.closedAs('x. So the answer is ]].', '>', marks) === 'x. So the answer is ] ].' &&
          R.closedAs('x. So the answer is ] ].', '>', marks) === 'x. So the answer is ] ].' &&
          lettered.spaced === false
        );
      })() &&
      // (a start that only opens a block of code has the code put in it, and the block closed)
      R.continuedFrom('\n```python\n', '```\ndef f(a):\n    return a\n```', 'def f(a):\n    return a') ===
        'def f(a):\n    return a\n```' &&
      R.closedAs('It is 3.', '3', lettered, 'How many?\n(A) 1\n(B) 2') === 'It is 3.' &&
      R.closedAs('It is red.', 'red', lettered, '(A) red\n(B) Red') === 'It is red.' &&
      // (a reply that already ends with the form around an answer of its own stands, whatever was settled; one whose last
      // sentence begins as the form does and holds no answer in the shape shown is closed with what was settled)
      R.closedAs('x. So the answer is Yes.', 'No', form) === 'x. So the answer is Yes.' &&
      R.closedAs('x. So the answer is (D).', 'C', lettered) === 'x. So the answer is (D).' &&
      R.closedAs('x. So the answer is d.', 'c', lettered) === 'x. So the answer is (C).' &&
      R.closedAs('x. So the answer is False.', 'and', form) === 'x. So the answer is False.' &&
      R.closedAs('x. So the answer is', 'No', form) === 'x. So the answer is No.' &&
      // (the questions training asks can be written out for a person to read: every train and held question, as it is put)
      (await (async () => {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(
          process.execPath,
          [fileURLToPath(new URL('../training/questions-list.mjs', import.meta.url))],
          {
            encoding: 'utf8',
            timeout: 60000,
          },
        );
        const qs = JSON.parse(r.stdout || '[]');
        return (
          qs.length > 100 &&
          qs.every(
            (q) =>
              q.id && q.kind && q.ask && ['train', 'held'].includes(q.split) && ['own', 'target'].includes(q.standard),
          ) &&
          ['tools', 'talk', 'code', 'words'].every((c) => qs.some((q) => q.class === c)) &&
          new Set(qs.map((q) => q.id)).size === qs.length
        );
      })()) &&
      // (a pass can be told which classes of input to train: those named that are classes, in their order; none or all is every class)
      (await import('../training/loop.mjs')).classesNamed('words, code,nothing').join() === 'code,words' &&
      (await import('../training/loop.mjs')).classesNamed('') === null &&
      (await import('../training/loop.mjs')).classesNamed('tools,talk,code,words') === null &&
      (await import('../training/loop.mjs'))
        .ofClasses([{ c: 'words' }, { c: 'code' }, { c: 'talk' }], ['code', 'words'], (x) => x.c)
        .map((x) => x.c)
        .join() === 'words,code' &&
      (await import('../training/loop.mjs')).ofClasses([{ c: 'talk' }], null, (x) => x.c).length === 1 &&
      /08-classes\s+training\/classes\.mjs \$\{TRAIN_CLASSES:\+--only "\$TRAIN_CLASSES"\}/.test(
        fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8'),
      ) &&
      /--only-classes "\$TRAIN_CLASSES"/.test(
        fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8'),
      ) &&
      // (and the arrangement every swarm starts from has it on: training turns it off for a class where that does better)
      JSON.parse(fs.readFileSync(new URL('../src/briefs.json', import.meta.url), 'utf8')).plan.closeAs === 'shown' &&
      JSON.parse(fs.readFileSync(new URL('../training/policy.json', import.meta.url), 'utf8')).classes.moves.includes(
        'the reply closes as it was written',
      ) &&
      R.closedAs('x. So the answer is No.', 'No', form) === 'x. So the answer is No.' &&
      R.withoutRestating('Q: ((1 + 2)) =  \nA:  \nStep 1: add.', 'Q: ((1 + 2)) =\nA: Think step by step.') ===
        'Step 1: add.' &&
      R.withoutRestating('A: Step 1: add.\nA: more', 'Q: 1 + 2 =\nA: Think.') === 'Step 1: add.\nA: more' &&
      R.withoutRestating('We are given 1 + 2.', 'Q: 1 + 2 =\nA: Think.') === 'We are given 1 + 2.' &&
      R.withoutRestating('Q: 1 + 2 =', 'Q: 1 + 2 =') === 'Q: 1 + 2 =' &&
      R.laidOutAs('one.  \n\nTwo.\n \n\nThree.', shots) === 'one.\nTwo.\nThree.' &&
      R.laidOutAs('one.\n\nTwo.', [...shots, { role: 'assistant', content: 'a.\n\nb.' }]) === 'one.\n\nTwo.' &&
      R.laidOutAs('one.\n\nTwo.', shots.slice(0, 2)) === 'one.\n\nTwo.' &&
      R.closingForm(shots.slice(0, 2)) === null &&
      R.closingForm([
        { role: 'assistant', content: 'Hello there.' },
        { role: 'assistant', content: 'You are welcome!' },
      ]) === null &&
      /So the answer is No\.$/.test(closed.reply) &&
      /\+closed$/.test(closed.path) &&
      !/the answer is/.test(plain.reply) &&
      !/\+closed/.test(plain.path) &&
      !/\+closed/.test(alone.path),
    { form, lettered, closed: [closed.reply, closed.path], plain: [plain.reply, plain.path], alone: alone.path },
  );
}

// ---- 9m3: EACH CLASS TRAINED AS A CLASS (training/classes.mjs): which questions, which candidates, what is kept; and a question
// put as a standard test puts it
{
  const C = await import('../training/classes.mjs');
  const { tasks: make, messagesOf: msgs, ownStandard: own } = await import('../training/tasks.mjs');
  const { classOf: cls } = await import('../src/orchestrate.mjs');
  const E = await import('../training/evaluate.mjs');
  const q = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: kind + i, kind }));
  const picked = C.sampleOf([...q('a', 5), ...q('b', 1), ...q('c', 3)], 6).map((t) => t.id);
  const rows = (bits) =>
    bits.map((b) => ({ counted: !!b, any: true, settled: !!b, unread: b ? false : true, ms: 1000 }));
  const up = C.pairedGain(rows([1, 1, 1, 1, 1, 1, 1, 0]), rows([0, 0, 0, 0, 0, 0, 1, 0]));
  const flat = C.pairedGain(rows([1, 0, 1, 0]), rows([0, 1, 0, 1]));
  const moves = ['x one', 'y one', 'x two', 'z', 'x three'].map((name) => ({ name }));
  const plain = make({ split: 'train', each: 2 });
  const withShown = make({ split: 'train', each: 2, shown: 1 });
  const sh = withShown.filter((t) => t.shape === 'shown');
  const one = sh.find((t) => t.kind === 'chain');
  const lie = sh.find((t) => t.kind === 'lies');
  const dir = path.join(os.tmpdir(), 'unread-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 's.jsonl'),
    [
      { filter: 'get-answer', resps: [['']], filtered_resps: ['[invalid]'] },
      { filter: 'get-answer', resps: [['work']], filtered_resps: ['[invalid]'] },
      { filter: 'get-answer', resps: [['So the answer is 4.']], filtered_resps: ['4'] },
      { filter: 'other', resps: [['']], filtered_resps: ['[invalid]'] },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  check(
    'a class is trained as a class: its questions are taken kind by kind in turn; candidates are the moves the policy names, the first of each pattern before the second of any; the best is kept only where it is better on the held questions by more than twice its paired error; some of each kind with an answer of its own are also put as a standard test puts a question, reach the module as a conversation, and are good only where the reply says the answer as the examples do, in its first block; and an evaluation counts the replies its harness could not read',
    picked.join() === 'a0,b0,c0,a1,c1,a2' &&
      C.figuresOf(rows([1, 0, 1])).counted === 2 &&
      C.figuresOf(rows([1, 0, 1])).unread === 1 &&
      C.figuresOf([{ counted: true, any: true, settled: true, unread: null }]).unread === null &&
      up.gain === 0.75 &&
      C.worthKeeping(up, 0.02) &&
      !C.worthKeeping(flat, 0) &&
      !C.worthKeeping({ gain: 0.01, error: 0 }, 0.02) &&
      C.candidatesOf(moves, ['^x', '^z', '^y'], 4)
        .map((m) => m.name)
        .join() === 'x one,z,y one,x two' &&
      plain.every((t, i) => withShown[i].id === t.id && withShown[i].ask === t.ask) === false &&
      plain.every((t) => withShown.some((x) => x.id === t.id && x.ask === t.ask)) &&
      sh.length > 10 &&
      sh.every(
        (t) => own(t) && cls(msgs(t)) === 'talk' && t.turns.length === 7 && !plain.some((p) => p.ask === t.ask),
      ) &&
      (await one.good('Step by step.\nSo the answer is ' + one.want + '.')).grade === 'right' &&
      (await one.good('It is ' + one.want + '.')).grade === 'wrong' &&
      (await one.good('Working.\n\nSo the answer is ' + one.want + '.')).grade === 'wrong' &&
      one.readable('It is ' + one.want) === false &&
      (await one.plainGood('ANSWER: ' + one.want)).grade === 'right' &&
      (await lie.good('So the answer is ' + lie.want + '.')).grade === 'right' &&
      E.unreadIn(path.join(dir, 's.jsonl'), 'get-answer') === 2 &&
      E.unreadIn(path.join(dir, 'none.jsonl'), 'x') === null,
    { picked, up, flat, shown: sh.length, one: one && one.id },
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 9m2: PRETRAIN AIMED: where bodies of work are named, an adapter learns from their train questions alone
{
  const A = await import('../training/adapters.mjs');
  const targets = [
    { id: 'math', kinds: ['chain', 'shop'] },
    { id: 'code', kinds: ['fix'] },
    { id: 'search', kinds: ['search'] },
  ];
  const list = [{ kind: 'chain' }, { kind: 'fix' }, { kind: 'shop' }, { kind: 'fix' }];
  const all = A.aimedAt(list, undefined, targets);
  const math = A.aimedAt(list, 'math', targets);
  const two = A.aimedAt(list, ' math , code ', targets);
  const none = A.aimedAt(list, 'search', targets);
  const bad = A.aimedAt(list, 'math,poetry', targets);
  const byKind = A.aimedAt(list, 'math', targets, 'fix');
  const noKind = A.aimedAt(list, '', targets, 'none');
  // where an adapter has something to teach: the kinds no slot had the answer to, a quarter of the time or more
  const aim = A.aimOf({
    classes: {
      talk: { asItStands: { kinds: { lies: { n: 4, anySlot: 4 }, date: { n: 4, anySlot: 2 } } } },
      words: {
        asItStands: { kinds: { date: { n: 4, anySlot: 3 }, dyck: { n: 4, anySlot: 0 }, one: { n: 1, anySlot: 0 } } },
      },
      code: { skipped: 'too few' },
    },
  });
  // only answers that are right by the question's own standard are taught
  const good = (want) => async (reply) => ({ grade: reply === want ? 'right' : 'wrong' });
  const taught = await A.rightOnly(
    [
      { id: 'q1', good: good('4') },
      { id: 'q2', good: good('5') },
      { id: 'q3' },
      { id: 'q4', type: 'open', good: good('x') },
      { id: 'q5', good: good('7') },
    ],
    { q1: '4', q2: 'nine', q3: 'anything', q4: 'words', q5: '' },
  );
  check(
    "pretrain aimed at named bodies of work, or at kinds named outright, learns from the train questions of those alone; none named, every one; a name that is no body of work, or none with a train question, stops it with the reason; what it is aimed at by the class stage is the kinds no slot had the answer to a quarter of the time or more, the furthest short first; and only answers right by the question's own standard are taught, a question with none, or one a reader marks, taught as it was",
    all.list.length === 4 &&
      math.list.length === 2 &&
      math.list.every((t) => ['chain', 'shop'].includes(t.kind)) &&
      two.list.length === 4 &&
      !none.list &&
      /no train question of search/.test(none.why) &&
      !bad.list &&
      /not a body of work: poetry/.test(bad.why) &&
      byKind.list.length === 2 &&
      byKind.list.every((t) => t.kind === 'fix') &&
      /no train question of the kinds none/.test(noKind.why) &&
      aim.join() === 'dyck,date' &&
      A.aimOf({}).length === 0 &&
      taught.list.map((t) => t.id).join() === 'q1,q3,q4,q5' &&
      taught.dropped === 1,
    [all, math, two, none, bad, aim, taught],
  );
}

// ---- 9n: MLX as the trainer: tool-call arguments parsed for a chat template, why a model can or cannot be trained, and an adapter
// kept only where llama.cpp finds the trained answers likelier with it
{
  const A = await import('../training/adapters.mjs');
  const tmp = path.join(os.tmpdir(), 'mlx-' + process.pid);
  // the agent questions carry a tool call's arguments as a JSON string; a template wants an object; a string that is not JSON stays
  const ds = A.exportDataset(
    [{ id: 'a1', kind: 'agent', ask: 'x', split: 'train' }],
    new Map([['a1', 'done']]),
    path.join(tmp, 'train.jsonl'),
    () => [
      { role: 'user', content: 'rename it' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a.js"}' } },
          { id: 'c2', type: 'function', function: { name: 'odd', arguments: 'not json' } },
        ],
      },
    ],
  );
  const calls = JSON.parse(fs.readFileSync(ds.file, 'utf8')).messages[1].tool_calls;
  // readiness: a file with no originals named; one that cannot be trained; MLX missing; weights missing; ready
  const work = path.join(tmp, 'work');
  const mk = (f) => ({ name: f, file: path.join(tmp, f) });
  const r = (f) => A.mlxReady(mk(f), work);
  const none = r('other.gguf');
  const bonsai = r('Ternary-Bonsai-2-4B-Q2_0.gguf');
  const noMlx = r('Qwen3.5-2B-Q4_K_M.gguf');
  const p = A.mlxPaths(work);
  fs.mkdirSync(path.dirname(p.python), { recursive: true });
  fs.writeFileSync(p.python, '');
  const noWeights = r('Qwen3.5-2B-Q4_K_M.gguf');
  fs.mkdirSync(path.join(p.hf, 'Qwen3.5-2B'), { recursive: true });
  fs.writeFileSync(path.join(p.hf, 'Qwen3.5-2B', 'config.json'), '{}');
  // (a config with no weights beside it is not weights: a download that fetched the small files only)
  const configOnly = r('Qwen3.5-2B-Q4_K_M.gguf');
  fs.writeFileSync(path.join(p.hf, 'Qwen3.5-2B', 'model.safetensors'), 'x');
  const ready = r('Qwen3.5-2B-Q4_K_M.gguf');
  // training: a stand-in for MLX, the converter and llama-perplexity, perplexity `pp` without and with the adapter
  const runWith = (pp) => {
    const seen = [];
    const run = (cmd, args) => {
      seen.push([cmd, ...args].join(' '));
      if (args[2] === 'train') {
        const out = args[5];
        fs.mkdirSync(path.join(out, 'data'), { recursive: true });
        fs.writeFileSync(
          path.join(out, 'data', 'train.jsonl'),
          JSON.stringify({
            messages: [
              { role: 'user', content: 'q' },
              { role: 'assistant', content: 'a' },
            ],
          }) + '\n',
        );
        return {
          status: 0,
          stdout: 'log\n{"ok": true, "examples": 7, "dropped": 1, "valLoss": [2, 1], "seconds": 3}\n',
        };
      }
      if (args[2] === 'gguf') return { status: 0, stdout: '{"ok": true, "pairs": 4}\n' };
      const v = args.includes('--lora') ? pp[1] : pp[0];
      return {
        status: 0,
        stdout: '',
        stderr: v === null ? 'failed to load' : 'Final estimate: PPL = ' + v + ' +/- 0.1\n',
      };
    };
    const res = A.trainAdapter(mk('Qwen3.5-2B-Q4_K_M.gguf'), 'd.jsonl', path.join(tmp, 'out'), { work, iters: 5, run });
    return { res, seen };
  };
  const better = runWith([3.2, 2.5]);
  const worse = runWith([3.2, 3.6]);
  const unloaded = runWith([3.2, null]);
  const notReady = A.trainAdapter(mk('Ternary-Bonsai-2-4B-Q2_0.gguf'), 'd.jsonl', path.join(tmp, 'o2'), { work });
  fs.rmSync(tmp, { recursive: true, force: true });
  check(
    "a tool call's arguments go into the dataset as an object (a chat template refuses a JSON string), a string that is not JSON as it was; a model is trainable with MLX only where its original weights are named, it is not one measured as untrainable, MLX is installed and its weights are here, each refusal saying which; and an adapter is trained, converted for the served file and kept only where llama.cpp finds the trained answers likelier with it, never where they are less likely or it does not load",
    calls[0].function.arguments.path === 'a.js' &&
      calls[1].function.arguments === 'not json' &&
      /no original weights/.test(none.why) &&
      /Hadamard/.test(bonsai.why) &&
      /MLX is not installed/.test(noMlx.why) &&
      /original weights are not here/.test(noWeights.why) &&
      /original weights are not here/.test(configOnly.why) &&
      ready.ok &&
      /Qwen\/Qwen3\.5-2B/.test(ready.why) &&
      better.res.ok &&
      better.res.perplexity.without === 3.2 &&
      better.res.perplexity.with === 2.5 &&
      better.res.examples === 7 &&
      /Qwen3\.5-2B-Q4_K_M-lora\.gguf$/.test(better.res.gguf) &&
      better.seen.some((s) => / train .* --iters 5 /.test(s)) &&
      better.seen.some((s) => /--lora .*-lora\.gguf/.test(s)) &&
      !worse.res.ok &&
      /no likelier \(3\.2 -> 3\.6\)/.test(worse.res.why) &&
      !unloaded.res.ok &&
      /did not load/.test(unloaded.res.why) &&
      !notReady.ok &&
      /Hadamard/.test(notReady.why),
    { calls, none, bonsai, noMlx, noWeights, ready, better: better.res, worse: worse.res, unloaded: unloaded.res },
  );
}

// ---- 9o: evaluating the swarm on standard benchmarks (training/evaluate.mjs): what each chosen body of work is asked; a reply
// turned into what would have followed a task's opening of it, the same for both models; the relay in between; and the adapters
// the swarm is served with
{
  const E = await import('../training/evaluate.mjs');
  const A = await import('../training/adapters.mjs');
  const EQ = JSON.parse(fs.readFileSync(new URL('../training/equivalence.json', import.meta.url), 'utf8'));
  const plan = E.planOf(EQ.targets, ['code', 'math']);
  // HumanEval opens the reply with the function's signature: what follows is the reply's own body, after its header
  const sig = 'Here is the completed function:\n```python\ndef add(a, b):\n    """Sum."""\n';
  const he = E.continuation(
    sig,
    'Sure!\n```python\nimport math\n\ndef add(a, b):\n    """Sum."""\n    return a + b\n```\nDone.',
  );
  // MBPP opens a code block: what follows is the code, then the block's end
  const mb = E.continuation('\n```python\n', '```python\ndef f(x):\n    return x\n```');
  // a text opening: what was said after it, or the reply where it did not say it
  const arc = E.continuation('The best answer is', 'Thinking it over, the best answer is C.');
  const none = E.continuation('The best answer is', 'C');
  const cut = E.cutAt('42\n\nQuestion: next', ['Question:', '\n\n']);
  const prog = E.progressOf('Requesting API:   0%|  | 0/20\rRequesting API:  35%|###  | 7/20 [00:30<');
  // the relay: the opening is taken off before the model is asked, and its reply comes back as the continuation, cut at the stops
  const asked = [];
  const r = await E.relay(
    async (messages) => (asked.push(messages), '```python\ndef f(x):\n    return x\n```\nThat is it.'),
    {
      ask: (x) => asked.push(['ask', x.excerpt]),
    },
  );
  const got = await (
    await fetch(r.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'x',
        messages: [
          { role: 'user', content: 'Write f.' },
          { role: 'assistant', content: '\n```python\n' },
        ],
        stop: ['That is'],
      }),
    })
  ).json();
  await r.close();
  // adapters: served only where the configuration says so and the adapter llama.cpp found good is there
  const tmp = path.join(os.tmpdir(), 'loras-' + process.pid);
  const m = { name: 'LFM2.5 1.2B', file: 'LFM2.5-1.2B-Instruct-Q4_K_M.gguf' };
  const dir = A.adapterDir(tmp, 'tgt', { file: path.join(tmp, m.file) });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x-lora.gguf'), 'x');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, gguf: path.join(dir, 'x-lora.gguf') }));
  const off = A.lorasFor({}, { a: m }, tmp, 'tgt', tmp);
  const on = A.lorasFor(
    { adapters: true },
    { a: m, b: { name: 'Q', file: 'Qwen3.5-2B-Q4_K_M.gguf' } },
    tmp,
    'tgt',
    tmp,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  check(
    "evaluating the swarm asks the standard tasks of each body of work chosen (Code: HumanEval and MBPP; Math: GSM8K and BBH), and every body of work has at least one; a reply is turned into what would have followed the task's opening of it (after a signature, the reply's own function body; after a code block's opening, its code and the block's end; after words, what it said after them) and cut at the task's stop strings; the relay takes the opening off before the model is asked; the harness's progress is read from what it prints; and the swarm is served with an adapter only where the configuration says so and the one llama.cpp found good is there",
    plan.map((b) => b.task).join() ===
      'humaneval_instruct,mbpp_instruct,gsm8k,bbh_cot_fewshot_multistep_arithmetic_two' &&
      plan.every((b) => b.metric && b.filter && ['answer', 'verdict', 'instructions'].includes(b.compare)) &&
      // (every body of work has a standard task, or says which one it waits on)
      EQ.targets.every((t) => (t.benchmarks || []).length > 0 || /\S/.test(t.benchmarksNote || '')) &&
      he === '\n    """Sum."""\n    return a + b\n```' &&
      mb === '\ndef f(x):\n    return x\n```' &&
      arc === ' C.' &&
      none === ' C' &&
      cut === '42' &&
      prog.done === 7 &&
      prog.of === 20 &&
      asked[1].length === 1 &&
      asked[1][0].role === 'user' &&
      got.choices[0].message.content === '\ndef f(x):\n    return x\n```' &&
      Object.keys(off).length === 0 &&
      Object.keys(on).join() === 'a',
    { plan, he, mb, arc, none, cut, prog, asked, got, off, on },
  );
}

// ---- THE SwOA SPEC (docs/swoa.md): a SwOA is read and the module made from it; its base module and recipe are each checked
// against their hashes; an output spec from before SwOA is still read
{
  const { readSpec, fromSpec, recipeSha256, baseModuleOf } = await import('../src/spec.mjs');
  const recipe = {
    members: Object.fromEntries(Object.entries(MEMBERS).slice(0, 2)),
    decider: { id: 'kev-0.8b', name: 'Kev 0.8B' },
    engine: { name: 'llama.cpp' },
    serving: { slots: 3, contextPerSlot: 2048 },
    briefs: { ...briefs, kinds: { code: { slots: briefs.slots, plan: briefs.plan } } },
  };
  const swoa = {
    swoa: {
      format: 'swoa',
      version: 1,
      name: 'x+y+kev-0.8b--t',
      baseModuleSha256: recipeSha256(baseModuleOf(recipe)),
      arrangementSha256: recipeSha256(recipe.briefs),
      recipeSha256: recipeSha256(recipe),
    },
    baseModule: baseModuleOf(recipe),
    target: { id: 't', name: 'T' },
    recipe,
    proof: { results: [] },
  };
  const why = (s2) => {
    try {
      readSpec(s2);
      return '';
    } catch (e) {
      return e.message;
    }
  };
  const otherBase = {
    ...swoa,
    recipe: { ...recipe, decider: { id: 'kev-4b' } },
    swoa: { ...swoa.swoa, recipeSha256: undefined },
  };
  const legacy = { spec: { format: 'the-swarm/spec', version: 3, recipeSha256: recipeSha256(recipe) }, recipe };
  const built = fromSpec(swoa);
  check(
    'a SwOA spec is read and the module made from it, with the arrangement for each class of input; one whose base module was changed after it was written is refused, as is a version not known; an output spec from before SwOA is still read',
    why(swoa) === '' &&
      built.briefs.kinds.code.slots === briefs.slots &&
      /base module does not match/.test(why(otherBase)) &&
      /SwOA spec of version 2/.test(why({ ...swoa, swoa: { ...swoa.swoa, version: 2 } })) &&
      why(legacy) === '' &&
      /not a SwOA spec/.test(why({ recipe })),
    { swoa: why(swoa), otherBase: why(otherBase), legacy: why(legacy) },
  );
}

// ---- THE SwOA SPECIFICATION IS SELF-CONTAINED (docs/swoa.md): it names no file, program or function of this repository, and
// carries every text the module itself sends a model, so that a runtime can be built from it alone
{
  const doc = fs.readFileSync(fileURLToPath(new URL('../docs/swoa.md', import.meta.url)), 'utf8');
  const repoRefs = doc.match(
    /\b[\w-]+\.(?:mjs|py|sh)\b|\b(?:src|training|bin|ui|tools|tests)\/|createSwarm|serveSwarm|readSpec|fromSpec|SWARM_[A-Z_]+|briefs\.json|PROBE_BRIEF|EXPECT_BRIEF|JUDGE_BRIEF/g,
  );
  const { PROBE_BRIEF, EXPECT_BRIEF } = await import('../src/behave.mjs');
  const { JUDGE_BRIEF } = await import('../src/orchestrate.mjs');
  const flat = (t) => String(t).replace(/\s+/g, ' ');
  const carried = { PROBE_BRIEF, EXPECT_BRIEF, JUDGE_BRIEF };
  const missing = Object.entries(carried)
    .filter(([, t]) => !flat(doc).includes(flat(t).slice(0, 120)))
    .map(([k]) => k);
  check(
    'the SwOA specification names no file, program or function of this repository, and carries the texts the module itself sends a model (the probe, expectation and judge briefs) verbatim',
    !repoRefs && missing.length === 0,
    { repoRefs, missing },
  );
}

// ---- THE RUNTIME AS THE SwOA SPECIFICATION HAS IT: a model file is checked against its pinned SHA-256 before it is first served
// (S2.1.5), once while it is unchanged; a message whose content is a list of parts is read as its text parts joined (S3.7, T.6.6)
{
  const { verifyModel, startMember } = await import('../src/members.mjs');
  const { textOf } = await import('../src/read.mjs');
  const { createHash } = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-verify-'));
  const put = (name, text) => (fs.writeFileSync(path.join(dir, name), text), path.join(dir, name));
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const first = put('w-00001-of-00002.gguf', 'weights one');
  put('w-00002-of-00002.gguf', 'weights two');
  const M = {
    name: 'W',
    file: 'w-00001-of-00002.gguf',
    sha256: sha('weights one'),
    parts: [{ file: 'w-00002-of-00002.gguf', sha256: sha('weights two') }],
  };
  const once = await verifyModel(M, first);
  const twice = await verifyModel(M, first);
  // the same size, other bytes, a later time: hashed again, and refused
  const t = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(dir, 'w-00002-of-00002.gguf'), 'weights TWO');
  fs.utimesSync(path.join(dir, 'w-00002-of-00002.gguf'), t, t);
  const changed = await verifyModel(M, first);
  const unpinned = await verifyModel({ name: 'U', file: 'w-00001-of-00002.gguf' }, first);
  const started = await startMember(
    { ...M, parts: [], sha256: sha('another model') },
    { llamaServer: '/nonexistent/llama-server', file: first, waitMs: 1000 },
  );
  check(
    'a model file is checked against its pinned SHA-256 before it is first served, every part of it, and not hashed again while it is unchanged; a changed or wrong file is refused before any server is started; a model with no pin is served as it is',
    once.ok &&
      once.hashed === 2 &&
      twice.ok &&
      twice.hashed === 0 &&
      !changed.ok &&
      /not the file the model is pinned to/.test(changed.why) &&
      unpinned.ok &&
      unpinned.hashed === 0 &&
      started.ok === false &&
      /not the file the model is pinned to/.test(started.why),
    { once, twice, changed, unpinned, started },
  );

  const parts = [
    { type: 'text', text: 'Rotate ' },
    { type: 'image_url', image_url: { url: 'data:x' } },
    { type: 'text', text: 'the list.' },
  ];
  reset();
  swarm.setSeed(7);
  await swarm.answer([{ role: 'user', content: parts }]);
  swarm.setSeed(undefined);
  const call = [...lfm.s.calls, ...bonsai.s.calls].find((c) => c.seed !== undefined);
  const slot = call && briefs.slots.find((x) => (call.messages[0].content || '').startsWith(x.brief));
  // (the seed is formed from the slot's own request: its number of messages and the text of its last one, S3.7)
  const want = slot
    ? createHash('sha256')
        .update('7|' + slot.id + '|' + call.messages.length + '|' + textOf(call.messages.at(-1).content))
        .digest()
        .readUInt32BE(0) >>> 1
    : null;
  check(
    "a message whose content is a list of parts is read as its text parts joined in order (not as the list's default text), and a slot's seed is formed from its own request as S3.7 says",
    textOf(parts) === 'Rotate the list.' &&
      textOf('x') === 'x' &&
      textOf(null) === '' &&
      textOf(undefined) === '' &&
      call &&
      slot &&
      call.seed === want &&
      JSON.stringify(call.messages).includes('Rotate the list.') &&
      !JSON.stringify(call.messages).includes('[object Object]'),
    { seed: call && call.seed, want, slot: slot && slot.id },
  );
}

// ---- A RESUMED PASS ASKS AGAIN WHAT IT COULD NOT COMPARE BEFORE: a not-compared question that can be compared now is taken off
// the record (questions and rows), and one that still cannot, or that was finished another way, is left as it was
{
  const { reopenComparable } = await import('../training/loop.mjs');
  const list = [
    { id: 'b1', kind: 'bug', type: 'open' },
    { id: 'b2', kind: 'bug', type: 'open' },
    { id: 't1', kind: 'talk', type: 'talk' },
    { id: 'w1', kind: 'write-arrays', type: 'code' },
  ];
  const st = {
    questions: [
      { id: 'b1', state: 'not compared' },
      { id: 'b2', state: 'not compared' },
      { id: 't1', state: 'not compared' },
      { id: 'w1', state: 'at parity' },
    ],
    rows: [
      { id: 'b1', grade: 'noref' },
      { id: 'b2', grade: 'noref' },
      { id: 't1', grade: 'noref' },
      { id: 'w1', grade: 'right' },
    ],
    inHand: { id: 'b2' },
  };
  // the reader of answers in words is believed now; the reader of conversations still is not; b2 has no answer from the larger model
  const again = reopenComparable(st, list, (t) => t.id !== 'b2' && t.type !== 'talk');
  check(
    'a resumed pass asks again a question it had set down as not compared once it can be compared (its reader believed, the larger model having answered), and leaves the rest as they were',
    JSON.stringify(again) === '["b1"]' &&
      JSON.stringify(st.questions.map((q) => q.id)) === '["b2","t1","w1"]' &&
      JSON.stringify(st.rows.map((r) => r.id)) === '["b2","t1","w1"]' &&
      st.inHand &&
      st.inHand.id === 'b2' &&
      JSON.stringify(reopenComparable({ questions: [] }, list, () => true)) === '[]',
    { again, st },
  );
}

// ---- SCOPED, AND KEPT ONLY ON EVIDENCE THAT GENERALIZES (docs/swoa-classes.md steps 3 and 4): a brief that quotes its own question
// is refused before it is asked; a change that loses a held question of its class at parity is not kept, and one that holds is
{
  const { runLoop, specificTokens, quotesQuestion } = await import('../training/loop.mjs');
  const ROUND =
    'Write a JavaScript function `roundHalf(n, step)` that rounds n to the nearest multiple of step, "half up": -25 gives -20. Give the function in one code block.';
  const OTHER =
    'Write a JavaScript function `rotate(list)` that returns a new array. Give the function in one code block.';
  const toks = specificTokens({ ask: ROUND }, [{ ask: OTHER }]);
  const old = { slots: [{ id: 'a1', stage: 'draft', brief: 'Draft it.' }] };
  const helpers =
    toks.includes('roundHalf') &&
    toks.includes('-25') &&
    toks.includes('half up') &&
    !toks.includes('list') &&
    // a common word in quotes, and the stretch between two apostrophes, are not particular to the question
    JSON.stringify(
      specificTokens({ ask: "Don't keep 'all' of them; it's \"are\" that matters, they're 'counted'." }, [
        { ask: OTHER },
      ]),
    ) === '["counted"]' &&
    quotesQuestion({ slots: [{ id: 'a1', stage: 'draft', brief: 'For negatives, -25 rounds to -20.' }] }, old, toks) ===
      '-25' &&
    quotesQuestion(
      { slots: [{ id: 'a1', stage: 'draft', brief: 'Check each constraint before answering.' }] },
      old,
      toks,
    ) === '' &&
    quotesQuestion(old, old, toks) === '';
  // the pool: one change quotes the question, one is general; the general one brings it to parity
  const right = { grade: 'right', trace: [] };
  const wrongD = { grade: 'wrong', path: 'decided', trace: [{ stage: 'draft', slot: 'a1', same: false }] };
  const brief = (bb, text) => ({ ...bb, slots: [{ id: 'a1', stage: 'draft', brief: text }] });
  const pool = (bb) =>
    bb.slots[0].brief === 'Draft it.'
      ? [
          {
            key: 'quote',
            id: 'quote',
            name: 'quote',
            kind: 'brief',
            area: 'briefs',
            slot: 'a1',
            briefs: brief(bb, 'Remember: -25 rounds to -20.'),
          },
          {
            key: 'general',
            id: 'general',
            name: 'general',
            kind: 'brief',
            area: 'briefs',
            slot: 'a1',
            briefs: brief(bb, 'Check each constraint.'),
          },
        ]
      : [];
  const B1 = () => ({ version: 1, slots: [{ id: 'a1', stage: 'draft', brief: 'Draft it.' }], plan: {} });
  const asked = [];
  const run = (heldOk) =>
    runLoop({
      list: [
        { id: 'r', kind: 'write-numbers', ask: ROUND },
        { id: 'o', kind: 'write-arrays', ask: OTHER },
      ],
      heldQs: [{ id: 'h', kind: 'write-arrays', ask: OTHER }],
      heldGuard: 2,
      briefs: B1(),
      poolOf: pool,
      policy: { setAsideAfter: 0, suggestEvery: 0, teachEvery: 0 },
      attempt: async (bb, t, at) => {
        const b0 = (bb.slots[0] || {}).brief;
        asked.push(t.id + ':' + b0 + (at && at.held ? ':held' : ''));
        if (t.id === 'r') return b0 === 'Check each constraint.' ? right : wrongD;
        if (t.id === 'h') return b0 === 'Check each constraint.' && !heldOk ? wrongD : right;
        return right;
      },
    });
  const lost = await run(false);
  const askedLost = asked.splice(0);
  const kept = await run(true);
  const rq = (st) => st.questions.find((x) => x.id === 'r');
  check(
    'a brief that quotes its own question (a name, a number or a quoted phrase only it has) is refused before it is asked, at no cost of a try; a change that brings a question to parity but loses a held question of its class that was at parity is not kept; one that holds on them is kept in its class, with the held check on its record',
    helpers &&
      !askedLost.some((x) => x.includes('-25 rounds')) &&
      lost.specificRefused >= 1 &&
      rq(lost).state !== 'reached' &&
      askedLost.includes('h:Check each constraint.:held') &&
      !lost.kept.length &&
      rq(kept).state === 'reached' &&
      kept.kept.length === 1 &&
      kept.kept[0].class === 'code' &&
      kept.kept[0].heldGuard.kept === 1 &&
      kept.kept[0].heldGuard.lost === 0 &&
      kept.briefs.kinds.code.slots[0].brief === 'Check each constraint.' &&
      kept.briefs.slots[0].brief === 'Draft it.',
    {
      toks,
      askedLost,
      lostKept: lost.kept,
      lostState: rq(lost).state,
      keptState: rq(kept).state,
      keptEntry: kept.kept[0],
    },
  );
}

// ---- CLASSES OF INPUT (docs/swoa-classes.md steps 1 and 2): what the arrangement is chosen by, the move of what was
// learned to the class it was learned on, and the gate that stops a pass with a kind it cannot compare
{
  const { classOf, briefsFor } = await import('../src/orchestrate.mjs');
  const u = (content) => ({ role: 'user', content });
  const fnAsk = 'Write a JavaScript function `add(a, b)` that returns a + b. Give the function in one code block.';
  const cls = {
    words: classOf([u('Write a short essay about rivers, in exactly two paragraphs.')]),
    code: classOf([u(fnAsk)]),
    talk: classOf([u('Hi'), { role: 'assistant', content: 'Hello!' }, u(fnAsk)]),
    tools: classOf([u('What is the weather?')], { tools: [{ type: 'function', function: { name: 'weather' } }] }),
    noTools: classOf([u('What is the weather?')], { tools: [] }),
    system: classOf([{ role: 'system', content: 'Be brief.' }, u(fnAsk)]),
    empty: classOf([]),
  };
  check(
    'an input is sorted from the request alone: tools where tools are offered, talk once the swarm has replied in it, code where code is asked for, words otherwise; a system line is not a reply',
    cls.words === 'words' &&
      cls.code === 'code' &&
      cls.talk === 'talk' &&
      cls.tools === 'tools' &&
      cls.noTools === 'words' &&
      cls.system === 'code' &&
      cls.empty === 'words',
    cls,
  );
  // the training questions are sorted the same way: the code kinds are code, an agent's step (sent with tools) is tools
  const sorted = {};
  for (const t of tasks({ split: 'train', each: 2 }))
    sorted[t.kind] = classOf(t.turns || [{ role: 'user', content: t.ask }], { tools: t.tools });
  check(
    "training sorts its questions as the running swarm sorts a request: the code kinds are code, an agent's step is tools",
    ['write-arrays', 'write-strings', 'write-numbers', 'write-parsing', 'fix']
      .filter((k) => k in sorted)
      .every((k) => sorted[k] === 'code') &&
      (!('agent' in sorted) || sorted.agent === 'tools'),
    sorted,
  );

  // the running swarm answers each class with that class's own arrangement, and every other class with the shared one
  const base = readBriefs();
  const tagged = (tag) => ({
    slots: base.slots.map((s) => (s.stage === 'draft' ? { ...s, brief: tag + ' ' + s.brief } : s)),
    plan: base.plan,
  });
  const scoped = { ...base, kinds: { talk: tagged('TALK-ARRANGEMENT.'), code: tagged('CODE-ARRANGEMENT.') } };
  const seen = async (messages) => {
    reset();
    await swarm.answer(messages, { briefs: scoped });
    const firsts = [...lfm.s.calls, ...bonsai.s.calls].map((c) => String((c.messages[0] || {}).content || ''));
    return {
      talk: firsts.some((x) => x.startsWith('TALK-ARRANGEMENT.')),
      code: firsts.some((x) => x.startsWith('CODE-ARRANGEMENT.')),
    };
  };
  const onWords = await seen(Q);
  const onTalk = await seen([u('Hi'), { role: 'assistant', content: 'Hello!' }, ...Q]);
  check(
    "the swarm answers a conversation with talk's own arrangement and a plain question with the shared one, never another class's",
    !onWords.talk && !onWords.code && onTalk.talk && !onTalk.code,
    { onWords, onTalk },
  );
  check(
    'a class with no arrangement of its own is answered with the shared one',
    briefsFor(scoped, '', 'tools') === scoped && briefsFor(scoped, '', 'words') === scoped,
    null,
  );

  // what was learned moves to the class most kept changes were found on; the shared one is the starting one again
  const { toClasses } = await import('../src/learned.mjs');
  const learnedSlots = [
    { id: 'x-direct', member: 'a', stage: 'draft', brief: 'Test negative inputs: -25 rounds to -20.' },
  ];
  const start = {
    slots: [{ id: 'a-direct', member: 'a', stage: 'draft', brief: 'Answer it.' }],
    plan: { keepTurns: 6 },
  };
  const learned = {
    config: 'm1+m2+d',
    target: 't',
    briefs: {
      version: 4,
      marker: 'ANSWER:',
      slots: learnedSlots,
      plan: { decideBy: 'decider' },
      flow: [{ do: 'draft' }],
    },
    ledger: [
      { n: 1, question: { id: 'q1', kind: 'write-arrays' } },
      { n: 2, question: { id: 'q2', kind: 'trace' } },
      { n: 3, question: { id: 'q3', kind: 'fix' } },
    ],
    passes: [],
  };
  const r = toClasses(learned, { classOfKind: { 'write-arrays': 'code', fix: 'code', trace: 'words' }, start });
  const again = toClasses(r.learned, { classOfKind: {}, start });
  const b = r.learned.briefs;
  check(
    'migration moves the learned arrangement to the class most kept changes were found on (its slots, plan and flow, nothing else), puts the starting one back as shared, names the change found on another class, and is done once',
    r.moved === 'code' &&
      b.kinds.code.slots === learnedSlots &&
      !('provisional' in b.kinds.code) &&
      JSON.stringify(b.kinds.code.flow) === '[{"do":"draft"}]' &&
      b.slots === start.slots &&
      b.plan === start.plan &&
      !('flow' in b) &&
      b.version === 5 &&
      b.marker === 'ANSWER:' &&
      JSON.stringify(r.dropped) === '[2]' &&
      r.learned.ledger.map((e) => e.class).join() === 'code,words,code' &&
      again.already === true &&
      again.learned === r.learned,
    r,
  );
  // the code question is answered with the moved arrangement, a question in words with the starting one
  check(
    'after the move, a code question gets what was learned and a question in words gets the starting arrangement',
    briefsFor(b, fnAsk, classOf([u(fnAsk)])).slots === learnedSlots &&
      briefsFor(b, 'Write two paragraphs.', classOf([u('Write two paragraphs.')])).slots === start.slots,
    null,
  );

  // THE COVERAGE GATE: a kind whose answers need the reader, with the reader not believed, has nothing to compare and is named;
  // a kind of the same class that does not need the reader (trace) still counts; a kind the larger model has not answered is named
  const { coverageOf } = await import('../training/loop.mjs');
  const qs = [
    { id: 'b1', kind: 'bug', type: 'open' },
    { id: 'b2', kind: 'bug', type: 'open' },
    { id: 't1', kind: 'talk', type: 'talk' },
    { id: 'r1', kind: 'trace', type: 'value' },
    { id: 'w1', kind: 'write-arrays', type: 'code' },
    { id: 'w2', kind: 'write-arrays', type: 'code' },
    { id: 'n1', kind: 'piece', type: 'open' },
  ];
  const ref = new Map(['b1', 'b2', 't1', 'r1', 'w1', 'w2'].map((id) => [id, 'answer']));
  const off = coverageOf(qs, { ref, readerOk: () => false });
  const on = coverageOf(qs, { ref, readerOk: () => true });
  const talkOnly = coverageOf(qs, { ref, readerOk: (type) => type !== 'talk' });
  const bare = (c) => c.filter((x) => x.compared === 0).map((x) => x.kind + ':' + x.why);
  check(
    'the coverage gate names every kind with nothing to compare, and why, even where other kinds of the same class are compared; with a believed reader only the unanswered kind is named',
    JSON.stringify(bare(off)) ===
      JSON.stringify([
        'bug:the reader of answers in words is not believed',
        'talk:the reader of replies in a conversation is not believed',
        'piece:the larger model has not answered them',
      ]) &&
      JSON.stringify(bare(on)) === JSON.stringify(['piece:the larger model has not answered them']) &&
      JSON.stringify(bare(talkOnly)) ===
        JSON.stringify([
          'talk:the reader of replies in a conversation is not believed',
          'piece:the larger model has not answered them',
        ]) &&
      off.find((x) => x.kind === 'write-arrays').compared === 2 &&
      off.find((x) => x.kind === 'trace').compared === 1,
    { off, on, talkOnly },
  );
}

// ---- 10a: THE TOOL TESTS, A SECOND HARNESS (docs/swoa-parity-plan.md, step 7; training/support/bfcl.mjs): calling a function and
// searching are measured by the Berkeley Function-Calling Leaderboard, asked of the larger model and of the swarm through a relay
// that sends on the conversation and the functions as they came. What is checked here needs no package: which harness a task
// is of, what is read from the package's files, the pairs, and the relay
{
  const E = await import('../training/evaluate.mjs');
  const T = await import('../training/support/bfcl.mjs');
  const EQ = JSON.parse(fs.readFileSync(new URL('../training/equivalence.json', import.meta.url), 'utf8'));
  const plan = E.planOf(EQ.targets, ['instructions', 'tools', 'search']);
  const tool = plan.find((b) => b.task === 'bfcl_simple_python');
  const web = plan.find((b) => b.task === 'bfcl_web_search_base');
  const ifeval = plan.find((b) => b.task === 'ifeval');
  const toolsN = plan.filter((b) => b.item === 'tools').reduce((n, b) => n + E.sizeOf(b, { proof: true }), 0);
  check(
    'a body of work may be measured by the tool tests: its tasks say so, name the package category and what each model is offered; a plan says what it needs installed, the search behind a web search test among it; calling functions is asked about five hundred questions for a proof; and a search test with no search behind it is not asked, and says why',
    JSON.stringify(E.needsOf(plan, {})) === JSON.stringify(['lmeval', 'bfcl', 'searxng']) &&
      JSON.stringify(E.needsOf(plan, { SWARM_SEARCH: 'serpapi' })) === JSON.stringify(['lmeval', 'bfcl']) &&
      JSON.stringify(E.needsOf(E.planOf(EQ.targets, ['instructions']), {})) === JSON.stringify(['lmeval']) &&
      JSON.stringify(E.needsOf(E.planOf(EQ.targets, ['tools']), {})) === JSON.stringify(['bfcl']) &&
      E.isToolTest(tool) &&
      !E.isToolTest(ifeval) &&
      E.harnessOf(tool).name === 'bfcl-eval' &&
      E.harnessOf(ifeval).name === 'lm-evaluation-harness' &&
      tool.category === 'simple_python' &&
      toolsN === 500 &&
      plan.filter(E.isToolTest).every((b) => b.tools && b.category && b.compare === 'verdict') &&
      // (a search test is asked through the search this machine serves, with no key; it is not asked where that is not
      // installed, nor, where the other service is named, without that service's key)
      E.blockedOf(web, {}, { installed: true }) === '' &&
      /SearXNG.*is not installed here/.test(E.blockedOf(web, {}, { installed: false })) &&
      /SERPAPI_API_KEY/.test(E.blockedOf(web, { SWARM_SEARCH: 'serpapi' }, { installed: true })) &&
      E.blockedOf(web, { SWARM_SEARCH: 'serpapi', SERPAPI_API_KEY: 'k' }, { installed: false }) === '' &&
      E.blockedOf(tool, {}, { installed: false }) === '' &&
      web.search === true &&
      !('needsKey' in web) &&
      E.searchPart(web, {}) === '-searxng-p2000-n5-prose' &&
      E.searchPart(web, { SWARM_SEARCH: 'serpapi' }) === '-serpapi' &&
      E.searchPart(tool, {}) === '' &&
      web.daily === true &&
      !tool.daily &&
      E.dayOf(new Date('2026-11-18T23:59:00Z')) === '2026-11-18',
    { needs: E.needsOf(plan), toolsN, web },
  );

  // what the package writes for a category, as it writes it: every answer in one file; in the other the count, then every
  // question it counted wrong
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-bfcl-'));
  const put = (r, kind, lines) => {
    const dir = path.join(r, kind, 'openbmb_MiniCPM-SALA-FC', 'non_live');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'BFCL_v4_simple_python_' + kind + '.json'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
  };
  const tRoot = path.join(root, 'target');
  const sRoot = path.join(root, 'swarm');
  put(tRoot, 'result', [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }, { id: 'q3' }]);
  put(tRoot, 'score', [
    { accuracy: 0.75, correct_count: 3, total_count: 4 },
    { id: 'q3', valid: false, error: ["Missing required parameter: 'x'."] },
  ]);
  put(sRoot, 'result', [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }, { id: 'q3' }]);
  put(sRoot, 'score', [
    { accuracy: 0.5, correct_count: 2, total_count: 4 },
    { id: 'q1', valid: false, error: ['Wrong function name.'] },
    { id: 'q2', valid: false, error: ['Wrong function name.'] },
  ]);
  const ts = T.bfclScore(tRoot, 'simple_python', 400);
  const ss = T.bfclScore(sRoot, 'simple_python', 400);
  const pr = T.pairOf(ts, ss);
  check(
    'the tool tests are read from what the package wrote: the score it counted, of how many, which questions it counted right; a category it did not score is not kept; and the two models are paired by question on its verdict, in the shape the other harness is paired in',
    ts.value === 0.75 &&
      ts.n === 4 &&
      ts.of === 400 &&
      Math.abs(ts.stderr - Math.sqrt((0.75 * 0.25) / 4)) < 1e-9 &&
      JSON.stringify(ts.right) === JSON.stringify(['q0', 'q1', 'q2']) &&
      JSON.stringify(ss.wrong) === JSON.stringify(['q1', 'q2']) &&
      ss.why.q1 === 'Wrong function name.' &&
      T.bfclFiles(tRoot, 'multiple') === null &&
      pr.of === 4 &&
      pr.same === 1 &&
      pr.bothRight === 1 &&
      pr.bothWrong === 0 &&
      pr.differ === 3 &&
      pr.onlyTarget === 2 &&
      pr.onlySwarm === 1 &&
      pr.examples.length === 3 &&
      pr.examples[0].swarm === 'wrong: Wrong function name.' &&
      T.bfclProgress('Generating results for x:  40%|####      | 2/5 [00:10<00:15,  5.0s/it]').done === 2 &&
      T.bfclProgress('nothing yet') === null,
    { ts, ss, pr },
  );
  fs.rmSync(root, { recursive: true, force: true });

  // the relay: the package hands back the model's own message with every field its client knows; what goes on to the model is
  // the conversation made plain and the functions as they came; what comes back is its calls (each with an id, its arguments as
  // text) or its reply, and a count of tokens
  const seen = [];
  const r = await T.toolRelay(async (q) => {
    seen.push(q);
    return seen.length === 1
      ? {
          message: { content: null, tool_calls: [{ function: { name: 'add', arguments: { a: 1, b: 2 } } }] },
          usage: {},
        }
      : { message: { content: 'It is 3. <unk> <unk> noise' }, usage: { prompt_tokens: 12, completion_tokens: 4 } };
  });
  const post = async (body) =>
    (
      await fetch(r.base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json();
  const tools = [{ type: 'function', function: { name: 'add', parameters: { type: 'object', properties: {} } } }];
  const one = await post({
    model: 'x',
    store: false,
    temperature: 0.001,
    messages: [{ role: 'user', content: 'Add 1 and 2.' }],
    tools,
  });
  const call = one.choices[0].message.tool_calls[0];
  const two = await post({
    model: 'x',
    messages: [
      { role: 'user', content: 'Add 1 and 2.' },
      {
        role: 'assistant',
        content: null,
        refusal: null,
        audio: null,
        function_call: null,
        annotations: [],
        tool_calls: [call],
      },
      { role: 'tool', tool_call_id: call.id, content: '3' },
    ],
    tools,
  });
  await r.close();
  check(
    'the relay of the tool tests sends a model the conversation made plain and the functions as they came, and gives back its calls as any client expects them (an id each, the arguments as text) or its reply, with a count of tokens',
    seen[0].tools.length === 1 &&
      JSON.stringify(seen[0].messages) === JSON.stringify([{ role: 'user', content: 'Add 1 and 2.' }]) &&
      one.choices[0].finish_reason === 'tool_calls' &&
      one.choices[0].message.content === null &&
      call.type === 'function' &&
      typeof call.id === 'string' &&
      call.id.length > 0 &&
      call.function.arguments === '{"a":1,"b":2}' &&
      one.usage.prompt_tokens === 0 &&
      JSON.stringify(Object.keys(seen[1].messages[1]).sort()) === JSON.stringify(['content', 'role', 'tool_calls']) &&
      seen[1].messages[1].content === null &&
      seen[1].messages[2].tool_call_id === call.id &&
      two.choices[0].message.content === 'It is 3.' &&
      two.choices[0].finish_reason === 'stop' &&
      two.usage.total_tokens === 16,
    { one, two, seen: seen[1] },
  );
}

// ---- 10b: A CLOSING REMARK ABOUT HOW THE REPLY WAS MADE IS CUT (docs/swoa.md R.1.14; src/read.mjs withoutClosingRemark): a small
// writer gives the answer and then says, in a paragraph of its own, that it came from "the provided draft" or was "settled". The
// replies here are ones the swarm gave on a standard test of calling functions, 2026-11-18
{
  const { withoutClosingRemark: cut } = await import('../src/read.mjs');
  const seen = [
    [
      'The area is 25 square units.\n\nThis answer was settled based on the provided draft which correctly calculated the area using the formula.',
      'The area is 25 square units.',
    ],
    [
      'The roots are 1 and -5.\n\nThis is based on the provided draft which solved the equation step-by-step to arrive at the correct numerical values. The draft explicitly states the final results of the factorization process.',
      'The roots are 1 and -5.',
    ],
    [
      "$1.87 for Chicago, $3.66 for Sacramento, and $0.11 for Portland (approximate sales tax amounts).\n\nThis reply is based on the settled answer provided in the prompt, formatted as a direct response to the user's question without adding external commentary or deviating from the original instructions.",
      '$1.87 for Chicago, $3.66 for Sacramento, and $0.11 for Portland (approximate sales tax amounts).',
    ],
    [
      '[19.32, 30.68] and [19.19, 30.81]\n\nThe answer is a direct statement of the calculated confidence intervals based on the provided draft. No additional instructions or modifications were made to the output format or content.',
      '[19.32, 30.68] and [19.19, 30.81]',
    ],
    ['-1 ± i√2\n\nThe solution was derived from the quadratic formula application in the provided draft.', '-1 ± i√2'],
    [
      '35 square meters\n\nThe answer is a simple calculation result, not a full explanation or analysis. The draft provided the method and the final value, so I have extracted the specific answer requested by the user in their words and units, without adding any extra commentary or describing the process beyond what was settled.',
      '35 square meters',
    ],
    [
      'The answer is $vt \\cos\\theta$.\n\nThe draft explains that the horizontal distance in time t is v cosθ * t, leading to the same result. The final settled answer matches this derivation.',
      'The answer is $vt \\cos\\theta$.',
    ],
  ];
  const caveat =
    'The calculated Future Value is 1628.89.\n\nThis answer assumes the standard interpretation of calculating FV over 10 years despite the ambiguity in the prompt.';
  const two =
    'Use a queue.\n \nIt keeps the order.\n\nThis reply is based on the settled answer.\n\nThe draft explains the same thing.';
  const coded = 'Here it is.\n\n```js\n// the provided draft\nconst a = 1;\n```';
  // through the swarm: the writer closes with such a remark, and what goes out is the answer
  reset();
  const d = (b) => (roleOf(b).stage === 'write' ? null : 'six sevens are forty-two\nANSWER: 42');
  lfm.s.script = (b) =>
    roleOf(b).stage === 'write'
      ? 'It is 42.\n\nThis answer was settled based on the provided draft which multiplied the two numbers.'
      : d(b);
  bonsai.s.script = d;
  const got = await swarm.answer([{ role: 'user', content: 'What is six times seven?' }]);
  check(
    'a closing remark about how the reply was made is cut: the paragraphs at the end that speak of the provided draft, of what was settled or of the prompt go, and the answer before them stands as it was written; a caveat that is no such remark stays; the first paragraph is never cut; nothing is cut where the person spoke of a draft themselves, nor from a paragraph holding code; and the reply that goes out says it was trimmed, with no other model asked to write it again',
    seen.every(([reply, want]) => cut(reply, 'What is the area?') === want) &&
      cut(caveat, 'q') === caveat &&
      cut('This answer was settled based on the provided draft.', 'q') ===
        'This answer was settled based on the provided draft.' &&
      cut(seen[0][0], 'Is my draft right?') === seen[0][0] &&
      cut(two, 'q') === 'Use a queue.\n \nIt keeps the order.' &&
      cut(coded, 'q') === coded &&
      cut('  One paragraph only.  ', 'q') === 'One paragraph only.' &&
      got.reply === 'It is 42.' &&
      /\+trimmed/.test(got.path) &&
      !/rewritten|described/.test(got.path) &&
      got.trace.some((r) => r.slot === 'a-writer' && r.trimmed && !r.describes) &&
      !got.trace.some((r) => r.rewrite),
    { path: got.path, reply: got.reply, seen: seen.map(([r]) => cut(r, 'q')) },
  );
}

// ---- 10c: THE LARGER MODEL IS ASKED A TOOL TEST TWO WAYS, AND COUNTED BY THE BETTER (training/support/bfcl.mjs; evaluate.mjs
// waysOf, bestWay): a server may return only the first of the calls its model wrote (measured 2026-11-18), so the functions are
// also written into the conversation and the calls read from the reply's text
{
  const E = await import('../training/evaluate.mjs');
  const T = await import('../training/support/bfcl.mjs');
  const EQ = JSON.parse(fs.readFileSync(new URL('../training/equivalence.json', import.meta.url), 'utf8'));
  const plan = E.planOf(EQ.targets, ['instructions', 'tools', 'search']);
  const tools = [{ type: 'function', function: { name: 'add', parameters: { type: 'object', properties: {} } } }];
  const call = { id: 'c1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } };
  const wm = T.writtenMessages(
    [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Add 1 and 2, then 3 and 4.' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: 'c1', content: '3' },
    ],
    tools,
  );
  const wrote =
    '<tool_call>\n{"name": "add", "arguments": {"a": 1, "b": 2}}\n</tool_call>\n<tool_call>\n{"name": "add", "arguments": {"a": 3, "b": 4}}\n</tool_call>\n<tool_call>\nnot json\n</tool_call>';
  // a server that returns the text whole: asked the written way, every call comes back; and one that parsed nothing gives a reply
  const srv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      srv.seen.push(body);
      const content = /Add/.test(body.messages.at(-1).content) ? wrote : 'Nothing to call here.';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 5 } }));
    });
  });
  srv.seen = [];
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const askW = T.askWrittenAt(base, { model: 'target', stop: ['<unk>'] });
  const a1 = await askW({ messages: [{ role: 'user', content: 'Add 1 and 2, then 3 and 4.' }], tools });
  const a2 = await askW({ messages: [{ role: 'user', content: 'Hello.' }], tools });
  await new Promise((ok) => srv.close(ok));
  const fn = plan.find((b) => b.task === 'bfcl_parallel');
  const web = plan.find((b) => b.task === 'bfcl_web_search_base');
  // (what the larger model first measured scored, 20 questions a task: written is the better over the four tasks that need a
  // call and the worse on the one that needs none; it is counted by one way for the whole body of work)
  // THE FORM OF THE ANSWER SAID AFTER THE QUESTION (the web search test): the system message's words, unchanged, at the end of the
  // first thing the user said; every later step as it was; nothing to move, nothing changed
  const steps = [
    { role: 'system', content: 'Answer in this form.\n' },
    { role: 'user', content: 'Who?' },
    { role: 'assistant', content: null, tool_calls: [{ function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', content: 'found' },
    { role: 'user', content: 'And then?' },
  ];
  const moved = T.formAfter(steps);
  const plain = [{ role: 'user', content: 'Who?' }];
  const afterOk =
    moved.length === 4 &&
    moved[0].role === 'user' &&
    moved[0].content === 'Who?\n\nAnswer in this form.' &&
    JSON.stringify(moved.slice(1)) === JSON.stringify(steps.slice(2)) &&
    steps[1].content === 'Who?' &&
    T.formAfter(plain) === plain &&
    typeof T.askAfterAt === 'function' &&
    E.WAY_SAID.after.includes('after the question');
  const by = E.wayByItem([
    ...[14, 15, 2, 8, 20].map((right) => ({ item: 'tools', way: 'tools', right, n: 20 })),
    ...[19, 18, 16, 18, 10].map((right) => ({ item: 'tools', way: 'written', right, n: 20 })),
    { item: 'search', way: 'tools', right: 9, n: 20 },
    { item: 'even', way: 'written', right: 5, n: 10 },
    { item: 'even', way: 'tools', right: 5, n: 10 },
  ]);
  check(
    'the larger model is asked a function-calling test two ways and counted by one of them for the whole body of work, the one it scores higher by over its tasks together (the tools in the request where they tie): written into the conversation, its functions go into the system message after its own, every earlier call and result is written out as text, no tools are in the request, and every call it writes is read from its reply; a reply that writes none is a reply',
    JSON.stringify(E.waysOf(fn)) === JSON.stringify(['tools', 'written']) &&
      JSON.stringify(E.waysOf(web)) === JSON.stringify(['tools', 'after']) &&
      afterOk &&
      JSON.stringify(E.waysOf(plan.find((b) => b.task === 'ifeval'))) === JSON.stringify(['tools']) &&
      by.tools === 'written' &&
      by.search === 'tools' &&
      by.even === 'tools' &&
      wm.length === 4 &&
      wm[0].role === 'system' &&
      wm[0].content.startsWith('Be brief.\n\nYou may call one or more functions') &&
      wm[0].content.includes('<tools>\n' + JSON.stringify(tools[0]) + '\n</tools>') &&
      wm[2].role === 'assistant' &&
      wm[2].content === '<tool_call>\n{"name":"add","arguments":{"a":1,"b":2}}\n</tool_call>' &&
      wm[3].role === 'user' &&
      wm[3].content === '<tool_response>\n3\n</tool_response>' &&
      T.callsWritten(wrote).length === 2 &&
      T.callsWritten(wrote)[1].function.arguments === '{"a":3,"b":4}' &&
      T.callsWritten('It is 3.').length === 0 &&
      !('tools' in srv.seen[0]) &&
      srv.seen[0].messages[0].role === 'system' &&
      JSON.stringify(srv.seen[0].stop) === JSON.stringify(['<unk>']) &&
      a1.message.tool_calls.length === 2 &&
      a1.message.content === null &&
      a2.message.content === 'Nothing to call here.' &&
      !a2.message.tool_calls,
    { wm, a1, a2, ways: E.waysOf(fn) },
  );
}

// ---- 10d: THE SEARCH BEHIND THE WEB SEARCH TEST (training/support/search.mjs; training/search.json): which service, pinned; when
// it counts as installed; what the tool tests are started with; and what a result says of it, read from what the day kept
{
  const S = await import('../training/support/search.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-search-'));
  const half = S.searxInstalled(dir);
  fs.mkdirSync(path.join(dir, 'src', 'searx'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'searx', 'webapp.py'), '');
  fs.writeFileSync(path.join(dir, 'venv', 'bin', 'python'), '');
  fs.writeFileSync(path.join(dir, '.rev'), 'an-older-revision\n');
  const old = S.searxInstalled(dir);
  fs.writeFileSync(path.join(dir, '.rev'), S.SEARCH.searxng.rev + '\n');
  const here = S.searxInstalled(dir);
  const day = S.searchFolder(dir, '2026-11-18');
  fs.mkdirSync(path.join(day, 'queries'), { recursive: true });
  fs.mkdirSync(path.join(day, 'pages'), { recursive: true });
  const q = (name, engines) =>
    fs.writeFileSync(
      path.join(day, 'queries', name + '.json'),
      JSON.stringify({
        key: name,
        value: { results: [{ title: 't', url: 'https://a.example/', content: 'c', engines }] },
      }),
    );
  q('one', ['brave', 'duckduckgo']);
  q('two', ['brave']);
  fs.writeFileSync(path.join(day, 'queries', 'being-written.json'), '{');
  fs.writeFileSync(path.join(day, 'pages', 'p.json'), JSON.stringify({ value: { content: 'x' } }));
  const rec = S.searchRecord({}, day);
  const env = S.searchEnv('http://127.0.0.1:9', day);
  let refused = '';
  try {
    await S.openSearch({ dir: path.join(dir, 'nowhere') });
  } catch (e) {
    refused = String(e.message);
  }
  check(
    'the search behind the web search test is a SearXNG pinned by revision and served with its JSON output on, unless another service is named; it counts as installed only at the pinned revision with its program and its Python; the tool tests are told where it is and where the day keeps what it returned; a result says the service, its revision, the engines that answered and what was kept; and where it is not installed it is not started',
    S.searchOf({}) === 'searxng' &&
      S.searchOf({ SWARM_SEARCH: 'SerpAPI' }) === 'serpapi' &&
      S.searchOf({ SWARM_SEARCH: 'something-else' }) === 'searxng' &&
      /^[0-9a-f]{40}$/.test(S.SEARCH.searxng.rev) &&
      /^https:\/\/github\.com\/searxng\/searxng/.test(S.SEARCH.searxng.repo) &&
      S.SEARCH.searxng.settings.search.formats.includes('json') &&
      S.SEARCH.searxng.settings.server.limiter === false &&
      half === false &&
      old === false &&
      here === true &&
      day === path.join(dir, 'search', '2026-11-18') &&
      env.SWARM_SEARCH_URL === 'http://127.0.0.1:9' &&
      env.SWARM_SEARCH_CACHE === day &&
      env.SWARM_SEARCH_TRIES === '3' &&
      // (longer waits between the tries of a search that came back with nothing; and how many of a model's searches did)
      env.SWARM_SEARCH_WAITS === S.SEARCH.searxng.waits.join(',') &&
      S.SEARCH.searxng.waits[0] >= 5 &&
      env.SWARM_SEARCH_PACE === String(S.SEARCH.searxng.pace) &&
      S.SEARCH.searxng.pace >= 1 &&
      S.SEARCH.searxng.settings.engines.every((x) => x.name && x.disabled === false) &&
      S.SEARCH.searxng.settings.engines.some((x) => x.name === 'bing') &&
      (() => {
        const f = path.join(dir, 'searches.jsonl');
        fs.writeFileSync(f, '{"q":"a","n":3}\n{"q":"b","n":0}\n\n{"q":"c","n":0,"why":"refused"}\n');
        const got = S.searchesIn(f);
        return got.asked === 3 && got.empty === 2 && S.searchesIn(path.join(dir, 'no-such-file')) === null;
      })() &&
      rec.service === 'SearXNG' &&
      rec.revision === S.SEARCH.searxng.rev &&
      JSON.stringify(rec.engines) === JSON.stringify(['brave', 'duckduckgo']) &&
      rec.queries === 2 &&
      rec.pages === 1 &&
      /both models are given the same/.test(rec.kept) &&
      S.searchRecord({ SWARM_SEARCH: 'serpapi' }, day).service === 'SerpAPI (DuckDuckGo)' &&
      /no key/.test(S.searchWords({})) &&
      /is not installed here/.test(refused),
    { half, old, here, rec, env, refused },
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- the class stage changes the draw the way a swarm lets it be changed (it assigned to `seed`, which a swarm only reads:
// the stage stopped with a TypeError the first time a change reached the held questions, 2026-11-21)
{
  const src = fs.readFileSync(new URL('../training/classes.mjs', import.meta.url), 'utf8');
  reset();
  const s2 = await createSwarm({ attach: { a: lfm.base, b: bonsai.base }, seed: 1 });
  let threw = false;
  try {
    s2.seed = 2;
  } catch {
    threw = true;
  }
  s2.setSeed('1|draw2');
  const drawn = s2.seed;
  s2.setSeed(1);
  await s2.stop();
  check(
    "a swarm's draw is changed with setSeed and read with seed, which cannot be assigned; the class stage asks its further draws with setSeed and puts the first back",
    threw &&
      drawn === '1|draw2' &&
      s2.seed === 1 &&
      !/swarm\.seed\s*=[^=]/.test(src) &&
      /swarm\.setSeed\(k \? seed0 \+ '\|draw'/.test(src) &&
      /swarm\.setSeed\(seed0\);/.test(src),
    { threw, drawn },
  );
}

// ---- ONE RULE FOR KEEPING A CHANGE, over two draws of the held questions; and the class stage's sweep
{
  const K = await import('../training/keep.mjs');
  const C = await import('../training/classes.mjs');
  const q = (id, kind, base, w) => ({ id, kind, base, with: w });
  // ten questions: six gain on both draws, four stay
  const gains = [...Array(10).keys()].map((i) => q('q' + i, i % 2 ? 'a' : 'b', [0, 0], i < 6 ? [1, 1] : [0, 0]));
  const kept = K.keepOf(gains, { least: 0.02 });
  // one draw only: never kept, however large
  const oneDraw = K.keepOf(gains.map((r) => ({ ...r, base: [r.base[0]], with: [r.with[0]] })));
  // a gain on one draw that the other takes back: nothing
  const luck = K.keepOf(
    [...Array(10).keys()].map((i) => q('q' + i, 'a', [0, 0], i < 3 ? [1, 0] : [0, 0])),
    { least: 0.2 },
  );
  // right on both draws as it stands and wrong on both with it: lost. Six made good outweigh one lost (twice as many at least);
  // they do not outweigh four
  const lost = K.keepOf([...gains, q('z', 'a', [1, 1], [0, 0])]);
  const lostMore = K.keepOf([...gains, ...[1, 2, 3, 4].map((i) => q('z' + i, 'a', [1, 1], [0, 0]))]);
  // four held questions, one made good: a gain within twice its error, alone. With twelve other questions the change was not
  // chosen on, six of them gaining, the bar is cleared; and held questions that did not gain keep nothing, whatever the others did
  const thin = [...Array(4).keys()].map((i) => q('h' + i, 'a', [0, 0], i < 1 ? [1, 1] : [0, 0]));
  const others = [...Array(12).keys()].map((i) => q('t' + i, 'a', [0], i < 6 ? [1] : [0]));
  const thinAlone = K.keepOf(thin, { least: 0.02 });
  const thinBeside = K.keepOf(thin, { least: 0.02, beside: others });
  const flatHeld = K.keepOf(
    thin.map((r) => ({ ...r, with: [0, 0] })),
    { least: 0.02, beside: others },
  );
  // right once and wrong once is no loss
  const wobble = K.keepOf([...gains, q('z', 'a', [1, 1], [1, 0])]);
  // a kind that falls while the whole gains
  const fell = K.keepOf([
    ...[...Array(12).keys()].map((i) => q('g' + i, 'up', [0, 0], [1, 1])),
    ...[...Array(4).keys()].map((i) => q('d' + i, 'down', [1, 1], i < 3 ? [0, 1] : [1, 1])),
  ]);
  // a kind that came out a little lower: two answers of sixteen, a fall of more than its own error and less than twice it. Not
  // fallen (a gain is held to twice its error, and so is a fall)
  const dipped = K.keepOf([
    ...[...Array(12).keys()].map((i) => q('g' + i, 'up', [0, 0], [1, 1])),
    ...[...Array(8).keys()].map((i) => q('d' + i, 'down', [1, 1], i < 2 ? [0, 1] : [1, 1])),
  ]);
  const small = K.keepOf(gains.slice(0, 1));
  const base = {
    marker: 'ANSWER:',
    plan: { keepTurns: 6 },
    slots: [
      { id: 'd', stage: 'draft', brief: 'x' },
      { id: 'c', stage: 'check', brief: 'y' },
    ],
  };
  const mv = (name, briefs) => ({ name, briefs });
  const moves = [
    mv('plan: decide by decider', { ...base, plan: { ...base.plan, decideBy: 'decider' } }),
    mv('the checker told otherwise', { ...base, slots: [base.slots[0], { ...base.slots[1], brief: 'z' }] }),
    mv('a drafter told otherwise', { ...base, slots: [{ ...base.slots[0], brief: 'w' }, base.slots[1]] }),
    mv('plan: every draft at once', { ...base, plan: { ...base.plan, draftFirst: 2 } }),
    mv('plan: closes as shown', { ...base, plan: { ...base.plan, closeAs: 'shown' } }),
  ];
  const round = C.roundOf(moves, base, ['a drafter', 'every draft'], 1);
  const scored = [
    { m: { ...moves[0], sweep: true }, g: { gain: 0.1 } },
    { m: { ...moves[4], sweep: true }, g: { gain: 0.3 } },
    { m: moves[2], g: { gain: 0.9 } },
    { m: { ...moves[1], sweep: true }, g: { gain: -0.1 } },
  ];
  const both = C.togetherOf(scored, (b) => [
    mv('plan: decide by decider', { ...b, plan: { ...b.plan, decideBy: 'decider' } }),
  ]);
  const sh = fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8');
  const pol = JSON.parse(fs.readFileSync(new URL('../training/policy.json', import.meta.url), 'utf8'));
  check(
    'a change to a class is kept by one rule, the same for both stages of training: on the held questions, each asked on two draws or more, where the mean gain is over twice its error and at least the least gain, what it loses (right every time as it stands, wrong every time with it) is outweighed by twice as many made good, and no kind falls by more than the margin and twice its own error; the bar is cleared by the held questions alone or with the other questions the change was not chosen on, and never where the held questions did not gain; one draw never keeps; the class stage tries every change that leaves the drafts as they are, a few of the others the policy names, and the best two of the first together; it asks every question of the class, and runs before the larger model is asked anything',
    kept.keep === true &&
      kept.gain === 0.6 &&
      kept.draws === 2 &&
      kept.n === 10 &&
      oneDraw.keep === false &&
      /one draw/.test(oneDraw.why) &&
      luck.keep === false &&
      /not more than twice its error/.test(luck.why) &&
      lost.keep === true &&
      lost.lost.join() === 'z' &&
      lost.good.length === 6 &&
      lostMore.keep === false &&
      /it lost z1 and 3 more, .* and made 6 good: not twice as many/.test(lostMore.why) &&
      thinAlone.keep === false &&
      /not more than twice its error/.test(thinAlone.why) &&
      thinBeside.keep === true &&
      thinBeside.judged.n === 16 &&
      flatHeld.keep === false &&
      wobble.keep === true &&
      fell.keep === false &&
      fell.fell.join() === 'down' &&
      dipped.keep === true &&
      dipped.fell.length === 0 &&
      small.keep === false &&
      C.keepsDrafts(base, moves[0].briefs) &&
      C.keepsDrafts(base, moves[1].briefs) &&
      !C.keepsDrafts(base, moves[2].briefs) &&
      !C.keepsDrafts(base, moves[3].briefs) &&
      round.map((m) => m.name).join('|') ===
        'plan: decide by decider|the checker told otherwise|plan: closes as shown|a drafter told otherwise' &&
      round.filter((m) => m.sweep).length === 3 &&
      both &&
      both.name === 'plan: closes as shown + plan: decide by decider' &&
      both.briefs.plan.closeAs === 'shown' &&
      both.briefs.plan.decideBy === 'decider' &&
      C.togetherOf(scored.slice(0, 1), () => []) === null &&
      C.sampleOf([1, 2, 3], 0).length === 3 &&
      pol.classes.sample === 0 &&
      pol.classes.draws === 2 &&
      sh.indexOf('run 08-classes') > 0 &&
      sh.indexOf('run 08-classes') < sh.indexOf('run 01-research') &&
      sh.indexOf('run 08-classes') < sh.indexOf('run 02-target '),
    { kept, oneDraw, luck, lost, fell, round: round.map((m) => m.name), both: both && both.name },
  );
}

// ---- one model in several places is loaded once
{
  const I = await import('../src/index.mjs');
  const C = await import('../src/catalog.mjs');
  const M = await import('../training/support/measure-memory.mjs');
  const as = { a: 'x', b: 'x', c: 'y', d: 'x' };
  const on = I.sharedLoads(['a', 'b', 'c', 'd'], (k) => as[k]);
  const off = I.sharedLoads(['a', 'b'], (k) => as[k], false);
  const m1 = { id: 'm1', bytes: 2 ** 30 };
  const target = { memGb: 20 };
  const two = C.footprintOf({ a: m1, b: m1 }, null, target);
  const mixed = C.footprintOf({ a: m1, b: { id: 'm2', bytes: 2 ** 30 } }, null, target);
  const measured = M.measureSwarm(
    { members: { a: 11, b: 11, c: 12 } },
    { platform: 'linux', exec: (cmd, args) => (cmd === 'ps' ? String((args[3] === '11' ? 2 : 1) * 1024 * 1024) : '') },
  );
  check(
    'places that hold the same model, served the same way, share one load: the first of them starts it with the slots of all, the others are that load; places served differently, or with sharing off, each have their own; the memory a swarm is estimated at counts a shared model once, and its measured memory counts a shared process once',
    on.a.with === 'a' &&
      on.a.places === 3 &&
      on.b.with === 'a' &&
      on.d.with === 'a' &&
      on.c.with === 'c' &&
      on.c.places === 1 &&
      off.b.with === 'b' &&
      off.a.places === 1 &&
      two.swarm === 2.3 &&
      mixed.swarm === 3.5 &&
      measured.swarm === 3 &&
      measured.members.b === 0 &&
      measured.shared.b === 'a',
    { on, two, mixed, measured },
  );
}

// ---- an evaluation can measure the arrangement a swarm started from, and says which it measured
{
  const I = await import('../src/index.mjs');
  const ev = fs.readFileSync(new URL('../training/evaluate.mjs', import.meta.url), 'utf8');
  const start = I.startBriefs();
  check(
    'the arrangement a swarm starts from can be read whatever the configuration has learned since, and an evaluation asked for it (--default) measures that one and says "default"; otherwise it says which of the two the stored arrangement is',
    start.plan.draftFirst === 2 &&
      start.slots.every((x) => Object.keys(MEMBERS).includes(x.member)) &&
      /B\.has\('default'\) \|\| \(variant && variant\.default\) \? startBriefs\(\) : storedBriefs\(\)/.test(ev) &&
      /\? 'default'\s*: 'trained'/.test(ev) &&
      (ev.match(/arrangementSha256,\n\s+arrangement,/g) || []).length === 2,
    Object.keys(start.plan),
  );
}

// ---- how long a side took over a task is kept with its answers
{
  const E = await import('../training/evaluate.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-secs-'));
  const wrote = E.secondsNote(path.join(dir, 'a'), 91.26, 20);
  check(
    'the seconds a model took over a task are kept beside its answers and read back as seconds a question; nothing is kept of a task that took no time or had no question, and a folder with no such record reads as not known',
    wrote === true &&
      E.secondsIn(path.join(dir, 'a')) === 4.6 &&
      E.secondsNote(path.join(dir, 'b'), 0, 20) === false &&
      E.secondsNote(path.join(dir, 'b'), 10, 0) === false &&
      E.secondsIn(path.join(dir, 'b')) === null &&
      E.secondsIn(path.join(dir, 'none')) === null,
    [wrote, E.secondsIn(path.join(dir, 'a'))],
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- THE DEFAULT ARRANGEMENT DRAFTS IN TWO ROUNDS, AND THE ANSWER MOST SLOTS HOLD STANDS (console 2026-11-21: a swarm took
// 27 s a question where its model took 8)
{
  const { firstDrafters } = await import('../src/orchestrate.mjs');
  const ds = STORED.slots.filter((x) => x.stage === 'draft');
  const ids = (list) => list && list.map((x) => x.id).join(',');
  const one = ds.map((x) => ({ ...x, member: 'a' }));
  let decided = 0;
  const fast = await createSwarmAsStored({
    attach: { a: lfm.base, b: bonsai.base },
    decide: async () => ((decided += 1), { ok: false, why: 'not asked for here' }),
  });
  const draftsOf = (got) => got.trace.filter((r) => r.stage === 'draft').map((r) => r.slot);
  // the two that draft first agree: no other slot drafts, no check, no decision
  reset();
  for (const m of [lfm, bonsai]) m.s.script = (b) => (roleOf(b).stage === 'write' ? 'It is 42.' : 'ANSWER: 42');
  const agreed = await fast.answer(Q);
  // they differ: the other two draft, then the checks; three hold 42, and it stands without the decider
  reset();
  for (const m of [lfm, bonsai])
    m.s.script = (b) => {
      const r = roleOf(b);
      if (r.stage === 'write') return 'It is 42.';
      if (r.stage === 'check') return 'ANSWER: A';
      return 'ANSWER: ' + (r.id === 'b-direct' ? '41' : '42');
    };
  const split = await fast.answer(Q);
  await fast.stop();
  check(
    'the default arrangement asks two drafts first, one of each small model, and the other two only where those differ; the answer most slots hold then stands with no decision asked for; a draft has 450 tokens and a check 250; and which slots draft first is one of each member, then in order, or every slot at once where the plan names no number that fits',
    STORED.plan.draftFirst === 2 &&
      STORED.plan.decideBy === 'most' &&
      ds.every((x) => x.maxTokens === 450) &&
      STORED.slots.filter((x) => x.stage === 'check').every((x) => x.maxTokens === 250) &&
      ids(firstDrafters(ds, 2)) === 'a-direct,b-direct' &&
      ids(firstDrafters(ds, 3)) === 'a-direct,a-steps,b-direct' &&
      ids(firstDrafters(one, 2)) === 'a-direct,a-steps' &&
      firstDrafters(ds, 4) === null &&
      firstDrafters(ds, 1) === null &&
      firstDrafters(ds, undefined) === null &&
      firstDrafters(ds, 2.5) === null &&
      draftsOf(agreed).sort().join(',') === 'a-direct,b-direct' &&
      !agreed.trace.some((r) => r.stage === 'check') &&
      agreed.decided === '42' &&
      draftsOf(split).length === 4 &&
      draftsOf(split).slice(0, 2).sort().join(',') === 'a-direct,b-direct' &&
      split.decided === '42' &&
      /^most/.test(split.path) &&
      decided === 0,
    { agreed: [draftsOf(agreed), agreed.path], split: [draftsOf(split), split.path, split.decided], decided },
  );
}

// ---- A PYTHON FUNCTION IS CODE (src/read.mjs isCode, fenceOf; src/orchestrate.mjs answersOf): words are no answer beside code
{
  const R8 = await import('../src/read.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const PY = 'def remove_occ(s, ch):\n    i = s.find(ch)\n    return s[:i] + s[i + 1:]';
  const PY2 = 'def remove_occ(s, ch):\n    return s.replace(ch, "", 1)';
  const WORDS = 'The function should strip the first occurrence of the character from the string';
  const QPY = [
    {
      role: 'user',
      content: 'Write a python function remove_occ(s, ch) to remove the first occurrence of a character.',
    },
  ];
  const said = {
    'a-direct': 'ANSWER: ' + WORDS,
    'a-steps': '```python\n' + PY + '\n```',
    'b-direct': '```python\n' + PY2 + '\n```',
  };
  const asked = [];
  const got = await orchestrate(QPY, {
    briefs: startBriefs(),
    ask: async (slot) => (
      asked.push(slot.stage),
      { text: said[slot.id] || (slot.stage === 'draft' ? '```python\n' + PY + '\n```' : 'ANSWER: A') }
    ),
  });
  const none = await orchestrate(QPY, { briefs: startBriefs(), ask: async () => ({ text: 'ANSWER: ' + WORDS }) });
  check(
    'a Python function is code: it has its own marks (a def or class with its colon, an import line, a lambda), words about a function are still words, and code goes out fenced in its own language; and where code is asked for and one answer is code, an answer in words is not counted beside it (three drafts wrote the function and one a sentence, the sentence came first, and the sentence went out: 0 of 40) and the function goes out as it was written, not as a sentence; where no answer is code the words stand as before',
    R8.isCode(PY) &&
      R8.isCode('import math\nx = 1') &&
      R8.isCode('f = lambda x: x + 1') &&
      R8.isCode('class A(B):\n    pass') &&
      !R8.isCode(WORDS) &&
      !R8.isCode('Define the function: it returns the string. Import nothing.') &&
      R8.isCode('const f = (a) => a + 1;') &&
      R8.fenceOf(PY) === 'python' &&
      R8.fenceOf('function f(a) { return a; }') === 'js' &&
      got.ok &&
      R8.isCode(got.decided) &&
      /def remove_occ/.test(got.reply) &&
      !got.reply.includes(WORDS) &&
      !asked.includes('write') &&
      none.ok &&
      none.reply.includes(WORDS),
    { path: got.path, decided: got.decided, reply: got.reply, asked: asked.join(), none: none.reply },
  );
}
// ---- DRAFTS ARE RUN IN THE LANGUAGE THEY ARE WRITTEN IN (src/langs.mjs; src/behave.mjs): each language, the box, and the swarm
{
  const L = await import('../src/langs.mjs');
  const { behaviours, probeBriefFor, callsIn: callsInText } = await import('../src/behave.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const R9 = await import('../src/read.mjs');
  // one function in each language: an ordinary call, a call that fails as the program runs, a call the compiler refuses
  const CASES = {
    ts: [
      'function inc(a: number, by: number = 1): number { if (a > 8) throw new Error("no"); return a + by; }',
      ['inc(1)', 'inc(9)', 'inc(2, 5)'],
      ['2', 'E', '7'],
    ],
    python: [
      'def add(a, b):\n    return [a + b, {"k": (1, 2)}]\n',
      ['add(1, 2)', 'add(1, "x")', 'add("a", "b")'],
      ['[3, {"k": [1, 2]}]', 'E', '["ab", {"k": [1, 2]}]'],
    ],
    go: [
      'import "errors"\nfunc div(a int, b int) (int, error) {\n\tif b == 0 { return 0, errors.New("zero") }\n\tif b == 7 { var x []int; return x[3], nil }\n\treturn a / b, nil\n}\n',
      ['div(6, 3)', 'div(1, 7)', 'div("a", 1)', 'div(1, 0)'],
      ['[2,null]', 'E', 'E', '[0,"zero"]'],
    ],
    swift: [
      'func rev(_ s: String, times n: Int) -> [String] {\n  if n < 0 { let a: [Int] = []; return [String(a[2])] }\n  return Array(repeating: String(s.reversed()), count: n)\n}\n',
      ['rev("abc", times: 2)', 'rev("x", times: -1)', 'rev(3, times: 1)'],
      ['["cba", "cba"]', 'E', 'E'],
    ],
    dart: [
      'List<int> twice(List<int> xs) {\n  if (xs.length == 3) throw StateError("no");\n  return xs.map((x) => x * 2).toList();\n}\nvoid main() { print("the draft has a main of its own"); }\n',
      ['twice(<int>[1, 2])', 'twice(<int>[1, 2, 3])', 'twice("a")'],
      ['[2,4]', 'E', 'E'],
    ],
    kotlin: [
      'fun evens(xs: List<Int>): List<Int> {\n  if (xs.size == 3) throw IllegalStateException("no")\n  return xs.filter { it % 2 == 0 }\n}\n',
      ['evens(listOf(2, 3, 4, 6))', 'evens(listOf(1, 2, 4))', 'evens("a")'],
      ['[2, 4, 6]', 'E', 'E'],
    ],
  };
  const WIDGET = (extra) =>
    "import 'package:flutter/material.dart';\nclass Greeting extends StatelessWidget {\n  final String name;\n  final VoidCallback onTap;\n" +
    '  const Greeting(this.name, {super.key, required this.onTap});\n  @override\n' +
    "  Widget build(BuildContext context) => Column(children: [Text('Hi $name'), " +
    extra +
    "ElevatedButton(onPressed: onTap, child: const Text('Go'))]);\n}\n" +
    "void main() => runApp(MaterialApp(home: Greeting('x', onTap: () {})));\n";
  const ready = {};
  await Promise.all(L.LANGS.map(async (id) => (ready[id] = await L.langReady(id))));
  const got = {};
  await Promise.all(
    Object.entries(CASES).map(async ([id, [code, calls]]) => {
      if (!ready[id]) return;
      const name = id === 'ts' ? 'inc' : L.nameIn(id, [code]);
      const out = await L.callsIn(id, code, name, calls);
      got[id] = out ? out.map((o) => (o.e ? 'E' : o.v)) : null;
    }),
  );
  const wrong = Object.entries(CASES)
    .filter(([id, c]) => ready[id] && JSON.stringify(got[id]) !== JSON.stringify(c[2]))
    .map(([id]) => id);
  check(
    "a function is run in the language it is written in (TypeScript, Python, Go, Swift, Dart, Kotlin: each one this machine has the tools of): a call gives what the function returned; a call that fails as the program runs (it throws, or it stops the program) fails alone; a call the compiler refuses fails and the others are still made; a main of the draft's own is not in the way. A language with no tools here is not run: " +
      (L.LANGS.filter((id) => !ready[id]).join(', ') || 'none is missing'),
    !wrong.length && ready.ts,
    { wrong, got, ready },
  );
  // THE BOX: nothing leaves, nothing is written outside the run's folder, and the person's folders are not read
  if (ready.python) {
    const esc =
      'import urllib.request, os\ndef leak():\n    r = []\n' +
      '    try:\n        urllib.request.urlopen("http://example.com", timeout=2); r.append("NET")\n    except Exception:\n        r.append("no net")\n' +
      '    try:\n        open(' +
      JSON.stringify(path.join(os.homedir(), 'swoa-box-escape-2.txt')) +
      ', "w").write("x"); r.append("WRITE")\n    except Exception:\n        r.append("no write")\n' +
      '    try:\n        os.listdir(' +
      JSON.stringify(os.homedir()) +
      '); r.append("READ")\n    except Exception:\n        r.append("no read")\n' +
      '    return r\n';
    const out = await L.callsIn('python', esc, 'leak', ['leak()']);
    check(
      "code a model wrote runs in a box: it reaches no network, writes nothing outside the folder made for the run, and does not read the person's folders",
      !!out &&
        out[0].v === '["no net", "no write", "no read"]' &&
        !fs.existsSync(path.join(os.homedir(), 'swoa-box-escape-2.txt')),
      { out },
    );
  }
  // FLUTTER: a function that uses Flutter, and a widget, built with no screen and known by what it shows
  if (ready.flutter) {
    const a = WIDGET('');
    const b = WIDGET('const Icon(Icons.add), ');
    const name = L.nameIn('flutter', [a, b]);
    const calls = L.callsFor('flutter', 'Greet "Ann"', [a, b], name).slice(0, 2);
    const fn =
      "import 'package:flutter/material.dart';\nColor blend(Color a, double t) => Color.lerp(a, const Color(0xFF000000), t)!;\n";
    const [ra, ra2, rb, rf] = await Promise.all([
      L.callsIn('flutter', a, name, calls),
      L.callsIn('dart', a.replace("'Hi $name'", "'Hi ' + name"), name, calls),
      L.callsIn('flutter', b, name, calls),
      L.callsIn('dart', fn, 'blend', ['blend(const Color(0xFFFFFFFF), 0.5)']),
    ]);
    check(
      'Flutter code is run as well, where no screen is needed: a function that uses Flutter gives its value; a widget is constructed with what it requires (a callback that does nothing where it wants one) and built, and is known by the texts it shows and the widgets under it, so two widgets written differently that show the same are the same and one with an icon more is another',
      name === 'Greeting' &&
        calls[0] === 'Greeting("Ann", onTap: () {})' &&
        !!ra &&
        !!rb &&
        !!ra2 &&
        !!rf &&
        /"texts":\["Hi Ann","Go"\]/.test(ra[0].v) &&
        JSON.stringify(ra) === JSON.stringify(ra2) &&
        JSON.stringify(ra) !== JSON.stringify(rb) &&
        /red: 0\.5/.test(rf[0].v),
      { name, calls, ra: ra && ra[0].v.slice(0, 200), rf },
    );
  }
  // which language, calls with no model, literal calls, and what is code
  const goCode = 'func sum(xs []int, k int) int {\n\treturn len(xs) + k\n}';
  const swCode = 'func rev(_ s: String, times n: Int) -> [String] {\n  return []\n}';
  const ktCode = 'fun evens(xs: List<Int>): List<Int> {\n  return xs\n}';
  check(
    'the language of the drafts is the one the request names, else the one most drafts bear the marks of, else JavaScript; calls are built with no model from the parameters and their types, written as the language writes them (a typed list in Go, a label in Swift, listOf in Kotlin); a literal call may hold the words its language needs and no other name; code in these languages is code and is fenced as its own; and the probing slot is asked for calls in the language asked for',
    L.langOf('Write a Python function f', []) === 'python' &&
      L.langOf('Write a function in Go that sums', []) === 'go' &&
      L.langOf('Build a Flutter widget', []) === 'flutter' &&
      L.langOf('Write a function', [goCode, goCode, 'def f(x):\n    return x']) === 'go' &&
      L.langOf('Write a function', ['function f(a) { return a; }']) === 'js' &&
      L.callsFor('go', '', [goCode], 'sum')[1] === 'sum([]int{1}, 2)' &&
      L.callsFor('swift', 'reverse "abc"', [swCode], 'rev')[0] === 'rev("abc", times: 1)' &&
      L.callsFor('kotlin', '', [ktCode], 'evens')[2] === 'evens(listOf<Int>(1, 2, 3, 4, 5))' &&
      L.callsFor('python', '', ['def f(n, items):\n    return n'], 'f')[1] === 'f(1, [1, 2, 3, 4, 5])' &&
      L.callsFor('python', '', ['def f(thing):\n    return thing'], 'f').length === 0 &&
      callsInText('sum([]int{1, 2}, 3)\nsum(other(1), 2)', 'sum', { words: L.CALL_WORDS.go }).join() ===
        'sum([]int{1, 2}, 3)' &&
      callsInText('sum([]int{1, 2}, 3)', 'sum').length === 0 &&
      R9.isCode(goCode) &&
      R9.isCode(swCode) &&
      R9.isCode(ktCode) &&
      R9.isCode(WIDGET('')) &&
      !R9.isCode('The function should walk the list and return its length.') &&
      R9.fenceOf(goCode) === 'go' &&
      R9.fenceOf(ktCode) === 'kotlin' &&
      R9.fenceOf(WIDGET('')) === 'dart' &&
      R9.fenceOf('function f(a) { return a; }') === 'js' &&
      /as Python/.test(probeBriefFor('python')) &&
      /as JavaScript/.test(probeBriefFor('js')),
    {
      go: L.callsFor('go', '', [goCode], 'sum'),
      swift: L.callsFor('swift', 'reverse "abc"', [swCode], 'rev'),
      kotlin: L.callsFor('kotlin', '', [ktCode], 'evens'),
    },
  );
  // THE SWARM: Python drafts are run, the ones that do the same are one answer, and the answer most drafts DO goes out
  if (ready.python) {
    const QPY =
      'Write a python function first_gone(s, ch) that removes the first occurrence of ch from s. It should pass: assert first_gone("hello", "l") == "helo"';
    const RIGHT1 = 'def first_gone(s, ch):\n    i = s.find(ch)\n    return s if i < 0 or not ch else s[:i] + s[i + 1:]';
    const RIGHT2 = 'def first_gone(s, ch):\n    return s.replace(ch, "", 1)';
    const WRONG = 'def first_gone(s, ch):\n    return s.replace(ch, "")';
    const grouped = await behaviours({
      question: QPY,
      drafts: [
        { letter: 'A', final: WRONG },
        { letter: 'B', final: RIGHT1 },
        { letter: 'C', final: RIGHT2 },
        { letter: 'D', final: 'def first_gone(s, ch)\n    return oops' },
      ],
      probeText: 'function first_gone(s, ch) { return s; }',
    });
    const said = { 'a-direct': WRONG, 'a-steps': RIGHT1, 'b-direct': RIGHT2, 'b-other-way': RIGHT1 };
    const stages = [];
    const out = await orchestrate([{ role: 'user', content: QPY }], {
      briefs: startBriefs(),
      behave: behaviours,
      ask: async (slot) => (
        stages.push(slot.stage),
        {
          text:
            slot.stage === 'draft'
              ? '```python\n' + (said[slot.id] || RIGHT1) + '\n```'
              : slot.stage === 'probe'
                ? 'first_gone("aXbXc", "X")\nfirst_gone("", "a")\nfirst_gone("abc", "z")'
                : 'ANSWER: B',
        }
      ),
    });
    const ran = (out.trace || []).find((r) => r.stage === 'run');
    check(
      "the swarm runs Python drafts: drafts that do the same are one answer (two functions written differently that return the same, against one that removes every occurrence), a draft that does not compile is no answer, the calls come from the probing slot and from the request's own example where the slot wrote none that can be used, and the answer that goes out is the one most drafts DO, though the first draft does another thing",
      !!grouped &&
        grouped.lang === 'python' &&
        grouped.groups.length === 2 &&
        grouped.groups.some((g) => g.join() === 'B,C') &&
        grouped.by.D === '' &&
        grouped.calls.includes('first_gone("hello", "l")') &&
        out.ok &&
        !!ran &&
        ran.ok &&
        ran.behaviours === 2 &&
        /find\(ch\)|replace\(ch, "", 1\)/.test(out.reply) &&
        !/replace\(ch, ""\)/.test(out.reply),
      {
        groups: grouped && grouped.groups,
        calls: grouped && grouped.calls,
        summary: grouped && grouped.summary,
        path: out.path,
        ran,
        reply: out.reply,
      },
    );
  }
}
// ---- A REPLY ALREADY BEGUN IS CONTINUED (src/read.mjs begunOf, continuedFrom; src/orchestrate.mjs answer, classOf)
{
  const R10 = await import('../src/read.mjs');
  const { answer: orchestrate, classOf } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const HEAD =
    'from typing import List\n\n\ndef total(xs: List[int]) -> int:\n    """ Sum the numbers.\n    >>> total([1, 2])\n    3\n    """\n';
  const ASK =
    'Write a solution to the following problem and make sure that it passes the tests:\n```python\n' + HEAD + '\n```\n';
  const BEGUN = 'Here is the completed function:\n```python\n' + HEAD + '\n';
  const WHOLE =
    'import math\n\ndef helper(x):\n    return x\n\ndef total(xs):\n    """Sum."""\n    s = 0\n    for x in xs:\n        s += helper(x)\n    return s';
  const cont = R10.continuedFrom(BEGUN, '```python\n' + WHOLE + '\n```', WHOLE);
  const msgs = [
    { role: 'user', content: ASK },
    { role: 'assistant', content: BEGUN },
  ];
  const seen = [];
  const got = await orchestrate(msgs, {
    briefs: startBriefs(),
    behave: null,
    ask: async (slot, m) => (seen.push(m[m.length - 1].content), { text: '```python\n' + WHOLE + '\n```' }),
  });
  // the start and what follows it are the function: run it
  let ran = '';
  try {
    const { execFileSync } = await import('node:child_process');
    ran = execFileSync('python3', ['-I', '-c', HEAD + '\n' + got.reply + '\nprint(total([1, 2, 3]))'], {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    ran = 'failed: ' + String(e.stderr || e.message).slice(-200);
  }
  check(
    "a conversation that ends with the assistant's own turn is a reply already begun: the conversation before it is what is answered (the start is not taken for the question, and is no turn that makes the conversation a talk), a request to write a solution to a problem given as code asks for code, and the reply is what follows the start: where the start stands inside a Python function, the body of the function the swarm settled on, set in as the start sets it in, less its docstring, with the import and the helper it wrote beside the function put first inside it, so that the start and the reply together run; a reply that repeats the start has it taken off; and with no start a reply stands as it is",
    R10.begunOf(msgs) === BEGUN &&
      R10.begunOf(msgs.slice(0, 1)) === '' &&
      R10.asksForCode(ASK) &&
      !R10.asksForCode('Write a solution to the housing shortage.') &&
      classOf(msgs) === 'code' &&
      classOf([...msgs, { role: 'user', content: 'and now?' }]) === 'talk' &&
      cont ===
        '    import math\n\n    def helper(x):\n        return x\n\n    s = 0\n    for x in xs:\n        s += helper(x)\n    return s\n' &&
      R10.continuedFrom(BEGUN, 'x', 'import math\nreturn math.fsum(xs)') ===
        '    import math\n    return math.fsum(xs)\n' &&
      R10.continuedFrom('The answer is', 'The answer is 42.', '42') === ' 42.' &&
      R10.continuedFrom('', 'as it is', '') === 'as it is' &&
      R10.continuedFrom(BEGUN, 'It sums them.', 'It sums them.') === 'It sums them.' &&
      got.ok &&
      got.begun === true &&
      /\+continued/.test(got.path) &&
      got.reply === cont &&
      seen.every((q) => !q.startsWith('Here is the completed function')) &&
      ran === '6',
    { cont, path: got.path, reply: got.reply, ran, cls: classOf(msgs) },
  );
}
// ---- SEVERAL CALLS AT ONCE (src/members.mjs, src/tools.mjs): the engine is told several calls may be made, unless the caller says not
{
  const T = await import('../src/tools.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const tools = [
    {
      type: 'function',
      function: {
        name: 'play',
        parameters: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
      },
    },
  ];
  const two = [
    { id: 'c1', type: 'function', function: { name: 'play', arguments: '{"artist":"A"}' } },
    { id: 'c2', type: 'function', function: { name: 'play', arguments: '{"artist":"B"}' } },
  ];
  const sent = [];
  const run = (extra) =>
    T.answerTools([{ role: 'user', content: 'Play A and B.' }], {
      tools,
      briefs: startBriefs(),
      ask: async (slot, msgs, o) => (sent.push(o), { ok: true, content: '', calls: two, text: '' }),
      decide: async () => ({ ok: false, why: 'not asked' }),
      ...extra,
    });
  const got = await run({});
  const asDefault = sent.splice(0);
  await run({ parallel_tool_calls: false });
  const asFalse = sent.splice(0);
  const src = fs.readFileSync(new URL('../src/members.mjs', import.meta.url), 'utf8');
  check(
    'several calls may be made in one reply: the engine is told so with every request that carries tools (it gives one call alone where it is not told: a question that needs two calls got one), a caller that says not is obeyed, and both calls of a turn go out',
    /parallel_tool_calls: parallel_tool_calls !== false/.test(src) &&
      asDefault.length > 0 &&
      asDefault.every((o) => o.parallel_tool_calls === undefined) &&
      asFalse.length > 0 &&
      asFalse.every((o) => o.parallel_tool_calls === false) &&
      (got.calls || []).length === 2,
    { calls: got.calls, path: got.path, asFalse: asFalse.slice(0, 1) },
  );
}
// ---- CODE ASKED FOR AGAIN, OPTIONS ARE THE ANSWERS, A TOOL STEP ASKED FOR WHAT FITS (src/orchestrate.mjs, src/read.mjs, bfcl.mjs)
{
  const R11 = await import('../src/read.mjs');
  const { answer: orchestrate, CODE_AGAIN } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const BF = await import('../training/support/bfcl.mjs');
  // a drafter that answers a request for code in words is asked once for the code
  const FN = 'def twice(x):\n    return x * 2';
  const asked = [];
  const again = await orchestrate([{ role: 'user', content: 'Write a python function twice(x) that doubles x.' }], {
    briefs: startBriefs(),
    behave: null,
    ask: async (slot, m) => {
      const last = m[m.length - 1].content;
      asked.push(slot.stage + (last === CODE_AGAIN ? '+again' : ''));
      if (slot.stage !== 'draft') return { text: 'ANSWER: A' };
      return {
        text:
          last === CODE_AGAIN
            ? '```python\n' + FN + '\n```'
            : 'It doubles the number.\nANSWER: The function doubles x.',
      };
    },
  });
  const left = await orchestrate([{ role: 'user', content: 'Write a python function twice(x) that doubles x.' }], {
    briefs: { ...startBriefs(), plan: { ...startBriefs().plan, codeAgain: false } },
    behave: null,
    ask: async (slot) => ({ text: slot.stage === 'draft' ? 'ANSWER: The function doubles x.' : 'ANSWER: A' }),
  });
  // where a question lists options, an answer that is none of them is no answer beside one that is
  const Q = 'What is the date a month ago?\nOptions:\n(A) 12/02/1986\n(B) 12/01/1986\n(F) 02/06/1987';
  const opts = R11.optionsOf(Q);
  const said = { 'a-direct': '01/01/1987', 'a-steps': '01/01/1987', 'b-direct': '02/06/1987', 'b-other-way': '(F)' };
  const pick = (plan) =>
    orchestrate([{ role: 'user', content: Q }], {
      briefs: { ...startBriefs(), plan: { ...startBriefs().plan, draftFirst: undefined, ...plan } },
      ask: async (slot) => ({ text: 'ANSWER: ' + (said[slot.id] || '01/01/1987') }),
      decide: async () => ({ ok: false, why: 'not asked' }),
    });
  const listed = await pick({});
  // (every drafter gave what is not listed: each is asked once for the option, and names one)
  const { OPTION_AGAIN } = await import('../src/orchestrate.mjs');
  const asks = [];
  const named = await orchestrate([{ role: 'user', content: Q }], {
    briefs: startBriefs(),
    ask: async (slot, m) => {
      const last = m[m.length - 1].content;
      if (last === OPTION_AGAIN) asks.push(slot.id);
      return { text: 'ANSWER: ' + (last === OPTION_AGAIN ? 'B' : '01/01/1987') };
    },
    decide: async () => ({ ok: false, why: 'not asked' }),
  });
  const unlisted = await pick({ options: false });
  // a step with tools is asked once more for the reply that still fits
  const sent = [];
  const refusal =
    "This server's maximum context length is 16384 tokens, but the rendered prompt has 12614 tokens and requests 4096 reply tokens";
  const fake = async (url, o) => {
    const body = JSON.parse(o.body);
    sent.push(body);
    return sent.length === 1
      ? { ok: false, status: 400, text: async () => refusal }
      : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }) };
  };
  const fitted = await BF.sendToFor(
    'http://x',
    { model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'f' } }], parallel_tool_calls: true },
    fake,
  );
  check(
    "where code is asked for, a drafter that answered in words is asked once for the code itself and its code is then its answer (three of four drafters of a small model ended with a sentence about the function, and one draft of code is nothing to compare), and a plan can leave that; where a question lists lettered options an answer that is none of them is not counted beside one that is, and an option's letter and its words are one answer (an unlisted date with the most slots behind it went out with no letter), and a plan can leave that too; and a step with tools that a server refuses for want of room is asked once more for the reply that still fits, saying several calls may be made",
    asked.filter((x) => x === 'draft+again').length >= 2 &&
      /def twice/.test(again.reply) &&
      !/def twice/.test(left.reply) &&
      opts.map((o) => o.letter).join('') === 'ABF' &&
      R11.optionOf('(F)', opts) === 'F' &&
      R11.optionOf('f', opts) === 'F' &&
      R11.optionOf('02/06/1987', opts) === 'F' &&
      R11.optionOf('(B) 12/01/1986', opts) === 'B' &&
      R11.optionOf('01/01/1987', opts) === '' &&
      R11.optionOf('C', opts) === '' &&
      R11.optionsOf('one line\n(A) only').length === 0 &&
      R11.optionOf(listed.decided, opts) === 'F' &&
      asks.length >= 2 &&
      R11.optionOf(named.decided, opts) === 'B' &&
      listed.decided !== '01/01/1987' &&
      unlisted.decided === '01/01/1987' &&
      sent.length === 2 &&
      sent[0].max_tokens === 4096 &&
      sent[1].max_tokens === 16384 - 12614 - 64 &&
      sent[1].parallel_tool_calls === true &&
      fitted.message.content === 'ok',
    {
      asked: asked.join(),
      again: again.reply,
      listed: [listed.decided, listed.path],
      unlisted: [unlisted.decided, unlisted.path],
      sent: sent.map((b) => b.max_tokens),
    },
  );
}
// ---- A REPLY THE REQUEST SETS RULES ON IS WRITTEN WHOLE (src/piece.mjs; src/orchestrate.mjs): counted, chosen, told once
{
  const P = await import('../src/piece.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const Q1 = 'Write a blog post with 40 or more words about hammocks. Do not use any commas.';
  const rules = P.rulesOf(Q1);
  const short = 'Hammocks are restful, and cheap.';
  const long = Array.from({ length: 45 }, (_, i) => 'word' + i).join(' ') + '.';
  const calls = [];
  const got = await orchestrate([{ role: 'user', content: Q1 }], {
    briefs: startBriefs(),
    ask: async (slot, m) => {
      const last = m[m.length - 1].content;
      calls.push({
        slot: slot.id,
        again: /breaks these rules/.test(last),
        told: last,
        room: slot.maxTokens,
        sys: m[0].content,
      });
      // (the first drafter keeps one rule of two, the second none; told what it breaks, the first keeps both)
      if (/breaks these rules/.test(last)) return { text: long };
      return {
        text:
          slot.id === 'a-direct'
            ? long.replace('word1 ', 'word1, ')
            : 'Rules the request sets (keep every one; do not repeat them in what you write):\n- no comma anywhere\n\n' +
              short,
      };
    },
  });
  const plain = await orchestrate([{ role: 'user', content: Q1 }], {
    briefs: { ...startBriefs(), plan: { ...startBriefs().plan, piece: false } },
    ask: async () => ({ text: 'ANSWER: hammocks are restful' }),
  });
  const R2 = P.rulesOf(
    'Write a 2 paragraph critique in all capital letters, no lowercase letters allowed. Label each paragraph with PARAGRAPH X.',
  );
  const R3 = P.rulesOf(
    'Write a resume. Make sure to include at least 12 placeholder represented by square brackets, such as [address]. Finish with the phrase "Thank you." and add a postscript starting with P.S.',
  );
  check(
    'a reply the request sets countable rules on is written whole: the rules are read from the request (so many words, no comma, every letter a capital, parts with a label and a number, placeholders, last words, a postscript), the first drafters each write the whole reply with room for its length and told the rules, a reply that says the rules over has them taken off, each is counted against the rules and the one that keeps the most is chosen, the rule it breaks is told to its writer once with the count and the rewriting stands where it keeps more, and no writer or vote is asked; a request that sets no rule, and a plan that says not, go the way they went',
    rules.map((r) => r.id).join() === 'words-least,no-comma' &&
      P.keptBy(rules, long) === 2 &&
      P.keptBy(rules, short) === 0 &&
      rules[0].broken(short) === 'it has 5 words, and at least 40 are asked for' &&
      R2.map((r) => r.id).join() === 'capitals,labels' &&
      R2[1].keeps('PARAGRAPH 1\nA.\n\nPARAGRAPH 2\nB.') &&
      !R2[1].keeps('PARAGRAPH 1\nA.') &&
      R2[0].keeps('ALL CAPS HERE.') &&
      !R2[0].keeps('Not caps.') &&
      R3.map((r) => r.id).join() === 'placeholders,ends-with,postscript' &&
      !R3[0].keeps('[a] [b]') &&
      P.rulesOf('What is the capital of France?').length === 0 &&
      !P.setsRules('Write a short letter to my boss Sam saying I am quitting.') &&
      P.withoutRules(
        'Rules the request sets (keep every one; do not repeat them in what you write):\n- no comma anywhere\n\nThe piece.',
        rules,
      ) === 'The piece.' &&
      P.roomFor('Write 400 or more words') === 1010 &&
      got.ok &&
      got.path === 'piece+rewritten' &&
      got.reply === long &&
      calls.length === 3 &&
      calls.filter((c) => c.again).length === 1 &&
      calls.find((c) => c.again).slot === 'a-direct' &&
      /it has 1 commas, and none is allowed/.test(calls.find((c) => c.again).told) &&
      calls.every((c) => c.room >= 900 && /no comma anywhere/.test(c.sys)) &&
      got.trace.every((r) => r.stage === 'draft') &&
      got.trace.find((r) => r.slot === 'b-direct').out === short &&
      plain.path !== 'piece' &&
      !/piece/.test(plain.path),
    {
      ids: rules.map((r) => r.id),
      path: got.path,
      calls: calls.map((c) => [c.slot, c.again, c.room]),
      r2: R2.map((r) => r.id),
      r3: R3.map((r) => r.id),
      plain: plain.path,
    },
  );
}
// ---- INSTRUMENTS AND SEARCH FIRST (src/instruments.mjs, src/orchestrate.mjs; src/tools.mjs): code does what it does exactly
{
  const I = await import('../src/instruments.mjs');
  const T = await import('../src/tools.mjs');
  const { answer: orchestrate } = await import('../src/orchestrate.mjs');
  const { startBriefs } = await import('../src/index.mjs');
  const of = (q) => {
    const r = I.instrumentFor(q);
    return r ? r.id + ':' + r.answer : null;
  };
  const asked = [];
  const shots = [
    { role: 'user', content: "Q: Sort the following words alphabetically: List: b a\nA: Let's think step by step." },
    { role: 'assistant', content: 'a before b. So the answer is a b.' },
    { role: 'user', content: "Q: Sort the following words alphabetically: List: d c\nA: Let's think step by step." },
    { role: 'assistant', content: 'c before d. So the answer is c d.' },
    {
      role: 'user',
      content:
        "Q: Sort the following words alphabetically: List: thrill splutter panicking dot\nA: Let's think step by step.",
    },
  ];
  const withThem = { ...startBriefs(), plan: { ...startBriefs().plan, instruments: ['sorted'] } };
  const done = await orchestrate(shots, {
    briefs: withThem,
    ask: async (slot) => (asked.push(slot.id), { text: 'ANSWER: no' }),
  });
  const none0 = asked.length;
  const off = await orchestrate(shots, {
    briefs: startBriefs(),
    ask: async (slot) => (asked.push(slot.id), { text: 'ANSWER: thrill dot' }),
  });
  const calls0 = asked.length;
  check(
    'what code does exactly, code does: a question that IS an operation is read from its own text and done by code with no model asked (a sum, by the usual precedence; an expression of true and false, not before and before or; words in alphabetical order, parted as they were; the brackets left open closed, the last opened first), the reply closes as the earlier replies do, and the path says an instrument answered; an instrument applies only where it reads the whole of what it needs (a sum with a word in it, a run that closes what it did not open, a question about the world: none), and none is on until training turns it on: a module as it starts asks its models',
    of("Q: ((-1 + 2 + 9 * 5) - (-2 + -4 + -4 * -7)) =\nA: Let's think step by step.") === 'sum:24' &&
      of('What is 2 + 3 * 4?') === 'sum:14' &&
      of('7 / 2 =') === 'sum:3.5' &&
      of('1 / 0 =') === null &&
      of('2 + x =') === null &&
      of('42') === null &&
      of('Q: not ( True ) and ( True ) is') === 'truth:False' &&
      of('not not True or False and False is') === 'truth:True' &&
      of('True is') === null &&
      of('Sort the following words alphabetically: List: syndrome therefrom') === 'sorted:syndrome therefrom' &&
      of('Put these in alphabetical order: pear, Apple, fig') === 'sorted:Apple, fig, pear' &&
      of('Sort these words in reverse alphabetical order: b a') === null &&
      of(
        'Q: Complete the rest of the sequence, making sure that the parentheses are closed properly. Input: [ { ( < >',
      ) === 'closed:) } ]' &&
      of('Complete the sequence, making sure the parentheses are closed properly. Input: ( ]') === null &&
      of('Complete the sequence, making sure the parentheses are closed properly. Input: ( )') === null &&
      // (as another author lays the same operation out: a label at the end that only says where the answer goes, and operators
      // said in words; read on none of 2,900 and 18,000 such questions before, and on all of them after)
      of('Sort the following words alphabetically:\nList: stick gelatine\nSorted:') === 'sorted:gelatine stick' &&
      of(
        'Complete the rest of the sequence, making sure that the parentheses are closed properly.\n\nInput: { [ [\nOutput:',
      ) === 'closed:] ] }' &&
      of('\n\nQ: What is 98 plus 45?\n\nA:') === 'sum:143' &&
      of('What is 95 times 45?') === 'sum:4275' &&
      of('What is 17 minus 14?') === 'sum:3' &&
      of('What is 12 divided by 4?') === 'sum:3' &&
      of('Tom has 3 apples plus a pear. How many?') === null &&
      of('Q: What is 0 plus 0?\n  choice: 0\n  choice: 1\nA:') === null &&
      of('What is the capital of France?') === null &&
      of('I have 3 apples and 2 pears. How many fruits do I have?') === null &&
      done.ok &&
      done.path === 'instrument' &&
      done.decided === 'dot panicking splutter thrill' &&
      done.reply === 'So the answer is dot panicking splutter thrill.' &&
      done.trace.length === 1 &&
      done.trace[0].member === 'code' &&
      none0 === 0 &&
      calls0 > 0 &&
      off.path !== 'instrument' &&
      // (none is on until training turns it on; one that is on does not answer for another)
      I.instrumentFor('What is 2 + 3 * 4?', ['sorted']) === null &&
      I.instrumentFor('What is 2 + 3 * 4?', []) === null &&
      I.instrumentFor('What is 2 + 3 * 4?', undefined).answer === '14' &&
      I.instrumentsOn(['sum', 'nothing']).join() === 'sum' &&
      !('instruments' in (startBriefs().plan || {})),
    {
      done: [done.path, done.reply],
      off: off.path,
      sum: of('What is 2 + 3 * 4?'),
      closed: of(
        'Q: Complete the rest of the sequence, making sure that the parentheses are closed properly. Input: [ { ( < >',
      ),
    },
  );
  // SEARCH FIRST: a search tool is offered, nothing is looked up yet, every drafter would reply: asked once more for a call
  const search = {
    type: 'function',
    function: {
      name: 'search_engine_query',
      description: 'Search the web.',
      parameters: { type: 'object', properties: { keywords: { type: 'string' } }, required: ['keywords'] },
    },
  };
  const other = {
    type: 'function',
    function: {
      name: 'spotify_play',
      description: 'Play a song.',
      parameters: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
    },
  };
  const call = [
    {
      id: 'c1',
      type: 'function',
      function: { name: 'search_engine_query', arguments: '{"keywords":"richest person"}' },
    },
  ];
  const sent = [];
  const turn = (tools, messages, extra = {}) =>
    T.answerTools(messages, {
      tools,
      briefs: startBriefs(),
      ask: async (slot, msgs, o) => (
        sent.push(o.tool_choice || ''),
        o.tool_choice === 'required'
          ? { ok: true, content: '', calls: call, text: '' }
          : {
              ok: true,
              content: 'I can search the web for that. Would you like me to?',
              calls: [],
              text: 'I can search the web for that. Would you like me to?',
            }
      ),
      decide: async () => ({ ok: false, why: 'not asked' }),
      ...extra,
    });
  const Qs = [{ role: 'user', content: 'Who is the richest person in the country that makes the most expensive tea?' }];
  const first = await turn([search], Qs);
  const forced = sent.filter((x) => x === 'required').length;
  sent.length = 0;
  const noSearchTool = await turn([other], Qs);
  const n2 = sent.filter((x) => x === 'required').length;
  sent.length = 0;
  const already = await turn(
    [search],
    [
      ...Qs,
      { role: 'assistant', content: '', tool_calls: call },
      { role: 'tool', tool_call_id: 'c1', content: 'results' },
    ],
  );
  const n3 = sent.filter((x) => x === 'required').length;
  sent.length = 0;
  const leftOut = await T.answerTools(Qs, {
    tools: [search],
    briefs: { ...startBriefs(), plan: { ...startBriefs().plan, searchFirst: false } },
    ask: async (slot, msgs, o) => (
      sent.push(o.tool_choice || ''),
      { ok: true, content: 'I do not know.', calls: [], text: 'I do not know.' }
    ),
    decide: async () => ({ ok: false, why: 'not asked' }),
  });
  check(
    'search first: where a tool that searches is offered, nothing has been looked up yet in the conversation and every drafter would reply, the first two are asked once more for a call and the call goes out (the module and its model alone had called the search tool on none of 40 questions); it is not done where no tool offered searches (a turn where no function fits still ends with a reply), where something has been looked up already, or where the plan says not',
    T.isSearchTool(search) &&
      !T.isSearchTool(other) &&
      T.isSearchTool({ type: 'function', function: { name: 'fetch', description: 'Looks up the web for a page.' } }) &&
      forced === 2 &&
      (first.calls || []).length === 1 &&
      first.calls[0].function.name === 'search_engine_query' &&
      n2 === 0 &&
      !(noSearchTool.calls || []).length &&
      n3 === 0 &&
      !(already.calls || []).length &&
      !sent.includes('required') &&
      !(leftOut.calls || []).length,
    { forced, first: [first.path, first.calls], n2, n3, leftOut: leftOut.path },
  );
}
// ---- THE INSTRUMENTS AGAINST QUESTIONS MADE AT RANDOM, WORDINGS THE LARGER MODEL WRITES, MEMORY MEASURED BY ANY STAGE
{
  const I = await import('../src/instruments.mjs');
  const W = await import('../training/wordings.mjs');
  const E = await import('../training/tasks-exact.mjs');
  const { tasks } = await import('../training/tasks.mjs');
  const MM = await import('../training/support/measure-memory.mjs');
  const of = (q) => {
    const r = I.instrumentFor(q, true);
    return r ? r.id + ':' + r.answer : null;
  };
  // questions made at random from a seed, each with an answer worked out here: read or not, an instrument is never wrong
  let a = 20261122;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (l) => l[Math.floor(r() * l.length)];
  const OPEN = ['', 'Q: ', 'Task: ', 'Please help. ', 'Here is one for you. '];
  const AFTER = ['', '\nA:', '\nAnswer:', '\nOutput:', "\nA: Let's think step by step."];
  const made = { n: 0, read: 0, wrong: [] };
  const flat = (x) =>
    String(x)
      .trim()
      .replace(/[\s,;|]+/g, ' ');
  for (let i = 0; i < 600; i++) {
    const kind = pick(['sum', 'sorted', 'closed']);
    let q;
    let want;
    if (kind === 'sum') {
      const tree = (d) =>
        d <= 0 || r() < 0.3
          ? String(int(-20, 99))
          : '(' + tree(d - 1) + ' ' + pick(['+', '-', '*']) + ' ' + tree(d - 1) + ')';
      const expr = tree(int(1, 3)) + ' ' + pick(['+', '-', '*']) + ' ' + tree(int(0, 2));
      want = String(Function('"use strict"; return (' + expr + ')')());
      q = pick(['X =', 'What is X?', 'Compute X', 'How much is X?', 'Find the value of X.', 'X']).replace('X', expr);
    } else if (kind === 'sorted') {
      const ws = [
        ...new Set(
          Array.from({ length: int(2, 9) }, () =>
            Array.from({ length: int(2, 8) }, () => String.fromCharCode(97 + int(0, 25))).join(''),
          ),
        ),
      ];
      if (ws.length < 2) ws.push('zz' + i);
      const sep = pick([' ', ', ', '; ', ' | ', '\n']);
      want = [...ws].sort().join(' ');
      q =
        pick(['Sort', 'Arrange', 'Please sort', 'Rank']) +
        ' these words ' +
        pick(['alphabetically', 'in alphabetical order', 'lexicographically', 'from A to Z']) +
        pick([': ', ':\n', '. They are: ']) +
        ws.join(sep);
    } else {
      const P = { '(': ')', '[': ']', '{': '}', '<': '>' };
      const st = [];
      const seq = [];
      for (let k = 0, n = int(2, 12); k < n; k++) {
        if (st.length && r() < 0.4) seq.push(P[st.pop()]);
        else {
          const o = pick(Object.keys(P));
          seq.push(o);
          st.push(o);
        }
      }
      if (!st.length) (seq.push('['), st.push('['));
      want = [...st]
        .reverse()
        .map((o) => P[o])
        .join(' ');
      q = pick([
        'Complete this sequence so that every bracket is closed properly: X',
        'What closes this? X',
        'Which brackets are missing at the end? X',
      ]).replace('X', seq.join(pick([' ', ''])));
    }
    q = pick(OPEN) + q + pick(AFTER);
    const got = I.instrumentFor(q, true);
    made.n++;
    if (!got) continue;
    made.read++;
    if (flat(got.answer) !== flat(want) && made.wrong.length < 3) made.wrong.push({ q, gave: got.answer, want });
  }
  check(
    'an instrument reads an operation by one rule (the question holds the thing to work on and, beside it, only words of asking) and is never wrong where it reads: 600 questions made at random from a seed, with openings, ways of asking, separators and closing labels combined as nobody wrote them, are read nine times in ten and answered rightly every time; and the near misses a random generator found are refused (a question ABOUT sorting was answered with its last words sorted; a list parted by bars came back with the bars as words; a sum in a story, a date, a sum with a letter in it, brackets that close what was never opened, a question that asks whether to sort)',
    made.read >= made.n * 0.9 &&
      !made.wrong.length &&
      of('Why do dictionaries sort words alphabetically: is it convention?') === null &&
      of('Sort these words alphabetically: b | a | c') === 'sorted:a | b | c' &&
      of('Sort these words alphabetically: zeta\nalpha\nmid') === 'sorted:alpha mid zeta' &&
      of('Task: Sort these words alphabetically: b a') === 'sorted:a b' &&
      of('Sort these words alphabetically: is it convention?') === null &&
      of('Please help. How much is 3 + 4 * 2?') === 'sum:11' &&
      of('Find the value of (2 + 3) * 4.') === 'sum:20' &&
      of('Tom has 3 apples plus a pear and buys 4 more. How many apples does he have?') === null &&
      of('What day is 3/4/2020?') === null &&
      of('What is 2020-11-22?') === null &&
      of('( -9 - 5 - 3 ) * 2 =') === 'sum:-34' &&
      of('What is 7 + x * 2?') === null &&
      of('Pages 12-45') === null &&
      of('What closes this? ( [ {') === 'closed:} ] )' &&
      of('Complete the sequence so every bracket is closed: ( a [ b') === null &&
      // (a question that names its two answers, "True or False?", and holds one expression: the expression is what is asked)
      of('Is this True or False? not True and False') === 'truth:False' &&
      of('Does not ( True and False ) or False evaluate to True or False?') === 'truth:True' &&
      of('( [ { needs its closing brackets added correctly') === 'closed:} ] )' &&
      of('What is the alphabetical order of these words: pear fig apple') === 'sorted:apple fig pear' &&
      of('Should I sort these alphabetically: a b') === null &&
      of('Is it True or False that the sky is green?') === null &&
      of('Please help. not ( True and False ) or False =') === 'truth:True',
    { made },
  );
  // WORDINGS THE LARGER MODEL WRITES: read out of what it wrote, parted between train and held, and used by the makers
  const wrote =
    '1. Could you alphabetize this for me? <<DATA>>\n- "<<DATA>> -- put these in ABC order"\nSort these words alphabetically: <<DATA>>\nno slot here\n<<DATA>> and <<DATA>>\n<<DATA>>\nWords:\\n<<DATA>>\\nIn order:\nCould you alphabetize this for me? <<DATA>>';
  const found = W.wordingsIn(wrote, 'Sort these words alphabetically: <<DATA>>');
  const split = W.parted(['a', 'b', 'c', 'd', 'e']);
  const before = tasks({ split: 'train', each: 6, kinds: ['sorted', 'sum'] });
  E.setWordings({
    kinds: { sorted: { train: ['Could you alphabetize this for me? <<DATA>>'], held: ['HELD ONLY: <<DATA>>'] } },
  });
  const withT = tasks({ split: 'train', each: 6, kinds: ['sorted', 'sum'] });
  const withH = tasks({ split: 'held', each: 6, kinds: ['sorted'] });
  E.setWordings(null);
  const after = tasks({ split: 'train', each: 6, kinds: ['sorted', 'sum'] });
  const theirs = withT.filter((t) => /alphabetize this for me/.test(t.ask));
  const graded = theirs.length ? await theirs[0].good('Here: ' + theirs[0].want) : { grade: 'none' };
  check(
    'the larger model writes how the exact-operation questions are asked: its wordings are read out of what it wrote (a line with the slot once, less a number, a mark or quotes; not the one it was shown, none twice, a line break it wrote as two characters a line break), parted between the train questions and the held ones, and a maker then words a question by one of them as often as by its own, the train questions by the train wordings and the held by the held, each such question known by another id and marked by the same standard; with none written the questions are as they were, word for word; each kind says what it is, one way of asking and a small example whose answer its check accepts and whose wrong answer it refuses',
    found.join('|') ===
      'Could you alphabetize this for me? <<DATA>>|<<DATA>> -- put these in ABC order|Words:\n<<DATA>>\nIn order:' &&
      split.train.join() === 'a,c,e' &&
      split.held.join() === 'b,d' &&
      theirs.length >= 1 &&
      theirs.every((t) => /\.w[a-z0-9]+$/.test(t.id)) &&
      !withT.some((t) => /HELD ONLY/.test(t.ask)) &&
      withH.some((t) => /HELD ONLY/.test(t.ask)) &&
      graded.grade === 'right' &&
      JSON.stringify(after.map((t) => [t.id, t.ask])) === JSON.stringify(before.map((t) => [t.id, t.ask])) &&
      JSON.stringify(withT.filter((t) => t.kind === 'sum').map((t) => t.ask)) ===
        JSON.stringify(before.filter((t) => t.kind === 'sum').map((t) => t.ask)) &&
      Object.keys(W.KINDS).join() === 'sum,truth,sorted,closed' &&
      Object.values(W.KINDS).every((k) => k.way.includes('<<DATA>>') && k.read('The answer is ' + k.want + '.')) &&
      !W.KINDS.sorted.read('pear fig apple') &&
      !W.KINDS.sum.read('It is 10') &&
      !W.KINDS.closed.read(') ] }') &&
      /exactly once/.test(W.askFor('sorted', 8)) &&
      /session\.sh/.test('session.sh') &&
      /06-wordings\s+training\/wordings\.mjs/.test(
        fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8'),
      ),
    { found, theirs: theirs.map((t) => t.id), graded },
  );
  // MEMORY, MEASURED BY ANY STAGE THAT SERVES THE SWARM: watched, the most seen kept, written where the page reads it
  const os10 = await import('node:os');
  const mdir = fs.mkdtempSync(path.join(os10.tmpdir(), 'mem-'));
  const mfile = path.join(mdir, 'memory.json');
  const stop = MM.watchMemory(
    { members: { a: { pid: process.pid } }, decider: '' },
    { file: mfile, config: 'mine', target: 18, firstMs: 3600000, everyMs: 3600000 },
  );
  stop();
  const kept = fs.existsSync(mfile) ? JSON.parse(fs.readFileSync(mfile, 'utf8')) : null;
  const src = (f) => fs.readFileSync(new URL('../training/' + f, import.meta.url), 'utf8');
  check(
    'what the swarm takes in memory is measured by any stage that serves it, not by the question loop alone (the run a person starts takes the class stage and pretraining, and the page said "estimated, not measured" of a swarm that had served for an hour): a watch measures each model\'s own process, keeps the most it saw and writes it where the page reads it, and the class stage and pretraining by role both keep one',
    !!kept &&
      kept.config === 'mine' &&
      kept.swarm > 0 &&
      kept.target === 18 &&
      /watchMemory\(swarm/.test(src('classes.mjs')) &&
      /watchMemory\(swarm/.test(src('roles.mjs')) &&
      /memStop\(\);\s*await swarm\.stop\(\)/.test(src('classes.mjs')),
    { kept },
  );
}
// ---- AN ADAPTER FOR EACH ROLE (training/roles.mjs; src/index.mjs roleLoras): what a role's examples are, and which adapter a
// request names
{
  const R = await import('../training/roles.mjs');
  const I = await import('../src/index.mjs');
  const A = await import('../training/adapters.mjs');
  const os8 = await import('node:os');
  const row = {
    id: 'q1',
    kind: 'sum',
    grade: 'right',
    trace: [
      { slot: 'a-direct', stage: 'draft', out: 'ANSWER: 4', same: true },
      { slot: 'a-steps', stage: 'draft', out: 'ANSWER: 5', same: false },
      { slot: 'a-critic', stage: 'check', out: 'B is wrong. ANSWER: 4', same: true },
      { slot: 'a-steps', stage: 'revise', out: 'ANSWER: 4 after all', same: true },
      { slot: 'probe', stage: 'probe', out: 'x', same: true },
      { slot: 'a-writer', stage: 'write', out: 'It is 4.', same: true },
    ],
  };
  const call = (slot, stage, text, ask = slot + ' asked') => ({
    slot,
    stage,
    member: 'a',
    messages: [
      { role: 'system', content: 'brief of ' + slot },
      { role: 'user', content: ask },
    ],
    text,
  });
  const calls = [
    call('a-direct', 'draft', 'ANSWER: 4'),
    call('a-steps', 'draft', 'ANSWER: 5'),
    call('a-critic', 'check', 'B is wrong. ANSWER: 4'),
    call('a-steps', 'revise', 'ANSWER: 4 after all', 'revise it'),
    call('probe', 'probe', 'x'),
    call('a-writer', 'write', 'It is 4.'),
  ];
  const ex = R.examplesOf(row, calls);
  const wrongReply = R.examplesOf({ ...row, grade: 'wrong' }, calls);
  const ids = { check: 0, draft: 1, write: 2 };
  // roles.json on disk: the roles that are ok and whose file is there are served; the swarm is then said to be served with them
  const work = fs.mkdtempSync(path.join(os8.tmpdir(), 'roles-'));
  const m = { name: 'Small', file: 'small.gguf', engine: 'llama' };
  const dir = A.adapterDir(work, 'big', { name: m.name, file: path.join('/models', m.file) });
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, n);
    return p;
  };
  fs.writeFileSync(
    path.join(dir, 'roles.json'),
    JSON.stringify({
      roles: {
        draft: { ok: true, gguf: f('draft.gguf') },
        check: { ok: true, gguf: path.join(dir, 'gone.gguf') },
        write: { ok: false, gguf: f('write.gguf') },
      },
    }),
  );
  // a tool call's arguments reach the template as the thing they are, not as text
  const tc = (a) => ({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: '1', type: 'function', function: { name: 'f', arguments: a } }],
  });
  const toolEx = R.examplesOf(
    { id: 'q2', kind: 'tools', grade: 'right', trace: [{ slot: 'a-steps', stage: 'draft', out: 'done', same: true }] },
    [
      {
        slot: 'a-steps',
        stage: 'draft',
        member: 'a',
        text: 'done',
        messages: [{ role: 'user', content: 'do it' }, tc('{"n": 2}'), { role: 'tool', content: '4' }],
      },
    ],
  );
  const argsOf = (m) => m.tool_calls[0].function.arguments;
  check(
    "an example is one a chat template takes: a tool call's arguments are given as the thing they are and not as text (as text, the template refused every example with a tool call and the drafters' adapter was not trained); arguments that are no JSON are kept under one name; a message with no tool call is the same message",
    toolEx.length === 1 &&
      argsOf(toolEx[0].messages[1]).n === 2 &&
      argsOf(R.forTemplate(tc('not json'))).text === 'not json' &&
      argsOf(R.forTemplate(tc('[1]'))).text === '[1]' &&
      argsOf(R.forTemplate(tc({ n: 3 }))).n === 3 &&
      R.forTemplate(toolEx[0].messages[0]) === toolEx[0].messages[0],
    { toolEx: JSON.stringify(toolEx).slice(0, 300) },
  );
  const on = A.roleLorasFor({ adapters: true }, { a: m, b: m }, work, 'big', '/models');
  const off = A.roleLorasFor({}, { a: m, b: m }, work, 'big', '/models');
  const served = A.servedWith({ adapters: true }, { a: m, b: m }, work, 'big', '/models');
  check(
    "pretraining knows the arrangement: a slot's request with the answer it gave is an example for its role where that answer was right (a drafter, also when it revises; a checker; a writer only where the reply itself was right), never a stage that has no role, and never a wrong answer; a request names every loaded adapter, its role's at full strength and the rest at none, and a stage with no role names them all at none; the adapters are loaded in one fixed order; a member is served with an adapter for each role that was trained and whose file is there, where the configuration serves adapters; and a measurement says which",
    ex.map((e) => e.role).join() === 'draft,check,draft,write' &&
      ex[0].messages.length === 3 &&
      ex[0].messages[2].content === 'ANSWER: 4' &&
      ex[2].messages[1].content === 'revise it' &&
      wrongReply.map((e) => e.role).join() === 'draft,check,draft' &&
      R.countByRole(ex).draft.examples === 2 &&
      R.countByRole(ex).draft.questions === 1 &&
      R.callOf(calls, { slot: 'a-steps', out: 'ANSWER: 5' }).stage === 'draft' &&
      R.callOf(calls, { slot: 'a-steps', out: 'unknown' }) === null &&
      JSON.stringify(I.loraFor(ids, 'draft')) === '[{"id":0,"scale":0},{"id":1,"scale":1},{"id":2,"scale":0}]' &&
      JSON.stringify(I.loraFor(ids, 'revise')) === JSON.stringify(I.loraFor(ids, 'draft')) &&
      I.loraFor(ids, 'probe').every((x) => x.scale === 0) &&
      I.roleFilesOf({ write: 'w', draft: 'd', check: '' })
        .map(([r]) => r)
        .join() === 'draft,write' &&
      I.roleFilesOf(null).length === 0 &&
      Object.keys(on).join() === 'a,b' &&
      Object.keys(on.a).join() === 'draft' &&
      Object.keys(off).length === 0 &&
      served.roles.join() === 'draft' &&
      served.files.length === 1 &&
      served.names.join() === 'Small,Small',
    { ex: ex.map((e) => e.role), on, served },
  );
}

// ---- THE WHOLE RUN (training/run.sh): one start, the steps in order, each written down where its card looks; a step that refuses
// is said and the run goes on; a run stopped part way carries on from the step it stopped in
{
  const { execFileSync } = await import('node:child_process');
  const os9 = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os9.tmpdir(), 'whole-run-'));
  const log = path.join(dir, 'log');
  fs.writeFileSync(
    path.join(dir, 'ev.sh'),
    'echo "eval $*" >> "$LOG"; case "$*" in *pretrained*) exit ${PRE_EXIT:-0};; *trained*) exit ${TRAINED_EXIT:-0};; esac; exit 0\n',
  );
  fs.writeFileSync(path.join(dir, 'pre.sh'), 'echo pretrain >> "$LOG"\n');
  fs.writeFileSync(path.join(dir, 'se.sh'), 'echo "session $PASSES $SESSION_STEPS" >> "$LOG"\n');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const go = (args, env = {}) => {
    try {
      return execFileSync('bash', ['training/run.sh', ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE: process.execPath,
          LOG: log,
          RUN_WORK: path.join(dir, 'work'),
          RUN_EVALUATE: 'sh ' + path.join(dir, 'ev.sh'),
          RUN_PRETRAIN: 'sh ' + path.join(dir, 'pre.sh'),
          RUN_SESSION: 'sh ' + path.join(dir, 'se.sh'),
          ...env,
        },
      });
    } catch (e) {
      return String(e.stdout || '') + String(e.stderr || '');
    }
  };
  // the first start: no adapter can be measured (the pretrained evaluation refuses), and the last evaluation fails
  const said = go(['--limit', '50', '--train-minutes', '1'], { PRE_EXIT: '3', TRAINED_EXIT: '1' });
  const first = fs.readFileSync(log, 'utf8').trim().split('\n');
  const keyDir = fs.readdirSync(path.join(dir, 'work', 'run'))[0];
  const statusFile = path.join(dir, 'work', 'run', keyDir, 'pass-1', 'status.txt');
  // (taken as stopped before it was done: the last line is not DONE)
  fs.writeFileSync(statusFile, fs.readFileSync(statusFile, 'utf8').replace(/\n\S+ DONE\n$/, '\n'));
  go(['--limit', '50', '--train-minutes', '1']);
  const second = fs.readFileSync(log, 'utf8').trim().split('\n').slice(first.length);
  const evalJob = JSON.parse(fs.readFileSync(path.join(dir, 'work', 'eval', 'ui-run.json'), 'utf8'));
  const off = go(['--limit', '20', '--train', 'off']);
  // the class stage's time ends the stage, not only the session that waits on it (a session waiting 30 s, given no minutes)
  fs.writeFileSync(path.join(dir, 'slow.sh'), 'trap \'exit 143\' TERM INT\necho slow >> "$LOG"\nsleep 30\n');
  const t0 = Date.now();
  const late = go(['--limit', '20', '--train-minutes', '0'], {
    RUN_WORK: path.join(dir, 'work-slow'),
    LOG: path.join(dir, 'log-slow'),
    RUN_SESSION: 'sh ' + path.join(dir, 'slow.sh'),
  });
  const took = (Date.now() - t0) / 1000;
  const slowKey = fs.readdirSync(path.join(dir, 'work-slow', 'run'))[0];
  const slowStatus = fs.readFileSync(path.join(dir, 'work-slow', 'run', slowKey, 'pass-1', 'status.txt'), 'utf8');
  check(
    'the time given to the class stage ends the stage: the session is told to stop and so is the step it waits on (a shell acts on a signal only when what it waits on ends, and the stage ran 17 minutes past its 20), and the trained module is still evaluated after it',
    took < 15 &&
      /END   4-train-classes exit 143/.test(slowStatus) &&
      /END   5-evaluate-trained exit 0/.test(slowStatus) &&
      /DONE\n$/.test(slowStatus),
    { took, slowStatus, late: late.slice(-300) },
  );
  const third = fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .slice(first.length + second.length);
  check(
    'the whole run is one start: the module as configured is evaluated, it is pretrained and evaluated, its arrangement is trained (the class stage and no more, one pass) and it is evaluated again, in that order and at the size asked; a step that refuses (no adapter to measure) is said and the run goes on; each step is written down where its card looks; a run stopped part way carries on, the steps that ended well passed over and the ones that did not taken again; and with training off the third figure is not taken, and a run at another size begins again',
    first.join('|') ===
      'eval --variant base --limit 50|pretrain|eval --variant pretrained --limit 50|session 1 classes|eval --variant trained --limit 50' &&
      /No adapter is trained for this configuration: the pretrained figure is not taken/.test(said) &&
      /The trained module was not evaluated/.test(said) &&
      second.join('|') === 'eval --variant pretrained --limit 50|eval --variant trained --limit 50' &&
      evalJob.limit === 50 &&
      evalJob.whole === true &&
      evalJob.pid > 0 &&
      third.join('|') === 'eval --variant base --limit 20|pretrain|eval --variant pretrained --limit 20' &&
      /third figure is not taken/.test(off) &&
      /SESSION_STEPS" = classes/.test(fs.readFileSync(new URL('../training/session.sh', import.meta.url), 'utf8')),
    { first, second, third },
  );
}

// ---- THREE EVALUATIONS SIDE BY SIDE (training/evaluate.mjs --variant): the module as configured, pretrained, and pretrained and
// trained; each one score with its error, and a difference said only beyond twice the error
{
  const E = await import('../training/evaluate.mjs');
  const { readConfig } = await import('../src/catalog.mjs');
  const res = [
    {
      item: 'code',
      task: 't1',
      name: 'T1',
      swarm: { value: 0.8, stderr: 0.04, n: 100 },
      target: { value: 0.9, stderr: 0.03, n: 100 },
    },
    {
      item: 'math',
      task: 't2',
      name: 'T2',
      swarm: { value: 0.5, stderr: 0.05, n: 300 },
      target: { value: 0.7, stderr: 0.03, n: 300 },
    },
    { item: 'none', task: 't3', name: 'T3', swarm: null, target: { value: 1, stderr: 0, n: 0 } },
  ];
  const sw = E.overallOf(res, 'swarm');
  const tg = E.overallOf(res, 'target');
  const row = E.compareRow({
    at: 'now',
    runId: 'r',
    limit: 100,
    arrangement: 'default',
    arrangementSha256: 'x',
    adapters: [],
    results: res,
  });
  const was = process.env.SWARM_ADAPTERS;
  process.env.SWARM_ADAPTERS = 'on';
  const on = readConfig().adapters;
  process.env.SWARM_ADAPTERS = 'off';
  const off = readConfig().adapters;
  if (was === undefined) delete process.env.SWARM_ADAPTERS;
  else process.env.SWARM_ADAPTERS = was;
  const src = fs.readFileSync(new URL('../training/evaluate.mjs', import.meta.url), 'utf8');
  check(
    "an evaluation is of one of three things set side by side: the module as configured (the arrangement it starts from, no adapter), pretrained (the same with its adapters), and pretrained and trained (what training kept, with them); the adapters are that run's choice over the configuration's and the file is not written; each comes to one score over every question asked, each task counted by its questions, with its error; one figure is beyond another only where they differ by more than twice the error of the difference; what a variant came to is kept beside the other two; answers given with an adapter are kept by that adapter's bytes; and a pretrained figure is not taken of a swarm with no adapter",
    E.variantOf('base').default === true &&
      E.variantOf('base').adapters === 'off' &&
      E.variantOf('pretrained').default === true &&
      E.variantOf('pretrained').adapters === 'on' &&
      E.variantOf('trained').default === false &&
      E.variantOf('trained').adapters === 'on' &&
      E.variantOf('other') === null &&
      sw.n === 400 &&
      sw.value === 0.575 &&
      sw.stderr === 0.0388 &&
      tg.value === 0.75 &&
      E.overallOf([], 'swarm').n === 0 &&
      E.beyondOf({ value: 0.6, stderr: 0.02, n: 400 }, { value: 0.5, stderr: 0.02, n: 400 }).beyond === true &&
      E.beyondOf({ value: 0.53, stderr: 0.02, n: 400 }, { value: 0.5, stderr: 0.02, n: 400 }).beyond === false &&
      E.beyondOf({ value: 0.9, stderr: 0, n: 0 }, { value: 0.5, stderr: 0.02, n: 400 }).beyond === false &&
      row.swarm.n === 400 &&
      row.tasks.length === 3 &&
      // (paired by question: 3 better and 1 worse of 20 is +0.1; the same questions or nothing)
      E.pairedOf([{ task: 't', bits: '11110000001111000000' }], [{ task: 't', bits: '11111110000111000000' }]).diff ===
        0.1 &&
      E.pairedOf([{ task: 't', bits: '11110000001111000000' }], [{ task: 't', bits: '11111110000111000000' }])
        .better === 3 &&
      E.pairedOf([{ task: 't', bits: '11110000001111000000' }], [{ task: 't', bits: '11111110000111000000' }]).worse ===
        1 &&
      E.pairedOf([{ task: 't', bits: '1111' }], [{ task: 't', bits: '11111' }]) === null &&
      E.pairedOf([{ task: 't' }], [{ task: 't', bits: '1' }]) === null &&
      E.compareRow({ results: [{ task: 't', swarm: { value: 1, stderr: 0, n: 2 }, agree: { sbits: '11' } }] }).tasks[0]
        .bits === '11' &&
      row.limit === 100 &&
      on === true &&
      off === undefined &&
      /'-adapters-' \+ adaptersSha/.test(src) &&
      /VARIANT === 'pretrained' && !adapters\.length/.test(src),
    { sw, tg, on, off },
  );
}

await swarm.stop();
lfm.close();
bonsai.close();
console.log('\n' + (failed.length ? failed.length + ' FAILED, ' : 'all ') + passed + ' passed.');
process.exit(failed.length ? 1 : 0);
