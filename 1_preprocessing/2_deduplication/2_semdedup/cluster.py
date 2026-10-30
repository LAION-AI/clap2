"""SemDeDup: faiss k-means of pool clips >= 2 s on unit Dasheng embeddings, cosine >= 0.995 groups inside clusters."""
import argparse
from pathlib import Path

import faiss
import numpy as np
import polars as pl
import torch

from common.keep import COLUMNS, removed_linked
from common.tars import save

MIN_SECONDS = 2.0
PER_CLUSTER, MAX_K = 2000, 65536
TRAIN = 20_000_000
COSINE = 0.995
CAP = 20_000
STEP = 1_000_000


def unit(v):
    v = v.astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def removals(work, *steps):
    """clip_ids removed by the given dedup steps."""
    return pl.concat([pl.read_parquet(work / "dedup" / f"{step}.parquet", columns=["clip_id"]) for step in steps])


def screened(work):
    """Clips SemDeDup compares: valid, kept by exact and fingerprint matching, at least MIN_SECONDS; sorted by audio_id."""
    valid = pl.read_parquet(work / "valid.parquet", columns=[*COLUMNS, "duration"])
    return (valid.join(removals(work, "exact", "fingerprint"), on="clip_id", how="anti")
            .filter(pl.col("duration") >= MIN_SECONDS).select(COLUMNS).sort("audio_id"))


def embeddings(folder, ids):
    """fp16 embeddings of the sorted audio_ids `ids`, from the per-tar parquets."""
    df = (pl.scan_parquet(folder / "**" / "*.parquet").select("audio_id", "emb")
          .filter(pl.col("audio_id").is_in(pl.Series(ids).implode())).sort("audio_id").collect())
    assert np.array_equal(df["audio_id"].to_numpy(), ids), "embeddings missing for some pool clips"
    return df["emb"].to_numpy()


def kmeans(emb, seed=0):
    """Nearest-centroid index of every row: faiss k-means on the GPU, k = min(65536, N // 2000), 20 iterations."""
    k = max(1, min(MAX_K, len(emb) // PER_CLUSTER))
    train = np.sort(np.random.default_rng(seed).choice(len(emb), min(len(emb), TRAIN), replace=False))
    km = faiss.Kmeans(emb.shape[1], k, niter=20, seed=seed, gpu=True, max_points_per_centroid=TRAIN)
    km.train(unit(emb[train]))
    return np.concatenate([km.index.search(unit(emb[i : i + STEP]), 1)[1][:, 0] for i in range(0, len(emb), STEP)])


def pairs(emb, cluster, device, seed=0):
    """(2, P) row pairs inside one cluster with cosine >= COSINE; clusters above CAP are subsampled to CAP members."""
    rng = np.random.default_rng(seed)
    order = np.argsort(cluster, kind="stable")
    out = [np.zeros((2, 0), np.int64)]
    for members in np.split(order, np.flatnonzero(np.diff(cluster[order])) + 1):
        if members.size > CAP:
            members = np.sort(rng.choice(members, CAP, replace=False))
        v = torch.from_numpy(unit(emb[members])).to(device)
        i, j = torch.nonzero(torch.triu(v @ v.T >= COSINE, 1), as_tuple=True)
        out.append(members[np.stack([i.cpu().numpy(), j.cpu().numpy()])])
    return np.concatenate(out, axis=1)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("work", type=Path)
    args = p.parse_args()
    if (args.work / "pool_dedup.parquet").exists():
        return
    clips = screened(args.work)
    ids = clips["audio_id"].to_numpy()
    emb = embeddings(args.work / "semdedup", ids)
    if not (args.work / "clusters.parquet").exists():
        cluster = kmeans(emb)
        save(clips.select("clip_id", cluster=cluster, cluster_size=np.bincount(cluster)[cluster]),
             args.work / "clusters.parquet")
    clusters = pl.read_parquet(args.work / "clusters.parquet")
    assert clusters["clip_id"].equals(clips["clip_id"]), "clusters.parquet is stale"
    a, b = ids[pairs(emb, clusters["cluster"].to_numpy(), "cuda")]
    out = removed_linked(clips, a, b)
    save(out, args.work / "dedup" / "semdedup.parquet")
    pool = pl.read_parquet(args.work / "valid.parquet").join(removals(args.work, "exact", "fingerprint", "semdedup"),
                                                             on="clip_id", how="anti")
    save(pool, args.work / "pool_dedup.parquet")
    print(f"semdedup: {a.size:,} pairs, {out.height:,} of {clips.height:,} clips removed", flush=True)


if __name__ == "__main__":
    main()
