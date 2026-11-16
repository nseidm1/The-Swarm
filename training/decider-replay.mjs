// decider-replay.mjs - WOULD ANOTHER DECIDER HAVE CHOSEN BETTER? Measured on the first long session: Kev had the larger model's
// answer in front of it and chose another 9 times in 70. Which decision model sits in the decide step is part of the configuration,
// and so is not something a pass can try on its own; but every decision is recorded (what the drafts were, which of them was the
// larger model's answer, what Kev chose), so another decider can be put the same choices afterwards, with nothing else run, and
// counted: how often it chooses the larger model's answer where Kev did, where Kev did not, and where Kev did and it does not.
// The choices are rebuilt from the record (the distinct answers that stood when the decision was made), so they are close to what
// Kev was asked, not the same request word for word: this says which decider is worth a real pass, not that one is better.
//   node training/decider-replay.mjs --at http://127.0.0.1:8012 [--name startlux-4b]
//   node training/decider-replay.mjs --start startlux-4b          start it here (training/kev.sh), replay, stop it
//   node training/decider-replay.mjs --installed                  every other decider whose weights are already here
// Written to .work/train/<configuration>/decider-replay.json, and shown on the page.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { arg, has, WORK, WORKC, REPO_ROOT } from './support/bench.mjs';
import { REGISTRY, DECIDER, CONFIG_ID, TARGET } from '../src/catalog.mjs';
import { kevDecider } from '../src/decider.mjs';
import { lastTrainRows } from './replay.mjs';
import { readState } from './state.mjs';
import { freePort } from './support/recover.mjs';

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
    kevRight: decide.same === true,
  };
}
export async function replayWith(decide, rows) {
  const out = { asked: 0, kevRight: 0, theirsRight: 0, recovered: 0, lost: 0, failed: 0 };
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
    if (c.kevRight) out.kevRight++;
    if (right) out.theirsRight++;
    if (right && !c.kevRight) out.recovered++;
    if (!right && c.kevRight) out.lost++;
  }
  return out;
}
// a decider whose weights are already on this machine (nothing is fetched to replay)
export function weightsHere(d) {
  const kind = (d.serve || { kind: 'kev' }).kind;
  if (kind === 'startlux-mlx')
    return fs.existsSync(path.join(REPO_ROOT, '.work', 'deciders', d.id, 'model', '.complete'));
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
  const p = spawn('bash', [path.join(REPO_ROOT, 'training', 'kev.sh'), 'serve', String(port)], {
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
  if (!runs.length) {
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
      const res = await replayWith(kevDecider({ base: r.base, timeoutMs: 60000 }), rows);
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
          res.kevRight +
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
  fs.mkdirSync(WORKC, { recursive: true });
  fs.writeFileSync(REPLAY_FILE, JSON.stringify(out, null, 2) + '\n');
}
