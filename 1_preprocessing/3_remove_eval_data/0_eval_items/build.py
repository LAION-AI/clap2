"""Build the evaluation-item registry: every eval audio as 16 kHz int16 PCM (deduplicated by md5) plus item tables."""
import argparse
import collections
import hashlib
import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import polars as pl
import soxr

from common.tars import CPUS, save
from sources import ITEM, PARTS

SR = 16000
CANON = ["fsd50k", "fsdkaggle2019", "esc50", "urbansound8k", "clotho", "audiocaps", "vggsound", "gtzan_genre",
         "gtzan_music_speech", "nsynth", "mridangam", "beijing_opera", "vocal_imitation", "gunshot_triangulation",
         "beehive", "dcase2016_task2", "maestro", "libricount", "speech_commands", "crema_d", "ravdess", "iemocap",
         "voxlingua107", "slue_voxceleb", "voxpopuli", "minds14", "commonvoice21", "commonlanguage", "fleurs",
         "sib_fleurs", "gigaspeech", "spoken_squad", "nmsqa", "jamalt", "macs", "vehicle_sounds", "birdclef25",
         "birdset_per", "birdset_nes", "birdset_uhh", "birdset_hsn", "birdset_nbp", "birdset_pow", "birdset_ssw",
         "birdset_sne", "svq"]
AUDIO = {"n_samples": pl.Int64, "orig_sr": pl.Int32, "kind": pl.String, "eval_dataset": pl.String, "md5_16k": pl.String}


def pcm16(job):
    """Decode job -> (16 kHz mono int16 bytes, original rate, md5): channel mean, soxr VHQ, round and clip."""
    x, sr = job()
    y = soxr.resample(x.mean(1, dtype=np.float32), sr, SR, "VHQ")
    b = np.clip(np.round(y.astype(np.float64) * 32768), -32768, 32767).astype("<i2").tobytes()
    assert b, "empty audio"
    return b, sr, hashlib.md5(b).hexdigest()


def ordered(ex, jobs, window):
    """(loader tuple, pcm16 result) in loader order with at most `window` decodes in flight."""
    q = collections.deque()
    for j in jobs:
        q.append((j, ex.submit(pcm16, j[0])))
        if len(q) >= window:
            j, f = q.popleft()
            yield j, f.result()
    for j, f in q:
        yield j, f.result()


def build_part(name, loader, dl, parts, ex, window):
    """Decode one source into parts/<name>.{i16,audio.parquet,parquet}; the items parquet marks it done."""
    audio, items = [], []
    with open(parts / f"{name}.i16.part", "wb") as f:
        for (_, kind, rows), (pcm, sr, md5) in ordered(ex, loader(dl), window):
            f.write(pcm)
            items += [dict(r, audio=len(audio)) for r in rows]
            audio.append(dict(n_samples=len(pcm) // 2, orig_sr=sr, kind=kind, eval_dataset=rows[0]["eval_dataset"],
                              md5_16k=md5))
    assert audio and items, name
    os.replace(parts / f"{name}.i16.part", parts / f"{name}.i16")
    save(pl.DataFrame(audio, schema=AUDIO), parts / f"{name}.audio.parquet")
    save(pl.DataFrame(items, schema=ITEM | {"audio": pl.Int32}), parts / f"{name}.parquet")
    print(f"[{name}] {len(audio)} audios, {len(items)} items, {sum(a['n_samples'] for a in audio) / SR / 3600:.2f} h",
          flush=True)


