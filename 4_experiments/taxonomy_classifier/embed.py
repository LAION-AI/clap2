"""Dasheng-0.6B features (first 10 s at 16 kHz, mean-pooled) of a labelled clip set; one process per GPU (--part i/n)."""
import argparse
import importlib
from pathlib import Path

import numpy as np
import polars as pl
import torch

classify = importlib.import_module("1_preprocessing.4_annotation.0_taxonomy.classify")


class Clips(torch.utils.data.Dataset):
    def __init__(self, audio):
        self.audio = audio

    def __len__(self):
        return len(self.audio)

    def __getitem__(self, i):
        return torch.from_numpy(classify.window(self.audio[i]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("labels", type=Path, help="parquet with audio (bytes), l3 (leaf path), archive")
    ap.add_argument("out", type=Path, help="directory for features.<i>.npz")
    ap.add_argument("--part", default="0/1")
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    i, n = map(int, a.part.split("/"))
    rows = pl.scan_parquet(a.labels).with_row_index("row").filter(pl.col("row") % n == i).select("row", "audio").collect()
    dev = torch.device("cuda", i % torch.cuda.device_count())
    from dasheng import dasheng_06B
    enc = dasheng_06B().eval().to(dev)
    feats = []
    with torch.inference_mode():
        for x in torch.utils.data.DataLoader(Clips(rows["audio"].to_list()), batch_size=256, num_workers=a.workers, pin_memory=True):
            with torch.autocast("cuda", dtype=torch.bfloat16):
                f = enc(x.to(dev, non_blocking=True))
            feats.append(f.float().mean(1).half().cpu().numpy())
    a.out.mkdir(parents=True, exist_ok=True)
    np.savez(a.out / f"features.{i}.npz", row=rows["row"].to_numpy(), X=np.concatenate(feats))


if __name__ == "__main__":
    main()
