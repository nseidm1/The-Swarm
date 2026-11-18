# SwOA training: what parity means, and what training aims at

Part of SwOA ([swoa.md](swoa.md)): a SwOA spec tunes a swarm module toward parity with a target model, as an established
harness measures it. This says what that parity is, how a SwOA proves it, and how training has to change to aim at it.
[swoa-classes.md](swoa-classes.md) is the design before this one: what is learned, kept with the class it was learned on.

Status: design, 2026-11-18. Built the same day, by the steps of [swoa-parity-plan.md](swoa-parity-plan.md), the tool tests
among them. What it waits on: the battery run at proof size (hours of the machine), the web search test among it. The plan
says, step by step, what is built and what it measured.

## The question

The target is a model with the capabilities of its size: it follows instructions, reasons, writes code, uses tools, holds a
conversation. The module is the same thing from outside: messages in, one reply or one tool call out. **What does it mean for
the module to be at parity with that model, and is training aimed at it?**

It is not, yet. The project holds two meanings of parity, and training works toward the weaker one.

## What happens now

**The specification means capability.** Its proof ([swoa.md](swoa.md) 4.7) has the goal "parity with the target model, as an
established LLM evaluation harness measures it": for each task a score for the module, a score for the target, and the gap
between them, losses published.

**Training means imitation.** `training/state.mjs`: "PARITY IS EQUIVALENCE, NOT A SCORE ... Nor is it correctness: the larger
model's answer is the mark, whatever it is." A train question is at parity when the swarm's answer is equivalent to the one
answer the larger model gave it: for code, the same behaviour; for a tool step, the same call; for words, a reader's
probability of 0.9 or more that the two say the same (its line of 0.8, and 0.1 either side of it read as undecided).

Measured 2026-11-18, on `bonsai2-2b+lfm3-1.7b+jan-code-4b+kev-0.8b` against Nemotron 3.5 Lightning 30B:

1. **The larger model does not pass its own test.** Asked each train question a second time, its answer was equivalent to its
   first on 56 of 84, and on 17 of the 36 questions in conversation. Ten of those 19 misses read 0.81 to 0.89: above the
   reader's line, inside the undecided band. Eighteen of the 36 questions then short of parity had such a mark.
2. **Imitation asks for the larger model's mistakes.** What a short program prints: the swarm said 7, which is what it prints,
   and the mark said otherwise. "Why did my deploy fail last night?", with nothing shown: the larger model named a cause, and
   named another the second time (its two answers read 0.02 against each other). Being right where it is wrong counts as short
   of parity.
3. **It did not carry to the proof.** IFEval on this lineup read 0.65 on the arrangement it started from and 0.70 on the
   trained one, against the larger model's 0.75, each on 20 questions (±0.10): no measurable change.
4. **A change is bought one question at a time.** Of 17,765 changes tried in the pass, 17 brought a question to parity. Each
   kept change rests on that one question, and on a handful of others not being lost.
