// engine-update.mjs - AN ENGINE BROUGHT UP TO DATE, FROM THE PAGE'S BUTTON (ui/swarm_ui.py engine_recommendations).
//   node training/engine-update.mjs tensorfold     the larger model's engine: its maker's own installer (the catalog's
//                                                  serve.upgrade), and then the version it says it is
//   node training/engine-update.mjs llama          llama.cpp, to the build the catalog pins, AND ONLY WHERE EVERY MODEL OF THE
//                                                  SWARM STILL ANSWERS WITH IT
// llama.cpp is not updated to "the newest": the build the catalog pins (src/models.json engine) is fetched and checked by its
// hash, into .work/engine/<tag>, beside whatever llama-server this machine has, which is not touched. Then each small model of
// the configuration (and a decision model llama.cpp serves) is loaded with the new build and asked a sum: one that needs
// support an engine may lose (Bonsai 2's ternary weights are rotated, and an engine without the matching transform answers
// with gibberish, not with an error) fails here and not in the middle of a pass. Only where all answer is the new build made
// the one the swarm uses (.work/engine/chosen, which support/bench.mjs llamaServer reads before the PATH). Where one does
// not, nothing changes and the state says which.
// It writes .work/engine/update-<id>.json as it goes: { id, pid, phase: running | done | failed, step, from, to, at }.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// what an engine says of itself -> its version, the build where it names one ("b12359"), '' where it says none
export function versionIn(said) {
  const t = String(said || '');
  const b = /build\s+(\d+)/i.exec(t) || /\bb(\d{4,})\b/.exec(t);
  if (b) return 'b' + b[1];
  const v = /(\d+(?:\.\d+){1,3})/.exec(t);
  return v ? v[1] : '';
}
export const saidBy = (program) => {
  try {
    const r = spawnSync(program, ['--version'], { encoding: 'utf8', timeout: 15000 });
    return String(r.stdout || '') + String(r.stderr || '');
  } catch {
    return '';
  }
};
// a reply to "What is 2 + 2?" that a working model gives: it has the figure 4 in it, as a number of its own
export const answersTheSum = (reply) =>
  /(^|[^\d.])4([^\d]|$)/.test(String(reply || '')) || /\bfour\b/i.test(String(reply || ''));

