"""One decode per clip: signal statistics, exact-match key and keep-order inputs, then the gate into valid.parquet."""
import argparse
import functools
import hashlib
from itertools import pairwise
from pathlib import Path

import numpy as np
import polars as pl
import soxr

from common.audio import SR, load
from common.tars import CPUS, audio_id, clip_id, run, samples, save, todo

FRAME, HOP = int(0.025 * SR), int(0.010 * SR)
SILENT_DB = -60.0
CLIPPED = 0.99
FFT = 8192
BANDS = [0, 200, 2000, 8000, SR // 2]
WINDOW = int(10.0 * SR / HOP)
PCM_SR = 16000
SIGNALS = ["duration", "rms_db", "peak_db", "dynamic_range_db", "dc_offset", "silence_frac", "audible_s",
           "leading_silence_s", "trailing_silence_s", "longest_silence_s", "clip_frac", "bandwidth_hz",
           "spectral_centroid_hz", "spectral_flatness", *(f"energy_{lo}_{hi}hz" for lo, hi in pairwise(BANDS))]
SCHEMA = {"clip_id": pl.String, "audio_id": pl.Int64, "source": pl.String, "group": pl.String, "tar": pl.String,
          "key": pl.String, **dict.fromkeys(SIGNALS, pl.Float64), "top_windows_s": pl.List(pl.Float64),
          "md5": pl.String, "pcm_len": pl.Int64, "orig_sample_rate": pl.Int64, "orig_channels": pl.Int64,
          "orig_duration": pl.Float64, "has_model_caption": pl.Boolean, "text_len": pl.Int64}
GATE = pl.col("duration").is_between(0.5, 120.0) & (pl.col("audible_s") >= 0.5)


def db(v):
    return 20 * np.log10(v + 1e-10)


def signal(x):
    """Signal statistics of 32 kHz mono audio: levels, silent frames at -60 dB, spectrum, top-energy 10 s windows."""
    c = np.concatenate(([0.0], np.cumsum(np.pad(x, (0, max(0, FRAME - x.size))).astype(np.float64) ** 2)))
    start = np.arange((c.size - 1 - FRAME) // HOP + 1) * HOP
    energy = (c[start + FRAME] - c[start]) / FRAME
    silent = db(np.sqrt(energy)) < SILENT_DB
    loud = np.flatnonzero(~silent)
    edges = np.diff(np.concatenate(([0], silent.astype(np.int8), [0])))
    runs = np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)
    rms, peak, hop = db(np.sqrt(c[-1] / x.size)), db(np.abs(x).max()), HOP / SR

    blocks = np.pad(x, (0, max(0, FFT - x.size)))
    power = (np.abs(np.fft.rfft(blocks[: blocks.size // FFT * FFT].reshape(-1, FFT), axis=1)) ** 2).mean(0)
    freq, cum = np.fft.rfftfreq(FFT, 1 / SR), np.cumsum(power)
    total = cum[-1] + 1e-20
    bands = np.add.reduceat(power, np.searchsorted(freq, BANDS[:-1])) / total

    ce = np.concatenate(([0.0], np.cumsum(energy)))
    window = ce[WINDOW:] - ce[:-WINDOW] if energy.size >= WINDOW else np.zeros(1)
    top = []
    while len(top) < 3 and window.max() >= 0:
        i = int(window.argmax())
        top.append(i * hop)
        window[max(0, i - WINDOW + 1) : i + WINDOW] = -1
    lead, trail = (loud[0], silent.size - 1 - loud[-1]) if loud.size else (silent.size, silent.size)
    bandwidth = freq[np.searchsorted(cum, 0.95 * cum[-1])]
    flatness = np.exp(np.log(power + 1e-12).mean()) / (power.mean() + 1e-12)
    values = [x.size / SR, rms, peak, peak - rms, abs(x.mean(dtype=np.float64)), silent.mean(), loud.size * hop,
              lead * hop, trail * hop, runs.max(initial=0) * hop, np.mean(np.abs(x) >= CLIPPED), bandwidth,
              (freq * power).sum() / total, flatness, *bands]
    return {**dict(zip(SIGNALS, map(float, values), strict=True)), "top_windows_s": sorted(top)}


def scan(root, src, dst):
    """Stats rows of every clip in one collected tar."""
    rel = src.relative_to(root)
    rows = []
    for key, audio, meta in samples(src):
        x = load(audio)
        pcm = (np.clip(soxr.resample(x, SR, PCM_SR, "HQ"), -1, 1) * 32767).astype(np.int16)
        cid = clip_id(rel, key)
        rows.append({"clip_id": cid, "audio_id": audio_id(cid), "source": rel.parts[0], "group": meta["group"],
                     "tar": str(rel), "key": key, **signal(x), "md5": hashlib.md5(pcm.tobytes()).hexdigest(),
                     "pcm_len": pcm.size, **{k: meta[k] for k in ("orig_sample_rate", "orig_channels", "orig_duration")},
                     "has_model_caption": bool(meta.get("captioning_model")), "text_len": len(meta["text"])})
    save(pl.DataFrame(rows, schema=SCHEMA), dst)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("work", type=Path)
    p.add_argument("--workers", type=int, default=CPUS)
    args = p.parse_args()
    root = args.work / "collected"
    run(functools.partial(scan, root), todo(root, args.work / "stats", ".parquet"), args.workers)
    save(pl.scan_parquet(args.work / "stats" / "**" / "*.parquet").filter(GATE).collect(), args.work / "valid.parquet")


if __name__ == "__main__":
    main()
