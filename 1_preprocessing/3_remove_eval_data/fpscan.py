"""ctypes interface to libfpscan (eval store, index, corpus tars as 16 kHz PCM, M2/M3 scan, V, significance)."""
import ctypes as C
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import polars as pl

from common.tars import CPUS

DIR = Path(__file__).resolve().parent / "fpscan"
CONF = dict(s.split(" = ") for s in (DIR / "fpscan.conf").read_text().splitlines() if s[:1].isalpha())
SR = 16000
CLASSES = np.array(["C0", "C1", "C2", "C3", "REJECT"])
VRES = np.dtype([("offset_s", "f8"), ("v_rho", "f4"), ("v_psr", "f4"), ("v_logmel_r", "f4"), ("v_overlap_s", "f4"),
                 ("v_cov_eval", "f4"), ("v_cov_corpus", "f4"), ("v_snr_db", "f4"), ("v_class", "i4"), ("sig_ncc", "f4"),
                 ("sig_n_eff", "f4"), ("sig_z", "f4"), ("sig_overlap_s", "f4")], align=True)
CAND = np.dtype([("v", VRES), ("clip", "i4"), ("method", "i4"), ("eval_audio_id", "i4"), ("n_support", "i4"),
                 ("score", "f4"), ("corpus_start_s", "f8"), ("corpus_end_s", "f8"), ("eval_start_s", "f8"),
                 ("eval_end_s", "f8")], align=True)
CLIP = np.dtype([("offset", "i8"), ("n", "i8"), ("key_off", "i4"), ("key_len", "i4")], align=True)
REQ = np.dtype([("clip", "i4"), ("eval_audio_id", "i4"), ("lag", "i8"), ("c0", "f8"), ("c1", "f8")], align=True)
V_COLS = ["offset_s", "v_rho", "v_psr", "v_logmel_r", "v_overlap_s", "v_cov_eval", "v_cov_corpus", "v_snr_db", "v_class"]
SIG_COLS = ["sig_ncc", "sig_n_eff", "sig_z", "sig_overlap_s"]
P = C.c_void_p


class EvalStore:
    """The eval registry: memory-mapped 16 kHz int16 audio and its index."""

    def __init__(self, registry):
        self.dir = Path(registry)
        idx = pl.read_parquet(self.dir / "audio_index.parquet")
        assert (idx["eval_audio_id"].to_numpy() == np.arange(idx.height)).all()
        self.offset, self.n, self.band_hz = (idx[c].to_numpy() for c in ("offset", "n_samples", "band_hz"))
        self.pcm = np.memmap(self.dir / "audio_16k.i16", np.int16, "r")

    def __len__(self):
        return len(self.n)

    def audio(self, i):
        """int16 samples of eval audio i."""
        return self.pcm[self.offset[i]:self.offset[i] + self.n[i]]


class Tar:
    """A corpus tar decoded to 16 kHz mono float32: keys, clip offsets / lengths into one PCM buffer."""

    def __init__(self, lib, path):
        L = self.L = lib.L
        self.h = L.fp_tar_read(lib.ctx, str(path).encode())
        self.clips = _array(L.fp_tar_clips(self.h), L.fp_tar_n(self.h), CLIP).copy()
        keys = C.string_at(L.fp_tar_keys(self.h), int(self.clips["key_len"].sum())).decode()
        self.keys = [keys[o:o + k] for o, k in zip(self.clips["key_off"], self.clips["key_len"])]
        self.pcm = _array(L.fp_tar_pcm(self.h), int((self.clips["offset"] + self.clips["n"]).max(initial=0)), np.float32)

    def __del__(self):
        self.L.fp_tar_free(self.h)


