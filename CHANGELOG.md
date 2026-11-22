# Changelog

What changed, for a person deciding whether to update. Newest first. Versions follow [Semantic Versioning](https://semver.org).

## 0.1.0 (not yet released)

The first version.

- **A reply the request sets rules on is written whole** (2026-11-22). Asked for a resume with twelve placeholders the
  module gave 43 words and six; asked for 400 words it gave 297. Such a request went the way a question goes: a line of
  answer from each drafter, a vote, and a reply written from the line. Where a request sets a rule that can be counted
  (so many words or sentences, no comma, every letter a capital, labelled parts, placeholders, bullets), the first
  drafters now each write the whole reply, each is counted against the rules, the one that keeps the most goes out,
  and a rule it breaks is told to its writer once (`src/piece.mjs`, `plan.piece`). On a standard test of following
  instructions: 15 of 20 before, 17 after; the small model alone 18.
- **An answer of marks is said with the spaces the examples show** (2026-11-22). `]]` where the examples close `] ] >`.
- **A small model's unread replies are counted too** (2026-11-22). Asked by itself on tasks of worked examples a small
  model gave 217 of 240 replies the harness read no answer in, and scored 4% and under 1% where the module scored 48%
  and 41%. That difference is mostly of form. An evaluation now counts those replies and the table marks the task.
- **A drafter whose answer is none of the options is asked for the option** (2026-11-22). Where every drafter worked
  out something that was not listed, no answer was an option and the reply named none. Each such drafter is asked
  once which option is closest to its work (`plan.optionAgain`).
- **Where a question lists options, the options are the answers** (2026-11-22). Drafts worked out a date that was not
  among the options, and it went out with no letter to it, though a draft and a checker had named an option. An
  answer that is none of the options is now not counted beside one that is, and an option's letter and its words are
  one answer (`plan.options`).
- **A drafter that answered a request for code in words is asked for the code** (2026-11-22). On a real request three
  of four drafters of a small model ended with a sentence about the function. One draft of code is nothing to
  compare, so nothing was run. Each such drafter is now asked once for the code itself (`plan.codeAgain`).
- **A step with tools is asked for the reply that still fits** (2026-11-22). The larger model lost two of three
  web-search conversations to its server's refusal: 4096 reply tokens were asked for whatever its context had left.
  It is asked once more for what fits, as a plain question already was. A model asked by itself is also told several
  calls may be made.
- **Several calls at once** (2026-11-22). A turn that needs two calls got one: the engine returns one call a reply
  unless the request says several may be made, and the swarm never said so. It now does, unless the caller says not
  (`parallel_tool_calls: false`). The small model alone, asked the same way, gave both calls where it had given one.
- **Replies a harness could not read** (2026-11-22). A probe of every evaluation task counts the replies its harness
  read no answer out of, beside the larger model's. Three faults of form were found and mended: a start that only
  opens a block of code has the code put in it and the block closed; examples that close with a mark and a number
  (`#### 18`) are a form, and what was settled is said as its number; and a reply that ends "The answer is (A)."
  where the examples close "So the answer is (B)." has its own answer said in the examples' words.
- **A reply already begun is continued** (2026-11-22). A conversation that ends with the assistant's own turn gives
  the start of the reply. The swarm took that start for the question: a benchmark that gives a function's head and
  reads what follows as its body got words about the function (1 of 20, the small model alone 11). The conversation
  before the start is now answered, and the reply follows the start: for a Python function, its body. A request to
  "write a solution" to a problem given as code now counts as asking for code.
- **Drafts are run in the language they are written in** (2026-11-22). Where code is asked for, the drafts are run on
  the same calls and those that do the same are one answer; that was done for JavaScript alone. It is now done for
  TypeScript, Python, Go, Swift, Dart, Flutter and Kotlin as well (`src/langs.mjs`). Each language but TypeScript runs
  under the system's own sandbox: no network, no write outside the run's folder, no reading of the person's folders.
  A Flutter widget is built where no screen is needed and is known by what it shows. Nothing is installed: a language
  whose tools are not on the machine, or a system with no such sandbox, has its drafts compared as text as before.
- **A Python function is code** (2026-11-22). An answer was taken for code by the marks of JavaScript alone, so a
  function in Python was taken for words: a draft that wrote a sentence about the function stood beside the drafts
  that wrote it, and the settled function was written out again as a sentence. Two small models answered 0 of 40
  code questions that way. Python now has its marks, code goes out fenced in its own language, and where code is
  asked for and one answer is code, the answers in words are not counted beside it.
- **The drafters' adapter is trained, and the class stage ends at its time** (2026-11-22). The first whole run on the
  real models showed two faults. The drafters' examples carried a tool call's arguments as text, which the model's
  chat template refuses, so the role with the most examples had no adapter; the arguments are now given as the
  thing they are. And the time given to the class stage ended only the session, which waited for the stage to end by
  itself (37 minutes for 20); its time now ends the stage as well.
- **Pretraining that knows the arrangement: an adapter for each role** (2026-11-22). Pretrain taught a small model the
  larger model's answers to plain questions, which is none of the jobs the swarm gives it. `training/roles.mjs` puts the
  train questions to the swarm once, keeps what every slot is asked, marks each slot's answer, and trains one adapter
  for each role (draft, check, write) from the requests that came out right. The swarm is served with all of them on one
  load, each request naming its role's; measured on llama.cpp build 12110, where requests with different adapters do not
  share a batch. The whole run pretrains this way.
- **Only the Run card starts and stops** (2026-11-22). The Evaluate, Pretrain and Train cards are drawn without their own
  buttons; `--card-starts` on the page draws them again.
- **One run, one button** (2026-11-22). Run, the first card, starts the whole of it (`training/run.sh`): the module as
  configured is evaluated, it is pretrained and evaluated, its arrangement is trained (the class stage, two hours at
  most, where asked) and it is evaluated a third time, each on the same questions. Stop is safe at any step and Start
  carries on. A step that cannot be taken (a model that cannot be pretrained here) is said and the run goes on. The
  cards under it show each step as it runs; their own buttons are still there.
- **Three evaluations side by side** (2026-11-22). An evaluation can be asked for as one of three things
  (`training/evaluate.sh --variant base|pretrained|trained`): the module as configured, the same with the adapters
  Pretrain trained, and what training kept with those adapters. Each comes to one score with its error, and the Evaluate
  card sets the three beside each other; a gain or a loss is said only beyond twice the error. Answers given with an
  adapter are now kept by that adapter's bytes, so a swarm pretrained again is asked again.
- **A kind of question has fallen only where it fell by more than twice its error** (2026-11-22). A change was refused
  where any kind fell by more than 0.05 and more than its own error. One answer on one draw is that much in a kind of
  six, and a class has twenty kinds, so most changes showed one. A kind's fall is now held to the bar a gain is.
- **Training keeps a change that gains more than it loses, and does not ask the same question of a class twice**
  (2026-11-22). In one pass 24 of 29 questions short of parity had a change that brought them there, 97 changes reached
  their class, and none was kept: 78 were refused for one question lost on both draws, among them one that made six
  good, lost two, and gained 5.2 points over 141 questions; it was found again and refused 37 times. Three things
  changed. A change is refused for what it loses only where it does not make good at least twice as many questions
  (in the question loop, beside the one it was found on). A change refused for its class is remembered while the
  arrangement stands, and is not asked of the class again. And the bar of twice the error can be cleared by the held
  questions together with the train questions the change was not found on, where thirty held questions alone could
  only show a gain of five points or more; the held questions must still have gained by themselves.
- **The Memory saved card draws the contexts when the size is measured** (2026-11-22). A measured swarm was drawn as
  one part for each place, a place that shared a load at 0 GB, and the contexts were inside the model's part. It is
  now drawn as an estimated one is: each model once at the size of its file, in so many places, and what its process
  holds besides as their contexts. The total is the same.
- **The memory a swarm is measured to take counts its models' weights** (2026-11-22). On a Mac the measurement read
  what each model's process had written and held on the GPU, which leaves out a model file mapped into the process:
  the weights. A swarm of one 1.1 GB model read 1 GB where it held 2, and 18 times smaller than the larger model
  where it was 9. The mapped files a process holds in memory are now counted.
- **A swarm with no decision model has its answers in words compared** (2026-11-22). The check of the reader of answers
  in words gave up where there was no decision model, before it looked at the judge named apart from it, so a pass
  compared none of those answers and stopped at its first question. The judge is now the reader where there is no
  decision model, and the check is made at every start of a pass, also one carried on after it stopped.
- **The chart rings the larger model too** (2026-11-21). The larger model configured now has a ring round its point, in its
  own colour, and is marked in the list under the chart, as the lineup configured now is.
- **Less standing text on the Train and Pretrain cards** (2026-11-21). The Train card no longer says "question by question,
  until stopped" beside how long a session has run, nor a sentence about question 1 before a pass has begun; and the
  Pretrain card says what it does in two sentences.
- **The stage that trains each class as a class no longer stops at its held questions** (2026-11-21). It stopped with an
  error the first time a change did well enough to be asked the held questions on a second draw, and the session began
  the stage again. And while that stage runs, the page says which class and question it is on, where it said the models
  were loading. The question-by-question track says it is waiting, and what runs before it, where it read "0 of 0
  finished"; and the stage's own line names the class as the page does ("Class 2 of 4, a conversation: trying ...").
- **The Train card says how far the pass has come** (2026-11-21). A bar and a share under the card's head: what part of the
  pass in hand is done, and the step it is in while a session runs. Each step that ended counts for its part; the stage
  that trains each class as a class counts by the classes done and the changes tried, the questions by how many are
  finished. The table of each class trained as a class is taken off the card.
- **A model that fills several places is loaded once** (2026-11-21). A swarm of one model loaded its weights once for each
  place it filled. The places now share one load, started with the slots of all of them. Measured with LFM3 1.7B in two
  places on 24 benchmark prompts: 2.1 GB of memory in place of 3.3, 13 answers right of 18 where two loads had 14, and 7.9
  seconds a question where two loads took 6.8. A third less memory for a sixth more time. The memory the page estimates
  and measures counts the shared model once. `SWARM_SHARE_LOADS=0` loads each place apart.
- **The page draws the shape that is run** (2026-11-21). The picture of training has the class stage as a lane of its own,
  first in a pass: as it stands, the sweep, the best two together, the held questions on two draws, the one rule that
  keeps. Inside one try it says how many slots draft first and that the answer most slots hold stands. The faces show a
  model that fills every role once, with all its slots; say plainly where there is no decision model and what settles an
  answer then; and mark the drafts that are asked only where the first two differ.
- **Configuration asks first whether the swarm is one model or several** (2026-11-21). One model, the default, is a single
  pill: the small model that fills every role of the module. Several models, a pill for each place, is marked experimental
  and says what was measured of it: on this project's own questions a mix of two small models scored 173 of 216 where the
  better of the two in every role scored 192.
- **An evaluation says which arrangement it measured, and can measure the one a swarm started from** (2026-11-21). A result
  is of the default arrangement or of the one training kept. Once training has kept something, the Evaluate card can ask
  for the arrangement the swarm started from, and the three views of the results then show the lineup twice, trained and
  default, so that what training bought is read off the same questions.
- **Training keeps a change by one rule, and finds what is cheap to find first** (2026-11-21). The two stages of training
  each had their own rule and disagreed about the same change, and each judged on one draw, which cannot: the same change
  measured 1.9 points on one draw and 11.1 on another. Now a change to a class is kept where its held questions, each asked
  on two draws with it and without, gain by more than twice their error, lose no question on both draws, and drop no kind.
  A change is no longer kept for one train question made good. The stage that trains each class as a class now tries every
  change that leaves the drafts as they are, which costs little because the drafts are reused, then the best two together;
  it asks every question of the class; and it runs first in a pass, before the larger model is asked anything, so a
  session stopped early has still trained.
- **A swarm answers faster, and an evaluation says how fast** (2026-11-21). A swarm of LFM3 1.7B took 27 seconds a question
  where its model took 8 and the larger model under 4. Four things change, all in the default arrangement a swarm starts
  from. Two drafts are asked first, one of each small model, and the other two only where those differ. Where the drafts
  differ, the answer most of them hold stands; a model is no longer asked to decide, and a decision model, where there is
  one, is asked only to break a tie. A draft has 450 tokens and a check 250, where each had 700. And an evaluation keeps
  the seconds a question each side took, and says them over its results. Kept swarm answers are asked again under the new
  arrangement; the larger model's are not. Not yet measured at an evaluation's size: whether these cost answers.
- **Serving the swarm with its adapters is a setting of Configuration** (2026-11-21). The box stood under the Pretrain
  card, though it bears on training and an evaluation alike. It is now a row of Configuration, and says so when no adapter
  has been kept yet.
- **The Train card is tidier** (2026-11-21). Its head holds the two actions, Train and Questions, as the other cards hold
  theirs. Which classes a session trains is a row of boxes under the head, across the card, with Clear training state small
  at its end. Why Train waits is said once, in one quiet line, and the Pretrain card says why it waits in the same place
  and the same way.
- **The web search test is refused less, and says when it was** (2026-11-21). In one evaluation the public search engines
  refused 44 of 162 searches, and the score fell for that reason alone. Measured one at a time, every engine that had
  refused answered when asked every few seconds, so searches are now sent at least three seconds apart, and one that comes
  back with nothing is tried again after 5, 15 and 30 seconds. Bing, Yahoo, Yandex and PrivacyWall answered every question
  put to them and are turned on beside DuckDuckGo and Brave; none needs a key. Each side's searches are counted, and a task
  where one in four or more came back with nothing is marked "searches failed" in the results.
- **The chart shows every lineup at once, and the tables can show any lineup's** (2026-11-21). The chart plots each lineup
  evaluated against the larger model, the larger model, and each small model of the configured lineup by itself. Every
  point is a number, and a list under the chart says which is which: its score, its memory and how many questions it rests
  on. The lineup configured now is ringed and marked in the list, and is listed even before it has been evaluated. A point
  asked other questions than the fullest evaluation is drawn hollow, since its score is not the same measure. The two
  tables show one lineup's evaluation at a time, chosen in a box; where the lineup configured now has none, its card still
  has the three buttons.
- **A model is named the same whatever serves it** (2026-11-21). The two models TensorFold serves are "Qwen3.5 2B" and
  "LFM3 1.7B", as the ones llama.cpp serves are, and what serves each is said after its size, as for every other model.
  They were "… MLX", which read as adapted with MLX: that is what Pretrain does, and these are not adapted. Their ids are
  unchanged, so kept answers and records stand.
- **An evaluation also asks each small model of the swarm by itself** (2026-11-21), on the same tasks, so that what the
  orchestration adds can be seen. A model's answers are kept by the model and its engine's version, so each is asked once,
  whichever swarm it is later part of. The chart shows a point for each at its own memory beside the swarm and the larger
  model, and says the swarm's score beside the best of them; the paper table has a column for each. `--no-alone` leaves
  it out.
- **The questions training asks can be read and audited** (2026-11-20). A Questions button on the Train card opens every train
  and held question as it is put, with the conversation before it, its kind, its class of input and what it is marked by,
  narrowed by class, kind and words to find. Above them it says whether any is a benchmark's: each question, and each
  worked example it shows, is set beside every benchmark question kept on the machine. `node training/questions-list.mjs`
  writes the same list out.
- **A training session can be limited to chosen classes of input** (2026-11-20). The Train card has a box for each class
  (with tools, a conversation, asking for code, a plain question), every one ticked to begin with and kept on the device.
  Train sends the ticked ones; the session then trains only those, as a class and question by question
  (`TRAIN_CLASSES=words,code bash training/session.sh` does the same). An arrangement is kept class by class, so a class
  left out stays as it is. The larger model's answers and the held measurement still cover every class.
- **An evaluation's results open three ways** (2026-11-20), from buttons under the Evaluate card's headline, which is no
  longer pressed itself. Each task: every body of work and task, score beside score, as before. Paper table: each
  benchmark by name, both models with their standard errors, the higher in bold, a line over every question, and a button
  that copies the table as LaTeX. Chart: the swarm and the larger model as two points, what each scored against the memory
  it holds. The chart's scores are of one thing at a time, chosen above it: every question (this project's own mix),
  or one benchmark by the name it is known by outside (HumanEval, MBPP, GSM8K, BBH, IFEval, BFCL), a benchmark of several
  tasks as the mean of its tasks. The paper table has those means too. A result of fewer than 100 questions of a task
  that is not the whole task says it is a quick look, not one to cite.
