"""Fit L(C) = A (C + e^B)^-alpha + E to the compute-Pareto frontier of points.csv (bootstrap fits, held-out check)."""
# Scaling-law methodology: https://github.com/LAION-AI/scaling-laws-for-comparison
import argparse
import itertools
import os
import warnings
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import polars as pl
from scipy.optimize import OptimizeWarning, curve_fit

from common.tars import CPUS, save

TARGETS = ["maeb30", "speech", "music", "sound", "clf", "zs", "pair", "clust", "retr"]
STARTS = list(itertools.product(np.arange(0, 100, 5), np.arange(0, 100, 5), np.arange(-0.2, 0, 0.05),
                                np.arange(0, 1e-3, 5e-4)))  # A, e^B, -alpha, E
BOUNDS = ([0, 0, -np.inf, 0], [np.inf, np.inf, 0, np.inf])
HERE = os.path.dirname(os.path.abspath(__file__))


def law(c, a, b, k, e):
    """Error at compute c (GFLOPs); k = -alpha."""
    return a * (c + b) ** k + e


def frontier(c, y):
    """Mask of the compute-Pareto frontier: points with lower error than every point of no more compute."""
    keep, best = np.zeros(len(c), bool), np.inf
    for i in np.lexsort((y, c)):
        keep[i], best = y[i] < best, min(best, y[i])
    return keep


def fit(c, y):
    """Least-squares fit of `law`: the best of a multi-start grid of curve_fit runs."""
    with warnings.catch_warnings(), np.errstate(all="ignore"):  # starts far from the optimum over- and underflow
        warnings.simplefilter("ignore", OptimizeWarning)
        fits = [curve_fit(law, c, y, p0=p, bounds=BOUNDS, maxfev=1_000_000)[0] for p in STARTS]
    return min(fits, key=lambda p: np.mean((law(c, *p) - y) ** 2))


def data(points, target, cut):
    """(C, error, frontier mask, fitted mask) of one target; the fit uses the frontier points with C <= cut."""
    d = pl.read_csv(points)
    c, y = d["C"].to_numpy(), 1 - d[target].to_numpy()
    f = frontier(c, y)
    return c, y, f, f & (c <= cut)


def summary(points, fits):
    """Median bootstrap parameters per fit, and the error of the held-out frontier points."""
    rows = []
    for (target, cut), g in fits.group_by("target", "cut", maintain_order=True):
        p = g.select("a", "b", "k", "e").median().row(0)
        c, y, f, used = data(points, target, cut)
        held = f & ~used
        r = law(c[held], *p) - y[held]
        rows.append(dict(target=target, cut=cut, n_fit=int(used.sum()), n_held=int(held.sum()), A=p[0],
                         log_B=np.log(p[1]), alpha=-p[2], E=p[3], mse=float(np.mean(r**2)) if held.any() else None,
                         mae=float(np.mean(np.abs(r))) if held.any() else None))
    return pl.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--points", default=os.path.join(HERE, "points.csv"))
    ap.add_argument("--out", default="fits.parquet", help="bootstrap parameters, one row per (target, cut, boot)")
    ap.add_argument("--targets", nargs="+", choices=TARGETS, default=TARGETS)
    ap.add_argument("--boot", type=int, default=1000)
    ap.add_argument("--holdout", type=float, default=1e11, help="also fit maeb30 on frontier points with C <= this")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=CPUS)
    a = ap.parse_args()
    rng, rows = np.random.default_rng(a.seed), []
    with ProcessPoolExecutor(a.workers) as ex:
        for target, cut in [(t, np.inf) for t in a.targets] + [("maeb30", a.holdout)] * ("maeb30" in a.targets):
            c, y, _, used = data(a.points, target, cut)
            c, y = c[used], y[used]
            idx = rng.integers(0, len(c), (a.boot, len(c)))
            for n, p in enumerate(ex.map(fit, (c[i] for i in idx), (y[i] for i in idx))):
                rows.append(dict(target=target, cut=cut, boot=n, a=p[0], b=p[1], k=p[2], e=p[3]))
    fits = pl.DataFrame(rows)
    save(fits, a.out)
    with pl.Config(tbl_rows=-1, tbl_cols=-1, float_precision=6):
        print(summary(a.points, fits))


if __name__ == "__main__":
    main()
