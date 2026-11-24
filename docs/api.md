# Using it in a program

The module as a library, as a server, and made again from its SwOA spec.

```js
import { createSwarm } from 'the-swarm';

const swarm = await createSwarm({ llamaServer: '/path/to/llama-server', modelsDir: '.work/models', decider: 'http://127.0.0.1:8009' });
const { reply, ok } = await swarm.answer([{ role: 'user', content: 'Write a function that reverses a string.' }]);
await swarm.stop();
```

`answer()` also returns `decided` (the answer settled on), `path` (how it was settled) and `trace` (what every slot wrote).

**One model in several places is loaded once.** Places that hold the same model, served the same way, share one server, started with the slots of all of them (`shareLoads: false`, or `SWARM_SHARE_LOADS=0`, gives each place its own). Measured with LFM3 1.7B in two places: 2.1 GB in place of 3.3, for about a sixth more time a question.

**As a server.** `swarm.serve()`, or `swarm serve` from a terminal, answers what llama.cpp's own server answers, so a program
that talks to one model at an address needs no change:

| Endpoint                    | Answers                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `GET /health`               | `200` while both small models answer, `503` otherwise                       |
| `GET /v1/models`            | One model, `the-swarm`                                                      |
| `POST /v1/chat/completions` | Messages in, one reply out. With `"stream": true` the reply comes as events |
| `GET /swarm/last`           | What every slot did on the last message                                     |

It listens on `127.0.0.1` only.

**Where a model is listed and started.** A program that lists models and starts the chosen one needs an entry for its list
and a call that gives back an address. The Swarm has both, in the shape a llama.cpp model has them:

```js
import { ENTRY, serveSwarm, readTrained } from 'the-swarm';

ENTRY; // { id, engine: 'swarm', name, memGb, plain, members, decider }   one item for the list
readTrained(); // what was measured of it, for the item's card (null until a pass has finished)
const started = await serveSwarm(ENTRY, { file: llamaServerProgram }, { modelsDir, decider });
// { ok: true, port, base, pid, args, loadMs, stop }   or   { ok: false, why }
```

## From Python

[`python/the_swarm.py`](../python/the_swarm.py) is a thin client: one file, standard library only, Python 3.9 or later.
It does not run the module; it starts the module's own server with Node, waits until `/health` answers, and talks to
it. So a Python program gets exactly the module a Node program gets, and Node 20 or later must be on the machine (it is
looked for in `SWARM_NODE`, on the `PATH`, then under `~/.nvm`).

```python
import sys
sys.path.insert(0, "/path/to/The-Swarm/python")
from the_swarm import Swarm

with Swarm(spec="specs/<name>.swoa.json") as swarm:   # Swarm() serves the swarm configured in the checkout
    text = swarm.reply("What is 6 times 7?")          # the reply's text
    whole = swarm.chat(messages, tools=tools)         # the chat completion as a dict, tool calls among it
    trace = swarm.last()                              # what every slot did on that message
```

| | |
| --- | --- |
| `Swarm(spec, adapters, port, repo, node, llama, models, decider, wait)` | Every one optional. `spec`: a SwOA spec file; `adapters`: the folder of the adapters it pins; `port`: a free one where none is named; `wait`: seconds to wait for the models to load (600) |
| `start()`, `stop()`, or a `with` block | The server is started in a process group of its own and stopped by an interrupt, as Ctrl+C stops it in a terminal, so the model servers it loaded are stopped with it |
| `reply(messages)` | The reply's text. `messages` is a list of chat messages, or one string |
| `chat(messages, **more)` | The whole chat completion. `more` goes into the request as it is (`tools`, `tool_choice`, `max_tokens`, `stop`) |
| `last()`, `healthy()`, `said()` | What every slot did on the last message; whether it answers; what the server printed |
| `swarm.base` | Its address. Any client of an OpenAI-compatible server can be given `swarm.base + "/v1"` instead |

A failure is a `SwarmError` whose message carries what the server printed. A streamed reply is not read by the
client's own methods: give the address to a client that streams. `python3 python/test_the_swarm.py` checks it against a
stand-in server.

## From its SwOA spec

