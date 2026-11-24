# Results

What the module scores, read with care. Every measurement, dated, is in [Measured, not claimed](measured.md); what has and
has not been run is in [Status and limits](status.md).

The module as configured (LFM2.5 1.2B in both places, the arrangement every swarm starts from, no adapters, no
instrument on) against Nemotron 3.5 Lightning 30B, 20 questions of each of 23 standard tasks, 2026-11-22. Percent right:

| Body of work | The module | The small model alone | The larger model |
| --- | --- | --- | --- |
| Code | 52.5 | 45.0 | 90.0 |
| Math | 72.5 | 22.5 | 82.5 |
| Logic | 45.0 | 4.0 | 88.0 |
| Reasoning | 43.3 | 0.8 | 76.7 |
| Instructions | 85.0 | 90.0 | 75.0 |
| Tools | 86.0 | 88.0 | 81.0 |
| Search | 10.0 | 0.0 | 30.0 |
| All 460 | 55.2 | 30.0 | 77.6 |

Read it with care:

- Twenty a task is a check. A verdict needs at least a hundred; only the two code benchmarks have been run at that
  size (95 of 200 as configured).
- Most of the module's lead over its own small model is its code, not its arrangement. On the 320 questions that are
  not tools or search: the small model asked plainly 15.6%, with the module's reply layout only 19.1%, a module of one
  slot (all of the module's code round one call) 41.9%, the whole module 51.2%, the larger model 82.5%. So the code is
  worth about 26 points and the arrangement of seven slots about 9 more, before any training.
- Training has not yet bettered the module on a benchmark. The first whole run read 50.7% and 49.6% after its two
  stages. Since then adapters are made for each drafting slot and tried by training like any other change; training
  kept a set of them for code on its own held questions (+29.6 points), and the code benchmarks at 100 questions each
  read 75 of 200 with them against 95 without. An adapter is now carried only on a request like what it was taught:
  training kept that for code too (+30.8 points), and the benchmarks read 92 of 200, and 247 of 460 on all 23 tasks
  against 254, both within error of as configured. The harm is gone; the gain is not there yet, because training's
  questions are not yet what the module is judged on ([Measured, not claimed](measured.md)).
- Search is the widest gap. A search is now a program of code that asks the module only to read: a made task of two
  chained facts went from 1 right of 30 to 30, but the live web test above, of three or four chained facts, did not
  improve.
- On 100 Instructions questions the small model alone has 75 right and the module 68. One slot asked plainly is now an
  arrangement training can keep for such requests (71 measured ahead of training).
- With every instrument on, four operation tasks read 20 of 20 where the small model alone had 0. The instruments were
  written after those tasks were read; they were then probed, with no model, on 104,520 questions by other authors and
  20,000 made at random, and answered none wrongly. Training keeps one only on wordings its trying never saw.

[Every measurement, dated](measured.md) · [What has and has not been run, and known limits](status.md)

