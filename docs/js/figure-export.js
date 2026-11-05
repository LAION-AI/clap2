/* ================= copy or save a figure as an image ================= */
// Right-click (or long-press) any figure to copy it as an image or save it as PNG, and charts
// that are a single SVG also as SVG; right-click the MAEB-30 table to copy or save it as Markdown.
// Exports show the figure as currently displayed, in the light theme, with styles inlined,
// IBM Plex embedded, a white background and a credit line.
// Figures are found when the menu opens (event delegation), so charts that are rebuilt on
// resize or swapped for a phone layout always export their current DOM.
(function figureExport() {
  const D = window.DATA;
  const SVGNS = 'http://www.w3.org/2000/svg';
  // file names by the figure's row
  const NAMES = {
    flow: 'laion-audio-xl-pipeline',
    taxonomy: 'laion-audio-xl-taxonomy',
    captioning: 'laion-audio-xl-captioning',
    compare: 'laion-audio-xl-vs-audio-text-datasets',
    arch: 'clap2-architecture',
    patches: 'clap2-patches',
    'scale-fig': 'laion-audio-xl-scaling',
    alloc: 'laion-audio-xl-compute-allocation',
    'progress-fig': 'clap-progress',
    'sota-fig': 'clap2-size-vs-score',
  };
  // interactive parts that don't belong in a static figure
  const SKIP = '.pf-info, .pf-dots, .pf-leader, .pf-leader-dot, .pf-tip, .pf-canvas, .tip, .info, .info-more, ' +
    '.bd-pb, .fe-ctl, .cfm-dot, .cn, .cn-d, .cn-hang, .cn-head, title, script, style, noscript, template, audio, video, input, select, textarea';
  const CREDIT = 'LAION-Audio-XL · Wijngaard, Förster et al., 2026';
  const LEAF = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
  // computed values that equal the SVG defaults are left out to keep files small
  const PROPS = {
    fill: 'rgb(0, 0, 0)', 'fill-opacity': '1', stroke: 'none', 'stroke-width': '1px', 'stroke-opacity': '1',
    'stroke-dasharray': 'none', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', opacity: '1',
    visibility: 'visible', display: 'inline',
  };
  // paint-order keeps the white halo behind label text
  const TEXT = { 'font-family': '', 'font-size': '', 'font-weight': '400', 'font-style': 'normal', 'letter-spacing': 'normal', 'text-anchor': 'start', 'dominant-baseline': 'auto', 'paint-order': 'normal' };
  const GROUP = { opacity: '1', display: 'inline', visibility: 'visible' };
  const STOP = { 'stop-color': 'rgb(0, 0, 0)', 'stop-opacity': '1' };   // gradient colours often come from CSS
  // computed properties never copied into HTML exports (motion, interaction, or duplicated geometry)
  const NOCOPY = /^(transition|animation|d$|content$|cursor|will-change|content-visibility|contain-intrinsic|view-transition|pointer-events|user-select|-webkit-user|touch-action|caret|scroll|overscroll|-webkit-tap|-webkit-touch)/;

  // IBM Plex Sans and Mono (latin) as data URLs, fetched once on first export
  let fontCSS = null;
  function fonts() {
    if (fontCSS) return fontCSS;
    fontCSS = fetch('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap')
      .then(r => r.text())
      .then(css => Promise.all(css.split('/* ').filter(b => b.startsWith('latin */')).map(async b => {
        const url = (b.match(/url\(([^)]+)\)/) || [])[1];
        return url ? b.slice(b.indexOf('@font-face')).replace(url, await dataURL(url)) : '';
      })))
      .then(blocks => blocks.join('\n'))
      .catch(() => '');
    return fontCSS;
  }
  const dataCache = new Map();
  function dataURL(url) {
    if (!dataCache.has(url)) {
      dataCache.set(url, fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then(b => new Promise(res => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b);
      })));
    }
    return dataCache.get(url);
  }
  // images and CSS url()s (icon masks, backgrounds) must be embedded: an SVG drawn as an image loads nothing
  async function embedURLs(text) {
    const urls = new Set();
    text.replace(/url\((?:&quot;|"|')?(https?:\/\/[^"'&)]+)/g, (m, u) => urls.add(u));
    text.replace(/<(?:img|image)\b[^>]*?\s(?:src|href|xlink:href)="(https?:\/\/[^"]+)"/g, (m, u) => urls.add(u.replace(/&amp;/g, '&')));
    for (const u of urls) {
      const d = await dataURL(u).catch(() => null);
      if (d) text = text.split(u).join(d).split(u.replace(/&/g, '&amp;')).join(d);
    }
    return text;
  }

  // Computed styles are read with the light theme on and transitions off, then restored before
  // anything else runs, so the page never visibly changes
  function inLight(fn) {
    const root = document.documentElement, was = root.dataset.theme;
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.appendChild(still);
    root.dataset.theme = 'light';
    try { return fn(); } finally {
      if (was) root.dataset.theme = was; else delete root.dataset.theme;
      void document.body.offsetHeight;   // restyle while transitions are still off
      still.remove();
    }
  }

  // default computed styles per element type, from an empty same-origin frame
  function defaultsFor() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:50px;height:50px;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument, cache = new Map();
    const svgHost = doc.createElementNS(SVGNS, 'svg');
    doc.body.appendChild(svgHost);
    return {
      get(el) {
        const key = el.namespaceURI + ' ' + el.localName;
        if (!cache.has(key)) {
          const d = doc.createElementNS(el.namespaceURI || 'http://www.w3.org/1999/xhtml', el.localName);
          (el.namespaceURI === SVGNS && el.localName !== 'svg' ? svgHost : doc.body).appendChild(d);
          const cs = frame.contentWindow.getComputedStyle(d), o = {};
          for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
          d.remove();
          cache.set(key, o);
        }
        return cache.get(key);
      },
      done() { frame.remove(); },
    };
  }

  const pageURL = location.href.split('#')[0];
  const fixURL = v => (v.includes('url(') ? v.split(pageURL + '#').join('#') : v);

  // every computed value that differs from the element type's default or from the parent's value
  function fullStyle(cs, def, parent) {
    const out = [], vals = {};
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (NOCOPY.test(p)) continue;
      const v = cs.getPropertyValue(p);
      vals[p] = v;
      if (v !== def[p] || (parent && v !== parent[p])) out.push(`${p}:${fixURL(v)}`);
    }
    return { css: out.join(';'), vals };
  }

  // Clone `src` with computed styles inlined. lean: plain SVG elements get only the SVG paint
  // properties (clean, editable SVG); HTML (and SVG inside HTML) gets its full computed style,
  // pseudo-elements as real spans and canvases as images. dropFO leaves out foreignObjects.
  function inlineTree(src, { lean = false, dropFO = false } = {}) {
    return inLight(() => {
      const defs = defaultsFor();
      try {
        const clone = src.cloneNode(true);
        const a = [src, ...src.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
        const vals = new Map(), later = [];
        a.forEach((el, i) => {
          const c = b[i];
          if (el !== src && (el.matches(SKIP) || (dropFO && el.localName === 'foreignObject'))) { c.setAttribute('data-skip', ''); return; }
          c.removeAttribute('class');
          const tag = el.localName;
          if (lean && el.namespaceURI === SVGNS && !(el.parentElement && el.parentElement.closest('foreignObject'))) {
            const set = LEAF.has(tag) ? { ...PROPS, ...(tag === 'text' || tag === 'tspan' ? TEXT : {}) } : tag === 'g' ? GROUP : tag === 'stop' ? STOP : null;
            if (!set) return;
            const cs = getComputedStyle(el), out = [];
            for (const [p, def] of Object.entries(set)) {
              const v = cs.getPropertyValue(p);
              // display only matters when an element is hidden; other values (e.g. block) can stop text rendering
              if (p === 'display' ? v === 'none' : v && v !== def) out.push(`${p}:${fixURL(v)}`);
            }
            // CSS transforms (e.g. scaled-down markers) and their origin
            const tf = cs.getPropertyValue('transform');
            if (tf && tf !== 'none') ['transform', 'transform-origin', 'transform-box'].forEach(p => out.push(`${p}:${cs.getPropertyValue(p)}`));
            if (out.length) c.setAttribute('style', out.join(';')); else c.removeAttribute('style');
            return;
          }
          const cs = getComputedStyle(el);
          if (cs.display === 'none') { c.setAttribute('data-skip', ''); return; }
          const st = fullStyle(cs, defs.get(el), el === src ? null : vals.get(el.parentElement));
          vals.set(el, st.vals);
          c.setAttribute('style', st.css);
          if (tag === 'canvas') {
            later.push(() => {
              const img = document.createElement('img');
              img.src = el.toDataURL('image/png');
              img.setAttribute('style', st.css);
              c.replaceWith(img);
            });
          } else if (tag === 'img' && el.currentSrc) {
            c.setAttribute('src', el.currentSrc);
            c.removeAttribute('srcset');
          }
          if (el.namespaceURI !== SVGNS) {
            ['::before', '::after'].forEach(which => {
              const ps = getComputedStyle(el, which), content = ps.getPropertyValue('content');
              if (!content || content === 'none' || content === 'normal' || ps.display === 'none') return;
              const span = document.createElement('span');
              span.setAttribute('style', fullStyle(ps, defs.get(span), st.vals).css);
              const m = /^"((?:[^"\\]|\\.)*)"$/.exec(content);
              if (m) span.textContent = m[1].replace(/\\(.)/g, '$1');
              later.push(() => (which === '::before' ? c.insertBefore(span, c.firstChild) : c.appendChild(span)));
            });
          }
        });
        later.forEach(f => { try { f(); } catch (err) { /* a tainted canvas is left out */ } });
        clone.querySelectorAll('[data-skip]').forEach(e => e.remove());
        return clone;
      } finally { defs.done(); }
    });
  }

  // bounding box of everything that will be exported, in viewBox units
  function contentBox(svg, vb) {
    const r = svg.getBoundingClientRect(), k = vb.width / r.width;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text, foreignObject').forEach(e => {
      if (e.closest(SKIP) || e.closest('defs, clipPath, mask') || (e.parentElement.closest('foreignObject'))) return;
      const b = e.getBoundingClientRect();
      if (!b.width && !b.height) return;
      x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
    });
    if (x0 === Infinity) return vb;
    const pad = 12;
    const bx = Math.max(vb.x, vb.x + (x0 - r.left) * k - pad), by = Math.max(vb.y, vb.y + (y0 - r.top) * k - pad);
    const ex = Math.min(vb.x + vb.width, vb.x + (x1 - r.left) * k + pad), ey = Math.min(vb.y + vb.height, vb.y + (y1 - r.top) * k + pad);
    return { x: bx, y: by, width: ex - bx, height: ey - by };
  }

  function creditText(x, y) {
    const t = document.createElementNS(SVGNS, 'text');
    Object.entries({ x, y, 'text-anchor': 'end', style: "font-family:'IBM Plex Sans',sans-serif;font-size:11px;fill:#8a8a8a" })
      .forEach(([k, v]) => t.setAttribute(k, v));
    t.textContent = CREDIT;
    return t;
  }

  // a chart that is one <svg>; foreignObject content (icons, HTML cards) is kept with its styles
  async function serializeSVG(svg, opts = {}) {
    const clone = inlineTree(svg, { lean: true, dropFO: opts.dropFO });
    ['class', 'role', 'aria-label', 'id', 'style'].forEach(k => clone.removeAttribute(k));
    let vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) { const r = svg.getBoundingClientRect(); vb = { x: 0, y: 0, width: r.width, height: r.height }; }
    const box = contentBox(svg, vb);
    const CH = 26;   // room for the credit line
    const W = Math.round(box.width), H = Math.round(box.height + CH);
    clone.setAttribute('xmlns', SVGNS);
    clone.setAttribute('viewBox', `${box.x} ${box.y} ${W} ${H}`);
    clone.setAttribute('width', W);
    clone.setAttribute('height', H);
    // the page may size the SVG in CSS units; text inside it scales with the viewBox either way
    const fs = getComputedStyle(svg).fontFamily;
    if (fs) clone.setAttribute('font-family', fs);
    const bg = document.createElementNS(SVGNS, 'rect');
    Object.entries({ x: box.x, y: box.y, width: W, height: H, fill: '#ffffff' }).forEach(([k, v]) => bg.setAttribute(k, v));
    clone.insertBefore(bg, clone.firstChild);
    clone.appendChild(creditText(box.x + W - 8, box.y + H - 9));
    const css = await fonts();
    if (css) {
      const st = document.createElementNS(SVGNS, 'style');
      st.textContent = css;
      clone.insertBefore(st, clone.firstChild);
    }
    const text = await embedURLs(new XMLSerializer().serializeToString(clone));
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + text, W, H };
  }

  // an HTML figure (or a mix of HTML and SVG), drawn into an SVG foreignObject
  async function serializeHTML(el) {
    const r = el.getBoundingClientRect();
    const w = Math.ceil(Math.max(r.width, el.scrollWidth)), h = Math.ceil(Math.max(r.height, el.scrollHeight));
    const clone = inlineTree(el);
    clone.removeAttribute('id');
    clone.style.margin = '0';
    clone.style.width = w + 'px';
    clone.style.height = h + 'px';
    clone.style.overflow = 'visible';
    clone.style.position = 'relative';
    const P = 16, CH = 26, W = w + 2 * P, H = h + P + CH;
    const svg = document.createElementNS(SVGNS, 'svg');
    Object.entries({ xmlns: SVGNS, width: W, height: H, viewBox: `0 0 ${W} ${H}` }).forEach(([k, v]) => svg.setAttribute(k, v));
    const bg = document.createElementNS(SVGNS, 'rect');
    Object.entries({ width: W, height: H, fill: '#ffffff' }).forEach(([k, v]) => bg.setAttribute(k, v));
    const fo = document.createElementNS(SVGNS, 'foreignObject');
    Object.entries({ x: P, y: P, width: w, height: h }).forEach(([k, v]) => fo.setAttribute(k, v));
    fo.appendChild(clone);
    svg.append(bg, fo, creditText(W - 8, H - 9));
    const css = await fonts();
    if (css) {
      const st = document.createElementNS(SVGNS, 'style');
      st.textContent = css;
      svg.insertBefore(st, svg.firstChild);
    }
    const text = await embedURLs(new XMLSerializer().serializeToString(svg));
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + text, W, H };
  }

  // sharp enough for slides and print, but under iOS's 16.7M-pixel canvas limit
  const scaleFor = (W, H) => Math.min(3, Math.sqrt(16e6 / (W * H)));
  const toBlob = canvas => new Promise((res, rej) => {
    try { canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'); } catch (err) { rej(err); }
  });

  async function rasterise({ text, W, H }) {
    const img = new Image();
    // Chrome only keeps a canvas exportable after drawing a foreignObject SVG from a data: URL
    const fo = text.includes('<foreignObject');
    const url = fo ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text) : URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.width = W; img.height = H;   // Safari needs a size to rasterise an SVG image
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG image failed to load')); img.src = url; });
      // Safari can fire load before the embedded font is ready; decode() waits for it
      if (img.decode) await img.decode().catch(() => {});
      const scale = scaleFor(W, H);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return await toBlob(canvas);   // Safari and older browsers refuse after a foreignObject
    } finally { if (!fo) URL.revokeObjectURL(url); }
  }

  // a canvas figure, framed like the others (in the colours it is drawn in)
  function canvasPng(cv) {
    const r = cv.getBoundingClientRect(), k = cv.width / Math.max(1, r.width);
    const P = Math.round(16 * k), CH = Math.round(26 * k);
    const out = document.createElement('canvas');
    out.width = cv.width + 2 * P; out.height = cv.height + P + CH;
    const g = out.getContext('2d');
    g.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, P, P);
    g.font = `${11 * k}px 'IBM Plex Sans', sans-serif`;
    g.fillStyle = '#8a8a8a';
    g.textAlign = 'right';
    g.fillText(CREDIT, out.width - 8 * k, out.height - 9 * k);
    return toBlob(out);
  }

  function figureText(f) { return f.kind === 'svg' ? serializeSVG(f.el) : serializeHTML(f.el); }
  async function figurePng(f) {
    if (f.kind === 'canvas') return canvasPng(f.el);
    const first = figureText(f);   // started now: the styles are read inside the user's click
    try { return await rasterise(await first); } catch (err) {
      // browsers that refuse foreignObject still get the chart without its HTML icons; when the
      // HTML holds text (caption cards), the caller saves the SVG instead
      const textFO = [...f.el.querySelectorAll('foreignObject')].some(fo => !fo.closest(SKIP) && fo.textContent.trim());
      if (f.kind === 'svg' && !textFO) return rasterise(await serializeSVG(f.el, { dropFO: true }));
      throw err;
    }
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const svgFile = async f => new Blob([(await figureText(f)).text], { type: 'image/svg+xml' });

  // MAEB-30 table as Markdown, from the same data the page table is built from
  function tableMarkdown() {
    const rows = [...D.maebOurs.map(r => [r[0] + ' (ours)', ...r.slice(1)]), ...D.maebSmall];
    const best = [2, 3, 4, 5].map(i => Math.max(...rows.map(r => r[i])));
    const cell = (v, i) => (v === best[i - 2] ? `**${v.toFixed(1)}**` : v.toFixed(1));
    return ['MAEB-30 scores (%) of audio-text models below 1B parameters. Best value per column in bold.', '',
      '| Model | Params | Mean | Speech | Music | Sound |', '|---|---:|---:|---:|---:|---:|',
      ...rows.map(r => `| ${r[0]} | ${r[1]}M | ${[2, 3, 4, 5].map(i => cell(r[i], i)).join(' | ')} |`),
      '', 'Source: LAION-Audio-XL, Wijngaard, Förster et al., 2026'].join('\n') + '\n';
  }

  // MAEB-30 table as HTML, so it pastes as a real table into Word, Docs, Sheets or Keynote
  function tableHTML() {
    const md = tableMarkdown().split('\n').filter(l => l.startsWith('| ') && !l.startsWith('|---'));
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const cell = (tag, s, i) => {
      const bold = /^\*\*(.*)\*\*$/.exec(s);
      const v = esc(bold ? bold[1] : s);
      return `<${tag}${i ? ' style="text-align:right"' : ''}>${bold ? `<b>${v}</b>` : v}</${tag}>`;
    };
    const row = (l, tag) => '<tr>' + l.slice(2, -2).split(' | ').map((s, i) => cell(tag, s, i)).join('') + '</tr>';
    return '<table><thead>' + row(md[0], 'th') + '</thead><tbody>' + md.slice(1).map(l => row(l, 'td')).join('') +
      '</tbody></table><p>Source: LAION-Audio-XL, Wijngaard, Förster et al., 2026</p>';
  }

  // which figure an event target belongs to, looked up afresh every time
  function alone(fig, keep) {
    // true when nothing visible in the figure lies outside `keep`, apart from interactive chrome
    const tw = document.createTreeWalker(fig, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const p = n.parentElement;
      if (n.data.trim() && !keep.contains(p) && !p.closest(SKIP) && p.getClientRects().length) return false;
    }
    for (const m of fig.querySelectorAll('canvas, img, svg')) {
      if (keep.contains(m) || m.contains(keep) || m.closest(SKIP) || (m.parentElement && m.parentElement.closest('svg'))) continue;
      const r = m.getBoundingClientRect();
      if (r.width * r.height > 400) return false;
    }
    return true;
  }
  function resolve(t) {
    if (!(t instanceof Element) || menu.contains(t)) return null;
    if (t.closest('input, textarea, select, [contenteditable]')) return null;
    const link = t.closest('a[href]');
    // keep the browser's menu on text links (a chart inside a link card is still a figure)
    if (link && link instanceof HTMLAnchorElement && !t.closest('svg')) return null;
    const table = t.closest('#maeb-table');
    if (table) return { kind: 'table', el: table };
    const tk = t.closest('#takeaways svg.tk-chart');
    if (tk) {
      const i = [...document.querySelectorAll('#takeaways svg.tk-chart')].indexOf(tk);
      return { kind: 'svg', el: tk, name: 'clap2-key-number-' + (i + 1) };
    }
    const fig = t.closest('.fig');
    if (!fig || fig.querySelector('.code-box, pre')) return null;
    const row = fig.closest('.row[id], section[id]');
    const name = (row && NAMES[row.id]) || 'laion-audio-xl-' + (row ? row.id : 'figure');
    const wide = el => el.getBoundingClientRect().width >= 160 && !el.closest(SKIP);
    if (fig.closest('#taxonomy')) {
      const bd = fig.querySelector('.xcanvas svg');
      if (bd) return { kind: 'svg', el: bd, name };
    }
    const svgs = [...fig.querySelectorAll('svg')].filter(s => !(s.parentElement && s.parentElement.closest('svg')) && wide(s));
    if (svgs.length === 1 && alone(fig, svgs[0])) return { kind: 'svg', el: svgs[0], name };
    const cvs = [...fig.querySelectorAll('canvas')].filter(wide);
    if (!svgs.length && cvs.length === 1 && alone(fig, cvs[0])) return { kind: 'canvas', el: cvs[0], name };
    return { kind: 'html', el: fig, name };
  }

  // Context menu on figures and the table. The browser's own "Copy image" only exists for <img>,
  // so figures get this small menu instead. It opens on right-click, Ctrl+click and two-finger
  // click (macOS) and long-press (touch). Shift+right-click, right-clicking a link, or
  // right-clicking while text is selected keeps the browser menu.
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const toast = document.createElement('div');
  toast.className = 'ctx-toast';
  toast.setAttribute('role', 'status');
  document.body.append(menu, toast);
  let tt, openedAt = 0, openY = 0;

  function say(text, x, y) {
    toast.textContent = text;
    toast.style.left = Math.max(8, Math.min(x, innerWidth - 220)) + 'px';
    toast.style.top = Math.max(48, y) + 'px';
    toast.classList.add('on');
    clearTimeout(tt);
    tt = setTimeout(() => toast.classList.remove('on'), 2400);
  }
  // focus goes back to where it was when the menu opened (a figure or table reached by keyboard)
  let opener = null;
  function close() {
    if (menu.hidden) return;
    const back = menu.contains(document.activeElement) ? opener : null;
    menu.hidden = true; opener = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  function open(x, y, items) {
    if (menu.hidden) opener = document.activeElement;
    menu.innerHTML = '';
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = it.label;
      // run() must start synchronously inside the click: Safari only lets the clipboard be
      // written from within the user gesture (it accepts a promise for the data itself)
      b.addEventListener('click', () => {
        close();
        let job;
        try { job = it.run(); } catch (err) { job = Promise.reject(err); }
        job.then(msg => say(msg, x, y), err => {
          console.warn('figure export:', err);
          say('Couldn\u2019t do that in this browser. Try another option in this menu.', x, y);
        });
      });
      menu.appendChild(b);
    });
    menu.hidden = false;
    openedAt = Date.now();
    openY = scrollY;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
    menu.querySelector('button').focus({ preventScroll: true });
  }
  // a Ctrl+click on macOS, or the tap that ends a long-press, can follow the opening event
  // with a click; it must not close the menu it just opened
  document.addEventListener('click', e => {
    if (menu.hidden || menu.contains(e.target)) return;
    if (Date.now() - openedAt < 400) return;
    close();
  });
  document.addEventListener('keydown', e => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { close(); return; }   // leaving by keyboard closes it, like a native context menu
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
    }
  });
  // close on a real scroll, not on the small shifts a page can make while a menu opens
  window.addEventListener('scroll', () => { if (!menu.hidden && Math.abs(scrollY - openY) > 30) close(); }, { passive: true });
  U.onWidth(close);

  // clipboard helpers, each with a fallback for browsers without the async Clipboard API
  // (Firefox before 127 has no ClipboardItem; older Chrome rejects promise values)
  async function writeItem(data) {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no ClipboardItem');
    try {
      await navigator.clipboard.write([new ClipboardItem(data)]);
    } catch (err) {
      if (err && err.name === 'NotAllowedError') throw err;
      const plain = {};
      for (const [k, v] of Object.entries(data)) plain[k] = await v;
      await navigator.clipboard.write([new ClipboardItem(plain)]);
    }
  }
  function execCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('execCommand copy failed');
  }
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch (err) { /* try the old way */ }
    }
    execCopy(text);
  }

  function figureItems(f) {
    fonts();   // start fetching the font now, the click comes later
    let png = null;
    const getPng = () => png || (png = figurePng(f));
    // where no PNG can be made (Safari with HTML figures), the SVG still opens in any browser
    const fallback = async () => {
      try { save(await getPng(), f.name + '.png'); return 'Couldn’t copy here, saved PNG instead'; } catch (err) {
        if (f.kind === 'canvas') throw err;
        save(await svgFile(f), f.name + '.svg');
        return 'Couldn’t make a PNG here, saved SVG instead';
      }
    };
    const items = [
      { label: 'Copy image', run: async () => {
        const p = getPng();
        p.catch(() => {});
        try {
          // the PNG is passed as a promise: Safari requires write() to be called synchronously
          await writeItem({ 'image/png': p });
          return 'Image copied';
        } catch (err) {
          console.warn('figure export: copy failed, saving instead', err);
          return fallback();
        }
      } },
      { label: 'Save as PNG', run: async () => {
        try { save(await getPng(), f.name + '.png'); return 'Saved PNG'; } catch (err) {
          console.warn('figure export: PNG failed', err);
          return fallback();
        }
      } },
    ];
    if (f.kind === 'svg') items.push({ label: 'Save as SVG', run: async () => { save(await svgFile(f), f.name + '.svg'); return 'Saved SVG'; } });
    return items;
  }
  const tableItems = () => [
    { label: 'Copy table', run: async () => {
      const md = tableMarkdown();
      try {
        await writeItem({
          'text/html': new Blob([tableHTML()], { type: 'text/html' }),
          'text/plain': new Blob([md], { type: 'text/plain' }),
        });
      } catch (err) { await copyText(md); return 'Table copied as Markdown'; }
      return 'Table copied';
    } },
    { label: 'Copy as Markdown', run: async () => { await copyText(tableMarkdown()); return 'Table copied as Markdown'; } },
    { label: 'Save as Markdown', run: async () => { save(new Blob([tableMarkdown()], { type: 'text/markdown' }), 'maeb30-compact-models.md'); return 'Saved Markdown'; } },
  ];

  // macOS (Safari and Chrome) selects the word under the pointer on right-click before the
  // contextmenu event fires, so the selection is read when the button goes down instead
  let selAtDown = '', downAt = 0;
  document.addEventListener('pointerdown', () => { selAtDown = String(window.getSelection()); downAt = Date.now(); }, true);
  const hadSelection = () => (Date.now() - downAt < 1500 ? selAtDown : String(window.getSelection()));

  function show(f, x, y) {
    if (!menu.hidden && Date.now() - openedAt < 700) return;   // long-press and contextmenu both fired
    open(x, y, f.kind === 'table' ? tableItems() : figureItems(f));
  }
  let timer = 0, sx = 0, sy = 0, long = false;
  document.addEventListener('contextmenu', e => {
    const f = resolve(e.target);
    if (!f || e.shiftKey || hadSelection()) return;   // keep the browser menu
    e.preventDefault();
    if (!selAtDown) window.getSelection().removeAllRanges();   // drop the word macOS just selected
    show(f, e.clientX || sx, e.clientY || sy);
  });
  // iOS never fires contextmenu, so long-press is detected by hand (Android fires both)
  document.addEventListener('touchstart', e => {
    long = false;
    clearTimeout(timer);
    if (e.touches.length !== 1) return;
    const f = resolve(e.target);
    if (!f) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => {
      long = true;
      window.getSelection().removeAllRanges();
      show(f, sx, sy + 12);   // just below the finger, so lifting it doesn't hit an item
    }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (t && Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(timer);
  }, { passive: true });
  document.addEventListener('touchend', e => { clearTimeout(timer); if (long && e.cancelable) e.preventDefault(); long = false; });
  document.addEventListener('touchcancel', () => clearTimeout(timer));
})();
