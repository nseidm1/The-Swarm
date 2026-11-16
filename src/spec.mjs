// spec.mjs - A SWARM FROM ITS SPEC. The output spec (the dashboard's Output spec; ui/data.py spec) holds everything a swarm is made
// from: `recipe` = { members, decider, engine, serving, briefs }, every file pinned and every slot with what it is told. This reads one
// back, so that a program can make the swarm it describes, anywhere, with no record of its training:
//   readSpec(json | path)   -> the spec, checked: its format and version known, its recipe there, its hash the recipe's own
//   fromSpec(spec)          -> { members, briefs, slots, contextPerSlot, decider } for createSwarm
//   recipeSha256(recipe)    -> the hash, in the form ui/data.py writes it: keys sorted, no spaces, text as itself, 1.0 written 1
// A spec whose hash does not match its recipe is refused: it has been changed since it was written, and is no longer the swarm it
// says it is (its record of parity was measured on another).
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const SPEC_FORMAT = 'the-swarm/spec';
export const SPEC_VERSIONS = [2];
const canon = (x) =>
  Array.isArray(x)
    ? '[' + x.map(canon).join(',') + ']'
    : x && typeof x === 'object'
      ? '{' +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canon(x[k]))
          .join(',') +
        '}'
      : JSON.stringify(x);
export const recipeSha256 = (recipe) => createHash('sha256').update(canon(recipe), 'utf8').digest('hex');

export function readSpec(from) {
  const spec = typeof from === 'string' ? JSON.parse(fs.readFileSync(from, 'utf8')) : from;
  const head = (spec && spec.spec) || {};
  if (head.format !== SPEC_FORMAT)
    throw new Error('not a swarm spec (its format is ' + JSON.stringify(head.format) + ')');
  if (!SPEC_VERSIONS.includes(head.version))
    throw new Error(
      'a swarm spec of version ' +
        head.version +
        ', which this module does not read (it reads ' +
        SPEC_VERSIONS.join(', ') +
        ')',
    );
  const r = spec.recipe;
  if (!r || !r.members || !r.briefs || !Array.isArray(r.briefs.slots) || Object.keys(r.members).length < 2)
    throw new Error('the spec holds no recipe: two small models at least, and the arrangement');
  for (const [k, m] of Object.entries(r.members))
    if (!m || !m.file || !m.sha256)
      throw new Error('the small model in place ' + k + ' is not pinned (a file and its SHA-256)');
  const got = recipeSha256(r);
  if (head.recipeSha256 && got !== head.recipeSha256)
    throw new Error(
      'the recipe does not match its hash: it was changed after the spec was written (' +
        got.slice(0, 12) +
        ' against ' +
        String(head.recipeSha256).slice(0, 12) +
        ')',
    );
  return spec;
}

export function fromSpec(spec) {
  const r = readSpec(spec).recipe;
  return {
    members: r.members,
    briefs: r.briefs,
    slots: (r.serving && r.serving.slots) || undefined,
    contextPerSlot: (r.serving && r.serving.contextPerSlot) || undefined,
    decider: r.decider || null,
  };
}
