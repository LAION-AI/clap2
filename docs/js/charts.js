const D = window.DATA;
const SC = window.SCALING;
// Exponents as real superscripts: IBM Plex Sans only has the glyphs ¹²³, so Unicode
// superscripts would mix fonts (e.g. in 10¹⁰).
function pow10(el, e) {
  el.textContent = '10';
  U.el('tspan', { dy: '-0.45em', 'font-size': '0.8em', text: e }, el);
  return el;
}
// N_opt / D_opt with a real subscript, for SVG text (innerHTML); rest follows on the baseline
const optSym = (sym, rest = '') => `${sym}<tspan font-size="0.72em" dy="0.3em">opt</tspan><tspan dy="-0.216em">${rest}</tspan>`;
const isCompact = el => el.parentElement.clientWidth < 600;
// Log axes: calls draw(v) for the minor gridlines at 2–9 × 10^k strictly between lo and hi (log10 units).
function logMinor(lo, hi, draw) {
  for (let e = Math.floor(lo); e < hi; e++)
    for (let m = 2; m < 10; m++) { const v = e + Math.log10(m); if (v > lo && v < hi) draw(v); }
}

// L(C) = A (C + e^B)^-alpha + E, with C in GFLOPs (paper, Figs. 3 and 4)
const law = f => c => f.A * Math.pow(c + Math.exp(f.B), -f.alpha) + f.E;

// Shared axis frame for the log-compute charts. Returns scales.
function frame(svg, o) {
  const c = o.compact;
  const M = c ? { l: 82, r: 16, t: 14, b: 60 } : { l: 64, r: 16, t: 14, b: 50 };
  const W = c ? 520 : 820, H = c ? o.hc : o.h;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.toggle('compact', c);
  svg.innerHTML = '';
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const X = v => M.l + (v - o.x[0]) / (o.x[1] - o.x[0]) * pw;
  const Y = v => M.t + (v - o.y[1]) / (o.y[0] - o.y[1]) * ph;
  const g = U.el('g', { class: 'axis' }, svg);
  o.yt.forEach(v => {
    U.el('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, g);
    U.el('text', { x: M.l - 10, y: Y(v) + 4, 'text-anchor': 'end', text: v.toFixed(2) }, g);
  });
  logMinor(o.x[0], o.x[1], v => U.el('line', { class: 'minor', x1: X(v), x2: X(v), y1: M.t, y2: H - M.b }, g));
  o.xt.forEach(v => {
    U.el('line', { x1: X(v), x2: X(v), y1: M.t, y2: H - M.b }, g);
    pow10(U.el('text', { x: X(v), y: H - M.b + (c ? 26 : 20), 'text-anchor': 'middle' }, g), v);
  });
  U.el('text', { x: M.l + pw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title', text: 'Compute C (GFLOPs)' }, svg);
  U.el('text', { 'text-anchor': 'middle', class: 'axis-title', text: c ? o.ylabelShort : o.ylabel, transform: `translate(15 ${M.t + ph / 2}) rotate(-90)` }, svg);
  return { X, Y, M, W, H, c };
}

function lawPath(f, X, Y, x0, x1, steps = 120) {
  const L = law(f);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const lx = x0 + (x1 - x0) * i / steps;
    d += (i ? 'L' : 'M') + X(lx).toFixed(1) + ' ' + Y(L(Math.pow(10, lx))).toFixed(1);
  }
  return d;
}

// Paper-style background: 95% CI band, every run as a faint dot, the fit, and the
// compute-optimal runs used for the fit as solid dots.
function fitLayer(svg, X, Y, data, f, color, c, x1) {
  const g = U.el('g', {}, svg);
  const band = U.el('path', { d: 'M' + data.band.map(([x, y]) => X(x).toFixed(1) + ' ' + Y(y).toFixed(1)).join('L') + 'Z', fill: color, opacity: .16 }, g);
  const runs = U.el('g', { fill: color, opacity: .16 }, g);
  data.runs.forEach(([x, y]) => U.el('circle', { cx: X(x), cy: Y(y), r: c ? 4 : 2.8 }, runs));
  const line = U.el('path', { d: lawPath(f, X, Y, 7.85, x1), fill: 'none', stroke: color, 'stroke-width': c ? 2.6 : 1.8 }, g);
  const opt = U.el('g', { fill: color, opacity: .6 }, g);
  data.pareto.forEach(([x, y]) => U.el('circle', { cx: X(x), cy: Y(y), r: c ? 4.6 : 3.2 }, opt));
  return { g, band, runs, line, opt };
}

/* ================= dataset comparison (linear scale) ================= */
(function compare() {
  const box = document.getElementById('cmp-bars');
  if (!box) return;
  const ROW = 30;
  const cfg = {
    hours: v => U.fmt(v) + ' h',
    captions: v => U.fmt(v),
    audio: v => U.fmt(v),
  };
  box.style.height = D.datasets.length * ROW + 'px';
  const rows = D.datasets.map(d => {
    const r = document.createElement('div');
    r.className = 'brow' + (d.ours ? ' ours' : '') + ' acc-' + d.access;
    // not released: a lock before the name
    const lock = d.access === 'closed' ? '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' : '';
    r.innerHTML = `<div class="bn">${lock}<span class="bname">${U.modelLink(d.name)}</span></div><div class="bt"><div class="bf"></div><div class="bv"></div></div>`;
    box.appendChild(r);
    return { d, r, f: r.querySelector('.bf'), v: r.querySelector('.bv') };
  });
  let key = 'hours', shown = false;
  function render() {
    const max = Math.max(...D.datasets.map(d => d[key] ?? 0));
    // the largest public dataset for this measure gets a hint after its value
    const top = rows.filter(o => o.d.access === 'public' && o.d[key] != null).sort((a, b) => b.d[key] - a.d[key])[0];
    rows.slice().sort((a, b) => (b.d[key] ?? -1) - (a.d[key] ?? -1)).forEach((o, i) => {
      const v = o.d[key];
      o.r.style.top = i * ROW + 'px';
      o.r.classList.toggle('na', v == null);
      const w = shown && v != null ? v / max * 80 : 0;
      o.f.style.width = w + '%';
      o.v.style.left = w + '%';
      o.v.textContent = v == null ? (key === 'captions' ? 'no captions' : 'not reported') : cfg[key](v);
      if (o === top) o.v.insertAdjacentHTML('beforeend', '<span class="bhint">largest public dataset</span>');
    });
  }
  document.querySelectorAll('#cmp-toggle button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#cmp-toggle button').forEach(x => x.classList.toggle('on', x === b));
    key = b.dataset.k; render();
  }));
  render();
  U.onView(box, () => { shown = true; render(); });
})();

