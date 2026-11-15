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
- **Recovery.** A session restarts what stops, resumes what was interrupted, and records every recovery.
- **The dashboard.** A local page showing the models, the arrangement, the plan being carried out and parity with the larger
  model, with a button that fetches what is needed and runs a pass.

Not yet: a finished training pass, and so any measured result. See [Status and limits](README.md#status-and-limits).
