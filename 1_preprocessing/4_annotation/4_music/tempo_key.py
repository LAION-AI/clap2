"""Tempo (librosa) and Krumhansl-Schmuckler key (24 keys) on the first 10 s of predicted music at 16 kHz; CPU only."""
import argparse
from functools import partial
from pathlib import Path

import librosa
import numpy as np
import polars as pl

from common.audio import load
from common.tars import clip_id, frame, run, samples, save, todo

SR, SECONDS = 16000, 10
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCHEMA = {"pred_tempo_bpm": pl.Float32, "music_key": pl.String}


def tempo_key(y):
    """(bpm, 'C# minor') of a 16 kHz signal; None for clips under 1 s."""
    if y.size < SR:
        return None, None
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    bpm = float(librosa.feature.tempo(onset_envelope=onset, sr=SR, hop_length=512)[0])
    chroma = librosa.feature.chroma_stft(y=y, sr=SR, hop_length=2048).mean(1)
    r = [np.corrcoef(np.roll(p, i), chroma - chroma.mean())[0, 1] for p in (MAJOR, MINOR) for i in range(12)]
    mode, tonic = divmod(int(np.argmax(r)), 12)
    return round(bpm, 1), f"{PITCH[tonic]} {('major', 'minor')[mode]}"


def process(root, tax, path, out):
    rel = Path(path).relative_to(root)
    music = set(pl.read_parquet(tax / rel.with_suffix(".parquet")).filter(pl.col("tax_l1") == "Music")["clip_id"])
    rows = {c: [] for c in ["key", *SCHEMA]}
    for key, audio, _ in samples(path):
        if clip_id(rel, key) in music:
            rows["key"].append(key)
            for c, v in zip(SCHEMA, tempo_key(load(audio, SR, SECONDS))):
                rows[c].append(v)
    save(frame(rel, rows.pop("key"), rows, SCHEMA), out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work", type=Path)
    a = ap.parse_args()
    root, tax = a.work / "collected", a.work / "annotation" / "taxonomy"
    pairs = todo(root, a.work / "annotation" / "tempo_key", ".parquet")
    assert not todo(root, tax, ".parquet"), "run 0_taxonomy on every tar first"
    run(partial(process, root, tax), pairs)


if __name__ == "__main__":
    main()
