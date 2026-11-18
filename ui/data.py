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
import os
import platform
import re
import shutil
from pathlib import Path

STAGES = [("draft", "Draft"), ("check", "Check"), ("decide", "Decide"), ("write", "Write")]
MEMBER_NAMES = {"a": "LFM2.5 2.6B", "b": "Bonsai 2 2B"}
SERVING = {"slots": int(os.environ.get("SWARM_SLOTS") or 6), "contextPerSlot": 4096}  # src/catalog.mjs SERVING (six since 2026-11-16)
SERVED_NAME = "the-swarm"  # src/catalog.mjs SERVED_NAME: the one model an address of the swarm lists


def _json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _renamed(row):
    """A row written before the decide step had a name of its own: its `kev-decide` turns read as `decide`, by `decider`."""
    for t in (row.get("trace") or []) if isinstance(row, dict) else []:
        if isinstance(t, dict) and t.get("slot") == "kev-decide":
            t["slot"], t["member"] = "decide", "decider"
    return row


def _rows(path):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(_renamed(json.loads(line)))
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


def percent(equivalent, compared):
    """HOW FAR TOWARD PARITY, as one number, worked out in one place: the share of the answers that are equivalent, as a
    percentage, rounded down (100 only when every one is). The same rule as training/state.mjs percentOf."""
    return int(1000 * equivalent / compared) / 10 if compared else 0


def parity(rows):
    """The same rule as training/state.mjs parity(). PARITY IS EQUIVALENCE, NOT A SHARE: at parity when every answer is
    fundamentally equivalent to the larger model's. Rows are marked against the larger model already: right = equivalent,
    wrong = a different answer, unsure = none, noref = the larger model gave none (not counted). None when nothing to compare."""
    out = {"equivalent": 0, "differ": 0, "none": 0, "undecided": 0}
    for r in rows:
        g = r.get("grade")
        if g == "right":
            out["equivalent"] += 1
        elif g == "wrong":
            out["differ"] += 1
            # (of those, the ones the reader could not decide: graded different, counted apart; support/equivalent.mjs UNDECIDED)
            out["undecided"] += 1 if r.get("undecided") else 0
        elif g == "unsure":
            out["none"] += 1
    out["compared"] = out["equivalent"] + out["differ"] + out["none"]
    if not out["compared"]:
        return None
    out["level"] = out["equivalent"] == out["compared"]
    # progress toward parity, as a percentage; rounded down, so that 100 is said only at parity
    out["percent"] = percent(out["equivalent"], out["compared"])
    # the same count where the larger model's own answer does what the question says (training/tasks.mjs: toSpec)
    spec = [r for r in rows if r.get("refToSpec") is True and r.get("grade") in ("right", "wrong", "unsure")]
    out["onSpec"] = {"compared": len(spec), "equivalent": sum(1 for r in spec if r.get("grade") == "right")}
    out["seconds"] = round(sum(r.get("seconds", 0) for r in rows) / len(rows), 1) if rows else 0
    return out


def _merge(a, b):
    out = dict(a)
    for k, v in (b or {}).items():
        out[k] = _merge(a[k], v) if isinstance(v, dict) and isinstance(a.get(k), dict) else v
    return out


def _with_places(briefs, places):
    """The same as src/index.mjs withPlaces: a third or fourth small model begins as two more drafters; slots on a place that is
    not filled are left out."""
    slots = [s for s in briefs.get("slots", []) if s.get("member") in places]
    drafters = [s for s in briefs.get("slots", []) if s.get("stage") == "draft"]
    for p in places:
        if any(s.get("member") == p for s in slots) or not drafters:
            continue
        like = [drafters[0]] + ([drafters[-1]] if drafters[-1] is not drafters[0] else [])
        at = max([i + 1 for i, x in enumerate(slots) if x.get("stage") == "draft"] or [0])
        for s in like:
            slots.insert(at, dict(s, id=p + "-" + re.sub(r"^[a-z]-", "", s["id"]), member=p))
            at += 1
    return dict(briefs, slots=slots)


def machine():
    """What this machine can run a decider on, as the decider entries say it (runsOn): 'mac' (Apple silicon), 'cuda' (an NVIDIA GPU)."""
    out = []
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        out.append("mac")
    if shutil.which("nvidia-smi"):
        out.append("cuda")
    return out


def footprint(members, decider, target):
    """THE POINT OF THE SWARM, IN ONE NUMBER: the memory the swarm takes against the memory the larger model takes. Estimates, from
    what is on record: each small model's file with its contexts (the same estimate as src/catalog.mjs's entry: the files, a
    quarter more, and a gigabyte of context), the decider's listed size, and the larger model's listed size. None of it measured."""
    files = sum(((m or {}).get("bytes") or 0) for m in (members or {}).values()) / 2**30
    small = round(files * 1.25 + 1, 1) if files else None
    dec = (decider or {}).get("memGb")
    # (a larger model in parts is all of its parts)
    tbytes = ((target or {}).get("bytes") or 0) + sum((p or {}).get("bytes") or 0 for p in (target or {}).get("parts") or [])
    tgt = (target or {}).get("memGb") or (round(tbytes / 2**30 * 1.1, 1) if tbytes else None)
    if small is None or not tgt:
        return None
    swarm = round(small + (dec or 0), 1)
    # its parts, for a picture of it: each small model's file, the room for their contexts, and the decider
    parts = [{"name": (m or {}).get("name", k), "gb": round(((m or {}).get("bytes") or 0) / 2**30, 2), "kind": "model", "place": k} for k, m in (members or {}).items()]
    parts.append({"name": "Their contexts", "gb": round(small - sum(x["gb"] for x in parts), 2), "kind": "contexts"})
    if dec:
        parts.append({"name": (decider or {}).get("name", "The decider"), "gb": dec, "kind": "decider"})
    return {"small": small, "decider": dec, "swarm": swarm, "target": tgt, "share": round(100.0 * swarm / tgt, 1), "times": round(tgt / swarm, 1) if swarm else None,
            # (said as a saving: the share of the larger model's memory the swarm does not need, and how much that is)
            "saved": round(100.0 - 100.0 * swarm / tgt, 1), "savedGb": round(tgt - swarm, 1),
            "parts": parts, "targetName": (target or {}).get("name", "")}


def tools_of(setting, members):
    """Who takes an agent's turn: 'swarm', or the place of the one small model named (by its id, or its place). Where nothing is
    named, or the one named is no longer in the swarm, the model in place a (src/catalog.mjs toolsOf)."""
    places = [k for k in ("a", "b", "c", "d") if (members or {}).get(k)]
    if setting == "swarm":
        return "swarm"
    if setting in places:
        return setting
    by_id = next((k for k in places if members[k].get("id") == setting), None)
    return by_id or ("a" if "a" in places else (places[0] if places else "a"))


