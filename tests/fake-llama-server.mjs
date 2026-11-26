#!/usr/bin/env node
// fake-llama-server.mjs - A STAND-IN FOR A MODEL SERVER THAT CAN BE MADE TO GO WRONG, as a real one does: started like llama.cpp's
// server (-m file --port n -c ctx ...), it answers /health and /v1/chat/completions, and
//   POST /die                       it stops, as a server whose memory was taken stops
//   --busy n                        its first n requests are answered 500 "server restarting: retry shortly"
//   --old                           it refuses a flag it does not know (--reasoning-budget), as an older llama.cpp does
//   --memory <n>                    it will not start with more context than n, as a machine short of memory will not
//   --unk <n>                       its first n replies are nothing but unknown tokens
//   --fail-once <file>              it will not start while that file does not exist (and makes it): a start that fails once
//   --no-pool                       it refuses a shared pool of context (-kvu), as a llama.cpp from before there was one does
//   --slow <ms>                     it takes so long over each reply
//   GET /asked                      the server slot (id_slot) each request named, in the order they came
import http from 'node:http';
import fs from 'node:fs';
const a = process.argv.slice(2);
const val = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const fail = (why) => {
  process.stderr.write(why + '\n');
  process.exit(1);
};
if (a.includes('--old') && a.includes('--reasoning-budget')) fail('error: unknown argument: --reasoning-budget');
if (a.includes('--memory') && Number(val('-c', 0)) > Number(val('--memory')))
  fail('llama_init: failed to allocate ' + val('-c') + ' tokens of context: out of memory');
if (a.includes('--fail-once') && !fs.existsSync(val('--fail-once'))) {
  fs.writeFileSync(val('--fail-once'), 'x');
  fail('bind: address already in use');
}
if (a.includes('--no-pool') && a.includes('-kvu')) fail('error: invalid argument: -kvu');
const slow = Number(val('--slow', 0));
const asked = [];
let unk = Number(val('--unk', 0));
let busy = Number(val('--busy', 0)); // so many requests are answered 500 "server restarting: retry shortly", as TensorFold does
http
  .createServer((req, res) => {
    if (req.url === '/die') {
      res.end('{}');
      return setTimeout(() => process.exit(137), 20);
    }
    if (req.url === '/asked')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(asked));
    if (req.url === '/health' || req.url === '/v1/models')
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
      asked.push(body.id_slot);
      if (busy-- > 0)
        return res
          .writeHead(500, { 'content-type': 'application/json' })
          .end('{"error": {"message": "server restarting: retry shortly"}}');
      const content =
        unk-- > 0
          ? '<unk><unk><unk><unk>'
          : 'pid ' +
            process.pid +
            ' ctx ' +
            val('-c', '') +
            ' flags ' +
            (a.includes('--reasoning-budget') ? 'own' : 'none') +
            ' temp ' +
            (body.temperature ?? '');
      setTimeout(
        () =>
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content } }],
              usage: { completion_tokens: 3, prompt_tokens: 10 },
              timings: { prompt_n: 7, cache_n: 3 },
            }),
          ),
        slow,
      );
    });
  })
  .listen(Number(val('--port', 0)), val('--host', '127.0.0.1'));