**SwOA** (Swarm Orchestration Adaptation) is to a swarm module what LoRA is to a model: the spec applied to the module to tune it, with the proof of what it
does, measured by an established LLM evaluation harness. The format is the [SwOA specification](swoa.md), independent of any implementation; this repository's is described in
[docs/swoa-implementations.md](swoa-implementations.md). The dashboard's
**SwOA spec** (**Save as a file**) is everything needed to make the swarm module again, anywhere, with no record of its
training ([`src/spec.mjs`](../src/spec.mjs)); **Publish to specs/** writes it, with its SwOA card, once it has proof:

| Part                        | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swoa`                      | The header: format `swoa`, version 1, its name, and three hashes: the base module it applies to, the arrangement it tunes, and the whole recipe                                                                                                                                                                                                                                                                                                                                                                                       |
| `baseModule`, `target`      | What it is applied to (the small models, the decider, the engine, each pinned) and the larger model it was trained toward                                                                                                                                                                                                                                                                                                                                                                                                             |
| `proof`                     | Harness results for the module and for its target on the same questions, measured on exactly this SwOA: each task's two scores and the gap between them (paired, question by question), at least 100 questions a task to count as proof; a verdict for each capability over its tasks together (`parity`, `short`, or `open`, against a margin of 0.05), a capability being the body of work that trains what a task measures (IFEval's is Instructions); what a test with tools offered each model; and what the SwOA does not claim |
| `recipe`                    | What a swarm is built from: each small model's pinned file (repository, revision, size, SHA-256, how it is served), the decider and its serving recipe, the engine's pinned builds, slots and context, the arrangement (the flow, every slot with what it is told, and an arrangement of its own for a kind of question where training kept one), and, where the swarm is served with them, its LoRA adapters by file and SHA-256: one for a small model, or one for each role (draft, check, write) of it. Hashed: `spec.recipeSha256`                                                          |
| `equivalence`               | How far training took it, by training's own measure and not the proof: the share of training's held questions it answers well, for the arrangement every swarm starts from and for the trained one, both served as the recipe says (with its adapters, where it pins them), and the gain in points. A side not measured that way says so                                                                                                                                                                                              |
| `adapters`                  | How each pinned adapter was made: what it learned (the larger model's answers to so many train questions), the original weights and revision it was trained from, its steps, loss and llama.cpp perplexity, and the command that makes it again. The files are not in the spec (10 to 15 MB each, more than a commit here takes)                                                                                                                                                                                                      |
| `card`                      | One item for a model chooser (`id`, `name`, `size`, `params`, `memGb`, `pace`, `badge`, `plain`), with `engine: "swarm"`, the bodies of work its training asked (`trainedOn`, named by the work) and where it stands                                                                                                                                                                                                                                                                                                                  |
| `requirements`              | What it needs of a machine: platforms (where the decider runs), memory, disk, engine, Node, every licence, and whether it may be used commercially                                                                                                                                                                                                                                                                                                                                                                                    |
| `interface`                 | What it is as a model: its endpoints, what it can and cannot do (who takes a turn with tools: the swarm, or which of its small models), how to start it, and `webSearch`: what web search is to it (a tool the caller offers and runs, never something the module does), whose each part is, the three steps of using it, the limits it keeps to, and what its proof measured of it                                                                                                                                                   |
| `trainedAgainst`, `learned` | Where it stands on training's own held questions, kind by kind; the bodies of work its training asked with their kinds (`trainedOn`: read from the questions of the pass in hand as they were asked, never from a setting); what a pass asked more of and whether a proof's verdicts weighted it (`emphasis`: the kinds, which came from its held questions and which from a proof, the proof that was read, and the passes it weighted); and every change it kept with the evidence, with the rule a change is kept by               |

```js
import { createSwarm, serveSwarm, readSpec } from 'the-swarm';

const spec = readSpec('specs/<name>.swoa.json'); // refused if its recipe or base module no longer matches its hash
const swarm = await createSwarm({ spec, decider: 'http://127.0.0.1:8009', modelsDir });
const started = await serveSwarm({ ...spec.card, spec }, { file: llamaServerProgram }, { modelsDir, decider });
```

From a terminal: `node bin/swarm.mjs serve --spec specs/<name>.swoa.json`. An output spec written before SwOA is still read. **Adapters:** where the recipe pins them, each is looked
for beside the spec, in `swarm-spec.adapters/` (or the folder `adaptersDir` or `--adapters` names; an adapter of a role under the role's name), and refused unless its
SHA-256 is the pinned one: an adapter trained again differs, and makes another swarm whose equivalence has not been measured
(`anyAdapters: true` takes it all the same).

**Published specs are committed; nothing else training writes is.** A SwOA is published from the same dialog, **Publish to
specs/**, to [`specs/`](../specs) as `<configuration>.swoa.json` with its card, `<configuration>.swoa.md`. The button is greyed
out until the SwOA has proof (a harness result of at least 100 questions measured on exactly it), and says why; the proof is
published whatever it reads, losses included. What a session writes on the way (the pass it is on, what it
read on arXiv, what each configuration tried and kept, every measurement, the trained summary) stays on the machine that
trained it, and git ignores it.

**In a model chooser:** list `spec.card` beside the other models; offer it only where
`spec.requirements` fit the machine (and, for a paid product, only where `commercialUse` is true: a configuration decided by
StartLux is not); fetch what `recipe` pins; start the decider by `recipe.decider.serve`; then `serveSwarm({ ...card, spec })`,
the same call shape a llama.cpp model is started with. It answers at an OpenAI-compatible address as one model. What it
has been shown good for is in its proof, capability by capability (`proof.capabilities`); what its training asked is on the
card (`card.trainedOn`): replies a person reads, single checked steps and, with turns with tools decided by the swarm, an
agent's steps. With them given to one small model, an agent gets that model alone.
