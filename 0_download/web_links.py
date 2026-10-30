"""Download the non-YouTube rows of laion-audio-xl-links (direct audio links) into tars of 32 kHz mono FLAC clips.

Get the rows first (gated: accept the terms, log in):
    hf download laion/laion-audio-xl-links --repo-type dataset --local-dir links

Finished tars are skipped on resume; delete a tar and its .failed.parquet to retry it.
"""
import argparse
from functools import partial

import fetch
from common.tars import CPUS


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("links", help="folder with the laion-audio-xl-links parquet files")
    p.add_argument("out", help="tars go to out/links/<parquet>/<k>.tar")
    p.add_argument("--max-mb", type=float, default=1000, help="skip larger files")
    p.add_argument("--max-time", type=float, default=600, help="skip downloads slower than this many seconds")
    p.add_argument("--connect", type=float, default=10, help="seconds to wait for a reply (one retry)")
    p.add_argument("--per-tar", type=int, default=4096)
    p.add_argument("--workers", type=int, default=CPUS)
    p.add_argument("--threads", type=int, default=8, help="downloads in flight per worker")
    a = p.parse_args()
    load = partial(fetch.url_audio, max_mb=a.max_mb, max_time=a.max_time, connect=a.connect)
    fetch.links(a.links, a.out, "links", load, a.per_tar, a.workers, a.threads)


if __name__ == "__main__":
    main()
