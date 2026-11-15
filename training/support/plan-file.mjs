// plan-file.mjs - THE PLAN AS A FILE: read, written whole, and marked as each move is measured. Kept apart from plan.mjs so that the
// trainers that mark it do not load the planner (which loads them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafe, writeSafe } from './recover.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = process.env.SWARM_WORK_DIR || path.join(ROOT, '.work', 'train');
export const PLAN_FILE = path.join(WORK, 'plan.json');

export const readPlan = () => readSafe(PLAN_FILE, null);
export function writePlan(plan) {
  fs.mkdirSync(WORK, { recursive: true });
  writeSafe(PLAN_FILE, JSON.stringify(plan, null, 2) + '\n');
  return plan;
}
// a move, as it is measured: 'running', then 'kept' or 'not kept' with what it scored. Moves are found by id, or by what they are.
export function mark(match, status, more = {}) {
  const plan = readPlan();
  if (!plan) return null;
  let hit = 0;
  for (const m of plan.moves)
    if (match(m)) {
      Object.assign(m, { status, ...more });
      hit++;
    }
  if (hit) writePlan(plan);
  return hit;
}
