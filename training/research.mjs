// research.mjs - WHAT HAS BEEN PUBLISHED SINCE THE LAST PASS, ON WHAT THE LAST PASS LEFT OPEN. Asks arXiv's public API the
// questions in state.json (the standing ones, and those the last pass's weak kinds added), keeps only papers no pass has seen,
// and writes them where the next step reads them:
//   .work/research/pass-<n>.json     every new abstract
//   training/research.md             a section for this pass: the new papers by question, to be read and marked
// Only titles and abstracts are read, one request every three seconds, as arXiv asks. An abstract says what a paper claims, not
// how well it holds: nothing here changes the swarm. A reading becomes an IDEA (a candidate brief for a slot, with the paper it
// came from), and an idea changes the swarm only if improve.mjs keeps it.
//   node training/research.mjs                              search, and write the section
//   node training/research.mjs --teacher claude --spend-claude    also let a large model turn the abstracts into candidate briefs
//   node training/research.mjs --idea 2402.05120 --slot a-critic --name "..." --brief "..."    a person's reading, entered
//                              (--plan '{"onePerAnswer":true}' for a change to the plan in place of, or with, a brief)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { arg, has, REPO_ROOT } from './support/bench.mjs';
import { readState, writeState, candHash } from './state.mjs';
import { readBriefs } from '../src/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (xml, tag) => (new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(xml) || [])[1] || '';
const state = readState();
const briefs = readBriefs();
const candFile = (slot) => path.join(REPO_ROOT, 'training', 'candidates', slot + '.json');

