"""Download helpers of 0_download: HTTP with limits, yt-dlp, threaded fetching and decoding into WebDataset tars."""
import itertools
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

import av
import polars as pl
import requests
import soxr
import yt_dlp

from common.audio import SR, decode, flac
from common.tars import TarWriter, run, save

HEADERS = {"User-Agent": "clap2-downloader (+https://github.com/LAION-AI/clap2)"}
KINDS = {"youtube": ("youtube_id", pl.col("youtube_id").is_not_null()),
         "links": ("url", pl.col("youtube_id").is_null())}


class Skip(Exception):
    """A file rejected by a size, time or licence limit, without samples or with more than 8 channels."""


ERRORS = (Skip, OSError, ValueError, av.FFmpegError, yt_dlp.utils.DownloadError)


def _open(url, connect):
    try:
        return requests.get(url, stream=True, timeout=connect, headers=HEADERS)
    except (requests.ConnectionError, requests.Timeout):
        time.sleep(2)
        return requests.get(url, stream=True, timeout=connect, headers=HEADERS)


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


def _audio(data, max_seconds=None):
    x, rate = decode(data, max_seconds)
    if not len(x) or x.shape[1] > 8:
        raise Skip(f"{x.shape} samples x channels, FLAC needs 1-8 channels")
    return x, rate


def mono(x, rate):
    """Mean downmix resampled to 32 kHz."""
    return soxr.resample(x.mean(1), rate, SR, "HQ")


def url_audio(url, max_mb=50, max_time=30, connect=5, max_seconds=None):
    """Decoded audio of get(url)."""
    return _audio(get(url, max_mb, max_time, connect), max_seconds)


def youtube(vid, sleep=0.0, licence=""):
    """(decoded audio, yt-dlp info) of a YouTube video; Skip if its licence does not contain `licence`."""
    opts = {"format": "bestaudio[ext=m4a]/bestaudio", "quiet": True, "no_warnings": True, "noprogress": True,
            "sleep_interval": sleep}
    with tempfile.TemporaryDirectory() as tmp, yt_dlp.YoutubeDL({**opts, "paths": {"home": tmp}}) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
        if licence not in (info.get("license") or ""):
            raise Skip(f"licence {info.get('license')}")
        info = ydl.process_ie_result(info, download=True)
        return _audio(info["requested_downloads"][0]["filepath"]), info


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
    """Save the failures of tar `out` next to it as <tar>.failed.parquet and report."""
    df = pl.DataFrame(failed, schema={"id": pl.String, "error": pl.String}, orient="row")
    save(df, Path(out).with_suffix(".failed.parquet"))
    print(f"{out}: {written} written, {len(failed)} failed", flush=True)


def links(src, out, kind, load, per_tar, workers, threads):
    """Fetch the `kind` rows of the laion-audio-xl-links parquet files in src into out/<kind>/<parquet>/<k>.tar, about
    per_tar clips each, every media id fetched once per tar."""
    media, rows = KINDS[kind]
    jobs = []
    for f in sorted(Path(src).rglob("*.parquet")):
        q = pl.scan_parquet(f)
        new = pl.col(media).ne_missing(pl.col(media).shift())
        runs = q.with_row_index("i").filter(rows).with_row_index("j").filter(new)
        lo = runs.group_by(pl.col("j") // per_tar, maintain_order=True).agg(pl.col("i").first()).collect()
        lo = lo["i"].to_list()
        hi = lo[1:] + [q.select(pl.len()).collect().item()]
        jobs += [((f, a, b - a), Path(out, kind, f.relative_to(src).with_suffix(""), f"{t:06d}.tar"))
                 for t, (a, b) in enumerate(zip(lo, hi))]
    run(partial(_web_tar, kind=kind, load=load, threads=threads), [(j, o) for j, o in jobs if not o.exists()], workers)


def _web_tar(job, out, kind, load, threads):
    f, offset, n = job
    media, rows = KINDS[kind]
    df = pl.scan_parquet(f).slice(offset, n).filter(rows).collect()
    assert "group" in df.columns, f"{f} has no group column"
    groups = {m: g.to_dicts() for (m,), g in df.group_by(media, maintain_order=True)}
    written, failed = 0, []
    with TarWriter(out) as w:
        for m, (x, rate) in fetched(load, list(groups), threads, failed):
            for r in groups[m]:
                assert "." not in r["__key__"], r["__key__"]
                a, b = round(r["start"] * rate), round(r["end"] * rate)
                assert a < b, r["__key__"]
                if len(x[a:b]) < 0.95 * (b - a):
                    failed.append((m, f"{r['__key__']}: audio is {len(x) / rate:.1f} s, clip ends at {r['end']} s"))
                    continue
                w.write(r["__key__"], flac(mono(x[a:b], rate)), {**r, "__url__": r["url"]})
                written += 1
        finish(out, written, failed)