- **Every swarm starts with replies closed as the conversation's examples close** (2026-11-20). Where a conversation shows,
  in two or more earlier replies, how a reply ends ("So the answer is (B)."), the swarm's reply ends that way and has no
  empty line where they have none. It was a setting only training turned on, so an untrained swarm lost marks on
  benchmarks that read an answer only in that form. Measured on 34 held questions with such a form: 14 right without it,
  24 with it, none lost. Training can turn it off for a class where that does better. The next Evaluate asks the swarm
  everything again, since its arrangement changed.
- **A reply that already ends in the shown form keeps its own answer** (2026-11-20). The closing step replaced such a
  reply's last sentence with what the swarm had separately settled on, which was sometimes wrong where the reply was
  right: 3 of 34 held questions, and four replies to a test of boolean expressions made to end "So the answer is and."
  It now leaves such a reply as written (SwOA specification O.8.7, step 6).
- **The Pretrain card says why a model TensorFold serves is not pretrained** (2026-11-20): TensorFold loads no adapter. It
  names the same model's llama.cpp build, which can be adapted. It read "No original weights are named for it".
- **"Check again what fell short" takes in the tasks where no answer was found** (2026-11-20). A body of work is asked again
  where the swarm scored under the larger model, or where no answer was found in a quarter or more of the swarm's replies
  to one of its tasks, whatever its score.
