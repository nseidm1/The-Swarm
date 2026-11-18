// setup.mjs - EVERYTHING THE CONFIGURED SWARM NEEDS, FETCHED AND MADE READY, so that a person chooses models and presses one
// button. For the swarm as src/config.json has it:
//   the engine      llama.cpp's server: the one on this machine if there is one, else its pinned build, fetched and unpacked
//   place a, b      the two small models' files
//   the decider     the configured decision model, by its recipe (training/decider.sh): its program and weights
//   the target      the larger model's file where it is one; where it needs an engine of its own, that the engine is here
// Every file comes from its pinned revision and is kept only if its size and SHA-256 are the ones in src/models.json.
// IT RECOVERS BY ITSELF where it can: a download that stopped carries on from where it stopped; a file that arrives wrong is
// thrown away and fetched once more; a part left by an earlier run that is the wrong size is started again; an engine that will
// not unpack is fetched again. Where it cannot go on (no room on the disk, no network, a target this machine cannot serve), it
// stops and says what to do, in a sentence, and what is already here is kept.
//   node training/setup.mjs            make ready       node training/setup.mjs --check     say what is missing, fetch nothing
//   node training/setup.mjs --small    the engine and the small models only (Pretrain needs no more)
//   node training/setup.mjs --model qwen35-4b,gemma4-e2b   those small models of the catalog only (src/models.json), whatever
//        the swarm is made of: to measure one alone (training/baseline.mjs --who model:<id>) before choosing it
// What it is doing is written to .work/train/setup.json as it goes, for the page.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { has, llamaServer, modelsDir, REPO_ROOT, WORK } from './support/bench.mjs';
import { MEMBERS, DECIDER, TARGET, ENGINE, REGISTRY, fileUrl, engineBuild, engineUrl } from '../src/catalog.mjs';
import { modelFile, filesOf } from '../src/members.mjs';
import { programOf } from './target.mjs';

const gb = (n) => (n / 2 ** 30).toFixed(n > 2 ** 30 ? 1 : 2) + ' GB';
const STATUS = path.join(WORK, 'setup.json');
const steps = [];
const say = (what, state, more = {}) => {
  const at = steps.findIndex((s) => s.what === what);
  const row = { what, state, ...more };
  if (at < 0) steps.push(row);
  else steps[at] = row;
  try {
    fs.mkdirSync(WORK, { recursive: true });
    fs.writeFileSync(STATUS + '.tmp', JSON.stringify({ at: Date.now(), steps }));
    fs.renameSync(STATUS + '.tmp', STATUS);
  } catch {
    /* the page goes without */
  }
};
const sha = (file) =>
  new Promise((ok, no) => {
    const h = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => ok(h.digest('hex')))
      .on('error', no);
  });
const freeBytes = (dir) => {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
};

