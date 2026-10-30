"""Coverage-aware selection: gate, minimum probabilities, cluster factor, mixture water-fill, hash draw, exact-size trim."""
import argparse
from pathlib import Path

import numpy as np
import polars as pl
import yaml

from common.tars import save

SPEECH, MUSIC, SFX = "Speech", "Music", "Sound effects  -  designed sounds"
RULES = ["language", "emotion", "species", "leaf", "second_prediction", "source"]  # label priority
STATS = ["clip_id", "audio_id", "source", "group", "duration", "audible_s", "silence_frac", "rms_db", "has_model_caption", "text_len"]


def splitmix64(x):
    """SplitMix64 finaliser of a uint64 array."""
    z = x + np.uint64(0x9E3779B97F4A7C15)
    z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    return z ^ (z >> np.uint64(31))


def annotation(work, name, cols):
    return pl.scan_parquet(work / "annotation" / name / "**" / "*.parquet").select("clip_id", *cols)


def table(work, cfg):
    """One row per pool clip: stats, cluster size, taxonomy, language, emotion, species, hashes."""
    pool = pl.scan_parquet(work / "pool.parquet").select("clip_id")
    df = (pool.join(pl.scan_parquet(work / "stats" / "**" / "*.parquet").select(STATS), on="clip_id")
          .join(annotation(work, "taxonomy", ["tax_l1_prob", "tax_l1_top3", "tax_l1_top3_prob", "tax_l3", "tax_l3_prob"]), on="clip_id")
          .join(pl.scan_parquet(work / "clusters.parquet").select("clip_id", "cluster_size"), on="clip_id", how="left")
          .join(annotation(work, "language", ["lang_id", "lang_prob"]), on="clip_id", how="left")
          .join(annotation(work, "emotion", ["emo_label"]), on="clip_id", how="left")
          .join(annotation(work, "species", ["perch_top_species_id"]), on="clip_id", how="left")
          .with_columns(pl.col("tax_l3").str.split("/").list.first().alias("top"),
                        pl.col("tax_l3").str.split("/").list.slice(0, 2).list.join("/").alias("l2"),
                        pl.col("tax_l1_top3").list.get(1).alias("second"),
                        pl.col("tax_l1_top3_prob").list.get(1).alias("second_prob"),
                        pl.col("perch_top_species_id").list.first().alias("species"))
          .collect())
    assert df.height == pool.select(pl.len()).collect().item(), "pool clips without stats or taxonomy"
    assert df["clip_id"].is_unique().all(), "duplicate clips"
    a = df["audio_id"].to_numpy().astype(np.uint64)
    return df.with_columns(pl.Series("h", splitmix64(a)), pl.Series("u", splitmix64(a ^ np.uint64(cfg["draw_seed"])) / 2.0**64)).sort("h")


def deferred(l2, tags):
    """Language/accent or condition-specific speech: the first matching keyword tag (generic, condition, language)."""
    name = l2.split("/", 1)[1] if l2.startswith(SPEECH + "/") else ""
    return next((t for t, k in tags if k in name), None) in ("condition", "language")


def gate(g):
    """g_i: at least min_content_s of audible (> -60 dB) frames, duration window, not silent."""
    silent = (pl.col("silence_frac") >= g["silent_fraction"]) & (pl.col("rms_db") <= g["silent_rms_db"])
    return (pl.col("audible_s") >= g["min_content_s"]) & pl.col("duration").is_between(g["min_duration_s"], g["max_duration_s"]) & ~silent


def first(df, by, n, order=(), desc=()):
    """clip_ids of the first n rows per value of `by` in the given order, ties by hash."""
    return (df.filter(pl.col(by).is_not_null()).sort([*order, "h"], descending=[*desc, False])
            .filter(pl.int_range(pl.len()).over(by) < n)["clip_id"])


def minimum(df, f):
    """r_i: the largest minimum probability of the rules covering the clip, and the rule label."""
    v = df.filter(pl.col("g"))
    leaf = (v.sort(["tax_l3_prob", "h"], descending=[True, False])
            .with_columns(pl.when(pl.col("tax_l3_prob") >= f["leaf_confident"]).then(1.0)
                          .otherwise(f["leaf_weight_unconfident"]).alias("r_leaf"))
            .with_columns(pl.col("r_leaf").cum_sum().over("tax_l3").alias("cum"))
            .filter(pl.col("cum").shift(1, fill_value=0.0).over("tax_l3")
                    < pl.min_horizontal(pl.lit(float(f["leaf"])), pl.col("cum").max().over("tax_l3")))
            .select("clip_id", "r_leaf"))
    picked = {"language": first(v, "lang_id", f["language"], ["lang_prob"], [True]),
              "emotion": first(v.filter(pl.col("emo_label").is_in(f["emotions"])), "emo_label", f["emotion"]),
              "species": first(v, "species", f["species"])}
    second = ((pl.col("second").is_in([MUSIC, SFX]) & (pl.col("second_prob") >= f["second_music_sfx"]))
              | (~pl.col("second").is_in([SPEECH, MUSIC, SFX]) & (pl.col("second_prob") >= f["second_other"])))
    df = df.join(leaf, on="clip_id", how="left").with_columns(
        pl.col("r_leaf").fill_null(0.0),
        *(pl.col("clip_id").is_in(ids.implode()).cast(pl.Float64).alias(f"r_{r}") for r, ids in picked.items()),
        second.fill_null(False).cast(pl.Float64).alias("r_second_prediction"),
        pl.col("source").is_in(f["allowlist"]).cast(pl.Float64).alias("r_source"))
    cols = [f"r_{r}" for r in RULES]
    rule = pl.coalesce(*(pl.when(pl.col(f"r_{r}") > 0).then(pl.lit(r)) for r in RULES), pl.lit("fill"))
    return df.with_columns(pl.max_horizontal(cols).alias("r"), rule.alias("rule")).drop(cols)


