/* ================= share: one-tap posts to X, Bluesky, LinkedIn, or a copied link ================= */
// The header Share button opens a small menu; the game's final screen shares the reader's score; each chapter
// heading has a link button that copies a link straight to that chapter.
(function () {
  // the hosted page; until then the links point at wherever the page is open (set before publishing)
  const PAGE_PUBLIC_URL = 'https://projects.laion.ai/clap2/';
  const HANDLES = '@laion_ai';
  const TAGS = '#CLAP #LAIONAudioXL';
  // no prefilled sentence: the share sheet opens with only the mention and the tags, so the reader writes their own post
  const TEXT = `${HANDLES} ${TAGS}`;

  const pageUrl = hash => (PAGE_PUBLIC_URL || location.href.split('#')[0]) + (hash || '');

  const targets = {
    x: (t, u) => `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
    bluesky: (t, u) => `https://bsky.app/intent/compose?text=${encodeURIComponent(t + ' ' + u)}`,
    linkedin: (t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`,
  };
  const ICONS = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.3 4.7H5.5z"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M6.3 3.9C8.6 5.6 11.1 9.1 12 11c.9-1.9 3.4-5.4 5.7-7.1 1.7-1.2 4.3-2.2 4.3.8 0 .6-.3 5-.5 5.7-.7 2.5-3.2 3.1-5.5 2.7 4 .7 5 2.9 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.3-.8-.3.8c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.8-.2-5.5-2.7C2.3 9.7 2 5.3 2 4.7c0-3 2.6-2 4.3-.8z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M4.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 8.8h3V21H3zm5.4 0h2.9v1.7c.4-.8 1.4-2 3.4-2 3.1 0 3.8 2.1 3.8 4.8V21h-3v-6c0-1.4 0-3.1-1.9-3.1s-2.2 1.5-2.2 3V21h-3z"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8"/></svg>',
  };
  const NAMES = { x: 'Post on X', bluesky: 'Post on Bluesky', linkedin: 'Share on LinkedIn' };

  // copies a link; if the clipboard refuses, the browser's own prompt shows the link ready to copy by hand
  async function copy(text) {
    if (await U.copyText(text)) return true;
    window.prompt('Copy this link:', text);
    return false;
  }
  const open = url => window.open(url, '_blank', 'noopener,width=620,height=640');
  // Lio (js/ask.js) does a little bit whenever the reader shares
  const shared = () => document.dispatchEvent(new Event('page-share'));

  // ---- the menu: one element, moved next to whichever button opened it ----
  const menu = document.createElement('div');
  menu.className = 'share-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  let opener = null, current = null;

  function fill(text, url) {
    current = { text, url };
    menu.innerHTML = '';
    const item = (key, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = 'sh-' + key;
      // icons only: the label is the tooltip and what screen readers say
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = ICONS[key];
      b.addEventListener('click', () => fn(b));
      menu.append(b);
      return b;
    };
    Object.keys(targets).forEach(k => item(k, NAMES[k], () => { open(targets[k](current.text, current.url)); close(); }));
    menu.append(document.createElement('hr'));
    item('link', 'Copy link', async b => {
      if (!await copy(current.url)) { close(); return; }
      b.setAttribute('aria-label', 'Link copied');
      b.title = 'Link copied';
      b.classList.add('done');
      setTimeout(close, 900);
    });
    // phones: the system share sheet reaches every app the reader has
    if (navigator.share) item('more', 'More…', () => { navigator.share({ title: document.title, text: current.text, url: current.url }).catch(() => {}); close(); });
  }

  function place() {
    const r = opener.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + h < innerHeight;
    menu.style.left = left + 'px';
    menu.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)) + 'px';
  }
  function show(btn, text, url) {
    if (opener === btn && !menu.hidden) { close(); return; }
    close();
    opener = btn;
    fill(text, url);
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    shared();
    menu.querySelector('button').focus({ preventScroll: true });
  }
  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (opener) { opener.setAttribute('aria-expanded', 'false'); if (refocus) opener.focus(); }
    opener = null;
  }
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[aria-haspopup="menu"]')) close(); });
  document.addEventListener('keydown', e => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { close(true); return; }
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); items[(i + step + items.length) % items.length].focus(); }
  });
  addEventListener('scroll', () => { if (!menu.hidden) place(); }, { passive: true });
  U.onWidth(() => close());

  const wire = (btn, get) => {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', e => { e.stopPropagation(); const [t, u] = get(); show(btn, t, u); });
  };

  // ---- header and top bar ----
  document.querySelectorAll('[data-share]').forEach(b => wire(b, () => [TEXT, pageUrl()]));

  // ---- bottom of the page: one icon button per network, no menu ----
  document.querySelectorAll('[data-share-row]').forEach(row => {
    const add = (key, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sh-' + key;
      b.innerHTML = ICONS[key];
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', () => { fn(b); shared(); });
      row.append(b);
    };
    Object.keys(targets).forEach(k => add(k, NAMES[k], () => open(targets[k](TEXT, pageUrl()))));
    let t;
    add('link', 'Copy link', async b => {
      if (!await copy(pageUrl())) return;
      b.classList.add('done');
      b.title = 'Link copied';
      clearTimeout(t);
      t = setTimeout(() => { b.classList.remove('done'); b.title = 'Copy link'; }, 1600);
    });
  });

  // ---- the game's final screen calls this with the score ----
  window.SHARE = {
    wire,
    page: () => [TEXT, pageUrl()],
    score: (you, clap, n) => [
      `I scored ${you}/${n} vs CLAP2's ${clap}/${n} at matching sounds to captions. ${you > clap ? 'Beat the model 😎' : 'Can you beat it?'} 🎧 ${HANDLES}`,
      pageUrl('#game'),
    ],
  };

  // ---- chapter headings: a link button that copies a link to the chapter ----
  document.querySelectorAll('section.sec[id] .sec-title h2').forEach(h => {
    const id = h.closest('section').id;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sec-link';
    b.innerHTML = ICONS.link;
    const label = `Copy a link to “${h.textContent.replace(/^\d+/, '')}”`;
    b.setAttribute('aria-label', label);
    b.title = label;
    let t;
    b.addEventListener('click', async () => {
      const ok = await copy(pageUrl('#' + id));
      history.replaceState(null, '', '#' + id);
      shared();
      if (!ok) return;
      b.classList.add('done');
      clearTimeout(t);
      t = setTimeout(() => b.classList.remove('done'), 1600);
    });
    h.append(b);
  });
})();
