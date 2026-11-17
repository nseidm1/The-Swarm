// readers.mjs - A READER IS CHECKED BEFORE IT IS BELIEVED. Where an answer is in words (what is wrong with this function?), whether
// the swarm's answer and the larger model's say the same thing is decided by a model: the judge, else the decider, is asked one yes or no. A reader that
// misreads blames or excuses the swarm for nothing, and a whole kind of question is then graded wrongly without a sign of it. So
// before a pass believes it, the reader is given pairs anyone can judge:
//   paraphrase   the same answer in other words (another order, other words for the same thing): it must say they say the same
//   near-miss    nearly the same words with one fact changed (a number, a direction, a step, a "not"): it must say they differ
//   different    a plainly different answer: it must say they differ
// The near-misses are the hard half, and the reason for the check: a reader that only sees that two answers are about the same
// thing passes paraphrases and different answers alike, and fails here. Some near-misses are written; some are made from the
// larger model's own answers on record (one number in it changed). If it gets fewer than four in five right overall, or fewer than
// three in four of the paraphrases or of the near-misses, its grades are not believed this pass: answers in words are then not
// compared (and are counted as such), which is less than a measurement but is not a false one.
//   node training/readers.mjs        check the reader, and write down whether it is to be believed (.work/train/reader.json)
import fs from 'node:fs';
import path from 'node:path';
import { tasks } from './tasks.mjs';
import { openEquivalent, talkEquivalent } from './support/equivalent.mjs';
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
      kind: 'paraphrase',
    });
    const other = bugs.find((x, j) => j > i && x.flaw !== t.flaw) || bugs.find((x) => x.flaw !== t.flaw);
    if (other)
      out.push({
        ask: t.ask,
        a: 'The bug is that ' + t.flaw + '.',
        b: 'The bug is that ' + other.flaw + '.',
        same: false,
        kind: 'different',
      });
  });
  return [...out, ...OPEN_HARD];
}
// paraphrases in other words, and near-misses that change one fact, of answers to "what is wrong with this function?"
const fnAsk = (code) => 'What is wrong with this function?\n```js\n' + code + '\n```';
const TOTAL = fnAsk(
  'function total(xs) {\n  let s = 0;\n  for (let i = 1; i < xs.length; i++) s += xs[i];\n  return s;\n}',
);
const ADULT = fnAsk('function isAdult(age) {\n  return age > 18; // 18 and over is an adult\n}');
const CENTS = fnAsk('function toCents(dollars) {\n  return dollars * 10;\n}');
const LAST = fnAsk('function last(xs) {\n  return xs[xs.length];\n}');
const hard = (ask, a, b, same, kind) => ({ ask, a, b, same, kind });
const OPEN_HARD = [
  hard(
    TOTAL,
    'The loop starts at index 1, so the first number is never added.',
    'It skips xs[0]: i begins at one instead of zero, which leaves the first element out of the sum.',
    true,
    'paraphrase',
  ),
  hard(
    TOTAL,
    'The loop starts at index 1, so the first number is never added.',
    'The loop stops one early, so the last number is never added.',
    false,
    'near',
  ),
  hard(
    ADULT,
    'It uses > where it needs >=, so someone exactly 18 is not counted as an adult.',
    'An 18-year-old gets false, because the comparison is strict; it should be age >= 18.',
    true,
    'paraphrase',
  ),
  hard(
    ADULT,
    'It uses > where it needs >=, so someone exactly 18 is not counted as an adult.',
    'It uses > where it needs >=, so someone exactly 21 is not counted as an adult.',
    false,
    'near',
  ),
  hard(
    CENTS,
    'It multiplies by 10, but a dollar is 100 cents.',
    'Dollars to cents needs a factor of one hundred; ten gives an amount ten times too small.',
    true,
    'paraphrase',
  ),
  hard(
    CENTS,
    'It multiplies by 10, but a dollar is 100 cents.',
    'It multiplies by 10, but a dollar is 1000 cents.',
    false,
    'near',
  ),
  hard(
    LAST,
    'xs[xs.length] is one past the end, so it always gives undefined; it should be xs[xs.length - 1].',
    'The index is off by one: the last element sits at length minus one, and reading at length returns undefined.',
    true,
    'paraphrase',
  ),
  hard(
    LAST,
    'xs[xs.length] is one past the end, so it always gives undefined; it should be xs[xs.length - 1].',
    'xs[xs.length] is one past the end, so it always gives undefined; it should be xs[0].',
    false,
    'near',
  ),
];
// A NEAR-MISS MADE FROM AN ANSWER: the same words with its first number changed (6 -> 7, 7pm -> 8pm). An answer with no number
// in it makes none.
export function nearMissOf(text) {
  const t = String(text || '');
  const m = /(^|[^\w.])(\d+)(?![\d.]*\d)/.exec(t);
  if (!m) return null;
  const at = m.index + m[1].length;
  const n = Number(m[2]);
  return (
    t.slice(0, at) +
    String(n === 0 ? 1 : n + (n >= 10 ? Math.max(1, Math.round(n / 4)) : 1)) +
    t.slice(at + m[2].length)
  );
}
// THE SAME FOR A REPLY IN A CONVERSATION. Pairs of replies to a person's message that anyone can judge: the same help said two
// ways (it must say they do the same), and replies that do different things: another fact, another recommendation, a question
// back where the other answered, a refusal where the other helped (it must say they differ).
const SETTING =
  'You are Alex, one of a small team of helpers in a group chat with one person. The person is not a developer. You cannot book, buy or send anything for anyone.\n\nYOUR REPLY: open with the answer itself. At most 110 words.';
