// bfcl.mjs - THE TOOL TESTS: a second harness beside lm-evaluation-harness (training/evaluate.mjs). Calling a function, and using a
// search tool, are capabilities a SwOA proves (docs/swoa-parity.md), and lm-evaluation-harness has no task for either. The
// Berkeley Function-Calling Leaderboard does: its own package (bfcl-eval, pinned below, installed by training/evaluate.sh into
// .work/bfcl), its own questions, functions, checker and scores. It is asked of the larger model and of the swarm in turn, each
// offered the same functions in the same request, and their answers are paired question by question.
//
// HOW IT IS POINTED AT A MODEL HERE. The package asks the models it has registered, each through a handler. One of them speaks plain
// chat completions with `tools` to whatever address OPENAI_BASE_URL names (BFCL_MODEL below); the others speak to their makers'
// services or load weights themselves. So that one is the name the package is given, for the larger model and for the swarm alike,
// and the address is a relay (toolRelay below) in front of the model being asked. The name says nothing of what answered: the
// folder its answers are kept in does.
//
// THE RELAY sends on the conversation and the functions as they came, and nothing of its own: temperature 0, room for 4096 tokens.
// What comes back is the model's message as it gave it: its calls, or its reply.
//   idsOf(category)                        -> every question's id, in the package's order
//   bfclRun({ root, category, ids, base }) -> the package's generate, then evaluate, with `root` as its folder; resolves to
//                                             { ok, why }
//   bfclFiles(root, category)              -> { results, score } (paths), or null where it was not asked to the end
//   bfclScore(root, category)              -> { value, stderr, n, of, asked: [ids], right: [ids], wrong: [ids], why: { id: words } }
//   askToolsAt(base), askWrittenAt(base)   -> a model asked a step with tools: the tools in the request, or written into the
//                                             conversation and its calls read from its reply (below: why the second)
//   askAfterAt(base), formAfter(messages)  -> the same, the test's words on the form of the answer moved after the question
//   pairOf(target, swarm)                  -> { of, same, bothRight, bothWrong, differ, onlyTarget, onlySwarm, examples }, the shape
//                                             support/harness_agree.py prints for the other harness
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BFCL_DIR = path.resolve(HERE, '..', '..', '.work', 'bfcl');
export const BFCL_ID = { name: 'bfcl-eval', version: '2026.3.23' };
export const BFCL = BFCL_ID.name + ' ' + BFCL_ID.version;
// (the registered model that speaks plain chat completions with tools to OPENAI_BASE_URL: see above)
export const BFCL_MODEL = 'openbmb/MiniCPM-SALA-FC';
const python = () => path.join(BFCL_DIR, 'venv', 'bin', 'python');
const program = () => path.join(BFCL_DIR, 'venv', 'bin', 'bfcl');
export const bfclInstalled = () => fs.existsSync(program());
// THE PACKAGE IS STARTED THROUGH A PROGRAM OF OURS (bfcl_search.py), with the package's own Python: where a search of this
// machine's own is named (env SWARM_SEARCH_URL), it stands behind the web search test's search function; where none is, the
// package runs exactly as it is. Either way it is the package's own command line that runs
const WRAPPER = path.join(HERE, 'bfcl_search.py');

