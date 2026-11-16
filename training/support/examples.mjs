// examples.mjs - WORKED EXAMPLES FOR THE SLOTS: the larger model's own answers to this pass's TRAIN questions, a few of each kind,
// gathered as briefs.examples so that the arrangement search can try showing them to a drafter (arrange.mjs). The swarm is
// brought to parity with what the larger model answers; seeing how it answers questions like the one in hand is the most direct
// way to draft as it does. Never a held question: those are never shown to anything that is chosen on them.
// An arrangement that was kept with examples keeps the ones it was measured with.
import { questions, reference } from './bench.mjs';

export function examplePool({ each = 6, perKind = 2, most = 26, list = null, ref = null } = {}) {
  const qs = list || questions('train', each);
  const answers = ref || reference(qs);
  const byKind = new Map();
  for (const t of qs) {
    const a = String(answers.get(t.id) || '').trim();
    if (!a || a.length > 1800 || !t.ask || t.ask.length > 1500) continue;
    const k = byKind.get(t.kind) || [];
    k.push({ kind: t.kind, ask: t.ask, answer: a });
    byKind.set(t.kind, k);
  }
  // the shortest answers of each kind first: they show the substance with the least to read
  const out = [];
  for (const k of byKind.values()) out.push(...k.sort((x, y) => x.answer.length - y.answer.length).slice(0, perKind));
  return out.slice(0, most);
}
// the briefs as they are, with a pool of examples where they have none (where no slot is shown any, this changes nothing they do)
export const withExamples = (briefs, o = {}) =>
  Array.isArray(briefs.examples) && briefs.examples.length ? briefs : { ...briefs, examples: examplePool(o) };
