# SoRA specs

Published SoRAs, two files each: `<small models>+<decider>--<larger model>.sora.json`, the SoRA spec, and `.sora.md`, its
SoRA card (the format: [docs/sora.md](../docs/sora.md)). A SoRA here has proof: harness results for the module and its
target, measured on exactly it, at least 100 questions a task, losses included. It holds what a swarm is built
from (each model's pinned file and SHA-256, the decider and how it is started, the engine, the arrangement and what every
slot is told), what training kept question by question to get there, and where it stands.

This is the only thing training leaves that is committed. Everything a session writes as it trains (the pass it is on,
what it read, what each configuration tried, every measurement) stays on the machine that trained it, and is ignored by git.

A SoRA is written here from the dashboard: **SoRA spec**, then **Publish to specs/**. The button is greyed out until the
SoRA has proof, and says why. Publishing again replaces both files, so a SoRA here is always the newest for its
configuration.

To build a swarm from one, see "From a spec" in the [README](../README.md): `node bin/swarm.mjs serve --spec specs/<name>.sora.json`.
