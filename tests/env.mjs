// env.mjs - imported FIRST by the checks, so that it has run before anything else is loaded: the trainers' working folder (where
// checkpoints and the record of recoveries go) is pointed at a folder of the checks' own. A check never writes into a real pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-work-'));
process.env.SWARM_WORK_DIR = WORK_DIR;
// AND A CHECK NEVER STOPS A REAL PROCESS. The checks run the trainers' own recovery code, which stops model servers a dead session
// left behind; run beside a live session that would stop the session's servers (training/support/recover.mjs: reap).
process.env.SWARM_NO_REAP = '1';
// AND A CHECK NEVER READS OR WRITES WHAT A REAL SWARM HAS LEARNED (src/learned.mjs): the checks start from briefs.json, always.
process.env.SWARM_LEARNED_DIR = path.join(WORK_DIR, 'learned');
// nor what a real configuration remembers of its training (training/state.mjs)
process.env.SWARM_STATES_DIR = path.join(WORK_DIR, 'states');
process.env.SWARM_STATE = path.join(WORK_DIR, 'state.json');
// nor the configuration a person has chosen: the checks have a copy of it, and change only the copy (src/catalog.mjs)
fs.copyFileSync(new URL('../src/config.json', import.meta.url), path.join(WORK_DIR, 'config.json'));
process.env.SWARM_CONFIG = path.join(WORK_DIR, 'config.json');
// nor the questions a person wrote (training/questions/)
process.env.SWARM_QUESTIONS_DIR = path.join(WORK_DIR, 'questions');
