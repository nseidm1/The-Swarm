<p align="center">
  <img src="assets/brand/family-office.svg" alt="Family Office" width="96">
</p>

<h1 align="center">The Swarm</h1>

<p align="center">
  A few small AI models that answer as one, on your own machine.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#use-it-like-any-model">Use it</a> ·
  <a href="#what-happens-inside">What happens inside</a> ·
  <a href="#where-it-stands">Where it stands</a> ·
  <a href="#learn-more">Learn more</a>
</p>

<p align="center">
  <img src="docs/images/dashboard.png" alt="The top of the dashboard: Serve the module, SwOA spec and Uninstall Helper; the configuration, with one small model in every role (LFM2.5 1.2B), a small model of the swarm deciding, Jeffan 4B judging, and Nemotron 3.5 Lightning 30B as the larger model; your own training questions, and Questions to view the ones training asks; Run Intelligence Training, with a ring of how far it has come, the size of each evaluation, Start, which classes of request it trains, Clear training state and its four steps; and Run Conversation Training, with its ring and Run a pass" width="860">
</p>

<p align="center"><em>The dashboard: choose the models, serve the swarm, train it. <a href="docs/dashboard.md">Every part of it, pictured</a>.</em></p>

The Swarm turns a few small AI models into one that answers better than any of them alone. It runs on your own
machine, and to anything that uses it, it is one model at one address: messages go in and one reply comes out.

Inside, the small models work as a team. Some draft an answer, some check the drafts, one writes the reply, and code
does what code does exactly. Training then improves the team against a much larger model, so that the swarm can go
where the larger model would not fit.

Everything is set up from a dashboard. You choose the models; it fetches what they need, serves the swarm, trains it,
and can remove everything it installed.

## Get started

On an Apple silicon Mac, with [Node.js](https://nodejs.org) 20 or later and Python 3 (macOS has it):

```bash
git clone https://github.com/nseidm1/The-Swarm.git
cd The-Swarm
python3 ui/swarm_ui.py
```

Open `http://127.0.0.1:8787`, and:

1. **Choose the models** at the top. One small model can fill every place, or several can share them.
2. **Press Serve the module** to use the swarm from any program.
3. **Press Start** under **Run Intelligence Training** to measure it, train it, and measure it again.

Nothing else is installed by hand. What the models need is fetched the first time it is needed, a bar at the foot of the
page says how far it is, and the **Uninstall Helper** at the top lists every piece and removes any of them.
[What is fetched, and other machines](docs/configuration.md#requirements)

## Use it like any model

Press **Serve the module**. When the button reads **Serving**, the address is beside it. Give that address to any app
or program that talks to a model:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:8090/v1` |
| Model | `the-swarm` |
| API key | none is checked; put any text where one is required |

In an app that lists providers, add it as a custom or OpenAI-compatible connection. From a terminal:

```bash
curl http://127.0.0.1:8090/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"the-swarm","messages":[{"role":"user","content":"What is 17% of 240?"}]}'
```

It answers on this machine only. [The endpoints, the library, Python, engines and the SwOA spec](docs/api.md)

## What happens inside

| Step | What happens |
| --- | --- |
| Draft | Several slots answer the question, each going about it differently |
| Check | Other slots look for what is wrong with the drafts; code that was asked for is run and compared |
| Decide | The answer most of them hold stands |
| Write | One slot writes the reply you read |

Some questions never reach a model: where the answer can be worked out exactly, code does it. Training finds which
arrangement, which adapters and which code make the swarm better, and keeps a change only where questions it was never
trained on improve. [How it works](docs/how-it-works.md) · [Training](docs/training.md)

## Where it stands

Early, and measured rather than claimed. Over 460 questions of standard tests, one small model in every place:

| The small model | By itself | The swarm, before training | The swarm, trained | A 30B model |
| --- | --- | --- | --- | --- |
| LFM3 1.7B (2026-11-26) | not measured | 65.2% | 79.1% | 78.0% |
| LFM2.5 1.2B (2026-11-22 to 24) | 30.0% | 55.2% | 53.7% | 77.6% |

On the first lineup the trained swarm reads as the 30B model does, in 2.1 GB of memory against 18. Read that with
care: twenty questions a task is a check, not a proof; it is one run; and most of the gain is code answering four
tasks of operations that were read before that code was written. On the other 19 tasks training gained 6.1 points,
and the swarm stands at 74.7% where the 30B model has 80.0%. [Results](docs/results.md) · [Every measurement](docs/measured.md) · [Status and limits](docs/status.md)

## Learn more

| If you want to | Read |
| --- | --- |
| Use it from a program, from Python, or from an exported spec | [docs/api.md](docs/api.md) |
| Choose models and see every setting | [docs/configuration.md](docs/configuration.md) |
| Find your way round the dashboard | [docs/dashboard.md](docs/dashboard.md) |
| Fix something that went wrong | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Understand how a reply is made | [docs/how-it-works.md](docs/how-it-works.md) · [docs/architecture.md](docs/architecture.md) |
| Understand training | [docs/training.md](docs/training.md) · [the procedure](training/TRAIN.md) |
| See the evidence | [docs/results.md](docs/results.md) · [docs/measured.md](docs/measured.md) · [docs/status.md](docs/status.md) |
| Read the specification | [docs/swoa.md](docs/swoa.md) · [classes](docs/swoa-classes.md) · [parity](docs/swoa-parity.md) · [this implementation](docs/swoa-implementations.md) · [published specs](specs/README.md) |
| Know how model-written code is contained | [SECURITY.md](SECURITY.md) |
| See what changed | [CHANGELOG.md](CHANGELOG.md) |

The Swarm is a module from Family Office. [The Crew](docs/training.md#the-crew-the-first-project-that-uses-it) is the
first project to use it.

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
