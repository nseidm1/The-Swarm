// members.mjs - THE TWO MODELS, EACH BEHIND A llama.cpp SERVER WITH SEVERAL SLOTS.
// A member is either STARTED here (a llama-server program, a model file, so many slots) or ATTACHED (a server someone else
// started, named by its address). Either way it is the same thing afterwards:
//   { key, base, slots, ask(slotNumber, messages, params) -> { text, tokens, ms }, alive(), stop() }
// and it never holds more conversations at once than it has slots: a call that finds every slot taken waits for one.
// Each slot of the plan keeps to one server slot (id_slot), so the brief it starts with is read once and remembered by the server.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { SERVING } from './catalog.mjs';
import { withoutThinking } from './read.mjs';

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

async function aliveAt(base) {
  try {
    const r = await fetch(base + '/health', { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

// so many at once, and no more: take() resolves with a free number, give() hands it back
function pool(n) {
  const free = Array.from({ length: n }, (_, i) => i);
  const waiting = [];
  let most = 0;
  return {
    take: () =>
      new Promise((ok) => {
        if (free.length) ok(free.shift());
        else waiting.push(ok);
        most = Math.max(most, n - free.length);
      }),
    give: (i) => (waiting.length ? waiting.shift()(i) : free.push(i)),
    most: () => most,
  };
}

// what opens a call to a tool, in the models that have such a thing
const TOOL_OPENERS = ['<|tool_call_start|>', '<tool_call>', '<|python_tag|>'];

// faults that mean the server is gone or hung (and so may be started again), as against a fault in what was asked
const SERVER_FAULT =
  /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|fetch failed|other side closed|terminated|timed? ?out|TimeoutError|aborted|AbortError/i;

// A member can be BROUGHT BACK. A model server on a busy machine will sometimes stop (the system took its memory) or hang. Where
// this member was started here (it has a `revive`), a call that finds the server gone or hung starts it again and asks once more;
// every slot waiting on that server shares the one revival. A member that was only attached has nobody to start it, and the
// fault is the caller's. Each revival is told to `onRecover`, so that it is on the record and not silent.
function member(m, base, slots, stop = () => {}, { revive = null, onRecover = () => {} } = {}) {
  const p = pool(slots);
  const pinned = new Map(); // a plan slot's id -> the server slot it keeps to, while that one is free
  // A MODEL TRAINED TO CALL TOOLS IS NOT LEFT ABLE TO START A CALL. Given no tools, LFM2.5 still answered a quarter of its drafts
  // with <|tool_call_start|>[...] (24 of 112 in one pass, 2026-11-15), and each was an answer lost. Telling it not to did not
  // help. So the token that opens a call is found once (the server is asked what number it is) and forbidden in every request:
  // the model cannot begin one, and writes its answer. A server that cannot say, or a model with no such token, is asked as before.
  let banned = null;
  const findBanned = async () => {
    const ids = [];
    for (const mark of TOOL_OPENERS) {
      try {
        const r = await fetch(self.base + '/tokenize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ content: mark, add_special: false, parse_special: true }),
        });
        const j = r.ok ? await r.json() : {};
        // only where the whole marker is ONE token: forbidding a piece of ordinary text would do harm
        if (Array.isArray(j.tokens) && j.tokens.length === 1 && Number.isInteger(j.tokens[0])) ids.push(j.tokens[0]);
      } catch {
        /* asked as before */
      }
    }
    return ids;
  };
  const self = {
    key: m.key,
    name: m.name,
    base,
    slots,
    revived: 0,
    busiest: () => p.most(),
    alive: () => aliveAt(self.base),
    stop: () => self.halt(),
    halt: stop,
    async ask(slotId, messages, params = {}) {
      const n = await p.take();
      const t0 = Date.now();
      try {
        if (!pinned.has(slotId)) pinned.set(slotId, pinned.size % slots);
        banned = banned || findBanned();
        const noCall = await banned;
        // A TURN WITH TOOLS (tools.mjs): the tools offered are sent, nothing is forbidden, and a call comes back as calls
        const { maxTokens = 400, signal, timeoutMs, tools, tool_choice, ...sampling } = params;
        const withTools = Array.isArray(tools) && tools.length > 0;
        const once = async () => {
          const r = await fetch(self.base + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: signal || AbortSignal.timeout(timeoutMs || 180000),
            body: JSON.stringify({
              messages,
              stream: false,
              cache_prompt: true,
              id_slot: pinned.get(slotId),
              max_tokens: maxTokens,
              ...(withTools
                ? { tools, ...(tool_choice !== undefined ? { tool_choice } : {}) }
                : noCall.length
                  ? { logit_bias: noCall.map((id) => [id, false]) }
                  : {}),
              ...m.sampling,
              ...sampling,
            }),
          });
          if (!r.ok) throw new Error(m.name + ' answered ' + r.status + ': ' + (await r.text()).slice(0, 160));
          const j = await r.json();
          const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
          // a server that puts everything a model wrote under its reasoning, and nothing under its answer, has still been answered
          const calls = withTools && Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : null;
          return {
            // (a call is written down as text the way tools.mjs writes an action, so that whatever reads text reads it)
            text: calls
              ? calls
                  .map((c) => 'CALL ' + ((c.function || {}).name || '') + ' ' + ((c.function || {}).arguments || '{}'))
                  .join('\n')
              : withoutThinking(msg.content || msg.reasoning_content || ''),
            // (what it said, its thinking left out: read.mjs withoutThinking)
            content: withoutThinking(msg.content || ''),
            ...(calls ? { calls } : {}),
            tokens: (j.usage && j.usage.completion_tokens) || 0,
            ms: Date.now() - t0,
          };
        };
        try {
          return await once();
        } catch (e) {
          const why = String((e && e.message) || e);
          if (!revive || (signal && signal.aborted) || !SERVER_FAULT.test(why)) throw e;
          // started again once for everyone waiting on it; a call that failed just after a revival only asks again
          if (!self.reviving && Date.now() - (self.revivedAt || 0) > 4000)
            self.reviving = revive(self, why).finally(() => {
              self.reviving = null;
              self.revivedAt = Date.now();
            });
          const back = self.reviving ? await self.reviving : { ok: true };
          if (!back.ok) throw new Error(m.name + ' stopped and could not be started again: ' + back.why);
          return await once();
        }
      } finally {
        p.give(n);
      }
    },
  };
  self.onRecover = onRecover;
  return self;
}

export const attachMember = (m, base, slots = SERVING.slots) => member(m, String(base).replace(/\/+$/, ''), slots);

// where a model's file is: in the folder named, or in a folder one level inside it (programs that keep models keep each in a
// folder of its own, under a name of their choosing)
// A model too large for one file on Hugging Face comes in parts (…-00001-of-00003.gguf and on): `file` is the first, which
// llama.cpp is given and which finds the rest beside it, and `parts` the others; it is here only when every part is.
export function modelFile(m, modelsDir) {
  if (!modelsDir || !fs.existsSync(modelsDir)) return '';
  const whole = (f) =>
    fs.existsSync(f) && (m.parts || []).every((p) => fs.existsSync(path.join(path.dirname(f), path.basename(p.file))));
  const direct = path.join(modelsDir, m.file);
  if (whole(direct)) return direct;
  for (const d of fs.readdirSync(modelsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of [path.join(modelsDir, d.name, m.file), path.join(modelsDir, d.name, path.basename(m.file))])
      if (whole(f)) return f;
  }
  return '';
}

// every file a model is: the first, then its parts (one file for most)
export const filesOf = (m) => [{ file: m.file, bytes: m.bytes, sha256: m.sha256 }, ...(m.parts || [])];

// A MODEL FILE IS CHECKED BEFORE IT IS FIRST SERVED (SwOA specification S2.1.5): every file of the model (the first and its
// parts) against the SHA-256 it is pinned to, wherever it came from (fetched here, copied in, or found in another program's
// folder). A file of the right size is not taken on trust: a file that is not the pinned one makes another module, whose
// proof was not measured. Hashing a model of several GB takes seconds, so a file once verified is not hashed again while its
// size and modification time are unchanged: that is kept beside the models (.verified.json). Where a model pins no SHA-256
// there is nothing to check it against, and it is served as it is.
//   verifyModel(m, file) -> { ok: true, hashed: n } | { ok: false, why }
const VERIFIED = '.verified.json';
const sha256File = (f) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(f)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });
export async function verifyModel(m, file) {
  const want = filesOf(m).filter((x) => x && x.file && x.sha256);
  if (!want.length) return { ok: true, hashed: 0 };
  const dir = path.dirname(file);
  const cacheFile = path.join(dir, VERIFIED);
  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {};
  } catch {
    /* none yet */
  }
  let hashed = 0;
  for (const [i, x] of want.entries()) {
    const f = i === 0 && x.file === m.file ? file : path.join(dir, path.basename(x.file));
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      return { ok: false, why: m.name + ': ' + path.basename(f) + ' is not here' };
    }
    const was = seen[f];
    if (was && was.size === st.size && was.mtimeMs === st.mtimeMs && was.sha256 === x.sha256) continue;
    let got;
    try {
      got = await sha256File(f);
    } catch (e) {
      return {
        ok: false,
        why:
          m.name + ': ' + path.basename(f) + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ')',
      };
    }
    hashed++;
    if (got !== x.sha256)
      return {
        ok: false,
        why:
          m.name +
          ': ' +
          path.basename(f) +
          ' is not the file the model is pinned to (SHA-256 ' +
          got.slice(0, 12) +
          ', pinned ' +
          String(x.sha256).slice(0, 12) +
          '): fetch it again',
      };
    seen[f] = { size: st.size, mtimeMs: st.mtimeMs, sha256: got };
  }
  if (hashed)
    try {
      fs.writeFileSync(cacheFile + '.tmp', JSON.stringify(seen, null, 2));
      fs.renameSync(cacheFile + '.tmp', cacheFile);
    } catch {
      /* a folder that cannot be written to: verified this time, hashed again the next */
    }
  return { ok: true, hashed };
}

