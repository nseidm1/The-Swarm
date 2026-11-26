# Measured, not claimed

Every measurement, dated, newest first. Each is of the swarm named in it; the lineup has changed over time.

## What context costs, and what works at once: 2026-11-26

Measured on llama.cpp b12110, an M2 Ultra with 64 GB, twelve server slots of 4,096 tokens.

| | LFM3 1.7B (4-bit, 1.1 GB file) | Bonsai 2.5 27B (2-bit, 7.7 GB file) |
| --- | --- | --- |
| Read, tokens a second | about 3,700 | 280 |
| Written, tokens a second, one call | about 200 | 28 |
| Written together, 1 / 2 / 4 / 6 calls at once (each reading 1,100 tokens first) | 147 / 174 / 224 / 248 | 17.6 / 21.3 / 27.2 / 30.5 |
| Memory, a share of context for every slot | 2.1 GB | 18.3 GB with half the context touched; 20 GB in a run |
| Memory, one pool of 16,384 tokens | 1.7 GB | 14.7 GB, and no more however long it runs |
| Speed with the pool | about 15% less written a second | the same alone; about 13% less with six at once |
| A brief still held when its slot is asked again | no: all 1,541 tokens were read again | yes: 730 of 1,867 tokens |

- A token of context took about 13 KB on the first and 250 KB on the second: about 9 KB for each billion parameters.
- Six calls at once wrote 1.7 times what one did, on both. Little is gained past that.
- Watched for ninety seconds in an evaluation, the Bonsai swarm had one or two slots working and never more.
- One evaluation question on the Bonsai swarm, traced: four calls read 4,123 tokens and wrote 956 in 62 seconds of
  model time. About a quarter of that was reading, over half writing. Two drafts each ran to their limit of 450 tokens,
  and the writer then wrote 440 tokens that were nearly a copy of one draft.
- When the pool is full the server drops what the slot idle longest remembered, and nothing fails.

What follows from it is in the changelog. Two things were not changed, because each needs measuring against answers
first: the writer is still asked where the drafts agree, and a draft's limit is as it was.

## Where the other classes stand, and what code does there: 2026-11-25

The classes that are not plain questions, on training's held questions (LFM3 1.7B in every place). No benchmark was
read.

| Class | As the swarm stands | What was found | What was done |
| --- | --- | --- | --- |
| Requests for code | 45 of 60 | wrong where the function fails a case the question does not show: equal counts, a missing part, the way round | nothing: no check that code can make from the question alone was found |
| Turns with tools | 15 of 18 | one searched for "What is 12 times 15?"; one called with a date nobody gave; one path written another way | the first: an instrument that is on now answers such a turn, and nothing is called |
| Conversation | 77 of 78 (measured earlier) | no shortfall to mend; but with every instrument on, code answered 58 of 202 held conversation questions | a reader for the small sums people ask in passing: 132 of 202 by code |

- **Conversation, with no model run.** Through the module, every instrument on in that class: 58 of the 202 held
  questions were answered by code before, all 58 good by the conversation's own standard (a plain question asked in
  a conversation 36 of 46, who is the tallest 12 of 12, a share of a number 10 of 24). With the reader added, 132,
  all good: seven kinds of turn, 12 of 12 each. Not read, and a model's: a turn that leans on the one before ("and
  double that?", "Sorry, I meant 12 tickets, not 10."), a doubt, a thanks, a request for code.
- **Turns with tools, with no model run.** Of 36 held turns, 3 are sums asked with a search tool offered: all 3 are
  now answered by code, rightly, and no slot is asked.
- **Requests for code: by kind.** A function on numbers 6 of 6 and 5 of 6 (JavaScript, Python); on arrays 5 and 6; on
  strings 4 and 6; one that parses text 3 and 4; correcting a function 3 of 6; the larger model's own Python tasks 3
  of 6. The replies that were wrong ran and gave an answer; they were wrong on inputs the question describes in
  words and does not show.
- **A number and what is done to it, guarded.** Two questions of buying and selling had been read as one and
  answered wrongly. Such a reading now has to use every figure of the question; with one left over it gives no
  answer, and the slots answer as before.
- **Not measured.** Any of this with models in a pass: the reader and the tool-turn rule are measured as code, on
  whether what they give is good, not on what a class gains by having them on.

## What each layer is worth, on one lineup: 2026-11-25

The held plain questions of training (LFM3 1.7B in every place, no decision model), each answered five ways. Six
questions of each of 24 kinds: the 22 kinds as they were, and the two added that day, which the arrangement as it
stands met here for the first time. No benchmark was read.

| How it was answered | Of the kinds as they were (132) | Of every kind (144) | The two kinds added (12) | Seconds for all |
| --- | --- | --- | --- | --- |
| The small model alone, asked as the question came | 87 (65.9%) | 90 | 3 | 315 |
| The swarm as a module starts: slots, briefs, deciding | 115 (87.1%) | 126 | 11 | 834 |
| The swarm as it stands, with what training kept | 115 (87.1%) | 126 | 11 | 849 |
| With every instrument on | 131 (99.2%) | 143 | 12 | 162 |
| With every instrument on, and the forms read by the drafters | 129 (97.7%) | 141 | 12 | 194 |

- **The arrangement is the largest single step.** Slots, briefs and deciding took the model from 87 to 115 of 132
  with nothing learned, and from 3 to 11 of 12 on two kinds they had never been arranged for. Of the 28 questions
  gained, 24 are of kinds an instrument also reads as worded here, and 4 of kinds none does (what a program prints,
  rates, and the like): so on these wordings code could have had most of that gain by itself, and the arrangement's
  own part is clearest where no instrument reads.
- **What training had kept changed nothing here.** The stored arrangement differs from the starting one and answered
  exactly as it did.
- **The instruments took what was left, on these wordings.** 108 of the 144 questions were answered by code with no
  model asked, and all but one question of the 132 was right. It also cost a fifth of the time. **A limit, said
  plainly:** these are questions worded as training words them, which is what the instruments were written to read;
  on questions put another way they read few (5 of 73 and 3 of 71, measured above), and there the arrangement and
  the forms are what answers.
- **The forms cost two questions here.** With the instruments on there was little left for them: three questions
  were answered by reading, and two were wrong, both of the kind "buys so many boxes, gives some away, sells the
  rest", which two readings agreed to write down as a number and what is done to it, wrongly. On this class as
  worded, a round would not keep them; on questions put another way they gained 11 of 71. Which it is for a swarm is
  what training measures.
- **By kind, where the arrangement left most:** a word and what is done to it 1 of 6, who tells the truth 2 of 6,
  things in a row and brackets to close 4 of 6; every one 6 of 6 with its instrument on.
- **Not measured.** Another lineup; another class (conversation, tools and requests for code have no instruments or
  forms, and there the arrangement is the only thing that answers); how much each kind of arrangement change adds.

## What the writer can be trusted with, a rung at a time: 2026-11-25

Training asks the larger model to write things that go into the module. How far that can go was measured for one
writer (Nemotron 3.5 Lightning 30B), on questions training makes itself; no benchmark was read.

| Rung | What the writer does | Kinds passed | Held (75% of kinds) |
| --- | --- | --- | --- |
| fills | fills the module's forms for held questions of the kinds they were made for; the form's code answers | 11 of 12 | yes |
| lays | lays a kind no form was made for onto a form that fits, saying how a model is to fill it; vetted on 9 questions it was not shown, refused on one wrong answer | 5 of 6 | yes |
| writes | writes a function that works a kind out from the question, vetted on questions it was not shown | 4 of 12 | no |
| designs | designs a new form and writes its code together (tried apart, four ways) | 1 of 8 at best | no |

- **Fills.** Every kind 8 of 8 or close, none wrong, but things in a row: 4 right, 1 wrong, 3 with no answer.
- **Lays.** Six kinds made for this, each a thing a form can record about something else than the form's own
  questions: ages (an ordering), a queue (a row), money in an account (a number and what is done to it), a meeting
  moved (a day of the week), machines that report (who tells the truth), a book that is due (a date). The writer
  named the right form for all six. Five readings were kept on the first try, 43 right of 45 questions unseen, none
  wrong; the one for ages was refused three times, its own example not worked out by the form's code.
- **Writes.** Kept for a number and what is done to it, a day of the week, a count of letters, a count in a stretch;
  refused for the other eight, most for returning nothing on every question shown.
