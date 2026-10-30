"""Exact matching: valid clips with the same MD5 of 16 kHz mono PCM and the same length form a group; one is kept."""
import argparse
from pathlib import Path

import polars as pl

from common.keep import COLUMNS, removed
from common.tars import save


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("work", type=Path)
    args = p.parse_args()
    valid = pl.read_parquet(args.work / "valid.parquet", columns=[*COLUMNS, "md5", "pcm_len"])
    assert valid["audio_id"].n_unique() == valid.height, "audio_id collision"
    out = removed(valid, ["md5", "pcm_len"])
    save(out, args.work / "dedup" / "exact.parquet")
    print(f"exact: {out.height:,} of {valid.height:,} valid clips removed", flush=True)


if __name__ == "__main__":
    main()
