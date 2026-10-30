"""Download the YouTube rows of laion-audio-xl-links with yt-dlp, each video once, into tars of 32 kHz mono FLAC clips.

Get the rows first (gated: accept the terms, log in):
    hf download laion/laion-audio-xl-links --repo-type dataset --local-dir links

Finished tars are skipped on resume; delete a tar and its .failed.parquet to retry it.
"""
import argparse
from functools import partial

import fetch


def load(vid, sleep):
    """Decoded audio of a YouTube video."""
    return fetch.youtube(vid, sleep)[0]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("links", help="folder with the laion-audio-xl-links parquet files")
    p.add_argument("out", help="tars go to out/youtube/<parquet>/<k>.tar")
    p.add_argument("--sleep", type=float, default=5, help="seconds yt-dlp waits before each download")
    p.add_argument("--per-tar", type=int, default=4096)
    p.add_argument("--workers", type=int, default=2, help="parallel downloads")
    a = p.parse_args()
    fetch.links(a.links, a.out, "youtube", partial(load, sleep=a.sleep), a.per_tar, a.workers, threads=1)


if __name__ == "__main__":
    main()
