"""Taxonomy labels: frozen Dasheng-0.6B features (first 10 s, mean-pooled) + MLP head, hierarchical readout."""
import json
from functools import partial

import polars as pl
import torch
import torch.nn as nn
from huggingface_hub import hf_hub_download
from safetensors import safe_open
from safetensors.torch import save_file

from common.annotate import run
from common.audio import fixed

SR, SECONDS = 16000, 10
CONFIG = {"encoder": "dasheng-0.6B", "in_dim": 1280, "hidden": 1024, "dropout": 0.2, "sample_rate": SR, "window_seconds": SECONDS}
SCHEMA = {"tax_l1": pl.String, "tax_l1_prob": pl.Float32, "tax_l1_top3": pl.List(pl.String),
          "tax_l1_top3_prob": pl.List(pl.Float32), "tax_l3": pl.String, "tax_l3_prob": pl.Float32}
window = partial(fixed, sr=SR, seconds=SECONDS)


class Head(nn.Module):
    """Shared trunk (linear, batch norm, GELU, dropout) with leaf, top-level and second-level outputs."""

    def __init__(self, l3_vocab, hidden=1024, dropout=0.2, dim=1280):
        super().__init__()
        self.l3_vocab = l3_vocab
        self.l1_vocab = sorted({s.split("/")[0] for s in l3_vocab})
        l2_vocab = sorted({"/".join(s.split("/")[:2]) for s in l3_vocab})
        self.register_buffer("t1", torch.tensor([self.l1_vocab.index(s.split("/")[0]) for s in l3_vocab]), False)
        self.register_buffer("t2", torch.tensor([l2_vocab.index("/".join(s.split("/")[:2])) for s in l3_vocab]), False)
        self.trunk = nn.Sequential(nn.Linear(dim, hidden), nn.BatchNorm1d(hidden), nn.GELU(), nn.Dropout(dropout))
        self.l3, self.h1, self.h2 = (nn.Linear(hidden, n) for n in (len(l3_vocab), len(self.l1_vocab), len(l2_vocab)))

    def forward(self, x):
        z = self.trunk(x)
        return self.l3(z), self.h1(z), self.h2(z)

    def readout(self, o3, o1, o2):
        """Leaf scores logP_L1 + logP_L2 + logP_L3 (softmax-normalised) and top-level probabilities."""
        score = o1.log_softmax(1)[:, self.t1] + o2.log_softmax(1)[:, self.t2] + o3.log_softmax(1)
        return score.softmax(1), o1.softmax(1)


def load_head(path):
    """Head from a safetensors file whose metadata holds the config and the ordered class list."""
    with safe_open(path, "pt") as f:
        meta, state = f.metadata(), {k: f.get_tensor(k) for k in f.keys()}
    assert json.loads(meta["config"]) == CONFIG, meta["config"]
    head = Head(json.loads(meta["classes"]), CONFIG["hidden"], CONFIG["dropout"], CONFIG["in_dim"])
    head.load_state_dict(state)
    return head.eval()


def save_head(head, path):
    save_file({k: v.contiguous().cpu() for k, v in head.state_dict().items()}, path,
              metadata={"config": json.dumps(CONFIG), "classes": json.dumps(head.l3_vocab)})


def pool(work):
    return pl.read_parquet(work / "pool.parquet", columns=["audio_id"])["audio_id"]


def model(dev):
    from dasheng import dasheng_06B
    enc = dasheng_06B().eval().to(dev)
    head = load_head(hf_hub_download("laion/audio-taxonomy-classifier", "head.safetensors")).to(dev)

    @torch.inference_mode()
    def infer(x):
        with torch.autocast("cuda", dtype=torch.bfloat16):
            feats = enc(x.to(dev, non_blocking=True))
        p3, p1 = head.readout(*head(feats.float().mean(1)))
        l3p, l3i = p3.max(1)
        t3p, t3i = (t.cpu() for t in p1.topk(3, 1))
        names = [[head.l1_vocab[j] for j in row] for row in t3i.tolist()]
        return {"tax_l1": [n[0] for n in names], "tax_l1_prob": t3p[:, 0].tolist(), "tax_l1_top3": names,
                "tax_l1_top3_prob": t3p.tolist(), "tax_l3": [head.l3_vocab[j] for j in l3i.tolist()],
                "tax_l3_prob": l3p.tolist()}
    return infer


if __name__ == "__main__":
    run("annotation/taxonomy", pool, window, model, SCHEMA, size=512)
