/* ================= curation pipeline as a Sankey flow (all stages visible) =================
   Geometry is built in flow coordinates: s runs along the pipeline, t across it.
   Wide screens draw s left to right; phones draw it top to bottom (x and y swapped). */
(function flow() {
  const svg = document.getElementById('flow-svg');
  const fig = svg.parentElement;
  // the moving dots are painted on a canvas behind the SVG: redrawing them every frame
  // then leaves the diagram itself untouched, instead of repainting the whole SVG (its
  // gradients, clip and haloed text) 60 times a second, which made phones stutter
  const canvas = document.createElement('canvas');
  canvas.className = 'pf-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  fig.insertBefore(canvas, svg);
  const ctx = canvas.getContext('2d');
  let cScale = 1, dpr = 1;
  function sizeCanvas() {
    const w = svg.clientWidth, h = svg.clientHeight;
    if (!w || !G) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const sr = svg.getBoundingClientRect(), fr = fig.getBoundingClientRect();
    canvas.style.left = (sr.left - fr.left) + 'px'; canvas.style.top = (sr.top - fr.top) + 'px';
    cScale = w / G.W;
  }
  const css = getComputedStyle(document.documentElement);
  const C = v => css.getPropertyValue(v).trim();

  const SOURCES = [
    { name: 'YouTube', n: 1.18e9, label: '1,180M', icon: 'youtube' },
    { name: 'Web & Common Crawl', n: 159e6, label: '159M', icon: 'web' },
    { name: 'Academic datasets', n: 84e6, label: '84M', icon: 'academic' },
    { name: 'Internet datasets', n: 10e6, label: '10M', icon: 'internet' },
  ];
  const SOURCES_INFO = 'YouTube audio comes from 32.66M Creative Commons videos, web audio from Common Crawl, plus 316 academic datasets. Everything is converted to 32 kHz, 16-bit mono and cut at silence into clips of up to 120 s.';
  // stages in order; `out` is what the following step removes
  const STAGES = [
    { name: 'Collected', n: 1.48e9, hours: '11.2M h', c: '--s-collect', out: { n: 200e6, label: 'silent, duplicate or eval data' } },
    { name: 'Deduplicated pool', n: 1.28e9, hours: '7.96M h', c: '--s-dedup', out: { n: 780e6, label: 'not selected' } },
    { name: 'Selected', n: 500e6, hours: '3.38M h', c: '--s-select' },
    { name: 'LAION-Audio-XL-500M', n: 500e6, hours: '3.35M h', c: '--s-500', out: { n: 135e6, label: 'longer than 30 s' }, release: true },
    { name: 'LAION-Audio-XL', n: 365e6, hours: '1.39M h', c: '--s-365', release: true },
  ];
  // the step between stage i and i+1: title, one-line detail, and the longer note behind the info button
  const STEPS = [
    ['Clean', 'silence, duplicates, eval', 'Silent or unreadable audio is dropped, exact duplicates are found by hash and audio fingerprint, near-duplicates with SemDeDup, and clips that overlap evaluation sets are removed.'],
    ['Annotate & select', '3,718-class taxonomy', 'Each clip gets taxonomy, language, speaker, emotion, music and species annotations. Selection then keeps 500M clips that cover the 3,718 classes, thinning common content and protecting rare categories.'],
    ['Caption', 'Qwen3-Omni, MOSS-Audio', 'Prompted with the annotations, Qwen3-Omni and MOSS-Audio write a short (12 ± 3 words) and a long (29 ± 11 words) caption for the 471M clips without text.'],
    ['Keep ≤ 30 s', '', 'LAION-Audio-XL-500M keeps every selected clip up to 120 s. Training uses its ≤ 30 s subset, LAION-Audio-XL: +4.1 MAEB-30 points at 3.5× less compute.'],
  ];

  // LAION-Audio-XL by predicted category
  const MIX = [['Speech', 44.8, '--speech'], ['Music', 22.4, '--music'], ['Sound effects', 16.6, '--sfx'], ['Other', 16.2, '--other']];
  const MIX_RUN = 110;   // length of the band over which the domains separate

  // ---------- layout per screen ----------
  const geometry = wide => wide
    ? { W: 1120, H: 372, T0: 92, K: 150 / 1.48e9, sink: 66, nodeW: 6, S: [316, 500, 684, 850, 1090], src: { s0: 186, gap: 30 } }
    : { W: 360, H: 0, T0: 2, K: 92 / 1.48e9, sink: 0, nodeW: 6, S: [196, 356, 516, 676, 836], src: null, tx: 114 };

  let G, wide;
  const th = n => Math.max(2, n * G.K);
  // flow coordinates to screen coordinates
  const pt = (s, t) => (wide ? [s, t] : [t, s]);
  const xy = (s, t) => pt(s, t).map(v => +v.toFixed(2)).join(' ');

  // band from port (s0, a0..b0) to port (s1, a1..b1), smooth in between
  function ribbon(s0, a0, b0, s1, a1, b1) {
    const m = (s0 + s1) / 2;
    return `M${xy(s0, a0)} C${xy(m, a0)} ${xy(m, a1)} ${xy(s1, a1)} L${xy(s1, b1)} C${xy(m, b1)} ${xy(m, b0)} ${xy(s0, b0)} Z`;
  }
  // a removed share turns away from the flow; edge A is its upper edge, edge B its lower edge
  function outEdges(i) {
    const st = STAGES[i], s = G.S[i] + G.nodeW / 2;
    const tA = G.T0 + th(STAGES[i + 1].n), tB = G.T0 + th(st.n), w = th(st.out.n);
    const sinkT = G.T0 + th(STAGES[0].n) + G.sink, sx = s + 18;
    return {
      A: [[s, tA], [sx + w, tA], [sx + w, tA], [sx + w, sinkT]],
      B: [[s, tB], [sx, tB], [sx, tB], [sx, sinkT]],
      tA, tB, sx, w, sinkT,
    };
  }
  const bez = (p, u) => {
    const v = 1 - u;
    return [0, 1].map(k => v * v * v * p[0][k] + 3 * v * v * u * p[1][k] + 3 * v * u * u * p[2][k] + u * u * u * p[3][k]);
  };

  // source icons (24 px grid), the same line icons as in the first animation
  const ICONS = {
    youtube: { fill: ['M10 8.8l5 3.2-5 3.2z'], stroke: ['M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z'] },
    web: { stroke: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M3 12h18', 'M12 3c3 3.2 3 14.8 0 18', 'M12 3c-3 3.2-3 14.8 0 18'] },
    academic: { stroke: ['M2 9.5l10-5 10 5-10 5z', 'M6 11.5v4.5c3.2 2.2 8.8 2.2 12 0v-4.5', 'M22 9.5v5'] },
    internet: { stroke: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'] },
  };
  // icon on a soft tile, centred at (cx, cy)
  function icon(kind, cx, cy, size, g) {
    const ic = ICONS[kind], tile = size + 10;
    U.el('rect', { x: cx - tile / 2, y: cy - tile / 2, width: tile, height: tile, rx: 7, class: 'pf-icon-tile' }, g);
    const k = size / 24, gi = U.el('g', { transform: `translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`, class: 'pf-icon' }, g);
    ic.stroke.forEach(d => U.el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gi));
    (ic.fill || []).forEach(d => U.el('path', { d, fill: 'currentColor' }, gi));
  }

  const text = (g, x, y, str, cls, anchor = 'start') => U.el('text', { x, y, class: cls, 'text-anchor': anchor, text: str }, g);
  // step detail: model names in it link to their source page
  const detailText = (g, x, y, str, anchor) => {
    const t = text(g, x, y, '', 'pf-step-detail', anchor);
    str.split(/(, )/).forEach(part => U.el('tspan', { text: part }, U.svgModelLink(t, part)));
    return t;
  };

  // ---------- info buttons and their popover ----------
  const tip = document.createElement('div');
  tip.className = 'pf-tip';
  tip.id = 'pf-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  fig.appendChild(tip);
  let tipFor = null;
  function closeTip() {
    if (tipFor) tipFor.setAttribute('aria-expanded', 'false');
    tip.hidden = true; tipFor = null;
  }
  function openTip(btn, title, body) {
    if (tipFor === btn) { closeTip(); return; }
    closeTip();
    tip.innerHTML = `<b>${title}</b><p>${body}</p>`;
    tip.hidden = false;
    tipFor = btn;
    btn.setAttribute('aria-expanded', 'true');
    const fr = fig.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = br.left + br.width / 2 - fr.left - w / 2;
    left = U.clamp(left, 0, fr.width - w);
    let top = br.bottom - fr.top + 8;
    if (top + h > fr.height + 40) top = br.top - fr.top - h - 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  document.addEventListener('click', e => { if (tipFor && !tip.contains(e.target) && !e.target.closest('.pf-info')) closeTip(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTip(); });
  function infoButton(g, x, y, title, body) {
    const b = U.el('g', { class: 'pf-info', tabindex: 0, role: 'button', 'aria-label': `More about: ${title}`, 'aria-expanded': 'false', 'aria-controls': 'pf-tip' }, g);
    U.el('circle', { cx: x, cy: y, r: 11, class: 'pf-info-hit' }, b);
    U.el('circle', { cx: x, cy: y, r: 6.5, class: 'pf-info-ring' }, b);
    U.el('path', { d: `M${x} ${y - .5} v3.6`, class: 'pf-info-i' }, b);
    U.el('circle', { cx: x, cy: y - 2.9, r: .85, class: 'pf-info-dot' }, b);
    const go = e => { e.stopPropagation(); openTip(b, title, body); };
    b.addEventListener('click', go);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    return b;
  }


  // share of each audio domain in LAION-Audio-XL, under its stage
  function composition(s) {
    const g = U.el('g', { class: 'pf-fade pf-mix' }, svg.lastChild);
    const x0 = wide ? 906 : G.tx, x1 = wide ? s + G.nodeW / 2 : G.W;
    const y0 = wide ? G.T0 + th(STAGES[4].n) + 30 : s + 50;
    text(g, x0, y0, 'By predicted category', 'pf-mix-head');
    MIX.forEach(([name, pct, c], k) => {
      const y = y0 + 22 + k * 19;
      U.el('rect', { x: x0, y: y - 9, width: 10, height: 10, rx: 2, fill: C(c) }, g);
      text(g, x0 + 17, y, name, 'pf-mix-name');
      text(g, x1, y, pct.toFixed(1) + '%', 'pf-mix-pct', 'end');
    });
    reveal.push({ s: wide ? s : s + 40, el: g });
  }

  // ---------- build ----------
  let mode = null, defs, reveal = [], counts = [], srcPorts = [], clipRect;
  function build() {
    const m = svg.clientWidth >= 640 ? 'wide' : 'narrow';
    if (m === mode) return;
    mode = m; wide = m === 'wide';
    closeTip();
    G = geometry(wide);
    if (!wide) G.H = G.S[4] + 150;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${G.W} ${G.H}`);
    svg.classList.toggle('narrow', !wide);
    defs = U.el('defs', {}, svg);
    reveal = []; counts = [];

    // the diagram is revealed along the flow by a growing clip
    const clip = U.el('clipPath', { id: 'pf-clip' }, defs);
    // the sources are there from the start: the clip begins at the "Collected" node
    R0 = wide ? G.S[0] : -20;
    clipRect = U.el('rect', { x: -20, y: -20, width: wide ? R0 + 20 : G.W + 40, height: wide ? G.H + 40 : 0 }, clip);
    const gFlow = U.el('g', { 'clip-path': 'url(#pf-clip)' }, svg);
    const gBands = U.el('g', {}, gFlow);
    canvas.style.opacity = shown && !U.reduced ? 1 : 0;   // dots only move once the intro has started
    const gNodes = U.el('g', {}, gFlow);
    const gText = U.el('g', {}, svg);

    const grad = (id, a, b, c0, c1, o0, o1, acrossFlow) => {
      const [x1, y1] = acrossFlow ? pt(0, a) : pt(a, 0), [x2, y2] = acrossFlow ? pt(0, b) : pt(b, 0);
      const g = U.el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 }, defs);
      U.el('stop', { offset: 0, 'stop-color': c0, 'stop-opacity': o0 }, g);
      U.el('stop', { offset: 1, 'stop-color': c1, 'stop-opacity': o1 }, g);
      return `url(#${id})`;
    };

    // sources: four streams of true size merging into "Collected"
    srcPorts = [];
    if (wide) {
      const s0 = G.src.s0, s1 = G.S[0] - G.nodeW / 2;
      let t = G.T0 - 18, u = G.T0;
      SOURCES.forEach((src, i) => {
        const h = th(src.n);
        srcPorts.push({ s0, a0: t, b0: t + h, s1, a1: u, b1: u + h });
        U.el('path', { d: ribbon(s0, t, t + h, s1, u, u + h), fill: grad('pf-src' + i, s0, s1, '#8a8a8a', C('--s-collect'), .14, .3) }, gBands);
        const g = U.el('g', { class: 'pf-fade in' }, gText);
        const cy = t + h / 2;
        icon(src.icon, 13, cy + 2, 16, g);
        text(g, 36, cy - 1, src.name, 'pf-src-name');
        text(g, 36, cy + 15, src.label, 'pf-src-num');
        reveal.push({ s: 0, el: g });
        t += h + G.src.gap; u += h;
      });
      const g = U.el('g', { class: 'pf-fade in' }, gText);
      text(g, 0, G.T0 - 56, 'Sources', 'pf-head');
      infoButton(g, 66, G.T0 - 60.5, 'Sources', SOURCES_INFO);
      reveal.push({ s: 0, el: g });
    } else {
      // phones: the sources are a short list above the flow
      const g = U.el('g', { class: 'pf-fade in' }, gText);
      text(g, 0, 16, 'Sources', 'pf-head');
      infoButton(g, 70, 11, 'Sources', SOURCES_INFO);
      SOURCES.forEach((src, i) => {
        const y = 48 + i * 30;
        icon(src.icon, 12, y - 5, 15, g);
        text(g, 34, y, src.name, 'pf-src-name');
        text(g, G.W, y, src.label, 'pf-src-num', 'end');
      });
      reveal.push({ s: 0, el: g });
    }

    // kept flow between stages, coloured from one stage to the next
    STAGES.forEach((st, i) => {
      if (i === STAGES.length - 1) return;
      const nx = STAGES[i + 1], s0 = G.S[i] + G.nodeW / 2, s1 = G.S[i + 1] - G.nodeW / 2, h = th(nx.n);
      U.el('path', { d: ribbon(s0, G.T0, G.T0 + h, s1, G.T0, G.T0 + h), fill: grad('pf-k' + i, s0, s1, C(st.c), C(nx.c), .3, .3) }, gBands);
      if (i === STAGES.length - 2) {
        // the final band separates into the four audio domains, sized by their share
        let cum = 0;
        MIX.forEach(([, pct, c], k) => {
          const a = G.T0 + cum * h, b = G.T0 + (cum + pct / 100) * h;
          cum += pct / 100;
          U.el('path', { d: ribbon(s1 - MIX_RUN, a, b, s1, a, b), fill: grad('pf-m' + k, s1 - MIX_RUN, s1, C(c), C(c), 0, .62) }, gBands);
        });
      }
      // the removed share turns away and fades out
      if (st.out && wide) {
        const e = outEdges(i);
        const P = p => p.map(q => xy(...q));
        const A = P(e.A), B = P(e.B);
        U.el('path', { d: `M${A[0]} C${A[1]} ${A[2]} ${A[3]} L${B[3]} C${B[2]} ${B[1]} ${B[0]} Z`, fill: grad('pf-o' + i, e.tA, e.sinkT, '#9a9a9a', '#9a9a9a', .3, 0, true) }, gBands);
        const g = U.el('g', { class: 'pf-fade' }, gText);
        if (wide) {
          text(g, e.sx, e.sinkT + 15, '−' + U.fmt(st.out.n), 'pf-out-num');
          text(g, e.sx, e.sinkT + 31, st.out.label, 'pf-out-label');
        } else {
          const y = e.sx + e.w / 2;
          text(g, e.sinkT + 8, y - 2, '−' + U.fmt(st.out.n), 'pf-out-num');
          text(g, e.sinkT + 8, y + 14, st.out.label, 'pf-out-label');
        }
        reveal.push({ s: G.S[i] + 40, el: g });
      }
      // the step: written on the band (wide) or beside it (phones), with an info button
      const [title, detail, more] = STEPS[i];
      const g = U.el('g', { class: 'pf-fade' }, gText);
      // centred in the gap between the two stage bars; the title shifts left by half the
      // info button's width so title and button together sit centred
      const sm = (G.S[i] + G.S[i + 1]) / 2;
      if (wide) {
        const tt = text(g, sm - 9.25, G.T0 + 21, title, 'pf-step-title', 'middle');
        if (detail) detailText(g, sm, G.T0 + 37, detail, 'middle');
        reveal.push({ s: sm, el: g, after: () => infoButton(g, sm - 9.25 + tt.getComputedTextLength() / 2 + 12, G.T0 + 16.5, title, more) });
      } else {
        // phones: step title, detail and what it removes, in the text column
        const y0 = sm - (st.out ? 18 : 10);
        const tt = text(g, G.tx, y0, title, 'pf-step-title');
        if (detail) detailText(g, G.tx, y0 + 17, detail);
        if (st.out) text(g, G.tx, y0 + (detail ? 34 : 17), `−${U.fmt(st.out.n)} ${st.out.label}`, 'pf-out-label');
        reveal.push({ s: sm, el: g, after: () => infoButton(g, G.tx + tt.getComputedTextLength() + 13, y0 - 4.5, title, more) });
      }
    });

    // stage nodes and their labels
    STAGES.forEach((st, i) => {
      const s = G.S[i], h = th(st.n), [x, y] = pt(s - G.nodeW / 2, G.T0), [w, hh] = pt(G.nodeW, h);
      if (i < STAGES.length - 1) U.el('rect', { x, y, width: w, height: hh, rx: 2, fill: C(st.c) }, gNodes);
      else {
        let cum = 0;
        MIX.forEach(([, pct, c]) => {
          const [mx, my] = pt(s - G.nodeW / 2 - 1, G.T0 + cum * h), [mw, mh] = pt(G.nodeW + 2, pct / 100 * h);
          U.el('rect', { x: mx, y: my, width: mw, height: mh, fill: C(c) }, gNodes);
          cum += pct / 100;
        });
        composition(s);
      }
      const g = U.el('g', { class: 'pf-fade' + (st.release ? ' rel' : '') }, gText);
      const last = i === STAGES.length - 1;
      let cnt;
      if (wide) {
        const a = last ? 'end' : 'start', lx = last ? s + G.nodeW / 2 : s - G.nodeW / 2;
        const nm = text(g, lx, G.T0 - 56, st.name, 'pf-name', a);
        nm.style.fill = C(st.c);
        // a long name that would run into the next stage's (end-anchored for the last) breaks after its last hyphen
        const room = i < STAGES.length - 2 ? G.S[i + 1] - s : (G.S[i + 1] - s) / 2;
        const cut = st.name.lastIndexOf('-');
        if (!last && cut > 0 && nm.getComputedTextLength() > room - 12) {
          nm.textContent = st.name.slice(cut + 1);
          text(g, lx, G.T0 - 72, st.name.slice(0, cut + 1), 'pf-name', a).style.fill = C(st.c);
        }
        cnt = text(g, lx, G.T0 - 28, U.fmt(st.n), 'pf-count', a);
        text(g, lx, G.T0 - 11, st.hours, 'pf-hours', a);
      } else {
        text(g, G.tx, s - 12, st.name, 'pf-name').style.fill = C(st.c);
        cnt = text(g, G.tx, s + 13, U.fmt(st.n), 'pf-count');
        text(g, G.tx + 86, s + 13, st.hours, 'pf-hours');
      }
      counts.push({ el: cnt, n: st.n, s });
      reveal.push({ s, el: g });
    });

    // info buttons need the laid-out text width; add them now (hidden until their group fades in)
    reveal.forEach(r => { if (r.after) { r.after(); r.after = null; } });
    makeDots();
    sizeCanvas();
    if (shown) finish();
  }

  // ---------- dots: travel the flow; a dot in a removed share peels off and fades ----------
  let dots = [];
  function makeDots() {
    dots = [];
    for (let i = 0; i < (wide ? 130 : 80); i++) {
      const d = { o: 0 };
      spawn(d, Math.random());
      dots.push(d);
    }
  }
  const SRC_W = SOURCES.map(s => Math.sqrt(s.n));
  function spawn(d, ahead = 0) {
    // sources weighted by the square root of their size, so the small ones still show
    let r = Math.random() * SRC_W.reduce((a, b) => a + b), k = 0;
    while (r > SRC_W[k]) r -= SRC_W[k++];
    d.src = k; d.v = .12 + Math.random() * .76;
    const start = wide ? G.src.s0 : G.S[0];
    d.s = start + ahead * (G.S[4] - start);
    d.out = -1; d.passed = -1; d.gone = undefined;
    const port = srcPorts[k];
    d.t = port ? port.a1 + d.v * (port.b1 - port.a1) : G.T0 + (.04 + Math.random() * .92) * th(STAGES[0].n);
    // dots that start mid-flow skip the removals they would already have passed
    for (let i = 0; i < 4; i++) {
      if (d.s < G.S[i]) break;
      d.passed = i;
      if (STAGES[i].out && d.t > G.T0 + th(STAGES[i + 1].n)) d.t = G.T0 + Math.random() * th(STAGES[i + 1].n);
    }
  }
  function step(d, dt) {
    if (d.out >= 0) {
      d.p += dt * .7;
      const e = outEdges(d.out), a = bez(e.A, d.p), b = bez(e.B, d.p);
      place(d, a[0] + (b[0] - a[0]) * d.q, a[1] + (b[1] - a[1]) * d.q, '#8f8f8f', Math.max(0, 1 - d.p) * .85);
      if (d.p >= 1) spawn(d);
      return;
    }
    d.s += dt * (wide ? 70 : 55);
    if (wide && d.s < G.S[0]) {
      const port = srcPorts[d.src], u = U.clamp((d.s - port.s0) / (port.s1 - port.s0), 0, 1), e = u * u * (3 - 2 * u);
      const a = port.a0 + (port.a1 - port.a0) * e, b = port.b0 + (port.b1 - port.b0) * e;
      place(d, d.s, a + (b - a) * d.v, '#8a8a8a', Math.min(1, (d.s - port.s0) / 24));
      return;
    }
    let i = 0;
    while (i < 4 && d.s >= G.S[i + 1]) i++;
    if (i >= 4) { spawn(d); return; }
    const st = STAGES[i];
    if (d.passed < i && d.s >= G.S[i]) {
      d.passed = i;
      const keep = G.T0 + th(STAGES[i + 1].n);
      if (st.out && d.t > keep) {
        if (!wide) { d.gone = d.s; }
        else {
          d.out = i; d.p = 0;
          d.q = (d.t - keep) / (G.T0 + th(st.n) - keep);
          return;
        }
      }
    }
    if (d.gone !== undefined) {
      const f = 1 - (d.s - d.gone) / 26;
      if (f <= 0) { spawn(d); return; }
      place(d, d.s, d.t, '#9a9a9a', f * .8);
      return;
    }
    let fill = C(st.c);
    if (i === 3 && d.s > G.S[4] - MIX_RUN) {
      let f = (d.t - G.T0) / th(STAGES[4].n), k = 0;
      while (k < 3 && f > MIX[k][1] / 100) f -= MIX[k++][1] / 100;
      fill = C(MIX[k][2]);
    }
    place(d, d.s, d.t, fill, Math.min(1, (G.S[4] - d.s) / 30));
  }
  function place(d, s, t, fill, o) {
    [d.x, d.y] = pt(s, t);
    d.fill = fill; d.o = o;
  }
  // only what the intro's reveal clip has uncovered is drawn
  let clipReach = Infinity;
  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = cScale * dpr, r = wide ? 2.2 : 2;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const d of dots) {
      if (!(d.o > 0) || (wide ? d.x : d.y) > clipReach) continue;
      ctx.globalAlpha = d.o;
      ctx.fillStyle = d.fill;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, 6.2832);
      ctx.fill();
    }
  }

  // ---------- entrance: the diagram draws along the flow, labels and counts follow ----------
  let shown = false, started = 0, R0 = -20;
  const DRAW = 1900;
  function finish() {
    U.busy('pipeline', false);
    if (wide) clipRect.setAttribute('width', G.W + 40); else clipRect.setAttribute('height', G.H + 40);
    clipReach = Infinity;
    reveal.forEach(r => r.el.classList.add('in'));
    counts.forEach(c => { c.el.textContent = U.fmt(c.n); });
    canvas.style.opacity = U.reduced ? 0 : 1;
  }
  function intro(t) {
    const k = U.clamp((t - started) / DRAW, 0, 1);
    // ease-out: the drawing visibly moves from the first frame
    const reach = R0 + U.ease.out(k) * ((wide ? G.W : G.H) + 20 - R0);
    if (wide) clipRect.setAttribute('width', reach + 20); else clipRect.setAttribute('height', reach + 20);
    clipReach = reach;
    reveal.forEach(r => { if (r.s <= reach + 10) r.el.classList.add('in'); });
    counts.forEach(c => {
      const local = U.clamp((reach - c.s + 40) / 180, 0, 1);
      c.el.textContent = U.fmt(Math.max(1e6, c.n * U.ease.out(local)));
    });
    if (k < 1) requestAnimationFrame(intro); else finish();
  }

  let onScreen = false, last = 0;
  new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; }).observe(svg);
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    if (!onScreen || !shown || U.reduced) return;
    for (const d of dots) step(d, dt);
    paint();
  }
  requestAnimationFrame(frame);

  build();
  U.onView(svg, () => {
    shown = true;
    if (U.reduced) { finish(); return; }
    started = performance.now();
    U.busy('pipeline', true, DRAW);
    canvas.style.opacity = 1;
    requestAnimationFrame(intro);
  }, 1);  // start as soon as the figure's top enters the screen, so there is no empty gap on load
  let rt;
  U.onWidth(() => { clearTimeout(rt); rt = setTimeout(() => { build(); sizeCanvas(); }, 150); });
  // label widths (info buttons, the hyphen break) are measured at build time: on a cold load the web font arrives
  // later, so measure again with it
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { build(); sizeCanvas(); });
  // the gradients and dots take their colours from CSS at build time, so a theme switch rebuilds the figure
  window.addEventListener('themechange', () => { mode = null; build(); sizeCanvas(); });
})();
