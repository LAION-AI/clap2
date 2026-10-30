"""Convert RAW/<source>/ downloads into WebDataset tars IN/<source>/{000000..}.tar: FLAC at the original rate and channels,
JSON with `text` (from the source's text rule or template), `group` and the source's native metadata."""
import argparse
import json
import re
import string
import tarfile
from pathlib import Path

import av
import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

from common.audio import decode, flac
from common.tars import CPUS, TarWriter, run
from text_rules import RULES, words

AUDIO = {".wav", ".flac", ".mp3", ".ogg", ".opus", ".m4a", ".aac", ".wma", ".aif", ".aiff", ".au", ".snd", ".webm", ".mp4", ".caf"}
PER_TAR = 4096


class Template(string.Formatter):
    """str.format with the conversion `!w` = words(value)."""

    def convert_field(self, value, conversion):
        return words(str(value)) if conversion == "w" else super().convert_field(value, conversion)


def audio_columns(schema):
    """HF Audio columns: structs with `bytes` and `path`."""
    cols = [c.name for c in schema if pa.types.is_struct(c.type) and {"bytes", "path"} <= {x.name for x in c.type}]
    assert cols, f"no audio column in {schema.names}"
    return cols


def audio_files(root, globs):
    """Sorted files under root matching globs (default: every audio file), without macOS resource forks."""
    fs = {p for g in globs or ["**/*"] for p in root.glob(g, case_sensitive=False) if p.is_file()}
    return sorted(p for p in fs if (globs or p.suffix.lower() in AUDIO) and "__MACOSX" not in p.parts and not p.name.startswith("._"))


