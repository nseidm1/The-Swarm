# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting: on this repository's **Security** tab,
choose **Report a vulnerability**. Say what you found, how to reproduce it, and what it lets someone do.

You can expect an answer that the report was received, and then a fix or an explanation.

## What matters most here

The Swarm starts two model servers on the user's own computer and puts one address in front of them. The things it is built to
hold are:

| The Swarm must | How |
|---|---|
| Answer only this machine | Its server and both model servers listen on `127.0.0.1` |
| Run only the models it names | Each model file is fetched from a pinned revision and kept only if its size and SHA-256 match `src/models.json` |
| Run a model's code only where it can reach nothing | Where a function is asked for, the Swarm runs its own drafts on a few calls to see which of them do the same, and the trainers run functions to see whether two of them do the same. That is the only thing of a model's that is ever run, and it is never run in the Swarm's own process. Each function runs in a process of its own with Node's permissions on (no files, no programs, no workers), and inside that in a place made from nothing: no `require`, no `process`, no `fetch`, no object of the host to climb out by, and no making code from text. The calls it is tried with are written by a model too, so they are read and run inside that same place and nowhere else. Only text crosses the line, every call is stopped after a moment, and the process is limited in memory and killed if it runs on (`src/sandbox.mjs`, `src/sandbox-runner.mjs`). Node's permissions do not themselves stop the network, which is why the code is given no way to reach it A test holds every file of the module, of training, of the tools and of the page to this: none but the runner inside the sandbox may turn text into running code. |
| Run a model's code in another language only in the system's box | Drafts in Python, Go, Swift, Dart, Flutter and Kotlin, and a whole Python program, are run by that language's own tools under the operating system's sandbox (macOS `sandbox-exec`), with a profile that allows nothing but what it names: no network, no write outside a folder made for that one run, no reading of the person's folders but that folder and the language's tools. The folder is removed afterwards. On a system with no such sandbox these languages are not run at all, and nothing is installed in order to run them (`src/langs.mjs`). A check tries to reach the network, to write to the home folder and to list it from inside a draft, and each is refused |
| Run nothing at all, where that is wanted | `createSwarm({ runCode: false })`, or `SWARM_RUN_CODE=0`, and nothing a model wrote is ever run: drafts of code are compared as text. On a Node older than 20, which cannot run code this way, the same happens by itself |
| Treat everything else a model writes as text | A slot's output is read for an answer and passed to other slots as text. A reply that is a call to a tool is not run and not sent |
| Keep nothing | It holds no credential and writes no conversation to disk. The trainers write what they measured under `.work/`, which is not committed |

A way round any of these is a vulnerability.

## What is not a vulnerability

- **A wrong answer.** Report it as an ordinary issue, with the message and the reply (and the trace, if you can).
- **A message that makes a slot ignore its brief.** A person who can send a message to the Swarm can already ask it anything;
  the slots have no powers to take over. If you find a way for a message to make the Swarm do more than write text, that is a
  vulnerability.

## Secrets and this repository

The repository holds no secret, and nothing it makes is one. Model files and training rows go under `.work/`, which is in
`.gitignore`.
