// policy.mjs - HOW THE TRAINER TRAINS, AS DATA. How many changes are tried on a question and how many questions a change is asked
// again on before it is kept (loop), what the plan lists first (plan), how much each kind of move counts for (moves), when a bar
// that is held tightens (ratchet): none of it is written into the trainers. It is in training/policy.json (where every
// configuration starts) and, over that, in each configuration's own record (training/states/: `policy`), set by a person.
//   readPolicy()                 the policy this configuration trains by now
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