// one file, to dest: resumed from a part where there is one, checked, and fetched once more if it arrives wrong
export async function fetchFile({ url, dest, bytes, sha256, what, fetchImpl = fetch }) {
  if (fs.existsSync(dest) && fs.statSync(dest).size === bytes) return { ok: true, already: true };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (have > bytes) {
      fs.rmSync(part, { force: true }); // a part longer than the whole is not this file
      have = 0;
    }
    const need = bytes - have;
    if (need > 0 && freeBytes(path.dirname(dest)) < need + 2 ** 30)
      return {
        ok: false,
        why:
          'there is not room on this disk for ' +
          what +
          ': it needs ' +
          gb(need) +
          ' more, and ' +
          gb(freeBytes(path.dirname(dest))) +
          ' is free',
      };
    try {
      if (need > 0) {
        const r = await fetchImpl(url, {
          headers: { 'user-agent': 'the-swarm', ...(have ? { range: 'bytes=' + have + '-' } : {}) },
        });
        if (have && r.status === 200) {
          fs.rmSync(part, { force: true }); // the server would not carry on from the middle: from the start, then
          have = 0;
        } else if (!r.ok && r.status !== 206) throw new Error('the server answered ' + r.status);
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        let got = have;
        let told = 0;
        for await (const chunk of r.body) {
          if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
          got += chunk.length;
          if (Date.now() - told > 1000) {
            told = Date.now();
            say(what, 'fetching', { done: got, of: bytes });
          }
        }
        await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
      }
      const size = fs.statSync(part).size;
      if (size !== bytes) throw new Error('it stopped at ' + gb(size) + ' of ' + gb(bytes));
      say(what, 'checking', { done: bytes, of: bytes });
      if ((await sha(part)) !== sha256) {
        fs.rmSync(part, { force: true });
        throw new Error('it did not match its SHA-256, and was thrown away');
      }
      fs.renameSync(part, dest);
      return { ok: true };
    } catch (e) {
      const why = String((e && e.message) || e).slice(0, 160);
      if (attempt === 3)
        return {
          ok: false,
          why: what + ' could not be fetched: ' + why + '. What arrived is kept, and the next run carries on from it.',
        };
      say(what, 'fetching', {
        note: 'trying again (' + why + ')',
        done: fs.existsSync(part) ? fs.statSync(part).size : 0,
        of: bytes,
      });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { ok: false, why: what + ' could not be fetched' };
}

async function engine(check) {
  const what = 'The engine (llama.cpp)';
  if (llamaServer()) return (say(what, 'ready', { note: llamaServer() }), true);
  const b = engineBuild();
  if (!b)
    return (
      say(what, 'failed', {
        why:
          'llama.cpp publishes no build for this machine (' +
          process.platform +
          ' ' +
          process.arch +
          '). Install llama-server and put it on the PATH.',
      }),
      false
    );
  if (check) return (say(what, 'missing', { of: b.bytes }), false);
  const dir = path.join(REPO_ROOT, '.work', 'engine', ENGINE.tag);
  const pack = path.join(REPO_ROOT, '.work', 'engine', b.asset);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = await fetchFile({ url: engineUrl(b), dest: pack, bytes: b.bytes, sha256: b.sha256, what });
    if (!got.ok) return (say(what, 'failed', { why: got.why }), false);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const un = spawnSync('tar', ['-xf', pack, '-C', dir]);
    const found = un.status === 0 ? find(dir, 'llama-server') : '';
    if (found) {
      fs.chmodSync(found, 0o755);
      fs.writeFileSync(path.join(REPO_ROOT, '.work', 'engine', 'path'), found);
      fs.rmSync(pack, { force: true });
      return (say(what, 'ready', { note: ENGINE.version + ' (' + ENGINE.tag + ')' }), true);
    }
    fs.rmSync(pack, { force: true }); // it would not unpack: fetched again, once
  }
  return (
    say(what, 'failed', {
      why: 'llama.cpp was fetched but would not unpack. Install llama-server and put it on the PATH.',
    }),
    false
  );
}
function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = find(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return '';
}
async function model(m, what, check) {
  const dir = modelsDir();
  if (modelFile(m, dir)) return (say(what, 'ready'), true);
  const files = filesOf(m);
  if (check) return (say(what, 'missing', { of: files.reduce((n, f) => n + f.bytes, 0) }), false);
  // a model in parts: each part in turn, beside the first (llama.cpp finds them there)
  let got = { ok: true };
  for (const [i, f] of files.entries()) {
    got = await fetchFile({
      url: fileUrl({ ...m, file: f.file }),
      dest: path.join(dir, f.file),
      bytes: f.bytes,
      sha256: f.sha256,
      what: files.length > 1 ? what + ', part ' + (i + 1) + ' of ' + files.length : what,
    });
    if (!got.ok) break;
  }
  return (say(what, got.ok ? 'ready' : 'failed', got.ok ? {} : { why: got.why }), got.ok);
}
function decider(check) {
  const what = 'The decider (' + DECIDER.name + ')';
  const named = process.env.SWARM_DECIDER || process.env.SWARM_KEV;
  if (named) return (say(what, 'ready', { note: 'running at ' + named }), true);
  const kind = (DECIDER.serve || { kind: 'kev' }).kind;
  const script = path.join(REPO_ROOT, 'training', 'decider.sh');
  // (installed is the decider script's own test: training/decider.sh ready, by the decider's recipe)
  const ready = () => spawnSync('bash', [script, 'ready'], { encoding: 'utf8' }).status === 0;
  const later = kind === 'kev' ? 'its weights come the first time it is served' : '';
  if (ready()) return (say(what, 'ready', later ? { note: later } : {}), true);
  // one the swarm does not start (it needs an NVIDIA GPU): it is named with SWARM_DECIDER, where it runs
  if (kind !== 'kev' && kind !== 'startlux-mlx' && kind !== 'llama')
    return (
      say(what, 'failed', {
        why:
          'it is not started by the swarm: it needs ' +
          DECIDER.needs +
          '. Start it where it can run (its entry in src/models.json says how) and name it: SWARM_DECIDER=http://<host>:<port>.',
      }),
      false
    );
  if (check) return (say(what, 'missing'), false);
  say(what, 'installing', {
    note:
      kind === 'startlux-mlx'
        ? 'its server and a Python of its own, and its weights (' +
          Math.round(((DECIDER.serve.bytes || 0) / 2 ** 30) * 10) / 10 +
          ' GB)'
        : kind === 'llama'
          ? 'its weights, one file served by llama.cpp (' +
            Math.round(((DECIDER.serve.bytes || 0) / 2 ** 30) * 10) / 10 +
            ' GB)'
          : 'its program and a Python of its own (a few minutes)',
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync('bash', [script, 'install'], { encoding: 'utf8' });
    if (r.status === 0 && ready()) return (say(what, 'ready', later ? { note: later } : {}), true);
    if (attempt === 2)
      return (
        say(what, 'failed', {
          why:
            DECIDER.name +
            ' could not be installed: ' +
            String(r.stderr || r.stdout)
              .trim()
              .split('\n')
              .slice(-1)[0]
              .slice(0, 160) +
            (kind === 'llama'
              ? '. It needs curl and room for its file'
              : '. It needs git and python3' + (kind === 'startlux-mlx' ? ', and an Apple silicon Mac' : '')) +
            '. Without it nothing decides.',
        }),
        false
      );
    // a half-made environment: made again (the weights are kept: they are only marked complete once whole)
    // (a llama.cpp one has no environment: its file carries on from where it stopped)
    if (kind === 'kev')
      fs.rmSync(path.join(REPO_ROOT, '.work', 'kev', 'src', '.venv'), { recursive: true, force: true });
    else if (kind === 'startlux-mlx')
      fs.rmSync(path.join(REPO_ROOT, '.work', 'deciders', 'startlux', 'venv'), { recursive: true, force: true });
  }
  return false;
}
async function target(check) {
  const what = 'The larger model (' + TARGET.name + ')';
  if (process.env.SWARM_TARGET_BASE)
    return (say(what, 'ready', { note: 'running at ' + process.env.SWARM_TARGET_BASE }), true);
  if (TARGET.engine === 'llama') return model(TARGET, what, check);
  if (programOf(TARGET))
    return (
      say(what, 'ready', { note: 'served by ' + TARGET.serve.program + ', which fetches it the first time' }),
      true
    );
  return (
    say(what, 'failed', {
      why:
        TARGET.name +
        ' needs ' +
        (TARGET.needs || TARGET.serve.program) +
        ', which is not here. Choose a larger model that llama.cpp serves.',
    }),
    false
  );
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const check = has('check');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    say('Node', 'failed', { why: 'this is Node ' + process.versions.node + '; the trainers need 20 or later' });
    console.log('This is Node ' + process.versions.node + '. The trainers need Node 20 or later.');
    process.exit(1);
  }
  const ok = [];
  ok.push(await engine(check));
  // (--model <id>[,<id>]: those small models of the catalog only, and nothing else)
  const named = String(process.argv[process.argv.indexOf('--model') + 1] || '');
  if (has('model')) {
    for (const id of named.split(',').filter(Boolean)) {
      const m = REGISTRY.small.find((x) => x.id === id);
      if (!m) {
        say('Small model ' + id, 'failed', { why: 'no small model in src/models.json has that id' });
        ok.push(false);
        continue;
      }
      ok.push(await model(m, 'Small model (' + m.name + ')', check));
    }
    for (const s of steps)
      console.log(
        (s.state === 'ready' ? 'ready    ' : s.state === 'missing' ? 'missing  ' : 'FAILED   ') +
          s.what +
          (s.why ? ': ' + s.why : s.note ? ' (' + s.note + ')' : s.of ? ' (' + gb(s.of) + ')' : ''),
      );
    process.exit(ok.every(Boolean) ? 0 : 1);
  }
  // every small model the swarm is made of (the same model in two places is one file)
  const fetched = new Set();
  for (const [i, m] of Object.values(MEMBERS).entries()) {
    if (fetched.has(m.id)) continue;
    fetched.add(m.id);
    ok.push(await model(m, 'Small model ' + (i + 1) + ' (' + m.name + ')', check));
  }
  // (--small: the engine and the small models only, all that Pretrain needs: training/adapters.mjs train)
  if (!has('small')) {
    ok.push(decider(check));
    ok.push(await target(check));
  }
  for (const s of steps)
    console.log(
      (s.state === 'ready' ? 'ready    ' : s.state === 'missing' ? 'missing  ' : 'FAILED   ') +
        s.what +
        (s.why ? ': ' + s.why : s.note ? ' (' + s.note + ')' : s.of ? ' (' + gb(s.of) + ')' : ''),
    );
  process.exit(ok.every(Boolean) ? 0 : 1);
}
