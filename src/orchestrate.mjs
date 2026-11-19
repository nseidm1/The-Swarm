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
import {
  finalOf as readFinal,
  workOf as readWork,
  plain,
  isCode,
  asksForCode,
  asksForPiece,
  MARKER,
  isToolCall,
  letterOf,
  describedNotGiven,
  withoutClosingRemark,
} from './read.mjs';
import { PROBE_BRIEF, EXPECT_BRIEF, expectedIn, programOf } from './behave.mjs';

// an answer as it is shown to another slot or to the person: code in a block of its own, anything else as it is
const fenced = (final) => (isCode(final) ? '\n```\n' + final + '\n```' : ' ' + final);

// THE SLOT THAT DECIDES BESIDE THE DECIDER (plan.decideWith) is told this, where the plan gives it nothing of its own
export const JUDGE_BRIEF =
  'You are shown a question and different answers to it, each with its working. Decide which one is correct. Put each final ' +
  'answer back into the question and check it; for code, think of the awkward inputs; look for the slip in the working. Do ' +
  'not count how many answers agree. Be brief. End with one line and nothing after it: ANSWER: and the letter of the correct one.';
// how the matter is settled (plan.decideBy): 'decider' where nothing is said; the names from when Kev was the only decider are
// read as the same
export const decideByOf = (v) => String(v || 'decider');
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
export function classOf(messages = [], { tools = null } = {}) {
  if (Array.isArray(tools) && tools.length) return 'tools';
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

export async function answer(
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
  const plan = briefs.plan || {};
  const stage = (name) => briefs.slots.filter((s) => s.stage === name);
  // where code is asked for, the code a slot wrote is its answer, whatever it wrote after it
  const wantsCode = asksForCode(question);
  const finalOf = (text, m) => readFinal(text, m, wantsCode);
  const workOf = (text, m) => readWork(text, m, wantsCode);
  const house = messages
    .filter((m) => m.role === 'system')
    .map(said)
    .join('\n')
    .trim();
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
      if (slot.stage === 'probe' || slot.stage === 'expect' || slot.stage === 'judge') row.final = '';
      row.ok =
        slot.stage === 'write' || slot.stage === 'probe' || slot.stage === 'expect'
          ? row.out.trim().length > 0 && !isToolCall(row.out)
          : slot.stage === 'judge'
            ? !!letterOf(row.out, marker, LETTERS)
            : !!row.final || (slot.stage === 'check' && !!letterOf(row.out, marker, LETTERS));
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
  const keyOf = (x) => (S.tried && x.does ? 'does:' + x.does : plain(x.final));
  const tallyOf = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, { key: k, final: r.final, by: [] });
      m.get(k).by.push(r.slot);
    }
    return [...m.values()].sort((a, b) => b.by.length - a.by.length);
  };
  const distinct = () => S.pool.filter((d, i) => S.pool.findIndex((x) => keyOf(x) === keyOf(d)) === i);
  const relabel = () => S.pool.forEach((d, i) => (d.letter = LETTERS[i % LETTERS.length]));
  // nothing is in dispute: at least two answers, and they are all the same one
  const settled = () => S.pool.length >= 2 && distinct().length === 1;
  const votes = () => tallyOf([...S.pool, ...S.backers.filter((c) => c.final && (!S.tried || c.does))]);
  // one worked answer for each different answer (plan.onePerAnswer; after arXiv 2610.21290), and always where the answers were
  // run: two drafts that do the same are not two answers
  const tableOf = () => (plan.onePerAnswer || S.tried ? distinct() : S.pool);
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
        brief: (plan.probe && plan.probe.brief) || PROBE_BRIEF,
        maxTokens: (plan.probe && plan.probe.maxTokens) || 260,
        temperature: 0.2,
      };
      const [rows, probe] = await Promise.all([
        all(drafting(step), (s) => [sys(s), ...kept]),
        byBehaviour && !S.probe ? run(prober, [sys(prober), ...kept]) : null,
      ]);
      if (probe) S.probe = probe;
      await Promise.all(
        rows.map((r) =>
          askAgain(
            r,
            drafting(step).find((s) => s.id === r.slot),
            [sys(byId[r.slot]), ...kept],
          ),
        ),
      );
      for (const r of rows.filter((d) => d.ok)) {
        const at = S.pool.findIndex((d) => d.slot === r.slot);
        if (at >= 0) S.pool[at] = r;
        else S.pool.push(r);
      }
      relabel();
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
        const row = await run(j, [sys(j), ...kept.slice(0, -1), { role: 'user', content: shownTo(cands, true) }]);
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
        brief: (plan.expect && plan.expect.brief) || EXPECT_BRIEF,
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
      S.decided = S.pool[0].final;
      S.path = S.disputed ? 'converged' : 'agreed';
    } else if (tally.length) {
      S.decided = tally[0].final;
      S.path = 'most';
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
  const passOver = decided && !asIs && plan.writeAs === 'settled';
  if (passOver) path += '+as-settled';
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
        ? '```js\n' + decided + '\n```'
        : /\+described/.test(path) && work
          ? work
          : (work ? work + '\n\n' : '') + decided;
    else if (trace.find((r) => r.out))
      reply = workOf(trace.find((r) => r.out).out, marker) || trace.find((r) => r.out).out;
    path = path ? (/code-restored/.test(path) ? path : path + '+unwritten') : 'fallback';
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
