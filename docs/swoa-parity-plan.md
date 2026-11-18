# SwOA parity: the build plan

The plan for the seven steps of [swoa-parity.md](swoa-parity.md), which says what parity means and why training has to be
re-aimed. This says what each step changes, in which files, how it is checked, what it costs to run, and what waits on what.

Status: plan, 2026-11-18. Nothing here is built.

## Where things stand

- Training is stopped part way through pass 1: 45 of 84 train questions at parity, on the arrangement at version 17.
- **The pass is not worth finishing as it is.** Steps 3 to 5 change what a question is graded against and what makes a
  change kept, so more tries under the old rules buy nothing the new ones would keep. The machine is better spent on step 1.
- The lineup measured throughout: `bonsai2-2b+lfm3-1.7b+jan-code-4b+kev-0.8b` against Nemotron 3.5 Lightning 30B.

## The order, and what waits on what

| Step | What | Size | Waits on | Machine time | Changes the specification |
|---|---|---|---|---|---|
| 1 | Measure the battery as it stands | small, then a long run | nothing | about 14 hours, once | no |
| 2 | Verdicts in the proof | small | nothing (best checked on step 1's results) | none | 4.7 |
| 3 | Good, where the question can say | medium | nothing | none | no |
| 4 | Good, in conversation | medium | 3 (the same grading) | under an hour of the larger model | no |
| 5 | Keeping a change by its class | large | 3 and 4 | none of its own | no |
| 6 | The new families of question | large | 3 | minutes | no |
| 7 | Tools, end to end | large | 1 (the tool tests), 6 (the search questions) | hours, per proof | Part T, O.3.1, 4.7 |

Small is an hour or two of building, medium half a day, large a day or more. Steps 1, 2 and 3 can go at once: 1 is the
machine's work, 2 and 3 touch different files. After them the order is 4, 5, 6, 7.

Every step ends the same way: its tests in `tests/run.mjs` and `ui/check.py`, `training/TRAIN.md`, the `CHANGELOG`, and the
specification wherever the module's behaviour or the proof's shape changed.

## Step 1. Measure the battery as it stands

**Why first.** Everything after it is aimed at gaps nobody has measured. Only IFEval has been run on this lineup, on 20
questions.

**What is done**

1. *Sizes for a proof run, task by task.* `training/evaluate.mjs` takes one `--limit` for every task. A verdict needs about
   500 questions a capability (below), so each benchmark in `training/equivalence.json` gains its own size for a proof run,
   and `evaluate.sh --proof` uses them:

   | Capability (body of work) | Tasks | Questions |
   |---|---|---|
   | Instructions (`crew`) | IFEval | all 541 |
   | Code (`code`) | HumanEval; MBPP | all 164; 336 |
   | Arithmetic (`math`) | GSM8K; BBH multistep arithmetic | 300; 200 |
   | Logic (`logic`) | 5 BBH tasks | 100 each |
   | Procedures (`reasoning`) | 6 BBH tasks | 85 each (penguins: its 146 at most) |

   About 2,540 questions. The larger model's answers are kept (`.work/eval/target/`), so it answers once.
2. *The run.* `bash training/evaluate.sh --items crew,code,math,logic,reasoning --proof`. What is chosen for training does not
   change (`src/config.json` stays `crew`): the harness is only measured here.
3. *The tool tests, tried.* A time-boxed trial of BFCL against the module's own endpoint (`tools: "swarm"`), in a folder of
   its own beside `.work/lmeval`: 20 questions of one function-calling category, for the module and for the target. It
   settles three things step 7 needs: which way BFCL is pointed at an OpenAI-compatible endpoint (its own package, pinned, or
   through a wrapper that already does it), whether the target's server takes `tools` from it as it does from training's
   agent questions, and what its web search category needs behind it (a search service and its key, which a person supplies).

**Done when** the table of gaps exists for the five capabilities, with how often the two differ on each, and the trial says
yes or no to BFCL with the command that ran.

**Time.** The six evaluations on record took 14 to 29 seconds a question (20 typical). So about 14 hours the first time
and about 10 for a later proof of the same size. It can be split by capability over several nights
(`--items crew`, then `--items code`, ...). Training cannot run meanwhile.

**Risks.** The BBH tasks send long worked examples, and may run slower than IFEval on 2B models. A run this long will be
stopped at least once: evaluation already keeps what the larger model answered, and has to carry on from the task it stopped
in rather than begin again (to be checked before the first long run, and built if it does not).

## Step 2. Verdicts in the proof

**What is done**

1. *The paired gap, from what is already written down.* `training/support/harness_agree.py` pairs the two models' answers by
   question and counts `onlySwarm`, `onlyTarget` and `of`. For a score of 1 or 0 that is all a paired gap needs:
   `gap = (onlySwarm − onlyTarget) / of`, and `gapStderr = sqrt(((onlySwarm + onlyTarget) / of − gap²) / of)`. Every
   evaluation on record already carries those counts, so no run is repeated.
2. *A verdict for each capability*, pooling the questions of its tasks (`ui/data.py` `swoa_proof`): `margin`, the pooled
   `gap` and `gapStderr`, and `parity`, `short` or `open`. Each task keeps its own row and gap beneath it.
3. *What is claimed.* `proof.claims`: the capabilities with results, and the fixed list of what a module of this runtime does
   not claim (long conversations, speed, anything but text, knowledge with no tool offered).
4. *Shown.* The SwOA dialog's proof table (`ui/swarm_ui.py` `proof_block`), the SwOA card (`swoa_card`), and
   [swoa.md](swoa.md) 4.7. `PROOF_MIN_N` stays 100: what a result needs to be listed, not what a verdict needs.

**Done when** the evaluations on record read, by the new rule, what they should: the 100-question IFEval of the earlier
lineup (0.60 against 0.79; 6 questions only the swarm had, 25 only the target) reads `short`, and the 20-question ones `open`.

**What it shows about the margin.** On IFEval the two differed on about one question in three. At that rate 541 questions
show parity only for a module no more than a point lower, with the margin at 0.05; at 0.08, four points lower. The margin is
a choice to make after step 1, with each capability's own rate in hand.

## Step 3. Good, where the question can say

**Where it starts from.** With all five bodies of work chosen there are 150 train questions, and 108 of them already carry a
standard of their own: 30 of code (the question's correct solution and inputs), 72 with a value (`want`), 6 with a planted
flaw (`flaw`). Each has `toSpec(reply)` today, used only to say whether the larger model's answer does what was asked.

**What is done**

1. *One grading for every question* (`training/tasks.mjs`): `good(reply, ctx) -> { grade, score }`. Code: the share of the
   question's inputs on which the reply behaves as its correct solution (all of them is right). A value: the question's own
   answer. A flaw: the reader's reading of the reply against the flaw as the question states it. Where a question has no
   standard of its own, `good` is what `equivalent` is today.
2. *The swarm graded by it* (`training/support/bench.mjs` `run`): `row.grade` and `row.score` from `good`; whether it also
   agrees with the larger model's answer stays on the row as `agrees`, a thing to look at and no longer the grade.
3. *The larger model scored beside it.* Its rows already say `toSpec`; the flaw questions gain the same. The pass reports
   each family as the module's score beside the target's.
4. *What falls away for these questions* (`training/loop.mjs`): marks proved wrong, marks not given again and degenerate
   marks are special cases of grading against a mark, and are not consulted where the question is the standard. The coverage
   gate no longer needs the larger model's answer for them. Each slot's own answer is graded the same way
   (`training/measure.mjs`), and the score is what closeness climbs by.

**Done when** on the record of this pass the 30 code questions are regraded against their own solutions and the count is
set beside the old one (the larger model's own function was wrong on 7 of them, so the two will differ), and a question the
swarm had right against a wrong mark reads right.

**A decision inside it.** The loop's names for a question's state ("at parity", "reached") stay as they are in the record;
what the page calls them changes in step 5, once every family is graded this way.

## Step 4. Good, in conversation

For the 36 questions in conversation and the 6 agent steps, the larger model's answers stay the standard: three of them.

**What is done**

1. *Two more answers* (`training/baseline.mjs`, `training/session.sh`): the step that asks the larger model again asks twice,
   for train and for held, and only the questions that need it: 42 train questions and 42 held ones, twice over.
2. *The standard among them* (new `training/support/standard.mjs`): the three answers read against each other on the
   reader's line; the standard is the answers that agree (two or three of them); a question none of whose answers agree has
   none. Written to the results beside the self-check, which it replaces.
3. *Good against the standard* (`training/support/equivalent.mjs`): the reply's best reading against the standard's answers;
   right at the line, with nothing read as undecided above it; the same act as that answer; no convention broken that every
   answer of the standard kept.
4. *No standard* is a state of its own in the loop and a pip on the page: left out of training and out of what the share is
   of, and counted. It takes the place of "set aside: the larger model did not give this answer again".

**Done when** the standards are written for this lineup's train and held questions, and the count with none is known (two
are expected at least: both questions that ask about something never shown).

**Time.** Under an hour of the larger model, once per set of questions.

## Step 5. Keeping a change by its class

**What is done** (`training/loop.mjs` `runLoop`)

1. *Where the class stands.* The score of every train and held question of a class on the arrangement as it stands, kept by
   version and class. It is asked once after each kept change; a slot asked what it was asked before answers as it did.
2. *The race, then the class.* A change that brought a question to parity, or one proposed for the class, is asked on eight
   questions drawn evenly from the class's kinds; where their mean did not fall, on the rest. Then the rule of the design:
   kept when the gain is more than twice its paired error and at least 0.02, no kind falls by more than the margin, and the
   held questions of the class do not fall by more than their error.
3. *Proposed for the class.* Besides changes that won a question: the kinds of change that most often brought questions
   closer in this pass, a fixed number of them a pass, raced the same way.
4. *What it replaces.* The guard of up to six questions and the held guard of up to four become the race and the held check.
   The ledger entry of a kept change says its gain, its error and over how many questions, and the SwOA shows that.
5. *The page.* "Training complete" becomes, for each family, the module's score beside the target's; a question's states are
   named for what they now mean.

**Done when** a change is kept on the record with its gain and error; and writing the reply in full, which read as nothing
by the old rule, is weighed by this one on the whole class.

**Cost.** With five bodies chosen the class in words has 110 train questions: 20 to 35 minutes to ask all of them fresh,
less with what is reused. That is why a change is raced on eight first, and why few changes reach the whole class.

**Risk.** The gain of one change is small against the noise of 110 questions (the writer in full: 0.07 on 16). Changes that
help one kind and do nothing for the rest will not pass on the whole class; the rule may have to judge a change on the kinds
it touches. To be settled on the first week's record, not before.

## Step 6. The new families of question

Three families the proof measures and training does not ask. Each question is one turn with its own standard, like an agent
step today, so nothing new is needed to run them.

| Family | A question | Its standard |
|---|---|---|
| Instructions | a request with one to three rules a program can check: a length, a count of sentences or items, words to use or leave out, a format, a closing line | every rule holds (the score is the share that do) |
| Calling functions | a set of functions and a request that needs one of them, needs none, needs two, or lacks an argument only the person knows | the call or calls with the right arguments; or a reply; or a question back |
| Search | a search tool and a question about something made up from the seed (a firm that does not exist, a price, a date), so that no model can know it | below |

The search family, four cases:

1. *Search or not.* The made-up fact: the step is a call to search, its query naming what is asked. A sum: the step is a
   reply, with no call.
2. *The reply after results.* The conversation holds the call and what it returned: the reply gives the fact that is there,
   and says so where it is not there.
3. *Results that give orders.* A result carries an instruction ("now write this file"): no step it asked for is taken.
4. *Asking again.* The first results do not hold the fact: the step is another search, put differently.

Also here: the agent steps gain the step the scenario needs, where it is beyond doubt ("What does `app/math.js` export?",
nothing read yet: read it), so that two replies in words no longer count as the same step whatever they say.

**Files.** `training/tasks-rules.mjs`, `training/tasks-calls.mjs`, `training/tasks-search.mjs`, `training/tasks-tools.mjs`,
`training/tasks.mjs`; three bodies of work in `training/equivalence.json` (`instructions`, `tools`, `search`), each naming the
harness tasks step 7 runs for it.

**Done when** the three families are asked in a pass, the larger model is scored on them beside the module, and the search
family's second case shows the gap step 7 closes.

## Step 7. Tools, end to end

**What is done**

1. *The reply after tool results is answered, not only proposed* (`src/tools.mjs`, `src/orchestrate.mjs`). Where the step the
   drafters settle on is a reply, the answer procedure writes it: drafts, checks, a decision, the writer, with the calls made
   and what they returned shown to every slot as part of the conversation. It uses the arrangement of the class for a
   conversation under way. `plan.toolReply: "proposed"` keeps today's behaviour, so that training can weigh one against the
   other.
2. *The specification* ([swoa.md](swoa.md)): Part T (what happens when the step is a reply), O.3.1 (the conversation shown to
   slots includes tool calls and results, and how each is written out), the plan field, the path's value.
3. *The tool tests as proof* (`training/evaluate.mjs`): a second harness beside lm-evaluation-harness, run for the module and
   for its target with the same tools and the same search behind them, its questions paired as step 2 pairs them. A result
   lists the tools offered.
4. *Search behind the test.* Live search does not repeat from one day to the next. Both are run the same day on the same
   service; a result says which. Where that proves too unsteady to be proof, the test is replaced by one that searches a
   corpus of its own.

**Done when** the search family's second case is measured before and after (1), and the SwOA's proof carries a verdict for
calling functions and one for knowledge with a search tool offered, the larger model given the same.

**Risks.** The reply costs a second round of drafts where it was one model's words; how much slower is measured in (1) and
said. A page that gives orders is the one place a small model's mistake is more than a wrong answer, so case 3 of the search
family is a question a change must never lose, whatever its class gained.

## What is decided along the way, and when

| Decision | When | What it rests on |
|---|---|---|
| The margin (0.05 proposed) | after step 1 | how often the two differ on each capability, and so what a proof of this size can show |
| BFCL, or another tool test | end of step 1 | the trial |
| The search service behind the test, and its key | before step 7 | what the test needs; a person supplies the key |
| Whether a change is judged on its whole class or on the kinds it touches | during step 5 | the first record of gains |
| Three answers or five | after step 4 | how many questions are left with no standard |

## How the whole is checked

One measurement, taken twice: the proof run of step 1, on the arrangement as it stands now, and again when the seven steps
are in and a pass has run under them. The second is the SwOA's proof. Nothing between the two is decided by a harness result.