- **Designs.** Asked cold, nothing was kept of eight kinds; shown two whole worked replies for other kinds, one (a
  word and what is done to it), and the small model read 10 of 10 reworded questions with it as with the form
  written by hand; the form first and the function after, twice, nothing. What came back wrong was the writer's own:
  forms that held the answer (a field `result`, `valid`), functions that returned the first option's letter.
- **What follows.** For this writer the line is between laying and writing: it can be asked to lay a kind onto a
  form, not to write the code that works one out. So the forms and their code are the module's own, written and
  tested here, and training asks its writer for readings. The class stage reads the ladder and asks for a reading
  only where `lays` is held or was never measured (`training/ladder.mjs`, `training/write-reading.mjs`).
- **Not measured.** Another writer; whether a reading laid by the writer is kept by a class on held questions read by
  the swarm's own models (one dry round was started for that).

## A model reads, code works it out: 2026-11-25

Of the kinds of plain question training asks, eight are ones code can work out whole, and the larger model, asked to
write a function for each, wrote none that passed. Two things were built and measured. No benchmark was read.

**Instruments that read the wording training uses.** Twelve, written by hand from training's own questions (the
last four of the table were added after the measurements of forms below). With no
model run, each is right on 40 of 40 train questions and 40 of 40 held ones of its kind:

| Instrument | Held questions right | The swarm on held before (LFM3 1.7B) |
| --- | --- | --- |
| who tells the truth | 40 of 40 | 2 of 6 |
| a word and what is done to it | 40 of 40 | 1 of 6 |
| things in a row | 40 of 40 | 3 of 6 |
| a date so many days on or back | 40 of 40 | 5 of 6 |
| when someone was free | 40 of 40 | 6 of 6 |
| who is the tallest | 40 of 40 | 6 of 6 |
| how many more of one figure than another | 40 of 40 | 6 of 6 |
| whether an argument holds | 40 of 40 | 6 of 6 |
| a number and what is done to it | 40 of 40 | not measured |
| a day of the week so many days on or back | 40 of 40 | not measured |
| how many times a letter stands in a word | 40 of 40 | not measured |
| how many numbers of a stretch can be divided | 40 of 40 | not measured |

Of 880 questions of other kinds, they answer 16: every one a question of who is the tallest asked in a
conversation, and rightly. (What a program prints is the ninth such kind; the module already runs such a program.)

**Forms, for questions put another way.** An instrument reads a wording, so held questions were reworded by the
larger model (kept where every name and figure was still there): 73 questions, of which the instruments read 5. The
small model then says which form a question is of and writes what it says into the form; code works the form out;
an answer stands where two readings agree and none differs. Five measurements, each after mending what the one
before showed (LFM3 1.7B as reader; the swarm asked the same questions beside it):

| Measurement | Read and answered | Right | Wrong | The swarm alone | Reading where it answers, else the swarm |
| --- | --- | --- | --- | --- | --- |
| 1: forms picked by a few words, no example | 13 of 51 | 11 | 2 | 40 of 51 | not measured |
| 2: the form picked by the model | 25 of 61 | 17 | 8 | 47 of 61 | 46 of 61 |
| 3: an example of each kind shown; forms refused that repeat the conclusion | 26 of 73 | 24 | 2 | 52 of 73 | 57 of 73 |
| 4: the nearby form tried too | 31 of 73 | 27 | 4 | 51 of 73 | 56 of 73 |
| 5: sentences copied as written; a form may not say more than the question; two readings before a third | 38 of 73 | 35 | 3 | 50 of 73 | 57 of 73 |
| 5, its stored readings worked out again after two more mends (no model run) | 42 of 73 | 40 | 2 | 50 of 73 | 62 of 73 |

- **What it cost, measurement 5:** 290 calls and 124 seconds of reading over the 73 questions, beside 730 seconds for
  the swarm to answer them. A question the reading answers is not put to the swarm.
- **By kind, measurement 5:** a word and what is done to it 7 of 7 read and right (the swarm alone 4); who is the
  tallest 10 of 12 read, all right; when someone was free 5 of 8, all right; a date 3 of 5, all right; things in a
  row 3 of 12, all right (the swarm alone 3); whether an argument holds 6 of 12 read, 5 right; how many more 4 of 7
  read, 2 right; who tells the truth none read (mended after: 5 read, all right, worked out again from the stored
  readings).
- **The larger model as reader** (Nemotron 3.5 Lightning 30B, one reading, nothing to agree with, the form picked as
  in measurement 3): 44 of 73 answered, 36 right, 8 wrong. Arguments 12 of 12, dates 5 of 5, a word 6 of 6. Four of
  the eight wrong are questions of how many more whose rewording had become unclear about which figure comes first.
- **Limits of that set.** The mends were made against these 73 questions, so its last rows flatter them, and one
  model reworded them. The swarm's own count moved between 50 and 52 from run to run on the same questions.

**A second set, that nothing was mended against.** 71 other held questions, reworded in other voices (a message to a
friend, a puzzle at a quiz night, a request to a colleague); the instruments read 3 of them. Read once, with the code
as it stood after the first set:

| Reader | Read and answered | Right | Wrong | The swarm alone | Reading where it answers, else the swarm |
| --- | --- | --- | --- | --- | --- |
| LFM3 1.7B, two readings agreeing | 34 of 71 | 27 | 7 | 44 of 71 | 52 of 71 |
| The same, the form of how many more left out | 29 of 71 | 25 | 4 | 44 of 71 | 55 of 71 |
| Nemotron 3.5 Lightning 30B, one reading | 61 of 71 | 55 | 6 | | |
| The same, the form of how many more left out | 50 of 71 | 48 | 2 | | |

- **How many more of one figure than another is not read reliably.** On this set the small reader answered 5 and was
  right on 2; the larger answered 11 and was right on 7: both took the two figures the wrong way round. That form is
  therefore not among the ones `plan.read: true` turns on; it is on only where it is named. The rows that leave it
  out are worked out from the same readings, with no model run again.
- **What it cost here:** 279 calls and 121 seconds of reading over the 71 questions, beside 675 seconds for the swarm
  to answer them.
- **What this says.** Reading a question into a form, and working the form out by code, answers questions put another
  way that no instrument reads, with either reader; how many it answers and how often rightly goes with the model
  that reads. That is why it is a change training tries and keeps for a lineup, not a thing that is on.
- **Not measured.** A pass of training with reading on; a lineup of two different small models, whose readings would
  differ in more than a draw; a set reworded by another model than the one the swarm is brought to.

## The same reading, of the classes the intelligence run trains: 2026-11-24 and 25

Does what was learned on conversations carry to plain questions and code? LFM3 1.7B in both places, as it stands for
those two classes (no intelligence pass has trained it), asked every train question of them once, 192, and each wrong
reply read. The held questions were not read.

| | Right | Wrong | Of the wrong: no slot had it | A slot had it, settling lost it | Settled right, the reply spoiled it |
| --- | --- | --- | --- | --- | --- |
| Plain questions (132) | 103 | 29 | 15 | 3 | 11 |
| Asking for code (60) | 42 | 18 | 9 | 9 | 0 |
| Both (192) | 145 | 47 | 24 | 12 | 11 |

What the 47 were:

- **Spoiled, 11:** the answer was settled rightly and the reply was read wrong. The writer wrote the work out again
  and closed on a sentence with several figures in it ("Thus there are 12 whole numbers between 15 and 62 inclusive
  that are divisible by 4", read as 4), or began with the question word for word ("Today is Thursday. What day ...",
  read as Thursday). The first is what "the settled answer goes out as it is" or "alone" mends, a change the class
  stage already tries and kept for conversations; the second is mended in the module (below).
