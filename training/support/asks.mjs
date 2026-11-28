// asks.mjs - WHAT ASKS THE MODELS OF AN EVALUATION, AS ONE FINGERPRINT, AND THE NAME THEIR KEPT ANSWERS GO BY.
// The larger model's answers, and each small model's, are kept and not asked again. They stay good only while they would be
// asked the same way: the relay between the harness and a model, the harness's own arguments, how a tools test is run, the
// search behind the web search test. That was a version number bumped by hand, from memory: a change that was not bumped
// reused answers asked another way, silently, and whether to bump it was a person's opinion, which a benchmark that is to be
// believed cannot rest on. So the kept answers are named by the code that asks, itself: this reads it (the parts of
// evaluate.mjs marked ASKS:BEGIN to ASKS:END, and the programs a tools test and its search are run by), and its fingerprint
// is part of every kept folder's name. Change how a model is asked and every model is asked again, with nothing to decide.
// Not the whole of evaluate.mjs: most of that file reports what was measured, and a change to a table asks nothing anew.
// A line that is only a comment, or empty, is not read: saying more about the code is not another way of asking.
// KEPT_AS: the fingerprints whose answers were kept under the old numbered name, so that they are still found.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KEPT_AS = { '475a38f73b4b': '-r2' };
export const regionsOf = (text) =>
  [...String(text).matchAll(/\/\/ ASKS:BEGIN[^\n]*\n([\s\S]*?)\/\/ ASKS:END/g)].map((m) => m[1]);
// the code alone: no line that is only a comment (// in a program, # in a script), no empty line, nothing after a line's end
export const codeOf = (text, mark = '//') =>
  String(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !l.trim().startsWith(mark))
    .join('\n');
export function askingParts(root = ROOT) {
  const parts = {};
  regionsOf(fs.readFileSync(path.join(root, 'training', 'evaluate.mjs'), 'utf8')).forEach(
    (r, i) => (parts['training/evaluate.mjs#' + (i + 1)] = codeOf(r)),
  );
  const sup = path.join(root, 'training', 'support');
  for (const f of fs
    .readdirSync(sup)
    .filter((f) => /^(bfcl|search)\.mjs$|^bfcl.*\.py$/.test(f))
    .sort())
    parts['training/support/' + f] = codeOf(fs.readFileSync(path.join(sup, f), 'utf8'), f.endsWith('.py') ? '#' : '//');
  const pin = path.join(root, 'training', 'search.json');
  if (fs.existsSync(pin)) parts['training/search.json'] = fs.readFileSync(pin, 'utf8');
  return parts;
}
export const askingSha = (root = ROOT) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(askingParts(root)))
    .digest('hex')
    .slice(0, 12);
// the part of a kept folder's name that says how its answers were asked
export const askedPart = (sha = askingSha()) => KEPT_AS[sha] || '-a' + sha;