- **A task's "unread" mark says in how many replies no answer was found** (2026-11-20): "no answer in 10 of 20". The
  benchmark looked for an answer in those replies and found none; each is marked wrong, and the score beside the mark is
  still of every question. The table, its note and the recommendation say it so.
- **Train and Pretrain wait for one evaluated body of work, not every one** (2026-11-20). A configuration evaluated with one
  harness can be trained against what was evaluated, to see those figures move. Beside Train the page says which bodies of
  work have no figure from before, the harness that measures them and where it is ticked. Before, they waited until every
  body of work had been evaluated, and said only "evaluate first".
- **The page recommends training before an evaluation is relied on** (2026-11-20). Where training has kept nothing for the
  configured swarm, the recommendations say an evaluation now may understate it. Where its last
  evaluation marked tasks "no answer found" on the swarm's side, they name each task and how many replies the benchmark could not
  read, and say to train and evaluate again. On the Evaluate card it is a button that opens the recommendation, and the
  recommendation has a Train button, which presses the page's own Train and says why where that cannot start. Measured on 40 questions of four such tasks: 7 right as an untrained swarm
  wrote them, 30 with replies ended as the examples show.
- **The swarm's kept answers are named by every engine that serves it** (2026-11-20). They were named by llama.cpp's build
  whatever served the members, so with members on TensorFold an update of TensorFold would not have had the swarm asked
  again. A swarm on both engines is named by both. Answers already kept under llama.cpp's name by a swarm on TensorFold are
  used as they are where they were written after its program was put here.
