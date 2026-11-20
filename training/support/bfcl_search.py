"""bfcl_search.py - THE TOOL TESTS, RUN WITH THIS MACHINE'S OWN SEARCH BEHIND THEM.

The Berkeley Function-Calling Leaderboard's web search test offers a model two functions, search_engine_query and
fetch_url_content, and runs them itself. Its own search_engine_query asks a paid service (SerpAPI), with a key. Its README says
the search may be changed by changing that function. This does that without touching the package: it is the program the tool
tests are started through (training/support/bfcl.mjs), run with the package's own Python, and where SWARM_SEARCH_URL names a
SearXNG (training/search.json; training/support/search.mjs serves one for the length of a run) it puts another
search_engine_query in the function's place before the package's own command line runs. Nothing else of the test changes: the
functions a model is offered, their descriptions and arguments, the questions, the checker.

  SWARM_SEARCH_URL     the address of the SearXNG to ask (none: the package runs exactly as it is)
  SWARM_SEARCH_CACHE   a folder: what each query returned, and each page fetched, is kept there and given again. The larger
                       model and the swarm are asked on the same day with the same folder, so the same query gives both the
                       same results, and the same address the same page, whichever asked first
  SWARM_SEARCH_TRIES   how often a search that returned nothing is asked again before that is the answer (3)
  SWARM_SEARCH_PAGE_CHARS  the most of a fetched page a model is given, in characters (none or 0: all of it). A page is kept
                       whole and cut as it is given, the same for the larger model and the swarm, and says where it was cut
  SWARM_SEARCH_RESULTS_MOST  the most results a search gives, however many were asked for (none or 0: as many as asked)

What goes back to the model is the shape the package's own function gives: a list of { title, href, body } (no body where the
test says snippets are not shown), cut at max_results; or { error } where nothing could be found.

The parts that need no package (the shape, the language of a region, what is kept) are plain functions, so that they are checked
without one (ui/check.py).
"""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NOTHING = "Failed to retrieve the search results from server. Please try again later."  # (the package's own words for it)


def language_of(region):
    """The region the test's function takes (DuckDuckGo's: country-language, wt-wt for none) as the language SearXNG takes."""
    parts = str(region or "").lower().split("-")
    if len(parts) != 2 or parts[0] in ("wt", "xa", "xl"):
        return "all"
    country, lang = parts
    lang = {"tzh": "zh", "tl": "tl"}.get(lang, lang)
    if len(lang) != 2:
        return "all"
    country = {"uk": "GB", "ue": "US"}.get(country, country.upper())
    return "%s-%s" % (lang, country) if len(country) == 2 else lang


def to_results(found, max_results=10, show_snippet=True):
    """SearXNG's results as the test's function returns them: title, href and (where snippets are shown) body."""
    out = []
    for r in found or []:
        if not r.get("title") or not is_page(r.get("url")):
            continue
        row = {"title": str(r["title"]), "href": str(r["url"])}
        if show_snippet:
            row["body"] = str(r.get("content") or "")
        out.append(row)
        if len(out) >= int(max_results or 10):
            break
    return out


def fewest(asked, most):
    """How many results a search gives: as many as were asked for, and never more than `most` (none or 0: no limit)."""
    asked = int(asked or 10)
    most = int(most or 0)
    return min(asked, most) if most > 0 else asked


def is_page(url):
    """An address a page can be fetched from: http or https, with a host."""
    try:
        u = urllib.parse.urlparse(str(url or ""))
    except ValueError:
        return False
    return u.scheme in ("http", "https") and bool(u.netloc)


def kept(folder, key, make):
    """What `make()` returns, kept in `folder` under `key` and given again from there the next time (no folder: not kept)."""
    if not folder:
        return make()
    path = os.path.join(folder, hashlib.sha256(key.encode("utf8")).hexdigest()[:32] + ".json")
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)["value"]
    except (OSError, ValueError, KeyError):
        pass
    value = make()
    os.makedirs(folder, exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump({"key": key, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "value": value}, f)
    os.replace(tmp, path)
    return value


def ask_searxng(base, keywords, language):
    """One query to SearXNG's JSON output: { results: [...], unresponsive_engines: [...] }."""
    url = base.rstrip("/") + "/search?" + urllib.parse.urlencode({"q": keywords, "format": "json", "language": language, "safesearch": 0})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=60) as r:
        return json.loads(r.read().decode("utf8"))