const DEV_SETTING =
  "You are Robin, an engineer on a small software team, talking in the team's chat with the person whose project it is.\n\nYOUR REPLY: begin with the thing itself, then why. At most 110 words.";
const pair = (system, ask, a, b, same, kind = same ? 'paraphrase' : 'different') => ({
  task: { system, turns: [{ role: 'user', content: ask }], ask },
  a,
  b,
  same,
  kind,
});
// near-misses in a conversation: the same reply with one fact changed, which a person would be misled by
const TALK_NEAR = [
  [
    'How long do I boil an egg so the yolk is still runny?',
    'Six minutes from the moment the water boils, then straight into cold water.',
    'Nine minutes from the moment the water boils, then straight into cold water.',
  ],
  [
    'Book me a table for four in Leeds on Friday at 7pm.',
    'I cannot book for you, but you can do it in a minute: search for the restaurant on Google Maps and use its Reserve button, or ring them. Ask for four at 7pm on Friday.',
    'I cannot book for you, but you can do it in a minute: search for the restaurant on Google Maps and use its Reserve button, or ring them. Ask for four at 8pm on Saturday.',
  ],
  [
    'Can a rabbit eat celery?',
    'Yes, in small amounts. Cut it into short pieces so the strings are not a choking risk.',
    'Yes, as much as it likes. There is no need to cut it up first.',
  ],
  [
    'Write a text to Tom to cancel dinner on Friday. I have a cold. Suggest next week.',
    'Hi Tom, so sorry but I have to cancel Friday: I have come down with a cold. Could we do next week instead?',
    'Hi Tom, so sorry but I have to cancel Saturday: I have come down with a cold. Could we do next month instead?',
  ],
];
export const talkPairs = () => [
  ...TALK_NEAR.map(([ask, a, b]) => pair(SETTING, ask, a, b, false, 'near')),
  pair(
    SETTING,
    'Can a rabbit eat celery?',
    'Yes, in small amounts. Cut it into short pieces so the strings are not a choking risk.',
    'They can, a little at a time. Chop it short first: the stringy bits can catch in the throat.',
    true,
  ),
  pair(
    SETTING,
    'Can a rabbit eat celery?',
    'Yes, in small amounts. Cut it into short pieces so the strings are not a choking risk.',
    'No. Celery is poisonous to rabbits and should never be given to them.',
    false,
  ),
  pair(
    SETTING,
    'Book me a table for four in Leeds on Friday at 7pm.',
    'I cannot book for you, but you can do it in a minute: search for the restaurant on Google Maps and use its Reserve button, or ring them. Ask for four at 7pm on Friday.',
    'Booking is something you will need to do yourself. Find the place on Google Maps and press Reserve, or phone them, and ask for a table for four at 7 on Friday evening.',
    true,
  ),
  pair(
    SETTING,
    'Book me a table for four in Leeds on Friday at 7pm.',
    'I cannot book for you, but you can do it in a minute: search for the restaurant on Google Maps and use its Reserve button, or ring them.',
    'All done. Your table for four is booked for Friday at 7pm.',
    false,
  ),
  pair(SETTING, 'Can you find me a dentist?', 'Which town or area are you in?', 'Happy to. Whereabouts are you?', true),
  pair(
    SETTING,
    'Can you find me a dentist?',
    'Which town or area are you in?',
    'Look on the NHS website under Find a dentist, put in your postcode, and ring the nearest three to ask who is taking new patients.',
    false,
  ),
  pair(
    SETTING,
    'How long do I boil an egg so the yolk is still runny?',
    'Six minutes from the moment the water boils, then straight into cold water.',
    'About six minutes in boiling water. Cool it under the cold tap so it stops cooking.',
    true,
  ),
  pair(
    SETTING,
    'How long do I boil an egg so the yolk is still runny?',
    'Six minutes from the moment the water boils, then straight into cold water.',
    'Twelve minutes at a rolling boil will give you the runny yolk you want.',
    false,
  ),
  pair(
    SETTING,
    'Write a text to Tom to cancel dinner on Friday. I have a cold. Suggest next week.',
    'Hi Tom, so sorry but I have to cancel Friday: I have come down with a cold. Could we do next week instead?',
    'Tom, I am really sorry, I have a rotten cold and will have to miss dinner on Friday. Are you free some time next week?',
    true,
  ),
  pair(
    SETTING,
    'Write a text to Tom to cancel dinner on Friday. I have a cold. Suggest next week.',
    'Hi Tom, so sorry but I have to cancel Friday: I have come down with a cold. Could we do next week instead?',
    'Hi Tom, looking forward to dinner on Friday! Shall I bring a bottle of wine?',
    false,
  ),
  pair(
    DEV_SETTING,
    'We have a flaky test. Is adding a fixed two-second sleep before the assertion a reasonable fix?',
    'No. A fixed sleep hides the race and slows every run. Wait for the condition itself: poll for the element or await the promise, with a timeout.',
    'It is not. Sleeping only makes the race less likely and the suite slower. Wait on the thing you are asserting, with a timeout, so the test passes as soon as it is true.',
    true,
  ),
  pair(
    DEV_SETTING,
    'We have a flaky test. Is adding a fixed two-second sleep before the assertion a reasonable fix?',
    'No. A fixed sleep hides the race and slows every run. Wait for the condition itself, with a timeout.',
    'Yes, that is a reasonable fix. Two seconds is usually plenty, and you can raise it if the test still fails.',
    false,
  ),
  pair(
    DEV_SETTING,
    'Why did my deploy fail last night?',
    'I have not been shown the deploy log, so I cannot say what failed. I would look at the last lines of the pipeline output first, then at what changed in the release.',
    'I cannot tell without seeing it. Start with the end of the pipeline log, and then the changes that went into that release.',
    true,
  ),
  pair(
    DEV_SETTING,
    'Why did my deploy fail last night?',
    'I have not been shown the deploy log, so I cannot say what failed. I would look at the last lines of the pipeline output first.',
    'It failed because the database migration timed out. Increase the migration timeout to ten minutes and run it again.',
    false,
  ),
];
// WHERE IT DRAWS THE LINE IS LEARNED FROM THE SAME PAIRS. The reader gives a probability that two answers say the same, and
// "more likely than not" need not be where it tells them apart best: a reader that gives two different flaws 0.6 and the same
// flaw 0.95 reads well with the line at 0.8 and badly with it at one half. So the line is put where it reads the known pairs
// best (one number, from a dozen pairs it is not graded on afterwards), and it is believed only if it then reads four in five.
export async function checkReader({ reader, pairs = knownPairs(), need = 0.8, judge = openEquivalent } = {}) {
  const read = [];
  for (const p of pairs) {
    const g = await judge(p.task || p.ask, p.a, p.b, { reader });
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
    .map((x) => ({
      same: x.same,
      kind: x.kind,
      p: Math.round(x.p * 100) / 100,
      a: x.a.slice(0, 80),
      b: x.b.slice(0, 80),
    }));
  // each class by itself: paraphrases must be read as the same, near-misses and different answers as different
  const kinds = {};
  for (const x of read) {
    const k = (kinds[x.kind || (x.same ? 'paraphrase' : 'different')] ||= { asked: 0, right: 0 });
    k.asked++;
    if (x.p >= mark === x.same) k.right++;
  }
  const holds = (k) => !kinds[k] || kinds[k].right / kinds[k].asked >= 0.75;
  return {
    asked,
    right,
    atHalf: rightAt(0.5),
    mark,
    kinds,
    ok: asked > 0 && right / asked >= need && holds('paraphrase') && holds('near'),
    need,
    missed: missed.slice(0, 5),
  };
}
export { READER_FILE, readerOk };

if (import.meta.url === 'file://' + process.argv[1]) {
  // (the reader is this configuration's decider: whether it is believed is kept with this configuration)
  const { WORKC: WORK, deciderAddress } = await import('./support/bench.mjs');
  const decider = await deciderAddress();
  fs.mkdirSync(WORK, { recursive: true });
  if (!decider) {
    fs.writeFileSync(
      READER_FILE(WORK),
      JSON.stringify({
        at: new Date().toISOString(),
        ok: false,
        why: 'no decider is running to read answers in words',
      }),
    );
    console.log('No decider is running: answers in words will not be compared this pass.');
    process.exit(0);
  }
  // near-misses made from the larger model's own replies in conversations on record: its reply, and the same with one number
  // changed (at most four, from the replies that have a number in them)
  const { WORK: RUNS } = await import('./support/bench.mjs');
  const { targetOf: tgtOf } = await import('./state.mjs');
  let own = [];
  try {
    const rows = fs
      .readFileSync(path.join(RUNS, 'baseline-runs.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((x) => x.label === tgtOf().id && x.split === 'held' && x.reply);
    const made = tasks({ split: 'held', each: 6, kinds: ['answer', 'request', 'talk'] });
    for (const t of made) {
      const r0 = rows.find((x) => x.id === t.id);
      const near = r0 && nearMissOf(r0.reply);
      if (near && own.length < 4) own.push({ task: t, a: r0.reply, b: near, same: false, kind: 'near' });
    }
  } catch {
    own = [];
  }
  // (the reader checked is the one that will read: the judge apart from the decider where the session started one)
  const reader = process.env.SWARM_JUDGE || decider;
  const r = await checkReader({ reader });
  const talk = await checkReader({ reader, pairs: [...talkPairs(), ...own], judge: talkEquivalent });
  const { JUDGE: J, DECIDER: DD } = await import('../src/catalog.mjs');
  const by = process.env.SWARM_JUDGE && J ? J.id : (DD || {}).id;
  fs.writeFileSync(READER_FILE(WORK), JSON.stringify({ at: new Date().toISOString(), by, ...r, talk }, null, 2));
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
  const byKind = (x) =>
    Object.entries(x.kinds || {})
      .map(([k, v]) => k + ' ' + v.right + ' of ' + v.asked)
      .join(', ');
  console.log(
    '  by kind: ' + byKind(r) + (r.ok ? '' : ' (paraphrases and near-misses must each be read three in four)'),
  );
  for (const m of r.missed)
    console.log('  misread (' + (m.kind || (m.same ? 'paraphrase' : 'different')) + '): ' + m.a + ' | ' + m.b);
  console.log(
    'The reader of replies in a conversation read ' +
      talk.right +
      ' of ' +
      talk.asked +
      ' pairs anyone can judge correctly, taking ' +
      talk.mark +
      ' or more as yes. ' +
      (talk.ok
        ? 'It is believed.'
        : 'Its grades are NOT believed this pass, and replies in a conversation are not compared.'),
  );
  console.log('  by kind: ' + byKind(talk));
  for (const m of talk.missed)
    console.log('  misread (' + (m.kind || (m.same ? 'paraphrase' : 'different')) + '): ' + m.a + ' | ' + m.b);
}
