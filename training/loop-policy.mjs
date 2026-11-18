// loop-policy.mjs - HOW THE LOOP SEARCHES, AS DATA THAT CAN CHANGE WHILE IT RUNS. Which change is tried first on a question that is
// short of parity, which are left out, how far the search goes before it builds on what came closer: all of it is read from a
// policy (the knobs below), not fixed in code. Every few questions that needed a change the larger model is shown the loop's own
// record and this list, and proposes a change to one or two knobs (reviewProposal). A proposal is checked against the list (only
// the knobs here, only values within their bounds), put ON TRIAL for the next tries, and measured against
// as many tries before it: kept where the search did at least as well, put back where it did worse (verdictOf). What is kept
// stays, on disk (.work/library/<configuration>-policy.json, which Clear training state keeps), so the policy goes on improving.
// What it cannot do: change code. An idea the larger model has that no knob can carry is written down as an idea, for a person.
export const AREAS = ['slots', 'briefs', 'flow', 'loops', 'decider', 'several'];
export const RANKS = ['pin', 'evidence', 'momentum', 'learned', 'area', 'cost', 'fresh', 'plan'];
const LOSSES = ['drafting', 'choosing', 'writing'];

// THE KNOBS: what each is, its bounds, its default. The larger model is shown exactly this
export const KNOBS = {
  order: {
    about:
      "The order of the keys changes are ranked by, first decides most. pin: a person pinned it. evidence: what the question's own record says will help. momentum: like a change kept recently. learned: how often its kind has reached parity. area: the area of change for where the answer was lost. cost: how much slower its kind makes a run. fresh: tried least. plan: the plan's own order.",
    kind: 'permutation',
    of: RANKS,
    default: ['pin', 'evidence', 'momentum', 'learned', 'area', 'cost', 'fresh', 'plan'],
  },
  learnedMinTried: {
    about:
      'How many times a kind of change must have been tried before how often it reached parity counts in the order.',
    kind: 'int',
    min: 1,
    max: 20,
    default: 3,
  },
  momentumRecent: {
    about:
      'How many of the most recent kept changes count for momentum (0: none). A change is like a kept one when it names the same slot, or most of its words are the same.',
    kind: 'int',
    min: 0,
    max: 10,
    default: 3,
  },
  skipWriterUnlessWriting: {
    about: 'Leave out changes to the writer unless the answer was lost in the writing.',
    kind: 'bool',
    default: true,
  },
  skipDecidingUnlessChoosing: {
    about: 'Leave out changes to how the matter is decided unless a slot had the answer and it was not chosen.',
    kind: 'bool',
    default: true,
  },
  partialCredit: {
    about:
      "Count partial credit as closer: of code, the share of inputs the nearest answer gives as the larger model's does; of words, the reader's probability. Without it, closer means only that more slots had the answer.",
    kind: 'bool',
    default: true,
  },
  batch: {
    about:
      'How many changes are tried from the closest arrangement before the search looks again for the closest (small: build on what came closer sooner; 0: try every change from it first).',
    kind: 'int',
    min: 0,
    max: 200,
    default: 8,
  },
  beam: {
    about: 'How many arrangements that came closer are kept open to build on at once.',
    kind: 'int',
    min: 1,
    max: 10,
    default: 3,
  },
  areas: {
    about: 'For each place an answer can be lost (drafting, choosing, writing), the order of the areas of change.',
    kind: 'areas',
    default: {
      drafting: ['slots', 'briefs', 'flow', 'loops', 'decider', 'several'],
      choosing: ['decider', 'loops', 'flow', 'briefs', 'slots', 'several'],
      writing: ['slots', 'briefs', 'flow', 'decider', 'loops', 'several'],
    },
  },
  brokeBudget: {
    about:
      'How many changes on one question are built on arrangements that brought it to parity but broke a question already at parity, before the search goes back to the rest (0: such arrangements are not built on).',
    kind: 'int',
    min: 0,
    max: 200,
    default: 12,
  },
  reviewTries: {
    about:
      'How many tries (on any question) between reviews of the search by the larger model, when nothing is on trial.',
    kind: 'int',
    min: 10,
    max: 1000,
    default: 40,
  },
  trialTries: {
    about:
      'On how many tries a proposed policy is tried before it is kept or put back: what its tries came to (kept 10, at parity but losing a question already there 3, closer 1, nothing 0) against as many before it.',
    kind: 'int',
    min: 20,
    max: 1000,
    default: 40,
  },
  suggestEvery: {
    about:
      'After how many failed tries on a question the larger model is shown that question, what was tried and how close it came, and the changes still open, and names a few to try next, tried at once (0: never). Each costs a start of the larger model; its cost and what its suggestions came to are in the record.',
    kind: 'int',
    min: 0,
    max: 500,
    default: 20,
  },
  teachEvery: {
    about:
      'After how many failed tries on a question the larger model is shown what the failing slots wrote and the answer wanted (the drafters where no slot drafted it; the checkers where one did and it was not chosen), says what went wrong in general terms, and writes new briefs that teach the method, tried at once (0: never).',
    kind: 'int',
    min: 0,
    max: 1000,
    default: 20,
  },
  adaptAfter: {
    about:
      "After how many tries on one question, the larger model having written briefs for it, the question is flagged as beyond rearranging: the larger model's answers are made ready as a dataset to train a small model on, and whether each small model can be trained here is measured (0: never).",
    kind: 'int',
    min: 0,
    max: 5000,
    default: 200,
  },
  prune: {
    about:
      'After a win of several changes, try it without each part and keep the smallest that still reaches parity and loses no question.',
    kind: 'bool',
    default: true,
  },
  stableAfter: {
    about:
      'Where every question already at parity that changes for the question in hand have broken is among the same few (stableMax at most), after this many losses of them together a change that loses only those is kept and they go back in hand, sooner than swapAfter (0: wait for swapAfter).',
    kind: 'int',
    min: 0,
    max: 500,
    default: 6,
  },
  stableMax: {
    about:
      'How many different questions already at parity a standing conflict may span and still be swapped after stableAfter (1: only a conflict with one question).',
    kind: 'int',
    min: 1,
    max: 5,
    default: 2,
  },
  setAsideAfter: {
    about:
      'After this many tries in a row that bring the question in hand neither closer nor to parity, it is set aside while another question waits, and comes back after them on the arrangement they leave; where nothing has changed by then it gets as many tries again, and is written down as not reached if they bring it nothing closer (0: never set aside).',
    kind: 'int',
    min: 0,
    max: 500,
    default: 30,
  },
  helpBackoff: {
    about:
      "The larger model's suggestions and new briefs come half as often on a question each time they bring it nothing (no parity, nothing closer), and back to every suggestEvery / teachEvery tries when they do.",
    kind: 'bool',
    default: true,
  },
  kindBranch: {
    about:
      'Where a change brings the question in hand to parity and every question it loses is of the other kind (code, or words), keep it for its own kind only: that kind gets its own arrangement, and nothing is lost.',
    kind: 'bool',
    default: true,
  },
  swapAfter: {
    about:
      'After changes that bring the question in hand to parity have lost the same question already at parity this many times, a change that loses only that one is kept, and that question goes back in hand (once each way for a pair; 0: never).',
    kind: 'int',
    min: 0,
    max: 500,
    default: 25,
  },
};

