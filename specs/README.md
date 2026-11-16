# Specs

Finished swarms, one file each: `<small models>+<decider>--<larger model>.json`. A spec here is at parity with its larger
model on the held questions: every answer fundamentally equivalent to the larger model's. It holds what a swarm is built
from (each model's pinned file and SHA-256, the decider and how it is started, the engine, the arrangement and what every
slot is told), what training kept question by question to get there, and where it stands.

This is the only thing training leaves that is committed. Everything a session writes as it trains (the pass it is on,
what it read, what each configuration tried, every measurement) stays on the machine that trained it, and is ignored by git.

A spec is written here from the dashboard: **Output spec**, then **Publish to specs/**. The button is greyed out until the
swarm is at parity, and says why. Publishing again replaces the file, so a spec here is always the newest finished one for
its configuration.

To build a swarm from one, see "From a spec" in the [README](../README.md): `node bin/swarm.mjs serve --spec specs/<file>`.
