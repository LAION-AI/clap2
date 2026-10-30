// Eval index: features of every eval audio -> stop-listed hash tables (M2 triplets / pairs, M3 full / narrow band),
// the M3 sub-fingerprint streams and the per-audio table; written as raw arrays, memory-mapped by the scan.
#include <algorithm>
#include <fstream>
#include <sstream>

#include "fp.hpp"

namespace fp {

static void parallel_sort(std::vector<uint64_t>& v, Pool& pool) {  // bucket by the top 12 bits, sort buckets in parallel
  const int NBK = 4096;
  std::vector<size_t> start(NBK + 1, 0);
  for (uint64_t e : v) start[(e >> 52) + 1]++;
  for (int b = 0; b < NBK; b++) start[b + 1] += start[b];
  std::vector<uint64_t> out(v.size());
  std::vector<size_t> pos(start.begin(), start.end() - 1);
  for (uint64_t e : v) out[pos[e >> 52]++] = e;
  pool.map(NBK, [&](size_t b) { std::sort(out.begin() + start[b], out.begin() + start[b + 1]); });
  v.swap(out);
}

void Table::build(std::vector<uint64_t>& e, int stop_max) {
  size_t w = 0;  // drop keys with more than stop_max postings
  for (size_t i = 0, j; i < e.size(); i = j) {
    for (j = i; j < e.size() && (e[j] >> 32) == (e[i] >> 32); j++) {
    }
    if ((int)(j - i) <= stop_max)
      for (size_t q = i; q < j; q++) e[w++] = e[q];
  }
  e.resize(w);
  for (bits = 16; bits < 28 && ((size_t)1 << bits) * 8 < w; bits++) {  // ~8 postings per bucket
  }
  own_b.assign(((size_t)1 << bits) + 1, 0);
  for (size_t i = 0, b = 0; b < ((size_t)1 << bits); b++) {
    own_b[b] = i;
    while (i < w && ((uint32_t)(e[i] >> 32) >> (32 - bits)) == b) i++;
  }
  own_b.back() = w;
  own_p.swap(e);
  n = w, bk = own_b.data(), po = own_p.data();
}

int Index::id_of_frame(uint64_t g) const {
  return (int)(std::upper_bound(frame_base.begin(), frame_base.end(), (uint32_t)g) - frame_base.begin()) - 1;
}
int Index::id_of_sfp(uint64_t s) const {
  return (int)(std::upper_bound(sfp_base.begin(), sfp_base.end(), (uint32_t)s) - sfp_base.begin()) - 1;
}

static void write_raw(const std::string& path, const void* p, size_t n) {
  std::string tmp = path + ".tmp";
  std::ofstream f(tmp, std::ios::binary);
  f.write((const char*)p, n);
  CHECK(f.good(), "write %s", tmp.c_str());
  f.close();
  CHECK(rename(tmp.c_str(), path.c_str()) == 0, "rename %s", path.c_str());
}

void Index::build(const std::vector<EvalAudio>& in, const int16_t* pcm, const Params& P, Pool& pool,
                  const std::string& dir, const std::string& conf) {
  audios = in;
  uint64_t fb = 0, sb = 0;
  for (auto& a : audios) {
    a.n_frames = (uint32_t)n_frames_for(a.n), a.n_sfp = (a.n_frames + 1) / 2;
    a.frame_base = (uint32_t)fb, a.sfp_base = (uint32_t)sb;
    fb += a.n_frames, sb += a.n_sfp;
    CHECK(fb < (1ull << 32) && sb < (1ull << 32), "eval store too large for 32-bit frame positions");
    a.flags = (a.band_hz < P.m3_narrow_below_hz ? 1 : 0) | ((double)a.n / SR < P.m2_pair_max_eval_s ? 2 : 0);
  }
  fps_own.assign(sb, 0), valid_own.assign(sb, 0);
  std::vector<std::vector<uint64_t>> parts[4];  // per audio: m2 triplets, m2 pairs, m3 full, m3 narrow
  for (auto& p : parts) p.resize(audios.size());
  pool.map(audios.size(), [&](size_t id) {
    EvalAudio& a = audios[id];
    std::vector<float> x(a.n);
    for (int64_t i = 0; i < a.n; i++) x[i] = pcm[a.offset + i] * (1.0f / 32768.0f);
    Features F;
    extract(x.data(), x.size(), P, true, a.band_hz, a.flags & 2, !(a.flags & 1), a.flags & 1, F);
    a.n_trip = (uint32_t)F.trip.size(), a.n_pair = (uint32_t)F.pairs.size(), a.n_hash = F.n_hash, a.n_valid_sfp = 0;
    for (uint64_t e : F.trip) parts[0][id].push_back((e & ~0xFFFFFFFFull) | (uint32_t)(a.frame_base + (uint32_t)e));
    for (uint64_t e : F.pairs) parts[1][id].push_back((e & ~0xFFFFFFFFull) | (uint32_t)(a.frame_base + (uint32_t)e));
    const auto& fpv = (a.flags & 1) ? F.fp_narrow : F.fp_full;
    for (size_t q = 0; q < F.n_sfp; q++) {
      fps_own[a.sfp_base + q] = fpv[q], valid_own[a.sfp_base + q] = F.valid[q];
      if (F.valid[q]) a.n_valid_sfp++, parts[(a.flags & 1) ? 3 : 2][id].push_back(((uint64_t)mix32(fpv[q]) << 32) | (a.sfp_base + q));
    }
  });
  Table* tabs[4] = {&m2t, &m2p, &m3f, &m3n};
  const char* names[4] = {"m2t", "m2p", "m3f", "m3n"};
  std::ostringstream meta;
  for (int t = 0; t < 4; t++) {
    std::vector<uint64_t> e;
    for (auto& v : parts[t]) e.insert(e.end(), v.begin(), v.end()), std::vector<uint64_t>().swap(v);
    parallel_sort(e, pool);
    tabs[t]->build(e, t < 2 ? P.m2_stop_max : P.m3_stop_max);
    write_raw(dir + "/" + names[t] + ".bk", tabs[t]->bk, tabs[t]->own_b.size() * 8);
    write_raw(dir + "/" + names[t] + ".po", tabs[t]->po, tabs[t]->n * 8);
    meta << names[t] << " " << tabs[t]->bits << " " << tabs[t]->n << "\n";
  }
  fps = fps_own.data(), valid = valid_own.data();
  write_raw(dir + "/m3.fps", fps, sb * 4);
  write_raw(dir + "/m3.valid", valid, sb);
  write_raw(dir + "/audios.bin", audios.data(), audios.size() * sizeof(EvalAudio));
  write_raw(dir + "/tables.txt", meta.str().data(), meta.str().size());
  write_raw(dir + "/fpscan.conf", conf.data(), conf.size());
  for (auto& a : audios) frame_base.push_back(a.frame_base), sfp_base.push_back(a.sfp_base);
}

void Index::load(const std::string& dir, const std::string& conf) {
  std::ifstream c(dir + "/fpscan.conf"), t(dir + "/tables.txt"), a(dir + "/audios.bin", std::ios::binary);
  CHECK(c.good() && t.good() && a.good(), "%s: not an fpscan index", dir.c_str());
  CHECK(std::string(std::istreambuf_iterator<char>(c), {}) == conf, "%s was built with another fpscan.conf", dir.c_str());
  std::string ab((std::istreambuf_iterator<char>(a)), {});
  mfps.open(dir + "/m3.fps"), mvalid.open(dir + "/m3.valid");
  CHECK(ab.size() % sizeof(EvalAudio) == 0 && mfps.size == 4 * mvalid.size, "%s: truncated index", dir.c_str());
  audios.resize(ab.size() / sizeof(EvalAudio));
  memcpy(audios.data(), ab.data(), ab.size());
  for (Table* T : {&m2t, &m2p, &m3f, &m3n}) {
    std::string name;
    t >> name >> T->bits >> T->n;
    T->mb.open(dir + "/" + name + ".bk"), T->mp.open(dir + "/" + name + ".po");
    CHECK(T->mb.size == (((size_t)1 << T->bits) + 1) * 8 && T->mp.size == T->n * 8, "%s: bad table %s", dir.c_str(), name.c_str());
    T->bk = (const uint64_t*)T->mb.data, T->po = (const uint64_t*)T->mp.data;
  }
  fps = (const uint32_t*)mfps.data, valid = mvalid.data;
  for (auto& e : audios) frame_base.push_back(e.frame_base), sfp_base.push_back(e.sfp_base);
}

}  // namespace fp