export function defaults() {
  return Object.fromEntries(Object.entries(KNOBS).map(([k, v]) => [k, JSON.parse(JSON.stringify(v.default))]));
}

// one value checked against its knob: -> { ok, value } or { ok: false, why }
export function checkValue(knob, v) {
  const K = KNOBS[knob];
  if (!K) return { ok: false, why: 'there is no knob called ' + knob };
  if (K.kind === 'bool')
    return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, why: knob + ' takes true or false' };
  if (K.kind === 'int') {
    const n = Number(v);
    return Number.isInteger(n) && n >= K.min && n <= K.max
      ? { ok: true, value: n }
      : { ok: false, why: knob + ' takes a whole number from ' + K.min + ' to ' + K.max };
  }
  if (K.kind === 'permutation') {
    const ok = Array.isArray(v) && v.length === K.of.length && K.of.every((x) => v.includes(x));
    return ok
      ? { ok: true, value: [...v] }
      : { ok: false, why: knob + ' takes every one of ' + K.of.join(', ') + ', each once' };
  }
  if (K.kind === 'areas') {
    if (!v || typeof v !== 'object')
      return { ok: false, why: knob + ' takes an order of areas for each place an answer is lost' };
    const out = {};
    for (const l of Object.keys(v)) {
      const a = v[l];
      if (!LOSSES.includes(l) || !Array.isArray(a) || a.length !== AREAS.length || !AREAS.every((x) => a.includes(x)))
        return { ok: false, why: 'areas.' + l + ' takes every one of ' + AREAS.join(', ') + ', each once' };
      out[l] = [...a];
    }
    return { ok: true, value: out };
  }
  return { ok: false, why: 'unknown kind' };
}

