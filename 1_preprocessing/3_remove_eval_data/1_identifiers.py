"""Identifier matching (M1): source ids, file names and YouTube ids with their time windows of every corpus clip
against those of the eval items. `extract` writes the ids of every clip, one parquet per corpus tar; `join` writes
eval/identifiers.parquet (clip_id, eval_audio_id, match_type, class_hint, windows)."""
import argparse
import datetime as dt
import json
import re
import tarfile
from pathlib import Path

import polars as pl

from common.tars import per_tar, run, save, todo

EXT = re.compile(r"\.(wav|flac|mp3|ogg|opus|m4a|aac|aiff?|mp4|webm)$", re.I)
R = {k: re.compile(v) for k, v in {  # id type -> regex, group 1 = value (freesound_* -> type freesound)
    "freesound_url": r"freesound\.org/(?:people/[^/\s]+/sounds|s|sounds)/(\d+)",
    "freesound_preview": r"freesound\.org/(?:data/)?previews/\d+/(\d+)_\d+",
    "freesound_fname": r"(?:^|/)(\d{1,7})__[^/]+?__",
    "youtube": r"(?:youtube\.com/(?:watch\?(?:\S*?&)?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])",
    "xc": r"(?:xeno-canto\.org/|(?<![A-Za-z0-9])XC)(\d{3,7})(?!\d)",
    "cv": r"(common_voice_[a-z]{2,3}(?:-[A-Za-z]{2,4})?_\d{3,})",
    "nsynth": r"(?<![a-z])([a-z]+_(?:acoustic|electronic|synthetic)_\d{3}-\d{3}-\d{3})(?!\d)",
    "iemocap": r"(Ses0[1-5][FM]_(?:impro|script)[0-9a-z_]+?_[FM]\d{3})",
    "voxceleb": r"id\d{5}[_/]([A-Za-z0-9_-]{11})[_/]\d{5}",
    "rec_stamp": r"(?:^|[/_ -])[A-Za-z][A-Za-z0-9]{1,6}_(?:\d{2,3}_)?(?:S\d{2}_)?((?:19|20)\d{6}_\d{6})",
}.items()}
STEM = {k: re.compile(v) for k, v in {  # rules on the file-name stem only
    "esc50": r"(?:^|_)([1-5]-(\d{1,7})-[A-Z]-\d{1,2})$",
    "us8k": r"(?:^|_)((\d{1,7})-\d-\d{1,3}-\d{1,3})$",
    "libri_utt": r"(?<![\d-])((\d{1,5})-(\d{1,6})-\d{4})(?![\d-])",
    "fleurs_wav": r"^(\d{17,20})$",
    "yt_key": r"^Y?([A-Za-z0-9_-]{11})(?:_(\d+(?:\.\d+)?)(?:_(\d+(?:\.\d+)?))?)?$",  # VGGSound / AudioSet style names
}.items()}
FS_NUMERIC = {"FSD50k", "BSD10k", "TACOS", "Freefield1010", "FSDnoisy18k"}  # sources whose numeric file names are Freesound ids
SKIP = {"text", "short_caption", "long_caption", "original_text", "caption", "description", "transcript", "lyrics"}
START, END = ("start_time", "start_sec", "start_s", "yt_start", "start"), ("end_time", "end_sec", "end_s", "yt_end", "end")
EXCERPT_OF_UPLOAD = {"esc50", "urbansound8k", "clotho"}  # their items are excerpts of a Freesound upload
FS_SETS = {"fsd50k", "fsdkaggle2019", "esc50", "urbansound8k", "clotho", "mridangam", "beijing_opera"}
HUB = 25  # a file name shared by more corpus clips than this is no identity evidence
STAMP_TOL_S = 30
SCHEMA = {"t": pl.String, "v": pl.String, "win_s": pl.Float64, "win_e": pl.Float64}


def stem(s):
    """File name without directory and audio extension."""
    return EXT.sub("", s.replace("\\", "/").split("?")[0].rsplit("/", 1)[-1])