- **Lost, 12:** an answer line that went on to doubt itself was read whole ("... velvet violet? Wait need correct
  order."), so a right answer was no slot's; a block of code begun on the answer line and not closed was read as the
  word "javascript" and had a vote; and for code, the behaviour most drafts shared was the wrong one.
- **None, 24:** no slot had it. Four of six chains of who tells the truth, where every drafter ran out of room before
  answering; the harder code kinds; some reasoning.

Three mends to the module came of it (an afterthought on the answer line is cut off; a line that only opens a block of
code is no answer; the question's own lines come off the head of every written reply), and the class of code then
stood at 44 of 60 train questions where it had 42.

**Do such mends reach a benchmark?** The two code benchmarks, 100 questions each, the module as configured with no
training, on the lineup they were first read on (LFM2.5 1.2B), with every mend of these days in the code:

| | HumanEval | MBPP | Both |
| --- | --- | --- | --- |
| 2026-11-23 | 60 | 35 | 95 of 200 |
| 2026-11-25, the same arrangement | 57 | 38 | 95 of 200 |

Eight answers changed, four each way: no gain, with a paired error of about 1.4 points. The fix to the answer line
does not reach these benchmarks, whose answers are blocks of code and never sat on an answer line.

- **What carries:** the machinery (it is one stage for every class) and the way of looking. Reading wrong replies
  found three more faults of the module in an hour.
- **What does not carry by itself:** the gain. What was mended here was read from training's own questions, and the
  benchmarks did not move. That is the difference from conversations, which are judged on the questions they are
  trained beside.
- **A pass of the class stage on plain questions, keeping nothing** (four and a half hours, 70 changes tried in each of
  two rounds). The module's mends alone took the class from 103 to 106 of 132 train questions. Round 1 kept one thing:
  a function the model wrote for one kind of question (how many numbers in a range divide by another: right on 3 of
  3 it was not shown), 6.3 points on 150 held questions with a paired error of 1.9. Round 2's best, the question put
  to the drafters in numbered lines, was 3.0 points with an error of 2.0 and was not kept. Train 106 to 111 of 132;
  held 113 to 115 of 132. "The settled answer goes out as it is" gained 3.0 points on the train questions and was
  not the round's best. Written for three other kinds, the model's functions were refused.
- **Not run:** a pass on the class asking for code (begun and stopped: over an hour for one round), and any benchmark
  after this pass.

## What code can fill where the model cannot work it out: 2026-11-25

Of the plain questions no slot had right, most are operations on symbols a small model does badly by reading and a few
lines of code do exactly: counting a letter in a word ("referee" has one r), reversing a word, putting words in order,
closing brackets, a rate worked to the minute. So: can a program the model writes for the question in hand fill them?
Every train question of the class (132), LFM3 1.7B, a drafter that answers by a program asked beside the slots, with
no vote:

| | Of 132 |
| --- | --- |
| The slots settled on the right answer | 107 |
| The program ran and printed something | 115 |
| What the program printed was right | 65 |
| The program right where the slots were wrong | 9 |
| The program wrong where the slots were right | 37 |

A program written for one question by a 1.7B model is right less often than the model's own slots. Six of six chains
of sums were worked wrongly by the program and rightly by the slots; so were five of six counts, five of six days of
the week, three of six letters. Where it filled: who tells the truth (2), when someone could have gone (2), whether an
argument is valid (2), a rate, a word, an ordering. Let stand wherever the two differ, it would lose 28 questions.

- **What does not work at this size:** code written unseen for each question. It is not checked against anything.
- **What does:** code that is checked before it is trusted. The function the same model wrote for counting numbers in
  a range was run on questions it had not been shown, kept by the held questions, and is then right every time; the
  instruments a person wrote are exact. The difference is the vetting, not who wrote it.
- **Three fills cost nothing:** where the slots settled on no answer at all and the program printed one, it was right
  three times of three. And on 10 of the 29 wrong plain questions some drafter had given no answer, cut off before it
  reached one.
- **Not measured:** the same on a larger small model, whose programs should be better; a larger model writing the
  per-kind functions; whether a function written from training's wordings reads a benchmark's.

## A function that returns nothing for every question it was shown: 2026-11-25

Of the twelve kinds of plain question the larger model was refused for, most were refused because the function
returned null for every question it had been shown. Is that how it is asked, or what it can write? Three changes to
how it is asked, each measured on all 21 kinds (nine passed before any of them):

| What was changed | Kinds that passed, of 21 |
| --- | --- |
| Nothing | 9 |
| Each example shown as the call it is, `answer("...")` and what it must return | 5 |
| The writer told the line its function gave up at ("it returned null at: `if (lines.length < 2) return null;`") | 8 |
| That, and every other try a fresh one shown other questions of the kind | 9 |

None made a function pass that had returned nothing. In every run a function passed on its first try or, with two
exceptions in 84 kinds asked, not at all: told what was wrong, and where, this writer writes the same fault again.
Showing the call made it worse (chains of sums, shop sums and rates, written rightly at once before, were written
wrongly). So for this writer it is what it can write, not how it is asked.

What fills those kinds is code that is already in the module:

| Kind the writer was refused for | Questions (16 train, 16 held) | An instrument answers | Rightly |
| --- | --- | --- | --- |
| A sum | 32 | 32 | 32 |
| An expression of true and false | 32 | 32 | 32 |
| Words put in order | 32 | 32 | 32 |
| Brackets closed | 32 | 32 | 32 |
| What a program prints, who tells the truth, when someone was free, a row of books, an ordering, a figure picked out, a valid argument, a date | 32 each | 0 | |

- **Kept:** the line a function gave up at is told (it costs nothing and is what a person would look at); every other
  try starts again with other questions; "every instrument is on" is one change a round can try, where each alone
  was one change and a round keeps one. The call form is there and is not the one used.
- **Left unfilled:** the eight kinds in the last row. No instrument reads them and this writer cannot write one.
- **Not measured:** another model as the writer.

## The larger model writes the functions: 2026-11-25

A function is written once and vetted before it is trusted, so who writes it is a matter of how often it passes.
Every kind of plain question training asks (21), the larger model (Nemotron 3.5 Lightning 30B) asked for a function
for each, with sixteen train questions of the kind to work from (six shown, ten to vet on), five tries, vetted as the
class stage vets. Seven minutes in all.

| | |
| --- | --- |
| Kinds a function passed for | 9 of 21: what a program prints, a chain of sums, a shop sum, a rate, a day of the week, a letter counted, a doubling, a unit, numbers in a range |
| Held questions of those kinds | 54 |
| Answered by the functions | 53 |
| Right | 53 |
| Wrong, on its own kind or any other | 0 |

The swarm's own 1.7B model had passed for one kind of those and been refused for three.

- **What it is worth here:** on these nine kinds the swarm as it stood already had 53 of the 54 held questions right
  (42 of 54 train questions), so the class's held figure moves by one, 113 to 114 of 132. What changes is that 53
  of 132 questions are answered by code, exactly, in milliseconds where the swarm takes about five seconds each, and
  none can be wrong by a slip.
- **Where the swarm is weak the writer was too:** a word reversed and cut (the swarm 1 of 6 held), who tells the
  truth, a row of books, closing brackets. For sorting and brackets it wrote the same fault five times over (a
  function that wanted two lines of a one-line question); those two have instruments a person wrote.
- **What made nine of seven:** more train questions of a kind for the writing. With six, three shown, a function read
  the three wordings it saw and none of the others.
- **Not run:** a pass of the class stage with the larger model writing, which is where a function is kept or not.

## What three conversation passes could not mend, and what did: 2026-11-24

LFM3 1.7B in both places, the conversation run: 13 kinds of conversation, 78 held, each reply read by code against the
conventions of its conversation.

| Pass | Held before | Held after | Kept |
| --- | --- | --- | --- |
| 1 | 24 | 58 | The settled answer goes out as it is (+44.9 points, error 5.4) |
| 2 | 57 | 57 | nothing |
| 3 | 56 | 56 | nothing |

After pass 1 three kinds were wrong on every train question, in every pass, and the other ten nearly all right. Each
pass asked four more questions of each and tried the same sixty-odd changes. Read from the replies:

| Kind | The reply | Why |
| --- | --- | --- |
| A turn asking for code | `function times5(n) { return n  5; }` | The module took every `*` and `_` off a draft's answer line. One model asked alone had 9 of 10 |
| After "bare numbers, no units" | `9 * 5 = 45`, a blank line, `45` | The kept change sends the work with the answer. The answer alone was right on about 8 of 10 |
| "Thank you, that settles it." | `You're welcome.`, a blank line, `56` | The drafters answered the question before it again |

Then five changes (the fix to the answer line; the answer alone; a change kept for one kind of request; a turn that
asks nothing answered by one slot; candidates made from where the class is short), and one pass of two rounds on the
same swarm, keeping nothing (`--dry`):

| The 78 held conversations, first draw | Right | Thanks | Standing instruction | Code |
| --- | --- | --- | --- | --- |
| As the three passes left it | 56 to 58 | 0 of 6 | 0 of 6 | 0 of 6 |
| With the fix to the answer line alone | 64 | 0 | 0 | 6 |
| With what round 1 found | 74 | 6 | 4 | 6 |

Round 1 found, for the two kinds of request the class was still wrong on: a turn that asks nothing is answered by one
slot and tidied, and after the person has said how to answer the settled answer goes out alone. Together: 65 to 72 of
78 train conversations, and on the held ones, two draws, 12.8 points with a paired error of 3.8, so by the one rule it
would be kept. Round 2 kept nothing (2.6 points, error 1.8).

**What was still wrong after that, and the pass again.** Read from the replies once more: a reply to thanks that ended
"Anything else you need?" (an offer of help put as a question was not tidied off); "15% of 60?" worked as 15 × 0.15 by
every drafter, after a first message about how to answer; and a person in a hurry given the work before the answer.
Three mends (the tidy takes an offer put as a question; the sum instrument reads a share of a number; a change that
moved few kinds of question is confirmed on more held questions of those kinds), and the same pass, keeping nothing:

| | Train, of 78 | Held, of 78 |
| --- | --- | --- |
| As the pass begins | 65 | 64 |
| After round 1 (the two changes kept for a kind of request) | 75 | 74 |
| After round 2 (the sum instrument on, and the settled answer alone) | 78 | 77 |

Each round confirmed on 114 held conversations, the class's 78 and 18 more of each of the two kinds it moved, two
draws: round 1, 37.7 points with a paired error of 4.6; round 2, 7.0 with 2.4. Both would be kept. Without the wider
confirmation round 2's three conversations were 3.8 points with an error of 2.2, and it was not kept. The one held
conversation still wrong is a standing-instruction turn.

**The last ones, on a wider draw.** Sixteen held conversations of each kind (208), with what the pass found:

| The 208 | Right | Wrong |
| --- | --- | --- |
| With what the pass found | 203 | "7 tickets at 4 pounds" as 32, "5 tickets at 8 pounds" as 35, "3 hours 30 minutes in minutes" as 1830, "days in 4 weeks" as 4, and one "who is the tallest" |
| And a drafter that answers by a program, its figure standing | 207 | the one "who is the tallest" |

The four sums were wrong the same way from every drafter: slots of one model that agree are asked nothing further. A
drafter that answers by a program writes the sum down and code works it; asked with the first drafters, with no vote,
its one plain number stands over the one figure the slots settled on. First made as a drafter among the others it
lost 10 of 16 turns that ask two things (it printed one number and was counted): so it has no vote, and overrules
only an answer that holds one figure. This was read directly, not by the keep rule: the pass ends with every train
conversation right (78 of 78; held 77 of 78), so nothing on the train side shows the change, and it was not chosen.
What a pass leaves for the next now counts the kinds still wrong on the held side too, so the next pass asks more
train conversations of that kind and has something to find it by. That next pass was not run.

The swarm's own model was also asked to write a function for the standing-instruction turns, which are five forms of
sum. It wrote one that returned nothing for every question, three times, and was refused: a 1.7B model does not write
that function. A larger model as the writer is not built.

- **What this shows:** the passes stalled on the module and on how wide a class is, not on the model. With those
  mended, one pass moved held conversations from 64 to 74 of 78.
- **What it does not show:** anything beyond these conversations. The three facets were written after reading these
  three kinds, and they read training's own kinds exactly (each of the three is one facet, the other ten none), so
  how they read conversations nobody here wrote is not measured. No benchmark was asked.
- **Left wrong:** one held standing-instruction turn, after the mends above.

## Training writes code: the first trial, 2026-11-24

LFM3 1.7B in both places, the class of plain questions, six kinds of training's own questions (day, order, string,
lies, date, count), six train and six held of each, one round, nothing kept (`--dry`). The model was asked for a
function for the two kinds the class was most wrong on.

| Kind | Wrong as it stood (train) | What the model wrote |
| --- | --- | --- |
| count | 5 of 6 | A function on the first try: right on 3 of 3 questions it was not shown, silent on the 30 questions of other kinds |
| lies | 4 of 6 | Refused three times: a wrong answer on a question it was not shown, then two replies with no whole function |

| The class, 36 questions | As it stood | With the function for count |
| --- | --- | --- |
| Train | 23 | 28 (+13.9 points) |
| Held, first draw | 21 (count 4 of 6) | 23 (count 6 of 6) |

On the held questions over two draws the gain was 5.6 points with a paired error of 3.9: not more than twice the
error, so by the one rule **it was not kept**. Every other kind read the same with and without it.

**Judged where it acts (the same trial again, the same day).** A change that puts a function on is now confirmed on
the class's held questions and on eighteen more held questions of that function's kind. The model wrote the function
for count again on its first try, and was refused for lies again.

| Held, first draw | As it stood | With the function for count |
| --- | --- | --- |
| The 54 questions | 33 | 41 |
| count (24 of them) | 16 | 24 |
| The other five kinds (30) | 17 | 17 |

Over two draws the gain was 16.7 points with a paired error of 4.8: more than three times the error, so by the same
rule **it would be kept** (the trial keeps nothing). One server stopped answering during the held questions and was
started again by itself; the question in hand was asked again.

- **What this shows:** a 1.7B model can write a function that reads a question and computes its answer, the vetting
  refuses what guesses, and the module answers by that code with no model asked (18 answers in 0.6 seconds).
- **What it does not show:** a gain on a whole class with every kind, where one kind is a smaller share, or on any
  benchmark. The 16.7 points are over six kinds with the written kind asked four times as often as the others; over
  the class's own 36 held questions the same function is worth 5.6.
- **Not measured:** a whole class with every kind, a larger model as the writer, any benchmark.

## A mixture of adapters, proved one question at a time: 2026-11-23 and 24

LFM2.5 1.2B in both places against Nemotron 3.5 Lightning 30B. Each row is the module asked the same held questions
on the same seeds without a change and with it, compared paired (`training/prove.mjs`). "Beyond error" is a gain more
than twice its paired error.

| What was tried | Questions | Without | With | Gain (error) |
| --- | --- | --- | --- | --- |
| One adapter taught one kind (day of the week), on every drafter | that kind, 6 on 6 seeds | 12 of 36 | 25 | +36.1 (9.9), beyond |
| The same adapter | 8 of other kinds, 3 seeds | 19 of 24 | 15 | -16.7 (11.5) |
| An adapter for each drafting slot, the larger model's answers only | 14, 3 seeds | 26 of 42 | 23 | -7.1 (8.6) |
| An adapter for each drafting slot: its own right answers, the larger model's where wrong, every kind | 80 fresh, 2 seeds | 84 of 160 | 84 | 0.0 (4.7) |
| The same, the code questions among them | 15, 2 seeds | 6 of 30 | 13 | +23.3 (10.4), beyond |
| The same, the plain-text questions among them | 65, 2 seeds | 78 of 130 | 71 | -5.4 (5.2) |
| The same, code questions never looked at | 15, 3 seeds | 11 of 45 | 22 | +24.4 (6.5), beyond |
| The same, held Python questions (the adapters were taught JavaScript) | 24, 2 seeds | 21 of 48 | 11 | -20.8 (7.3) |
| Adapters taught Python as well | 24 held Python, 2 seeds | 21 of 48 | 33 | +25.0 (8.7), beyond |

**The outside judge, at 100 questions a task** (HumanEval and MBPP; 2026-11-24). Training kept the adapters taught
Python as well on its own held code questions (+29.6 points, error 5.4).

| | HumanEval | MBPP | Of 200 |
| --- | --- | --- | --- |
| As configured | 60 | 35 | 95 (47.5%) |
| Trained: an adapter on each drafter for code | 42 | 33 | 75 (37.5%) |
| The larger model | 93 | 77 | 170 |

Ten points lower, and eighteen on HumanEval. The adapters were taken off the code class. At 20 questions a task the
same comparison read 21 and 20 of 40, which could not tell.

**The same judge, the adapter carried only on like requests** (2026-11-24). Training was run again with the rule
below it (a slot carries its adapter only where the request is at least 0.9 like one the adapter was taught). It kept
the adapters for code by itself (+30.8 points on 60 held questions, error 5.5), tried them for plain questions and
did not keep them (+1.1, error 2.7), and kept two kinds of plain question done by code (+8.0 on 132 held, error 2.3).

| | HumanEval | MBPP | Of 200 |
| --- | --- | --- | --- |
| As configured | 60 | 35 | 95 (47.5%) |
| Trained: adapters carried everywhere | 42 | 33 | 75 (37.5%) |
| Trained: adapters carried on like requests | 57 | 35 | 92 (46.0%) |

**Taking the question apart, on four small models** (2026-11-24; a probe outside the module, the model asked plainly
beside each).

| Small model | Plainly, 18 mixed | One fact at a time | Plainly, 10 orderings | Sentence to a relation, then code |
| --- | --- | --- | --- | --- |
| LFM2.5 1.2B | 5 | 5 | 5 | 5 |
| LFM2.5 2.6B | 12 | 13 | 8 | 8 |
| Ministral 3 3B | 13 | 6 | 8 | 8 |
| Bonsai 2 9B | 16 | 15 | 9 | 6 |

No gain anywhere. The smallest model turns one sentence in four the wrong way round; the largest turned every sentence
rightly and lost only where the probe's own prompt for the place asked was misread. The question in numbered lines,
through the whole module on LFM2.5 1.2B: 37 of 60 against 40. Both are built as changes training can try, and are on
nowhere.

On all 23 tasks at 20 questions: 247 of 460 (53.7%) against 254 as configured (55.2%); 10 questions won and 17 lost,
1.5 points with a paired error of 1.1, so no difference that can be told. Four of the seven are the live web search,
which does not repeat from one day to the next. The harm is gone and no gain has come: a benchmark's requests are
unlike anything the adapters were taught, so they are answered without them.

What it says:

- **An adapter must be taught broadly.** Six questions of a kind asked four ways were memorised; an adapter taught one
  kind harmed the others.
- **In the slot's own voice.** Taught the larger model's short answers alone, a slot stopped working a question out.
- **For the class it helps.** On code the mixture is beyond error three times over; on plain text it costs points.
- **On what the module will be asked.** Training kept the JavaScript-taught mixture by itself (held +21.7 points, error
  7.8), and two Python benchmarks then read 18 of 40 against 21. Training's questions were not what it is judged on.
- **Its own held questions are not enough.** Thirty points on held questions of training's own making, ten points lost
  on two benchmarks: held questions from the same maker as the train questions cannot see an adapter that learned the
  maker.
- **Where answers are lost.** With adapters more questions had a right draft (100 to 106 of 160) and more of those were
  lost (16 to 23): each checker's answer counted as a drafter's, and three checkers with one drafter outvoted three
  drafters who were right.

## The first whole run: three figures, and each stage held to the one before, 2026-11-23

LFM2.5 1.2B in both places against Nemotron 3.5 Lightning 30B, 20 questions of each of 23 tasks (460).

| Right of 460 | Alone | As configured | Pretrained | Pretrained and trained | Larger model |
| --- | --- | --- | --- | --- | --- |
| All | 30.0% | 55.2% | 50.7% | 49.6% | 77.6% |
| Code (40) | 45.0 | 52.5 | 50.0 | 50.0 | 90.0 |
| Math (40) | 22.5 | 72.5 | 70.0 | 62.5 | 82.5 |
| Logic (100) | 4.0 | 45.0 | 43.0 | 42.0 | 88.0 |
| Reasoning (120) | 0.8 | 43.3 | 35.0 | 35.8 | 76.7 |
| Instructions (20) | 90.0 | 85.0 | 85.0 | 80.0 | 75.0 |
| Tools (100) | 88.0 | 86.0 | 81.0 | 80.0 | 81.0 |
| Search (40) | 0.0 | 10.0 | 5.0 | 5.0 | 30.0 |

Neither stage reached the module as configured. The falls are about one and a half times the sampling error, so not
conclusive alone, but six of seven bodies of work fell or stayed level. The first two figures were measured on the
code of 22 November and the third on the code of the 23rd, so they are not of one code.

What was found, and changed the same day:

- **Adapters were kept on perplexity alone.** Judged on 72 held questions, the module had 41 right without adapters
  and 40, 39 and 41 with the check, draft and write adapter alone. None is served now.
- **The arrangement was trained without the adapters and evaluated with them.** The run now trains on the module as
  pretrained.
- **The class stage kept one change** (plain-text questions: the settled answer goes out as it is, and a second
  checker; 11.4 points on its own held questions) and never tried an instrument or one slot. Both are now tried in
  every class.

**Taught where it failed.** Pretraining then also asked the larger model the request of each slot whose answer was
not right. Three runs, each judged on the same 72 held questions (the module without adapters read 41 or 42):

| The draft adapter, taught from | Examples | With it | Gain (paired error) |
| --- | --- | --- | --- |
| its own right answers only | 228 | 39 | -2.8 points (3.9) |
| those and 75 of the larger model's (160 asked, 100 steps) | 260 | 41 | 0.0 (4.8) |
| those and 215 of the larger model's (600 asked, 300 steps) | 383 | 43 | 1.4 (5.8) |
| those and 228, unmarked right answers counted too | 392 | 44 | 2.8 (4.8) |

The direction is the one wanted and none is beyond the error, so none is served. The check and write adapters moved
nothing. Seventy-two held questions cannot tell a gain of this size from chance.

Not measured: a whole run since these changes.

## The search program, the form a system text sets, one slot for a kind of request: 2026-11-23

The same swarm (LFM2.5 1.2B in both places against Nemotron 3.5 Lightning 30B), after the section below.

**Why a program.** The rules of the section below made every question searched and did not make it answered on the
live web. Two things were then asked of the real module. Asked, as a plain question, for the smaller question that has
to be answered first, it guessed an answer on eight chained questions of eight ("Singapore", "Tampa, Florida").
Given a text and one thing to find in it, it reads it. So code takes the question apart at what it hangs on, searches,
opens the page, and puts what was read back into the question; the answer procedure is asked only to read.

| | The rules before | The program |
| --- | --- | --- |
| The made search task, 30 questions, four seeds never run before | 28 and 30 of 30 on two | 30 of 30 on each of four |
| Minutes for those 30 | 2.6 | 0.4 |
| The live web search test, 40 questions | 3 | 2 (0 to 2 over four versions) |
| Of 20, the expected answer retrieved | 4 | 6 |
| Of 20, the last message in the form asked | 1 to 3 | 20 |
| Nemotron on those 40 | 8 | 8 |

- **On the live web the first facts are now found** ("the performer at the 2024 Super Bowl": Usher; then "the
  birthplace of Usher"), and the chain breaks at the second or third: a page cut to 2000 characters does not hold the
  fact, or the small model reads a neighbouring one. Reading a fact on the way from the list of results, to save
  steps, was tried and taken out: the list gave a year as a performer's name and every chain went on from there (0 of
  40).
- **The live test is no longer an untouched judge of these rules:** its questions were read several times while the
  program was written. The made task's seeds are.
- **The form.** The test asks for the last message as `{'answer': ..., 'context': ...}`. Code now writes what was
  settled into the form a system text sets: 20 of 20 on the live test and on the made task (11 of 20 there before,
  loosely).

**One slot for a kind of request**, Instructions, 100 questions:

| | Right, of 100 |
| --- | --- |
| The small model, asked plainly | 75 |
| The module | 68 |
| The module, a request that instructs its reply answered by one slot (`--plan pieceBy=plain`) | 71 |
| The module, every request answered by one slot (`--plan plain=true`) | 71 |
| Nemotron | 79 |

Both are arrangements the class stage can now try and keep. A reading was added for a request that instructs its own
reply: it knows 99 of these 100 requests, where the readings before it knew 59. No run has yet shown what training
keeps. The four questions between 71 and 75 are not looked into (the model by itself is asked with other sampling).

## A run stopped in training, a search carried by code, Instructions at 100: 2026-11-22 (night)

LFM2.5 1.2B in both places against Nemotron 3.5 Lightning 30B, on one Apple silicon Mac.

**The run's three figures** (460 questions, 20 a task): as configured 55.2%; pretrained, an adapter for each of the
three roles, 50.6% (Reasoning 43.3 to 35.0, Tools 86 to 81, Search 10 to 5: lower by more than the error of either,
about 2 points); pretrained and trained: not measured. The run was stopped in its fourth step. The class stage had
gone through three classes of input and kept nothing in them; it was in the fourth, plain questions, where the
instruments are tried.

**Instructions, 100 questions of IFEval:**

| | Right, of 100 |
| --- | --- |
| The small model, asked plainly | 75 |
| The same, its reply laid out | 73 |
| A module of one slot | 65 |
| The module | 66 |
| The module, with one reply written to the request as it came | 68 |
| Nemotron | 79 |

The small model by itself follows instructions better than the module built of it, by about nine questions in a
hundred. The plain reply, which competes only where a request's rules can be counted, won back two.

**Search.** Read from the stored answers of the web search test, the module made no search on 11 of 20 questions,
searched once on the other 9, opened no page, and never retrieved the expected answer. Asked of the real module: with
a call required, both drafters replied in words on two questions of three, so the engine does not enforce a required
call for this model. With the search carried by code (the first search, a page after each search, the next query from
what the page names, an answer only where a result holds it):

| | Before | After |
| --- | --- | --- |
| A search task made from a seed, 30 questions of two chained facts, seed 4242 | 1 | 28 |
| The same, seed 99 | not asked | 30 |
| Questions of it with no search at all | 20 of 30 | 0 |
| The web search test, 40 questions of three or four chained facts on the live web | 4 | 3 |
| Nemotron on those 40 | 8 | 8 |

- **The made task** (`python/search_made.py`) makes up countries, capitals, mayors and years, puts each fact on a page
  of a made-up web, ranks pages as an engine does and asks questions no model can know. The rules were adjusted while
  looking at its first seed (0 to 23 of 30 there); the two seeds above had not been run before.
- **The live web test did not improve.** Every question is now searched (2.5 searches and 2.5 pages a question, pages
  read as text), and the expected answer was retrieved on 4 of 20 where it had been on none; the reply was still wrong
  there. On the other questions the first search, of the whole question, returns pages beside the point, and the names
  taken from them lead further off. What to look up first, across three or four facts, is a judgement this small
  model does not make and this code does not either.
- **One thing got worse:** the test asks for the last message in a set form, and the module wrote it so on 1 to 3 of
  20 where it had on 12. Not looked into.

## What the code adds and what the arrangement adds, 2026-11-22 (evening)

The same swarm (LFM2.5 1.2B in both places, the arrangement every swarm starts from, no adapter, no instrument on),
asked again that evening as the first step of a run: 55.2% of 460 questions, the small model alone 30.0%, Nemotron 77.6%
(Code 52.5, Math 72.5, Logic 45.0, Reasoning 43.3, Instructions 85.0, Tools 86.0, Search 10.0; no reply unread). Then,
on the 320 questions of its 16 tasks that are not tools or search, four ways of asking the same small model, each 20 a
task:

| | Right, of 320 | Code | Math | Logic | Reasoning | Instructions |
| --- | --- | --- | --- | --- | --- | --- |
| The small model, asked plainly | 50 (15.6%) | 45.0 | 22.5 | 4.0 | 0.8 | 90.0 |
| The same, its reply laid out by the module's code | 61 (19.1%) | 45.0 | 22.5 | 8.0 | 6.7 | 90.0 |
| A module of one slot | 134 (41.9%) | 42.5 | 52.5 | 39.0 | 34.2 | 80.0 |
| The module, seven slots | 164 (51.2%) | 52.5 | 72.5 | 45.0 | 43.3 | 85.0 |
| Nemotron | 264 (82.5%) | 90.0 | 82.5 | 88.0 | 76.7 | 75.0 |

- **A module of one slot** is the starting arrangement with every slot but its first drafter taken out and a flow that
  drafts and stops (`node training/evaluate.mjs --one-slot`): one call a question, with all of the module's code round
  it (how a request is read, the answer the slot is told to state, the form a reply closes with) and nothing of the
  arrangement.
- **The code is worth about 26 points; the arrangement about 9 more.** From 15.6% to 41.9% is the code round one call;
  from 41.9% to 51.2% is six more slots, checking and choosing. Thirty questions of 320 separate the last two: more
  than the error of either figure (about 3 points), and small beside what the code adds. The arrangement is also what
  costs: one call a question against up to seven.
- **Where the arrangement helps:** Math (52.5 to 72.5) and Code (42.5 to 52.5). On Logic and Reasoning it adds 6 and 9
  points. On Instructions the model asked plainly is still ahead of both (90 against 80 and 85).
- **What this does not say:** anything about a trained arrangement. Both are the arrangement as a swarm starts.
  Twenty a task is a check, not a proof.

## The module as configured, on 23 tasks, 2026-11-22

LFM2.5 1.2B in both places, no decision model, Jeffan 4B judging, against Nemotron 3.5 Lightning 30B: the first 20 questions
of each of 23 standard tasks (16 of lm-evaluation-harness 0.4.13, 7 of `bfcl-eval` 2026.3.23), the arrangement every swarm
starts from, no adapters, no instrument on, on one Apple silicon Mac. Percent right:

| Body of work | The module | The small model alone | Nemotron |
| --- | --- | --- | --- |
| Code | 52.5 | 45.0 | 90.0 |
| Math | 70.0 | 22.5 | 82.5 |
| Logic | 48.0 | 4.0 | 88.0 |
| Reasoning | 40.8 | 0.8 | 76.7 |
| Instructions | 75.0 | 90.0 | 75.0 |
| Tools | 86.0 | 88.0 | 81.0 |
| Search | 5.0 | 0.0 | 30.0 |
| All 460 | 54.1 | 30.0 | 77.6 |

- **Twenty a task is a check, not a proof.** A verdict needs at least a hundred questions a task.
- **The small model alone, with the module's layout and nothing else** (Logic and Reasoning, 11 tasks, 220 questions,
  asked again that evening). Asked plainly it leaves an empty line where a task stops reading: 197 of its 220 replies
  went unread. Laid out by the module's own code (no empty line where the earlier replies have none, the question not
  said again), on its one reply:

  | | Right, of 220 | Unread |
  | --- | --- | --- |
  | The small model, asked plainly | 5 (2.3%) | 197 |
  | The small model, its reply laid out | 16 (7.3%) | 107 |
  | The module | 97 (44.1%) | 0 |
  | Nemotron | 180 (81.8%) | 0 |

  So layout is worth about five points, not the forty between the model and the module. Of the 107 still unread, many
  give an answer in words of their own ("So the sorted list is: syndrome therefrom", which is right, where the task
  reads only "So the answer is"). The module closes a reply in the task's own form because its drafters are told to
  state what they settled on; that step cannot be put on a model asked plainly, so how much of the remaining gap is the
  closing form and how much the arrangement is not told apart. A module of one slot would say. No reply of the module
  went unread. (The module's 97 is the same total as in the table above, which was asked earlier that day; three
  questions moved between Logic and Reasoning's counts of right answers: 45.0% and 43.3% this time.)
- **What moved it that day was form, not models.** On nine of these tasks the same swarm scored 38.9% in the morning, then
  48.3%, then 53.9%, as each task was probed for replies a harness could not read and those were mended (code beside
  words, a reply already begun, closing forms, lettered options). Instructions went from 15 to 17 of 20 once a request
  that sets countable rules was written whole and counted against them.
- **With every instrument turned on** (they are off as a module starts; training turns one on for a class where held
  questions gain): word sorting, Dyck languages, boolean expressions and multistep arithmetic 20 of 20 each, where the
  small model alone had 0. Whether training turns them on, and whether that carries to the benchmark, is not measured
  yet. How the instruments were probed for bias is under [Status and limits](status.md#status-and-limits).
- **Pretrained, and pretrained and trained:** not measured on this state of the module. An earlier run that day (180
  questions of Code, Math and Logic, before the mending above) read 38.9% as configured, 40.6% and 36.7% pretrained and
  40.0% trained, against 87.2%: nothing beyond an error of about 3 points.

## The tool tests, 2026-11-18

Bonsai 2 2B, LFM3 1.7B and Jan-Code 4B, decided by Kev 0.8B, against Nemotron 3.5 Lightning 30B: the first 20 questions of
each of five function-calling categories of the Berkeley Function-Calling Leaderboard (`bfcl-eval` 2026.3.23), the
arrangement with its 14 kept changes, without adapters, on one Apple silicon Mac. Right, of 20:

| Category                           | The swarm | Nemotron, tools in the request | Nemotron, tools written into the conversation |
| ---------------------------------- | --------- | ------------------------------ | --------------------------------------------- |
| One function                       | 13        | 14                             | 19                                            |
| One of several functions           | 17        | 15                             | 18                                            |
| Several calls at once              | 10        | 2                              | 16                                            |
| Several calls of several functions | 15        | 8                              | 18                                            |
| No function fits                   | 20        | 20                             | 10                                            |
| All 100                            | 75        | 59                             | 81                                            |

- **The first reading was wrong.** With the tools in the request alone, the swarm led its target 75 to 59. That was
  Nemotron's server, not Nemotron: it returns the first call only of those the model writes (four questions that need two
  or three calls, one call back each time; the same four with the functions written into a system message, every call
  written), and with tools in the request the model replied in words on 5 of the 20 questions that need one call.
- **So the larger model is asked two ways, and counted by the better over the capability:** the tools in the request, as
  the swarm is asked, and the tools written into the conversation with its calls read from its reply. Neither way is the
  better on every task, and no model as it is served answers one task one way and the next another, so it is one way for
  the whole capability. Counted so: **Nemotron 81, the swarm 75**, a gap of 0.06 with an error of 0.05: too few questions to
  say. The proof says which way the target was counted by, and its score by both.
- **Where the swarm loses:** on 19 of its 25 misses it worked the answer out in words where the question needed a call.
- **What it found in the swarm's replies:** 7 of its 39 replies in words ended with a paragraph about how the reply was made
  ("This answer was settled based on the provided draft which correctly calculated the area"). Such closing paragraphs are
  now cut, and the answer before them goes out as it was written. Asked again, none of the 39 did it.
- **Time:** about 5 seconds a question for the swarm where one call was needed, 10 where several were, 13 where none was;
  Nemotron 2 to 3.
- **Not asked that day:** the web search test, whose own search needs a paid key. Its searches now go to a SearXNG served on
  the machine for the run, which needs none (below).

## What an answer is graded against, 2026-11-18

The same swarm, on the record of its pass of The Crew's 84 train questions.

- **Code, against the question's own solution:** the swarm had 28 of 30 code questions right against Nemotron's function,
  and has 24 right against the question's correct solution. Nemotron has 23 right by the same grading.
- **Conversation, against the answers Nemotron agrees with itself on:** asked a second time, Nemotron gave an equivalent
  answer on 17 of 36 such questions. With three answers, 31 of the 36 train questions have a standard among them and 5 have
  none (28 and 8 of the 36 held ones). Against the standard the swarm is right on 11 of those 31, where the pass had graded
  it right on 6.
- **What kept a change:** of 17,765 changes tried one question at a time, 17 brought a question to parity with Nemotron's
  answer and lost none of the few asked again; each rested on that one question. A change is now kept when its class of
  questions got better. No pass has run under that rule yet.
- **The new kinds of question**, 10 of each, asked of the swarm alone: rules a program checks 8 right, calling a function
  8, a search tool 10, an agent's step 9. Its two misses in calling a function were the two questions that lacked an
  argument only the person knows: it called the function with a date it made up.

## The search behind the web search test, 2026-11-18

The web search test offers a model two functions, `search_engine_query` and `fetch_url_content`, and runs them itself. Its own
search asks a paid service. Its README says the search may be changed, and here it is: the searches go to a
[SearXNG](https://github.com/searxng/searxng) (free software, pinned by revision in
[`training/search.json`](../training/search.json)) that the evaluation serves on the machine for the length of the run, with no
key. Nothing else of the test changes: the functions offered, the questions, the checker.

- **Tried end to end with a stand-in model** (it searches for the question's own words and answers with the first title):
  the test's search reached the SearXNG served here, the results came back in the test's own shape, and Brave, DuckDuckGo
  and Google's custom search answered. Asked again, the same query was given the same results from the day's folder and
  not searched for again.
- **Which engines, and how fast** (measured 2026-11-21, six questions each, one every few seconds): Bing, Yahoo, Yandex and
  PrivacyWall answered every one, as DuckDuckGo and Brave did, so they are turned on too and a search is answered while
  any of them answers. Google refused, and so did Qwant; neither is relied on. Asked with no pause, the engines refused: in
  one evaluation 44 of 162 searches came back with nothing. So searches are sent at least three seconds apart, and one that
  comes back with nothing is tried again after 5, 15 and 30 seconds (`pace` and `waits` in
  [`training/search.json`](../training/search.json)). No engine here needs a key or an account.
- **What is said when it still fails:** each side's searches are counted, and where one in four or more came back with
  nothing the task is marked "searches failed" on the page, because its score then says more about the day's search than
  about the model.
- **What is kept:** what each query returned and each page fetched, for the day. The larger model and the swarm are asked on
  the same day, so the same query gives both the same findings, whichever asked first.
- **What it cannot promise:** the public engines throttle. In three test queries DuckDuckGo answered one with a CAPTCHA; the
  others answered. A query nothing answers is asked again twice, and then that is its answer, for both models alike.
- **Not comparable with the published leaderboard**, whose search is another service: only the module beside its target.
- **Asked of the two models on 2026-11-22** (above: 1 and 6 right of 20). The proof run below began before this was wired, and was stopped before it ended.
  To ask the web search test by itself: tick Search alone under Asks, and Evaluate.

## The proof run of 2026-11-18, stopped partway

Every body of work that has a standard test, each task at the size a verdict needs: The Crew (IFEval, all 541), Code
(HumanEval, all 164, and 336 of MBPP), Math (300 of GSM8K, 200 of BBH multistep arithmetic), Logic (five BBH tasks, 100 each),
Reasoning (six BBH tasks, 100 each) and Tools (five function-calling categories, 100 each): 21 tasks and about 3,100
questions for each of the two models, most of a day on one machine. (Search was not in this run: its search was wired after
it began.) It was started from the dashboard at 20:25 UTC on 2026-11-18, on the arrangement as it stood before any pass
under the new rules, and stopped by hand at 21:51.

- **How far it got:** the larger model had been asked 7 of the 21 tasks, 1,741 questions (IFEval, HumanEval, MBPP, GSM8K,
  BBH multistep arithmetic, BBH logical deduction, BBH date understanding), at about 3 seconds a question, and was 29
  questions into the eighth. The swarm had not been asked: it is asked after the larger model.
- **What came of it:** no verdict, and no result. A run that is stopped writes none.
- **What is kept:** the larger model's answers to those seven tasks, by task and size. A proof run started again asks it
  only the fourteen it had not finished, then the swarm all of them.

## Evaluate the swarm, 2026-11-17

LFM2.5 1.2B, Qwen3.5 2B and Ministral 3 3B, decided by Jeffan 4B, against Nemotron 3.5 Lightning 30B, before any training of
this configuration and without adapters, on the first 20 questions of IFEval (lm-evaluation-harness 0.4.13), on one Apple
silicon Mac: 6 min 46 s in all.

- **The same result as Nemotron on 11 of 20** (9 both right, 2 both wrong); of the 9 that differ, Nemotron alone was right
  on 6 and the swarm alone on 1. **Scores:** Nemotron 75%, the swarm 50% (strict prompt accuracy).
- **What the differences show:** the swarm's reply often says what the answer is instead of giving it ("The answer is a
  tailored resume template that includes 12 placeholders", where Nemotron wrote the template), so the instructions it was
  given about the answer's form are not kept.
- **What was done about it:** what is settled is a short statement of the answer, and the writer was handed it as "the
  answer settled on". It is now shown as a statement, not the reply, beside the draft it came from, and its brief says a
  piece of writing is written in full and never described. And a reply that still describes the answer (it echoes its
  prompt, speaks of the request or the draft, or says what the answer is where a piece was wanted; read off the words, no
  model) is not sent: the largest small model that did not write it writes it, and if that one describes it too, the draft
  goes out. Training reads such a reply as the answer lost in writing, and tries changing the writer first. Measured on the
  writer alone, from the same drafts, on 40 IFEval questions: 22 kept every instruction with the old wording, 25 with the
  new, 27 with the reply checked and rewritten (7 rewritten by Ministral 3 3B). The check flags none of the larger model's
  1,544 replies on record.
- **Evaluated again after the fix** (the same 20 questions, without adapters, training having kept nothing in between): the
  swarm's score rose from 50% to **65%** (Nemotron 75% both times). The same result as Nemotron on 11 of 20 again, but
  differently made: 10 both right and 1 both wrong (9 and 2 before), Nemotron alone right on 5 (6) and the swarm alone on 3
  (1). Replies that still read as describing the answer fell from 17 of 20 to 3; those three used phrasings the check did
  not yet know ("the answer is settled with", "the draft included", "the response is clear"), and it now does.

## Evaluate the swarm on 100 questions, 2026-11-17

The same swarm after the writer's fix, without adapters and before any training, on the first 100 questions of IFEval: 34
min in all.

- **The same result as Nemotron on 61 of 100** (54 both right, 7 both wrong); of the 39 that differ, Nemotron alone was
  right on 25 and the swarm alone on 6. **Scores:** Nemotron 79%, the swarm 60% (each about ±4 to 5 points). This is the
  figure training and the adapters are measured against.
- **With the adapters on** (the same 100 questions, each small model served with the adapter Pretrain trained for it): the
  same result as Nemotron on **48 of 100** (40 both right, 8 both wrong; Nemotron alone right on 39, the swarm alone on 6),
  and a score of **46%**. The adapters made the swarm less equivalent and less often right, well beyond the error of either
  figure, so training goes on without them. They had made Nemotron's answers to The Crew's train questions likelier
  (below); taught on 72 answers of one body of work, they did not carry over to following instructions in general.

## Every small model alone, 2026-11-17

Each small model in the catalog, by itself, on the same 84 held questions of The Crew, its answers compared with Nemotron
3.5 Lightning 30B's by Jeffan 4B: what the [recommended changes](dashboard.md#recommended-changes) weigh a model by. Twelve were fetched for
this and taken out again afterwards (`node training/setup.mjs --model <id>`, `node training/baseline.mjs --who model:<id>
--split held`).

| Small model        | The same as Nemotron |     | Small model        | The same as Nemotron  |
| ------------------ | -------------------- | --- | ------------------ | --------------------- |
| Bonsai 2 27B       | 62 of 84 (73.8%)     |     | Gemma 4 E4B        | 33 (39.3%)            |
| Bonsai 2 9B        | 61 (72.6%)           |     | Gemma 4 E2B        | 33 (39.3%)            |
| Qwen3.5 4B         | 54 (64.3%)           |     | Qwen3 1.7B         | 28 (33.3%)            |
| Jan-Code 4B        | 46 (54.8%)           |     | Ministral 3 3B     | 27 (32.1%)            |
| LFM3 1.7B          | 44 (52.4%)           |     | LFM2.5 1.2B        | 22 (26.6%, mean of 3) |
| Nemotron 3 Nano 4B | 42 (50.0%)           |     | Qwen3.5 2B         | 22 (25.6%, mean of 2) |
| Granite 4.2 3B     | 41 (48.8%)           |     | Qwen2.5-Coder 1.5B | 20 (23.8%)            |
| Bonsai 2 4B        | 37 (44.0%)           |     | SmolLM2 1.7B       | 13 (15.5%)            |
| Bonsai 2 2B        | 34 (40.5%)           |     |                    |                       |

- **One model's runs differ by up to 14 of 84** (LFM2.5 1.2B: 16, 21 and 30 on the same questions), so a lead of less than
  that says nothing, and the recommendations ask for more.
- **Qwen3 4B is left out:** it gave no answer on 30 of the 84, which says it was served wrongly here (it is a model that
  thinks first), not how it answers.
- **The two models made for code do not lead:** Jan-Code 4B (46) is below Qwen3.5 4B, the general model of its size, and
  Qwen2.5-Coder 1.5B (20) near the bottom. The Crew's questions are code and the conversation around it, and tools.
- **The three in the swarm trained so far are among the weakest alone.** Bonsai 2 9B and 27B give Nemotron's answer about
  three times as often as LFM2.5 1.2B or Qwen3.5 2B. Alone is not in a swarm: a pass is what would tell.

## Question 6: one missing idea, 2026-11-17

The swarm of LFM2.5 1.2B, Qwen3.5 2B and Ministral 3 3B stopped at question 6 for 84 tries: write `rotate(list)`, moving
the items 4 places to the left, which must work for arrays shorter than 5. Asked once and graded input by input, every
drafter missed the same idea, the shift taken modulo the length: the nearest wrote `[...list.slice(4), ...list.slice(0, 4)]`,
right on 13 of 15 inputs and wrong only on 3-item arrays; several read "must work for shorter arrays" as "return them
unchanged". Rearranging cannot reach parity while no draft is right, so the loop now:

- sets a question aside after 30 tries in a row that bring it no closer, while others wait, and writes its search down after
  every try so a stopped run carries on from there;
- counts how near all the drafts came, not only the nearest, so the search has something to climb;
- has the larger model teach the drafters nearest the answer first (its briefs had all gone to the 1.2B model), and refuses
  a brief that gives the question away. One did: "Let k = 4 % length. Return the list sliced from k to end, then from start
  to k" brought question 6 to parity three times and broke `sumEvery` each time, since it told a drafter to rotate on every
  question.

Question 6 has not yet reached parity through a brief that teaches the method rather than the answer.

## Training question by question, 2026-11-16 to 17

LFM2.5 1.2B, Qwen3.5 2B and Bonsai 2 4B, decided by Jeffan 4B, against Nemotron 3.5 Lightning 30B, on The Crew's train
questions (84 a pass), on one Apple silicon Mac. Its records stay on that machine; no spec of it is published yet.

- **11 wins over four runs** (Clear training state began three of them again): each a change that brought a train question
  to parity and lost none of the questions already at parity. All are in the cumulative spec, and their 10 distinct
  arrangements are tried first on every question.
- **The longest run:** 19 of 84 questions overnight, 11 at parity as the swarm stood and 5 brought there by a change, in 612
  changes. One question took 560 of them: it reached parity about 300 times, each time losing a question already at parity.
  Such a standing conflict is now swapped, a change that loses only the other kind of question (code, or words) is kept
  for its own kind, and a question that stops coming closer is set aside until the others are done.
- **The run after it, with the found arrangements tried first:** one of them brought a second question to parity; it stopped
  at 12 of 84 (14.2% of the pass's questions).
- **Memory: 51.1% saved, about 9.2 GB less** than Nemotron (8.8 GB against 18 GB, 2.0× smaller): an estimate from the model
  files and the listed sizes, not a measurement.

## When the larger model is wrong, 2026-11-17

The swarm of Bonsai 2 2B, LFM3 1.7B and Jan-Code 4B, decided by Kev 0.8B, reached 22 of 84 train questions (17 at parity as
it stood) and then spent 56 tries on `toSeconds("2d30h")` without reaching parity. Nemotron's own answer there was wrong: it
read a time only when all three parts were present, so it gave 0 for "5m", "2d" and "10h". Each code question is made with
its correct solution, and against those Nemotron was wrong on 7 of the pass's 30 code questions; 3 of the run's 5 kept changes
had been won on them, teaching the swarm Nemotron's mistakes. Such a question is now set aside: answered once, never searched,
and never one a change must not lose.

## The earlier training, 2026-11-15 to 16

LFM2.5 2.6B and Bonsai 2 2B, decided by Kev 4B, against Nemotron 3.5 Lightning 30B, on 42 held
programming questions (six of each of seven kinds), on one Apple silicon Mac, 2026-11-15 to 2026-11-16, under the earlier
training (a change tried on the whole train set). Its records stay on that machine; none is at parity, so no spec of it is
published. From now on a measured number is published with its spec, in [`specs/`](../specs).

| Pass | Held answers equivalent | Toward parity | Kept in the pass                                               |
| ---- | ----------------------- | ------------- | -------------------------------------------------------------- |
| 1    | 22 of 42                | 52.3%         | nothing                                                        |
| 2    | 22 of 42                | 52.3%         | a second plain drafter, on Bonsai 2                            |
| 3    | 25 of 42                | 59.5%         | a drafter made a checker, and a checker shown only the answers |
| 4    | 25 of 42                | 59.5%         | nothing                                                        |
| 5    | 25 of 42                | 59.5%         | nothing                                                        |

- **Memory: 52.2% saved, about 9.4 GB less** than Nemotron: about 8.6 GB for the swarm against about 18 GB (2.1× smaller). An estimate from what
  is on record, not a measurement: the two small models' files with their contexts (3.6 GB) and Kev 4B's listed size (5 GB),
  against Nemotron's listed size. This is what the Swarm is for: the larger model's answers in a fraction of its memory.
- **Each small model alone, on the same questions:** LFM2.5 2.6B 38% (16 of 42), Bonsai 2 2B 30.9% (13 of 42). The swarm of
  the two is ahead of either.
- **Put a second way** (the same questions, worded otherwise): 27 of 42, every pass.
- **By kind, at pass 5:** writing a function on arrays, on strings, and saying what a program prints 83.3% each; correcting a
  function 66.6%; writing one on numbers and saying what is wrong 50% each; writing one that parses text 0%.
- **About 20 seconds a reply.**
- **Where it is stuck.** On the train questions of pass 6, no slot drafted the larger model's answer on 19 of 70, so the best
  any way of choosing could reach was 72.8%. That is why a pass can now change what is drafted (new briefs written by the
  larger model, worked examples) and not only how drafts are chosen: [training/TRAIN.md](../training/TRAIN.md) says what was added.
