# SwOA parity: the build plan

The plan for the seven steps of [swoa-parity.md](swoa-parity.md), which says what parity means and why training has to be
re-aimed. This says what each step changes, in which files, how it is checked, what it costs to run, and what waits on what.

Status: built, 2026-11-18, except what needs a long run or a second harness. The next section says, step by step, what is
built, what it measured and what is left. The steps after it are the plan as it was written: what each step was to do and
how it is checked.

## What is built, and what it measured

| Step | Built | Measured | Left |
|---|---|---|---|
| 1 | The size of a proof run, task by task (`proofN` in `training/equivalence.json`, `evaluate.sh --proof`, and a proof run among the sizes the page offers). A run that is stopped carries on from the task it stopped in: the module's answers are kept by arrangement and runtime, as the target's already were (`--fresh` asks again). The tool tests tried, and wired (step 7) | The trial of the tool tests (below). The battery at proof size: started 2026-11-18 and stopped by hand after 86 minutes, the target asked 7 of 21 tasks (its answers kept) and the module none. No result came of it: it is to be run again | The margin, once the battery has run |
| 2 | The paired gap, a verdict for each capability, what is claimed and what is not; in the SwOA, on its page, and in [swoa.md](swoa.md) 4.7 | The seven evaluations on record, read by the rule (below) | Nothing |
| 3 | One grading for every question that carries its own standard: code, a value, a planted flaw. The swarm, each slot and the target are scored by it | The pass on record, regraded (below) | Nothing |
| 4 | The standard among the target's answers (`training/support/standard.mjs`), a third answer (`baseline.mjs --third`, in `session.sh`), "no standard" as a state | The third answers asked, and the standards from all three (below) | Nothing. Three answers or five is decided on what is below |
| 5 | A change is kept by its class: raced on 8 questions, then the class, then the held questions; changes proposed for the class at the end of a pass; the gain and its error in the ledger, on the page and in the SwOA's learned record, which states the rule. The page says "good" of a question, not "parity": good as it stood, made good by a change, not good yet; its head is the share of answers good, with the module beside the target; and it says how a change is kept as the policy has it | Nothing yet: no pass has run under it, so no change has been kept by it | A pass |
| 6 | Three families of question (rules a program checks, calling functions, search with facts made up from the seed), an agent's step graded against the step its scenario needs, three bodies of work. From 2026-11-18 a pass asks them with the other five: nothing is chosen (the boxes to tick are gone from the page, and `equivalence` from `src/config.json`) | A probe of 10 questions a family on the module (below) | The families asked in a pass, and the target scored on them beside the module |
| 7 | In a turn with tools a reply is written by the answer procedure, shown what the tools returned (`plan.toolReply: "proposed"` keeps a proposed reply). [swoa.md](swoa.md) Part T.9, and 4.2: a recipe holds no body of knowledge. The tool tests as proof: a second harness (`training/support/bfcl.mjs`, `bfcl-eval` 2026.3.23 in `.work/bfcl`), five function-calling categories under Tools and two web search categories under Search, each result naming its harness and the tools offered; the target asked two ways and counted by the better over the capability | The trial (below), and a reply answered against a reply proposed (below) | The web search test asked of the two models: its search is wired (a SearXNG served for the run, no key) and tried with a stand-in model; the proof run under way began before that, so a proof run after it asks only this |

Tests when this was written: 193 in `tests/run.mjs` and 123 in `ui/check.py`, all passing.

**Step 1 and 7, the trial of the tool tests.** `bfcl-eval` installs with `uv` and a Python 3.12 (it pins a numpy with no
build for a newer one), about 2 GB, and needs `soundfile`, which it does not name. It is pointed at a model through the one
model it has registered that speaks plain chat completions with `tools` to an address it is given (`OPENAI_BASE_URL`), and
that address is a relay in front of the model being asked. Both the module's endpoint and the target's server take `tools`
from it. Twenty questions of each of five categories, for both:

