"""Merge the evidence of all matchers per (corpus clip, scored eval unit), decide with policy.json, and write
eval/removed.parquet (one row per removed clip with its evidence) and pool.parquet (pool_dedup minus the removals)."""
import argparse
import json
from pathlib import Path

import polars as pl

from common.tars import per_tar, save, todo


POLICY = json.loads((Path(__file__).resolve().parent / "policy.json").read_text())
RANK = {"C0": 0, "C1": 1, "C2": 2, "C3": 3}
CLASS = {v: k for k, v in RANK.items()}
CONTENT = ["M2", "M3", "M4", "M5"]
SIG = {"significant": 0, "content_unidentifiable": 1, "chance": 2}
SIG_NAME = {v: k for k, v in SIG.items()}
COLS = ["clip_id", "method", "eval_audio_id", "v_class", "v_rho", "v_cov_eval", "v_overlap_s", "offset_s", "eval_start_s",
        "eval_end_s", "sig_class"]


def evidence(work, pool):
    """Content rows with a positive V class (M2, M3, M4) and every exhaustive-search finding, inside the pool."""
    pos = pl.col("v_class").is_in(list(RANK))
    parts = [per_tar(work / "eval" / d).filter(pos).with_columns(pl.lit(None, pl.String).alias("sig_class")) for d in ("fingerprints", "neural")]
    parts.append(per_tar(work / "eval/exhaustive").filter(pl.col("m5_class") != "")
                 .with_columns(pl.col("sig_class").replace_strict(POLICY["m5_methods"]).alias("method")))
    ev = pl.concat([p.select(COLS) for p in parts]).join(pool.lazy(), on="clip_id").collect(engine="streaming")
    m1 = pl.read_parquet(work / "eval/identifiers.parquet").join(pool, on="clip_id")
    m1 = m1.filter(pl.col("class_hint").is_in(POLICY["m1_named"])).select(
        "clip_id", "eval_audio_id", "duration", "class_hint", "match_type", pl.lit("M1").alias("method"),
        pl.col("eval_win_s").alias("span_s"), pl.col("eval_win_e").alias("span_e"))
    return ev, m1


def units(ev, m1, items, ai):
    """Evidence rows -> rows per scored eval unit: the audio itself, the windows a match overlaps on long recordings
    (BirdSet), or the scored mixture whose recipe names a matched source (relation component)."""
    dur = ai.select("eval_audio_id", (pl.col("n_samples") / 16000).alias("eval_dur"), pl.col("eval_dataset").alias("unit_dataset"))
    ev = ev.join(dur, on="eval_audio_id")
    a0, a1 = pl.max_horizontal(0.0, "offset_s"), pl.min_horizontal("eval_dur", pl.col("offset_s") + pl.col("duration"))
    ov, mid = pl.col("v_overlap_s").cast(pl.Float64), (pl.col("eval_start_s") + pl.col("eval_end_s")) / 2
    full = ov >= 0.9 * (a1 - a0)
    ev = ev.with_columns(pl.when(full).then(a0).otherwise(pl.max_horizontal(a0, pl.min_horizontal(mid - ov / 2, a1 - ov))).alias("span_s"),
                         pl.when(full).then(a1).otherwise(pl.min_horizontal(a1, pl.max_horizontal(mid + ov / 2, a0 + ov))).alias("span_e"))
    E = pl.concat([ev, m1.join(dur, on="eval_audio_id")], how="diagonal").with_row_index("row")
    scored = items.filter(pl.col("scored"))
    win = (scored.join(ai.filter(pl.col("kind") == "source_recording").select("eval_audio_id"), on="eval_audio_id")
           .select("eval_audio_id", "seg_start_s", "seg_end_s").unique())
    src = items.filter(pl.col("role") == "source_recording").select("eval_audio_id", pl.col("orig_filename").str.to_lowercase().alias("fn"))
    recipe = (scored.filter(pl.col("source_file").is_not_null()).select(pl.col("eval_audio_id").alias("mix"),
              pl.col("source_file").str.to_lowercase().str.split(";").alias("fn")).explode("fn")
              .join(src, on="fn").select("eval_audio_id", "mix").unique())
    direct = E.join(scored.select("eval_audio_id").unique(), on="eval_audio_id").join(win.select("eval_audio_id").unique(),
                                                                                      on="eval_audio_id", how="anti")
    w = E.join(win, on="eval_audio_id").filter(
        pl.min_horizontal("span_e", "seg_end_s") - pl.max_horizontal("span_s", "seg_start_s")
        >= pl.min_horizontal(POLICY["window"]["min_overlap_s"], POLICY["window"]["min_overlap_frac"] * (pl.col("seg_end_s") - pl.col("seg_start_s"))) - 1e-6)
    comp = E.join(recipe, on="eval_audio_id").join(dur.select(pl.col("eval_audio_id").alias("mix"), pl.col("unit_dataset").alias("mix_ds")), on="mix")
    out = [direct.with_columns(pl.format("a{}", "eval_audio_id").alias("unit"), pl.lit("direct").alias("relation")),
           w.with_columns(pl.format("w{}:{}", "eval_audio_id", "seg_start_s").alias("unit"), pl.lit("window").alias("relation")),
           comp.with_columns(pl.format("a{}", "mix").alias("unit"), pl.col("mix_ds").alias("unit_dataset"),
                             pl.lit("component").alias("relation"))]
    rest = E.join(pl.concat([o.select("row") for o in out]), on="row", how="anti")
    is_src = pl.col("eval_audio_id").is_in(src["eval_audio_id"].implode())
    out.append(rest.with_columns(pl.format("a{}", "eval_audio_id").alias("unit"),
                                 pl.when(is_src).then(pl.lit("unscored_component")).otherwise(pl.lit("window_unmapped")).alias("relation")))
    return pl.concat([o.select(E.columns + ["unit", "relation"]) for o in out], how="diagonal")


