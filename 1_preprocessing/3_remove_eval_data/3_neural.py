"""Neural fingerprint (M4): 1 s windows of 16 kHz audio -> 128-d embeddings (laion/neural-audio-fingerprint);
`embed` builds the eval index (windows every 0.25 s), `scan` embeds every corpus clip (every 0.5 s), finds chains of
consecutive windows above the cosine threshold at one offset, verifies them with V and writes one parquet per tar.
One process per GPU: --part i/n."""
import argparse
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from huggingface_hub import hf_hub_download

from common.tars import save, todo
from fpscan import SR, EvalStore, Lib, frame, pipelined
from gpusearch import BN, pad_rows, search

WIN, EVAL_HOP, CORPUS_HOP = 16000, 4000, 8000
TAU = 0.90            # cosine threshold of a window match
STRICT_MAX_S = 1.5    # eval audios up to this long may match with a single window
OFF_TOL_S = 0.25      # windows of one chain agree on the offset within this
REL_DB, FLOOR_DB = -60.0, -90.0  # windows below max(FLOOR_DB, the clip's loudest window + REL_DB) are skipped


class LogMel(nn.Module):
    """64-band log-mel (25 ms / 10 ms), 100 frames per window, normalised to the window's mean power."""

    def __init__(self, n_fft=512, win=400, hop=160):
        super().__init__()
        import torchaudio

        self.n_fft, self.win, self.hop = n_fft, win, hop
        n, k = torch.arange(win, dtype=torch.float64), torch.arange(n_fft // 2 + 1, dtype=torch.float64)
        w = torch.hann_window(win, periodic=True, dtype=torch.float64)
        ang = 2 * math.pi * (n[:, None] + (n_fft - win) // 2) * k[None, :] / n_fft
        self.register_buffer("basis", torch.cat([w[:, None] * torch.cos(ang), -w[:, None] * torch.sin(ang)], 1).float(), persistent=False)
        self.register_buffer("fb", torchaudio.functional.melscale_fbanks(n_fft // 2 + 1, 30.0, 8000.0, 64, SR, "slaney", "slaney"),
                             persistent=False)

    def forward(self, x):
        off, nf = (self.n_fft - self.win) // 2, self.fb.shape[0]
        fr = F.pad(x.float().unsqueeze(1), (self.n_fft // 2,) * 2, mode="reflect").squeeze(1).unfold(-1, self.n_fft, self.hop)
        dt = torch.bfloat16 if torch.is_autocast_enabled() else torch.float32
        X = (fr[:, :100, off:off + self.win].to(dt) @ self.basis.to(dt)).float()
        M = (X[..., :nf].square() + X[..., nf:].square()) @ self.fb
        return torch.log(M / M.mean(dim=(1, 2), keepdim=True).clamp_min(1e-12) + 1e-5) * 0.25


class Block(nn.Module):
    """Pre-LN transformer block."""

    def __init__(self, d, heads, ffn):
        super().__init__()
        self.h = heads
        self.ln1, self.qkv, self.proj = nn.LayerNorm(d), nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.ln2, self.fc1, self.fc2 = nn.LayerNorm(d), nn.Linear(d, ffn * d), nn.Linear(ffn * d, d)

    def forward(self, x):
        B, T, D = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(B, T, 3, self.h, D // self.h).permute(2, 0, 3, 1, 4)
        x = x + self.proj(F.scaled_dot_product_attention(q, k, v).transpose(1, 2).reshape(B, T, D))
        return x + self.fc2(F.gelu(self.fc1(self.ln2(x)), approximate="tanh"))


class Fingerprint(nn.Module):
    """log-mel -> 25 patches of 4 frames -> transformer -> mean + max pooling -> 128-d unit vector."""

    def __init__(self, d, layers, heads, ffn, dim_out, **_):
        super().__init__()
        self.front, self.patch = LogMel(), nn.Linear(4 * 64, d)
        self.pos = nn.Parameter(torch.zeros(1, 25, d))
        self.enc = nn.Sequential(*[Block(d, heads, ffn) for _ in range(layers)])
        self.norm = nn.LayerNorm(d)
        self.head = nn.Sequential(nn.Linear(2 * d, 2 * d), nn.GELU(), nn.Linear(2 * d, dim_out))

    def forward(self, x):
        z = self.norm(self.enc(self.patch(self.front(x).reshape(x.shape[0], 25, 4 * 64)) + self.pos))
        return F.normalize(self.head(torch.cat([z.mean(1), z.amax(1)], -1)).float(), dim=-1)


def load_model(device):
    """The released fingerprint model."""
    ck = torch.load(hf_hub_download("laion/neural-audio-fingerprint", "model.pt"), map_location="cpu", weights_only=False)
    assert ck["cfg"]["arch"] == "FPTransformer" and ck["cfg"]["stem"] == "patch" and ck["cfg"]["block"] == "fused", ck["cfg"]
    m = Fingerprint(**ck["cfg"])
    m.load_state_dict(ck["model"])
    return m.to(device).eval()


@torch.no_grad()
def embed(model, x, batch=8192):
    """(B, 16000) float -> (B, 128) fp16."""
    with torch.autocast("cuda", dtype=torch.bfloat16):
        return torch.cat([model(x[i:i + batch]).half() for i in range(0, len(x), batch)]) if len(x) else x.new_zeros(0, 128).half()


def windows(n, hop):
    """(signal index, start) of the 1 s windows: every hop plus an end-aligned one if >= 50 ms are left over;
    signals shorter than 1 s get one zero-padded window."""
    ci, st = [], []
    for i, k in enumerate(n):
        s = np.arange(0, max(k - WIN, 0) + 1, hop)
        if k >= WIN and k - WIN - s[-1] >= 800:
            s = np.append(s, k - WIN)
        ci.append(np.full(len(s), i)), st.append(s)
    return np.concatenate(ci), np.concatenate(st)


@torch.no_grad()
def embedded(model, pcm, off, n, hop, device, group_s=20000):
    """Embeddings of the kept 1 s windows (silence rule) of signals at off / n in the float GPU buffer pcm, in groups
    of signals of <= group_s seconds -> (signal, start, embeddings)."""
    out, g0 = [], 0
    for g1 in [*np.flatnonzero(np.diff(np.cumsum(n) // (group_s * SR))) + 1, len(n)]:
        ci, st, x = windows_kept(pcm, off[g0:g1], n[g0:g1], hop, device)
        out.append((ci + g0, st, embed(model, x)))
        g0 = g1
    return np.concatenate([o[0] for o in out]), np.concatenate([o[1] for o in out]), torch.cat([o[2] for o in out])


@torch.no_grad()
def windows_kept(pcm, off, n, hop, device):
    """1 s windows of signals at off / n in the GPU buffer pcm, with the silence rule -> (signal, start, windows)."""
    ci, st = windows(n, hop)
    pos = torch.from_numpy(st)[:, None].to(device) + torch.arange(WIN, device=device)[None, :]
    ok = pos < torch.from_numpy(n[ci])[:, None].to(device)
    x = pcm[(torch.from_numpy(off[ci])[:, None].to(device) + pos).clamp(max=pcm.numel() - 1)].float() * ok
    db = 10 * torch.log10(x.square().mean(1) + 1e-20)
    c = torch.from_numpy(ci).to(device)
    ref = torch.full((len(n),), -300.0, device=device).scatter_reduce(0, c, db, reduce="amax")
    keep = (db >= torch.clamp(ref[c] + REL_DB, min=FLOOR_DB)).cpu().numpy()
    return ci[keep], st[keep], x[torch.from_numpy(keep).to(device)]


def chains(clip, k, off, score, t_c, aid, eval_dur):
    """Best chain per (clip, eval audio): >= 2 consecutive corpus windows above TAU at one offset (+- OFF_TOL_S), or
    one window for eval audios <= STRICT_MAX_S -> list of (clip, aid, offset_s, score, n_support, c0, c1)."""
    out = []
    o = np.lexsort((k, aid, clip))
    clip, k, off, score, t_c, aid = clip[o], k[o], off[o], score[o], t_c[o], aid[o]
    for g in np.split(np.arange(len(o)), np.flatnonzero((np.diff(clip) != 0) | (np.diff(aid) != 0)) + 1):
        if not len(g):
            continue
        L, prev = np.ones(len(g), int), np.full(len(g), -1)
        for i in range(len(g)):
            j = np.flatnonzero((k[g] == k[g[i]] - 1) & (np.abs(off[g] - off[g[i]]) <= OFF_TOL_S))
            if len(j):
                prev[i] = j[np.argmax(L[j])]
                L[i] = L[prev[i]] + 1
        i = int(np.argmax(L + 1e-3 * score[g]))
        ch = [i]
        while prev[ch[-1]] >= 0:
            ch.append(prev[ch[-1]])
        ch = g[ch[::-1]]
        if len(ch) >= 2 or eval_dur[aid[g[0]]] <= STRICT_MAX_S:
            out.append((clip[g[0]], aid[g[0]], float(np.median(off[ch])), float(score[ch].max()), len(ch), t_c[ch[0]], t_c[ch[-1]] + 1.0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=["embed", "scan"])
    ap.add_argument("work", type=Path)
    ap.add_argument("--part", default="0/1")
    a = ap.parse_args()
    i, n = map(int, a.part.split("/"))
    idx = a.work / "eval/neural_index"
    part = idx / f"part{i}of{n}.npz"
    pairs = todo(a.work / "collected", a.work / "eval/neural", ".parquet", a.part)
    if (a.cmd == "embed" and part.exists()) or (a.cmd == "scan" and not pairs):
        return
    dev = torch.device("cuda")
    store = EvalStore(a.work / "eval/registry")
    model = load_model(dev)
    if a.cmd == "embed":
        ids = np.array_split(np.arange(len(store)), n)[i]
        E, AID, T = [], [], []
        for g in np.array_split(ids, max(1, int(store.n[ids].sum() // 50_000_000))):  # groups of ~50M samples
            span = store.pcm[store.offset[g[0]]:store.offset[g[-1]] + store.n[g[-1]]]
            pcm = torch.from_numpy(np.asarray(span, np.float32) / 32768).to(dev)
            ci, st, z = embedded(model, pcm, store.offset[g] - store.offset[g[0]], store.n[g], EVAL_HOP, dev)
            E.append(z.cpu().numpy()), AID.append(g[ci]), T.append(st / SR)
        idx.mkdir(parents=True, exist_ok=True)
        tmp = idx / f"tmp_{part.name}"  # outside the part*of*.npz glob below
        np.savez(tmp, emb=np.concatenate(E), aid=np.concatenate(AID).astype(np.int32), t=np.concatenate(T))
        return tmp.replace(part)
    files = sorted(idx.glob("part*of*.npz"))
    assert files and len(files) == int(files[0].stem.split("of")[1]), "run `embed` on every part first"
    parts = [np.load(p) for p in files]
    E = pad_rows(torch.from_numpy(np.concatenate([p["emb"] for p in parts])).to(dev), BN)
    eval_aid, eval_t = np.concatenate([p["aid"] for p in parts]), np.concatenate([p["t"] for p in parts])
    lib = Lib(store)
    eval_dur = store.n / SR

    def compute(t):
        if not len(t.clips["n"]):  # a collected tar without clips
            return []
        ci, st, z = embedded(model, torch.from_numpy(t.pcm).to(dev), t.clips["offset"], t.clips["n"], CORPUS_HOP, dev)
        q, e, s = (y.cpu().numpy() for y in search(z, E, TAU))
        return chains(ci[q], st[q] // CORPUS_HOP, eval_t[e] - st[q] / SR, s, st[q] / SR, eval_aid[e], eval_dur)

    def finish(t, c, out):
        clip, aid, off, score, sup, c0, c1 = (np.array(x) for x in zip(*c)) if c else [np.zeros(0)] * 7
        v = lib.verify(t, clip.astype(int), aid.astype(int), np.rint(off * SR).astype(int), c0, c1)
        cols = {"method": np.full(len(clip), "M4"), "eval_audio_id": aid.astype(np.int32), "score": score.astype(np.float32),
                "n_support": sup.astype(np.int32), "corpus_start_s": c0, "corpus_end_s": c1,
                "eval_start_s": np.clip(c0 + off, 0, eval_dur[aid.astype(int)]), "eval_end_s": np.clip(c1 + off, 0, eval_dur[aid.astype(int)])}
        save(frame(t, clip.astype(int), cols, v), out)

    pipelined(lib, pairs, compute, finish)


if __name__ == "__main__":
    main()
