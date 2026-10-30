"""Exhaustive search (M5): every window of every corpus clip against every window of every eval audio. Stage 1
compares band-limited amplitude spectra of sine-tapered windows (a random projection with a distance threshold
that bounds the waveform correlation from below, so no pair with rho >= 0.95 is missed); stage 2 refines every
hit by the exact window NCC at 1/4-sample lags and the NCC of the whole shorter signal; then V and a significance
test (Fisher z of the aligned NCC at the effective number of degrees of freedom). One parquet per corpus tar.
`build_index` runs in every process; one process per GPU: --part i/n."""
import argparse
import math
from pathlib import Path

import numpy as np
import polars as pl
import torch
from scipy import fft as sfft
from scipy.stats import chi2

from common.tars import save, todo
from fpscan import CONF, SR, EvalStore, Lib, frame, pipelined
from gpusearch import BN, pad_rows, search

SCALES = (0.25, 0.5, 1.0, 2.0, 4.0, 8.0)  # window lengths T (s); a signal of length L is searched at T <= L / 2
EVAL_HOP = {0.25: 0.2, 0.5: 0.2, 1.0: 0.1, 2.0: 0.1, 4.0: 0.1, 8.0: 0.2}  # eval hop / T (corpus hop: T / 2)
RHO = {0.25: 0.99}         # stage-1 target per scale (default RHO_95)
RHO_95, RHO_99, COV = 0.95, 0.99, 0.9  # M5 classes: rho over the matched region, coverage of the shorter signal
F_LO, F_HI = float(CONF["v_band_lo"]), float(CONF["v_band_hi"])  # the V band
D, SEED, C_AUG = 254, 20261005, 0.125  # projection dimension and seed; augmented-row constant
GATE_ETA = 0.003           # energy gate: quiet eval windows holding <= this energy fraction leave the index
GT_MIN_SCALE = 0.5         # below this scale clips are not searched against longer eval audios
SILENT = 10 ** (-120 / 10)  # exactly silent corpus windows are skipped
THR_WIN, THR_ITEM = 0.5, 0.9  # stage-2 window NCC and whole-item NCC thresholds
RETRY_LAG, RETRY_MIN_WIN = 1600, 0.9  # wider item lag search for rows with a strong window but a weak item NCC
ITEM_MAX_S = 120.0
Z_CRIT = {0.25: 8.969981, 0.5: 9.540314, 1.0: 9.471353, 2.0: 9.327655, 4.0: 9.122813, 8.0: 8.847417}  # alpha 0.01 family-wise
UNID_NCC = 0.927340        # |NCC| real copies reach: below what N_eff could even that be significant


def band_hi(band_hz):
    return np.maximum(F_LO + 200.0, np.minimum(F_HI, 0.98 * np.asarray(band_hz, np.float64)))


def home(n):
    """Index of the largest scale T with 2 T <= length (-1: shorter than 0.5 s)."""
    return np.array([sum(k >= 2 * T * SR - 1e-6 for T in SCALES) - 1 for k in n])


def frames(pcm, off, n, starts, sig, W, window):
    """(M, W) windows of signals sig at relative starts from the float buffer pcm, zeros outside the signal."""
    pos = torch.from_numpy(starts).to(pcm.device)[:, None] + torch.arange(W, device=pcm.device)[None, :]
    ln = torch.from_numpy(n[sig]).to(pcm.device)[:, None]
    x = pcm[(torch.from_numpy(off[sig]).to(pcm.device)[:, None] + pos.clamp(min=0)).clamp(max=pcm.numel() - 1)]
    return x * ((pos >= 0) & (pos < ln)) * window


def aug_rows(z, query):
    """[z, C - |z|^2/2, 1] (query) / [z, 1, C - |z|^2/2] (index) fp16: <u, v> = 2C - |z_u - z_v|^2 / 2."""
    z16 = z.half()
    n2 = (C_AUG - 0.5 * z16.float().square().sum(1)).half()[:, None]
    one = torch.ones_like(n2)
    return torch.cat([z16, n2, one] if query else [z16, one, n2], 1)


