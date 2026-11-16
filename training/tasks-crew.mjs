// tasks-crew.mjs - THE WORK OF A SEAT ON A TEAM. The swarm is to sit where one model sits in The Crew: a person writes to a team in
// a chat, and a seat answers them as a person would. Most of that work is not programming. It is understanding what the person
// meant and what they want it for, and replying to that: an everyday question answered outright, a thing the team cannot do
// for them (book, buy, send) pointed the way to and never claimed, a request with something missing asked about in one short
// message, a piece of writing handed over ready to send, a hello or a thank-you met in kind, an engineer's question of good
// practice answered outright, and their own code spoken of only as far as it was shown.
// So these questions are conversations, in the shape a seat is given one: a system line (who is speaking, to whom, what the seat
// can and cannot do, how the reply is to be shaped) and the turns so far. Two modes, as the product has:
//   simple      the person is not a developer            answer  request  piece  talk
//   developer   the person's project is software         practice  shown
// What it means for two replies to be equivalent is in support/equivalent.mjs (talkEquivalent): they understand the message the
// same way and do the same thing for the person, and the swarm's reply breaks no convention of the conversation that the larger
// model's kept.
// Every question is made from a seed, and the held questions are made from other requests than the train ones: nothing a brief
// was chosen on is ever what is reported.
//   kind(t, i) -> { type: 'talk', mode, kind, system, turns: [{ role, content }], ask (the last message), again (the same request
//                   put another way, or null), limit (the words the reply was asked to keep to), claims (may it be read for
//                   having claimed to do a thing in the world?) }

const SEATS = ['Alex', 'Robin', 'Pat', 'Sam', 'Jo'];
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// how the reply is to be shaped: said last, as a seat is told it
const SIMPLE = (seat, shape, limit) =>
  'You are ' +
  seat +
  ', one of a small team of helpers in a group chat with one person. The person is not a developer: use everyday words, never ' +
  'the words of the software trade. You can explain, advise and write things for them. You cannot book, buy, pay, sign in, ' +
  'send or cancel anything for anyone, and you never say that you did: you tell them where or how they do it themselves. ' +
  'In this turn nothing has been looked up: answer from what you know, and say plainly where a thing would need checking.' +
  '\n\nYOUR REPLY: ' +
  shape +
  ' At most ' +
  limit +
  ' words.';
const DEVELOPER = (seat, limit, ticket = '') =>
  'You are ' +
  seat +
  ", an engineer on a small software team, talking in the team's chat with the person whose project it is." +
  (ticket ? '\n\nA ticket is attached to this chat:\n' + ticket : '') +
  '\n\nYOUR REPLY: begin with the thing itself (the answer, where to look, or what you decided), then why. A question of good ' +
  'practice is answered outright. Only what is in their own code, logs or settings has to have been shown to you: of that, say ' +
  'what you would look at, never what is there or what caused something. At most ' +
  limit +
  ' words; a list only for commands.';

const SHAPE = {
  answer:
    'open with the answer itself. Do not open with a remark about the question, and do not answer with a question.',
  request:
    'if you cannot help without one thing only the person knows, ask for that one thing in one short message and nothing ' +
    'else. Otherwise open with what they should do.',
  piece: 'give the finished piece itself, ready to send, and nothing before or after it.',
  hello: 'say hello back in a few words, and ask what they need. Nothing else.',
  thanks: 'a few warm words and nothing else.',
  heavy: 'one kind sentence first, then real help with what they asked.',
  chat: 'answer as a person in a group chat would, briefly.',
};

// HOW PEOPLE WRITE. The same request, as four people would type it: nothing of what is asked changes.
const WAYS = [
  (q) => q,
  (q) => 'hey quick one, ' + low(q).replace(/[.]$/, ''),
  (q) => 'Good afternoon. I wonder whether you could help me with something. ' + q,
  (q) => 'in a rush sorry - ' + low(q),
];
// the same request put a second way (the reworded questions): how it is led into changes, and nothing of what is asked
const AGAIN = {
  answer: (q) => 'Something I have been meaning to ask the team. ' + q,
  request: (q) => 'Could one of you help me with this? ' + q,
  piece: (q) => 'I need a hand with a bit of writing. ' + q,
  practice: (q) => 'A question about how we ought to work. ' + q,
  shown: (q) => 'Could you look at something with me? ' + q,
};