export async function startMember(m, opts = {}) {
  const {
    llamaServer,
    modelsDir,
    slots = SERVING.slots,
    onLine = () => {},
    onRecover = () => {},
    waitMs = 10 * 60000,
  } = opts;
  let contextPerSlot = opts.contextPerSlot || SERVING.contextPerSlot;
  const file = opts.file || modelFile(m, modelsDir || '');
  if (!file) return { ok: false, why: m.name + ' is not here (' + m.file + '). Fetch it first.' };
  const checked = await verifyModel(m, file);
  if (!checked.ok) return { ok: false, why: checked.why };
  if (!llamaServer) return { ok: false, why: 'no llama-server program was named' };
  const UNKNOWN_FLAG = /invalid argument|unknown argument|unrecognized|error while handling argument/i;
  const NO_MEMORY =
    /out of memory|failed to allocate|insufficient memory|cannot allocate|bad_alloc|exit 137|exit -?9\b/i;
  // a swarm that decides turns with tools needs the server to read and write calls in the model's own template (--jinja)
  let serve = [...(opts.jinja ? ['--jinja'] : []), ...(m.serve || [])];
  const tryWith = async () => {
    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    const args = [
      '-m',
      file,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-c',
      String(slots * contextPerSlot),
      '-np',
      String(slots),
      ...serve,
      ...(opts.flags || []),
    ];
    const tail = [];
    let exited = null;
    const child = spawn(llamaServer, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const take = (c) =>
      String(c)
        .split(/[\r\n]+/)
        .forEach((raw) => {
          const line = raw.trim();
          if (!line) return;
          tail.push(line);
          if (tail.length > 12) tail.shift();
          onLine(m.key + ': ' + line);
        });
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => (exited = { code: -1, why: e.message }));
    child.on('close', (code, signal) => (exited = exited || { code, signal }));
    const stop = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    };
    const t0 = Date.now();
    while (!exited && Date.now() - t0 < waitMs) {
      if (await aliveAt(base))
        return { ok: true, base, stop, pid: child.pid, args: args.join(' '), loadMs: Date.now() - t0 };
      await sleep(500);
    }
    stop();
    return {
      ok: false,
      why: exited
        ? m.name +
          "'s server stopped (" +
          // stopped by a signal it did not send itself: SIGKILL is what the system sends when memory is short; any other
          // was sent by something on the machine (another program, a person)
          (exited.signal
            ? 'stopped by ' +
              exited.signal +
              (exited.signal === 'SIGKILL'
                ? ', as the system does when memory is short'
                : ': something on this machine stopped it')
            : 'exit ' + exited.code) +
          '): ' +
          // the lines that say what went wrong, where there are any, and not merely the last it happened to write
          (exited.why ||
            tail
              .filter((l) =>
                /error|fail|unable|cannot|could not|abort|denied|in use|invalid|unknown|not found/i.test(l),
              )
              .slice(-3)
              .join(' / ') ||
            tail.slice(-3).join(' / '))
        : m.name + "'s server did not answer within " + Math.round(waitMs / 60000) + ' minutes',
    };
  };
  // STARTING IT, AND WHAT IS TRIED WHEN IT WILL NOT START, in order:
  //   a flag this llama.cpp does not know (an older build)   -> without the model's own flags: it runs as that build runs it
  //   not enough memory                                      -> with half the context for each slot (to a quarter, then no further)
  //   anything else                                          -> once more, after a moment (a port taken in between, a slow disk)
  const start = async () => {
    let r = await tryWith();
    for (let attempt = 1; !r.ok && attempt <= 3; attempt++) {
      if (serve.length && UNKNOWN_FLAG.test(r.why)) {
        onLine(m.key + ': this llama.cpp does not know ' + serve.join(' ') + ': starting without it.');
        onRecover(m.name, 'this llama.cpp does not know ' + serve.join(' ') + ': started without it', { kind: 'flag' });
        serve = [];
      } else if (NO_MEMORY.test(r.why) && contextPerSlot > SERVING.contextPerSlot / 4) {
        contextPerSlot = Math.floor(contextPerSlot / 2);
        onRecover(
          m.name,
          'not enough memory to start it: started with ' + contextPerSlot + ' tokens of context a slot',
          { kind: 'memory', why: r.why },
        );
      } else if (attempt === 1) {
        onRecover(m.name, 'it would not start: tried once more', { kind: 'start', why: r.why });
        await sleep(2000);
      } else break;
      r = await tryWith();
    }
    return r;
  };
  const first = await start();
  if (!first.ok) return first;
  // brought back the same way it was started, with whatever it took to start it kept
  const revive = async (self, why) => {
    self.halt();
    const r = await start();
    if (r.ok) {
      self.base = r.base;
      self.halt = r.stop;
      self.pid = r.pid;
      self.revived++;
      onRecover(m.name, 'its server was gone or hung: started again, and asked again', { kind: 'gone', why });
    }
    return r;
  };
  return { ...first, member: member(m, first.base, slots, first.stop, { revive, onRecover }), contextPerSlot };
}
