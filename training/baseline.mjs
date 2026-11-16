// baseline.mjs - ONE MODEL BY ITSELF, ON THE SAME QUESTIONS. The swarm is trained to be right as often as a much larger model, so
// three things are measured apart from it: each small model alone (what the swarm must beat to be worth its cost) and the large
// model (what it is trying to match). The model is told nothing but the question.
//   node training/baseline.mjs --who a --split held
//   node training/baseline.mjs --who b --split held
//   node training/baseline.mjs --who target --split held          the larger model being chased (targets.json, target.mjs)
//   node training/baseline.mjs --who http://127.0.0.1:8080 --label large-27b --split held      any model, wherever it runs
import fs from 'node:fs';
import path from 'node:path';
import {
  arg,
  has,
  chosen,
  openAlone,
  run,
  count,
  line,
  save,
  rowsTo,
  needReference,
  finished,
  aloneLabel,
  RESULTS,
} from './support/bench.mjs';
import { targetOf } from './state.mjs';

const who = arg('who', 'a');
const label = String(
  arg('label', who === 'target' ? targetOf().id : /^https?:/.test(who) ? 'reference' : aloneLabel(who)),
).replace(/[^\w.-]+/g, '-');
const split = arg('split', 'train');
const list = chosen();
// a model does not change between passes: measured once on these questions, it is not measured on them again (--again does)
try {
  const was = JSON.parse(fs.readFileSync(path.join(RESULTS, label + '-' + split + '.json'), 'utf8'));
  if (!has('again') && list.length && was.seed === list[0].seed && was.asked === list.length) {
    console.log(
      label +
        ' was measured on these questions on ' +
        String(was.at).slice(0, 10) +
        ': ' +
        was.right +
        ' right, ' +
        was.wrong +
        ' wrong of ' +
        was.asked +
        '.',
    );
    process.exit(0);
  }
} catch {
  /* not measured yet */
}
// the larger model's own answers are the reference; anything else is graded against them
const self = who === 'target';
const ref = self ? null : needReference(list, split);
const model = await openAlone(who);
try {
  // the larger model is asked again where its reply holds no answer (target.mjs); every answer is written down as it comes
  const rows = await run(
    list,
    async (t) => ({
      reply: (
        await model.ask(
          [{ role: 'user', content: t.ask }],
          self ? { usable: (text) => (t.usable ? t.usable(text) : !!t.show(text)) } : undefined,
        )
      ).text,
    }),
    {
      name: [label, split, list.length ? list[0].seed : ''].join('-'),
      ref,
      self,
      who: self ? 'target' : who,
      onRow: (r) => console.log(r.grade.padEnd(7) + r.id.padEnd(22) + String(r.reply).replace(/\s+/g, ' ').slice(-90)),
    },
  );
  const silent = rows.filter((r) => !String(r.reply || '').trim()).length;
  if (rows.length && silent === rows.length) {
    console.log(
      '\n' +
        label +
        ' gave an EMPTY reply to every one of ' +
        rows.length +
        ' questions. That is a fault in how it is served, not an answer: nothing was written down.',
    );
    process.exitCode = 1;
    throw new Error('every reply was empty');
  }
  if (silent) console.log(silent + ' of ' + rows.length + ' replies were empty.');
  const c = count(rows);
  if (self) {
    // the larger model is not marked against anything: what matters is how many of its replies ARE answers. One that is not
    // (cut off, empty) after three draws is no mark, and the questions it belongs to are not compared for anyone.
    const none = rows.filter((r) => r.grade !== 'right');
    const kinds = {};
    for (const r of none) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    console.log(
      '\n' +
        label +
        ' (' +
        split +
        ')  ' +
        (rows.length - none.length) +
        ' of ' +
        rows.length +
        ' replies hold an answer' +
        (none.length
          ? '. ' +
            none.length +
            ' do not, after three draws each, and will not be compared: ' +
            Object.entries(kinds)
              .map(([k, n]) => k + ' ' + n)
              .join(', ')
          : '') +
        '   ' +
        c.seconds +
        ' s each',
    );
    if (none.length * 4 >= rows.length)
      console.log(
        'A QUARTER OR MORE OF ITS REPLIES HOLD NO ANSWER. It is a poor mark as it is served here: choose another larger model.',
      );
  } else console.log('\n' + line(label + ' (' + split + ')', c));
  rowsTo(
    'baseline-runs.jsonl',
    rows.map((r) => ({ label, ...r })),
  );
  finished();
  save(label + '-' + split, { who: label, split, seed: list.length ? list[0].seed : null, ...c });
} finally {
  await model.stop();
}