// ---- what people ask for. Each list is in two halves: the train questions are made from one, the held questions from the other.
const CITIES = ['Lisbon', 'Leeds', 'Denver', 'Galway', 'Toronto', 'Bristol', 'Perth', 'Austin'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NAMES = ['Maya', 'Tom', 'Priya', 'Daniel', 'Ines', 'Callum', 'Noor', 'Greta'];

const ANSWER = {
  train: [
    { q: 'Can a rabbit eat celery?' },
    { q: 'How long do I boil an egg so the yolk is still runny?' },
    { q: 'Is it all right to put a cast iron pan in the dishwasher?' },
    { q: 'How often should I water a snake plant?' },
    { q: 'What is the difference between baking soda and baking powder?' },
    {
      q: 'Can I freeze cooked rice?',
      then: [
        'Yes. Cool it quickly, within an hour, then freeze it in a sealed bag or box. It keeps for about a month.',
        'and how do I warm it up again safely?',
      ],
    },
  ],
  held: [
    { q: 'Can dogs eat grapes?' },
    { q: 'How long should I let a steak rest after cooking it?' },
    { q: 'Is it safe to leave a phone charging overnight?' },
    { q: 'How do I get red wine out of a carpet?' },
    { q: 'Do I need to rinse rice before I cook it?' },
    {
      q: 'How long does an opened jar of pasta sauce keep in the fridge?',
      then: [
        'About five to seven days, with the lid on. If it smells off or has mould, throw it away.',
        'what if I freeze it?',
      ],
    },
  ],
};

// a thing the team cannot do for them (cannot), or a request with the one thing missing that only they know (missing)
const REQUEST = {
  train: [
    { q: (p) => `Book me a table for ${p.n} at a good Italian place in ${p.city} this ${p.day} at ${p.hour}pm.` },
    { q: () => 'Can you find me a dentist?' },
    { q: (p) => `Buy two tickets for the science museum in ${p.city} for ${p.day}.` },
    { q: () => 'What time is my train?' },
    { q: (p) => `Cancel my gym membership. It is the gym on the high street in ${p.city}.` },
    { q: () => 'Write to my sister for me.' },
  ],
  held: [
    { q: (p) => `Order me a taxi to the airport for ${p.hour} tomorrow morning. I am in ${p.city}.` },
    { q: () => 'Is it going to rain at the weekend?' },
    { q: (p) => `Send my landlord a message saying the heating has been off since ${p.day}.` },
    { q: () => 'How much is the bus fare?' },
    { q: (p) => `Reserve a room for ${p.n} nights in ${p.city} from ${p.day}, somewhere quiet.` },
    { q: () => 'When does the shop shut?' },
  ],
};

const PIECE = {
  train: [
    {
      q: (p) =>
        `Write a short note to my landlord. The boiler has been broken since ${p.day}, I would like it fixed this week, and I am home after ${p.hour}pm.`,
    },
    {
      q: (p) =>
        `Write a text to ${p.name} to cancel dinner on ${p.day}. I have a bad cold. Suggest the week after instead.`,
    },
    { q: (p) => `Write two sentences to thank ${p.name} for the cookbook they gave me for my birthday.` },
    {
      q: (p) =>
        `Write a message to my son's teacher. He will be off school on ${p.day} morning for a dentist appointment and back after lunch.`,
    },
  ],
  held: [
    {
      q: (p) =>
        `Write a note for my neighbour at number ${p.n + 10}. A parcel of mine was left with them by mistake, and I would like to collect it this evening after ${p.hour}.`,
    },
    {
      q: (p) =>
        `Write a message to my manager. My train was cancelled, I will be about ${p.n * 10} minutes late, and I will join the ${p.hour + 3} o'clock meeting from my phone.`,
    },
    {
      q: (p) =>
        `Write a polite reply turning down ${p.name}'s wedding invitation. We are away that weekend. Wish them well.`,
    },
    {
      q: (p) =>
        `Write a short review for a plumber called ${p.name} who fixed a leak under my sink the same day I rang, for a fair price.`,
    },
  ],
};

// conversation itself: a turn that asks for nothing, or that says something heavy, or that puts right what was said before
const TALK = {
  train: [
    { shape: 'hello', limit: 20, q: 'hey', alt: 'hi there' },
    {
      shape: 'thanks',
      limit: 20,
      before: [
        'How long do I roast a chicken?',
        'About 20 minutes for each 450g at 200C, plus 20 minutes more. Rest it for 15.',
      ],
      q: "thanks, that's perfect",
      alt: 'brilliant, thank you',
    },
    {
      shape: 'heavy',
      limit: 110,
      q: "My dad is in hospital and I have to sort out his bills while he is there. I don't know where to start.",
      alt: "I have to take over my dad's bills because he is in hospital, and I have no idea where to begin.",
    },
    { shape: 'chat', limit: 40, q: 'are you a real person?', alt: 'am I talking to a person or a machine?' },
    {
      shape: 'chat',
      limit: 40,
      before: [
        'Can you write a note to my landlord about the boiler?',
        'Of course. What should it say, and by when do you want it fixed?',
      ],
      q: 'sorry, ignore that. I rang him instead',
      alt: 'never mind that one, I have spoken to him on the phone now',
    },
    {
      shape: 'chat',
      limit: 40,
      before: [
        'Is it all right to wash trainers in the machine?',
        'Usually, yes: laces out, cold wash, no tumble dryer.',
      ],
      q: 'lol you lot are quick',
      alt: 'haha that was fast',
    },
  ],
  held: [
    { shape: 'hello', limit: 20, q: 'Good evening.', alt: 'Evening, all.' },
    {
      shape: 'thanks',
      limit: 20,
      before: ['Can I put wool jumpers in the tumble dryer?', 'Best not: heat shrinks wool. Dry them flat on a towel.'],
      q: 'cheers, sorted',
      alt: 'lovely, thanks for that',
    },
    {
      shape: 'heavy',
      limit: 110,
      q: 'I lost my job on Friday and I need to cut what I spend straight away. Where do I begin?',
      alt: 'I was let go on Friday. I have to spend less from today and I do not know what to look at first.',
    },
    { shape: 'chat', limit: 40, q: 'who am I talking to?', alt: 'which of you is this?' },
    {
      shape: 'chat',
      limit: 40,
      before: [
        'When should I plant tulip bulbs?',
        'In autumn, before the first hard frost. October and November are ideal.',
      ],
      q: 'wait, I meant daffodils, not tulips',
      alt: 'sorry, daffodils is what I meant to ask about',
    },
    {
      shape: 'chat',
      limit: 40,
      before: ['Do I really need to floss every day?', 'Yes, I am afraid so: once a day does the job.'],
      q: 'haha ok fair enough',
      alt: 'ha, all right then',
    },
  ],
};

const PRACTICE = {
  train: [
    'We have a flaky test. Is adding a fixed two-second sleep before the assertion a reasonable fix?',
    'Should I commit the .env file so the whole team has the same settings?',
    'Is it fine to catch every exception and just log it, so the service never crashes?',
    'We store passwords as MD5 with a salt. Is that good enough?',
    'When a payment request times out, should the client simply send the same POST again?',
    'Is it all right to force-push to main to tidy up the history?',
  ],
  held: [
    "Can I build the SQL by concatenating the user's search text if I escape the quotes myself?",
    'Our CI takes forty minutes. Should we skip the tests on small pull requests?',
    'Is keeping the session token in localStorage fine for an app that handles money?',
    'Should we pin our dependency versions, or always take the latest?',
    'We turn off TLS certificate checks in the client so staging works. Is it all right to ship that?',
    'Is a five thousand line pull request fine if it is all one feature?',
  ],
};

// their own project: something not shown (say what you would look at), something shown (it can be spoken of), a ticket attached
const SHOWN = {
  train: [
    { q: 'Why did my deploy fail last night?' },
    {
      q: "Here is the error from the browser console:\n\nTypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (list.js:14)\n\nWhat is going on?",
    },
    {
      ticket: (p) =>
        `SHOP-${p.n}41: Export to CSV drops rows that have a comma in the name\nCustomers with a comma in their company name are missing from the exported file. Seen on the Orders export.`,
      q: 'what does it need?',
      alt: 'what would it take to do it?',
    },
    { q: 'Which file is the login bug in?' },
    {
      q: 'This is in our worker:\n\n```js\nsetInterval(async () => { const jobs = await db.all(); cache.push(...jobs); }, 1000);\n```\n\nMemory keeps going up. Is this why?',
    },
    {
      ticket: (p) =>
        `APP-${p.n}07: Password reset email arrives twice\nSince the last release, asking for a password reset sends two identical emails a few seconds apart.`,
      q: 'can you take it?',
      alt: 'is that one you could pick up?',
    },
  ],
  held: [
    { q: 'What is making our home page slow?' },
    {
      q: 'The test run prints this:\n\nAssertionError: expected 3 to equal 4\n    at Context.<anonymous> (test/cart.test.js:22)\n\nWhat does it tell us?',
    },
    {
      ticket: (p) =>
        `WEB-${p.n}18: Search ignores accents\nSearching for "Jose" does not find "José". Customers expect both spellings to match.`,
      q: 'how big is it?',
      alt: 'is it a large piece of work?',
    },
    { q: 'Why are our users being logged out at random?' },
    {
      q: 'We have this in the upload handler:\n\n```js\nconst name = req.query.file;\nfs.writeFileSync("/uploads/" + name, req.body);\n```\n\nAnything wrong with it?',
    },
    {
      ticket: (p) =>
        `API-${p.n}52: Rate limit counts failed logins twice\nEvery failed login is counted as two attempts, so accounts lock after three tries and not five.`,
      q: 'where would you start?',
      alt: 'what is the first thing you would do on it?',
    },
  ],
};

// ---- the kinds
const half = (lists, t) => (t.split === 'held' ? lists.held : lists.train);
const params = (t) => ({
  n: t.int(2, 6),
  hour: t.int(6, 9),
  city: t.pick(CITIES),
  day: t.pick(DAYS),
  name: t.pick(NAMES),
});
// the turns, with the request put the way one of four people would put it (which one moves on each time round the list)
const way = (pool, i) => WAYS[(Math.floor(i / pool.length) + i) % WAYS.length];
const made = (mode, system, turns, more = {}) => ({
  type: 'talk',
  mode,
  system,
  turns,
  ask: turns[turns.length - 1].content,
  limit: Number((/At most (\d+) words/.exec(system) || [])[1]) || 0,
  claims: false,
  ...more,
});

export const CREW_KINDS = {
  // an everyday question, answered outright; sometimes a second question that only makes sense after the first
  answer(t, i) {
    const pool = half(ANSWER, t);
    const it = pool[i % pool.length];
    const seat = t.pick(SEATS);
    const sys = SIMPLE(seat, SHAPE.answer, 110);
    if (it.then && Math.floor(i / pool.length) % 2 === 0)
      return made(
        'simple',
        sys,
        [
          { role: 'user', content: it.q },
          { role: 'assistant', content: it.then[0] },
          { role: 'user', content: it.then[1] },
        ],
        { again: null, claims: true },
      );
    const q = way(pool, i)(it.q);
    return made('simple', sys, [{ role: 'user', content: q }], { again: AGAIN.answer(it.q), claims: true });
  },
  // something the team cannot do for them, or a request with the one thing missing that only they know
  request(t, i) {
    const pool = half(REQUEST, t);
    const base = pool[i % pool.length].q(params(t));
    return made('simple', SIMPLE(t.pick(SEATS), SHAPE.request, 90), [{ role: 'user', content: way(pool, i)(base) }], {
      again: AGAIN.request(base),
      claims: true,
    });
  },
  // a piece of writing, handed over ready to send (it speaks as the person, so nothing in it is the team claiming an act)
  piece(t, i) {
    const pool = half(PIECE, t);
    const q = pool[i % pool.length].q(params(t));
    return made('simple', SIMPLE(t.pick(SEATS), SHAPE.piece, 120), [{ role: 'user', content: q }], {
      again: AGAIN.piece(q),
    });
  },
  // conversation itself
  talk(t, i) {
    const pool = half(TALK, t);
    const it = pool[i % pool.length];
    const seat = t.pick(SEATS);
    const before = (it.before || []).map((content, k) => ({ role: k % 2 ? 'assistant' : 'user', content }));
    return made('simple', SIMPLE(seat, SHAPE[it.shape], it.limit), [...before, { role: 'user', content: it.q }], {
      again: it.alt || null,
      claims: true,
    });
  },
  // an engineer's question of good practice, answered outright
  practice(t, i) {
    const pool = half(PRACTICE, t);
    const base = pool[i % pool.length];
    const q = [(x) => x, (x) => 'Quick one: ' + low(x), (x) => 'I am new to this, so plain words please. ' + x][
      (Math.floor(i / pool.length) + i) % 3
    ](base);
    return made('developer', DEVELOPER(t.pick(SEATS), 110), [{ role: 'user', content: q }], {
      again: AGAIN.practice(base),
    });
  },
  // their own project: not shown, shown, or a ticket attached to the chat and spoken of as "it"
  shown(t, i) {
    const pool = half(SHOWN, t);
    const it = pool[i % pool.length];
    const p = params(t);
    return made(
      'developer',
      DEVELOPER(t.pick(SEATS), 110, it.ticket ? it.ticket(p) : ''),
      [{ role: 'user', content: it.q }],
      { again: it.ticket ? it.alt : AGAIN.shown(it.q) },
    );
  },
};
export const CREW_KIND_NAMES = Object.keys(CREW_KINDS);

// ---- QUESTIONS A PERSON WROTE (training/questions/<target>.json, edited from the page). Each is sent the way the target's own
// questions are: for The Crew, to a seat in the mode it names (the request shape, so that a seat may ask for the one thing it
// needs); for any other, with a plain instruction to answer it. A question a person wrote has no second wording.
export const PLAIN_SYSTEM =
  'Answer the question. Give the answer itself first, then as much working as it needs, and nothing after it.';
export function ownQuestion(target, q, i) {
  const seat = SEATS[i % SEATS.length];
  const ask = String(q.ask || '').trim();
  const turns = [{ role: 'user', content: ask }];
  if (target !== 'crew') return made('plain', PLAIN_SYSTEM, turns, { again: null });
  return q.mode === 'developer'
    ? made('developer', DEVELOPER(seat, 110), turns, { again: null })
    : made('simple', SIMPLE(seat, SHAPE.request, 110), turns, { again: null, claims: true });
}
