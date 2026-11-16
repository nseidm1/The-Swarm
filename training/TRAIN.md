# Training the Swarm

What is trained, every pass:

| Part | How |
|---|---|
| The drafts, the checks, the write | What each slot is told (its brief): [`improve.mjs`](improve.mjs) |
| The arrangement | Which model drafts and which checks, how many of each, what a checker sees, how freely a drafter samples, the plan: [`arrange.mjs`](arrange.mjs) |
| The decision | Kev, a decision model, decides ([`../src/decider.mjs`](../src/decider.mjs)). It is to be fine-tuned on the questions the drafts disagreed on. Not built yet: today it decides as it was published |

The two small models' weights are not changed: they stay as their makers published them. There are countless arrangements of
them, and the one that reaches parity with the larger model is found by trying, pass after pass, never the same one twice.

## The aim: parity with a larger model, then a larger one

**Parity is equivalence.** The Swarm is at parity with the larger model when, for the same question, its answer is
fundamentally equivalent to the larger model's: the same thing said, whatever the wording, the layout or the working.

- **It is not correctness.** The larger model's answer is the mark, whatever it is. Whether either of them is right is not asked.
- **Progress toward it is a percentage, and parity is 100.** The percentage of the held answers that are equivalent says how
  far the Swarm has come, pass by pass, and is what the trainer drives up. It is rounded down, so 100 is said only at parity.
- **Short of 100 it is not parity.** One answer that is not equivalent is a place where the two are not the same, and the Swarm is not
  at parity while there is one. What is counted, pass by pass, is how many answers are not yet equivalent.

| | |
|---|---|
| The models to climb | The targets in [`../src/models.json`](../src/models.json), smallest first. Each says how it is served: a GGUF file by llama.cpp, or a program of its own |
| The one being chased | `target` in [`state.json`](state.json). The first is **Nemotron 3.5 Lightning 30B**, served by TensorFold on the Mac the Swarm is first trained on |
| At parity | Every answer the Swarm gives to the held questions is equivalent to the larger model's answer. [`state.mjs`](state.mjs) `parity()`. Then the next, larger model becomes the target |
| What it is equivalent on | Chosen on the dashboard, under the models, or `equivalence` in `src/config.json`: **The Crew** where nothing is chosen, and with it or in its place Math, Logic, Reasoning. Each is a list of kinds of question in [`equivalence.json`](equivalence.json); a pass asks the kinds of all that are chosen, and a choice takes effect when the next pass begins (a pass ends on the questions it began with, which its record names) |
| Your own questions | The pencil at the top right of each box opens its questions: the kinds the trainer makes, and questions a person writes, saved to [`questions/<id>.json`](questions/README.md) (200 at most; for The Crew each says Simple or Developer). Every second one is held back. They are judged as a reply in a conversation, and a pass keeps the ones it began with (`own` in its record) |
| A reply in a conversation (The Crew) | [`tasks-crew.mjs`](tasks-crew.mjs): six kinds, four in Simple and two in Developer, each sent with the system line a seat is given and the turns so far. Equivalent when it is the same **act** (both help, or both ask), the same **substance** (Kev, one request with three yes-or-no questions), and breaks no **convention** the larger model's reply kept (read off the words: `faultsOf`). The page says which of the three a reply was lost on. The reader is checked on 14 pairs anyone can judge before a pass believes it (`readers.mjs` `talkPairs`); measured 2026-11-16 with Kev-4B: 14 of 14 |
| How equivalence is decided | By **function**. Where a function is asked for, both functions are run on the same inputs, the ordinary and the awkward, and are equivalent when every call gives the same result: nothing is compared as text, and no right answer is needed. Where a value is asked for (what does this print?), the two values are read and compared. Where the answer is in words (what is the bug?), Kev is asked one yes/no: do the two say fundamentally the same thing? ([`support/equivalent.mjs`](support/equivalent.mjs)) |

```bash
node training/target.mjs        # which model is being chased, and whether it can be served here
```

## Which models

