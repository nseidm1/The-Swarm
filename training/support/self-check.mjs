// self-check.mjs - THE LARGER MODEL AGAINST ITSELF, READ AGAIN WHERE IT WAS NOT READ. The larger model is asked every train question a
// second time (baseline.mjs --who target --self), and its second answer is graded against its first by the same readers as the
// swarm's. A question on which it was not equivalent to itself has a mark that is partly a draw (training/loop.mjs sets it aside
// where the swarm is not at parity with it as it stands). But a self-check run while no reader of answers in words was believed
// compares none of those questions, and its record then names none of them: measured 2026-11-18, one configuration's record held
// "compared 42, not compared 42" and 8 such questions, where the same answers read by a working reader gave 28.
// The second answers are on record (baseline-runs.jsonl), so nothing is asked again: the ones not compared are read now, and the
// record is counted again from every question's newest row.
//   latestSelfRows(runsFile, { label, split, seed }) -> Map(id -> the newest row with a reply)
//   regradeSelf({ file, runsFile, label, list, ref, grade, count }) -> { regraded, disagreed } | null (nothing to read, nothing changed)
import fs from 'node:fs';

export function latestSelfRows(runsFile, { label, split = 'train', seed }) {
  const out = new Map();
  let text = '';
  try {
    text = fs.readFileSync(runsFile, 'utf8');
  } catch {
    return out;
  }
  for (const l of text.split('\n')) {
    if (!l || !l.includes(label)) continue;
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue; // a line half written
    }
    if (r.label !== label || r.split !== split || r.seed !== seed || !String(r.reply || '').trim()) continue;
    out.set(r.id, r);
  }
  return out;
}

// grade(t, first, second) -> { grade: 'right' | 'wrong' | 'unsure' | 'noref', ... }: 'noref' where it still cannot be read
// count(rows) -> the counts a record keeps (support/bench.mjs count)
export async function regradeSelf({ file, runsFile, label, list, ref, grade, count, append = true }) {
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // the larger model was never asked again here: nothing on record to read
  }
  const seed = (list[0] || {}).seed;
  if (rec.seed !== seed) return null;
  const rows = latestSelfRows(runsFile, { label, split: rec.split || 'train', seed });
  const read = [];
  for (const t of list) {
    const r = rows.get(t.id);
    if (!r || r.grade !== 'noref') continue;
    const first = (ref && (ref.get ? ref.get(t.id) : ref[t.id])) || r.refReply;
    let g = null;
    try {
      g = await grade(t, first, r.reply);
    } catch {
      g = null;
    }
    if (!g || g.grade === 'noref') continue;
    const { why: _w, ...was } = r;
    read.push({ ...was, grade: g.grade, ...(g.undecided ? { undecided: true } : {}), regraded: true });
  }
  if (!read.length && !(rec.noref > 0)) return null;
  for (const r of read) rows.set(r.id, r);
  const all = list.map((t) => rows.get(t.id)).filter(Boolean);
  const disagreed = all.filter((r) => r.grade === 'wrong' || r.grade === 'unsure').map((r) => r.id);
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const counts = count(all);
  if (!read.length && same(disagreed, rec.disagreed || []) && counts.noref === rec.noref) return null;
  fs.writeFileSync(
    file,
    JSON.stringify(
      { ...rec, ...counts, disagreed, regraded: { at: new Date().toISOString(), read: read.length } },
      null,
      2,
    ) + '\n',
  );
  if (append && read.length) fs.appendFileSync(runsFile, read.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { regraded: read.length, disagreed };
}
