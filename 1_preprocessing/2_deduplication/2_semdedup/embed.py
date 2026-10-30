"""Dasheng-base embedding of the clips SemDeDup compares: first 10 s at 16 kHz, zero-padded, mean-pooled, 768-d fp16."""
from functools import partial

import polars as pl
import torch
from cluster import screened
from dasheng import dasheng_base

from common.annotate import run
from common.audio import fixed

SR, SECONDS = 16000, 10


def model(dev):
    enc = dasheng_base().to(dev).eval()

    @torch.inference_mode()
    def infer(x):
        return {"emb": list(enc(x.to(dev, non_blocking=True)).mean(1).half().cpu().numpy())}
    return infer


if __name__ == "__main__":
    run("semdedup", lambda work: screened(work)["audio_id"], partial(fixed, sr=SR, seconds=SECONDS), model, {"emb": pl.Array(pl.Float16, 768)})