def gate_mask(E, s, n, W, hop, eta=GATE_ETA):
    """True for the quietest eval windows of one audio whose cumulative energy stays below eta of the quietest span a
    match could cover (1.8 T), per residue class of the corpus grid, so every pair with rho >= 0.95 keeps a window
    within the projected distance bound."""
    out = np.zeros(len(E), bool)
    r2 = W / (2.0 * hop)
    inside = np.flatnonzero((s >= 0) & (s + W <= n))
    m = int(math.floor(0.7 * W / hop + 1e-9)) + 1
    if len(E) < 3 or len(inside) < m:
        return out
    c = np.concatenate([[0.0], np.cumsum(E[inside], dtype=np.float64)])
    e_ref = float((c[m:] - c[:-m]).min()) / r2
    if e_ref <= 0:
        return out
    nb = np.maximum(np.concatenate([[0.0], E[:-1]]), np.concatenate([E[1:], [0.0]]))
    Eh = (E + nb) / math.cos(math.pi * hop / (2.0 * W)) ** 2
    P = int(round(r2)) if abs(r2 - round(r2)) < 1e-9 else int(round(2 * r2))
    budget = (eta if P == round(r2) else 0.5 * eta) * e_ref / 1.25
    g = np.rint((s - s[0]) / hop).astype(np.int64) % P
    for cls in range(P):
        o = np.flatnonzero(g == cls)[np.argsort(Eh[g == cls], kind="stable")]
        out[o[:int(np.searchsorted(np.cumsum(Eh[o]), budget, side="right"))]] = True
    return out


class Scale:
    """One window length: sine taper, in-band FFT bins, projection, and per band class the index rows."""

    def __init__(self, T, dev):
        self.T, self.W = T, int(round(T * SR))
        self.hop = int(round(EVAL_HOP[T] * self.W))
        self.k_lo, self.dim = math.ceil(F_LO * self.W / SR), math.floor(F_HI * self.W / SR) - math.ceil(F_LO * self.W / SR)
        self.window = torch.sin(math.pi * (torch.arange(self.W, device=dev) + 0.5) / self.W)
        g = np.random.default_rng([SEED, round(T * 1000)]).standard_normal((D, self.dim), dtype=np.float32)
        self.R = torch.from_numpy(g).to(dev) / math.sqrt(D)
        x = 2.0 * (1.0 - (RHO.get(T, RHO_95) - (w := GATE_ETA + math.sqrt(1 - RHO.get(T, RHO_95) ** 2) * math.sqrt(GATE_ETA)))
                   / (1.0 - w))  # full-space distance bound of the best un-gated window
        self.tau = 2 * C_AUG - 0.5 * (x * chi2.isf(1e-9, D) / D + 0.001)  # missed with p <= 1e-9 (+ fp16 rounding)
        self.classes = {}

    def dims(self, hi):
        return max(0, min(self.dim, math.floor(hi * self.W / SR) - self.k_lo))

    def amp(self, x):
        """|rfft| over the in-band bins of tapered windows."""
        return torch.fft.rfft(x).abs()[:, self.k_lo:self.k_lo + self.dim]

    def project(self, S, hi):
        """Amplitude spectra -> (unit descriptor of the class's bins projected, minus the class mean; energy)."""
        c = self.classes[hi]
        e = S[:, :c["d"]].square().sum(1)
        return (S[:, :c["d"]] @ self.R[:, :c["d"]].T) / e.sqrt().clamp_min(1e-30)[:, None] - c["Rm"], e


