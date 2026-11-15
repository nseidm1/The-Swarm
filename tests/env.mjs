// env.mjs - imported FIRST by the checks, so that it has run before anything else is loaded: the trainers' working folder (where
// checkpoints and the record of recoveries go) is pointed at a folder of the checks' own. A check never writes into a real pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-work-'));
process.env.SWARM_WORK_DIR = WORK_DIR;
