#!/usr/bin/env python3
"""swarm_ui.py - THE SWARM, SEEN. One page, served from this machine, that shows what is being trained and how it stands:

    Parity            whether the swarm's answers are FUNDAMENTALLY EQUIVALENT to the larger model's, on the same questions.
                      How far toward it is one percentage, said one way everywhere; at parity when every answer is equivalent
    The arrangement   what every pass trains: the drafts, the checks, the decision, the write, and the arrangement of the slots
                      itself. The two small models, every slot of each, what each is told and what is being tried in its
                      place; the larger model alongside
    Input, output     any question that was asked: the input at the top, then on the left what every slot wrote and the
                      swarm's reply, and on the right the larger model's reply to the same input
    Train             a button that starts a training pass (bash training/session.sh) on this machine, shows each step as it
                      starts and ends, and can stop it. One at a time. While it runs, every slot's card says what that
                      model is doing at this moment: working, or what it just answered.

It reads what the trainers wrote (ui/data.py) and measures nothing. Only the Python standard library is used: nothing to install.

    python3 ui/swarm_ui.py                      http://127.0.0.1:8787/
    python3 ui/swarm_ui.py --port 9000 --root /path/to/TheSwarm
"""

import argparse
import hashlib
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


def _build_id():
    """WHICH CODE THIS SERVER RUNS: a hash of the page's own modules as they were when it started. An open page carries the one it was
    drawn with, and says so when the server's has changed (a restart onto new code): its own script cannot pick up the new one."""
    h = hashlib.sha1()
    for f in ("swarm_ui.py", "data.py", "cleanup.py"):
        try:
            h.update((Path(__file__).resolve().parent / f).read_bytes())
        except OSError:
            pass
    return h.hexdigest()[:12]


BUILD = _build_id()

