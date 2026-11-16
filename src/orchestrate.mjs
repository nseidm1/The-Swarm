// orchestrate.mjs - ONE MESSAGE IN, ONE REPLY OUT, AND EVERY SLOT USED ON THE WAY.
// THE WAY IS A FLOW: a list of steps (briefs.json: "flow"), run in order over the answers that stand. It is not fixed. The
// arrangement that brings two small models to parity with a much larger one is found by trying arrangements, and the flow is the
// part of an arrangement that says what happens in what order, how often, and what settles it:
//   draft    several slots answer the question, each told to go about it differently, all at once
//   try      where code is asked for, the answers are run on the same calls: those that do the same are one answer (behave.mjs)
//   check    slots that are shown the different answers and look for what is wrong with them, all at once
//   revise   the answers go back to the slots that wrote them, with the others, where they part and what the checkers said;
//            each gives its answer again
//   decide   which answer stands: a decision model (Kev). No slot judges. { keep: 2 } does not settle it: it keeps the likeliest
//            two, and the flow goes on with those (so there can be more than one decision)
//   repeat   { steps, upTo }: steps done again while the answers still differ
//   write    one or more slots write the reply a person reads, from what was settled; with more than one, the decider picks.
//            Code goes out as it was settled
// A step that works on a dispute (check, revise, decide, repeat) is passed over when every answer is the same one. With no flow
// named, it is draft, try, check, decide, write.
// What each slot is told is in briefs.json; this file is the order of things, and what happens when a slot fails (the others
// carry on; if Kev is not there or decides nothing, the answer most slots hold stands; if nothing can be written, the best draft
// is the reply). It knows nothing of servers: `ask(slot, messages)` is handed in, and returns { text } or throws.
//   const { reply, path, trace } = await answer(messages, { briefs, ask });
import {
  finalOf as readFinal,
  workOf as readWork,
  plain,
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
// the flow of an arrangement: the one it names, or the plain one
export const DEFAULT_FLOW = [{ do: 'draft' }, { do: 'try' }, { do: 'check' }, { do: 'decide' }, { do: 'write' }];
export const flowOf = (briefs) => (Array.isArray(briefs.flow) && briefs.flow.length ? briefs.flow : DEFAULT_FLOW);
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

  // ================================================================ THE FLOW
  // What is known as the steps run. pool: the answers standing (one for each slot that has answered, its latest). remarks: what
  // the checkers of the latest check said. backers: slots that named an answer without writing one (checkers).
  const byId = Object.fromEntries(briefs.slots.map((s) => [s.id, s]));
  const slotsOf = (step, dflt) =>
    step.slots ? step.slots.map((id) => byId[id]).filter(Boolean) : dflt ? stage(dflt) : [];
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
        all(slotsOf(step, 'draft'), (s) => [sys(s), ...kept]),
        byBehaviour && !S.probe ? run(prober, [sys(prober), ...kept]) : null,
      ]);
      if (probe) S.probe = probe;
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
        slotsOf(step, 'draft').map((s) => ({ ...s, stage: 'revise' })),
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
    // WHICH ANSWER STANDS: a decision model (Kev, decider.mjs), in one request that returns a probability for each different
    // answer. No slot judges. Where Kev is not named or does not answer, the answer most slots hold stands.
    //   keep: n   it does not settle the matter: it keeps the n likeliest answers and the flow goes on with those
    async decide(step) {
      const table = distinct();
      const tally = votes();
      let ruled = null;
      if (decide && table.length > 1) {
        onStart({ slot: 'kev-decide', member: 'kev', stage: 'decide' });
        const k = await decide({
          question,
          answers: table.map((d) => ({ letter: d.letter, final: d.final, work: workOf(d.out, marker) })),
          checks: [...S.remarks, ...(S.parted ? [S.parted] : [])],
        });
        ruled = {
          slot: 'kev-decide',
          member: 'kev',
          stage: 'decide',
          ms: k.ms || 0,
          out: k.ok
            ? step.keep
              ? 'Kept the ' + Math.min(step.keep, table.length) + ' likeliest' + '.'
              : 'Picked ' + k.letter + (k.close ? ', narrowly' : '') + '.'
            : 'Decided nothing: ' + (k.why || 'no reason given') + '. The answer most slots gave stands.',
          final: k.ok ? k.final : '',
          ok: !!k.ok,
          probs: k.probs,
          yes: k.yes,
        };
        trace.push(ruled);
        onStep(ruled);
      }
      if (step.keep && table.length > step.keep) {
        // the likeliest few go on; the rest are out of it. By Kev's probabilities where it gave them, else by how many hold each
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
    write: async () => {}, // done last, below: it needs what was settled
  };
  // a step that works on a dispute is passed over when there is none
  const ONLY_IF_DISPUTED = new Set(['check', 'revise', 'decide', 'repeat']);
  async function runSteps(steps) {
    for (const step of steps) {
      const fn = STEPS[step.do];
      if (!fn || step.do === 'write') continue;
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
  const best = S.pool.find((d) => plain(d.final) === plain(decided)) || S.pool[0];
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
  if (asIs) reply = '```' + (/\bfunction\b|=>|\b(?:const|let)\s/.test(decided) ? 'js' : '') + '\n' + decided + '\n```';
  else if (decided && writers.length) {
    const rows = await all(writers, (s) => [
      sys(s),
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
    if (rows.some((w) => !w.ok && isToolCall(w.out)) && !rows.some((w) => w.ok)) path += '+tool-call';
    // CODE IS NOT TO BE REWRITTEN ON THE WAY OUT: a reply whose code is not the code that was settled is not sent
    const kept2 = rows.filter(
      (w) => w.ok && !(isCode(decided) && plain(finalOf(w.out.trim(), marker)) !== plain(decided)),
    );
    if (rows.some((w) => w.ok) && !kept2.length) path += '+code-restored';
    if (kept2.length === 1) reply = kept2[0].out.trim();
    else if (kept2.length > 1) {
      // SEVERAL REPLIES WERE WRITTEN: the decider picks the one that says what was settled best. With none, the first
      reply = kept2[0].out.trim();
      if (decide) {
        onStart({ slot: 'kev-decide', member: 'kev', stage: 'decide' });
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
          slot: 'kev-decide',
          member: 'kev',
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
    tried: S.tried ? { calls: S.tried.calls, groups: S.tried.groups } : null,
  };
}
