"""Silence cuts: cut at the midpoints of silences, merge short segments, split long ones near target steps."""
import numpy as np


def segments(x, sr, db=-40.0, min_silence=1.0, target=30.0, lo=5.0, hi=120.0):
    """(start, end) seconds of segments of x between lo and hi seconds."""
    hop = 0.010
    frames = np.lib.stride_tricks.sliding_window_view(x, int(sr * 0.025))[:: int(sr * hop)]
    level = 20 * np.log10(np.sqrt(np.mean(frames**2, 1) + 1e-20) + 1e-10)
    edges = np.diff(np.concatenate(([0], level < db, [0])).astype(np.int8))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    keep = ends - starts >= int(min_silence / hop)
    total = x.size / sr
    mids = [(s + e) // 2 * hop for s, e in zip(starts[keep], ends[keep])]
    cuts = sorted({0.0, total, *(t for t in mids if 0 < t < total)})
    segs = [[a, b] for a, b in zip(cuts, cuts[1:]) if b - a > 0.1]
    while len(segs) > 1 and (i := next((i for i, (a, b) in enumerate(segs) if b - a < lo), None)) is not None:
        j = 1 if i == 0 else i - 1 if i == len(segs) - 1 else i - 1 if segs[i - 1][1] - segs[i - 1][0] <= segs[i + 1][1] - segs[i + 1][0] else i + 1
        a, b = min(i, j), max(i, j)
        segs[a : b + 1] = [[segs[a][0], segs[b][1]]]
    out = []
    for a, b in segs:
        while b - a > hi:
            f0 = int((a + target - 10) / hop)
            c = (f0 + int(np.argmin(level[f0 : int((a + target + 10) / hop)]))) * hop
            out.append((a, c))
            a = c
        out.append((a, b))
    return [(a, b) for a, b in out if lo <= b - a <= hi]