def session_evidence(rows, slots):
    """WHAT A MEASUREMENT SAYS ABOUT THE CONFIGURATION, AS IT IS MADE (the rows of the swarm on its questions, for one configuration):
      slots     each slot: answers, failures, how often it stopped at its token limit, its median time
      decider   decisions asked, failed, timed out, asked again
      traced    right answers whose winning drafts could be told apart (code, run on the same calls: the group that held the answer)
      members   each model: how often its drafts were in that group, and how often they were the only model in it
      pairs     two drafters on one model: how often they did the same
    Read as it arrives: a recommendation need not wait for a pass to end."""
    from itertools import combinations
    from statistics import median
    cap = {s["id"]: s.get("maxTokens") or 0 for s in slots}
    mem = {s["id"]: s["member"] for s in slots}
    sl, dec, members, pairs, traced = {}, {"n": 0, "failed": 0, "timedOut": 0, "retried": 0}, {}, {}, 0
    for r in rows:
        trace = r.get("trace") or []
        for t in trace:
            o = sl.setdefault(t.get("slot", "?"), {"n": 0, "failed": 0, "capped": 0, "ms": []})
            o["n"] += 1
            o["ms"].append(t.get("ms") or 0)
            if t.get("ok") is False:
                o["failed"] += 1
            if cap.get(t.get("slot")) and (t.get("tokens") or 0) >= cap[t["slot"]]:
                o["capped"] += 1
            if t.get("stage") == "decide":
                dec["n"] += 1
                if t.get("ok") is False:
                    dec["failed"] += 1
                    if t.get("timedOut") or re.search(r"timeout|aborted", str(t.get("out") or ""), re.I):
                        dec["timedOut"] += 1
                if t.get("retried"):
                    dec["retried"] += 1
        groups = (r.get("tried") or {}).get("groups")
        drafts = [t for t in trace if t.get("stage") == "draft" and t.get("letter")]
        if not groups or not drafts:
            continue
        gof = {l: i for i, g in enumerate(groups) for l in g}
        for a, b in combinations(drafts, 2):
            if mem.get(a["slot"]) and mem.get(a["slot"]) == mem.get(b["slot"]):
                p = pairs.setdefault("+".join(sorted((a["slot"], b["slot"]))), [0, 0])
                p[1] += 1
                p[0] += 1 if gof.get(a["letter"]) == gof.get(b["letter"]) else 0
        if r.get("grade") != "right":
            continue
        let = {t["letter"]: t for t in drafts}
        want = str(r.get("decided") or "").strip()
        win = next((g for g in groups if any(str(let[l].get("final") or "").strip() == want for l in g if l in let)), None)
        if not win:
            continue
        traced += 1
        who = {mem.get(let[l]["slot"]) for l in win if l in let} - {None}
        for m in who:
            members.setdefault(m, {"inwin": 0, "sole": 0})["inwin"] += 1
        if len(who) == 1:
            members[next(iter(who))]["sole"] += 1
    for o in sl.values():
        o["ms"] = int(median(o["ms"])) if o["ms"] else 0
    return {"answers": len(rows), "slots": sl, "decider": dec, "traced": traced, "members": members, "pairs": pairs}


def slot_record(rows):
    """EACH SLOT'S OWN RECORD from a measurement's rows: {slot: {ran, judged, right, ms}}."""
    record = {}
    for r in rows:
        for s in r.get("trace", []):
            # judged: the answers that WERE compared with the larger model's. An answer not compared is not a wrong one: code is
            # compared by running it (the trainer marks same), never as text, so code with no mark is left out, not counted as 0
            o = record.setdefault(s["slot"], {"ran": 0, "right": 0, "judged": 0, "ms": 0})
            o["ran"] += 1
            o["ms"] += s.get("ms", 0)
            ref = str(r.get("ref") or "")
            if s.get("stage") == "write":
                if r.get("grade") in ("right", "wrong"):
                    o["judged"] += 1
                    o["right"] += 1 if r.get("grade") == "right" else 0
            elif s.get("same") is not None:
                # the trainer marked this slot's own answer against the larger model's (for code: by running both)
                o["judged"] += 1
                o["right"] += 1 if s.get("same") else 0
            elif ref and "\n" not in ref.strip() and not re.search(r"\bfunction\b|=>|[{};]", ref):
                o["judged"] += 1
                o["right"] += 1 if same_answer(s.get("final"), ref) else 0
    return record


def load(root):
    root = Path(root)
    briefs = _json(root / "src" / "briefs.json", {"slots": [], "plan": {}, "version": 0})
    state = _json(root / "training" / "state.json", {})
    # the swarm as it is configured: which models, out of the ones that can be chosen (src/models.json, src/config.json)
    registry = _json(root / "src" / "models.json", {"small": [], "deciders": [], "targets": [], "engine": {}})
    chosen = _json(root / "src" / "config.json", {})
    # what the swarm is to be equivalent on: the ones that can be chosen (training/equivalence.json), and the ones that are
    equiv = _json(root / "training" / "equivalence.json", None) or _json(Path(__file__).resolve().parent.parent / "training" / "equivalence.json", {"default": [], "targets": []})
    known = [t["id"] for t in equiv.get("targets", [])]
    picked = [i for i in (chosen.get("equivalence") or []) if i in known] or [i for i in equiv.get("default", []) if i in known]
    # and the questions a person wrote for each (training/questions/<id>.json, edited from the page)
    for t in equiv.get("targets", []):
        own = _json(root / "training" / "questions" / (t["id"] + ".json"), {}) or {}
        t["own"] = [q for q in (own.get("questions") if isinstance(own.get("questions"), list) else []) if isinstance(q, dict) and str(q.get("ask") or "").strip()]
    pick = lambda lst, i, n=0: next((m for m in lst if m.get("id") == i), lst[n] if len(lst) > n else None)  # noqa: E731
    members = {"a": pick(registry["small"], chosen.get("a")), "b": pick(registry["small"], chosen.get("b"), 1)}
    # a third and a fourth small model, where they are named (no place is left empty between)
    for k in ("c", "d"):
        m = next((x for x in registry["small"] if x.get("id") == chosen.get(k)), None)
        if not m:
            break
        members[k] = m
    decider = pick(registry["deciders"], chosen.get("decider"))
    # the judge of equivalence, apart from the decider (src/catalog.mjs JUDGE): None where the decider reads equivalence itself
    judge = next((m for m in registry["deciders"] if chosen.get("judge") and m["id"] == chosen.get("judge") and m["id"] != (decider or {}).get("id")), None)
    target = pick(registry["targets"], chosen.get("target"))
    targets = sorted(registry["targets"], key=lambda t: t.get("params", 0))
    global MEMBER_NAMES
    MEMBER_NAMES = {k: (m or {}).get("name", "not chosen") for k, m in members.items()}
    cfg = "+".join([(m or {}).get("id", "") for m in members.values()] + [(decider or {}).get("id", "")])
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
    # what this configuration's training leaves is kept under its own name (training/support/bench.mjs); a folder from before
    # that has it in the one place, and is still read
    key = "%s--%s" % (re.sub(r"[^\w.+-]+", "_", cfg), re.sub(r"[^\w.+-]+", "_", str((target or {}).get("id", ""))))
    results = root / "training" / "results" / key
    if not results.is_dir():
        results = root / "training" / "results"
    # WHAT THIS CONFIGURATION HAS LEARNED against this larger model (src/learned.mjs): the arrangement as it now stands, every
    # change that was kept with its evidence, and where it stood at the end of each pass. With none, it runs briefs.json.
    safe = lambda x: re.sub(r"[^\w.+-]+", "_", str(x))  # noqa: E731
    learned = _json(root / "src" / "learned" / ("%s--%s.json" % (safe(cfg), safe((target or {}).get("id", "")))), None)
    if not (isinstance(learned, dict) and isinstance(learned.get("briefs"), dict) and learned["briefs"].get("slots")):
        learned = None
    started_from = briefs
    # EVERY WIN, CUMULATIVE (training/loop.mjs: .work/library/<configuration>-wins.jsonl, kept by Clear training state): each kept change
    # with the question it brought to parity, from every run of this configuration, oldest first; marked where the arrangement as it
    # stands now carries it (the current run's own record says so)
    wins = _rows(root / ".work" / "library" / ("%s--%s-wins.jsonl" % (safe(cfg), safe((target or {}).get("id", "")))))
    # (less what a move to classes did not carry: src/learned.mjs toClasses names them in migrated.dropped)
    dropped = set(((learned or {}).get("migrated") or {}).get("dropped") or []) | set(((learned or {}).get("discarded") or {}).get("entries") or [])
    now_keys = {(x.get("what"), (x.get("question") or {}).get("id")) for x in (learned or {}).get("ledger") or [] if x.get("n") not in dropped}
    wins = [dict(w, inArrangement=(w.get("what"), (w.get("question") or {}).get("id")) in now_keys) for w in sorted(wins, key=lambda w: w.get("at", ""))]
    if learned:
        briefs = learned["briefs"]
    else:
        briefs = _with_places(briefs, list(members))

    def newest(rows, split, label, keep=None):
        """the newest answer to each question of this pass's split, by one answerer. keep: which rows may be that answer at all,
        asked BEFORE the newest is chosen (another configuration's answer to the same question, read later, must not stand in
        for this one's and then be thrown away: found 2026-11-16, a configuration read as 40 of its 84 answers)"""
        seen = {}
        for r in rows:
            if r.get("split") != split or r.get("label") != label or (keep and not keep(r)):
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
        swarm = newest(swarm_all, split, "swarm", keep=lambda r: r.get("cfg") in (None, cfg) and r.get("target") in (None, (target or {}).get("id")))
        tgt = newest(base_all, split, target["id"]) if target else []
        splits[split] = {
            "swarm": swarm,
            "target": {r["id"]: r for r in tgt},
            "alone": {k: newest(base_all, split, "%s-alone-vs-%s" % ((m or {}).get("id"), (target or {}).get("id"))) or newest(base_all, split, k + "-alone") for k, m in members.items()},
            # THE LARGER MODEL AGAINST ITSELF (training/baseline.mjs --self): asked again, another draw, graded against its own first
            # answers by the same readers. How often it is equivalent to itself is the noise floor under parity
            "self": newest(base_all, split, "%s-self" % (target or {}).get("id")) if target else [],
            "parity": parity(swarm) if swarm else None,
            # how many questions there are to answer (the larger model answers them all first): fewer answers than this is a
            # measurement still being made
            "expected": len(tgt) or None,
        }
    # THE HELD QUESTIONS BY ARRANGEMENT: this configuration's answers, grouped by the briefs version they were given with and the
    # adapters the swarm was served with (training/measure.mjs writes both on each row), each group's newest answer to each
    # question. The SwOA spec compares the arrangement every swarm starts from with the one training made (spec: equivalence)
    held_by = {}
    for r in swarm_all:
        if r.get("split") != "held" or r.get("label") != "swarm" or r.get("cfg") not in (None, cfg) or r.get("target") not in (None, (target or {}).get("id")):
            continue
        if seeds.get("held") is not None and r.get("seed") not in (None, seeds.get("held")):
            continue
        hk = (r.get("briefs"), tuple(sorted(r.get("adapters") or [])))
        held_by.setdefault(hk, {})[r["id"]] = r
    held_by = [{"briefs": k[0], "adapters": list(k[1]), "parity": parity(list(v.values()))} for k, v in held_by.items() if v]
    # each slot's own record on the train questions (what the trainers work from), else on the held ones
    record = slot_record(splits["train"]["swarm"] or splits["held"]["swarm"])
    # the same rows, read for what they say about the configuration itself (ui/swarm_ui.py recommendations); and each other
    # configuration's decider record, from its own rows, to compare a changed decider with the one before it
    evidence = session_evidence(splits["train"]["swarm"] + splits["held"]["swarm"], briefs.get("slots", []))
    others = {}
    for r in swarm_all:
        if r.get("cfg") and r.get("cfg") != cfg and r.get("target") in (None, (target or {}).get("id")):
            o = others.setdefault(r["cfg"], {"n": 0, "failed": 0, "timedOut": 0})
            for t in r.get("trace") or []:
                if t.get("stage") == "decide":
                    o["n"] += 1
                    if t.get("ok") is False:
                        o["failed"] += 1
                        o["timedOut"] += 1 if re.search(r"timeout|aborted", str(t.get("out") or ""), re.I) else 0
    evidence["otherDeciders"] = others
    candidates = {}
    tried = state.get("tried", {})
    for s in briefs.get("slots", []):
        cands = _json(root / "training" / "candidates" / (s["id"] + ".json"), [])
        if cands:
            candidates[s["id"]] = cands
    return {
        "root": str(root),
        "key": key,
        # training question by question (training/loop.mjs): this configuration's, against this larger model
        "loop": (lambda q: q if q and q.get("target") == (target or {}).get("id") else None)(_json(results / "questions.json", None)),
        "scoring": scoring_now(root),
        "sample": (root / ".sample").exists(),
        "briefs": briefs,
        # how this swarm is trained now: the settings every swarm starts with, and over them this configuration's own changes
        "policy": _merge(_json(root / "training" / "policy.json", {}), state.get("policy") or {}),
        "learned": {"ledger": (learned or {}).get("ledger") or [], "passes": (learned or {}).get("passes") or [], "startedFrom": started_from.get("version"), "wins": wins,
                    # (a move to classes, where one was made: which kept changes it did not carry; src/learned.mjs toClasses)
                    "migrated": (learned or {}).get("migrated"), "discarded": (learned or {}).get("discarded")},
        "state": state,
        # asking: the kinds the pass under way asks, where this configuration's record says (a choice takes effect with the next pass)
        "equivalence": {"targets": equiv.get("targets", []), "chosen": picked, "asking": state.get("kinds")},
        "targets": targets,
        "target": target,
        "registry": registry,
        "machine": machine(),
        "members": members,
        "decider": decider,
        "judge": judge,
        "footprint": footprint(members, decider, target),
        "cfg": cfg,
        # turns with tools: decided by the swarm, or the place of the one small model that takes them alone (src/tools.mjs; "tools"
        # in src/config.json names it by its id: src/catalog.mjs toolsOf, the same rule)
        "tools": tools_of(chosen.get("tools"), members),
        "splits": splits,
        "heldBy": held_by,
        "record": record,
        "evidence": evidence,
        "candidates": candidates,
        "tried": tried,
    }


