/* ================= Key takeaways: three numbers at the top, each card links to its chapter ================= */
// Fills #takeaways in the #chapters row with three linked cards: Dataset, Scaling law, Benchmark. Every card has
// one big number, a short line and a mini chart drawn from window.DATA.
(function takeaways() {
  const D = window.DATA;
  const root = document.getElementById('takeaways');
  if (!D || !root) return;

  const NS = 'http://www.w3.org/2000/svg';
  const fmt1 = v => v.toFixed(1);
  const byName = (list, n) => list.find(o => o.n === n);

  /* ---------- the mini charts, as primitives in a 320 x 140 box ----------
     Colours are roles (acc, ink, ink2, muted, grid, neutral), mapped to CSS variables.
     Shapes: line, poly, rect, dot, text. */
  const W = 320, H = 140;
  const lin = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);

  function chartProgress() {
    const out = [], X = lin(2020.9, 2027.2, 24, 312), Y = lin(25, 55, 120, 6);
    [30, 40, 50].forEach(v => {
      out.push({ t: 'line', x1: 24, y1: Y(v), x2: 312, y2: Y(v), c: 'grid' });
      out.push({ t: 'text', x: 0, y: Y(v) + 3.5, s: 9, c: 'muted', v: String(v) });
    });
    [2021, 2023, 2025].forEach(y => out.push({ t: 'text', x: X(y), y: 137, s: 9, c: 'muted', v: String(y), a: 'middle' }));
    const rel = D.releases.map(([n, y]) => ({ n, y, s: byName(D.maeb, n).s })).sort((a, b) => a.y - b.y);
    // best score so far, as a staircase
    let best = 0; const pts = [];
    rel.forEach(r => { if (r.s > best) { if (pts.length) pts.push([X(r.y), Y(best)]); best = r.s; pts.push([X(r.y), Y(best)]); } });
    pts.push([X(D.oursRelease), Y(best)]);
    out.push({ t: 'poly', pts, c: 'muted', w: 1.5 });
    rel.forEach(r => out.push({ t: 'dot', x: X(r.y), y: Y(r.s), r: 3, c: 'neutral' }));
    const glap = rel.find(r => r.n === 'GLAP');
    out.push({ t: 'text', x: X(glap.y) - 6, y: Y(glap.s) - 7, s: 9.5, c: 'ink2', v: 'GLAP 44.1', a: 'end' });
    out.push({ t: 'line', x1: X(D.oursRelease), y1: Y(D.ours[0].maeb), x2: X(D.oursRelease), y2: Y(52.3), c: 'acc', w: 1.5 });
    D.ours.forEach(o => out.push({ t: 'dot', x: X(D.oursRelease), y: Y(o.maeb), r: 3.4, c: 'acc' }));
    out.push({ t: 'text', x: X(D.oursRelease) - 8, y: Y(52.3) + 3.5, s: 10, c: 'acc', v: 'CLAP2 52.3', a: 'end', b: 1 });
    return { prims: out, cap: 'Best MAEB-30 (%) of CLAP-style models by release' };
  }

  // LAION-Audio-XL's own mix: share of clips by predicted domain
  function chartMix() {
    const out = [], m = D.taxonomy.mix.final;
    const rows = [['Speech', m.speech], ['Music', m.music], ['Sound effects', m.sfx], ['Other', m.other]];
    const X = lin(0, Math.max(...rows.map(r => r[1])), 0, 160), x0 = 104;
    rows.forEach(([n, v], i) => {
      const y = 6 + i * 32;
      out.push({ t: 'text', x: x0 - 8, y: y + 12, s: 10, c: 'ink', v: n, a: 'end' });
      out.push({ t: 'rect', x: x0, y: y + 3, w: X(v), h: 13, c: 'acc', r: 2 });
      out.push({ t: 'text', x: x0 + X(v) + 6, y: y + 13, s: 10, c: 'acc', v: fmt1(v) + '%', b: 1 });
    });
    return { prims: out, cap: 'LAION-Audio-XL clips by predicted domain' };
  }

  // compute-optimal allocation: model size and samples seen against compute, both log scale; data grows faster
  function chartAlloc() {
    const out = [], f = D.allocFit, X = lin(9.6, 12.05, 30, 312), Y = lin(7.2, 9.55, 120, 6);
    [[8, '100M'], [9, '1B']].forEach(([e, l]) => {
      out.push({ t: 'line', x1: 30, y1: Y(e), x2: 312, y2: Y(e), c: 'grid' });
      out.push({ t: 'text', x: 0, y: Y(e) + 3.5, s: 9, c: 'muted', v: l });
    });
    [[10, '10¹⁰'], [11, '10¹¹'], [12, '10¹² GFLOPs']].forEach(([e, l], i) =>
      out.push({ t: 'text', x: X(e), y: 137, s: 9, c: 'muted', v: l, a: i === 2 ? 'end' : 'middle' }));
    const line = (v0, k) => { const pts = []; for (let lc = 9.65; lc <= 12.001; lc += .05) pts.push([X(lc), Y(Math.log10(v0 * Math.pow(10, (lc - 12) * k)))]); return pts; };
    out.push({ t: 'poly', pts: line(f.d0, f.b), c: 'd', w: 2.2 });
    out.push({ t: 'poly', pts: line(f.n0, f.a), c: 'n', w: 2.2 });
    D.allocation.forEach(([lc, n, d]) => {
      out.push({ t: 'dot', x: X(lc), y: Y(Math.log10(d)), r: 2.6, c: 'd' });
      out.push({ t: 'dot', x: X(lc), y: Y(Math.log10(n * 1e6)), r: 2.6, c: 'n' });
    });
    out.push({ t: 'text', x: X(12) - 4, y: Y(Math.log10(f.d0)) - 8, s: 10, c: 'd', v: 'data', a: 'end', b: 1 });
    out.push({ t: 'text', x: X(12) - 4, y: Y(Math.log10(f.n0)) + 21, s: 10, c: 'n', v: 'model size', a: 'end', b: 1 });
    return { prims: out, cap: 'Compute-optimal model size and data against compute, log scale; data grows faster' };
  }

  /* ---------- the three cards ---------- */
  const ours153 = D.ours[3], glap = byName(D.maeb, 'GLAP');
  const aw = D.datasets.find(d => d.name === 'LAION-Audio-XL');

  const CARDS = [
    { href: '#dataset', kick: 'Dataset', acc: 'var(--s-365)', big: Math.round(aw.audio / 1e6) + 'M',
      head: 'audio–text clips in LAION-Audio-XL',
      line: `${(aw.hours / 1e6).toFixed(2)}M hours and ${Math.round(aw.captions / 1e6)}M captions.`,
      chart: chartMix },
    { href: '#alloc', kick: 'Scaling law', acc: 'var(--d)', big: '1.4×',
      head: 'faster data growth than model growth',
      line: 'Given more compute, grow the data first.',
      chart: chartAlloc },
    { href: '#results', kick: 'Benchmark', acc: 'var(--ours)', big: fmt1(ours153.maeb) + '%',
      head: 'MAEB-30 for CLAP2-M (153M)',
      line: `${fmt1(ours153.maeb - glap.s)} points above the best earlier CLAP model.`,
      chart: chartProgress },
  ];

  /* ---------- page rendering ---------- */
  const PAGE_COL = { acc: 'var(--acc)', ink: 'var(--ink)', ink2: 'var(--ink-2)', muted: 'var(--muted)', grid: 'var(--grid)', neutral: 'var(--neutral)', n: 'var(--n)', d: 'var(--d)' };

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function chartSvg(spec, label) {
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tk-chart', role: 'img', 'aria-label': label });
    spec.prims.forEach(p => {
      const c = PAGE_COL[p.c];
      if (p.t === 'line') svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: c, 'stroke-width': p.w || 1, 'stroke-dasharray': p.dash ? p.dash.join(' ') : null }, svg);
      else if (p.t === 'poly') svgEl('polyline', { points: p.pts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': p.w || 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      else if (p.t === 'rect') svgEl('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.r || 0, fill: c }, svg);
      else if (p.t === 'dot') svgEl('circle', { cx: p.x, cy: p.y, r: p.r, fill: c }, svg);
      else if (p.t === 'text') {
        const t = svgEl('text', { x: p.x, y: p.y, fill: c, 'font-size': p.s, 'font-weight': p.b ? 600 : 400, 'text-anchor': p.a || 'start' }, svg);
        t.textContent = p.v;
      }
    });
    return svg;
  }

  const GO = '<svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  CARDS.forEach(c => {
    const spec = c.chart();
    const a = document.createElement('a');
    a.className = 'tk-card';
    a.href = c.href;
    a.style.setProperty('--acc', c.acc);
    a.innerHTML = `
      <span class="tk-top"><span class="tk-kick">${c.kick}</span>${GO}</span>
      <span class="tk-big">${c.big}${c.unit ? `<small>${c.unit}</small>` : ''}</span>
      <span class="tk-head">${c.head}</span>
      <span class="tk-line">${c.line}</span>
      <span class="tk-fig"></span>`;
    a.querySelector('.tk-fig').appendChild(chartSvg(spec, spec.cap));
    root.appendChild(a);
  });
})();
