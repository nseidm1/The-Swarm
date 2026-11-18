# Training the Swarm

## Training goes question by question

What training aims at, and why, is in [docs/swoa-parity.md](../docs/swoa-parity.md): parity is the module scoring no worse than
its target on established tests, and training's own signal is whether an answer is good.

**How an answer is graded.** By the strongest standard its question has:

- **The question's own**, where it carries one ([`tasks.mjs`](tasks.mjs) `good`): code behaves as the question's correct
  solution on its inputs; a value is the question's own answer; a flaw is the flaw the question was made with; a request with
  rules keeps every rule a program checks; a tool step is the step the scenario needs. The larger model answers the same
  questions and is counted by the same standard: it is one more answer, not the mark. On one pass's 30 code questions the
  swarm was right on 28 against the larger model's answers and on 24 by the questions' own solutions, the larger model on 23.
- **The answers the larger model agrees with itself on**, where the question has none (a reply in a conversation). It is
  asked up to three times (steps `02-target`, `02-target-self`, `02-target-third`), and the standard is the answers that agree
  ([`support/standard.mjs`](support/standard.mjs)). A reply is good against any of them, read at the reader's line. A
  question none of whose answers agree has no standard: it is left out, and out of what the share is of.

The larger model is the target of the configuration, whichever it is: nothing here names one.

The larger model answers every train question first. Then each question is put to the Swarm and stays in hand until the
Swarm's reply is good ("at parity", in the loop's record) ([`loop.mjs`](loop.mjs)):

