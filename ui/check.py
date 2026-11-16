#!/usr/bin/env python3
"""check.py - THE PAGE, CHECKED. Makes the made-up data, starts the page on it and on an empty folder, and asks for each view.
Only the standard library; nothing is installed and no model is started.

    python3 ui/check.py
"""

import json
import shutil
import os
import re
import sys
import time
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cleanup  # noqa: E402
import data  # noqa: E402
import sample  # noqa: E402
import swarm_ui  # noqa: E402

passed, failed = 0, []


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
    else:
        failed.append(name)
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else "\n      " + str(detail)[:500]))


def serve(root, **more):
    swarm_ui.ARGS = type("A", (), {"root": str(root)})
    srv = ThreadingHTTPServer(("127.0.0.1", 0), swarm_ui.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as x:
        return x.code, ""


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "sample"
    # the made-up data is of a swarm of the checks' own, whatever is chosen on this machine
    sample.main(root, {"a": "lfm25-2.6b", "b": "bonsai2-2b", "decider": "kev-4b", "target": "nemotron35-30b"})
    d = data.load(root)
    held = d["splits"]["held"]
    check("the made-up data is read: the swarm, the larger model and each small model alone on the same held questions",
          len(held["swarm"]) == 12 and len(held["target"]) == 12 and all(len(v) == 12 for v in held["alone"].values()) and d["sample"], len(held["swarm"]))
    p = held["parity"]
    check("parity is equivalence, counted and never a share: at parity only when every answer is equivalent to the larger model's, and a made-up answer that is the larger model's counts as equivalent",
          p and p["compared"] == 12 and p["equivalent"] == sum(1 for r in held["swarm"] if r["grade"] == "right") and p["level"] == (p["equivalent"] == 12) and "share" not in p
          and data.parity([{"grade": "right"}, {"grade": "noref"}])["level"] and not data.parity([{"grade": "right"}] * 9 + [{"grade": "wrong"}])["level"]
          and any(r["ref"] != str(q[2]) for r, q in zip(held["swarm"], sample.QUESTIONS)) and data.parity([{"grade": "noref"}]) is None, p)
    check("an answer is the wanted one as a number or as a word, and no answer is not", data.same_answer("about 4,200.0 apples", 4200) and data.same_answer("Saturday.", "Saturday") and not data.same_answer("41", 42) and not data.same_answer("", 42))
    srv, base = serve(root)
    code, html = get(base + "/")
    check("the page says the data is made up when it is", code == 200 and "Sample data, made up" in html)
    t = d["target"]
    none_yet = swarm_ui.at_parity(d, t)
    won = dict(d, state=dict(d["state"], history=[
        {"pass": 1, "target": t["id"], "config": "x+y+k", "members": ["Small X", "Small Y"], "decider": "Kev K", "level": True, "equivalent": 12, "compared": 12},
        {"pass": 2, "target": t["id"], "config": "p+q+k", "members": ["Small P", "Small Q"], "decider": "Kev K", "level": True, "equivalent": 12, "compared": 12},
        {"pass": 3, "target": t["id"], "config": "p+q+k", "members": ["Small P", "Small Q"], "decider": "Kev K", "level": False, "equivalent": 11, "compared": 12},
        {"pass": 4, "target": "another-model", "config": "r+s+k", "members": ["Small R", "Small S"], "decider": "Kev K", "level": True, "equivalent": 12, "compared": 12},
    ]))
    listed = swarm_ui.at_parity(won, t)
    others = [x["name"] for x in d["targets"] if x["id"] != t["id"]]
    check("the larger model's card lists the configurations of small models a pass measured at parity with IT, and nothing else: no other larger model is named there, none is listed before one is measured, "
          "one whose latest pass was not at parity is not listed, and one measured against another model is not listed",
          "None yet" in none_yet and "Small X + Small Y" in listed and "Small P" not in listed and "Small R" not in listed and "at parity with <b>" not in html and "chasing" not in html
          and not any(n in none_yet + listed for n in others), listed)
    top = html.split("<main")[1].split('id="arrangement"')[0]
    full = get(base + "/fragment/scorefull")[1]
    pc = held["parity"]["percent"]
    check("it shows how far the swarm is toward parity with the larger model, by name, as a percentage with a bar and the count behind it; 100 is said only when every answer is equivalent; and it says that being right is not what is measured",
          ("%s%% of the way to parity with Nemotron" % swarm_ui.fmt_pct(pc) in html or "100%: at parity with Nemotron" in html) and 'class="memc parc' in top and 'class="mbar stack"' in top and "of the way to parity</span>" not in html.split('id="chips"')[1].split("</header>")[0]
          and "Toward parity with Nemotron" in full and "The swarm" in full and "LFM2.5 2.6B alone" in full and "fundamentally equivalent" in full and "Whether either was right is not what is measured" in full
          and data.parity([{"grade": "right"}] * 999 + [{"grade": "wrong"}])["percent"] == 99.9 and data.parity([{"grade": "right"}] * 3)["percent"] == 100 and data.parity([{"grade": "right"}] * 1999 + [{"grade": "wrong"}])["percent"] < 100
          and swarm_ui.fmt_pct(75.0) == "75" and swarm_ui.fmt_pct(62.5) == "62.5")
    strip = get(base + "/fragment/score")[1]
    check("parity stays one small strip whether or not anything is measured: the verdict and a line of counts, with the charts behind it in a dialog and never on the page itself",
          'id="score-open"' in top and "held questions" in top and "LFM2.5 2.6B alone" in top and "<svg" not in top.split('id="score"')[1] and 'class="kpis"' not in html and 'class="kpis"' in full
          and 'id="big"' in html and "/fragment/scorefull" in html and strip.startswith('<button type="button" class="panel strip"') and len(strip) < 6000, len(strip))
    fp = data.footprint({"a": {"bytes": 2**30}, "b": {"bytes": 2**30}}, {"memGb": 5}, {"memGb": 18})
    check("the strip says what the swarm is for: the memory it takes against the larger model's, in the same chart as the whole measurement (a bar for each on one scale, the swarm's made of its parts, a scale and a key), the share and how many times smaller, estimated and said to be; and parity in the same design above it: the share large, the swarm's answers as a bar (equivalent, different, no answer) with each small model alone beside it on one scale, and a key; the other numbers are chips",
          {k: fp[k] for k in ("small", "decider", "swarm", "target", "share", "times")} == {"small": 3.5, "decider": 5, "swarm": 8.5, "target": 18, "share": 47.2, "times": 2.1}
          and fp["saved"] == 52.8 and fp["savedGb"] == 9.5
          and [x["kind"] for x in fp["parts"]] == ["model", "model", "contexts", "decider"] and abs(sum(x["gb"] for x in fp["parts"]) - fp["swarm"]) < 0.05 and data.footprint({}, {}, {"memGb": 18}) is None
          and 'class="memc compact"' in strip and "The swarm</span>" in strip and "memory saved" in strip and "GB less" in strip and "not measured" in strip and "Not measured." in strip and "× smaller" in strip
          and 'class="memleg"' in strip and 'class="mbar stack"' in strip and strip.count("<i style=\"width:") >= 5 and "<svg" not in strip
          and 'class="memc parc behind"' in strip and "Toward parity with Nemotron" in strip and 'class="pe"' in strip and 'class="pd"' in strip and 'class="memrow alone"' in strip and "held answers" in strip, strip[:600])
    plan = get(base + "/fragment/plan")[1]
    arr_stopped = swarm_ui.arrangement(data.load(root))
    was_rs = swarm_ui.run_state
    swarm_ui.run_state = lambda: {"pid": 1, "at": "2026-11-16 12:00:00", "passes": 0, "first": 1, "running": True}
    plan_live = get(base + "/fragment/plan")[1]
    arr_live = swarm_ui.arrangement(data.load(root))
    swarm_ui.run_state = was_rs
    check("a move a trainer marked as being measured says so only while a session runs: once the session has stopped, it says it was stopped partway, and the arrangement says what it stopped while trying rather than what is being tried now",
          "Being measured" in plan_live and "Stopped partway" not in plan_live and "Being tried now" in arr_live
          and "Stopped partway" in plan and ">Being measured<" not in plan and "stopped partway: " in plan and "Stopped while trying" in arr_stopped and "Being tried now" not in arr_stopped, plan[:200])
    check("the plan of the pass in hand is on the page as it stands: what the measurement showed, each move in order with the slot, the model, the technique, the paper it came from and why it was chosen, and what became of it",
          "The plan for pass 5" in html and "What the measurement showed" in plan and "no slot had the larger model" in plan.lower().replace("&#x27;", "'") and plan.count("<li class=") == 5 and "Stopped partway" in plan and ">Kept<" in plan and ">Not kept<" in plan
          and "arxiv.org/abs/2609.14412" in plan and "a-steps (draft, LFM2.5 2.6B)" in plan and "Chosen because of: no slot had the answer" in plan and "The measurement does not point at it" in plan
          and "19 equivalent, 4 different on train (as it was: 17, 6)" in plan and "Open a slot to read what it is told" not in html and "/fragment/plan" in html, plan[:300])
    check("a slot's card says how long it has worked on this turn, which turn it is, and how long it has been engaged in all this step, since its clock starts again with every question",
          "s this turn" in html and "in all this step" in html and "totals" in html and "turn '+(t.turns+1)" in html)
    grown = dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "try"}, {"do": "repeat", "upTo": 2, "steps": [{"do": "check"}, {"do": "revise"}]}, {"do": "decide", "keep": 2}, {"do": "check"}, {"do": "decide"}, {"do": "write"}]))
    plain_flow, grown_flow = swarm_ui.stages(dict(d, briefs={k: v for k, v in d["briefs"].items() if k != "flow"})), swarm_ui.stages(grown)
    check("the arrangement is drawn from its flow, one column for each step in order: the plain flow as draft, try, check, decide, write; a grown one with its loop marked, the answers going back to the drafters, a decision that keeps two and one that settles",
          plain_flow.count('class="stage"') == 5 and "draft → try → check → decide → write" in plain_flow and "This is the plain flow" in plain_flow and "The sandbox" in plain_flow
          and grown_flow.count('class="stage"') == 6 and grown_flow.count('class="stage loop"') == 2 and "up to 2 times" in grown_flow and "Answers again, shown the other answers" in grown_flow
          and "Keeps the likeliest 2 answers" in grown_flow and "Decides which answer stands" in grown_flow and "repeat up to 2 times (check, revise)" in grown_flow and "A pass changed it" in grown_flow,
          grown_flow.count('class="stage'))
    early = swarm_ui.stages(dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "decide", "sure": 0.75}, {"do": "try"}, {"do": "check"}, {"do": "decide"}, {"do": "write"}])))
    check("a decision placed between the drafts and the checks is drawn where it is, and says what it does there: it settles the matter only if it is sure",
          early.count('class="stage"') == 6 and "draft → decide (only if sure) → try → check → decide → write" in early and "Settles it here if it is sure; otherwise the flow goes on" in early
          and early.index("Settles it here") < early.index("Decides which answer stands"), early.count('class="stage"'))
    # a small model beside the decider (plan.decideWith): said in the decide column that settles, not in one that settles early
    first_check = next(x for x in d["briefs"]["slots"] if x["stage"] == "check")
    beside = swarm_ui.stages(dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "decide", "sure": 0.75}, {"do": "check"}, {"do": "decide"}, {"do": "write"}],
                                                plan=dict(d["briefs"].get("plan") or {}, decideWith={"how": "if-close"}))))
    alone_html = swarm_ui.stages(dict(d, briefs=dict(d["briefs"], plan={k: v for k, v in (d["briefs"].get("plan") or {}).items() if k != "decideWith"})))
    check("where the plan puts a small model beside the decider, the decide column that settles says so: which model, asked as which slot (a checker by default), and when it is asked; a decision that settles early has none, and without one the column says nothing of it",
          beside.count("Beside it:") == 1 and ("model %s, asked as %s" % (first_check["member"], first_check["id"])) in beside and swarm_ui.DECIDE_WITH["if-close"] in beside
          and beside.index("Settles it here") < beside.index("Beside it:") and "Beside it:" not in alone_html, beside.count("Beside it:"))
    # THE MEASUREMENT AS IT IS MADE: the strip says the most that is known at each moment, and what kind of knowledge it is
    H, T = d["splits"]["held"], d["splits"]["train"]
    part = dict(d, splits=dict(d["splits"], held=dict(H, swarm=H["swarm"][:5], parity=data.parity(H["swarm"][:5]), expected=12)))
    only_train = dict(d, splits=dict(d["splits"], held=dict(H, swarm=[], parity=None)))
    only_alone = dict(d, splits=dict(d["splits"], held=dict(H, swarm=[], parity=None), train=dict(T, swarm=[], parity=None)))
    nothing = dict(d, splits={k: dict(v, swarm=[], parity=None, target={}, alone={m: [] for m in v["alone"]}) for k, v in d["splits"].items()})
    s_part, s_train, s_alone, s_none, s_full = (swarm_ui.score_strip(x) for x in (part, only_train, only_alone, nothing, d))
    check("the parity strip says the most that is known at each moment and never more: nothing; then what the larger model and each small model alone have done; then how the train questions are going; then the held answers as they come, said not to be the verdict; and the verdict only when all are answered",
          "Not measured yet" in s_none and "has answered 12 held questions. The swarm has not answered yet" in s_alone and "alone" in s_alone
          and "% on this pass" in s_train and "train questions" in s_train and "Parity is said on the held questions" in s_train and "of the way to parity" not in s_train and "at parity with" not in s_train
          and "Being measured: " in s_part and "% so far. 5 of 12 held answers in" in s_part and "The verdict is given when all 12 are answered" in s_part and "of the way to parity" not in s_part
          and ("of the way to parity with" in s_full or "at parity with" in s_full) and "Being measured" not in s_full, s_part[:300])
    b_train, b_none = swarm_ui.scoreboard(only_train), swarm_ui.scoreboard(nothing)
    check("the whole parity card opens the whole measurement in every state, and the measurement shows what there is: the held answers where they are in; this pass's train answers before them, said to be those and not parity; and before anything, that nothing is measured, with the memory",
          all(x.startswith('<button type="button" class="panel strip" id="score-open"') for x in (s_none, s_alone, s_train, s_part, s_full))
          and "The held questions are not answered yet in this pass" in b_train and "train questions so far" in b_train and "Train answers equivalent" in b_train and "held answers of that kind" not in b_train
          and "Not measured yet" in b_none and "Memory saved" in b_none and "Toward parity, pass by pass" not in b_none
          and "Held answers equivalent" in swarm_ui.scoreboard(d), [s_none[:80], b_train[:160]])
    ckd = root / ".work" / "train" / "checkpoints"
    ckd.mkdir(parents=True, exist_ok=True)
    extra = dict(H["swarm"][0], id="held-live-1", grade="right")
    extra.pop("label", None)
    (ckd / ("measure-swarm-%s-held-%s.jsonl" % (d["cfg"], d["state"]["seeds"]["held"]))).write_text(json.dumps(extra) + "\n")
    (ckd / ("try-swarm-%s-held-%s.jsonl" % (d["cfg"], d["state"]["seeds"]["held"]))).write_text(json.dumps(dict(extra, id="held-trial-1")) + "\n")
    live_d = data.load(root)
    ids = [r["id"] for r in live_d["splits"]["held"]["swarm"]]
    for f in ckd.glob("*.jsonl"):
        f.unlink()
    check("an answer is on the page the moment a trainer has written it down, before its step has ended; an answer of a candidate being tried is not taken for the swarm's; and input against output is in the whole measurement (not on the page), beside a picture of the memory the swarm takes against the larger model's",
          "held-live-1" in ids and "held-trial-1" not in ids and 'id="io"' not in html and 'id="io"' in full and "Input against output" in full and "Memory saved: the swarm against the larger model" in full and swarm_ui.io_section(nothing) == "" and 'id="io"' in swarm_ui.io_section(d), ids[-3:])
    # what a configuration remembers of its training is its own
    sd = root / "training" / "states"
    sd.mkdir(parents=True, exist_ok=True)
    (sd / ("%s--%s.json" % (d["cfg"], d["target"]["id"]))).write_text(json.dumps({"pass": 7, "tried": {"a-critic": ["x"]}, "history": [], "ideaStatus": {d["state"]["ideas"][0]["hash"]: "dropped"}}))
    own = data.load(root)
    (sd / ("%s--%s.json" % (d["cfg"], d["target"]["id"]))).unlink()
    check("the page reads this configuration's own record of its training over the folder's: its pass, what it tried, and what became of each idea here",
          own["state"]["pass"] == 7 and own["state"]["ideas"][0]["status"] == "dropped" and own["state"]["ideas"][1]["status"] == "open" and d["state"]["pass"] == 4, own["state"]["pass"])
    # how it is training is on the page, and so is what the pass changed in it and why
    pol_d = dict(d, policy=dict(d["policy"], loop=dict(d["policy"]["loop"], cap=12)))
    pol_html = swarm_ui.plan_panel(pol_d)
    exp_html = swarm_ui.stages(dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "try"}, {"do": "expect"}, {"do": "decide"}, {"do": "write"}])))
    # what only a person can change, measured for them: another small model on the gap, and another decider on the recorded choices
    wd = swarm_ui.work_of(root, d.get("key"))
    wd.mkdir(parents=True, exist_ok=True)
    n_pass = d["state"]["pass"] + 1
    (wd / "members.json").write_text(json.dumps({"pass": n_pass, "gap": 19, "models": [{"id": "qwen", "name": "Qwen3.5 2B", "drafts": 7, "asked": 19}]}))
    (wd / "decider-replay.json").write_text(json.dumps({"pass": n_pass, "results": [{"decider": "startlux-4b", "asked": 40, "kevRight": 31, "theirsRight": 34, "recovered": 5, "lost": 2}]}))
    only_html = swarm_ui.plan_panel(d)
    (wd / "members.json").write_text(json.dumps({"pass": n_pass, "gap": 19, "models": [], "why": "No other small model is on this machine to ask. Fetching one is your call (the pills)."}))
    none_html = swarm_ui.plan_panel(d)
    (wd / "members.json").write_text(json.dumps({"pass": n_pass - 1, "gap": 19, "models": []}))
    (wd / "decider-replay.json").unlink()
    old_html = swarm_ui.plan_panel(d)
    (wd / "members.json").unlink()
    check("the plan says what only a person can change, measured for them this pass: how many of the questions no slot drafted another small model on this machine answered, or that none is here to ask; and how another decider did on the same recorded choices, what it would have recovered and lost; a measurement of another pass is not shown; and each new step of a pass has its name in words",
          "What only you can change" in only_html and "<b>Qwen3.5 2B</b> answered 7 of 19" in only_html and "<b>startlux-4b</b> chose the larger model&#39;s answer <b>34</b> times of 40, against 31: it would have recovered 5 and lost 2" in only_html
          and "No other small model is on this machine to ask" in none_html and "What only you can change" not in old_html
          and swarm_ui.step_label("07-write-briefs") == "New briefs from the larger model" and swarm_ui.step_label("12-members") == "Could another small model draft it?" and swarm_ui.step_label("12-deciders") == "Would another decider choose better?",
          [only_html[only_html.find("What only"):only_html.find("What only") + 300] if "What only" in only_html else "", swarm_ui.step_label("07-write-briefs")])
    spec_rows = [dict(r, refToSpec=(i % 3 != 0)) for i, r in enumerate(H["swarm"])]
    check("the plan says how the swarm is being trained, from its policy: how many changes are tried on a question, how many questions already at parity a change is asked again on before it is kept, when a change is dropped, and what the plan lists first; a flow that asks what each call should give is drawn with that step; and parity is also counted where the larger model follows the question",
          "How it is training" in pol_html and "or <b>12</b> changes have been tried on it" in pol_html and "asked again on <b>6</b> questions already there" in pol_html and "wins" not in pol_html and d["policy"]["loop"]["cap"] == 8
          and "Says what each call should give" in exp_html and exp_html.count('class="stage"') == 5
          and data.parity(spec_rows)["onSpec"]["compared"] == 8 and "follows the question" in swarm_ui.score_strip(dict(d, splits=dict(d["splits"], held=dict(H, swarm=spec_rows, parity=data.parity(spec_rows))))), pol_html[:200])
    spec_html = get(base + "/fragment/spec")[1]
    sp = data.spec(d)
    check("the output spec is the record of what this configuration has learned against this larger model: every change that was kept, newest first, with where it came from and the answers it won on train and on held; where each pass left it; the flow; and a count of them on its pill",
          len(d["learned"]["ledger"]) == 2 and sp["learned"]["changesKept"] == 2 and "What it has learned (2 kept)" in spec_html and spec_html.index("go back to the drafters") < spec_html.index("the shortest brief that still asks for a test")
          and "arxiv.org/abs/2603.16045" in spec_html and "13 → 15" in spec_html and "6 → 7" in spec_html and "Where each pass left it" in spec_html and "pass 4: 75% · 9 of 12" in spec_html
          and "The flow" in spec_html and "Output spec<span>2 learned</span>" in html and d["briefs"].get("version") == 3 and sp["arrangement"]["flow"][0]["do"] == "draft", sp["learned"]["changesKept"])
    bare = data.load(Path(tmp) / "empty")
    check("a swarm that has learned nothing says so, and runs the arrangement every swarm starts from", bare["learned"]["ledger"] == [] and "Nothing yet" in swarm_ui.learned_block(dict(d, learned={"ledger": [], "passes": []})))
    check("what a slot is doing is two lines and never more or fewer, and the line above the arrangement is one: a card is the same height whatever it says, so nothing below moves as a pass runs",
          "-webkit-line-clamp:2" in html and "height:34px" in html and "#now span{white-space:nowrap" in html and "el.title=text" in html)
    # a page that goes away before its answer does is not a fault, and is not printed as one
    import io
    import socket
    import contextlib
    noise = io.StringIO()
    with contextlib.redirect_stderr(noise):
        for _ in range(6):
            sk = socket.create_connection(("127.0.0.1", srv.server_address[1]))
            sk.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            sk.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, __import__("struct").pack("ii", 1, 0))
            sk.close()  # gone at once, with the page still being written
        time.sleep(0.8)
    arr = html[html.index('class="panel arr"'):html.index('id="strategy"')]
    faces = re.findall(r'class="av ([a-z]+)[^"]*" data-av="([^"]+)"', arr)
    slot_ids = [s["id"] for s in d["briefs"]["slots"]]
    check("the arrangement is one section, drawn as faces: a roster of the models (each small model, the decider, the larger model, whose chip carries its live dot and opens its card), then the flow as stations in order, each slot a face of its model in the step it stands in, with its record as a ring, its own live dot and its whole name; the sandbox, which no model fills, is a marker between two stations; choosing a face opens that slot's card, with what it is told, below the row",
          'class="panel arr"' in arr and "The swarm as it stands" in arr and 'class="achips"' in arr and arr.count('class="mav ') == len(d["members"]) + 2
          and set(slot_ids) <= {k for _, k in faces} and all(m == next(s["member"] for s in d["briefs"]["slots"] if s["id"] == k) for m, k in faces if k in slot_ids)
          and "kev-decide" in [k for _, k in faces] and "target" not in [k for _, k in faces] and 'class="st mk"' not in arr
          and re.search(r'<button type="button" class="mav tgt" data-av="target"[^>]*>.*?data-live="target"', arr) and re.search(r'class="via" data-av="run"', arr)
          and arr.index('class="via" data-av="run"') > arr.index('data-av="a-direct"') and arr.index('class="via" data-av="run"') < arr.index('data-av="a-critic"')
          and all('data-live="%s"' % k in arr for k in slot_ids + ["target", "kev-decide", "run"]) and all('<template id="avt-%s">' % k in arr for k in slot_ids + ["target", "run"])
          and "b&#8209;other-<wbr>way" in arr and ">b&#8209;recompute<" in arr and "text-overflow:ellipsis;white-space:nowrap;line-height:1.2" not in html
          and "--p:" in arr and "Configurations at parity with it" in arr and "What it is told" in arr and "box.innerHTML=t.innerHTML" in html
          and 'class="stage' not in arr and 'class="panel target"' not in html, faces)
    # AN ANSWER NOBODY COMPARED IS NOT A WRONG ONE: code is compared by running it, so a slot's code with no mark from the trainer is
    # left out of its record rather than counted as not equivalent
    code_rows = [{"ref": "function f(x) {\n  return x;\n}", "grade": "right", "trace": [{"slot": "a-direct", "stage": "draft", "final": "function f(x) {\n  return x;\n}"},
                                                                                     {"slot": "a-writer", "stage": "write", "final": "x"}]},
                 {"ref": "42", "grade": "wrong", "trace": [{"slot": "a-direct", "stage": "draft", "final": "42"}, {"slot": "a-critic", "stage": "check", "final": "41", "same": False}]}]
    rr = data.slot_record(code_rows)
    check("an answer nobody compared is not counted as a wrong one: a slot's code with no mark from the trainer is left out of its record (answered, not judged), a short answer is judged by its words, a checker's mark is taken as it is, and the reply by its grade; the face says not judged rather than 0",
          rr.get("a-direct", {}).get("judged") == 1 and rr["a-direct"]["right"] == 1 and rr["a-direct"]["ran"] == 2 and rr.get("a-critic", {}).get("judged") == 1 and rr["a-critic"]["right"] == 0
          and rr.get("a-writer", {}).get("judged") == 1, rr)
    check("the models and what the swarm is equivalent on are one section, Configuration, that folds (open to begin with) and folded says in a line what the swarm is; the line is drawn again when either changes",
          '<details class="cfg fold" data-keep="cfg" open>' in html and html.index('data-keep="cfg"') < html.index('id="picks"') < html.index('id="equiv"') and 'id="cfg-meta"' in html
          and " · decided by " in html.split('id="cfg-meta">')[1][:200] and get(base + "/fragment/cfgmeta")[0] == 200 and "swap('/fragment/cfgmeta','#cfg-meta')" in html, html.split('id="cfg-meta">')[1][:160])
    check("a page that is closed or reloaded before its answer has been sent leaves nothing printed as an error, and the next request is answered as usual",
          "Traceback" not in noise.getvalue() and "BrokenPipe" not in noise.getvalue() and get(base + "/api/live")[0] == 200, noise.getvalue()[-300:])
    # ONE NUMBER, SAID ONE WAY: every place on the page that says how far the swarm is says the same percentage, from the same count
    P = held["parity"]
    same = "%s%%" % swarm_ui.fmt_pct(P["percent"])
    far = swarm_ui.how_far(P["equivalent"], P["compared"])
    spec_now = get(base + "/fragment/spec")[1]
    alone_pct = ["%s%%" % swarm_ui.fmt_pct(data.parity(r)["percent"]) for r in held["alone"].values() if r]
    check("every place that says how far the swarm is toward parity says the same percentage, worked out in one place from the same count: the strip (the header no longer repeats it), the whole measurement, the bars of each alone, the passes and the spec; and each small model alone is said the same way",
          ("%s of the way to parity with" % same) in top and "of the way to parity" not in html.split('id="chips"')[1].split("</header>")[0]
          and ("%s<small>%%</small>" % swarm_ui.fmt_pct(P["percent"])) in full and ("%s of the way to parity with" % same) in full and far in full and ("%s of the way to parity against" % same) in spec_now
          and ("<b>%s</b> of the way to parity." % same) in spec_now and all(a in top and a in full for a in alone_pct) and swarm_ui.how_far(25, 42) == "59.5% · 25 of 42"
          and data.percent(25, 42) == 59.5 and "Not at parity" not in html + full + spec_now and "Not yet" not in full, [same, far, alone_pct])
    kb = swarm_ui.kind_bars({"write-parsing": {"n": 8, "s": 1}, "trace": {"n": 8, "s": 8}, "fix": {"n": 8, "s": 5}, "something-new": {"n": 2, "s": 1}})
    check("each kind of question is a row: its name in words, a bar, and the percentage and count behind it, the furthest behind first, all of one kind equivalent marked as such; a kind with no name of its own is shown as it is",
          kb.count("<li") == 4 and kb.index("Write a function: parsing") < kb.index("Correct a function") < kb.index("Say what a program prints") and "<b>12.5%</b> · 1 of 8" in kb and "<b>100%</b> · 8 of 8" in kb
          and 'class="full"' in kb and 'class="low"' in kb and "something-new" in kb and "<svg" not in kb and "WRITE-PARSING" not in full, kb[:200])
    check("a row of the training card with no duration (a thing learned, a recovery) wraps inside the card: only a duration is kept on one line",
          ".steps li>span:nth-child(3){" in html and ".steps li>span:last-child{" not in html and ".steps li>span{min-width:0;overflow-wrap:anywhere}" in html)
    check("the page ends with a footer: whose product it is, its licence, and that the page is served from this machine",
          '<footer class="foot">' in html and "A Family Office product" in html and "apache.org/licenses/LICENSE-2.0" in html and "github.com/nseidm1/The-Swarm" in html and "Copyright 2026 Family Office" in html and "<svg" in html.split('<footer class="foot">')[1].split("</footer>")[0])
    check("it shows the arrangement being trained: every slot of both models by stage, what each is told, what is being tried, and the larger model alongside",
          all(s["id"] in html for s in d["briefs"]["slots"]) and html.count('class="slot a"') >= 4 and html.count('class="slot b"') >= 3 and "being trained" in html and "under test" not in html and "Trained every pass" not in html and 'class="side"' not in html and "Ask both" not in html and "What it is told" in html and "Being tried" in html and "arXiv 2610.21290" in html and "The larger model" in html and "tensorfold serve" in html)
    krow = next((r for sp in d["splits"].values() for r in sp["swarm"] if any(t["slot"] == "kev-decide" for t in r["trace"])), None)
    kfrag = get(base + "/fragment/question?split=%s&id=%s" % (krow["split"], urllib.request.quote(krow["id"])))[1] if krow else ""
    check("every slot is shown by the model that fills it and what it is for, with a line for what it is doing now; the decision model is in the decide step, and on a question shows what it picked and the probability it gave each answer",
          "kev-decide" in html and "Kev 4B" in html and "Decides which answer stands" in html and "Drafts it step by step" in html and html.count('data-live="') >= 9 and krow is not None and 'class="probs"' in kfrag and "Picked" in kfrag, bool(krow))
    # ---- choosing the models, the output spec, and an idea's paper
    reg = d["registry"]
    check("five pills lead the page: the two small models, the model that decides and the larger model, each a list of the models that can be chosen, grouped by who made them, with the one chosen marked; and the output spec",
          html.count('data-pick="') == 6 and 'data-pick="judge"' in html and "The decider itself" in html and 'class="specbtn" id="spec-open"' in html.split('id="chips"')[1].split("</header>")[0] and "spec-open" not in get(base + "/fragment/picks")[1] and "Add a model" in html and 'class="pick c add"' in html and ".picks{display:flex;flex-wrap:wrap" in html and html.count('class="group small n3"') == 1 and html.count('class="group against"') == 1 and html.count("<optgroup") >= 12 and all(m["name"] in html for m in reg["small"] + reg["targets"] + reg["deciders"]) and 'value="%s" selected' % d["members"]["a"]["id"] in html
          and 'value="%s" selected' % d["target"]["id"] in html and 'id="spec-open"' in html and len({m["by"].split(",")[0] for m in reg["small"]}) >= 6)

    def send(path, body, headers=None):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers=headers or {"x-swarm": "1", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as x:
            return x.code, ""

    other = next(m for m in reg["small"] if m["id"] not in (d["members"]["a"]["id"], d["members"]["b"]["id"]))
    code_ok, drawn = send("/config", {"a": other["id"]})
    after = json.loads((root / "src" / "config.json").read_text())
    check("choosing a model writes it down and draws again everything that depends on it, in place: the slots in that place carry the new model's name, and results of another arrangement are not shown as this one's",
          code_ok == 200 and after["a"] == other["id"] and other["name"] in drawn and ("Not measured yet" in drawn or "The swarm has not answered yet" in drawn) and "At parity with" not in drawn and "Not at parity with" not in drawn and after["b"] == d["members"]["b"]["id"], after)
    check("a model that is not one of those that can be chosen is refused, and so is a choice that does not come from this page",
          send("/config", {"a": "no-such-model"})[0] == 400 and send("/config", {"a": d["members"]["a"]["id"]}, {"content-type": "application/json"})[0] == 403 and json.loads((root / "src" / "config.json").read_text())["a"] == other["id"])
    send("/config", {"a": d["members"]["a"]["id"]})
    # a third and a fourth small model: added from the page, each with a part to begin with, and taken out again
    third, fourth = [m for m in reg["small"] if m["id"] not in (d["members"]["a"]["id"], d["members"]["b"]["id"])][:2]
    c3, with3 = send("/config", {"c": third["id"]})
    d3 = data.load(root)
    picks3 = get(base + "/fragment/picks")[1]
    c4, with4 = send("/config", {"d": fourth["id"]})
    cfg4 = json.loads((root / "src" / "config.json").read_text())
    cback, _ = send("/config", {"c": ""})
    cfg_up = json.loads((root / "src" / "config.json").read_text())
    send("/config", {"c": ""})
    cfg_two = json.loads((root / "src" / "config.json").read_text())
    check("a third and a fourth small model can be added from the page: each has a pill, begins as two drafting slots of its own, is part of what the configuration is called and of its spec; taking one out moves the next up; and with them out it is the two it was",
          c3 == 200 and list(d3["members"]) == ["a", "b", "c"] and d3["cfg"].count("+") == 3 and third["id"] in d3["cfg"] and with3.count('class="slot c"') == 2 and "c-direct" in with3 and third["name"] in with3
          and "Small model 3" in picks3 and 'class="pick d add"' in picks3 and "Add a model" in picks3 and "Remove it from the swarm" in picks3 and len(data.spec(d3)["members"]) == 3
          and c4 == 200 and cfg4.get("c") == third["id"] and cfg4.get("d") == fourth["id"] and with4.count('class="slot d"') == 2
          and cback == 200 and cfg_up.get("c") == fourth["id"] and "d" not in cfg_up and "c" not in cfg_two and "d" not in cfg_two and cfg_two["a"] == d["members"]["a"]["id"]
          and send("/config", {"d": fourth["id"]})[0] == 200 and json.loads((root / "src" / "config.json").read_text()).get("c") == fourth["id"] and send("/config", {"c": ""})[0] == 200, [c3, c4, cfg4, cfg_up, cfg_two])
    row = swarm_ui.equiv(data.load(root))
    e_ok, _ = send("/config", {"equivalence": ["reasoning", "crew"]})
    e_cfg = json.loads((root / "src" / "config.json").read_text())
    row2 = get(base + "/fragment/equiv")[1]
    check("under the models, a box to tick for each body of work the swarm can be brought to equivalence on: The Crew ticked where nothing was chosen, then Math, Logic and Reasoning, each saying what it is; ticking writes the choice down in the list's own order beside the models, and the row is drawn again in place with what a pass will now ask; none, or one that is not listed, is refused and nothing is written",
          row.startswith('<fieldset class="equiv" id="equiv">') and row.count('data-equiv="') == 4 and row.count(" checked") == 1 and 'data-equiv="crew" checked' in row and "<b>The Crew</b>" in row and "<b>Math</b>" in row and "<b>Logic</b>" in row and "<b>Reasoning</b>" in row
          and "14 kinds of question in a pass" in row and 'id="equiv"' in html and html.index('id="picks"') < html.index('id="equiv"') < html.index('id="body"')
          and e_ok == 200 and e_cfg["equivalence"] == ["crew", "reasoning"] and e_cfg["a"] == d["members"]["a"]["id"] and not row2.startswith("<fieldset") and row2.count(" checked") == 2 and "17 kinds of question in a pass" in row2
          and send("/config", {"equivalence": []})[0] == 400 and send("/config", {"equivalence": ["crew", "poetry"]})[0] == 400 and send("/config", {"equivalence": "crew"})[0] == 400
          and json.loads((root / "src" / "config.json").read_text())["equivalence"] == ["crew", "reasoning"] and send("/config", {"equivalence": ["crew"]})[0] == 200, [e_ok, e_cfg.get("equivalence"), row.count(" checked")])
    pens = swarm_ui.equiv(data.load(root))
    panel_q = get(base + "/fragment/questions?id=crew")[1]
    q_ok, q_row = send("/questions", {"id": "crew", "questions": [{"ask": "  Move my dentist to Friday.  "}, {"ask": "Is a sleep a fix?", "mode": "developer"}, {"ask": " "}]})
    q_file = json.loads((root / "training" / "questions" / "crew.json").read_text())
    panel_q2 = get(base + "/fragment/questions?id=crew")[1]
    m_ok, _ = send("/questions", {"id": "math", "questions": [{"ask": "What is 17 times 23?", "mode": "developer"}]})
    m_file = json.loads((root / "training" / "questions" / "math.json").read_text())
    check("each body of work has a little pencil at its top right that opens its questions: the kinds the trainer makes (not edited) and the questions a person wrote, one row each, with Simple or Developer for The Crew; saving writes them whole (blank ones dropped, a mode only where it means something), the box then says how many there are, and the next opening shows them; an unknown body of work, more than 200, or a list that is not one is refused",
          pens.count('class="pencil"') == 4 and 'data-qedit="crew"' in pens and "Edit the questions for The Crew" in pens and 'id="qedit"' in html
          and "Questions: The Crew" in panel_q and "Made by the trainer" in panel_q and "Simple: a piece of writing" in panel_q and "Developer: their own project" in panel_q and "Write a function: arrays" in panel_q and panel_q.count('class="qrow"') == 1 and "0 of 200" in panel_q
          and q_ok == 200 and q_file == {"questions": [{"ask": "Move my dentist to Friday."}, {"ask": "Is a sleep a fix?", "mode": "developer"}]} and "2 of your own" in q_row and "15 kinds of question in a pass" in q_row
          and panel_q2.count('class="qrow"') == 3 and "Move my dentist to Friday." in panel_q2 and '<option value="developer" selected>' in panel_q2 and "2 of 200" in panel_q2
          and m_ok == 200 and m_file == {"questions": [{"ask": "What is 17 times 23?"}]} and "data-q-mode" not in get(base + "/fragment/questions?id=math")[1].split("<template")[0]
          and send("/questions", {"id": "poetry", "questions": []})[0] == 400 and send("/questions", {"id": "crew", "questions": "x"})[0] == 400 and send("/questions", {"id": "crew", "questions": [{"ask": "q"}] * 201})[0] == 400
          and json.loads((root / "training" / "questions" / "crew.json").read_text()) == q_file and "nothing called that" in get(base + "/fragment/questions?id=nope")[1], [q_ok, q_file, m_file])
    dm = dict(d, machine=["mac"])
    sel = re.search(r'<select data-pick="decider".*?</select>', swarm_ui.pills(dm), re.S).group(0)
    names = re.findall(r'<option value="([^"]+)"', sel)
    check("the Decides pill lists every decider best first by its Decision Index score, says the score beside each, and on a machine that cannot run one lists it greyed out with what it needs; the one chosen is shown by its name alone",
          names[0] == "karpo-31b" and 'value="karpo-31b" disabled' in sel and "needs an NVIDIA GPU with 80 GB" in sel and "StartLux Decision 4B · index 54.8 · about 5.5 GB<" in sel
          and 'value="startlux-4b" disabled' not in sel and "(an older checkpoint)" in sel and 'value="kev-4b" selected>Kev 4B<' in sel and len(names) == len(d["registry"]["deciders"]) == 23
          and 'value="karpo-31b" disabled' not in re.search(r'<select data-pick="decider".*?</select>', swarm_ui.pills(dict(d, machine=["cuda"])), re.S).group(0), names[:3])
    # the Uninstall Helper, on a made-up .work: a model file, a model that is a link to a file kept elsewhere, a decider's weights
    w = root / ".work"
    (w / "models").mkdir(parents=True, exist_ok=True)
    small0 = reg["small"][0]
    (w / "models" / small0["file"]).write_bytes(b"x" * 4096)
    outside = Path(tempfile.mkdtemp()) / "kept-elsewhere.gguf"
    outside.write_bytes(b"y" * 8192)
    link_name = reg["small"][1]["file"]
    if (w / "models" / link_name).exists() or (w / "models" / link_name).is_symlink():
        (w / "models" / link_name).unlink()
    os.symlink(outside, w / "models" / link_name)
    (w / "deciders" / "startlux-4b" / "model").mkdir(parents=True, exist_ok=True)
    (w / "deciders" / "startlux-4b" / "model" / "w.safetensors").write_bytes(b"z" * 20000)
    (w / "train" / "measured").mkdir(parents=True, exist_ok=True)
    (w / "train" / "measured" / "m.json").write_text("{}")
    tidy = get(base + "/fragment/tidy")[1]
    chips_html = swarm_ui.chips(d)
    t_link = send("/uninstall", {"id": "model:" + link_name})
    t_dir = send("/uninstall", {"id": "decider:startlux-4b"})
    t_bad = send("/uninstall", {"id": "../../etc"})[0]
    t_none = send("/uninstall", {"id": "engine"})[0]
    t_foreign = send("/uninstall", {"id": "model:" + small0["file"]}, {"content-type": "application/json"})[0]
    check("an Uninstall Helper beside the output spec lists what the Swarm has put in .work, by group, with the room each takes and whether the configured swarm uses it; removing one asks first in the page, then takes out exactly that piece: a model that is a link loses only the link and the file it points at is kept, a folder goes whole; an id that is not on the list, one with nothing there, or a request not from this page is refused",
          'id="tidy-open"' in chips_html and "Uninstall Helper" in chips_html and 'id="tidy"' in html
          and "Uninstall Helper" in tidy and "Models" in tidy and "Deciders" in tidy and "StartLux Decision 4B: weights" in tidy and 'data-tidy="model:%s"' % small0["file"] in tidy
          and "A link to" in tidy and "only the link is removed" in tidy and "in use" in tidy and "cannot be undone" in tidy and "Measurements kept so as not to ask twice" in tidy
          and "confirm('Remove '" in html
          and t_link[0] == 200 and not os.path.lexists(w / "models" / link_name) and outside.exists() and outside.stat().st_size == 8192 and "freed" in t_link[1]
          and t_dir[0] == 200 and not (w / "deciders" / "startlux-4b").exists() and 'data-tidy="decider:startlux-4b"' not in t_dir[1] and "Removed StartLux Decision 4B: weights" in t_dir[1]
          and t_bad == 400 and t_none == 400 and t_foreign == 403 and (w / "models" / small0["file"]).exists(), [t_link[0], t_dir[0], t_bad, t_none, t_foreign])
    # STEER IT: a plan of this pass with moves and every open move listed; then focus, queue, skip, and refusals
    wdp = root / ".work" / "train" / d["key"]  # this configuration's own folder, which the page writes the steering record into
    made_wdp = not wdp.exists()
    wdp.mkdir(parents=True, exist_ok=True)
    plan_file = wdp / "plan.json"
    had_plan = plan_file.read_text() if plan_file.exists() else None
    plan_file.write_text(json.dumps({"pass": d["state"]["pass"] + 1, "config": d["cfg"], "target": d["target"]["id"], "basedOn": "this-pass", "moves": [
        {"id": "arrange:aaa111", "kind": "arrangement", "technique": "The order of steps", "what": "flow: no check", "status": "planned", "order": 1, "why": []},
        {"id": "brief:a-critic:bbb222", "kind": "brief", "slot": "a-critic", "stage": "check", "model": "LFM2.5", "technique": "What the slot is told", "what": "the larger model: checker", "status": "planned", "order": 2, "why": []}],
        "catalog": [{"id": "arrange:ccc333", "kind": "arrangement", "area": "loops", "what": "flow: a tournament: the decider keeps the likeliest three", "technique": "A change to the arrangement", "slot": ""},
                    {"id": "arrange:aaa111", "kind": "arrangement", "area": "flow", "what": "flow: no check", "technique": "The order of steps", "slot": ""}]}))
    pl0 = get(base + "/fragment/plan")[1]
    f_ok, after_f = send("/steer", {"op": "focus", "area": "loops", "value": "only"})
    p_ok, after_p = send("/steer", {"op": "pin", "id": "arrange:ccc333"})
    k_ok, after_k = send("/steer", {"op": "skip", "id": "arrange:aaa111"})
    sv = json.loads((wdp / "steer.json").read_text())
    dlg = get(base + "/fragment/steer")[1]
    bad = [send("/steer", x)[0] for x in ({"op": "focus", "area": "nowhere", "value": "more"}, {"op": "pin", "id": "../../etc"}, {"op": "explode"}, ["not", "an", "object"])]
    unp, after_u = send("/steer", {"op": "unpin", "id": "arrange:ccc333"})
    check("a person can steer the plan from the page: lean the search on an area (less, as planned, more, only), put any move first or skip one, and choose from every move open to this pass in a dialog with a search box; each choice is written to this configuration's steering record and the plan is drawn again with it; a move is queued or skipped, never both; anything else is refused",
          "Steer it" in pl0 and pl0.count("data-steer-focus=") == 24 and 'data-steer="pin" data-id="arrange:aaa111"' in pl0 and 'data-steer="skip" data-id="brief:a-critic:bbb222"' in pl0 and "Choose any move" in pl0
          and f_ok == 200 and 'data-steer-focus="loops" data-v="only" aria-pressed="true"' in after_f
          and p_ok == 200 and "flow: a tournament: the decider keeps the likeliest three" in after_p.split("Your queue")[1] and k_ok == 200 and 'class="planned skipped"' in after_k and ">Skipped<" in after_k
          and sv["focus"] == {"loops": "only"} and sv["pin"] == ["arrange:ccc333"] and sv["skip"] == ["arrange:aaa111"]
          and "Choose any move" in dlg and 'id="steer-find"' in dlg and "Decider loops" in dlg and ">queued<" in dlg and 'data-steer="pin" data-id="arrange:aaa111"' in dlg
          and bad == [400, 400, 400, 400] and unp == 200 and json.loads((wdp / "steer.json").read_text())["pin"] == [], [f_ok, p_ok, k_ok, bad, sv])
    check("each subsection of the plan (the gap, what the measurement showed, how it is training, steer it, the moves...) folds under its heading, folded to begin with and saying in a line what it holds while folded, and kept open or folded on the device like the training card's",
          all(('data-keep="plan-%s">' % k) in after_u for k in ("steer-it", "how-it-is-training", "moves-in-plan-order")) and after_u.count('<details class="psec"') == after_u.count("<h4>")
          and " open>" not in after_u.split('class="psec"')[1][:80] and after_u.count('class="pmeta"') >= 3 and "up to 8 changes a question" in after_u and "Decider loops only · 1 skipped · nothing queued" in after_u and "2 moves · 0 tried · 0 kept" in after_u
          and after_u.rstrip().endswith("</div>") and swarm_ui.fold_sections('<div class="panel"><p>x</p></div>', "p") == '<div class="panel"><p>x</p></div>', after_u.count("<h4>"))
    (wdp / "steer.json").unlink()
    if had_plan is None:
        plan_file.unlink()
    else:
        plan_file.write_text(had_plan)
    if made_wdp:
        shutil.rmtree(wdp)
    # RECOMMENDED CONFIGURATION CHANGES: from what the probe and the replay measured for this configuration
    wdr = root / ".work" / "train" / d["key"]
    made_r = not wdr.exists()
    wdr.mkdir(parents=True, exist_ok=True)
    none_yet = swarm_ui.config_section(data.load(root))
    (wdr / "decider-replay.json").write_text(json.dumps({"pass": 5, "results": [{"decider": "startlux-4b", "asked": 46, "kevRight": 37, "theirsRight": 38, "recovered": 4, "lost": 3}, {"decider": "kev-9b", "asked": 46, "kevRight": 37, "theirsRight": 35, "recovered": 1, "lost": 3}]}))
    (wdr / "members.json").write_text(json.dumps({"pass": 5, "gap": 19, "of": 70, "models": [], "notHere": [{"id": "qwen35-2b", "name": "Qwen3.5 2B", "bytes": 1280835840}, {"id": "qwen3-4b", "name": "Qwen3 4B", "bytes": 2497280256}]}))
    dr = data.load(root)
    rs = swarm_ui.recommendations(dr)
    # (a judge apart from the decider is recommended only where one can run on this machine beside it: on a Mac, yes; on a
    # Linux machine with no GPU, as CI is, no decision model runs at all. The checks follow the same rule, on any machine)
    cap_ = max(6.0, float((dr.get("decider") or {}).get("memGb") or 0))
    judge_here = int(any(m["id"] != (dr.get("decider") or {}).get("id") and (not m.get("runsOn") or set(m["runsOn"]) & set(dr.get("machine") or []))
                         and float(m.get("memGb") or 99) <= cap_ for m in dr["registry"]["deciders"]))
    sec = swarm_ui.config_section(dr)
    pop = get(base + "/fragment/recs")[1]
    was_cfg = json.loads((root / "src" / "config.json").read_text())
    ap = send("/config", rs[0]["apply"])[0] if rs else 0
    now_cfg = json.loads((root / "src" / "config.json").read_text())
    check("beside Configuration, a note says when the evidence recommends a change to it, and opens them: each with what it rests on (measured: another decider that recovered more recorded choices than it lost; untested: a third small model where no slot drafted the answer and no other model was here to ask), and a button that makes the change as a pill does; a decider that lost more than it recovered is not recommended; with no evidence there is no note",
          ('id="rec-open"' not in none_yet or "1 recommendation<" in none_yet) and [r["id"] for r in rs if not r["id"].startswith("judge:")] == ["decider:startlux-4b", "member:qwen35-2b"] and [r["strength"] for r in rs if not r["id"].startswith("judge:")] == ["measured", "untested"]
          and ("%d recommendations" % (2 + judge_here)) in sec and 'id="recd"' in html and "Decide with StartLux Decision 4B" in pop and "recovered 4" in pop and "Untested" in pop and "Qwen3.5 2B" in pop and "kev-9b" not in pop and "Kev 9B" not in pop
          and pop.count("data-rec-apply") == 2 + judge_here and any(r["id"].startswith("judge:") for r in rs) == bool(judge_here) and ap == 200 and now_cfg.get("decider") == "startlux-4b" and "stopPropagation" in html, [r["id"] for r in rs])
    # WHAT THE CONFIGURATION'S OWN ANSWERS SAY, AS THEY ARRIVE (ui/data.py session_evidence), and what is recommended from it
    def row(i, right=True):
        tr = [{"slot": "a-direct", "member": "a", "stage": "draft", "letter": "A", "final": "x" if right else "y", "tokens": 700, "ms": 6000},
              {"slot": "b-direct", "member": "b", "stage": "draft", "letter": "B", "final": "x" if right else "z", "tokens": 100, "ms": 3000},
              {"slot": "c-direct", "member": "c", "stage": "draft", "letter": "C", "final": "q", "tokens": 80, "ms": 900},
              {"slot": "c-other-way", "member": "c", "stage": "draft", "letter": "D", "final": "q", "tokens": 80, "ms": 1100},
              {"slot": "kev-decide", "member": "kev", "stage": "decide", "ok": i % 4 != 0, "ms": 5800,
               "out": "Decided nothing: Kev did not answer: The operation was aborted due to timeout." if i % 4 == 0 else "Picked A."}]
        return {"grade": "right" if right else "wrong", "decided": "x" if right else "y", "tried": {"groups": [["A", "B"], ["C", "D"]]}, "trace": tr}
    rows_ = [row(i, i < 24) for i in range(30)]
    sl = d["briefs"]["slots"] + [{"id": "c-direct", "member": "c", "stage": "draft", "maxTokens": 700}, {"id": "c-other-way", "member": "c", "stage": "draft", "maxTokens": 700}]
    sl = [dict(x, maxTokens=700) for x in sl]
    ev = data.session_evidence(rows_, sl)
    third = next(m for m in d["registry"]["small"] if m["id"] == "lfm25-1.2b")
    dd = dict(data.load(root), evidence=dict(ev, otherDeciders={}))
    dd["members"] = dict(dd["members"], c=third)
    dd["briefs"] = dict(dd["briefs"], slots=sl)
    rs3 = swarm_ui.recommendations(dd)
    by3 = {r["id"]: r for r in rs3}
    # a decider whose misses were not its wait: the decider before it (with a better record on the same small models) is recommended
    ev2 = dict(ev, decider={"n": 30, "failed": 8, "timedOut": 0, "retried": 0},
               otherDeciders={"+".join([dd["members"]["a"]["id"], dd["members"]["b"]["id"], third["id"], "kev-9b"]): {"n": 400, "failed": 0, "timedOut": 0}})
    by4 = {r["id"]: r for r in swarm_ui.recommendations(dict(dd, evidence=ev2))}
    early = {r["id"]: r for r in swarm_ui.recommendations(dict(dd, evidence=dict(ev, traced=12, members={"a": {"inwin": 12, "sole": 4}, "b": {"inwin": 9, "sole": 0}, "c": {"inwin": 1, "sole": 0}})))}
    check("a configuration's own answers are read as they arrive: each slot's failures and token-limit stops, the decider's timeouts, which model's drafts held each right answer (and which alone), and how often two slots on one model did the same",
          ev["answers"] == 30 and ev["traced"] == 24 and ev["members"]["a"] == {"inwin": 24, "sole": 0} and ev["members"].get("c") is None and ev["pairs"]["c-direct+c-other-way"] == [30, 30]
          and ev["slots"]["a-direct"]["capped"] == 30 and ev["slots"]["b-direct"]["capped"] == 0 and ev["decider"] == {"n": 30, "failed": 8, "timedOut": 8, "retried": 0}, ev)
    check("from them: a third model whose drafts held no right answer the others did not is recommended out of the swarm (with what it saves, and its two slots echoing), early on fewer than 20 traced answers; a decider whose misses were all its wait is not blamed (the wait now grows: for training, no button); one that failed otherwise is recommended back to the decider before it, by its record; slots cut off at their token limit are for training, which measures more room itself; each says how many answers it rests on; only what a person can change is counted in the note",
          by3.get("drop:c", {}).get("apply") == {"c": ""} and by3["drop:c"]["strength"] == "measured" and by3["drop:c"]["n"] == 24 and "saves 0.7 GB" in by3["drop:c"]["cost"] and "30 times of 30" in by3["drop:c"]["why"]
          and by3.get("decider-wait", {}).get("apply") is None and by3["decider-wait"]["strength"] == "info" and "8 times of 30" in by3["decider-wait"]["why"]
          and by3.get("capped", {}).get("apply") is None and "a-direct stopped at its limit of 700 on 30 of 30" in by3["capped"]["why"]
          and by4.get("decider-back:kev-9b", {}).get("apply") == {"decider": "kev-9b"} and "decider-wait" not in by4
          and early["drop:c"]["strength"] == "early" and all("n" in r for r in rs3)
          and len([r for r in rs3 if r.get("apply")]) == len([r for r in rs3 if r["strength"] != "info"]), [(r["id"], r["strength"]) for r in rs3])
    # TAKING ONE DOES NOT UNDO ANOTHER: the decider changed is a new configuration with no record of its own; what was measured on
    # the same small models still stands (the third model is still recommended, said where it was measured), the way back to the
    # configuration it came from is not recommended (one not yet measured is not behind), and taking the third keeps the decider
    rs2 = swarm_ui.recommendations(data.load(root))
    pop2 = get(base + "/fragment/recs")[1]
    ap2 = send("/config", next((r["apply"] for r in rs2 if r["id"].startswith("member:")), {}))[0]
    after = json.loads((root / "src" / "config.json").read_text())
    check("taking a recommended change does not undo one taken before it: with the decider changed, the third small model is still recommended, from the record of the same small models (and says so), nothing recommends going back, and taking it keeps the new decider",
          [r["id"] for r in rs2 if not r["id"].startswith("judge:")] == ["member:qwen35-2b"] and "decided by Kev" in pop2 and ap2 == 200
          and after.get("decider") == "startlux-4b" and after.get("c") == "qwen35-2b", ([r["id"] for r in rs2], after))
    (root / "src" / "config.json").write_text(json.dumps(was_cfg, indent=2) + "\n")
    for fn in ("decider-replay.json", "members.json"):
        (wdr / fn).unlink()
    if made_r:
        shutil.rmtree(wdr)
    # WHAT OTHER CONFIGURATIONS MEASURED is evidence for this one: a small model measured alone against the same larger model, and
    # another configuration further along against it (each keeps its own record; these read them, never write them)
    res, sts = root / "training" / "results", root / "training" / "states"
    res.mkdir(parents=True, exist_ok=True)
    sts.mkdir(parents=True, exist_ok=True)
    made = []
    for mid, right in (("lfm25-2.6b", 19), ("bonsai2-2b", 11), ("qwen35-4b", 30), ("gemma4-e2b", 13)):
        fp = res / ("%s-alone-vs-nemotron35-30b-held.json" % mid)
        fp.write_text(json.dumps({"right": right, "compared": 42}))
        made.append(fp)
    for key, eq in (("qwen35-4b+gemma4-e4b+startlux-4b--nemotron35-30b", 40), ("qwen3-4b+gemma4-e2b+kev-4b--nemotron35-30b", 20)):
        fp = sts / (key + ".json")
        fp.write_text(json.dumps({"history": [{"pass": 1, "equivalent": eq - 2, "compared": 42}, {"pass": 2, "equivalent": eq, "compared": 42}]}))
        made.append(fp)
    fp = sts / (d["key"] + ".json")
    mine_existed = fp.exists()
    if not mine_existed:
        fp.write_text(json.dumps({"history": [{"pass": 1, "equivalent": 1, "compared": 42}]}))
        made.append(fp)
    ra = swarm_ui.recommendations(data.load(root))
    by = {r["id"]: r for r in ra}
    sw, cf = by.get("swap:b:qwen35-4b"), by.get("config:qwen35-4b+gemma4-e4b+startlux-4b--nemotron35-30b")
    check("what other configurations measured becomes a recommendation here: a small model that, alone against the same larger model, answered as it did more often than the weakest member (by 5 points or more) is recommended in that member's place; a configuration further along against the same larger model is recommended with its members and decider; one behind this configuration, or a model below the bar, is not; each says what it rests on",
          sw and sw["apply"] == {"b": "qwen35-4b"} and sw["strength"] == "measured" and "30 of 42" in sw["why"] and "Bonsai 2 2B" in sw["title"]
          and cf and cf["apply"] == {"a": "qwen35-4b", "b": "gemma4-e4b", "c": "", "d": "", "decider": "startlux-4b"} and "95.2%" in cf["why"] and "2 passes" in cf["why"]
          and not any("gemma4-e2b" in i for i in by) and not any("qwen3-4b+" in i for i in by), list(by))
    for fp in made:
        fp.unlink()
    # a .work whose models folder is a link to somewhere else: nothing there is removed
    esc_root = Path(tempfile.mkdtemp())
    far = Path(tempfile.mkdtemp())
    (far / "precious.gguf").write_bytes(b"p")
    (esc_root / ".work").mkdir()
    os.symlink(far, esc_root / ".work" / "models")
    esc_ok, esc_said = cleanup.remove(esc_root, {"registry": {"small": [], "targets": [], "deciders": []}}, "model:precious.gguf")
    check("nothing outside .work is ever removed: a .work whose models folder is a link elsewhere has its files listed, and removing one is refused, the file kept",
          not esc_ok and "not inside .work" in esc_said and (far / "precious.gguf").exists(), esc_said)
    code_s, sp = get(base + "/fragment/spec")
    spec = data.spec(data.load(root))
    check("the output spec says what the swarm as it stands is: what goes in and comes out, each model with its pinned file and SHA-256, the decider, every slot and what it is for, and where it stands against the larger model, to read and to copy as JSON",
          code_s == 200 and "Output spec" in sp and d["members"]["a"]["sha256"] in sp and d["members"]["b"]["file"] in sp and "kev-decide" in sp and ("% of the way to parity against" in sp or "At parity against" in sp) and spec["trainedAgainst"]["progressPercent"] == p["percent"] and 'id="spec-json"' in sp
          and "As a model chooser lists it" in sp and "What it is told" in sp and 'id="spec-save"' in sp and "Commercial use" in sp and "swarm-spec.json" in html
          and spec["trainedAgainst"]["state"] in ("at parity", "not at parity") and spec["trainedAgainst"]["equivalent"] == p["equivalent"] and len(spec["arrangement"]["slots"]) == len(d["briefs"]["slots"])
          and spec["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and spec["interface"]["out"] == "one reply" and "fundamentally equivalent" in spec["trainedAgainst"]["parityMeans"], sp[:200])
    # TURNS WITH TOOLS: who takes an agent's turn is a toggle in Configuration, saved beside the models, said in the folded line, and
    # part of the spec's recipe and of what it says it can do
    tg0 = get(base + "/")[1]
    lead_spec = data.spec(data.load(root))
    ida, idb = d["members"]["a"]["id"], d["members"]["b"]["id"]
    nb = d["members"]["b"]["name"]
    b_ok = send("/config", {"tools": idb})[0]
    b_cfg = json.loads((root / "src" / "config.json").read_text())
    b_row, b_meta, b_spec = get(base + "/fragment/tools")[1], get(base + "/fragment/cfgmeta")[1], data.spec(data.load(root))
    t_ok = send("/config", {"tools": "swarm"})[0]
    t_bad = send("/config", {"tools": "sometimes"})[0]
    t_out = send("/config", {"tools": "qwen3-4b"})[0]  # a small model, but not one in this swarm
    t_cfg = json.loads((root / "src" / "config.json").read_text())
    t_row, t_meta = get(base + "/fragment/tools")[1], get(base + "/fragment/cfgmeta")[1]
    sw_spec = data.spec(data.load(root))
    l_ok = send("/config", {"tools": "lead"})[0]
    l_cfg = json.loads((root / "src" / "config.json").read_text())
    check("who takes an agent's turn (a request with tools) is a choice in Configuration: the swarm, or any one of its small models by name (the list is the swarm's own small models, and is drawn again when a pill changes); the model in place a where nothing is chosen; saved by the model's id, said in the folded line, part of the spec's recipe and of what it says it can do; a model not in the swarm, or any other word, is refused",
          'id="tools"' in tg0 and 'data-tools="swarm"' in tg0 and ('class="seg on" data-tools="%s"' % ida) in tg0 and ('data-tools="%s"' % idb) in tg0 and ("%s alone" % nb) in tg0
          and "%s alone" % d["members"]["a"]["name"] in tg0 and "swap('/fragment/tools','#tools')" in tg0 and tg0.count("swap('/fragment/tools','#tools')") >= 3
          and b_ok == 200 and b_cfg.get("tools") == idb and ('class="seg on" data-tools="%s"' % idb) in b_row and ("%s alone" % nb) in b_meta and not b_row.startswith("<fieldset")
          and b_spec["recipe"]["serving"]["tools"] == idb and nb in b_spec["interface"]["capabilities"]["tools"] and lead_spec["recipe"]["serving"]["tools"] == ida
          and t_ok == 200 and t_bad == 400 and t_out == 400 and t_cfg.get("tools") == "swarm" and 'class="seg on" data-tools="swarm"' in t_row and "the swarm decides" in t_meta
          and sw_spec["recipe"]["serving"]["tools"] == "swarm" and sw_spec["spec"]["recipeSha256"] != lead_spec["spec"]["recipeSha256"]
          and sw_spec["interface"]["capabilities"]["toolsMode"] == "swarm" and "decided by the swarm" in sw_spec["interface"]["capabilities"]["tools"] and not any("tools goes to" in x for x in sw_spec["interface"]["notYet"])
          and l_ok == 200 and l_cfg.get("tools") == ida and data.tools_of("no-longer-here", d["members"]) == "a" and data.tools_of(idb, d["members"]) == "b",
          [b_ok, t_ok, t_bad, t_out, l_ok, b_cfg.get("tools"), t_cfg.get("tools"), l_cfg.get("tools")])
    # THE NOISE FLOOR AND THE UNDECIDED: the larger model against itself, and the swarm's different answers the reader could not decide
    dn = data.load(root)
    sw_rows = [dict(r) for r in dn["splits"]["held"]["swarm"]]
    wrong = [r for r in sw_rows if r.get("grade") == "wrong"]
    if wrong:
        wrong[0]["undecided"] = True
    selfr = [dict(r, grade="right") for r in dn["splits"]["held"]["swarm"]]
    if selfr:
        selfr[0]["grade"] = "wrong"
    held_n = dict(dn["splits"]["held"], swarm=sw_rows, parity=data.parity(sw_rows), self=selfr)
    dn2 = dict(dn, splits=dict(dn["splits"], held=held_n))
    strip_n, board_n, spec_n = swarm_ui.score_strip(dn2), swarm_ui.scoreboard(dn2), data.spec(dn2)
    check("the larger model against itself is shown beside parity (asked again, judged against its own first answers: the noise floor), in the card, its chips, the whole measurement and the spec; and the swarm's different answers the reader could not decide are counted apart, in the verdict and the spec",
          ("asked again" in strip_n) and "against itself" in strip_n and "the noise floor" in board_n
          and spec_n["trainedAgainst"]["selfAgreement"] == {"equivalent": len(selfr) - 1, "compared": len(selfr), "percent": data.percent(len(selfr) - 1, len(selfr))}
          and (not wrong or (spec_n["trainedAgainst"]["undecided"] == 1 and "the reader could not decide" in strip_n and data.parity(sw_rows)["undecided"] == 1))
          and data.spec(dn)["trainedAgainst"]["selfAgreement"] is None, [strip_n[:120]])
    # A JUDGE OF EQUIVALENCE APART FROM THE DECIDER: a pill beside Decides; the decider itself where none is chosen
    j_before = swarm_ui.recommendations(data.load(root))
    j_ok = send("/config", {"judge": "startlux-4b"})[0]
    j_cfg = json.loads((root / "src" / "config.json").read_text())
    dj = data.load(root)
    j_meta, j_picks, j_spec, j_recs = get(base + "/fragment/cfgmeta")[1], get(base + "/fragment/picks")[1], data.spec(dj), swarm_ui.recommendations(dj)
    j_same = send("/config", {"judge": dj["decider"]["id"]})[0]
    j_cfg2 = json.loads((root / "src" / "config.json").read_text())
    j_bad = send("/config", {"judge": "no-such-decider"})[0]
    j_off = send("/config", {"judge": ""})[0]
    j_cfg3 = json.loads((root / "src" / "config.json").read_text())
    check("equivalence can be judged by a decision model apart from the decider: a pill beside Decides, the decider itself where none is chosen (and recommended once answers are being judged, a model that fits beside the decider); choosing one saves it, says so in the folded line and the spec, and the recommendation goes; choosing the decider, or none, is the decider itself again; an unknown one is refused",
          any(r["id"].startswith("judge:") for r in j_before) == bool(judge_here) and j_ok == 200 and j_cfg.get("judge") == "startlux-4b" and "judged by StartLux Decision 4B" in j_meta
          and 'value="startlux-4b" selected' in j_picks.split('data-pick="judge"')[1].split("</select>")[0] and j_spec["trainedAgainst"]["judgedBy"] == "StartLux Decision 4B"
          and not any(r["id"].startswith("judge:") for r in j_recs) and j_same == 200 and "judge" not in j_cfg2 and j_bad == 400 and j_off == 200 and "judge" not in j_cfg3
          and "(the decider itself)" in data.spec(data.load(root))["trainedAgainst"]["judgedBy"], [j_ok, j_cfg.get("judge"), j_same, j_bad, j_off])
    # THE PASS IN HAND IS IN THE SPEC, and ANOTHER CONFIGURATION'S ANSWERS NEVER STAND IN FOR THIS ONE'S (found 2026-11-16: a newer
    # configuration was read as 40 of its 84 train answers, another's checkpoint of the same questions being read after its rows)
    d0 = data.load(root)
    n_train = len(d0["splits"]["train"]["swarm"])
    ckd2 = root / ".work" / "train" / "checkpoints"
    ckd2.mkdir(parents=True, exist_ok=True)
    other = ckd2 / "measure-swarm-other-config-train.jsonl"
    other.write_text("".join(json.dumps(dict(r, cfg="some+other+config", grade="wrong")) + "\n" for r in d0["splits"]["train"]["swarm"]))
    d1 = data.load(root)
    other.unlink()
    wd_ = root / ".work" / "train" / d0["key"]
    wd_.mkdir(parents=True, exist_ok=True)
    plan_f = wd_ / "plan.json"
    had_plan = plan_f.read_text() if plan_f.exists() else None
    plan_f.write_text(json.dumps({"pass": int(d0["state"].get("pass", 0)) + 1, "config": d0["cfg"], "at": "2026-11-16T20:29:25Z", "moves": [
        {"kind": "brief", "what": "a shorter brief", "slot": "a-critic", "status": "running"}, {"kind": "arrangement", "what": "drop a-steps", "status": "planned"},
        {"kind": "brief", "what": "a brief tried", "slot": "a-steps", "status": "not kept", "result": {"train": {"right": 3, "wrong": 4}, "why": "it did not win by 6"}}]}))
    s_ip = data.spec(data.load(root))["inProgress"]
    dlg = get(base + "/fragment/spec")[1]
    if had_plan is None:
        plan_f.unlink()
    else:
        plan_f.write_text(had_plan)
    check("the spec says what the pass in hand has done (the parts below it speak of finished passes): its number and when it began, the swarm on this pass's train questions (said not to be parity), what is being measured now, and each move measured with its result; and another configuration's answers to the same questions, read later, never stand in for this configuration's",
          len(d1["splits"]["train"]["swarm"]) == n_train and d1["splits"]["train"]["parity"] == d0["splits"]["train"]["parity"]
          and s_ip and s_ip["pass"] == int(d0["state"].get("pass", 0)) + 1 and s_ip["moves"] == {"planned": 1, "beingMeasured": 1, "kept": 0, "notKept": 1}
          and s_ip["now"][0]["what"] == "a shorter brief" and s_ip["measured"][0]["status"] == "not kept" and s_ip["measured"][0]["why"] == "it did not win by 6"
          and (s_ip["trainSoFar"] is None or "not parity" in s_ip["trainIs"]) and "This pass, under way" in dlg and "a brief tried" in dlg, [n_train, len(d1["splits"]["train"]["swarm"]), s_ip and s_ip["moves"]])
    # ON A PHONE, THE TRAINING COLUMN IS A TILE BESIDE THE TITLE, opening the column whole in a sheet (and nothing changes elsewhere)
    mt = get(base + "/fragment/mtile")[1]
    check("on a phone the training column is a tile beside the title: what the session is doing (idle, stopped, or running with its clock and where it is) and the passes in a line; tapping it moves the column itself (Training, Passes, Ideas waiting to be tried) into a sheet and back when closed, so what redraws it still does; the column is not left below the footer there, and nothing changes at a wider screen",
          'id="mtile"' in tg0 and 'class="mtile"' in tg0 and "Training</span>" in mt and ("Idle" in mt or "Stopped" in mt or "data-since" in mt) and 'id="mtrain"' in tg0 and 'id="mtrain-body"' in tg0
          and ".mtile{display:none}" in tg0 and ".shell>.rail{display:none}" in tg0 and "$('#mtrain-body').append(r)" in tg0 and "document.querySelector('.shell').append(r)" in tg0
          and "swap('/fragment/mtile','#mtile')" in tg0 and tg0.index('id="mtile"') < tg0.index('id="chips"'), mt[:200])
    # EVERYTHING NEEDED TO MAKE IT AGAIN, AND TO OFFER IT AS A MODEL: every slot with what it is told, the decider's recipe, the
    # engine's pinned builds, a card in the shape The Crew's chooser lists its models, what it needs of a machine, what it can and
    # cannot do as a model, and a hash of the recipe that src/spec.mjs computes the same way
    rc = spec["recipe"]
    check("the spec holds everything needed to make the swarm again and offer it: every slot with what it is told, the decider's serving recipe, the engine's pinned builds, a card a model chooser can list (engine swarm, memory, what it is equivalent on and where it stands), what it needs of a machine (platforms, memory, disk, licences, whether it may be used commercially), what it can and cannot do (tools go to one model alone), how to start it, and a format, version and hash",
          spec["spec"]["format"] == "the-swarm/spec" and spec["spec"]["version"] == 2 and len(spec["spec"]["recipeSha256"]) == 64 and spec["spec"]["recipeSha256"] == data.recipe_sha256(rc)
          and all(s_.get("brief") for s_ in rc["briefs"]["slots"]) and all(s_.get("brief") for s_ in spec["arrangement"]["slots"]) and rc["briefs"]["slots"] == d["briefs"]["slots"]
          and rc["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and rc["decider"].get("serve") and rc["engine"].get("builds") and rc["serving"]["slots"] == data.SERVING["slots"]
          and spec["card"]["engine"] == "swarm" and spec["card"]["memGb"] > 0 and "The Crew" in spec["card"]["equivalentOn"] and spec["card"]["badge"] and spec["card"]["plain"].startswith("Two small models")
          and spec["requirements"]["commercialUse"] is True and spec["requirements"]["licenses"] and spec["requirements"]["diskGb"] > 0 and spec["requirements"]["platforms"]
          and "alone" in spec["interface"]["capabilities"]["tools"] and "serveSwarm({ ...spec.card, spec }" in spec["interface"]["start"]["host"] and "--spec" in spec["interface"]["start"]["terminal"],
          {k: spec.get(k) for k in ("spec", "card", "requirements")})
    nc = data.spec(dict(data.load(root), decider=next(x for x in d["registry"]["deciders"] if x["id"] == "startlux-4b")))
    check("a spec whose decider's licence says non-commercial says it may not be used commercially, and lists every licence", nc["requirements"]["commercialUse"] is False and any("NC" in x or "non-commercial" in x for x in nc["requirements"]["licenses"]), nc["requirements"])
    node_ = swarm_ui.node_for_training()
    if node_:
        sp_file = Path(tmp) / "spec.json"
        sp_file.write_text(json.dumps(spec, ensure_ascii=False))
        rd = __import__("subprocess").run([node_, "-e", "import(process.argv[1]).then(m=>{const s=m.readSpec(process.argv[2]);console.log(s.spec.recipeSha256===m.recipeSha256(s.recipe)?'same':'differs')}).catch(e=>console.log('refused: '+e.message))",
                                            (Path(swarm_ui.__file__).resolve().parent.parent / "src" / "spec.mjs").as_uri(), str(sp_file)], capture_output=True, text=True)
        check("the module reads the spec the page writes, and computes its hash the same way", rd.stdout.strip() == "same", rd.stdout + rd.stderr[:300])
    check("an idea waiting to be tried opens the paper it came from", 'class="idea" href="https://arxiv.org/abs/' in html and 'target="_blank"' in html and "arXiv 26" in html)
    node = swarm_ui.node_for_training()
    if node:
        parsed = __import__("subprocess").run([node, "--check", "-"], input="async function page(){\n" + swarm_ui.JS + "\n}", capture_output=True, text=True)
        check("the page's own script is sound: it parses", parsed.returncode == 0, parsed.stderr[:300])
    q = held["swarm"][3]
    code, frag = get(base + "/fragment/question?split=held&id=" + urllib.request.quote(q["id"]))
    check("a question shows its input, what every slot that ran wrote, the swarm's output, and the larger model's output to the same input",
          code == 200 and "Input" in frag and "answered: <b" in frag and q["ref"] in frag and "the mark" in frag and "Wanted" not in frag and "Start with 18" in frag and q["reply"] in frag and held["target"][q["id"]]["reply"] in frag and frag.count("ANSWER:") >= 4, frag[:300])
    code, lst = get(base + "/fragment/list?split=train")
    check("the train questions are another view of the same thing", code == 200 and lst.count('class="q"') == 6)
    code, _ = get(base + "/fragment/question?split=held&id=<script>")
    code2, body2 = get(base + "/fragment/question?split=held&id=nope")
    check("a question that is not there is said to be, and nothing asked for is echoed back as markup", "not among" in body2 and "<script>" not in body2)
    srv.shutdown()
    empty = Path(tmp) / "empty"
    empty.mkdir()
    srv, base = serve(empty)
    code, html = get(base + "/")
    check("with nothing measured and nothing configured the page still opens, and says nothing has been measured", code == 200 and "Not measured yet" in html and "No larger model is named" in html)
    srv.shutdown()
    # ---- the Run training button, with a stand-in for the session (it writes its steps and waits): no model is started
    srv, base = serve(empty)
    check("on a folder with no trainers the button is there but cannot be pressed, and says why", 'id="run-go" type="button" disabled' in get(base + "/")[1] and "no trainers" in get(base + "/")[1])
    srv.shutdown()
    fake = Path(tmp) / "repo"
    (fake / "training").mkdir(parents=True)
    (fake / ".work" / "models").mkdir(parents=True)
    (fake / ".work" / "models" / "m.gguf").write_text("x")
    (fake / "training" / "state.json").write_text(json.dumps({"pass": 2}))
    (fake / "training" / "session.sh").write_text(
        'cd "$(dirname "$0")/.." || exit 1\nOUT=.work/train/pass-3; mkdir -p "$OUT"\n'
        'echo "10:00:00 START 00-begin" > "$OUT/status.txt"; echo "10:00:01 END   00-begin exit 0 0 min" >> "$OUT/status.txt"\n'
        'echo "10:00:01 START 02-target" >> "$OUT/status.txt"; echo "asked $PASSES $EACH teacher=[$TEACHER]" > "$OUT/02-target.out"\nsleep 60\n')
    os.environ.update(NODE="bash", SWARM_LLAMA_SERVER="stand-in", TEACHER="claude")
    # ONLY A FINISHED SPEC IS PUBLISHED (specs/): refused short of parity, written whole at parity, without the pass in hand
    def pub(headers=None):
        req = urllib.request.Request(base + "/spec/publish", data=b"{}", headers=headers if headers is not None else {"x-swarm": "1"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as x:
            return x.code, x.read().decode()
    pf = data.published_file(root, spec)
    srv, base = serve(root)
    short_code, short_said = pub()
    short_none = not pf.exists()
    foreign_code = pub({})[0]
    was_pub = data.publishable
    data.publishable = lambda sp_: ""
    ok_code, ok_html = pub()
    data.publishable = was_pub
    written = json.loads(pf.read_text()) if pf.exists() else {}
    check("only a finished spec is published to specs/: short of parity the button is greyed out saying why and a request is refused, writing nothing; at parity it writes specs/<configuration>.json whole, without the pass in hand, and the dialog then says where it is; a request not from the page is refused",
          'id="spec-publish"' in sp and ("Only a finished spec is published" in sp) == (spec["trainedAgainst"]["state"] != "at parity")
          and short_code == 409 and "Only a finished spec is published" in short_said and short_none and foreign_code == 403
          and ok_code == 200 and pf.name == d["key"] + ".json" and written.get("spec", {}).get("recipeSha256") == spec["spec"]["recipeSha256"] and "inProgress" not in written
          and "Published as <code>specs/%s</code>" % pf.name in ok_html, [short_code, short_said[:80], foreign_code, ok_code])
    srv.shutdown()
    srv, base = serve(fake)

    def post(path, body=b"{}", headers=None):
        req = urllib.request.Request(base + path, data=body, headers=headers or {"x-swarm": "1"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as x:
            return x.code, ""

    page0 = get(base + "/")[1]
    check("where training can be started the page has a Run training button that can be pressed, no count of passes to choose, and says it goes on until it is stopped",
          'id="run-go" type="button">Run training' in page0 and 'id="run-stop"' not in page0 and 'id="run-passes"' not in page0 and "Until stopped" in page0 and "until <b>Stop training</b> is pressed" in page0 and 'class="facts"' not in page0
          and swarm_ui.step_label("10-questions") == "Train, question by question" and swarm_ui.step_label("07-plan") == "Plan what to try" and swarm_ui.step_label("99-new") == "new")
    lp_none = swarm_ui.loop_panel(dict(d, loop=None))
    lp = swarm_ui.loop_panel(dict(d, loop={"pass": 3, "of": 84, "questions": 5, "atParity": 3, "reached": 1, "notReached": 1, "kept": 1, "cap": 8, "asked": 19, "list": [
        {"id": "q-easy", "kind": "math", "state": "at parity", "attempts": [{"move": "", "grade": "right"}]},
        {"id": "q-won", "kind": "fix", "state": "reached", "lostAt": "choosing", "attempts": [{"move": "", "grade": "wrong"}, {"move": "plan: decide by most", "grade": "wrong"},
            {"move": "plan: a model decides with the decider", "grade": "right", "guard": {"asked": 2, "lost": 1}, "lostOn": "q-easy"},
            {"move": "a-critic: check the edge cases", "grade": "right", "kept": True, "guard": {"asked": 3, "lost": 0}}]},
        {"id": "q-stuck", "kind": "day", "state": "not reached", "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong"}, {"move": "b-direct: say the weekday last", "grade": "wrong"}]}]}))
    check("the plan part of the page begins with training question by question: how many questions were at parity as the swarm stood, brought there by a change, or not reached; and each question that needed a change, with where it was lost and what was tried on it in order: what did nothing, what reached parity here but lost a question already there, and what was kept; before a pass has begun it says how it works",
          "Not begun" in lp_none and "stays in hand" in lp_none
          and "5 of 84 questions · 3 at parity as it stood · 1 brought to parity · 1 not reached · 1 kept" in lp and "asked 19 times" in lp and "q-easy</code> <span" not in lp
          and lp.index("q-stuck") < lp.index("q-won") and "lost in choosing · 3 tried" in lp and "lost <code>q-easy</code>, already at parity" in lp and "3 already at parity asked again, none lost" in lp
          and ">kept</span> a-critic: check the edge cases" in lp and "Not reached" in lp and "Brought to parity" in lp
          and swarm_ui.plan_block(dict(d, loop=None)).index("Question by question") < swarm_ui.plan_block(dict(d, loop=None)).index("The plan for pass"), lp[:300])
    refused = post("/run/start", headers={"content-type": "text/plain"})[0]
    foreign = post("/run/start", headers={"x-swarm": "1", "origin": "https://elsewhere.example"})[0]
    check("a pass cannot be started by anything but this page: a request without the page's own header, or from another site, is refused", refused == 403 and foreign == 403 and not (fake / ".work" / "train" / "ui-run.json").exists(), [refused, foreign])
    code, panel = post("/run/start")
    time.sleep(1.0)
    panel = get(base + "/fragment/run")[1]
    st = json.loads((fake / ".work" / "train" / "ui-run.json").read_text())
    check("pressed, it starts a session that goes on until it is stopped (no number of passes is given it, and no number of questions: that is the trainer's policy), and the page shows it running: each step as it starts and ends, and the last lines of the step it is on",
          code == 200 and 'data-running="1"' in panel and "Stop training" in panel and 'data-since="' in panel and "<b>Running " in panel and "<small>since " in panel and swarm_ui._span(45) == "45 s" and swarm_ui._span(750) == "12 min 30 s" and swarm_ui._span(7500) == "2 h 5 min" and "timeZoneName" in html and 'title="00-begin"' in panel and "under a minute" in panel and ">0 min<" not in panel and ">Pass 3<" in panel and "asked" not in panel
          and "Goes on until stopped" in panel and "Begin the pass" in panel and "Larger model: the held questions" in panel and 'title="02-target"' in panel and 'class="facts"' not in panel and 'id="run-each"' not in page0 and "asked 0 " in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text(), panel[:400])
    check("a teacher is never started from the button, whatever the page was started with", "teacher=[]" in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text())
    # what every slot is doing now: written by a trainer, shown only while a session runs and only while it is fresh
    (fake / ".work" / "train" / "live.json").write_text(json.dumps({"at": time.time() * 1000, "trainer": "measure", "who": "swarm", "split": "train", "n": 3, "of": 42,
        "question": {"id": "q", "kind": "fix", "ask": "Correct this function."}, "slots": {"a-direct": {"state": "working", "since": time.time() * 1000}, "kev-decide": {"state": "done", "ms": 310, "said": "Picked B."}}}))
    now = json.loads(get(base + "/api/live")[1])
    check("while a session runs the page can ask what every slot is doing at this moment: which question, which slots are working, what one just answered",
          now["running"] and now["question"]["kind"] == "fix" and now["slots"]["a-direct"]["state"] == "working" and now["slots"]["kev-decide"]["said"] == "Picked B." and now["whoName"] == "The swarm", now)
    (fake / ".work" / "train" / "setup.json").write_text(json.dumps({"at": time.time() * 1000, "steps": [{"what": "The engine (llama.cpp)", "state": "ready"}, {"what": "Small model 1 (Qwen3.5 2B)", "state": "fetching", "done": 600 * 2**20, "of": 1200 * 2**20}]}))
    check("while a session runs no model can be changed", post("/config", b'{"a":"x"}')[0] == 409)
    (fake / "src").mkdir(exist_ok=True)
    eq_run = post("/config", b'{"equivalence":["crew","logic"]}')[0]
    eq_cfg = json.loads((fake / "src" / "config.json").read_text()).get("equivalence")
    q_run = post("/questions", b'{"id":"crew","questions":[{"ask":"hello"}]}')[0]
    check("while a session runs nothing can be uninstalled", post("/uninstall", b'{"id":"train:measured"}')[0] == 409)
    check("the questions a person wrote can be changed while a session runs, like what it is equivalent on", q_run == 200)
    check("what the swarm is to be equivalent on can be changed while a session runs (a pass ends on the questions it began with), but not together with a model",
          eq_run == 200 and eq_cfg == ["crew", "logic"] and post("/config", b'{"equivalence":["crew"],"a":"x"}')[0] == 409, [eq_run, eq_cfg])
    # a step tried again, a step passed over on a resumed pass, and the ways back taken, are all shown
    stat = fake / ".work" / "train" / "pass-3" / "status.txt"
    stat.write_text(stat.read_text() + "10:00:02 END   02-target exit 1 0 min\n10:00:07 START 02-target\n10:00:09 SKIP  03-a-alone\n")
    (fake / ".work" / "train" / "recovery.jsonl").write_text(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 1)), "what": "LFM2.5 2.6B", "did": "its server was gone or hung: started again, and asked again"}) + "\n"
                                                           + json.dumps({"at": "2020-01-01T00:00:00", "what": "old", "did": "from another session"}) + "\n")
    rp = get(base + "/fragment/run")[1]
    check("each section of the training card folds under its heading, folded to begin with and saying in a line what it holds; the passes too, in a line of what they add up to; open or folded is kept on the device and put back each time the card is drawn again; it is saved on a click of the heading, not on every toggle",
          all(('data-keep="run-%s">' % k) in rp for k in ("pass", "recovered", "learned")) and 'data-keep="run-done"' in rp and " open>" not in rp
          and rp.count('class="smeta"') >= 3 and "the last: " in rp and "nothing kept yet" in rp
          and 'data-keep="rail-passes">' in html and 'class="fmeta"' in html and "pass" in html.split('class="fmeta">')[1][:60]
          and "details.fold>summary" in html
          and "keepOpen($(into))" in html and "swarm.open." in html and "closest('details[data-keep]>summary')" in html and "addEventListener('toggle'" not in html, [k for k in ("pass", "recovered", "learned", "done") if ('data-keep="run-' + k) in rp])
    check("a step that failed and is being run again shows as one step with its try, a step done before a stop is shown as done earlier, and the ways back this session has taken are listed (and no other session's)",
          "try 2" in rp and "done earlier" in rp and rp.count('title="02-target"') == 1 and "Recovered<span>1 time this session" in rp and "started again, and asked again" in rp and "from another session" not in rp, rp[-600:])
    # the card reads a resumed pass as it is: one step running, the one the stop cut short to come again, the rest in order
    stx = "\n".join(["07:00:00 START 00-begin", "07:00:01 END   00-begin exit 0 0 min", "07:00:01 START 12-members", "08:00:00 RESUMED this pass had stopped: carrying on",
                      "08:00:00 SKIP  00-begin", "08:00:01 START 07-write-briefs", "08:00:30 END   07-write-briefs exit 0 0 min", "08:00:31 START 10-questions"])
    psteps, porder = swarm_ui.pass_steps(stx)
    ahead = swarm_ui.steps_ahead(psteps, ["a", "b"], ["a-steps", "a-critic"])
    check("the training card reads a resumed pass as it is: the step running now is the only one running; a step the stop cut short is not running, it is to come and carries on; what is to come is in the order the session runs it; and the decider is named with what it is doing",
          psteps["10-questions"]["state"] == "now" and psteps["12-members"]["state"] == "stopped" and psteps["00-begin"]["state"] == "earlier" and psteps["07-write-briefs"]["state"] == "done"
          and ahead.index("12-members") < ahead.index("12-deciders") < ahead.index("21-swarm-held") < ahead.index("22-end") and "10-questions" not in ahead and "00-begin" not in ahead and "07-write-briefs" not in ahead and "03-a-alone" in ahead
          and swarm_ui.decider_state(False) in ("not running", "ready", "busy") and swarm_ui.decider_state(True) in ("starting", "ready", "busy"), [psteps, ahead[:6]])
    post("/run/start")
    check("pressed again while one runs, nothing more is started", json.loads((fake / ".work" / "train" / "ui-run.json").read_text())["pid"] == st["pid"])
    code, after = post("/run/stop")
    gone = False
    try:
        os.kill(st["pid"], 0)
    except OSError:
        gone = True
    stale = json.loads(get(base + "/api/live")[1])
    check("once the session has stopped nothing is shown as working, whatever the trainer last wrote", stale["running"] is False and stale["slots"] == {} and "question" not in stale, stale)
    check("Stop training stops it, and the page says it was stopped and offers the button again", gone and "Run training" in after and "Stopped at" in after and 'data-running' not in after, after[:300])
    srv.shutdown()
    for k in ("NODE", "SWARM_LLAMA_SERVER", "TEACHER"):
        os.environ.pop(k, None)
    srv, base = serve(Path(__file__).resolve().parent.parent)
    code, html = get(base + "/")
    check("on this repository it opens and names the model being chased", code == 200 and "Nemotron 3.5 Lightning 30B" in html and "Sample data" not in html)
    srv.shutdown()

print("\n" + ("%d FAILED, " % len(failed) if failed else "all ") + "%d passed." % passed)
sys.exit(1 if failed else 0)
