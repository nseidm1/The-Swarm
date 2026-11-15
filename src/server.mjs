// server.mjs - THE SWARM BEHIND THE ADDRESS A MODEL IS USUALLY BEHIND. It answers what llama.cpp's server answers, so a program
// that talks to one model at an address talks to this without knowing:
//   GET  /health                 200 while both models answer
//   GET  /v1/models              one model, by the name it is served under
//   POST /v1/chat/completions    messages in, one reply out; with "stream": true the reply comes as events
//   GET  /swarm/last             what the slots did on the last message (for a person looking, and for the trainers)
// A request that carries tools is not a question to be drafted and checked: it is a step in an agent's work, where the reply must
// be a tool call in the form the caller asked for. That goes straight to one model (the lead), untouched, and its reply comes
// straight back. The swarm answers messages; it does not yet drive tools.
import http from 'node:http';
import { SERVED_NAME } from './catalog.mjs';

const read = (req) =>
  new Promise((ok, no) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 16 * 2 ** 20) {
        no(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', no);
  });
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

export function serve(swarm, { port = 0, host = '127.0.0.1', lead = 'a', name = SERVED_NAME } = {}) {
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const up = await swarm.alive();
        return json(res, up ? 200 : 503, { status: up ? 'ok' : 'a model is not answering' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/models')
        return json(res, 200, { object: 'list', data: [{ id: name, object: 'model', owned_by: 'the-swarm' }] });
      if (req.method === 'GET' && url.pathname === '/swarm/last') return json(res, 200, swarm.last() || {});
      if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions')
        return json(res, 404, { error: { message: 'not here' } });
      const raw = await read(req);
      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return json(res, 400, { error: { message: 'the body is not JSON' } });
      }
      if (!Array.isArray(body.messages) || !body.messages.length)
        return json(res, 400, { error: { message: 'no messages' } });
      // a step in an agent's work: to the lead model, as it came
      if (
        (Array.isArray(body.tools) && body.tools.length) ||
        body.messages.some((m) => m.role === 'tool' || m.tool_calls)
      ) {
        const r = await fetch(swarm.members[lead].base + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: raw,
        });
        res.writeHead(r.status, {
          'content-type': r.headers.get('content-type') || 'application/json',
          'x-swarm-path': 'lead',
        });
        if (r.body) for await (const chunk of r.body) res.write(chunk);
        return res.end();
      }
      const got = await swarm.answer(body.messages);
      const id = 'chatcmpl-swarm-' + Date.now().toString(36) + '-' + ++n;
      const created = Math.floor(Date.now() / 1000);
      if (!got.ok) return json(res, 502, { error: { message: 'no slot gave an answer' } });
      const tokens = got.trace.reduce((a, r) => a + (r.tokens || 0), 0);
      if (body.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-swarm-path': got.path,
        });
        const send = (delta, finish = null) =>
          res.write(
            'data: ' +
              JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: name,
                choices: [{ index: 0, delta, finish_reason: finish }],
              }) +
              '\n\n',
          );
        send({ role: 'assistant', content: '' });
        // the reply is whole before it is sent: it goes out in pieces a reader can follow, not all at once
        for (const piece of got.reply.match(/\S+\s*|\s+/g) || []) send({ content: piece });
        send({}, 'stop');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.setHeader('x-swarm-path', got.path);
      return json(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model: name,
        choices: [{ index: 0, message: { role: 'assistant', content: got.reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: tokens, total_tokens: tokens },
        swarm: { path: got.path, ms: got.ms, slots: got.trace.map((r) => ({ slot: r.slot, ms: r.ms, ok: r.ok })) },
      });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: { message: String((e && e.message) || e).slice(0, 300) } });
      else res.end();
    }
  });
  return new Promise((ok, no) => {
    server.once('error', no);
    server.listen(port, host, () => {
      const p = server.address().port;
      ok({ port: p, base: 'http://' + host + ':' + p, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
