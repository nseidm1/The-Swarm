// like.mjs - HOW LIKE A REQUEST IS TO THE REQUESTS AN ADAPTER WAS TAUGHT ON, by code. An adapter is proven on requests of some
// sort and harms others (measured 2026-11-23 and 24: taught JavaScript, it took Python from 21 to 11 of 48; kept by training
// on its own held questions, it took two Python benchmarks from 95 to 75 of 200). So whether a slot is served with its adapter
// is decided for each request: with it where the request is like what the adapter was taught, and as the model is where it
// is not. A request unlike anything taught is then answered exactly as the module without adapters answers it.
// The measure is plain and has no model in it: the words of a request, each weighed by how rare it is among the taught
// requests, and the likeness is the cosine to the nearest taught request (1: the same words; 0: none shared).
//   signatureOf(texts)   -> { n, idf: { term: weight }, docs: [{ term: weight }] }   of the taught requests
//   likeTo(sig, text)    -> 0..1, the nearest taught request
//   gated(rows, base, like, least) -> for each row, the answer with the adapter where like >= least, else the base answer
const STOP = new Set(
  'the a an of to in on at for and or is are was were be it its this that these those with as by from into than then your you i we they he she not no do does did have has had will would can could should may might must what which who how when where why if else all any each some one two there here out up so'.split(
    ' ',
  ),
);
export const termsOf = (text) =>
  (
    String(text || '')
      .toLowerCase()
      .match(/[a-z_][a-z0-9_]{2,}|\d+/g) || []
  )
    .map((w) => (/^\d+$/.test(w) ? '#' : w))
    .filter((w) => !STOP.has(w));
const counted = (terms) => {
  const m = {};
  for (const t of terms) m[t] = (m[t] || 0) + 1;
  return m;
};
const norm = (v) => Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0)) || 1;
export function signatureOf(texts) {
  const bags = texts.map((t) => counted(termsOf(t)));
  const df = {};
  for (const b of bags) for (const t of Object.keys(b)) df[t] = (df[t] || 0) + 1;
  const n = bags.length;
  const idf = Object.fromEntries(Object.entries(df).map(([t, d]) => [t, Math.log(1 + n / d)]));
  // (a taught request as weights of unit length: its terms' counts, damped, times how rare each is)
  const docs = bags.map((b) => {
    const v = Object.fromEntries(Object.entries(b).map(([t, c]) => [t, (1 + Math.log(c)) * idf[t]]));
    const k = norm(v);
    return Object.fromEntries(Object.entries(v).map(([t, x]) => [t, Math.round((x / k) * 1000) / 1000]));
  });
  return { n, idf, docs };
}
export function likeTo(sig, text) {
  if (!sig || !sig.docs || !sig.docs.length) return 0;
  const b = counted(termsOf(text));
  // (a word no taught request holds is as rare as a word can be: it counts against the likeness, at the highest weight)
  const top = Math.log(1 + sig.n);
  const v = Object.fromEntries(Object.entries(b).map(([t, c]) => [t, (1 + Math.log(c)) * (sig.idf[t] ?? top)]));
  const k = norm(v);
  let best = 0;
  for (const d of sig.docs) {
    let dot = 0;
    for (const [t, x] of Object.entries(v)) if (d[t]) dot += x * d[t];
    if (dot / k > best) best = dot / k;
  }
  return Math.round(best * 1000) / 1000;
}
// the answers of a module that carries the adapter only where the request is like what it was taught:
// rows: [{ counted }] with the adapter; base: [{ counted }] without; like: [0..1]; least: the likeness it takes
export const gated = (rows, base, like, least) => rows.map((r, i) => (like[i] >= least ? r : base[i]));
