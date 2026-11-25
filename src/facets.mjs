// facets.mjs - WHAT KIND OF REQUEST THIS ONE IS, WITHIN ITS CLASS, read by code. An arrangement belongs to a class of input
// (with tools, a conversation, asking for code, a plain question), and a class is wide: three conversation passes on one
// swarm kept nothing after the first, because what was still wrong sat in three kinds of turn and the one change that
// mended one of them (one model asked alone, on a turn asking for code: 9 of 10 where the arrangement had 0) lost 16.7
// points over the class and so could not be kept (measured 2026-11-24). A facet is such a kind, told from the conversation
// itself with no model asked, so that a change can be kept FOR IT ALONE (plan.for: { <facet>: { ...plan keys } }) and the
// rest of the class goes on as it did.
//   closing      the last message asks nothing: thanks, a word of agreement, a goodbye
//   code         the last message asks for code, or goes on from code earlier in the conversation
//   instructed   an earlier message of the person's says how they want to be answered, and this one is a later turn
// facetOf(messages) -> one of FACETS, or '' (most requests: nothing here applies, and nothing changes)
// planFor(plan, facet) -> the class's plan with what was kept for that facet laid over it
import { asksForCode } from './read.mjs';

export const FACETS = ['closing', 'code', 'instructed'];
export const FACET_NAMES = {
  closing: 'that ask nothing (thanks, a closing word)',
  code: 'asking for code',
  instructed: 'after the person has said how to answer',
};
const said = (m) =>
  typeof (m && m.content) === 'string'
    ? m.content
    : Array.isArray(m && m.content)
      ? m.content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join(' ')
      : '';
const words = (s) => (String(s).trim().match(/\S+/g) || []).length;
const THANKS =
  /\b(?:thanks|thank you|thank u|thx|cheers|much appreciated|appreciate it|that settles it|that'?s (?:all|it|great|perfect|everything)|got it|understood|sounds good|perfect|brilliant|lovely|great|ok(?:ay)?|good(?:bye)?|bye|see you)\b/i;
const ASKS =
  /\?|\b(?:can|could|would|will|what|how|why|when|where|who|which|whose|tell|give|show|make|write|calculate|work out|explain|list|find|convert|translate|now|next|also|and)\b/i;
// THE LAST MESSAGE ASKS NOTHING: short, a word of thanks or closing in it, no question, no figure, no word that asks
export function asksNothing(text) {
  const s = String(text || '').trim();
  if (!s || words(s) > 12 || /\d/.test(s)) return false;
  return THANKS.test(s) && !ASKS.test(s);
}
const INSTRUCTS =
  /\b(?:from now on|going forward|for the rest of (?:this|the|our) (?:chat|conversation)|always|never|only (?:the|a|in)|just (?:the|a)|bare (?:numbers?|figures?)|no (?:units?|currency|signs?|symbols?|emoji|explanations?|working)|in (?:one|a single) (?:word|line|sentence)|keep (?:it|replies|answers) )/i;
// AN EARLIER MESSAGE OF THE PERSON'S SAYS HOW TO ANSWER (and this is a later turn of theirs)
export function instructedBefore(messages) {
  const mine = (messages || []).filter((m) => m && m.role === 'user');
  return mine.length > 1 && mine.slice(0, -1).some((m) => INSTRUCTS.test(said(m)));
}
export function facetOf(messages) {
  const mine = (messages || []).filter((m) => m && m.role === 'user');
  if (!mine.length) return '';
  const last = said(mine[mine.length - 1]);
  // (a closing word is one only inside a conversation: said first, it is a message like any other)
  if (mine.length > 1 && asksNothing(last)) return 'closing';
  // (asking for code, or going on from code: an earlier turn asked for it or was answered with it, as in "now make one
  // that multiplies by 5 instead", which says nothing of code by itself)
  const before = (messages || []).slice(0, (messages || []).lastIndexOf(mine[mine.length - 1]));
  const hadCode = before.some((m) =>
    m.role === 'user' ? asksForCode(said(m)) : /```|\bfunction\b|\bdef\s+\w+\s*\(/.test(said(m)),
  );
  if (mine.length > 1 && (asksForCode(last) || hadCode)) return 'code';
  if (instructedBefore(messages)) return 'instructed';
  return '';
}
export function planFor(plan, facet) {
  const over = facet && plan && plan.for && plan.for[facet];
  return over && typeof over === 'object' ? { ...plan, ...over } : plan || {};
}
