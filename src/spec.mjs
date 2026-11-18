// spec.mjs - A SWARM FROM ITS SwOA SPEC (docs/swoa.md). The SwOA spec (the dashboard's SwOA spec; ui/data.py spec) holds everything a swarm is made
// from: `recipe` = { members, decider, engine, serving, briefs }, every file pinned and every slot with what it is told. This reads one
// back, so that a program can make the swarm it describes, anywhere, with no record of its training:
//   readSpec(json | path)   -> the spec, checked: its format and version known, its recipe there, its hash the recipe's own
//   fromSpec(spec, { adaptersDir, anyAdapters })
//                           -> { members, briefs, slots, contextPerSlot, decider, loras } for createSwarm. Where the recipe pins
//                              adapters (version 3), each is looked for in adaptersDir (by default beside a spec read from a file:
//                              <name>.adapters/) and refused unless its SHA-256 is the pinned one: an adapter trained again
//                              differs, and makes another swarm (anyAdapters: true takes it all the same, and says so)
//   recipeSha256(recipe)    -> the hash, in the form ui/data.py writes it: keys sorted, no spaces, text as itself, 1.0 written 1
// A spec whose hash does not match its recipe is refused: it has been changed since it was written, and is no longer the swarm it
// says it is (its record of parity was measured on another).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// THE SwOA SPEC (docs/swoa.md): SwOA, Swarm Orchestration Adaptation, is to a swarm module what LoRA is to a model. Its header is
// `swoa` (format "swoa", version 1); the output spec it replaces (header `spec`, format "the-swarm/spec", versions 2 and 3) is still read
export const SWOA_FORMAT = 'swoa';
export const SWOA_VERSIONS = [1];
export const SPEC_FORMAT = 'the-swarm/spec';
export const SPEC_VERSIONS = [2, 3];
// the base module a SwOA is applied to, as it is hashed: the small models, the decider and the engine
export const baseModuleOf = (recipe) => ({ members: recipe.members, decider: recipe.decider, engine: recipe.engine });
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
  const swoa = !!(spec && spec.swoa && spec.swoa.format === SWOA_FORMAT);
  const head = (spec && (swoa ? spec.swoa : spec.spec)) || {};
  if (!swoa && head.format !== SPEC_FORMAT)
    throw new Error('not a SwOA spec (its format is ' + JSON.stringify(head.format) + ')');
  const versions = swoa ? SWOA_VERSIONS : SPEC_VERSIONS;
  if (!versions.includes(head.version))
    throw new Error(
      (swoa ? 'a SwOA spec' : 'an output spec') +
        ' of version ' +
        head.version +
        ', which this module does not read (it reads ' +
        versions.join(', ') +
        ')',
    );
  const r = spec.recipe;
  if (!r || !r.members || !r.briefs || !Array.isArray(r.briefs.slots) || Object.keys(r.members).length < 2)
    throw new Error('the spec holds no recipe: two small models at least, and the arrangement');
  for (const [k, m] of Object.entries(r.members))
    if (!m || !m.file || !m.sha256)
      throw new Error('the small model in place ' + k + ' is not pinned (a file and its SHA-256)');
  for (const [k, a] of Object.entries(r.adapters || {}))
    if (!r.members[k] || !a || !a.file || !a.sha256)
      throw new Error(
        'the adapter in place ' + k + ' is not pinned to a small model of the recipe (a file and its SHA-256)',
      );
  const got = recipeSha256(r);
  if (head.recipeSha256 && got !== head.recipeSha256)
    throw new Error(
      'the recipe does not match its hash: it was changed after the spec was written (' +
        got.slice(0, 12) +
        ' against ' +
        String(head.recipeSha256).slice(0, 12) +
        ')',
    );
  // a SwOA also names the base module it applies to: one changed since it was written is another module, whose proof was not measured
  if (swoa && head.baseModuleSha256 && recipeSha256(baseModuleOf(r)) !== head.baseModuleSha256)
    throw new Error('the base module does not match its hash: the SwOA was changed after it was written');
  return spec;
}

const sha256Of = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function fromSpec(spec, { adaptersDir, anyAdapters = false } = {}) {
  const r = readSpec(spec).recipe;
  // THE ADAPTERS IT IS SERVED WITH: each found, and checked against its pin
  const dir = adaptersDir || (typeof spec === 'string' ? spec.replace(/\.json$/, '') + '.adapters' : '');
  const loras = {};
  for (const [k, a] of Object.entries(r.adapters || {})) {
    const file = dir ? path.join(dir, a.file) : '';
    if (!file || !fs.existsSync(file))
      throw new Error(
        'the spec serves place ' +
          k +
          ' with the adapter ' +
          a.file +
          ', and it is not ' +
          (dir ? 'in ' + dir : 'given') +
          ': name the folder that holds it (adaptersDir, or --adapters)',
      );
    const got = sha256Of(file);
    if (got !== a.sha256 && !anyAdapters)
      throw new Error(
        'the adapter ' +
          a.file +
          ' is not the one the spec pins (SHA-256 ' +
          got.slice(0, 12) +
          ' against ' +
          a.sha256.slice(0, 12) +
          '): one trained again makes another swarm, whose equivalence has not been measured',
      );
    loras[k] = file;
  }
  return {
    members: r.members,
    briefs: r.briefs,
    slots: (r.serving && r.serving.slots) || undefined,
    contextPerSlot: (r.serving && r.serving.contextPerSlot) || undefined,
    decider: r.decider || null,
    tools: (r.serving && r.serving.tools) || 'lead',
    loras,
  };
}
