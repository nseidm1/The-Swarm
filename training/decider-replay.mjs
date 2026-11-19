// decider-replay.mjs - WOULD ANOTHER DECIDER HAVE CHOSEN BETTER? Measured on the first long session: the decider had the larger model's
// answer in front of it and chose another 9 times in 70. Which decision model sits in the decide step is part of the configuration,
// and so is not something a pass can try on its own; but every decision is recorded (what the drafts were, which of them was the
// larger model's answer, what the decider chose), so another decider can be put the same choices afterwards, with nothing else run, and
// counted: how often it chooses the larger model's answer where the decider in use did, where it did not, and where it did and the other does not.
// The choices are rebuilt from the record (the distinct answers that stood when the decision was made), so they are close to what
// the decider in use was asked, not the same request word for word: this says which decider is worth a real pass, not that one is better.
//   node training/decider-replay.mjs --at http://127.0.0.1:8012 [--name startlux-4b]
//   node training/decider-replay.mjs --start startlux-4b          start it here (training/decider.sh), replay, stop it
//   node training/decider-replay.mjs --members                    EACH SMALL MODEL OF THE SWARM AS THE DECIDER: put the same choices,
//        told what a model that decides is told (orchestrate.mjs JUDGE_BRIEF). One that chooses as well as the decision model is
//        a swarm that needs no decision model, a third of its memory; the trainer can then try it (a model decides in place
//        of the decider). May be given with --installed
//   node training/decider-replay.mjs --installed                  every other decider whose weights are already here
// Written to .work/train/<configuration>/decider-replay.json, and shown on the page.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { arg, has, WORK, WORKC, REPO_ROOT } from './support/bench.mjs';
import { REGISTRY, DECIDER, CONFIG_ID, TARGET } from '../src/catalog.mjs';
import { deciderAt } from '../src/decider.mjs';
import { lastTrainRows } from './replay.mjs';
import { readState } from './state.mjs';
import { freePort } from './support/recover.mjs';
import { JUDGE_BRIEF } from '../src/orchestrate.mjs';
import { letterOf, MARKER } from '../src/read.mjs';

