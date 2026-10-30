"""Public loaders of the scored evaluation items; each yields (decode job, audio kind, item rows) per eval audio."""
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
from functools import cache, partial
from pathlib import Path

import numpy as np
import polars as pl
import pyarrow.parquet as pq
import requests
import soundfile as sf

KEYS = {"freesound_id": pl.Int64, "youtube_id": pl.String, "yt_start_s": pl.Float64, "yt_end_s": pl.Float64,
        "xc_id": pl.Int64, "orig_filename": pl.String, "source_file": pl.String, "cv_path": pl.String,
        "speaker_id": pl.String, "rec_datetime": pl.String, "site": pl.String, "text": pl.String}
ITEM = {"suite": pl.String, "task": pl.String, "split": pl.String, "item_id": pl.String, "eval_dataset": pl.String,
        "scored": pl.Boolean, "role": pl.String, "seg_start_s": pl.Float64, "seg_end_s": pl.Float64, **KEYS}
ZENODO = "https://zenodo.org/records/{}/files/{}?download=1"


def fetch(url, dest):
    """Download url to dest once (atomic)."""
    dest = Path(dest)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetch {url}", flush=True)
        with requests.get(url, stream=True, timeout=120) as r, open(f"{dest}.part", "wb") as f:
            r.raise_for_status()
            f.writelines(r.iter_content(1 << 24))
        os.replace(f"{dest}.part", dest)
    return dest


def unpack(archive):
    """Extract an archive once into <archive>.d/ and return that folder."""
    out = Path(f"{archive}.d")
    if not out.exists():
        tmp = Path(f"{archive}.d.part")
        shutil.rmtree(tmp, ignore_errors=True)
        if archive.suffix == ".7z":
            subprocess.run(["7z", "x", "-y", f"-o{tmp}", str(archive)], check=True, stdout=subprocess.DEVNULL)
        else:
            shutil.unpack_archive(archive, tmp)
        os.replace(tmp, out)
    return out


def hf(repo, revision, patterns):
    """Snapshot of a Hugging Face dataset repo (into the HF cache under --downloads)."""
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(repo, repo_type="dataset", revision=revision, allow_patterns=patterns))


def wav(src):
    """Decode job for a file path or encoded bytes: () -> (float32 [n, channels], rate)."""
    return partial(sf.read, io.BytesIO(src) if isinstance(src, bytes) else str(src), dtype="float32", always_2d=True)


def row(suite, task, split, item_id, ds, scored=True, role="item", **keys):
    """One item reference."""
    assert keys.keys() <= KEYS.keys() | {"seg_start_s", "seg_end_s"}, keys.keys() - KEYS.keys()
    return dict(suite=suite, task=task, split=split, item_id=str(item_id), eval_dataset=ds, scored=scored, role=role,
                **keys)


def grab(rx, s, cast=str):
    """First group of `rx` in `s`, cast; None when it does not occur."""
    m = re.search(rx, s)
    return cast(m[1]) if m else None


# ------------------------------------------------------- clap: AudioCaps test, Clotho evaluation, VGGSound test

def clotho(dl):
    d = dl / "clotho"
    audio = unpack(fetch(ZENODO.format(4783391, "clotho_audio_evaluation.7z"), d / "clotho_audio_evaluation.7z"))
    caps, meta = (pl.read_csv(fetch(ZENODO.format(4783391, f), d / f), infer_schema=False)
                  for f in ("clotho_captions_evaluation.csv", "clotho_metadata_evaluation.csv"))
    t = caps.join(meta, on="file_name", how="inner").with_columns(pl.col("sound_id").cast(pl.Int64, strict=False))
    assert t.height == caps.height == 1045 and t["sound_id"].null_count() == (t["sound_link"] == "NA").sum()
    for r in t.iter_rows(named=True):
        fn = r["file_name"]
        yield wav(audio / "evaluation" / fn), "item", [row(
            "clap", "clotho", "evaluation", fn, "clotho", orig_filename=fn, freesound_id=r["sound_id"],
            text="\n".join(r[f"caption_{i}"] for i in range(1, 6)))]


