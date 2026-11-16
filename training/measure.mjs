// measure.mjs - THE SWARM ON THE QUESTIONS, AND EVERY SLOT ON ITS OWN ACCOUNT. The reply a person reads is graded; so is what each
// slot answered on the way, because a brief can only be made better where it is known to be failing:
//   a draft or check slot    how often its own answer was the right one
//   the decider (Kev)        how often it kept a right answer that was on the table, and how often it threw one away
//   the writer               how often the reply still said the answer that was settled on (it must not change it)
//   the path                 agreed (every draft the same), decided (by Kev), most (Kev decided nothing), fallback
// And the two numbers the whole thing is for: LOST (a slot had the right answer and the reply was wrong: the orchestration's own
// fault) and BEYOND (no draft was right and the reply was: checking found what drafting did not).
//   node training/measure.mjs --split train
//   node training/measure.mjs --split held --label swarm-v3
// Rows (with every slot's words) go to .work/train/swarm-runs.jsonl; the summary to training/results/<label>-<split>.json.
import {
  arg,
  chosen,
  openSwarm,
  run,
  count,
  line,
  save,
  rowsTo,
  needReference,
  swarmName,
  finished,
} from './support/bench.mjs';
import { plain } from '../src/read.mjs';
import { CONFIG_ID, TARGET } from '../src/catalog.mjs';

// each slot's own answer is marked as the reply is: equivalent to the larger model's, or not. The mark is written onto the trace
// (same: true | false), so that a person looking at one question can see which slots had it.
export async function slotReport(rows, tasksById, { kev = '' } = {}) {
  const slots = {};
  const paths = {};
  let lost = 0;
  let beyond = 0;
  for (const r of rows) {
    const t = tasksById[r.id];
    paths[r.path] = (paths[r.path] || 0) + 1;
    if (r.refReply === undefined || r.grade === 'noref') continue; // the larger model gave no answer to this one: nothing to be equivalent to
    const memo = new Map();
    const own = async (text) => {
      if (!text) return false;
      if (!memo.has(text)) memo.set(text, (await t.equivalent(r.refReply, t.wrap(text), { kev })).grade === 'right');
      return memo.get(text);
    };
    const settled = await own(r.decided);
    let anyRight = false;
    let draftRight = false;
    for (const s of r.trace || []) {
      if (s.stage === 'probe' || s.stage === 'run') continue; // they try the drafts; they do not answer
      const o = (slots[s.slot] = slots[s.slot] || { stage: s.stage, ran: 0, right: 0, silent: 0, ms: 0 });
      o.ran++;
      o.ms += s.ms;
      if (s.stage === 'write') {
        // the writer is right when it did not change what was settled: the reply is equivalent whenever the settled answer was
        const kept = !settled || r.grade === 'right';
        s.same = kept;
        if (kept) o.right++;
        else o.changed = (o.changed || 0) + 1;
        continue;
      }
      s.same = s.final ? await own(s.final) : null;
      if (!s.final) o.silent++;
      else if (s.same) {
        o.right++;
        anyRight = true;
        if (s.stage === 'draft') draftRight = true;
      }
      if (s.stage === 'decide') {
        const table = (r.trace || []).filter((x) => x.stage === 'draft' || x.stage === 'check');
        let had = false;
        for (const x of table) if (x.final && (await own(x.final))) had = true;
        if (had) o.hadRight = (o.hadRight || 0) + 1;
        if (had && !s.same) o.threwAway = (o.threwAway || 0) + 1;
      }
    }
    if (anyRight && r.grade !== 'right') lost++;
    if (!draftRight && r.grade === 'right') beyond++;
  }
  for (const o of Object.values(slots)) o.ms = o.ran ? Math.round(o.ms / o.ran) : 0;
  return { slots, paths, lost, beyond };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const split = arg('split', 'train');
  const label = String(arg('label', 'swarm')).replace(/[^\w.-]+/g, '-');
  const list = chosen();
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const ref = needReference(list, split);
  const swarm = await openSwarm();
  try {
    const rows = await run(
      list,
      async (t) => {
        const got = await swarm.answer([{ role: 'user', content: t.ask }]);
        return {
          reply: got.reply,
          decided: got.decided,
          path: got.path,
          trace: got.trace,
          tried: got.tried || undefined,
        };
      },
      {
        ref,
        name: 'measure-' + swarmName(swarm.briefs, split, list.length ? list[0].seed : ''),
        onRow: (r) =>
          console.log(r.grade.padEnd(7) + r.id.padEnd(22) + String(r.path).padEnd(22) + plain(r.decided).slice(0, 30)),
      },
    );
    const c = count(rows);
    const rep = await slotReport(rows, byId, { kev: swarm.kev });
    console.log('\n' + line(label + ' (' + split + ')', c));
    console.log(
      'paths: ' +
        Object.entries(rep.paths)
          .map(([k, v]) => k + ' ' + v)
          .join(', '),
    );
    console.log(
      "lost (a slot had the larger model's answer, the reply did not): " +
        rep.lost +
        '    beyond (no draft had it, the reply did): ' +
        rep.beyond,
    );
    for (const [id, o] of Object.entries(rep.slots))
      console.log(
        '  ' +
          id.padEnd(18) +
          o.stage.padEnd(6) +
          String(o.right).padStart(3) +
          ' equivalent of ' +
          String(o.ran).padEnd(4) +
          (o.silent ? ' ' + o.silent + ' gave no answer' : '') +
          (o.threwAway ? ' threw away ' + o.threwAway + ' of ' + o.hadRight : '') +
          (o.changed ? ' changed the answer ' + o.changed + ' times' : '') +
          '   ' +
          o.ms +
          ' ms',
      );
    rowsTo(
      'swarm-runs.jsonl',
      rows.map((r) => ({ label, briefs: swarm.briefs.version, ...r })),
    );
    save(label + '-' + split, {
      who: label,
      split,
      seed: list.length ? list[0].seed : null,
      briefs: swarm.briefs.version,
      cfg: CONFIG_ID, // which swarm, against which larger model: a plan is not made from another's measurement
      target: TARGET.id,
      ...c,
      ...rep,
    });
    finished();
  } finally {
    await swarm.stop();
  }
}
