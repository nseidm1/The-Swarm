<p align="center">
  <img src="assets/brand/family-office.svg" alt="Family Office" width="96">
</p>

<h1 align="center">The Swarm</h1>

<p align="center">
  Two to four small models that answer as one, trained toward parity with a much larger model.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#use-it-in-a-program">API</a> ·
  <a href="#training">Training</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/images/dashboard.png" alt="The top of the training dashboard: the SwOA spec and Uninstall Helper buttons; Configuration, with one small model in every role (LFM2.5 1.2B), a small model of the swarm deciding, Jeffan 4B judging equivalence, against Nemotron 3.5 Lightning 30B; who takes turns with tools; Your own questions, a button for each body of work; and the Run card: the size of each evaluation, Start, and its four steps (evaluate the module as configured, make an adapter for each drafting slot, train, evaluate it trained)" width="860">
</p>

<p align="center"><em>The top of the training dashboard on 2026-11-24: a swarm of LFM2.5 1.2B in every role against Nemotron 3.5 Lightning 30B, and Run, the one button that takes it through its four steps. Below it on the page: Memory saved, Evaluate the swarm, Train, the plan and the system, pictured under <a href="docs/dashboard.md">The dashboard</a>.</em></p>


The Swarm is a module from Family Office. To the program that uses it, it is one chat model: messages go in and one reply
comes out. Inside, two to four small models of your choosing are served with several slots each: some draft an answer,
some look for what is wrong with the drafts, one writes the reply, and deterministic code decides how each request is
taken and which answer stands.

It is trained toward **parity** with a much larger model, to run where that model would not fit. Parity is a capability
matched, not an answer copied: the module scores no worse than the larger model, within a stated margin, on established
tests (code, math, logic, reasoning, following instructions, tools, search), each asked of both by a third party's
harness, unchanged ([docs/swoa-parity.md](docs/swoa-parity.md)).