CSS = """
:root{--ink:#eaf7f3;--panel:#ffffff;--soft:#e3efeb;--line:#d9e8e3;--line2:#e3ece9;--fog:#14211f;--mist:#5f7773;
--r:14px;--teal:#0b5d57;--teal2:#1e9e8e;--sun:#f9c440;--coral:#f2644b;--lfm:#0e6b62;--bon:#c98a06;--dec:#d9502f;--tgt:#3f4f86;
--right:#149a72;--wrong:#e5533d;--unsure:#9aa8a5;--shadow:0 10px 30px rgba(11,93,87,.08)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
html,body{margin:0;background:var(--ink);color:var(--fog);font:15px/1.5 ui-rounded,"SF Pro Rounded",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:5px}
.shell{display:block;min-height:100vh}
main{background:#f4fbf9;padding:26px 30px 70px;min-width:0}
.kicker{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--coral)}
h1{font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.035em;margin:4px 0 0}
h2{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2);margin:36px 0 12px}
h3{font-size:17px;font-weight:800;letter-spacing:-.02em;margin:0}.muted{color:var(--mist)}.small{font-size:12.5px}
header{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:flex-end;justify-content:space-between}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--panel);border-radius:var(--r);padding:7px 14px;font-size:12.5px;font-weight:600;color:var(--mist);white-space:nowrap;box-shadow:var(--shadow)}
.chip b{color:var(--fog);font-weight:800}.chip.level{background:#d7f3e9;color:var(--right)}.chip.behind{background:#fdebd0;color:#9a5b00}.chip.level b,.chip.behind b{color:inherit}
/* the choices, in one row where there is room and in even rows where there is not: each pill takes what it needs and the row is
   filled, so none is left ragged; a label is one line; the larger model, whose names are longest, has twice the room */
.picks{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;align-items:stretch}
.recbadge{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:var(--r);padding:4px 11px;background:#fdf0cf;color:#8a5a00;font:inherit;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 0 0 1px #f3dfb8}
.recbadge i{width:7px;height:7px;border-radius:50%;background:#e8a317;box-shadow:0 0 0 3px #f9d98a;animation:p 1.6s infinite}.recbadge:hover{background:#fae6b5}.recbadge:focus-visible{outline:2px solid var(--teal2);outline-offset:2px}
dialog#recd{border:0;border-radius:var(--r);padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#recd::backdrop{background:rgba(11,40,38,.45)}
.recs{list-style:none;margin:0;padding:0;display:grid;gap:10px}.rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 16px;border-radius:var(--r);border:1px solid var(--line2);background:#fafdfc}
.rec b{display:block;font-size:15.5px;margin-top:6px}.rec p{margin:6px 0 4px;font-size:13.5px;line-height:1.5;color:var(--fog)}.rec small{color:var(--mist);font-size:12px}
.rstr{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:var(--r);background:#d7f3e9;color:var(--right)}.rec.untested .rstr{background:var(--soft);color:var(--mist)}.rec.early .rstr{background:#fdf0cf;color:#8a5a00}.rec.info .rstr{background:#e6e9f6;color:var(--tgt)}.rec.info{grid-template-columns:minmax(0,1fr)}
.hostcard{padding:14px 16px;border-radius:var(--r);border:1px solid var(--line2);background:#fafdfc}.hostcard p{margin:6px 0 0;font-size:13.5px;line-height:1.5}.hcbadge{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:var(--r);background:#fdf0cf;color:#8a5a00;font-size:12px;font-weight:700}
.hcon{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.hcon span{padding:2px 10px;border-radius:var(--r);background:var(--soft);font-size:12px;font-weight:700;color:var(--teal)}
details.told{margin-top:4px}details.told summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--teal)}details.told div{margin-top:4px;white-space:pre-wrap;font-size:12.5px;color:var(--fog)}.spec .bad{color:var(--wrong)}
.equiv .tools{margin-top:12px}
.tgl{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:var(--r);background:var(--soft)}.tgl .seg{border:0;background:none;font:inherit;font-size:13px;font-weight:700;color:var(--mist);padding:7px 14px;border-radius:var(--r);cursor:pointer}
.tgl .seg.on{background:#fff;color:var(--teal);box-shadow:0 1px 4px rgba(11,93,87,.15)}.tgl .seg:focus-visible{outline:3px solid var(--teal2)}fieldset.tools{margin-top:12px}
.rech{list-style:none;margin:8px 0 0;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
@media (max-width:560px){.rec{grid-template-columns:minmax(0,1fr)}}
details.cfg{margin-top:18px}details.cfg>summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}details.cfg>summary .cfgh{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2)}
details.cfg>summary .fmeta{flex:1 1 320px;font-size:13px;font-weight:600;color:var(--mist)}
/* a phone: the heading and its chevron on one line, what the configuration is underneath at the full width (a flex row wrapped the
   three into ragged lines, the chevron alone on the last) */
@media (max-width:560px){details.cfg.fold>summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 10px}details.cfg>summary .cfgh{grid-column:1;grid-row:1}
  details.cfg.fold>summary::after{grid-column:2;grid-row:1}details.cfg>summary #rec-slot:empty{display:none}details.cfg>summary #rec-slot,details.cfg>summary .fmeta{grid-column:1/-1}
  details.cfg>summary .fmeta{font-size:12.5px;line-height:1.45}}details.cfg[open]>summary .fmeta{display:none}details.cfg.shutting>summary .fmeta{display:block}
details.cfg[open]>summary{margin-bottom:0}details.cfg .picks{margin-top:10px}
/* what it is to be equivalent on: one box to tick for each, in a row that wraps; each takes the room its words need and no less */
.equiv{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);margin:10px 0 0;padding:12px 16px 12px;min-width:0}
.equiv legend{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist);padding:0 6px}
.equiv .ticks{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 10px}
.tick{position:relative;border:1px solid var(--line);border-radius:var(--r);min-width:0}.tick label{display:flex;gap:10px;align-items:flex-start;padding:9px 40px 9px 12px;cursor:pointer;min-width:0}
.pencil{position:absolute;top:6px;right:6px;width:28px;height:28px;border:0;border-radius:var(--r);background:none;color:var(--mist);cursor:pointer;display:grid;place-items:center;padding:0}
.pencil:hover,.pencil:focus-visible{background:var(--soft);color:var(--teal)}.pencil svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
.tick small em{font-style:normal;font-weight:700;color:var(--teal)}
dialog#qedit{border:0;border-radius:var(--r);padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#qedit::backdrop{background:rgba(11,40,38,.45)}dialog#qedit h4{margin:22px 0 6px}
.qlist{list-style:none;margin:0;padding:0;display:grid;gap:8px}.qrow{display:flex;gap:8px;align-items:flex-start;min-width:0}
.qrow textarea{flex:1 1 auto;min-width:0;resize:vertical;font:inherit;font-size:14px;line-height:1.4;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);color:var(--fog)}
.qside{display:flex;gap:6px;align-items:center;flex:none}.qside select{font:inherit;font-size:13px;padding:7px 6px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);color:var(--fog)}
.qdel{width:32px;height:32px;border:0;border-radius:var(--r);background:var(--soft);color:var(--mist);font-size:18px;line-height:1;cursor:pointer}.qdel:hover{background:#fde1db;color:var(--wrong)}
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
.specbtn{font:inherit;font-size:12.5px;font-weight:800;color:var(--fog);background:var(--panel);border:0;border-left:4px solid var(--sun);border-radius:var(--r);padding:7px 14px;box-shadow:var(--shadow);cursor:pointer;white-space:nowrap}
.specbtn span{font-weight:700;color:var(--mist);margin-left:6px}.specbtn.tidy{border-left-color:var(--coral)}
dialog#tidy{border:0;border-radius:var(--r);padding:26px;max-width:min(820px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#tidy::backdrop{background:rgba(11,40,38,.45)}.tlist{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.tgroup{font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--teal2);margin:12px 0 0}
.titem{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r)}
.titem b{font-size:14px}.titem small{display:block;font-size:12px;color:var(--mist);line-height:1.35;overflow-wrap:anywhere;margin-top:2px}.titem .pill{margin-left:4px}
.tsize{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.tdel{padding:8px 14px}
.tsaid{margin:12px 0 0;padding:10px 12px;border-radius:var(--r);background:#d7f3e9;color:var(--right);font-weight:700;font-size:13px}
@media (max-width:560px){.titem{grid-template-columns:minmax(0,1fr) auto}.titem>div{grid-column:1/-1}}.specbtn:hover{box-shadow:0 12px 30px rgba(11,93,87,.16)}.specbtn:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}
.pick{background:var(--panel);border-radius:var(--r);padding:9px 14px 10px;box-shadow:var(--shadow);display:grid;gap:3px;align-content:center;border:0;text-align:left;font:inherit;color:var(--fog);border-left:4px solid var(--lfm);min-width:0}
.pick.b{border-left-color:var(--bon)}.pick.c{border-left-color:#7a5cc4}.pick.d{border-left-color:#2f7fb8}.pick.add{border-left-color:var(--line);box-shadow:none;background:transparent;outline:1.5px dashed var(--line)}.pick.decider{border-left-color:var(--dec)}.pick.target{border-left-color:var(--tgt)}.pick.spec{border-left-color:var(--sun);cursor:pointer}
.pick small{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pick b{font-size:15px;font-weight:800;white-space:nowrap}
.pick small i{font-style:normal;font-weight:700;letter-spacing:.02em;text-transform:none;margin-left:8px;opacity:.85}.pick.add select{color:var(--mist);font-weight:700}.pick select{font-size:14.5px}
.pick select{background:none;border:0;padding:0;font:inherit;font-size:15px;font-weight:800;color:var(--fog);width:100%;cursor:pointer;min-width:0;text-overflow:ellipsis}
.pick select:disabled{opacity:.55;cursor:default}
dialog#spec{border:0;border-radius:var(--r);padding:26px;max-width:min(980px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#spec::backdrop{background:rgba(11,40,38,.45)}.spec-acts{display:flex;flex-wrap:wrap;gap:8px}
/* THE SPEC ON A PHONE: less padding; the title and its id may break anywhere; the buttons two to a row; a table's label sits above its
   value (side by side, a label that does not wrap left the value 33 px); the slots table is one block per slot (its id, stage and model
   on a line, what it is for under them); a kept change's pill beside its kind and its text at the full width */
@media (max-width:560px){dialog#spec{padding:16px 14px;max-width:calc(100vw - 16px)}dialog#spec h3,.spec-head .muted{overflow-wrap:anywhere}
  .spec-head>div:first-child{flex:1 1 100%;min-width:0}.spec-acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;gap:6px}.spec-acts .btn{width:auto;margin:0;padding:10px 8px}
  dialog#spec table.spec,dialog#spec table.spec tbody,dialog#spec table.spec tr,dialog#spec table.spec th,dialog#spec table.spec td{display:block;width:auto}
  dialog#spec table.spec tr{border-top:1px solid var(--line2);padding:8px 0}dialog#spec table.spec th,dialog#spec table.spec td{border:0;padding:0}
  dialog#spec table.spec th{white-space:normal;margin-bottom:3px}dialog#spec .verdict{font-size:18px;line-height:1.3}
  dialog#spec table.spec.slots4 tr:first-child{display:none}dialog#spec table.spec.slots4 tr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 8px;align-items:baseline}
  table.spec.slots4 td:nth-child(1){grid-column:1;grid-row:1}table.spec.slots4 td:nth-child(2){grid-column:2;grid-row:1;color:var(--mist);font-size:12.5px}
  table.spec.slots4 td:nth-child(4){grid-column:3;grid-row:1;font-size:12.5px}table.spec.slots4 td:nth-child(3){grid-column:1/-1;grid-row:2}
  .moves li.kept{grid-template-columns:22px minmax(0,1fr) auto}.moves li.kept .pill{grid-column:3;grid-row:1;white-space:nowrap}.moves li.kept .mv{grid-column:1/-1}}.spec-head{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-start}
table.spec{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}table.spec th,table.spec td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid var(--line2);overflow-wrap:anywhere}
table.spec th{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);white-space:nowrap}dialog h4{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal2);margin:20px 0 6px}
.tail{margin:0;padding:12px;border-radius:var(--r);background:var(--soft);font:11.5px/1.5 ui-monospace,Menlo,monospace;color:var(--fog);white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto}
.idea{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;color:inherit;text-decoration:none;border-radius:var(--r);padding:4px;margin:-4px}
.loopq li.lq{display:block;padding:6px 0;border-top:1px solid var(--line)}.loopq li.lq:first-child{border-top:0}.loopq summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.loopq summary .pill{margin-left:auto}
.tries{margin:6px 0 2px 18px;padding:0;font-size:12.5px;color:var(--fog)}.tries li{margin:3px 0}.tries .why{display:block;color:var(--mist);font-size:12px;margin-top:1px}.plist{list-style:none;margin:4px 0 8px;padding:0}
.plannow{margin-top:10px}.plannow table.kv th{width:150px}.qsteps{margin:0;padding:0;list-style:none;counter-reset:qs;display:grid;gap:4px}
.qsteps li{counter-increment:qs;display:flex;gap:8px;align-items:baseline;padding:6px 10px;border-radius:var(--r);background:var(--soft);font-size:13px;color:var(--fog)}
.qsteps li::before{content:counter(qs);font-weight:800;color:var(--mist);min-width:14px}.qsteps li.on{background:#fdf0cf;box-shadow:inset 0 0 0 2px var(--sun)}.qsteps li.on::before{color:#8a5a00}
.viz .vintro{margin:0 0 12px;font-size:12.5px;color:var(--mist);line-height:1.5}.viz .vfoot{margin:6px 0 0;font-size:12px;color:var(--mist);line-height:1.45}.viz .vlane{margin:0 0 16px}.viz .vlane:last-child{margin-bottom:0}.viz .vhead{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin:0 0 6px}.viz .vkey{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--teal);color:#fff;font-weight:800;font-size:12px}
.viz .vhead small{color:var(--mist);font-size:12px}.viz .vrow{display:flex;align-items:stretch;gap:0}.viz .vbox{flex:1 1 0;min-width:0;padding:8px 10px;border-radius:var(--r);background:var(--soft);border:1px solid var(--line2)}
.viz .vbox b{display:block;font-size:13px;line-height:1.3;color:var(--fog)}.viz .vbox small{display:block;margin-top:3px;font-size:11.5px;line-height:1.4;color:var(--mist)}
.viz .vcode{display:inline-block;margin-right:6px;padding:0 5px;border-radius:var(--r);background:var(--panel);color:var(--teal);font-size:11px;font-weight:800}
.viz .vbox.on{background:#fdf0cf;border-color:var(--sun);box-shadow:0 0 0 2px var(--sun)}.viz .varr{flex:none;width:16px;position:relative}
.viz .varr::after{content:"";position:absolute;left:3px;top:50%;width:7px;height:7px;border-top:2px solid var(--unsure);border-right:2px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}
/* lanes stack, one box to a row, where six boxes side by side would be under ~130 px each (at 820 px they were 106 px, a word spilling out) */
@media (max-width:900px){.viz .vrow{flex-direction:column}.viz .varr{height:20px;width:auto}.viz .varr::after{left:22px;top:50%;transform:translateY(-65%) rotate(135deg)}}@media (max-width:760px){.plannow table.kv th{width:auto}}.plist li{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-top:1px solid var(--line2)}.plist li:first-child{border-top:0}.plist .pill{flex:none}.loopq .tries{margin:6px 0 2px;font-size:13px}.loopq .tries li{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:12px;gap:0 12px;padding:7px 0;border-top:1px solid var(--line2);background:none}.loopq .tries li:first-child{border-top:0}.loopq .tries .k{grid-column:1;min-width:76px;white-space:nowrap;overflow-wrap:normal;letter-spacing:.08em;padding:2px 0 0}.loopq .tries .tx{grid-column:2;min-width:0;overflow-wrap:anywhere;line-height:1.45}@media (max-width:560px){.loopq .tries li{grid-template-columns:46px minmax(0,1fr);gap:0 8px}.loopq .tries .k{min-width:0;letter-spacing:.04em}}.qmethod{margin:8px 0 2px;padding:10px 12px;border-radius:var(--r);background:var(--panel);font-size:12.5px;font-weight:500;color:var(--fog);line-height:1.45}.qmethod>summary{cursor:pointer;list-style:none;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--mist);font-weight:600}.qmethod>summary::-webkit-details-marker{display:none}.qmethod>summary b{color:var(--teal);font-weight:800;margin:0}.qmethod>summary b::before{content:"▸ ";display:inline}.qmethod[open]>summary b::before{content:"▾ "}.qmethod[open]>summary{margin-bottom:6px}.qmethod p{margin:0 0 4px}.qmethod b{color:var(--fog);font-weight:800;margin-right:4px}.qmethod ul{margin:2px 0 4px 18px;padding:0}.qmethod li{margin:1px 0}.qmethod .qtried{margin:4px 0 0;padding:0;list-style:none}.qmethod .qtried li{margin:2px 0;overflow-wrap:anywhere}.qmethod .k{display:inline-block;min-width:74px;margin-right:6px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--mist)}.qmethod .k.cl{color:var(--teal)}.qmethod .k.up{color:var(--right)}.qtries{margin-top:10px;font-size:12.5px}.qlearn{margin:8px 0 4px;color:var(--fog)}.qtries summary{cursor:pointer;font-weight:700;color:var(--teal)}.qtries .loopq{margin-top:6px}
.ideas{display:grid;gap:4px}.ideas li{display:block}.ideas .idea{display:block;padding:8px 10px;margin:0 -10px}
.ideas .idea b{display:block;font-size:13.5px;font-weight:700;line-height:1.35;white-space:normal;overflow:visible;text-transform:none;letter-spacing:0}
.ideas .idea b::first-letter{text-transform:uppercase}
.ideas .idea small{display:block;margin-top:3px;font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--mist)}
.ideas .idea small i{font-style:normal;color:var(--teal)}.ideas a.idea small i::after{content:" \u2197"}
.ideas li+li .idea{border-top:1px solid var(--line);border-radius:0}.ideas li+li a.idea:hover{border-radius:var(--r)}
a.idea:hover{background:var(--soft)}a.idea:focus-visible{outline:2px solid var(--teal2)}.feed li:has(.idea){display:block}
.banner{margin:16px 0 0;padding:10px 16px;border-radius:var(--r);background:#fff4d6;color:#7a5200;font-weight:600}
.panel{background:var(--panel);border-radius:var(--r);padding:22px;box-shadow:var(--shadow)}
.panel.tint{background:var(--soft);box-shadow:none}
.cols{display:grid;gap:18px}.two{grid-template-columns:minmax(0,1.9fr) minmax(0,1fr)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.kpi{background:var(--panel);border-radius:var(--r);padding:16px 18px 18px;box-shadow:var(--shadow);border-left:4px solid var(--c,var(--teal));display:grid;gap:10px}
.kpi .top{display:flex;justify-content:space-between;align-items:center}
.kpi .ic{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--bg,#d9f2ec)}
.kpi .ic svg{width:18px;height:18px;fill:none;stroke:var(--c,var(--teal));stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pill{font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:var(--r);background:#d9f2ec;color:var(--teal);white-space:nowrap}
.pill.up{background:#d7f3e9;color:var(--right)}.pill.down{background:#fde1db;color:var(--wrong)}
.kpi .lab{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}
.kpi .val{font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:1}.kpi .val small{font-size:14px;font-weight:700;color:var(--mist);letter-spacing:0}
.charts{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:18px;margin-top:18px}
.chart-head{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.legend{display:flex;gap:8px;flex-wrap:wrap}.legend span{display:inline-flex;gap:6px;align-items:center;background:var(--panel);border-radius:var(--r);padding:4px 10px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.legend i{width:8px;height:8px;border-radius:50%;display:inline-block}
.plot{background:var(--panel);border-radius:var(--r);padding:14px 14px 8px}
.plot svg,.kb svg{display:block;width:100%;height:auto}
.kinds{list-style:none;margin:16px 0 2px;padding:0;display:grid;gap:12px}.kinds li{display:grid;grid-template-columns:minmax(0,13.5em) minmax(60px,1fr) 7.5em;gap:14px;align-items:center;font-size:13.5px}
.kinds .kn{font-weight:700;overflow-wrap:anywhere}.kinds .kt{display:block;height:10px;border-radius:var(--r);background:var(--soft);overflow:hidden}.kinds .kt i{display:block;height:100%;border-radius:var(--r);background:var(--sun)}
.kinds .full .kt i{background:var(--teal2)}.kinds .low .kt i{background:var(--coral)}.kinds .kc{text-align:right;color:var(--mist);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}.kinds .kc b{color:var(--fog);font-size:13.5px;margin-right:6px}
@media (max-width:560px){.kinds li{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px}.kinds .kt{grid-column:1/-1;grid-row:2}}
.plot text,.panel>svg text,.panel>.kb text{font:10px ui-sans-serif,system-ui,sans-serif;fill:var(--mist);font-weight:700;letter-spacing:.06em}
.donut{display:grid;place-items:center;margin:6px 0 14px}.donut svg{width:210px;height:210px}
.donut .n{font-size:26px;font-weight:800;fill:var(--fog);letter-spacing:-.02em}.donut .l{font-size:9px;font-weight:800;fill:var(--mist);letter-spacing:.14em}
.keys{display:grid;gap:8px;font-size:13.5px;font-weight:600}.keys div{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:8px;align-items:center}
.keys i{width:9px;height:9px;border-radius:50%}.keys span:last-child{color:var(--mist)}
.verdict{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px}.verdict.level{color:var(--right)}.verdict.behind{color:#9a5b00}
.score{display:grid;gap:14px}.bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:baseline}.bar .track{grid-column:1/-1;grid-row:2}
.bar .name{font-weight:700}.bar .track{display:flex;height:14px;border-radius:var(--r);overflow:hidden;background:var(--soft)}
.bar .track i{display:block;height:100%}.r{background:var(--right)}.w{background:var(--wrong)}.u{background:var(--unsure);opacity:.55}
.bar .n{font-size:12.5px;color:var(--mist);text-align:right;white-space:nowrap}
.who-swarm{color:var(--teal)}.who-target{color:var(--tgt)}
.pane,.panel{min-width:0}.stages{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(178px,1fr);gap:14px;align-items:start;overflow-x:auto;padding-bottom:6px}
.stage .again{display:block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:none;color:var(--coral);margin-top:2px}
.stage.loop{border-top:3px solid var(--coral);padding-top:8px;border-radius:3px}.flowline{margin:0 0 12px;font-size:12.5px;color:var(--mist)}.flowline b{color:var(--fog)}
.stage>.t{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--mist);margin-bottom:8px}
.slot{background:#e4f4f0;border-left:4px solid var(--lfm);border-radius:var(--r);padding:10px 12px;margin-bottom:10px}
.slot.b{background:#fdf3d7;border-left-color:var(--bon)}.slot.c{background:#ece6f8;border-left-color:#7a5cc4}.slot.d{background:#e2eff8;border-left-color:#2f7fb8}.slot.decider{background:#fde8e2;border-left-color:var(--dec)}.slot.run{background:#e9ecf8;border-left-color:var(--tgt)}
.probs{display:grid;gap:3px;margin-top:6px;font-size:12.5px}
.probs div{display:grid;grid-template-columns:18px minmax(0,1fr) 38px;gap:6px;align-items:center}.probs i{display:block;height:7px;border-radius:4px;background:var(--dec)}
.slot summary{cursor:pointer;list-style:none}.slot summary::-webkit-details-marker{display:none}
.slot .id{font-weight:800;letter-spacing:-.01em;font-size:15px}.purpose{font-size:13px;font-weight:600;color:var(--fog);opacity:.85;margin:1px 0 3px}
.live{display:flex;gap:7px;align-items:flex-start;margin-top:7px;padding-top:7px;border-top:1px solid rgba(20,33,31,.10);font-size:12px;font-weight:700;color:var(--mist);overflow-wrap:anywhere}
/* what a slot is doing changes every second or two: it has two lines and never more or fewer, so a card is the same height
   whatever it says and nothing below it moves. The whole of it is in the title, for a pointer held over it */
.live span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:17px;height:34px;min-width:0}
#now span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.live i{width:8px;height:8px;border-radius:50%;background:var(--unsure);flex:none;margin-top:4px}.live.on{color:var(--teal)}.live.on i{background:var(--teal2);animation:p 1.2s infinite}
.live.done{color:var(--fog)}.live.done i{background:var(--right)}.live.bad{color:var(--wrong)}.live.bad i{background:var(--wrong)}
.now{display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--mist);overflow-wrap:anywhere}
.now i{width:9px;height:9px;border-radius:50%;background:var(--unsure);flex:none;margin-top:5px}.now.on{color:var(--fog)}.now.on i{background:var(--teal2);animation:p 1.2s infinite}.slot .sub{font-size:12px;color:var(--mist);display:flex;flex-wrap:wrap;gap:2px 10px}
.slot .body{margin-top:8px;padding-top:8px;border-top:1px solid rgba(20,33,31,.10);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.slot .final{display:flex;align-items:center;gap:8px;margin-top:10px;padding:7px 10px;border-radius:var(--r);font-size:12px;font-weight:700;line-height:1.35;background:rgba(255,255,255,.7);min-width:0}
.final .what{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.final .what.code{font:600 11.5px/1.35 ui-monospace,Menlo,monospace}
.final .len{flex:none;font-size:10.5px;font-weight:800;letter-spacing:.03em;opacity:.8;white-space:nowrap}.final .mark{flex:none;width:7px;height:7px;border-radius:50%;background:var(--unsure)}
.final.ok{background:#d7f3e9;color:var(--right)}.final.ok .mark{background:var(--right)}.final.no{background:#fde1db;color:var(--wrong)}.final.no .mark{background:var(--wrong)}
.cand{margin-top:6px;font-size:12.5px;color:var(--mist);border-left:3px solid var(--sun);padding-left:8px}
.target{border-left:4px solid var(--tgt)}.target h3{color:var(--tgt)}
button.strip{display:block;width:100%;text-align:left;border:0;font:inherit;color:inherit;cursor:pointer}button.strip:hover{box-shadow:0 14px 34px rgba(11,93,87,.16)}
button.strip:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}.strip .meta{display:flex;flex-wrap:wrap;gap:6px;margin:0;color:var(--mist)}
.strip .meta>span{display:inline-block;padding:4px 11px;border-radius:var(--r);background:var(--soft);font-size:12.5px;font-weight:600;line-height:1.35;max-width:100%}
.strip .meta>span b{color:var(--fog);font-weight:800}.strip .meta>span.ok{background:#d7f3e9;color:var(--right)}.strip .meta>span.ok b{color:var(--right)}
.strip .meta>span.no{background:#fde1db;color:var(--wrong)}.strip .meta>span.no b{color:var(--wrong)}.strip .meta>span.alone{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}
.strip .meta>span.more{background:transparent;color:var(--teal);font-weight:800;padding-left:4px}
.prog{display:block;height:8px;border-radius:var(--r);background:var(--soft);overflow:hidden;margin:10px 0 10px;position:relative}.prog i{display:block;height:100%;float:left}
.prog .eq{background:var(--right)}.prog .ch{background:var(--sun)}.pct{font-variant-numeric:tabular-nums}.gapkey{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--mist)}.gapkey i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
.memp,.iop{margin-top:18px}.memnum{text-align:right}.memnum b{display:block;font-size:30px;font-weight:800;color:var(--teal);line-height:1}.memnum span{font-size:12.5px;color:var(--mist);font-weight:700}
.memc{display:grid;gap:0}.memh{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}.memh b{font-size:17px;font-weight:800;color:var(--fog)}
.memh small{display:block;margin-top:3px;font-size:12.5px;color:var(--mist);font-weight:500;line-height:1.45}.memc.compact .memh b{font-size:14.5px}
.memnum{text-align:right}.memnum b{display:block;font-size:30px;font-weight:800;color:var(--teal);line-height:1}.memnum span{font-size:12.5px;color:var(--mist);font-weight:700}.memc.compact .memnum b{font-size:26px}
.memrows{display:grid;gap:10px;margin-top:16px}.memrow{display:grid;grid-template-columns:minmax(0,220px) minmax(80px,1fr) 104px;gap:12px;align-items:center;font-size:14px;font-weight:700;color:var(--fog)}
.memrow .mbar{display:flex;height:18px;border-radius:var(--r);background:var(--soft);overflow:hidden}.memrow .mbar i{display:block;height:100%}.memrow .mbar.stack i+i{box-shadow:inset 2px 0 0 #fff}
.memrow .mv{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.memrow .mv b{color:var(--fog)}.memrow.axis{font-size:11px;color:var(--mist);font-weight:700}.memrow .ticks{position:relative;height:14px}
.memrow .ticks span{position:absolute;transform:translateX(-50%)}.memrow .ticks span:first-child{transform:none}.memleg{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;font-size:12.5px;color:var(--mist);font-weight:600}
.memleg span{display:inline-flex;align-items:center;gap:6px}.memleg i{width:10px;height:10px;border-radius:3px;flex:none}.memleg b{color:var(--fog)}
.memp,.iop{margin-top:18px}.strip .memc{margin:0 0 14px;padding:16px 18px;border-radius:var(--r);background:#fff;box-shadow:inset 0 0 0 1px var(--line2)}
.strip .parc{background:linear-gradient(135deg,#fff7e8,#ffffff 55%);box-shadow:inset 0 0 0 1px #f3dfb8}.strip .parc.level{background:linear-gradient(135deg,#e3f7ef,#fff 55%);box-shadow:inset 0 0 0 1px #bfe7d6}
.parc .memnum b{color:#9a5b00}.parc.level .memnum b{color:var(--right)}.parc .memh small{color:#7a6a4f;font-weight:600}.parc.level .memh small{color:var(--mist)}
.trainprog>.mbar{display:flex;width:100%;height:14px;margin-top:12px;border-radius:var(--r);overflow:hidden;background:var(--soft)}.trainprog>.mbar i{display:block;height:100%}.trainprog .mbar .pe,.trainprog .memleg .pe{background:var(--right)}.trainprog .mbar .pr,.trainprog .memleg .pr{background:var(--teal2)}
.trainprog .mbar .pb,.trainprog .memleg .pb{background:#fff;box-shadow:inset 0 0 0 2px var(--sun)}.trainprog .mbar .pn,.trainprog .memleg .pn{background:var(--wrong)}.trainprog .memleg .pq{background:var(--soft)}
.memcard .memc{margin-top:14px}
.trainhead{margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid var(--line)}
.trainprog .proghead{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline}.trainprog .memnum{display:flex;align-items:baseline;gap:8px}.trainprog .memnum .pct{font-size:40px;line-height:1}.trainprog .memnum small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);margin-top:2px}
/* EVALUATE THE SWARM and PRETRAIN: the same head as Training progress, a row a task (its name, a bar for each model, what the two came
   to) and a row a small model; the bars move in place while a run goes on */
.memcard .proghead,.evalp .proghead,.prep .proghead{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}.memcard .memnum,.evalp .memnum,.prep .memnum{display:flex;align-items:baseline;gap:8px}
.memcard .memnum .pct,.evalp .memnum .pct,.prep .memnum .pct{font-size:40px;line-height:1}.memcard .memnum small,.evalp .memnum small,.prep .memnum small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);margin-top:2px}
.memcard .progline,.evalp .progline,.prep .progline{flex:1 1 320px;font-size:14px;color:var(--fog);line-height:1.45}.evctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.evctl select{font:inherit;font-weight:700;padding:10px 40px 10px 14px;border-radius:var(--r);border:1px solid var(--line);color:var(--fog);cursor:pointer;-webkit-appearance:none;appearance:none;background:var(--panel) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%235b6b68' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 16px center/12px 8px}
.evctl select:focus-visible{outline:2px solid var(--teal2);outline-offset:2px}
.evalp>.state,.prep>.state,.evnow{margin-top:12px}.evq{margin-top:8px;padding:10px 12px;border-radius:var(--r);background:var(--soft);font-size:13px}
.evq .evql{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}.evq .evql span{color:var(--mist);font-size:12px}.evq p{margin:6px 0 0;overflow-wrap:anywhere;line-height:1.45}
.evitem{margin-top:18px}.evitem h4{margin:0 0 6px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.evitem>p{margin:0 0 10px;line-height:1.45}
.evrow{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(200px,1.4fr) minmax(200px,1.3fr);gap:6px 16px;padding:10px 0;border-top:1px solid var(--line2);align-items:center}
.evname b{display:block;font-size:14px}.evname small,.evag small{display:block;font-size:12px;color:var(--mist);line-height:1.35;margin-top:2px}
.evbars{display:grid;gap:10px}.evw small{display:block;font-size:12px;color:var(--mist);margin-top:2px;overflow-wrap:anywhere}.evw small b{color:var(--fog)}
.evbar{display:block;height:8px;border-radius:var(--r);background:var(--soft);overflow:hidden}.evbar i{display:block;height:100%;width:0;background:var(--teal2);transition:width .6s ease}
.evw[data-w="target"] .evbar i{background:var(--tgt)}.evw.asking .evbar i{background:var(--sun)}.evw.failed .evbar i{background:var(--wrong)}.evw.kept .evbar i{opacity:.55}
.evag .evpct{font-size:20px;margin-right:4px}.prerows{margin-top:12px}.prerow{display:grid;grid-template-columns:minmax(130px,.6fr) minmax(0,2fr);gap:4px 16px;padding:10px 0;border-top:1px solid var(--line2);align-items:center}
.prerow small{display:block;font-size:12.5px;color:var(--fog);line-height:1.4;margin-top:2px}.prerow .evbar{height:8px}.preuse{display:flex;gap:8px;align-items:baseline;margin-top:12px;font-weight:700;font-size:14px;flex-wrap:wrap}
.preuse small{font-weight:500;color:var(--mist);font-size:12px}
@media (max-width:760px){.evrow{grid-template-columns:minmax(0,1fr);gap:10px;padding:14px 0}.prerow{grid-template-columns:minmax(0,1fr)}.evctl{width:100%}.evctl .btn{flex:1}.evctl select{flex:1 1 100%}}
/* THE HEADLINE NUMBERS (Training progress, Evaluate the swarm, Pretrain): the number, then its label beside it on the same line,
   and what it is a share of under the label, all read left to right (the memory chart's own number is right-aligned; not these) */
.trainprog .memnum,.evalp .memnum,.prep .memnum,.memcard .memnum{text-align:left;align-items:center;gap:10px;flex:none}
.trainprog .memnum>span,.evalp .memnum>span,.prep .memnum>span,.memcard .memnum>span{display:flex;flex-direction:column;align-items:flex-start;font-size:14px;color:var(--fog);font-weight:700;line-height:1.2}
/* (the figure centred on its two lines; a line too long for the column wraps inside it, never over the description) */
.trainprog .memnum small,.evalp .memnum small,.prep .memnum small,.memcard .memnum small{margin-top:3px;white-space:normal}
.trainprog .memnum>span,.evalp .memnum>span,.prep .memnum>span,.memcard .memnum>span{min-width:0}
.pct.busy{display:inline-block;position:relative;color:transparent;line-height:1;user-select:none}
.memnum .pct.busy>span{font:inherit;color:transparent}
.pct.busy i{position:absolute;left:0;right:0;bottom:.11em;height:.72em;border-radius:var(--r);background:linear-gradient(90deg,transparent,rgba(30,158,142,.45),transparent) var(--soft);background-size:200% 100%;animation:busyn 1.4s ease-in-out infinite}
.busyn{background:linear-gradient(90deg,transparent,rgba(30,158,142,.45),transparent)}
.busyn{display:inline-block;width:2.2em;height:.8em;border-radius:4px;background-color:var(--soft);vertical-align:-1px;background-size:200% 100%}
.busyn{animation:busyn 1.4s ease-in-out infinite}@keyframes busyn{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.pct.busy i,.busyn{animation:none}}
.evalp .memnum .pct.none{color:var(--mist);font-weight:800}
.trainprog>.state{margin-top:12px}.trainprog>.state.running{flex-wrap:wrap;align-items:baseline;column-gap:8px}.trainprog>.state.running i{align-self:center;margin-top:0}
.trainprog>.state.running span[data-since]{display:flex;gap:8px;align-items:baseline}.trainprog>.state.running .runx{display:inline;font-size:12.5px;font-weight:600;color:var(--mist)}.trainprog>.state.running .runx b{display:inline;font-size:inherit;font-weight:800;color:var(--teal)}
.trainprog .evctl{flex:none}.ideasln{margin:6px 0 0}.ideasln ul{margin:4px 0 0;padding:0;list-style:none;display:grid;gap:2px;font-size:13px}.ideasln li small{color:var(--mist)}.ideasln a{color:inherit}
.trainprog .progline{flex:1 1 320px;font-size:14px;color:var(--fog);line-height:1.45}.trainprog .memleg{margin-top:8px}.trainprog .memc{margin-top:14px}
.parc .mbar .pe,.parc .memleg .pe{background:var(--right)}.parc .mbar .pd,.parc .memleg .pd{background:var(--wrong)}.parc .mbar .pn,.parc .memleg .pn{background:#c9d4d1}
.parc .memrow.alone{font-weight:600;color:var(--mist)}.parc .memrow.alone .mbar{height:12px;opacity:.8}.parc .memrow .mv b{color:var(--fog)}
@media (max-width:560px){.memh{grid-template-columns:minmax(0,1fr)}.memrow{grid-template-columns:minmax(0,1fr) auto}.memrow .mbar,.memrow .ticks{grid-column:1/-1;grid-row:2}.memnum{text-align:left}.memrow.axis>span:not(.ticks){display:none}.memrow.axis .ticks{grid-row:1}}

.plan-head{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;align-items:baseline}.plan h4{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--teal2);margin:18px 0 6px}
.plan details.psec>summary{list-style:none;cursor:pointer;border-radius:var(--r)}.plan details.psec>summary::-webkit-details-marker{display:none}
.plan details.psec>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}
.plan details.psec>summary>h4{display:flex;align-items:center;gap:8px}.plan details.psec:not([open])>summary>h4{margin-bottom:2px}
.plan .pmeta{display:block;font-size:13px;color:var(--mist);font-weight:600;line-height:1.4;overflow-wrap:anywhere;margin:0 0 4px}.plan details.psec[open] .pmeta{display:none}
.plan details.psec.shutting .pmeta{display:block}.plan details.psec.shutting>summary>h4::after,.run details.sec.shutting>summary>h5::after{transform:rotate(-45deg)}
.plan details.psec>summary>h4::after{content:'';flex:none;width:6px;height:6px;margin-left:2px;border-right:2px solid var(--teal2);border-bottom:2px solid var(--teal2);transform:rotate(45deg);transition:transform .15s}
.plan details.psec:not([open])>summary>h4::after{transform:rotate(-45deg)}.plan details.psec{border-bottom:1px solid var(--line2);padding-bottom:8px}.plan details.psec:last-of-type{border-bottom:0}
.finds{margin:0;padding:0;list-style:none;display:grid;gap:6px}.finds li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;font-size:13.5px}
.finds .n{font-weight:800;background:#fde1db;color:var(--wrong);border-radius:var(--r);padding:1px 9px;font-size:12px;white-space:nowrap}
.steer{list-style:none;margin:0;padding:0;display:grid;gap:6px}.steer li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 10px;border:1px solid var(--line2);border-radius:var(--r)}
.steer li b{font-size:13.5px}.steer li small{display:block;font-size:12px;color:var(--mist);overflow-wrap:anywhere}.segs{display:inline-flex;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;flex:none}
.seg{border:0;background:none;font:inherit;font-size:12px;font-weight:700;color:var(--mist);padding:5px 10px;cursor:pointer}.seg+.seg{border-left:1px solid var(--line)}.seg.on{background:var(--teal);color:#fff}
.seg:focus-visible{outline:2px solid var(--teal2);outline-offset:-2px}.queue{margin-top:12px}.queue .label{display:flex;justify-content:space-between;margin:0 0 6px;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
.queue .label span{letter-spacing:0;text-transform:none;font-weight:600}.mine{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px}.mine li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;font-size:13px;font-weight:600}
.mine li>span:first-child{color:var(--teal);font-weight:800}.qx{width:26px;height:26px;border:0;border-radius:var(--r);background:var(--soft);color:var(--mist);cursor:pointer}
.moves .mside{display:grid;gap:6px;justify-items:end}.moves .acts{display:inline-flex;gap:4px}.moves .acts button{border:1px solid var(--line);background:var(--panel);border-radius:var(--r);font:inherit;font-size:11.5px;font-weight:700;color:var(--teal);padding:3px 9px;cursor:pointer}
.moves li.skipped{opacity:.55}.moves li.pinned{background:linear-gradient(90deg,#e8f6f1,transparent)}
dialog#steerd{border:0;border-radius:var(--r);padding:26px;max-width:min(860px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#steerd::backdrop{background:rgba(11,40,38,.45)}
#steer-find{width:100%;font:inherit;font-size:14px;padding:9px 12px;border:1px solid var(--line);border-radius:var(--r);margin:4px 0 6px}.movepick{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.movepick li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line2);border-radius:var(--r)}.movepick b{font-size:13.5px;overflow-wrap:anywhere}.movepick small{display:block;color:var(--mist);font-size:12px}.qadd{padding:6px 14px}
@media (max-width:560px){.steer li{grid-template-columns:minmax(0,1fr)}.segs{justify-self:start}}
.moves{margin:0;padding:0;list-style:none}.moves li{display:grid;grid-template-columns:26px 124px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 0;border-top:1px solid var(--line2)}
.moves .o{font-weight:800;color:var(--mist);font-variant-numeric:tabular-nums}.moves .k{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 0;color:var(--teal);min-width:0;overflow-wrap:anywhere;line-height:1.35}
.moves .k.arrangement{color:var(--tgt)}.moves .k.plan{color:var(--bon)}.moves b{display:block;font-size:14.5px}.moves small{display:block;color:var(--mist);font-size:12.5px;overflow-wrap:anywhere}.moves small a{color:inherit}
.moves li.running{background:linear-gradient(90deg,#fdf0cf66,transparent)}.pill.planned{background:var(--soft);color:var(--mist)}.pill.running{background:#fdf0cf;color:#8a5a00}
@media (max-width:700px){.moves li{grid-template-columns:22px minmax(0,1fr) auto}.moves .k{grid-column:2}.moves .mv{grid-column:2/4}}
.foot{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 30px;align-items:center}
.foot .brand{display:flex;gap:12px;align-items:center}.foot .brand svg{width:40px;height:40px;border-radius:var(--r);flex:none}.foot .brand b{display:block;font-size:15px;letter-spacing:-.01em}.foot .brand small{color:var(--mist);font-size:12.5px}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;font-weight:700}.foot nav a{color:var(--teal);text-decoration:none}.foot nav a:hover{text-decoration:underline}
.foot .fine{grid-column:1/-1;color:var(--mist);font-size:12px;line-height:1.55;max-width:92ch}@media (max-width:700px){.foot{grid-template-columns:minmax(0,1fr)}}
.arrh{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px 18px;align-items:flex-start;margin-bottom:12px}.arrh h3{margin:0}
.achips{display:flex;flex-wrap:wrap;gap:6px}.achips span{padding:4px 11px;border-radius:var(--r);background:var(--soft);font-size:12.5px;font-weight:600;color:var(--mist)}.achips b{color:var(--fog)}
/* THE ARRANGEMENT AS AVATARS: a model is a face in its colour; a slot is that face, in the step of the flow it stands in. The ring
   round a slot is its record (the share of its answers equivalent to the larger model's), the halo what it is doing now. */
.roster{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.mav{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:var(--r);background:var(--soft);min-width:0}
button.mav{position:relative;border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}button.mav:hover,button.mav.sel{background:#dfe6f3}button.mav:focus-visible{outline:3px solid var(--teal2)}
.mav .live{position:absolute;top:2px;left:30px;margin:0;padding:0;border:0;width:12px;height:12px}.mav .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mav .live i{width:9px;height:9px;margin:0;border:2px solid var(--soft);box-sizing:content-box;background:#c9d4d1}.mav:has(.live.on) .live i{background:var(--teal2);animation:p 1.2s infinite}.mav:has(.live.done) .live i{background:var(--right)}
.via{position:relative;align-self:center;display:flex;flex-direction:column;align-items:center;gap:3px;margin:0 6px 0 -12px;padding:4px;border:0;border-radius:var(--r);background:none;font:inherit;cursor:pointer;flex:none}
.via:hover,.via.sel{background:rgba(63,79,134,.08)}.via .vf{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#6b78a8}.via .vf svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.via .vn{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mist)}.via:not(:last-child)::after{content:"";position:absolute;right:-15px;top:14px;width:8px;height:8px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:rotate(45deg)}
.via .live{position:absolute;top:2px;right:0;margin:0;padding:0;border:0;width:10px;height:10px}.via .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.via .live i{width:8px;height:8px;margin:0;border:2px solid #fff;box-sizing:content-box;background:#c9d4d1}
.via.off .vf,.via.off .vn,.st.off .avs{opacity:.4}.via.off .vf{background:#9aa6a3}.via .vo{font-size:9.5px;font-weight:700;color:var(--mist);white-space:nowrap}.st.off{border-style:dashed}
.via:has(.live.on) .vf{animation:halo 1.4s ease-out infinite;--fc:#6b78a8}.via:has(.live.on) .live i{background:var(--teal2)}.via:has(.live.done) .live i{background:var(--right)}
.mav b{display:block;font-size:13px;line-height:1.2}.mav small{display:block;font-size:11.5px;color:var(--mist);font-weight:600}.mav.tgt{margin-left:auto}
.face{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#fff;font:800 12px/1 inherit;letter-spacing:-.02em;flex:none;background:var(--fc,var(--unsure))}
.a{--fc:var(--lfm)}.b{--fc:var(--bon)}.c{--fc:#7a5cc4}.d{--fc:#2f7fb8}.decider{--fc:var(--dec)}.run{--fc:#6b78a8}.tgt{--fc:var(--tgt)}
.face svg{width:17px;height:17px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pipe{display:flex;flex-wrap:nowrap;align-items:stretch;gap:10px 0;margin-top:4px}.st:has(+.via)::after{display:none}.st:has(+.via){margin-right:16px}.pipe>.st,.pipe>.loopg{min-width:min-content}
/* each step as wide as its faces need to begin with (a face's column and the box's padding), then shrinking or growing in that proportion:
   from a width of 0, the steps of one face took more than their share and a revise of six faces was left one column wide */
.pipe>.st,.loopg>.st{flex:var(--n,1) 1 calc(var(--n,1) * 74px + 16px)}.pipe>.loopg{flex:var(--n,1) 1 calc(var(--n,1) * 74px + 60px)}
.st{position:relative;display:flex;flex-direction:column;gap:8px;padding:10px 8px 8px;margin-right:16px;border-radius:var(--r);background:#f5faf8;border:1px solid var(--line2)}
.st:not(:last-child)::after{content:"";position:absolute;right:-14px;top:50%;width:9px;height:9px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}
.st .stt{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist);white-space:nowrap}.st .stt span{letter-spacing:0;text-transform:none;font-weight:700;margin-left:6px;color:#8a5a00}
.loopg{display:flex;flex-wrap:nowrap;gap:10px 0;padding:8px 0 4px 8px;margin-right:22px;border-radius:var(--r);border:1.5px dashed #e3c46a;position:relative}.loopg{flex-wrap:wrap}.loopg>.st{min-width:min-content}.loopg>.lt{flex-basis:100%;font-size:11.5px;font-weight:700;color:#8a5a00;margin:-2px 0 0 2px}
.loopg:not(:last-child)::after{content:"";position:absolute;right:-17px;top:50%;width:9px;height:9px;border-top:2.5px solid var(--unsure);border-right:2.5px solid var(--unsure);transform:translateY(-50%) rotate(45deg)}.loopg .st:last-of-type{margin-right:8px}.loopg .st:last-of-type::after{display:none}
.st.mk{margin-left:auto;margin-right:0;background:#eef0f8;border-color:#d7dcef}.st.mk .stt{color:var(--tgt)}
/* the faces in even columns, as many as the box holds (a free wrap broke six faces into rows of 2, 1, 1, 1, 1 by the width of their names) */
.avs{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));justify-items:center;gap:6px 2px}
.av{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:64px;padding:4px 4px 2px;border:0;border-radius:var(--r);background:none;font:inherit;color:inherit;cursor:pointer}
.av:hover,.av.sel{background:rgba(11,93,87,.07)}.av:focus-visible{outline:3px solid var(--teal2);outline-offset:1px}
.av .ring{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:conic-gradient(var(--fc) calc(var(--p,0)*1%),#dfe8e5 0)}
.av.norec .ring{background:#dfe8e5}.av .ring .face{width:36px;height:36px;font-size:11.5px;box-shadow:0 0 0 2px #f5faf8}
.av .nm{font-size:10.5px;font-weight:700;letter-spacing:-.01em;color:var(--fog);text-align:center;line-height:1.2;white-space:nowrap}
@media (max-width:560px){.av{min-width:64px;padding:4px 2px 2px}.av .nm{white-space:normal;max-width:84px}}
.av .pc{font-size:10.5px;font-weight:700;color:var(--mist);line-height:1;white-space:nowrap}.av.norec .pc{font-weight:600;color:var(--unsure)}
.av .live{position:absolute;top:2px;right:6px;margin:0;padding:0;border:0;width:14px;height:14px}.av .live span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.av .live i{width:12px;height:12px;margin:0;border:2px solid #f5faf8;box-sizing:content-box;background:#c9d4d1}
.av:has(.live.on) .ring{animation:halo 1.4s ease-out infinite}.av:has(.live.on) .live i{background:var(--teal2)}
.av:has(.live.done) .live i{background:var(--right)}.av:has(.live.bad) .live i{background:var(--wrong)}
@keyframes halo{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fc) 55%,transparent)}100%{box-shadow:0 0 0 9px color-mix(in srgb,var(--fc) 0%,transparent)}}
.av.trying .ring{box-shadow:0 0 0 3px var(--sun),0 0 0 6px #fdf0cf;animation:tr 1.6s ease-in-out infinite}@keyframes tr{50%{box-shadow:0 0 0 3px var(--sun),0 0 0 9px rgba(249,196,64,.15)}}
.avkey{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 0;font-size:11.5px;color:var(--mist);font-weight:600}.avkey span{display:inline-flex;align-items:center;gap:6px}
.avkey i{display:inline-block;width:10px;height:10px;border-radius:50%}.avkey .kr{width:14px;height:14px;background:conic-gradient(var(--lfm) 60%,#dfe8e5 0);border-radius:50%}
.avdetail{margin-top:12px}.avdetail:empty{display:none}.avdetail .slot{margin:0}
@media (prefers-reduced-motion:reduce){.av:has(.live.on) .ring{animation:none;box-shadow:0 0 0 3px var(--teal2)}}
/* A PHONE: the steps are tiles that wrap in reading order, each titled on top and as wide as its faces need, so that steps of one or
   two faces share a row instead of each taking the full width with its faces stranded beside a label (the order is the flow line
   above them; the arrows between tiles are left out, as a wrapped row has no single next). The models are two to a row. */
@media (max-width:560px){.mav .live{left:30px}
  .pipe{flex-direction:row;flex-wrap:wrap;gap:8px;align-items:stretch}.pipe>.st,.pipe>.loopg{flex-basis:auto;min-width:0}
  .st,.loopg,.st:has(+.via){margin:0}.st{flex-direction:column;align-items:stretch;gap:4px;padding:8px 6px 6px}.st .stt{width:auto;white-space:nowrap;padding-left:4px}
  .st::after,.st:not(:last-child)::after,.loopg::after,.loopg:not(:last-child)::after{display:none}
  .via{flex:0 0 auto;flex-direction:column;justify-content:center;align-items:center;align-self:stretch;margin:0;padding:6px 6px;gap:4px;border-radius:var(--r);background:#eef0f8}.via::after,.via:not(:last-child)::after{display:none}
  .loopg{flex-direction:row;flex-wrap:wrap;gap:8px;padding:8px}.loopg>.st{margin:0;flex-basis:auto}.loopg .st:last-of-type{margin:0}
  .avs{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));justify-items:center;gap:6px 0}.av{min-width:56px;padding:4px 1px 2px}.st{padding:8px 4px 6px}
  .st.mk{margin-left:0}.mav.tgt{margin-left:0}
  .roster{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.roster .mav.tgt{grid-column:1/-1}.roster .mav{padding:6px 8px 6px 6px}.roster .mav b{font-size:12.5px}.roster .mav small{font-size:11px}}
/* (a flow too long for its card, at any width: the phone's tiles, measured by fitPipes) */
.pipe.wrapped{flex-wrap:wrap;gap:8px}.pipe.wrapped>.st,.pipe.wrapped>.loopg{flex-basis:auto;min-width:0}
.pipe.wrapped .st,.pipe.wrapped .loopg,.pipe.wrapped .st:has(+.via){margin:0}.pipe.wrapped .st{flex-direction:column;align-items:stretch;gap:4px;padding:8px 6px 6px}.pipe.wrapped .st .stt{width:auto;white-space:nowrap;padding-left:4px}
.pipe.wrapped .st::after,.pipe.wrapped .loopg::after{display:none}
.pipe.wrapped .via{flex:0 0 auto;flex-direction:column;justify-content:center;align-items:center;align-self:stretch;margin:0;padding:6px;gap:4px;border-radius:var(--r);background:#eef0f8}.pipe.wrapped .via::after{display:none}
.pipe.wrapped .loopg{flex-direction:row;flex-wrap:wrap;gap:8px;padding:8px}.pipe.wrapped .loopg>.st{margin:0;flex-basis:auto}
.pipe.wrapped .avs{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));justify-items:center;gap:6px 0}
.facesnow{margin:0 0 10px}
.updnote{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:space-between;margin:0 0 12px;padding:10px 14px;border-radius:var(--r);background:#fdf0cf;color:#6b4a00;font-weight:700;font-size:14px;box-shadow:var(--shadow)}.updnote[hidden]{display:none}
.qtrack{margin:0 0 14px;padding:12px 14px;border-radius:var(--r);background:var(--soft)}.qtrack .qhead{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;font-size:13px;color:var(--mist);font-weight:600}
.qtrack .qhead b{color:var(--fog)}.qtrack .qnow{margin:6px 0 0;font-size:13.5px;font-weight:700;color:var(--fog);overflow-wrap:anywhere}.qtrack .qnow small{display:block;font-weight:600;color:var(--mist);font-size:12px;margin-top:2px}
.qtrack .qnow .ql{display:block}.qtrack .qnow .qtext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;padding:0;line-height:1.45;max-height:2.9em;overflow:hidden}.qtrack .qnow .it{float:left;margin:0 8px 0 0;display:inline-block;line-height:1.45;padding:0 8px;white-space:nowrap;border-radius:var(--r);background:var(--panel);color:var(--teal);font-size:12px;margin-right:6px}
.pips{display:flex;flex-wrap:wrap;gap:3px;margin-top:10px}.pips i{width:10px;height:10px;border-radius:3px;background:#dfe8e5;display:block}
.pips i.at,.qkey i.at{background:var(--right)}.pips i.re,.qkey i.re{background:var(--teal2);box-shadow:inset 0 0 0 2px #fff}.pips i.nr,.qkey i.nr{background:var(--wrong)}.pips i.nc,.qkey i.nc{background:#c9d3d0}.pips i.ro,.qkey i.ro{background:#fff;box-shadow:inset 0 0 0 2px var(--sun)}
.pips i.cur,.qkey i.cur{background:var(--sun);animation:p 1.2s infinite}
.pips i.sa,.qkey i.sa{background:#fdf0cf;box-shadow:inset 0 0 0 2px #e3c46a}.pips i.mw,.qkey i.mw{background:repeating-linear-gradient(135deg,#c9d3d0 0 2px,#fff 2px 4px);box-shadow:inset 0 0 0 1px #b3c0bc}.qkey{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:11.5px;color:var(--mist);font-weight:600}.qkey span{display:inline-flex;align-items:center;gap:5px}.qkey i{width:10px;height:10px;border-radius:3px;display:inline-block}
.tryline{margin:8px 0 12px;padding:9px 12px;border-radius:var(--r);background:#fdf0cf;color:#6b4a00;font-size:13px;overflow-wrap:anywhere}.tryline b{color:#8a5a00}.tryline a{color:#8a5a00;font-weight:800;margin-left:6px}
.slot.tgt{background:#e6e9f6;border-left-color:var(--tgt)}.stage.mark{margin-top:14px;padding-top:14px;border-top:1px solid var(--line2)}.stage.mark .t{color:var(--tgt)}.slot.tgt .body{padding-top:8px}
.stage.mark .slot.tgt>summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr) auto auto;gap:4px 16px;align-items:center}.stage.mark .slot.tgt .purpose{margin:0}
@media (max-width:760px){.stage.mark .slot.tgt>summary{grid-template-columns:minmax(0,1fr)}}
.ladder{margin:12px 0 0;padding:0;list-style:none}.ladder li{padding:6px 0;border-top:1px solid var(--line2);font-size:13px}
.io{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.tabs button{background:var(--panel);border:0;color:var(--mist);border-radius:var(--r);padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:var(--shadow)}
.tabs button[aria-pressed=true]{background:var(--teal);color:#fff}
.qlist{max-height:640px;overflow:auto;display:grid;gap:4px;padding:2px}
.q{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:0;
border-radius:var(--r);padding:8px 10px;color:var(--fog);font:inherit;font-size:13px;cursor:pointer}
.q[hidden]{display:none}.q:hover{background:var(--soft)}.q[aria-current=true]{background:var(--panel);box-shadow:var(--shadow)}
.q .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block}.dot.right{background:var(--right)}.dot.wrong{background:var(--wrong)}
.dot.unsure{background:var(--unsure)}.dot.none{border:1.5px dashed var(--unsure)}
.input{background:var(--panel);border-radius:var(--r);padding:16px 18px;margin-bottom:16px;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:var(--shadow);font-weight:600}
.input .lab,.pane .lab{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--mist)}
.versus{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:16px;align-items:start}
.pane{background:var(--panel);border-radius:var(--r);padding:18px;box-shadow:var(--shadow);border-top:4px solid var(--teal)}.pane.t{border-top-color:var(--tgt)}
.pane .head{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.reply{border-top:1px solid var(--line2);margin-top:8px;padding-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.grade{font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.12em;padding:2px 8px;border-radius:var(--r)}
.grade.right{background:#d7f3e9;color:var(--right)}.grade.wrong{background:#fde1db;color:var(--wrong)}.grade.unsure{background:var(--soft);color:var(--mist)}
textarea{width:100%;min-height:80px;background:var(--soft);border:0;border-radius:var(--r);color:var(--fog);font:inherit;padding:12px}
.btn{background:var(--sun);color:#4a3200;border:0;border-radius:var(--r);padding:11px 22px;font:inherit;font-weight:800;cursor:pointer;margin-top:8px;box-shadow:0 8px 18px rgba(249,196,64,.35)}
.btn[disabled]{opacity:.5;cursor:default;box-shadow:none}
.run{display:grid;gap:12px}.run .row{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.btn.stop{background:#fde1db;color:var(--wrong);box-shadow:none}.runbtns{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:stretch}.runbtns .btn{width:auto;margin:0;padding:12px 10px;line-height:1.2;display:flex;align-items:center;justify-content:center;text-align:center}.btn.quiet{background:var(--soft);color:var(--fog);box-shadow:none}.btn.quiet.sure{background:#fde1db;color:var(--wrong)}.btn.top{margin-top:0}.btn.wide{width:100%;padding:13px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:10px}.facts>*{background:var(--soft);border-radius:var(--r);padding:8px 12px;display:grid;gap:2px}
.facts small{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}.facts b{font-size:16px;font-weight:800}
.facts select{background:none;border:0;padding:0;font:inherit;font-size:16px;font-weight:800;color:var(--fog);width:100%;cursor:pointer}
.state{display:flex;gap:8px;align-items:center;font-size:12.5px;font-weight:700;color:var(--mist)}.state i{width:8px;height:8px;border-radius:50%;background:var(--unsure);flex:none}
.state.on{color:var(--teal)}.state.on i{background:var(--teal2);animation:p 1.2s infinite}.state.warn{color:#9a5b00}.state.warn i{background:var(--sun)}
.panel.run{display:grid;gap:14px;padding:18px}.panel.run>*{margin:0}
.run .meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--mist);font-weight:600}.run .meta b{color:var(--fog);font-weight:800}
.run .sec{display:grid;gap:8px;padding-top:14px;border-top:1px solid var(--line2)}
.run .nowline{margin:0;color:var(--teal);font-size:15px;overflow-wrap:anywhere}.run .nowline b{font-weight:800}
.run details.done summary{cursor:pointer;color:var(--mist);font-size:12.5px;font-weight:700;list-style:none}.run details.done summary::before{content:'✓ ';color:var(--right)}
.run details.done[open] summary{margin-bottom:6px}.run .label{margin:2px 0 0;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
.steps.next li>span:first-child{color:var(--mist)}.steps.next li>span:nth-child(2){color:var(--fog)}
.run details.sec>summary{list-style:none;cursor:pointer;border-radius:var(--r)}.run details.sec>summary::-webkit-details-marker{display:none}
.run details.sec>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.run details.sec[open]>summary{margin-bottom:8px}
.run details.sec>summary>h5::after{content:'';flex:none;width:6px;height:6px;margin:0 2px 2px 4px;border-right:2px solid var(--mist);border-bottom:2px solid var(--mist);transform:rotate(45deg);transition:transform .15s}
.run details.sec:not([open])>summary>h5::after{transform:rotate(-45deg)}.run details.sec>summary>h5 span{margin-left:auto}
.run .secb{display:grid;gap:8px}.run details.sec{display:block}
.run .smeta{margin:3px 0 0;font-size:12.5px;line-height:1.4;color:var(--mist);font-weight:600;overflow-wrap:anywhere}.run details.sec[open] .smeta{display:none}.run details.sec.shutting .smeta{display:block}
.run details.sec:not([open])>summary{margin-bottom:0}
details.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;border-radius:var(--r)}details.fold>summary::-webkit-details-marker{display:none}
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
@media (max-width:900px){.picks .group.small.n4 .pick{flex:1 1 40%}}
@media (max-width:560px){.picks .pick,.picks .pick.target,.picks .group.small.n4 .pick{flex:1 1 100%}}
@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.charts,.two,.io,.versus{grid-template-columns:minmax(0,1fr)}
.stages{grid-auto-columns:minmax(170px,46%)}.qlist{max-height:260px}}
/* THE HEAD OF EVERY CARD, one structure (Memory saved, Evaluate the swarm, Pretrain, Train): the headline figure with what it is, what
   the card does, and its controls, in three columns of the same widths on every card, so that each section lines up with the one
   above it. A card with nothing to press keeps the third column empty */
.memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{display:grid;grid-template-columns:330px minmax(0,1fr) 300px;gap:8px 24px;align-items:center}
.memcard>.proghead>.memnum,.evalp>.proghead>.memnum,.prep>.proghead>.memnum,.trainhead>.proghead>.memnum{min-width:0}
.memcard>.proghead>.progline,.evalp>.proghead>.progline,.prep>.proghead>.progline,.trainhead>.proghead>.progline{min-width:0}
.memcard>.proghead>.evctl,.evalp>.proghead>.evctl,.prep>.proghead>.evctl,.trainhead>.proghead>.evctl{justify-self:end;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
@media (max-width:1100px){.memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{grid-template-columns:minmax(0,1fr) auto}
.memcard>.proghead>.progline,.evalp>.proghead>.progline,.prep>.proghead>.progline,.trainhead>.proghead>.progline{grid-column:1/-1;grid-row:2}}
@media (max-width:760px){.memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{grid-template-columns:minmax(0,1fr)}
.memcard>.proghead>.progline,.evalp>.proghead>.progline,.prep>.proghead>.progline,.trainhead>.proghead>.progline{grid-row:auto}
.memcard>.proghead>.evctl,.evalp>.proghead>.evctl,.prep>.proghead>.evctl,.trainhead>.proghead>.evctl{justify-self:stretch;justify-content:flex-start}}
@media (max-width:560px){.stages{grid-auto-columns:minmax(170px,82%)}.kpis{grid-template-columns:minmax(0,1fr)}main{padding:18px 16px 40px}h1{font-size:27px}.panel{padding:16px;border-radius:var(--r)}}
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
  if(ev.target.id==='run-clear'){const b=ev.target;
    if(!b.classList.contains('sure')){b.classList.add('sure');b.textContent='Clear it? Press again';setTimeout(()=>{if(b.isConnected){b.classList.remove('sure');b.textContent='Clear training state';}},5000);return;}
    b.disabled=true;await swap('/run/clear','#score',{method:'POST',headers:{'x-swarm':'1'}});const kept=$('#score').innerHTML;await swap('/fragment/body','#body');$('#score').innerHTML=kept;return;}
  if(ev.target.id==='run-go'||ev.target.id==='run-stop'){const b=ev.target;b.disabled=true;
    if(b.id==='run-go')document.querySelectorAll('[data-pick]').forEach(x=>x.disabled=true);
    const body='{}';
    await swap(b.id==='run-go'?'/run/start':'/run/stop','#score',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body});watch();return;}
});
// A MODEL CHOSEN: written down, and everything that depends on it drawn again in place
document.addEventListener('change',async(ev)=>{const s=ev.target.closest('[data-pick]');if(!s)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({[s.dataset.pick]:s.value})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/chips','#chips');await swap('/fragment/score','#score');liveTick();}else{alert(await r.text());await swap('/fragment/picks','#picks');}});
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
  $('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/recslot','#rec-slot');await swap('/fragment/chips','#chips');await swap('/fragment/score','#score');$('#recd').close();
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
  const again=b.dataset.used==='1'?' It is part of the swarm as configured: Train fetches it again.':'';
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
// THE SwOA SPEC: what the swarm module as it stands is, in one document
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#spec-open')){await swap('/fragment/spec','#spec-body');$('#spec').showModal();return;}
  if(ev.target.id==='spec-close'||ev.target.id==='spec'){$('#spec').close();return;}
  if(ev.target.id==='spec-publish'){const r=await fetch('/spec/publish',{method:'POST',headers:{'x-swarm':'1'}});if(r.ok){$('#spec-body').innerHTML=await r.text();}else{ev.target.title=await r.text();}return;}
  if(ev.target.id==='spec-save'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('#spec-json').textContent],{type:'application/json'}));a.download=($('#spec-json').dataset.name||'swarm')+'.swoa.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return;}
  if(ev.target.id==='spec-copy'){try{await navigator.clipboard.writeText($('#spec-json').textContent);ev.target.textContent='Copied';}catch(e){ev.target.textContent='Select it below';}}
});
// while a pass runs, its steps are asked for again every few seconds; when it ends the rest of the page is read again once
let timer=null;
function watch(){if(timer)return;timer=setInterval(async()=>{const was=!!$('#score [data-running]');await swap('/fragment/score','#score');
  if(!$('#score [data-running]')){clearInterval(timer);timer=null;if(was){await swap('/fragment/body','#body');await swap('/fragment/picks','#picks');}}
  else{if($('#plan'))await swap('/fragment/plan','#plan');
    await swap('/fragment/chips','#chips');
    if($('#spec').open){const y=$('#spec').scrollTop;await swap('/fragment/spec','#spec-body');$('#spec').scrollTop=y;}}},4000);}
if($('#score [data-running]'))watch();
// WHAT EVERY SLOT IS DOING NOW: asked for every second and a half while a session runs, and written onto the cards in place
const STEP={loop:'Training question by question',measure:'Measuring the swarm',improve:'Trying a brief',arrange:'Trying an arrangement',baseline:'One model alone'};
function paint(el,cls,text){el.className='live '+cls;const sp=el.querySelector('span');if(sp.textContent!==text){sp.textContent=text;el.title=text;}}
// WHEN THE SESSION BEGAN, in the time zone of the person looking, and how long it has run in all: written again every tick
function sinceTick(){document.querySelectorAll('[data-since]').forEach(el=>{const t=Number(el.dataset.since),s=Math.max(0,Math.floor((Date.now()-t)/1000));
  const span=s<60?s+' s':s<3600?Math.floor(s/60)+' min '+s%60+' s':Math.floor(s/3600)+' h '+Math.floor(s%3600/60)+' min';
  const at=new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const atShort=new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  el.querySelector('b').textContent=el.dataset.short?span:'Running '+span;el.querySelector('small').textContent=el.dataset.short?'since '+atShort:'since '+at;});
}
async function liveTick(){
  sinceTick();
  let n={};try{n=await (await fetch('/api/live')).json();}catch(e){return;}
  const now=$('#now');
  if(now){const q=n.question;now.className='now'+(q?' on':'');now.style.display=(q&&n.trainer==='loop'&&$('#qtrack'))?'none':'';
    const nowText=q?(STEP[n.trainer]||'Working')+' · '+(n.who==='swarm'?'the swarm':n.whoName+' alone')+' · '+n.split+' question '+n.n+' of '+n.of+' · '+q.ask.replace(/\\s+/g,' ').slice(0,150)
      :n.running?'A session is running. Between steps: models are loading or unloading.':'Nothing is running. No model is loaded.';
    now.querySelector('span').textContent=nowText;now.title=nowText;}
  // THE SWARM AGAINST EACH QUESTION: the question in hand, its iteration, and a pip for each question so far
  const qn=$('#qnow'),pp=$('#pips'),qh=$('#qhead');
  if(qn&&n.track){const lp=n.loop,q=n.question,tk=n.track,done=tk.done||[],of=(lp&&lp.of)||tk.of||0;
    // (painted again only when what it shows changes: rebuilt on every poll, the block reflowed the page under a reader's thumb)
    const qkey=lp&&q&&n.trainer==='loop'?JSON.stringify([lp.n,lp.attempt,lp.guard||'',lp.guarded||'',lp.move,lp.round,lp.method||'',lp.tried||'',lp.pace||'',lp.trial||'',lp.unstable||'',q.ask]):'';
    if(qkey&&qn.dataset.k===qkey){}
    else if(lp&&q&&n.trainer==='loop'){qn.dataset.k=qkey;
      const it=lp.guard?'checking a change':lp.attempt?'training change '+lp.attempt+(lp.cap?' of '+lp.cap:'')+(lp.round>1?' · round '+lp.round:''):'as it stands';
      const what=lp.guard?'It brought this question to parity; asked again on '+lp.guard+(lp.guarded?' ('+lp.guarded.n+' of '+lp.guarded.of+')':'')+', already at parity, it must lose nothing to be kept: '+lp.move
        :lp.attempt?'Short of parity as the swarm stood. Trying: '+lp.move:'Asked of the swarm as it stands.';
      qn.innerHTML='';const b=document.createElement('span');b.className='it';b.textContent=it;const tq=document.createElement('span');tq.className='qtext';tq.textContent='Question '+lp.n+' of '+lp.of+' · '+q.kind+' · '+q.ask.replace(/\\s+/g,' ');const ql=document.createElement('span');ql.className='ql';ql.append(b,tq);qn.append(ql);
      const sm=document.createElement('small');sm.textContent=what;qn.append(sm);
      // HOW THIS CHANGE WAS CHOSEN (training/loop.mjs method): what it is built on, its round and place, each reason, and what came before
      if(lp.attempt&&lp.method){const md=lp.method,nw=x=>x&&x.parity?'at parity here, but it broke '+x.broke+' when that was asked again':x?'lost in '+x.lost+', '+x.had+' slot'+(x.had===1?'':'s')+' had the answer'+(x.slots&&x.slots.length?' ('+x.slots.join(', ')+')':'')+(x.p!=null?', the decider '+Math.round(x.p*100)+'% on it':'')+(x.share!=null&&!x.had?', the nearest answer '+Math.round(x.share*100)+'% of the way':''):'';
        // FOLDED BY DEFAULT: a line that says where the change stands, opened for the reasons; open or folded stays as the reader left it
        // (on this device, across repaints and reloads)
        const fold=document.createElement('details');fold.className='qmethod';fold.dataset.keep='qmethod';let wasOpen=false;try{wasOpen=localStorage.getItem('swarm.open.qmethod')==='1';}catch(e){}fold.open=wasOpen;
        const sum=document.createElement('summary');const sb=document.createElement('b');sb.textContent='How this change was chosen';const ss=document.createElement('span');
        ss.textContent=' · round '+(lp.round||1)+', change '+md.place+' of '+md.open+(md.reasons&&md.reasons[0]?' · '+md.reasons[0]:'');sum.append(sb,ss);fold.append(sum);
        const box=document.createElement('div');box.className='qmbody';fold.append(box);
        const line=(label,text)=>{const pe=document.createElement('p');const lb=document.createElement('b');lb.textContent=label;pe.append(lb,text);box.append(pe);return pe;};
        line('Built on',lp.on&&lp.on.length?lp.on.join(' + ')+', which came closer: '+nw(md.from):'the arrangement as it stands: '+nw(md.from));
        line('Round '+(lp.round||1)+':','change '+md.place+' of the '+md.open+' open from there ('+md.kind+', in '+md.area+'). One that comes closer is built on in the next round.');
        const pc=lp.pace||{};if(pc.seconds){const left=pc.cap?Math.max(0,Math.min(pc.left,pc.cap-lp.attempt)):pc.left;const mins=Math.round(left*pc.seconds/60);
          line('Pace:','about '+Math.round(pc.seconds)+' s a try'+(left?'; '+left+' more open from here, about '+(mins<1?'a minute':mins+' min')+' if none reaches parity':'')+(lp.reused&&lp.reused.hits?'. '+lp.reused.hits+' slot answers reused unchanged so far, '+Math.round(lp.reused.savedMs/60000)+' min not spent':'')+'.');}
        if(lp.trial&&lp.trial.length)line('Policy on trial:','the search is ranked and bounded by a change the larger model proposed ('+lp.trial.join(', ')+'), kept only if it does at least as well.');
        if(lp.suggest&&lp.suggest.asked){const g=lp.suggest;line('Suggestions:','the larger model was asked what to try '+g.asked+' time'+(g.asked===1?'':'s')+' (about '+Math.round(g.seconds/Math.max(1,g.asked+(g.failed||0)))+' s each); '+g.tried+' tried: '+g.kept+' kept, '+g.closer+' came closer.');}
        if(lp.broke){const bk=Object.entries(lp.broke).sort((a,b)=>b[1]-a[1]);line('Conflict:','changes that brought this question to parity broke '+bk.map(([k,v])=>k+' ('+v+' time'+(v===1?'':'s')+')').join(', ')+'. It is asked first when a change reaches parity, and the search builds on those changes for one that keeps both.');}
        if(lp.unstable)line('Unstable mark:','asked this question again, the larger model did not give its own answer again, so parity here is partly a draw; it is searched until parity all the same.');
        const rs=md.reasons||[];if(rs.length){line('Why it is tried now','');const ul=document.createElement('ul');for(const r of rs){const li=document.createElement('li');li.textContent=r;ul.append(li);}box.append(ul);}
        if(lp.tried&&lp.tried.length){line('Tried on this question before it','');const ol=document.createElement('ol');ol.className='qtried';
          for(const x of lp.tried){const li=document.createElement('li');const k=document.createElement('span');k.className='k'+(x.grade==='right'?' up':x.closer?' cl':'');
            k.textContent=x.grade==='right'?(x.lostOn?'broke one':'parity'):x.closer?'closer':x.grade==='noref'?'no grade':x.library?'found, no':x.suggested?'suggested, no':x.taught?'new brief, no':'no closer';li.append(k,(x.round>1?'round '+x.round+' · ':'')+x.move+(x.lostOn?' · at parity, broke '+x.lostOn:x.near?' · '+nw(x.near):''));ol.append(li);}
          box.append(ol);}
        qn.append(fold);}}
    else if(n.running&&n.trainer!=='loop'){qn.dataset.k='';qn.textContent='Training question by question begins after the larger model has answered and the plan is written.';}
    // THE BOX THE LOOP IS IN NOW, on the system's picture and in the plan's list of steps (the same reading of the live note as the server's loop_phase)
    {const ph=!(lp&&n.trainer==='loop')?'':lp.guard?'guard':!lp.attempt?'ask':(lp.method&&lp.method.area==='library')?'library':(lp.method&&lp.method.area==='suggested')?'suggest':'search';
      document.querySelectorAll('#viz [data-part]').forEach(b=>b.classList.toggle('on',b.dataset.part===ph));}
    if(pp){const key=done.map(x=>x.s).join()+'|'+(lp&&n.trainer==='loop'?lp.n:'');
      if(pp.dataset.k!==key){pp.dataset.k=key;pp.innerHTML='';
        for(const x of done){const i=document.createElement('i');i.className=x.s;i.title=x.id+' · '+(x.w?x.w+' · ':'')+x.kind+(x.tried?' · '+x.tried+' change'+(x.tried===1?'':'s')+' tried':'');pp.append(i);}
        if(lp&&n.trainer==='loop'&&lp.n>done.length){const i=document.createElement('i');i.className='cur';i.title='in hand: question '+lp.n;pp.append(i);}}}
    if(qh&&(done.length||(lp&&n.trainer==='loop'))){const c=s=>done.filter(x=>x.s===s).length;const t=[done.length+' of '+of+' finished',c('at')+' at parity as it stood',c('re')+' brought to parity',c('nr')+' not reached'];
      const k=t.join('|');if(qh.dataset.k!==k){qh.dataset.k=k;qh.innerHTML='<b>Question by question</b>';for(const v of t){const sp=document.createElement('span');sp.textContent=v;qh.append(sp);}}}}
  const slots=n.slots||{},totals=n.totals||{};
  // a slot's clock starts again with every question (a turn). Beside it: which turn this is, and how long this slot has been
  // engaged altogether in the step in hand.
  const secs=ms=>ms<60000?(ms/1000).toFixed(ms<10000?1:0)+' s':Math.floor(ms/60000)+' min '+Math.round(ms%60000/1000)+' s';
  const sofar=(id,extra)=>{const t=totals[id]||totals[id+'-alone'];const ms=(t?t.ms:0)+(extra||0),turns=(t?t.turns:0);
    return {turns,text:turns||extra?' · '+secs(ms)+' in all this step':''};};
  document.querySelectorAll('[data-live]').forEach(el=>{
    const id=el.dataset.live,s=slots[id]||slots[id+'-alone']||(id==='decide'?slots['kev-decide']:undefined);
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

// EVALUATE THE SWARM and PRETRAIN: started and stopped from their own buttons, and followed IN PLACE while they run (the bars, the
// question being asked, how long a question takes, the step a model is on); each section is drawn again only when its run ends
async function evPost(url,into,body){const r=await fetch(url,{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify(body||{})});
  if(!r.ok){alert(await r.text());return;}$(into).innerHTML=await r.text();}
document.addEventListener('click',async(ev)=>{
  const b=ev.target.closest('#ev-go,#ev-stop,#pre-go,#pre-stop');if(!b)return;b.disabled=true;
  if(b.id==='ev-go')await evPost('/eval/start','#evalwrap',{limit:Number(($('#ev-size')||{}).value||0)});
  else if(b.id==='ev-stop')await evPost('/eval/stop','#evalwrap');
  else if(b.id==='pre-go')await evPost('/pretrain/start','#prewrap');
  else await evPost('/pretrain/stop','#prewrap');
  await swap('/fragment/score','#score');});
document.addEventListener('change',async(ev)=>{const c=ev.target.closest('#pre-use');if(!c)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({adapters:c.checked})});
  if(!r.ok){alert(await r.text());c.checked=!c.checked;}});
const EVW={waiting:()=>'waiting',done:s=>s.done+' asked',kept:()=>'answers kept from before',failed:s=>'failed: '+(s.why||''),stopped:s=>'stopped at '+s.done,
  asking:s=>'asking '+Math.min(s.done+1,s.of||s.done+1)+(s.of?' of '+s.of:'')};
const mins=x=>x<90?Math.round(x)+' s':x<5400?Math.round(x/60)+' min':(x/3600).toFixed(1)+' h';
async function evTick(){const box=$('#evalbox');if(!box||!box.dataset.running)return;
  let s;try{s=await (await fetch('/api/eval')).json();}catch(e){return;}
  if(!s.running||(s.runId&&box.dataset.run&&s.runId!==box.dataset.run)){await swap('/fragment/eval','#evalwrap');await swap('/fragment/score','#score');return;}
  const set=(k,t)=>{const el=box.querySelector('[data-ev="'+k+'"]');if(el&&el.textContent!==t)el.textContent=t;};
  set('step',s.step||'');
  const q=box.querySelector('.evq'),n=s.now;
  if(q){q.hidden=!n;if(n){const tn=box.dataset.tname||'';
    set('q',(n.who==='swarm'?'the swarm':(s.target||'the larger model'))+' · '+n.name+' · question '+n.i+(n.of?' of '+n.of:''));
    const on=Math.max(0,(Date.now()-n.since)/1000),left=n.avgSeconds&&n.of?Math.max(0,(n.of-n.i+1)*n.avgSeconds-on):null;
    set('eta','this one '+mins(on)+(n.avgSeconds?' · '+mins(n.avgSeconds)+' a question':'')+(left!==null?' · about '+mins(left)+' left in this task':''));
    set('ask',String(n.ask||'').replace(/\\s+/g,' ').slice(-300));}
    const l=s.last;set('reply',l&&l.seconds!=null?'Last answer ('+Math.round(l.seconds)+' s): '+String(l.reply||'').replace(/\\s+/g,' ').slice(0,240):'');}
  for(const t of s.tasks||[]){const row=box.querySelector('[data-evt="'+t.task+'"]');if(!row)continue;
    for(const who of ['target','swarm']){const w=row.querySelector('[data-w="'+who+'"]'),st=t[who]||{};if(!w)continue;
      const pct=st.of?100*st.done/st.of:(st.state==='done'||st.state==='kept'?100:0);w.className='evw '+(st.state||'waiting');
      w.querySelector('i').style.width=pct.toFixed(1)+'%';const ws=w.querySelector('[data-ws]'),tx=(EVW[st.state]||(()=>''))(st);if(ws.textContent!==tx)ws.textContent=tx;}}}
async function preTick(){const box=$('#prebox');if(!box||!box.dataset.running)return;
  let s;try{s=await (await fetch('/api/pretrain')).json();}catch(e){return;}
  const key=(s.models||[]).map(m=>m.state).join();
  if(!s.running||(box.dataset.k&&box.dataset.k!==key)){box.dataset.k='';await swap('/fragment/pretrain','#prewrap');if(!s.running)await swap('/fragment/score','#score');return;}
  box.dataset.k=key;const st=box.querySelector('[data-pre-step]');if(st&&st.textContent!==s.step)st.textContent=s.step||'';
  for(const m of s.models||[]){const row=box.querySelector('[data-pre="'+m.file+'"]');if(!row)continue;
    if(m.state==='fetching'){const t=row.querySelector('[data-pm]');if(t)t.textContent=t.textContent.replace(/ · [^·]* so far$/,' · '+m.got+' so far');continue;}
    if(m.state!=='training')continue;
    const i=row.querySelector('.evbar i'),t=row.querySelector('[data-pm]'),n=s.iters||100;
    if(i)i.style.width=(100*(m.iter||0)/n).toFixed(1)+'%';
    if(t)t.textContent='Training: step '+(m.iter||0)+' of '+n+(m.loss!=null?' · loss '+m.loss.toFixed(3):' · loading its weights');}}
// WHO HOLDS THE MACHINE: training, an evaluation or pretraining, started or stopped anywhere (this page, another device, a script).
// Each card was drawn again only when its OWN run ended, so a training run stopped left Evaluate and Pretrain saying they wait for it
// until the page was reloaded. When the holder changes, the three cards are drawn again in place
async function busyTick(){const m=$('#busy');if(!m)return;let s;try{s=await (await fetch('/api/busy')).json();}catch(e){return;}
  if(s.busy===m.dataset.busy)return;m.dataset.busy=s.busy;
  await swap('/fragment/eval','#evalwrap');await swap('/fragment/pretrain','#prewrap');await swap('/fragment/score','#score');
  if(s.busy==='training')watch();}
setInterval(()=>{evTick();preTick();busyTick();},1500);
// THE FACES DRAW THE ARRANGEMENT AS IT IS ASKED: while a try runs, the one it asks (the kept arrangement with the change on it); asked
// again whenever the try changes (204 where the page already has it), and left alone while a slot's card is open below them
async function facesTick(){const f=$('#faces');if(!f)return;const open=f.querySelector('#avdetail');if(open&&open.childElementCount)return;
  let r;try{r=await fetch('/fragment/faces?k='+encodeURIComponent(f.dataset.k||''));}catch(e){return;}
  if(r.status!==200)return;const t=await r.text();if(t&&$('#faces'))$('#faces').outerHTML=t;}
setInterval(facesTick,3000);
// THE PAGE KNOWS WHEN THE DASHBOARD'S CODE HAS CHANGED: its own script is the one it was drawn with, and a server restarted onto new
// code cannot change that. It asks which code the server runs, and where it differs says so, with a button; it never reloads itself
const BUILD_ME=(document.querySelector('meta[name="swarm-build"]')||{}).content||'';
async function buildTick(){const n=$('#updnote');if(!n||!BUILD_ME)return;let b;try{b=(await (await fetch('/api/build')).json()).build;}catch(e){return;}
  n.hidden=!b||b===BUILD_ME;}
document.addEventListener('click',(ev)=>{if(ev.target.closest('#upd-go'))location.reload();});
setInterval(buildTick,15000);
// A FLOW TOO LONG FOR ITS CARD WRAPS: the steps sit in one row where they fit, and where they do not (a flow training has grown, a
// narrow window, the inner screen of a folding phone) they wrap as tiles, as on a phone, instead of running past the card's edge.
// Measured, not guessed by width: on load, on a resize or a fold, and whenever part of the page is drawn again
function fitPipes(){document.querySelectorAll('.pipe').forEach(p=>{p.classList.remove('wrapped');if(p.scrollWidth>p.clientWidth+1)p.classList.add('wrapped');});}
let fitQ=0;const fitSoon=()=>{if(fitQ)return;fitQ=requestAnimationFrame(()=>{fitQ=0;fitPipes();});};
addEventListener('resize',fitSoon);new MutationObserver(fitSoon).observe(document.body,{childList:true,subtree:true});fitPipes();
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




def how_far(equivalent, compared):
    """HOW FAR ALONG, SAID ONE WAY wherever it is said: the percentage, then the count it is made of. '59.5% · 25 of 42'.
    The page has many places that say it (the strip, the header, the passes, each kind, each model alone, the spec); they all say
    it with this, from the same two numbers, so no two of them can disagree."""
    return "%s%% · %d of %d" % (fmt_pct(data.percent(equivalent, compared)), equivalent, compared)


def fmt_pct(x):
    """A percentage as it is said: 63, 62.5, and 100 only when it is 100."""
    return ("%d" % x) if float(x) == int(x) else ("%.1f" % x)






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
            '<p class="muted small" style="margin:8px 0 10px">Every move open to this pass. A queued move is tried first on each question that is not at parity, and kept only on evidence.</p>'
            '<input type="search" id="steer-find" placeholder="Find a move: decider, revise, a-critic, temperature..." aria-label="Find a move">%s' % "".join(groups))


LOOP_STATE = {"at parity": ("At parity as it stood", "up"), "reached": ("Brought to parity", "up"), "not reached": ("Not reached", "down"), "not compared": ("Not compared", "planned"),
              "reopened": ("Back in hand", "planned"), "set aside": ("Set aside", "planned"),
              "mark wrong": ("Set aside: the larger model's answer is wrong", "planned")}


def near_words(n):
    """How close a reply came, in words (training/loop.mjs nearOf): where the answer was lost, how many slots had it, the decider's
    probability on it."""
    if not n:
        return ""
    if n.get("parity"):
        return "at parity here, but it broke %s when that was asked again" % n.get("broke", "a question")
    return "lost in %s, %d slot%s had the answer%s%s" % (n.get("lost", ""), n.get("had", 0), "" if n.get("had") == 1 else "s",
                                                        (" (%s)" % ", ".join(n["slots"])) if n.get("slots") else "",
                                                        (", the decider %d%% on it" % round(n["p"] * 100)) if n.get("p") is not None else "") + (
        (", the nearest answer %d%% of the way" % round(n["share"] * 100)) if n.get("share") is not None and not n.get("had") else "")


def method_line(a):
    """Why a change was tried where it was, and how close it came: the loop's method, recorded with the change."""
    md = a.get("method") or {}
    if not md:
        return ""
    bits = ["round %d, %d of %d open" % (a.get("round") or 1, md.get("place", 0), md.get("open", 0))] + list(md.get("reasons") or [])
    out = ('<span class="why">why: %s</span>' % e("; ".join(bits)))
    if a.get("seconds"):
        out += '<span class="why">%s s a run%s</span>' % (e(str(a["seconds"])), (" (%s%s s against what it was tried on)" % ("+" if a["added"] >= 0 else "", e(str(a["added"])))) if a.get("added") is not None else "")
    if a.get("near"):
        out += '<span class="why">came out: %s (before it: %s)</span>' % (e(near_words(a["near"])), e(near_words(md.get("from"))))
    elif (md.get("from") or {}).get("parity"):
        out += '<span class="why">built on: %s</span>' % e(near_words(md["from"]))
    return out


