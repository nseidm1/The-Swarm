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

# (the cards' own Start buttons are drawn for these checks, which are of them: by default only the Run card has one)
swarm_ui.CARD_STARTS = True

# THE CHECKS ARE THE SAME ON ANY MACHINE: where one needs the repository itself, it is given REPO, a copy of the code with a
# lineup of the checks' own and none of this machine's state (no chosen configuration, no learned record, no working folder).
# One read the configuration chosen here, 2026-11-20, and failed when a person chose a lineup with no decision model. The
# checks in tests/ have had a configuration of their own for the same reason (tests/env.mjs); the same lineup is used here.
_HERE = Path(__file__).resolve().parent.parent
REPO = Path(tempfile.mkdtemp(prefix="swarm-check-repo-"))
for _part in ("src", "training", "ui", "docs"):
    if (_HERE / _part).is_dir():
        shutil.copytree(_HERE / _part, REPO / _part, ignore=shutil.ignore_patterns("learned", "__pycache__", "node_modules", ".work", "questions"))
for _f in ("package.json", "CHANGELOG.md", "README.md"):
    if (_HERE / _f).is_file():
        shutil.copy(_HERE / _f, REPO / _f)
(REPO / "src" / "config.json").write_text(json.dumps({"a": "lfm25-2.6b", "b": "bonsai2-2b", "decider": "kev-4b", "target": "nemotron35-30b"}, indent=2) + "\n")
import atexit as _atexit  # noqa: E402
_atexit.register(lambda: shutil.rmtree(REPO, ignore_errors=True))

