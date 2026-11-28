# Training

How a module is trained, what its questions are, and how a session recovers. [../training/TRAIN.md](../training/TRAIN.md) is the procedure.

A module is trained toward a larger model, and what training finds is the module's wiring. It has three things to find,
and keeps each only where held questions say it helped:

- **the arrangement**, for each class of input: what each slot is told and how the slots are arranged (below);
- **adapters, one for each drafting slot**, taught that slot's own requests on many questions of every kind: its own
  answer where that was right and the larger model's where it was not (`training/mixture.mjs`). An adapter is on no
  slot when it is made. Whether a slot carries one is a move the class stage tries and keeps like any other, so a
  mixture of adapters is part of the arrangement, and each request is served with the adapter its slot carries;
- **instruments**: where a class of input holds operations code does exactly, the class stage turns that instrument
  on (`src/instruments.mjs`). None is on in a module as it starts. Training asks such operations in questions of its
  own (`training/tasks-exact.mjs`), so what an instrument is worth is measured before a benchmark sees it. Twelve
  more read a whole question of a fixed kind (who tells the truth, things in a row, a date so many days on or back,
  whether an argument holds, a number and what is done to it, a day of the week, and others); the class stage offers
  them after its other changes, one at a time;
- **forms**: the same twelve kinds, read by a model where the wording is one no instrument knows
  (`src/forms.mjs`). The drafters write what the question says into a fixed form and code works it out; the answer
  stands only where their readings agree. One change the class stage can try, kept like any other, so a swarm whose
  models read well keeps it and one whose models do not is left as it was;
- **readings**: a kind of question the class is short on, laid onto a form the module ships
  (`training/write-reading.mjs`). The larger model says which form fits and how a model is to be told to fill it for
  this kind; it writes no code, since the form's own code works the answer out. The reading is vetted on questions
  it was not shown and refused on one wrong answer; kept, it is a change of the round like any other;
- **the ladder**: what this swarm's writer can be trusted with, measured (`training/ladder.mjs`): whether it fills
  the forms, whether it lays a kind onto a form, whether it writes a function. The class stage asks for a reading
  only where its writer was shown to lay kinds reliably, or has not been measured;
- **a kind of question added later** stands after every other (`training/tasks-later.mjs`), because a kind's
  questions are seeded by where it stands: no earlier kind's questions change, and a test holds each to the hash it
  had before (`training/kinds-as-they-were.json`). From the day one is added (`equivalence.json` `since`), a class's
  figures are recorded twice: of every kind, and of the kinds as they were (`earlier`), so that a figure of an
  earlier pass is always set beside one of its own measure. Two were added on 2026-11-25: who holds what after
  things have changed hands, and whether steps and turns lead back to where they began;
