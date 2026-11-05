// The paper link is a placeholder until the arXiv version is out; a click says so instead of doing nothing
document.addEventListener('click', e => {
  const a = e.target.closest('a[aria-disabled="true"]');
  if (!a) return;
  e.preventDefault();
  a.classList.add('soon-show');
  clearTimeout(a.soonT);
  a.soonT = setTimeout(() => a.classList.remove('soon-show'), 1600);
});

// copy the BibTeX entry, from its own button or from the BibTeX link in the top bar
(function () {
  const btn = document.getElementById('bib-copy');
  if (!btn) return;
  const label = btn.querySelector('span');
  let t;
  async function copyBib() {
    const pre = document.getElementById('bib');
    const ok = await U.copyText(pre.innerText);
    label.textContent = ok ? 'Copied' : U.selectForCopy(pre);
    return ok;
    btn.classList.toggle('done', ok);
    clearTimeout(t);
    t = setTimeout(() => { label.textContent = 'Copy'; btn.classList.remove('done'); }, ok ? 2500 : 5000);
  }
  btn.addEventListener('click', copyBib);
  // the top-bar link still scrolls to the entry; it copies on the way and says so
  const link = document.querySelector('.tb-links a[href="#bibtex"]');
  let lt;
  link.title = 'Copy the BibTeX entry and jump to it';
  link.addEventListener('click', async () => {
    // if the copy failed, the entry's own button now says how to copy it by hand
    if (!await copyBib()) return;
    link.textContent = 'BibTeX copied';
    link.classList.add('done');
    clearTimeout(lt);
    lt = setTimeout(() => { link.textContent = 'BibTeX'; link.classList.remove('done'); }, 2500);
  });
})();

// code tabs: switch the visible snippet and point the copy button at it
document.querySelectorAll('.code-tabs').forEach(list => {
  const tabs = [...list.querySelectorAll('[role=tab]')];
  // the tabs live in the side column; the snippets and their copy button in the code box beside it
  const copy = document.getElementById(tabs[0].getAttribute('aria-controls')).closest('.code-box').querySelector('.copy');
  const pick = t => {
    tabs.forEach(x => {
      const on = x === t;
      x.setAttribute('aria-selected', on);
      x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    });
    copy.dataset.copy = t.getAttribute('aria-controls');
  };
  tabs.forEach(t => t.addEventListener('click', () => pick(t)));
  list.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = tabs.indexOf(document.activeElement);
    if (!step || i < 0) return;
    e.preventDefault();
    const n = tabs[(i + step + tabs.length) % tabs.length];
    n.focus(); pick(n);
  });
});

// copy buttons for code blocks: <button class="copy" data-copy="id-of-the-pre">
document.querySelectorAll('.copy[data-copy]').forEach(btn => {
  const label = btn.querySelector('span');
  let t;
  btn.addEventListener('click', async () => {
    const src = document.getElementById(btn.dataset.copy);
    const ok = await U.copyText(src.innerText);
    // the swap snippet copies a hidden line; on failure select the visible block it stands for
    label.textContent = ok ? 'Copied' : U.selectForCopy(src.hidden ? btn.closest('.qs-card, .code-box').querySelector('pre') : src);
    btn.classList.toggle('done', ok);
    clearTimeout(t);
    t = setTimeout(() => { label.textContent = 'Copy'; btn.classList.remove('done'); }, ok ? 2500 : 5000);
  });
});

// footer logos: give each the same visual area (scaled by its --s), capped by the row height
(function () {
  const imgs = [...document.querySelectorAll('.logo-set img')];
  const fit = img => {
    if (!img.naturalWidth) return;
    const ch = img.parentElement.clientHeight;
    const r = img.naturalWidth / img.naturalHeight, s = parseFloat(img.style.getPropertyValue('--s')) || 1;
    img.style.height = Math.min(ch, Math.sqrt(ch * ch * 2.2 * s * s / r)).toFixed(1) + 'px';
  };
  const all = () => imgs.forEach(fit);
  imgs.forEach(img => img.complete ? fit(img) : img.addEventListener('load', () => fit(img)));
  U.onWidth(all);
})();