/* ================= scaling: fit with CI, all runs, per-size curves ================= */
(function scaling() {
  const svg = document.getElementById('scale-chart');
  if (!svg) return;
  let F, series = [], env, fit, rings = new Map(), compact = null, focus = null, hl = null, fitOn = false;
  // The animation sweeps a compute budget cx (log10 GFLOPs) from left to right.
  const CMIN = 7.85, CMAX = 12.05;
  // slider: 0–100 sweeps the compute budget, then a dotted gap leads to a last stop (FIT_V)
  // that shows the fitted law and its CI; values in the gap snap to the nearer end
  const FIT_V = 125;
  // past the largest run (CLAP2-L at 1,024M samples) the law is drawn as an extrapolation
  const XEXT = Math.max(...SC.all.pareto.map(p => p[0]));
  // start empty so nothing shows before the first sweep (reduced motion starts on the full chart)
  let cx = U.reduced ? CMAX : CMIN, playing = false, last = 0, cursor;
  const range = document.getElementById('sc-range');
  const val = document.getElementById('sc-val');
  const playBtn = document.getElementById('sc-play');
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

  function build() {
    const c = isCompact(svg);
    if (c === compact) return;
    compact = c;
    F = frame(svg, {
      compact: c, h: 440, hc: 480, x: [7.75, 12.45], y: [.415, .74],
      xt: [8, 9, 10, 11, 12], yt: [.45, .50, .55, .60, .65, .70],
      ylabel: 'MAEB-30 benchmark error (1 − mean score)', ylabelShort: 'MAEB-30 benchmark error',
    });
    const { X, Y } = F;
    svg._geom = F;   // read by js/scale-link.js (prototype)

    cursor = U.el('g', { 'pointer-events': 'none' }, svg);
    cursor.style.transition = 'opacity .4s';
    U.el('line', { y1: F.M.t, y2: F.H - F.M.b, stroke: '#9a9a9a', 'stroke-width': 1, 'stroke-dasharray': '2 3' }, cursor);
    series = D.sizes.map(sz => {
      const g = U.el('g', {}, svg);
      g.style.transition = 'opacity .6s';
      const path = U.el('path', { fill: 'none', stroke: sz.color, 'stroke-width': c ? 2.6 : 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
      const pts = D.curves[sz.id].map(([x, s]) => [x, 1 - s]);
      const dots = pts.map(([x, e], i) => {
        const el = U.el('circle', { cx: X(x), cy: Y(e), r: 0, fill: sz.color, stroke: 'var(--bg)', 'stroke-width': 1 }, g);
        return el;
      });
      return { sz, g, path, dots, pts };
    });
    env = U.el('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }, svg);
    // rings marking the runs that currently form the envelope
    rings = new Map();
    const gr = U.el('g', { 'pointer-events': 'none' }, svg);
    series.forEach((s, si) => s.pts.forEach(([x, e], i) => {
      rings.set(si + '-' + i, U.el('circle', { class: 'pv', cx: X(x), cy: Y(e), r: c ? 8 : 5.5 }, gr));
    }));
    envY.fill(NaN); envEnd = EX0;

    // second part, drawn on top: the fitted scaling law with its CI, all runs and the fit points
    fit = fitLayer(svg, X, Y, SC.all, D.fit, 'var(--fit)', c, XEXT);
    fit.line.setAttribute('stroke-width', c ? 3.4 : 2.6);
    fit.eq = U.el('text', { x: X(c ? 7.85 : 7.95), y: Y(.445), class: 'annot-sub halo', style: 'fill:var(--fit)' }, fit.g);
    const fs = c ? 14 : 11;
    fit.eq.innerHTML = `L(C) = 2.22 (C + e<tspan dy="-6" font-size="${fs}">19.76</tspan><tspan dy="6">)</tspan><tspan dy="-6" font-size="${fs}">−0.0574</tspan>`;
    // the extrapolation reaches as far as the allocation chart below
    fit.ext = U.el('path', { d: lawPath(D.fit, X, Y, XEXT, 12.35, 20), fill: 'none', stroke: 'var(--fit)', 'stroke-width': c ? 2.6 : 1.8, 'stroke-dasharray': '5 5', 'stroke-linecap': 'round' }, fit.g);
    fit.len = fit.line.getTotalLength();
    fit.line.style.strokeDasharray = fit.len;
    fit.g.style.transition = 'opacity .25s';
    // highlight overlays, drawn independently of the fit's reveal so they also work before it
    fit.bandHi = U.el('path', { d: fit.band.getAttribute('d'), fill: 'var(--fit)', 'fill-opacity': .3, stroke: 'var(--fit)', 'stroke-width': 1, 'stroke-opacity': .7, 'pointer-events': 'none' }, svg);
    fit.lineHi = U.el('path', { d: fit.line.getAttribute('d'), fill: 'none', stroke: 'var(--fit)', 'stroke-width': c ? 4.2 : 3.2, 'pointer-events': 'none' }, svg);
    [fit.bandHi, fit.lineHi].forEach(e => { e.style.transition = 'opacity .25s'; e.style.opacity = 0; });
    env.style.transition = 'opacity .25s';
    fitOn ? showFit(false) : hideFit();
  }

  const FIT_PARTS = [['band', .16, 0], ['line', 1, .2], ['ext', .7, 1.4], ['runs', .2, .9], ['opt', .65, 1.3], ['eq', 1, 1.5]];
  function showFit(animate) {
    fitOn = true;
    svg.classList.add('fit-on');
    FIT_PARTS.forEach(([key, op, delay]) => {
      const e = fit[key];
      e.style.transition = animate ? `opacity .6s ${delay}s, stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1) ${delay}s` : 'none';
      e.setAttribute('opacity', op);
    });
    fit.line.style.strokeDashoffset = 0;
    setFocus(focus);
    syncRange();
  }
  function hideFit() {
    fitOn = false;
    svg.classList.remove('fit-on');
    FIT_PARTS.forEach(([key]) => { fit[key].style.transition = 'none'; fit[key].setAttribute('opacity', 0); });
    fit.line.style.strokeDashoffset = fit.len;
    setFocus(focus);
    syncRange();
  }
  function syncRange() {
    range.value = fitOn ? FIT_V : Math.round((cx - CMIN) / (CMAX - CMIN) * 100);
    range.classList.toggle('at-fit', fitOn);
    const e = Math.floor(cx), m = Math.pow(10, cx - e);
    val.innerHTML = fitOn ? 'Fitted law + 95% CI' : `${m.toFixed(1)} × 10<sup>${e}</sup> GFLOPs`;
    range.setAttribute('aria-valuetext', fitOn ? 'Full budget with the fitted scaling law and its 95% CI' : `${m.toFixed(1)} times 10 to the ${e} GFLOPs`);
  }

  function render() {
    const { X, Y } = F;
    series.forEach(s => {
      // each line runs up to the current compute budget
      const full = s.pts.filter(p => p[0] <= cx + 1e-9).length - 1;
      let d = '';
      for (let i = 0; i <= full; i++) d += (i ? 'L' : 'M') + X(s.pts[i][0]).toFixed(1) + ' ' + Y(s.pts[i][1]).toFixed(1);
      if (full >= 0 && full + 1 < s.pts.length) {
        const a = s.pts[full], b = s.pts[full + 1], f = (cx - a[0]) / (b[0] - a[0]);
        d += 'L' + X(cx).toFixed(1) + ' ' + Y(U.lerp(a[1], b[1], f)).toFixed(1);
      }
      s.path.setAttribute('d', d);
      s.dots.forEach((c, i) => c.setAttribute('r', i <= full ? (compact ? 4.5 : 3) : 0));
    });
    // compute-Pareto envelope over the runs that have landed: the lowest error reached
    // at or below each compute. Runs on it get a ring; the drawn line eases toward it.
    const vis = [];
    series.forEach((s, si) => s.pts.forEach((p, i) => { if (p[0] <= cx + 1e-9) vis.push({ p, key: si + '-' + i }); }));
    vis.sort((a, b) => a.p[0] - b.p[0]);
    let best = 2;
    envTarget = [];
    const onFront = new Set();
    vis.forEach(v => { if (v.p[1] < best) { best = v.p[1]; envTarget.push(v.p); onFront.add(v.key); } });
    rings.forEach((r, key) => r.classList.toggle('on', onFront.has(key)));
    if (!envAnim) envAnim = requestAnimationFrame(envStep);
    // shown in GFLOPs, like both chart axes and the compute-budget readout
    syncRange();
    cursor.setAttribute('transform', `translate(${X(cx).toFixed(1)} 0)`);
    cursor.setAttribute('opacity', fitOn || cx >= CMAX ? 0 : 1);
  }

  // The envelope is drawn from samples on a fixed compute grid that ease toward the
  // target envelope, so it glides instead of jumping when the frontier changes.
  const EG = 160, EX0 = 7.85, EX1 = 12.1;
  const envY = new Array(EG + 1).fill(NaN);
  let envTarget = [], envEnd = EX0, envAnim = null;
  function envAt(x) {
    const t = envTarget;
    if (!t.length || x < t[0][0] || x > t[t.length - 1][0]) return NaN;
    for (let i = 1; i < t.length; i++) if (x <= t[i][0]) {
      const f = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0] || 1);
      return U.lerp(t[i - 1][1], t[i][1], f);
    }
    return t[t.length - 1][1];
  }
  function envStep() {
    envAnim = null;
    const { X, Y } = F;
    const endT = envTarget.length ? envTarget[envTarget.length - 1][0] : EX0;
    envEnd += (endT - envEnd) * (U.reduced ? 1 : .09);
    let moving = Math.abs(endT - envEnd) > 1e-3, d = '';
    for (let i = 0; i <= EG; i++) {
      const x = EX0 + (EX1 - EX0) * i / EG;
      const tgt = envAt(Math.min(x, endT));
      if (isNaN(tgt)) { envY[i] = NaN; continue; }
      envY[i] = isNaN(envY[i]) ? tgt : envY[i] + (tgt - envY[i]) * (U.reduced ? 1 : .12);
      if (Math.abs(tgt - envY[i]) > 1e-4) moving = true;
      if (x > envEnd) break;
      d += (d ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(envY[i]).toFixed(1);
    }
    env.setAttribute('d', d);
    if (moving || playing) envAnim = requestAnimationFrame(envStep);
  }

  function tick(t) {
    if (!playing) return;
    const dt = (t - (last || t)) / 1000; last = t;
    cx = Math.min(CMAX, cx + dt * (CMAX - CMIN) / 3.3);   // full sweep in 3.3 s
    render();
    if (cx >= CMAX) { setPlaying(false); setTimeout(() => { if (cx >= CMAX && !playing) showFit(true); }, 350); return; }
    requestAnimationFrame(tick);
  }
  function setPlaying(p) {
    playing = p; last = 0;
    U.busy('scaling', p, (CMAX - cx) / (CMAX - CMIN) * 3300);
    playBtn.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (p) requestAnimationFrame(tick);
  }
  playBtn.addEventListener('click', () => {
    if (playing) return setPlaying(false);
    if (cx >= CMAX) cx = CMIN;
    if (fitOn) hideFit();
    setPlaying(true);
  });
  range.addEventListener('input', () => {
    setPlaying(false);
    const v = +range.value;
    if (v > 100 && v >= (100 + FIT_V) / 2) {
      cx = CMAX; render();
      if (!fitOn) showFit(true); else syncRange();
      return;
    }
    // full budget and everything below it: all the runs, no fit
    cx = CMIN + (CMAX - CMIN) * Math.min(v, 100) / 100;
    if (fitOn) hideFit();
    render();
  });

  // the size row toggles focus on one model size
  const legend = document.getElementById('sc-legend');
  const sizeRow = document.getElementById('size-row');
  // the size discs beside the chart are the colour key for the model sizes (and toggle focus);
  // this legend only adds the two lines that aren't model sizes
  // hovering (or focusing) a legend entry highlights that layer and steps everything else back
  [['front', '<i class="lg-front"></i>Pareto front'],
   ['fit', '<i class="lg-fit"></i>Fitted scaling law'],
   ['band', '<i class="lg-ci"></i>95% CI of the fit']].forEach(([key, html]) => {
    const k = document.createElement('span');
    k.className = 'hl-key';
    k.tabIndex = 0;
    k.innerHTML = html;
    k.addEventListener('pointerenter', () => setHighlight(key));
    k.addEventListener('pointerleave', () => setHighlight(null));
    k.addEventListener('focus', () => setHighlight(key));
    k.addEventListener('blur', () => setHighlight(null));
    legend.appendChild(k);
  });
  const sizeEls = D.sizes.map(sz => {
    const e = document.createElement('div');
    e.className = 'size';
    const dia = 10 * Math.sqrt(sz.params / 27.3);
    e.innerHTML = `<span class="disc"><i style="width:${dia}px;height:${dia}px;background:${sz.color}"></i></span><b>${sz.label}</b>`;
    e.addEventListener('click', () => setFocus(focus === sz.id ? null : sz.id));
    e.addEventListener('pointerenter', () => setHighlight(sz.id));
    e.addEventListener('pointerleave', () => setHighlight(null));
    sizeRow.appendChild(e);
    return e;
  });
  sizeEls.forEach(e => e.classList.add('in'));
  function setFocus(id) {
    focus = id;
    sizeEls.forEach((e, i) => e.classList.toggle('dim', !!id && D.sizes[i].id !== id));
    applyEmphasis();
  }
  // Transient highlight from hovering: null, a model size id, 'front', 'fit' or 'band'.
  // Only one thing is emphasised at a time, so everything else (the fit included) steps back.
  function setHighlight(h) {
    if (h === hl) return;
    hl = h;
    applyEmphasis();
  }
  function applyEmphasis() {
    if (!fit) return;
    const size = hl && D.sizes.some(sz => sz.id === hl) ? hl : null;
    series.forEach(s => {
      let op;
      if (size) op = s.sz.id === size ? 1 : .12;
      else if (hl) op = .15;
      // once the fit is shown the size curves step back so the fit reads first
      else op = (!focus || s.sz.id === focus ? 1 : .12) * (fitOn ? .35 : 1);
      s.g.style.opacity = op;
    });
    fit.g.style.opacity = hl && hl !== 'fit' ? .15 : 1;
    env.style.opacity = hl && hl !== 'front' ? .2 : 1;
    env.setAttribute('stroke-width', hl === 'front' ? (compact ? 3 : 2.4) : 1.4);
    svg.classList.toggle('hl-front', hl === 'front');
    fit.bandHi.style.opacity = hl === 'band' ? 1 : 0;
    fit.lineHi.style.opacity = hl === 'fit' ? 1 : 0;
  }

  // hover: the nearest visible run gets a ring and a tooltip with size, samples seen, score and compute
  const wrap = svg.parentElement;
  wrap.classList.add('chart-wrap');
  const tip = document.createElement('div');
  tip.className = 'tip';
  wrap.appendChild(tip);
  let hoverRing = null;
  function hover(ev) {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const reach = (compact ? 30 : 20);
    let best = null, bd = reach * reach;
    series.forEach(sr => {
      if (focus && sr.sz.id !== focus) return;
      sr.dots.forEach((d, i) => {
        if (!(parseFloat(d.getAttribute('r')) > 0)) return;   // not reached by the compute sweep yet
        const dx = +d.getAttribute('cx') - p.x, dy = +d.getAttribute('cy') - p.y, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = { sr, i, d }; }
      });
    });
    if (!best) { unhover(); return; }
    const { sr, i, d } = best;
    setHighlight(sr.sz.id);
    const [lx, err] = sr.pts[i];
    const e10 = Math.floor(lx), mant = Math.pow(10, lx - e10);
    tip.innerHTML = `<b style="color:${sr.sz.color}">●</b> <b>CLAP2-${sr.sz.label} (${Math.round(sr.sz.params)}M)</b> · ${D.samplesSeen[i]} samples seen<br>MAEB-30 ${((1 - err) * 100).toFixed(1)}% <span>· error ${err.toFixed(3)}</span><br><span>${mant.toFixed(1)} × 10<sup>${e10}</sup> GFLOPs</span>`;
    const r = svg.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const k = r.width / svg.viewBox.baseVal.width;
    tip.style.left = (r.left - w.left + +d.getAttribute('cx') * k) + 'px';
    tip.style.top = (r.top - w.top + +d.getAttribute('cy') * k) + 'px';
    tip.style.opacity = 1;
    if (!hoverRing) hoverRing = U.el('circle', { fill: 'none', 'stroke-width': 2, 'pointer-events': 'none' }, svg);
    hoverRing.setAttribute('cx', d.getAttribute('cx'));
    hoverRing.setAttribute('cy', d.getAttribute('cy'));
    hoverRing.setAttribute('r', compact ? 10 : 7.5);
    hoverRing.setAttribute('stroke', sr.sz.color);
    hoverRing.style.display = '';
    svg.appendChild(hoverRing);
  }
  function unhover() {
    tip.style.opacity = 0;
    if (hoverRing) hoverRing.style.display = 'none';
    setHighlight(null);
  }
  svg.addEventListener('pointermove', hover);
  svg.addEventListener('pointerleave', unhover);

  build();
  render();
  U.onWidth(() => { const was = compact; build(); if (was !== compact) { hoverRing = null; render(); } });
  U.onView(svg, () => {
    if (U.reduced) { cx = CMAX; render(); showFit(false); return; }
    hideFit(); cx = CMIN; render(); setTimeout(() => setPlaying(true), 500);
  }, .45);
})();

/* ================= compute-optimal allocation ================= */
(function alloc() {
  const svg = document.getElementById('alloc-svg');
  if (!svg) return;
  const A = D.allocFit;
  const N = c => A.n0 * Math.pow(c / 1e12, A.a);
  const Dd = c => A.d0 * Math.pow(c / 1e12, A.b);
  // the compute axis starts at the smallest measured budget (no extrapolation below it) and
  // runs past the largest; the slider spans all of it
  const lc0 = D.allocation[0][0], lc1 = 12.35;
  const range = document.getElementById('al-range');
  const outN = document.getElementById('al-n'), outD = document.getElementById('al-d'), outE = document.getElementById('al-e');
  const outC = document.getElementById('al-c'), outX = document.getElementById('al-x');
  let compact = null, el = {}, X, YN, YD, M, W, H;

  function build() {
    const c = isCompact(svg);
    if (c === compact) return;
    compact = c;
    M = c ? { l: 74, r: 96, t: 16, b: 60 } : { l: 64, r: 76, t: 16, b: 50 };
    W = c ? 520 : 820; H = c ? 460 : 400;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.toggle('compact', c);
    svg.innerHTML = '';
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    // both axes span 1.75 decades so the slopes are directly comparable
    X = v => M.l + (v - lc0) / (lc1 - lc0) * pw;
    YN = n => M.t + (2.85 - Math.log10(n / 1e6)) / 1.75 * ph;
    YD = d => M.t + (9.5 - Math.log10(d)) / 1.75 * ph;
    svg._geom = { X, YN, YD, M, W, H, c };   // read by js/scale-link.js (prototype)

    const g = U.el('g', { class: 'axis' }, svg);
    U.el('rect', { x: X(Math.log10(A.hi)), y: M.t, width: X(12.35) - X(Math.log10(A.hi)), height: ph, fill: 'var(--shade)' }, g);
    U.el('text', { x: X(12.35) - 6, y: H - M.b - 8, 'text-anchor': 'end', class: 'annot-sub', text: 'extrapolated' }, svg);
    // log grid: minor lines at every 1–9 × 10^k, major lines at the labelled values
    logMinor(lc0, 12.35, v => U.el('line', { class: 'minor', x1: X(v), x2: X(v), y1: M.t, y2: H - M.b }, g));
    logMinor(7.1, 8.85, v => U.el('line', { class: 'minor', x1: M.l, x2: W - M.r, y1: YN(Math.pow(10, v)), y2: YN(Math.pow(10, v)) }, g));
    [10, 11, 12].forEach(v => {
      U.el('line', { x1: X(v), x2: X(v), y1: M.t, y2: H - M.b }, g);
      pow10(U.el('text', { x: X(v), y: H - M.b + (c ? 26 : 20), 'text-anchor': 'middle' }, g), v);
    });
    [[20, '20M'], [50, '50M'], [100, '100M'], [200, '200M'], [500, '500M']].forEach(([n, l]) => {
      U.el('line', { x1: M.l, x2: W - M.r, y1: YN(n * 1e6), y2: YN(n * 1e6) }, g);
      U.el('text', { x: M.l - 8, y: YN(n * 1e6) + 4, 'text-anchor': 'end', text: l, style: 'fill:var(--n)' }, g);
    });
    // the right axis has its own scale, so it gets tick marks instead of gridlines
    [[1e8, '100M'], [3e8, '300M'], [1e9, '1B'], [3e9, '3B']].forEach(([d, l]) => {
      U.el('line', { class: 'tick', x1: W - M.r, x2: W - M.r + 5, y1: YD(d), y2: YD(d), style: 'stroke:var(--d)' }, g);
      U.el('text', { x: W - M.r + 8, y: YD(d) + 4, text: l, style: 'fill:var(--d)' }, g);
    });
    U.el('text', { x: M.l + pw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title', text: 'Compute C (GFLOPs)' }, svg);
    U.el('text', { 'text-anchor': 'middle', class: 'axis-title', style: 'fill:var(--n)', transform: `translate(15 ${M.t + ph / 2}) rotate(-90)` }, svg)
      .innerHTML = (c ? 'model size ' : 'optimal model size ') + optSym('N', c ? '' : ' (parameters)');
    U.el('text', { 'text-anchor': 'middle', class: 'axis-title', style: 'fill:var(--d)', transform: `translate(${W - 12} ${M.t + ph / 2}) rotate(90)` }, svg)
      .innerHTML = (c ? 'samples seen ' : 'optimal samples seen ') + optSym('D');

    const fitPath = (fn, Y, a, b) => {
      let d = '';
      for (let i = 0; i <= 40; i++) { const lx = a + (b - a) * i / 40; d += (i ? 'L' : 'M') + X(lx).toFixed(1) + ' ' + Y(fn(Math.pow(10, lx))).toFixed(1); }
      return d;
    };
    const lo = lc0, hi = Math.log10(A.hi);
    [[N, YN, 'var(--n)'], [Dd, YD, 'var(--d)']].forEach(([fn, Y, col]) => {
      U.el('path', { d: fitPath(fn, Y, lo, hi), stroke: col, 'stroke-width': c ? 2.6 : 1.8, fill: 'none', opacity: .8 }, svg);
      U.el('path', { d: fitPath(fn, Y, hi, 12.35), stroke: col, 'stroke-width': c ? 2.2 : 1.4, 'stroke-dasharray': '4 4', fill: 'none', opacity: .7 }, svg);
    });
    const r = c ? 6 : 4.5;
    D.allocation.forEach(([lx, n, d, interior]) => {
      if (interior) U.el('circle', { cx: X(lx), cy: YN(n * 1e6), r: r + 3.5, fill: 'none', stroke: 'var(--n)', 'stroke-width': 1.4 }, svg);
      U.el('circle', { cx: X(lx), cy: YN(n * 1e6), r, fill: 'var(--n)' }, svg);
      U.el('rect', { x: X(lx) - r, y: YD(d) - r, width: 2 * r, height: 2 * r, fill: 'var(--d)' }, svg);
    });

    // cursor driven by the slider
    el.cur = U.el('line', { y1: M.t, y2: H - M.b, stroke: 'var(--ink)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
    el.pn = U.el('circle', { r: r + 1, fill: 'var(--bg)', stroke: 'var(--n)', 'stroke-width': 2.2 }, svg);
    el.pd = U.el('circle', { r: r + 1, fill: 'var(--bg)', stroke: 'var(--d)', 'stroke-width': 2.2 }, svg);
    el.ln = U.el('text', { class: 'annot halo', style: 'fill:var(--n)' }, svg);
    el.ld = U.el('text', { class: 'annot halo', style: 'fill:var(--d)' }, svg);
    render(+range.value);
  }

  function render(v) {
    const lc = lc0 + (lc1 - lc0) * v / 1000, c = Math.pow(10, lc);
    const n = N(c), d = Dd(c);
    const x = X(lc), yn = YN(n), yd = YD(d);
    el.cur.setAttribute('x1', x); el.cur.setAttribute('x2', x);
    el.pn.setAttribute('cx', x); el.pn.setAttribute('cy', yn);
    el.pd.setAttribute('cx', x); el.pd.setAttribute('cy', yd);
    const right = x < X(11.6);
    // N label below its marker, D label above: the measured points sit on the other side
    // near the axis ends the two labels are pushed apart and kept inside the plot
    const k = compact ? 1.4 : 1, gap = 16 * k, y0 = M.t + 12 * k, y1 = H - M.b - 6;
    // left of the marker the rising N line runs below it, so there the N label goes above the line
    let ly = [right ? yn + 18 * k : yn - 10 * k, yd - 10 * k];
    const lo = ly[0] < ly[1] ? 0 : 1, hi = 1 - lo;
    if (ly[hi] - ly[lo] < gap) { const m = (ly[0] + ly[1]) / 2; ly[lo] = m - gap / 2; ly[hi] = m + gap / 2; }
    if (ly[hi] > y1) { ly[lo] -= ly[hi] - y1; ly[hi] = y1; }
    if (ly[lo] < y0) { ly[hi] += y0 - ly[lo]; ly[lo] = y0; }
    [[el.ln, ly[0], optSym('N', ' = ' + U.fmt(n))], [el.ld, ly[1], optSym('D', ' = ' + U.fmt(d))]].forEach(([t, y, s]) => {
      t.setAttribute('x', x + (right ? 10 : -10)); t.setAttribute('y', y);
      t.setAttribute('text-anchor', right ? 'start' : 'end'); t.innerHTML = s;
    });
    outN.textContent = U.fmt(n);
    outD.textContent = U.fmt(d);
    outE.textContent = (d / 365e6).toFixed(1) + '×';
    const e = Math.floor(lc), m = Math.pow(10, lc - e);
    outC.innerHTML = `${m.toFixed(1)} × 10<sup>${e}</sup> GFLOPs`;
    outX.classList.toggle('on', c > A.hi * 1.02);
    svg.dispatchEvent(new CustomEvent('budget', { detail: lc }));
  }

  let touched = false;
  range.addEventListener('input', () => { touched = true; render(+range.value); });

  // the compute line can be dragged, and a click anywhere on the chart moves it there
  const toSvg = ev => {
    const m = svg.getScreenCTM();
    return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
  };
  const xToV = px => U.clamp((px - M.l) / (W - M.l - M.r) * 1000, 0, 1000);
  let dragging = false;
  function moveTo(ev) {
    const p = toSvg(ev);
    if (!p) return;
    touched = true;
    const v = Math.round(xToV(p.x));
    range.value = v;
    render(v);
  }
  svg.addEventListener('pointerdown', ev => {
    if (ev.button) return;
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('dragging');
    unhoverPt();
    moveTo(ev);
  });
  svg.addEventListener('pointerup', ev => { dragging = false; svg.classList.remove('dragging'); svg.releasePointerCapture(ev.pointerId); });
  svg.addEventListener('pointercancel', () => { dragging = false; svg.classList.remove('dragging'); });

  // hover: the measured compute-optimal runs get a tooltip
  const wrap = svg.parentElement;
  wrap.classList.add('chart-wrap');
  const tip = document.createElement('div');
  tip.className = 'tip';
  wrap.appendChild(tip);
  function hoverPt(ev) {
    if (dragging) return moveTo(ev);
    const p = toSvg(ev);
    if (!p) return;
    const reach = compact ? 26 : 16;
    let best = null, bd = reach * reach;
    D.allocation.forEach(row => {
      const [lx, n, d] = row, x = X(lx);
      [YN(n * 1e6), YD(d)].forEach(y => {
        const dd = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (dd < bd) { bd = dd; best = { row, x, y }; }
      });
    });
    svg.classList.toggle('on-line', !best && Math.abs(p.x - +el.cur.getAttribute('x1')) < (compact ? 16 : 10));
    if (!best) return unhoverPt();
    const [lx, n, d, interior] = best.row;
    const e = Math.floor(lx), m = Math.pow(10, lx - e);
    tip.innerHTML = `<b>${m.toFixed(1)} × 10<sup>${e}</sup> GFLOPs</b>${interior ? ' <span>· interior minimum</span>' : ''}<br><b style="color:var(--n)">●</b> N<sub>opt</sub> ${n}M params <span>·</span> <b style="color:var(--d)">■</b> D<sub>opt</sub> ${U.fmt(d)} samples`;
    const r = svg.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const k = r.width / svg.viewBox.baseVal.width;
    tip.style.left = (r.left - w.left + best.x * k) + 'px';
    tip.style.top = (r.top - w.top + best.y * k) + 'px';
    tip.style.opacity = 1;
  }
  function unhoverPt() { tip.style.opacity = 0; }
  svg.addEventListener('pointermove', hoverPt);
  svg.addEventListener('pointerleave', () => { unhoverPt(); svg.classList.remove('on-line'); });
  const target = +range.value;
  build();
  range.value = 0; render(0);
  U.onWidth(() => { const v = +range.value; build(); render(v); });
  // the budget sweeps up to its default once; js/scale-link.js starts it (event 'sweep') when
  // the link to the scaling chart appears, so both charts move together
  let swept = false;
  function sweep() {
    if (swept || touched) return;
    swept = true;
    if (U.reduced) { range.value = target; render(target); return; }
    const t0 = performance.now();
    (function f(t) {
      if (touched) return;
      const k = U.clamp((t - t0) / 1800, 0, 1);
      const v = target * U.ease.inOut(k);
      range.value = v;
      render(v);
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }
  svg.addEventListener('sweep', sweep);
  U.onView(svg, () => { if (!svg.dataset.linked) sweep(); }, .4);
})();

/* ================= score vs. size ================= */
function sota(c) {
  const svg = document.getElementById('sota-chart');
  svg.innerHTML = '';
  // drop listeners of a previous build by swapping the toggle for a clone
  const oldToggle = document.getElementById('sota-toggle');
  oldToggle.replaceWith(oldToggle.cloneNode(true));
  const tip = document.getElementById('sota-tip');
  const wrap = svg.parentElement;
  const M = c ? { l: 50, r: 14, t: 18, b: 58 } : { l: 56, r: 18, t: 18, b: 50 };
  const W = c ? 520 : 820, H = c ? 480 : 440;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.toggle('compact', c);
  const R0 = c ? 6.5 : 5, SQ = c ? 13 : 10;
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const lx0 = Math.log10(3.5), lx1 = Math.log10(13000);
  const X = p => M.l + (Math.log10(p) - lx0) / (lx1 - lx0) * pw;
  const RANGE = { maeb: [20, 56], hear: [45, 90] };
  const TICKS = { maeb: [20, 25, 30, 35, 40, 45, 50, 55], hear: [45, 50, 55, 60, 65, 70, 75, 80, 85, 90] };
  let bench = document.querySelector('#sota-toggle .on').dataset.k;
  const Y = (v, b = bench) => M.t + (1 - (v - RANGE[b][0]) / (RANGE[b][1] - RANGE[b][0])) * ph;

  const gGrid = U.el('g', { class: 'axis' }, svg);
  const gX = U.el('g', { class: 'axis' }, svg);
  logMinor(lx0, lx1, v => U.el('line', { class: 'minor', x1: X(Math.pow(10, v)), x2: X(Math.pow(10, v)), y1: M.t, y2: H - M.b }, gX));
  [[10, '10M'], [100, '100M'], [1000, '1B'], [10000, '10B']].forEach(([p, l]) => {
    U.el('line', { x1: X(p), x2: X(p), y1: M.t, y2: H - M.b }, gX);
    U.el('text', { x: X(p), y: H - M.b + (c ? 26 : 20), 'text-anchor': 'middle', text: l }, gX);
  });
  U.el('text', { x: M.l + pw / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title', text: 'Parameters' }, svg);
  const yTitle = U.el('text', { 'text-anchor': 'middle', class: 'axis-title', transform: `translate(15 ${M.t + ph / 2}) rotate(-90)` }, svg);

  const clip = U.el('clipPath', { id: 'front-clip' }, U.el('defs', {}, svg));
  const clipRect = U.el('rect', { x: 0, y: 0, width: 0, height: H }, clip);
  const front = U.el('path', { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: 0, 'clip-path': 'url(#front-clip)' }, svg);
  let frontAnim = null;
  const gPts = U.el('g', {}, svg);
  const gOurs = U.el('g', {}, svg);
  const gLbl = U.el('g', {}, svg);

  const byName = new Map();
  D.maeb.forEach(m => byName.set(m.n, { n: m.n, p: m.p, t: true, maeb: m.s }));
  D.hear.forEach(m => {
    const o = byName.get(m.n) || { n: m.n, p: m.p, t: !!m.t };
    o.hear = m.s; byName.set(m.n, o);
  });
  // other contrastive audio-text models (CLAP-style), the models ours is a drop-in replacement for
  const CONTRASTIVE = new Set(['GLAP', 'M2D-CLAP', 'TP-CLAP', 'CLAP-IPA small', 'LAION Larger CLAP',
    'MS-CLAP 2023', 'MS-CLAP 2022', 'LAION-CLAP', 'MuQ-MuLan-large', 'wav2clip']);
  const others = [...byName.values()].filter(o => o.p >= 4);
  const tri = r => `M0 ${-r * 1.25}L${r * 1.15} ${r * .8}L${-r * 1.15} ${r * .8}Z`;
  others.forEach(o => {
    o.clap = CONTRASTIVE.has(o.n);
    // each mark links to the model's source page
    const ga = U.svgModelLink(gPts, o.n);
    o.el = o.clap
      ? U.el('path', { d: tri(R0 * 1.1), transform: `translate(${X(o.p)} ${H - M.b})`, fill: 'var(--muted)', stroke: 'var(--bg)', 'stroke-width': 1.2, opacity: 0 }, ga)
      : U.el('circle', { r: R0, cx: X(o.p), cy: H - M.b, 'stroke-width': 1.4, opacity: 0, fill: o.t ? 'var(--neutral)' : 'var(--bg)', stroke: o.t ? 'var(--bg)' : 'var(--muted)' }, ga);
    o.y = H - M.b; o.a = 0;
    hover(o.el, () => `${o.n}${ext(o.n)}<br><span>${fmtP(o.p)} · ${o[bench] != null ? o[bench].toFixed(1) : '–'}</span>`);
  });
  const ourLine = U.el('path', { fill: 'none', stroke: 'var(--ours)', 'stroke-width': c ? 2.6 : 1.8 }, gOurs);
  const ours = D.ours.map(o => {
    const e = U.el('rect', { width: SQ, height: SQ, rx: 2, fill: 'var(--ours)', stroke: 'var(--bg)', 'stroke-width': 1.4, opacity: 0 }, U.svgModelLink(gOurs, o.n));
    const lbl = U.el('text', { class: 'annot', style: 'fill:var(--ours)', text: o.label, opacity: 0 }, U.svgModelLink(gLbl, o.n));
    hover(e, () => `${o.n}${ext(o.n)}<br><span>${fmtP(o.p)} · ${o[bench].toFixed(1)}</span>`);
    return { ...o, el: e, lbl, y: H - M.b, a: 0 };
  });
  const OFF = {
    maeb: c ? { XXS: [0, 28, 'middle'], XS: null, S: null, M: [0, -16, 'middle'], L: [0, -16, 'middle'] }
      : { XXS: [0, 22, 'middle'], XS: [-9, -9, 'end'], S: [-10, -10, 'end'], M: [0, -14, 'middle'], L: [0, -14, 'middle'] },
    hear: { XXS: [0, c ? 28 : 22, 'middle'], XS: null, S: null, M: null, L: [0, c ? 28 : 22, 'middle'] },
  };
  const NAMED = {
    maeb: c ? [['LAION-CLAP', 0, 28, 'middle'], ['GLAP', 12, 6, 'start'], ['LCO-Embedding-Omni-7B', 0, -16, 'end']]
      : [['LAION-CLAP', 0, 22, 'middle'], ['M2D-CLAP', 10, -6, 'start'], ['GLAP', 10, 4, 'start'], ['LCO-Embedding-Omni-7B', 0, -14, 'end'], ['Qwen2-Audio-7B', -10, 4, 'end']],
    hear: c ? [] : [['USAD 2.0-XXLarge+', 10, -6, 'start']],
  };
  const named = new Map();
  [...new Set([...NAMED.maeb, ...NAMED.hear].map(x => x[0]))].forEach(n => {
    const e = U.el('text', { class: 'lbl', opacity: 0, text: n.replace('LCO-Embedding-Omni-7B', 'LCO-Omni-7B') }, U.svgModelLink(gLbl, n));
    e.style.transition = 'opacity .4s';
    named.set(n, e);
  });

  // tooltip hint that the mark opens the model page
  const ext = n => U.modelUrl(n) ? ' <span>↗</span>' : '';
  function fmtP(p) { return p >= 1000 ? (p / 1000).toFixed(1) + 'B params' : Math.round(p) + 'M params'; }
  function hover(e, html) {
    e.style.cursor = 'pointer';
    e.addEventListener('mouseenter', () => {
      tip.innerHTML = html();
      const r = e.getBoundingClientRect(), cr = wrap.getBoundingClientRect();
      tip.style.left = (r.left + r.width / 2 - cr.left) + 'px';
      tip.style.top = (r.top - cr.top) + 'px';
      tip.style.opacity = 1;
    });
    e.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
  }

  function drawGrid() {
    gGrid.innerHTML = '';
    TICKS[bench].forEach(v => {
      U.el('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, gGrid);
      U.el('text', { x: M.l - 10, y: Y(v) + 4, 'text-anchor': 'end', text: v }, gGrid);
    });
    yTitle.textContent = (bench === 'maeb' ? 'MAEB-30' : 'HEAR') + (c ? ' benchmark score (%)' : ' average benchmark score (%)');
    document.querySelector('.only-hear').classList.toggle('off', bench !== 'hear');
  }

  let anim = null;
  function apply(animate = true) {
    drawGrid();
    const items = [...others, ...ours];
    const start = items.map(o => ({ y: o.y, a: o.a }));
    const target = items.map(o => o[bench] == null ? { y: o.y, a: 0 } : { y: Y(o[bench]), a: 1 });
    const t0 = performance.now(), dur = animate ? 900 : 0;
    cancelAnimationFrame(anim);
    named.forEach(e => e.setAttribute('opacity', 0));
    cancelAnimationFrame(frontAnim); clipRect.setAttribute('width', 0); front.setAttribute('opacity', 0);
    (function f(t) {
      const k = dur ? U.clamp((t - t0) / dur, 0, 1) : 1;
      items.forEach((o, i) => {
        const delay = (i % 13) * .02;
        const kk = U.ease.inOut(U.clamp((k - delay) / (1 - delay), 0, 1));
        o.y = U.lerp(start[i].y, target[i].y, kk);
        o.a = U.lerp(start[i].a, target[i].a, kk);
        if (o.el.tagName === 'circle') { o.el.setAttribute('cy', o.y); o.el.setAttribute('opacity', o.a); return; }
        if (o.clap) { o.el.setAttribute('transform', `translate(${X(o.p)} ${o.y})`); o.el.setAttribute('opacity', o.a); return; }
        o.el.setAttribute('x', X(o.p) - SQ / 2); o.el.setAttribute('y', o.y - SQ / 2); o.el.setAttribute('opacity', o.a);
        const off = OFF[bench][o.id];
        if (off) { o.lbl.setAttribute('x', X(o.p) + off[0]); o.lbl.setAttribute('y', o.y + off[1]); o.lbl.setAttribute('text-anchor', off[2]); }
        o.lbl.setAttribute('opacity', off ? o.a : 0);
      });
      ourLine.setAttribute('d', ours.map((o, i) => (i ? 'L' : 'M') + X(o.p) + ' ' + o.y).join(''));
      ourLine.setAttribute('opacity', ours[0].a);
      if (k < 1) anim = requestAnimationFrame(f); else finish();
    })(t0);
  }
  function finish() {
    const pts = [...others.filter(o => o.t && o[bench] != null).map(o => [o.p, o[bench]]), ...ours.map(o => [o.p, o[bench]])].sort((a, b) => a[0] - b[0]);
    let best = -1, d = '';
    pts.forEach(([p, v]) => {
      if (v > best) { d += d ? `H${X(p).toFixed(1)}V${Y(v).toFixed(1)}` : `M${X(p).toFixed(1)} ${Y(v).toFixed(1)}`; best = v; }
    });
    front.setAttribute('d', d + `H${W - M.r}`);
    front.setAttribute('opacity', .6);
    const t0 = performance.now() - (U.reduced ? 1e4 : 0);
    (function grow(t) {
      t = Math.max(t, t0 + (U.reduced ? 1e4 : 0));
      const k = U.clamp((t - t0) / 1100, 0, 1);
      clipRect.setAttribute('width', W * U.ease.inOut(k));
      if (k < 1) frontAnim = requestAnimationFrame(grow);
    })(t0);
    NAMED[bench].forEach(([n, dx, dy, an]) => {
      const o = byName.get(n), e = named.get(n);
      e.setAttribute('x', X(o.p) + dx); e.setAttribute('y', Y(o[bench]) + dy); e.setAttribute('text-anchor', an);
      e.setAttribute('opacity', 1);
    });
  }

  document.querySelectorAll('#sota-toggle button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.k === bench) return;
    document.querySelectorAll('#sota-toggle button').forEach(x => x.classList.toggle('on', x === b));
    bench = b.dataset.k; apply(!U.reduced);
  }));
  drawGrid();
  U.onView(svg, () => apply(!U.reduced));
  return () => apply(false);
}
(function () {
  const svg = document.getElementById('sota-chart');
  if (!svg) return;
  let compact = isCompact(svg), shown = false;
  sota(compact);
  U.onView(svg, () => { shown = true; });
  U.onWidth(() => {
    const c = isCompact(svg);
    if (c === compact) return;
    compact = c;
    const show = sota(c);
    if (shown) show();
  });
})();

/* ================= MAEB-30 table ================= */
(function table() {
  const body = document.querySelector('#maeb-table tbody');
  if (!body) return;
  const all = [...D.maebSmall, ...D.maebOurs];
  const best = [2, 3, 4, 5].map(i => Math.max(...all.map(r => r[i])));
  const color = Object.fromEntries(D.sizes.map(s => [s.label, s.color]));
  const MAX = 60;
  const group = (label, n, unit = 'models', tag = '') => {
    const tr = document.createElement('tr');
    tr.className = 'grp-row';
    tr.innerHTML = `<td colspan="6">${label}${tag}<span>· ${n} ${unit}</span></td>`;
    body.appendChild(tr);
  };
  const row = (r, ours) => {
    const tr = document.createElement('tr');
    if (ours) tr.className = 'ours';
    const id = ours ? r[0].replace('CLAP2-', '') : null;
    const name = ours ? `<i class="sw" style="background:${color[id]}"></i>${U.modelLink(r[0])}` : U.modelLink(r[0]);
    const cell = (j, v) => `<td${v === best[j] ? ' class="best"' : ''}><span>${v.toFixed(1)}</span></td>`;
    tr.innerHTML = `<td class="m">${name}<span class="pm">${r[1]}M</span></td><td class="p">${r[1]}M</td>` +
      `<td class="mean${r[2] === best[0] ? ' best' : ''}"><span class="mbar" style="--f:${(r[2] / MAX).toFixed(3)}"></span><span class="mv">${r[2].toFixed(1)}</span></td>` +
      cell(1, r[3]) + cell(2, r[4]) + cell(3, r[5]);
    body.appendChild(tr);
  };
  group('CLAP2', D.maebOurs.length, 'sizes', '<span class="ours-tag">ours</span>');
  D.maebOurs.forEach(r => row(r, true));
  group('Prior audio–text models under 1B parameters', D.maebSmall.length);
  // the three weakest models and a niche one fold away behind a button at the foot of the table
  const FOLD = new Set(['CLAP-IPA small', 'MuQ-MuLan-large', 'wav2clip', 'SpeechT5']);
  const extra = [];
  D.maebSmall.forEach(r => {
    row(r, false);
    if (FOLD.has(r[0])) { body.lastChild.hidden = true; extra.push(body.lastChild); }
  });
  const more = document.createElement('tr');
  more.className = 'more-row';
  more.innerHTML = `<td colspan="6"><button type="button" aria-expanded="false"></button></td>`;
  const btn = more.querySelector('button');
  const label = open => { btn.innerHTML = `${open ? 'Show fewer models' : `Show ${extra.length} more models`}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`; };
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    extra.forEach(tr => { tr.hidden = !open; });
    btn.setAttribute('aria-expanded', open);
    label(open);
  });
  label(false);
  body.appendChild(more);
  U.onView(body, () => body.closest('table').classList.add('in'));
})();

/* ================= progress of CLAP-style models over time ================= */
(function progress() {
  const svg = document.getElementById('progress-chart');
  if (!svg) return;
  const score = Object.fromEntries(D.maeb.map(m => [m.n, m.s]));
  const pts = D.releases.map(([n, x]) => ({ n, x, s: score[n] })).filter(p => p.s != null).sort((a, b) => a.x - b.x);
  const ours = D.ours.map(o => ({ id: o.label, s: o.maeb }));
  const top = ours.reduce((a, b) => (b.s > a.s ? b : a)), low = ours.reduce((a, b) => (b.s < a.s ? b : a));
  const best = pts.reduce((a, b) => (b.s > a.s ? b : a));
  // label position per model: [dx, dy, anchor]; compact charts label only the models that set a new best
  const LBL = { 'wav2clip': [8, 20, 'start'], 'LAION-CLAP': [8, 20, 'start'], 'LAION Larger CLAP': [-10, -10, 'end'], 'MS-CLAP 2023': [6, 26, 'start'],
    'M2D-CLAP': [-10, -10, 'end'], 'CLAP-IPA small': [10, 14, 'start'], 'MuQ-MuLan-large': [10, 4, 'start'], 'GLAP': [-12, -10, 'end'] };
  let compact = null, shown = false, items = [];

  function build() {
    const c = isCompact(svg);
    if (c === compact) return;
    compact = c;
    const M = c ? { l: 62, r: 50, t: 24, b: 56 } : { l: 56, r: 24, t: 24, b: 46 };
    const W = c ? 520 : 820, H = c ? 460 : 380;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.toggle('compact', c);
    svg.innerHTML = '';
    const x0 = 2021.3, x1 = 2027.3, y0 = 25, y1 = 56;
    const X = v => M.l + (v - x0) / (x1 - x0) * (W - M.l - M.r);
    const Y = v => M.t + (y1 - v) / (y1 - y0) * (H - M.t - M.b);
    const g = U.el('g', { class: 'axis' }, svg);
    [25, 30, 35, 40, 45, 50, 55].forEach(v => {
      U.el('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, g);
      U.el('text', { x: M.l - 10, y: Y(v) + 4, 'text-anchor': 'end', text: v }, g);
    });
    // a gridline at each new year, the year's label centred in its span
    [2022, 2023, 2024, 2025, 2026, 2027].forEach(v => U.el('line', { class: 'minor', x1: X(v), x2: X(v), y1: M.t, y2: H - M.b }, g));
    [2021, 2022, 2023, 2024, 2025, 2026].forEach(v => U.el('text', { x: X(Math.max(v + .5, x0 + .3)), y: H - M.b + (c ? 26 : 20), 'text-anchor': 'middle', text: v }, g));
    U.el('text', { 'text-anchor': 'middle', class: 'axis-title', text: 'MAEB-30 benchmark score (%)', transform: `translate(15 ${M.t + (H - M.t - M.b) / 2}) rotate(-90)` }, svg);
    U.el('text', { x: M.l + (W - M.l - M.r) / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title', text: 'Release date' }, svg);

    items = [];
    const add = (el, t, dur = .5) => { el.style.opacity = shown ? 1 : 0; el.style.transition = `opacity ${dur}s ease`; items.push([el, t]); return el; };
    const ox = X(D.oursRelease);
    // best score so far: a step line through the models that raised it, held until our release
    let d = '', run = -1;
    pts.forEach(p => { if (p.s > run) { d += (d ? `H${X(p.x).toFixed(1)}V` : `M${X(p.x).toFixed(1)} `) + Y(p.s).toFixed(1); run = p.s; } });
    d += `H${ox - 26}`;
    add(U.el('path', { d, fill: 'none', stroke: '#9a9a9a', 'stroke-width': c ? 2 : 1.5, 'stroke-dasharray': '4 4' }, svg), 0);

    const r = c ? 8 : 6.5;
    const tri = `M0 ${-r * 1.15}L${r} ${r * .75}L${-r} ${r * .75}Z`;
    pts.forEach((p, i) => {
      const t = 120 + i * 110;
      const pg = add(U.el('g', { transform: `translate(${X(p.x).toFixed(1)} ${Y(p.s).toFixed(1)})` }, U.svgModelLink(svg, p.n)), t);
      U.el('path', { d: tri, fill: p === best ? 'var(--ink-2)' : 'var(--muted)', stroke: 'var(--bg)', 'stroke-width': 1.2 }, pg);
      U.el('title', { text: `${p.n}: ${p.s.toFixed(1)}%` }, pg);
      const onFront = pts.every(q => q.x >= p.x || q.s < p.s);
      if (c && !onFront) return;
      const [dx, dy, anchor] = LBL[p.n] || [10, 4, 'start'];
      U.el('text', { x: dx, y: dy, 'text-anchor': anchor, class: p === best ? 'annot' : 'annot-sub', text: p === best ? `${p.n} ${p.s.toFixed(1)}` : p.n }, pg);
    });

    // CLAP2: all five sizes at the release date, and the gain over the previous best
    const tOurs = 120 + pts.length * 110 + 150;
    // all blue items (CLAP2 and the gain arrow) fade in together, slowly
    const og = add(U.el('g', {}, svg), tOurs, .9);
    U.el('line', { x1: ox, x2: ox, y1: Y(low.s), y2: Y(top.s), stroke: 'var(--ours)', 'stroke-width': c ? 3 : 2.4, 'stroke-linecap': 'round', opacity: .35 }, og);
    const sq = c ? 12 : 10;
    ours.forEach(o => {
      const e = U.el('rect', { x: ox - sq / 2, y: Y(o.s) - sq / 2, width: sq, height: sq, rx: 2, fill: 'var(--ours)', stroke: 'var(--bg)', 'stroke-width': 1.2 }, U.svgModelLink(og, 'CLAP2-' + o.id));
      U.el('title', { text: `CLAP2-${o.id}: ${o.s.toFixed(1)}%` }, e);
    });
    U.el('text', { x: ox + sq, y: Y(top.s) + 5, class: 'annot', style: 'fill:var(--ours)', text: top.id }, U.svgModelLink(og, 'CLAP2-' + top.id));
    U.el('text', { x: ox + sq, y: Y(low.s) + 5, class: 'annot', style: 'fill:var(--ours)', text: low.id }, U.svgModelLink(og, 'CLAP2-' + low.id));
    U.el('text', { x: ox, y: Y(top.s) - (c ? 20 : 16), 'text-anchor': 'end', class: 'annot', style: 'fill:var(--ours)', text: c ? 'CLAP2' : `CLAP2-${top.id} ${top.s.toFixed(1)}` }, og);
    // the jump: arrow from the previous best to our best size
    const ax = ox - (c ? 30 : 24);
    const jg = add(U.el('g', {}, svg), tOurs, .9);
    U.el('path', { d: `M${ax} ${Y(best.s)}V${Y(top.s) + 3}m-4.5 6l4.5 -6l4.5 6`, fill: 'none', stroke: 'var(--ours)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, jg);
    U.el('text', { x: ax - 8, y: (Y(best.s) + Y(top.s)) / 2 + 6, 'text-anchor': 'end', class: 'annot', style: `fill:var(--ours);font-size:${c ? 24 : 20}px;font-weight:600`, text: `+${(top.s - best.s).toFixed(1)}` }, jg);
  }

  function reveal() {
    shown = true;
    items.forEach(([el, t]) => setTimeout(() => { el.style.opacity = 1; }, U.reduced ? 0 : t));
  }
  build();
  U.onView(svg, reveal);
  U.onWidth(() => { const was = compact; build(); if (was !== compact && shown) items.forEach(([el]) => { el.style.opacity = 1; }); });
})();
