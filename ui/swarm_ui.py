#!/usr/bin/env python3
"""swarm_ui.py - THE SWARM, SEEN. One page, served from this machine, that shows what is being trained and how it stands:

    Parity            whether the swarm's answers are FUNDAMENTALLY EQUIVALENT to the larger model's, on the same questions.
                      How far toward it is one percentage, said one way everywhere; at parity when every answer is equivalent
    The arrangement   what every pass trains: the drafts, the checks, the decision, the write, and the arrangement of the slots
                      itself. The two small models, every slot of each, what each is told and what is being tried in its
                      place; the larger model alongside
    Input, output     any question that was asked: the input at the top, then on the left what every slot wrote and the
                      swarm's reply, and on the right the larger model's reply to the same input
    Run training      a button that starts a training pass (bash training/session.sh) on this machine, shows each step as it
                      starts and ends, and can stop it. One at a time. While it runs, every slot's card says what that
                      model is doing at this moment: working, or what it just answered.

It reads what the trainers wrote (ui/data.py) and measures nothing. Only the Python standard library is used: nothing to install.

    python3 ui/swarm_ui.py                      http://127.0.0.1:8787/
    python3 ui/swarm_ui.py --port 9000 --root /path/to/TheSwarm
"""

import argparse
import json
import re
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from html import escape as e
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cleanup  # noqa: E402
import data  # noqa: E402

ARGS = None

CSS = """
:root{--ink:#eaf7f3;--panel:#ffffff;--soft:#e3efeb;--line:#d9e8e3;--line2:#e3ece9;--fog:#14211f;--mist:#5f7773;
--teal:#0b5d57;--teal2:#1e9e8e;--sun:#f9c440;--coral:#f2644b;--lfm:#0e6b62;--bon:#c98a06;--kev:#d9502f;--tgt:#3f4f86;
--right:#149a72;--wrong:#e5533d;--unsure:#9aa8a5;--shadow:0 10px 30px rgba(11,93,87,.08)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
html,body{margin:0;background:var(--ink);color:var(--fog);font:15px/1.5 ui-rounded,"SF Pro Rounded",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:5px}
.shell{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:100vh}
main{background:#f4fbf9;padding:26px 30px 70px;min-width:0}
.rail{background:#ecf7f4;padding:26px 20px 40px;min-width:0;display:grid;gap:18px;align-content:start}
.rail h2{margin:0 0 10px}
.kicker{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--coral)}
h1{font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.035em;margin:4px 0 0}
h2{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2);margin:36px 0 12px}
h3{font-size:17px;font-weight:800;letter-spacing:-.02em;margin:0}.muted{color:var(--mist)}.small{font-size:12.5px}
header{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:flex-end;justify-content:space-between}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--panel);border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:600;color:var(--mist);white-space:nowrap;box-shadow:var(--shadow)}
.chip b{color:var(--fog);font-weight:800}.chip.level{background:#d7f3e9;color:var(--right)}.chip.behind{background:#fdebd0;color:#9a5b00}.chip.level b,.chip.behind b{color:inherit}
/* the choices, in one row where there is room and in even rows where there is not: each pill takes what it needs and the row is
   filled, so none is left ragged; a label is one line; the larger model, whose names are longest, has twice the room */
.picks{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;align-items:stretch}
/* what it is to be equivalent on: one box to tick for each, in a row that wraps; each takes the room its words need and no less */
.equiv{border:1px solid var(--line);border-radius:16px;background:var(--panel);margin:10px 0 0;padding:12px 16px 12px;min-width:0}
.equiv legend{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist);padding:0 6px}
.equiv .ticks{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 10px}
.tick{position:relative;border:1px solid var(--line);border-radius:12px;min-width:0}.tick label{display:flex;gap:10px;align-items:flex-start;padding:9px 40px 9px 12px;cursor:pointer;min-width:0}
.pencil{position:absolute;top:6px;right:6px;width:28px;height:28px;border:0;border-radius:8px;background:none;color:var(--mist);cursor:pointer;display:grid;place-items:center;padding:0}
.pencil:hover,.pencil:focus-visible{background:var(--soft);color:var(--teal)}.pencil svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
.tick small em{font-style:normal;font-weight:700;color:var(--teal)}
dialog#qedit{border:0;border-radius:26px;padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#qedit::backdrop{background:rgba(11,40,38,.45)}dialog#qedit h4{margin:22px 0 6px}
.qlist{list-style:none;margin:0;padding:0;display:grid;gap:8px}.qrow{display:flex;gap:8px;align-items:flex-start;min-width:0}
.qrow textarea{flex:1 1 auto;min-width:0;resize:vertical;font:inherit;font-size:14px;line-height:1.4;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--fog)}
.qside{display:flex;gap:6px;align-items:center;flex:none}.qside select{font:inherit;font-size:13px;padding:7px 6px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--fog)}
.qdel{width:32px;height:32px;border:0;border-radius:8px;background:var(--soft);color:var(--mist);font-size:18px;line-height:1;cursor:pointer}.qdel:hover{background:#fde1db;color:var(--wrong)}
.qbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}.qbar #qcount{margin-right:auto}
.qmade{margin:0;padding-left:18px;columns:2 220px;font-size:13px;color:var(--mist)}
@media (max-width:560px){.qrow:has(select){flex-wrap:wrap}.qrow:has(select) .qside{width:100%;justify-content:flex-end}}
.tick.on{border-color:var(--teal2);background:#eefaf6}.tick input{flex:none;width:17px;height:17px;margin:2px 0 0;accent-color:var(--teal)}
.tick span{display:grid;gap:2px;min-width:0}.tick b{font-size:14.5px;font-weight:800}.tick small{font-size:12px;line-height:1.35;color:var(--mist);overflow-wrap:anywhere}
.equiv p{margin:10px 2px 0}
/* two groups: the small models, and what they are set against (the decider and the larger model). In one row where both fit; where
   they do not, the second group goes under the first whole, so a row is never one stray pill */
.picks>.group{display:flex;flex-wrap:wrap;gap:10px;flex:1 1 auto;min-width:0}.picks>.group.small{flex-grow:3}.picks>.group.against{flex-grow:2}
.picks .pick{flex:1 1 185px}.picks .pick.target{flex:1.6 1 300px}
.specbtn{font:inherit;font-size:12.5px;font-weight:800;color:var(--fog);background:var(--panel);border:0;border-left:4px solid var(--sun);border-radius:999px;padding:7px 14px;box-shadow:var(--shadow);cursor:pointer;white-space:nowrap}
.specbtn span{font-weight:700;color:var(--mist);margin-left:6px}.specbtn.tidy{border-left-color:var(--coral)}
dialog#tidy{border:0;border-radius:26px;padding:26px;max-width:min(820px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#tidy::backdrop{background:rgba(11,40,38,.45)}.tlist{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.tgroup{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2);margin:12px 0 0}
.titem{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:12px}
.titem b{font-size:14px}.titem small{display:block;font-size:12px;color:var(--mist);line-height:1.35;overflow-wrap:anywhere;margin-top:2px}.titem .pill{margin-left:4px}
.tsize{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.tdel{padding:8px 14px}
.tsaid{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:#d7f3e9;color:var(--right);font-weight:700;font-size:13px}
@media (max-width:560px){.titem{grid-template-columns:minmax(0,1fr) auto}.titem>div{grid-column:1/-1}}.specbtn:hover{box-shadow:0 12px 30px rgba(11,93,87,.16)}.specbtn:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}
.pick{background:var(--panel);border-radius:16px;padding:9px 14px 10px;box-shadow:var(--shadow);display:grid;gap:3px;align-content:center;border:0;text-align:left;font:inherit;color:var(--fog);border-left:4px solid var(--lfm);min-width:0}
.pick.b{border-left-color:var(--bon)}.pick.c{border-left-color:#7a5cc4}.pick.d{border-left-color:#2f7fb8}.pick.add{border-left-color:var(--line);box-shadow:none;background:transparent;outline:1.5px dashed var(--line)}.pick.decider{border-left-color:var(--kev)}.pick.target{border-left-color:var(--tgt)}.pick.spec{border-left-color:var(--sun);cursor:pointer}
.pick small{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pick b{font-size:15px;font-weight:800;white-space:nowrap}
.pick small i{font-style:normal;font-weight:700;letter-spacing:.02em;text-transform:none;margin-left:8px;opacity:.85}.pick.add select{color:var(--mist);font-weight:700}.pick select{font-size:14.5px}
.pick select{background:none;border:0;padding:0;font:inherit;font-size:15px;font-weight:800;color:var(--fog);width:100%;cursor:pointer;min-width:0;text-overflow:ellipsis}
.pick select:disabled{opacity:.55;cursor:default}
dialog#spec{border:0;border-radius:26px;padding:26px;max-width:min(980px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#spec::backdrop{background:rgba(11,40,38,.45)}.spec-head{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-start}
table.spec{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}table.spec th,table.spec td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid var(--line2);overflow-wrap:anywhere}
table.spec th{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);white-space:nowrap}dialog h4{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal2);margin:20px 0 6px}
.tail{margin:0;padding:12px;border-radius:14px;background:var(--soft);font:11.5px/1.5 ui-monospace,Menlo,monospace;color:var(--fog);white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto}
.idea{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;color:inherit;text-decoration:none;border-radius:12px;padding:4px;margin:-4px}
a.idea:hover{background:var(--soft)}a.idea:focus-visible{outline:2px solid var(--teal2)}.feed li:has(.idea){display:block}
.banner{margin:16px 0 0;padding:10px 16px;border-radius:14px;background:#fff4d6;color:#7a5200;font-weight:600}
.panel{background:var(--panel);border-radius:26px;padding:22px;box-shadow:var(--shadow)}
.panel.tint{background:var(--soft);box-shadow:none}
.cols{display:grid;gap:18px}.two{grid-template-columns:minmax(0,1.9fr) minmax(0,1fr)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.kpi{background:var(--panel);border-radius:24px;padding:16px 18px 18px;box-shadow:var(--shadow);border-left:4px solid var(--c,var(--teal));display:grid;gap:10px}
.kpi .top{display:flex;justify-content:space-between;align-items:center}
.kpi .ic{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--bg,#d9f2ec)}
.kpi .ic svg{width:18px;height:18px;fill:none;stroke:var(--c,var(--teal));stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pill{font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:#d9f2ec;color:var(--teal);white-space:nowrap}
.pill.up{background:#d7f3e9;color:var(--right)}.pill.down{background:#fde1db;color:var(--wrong)}
.kpi .lab{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
.kpi .val{font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:1}.kpi .val small{font-size:14px;font-weight:700;color:var(--mist);letter-spacing:0}
.charts{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:18px;margin-top:18px}
.chart-head{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.legend{display:flex;gap:8px;flex-wrap:wrap}.legend span{display:inline-flex;gap:6px;align-items:center;background:var(--panel);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.legend i{width:8px;height:8px;border-radius:50%;display:inline-block}
.plot{background:var(--panel);border-radius:22px;padding:14px 14px 8px}
.plot svg,.kb svg{display:block;width:100%;height:auto}
.kinds{list-style:none;margin:16px 0 2px;padding:0;display:grid;gap:12px}.kinds li{display:grid;grid-template-columns:minmax(0,13.5em) minmax(60px,1fr) 7.5em;gap:14px;align-items:center;font-size:13.5px}
.kinds .kn{font-weight:700;overflow-wrap:anywhere}.kinds .kt{display:block;height:10px;border-radius:999px;background:var(--soft);overflow:hidden}.kinds .kt i{display:block;height:100%;border-radius:999px;background:var(--sun)}
.kinds .full .kt i{background:var(--teal2)}.kinds .low .kt i{background:var(--coral)}.kinds .kc{text-align:right;color:var(--mist);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}.kinds .kc b{color:var(--fog);font-size:13.5px;margin-right:6px}
@media (max-width:560px){.kinds li{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px}.kinds .kt{grid-column:1/-1;grid-row:2}}
.plot text,.panel>svg text,.panel>.kb text{font:10px ui-sans-serif,system-ui,sans-serif;fill:var(--mist);font-weight:700;letter-spacing:.06em}
.donut{display:grid;place-items:center;margin:6px 0 14px}.donut svg{width:210px;height:210px}
.donut .n{font-size:26px;font-weight:800;fill:var(--fog);letter-spacing:-.02em}.donut .l{font-size:9px;font-weight:800;fill:var(--mist);letter-spacing:.14em}
.keys{display:grid;gap:8px;font-size:13.5px;font-weight:600}.keys div{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:8px;align-items:center}
.keys i{width:9px;height:9px;border-radius:50%}.keys span:last-child{color:var(--mist)}
.verdict{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px}.verdict.level{color:var(--right)}.verdict.behind{color:#9a5b00}
.score{display:grid;gap:14px}.bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:baseline}.bar .track{grid-column:1/-1;grid-row:2}
.bar .name{font-weight:700}.bar .track{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--soft)}
.bar .track i{display:block;height:100%}.r{background:var(--right)}.w{background:var(--wrong)}.u{background:var(--unsure);opacity:.55}
.bar .n{font-size:12.5px;color:var(--mist);text-align:right;white-space:nowrap}
.who-swarm{color:var(--teal)}.who-target{color:var(--tgt)}
.pane,.panel{min-width:0}.stages{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(178px,1fr);gap:14px;align-items:start;overflow-x:auto;padding-bottom:6px}
.stage .again{display:block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:none;color:var(--coral);margin-top:2px}
.stage.loop{border-top:3px solid var(--coral);padding-top:8px;border-radius:3px}.flowline{margin:0 0 12px;font-size:12.5px;color:var(--mist)}.flowline b{color:var(--fog)}
.stage>.t{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--mist);margin-bottom:8px}
.slot{background:#e4f4f0;border-left:4px solid var(--lfm);border-radius:16px;padding:10px 12px;margin-bottom:10px}
.slot.b{background:#fdf3d7;border-left-color:var(--bon)}.slot.c{background:#ece6f8;border-left-color:#7a5cc4}.slot.d{background:#e2eff8;border-left-color:#2f7fb8}.slot.kev{background:#fde8e2;border-left-color:var(--kev)}.slot.run{background:#e9ecf8;border-left-color:var(--tgt)}
.probs{display:grid;gap:3px;margin-top:6px;font-size:12.5px}
.probs div{display:grid;grid-template-columns:18px minmax(0,1fr) 38px;gap:6px;align-items:center}.probs i{display:block;height:7px;border-radius:4px;background:var(--kev)}
.slot summary{cursor:pointer;list-style:none}.slot summary::-webkit-details-marker{display:none}
.slot .id{font-weight:800;letter-spacing:-.01em;font-size:15px}.purpose{font-size:13px;font-weight:600;color:var(--fog);opacity:.85;margin:1px 0 3px}
.live{display:flex;gap:7px;align-items:flex-start;margin-top:7px;padding-top:7px;border-top:1px solid rgba(20,33,31,.10);font-size:12px;font-weight:700;color:var(--mist);overflow-wrap:anywhere}
/* what a slot is doing changes every second or two: it has two lines and never more or fewer, so a card is the same height
   whatever it says and nothing below it moves. The whole of it is in the title, for a pointer held over it */
.live span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:17px;height:34px;min-width:0}
#now span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.live i{width:8px;height:8px;border-radius:50%;background:var(--unsure);flex:none;margin-top:4px}.live.on{color:var(--teal)}.live.on i{background:var(--teal2);animation:p 1.2s infinite}
.live.done{color:var(--fog)}.live.done i{background:var(--right)}.live.bad{color:var(--wrong)}.live.bad i{background:var(--wrong)}
.now{display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--mist);overflow-wrap:anywhere}
.now i{width:9px;height:9px;border-radius:50%;background:var(--unsure);flex:none;margin-top:5px}.now.on{color:var(--fog)}.now.on i{background:var(--teal2);animation:p 1.2s infinite}.slot .sub{font-size:12px;color:var(--mist);display:flex;flex-wrap:wrap;gap:2px 10px}
.slot .body{margin-top:8px;padding-top:8px;border-top:1px solid rgba(20,33,31,.10);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.slot .final{display:flex;align-items:center;gap:8px;margin-top:10px;padding:7px 10px;border-radius:10px;font-size:12px;font-weight:700;line-height:1.35;background:rgba(255,255,255,.7);min-width:0}
.final .what{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.final .what.code{font:600 11.5px/1.35 ui-monospace,Menlo,monospace}
.final .len{flex:none;font-size:10.5px;font-weight:800;letter-spacing:.03em;opacity:.8;white-space:nowrap}.final .mark{flex:none;width:7px;height:7px;border-radius:50%;background:var(--unsure)}
.final.ok{background:#d7f3e9;color:var(--right)}.final.ok .mark{background:var(--right)}.final.no{background:#fde1db;color:var(--wrong)}.final.no .mark{background:var(--wrong)}
.cand{margin-top:6px;font-size:12.5px;color:var(--mist);border-left:3px solid var(--sun);padding-left:8px}
.target{border-left:4px solid var(--tgt)}.target h3{color:var(--tgt)}
button.strip{display:block;width:100%;text-align:left;border:0;font:inherit;color:inherit;cursor:pointer}button.strip:hover{box-shadow:0 14px 34px rgba(11,93,87,.16)}
button.strip:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}.strip .meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0;color:var(--mist)}.strip .meta b{color:var(--fog)}.strip .more{color:var(--teal);font-weight:800}
.prog{display:block;height:8px;border-radius:999px;background:var(--soft);overflow:hidden;margin:10px 0 10px;position:relative}.prog i{display:block;height:100%;float:left}
.prog .eq{background:var(--right)}.prog .ch{background:var(--sun)}.pct{font-variant-numeric:tabular-nums}.gapkey{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--mist)}.gapkey i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
dialog#big{border:0;border-radius:26px;padding:26px;max-width:min(1180px,96vw);width:100%;max-height:92vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:#f4fbf9}dialog#big::backdrop{background:rgba(11,40,38,.45)}
.plan-head{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;align-items:baseline}.plan h4{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal2);margin:18px 0 6px}
.finds{margin:0;padding:0;list-style:none;display:grid;gap:6px}.finds li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;font-size:13.5px}
.finds .n{font-weight:800;background:#fde1db;color:var(--wrong);border-radius:999px;padding:1px 9px;font-size:12px;white-space:nowrap}
.moves{margin:0;padding:0;list-style:none}.moves li{display:grid;grid-template-columns:26px 124px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 0;border-top:1px solid var(--line2)}
.moves .o{font-weight:800;color:var(--mist);font-variant-numeric:tabular-nums}.moves .k{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 0;color:var(--teal);white-space:nowrap;min-width:0}
.moves .k.arrangement{color:var(--tgt)}.moves .k.plan{color:var(--bon)}.moves b{display:block;font-size:14.5px}.moves small{display:block;color:var(--mist);font-size:12.5px;overflow-wrap:anywhere}.moves small a{color:inherit}
.moves li.running{background:linear-gradient(90deg,#fdf0cf66,transparent)}.pill.planned{background:var(--soft);color:var(--mist)}.pill.running{background:#fdf0cf;color:#8a5a00}
@media (max-width:700px){.moves li{grid-template-columns:22px minmax(0,1fr) auto}.moves .k{grid-column:2}.moves .mv{grid-column:2/4}}
.foot{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 30px;align-items:center}
.foot .brand{display:flex;gap:12px;align-items:center}.foot .brand svg{width:40px;height:40px;border-radius:11px;flex:none}.foot .brand b{display:block;font-size:15px;letter-spacing:-.01em}.foot .brand small{color:var(--mist);font-size:12.5px}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;font-weight:700}.foot nav a{color:var(--teal);text-decoration:none}.foot nav a:hover{text-decoration:underline}
.foot .fine{grid-column:1/-1;color:var(--mist);font-size:12px;line-height:1.55;max-width:92ch}@media (max-width:700px){.foot{grid-template-columns:minmax(0,1fr)}}
.ladder{margin:12px 0 0;padding:0;list-style:none}.ladder li{padding:6px 0;border-top:1px solid var(--line2);font-size:13px}
.io{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.tabs button{background:var(--panel);border:0;color:var(--mist);border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:var(--shadow)}
.tabs button[aria-pressed=true]{background:var(--teal);color:#fff}
.qlist{max-height:640px;overflow:auto;display:grid;gap:4px;padding:2px}
.q{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:0;
border-radius:12px;padding:8px 10px;color:var(--fog);font:inherit;font-size:13px;cursor:pointer}
.q[hidden]{display:none}.q:hover{background:var(--soft)}.q[aria-current=true]{background:var(--panel);box-shadow:var(--shadow)}
.q .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block}.dot.right{background:var(--right)}.dot.wrong{background:var(--wrong)}
.dot.unsure{background:var(--unsure)}.dot.none{border:1.5px dashed var(--unsure)}
.input{background:var(--panel);border-radius:20px;padding:16px 18px;margin-bottom:16px;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:var(--shadow);font-weight:600}
.input .lab,.pane .lab{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--mist)}
.versus{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:16px;align-items:start}
.pane{background:var(--panel);border-radius:24px;padding:18px;box-shadow:var(--shadow);border-top:4px solid var(--teal)}.pane.t{border-top-color:var(--tgt)}
.pane .head{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.reply{border-top:1px solid var(--line2);margin-top:8px;padding-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.grade{font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.12em;padding:2px 8px;border-radius:999px}
.grade.right{background:#d7f3e9;color:var(--right)}.grade.wrong{background:#fde1db;color:var(--wrong)}.grade.unsure{background:var(--soft);color:var(--mist)}
textarea{width:100%;min-height:80px;background:var(--soft);border:0;border-radius:16px;color:var(--fog);font:inherit;padding:12px}
.btn{background:var(--sun);color:#4a3200;border:0;border-radius:999px;padding:11px 22px;font:inherit;font-weight:800;cursor:pointer;margin-top:8px;box-shadow:0 8px 18px rgba(249,196,64,.35)}
.btn[disabled]{opacity:.5;cursor:default;box-shadow:none}
.run{display:grid;gap:12px}.run .row{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.btn.stop{background:#fde1db;color:var(--wrong);box-shadow:none}.btn.top{margin-top:0}.btn.wide{width:100%;padding:13px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:10px}.facts>*{background:var(--soft);border-radius:14px;padding:8px 12px;display:grid;gap:2px}
.facts small{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}.facts b{font-size:16px;font-weight:800}
.facts select{background:none;border:0;padding:0;font:inherit;font-size:16px;font-weight:800;color:var(--fog);width:100%;cursor:pointer}
.state{display:flex;gap:8px;align-items:center;font-size:12.5px;font-weight:700;color:var(--mist)}.state i{width:8px;height:8px;border-radius:50%;background:var(--unsure);flex:none}
.state.on{color:var(--teal)}.state.on i{background:var(--teal2);animation:p 1.2s infinite}.state.warn{color:#9a5b00}.state.warn i{background:var(--sun)}
.panel.run{display:grid;gap:14px;padding:18px}.panel.run>*{margin:0}
.run .meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--mist);font-weight:600}.run .meta b{color:var(--fog);font-weight:800}
.run .meta label{display:inline-flex;align-items:center;gap:6px}.run .meta select{font:inherit;font-weight:800;color:var(--fog);background:var(--soft);border:0;border-radius:8px;padding:3px 6px;cursor:pointer}
.run .sec{display:grid;gap:8px;padding-top:14px;border-top:1px solid var(--line2)}
.run .sec>h5{margin:0;display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
.run .sec>h5 span{letter-spacing:0;text-transform:none;font-weight:600;font-size:12px}
.steps{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:13px;font-variant-numeric:tabular-nums;line-height:1.35}
.steps li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:8px;align-items:baseline}.steps li>span:first-child{color:var(--right);font-weight:800;text-align:center}
/* the third thing in a row is how long it took, kept on one line; a row of two (what was learned, what was recovered) has no such
   thing, and its words wrap inside the card */
.steps li>span{min-width:0;overflow-wrap:anywhere}.steps li>span:nth-child(3){color:var(--mist);font-size:12px;white-space:nowrap}.steps li b{overflow-wrap:anywhere}.steps .cur{color:var(--teal);font-weight:800}.steps .cur>span:first-child{color:var(--teal2)}.steps .cur>span:nth-child(3){color:var(--teal)}
.state.running{align-items:flex-start}.state.running i{margin-top:5px}.state.running span{display:grid;gap:1px}.state.running b{font-size:14px;font-weight:800;color:var(--teal)}.state.running small{font-size:12px;font-weight:600;color:var(--mist)}
.run .sec>p{margin:0}
.steps .bad,.steps .bad>span:first-child{color:var(--wrong)}.steps small{font-size:12px;line-height:1.35}
.pulse{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--teal2);animation:p 1.2s infinite}@keyframes p{50%{opacity:.25}}
.feed{margin:0;padding:0;list-style:none;display:grid;gap:10px}.feed li{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
.feed .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--teal)}
.feed b{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.feed small{color:var(--mist);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}html{scroll-behavior:auto}}
@media (max-width:1200px){.shell{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}
@media (max-width:900px){.picks .group.small.n4 .pick{flex:1 1 40%}}
@media (max-width:560px){.picks .pick,.picks .pick.target,.picks .group.small.n4 .pick{flex:1 1 100%}}
@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.charts,.two,.io,.versus{grid-template-columns:minmax(0,1fr)}
.stages{grid-auto-columns:minmax(170px,46%)}.qlist{max-height:260px}}
@media (max-width:560px){.stages{grid-auto-columns:minmax(170px,82%)}.kpis{grid-template-columns:minmax(0,1fr)}main{padding:18px 16px 40px}h1{font-size:27px}.panel{padding:16px;border-radius:20px}}
"""