def waterfill(D, E):
    """Common limit lambda with sum (D - lambda)+ = min(E, sum D)."""
    s = np.sort(D)[::-1]
    c = np.cumsum(s)
    caps = (c - min(E, c[-1])) / np.arange(1, s.size + 1)
    ok = caps >= np.append(s[1:], 0.0)
    assert ok.any()
    return max(0.0, caps[np.argmax(ok)])


def reductions(df, cfg):
    """X_h per second-level category: per group, first the adjustable categories, then language/condition speech."""
    names = df["l2"].unique().sort()
    code = df["l2"].cast(pl.Enum(names)).to_physical().to_numpy()
    P = np.bincount(code, df["g"].to_numpy() * df["r"].to_numpy(), names.len())  # sequential sums: bit-reproducible
    D = np.bincount(code, df["d"].to_numpy(), names.len())
    grp = df["grp"].to_numpy()[np.unique(code, return_index=True)[1]]
    tags = pl.read_csv(Path(__file__).parent / cfg["second_level"]).rows()
    later = np.array([deferred(h, tags) for h in names])
    X, eps = {}, cfg["min_reduction"]
    for b, share in cfg["shares"].items():
        E = max(0.0, (P + D)[grp == b].sum() - share * cfg["budget"])
        for step in ((grp == b) & ~later, (grp == b) & later):
            R = min(E, D[step].sum())
            if R > eps:
                lam = waterfill(D[step], R)
                X |= {h: x for h, x in zip(names.to_numpy()[step], D[step] - lam) if x > eps}
            E -= R
    return X


def score():
    """Removal score s_i = 4G + 2q + (8/170) log2 n + 2A - 2E."""
    return (4.0 * (pl.col("group") == "youtube").cast(pl.Float64) + 2.0 * pl.col("tax_l1_prob").fill_null(0.0)
            + (8 / 170) * pl.col("cluster_size").log(2).fill_null(0.0)
            + 2.0 * pl.col("has_text").cast(pl.Float64) - 2.0 * pl.col("expressive").cast(pl.Float64))


def trim(sel, target, seed):
    """Keep every row except speech fill clips, of which the lowest SplitMix64 hashes fill up to exactly `target` rows."""
    elig = sel.select((pl.col("rule") == "fill") & (pl.col("top") == SPEECH)).to_series().to_numpy()
    need = target - int((~elig).sum())
    assert 0 <= need <= elig.sum(), f"cannot trim {sel.height:,} rows ({elig.sum():,} speech fill) to {target:,}"
    t = splitmix64(sel["audio_id"].to_numpy().astype(np.uint64)[elig] ^ np.uint64(seed))
    radix = (t >> np.uint64(48)).astype(np.int64)  # 16-bit ranges; only the range holding the cutoff is sorted
    cum = np.cumsum(np.bincount(radix, minlength=1 << 16))
    b = int(np.searchsorted(cum, need))
    keep = radix < b
    inside = np.flatnonzero(radix == b)
    keep[inside[np.argsort(t[inside])[: need - (int(cum[b - 1]) if b else 0)]]] = True
    mask = ~elig
    mask[np.flatnonzero(elig)[keep]] = True
    assert mask.sum() == target
    return sel.filter(pl.Series(mask))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work", type=Path)
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("config.yaml"))
    a = ap.parse_args()
    cfg = yaml.safe_load(a.config.read_text())
    df = table(a.work, cfg).with_columns(
        gate(cfg["gate"]).alias("g"),
        pl.when(pl.col("top") == SPEECH).then(pl.lit("speech")).when(pl.col("top") == MUSIC).then(pl.lit("music"))
        .otherwise(pl.lit("rest")).alias("grp"),
        (pl.col("has_model_caption") | (pl.col("text_len") >= cfg["min_text_len"])).alias("has_text"),
        pl.col("emo_label").is_in(cfg["floors"]["emotions"]).fill_null(False).alias("expressive"),
        pl.min_horizontal(pl.lit(1.0), 2.0 ** cfg["cluster_log2"] / pl.col("cluster_size")).fill_null(1.0).alias("c"))
    df = minimum(df, cfg["floors"]).with_columns((pl.col("g") * (1 - pl.col("r")) * pl.col("c")).alias("d"))
    X = reductions(df, cfg)
    df = (df.with_columns(score().alias("s"), pl.col("l2").replace_strict(X, default=None, return_dtype=pl.Float64).alias("X"))
          .sort(["s", "h"], descending=[True, False])
          .with_columns(pl.col("d").cum_sum().over("l2").alias("cum"))
          .with_columns(pl.when(pl.col("X").is_null() | (pl.col("d") == 0)).then(1.0)
                        .otherwise(((pl.col("cum") - pl.col("X")) / pl.col("d")).clip(0.0, 1.0)).alias("w"))
          .with_columns((pl.col("g") * (pl.col("r") + (1 - pl.col("r")) * pl.col("c") * pl.col("w"))).alias("p")))
    sel = trim(df.filter(pl.col("u") < pl.col("p")).sort("clip_id"), cfg["target"], cfg["trim_seed"])
    sel = sel.select("clip_id", "audio_id", "source", "top", "l2", "rule", "p")
    print(sel.group_by("rule").len().sort("len", descending=True))
    save(sel, a.work / "selection.parquet")


if __name__ == "__main__":
    main()