- **The score table's "Share" column is headed "Swarm → target"** (2026-11-20): the swarm's score as a share of the larger
  model's. "Share before" is "Before".
- **The score table's header breaks its lines alike** (2026-11-20), whichever harnesses are shown: its columns are of set
  widths, where they took their widths from the rows shown.
- **An evaluation no longer stops at the comparison** (2026-11-20). Since the search test was asked alike of both, an
  evaluation of lm-evaluation-harness tasks asked every question and then stopped on an error while comparing the answers,
  so no result was written. The answers it kept are compared the next time it is run, with nothing asked again. A run that
  stops on an error now says the error on the page, where it said only "Node.js" and its version.
- **A folded section of a running evaluation shows one bar** (2026-11-20). Each body of work, and the section that holds
  them all, shows while folded how far the run is through its tasks, in questions both models have answered. It is amber
  while one of its tasks is being asked.
- **A running evaluation's tasks show their bars** (2026-11-20). Where the card was drawn in a run's first seconds, before it
  had said which tasks it asks, every task read "not evaluated yet" for as long as the run went on, the one being asked
  among them. The page now draws the card again once the run names its tasks.
- **The Uninstall Helper lists the whole of the work folder** (2026-11-20). A model that is a folder of files is listed by its
  name; a folder the list does not know by name (a trial's downloads) has a line of its own and can be removed; the small
  files beside the folders are one line; and what is left inside the folders it names (what training learned, the last
  results, the pass in hand) is said with its size and not removed from there. No file in `.work` is under no line.
- **A small model can be served by TensorFold** (2026-11-20, SwOA spec S2.8). The catalog has LFM3 1.7B and Qwen3.5 2B twice
  each: the GGUF that llama.cpp serves, and the MLX 4-bit build ("LFM3 1.7B MLX", "Qwen3.5 2B MLX") served by TensorFold
  on an Apple silicon Mac. Each is an entry of its own, chosen like any other, because another quantisation is another member with its own record. It can be
  chosen on an Apple silicon Mac: where TensorFold is not there yet, making the models ready installs it with its maker's
  installer, as llama.cpp is fetched where it is missing (the newest release: it cannot be pinned as llama.cpp's build is). The swarm asks it exactly as it asks a llama.cpp member (`src/members.mjs` `serveArgs`,
  `engineOf`). Its files are fetched and checked by their hashes like any model's, into a folder of their own. It runs
  without adapters, which TensorFold does not load, and Pretrain says so. A spec records `engine` and `dir` only for such a
  member, so every earlier spec keeps its hash.
- **The list of models says what serves each** (2026-11-20): llama.cpp or TensorFold for a small model, its own engine for a
  larger one, on the pill of the one chosen and beside each in the list (`src/models.json` `engine`).
- **IFEval is listed under Instructions, and "The Crew" is "Programming and its conversation"** (2026-11-20). The Evaluate
  card showed "The Crew" over one test of following instructions. That test now sits under Instructions, the body of work
  whose questions train what it measures, and the body of work it left has the name the specification already gives it. A
  proof already named the capability Instructions, so no published figure moves, and earlier results of IFEval are shown
  under the new heading. The body's id (`crew`) and the questions written for it are unchanged.
- **An evaluation can be limited to chosen harnesses** (2026-11-20). Under the boxes for the bodies of work the Evaluate card
  has a box for each harness they are measured by ("With"); a task is asked where its body of work and its harness are both
  ticked, and a body of work with no harness ticked goes quiet (`evaluate.sh --harnesses lm,bfcl`). The table of scores has
  the same boxes: unticking one leaves the other harness's tasks and sums every line again over them. A harness added to
  the catalog has its box in both places without a change to the page.
- **Kept answers are named by the engine's version** (2026-11-20): the larger model's by its engine's, the swarm's by the
  build of llama.cpp that serves its small models. After either is updated the next Evaluate asks again by itself; a result
  says which engine and version served each (`targetEngine`, `swarmEngine`).
  Answers kept before this are used as they are while the engine's program is no newer than they are.
- **The page says when an engine is behind, and updates it** (2026-11-20), among the recommendations, under "The engines on
  this machine": the larger model's engine against its newest release (the catalog names where releases are published,
  `serve.releases`; the page asks that address once a day and sends nothing of this machine), and llama.cpp against the build
  the catalog pins. Each has an Update button: it turns to a bar while the update runs, with the step under it, says Complete
  when it is done and the recommendation goes; where it fails it says why and can be pressed again. No engine is updated
  while a pass, an evaluation or pretraining runs. The larger model's engine is updated by its maker's installer
  (`serve.upgrade`). **llama.cpp is updated with care for the models it serves** (`training/engine-update.mjs`): the pinned
  build is fetched beside the one on this machine, which is not touched; each model of the swarm is loaded with it and asked
  a sum; and it becomes the swarm's (`.work/engine/chosen`) only where every one answers. A model that needs support a build
  may lack, as Bonsai 2's rotated ternary weights do, is found out there and the build that was here is kept.