def units(row, root):
    """Work units of one source, one per output tar: file lists, (parquet, start, stop) row ranges or WebDataset tars."""
    globs = row["files"].split()
    if globs and globs[0].endswith(".parquet"):
        return [("parquet", (f, a, min(a + step, n))) for f in audio_files(root, globs)
                for n, step in [(pq.ParquetFile(f).metadata.num_rows, PER_TAR // len(audio_columns(pq.read_schema(f))))]
                for a in range(0, n, step)]
    if globs and globs[0].endswith(".tar"):
        return [("wds", f) for f in audio_files(root, globs)]
    fs = audio_files(root, globs)
    return [("files", fs[i:i + PER_TAR]) for i in range(0, len(fs), PER_TAR)]


def records(kind, unit, root):
    """Yield (native metadata, audio path or file object) of one unit."""
    if kind == "files":
        for p in unit:
            yield {"path": p.relative_to(root).as_posix()}, str(p)
    elif kind == "parquet":
        f, a, b = unit
        t = pl.scan_parquet(f).slice(a, b - a).collect().to_arrow()
        cols = audio_columns(t.schema)
        feats = json.loads((pq.read_schema(f).metadata or {}).get(b"huggingface", b'{"info": {"features": {}}}'))["info"]["features"]
        names = {c: v["names"] for c, v in feats.items() if isinstance(v, dict) and v.get("_type") == "ClassLabel"}
        for j, r in enumerate(t.to_pylist()):
            audios = {c: r.pop(c) for c in cols}
            meta = {k: names[k][v] if k in names and v is not None else v for k, v in r.items() if not isinstance(v, bytes)}
            for c, audio in audios.items():
                yield ({**meta, **({"audio_column": c} if len(cols) > 1 else {}), "path": audio["path"] or f"{f.relative_to(root)}:{a + j}"},
                       audio["bytes"])
    else:
        key, group = None, {}
        with tarfile.open(unit, "r|*") as t:
            for m in t:
                if m.isfile():
                    k, ext = re.match(r"^((?:.*/|)[^/.]+)\.?(.*)$", m.name).groups()
                    if k != key and group:
                        yield _wds(unit, root, key, group)
                        group = {}
                    key, group[ext] = k, t.extractfile(m).read()
        if group:
            yield _wds(unit, root, key, group)


def _wds(tar, root, key, g):
    audio = [e for e in g if f".{e.lower()}" in AUDIO]
    assert len(audio) == 1, f"{tar}: {key} has {sorted(g)}"
    meta = json.loads(g["json"]) if "json" in g else {}
    meta |= {e: g[e].decode() for e in ("txt", "cls", "caption") if e in g}
    return {**meta, "path": f"{tar.relative_to(root)}/{key}"}, g[audio[0]]


def convert(task, out):
    """Write one output tar for one unit of a source."""
    row, raw, kind, unit = task
    root, text = raw / row["source"], row["text"]
    rule = re.fullmatch(r"([a-z0-9_]+)(?::([^{}]+))?", text)
    assert not rule or rule[1] in RULES, f"{row['source']}: unknown text rule {text}"
    skipped, n = 0, 0
    with TarWriter(out) as w:
        for i, (meta, src) in enumerate(records(kind, unit, root)):
            try:
                x, sr = decode(src)
            except av.FFmpegError as e:  # undecodable files are dropped, as by the pipeline's decode check
                print(f"{out}: {meta['path']}: {e}")
                x = []
            if not len(x):
                skipped += 1
                continue
            if x.shape[1] > 8:  # FLAC holds at most 8 channels
                x, meta["channels"] = x.mean(1, keepdims=True), x.shape[1]
            p = Path(meta["path"])
            meta |= (RULES[rule[1]](meta, root, *([rule[2]] if rule[2] else [])) if rule else
                     {"text": Template().vformat(text, (), {"dir": p.parent.name, "stem": p.stem, **meta})})
            meta |= {"captioning_model": row["captioned"]} if row["captioned"] and meta["text"] else {}
            meta = json.loads(json.dumps(meta, ensure_ascii=False, default=str))
            w.write(f"{out.stem}_{i:04d}", flac(x, sr), {**meta, "group": row["group"], "__url__": f"{row['source']}/{out.name}"})
            n += 1
    print(f"{out}: {n} clips, {skipped} without audio", flush=True)


def info(row, d):
    """info.md of one output source folder."""
    d.mkdir(parents=True, exist_ok=True)
    made = f" (model-generated: {row['captioned']})" if row["captioned"] else ""
    (d / "info.md").write_text(f"# {row['source']}\n\n- Group: {row['group']}\n- Source: {row['handler']} {row['ref']}\n"
                               f"- Licence: {row['licence']} ({row['licence_url']})\n- Text: {row['text'] or '(none, captioned later)'}{made}\n"
                               f"- Format: FLAC at the original sample rate and channels, JSON with `text`, <= {PER_TAR} clips per tar\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("raw", type=Path, help="download root of download.py")
    ap.add_argument("out", type=Path, help="output root IN/")
    ap.add_argument("--sources", help="comma-separated sources (default: every downloaded source)")
    ap.add_argument("--csv", type=Path, default=Path(__file__).with_name("sources.csv"))
    ap.add_argument("--workers", type=int, default=CPUS)
    a = ap.parse_args()
    rows = pl.read_csv(a.csv, infer_schema_length=0).fill_null("")
    names = a.sources.split(",") if a.sources else [s for s in rows["source"] if (a.raw / s / ".done").exists()]
    assert set(names) <= set(rows["source"]), set(names) - set(rows["source"])
    pairs = []
    for row in rows.filter(pl.col("source").is_in(names)).iter_rows(named=True):
        assert (a.raw / row["source"] / ".done").exists(), f"{row['source']} is not downloaded"
        us = units(row, a.raw / row["source"])
        assert us, f"{row['source']}: no audio found"
        info(row, a.out / row["source"])
        pairs += [((row, a.raw, kind, u), a.out / row["source"] / f"{k:06d}.tar") for k, (kind, u) in enumerate(us)]
    run(convert, [(t, o) for t, o in pairs if not o.exists()], a.workers)


if __name__ == "__main__":
    main()
