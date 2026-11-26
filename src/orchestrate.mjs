// orchestrate.mjs - ONE MESSAGE IN, ONE REPLY OUT, AND EVERY SLOT USED ON THE WAY.
// THE WAY IS A FLOW: a list of steps (briefs.json: "flow"), run in order over the answers that stand. It is not fixed. The
// arrangement that brings two small models to parity with a much larger one is found by trying arrangements, and the flow is the
// part of an arrangement that says what happens in what order, how often, and what settles it:
//   draft    several slots answer the question, each told to go about it differently, all at once
//   try      where code is asked for, the answers are run on the same calls: those that do the same are one answer (behave.mjs)
//   expect   where the answers were run: one slot says what each call should give, from the question alone, and the answer that
//            gives it on the most calls is backed
//   check    slots that are shown the different answers and look for what is wrong with them, all at once
//   revise   the answers go back to the slots that wrote them, with the others, where they part and what the checkers said;
//            each gives its answer again
//   decide   which answer stands: the decision model the configuration names (the decider). No slot judges,
//            unless the plan puts one beside it (plan.decideWith). { keep: 2 } does not settle it: it keeps the likeliest
//            two, and the flow goes on with those (so there can be more than one decision)
//   repeat   { steps, upTo }: steps done again while the answers still differ
//   write    one or more slots write the reply a person reads, from what was settled; with more than one, the decider picks.
//            Code goes out as it was settled; and with plan.writeAs 'settled' so does any answer (no slot rewrites it)
// A slot with examples: k is shown, with its brief, the k worked examples of briefs.examples nearest the question: questions like
// it and the answers that were wanted (the larger model's own, to train questions). The trainer gathers them and tries them.
// A step that works on a dispute (check, revise, decide, repeat) is passed over when every answer is the same one. With no flow
// named, it is draft, try, check, decide, write.
// What each slot is told is in briefs.json; this file is the order of things, and what happens when a slot fails (the others
// carry on; if the decider is not there or decides nothing, the answer most slots hold stands; if nothing can be written, the best draft
// is the reply). It knows nothing of servers: `ask(slot, messages)` is handed in, and returns { text } or throws.
//   const { reply, path, trace } = await answer(messages, { briefs, ask });
import { tidy, mannersOn } from './manners.mjs';
import {
  statedOf,
  linesOf,
  factAsk,
  factLine,
  LINES_HEAD,
  FOUND_HEAD,
  FACT_BRIEF,
  LEAST_STATED,
  MOST_FACTS,
} from './breakdown.mjs';
import {
  finalOf as readFinal,
  workOf as readWork,
  plain,
  isCode,
  fenceOf,
  begunOf,
  continuedFrom,
  optionsOf,
  optionOf,
  asksForCode,
  asksForPiece,
  instructsReply,
  MARKER,
  isToolCall,
  letterOf,
  describedNotGiven,
  withoutClosingRemark,
  closingForm,
  setFormOf,
  inSetForm,
  closedAs,
  laidOutAs,
  withoutRestating,
} from './read.mjs';
import { probeBriefFor, expectBriefFor, langOfQuestion, expectedIn, programOf } from './behave.mjs';
import { answerPiece, setsRules, roomFor } from './piece.mjs';
import { instrumentFor } from './instruments.mjs';
import {
  formAnswer,
  formAsk,
  formParams,
  formsOn,
  formsToTry,
  formsWith,
  readingsLeft,
  routeAsk,
  routeIn,
  routeParams,
} from './forms.mjs';
import { writtenFor, writtenOn } from './written.mjs';
import { facetOf, planFor } from './facets.mjs';

// an answer as it is shown to another slot or to the person: code in a block of its own, anything else as it is
const fenced = (final) => (isCode(final) ? '\n```\n' + final + '\n```' : ' ' + final);

// THE SLOT THAT DECIDES BESIDE THE DECIDER (plan.decideWith) is told this, where the plan gives it nothing of its own
export const JUDGE_BRIEF =
  'You are shown a question and different answers to it, each with its working. Decide which one is correct. Put each final ' +
  'answer back into the question and check it; for code, think of the awkward inputs; look for the slip in the working. Do ' +
  'not count how many answers agree. Be brief. End with one last line and nothing after it: ANSWER: then only the letter of ' +
  'the correct answer.';
// how the matter is settled (plan.decideBy): 'decider' where nothing is said; the names from when Kev was the only decider are
// read as the same
export const decideByOf = (v) => String(v || 'decider');
// DOES A TEXT SAY BACK WHAT ITS WRITER WAS TOLD? True where it holds a run of `run` words in a row that the instructions
// hold too, case and punctuation aside. Eight words in a row are not said by chance.
export function saysBack(text, told, run = 8) {
  const w = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = w(text);
  const b = ' ' + w(told).join(' ') + ' ';
  for (let i = 0; i + run <= a.length; i++) if (b.includes(' ' + a.slice(i, i + run).join(' ') + ' ')) return true;
  return false;
}

// THE SLOTS THAT DRAFT FIRST (plan.draftFirst: n), or null where every drafting slot drafts at once: n of them where n is a
// whole number from 2 to one fewer than there are; in order, the first slot of each member, then the rest in order until n
export function firstDrafters(slots, n) {
  if (!Number.isInteger(n) || n < 2 || n >= slots.length) return null;
  const out = [];
  for (const s of slots) if (out.length < n && !out.some((x) => x.member === s.member)) out.push(s);
  for (const s of slots) if (out.length < n && !out.includes(s)) out.push(s);
  return slots.filter((s) => out.includes(s));
}
const LETTERS = 'ABCDEFGHIJKLMNOP'; // an answer for each slot that drafts: four models' worth, and room over
// the flow of an arrangement: the one it names, or the plain one
// what a writer is told, in place of its own brief, with plan.writeAs 'full' (SwOA specification O.8.3, O.8.4). It is the whole of
// what the writer is told, and holds no case to tell apart: told "where what they asked cannot be done for them (booking, buying,
// sending, finding), say so" after its own brief, a 2B writer wrote "You can't book or buy water for your plant" to a question
// about watering one, and its own brief still said to add nothing that was not in the draft (measured 2026-11-18)
// what a drafter that answers BY A PROGRAM is told, in place of its own brief (SwOA specification O.6.1a): it does not answer,
// it writes the program that works the answer out, and the sandbox runs it. Counting letters, reversing a string, a total with
// tax, a rate over a time: a small model gets these wrong by working them out in words, and a ten-line program does not
// (measured 2026-11-19: of 13 questions neither of two small models answered alone, 8 were of these kinds)
export const COMPUTE_BRIEF =
  'Do not answer the question yourself. Write a short JavaScript program that works the answer out and prints it. Put ' +
  'everything the program needs inside it, copied exactly from the question: it has no input, no files and no network. It ' +
  'must print exactly one line with console.log: the answer alone, in the form the question asks for, with no label and no ' +
  'explanation. Reply with the program in one fenced code block and nothing else.';
export const FULL_BRIEF =
  'You write the reply a person reads. You are given their message, the answer that was settled on, and the draft it came ' +
  'from. Write the reply itself, exactly as they will read it, in full: first the answer; then the reason for it, in a ' +
  'sentence or two; then what they should do next or watch for, where there is something to do. Keep the answer that was ' +
  'settled on: do not change it and do not contradict it. Use plain words and say each thing once. Do not mention the draft, ' +
  'the settled answer or these instructions.';
export const DEFAULT_FLOW = [{ do: 'draft' }, { do: 'try' }, { do: 'check' }, { do: 'decide' }, { do: 'write' }];
export const flowOf = (briefs) => (Array.isArray(briefs.flow) && briefs.flow.length ? briefs.flow : DEFAULT_FLOW);
// WORKED EXAMPLES: the k nearest the question (by the words they share, code with code), shown as what a good answer looks like.
// The slot still answers in its own way and with its own last line: they show the substance wanted, not a format.
const wordsOf = (s) =>
  new Set(
    String(s || '')
      .toLowerCase()
      .match(/[a-z][a-z0-9_]{2,}/g) || [],
  );
