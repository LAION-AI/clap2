// Corpus-side lookups in the eval index: M2 time-offset voting, M3 sub-fingerprint lookup with block bit error rate.
#include <algorithm>

#include "fp.hpp"

namespace fp {

static const uint64_t BIAS = 1ull << 24;

static void best_per_id(std::vector<Cand>& tmp, std::vector<Cand>& out) {
  std::sort(tmp.begin(), tmp.end(), [](const Cand& a, const Cand& b) {
    return a.eval_id != b.eval_id ? a.eval_id < b.eval_id : a.score != b.score ? a.score > b.score : a.n_support > b.n_support;
  });
  for (size_t i = 0; i < tmp.size(); i++)
    if (i == 0 || tmp[i].eval_id != tmp[i - 1].eval_id) out.push_back(tmp[i]);
}

// postings of every probe key: emit(probe, posting position); bucket offsets and postings prefetched ahead
template <class Emit>
static void probe(const Table& T, const std::vector<uint64_t>& keys, Emit emit) {
  if (!T.n) return;
  const int sh = 32 - T.bits;
  for (size_t i = 0, nk = keys.size(); i < nk; i++) {
    if (i + 16 < nk) __builtin_prefetch(&T.bk[(uint32_t)(keys[i + 16] >> 32) >> sh]);
    if (i + 8 < nk) __builtin_prefetch(&T.po[T.bk[(uint32_t)(keys[i + 8] >> 32) >> sh]]);
    const uint32_t key = (uint32_t)(keys[i] >> 32);
    const uint64_t *b, *e;
    T.range(key, b, e);
    for (const uint64_t* p = std::lower_bound(b, e, (uint64_t)key << 32); p < e && (uint32_t)(*p >> 32) == key; p++)
      emit((uint32_t)keys[i], (uint32_t)*p);
  }
}

void query_m2(const Features& F, const Index& I, const Params& P, std::vector<Cand>& out) {
  static thread_local std::vector<uint64_t> votes;  // ((eval frame - corpus frame + BIAS) << 24) | corpus frame
  votes.clear();
  auto vote = [&](uint32_t tc, uint32_t g) {
    if (tc < BIAS) votes.push_back(((g + BIAS - tc) << 24) | tc);
  };
  probe(I.m2t, F.trip, vote);
  probe(I.m2p, F.pairs, vote);
  std::sort(votes.begin(), votes.end());
  struct Run {
    uint64_t v;
    uint32_t a, n;
  };
  std::vector<Run> runs;
  for (size_t i = 0, j; i < votes.size(); i = j) {
    for (j = i; j < votes.size() && (votes[j] >> 24) == (votes[i] >> 24); j++) {
    }
    runs.push_back({votes[i] >> 24, (uint32_t)i, (uint32_t)(j - i)});
  }
  const int kpre = std::min(P.m2_min_votes, P.m2_min_votes_frac);
  std::vector<Cand> tmp;
  for (size_t r = 0; r < runs.size(); r++) {  // local maxima of the vote histogram, +-1 frame merged
    const bool hp = r > 0 && runs[r - 1].v + 1 == runs[r].v, hn = r + 1 < runs.size() && runs[r + 1].v == runs[r].v + 1;
    const uint32_t tot = runs[r].n + (hp ? runs[r - 1].n : 0) + (hn ? runs[r + 1].n : 0);
    if ((int)tot < kpre || (hp && runs[r - 1].n > runs[r].n) || (hn && runs[r + 1].n > runs[r].n)) continue;
    const int id = I.id_of_frame(runs[r].v - BIAS + (uint32_t)(votes[runs[r].a] & 0xFFFFFF));
    if (id < 0) continue;
    const EvalAudio& A = I.audios[id];
    const uint64_t gb = A.frame_base, ge = gb + A.n_frames;
    int cnt = 0;
    uint32_t tmin = UINT32_MAX, tmax = 0;
    uint64_t gmin = UINT64_MAX, gmax = 0;
    for (size_t q = hp ? r - 1 : r; q <= (hn ? r + 1 : r); q++)
      for (uint32_t i = runs[q].a; i < runs[q].a + runs[q].n; i++) {
        const uint32_t tc = (uint32_t)(votes[i] & 0xFFFFFF);
        const uint64_t g = (votes[i] >> 24) - BIAS + tc;
        if (g < gb || g >= ge) continue;
        cnt++, tmin = std::min(tmin, tc), tmax = std::max(tmax, tc), gmin = std::min(gmin, g), gmax = std::max(gmax, g);
      }
    const bool ok = (cnt >= P.m2_min_votes && (tmax - tmin) * FRAME_S >= P.m2_min_span_s) ||
                    (cnt >= P.m2_min_votes_frac && A.n_hash > 0 && cnt >= P.m2_frac * A.n_hash);
    if (cnt < kpre || !ok) continue;
    Cand c;
    c.method = 2, c.eval_id = id, c.score = (float)cnt, c.n_support = cnt;
    c.lag = ((int64_t)(runs[r].v - BIAS) - (int64_t)gb) * HOP;
    c.c0 = tmin * FRAME_S, c.c1 = (tmax * (double)HOP + NFFT) / SR;
    c.e0 = (gmin - gb) * FRAME_S, c.e1 = ((gmax - gb) * (double)HOP + NFFT) / SR;
    tmp.push_back(c);
  }
  best_per_id(tmp, out);
}

void query_m3(const Features& F, const Index& I, const Params& P, std::vector<Cand>& out) {
  std::vector<Cand> tmp;
  static thread_local std::vector<uint64_t> keys, hits;
  for (int var = 0; var < 2; var++) {
    const Table& T = var ? I.m3n : I.m3f;
    const std::vector<uint32_t>& fpv = var ? F.fp_narrow : F.fp_full;
    const std::vector<uint16_t>& wk = var ? F.weak_narrow : F.weak_full;
    if (!T.n || fpv.empty()) continue;
    keys.clear(), hits.clear();
    for (size_t n = 0; n < F.n_sfp && n < BIAS; n++)
      if (F.valid[n]) {  // the sub-fp and its flips of the two least reliable bits
        const uint32_t f = fpv[n], b1 = 1u << (wk[n] & 31), b2 = 1u << ((wk[n] >> 8) & 31);
        for (uint32_t q : {f, f ^ b1, f ^ b2, f ^ b1 ^ b2}) keys.push_back(((uint64_t)mix32(q) << 32) | n);
      }
    probe(T, keys, [&](uint32_t n, uint32_t s) { hits.push_back(((s + BIAS - n) << 24) | n); });
    std::sort(hits.begin(), hits.end());
    struct Key {
      uint64_t d;
      uint32_t a, n;
    };
    std::vector<Key> ks;
    for (size_t i = 0, j; i < hits.size(); i = j) {
      for (j = i; j < hits.size() && (hits[j] >> 24) == (hits[i] >> 24); j++) {
      }
      ks.push_back({hits[i] >> 24, (uint32_t)i, (uint32_t)(j - i)});
    }
    if ((int)ks.size() > P.m3_max_keys) {  // check the most-hit alignments first
      std::nth_element(ks.begin(), ks.begin() + P.m3_max_keys, ks.end(), [](const Key& a, const Key& b) { return a.n > b.n; });
      ks.resize(P.m3_max_keys);
    }
    for (const Key& K : ks) {
      const int64_t off = (int64_t)K.d - (int64_t)BIAS;  // eval sub-fp = corpus sub-fp + off
      const uint32_t nmid = (uint32_t)(hits[K.a + K.n / 2] & 0xFFFFFF);
      const int id = I.id_of_sfp((uint64_t)((int64_t)nmid + off));
      if (id < 0) continue;
      const EvalAudio& A = I.audios[id];
      const int64_t n_lo = std::max<int64_t>(0, (int64_t)A.sfp_base - off);
      const int64_t n_hi = std::min<int64_t>((int64_t)F.n_sfp, (int64_t)A.sfp_base + A.n_sfp - off);
      if (n_hi <= n_lo) continue;
      int64_t a = (int64_t)nmid - P.m3_block / 2, b = a + P.m3_block;  // BER over a block around the alignment
      if (a < n_lo) b += n_lo - a, a = n_lo;
      if (b > n_hi) a -= b - n_hi, b = n_hi;
      a = std::max(a, n_lo);
      uint64_t err = 0, cmp = 0;
      int nsup = 0;
      int64_t first = -1, last = -1;
      bool rej = false;
      for (int64_t n = a; n < b && !rej; n++) {
        const int64_t s = n + off;
        if (!F.valid[n] || !I.valid[s]) continue;
        const int e = __builtin_popcount(fpv[n] ^ I.fps[s]);
        err += e, cmp++, nsup += e <= 8, last = n;
        if (first < 0) first = n;
        rej = cmp == 32 && err > (uint64_t)(0.45 * 32 * 32);  // early exit
      }
      const int64_t need = std::min<int64_t>(P.m3_min_block, std::max<int64_t>(4, (int64_t)(0.8 * A.n_valid_sfp)));
      if (rej || cmp == 0 || (int64_t)cmp < need || (double)err / (32.0 * cmp) > P.m3_ber_thr) continue;
      const int64_t dsfp = off - (int64_t)A.sfp_base;
      Cand c;
      c.method = 3, c.eval_id = id, c.score = (float)(1.0 - (double)err / (32.0 * cmp)), c.n_support = nsup;
      c.lag = dsfp * 2 * HOP;
      c.c0 = first * 2 * FRAME_S, c.c1 = (last * 2.0 * HOP + NFFT) / SR;
      c.e0 = (first + dsfp) * 2 * FRAME_S, c.e1 = ((last + dsfp) * 2.0 * HOP + NFFT) / SR;
      tmp.push_back(c);
    }
  }
  best_per_id(tmp, out);
}

}  // namespace fp
