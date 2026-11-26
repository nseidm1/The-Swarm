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
import threading
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
# THE CARDS' OWN START BUTTONS ARE NOT DRAWN: the Run card starts and stops the whole of it, each step on the same questions
# (training/run.sh). A step started by itself from its card measured another state of the swarm than the steps before it, which
# is how stored results stopped being comparable. `--card-starts` draws them again, for a person who wants one step alone.
CARD_STARTS = False


def _starts(html, ids, also=()):
    """A card's controls without its own Start and Stop (the buttons and choosers named by id, and any piece of text that only
    explains one of them), unless the page was started to draw them."""
    if CARD_STARTS:
        return html
    for i in ids:
        html = re.sub(r'<(button|select)\b[^>]*\bid="%s"[^>]*>.*?</\1>' % re.escape(i), "", html, flags=re.S)
    for pat in also:
        html = re.sub(pat, "", html, flags=re.S)
    return html


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
.madeof{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.madeof .cfgl{flex:0 0 auto}.madeof small{flex:1 1 320px;font-size:12.5px;color:var(--mist);line-height:1.4}
.madeof .seg i{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);margin-left:6px}
.recbadge{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:var(--r);padding:4px 11px;background:#fdf0cf;color:#8a5a00;font:inherit;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 0 0 1px #f3dfb8}
.recbadge i{width:7px;height:7px;border-radius:50%;background:#e8a317;box-shadow:0 0 0 3px #f9d98a;animation:p 1.6s infinite}.recbadge:hover{background:#fae6b5}.recbadge:focus-visible{outline:2px solid var(--teal2);outline-offset:2px}
dialog#recd{border:0;border-radius:var(--r);padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#recd::backdrop{background:rgba(11,40,38,.45)}
.recs{list-style:none;margin:0;padding:0;display:grid;gap:10px}.rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 16px;border-radius:var(--r);border:1px solid var(--line2);background:#fafdfc}
.rec b{display:block;font-size:15.5px;margin-top:6px}.rec p{margin:6px 0 4px;font-size:13.5px;line-height:1.5;color:var(--fog)}.rec small{color:var(--mist);font-size:12px}
.rstr{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:var(--r);background:#d7f3e9;color:var(--right)}.rec.untested .rstr{background:var(--soft);color:var(--mist)}.rec.early .rstr{background:#fdf0cf;color:#8a5a00}.rec.info .rstr{background:#e6e9f6;color:var(--tgt)}.rec.info{grid-template-columns:minmax(0,1fr)}
.hostcard{padding:14px 16px;border-radius:var(--r);border:1px solid var(--line2);background:#fafdfc}.hostcard p{margin:6px 0 0;font-size:13.5px;line-height:1.5}.hcbadge{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:var(--r);background:#fdf0cf;color:#8a5a00;font-size:12px;font-weight:700}
.hcon{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.hcon span{padding:2px 10px;border-radius:var(--r);background:var(--soft);font-size:12px;font-weight:700;color:var(--teal)}
details.fams{margin-top:10px}details.fams summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--teal)}details.fams table{margin-top:6px}
/* THE TABLE BY FAMILY FITS A PHONE: its headings may wrap (they held the table wider than the card, and the family's name was broken letter by letter to make room), a family's name breaks between words, and the columns share the width */
.fams table.spec th{white-space:normal}.fams table.spec td:first-child{overflow-wrap:break-word;word-break:normal}
@media (max-width:760px){.fams table.spec{table-layout:fixed;font-size:12.5px}.fams table.spec th{font-size:9.5px;letter-spacing:.04em}.fams table.spec th,.fams table.spec td{padding:7px 5px}.fams table.spec th:first-child{width:34%}}
details.told{margin-top:4px}details.told summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--teal)}details.told div{margin-top:4px;white-space:pre-wrap;font-size:12.5px;color:var(--fog)}.spec .bad{color:var(--wrong)}
.equiv .tools{margin-top:12px}
.tgl{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:var(--r);background:var(--soft)}.tgl .seg{border:0;background:none;font:inherit;font-size:13px;font-weight:700;color:var(--mist);padding:7px 14px;border-radius:var(--r);cursor:pointer}
.tgl .seg.on{background:#fff;color:var(--teal);box-shadow:0 1px 4px rgba(11,93,87,.15)}.tgl .seg:focus-visible{outline:3px solid var(--teal2)}fieldset.tools{margin-top:12px}
.rec.engine{grid-template-columns:minmax(0,1fr) 168px;align-items:center}.eng{display:grid;gap:8px;justify-items:stretch}.eng .btn{margin:0;width:100%;padding:11px 14px}.eng .btn:disabled{cursor:default}.eng .btn.busy{background:var(--soft);color:var(--fog);box-shadow:none}.eng .btn.done{background:#d7f3e9;color:var(--right);box-shadow:none;opacity:1}
.eng .engp{width:100%;height:6px;accent-color:var(--sun)}.eng .engs{color:var(--mist);font-size:11.5px;line-height:1.4;overflow-wrap:anywhere}.eng .engs:empty{display:none}
.rec.engine code{font-size:12px;overflow-wrap:anywhere}.rec small.where{display:block;overflow-wrap:anywhere}
@media (max-width:700px){.rec.engine{grid-template-columns:minmax(0,1fr)}.eng{margin-top:4px}}
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
/* under the pills, two rows, each a label and what it holds: who takes a turn with tools, and the questions a person wrote (one
   button for each body of work, which opens its questions). Nothing here chooses what the swarm is trained on: it is trained on
   every body of work */
.cfgrows{display:grid;gap:10px;margin:12px 0 0;min-width:0}.cfgrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0}
.cfgl{flex:0 0 148px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
.ownq{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.ownb{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);font:inherit;font-size:13px;font-weight:700;color:var(--fog);padding:6px 10px;cursor:pointer}
.ownb em{font-style:normal;color:var(--teal)}.ownb svg{width:13px;height:13px;fill:none;stroke:var(--mist);stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
.ownb:hover,.ownb:focus-visible{border-color:var(--teal2);color:var(--teal)}.ownb:hover svg,.ownb:focus-visible svg{stroke:var(--teal)}
.cfgrows .cfgl{flex-basis:232px}
@media (max-width:560px){.cfgl,.cfgrows .cfgl{flex-basis:100%}}
dialog#qedit{border:0;border-radius:var(--r);padding:26px;max-width:min(760px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}
dialog#qedit::backdrop{background:rgba(11,40,38,.45)}dialog#qedit h4{margin:22px 0 6px}
.qlist{list-style:none;margin:0;padding:0;display:grid;gap:8px}.qrow{display:flex;gap:8px;align-items:flex-start;min-width:0}
.qrow textarea{flex:1 1 auto;min-width:0;resize:vertical;font:inherit;font-size:14px;line-height:1.4;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);color:var(--fog)}
.qside{display:flex;gap:6px;align-items:center;flex:none}.qside select{font:inherit;font-size:13px;padding:7px 6px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);color:var(--fog)}
.qdel{width:32px;height:32px;border:0;border-radius:var(--r);background:var(--soft);color:var(--mist);font-size:18px;line-height:1;cursor:pointer}.qdel:hover{background:#fde1db;color:var(--wrong)}
.qbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}.qbar #qcount{margin-right:auto}
.qmade{margin:0;padding-left:18px;columns:2 220px;font-size:13px;color:var(--mist)}
@media (max-width:560px){.qrow:has(select){flex-wrap:wrap}.qrow:has(select) .qside{width:100%;justify-content:flex-end}}
/* two groups: the small models, and what they are set against (the decider and the larger model). In one row where both fit; where
   they do not, the second group goes under the first whole, so a row is never one stray pill */
.picks>.group{display:flex;flex-wrap:wrap;gap:10px;flex:1 1 auto;min-width:0}.picks>.group.small{flex-grow:3}.picks>.group.against{flex-grow:2}
.picks .pick{flex:1 1 185px}.picks .pick.target{flex:1.6 1 300px}
.specbtn{font:inherit;font-size:12.5px;font-weight:800;color:var(--fog);background:var(--panel);border:0;border-left:4px solid var(--sun);border-radius:var(--r);padding:7px 14px;box-shadow:var(--shadow);cursor:pointer;white-space:nowrap}
.specbtn span{font-weight:700;color:var(--mist);margin-left:6px}.specbtn.tidy{border-left-color:var(--coral)}
.lgl li[data-pt]{cursor:pointer}.lgl li[data-pt].off{opacity:.38}.lgl li[data-pt].off b{text-decoration:line-through}svg g[data-pt].off{display:none}.specbtn.serve{border-left-color:var(--teal2)}.specbtn.serve[disabled]{opacity:.55;cursor:not-allowed}.specbtn.serve.on i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--right);margin-right:7px}
.specbtn.serve.starting{color:var(--mist)}.serveurl{font:600 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fog);background:var(--panel);border-radius:var(--r);padding:7px 12px;box-shadow:var(--shadow);cursor:copy;user-select:all;white-space:nowrap}
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
.viz .vintro{margin:0 0 12px;font-size:12.5px;color:var(--mist);line-height:1.5}.viz .vfoot{margin:6px 0 0;font-size:12px;color:var(--mist);line-height:1.45}.viz .vsub{margin:18px 0 10px;padding-top:12px;border-top:1px solid var(--line2);font-size:13px;color:var(--fog)}.viz .vlane{margin:0 0 16px}.viz .vlane:last-child{margin-bottom:0}.viz .vhead{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin:0 0 6px}.viz .vkey{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--teal);color:#fff;font-weight:800;font-size:12px}
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
/* which bodies of work an evaluation asks: a box for each, under the card's heading, every one ticked to begin with */
.evask{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:12px 0 0;min-width:0}.evask .cfgl{flex:0 0 auto;margin-right:6px}
.evask label{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);font-size:13px;font-weight:700;color:var(--fog);padding:6px 10px;cursor:pointer}
.evask label small{font-weight:600;color:var(--mist);font-size:11.5px}.evask label.none{opacity:.45;border-style:dashed;background:var(--panel)!important}.evask.evharn{margin-top:8px}
.evspeed{margin:10px 0 0;font-size:13.5px;color:var(--fog);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}.evspeed .cfgl{flex:0 0 auto;margin-right:6px}
.passprog{margin-top:14px;display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--fog)}.passprog .evbar{flex:1 1 160px;max-width:420px;height:8px}.passprog b{font-size:15px;color:var(--teal)}
.trainbelow{margin-top:14px;display:grid;gap:10px}.trainbelow .evwhy{font-size:12.5px;font-weight:600;color:var(--mist);line-height:1.45}
.trainopts{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 14px}
.trainopts .trainask{margin:0;flex:1 1 320px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,190px));gap:6px 8px}
.trainopts .trainask .cfgl{grid-column:1/-1;margin:0}
.trainopts .btn{width:auto;margin:0 0 0 auto;padding:7px 12px;font-size:12.5px;white-space:nowrap}.evd-h{margin:14px 0 0}
.evask input{width:15px;height:15px;margin:0;accent-color:var(--teal)}.evask label:has(input:checked){border-color:var(--teal2);background:#eefaf6}.evask label:has(input:disabled){cursor:default;opacity:.6}
.evalp>.state,.prep>.state,.evnow{margin-top:12px}.evq{margin-top:8px;padding:10px 12px;border-radius:var(--r);background:var(--soft);font-size:13px}
.evq .evql{display:flex;flex-direction:column;gap:2px}.evq .evql b{font-size:17px;line-height:1.3}.evq .evql span{color:var(--mist);font-size:15px;font-variant-numeric:tabular-nums}.evq p{margin:6px 0 0;overflow-wrap:anywhere;line-height:1.45}
.evitem{margin-top:18px}.evitem h4{margin:0 0 6px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.evitem .psecb>p{margin:0 0 10px;line-height:1.45}
.evalp details.psec>summary{list-style:none;cursor:pointer;border-radius:var(--r)}.evalp details.psec>summary::-webkit-details-marker{display:none}
.evalp details.psec>summary:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}
.evalp details.psec>summary>h4::after{content:'';flex:none;width:6px;height:6px;margin-left:2px;border-right:2px solid var(--teal2);border-bottom:2px solid var(--teal2);transform:rotate(45deg);transition:transform .15s}
.evalp details.psec:not([open])>summary>h4::after,.evalp details.psec.shutting>summary>h4::after{transform:rotate(-45deg)}
.evalp details.psec:not([open])>summary>h4{margin-bottom:2px}.evalp details.psec:not([open]){border-top:1px solid var(--line2);padding-top:12px;margin-top:12px}
.evalp .pmeta{display:block;font-size:13px;color:var(--mist);font-weight:600;line-height:1.4;overflow-wrap:anywhere;margin:0}.evalp details.psec[open]>summary>.pmeta{display:none}.evalp details.psec.shutting>summary>.pmeta{display:block}
.evalp .evsum{display:block;max-width:560px;margin-top:8px}.evalp details.psec[open]>summary>.evsum{display:none}.evalp details.psec.shutting>summary>.evsum{display:block}.evsum.asking .evbar i{background:var(--sun)}
.evall>summary>h4{margin:0 0 6px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.evall{margin-top:14px}.evall[open]>.psecb>.evitem:first-child{margin-top:10px}
.evrow{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(200px,1.4fr) minmax(200px,1.3fr);gap:6px 16px;padding:10px 0;border-top:1px solid var(--line2);align-items:center}
.evname b{display:block;font-size:14px}.evname small,.evag small{display:block;font-size:12px;color:var(--mist);line-height:1.35;margin-top:2px}
.evbars{display:grid;gap:10px}.evw small{display:block;font-size:12px;color:var(--mist);margin-top:2px;overflow-wrap:anywhere}.evw small b{color:var(--fog)}
.evbar{display:block;height:8px;border-radius:var(--r);background:var(--soft);overflow:hidden}.evbar i{display:block;height:100%;width:0;background:var(--teal2);transition:width .6s ease}
.evw[data-w="target"] .evbar i{background:var(--tgt)}.evw.asking .evbar i{background:var(--sun)}.evw.failed .evbar i{background:var(--wrong)}.evw.kept .evbar i{opacity:.55}
.evag .evpct{font-size:20px;margin-right:4px}.prerows{margin-top:12px}.prerow{display:grid;grid-template-columns:minmax(130px,.6fr) minmax(0,2fr);gap:4px 16px;padding:10px 0;border-top:1px solid var(--line2);align-items:center}
.prerow small{display:block;font-size:12.5px;color:var(--fog);line-height:1.4;margin-top:2px}.prerow .evbar{height:8px}.preuse{display:flex;gap:8px;align-items:baseline;margin-top:12px;font-weight:700;font-size:14px;flex-wrap:wrap}
.preuse small{font-weight:500;color:var(--mist);font-size:12px}.cfgrow .preuse{margin-top:0}
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
dialog#evd{border:0;border-radius:var(--r);padding:26px;max-width:min(860px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#evd::backdrop{background:rgba(11,40,38,.45)}
/* THE EVALUATE CARD'S HEADLINE IS A BUTTON (it opens the table, score beside score): it keeps the look of a headline, and says it can be pressed */
.adline{display:flex;gap:14px;align-items:flex-start;margin:14px 0 4px;padding-top:12px;border-top:1px solid var(--line,#e6ecea)}.adline small{display:block;color:var(--mist);font-size:12.5px;line-height:1.45}.adline p{margin:6px 0 0}
.stgs{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:8px}.stg{border:1px solid var(--line,#d9e4e1);border-radius:10px;padding:10px 12px;min-width:0}.stg.running{border-color:#c98a0b;background:rgba(201,138,11,.05)}.stg.waiting{opacity:.78}.stgh{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between;align-items:baseline;font-size:14px}.stgh i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c8d4d0;margin-right:8px}.stg.done .stgh i{background:#0f6b5a}.stg.running .stgh i{background:#c98a0b}.stg.failed .stgh i{background:#a23b2a}.stg.stopped .stgh i,.stg.not-taken .stgh i{background:#7a8a86}.stgh small{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:10.5px;opacity:.8}.stg p{margin:6px 0 0}.stgw{margin:4px 0 0;padding-left:20px}.stgw li{margin:2px 0}.stgw li[data-s=on]{font-weight:600}.stgw li[data-s=done]{opacity:.72}.stgt{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin:14px 0 0;opacity:.8}.wsl{list-style:none;margin:10px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.ws{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--line,#d9e4e1);border-radius:10px;font-size:13px;min-width:0}.ws i{width:10px;height:10px;border-radius:50%;background:#c8d4d0}.ws.done i{background:#0f6b5a}.ws.running i{background:#c98a0b}.ws.failed i{background:#a23b2a}.ws.not-taken i,.ws.stopped i{background:#7a8a86}.ws small{opacity:.75}.wholet{display:flex;gap:6px;align-items:center;font-size:13px}@media(max-width:760px){.wsl{grid-template-columns:1fr}}
.cmph{margin:0 0 8px;font-size:15px}#evd{overflow-x:hidden}.evdsec{margin:14px 0 0}.evdsec+.evdsec{margin-top:22px;padding-top:16px;border-top:1px solid var(--line,#d9e4e1)}.cmpt{margin:0 0 6px}.cmpt tr.sum td{font-weight:700;border-top:2px solid var(--line,#d9e4e1)}.cmpbars{display:flex;flex-direction:column;gap:8px;margin:0 0 6px}.cmpbar{display:grid;grid-template-columns:minmax(120px,190px) 1fr minmax(110px,auto);gap:10px;align-items:center;font-size:13px}.cmpbar .mbar{position:relative;height:14px;background:#e4eeeb;border-radius:7px}.cmpbar .mbar i{position:absolute;left:0;top:0;bottom:0;background:#0f6b5a;border-radius:7px}.cmpbar .mbar u{position:absolute;top:-3px;bottom:-3px;border-left:2px solid #1d2b27;border-right:2px solid #1d2b27;background:rgba(29,43,39,.18)}.cmpbar .mbar s{position:absolute;top:-6px;bottom:-6px;border-left:2px dashed #3d4a8f}.cmpbar.none{opacity:.5}
.cmp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 4px}.cmpc{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--line,#d9e4e1);border-radius:10px;min-width:0}.cmpc b{font-size:13px}.cmpv{font-size:22px;font-weight:700}.cmpv i{font-style:normal;font-size:12px;font-weight:400;margin-left:6px;opacity:.7}.cmpc small{font-size:12px;opacity:.8}.cmpc.none .cmpv{opacity:.4}.cmpc small b.up{color:#0b6b57}.cmpc small b.down{color:#a23b2a}@media(max-width:640px){.cmp{grid-template-columns:1fr}}
.evhead{display:flex;flex-direction:column;gap:10px;align-items:flex-start;min-width:0}.evviews{display:flex;gap:8px;flex-wrap:wrap}.evviews .btn{padding:8px 14px;font-size:13px;white-space:nowrap}.ptab{font-family:Georgia,'Times New Roman',serif;color:var(--fog)}.ptab caption{caption-side:top;text-align:left;font-size:13.5px;line-height:1.5;padding:0 0 10px}.ptab caption b{font-weight:700}.ptab table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums;border-top:2px solid var(--fog);border-bottom:2px solid var(--fog)}.ptab th,.ptab td{padding:5px 10px;text-align:right;border:0;white-space:nowrap}.ptab th:first-child,.ptab td:first-child{text-align:left;white-space:normal}.ptab thead th{font-weight:400;border-bottom:1px solid var(--fog)}.ptab tr.pg td{font-style:italic;padding-top:10px;text-align:left}.ptab tr.pall td{border-top:1px solid var(--fog);padding-top:7px}.ptab td small{color:var(--mist);font-size:.82em}.ptab-wrap{overflow-x:auto;margin-top:12px}.ptab-act{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}#evd-latex{width:100%;min-height:160px;margin-top:10px;font:12px ui-monospace,Menlo,monospace}dialog#tqd{border:0;border-radius:var(--r);padding:26px;max-width:min(900px,94vw);width:100%;max-height:90vh;box-shadow:0 30px 80px rgba(11,93,87,.3);color:var(--fog);background:var(--panel)}dialog#tqd::backdrop{background:rgba(11,40,38,.45)}.tqctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.tqctl select,.tqctl input{font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:var(--r);border:1px solid var(--line);color:var(--fog);background:var(--panel)}.tqctl input{flex:1 1 160px;min-width:0}.tql{list-style:none;margin:0;padding:0;display:grid;gap:10px}.tql li{border:1px solid var(--line2);border-radius:var(--r);padding:12px 14px}.tqh{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}.tqh small{color:var(--mist);font-size:12px;font-weight:600}.tqa{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.5}.tqb{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.45;color:var(--mist)}.tqb b{color:var(--fog)}.tqw{display:block;margin-top:6px;color:var(--mist);overflow-wrap:anywhere}@media (max-width:760px){dialog#tqd{padding:18px 12px}}.evbench select{font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:var(--r);border:1px solid var(--line);color:var(--fog);background:var(--panel);max-width:100%}.evbench{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}.evbench .seg small{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#9a5b00;margin-left:4px}.evbench .seg:disabled{opacity:.45;cursor:default}.evchart{margin-top:12px}.evchart svg{display:block;width:100%;height:auto;max-width:720px}.evchart .ax{stroke:var(--line);stroke-width:1}.evchart .tk{fill:var(--mist);font-size:11px}.evchart .lb{fill:var(--fog);font-size:12.5px;font-weight:700}.evchart .sb{fill:var(--mist);font-size:11.5px}.evchart .at{fill:var(--mist);font-size:11.5px;font-weight:700;letter-spacing:.04em}.evchart .pn{fill:#fff;font-size:11px;font-weight:800}.evchart .lgl{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px;font-size:13px;color:var(--fog)}.evchart .lgl li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.evchart .lgl i{flex:none;display:inline-block;min-width:20px;height:20px;line-height:20px;border-radius:50%;text-align:center;color:#fff;font-style:normal;font-size:11px;font-weight:800}.evchart .lgl span{color:var(--mist);font-variant-numeric:tabular-nums}.evchart .lgl i.hollow{background:var(--panel)}.evchart .lgl em{font-style:normal;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--mist)}.evchart .lgl li.mine{background:var(--soft);border-radius:var(--r);padding:6px 8px;margin:0 -8px}.evchart .lgl li.mine em{color:var(--teal)}.lgl li.mine.tgt em{color:var(--tgt)}.evchart .pn.hollow{font-weight:800}.evopen{appearance:none;border:0;background:none;padding:6px 10px;margin:-6px -10px;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:12px;max-width:100%}
.evopen:hover{background:rgba(11,93,87,.07)}.evopen:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
/* THE TABLE FITS ITS DIALOG, at any width, with no sideways scroll: a column's heading may wrap (the larger model's name is long), a figure never does; on a phone the cells are tighter and the count of questions, the one column that is not a score, is left out */
.evt-wrap{margin-top:12px;max-width:100%}table.spec.evt{table-layout:fixed}table.evt thead th.num{width:13%}table.evt thead th.evtg{width:22%}table.evt-m thead th.num{width:11%}table.evt-m thead th.evtg{width:15%}table.evt-m thead th.evm{width:12%}table.evt td.evm{color:var(--mist)}table.spec.evt th,table.spec.evt td{padding:7px 8px;overflow-wrap:normal}table.evt td.num,table.evt th.num{text-align:right;font-variant-numeric:tabular-nums}table.evt td.num{white-space:nowrap}dialog#evd table.spec.evt thead th{white-space:normal}
table.evt th:first-child,table.evt td:first-child{overflow-wrap:anywhere}
@media (max-width:760px){dialog#evd{padding:18px 12px}table.spec.evt{font-size:12px;table-layout:fixed}table.evt th:first-child{width:30%}table.spec.evt th,table.spec.evt td{padding:6px 4px}table.spec.evt thead th{font-size:9.5px;letter-spacing:.04em}table.evt .evn{display:none}
  table.evt tr.evt-task td:first-child{padding-left:12px}table.evt i.up,table.evt i.down{display:block;margin-left:0}}
@media (max-width:360px){dialog#evd{padding:16px 8px}table.spec.evt{font-size:11px}table.spec.evt th,table.spec.evt td{padding:5px 3px}table.spec.evt thead th{font-size:8.5px;letter-spacing:0}table.evt tr.evt-task td:first-child{padding-left:8px}}
table.evt tr.evt-item th{font-weight:800;text-align:left}table.evt tr.evt-item td{font-weight:700}table.evt tr.evt-task td:first-child{padding-left:26px;color:var(--mist)}
table.evt tr.evt-all th,table.evt tr.evt-all td{border-top:2px solid var(--teal);font-weight:800;text-align:left}table.evt tr.evt-all td.num{text-align:right}
table.evt b.evt-unread{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--wrong);margin-left:6px;white-space:nowrap}table.evt b.up{color:var(--right)}table.evt b.down{color:#9a5b00}table.evt i.up,table.evt i.down{font-style:normal;font-size:11px;font-weight:800;margin-left:4px}table.evt i.up{color:var(--right)}table.evt i.down{color:var(--wrong)}
table.evt tr.evt-old td,table.evt tr.evt-old th,table.evt tr.evt-old b{color:var(--mist);font-weight:500}.evold{color:#9a5b00}
/* A SECOND LOOK AT WHAT FELL SHORT (Evaluate) and WHAT PRETRAIN IS AIMED AT: a quieter button under the main one, and what it does in a line */
.evpair{display:flex;gap:8px;flex:1 1 auto;flex-wrap:wrap;min-width:0}.evpair .btn{flex:1 1 auto;white-space:nowrap;padding-left:12px;padding-right:12px}.btn.rec{background:#fdf0cf;color:#8a5a00;box-shadow:inset 0 0 0 1.5px #f3dfb8;display:inline-flex;align-items:center;justify-content:center;gap:8px}.btn.rec:hover{background:#fae6b5}.btn.rec i{width:7px;height:7px;border-radius:50%;background:#e8a317;box-shadow:0 0 0 3px #f9d98a;flex:none}.btn.ghost{background:var(--panel);color:var(--teal);box-shadow:inset 0 0 0 1.5px var(--teal);margin-top:0}.btn.ghost:disabled{opacity:.5;cursor:default}
.evctl .evwhy{flex:1 1 100%;font-size:11.5px;line-height:1.4;color:var(--mist);font-weight:600}.evctl #ev-narrow{flex:1 1 100%}
.preaim{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13px;font-weight:700;color:var(--fog)}.preaim small{display:block;font-weight:600;color:var(--mist);margin-top:2px}
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
.av.later .ring{outline:1.5px dashed var(--line);outline-offset:2px}.av.later .nm{color:var(--mist)}
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
.pips i.cur,.qkey i.cur{background:var(--sun);animation:p 1.2s infinite}.pips i.pe,.qkey i.pe{background:#f1f5f3;box-shadow:inset 0 0 0 1px #e3ebe8}
.pips i.sa,.qkey i.sa{background:#fdf0cf;box-shadow:inset 0 0 0 2px #e3c46a}.pips i.mw,.qkey i.mw{background:repeating-linear-gradient(135deg,#c9d3d0 0 2px,#fff 2px 4px);box-shadow:inset 0 0 0 1px #b3c0bc}.pips i.ns,.qkey i.ns{background:#fff;box-shadow:inset 0 0 0 1px #b3c0bc}.pips i.mu,.qkey i.mu{background:repeating-linear-gradient(45deg,#ecd29a 0 2px,#fff 2px 4px);box-shadow:inset 0 0 0 1px #d9b96a}.qkey{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:11.5px;color:var(--mist);font-weight:600}.qkey span{display:inline-flex;align-items:center;gap:5px}.qkey i{width:10px;height:10px;border-radius:3px;display:inline-block}
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
.state.on{color:var(--teal)}.state.on i{background:var(--teal2);animation:p 1.2s infinite}.state.warn{color:#9a5b00}.state.warn i{background:var(--sun)}.state.bad{color:#a3261c;align-items:flex-start}.state.bad i{background:#c8362a;margin-top:5px}
#snack{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);max-width:min(640px,calc(100vw - 32px));background:#3a1512;color:#fff;border-left:4px solid #e2574c;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:12px;align-items:flex-start;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9999}
#readybar{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);max-width:min(640px,calc(100vw - 32px));background:#10302e;color:#fff;border-left:4px solid var(--teal2);border-radius:10px;
padding:11px 14px;font-size:13px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9998}
#readybar.on{opacity:1;transform:translate(-50%,0)}#readybar i{width:8px;height:8px;border-radius:50%;background:var(--teal2);flex:none;animation:p 1.2s infinite}
#snack.on~#readybar.on,body:has(#snack.on) #readybar.on{bottom:84px}
.loadbar{height:4px;border-radius:4px;background:rgba(0,0,0,.08);overflow:hidden;margin:26px 0 14px}.loadbar i{display:block;height:100%;width:34%;border-radius:4px;background:var(--teal2);animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
.skel{height:92px;border-radius:14px;margin:14px 0;background:linear-gradient(90deg,rgba(0,0,0,.05),rgba(0,0,0,.09),rgba(0,0,0,.05));background-size:200% 100%;animation:sheen 1.4s linear infinite}.skel.tall{height:240px}
@keyframes sheen{0%{background-position:200% 0}100%{background-position:-200% 0}}
#busybar{position:fixed;left:0;top:0;right:0;height:3px;z-index:10000;overflow:hidden;opacity:0;transition:opacity .15s;pointer-events:none}#busybar.on{opacity:1}
#busybar i{display:block;height:100%;width:30%;background:var(--teal2);animation:slide 1s ease-in-out infinite}
.btn.waiting,.specbtn.waiting{position:relative;opacity:.75;cursor:progress}
@media (prefers-reduced-motion:reduce){.loadbar i,.skel,#busybar i{animation-duration:3s}}
/* (the Swarm Viewer has no head now: what comes first in it has no rule above it) */
.panel.arr>:first-child{border-top:0!important;margin-top:0!important;padding-top:0!important}
.dlgload{min-width:min(520px,80vw);padding:2px 0 14px}.dlgload .loadbar{margin:18px 0 6px}
.memnum[data-ring]{display:flex;align-items:center;gap:14px;text-align:left}.ring{position:relative;display:inline-block;width:64px;height:64px;flex:none}
.ring svg{width:64px;height:64px;display:block}.ring circle{fill:none;stroke-width:6}.ring .rt{stroke:rgba(0,0,0,.08)}.ring .rv{stroke:var(--teal2);stroke-linecap:round;transition:stroke-dasharray .6s ease}
.ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:var(--teal);font-variant-numeric:tabular-nums;line-height:1}
.memnum[data-ring] .ring b{font-size:14px;display:flex;letter-spacing:-.02em}.ring.on .rv{stroke:var(--sun)}
#snack.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}#snack button{background:none;border:0;color:#ffd2cd;font-weight:700;cursor:pointer;font-size:13px;padding:0;flex:none}
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
/* (the caret sits where the configuration's does: beside the heading, and at the far side on a phone) */
details.secfold{margin-top:36px}details.secfold>summary{justify-content:flex-start;gap:12px;padding:4px 0}details.secfold>summary h2{margin:0}details.secfold[open]>summary{margin-bottom:12px}
details.secfold>summary::after{width:8px;height:8px;border-color:var(--teal2);margin-top:-3px}details.secfold:not([open])>summary::after{margin-top:0}
@media (max-width:560px){details.secfold>summary{justify-content:space-between}}
.wholep .trainopts{margin-top:12px}
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
/* (and the controls stay inside their column: a chooser is as wide as its longest choice, "a proof run (about 500 a body of work)",
   which is wider than the column, and lay over the description beside it. It takes the column's width and no more, its
   choice cut short with an ellipsis where it does not fit; the list it opens shows every choice whole) */
.memcard>.proghead>.evctl,.evalp>.proghead>.evctl,.prep>.proghead>.evctl,.trainhead>.proghead>.evctl{min-width:0;max-width:100%}
.proghead>.evctl select{min-width:0;max-width:100%;text-overflow:ellipsis}
@media (max-width:1100px){.memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{grid-template-columns:minmax(0,1fr) auto}
.memcard>.proghead>.progline,.evalp>.proghead>.progline,.prep>.proghead>.progline,.trainhead>.proghead>.progline{grid-column:1/-1;grid-row:2}}
@media (max-width:760px){.memcard>.proghead,.evalp>.proghead,.prep>.proghead,.trainhead>.proghead{grid-template-columns:minmax(0,1fr)}
.memcard>.proghead>.progline,.evalp>.proghead>.progline,.prep>.proghead>.progline,.trainhead>.proghead>.progline{grid-row:auto}
.memcard>.proghead>.evctl,.evalp>.proghead>.evctl,.prep>.proghead>.evctl,.trainhead>.proghead>.evctl{justify-self:stretch;justify-content:flex-start}}
@media (max-width:560px){.stages{grid-auto-columns:minmax(170px,82%)}.kpis{grid-template-columns:minmax(0,1fr)}main{padding:18px 16px 40px}h1{font-size:27px}.panel{padding:16px;border-radius:var(--r)}}
"""

JS = """
const $=(s,r=document)=>r.querySelector(s);
// A CHANGE THAT WAS SENT IS ON ITS WAY: a thin bar moves across the top of the page from the moment a person starts, stops
// or sets something until its answer comes, and the button pressed is marked as waiting. Nothing else shows it: not the
// page's own readings of its state (on a phone each is slow, and the bar never went away), and not a reading a person
// began (it was shown for those too, and a phone still showed it with nothing going on: console 2026-11-24). It is never
// left on: it goes after twenty seconds whatever became of the change, and whenever the page is shown again.
(()=>{const real=window.fetch.bind(window);let n=0,pressed=null;
  const bar=()=>{let b=$('#busybar');if(!b){b=document.createElement('div');b.id='busybar';b.setAttribute('role','progressbar');b.setAttribute('aria-label','Working');b.innerHTML='<i></i>';document.body.appendChild(b);}return b;};
  const clear=()=>{n=0;const b=$('#busybar');if(b)b.classList.remove('on');document.querySelectorAll('.waiting').forEach(x=>x.classList.remove('waiting'));};
  document.addEventListener('click',(ev)=>{pressed=ev.target.closest&&ev.target.closest('button');setTimeout(()=>{pressed=null;},0);},true);
  window.addEventListener('pageshow',clear);document.addEventListener('visibilitychange',()=>{if(!document.hidden)clear();});
  window.fetch=(url,opts)=>{if(!(opts&&opts.method&&opts.method!=='GET'))return real(url,opts);
    const btn=pressed;let over=false;n++;bar().classList.add('on');if(btn)btn.classList.add('waiting');
    const done=()=>{if(over)return;over=true;clearTimeout(cap);if(btn)btn.classList.remove('waiting');if(--n<=0){n=0;bar().classList.remove('on');}};
    const cap=setTimeout(done,20000);
    return real(url,opts).then((r)=>{done();return r;},(e)=>{done();throw e;});};})();
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
// (a part that is no longer on the page is not fetched: the adapters row and the Pretrain card went, 2026-11-24, and a
// change of model drew them again in place and stopped there)
// A DIALOG OPENS AT ONCE AND SAYS IT IS READING. Each one was opened only when what goes in it had arrived, which for the
// questions training asks is three and a half seconds of a button that seemed to do nothing (console 2026-11-24). The
// dialog is shown the moment it is asked for, with a bar that moves and what is being read, and a way to close it; what
// it holds is put in when it comes. Closed while it reads, it stays closed.
function dlgLoad(d,b,what){const dg=$(d),body=$(b);if(!dg||!body)return;
  body.innerHTML='<div class="dlgload" role="status" aria-live="polite"><div class="spec-head"><div><h3>'+(what||'Reading')+'…</h3></div><button class="btn stop top" type="button" data-dlg-close>Close</button></div><div class="loadbar"><i></i></div></div>';
  if(!dg.open)dg.showModal();}
document.addEventListener('click',(ev)=>{const c=ev.target.closest('[data-dlg-close]');if(c){const dg=c.closest('dialog');if(dg)dg.close();}});
async function swap(url,into,opts){if(!$(into))return;const r=await fetch(url,opts);$(into).innerHTML=await r.text();keepOpen($(into));if(typeof sinceTick==='function')sinceTick();if(typeof evAsk==='function')evAsk();if(typeof trainAsk==='function')trainAsk();}
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
    const body=b.id==='run-go'?JSON.stringify({classes:[...document.querySelectorAll('[data-train-class]')].filter(x=>x.checked).map(x=>x.dataset.trainClass)}):'{}';
    await swap(b.id==='run-go'?'/run/start':'/run/stop','#score',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body});
    // THE PILLS FOLLOW AT ONCE: they are locked while a session runs. The watch loop redrew them only where it had itself seen
    // the session running and then not, and after Stop this line has already redrawn the card as stopped: so the loop saw nothing
    // end, and the pills stayed locked until the page was loaded again
    await swap('/fragment/picks','#picks');if(b.id==='run-stop'&&!$('#score [data-running]'))await swap('/fragment/body','#body');
    watch();return;}
});
// A MODEL CHOSEN: written down, and everything that depends on it drawn again in place
document.addEventListener('change',async(ev)=>{const s=ev.target.closest('[data-pick]');if(!s)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({[s.dataset.pick]:s.value})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/chips','#chips');await swap('/fragment/score','#score');liveTick();}else{snack(await r.text());await swap('/fragment/picks','#picks');}});
// ONE MODEL OR SEVERAL: the choice above the pills, saved as a pill's choice is
document.addEventListener('click',async(ev)=>{const b=ev.target.closest('[data-mix]');if(!b||b.classList.contains('on'))return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({mix:b.dataset.mix==='1'})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/chips','#chips');await swap('/fragment/score','#score');liveTick();}else snack(await r.text());});
// TURNS WITH TOOLS: who takes an agent's turn, saved as a pill's choice is, and the row and the folded line drawn again in place
document.addEventListener('click',async(ev)=>{const b=ev.target.closest('[data-tools]');if(!b||b.classList.contains('on'))return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({tools:b.dataset.tools})});
  if(!r.ok){snack(await r.text());return;}
  await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');});
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
  if(ev.target.closest('#rec-open,[data-rec-open]')){ev.preventDefault();ev.stopPropagation();dlgLoad('#recd','#recd-body','Reading what is recommended');await swap('/fragment/recs','#recd-body');
    document.querySelectorAll('#recd-body [data-engine-update].busy').forEach(engineWatch);
    // (and the count beside the heading, from the same evidence at the same moment: it had been drawn when the page was, and
    // said "1 recommendation" over a dialog that had none)
    swap('/fragment/recslot','#rec-slot');}
},true);
// AN ENGINE'S UPDATE, FOLLOWED ON ITS BUTTON: it turns to a bar that only says something is going on (there is no knowing how
// far an installer has got), with the step under it; when the update is done it says Complete, and the recommendation goes,
// as it would on the next look (the engine is no longer behind); where it failed it says why and can be tried again
function engineWatch(b){
  const box=b.closest('.eng'),bar=box.querySelector('.engp'),said=box.querySelector('.engs');
  b.disabled=true;b.classList.add('busy');b.textContent='Updating';bar.hidden=false;
  const t=setInterval(async()=>{
    if(!document.body.contains(b)){clearInterval(t);return;}
    let st={};try{st=await (await fetch('/api/engine?id='+encodeURIComponent(b.dataset.engineUpdate))).json();}catch(_){return;}
    said.textContent=st.step||'';
    if(st.running)return;
    clearInterval(t);bar.hidden=true;b.classList.remove('busy');
    if(st.phase==='done'){b.textContent='Complete';b.classList.add('done');
      setTimeout(async()=>{const li=b.closest('li');if(li)li.remove();await swap('/fragment/recslot','#rec-slot');
        if(!document.querySelector('#recd-body .rec'))await swap('/fragment/recs','#recd-body');},1800);}
    else{b.textContent='Try again';b.disabled=false;}
  },2000);
}
document.addEventListener('click',async(ev)=>{
  if(ev.target.id==='rec-close'||ev.target.id==='recd'){$('#recd').close();return;}
  const up=ev.target.closest('[data-engine-update]');
  if(up){up.disabled=true;
    const r=await fetch('/engine/update',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({id:up.dataset.engineUpdate})});
    if(!r.ok){snack(await r.text());up.disabled=false;return;}
    engineWatch(up);return;}
  // TRAIN, FROM A RECOMMENDATION: the page's own Train button is pressed (what it starts, and when it may, are its own), and it is brought into view
  if(ev.target.closest('[data-rec-train]')){$('#recd').close();const g=$('#run-go');if(g){g.scrollIntoView({block:'center'});if(!g.disabled)g.click();}return;}
  const a=ev.target.closest('[data-rec-apply]');if(!a)return;a.disabled=true;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:a.dataset.recApply});
  if(!r.ok){snack(await r.text());a.disabled=false;return;}
  $('#body').innerHTML=await r.text();await swap('/fragment/picks','#picks');await swap('/fragment/tools','#tools');await swap('/fragment/cfgmeta','#cfg-meta');await swap('/fragment/recslot','#rec-slot');await swap('/fragment/chips','#chips');await swap('/fragment/score','#score');$('#recd').close();
});
// STEER IT: focus an area, queue or skip a move, choose any move; each choice written down and the plan drawn again in place
const steerPost=async(body)=>{const r=await fetch('/steer',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok){snack(await r.text());return false;}$('#plan').innerHTML=await r.text();keepOpen($('#plan'));return true;};
document.addEventListener('click',async(ev)=>{
  const f=ev.target.closest('[data-steer-focus]');if(f){await steerPost({op:'focus',area:f.dataset.steerFocus,value:f.dataset.v});return;}
  const s=ev.target.closest('[data-steer]');if(s){s.disabled=true;const ok=await steerPost({op:s.dataset.steer,id:s.dataset.id});if(ok&&$('#steerd').open)await swap('/fragment/steer','#steerd-body');return;}
  if(ev.target.closest('#steer-open')){dlgLoad('#steerd','#steerd-body','Reading');await swap('/fragment/steer','#steerd-body');return;}
  if(ev.target.id==='steer-close'||ev.target.id==='steerd'){$('#steerd').close();return;}
  // THE EVALUATION, BENCHMARK BY BENCHMARK: the Evaluate card's headline opens the table of every body of work and task
  {const vb=ev.target.closest('[data-evd-view]');if(vb){const dg=$('#evd');dg.dataset.view=vb.dataset.evdView;dg.dataset.cfg='';dg.dataset.bench='';dlgLoad('#evd','#evd-body','Reading the evaluation');await swap('/fragment/evtable?view='+dg.dataset.view,'#evd-body');return;}}
  {const bb=ev.target.closest('[data-evd-bench]');if(bb){const dg=$('#evd');dg.dataset.bench=bb.dataset.evdBench;const on=[...document.querySelectorAll('[data-evd-harness]')].filter(x=>x.checked).map(x=>x.dataset.evdHarness);
    await evdShow();return;}}
  // THE QUESTIONS TRAINING ASKS (the Train card): opened, and narrowed by split, class, kind and words to find
  if(ev.target.closest('#tq-open')){dlgLoad('#tqd','#tqd-body','Reading the questions training asks');await swap('/fragment/trainq','#tqd-body');return;}
  if(ev.target.id==='tq-close'||ev.target.id==='tqd'){$('#tqd').close();return;}
  {const sg=ev.target.closest('[data-tq-split],[data-tq-cls]');if(sg){const c=$('.tqctl');if(sg.dataset.tqSplit!==undefined){c.dataset.split=sg.dataset.tqSplit;}else{c.dataset.cls=sg.dataset.tqCls;}c.dataset.kind='';await tqShow();return;}}
  if(ev.target.id==='evd-copy'){const ta=$('#evd-latex');try{await navigator.clipboard.writeText(ta.value);ev.target.textContent='Copied';}catch(e){ta.hidden=false;ta.select();}return;}
  if(ev.target.id==='evd-close'||ev.target.id==='evd'){$('#evd').close();return;}
});
document.addEventListener('input',(ev)=>{if(ev.target.id!=='steer-find')return;const q=ev.target.value.toLowerCase().trim();document.querySelectorAll('#steerd .movepick li').forEach(li=>{li.style.display=!q||li.dataset.q.includes(q)?'':'none';});});
// THE UNINSTALL HELPER: what is installed here, and a piece removed only once its removal has been confirmed
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#tidy-open')){dlgLoad('#tidy','#tidy-body','Measuring what is installed here');await swap('/fragment/tidy','#tidy-body');return;}
  if(ev.target.id==='tidy-close'||ev.target.id==='tidy'){$('#tidy').close();return;}
  const b=ev.target.closest('[data-tidy]');if(!b)return;
  const again=b.dataset.used==='1'?' It is part of the swarm as configured: Train fetches it again.':'';
  if(!confirm('Remove '+b.dataset.what+' ('+b.dataset.size+')? This cannot be undone.'+again))return;
  b.disabled=true;b.textContent='Removing';
  const r=await fetch('/uninstall',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({id:b.dataset.tidy})});
  if(!r.ok){snack(await r.text());await swap('/fragment/tidy','#tidy-body');return;}
  $('#tidy-body').innerHTML=await r.text();
});
// THE QUESTIONS A PERSON WROTE FOR ONE BODY OF WORK: its button under the pills opens them; a row is added, changed or taken
// out, and Save writes them all
const qCount=()=>{const n=document.querySelectorAll('#qlist .qrow').length;const c=$('#qcount');if(c)c.textContent=n+' of 200';const a=$('#qadd');if(a)a.disabled=n>=200;};
document.addEventListener('click',async(ev)=>{
  const pen=ev.target.closest('[data-qedit]');
  if(pen){dlgLoad('#qedit','#qedit-body','Reading its questions');await swap('/fragment/questions?id='+encodeURIComponent(pen.dataset.qedit),'#qedit-body');qCount();return;}
  if(ev.target.id==='qedit-close'||ev.target.id==='qedit'){$('#qedit').close();return;}
  if(ev.target.id==='qadd'){const li=$('#qrow').content.firstElementChild.cloneNode(true);$('#qlist').appendChild(li);li.querySelector('textarea').focus();qCount();return;}
  if(ev.target.closest('[data-q-del]')){ev.target.closest('.qrow').remove();qCount();return;}
  if(ev.target.id==='qsave'){const b=ev.target;b.disabled=true;
    const questions=[...document.querySelectorAll('#qlist .qrow')].map(li=>({ask:li.querySelector('[data-q-ask]').value,mode:(li.querySelector('[data-q-mode]')||{}).value||undefined}));
    const r=await fetch('/questions',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({id:$('#qlist').dataset.target,questions})});
    b.disabled=false;if(!r.ok){snack(await r.text());return;}
    $('#ownq').innerHTML=await r.text();$('#qedit').close();}
});
// THE SwOA SPEC: what the swarm module as it stands is, in one document
document.addEventListener('click',async(ev)=>{
  if(ev.target.closest('#spec-open')){dlgLoad('#spec','#spec-body','Reading the spec');await swap('/fragment/spec','#spec-body');return;}
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
// THE MODULE SERVED AT AN ADDRESS: the button starts or stops it; while its models load the chips are read again until it answers
let serveTimer=null;
function serveWatch(){if(serveTimer)return;serveTimer=setInterval(async()=>{await swap('/fragment/chips','#chips');if(!$('#serve-toggle.starting')){clearInterval(serveTimer);serveTimer=null;}},2000);}
document.addEventListener('click',async ev=>{
  const u=ev.target.closest('#serve-url');if(u){try{await navigator.clipboard.writeText(u.textContent);const t=u.textContent;u.textContent='Copied';setTimeout(()=>{u.textContent=t;},900);}catch(e){}return;}
  const b=ev.target.closest('#serve-toggle');if(!b||b.disabled)return;b.disabled=true;
  const r=await fetch(b.dataset.on==='1'?'/serve/stop':'/serve/start',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:'{}'});
  if(r.ok){$('#chips').innerHTML=await r.text();if($('#serve-toggle.starting'))serveWatch();}else{snack(await r.text());await swap('/fragment/chips','#chips');}
  // (the run cards wait while the module is served, and are free again the moment it stops: drawn again now, and once
  // more shortly after, since a stopped process takes a moment to be gone)
  const runs=async()=>{await swap('/fragment/whole','#wholewrap');await swap('/fragment/converse','#conversewrap');await swap('/fragment/chips','#chips');};
  await runs();setTimeout(runs,1500);});
if($('#serve-toggle.starting'))serveWatch();
// WHAT EVERY SLOT IS DOING NOW: asked for every second and a half while a session runs, and written onto the cards in place
const STEP={classes:'Training each class of input as a class',loop:'Training question by question',measure:'Measuring the swarm',improve:'Trying a brief',arrange:'Trying an arrangement',baseline:'One model alone'};
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
      :(n.running&&n.step&&n.trainer&&n.trainer!=='loop')?(STEP[n.trainer]||'Working')+' · '+n.step:n.running?'A session is running. Between steps: models are loading or unloading.':n.busy?n.busy[0].toUpperCase()+n.busy.slice(1)+' is running: the models are loaded for it.':'Nothing is running. No model is loaded.';
    now.querySelector('span').textContent=nowText;now.title=nowText;}
  // THE SWARM AGAINST EACH QUESTION: the question in hand, its iteration, and a pip for each question so far
  const qn=$('#qnow'),pp=$('#pips'),qh=$('#qhead');
  if(qn)qn.hidden=!!(n.running&&n.trainer!=='loop');
  if(qn&&n.track){const lp=n.loop,q=n.question,tk=n.track,done=tk.done||[],of=(lp&&lp.of)||tk.of||0;
    // (painted again only when what it shows changes: rebuilt on every poll, the block reflowed the page under a reader's thumb)
    const qkey=lp&&q&&n.trainer==='loop'?JSON.stringify([lp.n,lp.attempt,lp.guard||'',lp.guarded||'',lp.move,lp.round,lp.method||'',lp.tried||'',lp.pace||'',lp.trial||'',lp.unstable||'',q.ask]):'';
    if(qkey&&qn.dataset.k===qkey){}
    else if(lp&&q&&n.trainer==='loop'){qn.dataset.k=qkey;
      // (a step that asks many questions says how far through them it is: those already asked, of all it will ask)
      const far=lp.guarded&&lp.guarded.of?' · '+Math.round(100*Math.max(0,lp.guarded.n-1)/lp.guarded.of)+'%':'';
      const it=(lp.standing?'where its class stands':lp.classCheck?'checking a change on its class':lp.guard?'checking a change':lp.attempt?'training change '+lp.attempt+(lp.cap?' of '+lp.cap:'')+(lp.round>1?' · round '+lp.round:''):'as it stands')+far;
      const what=lp.standing?'A change is kept when its class got better. To set it beside, '+lp.guard+(lp.held?', a held question,':'')+(lp.guarded?' ('+lp.guarded.n+' of '+lp.guarded.of+')':'')+' is asked as the swarm stands.'
        :lp.classCheck?'A change is kept when its class got better. With it, asked on '+lp.guard+(lp.held?', a held question':lp.guarded?' ('+lp.guarded.n+' of '+lp.guarded.of+' of its class)':'')+': '+lp.move
        :lp.guard?'It made this answer good; asked again on '+lp.guard+(lp.guarded?' ('+lp.guarded.n+' of '+lp.guarded.of+')':'')+', already good, it must lose nothing to be kept: '+lp.move
        :lp.attempt?'Not good as the swarm stood. Trying: '+lp.move:'Asked of the swarm as it stands.';
      qn.innerHTML='';const b=document.createElement('span');b.className='it';b.textContent=it;const tq=document.createElement('span');tq.className='qtext';tq.textContent='Question '+lp.n+' of '+lp.of+' · '+q.kind+' · '+q.ask.replace(/\\s+/g,' ');const ql=document.createElement('span');ql.className='ql';ql.append(b,tq);qn.append(ql);
      const sm=document.createElement('small');sm.textContent=what;qn.append(sm);
      // HOW THIS CHANGE WAS CHOSEN (training/loop.mjs method): what it is built on, its round and place, each reason, and what came before
      if(lp.attempt&&lp.method){const md=lp.method,nw=x=>x&&x.parity?'good here, but it broke '+x.broke+' when that was asked again':x?'lost in '+x.lost+', '+x.had+' slot'+(x.had===1?'':'s')+' had the answer'+(x.slots&&x.slots.length?' ('+x.slots.join(', ')+')':'')+(x.p!=null?', the decider '+Math.round(x.p*100)+'% on it':'')+(x.share!=null&&!x.had?', the nearest answer '+Math.round(x.share*100)+'% of the way':''):'';
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
        if(lp.broke){const bk=Object.entries(lp.broke).sort((a,b)=>b[1]-a[1]);line('Conflict:','changes that made this answer good broke '+bk.map(([k,v])=>k+' ('+v+' time'+(v===1?'':'s')+')').join(', ')+'. It is asked first when a change makes this answer good, and the search builds on those changes for one that keeps both.');}
        if(lp.unstable)line('Unstable mark:','asked this question again, the larger model did not give its own answer again, so parity here is partly a draw; it is searched until parity all the same.');
        const rs=md.reasons||[];if(rs.length){line('Why it is tried now','');const ul=document.createElement('ul');for(const r of rs){const li=document.createElement('li');li.textContent=r;ul.append(li);}box.append(ul);}
        if(lp.tried&&lp.tried.length){line('Tried on this question before it','');const ol=document.createElement('ol');ol.className='qtried';
          for(const x of lp.tried){const li=document.createElement('li');const k=document.createElement('span');k.className='k'+(x.grade==='right'?' up':x.closer?' cl':'');
            k.textContent=x.grade==='right'?(x.lostOn?'broke one':'good'):x.closer?'closer':x.grade==='noref'?'no grade':x.library?'found, no':x.suggested?'suggested, no':x.taught?'new brief, no':'no closer';li.append(k,(x.round>1?'round '+x.round+' · ':'')+x.move+(x.lostOn?' · at parity, broke '+x.lostOn:x.near?' · '+nw(x.near):''));ol.append(li);}
          box.append(ol);}
        qn.append(fold);}}
    // THE FIRST STAGE OF TRAINING, a class at a time: what it is asking now is said where the question in hand is said, and its
    // table (how each class stands, what was tried and kept) is drawn again in place every few ticks while it runs
    // (while an earlier step of the pass runs, the line above the track says what it is doing: this one says nothing twice)
    else if(n.running&&n.trainer==='classes'){qn.dataset.k='';qn.textContent='';
}
    else if(n.running&&n.trainer!=='loop'){qn.dataset.k='';qn.textContent='';}
    // THE BOX THE LOOP IS IN NOW, on the system's picture and in the plan's list of steps (the same reading of the live note as the server's loop_phase)
    {const ph=n.trainer==='classes'?'classes':!(lp&&n.trainer==='loop')?'':lp.guard?'guard':!lp.attempt?'ask':(lp.method&&lp.method.area==='library')?'library':(lp.method&&lp.method.area==='suggested')?'suggest':'search';
      document.querySelectorAll('#viz [data-part]').forEach(b=>b.classList.toggle('on',b.dataset.part===ph));}
    if(pp){const key=done.map(x=>x.s).join()+'|'+(lp&&n.trainer==='loop'?lp.n:'')+'|'+of;
      if(pp.dataset.k!==key){pp.dataset.k=key;pp.innerHTML='';
        for(const x of done){const i=document.createElement('i');i.className=x.s;i.title=x.id+' · '+(x.w?x.w+' · ':'')+x.kind+(x.tried?' · '+x.tried+' change'+(x.tried===1?'':'s')+' tried':'');pp.append(i);}
        if(lp&&n.trainer==='loop'&&lp.n>done.length){const i=document.createElement('i');i.className='cur';i.title='in hand: question '+lp.n;pp.append(i);}
        // (and one for each question not asked yet: the whole pass is on the row)
        for(let k=pp.children.length;k<of;k++){const i=document.createElement('i');i.className='pe';i.title='not asked yet';pp.append(i);}}}
    if(qh&&(done.length||(lp&&n.trainer==='loop'))){const c=s=>done.filter(x=>x.s===s).length;const t=[done.filter(x=>x.s!=='ro'&&x.s!=='sa').length+' of '+of+' finished',c('at')+' good as it stood',c('re')+' made good by a change',c('nr')+' not good yet'];
      const k=t.join('|');if(qh.dataset.k!==k){qh.dataset.k=k;const hb=(qh.querySelector('b')||{}).textContent||'Question by question';qh.innerHTML='';{const b=document.createElement('b');b.textContent=hb;qh.append(b);}for(const v of t){const sp=document.createElement('span');sp.textContent=v;qh.append(sp);}}}}
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
// THE WHOLE RUN'S ONE BUTTON (whole_block): Start or Carry on with the size and whether to train; Stop. Its steps are drawn again
// every three seconds while it runs, and the cards under it follow their own steps as they always do
document.addEventListener('click',async ev=>{const b=ev.target;if(b.id!=='whole-go'&&b.id!=='whole-stop')return;b.disabled=true;
  await evPost(b.id==='whole-go'?'/whole/start':'/whole/stop','#wholewrap',b.id==='whole-go'?{limit:Number(($('#whole-size')||{}).value||20),classes:[...document.querySelectorAll('[data-train-class]')].filter(x=>x.checked).map(x=>x.dataset.trainClass)}:{});});
setInterval(async()=>{if($('#wholebox[data-running]')||$('#busy[data-busy="the run"]'))await swap('/fragment/whole','#wholewrap');},3000);
// THE CHART'S LIST SCOPES THE CHART: a line pressed (or Enter, or the space bar, on it) turns its point off, and on again
const chartLine=li=>{const off=li.classList.toggle('off');li.setAttribute('aria-pressed',off?'false':'true');
  const root=li.closest('dialog,.panel,body');root.querySelectorAll('svg g[data-pt="'+li.dataset.pt+'"]').forEach(g=>g.classList.toggle('off',off));};
document.addEventListener('click',ev=>{const li=ev.target.closest('.lgl li[data-pt]');if(li)chartLine(li);});
document.addEventListener('keydown',ev=>{if(ev.key!=='Enter'&&ev.key!==' ')return;const li=ev.target.closest&&ev.target.closest('.lgl li[data-pt]');if(li){ev.preventDefault();chartLine(li);}});
// THE CONVERSATION RUN'S BUTTON (converse_block): one press is one pass; drawn again while a pass runs, and the plan with it
document.addEventListener('click',async ev=>{const b=ev.target;if(b.id!=='converse-go'&&b.id!=='converse-stop')return;b.disabled=true;
  await evPost(b.id==='converse-go'?'/converse/start':'/converse/stop','#conversewrap',{});});
setInterval(async()=>{if($('#conversebox[data-running]')){await swap('/fragment/converse','#conversewrap');}},2000);
// WHAT IS BEING TRAINED NOW, AND WHERE IN THE PICTURE: while anything trains, the plan is drawn again and the boxes in use are marked
setInterval(async()=>{const going=$('#conversebox[data-running]')||$('#wholebox[data-running]')||$('#plan [data-training]')||$('#score [data-stage]');
  if(!going&&!document.querySelector('#viz .vbox.on[data-code]'))return;
  if($('#plan'))await swap('/fragment/plan','#plan');
  // (and the Train card's head, which is the stage's own figure while a stage runs; a session's own poll draws it otherwise)
  if($('#score')&&!$('#score [data-running]'))await swap('/fragment/score','#score');
  try{const r=await fetch('/now/codes');if(r.ok){const on=new Set((await r.text()).split(',').filter(Boolean));
    document.querySelectorAll('#viz .vbox[data-code]').forEach(b=>{if(!b.dataset.part)b.classList.toggle('on',on.has(b.dataset.code));});}}catch(e){}},4000);
// THE ERROR SNACKBAR: what the page could not do, or what a run ended on, said at the foot of the page until it is dismissed
// (or for twelve seconds). It was a browser alert, and a run that ended on an error said nothing at all (2026-11-24)
let snackT=0;function snack(text){let n=$('#snack');if(!n){n=document.createElement('div');n.id='snack';n.setAttribute('role','alert');
  n.innerHTML='<span></span><button type="button" aria-label="Dismiss">Dismiss</button>';document.body.appendChild(n);
  n.querySelector('button').addEventListener('click',()=>n.classList.remove('on'));}
  n.querySelector('span').textContent=String(text||'It could not be done.');n.classList.add('on');clearTimeout(snackT);snackT=setTimeout(()=>n.classList.remove('on'),12000);}
// (a card that says its run failed is read out once for that run; the line stays on the card)
function failSeen(){try{return JSON.parse(sessionStorage.getItem('swarm.failed')||'[]');}catch(e){return [];}}
function failWatch(first){document.querySelectorAll('[data-failed]').forEach(x=>{const seen=failSeen();if(seen.includes(x.dataset.failed))return;
  seen.push(x.dataset.failed);try{sessionStorage.setItem('swarm.failed',JSON.stringify(seen.slice(-20)));}catch(e){}if(!first)snack(x.dataset.why);});}
failWatch(true);setInterval(()=>failWatch(false),1500);
// WHAT IS BEING FETCHED OR INSTALLED NOW (/now/ready), at the foot of the page for as long as it lasts: an engine, a program of
// one, a model. It is not an error and is not dismissed: it goes when the piece is ready
async function readyWatch(){let t='';try{const r=await fetch('/now/ready');if(r.ok)t=await r.text();}catch(e){}
  let n=$('#readybar');if(!t){if(n)n.classList.remove('on');return;}
  if(!n){n=document.createElement('div');n.id='readybar';n.setAttribute('role','status');n.innerHTML='<i></i><span></span>';document.body.appendChild(n);}
  n.querySelector('span').textContent=t;n.classList.add('on');}
readyWatch();setInterval(readyWatch,3000);
// EVERY CONTROL THAT STARTS SOMETHING SAYS THE SAME THING. Only one of the runs, an evaluation and the served module can have
// the models at a time, and each card draws its own button from that. A card drawn before another one started something
// went on offering its button: the conversation run was started and Start, on the intelligence run, could still be pressed
// (console 2026-11-24). So when anything is started or stopped here, every other card that starts something is drawn again;
// and since a run may be started from another window, a phone or a terminal, the page asks every few seconds what has the
// models (/now/busy) and draws them all again when the answer changes.
async function runsSync(except){for(const [url,into] of [['/fragment/whole','#wholewrap'],['/fragment/converse','#conversewrap'],['/fragment/chips','#chips'],['/fragment/eval','#evalwrap']]){
  if(into===except||!$(into))continue;if(into==='#evalwrap'&&$('#evalbox[data-running]'))continue;await swap(url,into);}
  if($('#score')&&!$('#score [data-running]'))await swap('/fragment/score','#score');}
let busyWas=null;
setInterval(async()=>{let t=null;try{const r=await fetch('/now/busy');if(r.ok)t=await r.text();}catch(e){}
  if(t===null)return;if(busyWas!==null&&t!==busyWas)await runsSync();busyWas=t;},4000);
async function evPost(url,into,body){const r=await fetch(url,{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify(body||{})});
  if(!r.ok){snack(await r.text());evAsk();await runsSync();return;}$(into).innerHTML=await r.text();keepOpen($(into));evAsk();
  // (the others now, and once more shortly: a process that was stopped takes a moment to be gone)
  await runsSync(into);setTimeout(()=>runsSync(into),1500);}
// WHICH BODIES OF WORK AN EVALUATION ASKS: every one to begin with; a person unticks some for a quicker look, and the device keeps
// which. It is a choice for one run, not a setting of the swarm: training asks every body of work whatever is ticked here. The
// boxes are drawn ticked, and painted from what the device kept whenever the card is drawn again
function evOff(){try{const v=JSON.parse(localStorage.getItem('swarm.eval.off')||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}}
// (AND WITH WHICH HARNESSES, kept the same way: a task is asked where its body of work and its harness are both ticked. A body
// of work none of whose harnesses is ticked has nothing to ask: its box goes quiet, as it is, until one is ticked again)
function evHOff(){try{const v=JSON.parse(localStorage.getItem('swarm.eval.hoff')||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}}
// WHICH CLASSES A SESSION TRAINS: the boxes are as they were left on this device; with none ticked Train waits
function trainAsk(){const bs=[...document.querySelectorAll('[data-train-class]')];if(!bs.length)return;let off=[];try{off=JSON.parse(localStorage.getItem('swarm.train.off')||'[]');}catch(e){}
  bs.forEach(x=>{x.checked=!off.includes(x.dataset.trainClass);});if(!bs.some(x=>x.checked))bs.forEach(x=>{x.checked=true;});trainLeft();}
function trainLeft(){const bs=[...document.querySelectorAll('[data-train-class]')];if(!bs.length||bs[0].disabled)return;
  for(const g of [$('#whole-go'),$('#run-go')])if(g&&!g.dataset.held)g.disabled=!bs.some(x=>x.checked);}
async function evdShow(){const dg=$('#evd'),on=[...document.querySelectorAll('[data-evd-harness]')].filter(x=>x.checked).map(x=>x.dataset.evdHarness);
  await swap('/fragment/evtable?view='+(dg.dataset.view||'table')+'&b='+encodeURIComponent(dg.dataset.bench||'')+'&cfg='+encodeURIComponent(dg.dataset.cfg||'')+'&h='+encodeURIComponent(on.join(',')),'#evd-body');}
document.addEventListener('change',async(ev)=>{if(ev.target.id==='evd-cfg'){const dg=$('#evd');dg.dataset.cfg=ev.target.value;dg.dataset.bench='';await evdShow();}});
async function tqShow(){const c=$('.tqctl');if(!c)return;const f=$('#tq-find');
  await swap('/fragment/trainq?split='+encodeURIComponent(c.dataset.split||'')+'&cls='+encodeURIComponent(c.dataset.cls||'')+'&kind='+encodeURIComponent(c.dataset.kind||'')+'&q='+encodeURIComponent(f?f.value:''),'#tqd-body');}
document.addEventListener('change',async(ev)=>{if(ev.target.id==='tq-kind'){$('.tqctl').dataset.kind=ev.target.value;await tqShow();}});
document.addEventListener('keydown',async(ev)=>{if(ev.target.id==='tq-find'&&ev.key==='Enter'){ev.preventDefault();await tqShow();const f=$('#tq-find');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}}});
function evLeft(){const hs=[...document.querySelectorAll('[data-ev-harness]')],on=hs.filter(h=>h.checked).map(h=>h.dataset.evHarness);
  const bs=[...document.querySelectorAll('[data-ev-item]')];
  bs.forEach(b=>{const has=!hs.length||(b.dataset.h||'').split(' ').some(k=>on.includes(k));b.closest('label').classList.toggle('none',!has);});
  const go=$('#ev-go');if(go&&!go.dataset.held)go.disabled=!bs.some(b=>b.checked&&!b.closest('label').classList.contains('none'));}
function evAsk(){const bs=[...document.querySelectorAll('[data-ev-item]')];if(!bs.length)return;const off=evOff();
  bs.forEach(b=>{b.checked=!off.includes(b.dataset.evItem);});if(!bs.some(b=>b.checked))bs.forEach(b=>{b.checked=true;});
  const hs=[...document.querySelectorAll('[data-ev-harness]')],hoff=evHOff();
  hs.forEach(h=>{h.checked=!hoff.includes(h.dataset.evHarness);});if(hs.length&&!hs.some(h=>h.checked))hs.forEach(h=>{h.checked=true;});
  evLeft();}
document.addEventListener('change',async(ev)=>{
  const d=ev.target.closest('[data-evd-harness]');
  if(d){const on=[...document.querySelectorAll('[data-evd-harness]')].filter(x=>x.checked).map(x=>x.dataset.evdHarness);
    if(!on.length){d.checked=true;return;}
    await evdShow();return;}
  if(ev.target.closest('[data-train-class]')){try{localStorage.setItem('swarm.train.off',JSON.stringify([...document.querySelectorAll('[data-train-class]')].filter(x=>!x.checked).map(x=>x.dataset.trainClass)));}catch(e){}trainLeft();return;}
  const b=ev.target.closest('[data-ev-item],[data-ev-harness]');if(!b)return;const bs=[...document.querySelectorAll('[data-ev-item]')];
  try{localStorage.setItem('swarm.eval.off',JSON.stringify(bs.filter(x=>!x.checked).map(x=>x.dataset.evItem)));
    localStorage.setItem('swarm.eval.hoff',JSON.stringify([...document.querySelectorAll('[data-ev-harness]')].filter(x=>!x.checked).map(x=>x.dataset.evHarness)));}catch(e){}
  evLeft();});
document.addEventListener('DOMContentLoaded',evAsk);
document.addEventListener('click',async(ev)=>{
  const b=ev.target.closest('#ev-go,#ev-narrow,#ev-stop');if(!b)return;b.disabled=true;
  if(b.id==='ev-go'){const its=[...document.querySelectorAll('[data-ev-item]')];
    const hs=[...document.querySelectorAll('[data-ev-harness]')];
    await evPost('/eval/start','#evalwrap',{limit:Number(($('#ev-size')||{}).value||0),...(its.length?{items:its.filter(x=>x.checked&&!x.closest('label').classList.contains('none')).map(x=>x.dataset.evItem)}:{}),...(hs.length?{harnesses:hs.filter(x=>x.checked).map(x=>x.dataset.evHarness)}:{}),});}
  else if(b.id==='ev-stop')await evPost('/eval/stop','#evalwrap');
  // A SECOND LOOK: only the bodies of work that fell short (the button carries them), at the size chosen
  else if(b.id==='ev-narrow')await evPost('/eval/start','#evalwrap',{limit:Number(($('#ev-size')||{}).value||0),items:b.dataset.items.split(',')});
  await swap('/fragment/score','#score');});
const EVW={waiting:()=>'waiting',done:s=>s.done+' asked',kept:()=>'answers kept from before',failed:s=>'failed: '+(s.why||''),stopped:s=>'stopped at '+s.done,
  asking:s=>'asking '+Math.min(s.done+1,s.of||s.done+1)+(s.of?' of '+s.of:'')};
const mins=x=>x<90?Math.round(x)+' s':x<5400?Math.round(x/60)+' min':(x/3600).toFixed(1)+' h';
async function evTick(){const box=$('#evalbox');if(!box||!box.dataset.running)return;
  let s;try{s=await (await fetch('/api/eval')).json();}catch(e){return;}
  if(!s.running||(s.runId&&box.dataset.run&&s.runId!==box.dataset.run)){await swap('/fragment/eval','#evalwrap');await swap('/fragment/score','#score');return;}
  const set=(k,t)=>{const el=box.querySelector('[data-ev="'+k+'"]');if(el&&el.textContent!==t)el.textContent=t;};
  set('step',s.step||'');
  // HOW FAR IT IS IN ALL, in questions as the headline counts them: one is finished once both models answered it (ev_progress, the same count)
  {let dn=0,tot=0,known=true;const ts=s.tasks||[],ws=evSides(ts);let bg=ws.filter(w=>ts.some(t=>t[w]&&t[w].state!=='waiting'));if(!bg.length)bg=ws.slice(0,1);
   for(const t of ts){dn+=Math.min(...bg.filter(w=>t[w]||!w.startsWith('alone-')).map(w=>{const x=t[w]||{};return Number(x.whole??x.done)||0;}));
     const n=Math.max(0,...ws.map(w=>Number((t[w]||{}).of)||0));if(n)tot+=n;else known=false;}
   const tn=s.target||'the larger model',lt=ws.filter(w=>!bg.includes(w)).map(w=>evWho(w,tn,s.alone));
   if(s.alone===undefined&&!['done','stopped','failed'].includes(s.phase)&&!ws.some(w=>w.startsWith('alone-')))lt.push('each small model by itself');
   const and=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
   set('prog',ts.length&&known&&tot?(lt.length?dn+' of '+tot+' questions answered by '+and(bg.map(w=>evWho(w,tn,s.alone)))+' · still to come: '+and(lt):dn+' of '+tot+' questions finished · '+Math.round(100*dn/tot)+'%'):'');}
  const q=box.querySelector('.evq'),n=s.now;
  if(q){q.hidden=!n;if(n){const tn=box.dataset.tname||'';
    set('q',evWho(n.who||'target',s.target||'the larger model',s.alone)+' · '+n.name+' · question '+n.i+(n.of?' of '+n.of:''));
    const on=Math.max(0,(Date.now()-n.since)/1000),left=n.avgSeconds&&n.of?Math.max(0,(n.of-n.i+1)*n.avgSeconds-on):null;
    set('eta','this one '+mins(on)+(n.avgSeconds?' · '+mins(n.avgSeconds)+' a question':'')+(left!==null?' · about '+mins(left)+' left in this task':''));
    set('ask',String(n.ask||'').replace(/\\s+/g,' ').slice(-300));}
    const l=s.last;set('reply',l&&l.seconds!=null?'Last answer ('+Math.round(l.seconds)+' s): '+String(l.reply||'').replace(/\\s+/g,' ').slice(0,240):'');}
  // A ROW OF THIS RUN WITH NO BARS: the card was drawn in the run's first seconds, before it had said which tasks it asks, and
  // each such row read "not evaluated yet" for as long as the run went on, the task being asked among them (2026-11-20). The
  // card is drawn again, once, now that the run names its tasks; a row drawn from them has its bars
  if((s.tasks||[]).some(t=>{const row=box.querySelector('[data-evt="'+t.task+'"]');return row&&row.querySelector('[data-none]');})){
    await swap('/fragment/eval','#evalwrap');return;}
  for(const t of s.tasks||[]){const row=box.querySelector('[data-evt="'+t.task+'"]');if(!row)continue;
    // (a model the row has no bar for yet, a small model asked by itself once the first two are done: the card is drawn again)
    if(evSides([t]).some(who=>!row.querySelector('[data-w="'+who+'"]'))&&row.querySelector('[data-w]')){await swap('/fragment/eval','#evalwrap');return;}
    for(const who of evSides([t])){const w=row.querySelector('[data-w="'+who+'"]'),st=t[who]||{};if(!w||!t[who])continue;
      const pct=st.of?100*st.done/st.of:(st.state==='done'||st.state==='kept'?100:0);w.className='evw '+(st.state||'waiting');
      w.querySelector('i').style.width=pct.toFixed(1)+'%';const ws=w.querySelector('[data-ws]'),tx=(EVW[st.state]||(()=>''))(st);if(ws.textContent!==tx)ws.textContent=tx;}}
  // each body of work, in a line while it is folded; and the one being asked now opens, unless a person folded or opened it
  for(const m of box.querySelectorAll('[data-evm]')){const ts=(s.tasks||[]).filter(t=>m.dataset.evm==='*'||t.item===m.dataset.evm);if(!ts.length)continue;const tx=evMeta(ts,s.target||'the larger model',s.alone);if(m.textContent!==tx)m.textContent=tx;}
  // and its one bar, which shows while it is folded: how far the run is through the tasks it holds (_ev_through, the same share)
  for(const m of box.querySelectorAll('[data-evp]')){const sh=evShare((s.tasks||[]).filter(t=>m.dataset.evp==='*'||t.item===m.dataset.evp));if(!sh)continue;
    m.classList.toggle('asking',sh[1]);m.querySelector('i').style.width=sh[0].toFixed(1)+'%';}
  const at=(s.tasks||[]).find(t=>evSides([t]).some(w=>(t[w]||{}).state==='asking'));
  if(at&&box.dataset.at!==at.item){box.dataset.at=at.item;const d=box.querySelector('details[data-keep="eval-'+at.item+'"]');let v=null;try{v=localStorage.getItem('swarm.open.eval-'+at.item);}catch(e){}if(d&&v===null)d.open=true;}}
// THE MODELS AN EVALUATION ASKS, in the order it asks them (_ev_sides): the larger model, the swarm, each small model by itself
const evSides=ts=>['target','swarm',...[...new Set(ts.flatMap(t=>Object.keys(t).filter(k=>k.startsWith('alone-')&&t[k]&&typeof t[k]==='object')))].sort((a,b)=>{const x=a.replace('-form',''),y=b.replace('-form','');return x<y?-1:x>y?1:a.length-b.length;})];
const evWho=(w,tn,alone)=>w==='target'?tn:w==='swarm'?'the swarm':(((alone||{})[w.replace(/-form$/,'')])||'a small model')+' by itself'+(/-form$/.test(w)?', its reply laid out':'');
const evShare=all=>{const ts=all.filter(t=>!['target','swarm'].every(w=>String((t[w]||{}).why||'').startsWith('not asked')));if(!ts.length)return null;
  const ws=evSides(ts);let dn=0,tot=0,known=true,sum=0;for(const t of ts){const ss=ws.filter(w=>t[w]||!w.startsWith('alone-')).map(w=>t[w]||{}),d=Math.min(...ss.map(x=>Number(x.whole??x.done)||0)),n=Math.max(0,...ss.map(x=>Number(x.of)||0));dn+=d;tot+=n;
    if(n)sum+=Math.min(1,d/n);else if(ss.every(x=>['done','kept'].includes(x.state)))sum+=1;else known=false;}
  return [Math.min(100,known&&tot?100*dn/tot:100*sum/ts.length),ts.some(t=>ws.some(w=>(t[w]||{}).state==='asking'))];};
const evMeta=(all,tn,alone)=>{const na=t=>String((t.target||{}).why||'').startsWith('not asked');if(all.every(na))return all[0].target.why;
  const ts=all.filter(t=>!na(t)),k=all.length-ts.length;
  const w=who=>{const mine=who.startsWith('alone-')?ts.filter(t=>t[who]):ts,done=mine.filter(t=>['done','kept'].includes((t[who]||{}).state)).length,a=mine.find(t=>(t[who]||{}).state==='asking');
    return done+' of '+mine.length+' task'+(mine.length===1?'':'s')+' asked'+(a?', asking '+a.name+' '+((a[who].done||0)+1)+(a[who].of?' of '+a[who].of:''):'');};
  return evSides(ts).map(who=>evWho(who,tn,alone)+': '+w(who)).join(' · ')+(k?' · '+k+' not asked':'');};
// WHO HOLDS THE MACHINE: training, an evaluation or pretraining, started or stopped anywhere (this page, another device, a script).
// Each card was drawn again only when its OWN run ended, so a training run stopped left Evaluate and Pretrain saying they wait for it
// until the page was reloaded. When the holder changes, the three cards are drawn again in place
async function busyTick(){const m=$('#busy');if(!m)return;let s;try{s=await (await fetch('/api/busy')).json();}catch(e){return;}
  if(s.busy===m.dataset.busy)return;m.dataset.busy=s.busy;
  await swap('/fragment/eval','#evalwrap');await swap('/fragment/score','#score');
  if(s.busy==='training')watch();}
trainAsk();setInterval(()=>{evTick();busyTick();},1500);
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
// THE RECOMMENDATION COUNT IS KEPT CURRENT: what is recommended rests on evidence a running pass adds to, and on the configuration,
// which can be changed from elsewhere; drawn once with the page, the count went on saying what was true then
setInterval(()=>{if(!$('#recd')||!$('#recd').open)swap('/fragment/recslot','#rec-slot');},30000);
// AND SO IS THE MEMORY CARD: what the swarm takes is measured while it trains, every two minutes, and the line under Train is
// redrawn as it goes; the card was drawn once, and went on saying the estimate beside a line that said the measurement
setInterval(()=>{if($('#memwrap'))swap('/fragment/memory','#memwrap');},30000);
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


KIND_WORDS = {"sum": "An operation: a sum to work out", "truth": "An operation: an expression of true and false", "sorted": "An operation: words to put in alphabetical order", "closed": "An operation: brackets to close",
              "lies": "Logic: who tells the truth along a chain", "free": "Logic: when someone was free", "date": "Logic: a date some days away", "valid": "Logic: whether an argument is valid",
              "deduce": "Logic: an order from clues", "rules": "Instructions: rules a program checks", "calls": "Calling a function, or not", "search": "Search: a tool for what is not known",
              "agent": "An agent's next step, with tools", "write-arrays": "Write a function: arrays", "write-strings": "Write a function: strings", "write-numbers": "Write a function: numbers",
              "write-parsing": "Write a function: parsing", "fix": "Correct a function", "bug": "Say what is wrong", "trace": "Say what a program prints",
              "answer": "Simple: an everyday question", "request": "Simple: something it cannot do, or needs to ask about", "piece": "Simple: a piece of writing", "talk": "Simple: conversation",
              "practice": "Developer: a question of good practice", "shown": "Developer: their own project",
              "chain": "Math: sums in a row", "shop": "Math: a word problem", "rate": "Math: rates", "units": "Math: units", "count": "Math: counting",
              "order": "Logic: an order", "day": "Logic: a day of the week", "trap": "Logic: the first answer is wrong",
              "letters": "Reasoning: counting letters", "string": "Reasoning: a word changed in steps", "extract": "Reasoning: a figure read from a passage"}




def more_words(d, kinds=True):
    """WHAT THE PASS IN HAND ASKS MORE OF, AND WHY, in a sentence or two (data.emphasis_of): the kinds, so many more of each, and
    which of them its own held questions asked for and which the proof did, with the capability the proof found short, by how
    much and on how many questions. '' where the pass asks no more of anything."""
    em = d.get("emphasis") or {}
    if not em.get("kinds"):
        return ""
    word = lambda k: KIND_WORDS.get(k, k)  # noqa: E731
    out = []
    if kinds:
        out.append("This pass asks more of: %s." % ", ".join("%s +%s" % (e(word(k)), e(str(n))) for k, n in em["kinds"].items()))
    fp = em.get("fromProof") or {}
    if fp.get("short"):
        out.append("The proof of %s found the swarm short on %s: %s more of each of its kinds. Only the verdict is read from a proof, never one of its questions."
                   % (e(str(fp.get("readAt") or "")[:10]),
                      e("; ".join("%s, by %.3f on %s questions%s" % (c.get("name"), abs(c.get("gap") or 0), c.get("n"), "" if c.get("proof") else " (a check)") for c in fp["short"])),
                      e(str(fp.get("more")))))
    elif fp:
        out.append("The proof of %s was read: no capability is short in it." % e(str(fp.get("readAt") or "")[:10]))
    return " ".join(out) + " " if out else ""


def how_far(equivalent, compared):
    """HOW FAR ALONG, SAID ONE WAY wherever it is said: the percentage, then the count it is made of. '59.5% · 25 of 42'.
    The page has many places that say it (the strip, the header, the passes, each kind, each model alone, the spec); they all say
    it with this, from the same two numbers, so no two of them can disagree."""
    return "%s%% · %d of %d" % (fmt_pct(data.percent(equivalent, compared)), equivalent, compared)


def fmt_pct(x):
    """A percentage as it is said: 63, 62.5, and 100 only when it is 100. (To one decimal first: 55.00000000000001, which is what
    0.55 times a hundred comes to, was said "55.0" beside a "60".)"""
    x = round(float(x), 1)
    return ("%d" % x) if x == int(x) else ("%.1f" % x)






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
            '<p class="muted small" style="margin:8px 0 10px">Every move open to this pass. A queued move is tried first on each question not answered well yet, and kept only on evidence.</p>'
            '<input type="search" id="steer-find" placeholder="Find a move: decider, revise, a-critic, temperature..." aria-label="Find a move">%s' % "".join(groups))


# (the record's own names stay: "at parity" is an answer that was good as the swarm stood, "reached" one a change made good. Good:
# right by the question's own standard, or equivalent to an answer the larger model agrees with itself on. docs/swoa-parity.md)
LOOP_STATE = {"at parity": ("Good as it stood", "up"), "reached": ("Made good by a change", "up"), "not reached": ("Not good yet", "down"), "not compared": ("Not graded", "planned"),
              "reopened": ("Back in hand", "planned"), "set aside": ("Set aside", "planned"),
              "mark wrong": ("Set aside: the larger model's answer is wrong", "planned"),
              "mark unstable": ("Set aside: the larger model did not give this answer again", "planned"),
              "no standard": ("Left out: the larger model's own answers do not agree", "planned")}


def near_words(n):
    """How close a reply came, in words (training/loop.mjs nearOf): where the answer was lost, how many slots had it, the decider's
    probability on it; and first, where the reader read one, how the reply itself read (what closeness counts first)."""
    if not n:
        return ""
    if n.get("parity"):
        return "good here, but it broke %s when that was asked again" % n.get("broke", "a question")
    return (("the reply read %.2f, " % n["reply"]) if n.get("reply") is not None else "") + "lost in %s, %d slot%s had the answer%s%s" % (n.get("lost", ""), n.get("had", 0), "" if n.get("had") == 1 else "s",
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
                "up" if a.get("kept") else "", "kept" if a.get("kept") else "good here" if a.get("grade") == "right" else "no",
                e(a.get("move", "")),
                ((" · lost <code>%s</code>, already good" % e(a["lostOn"])) if a.get("lostOn") else
                 (" · %d already good asked again, none lost" % a["guard"]["asked"]) if a.get("kept") and (a.get("guard") or {}).get("asked") else "")
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
               "suggest": "trying what the larger model suggested", "guard": "checking a change on other questions"}


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
        rows.append(("This pass", "%d of %d questions finished: <b>%d</b> good as the swarm stood, <b>%d</b> made good by a change%s%s. %d changes tried; <b>%d</b> kept "
                     "(%d of them found arrangements, %d suggested by the larger model%s)."
                     % (len(qs) - back, of, st_("at parity"), st_("reached"), (", %d not good yet" % st_("not reached")) if st_("not reached") else "",
                        ((", %d back in hand after a swap" % st_("reopened")) if st_("reopened") else "") + ((", %d set aside until the others are done" % st_("set aside")) if st_("set aside") else ""), tries, len(ch), from_lib, sg.get("kept", 0), (", %d swap%s" % (swaps, "" if swaps == 1 else "s")) if swaps else "")))
    rows.append(("Found arrangements", ("<b>%d</b>, tried first on every question not answered well yet; the most successful has made %d answer%s good."
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
    lpol_ = (d.get("policy") or {}).get("loop") or {}
    steps = [("ask", "Ask the swarm as it stands"), ("library", "Try the found arrangements, the most successful first"),
             ("search", "Search, best first: the plan's moves in the policy's order, building on what came closer; widen, never move on"),
             ("suggest", "Every %d failed tries, try what the larger model suggests; where no slot drafts the answer, every %d, the briefs it writes for the failing drafters" % (pol["suggestEvery"], pol.get("teachEvery", 60))),
             *([("guard", "Good here: score it on the questions of its class, the first %s first" % e(str(lpol_.get("classRace", 8)))),
                ("keep", "Its class got better: keep it, add it to the found arrangements, next question")] if lpol_.get("classKeep") is True else
               [("guard", "Good here: ask it again on up to %s questions already good" % e(str(lpol_.get("guard", 6)))),
                ("keep", "None lost: keep it, add it to the found arrangements, next question")])]
    flow = "".join('<li%s><span>%s</span></li>' % (' class="on"' if k == phase else "", e(t)) for k, t in steps)
    return ('<div class="plannow"><table class="spec kv">%s</table><p class="small" style="margin:10px 0 4px"><b>Each question, in order</b> (the step it is on is marked):</p>'
            '<ol class="qsteps">%s</ol></div>' % ("".join("<tr><th>%s</th><td>%s</td></tr>" % (e(k), v) for k, v in rows), flow))


def now_codes(d):
    """THE BOXES OF THE SYSTEM PICTURE THAT ARE IN USE THIS MOMENT (console 2026-11-24: the picture highlights the step being
    exercised). From what is running and the line the trainer says of what it is asking: the run's step (R1 to R4), the
    judge while an evaluation asks (J1), and inside training the step of the class stage (S1 as it stands, S2 a change
    being tried, S3 two together, S4 the held questions) with what the change being tried is of (K1 the arrangement, K2
    an adapter, K3 code, K4 breakdown or cascade, K5 conversation). A set of codes; empty where nothing runs."""
    out = set()
    root = Path(d.get("root", ARGS.root))
    whole = (job_state("whole") or {}).get("running")
    conv = (job_state("converse") or {}).get("running")
    if whole:
        steps, _ = whole_steps(ARGS.root, d.get("key") or "")
        for i, x in enumerate(steps):
            if x["state"] == "running":
                out.add("R%d" % (i + 1))
                if i in (0, 3):
                    out.add("J1")
                if i == 1:
                    out.add("K2")
    if (job_state("eval") or {}).get("running"):
        out.add("J1")
    live = data._json(root / ".work" / "train" / "live.json", {}) or {}
    try:
        fresh = time.time() - (root / ".work" / "train" / "live.json").stat().st_mtime < 300
    except OSError:
        fresh = False
    if live.get("trainer") == "classes" and fresh and (whole or conv or _classes_alive()):
        step = str(live.get("step") or "")
        if conv:
            out.add("K5")
        if step.startswith("Time:"):
            out.add("K6")
        elif "how the swarm stands" in step:
            out.add("S1")
        elif "held questions" in step:
            out.add("S4")
        elif 'trying "' in step:
            name = step.split('trying "', 1)[1]
            out.add("S3" if " + " in name else "S2")
            out.add("K2" if name.startswith("adapters:") else "K3" if "is done by code" in name else "K4" if name.startswith(("breakdown:", "cascade:")) else "K5" if name.startswith("manners:") else "K1")
    return out


def _classes_alive():
    """Whether the class stage is running though this page did not start it (a terminal): its process is there."""
    # (of THIS folder: the stage writes its note here every question. A stage of another checkout, or the real one while the
    # checks run in a folder of their own, is not this one)
    try:
        f = Path(ARGS.root) / ".work" / "train" / "live.json"
        if time.time() - f.stat().st_mtime > 300 or (json.loads(f.read_text()) or {}).get("trainer") != "classes":
            return False
    except (OSError, ValueError):
        return False
    try:
        return "training/classes.mjs" in subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return False


def viz_block(d):
    """VISUALIZING THE SYSTEM: every part of training as a coded box (A1, B3 ...) a person can name when talking about it, in the order
    things happen. The box the loop is in now is marked, live (the page's poll; data-part names the step)."""
    lpo = loop_policy_of(d)
    pol = {"reviewTries": 40, "trialTries": 40, "suggestEvery": 20, "swapAfter": 25, "stableAfter": 6, "stableMax": 2, **(lpo.get("loopPolicy") or {})}
    lib = len(library_of(d))
    lpol_ = (d.get("policy") or {}).get("loop") or {}
    guard = lpol_.get("guard", 6)
    by_class = lpol_.get("classKeep") is True
    tname = (d.get("target") or {}).get("name", "the larger model")
    dname = (d.get("decider") or {}).get("name", "the decider")
    cpol = (d.get("policy") or {}).get("classes") or {}
    # (inside one try, as the arrangement that is run says it: how many draft first, and how the matter is settled)
    plan_ = (d.get("briefs") or {}).get("plan") or {}
    n_draft = len([x for x in (d.get("briefs") or {}).get("slots", []) if x.get("stage") == "draft"])
    first_n = plan_.get("draftFirst") if isinstance(plan_.get("draftFirst"), int) and 2 <= plan_.get("draftFirst") < n_draft else 0
    no_dec = ((d.get("decider") or {}).get("serve") or {}).get("kind") == "none"
    most = str(plan_.get("decideBy") or "") == "most"
    now_ = now_codes(d)
    box = lambda code, part, title, body: ('<div class="vbox%s" data-code="%s"%s><b><span class="vcode">%s</span>%s</b><small>%s</small></div>'  # noqa: E731
                                           % (" on" if code in now_ else "", code, (' data-part="%s"' % part) if part else "", code, e(title), e(body)))
    arrow = '<span class="varr" aria-hidden="true"></span>'
    lane = lambda key, title, boxes, foot="": ('<div class="vlane"><div class="vhead"><span class="vkey">%s</span><b>%s</b></div><div class="vrow">%s</div>%s</div>'  # noqa: E731
                                               % (key, e(title), arrow.join(boxes), ('<p class="vfoot">%s</p>' % foot) if foot else ""))
    # THE WHOLE OF IT, round the lanes of the arrangement's training (2026-11-22). The picture drew the search for an arrangement
    # and nothing else, while most of what was measured came from what it left out: the code a request meets, the instruments,
    # pretraining by role, and the evaluation that judges all of it. So: R the run in order, M a request inside the module, K the
    # three things training keeps and how far each can reach; then the lanes there were (R3 in detail); then J, the judge.
    steps_, _ = whole_steps(ARGS.root, d.get("key") or "")
    going = bool((job_state("whole") or {}).get("running"))
    said_ = {"done": "Done", "running": "Running now" if going else "Stopped here", "failed": "Failed", "not taken": "Not taken", "waiting": ""}
    r_words = ["A third party&#39;s harness asks the module as it starts: no adapter, no instrument on.",
               "One for each drafting slot: its own right answers, and the larger model&#39;s where it was wrong. On no slot yet: K2.",
               "Each class of input as a class: lanes S to E below. Where the class falls short decides what is tried first; a change (code for a kind of question, a slot&#39;s adapter, the question taken apart, a slot working by facts, how many slots and models, how drafts are settled) is kept only where held questions gain: K1 to K4.",
               "The same questions again: two figures side by side, J2."]
    rbox = lambda i, x: ('<div class="vbox%s" data-code="R%d"><b><span class="vcode">R%d</span>%s</b><small>%s%s</small></div>'  # noqa: E731
                         % (" on" if (going and x["state"] == "running") or ("R%d" % (i + 1)) in now_ else "", i + 1, i + 1, e(x["name"]),
                            ("<b>%s.</b> " % said_[x["state"]]) if said_.get(x["state"]) else "", r_words[i] if i < len(r_words) else ""))
    on_ = lambda pl: list(data.__dict__.get("INSTRUMENT_IDS") or ["sum", "truth", "sorted", "closed", "lies", "word", "row", "date", "free", "order", "more", "valid", "number", "weekday", "letters", "range", "track", "path", "quantity"]) if (pl or {}).get("instruments") is True else list((pl or {}).get("instruments") or [])  # noqa: E731
    br_ = d.get("briefs") or {}
    inst_ = ([("every class", on_(br_.get("plan")))] if on_(br_.get("plan")) else []) + [(c, on_((k or {}).get("plan"))) for c, k in (br_.get("kinds") or {}).items() if on_((k or {}).get("plan"))]
    inst_words = ("On now: %s." % "; ".join("%s (%s)" % (", ".join(v), c) for c, v in inst_)) if inst_ else "None is on yet."
    head_ = ('<p class="vintro">How a module is made and judged, every part coded so it can be named (K3, B3). Lanes run top to bottom; steps run in the '
             "order of the arrows. The marked box is where the run, or the loop, is now.</p>"
             + lane("R", "The run, in order", [rbox(i, x) for i, x in enumerate(steps_)])
             + lane("M", "A request, inside the module", [
                 box("M1", "", "Read · code", "Its class, from the request alone: with tools, a conversation, asking for code, a plain question."),
                 box("M2", "", "Code first", "An operation code does exactly, where training turned that instrument on, or a kind of question training wrote and kept a function for: done by code, no model asked. A search: a program of code that asks the module only to read."),
                 box("M3", "", "Arrangement · models", "Otherwise the class's slots and flow: lane C. One small model holds several adapters at once, and each request is served with the one its slot carries, where training put one there. Or one slot alone, where training found that enough. Where training kept it, code first puts the question in numbered lines, or a slot works it one fact at a time."),
                 box("M4", "", "Form · code", "The reply laid out and closed as the conversation shows; code goes out as it was settled.")],
                 "To the program that uses it this is one chat model. M1 to M4 are its wiring, and the wiring is what training finds.")
             + lane("K", "What training keeps, and how far each can reach", [
                 box("K1", "", "Arrangement", "What each slot is told, how many slots there are and on which model, how they are arranged and how their answers are settled, class by class; one slot alone is an arrangement too. It reaches the best answer any slot drafted, and cannot make one no slot had."),
                 box("K2", "", "Adapters, by slot", "A mixture: each drafting slot may carry its own, and the steps after them settle between them. They reach what the small model can learn."),
                 box("K3", "", "Instruments", "Operations done exactly. They can pass %s, but only where a question is that operation. %s" % (tname, inst_words)),
                 box("K4", "", "Breakdown, cascade", "The question taken apart by code: numbered lines for every drafter, or one slot working a fact at a time while code carries what was worked out. Tried like any change; on four small models neither has gained yet (2026-11-24)."),
                 box("K5", "", "Conversation", "Made-up people write over several turns, and each reply is read by code against the conventions of that conversation. Code can tidy a reply (praise, an offer of help, a sentence said again, a second greeting), and what a pass still misses is asked more of in the next."),
                 box("K6", "", "Time, the tie-breaker", "Correctness first. Then: the same model served another way (another build of the engine), or a leaner arrangement, is kept where held answers are no worse and come at least 15% sooner, beyond the error of the timing.")],
                 "Each is kept only where held questions gained, by the one rule at S5. As a module starts, nothing is kept and no instrument is on. The held questions are training&#39;s own: what is kept here is still to be shown by the judge, J.")
             + '<p class="vintro vsub"><b>R3 in detail.</b> The run takes lanes A, S and C: each class of input, as a class. A whole pass (from a terminal: <code>bash training/session.sh</code>) goes on through B, D and E.</p>')
    tail_ = lane("J", "The judge, apart from training", [
        box("J1", "", "The harness", "A third party's benchmarks, unchanged, ask through the chat interface as they ask any model. Training never asks one of their questions, and is not shaped to how they ask."),
        box("J2", "", "Two figures", "As configured, which is the baseline, and trained, on the same questions: R1, R4."),
        box("J3", "", "Beside them", "The small model asked plainly, the same with the module's layout only, and %s." % tname),
        box("J4", "", "The verdict", "By capability: parity, short, or too few questions to say. A hundred questions a task, at least, is proof.")])
    return ('<div class="panel viz">__VIZ_HEAD__%s%s%s%s%s%s__VIZ_TAIL__</div>' % (
                lane("A", "Once a pass", [
                    box("A1", "", "Questions", "Of every body of work. Train questions are trained on; held questions are only checked."),
                    box("A2", "", "The standard", "The question's own where it has one; else the answers %s agrees with itself on." % tname),
                    box("A3", "", "The plan", "The moves the search draws its changes from.")]),
                # FIRST IN A PASS: each class of input as a class (training/classes.mjs), before the larger model is asked anything
                lane("S", "First in a pass: each class of input, as a class", [
                    box("S1", "", "As it stands", "Every question of the class: did a slot have it, was it settled on, is the reply good. Each wrong one is sorted: no slot had it, a slot had it and it was lost, or the reply spoiled it."),
                    box("S2", "", "Sweep, then the rest", "Every change that leaves the drafts as they are (an instrument on, one slot alone, how answers are settled), the drafts reused. Then the others, those for the widest of the three gaps first: a slot's adapter, the question taken apart, a slot working by facts, slots and models added or dropped, how drafts are settled."),
                    box("S3", "", "Together", "The best two of the sweep as one change."),
                    box("S4", "", "Held, twice", "The best against the swarm as it stands: every held question of the class, %s draws." % cpol.get("draws", 2)),
                    box("S5", "", "Keep", "Gain over twice its error, losses outweighed by twice as many made good, no kind fallen beyond chance for as many kinds as there are.")],
                     "The same rule keeps a change at B5. Then again from what was kept, up to %s rounds a class." % cpol.get("rounds", 2)),
                lane("B", "Each question, until its answer is good", [
                    box("B1", "ask", "Ask", "The swarm as it stands."),
                    box("B2", "library", "Found arrangements", "%d, the most successful first." % lib),
                    box("B3", "search", "Search", "Best first: builds on what came closer, widens when all are tried."),
                    box("B4", "suggest", "Suggestions", "Every %s failed tries, %s names changes to try." % (pol["suggestEvery"], tname)),
                    box("B5", "guard", "Check", ("Its class's train questions, %s first; then its held questions on two draws, by the rule at S5." % lpol_.get("classRace", 8)) if by_class else "Asked again on up to %s questions already good." % guard),
                    box("B6", "keep", "Keep", "Into the arrangement, the found arrangements and the spec.")],
                     ("Not good yet: back to B3; it never moves on. Its class no better at B5: not kept, back to B3." if by_class
                      else "Not good yet: back to B3; it never moves on. Loses a question at B5: built on, aimed at that question, and swapped after %s." % e(swap_words(pol)))),
                lane("C", "Inside one try", [
                    box("C1", "", "Draft", ("%d slots first, each its own way; the other %d only where those differ." % (first_n, n_draft - first_n)) if first_n else "Each slot answers its own way."),
                    box("C2", "", "Try", "Code runs in a sandbox; drafts that behave alike are one answer."),
                    box("C3", "", "Check, revise", "Only where the drafts differ: checkers find faults; answers are revised."),
                    box("C4", "", "Decide", ("The answer most slots hold stands%s." % ("" if no_dec else "; %s breaks a tie" % dname)) if most else ("A small model of the swarm picks the answer." if no_dec else "%s picks the answer." % dname)),
                    box("C5", "", "Write", "The reply."),
                    box("C6", "", "Grade", "Good by its standard? Partial credit says how close.")]),
                lane("D", "Always: how the search improves", [
                    box("D1", "", "Policy", "The settings the search runs by."),
                    box("D2", "review", "Review", "Every %s tries, %s proposes a change." % (pol["reviewTries"], tname)),
                    box("D3", "", "Trial", "%s tries; kept only if no worse." % pol["trialTries"])]),
                lane("E", "At the end of a pass", [
                    *([box("E1", "", "Proposed for the class", "Up to %s changes a class, those that most often brought its questions closer, scored on the class." % lpol_.get("classTries", 0))] if by_class and lpol_.get("classTries") else []),
                    box("E2" if by_class and lpol_.get("classTries") else "E1", "", "Held questions", "Does what was learned hold beyond the train questions?"),
                    box("E3" if by_class and lpol_.get("classTries") else "E2", "", "The spec", "Every kept change, cumulative; published with its proof.")]))).replace("__VIZ_HEAD__", head_).replace("__VIZ_TAIL__", tail_)


def plan_block(d):
    """What the plan part of the page holds: what training is trying now, class by class (class_plan), then the plan the
    question-by-question loop tries from (the questions themselves are on the swarm's card)."""
    earlier = class_plan(d) + class_plan(d, "conversation") + plan_panel(d)
    return training_now(d) + ('<details class="cfg fold" data-keep="plan-earlier"><summary><span class="cfgh">Earlier</span><span class="fmeta">the last runs in full, and the question-by-question pass</span></summary><div class="foldb">%s</div></details>' % earlier)


# WHAT EACH STAGE OF THE INTELLIGENCE RUN IS: what it does, and what it leaves for the next. Said on the plan's card beside
# where the stage stands, so that a run an hour into its first stage says what that hour is for (console 2026-11-25).
STAGE_WORDS = {
    "1-evaluate-as-configured": (
        "The baseline. Nothing is changed in this stage. The module exactly as it is configured answers standard benchmark questions, "
        "and so do the larger model and each small model of the swarm by itself, on the same questions, marked by the same checker.",
        "It leaves the first of the run&#39;s two figures: how the swarm scores before this run trains it, beside the larger model and beside its own model alone."),
    "2-make-adapters": (
        "An adapter is made for each drafting slot: a small set of weights taught from that slot&#39;s own right answers, and from the larger model&#39;s where the slot was wrong.",
        "It leaves adapters that are on no slot yet. Whether a slot carries one is a change the next stage tries, and keeps only where it helps."),
    "3-train-classes": (
        "The training itself. Each class of request (a turn with tools, a conversation, a request for code, a plain question) is trained as a class, on questions training makes itself: "
        "no benchmark question is asked. Changes are tried one at a time on train questions: the arrangement of slots, an adapter on a slot, a kind of question answered by code, "
        "a question read into a form and worked out by code, a function or a reading the larger model writes.",
        "It leaves the module as it will be served: a change is kept only where held questions, which no change was tried on, gain by more than their error."),
    "4-evaluate-trained": (
        "The same benchmark questions as the first stage, asked of the module as training left it.",
        "It leaves the second figure, set beside the first on the Evaluate card: what this run&#39;s training was worth on questions training never saw."),
}
STAGE_STATE = {"done": "done", "running": "in hand now", "stopped": "stopped here", "not taken": "not taken", "failed": "failed", "waiting": "to come"}


def _stage_eval_now(d, tname):
    """The evaluation in hand, in lines: what it is asking this moment, then each model it asks in the order it asks them and
    how far through the tasks each is, then the questions every one of them has answered. '' where nothing says."""
    root = Path(d.get("root", ARGS.root))
    f = root / ".work" / "eval" / "live.json"
    live = data._json(f, {}) or {}
    try:
        if live.get("phase") in ("done", "stopped", "failed") or time.time() - f.stat().st_mtime > 900:
            return ""
    except OSError:
        return ""
    rows = [t for t in live.get("tasks") or [] if not str((t.get("target") or {}).get("why") or "").startswith("not asked")]
    out = ['<p class="small"><b>This moment:</b> %s</p>' % e(str(live.get("step") or "making ready"))]
    if rows:
        who_now = str((live.get("now") or {}).get("who") or "")
        said = []
        for w in _ev_sides(rows):
            mine = [r for r in rows if w in r] if w.startswith("alone-") else rows
            states = [(r.get(w) or {}).get("state") for r in mine]
            done = sum(1 for s in states if s in ("done", "kept"))
            kept = sum(1 for s in states if s == "kept")
            at = next((r for r in mine if (r.get(w) or {}).get("state") == "asking"), None)
            name = _ev_who(w, tname, live.get("alone"))
            what = ("asking %s, question %d%s" % (e(at.get("name") or at.get("task")), ((at.get(w) or {}).get("done") or 0) + 1, (" of %d" % at[w]["of"]) if (at.get(w) or {}).get("of") else "")) if at else \
                   ("every task asked" if done == len(mine) else "waits its turn" if not done else "between tasks")
            said.append('<li data-s="%s"><b>%s</b>: %d of %d tasks%s · %s</li>'
                        % ("on" if at or w == who_now else "done" if done == len(mine) else "", e(name[0].upper() + name[1:]), done, len(mine),
                           (" (%d with answers kept from before, not asked again)" % kept) if kept else "", what))
        if "alone" not in live and not any(w.startswith("alone-") for w in _ev_sides(rows)):
            said.append('<li data-s=""><b>Each small model of the swarm by itself</b>, plainly and then with its reply laid out · waits its turn</li>')
        out.append('<p class="small" style="margin:6px 0 0"><b>Who is asked, in this order:</b></p><ol class="small stgw">%s</ol>' % "".join(said))
        out.append('<p class="small muted" style="margin:6px 0 0">A run that is carried on keeps every answer it had: a task whose answers are kept is not asked again.</p>')
        prog = ev_progress(live)
        if prog:
            out.append('<p class="small" style="margin:6px 0 0"><b>So far:</b> %s.</p>' % e(prog))
    return "".join(out)


def run_stages(d, running):
    """THE INTELLIGENCE RUN, STAGE BY STAGE, on the plan's card: its four stages in order, each with what it does, what it
    leaves, and where it stands; the one in hand opened out to what is happening this moment. With no run going, the same
    list says what a run will do, and where one that was stopped will carry on."""
    root = Path(d.get("root", ARGS.root))
    steps, done = whole_steps(root, d.get("key") or "")
    if not running:
        steps = [dict(x, state="stopped" if x["state"] == "running" else x["state"]) for x in steps]
    tname = (d.get("target") or {}).get("name", "the larger model")
    begun = any(x["state"] != "waiting" for x in steps)
    items = []
    for i, x in enumerate(steps):
        does, leaves = STAGE_WORDS.get(x["id"], ("", ""))
        more = ""
        if x["state"] == "running":
            if x["id"] in ("1-evaluate-as-configured", "4-evaluate-trained"):
                more = _stage_eval_now(d, tname)
            elif x["id"] == "2-make-adapters":
                more = '<p class="small"><b>This moment:</b> %s</p>' % e(str(job_live("pretrain").get("step") or "making ready"))
            else:
                more = ('<p class="small"><b>This moment:</b> %s</p><p class="small" style="margin:6px 0 0">The class in hand, what has been tried and what has gained are set out under this list.</p>'
                        % e(str((data._json(root / ".work" / "train" / "live.json", {}) or {}).get("step") or stage_step() or "making ready")))
        elif x["state"] == "stopped":
            more = '<p class="small">%s</p>' % ("The run was stopped in this stage. Carry on begins it again: every task a model had finished is kept and not asked again, so it goes on from the task it was in."
                                               if x["id"] != "3-train-classes" and x["id"] != "2-make-adapters" else
                                               "The run was stopped in this stage. Carry on begins it again from what it had written down.")
        elif x["state"] == "done" and x["id"] in ("1-evaluate-as-configured", "4-evaluate-trained"):
            # (the figure of the last evaluation finished: the first stage's, until the fourth has run)
            score, of = whole_score(d)
            mine = (x["id"] == "4-evaluate-trained") or steps[3]["state"] != "done"
            more = ('<p class="small">The swarm had <b>%s%%</b> of %d benchmark questions right. Every task, beside the larger model, is on the Evaluate card.</p>' % (fmt_pct(score), of)) if score is not None and mine else ""
        elif x["state"] == "not taken":
            more = '<p class="small">Not taken: no adapter can be made for this model here, so training goes on without any to try.</p>'
        # (a row of the list is told by data-stage: the plan's own rows are the ones counted as <li class=...>, ui/check.py)
        items.append('<li data-stage="%d" class="stg %s"><div class="stgh"><span><i></i><b>Stage %d of 4</b> %s</span><small>%s%s</small></div><p class="small stgd">%s</p><p class="small stgl muted">%s</p>%s</li>'
                     % (i + 1, x["state"].replace(" ", "-"), i + 1, e(x["name"]), STAGE_STATE.get(x["state"], x["state"]), (" · %d min" % x["minutes"]) if x.get("minutes") else "", does, leaves, more))
    head = ("The intelligence run, stage by stage" if running or begun and not done else "The last intelligence run, stage by stage" if done else "What an intelligence run does, stage by stage")
    # (a line of its own, not a heading the plan folds its sections by: fold_sections folds at each h4)
    return '<p class="stgt">%s</p><ol class="stgs">%s</ol>' % (head, "".join(items))


def training_now(d):
    """THE CURRENT STATE OF TRAINING, AND ITS PLAN (console 2026-11-24: this part of the page is the present, not past runs).
    Whichever run is going, intelligence or conversation: the class in hand and the round, what is being asked this moment,
    where the class fell short and so what is tried first, how far the round is, what has gained so far, what is still to
    be tried, what was kept, and what the pass carried in. Where nothing is training it says so, and what the next run of
    each kind will begin from."""
    root = Path(d.get("root", ARGS.root))
    key = str(d.get("key", ""))
    res = root / "training" / "results" / key
    conv = bool((job_state("converse") or {}).get("running"))
    whole = bool((job_state("whole") or {}).get("running"))
    live = data._json(root / ".work" / "train" / "live.json", {}) or {}
    try:
        fresh = time.time() - (root / ".work" / "train" / "live.json").stat().st_mtime < 300
    except OSError:
        fresh = False
    alive = live.get("trainer") == "classes" and fresh and (conv or whole or _classes_alive())
    plain = lambda n: e(re.sub(r"^plan: ", "", str(n)))  # noqa: E731
    pts = lambda x: "%+.1f" % (100.0 * (x or 0))  # noqa: E731
    if not (conv or whole or alive):
        nxt = []
        for which, label in (("conversation", "The next conversation pass"), ("classes", "The next intelligence run")):
            g = data._json(res / (which + "-gaps.json"), None) or {}
            short = [k for k, v in (g.get("kinds") or {}).items() if v.get("n") and v.get("wrong", 0) * 3 >= v["n"]]
            # (and the kinds right on the train questions and still wrong on the held side: asked more of too, classes.mjs gapsOf)
            short += [k for k, v in (g.get("kinds") or {}).items() if k not in short and (v.get("held") or {}).get("wrong")]
            miss = ", ".join("%s (%d of %d)" % (e(k), v.get("missed") or 0, v.get("asked") or 0) for k, v in (g.get("conventions") or {}).items() if v.get("missed"))
            nxt.append("<li><b>%s</b> %s</li>" % (label, ("is pass %d. It begins from what pass %d left: %s%s." % ((g.get("pass") or 0) + 1, g.get("pass") or 0, ("more questions of %s" % ", ".join(e(k) for k in short)) if short else "no kind a third wrong",
                                                                    ("; conventions still missed: %s" % miss) if miss else "")) if g else "is the first: nothing is carried into it."))
        return ('<div class="panel plan" id="trainnow"><div class="plan-head"><h3>Training now</h3><span class="muted small">Nothing is training</span></div>'
                '<p class="small" style="margin:8px 0 0">Start a run above. Each tries its changes on train questions, keeps the best only where held questions gain beyond their error, and leaves what it was short on for the next.</p>'
                '<ul class="small" style="margin:6px 0 0;padding-left:18px">%s</ul>%s</div>' % ("".join(nxt), run_stages(d, False)))
    which = "conversation" if conv else "classes"
    # (the stage of the intelligence run in hand: only in its third is a class being trained)
    w_steps = whole_steps(root, key)[0] if whole and not conv else []
    stage_at = next((i + 1 for i, s in enumerate(w_steps) if s["state"] == "running"), None)
    stage_name = w_steps[stage_at - 1]["name"] if stage_at else "between stages"
    in_training = conv or not whole or stage_at == 3 or (alive and not stage_at)
    rec = stage_record(d) or data._json(res / (which + ".json"), None) or {}
    classes = [(K, C) for K, C in (rec.get("classes") or {}).items() if not C.get("skipped")]
    K, C = classes[-1] if classes else ("", {})
    rounds = C.get("rounds") or []
    R = rounds[-1] if rounds else {}
    cands = R.get("candidates") or []
    tried = {c.get("name") for c in cands}
    todo = [n for n in (R.get("plan") or []) if n not in tried]
    g = R.get("gap") or {}
    of = R.get("of") or len(cands) or 1
    out = ['<div class="panel plan" id="trainnow" data-training="1"><div class="plan-head"><h3>Training now: %s</h3><span class="muted small">%s</span></div>'
           % ("the conversation run, pass %d" % (rec.get("pass") or 1) if conv else ("the intelligence run, stage %d of 4" % stage_at) if whole and stage_at else "the intelligence run" if whole else "each class as a class",
              (e(("Requests %s" % CLASS_WORDS.get(K, K)) + (" · round %d" % len(rounds) if rounds else "")) if K else "starting") if in_training else e(stage_name))]
    if whole and not conv:
        out.append(run_stages(d, True))
    if not in_training:
        # (a stage that is not the training: the class's own detail under this is of the last training, and is not shown as now)
        return "".join(out) + "</div>"
    out.append('%s<p class="small" style="margin:8px 0 0"><b>This moment:</b> %s</p>' % ('<p class="stgt">The class in hand</p>' if whole and not conv else "", e(str(live.get("step") or "starting"))))
    car = rec.get("carried") or {}
    if car.get("focus"):
        out.append('<p class="small" style="margin:6px 0 0"><b>Carried in from the last pass:</b> %d more train questions of %s.</p>' % (car.get("more") or 0, ", ".join("%s +%s" % (e(k), v) for k, v in car["focus"].items())))
    if K:
        out.append('<p class="small" style="margin:6px 0 0"><b>The class:</b> %d train questions and %d held, of %d kinds. Kept so far this pass: %s.</p>'
                   % (C.get("train") or 0, C.get("held") or 0, len(C.get("kinds") or []), ("<b>%s</b>" % "; ".join(plain(k) for k in C["kept"])) if C.get("kept") else "nothing yet"))
    if g:
        out.append('<p class="small" style="margin:6px 0 0"><b>Where it falls short:</b> %d wrong as it stood: no slot had the answer %d, a slot had it and it was lost %d, the reply spoiled it %d. So %s.</p>'
                   % (g.get("wrong") or 0, g.get("none") or 0, g.get("lost") or 0, g.get("spoiled") or 0, GAP_WORDS.get(g.get("first"), "nothing was wrong, and the changes are tried in the policy&#39;s order")))
    if R.get("written"):
        out.append('<p class="small" style="margin:6px 0 0"><b>Code written this round:</b> %s.</p>' % written_words(R["written"]))
    if rounds:
        out.append('<p class="small" style="margin:6px 0 0"><b>This round:</b> %d of %d changes tried.</p><span class="prog" style="height:10px"><i class="eq" style="width:%.1f%%"></i></span>' % (len(cands), of, 100.0 * min(1.0, len(cands) / of)))
        top = sorted(cands, key=lambda c: -(c.get("gain") or 0))[:6]
        if top:
            out.append('<h4>Tried so far, the most gained first</h4><ul class="small" style="margin:4px 0 0;padding-left:18px">%s</ul>'
                       % "".join("<li>%s: counted %d of %d (%s points)</li>" % (plain(c.get("name", "")), c.get("counted") or 0, c.get("n") or 0, pts(c.get("gain"))) for c in top))
        if todo:
            out.append('<h4>Still to try this round</h4><ul class="small" style="margin:4px 0 0;padding-left:18px">%s%s</ul>'
                       % ("".join("<li>%s</li>" % plain(n) for n in todo[:10]), ("<li class=\"muted\">and %d more</li>" % (len(todo) - 10)) if len(todo) > 10 else ""))
        if R.get("best") and not R.get("held"):
            out.append('<p class="small" style="margin:8px 0 0"><b>Being confirmed on the held questions:</b> %s.</p>' % plain(R["best"]))
    return "".join(out) + "</div>"


def held_more_words(h):
    """Where a change put a function on, the held questions it was confirmed on were the class's and more of that function's
    kind (training/write-code.mjs moreHeldOf): said beside the verdict. '' otherwise."""
    m = (h or {}).get("more") or {}
    return (" and %d more of %s, where the change acts" % (m.get("questions") or 0, e(", ".join(m.get("kinds") or [])))) if m.get("questions") else ""


def written_words(written):
    """What a round's code writing came to, kind by kind (training/write-code.mjs): written and how it did on the questions it
    was not shown, or that none passed and why. A function that passed is then tried as a change like any other."""
    said = []
    for w in written or []:
        last = (w.get("tries") or [{}])[-1]
        if w.get("ok"):
            said.append("for <b>%s</b> (wrong on %d of %d), a function right on %d of %d questions it was not shown, in %d %s"
                        % (e(w.get("kind", "")), w.get("wrong") or 0, w.get("of") or 0, last.get("right") or 0, last.get("n") or 0, len(w.get("tries") or []), "try" if len(w.get("tries") or []) == 1 else "tries"))
        else:
            said.append("for <b>%s</b> (wrong on %d of %d), none passed: %s" % (e(w.get("kind", "")), w.get("wrong") or 0, w.get("of") or 0, e(w.get("why") or "nothing was written")))
    return "; ".join(said)


# WHAT TRAINING CAN CHANGE, in the words the page uses: every one is tried as a change to the arrangement and kept only where
# the held questions gain beyond their error (training/arrange.mjs steps, training/classes.mjs, training/keep.mjs)
TRAINS = [("Pure code", "a kind of question that is an operation is done by code, no model asked"),
          ("Written code", "for a kind of question the class is short on, a model of the swarm writes a function that works the answer out; it is run on questions it was not shown and refused on one wrong answer"),
          ("Adapters", "which slot carries the adapter made for it, on requests like what it was taught"),
          ("Breakdown", "the question put to the drafters with each thing it states on a numbered line"),
          ("Cascade", "a drafting slot works the question one fact at a time, code carrying what was worked out"),
          ("Slots and models", "a slot added, dropped or moved; every slot on one model; one slot asked as the request came"),
          ("Settling", "how the drafts are settled: by most, by the drafters alone, by a model"),
          ("The reply", "how the reply is written and closed"),
          ("Time, as the tie-breaker", "the same model served another way (another file of it, another build of the engine), or a leaner arrangement: kept where answers are no worse and come at least 15% sooner"),
          ("For one kind of request", "a change kept for requests of one kind within a class and no others: a turn that asks nothing, one asking for code inside a conversation, one after the person said how to answer"),
          ("The answer alone", "the settled answer goes out with no work before it"),
          ("A program checks the figure", "a drafter writes the sum as a program and code works it; its figure stands over the one the slots settled on, its answer stands where they settled on none, or its differing has the other drafters asked"),
          ("Going on", "a slot cut off before its answer is given its room again to finish"),
          ("Conversation", "a reply tidied by code: an opening that only praises, a closing that only offers help, a sentence said again, a greeting given twice")]
GAP_WORDS = {"none": "no slot had the answer, so what is drafted is tried first", "lost": "a slot had the answer and settling lost it, so settling is tried first",
             "spoiled": "the answer was settled and the reply spoiled it, so the reply is tried first"}


def time_lines(rec):
    """WHAT WAS TIMED, AND WHAT THE CLOCK DECIDED (training/keep.mjs keepOnTime; the record's `time`): each change tried on time
    alone, with the points its answers moved, the share of time saved with its error, seconds a question and tokens a
    second before and after, and whether it was kept or why not. '' where nothing was timed."""
    tm = (rec or {}).get("time") or {}
    if not tm.get("trials"):
        return ""
    rate = lambda x: "?" if x is None else ("%g" % x)  # noqa: E731
    rows = "".join('<li>%s: answers %+.1f points, <b>%.1f%%</b> of the time saved (error %.1f); %.1f s &rarr; %.1f s a question, %s &rarr; %s tokens a second: <b>%s</b></li>'
                   % (e(re.sub(r"^plan: ", "", t.get("what", ""))), 100.0 * (t.get("gain") or 0), 100.0 * (t.get("saved") or 0), 100.0 * (t.get("savedError") or 0),
                      (t.get("seconds") or {}).get("base") or 0, (t.get("seconds") or {}).get("with") or 0, rate((t.get("tokensPerSecond") or {}).get("base")), rate((t.get("tokensPerSecond") or {}).get("with")),
                      "kept" if t.get("keep") else "not kept: " + e(t.get("why", "")))
                   for t in tm["trials"])
    return ('<h4>Time, as the tie-breaker</h4><p class="small" style="margin:0">On %d held questions, %d draws, each timed as it was asked. A change is kept on time only where its answers are no worse.</p>'
            '<ul class="small" style="margin:4px 0 0;padding-left:18px">%s</ul>' % (tm.get("asked") or 0, tm.get("draws") or 2, rows))


def class_plan(d, which="classes"):
    """WHAT TRAINING IS TRYING NOW, CLASS BY CLASS (console 2026-11-24: this part of the page says in real time what is being
    trained). From the stage's own record as it writes it (training/results/<configuration>/classes.json: each class's train
    and held questions, where it falls short, every change tried with what it counted, the best and what the held questions
    said) and the line it says of what it is asking this moment (.work/train/live.json). Nothing here is a setting."""
    root = Path(d.get("root", ARGS.root))
    rec = data._json(root / "training" / "results" / str(d.get("key", "")) / (which + ".json"), None) or {}
    if which != "classes" and not rec:
        return ""
    live = data._json(root / ".work" / "train" / "live.json", {}) or {}
    try:
        fresh = time.time() - (root / ".work" / "train" / "live.json").stat().st_mtime < 300
    except OSError:
        fresh = False
    now = str(live.get("step") or "") if live.get("trainer") == "classes" and fresh and not rec.get("done") else ""
    pts = lambda x: ("%+.1f" % (100.0 * (x or 0)))  # noqa: E731
    can = "".join("<li><b>%s</b>: %s</li>" % (e(a), e(b)) for a, b in TRAINS)
    head = ('<div class="panel plan" id="%s"><div class="plan-head"><h3>%s</h3><span class="muted small">%s</span></div>'
            % ("classplan" if which == "classes" else "converseplan", "What training is trying" if which == "classes" else "What the conversation run is trying",e("Now: " + now) if now else "Finished %s" % e(str(rec.get("done"))[:16].replace("T", " ")) if rec.get("done") else "Training is not running" if not rec else "Stopped before it finished"))
    out = [head, '<p class="muted small" style="margin:8px 0 0">Each class of input is trained as a class. Training asks the class as it stands, sees where it falls short, tries the changes for that first, '
                 'and keeps the best only where held questions it was not chosen on gain by more than twice their error. What it can change:</p><ul class="small" style="margin:6px 0 0;padding-left:18px">%s</ul>' % can]
    # WHAT THIS PASS CARRIES FROM THE LAST, AND WHAT IT LEAVES FOR THE NEXT (training/classes.mjs gapsOf, focusOf)
    cw = lambda cv: ", ".join("%s (%d of %d)" % (e(k), v.get("missed") or 0, v.get("asked") or 0) for k, v in sorted((cv or {}).items(), key=lambda kv: -((kv[1].get("missed") or 0) / max(1, kv[1].get("asked") or 1))) if v.get("missed"))  # noqa: E731
    car = rec.get("carried") or {}
    if rec.get("pass"):
        fo = car.get("focus") or {}
        out.append('<p class="small" style="margin:10px 0 0"><b>Pass %d of this stage.</b> %s</p>'
                   % (rec["pass"], ("Carried from the last pass: %d more train questions of what it was short on (%s)%s." % (car.get("more") or 0, ", ".join("%s +%s" % (e(k), v) for k, v in fo.items()), ("; in conversation it had missed %s" % cw(car.get("conventions"))) if cw(car.get("conventions")) else ""))
                      if fo else "Nothing is carried from a pass before it: the last one left no kind a third wrong, or there was none."))
    gp = rec.get("gaps") or {}
    if gp:
        nx = gp.get("next") or {}
        out.append('<p class="small" style="margin:6px 0 0"><b>Left for the next pass.</b> %s%s</p>'
                   % (("Asked more of: %s." % ", ".join("%s +%s" % (e(k), v) for k, v in nx.items())) if nx else "No kind was left a third wrong.",
                      (" In conversation, still missed: %s." % cw(gp.get("conventions"))) if cw(gp.get("conventions")) else ""))
    out.append(time_lines(rec))
    for K, C in (rec.get("classes") or {}).items():
        name = "Requests %s" % CLASS_WORDS.get(K, K)
        if C.get("skipped"):
            out.append('<h4>%s</h4><p class="muted small" style="margin:0">Not trained: %s.</p>' % (e(name), e(C["skipped"])))
            continue
        rounds = C.get("rounds") or []
        out.append('<h4>%s</h4><p class="small" style="margin:0">%d train questions and %d held, of %d kinds. Kept so far: %s</p>'
                   % (e(name), C.get("train") or 0, C.get("held") or 0, len(C.get("kinds") or []),
                      ("<b>%s</b>" % "; ".join(e(re.sub(r"^plan: ", "", k)) for k in C["kept"])) if C.get("kept") else "nothing"))
        for i, R in enumerate(rounds):
            g = R.get("gap") or {}
            cands = R.get("candidates") or []
            top = sorted(cands, key=lambda c: -(c.get("gain") or 0))[:4]
            rows = "".join('<li>%s: counted %d of %d (%s points)</li>' % (e(re.sub(r"^plan: ", "", c.get("name", ""))), c.get("counted") or 0, c.get("n") or 0, pts(c.get("gain"))) for c in top)
            h = R.get("held")
            verdict = ("" if not R.get("best") else
                       '<p class="small" style="margin:4px 0 0">Best: <b>%s</b>. %s</p>'
                       % (e(re.sub(r"^plan: ", "", R["best"])),
                          ("On the held questions%s, %s draws: %s points with an error of %.1f: <b>%s</b>" % (held_more_words(h), h.get("draws") or 2, pts(h.get("gain")), 100.0 * (h.get("error") or 0), "kept" if R.get("kept") else "not kept")) if h
                          else "Being confirmed on the held questions"))
            out.append('<p class="small" style="margin:8px 0 0"><b>Round %d</b>: %d of %d changes tried.%s</p>%s%s'
                       % (i + 1, len(cands), R.get("of") or len(cands),
                          (" Wrong as it stood: %d (no slot had it %d, had it and lost it %d, reply spoiled %d): %s." % (g.get("wrong") or 0, g.get("none") or 0, g.get("lost") or 0, g.get("spoiled") or 0, GAP_WORDS.get(g.get("first"), "nothing was wrong"))) if g else "",
                          ('<ul class="small" style="margin:4px 0 0;padding-left:18px">%s</ul>' % rows) if rows else "", verdict))
    return "".join(out) + "</div>"


RANK_WORDS = {"pin": "pinned", "yield": "what its kind has yielded", "evidence": "the question's record", "momentum": "like a kept change", "learned": "what has worked",
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
        return ('<h4>Found arrangements</h4><p class="small muted" style="margin:0">None yet. Every arrangement training keeps '
                "is kept here too, across passes and Clear training state, and tried first on every question after.</p>")
    rows = "".join('<li><span class="pill up">%d</span> <span class="small"><b>%s</b> · found on <code>%s</code>%s</span></li>'
                   % (len(x.get("reached") or []), e(x.get("what", "")), e(str((x.get("from") or {}).get("question", ""))),
                      (" · tried %d time%s since" % (x["tried"], "" if x["tried"] == 1 else "s")) if x.get("tried") else "")
                   for x in sorted(lib, key=lambda x: -len(x.get("reached") or [])))
    return ('<h4>Found arrangements (%d)</h4><p class="small" style="margin:0 0 6px">Tried first on every question not answered well yet, the most successful '
            "first (the number: answers each has made good). Kept across passes and Clear training state; every keep adds to it.</p>"
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
        pol = {"reviewTries": 40, "trialTries": 40, "swapAfter": 25, "stableAfter": 6, "stableMax": 2, "brokeBudget": 12, "suggestEvery": 20, "teachEvery": 60, "prune": True, "setAsideAfter": 30, "firstVisitTries": 40, "dryClassAfter": 8, "helpBackoff": True, "kindBranch": True, **pol}
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
        ("and after %d tries in all on its first visit" % pol["firstVisitTries"]) if pol.get("firstVisitTries") else "",
        ("a class of change that brought a question nothing in %d tries tried last there" % pol["dryClassAfter"]) if pol.get("dryClassAfter") else "",
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
            "where the answers were lost decides what is listed first. Before it, each class of input is trained as a class: every change that leaves the drafts as they are is scored on the whole class, and the best is kept where the held questions bear it out. Training then tries from the plan, question by question.</p></div>" % n
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
        out.append('<h4>Questions</h4><p class="small" style="margin:0">New train questions, with more of the kinds the swarm was found short on: %s. %s</p>'
                   % (", ".join("<b>%s</b> +%s" % (e(x["kind"]), e(str(x["more"]))) for x in p["focus"]), more_words(d, kinds=False)))
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
    # (what a pass asks is not chosen: every body of work, so many kinds of question in all; the bodies its record names, where
    # the pass in hand was begun when fewer were asked)
    eqd = d.get("equivalence") or {}
    asked_b = [t for t in eqd.get("targets", []) if t["id"] in (eqd.get("asked") or [])]
    n_kinds = len({k for t in asked_b for k in t.get("kinds", [])})
    asks = ("A pass asks %s: <b>%d</b> kinds of question, and more of the kinds the swarm was found short on: by the pass before, on its own held questions, and by the proof, where an evaluation has found a capability short. %s"
            % ("every body of work" if len(asked_b) == len(eqd.get("targets", [])) else e(", ".join(t["name"] for t in asked_b)), n_kinds, more_words(d))) if asked_b else ""
    out.append('<h4>How it is training</h4><p class="small" style="margin:0">' + asks.replace("%", "%%") + 'A question stays in hand until its answer is good: it never moves on before%s. The arrangements found so far are tried on it first, the most successful first. Then changes are tried best first: from the closest arrangement open, and a change that comes closer is built on at once, with up to <b>%s</b> such arrangements open at a time; where every arrangement open has been tried, the search widens and builds on every arrangement it tried. '
               "%s%s %s"
               "A slot asked exactly what it was asked before answers as it did, without being asked again, so a try that changes one slot asks only what changed. The plan lists <b>%s</b> arrangements one change from here first, and <b>%s</b> that are %s changes from here at once.</p>"
               % ((" (or after <b>%s</b> changes, a bound a person set)" % e(str(cap_))) if cap_ else "", e(str(lpol.get("beam", 3))),
                  # (how a change is kept, as the policy has it: by its class, or question by question as before)
                  ("A change that makes it good is scored on the questions of its class, with the change and as the swarm stood: the first <b>%s</b>, and the rest where those did not fall. "
                   "It is kept when the class gained more than twice its error and at least <b>%s</b>, no kind of question fell by more than <b>%s</b>, and the held questions of the class did not fall by more than their error. "
                   "A question it scores otherwise on is asked a second time, on another draw: a change that made a question good on both draws and lost none is kept too, and one answer that came out otherwise once is no fall. "
                   "At the end of a pass up to <b>%s</b> changes a class, those that most often brought its questions closer, are proposed for the class outright and scored the same way."
                   % (e(str(lpol.get("classRace", 8))), e(str(lpol.get("classMinGain", 0.02))), e(str(lpol.get("classMargin", 0.05))), e(str(lpol.get("classTries", 0)))))
                  if lpol.get("classKeep") is True else
                  "A change that makes it good is asked again on <b>%s</b> questions already good, and is kept only if none is lost." % e(str(lpol.get("guard", 6))),
                  (" A change tried on <b>%s</b> questions that made none good is dropped." % e(str(drop_))) if drop_ else "",
                  "" if lpol.get("classKeep") is True else
                  "Where changes that make it good lose a question already good, what is built on them is aimed at that question; where they keep losing it (%s), one that loses only that one is kept and that question goes back in hand."
                  % e(swap_words({"swapAfter": 25, "stableAfter": 6, "stableMax": 2, **(loop_policy_of(d).get("loopPolicy") or {})})),
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
                '<button type="button" data-steer="unpin" data-id="%s">Unqueue</button>' % e(mid) if pinned else '<button type="button" data-steer="pin" data-id="%s" title="Try it first on each question not answered well yet">Next</button>' % e(mid),
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
        out.append('<p class="muted small" style="margin:12px 0 0">%d arrangements one step from this one are open, %d have been tried and dropped. A move is kept only on evidence: how is said under How it is training.</p>'
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
        meta["questions"] = "%d more train questions across %d kinds the swarm was found short on%s" % (
            sum(int(x.get("more", 0)) for x in p["focus"]), len(p["focus"]), ", some of them by the proof" if ((d.get("emphasis") or {}).get("fromProof") or {}).get("short") else "")
    bits = []
    if isinstance(mem, dict) and mem.get("pass") == n:
        best = next((x for x in mem.get("models") or [] if "drafts" in x), None)
        bits.append(("%s drafts %s of the %d no slot drafted" % (best["name"], best["drafts"], mem.get("gap", 0))) if best else "no other small model here to ask")
    if isinstance(rep, dict) and rep.get("pass") == n:
        bits += ["%s: %d against %d" % (r["decider"], r.get("theirsRight", 0), r.get("nowRight", r.get("kevRight", 0))) for r in rep.get("results") or []]
    if bits:
        meta["what-only-you-can-change"] = " · ".join(bits)
    # (first, what a pass asks: every body of work, or the ones its record names where the pass in hand was begun on fewer)
    eqm = d.get("equivalence") or {}
    asked_m = [t for t in eqm.get("targets", []) if t["id"] in (eqm.get("asked") or [])]
    meta["how-it-is-training"] = ("%suntil its answer is good, best first, building on the %s closest · %s" % (
        ("every body of work · " if len(asked_m) == len(eqm.get("targets", [])) else ", ".join(t["name"] for t in asked_m) + " · ") if asked_m else "",
        lpol.get("beam", 3), "a change kept when its class got better" if lpol.get("classKeep") is True else "asked again on %s before a keep" % lpol.get("guard", 6)))
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
    # ONE MODEL IN EVERY PLACE IS ONE FACE: every slot is its, and it is loaded once (src/index.mjs sharedLoads)
    filled = [k for k in ("a", "b", "c", "d") if k in members]
    same_model = len(filled) > 1 and len({(members[k] or {}).get("id") for k in filled}) == 1
    if same_model:
        gb = ((members.get(filled[0]) or {}).get("bytes") or 0) / 2**30
        roster.append('<div class="mav %s"><span class="face">%s</span><div><b>%s</b><small>in every role · %d slots · loaded once%s</small></div></div>'
                      % (filled[0], e(fc[filled[0]]), e(name(filled[0])), len(slots), (" · %.1f GB" % gb) if gb else ""))
    for place in ([] if same_model else filled):
        n_ = sum(1 for s in slots if s["member"] == place)
        gb = ((members.get(place) or {}).get("bytes") or 0) / 2**30
        roster.append('<div class="mav %s"><span class="face">%s</span><div><b>%s</b><small>%d slot%s%s</small></div></div>'
                      % (place, e(fc[place]), e(name(place)), n_, "" if n_ == 1 else "s", (" · %.1f GB" % gb) if gb else ""))
    # WHO DECIDES, as the arrangement that is run has it: a decision model; or none, and then the answer most slots hold stands
    # (decideBy "most") or a small model of the swarm picks
    plan0 = b.get("plan") or {}
    no_dec = ((d.get("decider") or {}).get("serve") or {}).get("kind") == "none"
    most0 = str(plan0.get("decideBy") or "") == "most"
    if no_dec:
        roster.append('<div class="mav decider"><span class="face">%s</span><div><b>%s</b><small>%s</small></div></div>'
                      % (("&#8805;" if most0 else e(initials(dec))), "No decision model", "the answer most slots hold stands" if most0 else "a small model of the swarm decides"))
    else:
        roster.append('<div class="mav decider"><span class="face">%s</span><div><b>%s</b><small>%s%s</small></div></div>'
                      % (e(initials(dec)), e(dec), "breaks ties" if most0 else "decides", (" · about %s GB" % e(str(d["decider"]["memGb"]))) if (d.get("decider") or {}).get("memGb") else ""))
    if t:
        roster.append('<button type="button" class="mav tgt" data-av="target" title="%s: the larger model the swarm is brought to parity with. Choose it to read how it is served"><span class="face">%s</span><div><b>%s</b><small>the target%s</small></div>'
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
        later = 0
        if do in ("draft", "revise"):
            ds = of(step, "draft")
            # DRAFTING IN TWO ROUNDS (plan.draftFirst; src/orchestrate.mjs firstDrafters, the same rule): the slots that draft
            # first are drawn first, and the others after them, marked as asked only where the first differ
            nfirst = plan0.get("draftFirst")
            if do == "draft" and isinstance(nfirst, int) and 2 <= nfirst < len(ds):
                lead = []
                for x in ds:
                    if len(lead) < nfirst and not any(y["member"] == x["member"] for y in lead):
                        lead.append(x)
                for x in ds:
                    if len(lead) < nfirst and x not in lead:
                        lead.append(x)
                rest = [x for x in ds if x not in lead]
                later = len(rest)
                faces = [face_of(x) for x in ds if x in lead] + [re.sub(r'class="av (\w+)', r'class="av \1 later', face_of(x), count=1).replace('title="', 'title="Drafts only where the first %d differ · ' % nfirst, 1) for x in rest]
            else:
                faces = [face_of(x) for x in ds]
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
                what = "most hold" if no_dec else "ties only"
            faces = [special("decide", "decider", "&#8805;" if most and no_dec else e(initials(dec)), what, "%s: %s" % (dec, "keeps the likeliest %d answers" % keep if keep else "settles it here only if it is sure" if step.get("sure")
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
        if later:
            extra = '<span>%d first; %d only if those differ</span>' % (len(faces) - later, later)
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
        ("This is the plain flow; a pass can change it." if not b.get("flow") else "A pass changed it from the plain flow, and can change it again.")
        + ((" Two slots draft first, and the others only where those two differ." if plan0.get("draftFirst") == 2 else " %d slots draft first, and the others only where those differ." % plan0["draftFirst"]) if isinstance(plan0.get("draftFirst"), int) and plan0.get("draftFirst") >= 2 else "")
        + (" Where the drafts agree, the checks and the decision are passed over; where they differ, the answer most slots hold stands." if most0 else ""))
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
PIP = {"at parity": "at", "reached": "re", "not reached": "nr", "not compared": "nc", "reopened": "ro", "set aside": "sa", "mark wrong": "mw", "mark unstable": "mu", "no standard": "ns"}
# what each state is called on a pip's tooltip and in the key, one look for each
PIP_WORDS = {"at": "good as it stood", "re": "made good by a change", "nr": "not good yet", "ro": "back in hand after a swap",
             "sa": "set aside until the others are done", "mw": "set aside: the larger model's answer is wrong",
             "mu": "set aside: the larger model did not give this answer again", "ns": "left out: the larger model's own answers do not agree", "nc": "not graded: nothing usable from the larger model, or no reader believed for its kind",
             "cur": "in hand", "pe": "not asked yet"}


def track_of(lp):
    """Each finished question of the loop's record, in order, for the pips: [{id, kind, s (pip class), tried}]."""
    # (a question brought to parity before its mark was found wrong: the wrong mark's look, and its tooltip says it reached parity first)
    late = lambda q: bool(q.get("markWrong")) and q.get("state") in ("at parity", "reached")  # noqa: E731
    return [{"id": q.get("id", ""), "kind": q.get("kind", "") + (" · unstable mark" if q.get("unstable") else ""), "s": "mw" if late(q) else PIP.get(q.get("state"), "nc"),
             "w": (PIP_WORDS["mw"] + " (it was %s before that was found)" % PIP_WORDS[PIP[q["state"]]]) if late(q)
             else ("not graded: " + q["why"]) if q.get("state") == "not compared" and q.get("why") else PIP_WORDS.get(PIP.get(q.get("state"), "nc"), ""),
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


CLASS_NAMES = {"tools": "With tools", "talk": "A conversation", "code": "Asking for code", "words": "A plain question"}


def families_block(lp):
    """THE MODULE BESIDE ITS TARGET, FAMILY BY FAMILY (training/loop.mjs familiesOf; docs/swoa-parity.md): for each kind of question, how
    many the module has right of those asked so far, and, where the questions carry a standard of their own, how many the larger
    model's own answers have right by that same standard. Where they do not, the larger model's answers are the standard."""
    fams = [f for f in (lp or {}).get("families") or [] if f.get("asked")]
    if not fams:
        return ""
    row = lambda f: "<tr><td>%s</td><td>%d of %d</td><td>%s</td><td class='muted'>%s</td></tr>" % (  # noqa: E731
        e(KIND_WORDS.get(f.get("kind"), f.get("kind"))), f.get("module") or 0, f.get("asked") or 0,
        ("%d of %d" % (f.get("target") or 0, f.get("targetKnown") or 0)) if f.get("own") else "its answers are the standard",
        "the question's own" if f.get("own") else "the larger model's answers")
    own = [f for f in fams if f.get("own")]
    total = ("<p class='muted small' style='margin:6px 0 0'>Where the question carries its own standard: the module <b>%d</b> of %d, the larger model <b>%d</b> of %d.</p>"
             % (sum(f.get("module") or 0 for f in own), sum(f.get("asked") or 0 for f in own), sum(f.get("target") or 0 for f in own), sum(f.get("targetKnown") or 0 for f in own))) if own else ""
    return ("<details class='fams' id='fams'><summary>The module beside the larger model, by family (%d)</summary>"
            "<table class='spec'><tr><th>Family</th><th>The module</th><th>The larger model</th><th>Graded against</th></tr>%s</table>%s</details>"
            % (len(fams), "".join(row(f) for f in fams), total))


def question_track(d):
    """THE SWARM AGAINST EACH QUESTION (training/loop.mjs): the question in hand and which iteration of it, and a pip for every
    question of the pass so far. Painted again from /api/live while a session runs."""
    lp = d.get("loop")
    tr = track_of(lp)
    of = (lp or {}).get("of") or 0
    n = lambda st: sum(1 for x in tr if x["s"] == st)  # noqa: E731
    begun = bool(lp) or session_live()
    # (a question set aside until the others are done, or back in hand after a swap, has a pip and is not finished)
    fin = sum(1 for x in tr if x["s"] not in ("ro", "sa"))
    now = ("Pass %s stopped with %d of %d questions finished%s." % (e(str(lp.get("pass", ""))), fin, of, (" and %d to come back to" % (len(tr) - fin)) if len(tr) > fin else "")) if tr and fin < of else ("Pass %s: every question finished." % e(str(lp.get("pass", ""))) if tr
           else "")
    pips = "".join('<i class="%s" title="%s · %s · %s%s"></i>' % (x["s"], e(x["id"]), e(x["w"]), e(x["kind"]), (" · %d change%s tried" % (x["tried"], "" if x["tried"] == 1 else "s")) if x["tried"] else "") for x in tr)
    # EVERY QUESTION OF THE PASS HAS A PIP, the ones not asked yet among them: a row that only grew as questions finished did
    # not show how much of the pass was still to come (the script paints the same, with the one in hand)
    pips += '<i class="pe" title="not asked yet"></i>' * max(0, of - len(tr))
    # (a session that has not reached this stage yet has no question to count: it waits, and says so, where it read "0 of 0 finished")
    head = ("<span>not begun</span>" if not begun else "<span>waiting for the steps of the pass before it</span>" if not tr and not of
            else "<span>%d of %d finished</span><span>%d good as it stood</span><span>%d made good by a change</span><span>%d not good yet</span>" % (fin if tr else 0, of, n("at"), n("re"), n("nr")))
    # (the table of each class trained as a class stood above this: taken out, console 2026-11-21. How far the pass has come,
    # that stage included, is a share at the head of the card: pass_progress)
    return ('<div class="qtrack" id="qtrack"><div class="qhead" id="qhead"><b>%s</b>%s</div>'
            '<p class="qnow" id="qnow">%s</p><div class="pips" id="pips">%s</div>'
            # (one line for every look a pip can have, each look drawn by the pip's own class: the key cannot drift from the pips)
            '<div class="qkey">%s</div>%s%s</div>'
            % ("Question by question", head, now, pips,
               "".join('<span><i class="pk %s"></i>%s</span>' % (k, e(w)) for k, w in PIP_WORDS.items()), families_block(lp), tries_list(lp)))


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
    # THE TRAIN CARD IS ITS HEAD, THE ADAPTERS AND THE SLOTS. It also carried a title with chips (the briefs' version, slots
    # and models, kept changes, which classes have an arrangement of their own), a line of what is happening now, and the
    # question track with its key of eleven marks. Each is said elsewhere on the page (the configuration, the SwOA spec's
    # count of kept changes, Training now, the plan being carried out), so they were taken out (console 2026-11-24).
    # (the training share, the line beside it, Train and Clear training state head the card: #score, drawn again in place)
    # (and its head, the share of answers good with the pass's bar and the Questions button, was taken out too: how far a run
    # has come is said on the run's own card, as a ring, and the questions are opened from the configuration)
    one = '<div class="panel arr">%s%s</div>' % (adapters_line(d), faces_block(d))
    # THE PLAN AND THE PICTURE FOLD, AND START FOLDED (console 2026-11-24): each is long and is looked at on purpose, so the page
    # opens on what a person acts on. Open or shut is kept on the device (data-keep), and what is inside is still drawn again
    # in place while it is shut, so opening one shows it as it stands.
    fold = lambda key, hid, title, inner_id, inner: ('<details class="fold secfold" data-keep="%s"><summary><h2 id="%s">%s</h2></summary><div id="%s">%s</div></details>'  # noqa: E731
                                                       % (key, hid, title, inner_id, inner))
    return one + fold("sec-plan", "strategy", "The plan being carried out", "plan", plan_block(d)) + fold("sec-system", "system", "Visualizing the System", "viz", viz_block(d))


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


def _ours(pid, marker):
    """IS THE PROCESS WITH THIS ID STILL THE ONE THIS PAGE STARTED? An id is given again once its process has ended, so "something
    with that id is alive" is not "our run is alive": on 2026-11-19 an evaluation that had ended the night before read as
    running, its card drawn as in progress over the finished results with a Stop button, because its id had gone to a
    program of the system's (and Stop would have signalled that program). The process is ours where its command line still
    names what was started (marker: the script). Where the command line cannot be read, it is not taken as ours."""
    try:
        cmd = subprocess.run(["ps", "-o", "command=", "-p", str(int(pid))], capture_output=True, text=True, timeout=5).stdout
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    # (a kind of run that is one of several programs: pretraining is adapters.mjs, or roles.mjs where the whole run starts it)
    return any(m in cmd for m in ((marker,) if isinstance(marker, str) else marker))


# what each kind of run this page starts is started as (start_run, start_job): looked for in the command line of its process
RUN_MARKS = {"train": "training/session.sh", "eval": "training/evaluate.sh", "pretrain": ("training/adapters.mjs", "training/mixture.mjs"), "whole": "training/run.sh", "converse": "training/converse.sh"}


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
        st["running"] = _ours(st["pid"], RUN_MARKS["train"])
    except (OSError, KeyError):
        st["running"] = False
    return st


def node_for_training():
    """A Node of 20 or later: the one named (NODE), the one on the PATH, or the newest nvm has. '' when there is none."""
    return _per_request("node", _node_for_training_now)


def _node_for_training_now():
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


TRAIN_CLASSES = ("tools", "talk", "code", "words")
# (drawn as the buttons of the row above it are, with an eye where they have a pencil: these are read, those are written)
TQ_BUTTON = ('<button class="ownb" id="tq-open" type="button" title="Read the questions training asks, and see whether any is a benchmark&#39;s">Questions'
             '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.8 10s3-5.4 8.2-5.4S18.2 10 18.2 10s-3 5.4-8.2 5.4S1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/></svg></button>')


TRAIN_BELOW = "<!--below-->"  # (what follows it in run_controls goes under the card's head, across the card)


def classes_asked(asked):
    """The classes of input a press of Train names, those of them that are classes, in their order: [] where it names none, or
    every one (which trains every class, and is not said to the session)."""
    got = [c for c in TRAIN_CLASSES if c in (asked or [])]
    return got if 0 < len(got) < len(TRAIN_CLASSES) else []


def train_questions(d, split="train", cls="", kind="", find=""):
    """THE QUESTIONS TRAINING ASKS, TO READ AND AUDIT (the Train card: Questions). Every train and held question as it is put,
    with the conversation before it where there is one, its kind, the class of input the swarm takes it for and what it is
    marked by; narrowed by split, class, kind and words to find. Above them, whether any is a benchmark's: each question and
    each worked example it shows, set beside every benchmark question kept on this machine (ui/questions.py audit)."""
    import questions as Q
    qs, why = Q.load(ARGS.root, node_for_training())
    head = ('<div class="spec-head"><div><div class="kicker">Train</div><h3 style="font-size:22px;margin-top:4px">The questions training asks</h3></div>'
            '<button class="btn stop top" id="tq-close" type="button">Close</button></div>')
    if not qs:
        return head + '<p class="muted">%s</p>' % e(why or "No question could be read.")
    split = split if split in ("train", "held") else "train"
    mine = [q for q in qs if q["split"] == split]
    kinds = sorted({q["kind"] for q in mine if not cls or q["class"] == cls})
    shown = [q for q in mine if (not cls or q["class"] == cls) and (not kind or q["kind"] == kind)]
    words = [w for w in str(find or "").lower().split() if w][:6]
    if words:
        shown = [q for q in shown if all(w in (q["ask"] + " " + q["id"] + " " + " ".join(b["content"] for b in q["before"])).lower() for w in words)]
    a = Q.audit(ARGS.root, qs)
    if not a["benchmark"]:
        verdict = "No benchmark question is kept on this machine yet, so there is nothing to set these beside: evaluate first."
    else:
        c = a["closest"]
        verdict = ("%s of the %d questions, or of the worked examples they show, is the same as one of the %d benchmark questions and examples kept on this machine (%d tasks; only what was asked here)."
                   % ("None" if not a["same"] else "%d" % len(a["same"]), len(qs), a["benchmark"], a["tasks"]))
        if a["same"]:
            verdict += " The same: %s." % e(", ".join(a["same"][:8]))
        if c:
            verdict += (" The closest pair shares %s%% of its runs of five words: <code>%s</code> and a question of %s. Several kinds are made in the form of a benchmark&#39;s task (an order from clues, a chain of who lies, a date some days away), "
                        "each with its own names and numbers: the form is shared, no question is." % (fmt_pct(100 * c["share"]), e(c["id"]), e(c["task"])))
    seg = lambda attr, val, label, sel: '<button type="button" class="seg%s" data-tq-%s="%s" aria-pressed="%s">%s</button>' % (" on" if sel else "", attr, e(val), "true" if sel else "false", e(label))  # noqa: E731
    n_of = lambda sp: sum(1 for q in qs if q["split"] == sp)  # noqa: E731
    ctl = ('<div class="tqctl" data-split="%s" data-cls="%s" data-kind="%s"><div class="tgl" role="group" aria-label="Which questions">%s%s</div>'
           '<div class="tgl" role="group" aria-label="Which class of input">%s%s</div>'
           '<select id="tq-kind" aria-label="Which kind"><option value="">Every kind (%d)</option>%s</select>'
           '<input id="tq-find" type="search" placeholder="Words to find" value="%s" aria-label="Words to find"></div>'
           % (e(split), e(cls), e(kind), seg("split", "train", "Train (%d)" % n_of("train"), split == "train"), seg("split", "held", "Held (%d)" % n_of("held"), split == "held"),
              seg("cls", "", "Every class", not cls), "".join(seg("cls", c_, CLASS_NAMES.get(c_, c_), cls == c_) for c_ in TRAIN_CLASSES if any(q["class"] == c_ for q in mine)),
              len(kinds), "".join('<option value="%s"%s>%s (%d)</option>' % (e(k), " selected" if k == kind else "", e(k), sum(1 for q in mine if q["kind"] == k and (not cls or q["class"] == cls))) for k in kinds), e(find or "")))
    most = 60
    items = []
    for q in shown[:most]:
        before = "".join('<p class="tqb"><b>%s</b> %s</p>' % ("They" if b["role"] == "user" else "Reply" if b["role"] == "assistant" else e(b["role"].capitalize()), e(b["content"])) for b in q["before"])
        meta = " · ".join(x for x in [e(q["kind"]), e(CLASS_NAMES.get(q["class"], q["class"])), "with worked examples" if q["shape"] == "shown" else "",
                                      "marked by a program" if q["standard"] == "own" else "marked against %s&#39;s own answers" % e((d.get("target") or {}).get("name", "the larger model")),
                                      ("tools: " + e(", ".join(q["tools"]))) if q["tools"] else ""] if x)
        items.append('<li><div class="tqh"><code>%s</code><small>%s</small></div><p class="tqa">%s</p>%s%s</li>'
                     % (e(q["id"]), meta, e(q["ask"]),
                        ('<details class="told"><summary>The conversation before it (%d turn%s)</summary><div>%s</div></details>' % (len(q["before"]), "" if len(q["before"]) == 1 else "s", before)) if before else "",
                        ('<small class="tqw">Wanted: %s</small>' % e(q["want"])) if q["want"] else ""))
    more = ('<p class="muted small">%d more: narrow by class, kind or words to see them.</p>' % (len(shown) - most)) if len(shown) > most else ""
    return (head + '<p class="small muted" style="margin:8px 0 0">Made by the trainers for this configuration (training/tasks.mjs), with any a person wrote beside them. Train questions are the ones training works on; held questions are never trained on and measure it.</p>'
            + '<div class="state %s" style="margin-top:10px"><i></i><span>%s</span></div>' % ("warn" if a["same"] else "on" if a["benchmark"] else "", verdict)
            + ctl + '<p class="small muted" style="margin:10px 0 6px">%d question%s shown.</p><ol class="tql">%s</ol>%s' % (len(shown), "" if len(shown) == 1 else "s", "".join(items) or '<li class="muted">None.</li>', more))


def start_run(passes=0, classes=None):
    """Training is continuous: question by question, pass after pass, until Stop training is pressed (passes=0). How many questions a
    pass asks is the trainer's policy (training/policy.json: questions.each), which the session reads; it is not chosen here.
    classes: the classes of input to train, where a person ticked fewer than all (the Train card's boxes): the session trains
    those only, as a class and question by question (TRAIN_CLASSES)."""
    st = run_state()
    if st and st["running"]:
        return
    why = cannot_run() or busy_with() or needs_eval()
    if why:
        return
    root = Path(ARGS.root)
    first = int(data.load(root)["state"].get("pass", 0)) + 1
    (root / ".work" / "train").mkdir(parents=True, exist_ok=True)
    log = open(root / ".work" / "train" / "ui-run.log", "ab")
    env = dict(os.environ, PASSES=str(passes), NODE=node_for_training())
    env.pop("TEACHER", None)  # a teacher spends on a Claude plan: never started from a button
    only = classes_asked(classes)
    env.pop("TRAIN_CLASSES", None)
    if only:
        env["TRAIN_CLASSES"] = ",".join(only)
    p = subprocess.Popen(["bash", "training/session.sh"], cwd=str(root), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    _run_file().write_text(json.dumps({"pid": p.pid, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "passes": passes, "first": first, "classes": only}))


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
    return _starts(_run_controls(), ("run-go", "run-stop"))


def _run_controls():
    """TRAIN, beside the Training progress card's headline, as Evaluate and Pretrain have theirs: Train and Clear training state when
    nothing runs; Stop training while a session does."""
    st = run_state()
    if st and st["running"]:
        # (a session that trains some classes only says which, beside Stop)
        only = st.get("classes") or []
        return ('<button class="btn stop top" id="run-stop" type="button">Stop training</button>' + TQ_BUTTON + TRAIN_BELOW
                + (('<small class="evwhy" id="run-only">Training %s only, as chosen.</small>' % e(_and([CLASS_NAMES.get(c, c) for c in only]).lower())) if only else ""))
    held = busy_with()
    first = needs_eval()
    why = cannot_run() or held or first
    # (and what an evaluation of part of the work leaves with no figure from before: said, not waited for)
    first = first or eval_gaps()
    # THE CARD'S HEAD HOLDS THE TWO ACTIONS, Train and Questions, as Evaluate and Pretrain hold theirs. Under the head, across the
    # card (after TRAIN_BELOW, which progress_strip splits at): why Train waits, in a line; then which classes this session
    # trains, with Clear training state, the lesser action, small at the end of that row. They were all in the head's narrow
    # column, where the boxes broke over three ragged rows and the reason stood as loud as the buttons.
    # (which classes of input are trained, and Clear training state, are on the intelligence run's card: train_options. Train
    # here sends the same choice)
    return ('<button class="btn top" id="run-go" type="button"%s title="Train question by question, pass after pass, until Stop training is pressed">Train</button>' % (' disabled data-held="1"' if why else "")
            + TQ_BUTTON + TRAIN_BELOW
            # (one reason at a time: while something else has the models, the line under the card says so, and that is why Train waits)
            + (('<small class="evwhy" id="run-first">%s</small>' % e(first)) if first and not held else ""))


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
    cls = "warn" if busy[0].get("state") == "failed" else "on"
    return '<div class="state %s" data-ready="1"><i></i><span>%s</span></div>' % (cls, e(_ready_words(steps)))


def _ready_words(steps):
    """What is being made ready, in a sentence: how many pieces are ready, which one is being worked on, what is being done to it
    (fetching, checking, installing) and how much of it has arrived. The engine and its programs are pieces as the models are."""
    busy = [x for x in steps if x.get("state") != "ready"]
    if not busy:
        return ""
    x = busy[0]
    of = x.get("of") or 0
    got = (" · %.1f of %.1f GB" % (x.get("done", 0) / 2**30, of / 2**30)) if of and x.get("done") is not None else ""
    doing = {"fetching": "fetching ", "checking": "checking ", "installing": "installing ", "failed": "failed: ", "missing": "missing: "}.get(x.get("state"), "")
    note = (" (%s)" % x["note"]) if x.get("note") and not x.get("why") else ""
    return "Making ready: %d of %d pieces ready · %s%s%s%s" % (len(steps) - len(busy), len(steps), doing, x.get("what", ""), (": " + x["why"]) if x.get("why") else got, note)


def now_ready():
    """WHAT IS BEING FETCHED OR INSTALLED THIS MOMENT, whatever started it (a run, an evaluation, a session, serving the module, a
    terminal): the sentence of _ready_words while training/setup.mjs is alive and has a piece that is not ready; else ''. The
    page says it at its foot, so that a press which first has an engine or a model to fetch is not a press that seems to do
    nothing (console 2026-11-24)."""
    try:
        su = json.loads((Path(ARGS.root) / ".work" / "train" / "setup.json").read_text())
    except (OSError, ValueError):
        return ""
    if time.time() * 1000 - su.get("at", 0) > 1800000:
        return ""
    try:
        alive = subprocess.run(["pgrep", "-f", "training/setup.mjs"], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        alive = ""
    return _ready_words(su.get("steps", [])) if alive else ""


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
        # (a swarm with no decision model, the decider `none`: there is nothing whose state to say)
        try:
            no_dec = ((data.load(ARGS.root).get("decider") or {}).get("serve") or {}).get("kind") == "none"
        except Exception:  # noqa: BLE001
            no_dec = False
        # (how long it has run, and where there is a decision model, its state now. The words after it that never changed,
        # "question by question, until stopped" and how a swarm with no decision model settles an answer, are taken out:
        # console 2026-11-21, no static text here)
        out.append('<div class="state on running" data-running="1"><i></i><span data-since="%d"><b>Running %s</b><small>since %s</small></span>%s</div>'
                   % (int(began * 1000), e(_span(time.time() - began)), e(time.strftime("%H:%M %Z", time.localtime(began))),
                      "" if no_dec else '<span class="runx">%s <b>%s</b></span>' % (e(dname), e(decider_state(True)))))
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
    gate = gate_stopped()
    if gate:
        out.append(note("warn", gate))
    if st and st.get("stopped"):
        out.append(note("", "Stopped at %s" % e(st["stopped"][:5])))
    return "".join(out)


def gate_stopped(d=None):
    """WHY THE LAST PASS ENDED BEFORE IT TRAINED ANYTHING, where it did (training/loop.mjs, the coverage gate: a kind of question
    with nothing to grade its answers by stops the pass), in words, with what to change: the session wrote this to its log, and the
    page showed only that the run had ended (2026-11-19: a decider chosen that fails the reader's check, and Train pressed twice).
    '' where the last pass did not stop there, or where the judge has been changed since (the reader on record is another's)."""
    try:
        d = d or data.load(ARGS.root)
        work = Path(ARGS.root) / ".work" / "train" / d["key"]
        passes = sorted((p for p in work.glob("pass-*") if (p / "status.txt").exists()), key=lambda p: int(p.name.split("-")[1]))
        if not passes:
            return ""
        last = [x for x in (passes[-1] / "status.txt").read_text().splitlines() if x.strip()]
        if not last or "STOPPED: a kind of question has nothing to compare" not in last[-1]:
            return ""
        said = [x for x in (passes[-1] / "10-questions.out").read_text().splitlines() if x.startswith("NOT TRAINED: ")]
        kinds = re.findall(r"([\w-]+) \((\d+) questions: ([^)]*)\)", said[-1]) if said else []
    except (OSError, ValueError, KeyError, IndexError):
        return ""
    if not kinds:
        return ""
    reader = data._json(work / "reader.json", {})
    now_id = ((d.get("judge") or d.get("decider") or {}).get("id")) or ""
    if reader.get("by") and now_id and reader["by"] != now_id:
        return ""
    who = next((m.get("name") for m in (d.get("registry") or {}).get("deciders", []) if m.get("id") == reader.get("by")), "") or reader.get("by") or (d.get("judge") or d.get("decider") or {}).get("name") or "The reader"
    score = ""
    if reader.get("asked") and reader.get("ok") is False:
        need = -(-int(reader["asked"]) * float(reader.get("need") or 0.8) // 1)
        score = " <b>%s</b> judges whether two answers say the same, and read %d of the %d test pairs correctly where %d are needed." % (e(who), reader.get("right") or 0, reader["asked"], need)
    return ("The last pass stopped before it trained anything: <b>%d</b> kind%s of question (%s) had nothing to grade the answers by.%s "
            "Choose a judge that passes its check under <b>Judges equivalence</b>, in the configuration, then press Train."
            % (len(kinds), "" if len(kinds) == 1 else "s", e(", ".join(k[0] for k in kinds)), score))


STEP_WORDS = [("target-third-train", "Larger model, a third answer: the train questions"), ("target-third", "Larger model, a third answer: the held questions"),
              ("target-self-train", "Larger model against itself: the train questions"), ("reader", "Check the reader of answers in words"), ("swarm-reworded", "The swarm: the held questions, a second way"), ("begin", "Begin the pass"), ("research", "Read what is new on arXiv"), ("target-train", "Larger model: the train questions"), ("target-self", "Larger model against itself"), ("target", "Larger model: the held questions"),
              ("swarm-held", "The swarm: the held questions"), ("plan", "Plan what to try"), ("write-briefs", "New briefs from the larger model"),
              ("members", "Could another small model draft it?"), ("deciders", "Would another decider choose better?"),
              ("classes", "Each class of input, trained as a class"), ("questions", "Train, question by question"), ("end", "Verdict"), ("publish", "Write it up")]


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


def tensorfold_here():
    """Is TensorFold on this machine? Where it installs itself, or on the PATH (src/members.mjs tensorfoldProgram, the same)."""
    named = os.environ.get("SWARM_TENSORFOLD")
    if named is not None:
        return bool(named) and Path(named).is_file()
    return (Path.home() / ".tensorfold" / "bin" / "tensorfold").is_file() or bool(shutil.which("tensorfold"))


def pills(d):
    """Four choices and one document: the two small models, the model that decides, the larger model, and the SwOA spec."""
    reg, running = d["registry"], bool((run_state() or {}).get("running"))
    # (a model in parts weighs all of its parts)
    weigh = lambda m: (" · %.1f GB" % ((m["bytes"] + sum(p.get("bytes") or 0 for p in m.get("parts") or [])) / 2**30)) if m.get("bytes") else (" · about %s GB" % m["memGb"]) if m.get("memGb") else ""  # noqa: E731

    # WHAT SERVES A MODEL HERE, said beside it in the list and on the pill: a small model is a GGUF file served by llama.cpp, a
    # larger model names its own engine (src/models.json engine). A small model another engine serves has an entry of its own
    ENGINES = {"llama": "llama.cpp", "tensorfold": "TensorFold"}
    eng = lambda m: ENGINES.get(m.get("engine") or "", m.get("engine") or "")  # noqa: E731
    # (every model is named alike, by its name alone, and what serves it is said after its size: a model two engines serve is
    # two entries of one name, told apart there. "MLX" in a name read as "adapted with MLX", which is what Pretrain does, and
    # naming the engine in the name left those two unlike every other, console 2026-11-21. A name that does say its engine
    # is not said twice)
    runs = lambda m, key: (" · " + eng(m)) if key not in ("decider", "judge") and eng(m) and eng(m) not in str(m.get("name", "")) else ""  # noqa: E731

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
                # (a small model TensorFold serves can be chosen on an Apple silicon Mac: where TensorFold is not there yet, making
                # the models ready installs it (training/setup.mjs), and the list says so. On any other machine it cannot run)
                tf_first = False
                # A SMALL MODEL OF AN ARCHITECTURE NO LLAMA.CPP BUILD HERE KNOWS (Inkling 2's looped transformer) CAN STILL BE
                # CHOSEN where a build that knows it is pinned for this machine: making the models ready fetches it, and the
                # list says so (console 2026-11-24: choosing a model brings what it depends on). Only where none is pinned
                # is it listed and not to be chosen.
                arch_first = False
                # A SMALL MODEL SERVED BY ANOTHER BUILD OF THE ENGINE (Atomic Engine): offered where that build can be made
                # on this machine, and the list says what choosing it brings (built from source when its models are made ready)
                prog_note = ""
                pg = data.program_of(m, reg, d.get("root", ARGS.root)) if key in ("a", "b", "c", "d", "one") else None
                if pg:
                    here = pg["can"]
                    prog_note = "" if pg["here"] or not pg["can"] else " · %s%s is built from source when the models are made ready" % (pg["name"], " (a developer preview)" if pg["preview"] else "")
                if key in ("a", "b", "c", "d", "one") and m.get("architecture") and not data.engine_knows(m["architecture"], d.get("root", ARGS.root)):
                    here = data.engine_fetchable(m["architecture"], reg)
                    arch_first = here
                if key in ("a", "b", "c", "d", "one") and m.get("engine") == "tensorfold" and not tensorfold_here():
                    here = "mac" in d.get("machine", [])
                    tf_first = here
                opts += '<option value="%s"%s%s>%s%s%s%s</option>' % (
                    e(m["id"]), " selected" if mine else "", "" if here or mine else " disabled", e(m["name"]), "" if mine else score, "" if mine else weigh(m) + e(runs(m, key)) + (" · installed when training starts" if tf_first else "") + (" · its engine build is fetched when the models are made ready" if arch_first else "") + prog_note,
                    "" if here else " · needs %s" % e(m.get("needs", "another machine")))
            opts += "</optgroup>"
        if group == "judge":
            # the decider itself, where no judge apart from it is chosen (the swarm's own decider then grades the answers it chose)
            opts = '<option value=""%s>The decider itself</option>' % ("" if chosen else " selected") + opts
        if group == "optional":
            # a place that can be left empty: "none" takes the model out of the swarm (or, on an empty place, is what it shows)
            opts = '<option value=""%s>%s</option>' % ("" if chosen else " selected", "Remove it from the swarm" if chosen else "Add a model") + opts
        return '<label class="pick %s%s" title="%s"><small>%s%s</small><select data-pick="%s"%s aria-label="%s">%s</select></label>' % (
            key, " add" if group == "optional" and not chosen else "", e("%s: %s%s%s" % (label, chosen["name"], weigh(chosen), (", served by " + eng(chosen)) if runs(chosen, key) else "") if chosen else label + ": none. Choose one to add a small model to the swarm"), e(label), '<i>%s</i>' % e((weigh(chosen) + runs(chosen, key)).replace(" · ", "", 1)) if chosen and weigh(chosen) else "", key, " disabled" if running else "", e(label), opts)

    # a third and a fourth small model: each place that is filled, and the next one, empty, to add to
    more = ""
    for i, k in enumerate(("c", "d")):
        if k in d["members"]:
            more += pill(k, "Small model %d" % (i + 3), reg["small"], d["members"][k], "optional")
        else:
            more += pill(k, "Small model %d" % (i + 3), reg["small"], None, "optional")
            break
    n_small = 2 + more.count('class="pick ')
    one = one_model(d)
    # ONE MODEL OR SEVERAL, above the pills. One model: a single pill, the model that fills every role. Several: a pill for each
    # place, marked as the experiment it is, with what was measured of it (never more than was measured)
    seg = lambda val, label, sel: '<button type="button" class="seg%s" data-mix="%s" aria-pressed="%s">%s</button>' % (" on" if sel else "", val, "true" if sel else "false", label)  # noqa: E731
    made = ('<div class="madeof" id="madeof"><span class="cfgl">The swarm is made of</span><div class="tgl" role="group" aria-label="What the swarm is made of">%s%s</div>%s</div>'
            % (seg("0", "One model", one), seg("1", "Several models <i>experimental</i>", not one),
               # (One model says nothing under the choice: the pill says "in every role", and the rest was implied; console 2026-11-24)
               "" if one
               else "<small>Experimental. Measured on this project&#39;s own questions: a mix of two small models scored 173 of 216 where the better of the two in every role scored 192, and a mix of three scored 91 of 108 where its best scored 97.</small>"))
    if one:
        return (
            '<div class="picks" id="picks">%s<div class="group small n1" style="flex-basis:185px">%s</div><div class="group against" style="flex-basis:740px">%s%s%s</div></div>'
            % (made, pill("one", "Small model, in every role", reg["small"], d["members"]["a"]),
               pill("decider", "Decides", sorted(reg["deciders"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d["decider"]),
               pill("judge", "Judges equivalence", sorted([m for m in reg["deciders"] if m["id"] != (d.get("decider") or {}).get("id") and (m.get("serve") or {}).get("kind") != "none"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d.get("judge"), "judge"),
               pill("target", "Larger model", sorted(reg["targets"], key=lambda t: -t.get("params", 0)), d["target"])))
    return (
        '<div class="picks" id="picks">' + made + '<div class="group small n%d" style="flex-basis:%dpx">%s%s%s</div><div class="group against" style="flex-basis:740px">%s%s%s</div></div>'
        # (each group asks for the room its pills need, so the two share a row exactly when both fit)
        % (n_small, 195 * n_small - 10, pill("a", "Small model 1", reg["small"], d["members"]["a"]), pill("b", "Small model 2", reg["small"], d["members"]["b"]), more,
           pill("decider", "Decides", sorted(reg["deciders"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d["decider"]),
           pill("judge", "Judges equivalence", sorted([m for m in reg["deciders"] if m["id"] != (d.get("decider") or {}).get("id") and (m.get("serve") or {}).get("kind") != "none"], key=lambda m: -(m.get("index") or {}).get("score", 0)), d.get("judge"), "judge"),
           pill("target", "Larger model", sorted(reg["targets"], key=lambda t: -t.get("params", 0)), d["target"]))
    )


def one_model(d):
    """Whether the swarm is made of ONE MODEL: every place holds the same small model, and Several models was not chosen
    ("mix" in src/config.json, which the choice above the pills writes)."""
    ids = [m.get("id") for m in (d.get("members") or {}).values() if m]
    # (d["mix"], where what is drawn says it; else the file)
    mix = d["mix"] if "mix" in d else (data._json(Path(d.get("root", ARGS.root)) / "src" / "config.json", {}) or {}).get("mix")
    return len(ids) >= 2 and len(set(ids)) == 1 and not mix


def cfg_meta(d):
    """The configuration in a line: the small models, the decider, the larger model, and who takes turns with tools."""
    mem = " + ".join(m["name"] for m in d["members"].values() if m)
    return "%s · %s decides%s · against %s · tools: %s" % (mem, (d.get("decider") or {}).get("name", "?"), (" · %s judges" % d["judge"]["name"]) if d.get("judge") else "", (d.get("target") or {}).get("name", "?"),
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


# ---- THE ENGINES THAT SERVE THE MODELS, AND WHETHER A NEWER ONE IS OUT ----
# The larger model is whatever its engine makes of it, and an engine's release mends wrong and empty replies (2026-11-20: the
# one here was five releases behind after nine days, three of them saying so). So the page says when the engine installed here
# is behind: among the recommendations, as something a person does, with the command its maker documents. The page installs
# nothing itself. What the newest is, is asked of the place the catalog names for the engine (serve.releases, the one request
# the page makes beyond this machine: the address alone, nothing of this machine in it), once a day, by the page as it runs
# and never by a check; llama.cpp's is the build the catalog pins, which needs no asking.
ENGINE_LOOKUP = False  # (main() turns it on: nothing is asked of the network where the page is only being checked)
ENGINES_SEEN = False  # (nor is this machine's own engine looked at then: a check is the same on any machine)
_ENGINE_SAID = {}


def version_in(said):
    """What an engine says of itself -> (its version as written, a tuple to compare by): 'tensorfold-native 1.2.7' ->
    ('1.2.7', (1, 2, 7)); 'version: 0.9.0 (build 12110, ...)' and 'b12359' -> the build, ('b12110', (12110,)); else ('', ())."""
    t = str(said or "")
    b = re.search(r"build\s+(\d+)", t, re.I) or re.search(r"\bb(\d{4,})\b", t)
    if b:
        return "b" + b.group(1), (int(b.group(1)),)
    v = re.search(r"(\d+(?:\.\d+){1,3})", t)
    return (v.group(1), tuple(int(x) for x in v.group(1).split("."))) if v else ("", ())


def engine_said(program):
    """What `program --version` prints, asked at most once in ten minutes; '' where it cannot be asked."""
    now = time.time()
    was = _ENGINE_SAID.get(program)
    if was and now - was[0] < 600:
        return was[1]
    try:
        r = subprocess.run([program, "--version"], capture_output=True, text=True, timeout=10)
        said = (r.stdout or "") + (r.stderr or "")
    except (OSError, subprocess.SubprocessError):
        said = ""
    _ENGINE_SAID[program] = (now, said)
    return said


def program_of(serve):
    """Where an engine's program is on this machine: in a folder its catalog entry names, else on the PATH; '' where it is not."""
    for folder in (serve or {}).get("where") or []:
        f = Path(os.path.expanduser(folder)) / serve.get("program", "")
        if f.is_file():
            return str(f)
    return shutil.which((serve or {}).get("program") or "") or ""


def llama_here(root):
    """The llama-server the swarm uses here: the build a person updated to from the page (.work/engine/chosen, written only once
    every model answered with it: training/engine-update.mjs), else the one on the PATH. training/support/bench.mjs, the same."""
    try:
        chosen = (Path(root) / ".work" / "engine" / "chosen").read_text().strip()
        if chosen and Path(chosen).is_file():
            return chosen
    except OSError:
        pass
    return shutil.which("llama-server") or ""


ENGINE_IDS = ("tensorfold", "llama")


def engine_update_state(root, engine):
    """How an update started from the page stands: {phase: running | done | failed, step, ...} with `running` (its process is
    alive), or None where none was started. One that is not running and never said how it ended has failed."""
    try:
        st = json.loads((Path(root) / ".work" / "engine" / ("update-%s.json" % engine)).read_text())
    except (OSError, ValueError):
        return None
    try:
        try:
            if os.waitpid(st["pid"], os.WNOHANG)[0] == st["pid"]:
                raise OSError("ended")
        except ChildProcessError:
            pass
        os.kill(st["pid"], 0)
        st["running"] = st.get("phase") == "running"
    except (OSError, KeyError):
        st["running"] = False
    if not st["running"] and st.get("phase") == "running":
        st["phase"], st["step"] = "failed", "It ended before it finished: " + str(st.get("step", ""))
    return st


def engine_update_start(root, engine):
    """Start an engine's update; '' when it started, else why not. Nothing else may be running: an engine is not changed under
    a pass, an evaluation or pretraining."""
    if engine not in ENGINE_IDS:
        return "No engine of that name."
    held = busy_with()
    if held:
        return "Wait for %s to end, or stop it: an engine is not changed under a run." % held
    if any((engine_update_state(root, x) or {}).get("running") for x in ENGINE_IDS):
        return "An engine is being updated already."
    node = node_for_training()
    if not node:
        return "The update needs Node, and none is here."
    folder = Path(root) / ".work" / "engine"
    folder.mkdir(parents=True, exist_ok=True)
    log = open(folder / ("update-%s.log" % engine), "wb")
    p = subprocess.Popen([node, "training/engine-update.mjs", engine], cwd=str(root), stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    (folder / ("update-%s.json" % engine)).write_text(json.dumps({"id": engine, "pid": p.pid, "phase": "running", "step": "Starting", "at": time.time() * 1000}))
    _ENGINE_SAID.clear()
    return ""


def engine_newest(root, engine, url):
    """The newest release of an engine as the page last learned it ({tag, at} in .work/engines.json), or None. Where the page
    is running and that is older than a day, it is asked again in the background; this call never waits for it."""
    f = Path(root) / ".work" / "engines.json"
    known = data._json(f, {}) or {}
    row = known.get(engine)
    if ENGINE_LOOKUP and url and (not row or time.time() - row.get("at", 0) > 86400) and not _ENGINE_SAID.get("asking:" + engine):
        _ENGINE_SAID["asking:" + engine] = True

        def ask():
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "the-swarm-page", "Accept": "application/vnd.github+json"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    tag = str((json.loads(r.read().decode("utf-8", "replace")) or {}).get("tag_name") or "")
                if tag:
                    now = data._json(f, {}) or {}
                    now[engine] = {"tag": tag, "at": time.time()}
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(json.dumps(now))
            except Exception:  # noqa: BLE001 (no network, a limit, another answer: the page says nothing of a newer one)
                pass
            finally:
                _ENGINE_SAID.pop("asking:" + engine, None)

        import threading
        threading.Thread(target=ask, daemon=True).start()
    return row


def engine_recommendations(d):
    """An engine installed here that is behind -> a recommendation a person acts on outside the page (`yours`)."""
    out = []
    if not ENGINES_SEEN:
        return out
    reg = d.get("registry") or {}
    tgt = next((t for t in reg.get("targets", []) if t.get("id") == (d.get("target") or {}).get("id")), None) or {}
    serve = tgt.get("serve") or {}
    prog = program_of(serve) if serve.get("releases") else ""
    if prog:
        have, have_t = version_in(engine_said(prog))
        row = engine_newest(d["root"], tgt.get("engine") or serve.get("program"), serve.get("releases"))
        new, new_t = version_in((row or {}).get("tag"))
        if have_t and new_t and len(have_t) == len(new_t) and new_t > have_t:
            name = str(tgt.get("by") or "").split("served by ")[-1] or serve.get("program")
            out.append({"id": "engine:%s:%s" % (serve.get("program"), new), "strength": "info", "yours": True, "apply": None, "update": "tensorfold" if serve.get("program") == "tensorfold" else None,
                        "title": "Update %s, which serves %s, from %s to %s" % (name, tgt.get("name", "the larger model"), have, new),
                        "why": "A release can mend wrong or empty replies, and so change the larger model&#39;s scores. Update runs its maker&#39;s installer, <code>%s</code>%s. The next Evaluate then asks %s everything again."
                               % (e(serve.get("upgrade") or "its maker&#39;s installer"), (' (<a href="%s" target="_blank" rel="noopener">release notes</a>)' % e(serve["notes"])) if serve.get("notes") else "", e(tgt.get("name", "it"))),
                        "note": "here: %s" % prog})
    # llama.cpp, which serves the small models: behind the build the catalog pins (no asking: the pin is in src/models.json)
    eng = reg.get("engine") or {}
    ls = llama_here(d["root"])
    if ls and eng.get("tag"):
        have, have_t = version_in(engine_said(ls))
        pin, pin_t = version_in(eng.get("tag"))
        if have_t and pin_t and len(have_t) == len(pin_t) == 1 and pin_t > have_t:
            out.append({"id": "engine:llama:%s" % pin, "strength": "info", "yours": True, "apply": None, "update": "llama",
                        "title": "Update llama.cpp, which serves the small models, from build %s to %s" % (have[1:], pin[1:]),
                        "why": "This is the build the repository is checked with (the least it needs is %s). Update fetches it beside the one here, which it does not touch, loads each model of this swarm with it, and switches only if every one answers: a newer model can need support a build lacks. If one does not, the build here is kept. Afterwards a pass and an Evaluate are what tell."
                               % e(str(eng.get("minBuild", "?"))),
                        "note": "here: %s" % ls})
    return out


def swarm_unread(res):
    """The tasks of an evaluation where the benchmark could not read a quarter or more of THE SWARM's replies as answers (the
    table's own mark, on the swarm's side): [(name, unread, of)]. Their scores say how its replies were written more than
    what it knew."""
    out = []
    for r in (res or {}).get("results") or []:
        n = ((r.get("agree") or {}).get("of")) or 0
        u = ((r.get("unread") or {}).get("swarm")) or 0
        if n and u * 4 >= n:
            out.append((r.get("name") or r.get("task"), u, n))
    return out


def untrained(d):
    """Whether training has kept nothing for this configuration yet: no change in its record, and no pass ended."""
    lr = d.get("learned") or {}
    return not lr.get("ledger") and not lr.get("passes")


def evaluation_caution(d, res=None):
    """WHAT A PERSON SHOULD KNOW BEFORE READING AN EVALUATION OF THIS SWARM, in a line for the Evaluate card ('' where nothing):
    the benchmark found no answer in many of its replies on some tasks of its last evaluation, or it has not been trained. A
    benchmark that shows worked examples reads an answer only where a reply ends as they do, and stops at an empty line. Every
    swarm starts with replies ended so (plan.closeAs 'shown' in src/briefs.json, since 2026-11-20: on 40 questions of four such
    tasks, 7 right without it and 30 with), so what is left under this mark is how the models reason and write, which is
    training's to change."""
    if res is None:
        res, _ = eval_of_config(ARGS.root, d)
    un = swarm_unread(res)
    if un:
        return ("On %d task%s of the last evaluation the benchmark could not read many of the swarm&#39;s replies as answers (marked no answer found): those scores say how it wrote more than what it knew. %s"
                % (len(un), "" if len(un) == 1 else "s", "This swarm has not been trained: training is what changes how it answers. Train, then evaluate again." if untrained(d)
                   else "Training is what changes how it answers. If a pass has been made since, evaluate again."))
    if untrained(d):
        return "This swarm has not been trained. An evaluation now measures it as every swarm starts, before training has arranged it for these models. Train first for figures to rely on."
    return ""


def evaluation_recommendations(d):
    """The same, as recommendations (`next`: what to do before an evaluation is read; nothing they change is the configuration's)."""
    res, _ = eval_of_config(d["root"], d)
    un = swarm_unread(res)
    out = []
    if un:
        out.append({"id": "unread:%s" % str(res.get("at", "")), "strength": "info", "yours": True, "next": True, "train": True, "apply": None, "n": sum(n for _, _, n in un),
                    "title": "%d task%s of the last evaluation %s scored on form more than on answers" % (len(un), "" if len(un) == 1 else "s", "was" if len(un) == 1 else "were"),
                    "why": "The benchmark could not read these of the swarm&#39;s replies as answers: %s. A reply it cannot read is marked wrong whatever it says. The swarm ends a reply as a benchmark&#39;s examples do where they show how; what is left is how its models reason and write, which training changes. %s"
                           % ("; ".join("%s %d of %d" % (e(nm), u, n) for nm, u, n in un),
                              "This swarm has not been trained: train it, then evaluate again." if untrained(d) else "If a pass has been made since that evaluation, evaluate again; if not, train first."),
                    "note": "evaluated %s UTC" % _day(res.get("at"))})
    elif untrained(d):
        out.append({"id": "untrained", "strength": "info", "yours": True, "next": True, "train": True, "apply": None, "n": 0,
                    "title": "Train this swarm before relying on an evaluation of it",
                    "why": "Training has kept nothing for this configuration yet. An evaluation now measures the swarm as every swarm starts, before training has arranged it for these models: which of them drafts, who decides, and what each is told. Figures from before a pass are a starting point, not what this swarm can do.",
                    "note": "nothing is changed by this: it is what to do first"})
    return out


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
        if not dec or r.get("kind") == "model" or dec["id"] == cur_dec or r.get("recovered", 0) <= r.get("lost", 0):
            continue
        edge = r["recovered"] - r["lost"]
        out.append({"id": "decider:" + dec["id"], "strength": "measured", "apply": {"decider": dec["id"]}, "n": r.get("asked", 0),
                    "title": "Decide with %s" % dec["name"],
                    "why": "Put the %d choices recorded in pass %s, it chose the larger model&#39;s answer %d times against %s&#39;s %d: it recovered %d that %s missed and lost %d it had. %s"
                           % (r.get("asked", 0), e(str(rep.get("pass", "?"))), r.get("theirsRight", 0), e(rec_dec), r.get("nowRight", r.get("kevRight", 0)),
                              r["recovered"], e(rec_dec), r["lost"],
                              "A small edge: a real pass is what would tell." if edge < 3 else "A clear edge on the recorded choices.") + elsewhere(rep_from),
                    "note": " · ".join(x for x in [dec.get("license", ""), "its weights are here" if any((Path(d["root"]) / ".work" / "deciders" / dec["id"] / f).exists() for f in ("model/.complete", ".complete")) or (dec.get("serve") or {}).get("kind") == "kev" else "Train fetches it"] if x)})
    # ONE OF THE SWARM'S OWN SMALL MODELS AS THE DECIDER (decider-replay.mjs --members): put the same recorded choices. One that
    # chooses at least as well as the decision model, on ten choices or more, means the swarm may not need a decision model at
    # all, which is a large part of its memory. It is training's to try (a model decides in place of the decider, kept by the
    # same rule as any change), so this says what was measured and has no button; the best of them only
    models_ = [r for r in (rep or {}).get("results") or [] if r.get("kind") == "model" and r.get("asked", 0) >= 10 and r.get("theirsRight", 0) >= r.get("nowRight", 0)]
    if models_:
        r = sorted(models_, key=lambda x: (-(x.get("theirsRight", 0) - x.get("nowRight", 0)), -x.get("theirsRight", 0)))[0]
        edge = r.get("theirsRight", 0) - r.get("nowRight", 0)
        fp_ = d.get("footprint") or {}
        dec_gb = next((x["gb"] for x in fp_.get("parts", []) if x.get("kind") == "decider"), None)
        out.append({"id": "model-decides:" + str(r.get("decider")), "strength": "measured", "apply": {"decider": "none"} if cur_dec != "none" else None, "n": r.get("asked", 0),
                    "title": ("%s chooses better than %s" if edge > 0 else "%s chooses as well as %s") % (r.get("name") or r.get("decider"), rec_dec),
                    "why": "Put the %d choices recorded in pass %s as the one that decides, it chose the larger model&#39;s answer %d times against %s&#39;s %d (it recovered %d and lost %d). %s%s"
                           % (r.get("asked", 0), e(str(rep.get("pass", "?"))), r.get("theirsRight", 0), e(rec_dec), r.get("nowRight", 0), r.get("recovered", 0), r.get("lost", 0),
                              "The choices are rebuilt from the record, close to what the decider was asked and not the same: a pass is what would tell. "
                              "This change makes a swarm with no decision model: where its drafts differ, a slot of the swarm decides, and training finds which. "
                              "%s goes on judging equivalence for training, apart from the swarm. " % e(rec_dec), elsewhere(rep_from)),
                    "cost": ("saves the decision model: %s%s GB of %s GB" % ("" if fp_.get("measured") else "about ", ("%.1f" % dec_gb).rstrip("0").rstrip("."), ("%.1f" % fp_["swarm"]).rstrip("0").rstrip("."))) if dec_gb and fp_.get("swarm") else "",
                    "note": "a new configuration: its training starts its own record"})
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
    out.extend(evaluation_recommendations(d))
    out.extend(engine_recommendations(d))
    return out


def recs_panel(d):
    """The recommended changes to the configuration, each with its evidence and a button to make it."""
    rs = recommendations(d)
    running = bool((run_state() or {}).get("running"))
    label = lambda r: {"measured": "Measured", "untested": "Untested", "info": "For you" if r.get("yours") else "For training"}.get(r["strength"]) or "Early: %d answers" % r.get("n", 0)  # noqa: E731
    rests = lambda r: ("rests on %d answer%s" % (r["n"], "" if r["n"] == 1 else "s")) if r.get("n") else ""  # noqa: E731
    def item(r):
        meta = " · ".join(x for x in [rests(r), r.get("cost", ""), e(r.get("note", ""))] if x)
        act = ('<button type="button" class="btn top" data-rec-apply=\'%s\'%s>Make this change</button>' % (e(json.dumps(r["apply"])), " disabled" if running else "")) if r.get("apply") else ""
        if r.get("train"):
            # (it presses the page's own Train: where that cannot start now, this cannot either, and says why)
            why_not = "a session is running" if running else (cannot_run() or busy_with() or needs_eval(d) or "")
            act = ('<div class="eng"><button type="button" class="btn top" data-rec-train%s>Train</button><small class="engs">%s</small></div>'
                   % (" disabled" if why_not else "", e(("Not now: %s" % why_not) if why_not else "starts a session, as Train does")))
        if r.get("update"):
            st = engine_update_state(ARGS.root, r["update"]) or {}
            going = bool(st.get("running"))
            failed = st.get("phase") == "failed"
            act = ('<div class="eng"><button type="button" class="btn top%s" data-engine-update="%s"%s>%s</button><progress class="engp"%s></progress><small class="engs">%s</small></div>'
                   % (" busy" if going else "", e(r["update"]), " disabled" if going or running else "", "Updating" if going else "Try again" if failed else "Update",
                      "" if going else " hidden", e(st.get("step", "")) if going or failed else ""))
        return '<li class="rec %s%s"><div><span class="rstr">%s</span><b>%s</b><p>%s</p><small class="where">%s</small></div>%s</li>' % (r["strength"], " engine" if r.get("update") or r.get("train") else "", e(label(r)), e(r["title"]), r["why"], meta, act)
    mine_ = [r for r in rs if r.get("apply")]
    theirs = [r for r in rs if not r.get("apply") and not r.get("yours")]
    yours = [r for r in rs if r.get("yours") and not r.get("next")]
    nexts = [r for r in rs if r.get("next")]
    items = "".join(item(r) for r in mine_) or '<li class="muted">No change to the configuration is recommended now%s.</li>' % (": what follows is for training" if theirs else "")
    if theirs:
        items += '<li class="rech">What training does about it itself</li>' + "".join(item(r) for r in theirs)
    if nexts:
        items += '<li class="rech">Before you read an evaluation</li>' + "".join(item(r) for r in nexts)
    if yours:
        items += '<li class="rech">The engines on this machine</li>' + "".join(item(r) for r in yours)
    return ('<div class="spec-head"><div><div class="kicker">What only you can change</div><h3 style="font-size:22px;margin-top:4px">Recommended configuration changes</h3></div>'
            '<button class="btn stop top" id="rec-close" type="button">Close</button></div>'
            '<p class="muted small" style="margin:8px 0 12px">A pass cannot change which models the swarm is made of: these are for you. Each says what it rests on. A change starts this configuration&#39;s own record, as choosing models in the pills does.%s</p>'
            '<ul class="recs">%s</ul>' % (" A session is running: stop it before changing the configuration." if running else "", items))


def config_section(d):
    """The pills, and under them who takes turns with tools and the questions a person wrote, in one section that folds (open to
    begin with); folded, it says in a line what it is. Beside its heading, a note when the evidence recommends a change to it.
    NOTHING HERE CHOOSES WHAT THE SWARM IS TRAINED ON (console ruling 2026-11-18: the boxes to tick, "Equivalent on", are gone):
    a pass asks every body of work, and what it asks more of is what it measured the swarm short on."""
    n = len(recommendations(d))  # (every one the dialog lists: one with no button was out of reach where it was the only one)
    badge = ('<button type="button" class="recbadge" id="rec-open" title="Open the recommended configuration changes"><i></i>%d recommendation%s</button>' % (n, "" if n == 1 else "s")) if n else ""
    return ('<details class="cfg fold" data-keep="cfg" open><summary><span class="cfgh">Configuration</span><span id="rec-slot">%s</span><span class="fmeta" id="cfg-meta">%s</span></summary>'
            '<div class="foldb">%s<div class="cfgrows">%s'
            # (no row for adapters: whether a slot carries one is training's to find, and is shown with the arrangement)
            '<div class="cfgrow"><span class="cfgl">Your own training questions</span>%s</div>'
            # (the questions training asks, read from here: the button was at the head of the Swarm Viewer, console 2026-11-24)
            '<div class="cfgrow"><span class="cfgl">View training questions</span>%s</div></div></div></details>'
            % (badge, e(cfg_meta(d)), pills(d), tools_row(d), own_questions(d), TQ_BUTTON))


def tools_row(d):
    """The row that asks who takes turns with tools, or nothing: A SWARM OF ONE MODEL, ITS TURNS DECIDED BY THE SWARM, IS NOT
    ASKED (console 2026-11-24). There the only other choice is that same model asked once, which is the module not used; it is
    what the swarm is measured and trained as. The row is shown where there are several models (which of them alone is a
    choice), and where a swarm of one model was set to take turns alone, so that what is set can be seen and put back."""
    if one_model(d) and (d.get("tools") or "a") == "swarm":
        return ""
    return '<div class="cfgrow"><span class="cfgl">Turns with tools</span>%s</div>' % tools_toggle(d)


def tools_toggle(d, inner=False):
    """TURNS WITH TOOLS: who takes a turn in an agent's work (a request that carries tools): the swarm, every drafter proposing the
    next step and the decider picking where they differ (src/tools.mjs), or the model in place a alone, as it came. It is part
    of how the swarm is served, saved in src/config.json; a session that is running keeps what it began with."""
    cur = d.get("tools") or "a"
    on = cur == "swarm"
    mem = [(k, m) for k, m in (d.get("members") or {}).items() if m]
    # (one model in several places is one choice, not one for each place: the first place it holds)
    mem = [(k, m) for i, (k, m) in enumerate(mem) if m["id"] not in [x["id"] for _, x in mem[:i]]]
    # one choice for the swarm, and one for each small model in it, by its name: the list follows the pills
    seg = lambda val, label, sel: '<button type="button" class="seg%s" data-tools="%s" aria-pressed="%s">%s</button>' % (" on" if sel else "", e(val), "true" if sel else "false", label)  # noqa: E731
    segs = seg("swarm", "Decided by the swarm", on) + "".join(seg(m["id"], "%s alone" % e(m["name"]), cur == k) for k, m in mem)
    # (a row of Configuration, under the pills, with a label and no description: it was under the boxes to tick while there were any)
    body = '<div class="tgl" role="group" aria-label="Who takes a turn with tools">%s</div>' % segs
    return body if inner else '<div class="tools" id="tools">%s</div>' % body


def own_questions(d, inner=False):
    """THE QUESTIONS A PERSON WROTE, a button for each body of work (training/equivalence.json), which opens that body's questions
    to change, add to or take out. They are asked beside the ones the trainer makes: an addition, never a choice of what is
    trained on. A button says how many of a person's own there are, where there are any; what the body of work is, is its title
    and the head of what it opens."""
    own = lambda t: len(t.get("own") or [])  # noqa: E731
    body = "".join(
        '<button class="ownb" type="button" data-qedit="%s" title="%s" aria-label="Your own questions for %s%s">%s%s'
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.2a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6l-9.3 9.3-3.8 1.1 1.1-3.8z"/><path d="M12.2 4.6l3.2 3.2"/></svg></button>'
        % (e(t["id"]), e(t.get("about", "")), e(t["name"]), (": %d written" % own(t)) if own(t) else ": none written", e(t["name"]), (" <em>%d</em>" % own(t)) if own(t) else "")
        for t in (d.get("equivalence") or {}).get("targets", []))
    # (drawn again in place, it is what is inside the row that is sent)
    return body if inner else '<div class="ownq" id="ownq">%s</div>' % body


MOST_OWN = 200  # the same bound as training/tasks.mjs


def questions_panel(d, tid):
    """The questions for one body of work: the kinds the trainer makes (new from a seed each pass, not edited here), and the
    questions a person wrote, one row each, to change, add to or take out. Saved to training/questions/<id>.json."""
    t = next((x for x in (d.get("equivalence") or {}).get("targets", []) if x["id"] == tid), None)
    if not t:
        return '<p class="muted">There is no body of work called that.</p>'
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
        '<div class="spec-head"><div><div class="kicker">A body of work</div><h3 style="font-size:22px;margin-top:4px">Questions: %s</h3></div>'
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
        # KEPT BY ITS CLASS (training/loop.mjs classCheck): what the questions of its class gained with it, the error of that, and
        # over how many; a change proposed for the class outright says so. One kept before that rule says what it was kept on then:
        # the question it brought to parity with the larger model's answer, and how many already there held
        cg = x.get("classGain") or {}
        gained = ("its class (%s) gained <b style='display:inline;font-size:inherit'>%+.3f</b> ± %.3f over %d questions"
                  % (e(CLASS_WORDS.get(x.get("class") or cg.get("class"), str(x.get("class") or cg.get("class") or ""))), cg["gain"], cg.get("stderr") or 0, cg.get("n") or 0)) if isinstance(cg.get("gain"), (int, float)) else ""
        evid = (("Proposed for its class at the end of a pass · %s" % gained) if x.get("proposed") and gained
                else ("Made <code>%s</code> good (lost in %s; change %s tried on it) · %s" % (
                    e(str(qn.get("id", ""))), e(str(qn.get("lostAt", ""))), e(str(qn.get("attempt", ""))), gained)) if qn and gained
                else "Brought <code>%s</code> to parity (lost in %s; change %s tried on it) · %s" % (
                    e(str(qn.get("id", ""))), e(str(qn.get("lostAt", ""))), e(str(qn.get("attempt", ""))),
                    ("%d already at parity asked again, none lost" % qn["guard"]) if qn.get("guard") else "none was at parity before it")
                ) if qn or gained else ('Equivalent answers on train: <b style="display:inline;font-size:inherit">%s</b> · on held: <b style="display:inline;font-size:inherit">%s</b>' % (ev(tr), ev(he)))
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
        return ('<h4>Everything it has found (%d win%s, every run)</h4><p class="muted small" style="margin:0 0 6px">Every change training kept, '
                "each with what it was kept on (measured against %s), from every run of this configuration: Clear training state starts training again, it never "
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
    # (the share is of the questions that can be graded, as the head of the Train card has it: progress_strip)
    can = max(0, of - sum(1 for q in qs if q.get("state") in ("not compared", "mark wrong", "no standard")))
    return "<b>%s%%</b> · %d of %d answers good (%d as the swarm stood, %d made good by a change)" % (fmt_pct(data.percent(at + re_, can) if can else 0), at + re_, of, at, re_)


def loop_changes(d):
    """What the loop has tried and kept this pass, for the spec."""
    lp = d.get("loop") or {}
    qs = lp.get("list") or []
    ch = lp.get("changes") or []
    tries = lp.get("tries") or sum(max(0, len(q.get("attempts") or []) - 1) for q in qs)
    return "%d tried · <b>%d</b> kept (%d of them found arrangements) · %d found arrangement%s in the library" % (
        tries, len(ch), sum(1 for c in ch if c.get("kind") == "library"), len(library_of(d)), "" if len(library_of(d)) == 1 else "s")


def _spec_instruments_words(sp):
    """The instruments a spec's arrangement has on, by class of input (plan.instruments; none until training turns one on)."""
    b = (sp.get("recipe") or {}).get("briefs") or {}
    on = lambda p: (data.__dict__.get("INSTRUMENT_IDS") or ["sum", "truth", "sorted", "closed", "lies", "word", "row", "date", "free", "order", "more", "valid", "number", "weekday", "letters", "range", "track", "path", "quantity"]) if (p or {}).get("instruments") is True else list((p or {}).get("instruments") or [])  # noqa: E731
    said = []
    if on(b.get("plan")):
        said.append("every class: %s" % e(", ".join(on(b.get("plan")))))
    for c, k in (b.get("kinds") or {}).items():
        if on((k or {}).get("plan")):
            said.append("%s: %s" % (e(c), e(", ".join(on(k.get("plan"))))))
    return "<br>".join(said) if said else "<span class='muted'>none: training has turned none on</span>"


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
                    row("Answers good", loop_line(d)),
                    row("Changes", loop_changes(d)),
                    row("Measured so far", "<ul style='margin:0;padding-left:18px'>%s</ul>" % meas) if meas else ""))
    # HOW FAR TRAINING TOOK IT: the default arrangement against the trained one, served the same way, and the gain (data.equivalence_of)
    eqv = sp["equivalence"]
    side = lambda x: ("<b>%s%%</b> · %d of %d held questions" % (fmt_pct(x["percent"]), x["equivalent"], x["of"])) if "percent" in x else ("the same as the default: training has kept nothing yet" if x.get("sameAs") else "not measured yet")  # noqa: E731
    served = (": with the adapters of %s" % ", ".join("place " + k for k in eqv["default"]["adapters"])) if eqv["default"]["adapters"] else ": without adapters"
    gained = ("<table class='spec'>%s%s%s</table>"
              % (row("Default (briefs v%s)" % eqv["default"]["briefsVersion"], side(eqv["default"]) + "<br><span class='muted'>%s%s</span>" % (e(eqv["defaultIs"]), e(served))),
                 row("Trained (briefs v%s)" % eqv["trained"]["briefsVersion"], side(eqv["trained"]) + "<br><span class='muted'>%s</span>" % e(eqv["trainedIs"])),
                 row("Gain", ("<b>%+.1f points</b>" % eqv["gainPoints"]) if eqv["gainPoints"] is not None else "<span class='muted'>%s</span>" % e(eqv["gainIs"]))))
    gained = "<h4>How far training took it</h4>" + gained
    pins = sp["recipe"].get("adapters") or {}
    made = (sp.get("adapters") or {}).get("models") or {}
    def _adapter_row(k, a):
        """One row a pinned file: the one adapter of a place, or the adapter of each role it was pretrained for."""
        mk = made.get(k, {})
        frm = "from %s @ %s" % (e(str((mk.get("from") or {}).get("weights", ""))), e(str((mk.get("from") or {}).get("revision", ""))[:12]))
        # (a mixture: the adapters its slots carry by name, S1.4.1)
        named_rows = "".join(row("Adapter (place %s, %s)" % (k, e(nm)), "<code>%s</code> <span class='muted'>%.1f MB</span><br><code>sha256 %s</code><br><span class='muted'>carried by the slot %s; taught on %s examples of that slot's own requests (%s its own right answers, %s the larger model's); %s</span>"
                                 % (e(x["file"]), (x.get("bytes") or 0) / 2**20, e(x["sha256"]), e(str(((mk.get("named") or {}).get(nm) or {}).get("slot", "?"))), e(str(((mk.get("named") or {}).get(nm) or {}).get("examples", "?"))),
                                    e(str(((mk.get("named") or {}).get(nm) or {}).get("own", "?"))), e(str(((mk.get("named") or {}).get(nm) or {}).get("larger", "?"))), frm)) for nm, x in (a.get("named") or {}).items())
        if a.get("named") and not a.get("roles") and not a.get("file"):
            return named_rows
        if a.get("roles"):
            return named_rows + "".join(row("Adapter (place %s, %s)" % (k, role), "<code>%s</code> <span class='muted'>%.1f MB</span><br><code>sha256 %s</code><br><span class='muted'>taught on %s of its own right answers as a slot of this role; %s</span>"
                               % (e(x["file"]), (x.get("bytes") or 0) / 2**20, e(x["sha256"]), e(str(((mk.get("roles") or {}).get(role) or {}).get("examples", "?"))), frm)) for role, x in a["roles"].items())
        return row("Adapter (place %s)" % k, "<code>%s</code> <span class='muted'>%.1f MB</span><br><code>sha256 %s</code><br><span class='muted'>%s; %s, %s steps</span>"
                   % (e(a["file"]), a["bytes"] / 2**20, e(a["sha256"]), e(mk.get("learned", "")), frm, e(str(mk.get("iters", "")))))
    adapter_rows = "".join(_adapter_row(k, a) for k, a in pins.items())
    if pins:
        adapter_rows += row("Adapter files", "<span class='muted'>%s</span>" % e(sp["adapters"]["filesAre"]))
    # AS A MODEL CHOOSER LISTS IT: the card, what it needs, what it can do, how it starts
    c, rq, cap, st_ = sp["card"], sp["requirements"], sp["interface"]["capabilities"], sp["interface"]["start"]
    host = ('<h4>As a model chooser lists it</h4><div class="hostcard"><div><b>%s</b><span class="muted small"> · %s · about %s GB · %s</span></div><div class="hcbadge">%s</div><p>%s</p>%s</div>'
            '<p class="muted small" style="margin:6px 0 0">The entry a model chooser takes, with <code>engine: swarm</code>; it is started with <code>%s</code>.</p>'
            "<h4>What it needs</h4><table class='spec'>%s</table><h4>What it can do as a model</h4><table class='spec'>%s</table>%s<h4>To make it</h4><table class='spec'>%s</table>"
            % (e(c["name"]), e(c["size"]), e(str(c["memGb"])), e(c["pace"] if c.get("secondsPerReply") is None else "%s s a reply" % c["secondsPerReply"]), e(c["badge"]), e(c["plain"]),
               ('<div class="hcon">%s</div>' % "".join("<span>%s</span>" % e(x) for x in c["trainedOn"])) if c["trainedOn"] else "", e(st_["host"]),
               row("Platforms", e(", ".join(rq["platforms"])) + "<br><span class='muted'>%s</span>" % e(rq["platformsAre"])) + row("Memory", "about %s GB (an estimate)" % e(str(rq["memoryGb"])))
               + row("Disk", "%s GB of model files" % e(str(rq["diskGb"]))) + row("Engine", e(rq["engine"])) + row("Node", e(rq["node"])) + (row("The decider", e(rq["decider"])) if rq.get("decider") else "")
               + row("Licences", e("; ".join(rq["licenses"]))) + row("Commercial use", ("<b>Allowed by every licence listed</b>" if rq["commercialUse"] else "<b class='bad'>Not allowed</b>: a licence says non-commercial") + "<br><span class='muted'>Read every licence above before offering it</span>"),
               row("Chat", "yes") + row("Streaming", e(cap["stream"])) + row("Tools", e(cap["tools"])) + row("Images", "no") + row("Context", "%s tokens a request" % e(str(cap["contextTokens"]))) + row("Good for", e(sp["interface"]["goodFor"])),
               web_search_block(sp, row),
               row("SwOA", "<code>%s</code><br><span class='muted'>%s</span>" % (e(sp["swoa"]["recipeSha256"][:16]), e(sp["swoa"]["is"])))
               + row("Base module", "<code>%s</code>" % e(sp["swoa"]["baseModuleSha256"][:16])) + row("Arrangement", "<code>%s</code>" % e(sp["swoa"]["arrangementSha256"][:16]))
               + row("Format", "<code>%s</code> version %s (docs/swoa.md)" % (e(sp["swoa"]["format"]), e(str(sp["swoa"]["version"]))))
               + row("Runtime", "%s %s" % (e(str((sp.get("runtime") or {}).get("library") or "")), e(str((sp.get("runtime") or {}).get("version") or ""))))
               + row("Written", e(str(sp["swoa"].get("writtenAt") or "")))
               # WHAT TRAINING ADDED TO THE BASE MODULE, in one place: its adapters (by role where pretraining made them so) and the
               # instruments that are on. With the arrangement below, that is the whole of what a module is made again from
               + row("Instruments on", _spec_instruments_words(sp))
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
                         else ("In training: pass %d under way" % ip["pass"]) if t["state"] == "not measured" and ip
                         # (training's own measure, on its held questions: said so, since the proof under it may hold an evaluation)
                         else "Not yet measured by training" if t["state"] == "not measured" else t["state"].capitalize()), e(t["target"].get("name") or ""),
            e(str(t["parityMeans"])[:1].upper() + str(t["parityMeans"])[1:]), published_line,
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
    # (measured where the pass in hand measured it, data.measured_footprint: said so, with the estimate it replaces)
    how = (("Measured while it trained: each model&#39;s own process%s. The estimate from the files was %s GB" % ("" if not fp.get("deciderListed") else ", the decider at its listed size", ab(fp.get("estimate") or 0)))
           if fp.get("measured") else "")
    seg = "".join('<i style="width:%.2f%%;background:%s" title="%s: about %s GB"></i>' % (100.0 * x["gb"] / scale, col(x), e(x["name"]), ab(x["gb"])) for x in fp["parts"])
    legend = "".join('<span><i style="background:%s"></i>%s <b>%s GB</b></span>' % (col(x), e(x["name"]), ab(x["gb"])) for x in fp["parts"])
    ticks = "".join('<span style="left:%.2f%%">%s</span>' % (100.0 * t / scale, ab(t)) for t in range(0, int(scale) + 1, 5 if scale > 12 else 2))
    head = ('<span class="memh"><span><b>Memory saved: the swarm against the larger model</b><small>%s</small></span>'
            '<span class="memnum"><b>%s%%</b><span>memory saved · %s GB less · %s× smaller</span></span></span>'
            % (how if how else "Estimated from the model files and the listed sizes, not measured" if compact else
               "What the Swarm is for: the larger model&#39;s answers in a fraction of its memory. Estimated from what is on record (the small models&#39; files with their contexts, the decider&#39;s and the larger model&#39;s listed sizes), not measured",
               fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0", ab(max(0.0, fp["savedGb"])), ab(fp["times"] or 0)))
    return ('<span class="memc%s" title="Estimates from what is on record: the small models\' files with their contexts, the decider\'s listed size, and the larger model\'s listed size. Not measured.">%s'
            '<span class="memrows"><span class="memrow"><span class="ml">%s</span><span class="mbar"><i style="width:%.2f%%;background:var(--tgt)"></i></span><span class="mv"><b>%s GB</b></span></span>'
            '<span class="memrow"><span class="ml">The swarm</span><span class="mbar stack">%s</span><span class="mv"><b>%s GB</b></span></span>'
            '<span class="memrow axis"><span></span><span class="ticks">%s</span><span class="mv">GB</span></span></span>'
            '<span class="memleg">%s</span></span>'
            % (" compact" if compact else "", "" if headless else head, e(fp.get("targetName") or "The larger model"), 100.0 * fp["target"] / scale, ab(fp["target"]), seg, ab(fp["swarm"]), ticks, legend))




# WHAT EACH STEP OF A PASS IS OF THE WHOLE, in hundredths (training/session.sh, in its order): the two that train are most of it,
# the larger model's answers and the checks at the end the rest. A share to read how far a pass has come by, not a measurement
# of time: a step's own length depends on the models.
PASS_SHARES = [("00-begin", 1), ("00-plan", 1), ("00-reader", 1), ("08-classes", 30), ("02-target", 2), ("02-target-train", 2), ("02-target-self", 2), ("02-target-self-train", 2),
               ("02-target-third", 2), ("02-target-third-train", 2), ("03-alone", 3), ("07-write-briefs", 1), ("07-plan", 1), ("10-questions", 40), ("12-members", 2),
               ("12-deciders", 2), ("21-swarm-held", 3), ("21-swarm-reworded", 2), ("22-end", 0.5), ("23-publish", 0.5)]


def classes_share(rec, asked=4, step=""):
    """How much of the stage that trains each class as a class is done, from its record (training/classes.mjs, classes.json) and
    the line it says of what it is doing now (step: "... question 4 of 34", "... draw 2 of 2 ..."), 0 to 1. Each class asked
    is an equal part; one finished is whole. The one in hand: asked as it stands (15 hundredths of it, by the question it is
    on), then each round by the changes tried of those it has to try, the one being tried counted by the question it is on,
    and the held questions by the draw and the question. Where a record does not say how many changes a round has (one
    written before it did), the round before it, or the class before it, is taken to say; else thirty."""
    # A RECORD THAT SAYS DONE WHILE THE STAGE SAYS WHAT IT IS ASKING IS THE LAST PASS'S. The stage writes its record first when
    # it has asked every train question as the swarm stands, so until then the file is the pass before, finished: a pass
    # just started read 100% (console 2026-11-24). With a step in hand, such a record, or none, is a pass that has begun:
    # it is as far as the question it is on.
    if step and (not rec or rec.get("done")):
        rec = {"classes": {}}
    if not rec:
        return 0.0
    if rec.get("done"):
        return 1.0
    q = re.search(r"question (\d+) of (\d+)", step or "")
    qfrac = (max(0, int(q.group(1)) - 1) / int(q.group(2))) if q and int(q.group(2)) else 0.0
    dr = re.search(r"draw (\d+) of (\d+)", step or "")
    held_now = "held question" in (step or "")
    cs = list((rec.get("classes") or {}).values())
    if not cs and step:
        cs = [{}]  # (nothing written yet: the first class, being asked as it stands)
    seen = [len(r.get("candidates") or []) for c in cs for r in c.get("rounds") or [] if "kept" in r or c is not cs[-1]]
    total = 0.0
    for i, c in enumerate(cs):
        if i < len(cs) - 1 or c.get("skipped"):
            total += 1
            continue
        rounds, of_rounds = c.get("rounds") or [], max(1, int(rec.get("rounds") or 2))
        if c.get("asItStands") is None:
            total += 0.15 * qfrac
            continue
        part = 0.15
        for k, r in enumerate(rounds):
            tried = len(r.get("candidates") or [])
            of = r.get("of") or max([tried + 1] + (seen[-1:] or [30]))
            if "kept" in r or k < len(rounds) - 1:
                done_r = 1.0
            elif held_now or r.get("held"):
                # (the held questions: as it stands and with the best, each on every draw: four askings of them, or 2 x draws)
                n_dr = int(dr.group(2)) if dr else 2
                at = ((int(dr.group(1)) - 1 + qfrac) / n_dr) if dr else qfrac
                done_r = 0.8 + 0.2 * min(1.0, ((0 if "as it stands" in step else 1) + at) / 2)
            else:
                done_r = 0.8 * min(1.0, (tried + qfrac) / of)
            part += 0.85 * done_r / of_rounds
        total += min(1.0, part)
    return max(0.0, min(1.0, total / max(asked, len(cs), 1)))


def pass_progress(d):
    """HOW FAR THE PASS IN HAND HAS COME, as a share of it: {"pct", "pass", "step", "done"}, or None where no pass of this
    configuration has begun. From the pass's own record of its steps (status.txt: each step that ended well counts whole,
    PASS_SHARES), and inside the two steps that train, from their own records: the classes done of those asked, and the
    questions finished of the pass's. A pass that ended is 100."""
    try:
        work = Path(d.get("root", ARGS.root)) / ".work" / "train" / str(d.get("key", ""))
        passes = sorted((p for p in work.glob("pass-*") if (p / "status.txt").exists()), key=lambda p: int(p.name.split("-")[1]))
        if not passes:
            return None
        lines = [x.split() for x in (passes[-1] / "status.txt").read_text().splitlines() if x.strip()]
    except (OSError, ValueError):
        return None
    n = int(passes[-1].name.split("-")[1])
    ended = {x[2] for x in lines if len(x) > 4 and x[1] == "END" and x[3] == "exit" and x[4] == "0"} | {x[2] for x in lines if len(x) > 2 and x[1] == "SKIP"}
    started = [x[2] for x in lines if len(x) > 2 and x[1] == "START"]
    now = started[-1] if started and started[-1] not in ended else ""
    if any(x and x[-1] == "DONE" for x in lines):
        return {"pct": 100.0, "pass": n, "step": "", "done": True}
    share_of = lambda name: next((w for k, w in PASS_SHARES if k == name), None)  # noqa: E731
    alone = [x for x in set(started) | ended if re.match(r"03-\w+-alone$", x)]
    total = 0.0
    for name, w in PASS_SHARES:
        if name == "03-alone":
            total += w * (len([x for x in alone if x in ended]) / max(1, len(alone))) if alone else (w if "07-write-briefs" in ended or "07-plan" in started[-1:] else 0)
        elif name in ended:
            total += w
        elif name == now and name == "08-classes":
            rec = data._json(Path(d.get("root", ARGS.root)) / "training" / "results" / str(d.get("key", "")) / "classes.json", None)
            live = data._json(Path(d.get("root", ARGS.root)) / ".work" / "train" / "live.json", {}) or {}
            total += w * classes_share(rec, len((run_state() or {}).get("classes") or []) or 4, str(live.get("step") or "") if live.get("trainer") == "classes" else "")
        elif name == now and name == "10-questions":
            lp = d.get("loop") or {}
            fin = sum(1 for q in lp.get("list") or [] if q.get("state") not in ("reopened", "set aside"))
            total += w * (min(1.0, fin / lp["of"]) if lp.get("of") else 0)
    return {"pct": max(0.0, min(99.0, total)), "pass": n, "step": now, "done": False}


def progress_strip(d, cleared=""):
    """ANSWERS GOOD, as a share: training goes question by question, so how far the pass has come is how many of its train questions
    the swarm answers well (as it stood, or after a change it kept), of all that can be graded. Good: right by the question's own
    standard, or equivalent to an answer the larger model agrees with itself on (docs/swoa-parity.md). It is not parity: that is the
    proof's to say, capability by capability, and the line sets the module beside its target where the questions carry a standard; with the line that says where the pass is, Train and Clear training state, and what the session is doing. It heads
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
    # (and one with no standard: the larger model's own answers to it do not agree, so there is nothing to be at parity with)
    can = max(0, of - n("not compared") - wrong_m - n("no standard"))
    pct = data.percent(done, can) if can else 0
    if qs:
        # THE MODULE BESIDE ITS TARGET, where a question carries its own standard: how many each has right by it (families_block has
        # every family). Parity itself is the proof's to say, capability by capability; this is where the pass stands
        fams = [f for f in lp.get("families") or [] if f.get("asked") and f.get("own")]
        beside = (" By the questions&#39; own standards the module is right on <b>%d</b> of %d and %s on <b>%d</b> of %d."
                  % (sum(f.get("module") or 0 for f in fams), sum(f.get("asked") or 0 for f in fams), e(tname), sum(f.get("target") or 0 for f in fams), sum(f.get("targetKnown") or 0 for f in fams))) if fams else ""
        # (and what it takes to do so: the memory this configuration needs against the larger model's, as the pass wrote it down)
        # ONE SOURCE for every memory figure on the page (data.measured_footprint, d["footprint"]): the card above reads it too,
        # so the two cannot say different things (they did: this line read the pass's row and the card the page as it was drawn)
        fp = d.get("footprint") or {}
        if fp.get("measured"):
            beside += " Measured while it trained, it takes <b>%s GB</b> of memory against %s GB: <b>%s%%</b> saved." % (e(str(fp["swarm"])), e(str(fp["target"])), fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0")
        elif fp.get("swarm") and fp.get("target"):
            beside += " By its files it takes about <b>%s GB</b> of memory against %s GB: <b>%s%%</b> saved (not measured yet)." % (e(str(fp["swarm"])), e(str(fp["target"])), fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0")
        line = ("<b>%d</b> of %d train answers good: <b>%d</b> as the swarm stood, <b>%d</b> made good by a change it kept%s%s.%s"
                % (done, of, at, re_, ((", %d back in hand after a swap" % n("reopened")) if n("reopened") else "") + ((", %d set aside until the others are done" % n("set aside")) if n("set aside") else ""), ((", %d not good yet" % nr) if nr else "") + ((", %d set aside because the larger model's answer is wrong" % wrong_m) if wrong_m else "")
                   # (a mark the larger model did not give again, where the swarm's answer is not equivalent to it: not searched, and still counted in the share)
                   + ((", %d set aside because the larger model did not give its answer again" % n("mark unstable")) if n("mark unstable") else "")
                   + ((", %d left out because the larger model's own answers do not agree" % n("no standard")) if n("no standard") else ""), beside))
        # (a record graded by an earlier rule is not carried on by the loop, training/loop.mjs SCORING: said, in place of where it
        # would have carried on from)
        stale = d.get("scoring") is not None and (lp.get("scoring") or 1) != d.get("scoring")
        now = (("Question %s is in hand." % e(str(lv.get("n")))) if lv
               else "This is the record of a pass graded by an earlier rule: when training starts, its questions are asked again from the first." if stale
               else ("Stopped; it carries on from question %d." % (len(qs) - back + 1)) if len(qs) - back < of else "Every question of this pass is finished.")
    else:
        line = ""  # (nothing to say of a pass before it has a question: the sentence that stood here never changed)
        now = ""
    # (while a session runs, a bar that moves in place of the share: the line beside it, the bar and the counts below go on saying
    # where the pass is; stopped, the share comes back, as far as the pass got)
    running_now = bool((run_state() or {}).get("running"))
    _ctl = run_controls().partition(TRAIN_BELOW)
    # HOW FAR THE PASS HAS COME, under the head: a bar and its share, with the step it is in while a session runs
    pp = pass_progress(d)
    passbar = ""
    if pp:
        passbar = ('<div class="passprog" id="passprog"><span class="evbar%s"><i style="width:%.1f%%"></i></span><b>%s%%</b><span>of pass %d complete%s</span></div>'
                   # (to a tenth: a pass is long, and a whole point can take minutes)
                   % (" on" if running_now else "", pp["pct"], ("%.1f" % pp["pct"]) if 0 < pp["pct"] < 100 else "%d" % pp["pct"], pp["pass"],
                      (" · " + e(step_label(pp["step"]).lower())) if running_now and pp["step"] else "" if pp["done"] or running_now else " · stopped here"))
    # WHILE THE CLASS STAGE RUNS, THE HEAD IS ITS OWN FIGURE: the train questions good as the swarm stands in this stage, and
    # which pass of it. The question-by-question pass's share stood here whatever was running, and read "0% answers good,
    # pass 1" while a stage trained (console 2026-11-24).
    sf = stage_figure(stage_record(d)) if stage_step() and not running_now else None
    if stage_step() and not running_now:
        return ('<div class="trainprog trainhead" data-stage="1"><div class="proghead"><span class="memnum"><b class="pct">%s</b><span>train answers good<small>%s</small></span></span>'
                '<span class="progline">%s</span><span class="evctl">%s</span></div>%s%s</div>'
                % (("%s%%" % fmt_pct(data.percent(sf["right"], sf["of"]))) if sf and sf["of"] else "&ndash;",
                   ("the class stage, pass %d" % sf["pass"]) if sf else "the class stage, starting",
                   (("<b>%d</b> of %d train answers good as the swarm stands in this stage. " % (sf["right"], sf["of"])) if sf else "")
                   + (("Of the kinds of question as they were before %s, when kinds were added: <b>%d</b> of %d. " % (e(sf["earlier"]["since"]), sf["earlier"]["right"], sf["earlier"]["of"])) if sf and sf.get("earlier") else "")
                   + "<b>Now:</b> " + e(stage_step()),
                   _ctl[0], ('<div class="trainbelow">%s</div>' % _ctl[2]) if _ctl[2] else "", run_lines(cleared)))
    return ('<div class="trainprog trainhead"><div class="proghead"><span class="memnum"' + (' aria-busy="true">' + busy() if running_now else '><b class="pct">%s%%</b>' % fmt_pct(pct)) + '<span>answers good<small>pass %s</small></span></span>'
            '<span class="progline">%s %s</span><span class="evctl">%s</span></div>%s%s%s</div>'
            % (e(str(lp.get("pass") or (d.get("state") or {}).get("pass", 0) + 1)), line, now, _ctl[0], passbar, ('<div class="trainbelow">%s</div>' % _ctl[2]) if _ctl[2] else "", run_lines(cleared)))


def memory_card(d):
    """MEMORY SAVED, the first card: what the swarm takes in memory against the larger model. Its head is built as Evaluate's, Pretrain's
    and Train's are (the share at the top left, what it is beside it, a line saying what it rests on), and under it the bars on one
    scale, the swarm's made of its parts, and their key. None where nothing is on record to estimate from."""
    fp = d.get("footprint")
    if not fp:
        return ""
    ab = lambda n: ("%.1f" % n).rstrip("0").rstrip(".")  # noqa: E731
    return ('<h2>Memory saved</h2><div class="panel memcard" id="memcard"><div class="proghead"><span class="memnum"><b class="pct">%s%%</b><span>memory saved<small>%s GB less</small></span></span>'
            '<span class="progline">The swarm is %s× smaller than %s: %s.</span><span class="evctl"></span></div>%s</div>'
            % (fmt_pct(fp["saved"]) if fp["saved"] > 0 else "0", ab(max(0.0, fp["savedGb"])), ab(fp["times"] or 0), e(fp.get("targetName") or "the larger model"),
               # (measured where the pass in hand measured it, and said so with the estimate it replaces: data.measured_footprint)
               ("measured while it trained, from each model&#39;s own process%s (the estimate from the model files was %s GB)" % (", with the decider at its listed size" if fp.get("deciderListed") else "", ab(fp.get("estimate") or 0)))
               if fp.get("measured") else "estimated from the model files and the listed sizes, not measured",
               memory_chart(d, compact=True, headless=True)))


# ---------------------------------------------------------------- evaluate the swarm, pretrain it
# Both, like a training session, are processes this page starts and stops (each in a session of its own, so that stopping it stops
# the model servers it started), and only one of the three runs at a time: each needs the models, and the memory, to itself.
def _job_file(name):
    return Path(ARGS.root) / ".work" / name / "ui-run.json"


def _run_in(ps_text):
    """THE WHOLE RUN, FOUND BY ITS PROCESS, in what `ps -axo pid=,command=` printed: the one whose program is the shell and whose
    script is training/run.sh (a shell that only launched it carries the same words further along its line, and is not it).
    -> {pid, limit, train, adopted} or None."""
    for line in str(ps_text or "").splitlines():
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit() or parts[1].rsplit("/", 1)[-1] not in ("bash", "sh") or parts[2] != "training/run.sh":
            continue
        args = parts[3:]
        opt = lambda k, d: args[args.index(k) + 1] if k in args and args.index(k) + 1 < len(args) else d  # noqa: E731
        try:
            limit = -1 if "--proof" in args else int(opt("--limit", 20))
        except ValueError:
            limit = 20
        return {"pid": int(parts[0]), "limit": limit, "train": opt("--train", "classes"), "adopted": True, "running": True}
    return None


# ASKED ONCE FOR EACH REQUEST. Drawing the page asked the system which processes are running twenty-five times, once for every
# card that says whether something has the models, and each asking is a program started: 1.3 of the 2.3 seconds the page took
# to arrive (measured 2026-11-24). While a request is being answered (Handler), what such a question came to is kept and given
# again; a request that starts or stops something forgets it (_forget). Outside a request nothing is kept, so a check that
# changes what is running between two calls sees the change.
_REQ = threading.local()


def _per_request(key, ask):
    kept = getattr(_REQ, "kept", None)
    if kept is None:
        return ask()
    if key not in kept:
        kept[key] = ask()
    return kept[key]


def _forget():
    if getattr(_REQ, "kept", None) is not None:
        _REQ.kept = {}


def _run_elsewhere():
    """A whole run this page did not start (from a shell): it has the models all the same, and the page can stop it."""
    return _per_request("run_elsewhere", _run_elsewhere_now)


def _run_elsewhere_now():
    try:
        found = _run_in(subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, timeout=5).stdout)
        # (THIS folder's run, and no other's: a run of another checkout on the machine has other models, and is not this page's
        # to stop or to wait for. The page's own checks, on a copy of the repository, failed while a real run was going,
        # 2026-11-22. A run whose folder cannot be read is taken for this one's, as before.)
        return found if found and _run_is_here(found["pid"]) else None
    except (OSError, subprocess.SubprocessError):
        return None


def _run_is_here(pid):
    """Whether a process works in this page's folder (its working directory, as lsof says it); True where that cannot be read."""
    try:
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return True
    cwd = next((line[1:] for line in out.splitlines() if line.startswith("n")), "")
    try:
        return not cwd or Path(cwd).resolve() == Path(ARGS.root).resolve()
    except OSError:
        return True


def _descendants(pid):
    """Every process a process started, and what those started: read before it is signalled, while they still name it."""
    try:
        rows = [x.split() for x in subprocess.run(["ps", "-axo", "pid=,ppid="], capture_output=True, text=True, timeout=5).stdout.splitlines()]
    except (OSError, subprocess.SubprocessError):
        return []
    kids = {}
    for r in rows:
        if len(r) == 2 and r[0].isdigit() and r[1].isdigit():
            kids.setdefault(int(r[1]), []).append(int(r[0]))
    out, todo = [], [int(pid)]
    while todo:
        for k in kids.get(todo.pop(), []):
            out.append(k)
            todo.append(k)
    return out


def job_state(name):
    """{pid, at, ...} of the evaluation or pretraining this page started, and whether it is still alive. (The whole run is also
    found where the page did not start it: _run_elsewhere.)"""
    st = _job_state(name)
    if name == "whole" and not (st or {}).get("running"):
        return _run_elsewhere() or st
    return st


def _job_state(name):
    try:
        st = json.loads(_job_file(name).read_text())
    except (OSError, ValueError):
        return None
    try:
        try:
            got, status = os.waitpid(st["pid"], os.WNOHANG)
            if got == st["pid"]:
                # (how it ended is kept beside it: a run that ended on an error says so on its card, job_failure)
                st["exit"] = os.waitstatus_to_exitcode(status)
                try:
                    _job_file(name).write_text(json.dumps(st))
                except OSError:
                    pass
                raise OSError("ended")
        except ChildProcessError:
            pass
        os.kill(st["pid"], 0)
        st["running"] = _ours(st["pid"], RUN_MARKS.get(name, name))
    except (OSError, KeyError):
        st["running"] = False
    return st


def stage_alive():
    """Whether the stage that trains each class as a class is running, however it was started: the conversation run, the whole
    run, or a terminal."""
    return bool((job_state("converse") or {}).get("running") or (job_state("whole") or {}).get("running") or _classes_alive())


def stage_step():
    """What the class stage says it is asking this moment, where it runs and its note is fresh; else ''."""
    root = Path(ARGS.root)
    live = data._json(root / ".work" / "train" / "live.json", {}) or {}
    try:
        fresh = time.time() - (root / ".work" / "train" / "live.json").stat().st_mtime < 300
    except OSError:
        fresh = False
    return str(live.get("step") or "") if live.get("trainer") == "classes" and fresh and stage_alive() else ""


def stage_record(d):
    """THE RECORD THE CLASS STAGE THAT IS RUNNING WRITES (its note of what is happening names it, `record`: classes.mjs), read
    as it stands; None where no stage runs or the note names none here. A stage started from a terminal with a record of
    its own is read from that record, not from the configuration's usual one (console 2026-11-24)."""
    if not stage_step():
        return None
    root = Path(d.get("root", ARGS.root)).resolve()
    live = data._json(root / ".work" / "train" / "live.json", {}) or {}
    try:
        f = Path(str(live.get("record") or "")).resolve()
        if root in f.parents and f.is_file():
            rec = data._json(f, None)
            # (not yet written by this pass: the file is the pass before, which says it is done. This one has begun)
            if rec and rec.get("done"):
                return {"pass": (rec.get("pass") or 0) + 1, "classes": {}, "sample": rec.get("sample"), "rounds": rec.get("rounds"), "starting": True}
            return rec
    except (OSError, ValueError):
        pass
    return None


def stage_figure(rec):
    """THE STAGE'S OWN FIGURE, for the Train card's head while it runs: of the train questions it has asked as the swarm stands
    (and as it stands after what it kept), how many are good. -> { right, of, pass } or None."""
    cs = [C for C in ((rec or {}).get("classes") or {}).values() if C and not C.get("skipped")]
    got = [(C.get("after") or C.get("asItStands")) for C in cs if (C.get("after") or C.get("asItStands"))]
    if not got:
        return None
    out = {"right": sum(x.get("counted") or 0 for x in got), "of": sum(x.get("n") or 0 for x in got), "pass": (rec or {}).get("pass") or 1}
    # OF THE KINDS AS THEY WERE (training/classes.mjs figuresOf `earlier`): where a kind of question was added after passes had
    # been measured, the same figure without the kinds added, so that it can be set beside a figure of an earlier pass
    if any(x.get("earlier") for x in got):
        was = [(x.get("earlier") or {"n": x.get("n") or 0, "counted": x.get("counted") or 0}) for x in got]
        out["earlier"] = {"right": sum(w.get("counted") or 0 for w in was), "of": sum(w.get("n") or 0 for w in was),
                          "since": min(x["earlier"]["since"] for x in got if x.get("earlier") and x["earlier"].get("since"))}
    return out


def idle_words():
    """What the Train card says where no training session runs: that nothing does, or that an evaluation or pretraining has the
    models (the page's script says the same from /api/live, busy)."""
    step = stage_step()
    if step:
        return "Training each class of input as a class · " + step
    held = busy_with()
    return ("%s is running: the models are loaded for it." % (held[0].upper() + held[1:])) if held and held != "training" else "Nothing is running. No model is loaded."


def busy_with():
    """Which of training, evaluation and pretraining is running now ('' when none): the other two wait for it."""
    if (run_state() or {}).get("running"):
        return "training"
    # (the whole run first, where it was started from a shell: its steps are not this page's jobs, and it has the models)
    if (_run_elsewhere() or {}).get("running"):
        return "the run"
    # (and the class stage where a terminal started it: it has the models as surely as one this page started)
    if not (job_state("converse") or {}).get("running") and not (job_state("whole") or {}).get("running") and _classes_alive():
        return "training started from a terminal"
    # (the job called pretrain is what makes adapters: the whole run starts it as its second step)
    for name, what in (("eval", "an evaluation"), ("pretrain", "making adapters"), ("serve", "the module being served"), ("converse", "a conversation pass")):
        if (job_state(name) or {}).get("running"):
            return what
    # (the whole run, between two of its steps: nothing of the three is running for a moment, and it still has the models)
    if (job_state("whole") or {}).get("running"):
        return "the run"
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
    _forget()
    env = dict(os.environ, NODE=node_for_training())
    p = subprocess.Popen(argv, cwd=str(root), env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    # (with what was chosen for it, so the page can say so from the first moment, before the run itself has written anything)
    _job_file(name).write_text(json.dumps(dict(keep or {}, pid=p.pid, at=time.strftime("%Y-%m-%d %H:%M:%S"))))
    return ""


def job_failure(name):
    """WHY A RUN THIS PAGE STARTED ENDED WITHOUT DOING ITS WORK, in its own words, or '' (it runs, it finished, or a person
    stopped it). A press of Run a pass once came back to a button that could be pressed again and said nothing: the pass had
    ended in its first second on a model that was not on the disk, and only its log knew (2026-11-24). The sentence is the
    last error the run wrote; where it wrote none and ended badly, its last line."""
    st = _job_state(name)
    if not st or st.get("running") or st.get("stopped") or st.get("exit") == 0:
        return ""
    try:
        with open(Path(ARGS.root) / ".work" / name / "ui-run.log", "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 6000))
            lines = [x.strip() for x in f.read().decode("utf-8", "replace").splitlines() if x.strip()]
    except OSError:
        lines = []
    said = [m.group(1) for m in (re.match(r"^(?:[A-Za-z]*Error|failed\s+\S.*?|NOT READY): *(.+)$", x) for x in lines) if m]
    failed = [x for x in lines if x.startswith("failed ")]
    if failed:
        return re.sub(r"^failed\s+", "", failed[-1])[:400]
    if said:
        return said[-1][:400]
    if st.get("exit") is None:
        return ""  # (how it ended is not known, and it wrote no error: nothing is claimed)
    return (lines[-1] if lines else "It ended early and wrote nothing (exit %s)." % st.get("exit"))[:400]


def failed_line(name, what):
    """The line a card draws for job_failure, and what the page's snackbar reads (data-failed: once for each run)."""
    why = job_failure(name)
    if not why:
        return ""
    st = _job_state(name) or {}
    return ('<div class="state bad" data-failed="%s" data-why="%s"><i></i><span>%s did not run: %s</span></div>'
            % (e("%s %s" % (name, st.get("at", ""))), e("%s did not run: %s" % (what, why)), e(what), e(why)))


def stop_job(name):
    st = job_state(name)
    if not (st and st["running"]):
        return
    # (a run a person stopped did not fail: its card does not say it did)
    try:
        _job_file(name).write_text(json.dumps(dict({k: v for k, v in st.items() if k not in ("running", "adopted")}, stopped=True)))
    except OSError:
        pass
    if st.get("adopted"):
        # (a run started from a shell is in that shell's group, not one of its own: it is told to stop, and so is everything it
        # started, which a group would have told for us. Found before the first signal, while each still names its parent)
        below = _descendants(st["pid"])
        for pid in [st["pid"]] + below:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
    else:
        try:
            os.killpg(st["pid"], signal.SIGTERM)
        except OSError:
            pass
    for _ in range(50):
        time.sleep(0.1)
        _forget()
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
        ended = _ended_words(name, st)
        live["phase"], live["step"] = ended
    return live


def _ended_words(name, st, root=None):
    """WHY A JOB THAT DID NOT SAY SO ENDED, FROM ITS OWN OUTPUT OR NOT AT ALL -> (phase, words). The reason was read from the
    job's log whatever its age, and a step of the whole run writes its output with the run, not there: a Pretrain stopped with
    the run was explained by the last line of a log three days old, about a model the lineup no longer had.
      - a step of the whole run that the run was stopped in: it was stopped, and Run carries on from it;
      - a step of the whole run that ended on its own: the last lines of that step's own output;
      - a job started from its card: its log, where the log was written since the job began; else nothing is quoted."""
    root = Path(root or ARGS.root)
    if st.get("whole"):
        runs = sorted((root / ".work" / "run").glob("*/pass-*/status.txt"), key=lambda f: f.stat().st_mtime) if (root / ".work" / "run").is_dir() else []
        last = runs[-1] if runs else None
        lines = [x for x in (last.read_text(errors="replace").splitlines() if last else []) if x.strip()]
        if lines and lines[-1].endswith(" STOPPED"):
            return "stopped", "Stopped with the run, before it finished. Run carries on from this step."
        step = next((x.split(" START ", 1)[1].strip() for x in reversed(lines) if " START " in x), "")
        try:
            tail = [x for x in (last.parent / (step + ".out")).read_text(errors="replace").splitlines() if x.strip()] if last and step else []
        except OSError:
            tail = []
        return "failed", "It ended before it finished: " + (_why_ended(tail)[:220] if tail else "its step of the run wrote nothing")
    log = root / ".work" / name / "ui-run.log"
    try:
        # (its own log: one written since the job began. An older one is another job's)
        fresh = log.stat().st_mtime >= _job_file(name).stat().st_mtime - 2
        tail = [x for x in log.read_text(errors="replace").splitlines() if x.strip()] if fresh else []
    except OSError:
        tail = []
    return "failed", "It ended before it finished: " + (_why_ended(tail)[:220] if tail else "nothing was written")


def _why_ended(tail):
    """The line of a run's log that says why it stopped. A program that stops on an error it did not catch ends its log with the
    error, where it was raised, and the name of what ran it: the last line read "Node.js v22.23.3" (2026-11-20), which says
    nothing. The error's own line is the one said; the last line where the log holds none."""
    for x in reversed(tail):
        if re.match(r"\s*(\w+\.)*\w*(Error|Exception)\b", x):
            return x.strip()
    return tail[-1]


# (-1: a proof run, each task at the size its benchmark names: training/evaluate.mjs --proof)
EVAL_SIZES = ((20, "20 a task (quick)"), (100, "100 a task"), (0, "every question"), (-1, "a proof run (about 500 a body of work)"))
PROOF_SIZE = -1
# THE HARNESSES A PERSON CHOOSES BETWEEN, by the key a benchmark names its harness with (training/equivalence.json `harness`;
# none named: lm). A harness the page has no name for is shown by its key, so one added to the catalog has its box at once.
HARNESS_NAMES = {"lm": "lm-evaluation-harness", "bfcl": "BFCL (function calling)"}
harness_key = lambda b: str((b or {}).get("harness") or "lm")  # noqa: E731
harness_name = lambda k: HARNESS_NAMES.get(k, k)  # noqa: E731


def harnesses_of(listed):
    """The harnesses the listed bodies of work are measured by, in the order they are first met: [key]."""
    out = []
    for t in listed:
        for b in t.get("benchmarks") or []:
            if harness_key(b) not in out:
                out.append(harness_key(b))
    return out


HARNESS_WORDS = {"lm": "EleutherAI&#39;s lm-evaluation-harness 0.4.13", "bfcl": "for the use of tools, the Berkeley Function-Calling Leaderboard (bfcl-eval 2026.3.23)"}
COMPARE_WORDS = {"answer": "the same answer", "verdict": "the same verdict on the task's tests", "instructions": "the same instructions kept and broken"}
METRIC_WORDS = {"exact_match": "exact match", "pass@1": "pass@1", "pass_at_1": "pass@1", "prompt_level_strict_acc": "strict prompt accuracy", "accuracy": "the test's own checker"}


def _whole(row):
    """THE QUESTIONS OF A TASK ONE SIDE HAS FINISHED, over all its askings: a task asked in two ways (the web search test) starts
    its own count again at the second, and the evaluation says how far it is in all (`whole`). Counted by `done`, the page read
    460 of 460 and then 420."""
    return int((row.get("whole") if row.get("whole") is not None else row.get("done")) or 0)


def _ev_sides(rows):
    """THE MODELS AN EVALUATION ASKS, in the order it asks them: the larger model, the swarm, then each small model of the swarm
    by itself and the same with its reply laid out (training/evaluate.mjs: a row's keys 'alone-a', 'alone-a-form', ...), where
    the run asks them. The card counted the first two only: a run that had finished both read "23 of 23 tasks asked" for an
    hour while the small model was still being asked, and named the larger model as the one answering (console 2026-11-25)."""
    more = sorted({k for r in rows for k, v in r.items() if k.startswith("alone-") and isinstance(v, dict)}, key=lambda k: (k.replace("-form", ""), k.endswith("-form")))
    return ["target", "swarm"] + more


def _ev_who(w, tname, alone=None):
    """What one of them is called: the larger model by its name, the swarm, 'LFM3 1.7B by itself', 'LFM3 1.7B by itself, its
    reply laid out'."""
    if w == "target":
        return tname
    if w == "swarm":
        return "the swarm"
    base = w[:-5] if w.endswith("-form") else w
    name = (alone or {}).get(base) or "a small model"
    return "%s by itself%s" % (name, ", its reply laid out" if w.endswith("-form") else "")


def ev_progress(live):
    """HOW FAR A RUNNING EVALUATION IS, in a line, IN THE HEADLINE'S OWN UNIT: questions. A question is finished once both the
    larger model and the swarm have answered it (answers kept from before count), so the count is the lesser of the two in each
    task; a task is as long as either side says it is (the swarm asks the same questions the larger model was asked, and says so
    only when its turn comes). Said with its share, and only where the whole is known: '' otherwise, a half rounded up as the page's own script rounds it. '' before it has listed its tasks. Counting ANSWERS here read
    691 beside a headline of 460 questions."""
    done = of = 0
    known = True
    rows = live.get("tasks") or []
    sides = _ev_sides(rows)
    # A MODEL THAT HAS NOT HAD ITS TURN IS NOT COUNTED AS HAVING ANSWERED NOTHING (console 2026-11-25). An evaluation that is
    # carried on reads which answers it has kept for a model only when that model's turn comes, so until then every row of it
    # says "waiting": counted, the line read "0 of 460 questions finished · 0%" while the larger model was on its last task
    # and the swarm's answers to every task were kept. The count is of the models that have begun, and says who is to come.
    begun = [w for w in sides if any(w in t and (t.get(w) or {}).get("state") != "waiting" for t in rows)] or sides[:1]
    for t in rows:
        # (of the models that have begun, the ones this task is asked of)
        ss = [t.get(w) or {} for w in begun if w in t or not w.startswith("alone-")]
        done += min(_whole(s) for s in ss)
        n = max([int((t.get(w) or {}).get("of") or 0) for w in sides] or [0])
        if n:
            of += n
        else:
            known = False
    if not rows:
        return ""
    tname = str(live.get("target") or "the larger model")
    later = [_ev_who(w, tname, live.get("alone")) for w in sides if w not in begun]
    # (each small model by itself is listed by the run only when its turn comes: until then it is still to come)
    if "alone" not in live and live.get("phase") not in ("done", "stopped", "failed") and not any(w.startswith("alone-") for w in sides):
        later.append("each small model by itself")
    if not (known and of):
        return ""
    # (said only where the whole is known: a bare count with no total repeats what each task's own line on the card says)
    if not later:
        return "%d of %d questions finished · %d%%" % (done, of, int(100.0 * done / of + 0.5))
    return "%d of %d questions answered by %s · still to come: %s" % (done, of, _and([_ev_who(w, tname, live.get("alone")) for w in begun]), _and(later))


def _ev_bar(row, who, label):
    """One model's progress through one task: a bar, and what it is doing."""
    st = row.get(who) or {}
    done, of = st.get("done") or 0, st.get("of")
    pct = 100.0 * done / of if of else (100.0 if st.get("state") in ("done", "kept") else 0)
    words = {"waiting": "waiting", "asking": "asking %d%s" % (min(done + 1, of or done + 1), (" of %d" % of) if of else ""), "done": "%d asked" % done,
             "kept": "answers kept from before", "failed": "failed: " + (st.get("why") or ""), "stopped": "stopped at %d" % done}.get(st.get("state"), "")
    return ('<div class="evw %s" data-w="%s"><span class="evbar"><i style="width:%.1f%%"></i></span><small><b>%s</b> <span data-ws>%s</span></small></div>'
            % (e(st.get("state") or "waiting"), who, pct, e(label), e(words)))


def _ev_through(rows):
    """HOW FAR A RUN IS THROUGH SOME OF ITS TASKS, as one share: (percent, whether one of them is being asked), or None where none
    of them is asked. In questions, as the headline counts them (ev_progress): one is finished once both models answered it. Where
    a task has not said how many it holds, each task counts alike instead. The page's script says the same as the run goes on (evShare)."""
    ts = [r for r in rows if not all(str((r.get(w) or {}).get("why") or "").startswith("not asked") for w in ("target", "swarm"))]
    if not ts:
        return None
    done = of = 0
    parts = []
    sides = _ev_sides(ts)
    for r in ts:
        ss = [r.get(w) or {} for w in sides if w in r or not w.startswith("alone-")]
        d_, n_ = min(_whole(s) for s in ss), max([int(s.get("of") or 0) for s in ss] or [0])
        done, of = done + d_, of + n_
        parts.append(min(1.0, float(d_) / n_) if n_ else (1.0 if all((s.get("state") in ("done", "kept")) for s in ss) else None))
    pct = 100.0 * done / of if all(x is not None for x in parts) and of else 100.0 * sum(x or 0 for x in parts) / len(parts)
    return min(100.0, pct), any((r.get(w) or {}).get("state") == "asking" for r in ts for w in sides)


def _ev_sum(key, rows):
    """A folded section's one bar: how far the run is through the tasks it holds (console instruction 2026-11-20). '' where the
    run asks none of them."""
    sh = _ev_through(rows)
    if not sh:
        return ""
    return '<span class="evsum%s" data-evp="%s"><span class="evbar"><i style="width:%.1f%%"></i></span></span>' % (" asking" if sh[1] else "", e(key), sh[0])


def _ev_meta_live(rows, tname, alone=None):
    """One body of work while a run is shown, in a line (the page's script says the same as the run goes on, evMeta): how many of its
    tasks each model has been asked, and the task in hand; or why none of it is asked."""
    skipped = lambda r: str((r.get("target") or {}).get("why") or "").startswith("not asked")  # noqa: E731
    if all(skipped(r) for r in rows):
        return str(rows[0]["target"]["why"])
    # (a task that is not asked is not one of those to ask: it is counted at the end)
    left_out = sum(1 for r in rows if skipped(r))
    rows = [r for r in rows if not skipped(r)]

    def who(w):
        # (a model that has no row for a task is not asked it: counted over its own tasks)
        mine = [r for r in rows if w in r] if w.startswith("alone-") else rows
        done = sum(1 for r in mine if (r.get(w) or {}).get("state") in ("done", "kept"))
        a = next((r for r in mine if (r.get(w) or {}).get("state") == "asking"), None)
        return "%d of %d task%s asked%s" % (done, len(mine), "" if len(mine) == 1 else "s",
                                           (", asking %s %d%s" % (a.get("name") or a.get("task"), (a[w].get("done") or 0) + 1, (" of %d" % a[w]["of"]) if a[w].get("of") else "")) if a else "")
    return " · ".join("%s: %s" % (_ev_who(w, tname, alone), who(w)) for w in _ev_sides(rows)) + ((" · %d not asked" % left_out) if left_out else "")


def _ev_right(rs):
    """THE TWO SCORES ON THE SAME QUESTIONS: how many the swarm had right, how many the larger model had right, of how many. Like
    against like: each was put the same benchmark's questions and marked by the benchmark's own checker, and the figure is the
    benchmark's own score for each (its share right times the questions it marked); where a result carries no score, what the
    comparison counted. Only tasks both answered count. -> (the swarm's, the larger model's, of)"""
    sw = tg = of = 0.0
    for r in rs:
        a = r.get("agree")
        if not a:
            continue
        n = a["of"]
        val = lambda x, counted: (float(x["value"]) * n) if x and x.get("value") is not None else counted  # noqa: E731
        sw += val(r.get("swarm"), a["bothRight"] + a["onlySwarm"])
        tg += val(r.get("target"), a["bothRight"] + a["onlyTarget"])
        of += n
    return sw, tg, int(of)


def _ev_share(sw, tg):
    """The swarm's score as a share of the larger model's, in words for a figure: '83%'. Where the larger model had none right
    there is nothing to take a share of: a dash."""
    return ("%s%%" % fmt_pct(data.percent(sw, tg))) if tg else "–"


# (the three views, opened where the lineup configured now has no evaluation of its own: they show another lineup's, chosen there)
EV_VIEWS = ('<span class="evviews" role="group" aria-label="See the evaluations of other lineups"><button type="button" class="btn top ghost" data-evd-view="table" title="The evaluations of other lineups: every body of work and task">Each task</button>'
            '<button type="button" class="btn top ghost" data-evd-view="paper" title="The evaluations of other lineups, as a paper sets results out">Paper table</button>'
            '<button type="button" class="btn top ghost" data-evd-view="chart" title="The evaluated lineups, score against memory">Chart</button></span>')


def lineup_of(d, key):
    """ANOTHER LINEUP, AS THE VIEWS OF AN EVALUATION NEED IT: from a configuration's key (its small models in their places, its
    decider, and the larger model), the same as `d` with that lineup's models, key and memory. None where a model it names is
    no longer in the catalog."""
    reg = d.get("registry") or {}
    left, _, tgt = str(key).rpartition("--")
    ids = left.split("+")
    small = {m["id"]: m for m in reg.get("small", [])}
    dec = next((m for m in reg.get("deciders", []) if m["id"] == ids[-1]), None)
    target = next((m for m in reg.get("targets", []) if m["id"] == tgt), None)
    if not ids[:-1] or not all(i in small for i in ids[:-1]) or not dec or not target:
        return None
    members = {k: dict(small[i], key=k) for k, i in zip("abcd", ids[:-1])}
    no_dec = (dec.get("serve") or {}).get("kind") == "none"
    return dict(d, key=key, members=members, decider=dec, target=target, footprint=data.footprint(members, None if no_dec else dec, target))


DEFAULT_MARK = "@default"  # (after a configuration's key: its evaluation of the arrangement it started from)


def lineup_name(d2):
    """A lineup in a few words: its small models, and its decision model where it has one; and which arrangement of it, where
    the views hold both the one it started from and the one training kept."""
    ms = [m["name"] for m in (d2.get("members") or {}).values() if m]
    same = len(set(ms)) == 1 and len(ms) > 1
    dec = d2.get("decider") or {}
    return ((("%s, %d of it" % (ms[0], len(ms))) if same else " + ".join(ms))
            + ("" if (dec.get("serve") or {}).get("kind") == "none" else ", decided by %s" % dec.get("name", "a decision model"))
            + str(d2.get("arrLabel") or ""))


def evaluated_lineups(d):
    """EVERY LINEUP THAT HAS AN EVALUATION AGAINST THIS LARGER MODEL, newest first: [(key, its `d`, its newest evaluation)]. The
    views of an evaluation can show any of them, and the chart sets them beside each other."""
    tgt = "--" + str((d.get("target") or {}).get("id", ""))
    newest, started = {}, {}
    for r in _eval_rows(Path(ARGS.root)):
        k = str(r.get("configuration", ""))
        if not k.endswith(tgt):
            continue
        if k not in newest or str(r.get("at", "")) > str(newest[k].get("at", "")):
            newest[k] = r
        # (and its newest evaluation of the arrangement it started from, to set beside what training kept)
        if r.get("arrangement") == "default" and (k not in started or str(r.get("at", "")) > str(started[k].get("at", ""))):
            started[k] = r
    out = []
    for k, r in sorted(newest.items(), key=lambda x: str(x[1].get("at", "")), reverse=True):
        d2 = d if k == d.get("key") else lineup_of(d, k)
        if not d2:
            continue
        both = r.get("arrangement") == "trained" and k in started
        out.append((k, dict(d2, arrLabel=", trained") if both else d2, r))
        if both:
            # TRAINED BESIDE DEFAULT: the same lineup as it started, a line and a point of its own in every view
            out.append((k + DEFAULT_MARK, dict(d2, arrLabel=", default arrangement", key=k + DEFAULT_MARK), started[k]))
    return out


def not_evaluated(d, other):
    """What a view says of a lineup that has no evaluation: which lineup, that it has none, and where to go from there."""
    return ('<p class="muted"><b>%s</b> is the lineup configured now, and it has not been evaluated yet. Press <b>Evaluate</b> to evaluate it%s.</p>'
            % (e(lineup_name(d)), ", or choose another lineup above to see its evaluation" if other else ""))


def view_of(d, cfg=None):
    """WHICH LINEUP'S EVALUATION A VIEW SHOWS: the one asked for (cfg, a configuration's key), else THE LINEUP CONFIGURED NOW,
    evaluated or not (console 2026-11-24: a view opens on what is configured and says its state; it opened on the lineup
    evaluated most lately where the configured one had no evaluation, which read as that lineup's being configured).
    -> (its `d`, its view as eval_view gives one, the box that chooses between them: '' where there is one or none)"""
    every = evaluated_lineups(d)
    mine = eval_view(Path(ARGS.root), d)
    pick = next((x for x in every if x[0] == cfg), None) if cfg else None
    if pick and pick[0] != d.get("key"):
        res = pick[2]
        view = {"res": res, "any": res, "by_task": {x["task"]: dict(x) for x in res.get("results", [])}, "short": [], "base": res, "carried": 0}
        d_ = pick[1]
    else:
        view, d_ = mine, d
    opts = [(d.get("key"), "This lineup: %s%s" % (lineup_name(d), "" if mine["res"] else " (not evaluated yet)"))] + [
        (k, "%s · evaluated %s" % (lineup_name(d2), _day(r.get("at")))) for k, d2, r in every if k != d.get("key")]
    box = ('<div class="evbench"><span class="cfgl">Evaluation of</span><select id="evd-cfg" aria-label="Which lineup&#39;s evaluation the table shows">%s</select></div>'
           % "".join('<option value="%s"%s>%s</option>' % (e(k), " selected" if k == d_.get("key") else "", e(n)) for k, n in opts)) if len(opts) > 1 else ""
    return d_, view, box


def eval_table(d, only=None, cfg=None):
    """EVERY BODY OF WORK AND TASK, SCORE BESIDE SCORE (opened from the Evaluate card's headline): the swarm's score, the larger
    model's on the same questions, the swarm's as a share of it, and how many questions. A body of work's line sums its tasks;
    the last line is the headline's own figures. Where there is an evaluation before this one (eval_view), SHARE BEFORE: what
    Pretrain or training bought, line by line. A task this evaluation did not ask again shows the earlier figures, marked."""
    d, view, lineups = view_of(d, cfg)
    res = view["res"]
    tname = res.get("target") or (d.get("target") or {}).get("name", "the larger model")
    by_task = view["by_task"]
    every = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
    # BY HARNESS (only: the harnesses ticked in the table itself): the tasks of those harnesses and no others, a body of work
    # with none of them left out, and every line summed again over what is shown, the last line with it. The boxes are the
    # harnesses the bodies of work are measured by; one that is not known, or none ticked, shows every one
    hs_all = harnesses_of(every)
    hs = [h for h in hs_all if h in (only or hs_all)] or hs_all
    listed = [dict(t, benchmarks=[b for b in t["benchmarks"] if harness_key(b) in hs]) for t in every]
    listed = [t for t in listed if t["benchmarks"]]
    close = '<button class="btn stop top" id="evd-close" type="button">Close</button>'
    head = '<div class="spec-head"><div><div class="kicker">Evaluate the swarm</div><h3 style="font-size:22px;margin-top:4px">The swarm against %s</h3></div>%s</div>' % (e(tname), close)
    have = lambda task: by_task[task] if (by_task.get(task) or {}).get("agree") else None  # noqa: E731
    done = [have(b["task"]) for t in listed for b in t["benchmarks"] if have(b["task"])]
    boxes = ('<div class="evask evharn evd-h" role="group" aria-label="Which harnesses the table shows"><span class="cfgl">Showing</span>%s</div>'
             % "".join('<label><input type="checkbox" data-evd-harness="%s"%s>%s</label>' % (e(k), " checked" if k in hs else "", e(harness_name(k))) for k in hs_all)) if len(hs_all) > 1 else ""
    boxes = lineups + boxes + ev_speed(res, tname, hs)
    if not done:
        return head + boxes + (('<p class="muted">Nothing of %s has been evaluated yet for the swarm as it is now.</p>' % e(_and([harness_name(k) for k in hs]))) if len(hs) < len(hs_all) and res else not_evaluated(d, bool(lineups)))
    was = any(r.get("before") for r in done)
    old = any(r.get("carried") for r in done)

    # EACH SMALL MODEL BY ITSELF, a column each, before the swarm's: where the evaluation asked them so. A line where one of them
    # did not answer every task shows a dash for it
    alone = alone_keys(done)

    def cells(rs):
        sw, tg, of = _ev_right(rs)
        if not of:
            return '<td class="num muted" colspan="%d">not evaluated</td>' % ((5 if was else 4) + len(alone))
        mine = {k for k, _ in alone_keys(rs)}
        solo = "".join('<td class="num evm">%s</td>' % (("%s%%" % fmt_pct(alone_score(rs, k)[0])) if k in mine else "–") for k, _ in alone)
        # BEFORE: where every task of the line was asked again and has a figure from before; the last line, every task, with a
        # task not asked again counted as it stands (it has not moved)
        befs = [r.get("before") or (r if r.get("carried") else None) for r in rs]
        b = ""
        if was:
            if all(befs) and any(r.get("before") for r in rs):
                bs, bt, _ = _ev_right(befs)
                now_s, was_s = data.percent(sw, tg) if tg else None, data.percent(bs, bt) if bt else None
                moved = "" if now_s is None or was_s is None or now_s == was_s else ' <i class="%s">%s</i>' % ("up" if now_s > was_s else "down", "up" if now_s > was_s else "down")
                b = '<td class="num">%s%s</td>' % (_ev_share(bs, bt), moved)
            else:
                # (a line not asked again has no before: a dash, its title saying so; the line is grey and the note above the table says why)
                b = '<td class="num muted"%s</td>' % (' title="Not asked again">–' if all(r.get("carried") for r in rs) else ">")
        return (solo + '<td class="num">%s%%</td><td class="num">%s%%</td><td class="num"><b class="%s">%s</b></td>%s<td class="num evn">%d</td>'
                % (fmt_pct(data.percent(sw, of)), fmt_pct(data.percent(tg, of)), "up" if sw >= tg else "down", _ev_share(sw, tg), b, of))

    rows = []
    unread_any = False
    starved_any = False
    for t in listed:
        rs = [have(b["task"]) for b in t["benchmarks"] if have(b["task"])]
        rows.append('<tr class="evt-item%s"><th scope="row">%s</th>%s</tr>' % (" evt-old" if rs and all(r.get("carried") for r in rs) else "", e(t["name"]), cells(rs)))
        for b in t["benchmarks"]:
            r = have(b["task"])
            u = (r or {}).get("unread") or {}
            n = ((r or {}).get("agree") or {}).get("of") or 0
            # (a task where a quarter or more of one model's replies were not read: marked, since its scores compare the reading)
            # (the mark says in how many: "no answer found" beside a score of 40% read as none found at all, console 2026-11-20.
            # The swarm's count where it is a quarter or more; the larger model's, named, where only its own is)
            us, ut = u.get("swarm") or 0, u.get("target") or 0
            mark = (' <b class="evt-unread" title="The harness found no answer in %s of the swarm&#39;s replies and %s of the larger model&#39;s, of %d. Each such reply is marked wrong; the score is of all %d">%s</b>'
                    % (us, ut, n, n, ("no answer in %d of %d" % (us, n)) if us * 4 >= n else ("larger model: no answer in %d of %d" % (ut, n)))) if n and max(us, ut) * 4 >= n else ""
            # (and the small model asked by itself: where a quarter or more of ITS replies were not read, its figure beside
            # the swarm's is of how it laid its reply out, and is said so)
            ua = u.get("alone") or 0
            if n and ua * 4 >= n:
                mark += (' <b class="evt-unread" title="Asked by itself, the small model gave %d of %d replies the harness found no answer in. Each is marked wrong: its score here says how it laid its reply out more than what it knew">by itself: no answer in %d of %d</b>'
                         % (ua, n, ua, n))
            unread_any = unread_any or bool(mark)
            # (a search task where a quarter or more of one model's searches came back with nothing: marked, since what it scored
            # then is the search engines more than the model. The two are not served alike on such a day)
            se = (r or {}).get("searches") or {}
            starved = [(w, x) for w, x in (("the swarm", se.get("swarm")), (tname, se.get("target"))) if x and x.get("asked") and x.get("empty", 0) * 4 >= x["asked"]]
            if starved:
                mark += (' <b class="evt-unread" title="Searches that came back with nothing: %s">searches failed</b>'
                         % e("; ".join("%s %d of %d" % (w, x["empty"], x["asked"]) for w, x in (("the swarm", se.get("swarm")), (tname, se.get("target"))) if x)))
                starved_any = True
            rows.append('<tr class="evt-task%s"><td>%s%s</td>%s</tr>' % (" evt-old" if r and r.get("carried") else "", e(b.get("name") or b["task"]), mark, cells([r] if r else [])))
    rows.append('<tr class="evt-all"><th scope="row">%s</th>%s</tr>' % ("Every question" if len(hs) == len(hs_all) else "Every question of %s" % e(_and([harness_name(k) for k in hs])), cells(done)))
    when = (" Evaluated %s UTC." % e(_day(res.get("at")))) if res.get("at") else ""
    notes = ""
    if was:
        notes += " Before is that figure for the same line in the evaluation of this configuration before it."
    if old:
        notes += " A line in grey was not asked again this time: its figures are the earlier evaluation&#39;s."
    if starved_any:
        notes += " A task marked searches failed is one where a quarter or more of one model&#39;s searches came back with nothing, because the search engines refused: its scores say more of the engines that day than of either model, and the two were not served alike."
    if unread_any:
        notes += " A task marked no answer in some of its replies is one where the harness found no answer in a quarter or more of one model&#39;s replies. Each such reply is marked wrong and the score is still of every question, so it says how replies were written more than what either model knew."
    return (head + boxes + '<p class="small muted" style="margin:10px 0 0">Each was put the same questions and marked by the benchmark&#39;s own checker. Swarm → target is the swarm&#39;s score as a share of %s&#39;s: '
            '100%% or more is where the swarm is level or ahead.%s%s%s</p>' % (e(tname), when, notes, (" Each small model of the swarm is also shown by itself: asked the same questions once, with no orchestration." + laid_note(done)) if alone else "")
            + '<div class="evt-wrap"><table class="spec evt%s"><thead><tr><th>Body of work</th>%s<th class="num">The swarm</th><th class="num evtg">%s</th><th class="num">Swarm → target</th>%s<th class="num evn">Questions</th></tr></thead>'
            '<tbody>%s</tbody></table></div>' % (" evt-m" if alone else "", "".join('<th class="num evm">%s alone</th>' % e(n_) for _, n_ in alone), e(tname), '<th class="num">Before</th>' if was else "", "".join(rows)))


def ev_speed(res, tname, hs=None):
    """HOW LONG EACH SIDE TOOK, in a line over a view of an evaluation: the seconds a question of the swarm and of the larger
    model, as a mean over the tasks both were timed on (evaluate.mjs keeps each side's seconds with its answers), and how many
    times as long the swarm takes. '' where no task has both: an evaluation from before this was kept says nothing of it."""
    both = [r["secondsEach"] for r in (res.get("results") or [])
            if (r.get("secondsEach") or {}).get("target") and (r.get("secondsEach") or {}).get("swarm") and (not hs or harness_key(r) in hs)]
    if not both:
        return ""
    sw = sum(x["swarm"] for x in both) / len(both)
    tg = sum(x["target"] for x in both) / len(both)
    ratio = sw / tg if tg else 0
    than = ("the swarm takes %s times as long" % ("%.1f" % ratio).rstrip("0").rstrip(".")) if ratio >= 1.15 else ("the swarm is %s times as fast" % ("%.1f" % (1 / ratio)).rstrip("0").rstrip(".")) if 0 < ratio <= 0.87 else "about the same"
    return ('<p class="evspeed"><span class="cfgl">Seconds a question</span>the swarm <b>%.1f</b> · %s <b>%.1f</b> <span class="muted">· %s, over the %d task%s both were timed on</span></p>'
            % (sw, e(tname), tg, than, len(both), "" if len(both) == 1 else "s"))


def _eval_scope(d, only=None, cfg=None):
    """What a view of the evaluation's results is drawn from (as eval_table reads it): the bodies of work shown, each task's
    result or None, the larger model's name, the dialog's heading and the harness boxes."""
    d, view, lineups = view_of(d, cfg)
    res = view["res"]
    tname = res.get("target") or (d.get("target") or {}).get("name", "the larger model")
    every = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
    hs_all = harnesses_of(every)
    hs = [h for h in hs_all if h in (only or hs_all)] or hs_all
    listed = [dict(t, benchmarks=[b for b in t["benchmarks"] if harness_key(b) in hs]) for t in every]
    listed = [t for t in listed if t["benchmarks"]]
    by_task = view["by_task"]
    have = lambda task: by_task[task] if (by_task.get(task) or {}).get("agree") else None  # noqa: E731
    head = ('<div class="spec-head"><div><div class="kicker">Evaluate the swarm</div><h3 style="font-size:22px;margin-top:4px">The swarm against %s</h3></div>'
            '<button class="btn stop top" id="evd-close" type="button">Close</button></div>' % e(tname))
    boxes = ('<div class="evask evharn evd-h" role="group" aria-label="Which harnesses are shown"><span class="cfgl">Showing</span>%s</div>'
             % "".join('<label><input type="checkbox" data-evd-harness="%s"%s>%s</label>' % (e(k), " checked" if k in hs else "", e(harness_name(k))) for k in hs_all)) if len(hs_all) > 1 else ""
    # (how long each side took, under the boxes of every view: a score beside a larger model's says little without it)
    speed = ev_speed(res, tname, hs)
    return {"res": res, "tname": tname, "listed": listed, "have": have, "head": head, "boxes": lineups + boxes + speed, "harness": boxes + speed, "hs": hs, "hs_all": hs_all, "d": d}


def bench_groups(listed):
    """THE BENCHMARKS AS THEY ARE KNOWN OUTSIDE THIS PROJECT, from the tasks listed: [(key, name, [task, ...])] in the order they
    first appear. Tasks whose names begin with the same word are one benchmark's parts (BBH's tasks, BFCL's categories) where
    two or more begin so; any other task is a benchmark by itself (HumanEval, GSM8K). The bodies of work are this project's
    own grouping, for training; these are the names a result is reported under."""
    bs = [b for t in listed for b in t["benchmarks"]]
    first = lambda b: str(b.get("name") or b["task"]).split(" ")[0]  # noqa: E731
    many = {w for w in {first(b) for b in bs} if sum(1 for b in bs if first(b) == w) > 1}
    out = []
    for b in bs:
        name = first(b) if first(b) in many else str(b.get("name") or b["task"])
        key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        row = next((g for g in out if g[0] == key), None)
        if not row:
            row = (key, name, [])
            out.append(row)
        row[2].append(b["task"])
    return out


def proof_sized(r):
    """Whether a task's result rests on enough questions to be cited: a hundred or more, or every question the task has
    (docs/swoa-parity.md: never fewer than a hundred of one task). A quick look at twenty a task is not."""
    n = int(((r or {}).get("agree") or {}).get("of") or 0)
    whole = int(((r or {}).get("swarm") or {}).get("of") or 0)
    return n >= 100 or (whole and n >= whole)


def _ev_mean(rs):
    """A benchmark of several tasks as it is usually reported: the mean of its tasks' scores, each task counting alike.
    -> (the swarm's, the larger model's, questions in all), in points"""
    figs = []
    for r in rs:
        a = r["agree"]
        figs.append((_ev_figure(r.get("swarm"), a, a["bothRight"] + a["onlySwarm"]), _ev_figure(r.get("target"), a, a["bothRight"] + a["onlyTarget"])))
    return sum(f[0][0] for f in figs) / len(figs), sum(f[1][0] for f in figs) / len(figs), sum(f[0][2] for f in figs)


LAID = "~laid"
LAID_NOTE = (" &quot;(laid out)&quot; is the same model with the module&#39;s layout code on its one reply and nothing else (no empty line where the "
             "task&#39;s examples have none, the question not said again): what is left between it and the swarm is what the arrangement adds. "
             "A test of calling tools has no layout, so its plain figure stands there.")


def _laid_out(rs):
    """Beside each small model by itself, the same model with its reply laid out (training/evaluate.mjs formOnly: aloneForm in a
    task's result), as one more model of the same place, so that every view shows it as it shows the other. A test of calling
    tools has no layout to mend: the plain figure stands for it there. Nothing is added where no task was asked so."""
    if not any((r or {}).get("aloneForm") for r in rs):
        return
    for r in rs:
        al = (r or {}).get("alone")
        if not al:
            continue
        for k in [k for k in al if not k.endswith(LAID)]:
            src = (r.get("aloneForm") or {}).get(k) or (al[k] if harness_key(r) == "bfcl" else None)
            if src and k + LAID not in al:
                al[k + LAID] = dict(src, name="%s (laid out)" % (src.get("name") or al[k].get("name") or k))


def laid_note(rs):
    return LAID_NOTE if any(k.endswith(LAID) for k, _ in alone_keys(rs)) else ""


def alone_keys(rs):
    """The small models that answered every one of these tasks by themselves: [(key, name)] in the swarm's order of places.
    One that answered some and not others is left out: its score over them would be of other questions than the swarm's."""
    _laid_out(rs)
    keys = None
    names = {}
    for r in rs:
        got = (r or {}).get("alone") or {}
        ok = {k for k, v in got.items() if v and v.get("value") is not None}
        names.update({k: v.get("name", k) for k, v in got.items()})
        keys = ok if keys is None else keys & ok
    return [(k, names[k]) for k in sorted(keys or [])]


def alone_score(rs, key, mean=False):
    """One small model by itself over these tasks, in points: every question counting alike, or (mean) every task. And its
    error: (score, error, questions)."""
    figs = [_ev_figure(r["alone"][key], r["agree"], 0) for r in rs]
    n = sum(f[2] for f in figs)
    if not figs or not n:
        return 0.0, 0.0, 0
    p = (sum(f[0] for f in figs) / len(figs)) if mean else sum(f[0] * f[2] for f in figs) / n
    return p, (p * (100 - p) / n) ** 0.5, n


def _ev_figure(side, a, counted):
    """One model's score on one task and its standard error, in points: (score, error, questions). The harness's own error where
    it gave one; otherwise the error of a share of that many questions."""
    n = int(a.get("of") or 0)
    p = float(side["value"]) if side and side.get("value") is not None else (float(counted) / n if n else 0.0)
    se = float(side["stderr"]) if side and side.get("stderr") is not None else ((p * (1 - p) / n) ** 0.5 if n else 0.0)
    return 100 * p, 100 * se, n


def eval_paper(d, only=None, cfg=None):
    """THE RESULTS AS A PAPER SETS THEM OUT: each benchmark by its own name, grouped by body of work, the models side by side
    (each small model of the swarm by itself where it was evaluated so, then the swarm, then the larger model), each score
    with its standard error, the highest in bold, the questions asked, each benchmark of several tasks as the mean of its
    tasks, and a last line over every question. The caption says what is compared, how it was marked and when. The same
    table as LaTeX is copied by a button."""
    sc = _eval_scope(d, only, cfg)
    home, d = d, sc["d"]
    res, tname, have = sc["res"], sc["tname"], sc["have"]
    rows = [(t, [(b, have(b["task"])) for b in t["benchmarks"] if have(b["task"])]) for t in sc["listed"]]
    rows = [(t, bs) for t, bs in rows if bs]
    if not rows:
        return sc["head"] + sc["boxes"] + not_evaluated(d, 'id="evd-cfg"' in sc["boxes"])
    every = [r for _, bs in rows for _, r in bs]
    alone = alone_keys(every)
    cols = len(alone) + 5
    fp = d.get("footprint") or {}
    members = _and([m["name"] for m in (d.get("members") or {}).values() if m])
    num = lambda x, se, bold: ("<b>%.1f</b>" if bold else "%.1f") % x + ((" <small>± %.1f</small>" % se) if se is not None else "")  # noqa: E731
    texn = lambda x, se, bold: ("\\textbf{%.1f}" if bold else "%.1f") % x + ((" {\\scriptsize $\\pm$ %.1f}" % se) if se is not None else "")  # noqa: E731

    def line(label, n, figs, sw, tg, tex_label=None):
        # (figs: [(score, error or None)] for each model alone, then the swarm, then the larger model; the highest is in bold)
        top = max(f[0] for f in figs)
        bold = [f[0] == top and sum(1 for g in figs if g[0] == top) == 1 for f in figs]
        html = '<td>%s</td><td>%d</td>%s<td>%+.1f</td>' % (label, n, "".join("<td>%s</td>" % num(f[0], f[1], b) for f, b in zip(figs, bold)), sw - tg)
        tex = "%s & %d & %s & %+.1f \\\\" % (tex_label or label, n, " & ".join(texn(f[0], f[1], b) for f, b in zip(figs, bold)), sw - tg)
        return html, tex

    out, lat = [], []
    tot = [0.0, 0.0, 0]
    for t, bs in rows:
        out.append('<tr class="pg"><td colspan="%d">%s</td></tr>' % (cols, e(t["name"])))
        lat.append("\\multicolumn{%d}{l}{\\textit{%s}} \\\\" % (cols, t["name"]))
        for b, r in bs:
            a = r["agree"]
            sw, sw_se, n = _ev_figure(r.get("swarm"), a, a["bothRight"] + a["onlySwarm"])
            tg, tg_se, _ = _ev_figure(r.get("target"), a, a["bothRight"] + a["onlyTarget"])
            tot[0] += sw * n / 100
            tot[1] += tg * n / 100
            tot[2] += n
            name = b.get("name") or b["task"]
            figs = [_ev_figure(r["alone"][k], a, 0)[:2] for k, _ in alone] + [(sw, sw_se), (tg, tg_se)]
            h, x = line("&nbsp;&nbsp;" + e(name), n, figs, sw, tg, "\\quad " + name.replace("&", "\\&"))
            out.append("<tr>%s</tr>" % h)
            lat.append(x)
    # EACH BENCHMARK OF SEVERAL TASKS, AS IT IS USUALLY REPORTED: the mean of its tasks (BBH, BFCL), each task counting alike.
    # The bodies of work above are this project's grouping; a reader from outside looks for these lines
    means = []
    for key, name, tasks in bench_groups(sc["listed"]):
        rs_ = [have(tk) for tk in tasks if have(tk)]
        if len(tasks) > 1 and rs_:
            means.append((name, rs_, len(tasks)))
    if means:
        out.append('<tr class="pg"><td colspan="%d">By benchmark, the mean of its tasks</td></tr>' % cols)
        lat.append("\\midrule\n\\multicolumn{%d}{l}{\\textit{By benchmark, the mean of its tasks}} \\\\" % cols)
        for name, rs_, of_k in means:
            msw, mtg, mn = _ev_mean(rs_)
            label = "%s (%d task%s%s)" % (name, len(rs_), "" if len(rs_) == 1 else "s", "" if len(rs_) == of_k else " of %d" % of_k)
            figs = [(alone_score(rs_, k, mean=True)[0], None) for k, _ in alone] + [(msw, None), (mtg, None)]
            h, x = line("&nbsp;&nbsp;" + e(label), mn, figs, msw, mtg, "\\quad " + label)
            out.append("<tr>%s</tr>" % h)
            lat.append(x)
    n = tot[2]
    sw, tg = 100 * tot[0] / n, 100 * tot[1] / n
    se = lambda p: (p * (100 - p) / n) ** 0.5  # noqa: E731
    figs = [alone_score(every, k)[:2] for k, _ in alone] + [(sw, se(sw)), (tg, se(tg))]
    h, x = line("All questions", n, figs, sw, tg)
    out.append('<tr class="pall">%s</tr>' % h)
    lat.append("\\midrule\n" + x)
    mem = (" (%s GB in memory)" % fmt_pct(fp["swarm"])) if fp.get("swarm") else ""
    tmem = (" (%s GB)" % fmt_pct(fp["target"])) if fp.get("target") else ""
    cap = ("Accuracy (%%) of the swarm of %s%s and of %s%s on the same questions, each marked by its benchmark&#39;s own checker (%s).%s ± is one standard error. "
           "<i>n</i> is the questions asked of each; Δ is the swarm&#39;s score less the larger model&#39;s, in points; the highest score is in bold. Evaluated %s UTC.%s"
           % (e(members), mem, e(tname), tmem, e("; ".join(x for x in [res.get("harness", "")] if x) or "its harness"),
              ((" Each small model is also shown by itself, asked the same questions once, with no orchestration." + laid_note(every)) if alone else ""), e(_day(res.get("at"))),
              # (a quick look is said to be one: a line that rests on fewer than a hundred questions, and not the whole task, is not a result to cite)
              "" if all(proof_sized(r) for r in every) else " A line of fewer than 100 questions that is not the whole task is a quick look, not a result to cite: a proof run asks more."))
    plain = re.sub(r"<[^>]+>", "", cap).replace("&#39;", "'").replace("%", "\\%").replace("±", "$\\pm$").replace("Δ", "$\\Delta$").replace("&", "\\&")
    heads = [name + " alone" for _, name in alone] + ["The swarm", tname]
    latex = ("\\begin{table}[t]\n\\centering\n\\caption{%s}\n\\begin{tabular}{l%s}\n\\toprule\nBenchmark & $n$ & %s & $\\Delta$ \\\\\n\\midrule\n%s\n\\bottomrule\n\\end{tabular}\n\\end{table}"
             % (plain, "r" * (cols - 1), " & ".join(heads), "\n".join(lat)))
    return (sc["head"] + sc["boxes"]
            + '<div class="ptab-wrap"><div class="ptab"><table><caption><b>Table 1.</b> %s</caption><thead><tr><th>Benchmark</th><th><i>n</i></th>%s<th>Δ</th></tr></thead><tbody>%s</tbody></table></div></div>'
            % (cap, "".join("<th>%s</th>" % e(x) for x in heads), "".join(out))
            + '<div class="ptab-act"><button type="button" class="btn top ghost" id="evd-copy">Copy as LaTeX</button><small class="muted">The same table, for a paper (booktabs).</small></div>'
            + '<textarea id="evd-latex" hidden readonly>%s</textarea>' % e(latex))


def eval_chart(d, only=None, bench=None, cfg=None):
    """SCORE AGAINST MEMORY, EVERY LINEUP AT ONCE: each lineup evaluated against this larger model is a point, what it scored
    against the memory it holds while it serves; the larger model is one; and each small model of the lineup configured now
    by itself, where an evaluation asked it so. The lineup configured now is marked out. Every point is a number, and the
    list under the chart says which is which, with its figures and how many questions they rest on (console instruction
    2026-11-21: all the data, a full list, the configured lineup marked; a box to choose one lineup was not understood).
    A lineup asked fewer or other tasks than the fullest is drawn hollow: its score is of other questions."""
    import math
    sc = _eval_scope(d, only, None)
    every_t = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
    listed = sc["listed"]
    tname = (d.get("target") or {}).get("name", "the larger model")
    lineups = evaluated_lineups(d)
    got_of = {k: {x["task"]: x for x in r.get("results", []) if x.get("agree")} for k, _, r in lineups}
    groups = bench_groups(listed)
    cur = next((g for g in groups if g[0] == bench), None)
    wanted = cur[2] if cur else [b["task"] for t in listed for b in t["benchmarks"]]
    rows_of = lambda k, tasks=None: [got_of[k][t] for t in (tasks if tasks is not None else wanted) if t in got_of[k]]  # noqa: E731
    anyone = lambda tasks: [r for k in got_of for r in rows_of(k, tasks)]  # noqa: E731
    # WHAT THE SCORES ARE OF, one at a time: every question shown (this project's own mix: no one else reports it), or one
    # benchmark by the name it is known by outside, the mean of its tasks where it has several
    seg = lambda key, label, sel, rs: ('<button type="button" class="seg%s" data-evd-bench="%s" aria-pressed="%s"%s>%s%s</button>'  # noqa: E731
                                       % (" on" if sel else "", e(key), "true" if sel else "false", "" if rs else ' disabled title="Not evaluated yet"', e(label),
                                          "" if not rs or all(proof_sized(r) for r in rs) else ' <small title="Fewer than 100 questions of a task: a quick look">quick</small>'))
    pick = ('<div class="evbench"><span class="cfgl">Scores of</span><div class="tgl" role="group" aria-label="What the scores are of">%s%s</div></div>'
            % (seg("", "All questions", not cur, anyone([b["task"] for t in listed for b in t["benchmarks"]])), "".join(seg(g[0], g[1], cur is g, anyone(g[2])) for g in groups))) if groups else ""
    head = sc["head"] + sc["harness"] + pick
    mean = bool(cur and len(cur[2]) > 1)

    def figure(rs, who):
        # (a benchmark of several tasks: the mean of its tasks, as it is reported; otherwise every question counting alike)
        sw, tg, of = _ev_right(rs)
        if mean and len(rs) > 1:
            m = _ev_mean(rs)
            return (m[0] if who == "swarm" else m[1]), m[2]
        return (100.0 * (sw if who == "swarm" else tg) / of if of else 0.0), of

    mine = d.get("key")
    shown = [(k, d2, rows_of(k)) for k, d2, _ in lineups if rows_of(k) and (d2.get("footprint") or {}).get("swarm")]
    if not shown:
        return head + '<p class="muted">%s</p>' % ("No lineup has been evaluated %s." % (("on %s yet" % e(cur[1])) if cur else "yet"))
    # THE FULLEST: the lineup asked the most questions of what is shown (the configured one where it is among them). The larger
    # model's point is its score on those questions, and a lineup asked the same tasks at the same sizes is the same measure
    sig = lambda rs: tuple(sorted((r["task"], r["agree"]["of"]) for r in rs))  # noqa: E731
    most_q = max(sum(r["agree"]["of"] for r in rs) for _, _, rs in shown)
    full = next((x for x in shown if x[0] == mine and sum(r["agree"]["of"] for r in x[2]) == most_q), None) or next(x for x in shown if sum(r["agree"]["of"] for r in x[2]) == most_q)
    palette = ["#8a9a97", "#a98467", "#6d8fb3", "#9a7fb5", "#7fa37a", "#b58a8a", "#b0a15c", "#5f9ea0"]
    pts = []
    tg_pc, tg_of = figure(full[2], "target")
    tgb = float((full[1].get("footprint") or {}).get("target") or 0)
    if tgb:
        pts.append({"name": tname, "gb": tgb, "pc": tg_pc, "col": "var(--tgt)", "of": tg_of, "tasks": len(full[2]), "same": True, "note": "the larger model, configured now", "target": True})
    n_other = 0
    for k, d2, rs in shown:
        pc, of = figure(rs, "swarm")
        here = k == mine
        if not here:
            n_other += 1
        pts.append({"name": lineup_name(d2), "gb": float(d2["footprint"]["swarm"]), "pc": pc, "col": "var(--teal2)" if here else palette[(n_other - 1) % len(palette)],
                    "of": of, "tasks": len(rs), "same": sig(rs) == sig(full[2]), "mine": here, "note": "configured now" if here else ""})
    # EACH SMALL MODEL BY ITSELF, of the lineup configured now (or, where that has no evaluation, of the fullest): where an
    # evaluation asked it every task shown. Beside its lineup's point, this is what the orchestration adds, or does not
    solo_of = next((x for x in shown if x[0] == mine), full)
    fp = solo_of[1].get("footprint") or {}
    parts = {x.get("place"): x for x in fp.get("parts") or [] if x.get("kind") == "model"}
    ctx = sum(float(x.get("gb") or 0) for x in fp.get("parts") or [] if x.get("kind") == "contexts")
    shades = ["#0e6b62", "#c98a06", "#7b5ea7", "#b5533c"]
    alone_pts = []
    for i, (k, name) in enumerate(alone_keys(solo_of[2])):
        if k.replace(LAID, "") in parts:
            sc_ = alone_score(solo_of[2], k, mean=mean and len(solo_of[2]) > 1)
            alone_pts.append({"name": name + " by itself", "gb": float(parts[k.replace(LAID, "")]["gb"]) + ctx / max(1, len(parts)), "pc": sc_[0], "col": shades[i % len(shades)],
                              "of": sc_[2], "tasks": len(solo_of[2]), "same": sig(solo_of[2]) == sig(full[2]), "note": "one model of %s, with no orchestration" % lineup_name(solo_of[1])})
    pts += alone_pts
    lo = 2 ** math.floor(math.log2(min(p["gb"] for p in pts) / 1.4))
    hi = 2 ** math.ceil(math.log2(max(p["gb"] for p in pts) * 1.4))
    W, H, L, R, T, B = 680, 380, 56, 28, 18, 50
    X = lambda gb: L + (W - L - R) * (math.log2(gb) - math.log2(lo)) / (math.log2(hi) - math.log2(lo))  # noqa: E731
    Y = lambda pc: T + (H - T - B) * (1 - pc / 100.0)  # noqa: E731
    g = []
    for pc in (0, 20, 40, 60, 80, 100):
        g.append('<line class="ax" x1="%d" x2="%d" y1="%.1f" y2="%.1f"/><text class="tk" x="%d" y="%.1f" text-anchor="end">%d%%</text>' % (L, W - R, Y(pc), Y(pc), L - 8, Y(pc) + 4, pc))
    gb = lo
    while gb <= hi:
        g.append('<text class="tk" x="%.1f" y="%d" text-anchor="middle">%s GB</text>' % (X(gb), H - B + 18, ("%g" % gb)))
        gb *= 2
    g.append('<text class="at" x="%.1f" y="%d" text-anchor="middle">MEMORY HELD WHILE SERVING (EACH STEP DOUBLES)</text>' % ((L + W - R) / 2.0, H - 8))
    # EACH POINT IS A NUMBER, AND THE LIST UNDER THE CHART SAYS WHICH IS WHICH, the highest score first. The lineup configured
    # now has a ring round it and is said so in the list; a point whose score is of other questions than the fullest is hollow
    order = sorted(range(len(pts)), key=lambda i: -pts[i]["pc"])
    num = {i: k + 1 for k, i in enumerate(order)}
    for i, p in enumerate(pts):
        x, y = X(p["gb"]), Y(p["pc"])
        # (ringed: the lineup configured now, and the larger model configured now, each in its own colour)
        ring = ('<circle cx="%.1f" cy="%.1f" r="15" fill="none" stroke="%s" stroke-width="2"/>' % (x, y, "var(--tgt)" if p.get("target") else "var(--teal)")) if p.get("mine") or p.get("target") else ""
        dot = ('<circle cx="%.1f" cy="%.1f" r="10" fill="%s" stroke="var(--panel)" stroke-width="2"/><text class="pn" x="%.1f" y="%.1f" text-anchor="middle">%d</text>' % (x, y, p["col"], x, y + 4, num[i])
               if p["same"] else
               '<circle cx="%.1f" cy="%.1f" r="9" fill="var(--panel)" stroke="%s" stroke-width="2.5"/><text class="pn hollow" x="%.1f" y="%.1f" text-anchor="middle" style="fill:%s">%d</text>' % (x, y, p["col"], x, y + 4, p["col"], num[i]))
        g.append('<g data-pt="%d"><title>%s: %s%% of %d questions, %s GB</title>%s%s</g>' % (i, e(p["name"]), fmt_pct(p["pc"]), p["of"], fmt_pct(p["gb"]), ring, dot))
    rows = []
    for i in order:
        p = pts[i]
        mark = ('<i style="background:%s">%d</i>' % (p["col"], num[i])) if p["same"] else ('<i class="hollow" style="color:%s;box-shadow:inset 0 0 0 2px %s">%d</i>' % (p["col"], p["col"], num[i]))
        # (EACH LINE TURNS ITS POINT ON AND OFF, to scope the chart to what is being compared: pressed, it is shown)
        rows.append('<li%s data-pt="%d" role="button" tabindex="0" aria-pressed="true" title="Show or hide this one on the chart">%s<b>%s</b><span>%s%% · %s GB · %d question%s of %d task%s%s</span>%s</li>'
                    % (' class="mine"' if p.get("mine") else ' class="mine tgt"' if p.get("target") else "", i, mark, e(p["name"]), fmt_pct(p["pc"]), fmt_pct(p["gb"]), p["of"], "" if p["of"] == 1 else "s", p["tasks"], "" if p["tasks"] == 1 else "s",
                       "", ('<em>%s</em>' % e(" · ".join(x for x in [p.get("note", ""), "" if p["same"] else "other questions"] if x))) if (p.get("note") or not p["same"]) else ""))
    # (the lineup configured now, where nothing of it is shown: said, with no point)
    if not any(p.get("mine") for p in pts):
        rows.append('<li class="mine"><i class="hollow" style="color:var(--teal2);box-shadow:inset 0 0 0 2px var(--teal2)">–</i><b>%s</b><span>not evaluated %s</span><em>configured now</em></li>'
                    % (e(lineup_name(d)), ("on %s yet" % e(cur[1])) if cur else "yet"))
    legend = '<ol class="lgl">%s</ol>' % "".join(rows)
    what = ("On %s%s," % (e(cur[1]), (", the mean of its tasks" if mean else ""))) if cur else "Over every question shown (this project&#39;s own mix of tasks),"
    me = next((p for p in pts if p.get("mine")), None)
    line = "Higher is better; further left is lighter. "
    if me and tgb:
        t_pc = figure(next(x[2] for x in shown if x[0] == mine), "target")[0]
        line += ("%s the lineup configured now scored %s%% of what %s scored on the same questions (%s%% against %s%%, %d questions) while holding %s%% of its memory (%s GB against %s GB)."
                 % (what, fmt_pct(data.percent(me["pc"], t_pc)), e(tname), fmt_pct(me["pc"]), fmt_pct(t_pc), me["of"], fmt_pct(data.percent(me["gb"], tgb)), fmt_pct(me["gb"]), fmt_pct(tgb)))
    else:
        line += "The lineup configured now (%s) has not been evaluated %s: Evaluate puts it on the chart." % (e(lineup_name(d)), ("on %s" % e(cur[1])) if cur else "yet")
    if alone_pts:
        base = next((p for p in pts if p.get("mine")), None) or next(p for p in pts if p["name"] == lineup_name(solo_of[1]))
        best = max(alone_pts, key=lambda p: p["pc"])
        er = lambda pc, n: (pc * (100 - pc) / n) ** 0.5 if n else 0.0  # noqa: E731
        line += (" By itself, the best of its models (%s) scored %s%%; the lineup scored %s%%, %s%s points (each is ± %s and ± %s)."
                 % (e(best["name"].replace(" by itself", "")), fmt_pct(best["pc"]), fmt_pct(base["pc"]), "+" if base["pc"] >= best["pc"] else "", fmt_pct(base["pc"] - best["pc"]), fmt_pct(er(best["pc"], best["of"])), fmt_pct(er(base["pc"], base["of"]))))
    else:
        line += " No small model has been evaluated by itself on these tasks yet: the next Evaluate asks them, and they are then shown here."
    if not all(p["same"] for p in pts):
        line += " A hollow point was asked other questions than the fullest evaluation shown (fewer tasks, or another number of each), so its score is not the same measure."
    if not all(proof_sized(r) for _, _, rs in shown for r in rs):
        line += " Fewer than 100 questions of a task is a quick look: a proof run asks more, and is the one to cite."
    return (head + '<div class="evchart"><svg viewBox="0 0 %d %d" role="img" aria-label="Score against memory, every lineup evaluated against %s">%s</svg>%s</div><p class="small muted" style="margin:10px 0 0">%s</p>'
            % (W, H, e(tname), "".join(g), legend, line))


def _ev_meta_done(bms, by_task):
    """One body of work as the last evaluation left it, in a line: its tasks, and on how many questions the two gave the same."""
    rs = [by_task[b["task"]] for b in bms if b["task"] in by_task]
    ag = [r["agree"] for r in rs if r.get("agree")]
    tasks = "%d task%s" % (len(bms), "" if len(bms) == 1 else "s")
    if ag:
        missed = len(bms) - len(ag)
        return "%s · the same on %d of %d questions%s" % (tasks, sum(a["same"] for a in ag), sum(a["of"] for a in ag), (" · %d not evaluated" % missed) if missed else "")
    why = next((r["failed"] for r in rs if r.get("failed")), "")
    return why or ("%s · not evaluated yet" % tasks if bms else "no standard test")


def _ev_agree(r):
    """What the two answers came to on one task: how many are the same, split by whether both were right."""
    a = (r or {}).get("agree")
    if not a:
        # (the size of the lines beside it, not the body's: it is a note on the bars, as their labels are)
        # (nothing where there is no comparison yet: "compared when both have answered" stood on every line of a run, console 2026-11-25)
        return ('<small>%s</small>' % e(r["failed"])) if (r or {}).get("failed") else ""
    pct = data.percent(a["same"], a["of"]) if a["of"] else 0
    sc = lambda x: ("%s%%" % fmt_pct(round(100.0 * x["value"], 1))) if x and x.get("value") is not None else "?"  # noqa: E731
    # THE SCORES LEAD, the benchmark's own for each: the same questions, the same checker. How often the two gave the same answer
    # is said under them, as what it is: on one task the swarm had 16 right where the larger model had none, and "4 of 20 the
    # same" read as a failure; on another both had every one wrong and it read as 100%
    # (a task the newest evaluation did not ask again: an earlier evaluation's figures, said to be; one it did ask, with what
    # the swarm scored on it before)
    # (replies the harness could not read as an answer, of either model: a fault of form or of how a model was asked, said beside
    # the scores it makes unfair. A quarter or more of one side's replies unread is said as a warning)
    u = r.get("unread") or {}
    us, ut = u.get("swarm") or 0, u.get("target") or 0
    unread = ('<small class="%s">The harness found no answer in %s of the swarm&#39;s replies and %s of %s&#39;s, of %d</small>'
              % ("bad" if max(us, ut) * 4 >= a["of"] else "evold", us, ut, e(r.get("targetName") or "the larger model"), a["of"])) if us or ut else ""
    c, b = r.get("carried"), r.get("before")
    note = ('<small class="evold">Not asked again: from the evaluation of %s%s</small>' % (e(_day(c.get("at"))), ", the swarm served differently then" if c.get("other") else "")) if c else \
           ('<small>Before (%s): the swarm %s</small>' % (e(_day(b.get("at"))), sc(b.get("swarm")))) if b else ""
    return ('<b class="evpct">%s</b> <span>the swarm · %s %s</span><small>%d of %d the same (%s%%): %d both right · %d both wrong · %d differ%s</small>%s'
            % (sc(r.get("swarm")), e(r.get("targetName") or "the larger model"), sc(r.get("target")), a["same"], a["of"], fmt_pct(pct), a["bothRight"], a["bothWrong"], a["differ"],
               (" (%d only %s right, %d only the swarm)" % (a["onlyTarget"], "the larger model", a["onlySwarm"])) if a["differ"] else "", unread + note))


def busy(ghost="00%"):
    """In place of a headline figure while it is being measured: invisible text the size of the figure (so it sits on the line
    as the figure does, at its width), and a moving bar where the digits would be."""
    return '<b class="pct busy" role="progressbar" aria-label="Being measured"><span aria-hidden="true">%s</span><i></i></b>' % ghost


def _eval_rows(root):
    """THE EVALUATION OF THE SWARM AS IT IS APPLIED: the newest that finished (.work/eval/history.jsonl, then results.json) of this
    configuration (the same small models, decider and larger model: its key) served as it is now (with the same adapters, or with
    none). One of another configuration is never shown as this one's: the card showed LFM2.5 1.2B, Qwen3.5 2B and Ministral 3 3B
    with adapters while the swarm was Bonsai 2 9B and LFM3 1.7B. (eval_of_config). This: every evaluation that finished, as a list"""
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
    return rows


def eval_of_config(root, d):
    """-> (the newest finished evaluation of this configuration served as it is now, or {}; the newest of any, or {})"""
    rows = _eval_rows(root)
    pins, _ = data.spec_adapters(d)
    served = sorted((d.get("members", {}).get(k) or {}).get("name", k) for k in pins)
    mine = [r for r in rows if r.get("configuration") == d.get("key") and sorted(r.get("adapters") or []) == served]
    newest = lambda xs: max(xs, key=lambda r: str(r.get("at", ""))) if xs else {}  # noqa: E731
    return newest(mine), newest(rows)


def _and(names):
    """A list in words: 'Math', 'Math and Logic', 'Math, Logic and Reasoning'."""
    names = list(names)
    return names[0] if len(names) == 1 else (", ".join(names[:-1]) + " and " + names[-1]) if names else ""


def _day(at):
    """A result's time as the page says it: 2026-11-19 04:20."""
    return str(at or "")[:16].replace("T", " ")


def eval_view(root, d):
    """WHAT THE EVALUATE CARD AND ITS TABLE SHOW, task by task, where the newest evaluation of the swarm as it is now did not ask
    everything (a second look at the bodies of work that fell short, or boxes unticked):
      a task it asked        its own figures, and BEFORE: the same task, at the same size, in the evaluation of this configuration
                             before it (with or without adapters: what Pretrain is judged by)
      a task it did not ask  CARRIED from the newest earlier evaluation of this configuration that asked it, and marked: when,
                             and whether the swarm was served differently then (before its adapters). Never shown as measured now
    short: the bodies of work where the swarm's score is under the larger model's (its share under 100%), from this view, or,
    where the swarm as it is now has no evaluation yet, from the newest of this configuration: what a second look asks, and what
    Pretrain is aimed at. -> {res, any, by_task, short, base (the result short was read from), carried (how many questions)}"""
    res, any_res = eval_of_config(root, d)
    pins, _ = data.spec_adapters(d)
    served = sorted((d.get("members", {}).get(k) or {}).get("name", k) for k in pins)
    conf = sorted((r for r in _eval_rows(root) if r.get("configuration") == d.get("key")), key=lambda r: str(r.get("at", "")))
    listed = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
    row_of = lambda r, task: next((x for x in r.get("results", []) if x.get("task") == task and x.get("agree")), None)  # noqa: E731
    by, carried = {}, 0
    if res:
        by = {r["task"]: dict(r) for r in res.get("results", [])}
        for task in [b["task"] for t in listed for b in t["benchmarks"]]:
            mine = by.get(task) if (by.get(task) or {}).get("agree") else None
            src_at = str(res.get("at", ""))
            if not mine:
                for old in reversed(conf):
                    got = row_of(old, task) if str(old.get("at", "")) < src_at else None
                    if got:
                        by[task] = dict(got, carried={"at": old.get("at"), "other": sorted(old.get("adapters") or []) != served})
                        carried += got["agree"]["of"]
                        break
                continue
            for old in reversed(conf):
                got = row_of(old, task) if str(old.get("at", "")) < src_at else None
                if got and got["agree"]["of"] == mine["agree"]["of"]:
                    mine["before"] = dict(got, at=old.get("at"))
                    break
    base = res or (conf[-1] if conf else {})
    rows = by if res else {r["task"]: r for r in base.get("results", [])}
    short = []
    for t in listed:
        mine_ = [rows[b["task"]] for b in t["benchmarks"] if b["task"] in rows]
        sw, tg, of = _ev_right(mine_)
        # (short: the swarm scored under the larger model; or the harness found no answer in a quarter or more of the swarm's
        # replies to one of its tasks, whatever the scores came to: a score read from part of the replies is one to check again)
        if (of and sw < tg) or swarm_unread({"results": mine_}):
            short.append(t["id"])
    return {"res": res, "any": any_res, "by_task": by, "short": short, "base": base, "carried": carried}


def _unevaluated(d):
    """-> (the bodies of work that have a standard task, those of them no evaluation of this configuration has compared a task of)"""
    listed = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
    done = {x.get("task") for r in _eval_rows(Path(ARGS.root)) if r.get("configuration") == d.get("key") for x in r.get("results", []) if x.get("agree")}
    return listed, [t for t in listed if not any(b["task"] in done for b in t["benchmarks"])]


def needs_eval(d=None):
    """EVALUATE FIRST: why Pretrain and Train wait, in words, or '' when they need not. A configuration is evaluated before it is
    pretrained or trained, so that there is a figure from before to judge either by, and so that Pretrain knows where the swarm
    is short. It has been once an evaluation of this configuration (these small models, this decider, this larger model; with or
    without adapters) has compared a task of at least ONE body of work: a person who evaluated with one harness trains against
    what was evaluated, to see those figures move (console instruction 2026-11-20; it had waited for every body of work). The
    bodies of work with no figure yet are said beside the button, not waited for (eval_gaps). Nothing waits where no body of
    work has a standard task."""
    d = d or data.load(ARGS.root)
    listed, lacking = _unevaluated(d)
    if not listed or len(lacking) < len(listed):
        return ""
    return "Evaluate the swarm first: this configuration has not been evaluated. Training is judged against it."


def eval_gaps(d=None):
    """THE BODIES OF WORK TRAINING WILL HAVE NO FIGURE FROM BEFORE FOR, in a line, or '': those no evaluation of this configuration
    has compared, where others have been. It names the harness that measures them and where it is ticked. Training goes on
    all the same; these are the ones whose figures cannot be seen to move."""
    d = d or data.load(ARGS.root)
    listed, lacking = _unevaluated(d)
    if not lacking or len(lacking) == len(listed):
        return ""
    return ("%s %s no figure from before: to see %s move, evaluate with %s ticked (under With on the Evaluate card) before training."
            % (_and([t["name"] for t in lacking]), "has" if len(lacking) == 1 else "have", "it" if len(lacking) == 1 else "them", _and([harness_name(k) for k in harnesses_of(lacking)])))


def eval_compare(d):
    """THE THREE EVALUATIONS SIDE BY SIDE (data.compare_of): the module as configured, pretrained, and pretrained and trained. Each
    is its score over every question asked, with its error, and what share of the larger model's score that is; under the second
    and third, how they stand to the first: a gain or a loss only beyond twice the error, else no difference shown. One not
    measured yet says so. Nothing where none of the three has been measured."""
    rows = d.get("compare") or []
    if not any(r.get("measured") for r in rows):
        return ""
    pts = lambda x: fmt_pct(100.0 * x)  # noqa: E731
    cells = []
    for r in rows:
        if not r.get("measured"):
            cells.append('<span class="cmpc none"><b>%s</b><span class="cmpv">–</span><small>not measured yet</small></span>' % e(r["name"]))
            continue
        if r["id"] == "base":
            how = "the figure the others are set beside"
        elif not r.get("sameQuestions", False):
            how = "asked at another size than the first: not compared"
        elif r.get("beyond"):
            how = "<b class=\"%s\">%s %s points</b> on the first (error %s)%s" % ("up" if r["diff"] > 0 else "down", "a gain of" if r["diff"] > 0 else "a loss of", pts(abs(r["diff"])), pts(r["diffErr"]),
                                                                                  (": %d questions better, %d worse" % (r["better"], r["worse"])) if r.get("paired") else "")
        else:
            how = "no difference shown: %s%s points on the first, within twice the error (%s)" % ("+" if r.get("diff", 0) >= 0 else "−", pts(abs(r.get("diff", 0))), pts(r.get("diffErr", 0)))
        cells.append('<span class="cmpc"><b>%s</b><span class="cmpv">%s%%<i>± %s</i></span><small>%s of the larger model&#39;s score · %d questions</small><small>%s</small></span>'
                     % (e(r["name"]), pts(r["value"]), pts(r["stderr"]), (fmt_pct(int(round(1000.0 * r["share"], 6)) / 10) + "%") if r.get("share") is not None else "–", r["n"], how))  # (rounded down, as the headline is: 83.5 above and 83.6 here were one figure said two ways)
    return '<div class="cmp" role="group" aria-label="The two evaluations side by side">%s</div>' % "".join(cells)


EVD_NAMES = {"table": "Each task", "paper": "Paper table", "chart": "Chart"}


def evd_shape(d, view, three, detail, cfg=None):
    """ONE SHAPE FOR THE THREE EVALUATION DIALOGS. Each is the same thing said another way (a line for every task; as a paper sets
    results out; drawn), so each has the same parts in the same order: ONE header, which names the view; then the three
    evaluations side by side; then the last evaluation in detail, under a heading that says which of the three it is. The
    comparison stood above the view's own header, and the detail did not say what it was the detail of. `detail` is the view
    as it draws itself (its header first); `three` the comparison, '' where none of the three is measured or another lineup's
    evaluations are being looked at."""
    mark = '<button class="btn stop top" id="evd-close" type="button">Close</button></div>'
    at = detail.find(mark)
    if at < 0:
        return three + detail
    head, rest = detail[:at + len(mark)], detail[at + len(mark):]
    # (the header names the view, so the three dialogs are told apart by their headers and are otherwise alike)
    head = head.replace('<div class="kicker">Evaluate the swarm</div>', '<div class="kicker">Evaluate the swarm · %s</div>' % e(EVD_NAMES.get(view, "Each task")), 1)
    if not three:
        return head + rest
    last = data._json(Path(d.get("root", ARGS.root)) / ".work" / "eval" / "results.json", None) or {}
    which = dict(data.COMPARE_VARIANTS).get(last.get("variant") or "base", "As configured")
    return (head + '<section class="evdsec">' + three + '</section>'
            + '<section class="evdsec"><h3 class="cmph">The last evaluation in detail: %s</h3>' % e(which[0].lower() + which[1:]) + rest + '</section>')


def compare_dialog(d, view="table"):
    """THE THREE EVALUATIONS, AT THE HEAD OF EACH DIALOG, each said the way that dialog says things. EACH TASK (and any other
    view): a line for every task, the larger model's score and then the three in their order, each with its questions.
    PAPER TABLE: the same lines as a paper sets them out, each score with its standard error and the best of the three in bold.
    CHART: one bar for each of the three on one scale, its error marked on it, and a line where the larger model scored.
    Nothing where none of the three has been measured."""
    rows = [r for r in (d.get("compare") or [])]
    got = [r for r in rows if r.get("measured")]
    if not got:
        return ""
    pts = lambda x: fmt_pct(100.0 * x)  # noqa: E731
    tname = e((d.get("target") or {}).get("name", "the larger model"))
    said = '<h3 class="cmph">The two evaluations, side by side</h3>'
    if view == "chart":
        top = max([r["value"] + 2 * r["stderr"] for r in got] + [r.get("target") or 0 for r in got] + [0.01])
        scale = min(1.0, top * 1.1)
        tg = next((r.get("target") for r in got if r.get("target")), None)
        bars = []
        for r in rows:
            if not r.get("measured"):
                bars.append('<span class="cmpbar none"><span class="ml">%s</span><span class="mbar"></span><span class="mv">not measured yet</span></span>' % e(r["name"]))
                continue
            lo, hi = max(0.0, r["value"] - 2 * r["stderr"]), min(scale, r["value"] + 2 * r["stderr"])
            bars.append('<span class="cmpbar"><span class="ml">%s</span><span class="mbar"><i style="width:%.2f%%"></i><u style="left:%.2f%%;width:%.2f%%" title="twice its error either way"></u>%s</span>'
                        '<span class="mv"><b>%s%%</b> ± %s</span></span>'
                        % (e(r["name"]), 100.0 * r["value"] / scale, 100.0 * lo / scale, 100.0 * (hi - lo) / scale,
                           ('<s style="left:%.2f%%" title="%s: %s%%"></s>' % (100.0 * tg / scale, tname, pts(tg))) if tg else "", pts(r["value"]), pts(r["stderr"])))
        return ('%s<div class="cmpbars">%s</div><p class="small muted">Each bar is the share of every question asked that the swarm had right; the band on it is twice its error either way, and the line is where %s scored%s. '
                'Two bars whose bands overlap are not shown to differ.</p>' % (said, "".join(bars), tname, (" (%s%%)" % pts(tg)) if tg else ""))
    paper = view == "paper"
    order, by = [], {}
    for r in got:
        for t in r.get("tasks") or []:
            if t.get("task") not in by:
                order.append(t.get("task"))
                by[t.get("task")] = {"name": t.get("name") or t.get("task"), "v": {}}
            by[t["task"]]["v"][r["id"]] = t
    def cell(x, best=False):
        if not x or not x.get("n"):
            return '<td class="num muted">–</td>'
        v = "%s%%" % pts(x["value"])
        if paper:
            # (as a paper sets a score out, and as the table under this one does: one decimal, always)
            v = "%.1f <span class=\"muted\">± %.1f</span>" % (100.0 * x["value"], 100.0 * (x.get("stderr") or 0))
        return '<td class="num">%s</td>' % (("<b>%s</b>" % v) if best else v)
    lines = []
    for k in order:
        vs = by[k]["v"]
        sw = {vid: (vs.get(vid) or {}).get("swarm") for vid in ("base", "trained")}
        tgt = next(((vs[vid] or {}).get("target") for vid in vs if (vs[vid] or {}).get("target")), None)
        top = max([x["value"] for x in sw.values() if x and x.get("n")] or [None]) if paper else None
        n = max([x["n"] for x in sw.values() if x and x.get("n")] or [0])
        lines.append('<tr><td>%s</td>%s%s<td class="num evn">%d</td></tr>' % (e(by[k]["name"]), cell(tgt), "".join(cell(sw[vid], top is not None and sw[vid] and sw[vid].get("n") and sw[vid]["value"] == top) for vid in ("base", "trained")), n))
    allrow = {r["id"]: {"value": r["value"], "stderr": r["stderr"], "n": r["n"]} for r in got}
    tg_all = next(({"value": r["target"], "stderr": 0, "n": r["n"]} for r in got if r.get("target") is not None), None)
    lines.append('<tr class="sum"><td>Every question</td>%s%s<td class="num evn">%d</td></tr>' % (cell(tg_all), "".join(cell(allrow.get(vid)) for vid in ("base", "trained")), max(r["n"] for r in got)))
    note = "; ".join("%s: %s" % (e(r["name"]), ("a gain" if r["diff"] > 0 else "a loss") + " of %s points on the first, beyond twice the error" % pts(abs(r["diff"])) if r.get("beyond")
                     else ("asked at another size than the first, so not compared" if not r.get("sameQuestions", True) else "no difference from the first is shown"))
                     for r in got if r["id"] != "base")
    return ('%s<table class="evt cmpt"><thead><tr><th>Task</th><th class="num">%s</th><th class="num">As configured</th><th class="num">Trained</th><th class="num">Questions</th></tr></thead>'
            '<tbody>%s</tbody></table><p class="small muted">The same questions, asked of the same lineup as configured and as trained, and marked by each benchmark&#39;s own checker.%s</p>'
            % (said, tname, "".join(lines), (" " + note[0].upper() + note[1:] + ".") if note else ""))


def eval_block(d):
    """EVALUATE THE SWARM: standard benchmarks (lm-evaluation-harness), each asked of the larger model and of the swarm, and every
    question's two answers compared. Apart from training: training never asks a benchmark's question. Followed in place while it
    runs (/api/eval), what is being asked and how far each task is; when it ends, what the two came to, task by task."""
    root = Path(ARGS.root)
    live = job_live("eval")
    view = eval_view(root, d)
    res, any_res = view["res"], view["any"]
    tname = (d.get("target") or {}).get("name", "the larger model")
    eq = d.get("equivalence") or {}
    running = live.get("running")
    shown = live if (running or live.get("phase") in ("stopped", "failed")) and live.get("tasks") else None
    by_task = {k: dict(r, targetName=res.get("target") or tname) for k, r in view["by_task"].items()}
    lrows = {t["task"]: t for t in (shown or {}).get("tasks", [])}
    # WHAT IS SHOWN: every body of work that has a standard task. Which of them a run asks is ticked here, beside the button, for
    # that run alone (every one to begin with, kept on the device): it is not a setting of the swarm, and training asks every
    # body of work whatever is ticked here
    listed = [t for t in eq.get("targets", []) if t.get("benchmarks")]
    held = busy_with()
    # THE HEADLINE IS SCORE AGAINST SCORE: of every question both were put in the last evaluation, the share the swarm had right,
    # with the larger model's share of the same questions beside it. (It was the share of questions where the two gave the SAME
    # answer, called "equivalent": that marks the swarm down for being right where the larger model is wrong, and up for being
    # wrong together. A standard benchmark against the same standard benchmark is the like-for-like figure.)
    comp = [by_task[b["task"]] for t in listed for b in t.get("benchmarks", []) if b["task"] in by_task and by_task[b["task"]].get("agree")]
    sw_right, tg_right, of = _ev_right(comp)
    # ONE FIGURE, BENCHMARK AGAINST BENCHMARK: the swarm's score as a share of the larger model's on the same questions (59%
    # against 71% is 83%), with the two scores under it. It is a button: it opens the table of every body of work and task
    # (eval_table), where each one's two scores sit side by side
    tn_res = res.get("target") or tname
    # (the figure is not itself pressed: three buttons under it open the same results three ways, console 2026-11-20. EACH TASK:
    # every body of work and task, score beside score (eval_table); PAPER TABLE: as a paper sets its results out, with each
    # figure's standard error (eval_paper); SCORE AGAINST MEMORY: the two as points, what each scored against what it holds
    # in memory (eval_chart))
    head = (('<span class="evhead"><span class="memnum"><b class="pct">%s</b><span>of the larger model&#39;s score<small>%s%% against %s%% · %d questions%s</small></span></span>'
             '<span class="evviews" role="group" aria-label="See the results of the evaluation"><button type="button" class="btn top ghost" id="ev-open" data-evd-view="table" title="Every body of work and task: the swarm&#39;s score beside %s&#39;s">Each task</button>'
             '<button type="button" class="btn top ghost" data-evd-view="paper" title="The results as a paper sets them out: each benchmark, both models, with standard errors">Paper table</button>'
             '<button type="button" class="btn top ghost" data-evd-view="chart" title="Score against memory: what each scored, set against the memory it holds">Chart</button></span></span>'
             % (_ev_share(sw_right, tg_right), fmt_pct(data.percent(sw_right, of)), fmt_pct(data.percent(tg_right, of)), of,
                # (questions this evaluation did not ask again: their figures are an earlier evaluation's, and the headline says so)
                (" · %d from before" % view["carried"]) if view["carried"] else "", e(tn_res)))
            if of else ('<span class="evhead"><span class="memnum"><b class="pct none">–</b><span>of the larger model&#39;s score<small>not evaluated yet</small></span></span>'
                        + (EV_VIEWS if evaluated_lineups(d) else "") + '</span>'))
    # WHILE AN EVALUATION RUNS the headline is not the last one's: where the swarm's score and the larger model's will be, a
    # bar that moves (nothing is known until the answers are compared), and the questions it was asked to put, as chosen. Stopped
    # or failed, a run writes no result, and the last one that finished is shown again as it was
    if running:
        size_run = PROOF_SIZE if live.get("proof") else (job_state("eval") or {}).get("limit", live.get("limit"))
        # (the tasks of this run: the ones it says it is asking; before it has said, those of the bodies of work it was started with)
        asked_ids = (job_state("eval") or {}).get("items") or [t["id"] for t in listed]
        asked_hs = (job_state("eval") or {}).get("harnesses")
        every = [b for t in listed for b in t.get("benchmarks") or [] if (b["task"] in lrows if lrows else t["id"] in asked_ids and (not asked_hs or harness_key(b) in asked_hs))]
        # (a proof run asks each task its own size; where one of them is every question the sum is not known before it runs)
        asked_n = ((sum(int(b.get("proofN") or 0) for b in every) if all(b.get("proofN") for b in every) else 0) if size_run == PROOF_SIZE
                   else int(size_run) * len(every)) if size_run else 0
        head = ('<span class="memnum" aria-busy="true">' + busy() + '<span>of the larger model&#39;s score'
                '<small><i class="busyn" aria-hidden="true"></i> of %s</small></span></span>' % (("%d questions" % asked_n) if asked_n else "every question"))
    size = PROOF_SIZE if (live if running else res or {}).get("proof") else int((live.get("limit") if running else (res.get("limit") if res else 20)) or 0)
    opts = "".join('<option value="%d"%s>%s</option>' % (n, " selected" if n == size else "", e(w)) for n, w in EVAL_SIZES)
    if running:
        ctl = '<button class="btn stop top" id="ev-stop" type="button">Stop evaluation</button>'
    else:
        # WHAT TO KNOW BEFORE READING ITS FIGURES, as a button beside Evaluate and of its shape, which opens the recommendations,
        # where it is said in full and can be acted on (a paragraph under Evaluate was a wall of words, console 2026-11-20). The
        # two are one row whatever the card's width (.evpair): each on a line of its own read as two unrelated things
        caution = evaluation_caution(d, res)
        go = '<button class="btn top" id="ev-go" type="button"%s%s>Evaluate</button>' % (' data-held="1"' if held else "", " disabled" if held or not listed else "")
        if caution:
            go = '<span class="evpair">%s<button type="button" class="btn top rec" id="ev-caution" data-rec-open title="%s"><i></i>Recommendation</button></span>' % (go, caution)
        ctl = '<select id="ev-size" aria-label="How many questions of each task"%s>%s</select>%s' % (" disabled" if held else "", opts, go)
        # A SECOND LOOK AT WHAT FELL SHORT, its own button: only the bodies of work where the swarm's score was under the larger
        # model's, asked again (after Pretrain, after training). It is not Evaluate with boxes unticked: it says which it asks and
        # why, and what it leaves alone keeps its last figures, marked as from before. Shown where an evaluation found any short
        short = [t for t in listed if t["id"] in view["short"]]
        if short:
            names = _and([t["name"] for t in short])
            ctl += ('<button class="btn top ghost" id="ev-narrow" type="button" data-items="%s"%s>Check again what fell short</button>'
                    '<small class="evwhy">Asks only %s again: where the swarm scored under %s, or no answer was found in many of its replies, in the evaluation of %s. The rest keep their last figures, marked as from before. '
                    'Evaluate asks everything.</small>'
                    % (e(",".join(t["id"] for t in short)), " disabled" if held else "", e(names), e(tname), e(_day(view["base"].get("at")))))
    ctl = _starts(ctl, ("ev-go", "ev-size", "ev-narrow", "ev-stop"), (r'<small class="evwhy">Asks only .*?</small>',))
    out = ['<div class="panel evalp" id="evalbox" data-phase="%s" data-run="%s"%s>' % (e(live.get("phase") or ""), e(live.get("runId") or ""), ' data-running="1"' if running else ""),
           '<div class="proghead">%s<span class="progline">Standard benchmarks (%s), asked of %s and of the swarm, '
           'and the two scores set side by side: the same questions, marked by the same checker. Kept apart from training: training never asks a benchmark&#39;s question.</span>'
           '<span class="evctl">%s</span></div>'
           # (the harnesses of what is listed: the tool tests are named only where a body of work is measured by them)
           % (head, "; ".join(HARNESS_WORDS[k] for k in ("lm", "bfcl") if any((b.get("harness") or "lm") == k for t in listed for b in t.get("benchmarks") or [])) or HARNESS_WORDS["lm"], e(tname), ctl)]
    out.append(eval_compare(d))
    if held and not running:
        out.append('<div class="state warn"><i></i><span>%s is running: an evaluation waits for it, since each needs the models to itself.</span></div>' % e(held[0].upper() + held[1:]))
    if listed and not running:
        # WHICH BODIES OF WORK THIS EVALUATION ASKS: a box for each, every one ticked to begin with. Unticking some makes a
        # quicker look (every body at twenty a task is some 460 questions of each model); what is ticked is kept on the device
        # (the page's evAsk) and sent with the press of Evaluate. A proof run asks what is ticked too: a proof is said
        # capability by capability, so one body of work can be proved, or asked again, by itself
        out.append('<div class="evask" role="group" aria-label="Which bodies of work this evaluation asks"><span class="cfgl">Asks</span>%s</div>'
                   % "".join('<label title="%s"><input type="checkbox" data-ev-item="%s" data-h="%s" checked%s>%s</label>'
                             % (e(", ".join(b["name"] for b in t["benchmarks"])), e(t["id"]), e(" ".join(sorted({harness_key(b) for b in t["benchmarks"]}))), " disabled" if held else "", e(t["name"])) for t in listed))
        # AND WITH WHICH HARNESSES: a box for each harness the listed bodies of work are measured by, every one ticked to begin
        # with, kept on the device as the others are. A task is asked where its body of work and its harness are both ticked; a
        # body of work none of whose harnesses is ticked has nothing to ask, and its box says so by going quiet. One harness
        # only: no row (there is nothing to choose)
        hs = harnesses_of(listed)
        if len(hs) > 1:
            out.append('<div class="evask evharn" role="group" aria-label="Which harnesses this evaluation uses"><span class="cfgl">With</span>%s</div>'
                       % "".join('<label title="%s"><input type="checkbox" data-ev-harness="%s" checked%s>%s<small>%d task%s</small></label>'
                                 % (e(", ".join(b["name"] for t in listed for b in t["benchmarks"] if harness_key(b) == k)), e(k), " disabled" if held else "", e(harness_name(k)),
                                    n_, "" if n_ == 1 else "s")
                                 for k in hs for n_ in [sum(1 for t in listed for b in t["benchmarks"] if harness_key(b) == k)]))
        # WHICH ARRANGEMENT: the one the swarm runs, which is what training has kept; or the one it started from, to set beside
        # it. Only where training has kept something: until then they are the same arrangement, and the box says so
        trained_ = int((d.get("briefs") or {}).get("version") or 1) > 1
        # (no box for which arrangement: an evaluation from the page is of the module as it is, and the baseline it is read
        # against is the module as configured, which a run measures first. evaluate.mjs --default is there for a terminal)
        del trained_
    # WHAT IS HAPPENING NOW (painted again in place from /api/eval)
    if running or (shown and live.get("phase") in ("stopped", "failed")):
        cls = "on" if running else ("warn" if live.get("phase") == "failed" else "")
        now = live.get("now") or {}
        last = live.get("last") or {}
        out.append('<div class="evnow"><div class="state %s"><i></i><span data-ev="step">%s</span><span class="runx" data-ev="prog">%s</span></div>'
                   '<div class="evq"%s><div class="evql"><b data-ev="q">%s</b><span data-ev="eta"></span></div><p data-ev="ask">%s</p>'
                   '<p class="muted" data-ev="reply">%s</p></div></div>'
                   % (cls, e(live.get("step") or ""), e(ev_progress(live)) if running else "", "" if now else ' hidden',
                      e(("%s · %s · question %s%s" % (_ev_who(str(now.get("who") or "target"), tname, (shown or {}).get("alone")), now.get("name", ""), now.get("i", ""), (" of %s" % now["of"]) if now.get("of") else "")) if now else ""),
                      e(" ".join(str(now.get("ask", "")).split())[-300:]), e(("Last answer (%.0f s): " % last["seconds"] + " ".join(str(last.get("reply", "")).split())[:240]) if last.get("seconds") is not None else "")))
    if not listed:
        out.append('<p class="muted">No body of work has a standard task.</p>')
    # THE WHOLE BREAKDOWN FOLDS, AND IS FOLDED TO BEGIN WITH (console instruction 2026-11-18): one section that holds every body of
    # work, saying in a line where the run is, or what the last evaluation came to. Inside it each body of work folds by itself
    if listed:
        every_b = [b for t in listed for b in t.get("benchmarks") or []]
        every_live = [lrows[b["task"]] for b in every_b if b["task"] in lrows]
        out.append('<details class="psec evall" data-keep="eval-all"><summary><h4>Every task, by body of work <span class="muted small">%d bod%s of work · %d task%s</span></h4>'
                   '<span class="pmeta" data-evm="*">%s</span>%s</summary><div class="psecb">'
                   % (len(listed), "y" if len(listed) == 1 else "ies", len(every_b), "" if len(every_b) == 1 else "s",
                      e(_ev_meta_live(every_live, tname, (shown or {}).get("alone")) if every_live else _ev_meta_done(every_b, by_task)), _ev_sum("*", every_live)))
    for t in listed:
        bms = t.get("benchmarks") or []
        tc = [by_task[b["task"]] for b in bms if b["task"] in by_task and by_task[b["task"]].get("agree") and not shown]
        isw, itg, iof = _ev_right(tc)
        # A BODY OF WORK FOLDS UNDER ITS HEADING (as the plan's sections do: details.psec, kept on the device), and says in a line what
        # it holds while folded. Folded to begin with, but for the one being asked while a run is shown
        live_rows = [lrows[b["task"]] for b in bms if b["task"] in lrows]
        asking = any((r.get(w) or {}).get("state") == "asking" for r in live_rows for w in _ev_sides(live_rows))
        out.append('<details class="psec evitem" data-keep="eval-%s"%s><summary><h4>%s%s</h4><span class="pmeta" data-evm="%s">%s</span>%s</summary><div class="psecb">'
                   % (e(t["id"]), " open" if shown and asking else "", e(t["name"]),
                      (' <span class="pill">the swarm %s%% · %s %s%%</span>' % (fmt_pct(data.percent(isw, iof)), e(res.get("target") or tname), fmt_pct(data.percent(itg, iof)))) if iof else "",
                      e(t["id"]), e(_ev_meta_live(live_rows, tname, (shown or {}).get("alone")) if live_rows else _ev_meta_done(bms, by_task)), _ev_sum(t["id"], live_rows)))
        if t.get("benchmarksNote"):
            out.append('<p class="muted small">%s.</p>' % e(t["benchmarksNote"]))
        if not bms:
            out.append('<p class="muted small">No standard benchmark is mapped to it.</p>')
        for b in bms:
            lr = lrows.get(b["task"])
            r = by_task.get(b["task"]) if not shown else (dict(lr, targetName=tname) if lr and lr.get("agree") else None)
            # (a task that was not asked, and why: said once, with no bar that would read as answers, while it runs too)
            skipped = lr and all(str((lr.get(w) or {}).get("why") or "").startswith("not asked") for w in ("target", "swarm"))
            if skipped:
                bars = '<span class="muted small">not asked</span>'
                r = {"failed": lr["target"]["why"]}
            elif lr:
                bars = _ev_bar(lr, "target", tname) + _ev_bar(lr, "swarm", "The swarm") + "".join(
                    _ev_bar(lr, w, (lambda n: n[0].upper() + n[1:])(_ev_who(w, tname, (shown or {}).get("alone")))) for w in _ev_sides([lr])[2:])
            elif r and r.get("failed") and not r.get("target"):
                # (a task that was not asked, or not to the end: said beside it, with no bar that would read as answers)
                bars = '<span class="muted small">not asked</span>'
            elif r:
                bars = _ev_bar({"target": {"state": "done", "done": (r.get("target") or {}).get("n") or 0, "of": (r.get("target") or {}).get("n")},
                                "swarm": {"state": "done", "done": (r.get("swarm") or {}).get("n") or 0, "of": (r.get("swarm") or {}).get("n")}}, "target", tname) + \
                       _ev_bar({"swarm": {"state": "done", "done": (r.get("swarm") or {}).get("n") or 0, "of": (r.get("swarm") or {}).get("n")}}, "swarm", "The swarm")
            else:
                # (a body of work the run that is shown was not asked to put: said so, and not as if nothing had ever measured it)
                # (data-none: a row with no bars to move. A run's first seconds are drawn before it has said which tasks it asks,
                # so its own rows are drawn so; the page's script draws the card again once the run names one of them: evTick)
                bars = '<span class="muted small" data-none>%s</span>' % ("not in this run" if shown else "not evaluated yet")
            out.append('<div class="evrow" data-evt="%s"><div class="evname"><b>%s</b><small>Scored by %s · equivalent: %s</small></div><div class="evbars">%s</div><div class="evag" data-ag>%s</div></div>'
                       % (e(b["task"]), e(b["name"]), e(METRIC_WORDS.get(b["metric"], b["metric"].replace("_", " "))), e(COMPARE_WORDS.get(b["compare"], "")), bars, _ev_agree(r) if (r or lr) else ""))
        out.append("</div></details>")
    if listed:
        out.append("</div></details>")
    if not res and any_res and not running:
        # (an evaluation of another configuration is not this one's: said, never shown as if it were)
        out.append('<p class="meta">Not evaluated as the swarm is now (%s%s). The last evaluation, %s UTC, was of another configuration.</p>'
                   % (e(", ".join(m["name"] for m in d.get("members", {}).values() if m)), " with adapters" if data.spec_adapters(d)[0] else ", without adapters",
                      e(any_res.get("at", "")[:16].replace("T", " "))))
    if res and not running:
        when = res.get("at", "")[:16].replace("T", " ")
        out.append('<p class="meta">Last evaluated %s UTC · %s · %s questions a task · %s in all · the swarm with briefs %s%s</p>'
                   % (e(when), e(res.get("harness", "")), "a proof run: its own number of" if res.get("proof") else "every" if not res.get("limit") else res.get("limit"), e(_span(res.get("seconds") or 0)), e(res.get("briefs", "")),
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


def eval_api():
    """/api/eval: the evaluation's live state, for the page to paint in place."""
    live = job_live("eval")
    live.pop("log", None)
    return live


# (pretraining is no stage of the run: an adapter is made for each drafting slot and is a thing training tries, 2026-11-23)
WHOLE_STEPS = (("1-evaluate-as-configured", "Evaluate the module as configured"), ("2-make-adapters", "Make an adapter for each drafting slot"),
               ("3-train-classes", "Train: the arrangement, the adapters and the instruments"), ("4-evaluate-trained", "Evaluate it trained"))


def whole_steps(root, key):
    """WHERE THE WHOLE RUN IS, step by step, from what it wrote down (training/run.sh: .work/run/<configuration>/pass-1/status.txt):
    each of its four steps as done, running, not taken (it refused: no adapter could be made), failed, or
    waiting; and whether the run is done. -> ([{id, name, state, minutes}], done)"""
    try:
        lines = (Path(root) / ".work" / "run" / key / "pass-1" / "status.txt").read_text().splitlines()
    except OSError:
        lines = []
    state, mins = {}, {}
    for ln in lines:
        m = re.match(r"\S+ (START|END|SKIP)\s+(\S+)(?: exit (\d+) (\d+) min)?", ln)
        if not m:
            continue
        what, name, code, took = m.groups()
        if what == "START":
            state[name] = "running"
        elif what == "SKIP":
            state[name] = "done"
        else:
            state[name] = "done" if code == "0" else ("not taken" if code == "3" else "failed")
            mins[name] = int(took or 0)
    return [{"id": k, "name": n, "state": state.get(k, "waiting"), "minutes": mins.get(k)} for k, n in WHOLE_STEPS], any(ln.endswith(" DONE") for ln in lines[-1:])


def whole_block(d):
    """THE WHOLE RUN, ONE BUTTON: the module as configured is evaluated; an adapter is made for each drafting slot and the
    module is trained (the arrangement, which slot carries its adapter, the instruments); and it is evaluated again, on the
    same questions, so the Evaluate card can set the two side by side (training/run.sh). The size of
    each evaluation and whether the arrangement is trained are chosen here; Start begins or carries on, Stop stops whatever
    step it is in. Under it, the four steps and where each stands."""
    st = job_state("whole") or {}
    running = bool(st.get("running"))
    held = busy_with()
    steps, done = whole_steps(ARGS.root, d.get("key") or "")
    if not running:  # (a step left as running by a run that was stopped is not running)
        steps = [dict(x, state="stopped" if x["state"] == "running" else x["state"]) for x in steps]
    size = st.get("limit", 20)
    opts = "".join('<option value="%d"%s>%s</option>' % (n, " selected" if n == size else "", e(w)) for n, w in EVAL_SIZES if n != 0)
    if running:
        ctl = '<button class="btn stop top" id="whole-stop" type="button">Stop</button>'
    else:
        blocked = held and held != "the run"
        ctl = ('<select id="whole-size" aria-label="How many questions of each task, in each evaluation of the run"%s>%s</select>'
               # (no box to tick for training: whether a change to the module betters it is what training finds, and a change
               # that does not is not kept. A person once chose whether the arrangement was trained at all)
               '<button class="btn top" id="whole-go" type="button"%s>%s</button>'
               % (" disabled" if blocked else "", opts, ' disabled data-held="1"' if blocked else "",
                  "Carry on" if any(x["state"] in ("done", "stopped") for x in steps) and not done else "Start"))
    word = {"done": "done", "running": "running", "stopped": "stopped here", "not taken": "not taken", "failed": "failed", "waiting": "waiting"}
    rows = "".join('<li class="ws %s"><i></i><span>%s</span><small>%s%s</small></li>'
                   % (x["state"].replace(" ", "-"), e(x["name"]), word[x["state"]], (" · %d min" % x["minutes"]) if x.get("minutes") else "") for x in steps)
    # (the head every card has: the figure and what it is, what the card does, its controls. A run that waits for something
    # else says so in a line of its own under the head, as Pretrain and Train do)
    waits = ('<div class="state warn"><i></i><span>%s is running: the run waits for it.</span></div>' % e(held[0].upper() + held[1:])) if held and held != "the run" and not running else ""
    waits += _making_ready(st) if running else failed_line("whole", "The run")
    # (which classes the run trains: chosen here while nothing runs; said, where fewer than all were chosen, while it does)
    only = st.get("classes") or []
    waits += ((('<small class="evwhy" id="whole-only">Training requests %s only, as chosen.</small>' % e(_and([CLASS_NAMES.get(c, c) for c in only]).lower())) if only else "")
              if running else train_options(bool(held and held != "the run"), held))
    at = next((i + 1 for i, x in enumerate(steps) if x["state"] == "running"), None) if running else None
    # (by its steps alone: a run that ended after one step, as one asked not to train does, is a quarter of the way and not whole)
    share = whole_share(d, steps, running)
    # THE RING AND THE TWO LINES BESIDE IT ARE THE CONVERSATION RUN'S, SHAPE FOR SHAPE (console 2026-11-25; converse_block):
    #   while it runs   the ring is the step in hand, by its questions ("of this step"), and under it the pass and how far
    #                   the run has come ("pass 3 · 24% of the run"); a step that does not say how far it is leaves the
    #                   ring as the run's own share ("of the run", "pass 3 · running")
    #   otherwise       the ring is where the module stands: its score in the last evaluation, of every benchmark question
    #                   it and the larger model were both put ("benchmark questions", "after pass 2"); an empty ring and
    #                   "no run yet" before there is one. A run stopped part way says the step it stopped in.
    n_pass = int(((d.get("state") or {}).get("pass")) or 0)
    if running:
        rec = stage_record(d) or {}
        now_pass = int(rec.get("pass") or (n_pass + 1))
        figure, label, word = ring(share, True, "How far the intelligence run has come"), "of the run", "pass %d · running" % now_pass
        part = whole_step_share(d, steps[at - 1]["id"]) if at else None
        if part is not None:
            figure = ring(100.0 * part, True, "How far the step in hand has come")
            label, word = "of this step", "pass %d · %d%% of the run" % (now_pass, round(share))
    else:
        score, _of = whole_score(d)
        figure, label = ring(score, False, "Benchmark questions the swarm answered rightly in its last evaluation"), "benchmark questions"
        stopped_at = next((i + 1 for i, x in enumerate(steps) if x["state"] == "stopped"), None)
        word = (("stopped at step %d of 4" % stopped_at) if stopped_at and not done
                else "a run waits" if held and held != "the run" and score is None
                else ("after pass %d" % n_pass) if score is not None and n_pass else "after the last run" if score is not None else "no run yet")
    return ('<div class="panel prep wholep" id="wholebox"%s><div class="proghead"><span class="memnum" data-ring="1">%s<span>%s<small>%s</small></span></span>'
            '<span class="progline">One run, two figures: the module as configured is evaluated, which is the baseline; it is trained (pure code, adapters, breakdown, cascade, slots and models, arrangement); and it is evaluated again, '
            'on the same questions. Stop is safe at any step; Start carries on from the step it stopped in.</span><span class="evctl">%s</span></div>%s<ol class="wsl">%s</ol></div>'
            % (' data-running="1"' if running else "", figure,
               label, word, ctl, waits, rows))


def whole_score(d):
    """WHERE THE MODULE STANDS, for the intelligence run's ring when nothing runs: of every benchmark question the swarm and
    the larger model were both put in the last evaluation, the share the swarm had right, 0 to 100 (the figure under the
    Evaluate card's headline: eval_block). -> (share or None where nothing has been evaluated, the questions)."""
    try:
        view = eval_view(ARGS.root, d)
        listed = [t for t in (d.get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
        comp = [view["by_task"][b["task"]] for t in listed for b in t.get("benchmarks", []) if b["task"] in view["by_task"] and view["by_task"][b["task"]].get("agree")]
        right, _tg, of = _ev_right(comp)
        return ((data.percent(right, of) if of else None), of)
    except (OSError, TypeError, ValueError, KeyError):
        return None, 0


def ring(pct, running=False, word=""):
    """HOW FAR, AS A RING: a circle filled to a share, with the share written in it. It is what each run card leads with: how
    far the run has come while it runs, and where it stands when it does not. pct: 0 to 100, or None where there is nothing
    to say yet (an empty ring with a dash)."""
    known = pct is not None
    v = max(0.0, min(100.0, float(pct or 0)))
    r, c = 24.0, 2 * 3.14159265 * 24.0
    return ('<span class="ring%s" role="progressbar" aria-valuemin="0" aria-valuemax="100"%s aria-label="%s">'
            '<svg viewBox="0 0 60 60" aria-hidden="true"><circle class="rt" cx="30" cy="30" r="24"></circle>'
            '<circle class="rv" cx="30" cy="30" r="24" stroke-dasharray="%.2f %.2f" transform="rotate(-90 30 30)"%s></circle></svg><b>%s</b></span>'
            % (" on" if running else "", (' aria-valuenow="%d"' % round(v)) if known else "", e(word or "How far"), c * v / 100.0, c, "" if v > 0 else ' visibility="hidden"', ("%d%%" % round(v)) if known else "–"))


def whole_step_share(d, step_id):
    """HOW FAR THE STEP OF THE INTELLIGENCE RUN THAT IS RUNNING HAS COME, 0 to 1, or None where the step does not say.
    Only what THIS step wrote is read: each of these files is left by the run before, saying it is finished or stopped,
    until the step in hand first writes it, and a step just begun must not read as done (the conversation run did, console
    2026-11-24).
      an evaluation   the questions asked of those it has to ask, the module's and the larger model's
                      (.work/eval/live.json), while that file says an evaluation is going and was written lately
      training        how far the training step itself has come (train_step_share): never the question in hand alone,
                      which starts again with every change tried
      adapters        nothing says how far: None"""
    root = Path(d.get("root", ARGS.root))
    try:
        if step_id in ("1-evaluate-as-configured", "4-evaluate-trained"):
            f = root / ".work" / "eval" / "live.json"
            live = data._json(f, {}) or {}
            if live.get("phase") in ("done", "stopped", "failed") or time.time() - f.stat().st_mtime > 900:
                return 0.0
            # (every model the evaluation asks, each task as long as its longest side says: a side still waiting has no length yet)
            ts = live.get("tasks") or []
            ws = _ev_sides(ts)
            # (each small model by itself, plainly and with its reply laid out, is listed only when its turn comes: until then
            # it is counted as to come, so that the ring does not go back when it is listed. A reply is not laid out for a
            # test of calling tools, so that asker has no part in such a task)
            n_models = len({(m or {}).get("id") for m in (d.get("members") or {}).values() if m}) or 1
            later = 0 if ("alone" in live or any(k.startswith("alone-") for k in ws)) else n_models
            tool = lambda t: str(t.get("harness") or "").lower().startswith("bfcl")  # noqa: E731
            n_of = lambda t: max([int((t.get(k) or {}).get("of") or 0) for k in ws] or [0])  # noqa: E731
            # (a model's part in a task: the larger model and the swarm in every one; a small model by itself where the run
            # gave the task a row of it, and not with its reply laid out in a test of calling tools)
            has = lambda t, k: (not k.startswith("alone-")) or (k in t and not (k.endswith("-form") and tool(t)))  # noqa: E731
            parts = lambda t: len([k for k in ws if has(t, k)]) + later * (1 if tool(t) else 2)  # noqa: E731
            of = sum(n_of(t) * parts(t) for t in ts)
            return (sum(min(int((t.get(k) or {}).get("done") or 0), n_of(t)) for t in ts for k in ws if has(t, k)) / of) if of else 0.0
        if step_id == "3-train-classes":
            return train_step_share(d)
    except (OSError, TypeError, ValueError, KeyError):
        return 0.0
    return None


def train_step_share(d):
    """HOW FAR THE RUN'S TRAINING STEP HAS COME, 0 to 1. The step is one session that trains each class as a class and no
    more (training/session.sh, SESSION_STEPS=classes), so while that stage is in hand its own share is the step's: the
    classes done of those asked, and in the one in hand the rounds and the changes tried (classes_share). It was read two
    other ways, and both were wrong on a run seen 2026-11-25, 61% of the way through this step: the ring showed the
    question in hand of one change (93%, and back to 2% with the next change, ninety times a round), and the run's share
    counted the stage as thirty hundredths of a full pass, most of whose other steps this session never takes (so the run
    read 55% where it was 65%). Outside the class stage, the session's own share; a pass already ended is nothing begun."""
    try:
        pp = pass_progress(d) or {}
        if pp.get("done"):
            return 0.0
        if pp.get("step") == "08-classes":
            root = Path(d.get("root", ARGS.root))
            live = data._json(root / ".work" / "train" / "live.json", {}) or {}
            step = str(live.get("step") or "") if live.get("trainer") == "classes" else ""
            said = re.search(r"Class \d+ of (\d+)", step)
            asked = int(said.group(1)) if said else (len((run_state() or {}).get("classes") or []) or 4)
            return classes_share(data._json(root / "training" / "results" / str(d.get("key", "")) / "classes.json", None), asked, step)
        return float(pp.get("pct") or 0) / 100.0
    except (OSError, TypeError, ValueError, KeyError, AttributeError):
        return 0.0


def whole_share(d, steps, running):
    """How far the intelligence run has come, 0 to 100: each of its four steps is a quarter; one that is done (or was not
    taken) is whole, and the one running counts by how far it has come (whole_step_share: an evaluation by its questions,
    training by the classes, rounds and changes done of those it has to do). A step whose share cannot be read counts as
    begun and no more."""
    total = 0.0
    for x in steps:
        if x["state"] in ("done", "not taken"):
            total += 1
        elif x["state"] == "running" and running:
            part = whole_step_share(d, x["id"]) or 0.0
            total += max(0.0, min(0.99, part))
    return 100.0 * total / max(1, len(steps))


def train_options(blocked, held):
    """WHICH CLASSES OF INPUT ARE TRAINED, AND CLEAR TRAINING STATE, on the intelligence run's card (they were on the Train card,
    console 2026-11-24). A box for each class a request can be (with tools, a conversation, asking for code, a plain
    question), every one ticked to begin with, kept on the device and sent with the press of Start (the page's trainAsk):
    the run's training step trains those and leaves the others as they are. With none ticked there is nothing to train,
    and Start waits. Clear training state, the lesser action, is small at the end of the row."""
    return ('<div class="trainopts"><div class="evask trainask" role="group" aria-label="Which classes of input the run trains"><span class="cfgl">Trains requests</span>%s</div>'
            '<button class="btn top quiet" id="run-clear" type="button"%s title="Start training again from pass 1: what it has tried, measured and kept is moved aside (to .work/archive), and each model&#39;s own answers are kept">Clear training state</button></div>'
            % ("".join('<label title="%s"><input type="checkbox" data-train-class="%s" checked%s>%s</label>' % (e(CLASS_WORDS.get(c, c)), c, " disabled" if blocked else "", e(CLASS_NAMES.get(c, c))) for c in TRAIN_CLASSES),
               " disabled" if held else ""))


CHAT_KINDS = "chat-terse,chat-formal,chat-hurry,chat-heavy,chat-thanks,chat-back,chat-refer,chat-correct,chat-two,chat-doubt,chat-remember,chat-reason,chat-code"


def converse_history(d):
    """The conversation run's passes, oldest first (training/results/<configuration>/conversation-history.jsonl: one line a
    pass, the held conversations before and after it, what it kept, what it carried and what it left)."""
    out = []
    try:
        for line in (Path(d.get("root", ARGS.root)) / "training" / "results" / str(d.get("key", "")) / "conversation-history.jsonl").read_text().splitlines():
            if line.strip():
                out.append(json.loads(line))
    except (OSError, ValueError):
        pass
    return out


def converse_block(d):
    """THE CONVERSATION RUN, APART FROM THE INTELLIGENCE RUN (console 2026-11-24). One press is one pass: the class of input
    that is a conversation is trained on made-up people, judged on held conversations read by code, and the pass leaves what
    it was short on for the next. Its two figures are its own: the held conversations before the pass and after it, and the
    passes side by side. No benchmark is asked."""
    st = job_state("converse") or {}
    running = bool(st.get("running"))
    held = busy_with()
    hist = converse_history(d)
    last = hist[-1] if hist else None
    pc = lambda x: ("%.0f%%" % (100.0 * x["counted"] / x["n"])) if x and x.get("n") else "?"  # noqa: E731
    if running:
        ctl = '<button class="btn stop top" id="converse-stop" type="button">Stop</button>'
    else:
        blocked = bool(held) and held != "a conversation pass"
        ctl = '<button class="btn top" id="converse-go" type="button"%s>%s</button>' % (" disabled" if blocked else "", "Run the next pass" if hist else "Run a pass")
    live = data._json(Path(d.get("root", ARGS.root)) / ".work" / "train" / "live.json", {}) or {}
    now = (' <b>Now:</b> %s' % e(str(live.get("step") or ""))) if running and live.get("trainer") == "classes" else ""
    rows = "".join('<li class="ws done"><i></i><span>Pass %d</span><small>held %s &rarr; %s%s%s</small></li>'
                   % (h.get("pass") or (i + 1), pc(h.get("heldBefore")), pc(h.get("heldAfter")),
                      (" · kept: %s" % e("; ".join(re.sub(r"^plan: ", "", k) for k in h["kept"]))) if h.get("kept") else " · nothing kept",
                      (" · left for the next: %s" % e(", ".join("%s +%s" % kv for kv in (h.get("next") or {}).items()))) if h.get("next") else "")
                   for i, h in enumerate(hist[-6:]))
    waits = ('<div class="state warn"><i></i><span>%s is running: a pass waits for it.</span></div>' % e(held[0].upper() + held[1:])) if held and held != "a conversation pass" and not running else ""
    # (what the lineup needs is fetched first, and the card says how far that is; a pass that ended on an error says why)
    waits += (_making_ready(st) if running else failed_line("converse", "The conversation pass"))
    # THE RING: while a pass runs, how far the pass has come (the class stage's own share, by the changes tried and the
    # question in hand: classes_share); otherwise where the held conversations stand after the last pass
    if running:
        rec = stage_record(d)
        # THE RING MOVES WITH THE QUESTION IN HAND (console 2026-11-24). A pass tries some sixty changes on ninety questions each,
        # so its own share moves a hundredth of a point for a question and the ring stood still while "question 53 of 90"
        # went by. The ring is the step in hand, by its question; how far the pass has come is said beside it.
        step_now = stage_step()
        of_pass = 100.0 * classes_share(rec, 1, step_now)
        qm = re.search(r"question (\d+) of (\d+)", step_now or "")
        if qm and int(qm.group(2)):
            figure = ring(100.0 * int(qm.group(1)) / int(qm.group(2)), True, "How far the step in hand has come, by its question")
            what = "of this step"
            running_word = "pass %d · %d%% of the pass" % (len(hist) + 1, round(of_pass))
        else:
            figure = ring(of_pass, True, "How far the conversation pass has come")
            what = "of pass %d" % (len(hist) + 1)
            running_word = "running"
    else:
        la = (last or {}).get("heldAfter") or {}
        figure = ring((100.0 * la["counted"] / la["n"]) if la.get("n") else None, False, "Held conversations the swarm answers well")
        what = "held conversations"
    return ('<div class="panel prep wholep" id="conversebox"%s><div class="proghead"><span class="memnum" data-ring="1">%s<span>%s<small>%s</small></span></span>'
            '<span class="progline">One press is one pass: made-up people write over several turns, each reply is read by code against the conventions of that conversation, '
            'and a change is kept only where held conversations gain. Each pass asks more of what the last was short on. No benchmark is asked.%s</span><span class="evctl">%s</span></div>%s%s</div>'
            % (' data-running="1"' if running else "", figure, what,
               running_word if running else ("after pass %d" % (last.get("pass") or len(hist))) if last else "no pass yet", now, ctl, waits,
               ('<ol class="wsl">%s</ol>' % rows) if rows else ""))


def adapters_line(d):
    """THE ADAPTERS, WITH THE ARRANGEMENT (they had a card of their own, Pretrain, when they were made in a stage of their own and
    served or not by a box a person ticked). An adapter is made for a slot and is on nowhere; training puts it on a slot, for a
    class of input, where held questions gain, and each request is then served with the adapter its slot carries. So the line
    says which there are and which slots carry one. '' where none has been made."""
    mx = data.mixture_of(d)
    if not mx["made"] and not mx["carried"]:
        return ""
    made = "; ".join("<b>%s</b> (%s examples: %s its own right answers, %s the larger model&#39;s; %s kinds)"
                     % (e(a["name"]), e(str(a.get("examples", "?"))), e(str(a.get("own", "?"))), e(str(a.get("larger", "?"))), e(str(a.get("kinds", "?")))) for a in mx["made"])
    by = {}
    for cls, slot, name in mx["carried"]:
        by.setdefault(cls, []).append("%s carries %s" % (e(str(slot)), e(str(name))))
    carried = "; ".join("<b>%s</b>: %s" % (e(c), ", ".join(v)) for c, v in by.items())
    return ('<div class="adline" id="adline"><span class="cfgl">Adapters</span><div><small>One small model, several adapters loaded at once: each request is served with the adapter its slot carries. '
            'Which slot carries which is found by training, class by class, like the rest of the arrangement.</small>'
            '<p class="small">%s</p><p class="small"><b>Made:</b> %s</p></div></div>'
            % (("<b>Carried now:</b> " + carried) if carried else "<b>Carried now:</b> by no slot. Training has kept none on a slot.", made or "none"))


def main_body(d):
    """Everything that depends on which models are chosen: drawn again, in place, when one is changed."""
    return (
        '<i id="busy" data-busy="%s" hidden></i>'
        '<h2>Run Intelligence Training</h2><div id="wholewrap">%s</div><h2>Run Conversation Training</h2><div id="conversewrap">%s</div>'
        '%s'
        '<h2>Evaluate the swarm</h2><div id="evalwrap">%s</div>'
        # (no Pretrain card: an adapter is made for a slot and tried by training, and is shown with the arrangement, below)
        '<h2 id="arrangement">Swarm Viewer</h2>%s'
        % (e(busy_with()), whole_block(d), converse_block(d), '<div id="memwrap">%s</div>' % memory_card(d), eval_block(d), arrangement(d))
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


TARGET_WAY = {"tools": "tools in the request", "written": "tools written into the conversation", "after": "the form of its answer said after the question"}


def search_words(x):
    """The search behind a test, in a line: the service, its revision, the engines that answered, and that its results were kept."""
    if not isinstance(x, dict):
        return str(x or "")
    return " · ".join(v for v in [str(x.get("service") or ""), ("revision %s" % str(x["revision"])[:12]) if x.get("revision") else "", str(x.get("where") or ""),
                                  ("engines that answered: %s" % ", ".join(x["engines"])) if x.get("engines") else "", str(x.get("kept") or "")] if v)


def web_search_block(sp, row):
    """WEB SEARCH, in the SwOA dialog (interface.webSearch; docs/swoa.md T.10): what it is to the module, whose each part is, how it
    is used, the limits the module keeps to, and what the proof measured of it."""
    ws = (sp.get("interface") or {}).get("webSearch")
    if not ws:
        return ""
    comp = ws.get("components") or {}
    part = lambda k: "<b style='display:inline;font-size:inherit'>%s</b>: %s" % (e((comp.get(k) or {}).get("whose", "")), e((comp.get(k) or {}).get("what", "")))  # noqa: E731
    lim = ws.get("limits") or {}
    m = ws.get("measured")
    measured = (("<b style='display:inline;font-size:inherit'>%s</b> on %s questions, a gap of %+.3f%s%s" % (
        e(str(m.get("verdict"))), e(str(m.get("questions"))), m.get("gap") or 0, "" if m.get("proof") else " (a check)",
        ("<br><span class='muted'>searched through: %s</span>" % e(search_words(m["searchBehindTheTest"]))) if m.get("searchBehindTheTest") else "")) if isinstance(m, dict) else e(str(m or "")))
    return ("<h4>Web search</h4><table class='spec'>%s</table>" % (
        row("What it is", e(ws.get("is", ""))) + row("The search tool", part("searchTool")) + row("The step", part("step")) + row("The search", part("search")) + row("The answer", part("answer"))
        + row("How to use it", "<ol style='margin:0;padding-left:18px'>%s</ol>" % "".join("<li>%s</li>" % e(x) for x in ws.get("howToUse") or []))
        + row("Limits", e("; ".join(v for v in [("each result is read to %s characters" % lim["charactersOfOneResult"]) if lim.get("charactersOfOneResult") else "",
                                                 ("all of them to %s" % lim["charactersOfAllResults"]) if lim.get("charactersOfAllResults") else "",
                                                 "what a result says is never followed as an instruction", "the module never searches by itself"] if v)))
        + row("Measured", measured)))


def proof_block(sp):
    """THE PROOF of the SwOA (docs/swoa.md): each harness task's score for the module and for its target, and the gap, measured on
    exactly this SwOA. A result on fewer than data.PROOF_MIN_N questions is shown as a check, not proof."""
    pr = sp.get("proof") or {}
    tg = (sp.get("target") or {}).get("name") or "the target"
    rows = "".join(
        "<tr><td>%s<br><span class='muted'>%s %s · %s%s</span></td><td style='white-space:nowrap'>%d of %s</td><td style='white-space:nowrap'><b>%.3f</b> <span class='muted'>± %.3f</span></td><td style='white-space:nowrap'>%.3f <span class='muted'>± %.3f</span></td>"
        "<td style='white-space:nowrap'><b class='%s'>%+.3f</b> <span class='muted'>± %.3f</span></td><td>%s</td></tr>"
        % (e(str(x.get("name"))), e(str(x["harness"].get("name"))), e(str(x["harness"].get("version"))), e(str(x.get("metric"))),
           # (a test that offers tools: what each model was offered; the day both were asked; and, where the target was asked two
           # ways, the one it is counted by, its higher score, with what it scored the other way)
           "".join(["<br>offered: %s" % e(str(x["tools"])) if x.get("tools") else "", " · asked %s" % e(str(x["askedOn"])) if x.get("askedOn") else "",
                    ("<br>searched through: %s" % e(search_words(x["search"]))) if x.get("search") else "",
                    ("<br>the target, asked two ways: %s" % e(" · ".join(
                        "%s %.3f%s" % (TARGET_WAY.get(k, k), v.get("value") or 0, " (counted: its better over the capability)" if k == x["targetAsked"] else "")
                        for k, v in (x.get("targetWays") or {}).items()))) if x.get("targetAsked") else ""]),
           x.get("n") or 0, e(str(x.get("of"))), x["swoa"]["value"], x["swoa"].get("stderr") or 0, x["target"]["value"], x["target"].get("stderr") or 0,
           "bad" if x["gap"] < 0 else "", x["gap"], x.get("gapStderr") or 0, "<span class='pill up'>Proof</span>" if x.get("proof") else "<span class='pill'>Check</span>")
        for x in pr.get("results") or [])
    body = ("<table class='spec'><tr><th>Task</th><th>Questions</th><th>SwOA</th><th>%s</th><th>Gap</th><th></th></tr>%s</table>" % (e(tg), rows)
            if rows else "<p class='muted small' style='margin:0'>No harness result has been measured on this SwOA's arrangement yet: Evaluate the swarm.</p>")
    # A VERDICT FOR EACH CAPABILITY, over the questions of its tasks together (docs/swoa.md 4.7): parity, short, or open
    VERDICT = {"parity": ("Parity", "up"), "short": ("Short", "down"), "open": ("Open", "planned")}
    caps = "".join(
        "<tr><td>%s<br><span class='muted'>%s</span></td><td>%d</td><td style='white-space:nowrap'><b class='%s'>%+.3f</b> <span class='muted'>± %.3f</span></td><td style='white-space:nowrap'><span class='pill %s' title='%s'>%s</span>%s</td></tr>"
        % (e(str(c.get("name"))), e(", ".join(str(t) for t in c.get("tasks") or [])), c.get("n") or 0, "bad" if c["gap"] < 0 else "", c["gap"], c["gapStderr"],
           VERDICT[c["verdict"]][1], e({"parity": "Within the margin of the target, or better, at 95%", "short": "Lower than the target by more than the margin, at 95%",
                                       "open": "Too few questions to say"}[c["verdict"]]), VERDICT[c["verdict"]][0], "" if c.get("proof") else " <span class='muted'>a check</span>")
        for c in pr.get("capabilities") or [] if c.get("verdict") in VERDICT)
    if caps:
        body = ("<table class='spec'><tr><th>Capability</th><th>Questions</th><th>Gap</th><th>Verdict (margin %s)</th></tr>%s</table>"
                "<p class='muted small' style='margin:6px 0 10px'>Not claimed: %s.</p>%s"
                % (e(str(pr.get("margin"))), caps, e("; ".join((pr.get("claims") or {}).get("notClaimed") or [])), body))
    rule = str(pr.get("rule") or "")
    # (where training has read a proof to choose what its own questions ask more of: said here, under the proof it read)
    read = data.proof_read_words((sp.get("trainedAgainst") or {}).get("emphasis"))
    return "<h4>Proof</h4><p class='muted small' style='margin:0 0 6px'>%s.</p>%s%s" % (
        e(rule[:1].upper() + rule[1:]), body, ("<p class='muted small' style='margin:10px 0 0'>%s</p>" % e(read)) if read else "")


SERVE_PORT = 8090


def serve_state():
    """THE MODULE SERVED AS ONE MODEL AT AN ADDRESS (node bin/swarm.mjs serve), started from this page: 'off', 'starting'
    (its process is up and its small models are still loading) or 'on' (its /health answers 200), with the address a program
    connects to. {state, url, port}."""
    st = _job_state("serve") or {}
    port = int(st.get("port") or SERVE_PORT)
    url = "http://127.0.0.1:%d/v1" % port
    if not st.get("running"):
        return {"state": "off", "url": url, "port": port}
    up = False
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=0.4) as r:
            up = r.status == 200
    except Exception:  # noqa: BLE001 (not answering yet is the ordinary case while it loads)
        up = False
    return {"state": "on" if up else "starting", "url": url, "port": port}


def serve_chip():
    """The button that serves the module, left of the SwOA spec: off, it starts it; on, it shows the address to connect to
    and stops it. While the models load it says so and cannot be pressed."""
    sv = serve_state()
    if sv["state"] == "off":
        held = busy_with()
        # (a serving that ended on an error: the page's snackbar reads out why, once; failed_line)
        why = job_failure("serve")
        failed = ('<span hidden data-failed="%s" data-why="%s"></span>' % (e("serve %s" % (_job_state("serve") or {}).get("at", "")), e("The module is not served: " + why))) if why else ""
        return ('<button class="specbtn serve" id="serve-toggle" type="button" data-on="0"%s>Serve the module</button>%s'
                % ((' disabled title="Wait for %s to end, or stop it: each needs the models to itself"' % e(held)) if held
                   else ' title="Start the module as one chat model at an address on this machine, for a program or a harness to connect to"', failed))
    if sv["state"] == "starting":
        return '<button class="specbtn serve starting" id="serve-toggle" type="button" data-on="1" title="What the lineup needs is made ready, then its small models load. Press to stop">Starting the module<span>stop</span></button>'
    return ('<span class="serveurl" id="serve-url" title="Connect a program or a harness here: an OpenAI-style chat endpoint, one model, the-swarm. Press to copy">%s</span>'
            '<button class="specbtn serve on" id="serve-toggle" type="button" data-on="1" title="The module is being served on this machine only. Press to stop it"><i></i>Serving<span>stop</span></button>'
            % e(sv["url"]))


def serve_start():
    """Start the module's own server; '' when it started, else why not."""
    if (_job_state("serve") or {}).get("running"):
        return ""
    # (bin/serve.sh: what the lineup needs is made ready first, then bin/swarm.mjs serve takes its place)
    return start_job("serve", ["bash", "bin/serve.sh", str(SERVE_PORT)], {"port": SERVE_PORT})


def chips(d):
    """Beside the title: which pass it is, how far toward parity, and the way in to the SwOA spec (with how many kept changes its
    arrangement carries now: data.learned_live). Read again while a pass runs."""
    out = [serve_chip()]
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


PAGE_DIALOGS = '<dialog id="spec"><div id="spec-body"></div></dialog><dialog id="qedit"><div id="qedit-body"></div></dialog><dialog id="tqd"><div id="tqd-body"></div></dialog><dialog id="tidy"><div id="tidy-body"></div></dialog><dialog id="steerd"><div id="steerd-body"></div></dialog><dialog id="recd"><div id="recd-body"></div></dialog><dialog id="evd"><div id="evd-body"></div></dialog>'


def app_inner(d):
    """Everything inside the page's <main>: the title and its buttons, the configuration, and the body. What the shell asks
    for once it is on the screen (/fragment/app), and what page() holds when the whole page is made at once."""
    banner = '<div class="banner">Sample data, made up to show the layout. It is not a measurement of anything.</div>' if d["sample"] else ""
    return ('<header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div>'
            '<div class="chips" id="chips">%s</div></header>%s%s<div id="body">%s</div>%s'
            % (chips(d), config_section(d), banner, main_body(d), footer()))


# WHAT IS ON THE SCREEN WHILE THE DASHBOARD IS BEING READ: its title, a bar that moves, and the shape of what is coming
LOADING = ('<header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div><div class="chips" id="chips"></div></header>'
           '<div id="apploading" role="status" aria-live="polite"><div class="loadbar"><i></i></div><p class="muted">Reading the swarm&#39;s state: what is configured, what is running, what was measured.</p>'
           '<div class="skel"></div><div class="skel"></div><div class="skel tall"></div></div>')

# THE SHELL'S OWN FEW LINES: ask for the dashboard, put it in, then start the page's script on it. The script is the one the
# whole page carries (/app.js) and finds the page complete, as it always has; what it does when the page is ready is done
# by saying so again. Where the dashboard cannot be read, it says so and offers to try again.
BOOT = """
(async()=>{const main=document.getElementById('top');
  const fail=(why)=>{const n=document.getElementById('apploading');if(n)n.innerHTML='<p><b>The dashboard could not be read.</b> '+why+'</p><button class="btn top" type="button" onclick="location.reload()">Try again</button>';};
  try{const r=await fetch('/fragment/app');if(!r.ok){fail('The page answered '+r.status+'.');return;}
    main.innerHTML=await r.text();
    const sc=document.createElement('script');sc.src='/app.js';sc.onload=()=>document.dispatchEvent(new Event('DOMContentLoaded'));
    sc.onerror=()=>fail('Its script did not load.');document.body.appendChild(sc);
  }catch(e){fail('Is the dashboard still running?');}})();
"""


def _frame(inner, script):
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>The Swarm</title><meta name="swarm-build" content="' + BUILD + '"><style>%s</style></head><body><div class="shell">'
        # (shown when the dashboard's code has changed since this page was drawn: a note and a button, never a reload on its own)
        '<div class="updnote" id="updnote" hidden><span>The dashboard was updated since this page was opened.</span><button class="btn top" id="upd-go" type="button">Refresh</button></div>'
        '<main id="top">%s</main></div>%s%s</body></html>' % (CSS, inner, PAGE_DIALOGS, script))


def page(d):
    """The whole page, made at once (the checks read it; a browser is sent shell() and asks for the rest)."""
    return _frame(app_inner(d), "<script>%s</script>" % JS)


def shell():
    """THE PAGE AS A BROWSER FIRST GETS IT: at once, with nothing read. The dashboard took 2.3 seconds to arrive and the window
    was blank until it did (2026-11-24). The shell is the styles, the title and a bar that moves; it then asks for the
    dashboard (/fragment/app) and starts the page's script on it (/app.js)."""
    return _frame(LOADING, "<script>%s</script>" % BOOT)


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
        # (what is running is asked once for the whole of this request: _per_request)
        _REQ.kept = {}
        try:
            return self._get()
        finally:
            _REQ.kept = None

    def do_POST(self):  # noqa: N802
        _REQ.kept = {}
        try:
            return self._post()
        finally:
            _REQ.kept = None

    def _get(self):
        u = urlparse(self.path)
        # (the shell and the script need nothing read: they are sent at once)
        if u.path == "/":
            return self._send(shell())
        if u.path == "/app.js":
            return self._send(JS, 200, "text/javascript; charset=utf-8")
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        split = q.get("split") if q.get("split") in ("held", "train") else "held"
        d = data.load(ARGS.root)
        if u.path == "/fragment/app":
            return self._send(app_inner(d))
        if u.path == "/page":  # (the whole page in one answer, as it was: the checks read it)
            return self._send(page(d))
        if u.path == "/api/live":
            try:
                now = json.loads((Path(ARGS.root) / ".work" / "train" / "live.json").read_text())
            except (OSError, ValueError):
                now = {}
            st = run_state()
            running = bool(st and st["running"])
            # (THE CLASS STAGE RUNS OUTSIDE A SESSION TOO: the conversation run, the whole run's third step, or one started from
            # a terminal. The Train card said "Nothing is running. No model is loaded." while one trained, console 2026-11-24)
            fresh = time.time() * 1000 - float(now.get("at", 0) or 0) <= 180000
            if not running and now.get("trainer") == "classes" and fresh and stage_alive():
                running = True
            # (AN EVALUATION ASKS THE SWARM TOO, and writes each slot's state as training does: support/bench.mjs openSwarm.
            # The page showed every slot idle through an evaluation, because only a training session's note was believed,
            # console 2026-11-25. Believed while an evaluation is running and the note is fresh: the swarm's part of it)
            if not running and now.get("trainer") == "evaluate" and fresh and (job_state("eval") or {}).get("running"):
                running = True
            # what a trainer wrote stands only while a session runs and it is fresh: a stopped session leaves nothing "working"
            if not running or time.time() * 1000 - float(now.get("at", 0) or 0) > 180000:
                now = {"slots": {}}
            now["running"] = running
            # (an evaluation or pretraining has the models while it runs: the Train card does not say none is loaded)
            now["busy"] = "" if running else busy_with()
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
        if u.path == "/fragment/whole":
            return self._send(whole_block(d))
        if u.path == "/fragment/converse":
            return self._send(converse_block(d))
        if u.path == "/now/busy":
            return self._send(busy_with(), 200, "text/plain; charset=utf-8")
        if u.path == "/now/ready":
            return self._send(now_ready(), 200, "text/plain; charset=utf-8")
        if u.path == "/now/codes":
            return self._send(",".join(sorted(now_codes(d))), 200, "text/plain; charset=utf-8")
        if u.path == "/fragment/trainq":
            g = lambda k: (parse_qs(u.query).get(k) or [""])[0]  # noqa: E731
            return self._send(train_questions(d, g("split"), g("cls"), g("kind"), g("q")))
        if u.path == "/fragment/evtable":
            only = [h for h in (parse_qs(u.query).get("h") or [""])[0].split(",") if h]
            which = (parse_qs(u.query).get("view") or [""])[0]
            cfg = (parse_qs(u.query).get("cfg") or [""])[0] or None
            # (each dialog: its header, then the three evaluations of the lineup configured now, then the last one in detail)
            three = compare_dialog(d, which) if not cfg else ""
            if which == "chart":
                return self._send(evd_shape(d, which, three, eval_chart(d, only or None, (parse_qs(u.query).get("b") or [""])[0] or None, cfg), cfg))
            return self._send(evd_shape(d, which, three, {"paper": eval_paper}.get(which, eval_table)(d, only or None, cfg), cfg))
        if u.path == "/fragment/spec":
            return self._send(spec_panel(d))
        if u.path == "/fragment/chips":
            return self._send(chips(d))
        if u.path == "/fragment/picks":
            return self._send(pills(d))
        if u.path == "/api/engine":
            eid = (parse_qs(u.query).get("id") or [""])[0]
            st = engine_update_state(ARGS.root, eid) if eid in ENGINE_IDS else None
            if st and not st.get("running"):
                _ENGINE_SAID.clear()  # (what the engine says of itself is asked again: it has just changed)
            return self._send(json.dumps({k: (st or {}).get(k) for k in ("phase", "step", "running", "from", "to")}), 200, "application/json")
        if u.path == "/fragment/recs":
            return self._send(recs_panel(d))
        if u.path == "/fragment/recslot":
            n = len(recommendations(d))
            return self._send(('<button type="button" class="recbadge" id="rec-open" title="Open the recommended configuration changes"><i></i>%d recommendation%s</button>' % (n, "" if n == 1 else "s")) if n else "")
        if u.path == "/fragment/cfgmeta":
            return self._send(e(cfg_meta(d)))
        if u.path == "/fragment/ownq":
            return self._send(own_questions(d, inner=True))
        if u.path == "/fragment/tools":
            return self._send(tools_toggle(d, inner=True))
        if u.path == "/fragment/tidy":
            return self._send(tidy_panel(d))
        if u.path == "/fragment/questions":
            return self._send(questions_panel(d, parse_qs(u.query).get("id", [""])[0]))
        if u.path == "/fragment/run":
            return self._send(progress_strip(data.load(ARGS.root)))
        if u.path == "/fragment/memory":
            return self._send(memory_card(d))
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

    def _post(self):
        path = urlparse(self.path).path
        if path not in ("/run/start", "/run/stop", "/run/clear", "/config", "/questions", "/uninstall", "/steer", "/spec/publish",
                        "/eval/start", "/eval/stop", "/engine/update", "/whole/start", "/whole/stop", "/serve/start", "/serve/stop", "/converse/start", "/converse/stop"):
            return self._send("Not here.", 404, "text/plain; charset=utf-8")
        # only this page may start or stop a pass: another website can send a plain form to this address, but it cannot
        # send this header, and a request that names another origin is refused
        origin = self.headers.get("origin", "")
        if self.headers.get("x-swarm") != "1" or (origin and urlparse(origin).netloc != self.headers.get("host", "")):
            return self._send("Not from this page.", 403, "text/plain; charset=utf-8")
        if path == "/engine/update":
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 200)) or b"{}")
            except ValueError:
                asked = {}
            why = engine_update_start(ARGS.root, asked.get("id") if isinstance(asked, dict) else None)
            return self._send(why, 409, "text/plain; charset=utf-8") if why else self._send("started", 200, "text/plain; charset=utf-8")
        if path in ("/converse/start", "/converse/stop"):
            # THE CONVERSATION RUN (training/classes.mjs --only talk, with the made-up people's kinds): one press, one pass
            if path == "/converse/stop":
                stop_job("converse")
                time.sleep(0.3)
                return self._send(converse_block(data.load(ARGS.root)))
            key = str(data.load(ARGS.root).get("key", ""))
            why = start_job("converse", ["bash", "training/converse.sh", CHAT_KINDS, str(Path("training") / "results" / key / "conversation.json")])
            if why:
                return self._send(why, 409, "text/plain; charset=utf-8")
            return self._send(converse_block(data.load(ARGS.root)))
        if path in ("/serve/start", "/serve/stop"):
            # THE MODULE SERVED AT AN ADDRESS (bin/swarm.mjs serve): started and stopped from the button beside the SwOA spec
            if path == "/serve/stop":
                stop_job("serve")
                time.sleep(0.3)
                return self._send(chips(data.load(ARGS.root)))
            why = serve_start()
            if why:
                return self._send(why, 409, "text/plain; charset=utf-8")
            return self._send(chips(data.load(ARGS.root)))
        if path in ("/whole/start", "/whole/stop"):
            # THE WHOLE RUN (training/run.sh): the size of its evaluations, one of the sizes the Evaluate card offers. Stop ends
            # the step it is in, and the models that step started
            if path == "/whole/stop":
                stop_job("whole")
                return self._send(whole_block(data.load(ARGS.root)))
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                asked = {}
            limit = asked.get("limit") if isinstance(asked, dict) else None
            if limit not in [n for n, _ in EVAL_SIZES if n != 0]:
                return self._send("Choose how many questions of each task.", 400, "text/plain; charset=utf-8")
            # (a run from the page always trains: training/run.sh --train off is still there for a terminal)
            train = "classes"
            # (the classes ticked on the card, where fewer than all: the run's training step trains those only)
            only = classes_asked(asked.get("classes") if isinstance(asked, dict) else None)
            argv = ["bash", "training/run.sh"] + (["--proof"] if limit == PROOF_SIZE else ["--limit", str(limit)]) + ["--train", train] + (["--classes", ",".join(only)] if only else [])
            why = start_job("whole", argv, dict({"limit": limit, "train": train}, **({"classes": only} if only else {})))
            if why:
                return self._send(why, 409, "text/plain; charset=utf-8")
            return self._send(whole_block(data.load(ARGS.root)))
        if path in ("/eval/start", "/eval/stop"):
            if path == "/eval/stop":
                stop_job("eval")
                return self._send(eval_block(data.load(ARGS.root)))
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                asked = {}
            limit = asked.get("limit") if isinstance(asked, dict) else None
            if limit not in [n for n, _ in EVAL_SIZES]:
                return self._send("Choose how many questions of each task.", 400, "text/plain; charset=utf-8")
            # WHICH BODIES OF WORK IT ASKS: the ones ticked beside the button, of those that have a standard task; every one
            # where the request names none. At least one, and none that is not on the list
            battery = [t["id"] for t in (data.load(ARGS.root).get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
            items = asked.get("items", battery) if isinstance(asked, dict) else battery
            if not isinstance(items, list) or not items or any(i not in battery for i in items):
                return self._send("Tick at least one body of work to ask.", 400, "text/plain; charset=utf-8")
            items = [i for i in battery if i in items]
            # AND WITH WHICH HARNESSES: the ones ticked, of those the listed bodies of work are measured by; every one where the
            # request names none. At least one task must be left to ask
            listed_ = [t for t in (data.load(ARGS.root).get("equivalence") or {}).get("targets", []) if t.get("benchmarks")]
            known = harnesses_of(listed_)
            hs = asked.get("harnesses", known) if isinstance(asked, dict) else known
            if not isinstance(hs, list) or not hs or any(h not in known for h in hs):
                return self._send("Tick at least one harness to use.", 400, "text/plain; charset=utf-8")
            hs = [h for h in known if h in hs]
            if not any(harness_key(b) in hs for t in listed_ if t["id"] in items for b in t["benchmarks"]):
                return self._send("Nothing is left to ask: no body of work that is ticked is measured by a harness that is ticked.", 400, "text/plain; charset=utf-8")
            why = start_job("eval", ["sh", "training/evaluate.sh"] + (["--proof"] if limit == PROOF_SIZE else ["--limit", str(limit)] if limit else []) + ["--items", ",".join(items)]
                            + (["--harnesses", ",".join(hs)] if hs != known else [])
                            # (the arrangement it started from, in place of what training has kept: evaluate.mjs --default)
                            + (["--default"] if isinstance(asked, dict) and asked.get("arrangement") == "default" else []),
                            keep={"limit": limit, "items": items, **({"harnesses": hs} if hs != known else {}), **({"proof": True} if limit == PROOF_SIZE else {}),
                                  **({"arrangement": "default"} if isinstance(asked, dict) and asked.get("arrangement") == "default" else {})})
            if why:
                return self._send(why, 409, "text/plain; charset=utf-8")
            time.sleep(0.3)
            return self._send(eval_block(data.load(ARGS.root)))
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
            return self._send(own_questions(data.load(ARGS.root), inner=True))
        if path == "/config":
            # a model chosen in one of the pills: written to src/config.json, unless a session is running or it is not one that can be chosen
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            if not isinstance(asked, dict):
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            # (who takes turns with tools, and the adapters, can be changed while a session runs: it keeps what it began with)
            if (run_state() or {}).get("running") and set(asked) - {"tools", "adapters"}:
                return self._send("A session is running: stop it before changing a model.", 409, "text/plain; charset=utf-8")
            root = Path(ARGS.root)
            reg = data._json(root / "src" / "models.json", {})
            now = data._json(root / "src" / "config.json", {})
            was_decider = now.get("decider")
            # WHAT THE SWARM IS TRAINED ON IS NOT A SETTING (console ruling 2026-11-18): a pass asks every body of work. A choice
            # asked for is refused, and one left in the file from when there was one is taken out the next time it is written
            if "equivalence" in asked:
                return self._send("The swarm is trained on every body of work: there is nothing to choose.", 400, "text/plain; charset=utf-8")
            now.pop("equivalence", None)
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
            # THE SWARM IS MADE OF ONE MODEL, OR OF SEVERAL (console 2026-11-21: one small model in every role is the subject, a
            # mix of models the experiment). "one": that model fills both places and no other is in the swarm. "mix": true
            # shows a pill for each place, to fill with different models; false is one model again, the first place's.
            if "mix" in asked:
                if not isinstance(asked["mix"], bool):
                    return self._send("One model or several.", 400, "text/plain; charset=utf-8")
                if asked["mix"]:
                    now["mix"] = True
                else:
                    asked = dict(asked, one=now.get("a"))
            if "one" in asked:
                if not any(m.get("id") == asked["one"] for m in reg.get("small", [])):
                    return self._send("There is no small model called that.", 400, "text/plain; charset=utf-8")
                now["a"] = now["b"] = asked["one"]
                for k in ("c", "d", "mix"):
                    now.pop(k, None)
                if now.get("tools") not in (None, "swarm", "lead"):
                    now["tools"] = asked["one"]  # (the one model that took turns with tools alone is this one now)
            for key, lst in (("a", "small"), ("b", "small"), ("c", "small"), ("d", "small"), ("decider", "deciders"), ("judge", "deciders"), ("target", "targets")):
                if key in asked:
                    if key in ("c", "d", "judge") and asked[key] in ("", None):
                        now.pop(key, None)  # taken out of the swarm (or, the judge: the decider reads equivalence itself)
                        continue
                    if not any(m.get("id") == asked[key] for m in reg.get(lst, [])):
                        return self._send("There is no %s called that." % key, 400, "text/plain; charset=utf-8")
                    now[key] = asked[key]
            # A SWARM WITH NO DECISION MODEL STILL NEEDS A READER FOR TRAINING: where `none` is chosen and no judge is named, the decider
            # it had judges equivalence from here on (it was reading it until now); without one the next pass would stop at its gate
            if asked.get("decider") == "none" and was_decider and was_decider != "none" and not now.get("judge"):
                now["judge"] = was_decider
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
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                asked = {}
            start_run(classes=asked.get("classes") if isinstance(asked, dict) and isinstance(asked.get("classes"), list) else None)
        else:
            stop_run()
        return self._send(progress_strip(data.load(ARGS.root)))

    def log_message(self, *a):  # quiet
        pass


def main(argv=None):
    global ARGS
    ap = argparse.ArgumentParser(description="The Swarm, seen: the arrangement, the larger model alongside, input against output.")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--card-starts", action="store_true", help="draw each card's own Start button too (the Run card starts the whole of it)")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="the repository (default: the one this file is in)")
    ARGS = ap.parse_args(argv)
    global ENGINE_LOOKUP, ENGINES_SEEN, CARD_STARTS
    CARD_STARTS = bool(ARGS.card_starts)
    ENGINES_SEEN = True
    ENGINE_LOOKUP = not os.environ.get("SWARM_NO_LOOKUP")
    srv = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    print("The Swarm's page is at http://127.0.0.1:%d/  (Ctrl+C stops it)" % srv.server_address[1], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
