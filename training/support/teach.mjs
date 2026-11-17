// teach.mjs - WHAT A TEACHER IS SHOWN WHEN IT WRITES BRIEFS FOR A SLOT, and how its answer is read. One prompt for every teacher:
// the larger model the swarm is chasing (write-briefs.mjs: on this machine, at no cost) and Claude (a teacher named to the session,
// on the owner's plan). Only TRAIN questions are shown: the held ones are never shown to anything that writes a brief.
import fs from 'node:fs';
import path from 'node:path';

// what this slot wrote on the train questions the swarm then got wrong, with the larger model's answer (the one wanted)
export function missesOf(work, slotId, { seed = null, most = 8 } = {}) {
  const runs = path.join(work, 'swarm-runs.jsonl');
  const out = [];
  if (!fs.existsSync(runs)) return out;
  const lines = fs.readFileSync(runs, 'utf8').split('\n').filter(Boolean).slice(-600);
  for (const l of lines.reverse()) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (r.split !== 'train' || (seed !== null && r.seed !== seed)) continue;
    const s = (r.trace || []).find((x) => x.slot === slotId && x.same !== true);
    if (!s || r.grade === 'right' || !r.ref) continue;
    if (out.some((x) => x.question === String(r.ask || '').slice(0, 600))) continue;
    out.push({
      question: String(r.ask || '').slice(0, 600),
      slotWrote: String(s.out || s.why || '(nothing)').slice(-500),
      wanted: String(r.refReply || r.ref).slice(0, 600),
    });
    if (out.length >= most) break;
  }
  return out;
}
export const briefAsk = (slot, missed) =>
  'A small language model (2 to 3 billion parameters) fills one role among several in a group that answers questions together. ' +
  'Its role: ' +
  slot.stage +
  '. It is told this, and nothing else, before it is shown its input:\n\n' +
  slot.brief +
  '\n\nHere is what it wrote on questions the group then got wrong, with the answer that was wanted:\n' +
  JSON.stringify(missed, null, 1) +
  '\n\nWrite three different replacements for what it is told. Each must be plain instructions a small model can follow, under 110 words, ' +
  'general (never mention these questions or their answers), and must keep the rule that the last line starts with ANSWER: and holds only the answer' +
  (slot.stage === 'write'
    ? ' (this role is the exception: it writes the reply a person reads and has no ANSWER line)'
    : '') +
  '. Reply with JSON only: [{"name":"...","brief":"..."}]';
// TEACHING WITH REASONING, for the question in hand (training/loop.mjs): the larger model is shown what one slot wrote where the
// swarm fell short of its answer (no slot drafted it: `drafting`; a slot had it and it was not chosen: `choosing`), first says what
// went wrong, in general terms, and then writes briefs that teach the method rather than the answer. Never this question, never its
// answer: a brief is kept only if it brings the question to parity and loses none already there, and every later question tests it
export const teachAsk = (slot, missed, lost = 'drafting') =>
  'A small language model (1 to 4 billion parameters) fills one role among several in a group that answers questions together. ' +
  'Its role: ' +
  slot.stage +
  '. It is told this, and nothing else, before it is shown its input:\n\n' +
  slot.brief +
  '\n\n' +
  (lost === 'choosing'
    ? 'On the question below one of the group had the wanted answer, and the group still settled on another. Here is what this role wrote, with the answer that was wanted:\n'
    : 'On the question below no one in the group wrote the wanted answer. Here is what this role wrote, with the answer that was wanted:\n') +
  JSON.stringify(missed, null, 1) +
  '\n\nFirst work out what went wrong, as a general mistake (a misread rule, a missed edge case, a wrong method), not as this ' +
  'question. Then write three different replacements for what it is told that would teach a small model to avoid that kind of ' +
  'mistake: plain instructions, under 110 words each, about method and checking, general (never mention this question, its ' +
  'numbers or its answer), keeping the rule that the last line starts with ANSWER: and holds only the answer' +
  (slot.stage === 'write'
    ? ' (this role is the exception: it writes the reply a person reads and has no ANSWER line)'
    : '') +
  '. Reply with JSON only: [{"name":"...","why":"the general mistake, one sentence","brief":"..."}]';
// the candidates in a teacher's reply: [{ name, brief }], or none
export function candidatesIn(text, prefix = 'teacher') {
  const s = String(text || '');
  try {
    const got = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1));
    return (Array.isArray(got) ? got : [])
      .filter((c) => c && typeof c.brief === 'string' && c.brief.length > 40 && c.brief.length < 1600)
      .map((c) => ({
        name: prefix + ': ' + String(c.name || 'a rewrite').slice(0, 40),
        brief: c.brief.trim(),
        ...(typeof c.why === 'string' && c.why.trim() ? { why: c.why.trim().slice(0, 300) } : {}),
      }));
  } catch {
    return [];
  }
}
