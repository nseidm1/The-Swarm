// adapters.mjs - WHEN REARRANGING IS NOT ENOUGH. The swarm's small models never change: training rearranges them and rewrites what
// they are told. A question that resists many tries, the larger model's own teaching among them, may be beyond what arranging
// frozen models can reach. The next lever is the larger model's answers taught to a small model's weights: a fine-tuned adapter,
// kept like any change (only if it brings a question to parity and loses none already there) and pinned in the spec like a model.
// What this file does, and what it does not yet:
//   exportDataset   the larger model's answers to this pass's TRAIN questions (never a held one), as chat pairs: what an adapter
//                   is trained on
//   mlxReady        whether a small model can be trained here with MLX (training/mlx-setup.sh installs it and fetches each
//                   model's original weights, pinned in ORIGINALS), and why not where it cannot
//   trainAdapter    trains one (training/support/mlx_adapter.py), turns it into a GGUF LoRA for the model file the swarm serves,
//                   and checks it in llama.cpp: the model's perplexity on the answers it was trained on, with and without it
//   probe           llama.cpp's own trainer (llama-finetune), a tiny run: measured 2026-11-17 with build 12110, it cannot train any
//                   of the three (SSM_CONV, SIGMOID have no backward pass), so MLX is the trainer
//   trying an adapter as a change (served with --lora, kept only if it brings a question to parity and loses none): not built
//   node training/adapters.mjs ready | train [<model file>] [--iters N] [--items math,logic] [--kinds lies,date] | judge
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// EACH SMALL MODEL'S ORIGINAL WEIGHTS, by the GGUF file the swarm serves (training/originals.json, which the page reads too):
// what MLX trains, fetched by training/mlx-setup.sh into .work/mlx/hf/<dir>. cannot: why that one is not trained here, measured
export const ORIGINALS = JSON.parse(fs.readFileSync(path.join(HERE, 'originals.json'), 'utf8')).models;

// the MLX install and its weights: { python, script, hf } under <work>/mlx
export const mlxPaths = (work) => ({
  python: path.join(work, 'mlx', 'venv', 'bin', 'python'),
  script: path.join(HERE, 'support', 'mlx_adapter.py'),
  hf: path.join(work, 'mlx', 'hf'),
});

// can this model be trained here with MLX? -> { model, file, ok, why, weights }
export function mlxReady(m, work) {
  const o = ORIGINALS[path.basename(m.file)];
  const p = mlxPaths(work);
  const no = (why) => ({ model: m.name, file: m.file, ok: false, why });
  // (a member another engine serves: an adapter here is a GGUF LoRA, which llama.cpp loads and that engine does not)
  if (m.engine && m.engine !== 'llama') return no('it is served by TensorFold, which loads no adapter');
  if (!o) return no('no original weights are named for it (training/originals.json)');
  if (o.cannot) return no(o.cannot);
  if (!fs.existsSync(p.python)) return no('MLX is not installed here: training/mlx-setup.sh');
  const weights = path.join(p.hf, o.dir);
  let files = [];
  try {
    files = fs.readdirSync(weights);
  } catch {
    /* not fetched */
  }
  if (!files.includes('config.json') || !files.some((f) => f.endsWith('.safetensors')))
    return no('its original weights are not here: training/mlx-setup.sh');
  return { model: m.name, file: m.file, ok: true, why: 'MLX can train it from ' + o.repo, weights };
}

// the last JSON line a command printed, or null
const lastJson = (s) => {
  const l = String(s || '')
    .split('\n')
    .reverse()
    .find((x) => x.trim().startsWith('{'));
  try {
    return l ? JSON.parse(l) : null;
  } catch {
    return null;
  }
};

