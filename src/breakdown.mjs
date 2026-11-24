// breakdown.mjs - A QUESTION TAKEN APART BY CODE, with no model asked (SwOA specification O.6.1b, O.6.1c). Two things are built
// on it, and training tries each as it tries any change: the question put to the drafters in numbered lines (plan.prepare
// 'lines'), and a drafting slot that works the question one stated thing at a time while code carries what was worked out
// (a slot with byFacts: true).
//   statedOf(question) -> { states, asks, options, tells }   the sentences that state, those that ask, lines of options, and
//                                                           sentences that say how to answer
//   linesOf(question) -> the numbered lines, the asking last; '' where fewer than three things are stated
const OPTION = /^\(?[A-Z]\)[ .]/;
export function statedOf(question) {
  const rows = String(question || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const options = rows.filter((l) => OPTION.test(l));
  const sentences = rows
    .filter((l) => !OPTION.test(l) && !/^options?:?$/i.test(l))
    .flatMap((l) => l.split(/(?<=[.?!])\s+(?=[A-Z"'(])/))
    .map((x) => x.trim())
    .filter(Boolean);
  const asks = sentences.filter((x) => /\?$/.test(x));
  const tells = sentences.filter((x) => !/\?$/.test(x) && /^(answer|reply|respond|give)\b/i.test(x));
  const states = sentences.filter((x) => !/\?$/.test(x) && !/:$/.test(x) && !tells.includes(x));
  return { states, asks, options, tells };
}
// (how few stated things leave a question as it came: there is nothing to take apart)
export const LEAST_STATED = 3;
const numbered = (xs) => xs.map((x, i) => `${i + 1}. ${x}`).join('\n');
export function linesOf(question) {
  const P = statedOf(question);
  if (P.states.length < LEAST_STATED) return '';
  return [numbered(P.states), ...(P.asks.length ? ['Asked: ' + P.asks.join(' ')] : [])].join('\n').slice(0, 2400);
}
// what stands over the numbered lines where a drafter is sent them under the question
export const LINES_HEAD = 'The same question, one thing it states to a line. Use every line:';
// WHAT A SLOT THAT WORKS BY FACTS IS TOLD AT EACH STATED THING, in place of its own brief, and what it is shown
export const FACT_BRIEF =
  'You are working through a problem one fact at a time. You are shown the facts so far, what has been worked out so far, and the question the facts are for. Write ONE short line: the most useful new thing that follows from the newest fact together with the others. If nothing new follows, write: nothing new. Do not answer the question.';
export const factAsk = (P, i, found) =>
  `Question the facts are for: ${P.asks.join(' ')}\n\nFacts so far:\n${numbered(P.states.slice(0, i + 1))}\n\nWorked out so far:\n${found.length ? found.map((x) => '- ' + x).join('\n') : '(nothing yet)'}\n\nNewest fact: ${P.states[i]}`;
// one line of what a step gave, or '' where it gave nothing new
export const factLine = (text) => {
  const one = String(text || '')
    .trim()
    .split('\n')[0]
    .slice(0, 240)
    .trim();
  return !one || /nothing new/i.test(one) ? '' : one;
};
// what stands over what was worked out, where the slot is then asked the question itself
export const FOUND_HEAD =
  'Worked out from what the question states, one fact at a time (check each against the question):';
// (the most stated things a slot is taken through: a longer question is drafted as it came)
export const MOST_FACTS = 12;
