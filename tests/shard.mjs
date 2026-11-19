// shard.mjs - THE CHECKS OF tests/run.mjs, SIDE BY SIDE ON EVERY CORE. run.mjs is one opening (the imports, the stand-in servers,
// the swarm they share) and then blocks, each a group of checks in braces of its own. A block needs nothing of another block: it
// takes what the opening made and sets what it uses. So the blocks are dealt out to as many processes as the machine has cores,
// each process given the opening, its blocks in their order, and the closing; every process has folders of its own (tests/env.mjs
// makes them), and its stand-in servers listen on ports the system hands out. What they print is gathered and counted as one run.
//   node tests/shard.mjs                  as many at once as there are cores
//   node tests/shard.mjs --jobs 4         four at once            --serial   one process, run.mjs as it is
//   node tests/shard.mjs --dashboard      and the dashboard's checks (python3 ui/check.py) beside them
//   node tests/shard.mjs --times          how long each block took, longest first
// A shard is a file written beside run.mjs for the length of the run (tests/.shard-N.mjs: its imports are run.mjs's own), and
// taken away after. Nothing of run.mjs is changed: `node tests/run.mjs` is still the whole of it in one process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const flag = (name) => (argv.includes('--' + name) ? argv[argv.indexOf('--' + name) + 1] : null);
const CORES = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const JOBS = Math.max(1, argv.includes('--serial') ? 1 : Number(flag('jobs') || process.env.SWARM_TEST_JOBS) || CORES);

// THE PARTS OF run.mjs: the opening (to the first block), the blocks (a line that is "{" to the line that is "}"), and the closing
// (after the last block). A line outside a block, between two of them, would belong to no one: there is none, and that is checked.
export function partsOf(text) {
  const lines = text.split('\n');
  const blocks = [];
  let open = -1;
  let first = -1;
  let last = -1;
  const between = [];
  for (let i = 0; i < lines.length; i++) {
    if (open < 0 && lines[i] === '{') {
      open = i;
      if (first < 0) first = i;
    } else if (open >= 0 && lines[i] === '}') {
      // (the comment lines that head a block go with it)
      let from = open;
      while (from > 0 && lines[from - 1].startsWith('//') && from - 1 > last) from--;
      blocks.push({ at: open + 1, text: lines.slice(from, i + 1).join('\n') });
      last = i;
      open = -1;
    } else if (open < 0 && first >= 0 && last >= 0 && lines[i].trim() && !lines[i].startsWith('//')) between.push(i);
  }
  const closingFrom = last + 1;
  const stray = between.filter((i) => i < closingFrom);
  // (the comments that head the first block are the first block's, not the opening's)
  let openingTo = first;
  while (openingTo > 0 && lines[openingTo - 1].startsWith('//')) openingTo--;
  return {
    opening: lines.slice(0, openingTo).join('\n'),
    blocks,
    closing: lines.slice(closingFrom).join('\n'),
    stray,
  };
}

// dealt out so that the shards are as even as their blocks allow: the longest block first, each to the shard with the least so
// far. A block's weight is how long it took when last timed (tests/shard-times.json), else its length in lines.
export function deal(blocks, n, times = {}) {
  const weight = (b) => (times[b.at] != null ? Number(times[b.at]) : b.text.split('\n').length / 400);
  const shards = Array.from({ length: Math.min(n, blocks.length) }, () => ({ blocks: [], weight: 0 }));
  for (const b of [...blocks].sort((x, y) => weight(y) - weight(x))) {
    const s = shards.reduce((m, x) => (x.weight < m.weight ? x : m), shards[0]);
    s.blocks.push(b);
    s.weight += weight(b);
  }
  for (const s of shards) s.blocks.sort((x, y) => x.at - y.at); // (in a shard, the order they are written in)
  return shards;
}