JS = """
const $=(s,r=document)=>r.querySelector(s);
async function swap(url,into,opts){const r=await fetch(url,opts);$(into).innerHTML=await r.text();if(typeof sinceTick==='function')sinceTick();}
document.addEventListener('click',async(ev)=>{
  const q=ev.target.closest('.q');
  if(q){document.querySelectorAll('.q[aria-current]').forEach(x=>x.removeAttribute('aria-current'));q.setAttribute('aria-current','true');
    await swap('/fragment/question?split='+q.dataset.split+'&id='+encodeURIComponent(q.dataset.id),'#detail');return;}
  const t=ev.target.closest('[data-split-tab]');
  if(t){await swap('/fragment/list?split='+t.dataset.splitTab,'#io');return;}
  const f=ev.target.closest('[data-filter]');
  if(f){document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===f)));
    document.querySelectorAll('.q').forEach(x=>{x.hidden=f.dataset.filter!=='all'&&x.dataset.cmp!==f.dataset.filter;});return;}
  if(ev.target.id==='run-go'||ev.target.id==='run-stop'){const b=ev.target;b.disabled=true;
    if(b.id==='run-go')document.querySelectorAll('[data-pick]').forEach(x=>x.disabled=true);
    const body=b.id==='run-go'?JSON.stringify({each:Number($('#run-each').value)}):'{}';
    await swap(b.id==='run-go'?'/run/start':'/run/stop','#run',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body});watch();return;}
});
// A MODEL CHOSEN: written down, and everything that depends on it drawn again in place
document.addEventListener('change',async(ev)=>{const s=ev.target.closest('[data-pick]');if(!s)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({[s.dataset.pick]:s.value})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/chips','#chips');await swap('/fragment/run','#run');liveTick();}else{alert(await r.text());await swap('/fragment/picks','#picks');}});
// WHAT IT IS TO BE EQUIVALENT ON: the boxes ticked are written down, and the row drawn again in place
document.addEventListener('change',async(ev)=>{const b=ev.target.closest('[data-equiv]');if(!b)return;
  const want=[...document.querySelectorAll('[data-equiv]:checked')].map(x=>x.dataset.equiv);
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({equivalence:want})});
  if(!r.ok)alert(await r.text());
  await swap('/fragment/equiv','#equiv');});
// THE UNINSTALL HELPER: what is installed here, and a piece removed only once its removal has been confirmed
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#tidy-open')){$('#tidy-body').innerHTML='<p class="muted">Measuring what is installed here...</p>';$('#tidy').showModal();await swap('/fragment/tidy','#tidy-body');return;}
  if(ev.target.id==='tidy-close'||ev.target.id==='tidy'){$('#tidy').close();return;}
  const b=ev.target.closest('[data-tidy]');if(!b)return;
  const again=b.dataset.used==='1'?' It is part of the swarm as configured: Run training fetches it again.':'';
  if(!confirm('Remove '+b.dataset.what+' ('+b.dataset.size+')? This cannot be undone.'+again))return;
  b.disabled=true;b.textContent='Removing';
  const r=await fetch('/uninstall',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({id:b.dataset.tidy})});
  if(!r.ok){alert(await r.text());await swap('/fragment/tidy','#tidy-body');return;}
  $('#tidy-body').innerHTML=await r.text();
});
// THE QUESTIONS FOR ONE BODY OF WORK: the pencil opens them; a row is added, changed or taken out, and Save writes them all
const qCount=()=>{const n=document.querySelectorAll('#qlist .qrow').length;const c=$('#qcount');if(c)c.textContent=n+' of 200';const a=$('#qadd');if(a)a.disabled=n>=200;};
document.addEventListener('click',async(ev)=>{
  const pen=ev.target.closest('[data-qedit]');
  if(pen){await swap('/fragment/questions?id='+encodeURIComponent(pen.dataset.qedit),'#qedit-body');qCount();$('#qedit').showModal();return;}
  if(ev.target.id==='qedit-close'||ev.target.id==='qedit'){$('#qedit').close();return;}
  if(ev.target.id==='qadd'){const li=$('#qrow').content.firstElementChild.cloneNode(true);$('#qlist').appendChild(li);li.querySelector('textarea').focus();qCount();return;}
  if(ev.target.closest('[data-q-del]')){ev.target.closest('.qrow').remove();qCount();return;}
  if(ev.target.id==='qsave'){const b=ev.target;b.disabled=true;
    const questions=[...document.querySelectorAll('#qlist .qrow')].map(li=>({ask:li.querySelector('[data-q-ask]').value,mode:(li.querySelector('[data-q-mode]')||{}).value||undefined}));
    const r=await fetch('/questions',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({id:$('#qlist').dataset.target,questions})});
    b.disabled=false;if(!r.ok){alert(await r.text());return;}
    $('#equiv').innerHTML=await r.text();$('#qedit').close();}
});
// THE OUTPUT SPEC: what the swarm as it stands is, in one document
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#spec-open')){await swap('/fragment/spec','#spec-body');$('#spec').showModal();return;}
  if(ev.target.id==='spec-close'||ev.target.id==='spec'){$('#spec').close();return;}
  if(ev.target.closest('#score-open')){await swap('/fragment/scorefull','#big-body');$('#big').showModal();return;}
  if(ev.target.id==='big-close'||ev.target.id==='big'){$('#big').close();return;}
  if(ev.target.id==='spec-copy'){try{await navigator.clipboard.writeText($('#spec-json').textContent);ev.target.textContent='Copied';}catch(e){ev.target.textContent='Select it below';}}
});
// while a pass runs, its steps are asked for again every few seconds; when it ends the rest of the page is read again once
let timer=null;
function watch(){if(timer)return;timer=setInterval(async()=>{const was=!!$('#run [data-running]');await swap('/fragment/run','#run');
  if(!$('#run [data-running]')){clearInterval(timer);timer=null;if(was){await swap('/fragment/body','#body');await swap('/fragment/picks','#picks');}}
  else{await swap('/fragment/score','#score');if($('#plan'))await swap('/fragment/plan','#plan');
    if($('#io-wrap')&&!$('#io'))await swap('/fragment/io','#io-wrap');
    await swap('/fragment/chips','#chips');
    if($('#spec').open){const y=$('#spec').scrollTop;await swap('/fragment/spec','#spec-body');$('#spec').scrollTop=y;}}},4000);}
if($('#run [data-running]'))watch();
// WHAT EVERY SLOT IS DOING NOW: asked for every second and a half while a session runs, and written onto the cards in place
const STEP={measure:'Measuring the swarm',improve:'Trying a brief',arrange:'Trying an arrangement',baseline:'One model alone'};
function paint(el,cls,text){el.className='live '+cls;const sp=el.querySelector('span');if(sp.textContent!==text){sp.textContent=text;el.title=text;}}
// WHEN THE SESSION BEGAN, in the time zone of the person looking, and how long it has run in all: written again every tick
function sinceTick(){const el=$('[data-since]');if(!el)return;const t=Number(el.dataset.since),s=Math.max(0,Math.floor((Date.now()-t)/1000));
  const span=s<60?s+' s':s<3600?Math.floor(s/60)+' min '+s%60+' s':Math.floor(s/3600)+' h '+Math.floor(s%3600/60)+' min';
  el.querySelector('b').textContent='Running '+span;el.querySelector('small').textContent='since '+new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'});}
async function liveTick(){
  sinceTick();
  let n={};try{n=await (await fetch('/api/live')).json();}catch(e){return;}
  const now=$('#now');
  if(now){const q=n.question;now.className='now'+(q?' on':'');
    const nowText=q?(STEP[n.trainer]||'Working')+' · '+(n.who==='swarm'?'the swarm':n.whoName+' alone')+' · '+n.split+' question '+n.n+' of '+n.of+' · '+q.ask.replace(/\\s+/g,' ').slice(0,150)
      :n.running?'A session is running. Between steps: models are loading or unloading.':'Nothing is running. No model is loaded.';
    now.querySelector('span').textContent=nowText;now.title=nowText;}
  const slots=n.slots||{},totals=n.totals||{};
  // a slot's clock starts again with every question (a turn). Beside it: which turn this is, and how long this slot has been
  // engaged altogether in the step in hand.
  const secs=ms=>ms<60000?(ms/1000).toFixed(ms<10000?1:0)+' s':Math.floor(ms/60000)+' min '+Math.round(ms%60000/1000)+' s';
  const sofar=(id,extra)=>{const t=totals[id]||totals[id+'-alone'];const ms=(t?t.ms:0)+(extra||0),turns=(t?t.turns:0);
    return {turns,text:turns||extra?' · '+secs(ms)+' in all this step':''};};
  document.querySelectorAll('[data-live]').forEach(el=>{
    const id=el.dataset.live,s=slots[id]||slots[id+'-alone'];
    if(!s){const t=sofar(id);paint(el,'', (n.question&&n.who==='swarm'&&id!=='target'?'Waiting its turn':'Idle')+(t.turns?' · '+t.turns+(t.turns===1?' turn':' turns')+t.text:''));return;}
    if(s.state==='working'){const now=Math.max(0,Date.now()-s.since),t=sofar(id,now);
      paint(el,'on','Working · '+Math.round(now/1000)+' s this turn · turn '+(t.turns+1)+t.text);}
    else{const t=sofar(id);paint(el,s.state==='failed'?'bad':'done',(s.state==='failed'?'Failed':'Answered')+' in '+(s.ms/1000).toFixed(1)+' s · turn '+t.turns+t.text+(s.said?' · '+s.said:''));}
  });
  // each small model answering alone shows on its own slots, since it is that model at work
  const alone=n.who&&n.who!=='swarm'&&n.who!=='target'&&slots[n.who];
  if(alone)document.querySelectorAll('.slot.'+n.who+' [data-live]').forEach(el=>{const s=slots[n.who];
    if(s.state==='working')paint(el,'on','Answering alone · '+Math.max(0,Math.round((Date.now()-s.since)/1000))+' s');else paint(el,'done','Answered alone in '+(s.ms/1000).toFixed(1)+' s');});
}
setInterval(liveTick,1500);liveTick();
"""


