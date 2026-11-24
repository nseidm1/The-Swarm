"""test_the_swarm.py - the Python client, against a stand-in server: nothing of the module is started and no model is loaded.
    python3 python/test_the_swarm.py
"""
import json
import os
import signal
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from the_swarm import Swarm, SwarmError, find_node  # noqa: E402

# a server that answers as the module's does, prints as it does, and says in a file how it was stopped
STAND_IN = r'''
import json, signal, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
port, note = int(sys.argv[1]), sys.argv[2]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self.send(200, {"ok": True} if self.path == "/health" else {"slots": ["a-direct"]})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if body["messages"][-1]["content"] == "refuse": return self.send(400, {"error": "no"})
        self.send(200, {"choices": [{"message": {"role": "assistant", "content": "echo: " + body["messages"][-1]["content"]}}],
                        "asked": {k: v for k, v in body.items() if k != "messages"}})
def gone(sig, frame):
    open(note, "w").write(signal.Signals(sig).name); sys.exit(0)
signal.signal(signal.SIGINT, gone); signal.signal(signal.SIGTERM, gone)
print("The swarm is at http://127.0.0.1:%d (POST /v1/chat/completions). Ctrl+C stops it." % port, flush=True)
HTTPServer(("127.0.0.1", port), H).serve_forever()
'''


class Client(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="swarm-py-")
        self.script = os.path.join(self.dir, "stand_in.py")
        self.note = os.path.join(self.dir, "stopped.txt")
        Path(self.script).write_text(STAND_IN)
        self.command = [sys.executable, self.script, "{port}", self.note]

    def test_it_starts_asks_and_stops_as_ctrl_c_does(self):
        with Swarm(command=self.command, repo=self.dir, wait=20) as s:
            self.assertTrue(s.healthy())
            self.assertEqual(s.reply("hello"), "echo: hello")
            got = s.chat([{"role": "user", "content": "x"}], max_tokens=5, stream=True)
            self.assertEqual(got["asked"], {"model": "the-swarm", "max_tokens": 5, "stream": False})
            self.assertEqual(s.last(), {"slots": ["a-direct"]})
            self.assertIn("The swarm is at", s.said())
            with self.assertRaises(SwarmError) as refused:
                s.reply("refuse")
            self.assertIn("400", str(refused.exception))
        # (stopped by an interrupt, which is what makes the module stop its model servers)
        self.assertEqual(Path(self.note).read_text(), "SIGINT")
        with self.assertRaises(SwarmError):
            s.reply("after")

    def test_a_server_that_does_not_start_is_said_with_what_it_printed(self):
        with self.assertRaises(SwarmError) as e:
            Swarm(command=[sys.executable, "-c", "print('The swarm did not start: no model file'); raise SystemExit(1)"],
                  repo=self.dir, wait=20).start()
        self.assertIn("no model file", str(e.exception))

    def test_the_command_it_would_run(self):
        repo = Path(self.dir) / "repo"
        (repo / "bin").mkdir(parents=True)
        (repo / "bin" / "swarm.mjs").write_text("")
        s = Swarm(spec="x.swoa.json", adapters="ad", port=8123, repo=repo, node="/usr/bin/true", decider="http://127.0.0.1:8009")
        self.assertEqual(s._command[:5], ["/usr/bin/true", str(repo / "bin" / "swarm.mjs"), "serve", "--port", "8123"])
        self.assertEqual(s._command[5], "--spec")
        self.assertTrue(s._command[6].endswith("x.swoa.json") and s._command[8].endswith("ad"))
        self.assertEqual(s._env["SWARM_DECIDER"], "http://127.0.0.1:8009")
        with self.assertRaises(SwarmError):
            Swarm(repo=self.dir)  # (not a checkout)

    def test_a_node_that_is_named_and_too_old_is_refused(self):
        old = os.path.join(self.dir, "node")
        Path(old).write_text("#!/bin/sh\necho v18.19.0\n")
        os.chmod(old, 0o755)
        was = os.environ.get("SWARM_NODE")
        os.environ["SWARM_NODE"] = old
        try:
            with self.assertRaises(SwarmError):
                find_node()
        finally:
            os.environ.pop("SWARM_NODE") if was is None else os.environ.__setitem__("SWARM_NODE", was)


if __name__ == "__main__":
    unittest.main(verbosity=1)