def audiocaps(dl):
    off = pl.read_csv(fetch("https://raw.githubusercontent.com/cdjkim/audiocaps/master/dataset/test.csv",
                            dl / "audiocaps" / "test.csv"))
    clips = {y: (s, c) for y, s, c in off.group_by("youtube_id").agg(pl.col("start_time").first(),
                                                                     pl.col("caption").str.join("\n")).iter_rows()}
    unique = {c: y[0] for c, y in off.group_by("caption").agg(pl.col("youtube_id").unique()).iter_rows() if len(y) == 1}
    root = hf("CLAPv2/audiocaps", "4d18fe131daaf6b07f9eae97e2854c7e6ea76e8c", ["data/test/*"])
    for f in sorted((root / "data" / "test").glob("*.parquet")):
        for r in pq.read_table(f, columns=["audio", "text"]).to_pylist():
            y = unique.get(r["text"].strip())  # a caption shared by several clips names no clip
            k = dict(youtube_id=y, yt_start_s=float(clips[y][0]), yt_end_s=clips[y][0] + 10.0, text=clips[y][1]) if y \
                else dict(text=r["text"])
            yield wav(r["audio"]["bytes"]), "item", [row("clap", "audiocaps", "test", f"{f.stem}/{r['audio']['path']}",
                                                         "audiocaps", **k)]


def vggsound(dl):
    root = hf("txya900619/vggsound-16k", "6f0ca13cf7d978405300fafee9e1393f955fe40d", ["data/test-*"])
    for f in sorted((root / "data").glob("test-*.parquet")):
        for r in pq.read_table(f).to_pylist():
            fn = r["audio"]["path"]
            y, s = re.fullmatch(r"(.{11})_(\d+)\.wav", fn).groups()
            yield wav(r["audio"]["bytes"]), "item", [row("clap", "vggsound", "test", fn, "vggsound", youtube_id=y,
                                                         yt_start_s=int(s), yt_end_s=int(s) + 10, text=r["caption"])]


# ---------------------------------------------------------------- HEAR 2021 (48 kHz renderings from Zenodo)

HEAR = {"beehive_states_fold0-v2-full": "beehive", "beehive_states_fold1-v2-full": "beehive",
        "beijing_opera-v1.0-hear2021-full": "beijing_opera", "dcase2016_task2-hear2021-full": "dcase2016_task2",
        "esc50-v2.0.0-full": "esc50", "fsd50k-v1.0-full": "fsd50k",
        "gunshot_triangulation-v1.0-full": "gunshot_triangulation", "libricount-v1.0.0-hear2021-full": "libricount",
        "maestro-v3.0.0-5h": "maestro", "mridangam_stroke-v1.5-full": "mridangam",
        "mridangam_tonic-v1.5-full": "mridangam", "nsynth_pitch-v2.2.3-50h": "nsynth",
        "nsynth_pitch-v2.2.3-5h": "nsynth", "speech_commands-v0.0.2-5h": "speech_commands",
        "speech_commands-v0.0.2-full": "speech_commands", "tfds_crema_d-1.0.0-full": "crema_d",
        "tfds_gtzan-1.0.0-full": "gtzan_genre", "tfds_gtzan_music_speech-1.0.0-full": "gtzan_music_speech",
        "vocal_imitation-v1.1.3-full": "vocal_imitation", "vox_lingua_top10-hear2021-full": "voxlingua107"}
DCASE = "https://archive.org/download/dcase2016_task2_train_dev/"


FREESOUND = {"esc50": r"^\d-(\d+)-", "fsd50k": r"^(\d+)$", "mridangam": r"^(\d+)__", "beijing_opera": r"^(\d+)__"}


