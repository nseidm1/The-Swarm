# Changelog

What changed, for a person deciding whether to update. Newest first. Versions follow [Semantic Versioning](https://semver.org).

## 0.1.0 (not yet released)

The first version.

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
  - *The proof.* A SwOA's proof gives a **verdict for each capability** (parity, short, open) from the paired gap over its
    tasks' questions against a margin of 0.05, and says what the SwOA does not claim. `evaluate.sh --proof` asks each task at
    a size that can give a verdict (about 500 questions a capability), keeps the swarm's answers task by task, and carries on
    where it stopped.
  - *Grading.* An answer is graded by its question's own standard where it carries one (a correct solution, an answer, a
    flaw, rules a program checks, the step a scenario needs); the larger model is counted by the same standard. Where a
    question has none, the standard is the answers the larger model agrees with itself on, of up to three.
  - *Keeping.* A change is kept when its class of questions got better (more than twice its error, no kind falling, the held
    questions not falling), not when one question came to parity.
  - *Questions.* Three new bodies of work: **instructions** (rules a program checks), **tools** (calling a function, or
    not), **search** (a search tool and facts made up from the seed, so no model can know them).
  - *Tools.* In a turn with tools a reply is now written by the answer procedure, shown what the tools returned (SwOA T.9);
    before, the first drafter's reply went out unchecked. `plan.toolReply: "proposed"` keeps that.
- **Calling functions and searching are measured by a standard test.** Tools and Search are evaluated by the
  [Berkeley Function-Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)'s own package (`bfcl-eval`
  2026.3.23, installed into `.work/bfcl` the first time one of them is evaluated: about 2 GB), beside
  lm-evaluation-harness: the larger model and the swarm are offered the same functions in the same request, and paired
  question by question on the package's verdict. A SwOA's proof may now hold results of more than one harness; a result of a
  test with tools says what each model was offered. The web search test searches the live web through a service that needs
  a key (`SERPAPI_API_KEY`): without one it is not asked, and says so.
- **The larger model is not counted by how it happens to be served.** On a tool test it is asked two ways, the tools in the
  request and the tools written into the conversation, and counted by the way it scores higher by over the capability.
  Measured on the first target: its server returns only the first of the calls the model writes, and read the first way
  alone it scored 59 of 100 where the swarm scored 75; counted fairly it scores 81.
- **A reply no longer ends by saying where it came from.** A small writer gave the answer and then, in a paragraph of its
  own, said it was "settled based on the provided draft": 7 of the swarm's 39 replies in words on the function-calling
  test. Such closing paragraphs are cut, and the answer before them goes out as it was written (SwOA specification R.1.14).
- **A proof run from the page.** *Evaluate* offers a fourth size, a proof run: every body of work that has a standard test,
  chosen for training or not, each task at the size a verdict needs (five hundred questions or more a body of work, never
  fewer than a hundred of one task). A run that is stopped carries on from the task it stopped in.
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
  and Developer, judged on the act, the substance and the conventions. Chosen on the dashboard under the models, with Math,
  Logic and Reasoning as further choices. Each has a pencil that opens its questions, to which a person can add their own.
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
