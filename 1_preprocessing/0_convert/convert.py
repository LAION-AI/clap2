"""Convert every clip to 32 kHz 16-bit mono FLAC and cut recordings longer than 120 s at silences (scan at 8 kHz)."""
import argparse
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

from common.audio import SR, flac, info, load
from common.cut import segments
from common.tars import CPUS, TarWriter, run, samples, todo

SCAN_SR = 8000
MAX_SECONDS = 120


def decode(audio):
    """(32 kHz mono audio, original sample rate, channels, frames), or None if the clip is empty or cannot be decoded."""
    try:
        sr, channels, frames = info(audio)
        x = load(audio) if frames else None
    except (sf.LibsndfileError, AssertionError):  # unreadable, or a header with frames but no samples
        return None
    return (x, sr, channels, frames) if x is not None and np.isfinite(x).all() else None


def pieces(key, x):
    """(key, audio, extra json) of the clip, or of each silence-cut segment when it is longer than MAX_SECONDS."""
    if x.size <= MAX_SECONDS * SR:
        return [(key, x, {})]
    cuts = segments(soxr.resample(x, SR, SCAN_SR, "HQ"), SCAN_SR)
    return [(f"{key}_{k}", x[round(a * SR) : round(b * SR)], {"parent": key, "start": a, "end": b})
            for k, (a, b) in enumerate(cuts)]


def convert(src, dst):
    """Convert one tar; undecodable clips are left out."""
    skipped = 0
    with TarWriter(dst) as out:
        for key, audio, meta in samples(src):
            decoded = decode(audio)
            skipped += decoded is None
            if decoded is None:
                continue
            x, sr, channels, frames = decoded
            meta = {**meta, "orig_sample_rate": sr, "orig_channels": channels, "orig_duration": frames / sr}
            for k, y, extra in pieces(key, x):
                out.write(k, flac(y), {**meta, **extra})
    if skipped:
        print(f"{src}: {skipped} undecodable clips left out", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, help="folder of <source>/**/*.tar")
    p.add_argument("work", type=Path)
    p.add_argument("--workers", type=int, default=CPUS)
    args = p.parse_args()
    run(convert, todo(args.input, args.work / "collected", ".tar"), args.workers)


if __name__ == "__main__":
    main()