def hear_keys(ds, stem, dl):
    """Key columns that HEAR file names (and the LibriCount / DCASE 2016 side lists) carry."""
    if ds in FREESOUND:
        return dict(freesound_id=grab(FREESOUND[ds], stem, int))
    if ds == "voxlingua107":
        y, a, b = re.fullmatch(r"(.{11})__U__S\d+---([\d.]+)-([\d.]+)", stem).groups()
        return dict(youtube_id=y, yt_start_s=float(a), yt_end_s=float(b))
    if ds == "speech_commands":
        return dict(speaker_id=grab(r"([0-9a-f]{8})_nohash_", stem))
    if ds == "maestro":
        return dict(source_file=stem)
    if ds == "beehive":
        return dict(source_file=grab(r"^(.*?)_*\d\d_\d\d_\d\d$", stem))
    if ds == "dcase2016_task2":
        return dict(source_file=";".join(dcase_lists(dl).get(stem, [])) or None)
    if ds == "libricount":
        return dict(speaker_id=";".join(libricount_speakers(dl)[stem]) or None)
    return {}


@cache
def dcase_lists(dl):
    """DCASE 2016 task 2 dev mixture -> the isolated training events mixed into it."""
    d = unpack(fetch(DCASE + "dcase2016_task2_dev_samplesList.zip", dl / "dcase2016" / "samplesList.zip"))
    return {p.stem: p.read_text().split() for p in d.glob("*/dev_*.txt")}


@cache
def libricount_speakers(dl):
    """LibriCount mixture -> sorted LibriSpeech speaker ids (Zenodo 1216072 metadata)."""
    d = unpack(fetch(ZENODO.format(1216072, "LibriCount10-0dB.zip"), dl / "libricount" / "LibriCount10-0dB.zip"))
    return {p.stem: sorted({str(s["speaker_id"]) for s in json.loads(p.read_text())}) for p in d.glob("*/*.json")}


def hear(task, dl):
    root = unpack(fetch(ZENODO.format(6332517, f"hear2021-{task}-48000.tar.gz"), dl / "hear" / f"{task}.tar.gz"))
    d, = root.glob(f"**/tasks/{task}")
    md = json.loads((d / "task_metadata.json").read_text())
    kfold = md["split_mode"] in ("new_split_kfold", "presplit_kfold")
    ds = HEAR[task]
    for split in sorted(p.name for p in (d / "48000").iterdir()) if kfold else ["test"]:
        labels = json.loads((d / f"{split}.json").read_text())
        for fn in sorted(os.listdir(d / "48000" / split)):
            text = ";".join(sorted({str(e["label"] if isinstance(e, dict) else e) for e in labels[fn]}))
            yield wav(d / "48000" / split / fn), "item", [row(
                "HEAR", task, split, fn, ds, orig_filename=None if fn.startswith("tfds_id") else fn, text=text,
                **hear_keys(ds, fn.removesuffix(".wav"), dl))]


def librispeech(dl):
    url = "https://www.openslr.org/resources/12/test-clean.tar.gz"
    root = unpack(fetch(url, dl / "librispeech" / "test-clean.tar.gz"))
    for trans in sorted(root.glob("LibriSpeech/test-clean/*/*/*.trans.txt")):
        for line in trans.read_text().splitlines():
            u, text = line.split(" ", 1)
            yield wav(trans.parent / f"{u}.flac"), "source_recording", [row(
                "HEAR", "libricount-v1.0.0-hear2021-full", "source", u, "libricount", scored=False,
                role="source_recording", orig_filename=f"{u}.flac", speaker_id=u.split("-")[0], text=text)]