# ---------------------------------------------------------------- pieces
def grade_dot(g):
    return '<span class="dot %s" title="%s"></span>' % (e(g or "none"), e(g or "not asked"))


def bar(name, cls, p):
    """One answerer beside the larger model: answers equivalent to its answers, different ones, none."""
    n = max(1, p["compared"])
    pct = lambda k: 100.0 * p[k] / n  # noqa: E731
    return (
        '<div class="bar"><div class="name %s">%s</div><div class="n">%s</div><div class="track" role="img" aria-label="%d equivalent, %d different, %d none, of %d">'
        '<i class="r" style="width:%.2f%%"></i><i class="w" style="width:%.2f%%"></i><i class="u" style="width:%.2f%%"></i></div></div>'
        % (cls, e(name), e(how_far(p["equivalent"], p["compared"])), p["equivalent"], p["differ"], p["none"], p["compared"], pct("equivalent"), pct("differ"), pct("none"))
    )


# ---------------------------------------------------------------- charts, drawn here: no library
ICONS = {
    "check": '<path d="M5 12l4 4 10-10"/>',
    "target": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    "scale": '<path d="M12 4v16M5 8h14M5 8l-2 6h4zM19 8l-2 6h4z"/>',
    "clock": '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
}


def kpi(label, value, pill, icon, color, bg, pill_cls=""):
    return (
        '<div class="kpi" style="--c:%s;--bg:%s"><div class="top"><span class="ic"><svg viewBox="0 0 24 24">%s</svg></span><span class="pill %s">%s</span></div>'
        '<div class="lab">%s</div><div class="val">%s</div></div>' % (color, bg, ICONS[icon], pill_cls, e(pill), e(label), value)
    )


def _smooth(pts):
    """A path through the points with rounded turns (each segment eased through its midpoint)."""
    if len(pts) < 2:
        return ""
    d = "M%.1f %.1f" % pts[0]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        mx = (x0 + x1) / 2
        d += " C%.1f %.1f %.1f %.1f %.1f %.1f" % (mx, y0, mx, y1, x1, y1)
    return d


def line_chart(labels, series, total):
    """series: [(name, colour, dashed, [a count of answers, or None])] over the same labels; the scale runs from 0 to total."""
    w, h, l, r, t, b = 640, 250, 38, 16, 14, 30
    n = max(1, len(labels))
    xs = [l + (w - l - r) * (i / (n - 1) if n > 1 else 0.5) for i in range(n)]
    total = max(1, total)
    y = lambda v: t + (h - t - b) * (1 - v / total)  # noqa: E731
    out = ['<svg viewBox="0 0 %d %d" role="img" aria-label="Answers equivalent to the larger model\'s, pass by pass">' % (w, h)]
    for g in sorted({0, round(total / 4), round(total / 2), round(3 * total / 4), total}):
        out.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#e6efec"/><text x="%d" y="%.1f" text-anchor="end">%d</text>' % (l, w - r, y(g), y(g), l - 6, y(g) + 3, g))
    for i, lab in enumerate(labels):
        out.append('<text x="%.1f" y="%d" text-anchor="middle">%s</text>' % (xs[i], h - 8, e(str(lab).upper())))
    for name, colour, dashed, vals in series:
        pts = [(xs[i], y(v)) for i, v in enumerate(vals) if v is not None]
        if len(pts) > 1:
            out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"%s/>' % (_smooth(pts), colour, 3 if dashed else 4.5, ' stroke-dasharray="2 9"' if dashed else ""))
        for px, py in pts[-1:] if len(pts) > 1 else pts:
            out.append('<circle cx="%.1f" cy="%.1f" r="5" fill="#fff" stroke="%s" stroke-width="3"><title>%s</title></circle>' % (px, py, colour, e(name)))
    out.append("</svg>")
    return "".join(out)


def donut(parts, total, label):
    """parts: [(name, colour, count)]"""
    r, c = 78, 2 * 3.14159265 * 78
    out = ['<svg viewBox="0 0 210 210" role="img" aria-label="%s"><circle cx="105" cy="105" r="%d" fill="none" stroke="#e6efec" stroke-width="24"/>' % (e(label), r)]
    at = 0.0
    for name, colour, n in parts:
        if not n or not total:
            continue
        frac = n / total
        out.append('<circle cx="105" cy="105" r="%d" fill="none" stroke="%s" stroke-width="24" stroke-dasharray="%.2f %.2f" stroke-dashoffset="%.2f" transform="rotate(-90 105 105)"><title>%s: %d</title></circle>'
                   % (r, colour, frac * c, c, -at * c, e(name), n))
        at += frac
    out.append('<text class="n" x="105" y="108" text-anchor="middle">%d</text><text class="l" x="105" y="126" text-anchor="middle">%s</text></svg>' % (total, e(label.upper())))
    return "".join(out)


KIND_WORDS = {"write-arrays": "Write a function: arrays", "write-strings": "Write a function: strings", "write-numbers": "Write a function: numbers",
              "write-parsing": "Write a function: parsing", "fix": "Correct a function", "bug": "Say what is wrong", "trace": "Say what a program prints",
              "answer": "Simple: an everyday question", "request": "Simple: something it cannot do, or needs to ask about", "piece": "Simple: a piece of writing", "talk": "Simple: conversation",
              "practice": "Developer: a question of good practice", "shown": "Developer: their own project",
              "chain": "Math: sums in a row", "shop": "Math: a word problem", "rate": "Math: rates", "units": "Math: units", "count": "Math: counting",
              "order": "Logic: an order", "day": "Logic: a day of the week", "trap": "Logic: the first answer is wrong",
              "letters": "Reasoning: counting letters", "string": "Reasoning: a word changed in steps", "extract": "Reasoning: a figure read from a passage"}


def kind_bars(kinds):
    """How far along each kind of question is: one row for each, the name in words, a bar, and the count and percentage behind
    it. Rows, not columns: a name is as long as it needs to be and nothing runs into anything."""
    rows = []
    for name, k in sorted(kinds.items(), key=lambda kv: (kv[1]["s"] / kv[1]["n"] if kv[1]["n"] else 0)):
        share = k["s"] / k["n"] if k["n"] else 0
        cls = "full" if k["n"] and k["s"] == k["n"] else "mid" if share >= 0.5 else "low"
        rows.append('<li class="%s"><span class="kn">%s</span><span class="kt"><i style="width:%.1f%%"></i></span><span class="kc"><b>%s%%</b> · %d of %d</span></li>'
                    % (cls, e(KIND_WORDS.get(name, name)), 100 * share, fmt_pct(int(1000 * share) / 10), k["s"], k["n"]))
    return '<ul class="kinds">%s</ul>' % "".join(rows)


def scoreboard(d):
    held = d["splits"]["held"]
    tgt = d["target"]
    tname = tgt["name"] if tgt else "the larger model"
    short = tname.split(" ")[0]
    p = held["parity"]
    if not held["swarm"] or not p:
        return (
            '<div class="panel"><p class="verdict">Not measured yet.</p><p class="muted" style="margin:0">No pass has put the swarm and %s to the same held questions. '
            "Press <b>Run training</b>, or run <code>bash training/session.sh</code>; this page fills in as it goes.</p></div>" % e(tname)
        )
    off = p["compared"] - p["equivalent"]
    out = ['<div class="kpis">']
    out.append(kpi("Toward parity with " + short, "%s<small>%%</small>" % fmt_pct(p["percent"]), "at parity" if p["level"] else "%d of %d equivalent" % (p["equivalent"], p["compared"]), "scale", "#0b5d57", "#d9f2ec", "up" if p["level"] else ""))
    out.append(kpi("Equivalent answers", "%d <small>of %d</small>" % (p["equivalent"], p["compared"]), "to " + short, "check", "#149a72", "#d7f3e9"))
    out.append(kpi("Different answers", "%d <small>of %d</small>" % (p["differ"], p["compared"]), "%d gave none" % p["none"], "target", "#f2644b", "#fde1db"))
    out.append(kpi("Seconds a reply", "%s <small>s</small>" % p["seconds"], "the swarm", "clock", "#c98a06", "#fdf0cf"))
    out.append("</div>")

    # pass by pass: how many answers are equivalent, against all of them (which is parity)
    hist = [h for h in d["state"].get("history", []) if h.get("compared")]
    labels = ["pass %s" % h["pass"] for h in hist] + ["now"]
    sw = [h["equivalent"] * p["compared"] / h["compared"] for h in hist] + [p["equivalent"]]
    verdict = '<p class="verdict %s" style="margin-top:12px">%s</p><p class="muted small" style="margin:0">Parity is every answer fundamentally equivalent to %s\'s. On %d held questions the swarm\'s answer was equivalent on %d, different on %d, and it gave none on %d. Whether either was right is not what is measured.</p>' % (
        "level" if p["level"] else "behind", e(verdict_words(p, tname)), e(tname), p["compared"], p["equivalent"], p["differ"], p["none"])
    out.append(
        '<div class="charts"><div class="panel tint"><div class="chart-head"><div><h3>Toward parity, pass by pass</h3><div class="muted small">Held answers equivalent to %s\'s. Parity is all %d</div></div>'
        '<div class="legend"><span><i style="background:#0b5d57"></i>The swarm</span><span><i style="background:#9aa8a5"></i>Parity</span></div></div><div class="plot">%s</div>%s</div>'
        % (e(short), p["compared"], line_chart(labels, [("Parity: every answer", "#9aa8a5", True, [p["compared"]] * len(labels)), ("The swarm", "#0b5d57", False, sw)], p["compared"]), verdict)
    )
    # how each reply was reached
    paths = {}
    for r in held["swarm"]:
        key = str(r.get("path", "")).split("+")[0]
        key = "Drafts agreed" if key == "agreed" else "Kev decided" if key.startswith("decided") else "Most slots" if key == "most" else "Other"
        paths[key] = paths.get(key, 0) + 1
    order = [("Drafts agreed", "#0b5d57"), ("Kev decided", "#f2644b"), ("Most slots", "#f9c440"), ("Other", "#9aa8a5")]
    parts = [(n, c, paths.get(n, 0)) for n, c in order if paths.get(n)]
    out.append(
        '<div class="panel tint"><h3>How replies were reached</h3><div class="muted small">Which step settled the answer</div><div class="donut">%s</div><div class="keys">%s</div></div></div>'
        % (donut(parts, len(held["swarm"]), "questions"), "".join('<div><i style="background:%s"></i><span>%s</span><span>%d%%</span></div>' % (c, e(n), round(100 * k / len(held["swarm"]))) for n, c, k in parts))
    )
    # kind by kind, and each small model alone
    kinds = {}
    for r in held["swarm"]:
        if r.get("grade") == "noref":
            continue
        k = kinds.setdefault(r["kind"], {"n": 0, "s": 0})
        k["n"] += 1
        k["s"] += r.get("grade") == "right"
    bars = [bar("The swarm", "who-swarm", p)]
    for k, rows in held["alone"].items():
        pa = data.parity(rows) if rows else None
        if pa:
            bars.append(bar(data.MEMBER_NAMES[k] + " alone", "muted", pa))
    out.append(
        '<div class="charts"><div class="panel"><div class="chart-head"><div><h3>How far along each kind of question is</h3><div class="muted small">The share of held answers of that kind that are equivalent to %s&#39;s, furthest behind first. Teal: all of them</div></div></div><div class="kb">%s</div></div>'
        '<div class="panel"><h3>Each alone, beside the swarm</h3><div class="muted small" style="margin-bottom:14px">Equivalent to %s&#39;s answer · different · none</div><div class="score">%s</div></div></div>'
        % (e(short), kind_bars(kinds), e(short), "".join(bars))
    )
    return "".join(out)


def how_far(equivalent, compared):
    """HOW FAR ALONG, SAID ONE WAY wherever it is said: the percentage, then the count it is made of. '59.5% · 25 of 42'.
    The page has many places that say it (the strip, the header, the passes, each kind, each model alone, the spec); they all say
    it with this, from the same two numbers, so no two of them can disagree."""
    return "%s%% · %d of %d" % (fmt_pct(data.percent(equivalent, compared)), equivalent, compared)


def fmt_pct(x):
    """A percentage as it is said: 63, 62.5, and 100 only when it is 100."""
    return ("%d" % x) if float(x) == int(x) else ("%.1f" % x)


def verdict_words(p, tname):
    """The verdict on the held questions, in the one sentence it is given in everywhere."""
    if p["level"]:
        return "100%%: at parity with %s. All %d held answers are equivalent." % (tname, p["compared"])
    return "%s%% of the way to parity with %s: %d of %d held answers are equivalent." % (fmt_pct(p["percent"]), tname, p["equivalent"], p["compared"])