// train one adapter, turn it into a GGUF LoRA for the served file, and check it there ->
// { ok, why?, gguf, examples, dropped, valLoss, seconds, perplexity: { without, with } }
// perplexity: llama.cpp's, on the answers it was trained on (llama-perplexity, -c 512): an adapter that loads and moves the model
// the way training did makes it lower; one whose tensors were wired wrongly makes it higher
export function trainAdapter(
  m,
  dataset,
  out,
  { work, iters = 100, maxTokens = 2048, perplexityBin = 'llama-perplexity', run = spawnSync } = {},
) {
  const r0 = mlxReady(m, work);
  if (!r0.ok) return { ok: false, why: r0.why };
  const p = mlxPaths(work);
  fs.mkdirSync(out, { recursive: true });
  const t = run(
    p.python,
    ['-I', p.script, 'train', r0.weights, dataset, out, '--iters', String(iters), '--max-tokens', String(maxTokens)],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  const trained = lastJson(t.stdout) || {
    ok: false,
    why:
      String(t.stderr || '')
        .trim()
        .split('\n')
        .pop() || 'it did not finish',
  };
  if (!trained.ok) return { ok: false, ...trained };
  const gguf = path.join(out, path.basename(m.file).replace(/\.gguf$/, '') + '-lora.gguf');
  const c = run(p.python, ['-I', p.script, 'gguf', path.join(out, 'adapter'), m.file, gguf], { encoding: 'utf8' });
  const conv = lastJson(c.stdout);
  if (!conv || !conv.ok)
    return {
      ...trained, // (first: its own ok, true, must not stand over this one)
      ok: false,
      why:
        String(c.stderr || c.stdout || '')
          .trim()
          .split('\n')
          .pop() || 'not converted',
    };
  // the text: each trained question's last ask and the larger model's answer
  const text = path.join(out, 'perplexity.txt');
  const rows = fs
    .readFileSync(path.join(out, 'data', 'train.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).messages);
  fs.writeFileSync(
    text,
    rows
      .map((ms) => String(ms[ms.length - 2]?.content || '').slice(0, 400) + '\n' + ms[ms.length - 1].content + '\n')
      .join('\n'),
  );
  const ppl = (extra) => {
    const r = run(perplexityBin, ['-m', m.file, '-f', text, '-c', '512', '--chunks', '40', ...extra], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    const hit = (String(r.stdout || '') + String(r.stderr || '')).match(/Final estimate: PPL = ([0-9.]+)/);
    return hit ? Number(hit[1]) : null;
  };
  const perplexity = { without: ppl([]), with: ppl(['--lora', gguf]) };
  const ok = perplexity.without !== null && perplexity.with !== null && perplexity.with < perplexity.without;
  return {
    ok,
    ...(ok
      ? {}
      : {
          why:
            perplexity.with === null
              ? 'llama.cpp did not load it'
              : 'with it, llama.cpp found the trained answers no likelier (' +
                perplexity.without +
                ' -> ' +
                perplexity.with +
                ')',
        }),
    gguf,
    examples: trained.examples,
    dropped: trained.dropped,
    valLoss: trained.valLoss,
    seconds: trained.seconds,
    perplexity,
  };
}

// a tool call's arguments as an object: the agent questions carry them as a JSON string (as the API sends them), and a model's
// chat template refuses that when the dataset is tokenized for training (LFM2.5's: "Tool call arguments must be a mapping").
// A string that is not JSON is left as it is
export function argsParsed(m) {
  if (!m || !Array.isArray(m.tool_calls)) return m;
  const tool_calls = m.tool_calls.map((c) => {
    const f = c && c.function;
    if (!f || typeof f.arguments !== 'string') return c;
    try {
      const a = JSON.parse(f.arguments || '{}');
      return a && typeof a === 'object' && !Array.isArray(a) ? { ...c, function: { ...f, arguments: a } } : c;
    } catch {
      return c;
    }
  });
  return { ...m, tool_calls };
}

// the dataset: { file, examples } written as one chat pair a line (the question as asked, the larger model's reply as the answer)
export function exportDataset(list, ref, file, messagesOf = (t) => [{ role: 'user', content: String(t.ask || '') }]) {
  const lines = [];
  for (const t of list) {
    if (t.split && t.split !== 'train') continue;
    const reply = ref.get ? ref.get(t.id) : ref[t.id];
    if (!reply || !String(reply).trim()) continue;
    lines.push(
      JSON.stringify({
        id: t.id,
        kind: t.kind,
        messages: [...messagesOf(t).map(argsParsed), { role: 'assistant', content: String(reply) }],
      }),
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''));
  return { file, examples: lines.length };
}

// what stopped a trainer, in one line: the op without a backward pass, or the last line that says what went wrong
export function reasonOf(log) {
  const s = String(log || '');
  const op = s.match(/unsupported (?:unary |ggml )?op for backward pass: (\w+)/);
  if (op) return 'llama-finetune cannot train it: ' + op[1] + ' has no backward pass';
  // llama.cpp's own line (src/...: what failed) before any line of the backtrace that follows it
  const own = s.split('\n').find((l) => /^\s*src\/\S+:\d+:/.test(l) || /GGML_ASSERT/.test(l));
  if (own) return own.trim().slice(0, 200);
  const err = s
    .split('\n')
    .reverse()
    .find((l) => /error|failed|assert/i.test(l) && !/libggml|backtrace/i.test(l));
  return err ? err.trim().slice(0, 200) : 'it did not finish';
}

// can each model be trained here? -> [{ model, file, ok, why }]. A tiny run of llama-finetune on a few lines; the result is kept
// in cacheFile by the model file's name and size, so a model is probed once
export function probe(
  models,
  { cacheFile, bin = 'llama-finetune', workDir, timeoutMs = 120000, run = spawnSync } = {},
) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    /* none yet */
  }
  const out = [];
  for (const m of models) {
    let size = 0;
    try {
      size = fs.statSync(m.file).size;
    } catch {
      out.push({ model: m.name, file: m.file, ok: false, why: 'its file is not on this machine' });
      continue;
    }
    const key = path.basename(m.file) + ':' + size;
    if (cache[key]) {
      out.push({ model: m.name, file: m.file, ...cache[key] });
      continue;
    }
    fs.mkdirSync(workDir, { recursive: true });
    const tiny = path.join(workDir, 'probe.txt');
    // (long enough to fill a few contexts of 256: shorter, and llama-finetune stops before training with ndata > 0 failed)
    fs.writeFileSync(
      tiny,
      'Question: Write a function double(x) that returns twice x.\nAnswer: function double(x) { return x * 2; }\n\n'.repeat(
        60,
      ),
    );
    // (its output to a file: through a pipe, the line that says why it stopped is lost when it aborts)
    const log = path.join(workDir, 'probe.log');
    const q = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
    const args = [
      '-m',
      m.file,
      '-f',
      tiny,
      '-c',
      '256',
      '-b',
      '256',
      '-ub',
      '256',
      '-epochs',
      '1',
      '-o',
      path.join(workDir, 'probe-out.gguf'),
    ];
    const r = run('sh', ['-c', [bin, ...args].map(q).join(' ') + ' > ' + q(log) + ' 2>&1'], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    let said = '';
    try {
      said = fs.readFileSync(log, 'utf8');
    } catch {
      /* nothing written */
    }
    try {
      fs.rmSync(path.join(workDir, 'probe-out.gguf'), { force: true });
    } catch {
      /* nothing written */
    }
    const res =
      r.status === 0
        ? { ok: true, why: 'a short run finished' }
        : { ok: false, why: r.error ? String(r.error.message) : reasonOf(said) };
    cache[key] = { ...res, at: new Date().toISOString() };
    out.push({ model: m.name, file: m.file, ...res });
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return out;
}

// WHERE A MODEL'S ADAPTER IS KEPT: by the larger model whose answers it learned and the model it adapts, so that swapping another
// small model does not lose it. Its result.json says how it was trained, on which bodies of work, and whether llama.cpp found it good
export const adapterDir = (work, targetId, m) =>
  path.join(
    work,
    'library',
    'adapters',
    targetId,
    (ORIGINALS[path.basename(m.file)] || {}).dir || path.basename(m.file),
  );
export function adapterOf(work, targetId, m) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(adapterDir(work, targetId, m), 'result.json'), 'utf8'));
    return r.ok && r.gguf && fs.existsSync(r.gguf) ? r : { ...r, ok: false };
  } catch {
    return null;
  }
}
// AN ADAPTER FOR EACH ROLE (training/roles.mjs writes roles.json beside result.json: { roles: { draft: { ok, gguf, examples },
// check: {...}, write: {...} } }). Where the configuration serves adapters and a member has them, it is served with one for each
// role on one load, chosen per request (src/index.mjs roleLoras), in place of its one adapter. -> { memberKey: { role: gguf } }
export function roleLorasFor(config, members, work, targetId, modelsDir) {
  if (!config || !config.adapters) return {};
  const out = {};
  for (const [key, m] of Object.entries(members)) {
    if (m.engine && m.engine !== 'llama') continue;
    let j = null;
    try {
      j = JSON.parse(
        fs.readFileSync(
          path.join(adapterDir(work, targetId, { name: m.name, file: path.join(modelsDir, m.file) }), 'roles.json'),
          'utf8',
        ),
      );
    } catch {
      continue;
    }
    const roles = Object.fromEntries(
      Object.entries((j && j.roles) || {})
        .filter(([, r]) => r && r.ok && r.gguf && fs.existsSync(r.gguf))
        .map(([k, r]) => [k, r.gguf]),
    );
    if (Object.keys(roles).length) out[key] = roles;
  }
  return out;
}
// WHAT A SWARM IS SERVED WITH, for a measurement to say and to keep its answers by: the members that have adapters, and the
// files (each role's where it has them, else its one). -> { names: [member names], files: [paths, sorted], roles: [role names] }
export function servedWith(config, members, work, targetId, modelsDir) {
  const one = lorasFor(config, members, work, targetId, modelsDir);
  const by = roleLorasFor(config, members, work, targetId, modelsDir);
  const keys = [...new Set([...Object.keys(one), ...Object.keys(by)])].sort();
  const files = [...new Set(keys.flatMap((k) => (by[k] ? Object.values(by[k]) : [one[k]])))].sort();
  const roles = [...new Set(keys.flatMap((k) => Object.keys(by[k] || {})))].sort();
  return { names: keys.map((k) => members[k].name), files, roles };
}
// THE ADAPTERS THE SWARM IS SERVED WITH: where the configuration says so ("adapters": true), each member that has one that
// llama.cpp found good -> { memberKey: its GGUF LoRA } (src/index.mjs createSwarm serves that member with --lora)
export function lorasFor(config, members, work, targetId, modelsDir) {
  if (!config || !config.adapters) return {};
  const out = {};
  for (const [key, m] of Object.entries(members)) {
    if (m.engine && m.engine !== 'llama') continue; // (served by an engine that loads no adapter)
    const r = adapterOf(work, targetId, { name: m.name, file: path.join(modelsDir, m.file) });
    if (r && r.ok) out[key] = r.gguf;
  }
  return out;
}

