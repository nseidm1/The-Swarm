// reader-file.mjs - whether the reader of answers in words is to be believed this pass (training/readers.mjs writes it). Kept apart
// so that the trainers that ask can do so without loading the check itself (which loads them).
// There are two readings and each is checked by itself: 'open' (an answer in words: do the two say the same?) and 'talk' (a reply
// in a conversation: do the two do the same thing for the person?).
import fs from 'node:fs';
import path from 'node:path';

export const READER_FILE = (work) => path.join(work, 'reader.json');
const read = (work, type) => {
  const j = JSON.parse(fs.readFileSync(READER_FILE(work), 'utf8'));
  return type === 'talk' ? j.talk || {} : j;
};
// is the reader to be believed? (yes, where it has not been checked: a pass run by hand without the check)
export function readerOk(work, type = 'open') {
  try {
    return read(work, type).ok !== false;
  } catch {
    return true;
  }
}
// the mark above which the reader is taken to say yes, where its check found one (else one half)
export function readerMark(work, type = 'open') {
  try {
    const m = Number(read(work, type).mark);
    return Number.isFinite(m) ? m : 0.5;
  } catch {
    return 0.5;
  }
}
