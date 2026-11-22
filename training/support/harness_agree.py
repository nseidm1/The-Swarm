"""harness_agree.py - IS THE SWARM'S ANSWER THE LARGER MODEL'S ANSWER, question by question, on a benchmark.

lm-evaluation-harness scores each model against the benchmark's own answers. What the Swarm is trained for is equivalence with
the larger model, so its logged samples (--log_samples) for the two are paired by question and compared the way the task says
(training/equivalence.json, compare):
  answer        the same answer as the harness extracts it (its own filter): a number by its value, anything else by its words,
                case, spaces and an ending full stop aside. Two replies the harness could extract nothing from are the same
  verdict       the same pass or fail on the task's own tests (code: the tests run each model's function)
  instructions  the same instructions followed and the same broken (IFEval checks each one)

  python -I harness_agree.py <target samples.jsonl> <swarm samples.jsonl> <filter> <metric> <compare>
prints one JSON line: {of, same, bothRight, bothWrong, differ, onlyTarget, onlySwarm, examples}. onlyTarget and onlySwarm: the
questions only that one got right (of those that differ); examples: up to three that differ, each side's answer as extracted.
"""

import json
import re
import sys


def rows(path, flt):
    out = {}
    for line in open(path, encoding="utf8"):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("filter", flt) != flt:
            continue
        out[r["doc_id"]] = r
    return out


def right(r, metric):
    v = r.get(metric)
    if v is None:  # (a metric some versions name otherwise: the first the sample lists)
        ms = r.get("metrics") or []
        v = r.get(ms[0]) if ms else None
    if isinstance(v, list):
        return bool(v) and all(v)
    return bool(v) and float(v) >= 1.0


def answer_of(r):
    f = r.get("filtered_resps")
    while isinstance(f, list):
        f = f[0] if f else ""
    return str(f if f is not None else "")


NUM = re.compile(r"^[-+]?\$?\s*[0-9][0-9,]*(\.[0-9]+)?%?$")


def norm(a):
    s = a.strip().rstrip(".").strip()
    if NUM.match(s):
        try:
            return "n:" + repr(float(s.replace("$", "").replace(",", "").replace("%", "").strip()))
        except ValueError:
            pass
    return "t:" + re.sub(r"\s+", " ", s.lower())


def same(t, s, compare, metric):
    if compare == "verdict":
        return right(t, metric) == right(s, metric)
    if compare == "instructions":
        return t.get("inst_level_strict_acc") == s.get("inst_level_strict_acc")
    return norm(answer_of(t)) == norm(answer_of(s))


def main(tfile, sfile, flt, metric, compare):
    t, s = rows(tfile, flt), rows(sfile, flt)
    ids = sorted(set(t) & set(s))
    res = {"of": len(ids), "same": 0, "bothRight": 0, "bothWrong": 0, "differ": 0, "onlyTarget": 0, "onlySwarm": 0, "examples": []}
    # (which questions each had right, in the order of the questions: "1011...". Two evaluations of the same questions are set
    # beside each other question by question with these, which shows a smaller difference than their two scores can)
    tbits, sbits = [], []
    for i in ids:
        a, b = t[i], s[i]
        ra, rb = right(a, metric), right(b, metric)
        tbits.append("1" if ra else "0")
        sbits.append("1" if rb else "0")
        if same(a, b, compare, metric):
            res["same"] += 1
            if ra and rb:
                res["bothRight"] += 1
            elif not ra and not rb:
                res["bothWrong"] += 1
        else:
            res["differ"] += 1
            if ra and not rb:
                res["onlyTarget"] += 1
            elif rb and not ra:
                res["onlySwarm"] += 1
            if len(res["examples"]) < 3:
                res["examples"].append({"doc": i, "target": answer_of(a)[:160], "swarm": answer_of(b)[:160]})
    res["tbits"], res["sbits"] = "".join(tbits), "".join(sbits)
    print(json.dumps(res))


if __name__ == "__main__":
    if len(sys.argv) != 6:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
