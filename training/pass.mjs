// pass.mjs - THE BEGINNING AND THE END OF A TRAINING PASS, which is where one pass hands on to the next.
//   node training/pass.mjs begin     says what this pass will do, from what the last one left: the target, the new train
//                                    questions, the kinds to ask more of, the slots in the order to work on them
//   node training/pass.mjs order     the slots, worst first (session.sh reads this)
//   node training/pass.mjs end       reads what was measured, says how near the swarm is to parity with its target, and writes
//                                    down for the next pass: where it trails, which slots did worst, what to ask arXiv, and
//                                    (when it is level) the next, larger target
// What a pass leaves is in state.json (see state.mjs) and, for a person, a section in training/passes.md.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, RESULTS, WORK, aloneLabel } from './support/bench.mjs';
import { MEMBERS, DECIDER, CONFIG_ID, writeConfig, readConfig } from '../src/catalog.mjs';
import { readState, writeState, seedState, readTargets, targetOf, parity, STANDING } from './state.mjs';
import { readBriefs, notePass, readLearned } from '../src/index.mjs';
import { readPolicy } from './policy.mjs';
import { kindsFor, readOwn } from './tasks.mjs';

// what to ask arXiv when the swarm trails on a kind of question
export const ASK_FOR = {
  'write-arrays': 'all:"code generation" AND all:"small language models" AND all:"functional correctness"',
  'write-strings': 'all:"code generation" AND all:"language models" AND all:"edge cases"',
  'write-numbers': 'all:"code generation" AND all:"language models" AND all:"specification" AND all:"ambiguity"',
  'write-parsing': 'all:"code generation" AND all:"language models" AND all:parsing AND all:robustness',
  fix: 'all:"automated program repair" AND all:"language models"',
  bug: 'all:"bug localization" AND all:"language models"',
  chain: 'all:"arithmetic" AND all:"language models" AND all:"multi-step" AND all:errors',
  shop: 'all:"math word problems" AND all:"irrelevant" AND all:"language models"',
  rate: 'all:"math word problems" AND all:"small language models" AND all:reasoning',
  day: 'all:"temporal reasoning" AND all:"language models" AND all:calendar',
  order: 'all:"relational reasoning" AND all:"language models" AND all:transitive',
  letters: 'all:"character-level" AND all:"language models" AND all:counting',
  trace: 'all:"code execution" AND all:"language models" AND all:"program tracing"',
  extract: 'all:"numerical reasoning" AND all:"reading comprehension" AND all:"language models"',
  trap: 'all:"cognitive reflection test" AND all:"language models"',
  string: 'all:"symbolic manipulation" AND all:"language models" AND all:"string"',
  units: 'all:"unit conversion" AND all:"language models" AND all:reasoning',
  count: 'all:"counting" AND all:"language models" AND all:"systematic errors"',
};
const rowsOf = (file, pick) => {
  const f = path.join(WORK, file);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter(pick);
};
// the newest answer to each held question, from the rows a trainer wrote
const newest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];
const result = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS, name + '.json'), 'utf8'));
  } catch {
    return null;
  }
};

// the slots, worst first: a checker that is seldom right and a writer that changes answers come before a draft that is
// seldom right, because they lose what the others had already found
export function orderOf(report, slots) {
  if (!report || !report.slots) return slots.map((s) => s.id).sort((a, b) => rank(a) - rank(b));
  const harm = (id) => {
    const o = report.slots[id];
    if (!o || !o.ran) return 0;
    if (o.stage === 'write') return 3 * ((o.changed || 0) / o.ran);
    if (o.stage === 'check') return 1.5 * (1 - o.right / o.ran);
    return 1 - o.right / o.ran;
  };
  return slots.map((s) => s.id).sort((a, b) => harm(b) - harm(a) || rank(a) - rank(b));
}
const rank = (id) => (/critic|recompute/.test(id) ? 0 : /writer/.test(id) ? 1 : 2);

