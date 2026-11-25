// forms.mjs - A MODEL READS, CODE WORKS IT OUT. An instrument (instruments.mjs) reads a question by its wording, so a question
// put another way is not read. Here the two halves are parted: what a question SAYS is written into a fixed form (by an
// instrument's own reading of the wordings it knows, or by a model, whose reply is held to the form's schema), and the answer
// is worked out from the form by code. The wording then matters only to the half a model is good at.
//   FORMS[id] = { cue, about, schema, answer }
//     cue(question)            could this be a question of the kind? Loose, by a few words: it only says whether to ask
//     about                    what each field holds, said for the model that fills it
//     schema                   the form, as a JSON schema a reply can be held to
//     answer(form, question)   the answer worked out from the form, or null: the form names something the question does not
//                              hold (it was not read from the question), or what it says does not settle one answer
// A form filled wrongly gives a wrong answer said with certainty, so whoever asks a model for one asks more than once and
// takes an answer only where the readings agree (formAnswer).

const low = (x) =>
  String(x ?? '')
    .trim()
    .toLowerCase();
const within = (question, x) =>
  !!low(x) && new RegExp('(^|[^a-z0-9])' + low(x).replace(/[^a-z0-9 ]/g, '.') + '(?![a-z0-9])').test(low(question));
// (the start of a word of the question: a kind however its word ends)
const begins = (question, x) =>
  !!low(x) && new RegExp('(^|[^a-z0-9])' + low(x).replace(/[^a-z0-9 ]/g, '.')).test(low(question));
// THE LETTERED OPTIONS OF A QUESTION, read by code: "(A) the red book", "A. 02/27/2017", "B) 5am to 8am"
export const optionsOf = (question) => {
  const q = String(question);
  const round = [...q.matchAll(/\(([A-H])\)\s*([^()\n]+?)(?=\s*\([A-H]\)|\s*$|\s*\n)/gm)];
  const dotted = [...q.matchAll(/^\s*([A-H])[.)]\s+(.+?)\s*$/gm)];
  return (round.length >= 2 ? round : dotted).map((m) => ({ letter: m[1], text: m[2].trim().replace(/[.;,]$/, '') }));
};
// the one option a test picks, as its letter; none or several: null
const letterOf = (options, test) => {
  const o = options.filter((x) => test(x.text));
  return o.length === 1 ? o[0].letter : null;
};
// EVERY ORDER OF n THINGS tried against rules (each a test of pos, where pos[i] is the place of thing i): the things that can
// stand in the place asked. One only: the rules settle it.
function placed(n, rules, asked) {
  const found = new Set();
  const pos = new Array(n).fill(-1);
  const used = new Array(n).fill(false);
  const place = (i) => {
    if (i === n) {
      if (rules.every((r) => r(pos))) found.add(pos.indexOf(asked));
      return;
    }
    for (let k = 0; k < n; k++) {
      if (used[k]) continue;
      used[k] = true;
      pos[i] = k;
      place(i + 1);
      used[k] = false;
    }
    pos[i] = -1;
  };
  place(0);
  return found.size === 1 ? [...found][0] : -1;
}
// HOW MANY THINGS A QUESTION CAN BE SAYING: its sentences, and the parts of them joined by and, but, while. A form that holds
// more statements than that was not read from the question: it was worked out, or made up
export const clausesOf = (question) =>
  String(question)
    .split(/[.;?!\n]+|,?\s+(?:and|but|while|whereas|however)\s+/i)
    .filter((x) => /[a-z]/i.test(x)).length;
const names = (list) => [...new Set(list.map(low).filter(Boolean))];
const str = { type: 'string', maxLength: 40 };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items) => ({ type: 'array', items });
const one = (...of) => ({ type: 'string', enum: of });

// ---- who tells the truth
function liesAnswer(f, q) {
  // (as a model writes it: one statement for each sentence, the speaker empty where the text itself says it; or parted already)
  const said = f.statements || [];
  // (a person said to speak of themself is the text speaking: "Lena tells the truth" written as Lena saying so of Lena)
  const own = (s) => !low(s.speaker) || low(s.speaker) === low(s.about);
  const stated = f.stated || said.filter(own).map((s) => ({ name: s.about, truthful: s.says !== 'lies' }));
  const claims =
    f.claims ||
    said.filter((s) => !own(s)).map((s) => ({ speaker: s.speaker, about: s.about, saysTruthful: s.says !== 'lies' }));
  if (!stated.length || !claims.length || !f.asked) return null;
  if (stated.length + claims.length > clausesOf(q)) return null;
  const all = [f.asked, ...stated.map((s) => s.name), ...claims.flatMap((c) => [c.speaker, c.about])];
  if (!all.every((n) => within(q, n))) return null;
  const truth = new Map();
  for (const s of stated) {
    if (truth.has(low(s.name)) && truth.get(low(s.name)) !== !!s.truthful) return null;
    truth.set(low(s.name), !!s.truthful);
  }
  for (let turn = 0; turn <= claims.length; turn++)
    for (const c of claims) {
      if (!truth.has(low(c.about))) continue;
      const v = truth.get(low(c.about)) === !!c.saysTruthful; // (who says a true thing tells the truth)
      if (truth.has(low(c.speaker)) && truth.get(low(c.speaker)) !== v) return null; // (they do not agree)
      truth.set(low(c.speaker), v);
    }
  // (every claim has to have been used: one about a person nothing settles means the form is not the whole of it)
  if (!claims.every((c) => truth.has(low(c.speaker))) || !truth.has(low(f.asked))) return null;
  return truth.get(low(f.asked)) === (f.askedWhether !== 'lies') ? 'Yes' : 'No';
}