| Category | The module | The target, tools in the request | The target, tools written into the conversation |
|---|---|---|---|
| One function | 13 | 14 | 19 |
| One of several functions | 17 | 15 | 18 |
| Several calls at once | 10 | 2 | 16 |
| Several calls of several functions | 15 | 8 | 18 |
| No function fits | 20 | 20 | 10 |
| All 100 | 75 | 59 | 81 |

The first reading, with the tools in the request alone, had the module ahead of its target, 75 to 59. That was the target's
server, not the target: it returns the first call only of those the model writes (four questions that need two or three
calls, one call back each time; the same four with the functions written into a system message and no `tools` in the
request, every call written), and with `tools` in the request it replied in words on 5 of the 20 questions that need one
call. So the target is asked both ways and counted by one of them for the whole capability, the one it scores higher by
(`training/evaluate.mjs` `wayByItem`; [swoa.md](swoa.md) 4.7). Counted so, the trial reads 81 for the target and 75 for the
module: a gap of 0.06 with an error of 0.05, `open`. The module's misses are mostly one thing: on 19 of its 25 it answered
in words, working the sum out itself, where the question needed a call. That is what the function-calling questions of
step 6 train.

The module took about 5 seconds a question where one call was needed, 10 where several were, and 13 where none was (a reply
is answered, step 7); the target 2 to 3. The web search test was not tried that day: the package searches through SerpAPI,
and there is no key here.