// every question's id of a category, in the package's own order (it knows how each category's ids are made)
export function idsOf(category) {
  const r = spawnSync(
    python(),
    [
      '-I',
      '-c',
      'import json,sys\nfrom bfcl_eval.utils import load_dataset_entry\nprint(json.dumps([e["id"] for e in load_dataset_entry(sys.argv[1])]))',
      category,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error('the tool tests could not list ' + category + ': ' + String(r.stderr).trim().split('\n').pop());
  return JSON.parse(String(r.stdout).trim().split('\n').pop());
}

const linesOf = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
const find = (dir, name) => {
  let es = [];
  try {
    es = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const got = find(p, name);
      if (got) return got;
    } else if (e.name === name) return p;
  }
  return null;
};

// the files the package wrote for one category: what the model answered, and how it was scored
export function bfclFiles(root, category) {
  const results = find(path.join(root, 'result'), 'BFCL_v4_' + category + '_result.json');
  const score = find(path.join(root, 'score'), 'BFCL_v4_' + category + '_score.json');
  return results && score ? { results, score } : null;
}

// the package's score for one category, and which questions it counted right. Its score file opens with the count and then lists
// every question it counted wrong; a question asked and not listed is right
export function bfclScore(root, category, of = null) {
  const f = bfclFiles(root, category);
  if (!f) return null;
  const asked = linesOf(f.results).map((r) => r.id);
  const [head, ...failed] = linesOf(f.score);
  const wrongIds = new Set(failed.map((x) => x.id));
  const n = Number(head.total_count ?? asked.length);
  const value = typeof head.accuracy === 'number' ? head.accuracy : n ? (n - wrongIds.size) / n : null;
  return {
    value,
    stderr: n && value !== null ? Math.sqrt((value * (1 - value)) / n) : null,
    n,
    of,
    asked,
    right: asked.filter((id) => !wrongIds.has(id)),
    wrong: asked.filter((id) => wrongIds.has(id)),
    why: Object.fromEntries(
      failed.map((x) => [
        x.id,
        String(
          (x.error &&
            (Array.isArray(x.error.error_message) ? x.error.error_message.join(' ') : x.error.error_message)) ||
            (Array.isArray(x.error) ? x.error.join(' ') : x.error) ||
            '',
        ).slice(0, 160),
      ]),
    ),
  };
}

// the two models' answers, paired by question: the same verdict from the package's own checker, or not
export function pairOf(target, swarm) {
  const t = new Set(target.right);
  const s = new Set(swarm.right);
  // (the questions both were asked, in the order they were asked)
  const asked = new Set(target.asked || [...target.right, ...target.wrong]);
  const ids = (swarm.asked || [...swarm.right, ...swarm.wrong]).filter((id) => asked.has(id));
  const res = {
    of: ids.length,
    same: 0,
    bothRight: 0,
    bothWrong: 0,
    differ: 0,
    onlyTarget: 0,
    onlySwarm: 0,
    examples: [],
  };
  for (const id of ids) {
    const a = t.has(id);
    const b = s.has(id);
    if (a === b) {
      res.same += 1;
      if (a) res.bothRight += 1;
      else res.bothWrong += 1;
    } else {
      res.differ += 1;
      if (a) res.onlyTarget += 1;
      else res.onlySwarm += 1;
      if (res.examples.length < 3)
        res.examples.push({
          doc: id,
          target: a ? 'right' : 'wrong: ' + ((target.why || {})[id] || ''),
          swarm: b ? 'right' : 'wrong: ' + ((swarm.why || {})[id] || ''),
        });
    }
  }
  // (which questions each had right, in the order they were asked: what two evaluations are paired by, question by question)
  res.tbits = ids.map((id) => (t.has(id) ? '1' : '0')).join('');
  res.sbits = ids.map((id) => (s.has(id) ? '1' : '0')).join('');
  return res;
}

// how far the package says it is, from what it printed (its progress bar: "...:  40%|####      | 2/5 [")
export function bfclProgress(text) {
  const all = [...String(text).matchAll(/\|\s*(\d+)\/(\d+)\s*\[/g)];
  return all.length ? { done: Number(all.at(-1)[1]), of: Number(all.at(-1)[2]) } : null;
}

// a conversation as the package sends it on, made plain for any server: the package hands back the model's own message as its
// client read it, with every field that client knows, most of them null
export function plainMessages(messages) {
  return (messages || []).map((m) => {
    const out = { role: m.role };
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    if (calls.length)
      out.tool_calls = calls.map((c, i) => ({
        id: c.id || 'call_' + i,
        type: 'function',
        function: {
          name: (c.function || {}).name || '',
          arguments:
            typeof (c.function || {}).arguments === 'string'
              ? c.function.arguments
              : JSON.stringify((c.function || {}).arguments || {}),
        },
      }));
    out.content = m.content === null || m.content === undefined ? (calls.length ? null : '') : m.content;
    if (m.role === 'tool') {
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      if (typeof out.content !== 'string') out.content = JSON.stringify(out.content);
    }
    return out;
  });
}

// a model's message, as any client of chat completions expects it: its calls (each with an id, its arguments as text), or its reply
let callN = 0;
export function messageOf(m) {
  const calls = (m && Array.isArray(m.tool_calls) ? m.tool_calls : []).filter(
    (c) => c && c.function && c.function.name,
  );
  if (calls.length)
    return {
      role: 'assistant',
      content: null,
      tool_calls: calls.map((c) => ({
        id: c.id || 'call_' + Date.now().toString(36) + '_' + ++callN,
        type: 'function',
        function: {
          name: String(c.function.name),
          arguments:
            typeof c.function.arguments === 'string'
              ? c.function.arguments
              : JSON.stringify(c.function.arguments || {}),
        },
      })),
    };
  return {
    role: 'assistant',
    content: String((m && m.content) || '')
      .replace(/(?:<unk>\s*)+[\s\S]*$/, '')
      .trim(),
  };
}

// one request to a model behind an address that answers as llama.cpp's server does: its message, and its count of tokens
const sendTo = async (base, { model, messages, tools, stop }) => {
  const r = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(900000),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 4096,
      stream: false,
      ...(stop ? { stop } : {}),
      ...(tools && tools.length ? { tools } : {}),
    }),
  });
  if (!r.ok) throw new Error('it answered ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return { message: (j.choices && j.choices[0] && j.choices[0].message) || {}, usage: j.usage || {} };
};

