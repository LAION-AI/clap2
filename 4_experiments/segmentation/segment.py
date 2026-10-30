"""Cut long recordings into clips with random crops, quality-filtered random crops or silence cuts; then set captions."""
import argparse
import itertools
import tarfile
from functools import partial
from pathlib import Path

import numpy as np
import polars as pl

from common import audio, cut, tars

SCAN_SR = 8000


def quality_ok(x, sr):
    """At most half of the 25 ms frames below -60 dB, mean frame level >= -40 dB, at most 5 % clipped samples."""
    frames = np.lib.stride_tricks.sliding_window_view(x, int(sr * 0.025))[:: int(sr * 0.010)]
    db = 20 * np.log10(np.sqrt(np.mean(frames**2, 1)) + 1e-10)
    return np.mean(db < -60) <= 0.5 and np.mean(db) >= -40 and np.mean(np.abs(x) >= 0.99) <= 0.05


def crops(method, x, n, rng):
    """n crops of N(30, 10) s clipped to [5, 120] s at uniform positions; `quality` keeps the passing ones of the
    same candidate stream."""
    total = x.size / audio.SR
    length = np.minimum(np.clip(rng.normal(30, 10, 4 * n), 5, 120), total)
    start = rng.random(4 * n) * (total - length)
    cand = list(zip(start, start + length))
    ok = (method == "random" or quality_ok(x[int(a * audio.SR) : int(b * audio.SR)], audio.SR) for a, b in cand)
    return list(itertools.islice(itertools.compress(cand, ok), n))


def segment(method, keep, root, src, dst):
    """Clips of every recording of tar src, as many as it has silence segments, each kept by a hash draw."""
    rel = src.relative_to(root)
    with tars.TarWriter(dst) as w:
        for key, data, meta in tars.samples(src):
            sr, ch, n = audio.info(data)
            meta |= {"orig_sample_rate": sr, "orig_channels": ch, "orig_duration": n / sr}
            silence = cut.segments(audio.load(data, SCAN_SR), SCAN_SR)
            x = audio.load(data)
            rng = np.random.default_rng(tars.audio_id(tars.clip_id(rel, key)))
            for k, (a, b) in enumerate(silence if method == "silence" else crops(method, x, len(silence), rng)):
                if tars.audio_id(tars.clip_id(rel, f"{key}_{k}")) < keep * 2**63:
                    clip = x[int(a * audio.SR) : int(b * audio.SR)]
                    w.write(f"{key}_{k}", audio.flac(clip), {**meta, "parent": key, "start": a, "end": b})


def with_text(work, src, dst):
    """Copy the captioned clips of a tar with `text` set to their short or long caption, fixed per clip by its hash."""
    rel = src.relative_to(work / "collected")
    caps = pl.read_parquet(work / "captions" / rel.with_suffix(".parquet"))
    caps = dict(zip(caps["clip_id"], zip(caps["short_caption"], caps["long_caption"])))
    with tars.TarWriter(dst) as w:
        for key, data, meta in tars.samples(src):
            if (cid := tars.clip_id(rel, key)) in caps:
                w.write(key, data, {**meta, "text": caps[cid][tars.audio_id(cid) % 2]})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="step", required=True)
    c = sub.add_parser("cut", help="IN/<source>/**.tar of recordings -> WORK/collected + WORK/clips.parquet")
    c.add_argument("src", type=Path)
    c.add_argument("work", type=Path)
    c.add_argument("--method", choices=["random", "quality", "silence"], required=True)
    c.add_argument("--keep", type=float, default=1.0, help="share of the clips kept, by a hash draw")
    t = sub.add_parser("text", help="WORK/collected + WORK/captions -> DATA/000000.tar ... for 2_training/train.sh")
    t.add_argument("work", type=Path)
    t.add_argument("data", type=Path)
    a = ap.parse_args()
    if a.step == "cut":
        out = a.work / "collected"
        tars.run(partial(segment, a.method, a.keep, a.src), tars.todo(a.src, out, ".tar"))
        rows = [(str(p.relative_to(out)), n.removesuffix(".flac")) for p in sorted(out.rglob("*.tar"))
                for n in tarfile.open(p).getnames() if n.endswith(".flac")]
        pl.DataFrame(rows, schema=["tar", "key"], orient="row").write_parquet(a.work / "clips.parquet")
    else:
        src = sorted((a.work / "collected").rglob("*.tar"))
        pairs = [(s, a.data / f"{i:06d}.tar") for i, s in enumerate(src)]
        tars.run(partial(with_text, a.work), [(s, d) for s, d in pairs if not d.exists()])


if __name__ == "__main__":
    main()
