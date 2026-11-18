// evaluate.mjs - EVALUATE THE SWARM: how equivalent it is to the larger model, measured by a standard any lab would recognise and
// kept apart from training. For each body of work chosen under the models (training/equivalence.json, benchmarks), the standard
// tasks of EleutherAI's lm-evaluation-harness (pinned 0.4.13, installed by training/evaluate.sh into .work/lmeval) are asked of
// the larger model and then of the swarm, each through the harness's own chat client, prompts, extraction and metrics. Then
// every question's two answers are compared (support/harness_agree.py): the same answer, the same verdict on the task's tests,
// or the same instructions followed. Training never asks a benchmark's question, so this is a measurement training cannot fit.
//
// THE ONE THING DONE AROUND THE HARNESS, the same for both: some tasks open the model's reply for it (HumanEval begins
// "Here is the completed function: ```python <signature>", MBPP "```python", others "The answer is"), which a model served behind
// llama.cpp continues and the swarm cannot (its reply is put together from several models'). So each is asked without that
// opening, and its reply is turned into what would have followed it (relay below): the code it wrote, or what it said after the
// opening; then cut at the task's stop strings. The larger model's figures may therefore differ a little from published ones;
// the comparison between the two is like for like.
//
// While it runs it writes .work/eval/live.json (what it is doing, the question it is on, how far each task is, how long a
// question takes); when it ends .work/eval/results.json, and a line in .work/eval/history.jsonl. The larger model's answers are
// kept (.work/eval/target/), so evaluating the swarm again asks only the swarm.
//   bash training/evaluate.sh [--limit N] [--items crew,math]    (N questions a task, the first N as the harness orders them;
//                                                                 none: every question)
//
// A SECOND HARNESS, FOR TOOLS. Calling a function and using a search tool have no task in lm-evaluation-harness. A benchmark that
// says harness "bfcl" is a category of the Berkeley Function-Calling Leaderboard (support/bfcl.mjs: the package pinned, how it is
// pointed at a model here, its relay). It is asked the same way: the larger model first and kept, then the swarm, each offered the
// same functions in the same request, and the two paired by question on the package's own verdict. A result of it names the
// harness it came from and the tools offered. A category that searches the web needs a key to a search service, which a person
// supplies (SERPAPI_API_KEY); without it that task is not asked, and says so. Its answers are kept by day: what a search returns
// changes from one day to the next, so the two models are only set beside each other where they were asked on the same day.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BFCL,
  BFCL_ID,
  SEARCH_KEY,
  bfclInstalled,
  idsOf,
  bfclRun,
  bfclFiles,
  bfclScore,
  pairOf,
  bfclProgress,
  toolRelay,
  askToolsAt,
  askWrittenAt,
} from './support/bfcl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const EVAL_DIR = process.env.SWARM_EVAL_DIR || path.join(ROOT, '.work', 'eval');
export const LMEVAL = path.join(ROOT, '.work', 'lmeval');
export const HARNESS = 'lm-evaluation-harness 0.4.13';
// (the same, as a SwOA spec's proof names a harness: docs/swoa.md)
export const HARNESS_ID = { name: 'lm-evaluation-harness', version: '0.4.13' };
// (bumped when what is done around the harness changes, so that kept answers of the larger model are not reused across it)
const RELAY_VERSION = 1;

// the tasks to run, from what is chosen: [{ item, itemName, task, name, metric, filter, compare }]
export function planOf(targets, ids) {
  const out = [];
  for (const t of targets.filter((x) => ids.includes(x.id)))
    for (const b of t.benchmarks || []) out.push({ item: t.id, itemName: t.name, ...b });
  return out;
}

// how many of a task's questions a run asks: in a proof run the size its benchmark names (proofN; 0 or none: every question), else
// the one size the run was given for every task (0: every question)
export const sizeOf = (b, { proof = false, limit = 0 } = {}) => (proof ? Number(b.proofN) || 0 : Number(limit) || 0);

