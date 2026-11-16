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
import socket
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
.recbadge{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:999px;padding:4px 11px;background:#fdf0cf;color:#8a5a00;font:inherit;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 0 0 1px #f3dfb8}
.recbadge i{width:7px;height:7px;border-radius:50%;background:#e8a317;box-shadow:0 0 0 3px #f9d98a;animation:p 1.6s infinite}.recbadge:hover{background:#fae6b5}.recbadge:focus-visible{outline:2px solid var(--teal2);outline-offset:2px}
dialog#recd{border:0;border-radius:26px;padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#recd::backdrop{background:rgba(11,40,38,.45)}
.recs{list-style:none;margin:0;padding:0;display:grid;gap:10px}.rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 16px;border-radius:16px;border:1px solid var(--line2);background:#fafdfc}
.rec b{display:block;font-size:15.5px;margin-top:6px}.rec p{margin:6px 0 4px;font-size:13.5px;line-height:1.5;color:var(--fog)}.rec small{color:var(--mist);font-size:12px}
.rstr{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#d7f3e9;color:var(--right)}.rec.untested .rstr{background:var(--soft);color:var(--mist)}.rec.early .rstr{background:#fdf0cf;color:#8a5a00}.rec.info .rstr{background:#e6e9f6;color:var(--tgt)}.rec.info{grid-template-columns:minmax(0,1fr)}
.hostcard{padding:14px 16px;border-radius:16px;border:1px solid var(--line2);background:#fafdfc}.hostcard p{margin:6px 0 0;font-size:13.5px;line-height:1.5}.hcbadge{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;background:#fdf0cf;color:#8a5a00;font-size:12px;font-weight:700}
.hcon{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.hcon span{padding:2px 10px;border-radius:999px;background:var(--soft);font-size:12px;font-weight:700;color:var(--teal)}
details.told{margin-top:4px}details.told summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--teal)}details.told div{margin-top:4px;white-space:pre-wrap;font-size:12.5px;color:var(--fog)}.spec .bad{color:var(--wrong)}
.tgl{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:999px;background:var(--soft)}.tgl .seg{border:0;background:none;font:inherit;font-size:13px;font-weight:700;color:var(--mist);padding:7px 14px;border-radius:999px;cursor:pointer}
.tgl .seg.on{background:#fff;color:var(--teal);box-shadow:0 1px 4px rgba(11,93,87,.15)}.tgl .seg:focus-visible{outline:3px solid var(--teal2)}fieldset.tools{margin-top:12px}
.rech{list-style:none;margin:8px 0 0;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
@media (max-width:560px){.rec{grid-template-columns:minmax(0,1fr)}}
details.cfg{margin-top:18px}details.cfg>summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}details.cfg>summary .cfgh{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2)}
details.cfg>summary .fmeta{flex:1 1 320px;font-size:13px;font-weight:600;color:var(--mist)}details.cfg[open]>summary .fmeta{display:none}details.cfg.shutting>summary .fmeta{display:block}
details.cfg[open]>summary{margin-bottom:0}details.cfg .picks{margin-top:10px}
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
button.strip:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}.strip .meta{display:flex;flex-wrap:wrap;gap:6px;margin:0;color:var(--mist)}
.strip .meta>span{display:inline-block;padding:4px 11px;border-radius:999px;background:var(--soft);font-size:12.5px;font-weight:600;line-height:1.35;max-width:100%}
.strip .meta>span b{color:var(--fog);font-weight:800}.strip .meta>span.ok{background:#d7f3e9;color:var(--right)}.strip .meta>span.ok b{color:var(--right)}
.strip .meta>span.no{background:#fde1db;color:var(--wrong)}.strip .meta>span.no b{color:var(--wrong)}.strip .meta>span.alone{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}
.strip .meta>span.more{background:transparent;color:var(--teal);font-weight:800;padding-left:4px}
.prog{display:block;height:8px;border-radius:999px;background:var(--soft);overflow:hidden;margin:10px 0 10px;position:relative}.prog i{display:block;height:100%;float:left}
.prog .eq{background:var(--right)}.prog .ch{background:var(--sun)}.pct{font-variant-numeric:tabular-nums}.gapkey{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--mist)}.gapkey i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
.memp,.iop{margin-top:18px}.memnum{text-align:right}.memnum b{display:block;font-size:30px;font-weight:800;color:var(--teal);line-height:1}.memnum span{font-size:12.5px;color:var(--mist);font-weight:700}
.memc{display:grid;gap:0}.memh{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}.memh b{font-size:17px;font-weight:800;color:var(--fog)}
.memh small{display:block;margin-top:3px;font-size:12.5px;color:var(--mist);font-weight:500;line-height:1.45}.memc.compact .memh b{font-size:14.5px}
.memnum{text-align:right}.memnum b{display:block;font-size:30px;font-weight:800;color:var(--teal);line-height:1}.memnum span{font-size:12.5px;color:var(--mist);font-weight:700}.memc.compact .memnum b{font-size:26px}
.memrows{display:grid;gap:10px;margin-top:16px}.memrow{display:grid;grid-template-columns:minmax(0,220px) minmax(80px,1fr) 104px;gap:12px;align-items:center;font-size:14px;font-weight:700;color:var(--fog)}
.memrow .mbar{display:flex;height:18px;border-radius:999px;background:var(--soft);overflow:hidden}.memrow .mbar i{display:block;height:100%}.memrow .mbar.stack i+i{box-shadow:inset 2px 0 0 #fff}
.memrow .mv{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.memrow .mv b{color:var(--fog)}.memrow.axis{font-size:11px;color:var(--mist);font-weight:700}.memrow .ticks{position:relative;height:14px}
.memrow .ticks span{position:absolute;transform:translateX(-50%)}.memrow .ticks span:first-child{transform:none}.memleg{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;font-size:12.5px;color:var(--mist);font-weight:600}
.memleg span{display:inline-flex;align-items:center;gap:6px}.memleg i{width:10px;height:10px;border-radius:3px;flex:none}.memleg b{color:var(--fog)}
.memp,.iop{margin-top:18px}.strip .memc{margin:0 0 14px;padding:16px 18px;border-radius:18px;background:#fff;box-shadow:inset 0 0 0 1px var(--line2)}
.strip .parc{background:linear-gradient(135deg,#fff7e8,#ffffff 55%);box-shadow:inset 0 0 0 1px #f3dfb8}.strip .parc.level{background:linear-gradient(135deg,#e3f7ef,#fff 55%);box-shadow:inset 0 0 0 1px #bfe7d6}
.parc .memnum b{color:#9a5b00}.parc.level .memnum b{color:var(--right)}.parc .memh small{color:#7a6a4f;font-weight:600}.parc.level .memh small{color:var(--mist)}
.parc .mbar .pe,.parc .memleg .pe{background:var(--right)}.parc .mbar .pd,.parc .memleg .pd{background:var(--wrong)}.parc .mbar .pn,.parc .memleg .pn{background:#c9d4d1}
.parc .memrow.alone{font-weight:600;color:var(--mist)}.parc .memrow.alone .mbar{height:12px;opacity:.8}.parc .memrow .mv b{color:var(--fog)}
@media (max-width:560px){.memh{grid-template-columns:minmax(0,1fr)}.memrow{grid-template-columns:minmax(0,1fr) auto}.memrow .mbar,.memrow .ticks{grid-column:1/-1;grid-row:2}.memnum{text-align:left}.memrow.axis>span:not(.ticks){display:none}.memrow.axis .ticks{grid-row:1}}
dialog#big{border:0;border-radius:26px;padding:26px;max-width:min(1180px,96vw);width:100%;max-height:92vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:#f4fbf9}dialog#big::backdrop{background:rgba(11,40,38,.45)}
.plan-head{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;align-items:baseline}.plan h4{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal2);margin:18px 0 6px}
.plan details.psec>summary{list-style:none;cursor:pointer;border-radius:8px}.plan details.psec>summary::-webkit-details-marker{display:none}
.plan details.psec>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}
.plan details.psec>summary>h4{display:flex;align-items:center;gap:8px}.plan details.psec:not([open])>summary>h4{margin-bottom:2px}
.plan .pmeta{display:block;font-size:13px;color:var(--mist);font-weight:600;line-height:1.4;overflow-wrap:anywhere;margin:0 0 4px}.plan details.psec[open] .pmeta{display:none}
.plan details.psec.shutting .pmeta{display:block}.plan details.psec.shutting>summary>h4::after,.run details.sec.shutting>summary>h5::after{transform:rotate(-45deg)}
.plan details.psec>summary>h4::after{content:'';flex:none;width:6px;height:6px;margin-left:2px;border-right:2px solid var(--teal2);border-bottom:2px solid var(--teal2);transform:rotate(45deg);transition:transform .15s}
.plan details.psec:not([open])>summary>h4::after{transform:rotate(-45deg)}.plan details.psec{border-bottom:1px solid var(--line2);padding-bottom:8px}.plan details.psec:last-of-type{border-bottom:0}
.finds{margin:0;padding:0;list-style:none;display:grid;gap:6px}.finds li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;font-size:13.5px}
.finds .n{font-weight:800;background:#fde1db;color:var(--wrong);border-radius:999px;padding:1px 9px;font-size:12px;white-space:nowrap}
.steer{list-style:none;margin:0;padding:0;display:grid;gap:6px}.steer li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 10px;border:1px solid var(--line2);border-radius:12px}
.steer li b{font-size:13.5px}.steer li small{display:block;font-size:12px;color:var(--mist);overflow-wrap:anywhere}.segs{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;flex:none}
.seg{border:0;background:none;font:inherit;font-size:12px;font-weight:700;color:var(--mist);padding:5px 10px;cursor:pointer}.seg+.seg{border-left:1px solid var(--line)}.seg.on{background:var(--teal);color:#fff}
.seg:focus-visible{outline:2px solid var(--teal2);outline-offset:-2px}.queue{margin-top:12px}.queue .label{display:flex;justify-content:space-between;margin:0 0 6px;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
.queue .label span{letter-spacing:0;text-transform:none;font-weight:600}.mine{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px}.mine li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:13px;font-weight:600}
.mine li>span:first-child{color:var(--teal);font-weight:800}.qx{width:26px;height:26px;border:0;border-radius:8px;background:var(--soft);color:var(--mist);cursor:pointer}
.moves .mside{display:grid;gap:6px;justify-items:end}.moves .acts{display:inline-flex;gap:4px}.moves .acts button{border:1px solid var(--line);background:var(--panel);border-radius:999px;font:inherit;font-size:11.5px;font-weight:700;color:var(--teal);padding:3px 9px;cursor:pointer}
.moves li.skipped{opacity:.55}.moves li.pinned{background:linear-gradient(90deg,#e8f6f1,transparent)}
dialog#steerd{border:0;border-radius:26px;padding:26px;max-width:min(860px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#steerd::backdrop{background:rgba(11,40,38,.45)}
#steer-find{width:100%;font:inherit;font-size:14px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;margin:4px 0 6px}.movepick{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.movepick li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line2);border-radius:12px}.movepick b{font-size:13.5px;overflow-wrap:anywhere}.movepick small{display:block;color:var(--mist);font-size:12px}.qadd{padding:6px 14px}
@media (max-width:560px){.steer li{grid-template-columns:minmax(0,1fr)}.segs{justify-self:start}}
.moves{margin:0;padding:0;list-style:none}.moves li{display:grid;grid-template-columns:26px 124px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 0;border-top:1px solid var(--line2)}
.moves .o{font-weight:800;color:var(--mist);font-variant-numeric:tabular-nums}.moves .k{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 0;color:var(--teal);min-width:0;overflow-wrap:anywhere;line-height:1.35}
.moves .k.arrangement{color:var(--tgt)}.moves .k.plan{color:var(--bon)}.moves b{display:block;font-size:14.5px}.moves small{display:block;color:var(--mist);font-size:12.5px;overflow-wrap:anywhere}.moves small a{color:inherit}
.moves li.running{background:linear-gradient(90deg,#fdf0cf66,transparent)}.pill.planned{background:var(--soft);color:var(--mist)}.pill.running{background:#fdf0cf;color:#8a5a00}
@media (max-width:700px){.moves li{grid-template-columns:22px minmax(0,1fr) auto}.moves .k{grid-column:2}.moves .mv{grid-column:2/4}}
.foot{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 30px;align-items:center}
.foot .brand{display:flex;gap:12px;align-items:center}.foot .brand svg{width:40px;height:40px;border-radius:11px;flex:none}.foot .brand b{display:block;font-size:15px;letter-spacing:-.01em}.foot .brand small{color:var(--mist);font-size:12.5px}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;font-weight:700}.foot nav a{color:var(--teal);text-decoration:none}.foot nav a:hover{text-decoration:underline}
.foot .fine{grid-column:1/-1;color:var(--mist);font-size:12px;line-height:1.55;max-width:92ch}@media (max-width:700px){.foot{grid-template-columns:minmax(0,1fr)}}
.arrh{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px 18px;align-items:flex-start;margin-bottom:12px}.arrh h3{margin:0}
.achips{display:flex;flex-wrap:wrap;gap:6px}.achips span{padding:4px 11px;border-radius:999px;background:var(--soft);font-size:12.5px;font-weight:600;color:var(--mist)}.achips b{color:var(--fog)}
/* THE ARRANGEMENT AS AVATARS: a model is a face in its colour; a slot is that face, in the step of the flow it stands in. The ring
   round a slot is its record (the share of its answers equivalent to the larger model's), the halo what it is doing now. */
.roster{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.mav{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:999px;background:var(--soft);min-width:0}
button.mav{position:relative;border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}button.mav:hover,button.mav.sel{background:#dfe6f3}button.mav:focus-visible{outline:3px solid var(--teal2)}
.mav .live{position:absolute;top:2px;left:30px;margin:0;padding:0;border:0;width:12px;height:12px}.mav .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mav .live i{width:9px;height:9px;margin:0;border:2px solid var(--soft);box-sizing:content-box;background:#c9d4d1}.mav:has(.live.on) .live i{background:var(--teal2);animation:p 1.2s infinite}.mav:has(.live.done) .live i{background:var(--right)}
.via{position:relative;align-self:center;display:flex;flex-direction:column;align-items:center;gap:3px;margin:0 6px 0 -12px;padding:4px;border:0;border-radius:10px;background:none;font:inherit;cursor:pointer;flex:none}
.via:hover,.via.sel{background:rgba(63,79,134,.08)}.via .vf{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#6b78a8}.via .vf svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.via .vn{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mist)}.via:not(:last-child)::after{content:"";position:absolute;right:-15px;top:14px;width:8px;height:8px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:rotate(45deg)}
.via .live{position:absolute;top:2px;right:0;margin:0;padding:0;border:0;width:10px;height:10px}.via .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.via .live i{width:8px;height:8px;margin:0;border:2px solid #fff;box-sizing:content-box;background:#c9d4d1}
.via:has(.live.on) .vf{animation:halo 1.4s ease-out infinite;--fc:#6b78a8}.via:has(.live.on) .live i{background:var(--teal2)}.via:has(.live.done) .live i{background:var(--right)}
.mav b{display:block;font-size:13px;line-height:1.2}.mav small{display:block;font-size:11.5px;color:var(--mist);font-weight:600}.mav.tgt{margin-left:auto}
.face{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#fff;font:800 12px/1 inherit;letter-spacing:-.02em;flex:none;background:var(--fc,var(--unsure))}
.a{--fc:var(--lfm)}.b{--fc:var(--bon)}.c{--fc:#7a5cc4}.d{--fc:#2f7fb8}.kev{--fc:var(--kev)}.run{--fc:#6b78a8}.tgt{--fc:var(--tgt)}
.face svg{width:17px;height:17px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pipe{display:flex;flex-wrap:nowrap;align-items:stretch;gap:10px 0;margin-top:4px}.st:has(+.via)::after{display:none}.st:has(+.via){margin-right:16px}.pipe>.st,.pipe>.loopg{flex:0 1 auto}
.st{position:relative;display:flex;flex-direction:column;gap:8px;padding:10px 8px 8px;margin-right:16px;border-radius:16px;background:#f5faf8;border:1px solid var(--line2)}
.st:not(:last-child)::after{content:"";position:absolute;right:-14px;top:50%;width:9px;height:9px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}
.st .stt{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist);white-space:nowrap}.st .stt span{letter-spacing:0;text-transform:none;font-weight:700;margin-left:6px;color:#8a5a00}
.loopg{display:flex;flex-wrap:nowrap;gap:10px 0;padding:8px 0 4px 8px;margin-right:22px;border-radius:18px;border:1.5px dashed #e3c46a;position:relative}.loopg{flex-wrap:wrap}.loopg>.lt{flex-basis:100%;font-size:11.5px;font-weight:700;color:#8a5a00;margin:-2px 0 0 2px}
.loopg:not(:last-child)::after{content:"";position:absolute;right:-17px;top:50%;width:9px;height:9px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}.loopg .st:last-of-type{margin-right:8px}.loopg .st:last-of-type::after{display:none}
.st.mk{margin-left:auto;margin-right:0;background:#eef0f8;border-color:#d7dcef}.st.mk .stt{color:var(--tgt)}
.avs{display:flex;flex-wrap:wrap;gap:6px 2px}
.av{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:72px;padding:4px 2px 2px;border:0;border-radius:12px;background:none;font:inherit;color:inherit;cursor:pointer}
.av:hover,.av.sel{background:rgba(11,93,87,.07)}.av:focus-visible{outline:3px solid var(--teal2);outline-offset:1px}
.av .ring{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:conic-gradient(var(--fc) calc(var(--p,0)*1%),#dfe8e5 0)}
.av.norec .ring{background:#dfe8e5}.av .ring .face{width:36px;height:36px;font-size:11.5px;box-shadow:0 0 0 2px #f5faf8}
.av .nm{font-size:10.5px;font-weight:700;letter-spacing:-.01em;color:var(--fog);max-width:72px;text-align:center;line-height:1.2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.av .pc{font-size:10.5px;font-weight:700;color:var(--mist);line-height:1;white-space:nowrap}.av.norec .pc{font-weight:600;color:var(--unsure)}
.av .live{position:absolute;top:2px;right:6px;margin:0;padding:0;border:0;width:14px;height:14px}.av .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.av .live i{width:12px;height:12px;margin:0;border:2px solid #f5faf8;box-sizing:content-box;background:#c9d4d1}
.av:has(.live.on) .ring{animation:halo 1.4s ease-out infinite}.av:has(.live.on) .live i{background:var(--teal2)}
.av:has(.live.done) .live i{background:var(--right)}.av:has(.live.bad) .live i{background:var(--wrong)}
@keyframes halo{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fc) 55%,transparent)}100%{box-shadow:0 0 0 9px color-mix(in srgb,var(--fc) 0%,transparent)}}
.av .tb{position:absolute;top:40px;left:50%;transform:translateX(-50%);padding:1px 6px;border-radius:999px;background:#fdf0cf;color:#8a5a00;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;box-shadow:0 0 0 2px #f5faf8}
.av .tb.off{background:#e9eeec;color:var(--mist)}
.avkey{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 0;font-size:11.5px;color:var(--mist);font-weight:600}.avkey span{display:inline-flex;align-items:center;gap:6px}
.avkey i{display:inline-block;width:10px;height:10px;border-radius:50%}.avkey .kr{width:14px;height:14px;background:conic-gradient(var(--lfm) 60%,#dfe8e5 0);border-radius:50%}
.avdetail{margin-top:12px}.avdetail:empty{display:none}.avdetail .slot{margin:0}
@media (prefers-reduced-motion:reduce){.av:has(.live.on) .ring{animation:none;box-shadow:0 0 0 3px var(--teal2)}}
@media (max-width:560px){.via{flex-direction:row;align-self:flex-start;margin:-8px 0 8px 10px;gap:8px}.via:not(:last-child)::after{right:auto;left:16px;top:auto;bottom:-14px;transform:rotate(135deg)}.mav .live{left:30px}
  .pipe,.loopg{flex-direction:column;flex-wrap:nowrap}.st,.loopg{margin-right:0;margin-bottom:16px}.st{flex-direction:row;align-items:center;gap:8px;padding:6px 8px}.st .stt{flex:none;width:58px;white-space:normal}.st.mk{margin-left:0}.mav.tgt{margin-left:0}
  .st:not(:last-child)::after,.loopg:not(:last-child)::after{right:auto;left:22px;top:auto;bottom:-13px;transform:rotate(135deg)}.loopg .st{margin-right:8px}.loopg .st:last-of-type{margin-bottom:6px}}
.tryline{margin:8px 0 12px;padding:9px 12px;border-radius:12px;background:#fdf0cf;color:#6b4a00;font-size:13px;overflow-wrap:anywhere}.tryline b{color:#8a5a00}.tryline a{color:#8a5a00;font-weight:800;margin-left:6px}
.slot.tgt{background:#e6e9f6;border-left-color:var(--tgt)}.stage.mark{margin-top:14px;padding-top:14px;border-top:1px solid var(--line2)}.stage.mark .t{color:var(--tgt)}.slot.tgt .body{padding-top:8px}
.stage.mark .slot.tgt>summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr) auto auto;gap:4px 16px;align-items:center}.stage.mark .slot.tgt .purpose{margin:0}
@media (max-width:760px){.stage.mark .slot.tgt>summary{grid-template-columns:minmax(0,1fr)}}
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
.run .nowline{margin:0;color:var(--teal);font-size:15px;overflow-wrap:anywhere}.run .nowline b{font-weight:800}
.run details.done summary{cursor:pointer;color:var(--mist);font-size:12.5px;font-weight:700;list-style:none}.run details.done summary::before{content:'✓ ';color:var(--right)}
.run details.done[open] summary{margin-bottom:6px}.run .label{margin:2px 0 0;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
.steps.next li>span:first-child{color:var(--mist)}.steps.next li>span:nth-child(2){color:var(--fog)}
.run details.sec>summary{list-style:none;cursor:pointer;border-radius:8px}.run details.sec>summary::-webkit-details-marker{display:none}
.run details.sec>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.run details.sec[open]>summary{margin-bottom:8px}
.run details.sec>summary>h5::after{content:'';flex:none;width:6px;height:6px;margin:0 2px 2px 4px;border-right:2px solid var(--mist);border-bottom:2px solid var(--mist);transform:rotate(45deg);transition:transform .15s}
.run details.sec:not([open])>summary>h5::after{transform:rotate(-45deg)}.run details.sec>summary>h5 span{margin-left:auto}
.run .secb{display:grid;gap:8px}.run details.sec{display:block}
.run .smeta{margin:3px 0 0;font-size:12.5px;line-height:1.4;color:var(--mist);font-weight:600;overflow-wrap:anywhere}.run details.sec[open] .smeta{display:none}.run details.sec.shutting .smeta{display:block}
.run details.sec:not([open])>summary{margin-bottom:0}
details.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;border-radius:10px}details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.fmeta{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--fog);overflow-wrap:anywhere}
details.fold>summary::after{content:'';flex:none;width:7px;height:7px;margin-right:4px;border-right:2px solid var(--mist);border-bottom:2px solid var(--mist);transform:rotate(45deg);transition:transform .15s}
details.fold:not([open])>summary::after,details.fold.shutting>summary::after{transform:rotate(-45deg)}details.fold[open]>summary{margin-bottom:10px}
.run .sec>h5,.run .sec>summary>h5{margin:0;display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
.run .sec>h5 span,.run .sec>summary>h5 span{letter-spacing:0;text-transform:none;font-weight:600;font-size:12px}
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
.mtile{display:none}
@media (max-width:560px){header{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:stretch}header>.chips{grid-column:1/-1}
  .mtile{display:flex;flex-direction:column;justify-content:center;gap:3px;position:relative;min-width:0;padding:10px 30px 10px 14px;border:0;border-radius:18px;background:#fff;
    box-shadow:0 6px 18px rgba(11,93,87,.10);font:inherit;color:inherit;text-align:left;cursor:pointer}
  .mtile:active{transform:scale(.98)}.mtile:focus-visible{outline:3px solid var(--teal2)}
  .mt-k{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal)}
  .mt-state{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:7px;align-items:center}.mt-state i{width:8px;height:8px;border-radius:50%;background:var(--unsure)}
  .mt-state.on i{background:var(--teal2);animation:p 1.2s infinite}.mt-state b{font-size:14.5px;line-height:1.2;color:var(--fog);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-state small{grid-column:2;font-size:11.5px;font-weight:600;color:var(--mist)}.mt-sub{font-size:11.5px;font-weight:700;color:var(--mist);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-go{position:absolute;right:12px;top:50%;width:8px;height:8px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}
  .shell>.rail{display:none}
  dialog.sheet{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;border-radius:0;padding:18px 16px 32px;background:#ecf7f4}
  dialog.sheet .rail{display:grid;padding:0;background:none;grid-template-columns:minmax(0,1fr)}dialog.sheet #training>h2{display:none}}
@media (max-width:560px){.stages{grid-auto-columns:minmax(170px,82%)}.kpis{grid-template-columns:minmax(0,1fr)}main{padding:18px 16px 40px}h1{font-size:27px}.panel{padding:16px;border-radius:20px}}
"""

JS = """
const $=(s,r=document)=>r.querySelector(s);
// A SECTION FOLDED STAYS FOLDED: open or closed is kept on this device, and put back each time a part of the page is drawn again
const keepOpen=(root)=>{try{(root||document).querySelectorAll('details[data-keep]').forEach(d=>{const v=localStorage.getItem('swarm.open.'+d.dataset.keep);if(v!==null)d.open=v==='1';});}catch(e){}};
// SMOOTH: a section's content grows to its height as it opens and shrinks as it folds (not where motion is asked to be reduced)
const saveOpen=(d)=>{try{localStorage.setItem('swarm.open.'+d.dataset.keep,d.open?'1':'0');}catch(e){}};
document.addEventListener('click',(ev)=>{
  const sm=ev.target.closest('details.psec>summary,details.sec>summary,details.fold>summary');if(!sm)return;
  const d=sm.parentElement;const body=d.querySelector(':scope>.psecb,:scope>.secb,:scope>.foldb');
  if(!body||!body.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  ev.preventDefault();if(d.dataset.anim)return;d.dataset.anim='1';body.style.overflow='hidden';
  const done=()=>{body.style.overflow='';delete d.dataset.anim;d.classList.remove('shutting');saveOpen(d);};
  if(!d.open){d.open=true;const h=body.scrollHeight;body.animate([{height:'0px',opacity:0},{height:h+'px',opacity:1}],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'}).onfinish=done;}
  else{d.classList.add('shutting');const h=body.scrollHeight;body.animate([{height:h+'px',opacity:1},{height:'0px',opacity:0}],{duration:200,easing:'cubic-bezier(.4,0,.6,1)'}).onfinish=()=>{d.open=false;done();};}
});
// (saved on a click of its heading, and not on every toggle: a section that loads open fires one too, which would put "open" back)
document.addEventListener('click',(ev)=>{const sm=ev.target.closest('details[data-keep]>summary');if(!sm)return;const d=sm.parentElement;setTimeout(()=>{try{localStorage.setItem('swarm.open.'+d.dataset.keep,d.open?'1':'0');}catch(e){}},0);});
document.addEventListener('DOMContentLoaded',()=>keepOpen());
async function swap(url,into,opts){const r=await fetch(url,opts);$(into).innerHTML=await r.text();keepOpen($(into));if(typeof sinceTick==='function')sinceTick();}
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
    await swap(b.id==='run-go'?'/run/start':'/run/stop','#run',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body});await swap('/fragment/mtile','#mtile');watch();return;}
});
// A MODEL CHOSEN: written down, and everything that depends on it drawn again in place
document.addEventListener('change',async(ev)=>{const s=ev.target.closest('[data-pick]');if(!s)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({[s.dataset.pick]:s.value})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/chips','#chips');await swap('/fragment/run','#run');liveTick();}else{alert(await r.text());await swap('/fragment/picks','#picks');}});
// WHAT IT IS TO BE EQUIVALENT ON: the boxes ticked are written down, and the row drawn again in place
// TURNS WITH TOOLS: who takes an agent's turn, saved as a pill's choice is, and the row and the folded line drawn again in place
document.addEventListener('click',async(ev)=>{const b=ev.target.closest('[data-tools]');if(!b||b.classList.contains('on'))return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({tools:b.dataset.tools})});
  if(!r.ok){alert(await r.text());return;}
  await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');});
document.addEventListener('change',async(ev)=>{const b=ev.target.closest('[data-equiv]');if(!b)return;
  const want=[...document.querySelectorAll('[data-equiv]:checked')].map(x=>x.dataset.equiv);
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({equivalence:want})});
  if(!r.ok)alert(await r.text());
  await swap('/fragment/equiv','#equiv');await swap('/fragment/cfgmeta','#cfg-meta');});
// THE ARRANGEMENT'S FACES: choosing one opens that slot's card below the row (what it is told, its record, what is being tried
// on it); choosing it again closes it. The card is painted live like the faces, since it carries the same data-live.
document.addEventListener('click',(ev)=>{
  const a=ev.target.closest('[data-av]');if(!a)return;const box=$('#avdetail'),id=a.dataset.av;if(!box)return;
  const was=a.classList.contains('sel');document.querySelectorAll('[data-av].sel').forEach(x=>x.classList.remove('sel'));
  if(was){box.innerHTML='';return;}
  const t=document.getElementById('avt-'+id);if(!t)return;box.innerHTML=t.innerHTML;a.classList.add('sel');
  const c=box.querySelector('details');if(c)c.open=true;liveTick();
});
// RECOMMENDED CONFIGURATION CHANGES: the note beside Configuration opens them; a change is made as a pill makes one
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#rec-open')){ev.preventDefault();ev.stopPropagation();await swap('/fragment/recs','#recd-body');$('#recd').showModal();}
},true);
document.addEventListener('click',async(ev)=>{
  if(ev.target.id==='rec-close'||ev.target.id==='recd'){$('#recd').close();return;}
  const a=ev.target.closest('[data-rec-apply]');if(!a)return;a.disabled=true;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:a.dataset.recApply});
  if(!r.ok){alert(await r.text());a.disabled=false;return;}
  $('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/recslot','#rec-slot');await swap('/fragment/chips','#chips');await swap('/fragment/run','#run');$('#recd').close();
});
// STEER IT: focus an area, queue or skip a move, choose any move; each choice written down and the plan drawn again in place
const steerPost=async(body)=>{const r=await fetch('/steer',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok){alert(await r.text());return false;}$('#plan').innerHTML=await r.text();keepOpen($('#plan'));return true;};
document.addEventListener('click',async(ev)=>{
  const f=ev.target.closest('[data-steer-focus]');if(f){await steerPost({op:'focus',area:f.dataset.steerFocus,value:f.dataset.v});return;}
  const s=ev.target.closest('[data-steer]');if(s){s.disabled=true;const ok=await steerPost({op:s.dataset.steer,id:s.dataset.id});if(ok&&$('#steerd').open)await swap('/fragment/steer','#steerd-body');return;}
  if(ev.target.closest('#steer-open')){await swap('/fragment/steer','#steerd-body');$('#steerd').showModal();return;}
  if(ev.target.id==='steer-close'||ev.target.id==='steerd'){$('#steerd').close();return;}
});
document.addEventListener('input',(ev)=>{if(ev.target.id!=='steer-find')return;const q=ev.target.value.toLowerCase().trim();document.querySelectorAll('#steerd .movepick li').forEach(li=>{li.style.display=!q||li.dataset.q.includes(q)?'':'none';});});
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
  if(ev.target.id==='spec-save'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('#spec-json').textContent],{type:'application/json'}));a.download='swarm-spec.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return;}
  if(ev.target.id==='spec-copy'){try{await navigator.clipboard.writeText($('#spec-json').textContent);ev.target.textContent='Copied';}catch(e){ev.target.textContent='Select it below';}}
});
// while a pass runs, its steps are asked for again every few seconds; when it ends the rest of the page is read again once
let timer=null;
function watch(){if(timer)return;timer=setInterval(async()=>{const was=!!$('#run [data-running]');await swap('/fragment/run','#run');await swap('/fragment/mtile','#mtile');
  if(!$('#run [data-running]')){clearInterval(timer);timer=null;if(was){await swap('/fragment/body','#body');await swap('/fragment/picks','#picks');await swap('/fragment/mtile','#mtile');}}
  else{await swap('/fragment/score','#score');if($('#plan'))await swap('/fragment/plan','#plan');
    await swap('/fragment/chips','#chips');
    if($('#spec').open){const y=$('#spec').scrollTop;await swap('/fragment/spec','#spec-body');$('#spec').scrollTop=y;}}},4000);}
if($('#run [data-running]'))watch();
// WHAT EVERY SLOT IS DOING NOW: asked for every second and a half while a session runs, and written onto the cards in place
const STEP={measure:'Measuring the swarm',improve:'Trying a brief',arrange:'Trying an arrangement',baseline:'One model alone'};
function paint(el,cls,text){el.className='live '+cls;const sp=el.querySelector('span');if(sp.textContent!==text){sp.textContent=text;el.title=text;}}
// WHEN THE SESSION BEGAN, in the time zone of the person looking, and how long it has run in all: written again every tick
function sinceTick(){document.querySelectorAll('[data-since]').forEach(el=>{const t=Number(el.dataset.since),s=Math.max(0,Math.floor((Date.now()-t)/1000));
  const span=s<60?s+' s':s<3600?Math.floor(s/60)+' min '+s%60+' s':Math.floor(s/3600)+' h '+Math.floor(s%3600/60)+' min';
  const at=new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const atShort=new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  el.querySelector('b').textContent=el.dataset.short?span:'Running '+span;el.querySelector('small').textContent=el.dataset.short?'since '+atShort:'since '+at;});
  // the phone's tile: where the session is, from the training column's own Pass and Now ("Pass 1 · step 10 of 26")
  const w=$('#mtile [data-where]');if(w){const pass=document.querySelector('[data-keep="run-pass"] h5'),now=document.querySelector('[data-keep="run-now"] h5 span');
    const p=pass?(pass.childNodes[0]||{}).textContent||'':'',n=now?now.textContent.split(' · ')[0]:'';const txt=[p.trim(),n.trim()].filter(Boolean).join(' · ');if(txt&&w.textContent!==txt)w.textContent=txt;}}
// ON A PHONE: the training column opens from the tile beside the title, in a sheet; it is the same column, moved, and moved back
document.addEventListener('click',(ev)=>{
  if(ev.target.closest('#mtile')){const r=document.querySelector('.rail');if(r)$('#mtrain-body').append(r);$('#mtrain').showModal();return;}
  if(ev.target.id==='mtrain-close')$('#mtrain').close();
});
document.addEventListener('close',(ev)=>{if(ev.target.id!=='mtrain')return;const r=$('#mtrain-body .rail');if(r)document.querySelector('.shell').append(r);},true);
matchMedia('(min-width:561px)').addEventListener('change',(m)=>{if(m.matches&&$('#mtrain').open)$('#mtrain').close();});
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
  if(alone)document.querySelectorAll('.slot.'+n.who+' [data-live], .av.'+n.who+' [data-live]').forEach(el=>{const s=slots[n.who];
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


KIND_WORDS = {"agent": "An agent's next step, with tools", "write-arrays": "Write a function: arrays", "write-strings": "Write a function: strings", "write-numbers": "Write a function: numbers",
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
    """THE WHOLE MEASUREMENT, opened from the parity card in every state: on the held questions where the swarm has answered them
    (parity is said there); where it has not yet, on this pass's train questions, said to be those and not parity; and where it
    has answered nothing, what there is (the memory, and the larger model's answers in input against output)."""
    tgt = d["target"]
    tname = tgt["name"] if tgt else "the larger model"
    short = tname.split(" ")[0]
    which = "held" if d["splits"]["held"]["swarm"] and d["splits"]["held"]["parity"] else "train" if d["splits"]["train"]["swarm"] and d["splits"]["train"]["parity"] else ""
    if not which:
        return (
            '<div class="panel"><p class="verdict">Not measured yet.</p><p class="muted" style="margin:0">No pass has put the swarm and %s to the same questions yet. '
            "Press <b>Run training</b>, or run <code>bash training/session.sh</code>; this fills in as it goes.</p></div>" % e(tname)
        ) + memory_panel(d) + io_section(d)
    held = d["splits"][which]
    p = held["parity"]
    word = "held" if which == "held" else "train"
    off = p["compared"] - p["equivalent"]
    out = ['<div class="kpis">']
    out.append(kpi("Toward parity with " + short, "%s<small>%%</small>" % fmt_pct(p["percent"]), "at parity" if p["level"] else "%d of %d equivalent" % (p["equivalent"], p["compared"]), "scale", "#0b5d57", "#d9f2ec", "up" if p["level"] else ""))
    out.append(kpi("Equivalent answers", "%d <small>of %d</small>" % (p["equivalent"], p["compared"]), "to " + short, "check", "#149a72", "#d7f3e9"))
    out.append(kpi("Different answers", "%d <small>of %d</small>" % (p["differ"], p["compared"]), "%d gave none" % p["none"], "target", "#f2644b", "#fde1db"))
    out.append(kpi("Seconds a reply", "%s <small>s</small>" % p["seconds"], "the swarm", "clock", "#c98a06", "#fdf0cf"))
    out.append("</div>")
    if which == "train":
        out.insert(0, '<div class="panel tnote"><p class="small" style="margin:0"><b>The held questions are not answered yet in this pass.</b> What follows is the swarm on this pass&#39;s %d train questions so far: they choose what to try. Parity is said on the held questions, which the swarm has never been chosen on, at the end of the pass.</p></div>' % p["compared"])

    # pass by pass: how many answers are equivalent, against all of them (which is parity); the passes were measured on held questions
    hist = [h for h in d["state"].get("history", []) if h.get("compared")] if which == "held" else []
    labels = ["pass %s" % h["pass"] for h in hist] + ["now"]
    sw = [h["equivalent"] * p["compared"] / h["compared"] for h in hist] + [p["equivalent"]]
    words = verdict_words(p, tname) if which == "held" else "%s%% on this pass's train questions so far: %d of %d equivalent to %s's." % (fmt_pct(p["percent"]), p["equivalent"], p["compared"], tname)
    verdict = ('<p class="verdict %s" style="margin-top:12px">%s</p><p class="muted small" style="margin:0">Parity is every answer fundamentally equivalent to %s&#39;s. On %d %s questions the swarm&#39;s answer was equivalent on %d, different on %d, and it gave none on %d. Whether either was right is not what is measured.</p>'
               % (("level" if p["level"] else "behind") if which == "held" else "", e(words), e(tname), p["compared"], word, p["equivalent"], p["differ"], p["none"]))
    out.append(
        '<div class="charts"><div class="panel tint"><div class="chart-head"><div><h3>Toward parity, pass by pass</h3><div class="muted small">' + word.capitalize() + ' answers equivalent to %s\'s. Parity is all %d</div></div>'
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
    ps = data.parity(held.get("self") or []) if which == "held" else None
    if ps:
        bars.append(bar(short + ", asked again (the noise floor)", "muted", ps))
    out.append(
        '<div class="charts"><div class="panel"><div class="chart-head"><div><h3>How far along each kind of question is</h3><div class="muted small">The share of ' + word + ' answers of that kind that are equivalent to %s&#39;s, furthest behind first. Teal: all of them</div></div></div><div class="kb">%s</div></div>'
        '<div class="panel"><h3>Each alone, beside the swarm</h3><div class="muted small" style="margin-bottom:14px">Equivalent to %s&#39;s answer · different · none</div><div class="score">%s</div></div></div>'
        % (e(short), kind_bars(kinds), e(short), "".join(bars))
    )
    out.append(memory_panel(d))
    out.append(io_section(d))
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
    return "%s%% of the way to parity with %s: %d of %d held answers are equivalent%s." % (
        fmt_pct(p["percent"]), tname, p["equivalent"], p["compared"],
        (" (%d of the different ones the reader could not decide)" % p["undecided"]) if p.get("undecided") else "")


def noise_floor(d, tname):
    """The larger model against itself, in a phrase, where it has been measured: how often its own second answer is equivalent to
    its first. A swarm cannot be expected to agree with it more often than it agrees with itself."""
    ps = data.parity(d["splits"]["held"].get("self") or [])
    if not ps:
        return ""
    return ('<span title="Asked each held question again (another draw) and judged against its own first answers, by the same readers. '
            'Parity beyond this is not to be expected: the mark itself would not give those answers again">%s against itself <b>%s%%</b> · %d of %d</span>'
            % (e(tname.split(" ")[0]), fmt_pct(ps["percent"]), ps["equivalent"], ps["compared"]))


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
                out.append('<span class="alone">%s alone <b>%s%%</b> · %d of %d</span>' % (e(data.MEMBER_NAMES[k]), fmt_pct(pa["percent"]), pa["equivalent"], pa["compared"]))
        return "".join(out)

    # THE MEMORY IT TAKES, against the larger model's: what the swarm is for. The same chart as the whole measurement's, compact
    mem = memory_chart(d, compact=True)

    def parity_chart(cls, verdict, q, sp, label):
        """How far toward parity, in the memory chart's design: the share large, the verdict in a sentence, the swarm's answers as one
        bar (equivalent, different, no answer) and each small model alone beside it on the same scale, with a key."""
        n = q["compared"] + q.get("none", 0) if q.get("compared") is not None else 0
        n = max(n, 1)
        bar = lambda x: ('<span class="mbar stack"><i class="pe" style="width:%.2f%%" title="%d equivalent"></i><i class="pd" style="width:%.2f%%" title="%d different"></i><i class="pn" style="width:%.2f%%" title="%d no answer"></i></span>'  # noqa: E731
                         % (100.0 * x["equivalent"] / n, x["equivalent"], 100.0 * x.get("differ", 0) / n, x.get("differ", 0), 100.0 * x.get("none", 0) / n, x.get("none", 0)))
        rows = ['<span class="memrow"><span class="ml">The swarm</span>%s<span class="mv"><b>%d of %d</b></span></span>' % (bar(q), q["equivalent"], q["compared"])]
        for k, rr in sp["alone"].items():
            pa = data.parity(rr) if rr else None
            if pa:
                rows.append('<span class="memrow alone"><span class="ml">%s alone</span>%s<span class="mv">%s</span></span>' % (e(data.MEMBER_NAMES[k]), bar(pa), e(how_far(pa["equivalent"], pa["compared"]))))
        ps = data.parity(sp.get("self") or [])
        if ps:
            rows.append('<span class="memrow alone self" title="The larger model asked each question again, and judged against its own first answers: the noise floor under parity">'
                        '<span class="ml">%s, asked again</span>%s<span class="mv">%s</span></span>' % (e(tname.split(" ")[0]), bar(ps), e(how_far(ps["equivalent"], ps["compared"]))))
        step = 10 if n > 30 else 5 if n > 12 else 2
        ticks = "".join('<span style="left:%.2f%%">%d</span>' % (100.0 * t / n, t) for t in list(range(0, n, step)) + [n] if t == n or n - t >= step / 2)
        return ('<span class="memc parc %s"><span class="memh"><span><b>Toward parity with %s</b><small>%s</small></span>'
                '<span class="memnum"><b class="pct">%s%%</b><span>of the way · parity is 100%%</span></span></span>'
                '<span class="memrows">%s<span class="memrow axis"><span></span><span class="ticks">%s</span><span class="mv">%s</span></span></span>'
                '<span class="memleg"><span><i class="pe"></i>equivalent to %s&#39;s answer</span><span><i class="pd"></i>a different answer</span><span><i class="pn"></i>no answer</span></span></span>'
                % (cls, e(tname), e(verdict), fmt_pct(q["percent"]), "".join(rows), ticks, e(label), e(tname.split(" ")[0])))

    def strip(cls, verdict, meta, more=True, pct=None, chart=""):
        # (the whole card opens the whole measurement, in every state: it shows what there is)
        tag = ('<button type="button" class="panel strip" id="score-open" title="Open the whole measurement">', "</button>")
        top = chart or ('<p class="verdict %s">%s</p>' % (cls, e(verdict)))
        return '%s%s%s<p class="meta">%s%s</p>%s' % (
            tag[0], top, mem, meta, '<span class="more">Open the whole measurement</span>', tag[1])

    def follows(q):
        spec = q.get("onSpec") or {}
        return '%s' % (
            '<span title="Parity is equivalence with the larger model whatever it answers. This is the same count on the questions where its own answer does what the question says">where %s follows the question <b>%s%%</b> · %d of %d</span>'
            % (e(tname.split(" ")[0]), fmt_pct(data.percent(spec["equivalent"], spec["compared"])), spec["equivalent"], spec["compared"]) if spec.get("compared") and spec["compared"] < q["compared"] else "")
    if held["swarm"] and p:
        done, want = len(held["swarm"]), held["expected"] or len(held["swarm"])
        off = p["compared"] - p["equivalent"]
        if done < want:
            # the held questions are being answered now: what there is, and that it is not yet the verdict
            v = "Being measured: %s%% so far. %d of %d held answers in, %d equivalent to %s's." % (fmt_pct(p["percent"]), done, want, p["equivalent"], tname)
            return strip("", v, follows(p) + "<span><b>%s</b> s a reply</span><span>The verdict is given when all %d are answered</span>" % (e(str(p["seconds"])), want),
                         chart=parity_chart("", v, p, held, "held answers"))
        v = verdict_words(p, tname)
        return strip("level" if p["level"] else "behind", v,
                     "<span><b>%d</b> held questions</span>" % p["compared"] + noise_floor(d, tname) + follows(p) + "<span><b>%s</b> s a reply</span>" % e(str(p["seconds"])),
                     chart=parity_chart("level" if p["level"] else "behind", v, p, held, "held answers"))
    pt = train["parity"]
    if train["swarm"] and pt:
        done, want = len(train["swarm"]), train["expected"] or len(train["swarm"])
        v = "%s%% on this pass's train questions%s: %d of %d answers are equivalent to %s's." % (fmt_pct(pt["percent"]), " so far" if done < want else "", pt["equivalent"], pt["compared"], tname)
        return strip("", v, ("<span><b>%d</b> of %d answered</span>" % (done, want) if done < want else "") + follows(pt) + alone_of(held)
                     + "<span><b>%s</b> s a reply</span><span>These choose what to try. Parity is said on the held questions, at the end of the pass</span>" % e(str(pt["seconds"])), more=False,
                     chart=parity_chart("", v, pt, {"alone": {}}, "train answers"))
    answered = len(held["target"])
    if answered or alone_of(held):
        return strip("", "%s has answered %d held question%s. The swarm has not answered yet." % (tname, answered, "" if answered == 1 else "s"),
                     (alone_of(held) or "<span>Each small model alone is next</span>") + "<span>Its answers are the mark everything else is compared with</span>", more=False)
    return strip("", "Not measured yet.", "<span>No pass has put the swarm and %s to the same questions yet</span>" % e(tname), more=False)


FOUND = {"elsewhere": "kept in another configuration", "drafts-short": "no slot had the answer", "weak-draft": "a weak drafter", "check-worse": "a checker turning answers away", "decider-threw": "the decider chose another",
         "writer-changed": "the writer changed the answer", "silent": "a slot that said nothing", "replay": "the last measurement replayed: it would have won answers"}
STATUS = {"planned": "Planned", "running": "Being measured", "stopped": "Stopped partway", "kept": "Kept", "not kept": "Not kept"}


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


STEER_AREAS = [("briefs", "Briefs", "What each slot is told"), ("slots", "Slots", "Which model sits where, what a checker sees, how freely a drafter samples, the writer"),
               ("flow", "Flow", "The order of steps: checks, answers sent back, loops of checking"),
               ("decider", "Decider placement", "Where the decision model stands, and how it settles: early if sure, narrowing to two, by vote"),
               ("loops", "Decider loops", "The decision model inside a loop: narrowing and sending back, asking again after a check, a tournament"),
               ("several", "Several at once", "Arrangements several changes away at once")]
STEER_ID = re.compile(r"^(brief|arrange):[\w.+:-]{1,160}$")


def read_steer(d):
    """What a person has asked the plan to do, for this configuration (training/support/steer.mjs reads the same file)."""
    j = data._json(work_of(d["root"], d.get("key")) / "steer.json", {}) or {}
    return {"focus": j.get("focus") if isinstance(j.get("focus"), dict) else {}, "pin": [str(x) for x in j.get("pin") or [] if isinstance(x, str)],
            "skip": [str(x) for x in j.get("skip") or [] if isinstance(x, str)]}


def steer_section(d, p):
    """STEER IT: lean the search on an area, put a move first, skip one, or choose any move open to this pass."""
    sv = read_steer(d)
    names = {m["id"]: m.get("what", "") for m in (p.get("catalog") or []) + (p.get("moves") or []) if m.get("id")}
    seg = lambda area, cur: "".join(  # noqa: E731
        '<button type="button" class="seg%s" data-steer-focus="%s" data-v="%s" aria-pressed="%s">%s</button>' % (" on" if cur == v else "", area, v, "true" if cur == v else "false", w)
        for v, w in (("less", "Less"), ("", "As planned"), ("more", "More"), ("only", "Only")))
    rows = "".join('<li><span title="%s"><b>%s</b><small>%s</small></span><span class="segs">%s</span></li>' % (e(about), e(name), e(about), seg(a, sv["focus"].get(a, ""))) for a, name, about in STEER_AREAS)
    queue = "".join('<li><span>%d</span><span>%s</span><button type="button" class="qx" data-steer="unpin" data-id="%s" title="Take it off the queue" aria-label="Take it off the queue">×</button></li>'
                    % (i + 1, e(names.get(pid, pid)), e(pid)) for i, pid in enumerate(sv["pin"]))
    skipped = len(sv["skip"])
    return ('<h4>Steer it</h4><p class="small" style="margin:0 0 10px">From outside you may see an opportunity the measurement does not. Lean the search on an area, '
            'put a move first, or skip one. Whatever you choose is still kept only on evidence: steering decides what is tried, never what is kept. '
            '<span class="muted">Pins and skips are used when their step begins; the focus from the next time the plan is written.</span></p>'
            '<ul class="steer">%s</ul>'
            '<div class="queue"><p class="label">Your queue<span>%s</span></p>%s<button type="button" class="btn top" id="steer-open" style="background:var(--soft);color:var(--fog);box-shadow:none">Choose any move</button></div>'
            % (rows, ("%d skipped" % skipped) if skipped else "", ('<ol class="mine">%s</ol>' % queue) if queue else '<p class="muted small" style="margin:0 0 8px">Nothing queued: the plan&#39;s own order stands.</p>'))


def steer_dialog(d):
    """Every move open to this pass, by area, to queue: what the plan wrote down as open (its catalog)."""
    p = read_plan(d) or {}
    sv = read_steer(d)
    cat = p.get("catalog") or []
    if not cat:
        return ('<div class="spec-head"><div><div class="kicker">Steer it</div><h3 style="font-size:22px;margin-top:4px">Choose any move</h3></div><button class="btn stop top" id="steer-close" type="button">Close</button></div>'
                '<p class="muted" style="margin-top:12px">The list of every open move comes with the next plan this pass writes. Until then, a move of the plan below can be put first or skipped.</p>')
    groups = []
    for a, name, about in STEER_AREAS:
        items = [m for m in cat if m.get("area") == a]
        if not items:
            continue
        lis = "".join('<li data-q="%s"><span><b>%s</b><small>%s%s</small></span>%s</li>' % (
            e((m.get("what", "") + " " + m.get("technique", "") + " " + m.get("slot", "")).lower()), e(m.get("what", "")), e(m.get("technique", "")), (" · " + e(m["slot"])) if m.get("slot") else "",
            '<span class="muted small">queued</span>' if m["id"] in sv["pin"] else '<button type="button" class="btn top qadd" data-steer="pin" data-id="%s">Queue</button>' % e(m["id"])) for m in items)
        groups.append('<h4>%s <span class="muted small" style="font-weight:600;letter-spacing:0;text-transform:none">%d · %s</span></h4><ul class="movepick">%s</ul>' % (e(name), len(items), e(about), lis))
    return ('<div class="spec-head"><div><div class="kicker">Steer it</div><h3 style="font-size:22px;margin-top:4px">Choose any move</h3></div><button class="btn stop top" id="steer-close" type="button">Close</button></div>'
            '<p class="muted small" style="margin:8px 0 10px">Every move open to this pass. A queued move is measured first when its step begins, and kept only on evidence.</p>'
            '<input type="search" id="steer-find" placeholder="Find a move: decider, revise, a-critic, temperature..." aria-label="Find a move">%s' % "".join(groups))


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
    out.append(steer_section(d, p))
    sv = read_steer(d)
    out.append('<h4>Moves, in the order they are measured</h4>')
    if not moves:
        out.append('<p class="muted small" style="margin:0">Nothing is left to try from here: every candidate and every arrangement one step away has been measured and not kept.</p>')
    rows = []
    live = session_live()
    for x in moves:
        st = x.get("status", "planned")
        if st == "running" and not live:
            st = "stopped"  # (stopped while it was being measured: the step carries on from what it wrote down, when training is run again)
        where = " · ".join(v for v in [e(x.get("technique", "")), ("%s (%s, %s)" % (e(x["slot"]), e(x.get("stage", "")), e(x.get("model", "")))) if x.get("slot") else "",
                                        '<a href="https://arxiv.org/abs/%s" target="_blank" rel="noopener">arXiv %s</a>' % (e(x["from"]), e(x["from"])) if x.get("from") else ""] if v)
        why = x.get("why") or []
        reason = ("Chosen because of: %s." % ", ".join(sorted({FOUND.get(w.split(":")[0], w) for w in why}))) if why else "The measurement does not point at it. It is here because no pass has tried it."
        r = x.get("result")
        res = ""
        if r and r.get("train") and r.get("now"):
            res = "<small><b style=\"display:inline;font-size:inherit\">Measured:</b> %d equivalent, %d different on train (as it was: %d, %d). %s.</small>" % (
                r["train"].get("right", 0), r["train"].get("wrong", 0), r["now"].get("right", 0), r["now"].get("wrong", 0), e(str(r.get("why", "")).capitalize()))
        mid = x.get("id", "")
        pinned, skipped = mid in sv["pin"], mid in sv["skip"]
        acts = ""
        if st == "planned" and mid and STEER_ID.match(mid):
            acts = '<span class="acts">%s%s</span>' % (
                '<button type="button" data-steer="unpin" data-id="%s">Unqueue</button>' % e(mid) if pinned else '<button type="button" data-steer="pin" data-id="%s" title="Measure it first when its step begins">Next</button>' % e(mid),
                '<button type="button" data-steer="unskip" data-id="%s">Unskip</button>' % e(mid) if skipped else '<button type="button" data-steer="skip" data-id="%s" title="Never measure it">Skip</button>' % e(mid))
        if x.get("pinned"):
            reason = "Queued by you. " + reason
        rows.append('<li class="%s%s"><span class="o">%s</span><span class="k %s">%s</span><span class="mv"><b>%s</b><small>%s</small><small>%s</small>%s</span><span class="mside"><span class="pill %s">%s</span>%s</span></li>'
                    % (e(st.replace(" ", "-")), " skipped" if skipped else " pinned" if pinned else "", e(str(x.get("order", ""))), e(x.get("kind", "")), e({"brief": "Brief", "plan": "Plan", "arrangement": "Arrangement"}.get(x.get("kind"), x.get("kind", ""))),
                       e(x.get("what", "")), where, e(reason), res, {"kept": "up", "not kept": "down", "running": "running"}.get(st, "planned"),
                       e("Skipped" if skipped else "Queued" if pinned else STATUS.get(st, st)), acts))
    if rows:
        out.append('<ul class="moves">%s</ul>' % "".join(rows))
    o = p.get("open") or {}
    if o.get("arrangements") is not None:
        out.append('<p class="muted small" style="margin:12px 0 0">%d arrangements one step from this one are untried, %d have been measured and not kept. A move is kept only if it does better on the train questions and no worse on the held ones.</p>'
                   % (o.get("arrangements", 0), o.get("arrangementsTried", 0)))
    out.append("</div>")
    # WHAT EACH SUBSECTION SAYS, IN A LINE, shown while it is folded (they begin folded: the plan reads as a list of its parts)
    meta = {}
    if g:
        meta["the-gap-on-the-train-questions"] = "%s%% on the train questions · %d to close: %d by choosing better, %d need better drafts" % (fmt_pct(g["percent"]), g["toClose"], g["choosing"], g["drafting"])
    if m:
        top = max(finds, key=lambda x: x.get("answers", 0)) if finds else None
        meta["what-the-measurement-showed"] = "%d compared · %d equivalent · %d finding%s%s" % (
            m.get("compared", 0), m.get("equivalent", 0), len(finds), "" if len(finds) == 1 else "s", (", the largest: %s on %d" % (FOUND.get(top["id"].split(":")[0], top["id"]), top.get("answers", 0))) if top else "")
    if p.get("focus"):
        meta["questions"] = "%d more train questions across %d kinds the last pass answered differently on" % (sum(int(x.get("more", 0)) for x in p["focus"]), len(p["focus"]))
    bits = []
    if isinstance(mem, dict) and mem.get("pass") == n:
        best = next((x for x in mem.get("models") or [] if "drafts" in x), None)
        bits.append(("%s drafts %s of the %d no slot drafted" % (best["name"], best["drafts"], mem.get("gap", 0))) if best else "no other small model here to ask")
    if isinstance(rep, dict) and rep.get("pass") == n:
        bits += ["%s: %d against %d" % (r["decider"], r.get("theirsRight", 0), r.get("kevRight", 0)) for r in rep.get("results") or []]
    if bits:
        meta["what-only-you-can-change"] = " · ".join(bits)
    meta["how-it-is-training"] = "a change must win by %s · %s arrangements and %s at once a pass%s" % (
        (pol.get("keep") or {}).get("margin", "?"), (pol.get("trials") or {}).get("arrangements", "?"), (pol.get("trials") or {}).get("wild", 0), (" · %d setting%s changed this pass" % (len(log), "" if len(log) == 1 else "s")) if log else "")
    fl = {k: v for k, v in sv["focus"].items() if v}
    meta["steer-it"] = " · ".join([", ".join("%s %s" % (dict((a, nm) for a, nm, _ in STEER_AREAS).get(k, k), v) for k, v in fl.items()) or "as planned"]
                                   + ["%d queued" % len(sv["pin"])] * bool(sv["pin"]) + ["%d skipped" % len(sv["skip"])] * bool(sv["skip"]) + ["nothing queued"] * (not sv["pin"]))
    running = [x for x in moves if x.get("status") == "running"]
    meta["moves-in-the-order-they-are-measured"] = "%d move%s · %d measured · %d kept%s" % (len(moves), "" if len(moves) == 1 else "s", len(done), len(kept),
                                                                                          ((" · now: %s" if live else " · stopped partway: %s") % running[0].get("what", "")) if running else "")
    return fold_sections("".join(out), "plan", meta=meta, start_open=False)


def fold_sections(html, prefix, meta=None, start_open=True):
    """Each subsection of a panel (an <h4> and what follows it, up to the next one or the panel's end) made one that folds under
    its heading: open to begin with, and kept open or folded on this device (the page's keepOpen)."""
    starts = [m.start() for m in re.finditer(r"<h4>", html)]
    if not starts:
        return html
    end = html.rindex("</div>")
    out = [html[:starts[0]]]
    for i, a in enumerate(starts):
        b = starts[i + 1] if i + 1 < len(starts) else end
        part = html[a:b]
        head_end = part.index("</h4>") + 5
        title = re.sub(r"<[^>]+>", "", part[4:head_end - 5])
        key = prefix + "-" + (re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or str(i))
        line = (meta or {}).get(key[len(prefix) + 1:])
        out.append('<details class="psec" data-keep="%s"%s><summary>%s%s</summary><div class="psecb">%s</div></details>' % (
            e(key), " open" if start_open else "", part[:head_end], ('<span class="pmeta">%s</span>' % e(line)) if line else "", part[head_end:]))
    out.append(html[end:])
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
        if rec and rec.get("judged", rec["ran"]):
            sub.append("<span>equivalent %d of %d</span>" % (rec["right"], rec.get("judged", rec["ran"])))
        elif rec and rec["ran"]:
            sub.append("<span>%d answered, not yet judged</span>" % rec["ran"])
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


def stages(d, row=None, mark=""):
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
    return (line if row is None else "") + '<div class="stages">%s</div>%s' % ("".join(out), mark)


def initials(name):
    """Two or three characters that stand for a model on its face: LFM2.5 2.6B -> LFM, Bonsai 2 2B -> B2, Kev 4B -> K4."""
    w = str(name or "?").split()
    head = re.match(r"[A-Za-z]+", w[0])
    head = head.group(0) if head else w[0]
    if head.isupper() and len(head) >= 2:
        return head[:3]
    return (head[:1] + (re.sub(r"[^0-9A-Za-z]", "", w[1])[:1] if len(w) > 1 else head[1:2])).upper()


def slot_name(sid):
    """A slot's name under its face, whole: its hyphens do not break (U+2011), except the last of a long one, where it may."""
    nb = lambda x: e(x).replace("-", "&#8209;")  # noqa: E731
    if sid.count("-") > 1:
        head, tail = sid.rsplit("-", 1)
        return nb(head) + "-<wbr>" + nb(tail)
    return nb(sid)


SANDBOX_FACE = '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>'


def avatars(d):
    """THE ARRANGEMENT AS AVATARS: the models as faces (the roster), and the flow as stations, each slot a face of its model in the
    step it stands in. On each slot: its record as a ring, what it is doing now as a dot and a halo (painted live, as the cards
    were), and a badge while the plan is trying a brief on it. Choosing one opens its card, with what it is told, below."""
    b, t = d["briefs"], d["target"]
    slots = b["slots"]
    by_id = {x["id"]: x for x in slots}
    members = d.get("members", {})
    name = lambda place: (members.get(place) or {}).get("name") or data.MEMBER_NAMES.get(place, place)  # noqa: E731
    dec = (d.get("decider") or {}).get("name", "Kev")
    # one face for each model, and no two the same: two of one family (LFM2.5 2.6B and 1.2B) are told apart by their size
    places = [k for k in ("a", "b", "c", "d") if k in members]
    first = {k: initials(name(k)) for k in places}
    fc = dict(first)
    for k in places:
        if sum(1 for j in places if first[j] == first[k]) > 1:
            size = re.search(r"(\d+(?:\.\d+)?)B\b", name(k))
            fc[k] = (fc[k][:1] + size.group(1)) if size else fc[k]
    live_now = session_live()
    p = read_plan(d)
    trying = {m["slot"] for m in (p or {}).get("moves", []) if m.get("status") == "running" and m.get("slot")}
    # the roster: each model once, with what it brings
    roster = []
    for place in [k for k in ("a", "b", "c", "d") if k in members]:
        n_ = sum(1 for s in slots if s["member"] == place)
        gb = ((members.get(place) or {}).get("bytes") or 0) / 2**30
        roster.append('<div class="mav %s"><span class="face">%s</span><div><b>%s</b><small>%d slot%s%s</small></div></div>'
                      % (place, e(fc[place]), e(name(place)), n_, "" if n_ == 1 else "s", (" · %.1f GB" % gb) if gb else ""))
    roster.append('<div class="mav kev"><span class="face">%s</span><div><b>%s</b><small>decides%s</small></div></div>'
                  % (e(initials(dec)), e(dec), (" · about %s GB" % e(str(d["decider"]["memGb"]))) if (d.get("decider") or {}).get("memGb") else ""))
    if t:
        roster.append('<button type="button" class="mav tgt" data-av="target" title="%s: its answer is what the swarm must be equivalent to. Choose it to read how it is served"><span class="face">%s</span><div><b>%s</b><small>the mark%s</small></div>'
                      '<span class="live" data-live="target"><i></i><span>Idle</span></span></button>'
                      % (e(t["name"]), e(initials(t["name"])), e(t["name"]), (" · about %s GB" % e(str(t["memGb"]))) if t.get("memGb") else ""))
    tpl = {}  # each slot's card, once: opened below the row when its face is chosen

    def face_of(s):
        rec = d["record"].get(s["id"])
        judged = rec.get("judged", rec.get("ran", 0)) if rec else 0
        pct = (100.0 * rec["right"] / judged) if judged else None
        badge = ""
        if s["id"] in trying:
            badge = '<span class="tb%s">%s</span>' % ("" if live_now else " off", "trying" if live_now else "stopped")
        tip = "%s · %s · %s%s%s" % (s["id"], name(s["member"]), s.get("purpose") or s["stage"],
                                    (" · equivalent %d of %d judged" % (rec["right"], judged)) if pct is not None else (" · %d answered, not yet judged against the larger model" % rec["ran"]) if rec else "",
                                    (" · a brief being tried on it" if live_now else " · stopped partway through trying a brief on it") if s["id"] in trying else "")
        tpl.setdefault(s["id"], slot_card(s, d))
        return ('<button type="button" class="av %s%s" data-av="%s" title="%s" aria-label="%s"><span class="ring" style="--p:%s"><span class="face">%s</span></span>%s'
                '<span class="nm">%s</span><span class="pc">%s</span><span class="live" data-live="%s"><i></i><span>Idle</span></span></button>'
                % (s["member"], " norec" if pct is None else "", e(s["id"]), e(tip), e(tip), "%.1f" % (pct or 0), e(fc.get(s["member"]) or initials(name(s["member"]))), badge, slot_name(s["id"]),
                   ("%d of %d" % (rec["right"], judged)) if pct is not None else "&nbsp;", e(s["id"])))

    def special(key, cls, face, label, tip, card_html):
        tpl.setdefault(key, card_html)
        return ('<button type="button" class="av %s norec" data-av="%s" title="%s" aria-label="%s"><span class="ring"><span class="face">%s</span></span>'
                '<span class="nm">%s</span><span class="pc">&nbsp;</span><span class="live" data-live="%s"><i></i><span>Idle</span></span></button>'
                % (cls, e(key), e(tip), e(tip), face, e(label), e(key)))

    def of(step, dflt):
        return [by_id[i] for i in step.get("slots", []) if i in by_id] if step.get("slots") else [x for x in slots if x["stage"] == dflt]

    def station(step):
        do = step.get("do")
        faces = []
        if do in ("draft", "revise"):
            faces = [face_of(x) for x in of(step, "draft")]
        elif do == "check":
            faces = [face_of(x) for x in of(step, "check")]
        elif do == "write":
            faces = [face_of(x) for x in of(step, "write")]
        elif do in ("try", "expect"):
            # A STEP NO MODEL TAKES IS NOT A STATION: the sandbox runs the answers between two steps, so it sits on the arrow
            key = "run" if do == "try" else "expect"
            tip = "Try: the sandbox runs every answer on the same calls" if do == "try" else "Expect: one slot, asked apart, says what each call should give"
            tpl.setdefault(key, run_card(d) if do == "try" else card("run", "One slot, asked apart", "Says what each call should give, from the question alone", "expect", ["<span>expect</span>"], "",
                                                                     '<div class="body">It does not write the function. The answer that gives what it expects on the most calls is backed, and the count is put before the decider.</div>'))
            return ('<button type="button" class="via" data-av="%s" title="%s" aria-label="%s"><span class="vf">%s</span><span class="vn">%s</span>'
                    '<span class="live" data-live="%s"><i></i><span>Idle</span></span></button>' % (key, e(tip), e(tip), SANDBOX_FACE, "try" if do == "try" else "expect", key))
        elif do == "decide":
            keep = step.get("keep")
            what = "keeps %d" % keep if keep else "if sure" if step.get("sure") else "decides"
            faces = [special("kev-decide", "kev", e(initials(dec)), what, "%s: %s" % (dec, "keeps the likeliest %d answers" % keep if keep else "settles it here only if it is sure" if step.get("sure") else "decides which answer stands"), kev_card(d))]
        else:
            return ""
        extra = ""
        if do == "write" and len(faces) > 1:
            extra = '<span>the decider picks the reply</span>'
        return '<div class="st"><div class="stt">%s%s</div><div class="avs">%s</div></div>' % (e(STEP_TITLE.get(do, do)), extra, "".join(faces))

    parts = []
    # (the order of stations and the markers between them; an arrow is drawn wherever two stations meet with nothing between)
    for step in flow_of(d):
        if step.get("do") == "repeat":
            parts.append('<div class="loopg"><div class="lt">↻ again while the answers differ, up to %d times</div>%s</div>'
                         % (int(step.get("upTo", 2)), "".join(station(x) for x in step.get("steps", []))))
        else:
            parts.append(station(step))
    if t:
        serve = "llama.cpp, from " + t["file"] if t.get("engine") == "llama" else (" ".join([t["serve"]["program"]] + [str(a) for a in t["serve"]["args"]]) if isinstance(t.get("serve"), dict) else "")
        tcard = ('<details class="slot tgt" open><summary><div class="id">%s</div><div class="purpose">The larger model: its answer is what the swarm must be equivalent to</div>'
                 '<div class="sub"><span>%s</span><span>%s</span></div><div class="live" data-live="target"><i></i><span>Idle</span></div></summary>'
                 '<div class="body"><p class="muted small" style="margin:0 0 6px">One model, one slot, told nothing but the input. %s</p><p class="muted small" style="overflow-wrap:anywhere;margin:0">Served by: <code>%s</code></p>%s</div></details>'
                 % (e(t["name"]), ("%sB parameters" % e(str(t["params"]))) if t.get("params") else "", ("about %s GB" % e(str(t["memGb"]))) if t.get("memGb") else "",
                    e("By %s." % t["by"] if t.get("by") else ""), e(serve), at_parity(d, t)))
        tpl.setdefault("target", tcard)
    else:
        roster.append('<div class="mav tgt"><span class="face">?</span><div><b>No larger model is named</b><small>choose one above</small></div></div>')
    flow_line = '<p class="flowline"><b>The flow:</b> %s. %s</p>' % (
        e(" → ".join(_flow_words(x) for x in flow_of(d))),
        "This is the plain flow; a pass can change it." if not b.get("flow") else "A pass changed it from the plain flow, and can change it again.")
    # said once, here, rather than under every face: a measurement under way has answers not yet judged
    unjudged = any(r.get("ran") and not r.get("judged", r["ran"]) for k, r in d["record"].items() if k in by_id)
    key = ('<div class="avkey"><span><i class="kr"></i>ring: its record, answers equivalent to the larger model&#39;s'
           + (" (empty: answered, not judged yet)" if unjudged else "") + '</span><span><i style="background:var(--teal2)"></i>working</span>'
           '<span><i style="background:var(--right)"></i>answered</span><span><i style="background:var(--wrong)"></i>failed</span><span><i style="background:#c9d4d1"></i>idle</span>'
           '<span>choose a face to read what that slot is told</span></div>')
    tpls = "".join('<template id="avt-%s">%s</template>' % (e(k), v) for k, v in tpl.items())
    return ('<div class="roster">%s</div>%s<div class="pipe">%s</div>%s<div class="avdetail" id="avdetail"></div>%s'
            % ("".join(roster), flow_line, "".join(parts), key, tpls))


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
    # the swarm as it stands, in a line of chips; then what is running; then what the plan is trying now
    models = len({s["member"] for s in b["slots"]})
    kept = len(d["learned"]["ledger"])
    head = ('<div class="arrh"><div><h3>The swarm as it stands</h3><p class="muted small" style="margin:2px 0 0">What each slot is told, which model fills it, the order of steps, and the larger model it is measured against</p></div>'
            '<div class="achips"><span>briefs <b>v%s</b></span><span><b>%d</b> slots on <b>%d</b> models</span><span><b>%d</b> kept change%s</span></div></div>'
            % (e(str(b.get("version", 1))), len(b["slots"]), models, kept, "" if kept == 1 else "s"))
    p = read_plan(d)
    trying = [m for m in (p or {}).get("moves", []) if m.get("status") == "running"]
    plan_line = ""
    if trying:
        m0 = trying[0]
        plan_line = ('<p class="tryline"><b>%s</b>%s · %s%s <a href="#strategy">the plan</a></p>'
                     % ("Being tried now" if session_live() else "Stopped while trying", (" (%d of them)" % len(trying)) if len(trying) > 1 else "", e(m0.get("what", "")), (" · " + e(m0["slot"])) if m0.get("slot") else " · " + e(m0.get("technique", ""))))
    elif p and p.get("moves"):
        nxt = next((m for m in p["moves"] if m.get("status") == "planned"), None)
        if nxt:
            plan_line = '<p class="tryline"><b>Next in the plan</b> · %s <a href="#strategy">the plan</a></p>' % e(nxt.get("what", ""))
    one = ('<div class="panel arr">%s<div class="now" id="now"><i></i><span>Nothing is running. No model is loaded.</span></div>%s%s</div>'
           % (head, plan_line, avatars(d)))
    return '%s<h2 id="strategy">The plan being carried out</h2><div id="plan">%s</div>' % (one, plan_panel(d))


def _old_target_panel(d, t, serve, ladder):
    if t:
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
    return right


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


def session_live():
    """Whether a session is running now. A trainer marks a move 'running' as it starts measuring it, and a session that is
    stopped leaves the mark where it was: what the page says is happening must come from here, never from that mark alone."""
    st = run_state()
    return bool(st and st.get("running"))


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


def decider_state(running=False):
    """What the decider is doing, in a word: ready (it answers), busy (it is there, and slow to answer because it is deciding),
    starting (a session is running and it is not there yet), or not running. Read from the address the session's decider is at
    (SWARM_KEV, or training/kev.sh's port file)."""
    base = os.environ.get("SWARM_KEV", "")
    if not base:
        try:
            base = "http://127.0.0.1:%d" % int((Path(ARGS.root) / ".work" / "kev" / "port").read_text().strip())
        except (OSError, ValueError):
            return "starting" if running else "not running"
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/v1/models", timeout=1.5) as r:
            if r.status == 200:
                return "ready"
    except Exception:  # noqa: BLE001
        pass
    u = urlparse(base)
    try:
        with socket.create_connection((u.hostname or "127.0.0.1", u.port or 80), timeout=0.5):
            return "busy"
    except OSError:
        return "starting" if running else "not running"


# THE STEPS OF A PASS, in the order training/session.sh runs them ('*' is filled in: each small model alone, each slot whose
# briefs the plan tries)
SESSION_ORDER = ["00-begin", "00-plan", "00-reader", "01-research", "02-target", "02-target-train", "02-target-self", "03-*-alone", "05-swarm-train", "05-review",
                 "06-plan", "07-write-briefs", "07-plan", "08-members", "08-deciders", "10-improve-*", "15-arrange", "16-review",
                 "20-swarm-train", "21-swarm-held", "21-swarm-reworded", "22-end", "23-publish"]


def pass_steps(status_text):
    """A pass's status file read as steps: {name: {state, at, end, tries}}, in the order they began. state: done, failed, earlier
    (done before a stop, passed over now), now (running), stopped (begun before the session stopped and not ended: it is run
    again, carrying on from what it had)."""
    steps, order = {}, []
    lines = status_text.splitlines()
    resumed = max([i for i, l in enumerate(lines) if " RESUMED " in l] or [-1])
    for i, line in enumerate(lines):
        parts = line.split()
        if len(parts) >= 3 and parts[1] == "START":
            tries = steps[parts[2]]["tries"] + 1 if parts[2] in steps else 1
            steps[parts[2]] = {"at": parts[0], "end": None, "tries": tries, "line": i}
            if parts[2] not in order:
                order.append(parts[2])
        elif len(parts) >= 3 and parts[1] == "SKIP":
            steps[parts[2]] = {"at": parts[0], "end": "exit 0 done earlier", "tries": 1, "line": i, "earlier": True}
            if parts[2] not in order:
                order.append(parts[2])
        elif len(parts) >= 5 and parts[1] == "END" and parts[2] in steps:
            steps[parts[2]]["end"] = " ".join(parts[3:])
    for x in steps.values():
        if x["end"] is None:
            x["state"] = "now" if x["line"] > resumed else "stopped"
        elif x.get("earlier"):
            x["state"] = "earlier"
        else:
            x["state"] = "done" if (x["end"].startswith("exit 0") or x["end"].startswith("exit 2")) else "failed"
    return steps, order


def steps_ahead(steps, members, slots):
    """The steps of this pass still to come, in order: those not ended (a step that stopped is run again)."""
    want = []
    for k in SESSION_ORDER:
        if k == "03-*-alone":
            want += ["03-%s-alone" % m for m in members]
        elif k == "10-improve-*":
            want += ["10-improve-" + s for s in slots]
        else:
            want.append(k)
    return [n for n in want if n not in steps or steps[n]["state"] in ("stopped",)]


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
        try:
            dname = (data.load(ARGS.root).get("decider") or {}).get("name") or "The decider"
        except Exception:  # noqa: BLE001
            dname = "The decider"
        out.append('<p class="meta"><span>%s</span><span><b>%d</b> questions of each kind</span><span>%s <b>%s</b></span></p>'
                   % ("Goes on until stopped" if not st.get("passes") else "<b>%d</b> passes" % st["passes"], st["each"], e(dname), e(decider_state(True))))
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
            ready_n = sum(1 for x in su.get("steps", []) if x["state"] == "ready")
            out.append('<details class="sec" data-keep="run-making"><summary><h5>Making ready</h5><p class="smeta">%s</p></summary><div class="secb"><ul class="steps">%s</ul></div></details>' % (
                e("%d of %d ready · now: %s" % (ready_n, len(su.get("steps", [])), next((x["what"] for x in su.get("steps", []) if x["state"] != "ready"), "nothing"))), rows))
    # NOW, THIS PASS, AND WHERE IT IS HEADING: the step running and what it is trying; the pass, its finished steps folded and
    # the ones to come in order; and what the pass is for, toward parity
    if st:
        dirs = sorted((d2 for d2 in wdir.glob("pass-*") if d2.is_dir() and d2.name[5:].isdigit() and int(d2.name[5:]) >= st.get("first", 0)), key=lambda d2: int(d2.name[5:]))
        if dirs:
            cur = dirs[-1]
            steps, order = pass_steps((cur / "status.txt").read_text() if (cur / "status.txt").exists() else "")
            try:
                dd = data.load(ARGS.root)
            except Exception:  # noqa: BLE001
                dd = None
            plan = read_plan(dd) if dd else None
            moves = (plan or {}).get("moves") or []
            slots = list(dict.fromkeys(m["slot"] for m in moves if m.get("kind") == "brief" and m.get("slot")))
            ahead = steps_ahead(steps, list((dd or {}).get("members", {}).keys()) or ["a", "b"], slots)
            now = next((n for n in order if steps[n]["state"] == "now"), None)
            finished = [n for n in order if steps[n]["state"] in ("done", "failed", "earlier")]
            total = len(finished) + len([n for n in ahead if n != now]) + (1 if now else 0)

            def row(name):
                x = steps[name]
                bad = x["state"] == "failed"
                took = x["end"].split(" ", 2)[2] if x["end"] and len(x["end"].split(" ", 2)) > 2 else ""
                how = "done earlier" if x["state"] == "earlier" else "nothing to do" if x["end"].startswith("exit 2") else "under a minute" if took.startswith("0 min") else took
                if bad:
                    how = "failed · " + how
                return '<li class="%s" title="%s"><span>%s</span><span>%s</span><span>%s</span></li>' % (
                    "bad" if bad else "", e(name), "✕" if bad else "✓", e(step_label(name)), e(how + (" · try %d" % x["tries"] if x.get("tries", 1) > 1 else "")))
            # NOW: the step, what it is trying, how far, and what decides it
            if now:
                x = steps[now]
                trying = [m for m in moves if m.get("status") == "running"]
                bits = []
                if trying:
                    names = list(dict.fromkeys(m.get("what", "") for m in trying))
                    if all(n.startswith("the larger model") for n in names):
                        bits.append("%d brief%s the larger model wrote for %s, tried one after another" % (len(trying), "" if len(trying) == 1 else "s", e(trying[0].get("slot") or "the slot")))
                    else:
                        bits.append("Trying: " + "; ".join(e(n) for n in names[:2]) + (" and %d more" % (len(names) - 2) if len(names) > 2 else ""))
                try:
                    lv = json.loads((Path(ARGS.root) / ".work" / "train" / "live.json").read_text())
                except (OSError, ValueError):
                    lv = {}
                if st.get("running") and lv.get("n") and time.time() * 1000 - lv.get("at", 0) < 120000:
                    bits.append("%s question %s of %s" % (e(lv.get("split", "")), e(str(lv["n"])), e(str(lv.get("of", "?")))))
                keep = ""
                if now.startswith(("10-improve", "15-arrange")):
                    m_ = ((dd or {}).get("policy") or {}).get("keep", {}).get("margin", 2)
                    keep = "Kept only if it wins %s more answers than it loses on the train questions, does no worse on the held ones, and wins again with another draw." % e(str(m_))
                live = bool(st.get("running"))
                out.append('<details class="sec" data-keep="run-now"><summary><h5>%s<span>step %d of %d%s</span></h5><p class="smeta">%s</p></summary><div class="secb"><p class="nowline" title="%s"><b>%s</b></p>%s%s</div></details>' % (
                    "Now" if live else "Stopped in", len(finished) + 1, total,
                    ((" · " + e(_span(_since_clock(x["at"])))) if live else "") + (" · try %d" % x["tries"] if x.get("tries", 1) > 1 else ""),
                    e(step_label(now) + ("" if not bits else " · " + re.sub(r"<[^>]+>", "", bits[-1]))), e(now), e(step_label(now)),
                    '<p class="small" style="margin:0">%s</p>' % " · ".join(bits) if bits else "", '<p class="muted small" style="margin:0">%s</p>' % keep if keep else ""))
            # THIS PASS: what is done (folded), then what comes next, in order
            nth = int(cur.name[5:]) - int(st.get("first", cur.name[5:])) + 1 if cur.name[5:].isdigit() else 1
            nxt = [n for n in ahead if n != now]
            done_html = ('<details class="done" data-keep="run-done"><summary>%d done</summary><ul class="steps">%s</ul></details>' % (len(finished), "".join(row(n) for n in finished))) if finished else ""
            next_html = ('<p class="label">Next</p><ul class="steps next">%s</ul>' % "".join(
                '<li title="%s"><span>·</span><span>%s%s</span><span></span></li>' % (e(n), e(step_label(n)), '<small style="display:block;color:var(--mist);font-weight:600">carries on where the stop left it</small>' if n in steps and steps[n]["state"] == "stopped" else "")
                for n in nxt)) if nxt else ""
            out.append('<details class="sec" data-keep="run-pass"><summary><h5>Pass %s<span>%d of %d steps done%s</span></h5><p class="smeta">%s</p></summary><div class="secb">%s%s%s</div></details>' % (
                e(cur.name[5:]), len(finished), total, (" · number %d of this session" % nth) if nth > 1 else "",
                e(("next: %s%s" % (step_label(nxt[0]), (", then %d more" % (len(nxt) - 1)) if len(nxt) > 1 else "")) if nxt else "the last step of the pass"), done_html, next_html,
                "" if (finished or now or nxt) else "<ul class='steps'><li><span></span><span class='muted'>starting</span><span></span></li></ul>"))
            # HEADING: how far toward parity, what this pass is for, and what the next pass asks
            if dd:
                hp = dd["splits"]["held"]["parity"]
                head = []
                if hp:
                    head.append("<b>%s%%</b> of the way to parity: %d of %d held answers equivalent." % (fmt_pct(hp["percent"]), hp["equivalent"], hp["compared"]))
                g = (plan or {}).get("gap")
                if g:
                    head.append("On this pass's train questions choosing better could reach %s%%; the %d answers no slot drafted need better drafts, which is what new briefs and worked examples are for." % (fmt_pct(g["reachableByChoosing"]), g["drafting"]))
                q = dd.get("equivalence") or {}
                want = [k for t in q.get("targets", []) if t["id"] in q.get("chosen", []) for k in t.get("kinds", [])]
                head.append("This pass ends by asking the held questions again and writing its verdict. The next one asks new train questions, %d kinds (%s)." % (
                    len(set(want)), e(", ".join(t["name"] for t in q.get("targets", []) if t["id"] in q.get("chosen", [])) or "as chosen")))
                hl = []
                if hp:
                    hl.append("%s%% toward parity" % fmt_pct(hp["percent"]))
                if g:
                    hl.append("choosing alone could reach %s%%" % fmt_pct(g["reachableByChoosing"]))
                hl.append("next pass: %d kinds" % len(set(want)))
                out.append('<details class="sec" data-keep="run-heading"><summary><h5>Heading</h5><p class="smeta">%s</p></summary><div class="secb">%s</div></details>' % (e(" · ".join(hl)), "".join('<p class="small" style="margin:0">%s</p>' % h for h in head)))
    # THE WAYS BACK THIS SESSION HAS TAKEN: a pass that needed twelve restarts is not the same evidence as one that needed none
    if st:
        began = _epoch_local(st.get("at", ""))
        took = [r for r in data._rows(Path(ARGS.root) / ".work" / "train" / "recovery.jsonl") if _epoch(r.get("at")) >= began - 2]
        if took:
            rows = "".join('<li><span>↺</span><span>%s<small style="display:block;color:var(--mist);font-weight:600">%s</small></span><span></span></li>' % (e(str(r.get("what", ""))), e(str(r.get("did", "")))) for r in took[-5:])
            out.append('<details class="sec" data-keep="run-recovered"><summary><h5>Recovered<span>%d time%s this session</span></h5><p class="smeta">%s</p></summary><div class="secb"><ul class="steps">%s</ul></div></details>' % (
                len(took), "" if len(took) == 1 else "s", e("the last: %s, %s" % (took[-1].get("what", ""), took[-1].get("did", ""))), rows))
        # what this session has taught the swarm so far: each change as it is kept (the output spec holds them all)
        try:
            led = [x for x in data.load(ARGS.root)["learned"]["ledger"] if _epoch(x.get("at")) >= began - 2]
        except Exception:  # the panel is drawn even where the folder cannot be read
            led = []
        out.append('<details class="sec" data-keep="run-learned"><summary><h5>Learned this session<span>%s</span></h5><p class="smeta">%s</p></summary><div class="secb">%s' % ("%d kept" % len(led) if led else "",
                                                                                                   e(("the newest: " + _what(led[-1])) if led else "nothing kept yet"), "" if led else '<p class="muted small">Nothing kept yet. Each change is listed here as it is kept.</p></div></details>'))
        if led:
            out.append('<ul class="steps">%s</ul></div></details>' % "".join(
                '<li><span>✓</span><span><b>%s</b><small style="display:block" class="muted">%s%s · train %s → %s equivalent</small></span></li>'
                % (e(_what(x)), e(_kind(x)), (" · " + e(x["slot"])) if x.get("slot") else "",
                   e(str(((x.get("train") or {}).get("before") or {}).get("right", "?"))), e(str(((x.get("train") or {}).get("after") or {}).get("right", "?")))) for x in led[::-1]))
    out.append("</div>")
    return "".join(out)


STEP_WORDS = [("reader", "Check the reader of answers in words"), ("swarm-reworded", "The swarm: the held questions, a second way"), ("begin", "Begin the pass"), ("research", "Read what is new on arXiv"), ("target-train", "Larger model: the train questions"), ("target-self", "Larger model against itself"), ("target", "Larger model: the held questions"),
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
    allh = [h for h in st.get("history", []) if h.get("compared")]
    if allh:
        pc = [data.percent(h["equivalent"], h["compared"]) for h in allh]
        pmeta = "%d pass%s · the latest %s%% · the best %s%% · from %s%%" % (len(allh), "" if len(allh) == 1 else "es", fmt_pct(pc[-1]), fmt_pct(max(pc)), fmt_pct(pc[0]))
    else:
        pmeta = "No pass has ended yet"
    return (
        '<aside class="rail"><div id="training"><h2>Training</h2><div id="run">%s</div></div>'
        '<div><h2>Passes</h2><div class="panel"><details class="fold" data-keep="rail-passes"><summary><span class="fmeta">%s</span></summary><div class="foldb"><ul class="feed">%s</ul></div></details></div></div>'
        '<div><h2>Ideas waiting to be measured</h2><div class="panel"><ul class="feed">%s</ul></div></div></aside>' % (run_panel(), e(pmeta), passes, waiting)
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
                score = (" · index %s%s" % (m["index"]["score"], " (an older checkpoint)" if "older" in m["index"].get("as", "") else "")) if key in ("decider", "judge") and m.get("index") else ""
                here = key not in ("decider", "judge") or not m.get("runsOn") or any(x in d.get("machine", []) for x in m["runsOn"])
                opts += '<option value="%s"%s%s>%s%s%s%s</option>' % (
                    e(m["id"]), " selected" if mine else "", "" if here or mine else " disabled", e(m["name"]), "" if mine else score, "" if mine else weigh(m),
                    "" if here else " · needs %s" % e(m.get("needs", "another machine")))
            opts += "</optgroup>"
        if group == "judge":
            # the decider itself, where no judge apart from it is chosen (the swarm's own decider then grades the answers it chose)
            opts = '<option value=""%s>The decider itself</option>' % ("" if chosen else " selected") + opts
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
        '<div class="picks" id="picks"><div class="group small n%d" style="flex-basis:%dpx">%s%s%s</div><div class="group against" style="flex-basis:740px">%s%s%s</div></div>'
        # (each group asks for the room its pills need, so the two share a row exactly when both fit)
        % (n_small, 195 * n_small - 10, pill("a", "Small model 1", reg["small"], d["members"]["a"]), pill("b", "Small model 2", reg["small"], d["members"]["b"]), more,
           pill("decider", "Decides", sorted(reg["deciders"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d["decider"]),
           pill("judge", "Judges equivalence", sorted([m for m in reg["deciders"] if m["id"] != (d.get("decider") or {}).get("id")], key=lambda m: -(m.get("index") or {}).get("score", 0)), d.get("judge"), "judge"),
           pill("target", "Larger model", sorted(reg["targets"], key=lambda t: -t.get("params", 0)), d["target"]))
    )


def cfg_meta(d):
    """The configuration in a line: the small models, the decider, the larger model, and what it is equivalent on."""
    mem = " + ".join(m["name"] for m in d["members"].values() if m)
    q = d.get("equivalence") or {}
    on = ", ".join(t["name"] for t in q.get("targets", []) if t["id"] in q.get("chosen", []))
    return "%s · decided by %s%s · against %s%s · tools: %s" % (mem, (d.get("decider") or {}).get("name", "?"), (" · judged by %s" % d["judge"]["name"]) if d.get("judge") else "", (d.get("target") or {}).get("name", "?"), (" · equivalent on " + on) if on else "",
                                                     "the swarm decides" if d.get("tools") == "swarm" else "%s alone" % ((d.get("members") or {}).get(d.get("tools")) or {}).get("name", "one model"))


def evidence_of(d, name):
    """A configuration's own record of what only a person can change (members.json, decider-replay.json), or, where it has none
    yet, the newest one from a configuration with the SAME small models against the SAME larger model: which small models draft
    what, and which choices were recorded among their drafts, does not depend on the decider. Changing the decider makes a new
    configuration with no record of its own; without this, what was measured vanished the moment a recommendation was taken.
    -> (record or None, the configuration it was measured on, or "" for this one)"""
    key = d.get("key") or ""
    own = Path(d["root"]) / ".work" / "train" / key / name
    j = data._json(own, None) if key else None
    if isinstance(j, dict):
        return j, ""
    if "--" not in key:
        return None, ""
    ids, tgt = key.rsplit("--", 1)
    smalls = ids.split("+")[:-1]
    found = []
    for f in (Path(d["root"]) / ".work" / "train").glob("*--%s/%s" % (tgt, name)):
        k = f.parent.name
        if k != key and k.rsplit("--", 1)[0].split("+")[:-1] == smalls:
            found.append((f.stat().st_mtime, k, f))
    for _, k, f in sorted(found, reverse=True):
        j = data._json(f, None)
        if isinstance(j, dict):
            return j, k
    return None, ""


def recommendations(d):
    """CHANGES TO THE CONFIGURATION THAT THE EVIDENCE POINTS AT: what only a person can change (a pass cannot change which models
    the swarm is made of), from what this configuration's passes measured for it (members-probe.mjs, decider-replay.mjs). Each says
    how strong its evidence is: measured (a measurement points at it) or untested (nothing here could measure it yet).
    -> [{ id, title, why, strength, apply: {config patch}, note }]"""
    wd = work_of(d["root"], d.get("key"))
    reg = d.get("registry") or {}
    out = []
    rep, rep_from = evidence_of(d, "decider-replay.json")
    cur_dec = (d.get("decider") or {}).get("id")
    dec_name = lambda k: next((m["name"] for m in reg.get("deciders", []) if m["id"] == k.rsplit("--", 1)[0].split("+")[-1]), k)  # noqa: E731
    elsewhere = lambda k: (" Measured on the same small models decided by %s; this configuration has no record of its own yet." % e(dec_name(k))) if k else ""  # noqa: E731
    rec_dec = dec_name(rep_from) if rep_from else (d.get("decider") or {}).get("name", "the decider")
    for r in (rep or {}).get("results") or []:
        dec = next((x for x in reg.get("deciders", []) if x["id"] == r.get("decider")), None)
        if not dec or dec["id"] == cur_dec or r.get("recovered", 0) <= r.get("lost", 0):
            continue
        edge = r["recovered"] - r["lost"]
        out.append({"id": "decider:" + dec["id"], "strength": "measured", "apply": {"decider": dec["id"]}, "n": r.get("asked", 0),
                    "title": "Decide with %s" % dec["name"],
                    "why": "Put the %d choices recorded in pass %s, it chose the larger model&#39;s answer %d times against %s&#39;s %d: it recovered %d that %s missed and lost %d it had. %s"
                           % (r.get("asked", 0), e(str(rep.get("pass", "?"))), r.get("theirsRight", 0), e(rec_dec), r.get("kevRight", 0),
                              r["recovered"], e(rec_dec), r["lost"],
                              "A small edge: a real pass is what would tell." if edge < 3 else "A clear edge on the recorded choices.") + elsewhere(rep_from),
                    "note": " · ".join(x for x in [dec.get("license", ""), "its weights are here" if (Path(d["root"]) / ".work" / "deciders" / dec["id"] / "model" / ".complete").exists() or (dec.get("serve") or {}).get("kind") == "kev" else "Run training fetches it"] if x)})
    # EACH SMALL MODEL ALONE against this larger model (training/results/<model>-alone-vs-<target>-held.json, written by whichever
    # configuration measured it): one that answers as the larger model more often than a member of this swarm is evidence for a swap
    tid = (d.get("target") or {}).get("id", "")
    alone = {}
    for f in (Path(d["root"]) / "training" / "results").glob("*-alone-vs-%s-held.json" % tid):
        j = data._json(f, {}) or {}
        mid = f.name[: -len("-alone-vs-%s-held.json" % tid)]
        if j.get("compared"):
            alone[mid] = (100.0 * j.get("right", 0) / j["compared"], j.get("right", 0), j["compared"])
    members = d.get("members", {})
    mine = {k: m["id"] for k, m in members.items() if m}
    scored = [(alone[i][0], k, i) for k, i in mine.items() if i in alone]
    if scored:
        worst = min(scored)
        names = {m["id"]: m["name"] for m in reg.get("small", [])}
        for mid, (pc, r_, n_) in sorted(alone.items(), key=lambda kv: -kv[1][0]):
            if mid in mine.values() or mid not in names or pc < worst[0] + 5:
                continue
            out.append({"id": "swap:%s:%s" % (worst[1], mid), "strength": "measured", "apply": {worst[1]: mid}, "n": n_,
                        "title": "Use %s in place of %s" % (names[mid], names.get(worst[2], worst[2])),
                        "why": "Alone, against %s, it answered %s%% of the held questions as the larger model did (%d of %d), where %s answered %s%%. Measured by another configuration on the same larger model."
                               % (e((d.get("target") or {}).get("name", "")), fmt_pct(int(pc * 10) / 10), r_, n_, e(names.get(worst[2], worst[2])), fmt_pct(int(worst[0] * 10) / 10)),
                        "note": "alone is not in a swarm: a real pass is what would tell"})
            break
    # ANOTHER CONFIGURATION FURTHER ALONG against the same larger model (training/states/*--<target>.json)
    cur_key = d.get("key")
    cur_pct = (d["splits"]["held"]["parity"] or {}).get("percent")
    for f in sorted((Path(d["root"]) / "training" / "states").glob("*--%s.json" % tid)):
        key = f.name[:-5]
        if key == cur_key:
            continue
        j = data._json(f, {}) or {}
        hist = [h for h in j.get("history") or [] if h.get("compared")]
        if not hist:
            continue
        pc = data.percent(hist[-1]["equivalent"], hist[-1]["compared"])
        # (only against a configuration that HAS been measured: one not yet measured is not behind, it is untried, and recommending
        # the way back from it undid every change the moment it was made)
        if cur_pct is None or pc <= cur_pct:
            continue
        ids = key.split("--")[0].split("+")
        small = [i for i in ids if any(m["id"] == i for m in reg.get("small", []))]
        decs = [i for i in ids if any(m["id"] == i for m in reg.get("deciders", []))]
        if len(small) < 2 or not decs:
            continue
        patch = {p: small[i] if i < len(small) else "" for i, p in enumerate(("a", "b", "c", "d"))}
        patch["decider"] = decs[0]
        out.append({"id": "config:" + key, "strength": "measured", "apply": patch, "n": hist[-1]["compared"],
                    "title": "Switch to %s" % " + ".join(next((m["name"] for m in reg["small"] if m["id"] == i), i) for i in small),
                    "why": "That configuration is %s%% of the way to parity with this larger model after %d pass%s, against this one&#39;s %s%%. Both keep their own records: switching back carries on where this one was."
                           % (fmt_pct(pc), len(hist), "" if len(hist) == 1 else "es", fmt_pct(cur_pct) if cur_pct is not None else "not yet measured"),
                    "note": "decided by " + next((m["name"] for m in reg["deciders"] if m["id"] == decs[0]), decs[0])})
    mem, mem_from = evidence_of(d, "members.json")
    if mem and mem.get("gap"):
        places = [k for k in ("a", "b", "c", "d") if k in d.get("members", {})]
        nxt = next((k for k in ("c", "d") if k not in places), None)
        best = next((x for x in mem.get("models") or [] if x.get("drafts")), None)
        if nxt and best:
            out.append({"id": "member:" + best["id"], "strength": "measured", "apply": {nxt: best["id"]}, "n": best.get("asked", mem["gap"]),
                        "title": "Add %s as a small model" % best["name"],
                        "why": "On the %d train questions of pass %s that no slot drafted as the larger model did, it answered %d of %d as the larger model did, alone." % (mem["gap"], e(str(mem.get("pass", "?"))), best["drafts"], best.get("asked", mem["gap"])) + elsewhere(mem_from),
                        "note": "a third model makes mistakes of its own, which more slots on the same models do not"})
        elif nxt and not (mem.get("models") or []) and mem.get("notHere"):
            small = sorted(mem["notHere"], key=lambda x: x.get("bytes") or 1e12)[0]
            out.append({"id": "member:" + small["id"], "strength": "untested", "apply": {nxt: small["id"]}, "n": mem["gap"],
                        "title": "Add a third small model, %s for one" % small["name"],
                        "why": "On %d of %d train questions of pass %s no slot drafted the larger model&#39;s answer, and nothing that checks or decides can find an answer no draft holds. No other small model is on this machine for the probe to ask, so this is untested: adding one fetches it, and the next pass measures it." % (mem["gap"], mem.get("of", 0), e(str(mem.get("pass", "?")))) + elsewhere(mem_from),
                        "note": "%.1f GB to fetch; the smallest of the %d listed" % ((small.get("bytes") or 0) / 2**30, len(mem["notHere"]))})
    # ---- WHAT THIS CONFIGURATION'S OWN ANSWERS SAY, AS THEY ARRIVE (ui/data.py session_evidence): nothing here waits for a pass
    ev = d.get("evidence") or {}
    small_by = {m["id"]: m for m in reg.get("small", [])}
    gb_of = lambda mid: ((small_by.get(mid) or {}).get("bytes") or 0) / 2**30  # noqa: E731
    name_of = lambda mid: (small_by.get(mid) or {}).get("name", mid)  # noqa: E731
    slow_of = lambda place: max([o["ms"] for k, o in (ev.get("slots") or {}).items() if k.startswith(place + "-")] or [0]) / 1000.0  # noqa: E731
    places = [k for k in ("a", "b", "c", "d") if k in mine]
    # (2) A CHANGE YOU MADE, JUDGED ON WHAT FOLLOWED: a model added to the swarm that its own answers say adds nothing. Only a third
    # or fourth model can be taken out; one in the first two places is changed in its pill.
    traced, mstat, pairs = ev.get("traced", 0), ev.get("members") or {}, ev.get("pairs") or {}
    for place in [k for k in ("c", "d") if k in places]:
        st_ = mstat.get(place) or {"inwin": 0, "sole": 0}
        if traced < 5 or st_["sole"] > 0 or st_["inwin"] > 0.25 * traced:
            continue
        mid = mine[place]
        echo = next(((p[0], p[1]) for k, p in pairs.items() if all(x.startswith(place + "-") for x in k.split("+")) and p[1]), None)
        before = [k.name for k in (Path(d["root"]) / ".work" / "train").glob("*--%s" % tid)
                  if k.is_dir() and k.name.split("--")[0].split("+")[:-1] == [mine[x] for x in places if x != place]]
        out.append({"id": "drop:" + place, "strength": "measured", "apply": {place: ""}, "n": traced,
                    "title": "Take %s out of the swarm" % name_of(mid),
                    "why": "Of the %d right answers traced to the drafts that held them, its drafts were among them %d time%s and the only ones none of the time.%s%s"
                           % (traced, st_["inwin"], "" if st_["inwin"] == 1 else "s",
                              (" Its two slots gave the same answer %d times of %d." % echo) if echo else "",
                              " It was added since the configuration without it; this is the measurement since." if before else ""),
                    "cost": "saves %.1f GB, and its slots&#39; time (its slowest about %.1f s an answer)" % (gb_of(mid), slow_of(place)),
                    "note": "the others held every right answer it held"})
    # (3) THE DECIDER'S RELIABILITY, AND WHY IT MISSED: a decision that timed out is the wait's fault (the engine now waits as long
    # as the decider needs); one that failed otherwise is the decider's, compared with the decider of the configuration before
    dv = ev.get("decider") or {}
    if dv.get("n", 0) >= 10 and dv.get("failed", 0) >= 0.1 * dv["n"]:
        dname = (d.get("decider") or {}).get("name", "The decider")
        if dv.get("timedOut", 0) >= dv["failed"] * 0.8:
            out.append({"id": "decider-wait", "strength": "info", "apply": None, "n": dv["n"],
                        "title": "%s missed by its wait, not its choices" % dname,
                        "why": "It did not answer in time %d times of %d, and each time the answer most slots gave stood instead. Every miss was the wait: its decisions take %.1f s at the median, and it was given 8. The wait now grows with how long the decider takes, and a decision that times out is asked again: nothing about the configuration needs to change."
                               % (dv["timedOut"], dv["n"], ((ev.get("slots") or {}).get("kev-decide") or {}).get("ms", 0) / 1000.0),
                        "note": "the next session waits as long as it needs"})
        else:
            prev = None
            for k_, o_ in (ev.get("otherDeciders") or {}).items():
                ids_ = k_.split("+")
                if ids_[:-1] == [mine[x] for x in places] and o_["n"] >= 10 and (o_["failed"] / o_["n"]) < dv["failed"] / dv["n"]:
                    prev = (ids_[-1], o_)
            alt = prev[0] if prev else "kev-4b"
            if alt != cur_dec:
                altname = next((m["name"] for m in reg.get("deciders", []) if m["id"] == alt), alt)
                out.append({"id": "decider-back:" + alt, "strength": "measured", "apply": {"decider": alt}, "n": dv["n"],
                            "title": "Decide with %s again" % altname,
                            "why": "%s gave no decision %d times of %d (not for want of time), and the answer most slots gave stood instead.%s"
                                   % (dname, dv["failed"], dv["n"], (" %s failed %d times of %d on the same small models." % (altname, prev[1]["failed"], prev[1]["n"])) if prev else ""),
                            "note": "a decider that does not answer cannot be trained on"})
    # (4) CUT OFF AT ITS TOKEN LIMIT: for training, which measures more room itself (arrange.mjs: a token limit raised by half)
    capped = [(k, o) for k, o in (ev.get("slots") or {}).items() if o["n"] >= 10 and o["capped"] >= 0.4 * o["n"]]
    if capped:
        lim = {s_["id"]: s_.get("maxTokens") for s_ in d["briefs"].get("slots", [])}
        out.append({"id": "capped", "strength": "info", "apply": None, "n": max(o["n"] for _, o in capped),
                    "title": "Answers cut off at the token limit",
                    "why": "%s. An answer cut off is lost however good it was going to be. The plan now finds this and measures each with more room (a token limit raised by half), keeping it only if it wins."
                           % "; ".join("%s stopped at its limit of %s on %d of %d" % (k, lim.get(k, "?"), o["capped"], o["n"]) for k, o in sorted(capped, key=lambda x: -x[1]["capped"] / x[1]["n"])[:4]),
                    "note": "training does this itself"})
    # A JUDGE APART FROM THE DECIDER: while the swarm's own decider reads whether its answers are equivalent, it grades the answers
    # it chose. The one recommended runs on this machine and is no heavier than the decider (or about 6 GB), the best of those on
    # the Decision Index: it is served beside the decider for the whole of training
    if not d.get("judge") and cur_dec and ev.get("answers", 0) > 0:
        here_ok = lambda m: not m.get("runsOn") or any(x in d.get("machine", []) for x in m["runsOn"])  # noqa: E731
        cap = max(6.0, float((d.get("decider") or {}).get("memGb") or 0))
        other = next((m for m in sorted(reg.get("deciders", []), key=lambda m: -(m.get("index") or {}).get("score", 0))
                      if m["id"] != cur_dec and here_ok(m) and float(m.get("memGb") or 99) <= cap), None)
        if other:
            out.append({"id": "judge:" + other["id"], "strength": "untested", "apply": {"judge": other["id"]}, "n": 0,
                        "title": "Judge equivalence with %s, apart from the decider" % other["name"],
                        "why": "Whether the swarm&#39;s answers in words say what the larger model&#39;s say is read by %s, the decider that chose them. A judge apart from it cannot favour the answers its own choices made. The reader is checked before each pass all the same (paraphrases and near-misses)." % e((d.get("decider") or {}).get("name", "the decider")),
                        "cost": "about %s GB more while training (it is not part of the swarm that is served)" % e(str(other.get("memGb") or "?")),
                        "note": " · ".join(x for x in [other.get("license", ""), other.get("needs", "")] if x)})
    # (5) WHAT EACH COSTS, and (6) HOW STRONG: measured on fewer than 20 answers is early
    cur_gb = sum(gb_of(mine[k]) for k in places)
    dmem = lambda i: float(next((m.get("memGb") or 0 for m in reg.get("deciders", []) if m["id"] == i), 0) or 0)  # noqa: E731
    for r_ in out:
        a_ = r_.get("apply") or {}
        if "cost" not in r_ and a_:
            new = {k: mine.get(k) for k in places}
            new.update({k: v for k, v in a_.items() if k in ("a", "b", "c", "d")})
            dgb = sum(gb_of(v) for v in new.values() if v) - cur_gb
            if "decider" in a_:
                dgb += dmem(a_["decider"]) - dmem(cur_dec)
            r_["cost"] = ("about %.1f GB more" % dgb) if dgb > 0.05 else ("about %.1f GB less" % -dgb) if dgb < -0.05 else "about the same memory"
        if r_["strength"] == "measured" and r_.get("n", 99) < 20:
            r_["strength"] = "early"
    return out


def recs_panel(d):
    """The recommended changes to the configuration, each with its evidence and a button to make it."""
    rs = recommendations(d)
    running = bool((run_state() or {}).get("running"))
    label = lambda r: {"measured": "Measured", "untested": "Untested", "info": "For training"}.get(r["strength"]) or "Early: %d answers" % r.get("n", 0)  # noqa: E731
    rests = lambda r: ("rests on %d answer%s" % (r["n"], "" if r["n"] == 1 else "s")) if r.get("n") else ""  # noqa: E731
    def item(r):
        meta = " · ".join(x for x in [rests(r), r.get("cost", ""), e(r.get("note", ""))] if x)
        act = ('<button type="button" class="btn top" data-rec-apply=\'%s\'%s>Make this change</button>' % (e(json.dumps(r["apply"])), " disabled" if running else "")) if r.get("apply") else ""
        return '<li class="rec %s"><div><span class="rstr">%s</span><b>%s</b><p>%s</p><small>%s</small></div>%s</li>' % (r["strength"], e(label(r)), e(r["title"]), r["why"], meta, act)
    mine_ = [r for r in rs if r.get("apply")]
    theirs = [r for r in rs if not r.get("apply")]
    items = "".join(item(r) for r in mine_) or '<li class="muted">No change to the configuration is recommended now.</li>'
    if theirs:
        items += '<li class="rech">What training does about it itself</li>' + "".join(item(r) for r in theirs)
    return ('<div class="spec-head"><div><div class="kicker">What only you can change</div><h3 style="font-size:22px;margin-top:4px">Recommended configuration changes</h3></div>'
            '<button class="btn stop top" id="rec-close" type="button">Close</button></div>'
            '<p class="muted small" style="margin:8px 0 12px">A pass cannot change which models the swarm is made of: these are for you. Each says what it rests on. A change starts this configuration&#39;s own record, as choosing models in the pills does.%s</p>'
            '<ul class="recs">%s</ul>' % (" A session is running: stop it before changing the configuration." if running else "", items))


def config_section(d):
    """The pills and Equivalent on, in one section that folds (open to begin with); folded, it says in a line what it is. Beside its
    heading, a note when the evidence recommends a change to it."""
    n = len([r for r in recommendations(d) if r.get("apply")])
    badge = ('<button type="button" class="recbadge" id="rec-open" title="Open the recommended configuration changes"><i></i>%d recommendation%s</button>' % (n, "" if n == 1 else "s")) if n else ""
    return ('<details class="cfg fold" data-keep="cfg" open><summary><span class="cfgh">Configuration</span><span id="rec-slot">%s</span><span class="fmeta" id="cfg-meta">%s</span></summary>'
            '<div class="foldb">%s%s%s</div></details>' % (badge, e(cfg_meta(d)), pills(d), equiv(d), tools_toggle(d)))


def tools_toggle(d, inner=False):
    """TURNS WITH TOOLS: who takes a turn in an agent's work (a request that carries tools): the swarm, every drafter proposing the
    next step and the decider picking where they differ (src/tools.mjs), or the model in place a alone, as it came. It is part
    of how the swarm is served, saved in src/config.json; a session that is running keeps what it began with."""
    cur = d.get("tools") or "a"
    on = cur == "swarm"
    mem = [(k, m) for k, m in (d.get("members") or {}).items() if m]
    # one choice for the swarm, and one for each small model in it, by its name: the list follows the pills
    seg = lambda val, label, sel: '<button type="button" class="seg%s" data-tools="%s" aria-pressed="%s">%s</button>' % (" on" if sel else "", e(val), "true" if sel else "false", label)  # noqa: E731
    segs = seg("swarm", "Decided by the swarm", on) + "".join(seg(m["id"], "%s alone" % e(m["name"]), cur == k) for k, m in mem)
    who = next((m["name"] for k, m in mem if k == cur), "one small model")
    body = ('<legend>Turns with tools</legend><div class="tgl">%s</div><p class="muted small">%s</p>'
            % (segs, e("An agent's turn (a request that carries tools, as The Crew's Pi sends): every drafter proposes the next step, a call to a tool that was not offered or with arguments that are not an object is left out, and the decider picks where they differ. Measured by the agent-step questions, against the larger model's own step."
                       if on else "An agent's turn (a request that carries tools) goes to %s alone, as it came, and its reply comes straight back: the swarm drafts and decides only replies in words. Choose another small model to take them, or have the swarm decide them." % who)))
    return body if inner else '<fieldset class="equiv tools" id="tools">%s</fieldset>' % body


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
    slots = "".join("<tr><td><code>%s</code></td><td>%s</td><td>%s<details class='told'><summary>What it is told</summary><div>%s</div></details></td><td>%s</td></tr>"
                    % (e(x["id"]), e(x["stage"]), e(x.get("purpose", "")), e(x.get("brief", "")), e(str(x.get("model", "")))) for x in sp["arrangement"]["slots"])
    # THIS PASS, UNDER WAY: the parts below speak of finished passes and the held questions; this says what the pass in hand has done
    ip = sp.get("inProgress")
    under = ""
    if ip:
        ts, mv = ip.get("trainSoFar"), ip["moves"]
        live = bool((run_state() or {}).get("running"))
        st_word = {"kept": "Kept", "not kept": "Not kept"}
        meas = "".join("<li><b>%s</b> <span class='muted'>· %s%s</span>%s</li>" % (e(m.get("what") or ""), e(m.get("kind") or ""), (" · " + e(m["slot"])) if m.get("slot") else "",
                                                                                    " <span class='pill %s'>%s</span>" % ("up" if m["status"] == "kept" else "down", st_word.get(m["status"], m["status"]))) for m in ip["measured"])
        under = ("<h4>This pass, under way</h4><table class='spec'>%s%s%s%s</table>"
                 % (row("Pass", "%d%s%s" % (ip["pass"], " · running now" if live else " · stopped partway", (" · began %s" % e(str(ip["began"])[:16].replace("T", " ")) + " UTC") if ip.get("began") else "")),
                    row("Train questions" + (" so far" if ts and (ts.get("of") or 0) > ts["answered"] else ""), ("<b>%s%%</b> equivalent · %d of %d%s<br><span class='muted'>%s</span>" % (fmt_pct(ts["percent"]), ts["equivalent"], ts["compared"], (" · %d of %d answered" % (ts["answered"], ts["of"])) if ts.get("of") and ts["answered"] < ts["of"] else "", e(ip["trainIs"]))) if ts else "not yet"),
                    row("Moves", "%d being measured · %d planned · %d kept · %d not kept%s" % (mv["beingMeasured"], mv["planned"], mv["kept"], mv["notKept"],
                        ("<br><span class='muted'>now: %s</span>" % e("; ".join("%s (%s)" % (m["what"], m["slot"]) if m.get("slot") else m["what"] for m in ip["now"][:4]))) if ip["now"] else "")),
                    row("Measured so far", "<ul style='margin:0;padding-left:18px'>%s</ul>" % meas) if meas else ""))
    # AS A MODEL CHOOSER LISTS IT (The Crew's "Choose your model" among them): the card, what it needs, what it can do, how it starts
    c, rq, cap, st_ = sp["card"], sp["requirements"], sp["interface"]["capabilities"], sp["interface"]["start"]
    host = ('<h4>As a model chooser lists it</h4><div class="hostcard"><div><b>%s</b><span class="muted small"> · %s · about %s GB · %s</span></div><div class="hcbadge">%s</div><p>%s</p>%s</div>'
            '<p class="muted small" style="margin:6px 0 0">The entry a chooser such as The Crew&#39;s <i>Choose your model</i> takes, with <code>engine: swarm</code>; it is started with <code>%s</code>.</p>'
            "<h4>What it needs</h4><table class='spec'>%s</table><h4>What it can do as a model</h4><table class='spec'>%s</table><h4>To make it</h4><table class='spec'>%s</table>"
            % (e(c["name"]), e(c["size"]), e(str(c["memGb"])), e(c["pace"] if c.get("secondsPerReply") is None else "%s s a reply" % c["secondsPerReply"]), e(c["badge"]), e(c["plain"]),
               ('<div class="hcon">%s</div>' % "".join("<span>%s</span>" % e(x) for x in c["equivalentOn"])) if c["equivalentOn"] else "", e(st_["host"]),
               row("Platforms", e(", ".join(rq["platforms"])) + "<br><span class='muted'>%s</span>" % e(rq["platformsAre"])) + row("Memory", "about %s GB (an estimate)" % e(str(rq["memoryGb"])))
               + row("Disk", "%s GB of model files" % e(str(rq["diskGb"]))) + row("Engine", e(rq["engine"])) + row("Node", e(rq["node"])) + (row("The decider", e(rq["decider"])) if rq.get("decider") else "")
               + row("Licences", e("; ".join(rq["licenses"]))) + row("Commercial use", ("<b>Allowed by every licence listed</b>" if rq["commercialUse"] else "<b class='bad'>Not allowed</b>: a licence says non-commercial") + "<br><span class='muted'>Read every licence above before offering it</span>"),
               row("Chat", "yes") + row("Streaming", e(cap["stream"])) + row("Tools", e(cap["tools"])) + row("Images", "no") + row("Context", "%s tokens a request" % e(str(cap["contextTokens"]))) + row("Good for", e(sp["interface"]["goodFor"])),
               row("Recipe", "<code>%s</code><br><span class='muted'>%s</span>" % (e(sp["spec"]["recipeSha256"][:16]), e(sp["spec"]["recipeIs"]))) + row("Format", "<code>%s</code> version %s" % (e(sp["spec"]["format"]), e(str(sp["spec"]["version"]))))
               + "".join(row(k.capitalize(), "<code>%s</code>" % e(v)) for k, v in st_.items())))
    return (
        '<div class="spec-head"><div><div class="kicker">Output spec</div><h3 style="font-size:24px">%s</h3><div class="muted small">%s</div></div>'
        '<div style="display:flex;gap:8px"><button class="btn top" id="spec-copy" type="button">Copy as JSON</button><button class="btn top" id="spec-save" type="button">Save as a file</button><button class="btn stop top" id="spec-close" type="button">Close</button></div></div>'
        '<p class="verdict %s" style="margin:14px 0 2px">%s against %s.</p><p class="muted small" style="margin:0 0 12px">%s</p>'
        "%s%s<h4>What it is</h4><table class='spec'>%s%s%s%s%s%s%s%s</table>"
        "<h4>The flow</h4><p class='small' style='margin:0'>%s <span class='muted'>(%s)</span></p>"
        "<h4>The arrangement (briefs v%s)</h4><table class='spec'><tr><th>Slot</th><th>Stage</th><th>What it is for</th><th>Model</th></tr>%s"
        "<tr><td><code>kev-decide</code></td><td>decide</td><td>Decides which answer stands</td><td>%s</td></tr></table>"
        '<h4>As JSON</h4><pre class="tail" id="spec-json" style="max-height:320px">%s</pre>'
        % (
            e(sp["id"]), e(sp["what"]),
            state_cls, e(("%s%% of the way to parity" % fmt_pct(t["progressPercent"])) if t.get("progressPercent") is not None and t["state"] != "at parity"
                         else ("In training: pass %d under way" % ip["pass"]) if t["state"] == "not measured" and ip else t["state"].capitalize()), e(t["target"].get("name") or ""),
            e(t["parityMeans"]),
            under + learned_block(d), host,
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
    """Input against output, once the swarm has answered anything (and '' until then): a part of the whole measurement."""
    first = next((k for k in ("held", "train") if d["splits"][k]["swarm"]), "")
    return ('<div class="panel iop"><h3 id="input">Input against output</h3><div class="muted small" style="margin-bottom:12px">Any question asked: the input, what every slot wrote and settled on, the swarm&#39;s output, and the larger model&#39;s beside it</div>'
            '<div class="io" id="io">%s</div></div>' % qlist(d, first)) if first else ""


def memory_chart(d, compact=False):
    """THE POINT OF THE SWARM, AS A PICTURE: the larger model's memory as one bar, and the swarm's beside it on the same scale, made of
    its parts (each small model, the room for their contexts, the decider), with the share. Estimates from what is on record, and said
    to be. compact: the parity card's version (a short heading; the whole explanation is in the whole measurement)."""
    fp = d.get("footprint")
    if not fp:
        return ""
    scale = max(fp["target"], fp["swarm"])
    ab = lambda n: ("%.1f" % n).rstrip("0").rstrip(".")  # noqa: E731
    colour = {"a": "var(--lfm)", "b": "var(--bon)", "c": "#7a5cc4", "d": "#2f7fb8"}
    col = lambda x: colour.get(x.get("place"), "var(--kev)" if x["kind"] == "decider" else "#a9c9c1")  # noqa: E731
    seg = "".join('<i style="width:%.2f%%;background:%s" title="%s: about %s GB"></i>' % (100.0 * x["gb"] / scale, col(x), e(x["name"]), ab(x["gb"])) for x in fp["parts"])
    legend = "".join('<span><i style="background:%s"></i>%s <b>%s GB</b></span>' % (col(x), e(x["name"]), ab(x["gb"])) for x in fp["parts"])
    ticks = "".join('<span style="left:%.2f%%">%s</span>' % (100.0 * t / scale, ab(t)) for t in range(0, int(scale) + 1, 5 if scale > 12 else 2))
    head = ('<span class="memh"><span><b>Memory saved: the swarm against the larger model</b><small>%s</small></span>'
            '<span class="memnum"><b>%s%%</b><span>memory saved · %s GB less · %s× smaller</span></span></span>'
            % ("Estimated from the model files and the listed sizes, not measured" if compact else
               "What the Swarm is for: the larger model&#39;s answers in a fraction of its memory. Estimated from what is on record (the small models&#39; files with their contexts, the decider&#39;s and the larger model&#39;s listed sizes), not measured",
               fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0", ab(max(0.0, fp["savedGb"])), ab(fp["times"] or 0)))
    return ('<span class="memc%s" title="Estimates from what is on record: the small models\' files with their contexts, the decider\'s listed size, and the larger model\'s listed size. Not measured.">%s'
            '<span class="memrows"><span class="memrow"><span class="ml">%s</span><span class="mbar"><i style="width:%.2f%%;background:var(--tgt)"></i></span><span class="mv"><b>%s GB</b></span></span>'
            '<span class="memrow"><span class="ml">The swarm</span><span class="mbar stack">%s</span><span class="mv"><b>%s GB</b></span></span>'
            '<span class="memrow axis"><span></span><span class="ticks">%s</span><span class="mv">GB</span></span></span>'
            '<span class="memleg">%s</span></span>'
            % (" compact" if compact else "", head, e(fp.get("targetName") or "The larger model"), 100.0 * fp["target"] / scale, ab(fp["target"]), seg, ab(fp["swarm"]), ticks, legend))


def memory_panel(d):
    """The memory picture as a part of the whole measurement."""
    c = memory_chart(d)
    return ('<div class="panel memp">%s</div>' % c) if c else ""


def main_body(d):
    """Everything that depends on which models are chosen: drawn again, in place, when one is changed."""
    return (
        '<h2>Parity with the larger model</h2><div id="score">%s</div>'
        '<h2 id="arrangement">The arrangement being trained</h2>%s'
        % (score_strip(d), arrangement(d))
    )


def chips(d):
    """Beside the title: which pass it is, how far toward parity, and the way in to the output spec (with how many things it has
    learned). Read again while a pass runs."""
    out = []
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


def mtile(d):
    """ON A PHONE, THE TRAINING COLUMN IS A TILE beside the title (the column itself sits below everything else at that width): what
    the session is doing now, in two lines, and a tap to open the column whole (Training, Passes, Ideas waiting to be measured)."""
    st = run_state()
    hist = [h for h in (d.get("state") or {}).get("history") or [] if h.get("compared")]
    if st and st.get("running"):
        began = _epoch_local(st["at"])
        head = '<span class="mt-state on" data-since="%d" data-short="1"><i></i><b>%s</b><small>since %s</small></span>' % (
            int(began * 1000), e(_span(time.time() - began)), e(time.strftime("%H:%M", time.localtime(began))))
    elif st and st.get("stopped"):
        head = '<span class="mt-state"><i></i><b>Stopped</b><small>at %s</small></span>' % e(st["stopped"][:5])
    else:
        head = '<span class="mt-state"><i></i><b>Idle</b><small>no models loaded</small></span>'
    sub = ("%d pass%s · latest %s%%" % (len(hist), "" if len(hist) == 1 else "es", fmt_pct(hist[-1].get("percent") or data.percent(hist[-1]["equivalent"], hist[-1]["compared"])))) if hist else "not measured yet"
    # (while a session runs, the second line is where it is: the page writes it from the training column's own Pass and Now)
    return ('<span class="mt-k">Training</span>%s<span class="mt-sub"%s>%s</span><span class="mt-go" aria-hidden="true"></span>' % (head, ' data-where="1"' if st and st.get("running") else "", e(sub)))


def page(d):
    banner = '<div class="banner">Sample data, made up to show the layout. It is not a measurement of anything.</div>' if d["sample"] else ""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>The Swarm</title><style>%s</style></head><body><div class="shell">'
        '<main id="top"><header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div>'
        '<button type="button" class="mtile" id="mtile" aria-label="Open training, passes and ideas waiting to be measured">%s</button>'
        '<div class="chips" id="chips">%s</div></header>%s%s'
        '<div id="body">%s</div>'
        '%s</main>%s</div><dialog id="mtrain" class="sheet"><div class="spec-head"><div><div class="kicker">The Swarm</div><h3 style="font-size:22px;margin-top:4px">Training</h3></div><button class="btn stop top" id="mtrain-close" type="button">Close</button></div><div id="mtrain-body"></div></dialog><dialog id="spec"><div id="spec-body"></div></dialog><dialog id="qedit"><div id="qedit-body"></div></dialog><dialog id="tidy"><div id="tidy-body"></div></dialog><dialog id="steerd"><div id="steerd-body"></div></dialog><dialog id="recd"><div id="recd-body"></div></dialog>'
        '<dialog id="big"><div class="spec-head"><div><div class="kicker">Parity with the larger model</div><h3 style="font-size:22px;margin-top:4px">The whole measurement</h3></div>'
        '<button class="btn stop top" id="big-close" type="button">Close</button></div><div id="big-body"></div></dialog><script>%s</script></body></html>'
        % (CSS, mtile(d), chips(d), config_section(d), banner, main_body(d), footer(), rail(d), JS)
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
        if u.path == "/fragment/recs":
            return self._send(recs_panel(d))
        if u.path == "/fragment/recslot":
            n = len([r for r in recommendations(d) if r.get("apply")])
            return self._send(('<button type="button" class="recbadge" id="rec-open" title="Open the recommended configuration changes"><i></i>%d recommendation%s</button>' % (n, "" if n == 1 else "s")) if n else "")
        if u.path == "/fragment/cfgmeta":
            return self._send(e(cfg_meta(d)))
        if u.path == "/fragment/mtile":
            return self._send(mtile(d))
        if u.path == "/fragment/equiv":
            return self._send(equiv(d, inner=True))
        if u.path == "/fragment/tools":
            return self._send(tools_toggle(d, inner=True))
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
        if u.path == "/fragment/steer":
            return self._send(steer_dialog(d))
        if u.path == "/fragment/plan":
            return self._send(plan_panel(d))
        if u.path == "/fragment/list":
            return self._send(qlist(d, split))
        if u.path == "/fragment/question":
            return self._send(question(d, split, q.get("id", "")))
        return self._send("Not here.", 404, "text/plain; charset=utf-8")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/run/start", "/run/stop", "/config", "/questions", "/uninstall", "/steer"):
            return self._send("Not here.", 404, "text/plain; charset=utf-8")
        # only this page may start or stop a pass: another website can send a plain form to this address, but it cannot
        # send this header, and a request that names another origin is refused
        origin = self.headers.get("origin", "")
        if self.headers.get("x-swarm") != "1" or (origin and urlparse(origin).netloc != self.headers.get("host", "")):
            return self._send("Not from this page.", 403, "text/plain; charset=utf-8")
        if path == "/steer":
            # what a person asks the plan to do: written to this configuration's steering record, which the trainers read when a
            # plan is written and when a step that measures moves begins. Allowed while a session runs
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 4000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            d = data.load(ARGS.root)
            sv = read_steer(d)
            op = asked.get("op") if isinstance(asked, dict) else None
            if op == "focus":
                area, v = asked.get("area"), asked.get("value", "")
                if area not in [a for a, _, _ in STEER_AREAS] or v not in ("", "more", "less", "only"):
                    return self._send("Not understood.", 400, "text/plain; charset=utf-8")
                if v:
                    sv["focus"][area] = v
                else:
                    sv["focus"].pop(area, None)
            elif op in ("pin", "unpin", "skip", "unskip"):
                mid = str(asked.get("id", ""))
                if not STEER_ID.match(mid):
                    return self._send("Not understood.", 400, "text/plain; charset=utf-8")
                key = "pin" if op in ("pin", "unpin") else "skip"
                other = "skip" if key == "pin" else "pin"
                sv[key] = [x for x in sv[key] if x != mid]
                if op in ("pin", "skip"):
                    sv[key].append(mid)
                    sv[other] = [x for x in sv[other] if x != mid]  # a move is either queued or skipped, not both
                sv[key] = sv[key][-60:]
            else:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            wd = work_of(ARGS.root, d.get("key"))
            if wd.name == "train" and d.get("key"):
                wd = wd / d["key"]
            wd.mkdir(parents=True, exist_ok=True)
            tmp = wd / "steer.json.tmp"
            tmp.write_text(json.dumps({**sv, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2) + "\n")
            tmp.replace(wd / "steer.json")
            return self._send(plan_panel(data.load(ARGS.root)))
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
            if (run_state() or {}).get("running") and set(asked) - {"equivalence", "tools"}:
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
            if "tools" in asked:
                # "swarm", or one of the small models in the swarm by its id (written down by its id, so it stays that model)
                mine_ids = [now.get(k) for k in ("a", "b", "c", "d") if now.get(k)]
                want = asked["tools"]
                if want == "lead":
                    want = now.get("a")
                if want != "swarm" and want not in mine_ids:
                    return self._send("Turns with tools are decided by the swarm or given to one of its small models.", 400, "text/plain; charset=utf-8")
                now["tools"] = want
            for key, lst in (("a", "small"), ("b", "small"), ("c", "small"), ("d", "small"), ("decider", "deciders"), ("judge", "deciders"), ("target", "targets")):
                if key in asked:
                    if key in ("c", "d", "judge") and asked[key] in ("", None):
                        now.pop(key, None)  # taken out of the swarm (or, the judge: the decider reads equivalence itself)
                        continue
                    if not any(m.get("id") == asked[key] for m in reg.get(lst, [])):
                        return self._send("There is no %s called that." % key, 400, "text/plain; charset=utf-8")
                    now[key] = asked[key]
            if now.get("judge") and now.get("judge") == now.get("decider"):
                now.pop("judge", None)  # (a judge that is the decider is the decider itself)
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
