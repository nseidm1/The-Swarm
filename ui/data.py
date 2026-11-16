"""data.py - WHAT THE UI SHOWS, READ FROM THE REPOSITORY. Nothing here measures anything: it reads what the trainers wrote.

    src/briefs.json                  the arrangement: every slot, what it is told, the plan
    training/targets.json            the larger models to reach parity with
    training/state.json              the pass, the target being chased, the ideas waiting
    training/candidates/<slot>.json  what is being tried in place of a slot's brief
    .work/train/swarm-runs.jsonl     every question the swarm answered, with what each slot wrote
    .work/train/baseline-runs.jsonl  the same questions answered by one model alone (the target, each small model)

What is shown is PARITY: whether an answer is fundamentally equivalent to the larger model's, never whether it is right,
and never as a percentage: the swarm is at parity when every answer is equivalent.

Only the Python standard library is used.
"""

import json
import re
from pathlib import Path

STAGES = [("draft", "Draft"), ("check", "Check"), ("decide", "Decide"), ("write", "Write")]
MEMBER_NAMES = {"a": "LFM2.5 2.6B", "b": "Bonsai 2 2B"}
SERVING = {"slots": 4, "contextPerSlot": 4096}  # src/catalog.mjs SERVING


def _json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _rows(path):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


_NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def same_answer(said, want):
    """Is what a slot settled on the same answer as `want` (the larger model's)? A number is compared as a number, a word as a word."""
    said = str(said or "").strip().lower()
    want_s = str(want).strip().lower()
    if not said:
        return False
    try:
        w = float(want_s.replace(",", ""))
        nums = [float(n.replace(",", "")) for n in _NUM.findall(said)]
        return bool(nums) and abs(nums[-1] - w) < 1e-6 * max(1.0, abs(w))
    except ValueError:
        clean = re.sub(r"[^a-z0-9]+", " ", said).strip()
        return clean == want_s or want_s in clean.split()


def parity(rows):
    """The same rule as training/state.mjs parity(). PARITY IS EQUIVALENCE, NOT A SHARE: at parity when every answer is
    fundamentally equivalent to the larger model's. Rows are marked against the larger model already: right = equivalent,
    wrong = a different answer, unsure = none, noref = the larger model gave none (not counted). None when nothing to compare."""
    out = {"equivalent": 0, "differ": 0, "none": 0}
    for r in rows:
        g = r.get("grade")
        if g == "right":
            out["equivalent"] += 1
        elif g == "wrong":
            out["differ"] += 1
        elif g == "unsure":
            out["none"] += 1
    out["compared"] = out["equivalent"] + out["differ"] + out["none"]
    if not out["compared"]:
        return None
    out["level"] = out["equivalent"] == out["compared"]
    out["seconds"] = round(sum(r.get("seconds", 0) for r in rows) / len(rows), 1) if rows else 0
    return out


