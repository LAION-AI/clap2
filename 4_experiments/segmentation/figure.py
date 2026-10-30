"""Segmentation figure: MAEB-30 per run and mean +- standard deviation over seeds for each cutting method."""
import argparse
import os

import matplotlib
import polars as pl

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

METHODS = {"random": ("Random crops", "#7b8490"), "quality": ("Quality-filtered", "#b48636"),
           "silence": ("Silence cuts", "#168579")}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.csv"))
    ap.add_argument("--out", default="segmentation_comparison.pdf")
    a = ap.parse_args()
    d = pl.read_csv(a.results)
    assert d.group_by("method").len()["len"].to_list() == [3] * len(METHODS), "expected three seeds per method"
    plt.rcParams.update({"font.family": "serif", "font.size": 10, "pdf.fonttype": 42})
    fig, ax = plt.subplots(figsize=(3.55, 1.6))
    fig.subplots_adjust(left=0.40, right=0.98, bottom=0.275, top=0.97)
    for y, (method, (label, color)) in enumerate(METHODS.items()):
        runs = d.filter(pl.col("method") == method).sort("seed")["maeb30"]
        ax.scatter(runs, [y - 0.12, y, y + 0.12], s=14, facecolor="white", edgecolor=color, linewidth=0.8, zorder=3)
        ax.errorbar(runs.mean(), y, xerr=runs.std(), fmt="D", color=color, markersize=4, capsize=2.5, lw=1.25, zorder=4)
        print(f"{label}: {runs.mean():.2f} +- {runs.std():.2f}")
    ax.set_yticks(range(len(METHODS)), [label for label, _ in METHODS.values()])
    ax.set_ylim(len(METHODS) - 0.55, -0.45)
    ax.set_xlabel("MAEB-30 score (%)", labelpad=3)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.tick_params(axis="y", length=0, pad=5)
    ax.grid(axis="x", color="#e6e8eb", lw=0.65)
    ax.set_axisbelow(True)
    fig.savefig(a.out)


if __name__ == "__main__":
    main()