def ids(s, fn=False):
    """(type, value, window start, window end) ids in one string; a file-name id for audio file names and keys."""
    out = set()
    for t, rx in R.items():
        for m in rx.finditer(s):
            out.add(("freesound" if t.startswith("freesound") else "youtube" if t == "voxceleb" else t,
                     m.group(1).lstrip("0") or "0" if t.startswith("freesound") else m.group(1), None, None))
    b = stem(s)
    for t, rx in STEM.items():
        m = rx.search(b)
        if not m:
            continue
        if t in ("esc50", "us8k"):
            out |= {(t, m.group(1), None, None), ("freesound", m.group(2).lstrip("0") or "0", None, None)}
        elif t == "libri_utt":
            out |= {(t, m.group(1), None, None), ("libri_chapter", f"{m.group(2)}-{m.group(3)}", None, None)}
        elif t == "yt_key" and re.search("[A-Z]", m.group(1)) and re.search("[a-z]", m.group(1)) and re.search("[0-9_-]", m.group(1)):
            s0 = float(m.group(2)) if m.group(2) else None
            out.add(("youtube", m.group(1), s0, float(m.group(3)) if m.group(3) else s0 + 10 if s0 is not None else None))
        elif t == "fleurs_wav":
            out.add((t, m.group(1), None, None))
    n = re.sub(r"[\s_]+", "_", b.lower()).strip("_")
    if (fn or EXT.search(s.split("?")[0])) and "://" not in s and len(n) >= 6 and not n.isdigit() and re.search(r"\d|[_\-. ]", n):
        out.add(("fn", n, None, None))
    return out


def corpus_ids(source, j):
    """Ids of one corpus clip from every short string value of its JSON, its typed id fields and its time window."""
    out, vals, num, stack = set(), [], {}, [j]
    while stack:
        for k, v in stack.pop().items():
            k = k.lower()
            if isinstance(v, dict):
                stack.append(v)
            elif isinstance(v, (int, float)) and not isinstance(v, bool) and k in START + END:
                num[k] = float(v)
            if isinstance(v, (str, int)) and not isinstance(v, bool) and k not in SKIP and len(str(v)) <= 300:
                v = str(v)
                vals.append(v)
                if k in ("freesound_id", "fsid", "fs_id") and v.isdigit():
                    out.add(("freesound", v.lstrip("0") or "0", None, None))
                if k in ("youtube_id", "ytid", "yt_id", "video_id", "youtube") and re.fullmatch(r"[A-Za-z0-9_-]{11}", v):
                    out.add(("youtube", v, None, None))
                if k == "xc_id" and v.isdigit():
                    out.add(("xc", v, None, None))
    for s in vals:
        out |= ids(s, s == j["__key__"])
        if source in FS_NUMERIC and stem(s).isdigit() and len(stem(s)) <= 7:
            out.add(("freesound", stem(s).lstrip("0") or "0", None, None))
    m = re.search(r"(?i)(test|dev|train)[-_](clean|other)", f"{j.get('split', '')} {j.get('original_file_name', '')}")
    if "libri" in source.lower() and m and str(j.get("speaker_id", "")).isdigit():
        out.add(("libri_split_spk", f"{m.group(1).lower()}_{m.group(2).lower()}:{j['speaker_id']}", None, None))
    # window of the clip on its video: the source's start field, shifted by the cut position for cuts of a recording
    base = next((num[k] for k in START[:-1] if k in num), None)
    if "parent" in j:
        s0, e0 = (base or 0.0) + j["start"], (base or 0.0) + j["end"]
    else:
        s0, e0 = next((num[k] for k in START if k in num), None), next((num[k] for k in END if k in num), None)
        e0 = s0 + j["orig_duration"] if e0 is None and s0 is not None else e0
    return [(t, v, s0, e0) if t == "youtube" and s is None else (t, v, s, e) for t, v, s, e in sorted(out, key=str)]


def extract(tar, out, root):
    """Ids of every clip of one corpus tar (JSON members only)."""
    rows = []
    with open(tar, "rb", buffering=0) as f, tarfile.open(fileobj=f, mode="r:") as tf:
        for m in tf:
            if m.name.endswith(".json"):
                key = re.match(r"^((?:.*/|)[^.]+)\.", m.name).group(1)
                rows += [(key, *r) for r in corpus_ids(Path(tar).relative_to(root).parts[0], json.loads(tf.extractfile(m).read()))]
    save(pl.DataFrame(rows, schema={"key": pl.String, **SCHEMA}, orient="row").unique(), out)


