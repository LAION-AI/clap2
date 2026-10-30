// Shared utilities: config, mmap, thread pool, FLAC decode, resampling to 16 kHz, STFT, FFT, mel filters.
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdarg>
#include <numeric>
#include <sstream>

#include "fp.hpp"

#define DR_FLAC_IMPLEMENTATION
#define DR_FLAC_NO_STDIO
#define DR_FLAC_NO_OGG
#include "../third_party/dr_flac.h"
#include "../third_party/pocketfft_hdronly.hpp"

namespace fp {

void die(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fprintf(stderr, "fpscan: ");
  vfprintf(stderr, fmt, ap);
  fprintf(stderr, "\n");
  va_end(ap);
  abort();
}

void Params::load(const std::string& text) {
  std::map<std::string, std::string> kv;
  std::istringstream in(text);
  for (std::string line; std::getline(in, line);) {
    line = line.substr(0, line.find('#'));
    size_t eq = line.find('=');
    if (eq == std::string::npos) continue;
    std::istringstream k(line.substr(0, eq)), v(line.substr(eq + 1));
    std::string ks, vs;
    k >> ks, v >> vs;
    kv[ks] = vs;
  }
  auto take = [&](const char* n) {
    auto it = kv.find(n);
    CHECK(it != kv.end(), "config: missing key %s", n);
    double v = std::stod(it->second);
    kv.erase(it);
    return v;
  };
#define FP_LOAD(t, n) n = (t)take(#n);
  FP_PARAMS(FP_LOAD)
#undef FP_LOAD
  CHECK(kv.empty(), "config: unknown key %s", kv.begin()->first.c_str());
}

void Mapped::open(const std::string& path) {
  int fd = ::open(path.c_str(), O_RDONLY);
  CHECK(fd >= 0, "open %s", path.c_str());
  struct stat st;
  fstat(fd, &st);
  size = st.st_size;
  if (size) data = (const uint8_t*)mmap(nullptr, size, PROT_READ, MAP_SHARED, fd, 0);
  CHECK(data != MAP_FAILED, "mmap %s", path.c_str());
  ::close(fd);
}
Mapped::~Mapped() {
  if (data && size) munmap((void*)data, size);
}

Pool::Pool(int n) {
  for (int i = 0; i < n; i++)
    th.emplace_back([this] {
      for (;;) {
        std::function<void()> f;
        {
          std::unique_lock<std::mutex> lk(mu);
          cv.wait(lk, [&] { return stop || !q.empty(); });
          if (q.empty()) return;
          f = std::move(q.front());
          q.pop_front();
        }
        f();
      }
    });
}
Pool::~Pool() {
  {
    std::lock_guard<std::mutex> lk(mu);
    stop = true;
  }
  cv.notify_all();
  for (auto& t : th) t.join();
}
void Pool::map(size_t n, const std::function<void(size_t)>& f) {
  std::atomic<size_t> next{0};
  size_t k = std::min(n, th.size()), active = k;
  std::mutex m;
  std::condition_variable done;
  {
    std::lock_guard<std::mutex> lk(mu);
    for (size_t j = 0; j < k; j++)
      q.push_back([&] {
        for (size_t i; (i = next++) < n;) f(i);
        std::lock_guard<std::mutex> l(m);
        if (--active == 0) done.notify_all();
      });
  }
  cv.notify_all();
  std::unique_lock<std::mutex> lk(m);
  done.wait(lk, [&] { return active == 0; });
}

// ============================ FLAC ============================
void flac_info(const uint8_t* p, size_t n, int& sr, uint64_t& frames) {
  drflac* f = drflac_open_memory(p, n, nullptr);
  CHECK(f, "cannot open FLAC");
  sr = f->sampleRate, frames = f->totalPCMFrameCount;
  drflac_close(f);
  CHECK(frames > 0, "FLAC without a sample count");
}

int flac_decode(const uint8_t* p, size_t n, std::vector<float>& out) {
  drflac* f = drflac_open_memory(p, n, nullptr);
  CHECK(f, "cannot open FLAC");
  const int ch = f->channels;
  const size_t total = f->totalPCMFrameCount, BLK = 16384;
  std::vector<int16_t> s(BLK * ch);
  out.resize(total);
  size_t o = 0;
  for (drflac_uint64 got; (got = drflac_read_pcm_frames_s16(f, BLK, s.data())) > 0; o += got) {
    CHECK(o + got <= total, "FLAC longer than its STREAMINFO");
    for (size_t i = 0; i < got; i++) {
      int32_t acc = 0;
      for (int c = 0; c < ch; c++) acc += s[i * ch + c];
      out[o + i] = acc * (1.0f / 32768.0f / ch);
    }
  }
  int sr = f->sampleRate;
  drflac_close(f);
  CHECK(o == total, "FLAC decoded %zu of %zu frames", o, total);
  return sr;
}

// ============================ resampling ============================
static double bessel_i0(double x) {
  double s = 1, t = 1;
  for (int k = 1; k < 60 && t >= 1e-17 * s; k++) t *= (x / (2 * k)) * (x / (2 * k)), s += t;
  return s;
}
static double kaiser(double x, double beta) {
  return (x <= -1 || x >= 1) ? 0 : bessel_i0(beta * std::sqrt(1 - x * x)) / bessel_i0(beta);
}
static double sinc(double x) { return x == 0 ? 1.0 : std::sin(M_PI * x) / (M_PI * x); }

size_t len16k(size_t n, int sr) {
  return sr == SR ? n : sr == 32000 ? n / 2 : (size_t)(((unsigned __int128)n * SR) / (unsigned)sr);
}

// 32 -> 16 kHz: half-band FIR of 127 taps (Kaiser beta 10, DC gain 1); y[m] = c0 x[2m] + sum_j c_j (x[2m-2j-1] + x[2m+2j+1])
static void halfband(const float* x, size_t n, float* y) {
  const int HB = 32;
  static const std::vector<float> c = [] {
    std::vector<double> d(HB);
    double sum = 0.5;
    for (int j = 0; j < HB; j++) d[j] = 0.5 * sinc((2 * j + 1) / 2.0) * kaiser((2.0 * j + 1) / (2 * HB), 10.0), sum += 2 * d[j];
    std::vector<float> v(HB + 1);
    for (int j = 0; j < HB; j++) v[j] = (float)(d[j] / sum);
    v[HB] = (float)(0.5 / sum);
    return v;
  }();
  const size_t m_out = n / 2;
  static thread_local std::vector<float> xo_;
  xo_.assign(m_out + 2 * HB + 2, 0.f);
  float* xo = xo_.data() + HB;
  for (size_t i = 0; i < m_out; i++) xo[i] = x[2 * i + 1];
  for (size_t m0 = 0; m0 < m_out; m0 += 1024) {
    const size_t nb = std::min<size_t>(1024, m_out - m0);
    float* yb = y + m0;
    for (size_t i = 0; i < nb; i++) yb[i] = c[HB] * x[2 * (m0 + i)];
    for (int j = 0; j < HB; j++) {
      const float* a = xo + m0 - j - 1;
      const float* b = xo + m0 + j;
      for (size_t i = 0; i < nb; i++) yb[i] += c[j] * (a[i] + b[i]);
    }
  }
}

struct Poly {  // rational resampler, Kaiser-windowed sinc (beta 9), cutoff 0.94 x the lower Nyquist
  int L, M, P, half;
  std::vector<float> taps;  // P x 2 half
  explicit Poly(int sr) {
    int g = std::gcd(sr, SR);
    L = SR / g, M = sr / g, P = std::min(L, 1024);
    double ratio = (double)sr / SR, fc = 0.5 * std::min(1.0, 1.0 / ratio) * 0.94;
    half = (int)std::ceil(16 * std::max(1.0, ratio));
    const int W = 2 * half;
    taps.assign((size_t)P * W, 0.f);
    for (int ph = 0; ph < P; ph++) {
      double s = 0, frac = (double)ph / P;
      for (int j = 0; j < W; j++) {
        double t = frac + half - 1 - j, h = 2 * fc * sinc(2 * fc * t) * kaiser(t / (half + 1e-9), 9.0);
        taps[(size_t)ph * W + j] = (float)h, s += h;
      }
      for (int j = 0; j < W; j++) taps[(size_t)ph * W + j] /= (float)s;
    }
  }
};

void to16k(const float* x, size_t n, int sr, float* out) {
  if (sr == SR) return (void)std::copy(x, x + n, out);
  if (sr == 32000) return halfband(x, n, out);
  static thread_local std::map<int, std::unique_ptr<Poly>> cache;
  auto& p = cache[sr];
  if (!p) p = std::make_unique<Poly>(sr);
  const int W = 2 * p->half;
  for (size_t k = 0, m = len16k(n, sr); k < m; k++) {
    unsigned __int128 num = (unsigned __int128)k * (unsigned)p->M;
    int64_t base = (int64_t)(num / (unsigned)p->L);
    int ph = (int)(((uint64_t)(num % (unsigned)p->L) * (uint64_t)p->P) / (uint64_t)p->L);
    const float* h = &p->taps[(size_t)ph * W];
    int64_t i0 = base - p->half + 1;
    float acc = 0;
    for (int j = 0; j < W; j++)
      if (i0 + j >= 0 && i0 + j < (int64_t)n) acc += h[j] * x[i0 + j];
    out[k] = acc;
  }
}

// ============================ STFT ============================
typedef float v8f __attribute__((vector_size(32)));

void stft_power(const float* x, size_t n, size_t t0, size_t t1, int K, float* P) {
  struct Plan {
    pocketfft::detail::pocketfft_r<float> plan{NFFT};
    std::vector<float> win = std::vector<float>(NFFT);
    std::vector<v8f> vb = std::vector<v8f>(NFFT);
    float norm;
    Plan() {
      double s = 0;
      for (int i = 0; i < NFFT; i++) win[i] = (float)(0.5 - 0.5 * std::cos(2 * M_PI * i / NFFT)), s += win[i];
      norm = (float)(1.0 / ((s / 2) * (s / 2)));
    }
  };
  static thread_local Plan S;
  const float* w = S.win.data();
  for (size_t t = t0; t < t1; t += 8) {  // 8 frames per SIMD vector
    const int nl = (int)std::min<size_t>(8, t1 - t);
    if (nl == 8 && (t + 7) * HOP + NFFT <= n) {
      const float* b = x + t * HOP;
      for (int i = 0; i < NFFT; i++)
        S.vb[i] = v8f{b[i], b[i + HOP], b[i + 2 * HOP], b[i + 3 * HOP], b[i + 4 * HOP], b[i + 5 * HOP], b[i + 6 * HOP],
                      b[i + 7 * HOP]} * w[i];
    } else {
      for (int i = 0; i < NFFT; i++)
        for (int l = 0; l < 8; l++) {
          size_t s = (t + l) * HOP + i;
          S.vb[i][l] = (l < nl && s < n) ? x[s] * w[i] : 0.0f;
        }
    }
    S.plan.exec(S.vb.data(), 1.0f, true);  // half-complex: r0, r1, i1, ..., r512
    for (int l = 0; l < nl; l++) {
      float* out = P + (t + l - t0) * (size_t)K;
      out[0] = S.vb[0][l] * S.vb[0][l] * S.norm;
      for (int k = 1; k < K && k < NBINS - 1; k++)
        out[k] = (S.vb[2 * k - 1][l] * S.vb[2 * k - 1][l] + S.vb[2 * k][l] * S.vb[2 * k][l]) * S.norm;
      if (K == NBINS) out[NBINS - 1] = S.vb[NFFT - 1][l] * S.vb[NFFT - 1][l] * S.norm;
    }
  }
}

// ============================ FFT, mel ============================
static pocketfft::detail::pocketfft_r<double>& plan(RealFFT& f, size_t n) {
  if (f.plans.size() > 16 && !f.plans.count(n)) f.plans.clear();
  auto& p = f.plans[n];
  if (!p) p = std::make_shared<pocketfft::detail::pocketfft_r<double>>(n);
  return *(pocketfft::detail::pocketfft_r<double>*)p.get();
}
void RealFFT::forward(double* x, size_t n) { plan(*this, n).exec(x, 1.0, true); }
void RealFFT::backward(double* x, size_t n) { plan(*this, n).exec(x, 1.0, false); }
size_t RealFFT::good_size(size_t n) { return pocketfft::detail::util::good_size_real(n); }

void MelBank::build(int n_fft, int nm, double fmin, double fmax) {
  auto hz2mel = [](double f) { return 2595.0 * std::log10(1.0 + f / 700.0); };
  auto mel2hz = [](double m) { return 700.0 * (std::pow(10.0, m / 2595.0) - 1.0); };
  n_mels = nm;
  lo.assign(nm, 0), hi.assign(nm, 0), woff.assign(nm, 0), w.clear();
  const double m0 = hz2mel(fmin), m1 = hz2mel(fmax), df = (double)SR / n_fft;
  for (int m = 0; m < nm; m++) {
    double a = mel2hz(m0 + (m1 - m0) * m / (nm + 1)), c = mel2hz(m0 + (m1 - m0) * (m + 1) / (nm + 1)),
           b = mel2hz(m0 + (m1 - m0) * (m + 2) / (nm + 1));
    lo[m] = std::max(0, (int)std::floor(a / df)), hi[m] = std::min(n_fft / 2 + 1, (int)std::ceil(b / df) + 1);
    woff[m] = (int)w.size();
    for (int k = lo[m]; k < hi[m]; k++) {
      double f = k * df;
      w.push_back((float)(f > a && f <= c ? (f - a) / (c - a) : f > c && f < b ? (b - f) / (b - c) : 0));
    }
  }
}

}  // namespace fp
