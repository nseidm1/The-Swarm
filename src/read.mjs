// read.mjs - READING WHAT A SLOT WROTE. A slot's answer is the last fenced block of code in what it wrote, where it wrote one;
// otherwise the last line that starts with the marker (ANSWER:). Code is the same code when it reads the same without comments and
// spacing; two answers are the same when, made plain, they read the same (4,200.0 and 4200; "Tuesday." and "tuesday").
export const MARKER = 'ANSWER:';

// WHAT A MODEL SAID, WITHOUT ITS THINKING. Every small model is served with its thinking off (catalog.mjs), yet one will still write
// its reasoning and then a stray </think> before its reply (measured 2026-11-18: a talk answer went out as "No problem. Let me know
// ...</think>No problem. If you'd like ..."). A closed <think>...</think> is dropped; where a </think> stands alone, what follows it
// is the reply; a <think> never closed is cut off where it opens. Text with no thinking tags is returned as it is.
export function withoutThinking(text) {
  let s = String(text == null ? '' : text);
  if (!/<\/?think>/i.test(s)) return s;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const close = s.search(/<\/think>/i);
  if (close >= 0) s = s.slice(close + s.slice(close).match(/<\/think>/i)[0].length);
  const open = s.search(/<think>/i);
  if (open >= 0) s = s.slice(0, open);
  // (a closing tag appearing again after the reply is dropped with what it closed)
  return s.replace(/<\/think>/gi, '').trim();
}