- **written code**: the code itself is found by training (`training/write-code.mjs`). Each round, for the kinds of
  question the class was most wrong on (`writeKinds`, two), the model in the swarm's first place is asked alone for
  one function, `answer(question)`, shown half of the train questions of that kind with their right answers. What it
  writes is run where it can reach nothing (`src/written.mjs`) on the train questions of the kind it was **not**
  shown and on the class's other questions. It is refused on one wrong answer anywhere, on answering fewer than half
  of the unseen ones (`writeCover`), or on not being a function; refused, it is told why on what it was shown alone
  and asked again (`writeTries`, three). One that passes is a move of the round: the class's arrangement with that
  function asked before any model. It is scored on the train questions and kept only where held questions gain, as
  every change is. **It is judged where it acts:** a function answers one kind and a class has six held questions of a kind, so a change that puts a function on is confirmed on the class's held questions and on more held questions of that kind (`writeHeld`, eighteen), made from the held seed as the others are and asked of the swarm as it stands and of the change alike. The rule is not changed. Held questions are never shown to the writer and never used to vet. What was written or refused,
  with the code (a refused function's too), is in `<record>-written.json`. A turn of a conversation can have code
  written for it as a single question can: the function is given the last message and vetted by the conversation's
  own reading of the reply. `--no-write` leaves the step out. Not built: the larger model as the
  writer, and code written for anything but the answer to a single question (a reply's wording, a turn with tools).
  The first trial is under [Measured](measured.md#training-writes-code-the-first-trial-2026-11-24);
- **for one kind of request**: a class is wide, and a change that mends one kind of request in it and spoils the
  others cannot be kept for the class. So a kind of request within a class is told by code (`src/facets.mjs`: a turn
  that asks nothing, one asking for code or going on from code, one after the person said how to answer), and a change
  can be kept for that kind alone (`plan.for`). Each round, for the facets the class has wrong answers of, the changes
  worth keeping for that facet are tried (`arrange.mjs` `facetMoves`: one model asked as the request came; the same
  with the reply tidied, for a turn that asks nothing; the settled answer alone); then the change of the round that
  did most for that facet's questions, whatever it did to the class, is tried kept for the facet alone
  (`scopedMove`); then what gained for different facets, together. So what a pass is short on makes the next thing
  tried, and not only more questions of it;
- **a program checks the figure**: a drafter that answers by a program, added with its figure standing
  (`computedStands`). It is asked with the first drafters and has no vote; where its program prints one plain number
  and the slots settled on one figure, the number stands. Slots of one model that agree are asked nothing further, so
  a slip they share went out; a program writes the sum down and code works it;
- **what fills where the model cannot work it out** (measured 2026-11-25, `docs/measured.md`): a program a small model
  writes for the question in hand is wrong more often than its own slots are, so it never outvotes them. It is used
  three ways, each a change of its own: its figure stands over the one figure the slots settled on
  (`computedStands`); its answer stands where the slots settled on none (`computedFills`); and where it differs from
  the first drafters, the other drafters are asked (`computedDoubts`). A slot cut off before its answer can be given
  its room again to finish (`goOn`). And the functions training writes are written by the larger model where it can
  be served (`writer: 'target'`; it is loaded for the writing of a round and stopped after), from sixteen train
  questions of the kind (`writePool`), in up to five tries: every other try starts again, shown other questions of
  the kind, and a function that gave nothing is told the line it gave up at;
- **the answer alone**: the settled answer goes out with no work before it (`writeAs: 'bare'`), beside going out with
  its work;
- **how many slots and models**: a slot added, dropped or moved to another model, every slot on one model, one slot
  asked as the request came;
- **breakdown and cascade**: code takes the question apart, with no model asked. With the breakdown every drafter is
  sent the question with each thing it states on a numbered line. With a cascade one drafting slot works the question
  a fact at a time: at each it is shown the facts so far and what was worked out so far, both kept by code, and adds
  one line; then it drafts. Tried on four small models (2026-11-24), neither has gained yet
  ([Measured](measured.md)), so neither is on anywhere: they are there for training to try.

**A conversation has a standard of its own.** Requests that are a conversation (an earlier reply stands in them) had
none: they were marked against the larger model's reply, so the class stage, which asks only questions that carry
their own standard, trained that class on nothing. Now made-up people write over several turns (`training/tasks-chat.mjs`:
one terse, one formal, one in a hurry, one with something heavy on their mind, one saying thanks, one greeting a second
time; and five that need the turns before the last: one asking about "that", one correcting what they asked, one asking
two things at once, one doubting a right answer, one who said earlier how they want figures given; and two that keep a conversation intelligent: one with something to
reason out, one asking for a function and then a change to it), each asking something code knows the answer to. A reply is good where it gives that answer and keeps every
convention of that conversation: no praise to open, no offer of help to close, no sentence twice, a greeting once, a
short reply to a short message, no slang to a formal one, the answer first for someone in a hurry, no question for a
question, nothing bright for something heavy, a few words for thanks. Every reading is of the words themselves; no
model grades another. The readers are checked before they are believed, against replies whose verdict is known
(`training/manners-fixtures.json`; `node training/tasks-chat.mjs --check`). The conventions are how people talk, after
[The Crew](https://github.com/nseidm1/TheCrew)'s trainers; none is taken from a benchmark.

What training can change for a conversation is everything it can change for any class, and one thing more: **a reply
tidied by code** (`src/manners.mjs`; `plan.manners`). An opening that only praises, a closing that only offers more
help, a sentence said again and a greeting given twice are each put right by code, with no model asked, where
training turned that fix on. None is on as a module starts. Manners do not fix what a model knows: a reply without
the answer is wrong whatever its manners.

**The conversation run stands apart from the intelligence run** (the dashboard's two cards under Run). One press is
one pass: `node training/classes.mjs --only talk --kinds <the made-up people> --figures --out
training/results/<configuration>/conversation.json`. Its figures are its own: the held conversations before the pass
and after it, and a line a pass in `conversation-history.jsonl`, so the passes can be set side by side. Any request
with an earlier reply in it is of this class, a coding or reasoning exchange among them, so two of the people ask
for exactly that part way through (something to reason out; a function to change, run by code on inputs it was not
shown): an arrangement kept for its manners must not be one that reasons or codes worse.

**Each pass learns from the last.** The class stage ends by writing down, from the swarm as it left it on its train
questions, every kind it was still wrong on and every convention a reply still missed (`gaps.json` beside its
record). The next pass reads that first: a kind a third wrong is asked two more train questions, one two thirds wrong
four more, added after the ones it already had. A bar that every reply held is a step
tighter in the next pass (a short reply is forty words, then thirty, then twenty), and goes back a step where a third
of replies miss it. The held questions never change, so two passes can be compared. The
dashboard's plan section says which pass it is, what it carried and what it leaves.

**Time is the tie-breaker, never the reason.** A change that gains beyond its error is kept whatever its time. Once
every class is trained, the class stage tries what would get the same answers sooner, each against the swarm as it
stands, on held questions, two draws, every question timed as it is asked and nothing answered from memory. Three kinds
of change are tried: the same model served another way (another file of it, served by another build of the engine, as
Inkling 2 Mini is by Atomic Engine), where both are on the machine already; and a leaner arrangement for a class, one
that was no worse on its train questions and asks less of the models; and, for each class that has a writer, no
writer where every draft came to the one answer (`writeAs: 'agreed'`), the writer still writing the reply where the
drafts differed. One is kept where its answers are no worse (the
mean gain not below zero, no more questions lost than made good) and it saves at least 15% of the time, by more than
twice the error of the timing. The record says seconds a question and tokens a second, before and after.

**What is tried first follows where the class falls short.** The class stage asks the class as it stands and sorts
every wrong answer: no drafting slot had it, a slot had it and settling lost it, or it was settled rightly and the
reply spoiled it. The changes for the widest of the three are tried first (what is drafted; how drafts are settled; how
the reply is written), each group in the order `training/policy.json` lists.

**Training is not shaped to a benchmark.** It never asks a benchmark's question, and it does not copy how one asks: the
Python kinds were asked three ways for a day, two of them the ways two code benchmarks ask, and those two were taken
out (2026-11-24). What carries a gain to a benchmark has to be breadth of training's own questions.

`bash training/run.sh` is the whole of it in one run, with the two figures it is judged by: the module as configured
is evaluated, which is the baseline; an adapter is made for each drafting slot and the module is trained; and it is
evaluated again, on the same questions (the dashboard's **Run Intelligence Training**). The evaluation is a third party's, unchanged: the harness asks the module
through the chat-model interface as it asks any model, and training never asks a harness's question.

What follows is the training of the arrangement. Nothing here changes the small models' weights. What is trained is what each slot is told, and how the slots are arranged:
which model drafts and which checks, how many of each, what a checker is shown. There are countless arrangements, and every
pass tries ones no pass has tried.

```bash
bash training/session.sh
```

Training is continuous: one pass follows another, each beginning from what the last one learned, until it is stopped (the
dashboard's **Stop training**, or stopping the process). A stopped session loses nothing: the next one resumes the pass it
was in. `PASSES=3` runs three and ends.

One pass, in order: make ready; plan from what the last pass left; check the reader of answers in words; the larger model writes new wordings of the questions that are an operation, each kept only where its own answer to it is right; each class of input is trained as a class; read what is new
on arXiv; the larger model answers the questions, and a second and third time those that carry no standard of their own;
each small model answers alone; the larger model writes new briefs for the slots that failed last time and the plan is
written again; then training itself, question by question, each train question in hand until the Swarm's answer to it is
good; the Swarm answers the held questions and the same questions put a second way; the verdict is written, with every flip
named.

- **A pass plans from what it measured.** It reads where the answers were lost (no draft had the larger model's answer, a
  checker turned a draft away from it, the decider had it and chose another, the writer changed it, a slot said nothing)
  and scores every move open to it by how many of those answers it could win back: another brief for a slot, a change to
  the plan, any arrangement one step from the current one. The dashboard shows the plan as it is carried out.

- **It drives a percentage toward 100.** Every pass ends with where the Swarm stands on the held questions, as the share
  of them it answers well: training's own measure, beside the proof and never in place of it. Each pass plans from the gap: of the answers still to close, how many were on the table and not chosen (choosing
  better could win them) and how many no slot had (they need better drafts). The moves it tries are ranked by which of those
  they speak to and how many answers they could win. If the percentage does not rise for two passes, the search is widened.
- **An answer is graded by the strongest standard its question has.** The question's own, where it carries one: code
  behaves as the question's correct solution on its inputs, a value is the question's own answer, a planted flaw is the flaw
  named, a request with rules keeps every rule a program checks, a step with tools is the step the scenario needs. The larger
  model answers the same questions and is counted by the same standard: one more answer, not the mark (on one pass's 30 code
  questions it was wrong on 7). Where a question has none (a reply in a conversation), the standard is the answers the larger
  model agrees with itself on, of three; a question none of whose answers agree is left out, and counted.
- **Training goes question by question.** A train question is put to the Swarm and stays in hand until the Swarm's answer
  to it is good. Where it is not, where the answer was lost
  is read from the slots (no drafter had it; a slot had it and it was not chosen; the writer changed it), and changes are
  tried on that question one at a time, chosen from its own record: where a slot had the answer, the ways of deciding that
  the record replays as right come first; where none did, more room for a slot that was cut off. The kinds of change that
  have made answers good most often are tried sooner, learned as it goes, and a change that puts the answer on the table is
  built on at once: changes are tried best first, from the closest arrangement open (closer counts partial credit, such as
  more of a function's inputs right), until the answer is good: it never moves on before, and where every arrangement open
  has been tried the search widens. Every arrangement kept goes into a library of found arrangements, kept across passes and Clear training
  state, and each question tries those first. A change like one kept recently is tried early. How it searches is a policy, not code: every 40 tries the larger model reviews the loop's
  record and proposes a change to the policy, which is tried for 40 tries and kept only where the search did at least as well;
  and after every 20 failed tries on a question it is shown that question and what was tried, and names changes to try next,
  tried at once; every 20 failed tries it says what went wrong and writes new briefs for the slots that failed. A win of several
  changes is kept in its smallest form. A question that resists 200 tries is flagged as beyond rearranging, and a dataset of the
  larger model's train answers made ready for a fine-tuned adapter, which MLX trains (`node training/adapters.mjs train`).
  Each change carries how it was
  chosen, how close it came and what a run took with it, and the page shows that while it is tried, with the pace. A slot
  asked exactly what it was asked before answers as it did without being asked again, so a try asks only what it changed. The
  small models are never shown the larger model's answer; only the grading is.
- **A change is kept when its class got better.** A change that makes the answer in hand good is a guess that it helps.
  Whether it does is asked of its class (tools, talk, code, words): every train question of the class is scored with the
  change and as the Swarm stood, the first 8 drawn evenly from the class's kinds and the rest only where those did not
  fall. Those say whether it is worth confirming: it must have gained there, lost no question on two draws, and dropped no
  kind of question by more than 0.05 and its own error. Whether it is kept is then the held questions' to say, by one rule
  for every stage of training (`training/keep.mjs`): each held question of the class is asked on two draws, with the
  change and without, and the change is kept where the mean gain is more than twice its paired error and at least 0.02,
  what it loses (a question right on both draws and wrong on both with it) is outweighed by at least twice as many made
  good, and no kind falls by more than 0.05 and beyond its own error by the bar for as many kinds as are looked at (twice for
  one kind, three times for five: among many kinds one falls by twice its error by chance). The bar is cleared by the held questions alone, or by them together with the train questions
  the change was not found on; the held questions must have gained either way. A change refused for its class is not
  asked of it again while the arrangement stands. One draw is never enough: the same change
  measured 1.9 points on one draw and 11.1 on another. Among the changes it can try is a drafter that answers by a program: it writes a short program, the sandbox runs it, and what it prints is that slot's answer. At the end of a pass the changes
  that most often brought a class's questions closer are proposed for the class outright, up to 6 a class, and scored the
  same way. A kept change is the class's arrangement for every question after, and an entry on the ledger the spec is made
  from, with its gain, its error and over how many questions. (Until 2026-11-18 a change was kept when it brought one
  question to parity with the larger model's answer and lost none of up to 6 already there: 17 of 17,765 tries passed, each
  resting on that one question. `--no-class-keep` keeps that rule.) The trainers ask with a fixed seed, so the same
  arrangement gives the same answers.
- **The search is wide.** The changes open are every arrangement one change from the current one (a slot moved to the other model,
  a drafter that checks or a checker that drafts, a step moved, a decision placed anywhere, a loop, a second writer) and a
  few that are several changes away at once. Nothing is drawn by lot: the changes are listed in a fixed order, every step
  kind is put in every place it can go (the decider between the drafts and the checks, a check after the decision), and
  within an area the least tried come first, so in time every arrangement within reach is tried. A kept arrangement is where the next question starts.
- **Watch before acting.** One measurement records what every slot answered and which answers were equivalent. From that
  record, with no model asked again, a pass says what the reply would have been under another way of choosing between the
  answers (the decider always, the answer most slots hold, the decider only where it is sure, or only where there is no
  majority). That ranks those ways in the plan.
- **A small model beside the decider.** The decide step can also ask one of the swarm's own models (as a checker of it, or
  as another of its slots) which answer is correct, in one of three ways the search tries: only where the decider is close
  (its pick narrow or under 0.6), choosing between its two likeliest and settling it; at the same time as the decider,
  its pick adding 0.35 to the decider's probability for that answer; or only where the decider's pick is not the answer
  most slots hold, choosing between the two. Where the model names nothing, the decider's pick stands. Each way is offered
  with each model of the swarm from the start (the first checker's model, and every other one by its checker or first slot),
  so no model goes unasked. These need a model asked again, so the replay above cannot rank them.
- **The same meaning in other words is the same answer, and one changed fact is not.** Whether two answers in words (or two
  replies in a conversation) say the same is read by a decision model: wording, order, length and warmth do not count; a
  different fact, recommendation or step does.
- **A reader is checked before it is believed.** Before each pass it is given pairs of three kinds: paraphrases (the same
  answer in other words: it must say the same), near-misses (nearly the same words with one fact changed, some written, some
  made from the larger model's own answers: it must say they differ), and plainly different answers. It is believed only if
  it reads four in five overall and three in four of the paraphrases and of the near-misses: a reader that only sees what an
  answer is about fails the near-misses.
- **An undecided reading is said to be one.** A reading close to the reader's line is graded different (so it cannot claim
  an answer is good that is not), counted apart, and never decides whether a change is kept. Read against a standard, a
  reply at the reader's line or above is a yes.
- **The larger model against itself.** A question with no standard of its own is put to it three times (another draw each
  time), train and held, and its answers are read against each other by the same readers. Those that agree are the standard:
  a reply is good against any of them. Asked twice it gave an equivalent answer on 17 of 36 such questions; with three, 31 of
  36 train questions have a standard and 5 have none (2026-11-18). How often it agrees with itself is the noise floor under
  any comparison with it, and is in the spec.
- **A judge apart from the decider.** The configuration can name a decision model to judge equivalence (**Judges
  equivalence**); the session serves it beside the decider, so the swarm's own decider does not grade the answers it chose.
  Where none is named, the decider judges, and the dashboard recommends one.
- **No flip goes unnamed.** Each pass names the held questions that were equivalent at the end of the last pass and are not
  now, and those that were won: a total that did not move can hide both.
- **Every held question is asked a second way.** The wording changes and what is asked does not: every number, name, rule
  and argument is the same. Every kind of question has a second wording (236 of the 240 held questions a pass asks plainly, six of each kind; the four
  without are a message there is no other way to put and three steps that end on what a tool returned). Equivalence that
  holds for one wording only is not fundamental, and is reported beside the first.
- **What the proof finds short is asked more of.** At the end of a pass the newest evaluations of the configuration are read
  for each capability's verdict. A capability found short has two more train questions of each of its kinds in the next pass
  (`questions.shortMore` in the policy; 0 turns it off), on top of what the pass's own held questions ask more of, to at most
  six more of a kind. Only the verdict is read: never a question of the test, an answer to one, or which the swarm got
  wrong, and a verdict never decides whether a change is kept. A proof that has weighted a pass is no longer blind to it, so
  the pass's record, the page and the SwOA say that it was read, and of which date.
- **A bar that is held tightens.** A kind of question the Swarm has been at parity on for three passes is asked more of.
- **How it trains is data.** The loop's limits, what the plan lists first and how much each kind of move counts for are in
  [`training/policy.json`](../training/policy.json), not in code. A configuration can carry its own values over them.
- **Each pass feeds the next.** A pass ends by writing down where the Swarm answered differently, which slots did worst, what
  was tried and not kept, and what to ask arXiv. The next begins from that, with new questions.
- **At parity, it climbs.** When every answer is equivalent, the next, larger model becomes the target.

| Script                                                                                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training/setup.mjs`                                                                     | Fetches and makes ready the engine, the models and the decider. A download that stops carries on; a file that arrives wrong is fetched once more                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `training/run.sh` | The whole of training in one run (the dashboard's Run): evaluate as configured, make an adapter for each drafting slot, train class by class (the arrangement, which slot carries its adapter, the instruments), evaluate again, each evaluation on the same questions. `--limit N` or `--proof` sizes the evaluations, `--items` names the bodies of work, `--train classes` or `off`, `--train-minutes M`. A stopped run carries on from its step |
| `training/support/made-by.mjs` | What made each step of the whole run: its programs and what they bring in, the module, the policy and questions, a probe's leads, the arrangement an evaluation measures. A step that ended well is passed over only where that is as it was; otherwise Carry on does it again and says what changed |
| `training/support/asks.mjs` | The fingerprint of what asks the models of an evaluation (the relay, the harness's arguments, a tools test and its search), which every kept folder of answers is named by: a change to how a model is asked asks every model again, with no number to bump |
| `training/support/leads.mjs` | What a probe left for training to try first: each lead of a class is put on the class stage's held questions before its first round and kept by the same rule as any change. Never adopted unjudged |
| `training/session.sh` | One session: pass after pass, each step of a pass in order, resumed where it stopped |
| `training/mixture.mjs` | Makes an adapter for each drafting slot: many questions of every kind, the slot's own request, its own answer where it was right and the larger model's where it was not. The adapters are on no slot; the class stage tries each as a move. `mix-record.mjs` is their record. `training/prove.mjs` asks one question at a time with and without a change and compares the two paired; `training/wide.mjs` has the larger model write the Python tasks |
| `training/classes.mjs` | The class stage: each class of input trained as a class, a candidate arrangement tried on its train questions and kept on its held ones; instruments are candidates here |
| `training/write-code.mjs` | Code training writes: asks a model of the swarm for a function for a kind the class is short on, runs it on questions it was not shown, refuses it on one wrong answer; what passes is a move of the class stage |
| `training/keep.mjs` | The one rule a change is kept by, at every stage: the paired gain on held questions against its error, what it loses against what it makes good, and no kind falling |
| `training/wordings.mjs` | New ways of asking each operation, written by the larger model every pass and kept only where its own answer is right; parted between train and held questions, so an instrument is kept on wordings its trying never saw |
| `training/pass.mjs`                                                                      | Begins a pass from what the last one left, and ends it with the verdict and what the next pass needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `training/plan.mjs`                                                                      | Reads where the answers were lost and says what can be tried, in what order, and why. The loop tries from it and marks each move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `training/research.mjs`                                                                  | New papers from arXiv on what the last pass left open. A reading becomes a candidate, never a change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `training/baseline.mjs`                                                                  | One model by itself: the larger model (`--self` and `--third`: asked again, for the standard among its answers), and each small model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `training/tasks.mjs` and `tasks-*.mjs`                                                   | The questions, made from a seed, each with the standard its answer is graded by: code, the conversation of a seat, rules a program checks, calling a function, a search tool, an agent's steps. A pass asks the kinds of every body of work in `training/equivalence.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `training/support/standard.mjs`                                                          | The standard for a question that carries none: the answers the larger model agrees with itself on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `training/support/emphasis.mjs`                                                          | What the next pass asks more of because the proof found the swarm short there: each capability's verdict from the evaluations on record, by the rule of the SwOA specification, and the kinds of the body of work that trains it. It reads a verdict and nothing else of a proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `training/measure.mjs`                                                                   | The Swarm, and every slot on its own account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `training/loop.mjs`                                                                      | Training itself, question by question: each train question stays in hand until the swarm's answer to it is good, changes are tried on it one at a time, and one is kept when the questions of its class got better with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `training/write-briefs.mjs`                                                              | New briefs for the slots that are failing, written each pass by the larger model from their misses on train questions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `training/members-probe.mjs`                                                             | Whether another small model on this machine drafts what no slot drafts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `training/decider-replay.mjs`                                                            | Whether another decider would have chosen better, on a measurement's recorded choices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `training/support/across.mjs`                                                            | What other configurations kept, as moves this one measures first and briefs it can try. Read, never written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `training/support/steer.mjs`                                                             | What a person asked of the plan from the dashboard: areas leaned on or left out, moves put first or skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `training/replay.mjs`                                                                    | One measurement replayed under each way of choosing between the answers, with no model asked again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `training/readers.mjs`                                                                   | Checks the reader of answers in words on pairs anyone can judge, before its grades are believed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `training/policy.json`                                                                   | How the trainer trains, as data: how many questions of each kind a pass asks and how many more where the proof found the capability short, how many changes are tried on a question, how a change is kept (by its class: how many questions it is raced on, the gain it must show, how far a kind may fall), what the plan lists first                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `training/arrange.mjs`                                                                   | Arrangements one step from the current one. The flow: answers sent back to their drafters, a loop of checking and revising, a decision that narrows before the one that settles, a decision that settles early only if it is sure, each of them and a check or a revision put after every step in turn, a second writer, a step taken out, two steps changing places. The slots: one moved to the other model, a drafter or checker added or dropped, what a checker sees, how freely a drafter samples                                                                                                                                                                                                                                                                                                           |
| `training/decider.sh`                                                                    | Installs and runs the configured decider beside the Swarm, by the recipe its entry gives (Kev; StartLux through MLX; a GGUF file through llama.cpp); `ready` says whether it is installed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `training/search.json`, `training/support/search.mjs`, `training/support/bfcl_search.py` | The search behind the web search test: which service and at which revision; serving it for a run; and putting it behind the test's own search function, with what each query returned kept for the day                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `training/evaluate.mjs`, `training/evaluate.sh`                                          | Evaluate the swarm: lm-evaluation-harness (installed into `.work/lmeval` the first time) runs the standard tasks of each body of work (every one, or those `--items` names) against the larger model and the swarm, through a relay that asks both the same way; `support/harness_agree.py` compares every question's two answers. A task of the tool tests goes through `support/bfcl.mjs` instead: the Berkeley Function-Calling Leaderboard's own package (installed into `.work/bfcl`), a relay that sends on the conversation and the functions as they came, and the two models paired on the package's verdict. `--proof` asks each task at its proof size, and a run that was stopped carries on from the task it stopped in. Writes `.work/eval/live.json` while it runs and `results.json` when it ends |
| `training/originals.json`                                                                | Each small model's original weights (what MLX trains an adapter from), by the GGUF file the swarm serves, at a pinned revision, for every small model of the catalog; or why one cannot be adapted here (the Bonsai 2 models, Hadamard-rotated; LFM3 1.7B, whose architecture mlx-lm 0.32.2 does not have)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `training/adapters.mjs`                                                                  | The next lever when rearranging is not enough: the larger model's train answers as a dataset, whether each small model can be trained here, and `train`, a LoRA adapter for each, written for llama.cpp and kept only where it makes those answers likelier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `training/mlx-setup.sh`                                                                  | Installs MLX under `.work/mlx`, with a Python of its own where `uv` fetches one, and fetches the small models' original weights it trains from, each at a pinned revision (Apple silicon). An install that was interrupted is made again. Pretrain installs MLX with it and fetches each model's weights as it trains that model; by hand it fetches the weights of the swarm's own small models (`--all`: every model's)                                                                                                                                                                                                                                                                                                                                                                                         |
| `ui/cleanup.py`                                                                          | The Uninstall Helper: what the Swarm has put in `.work` (models, the engine, each decider's program and weights, lm-evaluation-harness, the tool tests, the search behind the web search test and the answers evaluations kept, MLX, each model's original weights and Pretrain's adapters, what training keeps), with sizes, and removing one piece at a time. Never anything outside `.work`, never through a link, never what training has learned, never while a session runs                                                                                                                                                                                                                                                                                                                                 |
| `training/publish.mjs`                                                                   | Writes what was measured to `src/trained.json`, this machine's summary for a model card (not committed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The questions are made from a seed, so there is no list to learn by heart. For The Crew: small programming ones (write a
JavaScript function, correct one with a flaw, say what a short program prints, say what is wrong with one), the
conversation of a seat on a team, in Simple and in Developer, and an agent's next step with tools. Code is The Crew's
programming kinds alone; Math, Logic and Reasoning have kinds of their own, four of them operations code does exactly (a sum, an expression of true and false, words to put in order, brackets to close), which is how training measures what an instrument is worth; Instructions asks for a few lines under one to
three rules a program checks; Tools offers functions and a request that needs one, two or none of them, or lacks an argument
only the person knows; Search offers a search tool and a fact made up from the seed, which no model can know; and each can
carry questions a person wrote. None of them is a benchmark's question. [training/TRAIN.md](../training/TRAIN.md) is the procedure, and
`training/research.md` what was read on this machine (it is written by the first pass, and not committed).

## The two runs, and who judges them

**Two runs, apart.** The run that evaluates, trains and evaluates again is the intelligence run, judged by outside benchmarks (**Run Intelligence Training** on the
dashboard). The conversation run is a card of its own under it (**Run Conversation Training**): one press is one pass over the class of input that is a conversation, judged on held
conversations read by code, with the passes side by side. No benchmark is asked.

**Each pass learns from the last.** A pass writes down every kind of question it was still wrong on and every
convention a reply still missed; the next pass asks more train questions of those.

What is tried first follows where the class falls short: no slot had the answer, a slot had it and settling lost it, or
the reply spoiled it.

Training's held questions are its own, so what it keeps is still to be shown by the benchmarks; so far it has not been
([Results](results.md)).

```bash
bash training/run.sh
```

That is the whole of it in one run, with the two figures it is judged by: the module is evaluated as configured, an
adapter is made for each drafting slot, the module is trained (the arrangement, which slot carries its adapter, the
instruments), and it is evaluated again on the same questions (the dashboard's **Run Intelligence Training**). The evaluation
is a third party's: EleutherAI's [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) and the
[Berkeley Function-Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) ask the module through the
chat-model interface as they ask any model. Training makes its own questions from a seed, never asks a benchmark's, and is not shaped to how a benchmark asks.
[Training, in full](training.md) · [The procedure](../training/TRAIN.md)

## The Crew: the first project that uses it

[The Crew](https://myfamilyoffice.eth.limo/start.html) is the reason this project exists, and its body of work is the
first on the list, Programming and its conversation: the work of a seat on a team, in two parts.

- **Programming.** A **function** is run on the question's inputs beside the question's own correct solution, and is right
  when it does the same on every one, however differently it is written; the larger model's function is counted the same way.
- **The conversation around it.** A person writes to the team, in Simple mode (an everyday question, something the team
  cannot do for them, something it must ask about, a piece of writing, a hello or a thank-you, something heavy) or in
  Developer mode (a question of good practice, their own project, a ticket attached to the chat). Each is sent the way a
  seat is sent one: a system line saying who is speaking, what it can and cannot do and how to reply, then the turns so far.
  A reply is good when it is equivalent to an answer the larger model agrees with itself on, and two replies are equivalent
  when they do the same thing for the person: the same **act** (both help, or both ask for what
  is missing), the same **substance** (the same answer, advice or next step; a piece of writing with the same facts and the
  same request), and no **convention** broken that the larger model's reply kept (claiming to have booked or sent
  something, running well past the length asked, praising the question, signing off with an offer of more help, a
  developer's words to someone who is not one). The decision model reads the act and the substance, in one request; the
  conventions are read off the words.

It has no benchmark of its own in [Evaluate the swarm](dashboard.md#the-dashboard): programming is measured under Code, an agent's
steps with tools under Tools, following instructions under Instructions (IFEval), and the conversation has no standard
task in either harness. Code, Math, Logic, Reasoning, Instructions, Tools and Search stand on their own.

## Recovery

A pass runs for hours on one machine, and over hours something goes wrong. A session that stopped at the first fault would
never finish, and one that carried on regardless would measure nothing, so each kind of fault has its own way back:

| What goes wrong                                                         | What is done about it                                                                                                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model server stops or hangs in the middle of the work                 | It is started again and the question is asked again. Slots waiting on the same server share the one restart                                                     |
| A model server will not start                                           | Tried the way that fits why: without a flag an older llama.cpp does not know; with half the context, then a quarter, where memory is short; once more otherwise |
| The larger model's reply holds no answer                                | Asked again, with another draw, twice. Still nothing: that question is not compared, and is counted as such                                                     |
| The larger model's server stops                                         | Started again, and the question asked again                                                                                                                     |
| The larger model's server says it is restarting                         | Waited for, and asked again the same way                                                                                                                        |
| The larger model's engine does not know a flag it is better served with | Served without it, and that is recorded                                                                                                                         |
| The decider stops                                                       | Started again before the next step. Its port is found free at the start of the session                                                                          |
| A trainer stops partway                                                 | Every answer is written down as it comes. Run again, it asks only what is left                                                                                  |
| A step of a pass fails                                                  | What it left running is stopped and it is run again, three times at most. If it still fails that is written down and the pass goes on                           |
| The session itself stops (a crash, a closed lid, a power cut)           | The next session resumes the same pass for the same models: steps that finished are passed over                                                                 |
| A dead session left model servers holding memory                        | They are stopped before the next session loads its own. Only servers started from this folder are touched                                                       |
| A file was half written                                                 | State, briefs and configuration are written whole or not at all, with the last good copy kept and read if the file will not                                     |
| A download stops, or arrives wrong                                      | It carries on from where it stopped; a file that fails its SHA-256 is thrown away and fetched once more                                                         |

Every way back that is taken is written to `.work/train/recovery.jsonl`, and the dashboard lists them beside the steps. A
pass that needed twelve restarts is not the same evidence as one that needed none, and it should be possible to tell which
is being looked at.

A session stops, and says why in a sentence, only where there is no way back: no room on the disk, no network for a file
that is not here, a larger model this machine cannot serve, no Node 20.

```bash
node training/support/recover.mjs reap
```

stops what a dead session left running, by hand.