**Step 7, the search behind the web search test.** The package's README says its search may be changed by changing its
`search_engine_query`. It is, without touching the package: the tool tests are started through
`training/support/bfcl_search.py`, which puts a search of this machine's own behind that function, a SearXNG (free software,
pinned in `training/search.json`, installed into `.work/searxng`) that the evaluation serves on `127.0.0.1` for the length of
the run. Tried end to end with a stand-in model: the test's search reached it, results came back in the test's own shape
(Brave, DuckDuckGo and Google's custom search answering), and the same query asked again was given from the day's folder.
What each query returned and each page fetched is kept for the day, so the target and the module are given the same; the
result names the search ([swoa.md](swoa.md) 4.7 `search`). The public engines throttle (one CAPTCHA in three queries, the
others answering), and a score through this search is not one to set beside the published leaderboard's.

**What the trial found in the module, and what was done.** Of the module's 39 replies in words, 7 ended with a paragraph
about how the reply was made ("This answer was settled based on the provided draft which correctly calculated the area").
The writer was repeating what it had been shown. Such closing paragraphs are now cut, and the answer before them goes out as
it was written ([swoa.md](swoa.md) R.1.14, O.8.4; `src/read.mjs` `withoutClosingRemark`). Asked again, none of the 39 did it.

**Step 2, the evaluations on record.** All seven are IFEval. The two of 100 questions, both on an earlier lineup, read
`short`: 0.60 against 0.79 (6 questions only the swarm had, 25 only the target), and 0.46 against 0.79 (6 and 39). Of the
five of 20 questions four read `open`, as expected. One reads `short`, by a hair: 0.50 against 0.75 (1 and 6), where the
plan expected `open` of every run this small. Nothing of 20 questions counts as proof (`PROOF_MIN_N` is 100), so no claim
rests on it. The two on this lineup, 0.65 and 0.70 against 0.75, read `open`.

**Step 3, the pass regraded.** Of the 30 code questions the swarm had 28 right against the target's own function, and has
24 right against the question's correct solution. The target has 23 right by the same grading.

**Step 4, the standards.** The third answers were asked on 2026-11-18 (under three minutes of the target for both sets). Of
the 36 train questions graded against the target's answers, 31 have a standard among its three and 5 have none; of the 36
held ones, 28 and 8. Against the standard the swarm is right on 11 of those 31 train questions, where the pass had graded
it right on 6. (An agent's step now carries its own standard, so the 6 of them are no longer among these.) The plan expected
two questions with no standard; there are 13 of 72. Whether two more answers would give those a standard is the question
of "three answers or five" below: they cost about three minutes of the target.

**Step 6, the probe.** Ten questions a family, asked of the module only, with its decider and without:

| Family | Right, with the decider | Right, with none |
|---|---|---|
| Rules | 8 of 10 | 8 of 10 |
| Calling functions | 8 of 10 | 8 of 10 |
| Search | 10 of 10 | 6 of 10 |
| An agent's step | 9 of 10 | 8 of 10 |

What it missed: two rules (two words to use; an exact count of sentences); both function questions that lacked an argument
only the person knows, where it called the function with a date it made up; one agent step, a read where an edit was needed.
With no decider the four search questions it missed were the ones that had to search, and it replied. Forty questions say
where to look, not how the module compares: the target has not been asked them.

**Step 7, a reply answered against a reply proposed.** In the probe with the decider, eleven turns needed a reply. On
nine the step was a reply, and it graded right both as proposed and as answered. On two the step was a call, so no reply
was written either way. So answering the reply changed no grade on these questions, and it costs time: 1.7 to 12 seconds,
where a proposed step took 1 to 2. The gap the plan expected in the search family's second case did not show: the proposed
reply already gave the fact from the results. The questions are short and so is what their tools return, so this does not
say what happens on a long result. Training can weigh the two (`plan.toolReply`).

## Where things stand

- **The battery was started at proof size and stopped partway.** Started from the page on 2026-11-18 at 20:25 UTC: crew,
  code, math, logic, reasoning and tools, 21 tasks and about 3,140 questions for each of the two models, the target's tool
  questions twice, on the arrangement as it stood (version 17) and before any pass under the new rules. Stopped by hand at
  21:51: the target had been asked 7 of the 21 tasks (1,741 questions; IFEval, HumanEval, MBPP, GSM8K, BBH multistep
  arithmetic, logical deduction and date understanding) and the module none. No result was written. The target's answers
  to those seven are kept, so a proof run started again asks it only the rest, then the module all of them. Search was in
  it and not asked: its search was wired after the run began.
- **Nothing is chosen for training any more** (2026-11-18). A pass asks every body of work: 28 kinds of question, 168 train
  and 168 held at six of each, where it asked The Crew's 14 and 84. The boxes to tick under the models are gone, and
  `equivalence` from `src/config.json`; Evaluate has boxes of its own for which bodies of work one run asks. The SwOA says
  which bodies its training asked from the questions of the pass in hand (`trainedAgainst.trainedOn`).
- Training is stopped. Started again, it asks the pass's questions from the first: the grading changed, and nothing graded
  the old way is carried on (`SCORING` in `training/loop.mjs`); the page says so. The questions are now those of every
  body of work. The changes kept so far stay, on the arrangement at version 17.
- The configuration measured throughout is `bonsai2-2b+lfm3-1.7b+jan-code-4b+kev-0.8b`, whose target is Nemotron 3.5
  Lightning 30B. The target is whichever model the configuration names: nothing built here is fixed to this one.

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
   | Procedures (`reasoning`) | 6 BBH tasks | 100 each (85 as first planned: a result of fewer than 100 questions is a check, not proof) |

   About 2,640 questions, and 500 more of the tool tests under Tools. The larger model's answers are kept
   (`.work/eval/target/`), so it answers once.
2. *The run.* `bash training/evaluate.sh --items crew,code,math,logic,reasoning --proof`. What is chosen for training does not
   change (`src/config.json` stays `crew`): the harness is only measured here.
   (As planned. From 2026-11-18 nothing is chosen for training: a pass asks every body of work, and `--proof` with no
   `--items` asks every body that has a standard test.)
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
| BFCL, or another tool test | settled, 2026-11-18: BFCL for calling functions | the trial |
| The search service behind the test | settled, 2026-11-18: SearXNG, served for the run, no key | free software; the package's own search needs a paid key |
| Whether a change is judged on its whole class or on the kinds it touches | during step 5 | the first record of gains |
| Three answers or five | after step 4 | how many questions are left with no standard |

## How the whole is checked

One measurement, taken twice: the proof run of step 1, on the arrangement as it stands now, and again when the seven steps
are in and a pass has run under them. The second is the SwOA's proof. Nothing between the two is decided by a harness result.