def tries_list(lp):
    """Each question of the loop's record that needed a change, newest first, with where its answer was lost and what was tried on
    it in order: what did nothing, what reached parity there but lost a question already at parity, and what was kept."""
    rows = []
    for q in [x for x in (lp or {}).get("list", []) if len(x.get("attempts", [])) > 1][::-1][:40]:
        word, cls = LOOP_STATE.get(q.get("state"), (q.get("state", ""), "planned"))
        tries = "".join(
            '<li><span class="k %s">%s</span><span class="tx">%s%s</span></li>' % (
                "up" if a.get("kept") else "", "kept" if a.get("kept") else "parity here" if a.get("grade") == "right" else "no",
                e(a.get("move", "")),
                ((" · lost <code>%s</code>, already at parity" % e(a["lostOn"])) if a.get("lostOn") else
                 (" · %d already at parity asked again, none lost" % a["guard"]["asked"]) if a.get("kept") and (a.get("guard") or {}).get("asked") else "")
                + (" · came closer: the next round builds on it" if a.get("closer") or a.get("builtOn") else "") + ((" · on top of " + e(" + ".join(a["on"]))) if a.get("on") else "")
                + method_line(a))
            for a in q["attempts"][1:])
        rounds = (" in %d rounds" % q["rounds"]) if (q.get("rounds") or 1) > 1 else ""
        why = (" · beyond rearranging after %s tries" % q["beyond"].get("at") if q.get("beyond") else "") + (" · broke " + ", ".join("%s %d×" % (k, v) for k, v in sorted(q["broke"].items(), key=lambda kv: -kv[1])) if q.get("broke") else "") + (" · every combination within reach tried" if q.get("exhausted") else "") + ((" · widened %d×" % q["widened"]) if q.get("widened") else "") + ((" · lost to %s, back in hand" % q["lostTo"]) if q.get("lostTo") else "") + ((" · set aside %d× (it stopped coming closer while other questions waited)" % q["setAside"]) if q.get("setAside") else (" · set aside: it stopped coming closer, and comes back after the others" if q.get("state") == "set aside" else "")) + ((" · carried on from its last try after a stop") if q.get("carried") else "") + ((" · given up on its last chance: %s more tries brought it nothing closer" % q["gaveUp"].get("after")) if q.get("gaveUp") else "") + (" · unstable mark: the larger model did not give its own answer again (searched until parity all the same)" if q.get("unstable") else "") + ((" · the larger model's answer does not do what the question asks%s: set aside, not searched, and not a question a change must not lose" % ((" (on %s it gives %s, the question wants %s)" % (json.dumps((q["markWrong"].get("input") or [""])[0]), q["markWrong"].get("theirs"), q["markWrong"].get("wanted"))) if (q.get("markWrong") or {}).get("input") is not None else "")) if q.get("markWrong") else "")
        rows.append('<li class="lq"><details><summary><code>%s</code> <span class="muted small">%s · lost in %s · %d tried%s%s</span> <span class="pill %s">%s</span></summary><ol class="tries">%s</ol></details></li>'
                    % (e(q["id"]), e(q.get("kind", "")), e(q.get("lostAt", "")), len(q["attempts"]) - 1, rounds, why, cls, e(word), tries))
    # WHAT HAS WORKED, BY KIND OF CHANGE: learned question after question, and what orders the changes tried on the next
    cl = sorted(((k, v) for k, v in ((lp or {}).get("classes") or {}).items() if v.get("tried")), key=lambda kv: (-(kv[1].get("reached", 0) + 1) / (kv[1]["tried"] + 2), -kv[1]["tried"]))
    learned = ('<p class="small qlearn"><b>What has reached parity, by kind of change:</b> %s. The kinds that reach it more often are tried sooner.</p>'
               % e("; ".join("%s %d of %d" % (k, v.get("reached", 0), v["tried"]) for k, v in cl))) if cl else ""
    if not rows:
        return learned
    return ('<details class="qtries"><summary>What was tried on each question that needed a change (%d)</summary>%s<ul class="moves loopq">%s</ul></details>' % (len(rows), learned, "".join(rows)))


