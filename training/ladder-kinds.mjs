// ladder-kinds.mjs - KINDS OF QUESTION NO FORM WAS MADE FOR, for the ladder (training/ladder.mjs) to ask a writer to lay onto a
// form the module ships. Each is a thing one of the forms can record, about something else than the form's own questions: ages
// where the form speaks of heights, a queue where it speaks of a shelf. Made from a seed, each with the answer its maker worked
// out. They are asked of the writer only: the swarm is never trained on them, and no benchmark is read to make them.
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const NAMES = [
  'Ada',
  'Ben',
  'Cleo',
  'Dev',
  'Esme',
  'Finn',
  'Gia',
  'Hugo',
  'Ines',
  'Jon',
  'Kai',
  'Lena',
  'Milo',
  'Nora',
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const tools = (r) => ({
  int: (a, b) => a + Math.floor(r() * (b - a + 1)),
  pick: (list) => list[Math.floor(r() * list.length)],
  mix: (list) => {
    const x = [...list];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  },
});
const two = (v) => String(v).padStart(2, '0');
export const LADDER_KINDS = {
  // an ordering, by age: the form `order` (people compared by a measure)
  ages(t) {
    const who = t.mix(NAMES).slice(0, t.int(4, 5)); // youngest first
    const said = [];
    for (const i of t.mix(who.slice(1).map((_, k) => k)))
      said.push(
        t.pick([true, false]) ? `${who[i + 1]} was born before ${who[i]}.` : `${who[i]} was born after ${who[i + 1]}.`,
      );
    const ask = t.pick(['oldest', 'youngest', 'second oldest']);
    const n = who.length;
    return {
      ask: `${said.join(' ')} Who is the ${ask}?`,
      want: ask === 'oldest' ? who[n - 1] : ask === 'youngest' ? who[0] : who[n - 2],
      fits: 'order',
    };
  },
  // a row, as a queue: the form `row` (front is one end)
  queue(t) {
    const who = t.mix(NAMES).slice(0, 4); // front first
    const said = [
      `${who[1]} is directly behind ${who[0]}.`,
      `${who[3]} is somewhere behind ${who[2]}.`,
      `${who[0]} is at the front.`,
      `${who[2]} is third from the front.`,
    ];
    const k = t.int(1, 3);
    return {
      ask: `Four people are waiting in a queue: ${t.mix(who).join(', ')}. ${t.mix(said).join(' ')} Who is ${['second from the front', 'third from the front', 'at the back'][k - 1]}?`,
      want: who[k],
      fits: 'row',
    };
  },
  // a number and what is done to it, as money in an account: the form `number`
  account(t) {
    let v = t.int(40, 400);
    const said = [`An account holds ${v} dollars.`];
    for (let i = 0; i < t.int(3, 4); i++) {
      const how = t.pick(['in', 'out', 'double', 'treble']);
      const by = t.int(5, 60);
      if (how === 'in') (said.push(`${by} dollars are paid in.`), (v += by));
      else if (how === 'out') (said.push(`${by} dollars are taken out.`), (v -= by));
      else if (how === 'double') (said.push('The balance is doubled.'), (v *= 2));
      else (said.push('The balance is trebled.'), (v *= 3));
    }
    return { ask: `${said.join(' ')} How many dollars does the account hold now?`, want: String(v), fits: 'number' };
  },
  // a day of the week, as a meeting moved: the form `weekday`
  moved(t) {
    const at = t.int(0, 6);
    const n = t.int(3, 60);
    const back = t.pick([true, false]);
    return {
      ask: `A meeting was set for a ${DAYS[at]}. It has been moved ${n} days ${back ? 'earlier' : 'later'}. On which day of the week is it now?`,
      want: DAYS[(((at + (back ? -n : n)) % 7) + 7) % 7],
      fits: 'weekday',
    };
  },
  // who tells the truth, as machines that report: the form `lies`
  units(t) {
    const who = t.mix(['Unit A', 'Unit B', 'Unit C', 'Unit D', 'Unit E', 'Unit F']).slice(0, t.int(3, 5));
    let ok = t.pick([true, false]);
    const said = [`${who[0]} ${ok ? 'always reports correctly' : 'always reports wrongly'}.`];
    for (let i = 1; i < who.length; i++) {
      const claims = t.pick([true, false]);
      said.push(`${who[i]} reports that ${who[i - 1]} ${claims ? 'reports correctly' : 'reports wrongly'}.`);
      ok = claims === ok;
    }
    return {
      ask: `Each unit either always reports correctly or always reports wrongly. ${said.join(' ')} Does ${who[who.length - 1]} report correctly? Answer Yes or No.`,
      want: ok ? 'Yes' : 'No',
      fits: 'lies',
    };
  },
  // a date so long on, as a book that is due: the form `date`
  due(t) {
    const y = t.int(2015, 2024);
    const m = t.int(1, 12);
    const d = t.int(1, 28);
    const weeks = t.int(1, 6);
    const then = new Date(Date.UTC(y, m - 1, d) + weeks * 7 * 86400000);
    return {
      ask: `A book was borrowed on ${two(m)}/${two(d)}/${y} (month/day/year) and is due back ${weeks} week${weeks === 1 ? '' : 's'} after that. On what date is it due? Give it as month/day/year.`,
      want: `${two(then.getUTCMonth() + 1)}/${two(then.getUTCDate())}/${then.getUTCFullYear()}`,
      fits: 'date',
    };
  },
};
export const LADDER_KIND_NAMES = Object.keys(LADDER_KINDS);
// n questions of a kind, from a seed: { id, kind, ask, want, fits, good }
export function ladderTasks(kind, n = 14, seed = 4099) {
  const r = rng(seed + LADDER_KIND_NAMES.indexOf(kind) * 977);
  const t = tools(r);
  const out = [];
  for (let i = 0; i < n; i++) {
    const made = LADDER_KINDS[kind](t);
    const want = String(made.want);
    out.push({
      id: 'ladder-' + kind + '-' + (i + 1),
      kind,
      type: 'value',
      ...made,
      want,
      good: async (reply) => ({
        grade:
          String(reply ?? '')
            .trim()
            .toLowerCase()
            .replace(/[.!]$/, '') === want.toLowerCase()
            ? 'right'
            : 'wrong',
      }),
    });
  }
  return out;
}
