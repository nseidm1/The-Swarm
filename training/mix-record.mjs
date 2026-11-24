// mix-record.mjs - THE RECORD OF A MODEL'S MIXTURE (<adapters>/<model>/mix.json): which adapters there are, each for a slot.
// Written by training/mixture.mjs, which makes them; read by it, by adapters.mjs (what a module is loaded with) and by the
// class stage (which adapters there are to try). Apart from both, since each of those two runs the other.
import fs from 'node:fs';
import path from 'node:path';

// the record's adapters, the newest of each slot: { adapters: { name: { slot, gguf, at } } } -> [{ name, slot, gguf }]
export function newestBySlot(record, exists = fs.existsSync) {
  const by = new Map();
  for (const [name, a] of Object.entries((record && record.adapters) || {})) {
    if (!a || !a.slot || !a.gguf || !exists(a.gguf)) continue;
    const had = by.get(a.slot);
    if (!had || String(a.at || '') > String(had.at || ''))
      by.set(a.slot, { name, slot: a.slot, gguf: a.gguf, at: a.at });
  }
  return [...by.values()].map(({ name, slot, gguf }) => ({ name, slot, gguf }));
}
// what a member is loaded with for its mixture: { name: file }, of the adapters its record has
export const mixFilesOf = (record, exists = fs.existsSync) =>
  Object.fromEntries(newestBySlot(record, exists).map((a) => [a.name, a.gguf]));
// the record of a model's mixture, or an empty one
export function readMix(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'mix.json'), 'utf8'));
  } catch {
    return { adapters: {} };
  }
}
