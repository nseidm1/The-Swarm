// wordings.mjs - THE LARGER MODEL WRITES HOW A QUESTION IS ASKED, IN THE PASS ITSELF. An instrument (src/instruments.mjs) does
// an operation by code where a question IS that operation, and is turned on only where training's own questions got better with
// it. But the questions of such a kind were worded by this repository, and so was the instrument's reading of them: a thing
// kept on wordings its author wrote proves little of wordings anyone else writes. So, before the class stage, the larger model
// is asked for other ways of asking each such kind (step 06-wordings of a pass):
//   1  it is told the task in a sentence, shown one way of asking it with a slot where the data goes, and asked for others, as
//      different from each other as it can make them, each with the slot;
//   2  each one is CHECKED before it is believed: a small example is put through it and the larger model is asked that question
//      as it stands. A wording is kept only where its own answer is the answer the question's maker worked out. One that
//      changed what is asked ("in reverse", "the longest first") is refused there, by the model that wrote it;
//   3  the ones kept are parted: some for the train questions, the others for the held ones. A change is tried on the first and
//      kept on the second, so an instrument is kept on wordings its trying never saw, and that nobody here wrote.
// New ones are written every pass. What the class stage then asks is in training/tasks-exact.mjs (worded).
//   node training/wordings.mjs [--each N] [--dry]        writes <this configuration's work>/wordings.json
// Nothing of a benchmark is read or written here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT } from './tasks-exact.mjs';