- **An evaluation of a swarm with no decision model starts at once** (2026-11-20). It said "Loading the decider" and waited
  a quarter of an hour for one that such a swarm does not have. And Pretrain's judging now ends by saying it is done: the
  page had read its verdict as a run that ended before it finished.
- **A request longer than a slot holds is read in parts** (2026-11-20, SwOA spec O.13). A request whose last message passes
  8000 characters (`plan.splitOver`) fitted no drafter and the swarm replied with nothing. Its text is now cut at line ends
  into parts that fit (`plan.partChars`), each part is read by two drafters of different models side by side
  (`plan.partReaders`), and the question is answered as any other over what the parts gave. What a reader wrote is kept only
  as the sentences of the part it comes from: a line that is in no sentence of its part is dropped. The context a slot is
  served is unchanged, so the swarm's memory is. `plan.split: "off"` answers whole, as before. Measured on the real models,
  one fact asked for out of a register, five questions a length: at 6000 and 12000 tokens 0 of 5 whole and 5 of 5 read in
  parts, the larger model 5 of 5, in 10 and 20 seconds against its 7 and 15. Not measured: a question that needs several
  parts put together, or a summary of the whole.
- **A turn with tools goes on as the work needs** (2026-11-20, SwOA spec T.11 to T.15). The conversation sent to the drafters is
  fitted to a slot: earlier tool results are cut, the earliest first, the latest never (`plan.toolFit`). Where no drafter
  proposes a step that can be taken the turn is answered from what there is, not ended as an error. The decision model is
  shown what was asked, not only what the last tool returned. Two settings the class stage may try and keep: `plan.callFirst`
  (a reply is set aside unless most drafters would reply: one that gives up no longer ends work the others would go on with)
  and `plan.toolDecide: "most"` (the step most proposed stands, the decision model not asked).
- **The web search test is asked alike of both** (2026-11-20). The swarm is now asked both ways the larger model is (the form
  of the answer said after the question as well) and its better way counts, as the larger model's does. A fetched page is
  given from where its own words begin, its menus left out, for whoever asked. A model whose prompt fits its context but not
  with the reply tokens asked for is asked once more for the reply that still fits: 11 of the larger model's 20
  conversations without snippets had ended in that refusal. Measured in a trial that changed nothing kept, 20 questions a
  task, `callFirst` on: with snippets the swarm 8 of 20 and the larger model 9 (they had been 1 and 7 of 40 over both tasks);
  without snippets 0 and 1, the larger model's before the correction to how it is asked.
- **A class of input is trained as a class** (2026-11-20). Before a pass goes question by question it now trains each class of
  input (with tools, a conversation, asking for code, a plain question) as a whole (`training/classes.mjs`): how the swarm stands
  on the class in three figures (some slot had a good answer, the swarm settled on one, the reply is good as it is read), a few
  candidate arrangements scored on the same questions, and the best kept only where it is better on held questions by more than
  twice its paired error. The Train card shows it. Some of each kind of question with an answer of its own are now also put as
  a standard test puts a question, with worked examples as earlier turns (`policy.json` `questions.shown`), so that the class
  most standard tests arrive as is trained at all; and Logic has five harder kinds, each with its own right answer.
- **Pretrain is aimed, taught and judged by training's own measurements** (2026-11-20). It learns from the kinds of question
  on which the class stage found no slot of the swarm had a good answer (a quarter of the time or more), and says so where
  there are none: what is lost in choosing or in writing out is not an adapter's to mend. It was aimed by a benchmark's
  verdict; nothing of a benchmark is read now. Only answers that are right by the question's own standard are taught. And it
  ends by judging its adapters: the held questions, the swarm without them and with them, served from then on only where it
  is better by more than twice the paired error (`node training/adapters.mjs judge`). The box on the card still overrides.
- **Every question of a pass has a pip**, the ones not asked yet among them, with their line in the key.
- **A reply can close as the conversation's earlier replies do** (`plan.closeAs: "shown"`, SwOA spec O.8.7): it does not open by
  saying the question again, has no empty line where the earlier replies have none, and ends with the form they end with around
  what was settled, an option said by its letter where they answer so. Measured on standard tests in a trial that changed
  nothing kept: Logic 32 to 86 of 100 (the larger model 88), Math 20 to 31 of 40, Reasoning 19 to 83 of 120. The swarm had been
  reasoning to the right answer and not being read.
- **An evaluation says how many replies its harness could not read**, for each model, on the card and in the table, and marks a
  task where that is a quarter or more of either side's. A task's stop words are no longer sent to a model whose reply opening
  the evaluation took off: the larger model had scored 0 of 20 on HumanEval, stopped at its own function header, and scores 19.
  The larger model's kept answers are asked again once.

- **SwOA (Swarm Orchestration Adaptation).** What a LoRA is to a model, a SwOA is to a swarm module: the spec applied to it to tune it. The output spec is now
  the **SwOA spec** (`<name>.swoa.json`, format `swoa` version 1, [docs/swoa.md](docs/swoa.md)): it names the base module it
  applies to and the target it was trained toward, with three hashes (base module, arrangement, recipe), and carries its
  **proof**: harness results for the module and its target, measured on exactly that SwOA, at least 100 questions a task,
  losses included. Publishing writes it with a **SwOA card** (`<name>.swoa.md`, YAML front matter with `model-index`), and needs
  proof rather than parity on training's own held questions. Output specs from before are still read.
- **Classes of input.** The arrangement is chosen by the class of the request (tools, talk, code, words), the same way in
  training and in the running module. What every lineup had learned on code questions now applies to code only
  (`training/migrate-classes.mjs`); before, briefs written for one code question drafted every essay.
