# SoRA training: what is learned, scoped to what it was learned on

Part of SoRA ([sora.md](sora.md)): a SoRA spec tunes a swarm module toward parity with a target model, as an established
harness measures it. This is how SoRA training keeps what it learns on one class of input from changing the module's behaviour
on every other class.

Status: design, 2026-11-18. Steps 1 and 2 are built (classes, migration, coverage gate); 3 to 6 are not.

## The question

SoRA training finds changes to the arrangement (what each slot is told, the plan, the flow) that bring a configuration's answers to
parity with the larger model, measured against the spec questions. The swarm is consumed as one module: messages in, one reply
out, under lm-evaluation-harness today and under any caller later. **Does what training learned carry into how that module
behaves on input it was not trained on?**

At the moment, it carries in, but not in a form that helps.

## What happens now

The learned file is the module. `readBriefs()` (`src/index.mjs`) loads `src/learned/<config>--<target>.json` whenever it exists,
and `createSwarm()`, the server, `training/evaluate.mjs` and any swarm made from an output spec (`src/spec.mjs`) all run it. The
evaluation of 2026-11-18 shows this: the briefs hash moved from `ec64be3d1240` (the default arrangement, 03:39Z) to
`e220fdcb4051` (the trained one, 05:58Z).

What it carries in, for `bonsai2-2b+lfm3-1.7b+jan-code-4b+kev-0.8b` against Nemotron 3.5 30B:

1. **One arrangement for every input.** An arrangement may already differ by kind: `kindOf()` in `src/orchestrate.mjs` tells
   `code` from `words`, and `briefsFor()` swaps in `briefs.kinds[kind]` where there is one. But training keeps a change for its
   own kind only when it loses a question of the OTHER kind (`kindBranch`, `training/loop.mjs`). In this run 42 of the questions
   asked in words (every bug, answer, request, piece, talk, practice and shown question) were graded `noref` (the reader,
   kev-0.8b, failed its check), so they could not be lost, and every change was kept in the SHARED arrangement. Now every IFEval essay is drafted by `c-other-way`, which is told: *"Test the function with negative
   inputs. For negative numbers, 'half up' means..."*.
2. **A change is kept on one question.** Each of the 9 kept changes brought ONE training question to parity, and the 6 questions
   already at parity checked against it (`guardOf()`) stayed there. None was asked on a held question. A brief written by the
   larger model to fix one question (its function names, its numbers, its rounding rule) passes that test as easily as a general
   one does.
3. **The proof is never written.** `passes` is empty: the pass never ended, so `endPass()` (`training/pass.mjs`) never measured
   held parity. What `src/learned.mjs` promises ("nothing is kept that did not do better on train and no worse on held") is not
   true of this file, and nothing tells a consumer so.
4. **Half the spec was never trained, silently.** With the reader not believed, words questions are `not compared`. Training
   ran on, and its summary does not say that a whole class of input had no training.
5. **Evaluation measures one class.** The Crew's only benchmark is IFEval (words), on 20 questions (±0.10). It cannot show what
   training did to code, and cannot reliably show anything at that size.

## What we want

- What training learns on one class of input changes the swarm's behaviour on that class only, until it is shown to help
  elsewhere.
- A change is kept on evidence that it generalizes, not only on the question it fixed.
- The learned file and the output spec say what was proven, on what, and how well, by class. A consumer can read it; an
  unproven arrangement is never presented as a proven one.
- No class of input is left untrained without that being said and stopping the pass.
- Evaluation reports by class, at a size that can show a change.

Out of scope: adapters (LoRA), the choice of models, the decider's own training.

## The design

### 1. Classes the swarm can tell at run time

Training and the running swarm must sort an input into the same class, and the running swarm has only the messages. So the
class is decided deterministically from the request, with no model call, extending `kindOf()`:

| Class | Decided by | Spec kinds that land here |
|---|---|---|
| `tools` | the request offers tools | agent (its steps are sent with tools) |
| `talk` | the conversation already has an assistant turn | none of the spec kinds today: talk and practice send one turn |
| `code` | `asksForCode(question)` (`src/read.mjs`) | write-arrays, write-strings, write-numbers, write-parsing, fix |
| `words` | anything else | bug, trace, answer, request, piece, talk, practice, shown; IFEval |

