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
// THE SAME FOR A REPLY IN A CONVERSATION. Pairs of replies to a person's message that anyone can judge: the same help said two
// ways (it must say they do the same), and replies that do different things: another fact, another recommendation, a question
// back where the other answered, a refusal where the other helped (it must say they differ).
const SETTING =
  'You are Alex, one of a small team of helpers in a group chat with one person. The person is not a developer. You cannot book, buy or send anything for anyone.\n\nYOUR REPLY: open with the answer itself. At most 110 words.';
const DEV_SETTING =
  "You are Robin, an engineer on a small software team, talking in the team's chat with the person whose project it is.\n\nYOUR REPLY: begin with the thing itself, then why. At most 110 words.";
const pair = (system, ask, a, b, same) => ({
  task: { system, turns: [{ role: 'user', content: ask }], ask },
  a,
  b,
  same,
});
export const talkPairs = () => [
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
export async function checkReader({ kev, pairs = knownPairs(), need = 0.8, judge = openEquivalent } = {}) {
  const read = [];
  for (const p of pairs) {
    const g = await judge(p.task || p.ask, p.a, p.b, { kev });
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
  const talk = await checkReader({ kev, pairs: talkPairs(), judge: talkEquivalent });
  fs.writeFileSync(READER_FILE(WORK), JSON.stringify({ at: new Date().toISOString(), ...r, talk }, null, 2));
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
  for (const m of talk.missed)
    console.log(
      '  misread (' + (m.same ? 'the same help, said two ways' : 'two different replies') + '): ' + m.a + ' | ' + m.b,
    );
}
