// fpscan: landmark hashes (M2), band-energy sub-fingerprints (M3) and waveform verification (V) of corpus audio
// against an evaluation store of 16 kHz mono int16 audio.
#pragma once
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace fp {

constexpr int SR = 16000, NFFT = 1024, HOP = 128, NBINS = NFFT / 2 + 1;
constexpr double FRAME_S = (double)HOP / SR;

[[noreturn]] void die(const char* fmt, ...);
#define CHECK(c, ...) \
  if (!(c)) ::fp::die(__VA_ARGS__)

// every key of fpscan.conf (type, name); the file must set all of them
#define FP_PARAMS(X)                                                                                                  \
  X(int, chunk_frames) X(int, margin_frames) X(double, norm_target_db) X(double, norm_max_gain_db)                   \
  X(int, m2_kmin) X(double, m2_fmax_hz) X(double, m2_floor_db) X(double, m2_silence_db) X(int, m2_mean_w)            \
  X(int, m2_band_w) X(int, m2_zt) X(int, m2_zk) X(int, m2_dt) X(int, m2_dk) X(double, m2_delta_db) X(int, m2_fanout) \
  X(double, m2_pair_max_eval_s) X(int, m2_stop_max) X(int, m2_min_votes) X(double, m2_min_span_s)                    \
  X(int, m2_min_votes_frac) X(double, m2_frac)                                                                       \
  X(double, m3_f_lo) X(double, m3_f_hi) X(double, m3_f_hi_narrow) X(int, m3_narrow_below_hz) X(int, m3_smooth_half)  \
  X(double, m3_silence_db) X(int, m3_stop_max) X(double, m3_ber_thr) X(int, m3_block) X(int, m3_min_block)          \
  X(int, m3_max_keys)                                                                                                \
  X(double, v_band_lo) X(double, v_band_hi) X(double, v_refine_s) X(double, v_side_lo_s) X(double, v_side_hi_s)      \
  X(double, v_xc_max_s) X(double, v_max_overlap_s) X(double, v_win_s) X(double, v_local_thr) X(int, v_gap_windows)   \
  X(double, v_merge_lag_s) X(double, v_quiet_rel_db) X(double, v_quiet_floor_dbfs) X(double, v_logmel_floor_db)      \
  X(double, v_c0_rho) X(double, v_c0_cov) X(double, v_c2_rho) X(double, v_c2_min_overlap_s)                          \
  X(double, v_c2_min_overlap_frac) X(double, v_c2_cov) X(double, v_c1_rho) X(double, v_c1_rho_lm)                    \
  X(double, v_c1_logmel) X(double, v_c1_cov_eval) X(double, v_c3_rho) X(double, v_c3_psr)                            \
  X(double, v_c3_min_overlap_s) X(double, v_short_eval_s) X(double, v_short_rho)

struct Params {
#define FP_FIELD(t, n) t n;
  FP_PARAMS(FP_FIELD)
#undef FP_FIELD
  void load(const std::string& text);
};

// ------------------------------------------------------------------ DSP
// FLAC bytes -> mono float32 at the native rate; returns the sample rate
int flac_decode(const uint8_t* p, size_t n, std::vector<float>& out);
void flac_info(const uint8_t* p, size_t n, int& sr, uint64_t& frames);
size_t len16k(size_t n, int sr);
void to16k(const float* x, size_t n, int sr, float* out);  // writes len16k(n, sr) samples
inline size_t n_frames_for(size_t n) { return n < (size_t)NFFT ? 1 : (n - NFFT) / HOP + 1; }
// power spectrogram, Hann 1024 / hop 128, no centring, full-scale sine = 0 dB: frames [t0, t1), bins [0, K)
void stft_power(const float* x, size_t n, size_t t0, size_t t1, int K, float* P);
struct RealFFT {  // double FFTPACK half-complex order, plans cached per size
  void forward(double* x, size_t n);
  void backward(double* x, size_t n);  // unnormalised
  static size_t good_size(size_t n);
  std::map<size_t, std::shared_ptr<void>> plans;
};
struct MelBank {  // HTK triangular filters on the power bins of an n_fft at 16 kHz
  int n_mels = 0;
  std::vector<int> lo, hi, woff;
  std::vector<float> w;
  void build(int n_fft, int nm, double fmin, double fmax);
};

// ------------------------------------------------------------------ eval store, features, index
struct EvalAudio {
  int64_t offset, n;
  int32_t band_hz;
  uint32_t flags;  // 1 narrow (second M3 table), 2 short (pair hashes)
  uint32_t frame_base, n_frames, sfp_base, n_sfp, n_trip, n_pair, n_valid_sfp, n_hash;
};

struct Features {
  size_t n_sfp = 0;
  uint32_t n_hash = 0;
  std::vector<uint64_t> trip, pairs;  // (hash32 << 32) | anchor frame
  std::vector<uint32_t> fp_full, fp_narrow;
  std::vector<uint16_t> weak_full, weak_narrow;  // two least reliable bits b1 | b2 << 8
  std::vector<uint8_t> valid;
};
void extract(const float* x, size_t n, const Params& P, bool eval, int band_hz, bool pairs, bool m3_full,
             bool m3_narrow, Features& F);
inline uint32_t mix32(uint32_t h) {
  h ^= h >> 16, h *= 0x85ebca6bu, h ^= h >> 13, h *= 0xc2b2ae35u, h ^= h >> 16;
  return h;
}

struct Mapped {  // read-only mmap of a whole file
  const uint8_t* data = nullptr;
  size_t size = 0;
  void open(const std::string& path);
  ~Mapped();
};

struct Table {  // postings (key32 << 32) | pos32 sorted, bucket = key32 >> (32 - bits)
  int bits = 0;
  size_t n = 0;
  std::vector<uint64_t> own_b, own_p;
  Mapped mb, mp;
  const uint64_t *bk = nullptr, *po = nullptr;
  void build(std::vector<uint64_t>& e, int stop_max);
  void range(uint32_t key, const uint64_t*& b, const uint64_t*& e) const {
    uint32_t k = key >> (32 - bits);
    b = po + bk[k], e = po + bk[k + 1];
  }
};

struct Pool;
struct Index {
  std::vector<EvalAudio> audios;
  Table m2t, m2p, m3f, m3n;
  std::vector<uint32_t> fps_own, frame_base, sfp_base;
  std::vector<uint8_t> valid_own;
  Mapped mfps, mvalid;
  const uint32_t* fps = nullptr;
  const uint8_t* valid = nullptr;
  int id_of_frame(uint64_t g) const;
  int id_of_sfp(uint64_t s) const;
  void build(const std::vector<EvalAudio>& in, const int16_t* pcm, const Params& P, Pool& pool, const std::string& dir,
             const std::string& conf);
  void load(const std::string& dir, const std::string& conf);
};

// ------------------------------------------------------------------ candidates and V
struct Cand {
  int method = 2, eval_id = -1, n_support = 0;
  int64_t lag = 0;  // eval sample = corpus sample + lag
  float score = 0;
  double c0 = 0, c1 = 0, e0 = 0, e1 = 0;  // matched spans (s)
};
struct VRes {
  double offset_s;  // eval time - corpus time at the refined (fractional) lag
  float rho, psr, logmel_r, overlap_s, cov_eval, cov_corpus, snr_db;
  int32_t cls;  // 0 C0, 1 C1, 2 C2, 3 C3, 4 REJECT
  float sig_ncc, sig_n_eff, sig_z, sig_overlap_s;
};
void query_m2(const Features& F, const Index& I, const Params& P, std::vector<Cand>& out);
void query_m3(const Features& F, const Index& I, const Params& P, std::vector<Cand>& out);
void verify(const float* x, size_t nc, const int16_t* y, const EvalAudio& A, const Params& P, const Cand& c, VRes& r);
void significance(const float* x, size_t nc, const int16_t* y, const EvalAudio& A, const Params& P, VRes& r);

// ------------------------------------------------------------------ thread pool
struct Pool {
  explicit Pool(int n);
  ~Pool();
  void map(size_t n, const std::function<void(size_t)>& f);  // f(0 .. n-1) on the pool; returns when all are done
  std::vector<std::thread> th;
  std::mutex mu;
  std::condition_variable cv;
  std::deque<std::function<void()>> q;
  bool stop = false;
};

}  // namespace fp