(The kinds column is `training/migrate-classes.mjs` sorting each kind's questions with `classOf`, as made by `training/tasks.mjs`.
The training record of 2026-11-18 said `words` for agent only because the old sort read the text alone.)

Training already sorts a question by running `kindOf` on its last user turn (`kindOfT`), so extending `kindOf` moves both sides
together. A finer split (by spec kind) is not possible at run time and is not proposed. Routing by the decider ("what kind of
request is this?") is a later option, only if the deterministic classes prove too coarse.

### 2. Scoped by default, shared only when shown

Reverse the default. A change found on a question of class C is kept in `briefs.kinds[C]` (made on first use as a copy of the
shared arrangement's `slots`, `plan`, `flow`). The shared arrangement is then what every class with no arrangement of its own
runs: for now, the starting one (`briefs.json`, filled for the configured places by `withPlaces()`).

A scoped change is **promoted** to the shared arrangement only when it is asked on the held questions of every class that would
newly run it, and it loses none there and brings at least one to parity. Promotion is one more kept change, with its own ledger
entry. `fold()` and `shares()` in `training/loop.mjs` already understand per-kind arrangements; what changes is when a kind gets
one (always, not only on a conflict) and the new promotion step.

### 3. Kept only on evidence that generalizes

Two checks are added before a change is kept, both after the existing guard passes:

- **Held guard.** The change is asked on up to N held questions of the same class (N = 4 to start, a policy value), chosen in
  the order of the held set, as the train guard does now. It is kept only if none of them that was at parity is lost. Held
  answers are not used to FIND changes, only to accept them, so the held set stays a measurement. Cost: N more asks per kept
  change, not per try.
- **Specificity check.** A brief may not carry what is particular to the question it was written on: identifiers from the
  question (function names, parameter names) and literal numbers or strings from it, beyond those that occur in the class's
  other questions. Deterministic: tokens from the question minus tokens common to the class, against the new brief text. A
  match is refused before it is asked, which also saves the try. `c-other-way`'s brief above would be refused (`-25`, `-20`,
  "half up" appear only in its question).

Both are recorded on the ledger entry (`heldGuard: { asked, kept, lost }`, `specific: false`), so the ledger states the
evidence it promises.

### 4. Coverage: no class goes untrained without stopping

At the start of a pass, once the reader check has run (`training/readers.mjs`), training counts, for each spec kind in the pass,
the questions that can be compared. If any kind has none (the reader not believed, no reference), the pass **stops before
training** and says which kinds, their class, and why. It is per kind and not per class on purpose: in this run the words class
still had its trace and agent questions compared, so a per-class rule would not have stopped it (for this run, something like: "words: 42 of its
questions cannot be compared, reader kev-0.8b not believed (15 of 20; paraphrases of conversations 2 of 7). Name a judge (src/config.json `judge`), or run with
`--skip-kinds bug,answer,...` to train without them"). The skip is a deliberate choice, recorded in the pass. The training summary gains
one line per class: asked, compared, at parity, reached, not compared.

### 5. Proof travels with the arrangement

- **Each class carries its own proof**, in the learned file: `proof: { [class]: { pass, at, held: { asked, equivalent },
  benchmarks: [...] } }`. A class's arrangement with no completed pass is **provisional**.
- **`endPass()` writes per class**, not one figure. A pass stopped part way through can be ended by hand
  (`node training/pass.mjs end`), which runs the held measurement for the classes that changed.
- **The running swarm uses only proven arrangements by default.** `readBriefs()` drops a provisional class's own arrangement
  (it runs the shared one) unless the caller opts in (`SWARM_PROVISIONAL=1`, or `{ provisional: true }`). Training and the
  page opt in; the server, evaluation and specs do not, unless asked.
- **The output spec** carries `proof` beside `recipe` (outside the recipe, so the recipe hash still names exactly the swarm),
  and `fromSpec()` reports a class without proof.

### 6. Evaluation by class, at a size that can show a change

- Each benchmark in `training/equivalence.json` names its class (IFEval: `words`; HumanEval and MBPP: `code`). The Crew should
  carry one code benchmark beside IFEval, since that is where training has done all its work.
- `evaluate.mjs` reports per class, and writes its result into that class's `proof.benchmarks`, with n, the harness version and
  the briefs hash.
- A recorded evaluation uses at least 100 questions per task. `--limit` below that still runs, marked `smoke`, and is never
  written into proof.
- Before/after is like for like: the evaluation can be asked with a given arrangement (`--briefs default|learned|<file>`), so
  the comparison does not depend on running at the right moment.

## Changes to the learned file

```
{
  config, target,
  briefs: {
    version, marker, slots, plan, flow, examples,   // shared: what an unscoped class runs
    kinds: { code: { slots, plan, flow }, words: {...}, talk: {...}, tools: {...} }   // only classes with kept changes
  },
  ledger: [ { n, at, pass, kind, what, slots, question, why,
              class, scope: "code" | "shared", heldGuard: { asked, kept, lost }, specific: false } ],
  passes: [ ... ],
  proof: { code: { pass, at, held, benchmarks: [ { task, n, swarm, target, agree, harness, briefs } ] }, words: {...} }
}
```

Files that change: `src/orchestrate.mjs` (classes), `src/index.mjs` (`readBriefs` and provisional), `src/learned.mjs` (proof,
migration), `training/loop.mjs` (scope by default, promotion, held guard, specificity), `training/loop-policy.mjs` (new policy
values), `training/readers.mjs` / pass start (coverage gate), `training/pass.mjs` (per-class `endPass`, `end` by hand),
`training/evaluate.mjs` and `training/equivalence.json` (classes, minimum n, `--briefs`), `src/spec.mjs` and the dashboard's
spec writer (`ui/data.py`: proof beside the recipe), `docs/architecture.md` and `training/TRAIN.md`.

## Migrating what exists

In this configuration's file, 8 of the 9 kept changes were found on code questions; the 9th (`a-direct` given a token limit
of 1100, on `trace-5`, a words question) is a generic setting. Each ledger entry names its question, so the migration can sort
them. The same is true of every learned file on this machine: the other three lineups kept 3, 3 and 2 changes, all on code. A one-time migration, written whole with the `.bak` kept as `src/learned.mjs` already does:

1. moves the shared `slots`, `plan`, `flow` into `kinds.<class>` for the class most kept changes were found on (`code` here),
2. resets the shared arrangement to the starting one for the configured places,
3. names, and does not carry, the changes found on another class (here change 7, the token limit, found on a words question):
   they are built into the same arrangement and cannot be taken apart without asking again, so training finds them again,
4. marks the moved arrangement provisional (no pass has ended).

Expected effect, stated now so it can be checked: the swarm's IFEval score returns to that of the default arrangement (0.65 on
the 20 of 2026-11-18), and code answers are unchanged while training opts in to provisional.

