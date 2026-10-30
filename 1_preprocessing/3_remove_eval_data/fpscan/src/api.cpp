// C interface (ctypes): open an eval store, build or load the index, read a corpus tar into 16 kHz PCM, scan it
// with M2 + M3 + V, and verify given (clip, eval audio, lag) candidates with V and the significance test.
#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <fstream>

#include "fp.hpp"

using namespace fp;

struct fp_clip {
  int64_t offset, n;  // samples in the tar's PCM
  int32_t key_off, key_len;
};
struct fp_cand {
  VRes v;
  int32_t clip, method, eval_id, n_support;
  float score;
  double c0, c1, e0, e1;
};
struct fp_req {
  int32_t clip, eval_id;
  int64_t lag;     // eval sample = corpus sample + lag
  double c0, c1;  // matched corpus span (s)
};

struct Ctx {
  Params P;
  std::string conf;
  Mapped pcm;
  std::vector<EvalAudio> audios;
  Index I;
  std::unique_ptr<Pool> pool;
  const int16_t* eval(int id) const { return (const int16_t*)pcm.data + audios[id].offset; }
};
struct Tar {
  std::vector<fp_clip> clips;
  std::string keys;
  std::vector<float> pcm;
  std::vector<fp_cand> cands;
};

static std::string read_all(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  CHECK(f.good(), "cannot read %s", path.c_str());
  return std::string((std::istreambuf_iterator<char>(f)), {});
}

static int64_t octal(const char* p, size_t n) {
  int64_t v = 0;
  for (size_t i = 0; i < n && p[i]; i++)
    if (p[i] >= '0' && p[i] <= '7') v = v * 8 + (p[i] - '0');
  return v;
}

// members of a ustar / pax / GNU tar -> (key, flac bytes) per WebDataset sample, in archive order
static std::vector<std::pair<std::string, std::pair<size_t, size_t>>> flac_members(const std::string& buf) {
  std::vector<std::pair<std::string, std::pair<size_t, size_t>>> out;
  std::string longname;
  for (size_t pos = 0; pos + 512 <= buf.size();) {
    const char* h = buf.data() + pos;
    if (std::all_of(h, h + 512, [](char c) { return c == 0; })) break;
    const int64_t size = octal(h + 124, 12);
    const char type = h[156];
    const size_t data = pos + 512;
    CHECK(data + size <= buf.size(), "truncated tar member at %zu", pos);
    pos = data + (size + 511) / 512 * 512;
    if (type == 'L') { longname = std::string(buf.data() + data, strnlen(buf.data() + data, size)); continue; }
    if (type == 'x') {  // pax records "len path=value\n"
      for (size_t p = data; p < data + size;) {
        size_t sp = buf.find(' ', p);
        size_t len = std::stoul(buf.substr(p, sp - p));
        if (buf.compare(sp + 1, 5, "path=") == 0) longname = buf.substr(sp + 6, p + len - sp - 7);
        p += len;
      }
      continue;
    }
    if (type != '0' && type != 0) continue;
    std::string name(h, strnlen(h, 100));
    if (memcmp(h + 257, "ustar", 5) == 0 && h[345]) name = std::string(h + 345, strnlen(h + 345, 155)) + "/" + name;
    if (!longname.empty()) name.swap(longname), longname.clear();
    const size_t slash = name.rfind('/'), dot = name.find('.', slash == std::string::npos ? 0 : slash + 1);
    CHECK(dot != std::string::npos, "tar member without extension: %s", name.c_str());
    const std::string key = name.substr(0, dot), ext = name.substr(dot + 1);
    if (ext == "json") continue;
    CHECK(ext == "flac", "corpus audio must be FLAC: %s", name.c_str());
    CHECK(out.empty() || out.back().first != key, "duplicate FLAC for key %s", key.c_str());
    out.push_back({key, {data, (size_t)size}});
  }
  return out;
}