def merge(names, parts, out):
    """Concatenate the parts in order into the store; identical PCM (md5) becomes one eval audio."""
    ids, index, tabs = {}, [], []
    with open(out / "audio_16k.i16.part", "wb") as f:
        for name in names:
            a = pl.read_parquet(parts / f"{name}.audio.parquet")
            pcm = np.memmap(parts / f"{name}.i16", "<i2", "r")
            off = np.concatenate([[0], np.cumsum(a["n_samples"].to_numpy())])
            assert off[-1] == pcm.size, name
            gid = []
            for i, r in enumerate(a.iter_rows(named=True)):
                band = min(r["orig_sr"] // 2, 8000)
                if r["md5_16k"] not in ids:
                    ids[r["md5_16k"]] = len(index)
                    index.append(dict(r, eval_audio_id=len(index), band_hz=band))
                    f.write(pcm[off[i]:off[i + 1]].tobytes())
                g = index[ids[r["md5_16k"]]]
                assert g["n_samples"] == r["n_samples"]
                g["band_hz"] = min(g["band_hz"], band)
                g["kind"] = "item" if "item" in (g["kind"], r["kind"]) else g["kind"]
                gid.append(g["eval_audio_id"])
            t = pl.read_parquet(parts / f"{name}.parquet")
            tabs.append(t.with_columns(eval_audio_id=pl.Series(np.asarray(gid, np.int32)[t["audio"].to_numpy()])))
    idx = pl.DataFrame(index).with_columns(
        offset=pl.col("n_samples").cum_sum().shift(1, fill_value=0)).select(
        pl.col("eval_audio_id").cast(pl.Int32), "offset", "n_samples", pl.col("orig_sr", "band_hz").cast(pl.Int32),
        "kind", "eval_dataset", "md5_16k")
    assert os.path.getsize(out / "audio_16k.i16.part") == 2 * idx["n_samples"].sum()
    items = pl.concat(tabs).join(idx.select("eval_audio_id", dur=pl.col("n_samples") / SR), on="eval_audio_id",
                                     maintain_order="left")
    items = items.with_columns(seg_start_s=pl.col("seg_start_s").fill_null(0.0),
                               seg_end_s=pl.col("seg_end_s").fill_null(pl.col("dur")))
    # nominal window ends may overrun the decoded length by a few ms
    assert (items["seg_start_s"] >= 0).all() and (items["seg_end_s"] <= items["dur"] + 0.01).all()
    items = items.with_columns(seg_end_s=pl.min_horizontal("seg_end_s", "dur"))
    first = ["suite", "task", "split", "item_id", "eval_dataset", "scored", "role", "eval_audio_id"]
    items = items.select(*first, pl.exclude(*first, "audio", "dur"))
    os.replace(out / "audio_16k.i16.part", out / "audio_16k.i16")
    save(idx, out / "audio_index.parquet")
    save(items, out / "items.parquet")
    hours = idx.group_by("eval_dataset").agg(hours=pl.col("n_samples").sum() / SR / 3600)
    with pl.Config(tbl_rows=-1):
        print(items.group_by("eval_dataset", maintain_order=True).agg(
            n_items=pl.col("scored").sum(), n_rows=pl.len(), n_audios=pl.col("eval_audio_id").n_unique()).join(
            hours, on="eval_dataset", how="left", maintain_order="left"))
    print(f"{idx.height} unique audios, {idx['n_samples'].sum() / SR / 3600:.1f} h, {items.height} item rows")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--downloads", type=Path, required=True, help="download folder (archives, HF cache)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", help="comma-separated eval datasets (default: all)")
    ap.add_argument("--workers", type=int, default=CPUS)
    a = ap.parse_args()
    if (a.out / "items.parquet").exists():  # written last by merge
        return
    dl = a.downloads.resolve()
    os.environ["HF_HUB_CACHE"] = str(dl / "hf" / "hub")  # before any Hugging Face import
    os.environ["HF_DATASETS_CACHE"] = str(dl / "hf" / "datasets")
    only = set(a.only.split(",")) if a.only else set(CANON)
    assert only <= set(CANON), only - set(CANON)
    todo = sorted([p for p in PARTS if p[1] in only], key=lambda p: CANON.index(p[1]))
    parts = a.out / "parts"
    parts.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(a.workers, mp_context=mp.get_context("spawn")) as ex:
        for name, _, loader in todo:
            if not (parts / f"{name}.parquet").exists():
                build_part(name, loader, dl, parts, ex, 2 * a.workers)
    merge([name for name, _, _ in todo], parts, a.out)


if __name__ == "__main__":
    main()