def dcase_events(dl):
    root = unpack(fetch(DCASE + "dcase2016_task2_train_dev.zip", dl / "dcase2016" / "train_dev.zip"))
    for p in sorted(root.glob("**/dcase2016_task2_train/*.wav")):
        yield wav(p), "source_recording", [row(
            "HEAR", "dcase2016_task2-hear2021-full", "source", p.name, "dcase2016_task2", scored=False,
            role="source_recording", orig_filename=p.name, text=re.sub(r"\d+$", "", p.stem))]


# ---------------------------------------------------------------- MSEB: BirdSet test_5s, FSD50K eval, SVQ English

BIRDSET = ("laion/eval-mseb-birdset", "7f26b0b89b6c17d74ec580e06a5eec5e8a966ded")
SITES = ("PER", "NES", "UHH", "HSN", "NBP", "POW", "SSW", "SNE")


def birdset_recording(path, rows, starts):
    """One source recording reassembled from its window rows at their nominal offsets (s)."""
    pf = pq.ParquetFile(path)
    bounds = np.cumsum([0] + [pf.metadata.row_group(i).num_rows for i in range(pf.num_row_groups)])
    wins = {}
    for g in sorted({int(np.searchsorted(bounds, r, "right")) - 1 for r in rows}):
        audio = pf.read_row_group(g, columns=["audio"]).column("audio")
        wins |= {r: audio[r - bounds[g]] for r in rows if bounds[g] <= r < bounds[g + 1]}
    sr, = {wins[r]["sample_rate"].as_py() for r in rows}
    w = [(round(s * sr), wins[r]["waveform"].values.to_numpy()) for r, s in zip(rows, starts)]
    x = np.zeros(max(o + len(v) for o, v in w), np.float32)
    for o, v in w:
        x[o:o + len(v)] = v
    return x[:, None], sr


def window_md5s(path):
    """filepath -> md5 of the float32 window samples."""
    pf = pq.ParquetFile(path)
    return {f: hashlib.md5(a["waveform"].values.to_numpy().tobytes()).hexdigest()
            for g in range(pf.num_row_groups)
            for t in [pf.read_row_group(g, columns=["filepath", "audio"])]
            for f, a in zip(t.column("filepath").to_pylist(), t.column("audio"))}


def birdset(site, dl):
    root = hf(*BIRDSET, [f"birdset_{site}_test_5s.parquet", "class_lists.json", "config_to_class_list.json"]
              + [f"birdset_{x}_test_5s.parquet" for x in ("XCM", "XCL") if site == "POW"])
    lists = json.loads((root / "config_to_class_list.json").read_text())
    names = json.loads((root / "class_lists.json").read_text())[lists[site]]
    path = root / f"birdset_{site}_test_5s.parquet"
    tasks = [f"Birdset{site}Classification", f"BirdsetClustering{site}"]
    if site == "POW":  # the XCM / XCL tasks score POW's windows
        pow_md5 = window_md5s(path)
        for x in ("XCM", "XCL"):
            assert window_md5s(root / f"birdset_{x}_test_5s.parquet") == pow_md5, f"{x} windows differ from POW"
            tasks += [f"Birdset{x}Classification", f"BirdsetClustering{x}"]
    rx = r"^(.*)_(\d+)_(\d+)\.\w+$"
    t = pl.read_parquet(path, columns=["filepath", "ebird_code_multilabel", "start_time", "end_time"]).with_row_index()
    t = t.with_columns(rec=pl.col("filepath").str.extract(rx, 1), a=pl.col("filepath").str.extract(rx, 2).cast(int),
                       b=pl.col("filepath").str.extract(rx, 3).cast(int))
    for (rec,), w in t.sort("rec", "a").group_by("rec", maintain_order=True):
        assert (w["a"][1:] == w["b"][:-1]).all(), f"{site} {rec}: windows do not tile"
        m = re.search(r"_(\d{8})_(\d{6})Z?$", rec)
        dt = m and f"{m[1][:4]}-{m[1][4:6]}-{m[1][6:]} {m[2][:2]}:{m[2][2:4]}:{m[2][4:]}"
        sub = grab(r"^[A-Z]{3}_\d+_(S\d+)_", rec)
        items = [row("MSEB", task, "test_5s", r["filepath"], f"birdset_{site.lower()}",
                     seg_start_s=r["a"] + r["start_time"], seg_end_s=r["a"] + r["end_time"],
                     orig_filename=r["filepath"], source_file=rec, rec_datetime=dt,
                     site=f"{site}/{sub}" if sub else site,
                     text=";".join(names[i] for i in r["ebird_code_multilabel"]) or None)
                 for task in tasks for r in w.iter_rows(named=True)]
        yield (partial(birdset_recording, str(path), w["index"].to_list(), w["a"].cast(pl.Float64).to_list()),
               "source_recording" if w.height > 1 else "item", items)


