// policy.mjs - HOW THE TRAINER TRAINS, AS DATA. The margin a change must win by, how many arrangements a pass tries, how much each
// kind of move counts for, the room a slot is given, when a pass reviews itself and the rules it then applies: none of it is
// written into the trainers. It is in training/policy.json (where every configuration starts) and, over that, in each
// configuration's own record (training/states/: `policy`, and `policyLog` saying what was changed, when, by which rule and why).
// The review step (review.mjs) changes it from what a pass measured. A person can change either file by hand; so can a rule that
// is itself only data. Nothing here changes a program.
//   readPolicy()                 the policy this configuration trains by now
//   setPolicy(path, value, why)  one setting changed, on this configuration's record, with its reason
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const POLICY_FILE = process.env.SWARM_POLICY || path.join(HERE, 'policy.json');
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
};
export const basePolicy = () => JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
export function readPolicy(state = readState()) {
  return merge(basePolicy(), state.policy || {});
}
export const at = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setPolicy(dotted, value, { why = '', rule = '', pass } = {}) {
  const state = readState();
  const before = at(readPolicy(state), dotted);
  if (JSON.stringify(before) === JSON.stringify(value)) return null;
  const policy = JSON.parse(JSON.stringify(state.policy || {}));
  const keys = dotted.split('.');
  let o = policy;
  for (const k of keys.slice(0, -1)) o = o[k] = isObj(o[k]) ? o[k] : {};
  o[keys[keys.length - 1]] = value;
  const entry = {
    at: new Date().toISOString(),
    pass: pass ?? state.pass + 1,
    set: dotted,
    from: before,
    to: value,
    rule,
    why,
  };
  writeState({ ...state, policy, policyLog: [...(state.policyLog || []), entry] });
  return entry;
}