# (the checks below stand in for a run this page started by writing down the id of THIS process: it is alive, and for them it is
# the run. The page's own test of whose process an id is, _ours, is checked by itself at the end, with the real one)
_ours_real = swarm_ui._ours
swarm_ui._ours = lambda pid, marker: True if pid == os.getpid() else _ours_real(pid, marker)

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
    code, html = get(base + "/page")
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
    check("the page says how far training has come, question by question: a percentage of answers good at the head of the Train card (no bar, legend, spec line or ideas line under it: taken out), and no parity verdict, held-question card or whole-measurement dialog any more",
          '<h2 id="arrangement">Train</h2>' in html and "<h2>Training progress</h2>" not in html and 'class="trainprog trainhead"' in strip and "answers good" in strip and "training complete" not in strip
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
    check("a move a trainer marked as being measured says so only while a session runs: once the session has stopped, it says it was stopped partway, and the swarm's card has no line of moves marked running and no label on a face (and no question track: it was taken out of the card, what it said being said by the plan)",
          "Being measured" in plan_live and "Stopped partway" not in plan_live and 'id="qtrack"' not in arr_live and "Being tried now" not in arr_live
          and "Stopped partway" in plan and ">Being measured<" not in plan and "stopped partway: " in plan and 'id="qtrack"' not in arr_stopped and "Stopped while trying" not in arr_stopped and "Being tried now" not in arr_stopped and 'class="tb' not in arr_stopped, plan[:200])
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
    check("answers good says how far the pass has come and never more: before anything, nothing; then the share of the pass's questions answered well (as the swarm stood, made good by a change), with any back in hand after a swap, the found arrangements and what the spec kept",
          "0%</b><span>answers good" in p_none and "Training starts at question 1" not in p_none and '<span class="progline"> </span>' in p_none
          and "30%</b><span>answers good" in p_some and "<b>3</b> of 10 train answers good" in p_some and "<b>2</b> as the swarm stood, <b>1</b> made good by a change it kept" in p_some and "at parity" not in p_some
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
    check("the plan says how the swarm is being trained, from its policy: how many changes are tried on a question, how a change is kept (by its class where the policy says so, else asked again on questions already good), when a change is dropped, and what the plan lists first; a flow that asks what each call should give is drawn with that step; and parity is also counted where the larger model follows the question",
          "How it is training" in pol_html and "or after <b>12</b> changes" in pol_html and "until its answer is good" in pol_html and "with up to <b>3</b> such arrangements open at a time" in pol_html and "The loop&#39;s policy" in pol_html and "or after" not in swarm_ui.plan_panel(d) and (("scored on the questions of its class" in pol_html and "the first <b>8</b>" in pol_html and "at least <b>0.02</b>" in pol_html and "asked again on" not in pol_html) if d["policy"]["loop"].get("classKeep") is True else "asked again on <b>6</b> questions already good" in pol_html) and "wins" not in pol_html and d["policy"]["loop"]["cap"] is None and d["policy"]["loop"]["beam"] == 3
          and "Says what each call should give" in exp_html and exp_html.count('class="stage"') == 5
          and data.parity(spec_rows)["onSpec"]["compared"] == 8, pol_html[:200])
    spec_html = get(base + "/fragment/spec")[1]
    sp = data.spec(d)
    check("the SwOA spec is the record of what this configuration has learned against this larger model: every change that was kept, newest first, with where it came from and the answers it won on train and on held; where each pass left it; the flow; and a count of them on its pill",
          len(d["learned"]["ledger"]) == 2 and sp["learned"]["changesKept"] == 2 and "What it has learned (2 kept)" in spec_html and spec_html.index("go back to the drafters") < spec_html.index("the shortest brief that still asks for a test")
          and "arxiv.org/abs/2603.16045" in spec_html and "13 → 15" in spec_html and "6 → 7" in spec_html and "Where each pass left it" in spec_html and "pass 4: 75% · 9 of 12" in spec_html
          and "The flow" in spec_html and "SwOA spec<span>2 learned</span>" in html and d["briefs"].get("version") == 3 and sp["arrangement"]["flow"][0]["do"] == "draft", sp["learned"]["changesKept"])
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
          # (the card is its head, the adapters and the faces: its title with chips, its line of what is happening and the question
          # track were taken out, each being said elsewhere on the page, console 2026-11-24)
          'class="panel arr"' in arr and "<h3>The swarm as it stands</h3>" not in arr and 'class="achips"' not in arr and 'id="now"' not in arr and 'id="qtrack"' not in arr and 'class="qkey"' not in arr and 'id="score"' in arr and arr.count('class="mav ') == len(d["members"]) + 2
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
    check("the models, who takes turns with tools and a person's own questions are one section, Configuration, that folds (open to begin with) and folded says in a line what the swarm is (its models, its decider, its larger model, who takes turns with tools, and no body of work: none is chosen); the line is drawn again when one changes",
          '<details class="cfg fold" data-keep="cfg" open>' in html and html.index('data-keep="cfg"') < html.index('id="picks"') < html.index('id="tools"') < html.index('id="ownq"') < html.index('id="body"') and 'id="cfg-meta"' in html
          and " decides · against " in html.split('id="cfg-meta">')[1][:200] and " · on " not in html.split('id="cfg-meta">')[1].split("</span>")[0] and " · tools: " in html.split('id="cfg-meta">')[1].split("</span>")[0]
          and get(base + "/fragment/cfgmeta")[0] == 200 and "swap('/fragment/cfgmeta','#cfg-meta')" in html, html.split('id="cfg-meta">')[1][:160])
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
          code_ok == 200 and after["a"] == other["id"] and other["name"] in drawn and "answers good" in drawn and "At parity with" not in drawn and "Not at parity with" not in drawn and after["b"] == d["members"]["b"]["id"], after)
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
    # ONE MODEL OR SEVERAL, as the page sends it: one model fills both places and takes any other out; several models shows a
    # pill for each place without changing them; and one model again is the first place's
    _b_was = json.loads((root / "src" / "config.json").read_text())["b"]
    send("/config", {"c": third["id"]})
    c_one, _ = send("/config", {"one": third["id"]})
    cfg_one = json.loads((root / "src" / "config.json").read_text())
    picks_one = get(base + "/fragment/picks")[1]
    c_mix, _ = send("/config", {"mix": True})
    cfg_mix = json.loads((root / "src" / "config.json").read_text())
    picks_mix = get(base + "/fragment/picks")[1]
    send("/config", {"b": fourth["id"]})
    c_back, _ = send("/config", {"mix": False})
    cfg_back = json.loads((root / "src" / "config.json").read_text())
    check("the page sets the swarm to one model (both places that model, any third taken out) or to several (a pill for each place, nothing else changed), and back to one, which is the first place's model; a model that is not listed and a choice that is not yes or no are refused",
          c_one == 200 and cfg_one["a"] == cfg_one["b"] == third["id"] and "c" not in cfg_one and "mix" not in cfg_one and 'data-pick="one"' in picks_one
          and c_mix == 200 and cfg_mix.get("mix") is True and cfg_mix["a"] == cfg_mix["b"] == third["id"] and 'data-pick="b"' in picks_mix
          and c_back == 200 and cfg_back["a"] == cfg_back["b"] == third["id"] and "mix" not in cfg_back
          and send("/config", {"one": "no-such-model"})[0] == 400 and send("/config", {"mix": "yes"})[0] == 400, [cfg_one, cfg_mix, cfg_back])
    # (put back as it was for the checks after this one)
    send("/config", {"mix": True}), send("/config", {"a": d["members"]["a"]["id"]}), send("/config", {"b": _b_was})
    _put = json.loads((root / "src" / "config.json").read_text())
    _put.pop("mix", None)
    (root / "src" / "config.json").write_text(json.dumps(_put, indent=2) + "\n")
    # NOTHING CHOOSES WHAT THE SWARM IS TRAINED ON (console ruling 2026-11-18): the boxes to tick, "Equivalent on", are gone. Under
    # the pills are two rows: who takes a turn with tools, and a button for each body of work that opens a person's own questions
    cfg_html = swarm_ui.config_section(data.load(root))
    e_no, e_why = send("/config", {"equivalence": ["reasoning", "crew"]})
    cfg_file = root / "src" / "config.json"
    cfg_was = cfg_file.read_text()
    cfg_file.write_text(json.dumps({**json.loads(cfg_was), "equivalence": ["math"]}))
    asked_old = data.load(root)["equivalence"]["asked"]
    t_ok, _ = send("/config", {"tools": "swarm"})
    cfg_after = json.loads(cfg_file.read_text())
    cfg_file.write_text(cfg_was)
    eq_all = data.load(root)["equivalence"]
    tg = eq_all["targets"]
    parts_nc = {
        "no boxes": "Equivalent on" not in html and "data-equiv" not in html and 'class="equiv"' not in html and 'class="tick"' not in html and 'class="tick on"' not in html and "data-qedit" in html and "{equivalence:" not in html and "/fragment/equiv" not in html,
        "two rows": cfg_html.count('class="cfgrow"') == 2 and 'id="pre-use"' not in cfg_html and '<span class="cfgl">Adapters</span>' not in cfg_html and '<span class="cfgl">Turns with tools</span><div class="tools" id="tools">' in cfg_html and '<span class="cfgl">Your own questions</span><div class="ownq" id="ownq">' in cfg_html,
        # (a swarm of one model, its turns decided by the swarm, is not asked who takes turns with tools; set to one model alone,
        # or made of several, the row is there. And One model says nothing under the choice.)
        "one model": swarm_ui.tools_row({"members": {"a": {"id": "x", "name": "X"}, "b": {"id": "x", "name": "X"}}, "tools": "swarm", "mix": False}) == ""
        and "Turns with tools" in swarm_ui.tools_row({"members": {"a": {"id": "x", "name": "X"}, "b": {"id": "x", "name": "X"}}, "tools": "a", "mix": False})
        and "Turns with tools" in swarm_ui.tools_row({"members": {"a": {"id": "x", "name": "X"}, "b": {"id": "y", "name": "Y"}}, "tools": "swarm", "mix": False})
        and "fills every role of the module" not in html,
        "no description": 'data-tools="swarm"' in cfg_html and "An agent&#x27;s turn" not in cfg_html and "<p>" not in cfg_html and "<p " not in cfg_html and "<small>The " not in cfg_html,
        "eight buttons": cfg_html.count('class="ownb"') == 8 and all('data-qedit="%s"' % i in cfg_html for i in ("crew", "code", "math", "logic", "reasoning", "instructions", "tools", "search")),
        "refused": e_no == 400 and "every body of work" in e_why and "equivalence" not in json.loads(cfg_was) and get(base + "/fragment/equiv")[0] == 404,
        "leftover": asked_old == eq_all["asked"] and t_ok == 200 and "equivalence" not in cfg_after and cfg_after["tools"] == "swarm",
        "asked": "chosen" not in eq_all and eq_all["asked"] == data.bodies_asked(tg, data.load(root)["state"]) == [t["id"] for t in tg] and len(tg) == 8
                 and "A pass asks every body of work: <b>55</b> kinds of question" in swarm_ui.main_body(data.load(root)),
        "record": data.bodies_asked(tg, {"kinds": next(t["kinds"] for t in tg if t["id"] == "crew"), "history": [{"pass": 1}]}) == ["crew", "code"]
                  and data.bodies_asked(tg, {"history": [{"pass": 1}]}) == ["code"] and data.bodies_asked(tg, {"kinds": ["chain"]}) == [] and data.bodies_asked(tg, {}) == [t["id"] for t in tg],
        # (and a SwOA says what its training asked from the questions of the pass in hand, where it has asked any)
        "swoa": data.bodies_trained({"equivalence": {"targets": tg, "asked": ["math"]}, "loop": {"list": [{"kind": k} for k in next(t["kinds"] for t in tg if t["id"] == "crew")]}}) == ["crew", "code"]
                and data.bodies_trained({"equivalence": {"targets": tg, "asked": ["math"]}, "loop": None}) == ["math"]
                and data.bodies_trained({"equivalence": {"targets": tg, "asked": ["math"]}, "loop": {"list": [{"kind": "chain"}]}}) == [],
    }
    check("what the swarm is trained on is not chosen: no box to tick anywhere on the page, nothing called Equivalent on, and the page's script sends no such choice; under the pills are two rows, each with its label and no description: who takes a turn with tools, and a button for each of the eight bodies of work that opens a person's own questions; a choice sent to the configuration is refused and nothing is written, and one left in the file from when there was one is not read and is taken out the next time the file is written; a pass asks every body of work, unless its record names the kinds it began with (a body is asked where every kind of it is; a record from before there was a list is of the programming kinds); and a SwOA says which bodies of work its training asked from the questions of the pass in hand as they were asked, so a pass begun when fewer were asked claims no more",
          all(parts_nc.values()), {k: v for k, v in parts_nc.items() if not v} or [e_no, e_why, asked_old, sorted(cfg_after)])
    pens = swarm_ui.own_questions(data.load(root))
    panel_q = get(base + "/fragment/questions?id=crew")[1]
    q_ok, q_row = send("/questions", {"id": "crew", "questions": [{"ask": "  Move my dentist to Friday.  "}, {"ask": "Is a sleep a fix?", "mode": "developer"}, {"ask": " "}]})
    q_file = json.loads((root / "training" / "questions" / "crew.json").read_text())
    panel_q2 = get(base + "/fragment/questions?id=crew")[1]
    m_ok, _ = send("/questions", {"id": "math", "questions": [{"ask": "What is 17 times 23?", "mode": "developer"}]})
    m_file = json.loads((root / "training" / "questions" / "math.json").read_text())
    check("each body of work has a button under the pills that opens its questions: the kinds the trainer makes (not edited) and the questions a person wrote, one row each, with Simple or Developer for programming and its conversation; saving writes them whole (blank ones dropped, a mode only where it means something), the button then says how many there are, and the next opening shows them; they are asked beside the ones made, an addition and never a choice; an unknown body of work, more than 200, or a list that is not one is refused",
          pens.count('class="ownb"') == 8 and 'data-qedit="crew"' in pens and "Your own questions for Programming and its conversation: none written" in pens and 'id="qedit"' in html and pens.startswith('<div class="ownq" id="ownq">')
          and "Questions: Programming and its conversation" in panel_q and "Made by the trainer" in panel_q and "Simple: a piece of writing" in panel_q and "Developer: their own project" in panel_q and "Write a function: arrays" in panel_q and panel_q.count('class="qrow"') == 1 and "0 of 200" in panel_q
          and q_ok == 200 and q_file == {"questions": [{"ask": "Move my dentist to Friday."}, {"ask": "Is a sleep a fix?", "mode": "developer"}]} and "Programming and its conversation <em>2</em>" in q_row and "Your own questions for Programming and its conversation: 2 written" in q_row and not q_row.startswith("<div") and '<div class="kicker">A body of work</div>' in panel_q and "<h4>Your own questions</h4>" in panel_q
          and panel_q2.count('class="qrow"') == 3 and "Move my dentist to Friday." in panel_q2 and '<option value="developer" selected>' in panel_q2 and "2 of 200" in panel_q2
          and m_ok == 200 and m_file == {"questions": [{"ask": "What is 17 times 23?"}]} and "data-q-mode" not in get(base + "/fragment/questions?id=math")[1].split("<template")[0]
          and send("/questions", {"id": "poetry", "questions": []})[0] == 400 and send("/questions", {"id": "crew", "questions": "x"})[0] == 400 and send("/questions", {"id": "crew", "questions": [{"ask": "q"}] * 201})[0] == 400
          and json.loads((root / "training" / "questions" / "crew.json").read_text()) == q_file and "no body of work called that" in get(base + "/fragment/questions?id=nope")[1], [q_ok, q_file, m_file])
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
          busy0 == {"busy": ""} and 'id="busy" data-busy=""' in body0 and "busyTick" in get(base + "/page")[1],
          json.dumps(busy0))
    bad_size = send("/eval/start", {"limit": 7})[0]
    # (which bodies of work a run asks: none, one that is not listed, one with no standard test, or not a list, is refused)
    bad_items = [send("/eval/start", {"limit": 20, "items": x})[0] for x in ([], ["poetry"], ["crew"], "instructions")]
    # (and the harnesses: none, one that is not a harness, not a list; and a body of work none of whose harnesses is ticked)
    bad_harness = [send("/eval/start", {"limit": 20, "harnesses": x})[0] for x in ([], ["mine"], "lm")] + [send("/eval/start", {"limit": 20, "items": ["math"], "harnesses": ["bfcl"]})[0]]
    foreign = send("/eval/start", {"limit": 20}, {"x-swarm": "0"})[0]
    # (this block is about Pretrain and Evaluate themselves: the configuration counts as evaluated here; the rule has its own check)
    _ne = swarm_ui.needs_eval
    swarm_ui.needs_eval = lambda d=None: ""
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
          "15 of 20 the same (75%)" in ev_mix and "another configuration" not in ev_mix
          and "Not evaluated as the swarm is now" in ev_none and "of another configuration" in ev_none and "the same</span>" not in ev_none.split("Not evaluated")[0].split("evrow")[-1] and "20%</b>" not in ev_none,
          [ev_mix.count("(75%)"), "Not evaluated" in ev_none])
    # THE EVALUATE CARD LISTS EVERY BODY OF WORK THAT HAS A STANDARD TEST, asked in the last run or not, with what each model was
    # asked by; a task that was not asked says why, with no bar
    ev_proof = dict(ev_mine, proof=True, limit=0, harness="lm-evaluation-harness 0.4.13 and bfcl-eval 2026.3.23", results=ev_mine["results"] + [
        {"item": "tools", "task": "bfcl_simple_python", "name": "BFCL one function", "metric": "accuracy", "filter": "none", "compare": "verdict", "harness": "bfcl",
         "target": {"value": 0.7, "n": 100}, "swarm": {"value": 0.65, "n": 100}, "agree": {"of": 100, "same": 80, "bothRight": 55, "bothWrong": 25, "differ": 20, "onlyTarget": 12, "onlySwarm": 8, "examples": []}},
        {"item": "search", "task": "bfcl_web_search_base", "name": "BFCL web search", "metric": "accuracy", "filter": "none", "compare": "verdict", "harness": "bfcl",
         "failed": "not asked: it searches the web through a service that needs a key (SERPAPI_API_KEY), which a person supplies"}])
    (root / ".work" / "eval" / "results.json").write_text(json.dumps(ev_proof))
    ev_pr = get(base + "/fragment/eval")[1]
    check("the Evaluate card lists every body of work that has a standard test, whichever the last run asked, and none is said to be chosen or not chosen for training; after a proof run it names the tool tests; a task that was not asked says why and draws no bar; one the run did not reach says it is not evaluated yet; and the size offered again is a proof run",
          'data-evt="bfcl_simple_python"' in ev_pr and "chosen for training" not in ev_pr and "Nothing is chosen" not in ev_pr and "Berkeley Function-Calling Leaderboard (bfcl-eval 2026.3.23)" in ev_pr
          and "80 of 100 the same" in ev_pr and "Scored by the test&#x27;s own checker" in ev_pr and "not asked: it searches the web through a service that needs a key" in ev_pr
          and '<span class="muted small">not asked</span>' in ev_pr and '<option value="-1" selected>' in ev_pr and "a proof run: its own number of questions a task" in ev_pr
          and 'data-evt="gsm8k"' in ev_pr and "not evaluated yet" in ev_pr.split('data-evt="gsm8k"')[1].split('data-evt="')[0]
          # (each body of work folds under its heading and says in a line what it holds: every one folded to begin with)
          and '<details class="psec evitem" data-keep="eval-instructions">' in ev_pr and '<details class="psec evitem" data-keep="eval-tools">' in ev_pr and 'class="psec evitem" data-keep="eval-crew"' not in ev_pr
          and '<span class="pmeta" data-evm="tools">5 tasks · the same on 80 of 100 questions · 4 not evaluated</span>' in ev_pr
          # (and the whole breakdown is one section that folds, folded to begin with, with a line for all of it)
          and '<details class="psec evall" data-keep="eval-all"><summary><h4>Every task, by body of work <span class="muted small">7 bodies of work · 23 tasks</span></h4>' in ev_pr
          and '<span class="pmeta" data-evm="*">23 tasks · the same on 95 of 120 questions · 21 not evaluated</span>' in ev_pr
          and '<span class="pmeta" data-evm="search">not asked: it searches the web through a service that needs a key' in ev_pr
          and ev_pr.count('<details class="psec evitem"') == 7 and ev_pr.count("</div></details>") == 8 and "<section" not in ev_pr, ev_pr[:300])
    # (and while a run is under way, or stopped: a task that was not asked says so once, with no bar and no "failed")
    (root / ".work" / "eval" / "live.json").write_text(json.dumps({"phase": "stopped", "step": "Stopped from the page", "runId": "r", "proof": True, "tasks": [
        {"item": "crew", "task": "ifeval", "name": "IFEval", "target": {"state": "done", "done": 20, "of": 20}, "swarm": {"state": "stopped", "done": 3, "of": 20}},
        {"item": "search", "task": "bfcl_web_search_base", "name": "BFCL web search",
         "target": {"state": "failed", "why": "not asked: it searches the web through a service that needs a key (SERPAPI_API_KEY), which a person supplies"},
         "swarm": {"state": "failed", "why": "not asked: it searches the web through a service that needs a key (SERPAPI_API_KEY), which a person supplies"}}]}))
    ev_live = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "live.json").unlink()
    row_ws = ev_live.split('data-evt="bfcl_web_search_base"')[1].split("</div></div>")[0] if 'data-evt="bfcl_web_search_base"' in ev_live else ""
    check("a task that is not asked says so once while the run is shown, with no bar and not as a failure, and why beside it",
          '<span class="muted small">not asked</span>' in row_ws and "failed: not asked" not in ev_live and 'class="evbar"' not in row_ws and "not asked: it searches the web through a service that needs a key" in ev_live
          and "stopped at 3" in ev_live, row_ws[:300])
    (root / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now", "limit": -1, "proof": True}))
    (root / ".work" / "eval" / "live.json").write_text(json.dumps({"phase": "asking", "step": "Asking", "runId": "r2", "proof": True, "target": "Big One", "tasks": [
        {"item": "crew", "task": "ifeval", "name": "IFEval", "target": {"state": "done", "done": 541, "of": 541}, "swarm": {"state": "waiting", "done": 0}},
        {"item": "tools", "task": "bfcl_simple_python", "name": "BFCL one function", "target": {"state": "kept", "done": 100, "of": 100}, "swarm": {"state": "waiting", "done": 0}},
        {"item": "tools", "task": "bfcl_multiple", "name": "BFCL one of several functions", "target": {"state": "asking", "done": 11, "of": 100}, "swarm": {"state": "waiting", "done": 0}}]}))
    ev_run = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "live.json").unlink()
    (root / ".work" / "eval" / "ui-run.json").unlink()
    tn_ = swarm_ui.e(data.load(root)["target"]["name"])
    check("while an evaluation runs its breakdown folds: all of it as one section, folded to begin with, and inside it body by body, the one being asked open and the others folded, each saying in a line how many of its tasks each model has been asked and the task in hand; the page's script keeps those lines current and opens the body the run moves on to, unless a person chose otherwise",
          '<details class="psec evitem" data-keep="eval-tools" open>' in ev_run and '<details class="psec evitem" data-keep="eval-instructions">' in ev_run
          and ('<span class="pmeta" data-evm="tools">%s: 1 of 2 tasks asked, asking BFCL one of several functions 12 of 100 · the swarm: 0 of 2 tasks asked</span>' % tn_) in ev_run
          and ('<span class="pmeta" data-evm="instructions">%s: 1 of 1 task asked · the swarm: 0 of 1 task asked</span>' % tn_) in ev_run
          and "const evMeta=(all,tn)=>" in swarm_ui.JS and "box.querySelectorAll('[data-evm]')" in swarm_ui.JS and "localStorage.getItem('swarm.open.eval-'+at.item)" in swarm_ui.JS
          # (the whole breakdown folded to begin with, its line counting every task; a folded body inside an open breakdown keeps its own line)
          and '<details class="psec evall" data-keep="eval-all"><summary>' in ev_run and ('<span class="pmeta" data-evm="*">%s: 2 of 3 tasks asked, asking BFCL one of several functions 12 of 100 · the swarm: 0 of 3 tasks asked</span>' % tn_) in ev_run
          and "m.dataset.evm==='*'||t.item===m.dataset.evm" in swarm_ui.JS
          and ".evalp details.psec[open]>summary>.pmeta{display:none}" in swarm_ui.CSS and ".evalp details.psec[open] .pmeta" not in swarm_ui.CSS, ev_run[ev_run.find("data-evm"):][:400])
    (root / ".work" / "eval" / "results.json").write_text(json.dumps(ev_mine))
    ev1 = get(base + "/fragment/eval")[1]
    a_on = send("/config", {"adapters": True})[0]
    a_cfg = json.loads((root / "src" / "config.json").read_text())
    a_bad = send("/config", {"adapters": "yes"})[0]
    a_off = send("/config", {"adapters": False})[0]
    a_cfg2 = json.loads((root / "src" / "config.json").read_text())
    # while an evaluation runs (this process stands in for it), training and pretraining wait, and each says why
    (root / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now", "limit": 100, "items": ["instructions", "code"]}))
    # (the page starts no pretraining: there is no such card, and the routes it had are gone)
    gone_pre = [send("/pretrain/start", {})[0], get(base + "/fragment/pretrain")[0], get(base + "/fragment/adapt")[0], get(base + "/api/pretrain")[0]]
    a_member = d["members"]["a"]
    held_by = swarm_ui.busy_with()
    held_ev = get(base + "/fragment/eval")[1]
    (root / ".work" / "eval" / "ui-run.json").unlink()
    # (the run ends without finishing: no result was written, and the last one that finished is shown again, as it was)
    ev_after = get(base + "/fragment/eval")[1]
    ev_table = get(base + "/fragment/evtable")[1]
    ev_table_b = get(base + "/fragment/evtable?h=bfcl")[1]
    ev_table_x = get(base + "/fragment/evtable?h=nothing")[1]
    ev_table_l = get(base + "/fragment/evtable?h=lm")[1]
    (root / ".work" / "eval" / "results.json").unlink()
    check("Memory saved first, its share at the top left as the cards after it have theirs; then, above Train, Evaluate the swarm and Pretrain: Evaluate says what it does (standard benchmarks of lm-evaluation-harness, asked of the larger model and the swarm, kept apart from training), has a box for each harness beside the boxes for the bodies of work (a task is asked where both are ticked; a harness the page has no name for has its box all the same) and the same boxes over its table of scores, which is summed again over the harnesses ticked, has a size to choose (a proof run among them) and a button, names each harness a body of work is measured by, has a row for every task of every body of work that has a standard test, and a box for each of those bodies, ticked to begin with, that says which of them this run asks (kept on the device and sent with the press: a choice for one run, never of what the swarm is trained on); an unknown size, no body of work, one that is not listed, or a request from elsewhere is refused; once evaluated its headline is one figure, benchmark against benchmark, the swarm's score as a share of the larger model's on the same questions with the two scores under it, and it is a button that opens a table of every body of work and task with the two scores side by side (the share that had the SAME answer, called equivalent, marked the swarm down for being right where the larger model was wrong), each task leads with the two scores, and how many had the same answer is said under them, split by whether both were right, with when; Pretrain lists each small model and, where MLX is not installed, says Pretrain installs it and can be pressed on Apple silicon, or that it is not available on any other machine; the adapters switch is written beside the models and refuses anything but on or off; and while an evaluation runs, its headline shows moving bars where the share and the count will be and the questions chosen, the last result returning as it was when the run ends unfinished (Pretrain the same, the adapter that stood still standing beside an attempt that was not kept), it can be stopped from its section, and training and pretraining wait for it and say so",
          html.index('<h2>Memory saved</h2>') < html.index('<h2>Evaluate the swarm</h2>') < html.index('<h2 id="arrangement">Train</h2>') and '<h2>Pretrain</h2>' not in html
          and '<div id="memwrap"><h2>Memory saved</h2><div class="panel memcard" id="memcard"><div class="proghead"><span class="memnum"><b class="pct">' in html and 'class="memh"' not in html.split('<h2>Memory saved</h2>')[1].split('<h2>')[0]
          and "lm-evaluation-harness 0.4.13" in ev0 and 'id="ev-go"' in ev0 and ev0.count("<option") == 4 and "a proof run" in ev0 and "Function-Calling" in ev0 and 'data-evt="ifeval"' in ev0 and 'data-evt="gsm8k"' in ev0 and ev0.count('data-evt="') == 23 and "not evaluated yet" in ev0 and api0.get("running") is False
          and 'class="evask"' in ev0 and ev0.count('data-ev-item="') == 7 and ev0.count('" checked>') == 9 and bad_harness == [400, 400, 400, 400]
          and '<span class="cfgl">With</span>' in ev0 and 'data-ev-harness="lm" checked>lm-evaluation-harness<small>' in ev0 and 'data-ev-harness="bfcl" checked>BFCL (function calling)<small>7 tasks</small>' in ev0
          and 'data-ev-item="math" data-h="lm"' in ev0 and 'data-ev-item="search" data-h="bfcl"' in ev0
          and 'data-evd-harness="lm" checked>' in ev_table and 'data-evd-harness="bfcl" checked>' in ev_table
          and 'data-evd-harness="lm">' in ev_table_b and 'data-evd-harness="bfcl" checked>' in ev_table_b and "GSM8K" not in ev_table_b and "Nothing of BFCL (function calling) has been evaluated yet" in ev_table_b
          and ev_table_l.count('<tr class="evt-task') == 16 and "Every question of lm-evaluation-harness</th>" in ev_table_l and "BFCL web search" not in ev_table_l.split("</thead>")[1] and 'data-evd-harness="bfcl">' in ev_table_l and ev_table_x.count('<tr class="evt-task') == ev_table.count('<tr class="evt-task')
          and "evLeft" in swarm_ui.JS and "swarm.eval.hoff" in swarm_ui.JS
          # (a row with no bars says so, and the script draws the card again when the run names that row's task; a row of a
          # running evaluation's own tasks has bars from the first draw that knows them)
          and 'data-none>not evaluated yet</span>' in ev0 and "row.querySelector('[data-none]')" in swarm_ui.JS and "data-none" not in ev_run.split('data-evt="bfcl_multiple"')[1].split("</div></div>")[0] and "+'&h='+encodeURIComponent(on.join(','))" in swarm_ui.JS
          # (the table's columns are of set widths, so its header breaks its lines alike whichever harnesses are shown)
          and "table.spec.evt{table-layout:fixed}" in swarm_ui.CSS and '<th class="num evtg">' in ev_table and '<th class="num evtg">' in ev_table_l and '<th class="num">Swarm → target</th>' in ev_table and ">Share<" not in ev_table
          # (a swarm training has kept nothing for is recommended to be trained before its evaluation is relied on, and the Evaluate
          # card says so by its button; where its last evaluation marked tasks unread on its side, that is what is said, by name)
          and "or swarm_unread({\"results\": mine_})" in open(swarm_ui.__file__).read() and "or no answer was found in many of its replies" in open(swarm_ui.__file__).read()
          and swarm_ui.untrained({"learned": {"ledger": [], "passes": []}}) and not swarm_ui.untrained({"learned": {"ledger": [{"n": 1}]}})
          and swarm_ui.swarm_unread({"results": [{"name": "A", "agree": {"of": 20}, "unread": {"swarm": 5, "target": 0}}, {"name": "B", "agree": {"of": 20}, "unread": {"swarm": 4, "target": 19}}, {"name": "C"}]}) == [("A", 5, 20)]
          and "has not been trained" in swarm_ui.evaluation_caution({"learned": {}}, {}) and swarm_ui.evaluation_caution({"learned": {"ledger": [{"n": 1}]}}, {}) == ""
          and "On 1 task of the last evaluation" in swarm_ui.evaluation_caution({"learned": {"ledger": [{"n": 1}]}}, {"results": [{"name": "A", "agree": {"of": 20}, "unread": {"swarm": 5}}]})
          and ("Before you read an evaluation" in get(base + "/fragment/recs")[1]) == any(r.get("next") for r in swarm_ui.recommendations(data.load(root)))
          and ('id="ev-caution"' in get(base + "/fragment/eval")[1]) == bool(swarm_ui.evaluation_caution(data.load(root)))
          # (on the card it is a button that opens the recommendations, not a paragraph; and the recommendation presses the page's own Train)
          and "closest('#rec-open,[data-rec-open]')" in swarm_ui.JS and "closest('[data-rec-train]')" in swarm_ui.JS and "$('#run-go')" in swarm_ui.JS
          and all(r.get("train") for r in swarm_ui.evaluation_recommendations(dict(data.load(root), learned={})))
          and ("data-rec-train" in get(base + "/fragment/recs")[1]) == any(r.get("train") for r in swarm_ui.recommendations(data.load(root)))
          and '<small class="evwhy" id="ev-caution">' not in get(base + "/fragment/eval")[1]
          and '<span class="evpair">%s<button type="button" class="btn top rec" id="ev-caution"' in open(swarm_ui.__file__).read() and ".evpair{display:flex" in swarm_ui.CSS and ".evpair .btn{flex:1 1 auto;white-space:nowrap" in swarm_ui.CSS
          and "<i></i>Recommendation</button>" in open(swarm_ui.__file__).read() and "Recommendation: train" not in open(swarm_ui.__file__).read()
          and [r["id"] for r in swarm_ui.evaluation_recommendations(dict(data.load(root), learned={}))][:1] in (["untrained"], [x["id"] for x in swarm_ui.evaluation_recommendations(data.load(root)) if x["id"].startswith("unread:")][:1])
          # (the Train card opens the questions training asks, to read and audit: each as it is put, narrowed by split, class, kind
          # and words; and above them whether any is a benchmark's, from the benchmark questions kept on this machine)
          and 'id="tq-open"' in swarm_ui.TQ_BUTTON and "ev.target.id==='tq-open'" in swarm_ui.JS and "'/fragment/trainq?split='" in swarm_ui.JS and '<dialog id="tqd">' in html
          and get(base + "/fragment/trainq")[0] == 200 and 'id="tq-close"' in get(base + "/fragment/trainq")[1]
          and __import__("questions").audit(str(root), [])["same"] == [] and __import__("questions")._runs("a b c d e f") == {"a b c d e", "b c d e f"}
          # (the Train card has a box for each class of input, every one ticked; a press of Train sends the ticked ones, and
          # fewer than all are said to the session, none or all are not)
          and swarm_ui.classes_asked(["words", "code", "x"]) == ["code", "words"] and swarm_ui.classes_asked([]) == [] and swarm_ui.classes_asked(list(swarm_ui.TRAIN_CLASSES)) == [] and swarm_ui.classes_asked(None) == []
          and "data-train-class" in swarm_ui.JS and "swarm.train.off" in swarm_ui.JS and "JSON.stringify({classes:" in swarm_ui.JS
          and 'env["TRAIN_CLASSES"] = ",".join(only)' in open(swarm_ui.__file__).read()
          # (the results open three ways from buttons under the headline: each task, a paper's table, and score against memory)
          and "closest('[data-evd-view]')" in swarm_ui.JS and "'/fragment/evtable?view='+" in swarm_ui.JS and "evd-copy" in swarm_ui.JS
          and [round(x, 2) for x in swarm_ui._ev_figure({"value": 0.9, "stderr": 0.0688}, {"of": 20}, 18)] == [90.0, 6.88, 20] and [round(x, 2) for x in swarm_ui._ev_figure({"value": None}, {"of": 20}, 10)] == [50.0, 11.18, 20]
          and get(base + "/fragment/evtable?view=paper")[0] == 200 and get(base + "/fragment/evtable?view=chart")[0] == 200 and 'id="evd-close"' in get(base + "/fragment/evtable?view=paper")[1] and 'id="evd-close"' in get(base + "/fragment/evtable?view=chart")[1]
          # (a run that stopped on an error says the error, not the name of the program that ran it)
          and swarm_ui._why_ended(["15:06:17 Comparing the answers", "node:fs:438", "TypeError [ERR_INVALID_ARG_TYPE]: The \"path\" argument must be of type string", "    at scoreOf (file:///x.mjs:370:27)", "}", "Node.js v22.23.3"]).startswith("TypeError [ERR_INVALID_ARG_TYPE]")
          and swarm_ui._why_ended(["one", "the last line"]) == "the last line"
          # (a folded section of a run shows one bar of how far the run is through its tasks, in questions; none where no run is shown)
          and 'data-evp="*"' in ev_run and 'data-evp="tools"' in ev_run and "data-evp" not in ev0 and "'[data-evp]'" in swarm_ui.JS and "evShare" in swarm_ui.JS
          and swarm_ui._ev_through([{"target": {"state": "kept", "done": 20, "of": 20}, "swarm": {"state": "asking", "done": 5, "of": 20}}, {"target": {"state": "kept", "done": 20, "of": 20}, "swarm": {"state": "waiting", "done": 0}}]) == (12.5, True)
          and swarm_ui._ev_through([{"target": {"state": "done", "done": 4}, "swarm": {"state": "done", "done": 4}}, {"target": {"state": "waiting"}, "swarm": {"state": "waiting"}}]) == (50.0, False)
          and swarm_ui._ev_through([{"target": {"why": "not asked: x"}, "swarm": {"why": "not asked: x"}}]) is None
          and swarm_ui.harnesses_of([{"benchmarks": [{"task": "a"}, {"task": "b", "harness": "new-one"}]}]) == ["lm", "new-one"] and swarm_ui.harness_name("new-one") == "new-one" and 'data-ev-item="crew"' not in ev0 and 'data-ev-item="instructions" data-h="lm"' in ev0 and '<span class="cfgl">Asks</span>' in ev0
          and "items:its.filter(x=>x.checked&&" in swarm_ui.JS and "harnesses:hs.filter(x=>x.checked)" in swarm_ui.JS and "localStorage.setItem('swarm.eval.off'" in swarm_ui.JS and "function evAsk()" in swarm_ui.JS
          and bad_size == 400 and foreign == 403 and bad_items == [400, 400, 400, 400]
          and gone_pre[0] in (403, 404) and gone_pre[1:] == [404, 404, 404] and not hasattr(swarm_ui, "pretrain_block") and not hasattr(swarm_ui, "adapters_toggle") and "preTick" not in swarm_ui.JS
          and "15 of 20 the same (75%)" in ev1 and '<b class="evpct">45%</b> <span>the swarm · ' in ev1 and "9 both right · 6 both wrong · 5 differ" in ev1 and "Last evaluated 2026-11-17 12:00 UTC" in ev1 and "without adapters" in ev1
          and a_on == 200 and a_cfg.get("adapters") is True and a_bad == 400 and a_off == 200 and "adapters" not in a_cfg2
          and held_by == "an evaluation" and 'id="ev-stop"' in held_ev and 'id="ev-go"' not in held_ev
          and 'class="pct busy"' in held_ev and 'class="busyn"' in held_ev
          and "of 300 questions" in held_ev and 'class="evask"' not in held_ev and 'id="ev-open"' not in held_ev and "&#39;s score<small><i class=\"busyn\"" in held_ev
          and 'id="ev-open" data-evd-view="table"' in ev_after and 'data-evd-view="paper"' in ev_after and 'data-evd-view="chart"' in ev_after and '<button type="button" class="evopen"' not in ev_after and '<b class="pct">75%</b><span>of the larger model&#39;s score<small>45% against 60% · 20 questions' in ev_after and "equivalent<" not in ev_after
          and '<tr class="evt-item"><th scope="row">' in ev_table and '<td class="num">45%</td><td class="num">60%</td><td class="num"><b class="down">75%</b></td><td class="num evn">20</td>' in ev_table
          and ev_table.count('<tr class="evt-task">') == 23 and "not evaluated" in ev_table and '<tr class="evt-all"><th scope="row">Every question</th><td class="num">45%</td>' in ev_table
          and swarm_ui._ev_share(5, 0) == "–" and "$('#evd').showModal()" in swarm_ui.JS and '<dialog id="evd">' in html and "pct busy" not in ev_after,
          {"order": html.index('<h2>Evaluate the swarm</h2>') < html.index('<h2 id="arrangement">Train</h2>'),
           "ev0": ["lm-evaluation-harness 0.4.13" in ev0, 'id="ev-go"' in ev0, ev0.count("<option"), 'data-evt="ifeval"' in ev0, "not evaluated yet" in ev0, api0.get("running")],
           "codes": [bad_size, foreign, a_on, a_bad, a_off], "gone": gone_pre,
           "ev1": ["15 of 20 the same (75%)" in ev1 and '<b class="evpct">45%</b> <span>the swarm · ' in ev1, "9 both right · 6 both wrong · 5 differ" in ev1, "Last evaluated 2026-11-17 12:00 UTC" in ev1, "without adapters" in ev1],
           "cfg": [a_cfg.get("adapters"), "adapters" in a_cfg2], "held": [held_by, 'id="ev-stop"' in held_ev]})
    swarm_ui.needs_eval = _ne
    # THE UNINSTALL HELPER LISTS WHAT EVALUATING AND PRETRAINING FETCH: the harness, MLX, each model's original weights (the ones the
    # swarm is made of marked in use), the adapters, and every answer an evaluation kept; and removes nothing while either runs
    a_file = d["members"]["a"]["file"]
    origs = json.loads((REPO / "training" / "originals.json").read_text())["models"]
    a_dir = (origs.get(a_file) or {}).get("dir") or "LFM2.5-1.2B-Instruct"
    for pth in (root / ".work" / "lmeval" / "venv", root / ".work" / "mlx" / "venv", root / ".work" / "mlx" / "python", root / ".work" / "mlx" / "hf" / a_dir, root / ".work" / "mlx" / "hf" / "Old-Model",
                root / ".work" / "library" / "adapters" / d["target"]["id"] / a_dir, root / ".work" / "eval" / "target", root / ".work" / "eval" / "swarm",
                root / ".work" / "bfcl" / "venv", root / ".work" / "bfcl" / "python", root / ".work" / "bfcl" / "uv-cache",
                root / ".work" / "searxng" / "venv", root / ".work" / "searxng" / "src", root / ".work" / "eval" / "search" / "2026-11-18" / "queries",
                root / ".work" / "archive" / "clear-20261116-200115", root / ".work" / "added-later" / "venv"):
        pth.mkdir(parents=True, exist_ok=True)
        (pth / "x.bin").write_bytes(b"x" * 2048)
    (root / ".work" / "train").mkdir(parents=True, exist_ok=True)
    (root / ".work" / "train" / "judge.log").write_text("x" * 4096)
    inv = {x["id"]: x for x in cleanup.inventory(root, data.load(root))}
    # EVERYTHING INSTALLED IS LISTED, AND CAN BE TAKEN OUT: the search behind the web search test; a program this list does not
    # know by name (a folder of .work with a Python of its own); what Clear training state set aside; the logs
    listed_paths = {os.path.realpath(q) for x in inv.values() for q in x["paths"]}
    unlisted = [d.name for d in (root / ".work").iterdir() if d.is_dir() and any((d / v).is_dir() for v in ("venv", "uvenv", ".venv"))
                and not any(k == os.path.realpath(d) or k.startswith(os.path.realpath(d) + os.sep) for k in listed_paths)]
    check("everything installed here is listed by the Uninstall Helper and can be taken out: the search behind the web search test, with what each search returned among the evaluations' answers; a program it does not know by name, since any folder of .work with a Python of its own is listed; what Clear training state set aside; and the logs",
          "searxng:program" in inv and inv["searxng:program"]["removable"] and inv["searxng:program"]["paths"] == [str(root / ".work" / "searxng")] and "web search test" in inv["searxng:program"]["what"]
          and str(root / ".work" / "eval" / "search") in inv["eval:answers"]["paths"]
          and "other:added-later" in inv and inv["other:added-later"]["removable"] and inv["other:added-later"]["group"] == "Programs"
          and "old:cleared" in inv and inv["old:cleared"]["paths"] == [str(root / ".work" / "archive")]
          and "logs" in inv and str(root / ".work" / "train" / "judge.log") in inv["logs"]["paths"]
          and unlisted == [] and not [k for k in inv if k.startswith("other:") and k != "other:added-later"], [sorted(inv), unlisted])
    (root / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "now"}))
    held_rm = send("/uninstall", {"id": "lmeval:program"})
    (root / ".work" / "eval" / "ui-run.json").unlink()
    rm_ok = send("/uninstall", {"id": "mlx:weights:" + a_dir})[0]
    rm_bfcl = send("/uninstall", {"id": "bfcl:program"})
    rm_searx = send("/uninstall", {"id": "searxng:program"})
    rm_other = send("/uninstall", {"id": "other:added-later"})
    rm_cleared = send("/uninstall", {"id": "old:cleared"})
    check("the Uninstall Helper lists what evaluating and pretraining fetch, each to be taken out on its own: lm-evaluation-harness, the tool tests with the Python fetched for them (taken out whole, the folder gone), MLX and its Python, each small model's original weights (the ones the swarm is made of marked in use, and any no longer listed), the adapters, and the answers evaluations kept, the swarm's among them; and while an evaluation runs it removes nothing, and says why",
          "bfcl:program" in inv and inv["bfcl:program"]["group"] == "Programs" and inv["bfcl:program"]["paths"] == [str(root / ".work" / "bfcl")] and inv["bfcl:program"]["bytes"] >= 3 * 2048
          and rm_bfcl[0] == 200 and not (root / ".work" / "bfcl").exists() and "bfcl:program" not in {x["id"] for x in cleanup.inventory(root, data.load(root))}
          and rm_searx[0] == 200 and not (root / ".work" / "searxng").exists() and rm_other[0] == 200 and not (root / ".work" / "added-later").exists()
          and rm_cleared[0] == 200 and not (root / ".work" / "archive").exists()
          and str(root / ".work" / "mlx" / "python") in inv["mlx:program"]["paths"] and str(root / ".work" / "eval" / "swarm") in inv["eval:answers"]["paths"]
          and "lmeval:program" in inv and "mlx:program" in inv and ("mlx:weights:" + a_dir) in inv and inv["mlx:weights:" + a_dir]["used"] == (a_file in origs) and "mlx:weights:other" in inv
          and ("adapters:" + d["target"]["id"]) in inv and "eval:answers" in inv and inv["mlx:weights:" + a_dir]["group"] == "Pretrain"
          and held_rm[0] == 409 and "An evaluation is running" in held_rm[1] and rm_ok == 200 and not (root / ".work" / "mlx" / "hf" / a_dir).exists(),
          [sorted(k for k in inv if ":" in k), held_rm, rm_ok])
    dm = dict(d, machine=["mac"])
    sel = re.search(r'<select data-pick="decider".*?</select>', swarm_ui.pills(dm), re.S).group(0)
    names = re.findall(r'<option value="([^"]+)"', sel)
    check("the Decides pill lists every decider best first by its Decision Index score, says the score beside each, and on a machine that cannot run one lists it greyed out with what it needs; the one chosen is shown by its name alone; last in the list is a swarm with no decision model, which is never offered as the judge",
          names[0] == "karpo-31b" and 'value="karpo-31b" disabled' in sel and "needs an NVIDIA GPU with 80 GB" in sel and "StartLux Decision 4B · index 54.8 · about 5.5 GB<" in sel
          and 'value="startlux-4b" disabled' not in sel and "(an older checkpoint)" in sel and ('value="%s" selected>%s<' % (d["decider"]["id"], d["decider"]["name"])) in sel and len(names) == len(d["registry"]["deciders"]) == 24 and names[-1] == "none" and "A small model of the swarm" in sel
          and 'value="none"' not in re.search(r'<select data-pick="judge".*?</select>', swarm_ui.pills(dm), re.S).group(0)
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
          and " open>" not in after_u.split('class="psec"')[1][:80] and after_u.count('class="pmeta"') >= 3 and "until its answer is good, best first, building on the 3 closest" in after_u and "Decider loops only · 1 skipped · nothing queued" in after_u and "2 moves · 0 tried by the loop · 0 kept" in after_u
          and after_u.rstrip().endswith("</details>") and swarm_ui.fold_sections('<div class="panel"><p>x</p></div>', "p") == '<div class="panel"><p>x</p></div>', after_u.count("<h4>"))
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
          ('id="rec-open"' not in none_yet or "1 recommendation<" in none_yet) and [r["id"] for r in rs if not r["id"].startswith("judge:") and not r.get("next")] == ["decider:startlux-4b", "member:qwen35-2b"] and [r["strength"] for r in rs if not r["id"].startswith("judge:") and not r.get("next")] == ["measured", "untested"]
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
          [r["id"] for r in rs2 if not r["id"].startswith("judge:") and not r.get("next")] == ["member:qwen35-2b"] and ("decided by %s" % d["decider"]["name"].split(" ")[0]) in pop2 and ap2 == 200
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
    check("the SwOA spec says what the swarm as it stands is: what goes in and comes out, each model with its pinned file and SHA-256, the decider, every slot and what it is for, and where it stands against the larger model, to read and to copy as JSON",
          code_s == 200 and "SwOA spec" in sp and "<h4>Proof</h4>" in sp and 'id="spec-json" data-name="' in sp and "&quot;start&quot;" not in sp and "run the shared arrangement above" in sp and "<th>Runtime</th>" in sp and "<span class='muted'>kind</span>" in sp and d["members"]["a"]["sha256"] in sp and d["members"]["b"]["file"] in sp and "<code>decide</code>" in sp and ("% of the way to parity against" in sp or "At parity against" in sp) and spec["trainedAgainst"]["progressPercent"] == p["percent"] and 'id="spec-json"' in sp
          and "As a model chooser lists it" in sp and "What it is told" in sp and 'id="spec-save"' in sp and "Commercial use" in sp and "+'.swoa.json'" in html
          and spec["trainedAgainst"]["state"] in ("at parity", "not at parity") and spec["trainedAgainst"]["equivalent"] == p["equivalent"] and len(spec["arrangement"]["slots"]) == len(d["briefs"]["slots"])
          and spec["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and spec["interface"]["out"] == "one reply" and "training's measure and not the proof" in spec["trainedAgainst"]["parityMeans"] and "fundamentally equivalent" not in json.dumps(spec), sp[:200])
    # TURNS WITH TOOLS: who takes an agent's turn is a toggle in Configuration, saved beside the models, said in the folded line, and
    # part of the spec's recipe and of what it says it can do
    tg0 = get(base + "/page")[1]
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
          and b_ok == 200 and b_cfg.get("tools") == idb and ('class="seg on" data-tools="%s"' % idb) in b_row and ("%s alone" % nb) in b_meta and not b_row.startswith("<div class=\"tools\"")
          and b_spec["recipe"]["serving"]["tools"] == idb and nb in b_spec["interface"]["capabilities"]["tools"] and lead_spec["recipe"]["serving"]["tools"] == ida
          and t_ok == 200 and t_bad == 400 and t_out == 400 and t_cfg.get("tools") == "swarm" and 'class="seg on" data-tools="swarm"' in t_row and "tools: the swarm" in t_meta
          and sw_spec["recipe"]["serving"]["tools"] == "swarm" and sw_spec["swoa"]["recipeSha256"] != lead_spec["swoa"]["recipeSha256"]
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
    check("the spec holds everything needed to make the swarm again and offer it: every slot with what it is told, the decider's serving recipe, the engine's pinned builds, a card a model chooser can list (engine swarm, memory, the bodies of work its training asked, read from its passes and never from a setting, and where it stands), what it needs of a machine (platforms, memory, disk, licences, whether it may be used commercially), what it can and cannot do (tools go to one model alone), how to start it, and a format, version and hash",
          spec["swoa"]["format"] == "swoa" and spec["swoa"]["version"] == 1 and len(spec["swoa"]["recipeSha256"]) == 64 and spec["swoa"]["recipeSha256"] == data.recipe_sha256(rc)
          and spec["swoa"]["baseModuleSha256"] == data.recipe_sha256({k: rc[k] for k in ("members", "decider", "engine")}) and spec["swoa"]["arrangementSha256"] == data.recipe_sha256(rc["briefs"])
          and spec["baseModule"]["members"] == rc["members"] and isinstance(spec["proof"]["results"], list) and "goal" in spec["proof"]
          and all(s_.get("brief") for s_ in rc["briefs"]["slots"]) and all(s_.get("brief") for s_ in spec["arrangement"]["slots"]) and rc["briefs"]["slots"] == d["briefs"]["slots"]
          and rc["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and rc["decider"].get("serve") and rc["engine"].get("builds") and rc["serving"]["slots"] == data.SERVING["slots"]
          and spec["card"]["engine"] == "swarm" and spec["card"]["memGb"] > 0 and "Programming and its conversation" in spec["card"]["trainedOn"] and "equivalentOn" not in json.dumps(spec) and spec["trainedAgainst"]["trainedOn"][0]["kinds"] and "Crew" not in json.dumps(spec) and spec["card"]["badge"] and spec["card"]["plain"].startswith("Two small models")
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
        rd = __import__("subprocess").run([node_, "-e", "import(process.argv[1]).then(m=>{const s=m.readSpec(process.argv[2]);console.log(s.swoa.recipeSha256===m.recipeSha256(s.recipe)&&s.swoa.baseModuleSha256===m.recipeSha256(m.baseModuleOf(s.recipe))?'same':'differs')}).catch(e=>console.log('refused: '+e.message))",
                                            (Path(swarm_ui.__file__).resolve().parent.parent / "src" / "spec.mjs").as_uri(), str(sp_file)], capture_output=True, text=True)
        check("the module reads the SwOA spec the page writes, and computes its recipe and base module hashes the same way", rd.stdout.strip() == "same", rd.stdout + rd.stderr[:300])
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
    code, html = get(base + "/page")
    check("with nothing measured and nothing configured the page still opens, and says nothing of a pass that has not begun", code == 200 and "Training starts at question 1" not in html and "No larger model is named" in html)
    srv.shutdown()
    # ---- the Train button, with a stand-in for the session (it writes its steps and waits): no model is started
    srv, base = serve(empty)
    check("on a folder with no trainers the button is there but cannot be pressed, and says why", 'id="run-go" type="button" disabled' in get(base + "/page")[1] and "no trainers" in get(base + "/page")[1])
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
    # ONLY A SwOA WITH PROOF IS PUBLISHED (specs/<name>.swoa.json and its card): refused without proof, written whole with it, without the pass in hand
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
    cf = data.card_file(root, spec)
    card = cf.read_text() if cf.exists() else ""
    check("only a SwOA with proof is published to specs/: without proof the button is greyed out saying why and a request is refused, writing nothing; with it it writes specs/<name>.swoa.json whole, without the pass in hand, and its SwOA card specs/<name>.swoa.md, and the dialog then says where it is; a request not from the page is refused",
          'id="spec-publish"' in sp and ("Only a SwOA with proof is published" in sp) == (not spec["proof"]["proven"])
          and short_code == 409 and "Only a SwOA with proof is published" in short_said and short_none and foreign_code == 403
          and ok_code == 200 and pf.name == d["key"] + ".swoa.json" and written.get("swoa", {}).get("recipeSha256") == spec["swoa"]["recipeSha256"] and "inProgress" not in written
          and cf.name == d["key"] + ".swoa.md" and card.startswith('---\nlibrary_name: "the-swarm"\n') and ("swoa_sha256: \"%s\"" % spec["swoa"]["recipeSha256"]) in card and "model-index:" in card
          and "Published as <code>specs/%s</code>" % pf.name in ok_html, [short_code, short_said[:80], foreign_code, ok_code])
    # A PUBLISHED SwOA REFERS TO NO IMPLEMENTATION (docs/swoa.md 3): its runtime named once, in `runtime`; how this runtime starts and is
    # called (interface.as, interface.start, requirements.node) shown on the page and left out of what is published; the card has no commands
    impl = re.compile(r"\b[\w./-]+\.(?:py|mjs|sh)\b|\b(?:training|src|bin|ui)/|createSwarm|serveSwarm|readSpec|fromSpec|SWARM_[A-Z_]+|\bnode bin\b|\bbash\b")
    pub = data.published(spec)
    def leaks(x, at=""):
        if isinstance(x, dict):
            return [l for k, v in x.items() if k != "examples" for l in leaks(v, at + "." + k)]  # (examples are training content, not references)
        if isinstance(x, list):
            return [l for i, v in enumerate(x) for l in leaks(v, "%s[%d]" % (at, i))]
        return [at] if isinstance(x, str) and impl.search(x) else []
    card_now = data.swoa_card(spec)
    check("a published SwOA refers to no implementation: it names its runtime once (library and version), leaves out how this runtime is started and called (which the page still shows), and its card has no commands",
          leaks(pub) == [] and pub["runtime"]["library"] == "the-swarm" and pub["runtime"].get("version")
          and "start" not in pub["interface"] and "as" not in pub["interface"] and "node" not in pub["requirements"]
          and "start" in spec["interface"] and not impl.search(card_now.split("## Hashes")[0]) and "SwOA specification" in card_now,
          [leaks(pub), [m.group(0) for m in impl.finditer(card_now)]])
    # THE PROOF OF A SwOA (docs/swoa.md): only harness results measured on exactly this SwOA (configuration, arrangement, adapters);
    # per task the newest that counts as proof (100 questions at least), else the newest check; the gap is the module's score less the target's
    pr_root = Path(tmp) / "proof"
    (pr_root / ".work" / "eval").mkdir(parents=True)
    res = lambda task, n, sv, tv: {"item": "crew", "task": task, "name": task.upper(), "metric": "acc", "filter": "none",  # noqa: E731
                                   "swarm": {"value": sv, "stderr": 0.03, "n": n, "of": 541}, "target": {"value": tv, "stderr": 0.04, "n": n, "of": 541}}
    run = lambda at, arr, results, cfg="c--t", adapters=(): {"at": at, "runId": at, "configuration": cfg, "arrangementSha256": arr,  # noqa: E731
                                                              "harnessId": {"name": "lm-evaluation-harness", "version": "0.4.13"}, "adapters": list(adapters), "results": results}
    (pr_root / ".work" / "eval" / "history.jsonl").write_text("\n".join(json.dumps(x) for x in [
        run("2026-11-18T01", "A", [res("ifeval", 100, 0.66, 0.79)]),            # proof, older
        run("2026-11-18T02", "A", [res("ifeval", 20, 0.70, 0.75)]),             # a newer check: proof still outranks it
        run("2026-11-18T03", "OTHER", [res("ifeval", 200, 0.99, 0.79)]),        # another arrangement: not this SwOA's
        run("2026-11-18T04", "A", [res("humaneval", 300, 0.80, 0.80)], cfg="x--t"),  # another configuration
        run("2026-11-18T05", "A", [res("humaneval", 20, 0.50, 0.60)], adapters=["M"]),  # served with an adapter this SwOA does not pin
        run("2026-11-18T06", "A", [res("mbpp", 20, 0.40, 0.50)]),               # a check only
    ]) + "\n")
    pd = {"root": str(pr_root), "key": "c--t", "members": {"a": {"name": "M"}}}
    proof = data.swoa_proof(pd, "A", {})
    by = {x["task"]: x for x in proof["results"]}
    check("the proof of a SwOA lists only harness results measured on exactly it (its configuration, its arrangement, the adapters it pins), for each task the newest that is proof (100 questions or more) else the newest check, with the gap to the target and its error; it is publishable only with proof",
          sorted(by) == ["ifeval", "mbpp"] and by["ifeval"]["proof"] is True and by["ifeval"]["n"] == 100 and by["ifeval"]["gap"] == -0.13 and by["ifeval"]["gapStderr"] == 0.05
          and by["mbpp"]["proof"] is False and proof["proven"] == 1 and by["ifeval"]["harness"] == {"name": "lm-evaluation-harness", "version": "0.4.13"}
          and data.publishable({"proof": proof}) == "" and "Only a SwOA with proof is published" in data.publishable({"proof": {"results": [by["mbpp"]], "proven": 0}})
          and [x["task"] for x in data.swoa_proof(pd, "A", {"a": {"file": "x"}})["results"]] == ["humaneval"], proof)
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

    # (a configuration is evaluated before it is trained: this one has been, on every body of work that has a standard task)
    _fd = data.load(str(fake))
    first_said = swarm_ui.needs_eval(_fd)
    blocked_page = get(base + "/page")[1]
    post("/run/start")
    blocked_ran = (fake / ".work" / "train" / "ui-run.json").exists()
    (fake / ".work" / "eval").mkdir(parents=True, exist_ok=True)
    (fake / ".work" / "eval" / "history.jsonl").write_text(json.dumps({"at": "2026-11-18T00:00:00Z", "configuration": _fd["key"], "adapters": [], "results": [
        {"task": b["task"], "item": t["id"], "target": {"value": 1, "n": 1}, "swarm": {"value": 1, "n": 1}, "agree": {"of": 1, "same": 1, "bothRight": 1, "bothWrong": 0, "differ": 0, "onlyTarget": 0, "onlySwarm": 0, "examples": []}}
        for t in _fd["equivalence"]["targets"] for b in t.get("benchmarks") or []]}) + "\n")
    check("a configuration is evaluated before it is trained or pretrained: with no evaluation of it, Train is there but cannot be pressed and says why, a press sent all the same starts nothing, and it is free once every body of work that has a standard task has been evaluated",
          "Evaluate the swarm first: this configuration has not been evaluated." in first_said and 'id="run-go" type="button" disabled' in blocked_page and 'id="run-first"' in blocked_page
          and blocked_ran is False and swarm_ui.needs_eval(_fd) == "" and "needs_eval()" in open(swarm_ui.__file__).read().split("def start_run")[1].split("def ")[0], [first_said, blocked_ran])
    # (evaluated on some bodies of work and not on others: training does not wait; it says which have no figure from before, the
    # harness that measures them and where it is ticked)
    _hist = fake / ".work" / "eval" / "history.jsonl"
    _full_hist = _hist.read_text()
    _row = json.loads(_full_hist)
    _hist.write_text(json.dumps(dict(_row, results=[r for r in _row["results"] if not str(r["task"]).startswith("bfcl_")])) + "\n")
    _part_need, _part_gap, _part_ctl = swarm_ui.needs_eval(_fd), swarm_ui.eval_gaps(_fd), swarm_ui.run_controls()
    # ONE MODEL OR SEVERAL: one pill for the model in every role where both places hold the same model; a pill for each place,
    # marked experimental with what was measured, where they differ or Several models was chosen
    _rd = data.load(REPO)
    _sm = _rd["registry"]["small"]
    _same = swarm_ui.pills(dict(_rd, members={"a": _sm[0], "b": _sm[0]}, mix=False))
    _chosen = swarm_ui.pills(dict(_rd, members={"a": _sm[0], "b": _sm[0]}, mix=True))
    _diff = swarm_ui.pills(dict(_rd, members={"a": _sm[0], "b": _sm[1]}, mix=False))
    _tg1 = swarm_ui.tools_toggle(dict(_rd, members={"a": _sm[0], "b": _sm[0]}, tools="swarm"))
    check("Configuration asks first whether the swarm is made of one model or several: one model is a single pill for the model in every role; several models, a pill for each place, is marked experimental and says what was measured of a mix; a swarm whose places hold different models is shown as several",
          'data-pick="one"' in _same and 'data-pick="a"' not in _same and 'data-pick="b"' not in _same and 'data-mix="0" aria-pressed="true"' in _same and "Small model, in every role" in _same
          and 'data-pick="a"' in _chosen and 'data-pick="b"' in _chosen and 'data-pick="one"' not in _chosen and 'data-mix="1" aria-pressed="true"' in _chosen
          and "<i>experimental</i>" in _chosen and "173 of 216" in _chosen and "192" in _chosen
          and 'data-pick="b"' in _diff and 'data-mix="1" aria-pressed="true"' in _diff
          and all('data-pick="%s"' % k in x for k in ("decider", "target") for x in (_same, _chosen, _diff))
          and "body:JSON.stringify({mix:b.dataset.mix==='1'})" in swarm_ui.JS and _tg1.count(" alone</button>") == 1, [_same[:300]])
    # THE PAGE DRAWS THE SHAPE THAT IS RUN (console 2026-11-21): the class stage as a lane of its own, first in a pass; inside one
    # try, how many draft first and how the matter is settled; and in the faces, one model once, no decision model said plainly,
    # and the drafts that are asked only where the first differ marked as such
    _shape_d = dict(_rd, members={"a": dict(_sm[0], key="a"), "b": dict(_sm[0], key="b")}, decider={"id": "none", "name": "A small model of the swarm", "serve": {"kind": "none"}})
    _vz2, _av2 = swarm_ui.viz_block(_shape_d), swarm_ui.avatars(_shape_d)
    _with_dec = swarm_ui.avatars(dict(_shape_d, members={"a": dict(_sm[0], key="a"), "b": dict(_sm[1], key="b")}, decider={"id": "x", "name": "Decider X", "serve": {"kind": "llama"}}))
    _all_once = swarm_ui.avatars(dict(_shape_d, briefs=dict(_rd["briefs"], plan={k: v for k, v in _rd["briefs"]["plan"].items() if k not in ("draftFirst", "decideBy")})))
    check("the page draws the shape that is run: training's picture has the class stage as a lane of its own before the questions (as it stands, the sweep, the best two together, the held questions on two draws, the one keep rule), and inside one try says how many slots draft first and that the answer most slots hold stands; the faces show one model once with every slot, say there is no decision model and what settles it, and mark the drafts asked only where the first differ; with a decision model it breaks ties; with every draft at once and a model deciding, none of that is said",
          all(">%s</span>" % c in _vz2 for c in ("S1", "S2", "S3", "S4", "S5", "B1", "B5", "C1", "C4")) and _vz2.index(">S1</span>") < _vz2.index(">B1</span>") and _vz2.index(">A1</span>") < _vz2.index(">S1</span>")
          and 'data-code="S1"' in _vz2 and "2 draws" in _vz2 and "2 slots first, each its own way; the other 2 only where those differ." in _vz2 and "The answer most slots hold stands." in _vz2
          and "n.trainer==='classes'?'classes'" in swarm_ui.JS
          and _av2.count('class="mav a"') == 1 and 'class="mav b"' not in _av2 and "in every role · 7 slots · loaded once" in _av2
          and "No decision model" in _av2 and "the answer most slots hold stands" in _av2 and ">most hold<" in _av2
          and len(re.findall(r'class="av \w+ later', _av2)) == 2 and "<span>2 first; 2 only if those differ</span>" in _av2 and "Two slots draft first, and the others only where those two differ." in _av2
          and re.findall(r'data-av="((?:a|b)-[a-z-]+)"', _av2)[:4] == ["a-direct", "b-direct", "a-steps", "b-other-way"]
          and 'class="mav b"' in _with_dec and "breaks ties" in _with_dec and ">ties only<" in _with_dec and "No decision model" not in _with_dec
          and "later" not in _all_once and "only if those differ" not in _all_once and "a small model of the swarm decides" in _all_once, [_av2[:300]])
    # (how long each side took: said over a view where an evaluation timed both on a task, and not otherwise)
    _spd = swarm_ui.ev_speed({"results": [{"task": "t1", "secondsEach": {"target": 4.0, "swarm": 10.0}}, {"task": "t2", "secondsEach": {"target": 2.0, "swarm": 8.0}},
                                          {"task": "t3", "secondsEach": {"target": 3.0, "swarm": None}}, {"task": "t4"}]}, "Big <model>")
    check("a view of an evaluation says the seconds a question each side took, as a mean over the tasks both were timed on, and how many times as long the swarm takes; nothing where no task has both",
          "the swarm <b>9.0</b>" in _spd and "Big &lt;model&gt; <b>3.0</b>" in _spd and "the swarm takes 3 times as long" in _spd and "over the 2 tasks both were timed on" in _spd
          and swarm_ui.ev_speed({"results": [{"task": "t1"}]}, "x") == "" and swarm_ui.ev_speed({}, "x") == ""
          and "about the same" in swarm_ui.ev_speed({"results": [{"task": "t", "secondsEach": {"target": 5.0, "swarm": 5.2}}]}, "x"), [_spd])
    # (the card's head holds Train and Questions only; the class boxes, the reason and Clear training state go under it, across the card)
    _ctl_head, _, _ctl_below = _part_ctl.partition(swarm_ui.TRAIN_BELOW)
    _strip_tr = swarm_ui.progress_strip(_fd)
    check("the Train card's head holds its two actions, Train and Questions; which classes it trains, why it waits and Clear training state are under the head, across the card",
          'id="run-go"' in _ctl_head and 'id="tq-open"' in _ctl_head and "data-train-class" not in _ctl_head and 'id="run-clear"' not in _ctl_head
          and _ctl_below.count("data-train-class") == 4 and 'id="run-clear"' in _ctl_below and swarm_ui.TRAIN_BELOW not in _strip_tr
          and _strip_tr.index('class="trainbelow"') > _strip_tr.index('class="evctl"') and '.trainopts' in swarm_ui.CSS, [_ctl_head[:200], _ctl_below[:200]])
    _hist.write_text(_full_hist)
    check("evaluated with one harness only, Train can be pressed, and says beside it which bodies of work have no figure from before, the harness that measures them and where to tick it; evaluated on all, it says nothing",
          _part_need == "" and _part_gap == "Tools and Search have no figure from before: to see them move, evaluate with BFCL (function calling) ticked (under With on the Evaluate card) before training."
          and 'id="run-go" type="button" title=' in _part_ctl and "Tools and Search have no figure from before" in _part_ctl and swarm_ui.eval_gaps(_fd) == "" and swarm_ui.needs_eval(_fd) == "", [_part_need, _part_gap, _part_ctl[:200]])
    page0 = get(base + "/page")[1]
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
    check("the question track (no longer drawn on the Train card) says where the swarm is against each question: how many of the pass's questions are finished, good as it stood, made good by a change, or not good yet; a pip for each in order, with the changes tried on it; where the pass stopped; and before the loop has begun, how it works. The track takes the place of a line about moves being tried",
          'id="qtrack"' in trk and "3 of 6 finished" in trk and "1 good as it stood" in trk and "1 made good by a change" in trk and "1 not good yet" in trk and "at parity" not in trk
          and trk.count('<i class="at"') == 1 and trk.count('<i class="re"') == 1 and trk.count('<i class="nr"') == 1 and "q3 · not good yet · day · 8 changes tried" in trk and "q2 · made good by a change · fix · 2 changes tried" in trk
          and "Pass 2 stopped with 3 of 6 questions finished." in trk and "not begun" in trk_none and 'id="qtrack"' not in arr_trk and "Being tried now" not in arr_trk and "Stopped while trying" not in arr_trk
          and [x["s"] for x in swarm_ui.track_of(trk_rec)] == ["at", "re", "nr"], trk[:300])
    tl = swarm_ui.tries_list({"list": [
        {"id": "q-easy", "kind": "math", "state": "at parity", "attempts": [{"move": "", "grade": "right"}]},
        {"id": "q-won", "kind": "fix", "state": "reached", "lostAt": "choosing", "attempts": [{"move": "", "grade": "wrong"}, {"move": "plan: decide by most", "grade": "wrong"},
            {"move": "plan: a model decides with the decider", "grade": "right", "guard": {"asked": 2, "lost": 1}, "lostOn": "q-easy"},
            {"move": "a-critic: check the edge cases", "grade": "right", "kept": True, "guard": {"asked": 3, "lost": 0}}]},
        {"id": "q-stuck", "kind": "day", "state": "not reached", "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong"}, {"move": "b-direct: say the weekday last", "grade": "wrong"}]}]})
    check("the question track folds what was tried on each question that needed a change: where its answer was lost and each change in order (what did nothing, what reached parity there but lost a question already there, and what was kept); and the plan section no longer repeats the questions",
          "What was tried on each question that needed a change (2)" in tl and "q-easy</code> <span" not in tl and tl.index("q-stuck") < tl.index("q-won") and "lost in choosing · 3 tried" in tl
          and "lost <code>q-easy</code>, already good" in tl and "3 already good asked again, none lost" in tl and '>kept</span><span class="tx">a-critic: check the edge cases' in tl and "Not good yet" in tl and "Made good by a change" in tl
          and swarm_ui.tries_list({"list": []}) == "" and "Question by question" not in swarm_ui.plan_block(d) and "loopwrap" not in swarm_ui.plan_block(d), tl[:300])
    tm = swarm_ui.tries_list({"list": [{"id": "q-m", "kind": "fix", "state": "not reached", "lostAt": "drafting", "attempts": [{"move": "", "grade": "wrong"},
        {"move": "flow: the answers go back", "grade": "wrong", "round": 2, "closer": True, "near": {"lost": "choosing", "had": 2, "p": 0.35},
         "method": {"place": 4, "open": 37, "from": {"lost": "drafting", "had": 0}, "reasons": ["no slot had the answer: this makes other drafts", "the first area for an answer lost in drafting (slots)"]}}]}]})
    page = get(base + "/page")[1]
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
          "broke q-other 3×" in tb and "good here, but it broke q-other when that was asked again" in tb and "line('Conflict:'" in page and "'broke one'" in page
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
    check("pressed, it starts a session that goes on until it is stopped (no number of passes is given it, and no number of questions: that is the trainer's policy), and the Train card shows it running: Stop training in place of Train, how long and since when, and a moving bar in place of the share",
          code == 200 and 'data-running="1"' in panel and "Stop training" in panel and 'id="run-go"' not in panel and 'data-since="' in panel and "<b>Running " in panel and "<small>since " in panel and swarm_ui._span(45) == "45 s" and swarm_ui._span(750) == "12 min 30 s" and swarm_ui._span(7500) == "2 h 5 min" and "timeZoneName" in html
          and "until stopped" not in panel and panel.startswith('<div class="trainprog trainhead">') and 'class="pct busy"' in panel and 'class="facts"' not in panel and 'id="run-each"' not in page0 and "asked 0 " in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text(), panel[:400])
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
    tl_run = post("/config", b'{"tools":"swarm"}')[0]
    tl_cfg = json.loads((fake / "src" / "config.json").read_text()).get("tools")
    q_run = post("/questions", b'{"id":"crew","questions":[{"ask":"hello"}]}')[0]
    check("while a session runs nothing can be uninstalled", post("/uninstall", b'{"id":"train:measured"}')[0] == 409)
    check("the questions a person wrote can be changed while a session runs (a pass ends on the questions it began with, and the next one asks these)", q_run == 200)
    check("who takes turns with tools can be changed while a session runs (it keeps what it began with), but not together with a model",
          tl_run == 200 and tl_cfg == "swarm" and post("/config", b'{"tools":"swarm","a":"x"}')[0] == 409, [tl_run, tl_cfg])
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
    srv, base = serve(REPO)
    code, html = get(base + "/page")
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
    srv, base = serve(REPO)
    page = get(base + "/page")[1]
    srv.shutdown()
    heads = re.findall(r'<div class="proghead">(.*?)</div>', page, re.S)
    shape = [re.findall(r'<span class="(memnum|progline|evctl)"', h)[:3] for h in heads]
    check("every card's head (Memory saved, Evaluate, Pretrain, Train) is one structure: the figure, what the card does, its controls, in three columns of the same widths",
          len(heads) >= 4 and all(x == ["memnum", "progline", "evctl"] for x in shape)
          and "grid-template-columns:330px minmax(0,1fr) 300px" in page and ".memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{display:grid" in page, shape)

# THE DECIDE STEP SHOWS WHO DECIDES: a small model beside the decider has its face there too, in its model's colour, labelled with
# how it is asked and with its own live line; and where the answer most slots hold settles it, the decider's face says it decides ties only
import types as _types
swarm_ui.ARGS = _types.SimpleNamespace(root=str(REPO))
_d = data.load(REPO)
_b = _d["briefs"]
_slot = next(x for x in _b["slots"] if x["member"] == "b")
_with = swarm_ui.avatars(dict(_d, briefs=dict(_b, plan=dict(_b.get("plan") or {}, decideBy="decider", decideWith={"how": "if-close", "slot": _slot["id"]}))))
_judge = re.search(r'<button[^>]*data-av="decide-judge".*?</button>', _with, re.S)
_most = swarm_ui.avatars(dict(_d, briefs=dict(_b, plan=dict(_b.get("plan") or {}, decideBy="most", decideWith={"how": "together"}))))
check("the decide step shows who decides: a small model beside the decider has its face there, in its model's colour, labelled with how it is asked and with its own live line; where most slots settle it, the decider's face says it decides ties only, and no model beside it is shown",
      bool(_judge) and 'class="av b judge' in _judge.group(0) and ">if close<" in _judge.group(0) and 'data-live="decide-judge"' in _judge.group(0) and ("asked as %s" % _slot["id"]) in _judge.group(0)
      and "decide-judge" not in swarm_ui.avatars(dict(_d, briefs=dict(_b, plan={k: v for k, v in (_b.get("plan") or {}).items() if k not in ("decideWith", "decideBy")}))) and ">ties only<" in _most and 'data-av="decide-judge"' not in _most,
      _judge.group(0)[:200] if _judge else "no judge face")

# A FLOW TOO LONG FOR ITS CARD WRAPS, AT ANY WIDTH: measured on the page (fitPipes, on load, on a resize or fold, and on every redraw),
# not guessed by a breakpoint; a flow training grew ran past the card on a folding phone's inner screen and on a laptop
check("a flow too long for its card wraps into tiles at any width, measured on the page on load, on a resize and on every redraw, instead of running past the card's edge",
      "function fitPipes()" in swarm_ui.JS and "addEventListener('resize',fitSoon)" in swarm_ui.JS and "new MutationObserver(fitSoon)" in swarm_ui.JS
      and ".pipe.wrapped{flex-wrap:wrap" in swarm_ui.CSS and ".pipe.wrapped .st::after,.pipe.wrapped .loopg::after{display:none}" in swarm_ui.CSS)

# A MARK PROVED WRONG IS SET ASIDE ON THE PAGE TOO: said in the line, a pip of its own, and not counted against the share
_rs, swarm_ui.run_state = swarm_ui.run_state, (lambda: {})  # (as if no session ran: the share, not its moving placeholder)
_pw = swarm_ui.progress_strip(dict(_d, loop={"of": 10, "changes": [], "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "reached"}, {"id": "c", "state": "mark wrong", "markWrong": {"share": 0.27}}]}))
swarm_ui.run_state = _rs
check("a question whose mark its own correct solution proves wrong is said in the training line as set aside, and is not counted against the share (2 of the 9 that can reach parity)",
      "1 set aside because the larger model&#39;s answer is wrong" in _pw.replace("'", "&#39;") and "22.2%" in _pw and swarm_ui.PIP["mark wrong"] == "mw", _pw[:300])

# THE FACES DRAW THE ARRANGEMENT AS IT IS ASKED: while a try runs, the one that try asks, marked as not kept, the slots its change
# touches ringed and what else differs said; with no try running, the kept one; and the page is told when to draw them again
_ll, _sl = swarm_ui.loop_live, swarm_ui.session_live
_kb = _d["briefs"]
_cand = {"version": _kb.get("version"), "slots": [dict(x, temperature=0.9) if i == 0 else x for i, x in enumerate(_kb["slots"])], "plan": dict(_kb.get("plan") or {}, decideBy="decider"), "flow": _kb.get("flow")}
swarm_ui.loop_live = lambda: {"n": 25, "attempt": 7, "move": "a change", "briefs": _cand}
swarm_ui.session_live = lambda: True
_fb = swarm_ui.faces_block(_d)
_fk = swarm_ui.faces_key(_d)
swarm_ui.loop_live = lambda: None
_fk0, _fb0 = swarm_ui.faces_key(_d), swarm_ui.faces_block(_d)
swarm_ui.loop_live, swarm_ui.session_live = _ll, _sl
check("while a try runs the faces draw the arrangement it asks, marked as being tried and not kept, with the slot its change touches ringed and what else differs said; with none running, the kept one; and the key the page polls changes with the try",
      "Being tried, not kept:" in _fb and "change 7 on question 25" in _fb and "1 slot changed or added" in _fb and "the plan differs: decideBy" in _fb
      and ('class="av %s trying' % _kb["slots"][0]["member"]) in _fb.replace(" norec", "") and ">ties only<" not in _fb
      and _fk.startswith("try-25-7-") and _fk0 == "kept-%s-" % _kb.get("version") and "Being tried, not kept" not in _fb0 and 'id="faces"' in _fb0
      and "async function facesTick()" in swarm_ui.JS,
      ["Being tried, not kept:" in _fb, "1 slot changed or added" in _fb, ('class="av %s trying' % _kb["slots"][0]["member"]) in _fb.replace(" norec", ""), ">ties only<" in _fb, _fk, _fk0, "Being tried, not kept" not in _fb0])

# THE FACES DRAW THE CLASS'S OWN ARRANGEMENT: a question in words is asked with the words arrangement, so that is drawn, and a try
# is compared with it (against the shared one, a try dropping one slot read as leaving out every slot words had already dropped);
# the steps its turn cannot take (the sandbox, off code) are drawn off, and a turn with tools is drafts and the decider only
_ll, _sl = swarm_ui.loop_live, swarm_ui.session_live
_ds = [x for x in _kb["slots"] if x["stage"] == "draft"]
_wd = {"slots": [x for x in _kb["slots"] if x["id"] != _ds[-1]["id"]], "plan": dict(_kb.get("plan") or {}, decideBy="most"), "flow": None}
_dw = dict(_d, briefs=dict(_kb, kinds={"words": _wd}))
_wt = {"version": _kb.get("version"), "slots": [x for x in _wd["slots"] if x["id"] != _ds[0]["id"]], "plan": _wd["plan"], "flow": None}
swarm_ui.session_live = lambda: True
swarm_ui.loop_live = lambda: {"n": 49, "attempt": 3, "move": "drop %s" % _ds[0]["id"], "class": "words", "briefs": _wt}
_fw = swarm_ui.faces_block(_dw)
swarm_ui.loop_live = lambda: {"n": 49, "attempt": 0, "class": "words"}
_fw0 = swarm_ui.faces_block(_dw)
swarm_ui.loop_live = lambda: {"n": 3, "attempt": 0, "class": "tools"}
_ft = swarm_ui.faces_block(_dw)
swarm_ui.loop_live, swarm_ui.session_live = _ll, _sl
check("the faces draw the class's own arrangement: a try on a words question is compared with the words arrangement (only the slot it drops is left out), named with its class; the sandbox is drawn off off code; a turn with tools takes drafts and the decider only, and its decider is asked",
      "question 49, in words" in _fw and "the words arrangement (its own)" in _fw and ("%s left out." % _ds[0]["id"]) in _fw and _ds[-1]["id"] + " left out" not in _fw
      and ("(its own) (briefs v%s): %s left out." % (_kb.get("version"), _ds[0]["id"])) in _fw
      and 'class="via off"' in _fw and "code only" in _fw and "<b>Asked now:</b> question 49, in words, with the words arrangement (its own)" in _fw0
      and ('data-av="%s"' % _ds[-1]["id"]) not in _fw0 and "the tools arrangement (the shared one" in _ft and _ft.count('class="st off"') >= 2 and ">ties only<" not in _ft
      and swarm_ui.faces_key(_dw) != "" ,
      [("question 49, in words" in _fw), ("the words arrangement (its own)" in _fw), ("%s left out." % _ds[0]["id"]) in _fw, 'class="via off"' in _fw, "<b>Asked now:</b>" in _fw0, _ft.count('class="st off"'), ">ties only<" in _ft])

# THE QUESTIONS' KEY IS EXHAUSTIVE: every look a pip can have (each state's, and the one in hand) has its line in the key
_qt = swarm_ui.question_track(_d)
_css = swarm_ui.CSS
check("every state a question can be in has a pip of its own (no two states share a look), its name on the pip's tooltip, and its line in the key drawn by the same class: at parity, brought to parity, not reached, in hand, back in hand after a swap, set aside, set aside because the larger model's answer is wrong, and not compared",
      len(set(swarm_ui.PIP.values())) == len(swarm_ui.PIP) and set(swarm_ui.PIP.values()) | {"cur", "pe"} == set(swarm_ui.PIP_WORDS)
      and all(('<i class="pk %s"></i>' % k) in _qt and swarm_ui.e(w) in _qt for k, w in swarm_ui.PIP_WORDS.items())
      and all((".qkey i.%s" % k) in _css for k in swarm_ui.PIP_WORDS) and "x.w?x.w+' · ':''" in swarm_ui.JS,
      [k for k in swarm_ui.PIP_WORDS if ('<i class="pk %s"></i>' % k) not in _qt])

_late = swarm_ui.track_of({"list": [{"id": "q", "kind": "k", "state": "reached", "markWrong": {"share": 0.9}, "attempts": [{}]}]})[0]
check("a question brought to parity before its mark was found wrong shows the wrong mark's pip, its tooltip saying it reached parity first",
      _late["s"] == "mw" and "made good by a change before that was found" in _late["w"], _late)

# A MARK THE LARGER MODEL DID NOT GIVE AGAIN, where the swarm is not at parity with it: a pip of its own, said in the training line,
# and still counted in the share (nothing is taken out of what the share is of)
_rs2, swarm_ui.run_state = swarm_ui.run_state, (lambda: {})
_pu = swarm_ui.progress_strip(dict(_d, loop={"of": 5, "changes": [], "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "mark unstable", "unstable": True}, {"id": "c", "state": "not reached"}, {"id": "d", "state": "reached"},
                                                                         {"id": "e", "state": "no standard"}]}))
swarm_ui.run_state = _rs2
_tu = swarm_ui.track_of({"list": [{"id": "b", "kind": "answer", "state": "mark unstable", "unstable": True, "attempts": [{}]}]})[0]
check("a question set aside because the larger model did not give its answer again has a pip of its own, is said in the training line, and stays in the share; one the larger model's own answers do not agree on is left out of the share and said (2 of the 4 left is 50%); and how close a try came says first how the reply itself read, where the reader read one",
      _tu["s"] == "mu" and "did not give this answer again" in _tu["w"] and _tu["tried"] == 0
      and "1 set aside because the larger model did not give its answer again" in _pu and "50%" in _pu
      and "1 left out because the larger model&#39;s own answers do not agree" in _pu.replace("'", "&#39;") and swarm_ui.PIP["no standard"] == "ns"
      and swarm_ui.near_words({"lost": "drafting", "had": 0, "reply": 0.84}).startswith("the reply read 0.84, lost in drafting")
      and swarm_ui.near_words({"lost": "drafting", "had": 0}).startswith("lost in drafting"), [_tu, _pu[:400]])

# A VERDICT FOR EACH CAPABILITY (docs/swoa.md 4.7): the paired gap from the counts an evaluation keeps, pooled over a capability's
# tasks, read against the margin: the earlier lineup's 100 questions of IFEval read short, 20 questions read open, a whole task
# within a point reads parity; and the dialog and the card show it
_pg = data.paired_gap({"of": 100, "onlySwarm": 6, "onlyTarget": 25})
_res = lambda item, task, n, s, t, proof=True: {"item": item, "itemName": item.title(), "task": task, "name": task, "metric": "m", "n": n, "of": n, "proof": proof,  # noqa: E731
                                                "harness": {"name": "h", "version": "1"}, "swoa": {"value": 0.7, "stderr": 0.02}, "target": {"value": 0.7, "stderr": 0.02},
                                                "gap": round((s - t) / n, 4), "gapStderr": data.paired_gap({"of": n, "onlySwarm": s, "onlyTarget": t})["gapStderr"], "paired": True,
                                                "pairs": {"n": n, "onlySwoa": s, "onlyTarget": t}}
_caps = data.capabilities_of([_res("crew", "ifeval", 541, 85, 88), _res("logic", "a", 100, 6, 25), _res("logic", "b", 100, 5, 24), _res("math", "g", 20, 3, 4, False)])
_cv = {c["id"]: c for c in _caps}
_pb = swarm_ui.proof_block({"target": {"name": "T"}, "proof": {"rule": "r", "margin": 0.05, "capabilities": _caps, "claims": {"notClaimed": data.NOT_CLAIMED},
                                                               "results": [_res("crew", "ifeval", 541, 85, 88)]}})
check("a capability's verdict is read from the paired gap over its tasks together, against the margin: within a point on a whole task is parity, 19 points lower on 200 questions is short, 20 questions are open and marked a check; the dialog shows each with what is not claimed",
      _pg["gap"] == -0.19 and abs(_pg["gapStderr"] - 0.0523) < 0.0005 and data.verdict_of(_pg["gap"], _pg["gapStderr"]) == "short"
      and _cv["crew"]["verdict"] == "parity" and _cv["crew"]["n"] == 541 and _cv["logic"]["verdict"] == "short" and _cv["logic"]["n"] == 200 and _cv["logic"]["gap"] == -0.19
      and _cv["math"]["verdict"] == "open" and _cv["math"]["proof"] is False and data.paired_gap({"of": 0}) is None
      and ">Parity<" in _pb and "Verdict (margin 0.05)" in _pb and "knowledge with no tool offered" in _pb,
      [_pg, {k: (v.get("verdict"), v.get("n"), v.get("gap")) for k, v in _cv.items()}])

# THE MODULE BESIDE ITS TARGET, FAMILY BY FAMILY: where the questions carry a standard of their own the larger model is counted by the
# same standard; where they do not, its answers are the standard and it has no count
_fb2 = swarm_ui.families_block({"families": [{"kind": "write-arrays", "n": 6, "own": True, "asked": 6, "module": 5, "target": 4, "targetKnown": 6},
                                             {"kind": "answer", "n": 6, "own": False, "asked": 4, "module": 1, "target": None, "targetKnown": 0},
                                             {"kind": "trace", "n": 6, "own": True, "asked": 0, "module": 0, "target": 0, "targetKnown": 0}]})
check("the questions' card sets the module beside the larger model family by family: both counted by the question's own standard where it has one, the larger model's answers named as the standard where it has none, a family not yet asked left out, and the totals for the families with a standard of their own",
      "by family (2)" in _fb2 and "<td>5 of 6</td><td>4 of 6</td>" in _fb2 and "its answers are the standard" in _fb2 and "the module <b>5</b> of 6, the larger model <b>4</b> of 6" in _fb2
      and swarm_ui.families_block({}) == "" and "id='fams'" in _fb2, _fb2[:400])

# AN OPEN PAGE SAYS WHEN THE DASHBOARD'S CODE HAS CHANGED: it carries the build it was drawn with, asks the server's, and where they
# differ shows a note with a Refresh button (hidden otherwise); it never reloads on its own
with tempfile.TemporaryDirectory() as tmp:
    srv, base = serve(REPO)
    pg, bj = get(base + "/page")[1], json.loads(get(base + "/api/build")[1])
    srv.shutdown()
check("an open page carries the build of the code it was drawn with, the server says which it runs, and where they differ the page shows a note with a Refresh button, hidden otherwise, and never reloads by itself",
      ('<meta name="swarm-build" content="%s">' % swarm_ui.BUILD) in pg and bj == {"build": swarm_ui.BUILD} and '<div class="updnote" id="updnote" hidden>' in pg and 'id="upd-go"' in pg
      and "async function buildTick()" in swarm_ui.JS and "n.hidden=!b||b===BUILD_ME" in swarm_ui.JS and swarm_ui.JS.count("location.reload()") == 1 and "if(ev.target.closest('#upd-go'))location.reload()" in swarm_ui.JS,
      bj)

_qt2 = swarm_ui.question_track(dict(_d, loop={"pass": 3, "of": 4, "list": [{"id": "a", "kind": "k", "state": "at parity", "attempts": [{}]}, {"id": "b", "kind": "k", "state": "set aside", "attempts": [{}]},
                                                                      {"id": "c", "kind": "k", "state": "reopened", "attempts": [{}]}, {"id": "d", "kind": "k", "state": "not reached", "attempts": [{}]}]}))
_ll2 = swarm_ui.loop_line(dict(_d, loop={"of": 10, "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "reached"}, {"id": "c", "state": "mark wrong"}, {"id": "d", "state": "no standard"}]}))
check("a question set aside or back in hand has its pip and is not counted finished, in the page and in its script; and the share of answers good is the one share, of the questions that can be graded, wherever it is said",
      "2 of 4 finished" in _qt2 and "Pass 3 stopped with 2 of 4 questions finished and 2 to come back to." in _qt2 and "every question finished" not in _qt2
      and "done.filter(x=>x.s!=='ro'&&x.s!=='sa').length+' of '+of+' finished'" in swarm_ui.JS and "<b>25%</b> · 2 of 10 answers good" in _ll2, [_qt2[:300], _ll2])

_ncw = swarm_ui.track_of({"list": [{"id": "q", "kind": "k", "state": "not compared", "why": "the reader of answers in words failed its own check this pass (training/readers.mjs)", "attempts": [{}]}]})[0]
check("a question not compared says why on its pip: the reader of its kind not believed this pass is not reported as no answer from the larger model",
      _ncw["s"] == "nc" and "the reader of answers in words failed its own check" in _ncw["w"] and "no answer from the larger model" not in _ncw["w"] and "no answer from the larger model" not in swarm_ui.PIP_WORDS["nc"], _ncw)

# A SECOND HARNESS IN THE PROOF: a result of the tool tests names its own harness, the tools each model was offered and (a search of
# the live web) the day both were asked; a task that was not asked is not listed; the capability gets its verdict like any other
import tempfile as _tf
with _tf.TemporaryDirectory() as _t2:
    _r2 = Path(_t2)
    (_r2 / ".work" / "eval").mkdir(parents=True)
    _bf = {"name": "bfcl-eval", "version": "2026.3.23"}
    _row = {"at": "2026-11-18T20", "runId": "r", "configuration": "c--t", "arrangementSha256": "A", "harness": "lm-evaluation-harness 0.4.13 and bfcl-eval 2026.3.23",
            "harnessId": {"name": "lm-evaluation-harness", "version": "0.4.13"}, "adapters": [], "results": [
                {"task": "ifeval", "name": "IFEval", "item": "crew", "itemName": "The Crew", "metric": "m", "filter": "none",
                 "swarm": {"value": 0.7, "stderr": 0.04, "n": 120, "of": 541}, "target": {"value": 0.75, "stderr": 0.04, "n": 120, "of": 541}},
                {"task": "bfcl_simple_python", "name": "BFCL one function", "item": "tools", "itemName": "Tools", "metric": "accuracy", "filter": "none", "harnessId": _bf,
                 "tools": "the functions each question offers", "swarm": {"value": 0.9, "stderr": 0.02, "n": 150, "of": 400}, "target": {"value": 0.92, "stderr": 0.02, "n": 150, "of": 400},
                 "targetAsked": "written", "targetWays": {"tools": {"value": 0.7, "stderr": 0.03, "n": 150, "of": 400}, "written": {"value": 0.92, "stderr": 0.02, "n": 150, "of": 400}},
                 "agree": {"of": 150, "same": 139, "onlySwarm": 5, "onlyTarget": 6}},
                {"task": "bfcl_web_search_base", "name": "BFCL web search", "item": "search", "itemName": "Search", "metric": "accuracy", "filter": "none", "harnessId": _bf,
                 "tools": "a search tool", "askedOn": "2026-11-18", "failed": "not asked: it searches the web through a service that needs a key"}]}
    (_r2 / ".work" / "eval" / "history.jsonl").write_text(json.dumps(_row) + "\n")
    _p2 = data.swoa_proof({"root": str(_r2), "key": "c--t", "members": {}}, "A", {})
_b2 = {x["task"]: x for x in _p2["results"]}
_c2 = {c["id"]: c for c in _p2["capabilities"]}
_pb2 = swarm_ui.proof_block({"target": {"name": "T"}, "proof": _p2})
_card2 = data.swoa_card({"swoa": {}, "target": {"name": "T"}, "proof": _p2, "baseModule": {"members": {}, "decider": {}}, "runtime": {}})
check("a proof may hold results of more than one harness: a result of the tool tests names its own, and what each model was offered; a task that was not asked is not listed; calling functions gets its verdict from its pairs as any capability does; the card says what was offered; and where the target was asked two ways the proof says which it is counted by and what it scored each way",
      sorted(_b2) == ["bfcl_simple_python", "ifeval"] and _b2["bfcl_simple_python"]["harness"] == _bf and _b2["ifeval"]["harness"]["name"] == "lm-evaluation-harness"
      and _b2["bfcl_simple_python"]["tools"] == "the functions each question offers" and "tools" not in _b2["ifeval"] and _b2["bfcl_simple_python"]["pairs"] == {"n": 150, "onlySwoa": 5, "onlyTarget": 6}
      and _c2["tools"]["verdict"] == "parity" and "Tools" in _p2["claims"]["claimed"] and "search" not in _c2
      and "BFCL one function: each model was offered the functions each question offers" in _card2 and 'tools: "the functions each question offers"' in _card2 and "bfcl-eval 2026.3.23" in _card2
      # (and where the target was asked two ways: the way it is counted by, its higher score, and both scores, in the proof, on the page and on the card)
      and _b2["bfcl_simple_python"]["targetAsked"] == "written" and _b2["bfcl_simple_python"]["targetWays"]["tools"] == {"value": 0.7, "stderr": 0.03} and "targetAsked" not in _b2["ifeval"]
      and "the target, asked two ways: tools in the request 0.700 · tools written into the conversation 0.920 (counted: its better over the capability)" in _pb2 and "white-space:nowrap" in _pb2
      and "offered: the functions each question offers" in _pb2 and "the target was asked two ways and is counted by the one it scores higher by over the capability, here the tools written into the conversation (on this task, the tools in the request: 0.700, the tools written into the conversation: 0.920)" in _card2,
      [_b2, _c2])

# WHILE AN EVALUATION RUNS THE TRAIN CARD DOES NOT SAY THAT NO MODEL IS LOADED: it says the evaluation has them
_bw = swarm_ui.busy_with
swarm_ui.busy_with = lambda: "an evaluation"
_iw_eval = swarm_ui.idle_words()
swarm_ui.busy_with = lambda: ""
_iw_none = swarm_ui.idle_words()
swarm_ui.busy_with = _bw
check("where an evaluation or pretraining is running the Train card says it has the models, and only where nothing runs that no model is loaded; the page's script says the same",
      _iw_eval == "An evaluation is running: the models are loaded for it." and _iw_none == "Nothing is running. No model is loaded."
      and "n.busy?n.busy[0].toUpperCase()+n.busy.slice(1)+' is running: the models are loaded for it.'" in swarm_ui.JS, [_iw_eval, _iw_none])

# A RECORD GRADED BY AN EARLIER RULE IS NOT CARRIED ON, and the page says so in place of where the pass would carry on from
# (as the page says it with no session running: a pass training on this machine while the checks run is not this record's)
_ll7 = swarm_ui.loop_live
swarm_ui.loop_live = lambda: None
_st_old = swarm_ui.progress_strip(dict(_d, scoring=3, loop={"of": 5, "changes": [], "scoring": 2, "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "not reached"}]}))
_st_new = swarm_ui.progress_strip(dict(_d, scoring=3, loop={"of": 5, "changes": [], "scoring": 3, "list": [{"id": "a", "state": "at parity"}, {"id": "b", "state": "not reached"}]}))
swarm_ui.loop_live = _ll7
check("a pass's record graded by an earlier rule says its questions will be asked again from the first when training starts, and not where it would carry on from; one graded by the rule in force says where it carries on; and the rule in force is read from the loop",
      "graded by an earlier rule: when training starts, its questions are asked again from the first" in _st_old and "it carries on from" not in _st_old
      and "Stopped; it carries on from question 3." in _st_new and "earlier rule" not in _st_new
      and isinstance(data.scoring_now(REPO), int) and data.scoring_now("/nowhere/at/all") is None, _st_old[-400:])

# A CHANGE KEPT BY ITS CLASS says what its class gained, the error of that and over how many questions; one proposed for the class
# says so; one kept before that rule says what it was kept on then. And the page says how a change is kept as the policy has it
_lr = swarm_ui.ledger_rows([
    {"n": 3, "kind": "brief", "what": "a-direct: say the day last", "class": "words", "question": {"id": "day-4", "lostAt": "drafting", "attempt": 12}, "classGain": {"class": "words", "n": 110, "gain": 0.071, "stderr": 0.02}},
    {"n": 2, "kind": "plan", "what": "write in full", "class": "talk", "proposed": True, "classGain": {"class": "talk", "n": 36, "gain": 0.05, "stderr": 0.02}},
    {"n": 1, "kind": "brief", "what": "old", "question": {"id": "fix-1", "lostAt": "choosing", "attempt": 3, "guard": 4}}])
check("a kept change says what it was kept on: its class's gain, the error of it and over how many questions; proposed for the class where it was; and one kept before that rule, the question it brought to parity and how many already there held",
      "Made <code>day-4</code> good (lost in drafting; change 12 tried on it)" in _lr and "its class (in words) gained <b style='display:inline;font-size:inherit'>+0.071</b> ± 0.020 over 110 questions" in _lr
      and "Proposed for its class at the end of a pass · its class (in conversation) gained" in _lr and "over 36 questions" in _lr
      and "Brought <code>fix-1</code> to parity (lost in choosing; change 3 tried on it) · 4 already at parity asked again, none lost" in _lr, _lr)
check("while a change is scored on its class the page says so, and says which question is asked as the swarm stands to set it beside; and the SwOA's learned record states the rule a change is kept by now, and the rule before it",
      "lp.classCheck?'checking a change on its class'" in swarm_ui.JS and "const far=lp.guarded&&lp.guarded.of?' · '+Math.round(100*Math.max(0,lp.guarded.n-1)/lp.guarded.of)+'%':''" in swarm_ui.JS and "lp.standing?'where its class stands'" in swarm_ui.JS and "of its class)" in swarm_ui.JS
      and "a change is kept when the questions of its class got better with it" in data.learned_rule({"loop": {"classKeep": True}}) and "classGain" in data.learned_rule({"loop": {"classKeep": True}})
      and "Before this rule, a change was kept only if it brought a train question to parity" in data.learned_rule({"loop": {"classKeep": True, "classMinGain": 0.02}})
      and data.learned_rule({"loop": {}}).startswith("training goes question by question: a change is kept only if it brings a train question to parity"), data.learned_rule({"loop": {"classKeep": True}}))

# THE SEARCH BEHIND THE WEB SEARCH TEST, the part of it that runs with the tool tests' own Python (training/support/bfcl_search.py):
# what a model is given back is the shape the test's own search gives; a query's results are kept and given again; one that
# returns nothing is asked again a few times, and then that is its answer
import importlib.util as _ilu
_sp = _ilu.spec_from_file_location("bfcl_search", REPO / "training" / "support" / "bfcl_search.py")
_bs = _ilu.module_from_spec(_sp)
_sp.loader.exec_module(_bs)
_found = [{"title": "A", "url": "https://a.example/x", "content": "about a", "engines": ["brave"]}, {"title": "", "url": "https://b.example/"},
          {"title": "Redirect", "url": "http:///go/v1/abc"}, {"title": "C", "url": "http://c.example/", "content": None}]
with _tf.TemporaryDirectory() as _t3:
    _asked = []

    def _ask(base, keywords, language):
        _asked.append((base, keywords, language))
        return {"results": [] if keywords == "nothing" or (keywords == "late" and len([a for a in _asked if a[1] == "late"]) < 2) else _found, "unresponsive_engines": [["duckduckgo", "CAPTCHA"]]}

    _waits = []
    _r1 = _bs.search("http://s", _t3, "tea", 10, "us-en", True, ask=_ask, tries=3, wait=_waits.append)
    _r2 = _bs.search("http://s", _t3, "tea", 1, "us-en", False, ask=_ask, tries=3, wait=_waits.append)
    _r3 = _bs.search("http://s", _t3, "late", 10, "wt-wt", True, ask=_ask, tries=3, wait=_waits.append)
    _r4 = _bs.search("http://s", _t3, "nothing", 10, "wt-wt", True, ask=_ask, tries=3, wait=_waits.append)
    _r5 = _bs.search("http://s", _t3, "nothing", 10, "wt-wt", True, ask=_ask, tries=3, wait=_waits.append)
    _kept_files = sorted(os.listdir(os.path.join(_t3, "queries")))
    _bs.noted(os.path.join(_t3, "log", "searches.jsonl"), "tea", {"results": [1, 2]})
    _bs.noted(os.path.join(_t3, "log", "searches.jsonl"), "none", {"results": [], "why": "refused"})
    _bs.noted("", "ignored", {"results": []})
    _noted3 = [json.loads(x) for x in open(os.path.join(_t3, "log", "searches.jsonl")).read().splitlines()]
    # (searches are sent no closer together than the pace: the second, one second after the first with a pace of three, waits two)
    _paced3 = []
    _bs._SENT[0] = 0.0
    for _now, _pace in ((100.0, 3), (101.0, 3), (101.0, 0)):
        _w = []
        _bs.paced(_w.append, lambda: _now, _pace)
        _paced3.append(_w)
    _made = []
    _k1 = _bs.kept(os.path.join(_t3, "pages"), "u", lambda: _made.append(1) or {"content": "page"})
    _k2 = _bs.kept(os.path.join(_t3, "pages"), "u", lambda: _made.append(1) or {"content": "another"})
check("the search behind the web search test gives a model what the test's own search gives (title, href and, where snippets are shown, body; cut at the number asked for; an error where nothing was found), leaves out what is no page, keeps what a query returned and gives it again without asking, asks again a few times where nothing came back, and reads the test's region as a language",
      _r1 == [{"title": "A", "href": "https://a.example/x", "body": "about a"}, {"title": "C", "href": "http://c.example/", "body": ""}]
      and _r2 == [{"title": "A", "href": "https://a.example/x"}] and len([a for a in _asked if a[1] == "tea"]) == 1 and _asked[0] == ("http://s", "tea", "en-US")
      and _r3 == _r1 and len([a for a in _asked if a[1] == "late"]) == 2
      and _r4 == {"error": _bs.NOTHING} and _r5 == _r4 and len([a for a in _asked if a[1] == "nothing"]) == 3 and len(_kept_files) == 3
      and _bs.fewest(10, "5") == 5 and _bs.fewest(3, 5) == 3 and _bs.fewest(10, None) == 10 and _bs.fewest(None, 0) == 10
      and _bs.cut_page({"content": "x" * 50}, 10)["content"].startswith("x" * 10 + "\n[The page goes on: only its first 10 characters are given, of 50.]") and _bs.cut_page({"content": "short"}, 10) == {"content": "short"}
      and _bs.cut_page({"content": "Quendale\nJump to content\nMain menu\n" + "The town of Quendale stands on a hill. " * 12 + "\nMore."}, 100)["content"].startswith("Quendale\n[The page's menus are left out.]\nThe town of Quendale stands")
      and "Main menu" not in _bs.cut_page({"content": "Quendale\nJump to content\nMain menu\n" + "The town of Quendale stands on a hill. " * 12 + "\nMore."}, 100)["content"]
      and _bs.cut_page({"error": "no"}, 10) == {"error": "no"} and _bs.cut_page({"content": "x" * 50}, 0)["content"] == "x" * 50 and _bs.cut_page({"content": "x" * 50}, None)["content"] == "x" * 50
      and _bs.language_of("wt-wt") == "all" and _bs.language_of("uk-en") == "en-GB" and _bs.language_of("tw-tzh") == "zh-TW" and _bs.language_of("ue-es") == "es-US" and _bs.language_of("") == "all"
      and _bs.is_page("https://a.example/") and not _bs.is_page("http:///go/v1/abc") and not _bs.is_page("ftp://a.example/") and not _bs.is_page(None)
      # (a search that came back with nothing is asked again after a longer wait each time; and a model's own record of its
      # searches says how many results each was given, so that a result can say how many came back with nothing)
      and _bs.waits_of("5,15,30") == [5.0, 15.0, 30.0] and _bs.waits_of("") == [5.0, 15.0, 30.0] and _bs.waits_of("1, x,-2,3") == [1.0, 3.0]
      and _noted3 == [{"q": "tea", "n": 2}, {"q": "none", "n": 0, "why": "refused"}] and _paced3 == [[], [2.0], []]
      and _k1 == {"content": "page"} and _k2 == _k1 and len(_made) == 1 and _waits[:3] == [5.0, 5.0, 15.0],
      [_r1, _r2, _r4, _asked, _kept_files])

# WEB SEARCH IN THE SwOA SPEC (interface.webSearch; docs/swoa.md T.10): what it is to the module, whose each part is, how a caller
# uses it, the limits the module keeps to (read from the runtime), and what the proof measured of it, with the search behind the test
_tm = (REPO / "src" / "tools.mjs").read_text()
_each, _all = int(re.search(r"^export const RESULT_MOST = (\d+);", _tm, re.M).group(1)), int(re.search(r"^export const FOUND_MOST = (\d+);", _tm, re.M).group(1))
_ws = data.web_search_of({"root": str(REPO)}, "swarm", {"name": "Small A"}, {})
_ws_lead = data.web_search_of({"root": str(REPO)}, "a", {"name": "Small A"}, {})
_srch = {"service": "SearXNG", "revision": "b867c56a5668966ef4be8097f1b559bdc2841743", "where": "served on the machine that measured, for the length of the run", "engines": ["brave", "duckduckgo"],
         "kept": "what each query returned and each page fetched, for the day: both models are given the same", "queries": 212, "pages": 40}
_pr3 = {"rule": "r", "margin": 0.05, "claims": {"notClaimed": []},
        "capabilities": [{"id": "search", "name": "Search", "tasks": ["bfcl_web_search_base"], "n": 100, "gap": -0.21, "gapStderr": 0.05, "verdict": "short", "proof": True, "margin": 0.05}],
        "results": [{"task": "bfcl_web_search_base", "name": "BFCL web search", "item": "search", "itemName": "Search", "metric": "accuracy", "harness": {"name": "bfcl-eval", "version": "2026.3.23"},
                     "n": 100, "of": 100, "swoa": {"value": 0.2, "stderr": 0.04}, "target": {"value": 0.41, "stderr": 0.05}, "gap": -0.21, "gapStderr": 0.05, "proof": True,
                     "tools": "search_engine_query and fetch_url_content, the search behind them a SearXNG served for the run (no key), each query and page kept for the day", "askedOn": "2026-11-19", "search": _srch}]}
_ws_m = data.web_search_of({"root": str(REPO)}, "swarm", {"name": "Small A"}, _pr3)
_row = lambda k, v: "<tr><th>%s</th><td>%s</td></tr>" % (k, v)  # noqa: E731
_wsb = swarm_ui.web_search_block({"interface": {"webSearch": _ws_m}}, _row)
_pb3 = swarm_ui.proof_block({"target": {"name": "T"}, "proof": _pr3})
_card3 = data.swoa_card({"swoa": {}, "target": {"name": "T"}, "proof": _pr3, "baseModule": {"members": {}, "decider": {}}, "runtime": {}})
_real = data.spec(_d)
check("the SwOA spec says what web search is to the module and how it is used: a tool the caller offers and runs, never something the module does; whose each of its four parts is; the three steps of using it; the limits the module keeps to, read from the runtime; and what the proof measured of it with the search behind the test. The dialog shows it, and a result of a test that searches names the search service on the page and on the card",
      "never something the module does" in _ws["is"] and set(_ws["components"]) == {"searchTool", "step", "search", "answer"}
      and [_ws["components"][k]["whose"] for k in ("searchTool", "step", "search", "answer")] == ["the caller's", "the module's", "the caller's", "the module's"]
      and len(_ws["howToUse"]) == 3 and "tool_call_id" in _ws["howToUse"][1] and "tools" in _ws["howToUse"][0]
      and _ws["limits"] == {"charactersOfOneResult": _each, "charactersOfAllResults": _all, "followsWhatAResultSays": False, "searchesByItself": False}
      and ("each result cut at %d characters, at most %d in all" % (_each, _all)) in _ws["components"]["answer"]["what"] and "opens no connection but to its own models" in _ws["components"]["search"]["what"]
      and str(_ws["measured"]).startswith("not measured on this SwOA yet") and "Small A alone" in _ws_lead["components"]["step"]["what"] and _ws_lead["limits"]["charactersOfOneResult"] is None
      and _ws_m["measured"] == {"capability": "search", "verdict": "short", "questions": 100, "gap": -0.21, "proof": True, "searchBehindTheTest": _srch}
      and "<h4>Web search</h4>" in _wsb and "How to use it" in _wsb and _wsb.count("<li>") == 3 and "the module never searches by itself" in _wsb and "searched through: SearXNG · revision b867c56a5668" in _wsb
      and "searched through: SearXNG · revision b867c56a5668 · served on the machine that measured, for the length of the run · engines that answered: brave, duckduckgo" in _pb3 and "asked 2026-11-19" in _pb3
      and 'search: "SearXNG b867c56a5668"' in _card3
      # (the swarm as this machine has it configured: the limits are the swarm's where it takes turns with tools, and none where one model does)
      and "webSearch" in _real["interface"] and _real["interface"]["webSearch"]["limits"]["charactersOfOneResult"] == (_each if _real["interface"]["capabilities"].get("toolsMode") == "swarm" else None) and "<h4>Web search</h4>" in swarm_ui.spec_panel(_d),
      [_ws["limits"], _ws_m["measured"], _wsb[:200]])

# WHAT A PASS ASKS MORE OF BECAUSE A PROOF FOUND THE MODULE SHORT (training/support/emphasis.mjs), as the page and the SwOA say it:
# the rule a verdict is read by is the same numbers on both sides (tests/run.mjs holds the same cases), a capability is the body of
# work that trains what a task measures, and a proof that weighted a pass is said to have, under the proof and on the card
_tg5 = json.loads((REPO / "training" / "equivalence.json").read_text())["targets"]
_g5 = data.paired_gap({"of": 500, "onlySwarm": 30, "onlyTarget": 80})
_st5 = {"focus": {"trap": 4, "rules": 2},
        "focusFrom": {"held": {"trap": 4}, "proof": {"at": "2026-11-20T10:00:00Z", "more": 2,
                                                      "short": [{"id": "instructions", "name": "Instructions", "n": 541, "gap": -0.1109, "gapStderr": 0.0197, "proof": True, "kinds": ["rules"]}],
                                                      "read": [{"id": "instructions", "verdict": "short", "n": 541, "gap": -0.1109}]}},
        "history": [{"pass": 1}, {"pass": 2, "proofRead": {"at": "2026-11-12T00:00:00Z", "short": ["math", "crew"]}}]}
_em5 = data.emphasis_of(_tg5, _st5)
_em5_old = data.emphasis_of(_tg5, {"focus": {"fix": 4}, "history": [{"pass": 1}]})
_em5_none = data.emphasis_of(_tg5, {"focus": {"fix": 2}, "focusFrom": {"held": {"fix": 2}, "proof": {"at": "2026-11-20T10:00:00Z", "more": 2, "short": [], "read": [{"id": "code", "verdict": "parity", "n": 500, "gap": -0.004}]}}})
_words5 = data.proof_read_words(_em5)
_mw5 = swarm_ui.more_words({"emphasis": _em5})
_card5 = data.swoa_card({"swoa": {}, "target": {"name": "T"}, "proof": {"results": [], "capabilities": []}, "baseModule": {"members": {}, "decider": {}}, "runtime": {}, "trainedAgainst": {"emphasis": _em5}})
_pb5 = swarm_ui.proof_block({"target": {"name": "T"}, "proof": {"rule": "r", "margin": 0.05, "capabilities": [], "results": []}, "trainedAgainst": {"emphasis": _em5}})
with _tf.TemporaryDirectory() as _t5:
    _r5 = Path(_t5)
    (_r5 / ".work" / "eval").mkdir(parents=True)
    _row5 = {"at": "2026-11-18T20", "runId": "r", "configuration": "c--t", "arrangementSha256": "A", "harness": "lm-evaluation-harness 0.4.13 and bfcl-eval 2026.3.23",
             "harnessId": {"name": "lm-evaluation-harness", "version": "0.4.13"}, "adapters": [], "results": [
                 {"task": "ifeval", "name": "IFEval", "item": "crew", "itemName": "The Crew", "metric": "m", "filter": "none",
                  "swarm": {"value": 0.7, "stderr": 0.04, "n": 120, "of": 541}, "target": {"value": 0.75, "stderr": 0.04, "n": 120, "of": 541}},
                 {"task": "bfcl_simple_python", "name": "BFCL one function", "item": "tools", "itemName": "Tools", "metric": "accuracy", "filter": "none",
                  "harnessId": {"name": "bfcl-eval", "version": "2026.3.23"}, "swarm": {"value": 0.9, "stderr": 0.02, "n": 150, "of": 400}, "target": {"value": 0.92, "stderr": 0.02, "n": 150, "of": 400},
                  "agree": {"of": 150, "same": 139, "onlySwarm": 5, "onlyTarget": 6}}]}
    (_r5 / ".work" / "eval" / "history.jsonl").write_text(json.dumps(_row5) + "\n")
    _p5 = data.swoa_proof({"root": str(_r5), "key": "c--t", "members": {}, "equivalence": {"targets": _tg5}}, "A", {})
_real5 = data.spec(_d)
# (the page of the made-up data, which has a plan in hand: a fresh clone has none, and what a pass asks is said with the plan)
_s5 = Path(tempfile.mkdtemp(prefix="swarm-check-emphasis-"))
sample.main(_s5, {"a": "lfm25-2.6b", "b": "bonsai2-2b", "decider": "kev-4b", "target": "nemotron35-30b"})
_args5 = swarm_ui.ARGS
swarm_ui.ARGS = _types.SimpleNamespace(root=str(_s5))
_plan5 = swarm_ui.plan_panel(data.load(_s5))
swarm_ui.ARGS = _args5
shutil.rmtree(_s5, ignore_errors=True)
parts5 = {
    "the rule": _g5["gap"] == -0.1 and _g5["gapStderr"] == 0.0205 and data.verdict_of(_g5["gap"], _g5["gapStderr"]) == "short" and data.verdict_of(-0.06, 0.0676) == "open" and data.verdict_of(-0.004, 0.0221) == "parity",
    "capability": data.capability_of(_tg5, "ifeval", "crew", "The Crew") == ("instructions", "Instructions") and data.capability_of(_tg5, "gsm8k", "math", "Math") == ("math", "Math")
                  and data.capability_of(_tg5, "not_listed", "crew", "The Crew") == ("crew", "The Crew") and data.capability_of([], "ifeval", "crew", "The Crew") == ("crew", "The Crew"),
    "in the proof": {x["task"]: x["item"] for x in _p5["results"]} == {"ifeval": "instructions", "bfcl_simple_python": "tools"} and sorted(c["id"] for c in _p5["capabilities"]) == ["instructions", "tools"]
                    and next(c["name"] for c in _p5["capabilities"] if c["id"] == "instructions") == "Instructions" and "Crew" not in json.dumps(_p5),
    "emphasis": _em5["kinds"] == {"trap": 4, "rules": 2} and _em5["fromHeld"] == {"trap": 4} and _em5["fromProof"]["short"][0]["name"] == "Instructions" and _em5["fromProof"]["more"] == 2
                and _em5["fromProof"]["readAt"] == "2026-11-20T10:00:00Z" and "never a question of the harness" in _em5["is"] and "Crew" not in json.dumps(_em5)
                and _em5["passesWeightedByAProof"] == [{"pass": 2, "proofAt": "2026-11-12T00:00:00Z", "short": ["Math", "Programming and its conversation"]}],
    "a record before it": _em5_old["fromHeld"] == {"fix": 4} and _em5_old["fromProof"] is None and _em5_old["passesWeightedByAProof"] == [] and data.proof_read_words(_em5_old) == "",
    "words": "pass 2 asked more of the kinds of Math, Programming and its conversation (the proof of 2026-11-12)" in _words5
             and "the pass in hand asks 2 more of each kind of Instructions, short by 0.111 on 541 questions (the proof of 2026-11-20)" in _words5 and "never a question of the harness" in _words5,
    "said under the proof": _words5 in _card5 and swarm_ui.e(_words5) in _pb5 and "Training has read" not in swarm_ui.proof_block({"target": {"name": "T"}, "proof": {"rule": "r", "capabilities": [], "results": []}})
                            and "Training has read" not in data.swoa_card({"swoa": {}, "target": {"name": "T"}, "proof": {"results": []}, "baseModule": {"members": {}, "decider": {}}, "runtime": {}}),
    "on the page": "This pass asks more of:" in _mw5 and "+4" in _mw5 and "The proof of 2026-11-20 found the swarm short on Instructions, by 0.111 on 541 questions: 2 more of each of its kinds." in _mw5
                   and "Only the verdict is read from a proof, never one of its questions." in _mw5 and swarm_ui.more_words({"emphasis": _em5_old}).startswith("This pass asks more of:")
                   and "proof" not in swarm_ui.more_words({"emphasis": _em5_old}) and swarm_ui.more_words({}) == ""
                   and "The proof of 2026-11-20 was read: no capability is short in it." in swarm_ui.more_words({"emphasis": _em5_none})
                   and "by the proof, where an evaluation has found a capability short" in _plan5,
    "in the SwOA": isinstance(_real5["trainedAgainst"]["emphasis"], dict) and set(_real5["trainedAgainst"]["emphasis"]) == {"is", "kinds", "fromHeld", "fromProof", "passesWeightedByAProof"},
}
check("what a pass asks more of is said with where it came from: the kinds its own held questions found the swarm short on, and the kinds of a capability a proof found it short on, with the proof's date, the gap and the questions it rests on; a verdict is read by the same rule and the same numbers as the proof on the page; a capability is the body of work that trains what a task measures (IFEval's is Instructions, though it is listed under The Crew), named by the work and never by a product, in the proof too; a record from before a proof was read is all from its held questions; and a proof that has weighted a pass is said to have, under the proof in the SwOA dialog, on the SwOA card and in the SwOA itself (trainedAgainst.emphasis), with what was read of it and what never is",
      all(parts5.values()), {k: v for k, v in parts5.items() if not v} or _words5)

# ---- WHY A PASS ENDED BEFORE IT TRAINED: the gate's refusal is said on the Train card, with what to change, and not after the judge
# has been changed
import tempfile as _tf6
_r6 = Path(_tf6.mkdtemp(prefix="gate-"))
_p6 = _r6 / ".work" / "train" / "cfg--tgt" / "pass-1"
_p6.mkdir(parents=True)
(_p6 / "status.txt").write_text("10:00:00 START 10-questions\n10:00:09 END   10-questions exit 3 0 min\n10:00:09 STOPPED: a kind of question has nothing to compare (see x)\n")
(_p6 / "10-questions.out").write_text("Comparable, by kind: fix 6/6, bug 0/6\nNOT TRAINED: bug (6 questions: the reader of answers in words is not believed); talk (6 questions: the reader of replies in a conversation is not believed).\nA pass would train nothing on them.\n")
(_p6.parent / "reader.json").write_text(json.dumps({"by": "kev-0.8b", "asked": 20, "right": 15, "need": 0.8, "ok": False}))
_d6 = {"key": "cfg--tgt", "decider": {"id": "kev-0.8b", "name": "Kev 0.8B"}, "judge": None, "registry": {"deciders": [{"id": "kev-0.8b", "name": "Kev 0.8B"}]}}
_args6 = swarm_ui.ARGS
swarm_ui.ARGS = _types.SimpleNamespace(root=str(_r6))
_g6 = swarm_ui.gate_stopped(_d6)
_g6_judge = swarm_ui.gate_stopped(dict(_d6, judge={"id": "jeffan-4b", "name": "Jeffan 4B"}))
(_p6 / "status.txt").write_text("10:00:00 START 10-questions\n")
_g6_running = swarm_ui.gate_stopped(_d6)
swarm_ui.ARGS = _args6
shutil.rmtree(_r6, ignore_errors=True)
check("a pass that ended before it trained anything says why on the Train card: how many kinds of question had nothing to grade them by and which, who judges whether two answers say the same and how it did on its check against what is needed, and where to choose another; nothing is said once the judge has been changed, or where the pass did not stop there",
      "<b>2</b> kinds of question (bug, talk)" in _g6 and "<b>Kev 0.8B</b> judges whether two answers say the same, and read 15 of the 20 test pairs correctly where 16 are needed." in _g6
      and "<b>Judges equivalence</b>" in _g6 and _g6_judge == "" and _g6_running == "", [_g6, _g6_judge, _g6_running])

# ---- MEMORY, MEASURED: where the pass in hand measured what the swarm takes, the card shows that and says so, with the estimate
_fp7 = data.footprint({"a": {"bytes": 2**30, "name": "Small A"}, "b": {"bytes": 2**30, "name": "Small B"}}, {"memGb": 5, "name": "Dec"}, {"memGb": 18, "name": "Big"})
_mem7 = {"a": {"name": "Small A"}, "b": {"name": "Small B"}}
_loop7 = {"cfg": "x+y+d", "memory": {"measured": {"members": {"a": 10.3, "b": 0.84}, "decider": 2.1, "swarm": 13.2}}}
_m7 = data.measured_footprint(_fp7, _loop7, "x+y+d", _mem7, {"memGb": 5, "name": "Dec"})
_m7_other = data.measured_footprint(_fp7, _loop7, "another", _mem7, {"memGb": 5, "name": "Dec"})
_m7_nodec = data.measured_footprint(_fp7, {"cfg": "x+y+d", "memory": {"measured": {"members": {"a": 10.3, "b": 0.84}, "swarm": 11.1, "without": "the decider"}}}, "x+y+d", _mem7, {"memGb": 5, "name": "Dec"})
_kept7 = {"config": "x+y+d", "members": {"a": 4.6, "b": 0.42}, "decider": 3.0, "swarm": 8.0, "at": "2026-11-19T17:11:00Z"}
_m7_kept = data.measured_footprint(_fp7, _loop7, "x+y+d", _mem7, {"memGb": 5, "name": "Dec"}, kept=_kept7)
_m7_kept_other = data.measured_footprint(_fp7, _loop7, "x+y+d", _mem7, {"memGb": 5, "name": "Dec"}, kept=dict(_kept7, config="another"))
_ll8 = swarm_ui.loop_live
swarm_ui.loop_live = lambda: None
_line7 = swarm_ui.progress_strip(dict(_d, footprint=_m7_kept, loop={"of": 5, "changes": [], "memory": {"swarm": 99, "target": 18, "saved": 1, "measured": {"swarm": 77, "target": 18, "saved": 2}},
                                                                   "families": [{"kind": "fix", "asked": 1, "own": True, "module": 1, "target": 1, "targetKnown": 1}], "list": [{"id": "a", "state": "at parity"}]}))
_line7e = swarm_ui.progress_strip(dict(_d, footprint=_fp7, loop={"of": 5, "changes": [], "families": [{"kind": "fix", "asked": 1, "own": True, "module": 1, "target": 1, "targetKnown": 1}], "list": [{"id": "a", "state": "at parity"}]}))
swarm_ui.loop_live = _ll8
# (one model in both places, its file's size on record: the measurement the trainer writes for a shared load)
_mem7s = {"a": {"name": "Small", "bytes": 2**30}, "b": {"name": "Small", "bytes": 2**30}}
_kept7s = {"config": "x+y+d", "members": {"a": 1.91, "b": 0}, "shared": {"b": "a"}, "without": "the decider", "swarm": 1.9}
_m7s = data.measured_footprint(_fp7, None, "x+y+d", _mem7s, None, kept=_kept7s)
_m7s_old = data.measured_footprint(_fp7, None, "x+y+d", _mem7s, None, kept=dict(_kept7s, members={"a": 0.95, "b": 0}, swarm=1))
_card7s = swarm_ui.memory_card({"footprint": _m7s})
# ---- THE THREE EVALUATIONS SIDE BY SIDE
_cmp_rows = {"base": {"limit": 50, "swarm": {"value": 0.60, "stderr": 0.02, "n": 800}, "target": {"value": 0.80, "stderr": 0.015, "n": 800}},
             "trained": {"limit": 50, "swarm": {"value": 0.68, "stderr": 0.02, "n": 800}, "target": {"value": 0.80, "stderr": 0.015, "n": 800}, "adapters": ["Small"]},
             # (a record from when pretraining had a figure of its own: it is not shown)
             "pretrained": {"limit": 50, "swarm": {"value": 0.10, "stderr": 0.02, "n": 800}, "target": {"value": 0.80, "stderr": 0.015, "n": 800}}}
_cmp_other = data.compare_of(dict(_cmp_rows, trained={"limit": 20, "swarm": {"value": 0.70, "stderr": 0.03, "n": 320}, "target": {"value": 0.80, "stderr": 0.02, "n": 320}}))
_cmp = data.compare_of(_cmp_rows)
_pair_rows = {"base": dict(_cmp_rows["base"], tasks=[{"task": "t", "bits": "1" * 400 + "0" * 400}]), "trained": dict(_cmp_rows["trained"], swarm={"value": 0.63, "stderr": 0.02, "n": 800}, tasks=[{"task": "t", "bits": "1" * 424 + "0" * 376}])}
_pair = data.compare_of(_pair_rows)
_cmp_near = data.compare_of(dict(_cmp_rows, trained=dict(_cmp_rows["trained"], swarm={"value": 0.63, "stderr": 0.02, "n": 800})))
_cmp_html = swarm_ui.eval_compare({"compare": _cmp})
_cmp_near_html = swarm_ui.eval_compare({"compare": _cmp_near})
check("the Evaluate card sets two evaluations side by side, always in their order: the module as configured, which is the baseline, and the module as trained (pretraining is no stage of its own, and a record of one from before is not shown); each is its score with its error, its share of the larger model's score and how many questions; the second says how it stands to the first, a gain or a loss only beyond twice the error of the difference and otherwise that no difference is shown; one asked at another size than the first is not compared; one not measured says so; and nothing is drawn where none was measured",
      [r["id"] for r in _cmp] == ["base", "trained"] and _cmp[1]["beyond"] is True and _cmp[1]["diff"] == 0.08 and _cmp_other[1]["sameQuestions"] is False and _cmp_other[1]["beyond"] is False
      and _cmp_near[1]["beyond"] is False and "a gain of 8 points" in _cmp_html.replace("8.0", "8") and "asked at another size than the first: not compared" in swarm_ui.eval_compare({"compare": _cmp_other}) and "Pretrained" not in _cmp_html
      and "no difference shown" in _cmp_near_html and "75% of the larger model" in _cmp_html.replace("75.0", "75") and "± 2" in _cmp_html.replace("2.0", "2")
      and [r["measured"] for r in data.compare_of({})] == [False, False] and swarm_ui.eval_compare({"compare": data.compare_of({})}) == ""
      and "not measured yet" in swarm_ui.eval_compare({"compare": data.compare_of({"base": _cmp_rows["base"]})})
      # (paired by question, a gain of 3 points that the two errors together would not show is shown, with how many questions moved)
      and _pair[1]["paired"] is True and _pair[1]["diff"] == 0.03 and _pair[1]["beyond"] is True and _pair[1]["better"] == 24 and _pair[1]["worse"] == 0
      and "24 questions better, 0 worse" in swarm_ui.eval_compare({"compare": _pair}), [_cmp, _cmp_html[:500]])
_cmp_t = lambda sw, n=400: [{"task": "t1", "name": "Task One", "swarm": {"value": sw, "stderr": 0.02, "n": n}, "target": {"value": 0.8, "stderr": 0.02, "n": n}},  # noqa: E731
                           {"task": "t2", "name": "Task Two", "swarm": {"value": sw - 0.1, "stderr": 0.02, "n": n}, "target": {"value": 0.8, "stderr": 0.02, "n": n}}]
_cmp_d = {"target": {"name": "Big"}, "compare": data.compare_of({"base": dict(_cmp_rows["base"], tasks=_cmp_t(0.6)), "trained": dict(_cmp_rows["trained"], tasks=_cmp_t(0.7))})}
_cd_t, _cd_p, _cd_c = (swarm_ui.compare_dialog(_cmp_d, v) for v in ("table", "paper", "chart"))
check("each dialog of the Evaluate card opens with the two evaluations, said its own way: Each task has a line for every task with the larger model's score and the two in their order, and a last line over every question; Paper table gives each score with its error and the best of the three in bold; Chart draws one bar for each on one scale with its error marked and a line where the larger model scored; one not measured is a dash or says so; and nothing is added where none was measured",
      all("The two evaluations" in x for x in (_cd_t, _cd_p, _cd_c)) and "Task One" in _cd_t and "Every question" in _cd_t and _cd_t.count("</th>") == 5 and ">Trained</th>" in _cd_t and "Pretrained" not in _cd_t
      and "±" in _cd_p and "<b>70" in _cd_p and "±" not in _cd_t.split("<tbody>")[1].split("</tbody>")[0] and _cd_c.count("cmpbar") >= 3 and "Big" in _cd_c
      and "not measured yet" in swarm_ui.compare_dialog({"target": {"name": "Big"}, "compare": data.compare_of({"base": dict(_cmp_rows["base"], tasks=_cmp_t(0.6))})}, "chart")
      and "a gain of 8" in _cd_t and swarm_ui.compare_dialog({"compare": data.compare_of({})}, "table") == "", [_cd_t[:400], _cd_c[:400]])
# ---- THE WHOLE RUN, ONE BUTTON
swarm_ui.CARD_STARTS = False
_bare = swarm_ui.main_body(_d)
swarm_ui.CARD_STARTS = True
_full = swarm_ui.main_body(_d)
check("only the Run card starts and stops: the Evaluate and Train cards are drawn without their own Start buttons, the chooser of a size and the button that asked again what fell short, and with them where the page is started to draw them; what else the cards hold is as it was",
      all('id="%s"' % i not in _bare for i in ("ev-go", "ev-size", "ev-narrow", "pre-go", "run-go", "ev-stop", "pre-stop", "run-stop")) and 'id="whole-go"' in _bare
      and all('id="%s"' % i in _full for i in ("ev-go", "ev-size", "run-go")) and "<h2>Evaluate the swarm</h2>" in _bare and "<h2>Pretrain</h2>" not in _bare and "<h2>Pretrain</h2>" not in _full, [len(_bare), len(_full)])
import tempfile as _tf9
_wr = Path(_tf9.mkdtemp())
(_wr / ".work" / "run" / "k" / "pass-1").mkdir(parents=True)
(_wr / ".work" / "run" / "k" / "pass-1" / "status.txt").write_text("10:00:00 START 1-evaluate-as-configured\n10:20:00 END   1-evaluate-as-configured exit 0 20 min\n10:20:00 START 2-make-adapters\n10:21:00 END   2-make-adapters exit 3 1 min\n"
                                                                  "10:21:00 START 3-train-classes\n")
_ws, _wdone = swarm_ui.whole_steps(_wr, "k")
_ws0, _ = swarm_ui.whole_steps(_wr, "none")
_root9 = swarm_ui.ARGS.root
swarm_ui.ARGS.root = str(_wr)
_wb = swarm_ui.whole_block({"key": "k"})
swarm_ui.ARGS.root = _root9
check("the whole run has one button: Run is the first card, with the size of its evaluations and Start; no box to tick for training, since whether a change betters the module is what training finds; (Carry on where a run was stopped part way); under it its four steps in order (the module as configured evaluated, an adapter made for each drafting slot, training, the trained module evaluated: pretraining is no stage of it), each done, running, not taken where it refused, failed or waiting, with how long it took; a step a stopped run left as running reads as stopped; and the page says the run has the models while it is between two steps",
      [x["state"] for x in _ws] == ["done", "not taken", "running", "waiting"] and [x["id"] for x in _ws] == ["1-evaluate-as-configured", "2-make-adapters", "3-train-classes", "4-evaluate-trained"] and _ws[0]["minutes"] == 20 and _wdone is False and all(x["state"] == "waiting" for x in _ws0)
      and 'id="whole-go"' in _wb and "Carry on" in _wb and 'id="whole-size"' in _wb and 'id="whole-train"' not in _wb and "Train the arrangement too" not in _wb and _wb.count('<li class="ws ') == 4 and "pretrain" not in " ".join(x["name"].lower() for x in _ws) and "stopped here" in _wb and "not taken" in _wb
      and html.index("<h2>Run Intelligence Training</h2>") < html.index("<h2>Run Conversation Training</h2>") < html.index("<h2>Memory saved</h2>") and '"whole": "training/run.sh"' in open(swarm_ui.__file__).read() and 'return "the run"' in open(swarm_ui.__file__).read(), [_ws, _wb[:300]])
_card7k = swarm_ui.memory_card({"footprint": _m7_kept})
_card7 = swarm_ui.memory_card({"footprint": _m7})
_card7e = swarm_ui.memory_card({"footprint": _fp7})
check("where the pass in hand measured what the swarm takes in memory, the card shows the measured size, its parts and the saving, says it was measured and what the estimate was; a measurement of another configuration is not used; a decider that could not be measured counts at its listed size and is said to; and with nothing measured the card says estimated, as before",
      _m7["measured"] is True and _m7["swarm"] == 13.2 and _m7["saved"] == 26.7 and _m7["estimate"] == 8.5 and [x["gb"] for x in _m7["parts"]] == [10.3, 0.84, 2.1]
      and _m7_other is _fp7 and _m7_nodec["swarm"] == 16.1 and _m7_nodec["deciderListed"] is True
      and "measured while it trained" in _card7 and "the estimate from the model files was 8.5 GB" in _card7 and "<b class=\"pct\">26.7%</b>" in _card7
      and "estimated from the model files and the listed sizes, not measured" in _card7e, [_m7, _card7[:300]])
check("a measured swarm is drawn in the parts an estimated one is: each model once at the size of its file, said to be in so many places where places share its load (a place that shares is not a part of 0 GB), and what its process holds besides as their contexts; the parts sum to what was measured; and a process measured smaller than its file (before the weights were counted) stays one part",
      [(x["name"], x["gb"], x["kind"]) for x in _m7s["parts"]] == [("Small, in 2 places", 1.0, "model"), ("Their contexts", 0.91, "contexts")]
      and _m7s["swarm"] == 1.9 and _m7s["saved"] == 89.4 and "Small, in 2 places <b>1 GB</b>" in _card7s and "Their contexts <b>0.9 GB</b>" in _card7s and "0 GB" not in _card7s.replace("1.0 GB", "")
      and [(x["name"], x["gb"]) for x in _m7s_old["parts"]] == [("Small, in 2 places", 0.95)], [_m7s["parts"], _m7s_old["parts"], _card7s[-400:]])
check("every memory figure on the page has one source: the newest measurement the trainer wrote while it ran is taken before the one in the pass's row (and never another configuration's); the line under Train and the Memory saved card say the same size and the same saving, whatever the pass's row holds; and the card is redrawn every half minute, as the line is",
      _m7_kept["swarm"] == 8.0 and _m7_kept["saved"] == 55.6 and _m7_kept["measuredAt"] == "2026-11-19T17:11:00Z" and _m7_kept_other["swarm"] == 13.2
      and "it takes <b>8.0 GB</b> of memory against 18 GB: <b>55.6%</b> saved" in _line7 and "<b class=\"pct\">55.6%</b>" in _card7k and "77" not in _line7 and "99 GB" not in _line7
      and "By its files it takes about <b>8.5 GB</b>" in _line7e and "(not measured yet)" in _line7e
      and "setInterval(()=>{if($('#memwrap'))swap('/fragment/memory','#memwrap');},30000);" in swarm_ui.JS and 'id="memwrap"' in swarm_ui.main_body(_d),
      [_m7_kept, _line7[-300:], _line7e[-200:]])

# ---- THE RECOMMENDATION COUNT IS NOT LEFT STALE: asked again when the dialog opens, and every half minute
check("the count of recommendations beside Configuration is asked for again when the dialog is opened and every half minute while it is closed, so it cannot say one over a dialog that has none",
      "$('#recd').showModal();" in swarm_ui.JS and swarm_ui.JS.count("swap('/fragment/recslot','#rec-slot')") >= 3
      and "setInterval(()=>{if(!$('#recd')||!$('#recd').open)swap('/fragment/recslot','#rec-slot');},30000);" in swarm_ui.JS, "")

# ---- STOP UNLOCKS THE PILLS: the page redraws them itself when Train or Stop training is pressed
check("pressing Train or Stop training redraws the model pills at once (locked while a session runs, open again when it is stopped), and the rest of the page when it has stopped: it is not left to the watch loop, which had already been shown the stopped card",
      "await swap('/fragment/picks','#picks');if(b.id==='run-stop'&&!$('#score [data-running]'))await swap('/fragment/body','#body');" in swarm_ui.JS, "")

# ---- A SMALL MODEL OF THE SWARM THAT CHOOSES AS WELL AS THE DECIDER is said among the recommendations, and can be reached
_root9 = Path(tempfile.mkdtemp(prefix="recs-"))
shutil.copytree(REPO / "src", _root9 / "src")
_d9 = data.load(_root9)
_wd9 = Path(_d9["root"]) / ".work" / "train" / _d9["key"]
_wd9.mkdir(parents=True, exist_ok=True)
_ma9 = (_d9["members"] or {}).get("a") or {}
(_wd9 / "decider-replay.json").write_text(json.dumps({"pass": 1, "against": (_d9.get("decider") or {}).get("id"), "results": [
    {"decider": _ma9.get("id"), "kind": "model", "place": "a", "name": _ma9.get("name"), "asked": 24, "theirsRight": 17, "nowRight": 15, "recovered": 5, "lost": 3, "failed": 0},
    {"decider": "weak", "kind": "model", "place": "b", "name": "Weak", "asked": 24, "theirsRight": 9, "nowRight": 15, "recovered": 1, "lost": 7, "failed": 0}]}))
_args9 = swarm_ui.ARGS
swarm_ui.ARGS = _types.SimpleNamespace(root=str(_root9))
_rs9 = swarm_ui.recommendations(_d9)
_r9 = next((r for r in _rs9 if str(r["id"]).startswith("model-decides:")), None)
_panel9 = swarm_ui.recs_panel(_d9)
_cfg9 = swarm_ui.config_section(_d9)
(_wd9 / "decider-replay.json").write_text(json.dumps({"pass": 1, "results": [{"decider": _ma9.get("id"), "kind": "model", "name": _ma9.get("name"), "asked": 6, "theirsRight": 6, "nowRight": 1, "recovered": 5, "lost": 0}]}))
_few9 = [r for r in swarm_ui.recommendations(_d9) if str(r["id"]).startswith("model-decides:")]
swarm_ui.ARGS = _args9
shutil.rmtree(_root9, ignore_errors=True)
check("where one of the swarm's own small models, put a pass's recorded choices as the decider, chose at least as well as the decision model on ten choices or more, the recommendations say so: which model, the counts, that the choices are rebuilt and a pass would tell, and what the swarm would save; the best such model only, never one that chose worse or one put fewer than ten choices; its button makes a swarm with no decision model",
      _r9 is not None and _r9["apply"] == {"decider": "none"} and _r9["n"] == 24 and "chooses better than" in _r9["title"] and (_ma9.get("name") or "") in _r9["title"]
      and "17 times against" in _r9["why"] and "recovered 5 and lost 3" in _r9["why"] and "a swarm with no decision model" in _r9["why"] and "saves the decision model" in _r9["cost"]
      and len([r for r in _rs9 if str(r["id"]).startswith("model-decides:")]) == 1 and "Weak" not in _panel9
      and "Make this change" in _panel9 and 'id="rec-open"' in _cfg9 and _few9 == [],
      [_r9, _cfg9[:200]])

# ---- AN ENGINE INSTALLED HERE THAT IS BEHIND is said among the recommendations, as something a person does outside the page
_root11 = Path(tempfile.mkdtemp(prefix="engines-"))
shutil.copytree(REPO / "src", _root11 / "src")
(_root11 / ".work").mkdir()
(_root11 / ".work" / "engines.json").write_text(json.dumps({"tensorfold": {"tag": "v1.3.1", "at": time.time()}}))
_d11 = data.load(_root11)
_said11 = {"/fake/tensorfold": "tensorfold-native 1.2.7", "/fake/llama-server": "version: 0.9.0 (build 12110, commit abc)"}
_keep11 = (swarm_ui.ENGINES_SEEN, swarm_ui.ENGINE_LOOKUP, swarm_ui.engine_said, swarm_ui.program_of, shutil.which, swarm_ui.ARGS)
swarm_ui.ARGS = _types.SimpleNamespace(root=str(_root11))
swarm_ui.engine_said = lambda p: _said11.get(p, "")
swarm_ui.program_of = lambda serve: "/fake/tensorfold" if (serve or {}).get("program") == "tensorfold" else ""
shutil.which = lambda n: "/fake/llama-server" if n == "llama-server" else None
_off11 = swarm_ui.engine_recommendations(_d11)
swarm_ui.ENGINES_SEEN = True
_on11 = swarm_ui.engine_recommendations(_d11)
_panel11 = swarm_ui.recs_panel(_d11)
# (an update that is going is followed on its button; one that failed says why and can be tried again; one whose process is
# gone and never said how it ended has failed)
_eng11 = _root11 / ".work" / "engine"
_eng11.mkdir()
(_eng11 / "update-llama.json").write_text(json.dumps({"id": "llama", "pid": os.getpid(), "phase": "running", "step": "Checking that Bonsai 2 4B still answers"}))
_going11 = swarm_ui.recs_panel(_d11)
_busy11 = swarm_ui.engine_update_start(_root11, "tensorfold")
(_eng11 / "update-llama.json").write_text(json.dumps({"id": "llama", "pid": os.getpid(), "phase": "failed", "step": "Bonsai 2 4B does not answer with build 12359: the build that was here is kept"}))
_failed11 = swarm_ui.recs_panel(_d11)
(_eng11 / "update-llama.json").write_text(json.dumps({"id": "llama", "pid": 2 ** 22 + 12345, "phase": "running", "step": "Fetching"}))
_gone11 = swarm_ui.engine_update_state(_root11, "llama")
(_eng11 / "chosen").write_text(str(_eng11 / "update-llama.json"))
_chosen11 = swarm_ui.llama_here(_root11)
(_eng11 / "chosen").unlink()
_said11["/fake/tensorfold"] = "tensorfold-native 1.3.1"
_said11["/fake/llama-server"] = "version: 0.9.1 (build %s)" % _d11["registry"]["engine"]["tag"].lstrip("b")
_cur11 = swarm_ui.engine_recommendations(_d11)
(_root11 / ".work" / "engines.json").unlink()
_said11["/fake/tensorfold"] = "tensorfold-native 1.2.7"
_said11["/fake/llama-server"] = "version: 0.9.0 (build 12110, commit abc)"
_unknown11 = swarm_ui.engine_recommendations(_d11)
swarm_ui.ENGINES_SEEN, swarm_ui.ENGINE_LOOKUP, swarm_ui.engine_said, swarm_ui.program_of, shutil.which, swarm_ui.ARGS = _keep11
shutil.rmtree(_root11, ignore_errors=True)
_tf11 = next((r for r in _on11 if r["id"].startswith("engine:tensorfold")), None)
_ll11 = next((r for r in _on11 if r["id"].startswith("engine:llama")), None)
check("an engine installed here that is behind is said among the recommendations, with a button that updates it: the larger model's engine against the newest release the page last learned of (with the command its maker documents, where its notes are, and that the next Evaluate asks the larger model again), and llama.cpp against the build the catalog pins (fetched beside the one here and made the swarm's only where every model answers with it); the button follows the update, says why one failed and can be pressed again, and no second update or unknown engine is started; nothing is said where the engine is current, where the newest is not known, or where the page is only being checked; and nothing is asked of the network by a check",
      _off11 == [] and _tf11 is not None and _ll11 is not None and _tf11["apply"] is None and _tf11["yours"] is True
      and "from 1.2.7 to 1.3.1" in _tf11["title"] and "TensorFold" in _tf11["title"] and "curl -fsSL https://tensorfold.dev/install.sh | sh" in _tf11["why"] and "release notes" in _tf11["why"] and "asks" in _tf11["why"]
      and "from build 12110 to" in _ll11["title"] and "The engines on this machine" in _panel11 and "For you" in _panel11 and "Make this change" not in _panel11.split("The engines on this machine")[1]
      and _tf11["update"] == "tensorfold" and _ll11["update"] == "llama" and "Bonsai 2" not in _ll11["why"] and "a newer model can need support a build lacks" in _ll11["why"] and "does not touch" in _ll11["why"]
      and 'data-engine-update="tensorfold">Update</button>' in _panel11 and 'data-engine-update="llama">Update</button>' in _panel11 and _panel11.count("<progress") == 2 and _panel11.count('class="engp" hidden') == 2
      and 'btn top busy" data-engine-update="llama" disabled>Updating</button><progress class="engp"></progress><small class="engs">Checking that Bonsai 2 4B still answers' in _going11
      and "being updated already" in _busy11 and swarm_ui.engine_update_start(_root11, "rm -rf") == "No engine of that name."
      and 'data-engine-update="llama">Try again</button>' in _failed11 and "the build that was here is kept" in _failed11
      and _gone11["phase"] == "failed" and _gone11["running"] is False and _gone11["step"].startswith("It ended before it finished")
      and _chosen11.endswith("update-llama.json") and "engineWatch" in swarm_ui.JS and "'/engine/update'" in swarm_ui.JS and "Complete" in swarm_ui.JS
      and _cur11 == [] and [r["id"] for r in _unknown11] == [_ll11["id"]] and swarm_ui.ENGINE_LOOKUP is False
      and swarm_ui.version_in("b12359") == ("b12359", (12359,)) and swarm_ui.version_in("v1.3.1") == ("1.3.1", (1, 3, 1)) and swarm_ui.version_in("none") == ("", ()),
      [_on11, _cur11, _unknown11])

# ---- WHAT SERVES A MODEL is said beside it: in the list of models to choose from, and on the pill of the one chosen
_d12 = data.load(REPO)
swarm_ui.ARGS = _types.SimpleNamespace(root=str(REPO))
# (with TensorFold on the machine, and without: the checks say which, whatever this machine has)
_tf12 = REPO / "tensorfold-fake"
_tf12.write_text("")
os.environ["SWARM_TENSORFOLD"] = str(_tf12)
_p12_with = swarm_ui.pills(_d12)
os.environ["SWARM_TENSORFOLD"] = ""
# (without it: on an Apple silicon Mac it can be chosen and is installed when training starts; on any other machine it cannot)
_p12_mac = swarm_ui.pills(dict(_d12, machine=["mac"]))
_p12 = swarm_ui.pills(dict(_d12, machine=[]))
del os.environ["SWARM_TENSORFOLD"]
_small12 = _d12["registry"]["small"]
_a12 = _d12["members"]["a"]
check("what serves a model is said beside it: every small model of the catalog names its engine, and in the list each one that is not the one chosen says it after its size; a model both engines serve has an entry for each, TensorFold's chosen on an Apple silicon Mac (where TensorFold is not there yet the list says it is installed when training starts) and nowhere else; the pill of the one chosen says it beside its size and in its title; the larger model's says its own engine; a decision model's does not (it is served as its recipe says)",
      all(m.get("engine") in ("llama", "tensorfold") for m in _small12) and not any(m.get("alsoOn") for m in _small12)
      and [m["id"] for m in _small12 if m.get("engine") == "tensorfold"] == ["qwen35-2b-mlx", "lfm3-1.7b-mlx"]
      # (a model TensorFold serves has an entry of its own beside the GGUF's, and can be chosen only where TensorFold is)
      and re.search(r'<option value="lfm3-1\.7b-mlx">LFM3 1\.7B · [\d.]+ GB · TensorFold</option>', _p12_with) is not None
      and re.search(r'<option value="lfm3-1\.7b-mlx" disabled>LFM3 1\.7B · [\d.]+ GB · TensorFold · needs an Apple silicon Mac with TensorFold</option>', _p12) is not None
      and re.search(r'<option value="lfm3-1\.7b">LFM3 1\.7B · [\d.]+ GB · llama\.cpp</option>', _p12) is not None
      and re.search(r'<option value="lfm3-1\.7b-mlx">LFM3 1\.7B · [\d.]+ GB · TensorFold · installed when training starts</option>', _p12_mac) is not None
      and "installed when training starts" not in _p12_with and "installed when training starts" not in _p12
      and re.search(r'<option value="qwen35-2b"[^>]*>Qwen3\.5 2B · [\d.]+ GB · llama\.cpp</option>', _p12) is not None
      and re.search(r'<option value="qwen35-2b-mlx">Qwen3\.5 2B · [\d.]+ GB · TensorFold</option>', _p12_with) is not None
      and re.search(r'<option value="jan-code-4b"[^>]*>Jan-Code 4B · [\d.]+ GB · llama\.cpp</option>', _p12) is not None
      and ('title="Small model 1: %s' % _a12["name"]) in _p12 and ", served by llama.cpp" in _p12 and re.search(r"<i>[\d.]+ GB · llama\.cpp</i>", _p12) is not None
      and "GB · TensorFold</i>" in _p12 and "index" in _p12 and not re.search(r'<option value="kev-4b"[^>]*>[^<]*llama\.cpp', _p12),
      re.findall(r"<i>[^<]*</i>", _p12))

# ---- THE UNINSTALL HELPER'S LIST IS THE WHOLE OF .work: nothing in it goes unlisted
_root13 = Path(tempfile.mkdtemp(prefix="tidy-"))
shutil.copytree(REPO / "src", _root13 / "src")
shutil.copytree(REPO / "training", _root13 / "training", ignore=shutil.ignore_patterns("questions"))
_w13 = _root13 / ".work"
for _f, _text in (("models/Jan-code-4b-Q4_K_M.gguf", "g" * 10), ("models/LFM3-1.7B-MLX-4bit/model.safetensors", "m" * 20), ("models/LFM3-1.7B-MLX-4bit/config.json", "{}"),
                  ("tf-try/hf/blob", "t" * 30), ("class-train/report.json", "{}"), ("engines.json", "{}"), ("decider/port", "8009"), ("engine/update-llama.log", "x"),
                  ("train/measured/a.json", "{}"), ("train/k--t/plan.json", "{}"), ("eval/history.jsonl", "{}"), ("eval/target/x/answers", "a"), ("library/k--t-policy.json", "{}")):
    (_w13 / _f).parent.mkdir(parents=True, exist_ok=True)
    (_w13 / _f).write_text(_text)
_d13 = data.load(_root13)
_inv13 = cleanup.inventory(_root13, _d13)
_listed13 = {os.path.realpath(q) for x in _inv13 for q in x["paths"]}
_unlisted13 = [str(q) for q in _w13.rglob("*") if q.is_file() and not any(os.path.realpath(q) == k or os.path.realpath(q).startswith(k + os.sep) for k in _listed13)]
_by13 = {x["id"]: x for x in _inv13}
_no13 = cleanup.remove(_root13, _d13, "kept:records")
_yes13 = cleanup.remove(_root13, _d13, "left:tf-try")
shutil.rmtree(_root13, ignore_errors=True)
check("the Uninstall Helper lists the whole of the work folder: a model that is a folder of files by its name; a folder it does not know by name (a trial's downloads) on a line of its own, which can be removed; the small files beside the folders; and what is left inside the folders it names (what training learned, the last results, the pass in hand), said with its size and not removed from here, the folder of learned records never offered as an unknown one; no file in the work folder is under no line",
      _unlisted13 == [] and _by13["model:LFM3-1.7B-MLX-4bit"]["what"] == "Small model: LFM3 1.7B" and _by13["model:LFM3-1.7B-MLX-4bit"]["bytes"] > 0 and str(_by13["model:LFM3-1.7B-MLX-4bit"]["paths"][0]).endswith("LFM3-1.7B-MLX-4bit")
      and _by13["left:tf-try"]["group"] == "Other things in .work" and _by13["left:tf-try"]["removable"] and "left:class-train" in _by13 and "left:files" in _by13
      and _by13["kept:records"]["removable"] is False and _by13["kept:records"]["bytes"] > 0 and _no13[0] is False and _no13[1].startswith("That is not removed from here")
      and _yes13[0] is True and "engine" in _by13
      # (the folder of what was learned is never offered as one not known by name, even with nothing in it this list names)
      and "left:library" not in _by13 and "left:train" not in _by13 and any(str(q).endswith("library") for q in _by13["kept:records"]["paths"]),
      [_unlisted13, sorted(_by13), _no13, _yes13])

# ---- A RUN IS RUNNING ONLY WHILE ITS OWN PROCESS IS: an id is given again when its process has ended
import subprocess as _sp10
_p10 = _sp10.Popen([sys.executable, "-c", "import time; time.sleep(8)", "training/evaluate.sh"])
time.sleep(0.3)
_mine10 = _ours_real(_p10.pid, swarm_ui.RUN_MARKS["eval"])
_other10 = _ours_real(_p10.pid, swarm_ui.RUN_MARKS["train"])
_self10 = _ours_real(os.getpid(), swarm_ui.RUN_MARKS["eval"])
_r10 = Path(tempfile.mkdtemp(prefix="alive-"))
(_r10 / ".work" / "eval").mkdir(parents=True)
(_r10 / ".work" / "train").mkdir(parents=True)
_args10 = swarm_ui.ARGS
swarm_ui.ARGS = _types.SimpleNamespace(root=str(_r10))
_keep10 = swarm_ui._ours
swarm_ui._ours = _ours_real
# (the id of a live process that is NOT an evaluation: this one. Before, that alone read as an evaluation running)
(_r10 / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "then"}))
(_r10 / ".work" / "eval" / "live.json").write_text(json.dumps({"phase": "done", "step": "Done: the same answer on 280 of 460 questions", "tasks": []}))
_stale10 = swarm_ui.job_live("eval")
(_r10 / ".work" / "eval" / "ui-run.json").write_text(json.dumps({"pid": _p10.pid, "at": "now"}))
_live10 = swarm_ui.job_state("eval")
(_r10 / ".work" / "train" / "ui-run.json").write_text(json.dumps({"pid": os.getpid(), "at": "then"}))
_run10 = swarm_ui.run_state()
swarm_ui._ours = _keep10
swarm_ui.ARGS = _args10
_p10.kill()
shutil.rmtree(_r10, ignore_errors=True)
_prog10 = swarm_ui.ev_progress({"tasks": [{"target": {"done": 20, "of": 20}, "swarm": {"done": 5, "of": 20}}, {"target": {"done": 0, "of": 20}, "swarm": {"done": 0, "of": 20}}]})
# the swarm says how long a task is only when its turn comes: the larger model's count stands for it, so the whole is known
_prog10_wait = swarm_ui.ev_progress({"tasks": [{"target": {"state": "kept", "done": 20, "of": 20}, "swarm": {"done": 20, "of": 20}}, {"target": {"done": 20, "of": 20}, "swarm": {"done": 6, "of": 20}},
                                               {"target": {"done": 20, "of": 20}, "swarm": {"state": "waiting", "done": 0, "of": None}}]})
_prog10_open = swarm_ui.ev_progress({"tasks": [{"target": {"done": 7, "of": None}, "swarm": {"done": 0, "of": None}}]})
check("a run this page started is running only while its own process is: a process is the run's where its command line still names what was started, so an id that has since gone to another program is not a run (an evaluation that ended the night before had read as running, with a Stop button that would have signalled that program), and neither is a training session's; and a running evaluation says how far it is in all in the headline's own unit, the questions both models have answered of all it will ask (691 answers beside a headline of 460 questions did not add up), with the share where the whole is known",
      _mine10 is True and _other10 is False and _self10 is False and _stale10["running"] is False and _stale10["phase"] == "done" and _live10["running"] is True and _run10["running"] is False
      and _prog10 == "5 of 40 questions finished · 13%" and _prog10_open == "" and _prog10_wait == "26 of 60 questions finished · 43%" and swarm_ui.ev_progress({}) == ""
      and 'data-ev="prog"' in swarm_ui.JS + open(swarm_ui.__file__).read() and "set('prog'," in swarm_ui.JS,
      [_mine10, _other10, _self10, _stale10.get("running"), _live10.get("running"), _run10.get("running"), _prog10, _prog10_open, _prog10_wait])

# ---- A SECOND LOOK AT WHAT FELL SHORT: what was not asked again is carried and marked, what was has its figure from before
def _row11(task, item, sw, tg, n=20):
    both = min(sw, tg)
    return {"item": item, "task": task, "name": task, "target": {"value": tg / n, "n": n}, "swarm": {"value": sw / n, "n": n},
            "agree": {"of": n, "same": n - (sw - both) - (tg - both), "bothRight": both, "bothWrong": n - sw - tg + both, "differ": (sw - both) + (tg - both), "onlyTarget": tg - both, "onlySwarm": sw - both, "examples": []}}


_d11 = {"key": "k", "target": {"name": "Big"}, "members": {}, "equivalence": {"asked": ["math", "code"], "targets": [
    {"id": "math", "name": "Math", "kinds": ["chain"], "benchmarks": [{"task": "gsm", "name": "GSM", "metric": "exact_match", "compare": "answer"}]}, {"id": "code", "name": "Code", "kinds": ["fix"], "benchmarks": [{"task": "he", "name": "HE", "metric": "pass@1", "compare": "verdict"}]}]}}
_full11 = {"at": "2026-11-19T10:00:00Z", "configuration": "k", "adapters": [], "limit": 20, "target": "Big", "results": [_row11("gsm", "math", 8, 16), _row11("he", "code", 15, 10)]}
_full11["results"][0]["unread"] = {"target": 0, "swarm": 9}
_narrow11 = {"at": "2026-11-19T12:00:00Z", "configuration": "k", "adapters": [], "limit": 20, "target": "Big", "results": [_row11("gsm", "math", 12, 16)]}
_other11 = {"at": "2026-11-19T11:00:00Z", "configuration": "other", "adapters": [], "limit": 20, "target": "Big", "results": [_row11("he", "code", 1, 10)]}
_keep11, _args11 = swarm_ui._eval_rows, swarm_ui.ARGS
swarm_ui.ARGS = type("A", (), {"root": tempfile.mkdtemp()})()
_d11["root"] = swarm_ui.ARGS.root
swarm_ui._eval_rows = lambda root: [_full11]
_v_full = swarm_ui.eval_view(swarm_ui.ARGS.root, _d11)
_blk_full = swarm_ui.eval_block(_d11)
_tab_full = swarm_ui.eval_table(_d11)
# (the same evaluation as a paper's table and as two points: each benchmark by name with its error, a last line over every
# question, the table as LaTeX; and a point for each model where what each holds in memory is known, none where it is not)
_pap11 = swarm_ui.eval_paper(_d11)
# (the chart shows every lineup evaluated against the larger model: this fixture's one, under a key that names that model)
_dc11 = dict(_d11, key="k--t", target={"id": "t", "name": "Big"}, footprint={"swarm": 4.0, "target": 16.0, "share": 25.0})
swarm_ui._eval_rows = lambda root: [dict(_full11, configuration="k--t")]
_cht11 = swarm_ui.eval_chart(_dc11)
_cht_none11 = swarm_ui.eval_chart(dict(_dc11, footprint={}))
swarm_ui._eval_rows = lambda root: [_full11]
check("the evaluation's results as a paper sets them out, and as score against memory: a caption, each benchmark with both scores and their standard errors, the higher in bold, a line over every question and the table as LaTeX; and a point for each of the two, named, where their memory is known",
      "<b>Table 1.</b>" in _pap11 and "± is one standard error" in _pap11 and 'class="pall"><td>All questions</td><td>40</td>' in _pap11 and "<small>± " in _pap11 and "\\begin{tabular}{lrrrr}" in _pap11 and "\\toprule" in _pap11 and 'id="evd-copy"' in _pap11
      and _cht11.count('<text class="pn"') == 2 and "while holding 25% of its memory (4 GB against 16 GB)" in _cht11 and "<em>configured now</em>" in _cht11 and '<li class="mine" data-pt="' in _cht11 and 'role="button" tabindex="0" aria-pressed="true"' in _cht11 and _cht11.count('<g data-pt="') == _cht11.count('<li class="mine" data-pt="') + _cht11.count('<li data-pt="') + _cht11.count('<li class="mine tgt" data-pt="') and "chartLine" in swarm_ui.JS and "svg g[data-pt].off{display:none}" in swarm_ui.CSS and 'role="img"' in _cht11
      and 'r="15" fill="none"' in _cht11 and "<em>the larger model, configured now</em>" in _cht11 and 'stroke="var(--tgt)" stroke-width="2"/>' in _cht11 and 'class="mine tgt"' in _cht11 and "No lineup has been evaluated yet." in _cht_none11 and 'id="evd-cfg"' not in _cht11
      # (the chart's scores are of one thing at a time: every question, or one benchmark by the name it is known by; a benchmark
      # of several tasks is the mean of its tasks; a result of fewer than a hundred questions of a task says it is a quick look)
      and swarm_ui.bench_groups([{"benchmarks": [{"task": "a", "name": "BBH one"}, {"task": "b", "name": "HumanEval"}]}, {"benchmarks": [{"task": "c", "name": "BBH two"}]}]) == [("bbh", "BBH", ["a", "c"]), ("humaneval", "HumanEval", ["b"])]
      and swarm_ui.proof_sized({"agree": {"of": 100}}) and swarm_ui.proof_sized({"agree": {"of": 20}, "swarm": {"of": 20}}) and not swarm_ui.proof_sized({"agree": {"of": 20}, "swarm": {"of": 164}})
      and [round(x, 1) for x in swarm_ui._ev_mean([{"agree": {"of": 10, "bothRight": 5, "onlySwarm": 0, "onlyTarget": 5}}, {"agree": {"of": 30, "bothRight": 30, "onlySwarm": 0, "onlyTarget": 0}}])] == [75.0, 100.0, 40]
      and 'data-evd-bench="" aria-pressed="true"' in _cht11 and "Over every question shown (this project&#39;s own mix of tasks)" in _cht11 and "is a quick look" in _cht11
      and "closest('[data-evd-bench]')" in swarm_ui.JS and "async function evdShow()" in swarm_ui.JS and "ev.target.id==='evd-cfg'" in swarm_ui.JS and "'&cfg='+encodeURIComponent(dg.dataset.cfg||'')" in swarm_ui.JS
      # (each small model by itself, where an evaluation asked it so: a point of its own on the chart at its own memory, a
      # column of its own in the paper's table, and a sentence setting the swarm beside the best of them; where none was
      # asked the chart says so; a model that answered some of the tasks and not others is not shown)
      and "No small model has been evaluated by itself on these tasks yet" in _cht11 and "alone</th>" not in _pap11
      and swarm_ui.alone_keys([{"alone": {"a": {"name": "A", "value": 0.5}, "b": {"name": "B", "value": 0.2}}}, {"alone": {"a": {"name": "A", "value": 0.7}}}]) == [("a", "A")]
      and swarm_ui.alone_keys([{"alone": {"a": {"name": "A", "value": 0.5}}}, {}]) == []
      and [round(x, 1) for x in swarm_ui.alone_score([{"alone": {"a": {"value": 0.5, "stderr": 0.1}}, "agree": {"of": 10}}, {"alone": {"a": {"value": 1.0, "stderr": 0}}, "agree": {"of": 30}}], "a")] == [87.5, 5.2, 40]
      and "live.alone[who] + ' by itself'" in (Path(swarm_ui.__file__).resolve().parent.parent / "training" / "evaluate.mjs").read_text() and "s.alone[n.who]+' by itself'" in swarm_ui.JS, [_pap11[-600:], _cht11[-400:]])
# (the same fixture where each of two small models answered by itself)
import copy as _copy
_al11 = _copy.deepcopy(_full11)
for _i, _r in enumerate(_al11["results"]):
    _r["alone"] = {"a": {"id": "ma", "name": "Mini A", "value": 0.25, "stderr": 0.1, "n": 20}, "b": {"id": "mb", "name": "Mini B", "value": 0.5, "stderr": 0.1, "n": 20}}
_al11["configuration"] = "k--t"
swarm_ui._eval_rows = lambda root: [_al11]
_dal11 = dict(_d11, key="k--t", target={"id": "t", "name": "Big"}, footprint={"swarm": 4.0, "target": 16.0, "share": 25.0, "parts": [{"name": "Mini A", "gb": 1.0, "kind": "model", "place": "a"}, {"name": "Mini B", "gb": 2.0, "kind": "model", "place": "b"}, {"name": "Their contexts", "gb": 1.0, "kind": "contexts"}]})
_chal11, _paal11 = swarm_ui.eval_chart(_dal11), swarm_ui.eval_paper(_dal11)
check("where an evaluation asked each small model by itself, the chart has a point for each at its own memory beside the swarm and the larger model, and says the swarm's score beside the best of them; and the paper's table has a column for each",
      _chal11.count('<text class="pn"') == 4 and '<ol class="lgl">' in _chal11 and _chal11.count("</li>") == 4 and 'class="lb"' not in _chal11
      and re.search(r'<li data-pt="\d+" role="button" tabindex="0" aria-pressed="true" title="[^"]+"><i style="background:[^"]+">\d</i><b>Mini B by itself</b><span>50% · 2\.5 GB · 40 questions of 2 tasks</span>', _chal11) is not None and "<title>Mini A by itself: 25% of 40 questions, 1.5 GB</title>" in _chal11 and "<title>Mini B by itself: 50% of 40 questions, 2.5 GB</title>" in _chal11
      and '<th class="num evm">Mini A alone</th><th class="num evm">Mini B alone</th><th class="num">The swarm</th>' in swarm_ui.eval_table(_dal11) and '<td class="num evm">25%</td><td class="num evm">50%</td>' in swarm_ui.eval_table(_dal11) and "evt-m" not in _tab_full
      and "By itself, the best of its models (Mini B) scored 50%" in _chal11 and "<th>Mini A alone</th><th>Mini B alone</th><th>The swarm</th>" in _paal11 and "lrrrrrr" in _paal11 and "Each small model is also shown by itself" in _paal11,
      [_chal11[-500:], _paal11[:300]])
swarm_ui._eval_rows = lambda root: [_full11]
# (a lineup with no evaluation of its own can still open the three views: they show another lineup's, chosen in the dialog)
_regz = json.loads((REPO / "src" / "models.json").read_text())
_dz = dict(_d11, registry=_regz, target=_regz["targets"][0], key="%s+%s+none--%s" % (_regz["small"][0]["id"], _regz["small"][1]["id"], _regz["targets"][0]["id"]))
_smz = [m["id"] for m in _regz["small"]]
_okz = "%s+%s+none--%s" % (_smz[-1], _smz[-1], _dz["target"]["id"])
swarm_ui._eval_rows = lambda root: [dict(_full11, configuration=_okz, target=_dz["target"]["name"])]
_tz, _bz = swarm_ui.eval_table(_dz), swarm_ui.eval_block(_dz)
_lz = swarm_ui.lineup_of(_dz, _okz)
check("the three views of an evaluation can show any lineup evaluated against this larger model: where the lineup configured now has none, its card still has the three buttons, the dialog opens on the lineup configured now, says it has not been evaluated and how to go on, and has a box to choose another, which then shows that one's evaluation, and a lineup of one model in two places is named so",
      _okz != _dz["key"] and 'data-evd-view="chart"' in _bz and "not evaluated yet" in _bz and 'id="evd-cfg"' in _tz and "This lineup: " in _tz and "(not evaluated yet)</option>" in _tz
      and ('<option value="%s" selected>' % _dz["key"]) in _tz and ('<option value="%s">' % _okz) in _tz and "is the lineup configured now, and it has not been evaluated yet" in _tz
      and "or choose another lineup above to see its evaluation" in _tz and ('<option value="%s" selected>' % _okz) in swarm_ui.eval_table(_dz, cfg=_okz) and "has not been evaluated yet" not in swarm_ui.eval_table(_dz, cfg=_okz)
      and swarm_ui.lineup_name(_lz).endswith(", 2 of it") and swarm_ui.lineup_of(_dz, "nothing+none--x") is None
      and [k for k, _, _ in swarm_ui.evaluated_lineups(_dz)] == [_okz], [_tz[:400]])
# (the arrangement a lineup started from, beside the one training kept: a line of its own in the views, each named for what it is)
swarm_ui._eval_rows = lambda root: [dict(_full11, configuration=_okz, target=_dz["target"]["name"], arrangement="default", at="2026-11-21T10:00:00.000Z"),
                                    dict(_full11, configuration=_okz, target=_dz["target"]["name"], arrangement="trained", at="2026-11-21T20:00:00.000Z")]
_both = swarm_ui.evaluated_lineups(_dz)
swarm_ui._eval_rows = lambda root: [dict(_full11, configuration=_okz, target=_dz["target"]["name"], arrangement="default", at="2026-11-21T10:00:00.000Z")]
_only_default = swarm_ui.evaluated_lineups(_dz)
_evb = swarm_ui.eval_block(_dz)
check("where a lineup has an evaluation of the arrangement it started from and a later one of what training kept, the views hold both, named trained and default arrangement; one evaluation alone is named plainly; and the Evaluate card has no box for which arrangement: an evaluation from the page is of the module as it is, read against the module as configured",
      [k for k, _, _ in _both] == [_okz, _okz + swarm_ui.DEFAULT_MARK] and swarm_ui.lineup_name(_both[0][1]).endswith(", trained") and swarm_ui.lineup_name(_both[1][1]).endswith(", default arrangement")
      and _both[1][2]["arrangement"] == "default" and _both[0][2]["arrangement"] == "trained"
      and [k for k, _, _ in _only_default] == [_okz] and not swarm_ui.lineup_name(_only_default[0][1]).endswith("arrangement")
      and 'id="ev-default"' not in _evb and "The arrangement it started from" not in _evb
      and "arrangement:'default'" not in swarm_ui.JS and '["--default"]' in open(os.path.join(os.path.dirname(os.path.abspath(swarm_ui.__file__)), "swarm_ui.py")).read(), [[k for k, _, _ in _both]])
swarm_ui._eval_rows = lambda root: [_full11]
swarm_ui._eval_rows = lambda root: [_full11, _other11, _narrow11]
_v11 = swarm_ui.eval_view(swarm_ui.ARGS.root, _d11)
_tab11 = swarm_ui.eval_table(_d11)
_blk11 = swarm_ui.eval_block(_d11)
swarm_ui._eval_rows = lambda root: [_full11, dict(_narrow11, results=[_row11("gsm", "math", 16, 16)])]
_v_level = swarm_ui.eval_view(swarm_ui.ARGS.root, _d11)
_blk_level = swarm_ui.eval_block(_d11)
swarm_ui._eval_rows, swarm_ui.ARGS = _keep11, _args11
check("a second look asks only the bodies of work where the swarm scored under the larger model, from its own button that says which and why; what it did not ask again keeps the earlier evaluation's figures of "
      "this configuration (never another's), marked and counted in the headline as from before; what it asked has its share before beside it in the table; with nothing short there is no button; and Pretrain is no longer aimed by it",
      _v_full["short"] == ["math"] and _v_full["carried"] == 0 and "The harness found no answer in 9 of the swarm&#39;s replies and 0 of Big&#39;s, of 20" in _blk_full and 'class="evt-unread"' in _tab_full
      and "A task marked no answer in some of its replies" in _tab_full and ">no answer in 9 of 20</b>" in _tab_full and ">unread<" not in _tab_full and ">no answer found</b>" not in _tab_full and 'class="evt-unread"' not in _tab11 and 'id="ev-narrow" type="button" data-items="math"' in _blk_full and "Asks only Math again" in _blk_full
      and _v11["by_task"]["he"]["carried"]["at"] == _full11["at"] and _v11["by_task"]["he"]["swarm"]["value"] == 0.75 and _v11["carried"] == 20
      and _v11["by_task"]["gsm"]["before"]["swarm"]["value"] == 0.4 and "carried" not in _v11["by_task"]["gsm"] and _v11["short"] == ["math"]
      and "· 20 from before</small>" in _blk11 and "Not asked again: from the evaluation of 2026-11-19 10:00" in _blk11 and "Before (2026-11-19 10:00): the swarm 40%" in _blk11
      and '<th class="num">Before</th>' in _tab11 and '<td class="num">50% <i class="up">up</i></td>' in _tab11 and 'class="evt-task evt-old"' in _tab11 and 'title="Not asked again">–</td>' in _tab11
      and '<tr class="evt-all"><th scope="row">Every question</th><td class="num">67.5%</td><td class="num">65%</td><td class="num"><b class="up">103.8%</b></td><td class="num">88.4% <i class="up">up</i></td>' in _tab11
      and _v_level["short"] == [] and 'id="ev-narrow"' not in _blk_level and swarm_ui._and(["a", "b", "c"]) == "a, b and c"
      and "b.id==='ev-narrow'" in swarm_ui.JS,
      [_v_full["short"], _v11["carried"], _v11["short"], _v_level["short"], [x for x in _tab11.split("<tr") if "evt-all" in x]])

check("the table of the module beside the larger model, by family, fits a phone: its headings may wrap, a family's name breaks between words and not letter by letter, and under 760 px the columns share the width",
      ".fams table.spec th{white-space:normal}.fams table.spec td:first-child{overflow-wrap:break-word;word-break:normal}" in swarm_ui.CSS and ".fams table.spec{table-layout:fixed" in swarm_ui.CSS)

# ---- EVERY QUESTION OF THE PASS HAS A PIP: the ones not asked yet too, with their line in the key
_qt13 = swarm_ui.question_track({"root": tempfile.gettempdir(), "key": "none13", "loop": {"pass": 1, "of": 6, "list": [{"id": "q1", "kind": "chain", "state": "at parity"}, {"id": "q2", "kind": "fix", "state": "not reached"}]}})
check("every question of a pass has a pip, the ones not asked yet among them, and the key has a line for that look as for every other; the page's script paints the same and keeps the heading the card gave",
      _qt13.count('<i class="pe" title="not asked yet"></i>') == 4 and '<i class="pk pe"></i>not asked yet' in _qt13 and _qt13.count('<i class="at"') == 1
      and "i.className='pe'" in swarm_ui.JS and ".pips i.pe,.qkey i.pe{" in swarm_ui.CSS and "qh.querySelector('b')" in swarm_ui.JS
      and all(".qkey i.%s{" % k in swarm_ui.CSS or ".qkey i.%s," % k in swarm_ui.CSS or ",.qkey i.%s{" % k in swarm_ui.CSS for k in swarm_ui.PIP_WORDS),
      [_qt13.count('class="pe"'), [k for k in swarm_ui.PIP_WORDS if ".qkey i.%s" % k not in swarm_ui.CSS]])

# ---- EACH CLASS OF INPUT, TRAINED AS A CLASS: the Train card says how each class stood, what was tried and what was kept
# HOW FAR A PASS HAS COME, on the Train card (console 2026-11-21: in place of the table of each class trained as a class): a share
# of the pass, from the pass's own record of its steps, and inside the two steps that train, from theirs
_r12 = Path(tempfile.mkdtemp())
(_r12 / "training" / "results" / "k12").mkdir(parents=True)
_p12 = _r12 / ".work" / "train" / "k12" / "pass-3"
_p12.mkdir(parents=True)
_dd12 = {"root": str(_r12), "key": "k12"}
_rs12, swarm_ui.run_state = swarm_ui.run_state, (lambda: {"running": True})
_none12 = swarm_ui.pass_progress({"root": str(_r12), "key": "nothing"})
(_p12 / "status.txt").write_text("10:00:00 START 00-begin\n10:00:01 END   00-begin exit 0 0 min\n10:00:01 START 00-plan\n10:00:02 END   00-plan exit 0 0 min\n10:00:02 START 00-reader\n10:00:03 END   00-reader exit 0 0 min\n10:00:03 START 08-classes\n")
_at_start12 = swarm_ui.pass_progress(_dd12)
(_r12 / "training" / "results" / "k12" / "classes.json").write_text(json.dumps({"at": "2026-11-20T03:00:00Z", "rounds": 2, "classes": {
    "tools": {"train": 18, "held": 18, "asItStands": {"n": 18}, "rounds": [{"of": 10, "candidates": [{}] * 10}], "kept": []},
    "talk": {"train": 34, "held": 34, "asItStands": {"n": 34}, "rounds": [{"of": 10, "candidates": [{}] * 5}], "kept": []}}}))
_mid12 = swarm_ui.pass_progress(_dd12)
_rec12 = json.loads((_r12 / "training" / "results" / "k12" / "classes.json").read_text())
(_p12 / "status.txt").write_text((_p12 / "status.txt").read_text() + "10:20:00 END   08-classes exit 0 20 min\n10:20:00 START 02-target\n10:21:00 END   02-target exit 0 1 min\n10:21:00 START 10-questions\n")
_q12 = swarm_ui.pass_progress(dict(_dd12, loop={"of": 10, "list": [{"state": "at parity"}] * 5}))
(_p12 / "status.txt").write_text((_p12 / "status.txt").read_text() + "10:40:00 END   10-questions exit 0 20 min\n10:50:00 DONE\n")
_done12 = swarm_ui.pass_progress(_dd12)
swarm_ui.run_state = _rs12
shutil.rmtree(_r12, ignore_errors=True)
_share12 = swarm_ui.classes_share
check("the Train card says how far the pass in hand has come, as a share of it: nothing before a pass has begun; then each step that ended counts for its part, the stage that trains each class as a class by the classes done of those asked and the changes tried in the one in hand, the questions by how many are finished; a pass that ended is 100; "
      "and the table of each class trained as a class is no longer on the card",
      _none12 is None and _at_start12["pct"] == 3.0 and _at_start12["pass"] == 3 and _at_start12["step"] == "08-classes"
      and 3.0 < _mid12["pct"] < 33.0 and abs(_mid12["pct"] - (3 + 30 * (1 + 0.15 + 0.85 * 0.4 / 2) / 4)) < 0.01
      # (and it moves with the question in hand: within a change being tried, within the first asking, and through the held draws)
      and abs(_share12(_rec12, 4, "Class 2 of 4, a conversation: trying \"x\" · question 6 of 11") - (1 + 0.15 + 0.85 * 0.8 * (5 + 5 / 11) / 10 / 2) / 4) < 1e-9
      and _share12({"classes": {"tools": {}}}, 4, "Class 1 of 4, with tools: how the swarm stands · question 10 of 19") == 0.15 * 9 / 19 / 4
      and _share12(_rec12, 4, "x: confirming \"y\" on the held questions, draw 2 of 2 · question 1 of 34") > _share12(_rec12, 4, "x: the swarm as it stands, on the held questions, draw 1 of 2 · question 1 of 34") > _share12(_rec12, 4, "")
      and _share12({"rounds": 2, "classes": {"a": {"asItStands": {}, "rounds": [{"candidates": [{}] * 20, "kept": False}]}, "b": {"asItStands": {}, "rounds": [{"candidates": [{}] * 5}]}}}, 2) == (1 + 0.15 + 0.85 * 0.8 * 5 / 20 / 2) / 2
      and abs(_q12["pct"] - (3 + 30 + 2 + 40 * 0.5)) < 0.01 and _q12["step"] == "10-questions" and _done12["pct"] == 100.0 and _done12["done"] is True
      and _share12(None) == 0.0 and _share12({"done": "x", "classes": {}}) == 1.0 and _share12({"classes": {"a": {"skipped": "x"}, "b": {"skipped": "y"}}}, 2) == 1.0
      and "(n.running&&n.step&&n.trainer&&n.trainer!=='loop')?(STEP[n.trainer]||'Working')+' · '+n.step" in swarm_ui.JS
      and "Now, before it" not in swarm_ui.JS and "qn.hidden=!!(n.running&&n.trainer!=='loop')" in swarm_ui.JS and "waiting for the steps of the pass before it" in open(swarm_ui.__file__).read()
      and not hasattr(swarm_ui, "classes_block") and "classes-wrap" not in swarm_ui.JS and 'id="passprog"' in open(swarm_ui.__file__).read()
      and sum(w for _, w in swarm_ui.PASS_SHARES) == 100
      and swarm_ui.step_label("08-classes") == "Each class of input, trained as a class" and "Logic: who tells the truth" in swarm_ui.KIND_WORDS["lies"],
      [_at_start12, _mid12, _q12, _done12])

# ---- A CARD'S CONTROLS STAY IN THEIR COLUMN: a chooser is no wider than the column, whatever its longest choice
check("the controls of a card's head stay inside the third column (a chooser as wide as its longest choice lay over the description beside it): they take the column's width and no more, a choice that does not fit cut short with an ellipsis; and the four cards keep the same three columns",
      ".proghead>.evctl select{min-width:0;max-width:100%;text-overflow:ellipsis}" in swarm_ui.CSS
      and ".trainhead>.proghead>.evctl{min-width:0;max-width:100%}" in swarm_ui.CSS
      and ".trainhead>.proghead{display:grid;grid-template-columns:330px minmax(0,1fr) 300px;" in swarm_ui.CSS, "")

# (the lineup the page is served for, and where its small model's adapters are kept: used by the checks below)
_rroot = Path(swarm_ui.ARGS.root)
_dr = data.load(str(_rroot))
_ra = next(m for m in _dr["members"].values() if m)
_ro = (json.loads((REPO / "training" / "originals.json").read_text())["models"].get(_ra["file"]) or {})
_rdir = _rroot / ".work" / "library" / "adapters" / _dr["target"]["id"] / (_ro.get("dir") or _ra["file"])
_rdir.mkdir(parents=True, exist_ok=True)

# THE RUN CARD IS A CARD LIKE THE OTHERS, AND STOPS A RUN IT DID NOT START; THE EVALUATION DIALOGS HAVE ONE SHAPE
_wb = swarm_ui.whole_block(_dr)
_ps = ("  501 /bin/bash -c source x.sh && bash training/run.sh --limit 20 --train classes\n"
       " 4242 bash training/run.sh --limit 50 --items code,math --train off\n"
       " 4300 sh training/evaluate.sh --variant base\n")
# THE MODULE SERVED AT AN ADDRESS, FROM A BUTTON BESIDE THE SWOA SPEC
_sv_was, _sv_busy = swarm_ui._job_state, swarm_ui.busy_with
swarm_ui.busy_with = lambda: ""
swarm_ui._job_state = lambda name: None
_sv_off = swarm_ui.serve_chip()
swarm_ui.busy_with = lambda: "an evaluation"
_sv_held = swarm_ui.serve_chip()
swarm_ui.busy_with = lambda: ""
swarm_ui._job_state = lambda name: {"running": True, "pid": 1, "port": 1} if name == "serve" else None
_sv_starting = swarm_ui.serve_chip()
_sv_state = swarm_ui.serve_state()
_sv_chips = swarm_ui.chips(data.load(swarm_ui.ARGS.root))
swarm_ui._job_state, swarm_ui.busy_with = _sv_was, _sv_busy
check("the module is served from a button left of the SwOA spec: off, it reads Serve the module and starts it (and cannot be pressed while training, an evaluation or the making of adapters has the models, saying which); while its small models load it says so; once it answers, the address a program or a harness connects to is shown beside it and the button stops it; a served module holds the models, so the others wait for it, and the run cards are drawn again when it starts or stops so that their buttons follow at once; the page starts it only from this page (the header other requests cannot send)",
      'data-on="0"' in _sv_off and "Serve the module" in _sv_off and "disabled" not in _sv_off
      and "disabled" in _sv_held and "an evaluation" in _sv_held
      and 'class="specbtn serve starting"' in _sv_starting and 'data-on="1"' in _sv_starting and "serve-url" not in _sv_starting
      and _sv_state == {"state": "starting", "url": "http://127.0.0.1:1/v1", "port": 1}
      and _sv_chips.index('id="serve-toggle"') < _sv_chips.index('id="spec-open"')
      and '"/serve/start", "/serve/stop"' in Path(swarm_ui.__file__).read_text() and "serve-url" in swarm_ui.JS and "/serve/stop" in swarm_ui.JS and "await swap('/fragment/whole','#wholewrap');await swap('/fragment/converse','#conversewrap');" in swarm_ui.JS and "setTimeout(runs,1500)" in swarm_ui.JS
      and '("serve", "the module being served")' in Path(swarm_ui.__file__).read_text(),
      [_sv_off[:120], _sv_state])

# WHAT TRAINING IS TRYING, IN REAL TIME: the plan section opens with the class stage's own record
_cpd = data.load(swarm_ui.ARGS.root)
_cpf = Path(_cpd["root"]) / "training" / "results" / str(_cpd.get("key", "")) / "classes.json"
_cpwas = _cpf.read_text() if _cpf.exists() else None
_cpmade = not _cpf.parent.exists()
_cpf.parent.mkdir(parents=True, exist_ok=True)
_cp0 = swarm_ui.class_plan({**_cpd, "key": "no-such-configuration"})
_cpf.write_text(json.dumps({"time": {"asked": 8, "draws": 2, "trials": [
    {"what": "serving: X is served as Y", "kind": "serving", "keep": True, "gain": 0, "saved": 0.24, "savedError": 0.03, "seconds": {"base": 80, "with": 61}, "tokensPerSecond": {"base": 25, "with": 34}},
    {"what": "drop a-critic", "kind": "lean", "keep": False, "gain": -0.0625, "saved": 0.3, "savedError": 0.02, "seconds": {"base": 61, "with": 43}, "tokensPerSecond": {"base": 34, "with": 34}, "why": "its answers were worse by 6.2 points"}]}, "pass": 2, "carried": {"from": "x", "focus": {"chat-terse": 4}, "more": 4, "conventions": {"no-offer": {"asked": 3, "missed": 2}, "answers": {"asked": 3, "missed": 0}}}, "gaps": {"kinds": {}, "conventions": {"no-praise": {"asked": 4, "missed": 1}}, "next": {"chat-hurry": 2}}, "classes": {"words": {"train": 12, "held": 12, "kinds": ["a", "b"], "kept": [], "rounds": [
    {"gap": {"wrong": 5, "none": 3, "lost": 1, "spoiled": 1, "first": "none"}, "of": 9,
     "candidates": [{"name": "cascade: a-steps works the question one fact at a time", "n": 12, "counted": 9, "gain": 0.167},
                    {"name": "plan: decide by most", "n": 12, "counted": 7, "gain": 0.0}],
     "best": "cascade: a-steps works the question one fact at a time",
     "held": {"draws": 2, "gain": 0.125, "error": 0.03}, "kept": True}]},
    "tools": {"skipped": "fewer than four questions of this class carry a standard of their own"}}}))
_cp1 = swarm_ui.class_plan(_cpd)
_cpb = swarm_ui.plan_block(_cpd)
if _cpwas is None:
    _cpf.unlink()
    if _cpmade:
        _cpf.parent.rmdir()
else:
    _cpf.write_text(_cpwas)
check("the plan section says in real time what training is trying: what it can change (pure code, adapters, breakdown, cascade, slots and models, settling, the reply, conversation), which pass of the stage it is with what it carries from the last and what it leaves for the next, and for each class its train and held questions, what is kept, and round by round how many changes were tried of how many, where the class fell short as it stood (no slot had it, had it and lost it, reply spoiled) with what that puts first, the changes that gained most, the best and what the held questions said; a class not trained says why; with nothing recorded it says training is not running; and it stands above the question-by-question plan",
      all(w in _cp1 for w in ("What training is trying", "<b>Pure code</b>", "<b>Breakdown</b>", "<b>Cascade</b>", "<b>Slots and models</b>", "Requests in words", "12 train questions and 12 held, of 2 kinds",
                              "2 of 9 changes tried", "<b>Conversation</b>", "<b>Time, as the tie-breaker</b>", "<h4>Time, as the tie-breaker</h4>", "On 8 held questions, 2 draws",
                              "served as Y: answers +0.0 points, <b>24.0%</b> of the time saved (error 3.0); 80.0 s &rarr; 61.0 s a question, 25 &rarr; 34 tokens a second: <b>kept</b>", "drop a-critic: answers -6.2 points",
                              "not kept: its answers were worse by 6.2 points", "<b>Pass 2 of this stage.</b> Carried from the last pass: 4 more train questions of what it was short on (chat-terse +4); in conversation it had missed no-offer (2 of 3)", "<b>Left for the next pass.</b> Asked more of: chat-hurry +2. In conversation, still missed: no-praise (1 of 4).", "Wrong as it stood: 5 (no slot had it 3, had it and lost it 1, reply spoiled 1)", "so what is drafted is tried first",
                              "cascade: a-steps works the question one fact at a time: counted 9 of 12 (+16.7 points)", "+12.5 points with an error of 3.0: <b>kept</b>", "Not trained: fewer than four questions"))
      and "Training is not running" in _cp0 and "Requests in words" not in _cp0
      and _cpb.startswith('<div class="panel plan" id="trainnow">') and "Nothing is training" in _cpb and '<details class="cfg fold" data-keep="plan-earlier">' in _cpb
      and _cpb.index('id="trainnow"') < _cpb.index('data-keep="plan-earlier"') < _cpb.index('id="classplan"') and _cpb.count('class="panel plan"') == 3,
      [_cp1[:300]])

# THE CONVERSATION RUN, APART FROM THE INTELLIGENCE RUN
_cvd = data.load(swarm_ui.ARGS.root)
_cvdir = Path(_cvd["root"]) / "training" / "results" / str(_cvd.get("key", ""))
_cvmade = not _cvdir.exists()
_cvdir.mkdir(parents=True, exist_ok=True)
_cvh = _cvdir / "conversation-history.jsonl"
_cvwas = _cvh.read_text() if _cvh.exists() else None
_cv_js, _cv_bw = swarm_ui._job_state, swarm_ui.busy_with
swarm_ui._job_state = lambda name: None
swarm_ui.busy_with = lambda: ""
if _cvh.exists():
    _cvh.unlink()
_cv0 = swarm_ui.converse_block(_cvd)
_cvh.write_text(json.dumps({"pass": 1, "heldBefore": {"counted": 60, "n": 78}, "heldAfter": {"counted": 66, "n": 78}, "kept": ["manners: a closing that only offers more help is taken off"], "next": {"chat-thanks": 2}}) + "\n"
                + json.dumps({"pass": 2, "heldBefore": {"counted": 66, "n": 78}, "heldAfter": {"counted": 66, "n": 78}, "kept": [], "next": {}}) + "\n")
_cv1 = swarm_ui.converse_block(_cvd)
swarm_ui.busy_with = lambda: "the module being served"
_cv2 = swarm_ui.converse_block(_cvd)
swarm_ui._job_state, swarm_ui.busy_with = _cv_js, _cv_bw
if _cvwas is None:
    _cvh.unlink()
    if _cvmade:
        _cvdir.rmdir()
else:
    _cvh.write_text(_cvwas)
_cvsrc = Path(swarm_ui.__file__).read_text()
check("the conversation run is a card of its own under Run, apart from the intelligence run: one press is one pass, and its figures are its own (the held conversations before a pass and after it, the passes side by side, what each kept and what it left for the next); before any pass it says so and offers one; it cannot be started while something else has the models, saying what; no benchmark is asked; and a pass is what the class stage does for the class that is a conversation, on the made-up people's kinds, with a record, gaps and history of its own",
      "no pass yet" in _cv0 and ">Run a pass<" in _cv0 and "No benchmark is asked" in _cv0 and 'id="conversebox"' in _cv0
      and "after pass 2" in _cv1 and '<b class="pct">85%</b>' in _cv1 and ">Run the next pass<" in _cv1
      and "held 77% &rarr; 85% · kept: manners: a closing that only offers more help is taken off · left for the next: chat-thanks +2" in _cv1
      and "held 85% &rarr; 85% · nothing kept" in _cv1
      and "disabled" in _cv2 and "The module being served is running: a pass waits for it." in _cv2
      and '"/converse/start", "/converse/stop"' in _cvsrc and '("converse", "a conversation pass")' in _cvsrc and '"training/converse.sh", CHAT_KINDS' in _cvsrc and "--only talk" in (_HERE / "training" / "converse.sh").read_text() and "setup.mjs --small" in (_HERE / "training" / "converse.sh").read_text()
      and "conversation.json" in _cvsrc and 'id="conversewrap"' in swarm_ui.main_body(_cvd) and "/converse/start" in swarm_ui.JS
      and all(k in swarm_ui.CHAT_KINDS.split(",") for k in ("chat-terse", "chat-doubt", "chat-reason", "chat-code")) and len(swarm_ui.CHAT_KINDS.split(",")) == 13,
      [_cv0[:200], _cv1[-400:]])

# THE EXPORTED SPEC CARRIES THE SERVING TRAINING CHOSE
_sv_d = data.load(swarm_ui.ARGS.root)
_sv_small = [{"id": "m-std", "name": "M standard", "base": "maker/M", "file": "m.gguf", "bytes": 10, "sha256": "a" * 64, "repo": "r/m", "rev": "1" * 40, "architecture": "arch_x", "thinks": 600},
             {"id": "m-fast", "name": "M fast", "base": "maker/M", "file": "m-fast.gguf", "bytes": 11, "sha256": "b" * 64, "repo": "r/mf", "rev": "2" * 40, "architecture": "arch_x", "thinks": 600, "program": "atomic",
              "parts": [{"file": "draft.gguf", "bytes": 1, "sha256": "c" * 64}], "serve": ["-md", "{part:0}"]},
             {"id": "other", "name": "Other", "base": "maker/O", "file": "o.gguf", "bytes": 9, "sha256": "d" * 64}]
_sv_fake = {"members": {"a": _sv_small[0], "b": _sv_small[0]}, "registry": {"small": _sv_small}, "briefs": {"serving": {"a": "m-fast", "b": "m-fast"}}}
_sv_got = data.served_members(_sv_fake)
_sv_none = data.served_members({**_sv_fake, "briefs": {}})
_sv_bad = data.served_members({**_sv_fake, "briefs": {"serving": {"a": "other", "b": "no-such"}}})
_sv_src = Path(data.__file__).read_text()
check("the exported spec carries the serving training chose: where the arrangement names another entry of the same model for a place, that entry is the place's member in the spec (with its parts, its flags, the architecture it is of, the room its reasoning is given and the other build of the engine that serves it), the spec says which configured model it stood in for, the builds its members name are pinned in the spec's engine, and the arrangement in the spec no longer names a serving, since its members are it; an entry of another model, or a name that is none, is passed over, and with no serving named the members are the configured ones",
      _sv_got["a"]["id"] == "m-fast" and _sv_got["b"]["id"] == "m-fast" and _sv_got["a"]["program"] == "atomic" and _sv_got["a"]["parts"][0]["file"] == "draft.gguf"
      and _sv_none["a"]["id"] == "m-std" and _sv_bad["a"]["id"] == "m-std" and _sv_bad["b"]["id"] == "m-std"
      and all(w in _sv_src for w in ('"architecture", "thinks", "program"', '"chosenServing": chosen', 'engine["programs"]', 'if k not in ("about", "serving")', "served = served_members(d, b)")),
      [_sv_got["a"].get("id"), _sv_bad["a"].get("id")])

# THE PLAN SECTION IS THE PRESENT: what is training this moment, and the picture marks the step in use
_tn_d = data.load(swarm_ui.ARGS.root)
_tn_res = Path(_tn_d["root"]) / "training" / "results" / str(_tn_d.get("key", ""))
_tn_made = not _tn_res.exists()
_tn_res.mkdir(parents=True, exist_ok=True)
_tn_f = _tn_res / "conversation.json"
_tn_was = _tn_f.read_text() if _tn_f.exists() else None
_tn_live = Path(_tn_d["root"]) / ".work" / "train" / "live.json"
_tn_live.parent.mkdir(parents=True, exist_ok=True)
_tn_lwas = _tn_live.read_text() if _tn_live.exists() else None
_tn_js = swarm_ui._job_state
swarm_ui._job_state = lambda name: None
_tn0 = swarm_ui.training_now(_tn_d)
_tn_c0 = swarm_ui.now_codes(_tn_d)
_tn_f.write_text(json.dumps({"pass": 3, "carried": {"focus": {"chat-thanks": 2}, "more": 2}, "classes": {"talk": {"train": 80, "held": 78, "kinds": list("abcdefghijklm"), "kept": [], "rounds": [
    {"gap": {"wrong": 9, "none": 6, "lost": 2, "spoiled": 1, "first": "none"}, "of": 5, "plan": ["adapters: a-direct carries its adapter", "cascade: a-steps works the question one fact at a time", "manners: a closing that only offers more help is taken off", "plan: decide by most"],
     "candidates": [{"name": "adapters: a-direct carries its adapter", "n": 80, "counted": 73, "gain": 0.025}]}]}}}))
_tn_live.write_text(json.dumps({"trainer": "classes", "step": 'Class 1 of 1, a conversation: trying "cascade: a-steps works the question one fact at a time" · question 12 of 80'}))
swarm_ui._job_state = lambda name: {"running": True, "pid": 1} if name == "converse" else None
_tn1 = swarm_ui.training_now(_tn_d)
_tn_c1 = swarm_ui.now_codes(_tn_d)
_tn_live.write_text(json.dumps({"trainer": "classes", "step": "Class 1 of 1, a conversation: the swarm as it stands, on the held questions, draw 1 of 2 · question 3 of 78"}))
_tn_c2 = swarm_ui.now_codes(_tn_d)
# (and the Train card says so too, however the stage was started: here, from a terminal)
_tn_alive = swarm_ui._classes_alive
swarm_ui._job_state = lambda name: None
swarm_ui._classes_alive = lambda: True
_tn_idle = swarm_ui.idle_words()
_tn_busy = swarm_ui.busy_with()
# (the head of the Train card is the stage's own figure, and Training now reads the record the stage says it writes)
_tn_other = Path(_tn_d["root"]) / ".work" / "elsewhere.json"
_tn_other.write_text(json.dumps({"pass": 7, "classes": {"talk": {"train": 8, "held": 8, "kinds": ["a"], "kept": [], "asItStands": {"n": 8, "counted": 6}, "rounds": []}}}))
_tn_live.write_text(json.dumps({"trainer": "classes", "record": str(_tn_other), "step": "Class 1 of 1, a conversation: how the swarm stands · question 3 of 8"}))
_tn_head = swarm_ui.progress_strip(_tn_d)
_tn_now2 = swarm_ui.training_now(_tn_d)
_tn_live.write_text(json.dumps({"trainer": "classes", "record": "/etc/hosts", "step": "Class 1 of 1, a conversation: how the swarm stands · question 3 of 8"}))
_tn_outside = swarm_ui.stage_record(_tn_d)
_tn_other.unlink()
swarm_ui._classes_alive = lambda: False
_tn_idle0 = swarm_ui.idle_words()
swarm_ui._classes_alive = _tn_alive
swarm_ui._job_state = _tn_js
for _f, _w in ((_tn_f, _tn_was), (_tn_live, _tn_lwas)):
    if _w is None:
        _f.unlink()
    else:
        _f.write_text(_w)
if _tn_made:
    _tn_res.rmdir()
check("the plan section is the present, whichever run is going: the run and its pass, the class in hand and the round, what is being asked this moment, what the pass carried in, where the class fell short and so what is tried first, how far the round is, what has gained so far, and what is still to be tried, in order; where nothing is training it says so and what the next run of each kind begins from; everything earlier is folded under it. And the System picture marks the boxes in use this moment, from the same source: a change being tried is S2 with what it is of (a cascade is K4), the held questions are S4, the conversation run is K5, and nothing is marked where nothing runs; a run card's steps stand in a row where there is room and in a column where there is not. The Train card says the same of a stage however it was started (the conversation run, the whole run, a terminal), never that nothing is running while one is, and the run cards wait for it; its head is then the stage's own figure (train answers good as the swarm stands in this stage, and which pass), and Training now reads the record the stage says it is writing, wherever under this folder that is, and no file outside it",
      "Nothing is training" in _tn0 and "The next conversation pass" in _tn0 and "The next intelligence run" in _tn0 and _tn_c0 == set()
      and all(w in _tn1 for w in ('data-training="1"', "Training now: the conversation run, pass 3", "Requests in conversation · round 1", "<b>This moment:</b> Class 1 of 1, a conversation: trying",
                                  "<b>Carried in from the last pass:</b> 2 more train questions of chat-thanks +2", "80 train questions and 78 held, of 13 kinds", "9 wrong as it stood: no slot had the answer 6",
                                  "so what is drafted is tried first", "1 of 5 changes tried", "adapters: a-direct carries its adapter: counted 73 of 80 (+2.5 points)", "<h4>Still to try this round</h4>",
                                  "<li>cascade: a-steps works the question one fact at a time</li>", "<li>decide by most</li>"))
      and _tn1.index("Still to try this round") < _tn1.index("<li>manners: a closing")
      and _tn_c1 == {"S2", "K4", "K5"} and _tn_c2 == {"S4", "K5"}
      and _tn_idle.startswith("Training each class of input as a class · Class 1 of 1, a conversation: the swarm as it stands, on the held questions") and _tn_busy == "training started from a terminal"
      and _tn_idle0 == "Nothing is running. No model is loaded."
      and 'data-stage="1"' in _tn_head and '<b class="pct">75%</b>' in _tn_head and "train answers good" in _tn_head and "the class stage, pass 7" in _tn_head and "<b>6</b> of 8 train answers good" in _tn_head and "<b>Now:</b> Class 1 of 1" in _tn_head
      and "8 train questions and 8 held, of 1 kinds" in _tn_now2 and _tn_outside is None and "/fragment/score','#score'" in swarm_ui.JS and "stage_alive()" in Path(swarm_ui.__file__).read_text()
      and "grid-template-columns:repeat(auto-fit,minmax(230px,1fr))" in swarm_ui.CSS and "/now/codes" in swarm_ui.JS and '"/now/codes"' in Path(swarm_ui.__file__).read_text(),
      [_tn_c1, _tn_c2, _tn1[:300]])

# THE SYSTEM PICTURE DRAWS THE WHOLE: the run, a request inside the module, what training keeps, and the judge, round the lanes
# of the arrangement's training
_vzw = swarm_ui.viz_block(data.load(swarm_ui.ARGS.root))
check("the System picture draws the run in order (R1 to R4: pretraining is no stage of it), a request inside the module (M1 to M4), what training keeps with how far each reaches (K1 to K4: the arrangement with how many slots and models, adapters by slot, instruments saying which are on, the breakdown and the cascade), what is tried first following where the class falls short, the arrangement's lanes after them, and the judge last (J1 to J4)",
      all(">%s</span>" % c in _vzw for c in ("R1", "R4", "M1", "M2", "M4", "K1", "K2", "K3", "A1", "S5", "E1", "J1", "J4")) and ">R5</span>" not in _vzw and "Adapters, by slot" in _vzw
      and _vzw.index(">R1</span>") < _vzw.index(">M1</span>") < _vzw.index(">K1</span>") < _vzw.index(">A1</span>") < _vzw.index(">J1</span>")
      and "None is on yet." in _vzw and "__VIZ_" not in _vzw and "async function swap(url,into,opts){if(!$(into))return;" in swarm_ui.JS and "R3 in detail" in _vzw and "each request is served with the one its slot carries" in _vzw and "those for the widest of the three gaps first" in _vzw and ">K4</span>" in _vzw and "Breakdown, cascade" in _vzw and _vzw.index(">K4</span>") < _vzw.index(">K5</span>") < _vzw.index(">K6</span>") and "Time, the tie-breaker" in _vzw and "Made-up people write over several turns" in _vzw and "is not shaped to how they ask" in _vzw and "bash training/session.sh" in _vzw,
      [c for c in ("R1", "M1", "K3", "J4") if ">%s</span>" % c not in _vzw])
# THE SECOND BASELINE ON THE PAGE: beside a small model by itself, the same model with its reply laid out, as one more column
_lo = [{"alone": {"a": {"name": "A", "value": 0.0}}, "aloneForm": {"a": {"name": "A", "value": 0.5, "unread": 1}}, "agree": {"of": 10}},
       {"harness": "bfcl", "alone": {"a": {"name": "A", "value": 1.0}}, "agree": {"of": 10}}]
_lo_keys = swarm_ui.alone_keys(_lo)
check("the small model alone with its reply laid out is one more column wherever the model alone is shown: its own figure on a task that has a layout, the plain figure on a test of calling tools; none where no task was asked so; and the page counts only a run in its own folder as its run",
      _lo_keys == [("a", "A"), ("a" + swarm_ui.LAID, "A (laid out)")]
      and round(swarm_ui.alone_score(_lo, "a" + swarm_ui.LAID)[0]) == 75 and round(swarm_ui.alone_score(_lo, "a")[0]) == 50
      and "laid out" in swarm_ui.laid_note(_lo) and swarm_ui.laid_note([{"alone": {"a": {"name": "A", "value": 0.5}}}]) == ""
      and swarm_ui.alone_keys([{"alone": {"a": {"name": "A", "value": 0.5}}}]) == [("a", "A")]
      and swarm_ui._run_is_here(os.getpid()) is (Path(os.getcwd()).resolve() == Path(swarm_ui.ARGS.root).resolve()),
      _lo_keys)
_found = swarm_ui._run_in(_ps)
_detail = ('<div class="spec-head"><div><div class="kicker">Evaluate the swarm</div><h3>The swarm against X</h3></div>'
           '<button class="btn stop top" id="evd-close" type="button">Close</button></div><table id="detail"></table>')
_shaped = swarm_ui.evd_shape(_dr, "paper", '<h3 class="cmph">The two evaluations, side by side</h3><table id="three"></table>', _detail)
_alone = swarm_ui.evd_shape(_dr, "chart", "", _detail)
check("the Run card has the head every card has (the figure and what it is, what the card does, its controls, in the same three columns: its figure had fallen to the right and its label ran into the description), "
      "and where it waits for something else it says so in a line of its own; a whole run started from a shell is found by its process (the shell whose script is training/run.sh, not a shell that only launched it), "
      "with the size and the training it was started with, so the card shows Stop for it; each evaluation dialog has ONE header, which names the view, then the three evaluations side by side, then the last evaluation "
      "in detail under a heading that says which it is, and with no comparison to show it is the view as it was; and a percentage is said one way (55, not 55.0 beside 60)",
      'class="panel prep wholep"' in _wb and '<span class="memnum"><b class="pct">' in _wb and "of 4 steps<small>" in _wb and 'id="whole-go"' in _wb
      and ".prep>.proghead" in swarm_ui.CSS
      and _found == {"pid": 4242, "limit": 50, "train": "off", "adopted": True, "running": True}
      and swarm_ui._run_in(" 501 /bin/bash -c bash training/run.sh --limit 20\n") is None and swarm_ui._run_in("") is None
      and swarm_ui._run_in(" 7 bash training/run.sh --proof\n")["limit"] == -1
      and _shaped.index("Evaluate the swarm · Paper table") < _shaped.index('id="evd-close"') < _shaped.index("The two evaluations, side by side") < _shaped.index('id="three"')
          < _shaped.index("The last evaluation in detail:") < _shaped.index('id="detail"')
      and _shaped.count('id="evd-close"') == 1 and _shaped.count('class="evdsec"') == 2
      and "Evaluate the swarm · Chart" in _alone and "evdsec" not in _alone and "The last evaluation in detail" not in _alone
      and swarm_ui.fmt_pct(100.0 * 0.55) == "55" and swarm_ui.fmt_pct(62.5) == "62.5" and swarm_ui.fmt_pct(100.0) == "100" and swarm_ui.fmt_pct(54.14) == "54.1",
      [_found, _shaped[:200]])

# A JOB THAT ENDED WITHOUT SAYING WHY IS EXPLAINED FROM ITS OWN OUTPUT, OR NOT AT ALL
import tempfile as _tf
_er = Path(_tf.mkdtemp())
(_er / ".work" / "pretrain").mkdir(parents=True)
(_er / ".work" / "pretrain" / "ui-run.log").write_text("  Bonsai 2 4B: not trained, its weights are Hadamard-rotated\n")
os.utime(_er / ".work" / "pretrain" / "ui-run.log", (1, 1))  # (a log of long ago)
(_er / ".work" / "pretrain" / "ui-run.json").write_text("{}")
_real_job_file = swarm_ui._job_file
swarm_ui._job_file = lambda name: _er / ".work" / name / "ui-run.json"
_old_log = swarm_ui._ended_words("pretrain", {"pid": 1}, _er)
(_er / ".work" / "pretrain" / "ui-run.log").write_text("MLX is not installed\n")
_own_log = swarm_ui._ended_words("pretrain", {"pid": 1}, _er)
_rd = _er / ".work" / "run" / "k" / "pass-1"
_rd.mkdir(parents=True)
(_rd / "status.txt").write_text("16:38:38 START 2-pretrain\n16:38:53 STOPPED\n")
_stopped = swarm_ui._ended_words("pretrain", {"pid": 1, "whole": True}, _er)
(_rd / "status.txt").write_text("16:38:38 START 2-pretrain\n16:39:00 END   2-pretrain exit 1 0 min\n")
(_rd / "2-pretrain.out").write_text("No train question was answered\n")
_failed = swarm_ui._ended_words("pretrain", {"pid": 1, "whole": True}, _er)
swarm_ui._job_file = _real_job_file
check("a job that ended without saying why is explained from its own output or not at all: a log older than the job is another job's and is not quoted (a Pretrain stopped with the run was explained by the last line of a log three days old, "
      "about a model the lineup no longer had); a step of the whole run that the run was stopped in says it was stopped and that Run carries on from it; one that ended on its own quotes that step's own output",
      "Bonsai" not in _old_log[1] and _old_log == ("failed", "It ended before it finished: nothing was written")
      and "MLX is not installed" in _own_log[1]
      and _stopped == ("stopped", "Stopped with the run, before it finished. Run carries on from this step.")
      and _failed[0] == "failed" and "No train question was answered" in _failed[1],
      [_old_log, _own_log, _stopped, _failed])

# THE SPEC PINS AN ADAPTER FOR EACH ROLE, WRITES THE ARRANGEMENT ONCE, AND ITS DIALOG SAYS WHAT A MODULE IS MADE AGAIN FROM
_sr = Path(swarm_ui.ARGS.root)
_scfg = _sr / "src" / "config.json"
_scfg_was = _scfg.read_text()
_sm = next(m for m in _dr["members"].values() if m)
_so = (json.loads((REPO / "training" / "originals.json").read_text())["models"].get(_sm["file"]) or {})
_sdir = _sr / ".work" / "library" / "adapters" / _dr["target"]["id"] / (_so.get("dir") or _sm["file"])
(_sdir / "roles" / "draft").mkdir(parents=True, exist_ok=True)
(_sdir / "roles" / "check").mkdir(parents=True, exist_ok=True)
(_sdir / "roles" / "draft" / "m-lora.gguf").write_bytes(b"drafters")
(_sdir / "roles" / "check" / "m-lora.gguf").write_bytes(b"checkers")
_sroles_was = (_sdir / "roles.json").read_text() if (_sdir / "roles.json").exists() else None
(_sdir / "roles.json").write_text(json.dumps({"roles": {
    "draft": {"ok": True, "examples": 59, "gguf": str(_sdir / "roles" / "draft" / "m-lora.gguf"), "perplexity": {"without": 2.19, "with": 2.05}},
    "check": {"ok": True, "examples": 15, "gguf": str(_sdir / "roles" / "check" / "m-lora.gguf")},
    "write": {"ok": False, "examples": 3, "why": "too few"}}}))
_scfg.write_text(json.dumps({**json.loads(_scfg_was), "adapters": True}))
try:
    _sd = data.load(str(_sr))
    _spins, _smade = data.spec_adapters(_sd)
    _shtml = swarm_ui.spec_panel(_sd)
finally:  # (put back whatever happens: this is the sample's configuration, and the checks after this one read it)
    _scfg.write_text(_scfg_was)
    if _sroles_was is None:
        (_sdir / "roles.json").unlink()
    else:
        (_sdir / "roles.json").write_text(_sroles_was)
_sk = next(iter(_spins), None)
check("a SwOA spec pins an adapter for each role where pretraining made them (each role's file under its role's folder, with its SHA-256; a role that was not trained is not pinned), so a module can be made again as it was pretrained; "
      "the arrangement is in the spec once, as recipe.briefs, and is no longer written again beside the slots laid out to read; and the dialog says in one place what training added to the base module: its adapters, by role, and the instruments that are on",
      _sk is not None and set(_spins[_sk]["roles"]) == {"draft", "check"} and _spins[_sk]["roles"]["draft"]["file"] == "draft/m-lora.gguf"
      and len(_spins[_sk]["roles"]["draft"]["sha256"]) == 64 and _smade[_sk]["roles"]["draft"]["examples"] == 59
      and "Adapter (place %s, draft)" % _sk in _shtml and "Adapter (place %s, check)" % _sk in _shtml and "Adapter (place %s, write)" % _sk not in _shtml and "taught on 59 of its own right answers" in _shtml and "Instruments on" in _shtml
      and "none: training has turned none on" in _shtml
      and "briefs" not in (json.loads(re.search(r'<pre[^>]*>([\s\S]*?)</pre>', _shtml).group(1).replace("&quot;", '"').replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))["arrangement"]),
      [_spins])

# (a task asked in two ways: the swarm's own count starts again at the second asking, and the page counts by `whole`)
_two = lambda sw: {"tasks": [{"target": {"state": "kept", "done": 20, "of": 20}, "swarm": {"state": "done", "done": 20, "of": 20}}, {"target": {"state": "kept", "done": 20, "of": 20}, "swarm": sw}]}
_lin = [swarm_ui.ev_progress(_two(x)) for x in ({"state": "done", "done": 20, "of": 20, "round": 1, "rounds": 2, "whole": 10}, {"state": "asking", "done": 0, "of": 20, "round": 2, "rounds": 2, "whole": 10},
                                               {"state": "asking", "done": 12, "of": 20, "round": 2, "rounds": 2, "whole": 16}, {"state": "done", "done": 20, "of": 20, "round": 2, "rounds": 2, "whole": 20})]
check("the count of questions finished never goes back: a task asked in two ways (the web search test) starts its own count again at the second asking, and the page counts the task by how far it is over both (it read 460 of 460 and then 420); "
      "the page's own script counts the same way, in the line and in the bar",
      _lin == ["30 of 40 questions finished · 75%", "30 of 40 questions finished · 75%", "36 of 40 questions finished · 90%", "40 of 40 questions finished · 100%"]
      and swarm_ui._whole({"done": 7}) == 7 and open(swarm_ui.__file__).read().count("a.whole??a.done") == 2,
      _lin)

# A SPEC PINS ONLY THE ADAPTERS THAT ARE SERVED: a role's adapter judged and found no better is no part of the module
_sroles_was2 = (_sdir / "roles.json").read_text() if (_sdir / "roles.json").exists() else None
(_sdir / "roles.json").write_text(json.dumps({"roles": {
    "draft": {"ok": True, "examples": 59, "gguf": str(_sdir / "roles" / "draft" / "m-lora.gguf"), "served": True},
    "check": {"ok": True, "examples": 15, "gguf": str(_sdir / "roles" / "check" / "m-lora.gguf"), "served": False}}}))
_scfg.write_text(json.dumps({**json.loads(_scfg_was), "adapters": True}))
try:
    _spins2, _ = data.spec_adapters(data.load(str(_sr)))
finally:
    _scfg.write_text(_scfg_was)
    if _sroles_was2 is None:
        (_sdir / "roles.json").unlink()
    else:
        (_sdir / "roles.json").write_text(_sroles_was2)
_sk2 = next(iter(_spins2), None)
check("a spec pins only the adapters that are served: a role's adapter that was judged and found no better is no part of the module, and is not pinned",
      _sk2 is not None and set(_spins2[_sk2]["roles"]) == {"draft"}, [_spins2])

# A MIXTURE IN THE SPEC: the adapters the arrangement's slots carry by name are pinned, whatever the configuration says of adapters
(_sdir / "mix" / "a-direct@1").mkdir(parents=True, exist_ok=True)
(_sdir / "mix" / "a-direct@1" / "m-lora.gguf").write_bytes(b"one slot")
(_sdir / "mix" / "a-direct@1" / "like.json").write_text(json.dumps({"n": 1, "idf": {"sum": 0.69}, "docs": [{"sum": 1}]}))
_smix_was = (_sdir / "mix.json").read_text() if (_sdir / "mix.json").exists() else None
(_sdir / "mix.json").write_text(json.dumps({"adapters": {"a-direct@1": {"slot": "a-direct", "gguf": str(_sdir / "mix" / "a-direct@1" / "m-lora.gguf"), "examples": 504, "own": 242, "larger": 262, "kinds": 25}}}))
try:
    _sd3 = data.load(str(_sr))
    _first3 = next(x for x in _sd3["briefs"]["slots"] if x.get("stage") == "draft")
    _sd3["briefs"] = dict(_sd3["briefs"], slots=[dict(x, adapter="a-direct@1") if x is _first3 else x for x in _sd3["briefs"]["slots"]])
    _spins3, _smade3 = data.spec_adapters(_sd3)
    _spins3_none, _ = data.spec_adapters(data.load(str(_sr)))
finally:
    if _smix_was is None:
        (_sdir / "mix.json").unlink()
    else:
        (_sdir / "mix.json").write_text(_smix_was)
_k3 = _first3.get("member")
check("a spec pins a mixture: an adapter a slot of the arrangement carries by name is pinned for that slot's place under its name (its file under mix/<name>/, with its SHA-256), whether or not the configuration serves adapters, "
      "with how it was made (the slot, its examples, how many were its own right answers and how many the larger model's) and with its signature, what it was taught, by which a request is found like it or not; an arrangement whose slots carry none pins none",
      (_spins3.get(_k3) or {}).get("named", {}).get("a-direct@1", {}).get("file") == "mix/a-direct@1/m-lora.gguf" and len(_spins3[_k3]["named"]["a-direct@1"]["sha256"]) == 64
      and _smade3[_k3]["named"]["a-direct@1"]["own"] == 242 and _spins3[_k3]["named"]["a-direct@1"]["like"]["file"] == "mix/a-direct@1/like.json" and len(_spins3[_k3]["named"]["a-direct@1"]["like"]["sha256"]) == 64 and "mixture.mjs" in _smade3[_k3]["makeNamed"] and not any("named" in (v or {}) for v in _spins3_none.values()),
      [_spins3, _spins3_none])

# THE ADAPTERS ARE SHOWN WITH THE ARRANGEMENT: which there are, and which slots carry one (they had a card of their own, Pretrain)
(_sdir / "mix" / "a-direct@1").mkdir(parents=True, exist_ok=True)
(_sdir / "mix" / "a-direct@1" / "m-lora.gguf").write_bytes(b"one slot")
_smix_was4 = (_sdir / "mix.json").read_text() if (_sdir / "mix.json").exists() else None
(_sdir / "mix.json").write_text(json.dumps({"adapters": {
    "a-direct@1": {"slot": "a-direct", "gguf": str(_sdir / "mix" / "a-direct@1" / "m-lora.gguf"), "examples": 504, "own": 242, "larger": 262, "kinds": 25, "at": "2026-11-23T18:00:00Z"},
    "a-direct@2": {"slot": "a-direct", "gguf": str(_sdir / "mix" / "a-direct@1" / "m-lora.gguf"), "examples": 560, "own": 250, "larger": 310, "kinds": 29, "at": "2026-11-23T21:00:00Z"},
    "gone@1": {"slot": "b-direct", "gguf": str(_sdir / "mix" / "none.gguf"), "at": "2026-11-23T21:00:00Z"}}}))
try:
    _sd4 = data.load(str(_sr))
    _mx_none = data.mixture_of(_sd4)
    _line_none = swarm_ui.adapters_line(_sd4)
    _sd4["briefs"] = dict(_sd4["briefs"], kinds={"code": {"slots": [dict(x, adapter="a-direct@2") if x.get("id") == "a-direct" else x for x in _sd4["briefs"]["slots"]]}})
    _mx_on = data.mixture_of(_sd4)
    _line_on = swarm_ui.adapters_line(_sd4)
    _page4 = swarm_ui.main_body(_sd4)
finally:
    if _smix_was4 is None:
        (_sdir / "mix.json").unlink()
    else:
        (_sdir / "mix.json").write_text(_smix_was4)
check("the adapters are shown with the arrangement, not in a card or a setting of their own: the line under Train says which adapters there are (the newest for each slot, with what it was taught on; one whose file is gone is not listed) and which slots of which class of input carry one, or that none does; "
      "it says each request is served with the adapter its slot carries and that training finds which; the page has no Pretrain card and the configuration no box for adapters",
      [a["name"] for a in _mx_none["made"]] == ["a-direct@2"] and _mx_none["carried"] == [] and "by no slot" in _line_none and "a-direct@2" in _line_none and "560 examples" in _line_none and "gone@1" not in _line_none
      and _mx_on["carried"] == [("code", "a-direct", "a-direct@2")] and "<b>code</b>: a-direct carries a-direct@2" in _line_on and "each request is served with the adapter its slot carries" in _line_on
      and 'id="adline"' in _page4 and "<h2>Pretrain</h2>" not in _page4 and swarm_ui.adapters_line(dict(_sd4, briefs={"slots": []}, members={})) == "",
      [_mx_none, _line_on[:300]])

# A RUN THAT ENDED ON AN ERROR SAYS SO, AND WHAT IS BEING MADE READY IS SAID (console 2026-11-24)
_fj_root = Path(tempfile.mkdtemp(prefix="swarm-check-failed-"))
(_fj_root / ".work" / "converse").mkdir(parents=True)
(_fj_root / ".work" / "train").mkdir(parents=True)
_fj_was = (swarm_ui.ARGS.root, swarm_ui._job_state)
swarm_ui.ARGS.root = str(_fj_root)
swarm_ui._job_state = _fj_was[1].__wrapped__ if hasattr(_fj_was[1], "__wrapped__") else swarm_ui._job_state
_fj_log = _fj_root / ".work" / "converse" / "ui-run.log"
_fj_log.write_text("No decision model.\n      throw new Error(r.why);\n\nError: Bonsai 2.5 27B is not here (x.gguf). Fetch it first.\n    at createSwarm (file:///x)\n\nNode.js v22.23.3\n")
_fj = lambda st: (setattr(swarm_ui, "_job_state", lambda name: dict(st) if name == "converse" else None), swarm_ui.job_failure("converse"), swarm_ui.failed_line("converse", "The conversation pass"))[1:]  # noqa: E731
_fj_bad = _fj({"pid": 1, "at": "2026-11-24 16:59:37", "running": False, "exit": 1})
_fj_unknown = _fj({"pid": 1, "at": "2026-11-24 16:59:37", "running": False})
_fj_stopped = _fj({"pid": 1, "at": "x", "running": False, "exit": -15, "stopped": True})
_fj_ok = _fj({"pid": 1, "at": "x", "running": False, "exit": 0})
_fj_run = _fj({"pid": 1, "at": "x", "running": True})
_fj_log.write_text("ready    The engine\nfailed   Small model 1 (Bonsai 2.5 27B): no room on the disk\nNOT READY: what the lineup needs could not be made ready. No pass was run.\n")
_fj_setup = _fj({"pid": 1, "at": "x", "running": False, "exit": 1})
_fj_log.write_text("something odd\n")
_fj_last = _fj({"pid": 1, "at": "x", "running": False, "exit": 3})
_fj_none = _fj({"pid": 1, "at": "x", "running": False})
_rw = swarm_ui._ready_words
_rw1 = _rw([{"what": "The engine (llama.cpp)", "state": "ready"}, {"what": "Small model 1 (Bonsai 2.5 27B)", "state": "fetching", "done": 2 * 2**30, "of": 7 * 2**30}])
_rw2 = _rw([{"what": "The engine (llama.cpp)", "state": "installing", "note": "its maker's installer: brew"}])
_rw3 = _rw([{"what": "The engine", "state": "ready"}])
(_fj_root / ".work" / "train" / "setup.json").write_text(json.dumps({"at": time.time() * 1000, "steps": [{"what": "The engine", "state": "fetching"}]}))
_nr_idle = swarm_ui.now_ready()
swarm_ui.ARGS.root, swarm_ui._job_state = _fj_was
_fsrc = Path(swarm_ui.__file__).read_text()
check("a run that ended on an error says so: its card carries the run's own last error in a line that stays, and the page reads it out once in a snackbar at its foot (it was nothing at all: the button came back and only a log knew); "
      "a run that finished, runs, or was stopped by a person says no such thing, and neither does one whose ending is not known and that wrote no error; what the page cannot do is said in the snackbar and not in a browser alert; "
      "and what is being fetched or installed (an engine, a model) is said on the card of the run that waits for it and at the foot of the page, with what is being done to which piece and how much has arrived, only while it is being made ready",
      _fj_bad[0] == "Bonsai 2.5 27B is not here (x.gguf). Fetch it first." and 'class="state bad"' in _fj_bad[1] and 'data-failed="converse 2026-11-24 16:59:37"' in _fj_bad[1] and "The conversation pass did not run: Bonsai" in _fj_bad[1]
      and _fj_unknown[0] == _fj_bad[0] and _fj_stopped == ("", "") and _fj_ok == ("", "") and _fj_run == ("", "")
      and _fj_setup[0] == "Small model 1 (Bonsai 2.5 27B): no room on the disk" and _fj_last[0] == "something odd" and _fj_none == ("", "")
      and "alert(" not in swarm_ui.JS and "function snack(" in swarm_ui.JS and "failWatch" in swarm_ui.JS and "/now/ready" in swarm_ui.JS and "#snack" in swarm_ui.CSS and "#readybar" in swarm_ui.CSS
      and _rw1 == "Making ready: 1 of 2 pieces ready · fetching Small model 1 (Bonsai 2.5 27B) · 2.0 of 7.0 GB" and _rw2.startswith("Making ready: 0 of 1 pieces ready · installing The engine (llama.cpp) (its maker") and _rw3 == ""
      and _nr_idle == "" and 'u.path == "/now/ready"' in _fsrc and "stopped=True" in _fsrc and '"converse": "training/converse.sh"' in _fsrc
      and '_making_ready(st) if running else failed_line("converse"' in _fsrc and '_making_ready(st) if running else failed_line("whole"' in _fsrc
      and '["bash", "bin/serve.sh", str(SERVE_PORT)]' in _fsrc and "setup.mjs --small" in (_HERE / "bin" / "serve.sh").read_text() and 'exec "$NODE" bin/swarm.mjs serve' in (_HERE / "bin" / "serve.sh").read_text() and 'job_failure("serve")' in _fsrc
      and "## Use it like any model" in (_HERE / "README.md").read_text() and "Serve the module" in (_HERE / "README.md").read_text() and "http://127.0.0.1:%d/v1" % swarm_ui.SERVE_PORT in (_HERE / "README.md").read_text() and "## Requirements" not in (_HERE / "README.md").read_text(),
      [_fj_bad, _fj_unknown, _fj_stopped, _fj_setup, _fj_last, _fj_none, _rw1, _rw2, _nr_idle])

_ww = swarm_ui.written_words([{"kind": "day", "wrong": 4, "of": 6, "ok": True, "tries": [{"ok": False, "why": "x"}, {"ok": True, "right": 3, "n": 3}]},
                              {"kind": "li<es", "wrong": 2, "of": 6, "ok": False, "why": "it gave a wrong answer to a question it was shown", "tries": [{"ok": False}]}])
check("code that training writes is said where training is said: among what training can change, in the picture's code-first box, and in the plan being carried out, which says for each kind a round wrote for whether a function passed (and on how many questions it was not shown) or that none did and why",
      any(n == "Written code" for n, _ in swarm_ui.TRAINS) and "training wrote and kept a function for" in Path(swarm_ui.__file__).read_text()
      and "for <b>day</b> (wrong on 4 of 6), a function right on 3 of 3 questions it was not shown, in 2 tries" in _ww and "for <b>li&lt;es</b> (wrong on 2 of 6), none passed: it gave a wrong answer" in _ww
      and 'R.get("written")' in Path(swarm_ui.__file__).read_text()
      and swarm_ui.held_more_words({"more": {"kinds": ["count"], "questions": 18}}) == " and 18 more of count, where the function acts" and swarm_ui.held_more_words({}) == "" and "held_more_words(h)" in Path(swarm_ui.__file__).read_text(), _ww)

# THE PAGE ARRIVES AT ONCE AND SAYS IT IS READING (console 2026-11-24)
_sh = swarm_ui.shell()
_asked = []
_was_now = swarm_ui._run_elsewhere_now
swarm_ui._run_elsewhere_now = lambda: _asked.append(1)
swarm_ui._run_elsewhere(), swarm_ui._run_elsewhere()
_outside = len(_asked)
swarm_ui._REQ.kept = {}
swarm_ui._run_elsewhere(), swarm_ui._run_elsewhere(), swarm_ui._run_elsewhere()
_inside = len(_asked) - _outside
swarm_ui._forget()
swarm_ui._run_elsewhere()
_after_forget = len(_asked) - _outside
swarm_ui._REQ.kept = None
swarm_ui._run_elsewhere_now = _was_now
_fsrc2 = Path(swarm_ui.__file__).read_text()
check("the page arrives at once and says it is reading: a browser is first sent a shell that reads nothing (the styles, the title, a bar that moves and the shape of what is coming), which then asks for the dashboard and starts the page's script on it, and says so where the dashboard cannot be read, with a way to try again; "
      "the whole page made at once is still there for the checks; what is running is asked of the system once for each request and not once for each card, and asked again after something is started or stopped; "
      "and while something asked for is on its way a bar moves across the top of the page: from the moment a change is sent, and for a reading a person began once it has taken longer than a third of a second; the page's own readings of its state never show it (on a phone each is slow, and the bar never went away), and it is never left on",
      'id="apploading"' in _sh and 'class="loadbar"' in _sh and 'role="status"' in _sh and "/fragment/app" in _sh and "/app.js" in _sh and "Try again" in _sh and 'id="body"' not in _sh and 'id="spec"' in _sh
      and len(_sh) < len(swarm_ui.CSS) + 6000 and 'id="conversebox"' not in _sh
      and 'id="body"' in swarm_ui.page(_cvd) and "<script>" in swarm_ui.page(_cvd) and 'id="body"' in swarm_ui.app_inner(_cvd) and "<html" not in swarm_ui.app_inner(_cvd)
      and _outside == 2 and _inside == 1 and _after_forget == 2
      and 'if u.path == "/":\n            return self._send(shell())' in _fsrc2 and 'u.path == "/fragment/app"' in _fsrc2 and 'u.path == "/app.js"' in _fsrc2
      and "#busybar" in swarm_ui.CSS and "busybar" in swarm_ui.JS and "setTimeout(show,330)" in swarm_ui.JS and "if(!mine)return real(url,opts);" in swarm_ui.JS and "Date.now()-asked<800" in swarm_ui.JS and "setTimeout(done,20000)" in swarm_ui.JS and ".loadbar" in swarm_ui.CSS and "prefers-reduced-motion:reduce){.loadbar" in swarm_ui.CSS,
      [_outside, _inside, _after_forget, len(_sh)])

# ONE THING HAS THE MODELS, AND EVERY START BUTTON SAYS SO (console 2026-11-24)
_bs_was = (swarm_ui._job_state, swarm_ui._run_elsewhere_now, swarm_ui._classes_alive)
swarm_ui._run_elsewhere_now = lambda: None
swarm_ui._classes_alive = lambda: False
swarm_ui._job_state = lambda name: {"running": True, "pid": 1, "at": "2026-11-24 18:39:32"} if name == "converse" else None
_bs_whole, _bs_conv, _bs_chip, _bs_busy = swarm_ui.whole_block(_cvd), swarm_ui.converse_block(_cvd), swarm_ui.serve_chip(), swarm_ui.busy_with()
swarm_ui._job_state = lambda name: {"running": True, "pid": 1, "at": "x", "limit": 20} if name == "whole" else None
_bs_whole2, _bs_conv2, _bs_chip2 = swarm_ui.whole_block(_cvd), swarm_ui.converse_block(_cvd), swarm_ui.serve_chip()
swarm_ui._job_state = lambda name: None
_bs_whole0, _bs_conv0 = swarm_ui.whole_block(_cvd), swarm_ui.converse_block(_cvd)
swarm_ui._job_state, swarm_ui._run_elsewhere_now, swarm_ui._classes_alive = _bs_was
_btn = lambda html, i: (re.search(r'<button[^>]*id="%s"[^>]*>' % i, html) or [""])[0]  # noqa: E731
check("one thing has the models at a time and every button that starts something says so: while a conversation pass runs, Start on the intelligence run and Serve the module cannot be pressed and its own card offers Stop; while the intelligence run runs, Run a pass and Serve the module cannot be pressed; with nothing running each can; "
      "and the page keeps them so: when anything is started or stopped every other such card is drawn again, and it asks every few seconds what has the models and draws them all again when the answer changes, so a run started from another window, a phone or a terminal is seen",
      _bs_busy == "a conversation pass" and " disabled" in _btn(_bs_whole, "whole-go") and 'id="converse-stop"' in _bs_conv and " disabled" in _btn(_bs_chip, "serve-toggle")
      and " disabled" in _btn(_bs_conv2, "converse-go") and 'id="whole-stop"' in _bs_whole2 and " disabled" in _btn(_bs_chip2, "serve-toggle")
      and " disabled" not in _btn(_bs_whole0, "whole-go") and " disabled" not in _btn(_bs_conv0, "converse-go") and _btn(_bs_whole0, "whole-go") and _btn(_bs_conv0, "converse-go")
      and "async function runsSync(except)" in swarm_ui.JS and "await runsSync(into);setTimeout(()=>runsSync(into),1500);" in swarm_ui.JS and "fetch('/now/busy')" in swarm_ui.JS and "t!==busyWas" in swarm_ui.JS
      and 'u.path == "/now/busy"' in Path(swarm_ui.__file__).read_text(),
      [_bs_busy, _btn(_bs_whole, "whole-go"), _btn(_bs_conv2, "converse-go"), _btn(_bs_chip, "serve-toggle")])

print("\n" + ("%d FAILED, " % len(failed) if failed else "all ") + "%d passed." % passed)
sys.exit(1 if failed else 0)