extern "C" {

int64_t fp_sizeof(int what) { return what == 0 ? sizeof(fp_clip) : what == 1 ? sizeof(fp_cand) : what == 2 ? sizeof(fp_req) : sizeof(VRes); }

void* fp_open(const char* conf_path, const char* pcm_path, const int64_t* offset, const int64_t* n, const int32_t* band_hz,
              int64_t n_audios, int threads) {
  Ctx* c = new Ctx;
  c->conf = read_all(conf_path);
  c->P.load(c->conf);
  c->pcm.open(pcm_path);
  for (int64_t i = 0; i < n_audios; i++) {
    CHECK((size_t)(offset[i] + n[i]) * 2 <= c->pcm.size, "eval audio %lld beyond the end of the store", (long long)i);
    c->audios.push_back(EvalAudio{offset[i], n[i], band_hz[i], 0, 0, 0, 0, 0, 0, 0, 0, 0});
  }
  c->pool = std::make_unique<Pool>(threads);
  return c;
}

void fp_index_build(void* h, const char* dir) {
  Ctx* c = (Ctx*)h;
  c->I.build(c->audios, (const int16_t*)c->pcm.data, c->P, *c->pool, dir, c->conf);
}

void fp_index_load(void* h, const char* dir) {
  Ctx* c = (Ctx*)h;
  c->I.load(dir, c->conf);
  CHECK(c->I.audios.size() == c->audios.size(), "index of %zu audios, store of %zu", c->I.audios.size(), c->audios.size());
  for (size_t i = 0; i < c->audios.size(); i++)
    CHECK(c->I.audios[i].offset == c->audios[i].offset && c->I.audios[i].n == c->audios[i].n, "index built for another store");
}

void* fp_tar_read(void* h, const char* path) {
  Ctx* c = (Ctx*)h;
  const std::string buf = read_all(path);
  const auto mem = flac_members(buf);
  Tar* t = new Tar;
  std::vector<int> sr(mem.size());
  int64_t off = 0;
  for (size_t i = 0; i < mem.size(); i++) {
    uint64_t frames;
    flac_info((const uint8_t*)buf.data() + mem[i].second.first, mem[i].second.second, sr[i], frames);
    const int64_t n = (int64_t)len16k(frames, sr[i]);
    t->clips.push_back({off, n, (int32_t)t->keys.size(), (int32_t)mem[i].first.size()});
    t->keys += mem[i].first, off += n;
  }
  t->pcm.resize(off);
  c->pool->map(mem.size(), [&](size_t i) {
    std::vector<float> x;
    CHECK(flac_decode((const uint8_t*)buf.data() + mem[i].second.first, mem[i].second.second, x) == sr[i], "rate changed");
    to16k(x.data(), x.size(), sr[i], t->pcm.data() + t->clips[i].offset);
  });
  return t;
}

int64_t fp_tar_n(void* t) { return ((Tar*)t)->clips.size(); }
const fp_clip* fp_tar_clips(void* t) { return ((Tar*)t)->clips.data(); }
const char* fp_tar_keys(void* t) { return ((Tar*)t)->keys.data(); }
const float* fp_tar_pcm(void* t) { return ((Tar*)t)->pcm.data(); }
const fp_cand* fp_tar_cands(void* t) { return ((Tar*)t)->cands.data(); }
void fp_tar_free(void* t) { delete (Tar*)t; }

int64_t fp_tar_scan(void* h, void* tp) {
  Ctx* c = (Ctx*)h;
  Tar* t = (Tar*)tp;
  std::vector<std::vector<fp_cand>> per(t->clips.size());
  c->pool->map(t->clips.size(), [&](size_t i) {
    const float* x = t->pcm.data() + t->clips[i].offset;
    const size_t n = t->clips[i].n;
    if (n < 256) return;
    Features F;
    extract(x, n, c->P, false, 8000, true, true, true, F);
    std::vector<Cand> cs;
    query_m2(F, c->I, c->P, cs), query_m3(F, c->I, c->P, cs);
    std::stable_sort(cs.begin(), cs.end(), [](const Cand& a, const Cand& b) { return a.eval_id < b.eval_id; });
    for (size_t k = 0; k < cs.size(); k++) {  // M2 and M3 of one eval audio share one V when their lags agree
      fp_cand o{{}, (int32_t)i, cs[k].method, cs[k].eval_id, cs[k].n_support, cs[k].score, cs[k].c0, cs[k].c1, cs[k].e0, cs[k].e1};
      if (k && cs[k - 1].eval_id == cs[k].eval_id && std::llabs(cs[k].lag - cs[k - 1].lag) <= (int64_t)(c->P.v_merge_lag_s * SR))
        o.v = per[i].back().v;
      else
        verify(x, n, c->eval(cs[k].eval_id), c->audios[cs[k].eval_id], c->P, cs[k], o.v);
      per[i].push_back(o);
    }
  });
  t->cands.clear();
  for (auto& v : per) t->cands.insert(t->cands.end(), v.begin(), v.end());
  return t->cands.size();
}

void fp_verify(void* h, void* tp, const fp_req* req, int64_t n, int sig, VRes* out) {
  Ctx* c = (Ctx*)h;
  Tar* t = (Tar*)tp;
  c->pool->map(n, [&](size_t i) {
    const fp_req& q = req[i];
    CHECK(q.clip >= 0 && (size_t)q.clip < t->clips.size() && q.eval_id >= 0 && (size_t)q.eval_id < c->audios.size(), "bad request");
    const float* x = t->pcm.data() + t->clips[q.clip].offset;
    Cand cd;
    cd.eval_id = q.eval_id, cd.lag = q.lag, cd.c0 = q.c0, cd.c1 = q.c1;
    verify(x, t->clips[q.clip].n, c->eval(q.eval_id), c->audios[q.eval_id], c->P, cd, out[i]);
    if (sig) significance(x, t->clips[q.clip].n, c->eval(q.eval_id), c->audios[q.eval_id], c->P, out[i]);
  });
}

}  // extern "C"