// swarmRows: the swarm's answers to the held questions, each graded against what the larger model answered (bench.mjs run)
export function endPass(state, { swarmRows, train, briefs, targets, now = new Date() }) {
  const rung = targets.find((t) => t.id === state.target) || targets[0];
  const p = parity(swarmRows);
  const done = {
    pass: state.pass + 1,
    at: now.toISOString().slice(0, 10),
    target: rung.id,
    briefs: briefs.version,
    config: CONFIG_ID, // which small models and decider this was: parity is a configuration's, not the target's
    members: Object.values(MEMBERS).map((m) => m.name),
    decider: DECIDER.name,
    level: !!(p && p.level),
  };
  if (p)
    Object.assign(done, {
      percent: p.percent,
      equivalent: p.equivalent,
      differ: p.differ,
      none: p.none,
      compared: p.compared,
    });
  const next = { ...state, pass: state.pass + 1, target: rung.id, history: [...state.history, done] };
  // new train questions every pass; the held ones stay while this target is chased
  next.seeds = { ...state.seeds, train: state.seeds.train + 104729 };
  // the next pass asks the kinds of what the swarm is to be equivalent on, as it is chosen now (equivalence.json, src/config.json)
  next.kinds = kindsFor(readConfig().equivalence);
  // and the questions a person wrote for them, as they are now: kept with the pass, so that a change made while it runs waits
  next.own = readOwn(readConfig().equivalence);
  // more of the kinds it answers differently from the larger model on (two more for each such question, to at most six more)
  next.focus = {};
  if (p) for (const k of p.trailing) next.focus[k.kind] = Math.min(6, 2 * k.differ);
  next.order = orderOf(train, briefs.slots);
  next.questions = [
    ...new Set([
      ...STANDING,
      ...Object.keys(next.focus)
        .map((k) => ASK_FOR[k])
        .filter(Boolean),
    ]),
  ];
  let climbed = null;
  if (p && p.level) {
    const at = targets.findIndex((t) => t.id === rung.id);
    if (targets[at + 1]) {
      climbed = targets[at + 1];
      next.target = climbed.id;
      next.seeds.held = state.seeds.held + 15485863; // a new target is met on questions nothing has been chosen on
      next.focus = {};
    }
  }
  return { next, done, parity: p, rung, climbed };
}

