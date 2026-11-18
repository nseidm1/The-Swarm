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
        {"pass": 1, "target": t["id"], "config": "x+y+k", "members": ["Small X", "Small Y"], "decider": "Decider K", "level": True, "equivalent": 12, "compared": 12},
        {"pass": 2, "target": t["id"], "config": "p+q+k", "members": ["Small P", "Small Q"], "decider": "Decider K", "level": True, "equivalent": 12, "compared": 12},
        {"pass": 3, "target": t["id"], "config": "p+q+k", "members": ["Small P", "Small Q"], "decider": "Decider K", "level": False, "equivalent": 11, "compared": 12},
        {"pass": 4, "target": "another-model", "config": "r+s+k", "members": ["Small R", "Small S"], "decider": "Decider K", "level": True, "equivalent": 12, "compared": 12},
    ]))
    listed = swarm_ui.at_parity(won, t)
    others = [x["name"] for x in d["targets"] if x["id"] != t["id"]]
    check("the larger model's card lists the configurations of small models a pass measured at parity with IT, and nothing else: no other larger model is named there, none is listed before one is measured, "
          "one whose latest pass was not at parity is not listed, and one measured against another model is not listed",
          "None yet" in none_yet and "Small X + Small Y" in listed and "Small P" not in listed and "Small R" not in listed and "at parity with <b>" not in html and "chasing" not in html
          and not any(n in none_yet + listed for n in others), listed)
    top = html.split("<main")[1].split('id="arrangement"')[0]
    pc = held["parity"]["percent"]
    check("the percentage arithmetic stays exact: 100 is said only when every answer is equivalent, and a share is never rounded up to it",
          data.parity([{"grade": "right"}] * 999 + [{"grade": "wrong"}])["percent"] == 99.9 and data.parity([{"grade": "right"}] * 3)["percent"] == 100 and data.parity([{"grade": "right"}] * 1999 + [{"grade": "wrong"}])["percent"] < 100
          and swarm_ui.fmt_pct(75.0) == "75" and swarm_ui.fmt_pct(62.5) == "62.5")
    strip = get(base + "/fragment/score")[1]
    check("the page says how far training has come, question by question: a percentage training complete at the head of the Train card (no bar, legend, spec line or ideas line under it: taken out), and no parity verdict, held-question card or whole-measurement dialog any more",
          '<h2 id="arrangement">Train</h2>' in html and "<h2>Training progress</h2>" not in html and 'class="trainprog trainhead"' in strip and "training complete" in strip
          and html.index('<h2 id="arrangement">Train</h2>') < html.index('<div id="score">') and 'class="mbar stack"' not in strip and 'class="memleg"' not in strip and "Ideas waiting to be tried" not in strip
          and 'id="score-open"' not in html and 'id="big"' not in html and "/fragment/scorefull" not in html and get(base + "/fragment/scorefull")[0] == 404 and "Parity with the larger model" not in html, strip[:300])
    fp = data.footprint({"a": {"bytes": 2**30}, "b": {"bytes": 2**30}}, {"memGb": 5}, {"memGb": 18})
    mp = swarm_ui.memory_card(data.load(root))
    check("the training card says what the swarm is for: the memory it takes against the larger model's, in the memory chart (a bar for each on one scale, the swarm's made of its parts, a scale and a key), the share and how many times smaller, estimated and said to be; and parity in the same design above it: the share large, the swarm's answers as a bar (equivalent, different, no answer) with each small model alone beside it on one scale, and a key; the other numbers are chips",
          {k: fp[k] for k in ("small", "decider", "swarm", "target", "share", "times")} == {"small": 3.5, "decider": 5, "swarm": 8.5, "target": 18, "share": 47.2, "times": 2.1}
          and fp["saved"] == 52.8 and fp["savedGb"] == 9.5
          and [x["kind"] for x in fp["parts"]] == ["model", "model", "contexts", "decider"] and abs(sum(x["gb"] for x in fp["parts"]) - fp["swarm"]) < 0.05 and data.footprint({}, {}, {"memGb": 18}) is None
          and 'class="memc compact"' in mp and "The swarm</span>" in mp and "memory saved" in mp and "GB less" in mp and "not measured" in mp and "Not measured." in mp and "× smaller" in mp
          and 'class="memleg"' in mp and 'class="mbar stack"' in mp and mp.count("<i style=\"width:") >= 5 and "<svg" not in mp
          , strip[:600])
    plan = get(base + "/fragment/plan")[1]
    arr_stopped = swarm_ui.arrangement(data.load(root))
    was_rs = swarm_ui.run_state
    swarm_ui.run_state = lambda: {"pid": 1, "at": "2026-11-16 12:00:00", "passes": 0, "first": 1, "running": True}
    plan_live = get(base + "/fragment/plan")[1]
    arr_live = swarm_ui.arrangement(data.load(root))
    swarm_ui.run_state = was_rs
    check("a move a trainer marked as being measured says so only while a session runs: once the session has stopped, it says it was stopped partway, and the swarm's card says it through the question track alone: no line of moves marked running, and no label on a face",
          "Being measured" in plan_live and "Stopped partway" not in plan_live and 'id="qtrack"' in arr_live and "Being tried now" not in arr_live
          and "Stopped partway" in plan and ">Being measured<" not in plan and "stopped partway: " in plan and 'id="qtrack"' in arr_stopped and "Stopped while trying" not in arr_stopped and "Being tried now" not in arr_stopped and 'class="tb' not in arr_stopped, plan[:200])
    check("the plan of the pass in hand is on the page as it stands: what the measurement showed, each move in order with the slot, the model, the technique, the paper it came from and why it was chosen, and what became of it",
          "Pass 5, question by question" in html and "What the measurement showed" in plan and "no slot had the larger model" in plan.lower().replace("&#x27;", "'") and plan.count("<li class=") == 5 and "Stopped partway" in plan and ">Kept<" in plan and ">Not kept<" in plan
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
    H, T = d["splits"]["held"], d["splits"]["train"]
    # TRAINING COMPLETE, AS IT GOES: nothing yet; questions at parity as the swarm stood and brought there; one back in hand after a swap
    p_none = swarm_ui.progress_strip(dict(d, loop=None))
    p_some = swarm_ui.progress_strip(dict(d, loop={"of": 10, "changes": [{"what": "x"}], "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "reached"}, {"id": "c", "state": "at parity"}, {"id": "d", "state": "reopened"}]}))
    check("training complete says how far training has come and never more: before anything, that training starts at question 1; then the share of the pass's questions at parity (as the swarm stood, brought there by a change), with any back in hand after a swap, the found arrangements and what the spec kept",
          "0%</b><span>training complete" in p_none and "Training starts at question 1" in p_none
          and "30%</b><span>training complete" in p_some and "<b>3</b> of 10 train questions at parity" in p_some and "<b>2</b> as the swarm stood, <b>1</b> brought there" in p_some
          and "1 back in hand after a swap" in p_some and "kept this pass" not in p_some and "from every run" not in p_some and "found arrangement" not in p_some and "<small>pass " in p_some, p_some[:400])
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
    check("an answer is on the page the moment a trainer has written it down, before its step has ended; an answer of a candidate being tried is not taken for the swarm's",
          "held-live-1" in ids and "held-trial-1" not in ids and 'id="io"' not in html, ids[-3:])
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
    (wd / "decider-replay.json").write_text(json.dumps({"pass": n_pass, "results": [{"decider": "startlux-4b", "asked": 40, "nowRight": 31, "theirsRight": 34, "recovered": 5, "lost": 2}]}))
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
          "How it is training" in pol_html and "or after <b>12</b> changes" in pol_html and "until it is at parity" in pol_html and "with up to <b>3</b> such arrangements open at a time" in pol_html and "The loop&#39;s policy" in pol_html and "or after" not in swarm_ui.plan_panel(d) and "asked again on <b>6</b> questions already there" in pol_html and "wins" not in pol_html and d["policy"]["loop"]["cap"] is None and d["policy"]["loop"]["beam"] == 3
          and "Says what each call should give" in exp_html and exp_html.count('class="stage"') == 5
          and data.parity(spec_rows)["onSpec"]["compared"] == 8, pol_html[:200])
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
          and "decide" in [k for _, k in faces] and "target" not in [k for _, k in faces] and 'class="st mk"' not in arr
          and re.search(r'<button type="button" class="mav tgt" data-av="target"[^>]*>.*?data-live="target"', arr) and re.search(r'class="via" data-av="run"', arr)
          and arr.index('class="via" data-av="run"') > arr.index('data-av="a-direct"') and arr.index('class="via" data-av="run"') < arr.index('data-av="a-critic"')
          and all('data-live="%s"' % k in arr for k in slot_ids + ["target", "decide", "run"]) and all('<template id="avt-%s">' % k in arr for k in slot_ids + ["target", "run"])
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
          and " decides · against " in html.split('id="cfg-meta">')[1][:200] and get(base + "/fragment/cfgmeta")[0] == 200 and "swap('/fragment/cfgmeta','#cfg-meta')" in html, html.split('id="cfg-meta">')[1][:160])
    check("a page that is closed or reloaded before its answer has been sent leaves nothing printed as an error, and the next request is answered as usual",
          "Traceback" not in noise.getvalue() and "BrokenPipe" not in noise.getvalue() and get(base + "/api/live")[0] == 200, noise.getvalue()[-300:])
    # ONE NUMBER, SAID ONE WAY: every place on the page that says how far the swarm is says the same percentage, from the same count
    P = held["parity"]
    same = "%s%%" % swarm_ui.fmt_pct(P["percent"])
    far = swarm_ui.how_far(P["equivalent"], P["compared"])
    spec_now = get(base + "/fragment/spec")[1]
    alone_pct = ["%s%%" % swarm_ui.fmt_pct(data.parity(r)["percent"]) for r in held["alone"].values() if r]
    check("where the spec says how far the swarm is toward parity on the held questions it says one percentage, worked out in one place from the same count; and each small model alone is said the same way",
          ("%s of the way to parity against" % same) in spec_now and ("<b>%s</b> of the way to parity." % same) in spec_now and swarm_ui.how_far(25, 42) == "59.5% · 25 of 42"
          and data.percent(25, 42) == 59.5 and "Not at parity" not in html + spec_now, [same, far, alone_pct])
    check("a row of the training card with no duration (a thing learned, a recovery) wraps inside the card: only a duration is kept on one line",
          ".steps li>span:nth-child(3){" in html and ".steps li>span:last-child{" not in html and ".steps li>span{min-width:0;overflow-wrap:anywhere}" in html)
    check("the page ends with a footer: whose product it is, its licence, and that the page is served from this machine",
          '<footer class="foot">' in html and "A Family Office product" in html and "apache.org/licenses/LICENSE-2.0" in html and "github.com/nseidm1/The-Swarm" in html and "Copyright 2026 Family Office" in html and "<svg" in html.split('<footer class="foot">')[1].split("</footer>")[0])
    check("it shows the arrangement being trained: every slot of both models by stage, what each is told, what is being tried, and the larger model alongside",
          all(s["id"] in html for s in d["briefs"]["slots"]) and html.count('class="slot a"') >= 4 and html.count('class="slot b"') >= 3 and '<h2 id="arrangement">Train</h2>' in html and "under test" not in html and "Trained every pass" not in html and 'class="side"' not in html and "Ask both" not in html and "What it is told" in html and "Being tried" in html and "arXiv 2610.21290" in html and "The larger model" in html and "tensorfold serve" in html)
    krow = next((r for sp in d["splits"].values() for r in sp["swarm"] if any(t["slot"] == "decide" for t in r["trace"])), None)
    kfrag = get(base + "/fragment/question?split=%s&id=%s" % (krow["split"], urllib.request.quote(krow["id"])))[1] if krow else ""
    check("every slot is shown by the model that fills it and what it is for, with a line for what it is doing now; the decision model is in the decide step, and on a question shows what it picked and the probability it gave each answer",
          'data-live="decide"' in html and d["decider"]["name"] in html and "Decides which answer stands" in html and "Drafts it step by step" in html and html.count('data-live="') >= 9 and krow is not None and 'class="probs"' in kfrag and "Picked" in kfrag, bool(krow))
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
            return x.code, x.read().decode(errors="replace")

    other = next(m for m in reg["small"] if m["id"] not in (d["members"]["a"]["id"], d["members"]["b"]["id"]))
    code_ok, drawn = send("/config", {"a": other["id"]})
    after = json.loads((root / "src" / "config.json").read_text())
    check("choosing a model writes it down and draws again everything that depends on it, in place: the slots in that place carry the new model's name, and results of another arrangement are not shown as this one's",
          code_ok == 200 and after["a"] == other["id"] and other["name"] in drawn and "training complete" in drawn and "At parity with" not in drawn and "Not at parity with" not in drawn and after["b"] == d["members"]["b"]["id"], after)
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
    check("under the models, a box to tick for each body of work the swarm can be brought to equivalence on: The Crew ticked where nothing was chosen, then Code, Math, Logic and Reasoning, each saying what it is; ticking writes the choice down in the list's own order beside the models, and the row is drawn again in place, with who takes a turn with tools under the boxes and no description under either; none, or one that is not listed, is refused and nothing is written",
          row.startswith('<fieldset class="equiv" id="equiv">') and row.count('data-equiv="') == 5 and row.count(" checked") == 1 and 'data-equiv="crew" checked' in row and "<b>The Crew</b>" in row and "<b>Code</b>" in row and "<b>Math</b>" in row and "<b>Logic</b>" in row and "<b>Reasoning</b>" in row
          and "Parity is equivalence" not in row and 'id="tools"' in row and 'data-tools="swarm"' in row and "An agent&#x27;s turn" not in row and 'id="equiv"' in html and html.index('id="picks"') < html.index('id="equiv"') < html.index('id="body"')
          and e_ok == 200 and e_cfg["equivalence"] == ["crew", "reasoning"] and e_cfg["a"] == d["members"]["a"]["id"] and not row2.startswith("<fieldset") and row2.count(" checked") == 2 and 'id="tools"' in row2
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
          pens.count('class="pencil"') == 5 and 'data-qedit="crew"' in pens and "Edit the questions for The Crew" in pens and 'id="qedit"' in html
          and "Questions: The Crew" in panel_q and "Made by the trainer" in panel_q and "Simple: a piece of writing" in panel_q and "Developer: their own project" in panel_q and "Write a function: arrays" in panel_q and panel_q.count('class="qrow"') == 1 and "0 of 200" in panel_q
          and q_ok == 200 and q_file == {"questions": [{"ask": "Move my dentist to Friday."}, {"ask": "Is a sleep a fix?", "mode": "developer"}]} and "2 of your own" in q_row
          and panel_q2.count('class="qrow"') == 3 and "Move my dentist to Friday." in panel_q2 and '<option value="developer" selected>' in panel_q2 and "2 of 200" in panel_q2
          and m_ok == 200 and m_file == {"questions": [{"ask": "What is 17 times 23?"}]} and "data-q-mode" not in get(base + "/fragment/questions?id=math")[1].split("<template")[0]
          and send("/questions", {"id": "poetry", "questions": []})[0] == 400 and send("/questions", {"id": "crew", "questions": "x"})[0] == 400 and send("/questions", {"id": "crew", "questions": [{"ask": "q"}] * 201})[0] == 400
          and json.loads((root / "training" / "questions" / "crew.json").read_text()) == q_file and "nothing called that" in get(base + "/fragment/questions?id=nope")[1], [q_ok, q_file, m_file])
    # EVALUATE THE SWARM and PRETRAIN: above Training progress; started and stopped from the page, one at a time with training
    ev0 = get(base + "/fragment/eval")[1]
    # (MLX runs on Apple silicon only: there Pretrain installs it and can be pressed; anywhere else, CI's Linux among them, it says
    # it is not available here and cannot)
    import platform
    apple = sys.platform == "darwin" and platform.machine() == "arm64"
    api0 = json.loads(get(base + "/api/eval")[1])
    # who holds the machine, read by the page every 1.5 s: when it changes (a run started or stopped anywhere), Evaluate, Pretrain
    # and Training progress are drawn again in place (they had waited for their own run to end, so a stopped training run left them
    # stale until a reload)
    busy0 = json.loads(get(base + "/api/busy")[1])
    body0 = get(base + "/fragment/body")[1]
    check("the page knows who holds the machine and redraws the three cards when that changes",
          busy0 == {"busy": ""} and 'id="busy" data-busy=""' in body0 and "busyTick" in get(base + "/")[1],
          json.dumps(busy0))
    bad_size = send("/eval/start", {"limit": 7})[0]
    foreign = send("/eval/start", {"limit": 20}, {"x-swarm": "0"})[0]
    pre0 = get(base + "/fragment/pretrain")[1]
    pre_btn = pre0.split('id="pre-go"')[1][:30] if 'id="pre-go"' in pre0 else ""
    pre_ok = (("MLX, the trainer, is not installed yet: Pretrain installs it" in pre0 and "disabled" not in pre_btn) if apple
              else ("runs on Apple silicon only: it is not available on this machine" in pre0 and "disabled" in pre_btn))
    (root / ".work" / "eval").mkdir(parents=True, exist_ok=True)
    ev_mine = {
        "at": "2026-11-17T12:00:00Z", "limit": 20, "harness": "lm-evaluation-harness 0.4.13", "configuration": data.load(root)["key"], "briefs": "abc", "seconds": 600, "adapters": [], "target": "the larger model",
        "results": [{"item": "crew", "task": "ifeval", "name": "IFEval", "metric": "prompt_level_strict_acc", "filter": "none", "compare": "instructions",
                     "target": {"value": 0.6, "n": 20}, "swarm": {"value": 0.45, "n": 20},
                     "agree": {"of": 20, "same": 15, "bothRight": 9, "bothWrong": 6, "differ": 5, "onlyTarget": 3, "onlySwarm": 2, "examples": []}}]}
    # THE EVALUATION SHOWN IS THE APPLIED CONFIGURATION'S: a newer one of another configuration is not shown in its place (this one's,
    # from the history, is), and with none of this one's the card says it has not been evaluated as it is now
    ev_other = dict(ev_mine, at="2026-11-17T13:00:00Z", configuration="other+models--x", results=[dict(ev_mine["results"][0], agree=dict(ev_mine["results"][0]["agree"], same=4))])
    (root / ".work" / "eval" / "history.jsonl").write_text(json.dumps(ev_mine) + "\n")
    (root / ".work" / "eval" / "results.json").write_text(json.dumps(ev_other))
    ev_mix = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "history.jsonl").unlink()
    ev_none = get(base + "/fragment/eval")[1]
    check("the Evaluate card shows the evaluation of the configuration as it is applied: a newer one of another configuration is not shown in its place, and with none of this one's it says it has not been evaluated as it is now",
          "75%</b> <span>15 of 20 the same" in ev_mix and "another configuration" not in ev_mix
          and "Not evaluated as the swarm is now" in ev_none and "of another configuration" in ev_none and "the same</span>" not in ev_none.split("Not evaluated")[0].split("evrow")[-1] and "20%</b>" not in ev_none,
          [ev_mix.count("75%"), "Not evaluated" in ev_none])
    (root / ".work" / "eval" / "results.json").write_text(json.dumps(ev_mine))
    ev1 = get(base + "/fragment/eval")[1]
    a_on = send("/config", {"adapters": True})[0]
    a_cfg = json.loads((root / "src" / "config.json").read_text())
    a_bad = send("/config", {"adapters": "yes"})[0]
    a_off = send("/config", {"adapters": False})[0]
    a_cfg2 = json.loads((root / "src" / "config.json").read_text())
    # while an evaluation runs (this process stands in for it), training and pretraining wait, and each says why
    (root / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now", "limit": 100}))
    held_pre = send("/pretrain/start", {})
    a_member = d["members"]["a"]
    a_orig = json.loads((Path(__file__).resolve().parent.parent / "training" / "originals.json").read_text())["models"].get(a_member["file"]) or {}
    ad = root / ".work" / "library" / "adapters" / d["target"]["id"] / (a_orig.get("dir") or a_member["file"])
    ad.mkdir(parents=True, exist_ok=True)
    (ad / "result.json").write_text(json.dumps({"ok": True, "gguf": str(ad / "x-lora.gguf"), "at": "2026-11-17T10:00:00Z", "examples": 72, "target": "the larger model", "items": ["crew"], "valLoss": [1.1, 0.7], "perplexity": {"without": 3.4, "with": 2.7}}))
    (ad / "failed.json").write_text(json.dumps({"ok": False, "at": "2026-11-17T12:00:00Z", "why": "llama.cpp did not load it"}))
    (root / ".work" / "pretrain").mkdir(parents=True, exist_ok=True)
    (root / ".work" / "pretrain" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now"}))
    pre_run = get(base + "/fragment/pretrain")[1]
    (root / ".work" / "pretrain" / "ui-run.json").unlink()
    pre_stop = get(base + "/fragment/pretrain")[1]
    shutil.rmtree(ad)
    held_by = swarm_ui.busy_with()
    held_ev = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "ui-run.json").unlink()
    # (the run ends without finishing: no result was written, and the last one that finished is shown again, as it was)
    ev_after = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "results.json").unlink()
    check("Memory saved first, its share at the top left as the cards after it have theirs; then, above Train, Evaluate the swarm and Pretrain: Evaluate says what it does (standard benchmarks of lm-evaluation-harness, asked of the larger model and the swarm, kept apart from training), has a size to choose and a button, and a row for every task of what is chosen; an unknown size or a request from elsewhere is refused; once evaluated it says how many questions had the same answer, split by whether both were right, with each model's score and when; Pretrain lists each small model and, where MLX is not installed, says Pretrain installs it and can be pressed on Apple silicon, or that it is not available on any other machine; the adapters switch is written beside the models and refuses anything but on or off; and while an evaluation runs, its headline shows moving bars where the share and the count will be and the questions chosen, the last result returning as it was when the run ends unfinished (Pretrain the same, the adapter that stood still standing beside an attempt that was not kept), it can be stopped from its section, and training and pretraining wait for it and say so",
          html.index('<h2>Memory saved</h2>') < html.index('<h2>Evaluate the swarm</h2>') < html.index('<h2>Pretrain</h2>') < html.index('<h2 id="arrangement">Train</h2>')
          and '<h2>Memory saved</h2><div class="panel memcard"><div class="proghead"><span class="memnum"><b class="pct">' in html and 'class="memh"' not in html.split('<h2>Memory saved</h2>')[1].split('<h2>')[0]
          and "lm-evaluation-harness 0.4.13" in ev0 and 'id="ev-go"' in ev0 and ev0.count("<option") == 3 and 'data-evt="ifeval"' in ev0 and "not evaluated yet" in ev0 and api0.get("running") is False
          and bad_size == 400 and foreign == 403
          and 'id="pre-go"' in pre0 and pre_ok and pre0.count('class="prerow"') == len([k for k in ("a", "b", "c", "d") if k in d["members"]])
          and "75%</b> <span>15 of 20 the same" in ev1 and "9 both right · 6 both wrong · 5 differ" in ev1 and "Last evaluated 2026-11-17 12:00 UTC" in ev1 and "without adapters" in ev1
          and a_on == 200 and a_cfg.get("adapters") is True and a_bad == 400 and a_off == 200 and "adapters" not in a_cfg2
          and held_pre[0] == 409 and "Wait for an evaluation" in held_pre[1] and held_by == "an evaluation" and 'id="ev-stop"' in held_ev and 'id="ev-go"' not in held_ev
          and 'class="pct busy"' in held_ev and 'class="busyn"' in held_ev
          and 'class="pct busy"' in pre_run and "of %d adapted" % pre0.count('class="prerow"') in pre_run and "pct busy" not in pre_stop and '<b class="pct">1</b>' in pre_stop
          and "Adapted</b> 2026-11-17" in pre_stop and "a later attempt was not kept: llama.cpp did not load it" in pre_stop and "of 100 questions" in held_ev and "75%</b><span>equivalent" not in held_ev
          and "75%</b><span>equivalent<small>15 of 20 questions" in ev_after and "pct busy" not in ev_after,
          {"order": html.index('<h2>Evaluate the swarm</h2>') < html.index('<h2>Pretrain</h2>') < html.index('<h2 id="arrangement">Train</h2>'),
           "ev0": ["lm-evaluation-harness 0.4.13" in ev0, 'id="ev-go"' in ev0, ev0.count("<option"), 'data-evt="ifeval"' in ev0, "not evaluated yet" in ev0, api0.get("running")],
           "codes": [bad_size, foreign, a_on, a_bad, a_off, held_pre[0]], "pre": ['id="pre-go"' in pre0, apple, pre_ok, pre0.count('class="prerow"')],
           "ev1": ["75%</b> <span>15 of 20 the same" in ev1, "9 both right · 6 both wrong · 5 differ" in ev1, "Last evaluated 2026-11-17 12:00 UTC" in ev1, "without adapters" in ev1],
           "cfg": [a_cfg.get("adapters"), "adapters" in a_cfg2], "held": [held_pre[1][:60], held_by, 'id="ev-stop"' in held_ev]})
    # THE UNINSTALL HELPER LISTS WHAT EVALUATING AND PRETRAINING FETCH: the harness, MLX, each model's original weights (the ones the
    # swarm is made of marked in use), the adapters, and every answer an evaluation kept; and removes nothing while either runs
    a_file = d["members"]["a"]["file"]
    origs = json.loads((Path(__file__).resolve().parent.parent / "training" / "originals.json").read_text())["models"]
    a_dir = (origs.get(a_file) or {}).get("dir") or "LFM2.5-1.2B-Instruct"
    for pth in (root / ".work" / "lmeval" / "venv", root / ".work" / "mlx" / "venv", root / ".work" / "mlx" / "hf" / a_dir, root / ".work" / "mlx" / "hf" / "Old-Model",
                root / ".work" / "library" / "adapters" / d["target"]["id"] / a_dir, root / ".work" / "eval" / "target"):
        pth.mkdir(parents=True, exist_ok=True)
        (pth / "x.bin").write_bytes(b"x" * 2048)
    inv = {x["id"]: x for x in cleanup.inventory(root, data.load(root))}
    (root / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now"}))
    held_rm = send("/uninstall", {"id": "lmeval:program"})
    (root / ".work" / "eval" / "ui-run.json").unlink()
    rm_ok = send("/uninstall", {"id": "mlx:weights:" + a_dir})[0]
    check("the Uninstall Helper lists what evaluating and pretraining fetch, each to be taken out on its own: lm-evaluation-harness, MLX, each small model's original weights (the ones the swarm is made of marked in use, and any no longer listed), the adapters, and the answers evaluations kept; and while an evaluation runs it removes nothing, and says why",
          "lmeval:program" in inv and "mlx:program" in inv and ("mlx:weights:" + a_dir) in inv and inv["mlx:weights:" + a_dir]["used"] == (a_file in origs) and "mlx:weights:other" in inv
          and ("adapters:" + d["target"]["id"]) in inv and "eval:answers" in inv and inv["mlx:weights:" + a_dir]["group"] == "Pretrain"
          and held_rm[0] == 409 and "An evaluation is running" in held_rm[1] and rm_ok == 200 and not (root / ".work" / "mlx" / "hf" / a_dir).exists(),
          [sorted(k for k in inv if ":" in k), held_rm, rm_ok])
    dm = dict(d, machine=["mac"])
    sel = re.search(r'<select data-pick="decider".*?</select>', swarm_ui.pills(dm), re.S).group(0)
    names = re.findall(r'<option value="([^"]+)"', sel)
    check("the Decides pill lists every decider best first by its Decision Index score, says the score beside each, and on a machine that cannot run one lists it greyed out with what it needs; the one chosen is shown by its name alone",
          names[0] == "karpo-31b" and 'value="karpo-31b" disabled' in sel and "needs an NVIDIA GPU with 80 GB" in sel and "StartLux Decision 4B · index 54.8 · about 5.5 GB<" in sel
          and 'value="startlux-4b" disabled' not in sel and "(an older checkpoint)" in sel and ('value="%s" selected>%s<' % (d["decider"]["id"], d["decider"]["name"])) in sel and len(names) == len(d["registry"]["deciders"]) == 23
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
          and " open>" not in after_u.split('class="psec"')[1][:80] and after_u.count('class="pmeta"') >= 3 and "until parity, best first, building on the 3 closest" in after_u and "Decider loops only · 1 skipped · nothing queued" in after_u and "2 moves · 0 tried by the loop · 0 kept" in after_u
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
    (wdr / "decider-replay.json").write_text(json.dumps({"pass": 5, "results": [{"decider": "startlux-4b", "asked": 46, "nowRight": 37, "theirsRight": 38, "recovered": 4, "lost": 3}, {"decider": "kev-9b", "asked": 46, "nowRight": 37, "theirsRight": 35, "recovered": 1, "lost": 3}]}))
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
              {"slot": "decide", "member": "decider", "stage": "decide", "ok": i % 4 != 0, "ms": 5800,
               "out": "Decided nothing: The decider did not answer: The operation was aborted due to timeout." if i % 4 == 0 else "Picked A."}]
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
          [r["id"] for r in rs2 if not r["id"].startswith("judge:")] == ["member:qwen35-2b"] and ("decided by %s" % d["decider"]["name"].split(" ")[0]) in pop2 and ap2 == 200
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
        # (newest of all, so that these are the questions compared, whatever this repository has measured itself)
        fp.write_text(json.dumps({"right": right, "compared": 42, "at": "2099-01-01T00:00:00Z"}))
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
    check("what other configurations measured becomes a recommendation here: a small model that, alone against the same larger model on the same questions, answered as it did more often than the weakest member (by 5 points or more, or by more than one model's runs differ) is recommended in that member's place; a configuration further along against the same larger model is recommended with its members and decider; one behind this configuration, or a model below the bar, is not; each says what it rests on",
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
          code_s == 200 and "Output spec" in sp and d["members"]["a"]["sha256"] in sp and d["members"]["b"]["file"] in sp and "<code>decide</code>" in sp and ("% of the way to parity against" in sp or "At parity against" in sp) and spec["trainedAgainst"]["progressPercent"] == p["percent"] and 'id="spec-json"' in sp
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
          and t_ok == 200 and t_bad == 400 and t_out == 400 and t_cfg.get("tools") == "swarm" and 'class="seg on" data-tools="swarm"' in t_row and "tools: the swarm" in t_meta
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
    spec_n = data.spec(dn2)
    check("the larger model against itself is in the spec (asked again, judged against its own first answers: the noise floor); and the swarm's different answers the reader could not decide are counted apart",
          spec_n["trainedAgainst"]["selfAgreement"] == {"equivalent": len(selfr) - 1, "compared": len(selfr), "percent": data.percent(len(selfr) - 1, len(selfr))}
          and (not wrong or (spec_n["trainedAgainst"]["undecided"] == 1 and data.parity(sw_rows)["undecided"] == 1))
          and data.spec(dn)["trainedAgainst"]["selfAgreement"] is None, spec_n["trainedAgainst"].get("selfAgreement"))
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
          any(r["id"].startswith("judge:") for r in j_before) == bool(judge_here) and j_ok == 200 and j_cfg.get("judge") == "startlux-4b" and "StartLux Decision 4B judges" in j_meta
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
    # TRAINING LIVES ON ITS PROGRESS CARD: no column beside the page and no tile for one on a phone; the card carries Train (or Stop
    # training), Clear training state, what the session is doing, and the ideas waiting to be tried; the passes are not listed again
    card = get(base + "/fragment/score")[1]
    check("training lives at the head of the Train card, as Evaluate and Pretrain have theirs: no column beside the page, no tile or sheet for one on a phone, and no list of passes; the card's head has Train and Clear training state (or Stop training), and under it what the session is doing; the ideas waiting to be tried are not there (taken out)",
          'class="rail"' not in tg0 and 'id="mtile"' not in tg0 and 'id="mtrain"' not in tg0 and "<h2>Passes</h2>" not in tg0 and "Ideas waiting to be tried</h2>" not in tg0
          and card.startswith('<div class="trainprog trainhead">') and '<span class="evctl">' in card and ('id="run-go"' in card) != ('id="run-stop"' in card)
          and ('id="run-clear"' in card or 'id="run-stop"' in card) and "Ideas waiting to be tried:" not in card and "/fragment/mtile" not in tg0,
          card[:300])
    # EVERYTHING NEEDED TO MAKE IT AGAIN, AND TO OFFER IT AS A MODEL: every slot with what it is told, the decider's recipe, the
    # engine's pinned builds, a card a model chooser can list, what it needs of a machine, what it can and
    # cannot do as a model, and a hash of the recipe that src/spec.mjs computes the same way
    rc = spec["recipe"]
    check("the spec holds everything needed to make the swarm again and offer it: every slot with what it is told, the decider's serving recipe, the engine's pinned builds, a card a model chooser can list (engine swarm, memory, what it is equivalent on and where it stands), what it needs of a machine (platforms, memory, disk, licences, whether it may be used commercially), what it can and cannot do (tools go to one model alone), how to start it, and a format, version and hash",
          spec["spec"]["format"] == "the-swarm/spec" and spec["spec"]["version"] == 3 and len(spec["spec"]["recipeSha256"]) == 64 and spec["spec"]["recipeSha256"] == data.recipe_sha256(rc)
          and all(s_.get("brief") for s_ in rc["briefs"]["slots"]) and all(s_.get("brief") for s_ in spec["arrangement"]["slots"]) and rc["briefs"]["slots"] == d["briefs"]["slots"]
          and rc["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and rc["decider"].get("serve") and rc["engine"].get("builds") and rc["serving"]["slots"] == data.SERVING["slots"]
          and spec["card"]["engine"] == "swarm" and spec["card"]["memGb"] > 0 and "Programming and its conversation" in spec["card"]["equivalentOn"] and "Crew" not in json.dumps(spec) and spec["card"]["badge"] and spec["card"]["plain"].startswith("Two small models")
          and spec["requirements"]["commercialUse"] is True and spec["requirements"]["licenses"] and spec["requirements"]["diskGb"] > 0 and spec["requirements"]["platforms"]
          and "alone" in spec["interface"]["capabilities"]["tools"] and "serveSwarm({ ...spec.card, spec }" in spec["interface"]["start"]["host"] and "--spec" in spec["interface"]["start"]["terminal"],
          {k: spec.get(k) for k in ("spec", "card", "requirements")})
    # HOW FAR TRAINING TOOK IT: the arrangement every swarm starts from against the trained one, both served as the recipe says, and the
    # gain; a side measured another way (with other adapters) is not borrowed, and an unmeasured side says so
    eq_d = dict(data.load(root), heldBy=[{"briefs": 1, "adapters": [], "parity": {"percent": 50.0, "equivalent": 21, "compared": 42}},
                                         {"briefs": 4, "adapters": [], "parity": {"percent": 61.9, "equivalent": 26, "compared": 42}},
                                         {"briefs": 1, "adapters": ["a"], "parity": {"percent": 90.0, "equivalent": 38, "compared": 42}}])
    eq4 = data.equivalence_of(eq_d, {"version": 4}, {})
    eq4a = data.equivalence_of(eq_d, {"version": 4}, {"a": {}})
    check("the spec says how far training took the swarm past the arrangement every swarm starts from, served the same way: the default and the trained share of the held questions and the gain in points; a side measured with other adapters is not borrowed; and the adapters it is served with are pinned in the recipe (none here)",
          eq4["default"]["percent"] == 50.0 and eq4["trained"]["percent"] == 61.9 and eq4["gainPoints"] == 11.9
          and eq4a["default"]["percent"] == 90.0 and eq4a["trained"].get("measured") is False and eq4a["gainPoints"] is None
          and data.equivalence_of(eq_d, {"version": 1}, {})["trained"].get("sameAs") and "equivalence" in spec and spec["adapters"] == {"servedWith": False} and "adapters" not in spec["recipe"],
          [eq4, eq4a])
    nc = data.spec(dict(data.load(root), decider=next(x for x in d["registry"]["deciders"] if x["id"] == "startlux-4b")))
    check("a spec whose decider's licence says non-commercial says it may not be used commercially, and lists every licence", nc["requirements"]["commercialUse"] is False and any("NC" in x or "non-commercial" in x for x in nc["requirements"]["licenses"]), nc["requirements"])
    node_ = swarm_ui.node_for_training()
    if node_:
        sp_file = Path(tmp) / "spec.json"
        sp_file.write_text(json.dumps(spec, ensure_ascii=False))
        rd = __import__("subprocess").run([node_, "-e", "import(process.argv[1]).then(m=>{const s=m.readSpec(process.argv[2]);console.log(s.spec.recipeSha256===m.recipeSha256(s.recipe)?'same':'differs')}).catch(e=>console.log('refused: '+e.message))",
                                            (Path(swarm_ui.__file__).resolve().parent.parent / "src" / "spec.mjs").as_uri(), str(sp_file)], capture_output=True, text=True)
        check("the module reads the spec the page writes, and computes its hash the same way", rd.stdout.strip() == "same", rd.stdout + rd.stderr[:300])
    check("the ideas waiting to be tried are no longer on the Train card's head (taken out, console instruction 2026-11-17)", "Ideas waiting to be tried:" not in html.split('<div id="score">')[1].split('</div></div>')[0])
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
    check("with nothing measured and nothing configured the page still opens, and says training starts at question 1", code == 200 and "Training starts at question 1" in html and "No larger model is named" in html)
    srv.shutdown()
    # ---- the Train button, with a stand-in for the session (it writes its steps and waits): no model is started
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
    # CLEAR TRAINING STATE: training's records moved aside, each model's own answers kept; refused while training runs
    tgt_id = d["target"]["id"]
    made_c = {"training/state.json": "{}", "training/states/x.json": "{}", "src/learned/x.json": "{}", ".work/train/loop.json": "{}", ".work/train/swarm-runs.jsonl": "",
              ".work/train/baseline-runs.jsonl": "{}", "training/results/%s/%s-held.json" % (d["key"], tgt_id): "{}",
              "training/results/%s/swarm-train.json" % d["key"]: "{}", "training/results/%s/m-alone-vs-%s-held.json" % (d["key"], tgt_id): "{}",
              ".work/library/%s.json" % d["key"]: '{"arrangements":[{"names":["x"],"what":"x","from":{"question":"q"},"reached":["q"]}]}', ".work/library/%s-policy.json" % d["key"]: '{"policy":{}}'}
    for rel, txt in made_c.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(txt)
    was_rs2 = swarm_ui.run_state
    swarm_ui.run_state = lambda: {"pid": 1, "at": "x", "passes": 0, "first": 1, "running": True}
    busy_code = None
    req = urllib.request.Request(base + "/run/clear", data=b"{}", headers={"x-swarm": "1"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r_:
            busy_code = r_.status
    except urllib.error.HTTPError as x:
        busy_code = x.code
    swarm_ui.run_state = lambda: None
    clear_html = urllib.request.urlopen(urllib.request.Request(base + "/run/clear", data=b"{}", headers={"x-swarm": "1"}), timeout=20).read().decode()
    swarm_ui.run_state = was_rs2
    arch = sorted((root / ".work" / "archive").glob("clear-*"))
    gone = [rel for rel in made_c if not (root / rel).exists()]
    kept_c = [rel for rel in made_c if (root / rel).exists()]
    check("Clear training state starts training again from pass 1: training's records (its state, each configuration's record, what it kept, its measurements and loop) are moved aside to .work/archive, nothing deleted; each model's own answers and their summaries are kept, and so are the found arrangements and the loop's policy (tried first after); the training card says so; it is refused while training runs; and the button sits beside Train",
          busy_code == 409 and len(arch) == 1 and "Cleared: training starts again from pass 1" in clear_html
          and sorted(kept_c) == sorted([".work/train/baseline-runs.jsonl", "training/results/%s/%s-held.json" % (d["key"], tgt_id), "training/results/%s/m-alone-vs-%s-held.json" % (d["key"], tgt_id),
                                        ".work/library/%s.json" % d["key"], ".work/library/%s-policy.json" % d["key"]]) and "the 1 found arrangement" in clear_html
          and all((arch[0] / rel).exists() for rel in gone) and 'id="run-clear"' in swarm_ui.progress_strip(data.load(root)), [busy_code, kept_c, gone])
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
    check("where training can be started the Train card has a Train button that can be pressed, no count of passes to choose, and says it goes on until it is stopped",
          'id="run-go" type="button" title="Train question by question, pass after pass, until Stop training is pressed">Train</button>' in page0 and 'id="run-stop"' not in page0 and 'id="run-passes"' not in page0 and 'class="facts"' not in page0
          and swarm_ui.step_label("10-questions") == "Train, question by question" and swarm_ui.step_label("07-plan") == "Plan what to try" and swarm_ui.step_label("99-new") == "new")
    # THE SWARM AGAINST EACH QUESTION, on the swarm's own card: a pip for each finished question, the counts, and where a pass stopped
    trk_rec = {"pass": 2, "of": 6, "questions": 3, "list": [{"id": "q1", "kind": "math", "state": "at parity", "attempts": [{}]},
               {"id": "q2", "kind": "fix", "state": "reached", "attempts": [{}, {}, {}]}, {"id": "q3", "kind": "day", "state": "not reached", "attempts": [{}] * 9}]}
    was_live = swarm_ui.session_live
    swarm_ui.session_live = lambda: False
    trk = swarm_ui.question_track(dict(d, loop=trk_rec))
    trk_none = swarm_ui.question_track(dict(d, loop=None))
    arr_trk = swarm_ui.arrangement(dict(d, loop=trk_rec))
    swarm_ui.session_live = was_live
    check("the swarm as it stands says where it is against each question: how many of the pass's questions are finished, at parity as it stood, brought to parity by a change, or not reached; a pip for each in order, with the changes tried on it; where the pass stopped; and before the loop has begun, how it works. The track takes the place of a line about moves being tried",
          'id="qtrack"' in trk and "3 of 6 finished" in trk and "1 at parity as it stood" in trk and "1 brought to parity" in trk and "1 not reached" in trk
          and trk.count('<i class="at"') == 1 and trk.count('<i class="re"') == 1 and trk.count('<i class="nr"') == 1 and "q3 · day · 8 changes tried" in trk and "q2 · fix · 2 changes tried" in trk
          and "Pass 2 stopped after question 3 of 6." in trk and "not begun" in trk_none and 'id="qtrack"' in arr_trk and "Being tried now" not in arr_trk and "Stopped while trying" not in arr_trk
          and [x["s"] for x in swarm_ui.track_of(trk_rec)] == ["at", "re", "nr"], trk[:300])
    tl = swarm_ui.tries_list({"list": [
        {"id": "q-easy", "kind": "math", "state": "at parity", "attempts": [{"move": "", "grade": "right"}]},
        {"id": "q-won", "kind": "fix", "state": "reached", "lostAt": "choosing", "attempts": [{"move": "", "grade": "wrong"}, {"move": "plan: decide by most", "grade": "wrong"},
            {"move": "plan: a model decides with the decider", "grade": "right", "guard": {"asked": 2, "lost": 1}, "lostOn": "q-easy"},
            {"move": "a-critic: check the edge cases", "grade": "right", "kept": True, "guard": {"asked": 3, "lost": 0}}]},
        {"id": "q-stuck", "kind": "day", "state": "not reached", "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong"}, {"move": "b-direct: say the weekday last", "grade": "wrong"}]}]})
    check("the question track folds what was tried on each question that needed a change: where its answer was lost and each change in order (what did nothing, what reached parity there but lost a question already there, and what was kept); and the plan section no longer repeats the questions",
          "What was tried on each question that needed a change (2)" in tl and "q-easy</code> <span" not in tl and tl.index("q-stuck") < tl.index("q-won") and "lost in choosing · 3 tried" in tl
          and "lost <code>q-easy</code>, already at parity" in tl and "3 already at parity asked again, none lost" in tl and '>kept</span><span class="tx">a-critic: check the edge cases' in tl and "Not reached" in tl and "Brought to parity" in tl
          and swarm_ui.tries_list({"list": []}) == "" and "Question by question" not in swarm_ui.plan_block(d) and "loopwrap" not in swarm_ui.plan_block(d), tl[:300])
    tm = swarm_ui.tries_list({"list": [{"id": "q-m", "kind": "fix", "state": "not reached", "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong"},
        {"move": "flow: the answers go back", "grade": "wrong", "round": 2, "closer": True, "near": {"lost": "choosing", "had": 2, "p": 0.35},
         "method": {"place": 4, "open": 37, "from": {"lost": "drafting", "had": 0}, "reasons": ["no slot had the answer: this makes other drafts", "the first area for an answer lost in drafting (slots)"]}}]}]})
    page = get(base + "/")[1]
    check("each change in the fold says how it was chosen and how close it came: its round and place among those open, each reason, and where the answer was lost before and after it, with how many slots had it and the decider's probability; while a change is tried the page shows the same live, with what was tried on the question before it",
          "why: round 2, 4 of 37 open; no slot had the answer: this makes other drafts; the first area for an answer lost in drafting (slots)" in tm
          and "came out: lost in choosing, 2 slots had the answer, the decider 35% on it (before it: lost in drafting, 0 slots had the answer)" in tm
          and swarm_ui.method_line({"move": "x"}) == "" and "fold.className='qmethod'" in page and "Why it is tried now" in page and "Tried on this question before it" in page, tm[:400])
    pb = swarm_ui.policy_block({"loopPolicy": {"order": ["pin", "evidence", "momentum", "learned", "area", "cost", "fresh", "plan"], "batch": 2, "beam": 3, "momentumRecent": 3,
                                               "learnedMinTried": 3, "partialCredit": True, "skipWriterUnlessWriting": True, "reviewEvery": 6, "trialQuestions": 6},
                                "trial": {"taken": [{"knob": "batch", "from": 8, "to": 2, "why": "build on what came closer sooner"}], "done": 2, "of": 6},
                                "policyLog": [{"event": "put back", "taken": [{"knob": "beam", "from": 3, "to": 6}], "verdict": {"during": 0.05, "before": 0.1, "reachedDuring": 2, "duringN": 6, "reachedBefore": 4, "beforeN": 6}},
                                              {"event": "on trial", "taken": [{"knob": "batch", "from": 8, "to": 2}], "ideas": ["reuse the checks too"]}]})
    check("the loop's policy is on the page: how the search is ranked and bounded now, what is on trial and how far, and each proposal of the larger model with what became of it (kept, put back with the measure against before, its ideas that need code); before a pass has run this version it says what will happen",
          "ranked by pinned → the question&#x27;s record → like a kept change → what has worked" in pb and "2 changes from the closest before looking again" in pb
          and "<b>On trial:</b> batch 8 → 2 (build on what came closer sooner) · 2 of 6 questions" in pb and ">put back</span>" in pb and "0.05 against 0.1 before (kept 2 of 6 tries, against 4 of 6)" in pb and "no signal: nothing came closer" in swarm_ui.policy_block({"loopPolicy": {"order": ["pin"]}, "policyLog": [{"event": "put back", "taken": [{"knob": "beam", "from": 5, "to": 3}], "verdict": {"keep": False, "inconclusive": True, "during": 0, "before": 0}}]})
          and "ideas that need code: reuse the checks too" in pb and pb.index("put back") > pb.index("On trial") and "A pass that runs this version writes it here" in swarm_ui.policy_block(None)
          and "line('Policy on trial:'" in page, pb[:300])
    tb = swarm_ui.tries_list({"list": [{"id": "q-c", "kind": "fix", "state": "reached", "lostAt": "choosing", "broke": {"q-other": 3}, "attempts": [{"move": "", "grade": "wrong"},
        {"move": "x", "grade": "right", "lostOn": "q-other", "nearParity": True, "method": {"place": 1, "open": 4, "from": {"lost": "choosing", "had": 1}, "reasons": []}},
        {"move": "y", "on": ["x"], "grade": "right", "kept": True, "method": {"place": 1, "open": 3, "from": {"lost": "choosing", "had": 1, "parity": True, "broke": "q-other"}, "reasons": []}}]}]})
    pf_root = Path(tempfile.mkdtemp())
    (pf_root / ".work" / "train" / "k1").mkdir(parents=True)
    (pf_root / ".work" / "train" / "k1" / "loop-policy.json").write_text(json.dumps({"policy": {"batch": 5, "order": ["pin"]}, "log": [{"event": "on trial", "during": "q12"}]}))
    pf = swarm_ui.loop_policy_of({"root": str(pf_root), "key": "k1", "loop": {"list": [], "loopPolicy": {"batch": 8}}})
    check("a conflict between two questions is on the page: the question it broke and how often, in the fold and while it runs; a change built on a parity that broke one says so; and the loop's policy is read from the file the loop writes as it goes, newer than the record of finished questions",
          "broke q-other 3×" in tb and "at parity here, but it broke q-other when that was asked again" in tb and "line('Conflict:'" in page and "'broke one'" in page
          and pf["loopPolicy"]["batch"] == 5 and pf["policyLog"][0]["during"] == "q12" and swarm_ui.loop_policy_of({"root": str(pf_root), "key": "none", "loop": {"loopPolicy": {"batch": 8}}})["loopPolicy"]["batch"] == 8, tb[:300])
    sgb = swarm_ui.policy_block({"loopPolicy": {"order": ["pin"], "suggestEvery": 20}, "suggest": {"asked": 3, "seconds": 126, "tried": 11, "kept": 1, "closer": 4, "failed": 0},
                                 "suggestLog": [{"picks": ["e + f", "g"], "came": ["closer", "no closer"]}]})
    check("what the larger model's suggestions of what to try have cost and come to is on the page, with the last ones, and live while it runs; the policy says after how many failed tries it is asked",
          "<b>Suggestions of the larger model:</b> asked 3 times (about 42 s each); 11 tried: 1 kept, 4 came closer. The last: e + f (closer); g (no closer)." in sgb
          and "the larger model suggests what to try after 20 failed tries" in sgb and "line('Suggestions:'" in page and "'suggested, no'" in page, sgb[:300])
    pn = swarm_ui.plan_now(dict(d, loop={"of": 10, "tries": 57, "changes": [{"kind": "library"}, {"kind": "several", "swapped": "q1"}], "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "reached"}],
                                          "suggest": {"asked": 2, "seconds": 80, "tried": 6, "kept": 1, "closer": 2}, "trial": {"taken": [{"knob": "beam", "from": 3, "to": 5}], "done": 12, "of": 40, "unit": "tries"}}))
    vz = swarm_ui.viz_block(d)
    check("the plan section says what the loop is doing, from the loop: whether it runs and which question is in hand, this pass so far (finished, tried, kept, from the library, suggested, swaps), the found arrangements, what is on trial, the suggestions, and the steps each question goes through; the system is drawn below it, every part with a code to name it by, the ones the loop moves through marked live",
          "<th>Now</th>" in pn and "2 of 10 questions finished" in pn and "57 changes tried; <b>2</b> kept (1 of them found arrangements, 1 suggested by the larger model, 1 swap)" in pn
          and "On trial: beam 3 → 5 · 12 of 40 tries done" in pn and "Asked 2 times, about 40 s each; 6 tried: 1 kept, 2 came closer" in pn and pn.count("<li") == 6 and "Try the found arrangements, the most successful first" in pn
          and all(">%s</span>" % c in vz for c in ("A1", "A2", "A3", "B1", "B2", "B3", "B4", "B5", "B6", "C1", "C6", "D1", "D2", "D3", "E1", "E2"))
          and all('data-part="%s"' % k in vz for k in ("ask", "library", "search", "suggest", "guard", "keep", "review"))
          and 'id="system">Visualizing the System' in html and html.index('id="strategy"') < html.index('id="system"') and "#viz [data-part]" in html, pn[:300])
    wb = swarm_ui.learned_block(dict(d, learned=dict(d["learned"], wins=[
        {"what": "move b-direct to c", "kind": "arrangement", "at": "2026-11-17T01:49", "pass": 1, "question": {"id": "q-a", "lostAt": "choosing", "attempt": 28}, "run": "clear-20261117-104329", "inArrangement": False},
        {"what": "several: x + y", "kind": "several", "at": "2026-11-17T15:46", "pass": 1, "question": {"id": "q-b", "lostAt": "drafting", "attempt": 3}, "inArrangement": True}])))
    check("the spec holds every win, cumulative across Clear training state: each change that brought a question to parity, from every run, numbered in order, the ones the arrangement carries now marked, the rest said to be found (and when their run was set aside)",
          "Everything it has found (2 wins, every run)" in wb and wb.count('<li class="kept">') == 2 and ">In the arrangement<" in wb and ">Found · a run set aside 2026-11-17 10:43<" in wb
          and "it never takes a win out of here" in wb and "<b>1</b> is in the arrangement" in wb and wb.index("x + y") < wb.index("move b-direct to c"), wb[:300])
    bz = swarm_ui.plan_now(dict(d, loop={"of": 84, "list": [{"id": "q-n", "state": "not reached", "beyond": {"at": 200, "taught": 3, "ready": {"examples": 84, "trainable": [{"model": "LFM2.5 1.2B", "ok": False, "why": "llama-finetune cannot train it: SSM_CONV has no backward pass"}]}}}],
                                          "teach": {"asked": 3, "seconds": 45, "briefs": 9, "tried": 9, "kept": 0, "closer": 1}}))
    check("a question beyond rearranging is on the page: after how many tries, that it stays in hand, what was made ready for a fine-tuned adapter, and whether each small model can be trained here and why not; and the briefs the larger model wrote, with what they came to",
          "<th>Beyond rearranging</th>" in bz and "<code>q-n</code> after 200 tries" in bz and "it stays in hand" in bz and "84 train answers" in bz and "LFM2.5 1.2B cannot: llama-finetune cannot train it: SSM_CONV has no backward pass" in bz
          and "<th>Briefs written</th>" in bz and "9 briefs, 9 tried, 0 kept, 1 came closer" in bz, bz[:300])
    lb_root = Path(tempfile.mkdtemp())
    (lb_root / ".work" / "library").mkdir(parents=True)
    (lb_root / ".work" / "library" / "k2.json").write_text(json.dumps({"arrangements": [{"names": ["a"], "what": "move a to c", "from": {"question": "q1"}, "reached": ["q1"], "tried": 3},
                                                                                         {"names": ["b", "c"], "what": "several: b + c", "from": {"question": "q2"}, "reached": ["q2", "q5"]}]}))
    lbk = swarm_ui.library_block({"root": str(lb_root), "key": "k2"})
    check("the found arrangements are on the page, the most successful first, with how many questions each brought to parity and where it was found; with none, the page says what will be kept there; a question a swap put back in hand is shown as back in hand",
          "Found arrangements (2)" in lbk and lbk.index("several: b + c") < lbk.index("move a to c") and "found on <code>q2</code>" in lbk and "tried 3 times since" in lbk
          and "None yet" in swarm_ui.library_block({"root": str(lb_root), "key": "none"}) and swarm_ui.PIP["reopened"] == "ro" and swarm_ui.LOOP_STATE["reopened"][0] == "Back in hand", lbk[:300])
    looped = swarm_ui.arrangement(dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "repeat", "upTo": 2, "steps": [{"do": "decide", "keep": 2}, {"do": "revise"}]}, {"do": "write"}])))
    tu = swarm_ui.tries_list({"list": [{"id": "q-u", "kind": "talk", "state": "not reached", "unstable": True, "exhausted": True, "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong", "seconds": 40},
        {"move": "flow: x", "grade": "wrong", "seconds": 55.5, "added": 15.5, "near": {"lost": "choosing", "had": 1, "slots": ["a-direct"]}, "method": {"place": 1, "open": 9, "from": {"lost": "drafting", "had": 0}, "reasons": []}}]}]})
    check("training's own change count is told apart from the flow's repeat (training change N; in each answer: again ... up to N times); each change says what a run took with it and what it added; a question whose mark the larger model did not give again says so, and not that no combination came closer; the slots that had the answer are named; and the page says the pace, the unstable mark and what reuse saved while it runs",
          "'training change '+lp.attempt" in page and "in each answer: again while the answers differ" in looped and "55.5 s a run (+15.5 s against what it was tried on)" in tu
          and "unstable mark: the larger model did not give its own answer again" in tu and "every combination within reach tried" in tu and "1 slot had the answer (a-direct)" in tu
          and "line('Pace:'" in page and "line('Unstable mark:'" in page and "if(qkey&&qn.dataset.k===qkey){}" in page and "if(lp.attempt&&lp.method){" in page and "fold=document.createElement('details');fold.className='qmethod'" in page and "fold.dataset.keep='qmethod'" in page and "localStorage.getItem('swarm.open.qmethod')==='1'" in page and "lp.guarded.n+' of '+lp.guarded.of" in page and "slot answers reused unchanged so far" in page and "it never moves on before" in pol_html and "The arrangements found so far are tried on it first" in pol_html and "the search widens" in pol_html,
          [x for x in ("'training change '+lp.attempt", "line('Pace:'", "line('Unstable mark:'", "slot answers reused unchanged so far") if x not in page] + ([] if "in each answer" in looped else ["loop label"]))
    refused = post("/run/start", headers={"content-type": "text/plain"})[0]
    foreign = post("/run/start", headers={"x-swarm": "1", "origin": "https://elsewhere.example"})[0]
    check("a pass cannot be started by anything but this page: a request without the page's own header, or from another site, is refused", refused == 403 and foreign == 403 and not (fake / ".work" / "train" / "ui-run.json").exists(), [refused, foreign])
    code, panel = post("/run/start")
    time.sleep(1.0)
    panel = get(base + "/fragment/run")[1]
    st = json.loads((fake / ".work" / "train" / "ui-run.json").read_text())
    check("pressed, it starts a session that goes on until it is stopped (no number of passes is given it, and no number of questions: that is the trainer's policy), and the Train card shows it running: Stop training in place of Train, how long and since when, that it goes on until stopped, and a moving bar in place of the share",
          code == 200 and 'data-running="1"' in panel and "Stop training" in panel and 'id="run-go"' not in panel and 'data-since="' in panel and "<b>Running " in panel and "<small>since " in panel and swarm_ui._span(45) == "45 s" and swarm_ui._span(750) == "12 min 30 s" and swarm_ui._span(7500) == "2 h 5 min" and "timeZoneName" in html
          and "until stopped" in panel and panel.startswith('<div class="trainprog trainhead">') and 'class="pct busy"' in panel and 'class="facts"' not in panel and 'id="run-each"' not in page0 and "asked 0 " in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text(), panel[:400])
    check("a teacher is never started from the button, whatever the page was started with", "teacher=[]" in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text())
    # what every slot is doing now: written by a trainer, shown only while a session runs and only while it is fresh
    (fake / ".work" / "train" / "live.json").write_text(json.dumps({"at": time.time() * 1000, "trainer": "measure", "who": "swarm", "split": "train", "n": 3, "of": 42,
        "question": {"id": "q", "kind": "fix", "ask": "Correct this function."}, "slots": {"a-direct": {"state": "working", "since": time.time() * 1000}, "decide": {"state": "done", "ms": 310, "said": "Picked B."}}}))
    now = json.loads(get(base + "/api/live")[1])
    check("while a session runs the page can ask what every slot is doing at this moment: which question, which slots are working, what one just answered",
          now["running"] and now["question"]["kind"] == "fix" and now["slots"]["a-direct"]["state"] == "working" and now["slots"]["decide"]["said"] == "Picked B." and now["whoName"] == "The swarm", now)
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
    check("what is folded keeps its state: open or folded is kept on the device and put back each time a part is drawn again, saved on a click of the heading, not on every toggle; and the decider is named with what it is doing",
          "details.fold>summary" in html and "keepOpen($(into))" in html and "swarm.open." in html and "closest('details[data-keep]>summary')" in html and "addEventListener('toggle'" not in html
          and swarm_ui.decider_state(False) in ("not running", "ready", "busy") and swarm_ui.decider_state(True) in ("starting", "ready", "busy"))
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
    check("Stop training stops it, and the page says it was stopped and offers the button again, the share of training complete back in place of the moving bar", gone and ">Train</button>" in after and "Stopped at" in after and 'data-running' not in after and "pct busy" not in after and '<b class="pct">' in after, after[:300])
    srv.shutdown()
    for k in ("NODE", "SWARM_LLAMA_SERVER", "TEACHER"):
        os.environ.pop(k, None)
    srv, base = serve(Path(__file__).resolve().parent.parent)
    code, html = get(base + "/")
    check("on this repository it opens and names the model being chased", code == 200 and "Nemotron 3.5 Lightning 30B" in html and "Sample data" not in html)
    srv.shutdown()

