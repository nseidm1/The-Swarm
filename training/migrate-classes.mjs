// migrate-classes.mjs - MOVE WHAT EACH SWARM HAS LEARNED TO THE CLASS IT WAS LEARNED ON (docs/swoa-classes.md, migration;
// src/learned.mjs toClasses). Once for each learned file; a file already moved is left as it is. The file as it was is kept as
// its .bak, as every write of a learned file keeps it.
//   node training/migrate-classes.mjs            say what would move, for every learned file; nothing is written
//   node training/migrate-classes.mjs --apply    move them
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasks } from './tasks.mjs';
import { classOf } from '../src/orchestrate.mjs';
import { withPlaces } from '../src/index.mjs';
import { LEARNED_DIR, toClasses, scopeShared, writeLearned } from '../src/learned.mjs';
import { PLACES } from '../src/catalog.mjs';

const BRIEFS_FILE = fileURLToPath(new URL('../src/briefs.json', import.meta.url));

// THE CLASS OF EACH SPEC KIND: its questions made as training makes them, and sorted as the running swarm sorts a request. A kind
// whose questions fall in more than one class is put in the one most of them fall in.
export function classOfKinds({ each = 3, seed = 1 } = {}) {
  const by = {};
  for (const t of tasks({ split: 'train', each, seed })) {
    const c = classOf(t.turns || [{ role: 'user', content: t.ask }], { tools: t.tools });
    by[t.kind] = by[t.kind] || {};
    by[t.kind][c] = (by[t.kind][c] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(by).map(([k, n]) => [k, Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b))[0]]),
  );
}

// the starting arrangement for the places a configuration fills: its id is its members in place order, then its decider
export function startFor(config, base = JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8'))) {
  const members = String(config || '').split('+').length - 1;
  return withPlaces(base, PLACES.slice(0, Math.max(members, 0)));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const apply = process.argv.includes('--apply');
  const classOfKind = classOfKinds();
  console.log(
    'classes of the spec kinds: ' +
      Object.entries(classOfKind)
        .map(([k, c]) => k + '=' + c)
        .join(' '),
  );
  const files = fs.existsSync(LEARNED_DIR) ? fs.readdirSync(LEARNED_DIR).filter((f) => f.endsWith('.json')) : [];
  for (const f of files) {
    let learned;
    try {
      learned = JSON.parse(fs.readFileSync(path.join(LEARNED_DIR, f), 'utf8'));
    } catch {
      console.log(f + ': not readable, left as it is');
      continue;
    }
    const r = toClasses(learned, { classOfKind, start: startFor(learned.config) });
    if (r.already) {
      // moved before: what a trainer kept in the shared arrangement since (before changes were scoped by class) goes to its class
      const sc = scopeShared(learned, { classOfKind, start: startFor(learned.config) });
      if (!sc.moved) {
        console.log(
          f +
            ': moved before (' +
            learned.migrated.at +
            '), nothing kept in the shared arrangement since: left as it is',
        );
        continue;
      }
      console.log(
        f +
          ': ' +
          (apply ? 'moved' : 'would move') +
          ' what was kept in the shared arrangement since (change ' +
          sc.entries.join(', ') +
          ') to kinds.' +
          sc.moved,
      );
      if (apply) writeLearned(sc.learned, { config: learned.config, target: learned.target });
      continue;
    }
    if (!r.moved) {
      console.log(f + ': nothing kept, nothing to move');
      continue;
    }
    const counts = {};
    for (const e of r.learned.ledger) counts[e.class || '?'] = (counts[e.class || '?'] || 0) + 1;
    console.log(
      f +
        ': ' +
        (apply ? 'moved' : 'would move') +
        ' to kinds.' +
        r.moved +
        ' (kept changes by class: ' +
        Object.entries(counts)
          .map(([c, n]) => c + ' ' + n)
          .join(', ') +
        ')' +
        (r.dropped.length ? '; not carried: change ' + r.dropped.join(', ') + ' (found on another class)' : ''),
    );
    if (apply) writeLearned(r.learned, { config: learned.config, target: learned.target });
  }
  if (!apply && files.length) console.log('nothing written: run with --apply to move them');
}
