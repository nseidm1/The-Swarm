# Status and limits

What has been run:

- **The instruments, against every benchmark question at hand, with no model (2026-11-22).** On the four tasks of a
  standard suite that ARE the operations, 1,000 of 1,000 read and right (920 never read when the instruments were
  written). On 14,957 questions of 19 other sets (other tasks of that suite, arithmetic in words, science questions,
  instructions, code): fired on none. On 104,520 questions by other contributors (14 BIG-bench tasks, the EleutherAI
  arithmetic suite): 22,959 read, every one answered as its set says. **A limit, said plainly:** the instruments were
  written after four tasks of a benchmark were read, and their reading was widened after the other contributors'
  sets were read (an answer label at the end; operators in words); before that widening they read 2,060 of the
  104,520. What they read they answered rightly throughout.
- **The instruments, against questions nobody read (2026-11-22).** Made at random from a seed, with near misses made on
  purpose: 20,000 a run read all but a handful and none wrong; 6,800 near misses, none answered. That found two faults
  the benchmarks had not (a question about sorting answered as an instruction; a list parted by bars), both mended. And
  wordings the larger model wrote in a pass, in voices of its choosing: 21 of the first 37 read, then, the reading
  widened, 26 of a fresh 27; right on every one read. The larger model now writes such wordings in every pass, and an
  instrument is kept on ones its trying never saw.