def load(root):
    root = Path(root)
    briefs = _json(root / "src" / "briefs.json", {"slots": [], "plan": {}, "version": 0})
    state = _json(root / "training" / "state.json", {})
    # the swarm as it is configured: which models, out of the ones that can be chosen (src/models.json, src/config.json)
    registry = _json(root / "src" / "models.json", {"small": [], "deciders": [], "targets": [], "engine": {}})
    chosen = _json(root / "src" / "config.json", {})
    pick = lambda lst, i, n=0: next((m for m in lst if m.get("id") == i), lst[n] if len(lst) > n else None)  # noqa: E731
    members = {"a": pick(registry["small"], chosen.get("a")), "b": pick(registry["small"], chosen.get("b"), 1)}
    decider = pick(registry["deciders"], chosen.get("decider"))
    target = pick(registry["targets"], chosen.get("target"))
    targets = sorted(registry["targets"], key=lambda t: t.get("params", 0))
    global MEMBER_NAMES
    MEMBER_NAMES = {k: (m or {}).get("name", "not chosen") for k, m in members.items()}
    cfg = "+".join([(members["a"] or {}).get("id", ""), (members["b"] or {}).get("id", ""), (decider or {}).get("id", "")])
    # what this configuration remembers of its training (training/state.mjs): the folder's record of what was read, and over
    # it this configuration's own (which pass, the seeds, what was tried, how each pass ended, what became of each idea here)
    mine = _json(root / "training" / "states" / ("%s--%s.json" % (re.sub(r"[^\w.+-]+", "_", cfg), re.sub(r"[^\w.+-]+", "_", str((target or {}).get("id", ""))))), None)
    if isinstance(mine, dict):
        became = mine.get("ideaStatus")
        state = {**state, **{k: v for k, v in mine.items() if k not in ("questions", "seen", "ideas", "ideaStatus")}}
        if isinstance(became, dict):
            state["ideas"] = [dict(i, status=became.get(i.get("hash"), "open")) for i in state.get("ideas", [])]
    state["ideas"] = [dict(i, status=i.get("status", "open")) for i in state.get("ideas", [])]
    seeds = state.get("seeds", {})
    # WHAT THIS CONFIGURATION HAS LEARNED against this larger model (src/learned.mjs): the arrangement as it now stands, every
    # change that was kept with its evidence, and where it stood at the end of each pass. With none, it runs briefs.json.
    safe = lambda x: re.sub(r"[^\w.+-]+", "_", str(x))  # noqa: E731
    learned = _json(root / "src" / "learned" / ("%s--%s.json" % (safe(cfg), safe((target or {}).get("id", "")))), None)
    if not (isinstance(learned, dict) and isinstance(learned.get("briefs"), dict) and learned["briefs"].get("slots")):
        learned = None
    started_from = briefs
    if learned:
        briefs = learned["briefs"]

    def newest(rows, split, label):
        """the newest answer to each question of this pass's split, by one answerer"""
        seen = {}
        for r in rows:
            if r.get("split") != split or r.get("label") != label:
                continue
            if seeds.get(split) is not None and r.get("seed") not in (None, seeds.get(split)):
                continue
            seen[r["id"]] = r
        return list(seen.values())

    swarm_all = _rows(root / ".work" / "train" / "swarm-runs.jsonl")
    base_all = _rows(root / ".work" / "train" / "baseline-runs.jsonl")
    # ANSWERS AS THEY ARE WRITTEN. A trainer writes every answer down the moment it has it (its checkpoint) and files them with
    # the rest only when its step ends, which for the swarm is many minutes later. So the answers of the step in hand are read
    # from its checkpoint: the page shows a measurement as it is made, not when it is over. (A candidate being tried is not the
    # swarm as it stands: its checkpoint is named try-, and is left out.)
    cks = root / ".work" / "train" / "checkpoints"
    if cks.is_dir():
        for f in sorted(cks.glob("*.jsonl"), key=lambda p: p.stat().st_mtime):
            name = f.name[: -len(".jsonl")]
            if name.startswith("try-"):
                continue
            if name.startswith("measure-"):
                swarm_all += [dict(r, label="swarm") for r in _rows(f)]
            else:
                m = re.match(r"^(.*)-(?:held|train)-[^-]*$", name)
                if m:
                    base_all += [dict(r, label=m.group(1)) for r in _rows(f)]
    splits = {}
    for split in ("held", "train"):
        # the swarm's rows for THIS configuration against THIS target: another arrangement's are never read as this one's
        swarm = [r for r in newest(swarm_all, split, "swarm") if r.get("cfg") in (None, cfg) and r.get("target") in (None, (target or {}).get("id"))]
        tgt = newest(base_all, split, target["id"]) if target else []
        splits[split] = {
            "swarm": swarm,
            "target": {r["id"]: r for r in tgt},
            "alone": {k: newest(base_all, split, "%s-alone-vs-%s" % ((m or {}).get("id"), (target or {}).get("id"))) or newest(base_all, split, k + "-alone") for k, m in members.items()},
            "parity": parity(swarm) if swarm else None,
            # how many questions there are to answer (the larger model answers them all first): fewer answers than this is a
            # measurement still being made
            "expected": len(tgt) or None,
        }
    # each slot's own record on the train questions (what the trainers work from), else on the held ones
    record = {}
    src = splits["train"]["swarm"] or splits["held"]["swarm"]
    for r in src:
        for s in r.get("trace", []):
            o = record.setdefault(s["slot"], {"ran": 0, "right": 0, "ms": 0})
            o["ran"] += 1
            o["ms"] += s.get("ms", 0)
            if s.get("stage") == "write":
                o["right"] += 1 if r.get("grade") == "right" else 0
            elif r.get("ref") and same_answer(s.get("final"), r.get("ref")):
                o["right"] += 1
    candidates = {}
    tried = state.get("tried", {})
    for s in briefs.get("slots", []):
        cands = _json(root / "training" / "candidates" / (s["id"] + ".json"), [])
        if cands:
            candidates[s["id"]] = cands
    # what the passes have changed so far: briefs kept, arrangements tried and kept
    kept_briefs = {}
    for r in _rows(root / "training" / "results" / "briefs-history.jsonl"):
        if r.get("kept"):
            kept_briefs[r.get("slot")] = kept_briefs.get(r.get("slot"), 0) + 1
    arr = _rows(root / "training" / "results" / "arrangement-history.jsonl")
    trained = {
        "keptBriefs": kept_briefs,
        "arrTried": len(tried.get("_arrangement", [])) + sum(1 for r in arr if r.get("kept")),
        "arrKept": [r.get("name") for r in arr if r.get("kept")],
    }
    return {
        "root": str(root),
        "trained": trained,
        "sample": (root / ".sample").exists(),
        "briefs": briefs,
        "learned": {"ledger": (learned or {}).get("ledger") or [], "passes": (learned or {}).get("passes") or [], "startedFrom": started_from.get("version")},
        "state": state,
        "targets": targets,
        "target": target,
        "registry": registry,
        "members": members,
        "decider": decider,
        "cfg": cfg,
        "splits": splits,
        "record": record,
        "candidates": candidates,
        "tried": tried,
    }