def score_strip(d):
    """Parity in one strip, the same size at every moment, saying the most that is known so far and what kind of knowledge it is:
    the verdict when the held questions are all answered; before that, how the held or the train questions are going as the
    answers come; before that, what the larger model and each small model alone have done. The whole measurement opens from it."""
    held, train = d["splits"]["held"], d["splits"]["train"]
    tgt = d["target"]
    tname = tgt["name"] if tgt else "the larger model"
    p = held["parity"]

    def alone_of(sp):
        out = []
        for k, rows in sp["alone"].items():
            pa = data.parity(rows) if rows else None
            if pa:
                out.append("<span>%s alone <b>%s%%</b> · %d of %d</span>" % (e(data.MEMBER_NAMES[k]), fmt_pct(pa["percent"]), pa["equivalent"], pa["compared"]))
        return "".join(out)

    def strip(cls, verdict, meta, more=True, pct=None):
        tag = ('<button type="button" class="panel strip" id="score-open" title="Open the whole measurement">', "</button>") if more else ('<div class="panel strip">', "</div>")
        bar = '<span class="prog" title="%s%% of these answers are equivalent"><i class="eq" style="width:%s%%"></i></span>' % (fmt_pct(pct), pct) if pct is not None else ""
        return '%s<p class="verdict %s">%s</p>%s<p class="meta">%s%s</p>%s' % (
            tag[0], cls, e(verdict), bar, meta, '<span class="more">Open the whole measurement</span>' if more else "", tag[1])

    def counts(q):
        spec = q.get("onSpec") or {}
        return "<span><b>%d</b> equivalent</span><span><b>%d</b> different</span><span><b>%d</b> no answer</span>%s" % (
            q["equivalent"], q["differ"], q["none"],
            '<span title="Parity is equivalence with the larger model whatever it answers. This is the same count on the questions where its own answer does what the question says">where %s follows the question <b>%s%%</b> · %d of %d</span>'
            % (e(tname.split(" ")[0]), fmt_pct(data.percent(spec["equivalent"], spec["compared"])), spec["equivalent"], spec["compared"]) if spec.get("compared") and spec["compared"] < q["compared"] else "")
    if held["swarm"] and p:
        done, want = len(held["swarm"]), held["expected"] or len(held["swarm"])
        off = p["compared"] - p["equivalent"]
        if done < want:
            # the held questions are being answered now: what there is, and that it is not yet the verdict
            return strip("", "Being measured: %s%% so far. %d of %d held answers in, %d equivalent to %s's." % (fmt_pct(p["percent"]), done, want, p["equivalent"], tname),
                         counts(p) + alone_of(held) + "<span><b>%s</b> s a reply</span><span>The verdict is given when all %d are answered</span>" % (e(str(p["seconds"])), want), pct=p["percent"])
        return strip("level" if p["level"] else "behind",
                     verdict_words(p, tname),
                     "<span><b>%d</b> held questions</span>" % p["compared"] + counts(p) + alone_of(held) + "<span><b>%s</b> s a reply</span>" % e(str(p["seconds"])), pct=p["percent"])
    pt = train["parity"]
    if train["swarm"] and pt:
        done, want = len(train["swarm"]), train["expected"] or len(train["swarm"])
        return strip("", "%s%% on this pass's train questions%s: %d of %d answers are equivalent to %s's." % (fmt_pct(pt["percent"]), " so far" if done < want else "", pt["equivalent"], pt["compared"], tname),
                     ("<span><b>%d</b> of %d answered</span>" % (done, want) if done < want else "") + counts(pt) + alone_of(held)
                     + "<span><b>%s</b> s a reply</span><span>These choose what to try. Parity is said on the held questions, at the end of the pass</span>" % e(str(pt["seconds"])), more=False, pct=pt["percent"])
    answered = len(held["target"])
    if answered or alone_of(held):
        return strip("", "%s has answered %d held question%s. The swarm has not answered yet." % (tname, answered, "" if answered == 1 else "s"),
                     (alone_of(held) or "<span>Each small model alone is next</span>") + "<span>Its answers are the mark everything else is compared with</span>", more=False)
    return scoreboard(d)


FOUND = {"drafts-short": "no slot had the answer", "weak-draft": "a weak drafter", "check-worse": "a checker turning answers away", "decider-threw": "the decider chose another",
         "writer-changed": "the writer changed the answer", "silent": "a slot that said nothing", "replay": "the last measurement replayed: it would have won answers"}
STATUS = {"planned": "Planned", "running": "Being measured", "kept": "Kept", "not kept": "Not kept"}


def work_of(root, key):
    """Where the configured swarm's own pass is kept (its steps, its plan): under its name, or, in a folder from before that, in
    the one place."""
    base = Path(root) / ".work" / "train"
    return base / key if key and (base / key).is_dir() else base


def read_plan(d):
    """The plan of the pass in hand, for the swarm as it is configured; a plan of another pass or another swarm is not this one."""
    p = data._json(work_of(d["root"], d.get("key")) / "plan.json", None)
    if not isinstance(p, dict) or p.get("pass") != d["state"].get("pass", 0) + 1 or p.get("config") not in (None, d["cfg"]):
        return None
    if p.get("target") and d["target"] and p["target"] != d["target"]["id"]:
        return None
    return p


def plan_panel(d):
    """THE STRATEGY BEING EXECUTED: what this pass found, what it chose to try because of it, in order, and what became of each."""
    p = read_plan(d)
    n = d["state"].get("pass", 0) + 1
    if not p:
        return (
            '<div class="panel plan"><div class="plan-head"><h3>The plan for pass %d</h3><span class="muted small">Not written yet</span></div>'
            '<p class="muted" style="margin:8px 0 0">A pass writes its plan when it begins, from what the last pass left, and writes it again once it has measured the swarm on its own questions: '
            "where the answers were lost decides which slots are told something else, which arrangements are tried, and in what order.</p></div>" % n
        )
    moves = p.get("moves") or []
    done = [m for m in moves if m.get("status") in ("kept", "not kept")]
    kept = [m for m in moves if m.get("status") == "kept"]
    based = {"this-pass": "From this pass's measurement of the swarm on its train questions", "last-pass": "From what the last pass measured. It is written again when this pass has measured the swarm",
             "nothing": "Nothing is measured yet, so the checkers come first and one arrangement of each kind. It is written again when this pass has measured the swarm"}.get(p.get("basedOn"), "")
    out = ['<div class="panel plan"><div class="plan-head"><h3>The plan for pass %d</h3><span class="muted small">%d moves · %d measured · %d kept</span></div><p class="muted small" style="margin:4px 0 0">%s.</p>'
           % (n, len(moves), len(done), len(kept), e(based))]
    g = p.get("gap")
    if g:
        ch = max(0.0, g["reachableByChoosing"] - g["percent"])
        out.append('<h4>The gap, on the train questions</h4><p class="small" style="margin:0"><b class="pct" style="font-size:20px">%s%%</b> on this pass&#39;s train questions: <b>%d</b> answers to close. '
                   '<span class="muted">These are the questions a pass chooses on. How far the swarm is toward parity is said on the held questions, above.</span></p>'
                   '<span class="prog" style="height:12px"><i class="eq" style="width:%s%%"></i><i class="ch" style="width:%s%%"></i></span>'
                   '<p class="gapkey"><span><i style="background:var(--right)"></i>equivalent now: %s%%</span><span><i style="background:var(--sun)"></i>on the table but not chosen: <b>%d</b> answers. Choosing better alone could reach %s%%</span>'
                   '<span><i style="background:var(--soft)"></i>no slot had it: <b>%d</b> answers. These need better drafts</span></p>'
                   % (fmt_pct(g["percent"]), g["toClose"], g["percent"], ch, fmt_pct(g["percent"]), g["choosing"], fmt_pct(g["reachableByChoosing"]), g["drafting"]))
    m = p.get("measured")
    finds = p.get("findings") or []
    if m:
        out.append('<h4>What the measurement showed</h4><p class="small" style="margin:0 0 8px">%d train questions compared: <b>%d</b> equivalent to the larger model\'s answer, <b>%d</b> different, <b>%d</b> with no answer.</p>'
                   % (m.get("compared", 0), m.get("equivalent", 0), m.get("differ", 0), m.get("none", 0)))
        if finds:
            out.append('<ul class="finds">%s</ul>' % "".join('<li><span class="n">%s</span><span>%s</span></li>' % (e(str(x.get("answers", ""))), e(x.get("text", ""))) for x in finds))
        else:
            out.append('<p class="muted small" style="margin:0">Nothing in it points at one stage more than another.</p>')
    if p.get("focus"):
        out.append('<h4>Questions</h4><p class="small" style="margin:0">New train questions, with more of the kinds the last pass answered differently on: %s.</p>'
                   % ", ".join("<b>%s</b> +%s" % (e(x["kind"]), e(str(x["more"]))) for x in p["focus"]))
    # WHAT THE SWARM CANNOT TRY BY ITSELF, measured for a person to decide (members-probe.mjs, decider-replay.mjs)
    wd = work_of(d["root"], d.get("key"))
    mem = data._json(wd / "members.json", None)
    rep = data._json(wd / "decider-replay.json", None)
    if (isinstance(mem, dict) and mem.get("pass") == n) or (isinstance(rep, dict) and rep.get("pass") == n):
        out.append("<h4>What only you can change</h4>")
        if isinstance(mem, dict) and mem.get("pass") == n:
            if mem.get("models"):
                out.append('<p class="small" style="margin:0 0 6px">On the <b>%d</b> train questions no slot drafted: %s. A model that drafts several of them is worth adding as a third small model.</p>'
                           % (mem.get("gap", 0), "; ".join("<b>%s</b> answered %s of %s as the larger model did" % (e(x["name"]), e(str(x.get("drafts", "?"))), e(str(x.get("asked", "?")))) if "drafts" in x else "%s could not be started" % e(x["name"]) for x in mem["models"])))
            else:
                out.append('<p class="small" style="margin:0 0 6px">On the <b>%d</b> train questions no slot drafted, another small model could help. %s</p>' % (mem.get("gap", 0), e(mem.get("why", ""))))
        if isinstance(rep, dict) and rep.get("pass") == n:
            for r in rep.get("results") or []:
                out.append('<p class="small" style="margin:0 0 6px">Put the same choices as the decider, <b>%s</b> chose the larger model&#39;s answer <b>%d</b> times of %d, against %d: it would have recovered %d and lost %d. Worth a real pass if it recovers more than it loses.</p>'
                           % (e(r["decider"]), r.get("theirsRight", 0), r.get("asked", 0), r.get("kevRight", 0), r.get("recovered", 0), r.get("lost", 0)))
    # HOW IT IS TRAINING, which is itself changed by the pass: the margin in force, and what its review of itself changed and why
    pol = d.get("policy") or {}
    log = [x for x in d.get("policyLog") or [] if x.get("pass") == n]
    out.append('<h4>How it is training</h4><p class="small" style="margin:0">A change is kept if, question by question, it wins <b>%s</b> more answers than it loses on train and does no worse on held. '
               "This pass tries <b>%s</b> arrangements one change from here and <b>%s</b> that are %s changes from here at once.</p>"
               % (e(str((pol.get("keep") or {}).get("margin", "?"))), e(str((pol.get("trials") or {}).get("arrangements", "?"))), e(str((pol.get("trials") or {}).get("wild", 0))), e(str((pol.get("trials") or {}).get("depth", 2)))))
    if log:
        out.append('<ul class="finds" style="margin-top:8px">%s</ul>' % "".join(
            '<li><span class="n" style="background:#fdf0cf;color:#8a5a00">changed</span><span><code>%s</code>: %s → <b>%s</b>. %s</span></li>'
            % (e(x.get("set", "")), e(json.dumps(x.get("from"))), e(json.dumps(x.get("to"))), e(x.get("why", ""))) for x in log))
    out.append('<h4>Moves, in the order they are measured</h4>')
    if not moves:
        out.append('<p class="muted small" style="margin:0">Nothing is left to try from here: every candidate and every arrangement one step away has been measured and not kept.</p>')
    rows = []
    for x in moves:
        st = x.get("status", "planned")
        where = " · ".join(v for v in [e(x.get("technique", "")), ("%s (%s, %s)" % (e(x["slot"]), e(x.get("stage", "")), e(x.get("model", "")))) if x.get("slot") else "",
                                        '<a href="https://arxiv.org/abs/%s" target="_blank" rel="noopener">arXiv %s</a>' % (e(x["from"]), e(x["from"])) if x.get("from") else ""] if v)
        why = x.get("why") or []
        reason = ("Chosen because of: %s." % ", ".join(sorted({FOUND.get(w.split(":")[0], w) for w in why}))) if why else "The measurement does not point at it. It is here because no pass has tried it."
        r = x.get("result")
        res = ""
        if r and r.get("train") and r.get("now"):
            res = "<small><b style=\"display:inline;font-size:inherit\">Measured:</b> %d equivalent, %d different on train (as it was: %d, %d). %s.</small>" % (
                r["train"].get("right", 0), r["train"].get("wrong", 0), r["now"].get("right", 0), r["now"].get("wrong", 0), e(str(r.get("why", "")).capitalize()))
        rows.append('<li class="%s"><span class="o">%s</span><span class="k %s">%s</span><span class="mv"><b>%s</b><small>%s</small><small>%s</small>%s</span><span class="pill %s">%s</span></li>'
                    % (e(st.replace(" ", "-")), e(str(x.get("order", ""))), e(x.get("kind", "")), e({"brief": "Brief", "plan": "Plan", "arrangement": "Arrangement"}.get(x.get("kind"), x.get("kind", ""))),
                       e(x.get("what", "")), where, e(reason), res, {"kept": "up", "not kept": "down", "running": "running"}.get(st, "planned"), e(STATUS.get(st, st))))
    if rows:
        out.append('<ul class="moves">%s</ul>' % "".join(rows))
    o = p.get("open") or {}
    if o.get("arrangements") is not None:
        out.append('<p class="muted small" style="margin:12px 0 0">%d arrangements one step from this one are untried, %d have been measured and not kept. A move is kept only if it does better on the train questions and no worse on the held ones.</p>'
                   % (o.get("arrangements", 0), o.get("arrangementsTried", 0)))
    out.append("</div>")
    return "".join(out)


def footer():
    mark = ""
    try:
        mark = (Path(__file__).resolve().parent.parent / "assets" / "brand" / "family-office.svg").read_text(encoding="utf-8")
        mark = mark[mark.index("<svg"):].replace("<svg ", '<svg aria-hidden="true" ', 1)
    except (OSError, ValueError):
        mark = ""
    return (
        '<footer class="foot"><div class="brand">%s<div><b>The Swarm</b><small>A Family Office product</small></div></div>'
        '<nav><a href="https://github.com/nseidm1/The-Swarm" target="_blank" rel="noopener">Source</a><a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>'
        '<a href="https://arxiv.org" target="_blank" rel="noopener">Research from arXiv</a></nav>'
        '<div class="fine">Copyright 2026 Family Office. Licensed under the Apache License, Version 2.0: see LICENSE and NOTICE in this folder. Provided as is, without warranty of any kind. '
        "The models named here belong to their makers and are used under their own licences. This page is served from this machine and reads only files in this folder.</div></footer>" % mark
    )


def mark_of(t, row):
    """Was what this slot settled on equivalent to the larger model's answer? The trainers say (same); older rows are compared here."""
    if t.get("same") is not None:
        return bool(t["same"])
    if not row.get("ref"):
        return None
    return data.same_answer(t.get("final"), row["ref"])


def short(final):
    """What a slot settled on, short enough for a card: code as its first line and how long it is."""
    final = str(final or "")
    lines = final.strip().split("\n")
    return lines[0][:60] + (" … (%d lines)" % len(lines) if len(lines) > 1 else "")


def final_chip(final, ok):
    """What a slot settled on, as one line on its card: a mark (equivalent to the larger model's answer, or not), the answer or
    the first line of the code, and for code how long it is. One line always: the whole of it is in the card when it is opened."""
    final = str(final or "").strip()
    cls = "" if ok is None else (" ok" if ok else " no")
    said = "Equivalent to the larger model's answer" if ok else "Not equivalent to the larger model's answer" if ok is not None else "Not compared"
    if not final:
        return '<div class="final%s" title="%s"><span class="mark"></span><span class="what">gave no answer</span></div>' % (cls, e(said))
    lines = final.split("\n")
    code = len(lines) > 1 or bool(re.search(r"\bfunction\b|=>|[{};]", lines[0]))
    return '<div class="final%s" title="%s"><span class="mark"></span><span class="what%s">%s</span>%s</div>' % (
        cls, e(said), " code" if code else "", e(lines[0][:120]), '<span class="len">%d lines</span>' % len(lines) if len(lines) > 1 else "")