// a policy read from anywhere: every knob present and within bounds, what is not falls back to the default
export function normal(p = {}) {
  const d = defaults();
  const out = {};
  for (const k of Object.keys(KNOBS)) {
    if (p[k] === undefined) out[k] = d[k];
    else {
      const c = checkValue(k, p[k]);
      out[k] = c.ok ? (KNOBS[k].kind === 'areas' ? { ...d[k], ...c.value } : c.value) : d[k];
    }
  }
  return out;
}

// what changed between two policies: [{ knob, from, to }]
export function diff(a, b) {
  return Object.keys(KNOBS)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ knob: k, from: a[k], to: b[k] }));
}

// THE PROMPT: the record, the knobs and their values, what was proposed before and how it came out. Asked for JSON only
// THE SUGGESTION: the question in hand, what was tried on it and how close each came, the arrangement the next tries build on, the
// found arrangements, and the changes still open from it, by name. Asked for JSON only: a few changes, or combinations of them, to try
export function suggestAsk(s) {
  return (
    'A swarm of small models is being brought to parity with a larger model on one question: its answer must be equivalent to the ' +
    "larger model's. Changes to the swarm are tried one at a time; none has brought it there yet.\n\n" +
    'The question, where its answer is lost, and the arrangement the next changes are tried on top of (JSON):\n' +
    JSON.stringify({ question: s.question, lostAt: s.lostAt, builtOn: s.on, howClose: s.near }).slice(0, 2500) +
    '\n\nWhat was tried on it, newest last, and how each came out (JSON):\n' +
    JSON.stringify(s.tried).slice(0, 5000) +
    '\n\nArrangements that brought other questions to parity, and conflicts (JSON):\n' +
    JSON.stringify({ found: s.library, broke: s.broke }).slice(0, 2000) +
    '\n\nThe changes still open from that arrangement, by exact name (JSON):\n' +
    JSON.stringify(s.open).slice(0, 9000) +
    '\n\nChoose up to five things to try next: each one change from that list, or two or three of them together. Prefer what the ' +
    'record says is close, what worked on other questions, and what addresses where the answer is lost. Use the names exactly as ' +
    'listed. Answer with JSON only, in this shape:\n{"try":[["<name>"],["<name>","<name>"]],"why":"<one sentence>"}'
  );
}
// the reply read for suggestions: the first JSON object, each entry one to three names from the open list (exactly, or once spaces
// and case are set aside); anything else is left out
export function suggestionsOf(text, open = []) {
  const s = String(text || '');
  let j = null;
  for (let at = s.indexOf('{'); at >= 0 && !j; at = s.indexOf('{', at + 1)) {
    for (let end = s.lastIndexOf('}'); end > at && !j; end = s.lastIndexOf('}', end - 1)) {
      try {
        j = JSON.parse(s.slice(at, end + 1));
      } catch {
        /* not this span */
      }
    }
  }
  const norm = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const byNorm = new Map(open.map((n) => [norm(n), n]));
  const picks = [];
  for (const e of (j && Array.isArray(j.try) ? j.try : []).slice(0, 8)) {
    const names = (Array.isArray(e) ? e : [e]).map((x) => byNorm.get(norm(x))).filter(Boolean);
    const uniq = [...new Set(names)].slice(0, 3);
    if (uniq.length && !picks.some((p) => p.join('|') === uniq.join('|'))) picks.push(uniq);
    if (picks.length >= 5) break;
  }
  return { picks, why: String((j && j.why) || '').slice(0, 300), read: !!j };
}