const run = (cmd, args, env = {}) =>
  new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (text += d));
    child.on('error', (e) => done({ code: 1, text: text + '\n' + e.message, seconds: 0 }));
    child.on('close', (code) => done({ code, text, seconds: (Date.now() - t0) / 1000 }));
  });

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const t0 = Date.now();
  const source = fs.readFileSync(path.join(HERE, 'run.mjs'), 'utf8');
  const parts = partsOf(source);
  if (parts.stray.length) {
    console.log(
      'tests/run.mjs has lines between its blocks (line ' + (parts.stray[0] + 1) + '): they would run in no shard.',
    );
    process.exit(1);
  }
  let times = {};
  try {
    times = JSON.parse(fs.readFileSync(path.join(HERE, 'shard-times.json'), 'utf8')).seconds || {};
  } catch {
    /* never timed: dealt by length */
  }
  const wantTimes = argv.includes('--times');
  const shards = JOBS === 1 ? [] : deal(parts.blocks, JOBS, times);
  const files = [];
  const jobs = [];
  if (JOBS === 1) jobs.push({ name: 'run.mjs', go: () => run(process.execPath, ['tests/run.mjs']) });
  shards.forEach((s, i) => {
    const file = path.join(HERE, '.shard-' + i + '.mjs');
    // (each block says how long it took, on a line of its own that is not a check's)
    const body = s.blocks
      .map(
        (b) =>
          'globalThis.__t = Date.now();\n' +
          b.text +
          "\nconsole.log('TIME " +
          b.at +
          " ' + (Date.now() - globalThis.__t));",
      )
      .join('\n');
    fs.writeFileSync(file, parts.opening + '\n' + body + '\n' + parts.closing);
    files.push(file);
    jobs.push({ name: 'shard ' + (i + 1), go: () => run(process.execPath, [file]) });
  });
  if (argv.includes('--dashboard'))
    jobs.push({ name: 'dashboard', go: () => run(process.env.PYTHON || 'python3', ['ui/check.py']) });
  const clean = () => {
    for (const f of files)
      try {
        fs.unlinkSync(f);
      } catch {
        /* gone */
      }
  };
  process.on('exit', clean);
  process.on('SIGINT', () => process.exit(130));
  const results = await Promise.all(jobs.map(async (j) => ({ ...j, ...(await j.go()) })));
  clean();
  let passed = 0;
  const failed = [];
  const took = {};
  const broke = [];
  for (const r of results) {
    const lines = r.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^ok\s/.test(l)) passed++;
      else if (/^FAIL\s/.test(l))
        failed.push(l + (lines[i + 1] && /^\s{4,}/.test(lines[i + 1]) ? '\n' + lines[i + 1] : ''));
      else if (/^TIME \d+ \d+$/.test(l)) took[l.split(' ')[1]] = Number(l.split(' ')[2]) / 1000;
    }
    // (a process that stopped without its closing line ran into something that is not a check: said, with its last words)
    if (r.code !== 0 && !lines.some((l) => /^FAIL\s/.test(l)))
      broke.push(
        r.name + ' stopped (exit ' + r.code + '): ' + lines.filter(Boolean).slice(-4).join(' | ').slice(0, 600),
      );
  }
  for (const f of failed) console.log(f);
  for (const b of broke) console.log('FAIL  ' + b);
  if (wantTimes) {
    const rows = Object.entries(took).sort((x, y) => y[1] - x[1]);
    for (const [at, s] of rows.slice(0, 15))
      console.log(String(s.toFixed(1)).padStart(7) + ' s  the block at line ' + at);
    if (argv.includes('--keep-times'))
      fs.writeFileSync(
        path.join(HERE, 'shard-times.json'),
        JSON.stringify(
          {
            about:
              'How long each block of tests/run.mjs took when last timed (seconds, by the line its brace opens on): what tests/shard.mjs deals the blocks out by, so that the shards come out even. node tests/shard.mjs --times --keep-times writes it again. A block that has moved or is new is dealt by its length.',
            seconds: Object.fromEntries(rows.map(([at, s]) => [at, Math.round(s * 10) / 10])),
          },
          null,
          2,
        ) + '\n',
      );
  }
  const wall = (Date.now() - t0) / 1000;
  const sum = results.reduce((n, r) => n + r.seconds, 0);
  const bad = failed.length + broke.length;
  console.log(
    '\n' +
      (bad ? bad + ' FAILED, ' : 'all ') +
      passed +
      ' passed, in ' +
      wall.toFixed(0) +
      ' s: ' +
      results.map((r) => r.name + ' ' + r.seconds.toFixed(0) + ' s').join(', ') +
      ' (one after another: ' +
      sum.toFixed(0) +
      ' s).',
  );
  process.exit(bad ? 1 : 0);
}
