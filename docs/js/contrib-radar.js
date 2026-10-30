// Contributions: small radar of the Results tile. Our model filled, the best other model below 500M on each
// axis as a dashed outline, on a 10-64 scale (just below the lowest and just above the highest value), so the
// two shapes spread out. The tile is dark in both themes, so the colors are fixed.
(function () {
  const svg = document.getElementById('contrib-radar');
  if (!svg) return;
  const R = DATA.radar, el = U.el, n = R.axes.length;
  const ours = R.models.find(m => m.k === 'ours'), best = R.models.find(m => m.k === 'best');
  const OURS = '#8fb4ff', BEST = 'rgba(255, 255, 255, .7)';
  const cx = 180, cy = 128, r = 76, LO = 10, HI = 64;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, v) => { const f = r * (v - LO) / (HI - LO); return [cx + Math.cos(ang(i)) * f, cy + Math.sin(ang(i)) * f]; };
  const poly = vs => vs.map((v, i) => pt(i, v).join(',')).join(' ');

  // outer and middle ring, spokes
  const grid = el('g', { stroke: 'rgba(255, 255, 255, .14)', fill: 'none' }, svg);
  [HI, (LO + HI) / 2].forEach(v => el('polygon', { points: poly(R.axes.map(() => v)) }, grid));
  R.axes.forEach((_, i) => { const [x, y] = pt(i, HI); el('line', { x1: cx, y1: cy, x2: x, y2: y }, grid); });

  el('polygon', { points: poly(best.v), fill: 'none', stroke: BEST, 'stroke-width': 1.4, 'stroke-dasharray': '4 4', 'stroke-linejoin': 'round' }, svg);
  el('polygon', { points: poly(ours.v), fill: 'rgba(143, 180, 255, .28)', stroke: OURS, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, svg);
  ours.v.forEach((v, i) => { const [x, y] = pt(i, v); el('circle', { cx: x, cy: y, r: 3, fill: OURS }, svg); });

  // axis names with our score and the best other score under them (above them for the top axis)
  R.axes.forEach((a, i) => {
    const c = Math.cos(ang(i)), s = Math.sin(ang(i));
    const x = cx + c * (r + 10), y = cy + s * (r + 10);
    const anchor = c > .5 ? 'start' : c < -.5 ? 'end' : 'middle';
    const yN = s < -.5 ? y - 18 : s > .5 ? y + 13 : y - 3;
    el('text', { x, y: yN, 'text-anchor': anchor, class: 'ax-n', fill: 'rgba(255, 255, 255, .85)', text: a.replace('Pair classification', 'Pair class.') }, svg);
    const t = el('text', { x, y: yN + 15, 'text-anchor': anchor, class: 'ax-v' }, svg);
    el('tspan', { fill: OURS, 'font-weight': 600, text: ours.v[i].toFixed(1) + '%' }, t);
    el('tspan', { fill: 'rgba(255, 255, 255, .55)', text: ' vs ' + best.v[i].toFixed(1) + '%' }, t);
  });

  const lg = document.getElementById('contrib-radar-lg');
  [[OURS, '', 'CLAP2-M (153M)'], [BEST, '4 4', 'Best other model <500M']].forEach(([c, d, t]) => {
    const s = document.createElement('span');
    s.innerHTML = `<svg viewBox="0 0 18 6" width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke="${c}" stroke-width="2" stroke-dasharray="${d}"/></svg>`;
    s.append(t);
    lg.appendChild(s);
  });
})();
