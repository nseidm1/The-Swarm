// target.mjs - THE LARGER MODEL THE SWARM IS BROUGHT LEVEL WITH. The swarm is never called good by its own account: it is put
// beside a much larger model on the same questions, and trained until it is not behind. Then a larger one is named, and it starts
// again. The models to climb are in targets.json, smallest first; the one being chased is in state.json.
// A rung says how its model is served: a program and its arguments, with {port} where the port goes. Anything that then answers
// /v1/chat/completions at that port will do (TensorFold, llama.cpp, any other), or a rung may name an address already running
// ("base": "http://...").
//   const t = await openTarget();   t.ask(messages) -> { text }   await t.stop();
//   node training/target.mjs            which rung is being chased, and whether it can be served here
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, readTargets, targetOf } from './state.mjs';
import { modelFile } from '../src/members.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((ok, no) => {
    const s = net.createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
const up = async (base) => {
  try {
    return (await fetch(base + '/v1/models', { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};
// the program that serves a rung: named outright (SWARM_TARGET_PROGRAM), in a folder the rung names (serve.where, with ~ for the
// home folder: an engine often installs itself in a folder of its own that is on no PATH), or on the PATH
export function programOf(rung) {
  if (!rung.serve) return '';
  if (process.env.SWARM_TARGET_PROGRAM)
    return fs.existsSync(process.env.SWARM_TARGET_PROGRAM) ? process.env.SWARM_TARGET_PROGRAM : '';
  for (const dir of rung.serve.where || []) {
    const file = path.join(dir.replace(/^~(?=\/|$)/, os.homedir()), rung.serve.program);
    if (fs.existsSync(file)) return file;
  }
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', [rung.serve.program], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return '';
  }
}

// how a rung is served: a GGUF file by llama.cpp (the larger model is given the whole of one server: one slot, a wide context,
// and its own flags), anything else by the program it names
export function servingOf(rung, { llamaServer = '', modelsDir = '' } = {}) {
  if (rung.engine !== 'llama')
    return rung.serve
      ? {
          program: programOf(rung),
          args: rung.serve.args,
          missing:
            rung.serve.program + ' is not on this machine' + (rung.needs ? ' (it needs ' + rung.needs + ')' : ''),
        }
      : { program: '', args: [], missing: 'the rung names no way to serve it' };
  const file = modelFile(rung, modelsDir);
  return {
    program: file ? llamaServer : '',
    args: [
      '-m',
      file,
      '--host',
      '127.0.0.1',
      '--port',
      '{port}',
      '-c',
      '16384',
      '-np',
      '1',
      '-a',
      'target',
      '--jinja', // (a step in an agent's work is asked with tools)
      ...(rung.serve || []),
    ],
    missing: !file
      ? rung.file + ' is not here: node training/setup.mjs fetches it'
      : 'no llama-server program was found',
  };
}
// THE LARGER MODEL, AND ITS WAYS BACK. It is one model held for a whole step, on a machine that is also holding others:
//   its server stops or hangs      it is started again and the question is asked again (twice at most for one question)
//   its reply holds nothing        (it ran on into unknown tokens from the start, or said nothing) it is asked again with another
//                                  draw (a little temperature, another seed), twice; a reply with something in it is kept as it
//                                  came, and a question it still says nothing to is left for the trainer to leave out
// Each is told to onRecover, so it is on the record.
export async function openTarget(
  rung = targetOf(),
  { waitMs = 15 * 60000, onLine = () => {}, onRecover = () => {}, llamaServer = '', modelsDir = '' } = {},
) {
  const fixed = rung.base || process.env.SWARM_TARGET_BASE || '';
  let base = fixed;
  let child = null;
  // flags the model is better served with but can be served without (rung.serve.optional): dropped if its server does not know them
  const dropped = new Set();
  const start = async () => {
    const how = servingOf(rung, { llamaServer, modelsDir });
    const program = how.program;
    if (!program) throw new Error(rung.name + ' cannot be served here: ' + how.missing);
    const port = await freePort();
    const at = 'http://127.0.0.1:' + port;
    const tail = [];
    let exited = null;
    const c = spawn(
      program,
      how.args.filter((a) => !dropped.has(a)).map((a) => String(a).replace('{port}', String(port))),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const take = (x) =>
      String(x)
        .split(/[\r\n]+/)
        .filter((l) => l.trim())
        .forEach((l) => {
          tail.push(l.trim());
          if (tail.length > 8) tail.shift();
          onLine(l.trim());
        });
    c.stdout.on('data', take);
    c.stderr.on('data', take);
    c.on('error', (e) => (exited = { why: e.message }));
    c.on('close', (code) => (exited = exited || { why: 'exit ' + code + ': ' + tail.slice(-3).join(' / ') }));
    const t0 = Date.now();
    while (!exited && Date.now() - t0 < waitMs && !(await up(at))) await sleep(700);
    if (exited || !(await up(at))) {
      try {
        c.kill();
      } catch {
        /* gone */
      }
      throw new Error(
        rung.name +
          ' did not start: ' +
          (exited ? exited.why : 'no answer within ' + Math.round(waitMs / 60000) + ' minutes'),
      );
    }
    child = c;
    base = at;
  };
  const halt = () => {
    if (child)
      try {
        child.kill();
      } catch {
        /* gone */
      }
    child = null;
  };
  if (!fixed) {
    try {
      await start();
    } catch (e) {
      const why = String(e.message);
      const optional = ((rung.serve && rung.serve.optional) || []).filter((f) => !dropped.has(f));
      if (
        optional.length &&
        /unknown|unrecogni[sz]ed|unexpected argument|no such option|invalid option|usage:/i.test(why)
      ) {
        // an older engine that does not know a flag: served without it, and that is said
        for (const f of optional) dropped.add(f);
        onRecover(rung.name, 'its server does not know ' + optional.join(' ') + ': started without', {
          kind: 'flag',
          why,
        });
      } else {
        // once more, after a moment: a port taken in between, memory another model had not yet given back
        onRecover(rung.name, 'it would not start: tried once more', { kind: 'start', why });
        await sleep(4000);
      }
      await start();
    }
  }
  const once = async (messages, maxTokens, draw, tools) => {
    const r = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(300000),
      body: JSON.stringify({
        model: rung.model || 'target',
        messages,
        max_tokens: maxTokens,
        temperature: draw ? 0.4 : 0,
        ...(draw ? { seed: 1000 + draw } : {}),
        stream: false,
        stop: ['<unk>'], // some servers run on into <unk> after the answer has ended: stopped there
        ...(tools ? { tools } : {}),
      }),
    });
    if (!r.ok) throw new Error(rung.name + ' answered ' + r.status + ': ' + (await r.text()).slice(0, 160));
    const j = await r.json();
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    // a step in an agent's work: its calls, written down as the swarm's are (src/tools.mjs actionText)
    if (tools && Array.isArray(m.tool_calls) && m.tool_calls.length)
      return m.tool_calls
        .map((c) => 'CALL ' + ((c.function || {}).name || '') + ' ' + ((c.function || {}).arguments || '{}'))
        .join('\n');
    // and anything of it that still gets through is cut
    return String(m.content || '')
      .replace(/(?:<unk>\s*)+[\s\S]*$/, '')
      .trim();
  };
  return {
    rung,
    get base() {
      return base;
    },
    // asked as plainly as a model can be asked: the question, and nothing of the swarm's own.
    // usable(text): does the reply hold an answer? Where the trainer can say (a function that runs, a value), a reply that does
    // not is asked for again the same way an empty one is.
    async ask(messages, { maxTokens = 4096, usable = (t) => t.length > 0, tools = null } = {}) {
      let text = '';
      let first = '';
      let revived = 0;
      let waited = 0;
      for (let draw = 0; draw <= 2; draw++) {
        try {
          text = await once(messages, maxTokens, draw, tools);
        } catch (e) {
          const why = String((e && e.message) || e);
          // THE SERVER SAYS IT IS BUSY PUTTING ITSELF RIGHT (TensorFold: 500 "server restarting: retry shortly"; any server:
          // 503 while a model loads). It is still there: waited for, and asked again, the same way. Not a reason to start another.
          if (/server restarting|retry shortly|answered 503|loading model|model is loading/i.test(why) && waited < 40) {
            if (!waited)
              onRecover(rung.name, 'its server said it was restarting: waited, and asked again', { kind: 'busy', why });
            waited++;
            await sleep(3000);
            draw--;
            continue;
          }
          if (
            fixed ||
            revived >= 2 ||
            !/ECONNREFUSED|ECONNRESET|fetch failed|socket|terminated|timed? ?out|Timeout|abort/i.test(why)
          )
            throw e;
          revived++;
          halt();
          await start();
          onRecover(rung.name, 'its server was gone or hung: started again, and asked again', { kind: 'gone', why });
          draw--;
          continue;
        }
        if (draw === 0) first = text;
        if (usable(text)) return { text, draws: draw + 1 };
        if (draw < 2)
          onRecover(rung.name, 'its reply held no answer: asked again with another draw', { kind: 'empty' });
      }
      // none of the draws held an answer: what it said when asked plainly is what is kept, to be read; it is not a mark
      return { text: first, draws: 3, usable: false };
    },
    stop: halt,
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const state = readState();
  const now = targetOf(state);
  // where the engine and the model files are, as the trainers find them (not imported from them: they import this file)
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  let engine = process.env.SWARM_LLAMA_SERVER || '';
  if (!engine)
    try {
      engine = execFileSync('which', ['llama-server'], { encoding: 'utf8' }).trim();
    } catch {
      try {
        engine = fs.readFileSync(path.join(root, '.work', 'engine', 'path'), 'utf8').trim();
      } catch {
        engine = '';
      }
    }
  const modelsDir = process.env.SWARM_MODELS_DIR || path.join(root, '.work', 'models');
  for (const t of readTargets()) {
    const how = servingOf(t, { llamaServer: engine, modelsDir });
    console.log(
      (t.id === now.id ? 'chasing  ' : '         ') +
        t.name.padEnd(30) +
        String(t.params).padStart(4) +
        'B  ' +
        (how.program ? 'can be served here' : how.missing),
    );
  }
  const won = (state.history || []).filter((h) => h.level).map((h) => h.target);
  if (won.length) console.log('at parity with: ' + [...new Set(won)].join(', '));
}
