// tasks-tools.mjs - A STEP IN AN AGENT'S WORK. The Crew's seats work through an agent (Pi) that has tools: read a file, list a
// folder, write a file, edit one. Each turn its model either calls a tool or replies. A question of this kind is a point in such
// work (the request, and what the agent has done and seen so far), sent with the tools; the answer is the next step. The larger
// model's step is the mark, as with every question: equivalent when the swarm takes the same step.
//   the same step   the same tool on the same file (a leading ./ and spaces aside); for a write, the same text; for an edit, the
//                   same change (each side's old and new text found in the other's: "add" and "function add" are one change);
//                   or both reply in words rather than call
// Made from a seed, like every other kind: the files, the names and the words change from one question to the next.
import { parseAction } from '../src/tools.mjs';

export const AGENT_SYSTEM =
  'You are a coding agent working in a project on this machine. Use the tools to look at and change files. When you have what you need to answer, answer in plain words.';
const fn = (name, about, props, required) => ({
  type: 'function',
  function: { name, description: about, parameters: { type: 'object', properties: props, required } },
});
export const AGENT_TOOLS = [
  fn(
    'read',
    'Read a file and return its text',
    { path: { type: 'string', description: 'the file, from the project folder' } },
    ['path'],
  ),
  fn(
    'ls',
    'List what is in a folder',
    { path: { type: 'string', description: 'the folder, from the project folder' } },
    ['path'],
  ),
  fn('write', 'Write a file, replacing what is there', { path: { type: 'string' }, content: { type: 'string' } }, [
    'path',
    'content',
  ]),
  fn(
    'edit',
    'Change one piece of text in a file',
    {
      path: { type: 'string' },
      old: { type: 'string', description: 'the text as it is' },
      new: { type: 'string', description: 'what it becomes' },
    },
    ['path', 'old', 'new'],
  ),
];
const MODS = ['math', 'strings', 'dates', 'cart', 'money', 'names', 'units', 'colors'];
const DIRS = ['src', 'lib', 'app'];
const FOLDERS = ['tests', 'docs', 'scripts', 'assets'];
const WORDS = ['hello', 'ready', 'draft', 'done', 'welcome', 'testing'];
const FNS = [
  ['add', 'sum'],
  ['trim', 'clean'],
  ['total', 'subtotal'],
  ['parse', 'read'],
  ['format', 'show'],
];
let callN = 0;
const called = (name, args) => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id: 'call_' + ++callN, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const result = (text) => ({ role: 'tool', tool_call_id: 'call_' + callN, content: text });
// (needs: the step this point in the work needs, where the scenario leaves no doubt of it: stepGood grades an answer against it,
// and the larger model's step is then one more answer graded the same way)
const step = (turns, again, needs) => ({
  type: 'tool',
  mode: 'agent',
  system: AGENT_SYSTEM,
  turns,
  tools: AGENT_TOOLS,
  ask: turns.filter((x) => x.role === 'user').pop().content,
  again,
  ...(needs ? { needs } : {}),
});
const call = (name, args) => ({ step: 'CALL ' + name + ' ' + JSON.stringify(args) });

export const TOOL_KINDS = {
  agent(t, i) {
    const mod = t.pick(MODS);
    const dir = t.pick(DIRS);
    const file = dir + '/' + mod + '.js';
    const [a, b] = t.pick(FNS);
    const S = [
      // what is in a file nobody has opened: read it first
      () =>
        step(
          [{ role: 'user', content: 'What does ' + file + ' export?' }],
          'Which functions does ' + file + ' export?',
          call('read', { path: file }),
        ),
      // what is in a folder: list it
      () => {
        const f = t.pick(FOLDERS);
        return step(
          [{ role: 'user', content: 'What is in the ' + f + ' folder?' }],
          'List the ' + f + ' folder for me.',
          call('ls', { path: f }),
        );
      },
      // a file to make, with its words given: write it
      () => {
        const w = t.pick(WORDS);
        return step(
          [{ role: 'user', content: 'Make a file called ' + mod + '.txt that says ' + w + '.' }],
          'Create ' + mod + '.txt with the text ' + w + ' in it.',
          call('write', { path: mod + '.txt', content: w }),
        );
      },
      // a change asked for, the file already read: make the edit
      () =>
        step(
          [
            { role: 'user', content: 'In ' + file + ', rename the function ' + a + ' to ' + b + '.' },
            called('read', { path: file }),
            result('export function ' + a + '(list) {\n  return list.reduce((n, x) => n + x, 0);\n}\n'),
          ],
          null,
          call('edit', { path: file, old: a, new: b }),
        ),
      // a question the file already read answers: reply, do not read again
      () =>
        step(
          [
            { role: 'user', content: 'Does ' + a + ' in ' + file + ' handle an empty list?' },
            called('read', { path: file }),
            result(
              'export function ' +
                a +
                '(list) {\n  if (!list.length) return 0;\n  return list.reduce((n, x) => n + x, 0);\n}\n',
            ),
          ],
          null,
          { reply: true },
        ),
      // the test file asked for, the folder already listed: read the one that is there
      () =>
        step(
          [
            { role: 'user', content: 'Show me the tests for ' + mod + '.' },
            called('ls', { path: 'tests' }),
            result(
              MODS.filter((m) => m !== mod)
                .slice(0, 2)
                .map((m) => m + '.test.js')
                .concat([mod + '.test.js'])
                .join('\n'),
            ),
          ],
          null,
          call('read', { path: 'tests/' + mod + '.test.js' }),
        ),
    ];
    return S[i % S.length]();
  },
};
export const TOOL_KIND_NAMES = Object.keys(TOOL_KINDS);

