"""YouTube bulk crawl: full audio of its Creative Commons videos in laion-audio-xl-links, as IN/<name>/ tars.

The video ids are streamed from Hugging Face (gated: fill in the form on the dataset page, then `hf auth login`).

Recordings are kept whole at their original rate and channels; 1_preprocessing cuts them at silences. This is the
build-from-scratch route for these videos; ../web_youtube.py fetches the released clips of the same videos (source
`YouTube (bulk)`), so use one of the two for them.
"""
import argparse
import sys
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch  # noqa: E402
from common.audio import flac  # noqa: E402
from common.tars import TarWriter, run  # noqa: E402


def download(ids, out, sleep):
    """Fetch the full audio of the videos `ids` into the tar `out`, keyed by video id."""
    load = partial(fetch.youtube, sleep=sleep, licence="Creative Commons")
    written, failed = 0, []
    with TarWriter(out) as w:
        for vid, ((x, rate), info) in fetch.fetched(load, ids, 1, failed):
            meta = {"text": "", "group": "youtube", "__url__": info["webpage_url"], "youtube_id": vid,
                    "title": info["title"], "licence": info["license"]}
            w.write(vid, flac(x, rate), meta)
            written += 1
        fetch.finish(out, written, failed)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("root", help="collection root IN; tars go to IN/<name>/<k>.tar")
    p.add_argument("--source", default="YouTube (bulk)", help="value of the `source_dataset` column of the rows to take")
    p.add_argument("--name", default="YouTube", help="source folder under IN")
    p.add_argument("--per-tar", type=int, default=200, help="videos per tar")
    p.add_argument("--sleep", type=float, default=5, help="seconds yt-dlp waits before each download")
    p.add_argument("--workers", type=int, default=2, help="parallel downloads")
    a = p.parse_args()
    ds = fetch.rows(columns=["youtube_id"], filters=[("source_dataset", "==", a.source)])
    ids = sorted({r["youtube_id"] for r in ds})
    jobs = [(ids[i:i + a.per_tar], Path(a.root, a.name, f"{i // a.per_tar:06d}.tar"))
            for i in range(0, len(ids), a.per_tar)]
    run(partial(download, sleep=a.sleep), [(j, o) for j, o in jobs if not o.exists()], a.workers)


if __name__ == "__main__":
    main()
