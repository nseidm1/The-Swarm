#!/usr/bin/env python3
"""sample.py - MADE-UP DATA, TO SEE THE PAGE BEFORE A PASS HAS RUN. Writes a folder shaped like the repository, with a few
questions and invented answers from the swarm, its slots and the larger model (whose answer is the mark, and is sometimes not
the answer the question was made with: parity is what is shown, not correctness). The folder is marked (.sample), and the page says
at its top that what it shows is made up. Nothing here is a measurement, and nothing here is read by a trainer.

    python3 ui/sample.py /tmp/swarm-sample
    python3 ui/swarm_ui.py --root /tmp/swarm-sample
"""

import json
import random
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
QUESTIONS = [
    ("trap", "A notebook and a pen cost 110 cents together. The notebook costs 100 cents more than the pen. How many cents does the pen cost?", 5, 10),
    ("trap", "12 machines take 12 minutes to make 12 parts. How many minutes do 100 machines take to make 100 parts?", 12, 100),
    ("chain", "Start with 34. Multiply it by 6. Subtract 57. Multiply the result by 3. Add 12. What number do you have?", 453, 441),
    ("chain", "Start with 18. Multiply it by 7. Subtract 40. Multiply the result by 2. Add 9. What number do you have?", 181, 172),
    ("day", "Today is Thursday. What day of the week will it be 100 days from now?", "Saturday", "Friday"),
    ("day", "Today is Monday. What day of the week will it be 45 days from now?", "Thursday", "Wednesday"),
    ("rate", "One pump fills a tank in 3 hours. A second pump fills the same tank in 6 hours. Running both together, how many minutes does it take to fill the tank?", 120, 270),
    ("letters", 'How many times does the letter "r" appear in the word "strawberry"?', 3, 2),
    ("order", "Ada is taller than Ben. Cleo is shorter than Ben. Dev is taller than Ada. Who is the second tallest?", "Ada", "Ben"),
    ("units", "A cyclist rides 36 kilometres in 45 minutes at a steady speed. What is the speed in kilometres per hour?", 48, 27),
    ("count", "How many whole numbers from 5 to 40, counting both ends, can be divided by 6 with nothing left over?", 6, 7),
    ("trace", "What does this print?\n\nlet x = 2;\nfor (let i = 1; i <= 5; i++) {\n  if (i % 2 === 0) x = x - i;\n  else x = x + i * 2;\n}\nconsole.log(x);", 14, 20),
]