def card(cls, title, purpose, slot_id, sub, extra, body, live=True, opened=False):
    return (
        '<details class="slot %s"%s><summary><div class="id">%s</div><div class="purpose">%s</div><div class="sub">%s</div>%s%s</summary>%s</details>'
        % (e(cls), " open" if opened else "", e(title), e(purpose), "".join(sub), extra,
           '<div class="live" data-live="%s"><i></i><span>Idle</span></div>' % e(slot_id) if live else "", body)
    )


def slot_card(s, d, row=None, stage=None, nth=0, last=False, purpose=None):
    """A slot: the model that fills it, what it is for in the arrangement, and (with a row) what it wrote for that input.
    stage, nth, last: which of its turns on that input (a slot can be used in more than one step, and again in a loop)."""
    rec = d["record"].get(s["id"])
    mates = [x["id"] for x in d["briefs"]["slots"] if x["member"] == s["member"]]
    sub = ["<span>%s</span>" % e(s["id"]), "<span>slot %d</span>" % (mates.index(s["id"]) + 1)]
    body = ""
    fin = ""  # what the slot settled on, shown on the card itself so a row of slots can be read at a glance
    if row is None:
        if rec and rec["ran"]:
            sub.append("<span>equivalent %d of %d</span>" % (rec["right"], rec["ran"]))
        body = '<div class="body"><span class="muted small">What it is told%s · up to %d tokens</span>\n%s' % (
            " · temperature %s" % e(str(s["temperature"])) if s.get("temperature") is not None else "", s.get("maxTokens", 0), e(s["brief"]))
        for c in d["candidates"].get(s["id"], []):
            what = "a change to the plan: " + json.dumps(c["plan"]) if c.get("plan") and not c.get("brief") else "another brief"
            body += '<div class="cand">Being tried: <b>%s</b> (%s)%s</div>' % (
                e(c.get("name", "")),
                e(what),
                ' · from <a style="color:inherit" href="https://arxiv.org/abs/%s">arXiv %s</a>' % (e(c["from"]), e(c["from"])) if c.get("from") else "",
            )
        body += "</div>"
    else:
        turns = [x for x in row.get("trace", []) if x["slot"] == s["id"] and (stage is None or x.get("stage") == stage)]
        t = (turns[-1] if last else turns[nth] if nth < len(turns) else None) if turns else None
        if t and t.get("round"):
            sub.append("<span>round %d</span>" % t["round"])
        if not t:
            sub.append("<span>not used on this input</span>")
        else:
            sub.append("<span>%d ms</span>" % t.get("ms", 0))
            if s["stage"] != "write":
                ok = mark_of(t, row)
                fin = final_chip(t.get("final"), ok)
            body = '<div class="body">%s</div>' % e(t.get("out") or t.get("why") or "")
    return card(s["member"], data.MEMBER_NAMES.get(s["member"], s["member"]), purpose or s.get("purpose") or s["stage"], s["id"], sub, fin, body, live=row is None, opened=row is not None and s["stage"] == "write")


def kev_card(d, row=None, nth=0, purpose="Decides which answer stands"):
    """The decision model: the only decider (src/decider.mjs). nth: which of its decisions on that input."""
    if row is None:
        return card("kev", (d.get("decider") or {}).get("name", "Kev"), purpose, "kev-decide", ["<span>kev-decide</span>", "<span>a decision model</span>"], "",
                    '<div class="body">One request, no writing: it is given the question, one worked answer for each different answer and what the checkers said, '
                    "and returns a probability for each answer. No slot judges. If Kev is not running, the answer most slots gave stands. Kev is itself to be trained on the questions the drafts disagreed on.</div>")
    turns = [x for x in row.get("trace", []) if x["slot"] == "kev-decide" and x.get("of") != "replies"]
    t = turns[nth] if nth < len(turns) else None
    if not t:
        return card("kev", (d.get("decider") or {}).get("name", "Kev"), purpose, "kev-decide", ["<span>kev-decide</span>", "<span>not asked on this input</span>"], "", "", live=False)
    fin = ""
    if t.get("final"):
        ok = mark_of(t, row)
        fin = final_chip(t["final"], ok)
    bars = "".join('<div><span>%s</span><span style="background:rgba(255,255,255,.6);border-radius:4px"><i style="width:%.0f%%"></i></span><span class="muted">%.2f</span></div>' % (e(k), 100 * float(p), float(p))
                   for k, p in sorted((t.get("probs") or {}).items()))
    return card("kev", (d.get("decider") or {}).get("name", "Kev"), purpose, "kev-decide", ["<span>kev-decide</span>", "<span>%d ms</span>" % t.get("ms", 0)], fin,
                '<div class="body">%s%s</div>' % (e(t.get("out", "")), '<div class="probs">%s</div>' % bars if bars else ""), live=False, opened=True)


def _flow_words(step):
    if step.get("do") == "repeat":
        return "repeat up to %d times (%s)" % (int(step.get("upTo", 2)), ", ".join(_flow_words(x) for x in step.get("steps", [])))
    return step.get("do", "") + (" (keep %d)" % step["keep"] if step.get("keep") else " (only if sure)" if step.get("sure") else "")


STEP_TITLE = {"expect": "Expect", "draft": "Draft", "try": "Try", "check": "Check", "revise": "Revise", "decide": "Decide", "write": "Write"}


def flow_of(d):
    """The flow of the arrangement as it is: the one it names, or the plain one (src/orchestrate.mjs)."""
    flow = d["briefs"].get("flow")
    return flow if isinstance(flow, list) and flow else [{"do": k} for k in ("draft", "try", "check", "decide", "write")]


def run_card(d, row=None, nth=0):
    """The sandbox: where the answers to a request for a function are run on the same calls (src/behave.mjs)."""
    if row is None:
        return card("run", "The sandbox", "Runs the answers on the same calls", "run", ["<span>run</span>", "<span>no model</span>"], "",
                    '<div class="body">Where a function is asked for, one model writes calls to try while the others draft. Every answer is run on them, where it can reach nothing. '
                    "Answers that return the same are one answer, however differently they are written; one that does not run is none.</div>")
    turns = [x for x in row.get("trace", []) if x.get("stage") == "run"]
    t = turns[nth] if nth < len(turns) else None
    if not t:
        return card("run", "The sandbox", "Runs the answers on the same calls", "run", ["<span>run</span>", "<span>nothing to run on this input</span>"], "", "", live=False)
    return card("run", "The sandbox", "Runs the answers on the same calls", "run", ["<span>run</span>", "<span>%d ms</span>" % t.get("ms", 0)], "", '<div class="body">%s</div>' % e(t.get("out", "")), live=False, opened=True)


def stages(d, row=None):
    """The arrangement as its flow has it: one column for each step, in order, a loop marked as one. A slot stands in every step
    that uses it."""
    slots = d["briefs"]["slots"]
    by_id = {x["id"]: x for x in slots}

    def of(step, dflt):
        return [by_id[i] for i in step.get("slots", []) if i in by_id] if step.get("slots") else [x for x in slots if x["stage"] == dflt]

    seen = {}  # how many columns of each kind have gone before: which of a slot's turns a column shows

    def column(step, loop=None):
        do = step.get("do")
        nth = seen.get(do, 0)
        seen[do] = nth + 1
        cards = []
        if do == "draft":
            cards = [slot_card(x, d, row, "draft", nth) for x in of(step, "draft")]
        elif do == "try":
            cards = [run_card(d, row, nth)]
        elif do == "expect":
            t = next((x for x in (row or {}).get("trace", []) if x.get("stage") == "expect"), None) if row else None
            cards = [card("run", "One slot, asked apart", "Says what each call should give, from the question alone", "expect",
                          ["<span>expect</span>"] + (["<span>%d ms</span>" % t.get("ms", 0)] if t else []), "",
                          '<div class="body">%s</div>' % e((t or {}).get("out", "") if row else "It does not write the function. The answer that gives what it expects on the most calls is backed, and the count is put before the decider."),
                          live=row is None, opened=bool(t))]
        elif do == "check":
            cards = [slot_card(x, d, row, "check", nth, last=bool(loop)) for x in of(step, "check")]
        elif do == "revise":
            cards = [slot_card(x, d, row, "revise", nth, last=bool(loop), purpose="Answers again, shown the other answers") for x in of(step, "draft")]
        elif do == "decide":
            keep = step.get("keep")
            cards = [kev_card(d, row, nth, "Keeps the likeliest %d answers" % keep if keep else "Settles it here if it is sure; otherwise the flow goes on" if step.get("sure") else "Decides which answer stands")]
        elif do == "write":
            w = of(step, "write")
            cards = [slot_card(x, d, row, "write", 0) for x in w]
            if len(w) > 1:
                cards.append('<p class="muted small" style="margin:0">More than one reply is written, and the decider picks which is sent.</p>')
        else:
            return ""
        again = '<span class="again">again while the answers differ, up to %d times</span>' % loop if loop else ""
        return '<div class="stage%s"><div class="t">%s%s</div>%s</div>' % (" loop" if loop else "", e(STEP_TITLE.get(do, do)), again, "".join(cards))

    out = []
    for step in flow_of(d):
        if step.get("do") == "repeat":
            out.extend(column(x, int(step.get("upTo", 2))) for x in step.get("steps", []))
        else:
            out.append(column(step))

    def words(step):
        if step.get("do") == "repeat":
            return "repeat up to %d times (%s)" % (int(step.get("upTo", 2)), ", ".join(words(x) for x in step.get("steps", [])))
        return _flow_words(step)

    line = '<p class="flowline"><b>The flow:</b> %s. %s</p>' % (
        e(" → ".join(words(x) for x in flow_of(d))),
        "This is the plain flow; a pass can change it." if not d["briefs"].get("flow") else "A pass changed it from the plain flow, and can change it again.")
    return (line if row is None else "") + '<div class="stages">%s</div>' % "".join(out)


def at_parity(d, t):
    """Which configurations of small models a pass MEASURED at parity with this larger model. Only what was measured: a
    configuration is listed when its latest pass against this model found every held answer equivalent."""
    latest = {}
    for h in d["state"].get("history") or []:
        if h.get("target") == t["id"] and h.get("config"):
            latest[h["config"]] = h
    rows = [h for h in latest.values() if h.get("level")]
    head = '<div class="lab muted small" style="letter-spacing:.14em;text-transform:uppercase;margin-top:14px">Configurations at parity with it</div>'
    if not rows:
        return head + '<p class="muted small" style="margin:6px 0 0">None yet. A configuration is listed here when a pass finds every one of its held answers equivalent to this model\'s.</p>'
    return head + '<ul class="ladder">%s</ul>' % "".join(
        "<li><b>%s</b> · decided by %s<span class=\"muted small\"> · pass %s, %s of %s equivalent</span></li>"
        % (e(" + ".join(h.get("members") or [h["config"]])), e(h.get("decider") or ""), e(str(h.get("pass", ""))), e(str(h.get("equivalent", ""))), e(str(h.get("compared", ""))))
        for h in rows
    )



def arrangement(d):
    b, t = d["briefs"], d["target"]
    left = (
        '<div class="panel"><div class="now" id="now"><i></i><span>Nothing is running. No model is loaded.</span></div>%s</div>' % stages(d)
    )
    if t:
        serve = "llama.cpp, from " + t["file"] if t.get("engine") == "llama" else (" ".join([t["serve"]["program"]] + [str(a) for a in t["serve"]["args"]]) if isinstance(t.get("serve"), dict) else "")
        ladder = at_parity(d, t)
        right = (
            '<div class="panel target"><div class="lab muted small" style="letter-spacing:.18em;text-transform:uppercase">The larger model</div><h3 style="margin-top:4px">%s</h3><div class="purpose">The mark: its answer is what the swarm must be equivalent to</div>'
            '<div class="live" data-live="target"><i></i><span>Idle</span></div>'
            '<p class="muted small" style="margin:10px 0 6px">One model, one slot, told nothing but the input. %s</p>'
            '<div class="chips">%s%s</div><p class="muted small" style="overflow-wrap:anywhere;margin:10px 0 0">Served by: <code>%s</code></p>%s</div>'
            % (
                e(t["name"]),
                e("By %s." % t["by"] if t.get("by") else ""),
                '<span class="chip"><b>%sB</b> parameters</span>' % e(str(t["params"])) if t.get("params") else "",
                '<span class="chip">about <b>%s GB</b></span>' % e(str(t["memGb"])) if t.get("memGb") else "",
                e(serve),
                ladder,
            )
        )
    else:
        right = '<div class="panel target"><h3>No larger model is named.</h3><p class="muted">Choose one above.</p></div>'
    # the flow can grow to many steps: it has the whole width, one row, and the larger model sits under it
    return '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:18px">%s%s</div><h2 id="strategy">The plan being carried out</h2><div id="plan">%s</div>' % (left, right, plan_panel(d))


WORD = {"right": "equivalent", "wrong": "different", "unsure": "no answer", "noref": "not compared"}


def qlist(d, split):
    sp = d["splits"][split]
    have = [k for k in ("held", "train") if d["splits"][k]["swarm"]]
    tabs = "".join('<button type="button" data-split-tab="%s" aria-pressed="%s">%s questions</button>' % (k, str(k == split).lower(), "Held" if k == "held" else "Train") for k in have) if len(have) > 1 else ""
    if not sp["swarm"]:
        return ""
    filt = "".join(
        '<button type="button" data-filter="%s" aria-pressed="%s">%s</button>' % (k, str(k == "all").lower(), label)
        for k, label in (("all", "All"), ("wrong", "Different"), ("right", "Equivalent"), ("unsure", "No answer"))
    )
    rows = []
    for i, r in enumerate(sp["swarm"]):
        rows.append(
            '<button type="button" class="q" data-split="%s" data-id="%s" data-cmp="%s"%s><span class="t"><span class="muted">%s</span> %s</span>%s</button>'
            % (split, e(r["id"]), e(str(r.get("grade"))), ' aria-current="true"' if i == 0 else "", e(r["kind"]), e(str(r.get("ask", r["id"]))[:90]),
               '<span class="dot %s" title="%s"></span>' % (e(str(r.get("grade"))), e(WORD.get(r.get("grade"), ""))))
        )
    return (
        '<div><div class="tabs">%s</div><div class="tabs">%s</div><p class="muted small" style="margin:0 0 6px">Green: equivalent to the larger model&#39;s answer. Red: a different one.</p><div class="qlist">%s</div></div><div id="detail">%s</div>'
        % (tabs, filt, "".join(rows), question(d, split, sp["swarm"][0]["id"]))
    )


