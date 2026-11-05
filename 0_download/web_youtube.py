"""Download the YouTube rows of laion-audio-xl-links with yt-dlp, each video once, into tars of 32 kHz mono FLAC clips.

The rows are streamed from Hugging Face with load_dataset. The repository is gated: fill in the form on
https://huggingface.co/datasets/laion/laion-audio-xl-links once, then log in with `hf auth login`.

Finished tars, and shards marked in IN/.fetched/, are skipped on resume; to retry a tar, delete it, its
.failed.parquet and its shard's marker.
"""
import argparse
from functools import partial

import fetch


def load(vid, sleep, until=None):
    """Decoded audio of a YouTube video, its first `until` seconds if given."""
    return fetch.youtube(vid, sleep, until=until)[0]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out", help="collection root IN; tars go to IN/<source_dataset>/youtube/<split>/<shard>/<k>.tar")
    p.add_argument("--sleep", type=float, default=5, help="seconds yt-dlp waits before each download")
    p.add_argument("--split", default="train", choices=["train", "validation", "test"])
    p.add_argument("--per-tar", type=int, default=4096, help="media items per tar")
    p.add_argument("--workers", type=int, default=2, help="parallel downloads")
    a = p.parse_args()
    fetch.links(a.out, "youtube", partial(load, sleep=a.sleep), a.per_tar, a.workers, threads=1, split=a.split)


if __name__ == "__main__":
    main()