def loop_phase(lv):
    """Where the question in hand is in the loop, from the live note: ask (as the swarm stands), library (the found arrangements),
    search (best first), suggest (the larger model's suggestions), guard (checked on questions already at parity), or ''."""
    if not lv:
        return ""
    if lv.get("guard"):
        return "guard"
    if not lv.get("attempt"):
        return "ask"
    area = (lv.get("method") or {}).get("area")
    return "library" if area == "library" else "suggest" if area == "suggested" else "search"


PHASE_WORDS = {"ask": "asked of the swarm as it stands", "library": "trying the found arrangements", "search": "searching, best first",
               "suggest": "trying what the larger model suggested", "guard": "checking a change on the questions already at parity"}


def plan_now(d):
    """WHAT IS HAPPENING NOW, from the loop itself (not from the plan's list, which the search only draws from): the question in hand
    and where it is in the loop, this pass so far, the found arrangements, the policy and the larger model's part."""
    lp = d.get("loop") or {}
    lv = loop_live()
    qs = lp.get("list") or []
    st_ = lambda s: sum(1 for q in qs if q.get("state") == s)  # noqa: E731
    tries = lp.get("tries") or sum(max(0, len(q.get("attempts") or []) - 1) for q in qs)
    ch = lp.get("changes") or []
    from_lib = sum(1 for c in ch if c.get("kind") == "library")
    swaps = sum(1 for c in ch if c.get("swapped"))
    sg = lp.get("suggest") or {}
    lib = library_of(d)
    lpo = loop_policy_of(d)
    pol = {"reviewTries": 40, "trialTries": 40, "suggestEvery": 20, "teachEvery": 60, **(lpo.get("loopPolicy") or {})}
    tr = lp.get("trial")
    phase = loop_phase(lv)
    of = (lv or {}).get("of") or lp.get("of") or 0
    rows = []
    if lv:
        rows.append(("Now", "Question <b>%s</b> of %s is in hand: %s%s." % (e(str(lv.get("n", "?"))), e(str(of)), e(PHASE_WORDS.get(phase, "")),
                     (", change %s%s" % (e(str(lv["attempt"])), (" · round %s" % e(str(lv["round"]))) if (lv.get("round") or 1) > 1 else "")) if lv.get("attempt") else "")))
    else:
        rows.append(("Now", "Not running." + (" It stopped with %d of %d questions finished." % (len([q for q in qs if q.get("state") not in ("reopened", "set aside")]), of) if qs else "")))
    if qs:
        back = st_("reopened") + st_("set aside")
        rows.append(("This pass", "%d of %d questions finished: <b>%d</b> at parity as the swarm stood, <b>%d</b> brought to parity%s%s. %d changes tried; <b>%d</b> kept "
                     "(%d of them found arrangements, %d suggested by the larger model%s)."
                     % (len(qs) - back, of, st_("at parity"), st_("reached"), (", %d not reached" % st_("not reached")) if st_("not reached") else "",
                        ((", %d back in hand after a swap" % st_("reopened")) if st_("reopened") else "") + ((", %d set aside until the others are done" % st_("set aside")) if st_("set aside") else ""), tries, len(ch), from_lib, sg.get("kept", 0), (", %d swap%s" % (swaps, "" if swaps == 1 else "s")) if swaps else "")))
    rows.append(("Found arrangements", ("<b>%d</b>, tried first on every question short of parity; the most successful has brought %d question%s to parity."
                                        % (len(lib), max(len(x.get("reached") or []) for x in lib), "" if max(len(x.get("reached") or []) for x in lib) == 1 else "s")) if lib
                 else "None yet: the first arrangement kept starts the library."))
    if tr:
        # (a trial recorded before trials were counted in tries was counted in questions: the record says which, and the page says it)
        unit = tr.get("unit") or "questions"
        rows.append(("The policy", "On trial: %s · %s of %s %s done. Kept only if those %s come to at least as much as as many before."
                     % (e("; ".join("%s %s → %s" % (x["knob"], json.dumps(x["from"]), json.dumps(x["to"])) for x in tr.get("taken", []))), e(str(tr.get("done", 0))), e(str(tr.get("of", pol["trialTries"]))), unit, unit)))
    else:
        nxt = max(0, pol["reviewTries"] - (tries - (lp.get("reviewedAtTry") or 0))) if lp else pol["reviewTries"]
        last = next((x for x in (lpo.get("policyLog") or [])[::-1] if x.get("event")), None)
        rows.append(("The policy", "Nothing on trial. The larger model reviews it in about %d more tries%s." % (nxt, (" (last: %s)" % e(POLICY_EVENT.get(last["event"], (last["event"],))[0])) if last else "")))
    rows.append(("Suggestions", ("Asked %d time%s, about %d s each; %d tried: %d kept, %d came closer. Next after %d failed tries on a question."
                                 % (sg.get("asked", 0), "" if sg.get("asked") == 1 else "s", round(sg.get("seconds", 0) / max(1, sg.get("asked", 0) + sg.get("failed", 0))), sg.get("tried", 0), sg.get("kept", 0), sg.get("closer", 0), pol["suggestEvery"]))
                 if sg.get("asked") else "None yet: the larger model is asked what to try after %d failed tries on a question." % pol["suggestEvery"]))
    # BEYOND REARRANGING (training/adapters.mjs): a question that resisted so many tries, the larger model's teaching among them; what
    # was made ready for the next lever, and whether each small model can be trained on this machine
    for q in [x for x in qs if x.get("beyond")][-2:]:
        b = q["beyond"]
        r = b.get("ready") or {}
        tr_ = "; ".join("%s %s" % (x.get("model", ""), "can be trained here with MLX" if x.get("ok") else "cannot: " + x.get("why", "")) for x in r.get("trainable") or [])
        rows.append(("Beyond rearranging", "<code>%s</code> after %s tries, the larger model&#39;s briefs among them: it stays in hand. Ready for a fine-tuned adapter: %s train answers%s."
                     % (e(q.get("id", "")), e(str(b.get("at", "?"))), e(str(r.get("examples", "?"))), (" · " + e(tr_)) if tr_ else "")))
    tc = lp.get("teach") or {}
    if tc.get("asked") or tc.get("failed"):
        rows.append(("Briefs written", "The larger model said what went wrong and wrote new briefs %d time%s (about %d s each), for the drafters nearest the answer first: %d briefs, %d tried, %d kept, %d came closer%s."
                     % (tc.get("asked", 0), "" if tc.get("asked") == 1 else "s", round(tc.get("seconds", 0) / max(1, tc.get("asked", 0) + tc.get("failed", 0))), tc.get("briefs", 0), tc.get("tried", 0), tc.get("kept", 0), tc.get("closer", 0),
                        (", %d refused for giving a question away (code, or the name of the function asked for)" % tc["refused"]) if tc.get("refused") else "")))
    steps = [("ask", "Ask the swarm as it stands"), ("library", "Try the found arrangements, the most successful first"),
             ("search", "Search, best first: the plan's moves in the policy's order, building on what came closer; widen, never move on"),
             ("suggest", "Every %d failed tries, try what the larger model suggests; where no slot drafts the answer, every %d, the briefs it writes for the failing drafters" % (pol["suggestEvery"], pol.get("teachEvery", 60))),
             ("guard", "At parity: ask it again on up to %s questions already at parity" % e(str(((d.get("policy") or {}).get("loop") or {}).get("guard", 6)))),
             ("keep", "None lost: keep it, add it to the found arrangements, next question")]
    flow = "".join('<li%s><span>%s</span></li>' % (' class="on"' if k == phase else "", e(t)) for k, t in steps)
    return ('<div class="plannow"><table class="spec kv">%s</table><p class="small" style="margin:10px 0 4px"><b>Each question, in order</b> (the step it is on is marked):</p>'
            '<ol class="qsteps">%s</ol></div>' % ("".join("<tr><th>%s</th><td>%s</td></tr>" % (e(k), v) for k, v in rows), flow))


def viz_block(d):
    """VISUALIZING THE SYSTEM: every part of training as a coded box (A1, B3 ...) a person can name when talking about it, in the order
    things happen. The box the loop is in now is marked, live (the page's poll; data-part names the step)."""
    lpo = loop_policy_of(d)
    pol = {"reviewTries": 40, "trialTries": 40, "suggestEvery": 20, "swapAfter": 25, "stableAfter": 6, "stableMax": 2, **(lpo.get("loopPolicy") or {})}
    lib = len(library_of(d))
    guard = ((d.get("policy") or {}).get("loop") or {}).get("guard", 6)
    tname = (d.get("target") or {}).get("name", "the larger model")
    dname = (d.get("decider") or {}).get("name", "the decider")
    box = lambda code, part, title, body: ('<div class="vbox"%s><b><span class="vcode">%s</span>%s</b><small>%s</small></div>'  # noqa: E731
                                           % ((' data-part="%s"' % part) if part else "", code, e(title), e(body)))
    arrow = '<span class="varr" aria-hidden="true"></span>'
    lane = lambda key, title, boxes, foot="": ('<div class="vlane"><div class="vhead"><span class="vkey">%s</span><b>%s</b></div><div class="vrow">%s</div>%s</div>'  # noqa: E731
                                               % (key, e(title), arrow.join(boxes), ('<p class="vfoot">%s</p>' % foot) if foot else ""))
    return ('<div class="panel viz"><p class="vintro">Every part of training, coded so it can be named (B3, D2). Lanes run top to bottom; '
            "steps run in the order of the arrows. The marked box is where the loop is now.</p>%s%s%s%s%s</div>" % (
                lane("A", "Once a pass", [
                    box("A1", "", "Questions", "Train questions are trained on; held questions are only checked."),
                    box("A2", "", "The mark", "%s answers each question once. Parity means an equivalent answer." % tname),
                    box("A3", "", "The plan", "The moves the search draws its changes from.")]),
                lane("B", "Each question, until it is at parity", [
                    box("B1", "ask", "Ask", "The swarm as it stands."),
                    box("B2", "library", "Found arrangements", "%d, the most successful first." % lib),
                    box("B3", "search", "Search", "Best first: builds on what came closer, widens when all are tried."),
                    box("B4", "suggest", "Suggestions", "Every %s failed tries, %s names changes to try." % (pol["suggestEvery"], tname)),
                    box("B5", "guard", "Check", "Asked again on up to %s questions already at parity." % guard),
                    box("B6", "keep", "Keep", "Into the arrangement, the found arrangements and the spec.")],
                     "Short of parity: back to B3; it never moves on. Loses a question at B5: built on, aimed at that question, and swapped after %s." % e(swap_words(pol))),
                lane("C", "Inside one try", [
                    box("C1", "", "Draft", "Each slot answers its own way."),
                    box("C2", "", "Try", "Code runs in a sandbox; drafts that behave alike are one answer."),
                    box("C3", "", "Check, revise", "Checkers find faults; answers are revised."),
                    box("C4", "", "Decide", "%s picks the answer." % dname),
                    box("C5", "", "Write", "The reply."),
                    box("C6", "", "Grade", "Equivalent to the mark? Partial credit says how close.")]),
                lane("D", "Always: how the search improves", [
                    box("D1", "", "Policy", "The settings the search runs by."),
                    box("D2", "review", "Review", "Every %s tries, %s proposes a change." % (pol["reviewTries"], tname)),
                    box("D3", "", "Trial", "%s tries; kept only if no worse." % pol["trialTries"])]),
                lane("E", "At the end of a pass", [
                    box("E1", "", "Held questions", "Does what was learned hold beyond the train questions?"),
                    box("E2", "", "The spec", "Every win, cumulative; published at parity.")])))


def plan_block(d):
    """What the plan part of the page holds: the plan the loop tries from (the questions themselves are on the swarm's card)."""
    return plan_panel(d)


RANK_WORDS = {"pin": "pinned", "evidence": "the question's record", "momentum": "like a kept change", "learned": "what has worked",
              "area": "area for the loss", "cost": "cheaper", "fresh": "tried least", "plan": "the plan's order"}
POLICY_EVENT = {"on trial": ("on trial", "planned"), "kept": ("kept", "up"), "put back": ("put back", "down"), "nothing proposed": ("no proposal", "planned"),
                "no review": ("no review", "planned")}


def library_of(d):
    """The found arrangements (training/loop.mjs: .work/library/<configuration>.json, kept by Clear training state)."""
    try:
        return (json.loads((Path(d["root"]) / ".work" / "library" / ((d.get("key") or "") + ".json")).read_text()) or {}).get("arrangements") or []
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return []


def library_block(d):
    """THE FOUND ARRANGEMENTS: every arrangement that brought a question to parity and lost none already there, tried first on every
    question, the most successful first; how many questions each has brought to parity and how often it was tried."""
    lib = library_of(d)
    if not lib:
        return ('<h4>Found arrangements</h4><p class="small muted" style="margin:0">None yet. Every arrangement that brings a question to parity and '
                "loses none already there is kept here, across passes and Clear training state, and tried first on every question after.</p>")
    rows = "".join('<li><span class="pill up">%d</span> <span class="small"><b>%s</b> · found on <code>%s</code>%s</span></li>'
                   % (len(x.get("reached") or []), e(x.get("what", "")), e(str((x.get("from") or {}).get("question", ""))),
                      (" · tried %d time%s since" % (x["tried"], "" if x["tried"] == 1 else "s")) if x.get("tried") else "")
                   for x in sorted(lib, key=lambda x: -len(x.get("reached") or [])))
    return ('<h4>Found arrangements (%d)</h4><p class="small" style="margin:0 0 6px">Tried first on every question short of parity, the most successful '
            "first (the number: questions each has brought to parity). Kept across passes and Clear training state; every keep adds to it.</p>"
            '<ul class="plist">%s</ul>' % (len(lib), rows))


def loop_policy_of(d):
    """The loop's policy for the page: the last finished question's record of it, or, where none says it yet (a pass whose first
    question is still in hand, a long question since the last), the policy file the loop writes as it goes
    (.work/library/<configuration>-policy.json, kept by Clear training state; read from its old place before it moved), with its log."""
    lp = dict(d.get("loop") or {})
    try:
        lib = Path(d["root"]) / ".work" / "library" / ((d.get("key") or "") + "-policy.json")
        f = json.loads((lib if lib.exists() else Path(d["root"]) / ".work" / "train" / (d.get("key") or "") / "loop-policy.json").read_text())
    except (OSError, ValueError, KeyError, TypeError):
        f = None
    if isinstance(f, dict) and f.get("policy"):
        # the file is the newer of the two: the loop writes it on every change of the policy, the record only when a question ends
        lp["loopPolicy"] = f["policy"]
        lp["policyLog"] = (f.get("log") or [])[-30:]
    return lp


def swap_words(pol):
    """When a standing conflict is swapped, in words: stableAfter losses where the questions lost are the same few (stableMax at most),
    swapAfter losses of one question otherwise."""
    st_, sw = int(pol.get("stableAfter") or 0), int(pol.get("swapAfter") or 0)
    mx = int(pol.get("stableMax") or 2)
    few = "it is the only question lost" if mx == 1 else "the questions lost are the same %d or fewer" % mx
    if st_ and sw and st_ < sw:
        return "%d losses where %s, %d otherwise" % (st_, few, sw)
    n = min(x for x in (st_, sw) if x) if (st_ or sw) else 0
    return ("%d losses" % n) if n else "never"