def _canon(x):
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: _canon(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_canon(v) for v in x]
    return x


def recipe_sha256(recipe):
    """The recipe's hash, in the form src/spec.mjs writes it too: keys sorted, no spaces, text as itself, 1.0 written 1."""
    import hashlib
    return hashlib.sha256(json.dumps(_canon(recipe), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def pass_in_hand(d):
    """THIS PASS, UNDER WAY: what the spec would otherwise leave out until the pass ends (it says only what finished passes and the
    held questions measured). The pass and when it began, the swarm on this pass's train questions so far (they choose what to
    try; not parity), what is being measured now, each move measured with what it scored, and what was kept. None where no pass of
    this configuration is under way."""
    key = d.get("key") or ""
    p = _json(Path(d["root"]) / ".work" / "train" / key / "plan.json", None) if key else None
    state_pass = int((d.get("state") or {}).get("pass", 0))
    if not isinstance(p, dict) or p.get("pass") != state_pass + 1 or p.get("config") not in (None, d.get("cfg")):
        p = None
    tr = d["splits"]["train"]
    pt = tr.get("parity")
    if not p and not pt:
        return None
    moves = (p or {}).get("moves") or []
    done = [m for m in moves if m.get("status") in ("kept", "not kept")]
    res = lambda m: {k: (m.get("result") or {}).get(k) for k in ("train", "now", "why") if (m.get("result") or {}).get(k) is not None}  # noqa: E731
    return {
        "pass": state_pass + 1,
        "began": (p or {}).get("at"),
        "trainSoFar": ({"equivalent": pt["equivalent"], "compared": pt["compared"], "percent": pt["percent"], "answered": len(tr["swarm"]), "of": tr.get("expected")} if pt else None),
        "trainIs": "the swarm on this pass's train questions: they choose what to try, and are not parity. Parity is said on the held questions, which it was never chosen on, at the end of the pass",
        "moves": {"planned": sum(1 for m in moves if m.get("status") == "planned"), "beingMeasured": sum(1 for m in moves if m.get("status") == "running"),
                  "kept": sum(1 for m in moves if m.get("status") == "kept"), "notKept": sum(1 for m in moves if m.get("status") == "not kept")},
        "now": [{"kind": m.get("kind"), "what": m.get("what"), "slot": m.get("slot")} for m in moves if m.get("status") == "running"],
        "measured": [{"kind": m.get("kind"), "what": m.get("what"), "slot": m.get("slot"), "status": m.get("status"), **res(m)} for m in done],
    }


# THE SwOA SPEC (docs/swoa.md): what the output spec became, made formal. A SwOA is to a swarm module what LoRA is to a model: the
# spec applied to it to tune it, with the proof an established harness measured. Older specs (the-swarm/spec 2 and 3) are read, not written
SWOA_FORMAT = "swoa"
SWOA_VERSION = 1
LEGACY_SPEC_FORMAT = "the-swarm/spec"
PROOF_MIN_N = 100
SWOA_SPEC_URL = "https://github.com/nseidm1/The-Swarm/blob/main/docs/swoa.md"


def runtime_of():
    """THE RUNTIME A SwOA WAS WRITTEN FOR (docs/swoa.md 4.6), as a model card names its library: this package's name and version."""
    try:
        pkg = json.loads((Path(__file__).resolve().parent.parent / "package.json").read_text())
    except (OSError, ValueError):
        pkg = {}
    return {"library": pkg.get("name") or SERVED_NAME, "version": pkg.get("version")}


# WHAT IS THE RUNTIME'S OWN AND NOT THE SwOA'S (docs/swoa.md 3): how this runtime starts and is called. The dashboard shows them
# on this machine; a published SwOA names its runtime once, in `runtime`, and refers to no implementation
RUNTIME_ONLY = (("interface", "as"), ("interface", "start"), ("requirements", "node"))  # fewer questions than this and a score's standard error (about 0.10 at 20) is larger than the gaps that matter


# PARITY, FOR ONE CAPABILITY (docs/swoa.md 4.7; docs/swoa-parity.md): the module and its target are asked the same questions, so
# the gap is read question by question. From the counts an evaluation already keeps (how many questions only the one had right):
#   gap = (onlySwoa - onlyTarget) / n          gapStderr = sqrt(((onlySwoa + onlyTarget) / n - gap^2) / n)
# and a verdict against a margin, at 95% one-sided: parity (within the margin of the target, or better), short (lower by more than
# the margin), open (too few questions to say).
PROOF_MARGIN = 0.05
PROOF_Z = 1.645
# what a module of this runtime does not claim, whatever its proof holds
NOT_CLAIMED = ["long conversations (the module keeps the last turns of one)", "speed (an answer is several model calls)",
               "anything but text", "knowledge with no tool offered"]


def paired_gap(agree):
    from math import sqrt
    a = agree or {}
    n, s, t = a.get("of") or 0, a.get("onlySwarm"), a.get("onlyTarget")
    if not n or not isinstance(s, (int, float)) or not isinstance(t, (int, float)):
        return None
    gap = (s - t) / n
    return {"n": n, "onlySwoa": s, "onlyTarget": t, "gap": round(gap, 4), "gapStderr": round(sqrt(max(0.0, (s + t) / n - gap * gap) / n), 4)}


def verdict_of(gap, stderr, margin=PROOF_MARGIN):
    if gap - PROOF_Z * stderr >= -margin:
        return "parity"
    if gap + PROOF_Z * stderr < -margin:
        return "short"
    return "open"


def capabilities_of(results, margin=PROOF_MARGIN):
    """A verdict for each capability (a body of work: its tasks' questions together), from the results listed for it. Only results
    whose questions were paired count toward it; a capability with none has no verdict."""
    out = []
    for item in sorted({str(e.get("item")) for e in results}):
        mine = [e for e in results if str(e.get("item")) == item]
        pairs = [e["pairs"] for e in mine if e.get("pairs")]
        cap = {"id": item, "name": next((e.get("itemName") for e in mine if e.get("itemName")), item),
               "tasks": [e.get("task") for e in mine], "proof": bool(mine) and all(e.get("proof") for e in mine), "margin": margin}
        if pairs:
            p = paired_gap({"of": sum(x["n"] for x in pairs), "onlySwarm": sum(x["onlySwoa"] for x in pairs), "onlyTarget": sum(x["onlyTarget"] for x in pairs)})
            cap.update({"n": p["n"], "gap": p["gap"], "gapStderr": p["gapStderr"], "verdict": verdict_of(p["gap"], p["gapStderr"], margin)})
        out.append(cap)
    return out


def swoa_proof(d, arrangement_sha, pins):
    """THE PROOF OF A SwOA (docs/swoa.md, proof): harness results on this module beside its target's, from the evaluations on record
    (.work/eval/history.jsonl). Only results measured on this SwOA are listed: this configuration, this arrangement, and the adapters
    the recipe pins. For each task the newest that counts as proof (at least PROOF_MIN_N questions) is listed, else the newest check."""
    from math import sqrt
    rows = []
    try:
        for line in (Path(d["root"]) / ".work" / "eval" / "history.jsonl").read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    want_adapters = sorted((d["members"].get(k) or {}).get("name", k) for k in (pins or {}))
    best = {}
    for r in rows:
        if r.get("configuration") != d.get("key") or r.get("arrangementSha256") != arrangement_sha:
            continue
        if sorted(r.get("adapters") or []) != want_adapters:
            continue
        run_h = r.get("harnessId") or {"name": str(r.get("harness") or "").rsplit(" ", 1)[0], "version": str(r.get("harness") or "").rsplit(" ", 1)[-1]}
        for x in r.get("results") or []:
            # (a run may hold tasks of more than one harness: a result of the second names its own)
            h = x.get("harnessId") or run_h
            sw, tg = x.get("swarm") or {}, x.get("target") or {}
            if not isinstance(sw.get("value"), (int, float)) or not isinstance(tg.get("value"), (int, float)):
                continue
            n = int(sw.get("n") or 0)
            pg = paired_gap(x.get("agree"))
            e = {"harness": h, "task": x.get("task"), "name": x.get("name"), "item": x.get("item"), "itemName": x.get("itemName"), "metric": x.get("metric"), "filter": x.get("filter"),
                 "n": n, "of": sw.get("of"),
                 "swoa": {"value": sw["value"], "stderr": sw.get("stderr")}, "target": {"value": tg["value"], "stderr": tg.get("stderr")},
                 "gap": round(sw["value"] - tg["value"], 4),
                 # (paired where the two models' answers to each question are on record; else from the two scores' own errors)
                 "gapStderr": pg["gapStderr"] if pg else round(sqrt((sw.get("stderr") or 0) ** 2 + (tg.get("stderr") or 0) ** 2), 4),
                 "paired": bool(pg), **({"pairs": {k: pg[k] for k in ("n", "onlySwoa", "onlyTarget")}} if pg else {}),
                 # (where the test offers tools: what each model was offered; where its answers are only good for a day: the day)
                 **({"tools": x["tools"]} if x.get("tools") else {}), **({"askedOn": x["askedOn"]} if x.get("askedOn") else {}),
                 # (where the test's tools search: the search service behind them, the same for both models)
                 **({"search": x["search"]} if x.get("search") else {}),
                 # (where the target was asked more than one way: the way it is counted by, its higher score, and what it scored each way)
                 **({"targetAsked": x["targetAsked"], "targetWays": {k: {"value": v.get("value"), "stderr": v.get("stderr")} for k, v in (x.get("targetWays") or {}).items()}} if x.get("targetAsked") else {}),
                 "proof": n >= PROOF_MIN_N, "at": r.get("at"), "runId": r.get("runId"),
                 "arrangementSha256": arrangement_sha, "configuration": r.get("configuration")}
            k = (h.get("name"), x.get("task"))
            was = best.get(k)
            # (proof outranks a check; among equals, the newer)
            if not was or (e["proof"], e["at"] or "") > (was["proof"], was["at"] or ""):
                best[k] = e
    results = sorted(best.values(), key=lambda e: (str(e["item"]), str(e["task"])))
    caps = capabilities_of(results)
    return {
        "goal": "parity with the target model, as an established LLM evaluation harness measures it",
        "rule": "a result counts as proof of this SwOA only when it was measured on it (this configuration, this arrangementSha256, the adapters the recipe pins) and asks at least %d questions of its task; one on this SwOA that asks fewer is listed as a check (proof: false)" % PROOF_MIN_N,
        "margin": PROOF_MARGIN,
        "verdictRule": "for each capability, over the questions of its tasks together: parity when gap - %s x gapStderr >= -margin, short when gap + %s x gapStderr < -margin, open otherwise" % (PROOF_Z, PROOF_Z),
        "capabilities": caps,
        "claims": {"claimed": [c["name"] for c in caps], "notClaimed": NOT_CLAIMED},
        "results": results,
        "proven": sum(1 for e in results if e["proof"]),
    }


def scoring_now(root):
    """HOW AN ANSWER IS GRADED NOW, as the number the loop writes down with a pass's record (training/loop.mjs SCORING). A record of
    another number is not carried on by the loop: its questions are asked again from the first. None where it cannot be read."""
    try:
        m = re.search(r"^export const SCORING = (\d+);", (Path(root) / "training" / "loop.mjs").read_text(), re.M)
    except OSError:
        return None
    return int(m.group(1)) if m else None


def tool_limits(root):
    """How much of what tools returned a reply is written from (src/tools.mjs RESULT_MOST, FOUND_MOST): characters of one result, and
    of all of them together. Read from the runtime, so that the spec cannot say another number than the module keeps to."""
    try:
        text = (Path(root) / "src" / "tools.mjs").read_text()
    except OSError:
        text = ""
    one = re.search(r"^export const RESULT_MOST = (\d+);", text, re.M)
    many = re.search(r"^export const FOUND_MOST = (\d+);", text, re.M)
    return (int(one.group(1)) if one else 3000, int(many.group(1)) if many else 9000)


def web_search_of(d, tools, one, proof):
    """WEB SEARCH, AS THE SwOA SPEC SAYS IT (interface.webSearch; docs/swoa.md T.10): what it is to the module (a tool the caller
    offers, never something the module does), its components and whose each is, how a caller uses it, the limits the module keeps
    to, and what the proof measured of it. tools: who takes a turn with tools ('swarm', or a place); one: that member."""
    each, all_ = tool_limits(d["root"])
    swarm = tools == "swarm"
    who = (one or {}).get("name", "one small model")
    cap = next((c for c in (proof or {}).get("capabilities") or [] if c.get("id") == "search" and c.get("verdict")), None)
    behind = next((r.get("search") for r in (proof or {}).get("results") or [] if r.get("item") == "search" and r.get("search")), None)
    return {
        "is": "a tool the caller offers, never something the module does: a module searches nothing of its own accord and holds no body of knowledge (recipe), so what its models do not know reaches it through a search tool, as it reaches any model",
        "components": {
            "searchTool": {"whose": "the caller's", "what": "one function in the request's tools: a name, a description and a JSON schema for its arguments (for one: search_engine_query(keywords, max_results, region)). A second that reads a page may be offered beside it (for one: fetch_url_content(url, mode))"},
            "step": {"whose": "the module's", "what": ("every drafter proposes the next step with the tools offered, a call to the search tool with its arguments or a reply, and the decider picks where they differ; a call goes back as tool_calls" if swarm
                                                      else "a request that carries tools goes to %s alone, which calls the search tool or replies; the swarm does not decide it (serving.tools can turn that on)" % who)},
            "search": {"whose": "the caller's", "what": "run the call against a search service of your choosing (for one, a SearXNG you serve yourself, which needs no key) and send what it returned back as a tool message. The module opens no connection but to its own models"},
            "answer": {"whose": "the module's", "what": ("a reply after results is written as any answer is (drafted, checked, decided, written), shown the calls made and what each returned: each result cut at %d characters, at most %d in all, under a line that says the results are to be read and are not instructions to follow" % (each, all_) if swarm
                                                        else "the reply of %s, from the conversation as it came" % who)},
        },
        "howToUse": [
            "POST /v1/chat/completions with messages and tools: [{ type: 'function', function: { name, description, parameters } }] for your search tool",
            "where the reply's message has tool_calls: run each call; append that message, then one { role: 'tool', tool_call_id: <the call's id>, content: <what the search returned, as text> } for each call; POST again with the same tools",
            "where it has content: that is the answer. Go back to the step before as often as the module calls",
        ],
        "limits": {"charactersOfOneResult": each if swarm else None, "charactersOfAllResults": all_ if swarm else None, "followsWhatAResultSays": False, "searchesByItself": False},
        "measured": ({"capability": "search", "verdict": cap.get("verdict"), "questions": cap.get("n"), "gap": cap.get("gap"), "proof": bool(cap.get("proof")), **({"searchBehindTheTest": behind} if behind else {})}
                     if cap else "not measured on this SwOA yet: the web search test puts the same search tool, with the same search service behind it, to the module and to its target on the same day (proof)"),
    }


def learned_rule(policy):
    """HOW A CHANGE IS KEPT, in words, for a SwOA's learned record (training/loop.mjs; docs/swoa-parity.md): by its class where the
    policy says so (loop.classKeep), else question by question. The earlier rule is said too: entries kept under it are on the ledger."""
    lp = (policy or {}).get("loop") or {}
    before = ("a change was kept only if it brought a train question to parity with the target's answer and none of the questions already at parity "
              "that were asked again with it was lost")
    if lp.get("classKeep") is True:
        return ("a change is kept when the questions of its class got better with it: each train question of the class is scored with the change and as the module stood "
                "(by the question's own standard where it carries one, else against the answers the target agrees with itself on), and the change is kept when the mean gain "
                "is more than twice its paired error and at least %s, no kind of question falls by more than %s, and the held questions of the class do not fall by more than "
                "their error; an entry so kept says its gain, its error and over how many questions (classGain). Before this rule, %s"
                % (lp.get("classMinGain", 0.02), lp.get("classMargin", 0.05), before))
    return "training goes question by question: " + before.replace("was kept", "is kept").replace("it brought", "it brings").replace("that were asked", "that are asked").replace("was lost", "is lost")


def learned_live(learned):
    """How many kept changes the arrangement carries now: all of them, less those a move to classes did not carry (src/learned.mjs toClasses)
    and those discarded to be earned again (learned.discarded)."""
    ledger = (learned or {}).get("ledger") or []
    dropped = set(((learned or {}).get("migrated") or {}).get("dropped") or []) | set(((learned or {}).get("discarded") or {}).get("entries") or [])
    return sum(1 for e in ledger if e.get("n") not in dropped)


_SHA = {}


def _sha256(path):
    """A file's SHA-256, kept while the file is unchanged (an adapter is 10 to 15 MB; the spec is drawn on every opening)."""
    import hashlib
    st = os.stat(path)
    key = (str(path), st.st_mtime, st.st_size)
    if key not in _SHA:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _SHA[key] = h.hexdigest()
    return _SHA[key]


def spec_adapters(d):
    """THE ADAPTERS THE SWARM IS SERVED WITH, as the spec pins them: where the configuration serves them ("adapters": true in
    src/config.json), each small model with one that llama.cpp found good (training/adapters.mjs lorasFor reads the same) ->
    ({place: {file, sha256, bytes}} for the recipe, {place: how it was made} for the spec), both empty where none is served."""
    root = Path(d["root"])
    cfg = _json(root / "src" / "config.json", {}) or {}
    if not cfg.get("adapters"):
        return {}, {}
    orig = (_json(root / "training" / "originals.json", {}) or {}).get("models", {})
    tid = str((d.get("target") or {}).get("id", ""))
    pins, made = {}, {}
    for k, m in (d.get("members") or {}).items():
        if not m:
            continue
        o = orig.get(m.get("file")) or {}
        res = _json(root / ".work" / "library" / "adapters" / tid / (o.get("dir") or m.get("file", "")) / "result.json", None)
        g = Path(str((res or {}).get("gguf") or ""))
        if not res or not res.get("ok") or not g.is_file():
            continue
        pins[k] = {"file": g.name, "sha256": _sha256(g), "bytes": g.stat().st_size}
        work = {t["id"]: t.get("specName") or t.get("name", t["id"]) for t in (d.get("equivalence") or {}).get("targets", [])}
        made[k] = {"model": m.get("id"), "file": g.name, "learned": "the larger model's answers to %s train questions%s" % (res.get("examples"), (" of " + ", ".join(work.get(i, i) for i in res.get("items") or [])) if res.get("items") else ""),
                   "from": {"weights": o.get("repo"), "revision": o.get("revision")}, "iters": res.get("iters"), "at": res.get("at"),
                   "validationLoss": res.get("valLoss"), "perplexity": res.get("perplexity"),
                   "make": "node training/adapters.mjs train %s --iters %s (MLX LoRA from the original weights, converted to a GGUF LoRA for llama.cpp)" % (m.get("file"), res.get("iters"))}
    return pins, made


def equivalence_of(d, b, pins):
    """The equivalence the spec reports: the share of the held questions on which the swarm's answer is equivalent to the larger
    model's, for the arrangement every swarm starts from (src/briefs.json's version) and for the one training made (this
    configuration's briefs), each served with the adapters the recipe pins; and how many points training added. A side not yet
    measured that way says so: nothing is borrowed from a measurement made another way."""
    start = (_json(Path(d["root"]) / "src" / "briefs.json", {}) or {}).get("version", 1)
    served = sorted(pins)
    def at(v):
        g = next((x["parity"] for x in d.get("heldBy") or [] if x["briefs"] == v and x["adapters"] == served), None)
        return ({"briefsVersion": v, "adapters": served, "percent": g["percent"], "equivalent": g["equivalent"], "of": g["compared"]} if g
                else {"briefsVersion": v, "adapters": served, "measured": False})
    dflt = at(start)
    now = b.get("version")
    trained = at(now) if now != start else {"briefsVersion": now, "adapters": served, "sameAs": "default: training has kept nothing yet"}
    both = "percent" in dflt and "percent" in trained
    return {
        "is": "the share of training's own held questions the module answers well (right by the question's own standard where it carries one, else equivalent to an answer the target agrees with itself on), served as this spec says (with the adapters it pins, where it pins them). It is training's measure, not the proof",
        "default": dflt,
        "defaultIs": "the arrangement every swarm starts from, with the same models and decider, served the same way",
        "trained": trained,
        "trainedIs": "the arrangement in `recipe.briefs`, made by the changes in `learned.ledger`",
        "gainPoints": round(trained["percent"] - dflt["percent"], 1) if both else None,
        "gainIs": "what training added over the default, in points of the held questions; none until both are measured the same way",
    }


def spec(d):
    """THE SwOA SPEC (docs/swoa.md): everything needed to make this swarm module again, anywhere, and to offer it as a model: what it is made of (every
    file pinned), how it is arranged (every slot with what it is told), how it is served and decided, what it can and cannot do as a
    model, what it needs of a machine, and where it stands against the larger model, with the evidence. One document.
    Generic, for any host: a model chooser takes `card` as one more item, checks `requirements` against the machine, fetches what
    `recipe` pins, and starts it with serveSwarm({ ...card, spec }). It says how far training took the swarm past the arrangement
    every swarm starts from, served the same way (`equivalence`), and what made the difference (`learned`).
    The parts a swarm is built from (members, decider, engine, serving, arrangement.briefs) are hashed: recipeSha256."""
    import hashlib
    from statistics import median
    b, p = d["briefs"], d["splits"]["held"]["parity"]
    gb = lambda n: round(n / 2**30, 2)  # noqa: E731
    file_of = lambda m: {k: m.get(k) for k in ("id", "name", "by", "params", "license", "repo", "rev", "file", "bytes", "sha256", "parts", "serve", "sampling") if m.get(k) not in (None, [], {})}  # noqa: E731
    a, bb = d["members"]["a"] or {}, d["members"]["b"] or {}
    held = d["splits"]["held"]["swarm"]
    last = (d["state"].get("history") or [None])[-1]
    members = {k: file_of(m or {}) for k, m in d["members"].items() if m}
    n_small = len(members)
    dec = {k: v for k, v in (d["decider"] or {}).items() if k not in ("index",) and v not in (None, [], {})}
    eng = d["registry"]["engine"]
    engine = {"name": eng.get("name"), "site": eng.get("site"), "version": eng.get("version"), "build": eng.get("tag"), "minBuild": eng.get("minBuild"), "builds": eng.get("builds")}
    fp = d.get("footprint") or {}
    serving = dict(SERVING, memoryGbEstimate=fp.get("swarm") or round(sum(gb((m or {}).get("bytes", 0)) for m in d["members"].values()) * 1.25 + 1, 1),
                   memoryIs="an estimate: the small models' files, their contexts and the decider; not measured")
    run_briefs = {k: v for k, v in b.items() if k != "about"}  # what createSwarm runs, exactly
    # (a class's own arrangement is its slots, plan and flow, nothing else: SwOA specification 4.3; src/index.mjs kindsAsSpecified)
    if isinstance(run_briefs.get("kinds"), dict):
        run_briefs["kinds"] = {c: {p: k[p] for p in ("slots", "plan", "flow") if p in k} for c, k in run_briefs["kinds"].items() if isinstance(k, dict)}
    tools = d.get("tools") or "a"
    one = (members.get(tools) or {}) if tools != "swarm" else {}
    pins, made = spec_adapters(d)
    recipe = {"members": members, "decider": dec, "engine": engine,
              "serving": {**{k: serving[k] for k in ("slots", "contextPerSlot")}, "tools": "swarm" if tools == "swarm" else one.get("id", tools)}, "briefs": run_briefs,
              **({"adapters": pins} if pins else {})}
    sha = recipe_sha256(recipe)
    base_module = {"members": recipe["members"], "decider": recipe["decider"], "engine": recipe["engine"]}
    arrangement_sha = recipe_sha256(run_briefs)
    lic = list(dict.fromkeys(x for x in [m.get("license") for m in members.values()] + [dec.get("license")] if x))
    secs = [r["seconds"] for r in held if isinstance(r.get("seconds"), (int, float))]
    spr = round(median(secs), 1) if secs else None
    t = d["target"] or {}
    names = [m.get("name", k) for k, m in members.items()]
    eq = d.get("equivalence") or {}
    # (what it is equivalent on, by what the work is, not by the product it was first measured for: specName, specAbout)
    on = [{"id": x["id"], "name": x.get("specName") or x.get("name", x["id"]), "about": x.get("specAbout") or x.get("about", ""), "kinds": x.get("kinds", [])}
          for x in eq.get("targets", []) if x["id"] in (eq.get("chosen") or [])]
    badge = (("At parity with %s" % t.get("name")) if p["level"] else ("%s%% of the way to parity with %s" % (("%.1f" % p["percent"]).rstrip("0").rstrip("."), t.get("name")))) if p and t else "Not yet measured"
    runs_on = dec.get("runsOn") or ["mac", "cuda", "cpu"]
    now = pass_in_hand(d)
    if not p and now:
        # (in training and not yet measured on the held questions: said so, with how its own train questions are going)
        badge = "In training · pass %d" % now["pass"]
    # (the proof is read once: the spec's proof, and what the spec says was measured of web search)
    proof = swoa_proof(d, arrangement_sha, pins)
    return {
        # THE SwOA HEADER (docs/swoa.md): what this is, and the three hashes that say what it applies to, what it tuned, and all of it
        "swoa": {"format": SWOA_FORMAT, "version": SWOA_VERSION, "name": d.get("key"),
                 "baseModuleSha256": recipe_sha256(base_module), "arrangementSha256": arrangement_sha, "recipeSha256": sha,
                 "writtenAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds"),
                 "is": "a SwOA (Swarm Orchestration Adaptation) spec: applied to this swarm module (baseModule) it tunes it toward parity with the target, as the proof measures. Two SwOAs with the same recipeSha256 make the same module."},
        # WHAT IT APPLIES TO, as a LoRA names its base model: the small models, the decider and the engine, each pinned
        "baseModule": base_module,
        "runtime": runtime_of(),
        "target": {k: (d["target"] or {}).get(k) for k in ("id", "name", "by", "params")},
        # THE PROOF: harness results on this module beside the target's, measured on exactly this SwOA
        "proof": proof,
        "name": "The Swarm",
        "id": "swarm-" + "+".join(m.get("id", "") for m in members.values()),
        "what": "%s small models that answer as one, trained toward parity with a larger model: scoring no worse than it, within a margin, on established tests of what it can do." % ["One", "Two", "Three", "Four"][max(0, min(3, n_small - 1))],
        # ONE ITEM FOR A MODEL CHOOSER (id, name, size, params, memGb, pace, badge, plain), with engine 'swarm'; what it is
        # equivalent on and where it stands are said on its face
        "card": {
            "id": "swarm-" + "+".join(m.get("id", "") for m in members.values()), "engine": "swarm", "family": "Swarm", "name": "The Swarm",
            "size": ["One", "Two", "Three", "Four"][max(0, min(3, n_small - 1))] + " small models",
            "params": round(sum(float(m.get("params") or 0) for m in members.values()), 1),
            "memGb": serving["memoryGbEstimate"],
            "bytes": sum(int(m.get("bytes") or 0) for m in members.values()) + int((dec.get("serve") or {}).get("bytes") or 0),
            "pace": "unmeasured" if spr is None else "quick" if spr < 8 else "steady" if spr < 30 else "thorough",
            "secondsPerReply": spr,
            "badge": badge,
            "equivalentOn": [x["name"] for x in on],
            "plain": "%s (%s), decided by %s, answering as one. %s." % (
                ["One small model", "Two small models", "Three small models", "Four small models"][max(0, min(3, n_small - 1))],
                ", ".join(names[:-1]) + (" and " if len(names) > 1 else "") + names[-1] if names else "",
                dec.get("name", "a decision model"),
                ("%s, on %s" % (badge, ", ".join(x["name"] for x in on))) if p and on else badge if p
                else ("In its first pass of training against %s%s" % (t.get("name") or "a larger model", (": %s%% of this pass's train questions%s, which are not parity" % (("%.1f" % now["trainSoFar"]["percent"]).rstrip("0").rstrip("."), " so far" if (now["trainSoFar"].get("of") or 0) > now["trainSoFar"]["answered"] else "")) if now and now.get("trainSoFar") else "") if now and now["pass"] == 1
                else "Not yet measured against %s" % (t.get("name") or "a larger model"))),
        },
        # WHAT IT NEEDS OF A MACHINE, for a host to check before offering it
        "requirements": {
            "node": ">=20",
            "engine": "%s, build %s or later (pinned: %s)" % (eng.get("name"), eng.get("minBuild"), eng.get("tag")),
            "platforms": runs_on,
            "platformsAre": "where the decider runs (mac: Apple silicon; cuda: an NVIDIA GPU); the small models run wherever llama.cpp does",
            "decider": dec.get("needs") or "",
            "memoryGb": serving["memoryGbEstimate"],
            "diskGb": round((sum(int(m.get("bytes") or 0) for m in members.values()) + int((dec.get("serve") or {}).get("bytes") or 0)) / 2**30, 1),
            "licenses": lic,
            "commercialUse": not any("non-commercial" in str(x).lower() or "-nc" in str(x).lower() for x in lic),
            "commercialUseIs": "false where a licence says non-commercial; every licence is listed, to be read before offering it",
        },
        "interface": {
            "in": "messages, as a chat model takes them (role and content)",
            "out": "one reply",
            "as": ["createSwarm({ spec }).answer(messages)", "an address that answers /health, /v1/models and /v1/chat/completions (streamed or not)", "serveSwarm({ ...card, spec }, engine, opts): the call a llama.cpp model is started with"],
            "servedName": SERVED_NAME,
            "endpoints": {"GET /health": "200 while every small model answers, else 503", "GET /v1/models": "one model, " + SERVED_NAME, "POST /v1/chat/completions": "messages in, one reply out; \"stream\": true sends it as events", "GET /swarm/last": "what every slot did on the last message"},
            "capabilities": {
                "chat": True,
                "stream": "the reply is whole before any of it is sent, then sent as events",
                "tools": ("decided by the swarm: every drafter proposes the next step with the tools offered, a call to a tool not offered or with arguments that are not an object is left out, and the decider picks where the steps differ; it goes back as tool_calls"
                          if tools == "swarm" else
                          "given to %s (place %s) alone, untouched: the swarm does not decide them (the configuration can turn that on)" % (one.get("name", "one small model"), tools)),
                "toolsMode": tools,
                "images": False,
                "contextTokens": SERVING.get("contextPerSlot"),
            },
            # WEB SEARCH: what it is to the module, whose each part is, how it is used, and what was measured of it
            "webSearch": web_search_of(d, tools, one, proof),
            "goodFor": ("replies a person reads, single steps that can be checked, and an agent's turns with tools: what it was measured on (%s)" if tools == "swarm" else "replies a person reads and single steps that can be checked: what it was measured on (%s)") % (", ".join(x["name"] for x in on) or "its questions"),
            "notYet": ([] if tools == "swarm" else ["a request that carries tools goes to %s alone (an agent that works by tools gets that one model)" % one.get("name", "one small model")]) + ["the reply is whole before any of it is sent"],
            "start": {
                "decider": "bash training/decider.sh serve (the recipe is recipe.decider.serve); or name one already running with SWARM_DECIDER",
                "program": "createSwarm({ spec, decider: 'http://127.0.0.1:8009', modelsDir })",
                "host": "serveSwarm({ ...spec.card, spec }, { file: llamaServerProgram }, { modelsDir, decider })",
                "terminal": "node bin/swarm.mjs serve --spec <this file> [--port 8090]",
            },
        },
        # HOW FAR TRAINING TOOK IT: the held questions answered by the arrangement every swarm starts from and by the one training
        # made, both served as this spec says (with the adapters it pins, where it pins them), and the difference
        "equivalence": equivalence_of(d, b, pins),
        # THE ADAPTERS, how each was made: the recipe pins each file by its SHA-256; the files are not in the spec
        "adapters": ({"servedWith": True, "models": made,
                      "filesAre": "not in the spec (10 to 15 MB each, more than a commit here takes): copied from the machine that trained them, or made again by `make` from the larger model's answers. A swarm is built from a spec only with files whose SHA-256 is the recipe's; one made again differs, and is another swarm whose equivalence has not been measured"}
                     if pins else {"servedWith": False}),
        # THIS PASS, UNDER WAY (pass_in_hand): what the parts below, which speak of finished passes, do not yet hold
        "inProgress": now,
        "recipe": recipe,
        "members": members,
        "decider": dec,
        "engine": engine,
        "serving": dict(serving),
        "arrangement": {
            "briefsVersion": b.get("version"),
            "plan": b.get("plan", {}),
            "flow": b.get("flow") or [{"do": k} for k in ("draft", "try", "check", "decide", "write")],
            "flowIs": "the one this swarm has learned" if b.get("flow") else "the plain one every swarm starts from",
            # every slot WITH WHAT IT IS TOLD: without the words the arrangement cannot be made again
            "slots": [{k: v for k, v in s.items() if v is not None} | {"model": (d["members"].get(s["member"]) or {}).get("id")} for s in b.get("slots", [])],
            "briefs": run_briefs,
        },
        # WHAT IT HAS LEARNED: every change that was kept, in order, with the evidence it was kept on. Nothing is here that was
        # not measured. The arrangement above is the one these changes made.
        "learned": {
            "changesKept": len(d["learned"]["ledger"]),
            # (what the arrangement carries now: a change a move to classes did not carry is on the ledger and not live)
            "changesLive": learned_live(d["learned"]),
            # (how a change is kept, as the policy has it now; an entry kept under the earlier rule says what it was kept on)
            "rule": learned_rule(d.get("policy")),
            "ledger": d["learned"]["ledger"],
            "passes": d["learned"]["passes"],
            # every win of this configuration, from every run, cumulative across Clear training state: what training has found
            "winsKept": len(d["learned"].get("wins") or []),
            "wins": d["learned"].get("wins") or [],
        },
        "trainedAgainst": {
            "target": {k: (d["target"] or {}).get(k) for k in ("id", "name", "by", "params", "engine")},
            # (training's own measure, on its held questions. Parity itself is the proof's to say, capability by capability)
            "parityMeans": "where training stands, on its own held questions: the share of them the module answers well (right by the question's own standard where it carries one; else equivalent to an answer the target agrees with itself on). It is training's measure and not the proof: parity is the module scoring no worse than its target, within a margin, on established tests, capability by capability (proof).",
            "state": ("at parity" if p["level"] else "not at parity") if p else "not measured",
            "progressPercent": p["percent"] if p else None,
            "progressIs": "the percentage of the held answers that are equivalent to the larger model's; parity is 100, and nothing less",
            "heldQuestions": p["compared"] if p else 0,
            "equivalent": p["equivalent"] if p else None,
            "different": p["differ"] if p else None,
            "noAnswer": p["none"] if p else None,
            "byKind": {k: {"equivalent": sum(1 for r in held if r["kind"] == k and r.get("grade") == "right"), "of": sum(1 for r in held if r["kind"] == k and r.get("grade") != "noref")} for k in dict.fromkeys(r["kind"] for r in held)},
            "passes": d["state"].get("pass", 0),
            "equivalentOn": on,
            "secondsPerReply": spr,
            # how often the larger model's own second answer is equivalent to its first: the noise floor under parity; and how many of
            # the swarm's different answers the reader could not decide
            "selfAgreement": ({k: sa[k] for k in ("equivalent", "compared", "percent")} if (sa := parity(d["splits"]["held"].get("self") or [])) else None),
            "selfAgreementIs": "the larger model asked each held question again (another draw) and judged against its own first answers by the same readers: a share of differences no swarm could close, since the mark itself would not give them again",
            "undecided": (p or {}).get("undecided", 0),
            # who reads whether answers in words are equivalent: a decision model apart from the swarm's decider, or the decider itself
            "judgedBy": (d.get("judge") or {}).get("name") or "%s (the decider itself)" % (d.get("decider") or {}).get("name", "the decider"),
            "lastPass": {k: last.get(k) for k in ("pass", "at", "target", "level", "equivalent", "compared")} if last else None,
            "questions": {"kinds": sorted(set(r["kind"] for r in held)), "heldSeed": d["state"].get("seeds", {}).get("held")},
        },
    }


# A SwOA, AS IT IS PUBLISHED (specs/<name>.swoa.json and its card, specs/<name>.swoa.md; docs/swoa.md): only one with proof, and
# without what is true only while it trains (the pass in hand). This is the one thing training leaves that goes upstream. Parity
# is the goal and is not required: a SwOA that loses on a task is published with that loss in its proof, as a LoRA's card shows it.
def publishable(sp):
    """'' when the SwOA can be published, else why not, in a sentence."""
    pr = sp.get("proof") or {}
    if pr.get("proven"):
        return ""
    checks = [e for e in pr.get("results") or [] if not e.get("proof")]
    if checks:
        return "Only a SwOA with proof is published: evaluate it with at least %d questions a task (it has %d check%s on fewer)." % (
            PROOF_MIN_N, len(checks), "" if len(checks) == 1 else "s")
    return "Only a SwOA with proof is published: evaluate it (at least %d questions a task) with this arrangement." % PROOF_MIN_N


def published(sp):
    """The SwOA as it is published: without the pass in hand (true only while it trains) and without what is this runtime's own
    (RUNTIME_ONLY: how it is started and called here)."""
    out = {k: v for k, v in sp.items() if k != "inProgress"}
    for part, key in RUNTIME_ONLY:
        if isinstance(out.get(part), dict) and key in out[part]:
            out[part] = {k: v for k, v in out[part].items() if k != key}
    return out


def published_text(sp):
    out = published(sp)
    return json.dumps(out, indent=2, ensure_ascii=False) + "\n"


def published_file(root, sp):
    return Path(root) / "specs" / (str(swoa_name(sp)) + ".swoa.json")


def swoa_name(sp):
    """The SwOA's name: its configuration. (An older spec named it in spec.configuration.)"""
    return (sp.get("swoa") or {}).get("name") or (sp.get("spec") or {}).get("configuration")


def card_file(root, sp):
    return Path(root) / "specs" / (str(swoa_name(sp)) + ".swoa.md")


def swoa_card(sp):
    """THE SwOA CARD (docs/swoa.md): the spec for a person and for model hubs. YAML front matter in the form model cards use, with the
    proof as evaluation results (model-index), then the same facts in prose. Written from the spec; it adds nothing to it."""
    q = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731  (a JSON string is a YAML string)
    h, t, pr = sp.get("swoa") or {}, sp.get("target") or {}, sp.get("proof") or {}
    members = (sp.get("baseModule") or {}).get("members") or {}
    dec = (sp.get("baseModule") or {}).get("decider") or {}
    name = swoa_name(sp)
    y = ["---", "library_name: " + q((sp.get("runtime") or {}).get("library") or SERVED_NAME), "tags:", "  - swoa", "  - swarm-module",
         "base_module: " + q(name.split("--")[0] if name else ""),
         "base_module_sha256: " + q(h.get("baseModuleSha256")),
         "swoa_sha256: " + q(h.get("recipeSha256")),
         "arrangement_sha256: " + q(h.get("arrangementSha256")),
         "target_model: " + q(t.get("name")),
         "base_models:"] + ["  - " + q(m.get("repo") or m.get("name") or m.get("id")) for m in members.values()] + [
         "decision_model: " + q(dec.get("repo") or dec.get("name") or dec.get("id")),
         "model-index:", "  - name: " + q(name), "    results:" + ("" if pr.get("results") else " []")]
    for e in pr.get("results") or []:
        y += ["      - task:", "          type: text-generation", "          name: " + q(e.get("name")),
              "        dataset:", "          name: " + q(e.get("name")), "          type: " + q(e.get("task")),
              "        metrics:",
              "          - type: " + q(e.get("metric")), "            name: " + q("SwOA"), "            value: " + q(e["swoa"]["value"]),
              "          - type: " + q(e.get("metric")), "            name: " + q("target: " + str(t.get("name"))), "            value: " + q(e["target"]["value"]),
              "        source:", "          name: " + q("%s %s" % (e["harness"].get("name"), e["harness"].get("version"))),
              "          n: " + q(e.get("n")), "          proof: " + q(bool(e.get("proof")))] + (
                  ["          tools: " + q(e["tools"])] if e.get("tools") else []) + (["          asked_on: " + q(e["askedOn"])] if e.get("askedOn") else []) + (
                  ["          search: " + q(" ".join(str(x) for x in ((e["search"].get("service"), str(e["search"].get("revision") or "")[:12]) if isinstance(e.get("search"), dict) else ()) if x))] if e.get("search") else [])
    y += ["---", ""]
    rows = ["| %s | %s | %d of %s | %.3f ± %.3f | %.3f ± %.3f | %+.3f ± %.3f | %s |" % (
        e.get("name"), e.get("metric"), e.get("n") or 0, e.get("of"), e["swoa"]["value"], e["swoa"].get("stderr") or 0,
        e["target"]["value"], e["target"].get("stderr") or 0, e["gap"], e.get("gapStderr") or 0, "proof" if e.get("proof") else "check")
        for e in pr.get("results") or []]
    body = ["# SwOA: %s" % name, "",
            "A SwOA (Swarm Orchestration Adaptation) is to a swarm module what a LoRA is to a model: the spec applied to it to tune it. This one tunes a module of %d small models (%s), decided by %s, toward parity with **%s**." % (
                len(members), ", ".join(str(m.get("name") or m.get("id")) for m in members.values()), dec.get("name") or "a decision model", t.get("name")),
            "", "The module takes messages and gives one reply, as a model does. `%s.swoa.json` is everything needed to make it, read by any runtime that implements the [SwOA specification](%s); it was written for %s %s." % (
                name, SWOA_SPEC_URL, (sp.get("runtime") or {}).get("library"), (sp.get("runtime") or {}).get("version")),
            "", "## Proof", "", "The goal is %s. Parity is not guaranteed: as with a LoRA, the harness may measure a loss, and the gap says so." % pr.get("goal", ""),
            "", (pr.get("rule", "")[:1].upper() + pr.get("rule", "")[1:]) + ".", ""]
    caps = [c for c in pr.get("capabilities") or [] if c.get("verdict")]
    if caps:
        body += ["| Capability | Questions | Gap | Verdict (margin %s) |" % pr.get("margin"), "|---|---|---|---|"] + [
            "| %s | %d | %+.3f ± %.3f | %s%s |" % (c.get("name"), c.get("n") or 0, c["gap"], c["gapStderr"], c["verdict"], "" if c.get("proof") else " (a check)") for c in caps] + [
            "", "Parity: within the margin of the target, or better, at 95%. Short: lower by more than the margin. Open: too few questions to say.", ""]
        body += ["Not claimed: %s." % "; ".join((pr.get("claims") or {}).get("notClaimed") or []), ""]
    body += (["| Task | Metric | Questions | SwOA | Target | Gap | |", "|---|---|---|---|---|---|---|"] + rows) if rows else ["No harness result has been measured on this SwOA."]
    way_words = {"tools": "the tools in the request", "written": "the tools written into the conversation"}
    offered = ["- %s: each model was offered %s%s%s" % (
        e.get("name"), e["tools"], (", and both were asked on %s" % e["askedOn"]) if e.get("askedOn") else "",
        ("; the target was asked two ways and is counted by the one it scores higher by over the capability, here %s (on this task, %s)" % (way_words.get(e.get("targetAsked"), e.get("targetAsked")), ", ".join("%s: %.3f" % (way_words.get(k, k), v.get("value") or 0) for k, v in e["targetWays"].items()))) if e.get("targetWays") else "")
        for e in pr.get("results") or [] if e.get("tools")]
    body += ([""] + offered) if offered else []
    body += ["", "## Hashes", "", "- base module: `%s`" % h.get("baseModuleSha256"), "- arrangement: `%s`" % h.get("arrangementSha256"),
             "- SwOA (recipe): `%s`" % h.get("recipeSha256"), "", "Format: [SwOA specification](%s), version %s." % (SWOA_SPEC_URL, h.get("version")), ""]
    return "\n".join(y + body)
