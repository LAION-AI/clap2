"""Mean rank and win rate of each captioner x prompt mode in the six-way judgments, with bootstrap intervals over clips."""
import argparse
import sys
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).parents[1] / "captioner_comparison"))
from analyze import interval  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("judgments", type=Path, nargs="?", default=Path(__file__).parent / "data" / "judgments.parquet")
    ap.add_argument("--boot", type=int, default=20000)
    a = ap.parse_args()
    ranks = (pl.read_parquet(a.judgments).with_columns(variant=pl.col("model") + "/" + pl.col("mode"))
             .pivot("variant", index="clip", values="rank").drop_nulls().drop("clip"))
    r = ranks.to_numpy().astype(float)
    rank, rank_lo, rank_hi = interval(r, a.boot)
    win, win_lo, win_hi = interval((r == 1) * 100.0, a.boot)
    print(f"{len(r)} clips\n{'captioner/prompt':18s} {'mean rank':>11s} {'win rate %':>11s}")
    for i in rank.argsort():
        print(f"{ranks.columns[i]:18s} {rank[i]:5.2f}±{(rank_hi[i] - rank_lo[i]) / 2:.2f} "
              f"{win[i]:6.1f}±{(win_hi[i] - win_lo[i]) / 2:.1f}")


if __name__ == "__main__":
    main()