// THE TRAIN QUESTIONS AN ADAPTER LEARNS FROM, where some bodies of work are named (--items): those whose kind is one of theirs.
// None named: every one. -> { list } or { why } where a name is no body of work or the named ones have no train question
export function aimedAt(list, items, targets, kinds = '') {
  // (--kinds a,b: the questions of those kinds, named outright: what the class stage found no slot had the answer to)
  const named = String(kinds || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (named.length) {
    const kept = list.filter((t) => named.includes(t.kind));
    return kept.length ? { list: kept } : { why: 'no train question of the kinds ' + named.join(', ') };
  }
  const ids = String(items || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ids.length) return { list };
  const unknown = ids.filter((i) => !targets.some((t) => t.id === i));
  if (unknown.length) return { why: 'not a body of work: ' + unknown.join(', ') };
  const theirs = new Set(targets.filter((t) => ids.includes(t.id)).flatMap((t) => t.kinds));
  const kept = list.filter((t) => theirs.has(t.kind));
  return kept.length
    ? { list: kept }
    : { why: 'no train question of ' + ids.join(', ') + ': Train once first, whose first step asks them' };
}

// WHERE AN ADAPTER HAS SOMETHING TO TEACH, from what the class stage measured (training/classes.mjs, classes.json): the kinds of
// question on a quarter or more of which NO slot's draft had a good answer. Rearranging cannot mend those: nothing the swarm
// drafts is right, whichever way it is settled or written out. Where some slot nearly always has the answer the loss is in
// choosing or in writing out, and an adapter is the wrong tool (measured 2026-11-19: on the conversations a standard test
// arrives as, some slot had the answer on 24 of 24 and none was read; Pretrain had been aimed there by a benchmark's verdict).
//   aimOf(record) -> [kinds], the furthest short first ([] where no class was measured, or none is short)
export function aimOf(record) {
  const by = {};
  for (const c of Object.values((record || {}).classes || {}))
    for (const [k, v] of Object.entries(((c || {}).asItStands || {}).kinds || {})) {
      by[k] = by[k] || { n: 0, anySlot: 0 };
      by[k].n += v.n;
      by[k].anySlot += v.anySlot;
    }
  return Object.entries(by)
    .filter(([, v]) => v.n >= 2 && (v.n - v.anySlot) * 4 >= v.n)
    .sort((a, b) => a[1].anySlot / a[1].n - b[1].anySlot / b[1].n)
    .map(([k]) => k);
}
// ONLY ANSWERS THAT ARE RIGHT ARE TAUGHT: of the questions that carry a standard of their own, those whose answer from the larger
// model is good by it. An adapter trained on every answer learns the larger model's mistakes with the rest (measured 2026-11-19:
// by the questions' own standard its answers were right on 82 of 114). A question with no standard of its own is taught as it was.
//   rightOnly(list, ref) -> { list, dropped }
export async function rightOnly(list, ref) {
  const out = [];
  let dropped = 0;
  for (const t of list) {
    const reply = ref.get ? ref.get(t.id) : ref[t.id];
    // (a standard a program holds; one that needs a reader of answers in words is left as it is)
    if (typeof t.good !== 'function' || ['open', 'talk'].includes(t.type) || !reply) out.push(t);
    else if ((await t.good(String(reply))).grade === 'right') out.push(t);
    else dropped++;
  }
  return { list: out, dropped };
}

// ready: whether each small model can be trained here. train [<model file>] [--iters N]: the larger model's answers to this
// pass's train questions (of every body of work the pass asks; never a benchmark's, never a held one) exported, and an adapter
// trained, converted and checked for each model that can be (or the one named). While it runs it writes .work/pretrain/live.json
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2];
  const B = await import('./support/bench.mjs');
  const { MEMBERS, TARGET } = await import('../src/catalog.mjs');
  const work = path.join(B.REPO_ROOT, '.work');
  const models = Object.values(MEMBERS).map((m) => ({ name: m.name, file: path.join(B.modelsDir(), m.file) }));
  if (cmd === 'ready') {
    for (const r of models.map((m) => mlxReady(m, work)))
      console.log((r.ok ? 'yes  ' : 'no   ') + r.model + ': ' + r.why);
    process.exit(0);
  }
  // JUDGED AS ANY CHANGE IS JUDGED: the held questions that carry a standard of their own (some of each kind, the same ones both
  // times), asked of the swarm served without its adapters and then with them. The adapters are served from then on only where
  // the swarm is better with them by more than twice the paired error and by at least the trainer's least gain; otherwise they
  // stay on disk and are not served. Whether to serve them was a box a person ticked. Written to <adapters>/judged.json.
  const judge = async () => {
    const { readBriefs } = await import('../src/index.mjs');
    const { messagesOf, ownStandard } = await import('./tasks.mjs');
    const { sampleOf, pairedGain, worthKeeping } = await import('./classes.mjs');
    const { CONFIG_FILE } = await import('../src/catalog.mjs');
    const least = Number(
      (JSON.parse(fs.readFileSync(path.join(HERE, 'policy.json'), 'utf8')).loop || {}).classMinGain || 0,
    );
    const dir = path.join(work, 'library', 'adapters', TARGET.id);
    const have = models.map((m) => adapterOf(work, TARGET.id, m)).filter((r) => r && r.ok).length;
    // (its last word says the run is done: a run left at 'judging' with no process is read by the page as one that ended before
    // it finished, 2026-11-20, and the page then showed the last line of an older run's log as the reason)
    const say = (step, phase = 'judging') => {
      try {
        fs.mkdirSync(path.join(work, 'pretrain'), { recursive: true });
        const f = path.join(work, 'pretrain', 'live.json');
        const was = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
        fs.writeFileSync(f, JSON.stringify({ ...was, pid: process.pid, phase, step, at: Date.now() }));
      } catch {
        /* the page goes without */
      }
    };
    if (!have) {
      console.log('no adapter to judge');
      say('No adapter to judge', 'done');
      return null;
    }
    const held = sampleOf(
      B.questions('held').filter((t) => ownStandard(t) && !['open', 'talk'].includes(t.type)),
      Number(B.arg('sample', 48)),
    );
    const ask = async (adapters) => {
      const swarm = await B.openSwarm(readBriefs(), { seed: 1, adapters, lorasWith: lorasFor });
      const rows = [];
      try {
        for (const [i, t] of held.entries()) {
          say(
            'Judging the adapters on held questions: ' +
              (adapters ? 'with them' : 'without them') +
              ', question ' +
              (i + 1) +
              ' of ' +
              held.length,
          );
          const got = await B.askSwarm(swarm, t, messagesOf(t));
          rows.push({ id: t.id, kind: t.kind, counted: (await t.good(got.reply)).grade === 'right' });
        }
      } finally {
        await swarm.stop();
      }
      return rows;
    };
    const without = await ask(false);
    const withThem = await ask(true);
    const g = pairedGain(withThem, without);
    const served = worthKeeping(g, least);
    const count = (rows) => rows.filter((x) => x.counted).length;
    const kinds = {};
    for (const [i, r] of without.entries()) {
      const k = (kinds[r.kind] = kinds[r.kind] || { n: 0, without: 0, with: 0 });
      k.n++;
      k.without += r.counted ? 1 : 0;
      k.with += withThem[i].counted ? 1 : 0;
    }
    const verdict = {
      at: new Date().toISOString(),
      questions: held.length,
      adapters: have,
      without: count(without),
      with: count(withThem),
      gain: g.gain,
      error: g.error,
      served,
      kinds,
      dry: B.has('dry'),
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'judged.json'), JSON.stringify(verdict, null, 2));
    if (!B.has('dry')) {
      // (the configuration says whether they are served: written here as the page writes it)
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (served) c.adapters = true;
      else delete c.adapters;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + '\n');
    }
    console.log(
      'judged on ' +
        held.length +
        ' held questions: ' +
        verdict.without +
        ' right without the adapters, ' +
        verdict.with +
        ' with them (' +
        (g.gain * 100).toFixed(1) +
        ' points, paired error ' +
        (g.error * 100).toFixed(1) +
        '): ' +
        (served ? 'served' : 'not served'),
    );
    say(
      'Judged: ' +
        (served
          ? 'the swarm is served with its adapters'
          : 'the adapters are not served: not better on the held questions'),
      'done',
    );
    return verdict;
  };
  if (cmd === 'judge') {
    await judge();
    process.exit(0);
  }
  if (cmd !== 'train') {
    console.log(
      'node training/adapters.mjs ready | train [<model file>] [--iters N] [--items math,logic] [--kinds lies,date] [--no-judge] | judge [--sample N] [--dry]',
    );
    process.exit(2);
  }
  const named = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
  const iters = Number(B.arg('iters', 100));
  // THE ANSWERS IT LEARNS FROM: the larger model's, to this pass's train questions. items: the bodies of work those questions
  // cover, read from the questions themselves (tasks.mjs bodiesOf), so an adapter's record says what it learned and not a setting
  // --items math,logic: ONLY THE TRAIN QUESTIONS OF THOSE BODIES OF WORK (aimedAt), for an adapter aimed at where an evaluation
  // found the swarm short of the larger model. A name that is no body of work, or bodies with no train question, stops it here
  const { messagesOf, bodiesOf, EQUIVALENCE } = await import('./tasks.mjs');
  const aim = aimedAt(B.questions('train'), B.arg('items'), EQUIVALENCE.targets, B.arg('kinds'));
  if (aim.why) {
    console.log(aim.why);
    process.exit(2);
  }
  const list = aim.list;
  const items = bodiesOf([...new Set(list.map((t) => t.kind))]);
  const pick = models.filter((x) => !named || path.basename(x.file) === named || x.name === named);
  const liveFile = path.join(work, 'pretrain', 'live.json');
  const live = {
    pid: process.pid,
    startedAt: Date.now(),
    phase: 'starting',
    step: 'Getting ready',
    iters,
    items,
    target: TARGET.name,
    models: pick.map((m) => ({ name: m.name, file: path.basename(m.file), state: 'waiting' })),
  };
  const write = () => {
    live.at = Date.now();
    fs.mkdirSync(path.dirname(liveFile), { recursive: true });
    fs.writeFileSync(liveFile + '.tmp', JSON.stringify(live));
    fs.renameSync(liveFile + '.tmp', liveFile);
  };
  write();
  process.on('SIGTERM', () => {
    for (const x of live.models) if (!['done', 'failed', 'not trained'].includes(x.state)) x.state = 'stopped';
    live.phase = 'stopped';
    live.step = 'Stopped from the page';
    write();
    process.exit(143);
  });
  const fail = (step) => {
    live.phase = 'failed';
    live.step = step;
    write();
    console.log(step);
    process.exit(1);
  };
  // FIRST, WHAT IT NEEDS, FETCHED AS IT GOES (a fresh clone has none of it): the answers it learns from; the engine and the small
  // models' files (setup.mjs --small: an adapter is checked against the file the swarm serves); MLX, once; and each model's
  // original weights, for the models being adapted only
  const ref = B.reference(list);
  if (ref.size < list.length)
    fail(
      TARGET.name +
        ' has answered ' +
        ref.size +
        ' of the ' +
        list.length +
        ' train questions, and an adapter learns its answers: Train once, whose first step asks it, then Pretrain.',
    );
  const sh = (cmd, args, env = {}) => {
    const r = spawnSync(cmd, args, {
      cwd: B.REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    const said = String(r.stdout || '') + String(r.stderr || '');
    return {
      ok: r.status === 0,
      last: said.trim().split('\n').filter(Boolean).pop() || 'it stopped (' + r.status + ')',
    };
  };
  live.phase = 'preparing';
  live.step = "Making the swarm's small models and the engine ready";
  write();
  const ready = sh(process.execPath, ['training/setup.mjs', '--small']);
  if (!ready.ok) fail('The small models could not be made ready: ' + ready.last);
  if (!fs.existsSync(mlxPaths(work).python) || !sh(mlxPaths(work).python, ['-I', '-c', 'import mlx_lm, gguf']).ok) {
    live.step = 'Installing MLX, the trainer, into .work/mlx (once)';
    write();
    const got = sh('sh', ['training/mlx-setup.sh', '--no-fetch']);
    if (!got.ok) fail('MLX could not be installed: ' + got.last);
  }
  for (const m of pick) {
    const o = ORIGINALS[path.basename(m.file)];
    if (!o || o.cannot || mlxReady(m, work).ok) continue;
    const row = live.models.find((x) => x.name === m.name);
    Object.assign(row, { state: 'fetching', dir: path.join(mlxPaths(work).hf, o.dir) });
    live.step = 'Fetching ' + m.name + "'s original weights from " + o.repo;
    write();
    const got = sh(
      path.join(path.dirname(mlxPaths(work).python), 'hf'),
      ['download', o.repo, ...(o.include || []), '--revision', o.revision, '--local-dir', row.dir],
      { HF_HOME: path.join(work, 'mlx', 'hf-home'), HF_HUB_DISABLE_TELEMETRY: '1' },
    );
    row.state = 'waiting';
    if (!got.ok)
      Object.assign(row, { state: 'not trained', why: 'its original weights did not download: ' + got.last });
    write();
  }
  live.step = "Exporting the larger model's answers";
  write();
  const dsFile = path.join(work, 'library', 'adapters', TARGET.id, 'train.jsonl');
  // (only answers that are right by the question's own standard are taught: rightOnly)
  const taught = await rightOnly(list, ref);
  if (taught.dropped)
    console.log(
      'not taught: ' + taught.dropped + " answers of the larger model that are wrong by the question's own standard",
    );
  const ds = exportDataset(taught.list, ref, dsFile, messagesOf);
  live.examples = ds.examples;
  console.log(ds.examples + ' train answers in ' + path.relative(B.REPO_ROOT, ds.file));
  // (llama-perplexity sits beside the llama-server the swarm uses, where that is a path)
  const server = B.llamaServer();
  const beside = server && path.isAbsolute(server) ? path.join(path.dirname(server), 'llama-perplexity') : '';
  const perplexityBin = beside && fs.existsSync(beside) ? beside : 'llama-perplexity';
  let failed = 0;
  live.phase = 'training';
  for (const m of pick) {
    const row = live.models.find((x) => x.name === m.name);
    const r0 = mlxReady(m, work);
    if (row.state === 'not trained') continue;
    if (!r0.ok) {
      Object.assign(row, { state: 'not trained', why: r0.why });
      write();
      console.log('  ' + m.name + ': not trained, ' + r0.why);
      continue;
    }
    const out = adapterDir(work, TARGET.id, m);
    // THE ADAPTER IT HAS IS KEPT UNTIL A BETTER ONE IS READY: the new one is trained beside it (<dir>.next) and takes its place only
    // once llama.cpp has found it good. Stopped, failed or not kept, the old adapter and its record stand as they were, and the
    // attempt is written beside them (failed.json)
    const next = out + '.next';
    fs.rmSync(next, { recursive: true, force: true });
    Object.assign(row, { state: 'training', log: path.join(next, 'train.log'), started: Date.now() });
    live.step = 'Training ' + m.name + ' on ' + ds.examples + ' answers';
    write();
    console.log('  ' + m.name + ': training...');
    const r = trainAdapter(m, ds.file, next, { work, iters, perplexityBin });
    const result = {
      model: m.name,
      at: new Date().toISOString(),
      target: TARGET.name,
      items,
      iters,
      notTaught: taught.dropped,
      ...r,
    };
    if (r.ok) {
      const old = out + '.old';
      fs.rmSync(old, { recursive: true, force: true });
      if (fs.existsSync(out)) fs.renameSync(out, old);
      fs.renameSync(next, out);
      fs.rmSync(old, { recursive: true, force: true });
      result.gguf = path.join(out, path.basename(r.gguf));
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    } else {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'failed.json'), JSON.stringify(result, null, 2));
      fs.rmSync(next, { recursive: true, force: true });
    }
    Object.assign(row, { state: r.ok ? 'done' : 'failed', result, seconds: (Date.now() - row.started) / 1000 });
    write();
    if (!r.ok) failed++;
    console.log(
      '  ' +
        m.name +
        ': ' +
        (r.ok
          ? path.relative(B.REPO_ROOT, r.gguf) +
            ', ' +
            r.examples +
            ' examples (' +
            r.dropped +
            ' too long), loss ' +
            r.valLoss.join(' -> ') +
            ', llama.cpp perplexity ' +
            r.perplexity.without +
            ' -> ' +
            r.perplexity.with +
            ', ' +
            r.seconds +
            ' s'
          : 'failed, ' + r.why),
    );
  }
  live.phase = 'done';
  const good = live.models.filter((x) => x.state === 'done').length;
  live.step = 'Done: ' + good + ' of ' + live.models.length + ' models adapted';
  write();
  // AND THEN THEY ARE JUDGED, where any was made: whether the swarm is served with them is decided by the held questions
  if (good && !B.has('no-judge')) {
    try {
      await judge();
    } catch (e) {
      const why = 'the adapters could not be judged: ' + String((e && e.message) || e).slice(0, 200);
      console.log(why);
      // (the judge's own reports are in the file by now: its last word is put there, so the run is not left at 'judging')
      try {
        const f = path.join(work, 'pretrain', 'live.json');
        fs.writeFileSync(
          f,
          JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), phase: 'done', step: 'Done; ' + why }),
        );
      } catch {
        /* the page goes without */
      }
    }
  }
  process.exit(failed ? 1 : 0);
}