def spec(d):
    """THE OUTPUT SPEC: what the swarm, as it is configured and trained now, IS: what it is made of, how it is arranged, what
    goes in and comes out, and where it stands against the larger model. One document that says the whole of it."""
    b, p = d["briefs"], d["splits"]["held"]["parity"]
    gb = lambda n: round(n / 2**30, 2)  # noqa: E731
    file_of = lambda m: {k: m.get(k) for k in ("id", "name", "by", "params", "license", "repo", "rev", "file", "bytes", "sha256", "serve", "sampling") if m.get(k) not in (None, [], {})}  # noqa: E731
    a, bb = d["members"]["a"] or {}, d["members"]["b"] or {}
    held = d["splits"]["held"]["swarm"]
    last = (d["state"].get("history") or [None])[-1]
    return {
        "name": "The Swarm",
        "id": "swarm-%s+%s" % (a.get("id"), bb.get("id")),
        "what": "Two small models that answer as one, trained toward parity with a larger model: an answer fundamentally equivalent to the one the larger model gives.",
        "interface": {
            "in": "messages, as a chat model takes them (role and content)",
            "out": "one reply",
            "as": ["createSwarm().answer(messages)", "an address that answers /health, /v1/models and /v1/chat/completions (streamed or not)", "serveSwarm(entry, engine, opts): the call a llama.cpp model is started with"],
            "notYet": ["a request that carries tools goes to the model in place a alone", "the reply is whole before any of it is sent"],
        },
        "members": {"a": file_of(a), "b": file_of(bb)},
        "decider": {k: (d["decider"] or {}).get(k) for k in ("id", "name", "by", "params", "run", "rev", "license")},
        "engine": {"name": d["registry"]["engine"].get("name"), "version": d["registry"]["engine"].get("version"), "build": d["registry"]["engine"].get("tag")},
        "serving": dict(SERVING, memoryGbEstimate=round((gb(a.get("bytes", 0)) + gb(bb.get("bytes", 0))) * 1.25 + 1, 1), memoryIs="an estimate: the two files and their contexts; the decider is beside it"),
        "arrangement": {
            "briefsVersion": b.get("version"),
            "plan": b.get("plan", {}),
            "flow": b.get("flow") or [{"do": k} for k in ("draft", "try", "check", "decide", "write")],
            "flowIs": "the one this swarm has learned" if b.get("flow") else "the plain one every swarm starts from",
            "slots": [{k: s.get(k) for k in ("id", "member", "stage", "purpose", "maxTokens", "temperature", "sees") if s.get(k) is not None} | {"model": (d["members"].get(s["member"]) or {}).get("id")} for s in b.get("slots", [])],
        },
        # WHAT IT HAS LEARNED: every change that was kept, in order, with the evidence it was kept on. Nothing is here that was
        # not measured. The arrangement above is the one these changes made.
        "learned": {
            "changesKept": len(d["learned"]["ledger"]),
            "rule": "a change is kept only if the swarm then gives more answers equivalent to the larger model's on the questions it was chosen on, and no fewer on the held ones",
            "ledger": d["learned"]["ledger"],
            "passes": d["learned"]["passes"],
        },
        "trainedAgainst": {
            "target": {k: (d["target"] or {}).get(k) for k in ("id", "name", "by", "params", "engine")},
            "parityMeans": "every answer to the held questions is fundamentally equivalent to the target's: a function that returns the same for every input, the same value, or (in words) the same thing said. Not a percentage, and not correctness.",
            "state": ("at parity" if p["level"] else "not at parity") if p else "not measured",
            "heldQuestions": p["compared"] if p else 0,
            "equivalent": p["equivalent"] if p else None,
            "different": p["differ"] if p else None,
            "noAnswer": p["none"] if p else None,
            "byKind": {k: {"equivalent": sum(1 for r in held if r["kind"] == k and r.get("grade") == "right"), "of": sum(1 for r in held if r["kind"] == k and r.get("grade") != "noref")} for k in dict.fromkeys(r["kind"] for r in held)},
            "passes": d["state"].get("pass", 0),
            "lastPass": {k: last.get(k) for k in ("pass", "at", "target", "level", "equivalent", "compared")} if last else None,
            "questions": {"kinds": sorted(set(r["kind"] for r in held)), "heldSeed": d["state"].get("seeds", {}).get("held")},
        },
    }
