# Contributing

Thank you for looking. This page says how to set up, what the conventions are, and what a change has to come with.

## Setting up

```bash
git clone https://github.com/nseidm1/The-Swarm.git
cd The-Swarm
npm test                      # the module's checks: no model, nothing installed
sh tools/hooks/install.sh     # once: commits in this clone format their staged files first
```

The module has no dependencies and no build step. There is one development dependency, Prettier, which formats the code
(`npm install`, then `npm run format`).

To run the real thing you need a `llama-server` program (llama.cpp 1.0.0 or later) and the two model files:

```bash
node training/setup.mjs
node bin/swarm.mjs ask "Today is Monday. What day is it in 100 days?" --trace --llama /path/to/llama-server
```

## The checks

```bash
npm test
```

```bash
python3 ui/check.py
```

256 checks of the module and the trainers and 171 of the dashboard, against stand-in servers: nothing is fetched,
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
| `docs/` | The documents, and the pictures |
| `.work/`, `src/learned/` | Made when it runs, never committed: model files, engines, harnesses, and what each configuration has learned |

## What a change comes with

1. **A check that fails without it.** The module's conduct is checked in `tests/run.mjs`, with stand-in servers in place of the
   models. A change with no check is not finished.
2. **A stand-in, never the real thing.** A check does not fetch a model, start one, or reach a real service.
3. **`npm test` and `npm run format:check` passing.**
4. **A measurement, for anything that claims to make the Swarm more often right.** A change to what a slot is told
   (`src/briefs.json`) is made by `training/loop.mjs`, which keeps it only if it brings a question to parity and loses none already there.
   A brief edited by hand, with no measurement, will be asked for one.
5. **Words that are true.** A number in the README or on a model card has a source: a published spec in `specs/`, or a run
   the README names. Training's own records (`training/results/`, `training/states/`, `src/learned/`) are not committed: only
   finished specs are.

## Conventions

### Folders and files

| Thing | Convention | Example |
|---|---|---|
| Folders | lower case, one word where possible | `src/`, `training/` |
| Files | lower case with hyphens | `sandbox-runner.mjs` |
| Node scripts | `.mjs` | `src/orchestrate.mjs` |
| One module, one job | a module is named for the one thing it does | `members.mjs`, `read.mjs` |
| Repository documents | upper case, as GitHub expects them | `README.md`, `CONTRIBUTING.md` |

### Code

| Thing | Convention | Example |
|---|---|---|
| Functions and variables | `camelCase`; a function is named for what it does or returns | `finalOf`, `startMember` |
| Constants that never change | `UPPER_SNAKE_CASE` | `SERVED_NAME`, `MEMBERS` |
| Settings from the environment | `SWARM_` and upper snake case | `SWARM_LLAMA_SERVER`, `SWARM_MODELS_DIR` |
| Comments | each file opens by saying what it is for and how it is called; a comment says why, not what | every file in `src/` |
| Formatting | Prettier, with the settings in `.prettierrc.json`. The hook does it on commit | |

### Words

Plain ones. A slot "drafts", "checks", "decides" and "writes"; a reply is "right", "wrong" or "unsure". Say what was measured
and what was not.

## Pull requests

Small ones are easier to say yes to. The template asks what changed, why, how it was checked and what was not checked; "what
was not checked" is the part most worth filling in.
