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
import { PROBE_BRIEF } from './behave.mjs';

// an answer as it is shown to another slot or to the person: code in a block of its own, anything else as it is
const fenced = (final) => (isCode(final) ? '\n```\n' + final + '\n```' : ' ' + final);

const LETTERS = 'ABCDEFGH';
const said = (m) =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p) => (p && p.type === 'text' ? p.text : '')).join('')
      : '';

export async function answer(
  messages,
  { briefs, ask, decide = null, behave = null, onStep = () => {}, onStart = () => {} },
) {
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
      if (slot.stage === 'probe') row.final = '';
      row.ok =
        slot.stage === 'write' || slot.stage === 'probe'
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

  // ---- draft; and, where code is asked for, one slot writes calls to try the drafts with (behave.mjs), at the same time
  const byBehaviour = wantsCode && !!behave && plan.byBehaviour !== false;
  const prober = {
    id: 'probe',
    stage: 'probe',
    member:
      (plan.probe && plan.probe.member) || (briefs.slots.find((s) => s.member === 'b') ? 'b' : briefs.slots[0].member),
    brief: (plan.probe && plan.probe.brief) || PROBE_BRIEF,
    maxTokens: (plan.probe && plan.probe.maxTokens) || 260,
    temperature: 0.2,
  };
  const [draftRows, probe] = await Promise.all([
    all(stage('draft'), (s) => [sys(s), ...kept]),
    byBehaviour ? run(prober, [sys(prober), ...kept]) : null,
  ]);
  let drafts = draftRows.filter((d) => d.ok);
  drafts.forEach((d, i) => (d.letter = LETTERS[i]));
  // WHICH DRAFTS DO THE SAME: run on the same calls, drafts that return the same are one answer. A draft that does not run is none.
  let tried = null;
  if (byBehaviour && probe && probe.ok && drafts.length >= 2) {
    const at = Date.now();
    onStart({ slot: 'run', member: 'sandbox', stage: 'run' });
    try {
      tried = await behave({
        question,
        drafts: drafts.map((d) => ({ letter: d.letter, final: d.final })),
        probeText: probe.out,
      });
    } catch {
      tried = null;
    }
    if (tried) {
      for (const d of drafts) d.does = tried.by[d.letter] || '';
      const ran = drafts.filter((d) => d.does);
      if (ran.length >= 2) drafts = ran;
      else tried = null;
    }
    const row = {
      slot: 'run',
      member: 'sandbox',
      stage: 'run',
      ms: Date.now() - at,
      out: tried ? tried.summary : 'The drafts could not be tried on calls: they are compared as text.',
      final: '',
      ok: !!tried,
    };
    trace.push(row);
    onStep(row);
  }
  // two answers are the same answer when they do the same (where they were run), or read the same (where they were not)
  const keyOf = (x) => (tried && x.does ? 'does:' + x.does : plain(x.final));
  const tallyOf = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, { key: k, final: r.final, by: [] });
      m.get(k).by.push(r.slot);
    }
    return [...m.values()].sort((a, b) => b.by.length - a.by.length);
  };
  let votes = tallyOf(drafts);
  let decided = '';
  let path = '';
  let work = '';
  const lettered = drafts;
  const agreed = drafts.length >= 2 && votes.length === 1;
  if (agreed && plan.agreeSkipsChecks !== false) {
    decided = votes[0].final;
    path = 'agreed';
  } else if (drafts.length) {
    // ---- check
    // ONE WORKED ANSWER FOR EACH DIFFERENT ANSWER (plan.onePerAnswer; after arXiv 2610.21290): shown every draft, a checker or a
    // checker can count heads, and three drafts that share a slip outvote one that is right. Shown one for each distinct answer,
    // it has only the reasoning to go on. Where the drafts were run, there is one for each BEHAVIOUR in any case: two drafts that
    // do the same are not two answers.
    const distinct = lettered.filter((d, i) => lettered.findIndex((x) => keyOf(x) === keyOf(d)) === i);
    const table = plan.onePerAnswer || tried ? distinct : lettered;
    const parted = tried ? tried.differ(table.map((d) => d.letter)) : '';
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
        .join('\n\n') +
      (parted ? '\n\n' + parted : '');
    const asked = (s) => [
      sys(s),
      ...kept.slice(0, -1),
      { role: 'user', content: shown(s.sees !== 'finals') }, // a checker may be shown the answers without their work
    ];
    const checkRows = await all(stage('check'), asked);
    // A CHECKER THAT RAN OUT OF ROOM BEFORE IT ANSWERED IS ASKED FOR ITS ANSWER, in one line. It has done the work (it was cut off
    // re-deriving every answer at length); what is missing is the last line. Asked on the same slot, with the end of what it wrote.
    await Promise.all(
      checkRows
        .filter((c) => !c.ok && !c.why && c.out.trim())
        .map(async (c) => {
          const slot = stage('check').find((s) => s.id === c.slot);
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
    const checks = checkRows.filter((c) => c.ok);
    // a checker that answered with a letter means that answer, whole
    // (not where the answers themselves are letters: there a letter is an answer, not a pointer to one)
    const lettersAreAnswers = table.some((d) => /^[A-Za-z]$/.test(String(d.final).trim()));
    for (const c of lettersAreAnswers ? [] : checks) {
      const letter = letterOf(c.out, marker, LETTERS);
      const meant = letter && table.find((d) => d.letter === letter);
      if (meant) ((c.final = meant.final), (c.picked = letter), (c.does = meant.does));
    }
    // a checker that wrote code of its own: what does that do, on the same calls?
    if (tried)
      for (const c of checks)
        if (!c.picked && c.final) {
          const twin = lettered.find((d) => plain(d.final) === plain(c.final));
          try {
            c.does = twin ? twin.does : await tried.sigOf(c.final);
          } catch {
            c.does = '';
          }
        }
    const counted = checks.filter((c) => c.final && (!tried || c.does));
    votes = tallyOf([...drafts, ...counted]);
    // ---- decide: a decision model (Kev, decider.mjs), in one request that returns a probability for each different answer.
    // No slot judges: a model that writes is not asked to pick. Where Kev is not named or does not answer, the answer most
    // slots gave stands.
    let ruled = null;
    if (decide && distinct.length > 1) {
      onStart({ slot: 'kev-decide', member: 'kev', stage: 'decide' });
      const k = await decide({
        question,
        answers: distinct.map((d) => ({ letter: d.letter, final: d.final, work: workOf(d.out, marker) })),
        checks: [...checks.map((c) => c.out), ...(parted ? [parted] : [])],
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
      const chosen = distinct.find((d) => plain(d.final) === plain(decided));
      path =
        votes.length && (chosen ? keyOf(chosen) : plain(decided)) === votes[0].key ? 'decided' : 'decided-against-most';
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
  // CODE GOES OUT AS IT WAS SETTLED, and no slot is asked to write it out again: it could only change it, or (a model trained to
  // call tools) hand it over as a tool call. plan.writeCode: true asks the writer all the same.
  const asIs = decided && isCode(decided) && plan.writeCode !== true;
  if (asIs) reply = '```' + (/\bfunction\b|=>|\b(?:const|let)\s/.test(decided) ? 'js' : '') + '\n' + decided + '\n```';
  else if (decided && writers.length) {
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
  return {
    reply,
    decided,
    path: path || 'fallback',
    ms: Date.now() - t0,
    trace,
    ok: !!reply,
    tried: tried ? { calls: tried.calls, groups: tried.groups } : null,
  };
}
