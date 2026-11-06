"""Download helpers of 0_download: HTTP with limits, yt-dlp, threaded fetching and decoding into WebDataset tars."""
import itertools
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

import av
import polars as pl
import pyarrow.compute as pc
import requests
import soxr
import yt_dlp
from datasets import load_dataset

from common.audio import SR, decode, flac
from common.tars import TarWriter, run, save

GROUPS = dict(pl.read_csv(Path(__file__).with_name("raw") / "sources.csv", columns=["source", "group"]).iter_rows())

LINKS = ("laion/laion-audio-xl", "links")  # repository and config
KINDS = {"youtube": ("youtube_id", pc.field("youtube_id").is_valid()),  # kind: (column passed to load, row filter)
         "links": ("url", pc.field("youtube_id").is_null())}


class Skip(Exception):
    """A file rejected by a size, time or licence limit, without samples or with more than 8 channels."""


ERRORS = (Skip, OSError, ValueError, av.FFmpegError, yt_dlp.utils.DownloadError)


def _open(url, connect):
    try:
        return requests.get(url, stream=True, timeout=connect)
    except (requests.ConnectionError, requests.Timeout):
        time.sleep(2)
        return requests.get(url, stream=True, timeout=connect)


def get(url, max_mb=50, max_time=30, connect=5):
    """Body of url; Skip above max_mb or max_time seconds; no reply within `connect` s is retried once after 2 s."""
    t0, limit = time.monotonic(), max_mb * 2**20
    with _open(url, connect) as r:
        r.raise_for_status()
        if int(r.headers.get("Content-Length") or 0) > limit:
            raise Skip(f"larger than {max_mb} MB")
        data = bytearray()
        for chunk in r.iter_content(1 << 16):
            data += chunk
            if len(data) > limit:
                raise Skip(f"larger than {max_mb} MB")
            if time.monotonic() - t0 > max_time:
                raise Skip(f"download slower than {max_time} s")
    return bytes(data)


def _audio(data, max_seconds=None, until=None):
    x, rate = decode(data, max_seconds, until)
    if not len(x) or x.shape[1] > 8:
        raise Skip(f"{x.shape} samples x channels, FLAC needs 1-8 channels")
    return x, rate


def mono(x, rate):
    """Mean downmix resampled to 32 kHz."""
    return soxr.resample(x.mean(1), rate, SR, "HQ")


def url_audio(url, max_mb=50, max_time=30, connect=5, max_seconds=None, until=None):
    """Decoded audio of get(url), its first `until` seconds if given."""
    return _audio(get(url, max_mb, max_time, connect), max_seconds, until)


def youtube(vid, sleep=0.0, licence="", until=None):
    """(decoded audio, its first `until` seconds if given; yt-dlp info) of a YouTube video; Skip if its licence does not
    contain `licence`."""
    opts = {"format": "bestaudio[ext=m4a]/bestaudio", "quiet": True, "no_warnings": True, "noprogress": True,
            "sleep_interval": sleep}
    with tempfile.TemporaryDirectory() as tmp, yt_dlp.YoutubeDL({**opts, "paths": {"home": tmp}}) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
        if licence not in (info.get("license") or ""):
            raise Skip(f"licence {info.get('license')}")
        info = ydl.process_ie_result(info, download=True)
        return _audio(info["requested_downloads"][0]["filepath"], until=until), info


def fetched(load, ids, threads, failed):
    """Yield (id, load(id)) in order with `threads` loads in flight; failed loads go to `failed` as (id, error)."""
    with ThreadPoolExecutor(threads) as ex:
        for chunk in itertools.batched(ids, 4 * threads):  # bounds the decoded audio held behind a stalled download
            for i, x in zip(chunk, ex.map(partial(_try, load), chunk)):
                if isinstance(x, Exception):
                    failed.append((i, repr(x)))
                else:
                    yield i, x


def _try(load, i):
    try:
        return load(i)
    except ERRORS as e:
        return e


