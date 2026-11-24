"""search_made.py - A SEARCH TASK MADE FROM A SEED, asked through the Python client. The rules a search is carried by (SwOA T.13b) were written after reading 20 questions
of one standard test. This makes its own: countries, capitals, mayors and years that do not exist, made from a seed, each
fact on a page of a made-up web; a search tool that ranks those pages by the words of the query and returns the sentence of
each that matches best; a tool that opens a page. Every question chains two facts ("who is the mayor of the capital of X?"),
so no model can know the answer and one search of the whole question seldom returns it. The module is asked turn by turn,
as an agent's harness asks, and is right where its last message holds the answer.
    python3 python/search_made.py [--repo .] [--n 30] [--seed 7] [--label run]      (from the checkout)
Needs the models of the configured swarm on the machine, and free. Writes .work/search-made.<label>.json and prints one line of totals.
"""
import argparse, json, random, re, sys, time
from pathlib import Path
ap = argparse.ArgumentParser(); ap.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent)); ap.add_argument("--n", type=int, default=30)
ap.add_argument("--seed", type=int, default=7); ap.add_argument("--label", default="run"); ap.add_argument("--models", default=""); ap.add_argument("--most", type=int, default=8)
A = ap.parse_args()
sys.path.insert(0, str(Path(__file__).resolve().parent))
from the_swarm import Swarm  # noqa: E402

R = random.Random(A.seed)
SYL = ["ar", "bel", "cor", "dun", "esk", "fal", "gim", "hol", "ist", "jor", "kel", "lum", "mor", "nev", "ost", "pra", "quil", "ros", "sev", "tam", "ul", "ven", "wex", "yar", "zim"]
def name(k=3): return "".join(R.choice(SYL) for _ in range(k)).capitalize()
world = []; pages = {}
for i in range(A.n):
    c, k, m1, m2, y = name(), name(), name(2), name(2), R.randint(1100, 1950)
    river, crop = name(2), R.choice(["barley", "saffron", "flax", "plums", "walnuts", "rye"])
    pages["https://atlas.example/country/%s" % c.lower()] = ("%s (country)" % c, ["%s is a country of the northern plain." % c, "The capital of %s is %s." % (c, k), "The chief crop of %s is %s." % (c, crop), "The longest river of %s is the %s." % (c, river)])
    pages["https://atlas.example/city/%s" % k.lower()] = ("%s (city)" % k, ["%s is a city on the %s." % (k, river), "The mayor of %s is %s %s." % (k, m1, m2), "%s was founded in the year %d." % (k, y), "%s is known for its covered market." % k])
    kind = i % 2
    world.append({"q": ("Who is the mayor of the capital of %s?" % c) if kind == 0 else ("In what year was the capital of %s founded?" % c), "want": ("%s %s" % (m1, m2)) if kind == 0 else str(y), "country": c, "capital": k})
words = lambda s: set(re.findall(r"[a-z0-9]+", s.lower())) - {"the", "of", "is", "a", "in", "what", "who", "was", "for", "its", "on"}
import math
def _df():
    df = {}
    for url, (title, sents) in pages.items():
        for w in words(" ".join(sents) + " " + title): df[w] = df.get(w, 0) + 1
    return df
DF = None
def search(q, most=3):
    # (as an engine ranks: a word found on few pages counts for more than one found on all of them)
    global DF
    DF = DF or _df(); n = len(pages); idf = lambda w: math.log(1 + n / DF.get(w, n))
    qs = words(q); ranked = []
    for url, (title, sents) in pages.items():
        pw = words(" ".join(sents) + " " + title)
        if not (pw & qs): continue
        best = max(sents, key=lambda s: sum(idf(w) for w in words(s) & qs))
        ranked.append((sum(idf(w) for w in pw & qs) + sum(idf(w) for w in words(best) & qs), url, title, best))
    ranked.sort(key=lambda x: -x[0])
    return [{"title": t, "href": u, "body": b} for _, u, t, b in ranked[:most]]
TOOLS = [{"type": "function", "function": {"name": "web_search", "description": "Search the web for a query and return the best matching pages.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "What to search for."}}, "required": ["query"]}}},
         {"type": "function", "function": {"name": "open_page", "description": "Open a page by its address and return its text.", "parameters": {"type": "object", "properties": {"url": {"type": "string", "description": "The address of the page."}}, "required": ["url"]}}}]
def run_tool(c):
    f = c.get("function") or {}
    try: a = json.loads(f.get("arguments") or "{}")
    except ValueError: a = {}
    if f.get("name") == "web_search": return "search", str(search(str(a.get("query") or "")))
    if f.get("name") == "open_page":
        p = pages.get(str(a.get("url") or "").rstrip("/"))
        return "page", (p[0] + "\n" + " ".join(p[1])) if p else "No such page."
    return "other", "No such tool."
out = []; t0 = time.time()
with Swarm(repo=A.repo, models=A.models or None, wait=600) as s:
    for w in world:
        msgs = [{"role": "user", "content": w["q"]}]; steps = []; last = ""; seen = ""; asked = []
        for _ in range(A.most):
            try: m = s.chat(msgs, tools=TOOLS)["choices"][0]["message"]
            except Exception as e:  # noqa: BLE001
                last = "FAILED: %s" % e; break
            calls = m.get("tool_calls") or []
            if not calls: last = m.get("content") or ""; break
            msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
            for c in calls:
                kind, text = run_tool(c); steps.append(kind); seen += " " + text; asked.append((c.get("function") or {}).get("arguments"))
                msgs.append({"role": "tool", "tool_call_id": c.get("id"), "content": text})
        right = w["want"].lower() in last.lower()
        out.append({"q": w["q"], "want": w["want"], "right": right, "steps": steps, "retrieved": w["want"].lower() in seen.lower(), "asked": asked, "last": last[:200]})
        print(("ok  " if right else "miss"), len(steps), "steps", "| retrieved" if out[-1]["retrieved"] else "| never retrieved", "|", last[:70].replace("\n", " "), flush=True)
n = len(out); r = sum(x["right"] for x in out)
tot = {"label": A.label, "repo": str(Path(A.repo).resolve()), "n": n, "right": r, "noSearch": sum(1 for x in out if not x["steps"]), "retrieved": sum(x["retrieved"] for x in out),
       "searches": round(sum(x["steps"].count("search") for x in out) / n, 2), "pages": round(sum(x["steps"].count("page") for x in out) / n, 2), "minutes": round((time.time() - t0) / 60, 1)}
OUT = Path(A.repo).resolve() / ".work"
OUT.mkdir(exist_ok=True)
(OUT / ("search-made.%s.json" % A.label)).write_text(json.dumps({"totals": tot, "rows": out}, indent=1))
print("TOTAL", json.dumps(tot))
