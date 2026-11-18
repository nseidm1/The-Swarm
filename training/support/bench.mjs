// bench.mjs - WHAT EVERY TRAINER NEEDS: the flags, the models started (or found already running), a way to put the questions to
// something and write down what came back. Nothing here grades (tasks.mjs does) and nothing here decides (the trainers do).
//   --llama <file>          the llama-server program (or SWARM_LLAMA_SERVER, or one on the PATH)
//   --models <folder>       where the model files are (or SWARM_MODELS_DIR; default .work/models)
//   --attach-a <url>  --attach-b <url>     servers already running, in place of starting them
//   --decider <url>         a decider already running, for the decide step; SWARM_DECIDER does the same (--kev, SWARM_KEV still work)
//   --split train|held   --each 6   --kinds chain,trap   --limit 20   --label name
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createSwarm, MEMBERS, readBriefs } from '../../src/index.mjs';
import { CONFIG_ID, CONFIG_KEY, readConfig, REGISTRY, JUDGE, DECIDER } from '../../src/catalog.mjs';
import { note, checkpoint, briefKey } from './recover.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { attachMember, startMember } from '../../src/members.mjs';
import { tasks, kindsFor, readOwn, CODE_KIND_NAMES, reworded } from '../tasks.mjs';
import { againstStandard } from './standard.mjs';
import { readerOk, readerMark, READER_FILE } from './reader-file.mjs';
import { readState, targetOf } from '../state.mjs';
import { openTarget } from '../target.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORK = process.env.SWARM_WORK_DIR || path.join(REPO_ROOT, '.work', 'train'); // the checks point this at a folder of their own
// WHAT A CONFIGURATION'S TRAINING LEAVES IS ITS OWN: the results of its measurements, the steps of the pass it is in, its plan and
// its review of itself are kept under the name of the configuration and its larger model. (The answers themselves are in files
// all configurations share, each row marked with whose it is, and a measurement's name says what it is a measurement of.)
export const RESULTS = path.join(REPO_ROOT, 'training', 'results', CONFIG_KEY);
export const WORKC = path.join(WORK, CONFIG_KEY);
export const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i < 0 ? d : process.argv[i + 1];
};
export const has = (n) => process.argv.includes('--' + n);
export const modelsDir = () =>
  path.resolve(arg('models', process.env.SWARM_MODELS_DIR || path.join(REPO_ROOT, '.work', 'models')));
// the llama-server program: the one named (--llama, SWARM_LLAMA_SERVER), the one on the PATH, or the one setup.mjs fetched
export function llamaServer() {
  const named = arg('llama', process.env.SWARM_LLAMA_SERVER || '');
  if (named) return named;
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['llama-server'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    /* not on the PATH */
  }
  try {
    const own = fs.readFileSync(path.join(REPO_ROOT, '.work', 'engine', 'path'), 'utf8').trim();
    if (fs.existsSync(own)) return own;
  } catch {
    /* not fetched */
  }
  return '';
}
// what one model alone is written down as: the model, and the larger model its answers were marked against
export const aloneLabel = (place) =>
  (String(place).startsWith('model:') ? String(place).slice(6) : MEMBERS[place].id) + '-alone-vs-' + targetOf().id;
// the questions of this pass: made from the seeds the last pass left, with more of the kinds it found the swarm trailing on
export const questions = (split, each = Number(arg('each', 6))) => {
  const kinds = String(arg('kinds', '')).split(',').filter(Boolean);
  const state = readState();
  const of = (s) =>
    tasks({
      split: s,
      each,
      // the kinds this configuration's pass asks: its record says (a pass ends on the questions it began with, whatever is
      // chosen meanwhile; one begun before there was a choice ends on the programming kinds); a first pass asks what is chosen
      kinds: kinds.length
        ? kinds
        : state.kinds || ((state.history || []).length ? CODE_KIND_NAMES : kindsFor(readConfig().equivalence)),
      seed: state.seeds[s],
      focus: state.focus,
      tiers: state.tiers || {},
      // the questions a person wrote: as the pass's record has them (a pass ends on the questions it began with); a first pass
      // reads them as they are now; a pass begun before they could be written, and a run told which kinds to ask, has none
      own: kinds.length ? {} : state.own || ((state.history || []).length ? {} : readOwn(readConfig().equivalence)),
    });
  // the held questions, each put a second way (tasks.mjs: reword); they are compared with the larger model's answer to the first
  return split === 'reworded' ? reworded(of('held')) : of(split);
};
export const chosen = () => {
  const list = questions(arg('split', 'train'));
  const limit = Number(arg('limit', 0));
  return limit ? list.slice(0, limit) : list;
};

