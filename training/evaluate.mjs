// evaluate.mjs - EVALUATE THE SWARM: how equivalent it is to the larger model, measured by a standard any lab would recognise and
// kept apart from training. For each body of work that has standard tasks (training/equivalence.json, benchmarks), the standard
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
//   bash training/evaluate.sh [--limit N] [--items crew,math] [--harnesses lm,bfcl]    (N questions a task, the first N as the harness orders them;
//                                                                 none: every question)
//
// A SECOND HARNESS, FOR TOOLS. Calling a function and using a search tool have no task in lm-evaluation-harness. A benchmark that
// says harness "bfcl" is a category of the Berkeley Function-Calling Leaderboard (support/bfcl.mjs: the package pinned, how it is
// pointed at a model here, its relay). It is asked the same way: the larger model first and kept, then the swarm, each offered the
// same functions in the same request, and the two paired by question on the package's own verdict. A result of it names the
// harness it came from and the tools offered. A category that searches the web needs a search service behind its search tool
// (support/search.mjs; training/search.json): a SearXNG served on this machine for the length of the run, which needs no key, or
// the service the package was written for, which needs one. Where neither can be had that task is not asked, and says so. Its
// answers are kept by day and by service: what a search returns changes from one day to the next, so the two models are only set
// beside each other where they were asked on the same day through the same service; and with SearXNG what each query returned and
// each page fetched is kept for the day, so that the same query gives both models the same results.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BFCL,
  BFCL_ID,
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
  askAfterAt,
} from './support/bfcl.mjs';
import {
  searchOf,
  PAGE_CHARS,
  RESULTS_MOST,
  searchBlocked,
  openSearch,
  searchEnv,
  searchFolder,
  searchRecord,
  searchWords,
} from './support/search.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const EVAL_DIR = process.env.SWARM_EVAL_DIR || path.join(ROOT, '.work', 'eval');
export const LMEVAL = path.join(ROOT, '.work', 'lmeval');
export const HARNESS = 'lm-evaluation-harness 0.4.13';
// (the same, as a SwOA spec's proof names a harness: docs/swoa.md)
export const HARNESS_ID = { name: 'lm-evaluation-harness', version: '0.4.13' };
// (bumped when what is done around the harness changes, so that kept answers of the larger model are not reused across it)
// 2 (2026-11-20): a task's stop words are no longer sent to a model whose reply opening was taken off (relay, below). The larger
// model's kept answers to HumanEval were its import line and nothing more.
const RELAY_VERSION = 2;

// the tasks to run, of the bodies of work named: [{ item, itemName, task, name, metric, filter, compare }]
// (every body of work that has a standard task, unless a run names which: --items, or the page's Evaluate)
// (harnesses: only the tasks of these harnesses, by the key a benchmark names one with, harnessKey; none named: every one)
export const harnessKey = (b) => String((b && b.harness) || 'lm');
export function planOf(targets, ids, harnesses = null) {
  const out = [];
  for (const t of targets.filter((x) => ids.includes(x.id)))
    for (const b of t.benchmarks || [])
      if (!harnesses || harnesses.includes(harnessKey(b))) out.push({ item: t.id, itemName: t.name, ...b });
  return out;
}

// how many of a task's questions a run asks: in a proof run the size its benchmark names (proofN; 0 or none: every question), else
// the one size the run was given for every task (0: every question)
export const sizeOf = (b, { proof = false, limit = 0 } = {}) => (proof ? Number(b.proofN) || 0 : Number(limit) || 0);

