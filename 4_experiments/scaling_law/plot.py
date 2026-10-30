"""Scaling figures from points.csv and the bootstrap fits of fit.py."""
# Scaling-law methodology: https://github.com/LAION-AI/scaling-laws-for-comparison
import argparse
import os

import matplotlib
import numpy as np
import polars as pl

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from fit import HERE, data, frontier, law  # noqa: E402

TIERS = {"XXS": "#0b7a3e", "XS": "#7cb82f", "S": "#f2b705", "M": "#ee6c1f", "L": "#c4161c"}
DOMAINS = {"speech": "#0072b2", "music": "#d55e00", "sound": "#009e73"}
TASKS = {"maeb30": "MAEB-30", "clf": "Classification", "clust": "Clustering", "pair": "Pair classification",
         "retr": "Retrieval", "zs": "Zero-shot classification"}
C_MAX = 1e12


def fitted(ax, points, fits, target, cut=np.inf, label="", color="#2166ac"):
    """Points, compute-Pareto frontier, median-parameter law (dashed beyond the fitted range) and its 95 % band."""
    c, y, front, used = data(points, target, cut)
    g = fits.filter((pl.col("target") == target) & (pl.col("cut") == cut)).select("a", "b", "k", "e").to_numpy()
    p = np.median(g, 0)
    grid = np.geomspace(c[used].min(), C_MAX, 300)
    lo, hi = np.percentile([law(grid, *q) for q in g], [2.5, 97.5], 0)
    ax.fill_between(grid, lo, hi, color=color, alpha=0.2, lw=0)
    inside = grid <= c[used].max()
    ax.plot(grid[inside], law(grid[inside], *p), color=color, lw=1,
            label=f"{label}{p[0]:.2f} (C + exp({np.log(p[1]):.2f}))$^{{{p[2]:.3g}}}$ + {p[3]:.2f}")
    ax.plot(grid[~inside], law(grid[~inside], *p), color=color, lw=1, ls="--")
    ax.scatter(c[~front], y[~front], color=color, alpha=0.12, s=25, lw=0)
    ax.scatter(c[used], y[used], color=color, alpha=0.6, s=30, lw=0)
    ax.scatter(c[front & ~used], y[front & ~used], color=color, marker="X", s=50)


def style(ax, ylabel):
    """Log compute axis, labels, grid and legend."""
    ax.set_xscale("log")
    ax.set_xlabel("Compute $C$ [GFLOPs]")
    ax.set_ylabel(ylabel)
    ax.grid(True, which="both", ls="--", lw=0.4, alpha=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(loc="lower left", fontsize=8)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--points", default=os.path.join(HERE, "points.csv"))
    ap.add_argument("--fits", default="fits.parquet")
    ap.add_argument("--out", default="figures")
    ap.add_argument("--holdout", type=float, default=1e11)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    d, fits = pl.read_csv(a.points), pl.read_parquet(a.fits)
    save = lambda fig, name: (fig.tight_layout(), fig.savefig(os.path.join(a.out, name)), plt.close(fig))

    for name, cut in [("maeb30.pdf", np.inf), ("maeb30_holdout.pdf", a.holdout)]:
        fig, ax = plt.subplots(figsize=(6.4, 4.8))
        fitted(ax, a.points, fits, "maeb30", cut, "Ours: ")
        style(ax, "MAEB 30-task mean [1 - score]")
        save(fig, name)

    fig, ax = plt.subplots(figsize=(5.4, 5.6))
    for target, color in DOMAINS.items():
        fitted(ax, a.points, fits, target, label=f"{target.title()}: ", color=color)
    style(ax, "MAEB, per domain [1 - score]")
    save(fig, "domains.pdf")

    fig, axes = plt.subplots(2, 3, figsize=(15, 8.4))
    for ax, (target, title) in zip(axes.flat, TASKS.items()):
        fitted(ax, a.points, fits, target)
        style(ax, "[1 - score]")
        ax.set_title(title)
    save(fig, "tasks.pdf")

    wsd = d.filter(pl.col("schedule") == "wsd").with_columns(err=1 - pl.col("maeb30"))
    fig, ax = plt.subplots(figsize=(6.4, 4.8))
    for tier, color in TIERS.items():
        t = wsd.filter(pl.col("tier") == tier).sort("C")
        ax.plot(t["C"], t["err"], "o-", color=color, ms=5, label=f"{tier} ({t['params_m'][0]:.0f}M par)")
    c, y = wsd["C"].to_numpy(), wsd["err"].to_numpy()
    f = frontier(c, y)
    order = np.argsort(c[f])
    ax.plot(c[f][order], y[f][order], "--", color="#333", lw=2, label="compute-Pareto envelope")
    style(ax, "MAEB 30-task mean [1 - score]")
    save(fig, "sizes.pdf")

    fig, ax = plt.subplots(figsize=(6.4, 4.8))
    for D, g in wsd.sort("D", "C").group_by("D", maintain_order=True):
        line = ax.plot(g["C"], g["val_loss"], "o-", ms=4, label=f"D = {D[0] / 1e6:g}M")
        ax.plot(*g.sort("val_loss").select("C", "val_loss").row(0), "*", ms=12, color=line[0].get_color())
    style(ax, "Validation loss")
    ax.set_yscale("log")
    save(fig, "val_loss.pdf")


if __name__ == "__main__":
    main()
