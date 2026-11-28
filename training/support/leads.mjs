// leads.mjs - WHAT A PROBE LEFT FOR TRAINING TO TRY FIRST (training/results/<configuration>/leads.json).
// The class stage tries some ninety changes on a class's train questions and puts ONE, the best, on the held questions.
// A probe, run apart from a pass (it asks more held questions, over more draws, and keeps nothing), can find a change
// that gains on held questions and that the stage would never have put there: a runner-up on the train questions, or a
// switch of the plan the stage has no move for. Such a change is a LEAD. It is not adopted: the class stage puts each
// lead of a class on ITS OWN held questions before its first round, beside the module as it stands, and keeps it by the
// same rule as any other change (training/keep.mjs). A lead that is not kept costs its asking and changes nothing.
//   leads.json: { "at": ..., "from": "...", "classes": { "<class>": [ { "name": "<a move's name, or a + b>", "plan": { ...keys set on the class's plan }, "probe": { gain, error, questions, draws } } ] } }
// A lead with "plan" is the class's plan with those keys set; one without is built by its name from the moves the stage
// can make from the arrangement as it stands ("a + b": b made from a). One that cannot be built is said and passed over.
// A lead already judged on the arrangement as it stands is not judged again (the pass's own record, leads-judged.json).
import fs from 'node:fs';
import path from 'node:path';

export const leadsFile = (resultsDir) => path.join(resultsDir, 'leads.json');
export function readLeads(resultsDir, K) {
  try {
    const j = JSON.parse(fs.readFileSync(leadsFile(resultsDir), 'utf8'));
    const list = ((j && j.classes) || {})[K];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.name === 'string' && l.name.trim()) : [];
  } catch {
    return [];
  }
}
// -> { name, briefs } | null.   movesOf(briefs) -> [{ name, briefs }]: the moves that can be made from an arrangement
export function buildLead(lead, base, movesOf) {
  if (lead.plan && typeof lead.plan === 'object' && !Array.isArray(lead.plan)) {
    const same = Object.entries(lead.plan).every(
      ([k, v]) => JSON.stringify((base.plan || {})[k]) === JSON.stringify(v),
    );
    // (a plan that already reads so is no change: there is nothing to judge)
    return same
      ? null
      : { name: 'plan: ' + lead.name, briefs: { ...base, plan: { ...(base.plan || {}), ...lead.plan } } };
  }
  let b = base;
  for (const part of String(lead.name).split(' + ')) {
    const m = (movesOf(b) || []).find((x) => x.name === part);
    if (!m) return null;
    b = m.briefs;
  }
  return { name: lead.name, briefs: b };
}
// what was judged, and on which arrangement: { "<name>|<the arrangement's key>": { kept, gain, error, at } }
export function readJudged(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}
export const judgedKey = (name, baseKey) => name + '|' + baseKey;
export function noteJudged(file, name, baseKey, verdict) {
  const all = readJudged(file);
  all[judgedKey(name, baseKey)] = { ...verdict, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 1));
}
