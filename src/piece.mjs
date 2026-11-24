// piece.mjs - A PIECE OF WRITING IS WRITTEN WHOLE, AND KEPT TO THE RULES THE REQUEST SETS. A request for a piece (a resume, a
// summary, a post, a critique) went the way a question goes: each drafter worked the matter out and ended with one line of
// "answer", the slots voted on those lines, and a writer wrote the reply from "what was settled, in short". Measured 2026-11-22
// on a standard test of following instructions: asked for a resume with twelve placeholders the module gave 43 words and six;
// asked for 400 words or more it gave 297; asked for two paragraphs labelled PARAGRAPH X it gave none labelled. Its own small
// model, asked by itself, kept 18 of 20 such requests and the module 15.
// A piece has no short answer to agree on: the piece IS the reply. So here
//   1  the first drafters each write the piece itself, whole, told the rules the request sets in so many words;
//   2  each piece is MEASURED against those rules, by counting, with no model (rulesOf): its words, its sentences, its commas, its
//      capitals, its placeholders, its labelled parts, its bullets, its highlights, its title, its last words;
//   1a one more is written to the conversation AS IT CAME, by the first of them, with no brief and no list of rules (plain;
//      plan.piecePlain: false leaves it out). Its own small model asked by itself kept as many such requests as the module or
//      more (18 of 20 against 17, 2026-11-22): a brief of ours is not always a help. Counted beside the others, it costs one
//      call and the module can do no worse, on the rules that are counted, than its model asked plainly;
//   3  the piece that keeps the most rules goes out as it was written (the first, where they keep as many: the plain one first);
//   4  where even that one breaks a rule, its drafter is told which, with the measure, and writes it once more; the new one
//      stands where it keeps more.
// Nothing here says a piece is GOOD. It says which rules that can be counted it keeps.
const words = (t) =>
  String(t || '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const sentences = (t) =>
  String(t || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const n = (x) => (x === undefined ? NaN : /^\d+$/.test(x) ? Number(x) : NUM[String(x).toLowerCase()] || NaN);
const N = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';

// THE RULES A REQUEST SETS THAT CAN BE COUNTED: [{ id, says, measure(text) -> a number or a boolean, keeps(text) -> boolean,
// broken(text) -> what to tell the writer }]. A rule that is not recognised is no rule here (the writer still reads the request).
export function rulesOf(question) {
  const q = String(question || '');
  const out = [];
  const add = (id, says, keeps, broken) => out.push({ id, says, keeps, broken });
  const least = (re, of, id, unit) => {
    const m = re.exec(q);
    const k = m && n(m.slice(1).find((x) => x !== undefined));
    if (k)
      add(
        id,
        'at least ' + k + ' ' + unit,
        (t) => of(t) >= k,
        (t) => 'it has ' + of(t) + ' ' + unit + ', and at least ' + k + ' are asked for',
      );
    return !!k;
  };
  const most = (re, of, id, unit, strict = false) => {
    const m = re.exec(q);
    const k = m && n(m.slice(1).find((x) => x !== undefined));
    if (k)
      add(
        id,
        (strict ? 'fewer than ' : 'at most ') + k + ' ' + unit,
        (t) => (strict ? of(t) < k : of(t) <= k),
        (t) => 'it has ' + of(t) + ' ' + unit + ', and ' + (strict ? 'fewer than ' : 'at most ') + k + ' are asked for',
      );
    return !!k;
  };
  least(
    new RegExp(
      '(?:at least|a minimum of|no fewer than|more than|over)\\s+' +
        N +
        '\\s+words|' +
        N +
        '\\s*\\+\\s*words?|' +
        N +
        '\\s+or more words|' +
        N +
        '\\+\\s*word',
      'i',
    ),
    words,
    'words-least',
    'words',
  );
  most(new RegExp('(?:fewer than|less than|under)\\s+' + N + '\\s+words', 'i'), words, 'words-under', 'words', true);
  most(
    new RegExp('(?:at most|no more than|a maximum of|not exceed(?:ing)?)\\s+' + N + '\\s+words', 'i'),
    words,
    'words-most',
    'words',
  );
  least(
    new RegExp(
      '(?:at least|a minimum of|no fewer than|more than)\\s+' + N + '\\s+sentences|' + N + '\\s+or more sentences',
      'i',
    ),
    sentences,
    'sentences-least',
    'sentences',
  );
  most(
    new RegExp('(?:fewer than|less than|under)\\s+' + N + '\\s+sentences', 'i'),
    sentences,
    'sentences-under',
    'sentences',
    true,
  );
  most(new RegExp('(?:at most|no more than)\\s+' + N + '\\s+sentences', 'i'), sentences, 'sentences-most', 'sentences');
  const place = (t) => (String(t).match(/\[[^\][\n]+\]/g) || []).length;
  least(
    new RegExp('(?:at least|a minimum of)\\s+' + N + '\\s+placeholders?', 'i'),
    place,
    'placeholders',
    'placeholders in square brackets',
  );
  const marked = (t) => (String(t).match(/\*[^*\n]+\*/g) || []).length;
  least(
    new RegExp('highlight(?:ing)?\\s+(?:at least\\s+)?' + N + '\\s+(?:sections?|parts?|words?|phrases?|key)', 'i'),
    marked,
    'highlights',
    'parts highlighted with *asterisks*',
  );
  const bullets = (t) =>
    String(t)
      .split(/\n/)
      .filter((l) => /^\s*(?:\*|-)\s+\S/.test(l)).length;
  const exact = new RegExp('exactly\\s+' + N + '\\s+bullet points?', 'i').exec(q);
  if (exact && n(exact[1]))
    add(
      'bullets',
      'exactly ' + n(exact[1]) + ' bullet points, each a line beginning with "* "',
      (t) => bullets(t) === n(exact[1]),
      (t) => 'it has ' + bullets(t) + ' bullet points, and exactly ' + n(exact[1]) + ' are asked for',
    );
  if (
    /\b(?:no|without(?: using)?(?: any)?|do(?:es)? not (?:use|include|contain)(?: any)?|refrain from(?: using)?(?: any)?|avoid(?: using)?(?: any)?)\s+commas?\b/i.test(
      q,
    )
  )
    add(
      'no-comma',
      'no comma anywhere',
      (t) => !String(t).includes(','),
      (t) => 'it has ' + (String(t).match(/,/g) || []).length + ' commas, and none is allowed',
    );
  if (/\ball (?:in )?capital letters\b|\bin all caps\b|\ball caps\b|\bcapital letters only\b|\bno lowercase\b/i.test(q))
    add(
      'capitals',
      'every letter a capital',
      (t) => String(t) === String(t).toUpperCase() && /[A-Z]/.test(String(t)),
      () => 'it has lowercase letters, and every letter must be a capital',
    );
  if (/\ball (?:in )?lowercase\b|\bno capital letters\b|\bin lowercase letters\b|\blowercase letters only\b/i.test(q))
    add(
      'lowercase',
      'no capital letter anywhere',
      (t) => String(t) === String(t).toLowerCase() && /[a-z]/.test(String(t)),
      () => 'it has capital letters, and none is allowed',
    );
  // parts with a label and a number: "Label each paragraph with PARAGRAPH X", "2 sections ... SECTION X"
  const lab =
    /\b(?:with|as|by|using)\s+["'“]?((?:PARAGRAPH|SECTION|Section|Paragraph|Part|PART|Day|DAY|Chapter|CHAPTER))\s+[XxNn]\b/.exec(
      q,
    );
  if (lab) {
    const kind = /paragraph/i.test(lab[1]) ? 'paragraphs?' : /section/i.test(lab[1]) ? 'sections?' : lab[1] + 's?';
    const cm = new RegExp(N + '\\s+(?:\\w+\\s+)?' + kind, 'i').exec(q);
    const k = (cm && n(cm[1])) || 1;
    const has = (t) =>
      new Set((String(t).match(new RegExp('\\b' + lab[1] + '\\s+\\d+', 'g')) || []).map((x) => x.replace(/\s+/, ' ')))
        .size;
    add(
      'labels',
      (k > 1 ? k + ' parts' : 'each part') +
        ', each begun with ' +
        lab[1] +
        ' and its number (' +
        lab[1] +
        ' 1' +
        (k > 1 ? ', ' + lab[1] + ' 2' : '') +
        ')',
      (t) => has(t) >= k,
      (t) => 'it has ' + has(t) + ' parts begun with ' + lab[1] + ' and a number, and ' + k + ' are asked for',
    );
  }
  if (/\btitle\b[^.\n]{0,80}(?:double angular brackets|<<)/i.test(q))
    add(
      'title',
      'a title in double angular brackets, as <<title>>',
      (t) => /<<[^<>\n]+>>/.test(String(t)),
      () => 'it has no title in double angular brackets, as <<title>>',
    );
  const end =
    /\b(?:end|finish|conclude)(?:\s+(?:it|your (?:response|reply|answer|letter|post|email)|the (?:response|reply|answer|letter|post|email)))?\s+with\s+(?:the\s+)?(?:exact\s+)?(?:phrase|words?|sentence|line)?\s*:?\s*["“]([^"”\n]{2,120})["”]/i.exec(
      q,
    );
  if (end)
    add(
      'ends-with',
      'its last words are exactly: ' + end[1],
      (t) => String(t).trim().endsWith(end[1].trim()),
      () => 'it does not end with exactly: ' + end[1],
    );
  if (/\b(?:postscript|P\.S\.)/i.test(q) && /\b(?:add|include|end|at the end|starting with)\b/i.test(q))
    add(
      'postscript',
      'a postscript that begins P.S.',
      (t) => /(?:^|\n)\s*P\.S\./.test(String(t)),
      () => 'it has no postscript that begins P.S.',
    );
  return out;
}
export const keptBy = (rules, text) => rules.filter((r) => r.keeps(text)).length;

// IS A REQUEST ONE TO WRITE WHOLE? Where it sets at least one rule that can be counted: only a reply written whole can keep a
// rule on its own length, its own letters or its own parts. A request for a piece that sets no such rule goes the way it went
// (orchestrate.mjs: the writer writes it, and a reply that describes it is not sent).
export const setsRules = (question) => rulesOf(question).length > 0;

export const PIECE_BRIEF =
  'Write what is asked for, whole, exactly as it is asked for: its length, its form, its labels, the words to use and the ' +
  'words to leave out. Begin with it and end with it: no line about what you will do, no list of the rules, no notes after ' +
  'it, no line that starts with ANSWER.';
const RULES_HEAD = 'Rules the request sets (keep every one; do not repeat them in what you write):';
const rulesLine = (rules) =>
  rules.length ? '\n\n' + RULES_HEAD + '\n' + rules.map((r) => '- ' + r.says).join('\n') : '';
// a writer that begins by saying the rules over has them taken off: lines at the head that are the head of the rules, or a rule
export const withoutRules = (text, rules) => {
  const lines = String(text || '').split('\n');
  const said = new Set(rules.map((r) => r.says.toLowerCase()));
  const isRule = (l) => {
    const t = l
      .replace(/^[\s\-*•]+/, '')
      .trim()
      .toLowerCase();
    return !t || /^(?:the request sets these rules|rules the request sets)/.test(t) || said.has(t.replace(/[.;]$/, ''));
  };
  let k = 0;
  while (k < lines.length && isRule(lines[k])) k++;
  return k && k < lines.length && lines.slice(0, k).some((l) => l.trim())
    ? lines.slice(k).join('\n').trim()
    : String(text || '').trim();
};
// room for the piece: for the words it must have, and never less than a page
export const roomFor = (question) => {
  const m = new RegExp(
    '(?:at least|a minimum of|no fewer than|more than|over)\\s+(\\d+)\\s+words|(\\d+)\\s*\\+\\s*words?|(\\d+)\\s+or more words',
    'i',
  ).exec(String(question || ''));
  const k = m ? Number(m.slice(1).find((x) => x !== undefined)) : 0;
  return Math.max(900, Math.min(2400, Math.round(k * 1.9) + 250));
};

// -> { reply, decided, path, ms, trace, ok, tried }
export async function answerPiece({
  question,
  kept,
  house = '',
  slots,
  plain = false,
  ask,
  onStep = () => {},
  onStart = () => {},
  isToolCall = () => false,
  t0 = Date.now(),
}) {
  const rules = rulesOf(question);
  const trace = [];
  const sys = {
    role: 'system',
    content:
      PIECE_BRIEF +
      rulesLine(rules) +
      ' You have no tools.' +
      (house ? '\n\nThe person set this for the conversation:\n' + house : ''),
  };
  const room = roomFor(question);
  // (what each reply was asked with, so that the one chosen is asked again the same way)
  const askedWith = new Map();
  const write = async (slot, msgs, again = '', asPlain = false) => {
    const at = Date.now();
    const row = {
      slot: slot.id,
      member: slot.member,
      stage: 'draft',
      ms: 0,
      out: '',
      final: '',
      ok: false,
      piece: true,
    };
    if (again) row.again = again;
    if (asPlain) row.plain = true;
    askedWith.set(row, msgs);
    onStart({ slot: slot.id, member: slot.member, stage: 'draft' });
    try {
      const r = await ask({ ...slot, maxTokens: room }, msgs);
      row.out = withoutRules(String((r && r.text) || ''), rules);
      row.ok = !!row.out && !isToolCall(row.out);
      row.final = row.ok ? row.out : '';
      if (r && r.tokens) row.tokens = r.tokens;
    } catch (e) {
      row.why = String((e && e.message) || e).slice(0, 200);
    }
    row.kept = row.ok ? keptBy(rules, row.out) : 0;
    row.rules = rules.length;
    row.ms = Date.now() - at;
    trace.push(row);
    onStep(row);
    return row;
  };
  // (the conversation as it came: the person's own system text where there is any, and the turns; nothing of ours)
  const asItCame = [...(house ? [{ role: 'system', content: house }] : []), ...kept];
  const rows = await Promise.all([
    ...(plain && slots.length ? [write(slots[0], asItCame, '', true)] : []),
    ...slots.map((s) => write(s, [sys, ...kept])),
  ]);
  const good = rows.filter((r) => r.ok);
  if (!good.length)
    return { reply: '', decided: '', path: 'fallback', ms: Date.now() - t0, trace, ok: false, tried: null };
  let best = good.reduce((a, b) => (b.kept > a.kept ? b : a));
  let path = best.plain ? 'piece+plain' : 'piece';
  if (rules.length && best.kept < rules.length) {
    const broken = rules.filter((r) => !r.keeps(best.out)).map((r) => '- ' + r.broken(best.out));
    const slot = slots.find((s) => s.id === best.slot);
    const again = await write(
      slot,
      [
        ...askedWith.get(best),
        { role: 'assistant', content: best.out },
        {
          role: 'user',
          content:
            'That piece breaks these rules:\n' +
            broken.join('\n') +
            '\nWrite the whole piece again, keeping every rule. Give the piece only.',
        },
      ],
      'rules',
      !!best.plain,
    );
    if (again.ok && again.kept > best.kept) {
      best = again;
      path += '+rewritten';
    }
  }
  return {
    reply: best.out,
    decided: best.out,
    path,
    ms: Date.now() - t0,
    trace,
    ok: true,
    tried: null,
    rules: { set: rules.length, kept: best.kept },
  };
}