// WHAT IS HAPPENING NOW, written where the page reads it (.work/train/live.json): which trainer, which question, and for every
// slot whether it is working or what it just answered. Written as it happens; a page that is not open costs a small file.
const LIVE = path.join(WORK, 'live.json');
const liveNow = { slots: {} };
export function live(patch = {}) {
  Object.assign(liveNow, patch, { at: Date.now(), trainer: path.basename(process.argv[1] || '', '.mjs') });
  try {
    fs.mkdirSync(WORK, { recursive: true });
    fs.writeFileSync(LIVE + '.tmp', JSON.stringify(liveNow));
    fs.renameSync(LIVE + '.tmp', LIVE);
  } catch {
    /* the page goes without */
  }
}
// totals: for each slot (or model alone), how many turns it has finished in this step and how long they took in all. A slot's
// clock on the page starts again with every question; this is what says how much it has been engaged altogether.
const liveSlot = (id, what) => {
  liveNow.slots = { ...liveNow.slots, [id]: what };
  if (what.state !== 'working' && typeof what.ms === 'number') {
    const t = (liveNow.totals = liveNow.totals || {})[id] || { turns: 0, ms: 0 };
    liveNow.totals = { ...liveNow.totals, [id]: { turns: t.turns + 1, ms: t.ms + what.ms } };
  }
  live();
};

// WHERE THE DECIDER IS: named (--decider, or SWARM_DECIDER; --kev and SWARM_KEV, the names from when Kev was the only decider,
// still work), or the one training/decider.sh started on this machine (it writes its port down), if that one answers. '' when
// there is none: the trainers then say so, because a pass without a decider trains another arrangement.
// WHO READS EQUIVALENCE: the judge the session started apart from the decider (SWARM_JUDGE; src/catalog.mjs JUDGE), else the
// decider itself
export const judgeAddress = (decider) => process.env.SWARM_JUDGE || decider;
// where training/decider.sh writes the port of the decider it started (and where it wrote it when it was training/kev.sh)
const PORT_FILES = [path.join(REPO_ROOT, '.work', 'decider', 'port'), path.join(REPO_ROOT, '.work', 'kev', 'port')];
export async function deciderAddress() {
  const named = arg('decider', arg('kev', process.env.SWARM_DECIDER || process.env.SWARM_KEV || ''));
  if (named) return named;
  for (const f of PORT_FILES)
    try {
      const port = Number(fs.readFileSync(f, 'utf8').trim());
      const base = 'http://127.0.0.1:' + port;
      if (port && (await fetch(base + '/v1/models', { signal: AbortSignal.timeout(3000) })).ok) return base;
    } catch {
      /* none running there */
    }
  return '';
}
// THE DECIDER, KEPT UP. Where the decider is the one this folder runs (training/decider.sh), and it has stopped, it is started
// again before the next question, and that is written down. A decider someone named is theirs to keep up.
let deciderCheckedAt = 0;
export async function deciderGuard(decider) {
  if (
    !decider ||
    (process.env.SWARM_DECIDER_FIXED || process.env.SWARM_KEV_FIXED) === '1' ||
    Date.now() - deciderCheckedAt < 15000
  )
    return;
  deciderCheckedAt = Date.now();
  const up = async () => {
    try {
      return (await fetch(decider + '/v1/models', { signal: AbortSignal.timeout(4000) })).ok;
    } catch {
      return false;
    }
  };
  if (await up()) return;
  const port = Number((/:(\d+)$/.exec(decider) || [])[1]);
  const script = path.join(REPO_ROOT, 'training', 'decider.sh');
  if (!port || spawnSync('bash', [script, 'ready']).status !== 0)
    return void note(
      'the decider',
      "it has stopped and is not this folder's to start: the answer most slots gave will stand",
      { kind: 'gone' },
    );
  fs.mkdirSync(WORK, { recursive: true });
  const log = fs.openSync(path.join(WORK, 'decider.log'), 'a');
  spawn('bash', [script, 'serve', String(port)], { stdio: ['ignore', log, log], env: process.env }).unref();
  for (let i = 0; i < 90 && !(await up()); i++) await new Promise((r) => setTimeout(r, 2000));
  note(
    'the decider',
    (await up())
      ? 'it had stopped: started again'
      : 'it had stopped and would not start again: the answer most slots gave will stand',
    { kind: 'gone' },
  );
}
// what a run of the swarm is a run OF: the swarm as configured, with these briefs and this plan, on these questions. A checkpoint
// under this name holds answers to exactly that, and nothing else.
// what a measurement is a measurement OF, in a name: the swarm, the larger model, the arrangement (its content), the questions,
// and the programs that ran it (a measurement made by other code is not this one)
const CODE_KEY = (() => {
  const h = createHash('sha256');
  const dir = path.join(REPO_ROOT, 'src');
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.mjs'))
    .sort())
    h.update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex').slice(0, 8);
})();
export const swarmName = (briefs, split, seed) =>
  ['swarm', CONFIG_ID, targetOf().id, briefKey(briefs), CODE_KEY, split, seed].join('-');
