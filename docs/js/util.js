// Canvas roundRect fallback for older browsers (Safari < 16, Firefox < 112).
if (window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.max(0, Math.min(Array.isArray(r) ? r[0] : r || 0, w / 2, h / 2));
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

const U = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ease = {
    inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    outBack: t => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // Fire cb once when the element is properly in view: its top has passed `at` (default 55%)
  // of the viewport height, or the whole element is visible. Starting earlier (as soon as it
  // peeks in at the bottom) meant animations had finished before readers got there.
  const pending = [];
  function checkPending() {
    const vh = window.innerHeight;
    for (let i = pending.length - 1; i >= 0; i--) {
      const { elm, cb, at } = pending[i];
      const r = elm.getBoundingClientRect();
      if (!r.height) continue;
      // in view as described above, or already scrolled past (e.g. after a reload mid-page)
      if (r.top < vh * at || r.bottom <= vh * 0.95) { pending.splice(i, 1); cb(); }
    }
  }
  let ticking = false;
  const schedule = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; checkPending(); }); } };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // `at`: how far up the viewport the element's top must come (0.55 = just above the middle)
  function onView(elm, cb, at = 0.55) {
    pending.push({ elm, cb, at });
    schedule();
  }
  // Report visibility changes continuously.
  function watchView(elm, cb, threshold = 0.15) {
    new IntersectionObserver(es => es.forEach(e => cb(e.isIntersecting)), { threshold }).observe(elm);
  }

  function countUp(elm, dur = 1600) {
    const to = parseFloat(elm.dataset.count);
    const dec = parseInt(elm.dataset.dec || '0', 10);
    const pre = elm.dataset.prefix || '';
    const suf = elm.dataset.suffix || '';
    const t0 = performance.now();
    (function tick(now) {
      const t = clamp((now - t0) / dur, 0, 1);
      elm.textContent = pre + (to * ease.out(t)).toFixed(dec) + suf;
      if (t < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function fmt(v, digits = 3) {
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [d, u] of units) {
      if (v >= d) {
        const x = v / d;
        return String(Number(x.toPrecision(digits))) + u;
      }
    }
    return String(Math.round(v));
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // waveform peaks (0..1) of an audio file, decoded once and cached per file
  const peakCache = new Map();
  let actx = null;
  function audioPeaks(src, bins) {
    const key = src + '|' + bins;
    if (peakCache.has(key)) return peakCache.get(key);
    const p = fetch(src).then(r => r.arrayBuffer()).then(buf => {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      return new Promise((ok, fail) => actx.decodeAudioData(buf, ok, fail));
    }).then(audio => {
      const ch = audio.getChannelData(0), step = Math.floor(ch.length / bins), out = [];
      for (let i = 0; i < bins; i++) {
        let m = 0;
        for (let j = i * step; j < (i + 1) * step; j += 4) m = Math.max(m, Math.abs(ch[j]));
        out.push(m);
      }
      const top = Math.max(...out) || 1;
      return out.map(v => v / top);
    });
    peakCache.set(key, p);
    return p;
  }

  // Collapses a paragraph to three lines (CSS .clamped) with a toggle after it.
  // The toggle only shows when the text is actually cut off.
  function clampText(p, labels = ['Show full caption', 'Show less']) {
    p.classList.add('clamped');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clamp-btn';
    btn.textContent = labels[0];
    btn.setAttribute('aria-expanded', 'false');
    p.after(btn);
    const check = () => { if (!p.classList.contains('open')) btn.hidden = p.scrollHeight <= p.clientHeight + 1; };
    btn.addEventListener('click', () => {
      const open = p.classList.toggle('open');
      btn.textContent = labels[open ? 1 : 0];
      btn.setAttribute('aria-expanded', open);
    });
    check();
    requestAnimationFrame(check);
    if (document.fonts) document.fonts.ready.then(check);
    if (window.ResizeObserver) new ResizeObserver(check).observe(p);
    return btn;
  }

  // Source page of a model or dataset by its display name (js/model-links.js), or null.
  const modelUrl = n => ((window.DATA && window.DATA.links) || {})[n] || null;
  // HTML link to the model's source page; just the escaped-as-given label when there is none.
  const modelLink = (n, label = n) => {
    const u = modelUrl(n);
    return u ? `<a class="mlink" href="${u}" target="_blank" rel="noopener" title="${n}: source">${label}</a>` : label;
  };
  // SVG: a link group to put a model's mark or label in; the parent itself when there is no link.
  const svgModelLink = (parent, n) => {
    const u = modelUrl(n);
    return u ? el('a', { href: u, target: '_blank', rel: 'noopener', class: 'mlink', 'aria-label': n + ': source' }, parent) : parent;
  };

  // one clip at a time across the page: every player registers its audio element and how to reset its own buttons;
  // when one starts, any other that is playing is paused and reset
  const players = new Map();
  function solo(audio, reset = () => {}) {
    players.set(audio, reset);
    audio.addEventListener('play', () => players.forEach((r, a) => { if (a !== audio && !a.paused) { a.pause(); r(); } }));
  }

  // a figure animation starting or ending; Lio (js/ask.js) looks impressed while any is running.
  // ms: how long it will run from here (he ignores anything shorter than a second)
  function busy(key, on, ms = Infinity) { document.dispatchEvent(new CustomEvent('figure-anim', { detail: { key, on: !!on, ms } })); }

  // a resize that changes the width. On phones the browser bar sliding in and out while scrolling fires resize
  // with only the height changed; no figure depends on the height, so redrawing then would only make scrolling stutter
  // The handlers run once the resize has settled: during the resize event itself the grid has not been laid out at
  // the new width yet (a figure column still measures its old width), so a figure checking its size then would keep
  // its phone or desktop layout. One handler failing must not stop the others.
  let lastW = innerWidth, settle = 0;
  const widthFns = [];
  window.addEventListener('resize', () => {
    clearTimeout(settle);
    settle = setTimeout(() => requestAnimationFrame(() => {
      if (innerWidth === lastW) return;
      lastW = innerWidth;
      widthFns.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    }), 120);
  });
  const onWidth = fn => widthFns.push(fn);

  return { busy, solo, onWidth, el, rng, ease, clamp, lerp, hex, mix, rgba, onView, watchView, countUp, fmt, reduced, audioPeaks, clampText, modelUrl, modelLink, svgModelLink };
})();