1. The Swarm answers as it stands. At parity: on to the next question.
2. Not at parity: where the answer was lost is read from the slots (no drafter had it; a slot had it and it was not chosen;
   it was settled and the writer changed it), each slot's answer read on the line the reply is read on (the reader's own
   for the question's type, 0.8 for a reply in a conversation; read at one half, 10 of 12 questions said to be lost in
   choosing or writing had no slot that met the reply's line). The question's own record then says what to try first,
   before anything is asked again ([`loop.mjs`](loop.mjs) `evidenceOf`):
   - **Lost in choosing:** each way of settling the matter is replayed on the record ([`replay.mjs`](replay.mjs)); one that
     picks the right answer from the same drafts comes first, one that would not is never tried. A model beside the decider
     comes next where the decider was close or overruled the majority. A brief for a slot that already had the answer is
     never tried.
   - **Lost in drafting:** more room for a slot cut off at its token limit comes first, then what makes other drafts (a drafter
     sampled otherwise, one more drafter, the answers sent back). A change to how the matter is decided cannot help here and
     is never tried.
   - **What the larger model writes for a slot is an addition** to what the slot is told, a sentence or two put after it
     (three at most on one brief), never a new brief: asked for replacements it wrote one-sentence briefs that dropped the
     rule an answer is read by, and 2 of 2,546 brought a question to parity. An addition says the class of the question it
     was written for and is offered on that class only; a whole brief it wrote before is not offered. It is told its own
     answer is the standard, and never to teach a role to be shorter or plainer than it.
   - **A change that cannot change the answer is passed over**, at no cost of a try (`effectOn`): for a question in words,
     `byBehaviour` and the try and expect steps (nothing is run on calls there); for a turn with tools, anything but the
     drafting slots. So is a brief that quotes its own question. Neither counts toward the tries a question is given.
   - **Lost in writing:** the settled answer handed over as it is comes first.
   - **A thin reply** (not code, under half as long as the larger model's, wherever it was lost): the writer told to write
     the reply in full (`plan.writeAs: "full"`) comes first. It is never applied where a piece of writing is asked for.

   After that: one of each idea before a second (the same flow change at six places counts once), and the kinds of change
   that have reached parity most often come sooner, learned question after question and pass after pass (shown on the
   swarm's card). A change that does not reach parity but puts the answer on the table (a slot now has it) is built on: the
   next changes are tried on top of it, and what is kept is the changes together.
3. A change that brings the question to parity is a guess that it helps, and **its class decides** (`classKeep` in
   [`policy.json`](policy.json), on). Every train question of the class is scored with the change and as the swarm stands
   (right is 1; else how the reply read, or the share of the question's inputs it gets right), the same questions both
   times. It is **kept** when the mean gain is more than twice its error and at least 0.02, no kind of question falls by
   more than 0.05, and the held questions of the class do not fall by more than their error. It is raced on 8 questions
   first, and asked on the rest only where those did not fall. Kept, it is the arrangement for every question of the class
   after, and an entry on the ledger the spec is made from, with its gain. At the end of a pass the changes that most
   often brought questions of a class closer are proposed for the class outright (6 a class). With `--no-class-keep` a change
   is kept as before: asked again on up to 6 questions already at parity (`GUARD`) and 4 held ones, kept if none is lost.
4. Changes are tried best first, with no limit on how many: from the closest arrangement open, and a change that comes closer
   is built on at once (up to 3 such arrangements open, `beam`). **How the reply itself read comes first** (the reader's
   probability that it says what the larger model's says, in steps of 0.05; each try's line shows it, `reads 0.84`): a
   step up is closer whatever the drafts did, so a change to how the reply is written or chosen can be built on. Then
   where it was lost, how many slots had it, and partial credit: of code, the share of inputs on
   which the nearest answer gives what the larger model's gives; of words, the reader's probability. Where the nearest answer is
   as near, the arrangement whose answers are nearer on the whole (the mean share over every slot) is the closer.
5. **A question is never left short of parity.** Where every arrangement open has been tried, the search widens: what the beam
   closed is opened again, then every arrangement tried on the question is built on. Only `CAP`, a bound a person sets, stops
   it sooner. A question whose mark the larger model did not give again (step `02-target-self-train`: asked a second time,
   its answer was not equivalent to its first) is answered once; at parity it counts, and short of parity it is **set
   aside** as a mark that is partly a draw, not searched, and still counted in the share (measured 2026-11-18: on 36
   questions in conversation the larger model was equivalent to itself on 17, and 18 of the 36 questions then open had
   such a mark). Where that step ran while no reader of answers in words was believed, its second answers are read
   again from the record when training starts ([`support/self-check.mjs`](support/self-check.mjs)). A question
   whose mark its own correct solution proves wrong (a question of code is made with that solution and the inputs it is tried
   on; the larger model's answer gives something else on one of them) is answered once and **set aside**: never searched, and
   never one a change must not lose (`wrongMarksOf`). So is a degenerate mark (the same few characters over and over, as
   the larger model once answered a question about a folder), and one that a question made with its answer (what a program prints)
   proves wrong by that question's own grader. Parity there would teach the swarm the larger model's mistake (measured
   2026-11-17: Nemotron 3.5 Lightning 30B wrong on 7 of a pass's 30 code questions, and 3 of one run's 5 kept changes won on them). It may be
   **set aside** first: after `setAsideAfter` tries in a row (30) that brought it neither closer nor to parity, while another
   question waits, it comes back after the others, on the arrangement they leave. Where the arrangement has not changed by then,
   it gets as many tries again, and where they bring it nothing closer it is written down as not reached (measured 2026-11-18:
   an agent's step came back last, nothing measured it closer, and 1,255 tries went to it). The same holds where nothing else
   waits: back on a changed arrangement it gets as many tries, and on its first visit twice as many, then is written down as
   not reached (measured 2026-11-18: a question back on a changed arrangement, the 35 others set aside on the arrangement as it
   stood, and 2,281 tries went to it).
6. **The found arrangements are tried first.** Every arrangement kept (an arrangement that brought a question to parity and lost
   none already there) goes into a library, `.work/library/<configuration>.json`, kept across passes and Clear training state.
   A question short of parity tries them first, on top of the swarm as it stands, the ones that have brought the most questions
   to parity first; one that works is kept and credited with the question. The library is the list of what makes small models
   reach parity, and it grows with every keep. Every win is also written to `.work/library/<configuration>-wins.jsonl`, which
   Clear training state keeps: the SwOA spec lists all of them, from every run, marking the ones the arrangement carries now,
   and the library is made whole from it each time training starts.
7. **A standing conflict is swapped.** Where changes that bring the question in hand to parity have lost the same question
   already at parity `swapAfter` times (25), a change that loses only that one is kept, and that question goes back in hand,
   taken next. Sooner, where every question they have lost is among the same few (`stableMax`, 2): once those losses together
   reach `stableAfter` (6), a change that loses only those is kept and they all go back in hand. Once each way for a pair, so
   two questions cannot trade places for ever.
8. **What is learned on a class stays with that class** (docs/swoa-classes.md). The swarm sorts every request from the request
   alone into a class (`src/orchestrate.mjs` `classOf`: tools, talk, code, words), and training sorts its questions the same way.
   A change kept on a question goes into that class's own arrangement (`briefs.kinds.<class>`: its slots, plan and flow), never
   into the shared one, which every class without its own runs; it is checked only on that class's questions, and a found
   arrangement is tried only on questions of the class it was found on. Before it is kept it must also lose none of up to
   `heldGuard` (4) held questions of its class at parity (the held guard: held answers decide only whether a change is kept,
   never which is found); and a change whose briefs quote the question it was found on (a name, a number or a quoted phrase
   no other question of its class has) is refused before it is tried.
9. **A stopped run carries on from its last try.** Where the question in hand stands (its record, what was tried, every
   arrangement open or tried, by the changes that make it) is written to `loop.json` after every try; carried on with the same
   arrangement, the search goes on from there instead of from its first try.
10. **The larger model's help comes less often where it brings nothing** (`helpBackoff`). Its suggestions and new briefs each
   cost it started, asked and stopped: on a question where one round of them brought nothing closer, the next comes after twice
   as many tries, and back to every `suggestEvery` / `teachEvery` once one does.

Each change is recorded with how it was chosen (its round, its place among those open, each reason), how close it came (where
the answer was lost, which slots had it, the decider's probability) and what a run took with it. Where the drafts were run in
the sandbox and do different things, saying what each call should give, from the question alone, comes first. Of two kinds of
change that have done as well, the one that has made runs slower comes later. A slot asked exactly what it was asked before
(same model, sampling, seed and messages) answers as it did without being asked again, so a try that changes one slot asks only
what changed, and the decider is not asked again what it was asked before; what that saved is counted, and a run's seconds
include it.

### The loop's own policy, and how it evolves

How the search ranks and bounds what it tries is a policy ([`loop-policy.mjs`](loop-policy.mjs)), not code:

| Knob | What it does (default) |
|---|---|
| `order` | The keys changes are ranked by, first decides most: pinned, the question's record, like a kept change, what has worked, the area for where it was lost, cost, tried least, the plan's order |
| `learnedMinTried` | How many tries a kind of change needs before how often it reached parity counts (3) |
| `momentumRecent` | How many recent kept changes count for momentum: a change that names the same slot, or shares most of its words, comes first (3) |
| `skipWriterUnlessWriting`, `skipDecidingUnlessChoosing` | Leave out what cannot help where the answer was lost (on) |
| `partialCredit` | Count partial credit as closer: the nearest answer's, then every answer's on the whole (on) |
| `batch` | Changes tried from the closest arrangement before the search looks again for the closest; 0 sweeps it first (8) |
| `beam` | Closer arrangements kept open (3) |
| `areas` | The order of areas of change for each place an answer is lost |
| `brokeBudget` | Changes per question built on an arrangement that brought it to parity but broke a question already at parity (12; 0 turns it off) |
| `reviewTries`, `trialTries` | How often the larger model reviews the search (every 40 tries, on any question, with nothing on trial), and on how many tries a proposal is tried (40) |
| `suggestEvery` | After how many failed tries on a question the larger model suggests what to try next (20; 0 never) |
| `teachEvery` | After how many failed tries on a question the larger model says what went wrong and writes new briefs: for the drafters where no slot drafted the answer, for the checkers where one did and it was not chosen (20; 0 never) |
| `adaptAfter` | After how many tries on one question, the larger model's briefs among them, it is flagged as beyond rearranging and the next lever made ready (200; 0 never) |
| `prune` | Try a win of several changes without each part, and keep its smallest form (on) |
| `swapAfter` | Losses of the same question before a change that loses only it is kept and it goes back in hand (25; 0 never) |
| `stableAfter` | The same, sooner, where every question the question in hand's changes have lost is among the same few: their losses together (6; 0: wait for `swapAfter`) |
| `stableMax` | How many different questions such a conflict may span and still be swapped after `stableAfter` (2; 1: one question only) |
| `setAsideAfter` | Tries in a row with nothing closer and no parity before a question is set aside while another waits (30; 0 never) |
| `helpBackoff` | The larger model's suggestions and briefs half as often on a question each time they bring it nothing (on) |
| `kindBranch` | A change that loses only questions of the other kind (code, or words) is kept for its own kind (on) |

A change that brings the question to parity but loses a question already at parity is a CONFLICT between the two. It is
counted: the question this question's changes have lost most is asked first when the next change reaches parity, then the one
changes have lost most overall, so a doomed change fails on its first check, not its third. And it is built on (up to
`brokeBudget` changes), aimed at the question it broke: the next changes are ranked by where that question was lost in its
check, not by where this one had been, since this one is at parity already. One more change may keep this question and give
the other back, and is then kept together. The page and the review name each conflict.

Every `reviewTries` tries, with nothing on trial, the larger model is started and shown the loop's
record (where each answer was lost, how many tries, what reached parity, each kind of change's tries, successes and cost, the
found arrangements, the conflicts), every knob with its bounds and value, and what came of earlier proposals. It proposes a change to at most two knobs, each checked
against its bounds (anything else is refused and written down). The change is tried on the next `trialTries` tries (40) and measured
against as many before it (what each try came to: kept 10, at parity but losing one already there 3, closer 1, nothing 0): kept
where they came to at least as much, put back where less; with no signal on either side (every try came to nothing) it is inconclusive, and put back. The larger model is shown the proposals refused before, so as not to make them again. Counted in tries, not questions: over the first night, two long
questions meant one review, and its trial never ended. Ideas it has that no knob can carry are
written down for a person. The policy, every proposal, and a trial still running are kept in
`.work/library/<configuration>-policy.json`, carried from pass to pass and kept by Clear training state. `SWARM_LOOP_REVIEW=0` turns the review off.

**The larger model also suggests what to try.** After `suggestEvery` failed tries on a question (20), it is shown that question,
what was tried on it and how close each came, the arrangement the next tries build on, the found arrangements and the conflicts,
and the changes still open from it by name; it names up to five to try, each one change or two or three together. Names are
matched to that list (anything else is left out) and tried at once, on top of that arrangement: each try is its own test, so a
suggestion needs no trial, and one that brings the question to parity is kept like any change. Each suggestion starts the larger
model, asks and stops it: how often it was asked, what that cost in seconds and what its tries came to (kept, closer) are counted,
shown on the page, and given to the review, which can make suggestions more or less frequent.

**The larger model teaches.** After `teachEvery` failed tries on a question it is shown what the failing slots wrote and the
answer wanted: the drafters where no slot drafted it, the checkers (then the drafters whose answers stood) where one did and it
was not chosen. Of the drafters, the two nearest the answer are taught first (by the share of inputs their answer already gets
as the larger model's does), not the first two in order. It first says what went wrong as a general mistake, then writes briefs
that teach the method (never the question, its numbers or its answer); they join this configuration's candidates and are tried
at once. A brief that gives a question away anyway is refused, said and counted (`support/teach.mjs` `givesAway`): one that holds
code (a variable set or a remainder taken counts: "Let k = 4 % length"), names a function a question asks for (by its stem:
`rotate`, "rotating"), or uses a number of the question it was written on. The pool passes over any brief written before that
holds code or names such a function. The larger model is started the
first time it is asked on a question (a review, a suggestion, briefs) and kept loaded until the question ends.

**A reply that describes the answer is an answer lost in writing.** Where the writer's reply says what the answer is instead
of giving it (src/read.mjs `describedNotGiven`), the swarm has another model write it, or sends the draft; the loop counts that
question as lost in writing, tries changing the writer first, and says that the writer described the answer.

**Evaluated apart, pretrained before.** Training's parity is measured on its own questions. How equivalent the swarm is on work
it was never trained on is measured apart ([`evaluate.mjs`](evaluate.mjs), the page's Evaluate the swarm): the standard tasks of
lm-evaluation-harness for each body of work chosen, asked of the larger model and of the swarm, every question's two answers
compared. Calling a function and searching have no task there, so Tools and Search are measured by a second harness, the
Berkeley Function-Calling Leaderboard's own package ([`support/bfcl.mjs`](support/bfcl.mjs)): the larger model and the swarm
are offered the same functions in the same request, and paired on the package's verdict. Its web search test runs the
searches a model asks for, through a SearXNG the evaluation serves on this machine for the run ([`search.json`](search.json),
[`support/search.mjs`](support/search.mjs); no key; installed into `.work/searxng` the first time). What each query returned is
kept for the day, both models are always asked on the same day, and the result names the search. `bash training/evaluate.sh --proof` asks each task at the size a verdict needs.

**How the larger model is served can hide what it can do.** On the function-calling test it is asked two ways, the tools in
the request and the tools written into the conversation, and counted by the way it scores higher by over the capability
([`evaluate.mjs`](evaluate.mjs) `wayByItem`): its server returns only the first of the calls its model writes, and with tools
in the request it more often replies in words. In training it is still asked the one way, with the tools in the request
([`target.mjs`](target.mjs)). So on training's own tool questions the larger model's count beside the module's is a low one
wherever a question needs more than one call; the module's grade does not depend on it there, since those questions carry
their own standard. Pretrain (the page; `node training/adapters.mjs train`) trains a LoRA adapter for each small model on the larger model's
answers to the train questions, before or between passes; served with them, the swarm the loop rearranges is an adapted one.

**Beyond rearranging.** The small models never change: training rearranges them and rewrites what they are told. A question that
resists `adaptAfter` tries, the larger model's teaching among them, is flagged once, and stays in hand. The next lever is made
ready ([`adapters.mjs`](adapters.mjs)): the larger model's answers to the pass's train questions (never a held one) as a dataset of
chat pairs, and whether each small model can be trained here. The trainer is MLX ([`mlx-setup.sh`](mlx-setup.sh) installs it under
`.work/mlx` and fetches each model's original weights at a pinned revision): llama.cpp's own `llama-finetune` cannot train any of
the three (measured with build 12110: LFM2.5 1.2B's `SSM_CONV` and Qwen3.5 2B's and Bonsai 2 4B's `SIGMOID` have no backward pass).
`node training/adapters.mjs train` trains a LoRA adapter on that dataset for each model that can be
([`support/mlx_adapter.py`](support/mlx_adapter.py); an example longer than 2,048 tokens is left out, since cutting it would cut
the answer), writes it as a GGUF LoRA for the file the swarm serves, and keeps it only where llama.cpp, loading it with `--lora`,
finds the trained answers likelier with it than without (its perplexity on them). Measured 2026-11-17 on the 84 train answers:
LFM2.5 1.2B 3.23 -> 2.56 after 30 steps, Qwen3.5 2B 2.70 -> 2.63 after 30. Bonsai 2 4B is not trained: its weights are
Hadamard-rotated and load only through its maker's runtime (the other Bonsai 2 sizes likewise); nor is LFM3 1.7B, whose
architecture mlx-lm 0.32.2 does not have. Every small model of the catalog names its original weights in
[`originals.json`](originals.json), or why it cannot be adapted; where none of the swarm's can be, Pretrain cannot be pressed,
and says why. Trying an adapter as a change (a member served with it, kept only if
it brings a question to parity and loses none) is not built.

**A win is kept in its smallest form**: one of several changes is tried without each part, and a part is dropped where the
question stays at parity and no question already there is lost.

The small models are never shown the larger model's answer: only the grading is. A swarm built from the spec has no larger
model beside it, so nothing is kept that needs one. And nothing is chosen on the held questions: a pass ends by measuring the
Swarm on them, and that is the number reported.

What is trained:

| Part | How |
|---|---|
| The drafts, the checks, the write | What each slot is told (its brief): candidates in [`candidates/`](candidates), from the larger model ([`write-briefs.mjs`](write-briefs.mjs)), and from what other configurations kept |
| The arrangement | Which model drafts and which checks, how many of each, what a checker sees, how freely a drafter samples, how the matter is settled, the flow: every arrangement one change away ([`arrange.mjs`](arrange.mjs)) |
| The decision | The decider, whichever decision model the configuration names, decides ([`../src/decider.mjs`](../src/decider.mjs)); a plan can put a small model beside it. Fine-tuning a decider on the questions the drafts disagreed on is not built: each decides as it was published |

The two small models' weights are not changed: they stay as their makers published them. There are countless arrangements of
them, and the one that reaches parity with the larger model is found by trying, question after question.

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
| The one being chased | `target` in this machine's `training/state.json`. The first is **Nemotron 3.5 Lightning 30B**, served by TensorFold on the Mac the Swarm is first trained on |
| At parity | Every answer the Swarm gives to the held questions is equivalent to the larger model's answer. [`state.mjs`](state.mjs) `parity()`. Then the next, larger model becomes the target |
| What it is trained on | Every body of work in [`equivalence.json`](equivalence.json): The Crew, Code, Math, Logic, Reasoning, Instructions, Tools, Search. Nothing is chosen (a person once ticked which, on the dashboard, and `equivalence` in `src/config.json` named them; neither is read now). The module picks its arrangement by the class of a request, not by the body of work, and a change is kept only when no kind fell, so a kind a pass does not ask is a kind nothing protects. Each body of work is a list of kinds of question, and the standard benchmarks Evaluate the swarm measures it on (`benchmarks`: never asked in training); a pass asks the kinds of them all, 28 today, and more of the kinds the pass before found the swarm short on (`focus`). A pass ends on the questions it began with, which its record names (`kinds`): one begun when fewer were asked ends on those |
| Your own questions | Under the models, a button for each body of work opens its questions: the kinds the trainer makes, and questions a person writes, saved to [`questions/<id>.json`](questions/README.md) (200 at most; for The Crew each says Simple or Developer). Every second one is held back. They are judged as a reply in a conversation, they are asked beside the ones made (an addition, never a choice), and a pass keeps the ones it began with (`own` in its record) |
| A reply in a conversation (The Crew) | [`tasks-crew.mjs`](tasks-crew.mjs): six kinds, four in Simple and two in Developer, each sent with the system line a seat is given and the turns so far. Equivalent when it is the same **act** (both help, or both ask), the same **substance** (Kev, one request with three yes-or-no questions), and breaks no **convention** the larger model's reply kept (read off the words: `faultsOf`). The page says which of the three a reply was lost on. The reader is checked on 18 pairs before a pass believes it (`readers.mjs` `talkPairs`: paraphrases, near-misses, different replies), and on near-misses made from the larger model's own replies; measured 2026-11-16 with Kev-4B on the first 14 (no near-misses yet): 14 of 14 |
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
the machine), the small models, the decider (its program, or its file), and the larger model's file. It recovers by itself where it can: a download
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
| `bug` | What is wrong with a function, in a sentence or two | The judge, else the decider, says the two answers say the same thing |

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

A pass ends by writing down what the next one needs (`state.json`, kept on this machine and not committed), and begins by reading
it. Running the session again is not the same pass again:

| What a pass leaves | What the next pass does with it |
|---|---|
| The kinds of question the Swarm answered differently from the target on | Asks more of those kinds on the train questions |
| Each slot's record: how often it had the larger model's answer, how often the decider threw that answer away, how often the writer changed it | Plans from it: which changes speak to where answers were lost |
| The arrangement as the kept changes left it | Starts from it |
| A search for each kind it answered differently on | Asks arXiv those, with the standing questions |
| Every paper already seen | Reads only what is new |
| Ideas from the reading, each with what became of it | Measures the ones still open |
| Whether it reached parity | Names the next, larger target, and new held questions to meet it on |

`passes.md` is the same, for a person (on this machine, not committed): what each pass measured and what it handed on.

## An agent's steps (2026-11-16)

The Crew's seats work through an agent (Pi) with tools: read a file, list a folder, write a file, edit one. The `agent` kind
([`tasks-tools.mjs`](tasks-tools.mjs)) asks for the next step at a point in such work: the request, and what the agent has done
and seen so far, sent with the tools. The larger model, each small model alone and the swarm are all asked with the tools
(the servers with `--jinja`, so calls are read and written in each model's template), and every step is written down as text
(`CALL read {"path":"src/math.js"}`). Two steps are equivalent when they are the same tool on the same file, the same words
written, the same change made (each side's old and new text found in the other's), or both a reply in words.

The swarm takes these steps as the configuration says (`"tools"` in `src/config.json`): decided by the swarm, or taken by the
one small model it names.
Either way it is what is measured.

## The plan of a pass

The plan ([`plan.mjs`](plan.mjs), to `.work/train/<configuration>/plan.json`) says what can be tried and in what order, from
the last measurement of the Swarm on train questions. The loop tries from it, on the question in hand, by where that
question's answer was lost.

| It finds | From | Moves that speak to it |
|---|---|---|
| No slot had the larger model's answer | answers that differed, less those a slot did have | Another brief for a drafter; one more drafter; a drafter sampled more or less freely; a drafter moved to the other model |
| A drafter well under the best | each drafter's own record | Its brief; moving or dropping it; its temperature |
| A checker less often equivalent than the best draft | each checker's own record | Its brief; what it is shown; moving or dropping it |
| The decider had the answer and chose another | the decider's record | One worked answer for each different answer; what the checkers are shown; one more checker |
| The writer changed the settled answer | the writer's record | Its brief |
| A slot said nothing | each slot's record | Its brief; moving or dropping it; more room to answer |
| A slot cut off at its token limit on 4 in 10 or more | each slot's stops at its limit | More room to answer: its token limit raised by half, to 2000 at most |
| A drafter that does what another on its own model does, 8 in 10 or more | what each drafter's answer did, beside its mate's | Its temperature; moving it; telling it what another drafter is told; another brief |
| The decider not answering in time on 1 in 10 or more | the decider's timeouts | None here: the engine's wait grows with the decider (three times its slowest recent decision, up to 30 s) and asks a timed-out decision again |

Every move open to the pass (each candidate in [`candidates/`](candidates), each idea the reading left, each arrangement one
step from this one) is scored by the answers the findings it speaks to account for, and that is the order the loop takes
them in within an area. What an earlier pass tried and dropped is not chosen. A move the measurement does not point at can still be in the plan, marked as such,
when there is room: a pass tries what no pass has.

The plan is written when the pass begins, from what the last pass left, and again once the larger model has written new
briefs. `loop.mjs` marks each move as it tries it: being tried, then kept or not kept, with how many questions it was tried
on and how many it brought to parity. The dashboard shows it as it stands, under the questions in hand.

The last three rows were added on 2026-11-16 from a measurement of 41 questions: a-steps stopped at its limit of 700
tokens on 38 of 41 (its empty drafts were cut-off ones), one model's two drafters did the same 22 times of 25, and every one of
the decider's 8 misses in 40 was the fixed 8-second wait (its median was 5.8 s), each one the answer most slots gave standing
in its place. A general change to the flow is not credited with answering any of them.

A score in the plan says where to look first. It is not a measurement: a move is kept by the one rule, higher on train and
not lower on held.

## What is kept, and where

A change that is kept is written to this configuration's own record, `src/learned/<a>+<b>+<decider>--<target>.json`
([`src/learned.mjs`](../src/learned.mjs)): the arrangement as it now stands, and an entry on its ledger saying what changed,
where it came from, and the answers equivalent to the larger model's before and after, on train and on held. `pass.mjs end`
adds where the pass left it. `src/briefs.json` is never changed by training: it is where every swarm starts. The dashboard's
SwOA spec reads the record out, and grows as a pass keeps things.

**Across configurations** ([`support/across.mjs`](support/across.mjs)): every other configuration's record is read, never
written. An arrangement, flow or plan change kept there, by name, is planned first here (its reason in the plan: kept in
another configuration), and a brief kept there for a slot of the same name is a candidate for that slot (`plan.mjs`,
`loop.mjs`). Kept here only on evidence here. Each small model measured alone against a larger model
(`results/<configuration>/<model>-alone-vs-<target>-held.json`) and each configuration's latest pass against it (`states/`) are
shared the same way: the dashboard recommends a swap where a model alone, on the same held questions, beat the weakest member by
more than one model's runs there differ (5 points at least; a model measured twice counts by its mean), and a configuration
further along against the same larger model. Any small model of the catalog can be measured alone, in the swarm or not:
`node training/setup.mjs --model <id>` fetches it, `node training/baseline.mjs --who model:<id> --split held` measures it.

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
| The pass it is in: each step's status and output, its plan, the questions the loop has finished, its reader's verdict | `.work/train/K/` |
| Every answer, each row marked with whose it is; answers as they are written; measurements already made | `.work/train/` (shared) |

A session opens the pass where it was left (`support/steps.sh`: `open_pass`): the same pass if it had not finished, with the
steps that ended well passed over. Stopping, training another configuration and coming back loses nothing of either.

## The flow is trained too

The order of steps is part of the arrangement (`flow` in `src/briefs.json`; [docs/architecture.md](../docs/architecture.md)).
`arrange.mjs` (`flowMoves`) lists every flow one change from the current one beside the changes to the slots: the answers sent back
to their drafters after a check, a loop of checking and revising, a decision that keeps the likeliest two before the one that
settles, a step taken out, a loop made longer or undone, a second writer with the decider picking the reply. A flow that is
kept is where the next pass starts, so over passes the flow can grow into shapes nobody wrote down. Each is kept by the one
rule: higher on train and not lower on held.

A longer flow costs time, not memory: the same two small models and the same decider answer more turns.

## Five rules a pass keeps

Taken from how The Crew is trained, where each was learned the hard way.

| Rule | What a pass does |
|---|---|
| Watch before acting | [`replay.mjs`](replay.mjs): from the Swarm's last measurement on the train questions it counts what each way of choosing between the answers would have won (`plan.decideBy`: `decider`, `most`, `decider-if-confident`, `decider-unless-majority`; a plan written with the old names, `kev`, `kev-if-confident`, `kev-unless-majority`, reads as the same), and the plan ranks those ways by that count. Only a change to how answers are chosen can be replayed; a change to a brief or the flow makes different answers and is tried for real |
| A reader is checked before it is believed | [`readers.mjs`](readers.mjs): paraphrases (the same answer in other words), near-misses (one fact changed; some written, some made from the larger model's own replies by changing a number) and different answers. Under four in five overall, or three in four of the paraphrases or of the near-misses, answers in words are not compared this pass |
| An undecided reading is one | [`support/equivalent.mjs`](support/equivalent.mjs) `UNDECIDED`: a reading within 0.1 of the reader's line is graded different, marked undecided, counted apart on the page, and left out of the keep rule (`bench.mjs` `paired`) |
| The larger model against itself | `baseline.mjs --who target --self` (step `02-target-self`): the held questions again, from its fourth draw on, graded against its own first answers by the same readers. The page shows it beside parity as the noise floor. Step `02-target-self-train` does the same for this pass's train questions, and those it disagrees with itself on are marked in the loop (and searched until parity like the rest) |
| A judge apart from the decider | `"judge"` in `src/config.json`: `session.sh` serves it beside the decider (its own port, not the decider's port file) and the trainers read with it (`SWARM_JUDGE`, `bench.mjs` `judgeAddress`). Where none is named or it will not start, the decider reads, and the session says so |
| No flip goes unnamed | `pass.mjs end` names the held questions lost and won since the pass before, in `passes.md` and on the Swarm's record |
| Every question a second way | The held questions with their wording changed and what they ask unchanged (`tasks.mjs`: `reword`), each compared with the larger model's answer to the first wording |
| A bar that is held tightens | A kind at parity on the held questions for `ratchet.passes` passes in a row is asked half as many again from the next pass, up to `ratchet.max` times |

## The trainer trains by a policy

How a swarm is trained is data: [`policy.json`](policy.json) is where every configuration starts, and a configuration can
carry its own values over it in its record (`training/states/`: `policy`), set by a person.

| Setting | What it is |
|---|---|
| `loop.cap` | How many changes are tried on one question before it is written down as not reached (none: until parity, or until a round brings it no closer; a question may be set aside before that, `setAsideAfter`) |
| `loop.guard` | How many questions already at parity a change is asked again on before it is kept; it is kept only if none is lost (6) |
| `loop.drop` | A change tried on this many questions that brought none to parity is not tried again (none: every change stays open) |
| `loop.beam` | How many of the changes that came closest the next round builds combinations on (3) |
| `plan.arrangements`, `plan.wild`, `plan.depth` | What the plan lists first: how many arrangements one change from here; how many that are several changes away at once; how many changes those are |
| `moves.weight` | How much each kind of move (brief, plan, arrangement, flow) counts for when the plan ranks what to try |
| `ratchet.passes`, `ratchet.max` | When a bar that is held tightens |

## When something goes wrong

| What goes wrong | What is done about it |
|---|---|
| A model server stops or hangs in the middle of the work | It is started again and the question is asked again. Slots waiting on the same server share the one restart |
| A model server will not start | Tried the way that fits why: without a flag an older llama.cpp does not know; with half the context, then a quarter, where memory is short; once more otherwise |
| The larger model's reply holds no answer | Asked again, with another draw, twice. Still nothing: that question is not compared, and is counted as such |
| The larger model's server stops | Started again, and the question asked again |
| The larger model's server says it is restarting | Waited for, and asked again the same way |
| The larger model's engine does not know a flag it is better served with | Served without it, and that is recorded |
| The decider stops | Started again before the next step. Its port is found free at the start of the session |
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
| [`plan.mjs`](plan.mjs) | `make` reads where the answers were lost and writes the plan; `show` prints it |
| [`loop.mjs`](loop.mjs) | Training itself: each train question in hand until it is at parity, changes tried on it one at a time, a change kept only if no question already at parity is lost |
| [`research.mjs`](research.mjs) | Asks arXiv the questions in the state, keeps what no pass has seen, and writes it to `research.md` (on this machine, not committed) to be read |
| [`baseline.mjs`](baseline.mjs) | One model by itself. The target (`--who target`) goes first: its answers are the mark. Each small model alone is then marked against them. A model that has answered these questions is not asked again |
| [`measure.mjs`](measure.mjs) | The Swarm on the questions, and every slot on its own account |
| [`arrange.mjs`](arrange.mjs) | What can change: every arrangement one change from the one in hand, every flow one change away, and a few several changes away. It tries none; the loop does |
| [`setup.mjs`](setup.mjs) | Fetches and makes ready the engine, the models and the decider the configured swarm needs, recovering by itself where it can |
| [`decider.sh`](decider.sh) | Installs and runs the configured decider beside the Swarm, inside `.work` (Kev in `.work/kev`; StartLux and llama.cpp deciders in `.work/deciders`), by the recipe in its `src/models.json` entry (`serve.kind`). The session starts and stops it. A decider that needs an NVIDIA GPU is not started here: its entry carries its maker's instructions, and it is named with `SWARM_DECIDER` |
| [`publish.mjs`](publish.mjs) | Writes what was measured on `held`, and how it stands against the target, to `src/trained.json`, this machine's summary for a model card (not committed). A finished spec is published from the dashboard to `specs/` |
| [`session.sh`](session.sh) | Pass after pass, one step at a time, each pass from the one before, until it is stopped. `PASSES=3` runs three and ends. A pass that stopped is resumed. Passes that are over in under a minute did no work: after five in a row it stops and says so |
| [`support/recover.mjs`](support/recover.mjs) | The ways back, and the record of each one taken. `reap` stops what a dead session left running |

Two numbers from `measure.mjs` say where to work:

- **lost**: a slot had the larger model's answer and the reply did not. The fault is in the checks, the decision or the writer.
- **beyond**: no draft had it and the reply did. Checking found what drafting did not: the Swarm doing more than its parts.

## Research

Every pass asks arXiv what has been published on what the last pass left open. Only titles and abstracts are read, one
request every three seconds, as arXiv asks. An abstract says what a paper claims, not how well it holds, so reading changes
nothing by itself. A reading becomes an **idea**: a candidate for one slot, with the paper it came from. An idea changes the
Swarm only if the loop keeps it.

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
4. `node training/plan.mjs make`, and read it.
5. `node training/loop.mjs`. It prints each question, each change tried on it and each one kept. Read the rows in
   `.work/train/swarm-runs.jsonl` for the questions it did not reach: what did the slot actually write where it failed? Write
   candidates for it in `training/candidates/<slot>.json` from what you read; the next pass tries them.
6. `node training/measure.mjs --split held`.
7. `node training/pass.mjs end`, then `node training/publish.mjs`.

## Rules

- No model is loaded outside a session. `session.sh` loads the decider when it starts and unloads it when it ends, however it ends;
  each step loads and unloads the small models and the target it uses. By hand: `bash training/decider.sh serve`, and `stop` after.
- One trainer at a time. Two share the machine and spoil each other's times.
- Do not run the checks (`npm test`) beside a session: they stop nothing of it, but they take its processor.
- A count is not a finding until the replies behind it have been read.
- The held questions choose nothing. If a change is made after looking at held results, the held seed is spent: change it in
  `state.json` and say so.
- A brief that makes its own slot look better and the reply worse is not better. The loop grades the reply.
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
| Another small model | The other small models on this machine are asked the questions no slot drafted; the page says how many each answered. Adding one stays yours | `members-probe.mjs`; step `12-members` |
| Another decider | The recorded choices of a measurement are put to another decider whose weights are here; the page says what it would have recovered and lost | `decider-replay.mjs`; step `12-deciders` |

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