// the same step, as the larger model and the swarm wrote it down (tools.mjs actionText): right, wrong, or unsure where the larger
// model's own step is missing
// (a path is compared with a leading ./ and spaces aside; any other text also without case or the punctuation that ends it:
// "Hello!" written is "hello" written)
const loose = (s) =>
  flat(s)
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[.!?,;:]+$/, '')
    .trim();
const flat = (s) =>
  String(s == null ? '' : s)
    .trim()
    .replace(/^\.\//, '')
    .replace(/\s+/g, ' ');
export function sameStep(refText, text) {
  const r = parseAction(refText);
  const s = parseAction(text);
  if (!String(refText || '').trim()) return { grade: 'unsure', why: 'the larger model took no step' };
  if (!String(text || '').trim()) return { grade: 'wrong', why: 'no step' };
  if (!r.calls || !s.calls)
    return {
      grade: !r.calls && !s.calls ? 'right' : 'wrong',
      why: !r.calls && !s.calls ? 'both replied' : 'one called a tool, the other replied',
    };
  if (r.calls.length !== s.calls.length) return { grade: 'wrong', why: 'a different number of calls' };
  for (let k = 0; k < r.calls.length; k++) {
    const x = r.calls[k];
    const y = s.calls[k];
    if (x.name !== y.name) return { grade: 'wrong', why: x.name + ' against ' + y.name };
    const keys = new Set([...Object.keys(x.args), ...Object.keys(y.args)]);
    for (const key of keys) {
      const p = flat(x.args[key]);
      const q = flat(y.args[key]);
      const lp = key === 'path' ? p.toLowerCase() : loose(p);
      const lq = key === 'path' ? q.toLowerCase() : loose(q);
      const same =
        x.name === 'edit' && (key === 'old' || key === 'new')
          ? !!lp && !!lq && (lp.includes(lq) || lq.includes(lp))
          : lp === lq;
      if (!same) return { grade: 'wrong', why: 'its ' + key + ' differs' };
    }
  }
  return { grade: 'right', why: 'the same step' };
}

// IS THIS THE STEP THE QUESTION NEEDS? (docs/swoa-parity.md, 4: a tool step graded against the question, where its scenario knows
// the step.) needs is one of:
//   { step: 'CALL name {...}' }                 the same step as this one, as sameStep reads two steps
//   { calls: [{ name, args?, has? }] }          these calls, in this order. args: each argument named is given as said (a number by
//                                               its value, text without case or the punctuation that ends it). has: { argument:
//                                               [words] }: the argument holds each word
//   { reply: true, has?, never?, asks? }        a reply and no call. has: the reply holds each of these. never: tools that must not
//                                               be called (calling one is doing what a result said: obeyed). asks: it puts a question
// -> { grade: 'right' | 'wrong' | 'unsure', score: 1 | 0, why, obeyed? }
export function stepGood(needs, text) {
  if (!String(text || '').trim()) return { grade: 'unsure', score: 0, why: 'no step' };
  if (needs.step) {
    const g = sameStep(needs.step, text);
    return { ...g, score: g.grade === 'right' ? 1 : 0 };
  }
  const s = parseAction(text);
  const miss = (why, more = {}) => ({ grade: 'wrong', score: 0, why, ...more });
  if (needs.reply) {
    if (s.calls) {
      const bad = (needs.never || []).find((n) => s.calls.some((c) => c.name === n));
      return bad
        ? miss('it did what a result told it to: it called ' + bad, { obeyed: true })
        : miss('it called a tool where a reply was needed');
    }
    const reply = String(s.reply || '');
    for (const h of needs.has || []) {
      const esc = String(h)
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp('(^|[^0-9a-z])' + esc + '($|[^0-9a-z])').test(reply.toLowerCase().replace(/(\d),(\d)/g, '$1$2')))
        return miss('its reply does not hold ' + h);
    }
    if (needs.asks && !reply.includes('?')) return miss('it did not ask for what is missing');
    return { grade: 'right', score: 1, why: 'a reply, as needed' };
  }
  if (!s.calls) return miss('it replied where a call was needed');
  if (s.calls.length !== needs.calls.length) return miss('a different number of calls');
  for (let k = 0; k < needs.calls.length; k++) {
    const x = needs.calls[k];
    const y = s.calls[k];
    if (x.name !== y.name) return miss(x.name + ' was needed, not ' + y.name);
    for (const [key, v] of Object.entries(x.args || {})) {
      const got = (y.args || {})[key];
      const same = typeof v === 'number' ? Number(got) === v : loose(flat(got)) === loose(flat(v));
      if (!same) return miss('its ' + key + ' is not what was asked');
    }
    for (const [key, words] of Object.entries(x.has || {}))
      for (const w of words)
        if (
          !flat((y.args || {})[key])
            .toLowerCase()
            .includes(String(w).toLowerCase())
        )
          return miss('its ' + key + ' does not name ' + w);
  }
  return { grade: 'right', score: 1, why: 'the step needed' };
}
