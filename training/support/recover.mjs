// recover.mjs - WHAT A TRAINING SESSION DOES WHEN SOMETHING GOES WRONG, which over hours on one machine something will. A session
// that stops at the first fault, or carries on as if nothing had happened, measures nothing. So each kind of fault has its own
// way back, tried in order, and a session only stops where there is none:
//   a model server gone or hung     it is started again, and the question is asked again
//   a model that will not start     once more; then with less context (a machine short of memory); then it is said
//   a reply with nothing in it      asked again (the larger model, with another draw); still nothing: that question is not compared
//   the decider gone                it is started again before the next question
//   a trainer that stops midway     it is run again, and CARRIES ON: every answer is written down as it comes (a checkpoint),
//                                   so what was answered is not asked twice
//   a session that stops            the next one resumes the same pass: steps that finished are passed over
//   what a dead session left        its model servers, still holding memory, are stopped before the next one loads its own
//   a file half written             state, briefs and configuration are written whole or not at all, with the last good copy kept
// Every way back that is taken is WRITTEN DOWN (.work/train/recovery.jsonl) and shown on the page: a pass that needed twelve
// restarts is not the same evidence as one that needed none, and a person should be able to tell which they are looking at.
//   node training/support/recover.mjs reap      stop what a dead session left
//   node training/support/recover.mjs port 8009 the first free port from there up
import fs from 'node:fs';
import net from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = process.env.SWARM_WORK_DIR || path.join(ROOT, '.work', 'train'); // the checks point this at a folder of their own
export const RECOVERY_LOG = path.join(WORK, 'recovery.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a way back that was taken: what went wrong, what was done, and whether it worked
export function note(what, did, more = {}) {
  const row = {
    at: new Date().toISOString(),
    trainer: path.basename(process.argv[1] || '', '.mjs'),
    what,
    did,
    ...more,
  };
  try {
    fs.mkdirSync(WORK, { recursive: true });
    fs.appendFileSync(RECOVERY_LOG, JSON.stringify(row) + '\n');
  } catch {
    /* a log that cannot be written must not be a second fault */
  }
  console.log('RECOVERED  ' + what + ': ' + did + (more.why ? ' (' + String(more.why).slice(0, 120) + ')' : ''));
  return row;
}

// WHAT KIND OF FAULT IS IT? The way back depends on it, so it is told from what was said.
export const GONE =
  /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|fetch failed|other side closed|terminated|network error|server stopped|exit \d/i;
export const HUNG = /timed? ?out|TimeoutError|aborted|AbortError|did not answer within/i;
export const NO_MEMORY =
  /out of memory|failed to allocate|insufficient memory|cannot allocate|std::bad_alloc|Metal.*(?:failed|error)|vk::.*OutOfMemory|killed|exit 137|exit -?9\b/i;
export const kindOf = (why) =>
  NO_MEMORY.test(why) ? 'memory' : HUNG.test(why) ? 'hung' : GONE.test(why) ? 'gone' : 'other';

// TRY, AND ON A FAULT THAT HAS A WAY BACK, TAKE IT AND TRY AGAIN. `heal(kind, why, attempt)` does what that kind of fault needs
// (start a server again, wait) and returns false when there is nothing to be done; then the fault is the caller's.
export async function again(what, fn, { tries = 3, heal = async () => true, wait = 800 } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      const why = String((e && e.message) || e);
      const kind = kindOf(why);
      if (attempt === tries || kind === 'other') break;
      let healed = false;
      try {
        healed = (await heal(kind, why, attempt)) !== false;
      } catch (h) {
        note(what, 'could not be put right', { why: String((h && h.message) || h), kind });
        break;
      }
      if (!healed) break;
      note(
        what,
        kind === 'gone'
          ? 'started again, and asked again'
          : kind === 'hung'
            ? 'it hung: started again, and asked again'
            : 'short of memory: started again with less, and asked again',
        { why, kind, attempt },
      );
      await sleep(wait * attempt);
    }
  }
  throw last;
}

