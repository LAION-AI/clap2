"""WebDataset tars: read samples, write tars atomically, find the tars a step still has to process."""
import hashlib
import io
import json
import multiprocessing
import os
import re
import tarfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import polars as pl

AUDIO = {"flac", "wav"}
CPUS = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count()  # taskset-aware on Linux


def samples(path):
    """Yield (key, audio bytes, json dict). Members of one sample must be adjacent, as WebDataset requires."""
    key, group = None, {}
    with tarfile.open(path, "r|") as tar:
        for m in tar:
            if not m.isfile():
                continue
            k, ext = re.match(r"^((?:.*/|)[^.]+)\.(.*)$", m.name).groups()
            if k != key:
                if key is not None:
                    yield _sample(path, key, group)
                key, group = k, {}
            assert ext not in group, f"{path}: duplicate member {m.name}"
            group[ext] = tar.extractfile(m).read()
    if key is not None:
        yield _sample(path, key, group)


def _sample(path, key, group):
    audio = [e for e in group if e in AUDIO]
    assert len(audio) == 1 and "json" in group, f"{path}: {key} has members {sorted(group)}"
    return key, group[audio[0]], json.loads(group["json"])


class TarWriter:
    """Write (key, flac, json) samples to `path`; the file appears only when the writer closes without error."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.tar = tarfile.open(f"{self.path}.tmp", "w")

    def write(self, key, flac, meta):
        meta = json.dumps({**meta, "__key__": key}, ensure_ascii=False).encode()
        for ext, data in (("flac", flac), ("json", meta)):
            info = tarfile.TarInfo(f"{key}.{ext}")
            info.size = len(data)
            self.tar.addfile(info, io.BytesIO(data))

    def __enter__(self):
        return self

    def __exit__(self, exc, *_):
        self.tar.close()
        if exc is None:
            os.replace(f"{self.path}.tmp", self.path)


def clip_id(rel_tar, key):
    """Stable clip identifier: tar path relative to the input root (without .tar) plus the sample key."""
    return f"{Path(rel_tar).with_suffix('')}/{key}"


def audio_id(cid):
    """63-bit integer id of a clip id, used for the deterministic hash draws."""
    return int.from_bytes(hashlib.blake2b(cid.encode(), digest_size=8).digest(), "little") >> 1


def todo(src, dst, suffix, part="0/1"):
    """(input tar, output path) pairs under src whose output under dst does not exist yet; `part` = i/n."""
    i, n = map(int, part.split("/"))
    src, dst = Path(src), Path(dst)
    pairs = [(t, dst / t.relative_to(src).with_suffix(suffix)) for t in sorted(src.rglob("*.tar"))][i::n]
    return [(t, o) for t, o in pairs if not o.exists()]


def run(fn, pairs, workers=CPUS):
    """fn(in_tar, out_path) over all pairs in a spawned process pool (fork deadlocks after polars use)."""
    with ProcessPoolExecutor(workers, mp_context=multiprocessing.get_context("spawn")) as ex:
        list(ex.map(fn, *zip(*pairs)))


def save(df, path):
    """Write a polars DataFrame to parquet atomically, creating parent folders."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(f"{path}.tmp")
    os.replace(f"{path}.tmp", path)


def frame(rel, keys, columns, schema):
    """Table of one tar: clip_id, audio_id and the schema columns."""
    ids = [clip_id(rel, k) for k in keys]
    return pl.DataFrame({"clip_id": ids, "audio_id": [audio_id(c) for c in ids], **columns},
                        schema={"clip_id": pl.String, "audio_id": pl.Int64, **schema})


def merged(paths, drop=()):
    """clip_id -> non-null columns (without audio_id and `drop`) of per-tar parquets such as stats, annotations and captions."""
    out = {}
    for p in paths:
        for row in pl.read_parquet(p).drop("audio_id", *drop, strict=False).iter_rows(named=True):
            out.setdefault(row.pop("clip_id"), {}).update({k: v for k, v in row.items() if v is not None})
    return out


def per_tar(root):
    """Per-tar parquets under root with a `key` column as one lazy frame with clip_id."""
    root = f"{root}/"
    return pl.scan_parquet(f"{root}**/*.parquet", include_file_paths="path").with_columns(
        (pl.col("path").str.strip_prefix(root).str.strip_suffix(".parquet") + "/" + pl.col("key")).alias("clip_id"))