// ---- a word, and what is done to it in turn
function wordAnswer(f, q) {
  let w = String(f.word || '');
  if (!/^[A-Za-z]+$/.test(w) || !within(q, w) || !Array.isArray(f.steps) || !f.steps.length) return null;
  for (const s of f.steps) {
    const n = Math.max(1, Number(s.count) || 1);
    if (s.do === 'reverse') w = [...w].reverse().join('');
    else if (s.do === 'capitals') w = w.toUpperCase();
    else if (s.do === 'small') w = w.toLowerCase();
    else if (s.do === 'double') w = w + w;
    else if (s.do === 'removeFirst' || s.do === 'removeLast') {
      if (n >= w.length) return null;
      w = s.do === 'removeFirst' ? w.slice(n) : w.slice(0, -n);
    } else return null;
  }
  return w || null;
}

// ---- things in a row
function rowAnswer(f, q) {
  const items = (f.items || []).map(low);
  const n = items.length;
  if (n < 2 || n > 7 || new Set(items).size !== n || !items.every((x) => begins(q, x))) return null;
  const at = (x) => {
    const t = low(x).replace(/^the /, '');
    if (items.includes(t)) return items.indexOf(t);
    const near = items.filter((it) => t && (t.includes(it) || it.includes(t)));
    return near.length === 1 ? items.indexOf(near[0]) : -1;
  };
  const placeOf = (place, from) => {
    const k = Number(place);
    if (!(k >= 1 && k <= n)) return -1;
    return from === 'right' ? n - k : k - 1;
  };
  const rules = [];
  for (const t of f.facts || []) {
    const a = at(t.thing);
    if (a < 0) return null;
    if (t.is === 'leftOf' || t.is === 'rightOf') {
      const b = at(t.other);
      if (b < 0 || b === a) return null;
      rules.push(t.is === 'leftOf' ? (pos) => pos[a] < pos[b] : (pos) => pos[a] > pos[b]);
    } else if (t.is === 'place') {
      const k = placeOf(t.place, t.from);
      if (k < 0) return null;
      rules.push((pos) => pos[a] === k);
    } else return null;
  }
  const asked = placeOf((f.asked || {}).place, (f.asked || {}).from);
  if (asked < 0 || !rules.length) return null;
  const it = placed(n, rules, asked);
  if (it < 0) return null;
  const options = optionsOf(q);
  if (!options.length) {
    // (said as the question writes it: a name with its capital stands by itself, a thing is "The red book")
    const as = new RegExp('\\b' + items[it].replace(/[^a-z0-9 ]/g, '.') + '\\b', 'i').exec(q);
    return as && /^[A-Z]/.test(as[0]) ? as[0] : 'The ' + items[it];
  }
  // (the option that names this thing and no other of them)
  return letterOf(options, (text) => {
    const named = items.filter((x) => low(text).includes(x));
    return named.length === 1 && named[0] === items[it];
  });
}