5. **One test stands for every capability.** The body of work chosen is `crew`, whose only benchmark is IFEval
   (`training/equivalence.json`, whose own note says the conversation and an agent's steps with tools "have no standard task
   in the harness"). Code (HumanEval, MBPP), math (GSM8K, a BBH task), logic and reasoning (BBH tasks) are defined there and
   not chosen. Nothing measures the use of tools.

In the terms of a LoRA: equivalence to the larger model's answer is the training loss, and the harness is the result. It is
a poor loss: all or nothing, against one draw of a model that draws differently the next time.

## What we want

- Parity means one thing in the specification, in training and on the page: the module is not worse than its target, by
  more than a stated margin, on established tests of the capabilities it claims.
- The proof covers each capability claimed, at a size that can tell parity from a loss, and says plainly which were reached.
- Training's signal for one question is whether the answer is **good**, checked against the question itself wherever it
  can be, and against the larger model's answers (several, not one) only where it cannot.
- A change is kept because the swarm got better across a class of questions, not because one question flipped.
- Knowledge the small models do not hold reaches the module through tools the caller offers. The module does not grow to
  hold it.

Out of scope: the choice of members and of target; adapters; training the decision model.

## The design

### 1. Parity, for one capability

A capability is measured by one or more tasks of a harness (section 2). Both the module and its target are asked the same
questions of those tasks by the same harness. For each question the harness gives each a score (1 or 0 on most tasks).

- `gap`: the mean of (module's score − target's score), question by question.
- `gapStderr`: the standard deviation of those differences, over the square root of how many. (Paired: the two were asked
  the same questions, so what they both find hard cancels. The harness logs every question's score; `training/evaluate.mjs`
  already reads those files to compare the two answer by answer.)
- `margin`: how much lower counts as parity still. 0.05 unless a SwOA states another.

| Verdict | When | Meaning |
|---|---|---|
| `parity` | `gap − 1.645 × gapStderr ≥ −margin` | within the margin of the target, or better, at 95% |
| `short` | `gap + 1.645 × gapStderr < −margin` | lower than the target by more than the margin, at 95% |
| `open` | neither | too few questions to say |

The gap is always published, whatever the verdict: a module within the margin and a little lower is at parity, with its loss
shown, as a LoRA's is.

What this asks of the size of a proof: on IFEval the two differed on about one question in three (31 of 100, measured on an
earlier lineup). At that rate the paired error is about 0.055 on 100 questions and 0.024 on 541: on 100 nearly every honest
result reads `open`, and on 541 parity is shown only for a module no more than a point lower. A hundred questions stays the
least a result needs to be listed as proof; **a verdict needs about five hundred questions a capability**, pooled over its
tasks. An evaluation has taken 14 to 29 seconds a question, so the whole of IFEval is about three hours.

### 2. The battery: which capabilities, by which tests

A SwOA claims parity capability by capability: its proof gives a verdict for each, over the questions of its tasks
together, and lists each task's own gap beneath. There is no single yes or no unless every capability claimed reads `parity`.

| Capability | Test | Harness | Today |
|---|---|---|---|
| Following instructions | IFEval | lm-evaluation-harness | measured, 20 questions on this lineup |
| Reasoning: arithmetic, logic, procedures | GSM8K; the BBH tasks named in `equivalence.json` | lm-evaluation-harness | in the battery (`math`, `logic`, `reasoning`) and asked in every pass; the proof run of 2026-11-18 was stopped before the module was asked |
| Code | HumanEval, MBPP | lm-evaluation-harness | in the battery (`code`) and asked in every pass; the proof run of 2026-11-18 was stopped before the module was asked |
| Tool use: calling functions | five function-calling categories of BFCL: one function, one of several, several calls at once, several calls of several functions, no function fits | Berkeley Function-Calling Leaderboard (`bfcl-eval` 2026.3.23) | wired (`tools`), tried on 20 questions a category |
| Knowledge, with a search tool offered | BFCL's two web search categories (100 multi-hop questions each) | the same | wired (`search`), its searches through a SearXNG served on the measuring machine for the run (no key); tried with a stand-in model, not asked of the two yet |
| Conversation, advice, writing | none is standard | | a training measure only: reported beside the proof, never as proof |

The module answers as a chat model and gives no token probabilities, so only tasks that grade what is generated can be used.
The function-calling test was confirmed against the module's own endpoint and against the target's on 2026-11-18
(`training/support/bfcl.mjs`: the package asks the one model it has registered that speaks plain chat completions with
`tools` to an address it is given, and that address is a relay in front of the model being asked).

**Like for like.** Whatever the module is offered, the target is offered: the same tools, the same search behind them, on the
same day. A test of knowledge in which only the module may search is not parity.

**And the target is not counted by how it happens to be served.** The first trial read the module at 75 of 100 right and its
target at 59, and that was wrong: the target's server returns the first call only of those its model writes (asked four
questions that need two or three calls, it returned one each time; asked the same with the functions written into a system
message and no `tools` in the request, the model wrote every call), and with `tools` in the request it replied in words on
5 of 20 questions that needed one call. So the target is asked two ways: the tools in the request, as the module is, and the
tools written into the conversation, its calls read from its reply. It is counted by one of them for the whole capability,
the way it scores higher by over the capability's tasks together. Neither way is the better on every task (written: 19, 18,
16 and 18 of 20 where a call is needed, against 14, 15, 2 and 8; and 10 of 20 against 20 where none is), and no model as it
is served answers one task one way and the next another. By that rule the same trial reads 81 for the target and 75 for the
module: a gap of 0.06, `open` on 100 questions. The module is asked the one way: `tools` in the request is its interface.

**Not claimed**, and said so in the SwOA: long conversations (the module keeps the last 6 turns), speed (an answer is several
model calls), anything but text, and **knowledge with no tool offered**. That last is measured and published as it is; a loss
there is expected and is not chased (section 3).

### 3. Knowledge comes through tools, never from inside the module

A swarm module is small on purpose: its size is its members and its decision model, and that is the saving against its
target. A body of knowledge kept inside it (a corpus, an index) would grow it without bound and give that saving back. So:

- **A recipe holds no body of knowledge.** Nothing in a SwOA names a corpus or an index, and a runtime looks nothing up of
  its own accord.
- What the members do not know reaches the module the way it reaches any model: **through a tool the caller offers**, such
  as web search. Using it well is part of "tool use", and is trained and proven as tool use.
