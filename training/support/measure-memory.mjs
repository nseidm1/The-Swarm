// measure-memory.mjs - WHAT THE SWARM TAKES IN MEMORY, MEASURED. The page's figure is an estimate from the model files (a quarter
// more, a gigabyte of context, the decider's listed size), and for a model whose file is packed tighter than the engine holds it
// in memory the estimate is far off (measured 2026-11-19: Bonsai 2 4B, a 1.2 GB file of two-bit weights, took 10.3 GB while it
// ran, 8.9 GB of it weights unpacked, where LFM2.5 1.2B took 0.84 GB for a 0.73 GB file; a lineup said to save 73% saved 27%).
// So a pass measures each model's own process while it serves, and writes that down beside the estimate.
//   gbOfPid(pid)            -> GB that process holds, or null. On a Mac its physical footprint (vmmap; what Activity Monitor
//                              calls Memory, which counts what a model holds on the GPU); elsewhere, or where vmmap says nothing,
//                              its resident size (ps)
//   pidOnPort(port)         -> the process listening on a port of this machine, or null (a decider is known by its address)
//   measureSwarm({ members: { a: pid, ... }, decider: url, target: gb }) -> { members: { a: gb }, decider: gb, swarm, target,
//                              saved, savedGb, at } or null where no member could be measured. A decider that does not run on
//                              this machine is not measured, and `decider` is then absent: `swarm` says so in `without`
import { spawnSync } from 'node:child_process';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const run = (cmd, args, timeout = 8000) => {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
    return r.status === 0 ? String(r.stdout || '') : '';
  } catch {
    return '';
  }
};
// "Physical footprint:         10.3G" -> 10.3 (K, M and G as vmmap writes them)
export function footprintIn(text) {
  const m = /^Physical footprint:\s+([\d.]+)([KMG])/m.exec(String(text || ''));
  if (!m) return null;
  return Number(m[1]) / { K: 1024 * 1024, M: 1024, G: 1 }[m[2]];
}
export function gbOfPid(pid, { platform = process.platform, exec = run } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === 'darwin') {
    const gb = footprintIn(exec('vmmap', ['-summary', String(pid)]));
    if (gb) return r2(gb);
  }
  const kb = Number(exec('ps', ['-o', 'rss=', '-p', String(pid)]).trim());
  return kb > 0 ? r2(kb / 1024 / 1024) : null;
}
export function pidOnPort(port, { exec = run } = {}) {
  if (!(Number(port) > 0)) return null;
  const pid = Number(
    exec('lsof', ['-nP', '-iTCP:' + Number(port), '-sTCP:LISTEN', '-t'])
      .trim()
      .split('\n')[0],
  );
  return pid > 0 ? pid : null;
}
const localPort = (url) => {
  try {
    const u = new URL(String(url || ''));
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) ? Number(u.port) : 0;
  } catch {
    return 0;
  }
};
export function measureSwarm({ members = {}, decider = '', target = 0 } = {}, tools = {}) {
  const out = { members: {} };
  for (const [key, pid] of Object.entries(members)) {
    const gb = gbOfPid(Number(pid), tools);
    if (gb) out.members[key] = gb;
  }
  if (!Object.keys(out.members).length || Object.keys(out.members).length < Object.keys(members).length) return null;
  const dp = localPort(decider) ? pidOnPort(localPort(decider), tools) : null;
  const dgb = dp ? gbOfPid(dp, tools) : null;
  if (dgb) out.decider = dgb;
  else out.without = 'the decider';
  out.swarm = r1(Object.values(out.members).reduce((a, b) => a + b, 0) + (dgb || 0));
  if (target > 0) {
    out.target = target;
    out.saved = r1(100 - (100 * out.swarm) / target);
    out.savedGb = r1(target - out.swarm);
  }
  out.at = new Date().toISOString();
  return out;
}
