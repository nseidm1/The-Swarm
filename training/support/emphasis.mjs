// emphasis.mjs - WHAT A PASS ASKS MORE OF BECAUSE THE PROOF FOUND THE SWARM SHORT THERE. A pass already asks more of the kinds its
// own held questions found the swarm short on (pass.mjs: focus). This reads the other measurement there is: the proof
// (training/evaluate.mjs: the module beside its target on established tests, kept in .work/eval/history.jsonl). A capability
// whose verdict there is `short` has the kinds of its body of work asked more of in the next pass.
//
// WHAT IS READ, AND WHAT NEVER IS. One word for each capability (parity, short, open), with the gap and the count of questions
// it rests on. Never a question of the harness, an answer to one, or which of them the swarm got wrong: those are the
// measurement training cannot fit (docs/swoa.md 4.7), and they stay that. And a verdict never decides whether a change is kept:
// it decides only how many of training's OWN questions the next pass makes of a kind. A proof that has steered training is no
// longer blind to it, so a pass that read one says so in its record (focusFrom.proof), and the SwOA after it does
// (trainedAgainst.emphasis): a reader of the proof is owed that.
//
// THE RULE IS THE SwOA SPECIFICATION'S (docs/swoa.md 4.7), as the page's reading of a proof has it (ui/data.py):
//   gap = (onlySwoa - onlyTarget) / n      gapStderr = sqrt(((onlySwoa + onlyTarget) / n - gap^2) / n)
//   parity when gap - Z x gapStderr >= -margin; short when gap + Z x gapStderr < -margin; open otherwise
// over the questions of a capability's tasks together. Short is said only where the questions are enough to say it: a handful
// of questions reads open, and open asks nothing more.
//
//   pairedGap({ n, onlySwoa, onlyTarget })              -> { n, onlySwoa, onlyTarget, gap, gapStderr } | null
//   verdictOf(gap, gapStderr, margin)                   -> 'parity' | 'short' | 'open'
//   capabilityOf(task, item, itemName, targets)         -> { id, name }: the capability a task measures
//   readEvaluations(dir)                                -> the evaluations on record, oldest first
//   capabilitiesOf(rows, { configuration, adapters, targets })
//                                                       -> [{ id, name, tasks, n, gap, gapStderr, verdict, proof, at }]
//   proofFocus({ rows, configuration, adapters, more, targets })
//                                                       -> { focus: { kind: more }, from } (from: what was read, for the record)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const EVAL_DIR = process.env.SWARM_EVAL_DIR || path.join(ROOT, '.work', 'eval');
export const MARGIN = 0.05;
export const Z = 1.645;
// (a result of at least this many questions of its task counts as proof; one of fewer is a check)
export const PROOF_MIN_N = 100;
const round4 = (x) => Math.round(x * 1e4) / 1e4;

export function pairedGap({ n, onlySwoa, onlyTarget } = {}) {
  if (!n || !Number.isFinite(onlySwoa) || !Number.isFinite(onlyTarget)) return null;
  const gap = (onlySwoa - onlyTarget) / n;
  return {
    n,
    onlySwoa,
    onlyTarget,
    gap: round4(gap),
    gapStderr: round4(Math.sqrt(Math.max(0, (onlySwoa + onlyTarget) / n - gap * gap) / n)),
  };
}
export const verdictOf = (gap, stderr, margin = MARGIN) =>
  gap - Z * stderr >= -margin ? 'parity' : gap + Z * stderr < -margin ? 'short' : 'open';

// THE CAPABILITY A TASK MEASURES (ui/data.py capability_of reads it the same way): the body of work the task is listed under in
// training/equivalence.json, unless the task names another whose kinds are training's own questions of what it measures
// (`trains`: IFEval is listed under The Crew, and what it measures, following instructions, is the capability Instructions).
// A task the list does not hold is of the body of work its result names. So a capability is always a body of work, and its
// kinds are the questions that train it.
export function capabilityOf(task, item, itemName, targets = []) {
  for (const t of targets)
    for (const b of t.benchmarks || [])
      if (b.task === task) {
        const c = targets.find((x) => x.id === (b.trains || t.id)) || t;
        return { id: c.id, name: c.specName || c.name || c.id };
      }
  return { id: String(item), name: itemName || String(item) };
}

