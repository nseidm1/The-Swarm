// sandbox.mjs - RUNNING A FUNCTION A MODEL WROTE, WHERE IT CAN REACH NOTHING. Two things need it: the trainers, to see whether two
// functions do the same (training/support/equivalent.mjs), and the swarm itself, to see which of its own drafts do the same
// (behave.mjs). A model's code is never run in this process. It runs in a process of its own with Node's permissions on (no
// files, no programs, no workers), in a context with no require, no process and no import, each call stopped after a moment
// (sandbox-runner.mjs). What comes back is text.
//   outputsOf(code, name, inputs)  -> [{ v } | { e }] for each list of arguments, or null when it cannot be run at all
//   callsOf(code, name, calls)     -> the same, for calls written out as text ("rotate([1, 2])"), which are read inside the sandbox
//   sandboxReady()                 -> can a function be run here at all? (Node 20 or later)
import { spawn } from 'node:child_process';
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
        done(r.ok && r.out.length === count ? r.out : null);
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
export function callsOf(code, name, calls, { timeoutMs = 8000 } = {}) {
  const key = name + '\n' + code + '\ncalls\n' + calls.join('\n');
  return seen.get(key) || remember(key, runIn({ code: bare(code), name, calls }, calls.length, timeoutMs));
}

// CAN A FUNCTION BE RUN HERE AT ALL? Asked once, with a function that returns 1.
let ready = null;
export function sandboxReady() {
  ready = ready || outputsOf('function one() { return 1; }', 'one', [[]]).then((o) => !!(o && o[0] && o[0].v === '1'));
  return ready;
}
