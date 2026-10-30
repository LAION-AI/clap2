"""GPU annotation loop: chosen clips of every collected tar through a model in fixed-size batches, one parquet per tar."""
import argparse
from pathlib import Path

import numpy as np
import polars as pl
import torch

from common.loader import batches
from common.tars import CPUS, audio_id, clip_id, frame, save, todo


class Keep:
    """keep(tar, key) for common.loader.batches: the clip's audio_id is in `ids` (checked before decoding).

    The sorted ids are saved to `path`, which the spawned DataLoader workers map read-only instead of each unpickling a copy.
    """

    def __init__(self, root, ids, path):
        self.root, self.path = Path(root), Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.save(self.path, np.sort(np.asarray(ids, np.int64)))
        self.ids = np.load(self.path, mmap_mode="r")

    def __getstate__(self):
        return {"root": self.root, "path": self.path}

    def __setstate__(self, state):
        self.__dict__.update(state, ids=np.load(state["path"], mmap_mode="r"))

    def __call__(self, tar, key):
        a = audio_id(clip_id(Path(tar).relative_to(self.root), key))
        i = np.searchsorted(self.ids, a)
        return bool(i < self.ids.size and self.ids[i] == a)


def run(name, ids, window, load, schema, size=256):
    """CLI `WORK [--part i/n] [--workers k]`: WORK/<name>/<rel>.parquet for every tar of WORK/collected.

    ids(work) -> audio ids to annotate; window(audio) -> fixed-shape array (in the DataLoader workers);
    load(device) -> infer(batch) -> {column: values}.
    """
    p = argparse.ArgumentParser()
    p.add_argument("work", type=Path)
    p.add_argument("--part", default="0/1", help="i/n: this process handles every n-th tar from the i-th")
    p.add_argument("--workers", type=int, default=CPUS)
    a = p.parse_args()
    root, dst = a.work / "collected", a.work / name
    pairs = todo(root, dst, ".parquet", a.part)
    if not pairs:
        return
    keep = Keep(root, ids(a.work), dst / f".keep-{a.part.replace('/', '-of-')}.npy")
    dev = torch.device("cuda", int(a.part.split("/")[0]) % torch.cuda.device_count())
    torch.cuda.set_device(dev)
    torch.backends.cuda.matmul.allow_tf32 = True
    infer, acc = load(dev), {}
    for out, keys, x, last in batches(pairs, window, size, a.workers, keep):
        done, cols = acc.setdefault(out, ([], {c: [] for c in schema}))
        if x is not None:
            done += keys
            for c, v in infer(x).items():
                assert len(v) == len(keys), c
                cols[c] += list(v)
        if last:
            save(frame(out.relative_to(dst).with_suffix(".tar"), *acc.pop(out), schema), out)
    keep.path.unlink()


def predicted(top):
    """ids(work): pool clips whose predicted top-level class (annotation/taxonomy, all tars done) is `top`."""
    def ids(work):
        tax = work / "annotation" / "taxonomy"
        assert not todo(work / "collected", tax, ".parquet"), "run 0_taxonomy on every tar first"
        return pl.scan_parquet(tax / "**" / "*.parquet").filter(pl.col("tax_l1") == top).select("audio_id").collect()["audio_id"]
    return ids


def normalize(x):
    """Zero mean, unit variance per row, as the wav2vec2 feature extractors do."""
    return (x - x.mean(1, keepdim=True)) / (x.var(1, keepdim=True) + 1e-7).sqrt()
