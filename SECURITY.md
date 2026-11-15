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
| Run only the models it names | Each model file is fetched from a pinned revision and kept only if its size and SHA-256 match `src/catalog.mjs` |
| Run nothing a model writes | The Swarm itself never runs a slot's output: it is text, read for an answer and passed to other slots as text |
| Run a model's code only where it can reach nothing | The trainers do run functions the models write, to see whether two of them do the same. Each runs in a process of its own with Node's permissions on (no files, no programs, no workers), and inside that in a place made from nothing: no `require`, no `process`, no `fetch`, no object of the host to climb out by, and no making code from text. Only text crosses the line, and every call is stopped after a moment (`training/support/sandbox-runner.mjs`). Node's permissions do not themselves stop the network, which is why the code is given no way to reach the process. It needs Node 20 or later |
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
