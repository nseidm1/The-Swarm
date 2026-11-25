// arrange.mjs - THE ARRANGEMENT ITSELF IS TRAINED, NOT ONLY WHAT EACH SLOT IS TOLD. Which model drafts and which checks, how many
// slots draft, whether a checker sees the work or only the answers, how freely a drafter samples, how the check and decide steps
// are configured: there are countless ways to lay small models out. This file says WHAT CAN CHANGE: every arrangement one change
// from the one in hand (steps), every flow one change from this one (flowMoves), and a few several changes away (wildMoves).
// It tries none of them. Training does, question by question (training/loop.mjs), and the plan orders them (training/plan.mjs).
// What can change (each is one step from the arrangement as it is; a kept step is where the next pass starts from):
//   move      a slot to the other model
//   add       a drafter or a checker, on a model with a slot to spare (a copy of a role, sampled more freely)
//   drop      a drafter (never below two) or a checker
//   sees      a checker shown the work, or only the answers
//   heat      a drafter's temperature, up or down
//   flow      the order of steps itself: answers sent back to their drafters, a loop of checking and revising, a decision that
//             narrows before the one that settles, a second writer with the decider picking the reply, a step taken out
//   plan      one worked answer for each different answer; the checks passed over when the drafts agree; drafts of code
//             compared by what they do, or as text
import { INSTRUMENT_IDS, INSTRUMENT_NAMES, INSTRUMENT_WHOLE, instrumentsOn } from '../src/instruments.mjs';
import { briefHash } from './state.mjs';
import { SERVING } from '../src/index.mjs';
import { MANNER_FIXES, MANNER_NAMES, mannersOn } from '../src/manners.mjs';
import { FACETS, FACET_NAMES } from '../src/facets.mjs';
import { flowOf, decideByOf, COMPUTE_BRIEF } from '../src/orchestrate.mjs';

// an arrangement is known by its shape, not its words: who is where, at what stage, seeing what, how hot; and the plan
export const shapeOf = (b) =>
  briefHash(
    JSON.stringify({
      // (a drafter told what another is told, and a slot shown worked examples, say so: named only where they are, so that every
      // arrangement tried before they existed keeps its name)
      slots: b.slots.map((s) => [
        s.id,
        s.member,
        s.stage,
        s.sees || '',
        s.temperature ?? '',
        s.maxTokens ?? '',
        ...(s.copyOf ? ['as:' + s.copyOf] : []),
        ...(s.examples ? ['examples:' + s.examples] : []),
        ...(s.byFacts ? ['byFacts'] : []),
      ]),
      plan: Object.fromEntries(Object.entries(b.plan || {}).sort()),
      flow: b.flow || null,
      // (an arrangement with a flow of its own is known by another name than it had before the fault above was put right: what
      // was "tried and not kept" under the old name was never tried, and is open again)
      ...(b.flow ? { measured: 2 } : {}),
    }),
  );

// A MIXTURE OF ADAPTERS, AS MOVES. An adapter is made for a slot: that slot's own requests, on many questions of every kind
// of its class, with the answers that were right (its own first, the larger model's where it was wrong: training/mixture.mjs).
// Whether a slot CARRIES its adapter is part of the arrangement (slot.adapter, the name it is loaded under; src/index.mjs
// loraFor), and so it is tried and kept as any change to the arrangement is: on the class's train questions, and kept only
// where held questions gain beyond their error. Measured question by question, 2026-11-23: an adapter taught one kind and put
// on every drafter gained 36 points on that kind and lost 17 on the others, so there is no adapter that is simply on.
//   adapters: [{ name, slot }], the ones there are for this arrangement's slots
// -> each slot that has one and does not carry it, carrying it; every such slot carrying its own, at once; and a slot that
//    carries one, carrying none
export function adapterMoves(b, adapters = [], least = null) {
  const forSlot = (id) => (adapters || []).find((a) => a && a.slot === id && a.name);
  const can = b.slots.filter((s) => forSlot(s.id) && s.adapter !== forSlot(s.id).name);
  const withAdapter = (ids) => ({
    ...b,
    // (carried on the requests that are like what it was taught, and on no other: adapterLeast, src/index.mjs adapterFor)
    slots: b.slots.map((s) =>
      ids.includes(s.id)
        ? {
            ...s,
            adapter: forSlot(s.id).name,
            ...(least !== null && least !== undefined ? { adapterLeast: least } : {}),
          }
        : s,
    ),
  });
  return [
    ...(can.length > 1
      ? [{ name: 'adapters: every slot that has one carries its adapter', briefs: withAdapter(can.map((s) => s.id)) }]
      : []),
    ...can.map((s) => ({ name: 'adapters: ' + s.id + ' carries its adapter', briefs: withAdapter([s.id]) })),
    ...b.slots
      .filter((s) => s.adapter && s.adapter !== 'none')
      .map((s) => ({
        name: 'adapters: ' + s.id + ' carries no adapter',
        briefs: {
          ...b,
          slots: b.slots.map((x) =>
            x.id === s.id ? (({ adapter, adapterLeast: _l, adapterScale: _s, ...rest }) => rest)(x) : x,
          ),
        },
      })),
  ];
}
// every arrangement one step from this one: [{ name, briefs }]
// CODE TRAINING WROTE, AS MOVES (training/write-code.mjs: a function that was run on train questions it was not shown and
// was wrong nowhere; src/written.mjs runs it). One move for each function the class does not have on yet: the class's
// arrangement with that function asked before any model. It leaves every draft as it was, so it is tried for the cost of
// the questions it answers. made: [{ id, kind, code }]
export const writtenName = (kind) => 'code: a question of the kind "' + kind + '" is answered by code training wrote';
// A READING TRAINING WROTE IS A CHANGE LIKE ANY OTHER (training/write-reading.mjs; src/forms.mjs plan.readings): a kind of
// question laid onto a form the module ships. One move for each reading made that the arrangement does not have: it is on,
// and the questions of its kind are read into the form by the drafters and worked out by the form's code
export const readingName = (r) =>
  'reading: a question of the kind "' +
  r.kind +
  '" is read into the form "' +
  r.form +
  '" as training wrote, and worked out by code';
