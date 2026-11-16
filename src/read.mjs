// read.mjs - READING WHAT A SLOT WROTE. A slot's answer is the last fenced block of code in what it wrote, where it wrote one;
// otherwise the last line that starts with the marker (ANSWER:). Code is the same code when it reads the same without comments and
// spacing; two answers are the same when, made plain, they read the same (4,200.0 and 4200; "Tuesday." and "tuesday").
export const MARKER = 'ANSWER:';

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
// the last line that carries the marker: '' when that line is not a letter alone.
export function letterOf(text, marker = MARKER, letters = 'ABCDEFGH') {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].toUpperCase().lastIndexOf(marker.toUpperCase());
    if (at < 0) continue;
    const said = lines[i]
      .slice(at + marker.length)
      .replace(/[*_`.()\[\]"']/g, '')
      .trim();
    const m = /^(?:answer\s+|option\s+|letter\s+)?([A-Za-z])$/i.exec(said);
    return m && letters.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : '';
  }
  return '';
}

export const asksForCode = (question) =>
  /code block|write a (?:\w+ )*function|corrected function|give the (?:\w+ )*function/i.test(String(question || ''));
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