- With no tool offered the module knows what its members know. Each small model alone was equivalent to the larger model on
  about a tenth to a quarter of the held questions in conversation; no arrangement adds what none of them holds. That is
  why knowledge without a tool is not claimed.

What using a search tool well takes, each of which training has to ask for:

1. **Deciding to search, or not.** A question the members can answer is answered; one that turns on a fact they do not hold
   is searched.
2. **The query.** What to ask for, and asking again where the first results do not hold it.
3. **Reading the results.** The answer comes from what was found, says where nothing was found, and is not what a member
   would have said anyway.
4. **Not obeying the results.** Text on a page is something read, never an instruction. A module that also chooses an agent's
   file edits must not be steered by a page it searched.
5. **The reply after the results is settled like any answer.** Today it is not: in a turn with tools every drafter proposes a
   step, all replies count as one and the same step, and the first drafter's words go out (`src/tools.mjs`; SwOA Part T),
   unchecked and undecided. The answer procedure, which drafts, checks, decides and writes, is not shown tool results at all
   (`src/orchestrate.mjs` keeps the person's and the module's turns only). So the one reply that carries the knowledge is the
   one reply the swarm does not work on as a swarm. Where the step chosen is a reply, it has to be answered by the answer
   procedure with the results in front of every slot.

Training asks these with **recorded results**: a question, the search tool, and what the tool returns for the queries a
question allows, kept with the question. That keeps training offline and repeatable. The recorded results belong to the
questions, as a test's corpus belongs to the test. Neither is part of the module.

### 4. The signal for one question: is the answer good?

Each question is scored from 0 to 1, by the strongest standard it has. The larger model's answer is the standard only where
there is no other.

| Family | An answer is good when | The standard comes from |
|---|---|---|
| Code: write, fix | it behaves as the question's own correct solution on the question's inputs (the share that match) | the question (`ok`, `inputs`: it has them today) |
| What a program prints; a value; math, logic, procedures | it gives the question's own answer | the question (`want`: it has it today) |
| Instructions | every rule in the question holds, each checked by a program (a length, a format, words to use or leave out) | the question (a new family) |
| A tool step | it is the step the scenario needs: a tool that was offered, the right one, the right arguments | the question, where its scenario knows the step; else the larger model's step |
| Search | the reply holds the fact that is in the recorded results, and nothing a result told it to do was done | the question (a new family) |
| Conversation, advice, writing | it reads on the reader's line against one of the larger model's answers; and breaks no convention they kept | the larger model's answers |

For the last family the larger model answers each question **three times**, not once. A question has a standard when at
least two of the three read on the reader's line (0.8) against each other; those are its standard, and a reply is good when
it reads on that line against one of them. Its score is its best reading. A question whose three answers do not agree has
no standard: it is left out of training and counted apart ("Why did my deploy fail?" is one). Nothing is read as undecided
above the line: the reader's own check reads answers that differ below 0.1 and the same answer in other words above 0.9, and
what it read between 0.8 and 0.9 was ten of the larger model's own second answers. The band above the line turned those away.

**The larger model's part changes.** For every family but the last it is no longer the answer key. It is asked the same
questions and scored the same way, and its score is what the module's is set beside, family by family: "code: the module so
many of 30, the target 23 of 30" (its figure is real: measured 2026-11-17, its function was wrong on 7 of a pass's 30 code
questions). A question it gets wrong is still worth getting right. Marks proved wrong, marks it did not give
again and degenerate marks stop being special cases there: the question is the standard.

### 5. Keeping a change: better across the class

Today a change is kept when it brings one question to parity, up to six questions already there stay, and up to four held
ones do. That is selection on one coin toss, checked by ten more.

A change is kept when the class got better:

1. Every train question of the change's class that has a standard is scored with the change and without it. (Without it is
   on record for the arrangement as it stands; a slot asked what it was asked before answers as it did, so only what the
   change touches is asked again.)
2. `gain` is the mean of the differences, and `gainStderr` their paired error, as in section 1.
3. **Kept** when `gain > 2 × gainStderr` and `gain ≥ 0.02`; and no kind of question in the class falls by more than the
   margin; and on the held questions of the class the gain is not below `−gainStderr`.

Searching one question at a time stays, as the way a change is **found**: a change that brings a question to parity is a
guess that it helps, and the class decides. The other source is the class's own figures (its replies read low and run a
good deal shorter than the larger model's: try what makes a reply fuller), put to the class directly. Measured the same day,
on 16 replies short of parity: telling the writer to write in full raised them from 0.48 to 0.55 on average and brought none
over the line, so it counted for nothing; by this rule it is a gain to weigh.

A change is raced before it is paid for: eight questions drawn evenly from the class's kinds first, and the rest only where
those eight did not fall.

