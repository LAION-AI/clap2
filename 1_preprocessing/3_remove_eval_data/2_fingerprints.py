"""Landmark (M2) and band-energy sub-fingerprint (M3) matching of every corpus clip against the eval registry, each
candidate verified on the waveform (V): `index` builds the eval index, `scan` writes one parquet per corpus tar."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from common.tars import save, todo
from fpscan import EvalStore, Lib, frame


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=["index", "scan"])
    ap.add_argument("work", type=Path, help="reads collected/ and eval/registry/, writes eval/")
    ap.add_argument("--inflight", type=int, default=3, help="tars decoded / scanned at the same time")
    a = ap.parse_args()
    lib = Lib(EvalStore(a.work / "eval/registry"))
    if a.cmd == "index":  # fpscan.conf is written last
        return (a.work / "eval/fpscan_index/fpscan.conf").exists() or lib.index_build(a.work / "eval/fpscan_index")
    lib.index_load(a.work / "eval/fpscan_index")

    def one(tar, out):
        t = lib.read(tar)
        c = lib.scan(t)
        cols = {"method": np.array(["M2", "M3"])[c["method"] - 2], **{k: c[k] for k in (
            "eval_audio_id", "score", "n_support", "corpus_start_s", "corpus_end_s", "eval_start_s", "eval_end_s")}}
        save(frame(t, c["clip"], cols, c["v"]), out)

    with ThreadPoolExecutor(a.inflight) as ex:
        list(ex.map(lambda p: one(*p), todo(a.work / "collected", a.work / "eval/fingerprints", ".parquet")))


if __name__ == "__main__":
    main()