def policy_block(lp):
    """THE LOOP'S OWN POLICY (training/loop-policy.mjs): how its search ranks and bounds what it tries, as it has evolved; what the larger
    model proposed and what became of each proposal; and what is on trial now."""
    lp = lp or {}
    pol = lp.get("loopPolicy")
    # (a policy written before a setting existed takes that setting's default, as the loop does: training/loop-policy.mjs normal)
    if pol:
        pol = {"reviewTries": 40, "trialTries": 40, "swapAfter": 25, "stableAfter": 6, "stableMax": 2, "brokeBudget": 12, "suggestEvery": 20, "teachEvery": 60, "prune": True, "setAsideAfter": 30, "helpBackoff": True, "kindBranch": True, **pol}
    if not pol:
        return ('<h4>The loop&#39;s policy</h4><p class="small muted" style="margin:0">How the search ranks and bounds what it tries is data that '
                "changes as it runs. A pass that runs this version writes it here: the larger model reviews the record every few questions "
                "that needed a change, and a change it proposes is tried before it is kept.</p>")
    knobs = "; ".join(x for x in [
        "ranked by " + " → ".join(RANK_WORDS.get(k, k) for k in pol.get("order", [])),
        "%d changes from the closest before looking again" % pol.get("batch", 0) if pol.get("batch") else "every change from the closest before looking again",
        "%d closer arrangements open" % pol.get("beam", 3),
        "momentum from the last %d kept" % pol.get("momentumRecent", 0) if pol.get("momentumRecent") else "no momentum",
        "a kind counts after %d tries" % pol.get("learnedMinTried", 3),
        "partial credit " + ("on, by the nearest answer and then by all of them" if pol.get("partialCredit") else "off"),
        "writer left out unless lost in writing" if pol.get("skipWriterUnlessWriting") else "writer always open",
        ("a standing conflict swapped after " + swap_words(pol)) if (pol.get("swapAfter") or pol.get("stableAfter")) else "no swaps",
        "the larger model suggests what to try after %d failed tries" % pol.get("suggestEvery", 20) if pol.get("suggestEvery") else "no suggestions",
        "writes briefs for a drafting loss after %d" % pol.get("teachEvery", 60) if pol.get("teachEvery") else "no briefs written",
        "each half as often where it brought a question nothing" if pol.get("helpBackoff") and (pol.get("suggestEvery") or pol.get("teachEvery")) else "",
        ("a question set aside after %d tries in a row with nothing closer, while others wait" % pol["setAsideAfter"]) if pol.get("setAsideAfter") else "no question set aside",
        "a change that loses only the other kind (code, or words) kept for its own kind" if pol.get("kindBranch") else "one arrangement for every kind",
        "a win pruned to its smallest form" if pol.get("prune", True) else "wins kept whole",
    ] if x)
    out = ['<h4>The loop&#39;s policy</h4><p class="small" style="margin:0 0 6px">How the search ranks and bounds what it tries is data, and it changes '
           "as training runs: every <b>%s</b> tries the larger model is shown the record and may propose a change to one or two knobs; it is tried "
           "on the next <b>%s</b> tries and kept only where they came to at least as much as as many before (kept 10, at parity but losing one 3, closer 1). "
           "The policy and the found arrangements are kept by Clear training state. Now: %s.</p>" % (e(str(pol.get("reviewTries", 40))), e(str(pol.get("trialTries", 80))), e(knobs))]
    sg = lp.get("suggest")
    if sg and (sg.get("asked") or sg.get("failed")):
        out.append('<p class="small" style="margin:0 0 6px"><b>Suggestions of the larger model:</b> asked %d time%s (about %s s each%s); %d tried: %d kept, %d came closer.%s</p>'
                   % (sg.get("asked", 0), "" if sg.get("asked") == 1 else "s", e(str(round(sg.get("seconds", 0) / max(1, sg.get("asked", 0) + sg.get("failed", 0))))),
                      (", %d could not be asked" % sg["failed"]) if sg.get("failed") else "", sg.get("tried", 0), sg.get("kept", 0), sg.get("closer", 0),
                      (" The last: %s." % e("; ".join("%s (%s)" % (pk, c) for pk, c in zip((lp.get("suggestLog") or [{}])[-1].get("picks", []), (lp.get("suggestLog") or [{}])[-1].get("came", []))))) if (lp.get("suggestLog") or []) and (lp.get("suggestLog") or [{}])[-1].get("came") else ""))
    tr = lp.get("trial")
    if tr:
        out.append('<p class="small" style="margin:0 0 6px"><b>On trial:</b> %s · %d of %d %s</p>'
                   % (e("; ".join("%s %s → %s (%s)" % (x["knob"], json.dumps(x["from"]), json.dumps(x["to"]), x.get("why", "")) for x in tr.get("taken", []))),
                      tr.get("done", 0), tr.get("of", 0), tr.get("unit") or "questions"))
    rows = []
    for ev in (lp.get("policyLog") or [])[::-1][:8]:
        word, cls = POLICY_EVENT.get(ev.get("event"), (ev.get("event", ""), "planned"))
        bits = []
        if ev.get("taken"):
            bits.append("; ".join("%s %s → %s" % (x["knob"], json.dumps(x["from"]), json.dumps(x["to"])) for x in ev["taken"]))
        v = ev.get("verdict")
        if v and v.get("inconclusive"):
            bits.append("no signal: nothing came closer, before or during, so nothing to judge it by")
        elif v:
            bits.append("%s against %s before (kept %d of %d tries, against %d of %d)" % (v.get("during"), v.get("before") if v.get("before") is not None else "nothing",
                                                                                         v.get("keptDuring", v.get("reachedDuring", 0)), v.get("duringN", 0), v.get("keptBefore", v.get("reachedBefore", 0)), v.get("beforeN", 0)))
        if ev.get("why"):
            bits.append(ev["why"])
        if ev.get("ideas"):
            bits.append("ideas that need code: " + " | ".join(ev["ideas"]))
        rows.append('<li><span class="pill %s">%s</span> <span class="small">%s</span></li>' % (cls, e(word), e(" · ".join(bits) or "")))
    if rows:
        out.append('<ul class="plist">%s</ul>' % "".join(rows))
    return "".join(out)


