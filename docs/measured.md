# Measured, not claimed

Every measurement, dated, newest first. Each is of the swarm named in it; the lineup has changed over time.

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
- **The small model's figures on Logic and Reasoning are mostly form:** 217 of its 240 replies there were ones the harness
  could not read (it leaves an empty line and the task stops reading). No reply of the module went unread.
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
