// carry.mjs - A STAGE THAT WAS STOPPED CARRIES ON, AND DOES NOT BEGIN AGAIN. The class stage (classes.mjs) takes hours, and a
// Stop used to cost all of it: begun again, it asked every question as the swarm stood (a quarter of an hour for plain
// questions) and tried every change again (2026-11-26: half an hour of one class lost to a Stop and a Start).
// What it does is decided by what the models answered, and by nothing else. So every answer is written down as it comes
// (the swarm's to a question under an arrangement, a model's to a request to write code), and a stage begun again takes each
// from what was written until it reaches the one it was stopped on. It goes through the same steps in a moment and then
// goes on asking: the same record, the same things kept, nothing asked twice.
//   openCarry(file, same, start)   same: what the answers are answers OF (the programs, the lineup, the settings); a file
//                                  that says otherwise is another stage's and is begun again. start: what the stage began
//                                  from (the stored arrangement), kept so that carrying on begins from the same.
//   .resumed  .start  .size       whether this carries on, what it began from, how many answers it holds
//   .memo(key, fn)                 the answer under this key: written down, or fn()'s, written down
//   .note(key, value) .noted(key)  something to remember that is not an answer
//   .done()                        the stage finished: nothing is left to carry on
// Every line is written whole before the next begins; a last line cut short by a stop is passed over.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const keyOf = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

export function openCarry(file, same, start, { fresh = false } = {}) {
  const sameKey = keyOf(same);
  const held = new Map();
  let head = null;
  if (!fresh) {
    try {
      for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!ln.trim()) continue;
        let row;
        try {
          row = JSON.parse(ln);
        } catch {
          continue; // (a line cut short by the stop)
        }
        if (row.head) head = row.head;
        else if (row.k) held.set(row.k, row.v);
      }
    } catch {
      head = null;
    }
  }
  const resumed = !!(head && head.same === sameKey);
  if (!resumed) {
    held.clear();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        head: { same: sameKey, at: new Date().toISOString(), start: start === undefined ? null : start },
      }) + '\n',
    );
  }
  const put = (k, v) => {
    held.set(k, v);
    fs.appendFileSync(file, JSON.stringify({ k, v }) + '\n');
  };
  let taken = 0;
  return {
    resumed,
    start: resumed ? head.start : start,
    at: resumed ? head.at : null,
    size: held.size,
    get taken() {
      return taken;
    },
    has: (k) => held.has(k),
    async memo(k, fn) {
      if (held.has(k)) {
        taken++;
        return held.get(k);
      }
      const v = await fn();
      // (only what can be read back as it was: an answer that cannot is asked again next time)
      if (v !== undefined) put(k, v);
      return v;
    },
    note: (k, v) => put('note|' + k, v),
    noted: (k) => held.get('note|' + k),
    done() {
      try {
        fs.unlinkSync(file);
      } catch {
        /* nothing to remove */
      }
    },
  };
}
