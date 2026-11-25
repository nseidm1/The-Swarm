// write-reading.mjs - TRAINING LAYS A KIND OF QUESTION ONTO A FORM THE MODULE SHIPS. A form (src/forms.mjs) is fields that say
// what a question states, and code that works the answer out from them; the module ships a set of them. A kind of question the
// class is short on may be one a shipped form can record, worded as nobody foresaw: people compared by age are an ordering, a
// queue is a row. So the larger model is shown some of training's questions of the kind and asked two things, each held to a
// schema: WHICH form, if any; then, for that form, how a model is to be told to fill it for this kind (one line of what the
// kind is, what goes in each field, one worked example). That is a READING ({ id, form, label, about, example }).
// It writes no code: the form's own code works the answer out. And none of it is trusted:
//   the reading's own example must be worked out by the form's code;
//   the larger model then fills the form, as the reading says, for questions of the kind it was NOT shown, and the answers
//   the form's code gives are graded: one wrong answer refuses it, and so do too few right.
// Refused, it is asked again and told what went wrong. A reading kept here is a candidate, no more: the class stage tries it
// on train questions and keeps it on held ones, read by the swarm's own models (training/classes.mjs).
import { FORMS, formIn, formsOn, readingsIn, formsWith, formAsk } from '../src/forms.mjs';

const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (max) => ({ type: 'string', maxLength: max });
const held = (name, schema) => ({
  response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
});
const shownText = (shown) =>
  shown.map((t, i) => 'Question ' + (i + 1) + ':\n' + t.ask + '\nRight answer: ' + t.want).join('\n\n');
// THE FORMS A READING MAY BE LAID ONTO: every form the module ships (the one read unreliably included: a reading is vetted)
export const FORMS_FOR_READING = Object.keys(FORMS);

// 1  WHICH FORM
export const pickAsk = (shown, forms = FORMS_FOR_READING) => [
  {
    role: 'user',
    content:
      'A program can work out the answer to a question once what the question states has been written into a FORM. These are the forms there are, each with what it holds and one question with its form:\n\n' +
      forms
        .map(
          (id) =>
            '- ' +
            id +
            ': ' +
            FORMS[id].label +
            '\n  fields: ' +
            FORMS[id].about +
            '\n  question: ' +
            FORMS[id].example.question +
            '\n  form: ' +
            JSON.stringify(FORMS[id].example.form),
        )
        .join('\n') +
      '\n\nBelow are questions of ONE kind, each with its right answer. Which form can record what such a question states, so that the program for that form works the right answer out? The questions may be about something else than the form\'s own example (ages instead of heights, a queue instead of a shelf): what matters is whether the same facts fit the fields. Say "none" where no form fits.\n\n' +
      shownText(shown) +
      '\n\nReply as JSON: {"why": "<one sentence>", "form": "<one of the names, or none>"}',
  },
];
export const pickFormat = (forms = FORMS_FOR_READING) =>
  held('pick', obj({ why: str(240), form: { type: 'string', enum: [...forms, 'none'] } }));
export const pickIn = (reply, forms = FORMS_FOR_READING) => {
  const f = (formIn(reply) || {}).form;
  return forms.includes(f) ? f : null;
};

// 2  HOW IT IS FILLED, for this kind
export const readingAsk = (form, shown, told = '') => [
  {
    role: 'user',
    content:
      'A small language model will read questions of one kind and write what each states into this form; a program then works the answer out. The small model cannot work the questions out, but it can copy down what they say.\n\n' +
      'The form "' +
      form +
      '": ' +
      FORMS[form].label +
      '\nIts fields, as they were described for the kind of question it was first made for:\n' +
      FORMS[form].about +
      '\nA question of that first kind: ' +
      FORMS[form].example.question +
      '\nIts form: ' +
      JSON.stringify(FORMS[form].example.form) +
      '\n\nWrite how the small model is to fill this same form for the kind of question below:\n' +
      '- "label": one line saying what this kind of question is, so that it can be told from other kinds;\n' +
      '- "about": what goes in each field FOR THIS KIND, in the words these questions use (which words mean which fixed value), under 150 words. It must tell the model to copy what the text states and work nothing out;\n' +
      '- "example": one question of this kind that you make up, worded differently from the ones shown, and its form filled in rightly.\n\n' +
      shownText(shown) +
      told +
      '\n\nReply as JSON: {"label": "...", "about": "...", "example": {"question": "...", "form": {...}}}',
  },
];
export const readingFormat = (form) =>
  held(
    'reading',
    obj({ label: str(200), about: str(1400), example: obj({ question: str(1200), form: FORMS[form].schema }) }),
  );

