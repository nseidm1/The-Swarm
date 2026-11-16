#!/usr/bin/env python3
"""swarm_ui.py - THE SWARM, SEEN. One page, served from this machine, that shows what is being trained and how it stands:

    Parity            whether the swarm's answers are FUNDAMENTALLY EQUIVALENT to the larger model's, on the same questions.
                      Not a percentage and not which of them is right: at parity when every answer is equivalent
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
.picks{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:18px}
.pick{background:var(--panel);border-radius:18px;padding:9px 14px 10px;box-shadow:var(--shadow);display:grid;gap:1px;border:0;text-align:left;font:inherit;color:var(--fog);border-left:4px solid var(--lfm);min-width:0}
.pick.b{border-left-color:var(--bon)}.pick.decider{border-left-color:var(--kev)}.pick.target{border-left-color:var(--tgt)}.pick.spec{border-left-color:var(--sun);cursor:pointer}
.pick small{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mist)}.pick b{font-size:15px;font-weight:800}
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
.stages{display:grid;grid-template-columns:1.25fr 1fr .9fr .9fr;gap:14px}
.stage>.t{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--mist);margin-bottom:8px}
.slot{background:#e4f4f0;border-left:4px solid var(--lfm);border-radius:16px;padding:10px 12px;margin-bottom:10px}
.slot.b{background:#fdf3d7;border-left-color:var(--bon)}.slot.kev{background:#fde8e2;border-left-color:var(--kev)}
.probs{display:grid;gap:3px;margin-top:6px;font-size:12.5px}
.probs div{display:grid;grid-template-columns:18px minmax(0,1fr) 38px;gap:6px;align-items:center}.probs i{display:block;height:7px;border-radius:4px;background:var(--kev)}
.slot summary{cursor:pointer;list-style:none}.slot summary::-webkit-details-marker{display:none}
.slot .id{font-weight:800;letter-spacing:-.01em;font-size:15px}.purpose{font-size:13px;font-weight:600;color:var(--fog);opacity:.85;margin:1px 0 3px}
.live{display:flex;gap:7px;align-items:flex-start;margin-top:7px;padding-top:7px;border-top:1px solid rgba(20,33,31,.10);font-size:12px;font-weight:700;color:var(--mist);overflow-wrap:anywhere}
.live i{width:8px;height:8px;border-radius:50%;background:var(--unsure);flex:none;margin-top:4px}.live.on{color:var(--teal)}.live.on i{background:var(--teal2);animation:p 1.2s infinite}
.live.done{color:var(--fog)}.live.done i{background:var(--right)}.live.bad{color:var(--wrong)}.live.bad i{background:var(--wrong)}
.now{display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--mist);overflow-wrap:anywhere}
.now i{width:9px;height:9px;border-radius:50%;background:var(--unsure);flex:none;margin-top:5px}.now.on{color:var(--fog)}.now.on i{background:var(--teal2);animation:p 1.2s infinite}.slot .sub{font-size:12px;color:var(--mist);display:flex;flex-wrap:wrap;gap:2px 10px}
.slot .body{margin-top:8px;padding-top:8px;border-top:1px solid rgba(20,33,31,.10);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.slot .final{display:inline-block;margin-top:5px;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:800;background:var(--panel)}
.final.ok{background:#d7f3e9;color:var(--right)}.final.no{background:#fde1db;color:var(--wrong)}
.cand{margin-top:6px;font-size:12.5px;color:var(--mist);border-left:3px solid var(--sun);padding-left:8px}
.target{border-left:4px solid var(--tgt)}.target h3{color:var(--tgt)}
button.strip{display:block;width:100%;text-align:left;border:0;font:inherit;color:inherit;cursor:pointer}button.strip:hover{box-shadow:0 14px 34px rgba(11,93,87,.16)}
button.strip:focus-visible{outline:3px solid var(--teal2);outline-offset:2px}.strip .meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0;color:var(--mist)}.strip .meta b{color:var(--fog)}.strip .more{color:var(--teal);font-weight:800}
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
.steps{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:12.5px;font-variant-numeric:tabular-nums}
.steps li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px}.steps .now{color:var(--teal);font-weight:800}.steps .bad{color:var(--wrong)}
.pulse{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--teal2);animation:p 1.2s infinite}@keyframes p{50%{opacity:.25}}
.feed{margin:0;padding:0;list-style:none;display:grid;gap:10px}.feed li{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
.feed .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--teal)}
.feed b{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.feed small{color:var(--mist);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}html{scroll-behavior:auto}}
@media (max-width:1200px){.shell{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}
@media (max-width:1200px){.picks{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.picks{grid-template-columns:minmax(0,1fr)}}
@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.charts,.two,.io,.versus{grid-template-columns:minmax(0,1fr)}
.stages{grid-template-columns:repeat(2,minmax(0,1fr))}.qlist{max-height:260px}}
@media (max-width:560px){.stages,.kpis{grid-template-columns:minmax(0,1fr)}main{padding:18px 16px 40px}h1{font-size:27px}.panel{padding:16px;border-radius:20px}}
"""