def plan_panel(d):
    """THE STRATEGY BEING EXECUTED: what this pass found, what it chose to try because of it, in order, and what became of each."""
    p = read_plan(d)
    n = d["state"].get("pass", 0) + 1
    if not p:
        return (
            '<div class="panel plan"><div class="plan-head"><h3>The plan for pass %d</h3><span class="muted small">Not written yet</span></div>'
            '<p class="muted" style="margin:8px 0 0">A pass writes its plan when it begins, from what the last pass left: '
            "where the answers were lost decides what is listed first. Training then tries from it, question by question.</p></div>" % n
        )
    moves = p.get("moves") or []
    done = [m for m in moves if m.get("status") in ("kept", "not kept")]
    kept = [m for m in moves if m.get("status") == "kept"]
    based = {"this-pass": "From this pass's measurement of the swarm on its train questions", "last-pass": "From what the last pass measured on its train questions",
             "nothing": "Nothing is measured yet, so the checkers come first and one arrangement of each kind"}.get(p.get("basedOn"), "")
    lpq = d.get("loop") or {}
    lq = lpq.get("list") or []
    out = ['<div class="panel plan"><div class="plan-head"><h3>Pass %d, question by question</h3><span class="muted small">%d questions finished · %d changes tried · %d kept</span></div>'
           % (n, len([q for q in lq if q.get("state") not in ("reopened", "set aside")]), lpq.get("tries") or sum(max(0, len(q.get("attempts") or []) - 1) for q in lq), len(lpq.get("changes") or [])),
           plan_now(d),
           '<p class="muted small" style="margin:12px 0 0">The plan below is what the search draws from: %d moves.%s</p>' % (len(moves), (" " + e(based) + ".") if based else "")]
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
                           % (e(r["decider"]), r.get("theirsRight", 0), r.get("asked", 0), r.get("nowRight", r.get("kevRight", 0)), r.get("recovered", 0), r.get("lost", 0)))
    # HOW IT IS TRAINING: the loop's own limits, and what the plan lists first (training/policy.json, and this configuration's own)
    pol = d.get("policy") or {}
    lpol, ppol = pol.get("loop") or {}, pol.get("plan") or {}
    cap_, drop_ = lpol.get("cap"), lpol.get("drop")
    out.append('<h4>How it is training</h4><p class="small" style="margin:0">A question stays in hand until it is at parity: it never moves on before%s. The arrangements found so far are tried on it first, the most successful first. Then changes are tried best first: from the closest arrangement open, and a change that comes closer is built on at once, with up to <b>%s</b> such arrangements open at a time; where every arrangement open has been tried, the search widens and builds on every arrangement it tried. '
               "A change that brings it to parity is asked again on <b>%s</b> questions already there, and is kept only if none is lost.%s "
               "Where changes that bring it to parity lose a question already at parity, what is built on them is aimed at that question; where they keep losing it (%s), one that loses only that one is kept and that question goes back in hand. "
               "A slot asked exactly what it was asked before answers as it did, without being asked again, so a try that changes one slot asks only what changed. The plan lists <b>%s</b> arrangements one change from here first, and <b>%s</b> that are %s changes from here at once.</p>"
               % ((" (or after <b>%s</b> changes, a bound a person set)" % e(str(cap_))) if cap_ else "", e(str(lpol.get("beam", 3))), e(str(lpol.get("guard", 6))),
                  (" A change tried on <b>%s</b> questions that brought none to parity is dropped." % e(str(drop_))) if drop_ else "", e(swap_words({"swapAfter": 25, "stableAfter": 6, "stableMax": 2, **(loop_policy_of(d).get("loopPolicy") or {})})),
                  e(str(ppol.get("arrangements", "?"))), e(str(ppol.get("wild", 0))), e(str(ppol.get("depth", 2)))))
    out.append(policy_block(loop_policy_of(d)))
    out.append(library_block(d))
    out.append(steer_section(d, p))
    sv = read_steer(d)
    out.append('<h4>Moves, in plan order</h4><p class="muted small" style="margin:0 0 6px">What the search draws its changes from. The loop tries them '
               "in the policy&#39;s order for the question in hand, not this order, and combines them; the counts at the top of this section are the loop&#39;s.</p>")
    if not moves:
        out.append('<p class="muted small" style="margin:0">Nothing is left to try from here: every candidate and every arrangement one step away has been tried and dropped.</p>')
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
        elif r and r.get("questions"):
            res = "<small><b style=\"display:inline;font-size:inherit\">Tried:</b> %s.</small>" % e(str(r.get("why", "")).capitalize())
        mid = x.get("id", "")
        pinned, skipped = mid in sv["pin"], mid in sv["skip"]
        acts = ""
        if st == "planned" and mid and STEER_ID.match(mid):
            acts = '<span class="acts">%s%s</span>' % (
                '<button type="button" data-steer="unpin" data-id="%s">Unqueue</button>' % e(mid) if pinned else '<button type="button" data-steer="pin" data-id="%s" title="Try it first on each question that is not at parity">Next</button>' % e(mid),
                '<button type="button" data-steer="unskip" data-id="%s">Unskip</button>' % e(mid) if skipped else '<button type="button" data-steer="skip" data-id="%s" title="Never try it">Skip</button>' % e(mid))
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
        out.append('<p class="muted small" style="margin:12px 0 0">%d arrangements one step from this one are open, %d have been tried and dropped. A move is kept only if it brings a question to parity and loses none already there.</p>'
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
        bits += ["%s: %d against %d" % (r["decider"], r.get("theirsRight", 0), r.get("nowRight", r.get("kevRight", 0))) for r in rep.get("results") or []]
    if bits:
        meta["what-only-you-can-change"] = " · ".join(bits)
    meta["how-it-is-training"] = "until parity, best first, building on the %s closest · asked again on %s before a keep" % (lpol.get("beam", 3), lpol.get("guard", 6))
    fl = {k: v for k, v in sv["focus"].items() if v}
    meta["steer-it"] = " · ".join([", ".join("%s %s" % (dict((a, nm) for a, nm, _ in STEER_AREAS).get(k, k), v) for k, v in fl.items()) or "as planned"]
                                   + ["%d queued" % len(sv["pin"])] * bool(sv["pin"]) + ["%d skipped" % len(sv["skip"])] * bool(sv["skip"]) + ["nothing queued"] * (not sv["pin"]))
    running = [x for x in moves if x.get("status") == "running"]
    # (tried and kept by the loop, which takes its changes from these moves: the plan's own marks say little once training goes question by question)
    lmv = {x.get("id"): x for x in ((d.get("loop") or {}).get("moves") or [])}
    done = [x for x in moves if (lmv.get(x.get("id")) or {}).get("tried")] or done
    kept = [x for x in moves if (lmv.get(x.get("id")) or {}).get("kept")] or kept
    meta["moves-in-plan-order"] = "%d move%s · %d tried by the loop · %d kept%s" % (len(moves), "" if len(moves) == 1 else "s", len(done), len(kept),
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


def decider_card(d, row=None, nth=0, purpose="Decides which answer stands"):
    """The decision model: the only decider (src/decider.mjs). nth: which of its decisions on that input."""
    if row is None:
        return card("decider", (d.get("decider") or {}).get("name", "The decider"), purpose, "decide", ["<span>decide</span>", "<span>a decision model</span>"], "",
                    '<div class="body">One request, no writing: it is given the question, one worked answer for each different answer and what the checkers said, '
                    "and returns a probability for each answer. No slot judges, unless the plan puts a model beside it. If the decider is not running, the answer most slots gave stands.</div>")
    turns = [x for x in row.get("trace", []) if x["slot"] == "decide" and x.get("of") != "replies"]
    t = turns[nth] if nth < len(turns) else None
    if not t:
        return card("decider", (d.get("decider") or {}).get("name", "The decider"), purpose, "decide", ["<span>decide</span>", "<span>not asked on this input</span>"], "", "", live=False)
    fin = ""
    if t.get("final"):
        ok = mark_of(t, row)
        fin = final_chip(t["final"], ok)
    bars = "".join('<div><span>%s</span><span style="background:rgba(255,255,255,.6);border-radius:4px"><i style="width:%.0f%%"></i></span><span class="muted">%.2f</span></div>' % (e(k), 100 * float(p), float(p))
                   for k, p in sorted((t.get("probs") or {}).items()))
    return card("decider", (d.get("decider") or {}).get("name", "The decider"), purpose, "decide", ["<span>decide</span>", "<span>%d ms</span>" % t.get("ms", 0)], fin,
                '<div class="body">%s%s</div>' % (e(t.get("out", "")), '<div class="probs">%s</div>' % bars if bars else ""), live=False, opened=True)


def _flow_words(step):
    if step.get("do") == "repeat":
        return "repeat up to %d times (%s)" % (int(step.get("upTo", 2)), ", ".join(_flow_words(x) for x in step.get("steps", [])))
    return step.get("do", "") + (" (keep %d)" % step["keep"] if step.get("keep") else " (only if sure)" if step.get("sure") else "")


STEP_TITLE = {"expect": "Expect", "draft": "Draft", "try": "Try", "check": "Check", "revise": "Revise", "decide": "Decide", "write": "Write"}


# how a small model beside the decider is asked (src/orchestrate.mjs: plan.decideWith.how), in the page's words
DECIDE_WITH = {
    "if-close": "it settles the matter where the decider is close (its pick narrow or under 0.6), choosing between its two likeliest",
    "together": "it is asked at the same time, and its pick adds to the decider's probability for that answer",
    "if-at-odds": "it settles the matter where the decider's pick is not the answer most slots hold",
}


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
            cards = [decider_card(d, row, nth, "Keeps the likeliest %d answers" % keep if keep else "Settles it here if it is sure; otherwise the flow goes on" if step.get("sure") else "Decides which answer stands")]
            # a small model beside the decider (plan.decideWith), where the plan has one: when it is asked, as which slot, and on
            # an input, what it said
            dw = (d["briefs"].get("plan") or {}).get("decideWith") or {}
            if dw.get("how") in DECIDE_WITH and not keep and not step.get("sure"):
                base = by_id.get(dw.get("slot")) or next((x for x in slots if x["stage"] == "check"), slots[0])
                j = next((x for x in (row or {}).get("trace", []) if x.get("slot") == "decide-judge"), None) if row else None
                said = (" It said: %s" % e((j.get("out") or "").strip()[-240:])) if j else (" It was not asked on this input." if row else "")
                cards.append('<p class="muted small besideline" style="margin:0"><b>Beside it:</b> model %s, asked as %s: %s.%s</p>'
                             % (e(base.get("member", "")), e(base["id"]), e(DECIDE_WITH[dw["how"]]), said))
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
    """Two or three characters that stand for a model on its face: LFM2.5 2.6B -> LFM, Bonsai 2 2B -> B2, Jeffan 4B -> J4."""
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


def avatars(d, changed=None):
    """THE ARRANGEMENT AS AVATARS: the models as faces (the roster), and the flow as stations, each slot a face of its model in the
    step it stands in. On each slot: its record as a ring, what it is doing now as a dot and a halo (painted live, as the cards
    were), and a badge while the plan is trying a brief on it. Choosing one opens its card, with what it is told, below."""
    b, t = d["briefs"], d["target"]
    slots = b["slots"]
    by_id = {x["id"]: x for x in slots}
    members = d.get("members", {})
    name = lambda place: (members.get(place) or {}).get("name") or data.MEMBER_NAMES.get(place, place)  # noqa: E731
    dec = (d.get("decider") or {}).get("name", "The decider")
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
    # (the slots a change being tried touches: given where the arrangement drawn is the one being tried, else the plan's running moves)
    trying = set(changed) if changed is not None else {m["slot"] for m in trying_moves((p or {}).get("moves")) if m.get("slot")}
    # the roster: each model once, with what it brings
    roster = []
    for place in [k for k in ("a", "b", "c", "d") if k in members]:
        n_ = sum(1 for s in slots if s["member"] == place)
        gb = ((members.get(place) or {}).get("bytes") or 0) / 2**30
        roster.append('<div class="mav %s"><span class="face">%s</span><div><b>%s</b><small>%d slot%s%s</small></div></div>'
                      % (place, e(fc[place]), e(name(place)), n_, "" if n_ == 1 else "s", (" · %.1f GB" % gb) if gb else ""))
    roster.append('<div class="mav decider"><span class="face">%s</span><div><b>%s</b><small>decides%s</small></div></div>'
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
        # A CHANGE BEING TRIED ON THIS SLOT, while a session runs: an amber ring round its face, and its tooltip says what. No label
        # over the name, and nothing once the session has stopped (the question track says where it stopped)
        trying_here = live_now and s["id"] in trying
        badge = ""
        tip = "%s · %s · %s%s%s" % (s["id"], name(s["member"]), s.get("purpose") or s["stage"],
                                    (" · equivalent %d of %d judged" % (rec["right"], judged)) if pct is not None else (" · %d answered, not yet judged against the larger model" % rec["ran"]) if rec else "",
                                    " · a change being tried on it" if trying_here else "")
        tpl.setdefault(s["id"], slot_card(s, d))
        return ('<button type="button" class="av %s%s%s" data-av="%s" title="%s" aria-label="%s"><span class="ring" style="--p:%s"><span class="face">%s</span></span>%s'
                '<span class="nm">%s</span><span class="pc">%s</span><span class="live" data-live="%s"><i></i><span>Idle</span></span></button>'
                % (s["member"], " norec" if pct is None else "", " trying" if trying_here else "", e(s["id"]), e(tip), e(tip), "%.1f" % (pct or 0), e(fc.get(s["member"]) or initials(name(s["member"]))), badge, slot_name(s["id"]),
                   ("%d of %d" % (rec["right"], judged)) if pct is not None else "&nbsp;", e(s["id"])))

    def special(key, cls, face, label, tip, card_html):
        tpl.setdefault(key, card_html)
        return ('<button type="button" class="av %s norec" data-av="%s" title="%s" aria-label="%s"><span class="ring"><span class="face">%s</span></span>'
                '<span class="nm">%s</span><span class="pc">&nbsp;</span><span class="live" data-live="%s"><i></i><span>Idle</span></span></button>'
                % (cls, e(key), e(tip), e(tip), face, e(label), e(key)))

    def of(step, dflt):
        return [by_id[i] for i in step.get("slots", []) if i in by_id] if step.get("slots") else [x for x in slots if x["stage"] == dflt]

    cls = d.get("cls")
    off_set = CLASS_OFF.get(cls, set())
    off_tip = lambda do: "%s: not taken on this question (%s)%s" % (STEP_TITLE.get(do, do), CLASS_WORDS.get(cls, cls), ": a turn with tools is drafted and decided, nothing else" if cls == "tools" else ": drafts are run on calls only where a function is asked for (a program the question asks the output of is still run, whatever the class)")  # noqa: E731

    def station(step):
        do = step.get("do")
        off = do in off_set
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
            if off:
                tip = off_tip(do)
            return ('<button type="button" class="via%s" data-av="%s" title="%s" aria-label="%s"><span class="vf">%s</span><span class="vn">%s</span>%s'
                    '<span class="live" data-live="%s"><i></i><span>Idle</span></span></button>' % (" off" if off else "", key, e(tip), e(tip), SANDBOX_FACE, "try" if do == "try" else "expect",
                                                                                                 '<span class="vo">code only</span>' if off else "", key))
        elif do == "decide":
            keep = step.get("keep")
            what = "keeps %d" % keep if keep else "if sure" if step.get("sure") else "decides"
            plan_ = d["briefs"].get("plan") or {}
            # (settled by the answer most slots hold: the decider is asked only where the most are tied, and its face says so)
            most = not keep and not step.get("sure") and str(plan_.get("decideBy") or "") == "most" and cls != "tools"
            if most:
                what = "ties only"
            faces = [special("decide", "decider", e(initials(dec)), what, "%s: %s" % (dec, "keeps the likeliest %d answers" % keep if keep else "settles it here only if it is sure" if step.get("sure")
                                                                                      else "asked only on a tie: the answer most slots hold stands, and where two or more are held by as many, it chooses among those" if most else "decides which answer stands"), decider_card(d))]
            # A SMALL MODEL BESIDE THE DECIDER (plan.decideWith), where the plan has one: its face in the same step, in its model's colour,
            # labelled with how it is asked, with its own live line while it works (the slot it answers as is decide-judge)
            dw = plan_.get("decideWith") or {}
            if dw.get("how") in DECIDE_WITH and not keep and not step.get("sure") and not most:
                base = by_id.get(dw.get("slot")) or next((x for x in slots if x["stage"] == "check"), slots[0])
                m = base.get("member", "")
                short = {"if-close": "if close", "together": "with it", "if-at-odds": "if at odds"}[dw["how"]]
                tip = "%s, asked as %s, beside the decider: %s" % (name(m), base["id"], DECIDE_WITH[dw["how"]])
                body = ('<div class="body">%s is shown the different answers and names the one that is correct: %s. Where it names nothing, '
                        "the decider&#39;s pick stands.</div>" % (e(name(m)), e(DECIDE_WITH[dw["how"]])))
                faces.append(special("decide-judge", m + " judge", e(fc.get(m) or initials(name(m))), short, tip,
                                     card("judge", "%s beside the decider" % name(m), "Asked as %s" % base["id"], "decide-judge", ["<span>judge</span>"], "", body)))
        else:
            return ""
        extra = ""
        if do == "write" and len(faces) > 1:
            extra = '<span>the decider picks the reply</span>'
        # (it grows by how many faces it holds: the drafts' box takes the room six faces need, a step of one face the room of one)
        # (--cols: on a phone, the faces in rows of as even a length as fits, at most five to a row: six are three and three, not five and one)
        nf = max(1, len(faces))
        cols = -(-nf // -(-nf // 5))
        if off:
            extra += '<span>not taken here</span>'
        return '<div class="st%s" style="--n:%d;--cols:%d"%s><div class="stt">%s%s</div><div class="avs">%s</div></div>' % (
            " off" if off else "", nf, cols, (' title="%s"' % e(off_tip(do))) if off else "", e(STEP_TITLE.get(do, do)), extra, "".join(faces))

    parts = []
    # (the order of stations and the markers between them; an arrow is drawn wherever two stations meet with nothing between)
    for step in flow_of(d):
        if step.get("do") == "repeat":
            inner = [station(x) for x in step.get("steps", [])]
            # (a loop grows by the faces of every step inside it plus one for each of those steps' own box and arrow, so a revise of six
            # faces gets the room six need beside its decide: measured at 1440 px, six faces then sit three to a row, as the drafts do)
            grow = sum(int(m) for m in re.findall(r'class="st" style="--n:(\d+)', "".join(inner))) or 1
            parts.append('<div class="loopg" style="--n:%d"><div class="lt" title="Part of the flow: within one answer, these steps are done again while the answers still differ. It is not the count of changes training tries.">↻ in each answer: again while the answers differ, up to %d times</div>%s</div>'
                         % (grow, int(step.get("upTo", 2)), "".join(inner)))
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



# A QUESTION'S STATE IN THE LOOP, as a pip: at parity as the swarm stood, brought to parity by a change, not reached, not compared
PIP = {"at parity": "at", "reached": "re", "not reached": "nr", "not compared": "nc", "reopened": "ro", "set aside": "sa", "mark wrong": "mw"}
# what each state is called on a pip's tooltip and in the key, one look for each
PIP_WORDS = {"at": "at parity as it stood", "re": "brought to parity by a change", "nr": "not reached", "ro": "back in hand after a swap",
             "sa": "set aside until the others are done", "mw": "set aside: the larger model's answer is wrong", "nc": "not compared: nothing usable from the larger model, or no reader believed for its kind",
             "cur": "in hand"}


def track_of(lp):
    """Each finished question of the loop's record, in order, for the pips: [{id, kind, s (pip class), tried}]."""
    # (a question brought to parity before its mark was found wrong: the wrong mark's look, and its tooltip says it reached parity first)
    late = lambda q: bool(q.get("markWrong")) and q.get("state") in ("at parity", "reached")  # noqa: E731
    return [{"id": q.get("id", ""), "kind": q.get("kind", "") + (" · unstable mark" if q.get("unstable") else ""), "s": "mw" if late(q) else PIP.get(q.get("state"), "nc"),
             "w": (PIP_WORDS["mw"] + " (it was %s before that was found)" % PIP_WORDS[PIP[q["state"]]]) if late(q)
             else ("not compared: " + q["why"]) if q.get("state") == "not compared" and q.get("why") else PIP_WORDS.get(PIP.get(q.get("state"), "nc"), ""),
             "tried": max(0, len(q.get("attempts") or []) - 1)}
            for q in (lp or {}).get("list") or []]


def loop_live():
    """What the question loop is doing right now, where a session runs it: live.json's loop ({n, of, attempt, cap, move, guard}), or None."""
    if not session_live():
        return None
    try:
        lv = json.loads((Path(ARGS.root) / ".work" / "train" / "live.json").read_text())
    except (OSError, ValueError, AttributeError):
        return None
    return lv.get("loop") if lv.get("trainer") == "loop" and time.time() * 1000 - lv.get("at", 0) < 180000 else None


def trying_moves(moves):
    """The moves being tried. Training question by question tries one at a time: the one named live. (A loop from before it cleared
    the last one marked every move it had tried as running, and kept them so to the end of its step.)"""
    lp = loop_live()
    running = [m for m in moves or [] if m.get("status") == "running"]
    if lp:
        return [m for m in running if m.get("what") == lp.get("move")][:1] if lp.get("attempt") else []
    return running


def question_track(d):
    """THE SWARM AGAINST EACH QUESTION (training/loop.mjs): the question in hand and which iteration of it, and a pip for every
    question of the pass so far. Painted again from /api/live while a session runs."""
    lp = d.get("loop")
    tr = track_of(lp)
    of = (lp or {}).get("of") or 0
    n = lambda st: sum(1 for x in tr if x["s"] == st)  # noqa: E731
    begun = bool(lp) or session_live()
    now = ("Pass %s stopped after question %d of %d." % (e(str(lp.get("pass", ""))), len(tr), of)) if tr and len(tr) < of else ("Pass %s: every question finished." % e(str(lp.get("pass", ""))) if tr
           else "" if begun else "Each question the larger model answered stays in hand until the swarm is at parity on it.")
    pips = "".join('<i class="%s" title="%s · %s · %s%s"></i>' % (x["s"], e(x["id"]), e(x["w"]), e(x["kind"]), (" · %d change%s tried" % (x["tried"], "" if x["tried"] == 1 else "s")) if x["tried"] else "") for x in tr)
    head = ("<span>%d of %d finished</span><span>%d at parity as it stood</span><span>%d brought to parity</span><span>%d not reached</span>" % (len(tr), of, n("at"), n("re"), n("nr"))) if begun else "<span>not begun</span>"
    return ('<div class="qtrack" id="qtrack"><div class="qhead" id="qhead"><b>Question by question</b>%s</div>'
            '<p class="qnow" id="qnow">%s</p><div class="pips" id="pips">%s</div>'
            # (one line for every look a pip can have, each look drawn by the pip's own class: the key cannot drift from the pips)
            '<div class="qkey">%s</div>%s</div>'
            % (head, now, pips, "".join('<span><i class="pk %s"></i>%s</span>' % (k, e(w)) for k, w in PIP_WORDS.items()), tries_list(lp)))


# THE CLASS OF A QUESTION (src/orchestrate.mjs classOf), in the page's words, and the steps each class's turn can take: a turn with
# tools is drafters proposing the next step and the decider choosing (src/tools.mjs), nothing else; the sandbox and the expected
# results run only where a function is asked for
CLASS_WORDS = {"tools": "with tools", "talk": "in conversation", "code": "asking for code", "words": "in words"}
CLASS_OFF = {"tools": {"try", "expect", "check", "revise", "write"}, "talk": {"try", "expect"}, "words": {"try", "expect"}, "code": set()}


def class_briefs(b, cls):
    """The arrangement a question of class cls is asked with: the shared one, with the class's own slots, plan and flow where it has
    them (src/orchestrate.mjs briefsFor). Returns it and whether the class has its own."""
    k = (b.get("kinds") or {}).get(cls) if cls else None
    if not isinstance(k, dict):
        return b, False
    out = dict(b)
    for p in ("slots", "plan", "flow"):
        if p in k and not (p == "slots" and not k[p]):
            out[p] = k[p]
    return out, True


def faces_key(d):
    """What the faces are drawn from, as a key the page compares: the try being asked (its question, number and change), or the kept
    arrangement's version where no try runs."""
    lv = loop_live() or {}
    if lv.get("attempt") and lv.get("briefs"):
        return "try-%s-%s-%s-%s" % (lv.get("n"), lv.get("attempt"), lv.get("class") or "", hashlib.sha1(str(lv.get("move", "")).encode()).hexdigest()[:8])
    return "kept-%s-%s" % (d["briefs"].get("version"), lv.get("class") or "" if session_live() else "")


def faces_block(d):
    """THE ARRANGEMENT AS IT IS ASKED NOW. While a try runs, the faces draw the arrangement that try asks (the kept one with the change
    on it, sent by the trainer with each try), marked as being tried and not kept, with each slot the change touches ringed and what
    else differs said; otherwise the kept arrangement every question is asked with. Drawn again in place when the try changes
    (/fragment/faces)."""
    lv = loop_live() or {}
    cb = lv.get("briefs") if lv.get("attempt") else None
    # THE CLASS'S OWN ARRANGEMENT: a question is asked with its class's arrangement, so that is what is drawn, and what a try is
    # compared with (against the shared one, a words try read as leaving out the slots words had already dropped)
    cls = lv.get("class") if session_live() else None
    kept, own = class_briefs(d["briefs"], cls)
    which = ("the %s arrangement (%s)" % (cls, "its own" if own else "the shared one, as it has none of its own")) if cls else ""
    if not cb:
        line = ('<p class="tryline facesnow"><b>Asked now:</b> question %s, %s, with %s.</p>' % (e(str(lv.get("n", ""))), e(CLASS_WORDS.get(cls, cls)), e(which))) if cls else ""
        return '<div id="faces" data-k="%s">%s%s</div>' % (e(faces_key(d)), line, avatars(dict(d, briefs=kept, cls=cls)))
    by = {x["id"]: x for x in kept.get("slots", [])}
    look = lambda x: {k: v for k, v in x.items() if k not in ("purpose",)}  # noqa: E731
    changed = {x["id"] for x in cb.get("slots", []) if x["id"] not in by or look(x) != look(by[x["id"]])}
    gone = [i for i in by if i not in {x["id"] for x in cb.get("slots", [])}]
    plan_k = sorted(k for k in set(cb.get("plan") or {}) | set(kept.get("plan") or {}) if (cb.get("plan") or {}).get(k) != (kept.get("plan") or {}).get(k))
    flow_d = (cb.get("flow") or None) != (kept.get("flow") or None)
    diff = [x for x in [("%d slot%s changed or added" % (len(changed), "" if len(changed) == 1 else "s")) if changed else "",
                        ("%s left out" % ", ".join(gone)) if gone else "", "the flow differs" if flow_d else "",
                        ("the plan differs: %s" % ", ".join(plan_k)) if plan_k else ""] if x]
    tried = dict(d, cls=cls, briefs=dict(kept, slots=cb.get("slots") or kept.get("slots"), plan=cb.get("plan") or {}, flow=cb.get("flow")))
    # (a change to what a slot is told shows in no face's place: said here, with the slots it touches ringed)
    against = ("%s (briefs v%s)" % (which, kept.get("version"))) if cls else "the kept arrangement (briefs v%s)" % kept.get("version")
    banner = ('<p class="tryline facesnow"><b>Being tried, not kept:</b> change %s on question %s%s, %s.%s</p>'
              % (e(str(lv.get("attempt"))), e(str(lv.get("n"))), (", " + e(CLASS_WORDS.get(cls, cls))) if cls else "", e(str(lv.get("move", ""))[:240]),
                 (" Against %s: %s." % (e(against), e("; ".join(diff)))) if diff else " The same as %s." % e(against)))
    return '<div id="faces" data-k="%s">%s%s</div>' % (e(faces_key(d)), banner, avatars(tried, changed=changed))


def arrangement(d):
    b, t = d["briefs"], d["target"]
    # the swarm as it stands, in a line of chips; then what is running; then what the plan is trying now
    models = len({s["member"] for s in b["slots"]})
    kept = len(d["learned"]["ledger"])
    head = ('<div class="arrh"><div><h3>The swarm as it stands</h3><p class="muted small" style="margin:2px 0 0">What each slot is told, which model fills it, the order of steps, and the larger model it is measured against</p></div>'
            '<div class="achips"><span>briefs <b>v%s</b></span><span><b>%d</b> slots on <b>%d</b> models</span><span><b>%d</b> kept change%s</span>%s</div></div>'
            % (e(str(b.get("version", 1))), len(b["slots"]), models, kept, "" if kept == 1 else "s",
               # a kind with its own arrangement (a change kept for questions asking for code, or in words, only): the chips above are
               # the shared one
               "".join('<span title="A change that lost only questions of the other kind was kept for these alone">questions %s: <b>their own</b> arrangement, %d slots</span>'
                       % (CLASS_WORDS.get(k, k), len((v or {}).get("slots") or b["slots"])) for k, v in sorted((b.get("kinds") or {}).items()))))
    # what is being tried, on which question, and where training stopped: the question track says it (a line here about moves
    # marked running repeated it, from marks a stopped session leaves behind)
    plan_line = ""
    # (the training share, the line beside it, Train and Clear training state head the card: #score, drawn again in place)
    one = ('<div class="panel arr"><div id="score">%s</div>%s<div class="now" id="now"><i></i><span>Nothing is running. No model is loaded.</span></div>%s%s%s</div>'
           % (progress_strip(d), head, question_track(d), plan_line, faces_block(d)))
    return ('%s<h2 id="strategy">The plan being carried out</h2><div id="plan">%s</div><h2 id="system">Visualizing the System</h2><div id="viz">%s</div>'
            % (one, plan_block(d), viz_block(d)))


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


def start_run(passes=0):
    """Training is continuous: question by question, pass after pass, until Stop training is pressed (passes=0). How many questions a
    pass asks is the trainer's policy (training/policy.json: questions.each), which the session reads; it is not chosen here."""
    st = run_state()
    if st and st["running"]:
        return
    why = cannot_run() or busy_with()
    if why:
        return
    root = Path(ARGS.root)
    first = int(data.load(root)["state"].get("pass", 0)) + 1
    (root / ".work" / "train").mkdir(parents=True, exist_ok=True)
    log = open(root / ".work" / "train" / "ui-run.log", "ab")
    env = dict(os.environ, PASSES=str(passes), NODE=node_for_training())
    env.pop("TEACHER", None)  # a teacher spends on a Claude plan: never started from a button
    p = subprocess.Popen(["bash", "training/session.sh"], cwd=str(root), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    _run_file().write_text(json.dumps({"pid": p.pid, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "passes": passes, "first": first}))


def clear_state():
    """CLEAR TRAINING STATE: training starts again from pass 1, with nothing tried, measured or kept. Nothing is deleted: it is all
    moved to .work/archive/clear-<when>/, where it can be put back. Kept: what each model said by itself (the larger model's answers
    and each small model's alone, .work/train/baseline-runs.jsonl, and their summaries), since no change to training alters them
    and the larger model takes hours to ask again; and what training has FOUND, not tried: the library of found arrangements and the
    loop's policy (.work/library), so that a fresh start tries first what worked. Refused while a session runs. -> (ok, said)"""
    st = run_state()
    if st and st.get("running"):
        return False, "Training is running: stop it first."
    root = Path(ARGS.root)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = root / ".work" / "archive" / ("clear-" + stamp)
    targets = [t["id"] for t in (data.load(root).get("registry") or {}).get("targets", [])]
    # what each model said by itself: kept (the larger model's summaries, each small model alone)
    keep_result = lambda name: "-alone-vs-" in name or any(name.startswith(t + "-") for t in targets)  # noqa: E731
    moved = 0

    def move(src, rel):
        nonlocal moved
        if not src.exists() and not src.is_symlink():
            return
        to = dest / rel
        to.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(to))
        moved += 1

    for rel in ("training/state.json", "training/state.json.bak", "training/states", "training/research.md", "training/research.md.bak",
                "training/passes.md", "src/learned", "src/trained.json", "src/trained.json.bak", ".work/research"):
        move(root / rel, rel)
    res = root / "training" / "results"
    if res.exists():
        for f in sorted(res.rglob("*"), key=lambda x: -len(x.parts)):
            if f.is_file() and not keep_result(f.name):
                move(f, str(f.relative_to(root)))
        for dpath in sorted((x for x in res.rglob("*") if x.is_dir()), key=lambda x: -len(x.parts)):
            if not any(dpath.iterdir()):
                dpath.rmdir()
    work = root / ".work" / "train"
    if work.exists():
        for f in work.iterdir():
            if f.name != "baseline-runs.jsonl":
                move(f, str(f.relative_to(root)))
    if not moved:
        return True, "There was no training state to clear."
    lib = len(library_of({"root": str(root), "key": (data.load(root) or {}).get("key", "")}))
    return True, ("Cleared: training starts again from pass 1. What was there is in %s; each model's own answers were kept%s, and the loop's policy."
                  % (dest.relative_to(root), (", the %d found arrangement%s (tried first on every question)" % (lib, "" if lib == 1 else "s")) if lib else ""))


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
    """Is the configured decider installed here? The decider script's own test (training/decider.sh ready), where the folder has it."""
    script = Path(ARGS.root) / "training" / "decider.sh"
    if not script.exists():
        return False
    try:
        return subprocess.run(["bash", str(script), "ready"], cwd=ARGS.root, capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def named_decider():
    """A decider someone named for training (SWARM_DECIDER, or SWARM_KEV, its name from when Kev was the only decider)."""
    return os.environ.get("SWARM_DECIDER") or os.environ.get("SWARM_KEV") or ""


def decider_port_file():
    """Where training/decider.sh wrote the port of the decider it started (.work/decider), or where it wrote it when it was
    training/kev.sh (.work/kev)."""
    for f in (Path(ARGS.root) / ".work" / "decider" / "port", Path(ARGS.root) / ".work" / "kev" / "port"):
        if f.exists():
            return f
    return Path(ARGS.root) / ".work" / "decider" / "port"


def decider_base():
    """The address of the decider training/decider.sh started here, if it answers; else ''."""
    base = named_decider()
    if not base:
        try:
            base = "http://127.0.0.1:%d" % int(decider_port_file().read_text().strip())
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
    (SWARM_DECIDER, or training/decider.sh's port file)."""
    base = named_decider()
    if not base:
        try:
            base = "http://127.0.0.1:%d" % int(decider_port_file().read_text().strip())
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


def run_controls():
    """TRAIN, beside the Training progress card's headline, as Evaluate and Pretrain have theirs: Train and Clear training state when
    nothing runs; Stop training while a session does."""
    st = run_state()
    if st and st["running"]:
        return '<button class="btn stop top" id="run-stop" type="button">Stop training</button>'
    held = busy_with()
    why = cannot_run() or held
    return ('<button class="btn top" id="run-go" type="button"%s title="Train question by question, pass after pass, until Stop training is pressed">Train</button>'
            '<button class="btn top quiet" id="run-clear" type="button"%s title="Start training again from pass 1: what it has tried, measured and kept is moved aside (to .work/archive), and each model&#39;s own answers are kept">Clear training state</button>'
            % (" disabled" if why else "", " disabled" if held else ""))


def _making_ready(st):
    """While a session fetches and readies what the configured swarm needs (training/setup.mjs writes .work/train/setup.json): one
    line saying how many pieces are ready and what is being fetched, how much of it has arrived."""
    try:
        su = json.loads((Path(ARGS.root) / ".work" / "train" / "setup.json").read_text())
    except (OSError, ValueError):
        return ""
    if time.time() * 1000 - su.get("at", 0) > 600000 or su.get("at", 0) < _epoch_local(st.get("at", "")) * 1000:
        return ""
    steps = su.get("steps", [])
    busy = [x for x in steps if x.get("state") != "ready"]
    if not busy:
        return ""
    x = busy[0]
    of = x.get("of") or 0
    got = (" · %.1f of %.1f GB" % (x.get("done", 0) / 2**30, of / 2**30)) if of and x.get("done") is not None else ""
    cls = "warn" if x.get("state") == "failed" else "on"
    return ('<div class="state %s"><i></i><span>Making ready: %d of %d pieces ready · %s%s</span></div>'
            % (cls, len(steps) - len(busy), len(steps), e(x.get("what", "")), e(x.get("why") or got)))


def run_lines(cleared=""):
    """What training is doing, under the card's headline: running (for how long, since when, the decider's state) and what it is
    making ready; or, when it is not, why it cannot start, and when it last stopped."""
    st = run_state()
    note = lambda cls, text: '<div class="state %s"><i></i><span>%s</span></div>' % (cls, text)  # noqa: E731
    out = []
    if st and st["running"]:
        began = _epoch_local(st["at"])
        try:
            dname = (data.load(ARGS.root).get("decider") or {}).get("name") or "The decider"
        except Exception:  # noqa: BLE001
            dname = "The decider"
        out.append('<div class="state on running" data-running="1"><i></i><span data-since="%d"><b>Running %s</b><small>since %s</small></span>'
                   '<span class="runx">question by question, until stopped · %s <b>%s</b></span></div>'
                   % (int(began * 1000), e(_span(time.time() - began)), e(time.strftime("%H:%M %Z", time.localtime(began))), e(dname), e(decider_state(True))))
        out.append(_making_ready(st))
        return "".join(out)
    if cleared:
        out.append(note("", e(cleared)))
    held = busy_with()
    why = cannot_run()
    if why:
        out.append(note("warn", e(why)))
    elif held:
        out.append(note("warn", "%s is running: training waits for it, since each needs the models to itself." % e(held[0].upper() + held[1:])))
    elif not decider_installed() and not named_decider():
        out.append(note("", "Train fetches what the configured swarm is missing first"))
    elif decider_base() and not named_decider():
        out.append(note("warn", "A decider is loaded outside a session: <code>bash training/decider.sh stop</code>"))
    if st and st.get("stopped"):
        out.append(note("", "Stopped at %s" % e(st["stopped"][:5])))
    return "".join(out)


STEP_WORDS = [("target-self-train", "Larger model against itself: the train questions"), ("reader", "Check the reader of answers in words"), ("swarm-reworded", "The swarm: the held questions, a second way"), ("begin", "Begin the pass"), ("research", "Read what is new on arXiv"), ("target-train", "Larger model: the train questions"), ("target-self", "Larger model against itself"), ("target", "Larger model: the held questions"),
              ("swarm-held", "The swarm: the held questions"), ("plan", "Plan what to try"), ("write-briefs", "New briefs from the larger model"),
              ("members", "Could another small model draft it?"), ("deciders", "Would another decider choose better?"),
              ("questions", "Train, question by question"), ("end", "Verdict"), ("publish", "Write it up")]


def step_label(name):
    """A step of a pass, in words: what the session's own name for it (00-begin, 10-improve-a-critic) stands for."""
    key = name.split("-", 1)[1] if "-" in name and name.split("-", 1)[0].isdigit() else name
    if key in ("a-alone", "b-alone", "c-alone", "d-alone"):
        return "%s alone" % data.MEMBER_NAMES.get(key[0], key[0])
    return next((words for k, words in STEP_WORDS if key == k), key)


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


def pills(d):
    """Four choices and one document: the two small models, the model that decides, the larger model, and the SwOA spec."""
    reg, running = d["registry"], bool((run_state() or {}).get("running"))
    # (a model in parts weighs all of its parts)
    weigh = lambda m: (" · %.1f GB" % ((m["bytes"] + sum(p.get("bytes") or 0 for p in m.get("parts") or [])) / 2**30)) if m.get("bytes") else (" · about %s GB" % m["memGb"]) if m.get("memGb") else ""  # noqa: E731

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
    return "%s · %s decides%s · against %s%s · tools: %s" % (mem, (d.get("decider") or {}).get("name", "?"), (" · %s judges" % d["judge"]["name"]) if d.get("judge") else "", (d.get("target") or {}).get("name", "?"), (" · on " + on) if on else "",
                                                     "the swarm" if d.get("tools") == "swarm" else "%s alone" % ((d.get("members") or {}).get(d.get("tools")) or {}).get("name", "one model"))


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


def alone_scores(root, tid, members=()):
    """EACH SMALL MODEL ALONE AGAINST THE LARGER MODEL, as the recommendations weigh it. A measurement is written into the folder of
    the configuration that took it (training/results/<configuration>/<model>-alone-vs-<target>-held.json; the oldest at the top
    of training/results): every one is read, which the badge once did not (it read only the top, and recommended nothing while six
    models were measured). Only measurements on the same questions are compared (the seed, how many, and their kinds): the set the
    swarm's own members were measured on most recently, else the newest. A model measured more than once there counts by the mean,
    and how far one model's runs differ (LFM2.5 1.2B: 16, 21 and 30 of the same 84) is the bar a lead must clear, never under 5.
    -> {"models": {id: {"pct", "right", "of", "runs", "lo", "hi"}}, "spread", "bar", "set": n questions}"""
    base = Path(root) / "training" / "results"
    suffix = "-alone-vs-%s-held.json" % tid
    runs = []
    for f in base.rglob("*" + suffix):
        j = data._json(f, {}) or {}
        if not j.get("compared"):
            continue
        sig = (j.get("seed"), j.get("compared"), tuple(sorted((j.get("kinds") or {}).keys())))
        runs.append({"id": f.name[: -len(suffix)], "sig": sig, "at": str(j.get("at") or ""), "right": j.get("right", 0), "of": j["compared"]})
    if not runs:
        return {"models": {}, "spread": 0.0, "bar": 5.0, "set": 0}
    own = [r for r in runs if r["id"] in members]
    sig = max(own or runs, key=lambda r: r["at"])["sig"]
    by = {}
    for r in runs:
        if r["sig"] == sig:
            by.setdefault(r["id"], []).append(100.0 * r["right"] / r["of"])
    models = {}
    for mid, xs in by.items():
        of = sig[1]
        models[mid] = {"pct": sum(xs) / len(xs), "right": round(sum(xs) / len(xs) * of / 100), "of": of, "runs": len(xs), "lo": min(xs), "hi": max(xs)}
    spread = max([m["hi"] - m["lo"] for m in models.values() if m["runs"] > 1] or [0.0])
    return {"models": models, "spread": spread, "bar": max(5.0, spread), "set": sig[1]}


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
                           % (r.get("asked", 0), e(str(rep.get("pass", "?"))), r.get("theirsRight", 0), e(rec_dec), r.get("nowRight", r.get("kevRight", 0)),
                              r["recovered"], e(rec_dec), r["lost"],
                              "A small edge: a real pass is what would tell." if edge < 3 else "A clear edge on the recorded choices.") + elsewhere(rep_from),
                    "note": " · ".join(x for x in [dec.get("license", ""), "its weights are here" if any((Path(d["root"]) / ".work" / "deciders" / dec["id"] / f).exists() for f in ("model/.complete", ".complete")) or (dec.get("serve") or {}).get("kind") == "kev" else "Train fetches it"] if x)})
    # EACH SMALL MODEL ALONE against this larger model: one that answers as the larger model more often than the weakest member of
    # this swarm, by more than the measurements themselves wander, is evidence for a swap (alone_scores)
    tid = (d.get("target") or {}).get("id", "")
    members = d.get("members", {})
    mine = {k: m["id"] for k, m in members.items() if m}
    al = alone_scores(d["root"], tid, list(mine.values()))
    scored = [(al["models"][i]["pct"], k, i) for k, i in mine.items() if i in al["models"]]
    if scored:
        worst = min(scored)
        names = {m["id"]: m["name"] for m in reg.get("small", [])}
        bar = al["bar"]
        for mid, sc in sorted(al["models"].items(), key=lambda kv: -kv[1]["pct"]):
            if mid in mine.values() or mid not in names or sc["pct"] < worst[0] + bar:
                continue
            w = al["models"][worst[2]]
            runs = lambda x: (" (the mean of %d runs)" % x["runs"]) if x["runs"] > 1 else ""  # noqa: E731
            out.append({"id": "swap:%s:%s" % (worst[1], mid), "strength": "measured", "apply": {worst[1]: mid}, "n": sc["of"],
                        "title": "Use %s in place of %s" % (names[mid], names.get(worst[2], worst[2])),
                        "why": "Alone, against %s, on the same %d held questions, it answered %s%% as the larger model did (%d of %d%s), where %s answered %s%%%s. It leads by %s points; the same model measured again on these questions has differed by up to %s, so only a lead above %s counts."
                               % (e((d.get("target") or {}).get("name", "")), sc["of"], fmt_pct(int(sc["pct"] * 10) / 10), sc["right"], sc["of"], runs(sc).replace(" (", ", ").rstrip(")"), e(names.get(worst[2], worst[2])),
                                  fmt_pct(int(w["pct"] * 10) / 10), runs(w), fmt_pct(int((sc["pct"] - w["pct"]) * 10) / 10), fmt_pct(int(al["spread"] * 10) / 10), fmt_pct(int(bar * 10) / 10)),
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
                               % (dv["timedOut"], dv["n"], ((ev.get("slots") or {}).get("decide") or {}).get("ms", 0) / 1000.0),
                        "note": "the next session waits as long as it needs"})
        else:
            prev = None
            for k_, o_ in (ev.get("otherDeciders") or {}).items():
                ids_ = k_.split("+")
                if ids_[:-1] == [mine[x] for x in places] and o_["n"] >= 10 and (o_["failed"] / o_["n"]) < dv["failed"] / dv["n"]:
                    prev = (ids_[-1], o_)
            # only a decider measured to fail less on the same small models is recommended: with none, no decider is named
            alt = prev[0] if prev else ""
            if alt and alt != cur_dec:
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
            '<div class="foldb">%s%s</div></details>' % (badge, e(cfg_meta(d)), pills(d), equiv(d)))


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
    # (in the Equivalent on card, under its boxes, with no description: console instruction 2026-11-17)
    body = '<div class="tgl" role="group" aria-label="Who takes a turn with tools">%s</div>' % segs
    return body if inner else '<div class="tools" id="tools">%s</div>' % body


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
    # (and who takes a turn with tools, the switch under the boxes; no description under either: console instruction 2026-11-17)
    body = '<legend>Equivalent on</legend><div class="ticks">%s</div>%s' % (boxes, tools_toggle(d))
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


def run_words(run):
    """An earlier run, by when it was set aside: 'clear-20261116-200115' is the run Clear training state set aside at 20:01 on 16 November."""
    m = re.match(r"(?:clear|reset)-(\d{4})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?", str(run or ""))
    if not m:
        m2 = re.match(r"reset-(\d{4})-(\d{2})-(\d{2})", str(run or ""))
        return (" · a run set aside %s-%s-%s" % m2.groups()) if m2 else ""
    y, mo, dd, hh, mm = m.groups()
    return " · a run set aside %s-%s-%s%s" % (y, mo, dd, (" %s:%s" % (hh, mm)) if hh else "")


def ledger_rows(entries, newest_first=True, pill=lambda x: ("up", "Kept")):
    """What was kept, each with the evidence it was kept on: answers equivalent to the larger model's, before and after."""
    out = []
    for x in (entries[::-1] if newest_first else entries):
        tr, he = x.get("train") or {}, x.get("held") or {}
        ev = lambda z: ("%d → %d" % ((z.get("before") or {}).get("right", 0), (z.get("after") or {}).get("right", 0))) if z.get("before") and z.get("after") else "not recorded"  # noqa: E731
        where = " · ".join(v for v in [("<code>%s</code>" % e(x["slot"])) if x.get("slot") else "", "pass %s" % e(str(x.get("pass", ""))) if x.get("pass") else "", e(str(x.get("at", ""))[:10]),
                                        '<a href="https://arxiv.org/abs/%s" target="_blank" rel="noopener">arXiv %s</a>' % (e(x["from"]), e(x["from"])) if x.get("from") else ""] if v)
        qn = x.get("question") or {}
        # kept question by question (training/loop.mjs): the question it brought to parity, and how many already there held
        evid = ("Brought <code>%s</code> to parity (lost in %s; change %s tried on it) · %s" % (
                    e(str(qn.get("id", ""))), e(str(qn.get("lostAt", ""))), e(str(qn.get("attempt", ""))),
                    ("%d already at parity asked again, none lost" % qn["guard"]) if qn.get("guard") else "none was at parity before it")
                ) if qn else ('Equivalent answers on train: <b style="display:inline;font-size:inherit">%s</b> · on held: <b style="display:inline;font-size:inherit">%s</b>' % (ev(tr), ev(he)))
        out.append('<li class="kept"><span class="o">%s</span><span class="k %s">%s</span><span class="mv"><b>%s</b><small>%s</small>'
                   '<small>%s</small></span><span class="pill %s">%s</span></li>'
                   % (e(str(x.get("n", ""))), e(x.get("kind", "")), e(_kind(x)), e(_what(x)), where, evid, pill(x)[0], e(pill(x)[1])))
    return "".join(out)


def learned_block(d):
    """WHAT THIS SWARM HAS LEARNED, for the spec: every kept change with its evidence, newest first, and where each pass left it."""
    led, passes = d["learned"]["ledger"], d["learned"]["passes"]
    tname = (d["target"] or {}).get("name", "the larger model")
    wins = d["learned"].get("wins") or []
    if wins:
        # CUMULATIVE: every win of this configuration, from every run, whatever Clear training state set aside; the ones the
        # arrangement carries now are marked, the rest are found arrangements, tried first on every question
        now = sum(1 for w in wins if w.get("inArrangement"))
        rows = ledger_rows([dict(w, n=k + 1) for k, w in enumerate(wins)],
                           pill=lambda x: ("up", "In the arrangement") if x.get("inArrangement") else ("planned", "Found" + run_words(x.get("run"))))
        return ('<h4>Everything it has found (%d win%s, every run)</h4><p class="muted small" style="margin:0 0 6px">Every change that brought a train question to parity '
                "with %s&#39;s answer and lost none already at parity, from every run of this configuration: Clear training state starts training again, it never "
                "takes a win out of here. <b>%d</b> %s in the arrangement this spec describes; every one is a found arrangement, tried first on every question.</p>"
                '<ul class="moves">%s</ul>' % (len(wins), "" if len(wins) == 1 else "s", e(tname), now, "is" if now == 1 else "are", rows))
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


def loop_line(d):
    """How far training has come, for the spec: the pass's questions at parity, of all of them (as the progress card says it)."""
    lp = d.get("loop") or {}
    qs, of = lp.get("list") or [], lp.get("of") or 0
    if not of:
        return "not begun"
    at = sum(1 for q in qs if q.get("state") == "at parity")
    re_ = sum(1 for q in qs if q.get("state") == "reached")
    return "<b>%s%%</b> · %d of %d questions at parity (%d as the swarm stood, %d brought there by a change)" % (fmt_pct(data.percent(at + re_, of)), at + re_, of, at, re_)


def loop_changes(d):
    """What the loop has tried and kept this pass, for the spec."""
    lp = d.get("loop") or {}
    qs = lp.get("list") or []
    ch = lp.get("changes") or []
    tries = lp.get("tries") or sum(max(0, len(q.get("attempts") or []) - 1) for q in qs)
    return "%d tried · <b>%d</b> kept (%d of them found arrangements) · %d found arrangement%s in the library" % (
        tries, len(ch), sum(1 for c in ch if c.get("kind") == "library"), len(library_of(d)), "" if len(library_of(d)) == 1 else "s")


def spec_panel(d):
    """The SwOA spec (docs/swoa.md), for a person to read and to copy: what the configured swarm module is, what tunes it, and the
    proof of where it stands against its target."""
    sp = data.spec(d)
    t = sp["trainedAgainst"]
    # ONLY A SwOA WITH PROOF GOES UPSTREAM (specs/): published from here, with its card
    why_not = data.publishable(sp)
    pf = data.published_file(d["root"], sp)
    publish_button = ('<button class="btn top" id="spec-publish" type="button"%s>Publish to specs/</button>'
                      % ((' disabled title="%s"' % e(why_not)) if why_not else ' title="Write the SwOA spec and its card to specs/, the one place training leaves something to commit"'))
    published_line = ""
    if pf.exists():
        try:
            same = json.loads(pf.read_text()).get("swoa", {}).get("recipeSha256") == sp["swoa"]["recipeSha256"]
        except (OSError, ValueError):
            same = False
        published_line = (" Published as <code>specs/%s</code>%s." % (e(pf.name), "" if same else ", from an earlier recipe: publishing again replaces it"))
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
                    # (training goes question by question: how far it has come and what it has kept are the loop's, not the plan's marks)
                    row("Training complete", loop_line(d)),
                    row("Changes", loop_changes(d)),
                    row("Measured so far", "<ul style='margin:0;padding-left:18px'>%s</ul>" % meas) if meas else ""))
    # HOW FAR TRAINING TOOK IT: the default arrangement against the trained one, served the same way, and the gain (data.equivalence_of)
    eqv = sp["equivalence"]
    side = lambda x: ("<b>%s%%</b> · %d of %d held questions" % (fmt_pct(x["percent"]), x["equivalent"], x["of"])) if "percent" in x else ("the same as the default: training has kept nothing yet" if x.get("sameAs") else "not measured yet")  # noqa: E731
    served = (" with the adapters of %s" % ", ".join("place " + k for k in eqv["default"]["adapters"])) if eqv["default"]["adapters"] else " without adapters"
    gained = ("<table class='spec'>%s%s%s</table>"
              % (row("Default (briefs v%s)" % eqv["default"]["briefsVersion"], side(eqv["default"]) + "<br><span class='muted'>%s%s</span>" % (e(eqv["defaultIs"]), e(served))),
                 row("Trained (briefs v%s)" % eqv["trained"]["briefsVersion"], side(eqv["trained"]) + "<br><span class='muted'>%s</span>" % e(eqv["trainedIs"])),
                 row("Gain", ("<b>%+.1f points</b>" % eqv["gainPoints"]) if eqv["gainPoints"] is not None else "<span class='muted'>%s</span>" % e(eqv["gainIs"]))))
    gained = "<h4>How far training took it</h4>" + gained
    pins = sp["recipe"].get("adapters") or {}
    made = (sp.get("adapters") or {}).get("models") or {}
    adapter_rows = "".join(row("Adapter (place %s)" % k, "<code>%s</code> <span class='muted'>%.1f MB</span><br><code>sha256 %s</code><br><span class='muted'>%s; from %s @ %s, %s steps</span>"
                               % (e(a["file"]), a["bytes"] / 2**20, e(a["sha256"]), e(made.get(k, {}).get("learned", "")), e(str((made.get(k, {}).get("from") or {}).get("weights", ""))),
                                  e(str((made.get(k, {}).get("from") or {}).get("revision", ""))[:12]), e(str(made.get(k, {}).get("iters", ""))))) for k, a in pins.items())
    if pins:
        adapter_rows += row("Adapter files", "<span class='muted'>%s</span>" % e(sp["adapters"]["filesAre"]))
    # AS A MODEL CHOOSER LISTS IT: the card, what it needs, what it can do, how it starts
    c, rq, cap, st_ = sp["card"], sp["requirements"], sp["interface"]["capabilities"], sp["interface"]["start"]
    host = ('<h4>As a model chooser lists it</h4><div class="hostcard"><div><b>%s</b><span class="muted small"> · %s · about %s GB · %s</span></div><div class="hcbadge">%s</div><p>%s</p>%s</div>'
            '<p class="muted small" style="margin:6px 0 0">The entry a model chooser takes, with <code>engine: swarm</code>; it is started with <code>%s</code>.</p>'
            "<h4>What it needs</h4><table class='spec'>%s</table><h4>What it can do as a model</h4><table class='spec'>%s</table><h4>To make it</h4><table class='spec'>%s</table>"
            % (e(c["name"]), e(c["size"]), e(str(c["memGb"])), e(c["pace"] if c.get("secondsPerReply") is None else "%s s a reply" % c["secondsPerReply"]), e(c["badge"]), e(c["plain"]),
               ('<div class="hcon">%s</div>' % "".join("<span>%s</span>" % e(x) for x in c["equivalentOn"])) if c["equivalentOn"] else "", e(st_["host"]),
               row("Platforms", e(", ".join(rq["platforms"])) + "<br><span class='muted'>%s</span>" % e(rq["platformsAre"])) + row("Memory", "about %s GB (an estimate)" % e(str(rq["memoryGb"])))
               + row("Disk", "%s GB of model files" % e(str(rq["diskGb"]))) + row("Engine", e(rq["engine"])) + row("Node", e(rq["node"])) + (row("The decider", e(rq["decider"])) if rq.get("decider") else "")
               + row("Licences", e("; ".join(rq["licenses"]))) + row("Commercial use", ("<b>Allowed by every licence listed</b>" if rq["commercialUse"] else "<b class='bad'>Not allowed</b>: a licence says non-commercial") + "<br><span class='muted'>Read every licence above before offering it</span>"),
               row("Chat", "yes") + row("Streaming", e(cap["stream"])) + row("Tools", e(cap["tools"])) + row("Images", "no") + row("Context", "%s tokens a request" % e(str(cap["contextTokens"]))) + row("Good for", e(sp["interface"]["goodFor"])),
               row("SwOA", "<code>%s</code><br><span class='muted'>%s</span>" % (e(sp["swoa"]["recipeSha256"][:16]), e(sp["swoa"]["is"])))
               + row("Base module", "<code>%s</code>" % e(sp["swoa"]["baseModuleSha256"][:16])) + row("Arrangement", "<code>%s</code>" % e(sp["swoa"]["arrangementSha256"][:16]))
               + row("Format", "<code>%s</code> version %s (docs/swoa.md)" % (e(sp["swoa"]["format"]), e(str(sp["swoa"]["version"]))))
               + row("Runtime", "%s %s" % (e(str((sp.get("runtime") or {}).get("library") or "")), e(str((sp.get("runtime") or {}).get("version") or ""))))
               + row("Written", e(str(sp["swoa"].get("writtenAt") or "")))
               + "".join(row(k.capitalize(), "<code>%s</code>" % e(v)) for k, v in st_.items())))
    return (
        '<div class="spec-head"><div><div class="kicker">SwOA spec</div><h3 style="font-size:24px">%s</h3><div class="muted small">%s</div></div>'
        '<div class="spec-acts"><button class="btn top" id="spec-copy" type="button">Copy as JSON</button><button class="btn top" id="spec-save" type="button">Save as a file</button>%s<button class="btn stop top" id="spec-close" type="button">Close</button></div></div>'
        '<p class="verdict %s" style="margin:14px 0 2px">%s against %s.</p><p class="muted small" style="margin:0 0 12px">%s%s</p>'
        "%s%s<h4>What it is</h4><table class='spec'>%s%s%s%s%s%s%s%s</table>"
        "<h4>The flow</h4><p class='small' style='margin:0'>%s <span class='muted'>(%s)</span></p>"
        "<h4>The arrangement (briefs v%s)</h4><table class='spec slots4'><tr><th>Slot</th><th>Stage</th><th>What it is for</th><th>Model</th></tr>%s"
        "<tr><td><code>decide</code></td><td>decide</td><td>Decides which answer stands</td><td>%s</td></tr></table>%s"
        '<h4>As JSON</h4><p class="muted small" style="margin:0 0 6px">As it is published: what is this runtime&#39;s own (how it starts here) is left out. Copy and Save take this.</p><pre class="tail" id="spec-json" data-name="%s" style="max-height:320px">%s</pre>'
        % (
            e(sp["swoa"]["name"]), e(sp["what"]), publish_button,
            state_cls, e(("%s%% of the way to parity" % fmt_pct(t["progressPercent"])) if t.get("progressPercent") is not None and t["state"] != "at parity"
                         else ("In training: pass %d under way" % ip["pass"]) if t["state"] == "not measured" and ip else t["state"].capitalize()), e(t["target"].get("name") or ""),
            e(t["parityMeans"]), published_line,
            under + proof_block(sp) + gained + learned_block(d), host,
            row("In", e(sp["interface"]["in"])), row("Out", e(sp["interface"]["out"])),
            row("Offered as", "<br>".join(e(x) for x in sp["interface"]["as"])),
            row("Not yet", "<br>".join(e(x) for x in sp["interface"]["notYet"])),
            "".join(row("Small model %d (place %s)" % (i + 1, k), mem(m)) for i, (k, m) in enumerate(sp["members"].items())), adapter_rows,
            row("Decides", "%s <span class='muted'>· %s · %s</span>%s" % (e(sp["decider"].get("name") or ""), e(sp["decider"].get("by") or ""), e(sp["decider"].get("license") or ""), decider_pins(sp["decider"]))),
            row("Against %s" % e(t["target"].get("name") or ""), ("<b>%s</b> of the way to parity. %d held questions: %d equivalent, %d different, %d no answer<ul style='margin:6px 0 0;padding-left:18px'>%s</ul>" % (e(fmt_pct(t["progressPercent"]) + "%"), t["heldQuestions"], t["equivalent"], t["different"], t["noAnswer"], kinds)) if t["state"] != "not measured" else "Not measured: no pass has put this swarm and this target to the same held questions.")
            + row("Served", "%d slots on each small model, %d tokens of context a slot; about %s GB of memory (an estimate); engine %s %s" % (sp["serving"]["slots"], sp["serving"]["contextPerSlot"], sp["serving"]["memoryGbEstimate"], e(sp["engine"].get("name") or ""), e(sp["engine"].get("version") or ""))),
            e(" → ".join(_flow_words(x) for x in sp["arrangement"]["flow"])), e(sp["arrangement"]["flowIs"]),
            e(str(sp["arrangement"]["briefsVersion"])), slots, e(sp["decider"].get("id") or ""), class_arrangements(sp),
            e(sp["swoa"]["name"]), e(json.dumps(data.published(sp), indent=2)),
        )
    )




def memory_chart(d, compact=False, headless=False):
    """THE POINT OF THE SWARM, AS A PICTURE: the larger model's memory as one bar, and the swarm's beside it on the same scale, made of
    its parts (each small model, the room for their contexts, the decider), with the share. Estimates from what is on record, and said
    to be. compact: the parity card's version (a short heading; the whole explanation is in the whole measurement). headless: the
    bars, scale and key alone, under a card's own head (memory_card)."""
    fp = d.get("footprint")
    if not fp:
        return ""
    scale = max(fp["target"], fp["swarm"])
    ab = lambda n: ("%.1f" % n).rstrip("0").rstrip(".")  # noqa: E731
    colour = {"a": "var(--lfm)", "b": "var(--bon)", "c": "#7a5cc4", "d": "#2f7fb8"}
    col = lambda x: colour.get(x.get("place"), "var(--dec)" if x["kind"] == "decider" else "#a9c9c1")  # noqa: E731
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
            % (" compact" if compact else "", "" if headless else head, e(fp.get("targetName") or "The larger model"), 100.0 * fp["target"] / scale, ab(fp["target"]), seg, ab(fp["swarm"]), ticks, legend))




