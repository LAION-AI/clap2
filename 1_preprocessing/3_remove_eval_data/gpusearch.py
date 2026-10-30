"""Exact fp16 inner-product search with a fused threshold (Triton): every (i, j) with <q_i, e_j> >= tau, without
writing the score matrix; E stays resident, each program holds one E tile and streams all Q tiles."""
import torch
import triton
import triton.language as tl

BM, BN = 128, 128


@triton.jit
def _kernel(Q, E, M, tau, cnt, hr, hc, hv, cap, K: tl.constexpr, BM: tl.constexpr, BN: tl.constexpr):
    offs_n = tl.program_id(0) * BN + tl.arange(0, BN)
    offs_k = tl.arange(0, K)
    et = tl.trans(tl.load(E + offs_n[:, None].to(tl.int64) * K + offs_k[None, :]))
    for m0 in range(0, M, BM):
        offs_m = m0 + tl.arange(0, BM)
        s = tl.dot(tl.load(Q + offs_m[:, None].to(tl.int64) * K + offs_k[None, :]), et)
        if tl.max(tl.max(s, axis=1), axis=0) >= tau:
            hit = s >= tau
            slot = tl.atomic_add(cnt + tl.zeros((BM, BN), tl.int32), tl.full((BM, BN), 1, tl.int32), mask=hit)
            ok = hit & (slot < cap)
            tl.store(hr + slot, offs_m[:, None] + tl.zeros((BM, BN), tl.int32), mask=ok)
            tl.store(hc + slot, offs_n[None, :] + tl.zeros((BM, BN), tl.int32), mask=ok)
            tl.store(hv + slot, s.to(tl.float16), mask=ok)


def pad_rows(x, multiple):
    """x zero-padded to a multiple of `multiple` rows (a zero row scores 0 < tau)."""
    n = -(-x.shape[0] // multiple) * multiple
    return x if n == x.shape[0] else torch.cat([x, x.new_zeros(n - x.shape[0], *x.shape[1:])])


def search(Q, E, tau, cap=1 << 24):
    """Q (M, K), E (N, K) fp16 on one GPU, N a multiple of BN -> (rows, cols, scores) with score >= tau."""
    assert Q.dtype == E.dtype == torch.float16 and E.shape[0] % BN == 0 and E.shape[1] == Q.shape[1]
    M = Q.shape[0]
    Qp = pad_rows(Q.contiguous(), BM)
    cnt = torch.zeros(1, dtype=torch.int32, device=Q.device)
    hr, hc = (torch.empty(cap, dtype=torch.int32, device=Q.device) for _ in range(2))
    hv = torch.empty(cap, dtype=torch.float16, device=Q.device)
    _kernel[(E.shape[0] // BN,)](Qp, E, Qp.shape[0], float(tau), cnt, hr, hc, hv, cap, K=E.shape[1], BM=BM, BN=BN,
                                 num_warps=8, num_stages=2)
    n = int(cnt.item())
    if n > cap:  # too many hits for the buffer: split the queries
        assert M > 1, f"one query row has {n} hits"
        a, b = search(Q[:M // 2], E, tau, cap), search(Q[M // 2:], E, tau, cap)
        return torch.cat([a[0], b[0] + M // 2]), torch.cat([a[1], b[1]]), torch.cat([a[2], b[2]])
    r, c, v = hr[:n].long(), hc[:n].long(), hv[:n].float()
    keep = r < M
    return r[keep], c[keep], v[keep]