- **Where the other classes stand (2026-11-25).** Requests for code 45 of 60 held, turns with tools 15 of 18,
  conversation 77 of 78. Code now answers the small sums of a conversation and a sum asked in a turn with tools
  ([measured](measured.md#where-the-other-classes-stand-and-what-code-does-there-2026-11-25)). **Limits, said
  plainly:** nothing mechanical was found for requests for code, which is where the swarm is furthest short; the two
  additions are measured as code, not yet as a gain to a class in a pass.

- **What each layer is worth, on one lineup (2026-11-25).** On training's held plain questions, a 1.7B model alone
  answered 87 of 132; the swarm as a module starts, 115; with what training had kept, 115 still; with every
  instrument on, 131; with the forms read as well, 129
  ([measured](measured.md#what-each-layer-is-worth-on-one-lineup-2026-11-25)). **Limits, said plainly:** the
  instruments' part is on questions worded as training words them; the arrangement's part is the only one measured
  outside training, and there on another lineup; training's own kept changes added nothing on this class.

- **What training's writer can be trusted with (2026-11-25).** Measured for the 30B model, a rung at a time: it
  fills the module's forms (11 of 12 kinds), it lays a kind no form was made for onto a form that fits (5 of 6), it
  does not reliably write a function for a kind (4 of 12), and it does not design a form with its code (1 of 8 at
  best). So forms and their code are the module's own, and training asks its writer for readings: a kind laid onto a
  form ([measured](measured.md#what-the-writer-can-be-trusted-with-a-rung-at-a-time-2026-11-25)). **Limits, said
  plainly:** one writer was measured; the six kinds made for the rung are ours; no class has yet kept a reading.

- **Two kinds of question were added to training (2026-11-25), and no earlier figure was changed by it.** Who holds
  what after things have changed hands, and whether steps and turns lead back. They stand after every other kind, so
  every earlier question is what it was (held by hash), and a class's figures are told twice from that day: of every
  kind, and of the kinds as they were. **Said plainly:** both are well-known families of problem, and standard tests
  hold tasks of the same families. They were written here, in our own wording, and no benchmark was read; they will
  resemble such tasks because the families are general.

- **Fourteen instruments that read a whole question, and forms for questions put another way (2026-11-25).** Who tells
  the truth, a word and what is done to it, things in a row, a date so many days on or back, when someone was free, who
  is the tallest, how many more of one figure than another, whether an argument holds, a number and what is done to
  it, a day of the week, a count of letters, a count in a stretch of numbers, who holds what after swaps, whether a
  walk leads back. Each instrument was written
  from training's own questions; no benchmark was read. With no model: 40 of 40 held questions right for each. On 73
  held questions reworded by the larger model the instruments read 5, which is what forms are for: a 1.7B model read
  38 into forms, 35 rightly; on a second set of 71 that nothing was mended against it read 29, 25 rightly, and
  the swarm with reading answered 55 of 71 where it answered 44 alone; a 30B model read 50 of those, 48 rightly
  ([measured](measured.md#a-model-reads-code-works-it-out-2026-11-25)). **Limits, said plainly:** what reading is
  worth depends on the models of the lineup; one form (how many more) was read wrongly too often and is left out
  unless named; no pass has been run
  with instruments or forms on, and none is on until training keeps it.

- **The module as configured, on every task (2026-11-22).** LFM2.5 1.2B in both places against Nemotron 3.5 Lightning 30B,
  20 questions of each of 23 tasks: 55.2% against 77.6% that evening (54.1% in the afternoon), the small model by itself 30.0%
  ([Measured, not claimed](measured.md#the-module-as-configured-on-23-tasks-2026-11-22)). Trained, the same module has not yet read higher on any benchmark (below).
- **Checks:** all of them, against stand-ins.
- **Training question by question, on real models:** a night and a morning with LFM2.5 1.2B, Qwen3.5 2B, Bonsai 2 4B,
  Jeffan 4B and Nemotron 3.5 Lightning 30B: the loop, the found arrangements tried first, and one review of the search by the
  larger model (its proposal went on trial). Its suggestions of what to try, swapping a standing conflict, trials counted in
  tries and the cumulative record of wins are checked against stand-ins, and not yet seen in a real run.
- **The earlier training, on real models:** five whole passes and most of a sixth, continuously, with LFM2.5 2.6B, Bonsai 2 2B, Kev 4B
  and Nemotron 3.5 Lightning 30B. The briefs the larger model writes, the third-model probe and the decider replay have run
  in that session; StartLux Decision 4B has been put a pass's recorded choices (38 of 46 to Kev 4B's 37).
- **Recovery, on real models:** a stopped session resumed its pass and carried on from where it was.
- **Training question by question, on the swarm of 2026-11-18:** a night with Bonsai 2 2B, LFM3 1.7B and Jan-Code 4B, Kev
  0.8B deciding and Jeffan 4B judging, against Nemotron 3.5 Lightning 30B (2026-11-18): 64 of 84 train questions finished,
  17,754 changes tried, 14 kept.
- **Evaluate the swarm, on real models:** on IFEval, seven times (20 and 100 questions; three swarms; without adapters and,
  once, with), and on the function-calling test, 20 questions of each of five categories (see
  [Measured, not claimed](measured.md#measured-not-claimed)). A proof run of every body of work was started and stopped partway
  (2026-11-18): the larger model was asked 7 of its 21 tasks, the swarm none.
- **Pretrain, on real models:** from the dashboard, all three small models of the configured swarm adapted, its own steps
  (the small models made ready, MLX and each model's original weights already here) taken by itself.

What has not:

- **Parity.** No capability has that verdict. The only results at proof size (100 IFEval questions, an earlier swarm) read
  short: 60% against 79%. Everything since is too few questions to say, and the proof run that would say was stopped
  before the swarm was asked.
- **A whole pass under the new rules.** Grading an answer by its question's own standard, the standard among the larger model's
  three answers, and keeping a change by its class are built and checked against stand-ins. The class stage has run on real
  models under them (2026-11-22, LFM2.5 1.2B in both places: one change kept for plain questions, 11.1 points on 108 held
  questions with an error of 2.6; that arrangement was set aside when the module's code changed under it). A whole pass,
  question by question, has not run under them yet.
- **A whole pass that asks every body of work.** A pass asks all eight: 37 kinds of question, 264 train questions and 264 held: six of each kind (222) and two more of each of 21 kinds, put
  the way a standard test puts a question (28 kinds from 2026-11-18; the harder logic kinds and, on 2026-11-22, four operations code does
  exactly were added since). The class stage has asked them of real models; a whole pass has not.
- **The second wordings of the new kinds, on real models.** Every kind has a second wording now (218 of the 222 held questions asked plainly), each checked to carry the same numbers, names, rules and arguments and to have the same answer.
  None of the 84 written on 2026-11-18 has been asked of a model yet.
- **A pass weighted by the proof.** Built and checked against made-up evaluations, and read against the ones on record:
  Instructions (20 questions) and Tools (100) both read open, so nothing is short and nothing would be asked more of. It
  first has something to act on when a proof run finishes; and it takes effect at the end of a pass, for the next one.
- **Search on the live web.** The web search test reads 2 of 40 for the module against 8 for the larger model
  (2026-11-23), no better than before the search was made a program of code (4 of 40). The first facts of a chain are
  found and the answer comes in the form asked; the second or third fact is lost, to a page that does not hold it or a
  reading of the fact beside it. On a made task of two chained facts the program has 30 of 30.
- **Following instructions as well as its own model.** On 100 questions of IFEval the small model asked by itself has
  75 right and the module 68. One slot asked as the request came, for a request that instructs its reply, reads 71,
  and is now an arrangement training can keep; no run has shown whether it does.
- **Training that betters the module on a benchmark.** Adapters made for each drafting slot gain 25 to 30 points on
  training's own held code questions, beyond error, and training keeps them by itself. On HumanEval and MBPP at 100
  questions each the module with them read 75 of 200 against 95 without. Carried only on requests like what they
  were taught, they read 92 of 200, and 247 of 460 on all 23 tasks against 254: no harm and no gain. Training's own
  questions (eleven families of function) are not what the module is judged on, and its keep rule cannot see that:
  its held questions come from the same maker.
- **A conversation pass that betters the module.** Two passes have run on real models (LFM2.5 2.6B in both places,
  eleven people, 2026-11-24): the module had 62 of 66 train conversations right before anything was tried, the first
  pass found nothing to keep, the second carried two more questions of the kind it was short on (replies to thanks)
  and its best change, an offer of help taken off, gained 1.5 points on held conversations with an error of 1.1 and
  was not kept. The carrying from pass to pass works; the set is too easy for this model to show a pass bettering it.
  The two people who ask for reasoning and code, and the run's own card, have not been run on a model yet.
  There are thirteen people and fifteen conventions: a start, not a measure of conversation. The first six were too
  easy to tell anything (a module of LFM2.5 2.6B had all of twelve right), which is why five harder ones were added.
- **A breakdown or a cascade that helps.** Code that puts the question in numbered lines for the drafters, and a slot
  that works it one fact at a time, are built and are changes training can try. Tried by hand on four small models
  (LFM2.5 1.2B and 2.6B, Ministral 3 3B, Bonsai 2 9B; 10 to 30 questions each, 2026-11-24), neither gained: the
  smallest model's steps are not reliable, and the largest is right when asked plainly. The size of the small model
  moved the same questions from 5 of 18 to 16.
- **A larger small model, in a whole run.** LFM2.5 2.6B in both places reads 109 of 160 on training's fresh panel
  where LFM2.5 1.2B read 84 (103 with its adapters). No whole run has been made on it, and no adapter for it.
- **Three figures on one code.** The run above was measured across two days of changes. No whole run has been made
  since each stage was held to the one before.
- **A change kept on time.** The time tie-breaker has judged one real trial (Inkling 2 Mini on the standard build
  against Atomic Engine, 8 held conversations, 2 draws): answers the same, 35 tokens a second against 31, but 37.7
  seconds a question against 36.3, with an error of 23 points on the saving. It was not kept. Eight questions is too
  few to say the engines differ in time; it says the rule refuses what it cannot show. No leaner arrangement has been
  timed on a real model yet.
- **Atomic Engine, beyond a first try.** Built here once and tried on six questions through the module (six right, 407
  seconds against 501 on the standard build). Its maker reports 106 tokens a second on an M4 Max; this machine gave
  34 for one request. No evaluation and no training has run on it, its answers have not been compared with the
  standard build's beyond those six, and it is a developer preview. Training does not yet choose between engines:
  it is a model a person chooses.
- **Inkling 2 Mini, beyond a first try.** Six quantizations are in the catalog. One (Q2_K_XL) has answered through
  the module, six questions, five right, about 96 seconds a question on this machine; it needs a llama.cpp build that
  knows its architecture (Unsloth's was used). No evaluation, no training, and none of the other five has been loaded.
  At 9 to 23 GB it is not small beside an 18 GB larger model: it is in the list to be tried, not because it fits the aim.
- **Ten of the nineteen small models in a swarm, two of the four Kev sizes, and fourteen of the fifteen larger models.**
  Pinned. Every small model has answered alone; four small models at once have not been run.
- **Adapters that help.** Pretrain has run on the real models (2026-11-17, 100 steps each, on 72 of the larger model's
  answers to The Crew's train questions, one left out as too long), and llama.cpp finds those answers likelier with each
  adapter (perplexity 3.49 -> 2.75 for LFM2.5 1.2B, 2.73 -> 2.39 for Qwen3.5 2B, 2.43 -> 1.99 for Ministral 3 3B). Served
  with them, the swarm did worse on IFEval (the same result as Nemotron on 48 of 100 questions against 61 without; see
  [Measured, not claimed](measured.md#measured-not-claimed)). Adapters by role, taught on every body of work (2026-11-22), were evaluated once, on 180 questions of an earlier
  state of the module: 40.6% and 36.7% against 38.9% without, no difference beyond an error of about 3 points. They have
  not been measured since the module's faults of form were mended. Bonsai 2 4B cannot be adapted here (only its ternary, Hadamard-rotated weights are published and its maker
  documents no way to train an adapter on them; llama.cpp's own `llama-finetune` trains none of these models).
- **Evaluate the swarm, at proof size.** Every task has run on real models at 20 questions (23 tasks, 2026-11-22), and
  IFEval at 100; no run at proof size has finished. Some tasks open the model's reply for it (HumanEval, MBPP): in an
  evaluation both models are asked without that opening and the reply is turned into what would have followed it, so the
  larger model's figures may differ a little from published ones, and the comparison between the two is like for like.
  A conversation has no standard task in either harness, so The Crew's figure is IFEval alone; an agent's steps are
  measured under Tools, by the function-calling test.
- **Linux and Windows.** It has run on one Apple silicon Mac. The pull-request workflow has not run yet.
- **The engine and larger-model downloads.** The fetch is checked against a stand-in, not against the real files.
- **Most of recovery, on real models.** Every way back in [Recovery](training.md#recovery) is checked against stand-in servers made to
  fail; in a real session only resuming a stopped pass has been needed so far.

Known limits:

- **Turns with tools are new.** The swarm decides an agent's turns only with `"tools": "swarm"`. Until 2026-11-17 the module
  did not read that setting from `src/config.json` (only `SWARM_TOOLS`), so sessions gave turns with tools to the lead
  whatever the page said; it does now. Tried on this machine with the three small models (2026-11-16): on "What does src/math.js export?" LFM2.5 2.6B's drafters read the file, Bonsai 2 2B's listed the folder, and LFM2.5 1.2B's replied that they had no files to look at; most read the file, and that was the step. Measured against the larger model on the function-calling test (2026-11-18, 20 questions a category): 75 of 100 right against its 81, most of its misses an answer worked out in words where a call was needed.
- **How the larger model is served can hide what it can do, with tools above all.** Its server here returns only the first of the calls the model writes. On the function-calling test it is therefore asked two ways and counted by the better; in training it is still asked the one way, so on training's own tool questions its count beside the swarm's is a low one wherever more than one call is needed (the swarm's grade does not depend on it there).
- **A search of the live web does not repeat.** The web search test reads different pages a day apart, so both models are asked on the same day, through the same search, and what each query returned is kept and given to both; the result says the day and the search. A score through this search is not one to set beside the published leaderboard's.
- **Slow by design.** A question the drafts disagree about takes four stages.
- **Which languages are run.** JavaScript, TypeScript, Python, Go, Swift, Dart, Flutter and Kotlin, each where the
  machine already has its tools (nothing is installed for it; Kotlin's compiler is the one Android Studio carries).
  Every language but JavaScript and TypeScript runs under macOS's own sandbox, with no network, no write outside the
  folder of the run and no reading of your folders; on a system without it those languages are not run. Drafts in a
  language that is not run are compared as text, and so are seldom found to agree. Kotlin takes about ten seconds a
  draft, Flutter about four. A Flutter widget is known by the texts it shows and the widgets under it, so two that
  look the same and are built of other widgets count as two answers.
- **Doing the same on the calls tried is not being the same.** Drafts are one answer when they agree on about ten calls a small model wrote. Two functions that part only on a case nobody tried are taken for one.
- **The reply is whole before it is sent.** A streamed reply is the finished one, in pieces.
- **Small questions only.** Small functions and short conversations. Training's own code questions are JavaScript; a
  draft in another language is run, and measured only where a benchmark asks for it (Python). Larger programs and long
  writing are not measured.
- **Few families of question.** Eleven kinds of function, with details that change. The train and held questions are
  different draws from the same families, so a pass can learn a family. More families are the cure.
- **No decider is trained for this yet.** Each decides as it was published.
- **A larger model that gives no usable answer is not compared.** A reply cut off partway (a function that does not parse, a
  sentence of one word) is not taken for an answer: it is asked again, and if it still holds none, its question is left out
  for everyone. The step that asks the larger model says how many of its replies hold an answer.
- **How a larger model is served matters.** Nemotron 3.5 Lightning 30B, served by TensorFold with drafting on, broke off into
  unknown tokens two lines into every answer that corrects a function (12 of 12). Served without drafts, as The Crew had
  already learned to serve it, all 84 of its replies to one pass's questions held an answer (2026-11-15). It is served that
  way here, and each larger model's entry in `src/models.json` carries what it must be served with.