def progress_strip(d, cleared=""):
    """TRAINING COMPLETE, as a share: training goes question by question and a question is never left short of parity, so how far it
    has come is how many of the pass's train questions are at parity (as the swarm stood, or brought there by a change it kept), of
    all of them; with the line that says where the pass is, Train and Clear training state, and what the session is doing. It heads
    the Train card (#score inside arrangement()): the bar, its legend, the spec line and the ideas line that sat under it were taken
    out (console instruction 2026-11-17), the memory chart is a card of its own, above Evaluate (memory_card)."""
    lp = d.get("loop") or {}
    qs = lp.get("list") or []
    of = lp.get("of") or 0
    lv = loop_live()
    tname = (d.get("target") or {}).get("name", "the larger model")
    n = lambda st: sum(1 for q in qs if q.get("state") == st)  # noqa: E731
    at, re_, back, nr = n("at parity"), n("reached"), n("reopened") + n("set aside"), n("not reached")
    done = at + re_
    # (a question that cannot be brought to parity is not counted against the share: no answer from the larger model, or a mark the
    # question's own correct solution proves wrong)
    wrong_m = n("mark wrong")
    can = max(0, of - n("not compared") - wrong_m)
    pct = data.percent(done, can) if can else 0
    if qs:
        line = ("<b>%d</b> of %d train questions at parity with %s: <b>%d</b> as the swarm stood, <b>%d</b> brought there by a change it kept%s%s."
                % (done, of, e(tname), at, re_, ((", %d back in hand after a swap" % n("reopened")) if n("reopened") else "") + ((", %d set aside until the others are done" % n("set aside")) if n("set aside") else ""), ((", %d left short of parity by an earlier version of the loop" % nr) if nr else "") + ((", %d set aside because the larger model's answer is wrong" % wrong_m) if wrong_m else "")))
        now = ("Question %s is in hand." % e(str(lv.get("n")))) if lv else ("Stopped; it carries on from question %d." % (len(qs) - back + 1)) if len(qs) - back < of else "Every question of this pass is at parity."
    else:
        line = "Training starts at question 1 of the pass: each question stays in hand until the swarm is at parity with %s on it." % e(tname)
        now = ""
    # (while a session runs, a bar that moves in place of the share: the line beside it, the bar and the counts below go on saying
    # where the pass is; stopped, the share comes back, as far as the pass got)
    running_now = bool((run_state() or {}).get("running"))
    return ('<div class="trainprog trainhead"><div class="proghead"><span class="memnum"' + (' aria-busy="true">' + busy() if running_now else '><b class="pct">%s%%</b>' % fmt_pct(pct)) + '<span>training complete<small>pass %s</small></span></span>'
            '<span class="progline">%s %s</span><span class="evctl">%s</span></div>%s</div>'
            % (e(str(lp.get("pass") or (d.get("state") or {}).get("pass", 0) + 1)), line, now, run_controls(), run_lines(cleared)))


def memory_card(d):
    """MEMORY SAVED, the first card: what the swarm takes in memory against the larger model. Its head is built as Evaluate's, Pretrain's
    and Train's are (the share at the top left, what it is beside it, a line saying what it rests on), and under it the bars on one
    scale, the swarm's made of its parts, and their key. None where nothing is on record to estimate from."""
    fp = d.get("footprint")
    if not fp:
        return ""
    ab = lambda n: ("%.1f" % n).rstrip("0").rstrip(".")  # noqa: E731
    return ('<h2>Memory saved</h2><div class="panel memcard"><div class="proghead"><span class="memnum"><b class="pct">%s%%</b><span>memory saved<small>%s GB less</small></span></span>'
            '<span class="progline">The swarm is %s× smaller than %s: estimated from the model files and the listed sizes, not measured.</span><span class="evctl"></span></div>%s</div>'
            % (fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0", ab(max(0.0, fp["savedGb"])), ab(fp["times"] or 0), e(fp.get("targetName") or "the larger model"),
               memory_chart(d, compact=True, headless=True)))


# ---------------------------------------------------------------- evaluate the swarm, pretrain it
# Both, like a training session, are processes this page starts and stops (each in a session of its own, so that stopping it stops
# the model servers it started), and only one of the three runs at a time: each needs the models, and the memory, to itself.
def _job_file(name):
    return Path(ARGS.root) / ".work" / name / "ui-run.json"


def job_state(name):
    """{pid, at, ...} of the evaluation or pretraining this page started, and whether it is still alive."""
    try:
        st = json.loads(_job_file(name).read_text())
    except (OSError, ValueError):
        return None
    try:
        try:
            if os.waitpid(st["pid"], os.WNOHANG)[0] == st["pid"]:
                raise OSError("ended")
        except ChildProcessError:
            pass
        os.kill(st["pid"], 0)
        st["running"] = True
    except (OSError, KeyError):
        st["running"] = False
    return st


def busy_with():
    """Which of training, evaluation and pretraining is running now ('' when none): the other two wait for it."""
    if (run_state() or {}).get("running"):
        return "training"
    for name, what in (("eval", "an evaluation"), ("pretrain", "pretraining")):
        if (job_state(name) or {}).get("running"):
            return what
    return ""


