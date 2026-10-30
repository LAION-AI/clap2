"""Caption clips with a short and a long caption from local servers: Qwen3-Omni on vLLM or MOSS-Audio on sglang."""
import argparse
import asyncio
import base64
import io
import json
import os
import time
from collections import defaultdict
from pathlib import Path

import httpx
import numpy as np
import polars as pl
import soundfile as sf
import torch

from common.audio import load
from common.tars import clip_id, merged, samples, save
from metadata_prompt import MODES, prompt
from prompts import SYSTEM

SR, SECONDS, ATTEMPTS = 16000, 120.0, 3
MODELS = {  # name: (checkpoint, max new tokens, requests in flight per server)
    "qwen": ("Qwen/Qwen3-Omni-30B-A3B-Instruct", 512, 512),
    "moss": ("OpenMOSS-Team/MOSS-Audio-8B-Thinking", 2000, 128),
}
INTERNAL = ("md5", "pcm_len", "tar", "key", "group", "has_model_caption", "text_len")  # stats columns kept out of the prompt
SCHEMA = {"type": "object", "properties": {"short": {"type": "string"}, "long": {"type": "string"}},
          "required": ["short", "long"], "additionalProperties": False}


def wav(x):
    """16-bit WAV data URI."""
    b = io.BytesIO()
    sf.write(b, np.clip(x, -1, 1), SR, format="WAV", subtype="PCM_16")
    return "data:audio/wav;base64," + base64.b64encode(b.getvalue()).decode()


class _Clips(torch.utils.data.IterableDataset):
    """Per tar: (output, clip id, route, request body) for each listed clip, then (output, None, clip count, None)."""

    def __init__(self, work, jobs, model, mode):
        self.work, self.jobs, self.model, self.mode = work, jobs, model, mode

    def __iter__(self):
        w = torch.utils.data.get_worker_info()
        for tar, keys, out in self.jobs[w.id :: w.num_workers]:
            rel = tar.with_suffix(".parquet")
            extra, n = merged([self.work / "stats" / rel, *(d / rel for d in sorted((self.work / "annotation").iterdir()))], INTERNAL), 0
            for key, audio, meta in samples(self.work / "collected" / tar):
                if key in keys:
                    cid = clip_id(tar, key)
                    del meta["group"]
                    text = prompt({**meta, **extra[cid]}, self.mode)
                    route, body = request(self.model, text, wav(load(audio, SR, SECONDS)))
                    yield out, cid, route, json.dumps(body).encode()
                    n += 1
            assert n == len(keys), f"{tar}: {len(keys) - n} listed clips not in the tar"
            yield out, None, n, None


def request(model, text, audio):
    """(route, JSON body) of one caption request: OpenAI chat with a JSON schema for Qwen, native /generate for MOSS."""
    name, tokens, _ = MODELS[model]
    sampling = {"temperature": 0.2, "top_p": 0.95}
    if model == "qwen":
        return "/v1/chat/completions", {
            "model": name, "max_tokens": tokens, **sampling,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": [
                {"type": "audio_url", "audio_url": {"url": audio}}, {"type": "text", "text": text}]}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "caption", "schema": SCHEMA}}}
    return "/generate", {"text": f"<|audio_bos|><|AUDIO|><|audio_eos|>\n{SYSTEM}\n\n{text}", "audio_data": [audio],
                         "sampling_params": {"max_new_tokens": tokens, **sampling}}


def reply(model, response):
    """Answer text of a server response, without MOSS's reasoning trace."""
    if model == "qwen":
        return response["choices"][0]["message"]["content"]
    return response["text"].rsplit("</think>", 1)[-1]


def parse(text):
    """{'short', 'long'} if the text is exactly a JSON object with these two non-empty strings, else None."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    ok = isinstance(obj, dict) and sorted(obj) == ["long", "short"] and all(
        isinstance(v, str) and v.strip() for v in obj.values())
    return {k: v.strip() for k, v in obj.items()} if ok else None


def write(out, rows, n, model):
    """Write the captions of one tar."""
    assert n - len(rows) <= 1 + n // 100, f"{out}: {n - len(rows)} of {n} clips without valid JSON in {ATTEMPTS} tries"
    cols = {"clip_id": pl.String, "short_caption": pl.String, "long_caption": pl.String}
    df = pl.DataFrame(rows, schema=cols, orient="row").with_columns(captioning_model=pl.lit(MODELS[model][0]))
    save(df.sort("clip_id"), out)


def caption(loader, model, servers):
    """Send every clip to the least busy server and write each tar once all its clips have returned."""
    loop, http = asyncio.new_event_loop(), httpx.AsyncClient(timeout=900, limits=httpx.Limits(max_connections=None))
    busy, pending, limit = dict.fromkeys(servers, 0), set(), MODELS[model][2] * len(servers)
    rows, left, total, start, captioned = defaultdict(list), defaultdict(int), {}, time.time(), 0

    def finish(out):
        nonlocal captioned
        if out in total and not left[out]:
            write(out, rows.pop(out, []), total[out], model)
            captioned += total.pop(out)
            print(f"{out}: {captioned / (time.time() - start):.1f} clips/s", flush=True)

    async def one(out, cid, route, body):
        server = min(busy, key=busy.get)
        busy[server] += 1
        for _ in range(ATTEMPTS):
            r = await http.post(server + route, content=body, headers={"content-type": "application/json"})
            r.raise_for_status()
            if c := parse(reply(model, r.json())):
                rows[out].append((cid, c["short"], c["long"]))
                break
        busy[server] -= 1
        left[out] -= 1
        finish(out)

    def drain(n):
        """Run the requests for one loop step, or until at most n are pending."""
        nonlocal pending
        while pending:
            done, pending = loop.run_until_complete(asyncio.wait(
                pending, timeout=None if len(pending) > n else 0, return_when=asyncio.FIRST_COMPLETED))
            for t in done:
                t.result()
            if len(pending) <= n:
                break

    for out, cid, route, body in loader:
        if cid is None:  # end of a tar; route holds its clip count
            total[out] = route
            finish(out)
            continue
        left[out] += 1
        pending.add(loop.create_task(one(out, cid, route, body)))
        drain(limit - 1)
    drain(0)
    loop.run_until_complete(http.aclose())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    ap.add_argument("--model", choices=MODELS, required=True)
    ap.add_argument("--clips", type=Path, required=True, help="parquet: tar (relative to WORK/collected), key")
    ap.add_argument("--mode", choices=MODES, default="raw", help="clip metadata appended to the prompt")
    ap.add_argument("--out", type=Path, help="default WORK/captions")
    ap.add_argument("--servers", nargs="+", default=os.environ.get("CAPTION_SERVERS", "").split())
    ap.add_argument("--workers", type=int, default=16, help="decode processes")
    a = ap.parse_args()
    assert a.servers, "no servers: pass --servers or run under serve.sh"
    out = a.out or a.work / "captions"
    groups = pl.read_parquet(a.clips).sort("tar").group_by("tar", maintain_order=True)
    jobs = [(Path(t), set(g["key"]), out / Path(t).with_suffix(".parquet")) for (t,), g in groups]
    jobs = [j for j in jobs if not j[2].exists()]
    loader = torch.utils.data.DataLoader(_Clips(a.work, jobs, a.model, a.mode), batch_size=None, prefetch_factor=16,
                                         num_workers=max(1, min(a.workers, len(jobs))), in_order=False,
                                         multiprocessing_context="spawn")
    caption(loader, a.model, a.servers)


if __name__ == "__main__":
    main()
