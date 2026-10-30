"""Captioner comparison: vocabulary at a token budget, Bradley-Terry strengths, mean ranks and Kendall tau_b vs humans."""
import argparse
import re
from pathlib import Path

import numpy as np
import polars as pl
from scipy.stats import kendalltau

MODELS = ["Qwen2.5-Omni-7B", "Qwen3-Omni-30B-A3B", "Audex-30B-A3B", "AudioFlamingoNext", "Nemotron-3-Nano-Omni-30B-A3B",
          "MOSS-Audio-8B (thinking off)", "MOSS-Audio-8B (thinking on)"]  # order fixes the judge's seeded shuffles
K = len(MODELS)


def vocab(captions, budget):
    """Unique lower-cased words among the first `budget` words of the captions, marked * if there are fewer words."""
    words = [w for c in captions for w in re.findall(r"\w+", c.lower())][:budget]
    return f"{len(set(words)):,}" + ("*" if len(words) < budget else "")


def bradley_terry(wins, iters=300):
    """MM fit of Bradley-Terry strengths (mean 1) from win matrices wins[..., i, j] = times i was ranked above j."""
    p, games = np.ones(wins.shape[:-1]), wins + np.swapaxes(wins, -1, -2)
    for _ in range(iters):
        p = wins.sum(-1) / (games / (p[..., :, None] + p[..., None, :])).sum(-1)
        p /= p.mean(-1, keepdims=True)
    return p


def interval(values, n, seed=0):
    """Mean over rows and the 95 % percentile bootstrap interval from n resamples of the rows."""
    means = values[np.random.default_rng(seed).integers(0, len(values), (n, len(values)))].mean(1)
    return values.mean(0), *np.percentile(means, [2.5, 97.5], axis=0)


def ranks(order):
    """Rank (1 = best) of each model in MODELS order, from a best-first list of models."""
    return np.array([order.index(m) + 1 for m in MODELS])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path(__file__).parent / "data")
    ap.add_argument("--boot", type=int, default=20000, help="bootstrap resamples over clips")
    ap.add_argument("--bt-boot", type=int, default=1000, help="bootstrap resamples for the Bradley-Terry strengths")
    a = ap.parse_args()
    caps = pl.read_parquet(a.data / "captions.parquet").sort("key")
    judge = pl.read_parquet(a.data / "judge.parquet").filter(pl.col("perm") == 0)
    human = pl.read_parquet(a.data / "human.parquet")
    print(f"{judge['ranking'].is_null().sum()} of {judge.height} judge replies malformed and left out")
    judge = judge.drop_nulls("ranking")

    pos = np.stack([ranks(r) for r in judge["ranking"].to_list()])
    wins = (pos[:, :, None] < pos[:, None, :]).astype(float)
    rng = np.random.default_rng(0)
    counts = np.stack([np.bincount(rng.integers(0, len(wins), len(wins)), minlength=len(wins)) for _ in range(a.bt_boot)])
    bt, bt_boot = bradley_terry(wins.sum(0)), bradley_terry((counts @ wins.reshape(len(wins), -1)).reshape(-1, K, K))
    bt_lo, bt_hi = np.percentile(bt_boot, [2.5, 97.5], axis=0)

    items = sorted(set(human.select("key", "ctype").iter_rows()))
    by = {(r["annotator"], r["key"], r["ctype"]): r["order"] for r in human.sort("rank").group_by(
        "annotator", "key", "ctype").agg(order=pl.col("model")).iter_rows(named=True)}
    llm = {(k, c): list(o) for k, c, o in judge.select("key", "ctype", "ranking").iter_rows()}
    who = sorted(human["annotator"].unique())
    assert len(who) == 2 and len(items) == 50 and all((w, *i) in by for w in who for i in items)
    hum = np.stack([(ranks(by[(who[0], *i)]) + ranks(by[(who[1], *i)])) / 2 for i in items])
    judged = [i for i in items if i in llm]
    h_mean, h_lo, h_hi = interval(hum, a.boot)
    j_mean, j_lo, j_hi = interval(np.stack([ranks(llm[i]) for i in judged]), a.boot)

    print(f"\n{'captioner':30s} {'vocab@80k':>9s} {'vocab@400k':>10s} {'human rank':>12s} {'LLM rank':>12s}  LLM BT [95 % CI]")
    for i in np.argsort(-bt):
        m = caps.filter(pl.col("model") == MODELS[i])
        print(f"{MODELS[i]:30s} {vocab(m['short'], 80_000):>9s} {vocab(m['long'], 400_000):>10s} "
              f"{h_mean[i]:6.2f}±{(h_hi[i] - h_lo[i]) / 2:.2f} {j_mean[i]:6.2f}±{(j_hi[i] - j_lo[i]) / 2:.2f}  "
              f"{bt[i]:.3f} [{bt_lo[i]:.3f}, {bt_hi[i]:.3f}]")
    print("* fewer words than the budget: all words counted")
    print(f"\n{len(items)} clips ranked by both annotators, {len(judged)} of them with a valid judge ranking; "
          f"same top caption on {sum(by[(who[0], *i)][0] == by[(who[1], *i)][0] for i in items)}")
    for x, y, its in [(who[0], who[1], items), (who[0], "judge", judged), (who[1], "judge", judged)]:
        get = lambda w, i: ranks(llm[i] if w == "judge" else by[(w, *i)])
        tau = np.array([[kendalltau(get(x, i), get(y, i)).statistic] for i in its])
        mean, lo, hi = interval(tau, a.boot)
        print(f"Kendall tau_b {x} vs {y}: {mean[0]:+.3f} [{lo[0]:+.3f}, {hi[0]:+.3f}] over {len(its)} clips")


if __name__ == "__main__":
    main()