## Building it, in order

Each step lands on its own, with its own check.

1. **Classes and migration.** Extend `kindOf`; migrate. Check: an IFEval prompt is answered with the shared (default)
   arrangement's hash and a code prompt with `kinds.code`; a request with tools is `tools`; a second-turn message is `talk`.
2. **Coverage gate.** Check: with a reader that fails its check, the pass stops naming every kind with nothing to compare,
   even when other kinds of the same class are compared; with `--skip-kinds` it runs and the pass records the skip.
3. **Scope by default and promotion.** Check: a change kept on a code question changes only `kinds.code`; promotion happens
   only when held questions of every newly reached class hold.
4. **Held guard and specificity.** Check: a brief quoting its question's literals is refused before it is asked; a change that
   loses a held question at parity is not kept; both are on the ledger.
5. **Per-class proof and provisional.** Check: with no ended pass, the server runs the shared arrangement for code too; after
   `pass.mjs end`, `proof.code` is written and the server runs `kinds.code`.
6. **Evaluation by class.** Check: a run at `--limit 20` is marked `smoke` and not written into proof; a run at 100 writes
   `proof.<class>.benchmarks`; `--briefs default` and `--briefs learned` give their own hashes in one session.

Steps 1 and 2 are small and stop the damage on their own; 3 to 6 make training's results trustworthy outside training.

## Open questions

- **Held set size.** The guard needs held questions of each class; the spec has 6 a kind. Whether 4 a change is enough, and how
  much it slows a pass, is to be measured in step 4.
- **`talk` in a single request.** IFEval sends one user turn, so it is `words`. A consumer that sends a whole conversation each
  time is `talk` from the second turn. Whether those should share an arrangement is open until talk is trained at all.
- **`tools` has no training of its own** beyond the agent kind. Until it does, it runs the shared arrangement.
- **Promotion may rarely fire.** If arrangements stay per class for good, the shared one is just the default, which is
  acceptable: it is the safe behaviour for input no class covers.
