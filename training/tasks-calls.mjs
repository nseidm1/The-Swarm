// tasks-calls.mjs - CALLING A FUNCTION, OR NOT. A model with tools is offered a set of functions and a request. The step it takes is
// what is graded: the call the request needs, with the arguments the request gives; no call at all where the request needs none;
// two calls where it needs two; and a question back where an argument is missing that only the person knows. Calling functions is
// a capability a SwOA proves on an established test (docs/swoa-parity.md: the battery); these are training's own questions of
// that family, each with the step it needs (needs), so that an answer is graded against the question and not against a model.
// Made from a seed. Every argument a call needs is said outright in the request, in the form the function asks for it.
//   CALL_KINDS.calls(t, i) -> { type: 'tool', mode: 'agent', system, turns, tools, ask, again: null, needs }
const fn = (name, about, props, required) => ({
  type: 'function',
  function: { name, description: about, parameters: { type: 'object', properties: props, required } },
});
export const CALL_SYSTEM =
  'You are an assistant with tools. Call a tool when the request needs it, with the arguments the request gives. Where something ' +
  'a tool needs is missing and only the person knows it, ask for it. Otherwise answer in plain words.';
export const CALL_TOOLS = [
  fn(
    'get_weather',
    'The weather in a city on a day',
    {
      city: { type: 'string' },
      date: { type: 'string', description: 'the day, as YYYY-MM-DD' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    ['city', 'date', 'unit'],
  ),
  fn(
    'convert_currency',
    'Convert an amount of money from one currency to another',
    {
      amount: { type: 'number' },
      from: { type: 'string', description: 'three-letter code, such as USD' },
      to: { type: 'string', description: 'three-letter code, such as EUR' },
    },
    ['amount', 'from', 'to'],
  ),
  fn(
    'add_reminder',
    'Add a reminder for a day',
    { text: { type: 'string' }, date: { type: 'string', description: 'the day, as YYYY-MM-DD' } },
    ['text', 'date'],
  ),
  fn('find_contact', "Look up a person's details by name", { name: { type: 'string' } }, ['name']),
];
const CITIES = ['Lisbon', 'Toronto', 'Nairobi', 'Osaka', 'Bergen', 'Lima'];
const MONEY = [
  ['USD', 'EUR'],
  ['GBP', 'JPY'],
  ['CAD', 'USD'],
  ['EUR', 'GBP'],
];
const PEOPLE = ['Priya Nair', 'Tomasz Zielinski', 'Aiko Mori', 'Daniel Okafor'];
const CHORES = ['renew the passport', 'pay the rent', 'call the dentist', 'water the plants'];
const NONE = [
  'What does ETA stand for?',
  'Thanks, that is everything for now.',
  'Is a tomato a fruit or a vegetable?',
  'How many days are there in a leap year?',
];
const turn = (content, needs) => ({
  type: 'tool',
  mode: 'agent',
  system: CALL_SYSTEM,
  turns: [{ role: 'user', content }],
  tools: CALL_TOOLS,
  ask: content,
  again: null,
  needs,
});

export const CALL_KINDS = {
  calls(t, i) {
    const city = t.pick(CITIES);
    const date = '2027-0' + t.int(1, 9) + '-' + String(t.int(10, 28));
    const unit = t.pick(['celsius', 'fahrenheit']);
    const [from, to] = t.pick(MONEY);
    const amount = t.int(2, 90) * 10;
    const person = t.pick(PEOPLE);
    const chore = t.pick(CHORES);
    const S = [
      // the request needs one function, and gives everything it takes
      () =>
        turn('What will the weather be in ' + city + ' on ' + date + ', in ' + unit + '?', {
          calls: [{ name: 'get_weather', args: { city, date, unit } }],
        }),
      // it needs none of them: a reply, and no call
      () => turn(t.pick(NONE), { reply: true }),
      // it needs two: both calls, in the order asked
      () =>
        turn('Convert ' + amount + ' ' + from + ' to ' + to + ', and look up the details for ' + person + '.', {
          calls: [
            { name: 'convert_currency', args: { amount, from, to } },
            { name: 'find_contact', args: { name: person } },
          ],
        }),
      // an argument is missing that only the person knows (the day): a question back, not a call with a guess in it
      () => turn('Add a reminder to ' + chore + '.', { reply: true, asks: true }),
      // another single call, of another function
      () =>
        turn('How much is ' + amount + ' ' + from + ' in ' + to + '?', {
          calls: [{ name: 'convert_currency', args: { amount, from, to } }],
        }),
      // and one whose arguments are all there: the call, not a question back
      () =>
        turn('Add a reminder to ' + chore + ' on ' + date + '.', {
          calls: [{ name: 'add_reminder', args: { text: chore, date } }],
        }),
    ];
    return S[i % S.length]();
  },
};
export const CALL_KIND_NAMES = Object.keys(CALL_KINDS);
