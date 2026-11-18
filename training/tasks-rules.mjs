// tasks-rules.mjs - A REQUEST WITH RULES A PROGRAM CAN CHECK. Following instructions is a capability a SwOA proves on an established
// test (docs/swoa-parity.md: the battery), and training never asks that test's questions. So training makes its own: a plain request
// to write a few lines about something everyday, with one to three rules on the reply (a length, a count, words to use or leave
// out, a shape, how it opens or closes). Each rule is checked by a program, so a reply is good when every rule holds, whatever the
// larger model wrote: the question is its own standard.
// Made from a seed, like every other kind. A question's rules never contradict each other: at most one about its size or shape,
// one about its words, one about its letters and edges.
//   RULE_KINDS.rules(t, i) -> { type: 'rules', ask, again (the same request put a second way), rules: [{ id, says, holds(reply) }] }
//   rulesHeld(rules, reply) -> [true | false, ...]   which rules a reply keeps
const TOPICS = [
  'how to make a cup of tea',
  'why people keep houseplants',
  'a walk by the sea in winter',
  'how to look after a bicycle',
  'what makes a good neighbour',
  'packing a bag for a weekend away',
  'the first day at a new job',
  'cooking for one',
  'a market on a Saturday morning',
  'learning to swim as an adult',
  'keeping a small garden',
  'a long train journey',
];
const WORDS = ['window', 'quiet', 'careful', 'early', 'simple', 'bright', 'steady', 'small'];
const CLOSERS = ['That is all.', 'Thank you for reading.', 'More another day.'];
const OPENERS = ['First', 'Often', 'Today'];

const wordsIn = (s) => (String(s || '').match(/[A-Za-z0-9']+/g) || []).length;
const sentencesIn = (s) => (String(s || '').match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).length;
const lines = (s) =>
  String(s || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const hasWord = (s, w) => new RegExp('(^|[^A-Za-z])' + w + '($|[^A-Za-z])', 'i').test(String(s || ''));

// the size or shape of the reply (one at most)
const SHAPE = [
  (t) => {
    const n = t.pick([30, 40, 60]);
    return {
      id: 'at-most-words',
      says: 'Use at most ' + n + ' words.',
      holds: (r) => wordsIn(r) > 0 && wordsIn(r) <= n,
    };
  },
  (t) => {
    const n = t.pick([50, 70]);
    return { id: 'at-least-words', says: 'Use at least ' + n + ' words.', holds: (r) => wordsIn(r) >= n };
  },
  (t) => {
    const n = t.pick([2, 3, 4]);
    return { id: 'sentences', says: 'Write exactly ' + n + ' sentences.', holds: (r) => sentencesIn(r) === n };
  },
  (t) => {
    const n = t.pick([3, 4, 5]);
    return {
      id: 'bullets',
      says: 'Answer as a list of exactly ' + n + ' points, each on its own line beginning with "- ".',
      holds: (r) => lines(r).filter((l) => /^- \S/.test(l)).length === n && lines(r).every((l) => /^- \S/.test(l)),
    };
  },
  (t) => {
    const n = t.pick([2, 3]);
    return {
      id: 'paragraphs',
      says: 'Write exactly ' + n + ' paragraphs, with one blank line between them.',
      holds: (r) =>
        String(r || '')
          .trim()
          .split(/\n\s*\n/)
          .filter((p) => p.trim()).length === n,
    };
  },
];
// its words (one at most)
const WORDING = [
  (t) => {
    const [a, b] = t.mix(WORDS);
    return {
      id: 'include',
      says: 'Use the words "' + a + '" and "' + b + '".',
      holds: (r) => hasWord(r, a) && hasWord(r, b),
    };
  },
  (t) => {
    const w = t.pick(['very', 'really', 'thing', 'nice']);
    return {
      id: 'leave-out',
      says: 'Do not use the word "' + w + '".',
      holds: (r) => wordsIn(r) > 0 && !hasWord(r, w),
    };
  },
];
// its letters and its edges (one at most)
const EDGES = [
  () => ({
    id: 'lowercase',
    says: 'Write only in lowercase letters.',
    holds: (r) => /[a-z]/.test(String(r || '')) && !/[A-Z]/.test(String(r || '')),
  }),
  (t) => {
    const c = t.pick(CLOSERS);
    return {
      id: 'closing',
      says: 'End with exactly this line: ' + c,
      holds: (r) =>
        String(r || '')
          .trim()
          .endsWith(c),
    };
  },
  (t) => {
    const o = t.pick(OPENERS);
    return {
      id: 'opening',
      says: 'Begin with the word "' + o + '".',
      holds: (r) => new RegExp('^\\W*' + o + '\\b').test(String(r || '').trim()),
    };
  },
  () => ({
    id: 'no-commas',
    says: 'Do not use any commas.',
    holds: (r) => wordsIn(r) > 0 && !String(r || '').includes(','),
  }),
  () => ({
    id: 'title',
    says: 'Give it a title on the first line, wrapped in double angle brackets, like <<this>>.',
    holds: (r) => /^<<[^<>\n]+>>/.test(String(r || '').trim()),
  }),
];

export const rulesHeld = (rules, reply) => rules.map((r) => !!r.holds(reply));

export const RULE_KINDS = {
  // one to three rules that do not contradict each other: the count moves on with the question, the rules are drawn from the seed
  rules(t, i) {
    const topic = t.pick(TOPICS);
    const groups = t.mix([SHAPE, WORDING, EDGES]).slice(0, 1 + (i % 3));
    const rules = groups.map((g) => t.pick(g)(t));
    // (a title or a closing line is not one of the list's points, and a list is not sentences: such pairs are not made)
    const ids = new Set(rules.map((r) => r.id));
    const clash =
      (ids.has('bullets') && (ids.has('title') || ids.has('closing') || ids.has('opening'))) ||
      (ids.has('paragraphs') && ids.has('title')) ||
      (ids.has('lowercase') && (ids.has('opening') || ids.has('closing')));
    const kept = clash ? rules.slice(0, 1) : rules;
    return {
      type: 'rules',
      rules: kept,
      ask: 'Write a few lines about ' + topic + '. ' + kept.map((r) => r.says).join(' '),
      // (a second way: the request led into another way, every rule word for word and in the same order after it)
      again:
        'I would like a few lines about ' +
        topic +
        ', please, and they must keep to what follows. ' +
        kept.map((r) => r.says).join(' '),
    };
  },
};
export const RULE_KIND_NAMES = Object.keys(RULE_KINDS);
