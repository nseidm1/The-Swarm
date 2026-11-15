#!/usr/bin/env node
// swarm - the module from a terminal.
//   swarm serve [--port 8090]            both models started, and the swarm served as one model at an address
//   swarm ask "What is 17 x 23?"         one message in, one reply out (--trace shows what each slot wrote)
// Both take: --llama <llama-server program>  --models <folder>  --attach-a <url>  --attach-b <url>
import { createSwarm } from '../src/index.mjs';
import { arg, has, llamaServer, modelsDir } from '../training/support/bench.mjs';

const what = process.argv[2];
const attach = {};
if (arg('attach-a')) attach.a = arg('attach-a');
if (arg('attach-b')) attach.b = arg('attach-b');
if (what !== 'serve' && what !== 'ask') {
  console.log('swarm serve [--port n]   |   swarm ask "<message>" [--trace]');
  process.exit(2);
}
let swarm;
try {
  swarm = await createSwarm({ attach, llamaServer: llamaServer(), modelsDir: modelsDir() });
} catch (e) {
  console.log('The swarm did not start: ' + e.message);
  process.exit(1);
}
if (what === 'serve') {
  const s = await swarm.serve({ port: Number(arg('port', 8090)) });
  console.log('The swarm is at ' + s.base + ' (POST /v1/chat/completions). Ctrl+C stops it.');
  process.on('SIGINT', async () => {
    await swarm.stop();
    process.exit(0);
  });
} else {
  const got = await swarm.answer([{ role: 'user', content: process.argv[3] || '' }]);
  if (has('trace')) for (const r of got.trace) console.log('--- ' + r.slot + ' (' + r.ms + ' ms)\n' + r.out + '\n');
  console.log(got.reply);
  if (has('trace')) console.log('\n[' + got.path + ', ' + got.ms + ' ms]');
  await swarm.stop();
}