# THE RECOMMENDATIONS WEIGH EVERY SAVED ALONE MEASUREMENT: those in each configuration's folder too (the badge once read only the
# top of training/results, and recommended nothing while six models were measured), only those on the same questions, a model
# measured more than once by its mean, and a lead only where it clears how far one model's runs differ
with tempfile.TemporaryDirectory() as tmp:
    res = Path(tmp) / "training" / "results"
    def alone(folder, mid, right, of=84, kinds=("bug", "write-arrays"), at="2026-11-17T10:00:00Z"):
        f = res / folder / ("%s-alone-vs-tgt-held.json" % mid) if folder else res / ("%s-alone-vs-tgt-held.json" % mid)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"at": at, "seed": 7919, "right": right, "compared": of, "kinds": {k: 1 for k in kinds}}))
    alone("cfg1", "m-small", 16, at="2026-11-16T10:00:00Z")
    alone("cfg2", "m-small", 30, at="2026-11-17T10:00:00Z")
    alone("cfg2", "m-big", 44)
    alone("cfg2", "m-mid", 25)
    alone("", "m-other", 40, of=42, kinds=("bug",))
    sc = swarm_ui.alone_scores(tmp, "tgt", ["m-small"])
    check("the recommendations read alone measurements in every configuration's folder, compare only those on the same questions, take a model measured twice by its mean, and set the bar at how far one model's runs differ",
          set(sc["models"]) == {"m-small", "m-big", "m-mid"} and sc["models"]["m-small"]["runs"] == 2 and abs(sc["models"]["m-small"]["pct"] - 100 * 23 / 84) < 0.01
          and abs(sc["bar"] - 100 * 14 / 84) < 0.01 and swarm_ui.alone_scores(tmp, "none")["models"] == {},
          json.dumps({k: round(v["pct"], 1) for k, v in sc["models"].items()}))

# THE HEAD OF EVERY CARD IS ONE STRUCTURE: the figure, what the card does, its controls, in that order, on one grid of fixed columns
with tempfile.TemporaryDirectory() as tmp:
    srv, base = serve(Path(__file__).resolve().parent.parent)
    page = get(base + "/")[1]
    srv.shutdown()
    heads = re.findall(r'<div class="proghead">(.*?)</div>', page, re.S)
    shape = [re.findall(r'<span class="(memnum|progline|evctl)"', h)[:3] for h in heads]
    check("every card's head (Memory saved, Evaluate, Pretrain, Train) is one structure: the figure, what the card does, its controls, in three columns of the same widths",
          len(heads) >= 4 and all(x == ["memnum", "progline", "evctl"] for x in shape)
          and "grid-template-columns:330px minmax(0,1fr) 300px" in page and ".memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{display:grid" in page, shape)

print("\n" + ("%d FAILED, " % len(failed) if failed else "all ") + "%d passed." % passed)
sys.exit(1 if failed else 0)
