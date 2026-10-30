// V: waveform verification of a (corpus clip, eval audio, lag) candidate, and the significance of a verified match.
#include <algorithm>

#include "fp.hpp"

namespace fp {

static int classify(const Params& P, double rho, double psr, double lm, double ov, double cov_e, double cov_c, double dur_e) {
  if (dur_e <= P.v_short_eval_s && rho < P.v_short_rho) return 4;  // short evals: waveform identity only
  if (rho >= P.v_c0_rho && cov_e >= P.v_c0_cov && cov_c >= P.v_c0_cov) return 0;
  if (rho >= P.v_c2_rho && ov >= std::min(P.v_c2_min_overlap_s, P.v_c2_min_overlap_frac * dur_e) - 1e-6 &&
      (cov_e >= P.v_c2_cov || cov_c >= P.v_c2_cov))
    return 2;
  if ((rho >= P.v_c1_rho || (rho >= P.v_c1_rho_lm && lm >= P.v_c1_logmel)) && cov_e >= P.v_c1_cov_eval) return 1;
  if (rho >= P.v_c3_rho && psr >= P.v_c3_psr && ov >= P.v_c3_min_overlap_s) return 3;
  return 4;
}

// smooth band mask (50 Hz raised-cosine edges) on a half-complex spectrum of length N
static void band_mask(double* S, size_t N, double lo, double hi) {
  const double tw = 50.0;
  auto m = [&](double f) {
    return f <= lo - tw || f >= hi + tw ? 0.0
           : f >= lo + tw && f <= hi - tw ? 1.0
           : f < lo + tw ? 0.5 - 0.5 * std::cos(M_PI * (f - (lo - tw)) / (2 * tw))
                         : 0.5 + 0.5 * std::cos(M_PI * (f - (hi - tw)) / (2 * tw));
  };
  S[0] = 0;
  for (size_t k = 1; 2 * k - 1 < N; k++) {
    double w = m((double)k * SR / N);
    S[2 * k - 1] *= w;
    if (2 * k < N) S[2 * k] *= w;
  }
}

// multiply by exp(+2 pi i k d / N): x(t) -> x(t + d), fractional advance
static void phase_advance(double* S, size_t N, double d) {
  const double cw = std::cos(2 * M_PI * d / N), sw = std::sin(2 * M_PI * d / N);
  double c = 1, s = 0;
  for (size_t k = 1; 2 * k - 1 < N; k++) {
    double nc = c * cw - s * sw;
    s = c * sw + s * cw, c = nc;
    if (2 * k < N) {
      double re = S[2 * k - 1], im = S[2 * k];
      S[2 * k - 1] = re * c - im * s, S[2 * k] = re * s + im * c;
    } else {
      S[2 * k - 1] *= std::cos(M_PI * d);
    }
  }
}

// unnormalised inverse of a half-complex spectrum at a fractional index tau
static double hc_eval(const double* X, size_t N, double tau) {
  const double cw = std::cos(2 * M_PI * tau / N), sw = std::sin(2 * M_PI * tau / N);
  double c = 1, s = 0, acc = X[0];
  for (size_t k = 1; 2 * k - 1 < N; k++) {
    double nc = c * cw - s * sw;
    s = c * sw + s * cw, c = nc;
    acc += 2 * k < N ? 2 * (X[2 * k - 1] * c - X[2 * k] * s) : X[2 * k - 1] * std::cos(M_PI * tau);
  }
  return acc;
}

// log10 mel energies (512 / 160, 64 bands) of x, and which frames are below quiet_pow
static void logmel(RealFFT& fft, const MelBank& mel, const double* x, size_t n, std::vector<double>& out,
                   std::vector<uint8_t>& quiet, double quiet_pow) {
  const int NF = 512, H = 160;
  const size_t T = n < (size_t)NF ? 1 : (n - NF) / H + 1;
  out.assign(T * mel.n_mels, 0), quiet.assign(T, 0);
  std::vector<double> fr(NF);
  for (size_t t = 0; t < T; t++) {
    for (int i = 0; i < NF; i++) fr[i] = t * H + i < n ? x[t * H + i] * (0.5 - 0.5 * std::cos(2 * M_PI * i / NF)) : 0;
    fft.forward(fr.data(), NF);
    double tot = 0;
    for (int m = 0; m < mel.n_mels; m++) {
      double acc = 0;
      for (int k = mel.lo[m]; k < mel.hi[m]; k++) {
        double p = k == 0 ? fr[0] * fr[0] : k == NF / 2 ? fr[NF - 1] * fr[NF - 1] : fr[2 * k - 1] * fr[2 * k - 1] + fr[2 * k] * fr[2 * k];
        acc += mel.w[mel.woff[m] + k - mel.lo[m]] * p;
      }
      tot += acc, out[t * mel.n_mels + m] = std::log10(acc + 1e-10);
    }
    quiet[t] = tot < quiet_pow;
  }
}

static double pearson(const std::vector<double>& a, const std::vector<double>& b) {
  const size_t n = a.size();
  double ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0;
  for (size_t i = 0; i < n; i++) ma += a[i] / n, mb += b[i] / n;
  for (size_t i = 0; i < n; i++) sab += (a[i] - ma) * (b[i] - mb), saa += (a[i] - ma) * (a[i] - ma), sbb += (b[i] - mb) * (b[i] - mb);
  return saa > 0 && sbb > 0 ? sab / std::sqrt(saa * sbb) : 0;
}

// lag refined within +-refine_s by band-limited FFT cross-correlation over <= xc_max_s, then to a fraction of a
// sample; at that lag: matched region (longest run of 0.25 s windows with |NCC| >= local_thr, quiet windows neutral),
// rho over it, log-mel Pearson r, coverages, PSR = |NCC(peak)| / median |NCC| 0.3-2 s from the peak
void verify(const float* x, size_t nc, const int16_t* y, const EvalAudio& EA, const Params& P, const Cand& c, VRes& r) {
  struct VS {
    RealFFT fft;
    std::vector<double> A, B, X, Xs, eb, cb, cs2, xb, yb;
    std::vector<float> ncc, side;
    MelBank mel;
    double mel_lo = -1, mel_hi = -1;
  };
  static thread_local VS vs;
  const int64_t ne = EA.n, NC = (int64_t)nc;
  const double eval_dur = (double)ne / SR, lo = P.v_band_lo, hi = std::max(lo + 200.0, std::min(P.v_band_hi, 0.98 * EA.band_hz));
  r = VRes{(double)c.lag / SR, 0, 0, 0, 0, 0, 0, -60, 4, NAN, NAN, NAN, NAN};
  const int64_t lag0 = c.lag, a0 = std::max<int64_t>(0, -lag0), a1 = std::min<int64_t>(NC, ne - lag0);
  if (a1 - a0 < 160) return;
  const int64_t Lw = std::min<int64_t>(a1 - a0, (int64_t)(P.v_xc_max_s * SR)), Rf = (int64_t)(P.v_refine_s * SR);
  const int64_t R = (int64_t)((P.v_side_hi_s + P.v_refine_s + 0.05) * SR);
  int64_t center = std::max(a0 + Lw / 2, std::min(a1 - (Lw - Lw / 2), (int64_t)(0.5 * (c.c0 + c.c1) * SR)));
  const int64_t w0 = center - Lw / 2;
  const size_t N = RealFFT::good_size((size_t)(Lw + 2 * R));
  vs.A.assign(N, 0), vs.B.assign(N, 0);
  for (int64_t i = 0; i < Lw; i++) vs.A[i] = y[w0 + lag0 + i] * (1.0 / 32768.0);
  for (int64_t j = 0; j < Lw + 2 * R; j++) vs.B[j] = w0 - R + j >= 0 && w0 - R + j < NC ? x[w0 - R + j] : 0.0;
  vs.fft.forward(vs.A.data(), N), vs.fft.forward(vs.B.data(), N);
  band_mask(vs.A.data(), N, lo, hi), band_mask(vs.B.data(), N, lo, hi);
  vs.X.assign(N, 0);  // cross spectrum conj(A) B
  vs.X[0] = vs.A[0] * vs.B[0];
  for (size_t k = 1; 2 * k - 1 < N; k++) {
    double ar = vs.A[2 * k - 1], br = vs.B[2 * k - 1], ai = 2 * k < N ? vs.A[2 * k] : 0, bi = 2 * k < N ? vs.B[2 * k] : 0;
    vs.X[2 * k - 1] = ar * br + ai * bi;
    if (2 * k < N) vs.X[2 * k] = ar * bi - ai * br;
  }
  vs.Xs = vs.X, vs.eb = vs.A, vs.cb = vs.B;
  vs.fft.backward(vs.X.data(), N), vs.fft.backward(vs.eb.data(), N), vs.fft.backward(vs.cb.data(), N);
  const double invN = 1.0 / N;
  double Ee = 0;
  for (int64_t i = 0; i < Lw; i++) Ee += vs.eb[i] * invN * vs.eb[i] * invN;
  vs.cs2.assign(Lw + 2 * R + 1, 0);
  for (int64_t j = 0; j < Lw + 2 * R; j++) vs.cs2[j + 1] = vs.cs2[j] + vs.cb[j] * invN * vs.cb[j] * invN;
  const int64_t M = 2 * R + 1;
  vs.ncc.assign(M, 0);
  for (int64_t m = 0; m < M; m++) {
    double Ec = vs.cs2[m + Lw] - vs.cs2[m];
    vs.ncc[m] = Ee > 0 && Ec > 1e-12 * Lw ? (float)(vs.X[m] * invN / std::sqrt(Ee * Ec)) : 0.f;
  }
  int64_t mb = R;
  float best = -1;
  for (int64_t m = R - Rf; m <= R + Rf; m++)
    if (std::fabs(vs.ncc[m]) > best) best = std::fabs(vs.ncc[m]), mb = m;
  vs.side.clear();
  for (int64_t m = 0; m < M; m++) {
    int64_t d = std::llabs(m - mb);
    if (d >= (int64_t)(P.v_side_lo_s * SR) && d <= (int64_t)(P.v_side_hi_s * SR) && vs.ncc[m] != 0.f) vs.side.push_back(std::fabs(vs.ncc[m]));
  }
  float psr = 0;
  if (vs.side.size() >= 16) {
    std::nth_element(vs.side.begin(), vs.side.begin() + vs.side.size() / 2, vs.side.end());
    psr = vs.side[vs.side.size() / 2] > 0 ? best / vs.side[vs.side.size() / 2] : 0;
  }
  const int64_t lag = lag0 - (mb - R);
  // fractional lag: parabola on the integer NCC peak, then on the exact band-limited xcorr at +-0.1 sample
  double delta = 0;
  if (mb > 0 && mb + 1 < M && best > 0) {
    const double sg = vs.ncc[mb] >= 0 ? 1.0 : -1.0, ym = sg * vs.ncc[mb - 1], y0 = sg * vs.ncc[mb], yp = sg * vs.ncc[mb + 1];
    if (ym - 2 * y0 + yp < 0) delta = std::max(-0.5, std::min(0.5, 0.5 * (ym - yp) / (ym - 2 * y0 + yp)));
    const double h = 0.1, rm = sg * hc_eval(vs.Xs.data(), N, mb + delta - h), r0 = sg * hc_eval(vs.Xs.data(), N, mb + delta),
                 rp = sg * hc_eval(vs.Xs.data(), N, mb + delta + h);
    if (rm - 2 * r0 + rp < 0) delta += std::max(-h, std::min(h, 0.5 * h * (rm - rp) / (rm - 2 * r0 + rp)));
    delta = std::max(-0.6, std::min(0.6, delta));
    if (std::fabs(delta) < 1e-3) delta = 0;
  }
  r.offset_s = ((double)lag - delta) / SR, r.psr = psr;
  // ---- overlap at the refined lag (<= max_overlap_s around the candidate)
  int64_t b0 = std::max<int64_t>(0, -lag), b1 = std::min<int64_t>(NC, ne - lag);
  if (b1 - b0 < 160) return;
  const int64_t maxov = (int64_t)(P.v_max_overlap_s * SR);
  if (b1 - b0 > maxov) b0 = std::max(b0 + maxov / 2, std::min(b1 - maxov / 2, center)) - maxov / 2, b1 = b0 + maxov;
  const int64_t n = b1 - b0, e_lo = w0 + lag0, c_lo = w0 - R;
  size_t N2;
  if (b0 + lag >= e_lo && b1 + lag <= e_lo + Lw && b0 >= c_lo && b1 <= c_lo + Lw + 2 * R) {  // reuse the xcorr signals
    N2 = N;
    if (delta != 0) vs.cb = vs.B, phase_advance(vs.cb.data(), N, delta), vs.fft.backward(vs.cb.data(), N);
    vs.xb.assign(n, 0), vs.yb.assign(n, 0);
    for (int64_t i = 0; i < n; i++) vs.xb[i] = vs.cb[b0 + i - c_lo], vs.yb[i] = vs.eb[b0 + lag + i - e_lo];
  } else {
    N2 = RealFFT::good_size((size_t)n + 4096);
    vs.xb.assign(N2, 0), vs.yb.assign(N2, 0);
    for (int64_t i = 0; i < n; i++) vs.xb[i] = x[b0 + i], vs.yb[i] = y[b0 + lag + i] * (1.0 / 32768.0);
    vs.fft.forward(vs.xb.data(), N2), vs.fft.forward(vs.yb.data(), N2);
    band_mask(vs.xb.data(), N2, lo, hi), band_mask(vs.yb.data(), N2, lo, hi);
    phase_advance(vs.xb.data(), N2, delta);
    vs.fft.backward(vs.xb.data(), N2), vs.fft.backward(vs.yb.data(), N2);
  }
  const int64_t W = std::max<int64_t>(160, (int64_t)(P.v_win_s * SR));
  int64_t m0 = 0, m1 = n;
  if (eval_dur > P.v_short_eval_s && n > 2 * W) {  // short evals are compared over their full length
    const int64_t nw = (n + W - 1) / W;
    std::vector<int8_t> st(nw);  // 1 good, 0 neutral (quiet on both sides), -1 bad
    std::vector<double> wx(nw), wy(nw), wr(nw);
    double mx = -200, my = -200;
    for (int64_t w = 0; w < nw; w++) {
      double sxy = 0, sxx = 0, syy = 0;
      for (int64_t i = w * W; i < std::min(n, w * W + W); i++)
        sxy += vs.xb[i] * vs.yb[i], sxx += vs.xb[i] * vs.xb[i], syy += vs.yb[i] * vs.yb[i];
      const double norm = (double)N2 * N2 * (std::min(n, w * W + W) - w * W);
      wx[w] = 10 * std::log10(sxx / norm + 1e-20), wy[w] = 10 * std::log10(syy / norm + 1e-20);
      wr[w] = sxx > 0 && syy > 0 ? sxy / std::sqrt(sxx * syy) : 0;
      mx = std::max(mx, wx[w]), my = std::max(my, wy[w]);
    }
    for (int64_t w = 0; w < nw; w++) {
      const bool qx = wx[w] < P.v_quiet_floor_dbfs || wx[w] < mx - P.v_quiet_rel_db,
                 qy = wy[w] < P.v_quiet_floor_dbfs || wy[w] < my - P.v_quiet_rel_db;
      st[w] = std::fabs(wr[w]) >= P.v_local_thr ? 1 : qx && qy ? 0 : -1;
    }
    int64_t bestg = 0, bs = -1, be = -1, s = -1, g = 0, bad = 0;  // runs of good windows, <= gap_windows bad in a row
    for (int64_t w = 0; w < nw; w++) {
      if (st[w] == 1) {
        if (s < 0) s = w, g = 0;
        g++, bad = 0;
        if (g > bestg) bestg = g, bs = s, be = w;
      } else if (st[w] == -1 && s >= 0 && ++bad > P.v_gap_windows) {
        s = -1, g = 0, bad = 0;
      }
    }
    if (bs >= 0) {
      while (bs > 0 && st[bs - 1] == 0) bs--;
      while (be + 1 < nw && st[be + 1] == 0) be++;
      m0 = bs * W, m1 = std::min(n, (be + 1) * W);
    }
  }
  double sxy = 0, sxx = 0, syy = 0;
  for (int64_t i = m0; i < m1; i++) sxy += vs.xb[i] * vs.yb[i], sxx += vs.xb[i] * vs.xb[i], syy += vs.yb[i] * vs.yb[i];
  const double rho = sxx > 0 && syy > 0 ? std::fabs(sxy) / std::sqrt(sxx * syy) : 0;
  if (vs.mel_lo != lo || vs.mel_hi != hi) vs.mel.build(512, 64, lo, hi), vs.mel_lo = lo, vs.mel_hi = hi;
  std::vector<double> xr(vs.xb.begin() + m0, vs.xb.begin() + m1), yr(vs.yb.begin() + m0, vs.yb.begin() + m1), mx_, my_, a, b;
  for (auto& v : xr) v /= N2;
  for (auto& v : yr) v /= N2;
  std::vector<uint8_t> qx, qy;
  logmel(vs.fft, vs.mel, xr.data(), xr.size(), mx_, qx, std::pow(10.0, P.v_logmel_floor_db / 10.0));
  logmel(vs.fft, vs.mel, yr.data(), yr.size(), my_, qy, std::pow(10.0, P.v_logmel_floor_db / 10.0));
  for (size_t t = 0; t < qx.size(); t++)
    if (!(qx[t] && qy[t]))
      for (int m = 0; m < 64; m++) a.push_back(mx_[t * 64 + m]), b.push_back(my_[t * 64 + m]);
  r.logmel_r = a.size() >= 2 ? (float)pearson(a, b) : 0.f;
  r.rho = (float)rho, r.overlap_s = (float)((double)(m1 - m0) / SR);
  r.cov_eval = (float)std::min(1.0, r.overlap_s / eval_dur), r.cov_corpus = (float)std::min(1.0, r.overlap_s / ((double)nc / SR));
  const double r2 = std::min(rho * rho, 1.0 - 1e-6);
  r.snr_db = (float)(10 * std::log10(r2 / (1 - r2) + 1e-30));
  r.cls = classify(P, r.rho, r.psr, r.logmel_r, r.overlap_s, r.cov_eval, r.cov_corpus, eval_dur);
}

// ------------------------------------------------------------------ significance
// At V's offset (+-2 samples, the best |NCC|): both spans mean-free and band-limited on their own (V's band) in
// float64; N_eff = 2 min(B_eq T_eq) over the two sides, B_eq from the periodogram, T_eq from frame energies;
// Fisher z = atanh(|NCC|) sqrt(N_eff - 3)
struct Span {
  std::vector<double> t, spec;
};
static void bandlimit(RealFFT& fft, const double* src, int64_t n, double lo, double hi, Span& s) {
  s.t.assign(src, src + n);
  double mean = 0;
  for (double v : s.t) mean += v / n;
  for (double& v : s.t) v -= mean;
  fft.forward(s.t.data(), n);
  s.t[0] = 0;
  for (int64_t k = 1; 2 * k <= n; k++)
    if ((double)k * SR / n < lo || (double)k * SR / n > hi) {
      s.t[2 * k - 1] = 0;
      if (2 * k < n) s.t[2 * k] = 0;
    }
  s.spec = s.t;
  fft.backward(s.t.data(), n);
  for (double& v : s.t) v /= n;
}
static double b_eq(const Span& s, double lo, double hi) {
  const int64_t n = s.t.size();
  double sp = 0, sp2 = 0;
  int cnt = 0;
  for (int64_t k = 1; 2 * k <= n; k++) {
    double f = (double)k * SR / n;
    if (f < lo || f > hi) continue;
    double p = 2 * k < n ? s.spec[2 * k - 1] * s.spec[2 * k - 1] + s.spec[2 * k] * s.spec[2 * k] : s.spec[n - 1] * s.spec[n - 1];
    sp += p, sp2 += p * p, cnt++;
  }
  return sp > 0 && cnt >= 2 ? sp * sp / sp2 * SR / n : 0.0;
}
static double t_eq(const Span& s, double B) {
  const int64_t n = s.t.size(), fr = std::max<int64_t>(1, std::max<int64_t>(160, std::min<int64_t>(n / 4, (int64_t)std::nearbyint(4.0 * SR / std::max(B, 1.0)))));
  if (n / fr < 1) return (double)n / SR;
  double se = 0, se2 = 0;
  for (int64_t i = 0; i < n; i += fr) {
    double e = 0;
    for (int64_t t = i; t < std::min(n, i + fr); t++) e += s.t[t] * s.t[t];
    e *= (double)fr / (std::min(n, i + fr) - i);  // the remainder frame scaled to a full frame
    se += e, se2 += e * e;
  }
  return se2 > 0 ? se * se / se2 * fr / SR : 0.0;
}

void significance(const float* x, size_t nx, const int16_t* y, const EvalAudio& A, const Params& P, VRes& r) {
  static thread_local RealFFT fft;
  const double lo = P.v_band_lo, hi = std::max(lo + 200.0, std::min(P.v_band_hi, 0.98 * A.band_hz));
  const int64_t lag = (int64_t)std::nearbyint(r.offset_s * SR);
  Span sa, sb, ba, bb;
  bool have = false;
  double best = 0;
  int64_t pc0 = -1, pc1 = -1;
  std::vector<double> u, v;
  for (int d = -2; d <= 2; d++) {
    const int64_t L = lag + d, c0 = std::max<int64_t>(0, -L), c1 = std::min<int64_t>(nx, A.n - L), n = c1 - c0;
    if (n < 64) continue;
    if (c0 != pc0 || c1 != pc1) u.assign(x + c0, x + c1), bandlimit(fft, u.data(), n, lo, hi, sa), pc0 = c0, pc1 = c1;
    v.resize(n);
    for (int64_t i = 0; i < n; i++) v[i] = y[c0 + L + i] * (1.0 / 32768.0);
    bandlimit(fft, v.data(), n, lo, hi, sb);
    double ab = 0, aa = 0, bb2 = 0;
    for (int64_t i = 0; i < n; i++) ab += sa.t[i] * sb.t[i], aa += sa.t[i] * sa.t[i], bb2 += sb.t[i] * sb.t[i];
    const double ncc = aa * bb2 > 0 ? ab / std::sqrt(aa * bb2) : 0.0;
    if (!have || std::fabs(ncc) > std::fabs(best)) have = true, best = ncc, ba = sa, std::swap(bb, sb);
  }
  if (!have) return;
  const double Bc = b_eq(ba, lo, hi), Be = b_eq(bb, lo, hi);
  r.sig_ncc = (float)best, r.sig_overlap_s = (float)ba.t.size() / SR;
  r.sig_n_eff = (float)(2.0 * std::min(Bc * t_eq(ba, Bc), Be * t_eq(bb, Be)));
  r.sig_z = r.sig_n_eff > 3 ? (float)(std::atanh(std::min(std::fabs(best), 0.9999999)) * std::sqrt(r.sig_n_eff - 3.0)) : 0.f;
}

}  // namespace fp
