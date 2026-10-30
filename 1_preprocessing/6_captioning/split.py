"""Split the selected clips without text into a Qwen and a MOSS half: whole tars, balanced by clip count per source."""
import argparse
from collections import defaultdict
from pathlib import Path

import polars as pl

from common.tars import save

MODELS = ("qwen", "moss")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    a = ap.parse_args()
    stats = pl.scan_parquet(a.work / "stats" / "**" / "*.parquet").select("clip_id", "source", "tar", "key", "text_len")
    clips = (pl.scan_parquet(a.work / "selection.parquet").select("clip_id").join(stats, on="clip_id")
             .filter(pl.col("text_len") == 0).collect())
    tars = clips.group_by("tar", "source").len().sort("tar")
    assert tars["tar"].is_unique().all(), "a tar holds clips of several sources"
    counts, side = defaultdict(lambda: [0, 0]), {}
    for tar, source, n in tars.iter_rows():
        c = counts[source]
        i = int(c[0] > c[1])
        c[i] += n
        side[tar] = MODELS[i]
    clips = clips.with_columns(model=pl.col("tar").replace_strict(side))
    for m in MODELS:
        part = clips.filter(pl.col("model") == m).select("tar", "key").sort("tar", "key")
        save(part, a.work / "caption_split" / f"{m}.parquet")
        print(f"{m}: {part.height:,} clips in {part['tar'].n_unique():,} tars")


if __name__ == "__main__":
    main()