class Lib:
    """libfpscan on an eval store, with a pool of one worker thread per core."""

    def __init__(self, store):
        L = self.L = C.CDLL(str(DIR / "libfpscan.so"))
        for f, res, args in [("fp_sizeof", C.c_int64, [C.c_int]), ("fp_open", P, [C.c_char_p, C.c_char_p, P, P, P, C.c_int64, C.c_int]),
                             ("fp_index_build", None, [P, C.c_char_p]), ("fp_index_load", None, [P, C.c_char_p]),
                             ("fp_tar_read", P, [P, C.c_char_p]), ("fp_tar_n", C.c_int64, [P]), ("fp_tar_clips", P, [P]),
                             ("fp_tar_keys", P, [P]), ("fp_tar_pcm", P, [P]), ("fp_tar_cands", P, [P]), ("fp_tar_free", None, [P]),
                             ("fp_tar_scan", C.c_int64, [P, P]), ("fp_verify", None, [P, P, P, C.c_int64, C.c_int, P])]:
            getattr(L, f).restype, getattr(L, f).argtypes = res, args
        assert [L.fp_sizeof(i) for i in range(4)] == [d.itemsize for d in (CLIP, CAND, REQ, VRES)], "struct layout"
        self.store = store
        self._keep = [np.ascontiguousarray(a, t) for a, t in ((store.offset, np.int64), (store.n, np.int64), (store.band_hz, np.int32))]
        self.ctx = L.fp_open(str(DIR / "fpscan.conf").encode(), str(store.dir / "audio_16k.i16").encode(),
                             *(a.ctypes.data for a in self._keep), len(store), CPUS)

    def index_build(self, d):
        """Build the M2/M3 index of the store into directory d."""
        Path(d).mkdir(parents=True, exist_ok=True)
        self.L.fp_index_build(self.ctx, str(d).encode())

    def index_load(self, d):
        """Memory-map the index in d (built with the same fpscan.conf and store)."""
        self.L.fp_index_load(self.ctx, str(d).encode())

    def read(self, path):
        """Decode a corpus tar to 16 kHz."""
        return Tar(self, path)

    def scan(self, tar):
        """M2 + M3 candidates of every clip of the tar, each verified by V -> CAND array."""
        n = self.L.fp_tar_scan(self.ctx, tar.h)
        return _array(self.L.fp_tar_cands(tar.h), n, CAND).copy()

    def verify(self, tar, clip, eval_id, lag, c0, c1, sig=False):
        """V (and the significance test) of (clip, eval audio, lag in samples, corpus span in s) requests -> VRES array."""
        req = np.zeros(len(clip), REQ)
        req["clip"], req["eval_audio_id"], req["lag"], req["c0"], req["c1"] = clip, eval_id, lag, c0, c1
        out = np.zeros(len(req), VRES)
        if len(req):
            self.L.fp_verify(self.ctx, tar.h, req.ctypes.data, len(req), int(sig), out.ctypes.data)
        return out


def pipelined(lib, pairs, compute, finish):
    """finish(tar, compute(tar), out) of every (input tar, out) pair, reading the next tar and finishing the last one meanwhile."""
    with ThreadPoolExecutor(1) as rd, ThreadPoolExecutor(1) as vx:
        nxt, fin = rd.submit(lib.read, pairs[0][0]), None
        for j, (_, out) in enumerate(pairs):
            t = nxt.result()
            nxt = rd.submit(lib.read, pairs[j + 1][0]) if j + 1 < len(pairs) else None
            r = compute(t)
            if fin:
                fin.result()
            fin = vx.submit(finish, t, r, out)
        fin.result()


def _array(ptr, n, dtype):
    dtype = np.dtype(dtype)
    return np.frombuffer((C.c_byte * (n * dtype.itemsize)).from_address(ptr), dtype) if n else np.zeros(0, dtype)


def frame(tar, clip, cols, v, sig=False):
    """One row per candidate: key, the given columns, the V columns (v_class as C0..C3 / REJECT) [, significance]."""
    vc = {c: v[c] for c in V_COLS + SIG_COLS * sig}
    vc["v_class"] = CLASSES[v["v_class"]]
    return pl.DataFrame({"key": pl.Series([tar.keys[i] for i in clip], dtype=pl.String), **cols, **vc})