def versus(d, row, trow, tname):
    """One input, and the two outputs side by side: every slot and the swarm's reply on the left, the larger model on the right.
    The larger model's answer is the mark: the swarm's reply, and each slot's answer, is green when it is the same."""
    head = '<div class="input"><div class="lab">Input</div>%s%s</div>' % (
        e(str(row.get("ask", row.get("id", "")))),
        '<div class="muted small" style="margin-top:8px;font-weight:600">%s answered: <b style="color:var(--tgt)">%s</b></div>' % (e(tname), e(str(row["ref"]))) if row.get("ref") else "",
    )
    g = row.get("grade")
    mark = '<span class="grade %s">%s</span>' % (e(g), e(WORD.get(g, ""))) if g in WORD else ""
    # a reply in a conversation that is not equivalent: which of the three it was lost on, and how
    part = {"act": "It did something else with the message", "substance": "It gave the person something different", "conduct": "It broke a convention the larger model kept"}.get(row.get("part"))
    if part and g == "wrong":
        mark += '<div class="muted small" style="margin:4px 0 6px;font-weight:600">%s%s</div>' % (e(part), (": " + e(row.get("markWhy"))) if row.get("markWhy") else ".")
    # where the drafts were run on the same calls: what that found, and the calls
    ran = next((t for t in row.get("trace") or [] if t.get("stage") == "run"), None)
    tried = ""
    if ran:
        calls = (row.get("tried") or {}).get("calls") or []
        tried = '<div class="muted small" style="margin:10px 0 0"><b style="color:var(--fog)">Drafts run on the same calls.</b> %s%s</div>' % (
            e(str(ran.get("out", ""))), (" Calls: <code>%s</code>" % "</code> <code>".join(e(str(c)) for c in calls[:8])) if calls else "")
    left = (
        '<div class="pane"><div class="head"><h3 class="who-swarm">The swarm</h3><span class="muted small">%s%s</span></div>%s%s'
        '<div class="reply"><div class="lab">Output %s</div>%s</div></div>'
        % (
            ("path: " + e(str(row.get("path", "")))) if row.get("path") else "",
            " · %s s" % row["seconds"] if row.get("seconds") is not None else "",
            stages(d, row),
            tried,
            mark,
            e(row.get("reply") or row.get("why") or "No reply."),
        )
    )
    if trow:
        right = '<div class="pane t"><div class="head"><h3 class="who-target">%s</h3><span class="muted small">%s</span></div><div class="reply" style="border-top:0;margin-top:0;padding-top:0"><div class="lab">Output <span class="grade unsure">the mark</span></div>%s</div></div>' % (
            e(tname),
            "%s s" % trow["seconds"] if trow.get("seconds") is not None else "",
            e(trow.get("reply") or trow.get("why") or "No reply."),
        )
    else:
        right = '<div class="pane t"><div class="head"><h3 class="who-target">%s</h3></div><p class="muted">It has not been given this input.</p></div>' % e(tname)
    return head + '<div class="versus">%s%s</div>' % (left, right)


def question(d, split, qid):
    sp = d["splits"][split]
    row = next((r for r in sp["swarm"] if r["id"] == qid), None)
    if not row:
        return '<p class="muted">That question is not among this pass\'s.</p>'
    return versus(d, row, sp["target"].get(qid), d["target"]["name"] if d["target"] else "The larger model")


# ---------------------------------------------------------------- running a training pass from the page
def _run_file():
    return Path(ARGS.root) / ".work" / "train" / "ui-run.json"


def run_state():
    """{pid, at, passes, each, first} of the pass this page started, and whether that process is still alive."""
    try:
        st = json.loads(_run_file().read_text())
    except (OSError, ValueError):
        return None
    try:
        try:
            # a session this page started and that has ended must be collected, or it still looks alive
            if os.waitpid(st["pid"], os.WNOHANG)[0] == st["pid"]:
                raise OSError("ended")
        except ChildProcessError:
            pass  # started by an earlier run of this page: not ours to collect
        os.kill(st["pid"], 0)
        st["running"] = True
    except (OSError, KeyError):
        st["running"] = False
    return st


def node_for_training():
    """A Node of 20 or later: the one named (NODE), the one on the PATH, or the newest nvm has. '' when there is none."""
    import glob
    found = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/v*/bin/node")), key=lambda p: [int(x) for x in p.split("/v")[-1].split("/")[0].split(".") if x.isdigit()], reverse=True)
    for c in [os.environ.get("NODE", ""), shutil.which("node") or ""] + found:
        if not c:
            continue
        try:
            major = int(subprocess.run([c, "-p", "process.versions.node.split('.')[0]"], capture_output=True, text=True, timeout=10).stdout.strip())
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
        if major >= 20:
            return c
    return ""


def cannot_run():
    """Why a pass cannot be started here, in words, or '' when it can."""
    root = Path(ARGS.root)
    if not (root / "training" / "session.sh").exists():
        return "This folder has no trainers in it (it is sample data, or not the repository)."
    if not shutil.which("bash"):
        return "This machine has no bash, which the session script needs."
    if not node_for_training():
        return "No Node.js 20 or later was found (on the PATH this page was started with, or in nvm). The trainers need it to run a model's code safely."
    return ""


