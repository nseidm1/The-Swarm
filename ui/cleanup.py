"""cleanup.py - WHAT THE SWARM HAS PUT ON THIS MACHINE, AND TAKING OUT WHAT IS NOT WANTED (the Uninstall Helper on the page).

Everything the Swarm fetches lives inside this folder's .work: the small models and larger models it downloads, the llama.cpp
build, each decider's program, Python and weights, and what training keeps to resume and to avoid measuring twice. This lists it,
one piece at a time, with how much room each takes and whether the swarm as it is configured uses it, and removes a piece when
asked. A piece the configured swarm uses can be removed: Train fetches it again.

What it never does:
  - remove anything outside .work (a path is taken out only when it resolves inside it, and only by an id from this list)
  - follow a link: a model file that is a link (to The Crew's copy, say) is removed as a link, and what it points at is kept
  - remove what training has LEARNED (src/learned, training/states): that is not an install, and it is not listed
  - remove anything while a session runs, or a decider's files while that decider is loaded
Things kept outside this folder by another program (TensorFold's models in ~/.tensorfold, a llama-server on the PATH) are listed
with where they are, so that a person knows they exist, and are not removed from here.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


def _size(p):
    """Bytes a path takes, its links counted as links (never what they point at)."""
    try:
        st = os.lstat(p)
    except OSError:
        return 0
    if os.path.islink(p) or not os.path.isdir(p):
        return st.st_size
    # a folder: du, which counts links as links and is many times faster over a package cache of a hundred thousand files
    try:
        r = subprocess.run(["du", "-sk", str(p)], capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and r.stdout.split():
            return int(r.stdout.split()[0]) * 1024
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    total = 0
    for base, dirs, files in os.walk(p, followlinks=False):
        for name in files + [x for x in dirs if os.path.islink(os.path.join(base, x))]:
            try:
                total += os.lstat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return total


def gb(n):
    return "%.1f GB" % (n / 2**30) if n >= 2**30 * 0.1 else "%d MB" % max(1, round(n / 2**20)) if n >= 2**20 else "%d KB" % max(1, round(n / 1024))


def _read_json(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def inventory(root, d):
    """[{id, group, what, paths, bytes, used, note, removable}] of what is installed here, largest first within each group."""
    root = Path(root)
    work = root / ".work"
    reg = d.get("registry") or {}
    members = d.get("members") or {}
    # (a model that is a folder of files, as one TensorFold serves is, is known by its folder: `dir`)
    used_files = {m.get("dir") or m.get("file") for m in members.values() if m}
    target = d.get("target") or {}
    decider = d.get("decider") or {}
    dkind = (decider.get("serve") or {"kind": "kev"}).get("kind")
    out = []

    def add(id_, group, what, paths, used=False, note="", removable=True):
        paths = [p for p in paths if os.path.lexists(p)]
        if not paths:
            return
        out.append({"id": id_, "group": group, "what": what, "paths": [str(p) for p in paths], "bytes": sum(_size(p) for p in paths),
                    "used": used, "note": note, "removable": removable})

    # the model files the swarm fetched (small models and the larger models served from a GGUF file)
    names = {}
    for m in reg.get("small", []):
        names[m.get("dir") or m.get("file")] = ("Small model", m["name"])
    for m in reg.get("targets", []):
        if m.get("file"):
            names[m["file"]] = ("Larger model", m["name"])
    models = work / "models"
    if models.is_dir():
        for f in sorted(models.iterdir()):
            kind, name = names.get(f.name, ("Model file", f.name))
            link = os.path.islink(f)
            add("model:" + f.name, "Models", "%s: %s" % (kind, name), [f],
                used=f.name in used_files or f.name == target.get("file"),
                note=("A link to %s: only the link is removed, the file it points at is kept." % os.readlink(f)) if link
                else ("%s: the folder of files TensorFold serves it from" % f.name) if f.is_dir() else f.name)
    # the llama.cpp build the swarm fetched, where it fetched one
    add("engine", "Programs", "The engine (llama.cpp)", [work / "engine"], used=True, note="Train fetches it again where no llama-server is on the PATH.")
    # the adapter trainer (training/mlx-setup.sh): MLX and the small models' original weights it trains from
    add("mlx:program", "Programs", "MLX: the adapter trainer and its Python", [work / "mlx" / p for p in ("venv", "python", "uv-cache", "hf-home")],
        note="Only Pretrain uses it, and installs it again the next time.")
    # each small model's original weights (training/originals.json): what an adapter is trained from, one entry each, so that the
    # ones the swarm is made of can be kept and the rest taken out; anything else in the folder is listed with them
    # (the folder's own list, or this repository's where the folder has none: a copy of its data)
    origs = (_read_json(root / "training" / "originals.json") or _read_json(Path(__file__).resolve().parent.parent / "training" / "originals.json") or {}).get("models", {})
    known = set()
    for f, o in origs.items():
        known.add(o.get("dir"))
        name = next((m.get("name") for m in reg.get("small", []) if m.get("file") == f), o.get("dir"))
        add("mlx:weights:" + str(o.get("dir")), "Pretrain", "%s: original weights" % name, [work / "mlx" / "hf" / str(o.get("dir"))], used=f in used_files,
            note="What Pretrain trains its adapter from (the swarm itself serves the GGUF file); Pretrain fetches them again.")
    other = [p for p in sorted((work / "mlx" / "hf").iterdir()) if p.name not in known] if (work / "mlx" / "hf").is_dir() else []
    add("mlx:weights:other", "Pretrain", "Original weights of models no longer listed", other, note="Fetched for a model that is no longer one Pretrain trains.")
    # the adapters Pretrain trained (.work/library/adapters/<larger model>/<model>): small, and what Serve with adapters serves
    ad = work / "library" / "adapters"
    for tdir in sorted(ad.iterdir()) if ad.is_dir() else []:
        if not tdir.is_dir():
            continue
        cfg = _read_json(root / "src" / "config.json") or {}
        add("adapters:" + tdir.name, "Pretrain", "Adapters trained on %s's answers" % next((m.get("name") for m in reg.get("targets", []) if m.get("id") == tdir.name), tdir.name),
            [tdir], used=bool(cfg.get("adapters")) and tdir.name == target.get("id"),
            note="One for each small model Pretrain adapted. Removed, the swarm is served without them until Pretrain runs again.")
    # Evaluate the swarm (training/evaluate.sh): the harness, the benchmarks it fetched, and what each evaluation asked
    add("lmeval:program", "Programs", "lm-evaluation-harness: the evaluator, its Python and the benchmarks", [work / "lmeval"],
        note="Only Evaluate the swarm uses it; it is installed again, and the benchmarks fetched again, the next time.")
    add("bfcl:program", "Programs", "The tool tests (bfcl-eval): the evaluator of calling functions and searching, and its Python", [work / "bfcl"],
        note="Only Evaluate the swarm uses it, and only where a body of work measured by it is asked (Tools, Search; a proof run asks both); it is installed again the next time.")
    add("searxng:program", "Programs", "SearXNG: the search behind the web search test, and its Python", [work / "searxng"],
        note="Only Evaluate the swarm uses it, and only for the web search test (Search; a proof run asks it): served on this machine while that runs, with no key. It is installed again the next time. Nothing of it is in the swarm.")
    add("eval:answers", "Training", "Evaluations: every answer each model gave", [work / "eval" / p for p in ("runs", "target", "swarm", "search")],
        note="The larger model's are kept so an evaluation asks only the swarm again, and the swarm's so that a long one that was stopped carries on: removed, the next one asks both. With them, what each web search returned on its day. The last result is kept.")
    # the deciders
    add("kev:program", "Deciders", "Kev: its program and Python", [work / "kev" / p for p in ("src", "uvenv", "python", "uv-cache")], used=dkind == "kev",
        note="Shared by every Kev size.")
    add("kev:weights", "Deciders", "Kev: downloaded weights", [work / "kev" / "hf"], used=dkind == "kev",
        note="Every Kev size fetched here, and the Qwen base each is built on.")
    add("startlux:program", "Deciders", "StartLux: its server and Python", [work / "deciders" / "startlux"], used=dkind == "startlux-mlx",
        note="Shared by every StartLux size.")
    for m in reg.get("deciders", []):
        if (m.get("serve") or {}).get("kind") in ("startlux-mlx", "llama"):
            add("decider:" + m["id"], "Deciders", "%s: weights" % m["name"], [work / "deciders" / m["id"]], used=decider.get("id") == m["id"],
                note=(m.get("license") or ""))
    # what training keeps to resume and to save measuring twice (what it has LEARNED is elsewhere, and is not listed)
    train = work / "train"
    add("train:measured", "Training", "Measurements kept so as not to ask twice", [train / "measured"],
        note="A measurement made again is the same measurement: the next pass takes longer, nothing is lost.")
    add("train:checkpoints", "Training", "Answers of interrupted runs", [train / "checkpoints"],
        note="What lets a stopped trainer carry on where it was. A pass that is not stopped does not need them.")
    add("train:rows", "Training", "Every answer of every run, as recorded", [train / x for x in ("swarm-runs.jsonl", "baseline-runs.jsonl")],
        note="The full record behind the page's measurements. The results in training/results are kept.")
    old = sorted(p for p in work.iterdir() if p.is_dir() and (p.name.startswith("stopped-pass-") or p.name.startswith("invalid-run-"))) if work.is_dir() else []
    add("old:passes", "Training", "Copies of stopped and invalid passes", old, note="Set aside by hand when a pass was stopped or found void.")
    add("old:cleared", "Training", "What Clear training state set aside", [work / "archive"],
        note="Each run's records as they were when training was begun again. Nothing reads them: they are kept so that a person can put one back by hand, and removed they cannot be.")
    logs = sorted(p for d in (work, work / "train", work / "eval", work / "mlx", work / "kev") if d.is_dir() for p in d.iterdir() if p.is_file() and p.suffix == ".log")
    add("logs", "Training", "Logs of sessions, evaluations and installs", logs, note="What each wrote as it ran. The next one writes its own.")
    # ANYTHING ELSE INSTALLED HERE: a folder of .work that holds a Python of its own (a venv) and is none of the pieces above. A
    # program added to the Swarm later is listed, and can be taken out, before this list is taught its name
    known = {os.path.realpath(q) for x in out for q in x["paths"]}
    inside = lambda q: any(os.path.realpath(q) == k or os.path.realpath(q).startswith(k + os.sep) or k.startswith(os.path.realpath(q) + os.sep) for k in known)  # noqa: E731
    for d in sorted(work.iterdir()) if work.is_dir() else []:
        if d.is_dir() and not os.path.islink(d) and not inside(d) and any((d / v).is_dir() for v in ("venv", "uvenv", ".venv")):
            add("other:" + d.name, "Programs", "A program installed here: %s" % d.name, [d], note="A folder of .work with a Python of its own, which this list does not know by name. Whatever uses it installs it again.")
    # AND EVERYTHING ELSE IN .work, so that the list is the whole of it: a folder this list does not know by name (a trial's
    # downloads and results among them: on 2026-11-20 two models fetched to try an engine, 2.6 GB, were in a folder nothing
    # here named), each its own line; and the small files beside them, as one. Nothing the Swarm needs is among them: what it
    # needs is named above, and whatever wrote one of these writes it again
    known = {os.path.realpath(q) for x in out for q in x["paths"]}
    loose = []
    # (never the folders that hold what training learned, its results and the state of a pass, whether or not anything inside
    # them is named above: a folder of learned records with no adapter in it yet was offered here as one "not known by name")
    KEPT = ("library", "train", "eval", "pretrain")
    for d in sorted(work.iterdir()) if work.is_dir() else []:
        if inside(d) or d.name in KEPT:
            continue
        if d.is_dir() and not os.path.islink(d):
            add("left:" + d.name, "Other things in .work", "A folder not known by name: %s" % d.name, [d],
                note="Nothing in this list uses it: left by a trial or an earlier version. Whatever made it makes it again where it is needed.")
        else:
            loose.append(d)
    add("left:files", "Other things in .work", "Small files beside the folders", loose, note="Notes of state a run or the page left (a port, the newest engine release it learned of). Each is written again when it is next needed.")
    # AND WHAT IS LEFT INSIDE THE FOLDERS NAMED ABOVE: what training has learned, its last results and the state of the pass in
    # hand. Said, with its size, so that nothing in .work goes unlisted; not removed from here, because removing it is losing
    # what was learned, which Clear training state does on purpose and this list must not do by the way
    known = {os.path.realpath(q) for x in out for q in x["paths"]}
    covered = lambda q: any(os.path.realpath(q) == k or os.path.realpath(q).startswith(k + os.sep) for k in known)  # noqa: E731
    holds = lambda q: any(k.startswith(os.path.realpath(q) + os.sep) for k in known)  # noqa: E731
    rest = []

    def walk(folder):
        for q in sorted(folder.iterdir()):
            if covered(q):
                continue
            if q.is_dir() and not os.path.islink(q) and holds(q):
                walk(q)
            else:
                rest.append(q)

    if work.is_dir():
        walk(work)
    add("kept:records", "Training", "What training learned, its last results and the pass in hand", rest, removable=False,
        note="Kept by this list: the records each configuration learned, the last evaluation, and where a pass stands. Clear training state begins a configuration again.")
    # kept by other programs, outside this folder: listed, not removed from here
    tf = Path.home() / ".tensorfold"
    if ((target.get("serve") or {}).get("program") == "tensorfold" or any((m or {}).get("engine") == "tensorfold" for m in members.values())) and tf.is_dir():
        out.append({"id": "tensorfold", "group": "Outside this folder", "what": "TensorFold and the models it keeps", "paths": [str(tf)], "bytes": None,
                    "used": True, "note": "Kept by TensorFold in %s. Remove it with TensorFold's own commands." % tf, "removable": False})
    # (a Python uv fetched into its own folder, outside this one: the Swarm fetches its own into .work, and an install made before
    # that did not. Other programs may use the same folder, so it is listed and not removed from here)
    uvpy = Path.home() / ".local" / "share" / "uv" / "python"
    if uvpy.is_dir() and any(uvpy.iterdir()):
        mine = False
        for cfg in work.glob("*/venv/pyvenv.cfg") if work.is_dir() else []:
            try:
                mine = mine or str(uvpy) in cfg.read_text()
            except OSError:
                pass
        out.append({"id": "uv-python", "group": "Outside this folder", "what": "Pythons uv fetched into its own folder", "paths": [str(uvpy)], "bytes": _size(uvpy), "used": mine,
                    "note": ("uv keeps what it fetches in %s, for every program that uses uv. The Swarm fetches its own Pythons into .work; an install made before it did may have left one here. "
                             "%s" % (uvpy.parent, "One of the programs above still runs on it." if mine else "Nothing of the Swarm uses it now: if nothing else of yours uses uv, remove %s by hand." % uvpy.parent)),
                    "removable": False})
    llama = shutil.which("llama-server")
    if llama:
        out.append({"id": "llama-path", "group": "Outside this folder", "what": "The llama-server on the PATH", "paths": [llama], "bytes": None, "used": True,
                    "note": "Installed by another program (%s), and used in place of fetching one." % llama, "removable": False})
    order = ["Models", "Deciders", "Programs", "Pretrain", "Training", "Other things in .work", "Outside this folder"]
    out.sort(key=lambda x: (order.index(x["group"]), -(x["bytes"] or 0)))
    return out


def remove(root, d, id_, *, decider_up=False):
    """Remove one piece by its id. -> (ok, message). Every path is checked to resolve inside .work; links are removed as links."""
    root = Path(root)
    work = (root / ".work").resolve()
    item = next((x for x in inventory(root, d) if x["id"] == id_), None)
    if not item:
        return False, "There is nothing called that to remove."
    if not item["removable"]:
        # (kept by another program, outside this folder; or, inside it, what training has learned)
        return False, ("That is kept by another program, outside this folder: " if item["group"] == "Outside this folder" else "That is not removed from here: ") + item["note"]
    if decider_up and item["group"] == "Deciders":
        return False, "A decider is loaded: stop it first (bash training/decider.sh stop)."
    freed = 0
    for p in item["paths"]:
        p = Path(p)
        # the folder a path is in must resolve inside .work (the path itself may be a link: it is removed as one)
        if not str(p.parent.resolve()).startswith(str(work)) or p.parent.resolve() == work.parent:
            return False, "Refused: %s is not inside .work." % p
        size = _size(p)
        if os.path.islink(p) or p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)
        freed += size
    return True, "Removed %s, %s freed." % (item["what"], gb(freed))


def to_json(items):
    return json.dumps(items)
