# SwOA implementations

Informative. The format is [swoa.md](swoa.md); nothing there depends on this page.

## The Swarm (this repository), `runtime.library: "the-swarm"`

| Part of the specification | Where |
|---|---|
| Writes a SwOA spec and card (sections 4, 7) | `ui/data.py`: `spec`, `swoa_proof`, `swoa_card`, `published_text`; the dashboard's **SwOA spec**, then **Publish to specs/** |
| Reads a SwOA spec and makes the module (sections 4.2, 5) | `src/spec.mjs`: `readSpec`, `fromSpec`; `createSwarm({ spec })` and `serveSwarm({ ...card, spec }, engine, opts)` in `src/index.mjs` |
| Classes of input (section 4.4) | `src/orchestrate.mjs` `classOf`, with the code rule in `src/read.mjs` `asksForCode`; training classifies its questions with the same function (`training/loop.mjs`) |
| Hashes (section 5) | `src/spec.mjs` `recipeSha256` and `ui/data.py` `recipe_sha256`, checked to agree by the tests |
| Proof (section 4.7) | `training/evaluate.mjs` (lm-evaluation-harness 0.4.13) records each run with its `arrangementSha256`; `ui/data.py` `swoa_proof` selects the results |
| Earlier output specs (section 8) | read by `src/spec.mjs` |

To serve a SwOA from a terminal:

```bash
node bin/swarm.mjs serve --spec specs/<name>.swoa.json [--port 8090]
```

The decision model is started with `bash training/decider.sh serve`, or one already running is named with `SWARM_DECIDER`.
From a program:

```js
import { createSwarm, serveSwarm, readSpec } from 'the-swarm';
const spec = readSpec('specs/<name>.swoa.json');
const swarm = await createSwarm({ spec, decider: 'http://127.0.0.1:8009', modelsDir });
```

Adapters pinned by a recipe are looked for in `<spec file without .json>.adapters/`, or the folder named by `adaptersDir` or
`--adapters`.

What the dashboard shows of a SwOA on this machine (how to start it here, the program calls) is the runtime's own and is left
out of what is published.