def grid(ids, n, W, hop):
    """(audio, start) of the eval windows of audios ids: starts -W + hop, ..., < n (every aligned position is within
    hop / 2 of one, the zero-padded edge windows included)."""
    nf = (n[ids] + W - hop - 1) // hop + 1
    first = np.repeat(np.cumsum(nf) - nf, nf)
    return np.repeat(ids, nf), (np.arange(nf.sum()) - first) * hop + hop - W


@torch.no_grad()
def build_index(store, dev, chunk=1 << 27):
    """{T: Scale} with rows of every eval audio at its home scale (eq, energy-gated) and, from GT_MIN_SCALE on, of
    every longer eval audio (gt, searched by the clips whose home scale is T)."""
    n, h, his = store.n, home(store.n), band_hi(store.band_hz)
    index = {}

    def amps(sc, ids, n_):  # (audio, start, in-band amplitude spectra) of the windows of audios ids, in GPU-sized groups
        for g in np.split(ids, np.flatnonzero(np.diff(np.cumsum(n[ids]) // (chunk // sc.W * sc.hop))) + 1):
            if len(g):
                pcm = torch.from_numpy(np.concatenate([store.audio(a) for a in g]) / np.float32(32768)).to(dev)
                aid, s = grid(g, n_, sc.W, sc.hop)
                off = np.zeros(len(n), np.int64)
                off[g] = np.cumsum(n[g]) - n[g]
                yield aid, s, sc.amp(frames(pcm, off, n, s, aid, sc.W, sc.window))

    for si, T in enumerate(SCALES):
        sc = index[T] = Scale(T, dev)
        for hi in np.unique(his):
            parts = {"eq": np.flatnonzero((his == hi) & (h == si)), "gt": np.flatnonzero((his == hi) & (h > si) & (T >= GT_MIN_SCALE))}
            if sc.dims(hi) < 16 or not sum(len(p) for p in parts.values()):
                continue
            d = sc.dims(hi)
            sample = np.sort(np.concatenate(list(parts.values())))
            mean, cnt = torch.zeros(d, dtype=torch.float64, device=dev), 0
            for _, _, S in amps(sc, sample[:: max(1, len(sample) // 1500)][:1500], np.minimum(n, 30 * SR)):
                S = S[:, :d][S[:, :d].square().sum(1) > 0]  # mean unit descriptor of 1,500 audios (first 30 s)
                mean, cnt = mean + (S / S.norm(dim=1, keepdim=True)).double().sum(0), cnt + len(S)
            c = sc.classes[hi] = {"d": d, "Rm": sc.R[:, :d] @ (mean / max(cnt, 1)).float()}
            for k, ids in parts.items():
                out = [(aid, s, *sc.project(S, hi)) for aid, s, S in amps(sc, ids, n)]
                aid, s = (np.concatenate([o[i] for o in out]) if out else np.zeros(0, np.int64) for i in (0, 1))
                z = torch.cat([o[2] for o in out]) if out else torch.zeros(0, D, device=dev)
                e = torch.cat([o[3] for o in out]).cpu().numpy() if out else np.zeros(0)
                keep = np.ones(len(aid), bool)
                if k == "eq":  # energy gate per audio
                    for g in np.split(np.arange(len(aid)), np.flatnonzero(np.diff(aid)) + 1):
                        keep[g] = ~gate_mask(e[g], s[g], n[aid[g[0]]], sc.W, sc.hop) if len(g) else keep[g]
                c[k] = (pad_rows(aug_rows(z[torch.from_numpy(keep).to(dev)], False), BN), aid[keep], s[keep])
    return index


@torch.no_grad()
def stage1(index, pcm, off, n):
    """Hits (clip, corpus window start, eval audio, eval window start, scale) of a batch of clips on the GPU."""
    h = home(n)
    out = []
    for si, T in enumerate(SCALES):
        sc, el = index[T], np.flatnonzero(h >= si)
        if not len(el) or not sc.classes:
            continue
        hop = sc.W // 2
        sig = np.concatenate([np.full(-(-n[c] // hop) + 1, c) for c in el])  # corpus windows: starts -T/2, 0, T/2, ...
        st = np.concatenate([np.arange(-hop, n[c], hop) for c in el])
        S = torch.cat([sc.amp(frames(pcm, off, n, st[i:i + (1 << 27) // sc.W], sig[i:i + (1 << 27) // sc.W], sc.W, sc.window))
                       for i in range(0, len(st), (1 << 27) // sc.W)])
        home_rows = torch.from_numpy(h[sig] == si).to(pcm.device)
        for hi, c in sc.classes.items():
            z, e = sc.project(S, hi)
            Q = aug_rows(z, True) * (e > SILENT * sc.W * sc.W / 2)[:, None].half()
            for k, rows in (("eq", torch.arange(len(Q), device=pcm.device)), ("gt", home_rows.nonzero().squeeze(1))):
                E, aid, s = c[k]
                if not len(aid) or not len(rows):
                    continue
                r, col, _ = search(Q[rows].contiguous(), E, sc.tau)
                r, col = rows[r].cpu().numpy(), col.cpu().numpy()
                ok = col < len(aid)
                out.append((sig[r[ok]], st[r[ok]], aid[col[ok]], s[col[ok]], np.full(ok.sum(), si)))
    return [np.concatenate(x) for x in zip(*out)] if out else [np.zeros(0, int)] * 5


def eval_segments(store, aid, s0, length):
    """(len(aid), length) float32 eval samples [s0, s0 + length), zeros outside the audio."""
    out = np.zeros((len(aid), length), np.int16)
    for i, (a, s) in enumerate(zip(aid, s0)):
        lo, hi = max(0, -s), min(length, store.n[a] - s)
        if hi > lo:
            out[i, lo:hi] = store.pcm[store.offset[a] + s + lo:store.offset[a] + s + hi]
    return out.astype(np.float32) / 32768


def mean_free(x):
    """Subtract the mean of the non-zero samples from them (zeros = outside the signal stay zero)."""
    nz = x != 0
    return (x - (x * nz).sum(1, keepdim=True) / nz.sum(1, keepdim=True).clamp_min(1)) * nz


@torch.no_grad()
def window_ncc(store, sc, pcm, off, n, clip, cs, aid, es, U=4, chunk=1 << 26):
    """Band-limited NCC of each hit's tapered corpus window against its eval segment (+-m samples) at 1/4-sample
    lags -> (rho, refined offset eval - corpus in samples). Corpus windows and eval segments are transformed once."""
    dev, W, m = pcm.device, sc.W, sc.hop // 2 + 8
    Ny = W + 2 * m
    Nf = sfft.next_fast_len(Ny, real=True)
    hi = band_hi(store.band_hz[aid])
    rho, lag = np.zeros(len(clip), np.float32), np.zeros(len(clip), np.float32)
    w2 = sc.window.square()
    Fw2c = torch.conj(torch.fft.rfft(w2.double(), n=Nf))
    for h in np.unique(hi):
        mask = ((torch.arange(Nf // 2 + 1, device=dev) * (SR / Nf) >= F_LO) & (torch.arange(Nf // 2 + 1, device=dev) * (SR / Nf) <= h)).float()
        ii = np.flatnonzero(hi == h)
        cu, ci = np.unique(np.stack([clip[ii], cs[ii]], 1), axis=0, return_inverse=True)
        eu, ei = np.unique(np.stack([aid[ii], es[ii]], 1), axis=0, return_inverse=True)
        x = mean_free(frames(pcm, off, n, cu[:, 1], cu[:, 0], W, 1.0))
        xb = torch.fft.irfft(torch.fft.rfft(x, n=Nf) * mask, n=Nf)[:, :W]
        A, ex = torch.conj(torch.fft.rfft(xb * w2, n=Nf)), (xb * xb * w2).sum(1)
        y = mean_free(torch.from_numpy(eval_segments(store, eu[:, 0], eu[:, 1] - m, Ny)).to(dev))
        Fy = torch.fft.rfft(y, n=Nf) * mask
        y2 = torch.fft.irfft(Fy, n=Nf).double().square()
        den = torch.fft.irfft(Fw2c * torch.fft.rfft(y2, n=Nf), n=Nf)[:, :2 * m + 1]
        quiet = den <= 1e-10 * y2.sum(1, keepdim=True)
        den = den.clamp_min(1e-14 * W).float()
        idx = ((torch.arange(U * 2 * m + 1, device=dev) + U // 2) // U).clamp_(max=2 * m)  # nearest integer lag
        for b in range(0, len(ii), max(1, chunk // (U * Nf))):
            j = slice(b, b + max(1, chunk // (U * Nf)))
            c_, e_ = torch.from_numpy(ci[j]).to(dev), torch.from_numpy(ei[j]).to(dev)
            num = torch.fft.irfft(A[c_] * Fy[e_], n=U * Nf)[:, :U * 2 * m + 1] * U
            r = num.abs() / (ex[c_].clamp_min(1e-14 * W)[:, None] * den[e_][:, idx]).sqrt()
            r = torch.where(quiet[e_][:, idx] | (ex[c_] <= 1e-14 * W)[:, None], torch.zeros_like(r), r)
            best, li = r.max(1)
            rho[ii[j]], lag[ii[j]] = best.cpu().numpy(), (li.float() / U - m).cpu().numpy()
    return rho, es + lag.astype(np.float64) - cs


@torch.no_grad()
def item_ncc(S, L, len_s, n_lag, v_lo, v_hi, band, N, cov_min=0.88, NB=128):
    """NCC of the whole shorter signal S against the longer one L over n_lag lags (1/4-sample refined), maximised
    over contiguous sub-spans covering >= cov_min of S -> (rho_item, lag in samples of L)."""
    H, Ns = S.shape
    Nl, dev = L.shape[1], S.device
    v_hi = torch.minimum(v_hi, len_s + n_lag - 1)
    ms = torch.arange(Ns, device=dev)[None, :] < len_s[:, None]
    ml = (torch.arange(Nl, device=dev)[None, :] >= v_lo[:, None]) & (torch.arange(Nl, device=dev)[None, :] < v_hi[:, None])
    S = (S - (S * ms).sum(1, keepdim=True) / ms.sum(1, keepdim=True).clamp_min(1)) * ms
    L = (L - (L * ml).sum(1, keepdim=True) / ml.sum(1, keepdim=True).clamp_min(1)) * ml
    f = torch.arange(N // 2 + 1, device=dev) * (SR / N)
    mask = ((f[None, :] >= F_LO) & (f[None, :] <= band[:, None])).float()
    FS, FL = torch.fft.rfft(S, n=N) * mask, torch.fft.rfft(L, n=N) * mask
    sb, XS = torch.fft.irfft(FS, n=N)[:, :Ns], torch.conj(FS) * FL
    K = int(n_lag.max())
    r = torch.fft.irfft(XS, n=N)[:, :K]
    cs_s = torch.nn.functional.pad(torch.cumsum(sb.double().square(), 1), (1, 0))
    cs_l = torch.nn.functional.pad(torch.cumsum(torch.fft.irfft(FL, n=N)[:, :Nl].double().square(), 1), (1, 0))
    k = torch.arange(K, device=dev)[None, :]
    a, b = (v_lo[:, None] - k).clamp(min=0), torch.minimum(len_s[:, None], v_hi[:, None] - k)
    ok = (k < n_lag[:, None]) & ((b - a).double() >= cov_min * len_s[:, None].double())
    a, b = a.clamp(max=Ns), b.clamp(min=0, max=Ns)
    den = ((cs_s.gather(1, b) - cs_s.gather(1, a)).clamp_min(0)
           * (cs_l.gather(1, (k + b).clamp(max=Nl)) - cs_l.gather(1, (k + a).clamp(max=Nl))).clamp_min(0)).sqrt()
    tot = (cs_s[:, -1] * cs_l[:, -1]).sqrt()[:, None]
    best, ks = torch.where(ok & (den > 1e-10 * tot) & (den > 0), r.double().abs() / den.clamp_min(1e-300), torch.zeros_like(den)).max(1)
    ar = torch.arange(H, device=dev)
    a_b, b_b = a[ar, ks], b[ar, ks]
    dl = torch.arange(-3, 4, device=dev, dtype=torch.float64) * 0.25  # quarter-sample refinement of the cross spectrum
    kk = torch.arange(N // 2 + 1, device=dev, dtype=torch.float64)
    w = torch.full((N // 2 + 1,), 2.0, device=dev)
    w[0], w[-1] = 1.0, 0.0
    rf = ((XS * torch.exp(2j * math.pi * kk[None, :] * ks[:, None].double() / N).to(torch.complex64) * w[None, :])
          @ torch.exp(2j * math.pi * kk[:, None] * dl[None, :] / N).to(torch.complex64)).real / N
    d = dl[rf.abs().max(1).indices]
    la = torch.fft.irfft(FL * torch.exp(2j * math.pi * kk[None, :] * d[:, None] / N).to(torch.complex64), n=N)
    Bk = torch.div(len_s + NB - 1, NB, rounding_mode="floor").clamp_min(1)
    t = torch.arange(Ns, device=dev)[None, :]
    inside = (t >= a_b[:, None]) & (t < b_b[:, None])
    x, y = sb * inside, la.gather(1, (ks[:, None] + t).clamp(max=N - 1)) * inside
    bid = torch.div(t, Bk[:, None], rounding_mode="floor").clamp(max=NB - 1).expand(H, -1)
    z0 = torch.zeros(H, NB, dtype=torch.float64, device=dev)
    P, EX, EY = (torch.nn.functional.pad(torch.cumsum(z0.scatter_add(1, bid, v), 1), (1, 0))
                 for v in ((x * y).double(), x.double().square(), y.double().square()))
    num = (P[:, None, :] - P[:, :, None]).abs()  # [h, i, j] = blocks i .. j-1
    dd = ((EX[:, None, :] - EX[:, :, None]) * (EY[:, None, :] - EY[:, :, None])).clamp_min(0).sqrt()
    ii = torch.arange(NB + 1, device=dev)
    span = (ii[None, None, :] - ii[None, :, None]).double() >= (torch.ceil(cov_min * len_s.double() / Bk.double()) - 1).clamp_min(1)[:, None, None]
    tot2 = (EX[:, -1] * EY[:, -1]).sqrt()[:, None, None]
    rs = torch.where(span & (dd > 1e-10 * tot2) & (dd > 0), num / dd.clamp_min(1e-300), torch.zeros_like(dd))
    rho = torch.where(best > 0, rs.flatten(1).max(1).values.clamp(max=1.0), torch.zeros_like(best))
    return rho.float().cpu().numpy(), (ks.double() + d).cpu().numpy()


def item_rows(store, pcm, off, n, R, mlag):
    """Whole-item NCC of rows R (clip, aid, off) at +-mlag samples around their offset -> (rho_item, item offset)."""
    dev = pcm.device
    n_c, n_e, oi = n[R["clip"]], store.n[R["aid"]], np.rint(R["off"]).astype(np.int64)
    ev_short, ls = n_e <= n_c, np.minimum(n_e, n_c)
    rho, out_off = np.full(len(oi), np.nan, np.float32), R["off"].copy()
    order = np.argsort(ls, kind="stable")
    order = order[ls[order] <= ITEM_MAX_S * SR]
    while len(order):
        N = 1 << math.ceil(math.log2(max(ls[order[0]] + 2 * mlag + 1, 256)))
        j = order[:max(4, (1 << 25) // N)]
        j = j[ls[j] + 2 * mlag + 1 <= N]
        order = order[len(j):]
        Ns, Nl, es, cs = int(ls[j].max()), int(ls[j].max()) + 2 * mlag, ev_short[j], ~ev_short[j]
        S, L = torch.zeros(len(j), Ns, device=dev), torch.zeros(len(j), Nl, device=dev)
        t0 = np.where(es, -oi[j] - mlag, oi[j] - mlag)  # start of L in the longer signal (the clip, or the eval audio)
        if es.any():
            q = torch.from_numpy(np.flatnonzero(es)).to(dev)
            S[q] = torch.from_numpy(eval_segments(store, R["aid"][j][es], np.zeros(es.sum(), int), Ns)).to(dev)
            L[q] = frames(pcm, off, n, t0[es], R["clip"][j][es], Nl, 1.0)
        if cs.any():
            q = torch.from_numpy(np.flatnonzero(cs)).to(dev)
            S[q] = frames(pcm, off, n, np.zeros(cs.sum(), int), R["clip"][j][cs], Ns, 1.0)
            L[q] = torch.from_numpy(eval_segments(store, R["aid"][j][cs], t0[cs], Nl)).to(dev)
        v_lo, v_hi = np.maximum(0, -t0), np.minimum(Nl, np.where(es, n_c[j], n_e[j]) - t0)
        r, lg = item_ncc(S, L, *(torch.from_numpy(np.asarray(v)).to(dev) for v in (
            ls[j], np.full(len(j), 2 * mlag + 1), v_lo, v_hi, band_hi(store.band_hz[R["aid"][j]]).astype(np.float32))), N)
        rho[j], out_off[j] = r, np.where(es, oi[j] - (lg - mlag), oi[j] + (lg - mlag))
    return rho, out_off


def stage2(store, index, pcm, off, n, hits):
    """Hits -> rows (best window NCC per clip, eval audio, scale and offset bin) that pass the window and item NCC."""
    clip, cs, aid, es, si = hits
    rows = []
    for s in np.unique(si):
        sc = index[SCALES[s]]
        m = np.flatnonzero(si == s)
        rho, offs = window_ncc(store, sc, pcm, off, n, clip[m], cs[m], aid[m], es[m])
        k = rho >= THR_WIN
        if not k.any():
            continue
        c_, a_, o_, r_, s_ = clip[m][k], aid[m][k], offs[k], rho[k], cs[m][k]
        b = np.floor(o_ / min(2 * sc.hop, 0.1 * SR) + 0.5).astype(np.int64)
        df = pl.DataFrame({"clip": c_, "aid": a_, "bin": b, "off": o_, "win": r_, "cs": s_}).with_row_index("i")
        g = df.sort("win", "i", descending=[True, False]).group_by("clip", "aid", "bin", maintain_order=True).agg(
            pl.col("off").first(), pl.col("win").first(), pl.len().alias("n_support"), pl.col("cs").min().alias("c0"),
            (pl.col("cs").max() + sc.W).alias("c1"))
        rows.append(g.with_columns(pl.lit(SCALES[s]).alias("scale_s")))
    if not rows:
        return None
    R = pl.concat(rows)
    R = {c: R[c].to_numpy() for c in R.columns}
    item, item_off = item_rows(store, pcm, off, n, R, 2)
    retry = np.flatnonzero((item < THR_ITEM) & (R["win"] >= RETRY_MIN_WIN))
    if len(retry):
        r2, o2 = item_rows(store, pcm, off, n, {k: v[retry] for k, v in R.items()}, RETRY_LAG)
        better = r2 > item[retry]
        item[retry[better]], item_off[retry[better]] = r2[better], o2[better]
    keep = ~(item < THR_ITEM)  # NaN = longer than ITEM_MAX_S: straight to V
    return {**{k: v[keep] for k, v in R.items()}, "item": item[keep], "item_off": item_off[keep]}


def sig_class(ncc, n_eff, scale):
    """significant: z >= z_crit where even |NCC| = 0.999 could reach it; content_unidentifiable: not even UNID_NCC could;
    else chance."""
    zc = np.array([Z_CRIT[s] for s in scale])
    sq = np.sqrt(np.maximum(np.nan_to_num(n_eff) - 3, 0))
    z = np.where(n_eff > 3, np.arctanh(np.clip(np.abs(np.nan_to_num(ncc)), 0, 0.9999999)) * sq, 0.0)
    unid = (n_eff <= 3) | (np.arctanh(0.999) * sq < zc)
    cls = np.where((z >= zc) & ~unid, "significant", np.where(unid | (np.arctanh(UNID_NCC) * sq < zc), "content_unidentifiable", "chance"))
    return zc, np.where(np.isfinite(ncc), cls, None)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    ap.add_argument("--part", default="0/1")
    ap.add_argument("--batch-s", type=float, default=4000, help="corpus audio per GPU batch")
    a = ap.parse_args()
    pairs = todo(a.work / "collected", a.work / "eval/exhaustive", ".parquet", a.part)
    if not pairs:
        return
    dev = torch.device("cuda")
    store = EvalStore(a.work / "eval/registry")
    lib, index = Lib(store), build_index(store, dev)

    def compute(t):
        off, n, parts = t.clips["offset"], t.clips["n"], []
        for b in np.split(np.arange(len(n)), np.flatnonzero(np.diff(np.cumsum(n) // int(a.batch_s * SR))) + 1):
            if not len(b):
                continue
            pcm = torch.from_numpy(t.pcm[off[b[0]]:off[b[-1]] + n[b[-1]]]).to(dev)
            R = stage2(store, index, pcm, off[b] - off[b[0]], n[b], stage1(index, pcm, off[b] - off[b[0]], n[b]))
            parts += [{**R, "clip": b[R["clip"]]}] if R is not None else []
        return {k: np.concatenate([p[k] for p in parts]) if parts else v for k, v in empty.items()}

    def finish(t, R, out):
        dur = t.clips["n"][R["clip"]] / SR
        v = lib.verify(t, R["clip"], R["aid"], np.rint(R["item_off"]).astype(np.int64), np.maximum(0, R["c0"] / SR),
                       np.minimum(dur, R["c1"] / SR), sig=True)
        good = np.isfinite(v["v_rho"]) & (np.maximum(v["v_cov_eval"], v["v_cov_corpus"]) >= COV)
        zc, sc = sig_class(v["sig_ncc"], v["sig_n_eff"], R["scale_s"])
        e_dur = store.n[R["aid"]] / SR
        cols = {"method": np.full(len(v), "M5"), "eval_audio_id": R["aid"].astype(np.int32), "scale_s": R["scale_s"],
                "n_support": R["n_support"].astype(np.int32), "win_ncc": R["win"], "item_ncc": R["item"],
                "corpus_start_s": np.maximum(0, R["c0"] / SR), "corpus_end_s": np.minimum(dur, R["c1"] / SR),
                "eval_start_s": np.clip((R["c0"] + R["off"]) / SR, 0, e_dur), "eval_end_s": np.clip((R["c1"] + R["off"]) / SR, 0, e_dur),
                "m5_class": np.where(good & (v["v_rho"] >= RHO_99), "M5_99", np.where(good & (v["v_rho"] >= RHO_95), "M5_95", "")),
                "z_crit": zc, "sig_class": pl.Series(sc, dtype=pl.String)}
        save(frame(t, R["clip"], cols, v, sig=True), out)

    empty = {k: np.zeros(0, int) for k in ("clip", "aid", "off", "win", "n_support", "c0", "c1", "scale_s", "item", "item_off")}
    pipelined(lib, pairs, compute, finish)


if __name__ == "__main__":
    main()
