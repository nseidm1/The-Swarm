---
name: Something is wrong
about: The swarm did something it should not have, or did not do something it should
labels: bug
---

**What you sent**

<!-- The message, or the request to /v1/chat/completions. -->

**What you expected**

**What came back**

<!-- The reply. If you can, run it again with `node bin/swarm.mjs ask "<message>" --trace` and paste what each slot wrote. -->

**Where**

- How it was used: `createSwarm()` / `serveSwarm()` / `swarm serve` / inside another program (which)
- llama.cpp version (`llama-server --version`):
- Machine and system:
- Commit, and the `version` in `src/briefs.json`:

<!-- For anything that could be a vulnerability, do not open an issue: see SECURITY.md. -->