// the evaluations on record (a line each, as an evaluation that finished wrote it); a line that will not read is passed over
export function readEvaluations(dir = EVAL_DIR) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a line cut short */
    }
  }
  return rows;
}

const sameSet = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// A VERDICT FOR EACH CAPABILITY, from this configuration's evaluations (the same small models, decider and larger model: its
// key), served as it is served now (the same adapters, or none). The arrangement is not asked to be the same: a proof is of an
// arrangement, and training has moved on from it by the time a pass ends; what steers the next pass is the newest word there is.
// For each task the newest result of proof size, else the newest check (the order a SwOA's proof lists them in); then the tasks
// of a capability together. A task whose two answers were not paired question by question has no part in a verdict.
export function capabilitiesOf(rows, { configuration, adapters = [], margin = MARGIN, targets = [] } = {}) {
  const best = new Map();
  for (const r of rows || []) {
    if (!r || r.configuration !== configuration || !sameSet(r.adapters, adapters)) continue;
    for (const x of r.results || []) {
      const sw = x.swarm || {};
      const tg = x.target || {};
      const a = x.agree || {};
      if (!Number.isFinite(sw.value) || !Number.isFinite(tg.value)) continue;
      const p = pairedGap({ n: a.of, onlySwoa: a.onlySwarm, onlyTarget: a.onlyTarget });
      if (!p) continue;
      const e = {
        task: x.task,
        capability: capabilityOf(x.task, x.item, x.itemName, targets),
        ...p,
        proof: Number(sw.n || 0) >= PROOF_MIN_N,
        at: String(r.at || ''),
      };
      const was = best.get(e.task);
      // (proof outranks a check; among equals, the newer)
      if (!was || (e.proof === was.proof ? e.at > was.at : e.proof)) best.set(e.task, e);
    }
  }
  const out = [];
  const all = [...best.values()];
  for (const id of [...new Set(all.map((e) => e.capability.id))].sort()) {
    const mine = all.filter((e) => e.capability.id === id).sort((x, y) => String(x.task).localeCompare(String(y.task)));
    const p = pairedGap({
      n: mine.reduce((n, e) => n + e.n, 0),
      onlySwoa: mine.reduce((n, e) => n + e.onlySwoa, 0),
      onlyTarget: mine.reduce((n, e) => n + e.onlyTarget, 0),
    });
    out.push({
      id,
      name: mine[0].capability.name,
      tasks: mine.map((e) => e.task),
      n: p.n,
      gap: p.gap,
      gapStderr: p.gapStderr,
      margin,
      verdict: verdictOf(p.gap, p.gapStderr, margin),
      proof: mine.every((e) => e.proof),
      at: mine.reduce((m, e) => (e.at > m ? e.at : m), ''),
    });
  }
  return out;
}

// WHAT THE NEXT PASS ASKS MORE OF, FROM THE PROOF: `more` more questions of each kind of a capability found short (a capability
// is a body of work, and its kinds are the questions that train it). more 0 (the policy: questions.shortMore): the proof is not
// read at all. Nothing on record for this configuration: nothing is read, and nothing is asked more of.
//   from: { at, more, short: [{ id, name, n, gap, gapStderr, proof, kinds }], read: [{ id, verdict, n, gap }] }
export function proofFocus({ rows, configuration, adapters = [], more = 2, targets = [] } = {}) {
  const n = Math.max(0, Math.floor(Number(more) || 0));
  if (!n) return { focus: {}, from: null };
  const caps = capabilitiesOf(rows, { configuration, adapters, targets });
  if (!caps.length) return { focus: {}, from: null };
  const focus = {};
  const short = [];
  for (const c of caps.filter((x) => x.verdict === 'short')) {
    const kinds = [...((targets.find((t) => t.id === c.id) || {}).kinds || [])];
    for (const k of kinds) focus[k] = n;
    short.push({ id: c.id, name: c.name, n: c.n, gap: c.gap, gapStderr: c.gapStderr, proof: c.proof, kinds });
  }
  return {
    focus,
    from: {
      at: caps.reduce((m, c) => (c.at > m ? c.at : m), ''),
      more: n,
      short,
      read: caps.map((c) => ({ id: c.id, verdict: c.verdict, n: c.n, gap: c.gap })),
    },
  };
}