// which harness a benchmark is a task of, as a SwOA's proof names one, and whether it is the tool tests
export const isToolTest = (b) => b.harness === 'bfcl';
export const harnessOf = (b) => (isToolTest(b) ? BFCL_ID : HARNESS_ID);
// what a plan needs installed: ['lmeval', 'bfcl', 'searxng'] (training/evaluate.sh installs each the first time). The search is
// needed where a task searches the web and no other search service is named (SWARM_SEARCH)
export const needsOf = (plan, env = process.env) => [
  ...(plan.some((b) => !isToolTest(b)) ? ['lmeval'] : []),
  ...(plan.some(isToolTest) ? ['bfcl'] : []),
  ...(plan.some((b) => b.search) && searchOf(env) === 'searxng' ? ['searxng'] : []),
];
// THE ENGINE THAT SERVED THE LARGER MODEL IS PART OF WHAT ITS ANSWERS ARE. An engine's release mends wrong and empty replies
// and changes how a model is sampled (read 2026-11-20: five releases of the one here in nine days, three of them saying so), so
// answers kept from one version are not the model's under another, and the comparison would be with a model that is no longer
// served. What an engine says of itself (`--version`) -> its version as it is written into a kept folder's name, '' where it
// says none: "tensorfold-native 1.2.7" -> "1.2.7"; "version: 0.9.0 (build 12110, commit ...)" -> "0.9.0-b12110".
export function engineVersionIn(said) {
  const t = String(said || '');
  const v = /(\d+\.\d+(?:\.\d+)?)/.exec(t);
  const b = /build\s+(\d+)/i.exec(t);
  return v ? v[1] + (b ? '-b' + b[1] : '') : b ? 'b' + b[1] : '';
}
export const enginePart = (engine, version) =>
  version ? '-' + String(engine || 'engine').replace(/[^a-z0-9]/gi, '') + version : '';
// WHICH FOLDER THE LARGER MODEL'S ANSWERS TO A TASK ARE KEPT IN: the one named with the engine's version. Answers kept before
// folders said the version are this engine's where they were written after its program was put here, and are used as they
// are (asking everything again to learn nothing is an hour); once the program is newer than they are, they are another
// version's, and the folder with the version's name is begun.
// THE ENGINES THAT SERVE THE SWARM'S MODELS, each once, in the order of their names: what the swarm's kept answers are named
// by. A swarm may be served by more than one (a member on llama.cpp beside one on TensorFold), and every one of them is part
// of what its answers are. They were named by llama.cpp's build whatever served the members (2026-11-20: two members on
// TensorFold, their answers kept as llama.cpp's), so an update of TensorFold would not have had the swarm asked again.
//   swarmEnginesOf(the models served, (engine) -> its version) -> [{ name, version }]
export function swarmEnginesOf(models, versionOf) {
  const names = [...new Set(models.filter(Boolean).map((m) => String(m.engine || 'llama')))].sort();
  return names.map((name) => ({ name, version: versionOf(name) || '' }));
}
// as a kept folder's name carries them: each engine's part, one after another ('' where none says a version)
export const enginesPart = (engines) => engines.map((x) => enginePart(x.name, x.version)).join('');
export function keptFolder(named, unnamed, program, stat = (f) => fs.statSync(f).mtimeMs) {
  if (named === unnamed) return named;
  const at = (f) => {
    try {
      return stat(f);
    } catch {
      return null;
    }
  };
  if (at(named) !== null) return named;
  const old = at(unnamed);
  const prog = at(program);
  return old !== null && prog !== null && old >= prog ? unnamed : named;
}
// a task that cannot be asked as things are, and why ('' where it can): a search test with no search behind it (the one this
// machine serves is not installed; or the service named needs a key that is not here)
export const blockedOf = (b, env = process.env, has = undefined) => (b.search ? searchBlocked(env, has) : '');
// (answers given through one search service are not kept with those given through another)
// (nor those given a page cut at one length with those given it whole, or cut at another)
export const searchPart = (b, env = process.env) =>
  b.search
    ? '-' +
      searchOf(env) +
      (searchOf(env) === 'searxng'
        ? (PAGE_CHARS ? '-p' + PAGE_CHARS : '') +
          (RESULTS_MOST ? '-n' + RESULTS_MOST : '') +
          (PAGE_CHARS ? '-prose' : '')
        : '')
    : '';
// THE WAYS THE LARGER MODEL IS ASKED A TOOL TEST: with the tools in the request, as the swarm is; and, where the benchmark says so
// (targetAlsoWritten), with the functions written into the conversation and its calls read from its reply (support/bfcl.mjs says
// why: a server may return only the first of the calls its model wrote). It is counted by the way it scores higher by, so that a
// result never rests on how the larger model happens to be served. And, where the benchmark says so (targetAlsoAfter: the web
// search test), with the test's words on the form of the final answer said after the question and not in a system message
// (support/bfcl.mjs formAfter says why: the larger model answered at once on every question and never searched)
export const WAY_SAID = {
  written: ', its functions written into the conversation',
  after: ', the form of its answer said after the question',
};
export const waysOf = (b) =>
  isToolTest(b)
    ? ['tools', ...(b.targetAlsoWritten ? ['written'] : []), ...(b.targetAlsoAfter ? ['after'] : [])]
    : ['tools'];
