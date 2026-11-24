"""the_swarm.py - THE SWARM FROM PYTHON: a thin client. It starts the module's own server (Node), waits until it answers,
and talks to it as a chat model; nothing of the module is written again here. Standard library only, Python 3.9 or later.

    from the_swarm import Swarm

    with Swarm(spec="specs/<name>.swoa.json") as swarm:      # or Swarm() for the swarm configured in this checkout
        print(swarm.reply("Write a function that reverses a string."))

        r = swarm.chat([{"role": "user", "content": "What is 6 times 7?"}])   # the whole chat-completion, as a dict
        swarm.last()                                         # what every slot did on that message

The server is an OpenAI-compatible one, so any client of such a server can be given its address in place of this one's
methods: `OpenAI(base_url=swarm.base + "/v1", api_key="none")`.

What it needs: Node 20 or later (found in SWARM_NODE, on the PATH, or under ~/.nvm), and the checkout this file is in (or
`repo=`). The server listens on 127.0.0.1 only and is stopped when the `with` block ends, or by `stop()`.
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

__all__ = ["Swarm", "SwarmError", "find_node"]
NODE_LEAST = 20


class SwarmError(RuntimeError):
    """The module did not start, stopped, or refused a request. The message says which, with what it printed."""


def _node_major(program):
    try:
        out = subprocess.run([program, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
        return int(out.lstrip("v").split(".")[0])
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def find_node(least=NODE_LEAST):
    """The Node to run the module with: SWARM_NODE or NODE where set, the one on the PATH, else the newest under ~/.nvm."""
    named = os.environ.get("SWARM_NODE") or os.environ.get("NODE")
    if named:
        if _node_major(named) >= least:
            return named
        raise SwarmError("%s is not Node %d or later" % (named, least))
    found = shutil.which("node")
    if found and _node_major(found) >= least:
        return found
    best = (0, None)
    for program in (Path.home() / ".nvm" / "versions" / "node").glob("*/bin/node"):
        major = _node_major(str(program))
        if major > best[0]:
            best = (major, str(program))
    if best[0] >= least:
        return best[1]
    raise SwarmError("no Node %d or later was found (set SWARM_NODE to one)" % least)


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Swarm:
    """One swarm module, served on this machine and used as one chat model.

    spec      a SwOA spec file to make the module from; without one, the swarm configured in the checkout
    adapters  the folder holding the adapters the spec pins (by default <spec name>.adapters beside it)
    port      the port to serve on (by default one that is free)
    repo      the checkout of The Swarm (by default the one this file is in)
    node      the Node program (by default find_node())
    llama, models, decider   the llama-server program, the folder of model files, a running decider's address
    wait      seconds to wait for the models to load before giving up (they are large; the default is ten minutes)
    command   the whole command to start in place of the module's server: for tests
    """

    def __init__(self, spec=None, adapters=None, port=None, repo=None, node=None, llama=None, models=None, decider=None,
                 wait=600, command=None):
        self.repo = Path(repo) if repo else Path(__file__).resolve().parent.parent
        self.port = int(port) if port else _free_port()
        self.base = "http://127.0.0.1:%d" % self.port
        self.wait = wait
        self._said = []
        self._process = None
        if command:
            self._command = [str(x).replace("{port}", str(self.port)) for x in command]
        else:
            program = self.repo / "bin" / "swarm.mjs"
            if not program.is_file():
                raise SwarmError("%s is not a checkout of The Swarm (no bin/swarm.mjs): name one with repo=" % self.repo)
            self._command = [node or find_node(), str(program), "serve", "--port", str(self.port)]
            for flag, value in (("--spec", spec), ("--adapters", adapters), ("--llama", llama), ("--models", models)):
                if value:
                    self._command += [flag, str(Path(value).expanduser().resolve())]
        self._env = dict(os.environ, **({"SWARM_DECIDER": decider} if decider else {}))

    # -- starting and stopping -------------------------------------------------------------------------------------------
    def start(self):
        """Start the server and wait until it answers. Returns self."""
        if self._process and self._process.poll() is None:
            return self
        # (a group of its own, so that stopping it reaches the model servers it started and nothing else)
        self._process = subprocess.Popen(self._command, cwd=str(self.repo), env=self._env, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, text=True, start_new_session=True)
        threading.Thread(target=self._listen, daemon=True).start()
        until = time.time() + self.wait
        while time.time() < until:
            if self._process.poll() is not None:
                raise SwarmError("the swarm did not start: " + (self.said()[-600:] or "it printed nothing"))
            if self.healthy():
                return self
            time.sleep(0.25)
        self.stop()
        raise SwarmError("the swarm did not answer within %d seconds: %s" % (self.wait, self.said()[-600:]))

    def _listen(self):
        for line in self._process.stdout:
            self._said.append(line)
            del self._said[:-200]

    def said(self):
        """What the server has printed (its last 200 lines)."""
        return "".join(self._said).strip()

    def healthy(self):
        """True while the server answers and its models do."""
        try:
            with urllib.request.urlopen(self.base + "/health", timeout=5) as r:
                return r.status == 200
        except (OSError, urllib.error.URLError):
            return False

    def stop(self):
        """Stop the server and the model servers it started. Safe to call twice."""
        p, self._process = self._process, None
        if not p or p.poll() is not None:
            return
        # (it stops its models on an interrupt, as Ctrl+C in a terminal is; then, if it has not gone, it is ended)
        for sig, seconds in ((signal.SIGINT, 20), (signal.SIGTERM, 5), (signal.SIGKILL, 5)):
            try:
                os.killpg(p.pid, sig)
            except (ProcessLookupError, PermissionError):
                break
            try:
                p.wait(timeout=seconds)
                break
            except subprocess.TimeoutExpired:
                continue
        if p.stdout:
            p.stdout.close()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    def __del__(self):
        try:
            self.stop()
        except Exception:  # noqa: BLE001  (at interpreter exit: nothing to be done about it)
            pass

    # -- asking ----------------------------------------------------------------------------------------------------------
    def _request(self, path, body=None, timeout=900):
        if not self._process or self._process.poll() is not None:
            raise SwarmError("the swarm is not running: start() it, or use it in a `with` block")
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            said = e.read().decode("utf-8", "replace")[:400]
            e.close()
            raise SwarmError("the swarm answered %d: %s" % (e.code, said)) from None
        except (OSError, urllib.error.URLError) as e:
            raise SwarmError("the swarm could not be reached: %s" % e) from None

    def chat(self, messages, **more):
        """Messages in, the chat completion out, as a dict (POST /v1/chat/completions). `more` goes in the request as it is:
        tools, tool_choice, max_tokens, stop. A streamed reply is not read here: give the address to a client that streams."""
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]
        return self._request("/v1/chat/completions", {"model": "the-swarm", "messages": messages, **more, "stream": False})

    def reply(self, messages, **more):
        """The reply's text alone ('' where the reply is a call to a tool: chat() has the calls)."""
        choice = (self.chat(messages, **more).get("choices") or [{}])[0]
        return (choice.get("message") or {}).get("content") or ""

    def last(self):
        """What every slot did on the last message (GET /swarm/last)."""
        return self._request("/swarm/last")
