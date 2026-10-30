"""Training compute C = 3 x forward FLOPs per clip x samples seen; checks the GFLOPs and C columns of points.csv."""
# Scaling-law methodology: https://github.com/LAION-AI/scaling-laws-for-comparison
import argparse
import os

import numpy as np
import polars as pl

# (audio width, depth, SwiGLU ratio), (text width, depth, SwiGLU ratio) per schedule and tier
TOWERS = {
    "wsd": {"XXS": ((224, 12, 2 / 0.7), (224, 12, 2 / 0.7)), "XS": ((320, 12, 2.8), (320, 12, 2.8)),
            "S": ((512, 12, 2.75), (512, 11, 2.75)), "M": ((640, 12, 2.7), (640, 11, 2.7)),
            "L": ((1024, 12, 2.75), (960, 11, 2.6666667))},
    "cosine": {"XXS": ((256, 12, 2.75), (192, 12, 2.6666667)), "XS": ((384, 12, 2.6666667), (256, 12, 2.6666667)),
               "S": ((576, 12, 2.6666667), (384, 12, 2.6666667)), "M": ((768, 12, 2.6666667), (512, 12, 2.6666667)),
               "L": ((896, 21, 2.6666667), (640, 12, 2.6666667))},
}
SEQ_LENS = [344, 448, 648, 1128, 1504]  # audio-token buckets of the scaling runs (6.88 ... 30.08 s)
BATCH_PROBS = [0.08945639, 0.10585499, 0.15892203, 0.28864864, 0.35711795]
TOKENS_PER_BATCH, TEXT_TOKENS, PATCH_DIM = 49152, 256, 256


def layer(t, d, ratio):
    """Forward FLOPs of one transformer layer: SwiGLU MLP, attention projections, attention scores."""
    return 6 * t * d * ratio * d + 8 * t * d * d + 4 * t * t * d


def gflops_per_clip(schedule, tier, seq_lens=SEQ_LENS, probs=BATCH_PROBS, tokens=TOKENS_PER_BATCH):
    """Forward GFLOPs of both towers per clip, averaged over the bucket mix (per-batch weights -> per-clip shares)."""
    (da, la, ra), (dt, lt, rt) = TOWERS[schedule][tier]
    rows = np.array([tokens // s // 8 * 8 for s in seq_lens])
    share = np.asarray(probs) * rows / np.dot(probs, rows)
    audio = sum(f * (la * layer(s + 1, da, ra) + 2 * s * PATCH_DIM * da) for s, f in zip(seq_lens, share))
    return (audio + lt * layer(TEXT_TOKENS, dt, rt)) / 1e9


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--points", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "points.csv"))
    d = pl.read_csv(ap.parse_args().points)
    g = np.array([gflops_per_clip(s, t) for s, t in zip(d["schedule"], d["tier"])])
    assert np.allclose(g, d["gflops_per_sample"], rtol=1e-6), "GFLOPs per clip do not match points.csv"
    assert np.allclose(3 * g * d["D"].to_numpy(), d["C"], rtol=1e-6), "C != 3 x GFLOPs x D"
    print(d.select("schedule", "tier", "params_m", "gflops_per_sample").unique(maintain_order=True))


if __name__ == "__main__":
    main()