// THE SWARM IS ASKED THE SAME TWO WAYS where the second is a matter of how the QUESTION is put and not of how a server returns
// calls (targetAlsoAfter): the tools in the request, and the test's words on the form of the answer after the question. It was
// asked the one way, and the larger model's score by the other way was set beside it: 7 of 40 against 1, where asked as the
// swarm was the larger model also scored 1 (measured 2026-11-19). The written way stays the larger model's alone: it is there
// for a server that returns one call of several, and the swarm's own runtime returns every call.
export const swarmWaysOf = (b) => (isToolTest(b) && b.targetAlsoAfter ? ['tools', 'after'] : ['tools']);

// THE FILES A TASK IS COMPARED FROM, where every way it was asked is kept: the plain way's own files, or null where one of
// the ways is missing. What is returned is the FILES, never whether they are there: the swarm's side returned true here
// (2026-11-20), and every evaluation of the first harness's tasks stopped at the comparison, reading a score from no file.
//   keptOfAll([files or null, of each way], the plain way's files) -> those files, or null
export const keptOfAll = (ways, plain) => (ways.every(Boolean) && plain ? plain : null);
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
        // WHERE THE TASK'S OPENING OF THE REPLY WAS TAKEN OFF, ITS STOP WORDS ARE NOT SENT TO THE MODEL: they say where a reply
        // that CONTINUES that opening ends (HumanEval: at the next "def", the function's header being already written). A model
        // asked without the opening writes the header itself and would be stopped at it, before the function (measured
        // 2026-11-20: the larger model's replies were "from typing import List" and nothing more, 0 of 20, twice). The reply
        // is still cut where the task says, below, once what continues the opening has been taken from it.
        const reply = await ask(messages, prefill ? { ...body, stop: undefined } : body);
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

// THE REPLY TOKENS THAT STILL FIT, from a server's refusal of a prompt and reply that together pass its context: what is left
// after the prompt, less a margin; null where the refusal is of something else or under 256 are left. (Measured 2026-11-20, web
// search without snippets: 11 of the larger model's 20 conversations ended in this refusal, most with 3000 tokens still free,
// because 4096 were asked for whatever was left. The model lost its turn to the asking, not to what it could do.)
export function roomLeft(refusal) {
  const m = /maximum context length is (\d+) tokens.*?prompt has (\d+) tokens/s.exec(String(refusal || ''));
  if (!m) return null;
  const left = Number(m[1]) - Number(m[2]) - 64;
  return left >= 256 ? left : null;
}

// a model behind an address that answers as llama.cpp's server does
export const askAt = (base) => async (messages, body) => {
  const post = (most) =>
    fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(900000),
      body: JSON.stringify({
        model: body.model || 'model',
        messages,
        temperature: 0,
        max_tokens: most,
        ...(body.stop ? { stop: body.stop } : {}),
        stream: false,
      }),
    });
  // (room for a model that thinks before it answers: the task's own stop strings still end the reply)
  let r = await post(Math.max(Number(body.max_tokens || 0), 4096));
  if (!r.ok) {
    const said = await r.text();
    // (asked once more for the reply that still fits, where the prompt alone does)
    const left = r.status === 400 ? roomLeft(said) : null;
    if (!left) throw new Error('it answered ' + r.status + ': ' + said.slice(0, 200));
    r = await post(left);
    if (!r.ok) throw new Error('it answered ' + r.status + ': ' + (await r.text()).slice(0, 200));
  }
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