def finish(out, written, failed):
    """Save the failures (id, error) of tar `out` next to it as <tar>.failed.parquet and report."""
    df = pl.DataFrame(failed, schema={"id": pl.String, "error": pl.String}, orient="row")
    save(df, Path(out).with_suffix(".failed.parquet"))
    print(f"{out}: {written} written, {len(failed)} failed", flush=True)


def rows(split="train", **kw):
    """The links config of laion/laion-audio-xl streamed from Hugging Face; gated: accept the terms on the dataset page,
    then `hf auth login`."""
    return load_dataset(*LINKS, split=split, streaming=True, **kw)


def links(out, kind, load, per_tar, workers, threads, split="train"):
    """Fetch the `kind` rows of the links config into tars out/<source_dataset>/<kind>/<split>/<shard>/<k>.tar, one
    shard per parquet file, chunk k = per_tar media items: every media item is fetched once and all its clips are cut
    from it. The source folder and the `group` of sources.csv (default web) are what 1_preprocessing reads."""
    done = Path(out, ".fetched", kind, split)
    run(partial(_shard, out=Path(out), kind=kind, load=load, per_tar=per_tar, threads=threads, split=split),
        [(k, done / f"{k:05d}") for k in range(rows(split).num_shards) if not (done / f"{k:05d}").exists()], workers)


def _shard(k, done, out, kind, load, per_tar, threads, split):
    def stream(**kw):
        ds = rows(split, filters=KINDS[kind][1], **kw)
        return ds.shard(ds.num_shards, k)  # one parquet file, its rows sorted by media_id and start

    pages = _releases(stream(columns=["media_id", "url"])) if kind == "links" else set()
    items = ((m, list(g)) for m, g in itertools.groupby(stream(), key=lambda r: r["media_id"]))
    for t, chunk in enumerate(itertools.batched(items, per_tar)):
        by_source = {}
        for m, g in chunk:
            by_source.setdefault(g[0]["source_dataset"], {})[m] = g
        for source, groups in by_source.items():
            if not (tar := out / source / kind / split / f"{k:05d}" / f"{t:06d}.tar").exists():
                _web_tar(groups, tar, KINDS[kind][0], load, threads, pages)
    done.parent.mkdir(parents=True, exist_ok=True)
    done.touch()


def _releases(rs):
    """Urls shared by several media items: landing pages of releases distributed as a whole (Common Voice, TED-LIUM 3,
    ...), whose files have to be fetched from the release itself."""
    first, pages = {}, set()
    for r in rs:
        if first.setdefault(r["url"], r["media_id"]) != r["media_id"]:
            pages.add(r["url"])
    return pages


def _web_tar(groups, out, arg, load, threads, pages):
    """Clips of the media items `groups` (media_id -> rows) into tar `out`; items whose url is in `pages` are skipped.
    Each item is decoded up to its last clip; failures are saved by media_id."""
    failed = [(m, "url is the page of a whole release") for m, g in groups.items() if g[0]["url"] in pages]
    media = {g[0][arg]: m for m, g in groups.items() if g[0]["url"] not in pages}
    until = {i: max(r["end"] or 0 for r in groups[m]) + 1 for i, m in media.items()}
    written, bad = 0, []
    with TarWriter(out) as w:
        for i, (x, rate) in fetched(lambda i: load(i, until=until[i]), list(media), threads, bad):
            for r in groups[media[i]]:
                key, a, b = r["__key__"], round((r["start"] or 0) * rate), round((r["end"] or 0) * rate)
                if "." in key or a >= b or len(x[a:b]) < 0.95 * (b - a):
                    failed.append((media[i], f"{key}: clip {r['start']}-{r['end']} s, audio is {len(x) / rate:.1f} s"))
                    continue
                meta = {**r, "text": r["text"] or "", "group": GROUPS.get(r["source_dataset"], "web"), "__url__": r["url"]}
                w.write(key, flac(mono(x[a:b], rate)), meta)
                written += 1
        finish(out, written, failed + [(media.get(i, i), e) for i, e in bad])