// A READING, VETTED: fill(reading, question) -> a reply (the larger model, told as the reading says); the form's code works it out
export async function vetReading(reading, tasks, fill, { least = 0.7 } = {}) {
  const T = formsWith([reading]);
  if (!T[reading.id])
    return {
      ok: false,
      why: "the example you gave is not worked out by the form's program: it gives no answer for the form you filled",
    };
  let right = 0;
  let nulls = 0;
  let wrong = null;
  for (const t of tasks) {
    const reply = await fill(reading, t.ask);
    let got = null;
    try {
      const f = formIn(reply);
      got = f ? T[reading.id].answer(f, t.ask) : null;
    } catch {
      got = null;
    }
    if (got === null || got === undefined || got === '') {
      nulls++;
      continue;
    }
    if ((await t.good(String(got))).grade === 'right') right++;
    else wrong = wrong || { ask: t.ask, form: formIn(reply), got, want: t.want };
  }
  const n = tasks.length;
  const said = { right, nulls, wrong: n - right - nulls, n };
  if (wrong)
    return {
      ok: false,
      ...said,
      why:
        'filled as you described, the form gave a wrong answer for a question you were not shown.\nThe question:\n' +
        wrong.ask +
        '\nThe form filled:\n' +
        JSON.stringify(wrong.form) +
        '\nThe program gave: ' +
        wrong.got +
        '\nThe right answer: ' +
        wrong.want,
    };
  if (right < Math.ceil(least * n))
    return {
      ok: false,
      ...said,
      why:
        'filled as you described, the form gave no answer for ' + nulls + ' of ' + n + ' questions you were not shown',
    };
  return { ok: true, ...said };
}
// (how the larger model fills a form as a reading says: the same messages a slot of the swarm is sent)
export const fillAsk = (reading, question) => formAsk(reading.id, question, formsWith([reading]));
export const fillFormat = (reading) => held('form', FORMS[reading.form].schema);

// ONE KIND, start to finish. ask(messages, { maxTokens, format }) -> text (the larger model).
//   -> { ok, reading, form, tries: [{ form, why, right, wrong, nulls }] }  |  { ok: false, why, tries }
export async function writeReadingFor({ kind, shown, unseen, ask, tries = 3, forms = FORMS_FOR_READING, id }) {
  const out = { ok: false, kind, tries: [] };
  const picked = pickIn(await ask(pickAsk(shown, forms), { maxTokens: 400, format: pickFormat(forms) }), forms);
  out.form = picked;
  if (!picked) return { ...out, why: 'no form was said to fit' };
  let told = '';
  for (let n = 0; n < tries; n++) {
    const reply = await ask(readingAsk(picked, shown, told), { maxTokens: 1800, format: readingFormat(picked) });
    const r = formIn(reply) || {};
    const reading = {
      id:
        id ||
        String(kind)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') +
          '-as-' +
          picked,
      form: picked,
      label: r.label,
      about: r.about,
      example: r.example,
    };
    const tr = { form: picked };
    out.tries.push(tr);
    let v;
    if (!readingsIn([reading]).length)
      v = {
        ok: false,
        why: "the reply could not be read as a reading, or its own example is not worked out by the form's program (the form you filled for your example question gives no answer)",
      };
    else
      v = await vetReading(reading, unseen, async (rd, q) =>
        ask(fillAsk(rd, q), { maxTokens: 1200, format: fillFormat(rd) }),
      );
    Object.assign(tr, {
      ok: v.ok,
      right: v.right,
      wrong: v.wrong,
      nulls: v.nulls,
      why: v.ok ? '' : String(v.why).slice(0, 500),
    });
    if (v.ok) return { ...out, ok: true, reading: readingsIn([reading])[0] };
    told =
      '\n\nWhat you wrote before was refused: ' +
      v.why +
      '\nYour "about" then was: ' +
      String(r.about || '').slice(0, 600) +
      '\nWrite it again so that this does not happen.';
  }
  return { ...out, why: (out.tries.at(-1) || {}).why || 'refused' };
}
export { formsOn };