- **Model files checked before they are served.** Every file of a member is checked against its pinned SHA-256 before the
  module first serves it, wherever the file came from; a file once checked is not hashed again while it is unchanged. A
  message whose content is a list of parts is read as its text parts (for the seed and a tool turn's question), as the
  SwOA specification says.
- **Learned changes stay with their class, and must generalize.** A change kept on a question goes into its class's own
  arrangement, never the shared one; a found arrangement is reused only within its class; a change must lose none of up to 4
  held questions of its class at parity before it is kept; and a change whose briefs quote the question it was found on is
  refused before it is tried. Before, briefs written for one rounding question drafted every essay.
- **No question is searched without end.** A question that came back on a changed arrangement while nothing else waited could
  not be set aside and had no last chance: 2,281 tries went to one. Nothing waiting is now its last chance. And a common word
  in quotes ('all', "are"), or the text between two apostrophes, no longer counts as quoting the question.
- **A program the question asks the output of is run, not worked out.** Where a question asks what a program prints and the
  program calls `console.log`, it is run once in the sandbox, and what it printed settles the answer (SwOA specification R.4;
  `plan.runPrograms: false` turns it off). Where it cannot be run, the drafts settle it as before.
- **A member's thinking never reaches an answer.** A stray `</think>` and the reasoning before it are removed from every member's
  reply (S3.8.5).
- **The writer can write the reply in full** (`plan.writeAs: "full"`, O.8.3): the answer, why, and what to do, where every draft is
  told to be brief. Training tries it first on a question whose reply is under half the larger model's length, and keeps it only
  where it wins.
- **Marks that are no answer are set aside in training.** A degenerate mark (the same few characters repeated) and one that a
  question made with its answer proves wrong are answered once and never searched.
- **A tie under "most" goes to the decider, not to order.** Settling by the answer most slots hold, where two or more answers
  have the most slots behind them alike, the decider chooses among those answers only (SwOA O.6.6 step 0; path
  `most-tie-decided`). Before, the draft that came first won.
- **Training's briefs stay with their class, and aim at the larger model's answer.** A brief the larger model writes records the
  class of the question it was written for and is offered on that class only (the 91 written before, with no class, are no
  longer offered); the teacher is told the wanted answer is the standard and never to teach a role to be shorter than it.
- **Parity means capability, in the proof and in training** ([docs/swoa-parity.md](docs/swoa-parity.md)).
  - _The proof._ A SwOA's proof gives a **verdict for each capability** (parity, short, open) from the paired gap over its
    tasks' questions against a margin of 0.05, and says what the SwOA does not claim. `evaluate.sh --proof` asks each task at
    a size that can give a verdict (about 500 questions a capability), keeps the swarm's answers task by task, and carries on
    where it stopped.
  - _Grading._ An answer is graded by its question's own standard where it carries one (a correct solution, an answer, a
    flaw, rules a program checks, the step a scenario needs); the larger model is counted by the same standard. Where a
    question has none, the standard is the answers the larger model agrees with itself on, of up to three.
  - _Keeping._ A change is kept when its class of questions got better (more than twice its error, no kind falling, the held
    questions not falling), not when one question came to parity. A question the change scores otherwise on is asked again,
    both ways, on another draw: a change that makes a question good on both draws and loses none is kept too, and one answer
    that came out otherwise once is no longer a fall. (Before, a change that fixed one question could never be kept: one
    question in thirty is within its own error.)
  - _Order._ What a kind of change has yielded now ranks it before the record of the question, once it has been tried 12
    times (the `yield` key of the loop's order). Two thirds of a pass's tries had gone to kinds that reached parity 4 times
    in 198.
  - _A drafter that answers by a program._ A new change the trainer can try: a drafting slot that writes a short program
    instead of an answer; the sandbox runs it and what it prints is the slot's answer (`compute` on a slot, SwOA spec
    O.6.1a). For counting, strings, totals and rates, where small models go wrong working it out in words.
  - _Memory, measured, and bounded._ Every pass measures what each model's own process takes while it serves, every two
    minutes, and writes it down beside the estimate from the files; the Memory saved card and the line under Train show
    the measured figure, from one source, and say so. The measurement found the fault it was built for: llama.cpp's server
    keeps a store of answered prompts in memory, 8 GB a server by default, and a swarm estimated to take 6.5 GB was taking
    17.4 GB against the larger model's 18. Every member is now started with that store off (`--cache-ram 0`, SwOA spec
    S2.4.5); each slot's own context still holds its brief between questions.
  - _A small model can decide in place of the decider._ A new way to settle a dispute (`plan.decideWith.how: "alone"`, SwOA
    spec O.6.6): one slot is shown every different answer and its word settles it; the decision model is not asked. The
    trainer tries it as its own kind of change. At the end of a pass each of the swarm's small models is put the pass's
    recorded choices as the decider (`decider-replay.mjs --members`), and where one chose at least as well as the decision
    model the recommendations say so, with what the swarm would not need. The count beside Configuration now includes
    every recommendation the dialog lists.
  - _A swarm with no decision model._ The Decides pill has a last choice, "A small model of the swarm" (the decider
    `none`): nothing is loaded to decide, and where the drafts differ a slot of the swarm settles it. It takes the decision
    model's memory out of the swarm, about a third of it. Choosing it keeps the decider it had as the judge of equivalence
    for training, where no judge is named. The recommendation above has a button that makes this change.
  - _A slot that decides is heard._ Asked with real models, a slot deciding between answers chose in its text and named
    nothing on half the disputes: its last line echoed the instruction it was given ("ANSWER: B and the letter of the
    correct one"), which was not read as a letter, or it was cut off at its token limit before its last line. The
    instruction is reworded, a letter followed by those words is read as that letter, and a slot cut off is asked once more
    for its letter, as a checker is. This is the same slot that decides beside the decider.
  - _A model alone is not asked again for another swarm._ The larger model's answers, the larger model against itself and
    each small model alone depend on the model, the questions and who read the answers, not on which small models are in
    the swarm. A configuration now takes what another against the same larger model measured, on exactly the same
    questions and read by the same reader, and asks nothing: about half an hour at the start of every new configuration.
  - _A check stopped in the middle carries on._ What a change has scored on its class is written down as the check goes,
    so a pass stopped during one does not ask those questions again.
  - _A pass that stops before training says why._ Where a kind of question has nothing to grade its answers by, the Train
    card names the kinds, how the judge did on its check, and where to choose another.
  - _Bounds._ A question's first visit is bounded in all (`firstVisitTries`, 40), whether or not its tries came closer, and
    its return at twice that. A class of change that has brought one question nothing in 8 tries is tried last there
    (`dryClassAfter`).
  - _Questions._ Three new bodies of work: **instructions** (rules a program checks), **tools** (calling a function, or
    not), **search** (a search tool and facts made up from the seed, so no model can know them).
  - _Tools._ In a turn with tools a reply is now written by the answer procedure, shown what the tools returned (SwOA T.9);
    before, the first drafter's reply went out unchecked. `plan.toolReply: "proposed"` keeps that.
- **Calling functions and searching are measured by a standard test.** Tools and Search are evaluated by the
  [Berkeley Function-Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)'s own package (`bfcl-eval`
  2026.3.23, installed into `.work/bfcl` the first time one of them is evaluated: about 2 GB), beside
  lm-evaluation-harness: the larger model and the swarm are offered the same functions in the same request, and paired
  question by question on the package's verdict. A SwOA's proof may now hold results of more than one harness; a result of a
  test with tools says what each model was offered.