// ---- a date, so long on or back
const two = (v) => String(v).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateAnswer(f, q) {
  const t = f.today || {};
  const [y, mo, da] = [Number(t.year), Number(t.month), Number(t.day)];
  const start = new Date(Date.UTC(y, mo - 1, da));
  if (!(y > 0) || start.getUTCMonth() !== mo - 1 || start.getUTCDate() !== da) return null; // (no such day)
  const amount = Number(f.amount);
  if (!(amount >= 0) || !within(q, String(y))) return null;
  const sign = f.direction === 'back' ? -1 : f.direction === 'on' ? 1 : 0;
  if (!sign) return null;
  let d;
  if (f.unit === 'day' || f.unit === 'week')
    d = new Date(start.getTime() + sign * amount * (f.unit === 'week' ? 7 : 1) * 86400000);
  else if (f.unit === 'month' || f.unit === 'year') {
    const months = mo - 1 + sign * amount * (f.unit === 'year' ? 12 : 1);
    d = new Date(Date.UTC(y + Math.floor(months / 12), ((months % 12) + 12) % 12, da));
    if (d.getUTCDate() !== da) return null; // (the month has no such day: not ours to round)
  } else return null;
  const dmy = /day\s*\/\s*month\s*\/\s*year|dd\s*\/\s*mm/i.test(q);
  const write = (x) =>
    (dmy
      ? two(x.getUTCDate()) + '/' + two(x.getUTCMonth() + 1)
      : two(x.getUTCMonth() + 1) + '/' + two(x.getUTCDate())) +
    '/' +
    x.getUTCFullYear();
  const want = write(d);
  const options = optionsOf(q);
  if (!options.length) return want;
  return letterOf(options, (text) => {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (m) return two(m[1]) + '/' + two(m[2]) + '/' + m[3] === want;
    // (a month by its name: "October 7, 1999", "7 October 1999")
    const w =
      /([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/.exec(text) ||
      /(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?,? (\d{4})/.exec(text);
    if (!w) return false;
    const [name, day] = /^\d/.test(w[1]) ? [w[2], w[1]] : [w[1], w[2]];
    const month = MONTHS.indexOf(low(name).slice(0, 3));
    return (
      month >= 0 && Number(day) === d.getUTCDate() && month === d.getUTCMonth() && Number(w[3]) === d.getUTCFullYear()
    );
  });
}

// ---- when someone was free
// an hour of the day as it is said: 5am, 12pm, 2 pm, 14:00, noon, midnight -> 0..24, or -1
export const hourOf = (x) => {
  const t = low(x).replace(/\./g, '');
  if (t === 'noon') return 12;
  if (t === 'midnight') return 0;
  let m = /^(\d{1,2})(?::00)?\s*(am|pm)$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return -1;
    return m[2] === 'am' ? h % 12 : (h % 12) + 12;
  }
  m = /^(\d{1,2}):00$/.exec(t);
  return m && Number(m[1]) <= 24 ? Number(m[1]) : -1;
};
function freeAnswer(f, q) {
  const from = hourOf(f.awakeFrom);
  const till = hourOf(f.closedAfter);
  const seen = (f.seen || []).map((s) => [hourOf(s.from), hourOf(s.to)]);
  if (from < 0 || till <= from || !seen.length || seen.some(([a, b]) => a < from || b > till || b <= a)) return null;
  if (![f.awakeFrom, f.closedAfter, ...(f.seen || []).flatMap((s) => [s.from, s.to])].every((x) => within(q, x)))
    return null;
  const busy = new Array(24).fill(false);
  for (const [a, b] of seen)
    for (let h = a; h < b; h++) {
      if (busy[h]) return null; // (seen in two places at once)
      busy[h] = true;
    }
  const gaps = [];
  for (let h = from; h < till; h++)
    if (!busy[h]) {
      if (gaps.length && gaps[gaps.length - 1][1] === h) gaps[gaps.length - 1][1] = h + 1;
      else gaps.push([h, h + 1]);
    }
  if (gaps.length !== 1) return null;
  const [a, b] = gaps[0];
  const said = (h) => (h % 24 === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm');
  const options = optionsOf(q);
  if (!options.length) return said(a) + ' to ' + said(b);
  return letterOf(options, (text) => {
    const m = /^(.+?)\s*(?:to|-|–|until|and)\s*(.+)$/i.exec(text.replace(/^(?:from|between)\s+/i, ''));
    return !!m && hourOf(m[1]) === a && hourOf(m[2]) === b;
  });
}

// ---- who is the tallest: things compared two at a time
function orderAnswer(f, q) {
  // (as a model writes it: a is "more" or "less" than b, as the sentence has it; or the lesser and the greater told apart already)
  const pairs = (f.comparisons || []).map((p) =>
    p.is ? (p.is === 'less' ? { lesser: p.a, greater: p.b } : { lesser: p.b, greater: p.a }) : p,
  );
  // (one comparison is no ordering to work out: a form of one was made of a question about something else)
  if (pairs.length < 2 || pairs.length > clausesOf(q)) return null;
  const items = names(pairs.flatMap((p) => [p.lesser, p.greater]));
  const n = items.length;
  if (n < 2 || n > 7 || !items.every((x) => within(q, x))) return null;
  const rules = [];
  for (const p of pairs) {
    const a = items.indexOf(low(p.lesser));
    const b = items.indexOf(low(p.greater));
    if (a === b) return null;
    rules.push((pos) => pos[a] < pos[b]);
  }
  const k = Number((f.asked || {}).rank);
  if (!(k >= 1 && k <= n)) return null;
  const end = (f.asked || {}).from;
  if (end !== 'greatest' && end !== 'least') return null;
  const it = placed(n, rules, end === 'least' ? k - 1 : n - k);
  if (it < 0) return null;
  // (said as the question writes it)
  const as = new RegExp('\\b' + items[it].replace(/[^a-z0-9 ]/g, '') + '\\b', 'i').exec(q);
  const name = as ? as[0] : items[it];
  const options = optionsOf(q);
  return options.length ? letterOf(options, (text) => low(text) === items[it]) : name;
}

// ---- how many more of one figure than another
function moreAnswer(f, q) {
  const [a, b] = [Number(f.first), Number(f.second)];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const has = (v) =>
    new RegExp('(^|[^\\d.])' + String(v).replace('.', '\\.') + '($|[^\\d])').test(String(q).replace(/,(?=\d{3})/g, ''));
  if (!has(a) || !has(b)) return null;
  return String(Math.round((a - b) * 1e6) / 1e6);
}

// ---- does the argument hold: statements of all, no, some, and of one named thing
// kinds are told apart as words without their plural; an argument holds where no world makes every premise so and the
// conclusion not. Worlds of up to four things are tried, each thing of any mix of the kinds.
const kindOf = (x) =>
  low(x)
    .replace(/^(?:an?|the) /, '')
    .replace(/(?:es|s)$/, '')
    .replace(/e$/, ''); // (tovers, tover -> tover; daxes, daxe, dax -> dax: one word however it is ended)
function validAnswer(f, q) {
  const all = [...(f.premises || []), f.conclusion].filter(Boolean);
  if ((f.premises || []).length < 1 || !f.conclusion || all.length > clausesOf(q)) return null;
  const kinds = [];
  const ones = [];
  const st = [];
  for (const s of all) {
    const single = s.says === 'is' || s.says === 'isNot';
    if (!['all', 'no', 'some', 'someNot', 'is', 'isNot'].includes(s.says)) return null;
    if (![s.subject, s.predicate].every((w) => /^(?:an? |the )?[A-Za-z'-]+$/.test(String(w ?? '').trim()))) return null;
    if (!begins(q, single ? s.subject : kindOf(s.subject)) || !begins(q, kindOf(s.predicate))) return null;
    // (a name is one thing, not a kind: "no Esme are wugs" was not read from the text)
    if (
      !single &&
      /^[A-Z][a-z]+$/.test(String(s.subject).trim()) &&
      new RegExp('\\b' + String(s.subject).trim() + ' is\\b').test(q)
    )
      return null;
    const p = kindOf(s.predicate);
    if (!kinds.includes(p)) kinds.push(p);
    let a;
    if (single) {
      a = low(s.subject);
      if (!ones.includes(a)) ones.push(a);
    } else {
      a = kindOf(s.subject);
      if (!kinds.includes(a)) kinds.push(a);
    }
    st.push({ says: s.says, a, p });
  }
  if (kinds.length > 5 || ones.length > 3) return null;
  const K = kinds.length;
  const size = Math.min(4, ones.length + all.filter((s) => /^some/.test(s.says)).length + 1);
  const holds = (s, world) => {
    const bit = 1 << kinds.indexOf(s.p);
    if (s.says === 'is') return !!(world[ones.indexOf(s.a)] & bit);
    if (s.says === 'isNot') return !(world[ones.indexOf(s.a)] & bit);
    const abit = 1 << kinds.indexOf(s.a);
    const of = world.filter((t) => t & abit);
    if (s.says === 'all') return of.every((t) => t & bit);
    if (s.says === 'no') return of.every((t) => !(t & bit));
    if (s.says === 'some') return of.some((t) => t & bit);
    return of.some((t) => !(t & bit));
  };
  const prem = st.slice(0, -1);
  const concl = st[st.length - 1];
  // (the conclusion written among the premises: a reading that took the last statement twice)
  if (prem.some((s) => s.says === concl.says && s.a === concl.a && s.p === concl.p)) return null;
  for (let d = Math.max(1, ones.length); d <= size; d++) {
    const world = new Array(d).fill(0);
    const total = (1 << K) ** d;
    for (let code = 0; code < total; code++) {
      let c = code;
      for (let i = 0; i < d; i++) {
        world[i] = c % (1 << K);
        c = Math.floor(c / (1 << K));
      }
      if (prem.every((s) => holds(s, world)) && !holds(concl, world)) return 'invalid';
    }
  }
  return 'valid';
}

// ---- a number, and what is done to it in turn
function numberAnswer(f, q) {
  let v = Number(f.start);
  if (!Number.isFinite(v) || !Array.isArray(f.steps) || !f.steps.length || f.steps.length > clausesOf(q)) return null;
  const has = (n) =>
    new RegExp('(^|[^\\d.])' + String(Math.abs(n)).replace('.', '\\.') + '($|[^\\d])').test(
      String(q).replace(/,(?=\d{3})/g, ''),
    );
  if (!has(v)) return null;
  for (const s of f.steps) {
    const by = Number(s.by);
    // (a figure of the question; or one a word of it stands for: doubled, trebled, halved, quartered)
    const worded =
      (by === 2 && /\b(?:doubl|twice|halv|half)/i.test(q)) ||
      (by === 3 && /\b(?:trebl|tripl|thrice|third)/i.test(q)) ||
      (by === 4 && /\b(?:quadrupl|quarter)/i.test(q));
    if (!Number.isFinite(by) || !(has(by) || worded)) return null;
    if (s.do === 'add') v += by;
    else if (s.do === 'subtract') v -= by;
    else if (s.do === 'multiply') v *= by;
    else if (s.do === 'divide') {
      if (by === 0) return null;
      v /= by;
    } else return null;
  }
  return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : null;
}

// ---- a day of the week, so many days or weeks on or back
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function weekdayAnswer(f, q) {
  const at = DAYS.indexOf(low(f.today));
  const amount = Number(f.amount);
  if (at < 0 || !Number.isInteger(amount) || amount < 0 || !within(q, f.today)) return null;
  const sign = f.direction === 'back' ? -1 : f.direction === 'on' ? 1 : 0;
  if (!sign || (f.unit !== 'day' && f.unit !== 'week')) return null;
  const day = DAYS[(((at + sign * amount * (f.unit === 'week' ? 7 : 1)) % 7) + 7) % 7];
  const name = day[0].toUpperCase() + day.slice(1);
  const options = optionsOf(q);
  return options.length ? letterOf(options, (text) => low(text) === day) : name;
}

// ---- how many times a letter stands in a word
function lettersAnswer(f, q) {
  const word = String(f.word || '');
  const letter = String(f.letter || '');
  if (!/^[A-Za-z]+$/.test(word) || !/^[A-Za-z]$/.test(letter) || !within(q, word)) return null;
  // (the letter has to be named in the question by itself: in quotes, or as a word of one letter)
  if (!new RegExp('(^|[^A-Za-z])' + letter + '($|[^A-Za-z])', 'i').test(String(q))) return null;
  return String([...word.toLowerCase()].filter((c) => c === letter.toLowerCase()).length);
}

// ---- how many whole numbers of a stretch can be divided by one
function rangeAnswer(f, q) {
  const [a, b, k] = [Number(f.from), Number(f.to), Number(f.dividedBy)];
  if (![a, b, k].every(Number.isInteger) || k < 1 || b < a || b - a > 1e7) return null;
  const has = (n) => new RegExp('(^|[^\\d.])' + Math.abs(n) + '($|[^\\d])').test(String(q).replace(/,(?=\d{3})/g, ''));
  if (![a, b, k].every(has)) return null;
  const lo = f.ends === 'neither' || f.ends === 'last' ? a + 1 : a;
  const hi = f.ends === 'neither' || f.ends === 'first' ? b - 1 : b;
  if (!['both', 'neither', 'first', 'last'].includes(f.ends) || hi < lo) return null;
  return String(Math.floor(hi / k) - Math.floor((lo - 1) / k));
}

const statement = obj({ says: one('all', 'no', 'some', 'someNot', 'is', 'isNot'), subject: str, predicate: str });
export const FORMS = {
  lies: {
    label: 'people who always tell the truth or always lie, and what they say of each other',
    example: {
      question: 'Tom never lies. Sue says Tom is a liar. Rob says Sue is honest. Is Rob honest?',
      form: {
        statements: [
          { speaker: '', about: 'Tom', says: 'tellsTruth' },
          { speaker: 'Sue', about: 'Tom', says: 'lies' },
          { speaker: 'Rob', about: 'Sue', says: 'tellsTruth' },
        ],
        asked: 'Rob',
        askedWhether: 'truthful',
      },
    },
    cue: (q) => /\b(?:truth|truthful|lies|lying|liar|honest)\b/i.test(q),
    about:
      'People who each either always tell the truth or always lie. "statements": one for each sentence of the text, in order, copied as the sentence has it: about is the person the sentence is about, says is "tellsTruth" or "lies", and speaker is the person who says so, or "" where the text itself says so with nobody speaking. Do not add a statement the text does not make and do not work out who tells the truth. "asked": the person the question asks about. "askedWhether": "truthful" where it asks whether that person tells the truth, "lies" where it asks whether that person lies.',
    schema: obj({
      statements: arr(obj({ speaker: str, about: str, says: one('tellsTruth', 'lies') })),
      asked: str,
      askedWhether: one('truthful', 'lies'),
    }),
    answer: liesAnswer,
  },
  word: {
    label: 'one word, and things done to its letters one after another',
    example: {
      question: 'Start from "garden". Put it backwards, then cut the first two letters. What do you have?',
      form: {
        word: 'garden',
        steps: [
          { do: 'reverse', count: 1 },
          { do: 'removeFirst', count: 2 },
        ],
      },
    },
    cue: (q) => /\bword\b/i.test(q) && /["“'‘][A-Za-z]+["”'’]/.test(q),
    about:
      'A word and things done to it one after another. "word": the word, as written. "steps": each thing done, in the order it is done: do is "reverse" (letters in opposite order), "capitals" (all capital letters), "small" (all small letters), "removeFirst" or "removeLast" (letters taken off the start or the end; count says how many), "double" (the word written twice). count is 1 where no number applies.',
    schema: obj({
      word: str,
      steps: arr(obj({ do: one('reverse', 'capitals', 'small', 'removeFirst', 'removeLast', 'double'), count: int })),
    }),
    answer: wordAnswer,
  },
  row: {
    label:
      'objects standing side by side on a shelf or in a line, with left and right, and which object is at some position',
    example: {
      question:
        'Three cups stand in a line: a blue cup, a white cup and a pink cup. The pink cup is at the far left. The white cup is right of the blue cup. Which cup is in the middle?',
      form: {
        items: ['blue cup', 'white cup', 'pink cup'],
        facts: [
          { thing: 'pink cup', is: 'place', other: '', place: 1, from: 'left' },
          { thing: 'white cup', is: 'rightOf', other: 'blue cup', place: 0, from: 'left' },
        ],
        asked: { place: 2, from: 'left' },
      },
    },
    cue: (q) =>
      /\b(?:left|right|leftmost|rightmost)\b/i.test(q) && /\b(?:row|line|shelf|order|arranged|side by side)\b/i.test(q),
    about:
      'Things standing in a row from left to right. "items": every thing in the row, each named as the text names it (for example "red book"). "facts": each thing the text says about where a thing stands: is "leftOf" (thing is somewhere to the left of other), "rightOf" (thing is somewhere to the right of other), or "place" (thing stands at a counted place: place 1 from "left" is the leftmost, place 1 from "right" is the rightmost, place 3 from "left" is the third from the left). Where is is "place", other is "". Where is is "leftOf" or "rightOf", place is 0 and from is "left". "asked": the place the question asks about, counted the same way.',
    schema: obj({
      items: arr(str),
      facts: arr(
        obj({ thing: str, is: one('leftOf', 'rightOf', 'place'), other: str, place: int, from: one('left', 'right') }),
      ),
      asked: obj({ place: int, from: one('left', 'right') }),
    }),
    answer: rowAnswer,
  },
  date: {
    label: 'a date, and the date some days, weeks, months or years before or after it',
    example: {
      question: 'It is 03/05/2021 (month/day/year). What was the date 3 weeks earlier?',
      form: { today: { year: 2021, month: 3, day: 5 }, amount: 3, unit: 'week', direction: 'back' },
    },
    cue: (q) => /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(q) && /\b(?:days?|weeks?|months?|years?)\b/i.test(q),
    about:
      'A date and a length of time from it. "today": the date the text starts from, as numbers (mind whether it is written month/day/year or day/month/year). "amount" and "unit": the length of time. "direction": "back" where the date asked for is earlier (ago, before, earlier), "on" where it is later (from now, later, after).',
    schema: obj({
      today: obj({ year: int, month: int, day: int }),
      amount: int,
      unit: one('day', 'week', 'month', 'year'),
      direction: one('back', 'on'),
    }),
    answer: dateAnswer,
  },
  free: {
    label: 'the hours of one day of a person, and when they were free to go somewhere',
    example: {
      question:
        'Sam got up at 6am. Sam was seen at the gym from 6am to 9am and at work from 11am to 5pm. The shop shut at 5pm. When could Sam have visited the shop?',
      form: {
        awakeFrom: '6am',
        seen: [
          { from: '6am', to: '9am' },
          { from: '11am', to: '5pm' },
        ],
        closedAfter: '5pm',
      },
    },
    cue: (q) => /\b\d{1,2}\s?(?:am|pm)\b/i.test(q) && /\b(?:saw|seen|spotted|noticed|closed|closes)\b/i.test(q),
    about:
      'A person\'s day, and when they could have gone somewhere. "awakeFrom": the time they woke up. "seen": each stretch of time they were seen somewhere else, with the time it began (from) and ended (to). "closedAfter": the time after which the place was closed. Write each time as the text does, like "5am" or "2pm".',
    schema: obj({ awakeFrom: str, seen: arr(obj({ from: str, to: str })), closedAfter: str }),
    answer: freeAnswer,
  },
  order: {
    label:
      'people or things compared by a measure (who is taller, older, heavier than whom), and who is the tallest, shortest, oldest',
    example: {
      question: 'Pat is older than Lee. Kim is younger than Lee. Who is the youngest?',
      form: {
        comparisons: [
          { a: 'Pat', is: 'more', b: 'Lee' },
          { a: 'Kim', is: 'less', b: 'Lee' },
        ],
        asked: { rank: 1, from: 'least' },
      },
    },
    cue: (q) =>
      /\b(?:\w+er than|tall|taller|tallest|short|shorter|shortest|height|stature|older|younger|oldest|youngest|heavier|lighter)\b/i.test(
        q,
      ),
    about:
      'People or things compared two at a time by one measure (height, age, weight, speed, price). "comparisons": one for each sentence that compares two, in order, copied as the sentence has it: a is the one named first, b the one named second, and is says whether a has "more" of the measure than b (taller, older, heavier, exceeds, towers over, above) or "less" (shorter, younger, lighter, falls short of, below, less tall). "asked": which one the question wants: rank 1 from "greatest" is the tallest (oldest, heaviest), rank 2 from "greatest" the second tallest, rank 1 from "least" the shortest (youngest, lightest).',
    schema: obj({
      comparisons: arr(obj({ a: str, is: one('more', 'less'), b: str })),
      asked: obj({ rank: int, from: one('greatest', 'least') }),
    }),
    answer: orderAnswer,
  },
  more: {
    unsure: true,
    label: 'a text of many figures, and how many more one of them is than another',
    example: {
      question:
        'Ann baked 12 pies on Monday and 30 on Tuesday. Bo baked 7 on Monday and 9 on Tuesday. How many more pies did Ann bake on Tuesday than on Monday?',
      form: { first: 30, second: 12 },
    },
    cue: (q) => /\bhow (?:many|much) (?:more|fewer|less)\b/i.test(q) && (String(q).match(/\d+/g) || []).length >= 4,
    about:
      'A text full of figures, and a question asking how many more one thing is than another. "first": the figure of the thing asked about first (how many more did X ...). "second": the figure it is compared with (... than Y). Copy both figures from the text exactly; do not work anything out.',
    schema: obj({ first: { type: 'number' }, second: { type: 'number' } }),
    answer: moreAnswer,
  },
  valid: {
    label: 'an argument of statements with all, no, some, and whether its conclusion follows',
    example: {
      question: 'All cats are pets. Tim is a cat. So Tim is a pet. Does that follow?',
      form: {
        premises: [
          { says: 'all', subject: 'cats', predicate: 'pets' },
          { says: 'is', subject: 'Tim', predicate: 'cat' },
        ],
        conclusion: { says: 'is', subject: 'Tim', predicate: 'pet' },
      },
    },
    cue: (q) =>
      /\b(?:valid|invalid|follows?)\b/i.test(q) && /\b(?:therefore|so|hence|thus|conclusion|argument)\b/i.test(q),
    about:
      'An argument: statements given, and one drawn from them. "premises": each statement given, in order. "conclusion": the statement drawn from them (after therefore, so, hence). Each statement: says is "all" (all subject are predicate), "no" (no subject are predicate), "some" (some subject are predicate), "someNot" (some subject are not predicate), "is" (one named thing is a predicate) or "isNot" (one named thing is not a predicate). subject and predicate are the words as the text writes them.',
    schema: obj({ premises: arr(statement), conclusion: statement }),
    answer: validAnswer,
  },
  number: {
    label: 'a number, and sums done to it one after another (add, subtract, multiply, divide)',
    example: {
      question: 'Begin at 12. Take away 5, then times it by 3. What have you got?',
      form: {
        start: 12,
        steps: [
          { do: 'subtract', by: 5 },
          { do: 'multiply', by: 3 },
        ],
      },
    },
    cue: (q) =>
      /\b(?:start|begin)\w* (?:with|at|from) -?\d/i.test(q) &&
      /\b(?:multiply|add|subtract|divide|times|plus|minus)\b/i.test(q),
    about:
      'A number and things done to it one after another. "start": the number begun with. "steps": each thing done, in the order it is done: do is "add", "subtract", "multiply" or "divide", and by is the number it is done with, copied from the text. Do not work anything out.',
    schema: obj({
      start: { type: 'number' },
      steps: arr(obj({ do: one('add', 'subtract', 'multiply', 'divide'), by: { type: 'number' } })),
    }),
    answer: numberAnswer,
  },
  weekday: {
    label: 'a day of the week, and the day of the week some days or weeks before or after it',
    example: {
      question: 'It is Tuesday. Which day of the week was it 10 days ago?',
      form: { today: 'Tuesday', amount: 10, unit: 'day', direction: 'back' },
    },
    cue: (q) =>
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(q) &&
      /\b(?:days?|weeks?)\b/i.test(q) &&
      !/\d\/\d/.test(q),
    about:
      'A day of the week and a length of time from it. "today": the day of the week the text starts from. "amount" and "unit": the length of time, copied from the text. "direction": "back" where the day asked for is earlier (ago, before, earlier), "on" where it is later (from now, later, after).',
    schema: obj({
      today: one('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
      amount: int,
      unit: one('day', 'week'),
      direction: one('back', 'on'),
    }),
    answer: weekdayAnswer,
  },
  letters: {
    label: 'one word, and how many times one letter stands in it',
    example: {
      question: 'Count the letter "s" in "mississippi". How many are there?',
      form: { word: 'mississippi', letter: 's' },
    },
    cue: (q) => /\bletter\b/i.test(q) && /\bhow many\b|\bcount\b/i.test(q) && /["“'‘][A-Za-z]+["”'’]/.test(q),
    about:
      'A word and one letter to count in it. "word": the word, as written. "letter": the one letter that is counted.',
    schema: obj({ word: str, letter: { type: 'string', maxLength: 1 } }),
    answer: lettersAnswer,
  },
  range: {
    label: 'a stretch of whole numbers, and how many of them can be divided by a given number',
    example: {
      question: 'Between 10 and 40, including both, how many whole numbers are multiples of 6?',
      form: { from: 10, to: 40, ends: 'both', dividedBy: 6 },
    },
    cue: (q) =>
      /\bhow many\b/i.test(q) &&
      /\b(?:whole numbers|integers|numbers)\b/i.test(q) &&
      /\b(?:divi\w+|multiples?)\b/i.test(q),
    about:
      'A stretch of whole numbers and a number to divide by. "from" and "to": the first and the last number of the stretch, copied from the text. "ends": "both" where both of them are counted (inclusive, counting both ends), "neither" where neither is (strictly between), "first" or "last" where only that one is. "dividedBy": the number they must be divisible by.',
    schema: obj({ from: int, to: int, ends: one('both', 'neither', 'first', 'last'), dividedBy: int }),
    answer: rangeAnswer,
  },
};
export const FORM_IDS = Object.keys(FORMS);
// A READING TRAINING WROTE (plan.readings; training/write-reading.mjs): a kind of question laid onto one of the forms above.
// The form's fields and the code that works it out are the form's own; what is written for the kind is how a model is told to
// fill it: one line saying what the kind is, what goes in each field for this kind, and one worked example.
//   { id, form, label, about, example: { question, form } }
// None is trusted: one is kept only where it names a form there is, its texts are of a size, and its own example is worked out
// by the form's code. Twelve at most.
export const READINGS_MOST = 12;
export function readingsIn(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (out.length >= READINGS_MOST) break;
    if (!r || typeof r !== 'object' || !/^[a-z][a-z0-9-]{1,40}$/.test(String(r.id || ''))) continue;
    if (FORMS[r.id] || out.some((o) => o.id === r.id) || !FORMS[r.form]) continue;
    const text = (v, most) => typeof v === 'string' && v.trim().length > 0 && v.length <= most;
    if (!text(r.label, 200) || !text(r.about, 1500) || !r.example || !text(r.example.question, 1500)) continue;
    if (!r.example.form || typeof r.example.form !== 'object') continue;
    let own = null;
    try {
      own = FORMS[r.form].answer(r.example.form, r.example.question);
    } catch {
      own = null;
    }
    if (own === null || own === undefined || own === '') continue;
    out.push({ id: r.id, form: r.form, label: r.label.trim(), about: r.about.trim(), example: r.example });
  }
  return out;
}
// THE FORMS AND THE READINGS TOGETHER, as one table: what every function below reads. With no readings it is FORMS itself
export function formsWith(readings) {
  const kept = readingsIn(readings);
  if (!kept.length) return FORMS;
  const T = { ...FORMS };
  for (const r of kept) T[r.id] = { ...FORMS[r.form], ...r, cue: () => false, unsure: false, reading: true };
  return T;
}
// THE FORMS THAT ARE ON: the ones named; or, for `true`, every one that has been read reliably. A form marked `unsure` is on
// only where it is named: of how many more one figure is than another, both a small and a large reader took the two figures
// the wrong way round too often (measured 2026-11-25, on questions no form was mended against: 9 right of 16 answered).
// A reading training kept is on wherever it is in the table: it was kept for this class.
export const formsOn = (on, T = FORMS) =>
  Object.keys(T).filter((id) => T[id].reading || (on === true ? !T[id].unsure : Array.isArray(on) && on.includes(id)));
// THE FORMS A QUESTION MIGHT BE OF, by a few of its words, among the ones that are on
export const formsFor = (question, on = true, T = FORMS) =>
  formsOn(on, T).filter((id) => T[id].cue(String(question || '')));
// THE FORMS TO TRY, in turn: the one a model named, then the ones a few words of the question point to, then the ones often
// taken for the one named (things in a row, and things in order of a measure). Three at most: each costs its readings
const NEAR = {
  row: ['order'],
  order: ['row'],
  date: ['free', 'weekday'],
  free: ['date'],
  weekday: ['date'],
  word: ['letters'],
  letters: ['word'],
};
export const formsToTry = (question, named, on = true, T = FORMS) => {
  const cued = formsFor(question, on, T);
  const all = [named, ...cued, ...(NEAR[named] || [])];
  // (a form both named, or near the one named, and pointed to by the words comes first)
  const both = cued.filter((id) => id === named || (NEAR[named] || []).includes(id));
  return [...new Set([...both, ...all])].filter((id) => formsOn(on, T).includes(id)).slice(0, 3);
};
// WHAT A MODEL IS ASKED, to fill a form: it reads, it does not answer
export const formAsk = (id, question, T = FORMS) => [
  {
    role: 'system',
    content:
      'You read a question and write down what it says, as JSON. You do not answer the question and you do not work anything out. Write only what the text states, in the words of the text.\n\n' +
      T[id].about,
  },
  { role: 'user', content: T[id].example.question },
  { role: 'assistant', content: JSON.stringify(T[id].example.form) },
  { role: 'user', content: String(question).trim() },
];
// WHICH FORM, IF ANY: told by a model too, since a cue of words is a wording. It is shown what each form is of and answers
// with one name, or none
export const routeAsk = (question, on = true, T = FORMS) => [
  {
    role: 'system',
    content:
      'You are shown a question. Say which ONE of these kinds it is, or "none" where it is none of them. Do not answer the question.\n' +
      formsOn(on, T)
        .map((id) => '- ' + id + ': ' + T[id].label + '. Such as: ' + T[id].example.question)
        .join('\n') +
      '\n- none: anything else\nReply as JSON: {"about": "<what the question is about, in a few words>", "kind": "<one of the names>"}',
  },
  { role: 'user', content: String(question).trim() },
];
export const routeParams = (on = true, T = FORMS) => ({
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'kind',
      strict: true,
      schema: obj({ about: { type: 'string', maxLength: 90 }, kind: one(...formsOn(on, T), 'none') }),
    },
  },
});
export const routeIn = (text, on = true, T = FORMS) => {
  const k = (formIn(text) || {}).kind;
  return formsOn(on, T).includes(k) ? k : null;
};
// (what an engine that holds a reply to a schema is sent beside the messages; one that does not is told by the ask alone)
export const formParams = (id, T = FORMS) => ({
  response_format: { type: 'json_schema', json_schema: { name: id, strict: true, schema: T[id].schema } },
});
// A REPLY -> the form in it, or null
export function formIn(text) {
  const t = String(text || '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const f = JSON.parse(t.slice(a, b + 1));
    return f && typeof f === 'object' && !Array.isArray(f) ? f : null;
  } catch {
    return null;
  }
}
// ONE REPLY, worked out: the form in it, by the code of its form; null where there is none or it settles nothing
export function formWorked(id, question, reply, T = FORMS) {
  const f = formIn(reply);
  try {
    const v = f && T[id] ? T[id].answer(f, String(question)) : null;
    return v === undefined || v === '' ? null : v;
  } catch {
    return null;
  }
}
// HOW MANY READINGS ARE STILL WORTH ASKING, given the ones in hand: none where `least` of them already agree with none
// differing, where two differ, or where even all the rest agreeing could not reach `least`; else the rest
export function readingsLeft(id, question, replies, many, least = 2, T = FORMS) {
  const said = replies.map((r) => formWorked(id, question, r, T)).filter((x) => x !== null);
  if (new Set(said).size > 1 || said.length >= least) return 0;
  const left = many - replies.length;
  return said.length + left >= least ? left : 0;
}
// THE ANSWER OF SEVERAL READINGS: each reply is read as a form and worked out; an answer stands only where at least `least`
// readings came to it and none came to another. -> { answer, agreed, of } or null
export function formAnswer(id, question, replies, least = 2, T = FORMS) {
  const said = replies.map((r) => formWorked(id, question, r, T)).filter((x) => x !== null);
  if (said.length < least || new Set(said).size !== 1) return null;
  return { answer: said[0], agreed: said.length, of: replies.length };
}
