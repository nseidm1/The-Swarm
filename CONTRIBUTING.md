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

## What a change comes with

1. **A check that fails without it.** The module's conduct is checked in `tests/run.mjs`, with stand-in servers in place of the
   models. A change with no check is not finished.
2. **A stand-in, never the real thing.** A check does not fetch a model, start one, or reach a real service.
3. **`npm test` and `npm run format:check` passing.**
4. **A measurement, for anything that claims to make the Swarm more often right.** A change to what a slot is told
   (`src/briefs.json`) is made by `training/improve.mjs`, which keeps it only if it holds on questions it was not chosen on.
   A brief edited by hand, with no measurement, will be asked for one.
5. **Words that are true.** A number in the README or on a model card has a source in `training/results/`.

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
