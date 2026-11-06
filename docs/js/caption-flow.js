/* ================= caption generation: one clip traced through the expert models and the captioner =================
   A Sankey in the style of Figure 1. The clip fans out to the expert models: taxonomy and signal statistics for every
   clip, then the specialists its predicted top-level category routes it to (thesis, appendix B.2). Their output and
   the audio fan back into the captioning model, which gets the audio with the raw metadata JSON (section 3.4) and
   writes a short and a long caption; those streams are as wide as the captions are long. The sample on the right
   keeps the audio and annotations next to the captions. */
(function captionFlow() {
  const svg = document.getElementById('cap-svg');
  if (!svg || !window.FK) return;
  const S = window.DATA.samples, X = FK.EXPERTS, GROUPS = FK.GROUPS, esc = FK.esc;
  const AUDIO_ROW = { key: 'audio', group: null, name: 'Audio', by: 'the clip itself', icon: 'wave', val: m => `${FK.time(m.duration)} clip, ${m.sr_orig / 1000} kHz` };
  const ROWS = [AUDIO_ROW, ...X];
  const CAPTION_INFO = 'Seven captioner configurations were compared on speed, vocabulary diversity and quality (human and LLM rankings). Qwen3-Omni-30B-A3B-Instruct is fast (75.9 clips/s per node); MOSS-Audio-8B-Thinking writes the most diverse and best-rated captions. Each captioned a disjoint half of the 471,237,555 clips without text, writing a short and a long caption (12 and 29 words on average). The prompt carries the clip’s raw metadata JSON, which ranked best against audio-only and natural-language prompts.';
  const EXPERT_INFO = 'A 3,718-class taxonomy classifier (an MLP on Dasheng-0.6B features) and signal statistics (loudness, silence, clipping, bandwidth) run on every clip. The predicted top-level category then routes it to specialists: speech to language (MMS-LID-4017), speaker age and gender (wav2vec2), emotion (emotion2vec+ large) and pitch (CREPE); music to genre and style (MAEST, 400 Discogs labels) and tempo and key (librosa); animal sounds to species (Perch 2.0).';
  // phones get the top-to-bottom version (caption-flow-m.js)
  FK.CF = { AUDIO_ROW, CAPTION_INFO, EXPERT_INFO };
  // the desktop version; js/caption-flow-m.js decides which one runs and swaps them when the width crosses 700 px
  FK.capDesktop = function build() {
    const svg = document.getElementById('cap-svg');
    let alive = true;
    const words = t => t.trim().split(/\s+/).length;
    const groupOn = (m, g) => g.key === 'all' || X.some(r => r.group === g.key && r.val(m));
    const lerp = (a, b, k) => a + (b - a) * k;
    const tween = (dur, fn) => {
      if (U.reduced || !dur) { fn(1); return; }
      const t0 = performance.now();
      (function f(t) { const k = U.clamp((t - t0) / dur, 0, 1); fn(U.ease.inOut(k)); if (k < 1) requestAnimationFrame(f); })(t0);
    };

    // ---------- layout: the audio row, then each group's header and its experts ----------
    const HEAD = 24, PITCH = 40, NODE_H = PITCH - 6;
    const rowY = [], heads = [];
    let c = HEAD + 32;
    rowY.push(c + PITCH / 2); c += PITCH + 8;
    GROUPS.forEach(g => {
      heads.push({ g, y: c + 12 });
      c += 20;
      X.forEach((r, i) => { if (r.group === g.key) { rowY[i + 1] = c + PITCH / 2; c += PITCH; } });
      c += 6;
    });
    const W = 1120, H = Math.ceil(c + 14), f = FK.setup(svg, W, H);
    const TC = (rowY[0] + rowY[ROWS.length - 1]) / 2, FAN = 110;
    const S0 = 184, N0 = 324, N1 = 584, B0 = 650, B1 = 794, RX = 866;
    // the captioning box holds one box per captioner; streams enter and leave the one that captioned this clip
    const MC = [TC - 44, TC + 70], FIN = 76;
    // the clip sends audio to every expert (green); what leaves an expert is its annotation (cyan)
    const colorOf = i => (i ? '--s-dedup' : '--s-select');
    // svg coordinates of an html element inside a foreignObject
    function box(el) {
      const r = el.getBoundingClientRect(), s = svg.getBoundingClientRect(), k = W / s.width;
      return { y: (r.top - s.top) * k, h: r.height * k, mid: (r.top + r.height / 2 - s.top) * k };
    }

    let w = ROWS.map(() => 0), wOut = [30, 70], ends = [[TC - 40, 40], [TC + 40, 100]], on = ROWS.map(() => true);
    let mc = MC[0], hl = null;   // hovered expert { row } or caption { out }
    // squeeze the clip-side band of height FAN onto the active model box
    const fin = y => mc - FIN / 2 + (y - (TC - FAN / 2)) * FIN / FAN;
    function geo() {
      let a = TC - FAN / 2;
      const rows = ROWS.map((r, i) => {
        // at the node a stream is no taller than the node's box
        const y = rowY[i], lo = a, h = Math.min(w[i], NODE_H - 8); a += w[i];
        return {
          fo: FK.seg(S0, lo, lo + w[i], N0, y - h / 2, y + h / 2, '--s-select'),
          fi: FK.seg(N1, y - h / 2, y + h / 2, B0 + 8, fin(lo), fin(lo + w[i]), colorOf(i)),
        };
      });
      let o = TC - FAN / 2;
      const outs = [0, 1].map(j => {
        const lo = o; o += wOut[j];
        const [cy, max] = ends[j], ww = Math.min(wOut[j], max - 6);
        return FK.seg(B1 - 8, fin(lo), fin(lo + wOut[j]), RX, cy - ww / 2, cy + ww / 2, j ? '--s-collect' : '--s-500');
      });
      return { rows, outs };
    }

    // ---------- ribbons ----------
    const P = { fo: [], fi: [], out: [] };
    ROWS.forEach((r, i) => {
      P.fo.push(U.el('path', { class: 'rib', fill: f.grad(S0, N0, '--s-select', '--s-select', .38, .3) }, f.bands));
      P.fi.push(U.el('path', { class: 'rib', fill: f.grad(N1, B0, colorOf(i), colorOf(i), .3, .5) }, f.bands));
    });
    ['--s-500', '--s-collect'].forEach(t => P.out.push(U.el('path', { class: 'rib', fill: f.grad(B1, RX, t, t, .55, .3) }, f.bands)));
    function draw() {
      const g = geo();
      g.rows.forEach((r, i) => { P.fo[i].setAttribute('d', FK.ribbonOf(r.fo)); P.fi[i].setAttribute('d', FK.ribbonOf(r.fi)); });
      g.outs.forEach((o, j) => P.out[j].setAttribute('d', FK.ribbonOf(o)));
      ports.forEach(p => p.setAttribute('y', mc - FIN / 2));
    }

    // ---------- column heads, each inside the top of its own box ----------
    const head = (x, y, label, info, cls = 'pf-head') => {
      const g = f.fade(U.el('g', {}, f.labels), x);
      const t = f.text(g, x, y, label, cls);
      if (info) f.info(g, x + t.getComputedTextLength() + 14, y - 4.5, ...info);
      return t;
    };
    const CLIP_Y = TC - 49;

    // ---------- the clip ----------
    const gl = f.fade(U.el('g', {}, f.labels), 0);
    const clipFo = f.html(gl, 0, CLIP_Y, 176, 98, '<div class="fe-clip"><div class="fe-aud"></div><p class="fe-src"></p></div>');
    U.el('rect', { x: S0 - 6, y: TC - FAN / 2, width: 6, height: FAN, rx: 2, style: 'fill:var(--s-select)' }, gl);
    // the clip switcher heads the clip's column; a line hangs the clip card from it. It is html over the svg
    // (not inside it) so its buttons stay in the accessibility tree, scaled with the figure
    const NAV_Y = 40;
    const navEl = document.createElement('div');
    navEl.className = 'cn-d';
    navEl.style.top = (NAV_Y / H * 100) + '%';
    f.fig.appendChild(navEl);
    const nav = FK.clipNav(navEl, f.fig);
    const scaleNav = () => { const k = svg.clientWidth / W; if (k) navEl.style.transform = `scale(${k})`; };
    scaleNav();
    const navLine = U.el('line', { x1: 1, x2: 1, y1: NAV_Y, y2: CLIP_Y + 14, class: 'cn-hang' }, gl);
    gl.prepend(navLine);

    // ---------- expert nodes, grouped by the route that runs them ----------
    // one panel around all experts, under the streams so they run into it
    const panel = f.fade(U.el('g', {}, f.bands), N0);
    f.bands.prepend(panel);
    U.el('rect', { x: N0 - 10, y: 8, width: N1 - N0 + 20, height: H - 20, rx: 14, class: 'cf-panel' }, panel);
    const gn = f.fade(U.el('g', {}, f.nodes), N0);
    const gh = heads.map(({ g, y }) => {
      const el = U.el('g', { class: 'fk-gh' }, gn);
      f.text(el, N0 + 2, y, g.name.toUpperCase(), 'fk-gh-t');
      return { g, el };
    });
    const nodes = ROWS.map((r, i) => {
      const y = rowY[i], g = U.el('g', { class: 'fe-node' }, gn);
      U.el('rect', { x: N0, y: y - PITCH / 2 + 3, width: N1 - N0, height: NODE_H, rx: 9, class: 'fe-node-r' }, g);
      f.icon(r.icon, N0 + 19, y, 12, g);
      const t = f.text(g, N0 + 37, y - 3, r.name, 'fe-name');
      U.el('tspan', { dx: 6, class: 'fe-by', text: r.by }, t);
      const v = f.text(g, N0 + 37, y + 11.5, '', 'fe-val' + (i ? '' : ' audio'));
      g.addEventListener('mouseenter', () => { if (on[i]) setHl({ row: i }); });
      g.addEventListener('mouseleave', () => setHl(null));
      return { g, v };
    });

    // ---------- captioning model ----------
    const gb = f.fade(U.el('g', {}, f.nodes), B0);
    const mid = (B0 + B1) / 2;
    U.el('rect', { x: B0, y: TC - 124, width: B1 - B0, height: 256, rx: 14, class: 'cf-box' }, gb);
    // both captioners, each wrote half of the captions. Not buttons: a static readout, the one that captioned
    // this clip in full with a "captioned this clip" mark, the other dimmed; the streams meet at the first
    U.el('line', { x1: B0 + 18, x2: B1 - 18, y1: (MC[0] + MC[1]) / 2, y2: (MC[0] + MC[1]) / 2, class: 'cf-mod-sep' }, gb);
    const mods = [['Qwen3-Omni', '30B-A3B-Instruct'], ['MOSS-Audio', '8B-Thinking']].map(([a, b], k) => {
      const g = U.el('g', { class: 'cf-mod' }, gb);
      f.text(g, mid, MC[k] - 22, 'CAPTIONED THIS CLIP', 'cf-mod-k', 'middle');
      f.text(g, mid, MC[k] - 1, a, 'cf-box-n', 'middle');
      f.text(g, mid, MC[k] + 16, b, 'cf-box-s2', 'middle');
      return g;
    });
    // where the streams enter and leave the box: marks that slide to the captioner of this clip
    const ports = [B0, B1 - 3].map(x => U.el('rect', { x, y: 0, width: 3, height: FIN, rx: 1.5, class: 'cf-port' }, gb));

    // ---------- the sample: what was kept, and what the captioner wrote ----------
    const recFo = f.html(f.fade(U.el('g', {}, f.labels), RX), RX, 8, W - RX, H - 20, `<div class="pf-cap fe-rec">
      <div class="fe-sec kept"><p class="fe-sub"><i></i><span></span></p><div class="fe-chips"></div></div>
      <div class="fe-sec gen"><p class="fe-sub"><i></i><span></span></p>
        <div class="fe-blk s"><b>Short caption<span></span></b><p></p></div>
        <div class="fe-blk l"><b>Long caption<span></span></b><p></p></div></div></div>`);
    const rec = recFo.firstElementChild.firstElementChild;

    const clipH = head(14, CLIP_Y + 22, 'Audio clip');
    head(14, 30, 'Example clips', null, 'pf-head cn-head');   // cn-head: left out of exports with the switcher
    head(N0, 30, 'Expert models', ['Expert annotations', EXPERT_INFO]);
    head(B0 + 12, TC - 101, 'Captioning model', ['Captioning', CAPTION_INFO], 'pf-head cf-box-h');
    head(RX + 13, 30, 'LAION-Audio-XL sample');
    ['.s', '.l'].forEach((q, j) => {
      const b = rec.querySelector(q);
      b.addEventListener('mouseenter', () => setHl({ out: j }));
      b.addEventListener('mouseleave', () => setHl(null));
    });

    // hover: one expert's path through the figure, or everything that feeds one caption
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
    let first = true, ds = null;
    function show(i) {
      const s = S[i], m = s.meta, swapEls = [clipFo, recFo, ...nodes.map(n => n.v)];
      const apply = () => {
        clipH.textContent = `Audio clip ${i + 1}`;
        FK.capAt = i;
        // link to the source video at the clip's start
        clipFo.querySelector('.fe-src').innerHTML = m.youtube_id
          ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(m.youtube_id)}&t=${Math.floor(m.start_sec || 0)}s" target="_blank" rel="noopener">Source on YouTube ↗</a>` : '';
        FK.player(clipFo.querySelector('.fe-aud'), s.src, 34);
        on = ROWS.map(r => !!r.val(m));
        nodes.forEach((n, k) => { n.v.textContent = ROWS[k].val(m) || ''; n.g.classList.toggle('off', !on[k]); });
        gh.forEach(h => { const go = groupOn(m, h.g); h.el.classList.toggle('off', !go); });
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
        const eT = ['.s p', '.l p'].map(q => { const bx = box(rec.querySelector(q)); return [bx.mid, bx.h]; });
        const k1 = /moss/i.test(FK.model(m)) ? 1 : 0;
        mods.forEach((g, k) => g.classList.toggle('on', k === k1));
        const w0 = w.slice(), o0 = wOut.slice(), e0 = ends.map(e => e.slice()), mc0 = mc;
        tween(first ? 0 : 750, k => {
          mc = lerp(mc0, MC[k1], k); w = w0.map((v, j) => lerp(v, wT[j], k)); wOut = o0.map((v, j) => lerp(v, oT[j], k));
          ends = e0.map((e, j) => [lerp(e[0], eT[j][0], k), lerp(e[1], eT[j][1], k)]);
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

    // the caption blocks only have their final size once fonts are in; re-aim the caption streams then
    function reaim() {
      ends = ['.s p', '.l p'].map(q => { const bx = box(rec.querySelector(q)); return [bx.mid, bx.h]; });
      draw();
    }
    // the switcher steps through the clips; it starts where the other (phone) version was, if any
    const cyc = FK.cycle(svg, (i, how) => { show(i); nav.mark(i, how); }, { hold: 8000, first: FK.capAt || 0, onTick: (k, wait) => nav.tick(k, wait) });
    show(cyc.cur);
    nav.bind(cyc);
    document.fonts.ready.then(() => { if (alive) { reaim(); scaleNav(); } });
    U.onWidth(() => { if (alive) { reaim(); scaleNav(); } });

    ds = FK.dots(f, () => {
      const g = geo(), R = [];
      g.rows.forEach((r, i) => g.outs.forEach((o, j) => R.push({
        w: w[i] * wOut[j], segs: [r.fo, r.fi, o],
        o: !hl ? 1 : (hl.row != null ? hl.row === i : hl.out === j) ? 1 : .12,
      })));
      return R;
    }, { n: 160, speed: 68 });
    FK.intro(f, { from: S0, onReach: x => { ds.setReach(x); ds.start(); } });
    return () => { alive = false; cyc.stop(); ds.stop(); };
  };
})();
