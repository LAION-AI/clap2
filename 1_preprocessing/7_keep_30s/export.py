"""Export: selected clips of at most 30 s with annotations and captions merged into the JSON, globally shuffled tars."""
import argparse
import json
import math
import os
import tarfile
from contextlib import ExitStack
from functools import partial
from pathlib import Path

import numpy as np
import polars as pl

from common.tars import TarWriter, audio_id, clip_id, merged, run, samples

PER_TAR = 4096


def plan(work, base, max_seconds, seed, units, holdout):
    """Split (lowest audio ids: valid, then test) and seeded position of every selected clip <= max_seconds with text
    or a caption; one plan file per split and unit."""
    root, params = base / "plan", {"max_seconds": max_seconds, "seed": seed, "units": units, "holdout": holdout}
    if root.exists():
        old = json.loads((root / "params.json").read_text()) if (root / "params.json").exists() else params
        assert old == params, f"{root} was planned with {old}; delete it to plan with {params}"
    else:
        captioned = pl.scan_parquet(work / "captions" / "**" / "*.parquet").select("clip_id", captioned=True)
        df = (pl.scan_parquet(work / "selection.parquet").select("clip_id")
              .join(pl.scan_parquet(work / "stats" / "**" / "*.parquet").select("clip_id", "audio_id", "tar", "key", "duration", "text_len"),
                    on="clip_id")
              .join(captioned, on="clip_id", how="left").filter(pl.col("duration") <= max_seconds).collect())
        keep = (pl.col("text_len") > 0) | pl.col("captioned").fill_null(False)
        print(f"{df.filter(~keep).height:,} clips without text or caption are left out")
        df, i, rng = df.filter(keep).sort("audio_id"), pl.int_range(pl.len()), np.random.default_rng(seed)
        assert df.height > 2 * holdout
        df = df.with_columns(split=pl.when(i < holdout).then(pl.lit("valid")).when(i < 2 * holdout).then(pl.lit("test"))
                             .otherwise(pl.lit("train")), unit=pl.col("tar").cast(pl.Enum(df["tar"].unique().sort())).to_physical() % units)
        tmp = Path(f"{root}.tmp")
        for (split,), part in df.partition_by("split", as_dict=True).items():
            (tmp / split).mkdir(parents=True, exist_ok=True)
            for (u,), rows in part.with_columns(pl.Series("pos", rng.permutation(part.height))).partition_by("unit", as_dict=True).items():
                rows.drop("unit", "split").write_parquet(tmp / split / f"{u:05d}.parquet")
        (tmp / "params.json").write_text(json.dumps(params))
        os.replace(tmp, root)
    return {d.name: sorted(d.glob("*.parquet")) for d in sorted(root.iterdir()) if d.is_dir()}


def fields(work, rel):
    """clip_id -> annotation fields and captions (tars whose clips all have text have no captions) of one collected tar."""
    captions = work / "captions" / rel.with_suffix(".parquet")
    return merged([d / rel.with_suffix(".parquet") for d in sorted((work / "annotation").iterdir())] + [captions] * captions.exists())


def route(work, frags, per_group, unit_plan, done):
    """Copy the clips of one unit's source tars into one fragment tar per output group, keyed by global position."""
    with ExitStack() as stack:
        writers = {}
        for (rel,), rows in pl.read_parquet(unit_plan).group_by("tar"):
            want, extra, n = dict(zip(rows["key"], rows["pos"])), fields(work, Path(rel)), 0
            for key, audio, meta in samples(work / "collected" / rel):
                if key in want:
                    cid, pos = clip_id(rel, key), want[key]
                    f = extra[cid]
                    assert not meta.keys() & (f.keys() | {"clip_id"}), (cid, meta.keys() & f.keys())
                    text = meta["text"] or (f["short_caption"], f["long_caption"])[audio_id(cid) % 2]
                    g = pos // (PER_TAR * per_group)
                    if g not in writers:
                        writers[g] = stack.enter_context(TarWriter(frags / f"{g:05d}" / f"{unit_plan.stem}.tar"))
                    writers[g].write(f"{pos:09d}", audio, {**meta, **f, "text": text, "clip_id": cid})
                    n += 1
            assert n == len(want), f"{rel}: found {n} of {len(want)} selected clips"
    done.touch()


def assemble(out, n, per_group, group, g):
    """Write the output tars of one group in position order, reading members by offset from the fragments."""
    members = []
    for frag in sorted(group.glob("*.tar")):
        with tarfile.open(frag) as t:
            members += [(m.name, frag, m.offset_data, m.size) for m in t]
    members.sort()
    first = g * per_group
    assert len(members) == 2 * (min(n, (first + per_group) * PER_TAR) - first * PER_TAR), f"group {g} incomplete"
    files = {f: open(f, "rb") for f in {m[1] for m in members}}

    def read(m):
        files[m[1]].seek(m[2])
        return files[m[1]].read(m[3])

    for t in range(first, min(first + per_group, math.ceil(n / PER_TAR))):
        if (out / f"{t:06d}.tar").exists():
            continue
        with TarWriter(out / f"{t:06d}.tar") as w:
            for i in range((t - first) * PER_TAR * 2, min(len(members), (t - first + 1) * PER_TAR * 2), 2):
                flac, meta = members[i], members[i + 1]
                assert flac[0] == f"{flac[0][:9]}.flac" and meta[0] == f"{flac[0][:9]}.json"
                w.write(flac[0][:9], read(flac), json.loads(read(meta)))
    for f in files.values():
        f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--max-seconds", type=float, default=30.0)
    ap.add_argument("--seed", type=int, default=20260831)
    ap.add_argument("--units", type=int, default=1024, help="routing units (groups of source tars)")
    ap.add_argument("--groups", type=int, default=512, help="shuffle groups (ranges of output tars, one open file each)")
    ap.add_argument("--holdout", type=int, default=1000, help="clips each in OUT/valid and OUT/test, never in OUT/train")
    a = ap.parse_args()
    base = a.work / "export" / a.out.name
    for split, plans in plan(a.work, base, a.max_seconds, a.seed, a.units, a.holdout).items():
        exp, out = base / split, a.out / split
        n = sum(pl.scan_parquet(p).select(pl.len()).collect().item() for p in plans)
        per_group = math.ceil(math.ceil(n / PER_TAR) / a.groups)
        marks = [exp / "routed" / f"{p.stem}.done" for p in plans]
        (exp / "routed").mkdir(parents=True, exist_ok=True)
        run(partial(route, a.work, exp / "frags", per_group), [(p, m) for p, m in zip(plans, marks) if not m.exists()])
        groups = range(math.ceil(n / PER_TAR / per_group))
        run(partial(assemble, out, n, per_group), [(exp / "frags" / f"{g:05d}", g) for g in groups])
        assert len(list(out.glob("*.tar"))) == math.ceil(n / PER_TAR)


if __name__ == "__main__":
    main()