export function reviewAsk(policy, record, past = []) {
  const knobs = Object.entries(KNOBS).map(([k, v]) => ({
    knob: k,
    about: v.about,
    ...(v.kind === 'int' ? { min: v.min, max: v.max } : {}),
    ...(v.kind === 'permutation' ? { of: v.of } : {}),
    ...(v.kind === 'areas' ? { areas: AREAS, places: LOSSES } : {}),
    kind: v.kind,
    now: policy[k],
  }));
  return (
    'You are tuning the search a training loop does. A swarm of small models answers questions; each question stays in hand ' +
    "until the swarm gives an answer equivalent to a larger model's (it never moves on before), the arrangements found so far are tried first, and the loop tries changes to the swarm (a brief, a slot moved " +
    'to another model, a step in the flow) one at a time, in an order the knobs below decide. Fewer tries before parity, and more ' +
    'questions brought to parity, is better.\n\n' +
    'What the loop recorded (JSON):\n' +
    JSON.stringify(record).slice(0, 9000) +
    '\n\nThe knobs, what each does, its bounds and its value now (JSON):\n' +
    JSON.stringify(knobs) +
    '\n\nProposals already made and what came of each, including any refused for being out of bounds (never propose a refused one ' +
    "again; a value must be within its knob's bounds) (JSON):\n" +
    JSON.stringify(past.slice(-8)) +
    '\n\nRead the record for what slows the search: tries spent on kinds of change that never reach parity, changes that cannot ' +
    'help where the answer was lost, a search that never builds on what came closer, a kind that works and is tried late. ' +
    'Then propose a change to at most two knobs that would help, each with its reason in one sentence. If you see something ' +
    'that would help and no knob can carry it, say it under "ideas". Answer with JSON only, in this shape:\n' +
    '{"proposals":[{"knob":"<name>","value":<value>,"why":"<one sentence>"}],"ideas":["<one sentence>"]}'
  );
}

