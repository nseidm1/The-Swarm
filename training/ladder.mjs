// ladder.mjs - WHAT THE WRITER OF THIS SWARM CAN BE TRUSTED WITH. Training asks the larger model to write things that go into
// the module: a function that works a kind of question out (training/write-code.mjs), a reading that lays a kind onto a form
// the module ships (training/write-reading.mjs). How far that can go is a thing of the model that writes, not of the trainer:
// one that fills a form rightly may not be able to write the code that works it out. So it is measured, a rung at a time, on
// questions training makes itself, and the class stage asks its writer only for what it was shown to do.
//   rung 0  FILLS      it fills the module's forms for held questions of the kinds they were made for; the form's code answers
//   rung 1  LAYS       it lays a kind no form was made for onto a form that fits (ladder-kinds.mjs), vetted on questions unseen
//   rung 2  WRITES     it writes a function that works a kind out from the question, vetted on questions unseen (write-code)
// A rung is HELD where the share of kinds passed is at least the bar (policy.ladder.bar, 0.75). A rung above is not denied
// because one below failed: each says what it measured. (Designing a new form and its code together was tried apart from this,
// four ways, and one kind of eight came through: it is not a rung the trainer asks for.)
//   node training/ladder.mjs [--rungs 0,1,2] [--each N] [--only kind,kind] [--out file]     writes <work>/ladder.json
// Nothing of a benchmark is read or written here. The swarm's own models are not asked: this measures the writer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMS, FORM_IDS, formAsk, formWorked } from '../src/forms.mjs';
import { writeReadingFor } from './write-reading.mjs';
import { LADDER_KIND_NAMES, ladderTasks } from './ladder-kinds.mjs';

// the kind of training's own questions each form was made for
export const FORM_KIND = {
  lies: 'lies',
  word: 'string',
  row: 'deduce',
  date: 'date',
  sorted: 'sorted',
  free: 'free',
  order: 'order',
  more: 'extract',
  valid: 'valid',
  number: 'chain',
  weekday: 'day',
  letters: 'letters',
  range: 'count',
  track: 'swap',
  path: 'path',
};
export const RUNGS = ['fills', 'lays', 'writes'];
export const ladderFile = (work) => path.join(work, 'ladder.json');
// WHAT A LADDER SAYS: { rungs: { fills: { passed, of, held, kinds }, ... }, bar, writer, at }
export function readLadder(work) {
  try {
    const j = JSON.parse(fs.readFileSync(ladderFile(work), 'utf8'));
    return j && j.rungs ? j : null;
  } catch {
    return null;
  }
}
// IS A RUNG HELD? unmeasured: not known (null), and whoever asks decides what to do without it
export const holds = (ladder, rung) =>
  ladder && ladder.rungs && ladder.rungs[rung] ? !!ladder.rungs[rung].held : null;
const summed = (kinds, bar) => {
  const of = Object.keys(kinds).length;
  const passed = Object.values(kinds).filter((k) => k.ok).length;
  return { passed, of, held: of > 0 && passed / of >= bar, kinds };
};
const format = (id) => ({
  response_format: { type: 'json_schema', json_schema: { name: id, strict: true, schema: FORMS[id].schema } },
});

