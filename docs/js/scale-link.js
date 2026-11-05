// Links "Error Falls Predictably with Compute" (#scale-chart) to "Spend Compute on Data
// First" (#alloc-svg): the allocation chart's compute range is marked in the first chart
// as a lens that opens into the second, and the allocation budget is also a draggable
// marker on the fitted law, with an arrow that carries it down to the allocation.
(function scaleLink() {
  const s1 = document.getElementById('scale-chart');
  const s2 = document.getElementById('alloc-svg');
  const range2 = document.getElementById('al-range');
  const host = document.getElementById('scaling');
  host.style.position = 'relative';
  const ov = U.el('svg', { class: 'sl-ov', 'aria-hidden': 'true' }, host);
  const css = document.createElement('style');
  css.textContent = `
    .sl-ov { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
    .sl-ov text { font: 13px var(--sans); fill: var(--muted); }
    .sl-ov text.k { font-weight: 500; fill: var(--ink-2); }
    .sl-ov .halo { stroke: var(--tint); }
    .sl-ov .layer { opacity: 0; transition: opacity .7s ease; }
    .sl-ov .layer.on { opacity: 1; }
    .sl-ov .grab { cursor: ew-resize; touch-action: none; }
    .sl-ov .cur.on .grab { pointer-events: all; }
    .sl-ov .knob { transition: r .15s; }
    .sl-ov .grab:hover ~ .knob, .sl-ov.dragging .knob { r: 8px; }
    .sl-ov.dragging .hint { opacity: 0; }
    @media (prefers-reduced-motion: reduce) { .sl-ov .layer { transition: none; } }`;
  document.head.appendChild(css);

  // chart coordinates <-> overlay pixels
  const hostRect = () => host.getBoundingClientRect();
  function P(svg, x, y) {
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()), r = hostRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }
  const svgBottom = svg => svg.getBoundingClientRect().bottom - hostRect().top;
  const stacked = () => window.matchMedia('(max-width: 900px)').matches;
  const L1 = law(D.fit);
  const A = D.allocFit, HI = Math.log10(A.hi);
  const X0 = D.allocation[0][0], X1 = 12.35;   // compute axis of the allocation chart, and span of its slider
  const sup = (lc, sz = 10) => { const e = Math.floor(lc); return `${Math.pow(10, lc - e).toFixed(1)} × 10<tspan dy="-5" font-size="${sz}">${e}</tspan><tspan dy="5"> </tspan>`; };

  const lens = U.el('g', { class: 'layer' }, ov);
  const cur = U.el('g', { class: 'layer cur' }, ov);
  const line = (g, o) => U.el('line', Object.assign({ stroke: 'var(--ink)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, o), g);
  // cursor parts, built once and moved on every budget change so their transitions survive
  const c = {
    line: line(cur, {}),
    drop: line(cur, { opacity: .6 }),
    arrow: U.el('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, cur),
    head: U.el('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, cur),
    l1: U.el('text', { class: 'k halo' }, cur),
    l2: U.el('text', { class: 'halo' }, cur),
    score: U.el('text', { class: 'k halo', style: 'fill:var(--fit);font-weight:600' }, cur),
    grab: U.el('rect', { width: 22, fill: 'transparent', class: 'grab' }, cur),
    knob: U.el('circle', { r: 6, fill: 'var(--bg)', stroke: 'var(--fit)', 'stroke-width': 2.4, class: 'knob' }, cur),
    hint: U.el('path', { fill: 'none', stroke: 'var(--fit)', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .8, class: 'hint' }, cur),
  };

  // ---------- the lens: the allocation chart's compute axis, marked in chart 1 and opened into chart 2
  function drawLens() {
    lens.innerHTML = '';
    const g1 = s1._geom, g2 = s2._geom;
    const tl = P(s1, g1.X(X0), g1.M.t), tr = P(s1, g1.X(X1), g1.M.t);
    const bl = P(s1, g1.X(X0), g1.H - g1.M.b);
    const xh = P(s1, g1.X(HI), g1.M.t).x;
    U.el('rect', { x: tl.x, y: tl.y, width: tr.x - tl.x, height: bl.y - tl.y, fill: 'var(--ink)', opacity: .035 }, lens);
    // past the largest measured budget the allocation is extrapolated, as shaded in chart 2
    U.el('rect', { x: xh, y: tl.y, width: tr.x - xh, height: bl.y - tl.y, fill: 'var(--shade)' }, lens);
    U.el('text', { x: tr.x - 6, y: tl.y + 16, 'text-anchor': 'end', text: 'extrapolated' }, lens);
    if (stacked()) {
      [tl, tr].forEach(a => line(lens, { x1: a.x, x2: a.x, y1: a.y, y2: bl.y, stroke: 'var(--ink-2)', opacity: .5 }));
      return;
    }
    const yb = svgBottom(s1) + 4;
    const ul = P(s2, g2.X(X0), g2.M.t), ur = P(s2, g2.X(X1), g2.M.t);
    [tl, tr].forEach(a => line(lens, { x1: a.x, x2: a.x, y1: a.y, y2: yb, stroke: 'var(--ink-2)', opacity: .5 }));
    U.el('path', { d: `M${tl.x} ${yb}L${tr.x} ${yb}L${ur.x} ${ur.y}L${ul.x} ${ul.y}Z`, fill: 'var(--ink)', opacity: .025 }, lens);
    U.el('path', { d: `M${tl.x} ${yb}L${ul.x} ${ul.y}M${tr.x} ${yb}L${ur.x} ${ur.y}M${tl.x} ${yb}H${tr.x}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1, opacity: .45 }, lens);
  }

  // ---------- the cursor: the allocation budget on the fitted law, and the arrow down to chart 2
  let lc = X0 + (X1 - X0) * range2.value / 1000;
  function drawCur() {
    const g1 = s1._geom, g2 = s2._geom;
    const err = L1(Math.pow(10, lc)), extra = lc > HI + .005;
    const top = P(s1, g1.X(lc), g1.M.t), bot = P(s1, g1.X(lc), g1.H - g1.M.b), m = P(s1, g1.X(lc), g1.Y(err));
    const set = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); };
    set(c.line, { x1: top.x, x2: top.x, y1: top.y, y2: bot.y });
    set(c.grab, { x: top.x - 11, y: top.y, height: bot.y - top.y });
    set(c.knob, { cx: m.x, cy: m.y });
    set(c.hint, { d: `M${m.x - 15} ${m.y}l-4 0m4 -3l-4 3l4 3M${m.x + 15} ${m.y}l4 0m-4 -3l4 3l-4 3` });
    // readout beside the knob: the score this budget buys, on the side away from the axis end
    const right = lc < 11.4;
    set(c.score, { x: m.x + (right ? 14 : -14), y: m.y - 14, 'text-anchor': right ? 'start' : 'end' });
    c.score.textContent = `MAEB-30 ${((1 - err) * 100).toFixed(1)}${extra ? ' (extrapolated)' : ''}`;
    const sep = !stacked();
    [c.drop, c.arrow, c.head, c.l1, c.l2].forEach(e => e.style.display = sep ? '' : 'none');
    if (!sep) return;
    const yb = svgBottom(s1) + 4;
    const t = P(s2, g2.X(lc), g2.M.t - 6);
    set(c.drop, { x1: bot.x, x2: bot.x, y1: bot.y, y2: yb });
    const k = (t.y - yb) * .55;
    set(c.arrow, { d: `M${bot.x} ${yb}C${bot.x} ${yb + k} ${t.x} ${t.y - k} ${t.x} ${t.y}` });
    set(c.head, { d: `M${t.x - 5} ${t.y - 6}L${t.x} ${t.y}L${t.x + 5} ${t.y - 6}` });
    const C = Math.pow(10, lc);
    const n = A.n0 * Math.pow(C / 1e12, A.a), d = A.d0 * Math.pow(C / 1e12, A.b);
    const lx = (bot.x + t.x) / 2, ly = (yb + t.y) / 2;
    c.l1.innerHTML = `${sup(lc)}GFLOPs, best spent as`;
    c.l2.innerHTML = `<tspan style="fill:var(--n);font-weight:600">${optSym('N', ' = ' + U.fmt(n))}</tspan> + <tspan style="fill:var(--d);font-weight:600">${optSym('D', ' = ' + U.fmt(d))}</tspan>`;
    // beside the arrow, clear of every part of the curve that runs through the label's rows,
    // on the right if it fits within the figure, else the left, else whichever side has more room
    const lines = [[c.l1, ly - 3], [c.l2, ly + 14]];
    lines.forEach(([l, y]) => set(l, { y }));
    const bb = lines.map(([l]) => l.getBBox()), pad = 12;
    const w = Math.max(...bb.map(b => b.width));
    const y0 = Math.min(...bb.map(b => b.y)) - 6, y1 = Math.max(...bb.map(b => b.y + b.height)) + 6;
    let xa = Infinity, xb = -Infinity;
    for (let i = 0; i <= 80; i++) {
      const u = i / 80, v = 1 - u;
      const px = (v * v * v + 3 * v * v * u) * bot.x + (3 * v * u * u + u * u * u) * t.x;
      const py = v * v * v * yb + 3 * v * v * u * (yb + k) + 3 * v * u * u * (t.y - k) + u * u * u * t.y;
      if (py >= y0 && py <= y1) { xa = Math.min(xa, px); xb = Math.max(xb, px); }
    }
    if (t.y - 6 <= y1) { xa = Math.min(xa, t.x - 5); xb = Math.max(xb, t.x + 5); }   // arrowhead
    if (xa > xb) xa = xb = lx;
    const hr = hostRect(), fr = [s1, s2].map(e => e.getBoundingClientRect());
    const figL = Math.min(fr[0].left, fr[1].left) - hr.left, figR = Math.max(fr[0].right, fr[1].right) - hr.left;
    const roomR = figR - (xb + pad), roomL = (xa - pad) - figL;
    const side = roomR >= w || (roomL < w && roomR >= roomL);
    lines.forEach(([l]) => set(l, { x: side ? xb + pad : xa - pad, 'text-anchor': side ? 'start' : 'end' }));
  }

  // dragging the cursor in chart 1 drives the allocation slider
  function setBudget(clientX) {
    const g1 = s1._geom;
    const x = new DOMPoint(clientX, 0).matrixTransform(s1.getScreenCTM().inverse()).x;
    const l = 8 + (x - g1.X(8)) / (g1.X(12) - g1.X(8)) * 4;
    range2.value = Math.round(U.clamp((l - X0) / (X1 - X0), 0, 1) * 1000);
    range2.dispatchEvent(new Event('input'));
  }
  // one pointer at a time; a cancelled gesture (a system swipe, a palm) or lost capture ends the drag too
  let dragId = null;
  c.grab.addEventListener('pointerdown', ev => {
    if (dragId !== null) return;
    dragId = ev.pointerId;
    ov.classList.add('dragging');
    c.grab.setPointerCapture(ev.pointerId);
    const mv = e => { if (e.pointerId === dragId) setBudget(e.clientX); };
    const up = e => {
      if (e.pointerId !== dragId) return;
      dragId = null;
      ov.classList.remove('dragging');
      ['pointermove', 'pointerup', 'pointercancel'].forEach(t => window.removeEventListener(t, t === 'pointermove' ? mv : up));
      c.grab.removeEventListener('lostpointercapture', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    c.grab.addEventListener('lostpointercapture', up);
    ev.preventDefault();
  });

  // The link appears once the fitted law is shown and chart 2 is in view, and steps away
  // while chart 1 replays its sweep. The first time, chart 2's budget then sweeps up to its
  // default, carrying the knob along the fit and the arrow with it.
  s2.dataset.linked = '1';
  let inView = false, shown = false;
  function sync() {
    const on = inView && s1.classList.contains('fit-on');
    if (on === shown) return;
    shown = on;
    lens.classList.toggle('on', on);
    cur.classList.toggle('on', on);
    if (on) setTimeout(() => s2.dispatchEvent(new Event('sweep')), U.reduced ? 0 : 500);
  }
  U.onView(s2, () => { inView = true; sync(); });
  new MutationObserver(sync).observe(s1, { attributes: true, attributeFilter: ['class'] });
  s2.addEventListener('budget', e => { lc = e.detail; if (s1._geom && s2._geom) drawCur(); });

  function draw() {
    if (!s1._geom || !s2._geom) return;
    drawLens();
    drawCur();
  }
  let raf = 0;
  const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  U.onWidth(redraw);
  new ResizeObserver(redraw).observe(host);
  document.fonts && document.fonts.ready.then(redraw);
  draw();
})();