// WHAT EACH KIND IS, said once for the larger model; one way of asking it; a small example with its answer, for the check
export const KINDS = {
  sum: {
    task: 'working out the value of an arithmetic expression of whole numbers with +, -, * and brackets',
    way: 'What is ' + SLOT + '?',
    data: '(3 + 4) * 2 - 5',
    want: '9',
    read: (reply) => (String(reply).match(/-?\d+(?:\.\d+)?/g) || []).pop() === '9',
  },
  truth: {
    task: 'saying whether an expression of True, False, not, and, or comes to True or False',
    way: SLOT + ' is',
    data: 'not ( True and False ) or False',
    want: 'True',
    read: (reply) => (String(reply).match(/\b(True|False)\b/gi) || []).pop()?.toLowerCase() === 'true',
  },
  sorted: {
    task: 'putting a list of words into alphabetical order',
    way: 'Sort these words alphabetically: ' + SLOT,
    data: 'pear fig apple',
    want: 'apple fig pear',
    read: (reply) => {
      const flat =
        ' ' +
        String(reply)
          .toLowerCase()
          .replace(/[^a-z]+/g, ' ') +
        ' ';
      const at = ['apple', 'fig', 'pear'].map((w) => flat.lastIndexOf(' ' + w + ' '));
      return (
        at.every((x) => x >= 0) &&
        at[0] < at[1] &&
        at[1] < at[2] &&
        !/pear\W+fig\W+apple\W*$/i.test(String(reply).trim())
      );
    },
  },
  closed: {
    task: 'writing the closing brackets that complete a sequence of brackets, in the right order',
    way: 'Complete this sequence so that every bracket is closed properly: ' + SLOT,
    data: '( [ {',
    want: '} ] )',
    // (the three closers in their order, wherever in the reply it gives them: it may write the whole sequence out and say why)
    read: (reply) =>
      String(reply)
        .replace(/[\s`'",.]/g, '')
        .includes('}])'),
  },
};

// WHO IS ASKING, a different one each time it is asked (by the pass, or the clock): the same request, asked for again in the
// same words, gets the same wordings back, and a pass is to have wordings no pass had
export const VOICES = [
  'a busy colleague typing fast',
  'a careful teacher setting an exercise',
  'someone leaving a note for themselves',
  'a child asking a parent',
  'a manager writing a ticket',
  'a person speaking aloud to an assistant',
  'someone who is not a native speaker of English',
  'a programmer writing a comment for a tool',
  'an examiner writing a test paper',
  'a friend texting',
];
export const askFor = (k, n, voice = '') =>
  'People ask for the same thing in many ways. The thing asked for here is: ' +
  KINDS[k].task +
  '.\n\nHere is one way of asking, with ' +
  SLOT +
  ' where the data goes:\n' +
  KINDS[k].way +
  '\n\nWrite ' +
  n +
  ' other ways a person might ask for exactly this' +
  (voice ? ', as ' + voice + ' would' : '') +
  '. Make them as different from each other as you can: a command, a ' +
  'question, with a label before the data or without one, the data first or last, short or long, plain or polite. Each must ' +
  'hold ' +
  SLOT +
  ' exactly once, where the data goes. Do not change what is asked for: the same task, the same order, the same kind of ' +
  'answer. Write one on each line and nothing else: no numbers, no quotes, no notes.';

// THE WORDINGS IN WHAT IT WROTE: each line that holds the slot once, less a number or a mark before it and quotes round it; not
// the way it was shown, none twice, none too long to be a way of asking
export function wordingsIn(text, shown = '') {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let l = raw
      .trim()
      .replace(/^(?:\d+[.)]|[-*•])\s+/, '')
      .replace(/^["'“`]+|["'”`]+$/g, '')
      .trim();
    if (!l || l.split(SLOT).length !== 2 || l.length > 220 || l.replace(SLOT, '').trim().length < 3) continue;
    // (a line break it wrote as two characters is a line break: a label on a line of its own is a way people ask)
    l = l.replace(/\\n/g, '\n');
    if (l === shown || out.includes(l)) continue;
    out.push(l);
  }
  return out;
}
// the kept ones, parted: one for the train questions, the next for the held ones, in the order they were written
export const parted = (list) => ({
  train: list.filter((_, i) => i % 2 === 0),
  held: list.filter((_, i) => i % 2 === 1),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const B = await import('./support/bench.mjs');
  const each = Number(B.arg('each', 10));
  // (the voice of this asking: named, or the next one each time, by the minute of the clock)
  const turn = Number(B.arg('voice', Math.floor(Date.now() / 60000)));
  const OUT = path.join(B.WORKC, 'wordings.json');
  const say = (x) => console.log(new Date().toTimeString().slice(0, 8) + ' ' + x);
  const record = { at: new Date().toISOString(), by: null, each, kinds: {} };
  const target = await B.openAlone('target');
  record.by = target.label || 'the larger model';
  try {
    for (const k of Object.keys(KINDS)) {
      const voice = VOICES[(turn + Object.keys(KINDS).indexOf(k)) % VOICES.length];
      const wrote = await target.ask([{ role: 'user', content: askFor(k, each, voice) }], { maxTokens: 900 });
      let found = wordingsIn(wrote.text, KINDS[k].way);
      // (none that can be read, as when it answers in a form of its own: asked once more, plainly, with no voice)
      if (!found.length) {
        const again = await target.ask([{ role: 'user', content: askFor(k, each) }], { maxTokens: 900 });
        found = wordingsIn(again.text, KINDS[k].way);
      }
      const kept = [];
      const refused = [];
      for (const w of found) {
        const q = w.replace(SLOT, KINDS[k].data);
        let reply = '';
        try {
          reply = (await target.ask([{ role: 'user', content: q }], { maxTokens: 400 })).text;
        } catch {
          reply = '';
        }
        if (KINDS[k].read(reply)) kept.push(w);
        else refused.push({ wording: w, answered: String(reply).trim().slice(-120) });
      }
      record.kinds[k] = { voice, ...parted(kept), refused };
      say(
        k +
          ': it wrote ' +
          found.length +
          ' wordings; ' +
          kept.length +
          ' kept (its own answer to each was right), ' +
          refused.length +
          ' refused',
      );
    }
  } finally {
    await target.stop();
  }
  if (!B.has('dry')) {
    fs.mkdirSync(B.WORKC, { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');
    say('written: ' + OUT);
  }
  // (a pass goes on with the wordings there are: none at all is no reason to stop it)
  process.exit(0);
}
