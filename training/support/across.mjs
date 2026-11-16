// across.mjs - WHAT OTHER CONFIGURATIONS LEARNED, FOR THIS ONE'S PLAN. Each configuration keeps its own record (what it learned, what it
// tried), because what is true of two small models and one decider against one larger model need not be true of others. But a change
// kept elsewhere is evidence: the same slot told the same thing, the same step put in the same place, did better there. So a plan
// does not adopt what another configuration kept; it MEASURES it here first, ahead of what it would otherwise try:
//   transferred(key, briefs)   the changes other configurations kept (src/learned/*.json ledgers), as moves this configuration can
//                              measure: an arrangement or flow kept elsewhere whose name is a step from here, and a brief kept
//                              elsewhere for a slot of the same name (its words, from that configuration's briefs as they stand)
// Kept only on evidence here, by the same rule as any other move.
import fs from 'node:fs';
import path from 'node:path';
import { LEARNED_DIR } from '../../src/learned.mjs';

export function otherLearned(key) {
  let files = [];
  try {
    files = fs.readdirSync(LEARNED_DIR).filter((f) => f.endsWith('.json') && f !== key + '.json');
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(LEARNED_DIR, f), 'utf8'));
      if (Array.isArray(j.ledger) && j.ledger.length) out.push({ key: f.replace(/\.json$/, ''), ...j });
    } catch {
      /* one that will not read is passed over */
    }
  }
  return out;
}
// -> { arrangements: Map(name -> [{ config, gain }]), briefs: [{ slot, brief, name, config, gain }] }
export function transferred(key, briefs) {
  const arrangements = new Map();
  const outBriefs = [];
  const mine = new Map((briefs.slots || []).map((s) => [s.id, s]));
  for (const o of otherLearned(key)) {
    for (const x of o.ledger) {
      const gain = ((x.train || {}).wins || 0) - ((x.train || {}).losses || 0);
      if (x.kind === 'arrangement' || x.kind === 'plan') {
        const name = String(x.what || '');
        if (!arrangements.has(name)) arrangements.set(name, []);
        arrangements.get(name).push({ config: o.key, gain });
      } else if (x.kind === 'flow') {
        const name = 'flow: ' + String(x.what || '');
        if (!arrangements.has(name)) arrangements.set(name, []);
        arrangements.get(name).push({ config: o.key, gain });
      } else if (x.kind === 'brief' && x.slot && mine.has(x.slot)) {
        const theirs = ((o.briefs || {}).slots || []).find((s) => s.id === x.slot);
        if (
          theirs &&
          theirs.brief &&
          theirs.brief !== mine.get(x.slot).brief &&
          !outBriefs.some((b) => b.brief === theirs.brief)
        )
          outBriefs.push({
            slot: x.slot,
            brief: theirs.brief,
            name: 'kept in ' + o.key + ': ' + String(x.what || 'a brief'),
            config: o.key,
            gain,
          });
      }
    }
  }
  return { arrangements, briefs: outBriefs };
}
