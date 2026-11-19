// search.mjs - THE SEARCH BEHIND THE WEB SEARCH TEST (training/search.json says which, and pins it). A test that offers a model a
// search tool runs the searches itself, so the larger model and the swarm must be asked through the same search service, on the
// same day. Nothing here is part of the swarm: a module searches nothing of its own accord (docs/swoa.md 4.2), and this is only
// what stands behind the tool while it is measured.
//   searchOf(env)            which service: 'searxng' (a SearXNG served here, no key) unless SWARM_SEARCH says 'serpapi'
//   searchBlocked(env)       why the test cannot be asked as things are ('' where it can)
//   searxInstalled()         is SearXNG here, at the pinned revision (training/evaluate.sh installs it into .work/searxng)
//   openSearch()             start it on a free port, wait until it answers -> { base, stop }
//   searchEnv(base, day)     what the tool tests are started with, so that their search goes there and is kept for the day
//   searchRecord(dir)        what a result says of the search: the service, its revision, the engines that answered, what was kept
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const SEARCH = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'search.json'), 'utf8'));
export const SEARX_DIR = path.join(ROOT, '.work', 'searxng');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const searchOf = (env = process.env) => {
  const named = String(env.SWARM_SEARCH || SEARCH.default || 'searxng').toLowerCase();
  return named === 'serpapi' ? 'serpapi' : 'searxng';
};
// (installed: its program at the pinned revision, with the Python it runs on)
export const searxInstalled = (dir = SEARX_DIR) => {
  try {
    return (
      fs.readFileSync(path.join(dir, '.rev'), 'utf8').trim() === SEARCH.searxng.rev &&
      fs.existsSync(path.join(dir, 'src', 'searx', 'webapp.py')) &&
      fs.existsSync(path.join(dir, 'venv', 'bin', 'python'))
    );
  } catch {
    return false;
  }
};
// why the web search test cannot be asked as things are ('' where it can)
export const searchBlocked = (env = process.env, { installed = searxInstalled() } = {}) => {
  if (searchOf(env) === 'serpapi')
    return env[SEARCH.serpapi.needsKey]
      ? ''
      : 'not asked: SWARM_SEARCH names a search service that needs a key (' +
          SEARCH.serpapi.needsKey +
          '), which a person supplies';
  return installed
    ? ''
    : 'not asked: the search behind it (' +
        SEARCH.searxng.name +
        ') is not installed here: training/evaluate.sh installs it the first time';
};
// THE MOST OF A FETCHED PAGE A MODEL IS GIVEN, in characters (training/search.json pageChars; 0: all of it). The test's page
// function returns a page whole, its HTML as it came, and one page can be longer than a model's whole context: measured
// 2026-11-19, the larger model, served with 16384 tokens of context, was sent a prompt of 44890 tokens after a page and 37 of
// its 40 questions ended in that error. The larger model and the swarm are given the same page cut at the same place, so the
// test is of what each does with the same material, not of whose context is wider. The result says where pages were cut.
export const PAGE_CHARS = Math.max(0, Number(SEARCH.searxng.pageChars) || 0);
// where the day's searches are kept: each query's results, each page fetched
export const searchFolder = (evalDir, day) => path.join(evalDir, 'search', day);
// what the tool tests are started with (training/support/bfcl_search.py reads these)
export const searchEnv = (base, folder) => ({
  SWARM_SEARCH_URL: base,
  SWARM_SEARCH_CACHE: folder,
  SWARM_SEARCH_TRIES: String(SEARCH.searxng.tries || 3),
  SWARM_SEARCH_PAGE_CHARS: String(PAGE_CHARS),
});

const freePort = () =>
  new Promise((ok, no) => {
    const s = net.createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

// SearXNG, served on this machine for the length of a run: on a port of its own, listening on 127.0.0.1 only, with its JSON
// output turned on (it is off as SearXNG comes) and a secret made for this run. Its settings are written as JSON, which YAML reads.
export async function openSearch({ dir = SEARX_DIR, log = null } = {}) {
  if (!searxInstalled(dir)) throw new Error(SEARCH.searxng.name + ' is not installed here');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const settings = path.join(dir, 'settings.yml');
  const s = JSON.parse(JSON.stringify(SEARCH.searxng.settings));
  s.server = { ...(s.server || {}), secret_key: crypto.randomBytes(24).toString('hex') };
  fs.writeFileSync(settings, JSON.stringify(s, null, 2) + '\n');
  const out = log ? fs.openSync(log, 'a') : 'ignore';
  const child = spawn(path.join(dir, 'venv', 'bin', 'python'), ['-m', 'searx.webapp'], {
    cwd: path.join(dir, 'src'),
    env: {
      ...process.env,
      PYTHONPATH: path.join(dir, 'src'),
      SEARXNG_SETTINGS_PATH: settings,
      SEARXNG_PORT: String(port),
      SEARXNG_BIND_ADDRESS: '127.0.0.1',
    },
    stdio: ['ignore', out, out],
  });
  let gone = null;
  child.on('exit', (code) => (gone = code === null ? 'stopped' : 'exit ' + code));
  const stop = async () => {
    if (gone === null) child.kill('SIGTERM');
    for (let i = 0; i < 20 && gone === null; i++) await sleep(100);
    if (typeof out === 'number')
      try {
        fs.closeSync(out);
      } catch {
        /* closed */
      }
  };
  for (let i = 0; i < 120; i++) {
    if (gone !== null) throw new Error(SEARCH.searxng.name + ' would not start (' + gone + ')');
    try {
      if ((await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) })).ok) return { base, stop, port };
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  await stop();
  throw new Error(SEARCH.searxng.name + ' did not answer within a minute');
}

// WHAT A RESULT SAYS OF THE SEARCH BEHIND IT (docs/swoa.md 4.7, search): the service and its revision, the engines that answered the
// day's queries, and that each query's results and each page were kept and given to both models
export function searchRecord(env = process.env, folder = '') {
  if (searchOf(env) === 'serpapi') return { service: SEARCH.serpapi.name };
  const engines = new Set();
  let queries = 0;
  let pages = 0;
  const list = (d) => {
    try {
      return fs.readdirSync(d).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  };
  for (const f of list(path.join(folder, 'queries'))) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(folder, 'queries', f), 'utf8')).value;
      queries += 1;
      for (const r of v.results || []) for (const e of r.engines || []) if (e) engines.add(e);
    } catch {
      /* a file being written */
    }
  }
  pages = list(path.join(folder, 'pages')).length;
  return {
    service: SEARCH.searxng.name,
    revision: SEARCH.searxng.rev,
    where: 'served on the machine that measured, for the length of the run',
    engines: [...engines].sort(),
    kept: 'what each query returned and each page fetched, for the day: both models are given the same',
    ...(PAGE_CHARS ? { pageChars: PAGE_CHARS } : {}),
    queries,
    pages,
  };
}
// the same, in words, for the line that says what each model was offered
export const searchWords = (env = process.env) =>
  searchOf(env) === 'serpapi'
    ? SEARCH.serpapi.name
    : 'a ' + SEARCH.searxng.name + ' served for the run (no key), each query and page kept for the day';
