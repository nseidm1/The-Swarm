// written.mjs - CODE TRAINING WROTE, RUN WHERE IT CAN REACH NOTHING. An instrument (instruments.mjs) is code a person wrote for
// an operation a person foresaw. This is the same thing found by training: for a kind of question the swarm was short on, a
// model was asked for a function that works the answer out from the question's own text, the function was run on training's
// questions, and it was kept, as every change is, only where held questions gained (training/write-code.mjs). What was kept
// is carried in the class's plan (plan.written: [{ id, kind, name, code }]) and so goes wherever the module goes.
//   writtenFor(question, written) -> { id, name, answer } or null
// A function answers only where it reads the whole of what it needs: it returns null and the question goes the way every
// other question goes. It is never run in this process (sandbox.mjs: a process of its own, no files, no programs, no network
// handed to it, each call stopped after a moment). Where it cannot be run here at all, nothing changes.
import { outputsOf } from './sandbox.mjs';
import { bare } from './instruments.mjs';

export const WRITTEN_NAME = 'answer';
export const WRITTEN_MOST = 12; // (functions on for one class: each is one short run before any model is asked)
const CODE_MOST = 20000;

// which of a plan's entries are functions that can be run: [{ id, kind, name, code }]
export const writtenOn = (written) =>
  (Array.isArray(written) ? written : [])
    .filter(
      (w) =>
        w &&
        typeof w.id === 'string' &&
        w.id &&
        typeof w.code === 'string' &&
        w.code.trim() &&
        w.code.length <= CODE_MOST,
    )
    .slice(0, WRITTEN_MOST);

// what one run gave, as an answer: a string that says something, or a number; null for null, nothing, an error, anything else
export function answerOf(o) {
  if (!o || o.e || typeof o.v !== 'string') return null;
  let v;
  try {
    v = JSON.parse(o.v);
  } catch {
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  v = v.trim();
  return v && v.length <= 2000 && !/^__[\w.-]+__$/.test(v) ? v : null;
}

// each function's answer to each question, run once: [[answer | null, ...] per question] (training vets with this)
export async function answersOf(code, questions, { timeoutMs = 8000 } = {}) {
  const out = await outputsOf(
    code,
    WRITTEN_NAME,
    questions.map((q) => [bare(q)]),
    { timeoutMs },
  );
  return out ? out.map(answerOf) : null;
}

export async function writtenFor(question, written, { timeoutMs = 3000 } = {}) {
  const q = bare(question);
  if (!q || q.length > 4000) return null;
  for (const w of writtenOn(written)) {
    const out = await outputsOf(w.code, WRITTEN_NAME, [[q]], { timeoutMs });
    const answer = answerOf(out && out[0]);
    if (answer !== null)
      return { id: w.id, kind: w.kind || '', name: w.name || 'answered by code training wrote', answer };
  }
  return null;
}