// an idea is a candidate brief for a slot, with where it came from; it goes where improve.mjs finds candidates
export function addIdea(state, { from, slot, name, brief, plan }) {
  if (!briefs.slots.find((s) => s.id === slot)) return 'no slot called ' + slot;
  if (!brief && !plan) return 'neither a brief nor a change to the plan';
  const hash = candHash({ brief, plan });
  if ((state.tried[slot] || []).includes(hash) || state.ideas.find((i) => i.hash === hash)) return 'already known';
  const file = candFile(slot);
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  list.push({ name: String(name).slice(0, 60), from, ...(brief ? { brief } : {}), ...(plan ? { plan } : {}) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  state.ideas.push({ pass: state.pass + 1, from, slot, name: String(name).slice(0, 60), hash, status: 'open' });
  return '';
}

if (import.meta.url === 'file://' + process.argv[1]) {
  if (arg('idea')) {
    const why = addIdea(state, {
      from: arg('idea'),
      slot: arg('slot', ''),
      name: arg('name', 'from ' + arg('idea')),
      brief: arg('brief', ''),
      plan: arg('plan') ? JSON.parse(arg('plan')) : undefined,
    });
    if (!why) writeState(state);
    console.log(why ? 'Not added: ' + why : 'Added as a candidate for ' + arg('slot') + '.');
    process.exit(why ? 2 : 0);
  }
  const pass = state.pass + 1;
  const found = [];
  for (const q of state.questions) {
    const url =
      'https://export.arxiv.org/api/query?search_query=' +
      encodeURIComponent(q) +
      '&start=0&max_results=' +
      Number(arg('max', 8)) +
      '&sortBy=submittedDate&sortOrder=descending';
    let xml = '';
    try {
      xml = await (
        await fetch(url, {
          headers: { 'user-agent': 'FamilyOffice-TheSwarm-training/1 (https://github.com/nseidm1/The-Swarm)' },
        })
      ).text();
    } catch (e) {
      console.log('FAILED ' + q + ': ' + String(e.message || e));
    }
    let fresh = 0;
    for (const e of xml.split('<entry>').slice(1)) {
      const id = pick(e, 'id')
        .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
        .replace(/v\d+$/, '')
        .trim();
      if (!id || state.seen.includes(id) || found.find((f) => f.id === id)) continue;
      fresh++;
      found.push({
        query: q,
        id,
        date: pick(e, 'published').slice(0, 10),
        title: pick(e, 'title').replace(/\s+/g, ' ').trim(),
        abstract: pick(e, 'summary').replace(/\s+/g, ' ').trim(),
      });
    }
    console.log(String(fresh).padStart(2) + ' new  ' + q);
    await sleep(3200);
  }
  const out = path.join(REPO_ROOT, '.work', 'research');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pass-' + pass + '.json'), JSON.stringify(found, null, 1));
  // the section a reader marks
  const md = path.join(REPO_ROOT, 'training', 'research.md');
  const first = (s) => (s.match(/^.*?[.!?](?=\s|$)/) || [s])[0].slice(0, 260);
  let section =
    '\n## Pass ' +
    pass +
    ' (' +
    new Date().toISOString().slice(0, 10) +
    ')\n\n' +
    state.questions.length +
    ' searches, ' +
    found.length +
    ' abstracts no pass had seen. Unread until marked.\n';
  for (const q of state.questions) {
    const of = found.filter((f) => f.query === q);
    if (!of.length) continue;
    section += '\n`' + q + '`\n\n| Paper | What its abstract claims | Status |\n|---|---|---|\n';
    for (const f of of)
      section +=
        '| ' +
        f.title.replace(/\|/g, '/') +
        ' ([' +
        f.id +
        '](https://arxiv.org/abs/' +
        f.id +
        '), ' +
        f.date +
        ') | ' +
        first(f.abstract).replace(/\|/g, '/') +
        ' | unread |\n';
  }
  if (found.length) fs.appendFileSync(md, section);
  state.seen.push(...found.map((f) => f.id));

  // a large model reads the abstracts and proposes briefs: each is only a candidate, and names the paper it came from
  let added = 0;
  if (arg('teacher') === 'claude' && found.length) {
    if (!has('spend-claude'))
      console.log('A teacher spends on the Claude plan of this machine. Say --spend-claude to allow it.');
    else {
      const ask =
        'Eight roles, filled by two small language models (2 to 3 billion parameters), answer reasoning questions together: four draft, two check the drafts, one decides, one writes the reply. ' +
        'Each role is told one short brief. The roles and their briefs:\n' +
        JSON.stringify(
          briefs.slots.map((s) => ({ slot: s.id, stage: s.stage, brief: s.brief })),
          null,
          1,
        ) +
        '\n\nThe roles doing worst, worst first: ' +
        (state.order.join(', ') || 'not yet measured') +
        '\nKinds of question the group trails a much larger model on: ' +
        (Object.keys(state.focus).join(', ') || 'not yet measured') +
        '\n\nHere are abstracts of recent papers:\n' +
        JSON.stringify(
          found.slice(0, 40).map((f) => ({ id: f.id, title: f.title, abstract: f.abstract.slice(0, 900) })),
          null,
          1,
        ) +
        '\n\nFrom these, propose at most six changes, each a replacement brief for ONE role that applies a method one of the papers describes. Each brief: plain instructions a small model can follow, under 110 words, general, and (except for the role in the write stage) ending with the rule that the last line starts with ANSWER: and holds only the answer. ' +
        'Only propose what an abstract actually supports. Reply with JSON only: [{"from":"<arxiv id>","slot":"<slot>","name":"<the method, in a few words>","brief":"..."}]';
      try {
        const got = execFileSync('claude', ['-p', '--model', arg('claude-model', 'claude-sonnet-5-5'), ask], {
          encoding: 'utf8',
          timeout: 300000,
          maxBuffer: 8 * 2 ** 20,
        });
        for (const i of JSON.parse(got.slice(got.indexOf('['), got.lastIndexOf(']') + 1)))
          if (
            i &&
            found.find((f) => f.id === i.from) &&
            typeof i.brief === 'string' &&
            i.brief.length > 40 &&
            !addIdea(state, i)
          )
            added++;
      } catch (e) {
        console.log('The teacher gave nothing usable: ' + String(e.message).slice(0, 160));
      }
    }
  }
  writeState(state);
  console.log(
    found.length +
      ' new abstracts -> .work/research/pass-' +
      pass +
      '.json and training/research.md' +
      (added ? '; ' + added + ' ideas added as candidates' : ''),
  );
}