export const REPLAY_FILE = path.join(WORKC, 'decider-replay.json');
const LETTERS = 'ABCDEFGH';
const plain = (s) => String(s || '').replace(/\s+/g, '');
// the choices one recorded decision was between: the distinct answers standing, each with whether it was the larger model's
export function choicesOf(row) {
  const decide = (row.trace || []).find((t) => t.stage === 'decide' && t.of !== 'replies' && t.final);
  if (!decide) return null;
  const latest = new Map();
  for (const t of row.trace || []) if ((t.stage === 'draft' || t.stage === 'revise') && t.final) latest.set(t.slot, t);
  const groups = [];
  for (const t of latest.values()) {
    const k = t.does ? 'does:' + t.does : plain(t.final);
    const g = groups.find((x) => x.key === k);
    if (g) g.same = g.same || t.same === true;
    else groups.push({ key: k, final: t.final, work: String(t.out || '').slice(0, 1200), same: t.same === true });
  }
  if (groups.length < 2 || !groups.some((g) => g.same)) return null;
  return {
    question: String(row.ask || ''),
    answers: groups
      .slice(0, LETTERS.length)
      .map((g, i) => ({ letter: LETTERS[i], final: g.final, work: g.work, same: g.same })),
    checks: (row.trace || []).filter((t) => t.stage === 'check' && t.out).map((t) => String(t.out).slice(0, 400)),
    nowRight: decide.same === true,
  };
}
// A SMALL MODEL AS THE DECIDER: -> a decide function (what replayWith puts each choice to) that shows the model the question and
// the answers as a model that decides is shown them, and reads the letter it names. ask(messages) -> { text }
export function modelDecider(ask, { marker = MARKER } = {}) {
  return async ({ question, answers, checks = [] }) => {
    const sheet =
      'The question:\n' +
      question +
      '\n\n' +
      answers
        .map((a) => 'Answer ' + a.letter + ':\n' + (a.work ? a.work + '\n' : '') + 'Its final answer: ' + a.final)
        .join('\n\n') +
      (checks.length ? '\n\nWhat those who checked them said:\n' + checks.join('\n') : '');
    try {
      const r = await ask([
        { role: 'system', content: JUDGE_BRIEF.replace('ANSWER:', marker) },
        { role: 'user', content: sheet },
      ]);
      const letter = letterOf(String((r && r.text) || ''), marker, LETTERS);
      return letter && answers.some((a) => a.letter === letter) ? { ok: true, letter } : { ok: false };
    } catch {
      return { ok: false };
    }
  };
}
export async function replayWith(decide, rows) {
  const out = { asked: 0, nowRight: 0, theirsRight: 0, recovered: 0, lost: 0, failed: 0 };
  for (const row of rows) {
    const c = choicesOf(row);
    if (!c) continue;
    const got = await decide({ question: c.question, answers: c.answers, checks: c.checks });
    if (!got.ok) {
      out.failed++;
      continue;
    }
    out.asked++;
    const right = !!(c.answers.find((a) => a.letter === got.letter) || {}).same;
    if (c.nowRight) out.nowRight++;
    if (right) out.theirsRight++;
    if (right && !c.nowRight) out.recovered++;
    if (!right && c.nowRight) out.lost++;
  }
  return out;
}
// a decider whose weights are already on this machine (nothing is fetched to replay)
export function weightsHere(d) {
  const kind = (d.serve || { kind: 'kev' }).kind;
  if (kind === 'startlux-mlx')
    return fs.existsSync(path.join(REPO_ROOT, '.work', 'deciders', d.id, 'model', '.complete'));
  if (kind === 'llama') return fs.existsSync(path.join(REPO_ROOT, '.work', 'deciders', d.id, '.complete'));
  if (kind === 'kev') {
    const repo = String(d.run || '')
      .split('@')[0]
      .replace('/', '--');
    return !!repo && fs.existsSync(path.join(REPO_ROOT, '.work', 'kev', 'hf', 'hub', 'models--' + repo));
  }
  return false;
}
async function started(id) {
  const port = await freePort(8031);
  // (not written to the port file: that names the session's own decider, which the page and the trainers look for there)
  const env = { ...process.env, DECIDER_ID: id, DECIDER_NO_PORT_FILE: '1' };
  const p = spawn('bash', [path.join(REPO_ROOT, 'training', 'decider.sh'), 'serve', String(port)], {
    env,
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/v1/models', { signal: AbortSignal.timeout(3000) })).ok)
        return { base, stop: () => (p.kill('SIGTERM'), spawnSync('pkill', ['-f', '--port ' + port])) };
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  p.kill('SIGTERM');
  return null;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const state = readState();
  const rows = lastTrainRows(WORK, state.seeds.train, CONFIG_ID, TARGET.id);
  const runs = [];
  const ids = has('installed')
    ? REGISTRY.deciders
        .filter(
          (d) =>
            d.id !== DECIDER.id &&
            weightsHere(d) &&
            (d.runsOn || ['mac']).includes(process.platform === 'darwin' ? 'mac' : 'cuda'),
        )
        .map((d) => d.id)
    : arg('start')
      ? [arg('start')]
      : [];
  if (arg('at')) runs.push({ name: arg('name', arg('at')), base: arg('at') });
  for (const id of ids) {
    const s = await started(id);
    if (!s) {
      console.log(id + ' did not come up: not replayed.');
      continue;
    }
    runs.push({ name: id, base: s.base, stop: s.stop });
  }
  if (!runs.length && !has('members')) {
    console.log(
      has('installed')
        ? 'No other decider has its weights on this machine: nothing to replay.'
        : 'Name one: --at <address>, --start <decider id> or --installed.',
    );
    process.exit(0);
  }
  const out = { at: new Date().toISOString(), pass: state.pass + 1, against: DECIDER.id, results: [] };
  for (const r of runs) {
    try {
      const res = await replayWith(deciderAt({ base: r.base, timeoutMs: 60000 }), rows);
      out.results.push({ decider: r.name, ...res });
      console.log(
        r.name +
          ": chose the larger model's answer " +
          res.theirsRight +
          ' times of ' +
          res.asked +
          ' (' +
          DECIDER.name +
          ': ' +
          res.nowRight +
          '); recovered ' +
          res.recovered +
          ' that ' +
          DECIDER.name +
          ' missed, and lost ' +
          res.lost +
          ' it had.',
      );
    } finally {
      if (r.stop) r.stop();
    }
  }
  // EACH SMALL MODEL OF THE SWARM, AS THE DECIDER (--members): one at a time, on a server of its own
  if (has('members')) {
    const { MEMBERS } = await import('../src/catalog.mjs');
    const { openAlone } = await import('./support/bench.mjs');
    for (const [place, m] of Object.entries(MEMBERS)) {
      let model = null;
      try {
        model = await openAlone(place);
        const res = await replayWith(modelDecider(model.ask), rows);
        out.results.push({ decider: m.id, kind: 'model', place, name: m.name, ...res });
        console.log(
          m.name +
            ", a small model of the swarm, as the decider: chose the larger model's answer " +
            res.theirsRight +
            ' times of ' +
            res.asked +
            ' (' +
            DECIDER.name +
            ': ' +
            res.nowRight +
            '); recovered ' +
            res.recovered +
            ', lost ' +
            res.lost +
            (res.failed ? ', named no answer ' + res.failed + ' times' : '') +
            '.',
        );
      } catch (e) {
        console.log(m.name + ' could not be asked: ' + String((e && e.message) || e).slice(0, 120));
      } finally {
        if (model) await model.stop();
      }
    }
  }
  fs.mkdirSync(WORKC, { recursive: true });
  fs.writeFileSync(REPLAY_FILE, JSON.stringify(out, null, 2) + '\n');
}
