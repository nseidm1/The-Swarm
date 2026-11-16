// orchestrate.mjs - ONE MESSAGE IN, ONE REPLY OUT, AND EVERY SLOT USED ON THE WAY.
//   draft   several slots answer the question, each told to go about it differently, all at once
//   (if every draft reached the same answer, the checks are passed over: nothing is in dispute)
//   check   slots that are shown the drafts and look for what is wrong with them, all at once
//   decide  which answer stands: a decision model (Kev), given the different answers and what the checkers said. No slot judges
//   write   one slot that writes the reply a person reads, from what was settled
// What each slot is told is in briefs.json; this file is the order of things, and what happens when a slot fails (the others
// carry on; if Kev is not there or decides nothing, the answer most slots gave stands; if nothing can be written, the best draft is the reply).
// It knows nothing of servers: `ask(slot, messages)` is handed in, and returns { text } or throws.
//   const { reply, path, trace } = await answer(messages, { briefs, ask });
import {
  finalOf as readFinal,
  workOf as readWork,
  plain,
  tally,
  isCode,
  asksForCode,
  MARKER,
  isToolCall,
  letterOf,
} from './read.mjs';

// an answer as it is shown to another slot or to the person: code in a block of its own, anything else as it is
const fenced = (final) => (isCode(final) ? '\n```\n' + final + '\n```' : ' ' + final);

const LETTERS = 'ABCDEFGH';
const said = (m) =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p) => (p && p.type === 'text' ? p.text : '')).join('')
      : '';

