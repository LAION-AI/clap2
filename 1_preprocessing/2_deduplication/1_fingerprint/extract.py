"""Olaf fingerprints (hash, t1) of every collected clip at 16 kHz, computed by upstream Olaf through its CFFI module.

Olaf (AGPL-3.0, https://github.com/JorenSix/Olaf) is built separately; OLAF points at the build:
    git clone https://github.com/JorenSix/Olaf && cd Olaf && git checkout f6f7cbefb50485953f71100c9d08c625f01780ba
    sed -i 's/-std=c11/-std=gnu11/' Makefile && make lib
    CFLAGS=-Wno-incompatible-pointer-types python python-wrapper/setup.py && export OLAF=$PWD
"""
import argparse
import functools
from pathlib import Path

import numpy as np
import polars as pl
from olaf_cffi import ffi, lib

from common.audio import load
from common.tars import CPUS, audio_id, clip_id, run, samples, save, todo

CFG = lib.olaf_config_default()
BLOCK, STEP = CFG.audioBlockSize, CFG.audioStepSize


def fingerprints(x):
    """(hash, t1) of every fingerprint of mono audio at CFG.audioSampleRate, as upstream's EXTRACT_FINGERPRINTS."""
    fft, ep, fp = lib.olaf_fft_new(CFG), lib.olaf_ep_extractor_new(CFG), lib.olaf_fp_extractor_new(CFG)
    x = np.pad(x, (0, max(0, BLOCK - x.size)))
    blocks = np.ascontiguousarray(np.lib.stride_tricks.sliding_window_view(x, BLOCK)[::STEP])
    data = ffi.cast("float *", ffi.from_buffer(blocks))
    out, eps = [], None

    def take(fps):
        for i in range(fps.fingerprintIndex):
            out.append((lib.olaf_fp_extractor_hash(fps.fingerprints[i]), fps.fingerprints[i].timeIndex1))
        fps.fingerprintIndex = 0

    for i in range(len(blocks)):
        lib.olaf_fft_forward(fft, data + i * BLOCK)
        eps = lib.olaf_ep_extractor_extract(ep, data + i * BLOCK, i)
        if eps.eventPointIndex > CFG.eventPointThreshold:
            take(lib.olaf_fp_extractor_extract(fp, eps, i))
    if eps.eventPointIndex > 0:
        take(lib.olaf_fp_extractor_extract(fp, eps, len(blocks)))
    lib.olaf_fp_extractor_destroy(fp)
    lib.olaf_ep_extractor_destroy(ep)
    lib.olaf_fft_destroy(fft)
    return out


def extract(root, src, dst):
    """Fingerprint rows (audio_id, hash, t1) of every clip in one collected tar."""
    rel = src.relative_to(root)
    ids, prints = [], []
    for key, audio, _ in samples(src):
        fp = fingerprints(load(audio, sr=CFG.audioSampleRate))
        ids += [audio_id(clip_id(rel, key))] * len(fp)
        prints += fp
    h, t = np.array(prints, np.uint64).reshape(-1, 2).T
    save(pl.DataFrame({"audio_id": np.array(ids, np.int64), "hash": h, "t1": t.astype(np.int32)}), dst)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("work", type=Path)
    p.add_argument("--workers", type=int, default=CPUS)
    args = p.parse_args()
    root = args.work / "collected"
    run(functools.partial(extract, root), todo(root, args.work / "olaf", ".parquet"), args.workers)


if __name__ == "__main__":
    main()