- **The web search test needs no key.** Its searches go to a [SearXNG](https://github.com/searxng/searxng) (free software,
  pinned by revision, installed into `.work/searxng` the first time) that the evaluation serves on the machine for the length
  of the run. What each query returned and each page fetched is kept for the day and given to both models, and the result
  names the search (SwOA specification 4.7 `search`). `SWARM_SEARCH=serpapi` uses the paid service the test was written for.
- **The SwOA spec says what web search is to the module and how to use it** (`interface.webSearch`; SwOA specification T.10):
  a tool the caller offers and runs, never something the module does; whose each part is; the three steps of using it; the
  limits the module keeps to; and what its proof measured of it.
- **The larger model is not counted by how it happens to be served.** On a tool test it is asked two ways, the tools in the
  request and the tools written into the conversation, and counted by the way it scores higher by over the capability.
  Measured on the first target: its server returns only the first of the calls the model writes, and read the first way
  alone it scored 59 of 100 where the swarm scored 75; counted fairly it scores 81.
- **A reply no longer ends by saying where it came from.** A small writer gave the answer and then, in a paragraph of its
  own, said it was "settled based on the provided draft": 7 of the swarm's 39 replies in words on the function-calling
  test. Such closing paragraphs are cut, and the answer before them goes out as it was written (SwOA specification R.1.14).
- **The checks run on every core.** `npm test` deals the 87 blocks of `tests/run.mjs` out to as many processes as the machine
  has cores (`tests/shard.mjs`): 17 seconds on a 24-core Mac, where one process takes about 52. `npm run test:serial` is the
  one-process run. And two of the dashboard's checks no longer depend on how the machine that runs them is configured: they
  failed on a fresh clone, and so in CI.
- **Training asks every body of work; nothing is chosen.** The boxes to tick under the models ("Equivalent on") are gone,
  and `equivalence` from `src/config.json`: one left in a configuration file is not read, and the dashboard takes it out the
  next time it writes the file. A pass asks the kinds of all eight bodies of work (28 kinds; 168 train questions and 168
  held at six of each, where The Crew alone was 84), and more of the kinds the pass before found the swarm short on. The
  reason: the module picks its arrangement by the class of a request, not by the body of work, and a change is kept only
  when no kind of its class fell, so a kind a pass did not ask was a kind nothing protected. A pass is about twice as long.
  A pass in hand ends on the questions it began with. Under the pills are two rows instead: who takes turns with tools, and
  a button for each body of work that opens your own questions for it, which are asked beside the ones made. In a SwOA,
  `card.equivalentOn` and `trainedAgainst.equivalentOn` are now `trainedOn`: the bodies of work its training asked, read
  from the questions of the pass in hand and not from a setting.
- **A pass asks more of what the proof found short.** At the end of a pass the evaluations on record are read for each
  capability's verdict; a capability found short has two more train questions of each of its kinds in the next pass
  (`questions.shortMore` in `training/policy.json`; 0 turns it off), added to what the pass's own held questions ask more of.
  Only the verdict is read from a proof: never one of its questions, an answer to one, or which the swarm got wrong; and it
  never decides whether a change is kept. The pass's record, the page and the SwOA (`trainedAgainst.emphasis`, and a line
  under the proof on its card) say which proof was read and which passes it weighted. The SwOA specification says what a
  trainer may read of a proof (4.7). In a proof, a capability is now the body of work that trains what a task measures:
  IFEval's is Instructions, where it read The Crew.
- **Every kind of question has a second wording.** The check that asks each held question a second way covered The Crew's
  kinds only, 80 of a pass's 168 held questions. The kinds of Math, Logic, Reasoning, Instructions, Tools and Search now say
  their own second wording, with the same numbers, names, rules and arguments: 164 of 168. A first wording is made exactly
  as it was.
- **Evaluate says which bodies of work it asks.** Under **Asks**, a box for each body of work that has a standard test,
  every one ticked to begin with: untick some for a quicker look, or tick one to ask it by itself. It is a choice for one
  run, kept on the device, and applies to a proof run too. The card lists every such body of work, each folded to begin
  with; `evaluate.sh` with no `--items` asks them all.
- **A proof run from the page.** _Evaluate_ offers a fourth size, a proof run: each task at the size a verdict needs (five
  hundred questions or more a body of work, never fewer than a hundred of one task). A run that is stopped carries on from
  the task it stopped in.
- **What a run installs is its own, and is made again where it is broken.** Evaluate and Pretrain install what they need
  the first time (lm-evaluation-harness, the tool tests, MLX). The Python `uv` fetches for each now goes into that
  program's own folder in `.work`, never the machine's `~/.local/share/uv`, so the Uninstall Helper takes it out with the
  rest; and a venv that is there but does not work (an install that was interrupted, a Python since removed) is made again
  from nothing, where before the install stopped on "a virtual environment already exists". The Uninstall Helper lists the
  tool tests, the search behind the web search test, the swarm's kept answers with the larger model's, what Clear training
  state set aside, the logs, and any folder of `.work` with a Python of its own that it does not know by name.
- **The Evaluate card folds.** Its breakdown is one section, folded to begin with, that says in a line where the run is or
  what the last evaluation came to; inside it each body of work folds under its heading with a line of its own, the one
  being asked open. A proof run of 23 tasks is a card a screen tall, not three. A task that cannot be asked says so once.
