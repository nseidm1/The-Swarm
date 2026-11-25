// tasks-later.mjs - KINDS OF QUESTION ADDED AFTER PASSES HAD BEEN MEASURED. A kind's questions are seeded by where the kind
// stands among all kinds (tasks.mjs ALL), so these stand LAST: no earlier kind's questions change by one letter, and a test
// holds that. And a class's figures are told twice from the day one is added (equivalence.json `since`; classes.mjs
// figuresOf `earlier`): of every kind, and of the kinds as they were, so that a figure of an earlier pass is still set
// beside one of its own measure.
// Each has an answer its maker works out, and is a thing code can work out whole (src/forms.mjs track, path).
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
const THINGS = ['red ball', 'blue ball', 'green ball', 'yellow ball', 'white ball', 'black ball', 'pink ball'];
export const LATER_KINDS = {
  // who holds what after things have changed hands: one slip and the answer is another
  swap(t) {
    const n = t.int(3, 5);
    const who = t.mix(NAMES).slice(0, n);
    const things = t.mix(THINGS).slice(0, n);
    const has = [...things];
    const start = `${who.map((w, i) => `${w} has the ${things[i]}`).join(', ')}.`;
    const said = [];
    for (let i = 0; i < t.int(3, 5); i++) {
      const [a, b] = t.mix([...Array(n).keys()]).slice(0, 2);
      said.push(`${i ? 'Then ' : ''}${who[a]} and ${who[b]} swap.`);
      [has[a], has[b]] = [has[b], has[a]];
    }
    const k = t.int(0, n - 1);
    const byThing = t.pick([true, false]);
    return byThing
      ? {
          ask: `${start} ${said.join(' ')} Who has the ${things[k]} now?`,
          again: `Who has the ${things[k]} at the end? At the start: ${start} ${said.join(' ')}`,
          want: who[has.indexOf(things[k])],
          among: who,
        }
      : {
          ask: `${start} ${said.join(' ')} What does ${who[k]} have now?`,
          again: `What does ${who[k]} have at the end? At the start: ${start} ${said.join(' ')}`,
          want: has[k].replace(' ball', ''),
          among: things.map((x) => x.replace(' ball', '')),
        };
  },
  // steps and turns, and whether they lead back to where they began
  path(t) {
    const dir = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let face = 0;
    let x = 0;
    let y = 0;
    const said = [];
    const go = (steps) => {
      said.push(`Take ${steps} step${steps === 1 ? '' : 's'} forward.`);
      x += dir[face][0] * steps;
      y += dir[face][1] * steps;
    };
    const turn = (how) => {
      said.push(how === 1 ? 'Turn right.' : how === 3 ? 'Turn left.' : 'Turn around.');
      face = (face + how) % 4;
    };
    const a = t.int(1, 9);
    const b = t.int(1, 9);
    // (half of them come back: out, across, back across, and home; the others miss by a length or by a wrong turn)
    const home = t.pick([true, false]);
    const miss = home ? '' : t.pick(['across', 'home', 'turn']);
    go(a);
    turn(t.pick([1, 3]));
    go(b);
    turn(2);
    go(miss === 'across' ? b + t.int(1, 3) : b);
    const toSouth = (2 - face + 4) % 4; // (the turn that faces the way home)
    turn(miss === 'turn' ? (toSouth === 1 ? 3 : 1) : toSouth);
    go(miss === 'home' ? a + t.int(1, 3) : a);
    const back = x === 0 && y === 0;
    return {
      ask: `You start at a point, facing north. ${said.join(' ')} Are you back at the point you started from? Answer Yes or No.`,
      again: `Answer Yes or No: are you back where you started? You start at a point, facing north. ${said.join(' ')}`,
      want: back ? 'Yes' : 'No',
      among: ['Yes', 'No'],
    };
  },
};
export const LATER_KIND_NAMES = Object.keys(LATER_KINDS);