// which harness a benchmark is a task of, as a SwOA's proof names one, and whether it is the tool tests
export const isToolTest = (b) => b.harness === 'bfcl';
export const harnessOf = (b) => (isToolTest(b) ? BFCL_ID : HARNESS_ID);
// the harnesses a plan needs installed: ['lmeval', 'bfcl'] (training/evaluate.sh installs each the first time)
export const needsOf = (plan) => [
  ...(plan.some((b) => !isToolTest(b)) ? ['lmeval'] : []),
  ...(plan.some(isToolTest) ? ['bfcl'] : []),
];
// a task that cannot be asked as things are, and why ('' where it can): a search test with no key to the search service
export const blockedOf = (b, env = process.env) =>
  b.needsKey && !env[b.needsKey]
    ? 'not asked: it searches the web through a service that needs a key (' + b.needsKey + '), which a person supplies'
    : '';
// THE WAYS THE LARGER MODEL IS ASKED A TOOL TEST: with the tools in the request, as the swarm is; and, where the benchmark says so
// (targetAlsoWritten), with the functions written into the conversation and its calls read from its reply (support/bfcl.mjs says
// why: a server may return only the first of the calls its model wrote). It is counted by the way it scores higher by, so that a
// result never rests on how the larger model happens to be served
export const waysOf = (b) => (isToolTest(b) && b.targetAlsoWritten ? ['tools', 'written'] : ['tools']);
// THE WAY IT IS COUNTED BY IS ONE FOR A WHOLE BODY OF WORK: the way it scores higher by over that body's tasks together, the tools
// in the request where the two tie. Not the better way task by task: neither is the better on every task (measured 2026-11-18,
// 20 questions a task: written, 19, 18, 16 and 18 right where a call was needed against 14, 15, 2 and 8; and 10 against 20 where
// none was), and no model as it is served answers one task one way and the next another.
//   wayByItem([{ item, way, right, n }]) -> { item: way }
export function wayByItem(scores) {
  const out = {};
  for (const item of [...new Set(scores.map((x) => x.item))]) {
    const mine = scores.filter((x) => x.item === item);
    const share = (way) => {
      const of = mine.filter((x) => x.way === way);
      const n = of.reduce((a, x) => a + x.n, 0);
      return n ? of.reduce((a, x) => a + x.right, 0) / n : -1;
    };
    const ways = [...new Set(mine.map((x) => x.way))].sort((a, b) => (a === 'tools' ? -1 : b === 'tools' ? 1 : 0));
    out[item] = ways.reduce((a, w) => (share(w) > share(a) ? w : a));
  }
  return out;
}
// the day, for answers that are only good for the day they were given (a web search)
export const dayOf = (at = new Date()) => at.toISOString().slice(0, 10);

// a reply cut where the task says a reply ends
export function cutAt(text, stops) {
  let s = String(text || '');
  for (const st of [].concat(stops || []).filter(Boolean)) {
    const i = s.indexOf(st);
    if (i >= 0) s = s.slice(0, i);
  }
  return s;
}

// what would have followed the task's opening of the reply (prefill), from a reply asked without it
export function continuation(prefill, reply) {
  const r = String(reply || '');
  if (!prefill) return r;
  if (/```\w*\s*/.test(prefill)) {
    // the opening is the start of a code block: what follows it is the code, then the block's end. The code is the first block
    // the reply wrote (all of it, where it wrote none). Where the opening already gave a function's signature (HumanEval), what
    // follows is that function's body: the reply's own, after its header (the task stops a reply at a new "def")
    const m = r.match(/```[\w+-]*\n?([\s\S]*?)```/);
    let code = (m ? m[1] : r).replace(/\s+$/, '');
    const given = [...prefill.matchAll(/def\s+(\w+)\s*\(/g)].at(-1);
    if (given) {
      const at = code.search(new RegExp('^[ \\t]*def\\s+' + given[1] + '\\s*\\(', 'm'));
      if (at >= 0) {
        const head = code.slice(at).match(/\)\s*(?:->[^\n:]*)?:[ \t]*(?:#[^\n]*)?\n/);
        if (head) code = code.slice(at + head.index + head[0].length).replace(/\s+$/, '');
      }
    }
    return '\n' + code + '\n```';
  }
  const at = r.toLowerCase().lastIndexOf(prefill.trim().toLowerCase());
  return at >= 0 ? r.slice(at + prefill.trim().length) : ' ' + r.trim();
}