def search(base, folder, keywords, max_results=10, region="wt-wt", show_snippet=True, ask=ask_searxng, tries=None, wait=time.sleep):
    """search_engine_query, through SearXNG. A query's results are kept whole (before they are cut and shaped), so the same query
    gives the same results whatever was asked of them. One that returns nothing is asked again a few times; then that is its
    answer, for both models alike."""
    tries = int(tries or os.environ.get("SWARM_SEARCH_TRIES") or 3)
    language = language_of(region)

    def make():
        last = ""
        for k in range(tries):
            try:
                got = ask(base, keywords, language)
                # (a result is a page with an address: a redirect an engine hands over with no host in it is not one)
                rows = [{"title": r.get("title"), "url": r.get("url"), "content": r.get("content"), "engines": r.get("engines") or [r.get("engine")]}
                        for r in got.get("results") or [] if r.get("title") and is_page(r.get("url"))]
                if rows:
                    return {"results": rows}
                last = "no results (engines that did not answer: %s)" % json.dumps(got.get("unresponsive_engines") or [])
            except (urllib.error.URLError, OSError, ValueError) as e:
                last = str(e)
            if k + 1 < tries:
                wait(2 * (k + 1))
        return {"results": [], "why": last}

    found = kept(os.path.join(folder, "queries") if folder else "", json.dumps({"q": keywords, "language": language}, sort_keys=True), make)
    rows = to_results(found.get("results"), fewest(max_results, os.environ.get("SWARM_SEARCH_RESULTS_MOST")), show_snippet)
    return rows if rows else {"error": NOTHING}


def cut_page(got, most):
    """What the test's page function returned, with its content cut at `most` characters and a line saying so: the same cut for
    whoever asked. A page that fits, an error, or no limit: as it came."""
    most = int(most or 0)
    if most <= 0 or not isinstance(got, dict) or not isinstance(got.get("content"), str) or len(got["content"]) <= most:
        return got
    # THE CUT BEGINS WHERE THE PAGE'S OWN WORDS BEGIN: a page opens with its menus (measured 2026-11-19: of four pages fetched,
    # three gave 2000 characters of "Jump to content / Main menu / 81 languages" and the article began after the cut). So what
    # is given is from the first line that reads as prose, a line of 200 characters or more with twenty words or more, where
    # there is one past the opening; the page's first line, its title, is kept before it. The same for whoever asked.
    text = got["content"]
    lines = text.split("\n")
    at = next((i for i, l in enumerate(lines) if len(l.strip()) >= 200 and len(l.split()) >= 20), 0)
    if at > 0:
        first = next((l.strip() for l in lines if l.strip()), "")
        body = "\n".join(lines[at:])
        return dict(got, content=(first[:200] + "\n[The page's menus are left out.]\n" if first else "") + body[:most]
                    + ("\n[The page goes on: only %d characters of it are given, of %d.]" % (most, len(text)) if len(body) > most else ""))
    return dict(got, content=got["content"][:most] + "\n[The page goes on: only its first %d characters are given, of %d.]" % (most, len(got["content"])))


def install(base, folder):
    """Put this search in the place of the package's own, and keep what each page fetch returned."""
    from bfcl_eval.eval_checker.multi_turn_eval.func_source_code import web_search as ws

    own_fetch = ws.WebSearchAPI.fetch_url_content

    def search_engine_query(self, keywords, max_results=10, region="wt-wt"):
        return search(base, folder, keywords, max_results, region, getattr(self, "show_snippet", True))

    def fetch_url_content(self, url, mode="raw"):
        page = kept(os.path.join(folder, "pages") if folder else "", json.dumps({"url": url, "mode": mode}, sort_keys=True), lambda: own_fetch(self, url, mode))
        return cut_page(page, os.environ.get("SWARM_SEARCH_PAGE_CHARS"))

    search_engine_query.__doc__ = ws.WebSearchAPI.search_engine_query.__doc__
    fetch_url_content.__doc__ = own_fetch.__doc__
    ws.WebSearchAPI.search_engine_query = search_engine_query
    ws.WebSearchAPI.fetch_url_content = fetch_url_content


if __name__ == "__main__":
    if os.environ.get("SWARM_SEARCH_URL"):
        install(os.environ["SWARM_SEARCH_URL"], os.environ.get("SWARM_SEARCH_CACHE") or "")
    from bfcl_eval.__main__ import cli

    sys.argv = ["bfcl"] + sys.argv[1:]
    cli()
