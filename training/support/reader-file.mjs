// reader-file.mjs - whether the reader of answers in words is to be believed this pass (training/readers.mjs writes it). Kept apart
// so that the trainers that ask can do so without loading the check itself (which loads them).
import fs from 'node:fs';
import path from 'node:path';

export const READER_FILE = (work) => path.join(work, 'reader.json');
// is the reader of answers in words to be believed? (yes, where it has not been checked: a pass run by hand without the check)
export function readerOk(work) {
  try {
    return JSON.parse(fs.readFileSync(READER_FILE(work), 'utf8')).ok !== false;
  } catch {
    return true;
  }
}
// the mark above which the reader is taken to say yes, where its check found one (else one half)
export function readerMark(work) {
  try {
    const m = Number(JSON.parse(fs.readFileSync(READER_FILE(work), 'utf8')).mark);
    return Number.isFinite(m) ? m : 0.5;
  } catch {
    return 0.5;
  }
}