def main(dest, config=None):
    dest = Path(dest)
    if dest.exists() and not (dest / ".sample").exists() and any(dest.iterdir()):
        sys.exit("%s exists and is not a sample folder: not written to." % dest)
    for sub in ("src", "training/candidates", ".work/train"):
        (dest / sub).mkdir(parents=True, exist_ok=True)
    (dest / ".sample").write_text("made-up data: see ui/sample.py\n")
    shutil.copy(HERE / "src" / "briefs.json", dest / "src" / "briefs.json")
    shutil.copy(HERE / "training" / "policy.json", dest / "training" / "policy.json")
    shutil.copy(HERE / "src" / "models.json", dest / "src" / "models.json")
    # the swarm the made-up data is of: the one configured here, or one given (the checks give their own, so that what a person has
    # chosen on this machine cannot change what they check)
    if config:
        (dest / "src" / "config.json").write_text(json.dumps(config, indent=2) + "\n")
    else:
        shutil.copy(HERE / "src" / "config.json", dest / "src" / "config.json")
    for f in (HERE / "training" / "candidates").glob("*.json"):
        shutil.copy(f, dest / "training" / "candidates" / f.name)
    # (training/state.json holds only what was read once a real pass has run: the rest is given here, as a pass begins with it)
    state = {"pass": 0, "target": "", "seeds": {"train": 1009, "held": 7919}, "focus": {}, "tried": {}, "order": [], "questions": [], "seen": [], "ideas": [], "history": [],
             **json.loads((HERE / "training" / "state.json").read_text())}
    briefs = json.loads((HERE / "src" / "briefs.json").read_text())
    chosen = json.loads((dest / "src" / "config.json").read_text())
    target = chosen["target"]
    # (every small model in its place, as src/catalog.mjs names a configuration: a third or fourth is part of the name)
    cfg = "+".join([chosen[k] for k in ("a", "b", "c", "d") if chosen.get(k)] + [chosen["decider"]])
    rnd = random.Random(7)
    swarm, base = [], []
    for split in ("held", "train"):
        seed = state["seeds"][split]
        for i, (kind, ask, want, slip) in enumerate(QUESTIONS if split == "held" else QUESTIONS[:6]):
            qid = "%s-%s-%s-%d" % (split, seed, kind, i + 1)
            # the larger model's answer is the mark, whether or not it is the answer the question was made with
            ref = want if rnd.random() < 0.8 else slip
            alt = slip if ref == want else want
            common = {"id": qid, "kind": kind, "split": split, "seed": seed, "ask": ask, "ref": str(ref)}
            trace, finals = [], []
            for s in briefs["slots"]:
                if s["stage"] != "draft":
                    continue
                ok = rnd.random() < (0.45 if "direct" in s["id"] else 0.7)
                fin = ref if ok else alt
                finals.append(fin)
                trace.append({"slot": s["id"], "member": s["member"], "stage": "draft", "ms": rnd.randint(900, 4200), "ok": True, "final": str(fin),
                              "out": ("The question asks for one value.\nWorking it through gives %s.\nANSWER: %s" % (fin, fin))})
            agreed = len(set(map(str, finals))) == 1
            decided = finals[0]
            path = "agreed"
            if not agreed:
                for s in briefs["slots"]:
                    if s["stage"] == "check":
                        fin = ref if rnd.random() < 0.75 else alt
                        finals.append(fin)
                        trace.append({"slot": s["id"], "member": s["member"], "stage": "check", "ms": rnd.randint(1500, 5200), "ok": True, "final": str(fin),
                                      "out": "A: checked against the question.\nB: the second step does not follow.\nANSWER: %s" % fin})
                decided = ref if rnd.random() < 0.8 else alt
                most = max(set(map(str, finals)), key=list(map(str, finals)).count)
                others = sorted(set(map(str, finals)))
                letters = "ABCDEFGH"[: len(others)]
                top = round(rnd.uniform(0.55, 0.93), 2)
                probs = {l: (top if others[i] == str(decided) else round((1 - top) / max(1, len(others) - 1), 2)) for i, l in enumerate(letters)}
                path = "decided" if str(decided) == most else "decided-against-most"
                trace.append({"slot": "kev-decide", "member": "kev", "stage": "decide", "ms": rnd.randint(130, 420), "ok": True, "final": str(decided),
                              "out": "Picked %s." % (letters[others.index(str(decided))] if str(decided) in others else "A"), "probs": probs})
            writer = next(s for s in briefs["slots"] if s["stage"] == "write")
            reply = "%s. Worked through step by step and checked against the question." % decided
            trace.append({"slot": writer["id"], "member": writer["member"], "stage": "write", "ms": rnd.randint(900, 2400), "ok": True, "final": "", "out": reply})
            swarm.append({"label": "swarm", "cfg": cfg, "target": target, "briefs": briefs["version"], **common, "grade": "right" if decided == ref else "wrong",
                          "seconds": round(sum(t["ms"] for t in trace) / 2500, 1), "reply": reply, "decided": str(decided), "path": path, "trace": trace})
            base.append({"label": target, **common, "grade": "right", "seconds": round(rnd.uniform(1.5, 6.0), 1), "reply": "Working through it, the answer is %s." % ref})
            for label, p in (("%s-alone-vs-%s" % (chosen["a"], target), 0.5), ("%s-alone-vs-%s" % (chosen["b"], target), 0.42)):
                roll = rnd.random()
                grade = "right" if roll < p else "unsure" if roll > 0.95 else "wrong"
                base.append({"label": label, **common, "grade": grade, "seconds": round(rnd.uniform(1.5, 6.0), 1),
                             "reply": "I am not certain of this one." if grade == "unsure" else "Working through it, the answer is %s." % (ref if grade == "right" else alt)})
    (dest / ".work" / "train" / "swarm-runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in swarm))
    (dest / ".work" / "train" / "baseline-runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in base))
    state["history"] = [
        {"pass": i + 1, "at": "2026-11-%02d" % (10 + i), "target": target, "level": False, "compared": 12, "equivalent": n, "differ": 12 - n, "none": 0}
        for i, n in enumerate([5, 6, 8, 9])
    ]
    state["pass"] = 4
    # a made-up plan for the pass in hand, partway through, so that the plan can be seen as it reads while a pass runs
    plan = {
        "pass": 5, "at": "2026-11-14T09:00:00Z", "basedOn": "this-pass", "measured": {"compared": 24, "equivalent": 17, "differ": 6, "none": 1},
        "findings": [
            {"id": "drafts-short", "stage": "draft", "answers": 4, "text": "On 4 questions no slot had the larger model's answer. Checking and deciding cannot find what no draft wrote: the drafts are the limit."},
            {"id": "decider-threw:kev-decide", "stage": "decide", "slot": "kev-decide", "answers": 2, "text": "The decider had the larger model's answer on the table 9 times and chose another 2 times."},
            {"id": "check-worse:a-critic", "stage": "check", "slot": "a-critic", "answers": 1, "text": "a-critic had the larger model's answer 15 times of 24: less often than the best draft it was checking. It is turning answers away from the mark."},
        ],
        "focus": [{"kind": "fix", "more": 4}, {"kind": "bug", "more": 2}],
        "moves": [
            {"order": 1, "kind": "brief", "slot": "a-steps", "stage": "draft", "model": "LFM2.5 2.6B", "technique": "What the slot is told", "what": "a checkable statement after every step", "from": "2609.14412",
             "answers": 4, "why": ["drafts-short"], "status": "kept", "result": {"now": {"right": 17, "wrong": 6}, "train": {"right": 19, "wrong": 4}, "why": "higher on train, not lower on held"}},
            {"order": 2, "kind": "plan", "slot": "a-critic", "stage": "check", "model": "LFM2.5 2.6B", "technique": "A change to the plan", "what": "one worked answer for each different answer", "from": "2610.21290",
             "answers": 3, "why": ["decider-threw:kev-decide", "check-worse:a-critic"], "status": "not kept", "result": {"now": {"right": 19, "wrong": 4}, "train": {"right": 18, "wrong": 5}, "why": "not higher on the train questions"}},
            {"order": 3, "kind": "arrangement", "technique": "One more voice", "what": "add a second b-direct on a", "hash": "s1", "answers": 4, "why": ["drafts-short"], "status": "running"},
            {"order": 4, "kind": "arrangement", "technique": "What a checker is shown", "what": "a-critic sees only the answers", "hash": "s2", "answers": 2, "why": ["check-worse:a-critic", "decider-threw:kev-decide"], "status": "planned"},
            {"order": 5, "kind": "arrangement", "technique": "The other model in this role", "what": "move b-recompute to a", "hash": "s3", "answers": 0, "why": [], "status": "planned"},
        ],
        "open": {"arrangements": 23, "arrangementsTried": 5},
    }
    (dest / ".work" / "train" / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    # what this made-up swarm has "learned": two changes kept by earlier passes, with made-up evidence, and where each pass left it
    reg = json.loads((dest / "src" / "models.json").read_text())
    cho = json.loads((dest / "src" / "config.json").read_text())
    cfg = "+".join([cho.get("a") or reg["small"][0]["id"], cho.get("b") or reg["small"][1]["id"]] + [cho[k] for k in ("c", "d") if cho.get(k)] + [cho.get("decider") or reg["deciders"][0]["id"]])
    briefs = json.loads((dest / "src" / "briefs.json").read_text())
    learned = {
        "config": cfg, "target": target, "briefs": dict(briefs, version=3, flow=[{"do": "draft"}, {"do": "try"}, {"do": "check"}, {"do": "revise"}, {"do": "decide"}, {"do": "write"}]),
        "ledger": [
            {"n": 1, "at": "2026-11-11T10:00:00.000Z", "pass": 2, "kind": "brief", "slot": "b-direct", "what": "the shortest brief that still asks for a test", "from": "2603.16045",
             "why": "higher on train, not lower on held", "train": {"before": {"right": 13, "wrong": 10}, "after": {"right": 15, "wrong": 8}}, "held": {"before": {"right": 6, "wrong": 6}, "after": {"right": 7, "wrong": 5}}},
            {"n": 2, "at": "2026-11-12T10:00:00.000Z", "pass": 3, "kind": "flow", "what": "the answers go back to the drafters after the check",
             "why": "higher on train, not lower on held", "train": {"before": {"right": 15, "wrong": 8}, "after": {"right": 17, "wrong": 6}}, "held": {"before": {"right": 8, "wrong": 4}, "after": {"right": 9, "wrong": 3}}},
        ],
        "passes": [{"pass": i + 1, "at": "2026-11-%02d" % (10 + i), "equivalent": n, "compared": 12, "level": False} for i, n in enumerate([5, 6, 8, 9])],
    }
    (dest / "src" / "learned").mkdir(parents=True, exist_ok=True)
    (dest / "src" / "learned" / ("%s--%s.json" % (cfg, target))).write_text(json.dumps(learned, indent=2) + "\n")
    (dest / "training" / "state.json").write_text(json.dumps(state, indent=2) + "\n")
    print("Made-up data written to %s. Show it with: python3 ui/swarm_ui.py --root %s" % (dest, dest))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/swarm-sample")