export function readingMoves(b, made = []) {
  const on = Array.isArray((b.plan || {}).readings) ? b.plan.readings : [];
  return (made || [])
    .filter((r) => r && r.id && r.form && !on.some((x) => x.id === r.id))
    .map((r) => ({
      name: readingName(r),
      briefs: {
        ...b,
        plan: {
          ...b.plan,
          readings: [...on, { id: r.id, form: r.form, label: r.label, about: r.about, example: r.example }],
        },
      },
    }));
}
export function writtenMoves(b, made = []) {
  const on = Array.isArray((b.plan || {}).written) ? b.plan.written : [];
  return (made || [])
    .filter((w) => w && w.id && w.code && !on.some((x) => x.id === w.id || x.kind === w.kind))
    .map((w) => ({
      name: writtenName(w.kind),
      briefs: {
        ...b,
        plan: {
          ...b.plan,
          written: [
            ...on,
            {
              id: w.id,
              kind: w.kind,
              name: 'of the kind "' + w.kind + '", answered by code training wrote',
              code: w.code,
            },
          ],
        },
      },
    }));
}
// A CHANGE KEPT FOR ONE KIND OF REQUEST (src/facets.mjs; plan.for). The class's arrangement with a change that holds only for
// requests of one facet: the rest of the class goes on as it did, so a change that mends one kind and spoils the others can
// be kept where it mends.
//   facetMoves(b, facets)          the changes worth trying for each facet the class has questions of
//   scopedMove(b, facet, move)     a change the round already tried, kept for that facet alone (where it changed the plan
//                                  and nothing else); null where it changed a slot or the flow
const facetName = (f) => 'for requests ' + (FACET_NAMES[f] || f) + ': ';
const withFor = (b, f, over) => ({
  ...b,
  plan: {
    ...b.plan,
    for: { ...((b.plan || {}).for || {}), [f]: { ...(((b.plan || {}).for || {})[f] || {}), ...over } },
  },
});
export function facetMoves(b, facets = []) {
  const has = (f, k, v) => JSON.stringify((((b.plan || {}).for || {})[f] || {})[k]) === JSON.stringify(v);
  const out = [];
  for (const f of facets.filter((x) => FACETS.includes(x))) {
    if (!has(f, 'plain', true))
      out.push({ name: facetName(f) + 'one model answers, asked as it came', briefs: withFor(b, f, { plain: true }) });
    if (f === 'closing' && !(has(f, 'plain', true) && has(f, 'manners', MANNER_FIXES)))
      out.push({
        name: facetName(f) + 'one model answers, and the reply is tidied',
        briefs: withFor(b, f, { plain: true, manners: MANNER_FIXES }),
      });
    if (f !== 'code' && !has(f, 'writeAs', 'bare'))
      out.push({
        name: facetName(f) + 'the settled answer goes out alone, with no working',
        briefs: withFor(b, f, { writeAs: 'bare' }),
      });
  }
  return out;
}
export function scopedMove(b, facet, move) {
  if (!move || !move.briefs || !FACETS.includes(facet) || /^for requests /.test(move.name)) return null;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(move.briefs.slots, b.slots) || !same(move.briefs.flow || null, b.flow || null)) return null;
  const keys = [...new Set([...Object.keys(b.plan || {}), ...Object.keys(move.briefs.plan || {})])].filter(
    (k) => k !== 'for' && !same((b.plan || {})[k], (move.briefs.plan || {})[k]),
  );
  if (!keys.length) return null;
  // (a key the change took off is said as off: null does not stand for "as the class has it")
  const over = Object.fromEntries(
    keys.map((k) => [k, (move.briefs.plan || {})[k] === undefined ? false : move.briefs.plan[k]]),
  );
  return {
    name: facetName(facet) + String(move.name).replace(/^plan: /, ''),
    briefs: withFor(b, facet, over),
    scoped: true,
  };
}
export function steps(
  b,
  {
    cap = SERVING.slots,
    members = [...new Set(b.slots.map((s) => s.member))].sort(),
    adapters = [],
    adapterLeast = null,
  } = {},
) {
  // AN INSTRUMENT TURNED ON (src/instruments.mjs): a question of the class that IS an operation is done by code. First of
  // all, since it costs nothing to try (no model is asked where it applies) and is exact where it does
  const instrOn = instrumentsOn((b.plan || {}).instruments);
  const out = [
    ...INSTRUMENT_IDS.filter((id) => !instrOn.includes(id) && !INSTRUMENT_WHOLE.includes(id)).map((id) => ({
      name: 'plan: a question ' + INSTRUMENT_NAMES[id] + ' is done by code',
      briefs: { ...b, plan: { ...b.plan, instruments: [...instrOn, id] } },
    })),
    // ONE MODEL, ASKED AS THE REQUEST CAME (src/orchestrate.mjs plan.pieceBy, plan.plain): for a piece of writing, and for
    // the whole class. A module is to do no worse than its own model, and where one slot asked plainly is the best
    // arrangement for a kind of request this is how training finds it: kept, as anything is, only where held questions gain
    ...((b.plan || {}).pieceBy === 'plain' || (b.plan || {}).plain === true
      ? []
      : [
          {
            name: 'plan: a piece of writing is written by one model, asked as it came',
            briefs: { ...b, plan: { ...b.plan, pieceBy: 'plain' } },
          },
        ]),
    ...((b.plan || {}).plain === true
      ? []
      : [{ name: 'plan: one model answers, asked as it came', briefs: { ...b, plan: { ...b.plan, plain: true } } }]),
    // A SLOT CARRIES ITS ADAPTER (adapterMoves): the mixture, one slot at a time and all of them at once
    ...adapterMoves(b, adapters, adapterLeast),
    // the flow next: with nothing measured to point anywhere, a pass tries the order of steps before it tries who sits where
    ...flowMoves(b),
  ];
  const used = (m, slots = b.slots) => slots.filter((s) => s.member === m).length;
  const withSlots = (slots) => ({ ...b, slots });
  const drafts = b.slots.filter((s) => s.stage === 'draft');
  const checks = b.slots.filter((s) => s.stage === 'check');
  for (const s of b.slots) {
    // move: to another model (any of them), where it has a slot to spare
    for (const m of members)
      if (m !== s.member && used(m) < cap)
        out.push({
          name: 'move ' + s.id + ' to ' + m,
          briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, member: m } : x))),
        });
  }
  const writers = b.slots.filter((s) => s.stage === 'write');
  for (const s of [...drafts, ...checks, ...(writers.length === 1 ? writers : [])]) {
    // add (a second writer means two replies are written, and the decider picks between them): a copy of this role on a model with a slot to spare, sampled more freely so that it is not the same voice twice
    for (const m of members) {
      if (used(m) >= cap) continue;
      const id = s.id + '-' + m + '-2';
      if (b.slots.find((x) => x.id === id)) continue;
      const at = b.slots.findIndex((x) => x.id === s.id);
      const copy = { ...s, id, member: m, temperature: Math.round(((s.temperature ?? 0.4) + 0.3) * 10) / 10 };
      out.push({
        name: 'add a second ' + s.id + ' on ' + m,
        briefs: withSlots([...b.slots.slice(0, at + 1), copy, ...b.slots.slice(at + 1)]),
      });
    }
  }
  // A DRAFTER THAT ANSWERS BY A PROGRAM (orchestrate.mjs COMPUTE_BRIEF): one, on any model with a slot to spare. It writes the
  // program that works the answer out and the sandbox runs it, so its answer is made another way than every other draft's
  if (!b.slots.some((s) => s.compute))
    for (const m of members) {
      if (used(m) >= cap) continue;
      const at = b.slots.reduce((k, x, i) => (x.stage === 'draft' ? i + 1 : k), 0);
      const slot = {
        id: m + '-program',
        member: m,
        stage: 'draft',
        compute: true,
        brief: COMPUTE_BRIEF,
        purpose: 'Writes a program that works the answer out; what it prints is its answer',
        maxTokens: 500,
        temperature: 0.2,
      };
      out.push({
        name: 'add a drafter on ' + m + ' that answers by a program',
        briefs: withSlots([...b.slots.slice(0, at), slot, ...b.slots.slice(at)]),
      });
      // (and its figure standing: added so, it is asked with the first drafters and has no vote; where it prints one plain
      // number and the slots settled on one figure, the number stands. Added as above it is asked only where the first
      // drafters differ, and slots of one model that share a slip do not differ. src/orchestrate.mjs plan.computedStands)
      out.push({
        name: 'add a drafter on ' + m + ' that answers by a program, and a figure it works out stands',
        briefs: {
          ...withSlots([...b.slots.slice(0, at), slot, ...b.slots.slice(at)]),
          plan: { ...b.plan, computedStands: true },
        },
      });
      // (and the two uses of it that overrule nothing the slots hold: its answer where they settle on none; and where it
      // differs from the first drafters, the other drafters asked. A program a small model writes for one question is
      // wrong more often than its slots are, measured 2026-11-25, so neither lets it outvote them)
      out.push({
        name:
          'add a drafter on ' + m + ' that answers by a program, and its answer stands where the slots settle on none',
        briefs: {
          ...withSlots([...b.slots.slice(0, at), slot, ...b.slots.slice(at)]),
          plan: { ...b.plan, computedFills: true },
        },
      });
      out.push({
        name: 'add a drafter on ' + m + ' that answers by a program, and where it differs the other drafters are asked',
        briefs: {
          ...withSlots([...b.slots.slice(0, at), slot, ...b.slots.slice(at)]),
          plan: { ...b.plan, computedDoubts: true },
        },
      });
    }
  if (drafts.length > 2)
    for (const s of drafts) out.push({ name: 'drop ' + s.id, briefs: withSlots(b.slots.filter((x) => x.id !== s.id)) });
  // A SLOT CAN CHANGE ITS PART: a drafter becomes a checker, a checker a drafter (told what a slot of that part on its own model,
  // or failing that the other, is told). Which model does which part is not fixed
  const like = (stage, m) =>
    b.slots.find((x) => x.stage === stage && x.member === m) || b.slots.find((x) => x.stage === stage);
  if (drafts.length > 2)
    for (const s of drafts) {
      const model = like('check', s.member);
      if (model)
        out.push({
          name: s.id + ' checks instead of drafting',
          briefs: withSlots(
            b.slots.map((x) =>
              x.id === s.id
                ? { ...x, stage: 'check', brief: model.brief, purpose: model.purpose, sees: model.sees }
                : x,
            ),
          ),
        });
    }
  for (const s of checks) {
    const model = like('draft', s.member);
    if (model)
      out.push({
        name: s.id + ' drafts instead of checking',
        briefs: withSlots(
          b.slots.map((x) =>
            x.id === s.id
              ? Object.fromEntries(
                  Object.entries({
                    ...x,
                    stage: 'draft',
                    brief: model.brief,
                    purpose: model.purpose,
                    sees: undefined,
                    temperature: 0.7,
                  }).filter(([, v]) => v !== undefined),
                )
              : x,
          ),
        ),
      });
  }
  for (const s of checks) {
    out.push({ name: 'drop ' + s.id, briefs: withSlots(b.slots.filter((x) => x.id !== s.id)) });
    const sees = s.sees === 'finals' ? undefined : 'finals';
    out.push({
      name: s.id + ' sees ' + (sees ? 'only the answers' : 'the work as well'),
      briefs: withSlots(
        b.slots.map((x) =>
          x.id === s.id ? Object.fromEntries(Object.entries({ ...x, sees }).filter(([, v]) => v !== undefined)) : x,
        ),
      ),
    });
  }
  // MORE ROOM: a slot's token limit raised by half (to 2000 at most). A slot cut off at its limit loses the answer it was writing
  for (const s of b.slots.filter((x) => x.stage !== 'decide' && x.maxTokens)) {
    const t = Math.min(2000, Math.round((s.maxTokens * 1.5) / 100) * 100);
    if (t > s.maxTokens)
      out.push({
        name: s.id + ' with a token limit of ' + t,
        briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, maxTokens: t } : x))),
      });
  }
  for (const s of drafts)
    for (const d of [0.3, -0.3]) {
      const t = Math.round(((s.temperature ?? 0.4) + d) * 10) / 10;
      if (t < 0 || t > 1.2) continue;
      out.push({
        name: s.id + ' at temperature ' + t,
        briefs: withSlots(b.slots.map((x) => (x.id === s.id ? { ...x, temperature: t } : x))),
      });
    }
  // REPLACE: a drafter told what another drafter is told, on its own model (with every slot in use, the only way to have more of
  // the best drafter is in place of the weakest)
  for (const s of drafts)
    for (const t of drafts)
      if (s.id !== t.id && s.brief !== t.brief)
        out.push({
          name: s.id + ' drafts as ' + t.id + ' does',
          briefs: withSlots(
            b.slots.map((x) =>
              x.id === s.id
                ? Object.fromEntries(
                    Object.entries({
                      ...x,
                      brief: t.brief,
                      purpose: t.purpose,
                      temperature: t.temperature,
                      copyOf: t.id,
                    }).filter(([, v]) => v !== undefined),
                  )
                : x,
            ),
          ),
        });
  // WORKED EXAMPLES (briefs.examples, the larger model's own answers to train questions: the trainer gathers them): a drafter shown
  // two, or four, or none again
  if (Array.isArray(b.examples) && b.examples.length)
    for (const s of drafts)
      for (const k of s.examples ? [0, s.examples === 2 ? 4 : 2] : [2])
        out.push({
          name: k ? s.id + ' sees ' + k + ' worked examples' : s.id + ' sees no worked examples',
          briefs: withSlots(
            b.slots.map((x) =>
              x.id === s.id
                ? Object.fromEntries(
                    Object.entries({ ...x, examples: k || undefined }).filter(([, v]) => v !== undefined),
                  )
                : x,
            ),
          ),
        });
  // THE WRITER, OR NONE: the settled answer handed over as it is (src/orchestrate.mjs: writeAs), or written out by the writer again
  out.push({
    name:
      (b.plan || {}).writeAs === 'settled'
        ? 'plan: the writer writes the reply again'
        : 'plan: the settled answer goes out as it is',
    briefs: {
      ...b,
      plan: Object.fromEntries(
        Object.entries({ ...b.plan, writeAs: (b.plan || {}).writeAs === 'settled' ? undefined : 'settled' }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    },
  });
  // THE SETTLED ANSWER ALONE (writeAs 'bare'): no writer and no work before it
  if ((b.plan || {}).writeAs !== 'bare')
    out.push({
      name: 'plan: the settled answer goes out alone, with no working',
      briefs: { ...b, plan: { ...b.plan, writeAs: 'bare' } },
    });
  // THE REPLY IN FULL, OR AS DRAFTED: the writer told to give the answer, why, and what to do (src/orchestrate.mjs: writeAs 'full')
  if ((b.plan || {}).writeAs !== 'settled')
    out.push({
      name:
        (b.plan || {}).writeAs === 'full'
          ? 'plan: the writer writes the reply as drafted'
          : 'plan: the writer writes the reply in full',
      briefs: {
        ...b,
        plan: Object.fromEntries(
          Object.entries({ ...b.plan, writeAs: (b.plan || {}).writeAs === 'full' ? undefined : 'full' }).filter(
            ([, v]) => v !== undefined,
          ),
        ),
      },
    });
  // THE STEP OF A TURN WITH TOOLS: the decider's choice, or the one most drafters proposed (src/tools.mjs: plan.toolDecide)
  out.push({
    name:
      (b.plan || {}).toolDecide === 'most'
        ? 'plan: the decider chooses the step of a turn with tools'
        : 'plan: the step most drafters proposed stands',
    briefs: {
      ...b,
      plan: Object.fromEntries(
        Object.entries({ ...b.plan, toolDecide: (b.plan || {}).toolDecide === 'most' ? undefined : 'most' }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    },
  });
  // A TURN WITH TOOLS GOES ON WHERE MOST DRAFTERS WOULD (src/tools.mjs: plan.callFirst), or ends on the step most proposed
  out.push({
    name: (b.plan || {}).callFirst
      ? 'plan: a turn with tools ends on the step most proposed'
      : 'plan: a turn with tools goes on unless most would reply',
    briefs: {
      ...b,
      plan: Object.fromEntries(
        Object.entries({ ...b.plan, callFirst: (b.plan || {}).callFirst ? undefined : true }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    },
  });
  // THE REPLY CLOSES AS THE EARLIER REPLIES DO, or as it was written (src/orchestrate.mjs: plan.closeAs)
  out.push({
    name:
      (b.plan || {}).closeAs === 'shown'
        ? 'plan: the reply closes as it was written'
        : 'plan: the reply closes as the earlier replies do',
    briefs: {
      ...b,
      plan: Object.fromEntries(
        Object.entries({ ...b.plan, closeAs: (b.plan || {}).closeAs === 'shown' ? undefined : 'shown' }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    },
  });
  for (const [key, dflt] of [
    ['onePerAnswer', false],
    ['agreeSkipsChecks', true],
    ['draftsStand', false], // where most drafters agree their answer stands, and the checkers have no vote in it
    ['byBehaviour', true], // drafts of code agree by what they do (run on the same calls), or by how they read
    ['goOn', false], // a slot cut off before its answer is given its room again to finish, before it is asked for one line
  ]) {
    const now = b.plan && b.plan[key] !== undefined ? b.plan[key] : dflt;
    out.push({ name: 'plan: ' + key + ' ' + !now, briefs: { ...b, plan: { ...b.plan, [key]: !now } } });
  }
  // DRAFTING IN TWO ROUNDS (src/orchestrate.mjs firstDrafters: plan.draftFirst): on, two draft first and the rest only where those
  // differ; off, every drafter at once. The default is on, for its speed; a class it costs answers on can have it off
  {
    const now = (b.plan || {}).draftFirst;
    const { draftFirst, ...rest } = b.plan || {};
    out.push(
      now
        ? { name: 'plan: every draft at once', briefs: { ...b, plan: rest } }
        : { name: 'plan: two drafts first', briefs: { ...b, plan: { ...rest, draftFirst: 2 } } },
    );
  }
  // how the matter is settled (training/replay.mjs says, from the last measurement, what each would have won)
  for (const way of ['decider', 'most', 'decider-if-confident', 'decider-unless-majority'])
    if (decideByOf((b.plan || {}).decideBy) !== way)
      out.push({ name: 'plan: decide by ' + way, briefs: { ...b, plan: { ...b.plan, decideBy: way } } });
  // A SMALL MODEL BESIDE THE DECIDER (src/orchestrate.mjs: plan.decideWith): asked where the decider is close, asked with it every
  // time, or asked where the decider parts from most; on the model of a checker, or of another model of the swarm; or none again
  const dw = (b.plan || {}).decideWith;
  const HOW = {
    'if-close': 'a model settles it where the decider is close',
    together: 'a model decides with the decider',
    'if-at-odds': 'a model settles it where the decider parts from most',
    // (in place of the decider: the decision model is not asked, orchestrate.mjs 'alone')
    alone: 'a model decides in place of the decider',
  };
  const withPlan = (decideWith) => ({
    ...b,
    plan: Object.fromEntries(Object.entries({ ...b.plan, decideWith }).filter(([, v]) => v !== undefined)),
  });
  for (const [how, label] of Object.entries(HOW))
    if (!dw || dw.how !== how) out.push({ name: 'plan: ' + label, briefs: withPlan({ ...(dw || {}), how }) });
  // EVERY MODEL OF THE SWARM AS THE ONE BESIDE IT, FROM THE START: each way of asking, with each other model (by the slot it is
  // asked as: a checker of that model where there is one). Offered only once one way was kept, the other models were never
  // asked: measured 2026-11-17, 19 tries of the three ways, every one with the first checker's model (Bonsai 2 2B, the weakest of
  // the three alone), none kept, while LFM3 1.7B's drafter held the larger model's answer in 14 of the question's tries
  const asSlot = (m) =>
    b.slots.find((x) => x.member === m && x.stage === 'check') || b.slots.find((x) => x.member === m);
  if (!dw) {
    const first = (b.slots.find((s) => s.stage === 'check') || b.slots[0] || {}).member;
    for (const [how, label] of Object.entries(HOW))
      for (const m of members.filter((x) => x !== first)) {
        const s = asSlot(m);
        if (s) out.push({ name: 'plan: ' + label + ' (as ' + s.id + ')', briefs: withPlan({ how, slot: s.id }) });
      }
  }
  if (dw) {
    out.push({ name: 'plan: the decider decides alone', briefs: withPlan(undefined) });
    // the model beside it: each model of the swarm, by the slot it is asked as (a checker of that model where there is one)
    const now = (b.slots.find((s) => s.id === dw.slot) || b.slots.find((s) => s.stage === 'check') || b.slots[0])
      .member;
    for (const m of members.filter((x) => x !== now)) {
      const s = b.slots.find((x) => x.member === m && x.stage === 'check') || b.slots.find((x) => x.member === m);
      if (s)
        out.push({
          name: 'plan: the model beside the decider is ' + m + ' (as ' + s.id + ')',
          briefs: withPlan({ ...dw, slot: s.id }),
        });
    }
  }
  // an arrangement must still be able to answer: two drafters at least, and no model asked for more slots than it has
  out.push(
    // A REPLY IN A CONVERSATION TIDIED BY CODE (src/manners.mjs): each fix turned on by itself, one that is on turned off
    ...MANNER_FIXES.map((f) => {
      const on = mannersOn((b.plan || {}).manners);
      return on.includes(f)
        ? {
            name: 'manners: ' + MANNER_NAMES[f] + ' (off)',
            briefs: { ...b, plan: { ...b.plan, manners: on.filter((x) => x !== f) } },
          }
        : { name: 'manners: ' + MANNER_NAMES[f], briefs: { ...b, plan: { ...b.plan, manners: [...on, f] } } };
    }),
    // THE QUESTION TAKEN APART BY CODE (src/breakdown.mjs): put to the drafters in numbered lines, or as it came
    (b.plan || {}).prepare === 'lines'
      ? {
          name: 'breakdown: the question is put to the drafters as it came',
          briefs: { ...b, plan: (({ prepare: _p, ...rest }) => rest)(b.plan || {}) },
        }
      : {
          name: 'breakdown: the question is put to the drafters in numbered lines',
          briefs: { ...b, plan: { ...b.plan, prepare: 'lines' } },
        },
    // A CASCADE: a drafting slot works the question one stated thing at a time, code carrying what was worked out, or all
    // at once (slot.byFacts)
    ...b.slots
      .filter((s) => s.stage === 'draft' && !s.compute)
      .map((s) =>
        s.byFacts === true
          ? {
              name: 'cascade: ' + s.id + ' works the question all at once',
              briefs: {
                ...b,
                slots: b.slots.map((x) => (x.id === s.id ? (({ byFacts: _f, ...rest }) => rest)(x) : x)),
              },
            }
          : {
              name: 'cascade: ' + s.id + ' works the question one fact at a time',
              briefs: { ...b, slots: b.slots.map((x) => (x.id === s.id ? { ...x, byFacts: true } : x)) },
            },
      ),
    // HOW MANY MODELS: every slot on one of them, where the slots are on more than one and it has the room
    ...members
      .filter((m) => b.slots.some((x) => x.member !== m) && b.slots.length <= cap)
      .map((m) => ({
        name: 'models: every slot is on ' + m,
        briefs: { ...b, slots: b.slots.map((x) => ({ ...x, member: m })) },
      })),
  );
  // (the instruments that read a whole question of a fixed kind come here, after everything else: put first of all with the
  // other four they filled the head of the list that question-by-question training plans from)
  for (const id of INSTRUMENT_WHOLE.filter((x) => !instrOn.includes(x)))
    out.push({
      name: 'plan: a question ' + INSTRUMENT_NAMES[id] + ' is done by code',
      briefs: { ...b, plan: { ...b.plan, instruments: [...instrOn, id] } },
    });
  // A MODEL READS, CODE WORKS IT OUT (src/forms.mjs): the kinds of question code can work out whole, read by the drafters
  // into a form however they are worded. One change, for every form: which form a question is of is told by a model
  if (!(b.plan || {}).read)
    out.push({
      name: 'plan: a question of a kind code can work out is read into a form by the drafters, and worked out by code',
      briefs: { ...b, plan: { ...b.plan, read: true } },
    });
  // EVERY INSTRUMENT AT ONCE, where two or more are off: each alone moves one kind of question, and a round keeps one
  // change. Of the kinds a model could write no function for, four are these operations, and the instruments answer every
  // question of them rightly (128 of 128, measured 2026-11-25).
  if (INSTRUMENT_IDS.filter((id) => !instrOn.includes(id)).length > 1)
    out.push({
      name: 'plan: every instrument is on',
      briefs: { ...b, plan: { ...b.plan, instruments: [...INSTRUMENT_IDS] } },
    });
  return out
    .filter(
      (c) =>
        c.briefs.slots.filter((s) => s.stage === 'draft').length >= 2 &&
        members.every((m) => used(m, c.briefs.slots) <= cap),
    )
    .map((c) => ({ ...c, hash: shapeOf(c.briefs) }));
}

// THE FLOW IS PART OF THE ARRANGEMENT: what happens in what order, how often, and what settles it (src/orchestrate.mjs). Every flow
// one change from this one: the answers sent back to those who wrote them, a loop of checking and revising, a decision that
// narrows before the one that settles, a step taken out, a loop made longer or undone. A kept change is where the next pass
// starts from, so pass after pass the flow can grow into shapes nobody wrote down.
const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
export function flowMoves(b) {
  const f = flowOf(b);
  const out = [];
  const put = (name, flow) => out.push({ name: 'flow: ' + name, briefs: { ...b, flow } });
  const without = (i) => [...f.slice(0, i), ...f.slice(i + 1)];
  const label = (s) =>
    s.do === 'repeat'
      ? 'loop'
      : s.do === 'decide'
        ? s.keep
          ? 'narrowing'
          : s.sure
            ? 'early decision'
            : 'decision'
        : s.do;
  // THE DECIDER INSIDE A LOOP, three ways a flow can be recursive about deciding (the engine runs each as it is: a loop stops the
  // moment anything is settled). Put straight after the drafts are run, or after the drafts where nothing is run.
  const at =
    Math.max(
      f.findIndex((x) => x.do === 'try'),
      f.findIndex((x) => x.do === 'draft'),
    ) + 1;
  if (at > 0 && !f.some((x) => x.do === 'repeat')) {
    put('a narrowing loop: the decider keeps the likeliest two and they are sent back, twice at most', [
      ...f.slice(0, at),
      { do: 'repeat', upTo: 2, steps: [{ do: 'decide', keep: 2 }, { do: 'revise' }] },
      ...f.slice(at),
    ]);
    put('ask the decider first; if it is not sure, check, revise and ask again, twice at most', [
      ...f.slice(0, at),
      { do: 'repeat', upTo: 2, steps: [{ do: 'decide', sure: 0.75 }, { do: 'check' }, { do: 'revise' }] },
      ...f.slice(at),
    ]);
  }
  if (at > 0 && !f.some((x) => x.do === 'decide' && x.keep))
    put('a tournament: the decider keeps the likeliest three, a check, then the likeliest two are sent back', [
      ...f.slice(0, at),
      { do: 'decide', keep: 3 },
      { do: 'check' },
      { do: 'decide', keep: 2 },
      { do: 'revise' },
      ...f.slice(at).filter((x, j) => !(j === 0 && x.do === 'check')),
    ]);
  f.forEach((s, i) => {
    const nth = f.slice(0, i).filter((x) => x.do === s.do).length;
    const many = f.filter((x) => x.do === s.do).length > 1;
    const which = many ? ' (the ' + ORD[Math.min(nth, 4)] + ')' : '';
    const next = f[i + 1];
    if (s.do === 'check') {
      put('check and revise again while the answers differ, twice at most' + which, [
        ...f.slice(0, i),
        { do: 'repeat', upTo: 2, steps: [{ do: 'check' }, { do: 'revise' }] },
        ...f.slice(i + (next && next.do === 'revise' ? 2 : 1)),
      ]);
      put('no check' + which, without(i));
    }
    if (s.do === 'expect') put('no saying what each call should give', without(i));
    if (s.do === 'revise') put('no revising' + which, without(i));
    // ANY STEP CAN STAND ANYWHERE, however unlikely it looks: after every step that leaves answers standing (the drafts, the run,
    // a check, the answers coming back, a narrowing), each kind of step there is, where it is not already the next one. The
    // decider between the drafts and the checks, keeping the likeliest two; the decider there settling it outright if it is sure;
    // a check before the answers are run and another after; the answers going back before anyone has checked them; what each
    // call should give said after the checks instead of before. Whether any of it helps is not for this file to guess.
    if (s.do !== 'write' && s.do !== 'repeat') {
      const INSERT = [
        ['keep the likeliest two', { do: 'decide', keep: 2 }],
        ['settle it if the decider is sure, else go on', { do: 'decide', sure: 0.75 }],
        ['a check', { do: 'check' }],
        ['the answers go back to the drafters', { do: 'revise' }],
        ['say what each call should give', { do: 'expect' }],
      ];
      const same = (x, y) => x && y && x.do === y.do && !!x.keep === !!y.keep && !!x.sure === !!y.sure;
      for (const [words, step] of INSERT) {
        if (same(step, next) || same(step, s)) continue;
        if (
          step.do === 'expect' &&
          (f.some((x) => x.do === 'expect') || !f.slice(0, i + 1).some((x) => x.do === 'try'))
        )
          continue;
        if (step.sure && f.some((x) => x.sure)) continue;
        if (!next || (next.do === 'write' && step.do !== 'check' && step.do !== 'revise')) continue; // nothing after it to change
        put(words + ', straight after the ' + label(s) + which, [...f.slice(0, i + 1), step, ...f.slice(i + 1)]);
      }
    }
    if (s.do === 'decide' && s.sure) put('no settling early' + which, without(i));
    // A STEP CAN CHANGE PLACES with the one before it (never the first drafts, never the writing)
    const prev = f[i - 1];
    if (
      i >= 2 &&
      s.do !== 'write' &&
      !(s.do === 'decide' && !s.keep) &&
      prev &&
      prev.do !== 'draft' &&
      prev.do !== s.do
    )
      put('the ' + label(s) + which + ' before the ' + label(prev), [...f.slice(0, i - 1), s, prev, ...f.slice(i + 1)]);
    // the answers go back to ONE model's drafters only: the other's stand as they are
    if (s.do === 'revise' && !s.slots)
      for (const m of [...new Set(b.slots.map((x) => x.member))].sort()) {
        const mine = b.slots.filter((x) => x.stage === 'draft' && x.member === m).map((x) => x.id);
        if (mine.length && mine.length < b.slots.filter((x) => x.stage === 'draft').length)
          put('only the drafters on ' + m + ' answer again' + which, [
            ...f.slice(0, i),
            { ...s, slots: mine },
            ...f.slice(i + 1),
          ]);
      }
    if (s.do === 'decide' && s.keep) put('no narrowing' + which, without(i));
    if (s.do === 'repeat') {
      const upTo = s.upTo || 2;
      if (upTo < 3)
        put('the loop' + which + ' ' + (upTo + 1) + ' times at most', [
          ...f.slice(0, i),
          { ...s, upTo: upTo + 1 },
          ...f.slice(i + 1),
        ]);
      put('the loop' + which + ' undone: its steps once', [...f.slice(0, i), ...(s.steps || []), ...f.slice(i + 1)]);
    }
  });
  if (b.flow)
    out.push({
      name: 'flow: the plain one (draft, try, check, decide, write)',
      briefs: (({ flow, ...rest }) => rest)(b),
    });
  // a flow must still begin with a draft and be able to settle on something
  return out.filter((c) => !c.briefs.flow || (c.briefs.flow[0] && c.briefs.flow[0].do === 'draft'));
}

// SEVERAL CHANGES AT ONCE. One step at a time cannot reach an arrangement whose parts only help together (a loop is worth little
// with checkers that say nothing; a narrowing decision is worth little before answers are run). So a pass also tries a few
// arrangements that are `depth` changes from this one, taken in a fixed order from all there are. How many, and how deep,
// is the trainer's policy (plan.wild, plan.depth: training/policy.json).
export function wildMoves(b, { n = 1, depth = 2, tried = [] } = {}) {
  // IN A FIXED ORDER, AND ALL OF THEM IN THE END. Not drawn by lot: every arrangement `depth` changes from this one is in one
  // list (the changes in the order steps() gives them, the first change slowest to turn), and a pass takes the first `n` that
  // have not been tried. What it tried is not taken again, so pass after pass it goes down the list and reaches every one.
  const out = [];
  const here = shapeOf(b);
  const walk = (cur, names, left) => {
    if (out.length >= n) return;
    if (!left) {
      const hash = shapeOf(cur);
      if (hash !== here && !tried.includes(hash) && !out.some((c) => c.hash === hash))
        out.push({ name: 'several: ' + names.join('; then ').replace(/flow: /g, ''), briefs: cur, hash });
      return;
    }
    for (const c of steps(cur)) {
      if (out.length >= n) return;
      walk(c.briefs, [...names, c.name], left - 1);
    }
  };
  walk(b, [], depth);
  return out;
}
