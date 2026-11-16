// readers.mjs - A READER IS CHECKED BEFORE IT IS BELIEVED. Where an answer is in words (what is wrong with this function?), whether
// the swarm's answer and the larger model's say the same thing is decided by a model: Kev is asked one yes or no. A reader that
// misreads blames or excuses the swarm for nothing, and a whole kind of question is then graded wrongly without a sign of it. So
// before a pass believes it, the reader is given pairs anyone can judge:
//   the same     one flaw, said two ways: it must say they say the same
//   different    two different flaws of two different functions, each put as the answer to one question: it must say they differ
// If it gets fewer than four in five right, its grades are not believed this pass: answers in words are then not compared (and
// are counted as such), which is less than a measurement but is not a false one.
//   node training/readers.mjs        check the reader, and write down whether it is to be believed (.work/train/reader.json)
import fs from 'node:fs';
import path from 'node:path';
import { tasks } from './tasks.mjs';
import { openEquivalent } from './support/equivalent.mjs';
import { READER_FILE, readerOk } from './support/reader-file.mjs';

export function knownPairs({ each = 6, seed = 4242 } = {}) {
  const bugs = tasks({ split: 'train', each, kinds: ['bug'], seed }).filter((t) => t.flaw);
  const out = [];
  bugs.forEach((t, i) => {
    out.push({
      ask: t.ask,
      a: 'The bug is that ' + t.flaw + '.',
      b: 'In short, the function is wrong because ' + t.flaw + '. Nothing else is the matter with it.',
      same: true,
    });
    const other = bugs.find((x, j) => j > i && x.flaw !== t.flaw) || bugs.find((x) => x.flaw !== t.flaw);
    if (other)
      out.push({
        ask: t.ask,
        a: 'The bug is that ' + t.flaw + '.',
        b: 'The bug is that ' + other.flaw + '.',
        same: false,
      });
  });
  return out;
}
// WHERE IT DRAWS THE LINE IS LEARNED FROM THE SAME PAIRS. The reader gives a probability that two answers say the same, and
// "more likely than not" need not be where it tells them apart best: a reader that gives two different flaws 0.6 and the same
// flaw 0.95 reads well with the line at 0.8 and badly with it at one half. So the line is put where it reads the known pairs
// best (one number, from a dozen pairs it is not graded on afterwards), and it is believed only if it then reads four in five.
export async function checkReader({ kev, pairs = knownPairs(), need = 0.8, judge = openEquivalent } = {}) {
  const read = [];
  for (const p of pairs) {
    const g = await judge(p.ask, p.a, p.b, { kev });
    if (g.grade === 'noref') continue; // it did not answer: not a reading, right or wrong
    read.push({ ...p, p: Number.isFinite(g.p) ? g.p : g.grade === 'right' ? 1 : 0 });
  }
  const asked = read.length;
  const rightAt = (mark) => read.filter((x) => x.p >= mark === x.same).length;
  let mark = 0.5;
  for (const m of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) if (rightAt(m) > rightAt(mark)) mark = m;
  const right = rightAt(mark);
  const missed = read
    .filter((x) => x.p >= mark !== x.same)
    .map((x) => ({ same: x.same, p: Math.round(x.p * 100) / 100, a: x.a.slice(0, 80), b: x.b.slice(0, 80) }));
  return {
    asked,
    right,
    atHalf: rightAt(0.5),
    mark,
    ok: asked > 0 && right / asked >= need,
    need,
    missed: missed.slice(0, 5),
  };
}
export { READER_FILE, readerOk };

if (import.meta.url === 'file://' + process.argv[1]) {
  // (the reader is this configuration's decider: whether it is believed is kept with this configuration)
  const { WORKC: WORK, kevAddress } = await import('./support/bench.mjs');
  const kev = await kevAddress();
  fs.mkdirSync(WORK, { recursive: true });
  if (!kev) {
    fs.writeFileSync(
      READER_FILE(WORK),
      JSON.stringify({ at: new Date().toISOString(), ok: false, why: 'no Kev is running to read answers in words' }),
    );
    console.log('No Kev is running: answers in words will not be compared this pass.');
    process.exit(0);
  }
  const r = await checkReader({ kev });
  fs.writeFileSync(READER_FILE(WORK), JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2));
  console.log(
    'The reader of answers in words read ' +
      r.right +
      ' of ' +
      r.asked +
      ' pairs anyone can judge correctly, taking ' +
      r.mark +
      ' or more as yes (' +
      r.atHalf +
      ' with the line at one half). ' +
      (r.ok
        ? 'It is believed.'
        : 'That is under ' +
          Math.round(r.need * 100) +
          '%: its grades are NOT believed this pass, and answers in words are not compared.'),
  );
  for (const m of r.missed)
    console.log(
      '  misread (' + (m.same ? 'the same, said two ways' : 'two different flaws') + '): ' + m.a + ' | ' + m.b,
    );
}
