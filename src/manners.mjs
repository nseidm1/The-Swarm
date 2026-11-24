// manners.mjs - HOW A REPLY IN A CONVERSATION IS TIDIED, BY CODE (SwOA specification O.8.9). What a small model lets go of first
// in a conversation is the shape of its reply: it opens by praising the question, closes by offering more help, says a sentence
// again, greets a second time. Each of these is put right by code, with no model asked, where the plan turns that fix on
// (plan.manners: the ids of the fixes); none is on as a module starts, and training turns one on only where held conversations
// gain. A reply that is code is never touched, and a fix that would leave nothing leaves the reply as it was.
// (After The Crew, where each was first found by reading replies: "a lesson goes as high as it honestly can", the app before
// a line in a prompt.)
//   tidy(reply, fixes, { messages }) -> the reply with those fixes made
export const MANNER_FIXES = ['praise', 'offer', 'echo', 'greet'];
export const MANNER_NAMES = {
  praise: 'an opening that only praises the question is taken off',
  offer: 'a closing that only offers more help is taken off',
  echo: 'a sentence said again word for word is said once',
  greet: 'a greeting already given is not given again',
};
// the fixes a plan turns on: an array of ids, those that are fixes, in the order above
export const mannersOn = (v) => (Array.isArray(v) ? MANNER_FIXES.filter((f) => v.includes(f)) : []);

// sentences, each with the white space that followed it, so that what is kept is as it was written
export const sentencesOf = (text) =>
  String(text || '')
    .match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)\s*/g)
    ?.filter((s) => s.trim()) || [];
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export const PRAISE =
  /^\s*(?:(?:that(?:'s| is)|what)\s+an?\s+)?(?:great|good|excellent|fantastic|wonderful|interesting|awesome|nice|lovely)\s+(?:question|point|idea|choice|thought)\b[^.!?\n]*[.!?]+\s*|^\s*(?:certainly|absolutely|of course|sure thing|sure|definitely)\s*[!.]+\s*/i;
export const OFFER =
  /^(?:please\s+)?(?:let me know|feel free to|don'?t hesitate to|do not hesitate to|i hope (?:this|that) helps|hope (?:this|that) helps|is there anything else|if you (?:have|need|want|would like)\b[^.!?]*\b(?:let me know|just ask|feel free|i(?:'m| am) (?:here|happy)|reach out)|i(?:'m| am) (?:here|happy) (?:to help|if you)|happy to help|just ask|reach out (?:if|any ?time))\b[^.!?\n]*[.!?]*$/i;
export const GREETING =
  /^\s*(?:hello|hi|hey|good (?:morning|afternoon|evening)|greetings)(?:\s+(?:again|there))?\b[^.!?\n]{0,24}[.!,]+\s*/i;
const isCode = (reply) => /```|^\s*(?:def |function |class |import |const |let |#include)/m.test(String(reply || ''));

export function tidy(reply, fixes, { messages = [] } = {}) {
  const on = mannersOn(fixes);
  const was = String(reply || '');
  if (!on.length || !was.trim() || isCode(was)) return was;
  let out = was;
  const keep = (next) => {
    if (String(next || '').trim()) out = next;
  };
  if (on.includes('praise')) keep(out.replace(PRAISE, ''));
  if (on.includes('greet')) {
    const earlier = (messages || []).filter((m) => m && m.role === 'assistant').map((m) => String(m.content || ''));
    if (earlier.some((t) => GREETING.test(t))) keep(out.replace(GREETING, ''));
  }
  if (on.includes('echo')) {
    const seen = new Set();
    keep(
      sentencesOf(out)
        .filter((s) => {
          const k = norm(s);
          // (a few words said twice are not a sentence said again: "Yes." and "Yes." are)
          if (k.split(' ').length < 4) return true;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .join(''),
    );
  }
  if (on.includes('offer')) {
    const ss = sentencesOf(out);
    while (ss.length > 1 && OFFER.test(ss[ss.length - 1].trim())) ss.pop();
    keep(ss.join(''));
  }
  out = out.trim();
  // (what a fix left begins with a capital, as a reply does)
  return out === was.trim() ? was : out.replace(/^[a-z]/, (c) => c.toUpperCase());
}