export async function answer(messages, { briefs, ask, decide = null, onStep = () => {}, onStart = () => {} }) {
  const t0 = Date.now();
  const marker = briefs.marker || MARKER;
  const plan = briefs.plan || {};
  const stage = (name) => briefs.slots.filter((s) => s.stage === name);
  const trace = [];
  // the conversation a slot is shown: what the person's own program set as the system line, and the last turns
  const talk = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: said(m) }));
  const kept = talk.slice(-(plan.keepTurns || 6));
  const question = kept.length ? kept[kept.length - 1].content : '';
  // where code is asked for, the code a slot wrote is its answer, whatever it wrote after it
  const wantsCode = asksForCode(question);
  const finalOf = (text, m) => readFinal(text, m, wantsCode);
  const workOf = (text, m) => readWork(text, m, wantsCode);
  const house = messages
    .filter((m) => m.role === 'system')
    .map(said)
    .join('\n')
    .trim();
  const NO_TOOLS = ' You have no tools: write your answer as plain text, and any code inside a fenced code block.';
  const sys = (slot) => ({
    role: 'system',
    content: slot.brief + NO_TOOLS + (house ? '\n\nThe person set this for the conversation:\n' + house : ''),
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
      row.ok =
        slot.stage === 'write'
          ? row.out.trim().length > 0 && !isToolCall(row.out)
          : !!row.final || (slot.stage === 'check' && !!letterOf(row.out, marker, LETTERS));
      if (r && r.tokens) row.tokens = r.tokens;
    } catch (e) {
      row.why = String((e && e.message) || e).slice(0, 200);
    }
    row.ms = Date.now() - at;
    trace.push(row);
    onStep(row);
    return row;
  };
  const all = (slots, msgsOf) => Promise.all(slots.map((s) => run(s, msgsOf(s))));

  // ---- draft
  const drafts = (await all(stage('draft'), (s) => [sys(s), ...kept])).filter((d) => d.ok);
  let votes = tally(drafts);
  let decided = '';
  let path = '';
  let work = '';
  const lettered = drafts.map((d, i) => ({ ...d, letter: LETTERS[i] }));
  const agreed = drafts.length >= 2 && votes.length === 1 && votes[0].by.length === drafts.length;
  if (agreed && plan.agreeSkipsChecks !== false) {
    decided = votes[0].final;
    path = 'agreed';
  } else if (drafts.length) {
    // ---- check
    // ONE WORKED ANSWER FOR EACH DIFFERENT ANSWER (plan.onePerAnswer; after arXiv 2610.21290): shown every draft, a checker or a
    // checker can count heads, and three drafts that share a slip outvote one that is right. Shown one for each distinct answer,
    // it has only the reasoning to go on.
    const distinct = lettered.filter((d, i) => lettered.findIndex((x) => plain(x.final) === plain(d.final)) === i);
    const table = plan.onePerAnswer ? distinct : lettered;
    const shown = (withWork) =>
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
        .join('\n\n');
    const checks = (
      await all(stage('check'), (s) => [
        sys(s),
        ...kept.slice(0, -1),
        { role: 'user', content: shown(s.sees !== 'finals') }, // a checker may be shown the answers without their work
      ])
    ).filter((c) => c.ok);
    // a checker that answered with a letter means that answer, whole
    // (not where the answers themselves are letters: there a letter is an answer, not a pointer to one)
    const lettersAreAnswers = table.some((d) => /^[A-Za-z]$/.test(String(d.final).trim()));
    for (const c of lettersAreAnswers ? [] : checks) {
      const letter = letterOf(c.out, marker, LETTERS);
      const meant = letter && table.find((d) => d.letter === letter);
      if (meant) ((c.final = meant.final), (c.picked = letter));
    }
    votes = tally([...drafts, ...checks]);
    // ---- decide: a decision model (Kev, decider.mjs), in one request that returns a probability for each different answer.
    // No slot judges: a model that writes is not asked to pick. Where Kev is not named or does not answer, the answer most
    // slots gave stands.
    let ruled = null;
    if (decide && distinct.length > 1) {
      onStart({ slot: 'kev-decide', member: 'kev', stage: 'decide' });
      const k = await decide({
        question,
        answers: distinct.map((d) => ({ letter: d.letter, final: d.final, work: workOf(d.out, marker) })),
        checks: checks.map((c) => c.out),
      });
      ruled = {
        slot: 'kev-decide',
        member: 'kev',
        stage: 'decide',
        ms: k.ms || 0,
        out: k.ok
          ? 'Picked ' + k.letter + (k.close ? ', narrowly' : '') + '.'
          : 'Decided nothing: ' + (k.why || 'no reason given') + '. The answer most slots gave stands.',
        final: k.ok ? k.final : '',
        ok: !!k.ok,
        probs: k.probs,
        yes: k.yes,
      };
      trace.push(ruled);
      onStep(ruled);
    }
    if (ruled && ruled.ok) {
      decided = ruled.final;
      path = votes.length && plain(decided) === votes[0].plain ? 'decided' : 'decided-against-most';
    } else if (votes.length) {
      decided = votes[0].final;
      path = 'most';
    }
  }
  const best = lettered.find((d) => plain(d.final) === plain(decided)) || lettered[0];
  work = best ? workOf(best.out, marker) : '';

  // ---- write
  let reply = '';
  const writers = stage('write');
  if (decided && writers.length) {
    const w = await run(writers[0], [
      sys(writers[0]),
      ...kept.slice(0, -1),
      {
        role: 'user',
        content:
          'They asked:\n' +
          question +
          '\n\nThe answer settled on:' +
          fenced(decided) +
          (work ? '\n\nThe work behind it:\n' + work : '') +
          '\n\nWrite the reply.',
      },
    ]);
    if (w.ok) reply = w.out.trim();
    // the writer answered with a call to a tool: that is not a reply, and what was settled goes out as it stands
    else if (isToolCall(w.out)) path += '+tool-call';
    // CODE IS NOT TO BE REWRITTEN ON THE WAY OUT: if the reply's code is not the code that was settled, the settled code goes out
    if (reply && isCode(decided) && plain(finalOf(reply, marker)) !== plain(decided)) {
      reply = '';
      path += '+code-restored';
    }
  }
  if (!reply) {
    // nothing could be written: the answer and its work, as they stand
    if (decided) reply = isCode(decided) ? '```js\n' + decided + '\n```' : (work ? work + '\n\n' : '') + decided;
    else if (trace.find((r) => r.out))
      reply = workOf(trace.find((r) => r.out).out, marker) || trace.find((r) => r.out).out;
    path = path ? (/code-restored/.test(path) ? path : path + '+unwritten') : 'fallback';
  }
  return { reply, decided, path: path || 'fallback', ms: Date.now() - t0, trace, ok: !!reply };
}