The swarm is two small models (places `a` and `b`), a model that decides, and the larger model. Which they are is chosen, in
[`../src/config.json`](../src/config.json) (the page's pills write it), from the ones in [`../src/models.json`](../src/models.json):
small models from Liquid AI, Prism ML, Alibaba, Google, IBM, Mistral, NVIDIA and Hugging Face; Kev in four sizes; and larger
models from 8B to 30B. Every file is pinned (a repository, a revision, a size, a SHA-256). A slot is named for its place, not
its model: `a-critic` is the critic in place a, whichever model is there.

**Only five of them have been run here**: LFM2.5 2.6B, Bonsai 2 2B, Kev 4B, StartLux Decision 4B (as the decider, on the reader checks and the decide request only, not yet in a pass) and Nemotron 3.5 Lightning 30B. The rest are listed
as their makers published them. To add one, add its entry to `models.json` with its pins.

Results are kept apart by what the swarm was made of: change a model, and the page and the pass start from "not measured".

## Making ready

```bash
node training/setup.mjs            # fetch and make ready what the configured swarm needs
node training/setup.mjs --check    # say what is missing, fetch nothing
```

The session runs this first, so there is nothing to do by hand. It fetches the engine (llama.cpp's pinned build, if none is on
the machine), the two small models, Kev's program, and the larger model's file. It recovers by itself where it can: a download
that stopped carries on from where it stopped, a file that arrives wrong is thrown away and fetched once more, an engine that
will not unpack is fetched again. Where it cannot go on (no room on the disk, no network, a target this machine cannot serve)
it stops and says what to do, and what is already here is kept.

## What is measured

What is being brought to parity is **programming**. The questions are made from a seed ([`tasks-code.mjs`](tasks-code.mjs)),
in families whose details change (the step, the tie rule, the separator), so there is no list to learn:

| Kind | Asks for | Equivalent when |
|---|---|---|
| `write-arrays`, `write-strings`, `write-numbers`, `write-parsing` | A small JavaScript function, from a description | The two functions return the same for every input |
| `fix` | A function with one flaw, corrected | The same |
| `trace` | What a short program prints | The two values are the same |
| `bug` | What is wrong with a function, in a sentence or two | Kev says the two answers say the same thing |

The older kinds (arithmetic, days, traps) are still there and can be asked with `--kinds`.

**The larger model goes first.** It answers the questions, and its reply is the mark. Every other reply, the Swarm's and
each slot's on the way, is then marked by whether it is equivalent to it:

| Mark | Means |
|---|---|
| equivalent | It settled on an answer fundamentally equivalent to the larger model's |
| different | It settled on another answer |
| none | It settled on nothing |
| (inside the swarm) | Where a function is asked for the swarm runs its own drafts on the same calls and counts drafts that do the same as one answer (`src/behave.mjs`). That is how its slots agree; it is not how it is graded. The grade is always against the larger model's function, on the question's own inputs |
| not compared | The larger model gave no answer (nothing, a function cut off partway, a sentence cut off after a word), so there is nothing to be equivalent to |

A candidate is chosen by equivalent answers minus different ones. (In the code and the result files these marks keep the short
names `right`, `wrong`, `unsure`, `noref`: they mean the four above, not correct and incorrect.)

| Split | Used for |
|---|---|
| `train` | Choosing a brief or an arrangement. Shown to a teacher, if one writes candidates. **New questions every pass**, which the larger model answers first |
| `held` | Saying whether it is at parity. Never used to choose anything, never shown to anything that writes a brief. The same questions for as long as one target is chased; new ones when the target changes |

## Each pass makes the next one better

A pass ends by writing down what the next one needs ([`state.json`](state.json), which is committed), and begins by reading
it. Running the session again is not the same pass again:

| What a pass leaves | What the next pass does with it |
|---|---|
| The kinds of question the Swarm answered differently from the target on | Asks more of those kinds on the train questions |
| Each slot's record: how often it had the larger model's answer, how often the decider threw that answer away, how often the writer changed it | Works on the slots worst first |
| Every brief, and every arrangement, that was measured and not kept | Never measures it again |
| The arrangement it kept, if it kept one | Tries the arrangements one step from that |
| A search for each kind it answered differently on | Asks arXiv those, with the standing questions |
| Every paper already seen | Reads only what is new |
| Ideas from the reading, each with what became of it | Measures the ones still open |
| Whether it reached parity | Names the next, larger target, and new held questions to meet it on |

[`passes.md`](passes.md) is the same, for a person: what each pass measured and what it handed on.

## The plan of a pass

A pass does not work through a fixed list. Once it has measured the Swarm on its own train questions it writes a plan
([`plan.mjs`](plan.mjs), to `.work/train/plan.json`), and the steps after follow it.

| It finds | From | Moves that speak to it |
|---|---|---|
| No slot had the larger model's answer | answers that differed, less those a slot did have | Another brief for a drafter; one more drafter; a drafter sampled more or less freely; a drafter moved to the other model |
| A drafter well under the best | each drafter's own record | Its brief; moving or dropping it; its temperature |
| A checker less often equivalent than the best draft | each checker's own record | Its brief; what it is shown; moving or dropping it |
| The decider had the answer and chose another | the decider's record | One worked answer for each different answer; what the checkers are shown; one more checker |
| The writer changed the settled answer | the writer's record | Its brief |
| A slot said nothing | each slot's record | Its brief; moving or dropping it |

Every move open to the pass (each candidate in [`candidates/`](candidates), each idea the reading left, each arrangement one
step from this one) is scored by the answers the findings it speaks to account for. Slots are worked in that order, and the
arrangements tried are the ones with the most to win back, no two for the same reason of the same kind. What an earlier pass
measured and did not keep is not chosen. A move the measurement does not point at can still be in the plan, marked as such,
when there is room: a pass tries what no pass has.

The plan is written twice. First when the pass begins, from what the last pass left, so that there is one before anything
is measured; then again from this pass's own measurement. `improve.mjs` and `arrange.mjs` mark each move as they measure
it: being measured, then kept or not kept, with what it scored. The dashboard shows it as it stands.

A score in the plan says where to look first. It is not a measurement: a move is kept by the one rule, higher on train and
not lower on held.

## What is kept, and where

A change that is kept is written to this configuration's own record, `src/learned/<a>+<b>+<decider>--<target>.json`
([`src/learned.mjs`](../src/learned.mjs)): the arrangement as it now stands, and an entry on its ledger saying what changed,
where it came from, and the answers equivalent to the larger model's before and after, on train and on held. `pass.mjs end`
adds where the pass left it. `src/briefs.json` is never changed by training: it is where every swarm starts. The dashboard's
output spec reads the record out, and grows as a pass keeps things.

**Across configurations** ([`support/across.mjs`](support/across.mjs)): every other configuration's record is read, never
written. An arrangement, flow or plan change kept there, by name, is planned first here (its reason in the plan: kept in
another configuration), and a brief kept there for a slot of the same name is a candidate for that slot (`plan.mjs`,
`improve.mjs`). Kept here only on evidence here. Each small model measured alone against a larger model
(`results/<model>-alone-vs-<target>-held.json`) and each configuration's latest pass against it (`states/`) are shared the same
way: the dashboard recommends a swap where a model alone beat the weakest member by 5 points or more, and a configuration
further along against the same larger model.

What a configuration remembers of its training is its own too (`training/states/<a>+<b>+<decider>--<target>.json`): which
pass it is, the questions' seeds, what it measured and did not keep, the order of its slots, how each pass ended, and what
became of each idea there. `training/state.json` holds only what was read: the questions put to arXiv, the papers seen and
the ideas they turned into. Choose other models and that swarm starts at pass 1 with nothing tried; come back and this one is
as it was left. A swarm that reaches parity starts a new record against the next, larger model.

Where each thing is kept, for a configuration `K` = `<a>+<b>[+<c>+<d>]+<decider>--<target>`:

| What | Where |
|---|---|
| The arrangement it runs, and the ledger of kept changes | `src/learned/K.json` |
| Which pass it is, what it tried, its policy and how each pass ended | `training/states/K.json` |
| The results of its measurements, and its histories of trials | `training/results/K/` |
| The pass it is in: each step's status and output, its plan, its review, its reader's verdict | `.work/train/K/` |
| Every answer, each row marked with whose it is; answers as they are written; measurements already made | `.work/train/` (shared) |

A session opens the pass where it was left (`support/steps.sh`: `open_pass`): the same pass if it had not finished, with the
steps that ended well passed over. Stopping, training another configuration and coming back loses nothing of either.

## The flow is trained too

The order of steps is part of the arrangement (`flow` in `src/briefs.json`; [docs/architecture.md](../docs/architecture.md)).
`arrange.mjs --list` shows every flow one change from the current one beside the changes to the slots: the answers sent back
to their drafters after a check, a loop of checking and revising, a decision that keeps the likeliest two before the one that
settles, a step taken out, a loop made longer or undone, a second writer with the decider picking the reply. A flow that is
kept is where the next pass starts, so over passes the flow can grow into shapes nobody wrote down. Each is kept by the one
rule: higher on train and not lower on held.

A longer flow costs time, not memory: the same two small models and the same decider answer more turns.

## Five rules a pass keeps

Taken from how The Crew is trained, where each was learned the hard way.

| Rule | What a pass does |
|---|---|
| Watch before acting | [`replay.mjs`](replay.mjs): from the Swarm's last measurement on the train questions it counts what each way of choosing between the answers would have won (`plan.decideBy`: `kev`, `most`, `kev-if-confident`, `kev-unless-majority`), and the plan ranks those ways by that count. Only a change to how answers are chosen can be replayed; a change to a brief or the flow makes different answers and is tried for real |
| A reader is checked before it is believed | [`readers.mjs`](readers.mjs): Kev is given the same flaw said two ways and two different flaws. Under four in five right, answers in words are not compared this pass |
| No flip goes unnamed | `pass.mjs end` names the held questions lost and won since the pass before, in `passes.md` and on the Swarm's record |
| Every question a second way | The held questions with their wording changed and what they ask unchanged (`tasks.mjs`: `reword`), each compared with the larger model's answer to the first wording |
| A bar that is held tightens | A kind at parity on the held questions for `ratchet.passes` passes in a row is asked half as many again from the next pass, up to `ratchet.max` times |

## The trainer trains by a policy, and changes it

How a swarm is trained is data: [`policy.json`](policy.json) is where every configuration starts, and each configuration keeps
its own changes to it in its record (`training/states/`: `policy`, and `policyLog`).

| Setting | What it is |
|---|---|
| `keep.margin` | How many more answers a change must win than lose, question by question on the same train questions, to be kept |
| `trials.arrangements`, `trials.wild`, `trials.depth` | How many arrangements a pass tries one change from here; how many that are several changes away at once; how many changes those are. Both are taken in a fixed order from what has not been tried: none is drawn by lot, and none is tried twice |
| `trials.stopEarly` | A trial that can no longer win by the margin is stopped there |
| `trials.screen` | How many train questions a candidate is first asked, most of them ones the swarm gets wrong. Only one that is no worse there is asked the rest (0: every question) |
| `keep.confirm` | Before a change is kept, it and the swarm as it is are asked the train questions again with another draw; a change that does not win again was luck, and is not kept |
| `moves.weight` | How much each kind of move (brief, plan, arrangement, flow) counts for when the plan ranks what to try |
| `review.after`, `review.rules` | When a pass looks at itself, and what it then changes |

[`review.mjs`](review.mjs) is the pass looking at itself. It measures: how many answers change when the same questions are
asked again with another draw; the share of questions on which no slot had the larger model's answer, and the share on which
one did and the reply did not; how many passes in a row kept nothing. Each rule in the policy says: when one of those passes a
mark, change one setting, within bounds, and why. A rule is data, so a new one needs no program changed:

```json
{ "id": "noise-sets-the-margin", "when": { "metric": "noise.answers", "op": ">=", "value": 1 },
  "then": { "set": "keep.margin", "to": "metric+1", "min": 2, "max": 6 },
  "why": "The same arrangement measured twice differed by {metric} answers. A change must win by more than that to be kept." }
```

`node training/review.mjs --dry` says what it would change and changes nothing.

## When something goes wrong

| What goes wrong | What is done about it |
|---|---|
| A model server stops or hangs in the middle of the work | It is started again and the question is asked again. Slots waiting on the same server share the one restart |
| A model server will not start | Tried the way that fits why: without a flag an older llama.cpp does not know; with half the context, then a quarter, where memory is short; once more otherwise |
| The larger model's reply holds no answer | Asked again, with another draw, twice. Still nothing: that question is not compared, and is counted as such |
| The larger model's server stops | Started again, and the question asked again |
| The larger model's server says it is restarting | Waited for, and asked again the same way |
| The larger model's engine does not know a flag it is better served with | Served without it, and that is recorded |
| Kev stops | Started again before the next step. Its port is found free at the start of the session |
| A trainer stops partway | Every answer is written down as it comes. Run again, it asks only what is left |
| A step of a pass fails | What it left running is stopped and it is run again, three times at most. If it still fails that is written down and the pass goes on |
| The session itself stops (a crash, a closed lid, a power cut) | The next session resumes the same pass for the same models: steps that finished are passed over |
| A dead session left model servers holding memory | They are stopped before the next session loads its own. Only servers started from this folder are touched |
| A file was half written | State, briefs and configuration are written whole or not at all, with the last good copy kept and read if the file will not |
| A download stops, or arrives wrong | It carries on from where it stopped; a file that fails its SHA-256 is thrown away and fetched once more |

Each way back taken is written to `.work/train/recovery.jsonl` ([`support/recover.mjs`](support/recover.mjs)). Read it
with the results: a count from a pass that restarted a model twelve times deserves a second look at the rows around each
restart.

A resumed pass is the same pass only for the same models. Change a model and the next session begins a new one.

## The trainers

| Script | What it does |
|---|---|
| [`pass.mjs`](pass.mjs) | `begin` says what this pass will do from what the last one left; `end` says how near the Swarm is to parity and writes what the next pass needs |
| [`plan.mjs`](plan.mjs) | `make` reads where the answers were lost and writes the plan; `slots` prints the slots in its order; `show` prints it |
| [`research.mjs`](research.mjs) | Asks arXiv the questions in the state, keeps what no pass has seen, and writes it to [`research.md`](research.md) to be read |
| [`baseline.mjs`](baseline.mjs) | One model by itself. The target (`--who target`) goes first: its answers are the mark. Each small model alone is then marked against them. A model that has answered these questions is not asked again |
| [`measure.mjs`](measure.mjs) | The Swarm on the questions, and every slot on its own account |
| [`improve.mjs`](improve.mjs) | One slot's candidates (other briefs, or changes to the plan). A candidate is kept only if it scores higher on `train` and not lower on `held` |
| [`arrange.mjs`](arrange.mjs) | A few arrangements no pass has tried, each one step from the arrangement as it is. `--list` shows every step and which have been tried |
| [`setup.mjs`](setup.mjs) | Fetches and makes ready the engine, the models and the decider the configured swarm needs, recovering by itself where it can |
| [`kev.sh`](kev.sh) | Installs and runs the configured decider beside the Swarm, inside `.work` (Kev in `.work/kev`; StartLux in `.work/deciders`), by the recipe in its `src/models.json` entry (`serve.kind`). The session starts and stops it. A decider that needs an NVIDIA GPU is not started here: its entry carries its maker's instructions, and it is named with `SWARM_KEV` |
| [`publish.mjs`](publish.mjs) | Writes what was measured on `held`, and how it stands against the target, to `src/trained.json`, which ships with the module |
| [`session.sh`](session.sh) | Pass after pass, one step at a time, each pass from the one before, until it is stopped. `PASSES=3` runs three and ends. A pass that stopped is resumed. Passes that are over in under a minute did no work: after five in a row it stops and says so |
| [`support/recover.mjs`](support/recover.mjs) | The ways back, and the record of each one taken. `reap` stops what a dead session left running |

Two numbers from `measure.mjs` say where to work:

- **lost**: a slot had the larger model's answer and the reply did not. The fault is in the checks, the decision or the writer.
- **beyond**: no draft had it and the reply did. Checking found what drafting did not: the Swarm doing more than its parts.

## Research

Every pass asks arXiv what has been published on what the last pass left open. Only titles and abstracts are read, one
request every three seconds, as arXiv asks. An abstract says what a paper claims, not how well it holds, so reading changes
nothing by itself. A reading becomes an **idea**: a candidate for one slot, with the paper it came from. An idea changes the
Swarm only if `improve.mjs` keeps it.

```bash
node training/research.mjs
node training/research.mjs --idea 2610.21290 --slot lfm-critic --name "one worked answer each" --plan '{"onePerAnswer":true}'
```

The second line is how a person enters what they made of a paper. With `--teacher claude --spend-claude` a large model reads
the abstracts and proposes candidates instead, on the Claude plan of the machine it runs on.

## One pass by hand

1. `node training/pass.mjs begin`
2. `node training/research.mjs`, then read the new section of `research.md` and mark each paper: idea, parked, set aside.
3. `node training/baseline.mjs --who target --split held`, then `--split train` (its answers are the mark for everything
   after), and `--split held` for `--who a` and `--who b`.
4. `node training/measure.mjs --split train`. Read the rows in `.work/train/swarm-runs.jsonl` before the counts: what did the
   slot actually write where it failed? Write candidates for it in `training/candidates/<slot>.json` from what you read.
5. `node training/plan.mjs make`, and read it. Then `node training/improve.mjs --slot <slot>` for each slot
   `node training/plan.mjs slots` prints, then `node training/arrange.mjs`.
6. `node training/measure.mjs --split train`, then `--split held`.
7. `node training/pass.mjs end`, then `node training/publish.mjs`.

## Rules

- No model is loaded outside a session. `session.sh` loads Kev when it starts and unloads it when it ends, however it ends;
  each step loads and unloads the small models and the target it uses. By hand: `bash training/kev.sh serve`, and `stop` after.
- One trainer at a time. Two share the machine and spoil each other's times.
- Do not run the checks (`npm test`) beside a session: they stop nothing of it, but they take its processor.
- A count is not a finding until the replies behind it have been read.
- The held questions choose nothing. If a change is made after looking at held results, the held seed is spent: change it in
  `state.json` and say so.
- A brief that makes its own slot look better and the reply worse is not better. `improve.mjs` grades the reply.
- Briefs stay short. Small models do worse with long, structured instructions (arXiv 2603.16045, as an abstract).
- A candidate never mentions a question. A brief that names one has learned the list.

## What a pass can change, and what it measures for you (2026-11-16)

The first long session showed the search could only re-wire selection: on 19 of 70 train questions no slot drafted the larger
model's answer, so the best any choosing could reach was 72.8%. Eight things were added so that a pass can change what is drafted,
and so that it gets through what is open faster:

| | What it is | Where |
|---|---|---|
| The settled answer as it is | A move that passes the writer over (`plan.writeAs: "settled"`): the writer had changed the settled answer on 6 of 70 | `src/orchestrate.mjs`, `arrange.mjs` |
| Briefs from the larger model | Each pass, the slots the plan finds failing get three new briefs written by the larger model itself, from their misses on train questions. No spend | `write-briefs.mjs`, `support/teach.mjs`; step `07-write-briefs` |
| Worked examples | A drafter can be shown the 2 or 4 worked examples nearest the question: the larger model's own answers to train questions, never held ones | `support/examples.mjs`, `src/orchestrate.mjs` (`examples`) |
| Room, and replacing | Six slots a model (`SWARM_SLOTS`), and a move that tells one drafter what another is told | `src/catalog.mjs`, `arrange.mjs` |
| Another small model | The other small models on this machine are asked the questions no slot drafted; the page says how many each answered. Adding one stays yours | `members-probe.mjs`; step `08-members` |
| Screening | A candidate is asked a few questions first and dropped there if it is worse (`trials.screen`) | `support/trial.mjs` |
| Another decider | The recorded choices of a measurement are put to another decider whose weights are here; the page says what it would have recovered and lost | `decider-replay.mjs`; step `08-deciders` |
| A second draw | A change is confirmed with another draw before it is kept (`keep.confirm`) | `support/trial.mjs` |

## Steering from outside (2026-11-16)

A person can see an opportunity a measurement does not. The dashboard's **Steer it** writes this configuration's steering record
(`.work/train/<configuration>/steer.json`, read by [`support/steer.mjs`](support/steer.mjs)):

| | What it does | When it is used |
|---|---|---|
| Focus | An area (briefs, slots, flow, decider placement, decider loops, several at once) counts for three times as much (more), a quarter (less), or alone (only) when the plan ranks moves | The next time a plan is written |
| Next | A move is measured first, ahead of what the plan chose and beyond how many it tries; any move open to the pass can be queued (the plan lists them all as `catalog`) | When its step begins: the arrangement step, or its slot's brief step |
| Skip | A move is never measured | The same |

Each is still kept only on evidence: steering decides what is tried, never what is kept. The **decider loops** are three flows that
put the decision model inside a loop: a narrowing loop (keep the likeliest two, send them back), asking the decider first and again
after a check and a revision, and a tournament (three, a check, then two sent back).
