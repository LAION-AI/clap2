"""Download the non-YouTube rows of laion-audio-xl-links (direct audio links) into tars of 32 kHz mono FLAC clips.

The rows are streamed from Hugging Face with load_dataset. The repository is gated: fill in the form on
https://huggingface.co/datasets/laion/laion-audio-xl-links once, then log in with `hf auth login`.

Finished tars, and shards marked in IN/.fetched/, are skipped on resume; to retry a tar, delete it, its
.failed.parquet and its shard's marker.
"""
import argparse
from functools import partial

import fetch
from common.tars import CPUS


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out", help="collection root IN; tars go to IN/<source_dataset>/links/<split>/<shard>/<k>.tar")
    p.add_argument("--max-mb", type=float, default=1000, help="skip larger files")
    p.add_argument("--max-time", type=float, default=600, help="skip downloads slower than this many seconds")
    p.add_argument("--connect", type=float, default=10, help="seconds to wait for a reply (one retry)")
    p.add_argument("--split", default="train", choices=["train", "validation", "test"])
    p.add_argument("--per-tar", type=int, default=4096, help="media items per tar")
    p.add_argument("--workers", type=int, default=CPUS)
    p.add_argument("--threads", type=int, default=8, help="downloads in flight per worker")
    a = p.parse_args()
    load = partial(fetch.url_audio, max_mb=a.max_mb, max_time=a.max_time, connect=a.connect)
    fetch.links(a.out, "links", load, a.per_tar, a.workers, a.threads, a.split)


if __name__ == "__main__":
    main()
