# Your own questions

One file for each body of work the Swarm is trained on (`training/equivalence.json`): `crew.json`, `code.json`,
`math.json`, `logic.json`, `reasoning.json`, `instructions.json`, `tools.json`, `search.json`. Each holds the questions a
person wrote for it, from the dashboard (its button under the models, in the row Your own questions) or by hand:

```json
{ "questions": [{ "ask": "Can you move my dentist appointment to Friday?", "mode": "simple" }] }
```

- `ask` is the message, as a person would send it. `mode` (The Crew only) is `simple` or `developer`: which seat it is sent to.
- Every second question is held back: the Swarm is measured on those and never trained on them. The rest are train questions.
- They are asked alongside the questions the trainer makes, and judged the same way as a reply in a conversation: the same act,
  the same substance, and no convention broken that the larger model's reply kept.
- They are an addition, never a choice: a pass asks every body of work whether or not it has questions of yours.
- A change is asked from the next pass on: a pass ends on the questions it began with.