// A MEASUREMENT ALREADY MADE IS NOT MADE AGAIN. The trainers ask with a fixed seed (the same slot asked the same thing draws the
// same answer), so the same arrangement on the same questions gives the same rows: they are kept (.work/train/measured), and
// "the swarm as it is" is measured once in a pass and not once for every slot and again for the arrangements.
const MEASURED = path.join(WORK, 'measured');
const keyOfName = (name) => name.replace(/^(?:measure|try)-/, '').replace(/[^\w.+-]+/g, '_');
const measuredRows = (name, list) => {
  try {
    const have = new Map(
      fs
        .readFileSync(path.join(MEASURED, keyOfName(name) + '.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((r) => [r.id, r]),
    );
    return list.every((t) => have.has(t.id)) ? list.map((t) => have.get(t.id)) : null;
  } catch {
    return null;
  }
};
const checkpoints = [];
// a trainer that has finished and written down what it found has no more use for its checkpoints
export const finished = () => checkpoints.splice(0).forEach((c) => c.done());

export async function openSwarm(briefs = readBriefs(), { seed = Number(arg('seed', 1)), reuse = false } = {}) {
  const attach = {};
  if (arg('attach-a')) attach.a = arg('attach-a');
  if (arg('attach-b')) attach.b = arg('attach-b');
  const decider = await deciderAddress();
  // the members' adapters, where the configuration serves them ("adapters": true; Pretrain on the page trains them)
  const { lorasFor } = await import('../adapters.mjs');
  const loras = lorasFor(readConfig(), MEMBERS, path.join(REPO_ROOT, '.work'), targetOf().id, modelsDir());
  if (Object.keys(loras).length)
    console.log(
      'Served with adapters: ' +
        Object.keys(loras)
          .map((k) => MEMBERS[k].name)
          .join(', ') +
        '.',
    );
  console.log(
    decider
      ? 'The decider decides, at ' + decider + '.'
      : 'NO DECIDER: nothing is running to decide (bash training/decider.sh serve). The answer most slots gave will stand.',
  );
  const swarm = await createSwarm({
    briefs,
    seed, // a measurement that changes by itself cannot say whether a change helped
    reuse, // the loop: a slot asked exactly what it was asked before answers as it did, without being asked again
    attach,
    llamaServer: llamaServer(),
    modelsDir: modelsDir(),
    decider,
    loras,
    onRecover: note,
    // (an agent's step is asked with tools, whichever way the configuration has it decided: the servers read and write calls in
    // each model's own template. Builds of llama.cpp that already do so by default are not changed by it)
    jinja: true,
  });
  // (which places are served with an adapter: written on every answer it gives, so that a measurement says how it was served)
  swarm.adapters = Object.keys(loras).sort();
  // every slot, as it starts and as it ends
  const answer = swarm.answer.bind(swarm);
  swarm.answer = (messages, o = {}) =>
    answer(messages, {
      ...o,
      onStart: (x) => liveSlot(x.slot, { state: 'working', since: Date.now() }),
      onStep: (row) =>
        liveSlot(row.slot, {
          state: row.ok ? 'done' : 'failed',
          ms: row.ms,
          said: String(row.final || row.out || row.why || '')
            .replace(/\s+/g, ' ')
            .slice(0, 120),
        }),
    });
  return swarm;
}
// one model by itself, one conversation at a time: what the swarm is measured against.
//   which: 'a' | 'b' | 'target' (the larger model being chased: target.mjs) | an address that speaks /v1/chat/completions
export async function openAlone(which) {
  if (which === 'target') {
    const t = await openTarget(targetOf(), { llamaServer: llamaServer(), modelsDir: modelsDir(), onRecover: note });
    return { ask: (messages, o) => t.ask(messages, o), stop: t.stop, label: t.rung.id };
  }
  if (/^https?:/.test(which)) {
    const m = attachMember({ key: 'ref', name: arg('label', 'reference'), sampling: {} }, which, 1);
    return {
      ask: (messages, o = {}) => m.ask('alone', messages, { maxTokens: 700, ...(o.tools ? { tools: o.tools } : {}) }),
      stop: () => {},
    };
  }
  const at = arg('attach-' + which);
  if (at) {
    const m = attachMember(MEMBERS[which], at, 1);
    return {
      ask: (messages, o = {}) => m.ask('alone', messages, { maxTokens: 700, ...(o.tools ? { tools: o.tools } : {}) }),
      stop: () => {},
    };
  }
  // (model:<id>: any small model of the catalog, whatever the swarm is made of: measured alone before it is chosen, so that the
  // page's recommendations can weigh it; training/setup.mjs --model <id> fetches it)
  const named = String(which).startsWith('model:') ? REGISTRY.small.find((m) => m.id === String(which).slice(6)) : null;
  if (String(which).startsWith('model:') && !named)
    throw new Error('no small model in src/models.json is ' + String(which).slice(6));
  const r = await startMember(named ? { ...named, key: 'alone' } : MEMBERS[which], {
    jinja: true, // (a step in an agent's work is asked with tools: the server reads and writes calls in the model's own template)
    onRecover: note,
    llamaServer: llamaServer(),
    modelsDir: modelsDir(),
    slots: 1,
    contextPerSlot: 8192,
  });
  if (!r.ok) throw new Error(r.why);
  return {
    ask: (messages, o = {}) =>
      r.member.ask('alone', messages, { maxTokens: 700, ...(o.tools ? { tools: o.tools } : {}) }),
    stop: r.member.stop,
  };
}

// WHAT THE LARGER MODEL ANSWERED, for these questions: id -> its whole reply. The swarm is trained toward these, so nothing can
// be measured until the larger model has answered the same questions (node training/baseline.mjs --who target --split <split>).
// Equivalence is decided from the replies themselves (a function is run, not summarised).
export function reference(list) {
  const label = targetOf().id;
  const file = path.join(WORK, 'baseline-runs.jsonl');
  // (a question put a second way is compared with the larger model's answer to it put the first way)
  const ids = new Map(list.map((t) => [t.refId || t.id, t.id]));
  const ref = new Map();
  const toSpec = new Map();
  if (fs.existsSync(file))
    for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (r.label === label && ids.has(r.id)) {
        ref.set(ids.get(r.id), String(r.reply || ''));
        toSpec.set(ids.get(r.id), r.toSpec);
      }
    }
  ref.toSpec = toSpec; // whether its own answer does what the question says (tasks: toSpec)
  return ref;
}
export function needReference(list, split) {
  const ref = reference(list);
  if (ref.size < list.length) {
    console.log(
      targetOf().name +
        ' has answered ' +
        ref.size +
        ' of these ' +
        list.length +
        ' ' +
        split +
        ' questions. Parity is equivalence with its answers, so it goes first:\n  node training/baseline.mjs --who target --split ' +
        split,
    );
    process.exit(2);
  }
  return ref;
}

// put every question to `answerOf(task) -> { reply, ...anything }`, one after another, and mark each reply by whether it is
// FUNDAMENTALLY EQUIVALENT TO THE LARGER MODEL'S REPLY (ref): for a function, whether the two functions do the same; for a value,
// whether it is the same value; for an answer in words, whether the decider (or the judge) says they say the same (tasks.mjs, support/equivalent.mjs).
// The marks keep their short names, and here they mean:
//   right    equivalent to the larger model's answer       wrong    not equivalent: a different answer
//   unsure   the reply gave no answer                      noref    the larger model gave none, or nothing could compare: not counted
// self: true is the larger model itself, whose own answer is the mark (right when it gave one).
let deciderOnce = null;
// name: what these answers are answers to. With one, every answer is written down as it comes (a checkpoint), and a run under
// the same name starts with the answers it has and asks only what is left: a trainer that stopped midway carries on.
// THE READER CHECKED IS THE ONE THAT READS. The check of the reader (training/readers.mjs) runs before a pass, and says whose it is;
// where the reader has changed since (a judge chosen partway through a pass), the old reader's verdict is not this one's: it is
// checked again here, once, before any answer in words is graded. Found 2026-11-18: Kev 0.8B failed its check, so 42 questions
// answered in words were not compared, and choosing Jeffan 4B as the judge would not have counted until the next pass
let readerChecked = false;
export function readerNow() {
  return process.env.SWARM_JUDGE && JUDGE ? JUDGE.id : (DECIDER || {}).id;
}
export function readerStale(work = WORKC, now = readerNow()) {
  try {
    const by = JSON.parse(fs.readFileSync(READER_FILE(work), 'utf8')).by;
    return !!by && !!now && by !== now ? by : '';
  } catch {
    return ''; // (not checked at all: a pass run by hand without the check, as before)
  }
}
export function readerCurrent(list) {
  if (readerChecked || !list.some((t) => t.type === 'open' || t.type === 'talk')) return;
  readerChecked = true;
  const was = readerStale();
  if (!was) return;
  console.log(
    'The reader is now ' + readerNow() + ', not ' + was + ', whose check is on record: checking it before it reads.',
  );
  spawnSync(process.execPath, [path.join(REPO_ROOT, 'training', 'readers.mjs')], {
    env: process.env,
    stdio: 'inherit',
  });
}
export async function run(
  list,
  answerOf,
  { onRow = () => {}, ref = null, self = false, who = 'swarm', name = '', until = null, at = null } = {},
) {
  // measured before, by these programs, on these questions: the rows as they were
  const before = name && who === 'swarm' ? measuredRows(name, list) : null;
  if (before) {
    before.forEach(onRow);
    return before;
  }
  readerCurrent(list);
  deciderOnce = deciderOnce || deciderAddress();
  const decider = await deciderOnce;
  const ck = name ? checkpoint(name) : null;
  if (ck) checkpoints.push(ck);
  const had = ck ? list.filter((t) => ck.have.has(t.id)).length : 0;
  if (had)
    note(
      who === 'swarm' ? 'the swarm' : who,
      'this run had stopped partway: carrying on from ' + had + ' of ' + list.length + ' answers already written down',
      { kind: 'resumed' },
    );
  const rows = [];
  for (const t of list) {
    if (ck && ck.have.has(t.id)) {
      rows.push(ck.have.get(t.id));
      onRow(ck.have.get(t.id));
      continue;
    }
    if (who === 'swarm' || t.type === 'open' || t.type === 'talk') await deciderGuard(decider);
    const t0 = Date.now();
    let got = { reply: '' };
    live({
      who,
      split: t.split,
      // (at: where this question stands in a longer run that asks one at a time: training/loop.mjs)
      n: at ? at.n : rows.length + 1,
      of: at ? at.of : list.length,
      question: { id: t.id, kind: t.kind, ask: t.ask.slice(0, 400) },
      slots: who === 'swarm' ? {} : { [who]: { state: 'working', since: t0 } },
    });
    try {
      got = await answerOf(t);
    } catch (e) {
      got = { reply: '', why: String((e && e.message) || e).slice(0, 200) };
    }
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const theirs = self ? got.reply : ref ? ref.get(t.id) : undefined;
    let mark = { grade: 'noref' };
    const holds = (text) => (t.usable ? t.usable(text) : !!t.show(text));
    const readsWords = t.type === 'open' || t.type === 'talk';
    const ctx = { reader: judgeAddress(decider), mark: readerMark(WORKC, t.type) };
    // GRADED BY THE QUESTION'S OWN STANDARD WHERE IT HAS ONE (tasks.mjs good; docs/swoa-parity.md, 4): the larger model's answer is
    // then not needed to grade the swarm's, and is itself one more answer graded the same way (toSpec, below)
    let own = false;
    const std = !self && ref && ref.standard ? ref.standard.get(t.id) : null;
    if (self) mark = { grade: holds(got.reply) ? 'right' : 'unsure' };
    else if (t.good && process.env.SWARM_GRADE !== 'target') {
      own = true;
      mark =
        readsWords && !readerOk(WORKC, t.type)
          ? {
              grade: 'noref',
              why: 'the reader of answers in words failed its own check this pass (training/readers.mjs)',
            }
          : got.why
            ? { grade: 'unsure' }
            : (await t.good(got.reply, ctx)) || { grade: 'noref' };
    } else if (theirs !== undefined)
      // a reply of the larger model's that holds no answer (cut off, empty) is nothing to be equivalent to: not compared
      mark = !holds(theirs)
        ? { grade: 'noref' }
        : (t.type === 'open' || t.type === 'talk') && !readerOk(WORKC, t.type)
          ? {
              grade: 'noref',
              why:
                'the reader of ' +
                (t.type === 'talk' ? 'replies in a conversation' : 'answers in words') +
                ' failed its own check this pass (training/readers.mjs)',
            }
          : std && std.none
            ? {
                grade: 'noref',
                noStandard: true,
                why: "the larger model's own answers to it do not agree with each other: it has no standard",
              }
            : got.why
              ? { grade: 'unsure' }
              : // (against the answers the larger model agrees with itself on, where they were worked out: support/standard.mjs)
                std
                ? await againstStandard(t, std, got.reply, ctx)
                : await t.equivalent(theirs, got.reply, ctx);
    const row = {
      cfg: who === 'swarm' ? CONFIG_ID : undefined,
      target: targetOf().id,
      id: t.id,
      kind: t.kind,
      split: t.split,
      seed: t.seed,
      ask: t.ask,
      ref: theirs === undefined ? '' : t.show(theirs),
      refReply: self ? undefined : theirs,
      said: got.why ? '' : t.show(got.reply),
      grade: mark.grade,
      seconds,
      ...got,
    };
    if (mark.grade === 'wrong' && mark.input !== undefined)
      row.partsOn = { input: mark.input, theirs: mark.theirs, ours: mark.ours };
    if (mark.why) row.markWhy = mark.why;
    if (mark.noStandard) row.noStandard = true;
    if (mark.undecided) row.undecided = true; // (support/equivalent.mjs UNDECIDED: graded different, counted apart)
    // (and how the reader read the reply itself: the probability that it says what the larger model's says. The loop climbs by it.
    // Graded by the question's own standard: how far it met it, the share of the question's inputs it gets right for code)
    if (typeof mark.p === 'number') row.reading = Math.round(mark.p * 1000) / 1000;
    else if (own && typeof mark.score === 'number') row.reading = Math.round(mark.score * 1000) / 1000;
    if (own) {
      row.standard = 'own';
      if (typeof mark.score === 'number') row.score = Math.round(mark.score * 1000) / 1000;
      // (whether it also agrees with the larger model's answer: a thing to look at, no longer the grade. Not asked where that
      // takes the reader: one reading a reply is enough)
      if (!readsWords && theirs !== undefined && holds(theirs) && !got.why)
        try {
          row.agrees = (await t.equivalent(theirs, got.reply, ctx)).grade === 'right';
        } catch {
          /* not said */
        }
    }
    // a reply in a conversation: which part of equivalence it was lost on (the act, the substance, the conduct)
    if (mark.part) row.part = mark.part;
    if (mark.faults) row.faults = mark.faults;
    if (t.mode) row.mode = t.mode;
    // DOES THE LARGER MODEL'S OWN ANSWER DO WHAT THE QUESTION SAYS? Parity is equivalence with it whatever it answers; but where
    // it departs from the question itself no swarm can be expected to follow, and those questions are counted apart as well
    if (self && t.toSpec && !(readsWords && !readerOk(WORKC, t.type))) row.toSpec = await t.toSpec(got.reply, ctx);
    if (!self && ref && ref.toSpec) row.refToSpec = ref.toSpec.get(t.id);
    if (who !== 'swarm')
      liveSlot(who, {
        state: got.why ? 'failed' : 'done',
        ms: Math.round(seconds * 1000),
        said: String(row.said || '').slice(0, 120),
      });
    live({ last: { id: t.id, grade: row.grade } });
    if (ck) ck.add(row);
    rows.push(row);
    onRow(row);
    // a trial that can no longer be kept is not run to its end
    if (until && until(rows, list.length - rows.length)) {
      rows.stopped = true;
      break;
    }
  }
  if (name && who === 'swarm' && !rows.stopped && rows.length === list.length) {
    fs.mkdirSync(MEASURED, { recursive: true });
    fs.writeFileSync(
      path.join(MEASURED, keyOfName(name) + '.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
  }
  live({ who: '', question: null, slots: {} });
  return rows;
}
// QUESTION BY QUESTION: on the same questions, how many answers a change wins (equivalent now, not before) and how many it loses
export function paired(before, after) {
  const was = new Map(before.map((r) => [r.id, r.grade === 'right']));
  // (a reading the reader was undecided on, before or after, is neither a win nor a loss: a change is not kept on a coin toss)
  const unsure = new Set(before.filter((r) => r.undecided).map((r) => r.id));
  let wins = 0;
  let losses = 0;
  for (const r of after) {
    if (!was.has(r.id) || r.undecided || unsure.has(r.id)) continue;
    const now = r.grade === 'right';
    if (now && !was.get(r.id)) wins++;
    if (!now && was.get(r.id)) losses++;
  }
  return { wins, losses, net: wins - losses };
}
// right = an answer equivalent to the larger model's; compared = the questions the larger model gave an answer to
export function count(rows) {
  const c = { asked: rows.length, right: 0, wrong: 0, unsure: 0, noref: 0 };
  for (const r of rows) c[r.grade]++;
  c.compared = c.asked - c.noref;
  // the same, on the questions where the larger model's own answer does what the question says
  const spec = rows.filter((r) => r.refToSpec === true && r.grade !== 'noref');
  c.onSpec = { compared: spec.length, right: spec.filter((r) => r.grade === 'right').length };
  c.score = c.right - c.wrong; // a different answer costs what an equivalent one earns; settling on nothing costs nothing and earns nothing
  c.seconds = rows.length ? Math.round((rows.reduce((a, r) => a + r.seconds, 0) / rows.length) * 10) / 10 : 0;
  const kinds = {};
  for (const r of rows) {
    if (r.grade === 'noref') continue;
    kinds[r.kind] = kinds[r.kind] || { asked: 0, right: 0, wrong: 0 };
    kinds[r.kind].asked++;
    if (r.grade !== 'unsure') kinds[r.kind][r.grade]++;
  }
  return { ...c, kinds };
}
export const line = (label, c) =>
  label.padEnd(26) +
  String(c.right).padStart(3) +
  ' of ' +
  c.compared +
  ' equivalent ' +
  String(c.wrong).padStart(3) +
  ' different ' +
  String(c.unsure).padStart(3) +
  ' none   ' +
  c.seconds +
  ' s each';

export function save(label, body) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(RESULTS, label + '.json'), JSON.stringify({ at, ...body }, null, 2) + '\n');
  fs.appendFileSync(
    path.join(RESULTS, 'history.jsonl'),
    JSON.stringify({ at, label, ...body, rows: undefined, slots: body.slots }) + '\n',
  );
}
export function rowsTo(file, rows) {
  fs.mkdirSync(WORK, { recursive: true });
  fs.appendFileSync(path.join(WORK, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// A QUESTION PUT TO THE SWARM, as it is meant to be put: a step in an agent's work (a question with tools) is a turn with tools
// (swarm.answerTools: decided by the swarm or the lead's own, as the configuration says), written down as its step; any other is
// answered as messages
export async function askSwarm(swarm, t, messages) {
  if (!t.tools) return swarm.answer(messages);
  const got = await swarm.answerTools(messages, { tools: t.tools });
  return { ...got, reply: got.text };
}