// A FILE WRITTEN WHOLE OR NOT AT ALL, with the last good copy kept beside it: a session stopped in the middle of a write must not
// leave the next one a file it cannot read.
export function writeSafe(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  } catch {
    /* no last good copy this time */
  }
  fs.renameSync(tmp, file);
}
// read it; if it will not read, read the last good copy and say so
export function readSafe(file, dflt = null) {
  for (const f of [file, file + '.bak']) {
    try {
      const v = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (f !== file) note(path.basename(file), 'it would not read: the last good copy was used');
      return v;
    } catch {
      /* the next */
    }
  }
  return dflt;
}

// what a set of briefs and a plan are, in a word (their content, not their version number: a candidate has the same number)
export const briefKey = (briefs) =>
  createHash('sha256')
    .update(JSON.stringify([briefs.slots, briefs.plan || {}, briefs.marker || '']))
    .digest('hex')
    .slice(0, 12);

// A CHECKPOINT: the answers a trainer has, written down as they come, under a name that says exactly what they are answers to. A
// trainer run again under the same name starts with them and asks only what is left.
const ckFile = (name) => path.join(WORK, 'checkpoints', name.replace(/[^\w.+-]+/g, '_') + '.jsonl');
export function checkpoint(name) {
  const file = ckFile(name);
  const have = new Map();
  try {
    for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(l);
        have.set(r.id, r);
      } catch {
        /* the line a stop cut short */
      }
    }
  } catch {
    /* none yet */
  }
  return {
    have,
    add(row) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
    },
    done() {
      fs.rmSync(file, { force: true });
    },
  };
}

// WHAT A DEAD SESSION LEFT RUNNING: model servers started from this folder, with nothing left to stop them. Found by what they
// were started with (a model file under this folder's .work, Kev from this folder's .work/kev, a target served under the name the
// trainers give it), so that nothing of anyone else's is touched. Not done while a session of this folder is still alive.
export function reap({ dry = false, keepKev = false } = {}) {
  // THE CHECKS STOP NOTHING. They run this very code (a step that fails is followed by a reap), and on a machine where a real
  // session is at work that would stop the session's own model servers. It did, on 2026-11-15: ten recoveries in one session,
  // every one of them caused by the checks being run beside it. SWARM_NO_REAP=1 (tests/env.mjs sets it) looks and never stops.
  if (process.env.SWARM_NO_REAP === '1') dry = true;
  let ps = '';
  try {
    ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const mine = String(process.pid);
  const rows = ps
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: m[1], cmd: m[2] }));
  const live = rows.filter(
    (r) =>
      r.cmd.includes(path.join(ROOT, 'training', 'session.sh')) ||
      (r.cmd.includes('training/session.sh') && r.pid !== mine),
  );
  if (live.length > 1 && !keepKev) return []; // another session of this folder is at work (one is the caller's own)
  const left = rows.filter(
    (r) =>
      r.pid !== mine &&
      ((/llama-server/.test(r.cmd) && r.cmd.includes(path.join(ROOT, '.work'))) ||
        (!keepKev && /kev[.]serve/.test(r.cmd) && r.cmd.includes(path.join(ROOT, '.work', 'kev'))) ||
        /tensorfold serve .*--name target\b/.test(r.cmd)),
  );
  for (const r of left) {
    if (dry) continue;
    try {
      process.kill(Number(r.pid), 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  if (left.length && !dry)
    note(
      'a session that had stopped',
      'left ' + left.length + ' model server' + (left.length === 1 ? '' : 's') + ' running: stopped',
      { kind: 'left' },
    );
  return left;
}

export function freePort(from = 8009) {
  const tryPort = (p) =>
    new Promise((ok) => {
      const s = net.createServer();
      s.once('error', () => ok(false));
      s.listen(p, '127.0.0.1', () => s.close(() => ok(true)));
    });
  return (async () => {
    for (let p = from; p < from + 50; p++) if (await tryPort(p)) return p;
    return from;
  })();
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const cmd = process.argv[2];
  if (cmd === 'reap') {
    const left = reap({ keepKev: process.argv.includes('--keep-kev') });
    console.log(
      left.length
        ? 'Stopped ' + left.length + ' model server' + (left.length === 1 ? '' : 's') + ' a session had left running.'
        : 'Nothing was left running.',
    );
  } else if (cmd === 'port') console.log(await freePort(Number(process.argv[3]) || 8009));
  else {
    console.log('recover.mjs reap | port <from>');
    process.exit(2);
  }
}