def start_job(name, argv, keep=None):
    """Start an evaluation or pretraining; '' when it started, else why not."""
    held = busy_with()
    if held:
        return "Wait for %s to end, or stop it: each needs the models to itself." % held
    why = cannot_run()
    if why:
        return why
    root = Path(ARGS.root)
    (root / ".work" / name).mkdir(parents=True, exist_ok=True)
    # (what the last one wrote is set aside, so that the page does not show it as this one's while it starts)
    for f in ((root / ".work" / name / "live.json"),):
        try:
            f.replace(f.with_name("last-live.json"))
        except OSError:
            pass
    log = open(root / ".work" / name / "ui-run.log", "wb")
    env = dict(os.environ, NODE=node_for_training())
    p = subprocess.Popen(argv, cwd=str(root), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    # (with what was chosen for it, so the page can say so from the first moment, before the run itself has written anything)
    _job_file(name).write_text(json.dumps(dict(keep or {}, pid=p.pid, at=time.strftime("%Y-%m-%d %H:%M:%S"))))
    return ""


def stop_job(name):
    st = job_state(name)
    if not (st and st["running"]):
        return
    try:
        os.killpg(st["pid"], signal.SIGTERM)
    except OSError:
        pass
    for _ in range(50):
        time.sleep(0.1)
        if not (job_state(name) or {}).get("running"):
            break


def job_live(name):
    """What the evaluation or pretraining is doing (its live.json), with whether it is running; a run that ended without saying
    so (it stopped on an error before it could) says so, with the last line it wrote."""
    root = Path(ARGS.root) / ".work" / name
    live = data._json(root / "live.json", None) or {}
    st = job_state(name) or {}
    live["running"] = bool(st.get("running"))
    if not live["running"] and st and live.get("phase") not in ("done", "stopped", "failed"):
        try:
            tail = [x for x in (root / "ui-run.log").read_text(errors="replace").splitlines() if x.strip()]
        except OSError:
            tail = []
        live["phase"] = "failed"
        live["step"] = "It ended before it finished: " + (tail[-1][:220] if tail else "nothing was written")
    return live


EVAL_SIZES = ((20, "20 a task (quick)"), (100, "100 a task"), (0, "every question"))
COMPARE_WORDS = {"answer": "the same answer", "verdict": "the same verdict on the task's tests", "instructions": "the same instructions kept and broken"}
METRIC_WORDS = {"exact_match": "exact match", "pass@1": "pass@1", "pass_at_1": "pass@1", "prompt_level_strict_acc": "strict prompt accuracy"}


def _ev_bar(row, who, label):
    """One model's progress through one task: a bar, and what it is doing."""
    st = row.get(who) or {}
    done, of = st.get("done") or 0, st.get("of")
    pct = 100.0 * done / of if of else (100.0 if st.get("state") in ("done", "kept") else 0)
    words = {"waiting": "waiting", "asking": "asking %d%s" % (min(done + 1, of or done + 1), (" of %d" % of) if of else ""), "done": "%d asked" % done,
             "kept": "answers kept from before", "failed": "failed: " + (st.get("why") or ""), "stopped": "stopped at %d" % done}.get(st.get("state"), "")
    return ('<div class="evw %s" data-w="%s"><span class="evbar"><i style="width:%.1f%%"></i></span><small><b>%s</b> <span data-ws>%s</span></small></div>'
            % (e(st.get("state") or "waiting"), who, pct, e(label), e(words)))


def _ev_agree(r):
    """What the two answers came to on one task: how many are the same, split by whether both were right."""
    a = (r or {}).get("agree")
    if not a:
        # (the size of the lines beside it, not the body's: it is a note on the bars, as their labels are)
        return '<small>%s</small>' % e((r or {}).get("failed") or "compared when both have answered")
    pct = data.percent(a["same"], a["of"]) if a["of"] else 0
    sc = lambda x: ("%s%%" % fmt_pct(round(100.0 * x["value"], 1))) if x and x.get("value") is not None else "?"  # noqa: E731
    return ('<b class="evpct">%s%%</b> <span>%d of %d the same</span><small>%d both right · %d both wrong · %d differ%s</small><small>scores: %s %s · the swarm %s</small>'
            % (fmt_pct(pct), a["same"], a["of"], a["bothRight"], a["bothWrong"], a["differ"],
               (" (%d only %s right, %d only the swarm)" % (a["onlyTarget"], "the larger model", a["onlySwarm"])) if a["differ"] else "",
               e(r.get("targetName") or "the larger model"), sc(r.get("target")), sc(r.get("swarm"))))


def busy(ghost="00%"):
    """In place of a headline figure while it is being measured: invisible text the size of the figure (so it sits on the line
    as the figure does, at its width), and a moving bar where the digits would be."""
    return '<b class="pct busy" role="progressbar" aria-label="Being measured"><span aria-hidden="true">%s</span><i></i></b>' % ghost


def chosen_items(eq):
    """The bodies of work ticked under the models, in the list's order."""
    return [t for t in eq.get("targets", []) if t["id"] in (eq.get("chosen") or [])]


def eval_of_config(root, d):
    """THE EVALUATION OF THE SWARM AS IT IS APPLIED: the newest that finished (.work/eval/history.jsonl, then results.json) of this
    configuration (the same small models, decider and larger model: its key) served as it is now (with the same adapters, or with
    none). One of another configuration is never shown as this one's: the card showed LFM2.5 1.2B, Qwen3.5 2B and Ministral 3 3B
    with adapters while the swarm was Bonsai 2 9B and LFM3 1.7B. -> (that result or {}, the newest of any configuration or {})"""
    rows = []
    hist = Path(root) / ".work" / "eval" / "history.jsonl"
    try:
        for line in hist.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    last = data._json(Path(root) / ".work" / "eval" / "results.json", None)
    if last:
        rows.append(last)
    rows = [r for r in rows if isinstance(r, dict) and r.get("results")]
    pins, _ = data.spec_adapters(d)
    served = sorted((d.get("members", {}).get(k) or {}).get("name", k) for k in pins)
    mine = [r for r in rows if r.get("configuration") == d.get("key") and sorted(r.get("adapters") or []) == served]
    newest = lambda xs: max(xs, key=lambda r: str(r.get("at", ""))) if xs else {}  # noqa: E731
    return newest(mine), newest(rows)


def eval_block(d):
    """EVALUATE THE SWARM: standard benchmarks (lm-evaluation-harness), each asked of the larger model and of the swarm, and every
    question's two answers compared. Apart from training: training never asks a benchmark's question. Followed in place while it
    runs (/api/eval), what is being asked and how far each task is; when it ends, what the two came to, task by task."""
    root = Path(ARGS.root)
    live = job_live("eval")
    res, any_res = eval_of_config(root, d)
    tname = (d.get("target") or {}).get("name", "the larger model")
    eq = d.get("equivalence") or {}
    chosen = chosen_items(eq)
    running = live.get("running")
    shown = live if (running or live.get("phase") in ("stopped", "failed")) and live.get("tasks") else None
    by_task = {r["task"]: dict(r, targetName=res.get("target") or tname) for r in res.get("results", [])}
    lrows = {t["task"]: t for t in (shown or {}).get("tasks", [])}
    held = busy_with()
    # the headline: of every question compared in the last evaluation (of what is chosen now), how many had the same answer
    comp = [by_task[b["task"]] for t in chosen for b in t.get("benchmarks", []) if b["task"] in by_task and by_task[b["task"]].get("agree")]
    same = sum(r["agree"]["same"] for r in comp)
    of = sum(r["agree"]["of"] for r in comp)
    head = (('<span class="memnum"><b class="pct">%s%%</b><span>equivalent<small>%d of %d questions</small></span></span>' % (fmt_pct(data.percent(same, of)), same, of))
            if of else '<span class="memnum"><b class="pct none">–</b><span>equivalent<small>not evaluated yet</small></span></span>')
    # WHILE AN EVALUATION RUNS the headline is not the last one's: where the share and the count of the same answers will be, a
    # bar that moves (nothing is known until the answers are compared), and the questions it was asked to put, as chosen. Stopped
    # or failed, a run writes no result, and the last one that finished is shown again as it was
    if running:
        size_run = (job_state("eval") or {}).get("limit", live.get("limit"))
        asked_n = (int(size_run) * len([b for t in chosen for b in t.get("benchmarks") or []])) if size_run else 0
        head = ('<span class="memnum" aria-busy="true">' + busy() + '<span>equivalent'
                '<small><i class="busyn" aria-hidden="true"></i> of %s</small></span></span>' % (("%d questions" % asked_n) if asked_n else "every question"))
    size = int((live.get("limit") if running else (res.get("limit") if res else 20)) or 0)
    opts = "".join('<option value="%d"%s>%s</option>' % (n, " selected" if n == size else "", e(w)) for n, w in EVAL_SIZES)
    if running:
        ctl = '<button class="btn stop top" id="ev-stop" type="button">Stop evaluation</button>'
    else:
        ctl = ('<select id="ev-size" aria-label="How many questions of each task"%s>%s</select><button class="btn top" id="ev-go" type="button"%s>Evaluate</button>'
               % (" disabled" if held else "", opts, " disabled" if held or not chosen else ""))
    out = ['<div class="panel evalp" id="evalbox" data-phase="%s" data-run="%s"%s>' % (e(live.get("phase") or ""), e(live.get("runId") or ""), ' data-running="1"' if running else ""),
           '<div class="proghead">%s<span class="progline">Standard benchmarks (EleutherAI&#39;s lm-evaluation-harness 0.4.13), asked of %s and of the swarm, '
           'and every question&#39;s two answers compared. Kept apart from training: training never asks a benchmark&#39;s question.</span>'
           '<span class="evctl">%s</span></div>' % (head, e(tname), ctl)]
    if held and not running:
        out.append('<div class="state warn"><i></i><span>%s is running: an evaluation waits for it, since each needs the models to itself.</span></div>' % e(held[0].upper() + held[1:]))
    # WHAT IS HAPPENING NOW (painted again in place from /api/eval)
    if running or (shown and live.get("phase") in ("stopped", "failed")):
        cls = "on" if running else ("warn" if live.get("phase") == "failed" else "")
        now = live.get("now") or {}
        last = live.get("last") or {}
        out.append('<div class="evnow"><div class="state %s"><i></i><span data-ev="step">%s</span></div>'
                   '<div class="evq"%s><div class="evql"><b data-ev="q">%s</b><span data-ev="eta"></span></div><p data-ev="ask">%s</p>'
                   '<p class="muted" data-ev="reply">%s</p></div></div>'
                   % (cls, e(live.get("step") or ""), "" if now else ' hidden',
                      e(("%s · %s · question %s%s" % ("the swarm" if now.get("who") == "swarm" else tname, now.get("name", ""), now.get("i", ""), (" of %s" % now["of"]) if now.get("of") else "")) if now else ""),
                      e(" ".join(str(now.get("ask", "")).split())[-300:]), e(("Last answer (%.0f s): " % last["seconds"] + " ".join(str(last.get("reply", "")).split())[:240]) if last.get("seconds") is not None else "")))
    if not chosen:
        out.append('<p class="muted">Nothing is chosen under the models.</p>')
    for t in chosen:
        bms = t.get("benchmarks") or []
        tc = [by_task[b["task"]] for b in bms if b["task"] in by_task and by_task[b["task"]].get("agree") and not shown]
        isame, iof = sum(r["agree"]["same"] for r in tc), sum(r["agree"]["of"] for r in tc)
        out.append('<section class="evitem"><h4>%s%s</h4>' % (e(t["name"]), (' <span class="pill">%s%% equivalent</span>' % fmt_pct(data.percent(isame, iof))) if iof else ""))
        if t.get("benchmarksNote"):
            out.append('<p class="muted small">%s.</p>' % e(t["benchmarksNote"]))
        if not bms:
            out.append('<p class="muted small">No standard benchmark is mapped to it.</p>')
        for b in bms:
            lr = lrows.get(b["task"])
            r = by_task.get(b["task"]) if not shown else (dict(lr, targetName=tname) if lr and lr.get("agree") else None)
            if lr:
                bars = _ev_bar(lr, "target", tname) + _ev_bar(lr, "swarm", "The swarm")
            elif r:
                bars = _ev_bar({"target": {"state": "done", "done": (r.get("target") or {}).get("n") or 0, "of": (r.get("target") or {}).get("n")},
                                "swarm": {"state": "done", "done": (r.get("swarm") or {}).get("n") or 0, "of": (r.get("swarm") or {}).get("n")}}, "target", tname) + \
                       _ev_bar({"swarm": {"state": "done", "done": (r.get("swarm") or {}).get("n") or 0, "of": (r.get("swarm") or {}).get("n")}}, "swarm", "The swarm")
            else:
                bars = '<span class="muted small">not evaluated yet</span>'
            out.append('<div class="evrow" data-evt="%s"><div class="evname"><b>%s</b><small>Scored by %s · equivalent: %s</small></div><div class="evbars">%s</div><div class="evag" data-ag>%s</div></div>'
                       % (e(b["task"]), e(b["name"]), e(METRIC_WORDS.get(b["metric"], b["metric"].replace("_", " "))), e(COMPARE_WORDS.get(b["compare"], "")), bars, _ev_agree(r) if (r or lr) else ""))
        out.append("</section>")
    if not res and any_res and not running:
        # (an evaluation of another configuration is not this one's: said, never shown as if it were)
        out.append('<p class="meta">Not evaluated as the swarm is now (%s%s). The last evaluation, %s UTC, was of another configuration.</p>'
                   % (e(", ".join(m["name"] for m in d.get("members", {}).values() if m)), " with adapters" if data.spec_adapters(d)[0] else ", without adapters",
                      e(any_res.get("at", "")[:16].replace("T", " "))))
    if res and not running:
        when = res.get("at", "")[:16].replace("T", " ")
        out.append('<p class="meta">Last evaluated %s UTC · %s · %s questions a task · %s in all · the swarm with briefs %s%s</p>'
                   % (e(when), e(res.get("harness", "")), "every" if not res.get("limit") else res.get("limit"), e(_span(res.get("seconds") or 0)), e(res.get("briefs", "")),
                      (" · served with adapters (%s)" % e(", ".join(res["adapters"]))) if res.get("adapters") else " · without adapters"))
    out.append("</div>")
    return "".join(out)


def _originals():
    return (data._json(Path(ARGS.root) / "training" / "originals.json", None) or data._json(Path(__file__).resolve().parent.parent / "training" / "originals.json", {}) or {}).get("models", {})


def _du(p):
    """Bytes under a folder (0 where it is not there): how much of a download has arrived."""
    total = 0
    for dp, _, fs in os.walk(p):
        for f in fs:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def _iter_of(log):
    """How far an MLX run is, from its log: (iteration, train loss) of the last report, or None."""
    try:
        text = Path(log).read_text(errors="replace")[-6000:]
    except OSError:
        return None
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    hits = re.findall(r"^\s*(\d+)\s+([0-9]+\.[0-9]+)\s+[▼▲=]?", text, re.M)
    return (int(hits[-1][0]), float(hits[-1][1])) if hits else None


def pretrain_block(d):
    """PRETRAIN: a LoRA adapter for each small model of the swarm, trained with MLX on the larger model's answers to the train
    questions of what is chosen (never a benchmark's, never a held one), and kept where llama.cpp finds those answers likelier with
    it. Whether the swarm is served with them is a switch; Evaluate the swarm, before and after, says what they bought."""
    root = Path(ARGS.root)
    live = job_live("pretrain")
    running = live.get("running")
    orig = _originals()
    tgt = d.get("target") or {}
    cfg = data._json(root / "src" / "config.json", {}) or {}
    held = busy_with()
    mlx = (root / ".work" / "mlx" / "venv" / "bin" / "python").exists()
    import platform
    apple = sys.platform == "darwin" and platform.machine() == "arm64"  # (MLX runs on Apple silicon only)
    rows, good = [], 0
    lmod = {m.get("file"): m for m in live.get("models") or []}
    names = {t["id"]: t["name"] for t in (d.get("equivalence") or {}).get("targets", [])}
    for k in ("a", "b", "c", "d"):
        m = (d.get("members") or {}).get(k)
        if not m:
            continue
        o = orig.get(m.get("file")) or {}
        adir = root / ".work" / "library" / "adapters" / str(tgt.get("id", "")) / (o.get("dir") or m.get("file", ""))
        res = data._json(adir / "result.json", None)
        # (an attempt that was not kept, beside the adapter that still stands, or in place of one that never was)
        fail = data._json(adir / "failed.json", None)
        if fail and res and str(fail.get("at", "")) < str(res.get("at", "")):
            fail = None
        lm = lmod.get(m.get("file")) if running or live.get("phase") in ("stopped", "failed") else None
        if res and res.get("ok"):
            good += 1
        if lm and lm.get("state") == "training" and not running:
            it = _iter_of(lm.get("log", ""))
            what = '<small class="bad">Ended at step %d of %d, before it finished: not kept</small>' % (it[0] if it else 0, live.get("iters") or 100)
        elif lm and lm.get("state") == "training":
            it = _iter_of(lm.get("log", ""))
            n = live.get("iters") or 100
            pct = 100.0 * (it[0] if it else 0) / n
            what = ('<span class="evbar on"><i style="width:%.1f%%"></i></span><small data-pm>Training: step %d of %d%s</small>'
                    % (pct, it[0] if it else 0, n, (" · loss %.3f" % it[1]) if it else " · loading its weights"))
        elif lm and lm.get("state") == "fetching" and running:
            what = '<small data-pm>Fetching its original weights from %s · %s so far</small>' % (e(o.get("repo", "")), e(cleanup.gb(_du(lm.get("dir", "")))))
        elif lm and lm.get("state") in ("waiting", "stopped", "failed", "not trained", "fetching"):
            what = '<small>%s</small>' % e({"waiting": "Waiting its turn", "stopped": "Stopped"}.get(lm["state"], "Not adapted: " + str((lm.get("result") or {}).get("why") or lm.get("why") or "")))
        elif res and res.get("ok"):
            p = res.get("perplexity") or {}
            later = (' <span class="bad">· a later attempt was not kept: %s</span>' % e(fail.get("why") or "")) if fail else ""
            what = ('<small><b>Adapted</b> %s on %d of %s&#39;s answers (%s) · loss %s · llama.cpp perplexity on them %s → %s</small>'
                    % (e(str(res.get("at", ""))[:10]), res.get("examples") or 0, e(res.get("target") or "the larger model"), e(", ".join(names.get(i, i) for i in res.get("items") or [])),
                       e(" → ".join(str(x) for x in res.get("valLoss") or [])), p.get("without"), p.get("with")))
            what = what.replace("</small>", later + "</small>", 1)
        elif res or fail:
            what = '<small class="bad">Not kept: %s</small>' % e((res or fail).get("why") or "")
        elif o.get("cannot"):
            what = '<small class="muted">Cannot be adapted here: %s</small>' % e(o["cannot"])
        elif not o:
            what = '<small class="muted">No original weights are named for it (training/originals.json)</small>'
        elif not (root / ".work" / "mlx" / "hf" / o.get("dir", "-") / "config.json").exists():
            what = '<small class="muted">Not adapted yet · Pretrain fetches its original weights from %s, then MLX trains it</small>' % e(o.get("repo", ""))
        else:
            what = '<small class="muted">Not adapted yet · MLX trains it from %s</small>' % e(o.get("repo", ""))
        rows.append('<div class="prerow" data-pre="%s"><b>%s</b><div>%s</div></div>' % (e(m.get("file", "")), e(m.get("name", "")), what))
    on = bool(cfg.get("adapters"))
    if running:
        ctl = '<button class="btn stop top" id="pre-stop" type="button">Stop pretraining</button>'
    else:
        # (none of the swarm's small models can be adapted here: nothing to press for, and the button says why)
        none_can = not any((orig.get((m or {}).get("file")) or {}) and not (orig.get((m or {}).get("file")) or {}).get("cannot") for m in (d.get("members") or {}).values() if m)
        ctl = ('<button class="btn top" id="pre-go" type="button"%s>Pretrain</button>'
               % ((' disabled title="None of the swarm\'s small models can be adapted here: each says why"' if none_can and apple else "") or (" disabled" if held or not apple else "")))
    items = ", ".join(t["name"] for t in (d.get("equivalence") or {}).get("targets", []) if t["id"] in ((d.get("equivalence") or {}).get("chosen") or []))
    out = ['<div class="panel prep" id="prebox"%s>' % (' data-running="1"' if running else ""),
           '<div class="proghead"><span class="memnum"%s>%s<span>of %d adapted<small>LoRA, with MLX</small></span></span>'
           '<span class="progline">Each small model learns %s&#39;s answers to the train questions of %s: never a benchmark&#39;s, never a held one. '
           'An adapter is kept where llama.cpp, serving it beside the model, finds those answers likelier with it.</span><span class="evctl">%s</span></div>'
           # (while it runs, how many are adapted is not known until each model's run is checked: a bar that moves in place of the
           # number; stopped or failed, the adapters that were there are there still, and the number comes back as it was)
           % (' aria-busy="true"' if running else "", busy("0") if running else '<b class="pct">%d</b>' % good, len(rows),
              e(tgt.get("name", "the larger model")), e(items or "what is chosen"), ctl)]
    if held and not running:
        out.append('<div class="state warn"><i></i><span>%s is running: pretraining waits for it.</span></div>' % e(held[0].upper() + held[1:]))
    elif not apple and not running:
        out.append('<div class="state warn"><i></i><span>Pretrain trains with MLX, which runs on Apple silicon only: it is not available on this machine. Evaluate the swarm and training are.</span></div>')
    elif not mlx and not running:
        out.append('<div class="state"><i></i><span>MLX, the trainer, is not installed yet: Pretrain installs it (once, into <code>.work/mlx</code>) and fetches what each model needs. The Uninstall Helper takes it out again.</span></div>')
    if running or live.get("phase") in ("stopped", "failed"):
        out.append('<div class="state %s"><i></i><span data-pre-step>%s</span></div>' % ("on" if running else "warn" if live.get("phase") == "failed" else "", e(live.get("step") or "")))
    out.append('<div class="prerows">%s</div>' % "".join(rows))
    out.append('<label class="preuse"><input type="checkbox" id="pre-use"%s%s> Serve the swarm with its adapters <small>from the next time it is loaded: training, an evaluation</small></label>'
               % (" checked" if on else "", " disabled" if not good else ""))
    out.append("</div>")
    return "".join(out)


def eval_api():
    """/api/eval: the evaluation's live state, for the page to paint in place."""
    live = job_live("eval")
    live.pop("log", None)
    return live


def pretrain_api():
    """/api/pretrain: pretraining's live state, with how far the model in training is (from its MLX log)."""
    live = job_live("pretrain")
    for m in live.get("models") or []:
        if m.get("state") == "training":
            it = _iter_of(m.get("log", ""))
            m["iter"], m["loss"] = (it if it else (0, None))
        if m.get("state") == "fetching":
            m["got"] = cleanup.gb(_du(m.get("dir", "")))
    return live


def main_body(d):
    """Everything that depends on which models are chosen: drawn again, in place, when one is changed."""
    return (
        '<i id="busy" data-busy="%s" hidden></i>'
        '%s'
        '<h2>Evaluate the swarm</h2><div id="evalwrap">%s</div>'
        '<h2>Pretrain</h2><div id="prewrap">%s</div>'
        '<h2 id="arrangement">Train</h2>%s'
        % (e(busy_with()), memory_card(d), eval_block(d), pretrain_block(d), arrangement(d))
    )


def decider_pins(dec):
    """WHAT PINS THE DECISION MODEL (SwOA specification E.2): its weights and, unless the module's engine serves it, its server
    program at a commit, whatever its kind. Said where something is missing, since then it is not the one the recipe names."""
    sv = dec.get("serve") or {}
    out = ["<br><span class='muted'>kind</span> <code>%s</code>" % e(str(sv.get("kind") or "(none)"))]
    if sv.get("file") and sv.get("sha256"):
        out.append("<br><span class='muted'>weights</span> <code>%s</code> <code>sha256 %s</code>" % (e(sv["file"]), e(sv["sha256"])))
    elif sv.get("weights") and sv.get("weightsRev"):
        out.append("<br><span class='muted'>weights</span> <code>%s @ %s</code>" % (e(sv["weights"]), e(str(sv["weightsRev"])[:12])))
    elif dec.get("run") and dec.get("rev"):
        out.append("<br><span class='muted'>weights</span> <code>%s @ %s</code>" % (e(dec["run"]), e(str(dec["rev"])[:12])))
    else:
        out.append("<br><b class='bad'>weights not pinned</b>")
    if sv.get("code") and sv.get("codeRev"):
        out.append("<br><span class='muted'>server</span> <code>%s @ %s</code>" % (e(sv["code"]), e(str(sv["codeRev"])[:12])))
    elif sv.get("kind") != "llama":
        out.append("<br><b class='bad'>server program not pinned</b>")
    return "".join(out)


def class_arrangements(sp):
    """THE ARRANGEMENT FOR EACH CLASS OF INPUT THAT HAS ITS OWN (SwOA specification 4.3, 4.4): its slots, what each is told, its plan
    and its flow; and which classes run the shared arrangement above."""
    kinds = ((sp.get("recipe") or {}).get("briefs") or {}).get("kinds") or {}
    models = {k: (m or {}).get("id") for k, m in (sp.get("members") or {}).items()}
    out = []
    for c in ("tools", "talk", "code", "words"):
        k = kinds.get(c)
        if not k:
            continue
        rows = "".join("<tr><td><code>%s</code></td><td>%s</td><td>%s<details class='told'><summary>What it is told</summary><div>%s</div></details></td><td>%s</td></tr>"
                       % (e(x.get("id", "")), e(x.get("stage", "")), e(x.get("purpose", "")), e(x.get("brief", "")), e(str(models.get(x.get("member")) or ""))) for x in k.get("slots") or [])
        flow = " → ".join(_flow_words(x) for x in k["flow"]) if k.get("flow") else "the shared flow"
        plan = ", ".join("%s %s" % (e(str(a)), e(json.dumps(b))) for a, b in (k.get("plan") or {}).items()) or "the shared plan"
        out.append("<h4>The %s arrangement (its own)</h4><p class='small' style='margin:0 0 6px'><span class='muted'>Flow:</span> %s<br><span class='muted'>Plan:</span> %s</p>"
                   "%s" % (e(c), e(flow), plan, ("<table class='spec slots4'><tr><th>Slot</th><th>Stage</th><th>What it is for</th><th>Model</th></tr>%s</table>" % rows) if rows else "<p class='muted small'>the shared slots</p>"))
    shared = [c for c in ("tools", "talk", "code", "words") if c not in kinds]
    lead = "<p class='muted small' style='margin:8px 0 0'>Input is sorted into four classes from the request alone (tools, talk, code, words). %s run%s the shared arrangement above.</p>" % (
        e(", ".join(shared)) if shared else "None", "s" if len(shared) == 1 else "")
    return lead + "".join(out)


def proof_block(sp):
    """THE PROOF of the SwOA (docs/swoa.md): each harness task's score for the module and for its target, and the gap, measured on
    exactly this SwOA. A result on fewer than data.PROOF_MIN_N questions is shown as a check, not proof."""
    pr = sp.get("proof") or {}
    tg = (sp.get("target") or {}).get("name") or "the target"
    rows = "".join(
        "<tr><td>%s<br><span class='muted'>%s %s · %s</span></td><td>%d of %s</td><td><b>%.3f</b> <span class='muted'>± %.3f</span></td><td>%.3f <span class='muted'>± %.3f</span></td>"
        "<td><b class='%s'>%+.3f</b> <span class='muted'>± %.3f</span></td><td>%s</td></tr>"
        % (e(str(x.get("name"))), e(str(x["harness"].get("name"))), e(str(x["harness"].get("version"))), e(str(x.get("metric"))),
           x.get("n") or 0, e(str(x.get("of"))), x["swoa"]["value"], x["swoa"].get("stderr") or 0, x["target"]["value"], x["target"].get("stderr") or 0,
           "bad" if x["gap"] < 0 else "", x["gap"], x.get("gapStderr") or 0, "<span class='pill up'>Proof</span>" if x.get("proof") else "<span class='pill'>Check</span>")
        for x in pr.get("results") or [])
    body = ("<table class='spec'><tr><th>Task</th><th>Questions</th><th>SwOA</th><th>%s</th><th>Gap</th><th></th></tr>%s</table>" % (e(tg), rows)
            if rows else "<p class='muted small' style='margin:0'>No harness result has been measured on this SwOA's arrangement yet: Evaluate the swarm.</p>")
    return "<h4>Proof</h4><p class='muted small' style='margin:0 0 6px'>%s.</p>%s" % (e(str(pr.get("rule") or "").capitalize()), body)


def chips(d):
    """Beside the title: which pass it is, how far toward parity, and the way in to the SwOA spec (with how many kept changes its
    arrangement carries now: data.learned_live). Read again while a pass runs."""
    out = []
    live = data.learned_live(d["learned"])
    out.append('<button class="specbtn" id="spec-open" type="button" title="The SwOA spec: the swarm module as it stands, what tunes it, and the proof">SwOA spec%s</button>'
               % (("<span>%d learned</span>" % live) if live else ""))
    out.append('<button class="specbtn tidy" id="tidy-open" type="button" title="What the Swarm has put on this machine, and taking out what you do not want">Uninstall Helper</button>')
    return "".join(out)


def tidy_panel(d, said=""):
    """The Uninstall Helper: everything the Swarm has fetched or kept here, by group, each with the room it takes, whether the
    configured swarm uses it, and a button to remove it (ui/cleanup.py does the removing, and refuses anything outside .work)."""
    items = cleanup.inventory(ARGS.root, d)
    running = bool(busy_with())
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
        'Removing a piece cannot be undone. One marked <i>in use</i> is part of the swarm as it is configured: Train fetches it again. '
        'What training has learned (the briefs, the arrangement, each configuration\'s record) is not an install, and is not listed; Pretrain\'s adapters are, since Pretrain makes them again.%s</p>'
        '%s<ul class="tlist">%s</ul>'
        % (e(cleanup.gb(total)), " A session is running: stop it before removing anything." if running else "",
           ('<p class="tsaid">%s</p>' % e(said)) if said else "", "".join(rows) or '<li class="muted">Nothing is installed here.</li>')
    )


def page(d):
    banner = '<div class="banner">Sample data, made up to show the layout. It is not a measurement of anything.</div>' if d["sample"] else ""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>The Swarm</title><meta name="swarm-build" content="' + BUILD + '"><style>%s</style></head><body><div class="shell">'
        # (shown when the dashboard's code has changed since this page was drawn: a note and a button, never a reload on its own)
        '<div class="updnote" id="updnote" hidden><span>The dashboard was updated since this page was opened.</span><button class="btn top" id="upd-go" type="button">Refresh</button></div>'
        '<main id="top"><header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div>'
        '<div class="chips" id="chips">%s</div></header>%s%s'
        '<div id="body">%s</div>'
        '%s</main></div><dialog id="spec"><div id="spec-body"></div></dialog><dialog id="qedit"><div id="qedit-body"></div></dialog><dialog id="tidy"><div id="tidy-body"></div></dialog><dialog id="steerd"><div id="steerd-body"></div></dialog><dialog id="recd"><div id="recd-body"></div></dialog>'
        '<script>%s</script></body></html>'
        % (CSS, chips(d), config_section(d), banner, main_body(d), footer(), JS)
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
            # the loop's finished questions, for the pips (training/loop.mjs: training/results/<configuration>/questions.json)
            lp = d.get("loop") or {}
            now["track"] = {"pass": lp.get("pass"), "of": lp.get("of"), "done": track_of(lp)}
            return self._send(json.dumps(now), kind="application/json")
        if u.path == "/fragment/body":
            return self._send(main_body(d))
        if u.path == "/api/eval":
            return self._send(json.dumps(eval_api()), kind="application/json")
        if u.path == "/api/pretrain":
            return self._send(json.dumps(pretrain_api()), kind="application/json")
        if u.path == "/api/build":
            return self._send(json.dumps({"build": BUILD}), kind="application/json")
        if u.path == "/api/busy":
            return self._send(json.dumps({"busy": busy_with()}), kind="application/json")
        if u.path == "/fragment/faces":
            # (204 where the page already has these faces: nothing to draw again)
            if parse_qs(u.query).get("k", [""])[0] == faces_key(d):
                return self._send("", 204)
            return self._send(faces_block(d))
        if u.path == "/fragment/eval":
            return self._send(eval_block(d))
        if u.path == "/fragment/pretrain":
            return self._send(pretrain_block(d))
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
        if u.path == "/fragment/equiv":
            return self._send(equiv(d, inner=True))
        if u.path == "/fragment/tools":
            return self._send(tools_toggle(d, inner=True))
        if u.path == "/fragment/tidy":
            return self._send(tidy_panel(d))
        if u.path == "/fragment/questions":
            return self._send(questions_panel(d, parse_qs(u.query).get("id", [""])[0]))
        if u.path == "/fragment/run":
            return self._send(progress_strip(data.load(ARGS.root)))
        if u.path == "/fragment/score":
            return self._send(progress_strip(d))
        if u.path == "/fragment/steer":
            return self._send(steer_dialog(d))
        if u.path == "/fragment/plan":
            return self._send(plan_block(d))
        if u.path == "/fragment/list":
            return self._send(qlist(d, split))
        if u.path == "/fragment/question":
            return self._send(question(d, split, q.get("id", "")))
        return self._send("Not here.", 404, "text/plain; charset=utf-8")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/run/start", "/run/stop", "/run/clear", "/config", "/questions", "/uninstall", "/steer", "/spec/publish",
                        "/eval/start", "/eval/stop", "/pretrain/start", "/pretrain/stop"):
            return self._send("Not here.", 404, "text/plain; charset=utf-8")
        # only this page may start or stop a pass: another website can send a plain form to this address, but it cannot
        # send this header, and a request that names another origin is refused
        origin = self.headers.get("origin", "")
        if self.headers.get("x-swarm") != "1" or (origin and urlparse(origin).netloc != self.headers.get("host", "")):
            return self._send("Not from this page.", 403, "text/plain; charset=utf-8")
        if path in ("/eval/start", "/eval/stop"):
            if path == "/eval/stop":
                stop_job("eval")
                return self._send(eval_block(data.load(ARGS.root)))
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 200)) or b"{}")
            except ValueError:
                asked = {}
            limit = asked.get("limit") if isinstance(asked, dict) else None
            if limit not in [n for n, _ in EVAL_SIZES]:
                return self._send("Choose how many questions of each task.", 400, "text/plain; charset=utf-8")
            why = start_job("eval", ["sh", "training/evaluate.sh"] + (["--limit", str(limit)] if limit else []), keep={"limit": limit})
            if why:
                return self._send(why, 409, "text/plain; charset=utf-8")
            time.sleep(0.3)
            return self._send(eval_block(data.load(ARGS.root)))
        if path in ("/pretrain/start", "/pretrain/stop"):
            if path == "/pretrain/stop":
                stop_job("pretrain")
            else:
                why = start_job("pretrain", [node_for_training() or "node", "training/adapters.mjs", "train"])
                if why:
                    return self._send(why, 409, "text/plain; charset=utf-8")
                time.sleep(0.3)
            return self._send(pretrain_block(data.load(ARGS.root)))
        if path == "/run/clear":
            ok, said = clear_state()
            if not ok:
                return self._send(said, 409, "text/plain; charset=utf-8")
            return self._send(progress_strip(data.load(ARGS.root), cleared=said))
        if path == "/spec/publish":
            # A SwOA, WRITTEN WHERE IT IS COMMITTED (specs/<name>.swoa.json, and its card specs/<name>.swoa.md; docs/swoa.md).
            # Refused without proof: what training leaves on the way stays on this machine
            d = data.load(ARGS.root)
            sp = data.spec(d)
            why_not = data.publishable(sp)
            if why_not:
                return self._send(why_not, 409, "text/plain; charset=utf-8")
            f = data.published_file(ARGS.root, sp)
            f.parent.mkdir(parents=True, exist_ok=True)
            for target, text in ((f, data.published_text(sp)), (data.card_file(ARGS.root, sp), data.swoa_card(sp))):
                tmp = target.with_name(target.name + ".tmp")
                tmp.write_text(text)
                tmp.replace(target)
            return self._send(spec_panel(d))
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
            return self._send(plan_block(data.load(ARGS.root)))
        if path == "/uninstall":
            # one piece the Uninstall Helper lists, by its id: never while a session runs, never a decider's files while one is loaded
            held = busy_with()
            if held:
                return self._send("%s is running: stop it before removing anything." % (held[0].upper() + held[1:]), 409, "text/plain; charset=utf-8")
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            d = data.load(ARGS.root)
            ok, said = cleanup.remove(ARGS.root, d, str(asked.get("id", "")) if isinstance(asked, dict) else "", decider_up=bool(decider_base()))
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
            if (run_state() or {}).get("running") and set(asked) - {"equivalence", "tools", "adapters"}:
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
            if "adapters" in asked:
                # served with the adapters Pretrain trained, or without (from the next time the swarm is loaded)
                if not isinstance(asked["adapters"], bool):
                    return self._send("On or off.", 400, "text/plain; charset=utf-8")
                if asked["adapters"]:
                    now["adapters"] = True
                else:
                    now.pop("adapters", None)
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
            # (a short list on one line, as the repository's formatter writes it: src/catalog.mjs configText)
            text = re.sub(r'\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]', lambda m: "[" + ", ".join(re.split(r",\n\s+", m.group(1))) + "]", json.dumps(now, indent=2))
            (root / "src" / "config.json").write_text(text + "\n")
            return self._send(main_body(data.load(ARGS.root)))
        if path == "/run/start":
            start_run()
        else:
            stop_run()
        return self._send(progress_strip(data.load(ARGS.root)))

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
