# SoRA implementations

Informative. The format is [sora.md](sora.md); nothing there depends on this page.

## The Swarm (this repository), `runtime.library: "the-swarm"`

| Part of the specification | Where |
|---|---|
| Writes a SoRA spec and card (sections 4, 7) | `ui/data.py`: `spec`, `sora_proof`, `sora_card`, `published_text`; the dashboard's **SoRA spec**, then **Publish to specs/** |
| Reads a SoRA spec and makes the module (sections 4.2, 5) | `src/spec.mjs`: `readSpec`, `fromSpec`; `createSwarm({ spec })` and `serveSwarm({ ...card, spec }, engine, opts)` in `src/index.mjs` |
| Classes of input (section 4.4) | `src/orchestrate.mjs` `classOf`, with the code rule in `src/read.mjs` `asksForCode`; training classifies its questions with the same function (`training/loop.mjs`) |
| Hashes (section 5) | `src/spec.mjs` `recipeSha256` and `ui/data.py` `recipe_sha256`, checked to agree by the tests |
| Proof (section 4.7) | `training/evaluate.mjs` (lm-evaluation-harness 0.4.13) records each run with its `arrangementSha256`; `ui/data.py` `sora_proof` selects the results |
| Earlier output specs (section 8) | read by `src/spec.mjs` |

To serve a SoRA from a terminal:

```bash
node bin/swarm.mjs serve --spec specs/<name>.sora.json [--port 8090]
```

The decision model is started with `bash training/decider.sh serve`, or one already running is named with `SWARM_DECIDER`.
From a program:

```js
import { createSwarm, serveSwarm, readSpec } from 'the-swarm';
const spec = readSpec('specs/<name>.sora.json');
const swarm = await createSwarm({ spec, decider: 'http://127.0.0.1:8009', modelsDir });
```

Adapters pinned by a recipe are looked for in `<spec file without .json>.adapters/`, or the folder named by `adaptersDir` or
`--adapters`.

What the dashboard shows of a SoRA on this machine (how to start it here, the program calls) is the runtime's own and is left
out of what is published.