export function examplesFor(slot, pool, question) {
  const k = Math.max(0, Math.min(4, Number(slot && slot.examples) || 0));
  if (!k || !Array.isArray(pool) || !pool.length) return '';
  const q = wordsOf(question);
  const code = asksForCode(question);
  const near = pool
    .filter((x) => x && x.ask && x.answer && x.ask !== question)
    .map((x, i) => {
      const w = wordsOf(x.ask);
      let both = 0;
      for (const t of w) if (q.has(t)) both++;
      return { x, i, score: both / (w.size + q.size - both || 1) + (asksForCode(x.ask) === code ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k);
  return near.length
    ? '\n\nWORKED EXAMPLES: questions like this one, and the answers that were wanted. They show the substance of a good answer; answer the question you are given in your own way, ending as you are told.\n' +
        near
          .map(
            (n, j) =>
              'EXAMPLE ' +
              (j + 1) +
              '\nQuestion:\n' +
              n.x.ask.slice(0, 1500) +
              '\nAnswer wanted:\n' +
              n.x.answer.slice(0, 1800),
          )
          .join('\n\n')
    : '';
}
const said = (m) =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p) => (p && p.type === 'text' ? p.text : '')).join('')
      : '';

// THE KIND OF A QUESTION, as the swarm can tell it from the question alone: code is asked for, or it is not. An arrangement may
// differ by kind (briefs.kinds[kind]: its own slots and plan), kept where a change that brings one kind to parity loses only
// questions of the other (training/loop.mjs). The question's kind picks the arrangement before anything is asked
export const kindOf = (question) => (asksForCode(String(question || '')) ? 'code' : 'words');
// THE CLASS OF AN INPUT: what the arrangement is chosen by (briefs.kinds[class]), decided from the request alone, with no model asked,
// so that training and the running swarm always sort an input the same way (docs/swoa-classes.md):
//   tools   the request offers tools
//   talk    the conversation already has a reply of the swarm's in it
//   code    code is asked for (kindOf)
//   words   anything else
// A class with no arrangement of its own is answered with the shared one (briefsFor).
export const CLASSES = ['tools', 'talk', 'code', 'words'];
// what a drafter whose answer is none of the options is told, where the question lists options
export const OPTION_AGAIN =
  'That is not one of the options. The answer is one of the options listed. Which one is closest to your work? End with one last line that starts with ANSWER: and holds only its letter.';
// what a drafter that answered in words is told, where code was asked for
export const CODE_AGAIN =
  'That says what the code should do. Now give the code itself: the whole of it, in one code block, and nothing after it.';
export function classOf(messages = [], { tools = null } = {}) {
  if (Array.isArray(tools) && tools.length) return 'tools';
  // (a reply already begun is not a turn of the conversation: it is the start of the answer to it)
  if (begunOf(messages)) messages = messages.slice(0, -1);
  const ms = (Array.isArray(messages) ? messages : []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant'),
  );
  if (ms.some((m) => m.role === 'assistant')) return 'talk';
  const last = [...ms].reverse().find((m) => m.role === 'user');
  return kindOf(last ? said(last) : '');
}
// what a kind's own arrangement holds: what a change can alter (its slots, its plan, its flow)
export const KIND_PARTS = ['slots', 'plan', 'flow'];
export function briefsFor(briefs, question, kind = kindOf(question)) {
  const k = briefs && briefs.kinds && briefs.kinds[kind];
  if (!k) return briefs;
  const out = { ...briefs };
  for (const part of KIND_PARTS) if (part in k) out[part] = k[part];
  return out;
}

// ---- AN INPUT TOO LONG FOR A SLOT IS READ IN PARTS (SwOA specification O.13) ----
// A slot holds a few thousand tokens, and a request longer than that fits no drafter: the swarm replied with nothing (measured
// 2026-11-20, one fact asked for out of a document: 5 of 5 at 1000 and 3000 tokens, 0 of 5 at 6000 and 12000, where the larger
// model had 5 of 5 throughout). The context is not made larger, which every slot of every model would pay for in memory. The
// text is cut into parts that fit, each part is read by one drafter for what it says on the question, the parts side by side,
// and the question is then answered as any other is, over what the parts gave (the same measurement, read so: 20 of 20).
export const PART_BRIEF =
  'You are shown ONE PART of a longer text, and a question about the whole text. Copy out, word for word, the sentence or sentences of this part that answer the question or bear on it: each on its own line, at most four, and nothing else. Do not answer the question and do not add words of your own. If no sentence of this part bears on the question, answer exactly: NOT HERE.';
export const NOT_HERE = /^\W*not here\W*$/i;
export const SPLIT_OVER = 8000; // characters of a request's last message past which it is read in parts
export const PART_CHARS = 6000; // the most characters of the text a part holds
// WHAT A READER WROTE IS KEPT ONLY AS THE PART'S OWN WORDS. A small model asked what a part says will say what was asked for
// whether the part says it or not (measured 2026-11-20: one model of three, reading parts of a register, gave the town asked
// about with a length that belonged to another town in 9 parts of 20 questions, and the swarm then settled on it: 4 of 15
// right). So each line a reader wrote is traced to the sentence of the part it comes from, and that sentence is what is kept:
// a line that is in a sentence or holds one, else the one sentence that has four fifths of the line's words. A line from no
// sentence of the part is dropped. At most `most` sentences a part.
const wordsIn = (t) =>
  String(t)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
export function groundedIn(reply, part, most = 4) {
  const units = String(part || '')
    .split('\n')
    .flatMap((l) => (l.length > 400 ? l.split(/(?<=[.!?])\s+/) : [l]))
    .map((u) => u.trim())
    .filter(Boolean);
  const flat = units.map((u) => wordsIn(u).join(' '));
  const out = [];
  for (const line of String(reply || '').split('\n')) {
    const w = wordsIn(line);
    if (!w.length) continue;
    const l = w.join(' ');
    let hits = units.filter(
      (_, i) =>
        (' ' + flat[i] + ' ').includes(' ' + l + ' ') ||
        (flat[i].length >= 20 && (' ' + l + ' ').includes(' ' + flat[i] + ' ')),
    );
    if (!hits.length && new Set(w).size >= 4) {
      const mine = [...new Set(w)];
      const scored = units
        .map((u, i) => ({
          u,
          share: mine.filter((x) => (' ' + flat[i] + ' ').includes(' ' + x + ' ')).length / mine.length,
        }))
        .sort((x, y) => y.share - x.share);
      if (scored[0] && scored[0].share >= 0.8 && (!scored[1] || scored[1].share < scored[0].share))
        hits = [scored[0].u];
    }
    // (a line found in many sentences says nothing of which one: a bare number that several hold, a common word)
    if (hits.length > 3) continue;
    for (const h of hits) if (!out.includes(h) && out.length < most) out.push(h);
  }
  return out;
}
// what a long message asks, and the text it asks it of: { head, text, ask }, or null where no question can be told from the text.
// The question is the message's last block where that is short, else its last line; a short first block is the text's lead-in.
export function askOf(message, most = 600) {
  const all = String(message || '').trim();
  const lastBlock = all.slice(all.lastIndexOf('\n\n') + 2);
  const lastLine = all.slice(all.lastIndexOf('\n') + 1);
  const ask =
    all.includes('\n\n') && lastBlock.trim().length <= most ? lastBlock : lastLine.length <= most ? lastLine : '';
  if (!ask.trim() || ask.length === all.length) return null;
  let text = all.slice(0, all.length - ask.length).trim();
  const firstEnd = text.indexOf('\n\n');
  const head = firstEnd > 0 && firstEnd <= 300 ? text.slice(0, firstEnd).trim() : '';
  if (head) text = text.slice(firstEnd).trim();
  return text ? { head, text, ask: ask.trim() } : null;
}
// a text cut into parts of at most `most` characters, at its line ends; a line longer than a part at a sentence's end or a space
export function partsOf(text, most = PART_CHARS) {
  const out = [];
  let cur = '';
  const put = (piece) => {
    if (cur && cur.length + piece.length + 1 > most) (out.push(cur), (cur = ''));
    cur += (cur ? '\n' : '') + piece;
  };
  for (let line of String(text || '').split('\n')) {
    while (line.length > most) {
      const within = line.slice(0, most);
      const at = Math.max(within.lastIndexOf('. ') + 1, within.lastIndexOf(' '));
      const cut = at > most / 2 ? at : most;
      put(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    put(line);
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// A REPLY ALREADY BEGUN (a conversation that ends with the assistant's own turn): the conversation before it is answered, and
// the reply is what follows the start (read.mjs continuedFrom). Measured 2026-11-22: a benchmark gives the head of a function
// as the start of the reply and reads what follows as its body; the start was taken for the question and answered in words.
export async function answer(messages, opts) {
  const begun = begunOf(messages);
  if (!begun) return tidied(inFormSet(await answerAsked(messages, opts), messages, opts), messages, opts);
  const got = await answerAsked(messages.slice(0, -1), opts);
  const reply = continuedFrom(begun, got.reply, got.decided);
  return { ...got, reply, begun: true, path: reply !== got.reply ? got.path + '+continued' : got.path };
}
// THE REPLY IS TIDIED BY CODE (manners.mjs; plan.manners: the fixes turned on; O.8.9): an opening that only praises, a closing
// that only offers more help, a sentence said again, a greeting given twice. Never code, never a reply begun by the caller,
// never a turn that calls a tool.
function tidied(got, messages, opts) {
  const plan = planFor((briefsFor(opts.briefs, '', classOf(messages)) || {}).plan || {}, facetOf(messages));
  if (!mannersOn(plan.manners).length || !got || !got.ok || !got.reply || got.tool_calls) return got;
  if (isCode(got.decided || got.reply)) return got;
  const reply = tidy(got.reply, plan.manners, { messages });
  return reply === got.reply ? got : { ...got, reply, path: got.path + '+manners' };
}
// THE REPLY IS WRITTEN IN THE FORM THE SYSTEM TEXT SETS (read.mjs setFormOf; plan.setForm: false leaves it; O.8.8): where the
// conversation's system text gives the reply's form as a template of two keys, what was settled is written into it by code.
// Not code, and not a reply already begun (that one follows what was begun)
function inFormSet(got, messages, opts) {
  const plan = planFor((briefsFor(opts.briefs, '', classOf(messages)) || {}).plan || {}, facetOf(messages));
  if (plan.setForm === false || !got || !got.ok || !got.reply || isCode(got.decided || got.reply)) return got;
  const form = setFormOf(messages);
  if (!form) return got;
  const reply = inSetForm(got.reply, got.decided, form);
  return reply === got.reply ? got : { ...got, reply, path: got.path + '+form' };
}
async function answerAsked(messages, opts) {
  const mine = briefsFor(opts.briefs, '', classOf(messages)) || {};
  const plan = mine.plan || {};
  const lastAt = messages.map((m) => m.role).lastIndexOf('user');
  const whole = lastAt >= 0 ? said(messages[lastAt]) : '';
  const over = plan.splitOver || SPLIT_OVER;
  const found = plan.split !== 'off' && whole.length > over ? askOf(whole) : null;
  const readers = found ? (mine.slots || []).filter((s) => s.stage === 'draft' && !s.compute) : [];
  if (!found || !readers.length) return answerWhole(messages, opts);
  const t0 = Date.now();
  const parts = partsOf(found.text, plan.partChars || PART_CHARS);
  const rows = [];
  // EACH PART IS READ BY TWO DRAFTERS, of different models where there are two (plan.partReaders): what either copied out that
  // is the part's own is kept. A reader that misses the sentence asked for costs the answer, and the other model seldom misses
  // the same one (measured 2026-11-20 with one reader a part: 18 of 20, both lost where one model copied out other sentences
  // of the part that held the answer). As many calls at a time as there are drafters.
  const per = Math.max(1, Math.min(readers.length, plan.partReaders || 2));
  const jobs = [];
  for (let n = 0; n < parts.length; n++) {
    const first = readers[n % readers.length];
    const rest = readers.filter((r) => r !== first);
    const others = [...rest.filter((r) => r.member !== first.member), ...rest.filter((r) => r.member === first.member)];
    // (the others turn about too, so that no one model reads every part twice)
    const turned = others.length ? others.map((_, k) => others[(k + n) % others.length]) : [];
    for (const reader of [first, ...turned].slice(0, per)) jobs.push({ n, reader });
  }
  const read = async ({ n, reader }) => {
    const part = parts[n];
    const slot = { ...reader, stage: 'part', maxTokens: 300 };
    const at = Date.now();
    const row = {
      slot: slot.id,
      member: slot.member,
      stage: 'part',
      part: n + 1,
      of: parts.length,
      ms: 0,
      out: '',
      final: '',
      ok: false,
    };
    (opts.onStart || (() => {}))({ slot: slot.id, member: slot.member, stage: 'part' });
    try {
      const r = await opts.ask(slot, [
        { role: 'system', content: PART_BRIEF },
        {
          role: 'user',
          content:
            (found.head ? found.head + '\n\n' : '') +
            'Part ' +
            (n + 1) +
            ' of ' +
            parts.length +
            ':\n' +
            part +
            '\n\nThe question: ' +
            found.ask,
        },
      ]);
      row.out = String((r && r.text) || '').trim();
      if (r && r.tokens) row.tokens = r.tokens;
      row.ok = !!row.out;
      row.final = row.ok && !NOT_HERE.test(row.out) ? groundedIn(row.out, part).join('\n').slice(0, 800) : '';
      if (row.ok && !NOT_HERE.test(row.out) && !row.final) row.ungrounded = true;
    } catch (e) {
      row.out = 'Failed: ' + String((e && e.message) || e).slice(0, 160);
    }
    row.ms = Date.now() - at;
    (opts.onStep || (() => {}))(row);
    return row;
  };
  for (let i = 0; i < jobs.length; i += readers.length)
    rows.push(...(await Promise.all(jobs.slice(i, i + readers.length).map(read))));
  // what a part gave: the sentences its readers copied out, each once, in the order they were first given
  const gave = parts
    .map((_, n) => ({
      part: n + 1,
      final: [...new Set(rows.filter((r) => r.part === n + 1 && r.final).flatMap((r) => r.final.split('\n')))].join(
        '\n',
      ),
    }))
    .filter((g) => g.final);
  // (what the parts gave must itself fit a slot: each is cut alike where together they would not)
  const each = Math.max(120, Math.floor((over - 400) / Math.max(1, gave.length)));
  const notes = gave.length
    ? 'A longer text was read in ' +
      parts.length +
      ' parts. What its parts say on the question (a part that said nothing is left out):\n' +
      gave.map((r) => '- Part ' + r.part + ': ' + r.final.slice(0, each).replace(/\s*\n\s*/g, ' ')).join('\n')
    : 'A longer text was read in ' +
      parts.length +
      ' parts, and no part of it says anything that bears on the question.';
  const shown = messages.map((m, i) =>
    i === lastAt ? { ...m, content: (found.head ? found.head + '\n\n' : '') + notes + '\n\n' + found.ask } : m,
  );
  const got = await answerWhole(shown, opts);
  return {
    ...got,
    path: got.path + '+split',
    ms: Date.now() - t0,
    trace: [...rows, ...got.trace],
    parts: parts.length,
    partsGave: gave.length,
  };
}

async function answerWhole(
  messages,
  {
    briefs: given,
    ask,
    decide = null,
    behave = null,
    print = null,
    // the module has no decision model (its decider is `none`): where the drafts differ a slot decides, whatever the plan names
    // beside the decider (SwOA specification O.6.6, WITH)
    modelDecides = false,
    onStep = () => {},
    onStart = () => {},
    others = [],
  },
) {
  const t0 = Date.now();
  const marker = given.marker || MARKER;
  const trace = [];
  // the conversation a slot is shown: what the person's own program set as the system line, and the last turns
  const talk = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: said(m) }));
  const kept = talk.slice(-((given.plan || {}).keepTurns || 6));
  const question = kept.length ? kept[kept.length - 1].content : '';
  const briefs = briefsFor(given, question, classOf(messages));
  // WHAT WAS KEPT FOR THIS KIND OF REQUEST ALONE is laid over the class's plan (facets.mjs: a turn that asks nothing, one
  // asking for code inside a conversation, one after the person said how to answer; plan.for). Most requests are none of
  // these, and their plan is the class's
  const plan = planFor(briefs.plan || {}, facetOf(messages));
  const stage = (name) => briefs.slots.filter((s) => s.stage === name);
  // (a drafter that answers by a program is asked with the first drafters, and has no vote, where the plan gives its answer
  // any of three uses: a figure of it stands, it fills where the slots settle nothing, or its differing asks the others)
  const programFirst = !!(plan.computedStands || plan.computedFills || plan.computedDoubts);
  // where code is asked for, the code a slot wrote is its answer, whatever it wrote after it
  const wantsCode = asksForCode(question);
  const finalOf = (text, m) => readFinal(text, m, wantsCode);
  const workOf = (text, m) => readWork(text, m, wantsCode);
  const house = messages
    .filter((m) => m.role === 'system')
    .map(said)
    .join('\n')
    .trim();
  // WHAT CODE DOES EXACTLY, CODE DOES (instruments.mjs; plan.instruments: the ones training turned on): where the question IS an operation
  // (a sum, an expression of true and false, words to put in order, brackets to close) it is done by code, and what that
  // gives is the answer. No model is asked. The reply closes as the earlier replies do, where they show a form
  if (!wantsCode && plan.instruments) {
    const it = instrumentFor(question, plan.instruments);
    if (it) {
      const form = plan.closeAs === 'shown' ? closingForm(talk.slice(0, -1)) : null;
      const reply = form ? closedAs('', it.answer, form, question) : it.answer;
      const row = {
        slot: 'instrument',
        member: 'code',
        stage: 'run',
        ms: Date.now() - t0,
        out: 'The question is ' + it.name + ', by code.',
        final: it.answer,
        ok: true,
        instrument: it.id,
      };
      onStart({ slot: 'instrument', member: 'code', stage: 'run' });
      onStep(row);
      return {
        reply: reply || it.answer,
        decided: it.answer,
        path: 'instrument',
        ms: Date.now() - t0,
        trace: [row],
        ok: true,
        tried: null,
        instrument: it.id,
      };
    }
  }
  // CODE TRAINING WROTE (written.mjs; plan.written: the functions training kept for this class). Asked after the instruments
  // and before any model: a function that reads the whole of what it needs gives the answer, and one that does not gives
  // nothing and the question goes on as it would have. It runs where it can reach nothing (sandbox.mjs)
  if (!wantsCode && writtenOn(plan.written).length) {
    const it = await writtenFor(question, plan.written);
    if (it) {
      const form = plan.closeAs === 'shown' ? closingForm(talk.slice(0, -1)) : null;
      const reply = form ? closedAs('', it.answer, form, question) : it.answer;
      const row = {
        slot: 'written',
        member: 'code',
        stage: 'run',
        ms: Date.now() - t0,
        out: 'The question is ' + it.name + '.',
        final: it.answer,
        ok: true,
        written: it.id,
      };
      onStart({ slot: 'written', member: 'code', stage: 'run' });
      onStep(row);
      return {
        reply: reply || it.answer,
        decided: it.answer,
        path: 'written',
        ms: Date.now() - t0,
        trace: [row],
        ok: true,
        tried: null,
        written: it.id,
      };
    }
  }
  // A MODEL READS, CODE WORKS IT OUT (forms.mjs; plan.read: the forms training turned on, or true). An instrument reads a
  // question by its wording; this reads it by a model. One drafter says which form the question is of, if any. Where it is
  // one, the drafters each write what the question says into that form (the reply held to the form's schema where the
  // engine can), code works each form out, and the answer stands only where at least plan.readLeast of them (2) came to it
  // and none came to another. Otherwise the question goes on as it would have, the cost being the calls made.
  // (plan.readings: the kinds training laid onto a form for this class; they are read with the forms, as one table)
  const forms = formsWith(plan.readings);
  // (which of the module's own forms are on; none where the plan names none: a reading alone turns none of them on)
  const formsAsked = plan.read === true ? true : Array.isArray(plan.read) ? plan.read : [];
  if (!wantsCode && formsOn(formsAsked, forms).length) {
    const readers = stage('draft').filter((s) => !s.compute);
    const said = async (slot, id, messages, extra) => {
      const at = Date.now();
      const row = { slot: id, member: slot.member, stage: 'read', ms: 0, out: '', final: '', ok: false };
      onStart({ slot: id, member: slot.member, stage: 'read' });
      try {
        const r = await ask({ ...slot, id, stage: 'read', ...extra.slot }, messages, extra.params);
        row.out = String((r && r.text) || '').trim();
        row.ok = !!row.out;
        if (r && r.tokens) row.tokens = r.tokens;
      } catch (e) {
        row.why = String((e && e.message) || e).slice(0, 200);
      }
      row.ms = Date.now() - at;
      return row;
    };
    if (readers.length) {
      const first = await said(readers[0], readers[0].id + '-kind', routeAsk(question, formsAsked, forms), {
        slot: { maxTokens: 120, temperature: 0 },
        params: routeParams(formsAsked, forms),
      });
      const named = routeIn(first.out, formsAsked, forms);
      first.final = named || '';
      onStep(first);
      trace.push(first); // (what was asked on the way is on the record, whatever answers in the end)
      // (the form it named, then the ones the question's words point to and the ones often taken for it: forms.mjs)
      for (const id of formsToTry(question, named, formsAsked, forms)) {
        const many = Math.max(1, Number(plan.readBy) || 3);
        const least = Math.min(many, Math.max(1, Number(plan.readLeast) || 2));
        const reading = (n) => {
          const slot = readers[n % readers.length];
          // (the first reading is the likeliest one; the others are drawn, so that agreement means something)
          return said(slot, slot.id + '-read' + (n < readers.length ? '' : '-' + n), formAsk(id, question, forms), {
            slot: { maxTokens: 700, temperature: n === 0 ? 0 : 0.7 },
            params: formParams(id, forms),
          });
        };
        // AS MANY AS HAVE TO AGREE ARE ASKED FIRST, together; the rest only where they could still settle it (forms.mjs
        // readingsLeft): two that agree need no third, and two that both read nothing cannot be mended by one more
        const rows = await Promise.all(Array.from({ length: least }, (_, n) => reading(n)));
        const more = readingsLeft(
          id,
          question,
          rows.map((r) => r.out),
          many,
          least,
          forms,
        );
        if (more > 0) rows.push(...(await Promise.all(Array.from({ length: more }, (_, n) => reading(least + n)))));
        const got = formAnswer(
          id,
          question,
          rows.map((r) => r.out),
          least,
          forms,
        );
        for (const r of rows) (onStep(r), trace.push(r));
        if (got) {
          const form = plan.closeAs === 'shown' ? closingForm(talk.slice(0, -1)) : null;
          const reply = form ? closedAs('', got.answer, form, question) : got.answer;
          const row = {
            slot: 'read',
            member: 'code',
            stage: 'run',
            ms: Date.now() - t0,
            out:
              'The question was read as one ' +
              forms[id].label +
              ', by ' +
              got.agreed +
              ' of ' +
              got.of +
              ', and worked out by code.',
            final: got.answer,
            ok: true,
            form: id,
          };
          onStart({ slot: 'read', member: 'code', stage: 'run' });
          onStep(row);
          return {
            reply: reply || got.answer,
            decided: got.answer,
            path: 'read',
            ms: Date.now() - t0,
            trace: [...trace, row],
            ok: true,
            tried: null,
            form: id,
          };
        }
      }
    }
  }
  // ONE MODEL, ASKED AS THE REQUEST CAME (plan.plain: true, every request of the class; plan.pieceBy: 'plain', a request for a
  // piece of writing: one that sets countable rules or asks for a piece. SwOA specification R.5.0). The first drafter is sent
  // the conversation as it came, with no brief of the module's, and its reply is the reply, laid out as the conversation
  // shows. Neither is on as a module starts: on some kinds of request a small model by itself does as well as the module
  // built of it, or better (measured 2026-11-22, following instructions, 100 questions: 75 right by itself, 66 to 68 in
  // the module), and which kinds those are is training's to find and keep, so that a module does no worse than its model.
  // Where the slot gives nothing, or a call, the request goes on as it would have.
  if (
    plan.plain === true ||
    (plan.pieceBy === 'plain' &&
      !wantsCode &&
      (setsRules(question) || asksForPiece(question) || instructsReply(question)))
  ) {
    const slot = stage('draft').find((s) => !s.compute);
    if (slot) {
      const at = Date.now();
      const row = {
        slot: slot.id,
        member: slot.member,
        stage: 'draft',
        ms: 0,
        out: '',
        final: '',
        ok: false,
        plain: true,
      };
      onStart({ slot: slot.id, member: slot.member, stage: 'draft' });
      try {
        const r = await ask({ ...slot, maxTokens: Math.max(roomFor(question), Number(slot.maxTokens) || 0) }, [
          ...(house ? [{ role: 'system', content: house }] : []),
          ...kept,
        ]);
        row.out = String((r && r.text) || '').trim();
        row.ok = !!row.out && !isToolCall(row.out);
        if (r && r.tokens) row.tokens = r.tokens;
      } catch (e) {
        row.why = String((e && e.message) || e).slice(0, 200);
      }
      row.final = row.ok ? row.out : '';
      row.ms = Date.now() - at;
      onStep(row);
      if (row.ok) {
        const reply = laidOutAs(withoutRestating(row.out, question), kept);
        // (what it settled on is what it stated as its answer, where it stated one so; else the reply itself)
        row.final = finalOf(row.out, marker) || reply;
        return { reply, decided: row.final, path: 'plain', ms: Date.now() - t0, trace: [row], ok: true, tried: null };
      }
    }
  }
  // A REPLY THE REQUEST SETS COUNTABLE RULES ON IS WRITTEN WHOLE (piece.mjs; plan.piece: false leaves it): so many words, no
  // comma, every letter a capital, parts with labels. Only a reply written whole can keep such a rule, and a short answer to
  // agree on is not what was asked for. The first drafters each write it, each is measured against the rules by counting,
  // and the one that keeps the most goes out
  if (!wantsCode && plan.piece !== false && setsRules(question)) {
    const drafters = stage('draft').filter((s) => !s.compute);
    const first = firstDrafters(drafters, plan.draftFirst) || drafters.slice(0, 2);
    if (first.length)
      return answerPiece({
        question,
        kept,
        house,
        slots: first,
        plain: plan.piecePlain !== false,
        ask,
        onStep,
        onStart,
        isToolCall,
        t0,
      });
  }
  // A DRAFTER THAT ANSWERS BY A PROGRAM (slot.compute, O.6.1a): only where no code is asked for and a program can be run here;
  // anywhere else the slot is left out of the step
  const computing = (slot) => !!slot.compute && slot.stage === 'draft' && !wantsCode && !!print;
  const NO_TOOLS = ' You have no tools: write your answer as plain text, and any code inside a fenced code block.';
  const sys = (slot) => ({
    role: 'system',
    content:
      (computing(slot) ? COMPUTE_BRIEF : slot.brief) +
      NO_TOOLS +
      examplesFor(slot, briefs.examples, question) +
      (house ? '\n\nThe person set this for the conversation:\n' + house : ''),
  });

  const run = async (slot, msgs) => {
    const at = Date.now();
    const row = { slot: slot.id, member: slot.member, stage: slot.stage, ms: 0, out: '', final: '', ok: false };
    onStart({ slot: slot.id, member: slot.member, stage: slot.stage });
    try {
      const r = await ask(slot, msgs);
      row.out = String((r && r.text) || '');
      row.final = slot.stage === 'write' ? '' : finalOf(row.out, marker);
      // a reply that is a call to a tool is not what the writer was asked for; a checker may answer with a letter alone
      if (slot.stage === 'probe' || slot.stage === 'expect' || slot.stage === 'judge' || slot.stage === 'prepare')
        row.final = '';
      row.ok =
        slot.stage === 'write' || slot.stage === 'probe' || slot.stage === 'expect' || slot.stage === 'prepare'
          ? row.out.trim().length > 0 && !isToolCall(row.out)
          : slot.stage === 'judge'
            ? !!letterOf(row.out, marker, LETTERS)
            : !!row.final || (slot.stage === 'check' && !!letterOf(row.out, marker, LETTERS));
      // AN ANSWER THAT SAYS ITS INSTRUCTIONS BACK IS NO ANSWER (O.6.1d): where what a drafting or checking slot gave as its
      // answer repeats a run of eight words of what it was told, it has answered nothing, and has no vote
      if (
        (slot.stage === 'draft' || slot.stage === 'check') &&
        row.final &&
        saysBack(row.final, (msgs[0] || {}).content)
      ) {
        row.final = '';
        row.ok = false;
        row.why = 'said its instructions back';
      }
      if (r && r.tokens) row.tokens = r.tokens;
      // ITS PROGRAM IS RUN, and what it printed is its answer (at most 400 characters); a program that does not run, or prints
      // nothing, leaves the slot without an answer, and it is not asked again
      if (computing(slot)) {
        const code = isToolCall(row.out) ? '' : readFinal(row.out, marker, true);
        let p = null;
        try {
          p = code ? await print(code) : null;
        } catch {
          p = null;
        }
        const text = p && p.text && p.text.length <= 400 ? p.text : '';
        row.computed = !!text;
        row.final = text;
        row.ok = !!text;
        row.out += text
          ? '\n\n(Ran its program: it printed ' + text + ')\n' + marker + ' ' + text
          : '\n\n(Its program could not be run, or printed nothing.)';
      }
    } catch (e) {
      row.why = String((e && e.message) || e).slice(0, 200);
    }
    row.ms = Date.now() - at;
    trace.push(row);
    onStep(row);
    return row;
  };
  const all = (slots, msgsOf) => Promise.all(slots.map((s) => run(s, msgsOf(s))));
  // A SLOT THAT RAN OUT OF ROOM BEFORE IT ANSWERED IS ASKED FOR ITS ANSWER. It has done the work (it was cut off testing its own
  // answer, or going round again); what is missing is the last line. Asked once, on the same slot, with the end of what it wrote.
  const askAgain = async (row, slot, msgs) => {
    if (row.ok || row.why || !row.out.trim() || isToolCall(row.out) || row.computed !== undefined) return;
    const at = Date.now();
    // A SLOT CUT OFF IN THE MIDDLE OF ITS WORK GOES ON, ONCE (plan.goOn). Asked for its answer in one line, it has forty
    // words to give one it had not reached: a guess. On 10 of 29 plain questions answered wrongly some drafter had no
    // answer at all, cut off part way through a chain of who tells the truth or a row of books (measured 2026-11-25).
    // With this on it is first given its room again to finish what it began; only then asked for the one line.
    if (plan.goOn && !wantsCode) {
      try {
        const r = await ask({ ...slot, temperature: 0 }, [
          ...msgs,
          { role: 'assistant', content: row.out.slice(-3000) },
          {
            role: 'user',
            content:
              'You ran out of room. Go on from exactly where you stopped and finish the work. Do not start again. End with one line: ' +
              marker +
              ' and your answer.',
          },
        ]);
        const text = String((r && r.text) || '');
        const final = finalOf(text, marker);
        if (text.trim() && !isToolCall(text)) row.out += '\n\n(Went on.)\n' + text.trim();
        if (final && !isToolCall(text)) {
          row.final = final;
          row.ok = true;
          row.wentOn = true;
          row.ms += Date.now() - at;
          onStep(row);
          return;
        }
      } catch {
        /* asked for its answer in one line, as before */
      }
    }
    try {
      const r = await ask({ ...slot, maxTokens: wantsCode ? 420 : 40, temperature: 0 }, [
        ...msgs,
        { role: 'assistant', content: row.out.slice(-1500) },
        {
          role: 'user',
          content: wantsCode
            ? 'You ran out of room. Do not explain or test any more. Give your final answer now and nothing else: the whole of the code, in one code block.'
            : 'You ran out of room. Do not explain any more. Write one line and nothing else: ' +
              marker +
              ' and your answer.',
        },
      ]);
      const text = String((r && r.text) || '');
      const final = finalOf(text, marker);
      if (final && !isToolCall(text)) {
        row.out += '\n\n(Asked for its answer.)\n' + text.trim();
        row.final = final;
        row.ok = true;
        row.concluded = true;
        row.ms += Date.now() - at;
        onStep(row);
      }
    } catch {
      /* it stays without an answer */
    }
  };

  // ================================================================ THE FLOW
  // What is known as the steps run. pool: the answers standing (one for each slot that has answered, its latest). remarks: what
  // the checkers of the latest check said. backers: slots that named an answer without writing one (checkers).
  const byId = Object.fromEntries(briefs.slots.map((s) => [s.id, s]));
  const slotsOf = (step, dflt) =>
    step.slots ? step.slots.map((id) => byId[id]).filter(Boolean) : dflt ? stage(dflt) : [];
  // (a drafter that answers by a program drafts only where it can: computing, above)
  const drafting = (step) => slotsOf(step, 'draft').filter((s) => !s.compute || computing(s));
  const S = {
    pool: [],
    backers: [],
    remarks: [],
    parted: '',
    decided: '',
    path: '',
    tried: null,
    probe: null,
    disputed: false,
  };
  const byBehaviour = wantsCode && !!behave && plan.byBehaviour !== false;
  // two answers are the same answer when they do the same (where they were run), or read the same (where they were not)
  // (and where the question lists lettered options, an option's letter and its words are the same answer)
  const OPTIONS = wantsCode ? [] : optionsOf(question);
  const optOf = (x) => optionOf(x.final, OPTIONS);
  const keyOf = (x) => (S.tried && x.does ? 'does:' + x.does : optOf(x) ? 'option:' + optOf(x) : plain(x.final));
  const tallyOf = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, { key: k, final: r.final, by: [] });
      m.get(k).by.push(r.slot);
    }
    return [...m.values()].sort((a, b) => b.by.length - a.by.length);
  };
  // WHERE CODE IS ASKED FOR, WORDS ARE NO ANSWER BESIDE CODE: once one answer is code, only the answers that are code are
  // counted and shown (measured 2026-11-22: three drafts wrote the function and one wrote a sentence about it; no two texts
  // were the same, the sentence came first, and the sentence went out). Where none is code, they all stand as before.
  // AND WHERE THE QUESTION LISTS OPTIONS, AN ANSWER THAT IS NONE OF THEM IS NO ANSWER BESIDE ONE THAT IS (plan.options: false
  // leaves it): measured 2026-11-22, drafts worked out a date that was not listed, one draft and one checker named an
  // option, and the unlisted date went out with no letter to it. Where no answer is an option, they all stand.
  const answersOf = (rows) =>
    wantsCode && rows.some((d) => isCode(d.final))
      ? rows.filter((d) => isCode(d.final))
      : OPTIONS.length && plan.options !== false && rows.some((d) => optOf(d))
        ? rows.filter((d) => optOf(d))
        : rows;
  const distinct = () => {
    const rows = answersOf(S.pool);
    return rows.filter((d, i) => rows.findIndex((x) => keyOf(x) === keyOf(d)) === i);
  };
  const relabel = () => S.pool.forEach((d, i) => (d.letter = LETTERS[i % LETTERS.length]));
  // nothing is in dispute: at least two answers, and they are all the same one
  const settled = () => answersOf(S.pool).length >= 2 && distinct().length === 1;
  // WHERE MOST OF THE DRAFTERS HOLD ONE ANSWER, IT STANDS (plan.draftsStand): the checkers then have no vote, and vote only
  // where the drafters have no majority. A checker's answer counted as a drafter's does, so three checkers and one drafter
  // outvoted three drafters who were right (measured 2026-11-23, with an adapter on each drafter: more questions had a right
  // draft, 100 to 106 of 160, and more of those were lost, 16 to 23).
  const votes = () => {
    if (plan.draftsStand === true) {
      const drafts = answersOf(S.pool);
      const t = tallyOf(drafts);
      if (t.length && t[0].by.length * 2 > drafts.length) return t;
    }
    return tallyOf(answersOf([...S.pool, ...S.backers.filter((c) => c.final && (!S.tried || c.does))]));
  };
  // one worked answer for each different answer (plan.onePerAnswer; after arXiv 2610.21290), and always where the answers were
  // run: two drafts that do the same are not two answers
  const tableOf = () => (plan.onePerAnswer || S.tried ? distinct() : answersOf(S.pool));
  const shownTo = (table, withWork) =>
    'The question:\n' +
    question +
    '\n\n' +
    table
      .map(
        (d) =>
          'Answer ' +
          d.letter +
          ':\n' +
          (withWork ? workOf(d.out, marker) + '\n' : '') +
          'Its final answer:' +
          fenced(d.final),
      )
      .join('\n\n') +
    (S.parted ? '\n\n' + S.parted : '');

  // where the different answers part, on the calls they were run on, under the letters they have now (an answer written since the
  // calls were first run is known by what it did on them)
  const partNow = () => {
    if (!S.tried) return (S.parted = '');
    const table = distinct().filter((d) => d.does);
    S.parted = S.tried.differ(
      table.map((d) => d.does),
      { as: table.map((d) => d.letter) },
    );
  };
  // WHICH ANSWERS DO THE SAME: run on the same calls, answers that return the same are one. One that does not run is none.
  const tryPool = async () => {
    if (!byBehaviour || S.pool.length < 2) return;
    const at = Date.now();
    if (!S.tried) {
      if (!S.probe || !S.probe.ok) return;
      onStart({ slot: 'run', member: 'sandbox', stage: 'run' });
      let tried = null;
      try {
        tried = await behave({
          question,
          drafts: S.pool.map((d) => ({ letter: d.letter, final: d.final })),
          probeText: S.probe.out,
        });
      } catch {
        tried = null;
      }
      if (tried) {
        for (const d of S.pool) d.does = tried.by[d.letter] || '';
        const ran = S.pool.filter((d) => d.does);
        if (ran.length >= 2) {
          S.pool = ran;
          S.tried = tried;
        } else tried = null;
      }
      const row = {
        slot: 'run',
        member: 'sandbox',
        stage: 'run',
        ms: Date.now() - at,
        out: tried ? tried.summary : 'The drafts could not be tried on calls: they are compared as text.',
        final: '',
        ok: !!tried,
        // how many different behaviours the drafts showed (one: they all do the same)
        behaviours: tried ? new Set(S.pool.map((d) => d.does)).size : 0,
      };
      trace.push(row);
      onStep(row);
    } else {
      // answers written since the calls were first tried: the same calls
      const fresh = S.pool.filter((d) => d.does === undefined);
      if (!fresh.length) return;
      onStart({ slot: 'run', member: 'sandbox', stage: 'run' });
      for (const d of fresh) {
        try {
          d.does = await S.tried.sigOf(d.final);
        } catch {
          d.does = '';
        }
      }
      // one that does not run falls back to what that slot had before, if it had anything that ran
      S.pool = S.pool.map((d) => (d.does || !d.before ? d : d.before)).filter((d) => d.does);
      const groups = distinct().length;
      const row = {
        slot: 'run',
        member: 'sandbox',
        stage: 'run',
        ms: Date.now() - at,
        out:
          'Ran ' +
          fresh.length +
          ' new answer' +
          (fresh.length === 1 ? '' : 's') +
          ' on the same calls: ' +
          (groups === 1 ? 'they now all do the same.' : groups + ' behaviours remain.'),
        final: '',
        ok: true,
      };
      trace.push(row);
      onStep(row);
    }
    relabel();
    partNow();
  };

  const STEPS = {
    // several slots answer the question, each told to go about it differently, all at once; and, where code is asked for, one
    // slot writes calls to try the answers with (behave.mjs), at the same time
    async draft(step) {
      const prober = {
        id: 'probe',
        stage: 'probe',
        member:
          (plan.probe && plan.probe.member) ||
          (briefs.slots.find((s) => s.member === 'b') ? 'b' : briefs.slots[0].member),
        brief: (plan.probe && plan.probe.brief) || probeBriefFor(langOfQuestion(question)),
        maxTokens: (plan.probe && plan.probe.maxTokens) || 260,
        temperature: 0.2,
      };
      // THE QUESTION IN NUMBERED LINES (plan.prepare: 'lines'; breakdown.mjs; O.6.1b): code, and no model, puts each thing the
      // question states on a line of its own, and every drafter is sent the question with those lines under it. Not for code,
      // and a question that states fewer than three things goes as it came.
      const last = kept.at(-1);
      const under = (text) =>
        text && last && typeof last.content === 'string'
          ? [...kept.slice(0, -1), { ...last, content: last.content + '\n\n' + text }]
          : kept;
      const lines = plan.prepare === 'lines' && !wantsCode ? linesOf(question) : '';
      const asked = lines ? under(LINES_HEAD + '\n' + lines) : kept;
      // A SLOT THAT WORKS BY FACTS (slot.byFacts: true; O.6.1c): it is taken through what the question states one thing at a
      // time, each time shown the facts so far and what was worked out so far, both kept by code, and writes one line that
      // now follows; then it drafts, sent the question with what was worked out under it. Its steps are not answers and
      // have no vote. Not for code; a question of fewer than three stated things, or more than twelve, it drafts as it came.
      const facts = statedOf(question);
      const byFacts = (s) =>
        s.byFacts === true && !wantsCode && facts.states.length >= LEAST_STATED && facts.states.length <= MOST_FACTS;
      const draftOf = async (s) => {
        if (!byFacts(s)) return run(s, [sys(s), ...asked]);
        const stepper = {
          ...s,
          id: s.id + '-facts',
          stage: 'prepare',
          brief: FACT_BRIEF,
          maxTokens: 80,
          compute: false,
        };
        const found = [];
        for (let i = 1; i < facts.states.length; i++) {
          const r = await run(stepper, [sys(stepper), { role: 'user', content: factAsk(facts, i, found) }]);
          const one = r && r.ok ? factLine(r.out) : '';
          if (one) found.push(one);
        }
        S.worked = { ...(S.worked || {}), [s.id]: found };
        return run(s, [
          sys(s),
          ...(found.length ? under(FOUND_HEAD + '\n' + found.map((x) => '- ' + x).join('\n')) : asked),
        ]);
      };
      const round = async (slots) => {
        const [rows, probe] = await Promise.all([
          Promise.all(slots.map(draftOf)),
          byBehaviour && !S.probe ? run(prober, [sys(prober), ...kept]) : null,
        ]);
        if (probe) S.probe = probe;
        await Promise.all(
          rows.map((r) =>
            askAgain(
              r,
              slots.find((s) => s.id === r.slot),
              [sys(byId[r.slot]), ...asked],
            ),
          ),
        );
        // WHERE CODE IS ASKED FOR, A DRAFTER THAT GAVE WORDS IS ASKED ONCE FOR THE CODE (plan.codeAgain: false leaves it).
        // It has said what the code should do; it is shown the end of that and asked for the code itself. Its answer is
        // then the code, where it gives code; where it gives words again, its first answer stands (and is no answer
        // beside code). Measured 2026-11-22: three of four drafters ended with a sentence about the function.
        if (wantsCode && plan.codeAgain !== false) {
          await Promise.all(
            rows.map(async (r, i) => {
              if (!r.ok || isCode(r.final) || r.computed !== undefined) return;
              const slot = slots.find((s) => s.id === r.slot);
              const again = await run(slot, [
                sys(byId[r.slot]),
                ...kept,
                { role: 'assistant', content: r.out.slice(-1500) },
                { role: 'user', content: CODE_AGAIN },
              ]);
              again.again = 'code';
              if (again.ok && isCode(again.final)) rows[i] = again;
            }),
          );
        }
        // AND WHERE THE QUESTION LISTS OPTIONS, A DRAFTER WHOSE ANSWER IS NONE OF THEM IS ASKED ONCE FOR THE OPTION
        // (plan.optionAgain: false leaves it). It is shown the end of its work and told the answer is one of the options.
        // Where it then names one, that is its answer; otherwise its first stands. Measured 2026-11-22: every drafter
        // worked out a date that was not listed, and the reply named no letter.
        if (OPTIONS.length && plan.optionAgain !== false) {
          await Promise.all(
            rows.map(async (r, i) => {
              if (!r.ok || optOf(r) || r.computed !== undefined) return;
              const slot = slots.find((s) => s.id === r.slot);
              const again = await run({ ...slot, maxTokens: 120 }, [
                sys(byId[r.slot]),
                ...kept,
                { role: 'assistant', content: r.out.slice(-1500) },
                { role: 'user', content: OPTION_AGAIN },
              ]);
              again.again = 'option';
              if (again.ok && optOf(again)) rows[i] = again;
            }),
          );
        }
        for (const r of rows.filter((d) => d.ok)) {
          // (with plan.computedStands a program's figure is a check on what the slots settle, not a draft among them: it
          // has no vote, so it cannot make two slots that differ look settled, or outvote them)
          if (programFirst && r.computed !== undefined) continue;
          const at = S.pool.findIndex((d) => d.slot === r.slot);
          if (at >= 0) S.pool[at] = r;
          else S.pool.push(r);
        }
        relabel();
      };
      // DRAFTING IN TWO ROUNDS (plan.draftFirst: n; SwOA specification O.6.1 step 1a): n slots draft first, one of each member
      // before a second of any, and the rest draft only where those do not settle the matter. Every draft a swarm asks for on one
      // machine slows the others (measured 2026-11-21, one model in both places: four drafts at once each wrote at a third of
      // the speed of one by itself, and two that agreed were the whole answer on most questions), so the further drafts are
      // asked for where there is something for them to settle. Only on the first drafting of a request: a loop drafts whole.
      const slots = drafting(step);
      // (with plan.computedStands the drafter that answers by a program is asked with the first drafters, whoever they are:
      // asked only where they differ, it was never asked where slots of one model shared a slip)
      const programs = programFirst ? slots.filter((s) => computing(s)) : [];
      const voters = slots.filter((s) => !programs.includes(s));
      const first = firstDrafters(voters, plan.draftFirst);
      if (!first || S.pool.length) return round(slots);
      await round([...first, ...programs]);
      // 4. WHERE THE PROGRAM DIFFERS, THE OTHER DRAFTERS ARE ASKED (plan.computedDoubts). Two slots of one model that agree
      // settle the matter and nobody else is asked; a program that came to something else is a reason to ask. It still
      // has no vote: the slots settle it, more of them.
      if (settled()) {
        const ran = trace.find((r) => r.stage === 'draft' && r.computed === true && String(r.final || '').trim());
        const same = (a, b) =>
          plain(String(a))
            .toLowerCase()
            .replace(/[^a-z0-9.-]+/g, '') ===
          plain(String(b))
            .toLowerCase()
            .replace(/[^a-z0-9.-]+/g, '');
        if (!(plan.computedDoubts && ran && !same(ran.final, distinct()[0].final))) return;
        S.doubted = true;
      }
      await round(voters.filter((s) => !first.includes(s)));
    },
    try: tryPool,
    // slots that are shown the answers and look for what is wrong with them, all at once
    async check(step) {
      const table = tableOf();
      const asked = (s) => [
        sys(s),
        ...kept.slice(0, -1),
        { role: 'user', content: shownTo(table, s.sees !== 'finals') }, // a checker may be shown the answers without their work
      ];
      const slots = slotsOf(step, 'check');
      const rows = await all(slots, asked);
      // A CHECKER THAT RAN OUT OF ROOM BEFORE IT ANSWERED IS ASKED FOR ITS ANSWER, in one line. It has done the work (it was cut off
      // re-deriving every answer at length); what is missing is the last line. Asked on the same slot, with the end of what it wrote.
      await Promise.all(
        rows
          .filter((c) => !c.ok && !c.why && c.out.trim())
          .map(async (c) => {
            const slot = slots.find((s) => s.id === c.slot);
            const at = Date.now();
            try {
              const r = await ask({ ...slot, maxTokens: 16, temperature: 0 }, [
                ...asked(slot),
                { role: 'assistant', content: c.out.slice(-1500) },
                {
                  role: 'user',
                  content:
                    'You ran out of room. Do not explain any more. Write one line and nothing else: ' +
                    marker +
                    ' and the letter of the answer that is correct.',
                },
              ]);
              const line = String((r && r.text) || '').trim();
              const letter = letterOf(/ANSWER/i.test(line) ? line : marker + ' ' + line, marker, LETTERS);
              if (letter) {
                c.out += '\n\n(Asked for its answer in one line.)\n' + marker + ' ' + letter;
                c.concluded = true;
                c.ok = true;
                c.ms += Date.now() - at;
                onStep(c);
              }
            } catch {
              /* it stays without an answer */
            }
          }),
      );
      const checks = rows.filter((c) => c.ok);
      // a checker that answered with a letter means that answer, whole
      // (not where the answers themselves are letters: there a letter is an answer, not a pointer to one)
      const lettersAreAnswers = table.some((d) => /^[A-Za-z]$/.test(String(d.final).trim()));
      for (const c of lettersAreAnswers ? [] : checks) {
        const letter = letterOf(c.out, marker, LETTERS);
        const meant = letter && table.find((d) => d.letter === letter);
        if (meant) ((c.final = meant.final), (c.picked = letter), (c.does = meant.does));
      }
      // a checker that wrote code of its own: what does that do, on the same calls?
      if (S.tried)
        for (const c of checks)
          if (!c.picked && c.final) {
            const twin = S.pool.find((d) => plain(d.final) === plain(c.final));
            try {
              c.does = twin ? twin.does : await S.tried.sigOf(c.final);
            } catch {
              c.does = '';
            }
          }
      // the latest word of each checker is the one that counts
      S.backers = [...S.backers.filter((b) => !checks.some((c) => c.slot === b.slot)), ...checks];
      S.remarks = checks.map((c) => c.out);
    },
    // THE ANSWERS GO BACK TO THOSE WHO WROTE THEM. Each slot is shown the different answers, where they part and what the checkers
    // said, and gives its answer again: its own if it stands, another's if that one is right, a new one if neither is. An answer
    // that was wrong for a reason someone has now named can be put right; this is the step a loop is made of.
    async revise(step) {
      const table = tableOf();
      const remarks = S.remarks.map((r) => (r.length > 700 ? r.slice(-700) : r));
      const rows = await all(
        slotsOf(step, 'draft')
          .filter((s) => !s.compute)
          .map((s) => ({ ...s, stage: 'revise' })),
        (s) => {
          const mine = S.pool.find((d) => d.slot === s.id);
          const same = mine && table.find((d) => keyOf(d) === keyOf(mine));
          return [
            sys(s),
            ...kept.slice(0, -1),
            {
              role: 'user',
              content:
                shownTo(table, true) +
                (remarks.length ? '\n\nWhat those who checked them said:\n' + remarks.join('\n---\n') : '') +
                '\n\n' +
                (same ? 'Yours was Answer ' + same.letter + '. ' : '') +
                'Weigh them. If yours stands, give it again; if another is correct, give that one; if none is, give a better one. ' +
                'End the same way as before: your final answer, whole.',
            },
          ];
        },
      );
      for (const r of rows.filter((d) => d.ok)) {
        const at = S.pool.findIndex((d) => d.slot === r.slot);
        const twin = S.pool.find((d) => plain(d.final) === plain(r.final));
        if (twin) r.does = twin.does;
        if (at >= 0) ((r.before = S.pool[at]), (S.pool[at] = r));
        else S.pool.push(r);
      }
      // what the checkers said was said of the answers as they were
      S.backers = [];
      relabel();
      await tryPool();
    },
    // WHICH ANSWER STANDS: the decider (decider.mjs), in one request that returns a probability for each different
    // answer. Where no decider is named or it does not answer, the answer most slots hold stands.
    //   keep: n   it does not settle the matter: it keeps the n likeliest answers and the flow goes on with those
    async decide(step) {
      const table = distinct();
      const tally = votes();
      let ruled = null;
      // HOW THE MATTER IS SETTLED is part of the plan (plan.decideBy), and so is trained: the decider always ('decider', where nothing
      // is said); the answer most slots hold ('most': the decider is not asked); the decider only where it is sure
      // ('decider-if-confident'), or only where no answer has more than half the slots behind it ('decider-unless-majority').
      const by = step.keep || step.sure ? 'decider' : decideByOf(plan.decideBy);
      // A SMALL MODEL BESIDE THE DECIDER (plan.decideWith: { how, slot }): one slot is shown the different answers and names the
      // one that is correct, and how its word counts is the plan's, and so is trained:
      //   'if-close'   asked only where the decider's pick is narrow, below plan.decideMin (0.6), or where it decided nothing;
      //                it chooses between the decider's two likeliest, and its word settles it
      //   'together'   asked at the same time as the decider; its pick adds plan.decideWith.weight (0.35) to the decider's
      //                probability for that answer, and the highest stands
      //   'if-at-odds' asked only where the decider's pick is not the answer most slots hold; it chooses between the two, and its
      //                word settles it
      //   'alone'      IN PLACE OF THE DECIDER: the slot is shown every different answer and its word settles it; the decider is
      //                not asked for this decision at all. A swarm whose every decision is made so needs no decision model, which
      //                is a third of its memory (measured 2026-11-19: Kev 0.8B held 3.1 GB of a swarm of 7)
      // Not for a decision that narrows ({ keep }) or settles early ({ sure }). Where the slot names nothing, the decider's word
      // stands as it would have.
      // (with no decision model, the slot decides alone, as whichever slot the plan names beside the decider, or the first checker)
      const dw = modelDecides ? { ...(plan.decideWith || {}), how: 'alone' } : plan.decideWith;
      const withModel = !step.keep && !step.sure && by !== 'most' && dw && dw.how;
      const judgeSlot = () => {
        const base = byId[dw.slot] || stage('check')[0] || briefs.slots[0];
        return {
          ...base,
          id: 'decide-judge',
          stage: 'judge',
          brief: dw.brief || JUDGE_BRIEF.replace('ANSWER:', marker),
          maxTokens: dw.maxTokens || base.maxTokens,
        };
      };
      const judgeAmong = async (cands) => {
        const j = judgeSlot();
        const asked = [sys(j), ...kept.slice(0, -1), { role: 'user', content: shownTo(cands, true) }];
        const row = await run(j, asked);
        // ONE THAT RAN OUT OF ROOM BEFORE IT NAMED AN ANSWER IS ASKED FOR ITS LETTER, in one line, as a checker is (O.6.4): it has
        // done the work, and what is missing is the last line (measured 2026-11-19 with real models: of 10 disputes a slot
        // deciding alone named nothing on 3, each cut off at its token limit in the middle of weighing the answers)
        if (!row.ok && !row.why && row.out.trim() && !isToolCall(row.out)) {
          const at = Date.now();
          try {
            const r = await ask({ ...j, maxTokens: 16, temperature: 0 }, [
              ...asked,
              { role: 'assistant', content: row.out.slice(-1500) },
              {
                role: 'user',
                content:
                  'You ran out of room. Do not explain any more. Write one line and nothing else: ' +
                  marker +
                  ' and the letter of the answer that is correct.',
              },
            ]);
            const line = String((r && r.text) || '').trim();
            const named = letterOf(/ANSWER/i.test(line) ? line : marker + ' ' + line, marker, LETTERS);
            if (named) {
              row.out += '\n\n(Asked for its answer in one line.)\n' + marker + ' ' + named;
              row.ok = true;
              row.concluded = true;
              row.ms += Date.now() - at;
              onStep(row);
            }
          } catch {
            /* it stays without an answer */
          }
        }
        const letter = row.ok ? letterOf(row.out, marker, LETTERS) : '';
        const meant = letter && cands.find((d) => d.letter === letter);
        if (!meant) return ((row.ok = false), null);
        row.final = meant.final;
        row.picked = letter;
        return meant;
      };
      // A TIE AT THE TOP IS NOT SETTLED BY ORDER (SwOA specification O.6.6, TIE): settling by the answer most slots hold ('most'),
      // where two or more answers have the most slots behind them alike, the decider chooses among those answers only (measured
      // 2026-11-18: on "is it all right to put a cast iron pan in the dishwasher" two drafts said "hand wash and dry it" and two
      // "it can warp or crack", and the second went out because its draft came first; the larger model's reason was neither
      // warping nor cracking). Where it decides nothing, the first of them stands, as before
      if (
        by === 'most' &&
        !step.keep &&
        !step.sure &&
        decide &&
        tally.length > 1 &&
        tally[0].by.length === tally[1].by.length
      ) {
        const n = tally[0].by.length;
        const tied = new Set(tally.filter((v) => v.by.length === n).map((v) => v.key));
        const cands = table.filter((d) => tied.has(keyOf(d)));
        if (cands.length > 1) {
          onStart({ slot: 'decide', member: 'decider', stage: 'decide' });
          const k = await decide({
            question,
            answers: cands.map((d, i) => ({ letter: LETTERS[i], final: d.final, work: workOf(d.out, marker) })),
            checks: [...S.remarks, ...(S.parted ? [S.parted] : [])],
          });
          const at = k.ok ? LETTERS.indexOf(k.letter) : -1;
          const meant = at >= 0 ? cands[at] : null;
          const row = {
            slot: 'decide',
            member: 'decider',
            stage: 'decide',
            ms: k.ms || 0,
            out:
              'Most slots were split ' +
              cands.length +
              ' ways, ' +
              n +
              ' each: ' +
              (meant
                ? 'picked ' + k.letter + '.'
                : 'decided nothing (' + (k.why || 'no reason given') + '). The first of them stands.'),
            final: meant ? meant.final : '',
            ok: !!meant,
            probs: k.probs,
            tie: true,
          };
          trace.push(row);
          onStep(row);
          if (meant) {
            S.decided = meant.final;
            S.path = 'most-tie-decided';
            return;
          }
        }
      }
      const together = withModel && dw.how === 'together' && decide && table.length > 1;
      const judged = together ? judgeAmong(table) : null;
      const alone = withModel && dw.how === 'alone';
      if (decide && table.length > 1 && by !== 'most' && !alone) {
        onStart({ slot: 'decide', member: 'decider', stage: 'decide' });
        const k = await decide({
          question,
          answers: table.map((d) => ({ letter: d.letter, final: d.final, work: workOf(d.out, marker) })),
          checks: [...S.remarks, ...(S.parted ? [S.parted] : [])],
        });
        ruled = {
          slot: 'decide',
          member: 'decider',
          stage: 'decide',
          ms: k.ms || 0,
          out: k.ok
            ? step.keep
              ? 'Kept the ' + Math.min(step.keep, table.length) + ' likeliest' + '.'
              : 'Picked ' + k.letter + (k.close ? ', narrowly' : '') + '.'
            : 'Decided nothing: ' + (k.why || 'no reason given') + '. The answer most slots gave stands.',
          final: k.ok ? k.final : '',
          ok: !!k.ok,
          // (a decision that timed out once and was asked again with a longer wait: kept so a record can count it)
          ...(k.retried ? { retried: true } : {}),
          ...(k.ok === false && /did not answer/.test(String(k.why || ''))
            ? { timedOut: /abort|timeout/i.test(String(k.why)) }
            : {}),
          probs: k.probs,
          yes: k.yes,
          ...(k.ok && k.close ? { close: true } : {}),
        };
        trace.push(ruled);
        onStep(ruled);
      }
      // A DECISION EARLY IN THE FLOW, THAT SETTLES IT ONLY IF IT IS SURE ({ sure: 0.75 }): where the decider gives one answer that
      // much, the matter is settled there and what follows is passed over; where it does not, nothing is settled or thrown away
      // and the flow goes on (to the checks, to the answers going back) with what it said beside the answers
      if (step.sure) {
        const top = ruled && ruled.ok && ruled.probs ? Math.max(...Object.values(ruled.probs)) : 0;
        if (ruled && ruled.ok && top >= step.sure) {
          S.decided = ruled.final;
          S.path = 'decided-early';
          ruled.out = 'Sure (' + top.toFixed(2) + '): picked ' + ruled.out.replace(/^Picked /, '');
        } else if (ruled) {
          ruled.out = 'Not sure enough to settle it here (' + top.toFixed(2) + '): the flow goes on.';
          ruled.final = '';
          ruled.set = 'aside';
        }
        return;
      }
      if (step.keep && table.length > step.keep) {
        // the likeliest few go on; the rest are out of it. By the decider's probabilities where it gave them, else by how many hold each
        const rank =
          ruled && ruled.ok && ruled.probs
            ? [...table].sort((x, y) => (ruled.probs[y.letter] || 0) - (ruled.probs[x.letter] || 0))
            : tally.map((v) => table.find((d) => keyOf(d) === v.key)).filter(Boolean);
        const keep = new Set(rank.slice(0, step.keep).map(keyOf));
        S.pool = S.pool.filter((d) => keep.has(keyOf(d)));
        S.backers = S.backers.filter((c) => keep.has(keyOf(c)));
        relabel();
        partNow();
        S.narrowed = true;
        return;
      }
      if (step.keep) return;
      if (withModel && table.length > 1) {
        const how = dw.how;
        const probs = (ruled && ruled.ok && ruled.probs) || {};
        const top = Object.keys(probs).length ? Math.max(...Object.values(probs)) : ruled && ruled.ok ? 1 : 0;
        const pickOf = (final) => table.find((d) => plain(d.final) === plain(final));
        let word = null; // what the slot named, where it was asked
        let said = '';
        if (how === 'together' && judged) {
          word = await judged;
          if (word) {
            // its pick adds a weight to the decider's probability for that answer; the highest stands
            const w = dw.weight ?? 0.35;
            const score = (d) => (probs[d.letter] || 0) + (d.letter === word.letter ? w : 0);
            const best = [...table].sort((x, y) => score(y) - score(x))[0];
            said = 'With the model beside it (' + word.letter + ', +' + w + '): ' + best.letter + '.';
            word = best;
          }
        } else if (how === 'alone') {
          word = await judgeAmong(table);
          if (word) trace[trace.length - 1].alone = true;
        } else if (how === 'if-close' && (!ruled || !ruled.ok || ruled.close || top < (plan.decideMin ?? 0.6))) {
          // between the decider's two likeliest (all of them where it gave no probabilities)
          const cands = Object.keys(probs).length
            ? [...table].sort((x, y) => (probs[y.letter] || 0) - (probs[x.letter] || 0)).slice(0, 2)
            : table;
          word = await judgeAmong(cands);
          if (word) said = 'Close (' + top.toFixed(2) + '): the model beside it chose ' + word.letter + '.';
        } else if (how === 'if-at-odds' && ruled && ruled.ok && tally.length) {
          const mine = pickOf(ruled.final);
          const most = table.find((d) => keyOf(d) === tally[0].key);
          if (mine && most && keyOf(mine) !== keyOf(most)) {
            word = await judgeAmong([mine, most].sort((x, y) => x.letter.localeCompare(y.letter)));
            if (word) said = 'At odds with most: the model beside it chose ' + word.letter + '.';
          }
        }
        if (word) {
          // the decider's row says what it did and what the slot beside it did (with no decider, the slot's own row says it)
          if (ruled) {
            ruled.out = ruled.out.replace(/ The answer most slots gave stands\.$/, '') + ' ' + said;
            ruled.ok = true;
            ruled.final = word.final;
            ruled.withModel = how;
          }
          S.decided = word.final;
          S.path = tally.length && keyOf(word) === tally[0].key ? 'decided' : 'decided-against-most';
          return;
        }
      }
      if (ruled && ruled.ok && tally.length) {
        const top = ruled.probs ? Math.max(...Object.values(ruled.probs)) : 1;
        const voters = tally.reduce((n, v) => n + v.by.length, 0);
        const left =
          by === 'decider-if-confident' && top < (plan.decideMin ?? 0.6)
            ? 'it gave its choice ' + top.toFixed(2)
            : by === 'decider-unless-majority' && tally[0].by.length * 2 > voters
              ? 'more than half the slots hold one answer'
              : '';
        if (left) {
          ruled.out += ' Not taken (' + left + '): the answer most slots hold stands.';
          ruled.ok = false;
          ruled.set = 'aside';
        }
      }
      if (ruled && ruled.ok) {
        S.decided = ruled.final;
        const chosen = table.find((d) => plain(d.final) === plain(S.decided));
        S.path =
          tally.length && (chosen ? keyOf(chosen) : plain(S.decided)) === tally[0].key
            ? 'decided'
            : 'decided-against-most';
      } else if (tally.length) {
        S.decided = tally[0].final;
        S.path = 'most';
      }
    },
    // steps done again, while the answers still differ: upTo times at most
    async repeat(step) {
      for (let round = 1; round <= (step.upTo || 2); round++) {
        if (S.decided || settled()) break;
        S.round = round;
        await runSteps(step.steps || []);
      }
      S.round = 0;
    },
    // WHAT SHOULD EACH CALL GIVE? One slot says, from the question alone and without writing the function, what a correct
    // function returns for each call the answers were run on. The answers are then counted against that: one that gives what the
    // question asks for on the most calls is backed, and the count is put before the decider. (Tests written apart from the
    // code they test: an answer and a test that agree were not copied from each other.) It can be wrong, so it backs and
    // informs; it does not settle.
    async expect() {
      if (!S.tried) return;
      const asker = {
        id: 'expect',
        stage: 'expect',
        member:
          (plan.expect && plan.expect.member) ||
          (briefs.slots.find((s) => s.member === 'a') ? 'a' : briefs.slots[0].member),
        brief: (plan.expect && plan.expect.brief) || expectBriefFor(S.tried.lang),
        maxTokens: (plan.expect && plan.expect.maxTokens) || 360,
        temperature: 0,
      };
      const row = await run(asker, [
        sys(asker),
        ...kept.slice(0, -1),
        { role: 'user', content: question + '\n\nThe calls:\n' + S.tried.calls.join('\n') },
      ]);
      if (!row.ok) return;
      const want = expectedIn(row.out, S.tried.calls);
      const total = Object.keys(want).length;
      if (total < 2) return;
      const scored = distinct()
        .filter((d) => d.does)
        .map((d) => ({ d, n: S.tried.matches(d.does, want) }))
        .sort((x, y) => y.n - x.n);
      if (!scored.length) return;
      const note =
        'One slot said, from the question alone, what each call should give. ' +
        scored.map((x) => 'Answer ' + x.d.letter + ' gives that on ' + x.n + ' of ' + total + ' calls').join('; ') +
        '.';
      row.out += '\n\n' + note;
      S.remarks = [...S.remarks, note];
      // backed only where one answer is clearly ahead and gives what was expected on at least half the calls
      const [best, next] = scored;
      if (best.n * 2 >= total && (!next || best.n > next.n)) {
        row.picked = best.d.letter;
        S.backers = [
          ...S.backers.filter((b) => b.slot !== 'expect'),
          { slot: 'expect', stage: 'expect', final: best.d.final, does: best.d.does },
        ];
      }
      onStep(row);
    },
    write: async () => {}, // done last, below: it needs what was settled
  };
  // a step that works on a dispute is passed over when there is none
  const ONLY_IF_DISPUTED = new Set(['check', 'revise', 'decide', 'repeat']);
  // A PROGRAM THE QUESTION ASKS THE OUTPUT OF IS RUN, not worked out (SwOA specification R.4): started with the drafts, and once
  // the drafting is over what it printed settles the matter, whatever the drafts said (measured 2026-11-18: on six questions of
  // what a short program prints the larger model's own reply was wrong once; running it is never wrong). Where it cannot be run, nothing
  // changes
  const program = plan.runPrograms !== false && print ? programOf(question) : '';
  const printing = program ? Promise.resolve(print(program)).catch(() => null) : null;
  let printSeen = false;
  const settlePrinted = async () => {
    if (!printing || printSeen) return;
    printSeen = true;
    const at = Date.now();
    onStart({ slot: 'run', member: 'sandbox', stage: 'run' });
    const p = await printing;
    const row = {
      slot: 'run',
      member: 'sandbox',
      stage: 'run',
      ms: Date.now() - at,
      out: p ? 'Ran the program: it printed ' + p.text : 'The program could not be run: the drafts settle it.',
      final: p ? p.text : '',
      ok: !!p,
      printed: true,
    };
    trace.push(row);
    onStep(row);
    if (p && !S.decided) {
      S.decided = p.text;
      S.path = 'ran';
    }
  };
  async function runSteps(steps) {
    for (const step of steps) {
      const fn = STEPS[step.do];
      if (!fn || step.do === 'write') continue;
      if (step.do !== 'draft') await settlePrinted();
      if (S.decided || !S.pool.length) {
        if (step.do !== 'draft') continue;
      }
      if (ONLY_IF_DISPUTED.has(step.do)) {
        if (settled() && plan.agreeSkipsChecks !== false) continue;
        S.disputed = true;
      }
      const before = trace.length;
      await fn(step);
      for (const r of trace.slice(before)) {
        if (S.round) r.round = S.round;
      }
    }
  }
  const flow = flowOf(briefs);
  await runSteps(flow);
  await settlePrinted();
  // what stands, if no step settled it: the one answer where there is one; else the answer most slots hold
  if (!S.decided && S.pool.length) {
    const tally = votes();
    if (settled()) {
      S.decided = distinct()[0].final;
      S.path = S.disputed ? 'converged' : 'agreed';
    } else if (tally.length) {
      S.decided = tally[0].final;
      S.path = 'most';
    }
  }
  // A FIGURE A PROGRAM WORKED OUT STANDS (plan.computedStands). Slots of one model that agree on a figure may agree on the
  // same slip: "7 tickets at 4 pounds each" came to 32 from every drafter, "3 hours 30 minutes in minutes" to 1830, and
  // where the first two agree no other slot is asked (measured 2026-11-24: the last conversations still wrong were all
  // such sums). A drafter that answers by a program writes the sum down and the sandbox works it; where that came to a
  // plain number, and this is on, the number stands over the one figure the slots held. Words are not overruled by it.
  // 2. AND WHERE THE SLOTS SETTLED ON NOTHING, WHAT THE PROGRAM PRINTED STANDS (plan.computedFills): any short answer, not a
  // figure only. Nothing of the slots' is overruled by it: there is nothing. Measured 2026-11-25, 132 plain questions: three
  // such, the program right on all three; let stand wherever it differed it would have lost 28.
  if (plan.computedFills && !String(S.decided || '').trim()) {
    const ran = trace.find((r) => r.stage === 'draft' && r.computed === true && String(r.final || '').trim());
    if (ran && String(ran.final).trim().length <= 120) {
      S.decided = String(ran.final).trim();
      S.path = (S.path ? S.path + '+' : '') + 'computed-fill';
    }
  }
  if (S.doubted && S.path) S.path += '+doubted';
  if (plan.computedStands) {
    const ran = trace.find(
      (r) => r.stage === 'draft' && r.computed === true && /^-?\d[\d,]*(?:\.\d+)?$/.test(String(r.final || '').trim()),
    );
    // (only where what the slots settled is itself ONE figure: asked two things, a program that printed one number has
    // not answered, and it does not overrule an answer that holds both. Measured 2026-11-24: 10 of 16 such turns lost.)
    const figures = String(S.decided || '').match(/\d[\d,]*(?:\.\d+)?/g) || [];
    if (ran && figures.length === 1 && String(ran.final).trim() !== String(S.decided || '').trim()) {
      S.decided = String(ran.final).trim();
      S.path = (S.path ? S.path + '+' : '') + 'computed';
    }
  }
  if (S.narrowed && S.path) S.path += '+narrowed';
  let decided = S.decided;
  let path = S.path;
  // (where the program's run settled it, the work is a draft's that came to the same, or none: a draft that came to something
  // else would tell the writer otherwise)
  const best = S.pool.find((d) => plain(d.final) === plain(decided)) || (path === 'ran' ? null : S.pool[0]);
  const work = best ? workOf(best.out, marker) : '';

  // ---- write
  let reply = '';
  const writeStep = flow
    .flatMap(function each(s) {
      return s.do === 'repeat' ? (s.steps || []).flatMap(each) : [s];
    })
    .filter((s) => s.do === 'write')
    .pop();
  const writers = writeStep ? slotsOf(writeStep, 'write') : [];
  // CODE GOES OUT AS IT WAS SETTLED, and no slot is asked to write it out again: it could only change it, or (a model trained to
  // call tools) hand it over as a tool call. plan.writeCode: true asks the writer all the same.
  const asIs = decided && isCode(decided) && plan.writeCode !== true;
  // AND WITH plan.writeAs 'settled' NO ANSWER IS REWRITTEN: the writer is passed over and the settled answer goes out with the work
  // behind it (measured, 2026-11-16: the writer changed the settled answer on 6 of 70 questions, and it was then not the larger
  // model's). Whether this is better is the trainer's to find, like any other setting.
  // AND WITH plan.writeAs 'bare' THE SETTLED ANSWER GOES OUT ALONE: no writer, and no work before it. 'settled' sends the work
  // and then the answer ("9 * 5 = 45", a blank line, "45"), which is no bare number to a person who asked for one
  // (measured 2026-11-24: 0 of 10 such turns, with the right answer settled on 8).
  const bare = decided && !asIs && plan.writeAs === 'bare';
  // AND WITH plan.writeAs 'agreed' THE WRITER IS PASSED OVER ONLY WHERE EVERY DRAFT CAME TO THE ONE ANSWER (the path is `agreed`):
  // the drafts that differed, and what was decided between them, are still written out by the writer. Where they agree there
  // is a draft that says the answer and its work already, and a writer on a slow model spends as long again saying it
  // (measured 2026-11-26, Bonsai 2.5 27B on one question: two drafts of 450 tokens that agreed, then a writer's 440 tokens
  // that were nearly one of the drafts, 21 of 52 seconds). Whether it costs answers is the trainer's to find.
  const agreedOnly = plan.writeAs === 'agreed' && String(path || '').split('+')[0] === 'agreed';
  const passOver = decided && !asIs && (plan.writeAs === 'settled' || bare || agreedOnly);
  if (passOver) path += bare ? '+bare' : '+as-settled';
  // AND WITH plan.writeAs 'full' THE WRITER WRITES THE REPLY IN FULL: the answer, why, and what to do, where every draft is told to
  // be brief and the writer to add nothing (measured 2026-11-18: of 36 questions short of parity, about 19 had the larger model's
  // answer and lost it by being thin: "Yes, rabbits can eat celery." against the answer, how to give it and how much). Whether it
  // is better is the trainer's to find, class by class
  // (never where a piece of writing is asked for: the piece is the reply, and reasons and next steps around it are not it.
  // Measured 2026-11-18: written "in full", a text to cancel a dinner read 0.65 and 0.72 against the larger model's where it had read 0.88)
  const full = !asIs && !passOver && plan.writeAs === 'full' && !asksForPiece(question);
  if (decided && full && writers.length) path += '+full';
  if (asIs) reply = '```' + (/\bfunction\b|=>|\b(?:const|let)\s/.test(decided) ? 'js' : '') + '\n' + decided + '\n```';
  else if (decided && writers.length && !passOver) {
    const writeMsgs = (s) => [
      // (in full: the writer is told FULL_BRIEF in place of its own brief, the rest of its system message as it always is)
      sys(full ? { ...s, brief: FULL_BRIEF } : s),
      ...kept.slice(0, -1),
      {
        role: 'user',
        // (what was settled is a short statement of the answer: asked for a piece of writing, a small writer told "the answer settled
        // on" wrote ABOUT the answer, "The answer is a resume with 12 placeholders", and echoed these labels. Measured 2026-11-17 on
        // IFEval, the writer alone on the same drafts: 23 of 40 kept every instruction with the old wording and brief, 25 with this,
        // and replies describing the answer or echoing the labels fell from 15 of 20 to 6)
        content:
          "The person's message:\n" +
          question +
          '\n\nWhat was settled, in short (a statement of the answer, not the reply itself):' +
          fenced(decided) +
          (work ? '\n\nThe draft it came from:\n' + work : '') +
          '\n\nNow write the reply itself, exactly as the person will read it, and nothing else.',
      },
    ];
    const rows = await all(writers, writeMsgs);
    // A CLOSING REMARK ABOUT HOW THE REPLY WAS MADE IS CUT (read.mjs withoutClosingRemark): the answer, then a paragraph that says
    // it came from "the provided draft" or was "settled". The paragraphs before it are the reply; the row says it was trimmed
    const cut = (w) => {
      if (!w.ok) return;
      const t = withoutClosingRemark(w.out, question);
      if (t !== String(w.out || '').trim()) {
        w.out = t;
        w.trimmed = true;
      }
    };
    rows.forEach(cut);
    if (rows.some((w) => w.trimmed)) path += '+trimmed';
    // A REPLY THAT DESCRIBES THE ANSWER INSTEAD OF GIVING IT IS NOT SENT (read.mjs describedNotGiven: it echoes its prompt, speaks
    // of the request or the draft, or says what the answer is where a piece was wanted). Marked on its row, for training to see
    // that the answer was lost in writing; then the same is asked of the largest small model that did not write it (others, the
    // swarm's models largest first); and where that one describes it too, the draft that holds the piece goes out
    const tell = (w) => {
      const why = w.ok ? describedNotGiven(w.out, { settled: decided, draft: work }) : '';
      if (why) w.describes = why;
      return !why;
    };
    const described = rows.filter((w) => w.ok && !tell(w)).length;
    if (described && !rows.some((w) => w.ok && !w.describes)) {
      const used = new Set(writers.map((s) => s.member));
      const other = others.find((k) => !used.has(k));
      if (other) {
        const again = await run(
          { ...writers[0], id: writers[0].id + '@' + other, member: other },
          writeMsgs(writers[0]),
        );
        again.rewrite = true;
        cut(again);
        if (again.trimmed && !path.includes('+trimmed')) path += '+trimmed';
        if (again.ok && tell(again)) (rows.push(again), (path += '+rewritten'));
      }
      if (!rows.some((w) => w.ok && !w.describes)) path += '+described';
    }
    if (rows.some((w) => !w.ok && isToolCall(w.out)) && !rows.some((w) => w.ok)) path += '+tool-call';
    // CODE IS NOT TO BE REWRITTEN ON THE WAY OUT: a reply whose code is not the code that was settled is not sent
    const kept2 = rows.filter(
      (w) => w.ok && !w.describes && !(isCode(decided) && plain(finalOf(w.out.trim(), marker)) !== plain(decided)),
    );
    if (rows.some((w) => w.ok) && !kept2.length) path += '+code-restored';
    if (kept2.length === 1) reply = kept2[0].out.trim();
    else if (kept2.length > 1) {
      // SEVERAL REPLIES WERE WRITTEN: the decider picks the one that says what was settled best. With none, the first
      reply = kept2[0].out.trim();
      if (decide) {
        onStart({ slot: 'decide', member: 'decider', stage: 'decide' });
        const k = await decide({
          question:
            question +
            '\n\nThe answer that was settled on: ' +
            decided +
            '\nWhich reply gives that answer most plainly and correctly?',
          answers: kept2.map((w, i) => ({ letter: LETTERS[i], final: w.out.trim(), work: '' })),
          checks: [],
        });
        const row = {
          slot: 'decide',
          member: 'decider',
          stage: 'decide',
          ms: k.ms || 0,
          out: k.ok ? 'Picked reply ' + k.letter + '.' : 'Picked no reply: the first is sent.',
          final: '',
          ok: !!k.ok,
          probs: k.probs,
          of: 'replies',
        };
        trace.push(row);
        onStep(row);
        if (k.ok) {
          const at = LETTERS.indexOf(k.letter);
          if (kept2[at]) ((reply = kept2[at].out.trim()), (path += '+picked'));
        }
      }
    }
  }
  if (!reply) {
    // nothing could be written: the answer and its work, as they stand
    if (decided)
      reply = isCode(decided)
        ? '```' + fenceOf(decided) + '\n' + decided + '\n```'
        : bare
          ? decided
          : /\+described/.test(path) && work
            ? work
            : (work ? work + '\n\n' : '') + decided;
    else if (trace.find((r) => r.out))
      reply = workOf(trace.find((r) => r.out).out, marker) || trace.find((r) => r.out).out;
    path = path ? (/code-restored/.test(path) ? path : path + '+unwritten') : 'fallback';
  }
  // THE REPLY CLOSES AS THE EARLIER REPLIES DO (plan.closeAs 'shown'; read.mjs closingForm says why): where the conversation's
  // earlier replies all end with the same words and then their answer, this one ends that way around what was settled. Not code,
  // and not where there is no such form to follow. Whether it is better is the trainer's to find, class by class
  // A REPLY DOES NOT OPEN BY SAYING THE QUESTION AGAIN. A writer given the question and the settled answer began its reply
  // with the question, word for word ("Today is Thursday. What day of the week will it be 128 days from now?" and then
  // "Saturday"), and a reader that takes the first thing a reply settles on took Thursday (measured 2026-11-24: three of
  // six such replies read wrong with the right answer in them). The question's own lines at the head of a reply come off,
  // as they already did where the reply was closed in a form. Not code.
  if (reply && !isCode(decided || reply)) {
    const cut = withoutRestating(reply, question);
    if (cut !== reply && String(cut).trim()) reply = cut;
  }
  if (plan.closeAs === 'shown' && reply && decided && !isCode(decided)) {
    const form = closingForm(talk);
    // (it does not open by saying the question again, and it is laid out as they are: with no empty line where they have none)
    const closed = form ? closedAs(laidOutAs(withoutRestating(reply, question), talk), decided, form, question) : reply;
    if (closed !== reply) {
      reply = closed;
      path += '+closed';
    }
  }
  return {
    reply,
    decided,
    path: path || 'fallback',
    ms: Date.now() - t0,
    trace,
    ok: !!reply,
    tried: S.tried ? { calls: S.tried.calls, groups: S.tried.groups } : null,
  };
}