// the held questions asked at the end of both passes: those that were equivalent and are not now (lost), and the other way (won)
export function flipsBetween(before, rows) {
  const was = new Set(before.heldRight || []);
  const askedThen = new Set(before.heldAsked || before.heldRight || []);
  const both = rows.filter((r) => askedThen.has(r.id));
  return {
    lost: both.filter((r) => was.has(r.id) && r.grade !== 'right').map((r) => r.id),
    won: both.filter((r) => !was.has(r.id) && r.grade === 'right').map((r) => r.id),
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const what = process.argv[2];
  const state = readState();
  const briefs = readBriefs();
  const targets = readTargets();
  if (what === 'order') {
    console.log((state.order.length ? state.order : orderOf(null, briefs.slots)).join(' '));
  } else if (what === 'begin') {
    const rung = targetOf(state);
    console.log('Pass ' + (state.pass + 1) + '. Target: ' + rung.name + '.');
    const last = state.history[state.history.length - 1];
    if (last)
      console.log(
        'Last pass: ' +
          (last.compared
            ? (last.level ? 'at parity with ' : 'not at parity with ') +
              last.target +
              ' (' +
              last.equivalent +
              ' of ' +
              last.compared +
              ' answers equivalent, ' +
              (last.compared - last.equivalent) +
              ' not)'
            : last.target + ' gave no answers to compare with') +
          '.',
      );
    console.log(
      'Train questions: seed ' +
        state.seeds.train +
        (Object.keys(state.focus).length
          ? ', with more of: ' +
            Object.entries(state.focus)
              .map(([k, n]) => k + ' +' + n)
              .join(', ')
          : '') +
        '. Held questions: seed ' +
        state.seeds.held +
        '.',
    );
    console.log(
      'Slots, worst first: ' +
        (state.order.length ? state.order.join(', ') : 'not yet measured; the checkers first') +
        '.',
    );
    const open = state.ideas.filter((i) => i.status === 'open');
    console.log(
      open.length +
        ' ideas waiting to be measured' +
        (open.length ? ': ' + open.map((i) => i.slot + ' <- ' + i.from).join(', ') : '') +
        '.',
    );
  } else if (what === 'end') {
    const held = (label) =>
      newest(
        rowsOf(
          label === 'swarm' ? 'swarm-runs.jsonl' : 'baseline-runs.jsonl',
          (r) =>
            r.split === 'held' &&
            r.seed === state.seeds.held &&
            (label === 'swarm'
              ? r.label === 'swarm' && r.cfg === CONFIG_ID && r.target === targetOf().id
              : r.label === label),
        ),
      );
    const rung = targetOf(state);
    const swarmRows = held('swarm');
    if (!swarmRows.length) {
      console.log('The swarm has not been measured on the held questions of this pass. Nothing was written.');
      process.exit(2);
    }
    // what became of each idea: a brief that was measured and not kept is never measured again
    const kept = new Set();
    for (const l of fs.existsSync(path.join(RESULTS, 'briefs-history.jsonl'))
      ? fs.readFileSync(path.join(RESULTS, 'briefs-history.jsonl'), 'utf8').split('\n').filter(Boolean)
      : []) {
      const r = JSON.parse(l);
      if (r.kept && r.keptHash) kept.add(r.keptHash);
    }
    for (const i of state.ideas)
      if (i.status === 'open')
        i.status = kept.has(i.hash) ? 'kept' : (state.tried[i.slot] || []).includes(i.hash) ? 'dropped' : 'open';
    const {
      next,
      done,
      parity: p,
      climbed,
    } = endPass(state, { swarmRows, train: result('swarm-train'), briefs, targets });
    // NO FLIP GOES UNNAMED: an answer that was equivalent at the end of the last pass and is not now, and the other way. A total
    // that rose by one can hide one that was lost.
    const before = ((readLearned() || {}).passes || [])
      .filter((x) => Array.isArray(x.heldRight) && x.heldSeed === state.seeds.held)
      .pop();
    done.heldSeed = state.seeds.held;
    done.heldRight = swarmRows.filter((r) => r.grade === 'right').map((r) => r.id);
    if (before) done.flips = { ...flipsBetween(before, swarmRows), since: before.pass };
    done.heldAsked = swarmRows.map((r) => r.id);
    // EVERY HELD QUESTION A SECOND WAY: equivalent there too?
    const second = newest(
      rowsOf(
        'swarm-runs.jsonl',
        (r) =>
          r.split === 'reworded' &&
          r.seed === state.seeds.held &&
          r.label === 'swarm' &&
          r.cfg === CONFIG_ID &&
          r.target === targetOf().id,
      ),
    );
    const p2 = second.length ? parity(second) : null;
    if (p2) done.reworded = { compared: p2.compared, equivalent: p2.equivalent };
    // A BAR THAT IS HELD TIGHTENS: a kind at parity on the held questions for so many passes in a row (the policy: ratchet) is
    // asked more of from the next pass on
    const ratchet = readPolicy(state).ratchet || {};
    const kinds = {};
    for (const r of swarmRows) {
      if (r.grade === 'noref') continue;
      const k = (kinds[r.kind] = kinds[r.kind] || { n: 0, right: 0 });
      k.n++;
      if (r.grade === 'right') k.right++;
    }
    next.streak = { ...(state.streak || {}) };
    next.tiers = { ...(state.tiers || {}) };
    done.tightened = [];
    for (const [kind, k] of Object.entries(kinds)) {
      next.streak[kind] = k.n && k.right === k.n ? (next.streak[kind] || 0) + 1 : 0;
      if (next.streak[kind] >= (ratchet.passes || 3) && (next.tiers[kind] || 0) < (ratchet.max ?? 2)) {
        next.tiers[kind] = (next.tiers[kind] || 0) + 1;
        next.streak[kind] = 0;
        done.tightened.push(kind);
      }
    }
    next.history[next.history.length - 1] = done;
    writeState(next);
    notePass(done, briefs); // on this swarm's own record, beside what it has learned (src/learned.mjs)
    if (climbed) {
      // against the next, larger model this swarm starts a record of its own, on held questions nothing has been chosen on
      seedState(climbed.id, { seeds: next.seeds, focus: {}, tried: {}, order: [], history: [] });
      writeConfig({ target: climbed.id });
    } // at parity: the next, larger model is the one configured from here on
    const alone = (n) => {
      const r = result(aloneLabel(n) + '-held');
      return r && r.compared ? r.right + ' of ' + r.compared + ' equivalent' : 'not measured';
    };
    let md = '\n## Pass ' + done.pass + ' (' + done.at + '), toward parity with ' + rung.name + '\n\n';
    md += p
      ? '**' +
        (p.level ? 'At parity.' : 'Not at parity.') +
        '** On ' +
        p.compared +
        ' held questions the swarm (briefs v' +
        done.briefs +
        ') gave an answer equivalent to ' +
        rung.name +
        "'s on " +
        p.equivalent +
        ', a different one on ' +
        p.differ +
        ', and none on ' +
        p.none +
        '. Parity is every answer equivalent.\n'
      : rung.name + ' gave no answers to these questions, so there is nothing to be at parity with.\n';
    md +=
      '\nEach small model alone, the same way: ' +
      Object.entries(MEMBERS)
        .map(([k, x]) => x.name + ' ' + alone(k))
        .join('; ') +
      '.\n';
    if (done.flips)
      md +=
        '\nSince pass ' +
        done.flips.since +
        ', on the same held questions: ' +
        (done.flips.lost.length ? 'LOST ' + done.flips.lost.join(', ') : 'none lost') +
        '; ' +
        (done.flips.won.length ? 'won ' + done.flips.won.join(', ') : 'none won') +
        '.\n';
    if (done.reworded)
      md +=
        '\nThe held questions put a second way: ' +
        done.reworded.equivalent +
        ' of ' +
        done.reworded.compared +
        ' equivalent.\n';
    if (done.tightened && done.tightened.length)
      md +=
        '\nHeld at parity for ' +
        (ratchet.passes || 3) +
        ' passes, and asked more of from the next pass: ' +
        done.tightened.join(', ') +
        '.\n';
    if (p && p.trailing.length)
      md +=
        '\nNot equivalent on: ' +
        p.trailing.map((k) => k.kind + ' (' + k.differ + ' of ' + k.of + ')').join(', ') +
        '.\n';
    md +=
      '\nFor the next pass: ' +
      (Object.keys(next.focus).length
        ? 'more questions of ' + Object.keys(next.focus).join(', ')
        : 'no kind singled out') +
      '; slots in this order: ' +
      next.order.join(', ') +
      '; ' +
      next.questions.length +
      ' searches' +
      (climbed
        ? '; **the target is now ' + climbed.name + '**'
        : p && p.level
          ? '; at parity with the last target there is: name a larger one in targets.json'
          : '') +
      '.\n';
    const file = path.join(REPO_ROOT, 'training', 'passes.md');
    if (!fs.existsSync(file))
      fs.writeFileSync(
        file,
        '# Passes\n\nWhether each training pass reached parity with the larger model on the held questions (every answer fundamentally equivalent to the answer of the larger model), how many answers were not, and what it left for the next. Written by `training/pass.mjs end`.\n',
      );
    fs.appendFileSync(file, md);
    console.log(md.trim());
  } else {
    console.log('pass.mjs begin | order | end');
    process.exit(2);
  }
}
