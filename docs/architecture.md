# Architecture

## One way in, one way out

```
messages ──▶  The Swarm  ──▶  one reply
```

A caller hands over messages and gets a reply. It cannot tell the Swarm from one model, and nothing it sends says how the
answer is to be reached. That is the whole public surface, in three forms:

| Form | For |
|---|---|
| `createSwarm(opts).answer(messages)` | A program in Node that wants the reply |
| `swarm.serve()` / `swarm serve` | Anything that talks to a model at an address: `/health`, `/v1/models`, `/v1/chat/completions` |
| `serveSwarm(entry, engine, opts)` with `ENTRY` | A program that lists models and starts the chosen one: the same call a llama.cpp model gets, the same result back |

## The files

| File | Its one job |
|---|---|
| [`src/index.mjs`](../src/index.mjs) | The black box: makes the swarm, and the two calls a host program needs |
| [`src/server.mjs`](../src/server.mjs) | The swarm at an address |
| [`src/orchestrate.mjs`](../src/orchestrate.mjs) | The order of things: draft (and, for code, try), check, decide, write, and what happens when a slot fails. Knows nothing of servers |
| [`src/members.mjs`](../src/members.mjs) | One model behind a llama.cpp server with several slots; never more conversations at once than slots |
| [`src/decider.mjs`](../src/decider.mjs) | The decide step by a decision model: the request Kev is sent, how its answer is read, and when it counts as a decision |
| [`src/read.mjs`](../src/read.mjs) | Reading the answer out of what a slot wrote, and telling when two answers are the same |
| [`src/behave.mjs`](../src/behave.mjs) | Which drafts of a function do the same: the calls to try, the drafts run on them, the drafts grouped by what they returned |
| [`src/sandbox.mjs`](../src/sandbox.mjs), [`src/sandbox-runner.mjs`](../src/sandbox-runner.mjs) | Running a function a model wrote where it can reach nothing. The only place anything a model wrote is run |
| [`src/briefs.json`](../src/briefs.json) | What each slot is told, the plan and the flow, as every swarm starts |
| [`src/learned.mjs`](../src/learned.mjs), `src/learned/` | What one configuration has learned against one larger model: the arrangement it now runs, and the ledger of every kept change with its evidence |
| [`src/catalog.mjs`](../src/catalog.mjs) | The two model files, pinned, and the entry for a list of models |

## The flow

What happens in what order is a list of steps in `src/briefs.json` (`flow`), run over the answers that stand. With none named
it is `draft, try, check, decide, write`.

| Step | What it does |
|---|---|
| `draft` | Its slots answer the question, all at once. Each slot's latest answer stands |
| `try` | Where code is asked for: the answers are run on the same calls, and those that do the same are one answer |
| `expect` | Where the answers were run: one slot says what each call should give, from the question alone. The answer that gives it on the most calls is backed, and the count is put before the decider |
| `check` | Its slots are shown one answer for each different answer and where they part, and name the one they find correct |
| `revise` | The drafting slots are shown the different answers, which was their own, where they part and what the checkers said, and answer again |
| `decide` | The decision model picks the answer that stands. With `keep: n` it settles nothing: the likeliest n go on |
| `repeat` | `{ steps, upTo }`: its steps again, while the answers still differ |
| `write` | Its slots write the reply. With more than one, the decision model picks. Code goes out as settled |

A step that works on a dispute (`check`, `revise`, `decide`, `repeat`) is passed over when every answer is the same one. If no
step settles it, the one answer stands where there is one, and otherwise the answer most slots hold. `slots: [ids]` on a step
names the slots it uses; without it a step uses the slots of its own kind. A slot may be used by more than one step.

## Slots

llama.cpp's server holds several conversations at once; each is a slot. Each member is started with four. As it ships, the
plan has four roles on LFM2.5 and three on Bonsai 2, with one slot to spare: the arrangement is trained
(`training/arrange.mjs`), and a spare slot is somewhere for it to put another drafter or checker.

A role keeps to one server slot. Its brief is the start of everything it is ever sent, so the server reads the brief once and
keeps it: a role costs its brief the first time and only the question after that.

## What a slot sees

| Stage | Is sent |
|---|---|
| draft | its brief, the conversation's last turns |
| probe (where code is asked for) | a brief of its own and the conversation's last turns: it writes calls to try the drafts with, and is not asked for their results. Not one of the plan's slots: it shares a model's server slots |
| run | no model: every draft is run on those calls in the sandbox (`src/behave.mjs`, `src/sandbox.mjs`), and drafts that return the same are one answer |
| check | its brief, the earlier turns, then the question with the lettered drafts (the critic with their work, the other without). It may answer with the letter of the draft it finds correct, which counts as that draft's answer whole |
| decide (Kev) | no brief: one `POST /v1/systemone` with the question, one worked answer for each different answer and what the checkers said as state; a choice among the answers and a yes/no for each as questions. No slot judges |
| write | its brief, the earlier turns, the question, the answer settled on and the work behind it |

Every slot but the writer ends with a line that starts with `ANSWER:`. That line is how answers are compared without a model
reading them.

## When things fail

| What failed | What happens |
|---|---|
| One slot | The others carry on |
| Kev (not named, down or slow) | The answer most slots gave stands |
| The writer (it fails, or answers with a call to a tool) | The answer and its work are the reply |
| A model's server stops or hangs | It is started again, once for all the slots waiting on it, and each asks again |
| A whole model, for good | The other model's slots carry on |
| Everything | `ok: false` and no reply. Nothing is made up |

## What it does not do yet

- **Tools.** A request with tools goes to one model, untouched.
- **Decide how much to spend.** Every question gets four drafts. An easy one costs what a hard one does until the drafts
  agree.
- **Speak while it thinks.** The reply is whole before any of it is sent; a streamed reply is the finished one, in pieces.
