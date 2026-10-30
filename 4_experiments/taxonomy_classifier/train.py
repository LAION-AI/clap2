"""Train the taxonomy head on Dasheng features: archive-level split, 1/sqrt(freq) leaf CE plus 0.3 x top/second-level CE."""
import argparse
import hashlib
import importlib
from pathlib import Path

import numpy as np
import polars as pl
import torch
import torch.nn.functional as F

classify = importlib.import_module("1_preprocessing.4_annotation.0_taxonomy.classify")


def bucket(archive):
    """md5(archive) % 10 (0 test, 1 held out, the rest training), so clips of one recording never straddle splits."""
    return int(hashlib.md5(archive.encode()).hexdigest(), 16) % 10


@torch.inference_mode()
def evaluate(head, X, y):
    """Leaf accuracy, leaf-derived top-level accuracy and top-level head accuracy."""
    head.eval()
    p3, p1 = head.readout(*head(X))
    leaf = p3.argmax(1)
    return {"leaf": (leaf == y).float().mean().item(), "l1_from_leaf": (head.t1[leaf] == head.t1[y]).float().mean().item(),
            "l1_head": (p1.argmax(1) == head.t1[y]).float().mean().item()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("labels", type=Path, help="parquet with l3 (leaf path) and archive, rows aligned with the features")
    ap.add_argument("features", type=Path, help="directory of features.<i>.npz from embed.py")
    ap.add_argument("out", type=Path)
    ap.add_argument("--init", type=Path, help="warm start from this head.safetensors (keeps its class list)")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=8192)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--wd", type=float, default=1e-4)
    a = ap.parse_args()
    torch.manual_seed(0)
    parts = [np.load(f) for f in sorted(a.features.glob("features.*.npz"))]
    order = np.argsort(np.concatenate([p["row"] for p in parts]))
    X = torch.from_numpy(np.concatenate([p["X"] for p in parts])[order]).float().cuda()
    lab = pl.read_parquet(a.labels, columns=["l3", "archive"])
    assert X.shape[0] == lab.height
    head = (classify.load_head(a.init) if a.init else classify.Head(sorted(lab["l3"].unique()))).cuda()
    vocab = head.l3_vocab
    index = {s: i for i, s in enumerate(vocab)}
    known = lab["l3"].is_in(vocab).to_numpy()
    print(f"{known.sum():,} of {lab.height:,} labelled clips have a leaf in the {len(vocab):,}-leaf vocabulary")
    y = torch.tensor([index.get(s, -1) for s in lab["l3"]]).cuda()
    h = np.array([bucket(r) for r in lab["archive"]])
    tr, te = (torch.from_numpy(m & known).cuda() for m in (h > 1, h == 0))
    w = torch.bincount(y[tr], minlength=len(vocab)).clamp(min=1).float().rsqrt()
    w /= w.mean()
    opt = torch.optim.AdamW(head.parameters(), lr=a.lr, weight_decay=a.wd)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.epochs)
    Xtr, ytr = X[tr], y[tr]
    for ep in range(a.epochs):
        head.train()
        for b in torch.randperm(len(ytr), device=ytr.device).split(a.batch):
            o3, o1, o2 = head(Xtr[b])
            loss = (F.cross_entropy(o3, ytr[b], weight=w) + 0.3 * F.cross_entropy(o1, head.t1[ytr[b]])
                    + 0.3 * F.cross_entropy(o2, head.t2[ytr[b]]))
            opt.zero_grad()
            loss.backward()
            opt.step()
        sched.step()
        print(f"epoch {ep}: loss {loss.item():.3f}, test {evaluate(head, X[te], y[te])}", flush=True)
    classify.save_head(head, a.out)


if __name__ == "__main__":
    main()
