// questions-list.mjs - THE QUESTIONS TRAINING ASKS, WRITTEN OUT: every train and held question of this pass's size, as it is put
// (the conversation before it, where there is one, and the person's last message), with its kind, the class of input the
// swarm takes it for, and what it is marked by. For a person to read and audit (the page's Train card: Questions), and for
// anything that sets them beside a benchmark's. Reads; writes nothing. Prints JSON.
//   node training/questions-list.mjs [--each N]
import * as B from './support/bench.mjs';
import { messagesOf, ownStandard } from './tasks.mjs';
import { classOf } from '../src/orchestrate.mjs';

const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const out = [];
for (const split of ['train', 'held'])
  for (const t of B.questions(split)) {
    const m = messagesOf(t);
    const last = m.filter((x) => x.role === 'user').at(-1);
    out.push({
      split,
      id: t.id,
      kind: t.kind,
      shape: t.shape || '',
      class: classOf(m, { tools: t.tools }),
      // (what it is marked by: a standard of its own that a program holds, or the larger model's own answers)
      standard: ownStandard(t) ? 'own' : 'target',
      want: t.want === undefined ? '' : text(t.want).slice(0, 400),
      tools: (t.tools || []).map((x) => (x.function && x.function.name) || '').filter(Boolean),
      ask: text(last && last.content),
      before: m.slice(0, m.lastIndexOf(last)).map((x) => ({ role: x.role, content: text(x.content) })),
    });
  }
process.stdout.write(JSON.stringify(out));