def fsd50k(dl):
    root = hf("Fhrozen/FSD50k", "ccf1acaff12f3f4a4c10052dddafbb6d22152c9b",
              ["labels/eval.csv", "metadata/eval_clips_info_FSD50K.json", "clips/eval/*"])
    info = json.loads((root / "metadata" / "eval_clips_info_FSD50K.json").read_text())
    for f, labels in pl.read_csv(root / "labels" / "eval.csv", infer_schema=False)[["fname", "labels"]].iter_rows():
        yield wav(root / "clips" / "eval" / f"{f}.wav"), "item", [row(
            "MSEB", task, "test", f, "fsd50k", freesound_id=int(f), orig_filename=info[f]["title"], text=labels)
            for task in ("FSD50KTestClassification", "FSD50KTestClustering")]


SVQ_TASKS = {  # task (locale filled in) -> membership columns of SVQ 2.0
    "SVQClustering{}": ("clusterings/speaker_gender", "clusterings/speaker_age", "clusterings/speaker_id"),
    "SVQ{}SpeakerGenderClassification": ("classifications/speaker_gender",),
    "SVQ{}ContinuousStability": ("stabilities/speech",),
    "SVQ{}QueryReranking": ("rerankings/query",),
    "SVQ{}SpanInLangReasoning": ("reasonings/span_in_lang",),
    "SVQ{}PassageInLangRetrieval": ("retrievals/passage_in_lang",),
    "SVQ{}DocumentInLangRetrievalSmallIndex": ("retrievals/document_in_lang",),
}


def svq(dl):
    root = hf("google/svq", "74f17ec92f0654860c160029d3542199626f63ef", ["2.0.0/utts_en_*.parquet"])
    member = {c for cs in SVQ_TASKS.values() for c in cs}
    cols = ["utt_id", "waveform", "locale", "environment", "text", "speaker_id", *member]
    for f in sorted((root / "2.0.0").glob("utts_en_*.parquet")):
        for r in pq.read_table(f, columns=cols).to_pylist():
            loc = r["locale"].title().replace("_", "")
            tasks = [t.format(loc) for t, c in SVQ_TASKS.items() if any(r[x] for x in c)
                     and (r["environment"] == "clean" or "Stability" not in t)]
            if tasks:
                yield wav(r["waveform"]["bytes"]), "item", [row(
                    "MSEB", t, "test", r["utt_id"], "svq", speaker_id=r["speaker_id"], text=r["text"]) for t in tasks]


# ---------------------------------------------------------------- MAEB(beta) via mteb (imported only here)