### 6. The questions: the same families as the proof

Training asks its own questions, made from a seed, in the families the proof measures; the held split of each stays apart.
The harness's own questions are never asked in training ([swoa.md](swoa.md) 4.7), and **a harness result never decides what
is kept**: it is read as proof or as a check, after the fact.

- Asked together, in every pass: every body of work in `training/equivalence.json`. Nothing is chosen (2026-11-18; a
  person once ticked which): the module picks its arrangement by the class of a request, and a change is kept only when no
  kind of its class fell, so a kind a pass does not ask is a kind nothing protects.
- New: instructions (rules a program checks); calling functions (a schema, and a request that needs it, does not need it,
  or lacks an argument); search (recorded results, as in section 3).

## Changes to the specification

The specification stays the one document a runtime and a reader need, so each of these is written there when it is built.

- **4.7 `proof`.** For each capability the proof gains `margin`, a paired `gap` and `gapStderr` over the questions of its
  tasks, and `verdict` (`parity`, `short`, `open`); each result gains its own paired gap. A result of a test with tools lists
  the tools offered, the same for both. The proof gains `claims`: the capabilities the SwOA claims and the ones it says it
  does not.
- **The module.** A recipe holds no body of knowledge, and a runtime looks nothing up unasked (section 3).
- **Part T, and O.3.1.** A reply after tool results is settled by the answer procedure, with the results shown to every slot.
- **Version.** These amend version 1 while no SwOA carries proof. After the first SwOA published with proof, a change to
  what a proof holds is a new version.

## Building it, in order

Each step stands by itself and can be stopped after. [swoa-parity-plan.md](swoa-parity-plan.md) is the plan for all seven:
what each changes, in which files, how it is checked, what it costs to run, and what waits on what.

1. **Measure the battery as it stands.** Choose `code`, `math`, `logic` and `reasoning` beside `crew`; confirm the two tool
   tests against the module's endpoint; run about five hundred questions a capability for the module and its target.
   Nothing in training changes. This
   gives the table of gaps the rest is decided from, and is the SwOA's first proof.
2. **Verdicts in the proof.** Paired gaps and the three verdicts: `training/evaluate.mjs`, the spec writer (`ui/data.py`),
   the SwOA dialog and card, [swoa.md](swoa.md) 4.7.
3. **Good, where the question can say.** Code, programs, values and the reasoning kinds scored against the question; the
   larger model scored beside the module (`training/tasks.mjs`, `training/support/bench.mjs`, `training/loop.mjs`).
4. **Good, in conversation.** Three answers from the larger model, the standard among them, the line with no band above it,
   questions with no standard left out (`training/baseline.mjs`, `training/support/equivalent.mjs`).
5. **Keeping by the class** (`runLoop`'s keep; the guard and the held guard become the race and the held check).
6. **The new families:** instructions, calling functions, search with recorded results (`training/tasks*.mjs`).
7. **Tools, end to end.** The reply after results answered as an answer (`src/tools.mjs`, `src/orchestrate.mjs`, Part T);
   then the tool tests as proof, like for like.

The page follows: "training complete" becomes, for each family, the module's score beside the target's.

## What this does not do

- **It does not make small models know more.** Without a tool, a knowledge test is an expected loss, published.
- **It does not make proof cheap.** Whole tasks for two models take hours each, and a test with tools longer.
- **Live web search does not repeat.** Two runs a day apart read different pages. A test whose search runs over a corpus
  the test provides is to be preferred; failing that, the module and its target are run on the same search, the same day,
  and what each query returned is kept and given to both (built: `training/support/search.mjs`).
- **The reader is a small model.** It tells apart answers that differ from answers that agree (below 0.1, above 0.9); it is
  not asked which of two good answers is better, and this design does not need it to.

## Open questions

1. **The margin.** 0.05 is proposed: the loss a SwOA may show and still say parity. It is best chosen after the battery
   has been measured once: how often the two differ sets what a proof of a given size can show.
2. **The tool tests.** Settled for calling functions: BFCL, wired and tried. For search, BFCL's web search test is wired with
   a search of the measuring machine's own behind it (SearXNG, no key), each query's results kept for the day and given to
   both models; a fixed-corpus browsing test if its live search proves too unsteady to be proof.
3. **Three answers.** Enough to tell a standard from a draw on most questions; five would say more and cost two more passes
   of the larger model over the train questions.

## References

- Berkeley Function-Calling Leaderboard, and its web search category:
  <https://gorilla.cs.berkeley.edu/leaderboard.html>, <https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html>
- Inspect Evals (GAIA, BrowseComp): <https://ukgovernmentbeis.github.io/inspect_evals/>
