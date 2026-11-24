// prove.mjs - ONE QUESTION AT A TIME: does an adapter make the module answer THIS question, and does it go on doing so? A figure
// over a set of questions says an adapter gained two of seventy-two and cannot say whether that is the adapter or chance. One
// question can: it is asked of the module without the adapter and with it, on several seeds, and each slot's own answer is
// marked beside the reply's. An adapter is refined on one question until that question is answered; then the next.
//   node training/prove.mjs ids   --kind K [--split held|train]             the questions of a kind, by id (no model is asked)
//   node training/prove.mjs train --name X --role draft [--kinds a,b] [--ids x,y] [--iters N] [--lr X] [--layers N] [--from file]
//        an adapter of that role's examples (those pretraining kept: <adapters>/<model>/roles/<role>/examples.jsonl, or
//        --from), of the kinds or questions named, kept under .work/prove/X/. Prints the file.
//   node training/prove.mjs teach --name X --kinds a,b [--n 40] [--role draft]
//        n train questions of each kind are made and the module asked each once; the larger model answers each drafting slot's
//        own request (--worked: with its working written out), and what it got right is kept: .work/prove/X/taught.jsonl (train --from it)
//   node training/prove.mjs compare --b <label> [--a without] [--ids a,b]   two askings, paired by question and seed
//   node training/prove.mjs ask   --ids a,b [--seeds 1,2,3] [--adapter role=file[,role=file]]
//        [--slots a-direct=day,b-direct=date]   the mixture: which slot carries which of the adapters loaded (--adapter
//        day=file,date=file names them); a slot not named carries its role's, where one of that name is loaded
//        each question on each seed: the reply's mark, and each drafting and checking slot's. Written to .work/prove/asked.jsonl
// rowOf and tallyOf are the pure parts, tested.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// one asking, as a row: { id, kind, seed, with, right, slots: { slot: true | false | null }, reply }
export function rowOf(t, seed, withAdapter, got, marks) {
  const slots = {};
  for (const [i, s] of ((got && got.trace) || []).entries()) {
    if (s.stage !== 'draft' && s.stage !== 'check') continue;
    slots[s.slot] = s.final ? !!marks[i] : null;
  }
  return {
    id: t.id,
    kind: t.kind,
    seed,
    with: withAdapter,
    right: !!marks.reply,
    slots,
    reply: String((got && got.reply) || '').slice(-160),
  };
}
// AN ARRANGEMENT WITH ADAPTERS PLACED ON ITS SLOTS ({ slot: adapter name }), in every class's arrangement where it has one
export function placedOf(b, carried) {
  if (!carried || !Object.keys(carried).length) return b;
  const on = (slots) => (slots || []).map((x) => (carried[x.id] ? { ...x, adapter: carried[x.id] } : x));
  return {
    ...b,
    slots: on(b.slots),
    // (a class of input with an arrangement of its own keeps it under kinds)
    ...(b.kinds
      ? {
          kinds: Object.fromEntries(
            Object.entries(b.kinds).map(([k, c]) => [k, c && c.slots ? { ...c, slots: on(c.slots) } : c]),
          ),
        }
      : {}),
  };
}
// an arrangement with its plan changed, in every class's own arrangement too
export function plannedOf(b, plan) {
  if (!plan || !Object.keys(plan).length) return b;
  return {
    ...b,
    plan: { ...(b.plan || {}), ...plan },
    ...(b.kinds
      ? {
          kinds: Object.fromEntries(
            Object.entries(b.kinds).map(([k, c]) => [k, c ? { ...c, plan: { ...(c.plan || {}), ...plan } } : c]),
          ),
        }
      : {}),
  };
}
// TWO ASKINGS SIDE BY SIDE, PAIRED: the last row of each (question, seed) under each label, for the pairs both have (of the
// questions named, or all) -> { keys: ['id|seed'], a: [{ counted }], b: [{ counted }] }
export function comparedOf(rows, a, b, ids = []) {
  const last = (label) => {
    const m = new Map();
    for (const r of rows)
      if ((r.label || (r.with ? 'with' : 'without')) === label && (!ids.length || ids.includes(r.id)))
        m.set(r.id + '|' + r.seed, r);
    return m;
  };
  const A = last(a);
  const Bm = last(b);
  const keys = [...A.keys()].filter((k) => Bm.has(k));
  return {
    keys,
    a: keys.map((k) => ({ counted: A.get(k).right })),
    b: keys.map((k) => ({ counted: Bm.get(k).right })),
  };
}
// the rows of one question, counted: { n, right, slots: { slot: [right, asked] } }
export function tallyOf(rows) {
  const out = { n: rows.length, right: rows.filter((r) => r.right).length, slots: {} };
  for (const r of rows)
    for (const [k, v] of Object.entries(r.slots)) {
      const o = (out.slots[k] = out.slots[k] || [0, 0]);
      o[1]++;
      if (v) o[0]++;
    }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const B = await import('./support/bench.mjs');
  const A = await import('./adapters.mjs');
  const { MEMBERS, TARGET } = await import('../src/catalog.mjs');
  const { readBriefs } = await import('../src/index.mjs');
  const { messagesOf } = await import('./tasks.mjs');
  const cmd = process.argv[2];
  const work = path.join(B.REPO_ROOT, '.work');
  const dir = path.join(work, 'prove');
  const list = (name) => String(B.arg(name, '')).split(',').filter(Boolean);
  const every = () => [...B.questions('held'), ...B.questions('train')];
  const model = (() => {
    const m = Object.values(MEMBERS)[0];
    return { name: m.name, file: path.join(B.modelsDir(), m.file) };
  })();
  if (cmd === 'ids') {
    for (const t of B.questions(B.arg('split', 'held')).filter((x) => x.kind === B.arg('kind')))
      console.log(t.id + '  ' + String(messagesOf(t).at(-1).content).replace(/\s+/g, ' ').slice(0, 110));
    process.exit(0);
  }
  if (cmd === 'train') {
    const role = B.arg('role', 'draft');
    const from = B.arg('from') || path.join(A.adapterDir(work, TARGET.id, model), 'roles', role, 'examples.jsonl');
    const kinds = list('kinds');
    const ids = list('ids');
    const rows = fs
      .readFileSync(from, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter(
        (e) =>
          (!kinds.length || kinds.includes(e.kind)) &&
          (!ids.length || ids.includes(e.id)) &&
          (!B.arg('slot') || e.slot === B.arg('slot')) &&
          (!B.arg('source') || e.from === B.arg('source')),
      );
    const out = path.join(dir, String(B.arg('name', 'trial')));
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const ds = path.join(out, 'examples.jsonl');
    fs.writeFileSync(ds, rows.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const r = A.trainAdapter(model, ds, out, {
      work,
      iters: Number(B.arg('iters', 100)),
      lr: B.arg('lr') || null,
      layers: B.arg('layers') || null,
    });
    console.log(
      JSON.stringify({
        ok: r.ok,
        why: r.why,
        examples: rows.length,
        trainedOn: r.examples,
        dropped: r.dropped,
        valLoss: r.valLoss,
        perplexity: r.perplexity,
        seconds: r.seconds,
        gguf: r.gguf,
      }),
    );
    process.exit(r.ok ? 0 : 1);
  }
  // teach: MANY QUESTIONS OF ONE KIND, each drafting slot's own request answered by the larger model. A kind has six train
  // questions in a pass, and an adapter of six questions asked four ways learns those six (2026-11-23: 0 of 3 on a seventh).
  // So more are made, from the same maker, the module is asked each once so that its slots' requests are had word for word,
  // and the larger model answers each request; what it got right is the examples.
  if (cmd === 'teach') {
    const R = await import('./mixture.mjs');
    const { ROLE_OF_STAGE } = await import('../src/index.mjs');
    const { finalOf } = await import('../src/read.mjs');
    const kinds = list('kinds');
    const n = Number(B.arg('n', 40));
    const role = B.arg('role', 'draft');
    // (not the questions a pass holds out, and not the ones asked to prove it)
    const tasks = B.questions('train', n).filter(
      (t) => kinds.includes(t.kind) && typeof t.good === 'function' && !t.tools,
    );
    const calls = [];
    let cur = null;
    const swarm = await B.openSwarm(readBriefs(), {
      seed: 1,
      adapters: false,
      onAsk: (c) => cur && ROLE_OF_STAGE[c.stage] === role && calls.push({ ...c, t: cur }),
    });
    try {
      for (const t of tasks) {
        cur = t;
        await B.askSwarm(swarm, t, messagesOf(t));
      }
    } finally {
      cur = null;
      await swarm.stop();
    }
    const seen = new Set();
    const asks = calls.filter((c) => {
      const k = JSON.stringify(c.messages);
      if (seen.has(k) || c.messages.some((m) => m.role === 'tool' || Array.isArray(m.tool_calls))) return false;
      seen.add(k);
      return true;
    });
    const marker = readBriefs().marker;
    // (--worked: the larger model is told, and only it, to write its working out. It can leave steps out and be right; a
    // small model taught its short answers left its own steps out and was wrong, 2026-11-23. The example is still the
    // slot's request as the slot gets it, answered with the working shown)
    const WORKED =
      'Write out every step of your working, one step on a line. Before you use a figure or a fact from the question, ' +
      'quote the words of the question it comes from. Do each calculation on its own line. Then give the last line as you were told to.';
    const shown = (messages) =>
      B.has('worked')
        ? messages.map((m, i) => (i === 0 && m.role === 'system' ? { ...m, content: m.content + '\n\n' + WORKED } : m))
        : messages;
    const big = await B.openAlone('target');
    const rows = [];
    let asked = 0;
    try {
      for (const c of asks) {
        const t = c.t;
        // (THE SLOT'S OWN ANSWER WHERE IT WAS RIGHT: its own working, which it can follow. The larger model's only where the
        // slot was wrong: --own-first, the default; --teacher-only asks the larger model every one)
        if (!B.has('teacher-only')) {
          const mine = c.text ? finalOf(c.text, marker, t.type === 'code') : '';
          let good = false;
          try {
            good = !!mine && ((await t.good(t.wrap(mine), {})) || {}).grade === 'right';
          } catch {
            good = false;
          }
          if (good) {
            rows.push({
              id: t.id,
              kind: t.kind,
              slot: c.slot,
              from: 'own',
              messages: [...c.messages.map(R.forTemplate), { role: 'assistant', content: c.text }],
            });
            continue;
          }
        }
        let text = '';
        try {
          text = String((await big.ask(shown(c.messages), { maxTokens: 900 })).text || '');
        } catch {
          text = '';
        }
        asked++;
        const rightBy = async (x) => {
          try {
            return !!x && ((await t.good(t.wrap(x), {})) || {}).grade === 'right';
          } catch {
            return false;
          }
        };
        const final = text ? finalOf(text, marker, t.type === 'code') : '';
        let ok = await rightBy(final);
        if (!ok && !final) {
          const last = R.closingLine(text);
          if (last && (await rightBy(last))) {
            text = text.trimEnd() + '\n\n' + marker + ' ' + last;
            ok = true;
          }
        }
        if (ok)
          rows.push({
            id: t.id,
            kind: t.kind,
            slot: c.slot,
            from: 'larger',
            messages: [...c.messages.map(R.forTemplate), { role: 'assistant', content: text }],
          });
      }
    } finally {
      await big.stop();
    }
    const out = path.join(dir, String(B.arg('name', 'taught')));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'taught.jsonl'), rows.map((e) => JSON.stringify(e)).join('\n') + '\n');
    console.log(
      JSON.stringify({
        questions: tasks.length,
        requests: asks.length,
        asked,
        right: rows.length,
        own: rows.filter((r) => r.from === 'own').length,
        bySlot: Object.fromEntries(
          [...new Set(rows.map((r) => r.slot))].map((k) => [k, rows.filter((r) => r.slot === k).length]),
        ),
        distinct: new Set(rows.map((r) => r.id)).size,
        file: path.join(out, 'taught.jsonl'),
      }),
    );
    process.exit(0);
  }
  if (cmd === 'ask') {
    const ids = list('ids');
    const seeds = list('seeds').map(Number);
    const by = Object.fromEntries(
      list('adapter')
        .map((x) => x.split('='))
        .filter(([r, f]) => r && f),
    );
    const withAdapter = Object.keys(by).length > 0;
    // (what this asking is called, for compare: the adapter's folder, or 'without')
    const label = String(B.arg('label', withAdapter ? path.basename(path.dirname(Object.values(by)[0])) : 'without'));
    // (--slots a-direct=day,b-steps=date: WHICH SLOT CARRIES WHICH ADAPTER, the mixture: a slot named carries that one, by
    // the name it was loaded under, and a slot not named carries its role's where one of that name is loaded, else none)
    const carried = Object.fromEntries(list('slots').map((x) => x.split('=')));
    // (--plan k=v,k=v: the arrangement's plan changed so, in every class: what happens after the drafts, tried with a mixture on)
    const planned = Object.fromEntries(
      list('plan').map((x) => {
        const [k, v] = x.split('=');
        return [k, v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v];
      }),
    );
    // (--least X: a slot carries its adapter only on requests at least so like what it was taught, measured against the
    // requests in --taught file; --scale X: at part strength)
    const least = B.arg('least') !== undefined && B.arg('least') !== true ? Number(B.arg('least')) : null;
    const scale = B.arg('scale') !== undefined && B.arg('scale') !== true ? Number(B.arg('scale')) : null;
    const { signatureOf } = await import('../src/like.mjs');
    const sig = B.arg('taught')
      ? signatureOf([
          ...new Set(
            fs
              .readFileSync(String(B.arg('taught')), 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((l) => String(JSON.parse(l).messages.at(-2).content)),
          ),
        ])
      : null;
    const tuned = (b) => {
      const on = (slots) =>
        (slots || []).map((x) =>
          x.adapter && x.adapter !== 'none'
            ? {
                ...x,
                ...(least !== null ? { adapterLeast: least } : {}),
                ...(scale !== null ? { adapterScale: scale } : {}),
              }
            : x,
        );
      return {
        ...b,
        slots: on(b.slots),
        ...(b.kinds
          ? {
              kinds: Object.fromEntries(
                Object.entries(b.kinds).map(([k, c]) => [k, c && c.slots ? { ...c, slots: on(c.slots) } : c]),
              ),
            }
          : {}),
      };
    };
    const placed = (b) => tuned(plannedOf(placedOf(b, carried), planned));
    const pool = every();
    const tasks = ids.map((id) => pool.find((t) => t.id === id)).filter(Boolean);
    const rows = [];
    const used = [];
    for (const seed of seeds.length ? seeds : [1]) {
      const swarm = await B.openSwarm(placed(readBriefs()), {
        seed,
        adapters: withAdapter,
        lorasWith: () => ({}),
        roleLorasWith: () => (withAdapter ? Object.fromEntries(Object.keys(MEMBERS).map((k) => [k, by])) : {}),
        ...(sig ? { adapterLike: Object.fromEntries(Object.keys(by).map((n) => [n, sig])) } : {}),
        // (how many of the drafting requests were served with the adapter their slot carries)
        onAsk: (c) => c.adapter !== undefined && used.push(c.adapter === 'none' ? 0 : 1),
      });
      try {
        for (const t of tasks) {
          const got = await B.askSwarm(swarm, t, messagesOf(t));
          const mark = async (x) => {
            try {
              return !!x && ((await t.good(x)) || {}).grade === 'right';
            } catch {
              return false;
            }
          };
          const marks = { reply: await mark(got.reply) };
          for (const [i, s] of (got.trace || []).entries()) if (s.final) marks[i] = await mark(t.wrap(s.final));
          const row = { ...rowOf(t, seed, withAdapter, got, marks), label };
          rows.push(row);
          console.log(
            (row.right ? 'RIGHT ' : 'wrong ') +
              t.id +
              ' seed ' +
              seed +
              (withAdapter ? ' with ' + Object.keys(by).join('+') : ' without') +
              '  slots: ' +
              Object.entries(row.slots)
                .map(([k, v]) => k + (v === null ? ' -' : v ? ' Y' : ' n'))
                .join(', ') +
              '  | ' +
              row.reply.replace(/\s+/g, ' ').slice(-70),
          );
        }
      } finally {
        await swarm.stop();
      }
    }
    if (used.length)
      console.log(
        'ADAPTER on ' + used.filter(Boolean).length + ' of ' + used.length + ' requests of slots that carry one',
      );
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'asked.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const t of tasks) {
      const tl = tallyOf(rows.filter((r) => r.id === t.id));
      console.log(
        'TALLY ' +
          t.id +
          (withAdapter ? ' with' : ' without') +
          ': right ' +
          tl.right +
          ' of ' +
          tl.n +
          '; ' +
          Object.entries(tl.slots)
            .map(([k, v]) => k + ' ' + v[0] + '/' + v[1])
            .join(', '),
      );
    }
    process.exit(0);
  }
  // compare: the same questions on the same seeds, one asking beside another, paired -> the gain and its error
  if (cmd === 'compare') {
    const { pairedGain, worthKeeping } = await import('./classes.mjs');
    const all = fs
      .readFileSync(path.join(dir, 'asked.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const ids = list('ids');
    const c = comparedOf(all, B.arg('a', 'without'), B.arg('b'), ids);
    const g = pairedGain(c.b, c.a);
    console.log(
      JSON.stringify({
        pairs: c.a.length,
        questions: new Set(c.keys.map((k) => k.split('|')[0])).size,
        [B.arg('a', 'without')]: c.a.filter((x) => x.counted).length,
        [B.arg('b')]: c.b.filter((x) => x.counted).length,
        gained: c.keys.filter((_, i) => c.b[i].counted && !c.a[i].counted).length,
        lost: c.keys.filter((_, i) => !c.b[i].counted && c.a[i].counted).length,
        gain: +(g.gain * 100).toFixed(1),
        error: +(g.error * 100).toFixed(1),
        beyondError: worthKeeping(g, 0.02),
      }),
    );
    process.exit(0);
  }
  console.log('node training/prove.mjs ids|teach|train|ask|compare   (see the head of this file)');
  process.exit(2);
}