def decide(U, items, clip_notes):
    """One row per (clip, unit): content class, metadata, significance, policy rule and the removal decision."""
    content = pl.col("method").is_in(CONTENT)
    r = (pl.when(content & (pl.col("relation") == "component") & pl.col("v_class").is_in(list(RANK))).then(3)
         .otherwise(pl.col("v_class").replace_strict(RANK, default=9, return_dtype=pl.Int8)))
    U = U.with_columns(r.alias("r"), pl.col("sig_class").replace_strict(SIG, default=None, return_dtype=pl.Int8).alias("s"))
    U = U.sort(["r", pl.col("v_rho").fill_null(-1)], descending=[False, True])
    g = U.group_by("clip_id", "unit").agg(
        pl.col("unit_dataset").first(), pl.col("relation").first(),
        pl.col("r").filter(content).min().alias("rc"),
        *[pl.col(c).filter(content).first().alias(f"best_{c}") for c in ("method", "eval_audio_id", "v_rho", "v_cov_eval", "offset_s")],
        pl.col("v_cov_eval").filter((pl.col("method") == "M5") & (pl.col("r") <= 2)).max().alias("m5_cov"),
        pl.col("class_hint").drop_nulls().unique().alias("m1_hints"), pl.col("match_type").drop_nulls().unique().alias("m1_types"),
        (content & (pl.col("relation") == "component") & (pl.col("r") <= 3)).any().alias("recipe_named"),
        pl.col("s").min().alias("m5_sig"), (pl.col("method") == "M5u").any().alias("m5u"),
        pl.col("method").filter(content & (pl.col("r") <= 3)).unique().sort().alias("methods"))

    def hint(key):
        return pl.col("m1_hints").list.eval(pl.element().is_in(POLICY[key])).list.any()

    g = g.with_columns((pl.col("rc") <= 2).fill_null(False).alias("rem"), (pl.col("rc") == 3).fill_null(False).alias("c3"),
                       (pl.col("rc") <= 3).fill_null(False).alias("cf"), (hint("m1_named") | pl.col("recipe_named")).alias("named"),
                       hint("m1_finding").alias("m1_find"), hint("m1_strong").alias("m1_strong"))
    # hubs: units matched by more than hub.min_clips clips; their matches must cover enough of the eval item
    ev = pl.col("rem") | (pl.col("c3") & pl.col("named")) | pl.col("m1_strong")
    hub = g.filter(ev).group_by("unit").len().filter(pl.col("len") > POLICY["hub"]["min_clips"]).select("unit", pl.lit(True).alias("hub"))
    g = g.join(hub, on="unit", how="left").with_columns(pl.col("hub").fill_null(False))
    hub_low = pl.col("hub") & (pl.max_horizontal(pl.col("best_v_cov_eval").fill_null(0), pl.col("m5_cov").fill_null(0))
                               < POLICY["hub"]["min_cov_eval"])
    mh = (g.filter((pl.col("unit_dataset") == "minds14") & pl.col("cf")).group_by("clip_id")
          .agg((pl.col("unit").n_unique() > POLICY["minds14_prompt"]["min_items"]).alias("minds14_clip")))
    # NSynth: the clip's own note against the eval notes of the unit (preset-pitch-velocity)
    notes = (items.filter(pl.col("eval_dataset") == "nsynth").select(pl.format("a{}", "eval_audio_id").alias("unit"),
             pl.col("orig_filename").str.to_lowercase().str.replace(r"\.(wav|flac)$", "").alias("note")).group_by("unit").agg("note"))
    g = g.join(mh, on="clip_id", how="left").join(notes, on="unit", how="left").join(clip_notes, on="clip_id", how="left")

    def pp(e):
        return e.str.split("-").list.slice(0, 2).list.join("-")

    other = (pl.col("unit_dataset") == "nsynth") & pl.col("clip_note").is_not_null() & pl.col("note").is_not_null() \
        & ~pl.col("note").list.contains(pl.col("clip_note")) & ~pl.col("m1_strong")
    same_pp = other & pl.col("note").list.eval(pp(pl.element())).list.contains(pp(pl.col("clip_note")))
    m5u_only = pl.col("m5u") & ~pl.col("cf") & ~pl.col("m1_find")
    rel = pl.col("relation")
    rule = (pl.when(~pl.col("cf") & ~pl.col("m1_find") & ~pl.col("m5u")).then(pl.lit("none"))
            .when(m5u_only).then(pl.lit("M5_unidentifiable"))
            .when((rel == "unscored_component") & (pl.col("unit_dataset") == "libricount") & pl.col("rem")).then(pl.lit("libricount_source"))
            .when(rel == "unscored_component").then(pl.lit("unscored_component"))
            .when(rel == "window_unmapped").then(pl.lit("window_unmapped"))
            .when(pl.col("rem") & hub_low & pl.col("minds14_clip").fill_null(False)).then(pl.lit("minds14_prompt"))
            .when((pl.col("rem") | (pl.col("c3") & pl.col("named"))) & hub_low).then(pl.lit("hub_lowcov"))
            .when(pl.col("rem") & other.fill_null(False) & same_pp.fill_null(False)).then(pl.lit("nsynth_same_preset"))
            .when(pl.col("rem") & other.fill_null(False)).then(pl.lit("nsynth_other_note"))
            .when(pl.col("rem")).then(pl.lit("C0-C2_content"))
            .when(pl.col("c3") & pl.col("named")).then(pl.lit("C3_named"))
            .when(pl.col("c3")).then(pl.lit("C3_content"))
            .when(pl.col("m1_strong")).then(pl.lit("M1_only")).otherwise(pl.lit("M1_report")))
    g = g.with_columns(rule.alias("policy_rule")).with_columns(pl.col("policy_rule").is_in(POLICY["in_policy"]).alias("in_policy"))
    # in policy and a real copy: the exhaustive search found the pair significant or did not measure it, or metadata names it
    reason = (pl.when(~pl.col("in_policy")).then(pl.lit(None, pl.String)).when(pl.col("m5_sig") == 0).then(pl.lit("m5_significant"))
              .when(pl.col("named")).then(pl.lit("metadata")).when(pl.col("m5_sig").is_null()).then(pl.lit("not_measured_by_m5"))
              .otherwise(pl.lit("kept_m5_") + pl.col("m5_sig").replace_strict(SIG_NAME)))
    return g.with_columns(reason.alias("remove_reason")).with_columns(
        (pl.col("in_policy") & ~pl.col("remove_reason").str.starts_with("kept_")).fill_null(False).alias("remove"))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    a = ap.parse_args()
    for d in ("identifiers", "fingerprints", "neural", "exhaustive"):
        assert not todo(a.work / "collected", a.work / "eval" / d, ".parquet"), f"eval/{d} incomplete"
    pool = pl.read_parquet(a.work / "pool_dedup.parquet")
    assert {"clip_id", "duration"} <= set(pool.columns) and pool["clip_id"].is_unique().all()
    items = pl.read_parquet(a.work / "eval/registry/items.parquet")
    ai = pl.read_parquet(a.work / "eval/registry/audio_index.parquet")
    ev, m1 = evidence(a.work, pool.select("clip_id", "duration"))
    clip_notes = (per_tar(a.work / "eval/identifiers").filter(pl.col("t") == "nsynth").group_by("clip_id")
                  .agg(pl.col("v").first().alias("clip_note")).collect())
    D = decide(units(ev, m1, items, ai), items, clip_notes)
    rank = {r: i for i, r in enumerate(POLICY["in_policy"])}
    removed = (D.filter("remove").sort(pl.col("policy_rule").replace_strict(rank), pl.col("best_v_rho").fill_null(-1),
                                       descending=[False, True])
               .group_by("clip_id").agg(
                   pl.col("unit_dataset").unique().sort().alias("eval_datasets"), pl.col("best_eval_audio_id").first().alias("eval_audio_id"),
                   pl.col("policy_rule").first(), pl.col("remove_reason").first(),
                   pl.col("rc").min().replace_strict(CLASS, default=None).alias("match_class"),
                   pl.col("methods").explode().drop_nulls().unique().sort(), pl.col("m1_types").explode().drop_nulls().unique().sort().alias("m1_match_types"),
                   pl.col("best_v_rho").max().alias("v_rho"), pl.col("best_v_cov_eval").first().alias("v_cov_eval"),
                   pl.col("best_offset_s").first().alias("offset_s"),
                   pl.col("m5_sig").min().replace_strict(SIG_NAME).alias("m5_sig_class"),
                   pl.col("unit").n_unique().alias("n_eval_units"))
               .sort("clip_id"))
    save(removed, a.work / "eval/removed.parquet")
    save(pool.join(removed.select("clip_id"), on="clip_id", how="anti"), a.work / "pool.parquet")
    print(f"{removed.height:,} of {pool.height:,} clips removed;", D.filter("in_policy").group_by("policy_rule", "remove_reason")
          .len().sort("len", descending=True).rows(), flush=True)


if __name__ == "__main__":
    main()
