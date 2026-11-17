// decider-env.mjs - the decider training/decider.sh is to fetch or start, as shell assignments: the one src/config.json names, or the
// one DECIDER_ID names, with the recipe its entry in src/models.json gives (serve). Each value is quoted for the shell.
//   eval "$(node training/support/decider-env.mjs)"
import { REGISTRY, DECIDER } from '../../src/catalog.mjs';
import { llamaServer } from './bench.mjs';

const d = REGISTRY.deciders.find((x) => x.id === process.env.DECIDER_ID) || DECIDER;
const s = d.serve || { kind: 'kev' };
const q = (v) => "'" + String(v == null ? '' : v).replace(/'/g, "'\\''") + "'";
const vars = {
  D_ID: d.id,
  D_NAME: d.name,
  D_KIND: s.kind,
  D_RUN: d.run,
  D_CODE: s.code,
  D_CODE_REV: s.codeRev,
  D_WEIGHTS: s.weights,
  D_WEIGHTS_REV: s.weightsRev,
  D_HOW: s.how,
  D_NEEDS: d.needs,
  // a decider served by llama.cpp: its pinned GGUF file, the flags its maker gives, and the llama-server the swarm uses
  D_FILE: s.file,
  D_BYTES: s.bytes,
  D_SHA256: s.sha256,
  D_ARGS: (s.args || []).join(' '),
  D_LLAMA: s.kind === 'llama' ? llamaServer() : '',
};
console.log(
  Object.entries(vars)
    .map(([k, v]) => k + '=' + q(v))
    .join('; '),
);
