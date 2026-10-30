"""Six-way judge: Gemini scores and ranks the long captions of two captioners x three prompt modes for each clip."""
import argparse
import hashlib
import json
import random
import sys
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polars as pl

from common.tars import clip_id, save

sys.path.insert(0, str(Path(__file__).parents[1] / "captioner_comparison"))
from judge import ask, client  # noqa: E402

VARIANTS = [f"{m}/{p}" for m in ("qwen", "moss") for p in ("none", "raw", "natural")]
DIMENSIONS = ("accuracy", "completeness", "temporal_detail", "specificity", "writing")
SYSTEM = """You are an expert, impartial evaluator of audio captions.
Judge only how useful each caption is as a faithful description of the supplied
audio. Candidate IDs are arbitrary and their order carries no information.

For every candidate:
- accuracy: Are claimed sources, events, speech, music, and acoustic attributes
  supported by the audio? Penalize contradictions and hallucinated specifics.
- completeness: Does it cover the important audible content without requiring
  every insignificant detail?
- temporal_detail: Does it correctly describe ordering, changes, and overlap?
- specificity: Is it informative and appropriately specific, rather than vague?
- writing: Is it clear, direct, non-repetitive prose without meta-commentary?

Use integer scores from 1 (very poor) to 5 (excellent). Accuracy is the most
important criterion. A concise caption may beat a longer one; never reward
length itself. Give all candidates a strict rank from 1 (best) to N (worst).
Do not infer quality from stylistic similarity between candidates."""
SCORE = {"type": "integer", "minimum": 1, "maximum": 5}
SCHEMA = {"type": "object", "required": ["evaluations", "best_caption_reason"], "properties": {
    "evaluations": {"type": "array", "items": {
        "type": "object", "required": ["candidate_id", *DIMENSIONS, "rank", "major_error"],
        "properties": {"candidate_id": {"type": "string"}, **dict.fromkeys(DIMENSIONS, SCORE),
                       "rank": {"type": "integer", "minimum": 1}, "major_error": {"type": "string"}}}},
    "best_caption_reason": {"type": "string"}}}


def valid(reply, ids):
    """True if the reply scores (1-5) and strictly ranks exactly the candidates `ids`."""
    ev = reply.get("evaluations") if isinstance(reply, dict) else None
    if not (isinstance(ev, list) and len(ev) == len(ids) and all(isinstance(e, dict) for e in ev)):
        return False
    ranks = {e.get("rank") for e in ev}
    return ({e.get("candidate_id") for e in ev} == set(ids) and ranks == set(range(1, len(ev) + 1))
            and all(isinstance(e.get(d), int) and 1 <= e[d] <= 5 for e in ev for d in DIMENSIONS)
            and isinstance(reply.get("best_caption_reason"), str))


def score(gemini, audio, clip, captions, seed):
    """Rows (one per candidate) of the judgment of one clip; none if the reply is malformed."""
    order = VARIANTS.copy()
    random.Random(int.from_bytes(hashlib.sha256(f"{seed}:{clip}".encode()).digest()[:8], "big")).shuffle(order)
    ids = [f"C{i + 1}" for i in range(len(order))]
    text = "\n".join(["Rank all candidate captions for this audio. Evaluate every candidate."]
                     + [f"\n[{i}]\n{captions[v]}" for i, v in zip(ids, order)])
    reply = ask(gemini, audio, text, system_instruction=SYSTEM, response_schema=SCHEMA, max_output_tokens=2048)
    if not valid(reply, ids):
        return []
    variant = dict(zip(ids, order))
    return [{"clip": clip, **dict(zip(("model", "mode"), variant[e["candidate_id"]].split("/"))),
             "candidate": e["candidate_id"], "caption": captions[variant[e["candidate_id"]]],
             **{k: e[k] for k in ("rank", *DIMENSIONS, "major_error")}, "reason": reply["best_caption_reason"]}
            for e in reply["evaluations"]]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    ap.add_argument("--clips", type=Path, required=True, help="parquet: tar (relative to WORK/collected), key")
    ap.add_argument("--captions", type=Path, required=True, help="caption.py outputs in <model>/<mode>/**.parquet")
    ap.add_argument("--out", type=Path, required=True, help="judgments.jsonl (resumable); .parquet goes next to it")
    ap.add_argument("--seed", type=int, default=20260731)
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    caps = {}
    for v in VARIANTS:
        table = pl.read_parquet(a.captions / v / "**" / "*.parquet", columns=["clip_id", "long_caption"])
        for cid, text in table.rows():
            caps.setdefault(cid, {})[v] = text
    done = {json.loads(line)["clip"] for line in open(a.out)} if a.out.exists() else set()
    clips = [(t, k) for t, k in pl.read_parquet(a.clips).select("tar", "key").iter_rows()
             if len(caps.get(cid := clip_id(t, k), {})) == len(VARIANTS) and cid not in done]
    print(f"{len(clips)} clips to judge")

    def one(tar, key):
        with tarfile.open(a.work / "collected" / tar) as t:
            audio = t.extractfile(f"{key}.flac").read()
        cid = clip_id(tar, key)
        return {"clip": cid, "rows": score(gemini, audio, cid, caps[cid], a.seed)}

    gemini = client()
    with ThreadPoolExecutor(a.workers) as ex, open(a.out, "a") as f:
        for r in [ex.submit(one, t, k) for t, k in clips]:
            f.write(json.dumps(r.result(), ensure_ascii=False) + "\n")
            f.flush()
    rows = pl.read_ndjson(a.out).explode("rows").drop_nulls("rows").select(pl.col("rows").struct.unnest())
    save(rows, a.out.with_suffix(".parquet"))


if __name__ == "__main__":
    main()
