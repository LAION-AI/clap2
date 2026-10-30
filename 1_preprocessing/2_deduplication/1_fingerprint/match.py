"""Olaf matching: 512 hash buckets, per-track hot-hash drop, 32 ms offset votes, q = m / sqrt(na nb) >= 0.5, components."""
import argparse
import shutil
from pathlib import Path

import numpy as np
import polars as pl

from common.keep import COLUMNS, removed_linked
from common.tars import save, todo

BUCKETS = 512
HOT = 500
OFFSET = 4
Q = 0.5


def partition(files, tracks, out, rows):
    """Write the fingerprint rows of the clips in `tracks` into one folder per hash bucket, about `rows` rows per batch."""
    tmp = Path(f"{out}.tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    batch = np.cumsum([pl.scan_parquet(f).select(pl.len()).collect().item() for f in files]) // rows
    for i in np.unique(batch):
        fp = pl.read_parquet([files[j] for j in np.flatnonzero(batch == i)]).join(tracks, on="audio_id")
        for (b,), part in fp.with_columns(bucket=pl.col("hash") % BUCKETS).partition_by("bucket", as_dict=True,
                                                                                         include_key=False).items():
            save(part, tmp / f"{b:03d}" / f"{i:06d}.parquet")
    tmp.rename(out)


def votes(bucket):
    """Distinct shared hashes per (clip a, clip b, offset) in one bucket, after dropping hashes hot within a track."""
    fp = pl.read_parquet(bucket)
    hot = fp.group_by("hash", "track").len().filter(pl.col("len") > HOT)
    fp = fp.join(hot, on=["hash", "track"], how="anti").drop("track")
    pairs = fp.join(fp, on="hash", suffix="_b").filter(pl.col("audio_id") < pl.col("audio_id_b"))
    offset = (pl.col("t1") - pl.col("t1_b")) // OFFSET
    return pairs.group_by("audio_id", "audio_id_b", offset=offset).agg(m=pl.col("hash").n_unique())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("work", type=Path)
    p.add_argument("--batch-rows", type=int, default=200_000_000)
    args = p.parse_args()
    dedup = args.work / "dedup"
    clips = (pl.read_parquet(args.work / "valid.parquet", columns=[*COLUMNS, "source"])
             .join(pl.read_parquet(dedup / "exact.parquet"), on="clip_id", how="anti"))
    tracks = clips.select("audio_id", track=pl.col("source").rank("dense").cast(pl.UInt16))
    assert not todo(args.work / "collected", args.work / "olaf", ".parquet"), "olaf incomplete"
    files = sorted((args.work / "olaf").rglob("*.parquet"))
    if not (dedup / "olaf_buckets").exists():
        partition(files, tracks, dedup / "olaf_buckets", args.batch_rows)
    for bucket in sorted((dedup / "olaf_buckets").iterdir()):
        if not (dedup / "olaf_votes" / f"{bucket.name}.parquet").exists():
            save(votes(bucket), dedup / "olaf_votes" / f"{bucket.name}.parquet")

    n = pl.scan_parquet(files).join(tracks.lazy(), on="audio_id").group_by("audio_id").agg(n=pl.len().cast(pl.Float64))
    best = (pl.scan_parquet(dedup / "olaf_votes" / "*.parquet").group_by("audio_id", "audio_id_b", "offset")
            .agg(pl.col("m").sum()).group_by("audio_id", "audio_id_b").agg(pl.col("m").max()))
    edges = (best.join(n, on="audio_id").join(n.rename({"audio_id": "audio_id_b", "n": "n_b"}), on="audio_id_b")
             .filter(pl.col("m") / (pl.col("n") * pl.col("n_b")).sqrt() >= Q).collect())
    out = removed_linked(clips, edges["audio_id"].to_numpy(), edges["audio_id_b"].to_numpy())
    save(out, dedup / "fingerprint.parquet")
    print(f"fingerprint: {edges.height:,} edges, {out.height:,} of {clips.height:,} clips removed", flush=True)


if __name__ == "__main__":
    main()
