"""Common Crawl source: audio links with page context from WARC files, URL dedup, download into IN/CommonCrawl/ tars.

WARC files are listed in https://data.commoncrawl.org/crawl-data/<crawl>/warc.paths.gz (prefix each line with
https://data.commoncrawl.org/); `extract` scans a local folder of them, `download` dedups the links and fetches them.
"""
import argparse
import html as htmllib
import os
import re
import sys
from functools import partial
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import numpy as np
import polars as pl
from warcio.archiveiterator import ArchiveIterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch  # noqa: E402
from common.audio import flac  # noqa: E402
from common.tars import CPUS, TarWriter, run, save  # noqa: E402

FORMATS = {"wav": 100, "wave": 100, "x-wav": 100, "flac": 90, "aiff": 85, "ogg": 70, "opus": 70, "aac": 60, "mp4": 55,
           "m4a": 55, "mp3": 50, "mpeg": 50, "webm": 45}
EXTENSIONS = {"wav", "wave", "flac", "aiff", "aif", "ogg", "opus", "oga", "aac", "mp3", "mp4", "m4a", "wma", "webm",
              "amr", "mid", "midi", "wv", "ape", "mka", "spx", "caf", "ac3", "dts", "pcm", "au", "snd", "ra", "ram",
              "3gp"}
SCHEMA = {"url": pl.String, "page_url": pl.String, "source_type": pl.String, "before": pl.List(pl.String),
          "after": pl.List(pl.String), "warc": pl.String}
