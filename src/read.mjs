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
  /code block|write a (?:\w+ )*(?:function|program|method)|write a (?:\w+ )*solution\b[\s\S]*```|corrected function|give the (?:\w+ )*function/i.test(
    String(question || ''),
  );
// DOES A QUESTION ASK FOR A PIECE OF WRITING (a text, a message, an email, a note to send)? Then the reply is the piece itself,
// and is never written out "in full" with reasons and next steps around it (orchestrate.mjs writeAs 'full'; SwOA specification
// R.5): a verb of writing, and within 60 characters of it, in the same sentence, the name of a thing that is sent or posted
export const asksForPiece = (question) =>
  /\b(?:write|draft|compose|word)\b[^.?!\n]{0,60}\b(?:text|message|email|e-mail|note|letter|reply|post|card|speech|toast|caption|invitation|apology|announcement)\b/i.test(
    String(question || ''),
  );
// DOES THE REQUEST INSTRUCT ITS OWN REPLY? It speaks of the reply as a thing to be made a certain way ("your entire response",
// "respond using only", "in your answer", "wrap the output", "do not use", "without using", "make sure to", "first repeat")
// or asks for something to be written, made or put another way (write, compose, draft, rewrite, make a ..., create a ...).
// Such a reply is itself what is asked for: there is no short answer in it to settle. (Measured 2026-11-22 on 100 requests
// of a standard test of following instructions: the two readings before this one knew 59 of them.)
export const instructsReply = (question) => {
  const q = String(question || '');
  return (
    /\b(?:your|the) (?:entire |whole |final )?(?:response|reply|answer|output)\b|\brespond(?:ing)? (?:using|in|with|only)\b|\bin your (?:response|reply|answer)\b|\bwrap (?:the|your)\b|\b(?:do not|don't) (?:use|include|say|write|add)\b|\bwithout (?:using|any)\b|\bmake sure (?:to|that|it|your)\b|\bfirst,? repeat\b|\bseparated? (?:by|the)\b|\bin (?:json|markdown|xml) format\b/i.test(
      q,
    ) ||
    /(?:^|[.!?:]\s+|\bplease\s+|\b(?:can|could|would) you (?:please )?(?:help me )?)(?:write|compose|draft|rewrite|rephrase|create|generate|make|produce|give me|provide|summari[sz]e|translate|explain|describe)\b/im.test(
      q,
    )
  );
};
// is an answer code? Words about a function are not: code has the marks of code (a function with its brackets, an arrow, a
// statement ended, a name given a value), or the marks of Python (a def or a class with its colon, a line that imports, a
// lambda). Python had none of the first marks, so a Python function was taken for words (measured 2026-11-22: 0 of 40).
import { hasMarks, marksOf, FENCE } from './langs.mjs';
const JS_MARKS = /\bfunction\s*\w*\s*\([^)]*\)\s*\{|=>\s*[{(\w[]|;\s*(\n|$)|^\s*(const|let|var)\s+\w+\s*=/m;
const PY_MARKS =
  /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)[^:\n]*:|^\s*class\s+\w+[^:\n]*:\s*$|^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.,* ]+$|\blambda\b[^:\n]*:/m;
export const isCode = (final) =>
  JS_MARKS.test(String(final || '')) || PY_MARKS.test(String(final || '')) || hasMarks(final);
// the language code is fenced as where it goes out: the one whose marks it has, and JavaScript where it has JavaScript's
export const fenceOf = (final) => {
  const m = marksOf(final);
  const js = JS_MARKS.test(String(final || ''));
  if (PY_MARKS.test(String(final || '')) && !js) return 'python';
  if (m && m !== 'ts' && m !== 'python') return FENCE[m];
  return js && m === 'ts' ? 'ts' : 'js';
};
// A REPLY ALREADY BEGUN. A conversation that ends with the assistant's own turn gives the start of the reply, and what is
// wanted is what follows it. begunOf: that start, or '' (the last message is a person's, or there is none).
export const begunOf = (messages) => {
  const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  if (!last || last.role !== 'assistant' || (Array.isArray(last.tool_calls) && last.tool_calls.length)) return '';
  return typeof last.content === 'string' ? last.content : '';
};
// WHAT FOLLOWS THE START. Where the start has opened a block of code and stands inside a Python function (its head, perhaps
// its docstring), and the settled answer is that function written whole, what follows is the function's BODY, set in as the
// start sets it in, with whatever else the answer wrote beside the function (an import, a helper) put first inside it: the
// start and the continuation together are then the function. Where the reply repeats the start, the start is taken off.
// Otherwise the reply stands as it is.
export function continuedFrom(begun, reply, decided = '') {
  const b = String(begun || '');
  const r = String(reply || '');
  if (!b.trim()) return r;
  const open = (b.match(/```/g) || []).length % 2 === 1;
  const fenced = [...r.matchAll(/```[a-zA-Z]*\n([\s\S]*?)(?:```|$)/g)].map((m) => m[1]);
  const code = isCode(decided) ? String(decided) : fenced.length ? fenced[fenced.length - 1] : '';
  if (open && code) {
    const tail = b.slice(b.lastIndexOf('```')).replace(/^```[^\n]*\n?/, '');
    const body = pythonBodyFor(tail, code);
    if (body !== null) return body;
    // (the start opened the block and wrote nothing in it: the code goes in it, and the block is closed)
    if (!tail.trim()) return code.replace(/\s+$/, '') + '\n```';
  }
  if (r.trimStart().startsWith(b.trim())) return r.trimStart().slice(b.trim().length);
  return r;
}
const indentOf = (line) => line.match(/^[ \t]*/)[0];
function pythonBodyFor(tail, code) {
  const heads = [...String(tail).matchAll(/^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)];
  if (!heads.length) return null;
  const head = heads[heads.length - 1];
  const inner = head[1] + '    ';
  const lines = String(code).replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => new RegExp('^[ \\t]*(?:async\\s+)?def\\s+' + head[2] + '\\s*\\(').test(l));
  const set = (ls) => {
    const real = ls.filter((l) => l.trim());
    const least = real.length ? Math.min(...real.map((l) => indentOf(l).length)) : 0;
    return ls.map((l) => (l.trim() ? inner + l.slice(least) : ''));
  };
  // (the answer is the body alone: no function is declared at its top)
  if (at < 0) return /^(?:async\s+)?def\s/m.test(code) ? null : set(lines).join('\n').replace(/\s+$/, '') + '\n';
  const own = indentOf(lines[at]).length;
  let from = at;
  while (from < lines.length && !/:\s*(?:#.*)?$/.test(lines[from])) from++;
  from++;
  let to = from;
  while (to < lines.length && (!lines[to].trim() || indentOf(lines[to]).length > own)) to++;
  let body = lines.slice(from, to);
  // (its docstring is in the start already)
  const first = body.findIndex((l) => l.trim());
  const q = first >= 0 ? (body[first].trim().match(/^[rRuU]?("""|''')/) || [])[1] : '';
  if (q) {
    let end = first;
    if (
      body[first]
        .trim()
        .replace(/^[rRuU]?/, '')
        .slice(3)
        .includes(q)
    )
      end = first;
    else {
      end = first + 1;
      while (end < body.length && !body[end].includes(q)) end++;
    }
    body = body.slice(end + 1);
  }
  if (!body.some((l) => l.trim())) return null;
  const beside = [...lines.slice(0, at), ...lines.slice(to)].filter(
    (l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()),
  );
  const outer = beside.some((l) => l.trim()) ? set(beside) : [];
  return [...outer, ...set(body)].join('\n').replace(/\s+$/, '') + '\n';
}
// WHAT IS SAID ON THE ANSWER LINE, WITHOUT THE MARKS A MODEL PUTS ROUND IT FOR EMPHASIS. Every *, _ and ` was taken off, which
// is right for "**42**" and wrong for code: a draft that gave a function on its answer line had `return n * 5` read as
// `return n  5`, and a name like sum_list read as sumlist, so every conversation turn asking for code was wrong whatever
// was drafted (measured 2026-11-24: 0 of 10, where one model asked alone had 9). Marks that wrap the whole answer come off;
// what reads as code is then left as it is; elsewhere * and ` come off, and _ only where it is not inside a name.
const READS_AS_CODE =
  /\bfunction\b|=>|\bdef\s|\breturn\b|\b(?:const|let|var)\s|[;{}]|\w\s*\([^)]*\)\s*[{:]|[\w)\]]\s*[*/%]\s*[\w(]|[A-Za-z0-9]_[A-Za-z0-9]/;
export function unmarked(text) {
  let s = String(text || '').trim();
  for (let i = 0; i < 4; i++) {
    const m = /^(\*\*|__|\*|_|`+)([\s\S]+?)\1$/.exec(s);
    if (!m) break;
    s = m[2].trim();
  }
  if (READS_AS_CODE.test(s)) return s;
  return s
    .replace(/[*`]/g, '')
    .replace(/(^|[^A-Za-z0-9])_+|_+(?=$|[^A-Za-z0-9])/g, '$1')
    .trim();
}
// AN ANSWER LINE THAT GOES ON TO DOUBT ITSELF, AND ONE THAT ONLY OPENS A BLOCK OF CODE (measured 2026-11-24, one 1.7B model on
// training's own questions: "ANSWER: cinder copper ... velvet violet? Wait need correct order." was read whole, afterthought
// and all, so a right answer was no slot's; and a block of code begun on the answer line and never closed was read as the
// one word "javascript", which then had a vote).
//   - what follows a "?", a "//" or a full stop and begins "wait", "but we need", "hmm", "actually", "not sure", "let me check" is
//     an afterthought: the answer is what stood before it
//   - a line that is only a fence and a language's name is no answer
const AFTERTHOUGHT =
  /(?:\?+|\s\/\/|\.)\s+(?:wait\b|but (?:we|i) (?:need|should|must)\b|hmm+\b|actually\b|not sure\b|let me (?:check|recheck|re-check|verify|think|recount|correct|redo)\b|need to (?:check|verify|correct)\b)[\s\S]*$/i;
export const settledPart = (said) => {
  const s = String(said || '').trim();
  if (/^`{3,}\s*[A-Za-z0-9+#-]*\s*$/.test(s)) return '';
  const cut = s.replace(AFTERTHOUGHT, '').trim();
  return cut && cut !== s ? cut.replace(/[\s,;:]+$/, '') : s;
};
export function finalOf(text, marker = MARKER, wantsCode = false) {
  const block = lastBlock(text, marker, wantsCode);
  if (block) return block.code;
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].toUpperCase().lastIndexOf(marker.toUpperCase());
    if (at < 0) continue;
    // (the marker itself may be in bold, "**ANSWER:** 42": the marks that closed it are left at the start of what follows)
    const said = unmarked(settledPart(lines[i].slice(at + marker.length).replace(/^\s*(?:\*+|_+)(?=\s|$)/, '')));
    if (said) return said;
    // the marker alone on a line: the answer is the next line that says anything
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return unmarked(settledPart(next));
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
const TOLD_TO =
  /\bnow write the reply itself\b|\ba statement of the answer, not the reply itself\b|\bexactly as the person will read it\b/i;
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
  // (and what it was told to do, said over: "Now write the reply itself, exactly as the person will read it, and nothing else." went
  // out as the end of a reply, under no label, on a made question of brackets: measured 2026-11-27)
  if (TOLD_TO.test(r)) return 'it repeats what it was told to do';
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
  // (two words or more; or one that is a mark and no word, as in examples that close "#### 18")
  // (a mark every example's answer happens to begin with is the answer's, not the form's: two examples that both close
  // "the answer is: } >" and "... } }" share the "}", and a lead that kept it put a bracket before every answer said after
  // it. Measured 2026-11-28: code closed the brackets right and the reply was wrong, 2 of 96. The lead ends on a word)
  while (n > 1 && !/[A-Za-z0-9]/.test(words[0][n - 1])) n--;
  if (n < 2 && !(n === 1 && !/[A-Za-z0-9]/.test(words[0][0]))) return null;
  const lead = words[0].slice(0, n).join(' ');
  const rests = lasts.map((l) => l.slice(lead.length).trim());
  const tail = rests.every((r) => /[.!?]$/.test(r) && r.slice(-1) === rests[0].slice(-1)) ? rests[0].slice(-1) : '';
  const answers = rests.map((r) => (tail ? r.slice(0, -1) : r).trim());
  if (answers.some((a) => !a || a.length > 200)) return null;
  return {
    lead,
    tail,
    bracket: answers.every((a) => /^\([A-Za-z]\)$/.test(a)),
    // (every example's answer is a number and nothing more: what is settled is said as its number)
    number: answers.every((a) => /^-?\$?\d[\d,]*(?:\.\d+)?$/.test(a)),
    // (every example's answer is marks with a space between each, as "] ] >": an answer of marks is said so)
    spaced:
      answers.every((a) => /^[^\sA-Za-z0-9](?: [^\sA-Za-z0-9])*$/.test(a)) && answers.some((a) => a.includes(' ')),
  };
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
// THE OPTIONS A QUESTION LISTS: its lines that begin with one letter in round brackets, [{ letter, words }]; fewer than two
// and it lists none. optionOf: the letter of the option an answer IS (its letter, alone or before its words; or its words,
// where one option alone reads so), or ''.
const plainWords = (x) =>
  String(x)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function optionsOf(question) {
  const out = [...String(question || '').matchAll(/^\s*\(([A-Za-z])\)[ \t]*(.+?)\s*$/gm)].map((m) => ({
    letter: m[1].toUpperCase(),
    words: m[2],
  }));
  return out.length >= 2 && new Set(out.map((o) => o.letter)).size === out.length ? out : [];
}
// THE FORM THE SYSTEM TEXT SETS (plan.setForm; SwOA specification O.8.8). A caller may say, in the conversation's system text,
// the form the reply is to have, as a template: {'answer': A short and precise answer, 'context': A brief explanation}. A
// small writer keeps it loosely (a quote dropped, a brace astray, or no form at all once what it is shown is long: measured
// 2026-11-22, 11 of 20 on a made search task and 1 to 3 of 20 on a standard one). The answer is already settled and the form
// is stated, so code writes the one into the other.
//   setFormOf(messages) -> { first, second, unknown } where the system text holds a template of two quoted keys whose values
//                          are descriptions (not quoted themselves); unknown: the literal form it gives for "I do not know",
//                          where it gives one; null where there is no such template
//   inSetForm(reply, decided, form) -> the reply in that form: the first key holds what was settled, the second what the
//                          reply said of it. A reply already in the form, well made, stands as it was written
const SAYS_UNKNOWN =
  /\b(?:do(?:es)? not know|don't know|cannot (?:be )?(?:answer|determin)\w*|can't answer|not (?:clear|specified|mentioned|provided)|unable to|no (?:clear )?(?:answer|information))\b/i;
export function setFormOf(messages) {
  const sys = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role === 'system' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n');
  const m =
    /\{\s*(['"])([A-Za-z][\w ]{1,24})\1\s*:\s*(?!['"])[^{}]*?,\s*(['"])([A-Za-z][\w ]{1,24})\3\s*:\s*(?!['"])[^{}]*\}/.exec(
      sys,
    );
  if (!m) return null;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unknown = new RegExp(
    '\\{\\s*[\'"]' +
      esc(m[2]) +
      '[\'"]\\s*:\\s*[\'"]I do not know[\'"]\\s*,\\s*[\'"]' +
      esc(m[4]) +
      '[\'"]\\s*:\\s*[\'"][^\'"{}]*[\'"]\\s*\\}',
    'i',
  ).exec(sys);
  return { first: m[2], second: m[4], unknown: unknown ? unknown[0] : '' };
}
export function inSetForm(reply, decided, form) {
  const r = String(reply || '').trim();
  if (!form || !r) return r;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const key = (k) => '[\'"]' + esc(k) + '[\'"]\\s*:\\s*';
  const value = '(?:\'[^\']*\'|"[^"]*"|-?\\d[\\d.,]*)';
  if (new RegExp('^\\{\\s*' + key(form.first) + value + '\\s*,\\s*' + key(form.second) + value + '\\s*\\}$').test(r))
    return r;
  const bare = (x) =>
    String(x || '')
      .replace(/[{}]/g, ' ')
      .replace(/^[\s'",:]+|[\s'",:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  // (what the reply itself gave under each key, where it tried the form; else what was settled, and the reply's own words)
  const under = (k, next) => {
    const m = new RegExp(
      key(k) + '([\\s\\S]*?)' + (next ? '(?=,?\\s*[\'"{]*' + esc(next) + '[\'"]?\\s*:)' : '$'),
      'i',
    ).exec(r);
    return m ? bare(m[1]) : '';
  };
  const settled = bare(decided);
  let first =
    settled && settled.length <= 200 && !new RegExp(key(form.first), 'i').test(settled)
      ? settled
      : under(form.first, form.second) || settled || bare(r);
  let second = under(form.second, '') || bare(r.replace(new RegExp(key(form.first), 'gi'), ' '));
  if (form.unknown && SAYS_UNKNOWN.test(first)) return form.unknown;
  if (!second || second === first) second = first;
  const q = (x) => "'" + x.slice(0, 600).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  return '{' + q(form.first) + ': ' + q(first) + ', ' + q(form.second) + ': ' + q(second) + '}';
}
export function optionOf(final, options) {
  if (!options || !options.length) return '';
  const a = String(final ?? '')
    .trim()
    .replace(/[.]+$/, '');
  if (!a || /\n/.test(a)) return '';
  const m = a.match(/^\(([A-Za-z])\)(?=[\s.:]|$)|^([A-Za-z])(?=[.:)]?$)/);
  const letter = m ? (m[1] || m[2]).toUpperCase() : '';
  if (letter && options.some((o) => o.letter === letter)) return letter;
  const same = options.filter((o) => plainWords(o.words) === plainWords(a));
  return same.length === 1 ? same[0].letter : '';
}
export function closedAs(reply, decided, form, question = '') {
  let a = String(decided ?? '')
    .trim()
    .replace(/[.]+$/, '');
  if (!form || !a || /\n/.test(a)) return reply;
  // THE REPLY'S OWN ANSWER, IN OTHER WORDS THAN THE FORM'S. The examples close "So the answer is (B)." and the reply ends
  // "The answer is (A).": it has an answer of its own and says it in words a reader of the form does not read (measured
  // 2026-11-22: 7 of 40 replies on two tests). Its last sentence is said in the form, around the reply's own letter.
  if (form.bracket) {
    const text0 = String(reply || '').trimEnd();
    const last0 = lastSentence(text0);
    const own0 =
      last0 &&
      !last0.toLowerCase().startsWith(form.lead.toLowerCase()) &&
      last0.match(/\banswer is:?\s*\(?([A-Za-z])\)?[.!]?$/i);
    if (own0)
      return text0.slice(0, text0.lastIndexOf(last0)) + form.lead + ' (' + own0[1].toUpperCase() + ')' + form.tail;
  }
  if (form.spaced && /^[^\sA-Za-z0-9]{2,}$/.test(a)) a = a.split('').join(' ');
  if (form.number) {
    // (the number in what was settled: the last one, without its sign of money or its commas; none, and nothing is done)
    const nums = a.match(/-?\$?\d[\d,]*(?:\.\d+)?/g);
    if (!nums) return reply;
    a = nums[nums.length - 1].replace(/[$,]/g, '');
  }
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
    // (its own answer of marks written without the spaces the examples show: said with them)
    if (own && form.spaced && /^[^\sA-Za-z0-9]{2,}$/.test(own))
      return text.slice(0, text.lastIndexOf(last)) + form.lead + ' ' + own.split('').join(' ') + form.tail;
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
