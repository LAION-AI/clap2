"""Training shards of a design study from exported shards: one caption length only, or clips thinned by domain or duration."""
import argparse
import bisect
from functools import partial
from pathlib import Path

from common import audio, tars

DOMAIN_KEEP = {"Music": 1.0, "Speech": 0.6}  # every other top-level class: OTHER_KEEP
OTHER_KEEP = 0.964
SHORT_EDGES = [7.68, 11.52, 23.36, 34.24]  # seconds of the 384 / 576 / 1168 / 1712 / 6008 audio-token buckets
SHORT_KEEP = [0.794, 1.0, 0.826, 0.531, 0.355]


def keep_prob(study, data, meta):
    """Probability that a clip stays in the shards of `study`."""
    if study == "domain":
        return DOMAIN_KEEP.get(meta["tax_l1"], OTHER_KEEP)
    if study == "short_oversampling":
        sr, _, frames = audio.info(data)
        return SHORT_KEEP[bisect.bisect_left(SHORT_EDGES, frames / sr)]
    return 1.0


def prepare(study, src, dst):
    """Copy the clips of tar src that the hash draw keeps; caption studies replace `text` by one caption."""
    with tars.TarWriter(dst) as w:
        for key, data, meta in tars.samples(src):
            if tars.audio_id(f"{meta['clip_id']}/{study}") < keep_prob(study, data, meta) * 2**63:
                if study in ("short", "long"):
                    meta = {**meta, "text": meta.get(f"{study}_caption") or meta["text"]}
                w.write(key, data, meta)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("study", choices=["short", "long", "domain", "short_oversampling"])
    ap.add_argument("src", type=Path, help="shards of 1_preprocessing/7_keep_30s")
    ap.add_argument("dst", type=Path)
    a = ap.parse_args()
    tars.run(partial(prepare, a.study), tars.todo(a.src, a.dst, ".tar"))


if __name__ == "__main__":
    main()
