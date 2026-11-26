// measure-memory.mjs - WHAT THE SWARM TAKES IN MEMORY, MEASURED. The page's figure is an estimate from the model files (a quarter
// more, a gigabyte of context, the decider's listed size), and an estimate does not see what a server holds besides its model.
// Measured 2026-11-19: with the engine's store of answered prompts left at its default, a 2.7 GB model's server held 13.5 GB
// twenty minutes into training (8.5 GB of it that store), and a swarm estimated to take 6.5 GB took 17.4 GB against the larger
// model's 18. (That store is now off, src/members.mjs --cache-ram 0; it was first misread as a two-bit model's weights unpacked.)
// So a pass measures each model's own process while it serves, and writes that down beside the estimate.
//   gbOfPid(pid)            -> GB that process holds, or null. On a Mac its physical footprint (vmmap; what Activity Monitor
//                              calls Memory, which counts what a model holds on the GPU) and the files mapped into it that
//                              are in memory and not written to, which the footprint leaves out: a model's weights are such
//                              a file (found 2026-11-22: the server of a 1.1 GB model read 0.95 GB, its weights not
//                              counted, and the swarm read 18 times smaller where it was 9); elsewhere, or where vmmap
//                              says nothing, its resident size (ps), which counts them
//   pidOnPort(port)         -> the process listening on a port of this machine, or null (a decider is known by its address)
//   measureSwarm({ members: { a: pid, ... }, decider: url, target: gb }) -> { members: { a: gb }, decider: gb, swarm, target,
//                              saved, savedGb, at } or null where no member could be measured. A decider that does not run on
//                              this machine is not measured, and `decider` is then absent: `swarm` says so in `without`
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
const PER_GB = { K: 1024 * 1024, M: 1024, G: 1 };
// "Physical footprint:         10.3G" -> 10.3 (K, M and G as vmmap writes them)
export function footprintIn(text) {
  const m = /^Physical footprint:\s+([\d.]+)([KMG])/m.exec(String(text || ''));
  if (!m) return null;
  return Number(m[1]) / PER_GB[m[2]];
}
// "mapped file      1.1G     1.0G       0K ..." (virtual, resident, dirty) -> 1.0: the files mapped into the process that are
// in memory and were not written to. The footprint counts what a process wrote and what it holds on the GPU, and not these:
// an engine that maps a model's file holds the weights here. (What was written to is in the footprint: it is not counted twice.)
export function mappedIn(text) {
  const m = /^mapped file\s+([\d.]+)([KMG])\s+([\d.]+)([KMG])\s+([\d.]+)([KMG])/m.exec(String(text || ''));
  return m ? Math.max(0, Number(m[3]) / PER_GB[m[4]] - Number(m[5]) / PER_GB[m[6]]) : 0;
}
export function gbOfPid(pid, { platform = process.platform, exec = run } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === 'darwin') {
    const text = exec('vmmap', ['-summary', String(pid)]);
    const gb = footprintIn(text);
    if (gb) return r2(gb + mappedIn(text));
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
  // (places that share a load are one process: its memory is the first place's, and the others say whose it is)
  const first = new Map();
  for (const [key, pid] of Object.entries(members)) {
    if (first.has(Number(pid))) {
      out.members[key] = 0;
      out.shared = { ...(out.shared || {}), [key]: first.get(Number(pid)) };
      continue;
    }
    const gb = gbOfPid(Number(pid), tools);
    if (gb) {
      out.members[key] = gb;
      first.set(Number(pid), key);
    }
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

// WATCHED WHILE A STAGE SERVES: any stage that has the swarm loaded and asks it questions measures it (the question loop did, and
// it alone; the run a person starts from the page takes the class stage and pretraining, so the page said "estimated, not
// measured" of a swarm that had been serving for an hour). Measured a minute in and every two minutes after, the most seen
// kept (a server's contexts fill as it is asked), written where the page and the end of a pass read it.
//   watchMemory(swarm, { file, config, target }) -> stop()        swarm: { members: { a: { pid } }, decider }
// THE MOST SEEN IS CARRIED FROM AN EARLIER STAGE ONLY WHERE THE SWARM IS SERVED AS IT WAS THEN (servingOf: each place's server
// slots and how many it works on at once). The same models served another way take another amount, and the figure is what the
// swarm takes NOW: measured 2026-11-26, a swarm whose context had been cut from a share for each of twelve slots to a pool
// for four stood at 14 GB while the page said 19.8, the most its earlier serving had reached, and would have said so for good.
export const servingOf = (swarm) =>
  Object.entries((swarm && swarm.members) || {})
    .map(([k, m]) => k + ':' + ((m && m.slots) || '?') + '/' + ((m && (m.atOnce || m.slots)) || '?'))
    .join(' ');
export function watchMemory(swarm, { file, config, target, firstMs = 60000, everyMs = 120000 } = {}) {
  let most = null;
  const serving = servingOf(swarm);
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kept && kept.config === config && kept.swarm && kept.serving === serving) most = kept;
  } catch {
    /* nothing measured yet */
  }
  const once = () => {
    try {
      const pids = Object.fromEntries(Object.entries((swarm && swarm.members) || {}).map(([k, m]) => [k, m && m.pid]));
      if (!Object.keys(pids).length || !Object.values(pids).every((p) => p > 0)) return;
      const m = measureSwarm({ members: pids, decider: swarm.decider, target });
      if (m && (!most || m.swarm >= most.swarm)) {
        most = m;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.part', JSON.stringify({ config, serving, ...m }));
        fs.renameSync(file + '.part', file);
      }
    } catch {
      /* measured again next time */
    }
  };
  const first = setTimeout(once, firstMs);
  const timer = setInterval(once, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    once();
  };
}
