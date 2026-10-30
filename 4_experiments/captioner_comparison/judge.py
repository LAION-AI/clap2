"""Listwise LLM judge: Gemini hears a clip and ranks the seven captioners' short (or long) captions, best first."""
import argparse
import json
import os
import random
import string
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polars as pl
from google import genai
from google.genai import types

from analyze import MODELS
from common.tars import save

JUDGE = "gemini-3.6-flash"
PROMPT = """You will hear an audio clip and read {n} descriptions of it, labeled {labels}.
Rank all {n} from best to worst at describing what is ACTUALLY AUDIBLE in the clip.

Priorities, in strict order:
1. Faithfulness: penalize any sound, speaker, word, event, or environment that is claimed but NOT audible (invented content is the worst failure).
2. Coverage: reward describing the salient audible events, their order, and changes over time.
3. Specificity: reward concrete, discriminative acoustic detail over generic filler.

Explicitly IGNORE: length, writing style, formatting, and eloquence. A shorter accurate description beats a longer one with any invented content.

Return ONLY JSON: {{"ranking": ["<best label>", ..., "<worst label>"], "reason": "<one sentence>"}}
The ranking must list all {n} labels exactly once, best first."""
SCHEMA = {"key": pl.String, "ctype": pl.String, "perm": pl.Int8, "slots": pl.List(pl.String),
          "ranking": pl.List(pl.String), "reason": pl.String}


def client():
    """Gemini client (GEMINI_API_KEY) that retries rate limits and server errors."""
    retry = types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=8))
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=retry)


def ask(gemini, audio, text, **config):
    """JSON reply of Gemini (low thinking) to FLAC audio plus a text prompt, or None if the reply is not JSON."""
    r = gemini.models.generate_content(
        model=JUDGE, contents=[types.Part.from_bytes(data=audio, mime_type="audio/flac"), text],
        config=types.GenerateContentConfig(response_mime_type="application/json",
                                           thinking_config=types.ThinkingConfig(thinking_level="low"), **config))
    try:
        return json.loads(r.text)
    except (TypeError, json.JSONDecodeError):
        return None


def rank(gemini, audio, key, ctype, perm, captions, seed):
    """Judge record for the clip at path `audio`; ranking is None unless the reply is a permutation of the labels."""
    slots = MODELS.copy()
    random.Random(f"{seed}|{key}|{ctype}|{perm}").shuffle(slots)
    labels = string.ascii_uppercase[:len(slots)]
    text = PROMPT.format(n=len(slots), labels=", ".join(labels)) + "".join(
        f"\n\nDescription {label}:\n{captions[m]}" for label, m in zip(labels, slots))
    reply = ask(gemini, audio.read_bytes(), text, temperature=0.0)
    got = reply.get("ranking") if isinstance(reply, dict) else None
    ok = isinstance(got, list) and sorted(map(str, got)) == list(labels)
    return {"key": key, "ctype": ctype, "perm": perm, "slots": slots,
            "ranking": [slots[labels.index(str(x))] for x in got] if ok else None,
            "reason": reply.get("reason") if isinstance(reply, dict) else None}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--captions", type=Path, required=True, help="parquet: key, model, short, long")
    ap.add_argument("--audio", type=Path, required=True, help="folder of <key>.flac (16 kHz mono)")
    ap.add_argument("--out", type=Path, required=True, help="judge.jsonl (resumable); judge.parquet goes next to it")
    ap.add_argument("--perm", type=int, default=0, help="index of the seeded caption order")
    ap.add_argument("--seed", type=int, default=20260729)
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    caps = pl.read_parquet(a.captions)
    assert set(caps["model"]) == set(MODELS)
    done = {(r["key"], r["ctype"], r["perm"]) for r in map(json.loads, open(a.out))} if a.out.exists() else set()
    todo = [(k, c, g) for (k,), g in caps.sort("key").group_by("key", maintain_order=True) for c in ("short", "long")
            if (k, c, a.perm) not in done]
    gemini = client()
    with ThreadPoolExecutor(a.workers) as ex, open(a.out, "a") as f:
        jobs = [ex.submit(rank, gemini, a.audio / f"{k}.flac", k, c, a.perm,
                          dict(zip(g["model"], g[c])), a.seed) for k, c, g in todo]
        for j in jobs:
            f.write(json.dumps(j.result(), ensure_ascii=False) + "\n")
            f.flush()
    save(pl.read_ndjson(a.out, schema=SCHEMA), a.out.with_suffix(".parquet"))


if __name__ == "__main__":
    main()
