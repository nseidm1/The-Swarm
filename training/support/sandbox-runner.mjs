// sandbox-runner.mjs - RUNS A FUNCTION A MODEL WROTE, AND SAYS WHAT IT RETURNED. Started by exec.mjs in a process of its own with
// Node's permissions on: it cannot read or write a file (but this one), start a program, or open a worker. The code itself runs in
// a context that has no require, no process and no import, and each call is stopped after a moment. What comes back is data.
//   stdin:  { code, name, inputs: [[args...], ...], callMs }
//   stdout: { ok: true, out: [ { v: <JSON text of what it returned> } | { e: true } ] }  |  { ok: false, why }
import vm from 'node:vm';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const { code, name, inputs, callMs = 400 } = JSON.parse(raw);
const say = (o) => process.stdout.write(JSON.stringify(o));
// NOTHING OF THIS PROCESS IS HANDED TO THE CODE. The place it runs in is made from an object with no prototype, so there is no
// chain to climb out by; its console, the reading of its arguments and the writing-down of what it returned are all made INSIDE
// that place; and what crosses the line, in either direction, is text. (Node's permissions stop files, programs and workers; they
// do not stop the network, which is why the code must not be able to reach this process at all.)
const INSIDE = `
globalThis.console = { log() {}, error() {}, warn() {}, info() {} };
globalThis.__text = (v) =>
  JSON.stringify(v, (k, x) =>
    x === undefined ? '__undefined__'
    : typeof x === 'number' && !Number.isFinite(x) ? '__' + String(x) + '__'
    : Object.is(x, -0) ? '__-0__'
    : typeof x === 'bigint' ? '__big' + x + '__'
    : typeof x === 'function' ? '__function__'
    : x);
`;
try {
  const box = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(INSIDE, box, { timeout: 500 });
  vm.runInContext(String(code), box, { timeout: 1000 });
  // a function declared, or one kept in a const or a let (which a context does not show as a property)
  const has = vm.runInContext('typeof ' + name + " === 'function'", box, { timeout: 200 });
  if (has !== true) say({ ok: false, why: 'no function called ' + name });
  else {
    const out = [];
    for (const args of inputs) {
      try {
        // each call has its own copy of what it is given (parsed inside), so a function that changes it cannot spoil the next;
        // and what it returned comes back as text
        const v = vm.runInContext(
          '__text(' + name + '(...JSON.parse(' + JSON.stringify(JSON.stringify(args)) + ')))',
          box,
          { timeout: callMs },
        );
        out.push({ v: typeof v === 'string' ? v : '__undefined__' });
      } catch {
        out.push({ e: true });
      }
    }
    say({ ok: true, out });
  }
} catch (e) {
  say({ ok: false, why: String((e && e.message) || e).slice(0, 160) });
}