JS = """
const $=(s,r=document)=>r.querySelector(s);
async function swap(url,into,opts){const r=await fetch(url,opts);$(into).innerHTML=await r.text();}
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
    const body=b.id==='run-go'?JSON.stringify({passes:Number($('#run-passes').value),each:Number($('#run-each').value)}):'{}';
    await swap(b.id==='run-go'?'/run/start':'/run/stop','#run',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body});watch();return;}
});
// A MODEL CHOSEN: written down, and everything that depends on it drawn again in place
document.addEventListener('change',async(ev)=>{const s=ev.target.closest('[data-pick]');if(!s)return;
  const r=await fetch('/config',{method:'POST',headers:{'x-swarm':'1','content-type':'application/json'},body:JSON.stringify({[s.dataset.pick]:s.value})});
  if(r.ok){$('#body').innerHTML=await r.text();await swap('/fragment/run','#run');liveTick();}else{alert(await r.text());await swap('/fragment/picks','#picks');}});
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
  else{await swap('/fragment/score','#score');if($('#plan'))await swap('/fragment/plan','#plan');}},4000);}
if($('#run [data-running]'))watch();
// WHAT EVERY SLOT IS DOING NOW: asked for every second and a half while a session runs, and written onto the cards in place
const STEP={measure:'Measuring the swarm',improve:'Trying a brief',arrange:'Trying an arrangement',baseline:'One model alone'};
function paint(el,cls,text){el.className='live '+cls;el.querySelector('span').textContent=text;}
async function liveTick(){
  let n={};try{n=await (await fetch('/api/live')).json();}catch(e){return;}
  const now=$('#now');
  if(now){const q=n.question;now.className='now'+(q?' on':'');
    now.querySelector('span').textContent=q?(STEP[n.trainer]||'Working')+' · '+(n.who==='swarm'?'the swarm':n.whoName+' alone')+' · '+n.split+' question '+n.n+' of '+n.of+' · '+q.ask.replace(/\\s+/g,' ').slice(0,150)
      :n.running?'A session is running. Between steps: models are loading or unloading.':'Nothing is running. No model is loaded.';}
  const slots=n.slots||{};
  document.querySelectorAll('[data-live]').forEach(el=>{
    const id=el.dataset.live,s=slots[id]||slots[id+'-alone'];
    if(!s){paint(el,'', n.question&&n.who==='swarm'&&id!=='target'?'Waiting its turn':'Idle');return;}
    if(s.state==='working')paint(el,'on','Working · '+Math.max(0,Math.round((Date.now()-s.since)/1000))+' s');
    else paint(el,s.state==='failed'?'bad':'done',(s.state==='failed'?'Failed':'Answered')+' in '+(s.ms/1000).toFixed(1)+' s'+(s.said?' · '+s.said:''));
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
        '<div class="bar"><div class="name %s">%s</div><div class="n">%d of %d equivalent</div><div class="track" role="img" aria-label="%d equivalent, %d different, %d none, of %d">'
        '<i class="r" style="width:%.2f%%"></i><i class="w" style="width:%.2f%%"></i><i class="u" style="width:%.2f%%"></i></div></div>'
        % (cls, e(name), p["equivalent"], p["compared"], p["equivalent"], p["differ"], p["none"], p["compared"], pct("equivalent"), pct("differ"), pct("none"))
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


def kind_bars(kinds):
    """Parity by kind of question: how much of each kind the swarm answers as the larger model does."""
    names = list(kinds)
    w, h, l, b = 640, 210, 8, 34
    step = (w - 2 * l) / max(1, len(names))
    bw = min(34, step * 0.5)
    full = h - b - 12
    out = ['<svg viewBox="0 0 %d %d" role="img" aria-label="Parity by kind of question">' % (w, h)]
    for i, name in enumerate(names):
        k = kinds[name]
        x = l + step * i + step / 2
        share = k["s"] / k["n"] if k["n"] else 0
        ss = max(full * share, bw)
        colour = "#1e9e8e" if k["s"] == k["n"] else "#f9c440" if share >= 0.5 else "#f2644b"
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="#e3efeb"/>' % (x - bw / 2, h - b - full, bw, full, bw / 2))
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s"><title>%s: equivalent on %d of %d</title></rect>' % (x - bw / 2, h - b - ss, bw, ss, bw / 2, colour, e(name), k["s"], k["n"]))
        out.append('<text x="%.1f" y="%d" text-anchor="middle">%s</text>' % (x, h - 12, e(name.upper())))
    out.append("</svg>")
    return "".join(out)


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
    out.append(kpi("Parity with " + short, "Yes" if p["level"] else "Not yet", "every answer equivalent" if p["level"] else "%d not equivalent" % off, "scale", "#0b5d57", "#d9f2ec", "up" if p["level"] else "down"))
    out.append(kpi("Equivalent answers", "%d <small>of %d</small>" % (p["equivalent"], p["compared"]), "to " + short, "check", "#149a72", "#d7f3e9"))
    out.append(kpi("Different answers", "%d <small>of %d</small>" % (p["differ"], p["compared"]), "%d gave none" % p["none"], "target", "#f2644b", "#fde1db"))
    out.append(kpi("Seconds a reply", "%s <small>s</small>" % p["seconds"], "the swarm", "clock", "#c98a06", "#fdf0cf"))
    out.append("</div>")

    # pass by pass: how many answers are equivalent, against all of them (which is parity)
    hist = [h for h in d["state"].get("history", []) if h.get("compared")]
    labels = ["pass %s" % h["pass"] for h in hist] + ["now"]
    sw = [h["equivalent"] * p["compared"] / h["compared"] for h in hist] + [p["equivalent"]]
    verdict = '<p class="verdict %s" style="margin-top:12px">%s</p><p class="muted small" style="margin:0">Parity is every answer fundamentally equivalent to %s\'s. On %d held questions the swarm\'s answer was equivalent on %d, different on %d, and it gave none on %d. Whether either was right is not what is measured.</p>' % (
        "level" if p["level"] else "behind", e(("At parity with " if p["level"] else "Not at parity with ") + tname + ("." if p["level"] else ": %d of %d answers are not equivalent." % (off, p["compared"]))), e(tname), p["compared"], p["equivalent"], p["differ"], p["none"])
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
        '<div class="charts"><div class="panel"><div class="chart-head"><div><h3>Equivalent answers by kind of question</h3><div class="muted small">Teal: every answer of that kind is equivalent to %s&#39;s. Otherwise it is not at parity there</div></div></div><div class="kb">%s</div></div>'
        '<div class="panel"><h3>Each alone, beside the swarm</h3><div class="muted small" style="margin-bottom:14px">Equivalent to %s&#39;s answer · different · none</div><div class="score">%s</div></div></div>'
        % (e(short), kind_bars(kinds), e(short), "".join(bars))
    )
    return "".join(out)


def score_strip(d):
    """Parity in one line, the same size whether or not anything is measured. The whole measurement opens from it."""
    held = d["splits"]["held"]
    tgt = d["target"]
    tname = tgt["name"] if tgt else "the larger model"
    p = held["parity"]
    if not held["swarm"] or not p:
        return scoreboard(d)
    off = p["compared"] - p["equivalent"]
    alone = []
    for k, rows in held["alone"].items():
        pa = data.parity(rows) if rows else None
        if pa:
            alone.append("<span>%s alone <b>%d</b></span>" % (e(data.MEMBER_NAMES[k]), pa["equivalent"]))
    return (
        '<button type="button" class="panel strip" id="score-open" title="Open the whole measurement"><p class="verdict %s">%s</p>'
        '<p class="meta"><span><b>%d</b> held questions</span><span><b>%d</b> equivalent</span><span><b>%d</b> different</span><span><b>%d</b> no answer</span>%s<span><b>%s</b> s a reply</span>'
        '<span class="more">Open the whole measurement</span></p></button>'
        % ("level" if p["level"] else "behind", e(("At parity with " if p["level"] else "Not at parity with ") + tname + ("." if p["level"] else ": %d of %d answers are not equivalent." % (off, p["compared"]))),
           p["compared"], p["equivalent"], p["differ"], p["none"], "".join(alone), e(str(p["seconds"])))
    )


FOUND = {"drafts-short": "no slot had the answer", "weak-draft": "a weak drafter", "check-worse": "a checker turning answers away", "decider-threw": "the decider chose another",
         "writer-changed": "the writer changed the answer", "silent": "a slot that said nothing"}
STATUS = {"planned": "Planned", "running": "Being measured", "kept": "Kept", "not kept": "Not kept"}


def read_plan(d):
    """The plan of the pass in hand, for the swarm as it is configured; a plan of another pass or another swarm is not this one."""
    p = data._json(Path(d["root"]) / ".work" / "train" / "plan.json", None)
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


def card(cls, title, purpose, slot_id, sub, extra, body, live=True, opened=False):
    return (
        '<details class="slot %s"%s><summary><div class="id">%s</div><div class="purpose">%s</div><div class="sub">%s</div>%s%s</summary>%s</details>'
        % (e(cls), " open" if opened else "", e(title), e(purpose), "".join(sub), extra,
           '<div class="live" data-live="%s"><i></i><span>Idle</span></div>' % e(slot_id) if live else "", body)
    )


def slot_card(s, d, row=None):
    """A slot: the model that fills it, what it is for in the arrangement, and (with a row) what it wrote for that input."""
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
        t = next((x for x in row.get("trace", []) if x["slot"] == s["id"]), None)
        if not t:
            sub.append("<span>not used on this input</span>")
        else:
            sub.append("<span>%d ms</span>" % t.get("ms", 0))
            if s["stage"] != "write":
                ok = mark_of(t, row)
                fin = '<div><span class="final%s">%s</span></div>' % ("" if ok is None else (" ok" if ok else " no"), e(short(t.get("final")) or "gave no answer"))
            body = '<div class="body">%s</div>' % e(t.get("out") or t.get("why") or "")
    return card(s["member"], data.MEMBER_NAMES.get(s["member"], s["member"]), s.get("purpose") or s["stage"], s["id"], sub, fin, body, live=row is None, opened=row is not None and s["stage"] == "write")


def kev_card(d, row=None):
    """The decision model: the only decider (src/decider.mjs)."""
    if row is None:
        return card("kev", (d.get("decider") or {}).get("name", "Kev"), "Decides which answer stands", "kev-decide", ["<span>kev-decide</span>", "<span>a decision model</span>"], "",
                    '<div class="body">One request, no writing: it is given the question, one worked answer for each different answer and what the checkers said, '
                    "and returns a probability for each answer. No slot judges. If Kev is not running, the answer most slots gave stands. Kev is itself to be trained on the questions the drafts disagreed on.</div>")
    t = next((x for x in row.get("trace", []) if x["slot"] == "kev-decide"), None)
    if not t:
        return card("kev", (d.get("decider") or {}).get("name", "Kev"), "Decides which answer stands", "kev-decide", ["<span>kev-decide</span>", "<span>not asked on this input</span>"], "", "", live=False)
    fin = ""
    if t.get("final"):
        ok = mark_of(t, row)
        fin = '<div><span class="final%s">%s</span></div>' % ("" if ok is None else (" ok" if ok else " no"), e(short(t["final"])))
    bars = "".join('<div><span>%s</span><span style="background:rgba(255,255,255,.6);border-radius:4px"><i style="width:%.0f%%"></i></span><span class="muted">%.2f</span></div>' % (e(k), 100 * float(p), float(p))
                   for k, p in sorted((t.get("probs") or {}).items()))
    return card("kev", (d.get("decider") or {}).get("name", "Kev"), "Decides which answer stands", "kev-decide", ["<span>kev-decide</span>", "<span>%d ms</span>" % t.get("ms", 0)], fin,
                '<div class="body">%s%s</div>' % (e(t.get("out", "")), '<div class="probs">%s</div>' % bars if bars else ""), live=False, opened=True)


def stages(d, row=None):
    out = ['<div class="stages">']
    for key, title in data.STAGES:
        out.append('<div class="stage"><div class="t">%s</div>' % title)
        if key == "decide":
            out.append(kev_card(d, row))
        for s in d["briefs"]["slots"]:
            if s["stage"] == key:
                out.append(slot_card(s, d, row))
        out.append("</div>")
    out.append("</div>")
    return "".join(out)


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
    return '<div class="cols two">%s%s</div><h2 id="strategy">The plan being carried out</h2><div id="plan">%s</div>' % (left, right, plan_panel(d))


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
    left = (
        '<div class="pane"><div class="head"><h3 class="who-swarm">The swarm</h3><span class="muted small">%s%s</span></div>%s'
        '<div class="reply"><div class="lab">Output %s</div>%s</div></div>'
        % (
            ("path: " + e(str(row.get("path", "")))) if row.get("path") else "",
            " · %s s" % row["seconds"] if row.get("seconds") is not None else "",
            stages(d, row),
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


def start_run(passes, each):
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
    out = ['<div class="panel run">']
    # the models are loaded by a session and unloaded when it ends: outside one, nothing should be running
    kev = kev_base()
    installed = (Path(ARGS.root) / ".work" / "kev" / "uvenv" / "bin" / "uv").exists()
    note = lambda cls, text: '<div class="state %s"><i></i><span>%s</span></div>' % (cls, text)  # noqa: E731
    if st and st["running"]:
        out.append('<div class="state on" data-running="1"><i></i><span>Running since %s</span></div>' % e(st["at"][11:16]))
        out.append('<button class="btn stop top wide" id="run-stop" type="button">Stop training</button>')
        out.append('<div class="facts"><div><small>Passes</small><b>%d</b></div><div><small>Per kind</small><b>%d</b></div><div><small>Kev</small><b>%s</b></div></div>' % (st["passes"], st["each"], "loaded" if kev else "loading"))
    else:
        why = cannot_run()
        opts = "".join('<option value="%d">%d</option>' % (n, n) for n in (1, 2, 3, 5))
        each = "".join('<option value="%d"%s>%d</option>' % (n, " selected" if n == 6 else "", n) for n in (2, 4, 6, 8, 10))
        out.append('<button class="btn top wide" id="run-go" type="button"%s>Run training</button>' % (" disabled" if why else ""))
        out.append('<div class="facts"><label><small>Passes</small><select id="run-passes">%s</select></label><label><small>Per kind</small><select id="run-each">%s</select></label></div>' % (opts, each))
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
        if busy and not any((Path(ARGS.root) / ".work" / "train").glob("pass-*/status.txt") and (d2.stat().st_mtime * 1000 > su.get("at", 0) for d2 in (Path(ARGS.root) / ".work" / "train").glob("pass-*/status.txt"))):
            rows = ""
            for x in su.get("steps", []):
                of = x.get("of") or 0
                pct = (100.0 * x.get("done", 0) / of) if of and x.get("done") is not None else None
                what = "ready" if x["state"] == "ready" else x.get("why") or (("%.1f of %.1f GB" % (x.get("done", 0) / 2**30, of / 2**30)) if pct is not None else x.get("note") or x["state"])
                rows += '<li class="%s"><span>%s</span><span>%s<small style="display:block;color:var(--mist);font-weight:600">%s</small>%s</span><span></span></li>' % (
                    "" if x["state"] == "ready" else "bad" if x["state"] == "failed" else "now", "✓" if x["state"] == "ready" else "✕" if x["state"] == "failed" else "▸", e(x["what"]), e(str(what)),
                    '<span class="track" style="display:block;height:5px;border-radius:3px;background:var(--soft);margin-top:4px"><i style="display:block;height:100%%;border-radius:3px;background:var(--teal2);width:%.1f%%"></i></span>' % pct if pct is not None and x["state"] != "ready" else "")
            out.append('<div class="muted small">Making ready</div><ul class="steps">%s</ul>' % rows)
    # the steps of the newest pass this page started
    if st:
        root = Path(ARGS.root)
        dirs = sorted((d for d in (root / ".work" / "train").glob("pass-*") if d.is_dir() and d.name[5:].isdigit() and int(d.name[5:]) >= st.get("first", 0)), key=lambda d: int(d.name[5:]))
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
                bad = done and not x["end"].startswith("exit 0")
                items.append('<li class="%s"><span>%s</span><span>%s</span><span class="muted">%s</span></li>' % (
                    "bad" if bad else "" if done else "now", "✕" if bad else "✓" if done else "▸", e(name),
                    e((x["end"].replace("exit 0 ", "").replace("exit 2 ", "nothing to do · ") if done else "since " + x["at"]) + (" · try %d" % x["tries"] if x.get("tries", 1) > 1 else ""))))
            out.append('<div class="muted small">Pass %s%s</div><ul class="steps">%s</ul>' % (e(cur.name[5:]), " of this run's %d" % st["passes"] if st["passes"] > 1 else "", "".join(items) or "<li><span></span><span class='muted'>starting</span><span></span></li>"))
    # THE WAYS BACK THIS SESSION HAS TAKEN: a pass that needed twelve restarts is not the same evidence as one that needed none
    if st:
        began = _epoch_local(st.get("at", ""))
        took = [r for r in data._rows(Path(ARGS.root) / ".work" / "train" / "recovery.jsonl") if _epoch(r.get("at")) >= began - 2]
        if took:
            rows = "".join('<li><span>↺</span><span>%s<small style="display:block;color:var(--mist);font-weight:600">%s</small></span><span></span></li>' % (e(str(r.get("what", ""))), e(str(r.get("did", "")))) for r in took[-5:])
            out.append('<div class="muted small">Recovered %d time%s this session</div><ul class="steps">%s</ul>' % (len(took), "" if len(took) == 1 else "s", rows))
    out.append("</div>")
    return "".join(out)


def _epoch(iso):
    """Seconds since 1970 of a time written as the trainers write it (UTC, ISO); 0 when it cannot be read."""
    try:
        import calendar
        return calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, TypeError):
        return 0


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
           e("%d of %d equivalent" % (h["equivalent"], h["compared"]) if h.get("compared") else "nothing to compare"),
           "up" if h.get("level") else "down", "parity" if h.get("level") else ("%d differ" % (h["compared"] - h["equivalent"])) if h.get("compared") else "n/a")
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
    gb = lambda m: " · %.1f GB" % (m["bytes"] / 2**30) if m.get("bytes") else ""  # noqa: E731

    def pill(key, label, lst, chosen, group=None):
        opts = ""
        makers = list(dict.fromkeys(m.get("by", "").split(",")[0] for m in lst))
        for maker in makers:
            opts += '<optgroup label="%s">' % e(maker)
            for m in lst:
                if m.get("by", "").split(",")[0] != maker:
                    continue
                opts += '<option value="%s"%s>%s%s%s</option>' % (e(m["id"]), " selected" if chosen and m["id"] == chosen.get("id") else "", e(m["name"]), " · %sB" % m["params"] if m.get("params") else "", gb(m))
            opts += "</optgroup>"
        return '<label class="pick %s"><small>%s</small><select data-pick="%s"%s aria-label="%s">%s</select></label>' % (key, e(label), key, " disabled" if running else "", e(label), opts)

    return (
        '<div class="picks" id="picks">%s%s%s%s<button class="pick spec" id="spec-open" type="button"><small>The swarm as it stands</small><b>Output spec</b></button></div>'
        % (pill("a", "Small model 1", reg["small"], d["members"]["a"]), pill("b", "Small model 2", reg["small"], d["members"]["b"]),
           pill("decider", "Decides", reg["deciders"], d["decider"]), pill("target", "Larger model: the target", sorted(reg["targets"], key=lambda t: -t.get("params", 0)), d["target"]))
    )


def spec_panel(d):
    """The output spec, for a person to read and to copy: what the configured swarm is, and where it stands against its target."""
    sp = data.spec(d)
    t = sp["trainedAgainst"]
    row = lambda k, v: "<tr><th>%s</th><td>%s</td></tr>" % (e(k), v)  # noqa: E731
    mem = lambda m: "%s <span class='muted'>· %s · %sB · %s</span><br><code>%s @ %s</code><br><code>%s</code> <span class='muted'>%.2f GB</span><br><code>sha256 %s</code>" % (  # noqa: E731
        e(m.get("name", "")), e(m.get("by", "")), e(str(m.get("params", ""))), e(m.get("license", "")), e(m.get("repo", "")), e(str(m.get("rev", ""))[:12]), e(m.get("file", "")), m.get("bytes", 0) / 2**30, e(m.get("sha256", "")))
    state_cls = "level" if t["state"] == "at parity" else "behind"
    kinds = "".join("<li>%s: %d of %d equivalent</li>" % (e(k), v["equivalent"], v["of"]) for k, v in t["byKind"].items()) or "<li>not measured</li>"
    slots = "".join("<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td>%s</td></tr>" % (e(x["id"]), e(x["stage"]), e(x.get("purpose", "")), e(str(x.get("model", "")))) for x in sp["arrangement"]["slots"])
    return (
        '<div class="spec-head"><div><div class="kicker">Output spec</div><h3 style="font-size:24px">%s</h3><div class="muted small">%s</div></div>'
        '<div style="display:flex;gap:8px"><button class="btn top" id="spec-copy" type="button">Copy as JSON</button><button class="btn stop top" id="spec-close" type="button">Close</button></div></div>'
        '<p class="verdict %s" style="margin:14px 0 2px">%s against %s.</p><p class="muted small" style="margin:0 0 12px">%s</p>'
        "<table class='spec'>%s%s%s%s%s%s%s%s</table>"
        "<h4>The arrangement (briefs v%s)</h4><table class='spec'><tr><th>Slot</th><th>Stage</th><th>What it is for</th><th>Model</th></tr>%s"
        "<tr><td><code>kev-decide</code></td><td>decide</td><td>Decides which answer stands</td><td>%s</td></tr></table>"
        '<h4>As JSON</h4><pre class="tail" id="spec-json" style="max-height:320px">%s</pre>'
        % (
            e(sp["id"]), e(sp["what"]),
            state_cls, e(t["state"].capitalize()), e(t["target"].get("name") or ""),
            e(t["parityMeans"]),
            row("In", e(sp["interface"]["in"])), row("Out", e(sp["interface"]["out"])),
            row("Offered as", "<br>".join(e(x) for x in sp["interface"]["as"])),
            row("Not yet", "<br>".join(e(x) for x in sp["interface"]["notYet"])),
            row("Small model 1 (place a)", mem(sp["members"]["a"])), row("Small model 2 (place b)", mem(sp["members"]["b"])),
            row("Decides", "%s <span class='muted'>· %s · %s</span><br><code>%s</code>" % (e(sp["decider"].get("name") or ""), e(sp["decider"].get("by") or ""), e(sp["decider"].get("license") or ""), e(sp["decider"].get("run") or ""))),
            row("Against %s" % e(t["target"].get("name") or ""), ("%d held questions: %d equivalent, %d different, %d no answer<ul style='margin:6px 0 0;padding-left:18px'>%s</ul>" % (t["heldQuestions"], t["equivalent"], t["different"], t["noAnswer"], kinds)) if t["state"] != "not measured" else "Not measured: no pass has put this swarm and this target to the same held questions.")
            + row("Served", "%d slots on each small model, %d tokens of context a slot; about %s GB of memory (an estimate); engine %s %s" % (sp["serving"]["slots"], sp["serving"]["contextPerSlot"], sp["serving"]["memoryGbEstimate"], e(sp["engine"].get("name") or ""), e(sp["engine"].get("version") or ""))),
            e(str(sp["arrangement"]["briefsVersion"])), slots, e(sp["decider"].get("id") or ""),
            e(json.dumps(sp, indent=2)),
        )
    )


def main_body(d):
    """Everything that depends on which models are chosen: drawn again, in place, when one is changed."""
    first = next((k for k in ("held", "train") if d["splits"][k]["swarm"]), "")
    return (
        '<h2>Parity with the larger model</h2><div id="score">%s</div>'
        '<h2 id="arrangement">The arrangement being trained, and the larger model alongside</h2>%s%s'
        % (score_strip(d), arrangement(d), ('<h2 id="input">Input against output</h2><div class="io" id="io">%s</div>' % qlist(d, first)) if first else "")
    )


def page(d):
    st, t = d["state"], d["target"]
    p = d["splits"]["held"]["parity"]
    chips = ['<span class="chip">Pass <b>%s</b></span>' % e(str(st.get("pass", 0) + 1))]
    if p:
        chips.append('<span class="chip %s">%s</span>' % ("level" if p["level"] else "behind", "At parity" if p["level"] else "Not at parity: <b>%d</b> differ" % (p["compared"] - p["equivalent"])))
    banner = '<div class="banner">Sample data, made up to show the layout. It is not a measurement of anything.</div>' if d["sample"] else ""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>The Swarm</title><style>%s</style></head><body><div class="shell">'
        '<main id="top"><header><div><div class="kicker">The Swarm · training overview</div><h1>Training Dashboard</h1></div><div class="chips" id="chips">%s</div></header>%s%s'
        '<div id="body">%s</div>'
        '%s</main>%s</div><dialog id="spec"><div id="spec-body"></div></dialog>'
        '<dialog id="big"><div class="spec-head"><div><div class="kicker">Parity with the larger model</div><h3 style="font-size:22px;margin-top:4px">The whole measurement</h3></div>'
        '<button class="btn stop top" id="big-close" type="button">Close</button></div><div id="big-body"></div></dialog><script>%s</script></body></html>'
        % (CSS, "".join(chips), pills(d), banner, main_body(d), footer(), rail(d), JS)
    )


# ---------------------------------------------------------------- the server
class Handler(BaseHTTPRequestHandler):
    def _send(self, body, code=200, kind="text/html; charset=utf-8"):
        raw = body.encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(raw)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

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
        if u.path == "/fragment/picks":
            return self._send(pills(d))
        if u.path == "/fragment/run":
            return self._send(run_panel())
        if u.path == "/fragment/score":
            return self._send(score_strip(d))
        if u.path == "/fragment/scorefull":
            return self._send(scoreboard(d))
        if u.path == "/fragment/plan":
            return self._send(plan_panel(d))
        if u.path == "/fragment/list":
            return self._send(qlist(d, split))
        if u.path == "/fragment/question":
            return self._send(question(d, split, q.get("id", "")))
        return self._send("Not here.", 404, "text/plain; charset=utf-8")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/run/start", "/run/stop", "/config"):
            return self._send("Not here.", 404, "text/plain; charset=utf-8")
        # only this page may start or stop a pass: another website can send a plain form to this address, but it cannot
        # send this header, and a request that names another origin is refused
        origin = self.headers.get("origin", "")
        if self.headers.get("x-swarm") != "1" or (origin and urlparse(origin).netloc != self.headers.get("host", "")):
            return self._send("Not from this page.", 403, "text/plain; charset=utf-8")
        if path == "/config":
            # a model chosen in one of the pills: written to src/config.json, unless a session is running or it is not one that can be chosen
            if (run_state() or {}).get("running"):
                return self._send("A session is running: stop it before changing a model.", 409, "text/plain; charset=utf-8")
            try:
                asked = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
            except ValueError:
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            root = Path(ARGS.root)
            reg = data._json(root / "src" / "models.json", {})
            now = data._json(root / "src" / "config.json", {})
            for key, lst in (("a", "small"), ("b", "small"), ("decider", "deciders"), ("target", "targets")):
                if key in asked:
                    if not any(m.get("id") == asked[key] for m in reg.get(lst, [])):
                        return self._send("There is no %s called that." % key, 400, "text/plain; charset=utf-8")
                    now[key] = asked[key]
            (root / "src" / "config.json").write_text(json.dumps(now, indent=2) + "\n")
            return self._send(main_body(data.load(ARGS.root)))
        if path == "/run/start":
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 2000)) or b"{}")
                passes = max(1, min(5, int(body.get("passes", 1))))
                each = max(2, min(10, int(body.get("each", 6))))
            except (ValueError, TypeError, AttributeError):
                return self._send("Not understood.", 400, "text/plain; charset=utf-8")
            start_run(passes, each)
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