PREFILTER = re.compile(rb"<audio|\.(?:mp3|wav|ogg|flac|aac|m4a|opus|wma|webm|aiff)", re.I)
AUDIO = re.compile(rb"<audio\b([^>]*)>(.*?)</audio>", re.I | re.S)
SOURCE = re.compile(rb"<source\b([^>]*)>", re.I)
ANCHOR = re.compile(rb"<a\b([^>]*)>", re.I)
ATTR = re.compile(rb"""([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
HIDDEN = re.compile(rb"<(script|style|noscript|svg|template|head)\b|<!--", re.I)
BLOCK = re.compile(rb"</?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|thead|tbody|section|article|header|footer|nav|"
                   rb"aside|main|figure|figcaption|blockquote|pre|hr|dd|dt|dl|form|fieldset|legend|option|select|label|"
                   rb"button|title|address|summary|details|audio|video|iframe)(?![\w-])[^>\0]*>", re.I)
TAG = re.compile(rb"</?[a-zA-Z!][^>\0]*>")
SENTENCE = re.compile(r"(?<=[.!?…。！？])\s+(?=\S)")
CONTROL = bytes.maketrans(b"\0\1", b"  ")


def ext(url):
    """Lower-case file extension of a URL's path."""
    return os.path.splitext(urlsplit(url).path)[1][1:].lower()


def attrs(tag):
    """Attribute name -> unescaped value of an HTML tag's attribute bytes."""
    return {m[1].decode().lower(): htmllib.unescape((m[2] or m[3] or m[4] or b"").decode(errors="replace"))
            for m in ATTR.finditer(tag)}


def absolute(page, url):
    """Absolute http(s) URL of an audio file, None for anything else."""
    try:
        u = urljoin(page, url.strip()) if url.strip() else ""
        return u if urlsplit(u).scheme in ("http", "https") and ext(u) in EXTENSIONS else None
    except ValueError:
        return None


def score(url, mime):
    """Format preference of an audio source: by MIME type, else by extension."""
    return next((v for k, v in FORMATS.items() if k in mime.lower()), FORMATS.get(ext(url), 0))


def page_links(page, html):
    """(url, source type, tag offset) of every audio element (best source by format) and audio-file link of a page."""
    found = []
    for m in AUDIO.finditer(html):
        tags = [attrs(m[1])] + [attrs(s) for s in SOURCE.findall(m[2])]
        urls = [(u, t.get("type", "")) for t in tags if (u := absolute(page, t.get("src", "")))]
        if urls:
            found.append((max(urls, key=lambda c: score(*c))[0], "audio", m.start()))
    hrefs = ((absolute(page, attrs(m[1]).get("href", "")), m.start()) for m in ANCHOR.finditer(html))
    return found + [(u, "a", o) for u, o in hrefs if u]


def visible(html):
    """html with scripts, styles, head and comments blanked, byte offsets unchanged."""
    out, low, pos, dead = bytearray(html), html.lower(), 0, set()
    while m := HIDDEN.search(html, pos):
        close = b"</" + m[1].lower() if m[1] else b"-->"
        end = -1 if close in dead else low.find(close, m.end())
        if end == -1:
            dead.add(close)
            pos = m.end()
            continue
        end = low.find(b">", end) + 1 or len(html)
        out[m.start():end] = b" " * (end - m.start())
        pos = end
    return bytes(out)


def sentences(piece):
    """Sentences (>= 2 characters, cut at 500) of the text blocks of tag-stripped HTML."""
    out = []
    for block in piece.split(b"\1"):
        text = " ".join(htmllib.unescape(block.decode("utf-8", "replace")).split())
        out += [s[:500] for s in SENTENCE.split(text) if len(s) >= 2]
    return out


def context(html, offsets, n=5):
    """{offset: (up to n sentences of visible text before it, up to n from it on)} for sorted tag offsets of a page."""
    page = visible(html).translate(CONTROL)
    cuts = [0, *offsets, len(page)]
    blocks = TAG.sub(b" ", BLOCK.sub(b"\1", b"\0".join(page[a:b] for a, b in zip(cuts, cuts[1:])))).split(b"\1")
    whole = [sentences(b.replace(b"\0", b"")) for b in blocks]
    flat, first = [s for w in whole for s in w], np.cumsum([0] + [len(w) for w in whole])
    out, at = {}, iter(offsets)
    for i, b in enumerate(blocks):
        parts = b.split(b"\0")
        for k in range(1, len(parts)):
            left, right = sentences(b"".join(parts[:k])), sentences(b"".join(parts[k:]))
            a, b = first[i], first[i + 1]
            out[next(at)] = ((flat[max(0, a - n):a] + left)[-n:], (right + flat[b:b + n])[:n])
    return out


def extract(warc, out):
    """Audio links of the HTML responses of one WARC file, with page URL and context, as a parquet table."""
    rows = []
    with open(warc, "rb") as f:
        for rec in ArchiveIterator(f):
            if rec.rec_type != "response" or "html" not in rec.http_headers.get_header("Content-Type", ""):
                continue
            page, html = rec.rec_headers.get_header("WARC-Target-URI"), rec.content_stream().read()
            found = page_links(page, html) if PREFILTER.search(html) else []
            ctx = context(html, sorted({o for *_, o in found})) if found else {}
            rows += [(u, page, t, *ctx[o], warc.name) for u, t, o in found]
    save(pl.DataFrame(rows, schema=SCHEMA, orient="row"), out)
    print(f"{warc}: {len(rows)} links", flush=True)


def extract_all(a):
    """extract over every *.warc.gz under a.warcs."""
    jobs = [(w, Path(a.links, w.relative_to(a.warcs).with_suffix("").with_suffix(".parquet")))
            for w in sorted(Path(a.warcs).rglob("*.warc.gz"))]
    run(extract, [(w, o) for w, o in jobs if not o.exists()], a.workers)


def download_all(a):
    """Dedup the links of a.links by URL (first occurrence kept) into urls.parquet, then download it tar by tar."""
    out = Path(a.root, "CommonCrawl")
    urls = out / "urls.parquet"
    if not urls.exists():
        q = pl.scan_parquet(sorted(Path(a.links).rglob("*.parquet"))).unique("url", keep="first", maintain_order=True)
        save(q.sort(pl.col("url").hash(seed=0)).collect(), urls)
    n = pl.scan_parquet(urls).select(pl.len()).collect().item()
    jobs = [((urls, k), out / f"{k // a.per_tar:06d}.tar") for k in range(0, n, a.per_tar)]
    run(partial(download, per_tar=a.per_tar, threads=a.threads), [(j, o) for j, o in jobs if not o.exists()], a.workers)


def download(job, out, per_tar, threads):
    """Download per_tar links from row `offset` of urls.parquet into the tar `out`, skipping files above 50 MB, slower
    than 30 s, not replying within 5 s twice or reporting more than 120 s."""
    urls, offset = job
    rows = pl.scan_parquet(urls).slice(offset, per_tar).collect().to_dicts()
    rows = {r["url"]: (offset + i, r) for i, r in enumerate(rows)}
    load = partial(fetch.url_audio, max_seconds=120)
    written, failed = 0, []
    with TarWriter(out) as w:
        for u, (x, rate) in fetch.fetched(load, list(rows), threads, failed):
            i, r = rows[u]
            meta = {"text": "", "group": "commoncrawl", "__url__": u,
                    **{k: r[k] for k in ("page_url", "source_type", "warc")},
                    "surrounding_text": {"before": r["before"], "after": r["after"]}}
            w.write(f"{i:09d}", flac(x, rate), meta)
            written += 1
        fetch.finish(out, written, failed)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workers", type=int, default=CPUS)
    sub = p.add_subparsers(required=True)
    e = sub.add_parser("extract", help="folder of *.warc.gz -> one links parquet per WARC")
    e.add_argument("warcs")
    e.add_argument("links")
    e.set_defaults(fn=extract_all)
    d = sub.add_parser("download", help="links parquets -> root/CommonCrawl/<k>.tar")
    d.add_argument("links")
    d.add_argument("root", help="collection root IN")
    d.add_argument("--per-tar", type=int, default=4096)
    d.add_argument("--threads", type=int, default=8, help="downloads in flight per worker")
    d.set_defaults(fn=download_all)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
