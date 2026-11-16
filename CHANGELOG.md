# Changelog

What changed, for a person deciding whether to update. Newest first. Versions follow [Semantic Versioning](https://semver.org).

## 0.1.0 (not yet released)

The first version.

- **The module.** Two small models served by llama.cpp, four slots each, answer as one model: messages in, one reply out, at an
  OpenAI-compatible address or from `createSwarm()`.
- **The arrangement.** Draft, check, decide, write. A decision model (Kev) settles which answer stands when the drafts disagree.
- **Training.** Recursive passes toward parity with a larger model: each pass measures the Swarm against the larger model's own
  answers, plans from where the answers were lost, tries other briefs and arrangements, keeps a change only on evidence, and
  hands what it learned to the next pass.
- **What equivalence means.** The work of a seat on a team (The Crew): programming, and the conversation around it in Simple
  and Developer, judged on the act, the substance and the conventions. Chosen on the dashboard under the models, with Math,
  Logic and Reasoning as further choices. Each has a pencil that opens its questions, to which a person can add their own.
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