// info buttons: the detail note floats over the page (no layout shift); one open at a time,
// closed by the button, Escape or a click elsewhere
(function () {
  // the button stays on the line of the paragraph's last word instead of wrapping alone
  document.querySelectorAll('p > .info').forEach(btn => {
    const t = btn.previousSibling;
    if (!t || t.nodeType !== 3) return;
    const m = t.data.match(/^([\s\S]*?)(\S+\s*)$/);
    if (!m) return;
    t.data = m[1];
    const nw = document.createElement('span');
    nw.className = 'nowrap';
    btn.replaceWith(nw);
    nw.append(m[2], btn);
  });
  const pairs = [...document.querySelectorAll('.info')].map(btn => [btn, document.getElementById(btn.getAttribute('aria-controls'))]);
  const set = (btn, more, open) => { btn.setAttribute('aria-expanded', open); more.hidden = !open; };
  const closeAll = except => pairs.forEach(([b, m]) => { if (b !== except) set(b, m, false); });
  pairs.forEach(([btn, more]) => btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = btn.getAttribute('aria-expanded') !== 'true';
    closeAll(btn);
    set(btn, more, open);
  }));
  document.addEventListener('click', e => { if (!e.target.closest('.info-more')) closeAll(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
})();

// top bar: hairline once the page scrolls, and an in-page link is marked while its section is in view
// (links to other pages keep the aria-current="page" they were written with)
(function () {
  const bar = document.querySelector('.topbar');
  const links = [...bar.querySelectorAll('.tb-links a[href^="#"]')];
  const secs = links.map(a => document.querySelector(a.getAttribute('href')));
  // phones: hide the bar while scrolling down, show it again on the way up
  const phone = window.matchMedia('(max-width: 640px)');
  let lastY = window.scrollY;
  function update() {
    const y = window.scrollY;
    bar.classList.toggle('scrolled', y > 4);
    if (!phone.matches || y < 60 || bar.classList.contains('menu-open')) bar.classList.remove('away');
    else if (y > lastY + 6) bar.classList.add('away');
    else if (y < lastY - 6) bar.classList.remove('away');
    if (Math.abs(y - lastY) > 6 || y < 60) lastY = y;
    const mark = window.innerHeight * .35;
    let cur = -1;
    secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= mark) cur = i; });
    links.forEach((a, i) => a.setAttribute('aria-current', i === cur));
  }
  window.addEventListener('scroll', update, { passive: true });
  update();

  // phones: the menu button drops the chapter links down; a pick, a tap outside or Escape closes it
  const menu = document.getElementById('menu-btn');
  if (!menu) return;
  const setMenu = open => {
    bar.classList.toggle('menu-open', open);
    menu.setAttribute('aria-expanded', open);
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  menu.addEventListener('click', () => setMenu(!bar.classList.contains('menu-open')));
  links.forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('click', e => { if (!e.target.closest('.topbar')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && bar.classList.contains('menu-open')) { setMenu(false); menu.focus(); } });
  phone.addEventListener('change', () => setMenu(false));
})();

// theme switch: starts from the system setting, a choice is remembered; charts that bake colours in listen for 'themechange'
(function () {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const root = document.documentElement, sys = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme || (sys.matches ? 'dark' : 'light');
  const label = () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
    btn.title = `Switch to ${next} mode`;
  };
  btn.addEventListener('click', () => {
    const t = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
    label();
    window.dispatchEvent(new Event('themechange'));
  });
  sys.addEventListener('change', () => { if (!root.dataset.theme) { label(); window.dispatchEvent(new Event('themechange')); } });
  label();
})();

// for whoever opens the dev console
console.log('%c  /\\_/\\\n ( o.o )  Rawr! You found Lio.\n  > ^ <   CLAP2 · LAION-Audio-XL\n\n%cModels  https://huggingface.co/laion\nData    laion/laion-audio-xl\nLAION   https://laion.ai',
  'color:#e3a03a;font:600 13px/1.4 monospace', 'color:inherit;font:12px/1.5 monospace');