**What training makes is a spec.** A [SwOA](docs/swoa.md) spec is everything needed to make that swarm again and serve it
as one model, with the proof of what it does. The Swarm is not tied to one project;
[The Crew](docs/training.md#the-crew-the-first-project-that-uses-it) is the first to use it.

> **Status: pre-release; nothing proven yet.** The swarm these figures are of (2026-11-24) is LFM2.5 1.2B in both places against
> Nemotron 3.5 Lightning 30B. As configured, before any training, it scored 55.2% on 460 questions of 23 standard tasks
> where the larger model scored 77.6% and the small model by itself 30.0%. Twenty questions a task is a check, not a
> proof. **Training has not yet bettered it on any benchmark**: what training kept at first read lower when
> judged from outside (75 of 200 on two code benchmarks against 95 as configured); what it keeps now reads the same as
> configured (92 of 200; 247 of 460 on all tasks against 254), within error.
> [Results](#results) · [Status and limits](docs/status.md)

## Requirements

| Need | For |
| --- | --- |
| [Node.js](https://nodejs.org) 20 or later | Everything. There are no package dependencies; `npm install` is only for the formatter |
| `llama-server` (llama.cpp 1.0.0 or later) | Serving the small models. A pinned build is fetched if none is on the machine |
| Python 3.9 or later | The dashboard (standard library only) |
| Python 3.10 or later, or `uv` | Evaluating: the harnesses are installed into `.work` the first time |
| An Apple silicon Mac | Making adapters (MLX). Everything else runs without it |
| Memory and disk | About 3.5 to 13 GB of memory for the small models; 0.5 to 5 GB of disk for each, 2.5 GB and up for a larger model |

Everything it fetches goes into `.work`, and the dashboard's Uninstall Helper takes it out again piece by piece.
[The full table](docs/configuration.md#requirements).

## Quick start

```bash
git clone https://github.com/nseidm1/The-Swarm.git
cd The-Swarm
npm test
```

**With the dashboard.** Choose the models at the top and press **Start** on the Run card: what is missing is fetched,
then the module is evaluated as configured, trained, and evaluated again.

```bash
python3 ui/swarm_ui.py
```

**From a terminal.** Make ready what the configured swarm needs, ask it something and see what each slot wrote, or serve
it at an address as one model:

```bash
node training/setup.mjs
```

```bash
node bin/swarm.mjs ask "Write a JavaScript function isEven(n) that returns true for even whole numbers." --trace
```

```bash
node bin/swarm.mjs serve --port 8090
```

## How it works

A request goes through stages, each filled by slots of the small models:

| Stage | What happens |
| --- | --- |
| Draft | Slots answer the question, each told to go about it differently. Two draft first; the others only where those two differ |
| Try | Where a function is asked for, the drafts are run on the same calls in a sandbox. Drafts that do the same are one answer |
| Check | Checkers are shown one draft for each different answer and name the one they find correct |
| Decide | The answer most slots hold stands; a decision model, where one is configured, settles a tie |
| Write | One slot writes the reply a person reads. Code goes out exactly as it was settled |

Some requests are not put to the stages at all. Part of the wiring is code that decides, with no model, how a request
is taken:

| What the request is | What is done |
| --- | --- |
| An operation code does exactly (a sum, true and false, words to sort, brackets to close) | Done by code, **only where training turned that instrument on** for the class of input |
| A request that sets rules that can be counted (so many words, no comma, labelled parts) | Each first drafter writes the whole reply, and one more is written to the request as it came; the one that keeps the most rules goes out |
| A conversation that ends with the start of the reply | The reply follows the start |
| A function in JavaScript, TypeScript, Python, Go, Swift, Dart, Flutter or Kotlin | The drafts are run, boxed, and compared by what they do |
| A question that lists lettered options | An answer that is none of them is not counted beside one that is |
| A turn with only search and page tools offered | A program of code: it searches for what the question hangs on, opens the page as text, has the module read that text for the one fact, puts the fact into the question, and goes on. No slot proposes a step |
| A system text that sets the reply's form as a template | The settled answer is written into that form by code |

The arrangement (which slots, what each is told, the order of the stages) is chosen by the class of the request: with
tools, a conversation, asking for code, or a plain question. A slot may carry an adapter of its own: one small model
holds several at once, and each request is served with the one its slot carries, so drafters can differ and the stages
after them settle between them. Finding the arrangement that does what the larger model does is what training is for. [How it works, in full](docs/how-it-works.md) · [Architecture](docs/architecture.md)

## Use it in a program

```js
import { createSwarm } from 'the-swarm';

const swarm = await createSwarm({ llamaServer: '/path/to/llama-server', modelsDir: '.work/models' });
const { reply, ok } = await swarm.answer([{ role: 'user', content: 'Write a function that reverses a string.' }]);
await swarm.stop();
```

As a server (`swarm.serve()`, `node bin/swarm.mjs serve`, or the dashboard's **Serve the module** button, which shows
the address once it answers) it answers what llama.cpp's own server answers, on
`127.0.0.1` only, so a program that talks to one model at an address needs no change:

| Endpoint | Answers |
| --- | --- |
| `GET /health` | `200` while the small models answer, `503` otherwise |
| `GET /v1/models` | One model, `the-swarm` |
| `POST /v1/chat/completions` | Messages in, one reply out; streamed with `"stream": true`; tools as `tool_calls` |
| `GET /swarm/last` | What every slot did on the last message |

**From Python.** [`python/the_swarm.py`](python/the_swarm.py) is a thin client, standard library only: it starts that
server, waits until it answers, asks it, and stops it with the models it loaded. Node is still what runs the module.
Tried against the real module, tools included ([docs/api.md](docs/api.md#from-python)).

```python
from the_swarm import Swarm

with Swarm(spec="specs/<name>.swoa.json") as swarm:  # or Swarm() for the swarm configured in this checkout
    print(swarm.reply("Write a function that reverses a string."))
```

**From its spec.** `node bin/swarm.mjs serve --spec specs/<name>.swoa.json` makes a trained swarm again from its SwOA
spec: the pinned model files, the arrangement, the adapters its slots carry and the instruments that are on, each checked
against its hash. [The API and the spec's parts](docs/api.md) · [The SwOA specification](docs/swoa.md)

## Training

A module is trained toward a larger model, and what training finds is the module's wiring. Nothing is a setting: each
of these is tried as a change and kept only where held questions, never trained on, gain beyond their error:

- **The arrangement**, for each class of input: what each slot is told, how the slots are arranged and how their
  answers are settled. One slot asked plainly is an arrangement too, where that is enough.
- **A mixture of adapters.** A LoRA adapter is made for each drafting slot from that slot's own requests on many
  questions: its own answer where it was right, the larger model's where it was not. It is on no slot until training
  puts it there.
- **Instruments**: where a class of input holds operations code does exactly, that instrument is turned on. None is on
  as a module starts.
- **How many slots and models**: a slot added, dropped or moved to another model; every slot on one model.
- **Breakdown and cascade**: code takes the question apart, with no model asked. Every drafter is sent it with each
  thing it states on a numbered line, or one slot works it a fact at a time while code carries what was worked out.

- **Conversation**: made-up people write over several turns, and each reply is read by code against the conventions of
  that conversation (no praise to open, no offer of help to close, a short reply to a short message, the answer first
  for someone in a hurry). Code can tidy a reply, and that too is a change training keeps or not.

**Two runs, apart.** The run above is the intelligence run, judged by outside benchmarks. The conversation run is a
card of its own under it: one press is one pass over the class of input that is a conversation, judged on held
conversations read by code, with the passes side by side. No benchmark is asked.

**Each pass learns from the last.** A pass writes down every kind of question it was still wrong on and every
convention a reply still missed; the next pass asks more train questions of those.

What is tried first follows where the class falls short: no slot had the answer, a slot had it and settling lost it, or
the reply spoiled it.

Training's held questions are its own, so what it keeps is still to be shown by the benchmarks; so far it has not been
([Results](#results)).

```bash
bash training/run.sh
```

That is the whole of it in one run, with the two figures it is judged by: the module is evaluated as configured, an
adapter is made for each drafting slot, the module is trained (the arrangement, which slot carries its adapter, the
instruments), and it is evaluated again on the same questions (the dashboard's **Run**). The evaluation
is a third party's: EleutherAI's [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) and the
[Berkeley Function-Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) ask the module through the
chat-model interface as they ask any model. Training makes its own questions from a seed, never asks a benchmark's, and is not shaped to how a benchmark asks.
[Training, in full](docs/training.md) · [The procedure](training/TRAIN.md)

## The dashboard

<p align="center">
  <img src="docs/images/dashboard-evaluate.png" alt="Evaluate the swarm: 71.1% of the larger model&#39;s score (55.2% against 77.6% on 460 questions), with Each task, Paper table and Chart; the two evaluations side by side (as configured 55.2%, which is the baseline, and trained 49.6%, a loss of 5.7 points); the bodies of work asked, the harnesses used, and every task folded to one line" width="860">
</p>

`python3 ui/swarm_ui.py` opens at `http://127.0.0.1:8787/` and needs nothing installed. It chooses the models, runs and
stops training, follows an evaluation question by question, shows the plan being carried out and every slot at work,
and reads out the SwOA spec. [Every part of it, pictured](docs/dashboard.md)

## Results

The module as configured (LFM2.5 1.2B in both places, the arrangement every swarm starts from, no adapters, no
instrument on) against Nemotron 3.5 Lightning 30B, 20 questions of each of 23 standard tasks, 2026-11-22. Percent right:

| Body of work | The module | The small model alone | The larger model |
| --- | --- | --- | --- |
| Code | 52.5 | 45.0 | 90.0 |
| Math | 72.5 | 22.5 | 82.5 |
| Logic | 45.0 | 4.0 | 88.0 |
| Reasoning | 43.3 | 0.8 | 76.7 |
| Instructions | 85.0 | 90.0 | 75.0 |
| Tools | 86.0 | 88.0 | 81.0 |
| Search | 10.0 | 0.0 | 30.0 |
| All 460 | 55.2 | 30.0 | 77.6 |

Read it with care:

- Twenty a task is a check. A verdict needs at least a hundred; only the two code benchmarks have been run at that
  size (95 of 200 as configured).
- Most of the module's lead over its own small model is its code, not its arrangement. On the 320 questions that are
  not tools or search: the small model asked plainly 15.6%, with the module's reply layout only 19.1%, a module of one
  slot (all of the module's code round one call) 41.9%, the whole module 51.2%, the larger model 82.5%. So the code is
  worth about 26 points and the arrangement of seven slots about 9 more, before any training.
- Training has not yet bettered the module on a benchmark. The first whole run read 50.7% and 49.6% after its two
  stages. Since then adapters are made for each drafting slot and tried by training like any other change; training
  kept a set of them for code on its own held questions (+29.6 points), and the code benchmarks at 100 questions each
  read 75 of 200 with them against 95 without. An adapter is now carried only on a request like what it was taught:
  training kept that for code too (+30.8 points), and the benchmarks read 92 of 200, and 247 of 460 on all 23 tasks
  against 254, both within error of as configured. The harm is gone; the gain is not there yet, because training's
  questions are not yet what the module is judged on ([Measured, not claimed](docs/measured.md)).
- Search is the widest gap. A search is now a program of code that asks the module only to read: a made task of two
  chained facts went from 1 right of 30 to 30, but the live web test above, of three or four chained facts, did not
  improve.
- On 100 Instructions questions the small model alone has 75 right and the module 68. One slot asked plainly is now an
  arrangement training can keep for such requests (71 measured ahead of training).
- With every instrument on, four operation tasks read 20 of 20 where the small model alone had 0. The instruments were
  written after those tasks were read; they were then probed, with no model, on 104,520 questions by other authors and
  20,000 made at random, and answered none wrongly. Training keeps one only on wordings its trying never saw.

[Every measurement, dated](docs/measured.md) · [What has and has not been run, and known limits](docs/status.md)

## Testing

```bash
npm test
```

```bash
python3 ui/check.py
```

255 checks of the module and the trainers and 168 of the dashboard, against stand-in servers: nothing is fetched,
started or installed. `npm test` deals its blocks of checks out to every core (27 seconds on a 24-core Mac, 88 one
after another); `npm run test:serial` runs them in one process, `npm run test:all` adds the dashboard's, and
`npm run test:python` checks the Python client. How well the
models do is not a check. It is a measurement.

## Repository layout

| Path | What it holds |
| --- | --- |
| `src/` | The module: the server, the order of things, the models that can be chosen, the configuration, the briefs |
| `bin/`, `python/` | `swarm serve` and `swarm ask`; the Python client |
| `training/` | The questions, the trainers, the policy they train by, the evaluator, and what makes and proves adapters |
| `specs/` | Published SwOA specs, each with its card and its proof: the only thing training leaves that is committed |
| `tests/`, `ui/` | The checks; the dashboard (Python, standard library only) with its sample data and checks |
| `docs/` | The documents below, and the pictures |
| `.work/`, `src/learned/` | Made when it runs, never committed: model files, engines, harnesses, and what each configuration has learned |

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/how-it-works.md](docs/how-it-works.md) | The stages, the requests code takes, the flow, and what happens when things fail |
| [docs/architecture.md](docs/architecture.md) | The public surface, the files, what each slot is sent |
| [docs/configuration.md](docs/configuration.md) | Requirements in full, the models that can be chosen, every setting |
| [docs/api.md](docs/api.md) | The library, the server, and a swarm made again from its spec |
| [docs/dashboard.md](docs/dashboard.md) | Every part of the dashboard, pictured, and the changes it recommends |
| [docs/training.md](docs/training.md) | How training works, its scripts, its questions, and recovery. [training/TRAIN.md](training/TRAIN.md) is the procedure |
| [docs/measured.md](docs/measured.md) | Every measurement, dated |
| [docs/status.md](docs/status.md) | What has been run, what has not, and known limits |
| [docs/troubleshooting.md](docs/troubleshooting.md) | What you may see, why, and what to do |
| [docs/swoa.md](docs/swoa.md) | The SwOA specification. Designs: [classes](docs/swoa-classes.md), [parity](docs/swoa-parity.md), [this implementation](docs/swoa-implementations.md) |
| [specs/README.md](specs/README.md) | What a published spec is, and how one gets there |
| [SECURITY.md](SECURITY.md) | What the Swarm is built to hold, and how model-written code is run |
| [CHANGELOG.md](CHANGELOG.md) | What changed, version by version |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to set up, the conventions the code
follows, and what a change has to come with. `sh tools/hooks/install.sh`, once in a clone, formats what you commit.

## Security

Please report a vulnerability privately, not in a public issue. [SECURITY.md](SECURITY.md) says how.

## License

The Swarm is licensed under the [Apache License, Version 2.0](LICENSE). [NOTICE](NOTICE) carries the attributions that
travel with it.

The Swarm ships no model. It fetches the ones you choose, each under its maker's own license, which
[`src/models.json`](src/models.json) names beside it. Most are Apache-2.0. **Liquid AI's models are under the LFM Open
License v1.0 and NVIDIA's under the NVIDIA Nemotron Open Model License, neither of which is Apache**: read them before you
ship a product that fetches those models. Kev is Apache-2.0.