// HOW MANY REPLIES THE HARNESS COULD NOT READ, from its samples file: a reply that reached it empty, or from which its filter
// took no answer ("[invalid]"). A score says how many were right; this says how many were never read as an answer at all, which
// is a fault of form (or of how the model was asked), not of what it knew. Measured 2026-11-19: on a test of truth chains 17 of
// the swarm's 20 replies reasoned to the right answer and were not read; and the larger model's 20 replies to HumanEval were
// its import line, cut where the task stops a reply. Either way the comparison was of reading, not of the two models.
//   unreadIn(samplesFile, filter) -> a count, or null where the file cannot be read
export function unreadIn(samplesFile, filter) {
  try {
    const rows = fs
      .readFileSync(samplesFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((r) => !filter || r.filter === undefined || r.filter === filter);
    return rows.filter((r) => {
      const reply = (r.resps || []).flat().join('');
      return !String(reply).trim() || JSON.stringify(r.filtered_resps ?? '').includes('[invalid]');
    }).length;
  } catch {
    return null;
  }
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
  const ids = B.arg('items') ? String(B.arg('items')).split(',') : EQ.targets.map((t) => t.id);
  // (--harnesses lm,bfcl: only the tasks of those harnesses, of the bodies of work asked)
  const plan = planOf(EQ.targets, ids, B.arg('harnesses') ? String(B.arg('harnesses')).split(',') : null);
  // (--needs: which harnesses the tasks of this run need installed, for training/evaluate.sh, and nothing else)
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
      for (const w of Object.keys(t)) if (t[w] && t[w].state === 'asking') t[w].state = 'stopped';
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

  // THE SEARCH BEHIND THE WEB SEARCH TEST (support/search.mjs): served here from the first task that needs it to the end of the
  // run, and what it returned kept for the day, so that the larger model and the swarm are given the same results
  const SEARCH_KEPT = searchFolder(EVAL_DIR, TODAY);
  let search = null;
  const searchUp = async () => {
    if (!search) {
      say('Starting the search behind the web search test');
      search = await openSearch({ log: path.join(EVAL_DIR, 'search.log') });
      stopping.push(search.stop);
    }
    return search;
  };

  // one category of the tool tests, for one model behind a tool relay at `base`; the package's folder for it is `out`
  const toolTest = async (b, who, base, out) => {
    const row = live.tasks.find((t) => t.task === b.task)[who];
    row.state = 'asking';
    row.started = Date.now();
    const all = idsFor(b);
    const n = limitOf(b) && limitOf(b) < all.length ? limitOf(b) : 0;
    row.of = n || all.length;
    write(true);
    // (a task that searches the web: the search this machine serves is started for it, once a run, and its searches go there)
    let env = {};
    if (b.search && searchOf() === 'searxng') {
      try {
        env = searchEnv((await searchUp()).base, SEARCH_KEPT);
      } catch (e) {
        Object.assign(row, { state: 'failed', why: String((e && e.message) || e).slice(0, 240), seconds: 0 });
        write(true);
        return false;
      }
    }
    const got = await bfclRun({
      root: out,
      category: b.category,
      ids: n ? all.slice(0, n) : null,
      base,
      env,
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
  // askTools({ messages, tools }) the same model asked a step with tools, behind the tool tests' relay; other[way] the same, for a
  // task to be asked with its functions written into the conversation (b.way 'written')
  // other: { written, after }, the same model asked a step each other way a task may name (b.way)
  const askAll = async (who, askModel, askTools, tasks, outOf, other = {}) => {
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
    const wayIs = (b) => (isToolTest(b) && other[b.way] ? b.way : '');
    const rt = tasks.some((b) => isToolTest(b) && !wayIs(b))
      ? await toolRelay((q) => (halted ? stopped() : askTools(q)), on(false))
      : null;
    // (a relay for each other way some task here is asked by)
    const ro = {};
    for (const way of [...new Set(tasks.map(wayIs).filter(Boolean))])
      ro[way] = await toolRelay((q) => (halted ? stopped() : other[way](q)), on(false));
    const relays = [r, rt, ...Object.values(ro)];
    for (const x of relays) if (x) stopping.push(x.close);
    for (const b of tasks) {
      say(
        'Asking ' +
          (who === 'target' ? TARGET.name : (live.alone || {})[who] ? live.alone[who] + ' by itself' : 'the swarm') +
          ': ' +
          b.name +
          (WAY_SAID[wayIs(b)] || ''),
      );
      if (isToolTest(b)) await toolTest(b, who, (ro[wayIs(b)] || rt).base, outOf(b));
      else await harness(b, who, r.base, outOf(b));
      if (halted) await never();
    }
    for (const x of relays) if (x) await x.close();
  };

  // what is kept of a task in a folder (its files, or null where it was not asked to the end), and its score from them
  const keptIn = (dir, b) => (isToolTest(b) ? bfclFiles(dir, b.category) : filesOf(dir, b.task));
  const scoreIn = (dir, b) =>
    isToolTest(b) ? bfclScore(dir, b.category, idsFor(b).length) : scoreOf(filesOf(dir, b.task).results, b);

  if (!plan.length) {
    end('failed', 'None of the bodies of work named has a benchmark');
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
  const { programOf } = await import('./target.mjs');
  const engineProgram = TARGET.engine === 'llama' ? B.llamaServer() : programOf(TARGET);
  let engineSaid = '';
  try {
    const r = spawnSync(engineProgram, ['--version'], { encoding: 'utf8', timeout: 15000 });
    engineSaid = String(r.stdout || '') + String(r.stderr || '');
  } catch {
    /* an engine that does not say: its answers are kept as before */
  }
  const engine = { name: TARGET.engine || '', version: engineProgram ? engineVersionIn(engineSaid) : '' };
  const keep = (b) => {
    const name = (part) =>
      path.join(
        EVAL_DIR,
        'target',
        TARGET.id,
        b.task +
          '-' +
          (limitOf(b) || 'all') +
          '-r' +
          RELAY_VERSION +
          part +
          dayPart(b) +
          searchPart(b) +
          (b.way && b.way !== 'tools' ? '-' + b.way : ''),
      );
    return keptFolder(name(enginePart(engine.name, engine.version)), name(''), engineProgram);
  };
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
      {
        written: askWrittenAt(t.base, { model: TARGET.model || 'target', stop: ['<unk>'] }),
        after: askAfterAt(t.base, { model: TARGET.model || 'target', stop: ['<unk>'] }),
      },
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
  // (and the swarm's, by the version of each engine that serves its models: the same reason. A build or a release a person
  // updates to from the page is another engine under the same arrangement)
  const { tensorfoldProgram } = await import('../src/members.mjs');
  const { MEMBERS: SERVED, DECIDER: DECIDES, NO_DECIDER: NONE_DECIDES } = await import('../src/catalog.mjs');
  const programFor = { llama: B.llamaServer(), tensorfold: tensorfoldProgram() };
  const swarmEngines = swarmEnginesOf([...Object.values(SERVED), NONE_DECIDES ? null : DECIDES], (name) => {
    try {
      const r = spawnSync(programFor[name], ['--version'], { encoding: 'utf8', timeout: 15000 });
      return programFor[name] ? engineVersionIn(String(r.stdout || '') + String(r.stderr || '')) : '';
    } catch {
      return ''; // an engine that does not say: its answers are kept as before
    }
  });
  // (as a result says it, in one: "llama+tensorfold", "0.9.0-b12110+1.3.1")
  const swarmEngine = {
    name: swarmEngines.map((x) => x.name).join('+'),
    version: swarmEngines.map((x) => x.version).join('+'),
  };
  // (the program its kept answers are dated against: the newest of the engines', so answers older than any of them are not used)
  const swarmProgram = swarmEngines
    .map((x) => programFor[x.name])
    .filter(Boolean)
    .sort((x, y) => fs.statSync(x).mtimeMs - fs.statSync(y).mtimeMs)
    .at(-1);
  let llamaSaid = null;
  const llamaVersion = () => {
    if (llamaSaid === null) {
      try {
        const r = spawnSync(programFor.llama, ['--version'], { encoding: 'utf8', timeout: 15000 });
        llamaSaid = programFor.llama ? engineVersionIn(String(r.stdout || '') + String(r.stderr || '')) : '';
      } catch {
        llamaSaid = '';
      }
    }
    return llamaSaid;
  };
  const swarmKeep = (b) => {
    if (servedAt) return path.join(runDir, 'swarm', b.task);
    const name = (part) =>
      path.join(
        EVAL_DIR,
        'swarm',
        CONFIG_KEY,
        arrangementSha256.slice(0, 16) + '-' + runtimeSha + (adapters.length ? '-adapters' : '') + part,
        b.task +
          '-' +
          (limitOf(b) || 'all') +
          '-r' +
          RELAY_VERSION +
          dayPart(b) +
          searchPart(b) +
          (b.way && b.way !== 'tools' ? '-' + b.way : ''),
      );
    // (answers kept under llama.cpp's build while another engine served the swarm are those engines' where they were written
    // after their programs were put here: used as they are, by the same rule as answers kept before folders said a version)
    const named = name(enginesPart(swarmEngines));
    const llamaNamed = name(enginePart('llama', swarmEngines.some((x) => x.name === 'llama') ? '' : llamaVersion()));
    return keptFolder(named, fs.existsSync(llamaNamed) ? llamaNamed : name(''), swarmProgram);
  };
  // (each way the swarm is asked a task: swarmWaysOf)
  const swarmAsks = askable.flatMap((b) => swarmWaysOf(b).map((way) => (way === 'tools' ? b : { ...b, way })));
  const needSwarm = swarmAsks.filter((b) => servedAt || B.has('fresh') || !keptIn(swarmKeep(b), b));
  for (const b of askable.filter((x) => !needSwarm.some((y) => y.task === x.task))) {
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
    await askAll('swarm', askAt(served.base), askToolsAt(served.base, { model: 'swarm' }), needSwarm, swarmKeep, {
      after: askAfterAt(served.base, { model: 'swarm' }),
    });
    await served.close();
    if (swarm) await swarm.stop();
  } else if (askable.length)
    say('The swarm has answered every one of these tasks as it is now: nothing is asked again');

  // AND EACH SMALL MODEL OF THE SWARM BY ITSELF, on the same tasks: what the orchestration adds is the swarm's score set
  // beside its own models' scores, and that is the first thing a reader asks of it (console instruction 2026-11-21). A model
  // does not change with the arrangement, so its answers are kept by the model and its engine's version
  // (.work/eval/alone/<model>/...) and asked once, whichever swarm it is later part of. It is asked each task plainly, one
  // call a question, served as the swarm serves it and with no adapter. --no-alone leaves this out
  const aloneOf = {};
  live.alone = {};
  if (!B.has('no-alone')) {
    const { startMember } = await import('../src/members.mjs');
    for (const [k, m] of Object.entries(SERVED)) {
      const who = 'alone-' + k;
      const eng = swarmEngines.find((x) => x.name === String(m.engine || 'llama')) || { name: 'llama', version: '' };
      const keepM = (b) =>
        path.join(
          EVAL_DIR,
          'alone',
          m.id,
          b.task +
            '-' +
            (limitOf(b) || 'all') +
            '-r' +
            RELAY_VERSION +
            enginePart(eng.name, eng.version) +
            dayPart(b) +
            searchPart(b),
        );
      aloneOf[k] = { who, m, keepM };
      live.alone[who] = m.name;
      for (const t of live.tasks)
        t[who] = blocked.has(t.task)
          ? { state: 'failed', why: blocked.get(t.task) }
          : { state: 'waiting', done: 0, of: null, seconds: 0 };
      const need = askable.filter((b) => !keptIn(keepM(b), b));
      for (const b of askable.filter((x) => !need.includes(x))) {
        const sc = scoreIn(keepM(b), b);
        Object.assign(live.tasks.find((t) => t.task === b.task)[who], { state: 'kept', done: sc.n, of: sc.n });
      }
      if (!need.length) continue;
      live.phase = 'loading';
      say('Loading ' + m.name + ', by itself');
      const r = await startMember(
        { ...m, key: k },
        { llamaServer: B.llamaServer(), modelsDir: B.modelsDir(), slots: 2, jinja: true },
      );
      if (!r.ok) {
        // (a model that will not start alone is said, and the evaluation goes on: the swarm's own result does not wait on it)
        for (const b of need)
          Object.assign(live.tasks.find((t) => t.task === b.task)[who], {
            state: 'failed',
            why: 'it did not start: ' + r.why,
          });
        say(m.name + ' did not start by itself: ' + String(r.why).slice(0, 160));
        continue;
      }
      stopping.push(r.stop);
      live.phase = 'asking';
      for (const b of need) fs.rmSync(keepM(b), { recursive: true, force: true });
      await askAll(who, askAt(r.base), askToolsAt(r.base, { model: 'swarm-' + k }), need, keepM);
      await r.stop();
      if (halted) await never();
    }
  }
  // (each model's score on a task, where its answers to it are kept: { key: { id, name, value, stderr, n, of } })
  const aloneFor = (b) => {
    const got = {};
    for (const [k, a] of Object.entries(aloneOf)) {
      if (!keptIn(a.keepM(b), b)) continue;
      const sc = scoreIn(a.keepM(b), b);
      got[k] = { id: a.m.id, name: a.m.name, value: sc.value, stderr: sc.stderr ?? null, n: sc.n, of: sc.of ?? null };
    }
    return Object.keys(got).length ? { alone: got } : {};
  };

  if (search) await search.stop();
  if (halted) await never();
  // AND EACH QUESTION'S TWO ANSWERS COMPARED
  live.phase = 'comparing';
  say('Comparing the answers, question by question');
  const results = [];
  // (the way the swarm is counted by, where it was asked more than one: the same rule, from what is kept of each way)
  const swarmWayOf = wayByItem(
    askable.filter(isToolTest).flatMap((b) =>
      swarmWaysOf(b)
        .map((way) => ({ way, dir: swarmKeep(way === 'tools' ? b : { ...b, way }) }))
        .filter((x) => keptIn(x.dir, b))
        .map((x) => {
          const sc = scoreIn(x.dir, b);
          return { item: b.item, way: x.way, right: sc.right.length, n: sc.n };
        }),
    ),
  );
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
    // (a result of the second harness names it, and the tools each model was offered; one that searches, the search behind them)
    const from = isToolTest(b)
      ? {
          harnessId: BFCL_ID,
          ...(b.daily ? { askedOn: TODAY } : {}),
          ...(b.search
            ? {
                tools: b.tools + ', the search behind them ' + searchWords(),
                search: searchRecord(process.env, SEARCH_KEPT),
              }
            : {}),
        }
      : {};
    if (blocked.has(b.task)) {
      results.push({ ...b, ...from, failed: blocked.get(b.task) });
      continue;
    }
    const tf = keptOfAll(
      waysOf(b).map((way) => keptIn(keep({ ...b, way }), b)),
      keptIn(keep(b), b),
    );
    const sf = keptOfAll(
      swarmWaysOf(b).map((way) => keptIn(swarmKeep(way === 'tools' ? b : { ...b, way }), b)),
      keptIn(swarmKeep(b), b),
    );
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
      // and the swarm by the way IT scores higher by over the body of work, where it was asked more than one way
      const sways = swarmWaysOf(b).map((way) => ({
        way,
        score: scoreIn(swarmKeep(way === 'tools' ? b : { ...b, way }), b),
      }));
      const sbest = sways.find((w) => w.way === swarmWayOf[b.item]) || sways[0];
      const ss = sbest.score;
      const agree = pairOf(best.score, ss);
      const lean = ({ value, stderr, n, of }) => ({ value, stderr, n, of });
      row.agree = agree;
      results.push({
        ...b,
        ...from,
        target: lean(best.score),
        swarm: lean(ss),
        ...aloneFor(b),
        agree,
        ...(ways.length > 1
          ? { targetAsked: best.way, targetWays: Object.fromEntries(ways.map((w) => [w.way, lean(w.score)])) }
          : {}),
        ...(sways.length > 1
          ? { swarmAsked: sbest.way, swarmWays: Object.fromEntries(sways.map((w) => [w.way, lean(w.score)])) }
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
      ...aloneFor(b),
      agree,
      // (how many of each one's replies the harness could not read as an answer: unreadIn)
      unread: { target: unreadIn(tf.samples, b.filter), swarm: unreadIn(sf.samples, b.filter) },
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
    // (the engine that served it, and its version: what its kept answers are named by)
    targetEngine: engine,
    swarmEngine,
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
