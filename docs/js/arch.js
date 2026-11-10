/* ================= architecture: the two towers ================= */
(function arch() {
  const svg = document.getElementById('arch-svg');
  const detail = document.getElementById('arch-detail'), lead = detail.previousElementSibling;
  const range = document.getElementById('arch-range'), out = document.getElementById('arch-out'), ticks = document.getElementById('arch-ticks');
  const A = D.arch;
  let tier = 3;                       // CLAP2-M, the model in the summary
  let dA = A[tier].a.d, dT = A[tier].t.d;
  let hover = null, pinned = null, compact = null;
  // the walkthrough plays once; it also stops for good when the size is changed, and the figure stays still (as with reduced motion)
  let raf = 0, visible = false, still = false;
  const stop = () => { if (still) return; still = true; cancelAnimationFrame(raf); U.busy('arch', false); render(); };
  const fmtP = p => (p < 10 ? p.toFixed(1) : String(Math.round(p * 10) / 10)) + 'M';

  // size slider, with the size colours of the scaling chart; the labels below it jump to a size
  const sizes = A.map(t => D.sizes.find(s => s.id === t.id));
  const btns = sizes.map((sz, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.tabIndex = -1;
    b.style.setProperty('--i', i / (A.length - 1));
    b.innerHTML = `<i style="background:${sz.color}"></i>${sz.label}`;
    b.addEventListener('click', () => { stop(); range.value = i; setTier(i); });
    ticks.appendChild(b);
    return b;
  });
  range.max = A.length - 1; range.value = tier;
  const showTier = i => {
    btns.forEach((b, j) => b.classList.toggle('on', j === i));
    const name = `CLAP2-${sizes[i].label} (${Math.round(sizes[i].params)}M)`;
    out.textContent = name;
    range.style.setProperty('--thumb', sizes[i].color);
    range.setAttribute('aria-valuetext', name);
  };
  showTier(tier);
  range.addEventListener('input', () => { stop(); setTier(+range.value); });

  // one entry per block: lane, title, subtitle, and the note shown in the panel
  const STAGES = [
    { id: 'wave', lane: 'a', col: 0, ttl: 'Audio', sub: () => '32 kHz, ≤ 30 s',
      note: () => ['Input audio', 'Any audio, resampled to 32 kHz mono, up to 30 s.'] },
    { id: 'mel', lane: 'a', col: 1, ttl: 'Log-mel patches', sub: () => '50 tokens / s',
      note: () => ['Log-mel patches', '128 mel bins, cut into 16 × 16 patches: 50 tokens per second.'] },
    { id: 'aenc', lane: 'a', col: 2, ttl: 'Audio transformer', sub: t => `${t.a.L} × ${t.a.d}, ${t.a.h} heads`,
      note: t => ['Audio transformer (NaFlex ViT)', '2-D RoPE over frequency and time, so any clip length works.',
        [['blocks', t.a.L], ['width', t.a.d], ['parameters', fmtP(t.a.p)]]] },
    { id: 'apool', lane: 'a', col: 3, ttl: 'Pool', sub: () => 'MAP',
      note: () => ['Attention pooling', 'A learned query turns all tokens into one vector, in both towers.'] },
    { id: 'ahead', lane: 'a', col: 4, ttl: 'MLP head', sub: t => `→ ${t.emb}-d`,
      note: t => ['Projection head', `Linear → GELU → Linear into the shared ${t.emb}-d space.`] },
    { id: 'cap', lane: 't', col: 0, ttl: 'Caption', sub: () => '',
      note: () => ['Text input', 'A query, a caption or a class name.'] },
    { id: 'bpe', lane: 't', col: 1, ttl: 'BPE tokens', sub: () => '≤ 256 tokens',
      note: t => ['Tokenizer', `GPT-2 byte-pair encoding, up to 256 tokens.`] },
    { id: 'tenc', lane: 't', col: 2, ttl: 'Text transformer', sub: t => `${t.t.L} × ${t.t.d}, ${t.t.h} heads`,
      note: t => ['Text transformer', 'Bidirectional, in the style of ModernBERT.',
        [['blocks', t.t.L], ['width', t.t.d], ['parameters', fmtP(t.t.p)]]] },
    { id: 'tpool', lane: 't', col: 3, ttl: 'Pool', sub: () => 'MAP',
      note: () => ['Attention pooling', 'A learned query turns all tokens into one vector, in both towers.'] },
    { id: 'thead', lane: 't', col: 4, ttl: 'Linear', sub: t => `→ ${t.emb}-d`,
      note: t => ['Projection', `One linear layer into the shared ${t.emb}-d space.`] },
    { id: 'loss', lane: 'j', ttl: 'CLIP loss', sub: () => '',
      note: () => ['CLIP loss', 'Every clip is scored against every caption. The true pairs on the diagonal should win.'] },
  ];
  const byId = Object.fromEntries(STAGES.map(s => [s.id, s]));
  // the batch's similarity matrix: clip i (row) is paired with caption i (column), fixed scores for the rest
  const BEST = [0, 1, 2, 3, 4, 5];
  const SCORE = (() => { const r = U.rng(41); return BEST.map(() => BEST.map(() => +(.12 + .3 * r()).toFixed(2))); })();

  // encoder blocks grow with the tower's width d (224 to 1024)
  const encSize = (d, lo, hi) => lo + (d - 224) / (1024 - 224) * (hi - lo);

  // geometry of every block for the current layout: wide = lanes left to right, compact = columns top to bottom
  function layout(c) {
    const g = {};
    if (!c) {
      const W = 820, H = 396, Y = { a: 128, t: 282 };
      const cols = [[0, 96], [118, 104], [246, 150], [420, 60], [504, 84]];
      STAGES.forEach(s => {
        if (s.lane === 'j') return;
        const [x, w] = cols[s.col];
        const h = s.col === 2 ? encSize(s.lane === 'a' ? dA : dT, 34, 96) : s.col === 3 ? 50 : 62;
        g[s.id] = { x, y: Y[s.lane] - h / 2, w, h, tx: x + w / 2, ty: s.lane === 'a' ? 50 : 352, cy: Y[s.lane] };
      });
      g.loss = { x: 660, y: 196, w: 126, h: 126, tx: 723, ty: 348, cy: 259 };  // title under the matrix; the text arrow (lo.y + lo.h - 40) meets the text lane straight
      return { W, H, g, dir: 'h' };
    }
    const W = 520, H = 940, X = { a: 128, t: 392 };
    const rows = [[44, 70], [180, 64], [312, 0], [476, 50], [590, 66]];
    STAGES.forEach(s => {
      if (s.lane === 'j') return;
      const [y, h0] = rows[s.col];
      const w = s.col === 2 ? encSize(s.lane === 'a' ? dA : dT, 120, 236) : s.col === 3 ? 96 : 150;
      const h = s.col === 2 ? 96 : h0;
      g[s.id] = { x: X[s.lane] - w / 2, y, w, h, tx: X[s.lane], ty: y + h + 22, cx: X[s.lane] };
    });
    g.loss = { x: 190, y: 740, w: 140, h: 140, tx: 260, ty: 920, cx: 260 };
    return { W, H, g, dir: 'v' };
  }

  function laneCol(s) { return s.lane === 'a' ? 'var(--aud)' : s.lane === 't' ? 'var(--txt)' : 'var(--ink-2)'; }

  // the small picture inside each block
  function icon(s, b, grp, dir) {
    const col = laneCol(s), r = U.rng(s.id.length * 97 + (s.lane === 'a' ? 3 : 7));
    const p = 10;
    if (s.id === 'wave') {
      const n = Math.floor((b.w - 2 * p) / 4);
      for (let i = 0; i < n; i++) {
        const h = (b.h - 2 * p) * (.15 + .85 * Math.abs(Math.sin(i * .5)) * (.35 + .65 * r()));
        U.el('rect', { class: 'wbar', 'data-h': h.toFixed(1), 'data-c': b.y + b.h / 2, x: b.x + p + i * 4, y: b.y + b.h / 2 - h / 2, width: 2.2, height: h, rx: 1.1, fill: col }, grp);
      }
    } else if (s.id === 'mel') {
      const rows = 4, cs = (b.h - 2 * p) / rows, cols = Math.floor((b.w - 2 * p) / cs);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
        U.el('rect', { class: 'mp', x: b.x + p + i * cs + .75, y: b.y + p + j * cs + .75, width: cs - 1.5, height: cs - 1.5, rx: 1.5, fill: col, opacity: (.2 + .8 * r() * (1 - j * .15)).toFixed(2) }, grp);
    } else if (s.id === 'cap') {
      // the walkthrough's query as it ends, so the still figure matches the last frame (four or two text lines, as the animation fills them)
      // the lines in use are centred on the box; the animation moves them as the query wraps
      const lines = dir === 'h' ? ['“dog barking”', '', '', ''] : ['“dog barking”', ''];
      const lh = dir === 'h' ? 12.5 : 17, cy = b.y + b.h / 2 + 4;
      lines.forEach((l, i) => U.el('text', { x: b.x + b.w / 2, y: cy + i * lh, 'text-anchor': 'middle', class: 'in-txt captxt', 'data-cy': cy, 'data-lh': lh, style: `fill:${col}`, text: l }, grp));
    } else if (s.id === 'bpe') {
      const ch = 10, rowsN = Math.floor((b.h - 2 * p + 4) / (ch + 4));
      for (let j = 0; j < rowsN; j++) {
        let x = b.x + p;
        while (true) {
          const w = 10 + 18 * r();
          if (x + w > b.x + b.w - p) break;
          U.el('rect', { class: 'chip', x, y: b.y + p + j * (ch + 4), width: w, height: ch, rx: 3, fill: col, opacity: (.35 + .6 * r()).toFixed(2) }, grp);
          x += w + 3;
        }
      }
    } else if (s.col === 2) {
      // one slat per transformer block, across the direction of flow
      const t = A[tier][s.lane], n = t.L;
      if (dir === 'h') {
        const gap = (b.w - 2 * p) / n;
        for (let i = 0; i < n; i++) U.el('rect', { class: 'slat', x: b.x + p + i * gap + gap * .2, y: b.y + 6, width: gap * .6, height: b.h - 12, rx: 2, fill: col, opacity: .85 }, grp);
      } else {
        const gap = (b.h - 2 * 8) / n;
        for (let i = 0; i < n; i++) U.el('rect', { class: 'slat', x: b.x + 8, y: b.y + 8 + i * gap + gap * .2, width: b.w - 16, height: gap * .6, rx: 2, fill: col, opacity: .85 }, grp);
      }
    } else if (s.col === 3) {
      // funnel narrowing in the direction of flow
      const d = dir === 'h'
        ? `M${b.x + 10} ${b.y + 8} L${b.x + b.w - 12} ${b.y + b.h / 2 - 5} L${b.x + b.w - 12} ${b.y + b.h / 2 + 5} L${b.x + 10} ${b.y + b.h - 8}Z`
        : `M${b.x + 10} ${b.y + 8} L${b.x + b.w - 10} ${b.y + 8} L${b.x + b.w / 2 + 6} ${b.y + b.h - 8} L${b.x + b.w / 2 - 6} ${b.y + b.h - 8}Z`;
      U.el('path', { class: 'fun', d, fill: col, opacity: .8 }, grp);
    } else if (s.col === 4) {
      // projection layers, then the embedding vector
      const mlp = s.lane === 'a';
      const cells = 6;
      if (dir === 'h') {
        const lx = b.x + 10;
        U.el('rect', { class: 'hl', x: lx, y: b.y + 12, width: 9, height: b.h - 24, rx: 2, fill: col, opacity: .55 }, grp);
        if (mlp) {
          U.el('path', { class: 'hl', d: `M${lx + 13} ${b.y + b.h / 2 + 5} q 4 -10 8 -6 t 6 -4`, fill: 'none', stroke: col, 'stroke-width': 1.6 }, grp);
          U.el('rect', { class: 'hl', x: lx + 31, y: b.y + 12, width: 9, height: b.h - 24, rx: 2, fill: col, opacity: .55 }, grp);
        }
        const vx = b.x + b.w - 22, ch = (b.h - 16) / cells;
        for (let i = 0; i < cells; i++) U.el('rect', { class: 'vec', x: vx, y: b.y + 8 + i * ch + .8, width: 12, height: ch - 1.6, rx: 1.5, fill: col, opacity: (.3 + .7 * r()).toFixed(2) }, grp);
      } else {
        const ly = b.y + 10;
        U.el('rect', { class: 'hl', x: b.x + 14, y: ly, width: b.w - 28, height: 8, rx: 2, fill: col, opacity: .55 }, grp);
        if (mlp) U.el('rect', { class: 'hl', x: b.x + 14, y: ly + 16, width: b.w - 28, height: 8, rx: 2, fill: col, opacity: .55 }, grp);
        const cw = (b.w - 28) / cells, vy = b.y + b.h - 22;
        for (let i = 0; i < cells; i++) U.el('rect', { class: 'vec', x: b.x + 14 + i * cw + .8, y: vy, width: cw - 1.6, height: 12, rx: 1.5, fill: col, opacity: (.3 + .7 * r()).toFixed(2) }, grp);
      }
    } else if (s.id === 'loss') {
      // CLIP loss: clip i against caption j, the matched pairs on the diagonal. Drawn with the clips across the top
      // (where the audio arrow comes in) and the captions down the side the text arrow comes in from: the left in
      // the wide layout, the right in the compact one, where the text column stands on the right
      const n = 6, m = 16, cs = (b.w - m) / n, capX = dir === 'h' ? b.x + 5 : b.x + b.w + 6;
      for (let i = 0; i < n; i++) {
        U.el('circle', { class: 'rdot', 'data-i': i, cx: b.x + m + i * cs + cs / 2, cy: b.y + 5, r: 3.2, fill: 'var(--aud)' }, grp);
        U.el('circle', { class: 'cdot', 'data-j': i, cx: capX, cy: b.y + m + i * cs + cs / 2, r: 3.2, fill: 'var(--txt)' }, grp);
        for (let j = 0; j < n; j++) {
          const on = BEST[i] === j, o = on ? .9 : SCORE[i][j];
          U.el('rect', { class: 'cell', 'data-i': i, 'data-j': j, 'data-o': o, x: b.x + m + i * cs + 1, y: b.y + m + j * cs + 1, width: cs - 2, height: cs - 2, rx: 2,
            fill: on ? 'var(--ink)' : 'var(--neutral)', opacity: o }, grp);
        }
      }
    }
  }

  function render() {
    const c = isCompact(svg);
    compact = c;
    const L = layout(c), g = L.g, t = A[tier];
    // a little room on the left for the outline around the audio tower
    svg.setAttribute('viewBox', c ? `0 0 ${L.W} ${L.H}` : `-20 0 ${L.W + 20} ${L.H}`);
    svg.classList.toggle('compact', c);
    svg.innerHTML = '';
    const wires = U.el('g', {}, svg);
    let wireTo = '', wireLane = '';  // the block and lane a wire leads into, so it can light just before the block
    const wire = d => U.el('path', { class: 'wire', d, 'data-to': wireTo, 'data-lane': wireLane }, wires);
    const arrow = (x1, y1, x2, y2) => {
      wire(`M${x1} ${y1} L${x2} ${y2}`);
      const a = Math.atan2(y2 - y1, x2 - x1), s = 5;
      wire(`M${x2 - s * Math.cos(a - .5)} ${y2 - s * Math.sin(a - .5)} L${x2} ${y2} L${x2 - s * Math.cos(a + .5)} ${y2 - s * Math.sin(a + .5)}`);
    };
    const paths = { a: [], t: [] };   // each lane's route through its blocks, to time when each block lights
    // lanes
    ['a', 't'].forEach(lane => {
      wireLane = lane;
      const ss = STAGES.filter(s => s.lane === lane);
      for (let i = 0; i + 1 < ss.length; i++) {
        const p = g[ss[i].id], q = g[ss[i + 1].id];
        wireTo = ss[i + 1].id;
        if (L.dir === 'h') arrow(p.x + p.w + 3, p.cy, q.x - 4, q.cy);
        else arrow(p.cx, p.ty + 28, q.cx, q.y - 4);
      }
      // into the loss
      const h = g[ss[ss.length - 1].id], lo = g.loss;
      wireTo = 'loss';
      const pts = paths[lane], bez = (p0, p1, p2, p3) => { for (let k = 1; k <= 16; k++) { const u = k / 16, v = 1 - u;
        pts.push([v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]); } };
      ss.forEach(st => { const b = g[st.id]; pts.push(...(L.dir === 'h' ? [[b.x, b.cy, st.id], [b.x + b.w, b.cy, st.id]] : [[b.cx, b.y, st.id], [b.cx, b.y + b.h, st.id]])); });
      if (L.dir === 'h' && lane === 'a') {
        // audio comes in from above, onto the clips across the top
        const tx = lo.x + lo.w / 2 + 8;
        wire(`M${h.x + h.w + 3} ${h.cy} C${tx - 30} ${h.cy} ${tx} ${h.cy} ${tx} ${lo.y - 14}`);
        arrow(tx, lo.y - 15, tx, lo.y - 4);
        bez([h.x + h.w, h.cy], [tx - 30, h.cy], [tx, h.cy], [tx, lo.y - 4]);
      } else if (L.dir === 'h') {
        // text comes in from the left, onto the captions down the side
        const ty = lo.y + lo.h - 40;
        wire(`M${h.x + h.w + 3} ${h.cy} C${h.x + h.w + 40} ${h.cy} ${lo.x - 40} ${ty} ${lo.x - 14} ${ty}`);
        arrow(lo.x - 15, ty, lo.x - 6, ty);
        bez([h.x + h.w, h.cy], [h.x + h.w + 40, h.cy], [lo.x - 40, ty], [lo.x - 6, ty]);
      } else if (lane === 't') {
        // compact: text comes down the right column and in from the right, onto the captions
        const ty = lo.y + lo.h - 40, ex = lo.x + lo.w + 12;
        wire(`M${h.cx} ${h.ty + 28} C${h.cx} ${ty} ${h.cx} ${ty} ${ex + 14} ${ty}`);
        arrow(ex + 15, ty, ex + 4, ty);
        pts.push([h.cx, h.ty + 28]);
        bez([h.cx, h.ty + 28], [h.cx, ty], [h.cx, ty], [ex + 4, ty]);
      } else {
        const tx = lo.x + lo.w / 2 + 8;
        wire(`M${h.cx} ${h.ty + 28} C${h.cx} ${h.ty + 50} ${tx} ${lo.y - 40} ${tx} ${lo.y - 14}`);
        arrow(tx, lo.y - 15, tx, lo.y - 4);
        pts.push([h.cx, h.ty + 28]);
        bez([h.cx, h.ty + 28], [h.cx, h.ty + 50], [tx, lo.y - 40], [tx, lo.y - 4]);
      }
    });
    // an outline around each tower, in its color
    const tower = (x, y, w, h, col) => U.el('rect', { class: 'tower', x, y, width: w, height: h, rx: 14, style: `stroke:${col}` }, wires);
    if (L.dir === 'h') {
      tower(-18, 22, 624, 168, 'var(--aud)');
      tower(-18, 220, 624, 166, 'var(--txt)');
    } else {
      tower(6, 24, 244, 690, 'var(--aud)');
      tower(270, 24, 244, 690, 'var(--txt)');
    }
    // lane labels with each tower's size, above each outline over the transformer that holds the parameters
    if (L.dir === 'h') {
      U.el('text', { x: g.aenc.tx, y: 12, 'text-anchor': 'middle', class: 'lane', style: 'fill:var(--aud)', text: `Audio tower · ${fmtP(t.a.p)}` }, svg);
      U.el('text', { x: g.tenc.tx, y: 212, 'text-anchor': 'middle', class: 'lane', style: 'fill:var(--txt)', text: `Text tower · ${fmtP(t.t.p)}` }, svg);
    } else {
      U.el('text', { x: 128, y: 14, 'text-anchor': 'middle', class: 'lane', style: 'fill:var(--aud)', text: `Audio · ${fmtP(t.a.p)}` }, svg);
      U.el('text', { x: 392, y: 14, 'text-anchor': 'middle', class: 'lane', style: 'fill:var(--txt)', text: `Text · ${fmtP(t.t.p)}` }, svg);
    }
    STAGES.forEach(s => {
      const b = g[s.id];
      const grp = U.el('g', { class: 'st', tabindex: 0, role: 'button', 'aria-label': s.note(t)[0], 'data-id': s.id, 'data-lane': s.lane }, svg);
      const top = Math.min(b.y, b.ty - 16) - 4, bot = Math.max(b.y + b.h, b.ty + 18) + 4;
      U.el('rect', { class: 'hit', x: b.x - 6, y: top, width: b.w + 12, height: bot - top, rx: 8, fill: 'transparent' }, grp);
      U.el('rect', { class: 'box', x: b.x, y: b.y, width: b.w, height: b.h, rx: s.id === 'loss' ? 6 : 8, style: s.id === 'loss' ? 'fill:none;stroke:none' : '' }, grp);
      icon(s, b, grp, L.dir);
      const titleY = b.ty;
      U.el('text', { x: b.tx, y: titleY, 'text-anchor': 'middle', class: 'ttl', text: s.ttl }, grp);
      U.el('text', { x: b.tx, y: titleY + (c ? 19 : 16), 'text-anchor': 'middle', class: 'sub', text: s.sub(t) }, grp);
    });
    // animation layer on top; it never takes the pointer
    ov = U.el('g', { class: 'ov', 'pointer-events': 'none' }, svg);
    route = {};
    ['a', 't'].forEach(lane => {
      // cumulative length along the route, and where the route is inside each block
      const pts = paths[lane], cum = [0], span = {};
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const tot = cum[cum.length - 1];
      pts.forEach((p, i) => { if (p[2]) (span[p[2]] = span[p[2]] || []).push(cum[i] / tot); });
      route[lane] = { pts, cum, tot, span };
    });
    geo = L;
    mark();
    if (fx.render) fx.render();
  }
  let ov = null, route = {}, geo = null;
  const fx = {};

  // highlight the active block and fill the panel, without rebuilding the figure
  function mark() {
    const active = hover || pinned;
    svg.classList.toggle('has-active', !!active);
    // blocks that share a description (the two pools) light up together
    const same = active && byId[active].note(A[tier])[0];
    svg.querySelectorAll('.st').forEach(e => e.classList.toggle('on', !!active && (e.dataset.id === active || byId[e.dataset.id].note(A[tier])[0] === same)));
    showDetail();
  }

  function showDetail() {
    const t = A[tier], id = hover || pinned;
    // the details replace the lead text only while a block is hovered or pinned
    detail.hidden = !id; lead.hidden = !!id;
    if (!id) return;
    const [h, txt, kv] = byId[id].note(t);
    detail.innerHTML = `<b>${h}</b>${txt}` + (kv ? `<div class="kv">${kv.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>` : '');
  }

  // interactions: hover previews a block, a click or Enter pins it, a click on the pinned block or elsewhere unpins
  const stageOf = e => e.target.closest && e.target.closest('.st');
  svg.addEventListener('pointerover', e => {
    const g = stageOf(e);
    if (e.pointerType !== 'mouse') return;
    const id = g ? g.dataset.id : null;
    if (id !== hover) { hover = id; mark(); }
  });
  svg.addEventListener('pointerleave', () => { if (hover) { hover = null; mark(); } });
  svg.addEventListener('click', e => {
    const g = stageOf(e);
    pinned = g && pinned !== g.dataset.id ? g.dataset.id : null;
    mark();
  });
  svg.addEventListener('keydown', e => {
    const g = stageOf(e);
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      pinned = pinned === g.dataset.id ? null : g.dataset.id;
      mark();
    }
  });
  // on phones the details pin to the bottom of the screen: a tap outside the figure, or scrolling it away, unpins
  const phone = matchMedia('(max-width: 640px)');
  document.addEventListener('click', e => {
    if (pinned && phone.matches && !svg.contains(e.target)) { pinned = null; mark(); }
  });
  // Lio (js/ask.js) climbs onto the pinned details rather than staying hidden behind them
  new ResizeObserver(() => {
    const h = phone.matches && !detail.hidden ? detail.offsetHeight + 8 : 0;
    document.documentElement.style.setProperty('--lio-lift', h + 'px');
  }).observe(detail);
  new IntersectionObserver(([en]) => {
    if (pinned && phone.matches && !en.isIntersecting) { pinned = null; mark(); }
  }).observe(svg);
  // keyboard focus shows a block's details as it is reached
  svg.addEventListener('focusin', e => {
    const g = stageOf(e);
    if (g && g.matches(':focus-visible')) { pinned = g.dataset.id; mark(); }
  });

  // switching tiers: the encoder blocks grow or shrink to the new widths
  let anim = 0;
  function setTier(i) {
    if (i === tier) return;
    showTier(i);
    const fa = dA, ft = dT, ta = A[i].a.d, tt = A[i].t.d;
    tier = i;
    cancelAnimationFrame(anim);
    if (U.reduced) { dA = ta; dT = tt; render(); return; }
    const t0 = performance.now();
    (function step(now) {
      const k = U.ease.inOut(Math.min(1, (now - t0) / 450));
      dA = U.lerp(fa, ta, k); dT = U.lerp(ft, tt, k);
      render();
      if (k < 1) anim = requestAnimationFrame(step);
    })(t0);
  }

  // ---------- animation: one clip and one query run through the model ----------
  // Both inputs start together: the waveform plays while the query is typed. Then each arrow and block
  // fades in as the data reaches it, so a cycle walks through the whole figure. The text side is faster in
  // proportion to its share of the compute (GFLOPs per clip of each tower) and waits at the matrix. When the
  // audio arrives, the pair is scored and the best text for that clip is ringed; then all dims and the next
  // clip and query begin.
  const ease = U.ease.inOut, ramp = (t, a, d) => U.clamp((t - a) / d, 0, 1);
  const QUERIES = ['dog barking', 'crowd cheering', 'rain on a tin roof', 'a man speaking', 'church bells', 'jazz piano'];
  const AUDIO_DUR = 4.2, P = 7.2, DIM = .22;
  const q = sel => svg.querySelectorAll(sel);
  const cell = (i, j) => svg.querySelector(`.cell[data-i="${i}"][data-j="${j}"]`);
  function ring(i, j, a) {
    const c = cell(i, j); if (!c) return;
    const x = +c.getAttribute('x'), y = +c.getAttribute('y'), w = +c.getAttribute('width'), e = 3 + 4 * (1 - a);
    U.el('rect', { x: x - e, y: y - e, width: w + 2 * e, height: w + 2 * e, rx: 4, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6, opacity: a.toFixed(2) }, ov);
  }
  function frame(now) {
    if (!ov || !geo) return false;
    ov.innerHTML = '';
    // one pass only: it starts when the figure comes into view and settles into the still figure before the fade-out
    const t = (now - startAt) / 1000, cyc = 0, u = t;
    if (u >= P - .7) { stop(); return false; }
    const row = cyc % 6, col = BEST[row], query = QUERIES[col], tr = A[tier];
    const textDur = AUDIO_DUR * tr.gf.t / tr.gf.a;          // e.g. 4.2 s x 29.8 / 123.1 for the 153M model
    const a0 = .5, t0 = 1.0;                                  // audio leaves once the clip has started playing, text once typed
    const ft = ramp(u, t0, textDur);
    const landA = a0 + AUDIO_DUR, out = ramp(u, P - .7, .6);  // the pair lands; the cycle fades out at the end
    const spans = { a: route.a.span, t: route.t.span };
    // when each block lights: when the data reaches it (inputs at the start, the matrix when the audio arrives)
    const lightAt = id => {
      if (id === 'wave' || id === 'cap') return 0;
      if (id === 'loss') return landA;
      const lane = byId[id].lane, sp = spans[lane][id];
      return lane === 'a' ? a0 + sp[0] * AUDIO_DUR : t0 + sp[0] * textDur;
    };
    const active = hover || pinned;
    q('.st').forEach(g => {
      const id = g.dataset.id, on = ease(ramp(u, lightAt(id) - .05, .35));
      // a hovered or pinned block takes over the dimming (CSS); otherwise the walkthrough sets it
      g.style.opacity = active ? '' : (DIM + (1 - DIM) * on * (1 - out)).toFixed(3);
    });
    // inside each block: its parts fill in, in order, while the data is in that block
    const laneEnd = { a: landA, t: t0 + textDur };
    const fill = (els, p) => {
      const n = els.length;
      els.forEach((e, k) => {
        if (e.dataset.o0 == null) e.dataset.o0 = e.getAttribute('opacity') || 1;
        e.style.opacity = (+e.dataset.o0 * ease(ramp(p, k / n * .8, .2))).toFixed(3);
      });
    };
    ['a', 't'].forEach(lane => {
      const ss = STAGES.filter(st => st.lane === lane);
      ss.forEach((st, k) => {
        const g = svg.querySelector(`.st[data-id="${st.id}"]`); if (!g) return;
        const a = lightAt(st.id), b = k + 1 < ss.length ? lightAt(ss[k + 1].id) : laneEnd[lane];
        const p = (st.id === 'wave' || st.id === 'cap') ? 1 : ramp(u, a, Math.max(.25, b - a));
        if (st.col === 1) fill(g.querySelectorAll(st.id === 'mel' ? '.mp' : '.chip'), p);
        else if (st.col === 2) fill(g.querySelectorAll('.slat'), p);
        else if (st.col === 3) fill(g.querySelectorAll('.fun'), p);
        else if (st.col === 4) fill(g.querySelectorAll('.hl, .vec'), p);
      });
    });
    q('.wire').forEach(w => {
      const to = w.dataset.to, lane = w.dataset.lane;
      const when = to === 'loss' ? (lane === 'a' ? landA : t0 + textDur) : lightAt(to);
      const on = ease(ramp(u, when - .3, .3));
      w.style.opacity = active ? '' : (DIM + (1 - DIM) * on * (1 - out)).toFixed(3);
    });
    // 1 the clip plays: the waveform moves until the audio has moved on
    const play = u < a0 + .25 * AUDIO_DUR;
    q('.wbar').forEach((e, i) => {
      const h0 = +e.dataset.h, c = +e.dataset.c, k = play ? .55 + .45 * Math.abs(Math.sin(t * 5 + i * .7)) : 1;
      e.setAttribute('height', (h0 * k).toFixed(1)); e.setAttribute('y', (c - h0 * k / 2).toFixed(1));
    });
    // 2 the query is typed, centred in the text box
    const typed = query.slice(0, Math.round(ramp(u, .1, .8) * query.length));
    const lines = q('.captxt'), words = `“${typed}${typed.length === query.length ? '”' : ''}`.split(' '), per = geo.dir === 'h' ? 13 : 24, rowsTxt = [''];
    words.forEach(w => { const l = rowsTxt[rowsTxt.length - 1]; if ((l + ' ' + w).trim().length > per && l) rowsTxt.push(w); else rowsTxt[rowsTxt.length - 1] = (l + ' ' + w).trim(); });
    lines.forEach((e, k) => {
      e.textContent = rowsTxt[k] || '';
      e.setAttribute('y', +e.dataset.cy + (k - (rowsTxt.length - 1) / 2) * +e.dataset.lh);
    });
    // 3 the pair lands: this clip's column and this query's row, the match ringed; earlier matches stay marked
    const land = ramp(u, landA, .45);
    q('.cell').forEach(c => {
      const i = +c.dataset.i, j = +c.dataset.j, best = BEST[i] === j;
      const done = (i - row + 6) % 6 >= 4 ? 0 : 1;          // the last few rows stay marked
      let o = best ? (i === row ? .25 + .65 * land : done && i !== row ? .75 : .25) : +c.dataset.o;
      if (land > 0 && (i === row || j === col) && !best) o = U.lerp(o, +c.dataset.o + .15, land);
      c.setAttribute('opacity', o.toFixed(2));
      c.style.opacity = ease(ramp(u, landA + i * .07, .3)).toFixed(3);   // the scores fill in clip by clip
    });
    if (land > 0) ring(row, col, Math.min(1, land * 1.6));
    q('.rdot').forEach(d => d.setAttribute('r', +d.dataset.i === row && land > 0 ? 4.8 : 3.2));
    q('.cdot').forEach(d => d.setAttribute('r', +d.dataset.j === col && ft >= 1 ? 4.8 : 3.2));
    return true;
  }
  let startAt = 0;
  function run() {
    cancelAnimationFrame(raf);
    if (still) return;
    startAt = performance.now();                           // left mid-way: the pass starts over when it is back in view
    const step = () => { frame(performance.now()); if (visible && !still) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  fx.render = () => { if (!U.reduced && !still && startAt) frame(performance.now()); };
  if (!U.reduced) U.watchView(svg, v => { visible = v; U.busy('arch', v && !still, (P - .7) * 1000); if (v) run(); });

  render();
  U.onWidth(() => { if (isCompact(svg) !== compact) render(); });
})();

/* ================= patches: real LAION-Audio-XL audio as a log-mel spectrogram, cut into 16 x 16 patches ================= */
(function patches() {
  const wrap = document.getElementById('pt-wrap');
  const cv = document.getElementById('pt-canvas');
  const tip = document.getElementById('pt-tip');
  const range = document.getElementById('pt-range');
  const out = { s: document.getElementById('pt-s') };
  // the axis runs to 35 s and fades out (longer inputs work too); training clips end at 30.08 s (188 patch columns, 1,504 tokens)
  const TMAX = 35, LIMIT = 30.08, TOKMAX = 1504;
  let mel = null, status = 'idle', hover = null, img = null, imgKey = '', colKey = '', tokCol = [];

  // ---- log-mel front end, as in training: 128 bins from 50 Hz to 16 kHz, 100 frames per second
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2;
          const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function logMel(x, sr) {
    const hop = Math.round(sr / 100), win = Math.round(sr * 0.032);
    let nfft = 1; while (nfft < win) nfft <<= 1;
    const nb = nfft / 2 + 1, NM = 128, fmax = Math.min(16000, sr / 2);
    const m = f => 2595 * Math.log10(1 + f / 700), mi = v => 700 * (Math.pow(10, v / 2595) - 1);
    const pts = []; for (let i = 0; i < NM + 2; i++) pts.push(mi(m(50) + (m(fmax) - m(50)) * i / (NM + 1)));
    const fb = [];
    for (let j = 0; j < NM; j++) {
      const lo = pts[j], c = pts[j + 1], hi = pts[j + 2], w = [];
      for (let k = 0; k < nb; k++) {
        const f = k * sr / nfft;
        const v = f < lo || f > hi ? 0 : f <= c ? (f - lo) / (c - lo) : (hi - f) / (hi - c);
        if (v > 0) w.push(k, v);
      }
      fb.push(w);
    }
    const hann = new Float32Array(win).map((_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / win));
    const frames = Math.min(Math.floor(x.length / hop), Math.round(TMAX * 100));
    const out = new Float32Array(frames * NM), env = new Float32Array(frames), re = new Float32Array(nfft), im = new Float32Array(nfft), pw = new Float32Array(nb);
    let top = -Infinity;
    for (let f = 0; f < frames; f++) {
      re.fill(0); im.fill(0);
      const s0 = f * hop - (win >> 1);
      for (let i = 0; i < win; i++) { const v = x[s0 + i]; if (v) re[i] = v * hann[i]; }
      let pk = 0; for (let i = f * hop; i < (f + 1) * hop && i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
      env[f] = pk;
      fft(re, im);
      for (let k = 0; k < nb; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
      for (let j = 0; j < NM; j++) {
        const w = fb[j]; let e = 0;
        for (let q = 0; q < w.length; q += 2) e += pw[w[q]] * w[q + 1];
        const db = 10 * Math.log10(e + 1e-10);
        out[f * NM + j] = db; if (db > top) top = db;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = U.clamp((out[i] - (top - 60)) / 60, 0, 1);
    return { mel: out, env, frames };
  }
  function load(i) {
    return fetch(D.samples[i].src).then(r => r.arrayBuffer()).then(buf => {
      // decode straight to 32 kHz where the browser allows it, otherwise at the context rate
      let ctx;
      try { ctx = new OfflineAudioContext(1, 1, 32000); } catch (e) { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      return new Promise((ok, fail) => ctx.decodeAudioData(buf, ok, fail));
    }).then(a => logMel(a.getChannelData(0), a.sampleRate));
  }
  // the three example clips back to back (music, speech, sound): about 84 s of real audio
  function loadAll() {
    return Promise.all([1, 2, 0].map(load)).then(ms => {
      const frames = ms.reduce((n, m) => n + m.frames, 0), all = new Float32Array(frames * 128), env = new Float32Array(frames);
      let o = 0; ms.forEach(m => { all.set(m.mel, o * 128); env.set(m.env, o); o += m.frames; });
      let top = 0; env.forEach(v => { if (v > top) top = v; });
      env.forEach((v, i) => { env[i] = v / (top || 1); });
      // each token's colour: the mean of its 16 x 16 patch (column c, band k from the bottom)
      const nc = Math.floor(frames / 16), pm = new Float32Array(nc * 8);
      for (let c = 0; c < nc; c++) for (let k = 0; k < 8; k++) {
        let sum = 0;
        for (let f = c * 16; f < c * 16 + 16; f++) for (let j = k * 16; j < k * 16 + 16; j++) sum += all[f * 128 + j];
        pm[c * 8 + k] = sum / 256;
      }
      return { mel: all, env, frames, pm };
    });
  }

  // ---- drawing
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function rgb(c) {
    if (c.startsWith('#')) return U.hex(c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c);
    const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  // colour ramp from the page background through the audio colour to ink
  function ramp() {
    const bg = rgb(css('--bg')), au = rgb(css('--aud')), ink = rgb(css('--ink'));
    return v => { v = Math.pow(v, 1.5); return v < .65 ? U.mix(bg, au, v / .65) : U.mix(au, ink, (v - .65) / .35 * .8); };
  }
  const themeKey = () => css('--bg') + css('--aud') + css('--ink');
  // the spectrogram as an image at its native size (frames x 128)
  function specImage() {
    if (img && imgKey === themeKey()) return img;
    const col = ramp(), c = document.createElement('canvas'); c.width = mel.frames; c.height = 128;
    const ctx = c.getContext('2d'), id = ctx.createImageData(mel.frames, 128);
    for (let f = 0; f < mel.frames; f++) for (let j = 0; j < 128; j++) {
      const k = col(mel.mel[f * 128 + j]), o = ((127 - j) * mel.frames + f) * 4;
      id.data[o] = k[0]; id.data[o + 1] = k[1]; id.data[o + 2] = k[2]; id.data[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    img = c; imgKey = themeKey();
    return c;
  }
  function tokenColours() {
    if (colKey === themeKey()) return tokCol;
    const col = ramp();
    tokCol = Array.from(mel.pm, v => { const k = col(Math.min(1, v * 1.25)); return `rgb(${k[0] | 0},${k[1] | 0},${k[2] | 0})`; });
    colKey = themeKey();
    return tokCol;
  }

  const cols = () => +range.value;                        // patch columns (160 ms each)
  const len = () => cols() * 0.16;
  const PER = 128, ROWS = 14;                              // token grid: 16 patch columns (2.56 s) per row, 14 rows hold the 1,744 tokens of 34.88 s
  // token i comes from patch column floor(i / 8), band i % 8 counted from the lowest frequencies
  let G = null, shown = 0, anim = 0;
  const start = new Float64Array(PER * ROWS);              // when each token appears
  const FADE = U.reduced ? 0 : 500;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function geom() {
    const w = wrap.clientWidth, c = w < 520;
    // overview of the whole clip, then the token sequence
    const waveTop = 26, waveH = c ? 24 : 28, stripTop = waveTop + waveH + 4, stripH = c ? 30 : 36;
    const tokTop = stripTop + stripH + 60, pitch = w / PER;
    return { w, c, waveTop, waveH, stripTop, stripH, tokTop, pitch, h: tokTop + ROWS * pitch + 4,
      X: t => t / TMAX * w };
  }
  const slotBox = (g, i) => { const s = g.pitch * .8; return [(i % PER) * g.pitch, g.tokTop + Math.floor(i / PER) * g.pitch, s, s]; };
  const appear = (i, now) => U.clamp((now - start[i]) / FADE, 0, 1);

  function draw(now = performance.now()) {
    const g = G = geom(), { w, X } = g;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(g.h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(g.h * dpr); cv.style.height = g.h + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, g.h);
    const n = cols() * 8, s = len(), xs = X(s), xl = X(LIMIT);
    const muted = css('--muted'), line = css('--line-2'), aud = css('--aud'), ink = css('--ink'), bg = css('--bg');
    const font = getComputedStyle(document.body).getPropertyValue('--sans') || 'sans-serif';
    ctx.font = `14px ${font}`; ctx.textBaseline = 'alphabetic';
    const label = (t, x, y, col = muted, al = 'left') => { ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(t, x, y); };
    let busy = false;

    // 1 overview: waveform over the spectrogram strip, 0 to 35 s
    label('waveform and log-mel spectrogram', 0, g.waveTop - 8);
    ctx.fillStyle = bg; ctx.fillRect(0, g.waveTop, w, g.waveH + 4 + g.stripH);
    if (mel) {
      const mid = g.waveTop + g.waveH / 2;
      // only the clip at its chosen length: the waveform ends where the spectrogram does
      ctx.fillStyle = aud;
      for (let x = 0; x < xs; x += 2) {
        const f0 = Math.floor(x / w * TMAX * 100), f1 = Math.min(mel.frames, Math.floor((x + 2) / w * TMAX * 100));
        let a = 0; for (let f = f0; f < f1; f++) a = Math.max(a, mel.env[f]);
        const hh = Math.max(1, a * (g.waveH - 4));
        ctx.fillRect(x, mid - hh / 2, Math.min(1.4, xs - x), hh);
      }
      const fr = Math.min(mel.frames, Math.round(s * 100));
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(specImage(), 0, 0, fr, 128, 0, g.stripTop, X(fr / 100), g.stripH);
    } else label(status === 'error' ? 'Audio unavailable' : 'Loading audio…', 8, g.stripTop + 22);
    ctx.strokeStyle = aud; ctx.lineWidth = 1.5; ctx.strokeRect(.75, g.stripTop + .75, Math.max(0, xs - 1.5), g.stripH - 1.5);
    for (let t = 0; t <= TMAX; t += g.c ? 10 : 5) {
      const x = X(t); ctx.fillStyle = muted; ctx.fillRect(Math.round(x), g.stripTop + g.stripH, 1, 4);
      label(t + ' s', x, g.stripTop + g.stripH + 19, muted, t === 0 ? 'left' : t === TMAX ? 'right' : 'center');
    }
    // past 30 s: works, but longer than any training clip; the axis stops at 35 s, the input does not
    ctx.save();
    ctx.beginPath(); ctx.rect(xl, g.waveTop, w - xl, g.waveH + 4 + g.stripH); ctx.clip();
    ctx.fillStyle = css('--tint'); ctx.globalAlpha = .5; ctx.fillRect(xl, g.waveTop, w - xl, g.waveH + 4 + g.stripH); ctx.globalAlpha = 1;
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let x = xl - 120; x < w + 120; x += 8) { ctx.beginPath(); ctx.moveTo(x, g.stripTop + g.stripH); ctx.lineTo(x + 100, g.waveTop - 30); ctx.stroke(); }
    ctx.restore();
    const fw = Math.min(48, w * .07), bgc = rgb(bg), fade = ctx.createLinearGradient(w - fw, 0, w, 0);
    fade.addColorStop(0, `rgba(${bgc[0]},${bgc[1]},${bgc[2]},0)`); fade.addColorStop(1, `rgba(${bgc[0]},${bgc[1]},${bgc[2]},1)`);
    ctx.fillStyle = fade; ctx.fillRect(w - fw, g.waveTop, fw, g.waveH + 4 + g.stripH);
    ctx.strokeStyle = muted; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(Math.round(xl) + .5, g.waveTop - 4); ctx.lineTo(Math.round(xl) + .5, g.stripTop + g.stripH); ctx.stroke(); ctx.setLineDash([]);
    label('beyond training →', w, g.waveTop - 8, muted, 'right');

    // 2 token sequence
    const beyond = Math.max(0, n - TOKMAX);
    // the token count is the figure's readout: large, in the audio color, after a quiet label
    label('token sequence', 0, g.tokTop - 10);
    let lx = ctx.measureText('token sequence').width + 10;
    ctx.font = `600 20px ${font}`;
    label(`${n.toLocaleString('en-US')} tokens`, lx, g.tokTop - 10, aud);
    lx += ctx.measureText(`${n.toLocaleString('en-US')} tokens`).width + 8;
    ctx.font = `14px ${font}`;
    if (beyond) label(`(${beyond.toLocaleString('en-US')} beyond training length)`, lx, g.tokTop - 10);
    ctx.fillStyle = css('--grid-minor');
    for (let r = 0; r < ROWS; r++) ctx.fillRect(0, g.tokTop + r * g.pitch + g.pitch * .4 - .5, w, 1);
    if (mel) {
      const tc = tokenColours(), m = Math.min(n, shown);
      for (let i = 0; i < m; i++) {
        const p = FADE ? appear(i, now) : 1;
        if (p < 1) busy = true;
        if (p <= 0) continue;
        const [x, y, sz] = slotBox(g, i);
        ctx.globalAlpha = (i >= TOKMAX ? .45 : 1) * easeOut(p);
        ctx.fillStyle = tc[i] || aud; ctx.fillRect(x, y, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
    // hovered token and where it sits in the clip
    if (hover != null && hover < n && mel) {
      const [bx, by2, bs] = slotBox(g, hover);
      ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.strokeRect(bx - 1, by2 - 1, bs + 2, bs + 2);
      const hx = X(Math.floor(hover / 8) * .16);
      ctx.fillStyle = ink; ctx.fillRect(hx, g.stripTop - 2, Math.max(1.5, X(.16)), g.stripH + 4);
    }
    return busy;
  }
  function loop() {
    cancelAnimationFrame(anim);
    const step = () => { if (draw(performance.now())) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  }
  // grow: new columns fade in one after another; shrink: tokens go at once
  function setTokens(n) {
    const now = performance.now();
    if (n > shown) {
      const c1 = shown / 8, c2 = n / 8, kc = c2 - c1;
      const gap = U.clamp(1600 / kc, 10, 70);              // between columns, ms
      for (let c = c1; c < c2; c++) for (let k = 0; k < 8; k++) {
        const i = c * 8 + k;
        start[i] = now + (c - c1) * gap + k * 28;
      }
    }
    shown = n;
    loop();
  }
  function update() {
    const s = len(), tok = cols() * 8;
    out.s.innerHTML = s.toFixed(2) + ' s' + (s > LIMIT + 1e-9 ? ' <span class="beyond">beyond training</span>' : '');
    range.setAttribute('aria-valuetext', `${s.toFixed(2)} seconds, ${tok} tokens`);
    if (mel) setTokens(tok); else draw();
  }
  range.addEventListener('input', update);
  // hover a token: it is marked, with where it comes from in the clip
  cv.addEventListener('pointermove', e => {
    if (!G || !mel) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = G;
    let i = null;
    if (y >= g.tokTop) {
      const k = Math.floor((y - g.tokTop) / g.pitch) * PER + Math.floor(x / g.pitch);
      if (k >= 0 && k < cols() * 8) i = k;
    }
    hover = i;
    if (i == null) { tip.style.opacity = 0; draw(); return; }
    const t0 = Math.floor(i / 8) * 0.16, mb = (i % 8) * 16;
    tip.innerHTML = `<b>token ${(i + 1).toLocaleString('en-US')}</b> <span>· ${t0.toFixed(2)}–${(t0 + .16).toFixed(2)} s · mel bins ${mb + 1}–${mb + 16}</span>`;
    const [bx, by] = slotBox(g, i);
    tip.style.left = U.clamp(bx, 130, r.width - 130) + 'px'; tip.style.top = by + 'px'; tip.style.opacity = 1;
    draw();
  });
  cv.addEventListener('pointerleave', () => { hover = null; tip.style.opacity = 0; draw(); });
  U.onWidth(() => draw());
  // colours come from the theme tokens; repaint when the theme switches
  const repaint = () => { img = null; colKey = ''; draw(); };
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  update();
  // fetch and decode once the figure is near; the first tokens are cut as it comes into view
  let seen = false;
  const begin = () => { if (seen && mel && !shown) setTimeout(() => setTokens(cols() * 8), 250); };
  U.onView(wrap, () => {
    status = 'loading';
    loadAll().then(m => { mel = m; status = 'ok'; draw(); begin(); }, () => { status = 'error'; draw(); });
  }, 1.4);
  U.onView(wrap, () => { seen = true; begin(); });
})();

