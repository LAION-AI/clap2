/* ================= sound taxonomy: a zoomable bubble chart of groups, categories and classes =================
   Data: assets/data/taxonomy.json (tools/import_taxonomy_tsv.py), demo clips: taxonomyAudio in js/data.js,
   icons: assets/icons/taxonomy/. The treemap version of this figure is archived in archive/taxonomy-treemap/. */
(function taxonomy() {
const row = document.getElementById('taxonomy');
if (!row) return;
const DATA = window.DATA;
/* ================= formatting ================= */
const SHORT = { speech: 'Speech', music: 'Music', sfx: 'Sound effects', human: 'Human', animal: 'Animal', urban: 'Urban', domestic: 'Domestic', industrial: 'Industrial', interface: 'Interface', nature: 'Nature', sports: 'Sports' };
const nf = v => v.toLocaleString('en-US');
const fc = v => U.fmt(v, 2);
const pct = (a, b) => { const p = a / b * 100; return (p >= 1 ? p.toFixed(1) : p >= .1 ? p.toFixed(2) : '<0.1') + '%'; };
const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
function wrap(s, n, max = 2) {
  const lines = [''];
  s.split(' ').forEach(w => {
    const l = lines[lines.length - 1];
    if (l && (l + ' ' + w).length > n) lines.push(w); else lines[lines.length - 1] = l ? l + ' ' + w : w;
  });
  return lines.length > max ? lines.slice(0, max - 1).concat(clip(lines.slice(max - 1).join(' '), n)) : lines;
}
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const SVG_PLAY = 'M-3.2 -5L5.5 0L-3.2 5Z', SVG_PAUSE = 'M-4.5 -5h3.4v10h-3.4zM1.1 -5h3.4v10h-3.4z';

/* ================= the tree: groups → categories → classes, with clips in LAION-Audio-XL ================= */
// assets/data/taxonomy.json comes from tools/import_taxonomy_tsv.py
function buildTree(J) {
  const root = { depth: -1, name: 'All groups', clips: J.clips, kids: [] };
  const audio = DATA.taxonomyAudio || {}, S = Object.fromEntries((DATA.samples || []).map(x => [x.id, x]));
  const base = '';
  // a node's own demo clip; there is no placeholder, nodes without one simply have no play button
  const clipFor = key => {
    const v = audio[key], smp = v && v.sample && S[v.sample], src = v && (v.src || (smp && smp.src));
    return src ? { src: base + src, caption: v.caption || (smp && smp.meta.short_caption) || '', source: v.source || null, license: v.license || '', from: v.from || '' } : null;
  };
  J.groups.forEach((gj, idx) => {
    const meta = DATA.taxonomy.groups.find(x => x.id === gj.id);
    const g = { depth: 0, id: gj.id, idx, name: meta ? meta.name : gj.id, short: SHORT[gj.id], clips: gj.clips, parent: root, tone: `var(--g-${gj.id})`, // absolute, because a url() in a custom property resolves against the stylesheet that uses it
    icon: new URL(`${base}assets/icons/taxonomy/${gj.id}.svg`, document.baseURI).href };
    g.group = g;
    g.kids = gj.cats.map(([name, clips, subs]) => {
      const c = { depth: 1, name, clips, parent: g, group: g, tone: g.tone };
      c.kids = (subs || []).map(([sn, sc]) => ({ depth: 2, name: sn, clips: sc, classes: 1, parent: c, group: g, tone: g.tone, kids: [], clip: clipFor(`${g.id}/${name}/${sn}`) }));
      c.classes = c.kids.length || 1;
      // a category without a clip of its own borrows one from its classes
      c.clip = clipFor(`${g.id}/${name}`) || (c.kids.find(k => k.clip) || {}).clip || null;
      // clips labelled only at the category level, without a finer class
      const self = c.kids.length ? clips - c.kids.reduce((s, k) => s + k.clips, 0) : 0;
      if (self > 0) c.extra = [{ depth: 2, self: true, ghost: true, name: 'Not further classified', clips: self, classes: 0, parent: c, group: g, tone: g.tone, kids: [] }];
      return c;
    });
    g.classes = g.kids.reduce((s, c) => s + c.classes, 0);
    // the demo clip the overview offers for the group: its largest category that has a clip of its own
    g.top = g.kids.find(c => c.clip) || null;
    root.kids.push(g);
  });
  root.classes = root.kids.reduce((s, g) => s + g.classes, 0);
  return root;
}
// a group's icon: an SVG file used as a mask, so it takes the colour of --c
const icon = (g, size = 16, cls = '') => `<i class="gi ${cls}" style="--icon:url('${g.icon}');--s:${size}px" aria-hidden="true"></i>`;
const val = (n, key) => (key === 'k' ? n.classes : n.clips);
const fmtVal = (n, key) => (key === 'k' ? `${nf(n.classes)} ${n.classes === 1 ? 'class' : 'classes'}` : `${fc(n.clips)} clips`);
const path = n => { const p = []; for (let x = n; x && x.depth >= 0; x = x.parent) p.unshift(x); return p; };
const playable = n => (n.depth === 0 ? n.top : n.clip ? n : null);

/* ================= shared pieces ================= */
const player = (() => {
  const au = new Audio();
  au.preload = 'none';
  U.solo(au);
  let cur = null, raf = 0;
  const subs = new Set();
  const emit = () => subs.forEach(f => f(cur, !au.paused, au.duration ? au.currentTime / au.duration : 0));
  const tick = () => { emit(); raf = !au.paused ? requestAnimationFrame(tick) : 0; };
  au.addEventListener('play', () => { if (!raf) tick(); });
  au.addEventListener('pause', emit);
  au.addEventListener('ended', () => { cur = null; emit(); });
  return {
    toggle(c) {
      if (!c || !c.clip) return;
      if (cur === c && !au.paused) { au.pause(); return; }
      if (cur !== c) { cur = c; au.src = c.clip.src; }
      au.play().catch(() => { cur = null; emit(); });
      emit();
    },
    on(f) { subs.add(f); },
  };
})();
function makeTip(host) {
  const t = document.createElement('div');
  t.className = 'tip';
  host.appendChild(t);
  return {
    show(html, e) {
      const r = host.getBoundingClientRect();
      t.innerHTML = html;
      const half = t.offsetWidth / 2 + 4;
      t.style.left = U.clamp(e.clientX - r.left, half, r.width - half) + 'px';
      t.style.top = (e.clientY - r.top) + 'px';
      t.style.opacity = 1;
    },
    hide() { t.style.opacity = 0; },
  };
}
function tipFor(n) {
  if (n.agg) return `<b>${nf(n.n)} smaller ${n.parent.depth === 0 ? 'categories' : 'classes'}</b><br>${fc(n.clips)} clips together<br><span>All are listed beside the figure</span>`;
  if (n.self) return `<b>${n.parent.name}</b>, no finer class<br>${fc(n.clips)} clips · ${pct(n.clips, n.parent.clips)} of the category`;
  const of = n.depth === 0 ? `${pct(n.clips, n.parent.clips)} of LAION-Audio-XL` : `${pct(n.clips, n.parent.clips)} of ${n.parent.short || n.parent.name}`;
  const what = n.depth === 0 ? `${nf(n.classes)} classes in ${nf(n.kids.length)} categories` : n.kids.length ? `${nf(n.kids.length)} finer classes` : '';
  const hint = n.depth === 0 ? 'Click to explore' : n.kids.length ? (n.clip ? 'Click to open · ▶ plays a demo clip' : 'Click to open') : n.clip ? 'Click to play a demo clip' : '';
  return `<b>${n.name}</b><br>${fc(n.clips)} clips · ${of}${what ? `<br>${what}` : ''}${hint ? `<br><span>${hint}</span>` : ''}`;
}
function tween(d, frame, done) {
  const t0 = performance.now(), dur = U.reduced ? 0 : d;
  let stop = false;
  (function step(now) {
    if (stop) return;
    const t = dur ? U.clamp((now - t0) / dur, 0, 1) : 1;
    frame(U.ease.inOut(t));
    if (t < 1) requestAnimationFrame(step); else if (done) done();
  })(t0);
  return () => { stop = true; };
}
// circle packing: the largest stays in the middle, the rest are pulled in around it; items have .pr, get .lx/.ly
function packAround(items, gap, kx = .05, ky = .05, iters = 400) {
  // the "+N smaller" bubble never takes the middle
  const s = items.slice().sort((a, b) => (!!a.agg - !!b.agg) || (b.pr - a.pr));
  s.forEach((n, i) => { const a = i * 2.39996, d = i ? s[0].pr + gap + Math.sqrt(i) * n.pr * 1.6 : 0; n.lx = Math.cos(a) * d; n.ly = Math.sin(a) * d; });
  const push = () => {
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const a = s[i], b = s[j], dx = b.lx - a.lx, dy = b.ly - a.ly, d = Math.hypot(dx, dy) || .01, min = a.pr + b.pr + gap;
      if (d >= min) continue;
      const o = (min - d) / d;
      if (i === 0) { b.lx += dx * o; b.ly += dy * o; } else { a.lx -= dx * o / 2; a.ly -= dy * o / 2; b.lx += dx * o / 2; b.ly += dy * o / 2; }
    }
  };
  for (let it = 0; it < iters; it++) { s.forEach((n, i) => { if (i) { n.lx *= 1 - kx; n.ly *= 1 - ky; } }); push(); push(); }
  for (let it = 0; it < 200; it++) push();
  return s;
}
// smallest enclosing circle, approximately (Badoiu–Clarkson); centres the items on it and returns its radius
function enclose(ns) {
  let cx = 0, cy = 0;
  for (let it = 0; it < 300; it++) {
    let far = null, fd = -1;
    ns.forEach(n => { const d = Math.hypot(n.lx - cx, n.ly - cy) + n.pr; if (d > fd) { fd = d; far = n; } });
    const dx = far.lx - cx, dy = far.ly - cy, dl = Math.hypot(dx, dy) || 1;
    cx += (far.lx + dx / dl * far.pr - cx) / (it + 2); cy += (far.ly + dy / dl * far.pr - cy) / (it + 2);
  }
  ns.forEach(n => { n.lx -= cx; n.ly -= cy; });
  return Math.max(...ns.map(n => Math.hypot(n.lx, n.ly) + n.pr));
}

/* ================= explorer: toolbar, level list and player around a figure ================= */
const MAXN = 24;  // items drawn per level; the rest share one "+N smaller" tile and stay in the list
function explorer(row, ROOT, makeFigure) {
  // numbers in the side text come from the data
  const nCats = ROOT.kids.reduce((s, g) => s + g.kids.length, 0);
  const fill = { classes: nf(ROOT.classes), cats: nf(nCats), speech: DATA.taxonomy.mix.final.speech.toFixed(1) + '%' };
  row.querySelectorAll('[data-tax]').forEach(el => { el.textContent = fill[el.dataset.tax]; });
  const nAll = ROOT.kids.reduce((s, g) => s + 1 + g.kids.length + g.kids.reduce((t, c) => t + c.kids.length, 0), 0);
  // the side column (title, text, details) is written in index.html; the list goes below it
  row.querySelector('.side').insertAdjacentHTML('beforeend', `
      <div class="xl-head"><b></b><span></span></div>
      <ul class="xl"></ul>`);
  row.insertAdjacentHTML('beforeend', `
    <div class="fig xp">
      <div class="xbar">
        <nav class="xcrumb" aria-label="Level"></nav>
        <div class="xsearch">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
          <input type="search" placeholder="Search ${nf(nAll)} sounds" aria-label="Search the taxonomy" autocomplete="off" role="combobox" aria-expanded="false">
          <ul class="xsug" role="listbox" hidden></ul>
        </div>
        <div class="toggle xmeasure" role="group" aria-label="Size by">
          <button class="on" data-k="c">Clips</button><button data-k="k">Classes</button>
        </div>
      </div>
      <div class="xcanvas"></div>
      <div class="np" hidden><button type="button" class="np-b" aria-label="Pause"></button><div class="np-t"><b></b><span></span></div><i></i></div>
    </div>`);
  const $ = s => row.querySelector(s);
  const listHead = $('.xl-head'), list = $('.xl'), crumb = $('.xcrumb'), canvas = $('.xcanvas');
  const input = $('.xsearch input'), sug = $('.xsug'), measure = $('.xmeasure'), np = $('.np');
  const st = { cur: ROOT, key: 'c' };
  const tip = makeTip(canvas);
  const rows = new Map();
  const keyOf = () => (st.cur.depth >= 1 ? 'c' : st.key);
  // every item of a level, largest first; the list also gives a category's clips without a finer class, last
  const sorted = (n, key) => n.kids.slice().sort((a, b) => val(b, key) - val(a, key));
  const levelItems = (n, key) => sorted(n, key).concat(n.extra || []);
  // the figure draws the named items only
  function figItems(n, key) {
    const all = sorted(n, key);
    if (n.depth < 0 || all.length <= MAXN) return all;
    const rest = all.slice(MAXN - 1);
    n.aggNode = n.aggNode || { agg: true, ghost: true, depth: n.depth + 1, parent: n, group: n.group, tone: n.tone, kids: [] };
    Object.assign(n.aggNode, { n: rest.length, rest, clips: rest.reduce((s, x) => s + x.clips, 0), classes: rest.reduce((s, x) => s + x.classes, 0) });
    n.aggNode.name = `+ ${nf(rest.length)} smaller ${n.depth === 0 ? 'categories' : 'classes'}`;
    return all.slice(0, MAXN - 1).concat(n.aggNode);
  }
  const api = {
    activate, play: n => player.toggle(playable(n)), up,
    // what a node would show if opened: the figure previews it
    items: n => figItems(n, n.depth >= 1 ? 'c' : st.key), itemsKey: n => (n.depth >= 1 ? 'c' : st.key),
    hover: x => hover(x), tip: (n, e) => tip.show(tipFor(n), e), untip: () => tip.hide(),
  };
  let fig = makeFigure(canvas, api);

  // a click on an item: groups and categories with classes open, other categories play, the "+N" tile points to the list
  function activate(n) {
    if (n.agg) { const li = rows.get(n.rest[0]); if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); flashRow(n.rest[0]); } return; }
    if (n.self) return;
    if (n.kids.length) go(n); else if (n.clip) player.toggle(n);
  }
  function hover(x) {
    fig.hover(x);
    rows.forEach((li, item) => li.classList.toggle('is-hl', item === x || (!!x && !!x.agg && x.rest.includes(item))));
  }
  function flashRow(n) { const li = rows.get(n); if (!li) return; li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); }
  function renderList() {
    list.innerHTML = ''; rows.clear();
    const n = st.cur, key = keyOf();
    listHead.children[0].textContent = n.depth < 0 ? 'All Groups' : n.name;
    listHead.children[1].textContent = key === 'k' ? 'classes' : 'clips';
    levelItems(n, key).forEach(x => {
      const li = document.createElement('li');
      li.style.setProperty('--c', x.tone);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'row-b';
      b.innerHTML = `${x.depth === 0 ? icon(x, 14) : `<i${x.ghost ? ' class="ghost"' : ''}></i>`}<span class="n"></span><span class="v">${key === 'k' ? nf(x.classes) : fc(x.clips)}</span>${x.kids.length ? CHEV.replace('<svg', '<svg class="chev"') : '<span></span>'}`;
      b.querySelector('.n').textContent = x.name;
      b.setAttribute('aria-label', x.kids.length ? `Open ${x.name}` : x.clip ? `Play a demo clip: ${x.name}` : x.name);
      if (x.self) { b.disabled = true; b.style.cursor = 'default'; }
      b.addEventListener('click', () => activate(x));
      li.appendChild(b);
      if (x.clip || x.depth === 0) {
        const p = document.createElement('button');
        p.type = 'button'; p.className = 'row-p'; p.innerHTML = PLAY;
        p.setAttribute('aria-label', `Play a demo clip: ${playable(x).name}`); p.addEventListener('click', () => api.play(x));
        li.appendChild(p);
      }
      li.addEventListener('pointerenter', () => hover(x));
      li.addEventListener('pointerleave', () => hover(null));
      li.addEventListener('focusin', () => hover(x));
      li.addEventListener('focusout', () => hover(null));
      list.appendChild(li); rows.set(x, li);
    });
    list.scrollTop = 0;
  }
  // until the reader opens a group, the bar says the bubbles can be opened
  let explored = false;
  const HINT = (matchMedia('(hover: none)').matches ? 'Tap' : 'Click') + ' a bubble to open it';
  function renderBar() {
    const n = st.cur;
    crumb.innerHTML = '';
    if (n.depth < 0) crumb.innerHTML = `<b>All 11 groups</b><span>· ${U.fmt(ROOT.clips, 3)} clips</span>` + (explored ? '' : `<span class="xhint">${HINT}</span>`);
    else {
      [ROOT].concat(path(n).slice(0, -1)).forEach((a, i) => {
        const b = document.createElement('button');
        if (i === 0) b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>All groups';
        else { b.textContent = a.short || clip(a.name, 22); if (a.depth === 0) { b.style.setProperty('--c', a.tone); b.insertAdjacentHTML('afterbegin', icon(a, 14)); } }
        b.addEventListener('click', () => go(a));
        crumb.appendChild(b);
      });
      const t = document.createElement('b'); t.textContent = n.name; crumb.appendChild(t);
      if (n.depth === 0) { t.style.setProperty('--c', n.tone); t.style.display = 'inline-flex'; t.style.alignItems = 'center'; t.style.gap = '6px'; t.insertAdjacentHTML('afterbegin', icon(n, 16)); }
    }
    measure.classList.toggle('off', n.depth >= 1);
  }
  function refresh() { renderList(); renderBar(); syncPlay(); }
  function go(n, then) {
    if (n === st.cur) { if (then) then(); return; }
    const from = st.cur;
    const how = n.parent === from ? 'down' : from.parent === n ? 'up' : 'side';
    st.cur = n; tip.hide();
    if (n.depth >= 0) explored = true;
    const hadFocus = row.contains(document.activeElement) && document.activeElement !== input;
    refresh();
    fig.render({ cur: n, key: keyOf(), items: figItems(n, keyOf()), how, from });
    // the focused row, crumb or bubble was just rebuilt: keep keyboard and screen-reader users at the new level
    if (hadFocus && !row.contains(document.activeElement)) {
      const visible = el => el && el.getClientRects().length;
      const t = [list.querySelector('.row-b:not([disabled])'), canvas.querySelector('[tabindex="0"]'), crumb.querySelector('button')].find(visible);
      if (t) t.focus({ preventScroll: true });
    }
    if (then) setTimeout(then, U.reduced ? 0 : 800);
  }
  function up() { if (st.cur.depth >= 0) go(st.cur.parent); }
  measure.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    measure.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    st.key = b.dataset.k;
    refresh();
    fig.render({ cur: st.cur, key: keyOf(), items: figItems(st.cur, keyOf()), how: 'measure' });
  }));
  // keys: Esc goes up a level, ← → move to the neighbour
  row.addEventListener('keydown', e => {
    if (e.target === input) return;
    if (e.key === 'Escape') up();
    if (st.cur.depth >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const sibs = st.cur.parent.kids, i = sibs.indexOf(st.cur);
      go(sibs[(i + (e.key === 'ArrowRight' ? 1 : sibs.length - 1)) % sibs.length]);
    }
  });

  /* search across groups, categories and classes; choosing one goes to its level and points at it */
  const ALL = [];
  ROOT.kids.forEach(g => { ALL.push(g); g.kids.forEach(c => { ALL.push(c); c.kids.forEach(k => ALL.push(k)); }); });
  ALL.forEach(n => { n.lc = n.name.toLowerCase(); });
  let hits = [], at = -1;
  function suggest() {
    const q = input.value.trim().toLowerCase();
    // names that start with the query first, then higher levels, then larger ones
    hits = q ? ALL.filter(n => n.lc.includes(q)).sort((a, b) => (b.lc.startsWith(q) - a.lc.startsWith(q)) || (a.depth - b.depth) || (b.clips - a.clips)).slice(0, 8) : [];
    at = hits.length ? 0 : -1;
    sug.innerHTML = '';
    if (q && !hits.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = `No sound named \u201c${input.value.trim()}\u201d. Try a shorter or more general word, like \u201cbird\u201d.`; sug.appendChild(li); }
    hits.forEach(n => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.style.setProperty('--c', n.tone);
      li.innerHTML = `${icon(n.group, 14)}<span></span><em></em>`;
      li.children[1].textContent = n.name;
      li.children[2].textContent = (n.depth === 0 ? 'Group' : path(n).slice(0, -1).map(a => a.short || a.name).join(' › ')) + ` · ${fc(n.clips)} clips`;
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(n); });
      sug.appendChild(li);
    });
    mark();
    sug.hidden = !q;
    input.setAttribute('aria-expanded', !sug.hidden);
  }
  function mark() { [...sug.children].forEach((li, i) => li.classList.toggle('on', i === at)); }
  function choose(n) {
    input.value = ''; sug.hidden = true; input.blur();
    if (n.depth === 0) { go(n); return; }
    go(n.parent, () => { fig.flash(n); flashRow(n); const li = rows.get(n); if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }
  input.addEventListener('input', suggest);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { at = (at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; mark(); } }
    else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); choose(hits[at]); }
    else if (e.key === 'Escape') { input.value = ''; sug.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 120));

  /* now playing; the list and the figure follow the player */
  const [npB, npT, npBar] = np.children;
  npB.addEventListener('click', () => player.toggle(npShown));
  let npShown = null, playState = [null, false, 0];
  function syncPlay() {
    const [c, playing] = playState;
    rows.forEach((li, x) => {
      const on = !!c && playable(x) === c && playing;
      li.classList.toggle('playing', on);
      const p = li.querySelector('.row-p');
      if (p) p.innerHTML = on ? PAUSE : PLAY;
    });
  }
  player.on((c, playing, p) => {
    playState = [c, playing, p];
    syncPlay();
    fig.playing(c, playing, p);
    np.hidden = !c;
    if (!c) { npShown = null; return; }
    if (c !== npShown) {
      npShown = c;
      np.style.setProperty('--c', c.tone);
      npT.children[0].innerHTML = `${icon(c.group, 14)}<span></span>`;
      npT.children[0].lastChild.textContent = `${c.name} · ${c.group.short}`;
      // where the clip comes from and its licence (CC BY clips need the attribution)
      const cap = npT.children[1], k = c.clip;
      cap.textContent = '';
      const credit = [k.from, k.license].filter(Boolean).join(' · ');
      if (credit || k.source) {
        const el = document.createElement(k.source ? 'a' : 'span');
        el.className = 'np-src'; el.textContent = (credit || 'source') + (k.source ? ' ↗' : '');
        if (k.source) { el.href = k.source; el.target = '_blank'; el.rel = 'noopener'; }
        cap.append(el);
      }
    }
    npB.innerHTML = playing ? PAUSE : PLAY;
    npB.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    npBar.style.width = (p * 100).toFixed(2) + '%';
  });

  refresh();
  fig.render({ cur: ROOT, key: 'c', items: figItems(ROOT, 'c'), how: 'init' });

  // the bubbles are drawn at the width they are shown at (see bubbles()): a rotated tablet or a resized window redraws
  // them at the new size, at the level the reader is on
  const drawnWidth = () => { const cw = canvas.clientWidth || 820; return cw >= 700 ? 820 : Math.max(320, Math.round(cw)); };
  let drawnAt = drawnWidth();
  const forget = n => { ['_el', '_op', '_pi', '_pv', '_rf', '_ring', '_rv', '_x', '_y'].forEach(k => delete n[k]); (n.kids || []).forEach(forget); if (n.aggNode) forget(n.aggNode); };
  U.onWidth(() => {
    const w = drawnWidth();
    if (w === drawnAt) return;
    drawnAt = w;
    tip.hide();
    canvas.querySelectorAll('svg.bd').forEach(s => s.remove());
    forget(ROOT);
    fig = makeFigure(canvas, api);
    fig.render({ cur: st.cur, key: keyOf(), items: figItems(st.cur, keyOf()), how: 'init' });
    refresh();
  });
}
/* ================= D: bubbles ================= */
function bubbles(canvas, api) {
  // drawn at the size it is shown, so text keeps its size on narrow screens (a wide frame on desktop, nearly square on phones)
  const cw = canvas.clientWidth || 820;
  const W = cw >= 700 ? 820 : Math.max(320, Math.round(cw)), H = cw >= 700 ? 520 : Math.round(W * 1.05);
  const C = { x: W / 2, y: H / 2 }, RF = Math.min(W, H) / 2 - 10;
  const svg = U.el('svg', { class: 'bd', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Bubble chart of the sound taxonomy: groups, their categories and their classes, sized by clips in LAION-Audio-XL.' }, canvas);
  // the neighbours of an opened node peek in at the frame edge; a soft mask fades them out towards the border so
  // the edge of the frame never shows as a hard line
  const uid = Math.random().toString(36).slice(2, 8), defsP = U.el('defs', {}, svg);
  const fl = U.el('filter', { id: `bdb-${uid}`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defsP);
  U.el('feGaussianBlur', { stdDeviation: 10 }, fl);
  const mk = U.el('mask', { id: `bdm-${uid}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defsP);
  U.el('rect', { x: 20, y: 20, width: W - 40, height: H - 40, fill: '#fff', filter: `url(#bdb-${uid})` }, mk);
  const backL = U.el('g', {}, svg), peekL = U.el('g', { class: 'bd-peeks', mask: `url(#bdm-${uid})` }, svg), nodeL = U.el('g', {}, svg);
  const back = U.el('circle', { class: 'bd-back', cx: C.x, cy: C.y, r: 0 }, backL);
  svg.addEventListener('click', e => { if (e.target === svg || e.target === back) api.up(); });
  const els = new Map();
  let shown = [], stop = () => {}, backState = { x: C.x, y: C.y, r: 0 };
  // keep a disc inside the frame (drifting neighbours stop at the edge instead of being cut by it)
  const inX = (x, r) => (r * 2 >= W ? W / 2 : U.clamp(x, r + 1, W - r - 1)), inY = (y, r) => (r * 2 >= H ? H / 2 : U.clamp(y, r + 1, H - r - 1));
  const setBack = (x, y, r) => { backState = { x, y, r }; back.setAttribute('cx', x.toFixed(1)); back.setAttribute('cy', y.toFixed(1)); back.setAttribute('r', Math.max(0, r).toFixed(1)); };

  // layouts: the overview fills the frame with the group discs; deeper levels pack inside the backdrop circle
  function layout(o) {
    const items = o.items, key = o.key, L = new Map();
    if (o.cur.depth < 0) {
      items.forEach(n => { n.r0 = Math.sqrt(val(n, key)); });
      const mr = Math.max(...items.map(n => n.r0));
      // packed twice: the first pass gives the scale, the second keeps room for the names under the smaller discs
      let s = 0, minx, maxx, miny, maxy;
      for (let pass = 0; pass < 2; pass++) {
        items.forEach(n => { n.pr = n.r0 + (n.r0 < mr * .22 ? mr * .1 : 0) + (s && n.r0 * s < 62 ? 13 / s : 0); });
        packAround(items, mr * .04, .012, .03, 700);
        minx = Math.min(...items.map(n => n.lx - n.pr)); maxx = Math.max(...items.map(n => n.lx + n.pr));
        miny = Math.min(...items.map(n => n.ly - n.pr)); maxy = Math.max(...items.map(n => n.ly + n.pr));
        s = Math.min((W - 16) / (maxx - minx), (H - 16) / (maxy - miny));
      }
      items.forEach(n => L.set(n, { x: C.x + (n.lx - (minx + maxx) / 2) * s, y: C.y + (n.ly - (miny + maxy) / 2) * s, r: n.r0 * s }));
      return L;
    }
    const max = Math.max(...items.map(n => val(n, key)));
    items.forEach(n => { n.pr = Math.max(.06, Math.sqrt(val(n, key) / max)); });
    packAround(items, .025, .05, .05, 400);
    const R = enclose(items), s = (RF - 14) / R;
    items.forEach(n => L.set(n, { x: C.x + n.lx * s, y: C.y + n.ly * s, r: n.pr * s }));
    return L;
  }
  // the level below a node, laid out exactly as it will be when the node is opened (same packing, same scale
  // relative to the backdrop), so opening it turns these faint circles into the real bubbles
  function preview(n, r, g) {
    const key = api.itemsKey(n);
    if (!n._pv || n._pv.key !== key) {
      const items = api.items(n), max = Math.max(...items.map(x => val(x, key))) || 1;
      items.forEach(x => { x.pr = Math.max(.06, Math.sqrt(val(x, key) / max)); });
      packAround(items, .025, .05, .05, 400);
      const R = enclose(items);
      n._pv = { key, list: items.map(x => ({ x: x.lx / R, y: x.ly / R, r: x.pr / R, agg: !!x.agg })) };
    }
    const s = r * (RF - 14) / (RF + 2);
    n._pv.list.forEach(c => { if (c.r * s >= .8) U.el('circle', { class: 'pv' + (c.agg ? ' agg' : ''), cx: (c.x * s).toFixed(1), cy: (c.y * s).toFixed(1), r: (c.r * s).toFixed(1) }, g); });
  }
  // one element per node, rebuilt for the radius it is drawn at
  function build(n, r, key, rank, count, atRoot) {
    if (n._el) n._el.remove();
    const g = U.el('g', { class: 'bd-n' + (atRoot ? ' grp' : '') + (n.ghost ? ' ghost' : '') + (n.agg ? ' agg' : ''), tabindex: n.self ? -1 : 0, role: 'button', 'aria-label': n.kids.length ? `${n.name}. Open` : n.clip ? `${n.name}. Play a demo clip` : n.name, style: `--c:${n.tone};--m:${Math.round(60 - 34 * rank / Math.max(1, count - 1))}%` }, nodeL);
    U.el('circle', { class: 'disc', r: r.toFixed(1) }, g);
    // previews only where there is room: small group discs keep just their icon, share and play button
    if (n.kids.length && !n.agg && r >= (atRoot ? 62 : 14)) preview(n, r, g);
    n._ring = U.el('circle', { class: 'bd-ring', r: (r + 4.5).toFixed(1), pathLength: 100, 'stroke-dasharray': '0 100' }, g);
    n._pi = null;
    const T = (cls, y, fs, text, x = 0) => U.el('text', { class: cls, x, y: y.toFixed(1), 'text-anchor': 'middle', 'font-size': fs.toFixed(1), text }, g);
    const playBtn = (tr, size) => {
      const off = !n.clip && n.depth > 0;
      const pb = U.el('g', { class: 'bd-pb' + (off ? ' off' : ''), transform: tr }, g);
      U.el('circle', { r: size }, pb);
      n._pi = U.el('path', { d: SVG_PLAY }, pb);
      if (!off) pb.addEventListener('click', e => { e.stopPropagation(); api.play(n); });
      return pb;
    };
    if (atRoot) {
      // group disc: name, share or classes, and the play button for its largest category
      const big = r >= 62, mid = r >= 34, value = key === 'k' ? nf(n.classes) : pct(n.clips, n.parent.clips), unit = key === 'k' ? 'classes' : `${fc(n.clips)} clips`;
      // the group's icon sits above its name (an HTML mask inside the SVG, so it takes the group colour)
      const ico = (size, y, x = 0) => { const fo = U.el('foreignObject', { x: (x - size / 2).toFixed(1), y: (y - size / 2).toFixed(1), width: size, height: size, class: 'bd-ico' }, g); fo.innerHTML = icon(n, size); };
      if (big) {
        const fs = U.clamp(r / 6.5, 13, 17), isz = U.clamp(r / 4.2, 20, 32);
        ico(isz, -r * .22 - fs - isz / 2 + 2);
        T('t', -r * .22, fs, n.name.length * fs * .56 > r * 1.6 ? n.short : n.name);
        T('t', r * .1, U.clamp(r / 3.8, 20, 34), value);
        T('u', r * .1 + 16, 11.5, unit);
      } else if (mid) {
        // no room for the name: the icon stands in for it, with the share under it
        const isz = U.clamp(r * .45, 15, 24), iy = -r * .42;
        ico(isz, iy);
        T('u', iy + isz / 2 + 11, 11, value);
      } else if (r >= 14) ico(U.clamp(r * .55, 10, 16), -r * .36);
      else ico(U.clamp(r * .9, 8, 14), 0);
      // smaller discs carry their name underneath
      if (!big) T('lb', r + 14, 11.5, n.short);
      // the tiniest discs keep just the icon; the play button is in the list beside the figure
      if (big || mid || r >= 14) {
        const py = big ? r * .1 + 40 : mid ? r * .48 : r * .34, psz = big ? 13 : mid ? 11 : U.clamp(r * .3, 7, 10);
        const pb = playBtn(`translate(0 ${py.toFixed(1)})${big || mid ? '' : ` scale(${(psz / 11).toFixed(2)})`}`, big || mid ? psz : 11);
        pb.setAttribute('role', 'button'); pb.setAttribute('tabindex', 0); pb.setAttribute('aria-label', `Play a demo clip: ${n.top.name}`);
        pb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); api.play(n); } });
      }
    } else if (r >= 34) {
      // name, value, and a play icon for categories with a clip
      const fs = U.clamp(r / 4.2, 12, 16), per = Math.floor(r * 1.35 / (fs * .55)), lh = fs * 1.18, vs = Math.max(11, fs * .86);
      const icon = n.clip ? 26 : 0, room = r * 1.7;
      // fit the content to the bubble: fewer name lines first, then no value line
      let lines = wrap(n.name, per, r >= 55 ? 3 : 2), withV = true;
      const height = () => lines.length * lh + (withV ? vs + 2 : 0) + icon;
      while (height() > room && lines.length > 1) lines = wrap(n.name, per, lines.length - 1);
      if (height() > room) withV = false;
      const y0 = -height() / 2 + fs * .85;
      lines.forEach((l, i) => T('t', y0 + i * lh, fs, l));
      if (withV) T('v', y0 + lines.length * lh + 2, vs, n.agg ? `${fc(n.clips)} clips` : fmtVal(n, key));
      if (icon) playBtn(`translate(0 ${(y0 + lines.length * lh + (withV ? vs + 2 : 0) + 12).toFixed(1)})`, 11);
    } else if (r >= 10 && n.clip) playBtn(`scale(${U.clamp(r / 16, .6, 1).toFixed(2)})`, 11);
    g.addEventListener('click', e => { e.stopPropagation(); api.activate(n); });
    g.addEventListener('keydown', e => { if (e.target === g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); api.activate(n); } });
    g.addEventListener('pointermove', e => api.tip(n, e));
    g.addEventListener('pointerenter', () => api.hover(n));
    g.addEventListener('pointerleave', () => { api.untip(); api.hover(null); });
    n._el = g; n._rf = r;
    els.set(n, g);
  }
  // draw a node at a position and visible radius (its content scales with it) and opacity
  const set = (n, x, y, r, op) => {
    n._x = x; n._y = y; n._rv = r; n._op = op;
    n._el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${Math.max(.001, r / n._rf).toFixed(4)})`);
    n._el.style.opacity = op;
    n._el.style.display = op < .01 ? 'none' : '';
  };
  // each neighbour of the opened node shows as the edge of a circle, on the side where it lies one level up
  let peekT = 0;
  function peeks(o) {
    clearTimeout(peekT);
    peekL.style.opacity = 0;
    const cur = o.cur;
    if (cur.depth < 0) { peekT = setTimeout(() => { peekL.innerHTML = ''; }, 250); return; }
    const build = () => {
      peekL.innerHTML = '';
      const par = cur.parent, all = api.items(par), sibs = all.filter(x => !x.agg && x !== cur).slice(0, 8);
      if (!sibs.length) return;
      const L2 = layout({ cur: par, items: all, key: api.itemsKey(par) }), pc = L2.get(cur) || C;
      const max = Math.max(...sibs.map(x => x.clips)), DEPTH = 52, P = 2 * (W + H);
      // a position along the frame edge (0..P, clockwise from the top left), and back to a point and its outward normal
      const toP = (x, y) => (y <= 0.5 ? x : x >= W - .5 ? W + y : y >= H - .5 ? W + H + (W - x) : 2 * W + H + (H - y));
      const fromP = q => { q = ((q % P) + P) % P;
        if (q < W) return [q, 0, 0, -1]; if (q < W + H) return [W, q - W, 1, 0];
        if (q < 2 * W + H) return [W - (q - W - H), H, 0, 1]; return [0, H - (q - 2 * W - H), -1, 0]; };
      const ps = sibs.map(sb => {
        const p = L2.get(sb) || C;
        let dx = p.x - pc.x, dy = p.y - pc.y;
        const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        // where the ray from the centre in its direction leaves the frame
        const tx = dx > 0 ? (W - C.x) / dx : dx < 0 ? -C.x / dx : Infinity, ty = dy > 0 ? (H - C.y) / dy : dy < 0 ? -C.y / dy : Infinity, t = Math.min(tx, ty);
        return { sb, q: toP(U.clamp(C.x + dx * t, 0, W), U.clamp(C.y + dy * t, 0, H)), r: 40 + 40 * Math.sqrt(sb.clips / max) };
      }).sort((a, b) => a.q - b.q);
      // spread them along the edge so no two overlap, staying close to their true side
      for (let it = 0; it < 80; it++) for (let i = 0; i < ps.length; i++) {
        const a = ps[i], b = ps[(i + 1) % ps.length], gap = ((b.q - a.q) % P + P) % P, need = (a.r + b.r) * .95;
        if (ps.length > 1 && gap < need) { const d = (need - gap) / 2; a.q -= d; b.q += d; }
      }
      ps.forEach(({ sb, q, r }) => {
        const [bx, by, nx, ny] = fromP(q);
        const g = U.el('g', { class: 'bd-peek', role: 'button', tabindex: 0, style: `--c:${sb.tone}`, 'aria-label': sb.kids.length ? `Open ${sb.name}` : `Play a demo clip: ${sb.name}` }, peekL);
        U.el('circle', { cx: (bx + nx * (r - DEPTH)).toFixed(1), cy: (by + ny * (r - DEPTH)).toFixed(1), r: r.toFixed(1) }, g);
        // a hint of what it is, in the part that shows: the group icon or the start of the category name
        const lx = bx - nx * 32, ly = by - ny * 32;
        if (sb.depth === 0) { const fo = U.el('foreignObject', { x: (lx - 9).toFixed(1), y: (ly - 9).toFixed(1), width: 18, height: 18, class: 'bd-ico' }, g); fo.innerHTML = icon(sb, 18); }
        else U.el('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 11, text: clip(sb.name, nx ? 11 : 18) }, g);
        g.addEventListener('click', e => { e.stopPropagation(); api.activate(sb); });
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.activate(sb); } });
        g.addEventListener('pointermove', e => api.tip(sb, e));
        g.addEventListener('pointerleave', () => api.untip());
      });
    };
    // they come in once the zoom has settled
    const delay = U.reduced ? 0 : o.how === 'side' || o.how === 'measure' ? 300 : 650;
    peekT = setTimeout(() => { build(); requestAnimationFrame(() => { peekL.style.opacity = 1; }); }, delay);
  }
  const drop = list => list.forEach(n => { if (n._el && !shown.includes(n)) { n._el.remove(); els.delete(n); n._el = null; } });

  function render(o) {
    stop();
    const L = layout(o), atRoot = o.cur.depth < 0;
    const leaving = shown.filter(n => !o.items.includes(n) && n._el).map(n => [n, { x: n._x, y: n._y, r: n._rv }]);
    const fresh = o.items.map((n, i) => { const was = n._el && n._op > .01 ? { x: n._x, y: n._y, r: n._rv } : null; build(n, L.get(n).r, o.key, i, o.items.length, atRoot); return [n, was]; });
    // the outgoing node must keep its element through the camera move
    if (o.how === 'down' && o.cur._el && !leaving.some(([n]) => n === o.cur)) leaving.push([o.cur, { x: o.cur._x, y: o.cur._y, r: o.cur._rv }]);
    shown = o.items;
    if (o.cur.depth >= 0) back.style.setProperty('--c', o.cur.group.tone);
    peeks(o);
    if (o.how === 'init') { fresh.forEach(([n]) => { const l = L.get(n); set(n, l.x, l.y, l.r, 1); }); setBack(C.x, C.y, 0); return; }
    if (o.how === 'measure') {
      stop = tween(700, e => fresh.forEach(([n, was]) => { const l = L.get(n), w = was || l; set(n, U.lerp(w.x, l.x, e), U.lerp(w.y, l.y, e), U.lerp(w.r, l.r, e), was ? 1 : e); }));
      return;
    }
    // the camera: going down, the opened node grows into the backdrop; going up, the backdrop shrinks back into it
    let src = null;
    const X = o.how === 'down' ? o.cur : o.how === 'up' ? o.from : null;
    if (o.how === 'down') { const w = leaving.find(([n]) => n === X); if (w && w[1].r) src = w[1]; }
    if (o.how === 'up') { const b = L.get(X) || (o.cur.aggNode && L.get(o.cur.aggNode)); src = b ? { x: b.x, y: b.y, r: b.r } : { x: C.x, y: C.y, r: 20 }; }
    const done = () => drop(leaving.map(([n]) => n));
    if (!src) {
      // a jump: the old level fades and shrinks, the new one pops in
      const b0 = { ...backState };
      stop = tween(650, e => {
        leaving.forEach(([n, w]) => set(n, w.x, w.y, w.r * (1 - e * .3), 1 - e));
        fresh.forEach(([n], i) => { const l = L.get(n), t = U.clamp(e * 1.4 - i * .015, 0, 1); set(n, l.x, l.y, l.r * Math.max(.001, U.ease.outBack(t)), U.clamp(t * 2, 0, 1)); });
        if (!atRoot) setBack(C.x, C.y, U.lerp(b0.r || RF + 2, RF + 2, e)); else setBack(b0.x, b0.y, b0.r * (1 - e));
      }, done);
      return;
    }
    const k = (RF + 2) / src.r;
    if (o.how === 'down') {
      const fromRoot = o.cur.depth === 0;
      stop = tween(800, e => {
        // everything of the outer level follows the zoom out of the frame
        // the opened node grows into the backdrop; its neighbours drift a little outward and are gone before they
        // could reach the edge of the frame
        const cx = U.lerp(src.x, C.x, e), cy = U.lerp(src.y, C.y, e), sd = U.lerp(1, Math.min(k, 1.6), e);
        leaving.forEach(([n, w]) => n === X
          ? set(n, U.lerp(w.x, C.x, e), U.lerp(w.y, C.y, e), U.lerp(w.r, w.r * k, e), 1 - U.clamp(e * 1.8, 0, 1))
          : set(n, inX(cx + (w.x - src.x) * sd, w.r), inY(cy + (w.y - src.y) * sd, w.r), w.r, 1 - U.clamp(e * 3, 0, 1)));
        const dx = cx, dy = cy, dr = U.lerp(src.r, RF + 2, e), f = dr / (RF + 2);
        if (fromRoot) setBack(dx, dy, dr); else setBack(C.x, C.y, RF + 2);
        fresh.forEach(([n]) => { const l = L.get(n); set(n, dx + (l.x - C.x) * f, dy + (l.y - C.y) * f, l.r * f, U.clamp((e - .25) * 2, 0, 1)); });
      }, done);
    } else {
      stop = tween(750, e => {
        const dx = U.lerp(C.x, src.x, e), dy = U.lerp(C.y, src.y, e), dr = U.lerp(RF + 2, src.r, e), f = dr / (RF + 2);
        leaving.forEach(([n, w]) => set(n, dx + (w.x - C.x) * f, dy + (w.y - C.y) * f, w.r * f, 1 - U.clamp(e * 2, 0, 1)));
        if (atRoot) setBack(dx, dy, dr * (1 - e)); else setBack(C.x, C.y, RF + 2);
        // the node we came from shrinks back from the backdrop; the others drift in and appear once nearly in place
        const cx = U.lerp(C.x, src.x, e), cy = U.lerp(C.y, src.y, e), sd = U.lerp(Math.min(k, 1.6), 1, e);
        fresh.forEach(([n]) => { const l = L.get(n);
          if (n === X) set(n, cx, cy, U.lerp(l.r * k, l.r, e), U.clamp(e * 1.4 - .2, 0, 1));
          else set(n, inX(cx + (l.x - src.x) * sd, l.r), inY(cy + (l.y - src.y) * sd, l.r), l.r, U.clamp((e - .45) * 2.2, 0, 1)); });
      }, done);
    }
  }
  return {
    render,
    // the hovered bubble stands out, the others fade back
    hover(x) { els.forEach((el, n) => el.classList.toggle('is-hl', n === x)); svg.classList.toggle('has-hl', !!x && els.has(x)); },
    playing(c, playing, p) {
      els.forEach((el, n) => {
        const on = !!c && playable(n) === c && playing;
        el.classList.toggle('playing', on && n.depth > 0);
        if (n._pi) n._pi.setAttribute('d', on ? SVG_PAUSE : SVG_PLAY);
        if (n._ring) n._ring.setAttribute('stroke-dasharray', `${(c === n ? p * 100 : 0).toFixed(2)} 100`);
      });
    },
    flash(n) {
      const t = shown.includes(n) ? n : n.parent.aggNode;
      if (!t || !t._el) return;
      t._el.classList.remove('flash'); void t._el.getBBox(); t._el.classList.add('flash');
      if (t === n) t._el.focus({ preventScroll: true });
    },
  };
}

// the data loads with the page; if it can't (offline, a server error), the figure slot says so and offers a retry
function load() {
  row.querySelector('.tx-fail')?.remove();
  fetch('assets/data/taxonomy.json')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(J => explorer(row, buildTree(J), bubbles))
    .catch(() => {
      const f = document.createElement('div');
      f.className = 'fig tx-fail'; f.setAttribute('role', 'status');
      f.innerHTML = '<p>The taxonomy figure couldn\u2019t load. Check your connection, then try again.</p><button type="button" class="copy">Try again</button>';
      f.querySelector('button').addEventListener('click', load);
      row.appendChild(f);
    });
}
load();
})();
