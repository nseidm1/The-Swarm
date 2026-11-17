"""mlx_adapter.py - TRAIN A SMALL MODEL'S ADAPTER WITH MLX, AND HAND IT TO LLAMA.CPP.

llama.cpp's own trainer cannot train the swarm's small models (adapters.mjs: SSM_CONV and SIGMOID have no backward pass). MLX can,
from each model's original weights (.work/mlx/hf), and the adapter it writes is turned here into a GGUF LoRA that llama-server
loads beside the quantized model it already serves (--lora), so nothing else in the swarm changes.

  train  <hf model dir> <dataset.jsonl> <out dir> [--iters N] [--layers N] [--max-tokens N] [--lr X]
         leaves out every example longer than --max-tokens (mlx would cut it at the END, which is where the answer is), keeps one
         in eight to watch the loss, trains, and prints one JSON line: {ok, examples, dropped, valLoss: [first, last], seconds}
  gguf   <adapter dir> <base model.gguf> <out.gguf>
         MLX keeps y = Wx + scale * B(A x) with A (in, r) and B (r, out); llama.cpp keeps the same product with each matrix
         transposed and its scale as alpha / r. So A and B are written transposed, alpha = scale * r, and each tensor is named
         by gguf's own map for the base model's architecture; a name the base model does not have is refused, never guessed

Run with the venv that has mlx-lm and gguf (.work/mlx/venv/bin/python -I).
"""

import json
import os
import re
import subprocess
import sys
import time


def arg(args, name, default):
    return type(default)(args[args.index(name) + 1]) if name in args else default


def train(model, dataset, out, args):
    from pathlib import Path
    from mlx_lm.utils import load_tokenizer

    max_tokens = arg(args, "--max-tokens", 2048)
    tok = load_tokenizer(Path(model))
    kept, dropped = [], []
    for line in open(dataset, encoding="utf8"):
        if not line.strip():
            continue
        d = json.loads(line)
        n = len(tok.apply_chat_template(d["messages"], tools=d.get("tools"), return_dict=False))
        (kept if n <= max_tokens else dropped).append((d, n))
    if len(kept) < 2:
        print(json.dumps({"ok": False, "why": "fewer than two examples fit in %d tokens" % max_tokens, "dropped": len(dropped)}))
        return 1
    data = os.path.join(out, "data")
    os.makedirs(data, exist_ok=True)
    valid = kept[::8]
    train_ = [x for i, x in enumerate(kept) if i % 8]
    for name, rows in (("train", train_), ("valid", valid)):
        with open(os.path.join(data, name + ".jsonl"), "w", encoding="utf8") as f:
            for d, _ in rows:
                f.write(json.dumps({"messages": d["messages"]}) + "\n")
    iters = arg(args, "--iters", 100)
    cmd = [
        os.path.join(os.path.dirname(sys.executable), "mlx_lm.lora"),
        "--model", model, "--train", "--data", data, "--adapter-path", os.path.join(out, "adapter"),
        "--iters", str(iters), "--batch-size", "1", "--num-layers", str(arg(args, "--layers", 8)),
        "--max-seq-length", str(max_tokens), "--learning-rate", str(arg(args, "--lr", 1e-5)), "--mask-prompt",
        "--steps-per-report", "10", "--steps-per-eval", str(iters), "--val-batches", str(len(valid)),
    ]
    t0 = time.time()
    with open(os.path.join(out, "train.log"), "w", encoding="utf8") as log:
        r = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
    said = open(os.path.join(out, "train.log"), encoding="utf8").read()
    val = [float(x) for x in re.findall(r"val\S*\s+\S*?([0-9]+\.[0-9]+)", re.sub(r"\x1b\[[0-9;]*m", "", said))]
    res = {
        "ok": r.returncode == 0,
        "examples": len(train_),
        "watched": len(valid),
        "dropped": len(dropped),
        "maxTokens": max_tokens,
        "valLoss": [val[0], val[-1]] if val else [],
        "seconds": round(time.time() - t0, 1),
    }
    if r.returncode != 0:
        tail = [l for l in said.splitlines() if l.strip()][-1:] or ["it did not finish"]
        res["why"] = tail[0][:200]
    print(json.dumps(res))
    return 0 if res["ok"] else 1


def to_gguf(adapter, base, out):
    import numpy as np
    import gguf
    from safetensors.numpy import load_file

    cfg = json.load(open(os.path.join(adapter, "adapter_config.json"), encoding="utf8"))
    lp = cfg.get("lora_parameters") or {}
    rank, scale = int(lp.get("rank", 8)), float(lp.get("scale", 20.0))
    r = gguf.GGUFReader(base)
    arch_name = r.fields["general.architecture"].contents()
    # (ggml's shape: the input size first, then the output size)
    have = {t.name: tuple(int(x) for x in t.shape) for t in r.tensors}
    blocks = 1 + max(int(n.split(".")[1]) for n in have if n.startswith("blk."))
    arch = next(a for a, n in gguf.MODEL_ARCH_NAMES.items() if n == arch_name)
    names = gguf.get_tensor_name_map(arch, blocks)
    w = gguf.GGUFWriter(out, arch_name)
    w.add_string("general.type", "adapter")
    w.add_string(gguf.Keys.Adapter.TYPE, "lora")
    w.add_float32(gguf.Keys.Adapter.LORA_ALPHA, float(scale * rank))
    tensors = load_file(os.path.join(adapter, "adapters.safetensors"))
    pairs = 0
    for key in sorted(tensors):
        if not key.endswith(".lora_a"):
            continue
        mod = key[: -len(".lora_a")]
        # (a model that can also see keeps its text layers under language_model.: Qwen3.5's)
        name = names.get_name(re.sub(r"^language_model\.", "", mod))
        if not name or name + ".weight" not in have:
            raise SystemExit("no tensor in %s for %s (mapped to %s)" % (os.path.basename(base), mod, name))
        a, b = tensors[key], tensors[mod + ".lora_b"]
        want = have[name + ".weight"][:2]
        if (a.shape[0], b.shape[1]) != want:
            raise SystemExit("%s is %s in, %s out; %s.weight is %s" % (mod, a.shape[0], b.shape[1], name, want))
        w.add_tensor(name + ".weight.lora_a", np.ascontiguousarray(a.T.astype(np.float32)))
        w.add_tensor(name + ".weight.lora_b", np.ascontiguousarray(b.T.astype(np.float32)))
        pairs += 1
    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()
    print(json.dumps({"ok": True, "file": out, "architecture": arch_name, "pairs": pairs, "rank": rank, "alpha": scale * rank}))
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) >= 4 and a[0] == "train":
        sys.exit(train(a[1], a[2], a[3], a[4:]))
    if len(a) == 4 and a[0] == "gguf":
        sys.exit(to_gguf(a[1], a[2], a[3]))
    print(__doc__)
    sys.exit(2)