// RUNG 0: fills the module's forms. make(kind, n) -> held questions of training's own
export async function rungFills({ ask, make, each = 8, only = null, say = () => {} }) {
  const kinds = {};
  for (const id of FORM_IDS.filter((f) => !only || only.includes(f))) {
    const list = make(FORM_KIND[id], each);
    let right = 0;
    let nulls = 0;
    for (const t of list) {
      const got = formWorked(id, t.ask, await ask(formAsk(id, t.ask), { maxTokens: 1200, format: format(id) }));
      if (got === null) nulls++;
      else if ((await t.good(String(got))).grade === 'right') right++;
    }
    const wrong = list.length - right - nulls;
    kinds[id] = { ok: wrong === 0 && right >= Math.ceil(0.7 * list.length), right, wrong, nulls, n: list.length };
    say('fills ' + id + ': ' + right + ' right, ' + wrong + ' wrong, ' + nulls + ' with no answer, of ' + list.length);
  }
  return kinds;
}
// RUNG 1: lays a kind no form was made for onto a form that fits
export async function rungLays({ ask, each = 14, only = null, say = () => {} }) {
  const kinds = {};
  for (const kind of LADDER_KIND_NAMES.filter((k) => !only || only.includes(k))) {
    const list = ladderTasks(kind, each);
    const got = await writeReadingFor({ kind, shown: list.slice(0, 5), unseen: list.slice(5), ask });
    const last = got.tries.at(-1) || {};
    kinds[kind] = {
      ok: got.ok,
      form: got.form || null,
      fits: list[0].fits,
      tries: got.tries.length,
      right: last.right,
      wrong: last.wrong,
      nulls: last.nulls,
      ...(got.ok ? { reading: got.reading } : { why: String(got.why || '').slice(0, 300) }),
    };
    say(
      'lays ' +
        kind +
        ' onto ' +
        (got.form || 'nothing') +
        ' (made for: ' +
        list[0].fits +
        '): ' +
        (got.ok ? 'kept' : 'refused') +
        ' after ' +
        got.tries.length +
        ' tr' +
        (got.tries.length === 1 ? 'y' : 'ies') +
        (last.right !== undefined
          ? ', ' +
            last.right +
            ' right, ' +
            last.wrong +
            ' wrong, ' +
            last.nulls +
            ' with no answer on ' +
            (list.length - 5) +
            ' unseen'
          : ''),
    );
  }
  return kinds;
}
// RUNG 2: writes a function for a kind, from the question itself (the writer training already has)
export async function rungWrites({
  ask,
  make,
  makeOthers,
  writeFor,
  each = 16,
  only = null,
  tries = 3,
  say = () => {},
}) {
  const kinds = {};
  for (const id of FORM_IDS.filter((f) => !only || only.includes(f))) {
    const kind = FORM_KIND[id];
    const got = await writeFor(
      kind,
      make(kind, each),
      makeOthers(kind),
      (messages) => ask(messages, { maxTokens: 2500 }),
      { tries },
    );
    kinds[kind] = {
      ok: got.ok,
      tries: got.tries.length,
      ...(got.ok ? {} : { why: String(got.why || '').slice(0, 200) }),
    };
    say('writes ' + kind + ': ' + (got.ok ? 'kept' : 'refused: ' + String(got.why || '').slice(0, 100)));
  }
  return kinds;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const B = await import('./support/bench.mjs');
  const TK = await import('./tasks.mjs');
  const WC = await import('./write-code.mjs');
  const policy = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
  const P = policy.ladder || {};
  const bar = Number(B.arg('bar', P.bar ?? 0.75));
  const rungs = String(B.arg('rungs', '0,1,2')).split(',').map(Number);
  const only = B.arg('only') ? B.arg('only').split(',') : null;
  const out = B.arg('out', ladderFile(B.WORKC));
  const say = (m) => console.log(m);
  const big = await B.openAlone('target');
  const ask = async (messages, o = {}) =>
    String(
      ((await big.ask(messages, { maxTokens: o.maxTokens || 1500, ...(o.format ? { format: o.format } : {}) })) || {})
        .text || '',
    );
  const before = readLadder(path.dirname(out)) || { rungs: {} };
  const ladder = { bar, writer: big.label || 'target', at: new Date().toISOString(), rungs: { ...before.rungs } };
  const held = (kind, n) => TK.tasks({ split: 'held', each: n, kinds: [kind] });
  try {
    if (rungs.includes(0))
      ladder.rungs.fills = summed(
        await rungFills({ ask, make: held, each: Number(B.arg('each', P.fillEach ?? 8)), only, say }),
        bar,
      );
    if (rungs.includes(1))
      ladder.rungs.lays = summed(await rungLays({ ask, each: Number(B.arg('each', P.layEach ?? 14)), only, say }), bar);
    if (rungs.includes(2))
      ladder.rungs.writes = summed(
        await rungWrites({
          ask,
          make: (kind, n) => TK.tasks({ split: 'train', each: n, kinds: [kind] }),
          makeOthers: (kind) =>
            TK.tasks({ split: 'train', each: 2, kinds: TK.REASONING.filter((k) => k !== kind) }).filter((t) =>
              WC.writable(t),
            ),
          writeFor: WC.writeFor,
          each: Number(B.arg('each', P.writeEach ?? 16)),
          only,
          say,
        }),
        bar,
      );
  } finally {
    await big.stop();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(ladder, null, 1));
  }
  console.log('\nTHE LADDER of ' + ladder.writer + ' (a rung is held at ' + Math.round(bar * 100) + '% of kinds):');
  for (const r of RUNGS)
    if (ladder.rungs[r])
      console.log(
        '  ' +
          r.padEnd(7) +
          ladder.rungs[r].passed +
          ' of ' +
          ladder.rungs[r].of +
          ' kinds' +
          (ladder.rungs[r].held ? '   HELD' : '   not held'),
      );
  console.log('written to ' + out);
}