const freePort = () =>
  new Promise((ok, no) => {
    const s = net.createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

// ONE MODEL, LOADED WITH ONE llama-server AND ASKED A SUM -> { ok, why }
export async function modelAnswers(program, file, flags = [], { wait = 180000 } = {}) {
  const port = await freePort();
  const p = spawn(program, ['-m', file, '--host', '127.0.0.1', '--port', String(port), '-c', '2048', ...flags], {
    stdio: 'ignore',
  });
  let ended = false;
  p.once('exit', () => (ended = true));
  const base = 'http://127.0.0.1:' + port;
  try {
    const until = Date.now() + wait;
    let up = false;
    while (Date.now() < until && !ended && !up) {
      up = await fetch(base + '/health', { signal: AbortSignal.timeout(3000) }).then(
        (r) => r.ok,
        () => false,
      );
      if (!up) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!up) return { ok: false, why: ended ? 'the engine ended while loading it' : 'it did not load in time' };
    const r = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is 2 + 2? Answer with the number only.' }],
        temperature: 0,
        max_tokens: 64,
      }),
    });
    if (!r.ok) return { ok: false, why: 'it answered ' + r.status };
    const j = await r.json();
    const reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
    return answersTheSum(reply)
      ? { ok: true }
      : { ok: false, why: 'asked 2 + 2 it said ' + JSON.stringify(reply.slice(0, 60)) };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e).slice(0, 120) };
  } finally {
    p.kill('SIGTERM');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const id = process.argv[2];
  const dir = path.join(ROOT, '.work', 'engine');
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'update-' + id + '.json');
  const state = { id, pid: process.pid, phase: 'running', step: 'Starting', at: Date.now() };
  const say = (step, more = {}) => {
    Object.assign(state, { step, at: Date.now() }, more);
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state));
    fs.renameSync(stateFile + '.tmp', stateFile);
    console.log(step);
  };
  const end = (ok, step, more = {}) => {
    say(step, { phase: ok ? 'done' : 'failed', ...more });
    process.exit(ok ? 0 : 1);
  };
  const C = await import('../src/catalog.mjs');
  if (id === 'tensorfold') {
    const { programOf } = await import('./target.mjs');
    const serve = (C.TARGET || {}).serve || {};
    if (serve.program !== 'tensorfold' || !serve.upgrade)
      end(false, 'The larger model chosen is not served by an engine the catalog knows how to update');
    const prog = programOf(C.TARGET);
    const from = versionIn(saidBy(prog));
    say('Running its installer', { from });
    const r = spawnSync('sh', ['-c', serve.upgrade], { encoding: 'utf8', timeout: 1800000 });
    const tail = (String(r.stdout || '') + String(r.stderr || '')).trim().split('\n').slice(-1)[0] || '';
    console.log(String(r.stdout || '') + String(r.stderr || ''));
    const to = versionIn(saidBy(programOf(C.TARGET) || prog));
    if (r.status !== 0) end(false, 'Its installer ended with an error: ' + tail.slice(0, 160), { to });
    if (!to || to === from)
      end(
        false,
        'Its installer ended and the version here is still ' +
          (from || 'unknown') +
          (tail ? ': ' + tail.slice(0, 120) : ''),
        { to },
      );
    end(true, 'Updated from ' + from + ' to ' + to, { to });
  } else if (id === 'llama') {
    const B = await import('./support/bench.mjs');
    const { fetchFile } = await import('./setup.mjs');
    const b = C.engineBuild();
    if (!b) end(false, 'llama.cpp publishes no build for this machine');
    const was = B.llamaServer();
    const from = versionIn(saidBy(was));
    const to = versionIn(C.ENGINE.tag);
    const into = path.join(dir, C.ENGINE.tag);
    const find = (d, name) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        const f = e.isDirectory() ? find(p, name) : e.name === name ? p : '';
        if (f) return f;
      }
      return '';
    };
    let prog = fs.existsSync(into) ? find(into, 'llama-server') : '';
    if (!prog) {
      say('Fetching build ' + to.slice(1), { from, to });
      const pack = path.join(dir, b.asset);
      const got = await fetchFile({
        url: C.engineUrl(b),
        dest: pack,
        bytes: b.bytes,
        sha256: b.sha256,
        what: 'llama.cpp',
      });
      if (!got.ok) end(false, 'It could not be fetched: ' + String(got.why || '').slice(0, 160));
      fs.rmSync(into, { recursive: true, force: true });
      fs.mkdirSync(into, { recursive: true });
      const un = spawnSync('tar', ['-xf', pack, '-C', into]);
      prog = un.status === 0 ? find(into, 'llama-server') : '';
      fs.rmSync(pack, { force: true });
      if (!prog) end(false, 'It was fetched but would not unpack');
      fs.chmodSync(prog, 0o755);
    }
    // EVERY MODEL OF THE SWARM THAT llama.cpp SERVES MUST STILL ANSWER WITH IT
    const models = Object.values(C.MEMBERS).filter(Boolean);
    if (C.DECIDER && (C.DECIDER.serve || {}).kind === 'llama' && C.DECIDER.file) models.push(C.DECIDER);
    const checked = [];
    for (const m of models) {
      const file = path.join(B.modelsDir(), m.file || '');
      if (!m.file || !fs.existsSync(file)) {
        checked.push(m.name + ': not here, not checked');
        continue;
      }
      say('Checking that ' + m.name + ' still answers with build ' + to.slice(1), { from, to });
      const r = await modelAnswers(prog, file, Array.isArray(m.serve) ? m.serve : []);
      if (!r.ok)
        end(
          false,
          m.name + ' does not answer with build ' + to.slice(1) + ' (' + r.why + '): the build that was here is kept',
          { from, to },
        );
      checked.push(m.name + ': answers');
    }
    fs.writeFileSync(path.join(dir, 'chosen'), prog);
    end(true, 'Updated from build ' + from.slice(1) + ' to ' + to.slice(1) + ': ' + checked.join('; '), { from, to });
  } else end(false, 'No engine of that name');
}
