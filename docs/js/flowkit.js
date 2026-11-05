/* ================= shared pieces for the caption-generation figure (Figure 1 style) =================
   Ribbons, gradients, icons, info popovers, canvas dots that follow ribbon routes, and the
   left-to-right reveal. Flow coordinates: s along the flow (x), t across it (y). */
window.FK = (function () {
  // colour tokens, read once per theme (the canvas dots ask for them every frame)
  let memo = {};
  const C = v => (v in memo ? memo[v] : (memo[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim()));
  const forget = () => { memo = {}; };
  window.addEventListener('themechange', forget);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', forget);
  // svg paint from a token name ('--s-dedup'), so a theme switch recolours without a rebuild
  const paint = c => (c.startsWith('--') ? `var(${c})` : c);
  const xy = (s, t) => `${+s.toFixed(2)} ${+t.toFixed(2)}`;
  const smooth = u => { u = U.clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  // band from port (s0, a0..b0) to port (s1, a1..b1), smooth in between
  function ribbon(s0, a0, b0, s1, a1, b1) {
    const m = (s0 + s1) / 2;
    return `M${xy(s0, a0)} C${xy(m, a0)} ${xy(m, a1)} ${xy(s1, a1)} L${xy(s1, b1)} C${xy(m, b1)} ${xy(m, b0)} ${xy(s0, b0)} Z`;
  }
  const seg = (s0, a0, b0, s1, a1, b1, c) => ({ s0, a0, b0, s1, a1, b1, c });
  const ribbonOf = g => ribbon(g.s0, g.a0, g.b0, g.s1, g.a1, g.b1);
  // a point at fraction v across a segment, at position s along it (the ribbon's curve, approximated)
  function across(g, s, v) {
    const e = smooth((s - g.s0) / (g.s1 - g.s0)), a = g.a0 + (g.a1 - g.a0) * e, b = g.b0 + (g.b1 - g.b0) * e;
    return a + (b - a) * v;
  }

  const ICONS = {
    wave: ['M4 10v4', 'M8 6v12', 'M12 3v18', 'M16 7v10', 'M20 10v4'],
    tag: ['M3 12V4h8l10 10-8 8z', 'M7.5 7.5h.01'],
    bubble: ['M4 5h16v11H10l-5 4v-4H4z'],
    person: ['M12 4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z', 'M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5'],
    smile: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2', 'M9 9.5h.01', 'M15 9.5h.01'],
    note: ['M9 18V5l11-2v13', 'M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0z', 'M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z'],
    meter: ['M3 12h2l2-6 3 12 3-9 2 6 2-3h4'],
    lines: ['M5 6h14', 'M5 11h14', 'M5 16h9'],
    sine: ['M2 12c2.5 0 2.5-7 5-7s2.5 14 5 14 2.5-14 5-14 2.5 7 5 7'],
    metro: ['M9 3h6l4 18H5z', 'M12 16l5-9', 'M7.5 14h9'],
    bird: ['M3 15c3 0 5-1.5 6-5 1-3.5 3.5-5.5 7-5l3 1.5-3 1.5c0 5.5-4 9-9.5 9H3z', 'M14.5 7h.01'],
  };

  const LANGS = { fij: 'Fijian', ja: 'Japanese', en: 'English' };
  const pct = p => Math.round(p * 100) + '%';
  const leaf = path => String(path).split('/').pop();
  const r4 = v => (typeof v === 'number' ? +v.toPrecision(4) : v);
  // what each expert stores, as raw metadata fields (the captioners get these as a JSON string)
  const pick = (m, keys) => { const o = {}; keys.forEach(k => { if (m[k] != null) o[k] = Array.isArray(m[k]) ? m[k].slice(0, 2).map(r4) : r4(m[k]); }); return o; };
  // the expert models, after the thesis (appendix B.2): taxonomy and signal statistics run on every clip,
  // the predicted top-level category routes speech, music and animal clips to their specialists.
  // `val` is null when the expert did not run on the clip
  const GROUPS = [
    { key: 'all', name: 'Every clip' },
    { key: 'speech', name: 'Speech' },
    { key: 'music', name: 'Music' },
    { key: 'animal', name: 'Animals' },
  ];
  const EXPERTS = [
    { key: 'category', group: 'all', name: 'Category', by: 'MLP on Dasheng-0.6B', icon: 'tag', val: m => leaf(m.tax_l3), json: m => pick(m, ['tax_l1', 'tax_l1_prob', 'tax_l3']) },
    { key: 'signal', group: 'all', name: 'Signal', by: 'signal statistics', icon: 'meter', val: m => `${m.rms_db.toFixed(0)} dB RMS, ${(m.bandwidth_hz / 1000).toFixed(1)} kHz bandwidth`, json: m => pick(m, ['rms_db', 'silence_pct', 'clip_pct', 'bandwidth_hz']) },
    { key: 'language', group: 'speech', name: 'Language', by: 'MMS-LID-4017', icon: 'bubble', val: m => m.lang_id ? `${LANGS[m.lang_id] || m.lang_id} ${pct(m.lang_prob)}` : null, json: m => pick(m, ['lang_id', 'lang_prob']) },
    { key: 'speaker', group: 'speech', name: 'Speaker', by: 'wav2vec2 age & gender', icon: 'person', val: m => m.gender ? `${m.gender}, about ${Math.round(m.age)}` : null, json: m => pick(m, ['gender', 'age']) },
    { key: 'emotion', group: 'speech', name: 'Emotion', by: 'emotion2vec+ large', icon: 'smile', val: m => m.emo_label || null, json: m => pick(m, ['emo_label']) },
    { key: 'pitch', group: 'speech', name: 'Pitch', by: 'CREPE', icon: 'sine', val: m => m.pitch_hz ? `${Math.round(m.pitch_hz)} Hz median` : null, json: m => pick(m, ['pitch_hz']) },
    { key: 'genre', group: 'music', name: 'Genre & style', by: 'MAEST', icon: 'note', val: m => m.maest_tags ? `${leaf(m.maest_tags[0].split('---').pop())} ${pct(m.maest_probs[0])}` : null, json: m => pick(m, ['maest_tags', 'maest_probs']) },
    { key: 'tempo', group: 'music', name: 'Tempo & key', by: 'librosa', icon: 'metro', val: m => m.tempo_bpm ? `${Math.round(m.tempo_bpm)} BPM, ${m.music_key}` : null, json: m => pick(m, ['tempo_bpm', 'music_key']) },
    { key: 'species', group: 'animal', name: 'Species', by: 'Perch 2.0', icon: 'bird', val: m => m.species ? m.species : null, json: m => pick(m, ['species']) },
  ];
  const time = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const model = m => m.captioning_model.split('/').pop();
  const CAT = { sound: 'Sound', music: 'Music', speech: 'Speech' };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- one figure: svg layers, gradients, text, icons, info popover ----------
  function setup(svg, W, H) {
    const fig = svg.parentElement;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = U.el('defs', {}, svg);
    let gid = 0;
    const pre = svg.id;
    const f = {
      svg, fig, W, H, defs,
      grad(a, b, c0, c1, o0, o1, vertical) {
        const id = `${pre}-g${gid++}`;
        const g = U.el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: vertical ? 0 : a, y1: vertical ? a : 0, x2: vertical ? 0 : b, y2: vertical ? b : 0 }, defs);
        U.el('stop', { offset: 0, style: `stop-color:${paint(c0)};stop-opacity:${o0}` }, g);
        U.el('stop', { offset: 1, style: `stop-color:${paint(c1)};stop-opacity:${o1}` }, g);
        return `url(#${id})`;
      },
      text(g, x, y, str, cls, anchor = 'start') { return U.el('text', { x, y, class: cls, 'text-anchor': anchor, text: str }, g); },
      icon(kind, cx, cy, size, g) {
        const tile = size + 10;
        U.el('rect', { x: cx - tile / 2, y: cy - tile / 2, width: tile, height: tile, rx: 7, class: 'pf-icon-tile' }, g);
        const gi = U.el('g', { transform: `translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 24})`, class: 'pf-icon' }, g);
        ICONS[kind].forEach(d => U.el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gi));
      },
      html(g, x, y, w, h, inner, cls = '') {
        const fo = U.el('foreignObject', { x, y, width: w, height: h, class: cls }, g);
        fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="fk-html">${inner}</div>`;
        return fo;
      },
    };
    // the diagram is revealed along the flow by a growing clip; everything outside it fades in by position
    const clip = U.el('clipPath', { id: pre + '-clip' }, defs);
    f.clipRect = U.el('rect', { x: -20, y: -40, width: 0, height: H + 80 }, clip);
    f.flow = U.el('g', { 'clip-path': `url(#${pre}-clip)` }, svg);
    f.bands = U.el('g', {}, f.flow);
    f.nodes = U.el('g', {}, svg);
    f.labels = U.el('g', {}, svg);
    f.reveal = [];
    f.fade = (g, s) => { g.classList.add('pf-fade'); f.reveal.push({ s, el: g }); return g; };

    // info popover
    let tip = fig.querySelector('.pf-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'pf-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; fig.appendChild(tip); }
    let tipFor = null;
    const closeTip = () => { if (tipFor) tipFor.setAttribute('aria-expanded', 'false'); tip.hidden = true; tipFor = null; };
    document.addEventListener('click', e => { if (tipFor && !tip.contains(e.target) && !e.target.closest('.pf-info')) closeTip(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTip(); });
    f.info = (g, x, y, title, body) => {
      const b = U.el('g', { class: 'pf-info', tabindex: 0, role: 'button', 'aria-label': `More about: ${title}`, 'aria-expanded': 'false' }, g);
      U.el('circle', { cx: x, cy: y, r: 11, class: 'pf-info-hit' }, b);
      U.el('circle', { cx: x, cy: y, r: 6.5, class: 'pf-info-ring' }, b);
      U.el('path', { d: `M${x} ${y - .5} v3.6`, class: 'pf-info-i' }, b);
      U.el('circle', { cx: x, cy: y - 2.9, r: .85, class: 'pf-info-dot' }, b);
      const go = e => {
        e.stopPropagation();
        if (tipFor === b) { closeTip(); return; }
        closeTip();
        tip.innerHTML = `<b>${title}</b><p>${body}</p>`;
        tip.hidden = false; tipFor = b; b.setAttribute('aria-expanded', 'true');
        const fr = fig.getBoundingClientRect(), br = b.getBoundingClientRect();
        tip.style.left = U.clamp(br.left + br.width / 2 - fr.left - tip.offsetWidth / 2, 0, fr.width - tip.offsetWidth) + 'px';
        tip.style.top = (br.bottom - fr.top + 8) + 'px';
      };
      b.addEventListener('click', go);
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
      return b;
    };
    return f;
  }

  // ---------- dots on a canvas behind the svg, following weighted routes ----------
  // routes(): [{ w, segs: [seg…], r? }] recomputed every frame, so ribbons can change shape under the dots
  function dots(f, routes, { n = 140, speed = 70, r = 2.2 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pf-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    f.fig.insertBefore(canvas, f.svg);
    const ctx = canvas.getContext('2d');
    let R = routes(), list = [], scale = 1, dpr = 1, reach = -Infinity, on = false;
    function size() {
      const w = f.svg.clientWidth, h = f.svg.clientHeight;
      if (!w) return;
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      scale = w / f.W;
    }
    function spawn(d, ahead = 0) {
      const tot = R.reduce((a, x) => a + x.w, 0);
      let q = Math.random() * tot, k = 0;
      while (k < R.length - 1 && q > R[k].w) q -= R[k++].w;
      d.k = k; d.v = .08 + Math.random() * .84;
      const segs = R[k].segs, s0 = segs[0].s0, s1 = segs[segs.length - 1].s1;
      d.s = s0 + ahead * (s1 - s0); d.sp = speed * (.85 + Math.random() * .3);
    }
    for (let i = 0; i < n; i++) { const d = {}; spawn(d, Math.random()); list.push(d); }
    let last = 0, visible = false, dead = false;
    new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; }).observe(f.svg);
    function frame(t) {
      if (dead) return;
      requestAnimationFrame(frame);
      const dt = Math.min(.05, (t - last) / 1000); last = t;
      if (!visible || !on || U.reduced) return;
      R = routes();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const k = scale * dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      for (const d of list) {
        const rt = R[d.k];
        if (!rt || !rt.w) { spawn(d); continue; }
        d.s += dt * d.sp;
        const segs = rt.segs, end = segs[segs.length - 1].s1;
        if (d.s >= end) { spawn(d); continue; }
        const g = segs.find(x => d.s >= x.s0 && d.s <= x.s1);
        if (!g || !g.c || d.s > reach) continue;   // between segments the dot is behind a node
        const o = Math.min(1, (d.s - segs[0].s0) / 24, (end - d.s) / 24) * (rt.o ?? 1);
        if (o <= 0) continue;
        ctx.globalAlpha = o;
        ctx.fillStyle = C(g.c);
        ctx.beginPath(); ctx.arc(d.s, across(g, d.s, d.v), rt.r || r, 0, 6.2832); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
    size();
    U.onWidth(() => { if (!dead) size(); });
    return {
      size, canvas,
      stop() { dead = true; },
      start() { on = true; canvas.style.opacity = 1; },
      setReach(x) { reach = x; },
      respawn() { list.forEach(d => spawn(d, Math.random())); },
    };
  }

  // ---------- entrance: the clip grows along the flow, labels fade in as it passes ----------
  function intro(f, { from = 0, dur = 1900, onReach, done } = {}) {
    const go = () => {
      if (U.reduced) { finish(); return; }
      const t0 = performance.now();
      U.busy(f, true, dur);
      (function tick(t) {
        const k = U.clamp((t - t0) / dur, 0, 1), reach = from + U.ease.out(k) * (f.W + 20 - from);
        f.clipRect.setAttribute('width', reach + 20);
        f.reveal.forEach(r => { if (r.s <= reach + 10) r.el.classList.add('in'); });
        if (onReach) onReach(reach);
        if (k < 1) requestAnimationFrame(tick); else finish();
      })(t0);
    };
    function finish() {
      U.busy(f, false);
      f.clipRect.setAttribute('width', f.W + 40);
      f.reveal.forEach(r => r.el.classList.add('in'));
      if (onReach) onReach(Infinity);
      if (done) done();
    }
    f.clipRect.setAttribute('width', from + 20);
    f.reveal.forEach(r => { if (r.s <= from) r.el.classList.add('in'); });
    U.onView(f.svg, go, .8);
  }

  // audio paths are relative to the page
  const base = location.pathname.includes('/tools/') ? '../' : '';
  // shared player: one clip at a time across all figures
  const audio = new Audio(); audio.preload = 'none';
  let playing = null;
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  function stop() {
    if (playing) { playing.classList.remove('playing'); const b = playing.querySelector('.play'); if (b) { b.innerHTML = PLAY; b.setAttribute('aria-label', 'Play the clip'); } }
    audio.pause(); playing = null;
  }
  // a clip that can't play (missing file, offline, blocked) resets the button and says so for a moment
  function failed() {
    const box = playing; stop();
    if (!box) return;
    let note = box.querySelector('.fk-err');
    if (!note) { note = document.createElement('span'); note.className = 'fk-err'; note.setAttribute('role', 'status'); box.appendChild(note); }
    note.textContent = 'Couldn\u2019t play this clip. Check your connection and try again.';
    clearTimeout(note._t); note._t = setTimeout(() => note.remove(), 4000);
  }
  audio.addEventListener('ended', stop);
  audio.addEventListener('error', () => { if (playing) failed(); });
  // paused from outside the page (media keys, headphones unplugged, a phone call): the button follows
  audio.addEventListener('pause', () => { if (playing && audio.paused && !audio.ended) stop(); });
  U.solo(audio, stop);
  // play button and waveform, filled into `box`
  function player(box, src, bars = 48) {
    if (playing === box) stop();   // the box is being refilled with another clip: the old one stops first
    box.classList.add('fk-aud');
    box.innerHTML = `<button type="button" class="play" aria-label="Play the clip">${PLAY}</button>`;
    const w = U.el('svg', { class: 'fk-wave', viewBox: `0 0 ${bars * 4} 24`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, box);
    const rects = Array.from({ length: bars }, (_, k) => U.el('rect', { x: k * 4, y: 11, width: 2.4, height: 2, rx: 1.2 }, w));
    U.audioPeaks(base + src, bars).then(pk => pk.forEach((p, k) => { const h = Math.max(2, p * 22); rects[k].setAttribute('y', 12 - h / 2); rects[k].setAttribute('height', h); })).catch(() => {});
    box.querySelector('.play').addEventListener('click', () => {
      if (playing === box) { stop(); return; }
      stop(); audio.src = base + src;
      playing = box; box.classList.add('playing');
      const b = box.querySelector('.play'); b.innerHTML = PAUSE; b.setAttribute('aria-label', 'Pause the clip');
      box.querySelector('.fk-err')?.remove();
      audio.play().catch(e => { if (playing === box && e.name !== 'AbortError') failed(); });
    });
  }
  const playingIn = el => playing && el.contains(playing);

  // steps through the samples on its own, pausing while off screen, while a clip plays, while paused by
  // the reader and while anything holds it (the pointer over the figure, focus in the clip switcher).
  // onPick(i, how): how is 'auto' or 'user'; onTick(fraction of the hold elapsed, waiting) every frame
  function cycle(watch, onPick, { hold = 7000, first = 0, onTick } = {}) {
    const n = window.DATA.samples.length, holds = new Set();
    let cur = ((first % n) + n) % n, t0 = performance.now(), done = 0, visible = false, paused = false, dead = false;
    const io = new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; });
    io.observe(watch.closest('.row') || watch);
    const go = (i, how) => { cur = ((i % n) + n) % n; t0 = performance.now(); done = 0; onPick(cur, how); };
    (function tick(t) {
      if (dead) return;
      requestAnimationFrame(tick);
      const waiting = !visible || !!playing || paused || holds.size > 0;
      if (waiting) t0 = t - done;
      else { done = t - t0; if (done >= hold) { go(cur + 1, 'auto'); t0 = t; } }
      if (onTick) onTick(Math.min(1, done / hold), waiting);
    })(performance.now());
    return {
      n, get cur() { return cur; }, get paused() { return paused; },
      pause(v) { paused = v; },
      hold(key, v) { if (v) holds.add(key); else holds.delete(key); },
      stop() { dead = true; io.disconnect(); },
      go: i => go(i, 'user'),
      next() { go(cur + 1, 'user'); },
      prev() { go(cur - 1, 'user'); },
    };
  }

  // ---------- the clip switcher: "Clip 2 of 3", previous / pause / next, one entry per example ----------
  // The current entry's mark fills while it is shown; the fill stops while the cycle waits.
  // `host` gets the markup; `hover` is the area whose pointer holds the cycle (mouse only: a tap never leaves)
  const NAV_ICO = {
    prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>',
    pause: '<path d="M9 6v12M15 6v12"/>', play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  };
  const navIcon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICO[k]}</svg>`;
  function clipNav(host, hover) {
    const S = window.DATA.samples, n = S.length;
    const label = m => leaf(m.tax_l3);
    host.classList.add('cn');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Example clips');
    host.innerHTML = `<div class="cn-top"><p class="cn-of" aria-hidden="true">Clip <b>1</b> of ${n}</p>
      <div class="cn-btns"><button type="button" class="cn-b pv" aria-label="Previous clip">${navIcon('prev')}</button><button type="button" class="cn-b pz"></button><button type="button" class="cn-b nx" aria-label="Next clip">${navIcon('next')}</button></div></div>
      <ol class="cn-list">${S.map((s, i) => `<li><button type="button" class="cn-it" data-i="${i}" aria-label="Clip ${i + 1} of ${n}: ${esc(label(s.meta))}">
        <span class="cn-bar" aria-hidden="true"><i></i></span><span class="cn-n" aria-hidden="true">${i + 1}</span>
        <span class="cn-t" aria-hidden="true"><span class="cn-l">${esc(label(s.meta))}</span><small>${esc(s.meta.tax_l1 || '')}</small></span></button></li>`).join('')}</ol>
      <p class="sr-only cn-live" aria-live="polite" aria-atomic="true"></p>`;
    const items = [...host.querySelectorAll('.cn-it')], bars = items.map(b => b.querySelector('.cn-bar i'));
    const pz = host.querySelector('.pz'), live = host.querySelector('.cn-live'), of = host.querySelector('.cn-of b');
    let cyc = null, cur = -1;
    const paintPz = () => {
      pz.innerHTML = navIcon(cyc.paused ? 'play' : 'pause');
      pz.setAttribute('aria-label', cyc.paused ? 'Resume stepping through the clips' : 'Pause stepping through the clips');
      pz.setAttribute('aria-pressed', String(cyc.paused));
      host.classList.toggle('paused', cyc.paused);
    };
    const nav = {
      bind(c) {
        cyc = c;
        host.querySelector('.pv').onclick = () => cyc.prev();
        host.querySelector('.nx').onclick = () => cyc.next();
        pz.onclick = () => { cyc.pause(!cyc.paused); paintPz(); };
        items.forEach((b, i) => { b.onclick = () => { if (i !== cyc.cur) cyc.go(i); }; });
        // reading the figure holds the autoplay: the mouse over it, or keyboard focus in the switcher
        if (hover) {
          hover.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') cyc.hold('hover', true); });
          hover.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cyc.hold('hover', false); });
        }
        host.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) cyc.hold('focus', true); });
        host.addEventListener('focusout', e => { if (!host.contains(e.relatedTarget)) cyc.hold('focus', false); });
        paintPz();
        nav.mark(cyc.cur, 'init');
        return nav;
      },
      // the clip changed; tell screen readers only when the reader asked for it
      mark(i, how) {
        cur = i;
        of.textContent = i + 1;
        items.forEach((b, k) => { b.classList.toggle('on', k === i); if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
        bars.forEach((b, k) => { if (k !== i) b.style.removeProperty('--p'); });
        if (how === 'user') live.textContent = `Clip ${i + 1} of ${n}: ${label(S[i].meta)}, captioned by ${model(S[i].meta)}`;
      },
      tick(frac, waiting) {
        if (cur < 0) return;
        bars[cur].style.setProperty('--p', frac.toFixed(4));
        host.classList.toggle('waiting', waiting);
      },
    };
    return nav;
  }

  return { C, paint, xy, ribbon, ribbonOf, seg, across, smooth, setup, dots, intro, player, playingIn, stop, cycle, clipNav, EXPERTS, GROUPS, ICONS, time, model, CAT, esc, pct };
})();