// the larger model's reply read for a proposal: the first JSON object in it, each change checked against its knob. At most two
// changes are taken, so that what a trial measures can be put down to them
export function proposalOf(text, policy) {
  const s = String(text || '');
  let j = null;
  for (let at = s.indexOf('{'); at >= 0 && !j; at = s.indexOf('{', at + 1)) {
    for (let end = s.lastIndexOf('}'); end > at && !j; end = s.lastIndexOf('}', end - 1)) {
      try {
        j = JSON.parse(s.slice(at, end + 1));
      } catch {
        /* not this span */
      }
    }
  }
  const next = JSON.parse(JSON.stringify(policy));
  const taken = [];
  const refused = [];
  for (const p of (j && Array.isArray(j.proposals) ? j.proposals : []).slice(0, 4)) {
    if (taken.length >= 2) break;
    const c = p && checkValue(p.knob, p.value);
    if (!c || !c.ok) {
      refused.push({ knob: p && p.knob, why: c ? c.why : 'not a proposal' });
      continue;
    }
    if (
      JSON.stringify(policy[p.knob]) ===
      JSON.stringify(KNOBS[p.knob].kind === 'areas' ? { ...policy[p.knob], ...c.value } : c.value)
    )
      continue;
    next[p.knob] = KNOBS[p.knob].kind === 'areas' ? { ...policy[p.knob], ...c.value } : c.value;
    taken.push({ knob: p.knob, from: policy[p.knob], to: next[p.knob], why: String(p.why || '').slice(0, 300) });
  }
  const ideas = (j && Array.isArray(j.ideas) ? j.ideas : [])
    .map((x) => String(x).slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
  return { policy: next, taken, refused, ideas, read: !!j };
}

// HOW WELL THE SEARCH DID ON A QUESTION THAT NEEDED A CHANGE: 1 / the changes tried, where it reached parity; 0 where it did not.
// Questions whose mark is unstable are not counted: their tries are bounded, and their parity partly a draw
export const counted = (q) => (q.attempts || []).length > 1 && q.state !== 'not compared';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// A TRIAL'S VERDICT, IN TRIES: what each try came to (kept 10, at parity but losing one already there 3, closer 1, nothing 0), the
// trial's tries against as many before it. Kept where it did at least as well; with nothing before it to compare, kept, and said
// With no signal on either side (every try came to nothing, before and during) there is nothing to judge by: INCONCLUSIVE, and the
// change is put back (measured 2026-11-17: on a long question every trial compared 0 with 0 and was kept, beam going 5, 3, 5)
export function verdictOf(before = [], during = []) {
  const b = mean(before);
  const d = mean(during) || 0;
  const inconclusive = !d && !b;
  return {
    keep: !inconclusive && (b === null || d >= b),
    ...(inconclusive ? { inconclusive: true } : {}),
    before: b === null ? null : Math.round(b * 1000) / 1000,
    during: Math.round(d * 1000) / 1000,
    beforeN: before.length,
    duringN: during.length,
    keptBefore: before.filter((x) => x >= 10).length,
    keptDuring: during.filter((x) => x >= 10).length,
  };
}

// WHAT THE LARGER MODEL IS SHOWN: the questions that needed a change (where the answer was lost, how many tries, what reached
// parity, how many came closer, what kinds were tried most), and each kind of change: tried, reached, seconds added
export function recordOf(st, current = null) {
  const hard = [
    ...st.questions.filter((q) => (q.attempts || []).length > 1),
    ...(current ? [{ ...current, inHand: true }] : []),
  ].slice(-12);
  return {
    questions: st.questions.length,
    atParityAsItStood: st.questions.filter((q) => q.state === 'at parity').length,
    neededAChange: hard.map((q) => {
      const a = q.attempts.slice(1);
      const kinds = {};
      for (const x of a) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
      const won = a.find((x) => x.kept);
      return {
        lostAt: q.lostAt,
        tries: a.length,
        reached: !!q.reached,
        ...(won ? { reachedBy: (won.on ? won.on.join(' + ') + ' + ' : '') + won.move, kind: won.kind } : {}),
        cameCloser: a.filter((x) => x.closer).length,
        ...(q.inHand ? { inHand: true } : {}),
        // reached parity here but lost a question already at parity, and which: a conflict between two questions
        ...(q.broke ? { reachedParityButBroke: q.broke } : {}),
        unstable: !!q.unstable,
        triedMost: Object.entries(kinds)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4),
      };
    }),
    kinds: Object.fromEntries(
      Object.entries(st.classes || {}).map(([k, c]) => [
        k,
        { tried: c.tried, reached: c.reached, ...(c.timed ? { secondsAdded: Math.round(c.secs / c.timed) } : {}) },
      ]),
    ),
    kept: (st.kept || []).slice(-6).map((k) => k.what),
    // the found arrangements, tried first on every question: what each is and how many questions it has brought to parity
    library: (st.library || [])
      .slice(-12)
      .map((e) => ({ what: e.what, broughtToParity: (e.reached || []).length, tried: e.tried || 0 })),
    tries: st.tryN || 0,
    // the larger model's suggestions of what to try: how often asked, what they cost, what came of them
    ...(st.suggest ? { suggestions: st.suggest } : {}),
    ...(st.teach ? { briefsWritten: st.teach } : {}),
    ...(st.pairs && Object.keys(st.pairs).length
      ? {
          conflicts: Object.entries(st.pairs)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 6)
            .map(([k, v]) => ({ inHandLoses: k, times: v })),
        }
      : {}),
    // the questions changes most often broke when asked again
    ...(st.lostOn
      ? {
          mostBroken: Object.entries(st.lostOn)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 6),
        }
      : {}),
  };
}
