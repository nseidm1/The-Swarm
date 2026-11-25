// sandbox.mjs - RUNNING A FUNCTION A MODEL WROTE, WHERE IT CAN REACH NOTHING. Two things need it: the trainers, to see whether two
// functions do the same (training/support/equivalent.mjs), and the swarm itself, to see which of its own drafts do the same
// (behave.mjs). A model's code is never run in this process. It runs in a process of its own with Node's permissions on (no
// files, no programs, no workers), in a context with no require, no process and no import, each call stopped after a moment
// (sandbox-runner.mjs). What comes back is text.
//   outputsOf(code, name, inputs)  -> [{ v } | { e }] for each list of arguments, or null when it cannot be run at all
//   callsOf(code, name, calls)     -> the same, for calls written out as text ("rotate([1, 2])"), which are read inside the sandbox
//   printedBy(code)                -> { text } the lines a whole program printed, or null (behave.mjs programOf)
//   outputsNow(code, name, inputs) -> the same as outputsOf, for a caller that cannot wait (a check that is not async): the
//                                     process is started and waited for
//   sandboxReady()                 -> can a function be run here at all? (Node 20 or later)
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('./sandbox-runner.mjs', import.meta.url));
const FLAG = Number(process.versions.node.split('.')[0]) >= 22 ? '--permission' : '--experimental-permission';
export const bare = (code) => String(code).replace(/^\s*export\s+(default\s+)?/gm, '');

// what was run is remembered (the same function on the same inputs gives the same answers), but not without end: a server that
// answers for days must not hold every function it ever ran
const seen = new Map();
const remember = (key, p) => {
  if (seen.size >= 400) seen.clear();
  seen.set(key, p);
  return p;
};
function runIn(job, count, timeoutMs) {
  return new Promise((done) => {
    if (!job.code) return done(null);
    let child;
    try {
      child = spawn(process.execPath, [FLAG, '--allow-fs-read=' + RUNNER, '--max-old-space-size=128', RUNNER], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      return done(null);
    }
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => done(null));
    child.stdin.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        done(job.print ? (r.ok ? r : null) : r.ok && r.out.length === count ? r.out : null);
      } catch {
        done(null);
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
export function outputsOf(code, name, inputs, { timeoutMs = 8000 } = {}) {
  const key = name + '\n' + code + '\n' + JSON.stringify(inputs);
  return seen.get(key) || remember(key, runIn({ code: bare(code), name, inputs }, inputs.length, timeoutMs));
}
// THE SAME, WAITED FOR: for a check that must say yes or no before it returns (a convention of a conversation, which is asked
// with no promise: training/tasks-chat.mjs). The same process, the same permissions, the same runner
export function outputsNow(code, name, inputs, { timeoutMs = 4000 } = {}) {
  if (!code) return null;
  try {
    const r = spawnSync(process.execPath, [FLAG, '--allow-fs-read=' + RUNNER, '--max-old-space-size=128', RUNNER], {
      input: JSON.stringify({ code: bare(code), name, inputs }),
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const j = JSON.parse(r.stdout || 'null');
    return j && j.ok && Array.isArray(j.out) && j.out.length === inputs.length ? j.out : null;
  } catch {
    return null;
  }
}
export function callsOf(code, name, calls, { timeoutMs = 8000 } = {}) {
  const key = name + '\n' + code + '\ncalls\n' + calls.join('\n');
  return seen.get(key) || remember(key, runIn({ code: bare(code), name, calls }, calls.length, timeoutMs));
}

// WHAT A PROGRAM PRINTS: run once as it stands (sandbox-runner.mjs print), -> the lines it printed, or null where it could not be
// run, threw, printed nothing, or printed something other than strings, numbers, booleans, null, undefined and bigints
export function printedBy(code, { timeoutMs = 8000 } = {}) {
  const key = 'print\n' + code;
  return (
    seen.get(key) ||
    remember(
      key,
      runIn({ code: bare(code), print: true }, 0, timeoutMs).then((r) =>
        r && r.plain && String(r.printed).trim() ? { text: String(r.printed).trim() } : null,
      ),
    )
  );
}

// CAN A FUNCTION BE RUN HERE AT ALL? Asked once, with a function that returns 1.
let ready = null;
export function sandboxReady() {
  ready = ready || outputsOf('function one() { return 1; }', 'one', [[]]).then((o) => !!(o && o[0] && o[0].v === '1'));
  return ready;
}