// an answer may be CODE: then it is the last fenced block in what the slot wrote, unless a marker line comes after it (a slot
// that quotes the code it was asked about, and then answers in a line, has answered in the line)
// (2) a model trained to call tools may hand its code over as a tool call, though it was given no tools: <|tool_call_start|>
//     [name(arg='function ...')]. The code is the text of that argument.
// (3) asked for code, a small model will often write its code and then an ANSWER: line with something else on it (an example of
//     what the code returns). So where the question asks for code (wantsCode), the code is the answer whatever follows it.
const toolCode = (s) => {
  const call = /<\|tool_call_start\|>([\s\S]*?)(?:<\|tool_call_end\|>|$)/.exec(s);
  if (!call) return null;
  // every quoted argument of the call; the code is the first of them that holds a function
  for (const m of call[1].matchAll(/=\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g)) {
    const text = (m[1] !== undefined ? m[1] : m[2])
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
      .replace(/\\(['"\\])/g, '$1')
      .trim();
    if (/\bfunction\s*\w*\s*\(|=>/.test(text)) return { code: text, at: call.index };
  }
  return null;
};
// does this code DEFINE something (a function, a class)? A reply that gives a function and then shows it in use ends with a block
// that only calls it: the answer is the block that defines, not the last one.
const DEFINES =
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*[\w$]+\s*\(|(?:^|\n)\s*(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)|(?:^|\n)\s*class\s+[\w$]+|(?:^|\n)\s*def\s+\w+\s*\(/;
export const defines = (code) => DEFINES.test(String(code || ''));
const lastBlock = (text, marker = MARKER, wantsCode = false) => {
  const s = String(text || '');
  const blocks = [...s.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].filter((m) => m[1].trim());
  if (!blocks.length) return toolCode(s);
  // where code is asked for: the last block that defines something; a block after it that only uses it is an example
  const b = (wantsCode && [...blocks].reverse().find((m) => defines(m[1]))) || blocks[blocks.length - 1];
  if (!wantsCode) {
    const after = s.slice(b.index + b[0].length).toUpperCase();
    const at = after.lastIndexOf(marker.toUpperCase());
    if (at >= 0 && after.slice(at + marker.length).trim()) return null;
  }
  return { code: b[1].trim(), at: b.index };
};
// does a question ask for code? (so that the code in a reply to it is its answer)
// A REPLY THAT IS A CALL TO A TOOL IS NOT A REPLY. A model trained to call tools sometimes answers with one though it was given
// none (LFM2.5 writes <|tool_call_start|>[name(args)]<|tool_call_end|>). Nothing can run it and no person can read it.
export const isToolCall = (text) =>
  /<\|tool_call_start\|>|<tool_call>|<\|python_tag\|>|<function=/.test(String(text || '')) ||
  /^\s*\{\s*"(?:name|tool|function)"\s*:/.test(String(text || ''));

// A CHECKER MAY ANSWER WITH A LETTER: where it finds one of the lettered answers correct, its last line is ANSWER: and that
// letter, and it need not write the answer out again (for a function, that is most of what it can say in one turn). Read from
// the last line that carries the marker: '' when that line is not a letter alone. (A letter followed by the words it was told
// to end with, "B and the letter of the correct one", is that letter: measured 2026-11-19 with real models, a slot asked to
// decide chose in its text and named nothing on 5 of 10 disputes, its last line an echo of the instruction.)
export function letterOf(text, marker = MARKER, letters = 'ABCDEFGH') {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].toUpperCase().lastIndexOf(marker.toUpperCase());
    if (at < 0) continue;
    const said = lines[i]
      .slice(at + marker.length)
      .replace(/[*_`.()\[\]"']/g, '')
      .trim();
    const m = /^(?:answer\s+|option\s+|letter\s+)?([A-Za-z])(?:\s+and the letter of [a-z ]*)?$/i.exec(said);
    return m && letters.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : '';
  }
  return '';
}

// THE TEXT OF A MESSAGE'S CONTENT (SwOA specification S3.7, T.6.6): a string is itself; a list of parts is its text parts
// joined in order with nothing between them (an image or any other part adds nothing); absent or null is empty
export const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && p.type === 'text' && p.text != null ? String(p.text) : '')).join('')
      : content == null
        ? ''
        : String(content);
export const asksForCode = (question) =>
  /code block|write a (?:\w+ )*function|corrected function|give the (?:\w+ )*function/i.test(String(question || ''));
// DOES A QUESTION ASK FOR A PIECE OF WRITING (a text, a message, an email, a note to send)? Then the reply is the piece itself,
// and is never written out "in full" with reasons and next steps around it (orchestrate.mjs writeAs 'full'; SwOA specification
// R.5): a verb of writing, and within 60 characters of it, in the same sentence, the name of a thing that is sent or posted
export const asksForPiece = (question) =>
  /\b(?:write|draft|compose|word)\b[^.?!\n]{0,60}\b(?:text|message|email|e-mail|note|letter|reply|post|card|speech|toast|caption|invitation|apology|announcement)\b/i.test(
    String(question || ''),
  );
// is an answer code? Words about a function are not: code has the marks of code (a function with its brackets, an arrow, a
// statement ended, a name given a value)
export const isCode = (final) =>
  /\bfunction\s*\w*\s*\([^)]*\)\s*\{|=>\s*[{(\w[]|;\s*(\n|$)|^\s*(const|let|var)\s+\w+\s*=/m.test(String(final || ''));
export function finalOf(text, marker = MARKER, wantsCode = false) {
  const block = lastBlock(text, marker, wantsCode);
  if (block) return block.code;
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].toUpperCase().lastIndexOf(marker.toUpperCase());
    if (at < 0) continue;
    const said = lines[i]
      .slice(at + marker.length)
      .replace(/[*_`]/g, '')
      .trim();
    if (said) return said;
    // the marker alone on a line: the answer is the next line that says anything
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return next.replace(/[*_`]/g, '').trim();
  }
  return '';
}

// the work, without its last line (or, where the answer is code, without the code)
export function workOf(text, marker = MARKER, wantsCode = false) {
  const block = lastBlock(text, marker, wantsCode);
  if (block) return String(text).slice(0, block.at).trim();
  const s = String(text || '');
  const at = s.toUpperCase().lastIndexOf(marker.toUpperCase());
  return (at < 0 ? s : s.slice(0, at)).trim();
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?(?:\/\d+)?/;
export function plain(final) {
  // code is the same code when it reads the same with its comments and its spacing taken out. (Two functions written differently
  // that DO the same are not told apart here: they go on to be checked and decided between.)
  if (isCode(final))
    return String(final)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\s+/g, '')
      .replace(/;/g, '');
  const s = String(final || '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  const n = s.match(NUMBER);
  // an answer that is a number with a few words round it ("42 apples", "$1,200") is that number
  if (n && s.replace(NUMBER, '').replace(/[^a-z]/g, '').length <= 14) {
    const [top, under] = n[0].replace(/,/g, '').split('/');
    const v = under ? Number(top) / Number(under) : Number(top);
    if (Number.isFinite(v)) return String(Math.round(v * 1e6) / 1e6);
  }
  return s
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|is|it|answer)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// the answers given, counted: [{ plain, final, by: [slot ids] }] most given first; one given earlier comes first among equals
export function tally(outs) {
  const seen = new Map();
  for (const o of outs) {
    const p = plain(o.final);
    if (!p) continue;
    if (!seen.has(p)) seen.set(p, { plain: p, final: o.final, by: [] });
    seen.get(p).by.push(o.slot);
  }
  return [...seen.values()].sort((a, b) => b.by.length - a.by.length);
}

// A REPLY THAT DESCRIBES THE ANSWER INSTEAD OF GIVING IT: '' where the reply gives it, else why not, in words. Read off the words,
// with no model, the same every time. Asked for a piece of writing, what is settled is a short statement of it ("A tailored
// resume template with 12 placeholders"), and a small writer handed that wrote about the answer ("The answer is a tailored
// resume template that includes 12 placeholders as requested.") where the piece itself was wanted. Three tells:
//   it repeats the labels it was given (it echoed its prompt)
//   it speaks of the request, the draft or the reply as things ("the message asks for", "the draft included", "has been prepared",
//   "the answer is settled with", "the response is clear")
//   it says what the answer is, where what was settled is a sentence about a piece (not a value) and the draft that holds the
//   piece is far longer than the reply: "The answer is 42." is an answer; "The answer is a resume ..." in place of one is not
const LABELS =
  /(?:^|\n)\s*(?:the person['’]s message|what was settled|the draft it came from|they asked|the answer settled on|the work behind it)\s*:/i;
const ABOUT =
  /\b(?:the (?:message|request|prompt|question|task|person) (?:asks|is asking|asked|requires|required|wants)|the draft (?:was|is|came|included|includes|had|has)|(?:has|have) been (?:prepared|written|created|crafted|drafted)|was (?:prepared|created|drafted) (?:with|to|for)|settled (?:on|with|as)|the (?:answer|response|reply) (?:is|was) (?:settled|clear|ready|complete))\b/i;
const SAYS_WHAT =
  /^\W*(?:the|this|my) (?:answer|reply|response|summary|resume|résumé|email|essay|letter|story|poem|piece|draft|template|list|post|tweet|article|blog) (?:is|was|has|have|will|includes|contains|captures|provides|highlights|covers|offers)\b/i;
const wordCount = (s) => (String(s || '').match(/\S+/g) || []).length;
export function describedNotGiven(reply, { settled = '', draft = '' } = {}) {
  // (code is read as code: a comment that says "the task requires" is not the reply talking about itself)
  const r = String(reply || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .trim();
  if (!r) return '';
  if (LABELS.test(r)) return 'it repeats the labels it was given';
  if (ABOUT.test(r)) return 'it speaks of the request, the draft or the reply instead of giving it';
  const sentence = wordCount(settled) >= 6 && !NUMBER.test(String(settled).trim().split(/\s+/)[0] || '');
  if (sentence && SAYS_WHAT.test(r) && wordCount(draft) >= 60 && wordCount(r) < 0.6 * wordCount(draft))
    return 'it says what the answer is, where the piece itself was wanted';
  return '';
}

// A CLOSING REMARK ABOUT HOW THE REPLY WAS MADE IS CUT. A small writer gives the answer and then, in a paragraph of its own, says
// where it got it: "The area is 25 square units.\n\nThis answer was settled based on the provided draft which correctly calculated
// the area." The person sees a draft and a settling they were never shown. Measured 2026-11-18 on a standard test of calling
// functions: 7 of the swarm's 39 replies in words closed this way, each after an answer that stood without it. So the closing
// paragraphs that speak of the draft, of what was settled or of the prompt are cut, as long as a paragraph is left before them;
// a paragraph holding code is never cut, and nothing is where the person's own message speaks of a draft or of settling (the
// reply may then mean theirs). A reply that is nothing but such talk is not helped by this: describedNotGiven reads it next.
const REMARK =
  /\b(?:(?:provided|settled) (?:draft|answer)|(?:provided|given|stated|settled) in the (?:prompt|draft)|the draft (?:explicitly|correctly|provided|provides|explains|explained|states|stated|shows|showed|solved|gives|gave)|(?:this|the) (?:answer|reply|response|solution|result) (?:is|was) (?:settled|based on|derived from|a direct|formatted)|what was settled)\b/i;
// THE FORM THE EARLIER REPLIES CLOSE WITH (plan.closeAs 'shown'; SwOA specification O.8.7). A conversation may show, in the
// replies already given in it, how a reply is to end: each closes with the same words and then its answer ("So the answer is
// (B)." three times over, where worked examples are given as earlier turns). A reply that works the matter out and stops short of
// that line has the answer and is read as having none (measured 2026-11-19: on a standard test of truth chains 17 of 20 replies
// reasoned to the end and never said "the answer is", and were counted as no answer; the larger model said it every time).
//   closingForm(messages) -> { lead, tail, bracket } where at least two earlier replies end with a last sentence that begins with
//                            the same two words or more and then differs; null otherwise
//   withoutRestating(reply, question) -> the reply without the question's own lines and labels at its head
//   laidOutAs(reply, messages)    -> the reply with no empty line in it, where the earlier replies have none
//   closedAs(reply, decided, form) -> the reply, ending with that form around what was settled: the form is added where the
//                            reply does not end with it. A reply that already ends with the form around an answer of its
//                            own stands as it was written
const lastSentence = (text) => {
  const parts = String(text || '')
    .trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((x) => x.trim());
  return parts.length ? parts[parts.length - 1].trim() : '';
};
export function closingForm(messages) {
  const lasts = (messages || [])
    .filter((m) => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
    .map((m) => lastSentence(m.content));
  if (lasts.length < 2) return null;
  const words = lasts.map((l) => l.split(/\s+/));
  let n = 0;
  // (the words every one begins with, leaving each at least one word of its own: its answer)
  while (words.every((w) => w.length > n + 1 && w[n] === words[0][n])) n++;
  if (n < 2) return null;
  const lead = words[0].slice(0, n).join(' ');
  const rests = lasts.map((l) => l.slice(lead.length).trim());
  const tail = rests.every((r) => /[.!?]$/.test(r) && r.slice(-1) === rests[0].slice(-1)) ? rests[0].slice(-1) : '';
  const answers = rests.map((r) => (tail ? r.slice(0, -1) : r).trim());
  if (answers.some((a) => !a || a.length > 200)) return null;
  return { lead, tail, bracket: answers.every((a) => /^\([A-Za-z]\)$/.test(a)) };
}
// AND IT DOES NOT OPEN BY SAYING THE QUESTION AGAIN: lines at the head of the reply that are lines of the person's message, word
// for word, are taken off, and so is a label the message's lines begin with ("Q:", "A:") standing at the head of the reply, alone
// on its line or before the reply's first words. The earlier replies do not open so; and a test that stops reading at such a label
// reads nothing of a reply that begins with it (measured 2026-11-20: 8 of 20 replies to a test of arithmetic began "Q: ((-1 + 2
// ..." and reached the harness empty; each had settled on the right number).
export function withoutRestating(reply, question) {
  const flat = (x) => String(x).replace(/\s+/g, ' ').trim();
  const asked = String(question || '')
    .split('\n')
    .map(flat)
    .filter(Boolean);
  const labels = [...new Set(asked.map((l) => (l.match(/^([A-Za-z]{1,12}):/) || [])[1]).filter(Boolean))];
  if (!asked.length) return reply;
  const lines = String(reply || '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = flat(lines[i]);
    if (!l || asked.includes(l) || labels.some((x) => l === x + ':')) i++;
    else break;
  }
  if (i >= lines.length) return reply; // (nothing but the question: left as it is, for what follows to deal with)
  const rest = lines.slice(i);
  const head = labels.find((x) => new RegExp('^\\s*' + x + ':\\s+\\S').test(rest[0]));
  if (head) rest[0] = rest[0].replace(new RegExp('^\\s*' + head + ':\\s+'), '');
  const out = rest.join('\n');
  return i || head ? out : reply;
}
// AND LAID OUT AS THEY ARE: where at least two earlier replies are shown and none of them has an empty line in it, the reply has
// none either (each run of empty lines becomes one line break). A test that shows its examples as one block reads a reply to its
// first empty line and no further (measured 2026-11-20: with the closing form alone, 53 of 100 replies were still read as no
// answer; they were whole, and were cut at the first empty line between their paragraphs, before the answer).
export function laidOutAs(reply, messages) {
  const said = (messages || []).filter(
    (m) => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim(),
  );
  if (said.length < 2 || said.some((m) => /\n[ \t]*\n/.test(m.content.trim()))) return reply;
  return String(reply || '')
    .trim()
    .replace(/[ \t]*\n(?:[ \t]*\n)+/g, '\n');
}
export function closedAs(reply, decided, form, question = '') {
  let a = String(decided ?? '')
    .trim()
    .replace(/[.]+$/, '');
  if (!form || !a || /\n/.test(a)) return reply;
  if (form.bracket) {
    // (the earlier replies answer "(B)": a settled "B", "b" or "(B) the blue book" is said that way)
    const m = a.match(/^\(?([A-Za-z])\)?(?=[\s.:)]|$)/);
    if (m) a = '(' + m[1].toUpperCase() + ')';
    else {
      // WHAT WAS SETTLED IS AN OPTION'S WORDS, NOT ITS LETTER ("Vincent" where the question lists "(C) Vincent"): it is said by
      // the letter of the one option that reads so. Where no option does, or more than one, the reply is left as it was written:
      // "So the answer is Vincent." is not the form the examples show (measured 2026-11-20: 14 of 20 replies on one test worked
      // out the right option, said "The answer is (C)." and were then closed with its words and counted wrong)
      const plain = (x) =>
        String(x)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const options = [...String(question || '').matchAll(/^\s*\(([A-Za-z])\)[ \t]*(.+?)\s*$/gm)].filter(
        (o) => plain(o[2]) === plain(a),
      );
      if (options.length !== 1) return reply;
      a = '(' + options[0][1].toUpperCase() + ')';
    }
  }
  const close = form.lead + ' ' + a + form.tail;
  const text = String(reply || '').trimEnd();
  if (text.toLowerCase().endsWith(close.toLowerCase())) return text;
  const last = lastSentence(text);
  if (last && last.toLowerCase().startsWith(form.lead.toLowerCase())) {
    // A REPLY THAT ALREADY ENDS WITH THE FORM AROUND AN ANSWER OF ITS OWN STANDS. What was settled is not always what the
    // reply came to, and where the two differ the reply's own was the right one each time it was measured (2026-11-20, one
    // reply closed both ways: of 34 held questions with a form shown, 21 right with the last sentence replaced and 24 with
    // it left, none the other way; on a test of boolean expressions four replies that ended "So the answer is False."
    // were made to end "So the answer is and.", a word of the expression that had been taken for what was settled). The
    // answer is of its own where there is one, in the shape the examples show: a letter in brackets where they show that.
    // A last sentence that begins as the form does and holds no such answer is replaced, as before
    const own = last
      .slice(form.lead.length)
      .trim()
      .replace(/[.!?]+$/, '');
    if (own && (!form.bracket || /^\([A-Za-z]\)$/.test(own))) return text;
    return text.slice(0, text.lastIndexOf(last)) + close;
  }
  return (text ? text + ' ' : '') + close;
}

export function withoutClosingRemark(reply, question = '') {
  const r = String(reply || '').trim();
  if (/\b(?:draft|settled)\b/i.test(String(question || ''))) return r;
  // (paragraphs are parted by a blank line; the reply is cut where the first of its closing remarks begins, as it was written)
  const breaks = [...r.matchAll(/\n\s*\n/g)];
  let end = r.length;
  for (let k = breaks.length - 1; k >= 0; k--) {
    const para = r.slice(breaks[k].index + breaks[k][0].length, end);
    if (para.includes('```') || !REMARK.test(para)) break;
    end = breaks[k].index;
  }
  return r.slice(0, end).trim();
}