// how far the harness says it is, from what it printed (its progress bar: "Requesting API: 40%|...| 2/5")
export function progressOf(text) {
  const all = [...String(text).matchAll(/Requesting API:[^|\r\n]*\|[^|\r\n]*\|\s*(\d+)\/(\d+)/g)];
  return all.length ? { done: Number(all.at(-1)[1]), of: Number(all.at(-1)[2]) } : null;
}

// THE RELAY: the harness's chat client talks to this, and this to the model (ask(messages, body) -> its reply's text).
// on.ask({ excerpt }) and on.answer({ excerpt, seconds }) say what it is doing, for the page
export function relay(ask, on = {}) {
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
        const messages = [...(body.messages || [])];
        const prefill =
          messages.length && messages.at(-1).role === 'assistant' ? String(messages.pop().content || '') : '';
        const user = [...messages].reverse().find((m) => m.role === 'user');
        const t0 = Date.now();
        (on.ask || (() => {}))({ excerpt: String((user && user.content) || '').slice(-600) });
        const reply = await ask(messages, body);
        const text = cutAt(continuation(prefill, reply), body.stop);
        (on.answer || (() => {}))({ excerpt: String(reply).slice(0, 600), seconds: (Date.now() - t0) / 1000 });
        send(200, {
          id: 'relay-' + t0,
          object: 'chat.completion',
          created: Math.floor(t0 / 1000),
          model: String(body.model || ''),
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
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

// a model behind an address that answers as llama.cpp's server does
export const askAt = (base) => async (messages, body) => {
  const r = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(900000),
    body: JSON.stringify({
      model: body.model || 'model',
      messages,
      temperature: 0,
      // (room for a model that thinks before it answers: the task's own stop strings still end the reply)
      max_tokens: Math.max(Number(body.max_tokens || 0), 4096),
      ...(body.stop ? { stop: body.stop } : {}),
      stream: false,
    }),
  });
  if (!r.ok) throw new Error('it answered ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
};

// the files the harness wrote for one task: { results, samples } (paths), or null
export function filesOf(dir, task) {
  const all = [];
  const walk = (d) => {
    let es = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) (e.isDirectory() ? walk : (p) => all.push(p))(path.join(d, e.name));
  };
  walk(dir);
  const pick = (re) =>
    all
      .filter((p) => re.test(path.basename(p)))
      .sort()
      .at(-1);
  const results = pick(/^results_.*\.json$/);
  const samples = pick(new RegExp('^samples_' + task.replace(/[^\w]/g, '\\$&') + '_.*\\.jsonl$'));
  return results && samples ? { results, samples } : null;
}

// the harness's score for one task, from its results file: { value, stderr, n, of }
export function scoreOf(resultsFile, b) {
  const j = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const r = (j.results || {})[b.task] || {};
  const key = b.metric + ',' + b.filter;
  const n = (j['n-samples'] || {})[b.task] || {};
  return {
    value: typeof r[key] === 'number' ? r[key] : null,
    stderr: typeof r[b.metric + '_stderr,' + b.filter] === 'number' ? r[b.metric + '_stderr,' + b.filter] : null,
    n: n.effective ?? null,
    of: n.original ?? null,
  };
}

// ---- run, when started as a program -------------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const B = await import('./support/bench.mjs');
  const { readBriefs } = await import('../src/index.mjs');
  const { serve } = await import('../src/server.mjs');
  const { readConfig, CONFIG_KEY, TARGET } = await import('../src/catalog.mjs');
  const CONFIG = readConfig();
  const EQ = JSON.parse(fs.readFileSync(path.join(HERE, 'equivalence.json'), 'utf8'));
  const limit = B.arg('limit') ? Number(B.arg('limit')) : 0;
  // A PROOF RUN (--proof): each task at the size its benchmark names (equivalence.json proofN; 0 or none: every question), sized so
  // that a capability's tasks together come to about five hundred questions, which is what a verdict needs (docs/swoa-parity.md)
  const proof = B.has('proof');
  const limitOf = (b) => sizeOf(b, { proof, limit });
  const ids = B.arg('items') ? String(B.arg('items')).split(',') : CONFIG.equivalence || EQ.default;
  const plan = planOf(EQ.targets, ids);
  // (--needs: which harnesses what is chosen needs installed, for training/evaluate.sh, and nothing else)
  if (B.has('needs')) {
    console.log(needsOf(plan).join(' '));
    process.exit(0);
  }
  // the harnesses of this run, in words and as a SwOA's proof names them. A result of the second names its own
  const harnesses = [...(plan.some((b) => !isToolTest(b)) ? [HARNESS] : []), ...(plan.some(isToolTest) ? [BFCL] : [])];
  const HARNESS_NOW = harnesses.join(' and ') || HARNESS;
  const HARNESS_ID_NOW = plan.length && plan.every(isToolTest) ? BFCL_ID : HARNESS_ID;
  // a tool test's questions, in the package's order (asked of it once a run), and how many of them this run asks
  const toolIds = {};
  const idsFor = (b) => (toolIds[b.category] = toolIds[b.category] || idsOf(b.category));
  // (answers that are only good for the day they were given are kept by day)
  const TODAY = dayOf();
  const dayPart = (b) => (b.daily ? '-' + TODAY : '');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(EVAL_DIR, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const briefsHash = crypto.createHash('sha256').update(JSON.stringify(readBriefs())).digest('hex').slice(0, 12);
  // THE ARRANGEMENT MEASURED, as a SwOA spec pins it (docs/swoa.md): the briefs the swarm runs, without their prose, hashed as the
  // recipe is (src/spec.mjs recipeSha256). A result is proof of a SwOA only where this is that SwOA's arrangementSha256
  const { recipeSha256 } = await import('../src/spec.mjs');
  const arrangementSha256 = recipeSha256(
    Object.fromEntries(Object.entries(readBriefs()).filter(([k]) => k !== 'about')),
  );
  // (whether its small models are served with the adapters Pretrain trained: what an evaluation before and after compares)
  const { lorasFor } = await import('./adapters.mjs');
  const { MEMBERS } = await import('../src/catalog.mjs');
  const adapters = process.env.SWARM_EVAL_SWARM_BASE
    ? []
    : Object.keys(lorasFor(CONFIG, MEMBERS, path.join(ROOT, '.work'), TARGET.id, B.modelsDir())).map(
        (k) => MEMBERS[k].name,
      );

  // WHAT IS HAPPENING, for the page: written as it changes (at most twice a second), and once more at the end
  const live = {
    pid: process.pid,
    runId,
    startedAt: Date.now(),
    limit,
    ...(proof ? { proof: true } : {}),
    harness: HARNESS_NOW,
    harnessId: HARNESS_ID_NOW,
    configuration: CONFIG_KEY,
    briefs: briefsHash,
    arrangementSha256,
    adapters,
    target: TARGET.name,
    phase: 'starting',
    step: 'Getting ready',
    tasks: plan.map((b) => ({
      item: b.item,
      itemName: b.itemName,
      task: b.task,
      name: b.name,
      compare: b.compare,
      harness: harnessOf(b).name,
      target: { state: 'waiting', done: 0, of: null, seconds: 0 },
      swarm: { state: 'waiting', done: 0, of: null, seconds: 0 },
    })),
    now: null,
    last: null,
    log: [],
  };
  let wroteAt = 0;
  let pending = null;
  const write = (force) => {
    const at = Date.now();
    if (!force && at - wroteAt < 500) {
      pending = pending || setTimeout(() => ((pending = null), write(true)), 500);
      return;
    }
    wroteAt = at;
    live.at = at;
    const tmp = path.join(EVAL_DIR, 'live.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(live));
    fs.renameSync(tmp, path.join(EVAL_DIR, 'live.json'));
  };
  const say = (step) => {
    live.step = step;
    live.log.push({ at: Date.now(), text: step });
    if (live.log.length > 12) live.log.shift();
    console.log(new Date().toTimeString().slice(0, 8) + ' ' + step);
    write(true);
  };
  write(true);

  let child = null;
  const stopping = [];
  const end = (phase, step) => {
    live.phase = phase;
    live.now = null;
    say(step);
  };
  // STOPPED: nothing more is asked (a question to a model that is being stopped made the swarm start it again, and the server it
  // started outlived the run), the run goes no further (it went on to compare nothing and wrote an empty result over the last one),
  // and every model server it started is stopped before it ends. The last result that finished stands, as it was
  let halted = false;
  const never = () => new Promise(() => {});
  process.on('SIGTERM', async () => {
    if (halted) return;
    halted = true;
    if (child) child.kill('SIGTERM');
    for (const t of live.tasks)
      for (const w of ['target', 'swarm']) if (t[w].state === 'asking') t[w].state = 'stopped';
    end('stopped', 'Stopped from the page');
    const all = Promise.all(
      stopping.splice(0).map((f) =>
        Promise.resolve()
          .then(f)
          .catch(() => {}),
      ),
    );
    await Promise.race([all, new Promise((ok) => setTimeout(ok, 8000))]);
    const kids = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    for (const k of String(kids.stdout || '')
      .split(/\s+/)
      .filter(Boolean))
      try {
        process.kill(Number(k), 'SIGTERM');
      } catch {
        /* gone */
      }
    process.exit(143);
  });

  // one category of the tool tests, for one model behind a tool relay at `base`; the package's folder for it is `out`
  const toolTest = async (b, who, base, out) => {
    const row = live.tasks.find((t) => t.task === b.task)[who];
    row.state = 'asking';
    row.started = Date.now();
    const all = idsFor(b);
    const n = limitOf(b) && limitOf(b) < all.length ? limitOf(b) : 0;
    row.of = n || all.length;
    write(true);
    const got = await bfclRun({
      root: out,
      category: b.category,
      ids: n ? all.slice(0, n) : null,
      base,
      onChild: (c) => (child = c),
      onSaid: (said, step) => {
        const p = step === 'generate' ? bfclProgress(said) : null;
        if (p && p.of) row.done = p.done;
        write();
      },
    });
    row.seconds = (Date.now() - row.started) / 1000;
    if (got.ok) {
      row.state = 'done';
      row.done = row.of;
    } else {
      row.state = 'failed';
      row.why = got.why;
    }
    write(true);
    return got.ok;
  };

  // one task through the harness, for one model behind a relay at `base`; its files land in `out`
  const harness = (b, who, base, out) =>
    new Promise((ok) => {
      const row = live.tasks.find((t) => t.task === b.task)[who];
      row.state = 'asking';
      row.started = Date.now();
      write(true);
      const args = [
        'run',
        '--model',
        'local-chat-completions',
        '--model_args',
        'model=' + who + ',base_url=' + base + '/v1/chat/completions,num_concurrent=1,max_retries=2,timeout=900',
        '--tasks',
        b.task,
        '--apply_chat_template',
        '--fewshot_as_multiturn',
        '--log_samples',
        '--output_path',
        out,
        '--confirm_run_unsafe_code',
        ...(limitOf(b) ? ['--limit', String(limitOf(b))] : []),
      ];
      child = spawn(path.join(LMEVAL, 'venv', 'bin', 'lm_eval'), args, {
        env: {
          ...process.env,
          HF_HOME: path.join(LMEVAL, 'hf'),
          HF_HUB_DISABLE_TELEMETRY: '1',
          HF_ALLOW_CODE_EVAL: '1', // (the code tasks run each model's function against the task's tests, on this machine)
          TOKENIZERS_PARALLELISM: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let said = '';
      const take = (c) => {
        said = (said + String(c)).slice(-20000);
        const p = progressOf(said);
        if (p && p.of) row.of = p.of;
        write();
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('close', (code) => {
        child = null;
        row.seconds = (Date.now() - row.started) / 1000;
        if (code === 0) {
          row.state = 'done';
          row.done = row.of ?? row.done;
          ok(true);
        } else {
          row.state = 'failed';
          row.why =
            said
              .split(/[\r\n]+/)
              .reverse()
              .find((l) => /error|exception|failed/i.test(l)) || 'the harness stopped (' + code + ')';
          row.why = row.why.trim().slice(0, 240);
          ok(false);
        }
        write(true);
      });
    });

  // one model through every task that needs it: askModel(messages, body) is the model, behind a relay that says what it does;
  // askTools({ messages, tools }) the same model asked a step with tools, behind the tool tests' relay; askWritten the same, for a
  // task to be asked with its functions written into the conversation (b.way 'written')
  const askAll = async (who, askModel, askTools, tasks, outOf, askWritten = null) => {
    const durations = [];
    const stopped = () => Promise.reject(new Error('the evaluation was stopped'));
    const on = (counts) => ({
      ask: ({ excerpt }) => {
        const t = live.tasks.find((x) => x[who].state === 'asking');
        if (!t) return;
        live.now = {
          who,
          task: t.task,
          name: t.name,
          i: t[who].done + 1,
          of: t[who].of,
          ask: excerpt,
          since: Date.now(),
          avgSeconds: durations.length ? durations.reduce((a, x) => a + x, 0) / durations.length : null,
        };
        write(true);
      },
      answer: ({ excerpt, seconds }) => {
        const t = live.tasks.find((x) => x[who].state === 'asking');
        durations.push(seconds);
        if (durations.length > 30) durations.shift();
        // (a tool test may ask a model several steps for one question: how far it is comes from the package, not from here)
        if (t && counts) t[who].done += 1;
        live.last = { who, task: t && t.task, name: t && t.name, reply: excerpt, seconds };
        write(true);
      },
      error: (why) => {
        live.last = { who, error: why };
        write(true);
      },
    });
    const r = tasks.some((b) => !isToolTest(b))
      ? await relay((m, b) => (halted ? stopped() : askModel(m, b)), on(true))
      : null;
    const written = (b) => isToolTest(b) && b.way === 'written';
    const rt = tasks.some((b) => isToolTest(b) && !written(b))
      ? await toolRelay((q) => (halted ? stopped() : askTools(q)), on(false))
      : null;
    const rw = tasks.some(written) ? await toolRelay((q) => (halted ? stopped() : askWritten(q)), on(false)) : null;
    for (const x of [r, rt, rw]) if (x) stopping.push(x.close);
    for (const b of tasks) {
      say(
        'Asking ' +
          (who === 'target' ? TARGET.name : 'the swarm') +
          ': ' +
          b.name +
          (written(b) ? ', its functions written into the conversation' : ''),
      );
      if (isToolTest(b)) await toolTest(b, who, (written(b) ? rw : rt).base, outOf(b));
      else await harness(b, who, r.base, outOf(b));
      if (halted) await never();
    }
    for (const x of [r, rt, rw]) if (x) await x.close();
  };

  // what is kept of a task in a folder (its files, or null where it was not asked to the end), and its score from them
  const keptIn = (dir, b) => (isToolTest(b) ? bfclFiles(dir, b.category) : filesOf(dir, b.task));
  const scoreIn = (dir, b) =>
    isToolTest(b) ? bfclScore(dir, b.category, idsFor(b).length) : scoreOf(filesOf(dir, b.task).results, b);

  if (!plan.length) {
    end('failed', 'Nothing chosen under the models has a benchmark');
    process.exit(1);
  }
  if (plan.some(isToolTest) && !bfclInstalled()) {
    end('failed', 'The tool tests are not installed (' + BFCL + '): training/evaluate.sh installs them the first time');
    process.exit(1);
  }
  // A TASK THAT CANNOT BE ASKED AS THINGS ARE (a search test with no key to the search service) is left out and says why; the
  // others are asked
  const blocked = new Map(plan.map((b) => [b.task, blockedOf(b)]).filter(([, why]) => why));
  for (const [task, why] of blocked) {
    const row = live.tasks.find((t) => t.task === task);
    for (const w of ['target', 'swarm']) Object.assign(row[w], { state: 'failed', why });
  }
  const askable = plan.filter((b) => !blocked.has(b.task));

  // THE LARGER MODEL FIRST, and only where its answers to this task, at this size, are not already kept (a tool test: each way
  // it is asked, kept apart)
  const keep = (b) =>
    path.join(
      EVAL_DIR,
      'target',
      TARGET.id,
      b.task +
        '-' +
        (limitOf(b) || 'all') +
        '-r' +
        RELAY_VERSION +
        dayPart(b) +
        (b.way === 'written' ? '-written' : ''),
    );
  const targetAsks = askable.flatMap((b) => waysOf(b).map((way) => (way === 'tools' ? b : { ...b, way })));
  const needTarget = targetAsks.filter((b) => !keptIn(keep(b), b));
  for (const b of askable.filter((x) => !needTarget.some((y) => y.task === x.task))) {
    const row = live.tasks.find((t) => t.task === b.task).target;
    const s = scoreIn(keep(b), b);
    Object.assign(row, { state: 'kept', done: s.n, of: s.n });
  }
  if (needTarget.length) {
    live.phase = 'loading';
    say('Loading ' + TARGET.name);
    const { openTarget } = await import('./target.mjs');
    const t = await openTarget(TARGET, { llamaServer: B.llamaServer(), modelsDir: B.modelsDir(), onRecover: () => {} });
    stopping.push(t.stop);
    live.phase = 'asking';
    // (a step with tools is asked of it as training asks one: training/target.mjs)
    await askAll(
      'target',
      askAt(t.base),
      askToolsAt(t.base, { model: TARGET.model || 'target', stop: ['<unk>'] }),
      needTarget,
      keep,
      askWrittenAt(t.base, { model: TARGET.model || 'target', stop: ['<unk>'] }),
    );
    await t.stop();
  }

  // THEN THE SWARM, as it is trained now (or one already served at SWARM_EVAL_SWARM_BASE, which is left running)
  live.phase = 'loading';
  const servedAt = process.env.SWARM_EVAL_SWARM_BASE || '';
  // THE SWARM'S ANSWERS ARE KEPT TOO, task by task, for exactly this module: this arrangement, these adapters, and this runtime
  // (every file of src/ hashed: a change to how the module answers is a change to what was measured). A proof run is hours long
  // and will be stopped; started again it asks only the tasks it had not finished. --fresh asks them all again. A swarm someone
  // else serves (SWARM_EVAL_SWARM_BASE) is not known to be the same one, and is always asked.
  const runtimeSha = crypto
    .createHash('sha256')
    .update(
      fs
        .readdirSync(path.join(ROOT, 'src'))
        .filter((f) => f.endsWith('.mjs'))
        .sort()
        .map((f) => f + '\n' + fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 12);
  const swarmKeep = (b) =>
    servedAt
      ? path.join(runDir, 'swarm', b.task)
      : path.join(
          EVAL_DIR,
          'swarm',
          CONFIG_KEY,
          arrangementSha256.slice(0, 16) + '-' + runtimeSha + (adapters.length ? '-adapters' : ''),
          b.task + '-' + (limitOf(b) || 'all') + '-r' + RELAY_VERSION + dayPart(b),
        );
  const needSwarm = askable.filter((b) => servedAt || B.has('fresh') || !keptIn(swarmKeep(b), b));
  for (const b of askable.filter((x) => !needSwarm.includes(x))) {
    const row = live.tasks.find((t) => t.task === b.task).swarm;
    const s = scoreIn(swarmKeep(b), b);
    Object.assign(row, { state: 'kept', done: s.n, of: s.n });
  }
  if (needSwarm.length) {
    say(servedAt ? 'Using the swarm served at ' + servedAt : 'Loading the swarm (' + CONFIG_KEY.split('--')[0] + ')');
    let swarm = null;
    let served = { base: servedAt, close: async () => {} };
    if (!servedAt) {
      swarm = await B.openSwarm(readBriefs());
      stopping.push(() => swarm.stop());
      served = await serve(swarm, { port: 0 });
      stopping.push(served.close);
    }
    live.phase = 'asking';
    // (a task asked again starts from nothing: what a stopped run left of it is not a whole answer to it)
    for (const b of needSwarm) fs.rmSync(swarmKeep(b), { recursive: true, force: true });
    await askAll('swarm', askAt(served.base), askToolsAt(served.base, { model: 'swarm' }), needSwarm, swarmKeep);
    await served.close();
    if (swarm) await swarm.stop();
  } else if (askable.length)
    say('The swarm has answered every one of these tasks as it is now: nothing is asked again');

  if (halted) await never();
  // AND EACH QUESTION'S TWO ANSWERS COMPARED
  live.phase = 'comparing';
  say('Comparing the answers, question by question');
  const results = [];
  // the way the larger model is counted by on the tool tests, for each body of work (wayByItem), from what is kept of each way
  const wayOf = wayByItem(
    askable.filter(isToolTest).flatMap((b) =>
      waysOf(b)
        .filter((way) => keptIn(keep({ ...b, way }), b))
        .map((way) => {
          const sc = scoreIn(keep({ ...b, way }), b);
          return { item: b.item, way, right: sc.right.length, n: sc.n };
        }),
    ),
  );
  for (const b of plan) {
    const row = live.tasks.find((t) => t.task === b.task);
    // (a result of the second harness names it, and the tools each model was offered)
    const from = isToolTest(b) ? { harnessId: BFCL_ID, ...(b.daily ? { askedOn: TODAY } : {}) } : {};
    if (blocked.has(b.task)) {
      results.push({ ...b, ...from, failed: blocked.get(b.task) });
      continue;
    }
    const tf = waysOf(b).every((way) => keptIn(keep({ ...b, way }), b)) && keptIn(keep(b), b);
    const sf = keptIn(swarmKeep(b), b);
    if (!tf || !sf) {
      results.push({
        ...b,
        ...from,
        failed: (!tf ? 'the larger model' : 'the swarm') + ' was not asked it to the end',
      });
      continue;
    }
    if (isToolTest(b)) {
      // the larger model by the way it scores higher by over this body of work; the result says which, and what it scored each way
      const ways = waysOf(b).map((way) => ({ way, score: scoreIn(keep({ ...b, way }), b) }));
      const best = ways.find((w) => w.way === wayOf[b.item]) || ways[0];
      const ss = scoreIn(swarmKeep(b), b);
      const agree = pairOf(best.score, ss);
      const lean = ({ value, stderr, n, of }) => ({ value, stderr, n, of });
      row.agree = agree;
      results.push({
        ...b,
        ...from,
        target: lean(best.score),
        swarm: lean(ss),
        agree,
        ...(ways.length > 1
          ? { targetAsked: best.way, targetWays: Object.fromEntries(ways.map((w) => [w.way, lean(w.score)])) }
          : {}),
      });
      continue;
    }
    const a = spawnSync(
      path.join(LMEVAL, 'venv', 'bin', 'python'),
      ['-I', path.join(HERE, 'support', 'harness_agree.py'), tf.samples, sf.samples, b.filter, b.metric, b.compare],
      { encoding: 'utf8' },
    );
    let agree = null;
    try {
      agree = JSON.parse(String(a.stdout).trim().split('\n').pop());
    } catch {
      /* said below */
    }
    const r = {
      ...b,
      target: scoreOf(tf.results, b),
      swarm: scoreOf(sf.results, b),
      agree,
      ...(agree ? {} : { failed: 'the answers could not be compared: ' + String(a.stderr).trim().split('\n').pop() }),
    };
    row.agree = agree;
    results.push(r);
  }
  const out = {
    at: new Date().toISOString(),
    runId,
    limit,
    ...(proof ? { proof: true } : {}),
    harness: HARNESS_NOW,
    harnessId: HARNESS_ID_NOW,
    configuration: CONFIG_KEY,
    briefs: briefsHash,
    arrangementSha256,
    runtimeSha,
    adapters,
    target: TARGET.name,
    seconds: (Date.now() - live.startedAt) / 1000,
    results,
  };
  fs.writeFileSync(path.join(EVAL_DIR, 'results.json'), JSON.stringify(out, null, 2));
  fs.appendFileSync(path.join(EVAL_DIR, 'history.jsonl'), JSON.stringify(out) + '\n');
  const same = results.reduce((a, r) => a + ((r.agree && r.agree.same) || 0), 0);
  const of = results.reduce((a, r) => a + ((r.agree && r.agree.of) || 0), 0);
  end('done', 'Done: the same answer as ' + TARGET.name + ' on ' + same + ' of ' + of + ' questions');
  process.exit(0);
}
