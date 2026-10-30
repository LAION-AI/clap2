/* ================= caption generation on phones: the same clip, traced top to bottom =================
   The clip card sits above the figure and the sample card below it. In between, the clip's audio runs down
   the left edge and turns into each expert that ran; the annotations leave on the right, run down and merge
   into the captioning model, which pours the short and the long caption into the sample card. A stream keeps
   its width from end to end, so each one is a single stroked centre line with rounded corners. */
if (window.FK) FK.capPhone = function captionFlowPhone() {
  const svg = document.getElementById('cap-svg');
  if (!svg || !FK.CF) return null;
  let alive = true;
  const { AUDIO_ROW, CAPTION_INFO, EXPERT_INFO } = FK.CF;
  const S = window.DATA.samples, X = FK.EXPERTS, GROUPS = FK.GROUPS, esc = FK.esc;
  const ROWS = [AUDIO_ROW, ...X];
  const words = t => t.trim().split(/\s+/).length;
  const groupOn = (m, g) => g.key === 'all' || X.some(r => r.group === g.key && r.val(m));
  const lerp = (a, b, k) => a + (b - a) * k;
  const tween = (dur, fn) => {
    if (U.reduced || !dur) { fn(1); return; }
    const t0 = performance.now();
    (function f(t) { const k = U.clamp((t - t0) / dur, 0, 1); fn(U.ease.inOut(k)); if (k < 1) requestAnimationFrame(f); })(t0);
  };

  // ---------- layout: the expert rows, then the captioning model below them ----------
  const W = 380, FAN = 60, PITCH = 40;
  const N0 = 84, N1 = W - 84, L0 = 6, R1 = W - 6;   // expert rows; outer edges of the two side streams
  const rowY = [], heads = [];
  let c = 56;
  rowY.push(c + PITCH / 2); c += PITCH + 8;
  GROUPS.forEach(g => {
    heads.push({ g, y: c + 12 });
    c += 20;
    X.forEach((r, i) => { if (r.group === g.key) { rowY[i + 1] = c + PITCH / 2; c += PITCH; } });
    c += 6;
  });
  const PB = c + 4, YB = PB + 100, BH = 112, H = YB + BH + 70;
  // one box per captioner, side by side; the streams enter and leave the one that captioned this clip
  const SUB = [[18, 186], [194, 362]], SY0 = YB + 36, SY1 = YB + 100, MCX = SUB.map(([a, b]) => (a + b) / 2);
  const f = FK.setup(svg, W, H);
  const outer = svg.closest('.ff-fig');
  outer.classList.add('cf-m');
  const colorOf = i => (i ? '--s-dedup' : '--s-select');

  let w = ROWS.map(() => 0), wOut = [FAN / 3, FAN * 2 / 3], mcx = MCX[0], on = ROWS.map(() => true), hl = null;

  // ---------- streams ----------
  // a polyline with rounded corners of radius r (clamped to half of each leg)
  function route(pts, r) {
    let d = `M${FK.xy(...pts[0])}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k - 1], [px, py] = pts[k], [bx, by] = pts[k + 1];
      const la = Math.hypot(px - ax, py - ay), lb = Math.hypot(bx - px, by - py), rr = Math.min(r, la / 2, lb / 2);
      d += ` L${FK.xy(px - (px - ax) / la * rr, py - (py - ay) / la * rr)} Q${FK.xy(px, py)} ${FK.xy(px + (bx - px) / lb * rr, py + (by - py) / lb * rr)}`;
    }
    return d + ` L${FK.xy(...pts[pts.length - 1])}`;
  }
  // lane centres across a stream of total width FAN, packed from x0 in the given order
  function lanes(order, x0, dir, ws = w) {
    const o = [];
    let x = x0;
    order.forEach(i => { o[i] = x + dir * ws[i] / 2; x += dir * ws[i]; });
    return o;
  }
  const idx = ROWS.map((r, i) => i), rev = idx.slice().reverse();
  const P = { fo: [], fi: [], out: [] };
  const stroke = (c, op) => U.el('path', { class: 'rib', fill: 'none', style: `stroke:${FK.paint(c)};stroke-opacity:${op}` }, f.bands);
  ROWS.forEach((r, i) => { P.fo.push(stroke('--s-select', .34)); P.fi.push(stroke(colorOf(i), .42)); });
  ['--s-500', '--s-collect'].forEach(t => P.out.push(stroke(t, .5)));
  function draw() {
    // the top row takes the inner lane on both sides, so no stream crosses another
    const L = lanes(rev, L0, 1), R = lanes(idx, R1, -1), B = lanes(rev, mcx - FAN / 2, 1);
    const ym = (PB + SY0) / 2;
    ROWS.forEach((r, i) => {
      const y = rowY[i], rad = w[i] / 2 + 8;
      P.fo[i].setAttribute('d', route([[L[i], 0], [L[i], y], [N0 + 10, y]], rad));
      P.fi[i].setAttribute('d', route([[N1 - 10, y], [R[i], y], [R[i], PB]], rad) + ` C${FK.xy(R[i], ym)} ${FK.xy(B[i], ym)} ${FK.xy(B[i], SY0 + 8)}`);
      P.fo[i].style.strokeWidth = P.fi[i].style.strokeWidth = w[i];
    });
    const O = lanes([0, 1], mcx - FAN / 2, 1, wOut), T = lanes([0, 1], W / 2 - FAN / 2, 1, wOut), yo = (SY1 + H) / 2;
    P.out.forEach((p, j) => {
      p.setAttribute('d', `M${FK.xy(O[j], SY1 - 8)} C${FK.xy(O[j], yo)} ${FK.xy(T[j], yo)} ${FK.xy(T[j], H)}`);
      p.style.strokeWidth = wOut[j];
    });
    ports.forEach(p => p.setAttribute('x', mcx - FAN / 2));
  }

  // ---------- expert nodes, grouped by the route that runs them ----------
  const panel = f.fade(U.el('g', {}, f.bands), 8);
  f.bands.prepend(panel);
  U.el('rect', { x: N0 - 8, y: 8, width: N1 - N0 + 16, height: PB - 8, rx: 14, class: 'cf-panel' }, panel);
  const gn = f.fade(U.el('g', {}, f.nodes), 8);
  const head = (x, y, label, info, cls = 'pf-head') => {
    const g = f.fade(U.el('g', {}, f.labels), y);
    const t = f.text(g, x, y, label, cls);
    if (info) f.info(g, x + t.getComputedTextLength() + 14, y - 4.5, ...info);
    return t;
  };
  head(N0 + 2, 30, 'Expert models', ['Expert annotations', EXPERT_INFO]);
  const gh = heads.map(({ g, y }) => {
    const el = U.el('g', { class: 'fk-gh' }, gn);
    f.text(el, N0 + 2, y, g.name.toUpperCase(), 'fk-gh-t');
    return { g, el };
  });
  const nodes = ROWS.map((r, i) => {
    const y = rowY[i], g = U.el('g', { class: 'fe-node' }, gn);
    U.el('rect', { x: N0, y: y - PITCH / 2 + 3, width: N1 - N0, height: PITCH - 6, rx: 9, class: 'fe-node-r' }, g);
    f.text(g, N0 + 11, y - 3, r.name, 'fe-name');
    const v = f.text(g, N0 + 11, y + 11.5, '', 'fe-val' + (i ? '' : ' audio'));
    g.addEventListener('mouseenter', () => { if (on[i]) setHl({ row: i }); });
    g.addEventListener('mouseleave', () => setHl(null));
    return { g, v };
  });

  // ---------- captioning model ----------
  const gb = f.fade(U.el('g', {}, f.nodes), YB);
  U.el('rect', { x: 8, y: YB, width: W - 16, height: BH, rx: 14, class: 'cf-box' }, gb);
  head(20, YB + 23, 'Captioning model', ['Captioning', CAPTION_INFO], 'pf-head cf-box-h');
  // a static readout, not buttons: the captioner of this clip in full with a mark, the other dimmed
  U.el('line', { x1: W / 2, x2: W / 2, y1: SY0 + 6, y2: SY1 - 6, class: 'cf-mod-sep' }, gb);
  const mods = [['Qwen3-Omni', '30B-A3B-Instruct'], ['MOSS-Audio', '8B-Thinking']].map(([a, b], k) => {
    const g = U.el('g', { class: 'cf-mod' }, gb);
    f.text(g, MCX[k], SY0 + 12, 'CAPTIONED THIS CLIP', 'cf-mod-k', 'middle');
    f.text(g, MCX[k], SY0 + 33, a, 'cf-box-n', 'middle');
    f.text(g, MCX[k], SY0 + 49, b, 'cf-box-s2', 'middle');
    return g;
  });
  // where the streams enter and leave the box, sliding to the captioner of this clip
  const ports = [YB, YB + BH - 3].map(y => U.el('rect', { x: 0, y, width: FAN, height: 3, rx: 1.5, class: 'cf-port' }, gb));

  // ---------- the clip above the figure, the sample below it ----------
  const card = (html, before) => {
    const d = document.createElement('div');
    d.className = 'cf-card'; d.innerHTML = html;
    outer.parentElement.insertBefore(d, before);
    return d;
  };
  // the clip switcher heads the clip card: which example this is, and the way to the others
  const clipEl = card('<div class="cn cn-m"></div><div class="fe-clip"><p class="fe-h"></p><div class="fe-aud"></div><p class="fe-src"></p></div>', outer);
  clipEl.classList.add('cf-clipcard');
  const nav = FK.clipNav(clipEl.querySelector('.cn'), outer.parentElement);
  const recEl = card(`<div class="pf-cap fe-rec"><p class="fe-h">LAION-Audio-XL sample</p>
    <div class="fe-sec kept"><p class="fe-sub"><i></i><span></span></p><div class="fe-chips"></div></div>
    <div class="fe-sec gen"><p class="fe-sub"><i></i><span></span></p>
      <div class="fe-blk s"><b>Short caption<span></span></b><p></p></div>
      <div class="fe-blk l"><b>Long caption<span></span></b><p></p></div></div></div>`, outer.nextSibling);
  const rec = recEl.firstElementChild;
  ['.s', '.l'].forEach((q, j) => {
    const b = rec.querySelector(q);
    b.addEventListener('mouseenter', () => setHl({ out: j }));
    b.addEventListener('mouseleave', () => setHl(null));
  });

  // hover or tap: one expert's path through the figure, or everything that feeds one caption
  function setHl(h) {
    hl = h;
    svg.classList.toggle('hl', !!h);
    ROWS.forEach((r, i) => {
      const lit = !!h && (h.out != null ? on[i] : h.row === i);
      P.fo[i].classList.toggle('on', lit); P.fi[i].classList.toggle('on', lit);
      nodes[i].g.classList.toggle('on', lit);
    });
    P.out.forEach((p, j) => p.classList.toggle('on', !!h && (h.out == null || h.out === j)));
    rec.querySelectorAll('.fe-chip').forEach(el => el.classList.toggle('on', !!h && h.row != null && el.dataset.k === ROWS[h.row].key));
    ['.s', '.l'].forEach((q, j) => rec.querySelector(q).classList.toggle('on', !!h && h.out === j));
  }

  // ---------- one clip ----------
  const icon = r => `<svg class="fe-ci" viewBox="0 0 24 24" aria-hidden="true">${FK.ICONS[r.icon].map(d => `<path d="${d}"/>`).join('')}</svg>`;
  let first = true;
  function show(i) {
    const s = S[i], m = s.meta, swapEls = [clipEl.querySelector('.fe-clip'), recEl, ...nodes.map(n => n.v)];
    const apply = () => {
      clipEl.querySelector('.fe-h').textContent = `Audio clip ${i + 1}`;
      FK.capAt = i;
      clipEl.querySelector('.fe-src').innerHTML = m.youtube_id
        ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(m.youtube_id)}&t=${Math.floor(m.start_sec || 0)}s" target="_blank" rel="noopener">Source on YouTube ↗</a>` : '';
      FK.player(clipEl.querySelector('.fe-aud'), s.src, 40);
      on = ROWS.map(r => !!r.val(m));
      nodes.forEach((n, k) => { n.v.textContent = ROWS[k].val(m) || ''; n.g.classList.toggle('off', !on[k]); });
      gh.forEach(h => h.el.classList.toggle('off', !groupOn(m, h.g)));
      const ran = X.filter(r => r.val(m));
      rec.querySelector('.kept .fe-sub span').textContent = `From the clip and ${ran.length} expert models`;
      rec.querySelector('.gen .fe-sub span').textContent = `Written by ${FK.model(m)}`;
      rec.querySelector('.fe-chips').innerHTML = `<span class="fe-chip a" data-k="audio" title="Audio">${icon(AUDIO_ROW)}${FK.time(m.duration)} clip</span>` +
        ran.map(r => `<span class="fe-chip" data-k="${r.key}" title="${r.name} · ${r.by}">${icon(r)}${esc(r.val(m))}</span>`).join('');
      const ns = words(m.short_caption), nl = words(m.long_caption);
      rec.querySelector('.s p').textContent = m.short_caption;
      rec.querySelector('.l p').textContent = m.long_caption;
      rec.querySelector('.s b span').textContent = ` · ${ns} words`;
      rec.querySelector('.l b span').textContent = ` · ${nl} words`;
      // targets: audio counts double, each expert that ran once; caption streams by word count
      const wt = ROWS.map((r, k) => (on[k] ? (k ? 1 : 2) : 0)), sum = wt.reduce((x, y) => x + y, 0);
      const wT = wt.map(x => FAN * x / sum), oT = [FAN * ns / (ns + nl), FAN * nl / (ns + nl)];
      const k1 = /moss/i.test(FK.model(m)) ? 1 : 0;
      mods.forEach((g, k) => g.classList.toggle('on', k === k1));
      const w0 = w.slice(), o0 = wOut.slice(), m0 = mcx;
      tween(first ? 0 : 750, k => {
        mcx = lerp(m0, MCX[k1], k); w = w0.map((v, j) => lerp(v, wT[j], k)); wOut = o0.map((v, j) => lerp(v, oT[j], k));
        draw();
      });
      first = false;
      if (hl) setHl(hl.row != null && !on[hl.row] ? null : hl);
      swapEls.forEach(e => e.classList.remove('fk-swap'));
    };
    if (first || U.reduced) { apply(); return; }
    swapEls.forEach(e => e.classList.add('fk-swap'));
    setTimeout(apply, 220);
  }

  // the switcher steps through the clips; it starts where the other (desktop) version was, if any
  const cyc = FK.cycle(svg, (i, how) => { show(i); nav.mark(i, how); }, { hold: 8000, first: FK.capAt || 0, onTick: (k, wait) => nav.tick(k, wait) });
  show(cyc.cur);
  nav.bind(cyc);

  // ---------- dots: each one follows an expert's stream from the clip into the captioning model ----------
  const gd = U.el('g', { 'aria-hidden': 'true' }, f.flow);
  const dots = Array.from({ length: 110 }, () => ({ el: U.el('circle', { r: 2.2, class: 'cfm-dot' }, gd) }));
  let len = [];
  function spawn(d, ahead = 0) {
    let q = Math.random() * FAN, k = 0;
    while (k < ROWS.length - 1 && q > w[k]) q -= w[k++];
    d.i = k; d.v = .1 + Math.random() * .8; d.sp = 62 * (.85 + Math.random() * .3);
    d.l = ahead * ((len[k] || [0, 0])[0] + (len[k] || [0, 0])[1]);
  }
  let visible = false, last = 0;
  new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; }).observe(svg);
  function frame(t) {
    if (!alive) return;
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    if (!visible || U.reduced) return;
    len = ROWS.map((r, i) => [P.fo[i].getTotalLength(), P.fi[i].getTotalLength()]);
    for (const d of dots) {
      if (d.l == null) spawn(d, Math.random());
      const i = d.i, [a, b] = len[i];
      d.l += dt * d.sp;
      if (!w[i] || d.l >= a + b) { spawn(d); d.el.style.opacity = 0; continue; }
      const second = d.l > a, p = second ? P.fi[i] : P.fo[i], l = second ? d.l - a : d.l, tot = second ? b : a;
      const p0 = p.getPointAtLength(l), p1 = p.getPointAtLength(Math.min(tot, l + 1));
      let tx = p1.x - p0.x, ty = p1.y - p0.y;
      const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
      const off = (d.v - .5) * w[i] * .9;
      d.el.setAttribute('cx', (p0.x - ty * off).toFixed(1));
      d.el.setAttribute('cy', (p0.y + tx * off).toFixed(1));
      d.el.classList.toggle('k', second && i > 0);
      const o = Math.min(1, d.l / 24, (a + b - d.l) / 24) * (!hl ? 1 : (hl.row != null ? hl.row === i : on[i]) ? 1 : .12);
      d.el.style.opacity = Math.max(0, o);
    }
  }
  requestAnimationFrame(frame);

  // ---------- entrance: the figure grows downwards, labels fade in as it passes ----------
  const reveal = y => {
    f.clipRect.setAttribute('height', y + 40);
    f.reveal.forEach(r => { if (r.s <= y + 10) r.el.classList.add('in'); });
  };
  f.clipRect.setAttribute('width', W + 40);
  reveal(-20);
  U.onView(svg, () => {
    if (U.reduced) { reveal(H + 40); return; }
    const t0 = performance.now();
    (function tick(t) {
      const k = U.clamp((t - t0) / 2200, 0, 1);
      reveal(U.ease.out(k) * (H + 40));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }, .8);
  return () => { alive = false; cyc.stop(); };
};

/* one version at a time, chosen by width. The row's markup is kept as the page has it; when the width crosses
   700 px (a rotated tablet, a resized window) the running version stops and the other is built on a fresh copy */
(function captionFigure() {
  const row = document.getElementById('captioning');
  if (!row || !window.FK || !FK.capDesktop || !FK.capPhone) return;
  const blank = row.cloneNode(true);
  const phone = () => matchMedia('(max-width: 700px)').matches;
  let mode = phone(), kill = (mode ? FK.capPhone : FK.capDesktop)();
  U.onWidth(() => {
    if (phone() === mode) return;
    mode = phone();
    if (kill) kill();
    if (FK.playingIn(document.getElementById('captioning'))) FK.stop();
    document.getElementById('captioning').replaceWith(blank.cloneNode(true));
    kill = (mode ? FK.capPhone : FK.capDesktop)();
  });
})();