// a model asked a step with tools, the tools in the request
export const askToolsAt =
  (base, { model = 'model', stop = null } = {}) =>
  ({ messages, tools }) =>
    sendTo(base, { model, messages, tools, stop });

// ---- THE FUNCTIONS WRITTEN INTO THE CONVERSATION. A server may not return what its model wrote: the larger model first measured
// here, served by its maker's own server, wrote two and three calls where a question needed them, and its server returned the first
// alone (measured 2026-11-18: with `tools` in the request, one call a reply on every one of four such questions; with the same
// functions written into a system message and no `tools`, every call). A test that then counted it wrong would measure its
// server. So the larger model is ALSO asked this way, the way chat templates themselves write tools out: the functions in a system
// message, each call a JSON object between <tool_call> tags, and the calls read from the reply's text. Of the two ways it is
// counted by the one it scores higher by (training/evaluate.mjs). The swarm is asked the one way: its own runtime returns every
// call, and `tools` in the request is the interface it is measured through.
export const WRITTEN_LEAD =
  'You may call one or more functions to assist with the user query.\n\nYou are provided with function signatures within <tools></tools> XML tags:\n<tools>\n';
export const WRITTEN_TAIL =
  '\n</tools>\n\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n' +
  '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>';
const callText = (c) => {
  let args = {};
  try {
    args = JSON.parse((c.function || {}).arguments || '{}');
  } catch {
    /* arguments that are not JSON: written as none */
  }
  return '<tool_call>\n' + JSON.stringify({ name: (c.function || {}).name || '', arguments: args }) + '\n</tool_call>';
};
// the conversation, with its functions written in and every earlier call and result written out as text
export function writtenMessages(messages, tools) {
  const out = [];
  const lead =
    tools && tools.length ? WRITTEN_LEAD + tools.map((t) => JSON.stringify(t)).join('\n') + WRITTEN_TAIL : '';
  const all = messages || [];
  const own = all.length && all[0].role === 'system' ? String(all[0].content || '') : '';
  if (own || lead) out.push({ role: 'system', content: [own, lead].filter(Boolean).join('\n\n') });
  for (const m of all.length && all[0].role === 'system' ? all.slice(1) : all) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length)
      out.push({
        role: 'assistant',
        content: [m.content || '', ...m.tool_calls.map(callText)].filter(Boolean).join('\n'),
      });
    else if (m.role === 'tool')
      out.push({ role: 'user', content: '<tool_response>\n' + String(m.content ?? '') + '\n</tool_response>' });
    else out.push({ role: m.role, content: m.content ?? '' });
  }
  return out;
}
// the calls a reply wrote out, each a JSON object between <tool_call> tags: [{ function: { name, arguments } }] (none: a reply)
export function callsWritten(text) {
  const calls = [];
  for (const m of String(text || '').matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j && typeof j.name === 'string' && j.name)
        calls.push({ function: { name: j.name, arguments: JSON.stringify(j.arguments ?? j.parameters ?? {}) } });
    } catch {
      /* not a call that can be read: left out */
    }
  }
  return calls;
}
// a model asked a step with its functions written into the conversation, and its calls read from what it wrote
export const askWrittenAt =
  (base, { model = 'model', stop = null } = {}) =>
  async ({ messages, tools }) => {
    const got = await sendTo(base, { model, messages: writtenMessages(messages, tools), stop });
    const text = String(got.message.content || '');
    // (a server that parsed a call all the same: its calls stand beside what the text holds)
    const calls = [...(Array.isArray(got.message.tool_calls) ? got.message.tool_calls : []), ...callsWritten(text)];
    return { message: calls.length ? { content: null, tool_calls: calls } : { content: text }, usage: got.usage };
  };