- **The page says one thing in one place.** A question set aside or back in hand is not counted finished; the share of
  answers good is the same share in the Train card and in the SwOA spec; while an evaluation runs the Train card says the
  models are loaded for it; the proof's numbers stay on one line; and the SwOA's words for where training stands say what
  that measures now.
- **The page says "good", not "parity", of a question.** Parity is the proof's verdict on a capability. A train question's
  answer is good as the swarm stood, made good by a change, or not good yet; the head of the Train card is the share of
  answers good, with the module beside the larger model where the questions carry a standard; a kept change says what its
  class gained; and the page says how a change is kept as the policy has it.
  - Knowledge reaches the module through tools the caller offers; a recipe holds no body of knowledge.
- **Training reads its own signals on one line, and stops spending tries where none can pay.** Each slot's answer is read
  on the line the reply is read on (it was read at one half against the reply's 0.8, so "a slot had the answer" often
  meant an answer the reply could not pass). How the reply itself read counts first in whether a change came closer.
  A change that cannot alter the answer to a question of its class is passed over at no cost of a try. A mark the larger
  model did not give again is not searched where the swarm is short of it (a self-check written while no reader was
  believed is read again from the record). And the larger model adds a sentence or two to what a slot is told, never
  rewrites it.
- **Writing in full, repaired.** `plan.writeAs: "full"` now tells the writer one brief of its own in place of the slot's
  (SwOA O.8.4), with no cases to tell apart, and is never applied where a piece of writing is asked for (R.5). Before, a
  2B writer echoed the instruction into its answers and wrote around pieces that were already close.
- **The dashboard draws the class's own arrangement.** While a question is asked, the faces show the arrangement of its class
  (tools, talk, code, words), a change being tried is compared with that one, and steps the class's turn cannot take (the
  sandbox off code; all but drafting and deciding for a turn with tools) are drawn off.
- **No kind trained on nothing.** A pass stops before training when a kind of question has nothing to compare (a reader that
  failed its check), and says which and why; `SKIP_KINDS` leaves kinds out on purpose.
- **The module.** Two small models served by llama.cpp, four slots each, answer as one model: messages in, one reply out, at an
  OpenAI-compatible address or from `createSwarm()`.
- **The arrangement.** Draft, check, decide, write. A decision model (Kev) settles which answer stands when the drafts disagree.
- **Training.** Recursive passes toward parity with a larger model: each pass measures the Swarm against the larger model's own
  answers, plans from where the answers were lost, tries other briefs and arrangements, keeps a change only on evidence, and
  hands what it learned to the next pass.
- **What equivalence means.** The work of a seat on a team (The Crew): programming, and the conversation around it in Simple
  and Developer, judged on the act, the substance and the conventions. It is one body of work of a list (Code, Math, Logic,
  Reasoning, Instructions, Tools and Search are the others), all of them asked in every pass. Each has a button under the
  models that opens its questions, to which a person can add their own.
- **Parity reads meaning, and says how sure it is.** The reader is checked on paraphrases and near-misses (one fact changed)
  before it is believed; an undecided reading is counted apart and decides nothing; the larger model answers twice, and how
  often it agrees with itself is shown as the noise floor; a judge apart from the decider can read equivalence; and an agent
  step's written text is compared without case or end punctuation.
- **Turns with tools, decided by the swarm (a toggle).** With `"tools": "swarm"` an agent's turn is drafted by every drafter,
  malformed calls left out, and the decider picks; it goes back as `tool_calls`. Training asks an agent's next step as a kind of
  question for The Crew, and grades it against the larger model's step.
- **The output spec makes the swarm again.** It holds every slot's words, the decider's recipe, the engine's builds, a card
  for a model chooser, what it needs of a machine (licences and commercial use among it) and what it can do as a model, with a
  hash of the recipe. `createSwarm({ spec })`, `serveSwarm({ ...card, spec })` and `swarm serve --spec` make that swarm.
- **The decider's wait fits the decider.** It grows to three times the slowest recent decision (up to 30 s), and a decision
  that times out is asked once more, rather than the answer most slots gave standing in its place.
- **Training finds answers cut off at the token limit, drafters that echo each other, and a decider that times out**, and
  measures more room, other sampling or another place for them.
- **Recommendations from the configuration's own answers, as they arrive**: a model that adds nothing taken out, a decider
  judged on its reliability, each with how many answers it rests on and what it costs.
- **The arrangement as faces.** Each slot is a face of its model in the step it stands in, with its record as a ring and what
  it is doing as a dot and a halo; choosing one opens what it is told.
- **Configurations learn from each other.** Each keeps its own record; what another kept is measured first here, and the
  dashboard recommends changes to the configuration itself from what every configuration measured, beside Configuration.
- **More for training to try.** The settled answer handed over without a rewrite; briefs written by the larger model for failing
  slots; worked examples shown to a drafter; six slots a model and a replace move; another small model probed on the questions
  no slot drafts; candidates screened on a few questions; recorded choices replayed through another decider; a keep confirmed
  with a second draw.
- **Uninstall Helper.** A button beside the output spec lists what the Swarm has installed in `.work`, with sizes and what the
  configured swarm uses, and removes a piece after asking. Nothing outside `.work`, and never through a link.
- **More deciders.** StartLux Decision 4B and 9B, run here through MLX, and three leaders that need an NVIDIA GPU, each with its
  Decision Index score; the decider script starts any of them by its recipe.
- **The search over arrangements.** Every step kind in every place it can go, in a fixed order with nothing drawn by lot;
  a measurement is named for the flow it was made with (before 2026-11-16 it was not, and a changed flow was given the score
  of the flow it came from).
- **Recovery.** A session restarts what stops, resumes what was interrupted, and records every recovery.
- **The dashboard.** A local page showing the models, the arrangement, the plan being carried out and parity with the larger
  model, with a button that fetches what is needed and runs a pass.

Measured so far: five passes on one configuration, 59.5% of the way to parity with Nemotron 3.5 Lightning 30B (25 of 42
held answers). See [Measured, not claimed](README.md#measured-not-claimed).