MAEB = {"BeijingOpera": "beijing_opera", "BirdCLEF": "birdclef25", "CREMADPairClassification": "crema_d",
        "CREMA_D": "crema_d", "CREMA_DClustering": "crema_d", "ClothoT2ARetrieval": "clotho",
        "CommonLanguageAgeDetection": "commonlanguage", "CommonVoiceMini21T2ARetrieval": "commonvoice21",
        "FSD2019Kaggle": "fsdkaggle2019", "FleursT2ARetrieval": "fleurs", "GTZANAudioReranking": "gtzan_genre",
        "GTZANGenre": "gtzan_genre", "GigaSpeechT2ARetrieval": "gigaspeech", "IEMOCAPGender": "iemocap",
        "JamAltArtistA2ARetrieval": "jamalt", "JamAltLyricA2TRetrieval": "jamalt", "MACST2ARetrieval": "macs",
        "MInDS14": "minds14", "MridinghamTonic": "mridangam", "NMSQAPairClassification": "nmsqa",
        "RavdessZeroshot": "ravdess", "SIBFLEURS": "sib_fleurs", "SpeechCommandsZeroshotv0.02": "speech_commands",
        "SpokenSQuADT2ARetrieval": "spoken_squad", "UrbanSound8KT2ARetrieval": "urbansound8k",
        "VehicleSoundClustering": "vehicle_sounds", "VoxCelebSA": "slue_voxceleb",
        "VoxPopuliAccentPairClassification": "voxpopuli", "VoxPopuliGenderClustering": "voxpopuli",
        "VoxPopuliLanguageID": "voxpopuli"}
MAEB_KEYS = {  # task -> (row, original file name, audio column, downloads) -> key columns
    "BeijingOpera": lambda r, fn, c, dl: dict(freesound_id=grab(r"^(\d+)__", fn, int)),
    "MridinghamTonic": lambda r, fn, c, dl: dict(freesound_id=grab(r"^(\d+)__", fn, int)),
    "FSD2019Kaggle": lambda r, fn, c, dl: dict(freesound_id=fsdkaggle2019(dl)[fn], text=";".join(r["sound"])),
    "CREMA_D": lambda r, fn, c, dl: dict(speaker_id=grab(r"^(\d{4})_", fn)),
    "CREMA_DClustering": lambda r, fn, c, dl: dict(speaker_id=grab(r"^(\d{4})_", fn)),
    "IEMOCAPGender": lambda r, fn, c, dl: dict(speaker_id=grab(r"^(Ses\d\d[MF])_", fn),
                                              source_file=grab(r"^(.*)_[^_]*$", r["file"])),
    "VoxCelebSA": lambda r, fn, c, dl: dict(speaker_id=grab(r"^(id\d+)_", fn),
                                           youtube_id=grab(r"^id\d+_(.{11})_", fn)),
    "BirdCLEF": lambda r, fn, c, dl: dict(xc_id=grab(r"xeno-canto\.org/(\d+)", r["url"], int), source_file=r["url"],
                                         text=f"{r['primary_label']} | {r['scientific_name']} | {r['common_name']}"),
    "CommonVoiceMini21T2ARetrieval": lambda r, fn, c, dl: dict(cv_path=fn),
    "CommonLanguageAgeDetection": lambda r, fn, c, dl: dict(cv_path=os.path.basename(r["path"])),
    "SIBFLEURS": lambda r, fn, c, dl: dict(speaker_id=str(r["speaker_id"]), source_file=r["URL"]),
    "MInDS14": lambda r, fn, c, dl: dict(source_file="/".join(r["path"].split("/")[-2:])),
    "NMSQAPairClassification": lambda r, fn, c, dl: dict(
        source_file=r["id"], speaker_id=r["question_audio_speaker" if c == "audio1" else "content_audio_speaker"],
        text=r["question_normalized_text" if c == "audio1" else "content_segment_normalized_text"]),
}
TEXT = ("sentence", "raw_transcription", "transcription", "text")


@cache
def fsdkaggle2019(dl):
    """FSDKaggle2019 test file name -> Freesound id (Zenodo 3612637 metadata)."""
    d = unpack(fetch(ZENODO.format(3612637, "FSDKaggle2019.meta.zip"), dl / "fsdkaggle2019" / "meta.zip"))
    f, = d.glob("**/test_post_competition.csv")
    return dict(pl.read_csv(f).select("fname", "freesound_id").iter_rows())


