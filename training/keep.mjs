// keep.mjs - WHETHER A CHANGE TO A CLASS'S ARRANGEMENT IS KEPT: one rule, for the stage that trains each class as a class
// (classes.mjs) and for the one that goes question by question (loop.mjs).
//
// The two stages each had their own, and they disagreed about the same change (measured 2026-11-21: settling by the answer most
// slots hold, on the class of plain questions, was rejected by the class stage on one draw of the held questions and would have
// been kept by the other on one train question made good). And one draw cannot judge a change: the same change measured +1.9
// points on one draw and +11.1 on another, where the arrangement against itself differed by 3.7. So:
//   - it is judged on the HELD questions of its class, which it was not chosen on, every one of them;
//   - each asked on TWO DRAWS (or more), with the change and as the swarm stands, the same draws for both;
//   - a question's gain is its mean score with the change less its mean score without, over the draws;
//   - it is kept where the held questions gained, the mean gain is more than twice its paired error and at least the least gain
//     the policy names, the questions it LOSES are outweighed by those it MAKES GOOD, and no kind of question falls by more
//     than the margin and more than its own error.
// LOST AND MADE GOOD (2026-11-22). A question is lost where it is right on every draw as the swarm stands and wrong on every
// draw with the change; made good, the other way about. One question lost used to refuse a change whatever it gained, and
// small models answer otherwise from draw to draw: of 97 changes that reached their class in one pass, 78 were refused for one
// question, among them one that made six good, lost two, and gained 5.2 points over 141 questions (error 2.0). A change is now
// refused for what it loses only where it does not make good at least twice as many (outweighed).
// THE GAIN IS JUDGED ON EVERY QUESTION THE CHANGE WAS NOT CHOSEN ON (`beside`, 2026-11-22). Thirty held questions on two draws
// have an error of two to four points, so only a change worth five to nine could pass. The loop finds a change on ONE train
// question; the other train questions of the class are as unseen by it as the held ones, and it hands them here. The bar is
// cleared by the held questions alone, as before, or by the held questions and those together; either way the held questions
// must have gained by themselves. (The class stage chooses on its whole train class, and hands none.)
// rows, beside: [{ id, kind, base: [score per draw], with: [score per draw] }], scores from 0 to 1. Pure: nothing is asked here.
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (x) => Math.round(x * 1000) / 1000;
// the mean of a list of gains and its error (the standard error of the mean; 0 where there is one, or none)
export function pooled(ds) {
  const n = ds.length;
  const m = mean(ds);
  const sd = n > 1 ? Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, gain: r3(m), error: r3(n ? sd / Math.sqrt(n) : 0) };
}
// what a change loses is outweighed where it makes good at least twice as many questions as it loses
export const outweighed = (lost, good) => good >= 2 * lost;
export function keepOf(rows, { least = 0, margin = 0.05, beside = [] } = {}) {
  const usable = rows.filter((r) => r.base.length && r.base.length === r.with.length);
  const gains = usable.map((r) => ({ ...r, d: mean(r.with) - mean(r.base) }));
  const all = pooled(gains.map((r) => r.d));
  const draws = usable.length ? Math.min(...usable.map((r) => r.base.length)) : 0;
  // (the other questions it was not chosen on: their gains beside the held ones)
  const also = beside
    .filter((r) => r.base.length && r.base.length === r.with.length)
    .map((r) => mean(r.with) - mean(r.base));
  const judged = also.length ? pooled([...gains.map((r) => r.d), ...also]) : all;
  // (lost: right every time as it stands, wrong every time with the change; made good, the other way; one draw is not "every time")
  const lost = gains
    .filter((r) => r.base.length > 1 && r.base.every((v) => v >= 1) && r.with.every((v) => v < 1))
    .map((r) => r.id);
  const good = gains
    .filter((r) => r.base.length > 1 && r.base.every((v) => v < 1) && r.with.every((v) => v >= 1))
    .map((r) => r.id);
  const fell = [...new Set(gains.map((r) => r.kind).filter(Boolean))]
    .map((kind) => ({ kind, ...pooled(gains.filter((r) => r.kind === kind).map((r) => r.d)) }))
    .filter((k) => k.gain < -margin && k.gain < -k.error)
    .map((k) => k.kind);
  const pct = (x) => (x * 100).toFixed(1);
  // (the bar: a mean gain more than twice its error and at least the least; cleared by the held questions alone, or by them
  // with the others the change was not chosen on. The others add what thirty questions cannot show; they never take away
  // what the held questions show by themselves)
  const clears = (g) => g.gain > 2 * g.error && g.gain >= least;
  const why =
    all.n < 2
      ? 'fewer than two held questions of its class could be scored'
      : draws < 2
        ? 'it was asked on one draw only, and one draw cannot judge a change'
        : !outweighed(lost.length, good.length)
          ? 'it lost ' +
            lost[0] +
            (lost.length > 1 ? ' and ' + (lost.length - 1) + ' more' : '') +
            ', right as the swarm stands and wrong with it, on every draw, and made ' +
            (good.length || 'none') +
            ' good: not twice as many'
          : fell.length
            ? 'its questions of the kind ' + fell[0] + ' fell'
            : !(all.gain > 0 && (clears(all) || clears(judged)))
              ? 'over ' +
                all.n +
                ' held questions and ' +
                draws +
                ' draws it gained ' +
                pct(all.gain) +
                ' points (error ' +
                pct(all.error) +
                ')' +
                (also.length
                  ? ', and over those with the ' +
                    also.length +
                    ' other questions it was not chosen on ' +
                    pct(judged.gain) +
                    ' points (error ' +
                    pct(judged.error) +
                    ')'
                  : '') +
                ': not more than twice its error and at least ' +
                pct(least)
              : '';
  return {
    keep: !why,
    why,
    n: all.n,
    draws,
    gain: all.gain,
    error: all.error,
    lost,
    good,
    fell,
    ...(also.length ? { judged } : {}),
  };
}
