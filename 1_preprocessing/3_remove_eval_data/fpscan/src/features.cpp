// Feature extraction, identical on both sides: spectral-peak triplet (+ pair) hashes (M2) and 32-bit band-energy
// sub-fingerprints (M3) from one STFT, in chunks with context so that features do not depend on the chunking.
#include <algorithm>

#include "fp.hpp"

namespace fp {

static const int KSTFT = 481;  // bins 0..480 (7.5 kHz)
static const int NB3 = 33;     // M3 bands -> 32 bits

struct BandW {
  int k, m;
  float w;
};
struct Peak {
  uint32_t t;
  uint16_t k;
  float v;
};

// log-spaced bands [lo, hi) with fractional bin weights; start[m] = first weight of band m
static void band_weights(double lo, double hi, std::vector<BandW>& out, std::vector<int>& start) {
  out.clear(), start.assign(NB3 + 1, 0);
  const double df = (double)SR / NFFT;
  for (int m = 0; m < NB3; m++) {
    double e0 = lo * std::pow(hi / lo, (double)m / NB3), e1 = lo * std::pow(hi / lo, (double)(m + 1) / NB3);
    for (int k = std::max(0, (int)std::floor(e0 / df) - 1); k <= std::min(KSTFT - 1, (int)std::ceil(e1 / df) + 1); k++) {
      double a = std::max(e0, (k - 0.5) * df), b = std::min(e1, (k + 0.5) * df);
      if (b > a) out.push_back({k, m, (float)((b - a) / df)});
    }
    start[m + 1] = (int)out.size();
  }
}

// out[k] = max(in[k-d .. k+d]) by log2 doubling on a -inf padded copy
static void sliding_max(const float* in, float* out, int n, int d, std::vector<float>& ext) {
  const int w = 2 * d + 1, len = n + 2 * d;
  ext.assign(len, -1e30f);
  memcpy(&ext[d], in, n * sizeof(float));
  float* e = ext.data();
  int s = 1;
  for (; 2 * s <= w; s *= 2)
    for (int k = 0; k + s < len; k++) e[k] = std::max(e[k], e[k + s]);
  for (int k = 0; k < n; k++) out[k] = std::max(e[k], e[k + w - s]);
}

static inline uint32_t hash_pack(uint64_t packed) { return (uint32_t)((packed * 0x9E3779B97F4A7C15ull) >> 32); }

static inline float fast_db(float pw) {  // 10 log10, polynomial log2
  uint32_t i;
  pw += 1e-20f;
  memcpy(&i, &pw, 4);
  float e = (float)((int)((i >> 23) & 255) - 127), m;
  i = (i & 0x007FFFFFu) | 0x3F800000u;
  memcpy(&m, &i, 4);
  return 3.0102999566f * (e - 1.7417939f + (2.8212026f + (-1.4699568f + (0.44717955f - 0.056570851f * m) * m) * m) * m);
}

void extract(const float* x, size_t n, const Params& P, bool eval, int band_hz, bool pairs, bool m3_full,
             bool m3_narrow, Features& F) {
  struct WS {
    std::vector<double> cs, bmcs;
    std::vector<float> P8, L, Fm, thr, bm, ext, fdb, tmp, Ef, En, S1, S;
    std::vector<int> bmcnt;
    std::vector<uint8_t> silent;
    std::vector<Peak> peaks;
    std::vector<BandW> wf, wn;
    std::vector<int> wf0, wn0;
    double f_lo = -1, f_hi = -1, f_hn = -1;
  };
  static thread_local WS ws;
  if (ws.f_lo != P.m3_f_lo || ws.f_hi != P.m3_f_hi || ws.f_hn != P.m3_f_hi_narrow) {
    band_weights(P.m3_f_lo, P.m3_f_hi, ws.wf, ws.wf0), band_weights(P.m3_f_lo, P.m3_f_hi_narrow, ws.wn, ws.wn0);
    ws.f_lo = P.m3_f_lo, ws.f_hi = P.m3_f_hi, ws.f_hn = P.m3_f_hi_narrow;
  }
  const size_t T = n_frames_for(n);
  F.n_sfp = (T + 1) / 2;
  F.trip.clear(), F.pairs.clear();
  F.fp_full.assign(m3_full ? F.n_sfp : 0, 0), F.weak_full.assign(m3_full ? F.n_sfp : 0, 0);
  F.fp_narrow.assign(m3_narrow ? F.n_sfp : 0, 0), F.weak_narrow.assign(m3_narrow ? F.n_sfp : 0, 0);
  F.valid.assign(F.n_sfp, 0);
  ws.cs.resize(n + 1);
  ws.cs[0] = 0;
  for (size_t i = 0; i < n; i++) ws.cs[i + 1] = ws.cs[i] + (double)x[i] * x[i];
  auto ms_db = [&](int64_t a, int64_t b) -> float {  // mean square of samples [a, b) in dB
    a = std::max<int64_t>(a, 0), b = std::min<int64_t>(b, n);
    return b <= a ? -200.f : (float)(10.0 * std::log10((ws.cs[b] - ws.cs[a]) / (double)(b - a) + 1e-20));
  };
  // virtual level normalisation: the p90 frame level is taken to norm_target_db by shifting every absolute gate
  ws.fdb.resize(T), ws.tmp.clear();
  for (size_t t = 0; t < T; t++)
    if ((ws.fdb[t] = ms_db((int64_t)t * HOP, (int64_t)t * HOP + NFFT)) > -100.f) ws.tmp.push_back(ws.fdb[t]);
  float gain = 0;
  if (!ws.tmp.empty()) {
    auto k = ws.tmp.begin() + (size_t)(0.9 * (ws.tmp.size() - 1));
    std::nth_element(ws.tmp.begin(), k, ws.tmp.end());
    gain = std::max(-30.f, std::min((float)P.norm_max_gain_db, (float)P.norm_target_db - *k));
  }
  const float m2_sil = P.m2_silence_db - gain, m2_floor = P.m2_floor_db - gain, m3_sil = P.m3_silence_db - gain;
  const double fmax = eval ? std::min(P.m2_fmax_hz, 0.95 * band_hz) : P.m2_fmax_hz;
  const int kmin = P.m2_kmin, kmax = std::min(KSTFT - 1, (int)std::floor(fmax / ((double)SR / NFFT)));
  const int Kw = std::max(1, kmax - kmin + 1), nb = (Kw + P.m2_band_w - 1) / P.m2_band_w;
  const int CH = std::max(64, P.chunk_frames), MG = std::max(P.margin_frames, P.m2_zt + std::max(P.m2_dt, P.m2_mean_w) + 2);
  const int h = P.m3_smooth_half;
  ws.peaks.clear();

  for (size_t own0 = 0; own0 < T; own0 += CH) {
    const size_t own1 = std::min(T, own0 + CH), r0 = own0 >= (size_t)MG ? own0 - MG : 0, r1 = std::min(T, own1 + MG);
    const size_t R = r1 - r0;
    // ---- STFT -> dB rows over the M2 band, band energies for M3
    ws.L.resize(R * Kw), ws.silent.resize(R), ws.P8.resize(8 * KSTFT);
    ws.Ef.assign(m3_full ? R * NB3 : 0, 0.f), ws.En.assign(m3_narrow ? R * NB3 : 0, 0.f);
    for (size_t t = r0; t < r1; t += 8) {
      const size_t t1 = std::min(r1, t + 8);
      stft_power(x, n, t, t1, KSTFT, ws.P8.data());
      for (size_t f = t; f < t1; f++) {
        const float* p = &ws.P8[(f - t) * KSTFT];
        const size_t r = f - r0;
        ws.silent[r] = ws.fdb[f] < m2_sil;
        for (int k = 0; k < Kw; k++) ws.L[r * Kw + k] = ws.silent[r] ? -300.f : fast_db(p[kmin + k]);
        for (int var = 0; var < 2; var++) {
          if (!(var ? m3_narrow : m3_full)) continue;
          const auto& bw = var ? ws.wn : ws.wf;
          const auto& st = var ? ws.wn0 : ws.wf0;
          float* E = &(var ? ws.En : ws.Ef)[r * NB3];
          for (int m = 0; m < NB3; m++)
            for (int j = st[m]; j < st[m + 1]; j++) E[m] += bw[j].w * p[bw[j].k];
        }
      }
    }
    // ---- M2 peaks: local maxima (+-dt frames, +-dk bins), delta_db above the +-mean_w running mean of their band
    ws.bm.assign(R * nb, 0.f);
    for (size_t r = 0; r < R; r++)
      if (!ws.silent[r])
        for (int b = 0; b < nb; b++) {
          int k0 = b * P.m2_band_w, k1 = std::min(Kw, k0 + P.m2_band_w);
          float s0 = 0;
          for (int k = k0; k < k1; k++) s0 += ws.L[r * Kw + k];
          ws.bm[r * nb + b] = s0 / (k1 - k0);
        }
    ws.bmcs.assign((R + 1) * nb, 0.0), ws.bmcnt.assign(R + 1, 0);
    for (size_t r = 0; r < R; r++) {
      ws.bmcnt[r + 1] = ws.bmcnt[r] + !ws.silent[r];
      for (int b = 0; b < nb; b++) ws.bmcs[(r + 1) * nb + b] = ws.bmcs[r * nb + b] + ws.bm[r * nb + b];
    }
    const size_t pr0 = own0 - r0, pr1 = std::min(T, own1 + P.m2_zt + 1) - r0;
    const size_t fr0 = pr0 >= (size_t)P.m2_dt ? pr0 - P.m2_dt : 0, fr1 = std::min(R, pr1 + P.m2_dt);
    ws.Fm.resize(R * Kw), ws.thr.resize(nb);
    for (size_t r = fr0; r < fr1; r++) sliding_max(&ws.L[r * Kw], &ws.Fm[r * Kw], Kw, P.m2_dk, ws.ext);
    while (!ws.peaks.empty() && ws.peaks.back().t >= own0) ws.peaks.pop_back();  // lookahead peaks are recomputed
    for (size_t r = pr0; r < pr1; r++) {
      if (ws.silent[r]) continue;
      const size_t a = r >= (size_t)P.m2_dt ? r - P.m2_dt : 0, b = std::min(R, r + P.m2_dt + 1);
      const size_t ma = r >= (size_t)P.m2_mean_w ? r - P.m2_mean_w : 0, mb = std::min(R, r + P.m2_mean_w + 1);
      const int cnt = std::max(1, ws.bmcnt[mb] - ws.bmcnt[ma]);
      for (int bb = 0; bb < nb; bb++) ws.thr[bb] = (float)((ws.bmcs[mb * nb + bb] - ws.bmcs[ma * nb + bb]) / cnt) + P.m2_delta_db;
      for (int k = 0; k < Kw; k++) {
        const float v = ws.L[r * Kw + k];
        if (v < ws.Fm[r * Kw + k] || v < m2_floor || v < ws.thr[k / P.m2_band_w]) continue;
        bool ok = true;
        for (size_t q = a; q < b && ok; q++) ok = ws.Fm[q * Kw + k] <= v;
        if (ok) ws.peaks.push_back({(uint32_t)(r + r0), (uint16_t)(k + kmin), v});
      }
    }
    // ---- hashes of the anchors in [own0, own1): triplets (anchor + 2 of the first fanout targets), pairs
    const auto& pk = ws.peaks;
    size_t first = 0;
    while (first < pk.size() && pk[first].t < own0) first++;
    int tg[64];
    for (size_t i = first; i < pk.size() && pk[i].t < own1; i++) {
      int nt = 0;
      for (size_t j = i + 1; j < pk.size() && nt < P.m2_fanout && pk[j].t <= pk[i].t + (uint32_t)P.m2_zt; j++)
        if (std::abs((int)pk[j].k - (int)pk[i].k) <= P.m2_zk) tg[nt++] = (int)j;
      const uint64_t qa = (uint64_t)(pk[i].k - kmin);
      for (int u = 0; u < nt; u++) {
        const Peak& B = pk[tg[u]];
        const uint64_t dkb = (uint64_t)((int)B.k - (int)pk[i].k + P.m2_zk + 1), dtb = B.t - pk[i].t;
        if (pairs) F.pairs.push_back(((uint64_t)hash_pack(qa | (dkb << 10) | (dtb << 18) | (1ull << 44)) << 32) | pk[i].t);
        for (int w = u + 1; w < nt; w++) {
          const Peak& C = pk[tg[w]];
          const uint64_t dkc = (uint64_t)((int)C.k - (int)pk[i].k + P.m2_zk + 1), dtc = C.t - pk[i].t;
          uint64_t packed = qa | (dkb << 10) | (dkc << 18) | (dtb << 26) | (dtc << 32) | (2ull << 44);
          F.trip.push_back(((uint64_t)hash_pack(packed) << 32) | pk[i].t);
        }
      }
    }
    // ---- M3: band energies smoothed by two box filters (2h+1 frames), one sub-fp every 2 frames,
    //      bit m = sign of the time difference of (E_m - E_m+1); the 2 least reliable bits are recorded
    for (int var = 0; var < 2; var++) {
      if (!(var ? m3_narrow : m3_full)) continue;
      const std::vector<float>& E = var ? ws.En : ws.Ef;
      ws.S1.assign(R * NB3, 0.f), ws.S.assign(R * NB3, 0.f);
      for (int pass = 0; pass < 2; pass++) {
        const std::vector<float>& src = pass ? ws.S1 : E;
        std::vector<float>& dst = pass ? ws.S : ws.S1;
        double acc[NB3] = {0};
        for (size_t r = 0; r < std::min(R, (size_t)h); r++)
          for (int m = 0; m < NB3; m++) acc[m] += src[r * NB3 + m];
        for (size_t r = 0; r < R; r++) {
          if (r + h < R)
            for (int m = 0; m < NB3; m++) acc[m] += src[(r + h) * NB3 + m];
          if (r >= (size_t)h + 1)
            for (int m = 0; m < NB3; m++) acc[m] -= src[(r - h - 1) * NB3 + m];
          for (int m = 0; m < NB3; m++) dst[r * NB3 + m] = (float)std::max(0.0, acc[m]);
        }
      }
      std::vector<uint32_t>& FP = var ? F.fp_narrow : F.fp_full;
      std::vector<uint16_t>& WK = var ? F.weak_narrow : F.weak_full;
      for (size_t t = std::max<size_t>(2, own0 + (own0 & 1)); t < own1; t += 2) {
        const float* a = &ws.S[(t - r0) * NB3];
        const float* b = &ws.S[(t - r0 - 2) * NB3];
        uint32_t bits = 0;
        float rel1 = 1e30f, rel2 = 1e30f;
        int b1 = 0, b2 = 1;
        for (int m = 0; m < 32; m++) {
          float D = (a[m] - a[m + 1]) - (b[m] - b[m + 1]), rel = std::fabs(D) / (a[m] + a[m + 1] + b[m] + b[m + 1] + 1e-30f);
          if (D > 0) bits |= 1u << m;
          if (rel < rel1) rel2 = rel1, b2 = b1, rel1 = rel, b1 = m;
          else if (rel < rel2) rel2 = rel, b2 = m;
        }
        FP[t / 2] = bits, WK[t / 2] = (uint16_t)(b1 | (b2 << 8));
        F.valid[t / 2] = ms_db((int64_t)(t - 2 * h) * HOP, (int64_t)(t + 2 * h) * HOP + NFFT) >= m3_sil;
      }
    }
  }
  F.n_hash = (uint32_t)(F.trip.size() + F.pairs.size());
}

}  // namespace fp
