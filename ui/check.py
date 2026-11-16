#!/usr/bin/env python3
"""check.py - THE PAGE, CHECKED. Makes the made-up data, starts the page on it and on an empty folder, and asks for each view.
Only the standard library; nothing is installed and no model is started.

    python3 ui/check.py
"""

import json
import os
import sys
import time
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
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
    sample.main(root)
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
    check("it shows whether the swarm is at parity with the larger model by name, as a yes or a not yet with how many answers are not equivalent, never as a percentage, and says that being right is not what is measured",
          ("At parity with Nemotron" in html or "Not at parity with Nemotron" in html) and "Parity with Nemotron" in full and "The swarm" in full and "LFM2.5 2.6B alone" in full
          and "fundamentally equivalent" in full and "Whether either was right is not what is measured" in full and "%</" not in top.replace("width:", "") and "%</" not in full.replace("width:", "").split("How replies were reached")[0] and "% parity" not in html + full)
    strip = get(base + "/fragment/score")[1]
    check("parity stays one small strip whether or not anything is measured: the verdict and a line of counts, with the charts behind it in a dialog and never on the page itself",
          'id="score-open"' in top and "held questions" in top and "LFM2.5 2.6B alone" in top and "<svg" not in top.split('id="score"')[1] and 'class="kpis"' not in html and 'class="kpis"' in full
          and 'id="big"' in html and "/fragment/scorefull" in html and strip.startswith('<button type="button" class="panel strip"') and len(strip) < 1200, len(strip))
    plan = get(base + "/fragment/plan")[1]
    check("the plan of the pass in hand is on the page as it stands: what the measurement showed, each move in order with the slot, the model, the technique, the paper it came from and why it was chosen, and what became of it",
          "The plan for pass 5" in html and "What the measurement showed" in plan and "no slot had the larger model" in plan.lower().replace("&#x27;", "'") and plan.count("<li class=") == 5 and "Being measured" in plan and ">Kept<" in plan and ">Not kept<" in plan
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
    # THE MEASUREMENT AS IT IS MADE: the strip says the most that is known at each moment, and what kind of knowledge it is
    H, T = d["splits"]["held"], d["splits"]["train"]
    part = dict(d, splits=dict(d["splits"], held=dict(H, swarm=H["swarm"][:5], parity=data.parity(H["swarm"][:5]), expected=12)))
    only_train = dict(d, splits=dict(d["splits"], held=dict(H, swarm=[], parity=None)))
    only_alone = dict(d, splits=dict(d["splits"], held=dict(H, swarm=[], parity=None), train=dict(T, swarm=[], parity=None)))
    nothing = dict(d, splits={k: dict(v, swarm=[], parity=None, target={}, alone={m: [] for m in v["alone"]}) for k, v in d["splits"].items()})
    s_part, s_train, s_alone, s_none, s_full = (swarm_ui.score_strip(x) for x in (part, only_train, only_alone, nothing, d))
    check("the parity strip says the most that is known at each moment and never more: nothing; then what the larger model and each small model alone have done; then how the train questions are going; then the held answers as they come, said not to be the verdict; and the verdict only when all are answered",
          "Not measured yet" in s_none and "has answered 12 held questions. The swarm has not answered yet" in s_alone and "alone" in s_alone and 'id="score-open"' not in s_alone
          and "On this pass" in s_train and "train questions" in s_train and "Parity is said on the held questions" in s_train and "At parity" not in s_train and "Not at parity" not in s_train
          and "Being measured: 5 of 12 held answers so far" in s_part and "The verdict is given when all 12 are answered" in s_part and "Not at parity" not in s_part
          and ("Not at parity with" in s_full or "At parity with" in s_full) and "Being measured" not in s_full, s_part[:300])
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
    check("an answer is on the page the moment a trainer has written it down, before its step has ended; an answer of a candidate being tried is not taken for the swarm's; and input against output has a place that is filled as soon as the swarm has answered",
          "held-live-1" in ids and "held-trial-1" not in ids and 'id="io-wrap"' in html and "/fragment/io" in html and swarm_ui.io_section(nothing) == "" and 'id="io"' in swarm_ui.io_section(d), ids[-3:])
    # what a configuration remembers of its training is its own
    sd = root / "training" / "states"
    sd.mkdir(parents=True, exist_ok=True)
    (sd / ("%s--%s.json" % (d["cfg"], d["target"]["id"]))).write_text(json.dumps({"pass": 7, "tried": {"a-critic": ["x"]}, "history": [], "ideaStatus": {d["state"]["ideas"][0]["hash"]: "dropped"}}))
    own = data.load(root)
    (sd / ("%s--%s.json" % (d["cfg"], d["target"]["id"]))).unlink()
    check("the page reads this configuration's own record of its training over the folder's: its pass, what it tried, and what became of each idea here",
          own["state"]["pass"] == 7 and own["state"]["ideas"][0]["status"] == "dropped" and own["state"]["ideas"][1]["status"] == "open" and d["state"]["pass"] == 4, own["state"]["pass"])
    # how it is training is on the page, and so is what the pass changed in it and why
    pol_d = dict(d, policy=dict(d["policy"], keep={"margin": 4}), policyLog=[{"pass": d["state"]["pass"] + 1, "set": "keep.margin", "from": 2, "to": 4, "why": "The same arrangement measured twice differed by 3 answers."}])
    pol_html = swarm_ui.plan_panel(pol_d)
    exp_html = swarm_ui.stages(dict(d, briefs=dict(d["briefs"], flow=[{"do": "draft"}, {"do": "try"}, {"do": "expect"}, {"do": "decide"}, {"do": "write"}])))
    spec_rows = [dict(r, refToSpec=(i % 3 != 0)) for i, r in enumerate(H["swarm"])]
    check("the plan says how the swarm is being trained (the margin a change must win by, how many arrangements are tried) and what the pass's review of itself changed in that, with the reason; a flow that asks what each call should give is drawn with that step; and parity is also counted where the larger model follows the question",
          "How it is training" in pol_html and "wins <b>4</b> more answers" in pol_html and "keep.margin" in pol_html and "differed by 3 answers" in pol_html and d["policy"]["keep"]["margin"] == 2
          and "Says what each call should give" in exp_html and exp_html.count('class="stage"') == 5
          and data.parity(spec_rows)["onSpec"]["compared"] == 8 and "follows the question" in swarm_ui.score_strip(dict(d, splits=dict(d["splits"], held=dict(H, swarm=spec_rows, parity=data.parity(spec_rows))))), pol_html[:200])
    spec_html = get(base + "/fragment/spec")[1]
    sp = data.spec(d)
    check("the output spec is the record of what this configuration has learned against this larger model: every change that was kept, newest first, with where it came from and the answers it won on train and on held; where each pass left it; the flow; and a count of them on its pill",
          len(d["learned"]["ledger"]) == 2 and sp["learned"]["changesKept"] == 2 and "What it has learned (2 kept)" in spec_html and spec_html.index("go back to the drafters") < spec_html.index("the shortest brief that still asks for a test")
          and "arxiv.org/abs/2603.16045" in spec_html and "13 → 15" in spec_html and "6 → 7" in spec_html and "Where each pass left it" in spec_html and "pass 4: 9 of 12 equivalent" in spec_html
          and "The flow" in spec_html and "Output spec · 2 learned" in html and d["briefs"].get("version") == 3 and sp["arrangement"]["flow"][0]["do"] == "draft", sp["learned"]["changesKept"])
    bare = data.load(Path(tmp) / "empty")
    check("a swarm that has learned nothing says so, and runs the arrangement every swarm starts from", bare["learned"]["ledger"] == [] and "Nothing yet" in swarm_ui.learned_block(dict(d, learned={"ledger": [], "passes": []})))
    check("what a slot is doing is two lines and never more or fewer, and the line above the arrangement is one: a card is the same height whatever it says, so nothing below moves as a pass runs",
          "-webkit-line-clamp:2" in html and "height:34px" in html and "#now span{white-space:nowrap" in html and "el.title=text" in html)
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
          html.count('data-pick="') == 4 and html.count("<optgroup") >= 12 and all(m["name"] in html for m in reg["small"] + reg["targets"] + reg["deciders"]) and 'value="%s" selected' % d["members"]["a"]["id"] in html
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
    code_s, sp = get(base + "/fragment/spec")
    spec = data.spec(data.load(root))
    check("the output spec says what the swarm as it stands is: what goes in and comes out, each model with its pinned file and SHA-256, the decider, every slot and what it is for, and where it stands against the larger model, to read and to copy as JSON",
          code_s == 200 and "Output spec" in sp and d["members"]["a"]["sha256"] in sp and d["members"]["b"]["file"] in sp and "kev-decide" in sp and ("Not at parity against" in sp or "At parity against" in sp) and 'id="spec-json"' in sp
          and spec["trainedAgainst"]["state"] in ("at parity", "not at parity") and spec["trainedAgainst"]["equivalent"] == p["equivalent"] and len(spec["arrangement"]["slots"]) == len(d["briefs"]["slots"])
          and spec["members"]["a"]["sha256"] == d["members"]["a"]["sha256"] and spec["interface"]["out"] == "one reply" and "fundamentally equivalent" in spec["trainedAgainst"]["parityMeans"], sp[:200])
    check("an idea waiting to be measured opens the paper it came from", 'class="idea" href="https://arxiv.org/abs/' in html and 'target="_blank"' in html and "arXiv 26" in html)
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
          'id="run-go" type="button">Run training' in page0 and 'id="run-stop"' not in page0 and 'id="run-passes"' not in page0 and "Until stopped" in page0 and "until <b>Stop training</b> is pressed" in page0)
    refused = post("/run/start", headers={"content-type": "text/plain"})[0]
    foreign = post("/run/start", headers={"x-swarm": "1", "origin": "https://elsewhere.example"})[0]
    check("a pass cannot be started by anything but this page: a request without the page's own header, or from another site, is refused", refused == 403 and foreign == 403 and not (fake / ".work" / "train" / "ui-run.json").exists(), [refused, foreign])
    code, panel = post("/run/start", json.dumps({"each": 4}).encode())
    time.sleep(1.0)
    panel = get(base + "/fragment/run")[1]
    st = json.loads((fake / ".work" / "train" / "ui-run.json").read_text())
    check("pressed, it starts a session that goes on pass after pass until it is stopped (no number of passes is given it), and the page shows it running: each step as it starts and ends, and the last lines of the step it is on",
          code == 200 and 'data-running="1"' in panel and "Stop training" in panel and 'data-since="' in panel and "Running since" in panel and " · " in panel.split("Running since")[1].split("</span>")[0] and swarm_ui._span(45) == "45 s" and swarm_ui._span(750) == "12 min 30 s" and swarm_ui._span(7500) == "2 h 5 min" and "timeZoneName" in html and "00-begin" in panel and "0 min" in panel and "02-target" in panel and "Pass 3" in panel and "asked" not in panel
          and "until stopped" in panel and "asked 0 4" in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text(), panel[:400])
    check("a teacher is never started from the button, whatever the page was started with", "teacher=[]" in (fake / ".work" / "train" / "pass-3" / "02-target.out").read_text())
    # what every slot is doing now: written by a trainer, shown only while a session runs and only while it is fresh
    (fake / ".work" / "train" / "live.json").write_text(json.dumps({"at": time.time() * 1000, "trainer": "measure", "who": "swarm", "split": "train", "n": 3, "of": 42,
        "question": {"id": "q", "kind": "fix", "ask": "Correct this function."}, "slots": {"a-direct": {"state": "working", "since": time.time() * 1000}, "kev-decide": {"state": "done", "ms": 310, "said": "Picked B."}}}))
    now = json.loads(get(base + "/api/live")[1])
    check("while a session runs the page can ask what every slot is doing at this moment: which question, which slots are working, what one just answered",
          now["running"] and now["question"]["kind"] == "fix" and now["slots"]["a-direct"]["state"] == "working" and now["slots"]["kev-decide"]["said"] == "Picked B." and now["whoName"] == "The swarm", now)
    (fake / ".work" / "train" / "setup.json").write_text(json.dumps({"at": time.time() * 1000, "steps": [{"what": "The engine (llama.cpp)", "state": "ready"}, {"what": "Small model 1 (Qwen3.5 2B)", "state": "fetching", "done": 600 * 2**20, "of": 1200 * 2**20}]}))
    check("while a session runs no model can be changed", post("/config", b'{"a":"x"}')[0] == 409)
    # a step tried again, a step passed over on a resumed pass, and the ways back taken, are all shown
    stat = fake / ".work" / "train" / "pass-3" / "status.txt"
    stat.write_text(stat.read_text() + "10:00:02 END   02-target exit 1 0 min\n10:00:07 START 02-target\n10:00:09 SKIP  03-a-alone\n")
    (fake / ".work" / "train" / "recovery.jsonl").write_text(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 1)), "what": "LFM2.5 2.6B", "did": "its server was gone or hung: started again, and asked again"}) + "\n"
                                                           + json.dumps({"at": "2020-01-01T00:00:00", "what": "old", "did": "from another session"}) + "\n")
    rp = get(base + "/fragment/run")[1]
    check("a step that failed and is being run again shows as one step with its try, a step done before a stop is shown as done earlier, and the ways back this session has taken are listed (and no other session's)",
          "try 2" in rp and "done earlier" in rp and rp.count("02-target") == 1 and "Recovered 1 time this session" in rp and "started again, and asked again" in rp and "from another session" not in rp, rp[-600:])
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