// ---- THE FORM OF THE ANSWER SAID AFTER THE QUESTION. The web search test tells a model, in a system message, the form its final
// answer must take ("... If you do not know the answer, respond with ..."). A model may read that as its whole instruction and
// answer at once, never searching: the larger model first measured here did (measured 2026-11-19, the test's first four questions,
// the search functions offered: it searched on none with those words in a system message, on three with the question alone, and
// on all four with the same words, unchanged, after the question). A test that then counted it wrong would measure how it reads
// one message, not whether it can search. So the larger model is ALSO asked this way: nothing added and nothing reworded, the
// system message's words moved to the end of the first thing the user said. Counted, as with the functions written in, by the way
// it scores higher by over the body of work (training/evaluate.mjs).
export function formAfter(messages) {
  const all = messages || [];
  const sys = all
    .filter((m) => m.role === 'system')
    .map((m) => String(m.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const rest = all.filter((m) => m.role !== 'system');
  const first = rest.findIndex((m) => m.role === 'user');
  if (!sys || first < 0) return all;
  return rest.map((m, i) => (i === first ? { ...m, content: String(m.content ?? '') + '\n\n' + sys } : m));
}
// a model asked a step with tools in the request, the test's words on the form of its answer after the question
export const askAfterAt =
  (base, { model = 'model', stop = null } = {}) =>
  ({ messages, tools }) =>
    sendTo(base, { model, messages: formAfter(messages), tools, stop });

// THE RELAY, for a step with tools: the package's client talks to this, and this to the model (ask({ messages, tools }) ->
// { message, usage }). on.ask({ excerpt }) and on.answer({ excerpt, seconds }) say what it is doing, for the page
export function toolRelay(ask, on = {}) {
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', async () => {
      const send = (code, body) => {
        const s = JSON.stringify(body);
        res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
        res.end(s);
      };
      try {
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const messages = plainMessages(body.messages);
        const last = messages.at(-1) || {};
        const t0 = Date.now();
        (on.ask || (() => {}))({
          excerpt: String(last.content || '').slice(-600),
          first: !messages.some((m) => m.role === 'assistant' || m.role === 'tool'),
        });
        const got = await ask({ messages, tools: Array.isArray(body.tools) ? body.tools : [] });
        const message = messageOf(got.message);
        const said = message.tool_calls
          ? message.tool_calls.map((c) => 'CALL ' + c.function.name + ' ' + c.function.arguments).join('\n')
          : message.content;
        (on.answer || (() => {}))({ excerpt: String(said).slice(0, 600), seconds: (Date.now() - t0) / 1000 });
        const u = got.usage || {};
        send(200, {
          id: 'relay-' + t0,
          object: 'chat.completion',
          created: Math.floor(t0 / 1000),
          model: String(body.model || ''),
          choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
          usage: {
            prompt_tokens: Number(u.prompt_tokens) || 0,
            completion_tokens: Number(u.completion_tokens) || 0,
            total_tokens: Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
          },
        });
      } catch (e) {
        (on.error || (() => {}))(String((e && e.message) || e));
        send(502, { error: { message: String((e && e.message) || e) } });
      }
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({
        base: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    ),
  );
}

// ONE CATEGORY THROUGH THE PACKAGE, for the model behind `base`: its answers (generate), then its score (evaluate), both under
// `root`, the folder the package is told is its own. ids: the questions to ask (none: every one). env: more of its environment
// (the search behind the web search test: support/search.mjs searchEnv). onChild(child) hands over the
// process running, so that it can be stopped; onSaid(text, step) what it has printed in this step ('generate', 'evaluate')
export function bfclRun({ root, category, ids = null, base, env = {}, onChild = () => {}, onSaid = () => {} }) {
  fs.mkdirSync(root, { recursive: true });
  const some = Array.isArray(ids) && ids.length;
  if (some) fs.writeFileSync(path.join(root, 'test_case_ids_to_generate.json'), JSON.stringify({ [category]: ids }));
  const step = (args) =>
    new Promise((ok) => {
      const name = args[0];
      const child = spawn(python(), [WRAPPER, ...args], {
        env: {
          ...process.env,
          ...env,
          BFCL_PROJECT_ROOT: root,
          OPENAI_BASE_URL: base + '/v1',
          OPENAI_API_KEY: 'local',
          HF_HUB_DISABLE_TELEMETRY: '1',
          TOKENIZERS_PARALLELISM: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      onChild(child);
      let said = '';
      const take = (c) => {
        said = (said + String(c)).slice(-20000);
        onSaid(said, name);
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('close', (code) => {
        onChild(null);
        ok({ code, said });
      });
    });
  const whyOf = (r) =>
    (
      r.said
        .split(/[\r\n]+/)
        .reverse()
        .find((l) => /error|exception|failed|traceback/i.test(l)) || 'the tool tests stopped (' + r.code + ')'
    )
      .trim()
      .slice(0, 240);
  return (async () => {
    const gen = await step([
      'generate',
      '--model',
      BFCL_MODEL,
      '--test-category',
      category,
      '--num-threads',
      '1',
      '--temperature',
      '0',
      ...(some ? ['--run-ids'] : []),
    ]);
    if (gen.code !== 0) return { ok: false, why: whyOf(gen) };
    const ev = await step(['evaluate', '--model', BFCL_MODEL, '--test-category', category, '--partial-eval']);
    if (ev.code !== 0 || !bfclFiles(root, category)) return { ok: false, why: whyOf(ev) };
    return { ok: true };
  })();
}