def eval_keys(items):
    """(eval_dataset, eval_audio_id, t, v, eval_win_s, eval_win_e) keys of every eval item."""
    rows = []
    for r in items.iter_rows(named=True):
        ds = r["eval_dataset"]
        k = {x for s in (r["orig_filename"], r["source_file"], r["cv_path"]) if s for x in ids(s, True)}
        k |= {x for x in ids(r["item_id"] or "") if x[0] != "fn"}
        if r["freesound_id"] is not None and ds in FS_SETS:
            k.add(("freesound", str(r["freesound_id"]), None, None))
        if r["youtube_id"]:
            k = {x for x in k if x[0] != "youtube"} | {("youtube", r["youtube_id"], r["yt_start_s"], r["yt_end_s"])}
        if r["xc_id"] is not None:
            k.add(("xc", str(r["xc_id"]), None, None))
        if ds == "libricount" and r["role"] == "item":  # LibriCount mixes LibriSpeech test-clean speakers
            k |= {("libri_split_spk", f"test_clean:{s}", None, None) for s in (r["speaker_id"] or "").split(";") if s}
        if ds.startswith("birdset_") and r["rec_datetime"]:
            t0 = dt.datetime.strptime(r["rec_datetime"][:19], "%Y-%m-%d %H:%M:%S")
            k |= {("rec_stamp", (t0 + dt.timedelta(seconds=d)).strftime("%Y%m%d_%H%M%S"), None, None)
                  for d in range(-STAMP_TOL_S, STAMP_TOL_S + 1)}
        rows += [(ds, r["eval_audio_id"], *x) for x in k]
    return pl.DataFrame(rows, schema={"eval_dataset": pl.String, "eval_audio_id": pl.Int32, **SCHEMA}, orient="row").unique()


def join(work):
    """Corpus ids x eval keys -> eval/identifiers.parquet."""
    ek = eval_keys(pl.read_parquet(work / "eval/registry/items.parquet").unique(
        ["eval_audio_id", "orig_filename", "source_file", "cv_path", "item_id", "freesound_id", "youtube_id", "xc_id",
         "speaker_id", "rec_datetime", "role"])).rename({"win_s": "eval_win_s", "win_e": "eval_win_e"})
    m = (per_tar(work / "eval/identifiers").join(ek.lazy(), on=["t", "v"])
         .rename({"win_s": "corpus_win_s", "win_e": "corpus_win_e"}).collect(engine="streaming"))
    hub = m.filter(pl.col("t") == "fn").group_by("v").agg(pl.col("clip_id").n_unique().alias("n")).filter(pl.col("n") > HUB)
    ov = pl.min_horizontal("corpus_win_e", "eval_win_e") - pl.max_horizontal("corpus_win_s", "eval_win_s")
    yt, t = pl.col("t") == "youtube", pl.col("t")
    hint = (pl.when(yt & (ov > 0)).then(pl.lit("C2")).when(yt & ov.is_not_null()).then(pl.lit("C4")).when(yt).then(pl.lit("C2/C4"))
            .when((t == "freesound") & pl.col("eval_dataset").is_in(list(EXCERPT_OF_UPLOAD))).then(pl.lit("C2-src"))
            .when(t.is_in(["libri_chapter", "libri_split_spk"])).then(pl.lit("C4")).when(t == "rec_stamp").then(pl.lit("C2/C4"))
            .when((t == "fn") & pl.col("v").is_in(hub["v"].implode())).then(pl.lit("filename-hub"))
            .when(t == "fn").then(pl.lit("C0-C2?")).otherwise(pl.lit("C0-C2")))
    m = m.with_columns(hint.alias("class_hint"), ov.alias("overlap_s"),
                       pl.when(t == "fn").then(pl.lit("filename")).otherwise("id:" + t).alias("match_type"))
    save(m.select("clip_id", "eval_audio_id", "eval_dataset", "match_type", pl.col("v").alias("matched_value"), "class_hint",
                   "corpus_win_s", "corpus_win_e", "eval_win_s", "eval_win_e", "overlap_s").unique(), work / "eval/identifiers.parquet")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=["extract", "join"])
    ap.add_argument("work", type=Path)
    a = ap.parse_args()
    if a.cmd == "join":
        return join(a.work)
    run(extract, [(t, o, a.work / "collected") for t, o in todo(a.work / "collected", a.work / "eval/identifiers", ".parquet")])


if __name__ == "__main__":
    main()
