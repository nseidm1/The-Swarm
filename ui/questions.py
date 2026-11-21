"""THE QUESTIONS TRAINING ASKS, FOR THE PAGE: read out by the trainers' own program (training/questions-list.mjs), and set beside
the benchmark questions kept on this machine. Both are kept until what they were made from changes."""
import glob
import json
import os
import re
import subprocess
from pathlib import Path

_CACHE = {}


def _stamp(paths):
    out = []
    for p in sorted(paths):
        try:
            st = os.stat(p)
            out.append((str(p), st.st_mtime_ns, st.st_size))
        except OSError:
            pass
    return tuple(out)


def load(root, node):
    """-> (the questions, or [] where they could not be read; why not, or '')"""
    root = Path(root)
    made_from = [str(p) for p in (root / "training").glob("tasks*.mjs")] + [str(root / "training" / "policy.json"), str(root / "src" / "config.json"), str(root / ".work" / "train" / "state.json"),
                                                                           str(root / "training" / "questions-list.mjs")] + [str(p) for p in (root / "training" / "questions").glob("*.json")]
    key = ("q", str(root), _stamp(made_from))
    if key in _CACHE:
        return _CACHE[key]
    if not node:
        return [], "No Node.js was found to read the questions with."
    try:
        # (read where the trainers read: the questions are this configuration's, with the seeds its passes use)
        r = subprocess.run([node, "training/questions-list.mjs"], cwd=str(root), capture_output=True, text=True, timeout=120)
        got = json.loads(r.stdout)
        res = (got if isinstance(got, list) else [], "")
    except (OSError, ValueError, subprocess.TimeoutExpired) as x:
        res = ([], "The questions could not be read: %s" % str(x)[:160])
    _CACHE.clear()
    _CACHE[key] = res
    return res


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def _runs(s, n=5):
    w = _norm(s).split()
    return set(" ".join(w[i:i + n]) for i in range(max(1, len(w) - n + 1)))


def benchmark_turns(root):
    """Every question a benchmark put on this machine, and every worked example it showed with one: {(task, text)} from the
    harness's kept samples (.work/eval). Only what was asked here: a task asked at twenty a task has twenty of its questions."""
    out = {}
    for f in glob.glob(str(Path(root) / ".work" / "eval" / "*" / "**" / "samples_*.jsonl"), recursive=True):
        task = re.sub(r".*samples_(.*?)_20\d\d-.*", r"\1", f)
        try:
            lines = open(f, errors="replace").read().split("\n")
        except OSError:
            continue
        for line in lines:
            if not line.strip():
                continue
            try:
                a0 = json.loads(line)["arguments"]["gen_args_0"]["arg_0"]
                msgs = json.loads(a0[0] if isinstance(a0, list) else a0)
            except (ValueError, KeyError, IndexError, TypeError):
                continue
            for m in msgs if isinstance(msgs, list) else []:
                if isinstance(m, dict) and m.get("role") == "user" and isinstance(m.get("content"), str):
                    out[(task, _norm(m["content"]))] = (task, m["content"])
    return list(out.values())


def audit(root, questions):
    """WHETHER A TRAINING QUESTION IS A BENCHMARK'S: each question, and each worked example it shows, against every benchmark
    question and example kept here. -> { benchmark: how many they were set beside, tasks, same: [ids that are the same text],
    closest: { share, id, kind, task, ours, theirs } or None }. share: of the shorter one's runs of five words, how many the
    other has too (1.0: one holds the other)."""
    files = glob.glob(str(Path(root) / ".work" / "eval" / "*" / "**" / "samples_*.jsonl"), recursive=True)
    key = ("a", str(root), _stamp(files), len(questions), hash(tuple(q.get("id") for q in questions)))
    if key in _CACHE:
        return _CACHE[key]
    bench = benchmark_turns(root)
    marks = [(t, c, _runs(c)) for t, c in bench]
    whole = {_norm(c) for _, c in bench}
    same, best, seen = [], None, set()
    for q in questions:
        for text in [q.get("ask", "")] + [b.get("content", "") for b in q.get("before") or [] if b.get("role") == "user"]:
            k = _norm(text)
            if not k or k in seen:
                continue
            seen.add(k)
            if k in whole:
                same.append(q.get("id"))
            s = _runs(text)
            if len(s) < 4:
                continue
            for task, theirs, bs in marks:
                i = len(s & bs)
                if i:
                    c = float(i) / min(len(s), len(bs))
                    if not best or c > best["share"]:
                        best = {"share": c, "id": q.get("id"), "kind": q.get("kind"), "task": task, "ours": text, "theirs": theirs}
    res = {"benchmark": len(bench), "tasks": len({t for t, _ in bench}), "same": sorted(set(same)), "closest": best}
    _CACHE[key] = res
    return res