def start_run(each, passes=0):
    """Training is continuous: pass after pass, each from the one before, until Stop training is pressed (passes=0)."""
    st = run_state()
    if st and st["running"]:
        return
    why = cannot_run()
    if why:
        return
    root = Path(ARGS.root)
    first = int(data.load(root)["state"].get("pass", 0)) + 1
    (root / ".work" / "train").mkdir(parents=True, exist_ok=True)
    log = open(root / ".work" / "train" / "ui-run.log", "ab")
    env = dict(os.environ, PASSES=str(passes), EACH=str(each), NODE=node_for_training())
    env.pop("TEACHER", None)  # a teacher spends on a Claude plan: never started from a button
    p = subprocess.Popen(["bash", "training/session.sh"], cwd=str(root), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    _run_file().write_text(json.dumps({"pid": p.pid, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "passes": passes, "each": each, "first": first}))


def stop_run():
    st = run_state()
    if not (st and st["running"]):
        return
    try:
        os.killpg(st["pid"], signal.SIGTERM)  # the session, the trainer it is on, and the model servers that trainer started
    except OSError:
        pass
    for _ in range(30):
        time.sleep(0.1)
        if not (run_state() or {}).get("running"):
            break
    st["stopped"] = time.strftime("%H:%M:%S")
    st.pop("running", None)
    _run_file().write_text(json.dumps(st))


def decider_installed():
    """Is the configured decider installed here? The decider script's own test (training/kev.sh ready), where the folder has it."""
    script = Path(ARGS.root) / "training" / "kev.sh"
    if not script.exists():
        return False
    try:
        return subprocess.run(["bash", str(script), "ready"], cwd=ARGS.root, capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def kev_base():
    """The address of the Kev that training/kev.sh started here, if it answers; else ''."""
    base = os.environ.get("SWARM_KEV", "")
    if not base:
        try:
            base = "http://127.0.0.1:%d" % int((Path(ARGS.root) / ".work" / "kev" / "port").read_text().strip())
        except (OSError, ValueError):
            return ""
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/v1/models", timeout=2) as r:
            return base if r.status == 200 else ""
    except Exception:  # noqa: BLE001
        return ""


def run_panel():
    st = run_state()
    try:
        wdir = work_of(ARGS.root, data.load(ARGS.root).get("key"))  # the configured swarm's own pass
    except Exception:  # the panel is drawn even where the folder cannot be read
        wdir = Path(ARGS.root) / ".work" / "train"
    out = ['<div class="panel run">']
    # the models are loaded by a session and unloaded when it ends: outside one, nothing should be running
    kev = kev_base()
    installed = decider_installed()
    note = lambda cls, text: '<div class="state %s"><i></i><span>%s</span></div>' % (cls, text)  # noqa: E731
    if st and st["running"]:
        # when it began, in the time zone of whoever is looking (the page's script writes it; until it has, this machine's), and
        # how long it has been running in all
        began = _epoch_local(st["at"])
        out.append('<div class="state on running" data-running="1"><i></i><span data-since="%d"><b>Running %s</b><small>since %s</small></span></div>'
                   % (int(began * 1000), e(_span(time.time() - began)), e(time.strftime("%H:%M %Z", time.localtime(began)))))
        out.append('<button class="btn stop top wide" id="run-stop" type="button">Stop training</button>')
        out.append('<p class="meta"><span>%s</span><span><b>%d</b> questions of each kind</span><span>Kev <b>%s</b></span></p>'
                   % ("Goes on until stopped" if not st.get("passes") else "<b>%d</b> passes" % st["passes"], st["each"], "loaded" if kev else "loading"))
    else:
        why = cannot_run()
        each = "".join('<option value="%d"%s>%d</option>' % (n, " selected" if n == 6 else "", n) for n in (2, 4, 6, 8, 10))
        out.append('<button class="btn top wide" id="run-go" type="button"%s>Run training</button>' % (" disabled" if why else ""))
        out.append('<p class="meta"><label>Questions of each kind <select id="run-each" aria-label="Questions of each kind">%s</select></label></p>' % each)
        out.append('<p class="muted small">Until stopped: training goes on, pass after pass, each from what the last one learned, until <b>Stop training</b> is pressed.</p>')
        if why:
            out.append(note("warn", e(why)))
        elif not installed and not os.environ.get("SWARM_KEV"):
            out.append(note("", "Idle. Run training fetches what is missing"))
        elif kev and not os.environ.get("SWARM_KEV"):
            out.append(note("warn", "A Kev is loaded outside a session: <code>bash training/kev.sh stop</code>"))
        else:
            out.append(note("", "Idle. No models loaded"))
        if st and st.get("stopped"):
            out.append(note("", "Stopped at %s" % e(st["stopped"][:5])))
    # what is being fetched and made ready, while that is what the session is doing
    if st and st["running"]:
        try:
            su = json.loads((Path(ARGS.root) / ".work" / "train" / "setup.json").read_text())
        except (OSError, ValueError):
            su = {}
        busy = [x for x in su.get("steps", []) if x.get("state") not in ("ready",)] if time.time() * 1000 - su.get("at", 0) < 600000 else []
        if busy and not any(wdir.glob("pass-*/status.txt") and (d2.stat().st_mtime * 1000 > su.get("at", 0) for d2 in wdir.glob("pass-*/status.txt"))):
            rows = ""
            for x in su.get("steps", []):
                of = x.get("of") or 0
                pct = (100.0 * x.get("done", 0) / of) if of and x.get("done") is not None else None
                what = "ready" if x["state"] == "ready" else x.get("why") or (("%.1f of %.1f GB" % (x.get("done", 0) / 2**30, of / 2**30)) if pct is not None else x.get("note") or x["state"])
                rows += '<li class="%s"><span>%s</span><span>%s<small style="display:block;color:var(--mist);font-weight:600">%s</small>%s</span><span></span></li>' % (
                    "" if x["state"] == "ready" else "bad" if x["state"] == "failed" else "cur", "✓" if x["state"] == "ready" else "✕" if x["state"] == "failed" else "▸", e(x["what"]), e(str(what)),
                    '<span class="track" style="display:block;height:5px;border-radius:3px;background:var(--soft);margin-top:4px"><i style="display:block;height:100%%;border-radius:3px;background:var(--teal2);width:%.1f%%"></i></span>' % pct if pct is not None and x["state"] != "ready" else "")
            out.append('<div class="sec"><h5>Making ready</h5><ul class="steps">%s</ul></div>' % rows)
    # the steps of the newest pass this page started
    if st:
        root = Path(ARGS.root)
        dirs = sorted((d for d in wdir.glob("pass-*") if d.is_dir() and d.name[5:].isdigit() and int(d.name[5:]) >= st.get("first", 0)), key=lambda d: int(d.name[5:]))
        if dirs:
            cur = dirs[-1]
            steps, order = {}, []
            for line in (cur / "status.txt").read_text().splitlines() if (cur / "status.txt").exists() else []:
                parts = line.split()
                if len(parts) >= 3 and parts[1] == "START":
                    # a step that failed and is being run again shows as one step, with how many times it has been tried
                    tries = steps[parts[2]]["tries"] + 1 if parts[2] in steps else 1
                    steps[parts[2]] = {"at": parts[0], "end": None, "tries": tries}
                    if parts[2] not in order:
                        order.append(parts[2])
                elif len(parts) >= 3 and parts[1] == "SKIP":
                    # done before this session stopped, and passed over now that it has been resumed
                    steps[parts[2]] = {"at": parts[0], "end": "exit 0 done earlier", "tries": 1}
                    if parts[2] not in order:
                        order.append(parts[2])
                elif len(parts) >= 5 and parts[1] == "END" and parts[2] in steps:
                    steps[parts[2]]["end"] = " ".join(parts[3:])
            items = []
            for name in order:
                x = steps[name]
                done = x["end"] is not None
                bad = done and not (x["end"].startswith("exit 0") or x["end"].startswith("exit 2"))
                if done:
                    took = x["end"].split(" ", 2)[2] if len(x["end"].split(" ", 2)) > 2 else ""
                    how = "nothing to do" if x["end"].startswith("exit 2") else "under a minute" if took.startswith("0 min") else took
                    if bad:
                        how = "failed · " + how
                else:
                    how = _span(_since_clock(x["at"]))
                items.append('<li class="%s" title="%s"><span>%s</span><span>%s</span><span>%s</span></li>' % (
                    "bad" if bad else "" if done else "cur", e(name), "✕" if bad else "✓" if done else "▸", e(step_label(name)),
                    e(how + (" · try %d" % x["tries"] if x.get("tries", 1) > 1 else ""))))
            nth = int(cur.name[5:]) - int(st.get("first", cur.name[5:])) + 1 if cur.name[5:].isdigit() else 1
            out.append('<div class="sec"><h5>Pass %s<span>%s</span></h5><ul class="steps">%s</ul></div>' % (
                e(cur.name[5:]), ("number %d of this session" % nth) if nth > 1 else "", "".join(items) or "<li><span></span><span class='muted'>starting</span><span></span></li>"))
    # THE WAYS BACK THIS SESSION HAS TAKEN: a pass that needed twelve restarts is not the same evidence as one that needed none
    if st:
        began = _epoch_local(st.get("at", ""))
        took = [r for r in data._rows(Path(ARGS.root) / ".work" / "train" / "recovery.jsonl") if _epoch(r.get("at")) >= began - 2]
        if took:
            rows = "".join('<li><span>↺</span><span>%s<small style="display:block;color:var(--mist);font-weight:600">%s</small></span><span></span></li>' % (e(str(r.get("what", ""))), e(str(r.get("did", "")))) for r in took[-5:])
            out.append('<div class="sec"><h5>Recovered<span>%d time%s this session</span></h5><ul class="steps">%s</ul></div>' % (len(took), "" if len(took) == 1 else "s", rows))
        # what this session has taught the swarm so far: each change as it is kept (the output spec holds them all)
        try:
            led = [x for x in data.load(ARGS.root)["learned"]["ledger"] if _epoch(x.get("at")) >= began - 2]
        except Exception:  # the panel is drawn even where the folder cannot be read
            led = []
        out.append('<div class="sec"><h5>Learned this session<span>%s</span></h5>%s' % ("%d kept" % len(led) if led else "", "" if led else '<p class="muted small">Nothing kept yet. Each change is listed here as it is kept.</p></div>'))
        if led:
            out.append('<ul class="steps">%s</ul></div>' % "".join(
                '<li><span>✓</span><span><b>%s</b><small style="display:block" class="muted">%s%s · train %s → %s equivalent</small></span></li>'
                % (e(_what(x)), e(_kind(x)), (" · " + e(x["slot"])) if x.get("slot") else "",
                   e(str(((x.get("train") or {}).get("before") or {}).get("right", "?"))), e(str(((x.get("train") or {}).get("after") or {}).get("right", "?")))) for x in led[::-1]))
    out.append("</div>")
    return "".join(out)


STEP_WORDS = [("reader", "Check the reader of answers in words"), ("swarm-reworded", "The swarm: the held questions, a second way"), ("begin", "Begin the pass"), ("research", "Read what is new on arXiv"), ("target-train", "Larger model: the train questions"), ("target", "Larger model: the held questions"),
              ("swarm-held", "The swarm: the held questions"), ("swarm-train", "The swarm: the train questions"), ("review", "Review how it is training"), ("plan", "Plan what to try"), ("write-briefs", "New briefs from the larger model"),
              ("members", "Could another small model draft it?"), ("deciders", "Would another decider choose better?"),
              ("arrange", "Try other arrangements"), ("end", "Verdict"), ("publish", "Write it up")]


def step_label(name):
    """A step of a pass, in words: what the session's own name for it (00-begin, 10-improve-a-critic) stands for."""
    key = name.split("-", 1)[1] if "-" in name and name.split("-", 1)[0].isdigit() else name
    if key.startswith("improve-"):
        return "Try other briefs for " + key[len("improve-"):]
    if key in ("a-alone", "b-alone", "c-alone", "d-alone"):
        return "%s alone" % data.MEMBER_NAMES.get(key[0], key[0])
    return next((words for k, words in STEP_WORDS if key == k), key)


def _since_clock(clock):
    """Seconds since a time of day written HH:MM:SS (today, or yesterday if that would be in the future)."""
    try:
        h, m, sec = (int(x) for x in str(clock).split(":"))
        now = time.localtime()
        d = (now.tm_hour * 3600 + now.tm_min * 60 + now.tm_sec) - (h * 3600 + m * 60 + sec)
        return d if d >= 0 else d + 86400
    except (ValueError, TypeError):
        return 0


def _epoch(iso):
    """Seconds since 1970 of a time written as the trainers write it (UTC, ISO); 0 when it cannot be read."""
    try:
        import calendar
        return calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, TypeError):
        return 0


def _span(seconds):
    """A length of time as a person says it: 45 s, 12 min 30 s, 2 h 5 min."""
    s = max(0, int(seconds))
    if s < 60:
        return "%d s" % s
    if s < 3600:
        return "%d min %d s" % (s // 60, s % 60)
    return "%d h %d min" % (s // 3600, s % 3600 // 60)


def _epoch_local(stamp):
    """Seconds since 1970 of a time written as this page writes a session's start (local time)."""
    try:
        return time.mktime(time.strptime(str(stamp)[:19], "%Y-%m-%d %H:%M:%S"))
    except (ValueError, TypeError):
        return time.time()


def rail(d):
    """Beside the dashboard: the pass in hand, the passes so far, and the ideas waiting to be measured."""
    st = d["state"]
    names = {t["id"]: t["name"].split(" ")[0] for t in d["targets"]}
    hist = st.get("history", [])[-5:][::-1]
    passes = "".join(
        '<li><span class="av">P%s</span><span><b>%s</b><small>%s</small></span><span class="pill %s">%s</span></li>'
        % (e(str(h["pass"])), e("with " + names.get(h.get("target"), str(h.get("target")))),
           e("%d of %d held answers equivalent" % (h["equivalent"], h["compared"]) if h.get("compared") else "nothing to compare"),
           "up" if h.get("level") else "planned", ("%s%%" % fmt_pct(data.percent(h["equivalent"], h["compared"]))) if h.get("compared") else ("%d differ" % (h["compared"] - h["equivalent"])) if h.get("compared") else "n/a")
        for h in hist
    ) or '<li><span class="av">&ndash;</span><span><b>No pass has ended yet</b><small>the first is pass 1</small></span><span></span></li>'
    ideas = [i for i in st.get("ideas", []) if i.get("status") == "open"][:6]
    def idea(i):
        src = str(i.get("from", ""))
        paper = src[:1].isdigit()
        inner = '<span class="av">%s</span><span><b>%s</b><small>%s</small></span><span class="pill">%s</span>' % (
            e("".join(w[0] for w in i["slot"].split("-")[:2]).upper()), e(i.get("name", "")), e(i["slot"]), ("arXiv " + e(src)) if paper else "owner")
        return '<li>%s</li>' % ('<a class="idea" href="https://arxiv.org/abs/%s" target="_blank" rel="noopener" title="Open the paper this idea came from">%s</a>' % (e(src), inner) if paper else '<span class="idea">%s</span>' % inner)

    waiting = "".join(idea(i) for i in ideas) or '<li><span class="idea"><span class="av">&ndash;</span><span><b>None waiting</b><small>research adds them</small></span><span></span></span></li>'
    return (
        '<aside class="rail"><div id="training"><h2>Training</h2><div id="run">%s</div></div>'
        '<div><h2>Passes</h2><div class="panel"><ul class="feed">%s</ul></div></div>'
        '<div><h2>Ideas waiting to be measured</h2><div class="panel"><ul class="feed">%s</ul></div></div></aside>' % (run_panel(), passes, waiting)
    )


def pills(d):
    """Four choices and one document: the two small models, the model that decides, the larger model, and the output spec."""
    reg, running = d["registry"], bool((run_state() or {}).get("running"))
    weigh = lambda m: (" · %.1f GB" % (m["bytes"] / 2**30)) if m.get("bytes") else (" · about %s GB" % m["memGb"]) if m.get("memGb") else ""  # noqa: E731

    def pill(key, label, lst, chosen, group=None):
        opts = ""
        makers = list(dict.fromkeys(m.get("by", "").split(",")[0] for m in lst))
        for maker in makers:
            opts += '<optgroup label="%s">' % e(maker)
            for m in lst:
                if m.get("by", "").split(",")[0] != maker:
                    continue
                # (a model's name says its size already: "LFM2.5 2.6B"; what is added is how much it weighs)
                # the one chosen is shown by its name alone, so that a pill reads at a glance (its size is beside the label); the
                # others, in the list, say what they weigh, which is what choosing between them turns on
                mine = bool(chosen and m["id"] == chosen.get("id"))
                # a decider: its score on the Decision Index, and whether it can run on this machine at all (one that cannot is
                # listed, so that it can be compared, and cannot be chosen here)
                score = (" · index %s%s" % (m["index"]["score"], " (an older checkpoint)" if "older" in m["index"].get("as", "") else "")) if key == "decider" and m.get("index") else ""
                here = key != "decider" or not m.get("runsOn") or any(x in d.get("machine", []) for x in m["runsOn"])
                opts += '<option value="%s"%s%s>%s%s%s%s</option>' % (
                    e(m["id"]), " selected" if mine else "", "" if here or mine else " disabled", e(m["name"]), "" if mine else score, "" if mine else weigh(m),
                    "" if here else " · needs %s" % e(m.get("needs", "another machine")))
            opts += "</optgroup>"
        if group == "optional":
            # a place that can be left empty: "none" takes the model out of the swarm (or, on an empty place, is what it shows)
            opts = '<option value=""%s>%s</option>' % ("" if chosen else " selected", "Remove it from the swarm" if chosen else "Add a model") + opts
        return '<label class="pick %s%s" title="%s"><small>%s%s</small><select data-pick="%s"%s aria-label="%s">%s</select></label>' % (
            key, " add" if group == "optional" and not chosen else "", e("%s: %s%s" % (label, chosen["name"], weigh(chosen)) if chosen else label + ": none. Choose one to add a small model to the swarm"), e(label), '<i>%s</i>' % e(weigh(chosen).replace(" · ", "")) if chosen and weigh(chosen) else "", key, " disabled" if running else "", e(label), opts)

    # a third and a fourth small model: each place that is filled, and the next one, empty, to add to
    more = ""
    for i, k in enumerate(("c", "d")):
        if k in d["members"]:
            more += pill(k, "Small model %d" % (i + 3), reg["small"], d["members"][k], "optional")
        else:
            more += pill(k, "Small model %d" % (i + 3), reg["small"], None, "optional")
            break
    n_small = 2 + more.count('class="pick ')
    return (
        '<div class="picks" id="picks"><div class="group small n%d" style="flex-basis:%dpx">%s%s%s</div><div class="group against" style="flex-basis:495px">%s%s</div></div>'
        # (each group asks for the room its pills need, so the two share a row exactly when both fit)
        % (n_small, 195 * n_small - 10, pill("a", "Small model 1", reg["small"], d["members"]["a"]), pill("b", "Small model 2", reg["small"], d["members"]["b"]), more,
           pill("decider", "Decides", sorted(reg["deciders"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d["decider"]), pill("target", "Larger model", sorted(reg["targets"], key=lambda t: -t.get("params", 0)), d["target"]))
    )


def equiv(d, inner=False):
    """What the swarm is to be equivalent on: one box to tick for each body of work, under the models. More than one can be
    ticked. It can be changed while a session runs: a pass ends on the questions it began with, and the next one asks these."""
    q = d.get("equivalence") or {"targets": [], "chosen": []}
    own = lambda t: len(t.get("own") or [])  # noqa: E731
    boxes = "".join(
        '<div class="tick%s"><label title="%s"><input type="checkbox" data-equiv="%s"%s><span><b>%s</b><small>%s%s</small></span></label>'
        '<button class="pencil" type="button" data-qedit="%s" title="Edit the questions for %s" aria-label="Edit the questions for %s">'
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.2a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6l-9.3 9.3-3.8 1.1 1.1-3.8z"/><path d="M12.2 4.6l3.2 3.2"/></svg></button></div>'
        % (" on" if t["id"] in q["chosen"] else "", e(t.get("about", "")), e(t["id"]), " checked" if t["id"] in q["chosen"] else "", e(t["name"]), e(t.get("about", "")),
           (" <em>· %d of your own</em>" % own(t)) if own(t) else "", e(t["id"]), e(t["name"]), e(t["name"]))
        for t in q["targets"])
    want = [k for t in q["targets"] if t["id"] in q["chosen"] for k in t.get("kinds", [])] + ["own-" + t["id"] for t in q["targets"] if t["id"] in q["chosen"] and own(t)]
    asking = q.get("asking")
    note = "%d kinds of question in a pass." % len(set(want))
    if asking is not None and set(asking) != set(want):
        note += " The pass this configuration is on keeps the %d kinds it began with; the next pass asks these." % len(set(asking))
    elif asking is None and (d.get("state") or {}).get("history"):
        note += " The pass this configuration is on began before this could be chosen and keeps its programming questions; the next pass asks these."
    body = ('<legend>Equivalent on</legend><div class="ticks">%s</div>'
            '<p class="muted small">Parity is equivalence with the larger model on the work ticked here. %s</p>' % (boxes, e(note)))
    # (drawn again in place, it is what is inside the row that is sent)
    return body if inner else '<fieldset class="equiv" id="equiv">%s</fieldset>' % body


MOST_OWN = 200  # the same bound as training/tasks.mjs


def questions_panel(d, tid):
    """The questions for one body of work: the kinds the trainer makes (new from a seed each pass, not edited here), and the
    questions a person wrote, one row each, to change, add to or take out. Saved to training/questions/<id>.json."""
    t = next((x for x in (d.get("equivalence") or {}).get("targets", []) if x["id"] == tid), None)
    if not t:
        return '<p class="muted">There is nothing called that to be equivalent on.</p>'
    crew = tid == "crew"

    def row(qn):
        mode = qn.get("mode") if qn.get("mode") in ("simple", "developer") else "simple"
        pick = ('<select data-q-mode aria-label="Sent to"><option value="simple"%s>Simple</option><option value="developer"%s>Developer</option></select>'
                % (" selected" if mode == "simple" else "", " selected" if mode == "developer" else "")) if crew else ""
        return ('<li class="qrow"><textarea data-q-ask rows="2" maxlength="2000" aria-label="A question" placeholder="%s">%s</textarea>'
                '<div class="qside">%s<button class="qdel" type="button" data-q-del title="Take this question out" aria-label="Take this question out">×</button></div></li>'
                % ("What a person would send, in their own words" if crew else "A question, as it would be asked", e(str(qn.get("ask") or "")), pick))

    made = "".join("<li>%s</li>" % e(KIND_WORDS.get(k, k)) for k in t.get("kinds", []))
    rows = "".join(row(x) for x in t.get("own") or [])
    return (
        '<div class="spec-head"><div><div class="kicker">Equivalent on</div><h3 style="font-size:22px;margin-top:4px">Questions: %s</h3></div>'
        '<button class="btn stop top" id="qedit-close" type="button">Close</button></div>'
        '<p class="muted small" style="margin:8px 0 0">%s</p>'
        '<h4>Your own questions</h4>'
        '<p class="muted small" style="margin:0 0 10px">Asked alongside the ones the trainer makes, and judged the same way: the same act, the same substance, and no convention broken that the larger model kept. '
        'Every second one is held back: the swarm is measured on those and never trained on them. Saved questions are asked from the next pass on.%s</p>'
        '<ol class="qlist" id="qlist" data-target="%s">%s</ol><template id="qrow">%s</template>'
        '<div class="qbar"><button class="btn top" type="button" id="qadd" style="background:var(--soft);color:var(--fog);box-shadow:none">Add a question</button>'
        '<span class="muted small" id="qcount">%d of %d</span><button class="btn top" type="button" id="qsave">Save</button></div>'
        '<h4>Made by the trainer</h4><p class="muted small" style="margin:0 0 6px">New from a seed every pass, so there is no list to learn by heart. They are not edited here.</p>'
        '<ul class="qmade">%s</ul>'
        % (e(t["name"]), e(t.get("about", "")), " Simple or Developer says which kind of seat it is sent to." if crew else "", e(tid), rows, row({}),
           len(t.get("own") or []), MOST_OWN, made)
    )


KIND_WORD = {"brief": "Brief", "plan": "Plan", "arrangement": "Arrangement", "flow": "Flow"}


def _what(x):
    """What was kept, as it reads best: an arrangement of several changes at once without the trainer's own prefix for it."""
    w = str(x.get("what", ""))
    return w[len("several: "):] if w.startswith("several: ") else w


def _kind(x):
    return "Several changes at once" if str(x.get("what", "")).startswith("several: ") else KIND_WORD.get(x.get("kind"), x.get("kind", ""))


def ledger_rows(entries, newest_first=True):
    """What was kept, each with the evidence it was kept on: answers equivalent to the larger model's, before and after."""
    out = []
    for x in (entries[::-1] if newest_first else entries):
        tr, he = x.get("train") or {}, x.get("held") or {}
        ev = lambda z: ("%d → %d" % ((z.get("before") or {}).get("right", 0), (z.get("after") or {}).get("right", 0))) if z.get("before") and z.get("after") else "not recorded"  # noqa: E731
        where = " · ".join(v for v in [("<code>%s</code>" % e(x["slot"])) if x.get("slot") else "", "pass %s" % e(str(x.get("pass", ""))) if x.get("pass") else "", e(str(x.get("at", ""))[:10]),
                                        '<a href="https://arxiv.org/abs/%s" target="_blank" rel="noopener">arXiv %s</a>' % (e(x["from"]), e(x["from"])) if x.get("from") else ""] if v)
        out.append('<li class="kept"><span class="o">%s</span><span class="k %s">%s</span><span class="mv"><b>%s</b><small>%s</small>'
                   '<small>Equivalent answers on train: <b style="display:inline;font-size:inherit">%s</b> · on held: <b style="display:inline;font-size:inherit">%s</b></small></span><span class="pill up">Kept</span></li>'
                   % (e(str(x.get("n", ""))), e(x.get("kind", "")), e(_kind(x)), e(_what(x)), where, ev(tr), ev(he)))
    return "".join(out)


def learned_block(d):
    """WHAT THIS SWARM HAS LEARNED, for the spec: every kept change with its evidence, newest first, and where each pass left it."""
    led, passes = d["learned"]["ledger"], d["learned"]["passes"]
    tname = (d["target"] or {}).get("name", "the larger model")
    if not led:
        body = '<p class="muted small" style="margin:0">Nothing yet. It runs the arrangement every swarm starts from. Each change a pass keeps is added here as it is kept, with the answers it won.</p>'
    else:
        body = '<ul class="moves">%s</ul>' % ledger_rows(led)
    stood = ""
    if passes:
        stood = '<p class="small" style="margin:10px 0 0"><b>Where each pass left it against %s:</b> %s</p>' % (
            e(tname), " · ".join("pass %s: %s%s%s%s" % (
                e(str(p.get("pass"))), e(how_far(p["equivalent"], p["compared"])) if p.get("compared") else "nothing to compare", " (parity)" if p.get("level") else "",
                (", lost %d and won %d since the pass before" % (len((p.get("flips") or {}).get("lost", [])), len((p.get("flips") or {}).get("won", [])))) if p.get("flips") else "",
                (", %d of %d put a second way" % (p["reworded"]["equivalent"], p["reworded"]["compared"])) if p.get("reworded") else "") for p in passes))
    return ('<h4>What it has learned (%d kept)</h4><p class="muted small" style="margin:0 0 6px">Every change below was measured and kept: more answers equivalent to %s&#39;s on the questions it was chosen on, and no fewer on the held ones. '
            "The arrangement in this spec is the one these changes made.</p>%s%s" % (len(led), e(tname), body, stood))


def spec_panel(d):
    """The output spec, for a person to read and to copy: what the configured swarm is, and where it stands against its target."""
    sp = data.spec(d)
    t = sp["trainedAgainst"]
    row = lambda k, v: "<tr><th>%s</th><td>%s</td></tr>" % (e(k), v)  # noqa: E731
    mem = lambda m: "%s <span class='muted'>· %s · %sB · %s</span><br><code>%s @ %s</code><br><code>%s</code> <span class='muted'>%.2f GB</span><br><code>sha256 %s</code>" % (  # noqa: E731
        e(m.get("name", "")), e(m.get("by", "")), e(str(m.get("params", ""))), e(m.get("license", "")), e(m.get("repo", "")), e(str(m.get("rev", ""))[:12]), e(m.get("file", "")), m.get("bytes", 0) / 2**30, e(m.get("sha256", "")))
    state_cls = "level" if t["state"] == "at parity" else "behind"
    kinds = "".join("<li>%s: %s</li>" % (e(KIND_WORDS.get(k, k)), e(how_far(v["equivalent"], v["of"]))) for k, v in t["byKind"].items() if v["of"]) or "<li>not measured</li>"
    slots = "".join("<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td>%s</td></tr>" % (e(x["id"]), e(x["stage"]), e(x.get("purpose", "")), e(str(x.get("model", "")))) for x in sp["arrangement"]["slots"])
    return (
        '<div class="spec-head"><div><div class="kicker">Output spec</div><h3 style="font-size:24px">%s</h3><div class="muted small">%s</div></div>'
        '<div style="display:flex;gap:8px"><button class="btn top" id="spec-copy" type="button">Copy as JSON</button><button class="btn stop top" id="spec-close" type="button">Close</button></div></div>'
        '<p class="verdict %s" style="margin:14px 0 2px">%s against %s.</p><p class="muted small" style="margin:0 0 12px">%s</p>'
        "%s<h4>What it is</h4><table class='spec'>%s%s%s%s%s%s%s%s</table>"
        "<h4>The flow</h4><p class='small' style='margin:0'>%s <span class='muted'>(%s)</span></p>"
        "<h4>The arrangement (briefs v%s)</h4><table class='spec'><tr><th>Slot</th><th>Stage</th><th>What it is for</th><th>Model</th></tr>%s"
        "<tr><td><code>kev-decide</code></td><td>decide</td><td>Decides which answer stands</td><td>%s</td></tr></table>"
        '<h4>As JSON</h4><pre class="tail" id="spec-json" style="max-height:320px">%s</pre>'
        % (
            e(sp["id"]), e(sp["what"]),
            state_cls, e(("%s%% of the way to parity" % fmt_pct(t["progressPercent"])) if t.get("progressPercent") is not None and t["state"] != "at parity" else t["state"].capitalize()), e(t["target"].get("name") or ""),
            e(t["parityMeans"]),
            learned_block(d),
            row("In", e(sp["interface"]["in"])), row("Out", e(sp["interface"]["out"])),
            row("Offered as", "<br>".join(e(x) for x in sp["interface"]["as"])),
            row("Not yet", "<br>".join(e(x) for x in sp["interface"]["notYet"])),
            "".join(row("Small model %d (place %s)" % (i + 1, k), mem(m)) for i, (k, m) in enumerate(sp["members"].items())), "",
            row("Decides", "%s <span class='muted'>· %s · %s</span><br><code>%s</code>" % (e(sp["decider"].get("name") or ""), e(sp["decider"].get("by") or ""), e(sp["decider"].get("license") or ""), e(sp["decider"].get("run") or ""))),
            row("Against %s" % e(t["target"].get("name") or ""), ("<b>%s</b> of the way to parity. %d held questions: %d equivalent, %d different, %d no answer<ul style='margin:6px 0 0;padding-left:18px'>%s</ul>" % (e(fmt_pct(t["progressPercent"]) + "%"), t["heldQuestions"], t["equivalent"], t["different"], t["noAnswer"], kinds)) if t["state"] != "not measured" else "Not measured: no pass has put this swarm and this target to the same held questions.")
            + row("Served", "%d slots on each small model, %d tokens of context a slot; about %s GB of memory (an estimate); engine %s %s" % (sp["serving"]["slots"], sp["serving"]["contextPerSlot"], sp["serving"]["memoryGbEstimate"], e(sp["engine"].get("name") or ""), e(sp["engine"].get("version") or ""))),
            e(" → ".join(_flow_words(x) for x in sp["arrangement"]["flow"])), e(sp["arrangement"]["flowIs"]),
            e(str(sp["arrangement"]["briefsVersion"])), slots, e(sp["decider"].get("id") or ""),
            e(json.dumps(sp, indent=2)),
        )
    )


def io_section(d):
    """Input against output, once the swarm has answered anything (and '' until then)."""
    first = next((k for k in ("held", "train") if d["splits"][k]["swarm"]), "")
    return ('<h2 id="input">Input against output</h2><div class="io" id="io">%s</div>' % qlist(d, first)) if first else ""


def main_body(d):
    """Everything that depends on which models are chosen: drawn again, in place, when one is changed."""
    return (
        '<h2>Parity with the larger model</h2><div id="score">%s</div>'
        '<h2 id="arrangement">The arrangement being trained, and the larger model alongside</h2>%s%s'
        % (score_strip(d), arrangement(d), '<div id="io-wrap">%s</div>' % io_section(d))
    )


def chips(d):
    """Beside the title: which pass it is, how far toward parity, and the way in to the output spec (with how many things it has
    learned). Read again while a pass runs."""
    st = d["state"]
    p = d["splits"]["held"]["parity"]
    out = ['<span class="chip">Pass <b>%s</b></span>' % e(str(st.get("pass", 0) + 1))]
    if p:
        out.append('<span class="chip %s">%s</span>' % ("level" if p["level"] else "behind", "At parity: <b>100%</b>" if p["level"] else "<b>%s%%</b> of the way to parity" % fmt_pct(p["percent"])))
    out.append('<button class="specbtn" id="spec-open" type="button" title="The swarm as it stands: what it is, and what it has learned">Output spec%s</button>'
               % (("<span>%d learned</span>" % len(d["learned"]["ledger"])) if d["learned"]["ledger"] else ""))
    out.append('<button class="specbtn tidy" id="tidy-open" type="button" title="What the Swarm has put on this machine, and taking out what you do not want">Uninstall Helper</button>')
    return "".join(out)


def tidy_panel(d, said=""):
    """The Uninstall Helper: everything the Swarm has fetched or kept here, by group, each with the room it takes, whether the
    configured swarm uses it, and a button to remove it (ui/cleanup.py does the removing, and refuses anything outside .work)."""
    items = cleanup.inventory(ARGS.root, d)
    running = bool((run_state() or {}).get("running"))
    total = sum(x["bytes"] or 0 for x in items if x["removable"])
    rows, group = [], None
    for x in items:
        if x["group"] != group:
            group = x["group"]
            rows.append('<li class="tgroup">%s</li>' % e(group))
        tag = '<span class="pill">in use</span>' if x["used"] and x["removable"] else ""
        act = ('<button class="btn stop top tdel" type="button" data-tidy="%s" data-what="%s" data-size="%s" data-used="%d"%s>Remove</button>'
               % (e(x["id"]), e(x["what"]), e(cleanup.gb(x["bytes"] or 0)), 1 if x["used"] else 0, " disabled" if running else "")) if x["removable"] else '<span class="muted small">not removed from here</span>'
        rows.append('<li class="titem"><div><b>%s</b> %s<small>%s</small></div><span class="tsize">%s</span>%s</li>'
                    % (e(x["what"]), tag, e(x["note"]), e(cleanup.gb(x["bytes"])) if x["bytes"] is not None else "", act))
    return (
        '<div class="spec-head"><div><div class="kicker">On this machine</div><h3 style="font-size:22px;margin-top:4px">Uninstall Helper</h3></div>'
        '<button class="btn stop top" id="tidy-close" type="button">Close</button></div>'
        '<p class="muted small" style="margin:8px 0 0">Everything the Swarm fetched or keeps in this folder\'s <code>.work</code>: <b>%s</b> in all. '
        'Removing a piece cannot be undone. One marked <i>in use</i> is part of the swarm as it is configured: Run training fetches it again. '
        'What training has learned (the briefs, the arrangement, each configuration\'s record) is not an install, and is not listed.%s</p>'
        '%s<ul class="tlist">%s</ul>'
        % (e(cleanup.gb(total)), " A session is running: stop it before removing anything." if running else "",
           ('<p class="tsaid">%s</p>' % e(said)) if said else "", "".join(rows) or '<li class="muted">Nothing is installed here.</li>')
    )


def page(d):
    banner = '<div class="banner">Sample data, made up to show the layout. It is not a measurement of anything.</div>' if d["sample"] else ""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>The Swarm</title><style>%s</style></head><body><div class="shell">'
        '<main id="top"><header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div><div class="chips" id="chips">%s</div></header>%s%s'
        '<div id="body">%s</div>'
        '%s</main>%s</div><dialog id="spec"><div id="spec-body"></div></dialog><dialog id="qedit"><div id="qedit-body"></div></dialog><dialog id="tidy"><div id="tidy-body"></div></dialog>'
        '<dialog id="big"><div class="spec-head"><div><div class="kicker">Parity with the larger model</div><h3 style="font-size:22px;margin-top:4px">The whole measurement</h3></div>'
        '<button class="btn stop top" id="big-close" type="button">Close</button></div><div id="big-body"></div></dialog><script>%s</script></body></html>'
        % (CSS, chips(d), pills(d) + equiv(d), banner, main_body(d), footer(), rail(d), JS)
    )


# ---------------------------------------------------------------- the server
class Handler(BaseHTTPRequestHandler):
    def _send(self, body, code=200, kind="text/html; charset=utf-8"):
        raw = body.encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(raw)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # THE PAGE WENT AWAY BEFORE ITS ANSWER DID. The page asks what every slot is doing every second and a half; a tab that is
            # closed, reloaded or put to sleep leaves one of those requests with nobody to answer. That is not a fault of anything, and
            # is not printed as one.
            self.close_connection = True

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        split = q.get("split") if q.get("split") in ("held", "train") else "held"
        d = data.load(ARGS.root)
        if u.path == "/":
            return self._send(page(d))
        if u.path == "/api/live":
            try:
                now = json.loads((Path(ARGS.root) / ".work" / "train" / "live.json").read_text())
            except (OSError, ValueError):
                now = {}
            st = run_state()
            running = bool(st and st["running"])
            # what a trainer wrote stands only while a session runs and it is fresh: a stopped session leaves nothing "working"
            if not running or time.time() * 1000 - now.get("at", 0) > 180000:
                now = {"slots": {}}
            now["running"] = running
            names = dict(data.MEMBER_NAMES, target=(d["target"] or {}).get("name", "the larger model"), swarm="The swarm")
            now["whoName"] = names.get(str(now.get("who", "")).replace("-alone", ""), now.get("who", ""))
            return self._send(json.dumps(now), kind="application/json")
        if u.path == "/fragment/body":
            return self._send(main_body(d))
        if u.path == "/fragment/spec":
            return self._send(spec_panel(d))
        if u.path == "/fragment/chips":
            return self._send(chips(d))
        if u.path == "/fragment/picks":
            return self._send(pills(d))
        if u.path == "/fragment/equiv":
            return self._send(equiv(d, inner=True))
        if u.path == "/fragment/tidy":
            return self._send(tidy_panel(d))
        if u.path == "/fragment/questions":
            return self._send(questions_panel(d, parse_qs(u.query).get("id", [""])[0]))
        if u.path == "/fragment/run":
            return self._send(run_panel())
        if u.path == "/fragment/score":
            return self._send(score_strip(d))
        if u.path == "/fragment/scorefull":
            return self._send(scoreboard(d))
        if u.path == "/fragment/io":
            return self._send(io_section(d))
        if u.path == "/fragment/plan":
            return self._send(plan_panel(d))
        if u.path == "/fragment/list":
            return self._send(qlist(d, split))
        if u.path == "/fragment/question":
            return self._send(question(d, split, q.get("id", "")))
        return self._send("Not here.", 404, "text/plain; charset=utf-8")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/run/start", "/run/stop", "/config", "/questions", "/uninstall"):
            return self._send("Not here.", 404, "text/plain; charset=utf-8")
        # only this page may start or stop a pass: another website can send a plain form to this address, but it cannot
        # send this header, and a request that names another origin is refused
        origin = self.headers.get("origin", "")
        if self.headers.get("x-swarm") != "1" or (origin and urlparse(origin).netloc != self.headers.get("host", "")):
            return self._send("Not from this page.", 403, "text/plain; charset=utf-8")
        if path == "/uninstall":
            # one piece the Uninstall Helper lists, by its id: never while a session runs, never a decider's files while one is loaded
            if (run_state() or {}).get("running"):
                return self._send("A session is running: stop it before removing anything.", 409, "text/plain; charset=utf-8")
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            d = data.load(ARGS.root)
            ok, said = cleanup.remove(ARGS.root, d, str(asked.get("id", "")) if isinstance(asked, dict) else "", decider_up=bool(kev_base()))
            if not ok:
                return self._send(said, 400, "text/plain; charset=utf-8")
            return self._send(tidy_panel(data.load(ARGS.root), said))
        if path == "/questions":
            # the questions a person wrote for one body of work: written whole to training/questions/<id>.json. Allowed while a
            # session runs: a pass ends on the questions it began with, and the next one reads these
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 600000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            known = [t["id"] for t in (data.load(ARGS.root).get("equivalence") or {}).get("targets", [])]
            tid, qs = (asked.get("id"), asked.get("questions")) if isinstance(asked, dict) else (None, None)
            if tid not in known or not isinstance(qs, list) or not all(isinstance(x, dict) for x in qs):
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            keep = [{"ask": str(x.get("ask") or "").strip()[:2000], **({"mode": "developer"} if tid == "crew" and x.get("mode") == "developer" else {})} for x in qs]
            keep = [x for x in keep if x["ask"]]
            if len(keep) > MOST_OWN:
                return self._send("At most %d questions." % MOST_OWN, 400, "text/plain; charset=utf-8")
            out = Path(ARGS.root) / "training" / "questions"
            out.mkdir(parents=True, exist_ok=True)
            tmp = out / (tid + ".json.tmp")
            tmp.write_text(json.dumps({"questions": keep}, indent=2, ensure_ascii=False) + "\n")
            tmp.replace(out / (tid + ".json"))
            return self._send(equiv(data.load(ARGS.root), inner=True))
        if path == "/config":
            # a model chosen in one of the pills: written to src/config.json, unless a session is running or it is not one that can be chosen
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            if not isinstance(asked, dict):
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            # (what it is to be equivalent on can be changed while a session runs: a pass ends on the questions it began with)
            if (run_state() or {}).get("running") and set(asked) - {"equivalence"}:
                return self._send("A session is running: stop it before changing a model.", 409, "text/plain; charset=utf-8")
            root = Path(ARGS.root)
            reg = data._json(root / "src" / "models.json", {})
            now = data._json(root / "src" / "config.json", {})
            if "equivalence" in asked:
                known = [t["id"] for t in (data.load(ARGS.root).get("equivalence") or {}).get("targets", [])]
                want = asked["equivalence"]
                if not isinstance(want, list) or not want or any(i not in known for i in want):
                    return self._send("Tick at least one, from the ones listed.", 400, "text/plain; charset=utf-8")
                now["equivalence"] = [i for i in known if i in want]
            for key, lst in (("a", "small"), ("b", "small"), ("c", "small"), ("d", "small"), ("decider", "deciders"), ("target", "targets")):
                if key in asked:
                    if key in ("c", "d") and asked[key] in ("", None):
                        now.pop(key, None)  # taken out of the swarm
                        continue
                    if not any(m.get("id") == asked[key] for m in reg.get(lst, [])):
                        return self._send("There is no %s called that." % key, 400, "text/plain; charset=utf-8")
                    now[key] = asked[key]
            # no place is left empty between two that are filled: the ones after it move up
            small = [now[k] for k in ("a", "b", "c", "d") if now.get(k)]
            for i, k in enumerate(("a", "b", "c", "d")):
                if i < len(small):
                    now[k] = small[i]
                else:
                    now.pop(k, None)
            (root / "src" / "config.json").write_text(json.dumps(now, indent=2) + "\n")
            return self._send(main_body(data.load(ARGS.root)))
        if path == "/run/start":
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
                each = max(2, min(10, int(body.get("each", 6))))
            except (ValueError, TypeError, AttributeError):
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            start_run(each)
        else:
            stop_run()
        return self._send(run_panel())

    def log_message(self, *a):  # quiet
        pass


def main(argv=None):
    global ARGS
    ap = argparse.ArgumentParser(description="The Swarm, seen: the arrangement, the larger model alongside, input against output.")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="the repository (default: the one this file is in)")
    ARGS = ap.parse_args(argv)
    srv = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    print("The Swarm's page is at http://127.0.0.1:%d/  (Ctrl+C stops it)" % srv.server_address[1], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