def linked_texts(x, role):
    """Retrieval split: id in `role` -> newline-joined texts of the items of the other side it is relevant to."""
    other = x["queries" if role == "corpus" else "corpus"]
    if "text" not in other.column_names:
        return {}
    text = dict(zip(map(str, other["id"]), other["text"]))
    out = {}
    for q, docs in x["relevant_docs"].items():
        for d in (d for d, s in docs.items() if s > 0):
            a, b = (d, q) if role == "corpus" else (q, d)
            out.setdefault(str(a), []).append(text[str(b)])
    return {k: "\n".join(dict.fromkeys(v)) for k, v in out.items()}


def maeb_tables(x, path=()):
    """(key path, table, linked texts or None) for every table of a loaded mteb dataset."""
    import datasets
    if isinstance(x, datasets.Dataset):
        yield path, x, None
    elif "corpus" in x:
        yield from ((path + (role,), x[role], linked_texts(x, role)) for role in ("corpus", "queries"))
    else:
        for k, v in x.items():
            yield from maeb_tables(v, path + (k,))


def maeb(name, dl):
    import datasets
    import mteb
    from mteb.abstasks.retrieval import AbsTaskRetrieval
    task, = [t for t in mteb.get_benchmark("MAEB(beta)").tasks if t.metadata.name == name]
    task.load_data()
    if isinstance(task, AbsTaskRetrieval):
        task.convert_v1_dataset_format_to_v2(None)
    splits = task.metadata.eval_splits
    inputs = {getattr(task, a, None) for a in ("input_column_name", "input1_column_name", "input2_column_name")}
    for path, d, linked in maeb_tables(task.dataset):
        split = next((k for k in path if k in splits), None)
        cols = [c for c, f in d.features.items()
                if isinstance(f, datasets.Audio) and (linked is not None or c in inputs)]
        if split is None or not cols or path[0] not in (split, *task.hf_subsets):
            continue
        lc = getattr(task, "label_column_name", None)
        label = d.features.get(lc)
        for c in cols:
            d = d.cast_column(c, datasets.Audio(decode=False))
        prefix = "" if path[0] in (split, "default") else f"{path[0]}/"
        for i, r in enumerate(d):
            for c in cols:
                names = (r[c]["path"], r.get("file"), r.get("filename"), r.get("path"))
                fn = next((os.path.basename(str(v)) for v in names if v), None)
                iid = prefix + str(r["id"] if "id" in r else fn or i) + (f":{c}" if len(cols) > 1 else "")
                text = linked.get(str(r["id"])) if linked is not None else next((r[k] for k in TEXT if r.get(k)), None)
                if text is None and label is not None:
                    text = label.int2str(r[lc]) if isinstance(label, datasets.ClassLabel) else str(r[lc])
                yield wav(r[c]["bytes"]), "item", [row(
                    "MAEB", name, split, iid, MAEB[name], orig_filename=fn,
                    **{"text": text, **MAEB_KEYS.get(name, lambda *_: {})(r, fn, c, dl)})]


# ---------------------------------------------------------------- registry of parts: (part name, eval_dataset, loader)

PARTS = [("clap_clotho", "clotho", clotho), ("clap_audiocaps", "audiocaps", audiocaps),
         ("clap_vggsound", "vggsound", vggsound),
         *[(f"hear_{t}", ds, partial(hear, t)) for t, ds in HEAR.items()],
         ("hear_librispeech_test_clean", "libricount", librispeech),
         ("hear_dcase2016_task2_events", "dcase2016_task2", dcase_events),
         *[(f"mseb_birdset_{s.lower()}", f"birdset_{s.lower()}", partial(birdset, s)) for s in SITES],
         ("mseb_fsd50k", "fsd50k", fsd50k), ("mseb_svq", "svq", svq),
         *[(f"maeb_{t}", ds, partial(maeb, t)) for t, ds in MAEB.items()]]
