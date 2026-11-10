// Ask Lio: LAION's lion cub, pinned to the bottom-right corner. Tapping him opens a card that
// answers questions with the hand-written answers in js/qa-seeds.js (matched by js/qa.js). Every
// reply also offers to open the question in Claude or ChatGPT, with a link to the paper.
(function () {
  if (!window.LioQA) return;
  const ICON = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  // ---------- the cub ----------
  const FUR = '#f7c35a', FUR_D = '#e3a03a', MANE = '#1d374e', CREAM = '#fff6e2';
  // a natural amber mane, three tones from the outer locks inward
  const LOCK = '#b4521a', LOCK_2 = '#cb6d22', LOCK_3 = '#de8b33', STRAND = '#d97a33';
  // the mane: a ring of rounded locks that sweep outward and down, two rows deep
  function locks(n, rb, rt, { phase = 0, width = 1.5, swirl = 9, alt = 0, fill = LOCK, strand = '' } = {}) {
    const cx = 60, cy = 57, sx = 1.06;
    const P = (r, a) => `${(cx + r * sx * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
    let out = '';
    for (let i = 0; i < n; i++) {
      const a = (i + phase) / n * Math.PI * 2;
      const d = swirl * Math.PI / 180 * Math.cos(a); // both sides sweep downward
      const w = Math.PI / n * width, rm = rb + (rt - rb) * .62;
      const r = rt * (1 + alt * (i % 2 ? 1 : -1)), ta = a + d;
      out += `<path d="M${P(rb, a - w)}Q${P(rm, a - w * .95 + d * .5)} ${P(r, ta - w * .5)}Q${P(r + 4.2, ta)} ${P(r, ta + w * .5)}Q${P(rm, a + w * .95 + d * .5)} ${P(rb, a + w)}Z" fill="${fill}"/>`;
      if (strand) out += `<path d="M${P(rb + 3, a - w * .15)}Q${P(rb + (r - rb) * .55, a + d * .35 - w * .1)} ${P(r - 2, ta + w * .05)}" fill="none" stroke="${strand}" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>`;
    }
    return out;
  }
  // paws resting on the card: three toes, one outline around the outside, two small creases
  const paw = (x, cls) => {
    const shapes = `<ellipse cx="${x}" cy="98.5" rx="12.4" ry="8.2"/><circle cx="${x - 7}" cy="92.6" r="4.7"/><circle cx="${x}" cy="90.8" r="5"/><circle cx="${x + 7}" cy="92.6" r="4.7"/>`;
    return `<g class="g-paw ${cls}" style="transform-origin:${x}px 104px">
      <g fill="${FUR}" stroke="${FUR_D}" stroke-width="2.6">${shapes}</g><g fill="${FUR}">${shapes}</g>
      <path d="M${x - 3.5} 91.6q.4 1.4 0 2.6M${x + 3.5} 91.6q-.4 1.4 0 2.6" fill="none" stroke="${FUR_D}" stroke-width="1.2" stroke-linecap="round" opacity=".85"/>
    </g>`;
  };
  // graphite headphone cup with a thin silver edge and a small white LAION paw
  const cup = x => {
    const px = x + 8.5, py = 61.5;
    const toe = (dx, dy, rx, ry, r) => `<ellipse cx="${dx}" cy="${dy}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${dx} ${dy})"/>`;
    return `<rect x="${x}" y="48" width="17" height="27" rx="8.5" fill="#2b2f36"/><rect x="${x + 3}" y="52" width="11" height="19" rx="5.5" fill="#3d424b"/>
      <rect x="${x}" y="48" width="17" height="27" rx="8.5" fill="none" stroke="#a9b0ba" stroke-width="1" opacity=".55"/>
      <g fill="#fff" transform="translate(${px} ${py}) scale(.36)"><ellipse cx="0" cy="3" rx="5.6" ry="4.6"/>${toe(-6.8, -2.6, 2.1, 2.7, -24)}${toe(-2.6, -6.6, 2.2, 2.9, -8)}${toe(2.6, -6.6, 2.2, 2.9, 8)}${toe(6.8, -2.6, 2.1, 2.7, 24)}</g>`;
  };
  // ---------- props for his reactions to sharing and theme switches (hidden until one plays, css/ask.css) ----------
  // a little bluebird that lands on his headband and chirps
  const BIRD = `<g transform="translate(66 11)"><g class="g-x g-bird">
      <path d="M6 -1L13 -5L11 2Z" fill="#1a8cd8"/><ellipse cx="1" cy="0" rx="7.5" ry="5.5" fill="#1d9bf0"/><circle cx="-5" cy="-4" r="4.2" fill="#1d9bf0"/>
      <path d="M-9 -4.6L-12.5 -3.6L-9 -2.6Z" fill="#f5b82e"/><circle cx="-6" cy="-4.8" r="1" fill="#fff"/><circle cx="-6.2" cy="-4.8" r=".55" fill="#0f1419"/>
      <path class="g-wing" d="M-1 -1Q5 -8 9 -3Q4 3 -1 -1Z" fill="#1a8cd8"/>
      <path d="M-1 5v2.5M2.5 5v2.5" stroke="#f5b82e" stroke-width="1.2" stroke-linecap="round"/>
      <g class="g-chirp" stroke="#1d9bf0" stroke-width="1.2" stroke-linecap="round"><path d="M-14 -7l-3-2"/><path d="M-14.5 -3.6h-3.5"/></g></g></g>`;
  // a red megaphone held at the corner of his mouth
  const MEGA = `<g transform="translate(65 77) rotate(-25) scale(1.35)"><g class="g-x g-mega">
      <rect x="7" y="2" width="4" height="9" rx="1.5" fill="#2b2f36"/><path d="M0 -3.5L20 -10V10L0 3.5Z" fill="#e8453c"/>
      <ellipse cx="20" cy="0" rx="2.5" ry="10" fill="#b8322b"/><rect x="-4" y="-2.5" width="5" height="5" rx="1.5" fill="#2b2f36"/>
      <g class="g-waves" fill="none" stroke="#e8453c" stroke-width="1.6" stroke-linecap="round"><path d="M26 -8q5 8 0 16"/><path d="M32 -12q7 12 0 24"/></g></g></g>`;
  // the repost arrows
  const REPOST = `<g class="g-x g-repost" fill="none" stroke="#00ba7c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M50 6V0a4 4 0 0 1 4-4h10M61 -7.5l3.5 3.5-3.5 3.5"/><path d="M70 -2v6a4 4 0 0 1-4 4H56M59 11.5l-3.5-3.5 3.5-3.5"/></g>`;
  // the sun or the moon, crossing the sky over his head
  const ORB = `<g class="g-x g-orb"><g class="g-sun" fill="#f5b82e"><circle r="6"/><g stroke="#f5b82e" stroke-width="1.6" stroke-linecap="round">
      <path d="M0 -9.5v-2.5M0 9.5v2.5M-9.5 0h-2.5M9.5 0h2.5M-6.7 -6.7l-1.8 -1.8M6.7 6.7l1.8 1.8M-6.7 6.7l-1.8 1.8M6.7 -6.7l1.8 -1.8"/></g></g>
      <g class="g-moon"><path d="M2 -7.5A7.5 7.5 0 1 0 7.5 3A6 6 0 1 1 2 -7.5Z" fill="#f3e3a6"/><path d="M10 -9l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="#f3e3a6"/></g></g>`;
  const CUB = `<svg class="g-cub-svg" viewBox="0 0 120 108" aria-hidden="true">
    ${ORB}
    <g class="g-head">
      <g class="g-ear g-ear-l"><circle cx="30" cy="25" r="11" fill="${FUR}" stroke="${FUR_D}" stroke-width="1.3"/><circle cx="30" cy="26" r="6" fill="#f7a294"/></g>
      <g class="g-ear g-ear-r"><circle cx="90" cy="25" r="11" fill="${FUR}" stroke="${FUR_D}" stroke-width="1.3"/><circle cx="90" cy="26" r="6" fill="#f7a294"/></g>
      <g class="g-mane">
        <ellipse cx="60" cy="57" rx="36" ry="34" fill="${LOCK}"/>
        ${locks(14, 28, 42, { width: 1.55, swirl: 9, alt: .045, strand: STRAND })}
        ${locks(14, 27, 37, { phase: .5, width: 1.45, swirl: 11, alt: .04, fill: LOCK_2 })}
        <ellipse cx="60" cy="58.5" rx="31.5" ry="29.5" fill="${LOCK_3}"/>
      </g>
      <path class="g-band" d="M18 59 A42 42 0 0 1 102 59" fill="none" stroke="#2b2f36" stroke-width="5" stroke-linecap="round"/>
      <path d="M30 31 A42 42 0 0 1 90 31" fill="none" stroke="#5b616b" stroke-width="1.4" stroke-linecap="round"/>
      <path class="g-curl" d="M57 26c-3-9 5-14 10-10c3.5 3 1 8-3 7" fill="none" stroke="${LOCK}" stroke-width="5" stroke-linecap="round"/>
      ${cup(7)}${cup(96)}
      <ellipse cx="60" cy="61.5" rx="27" ry="27" fill="#fcd47e"/>
      <ellipse cx="49" cy="44" rx="8" ry="4" fill="#fff" opacity=".22" transform="rotate(-20 49 44)"/>
      <ellipse cx="40" cy="69" rx="4.6" ry="2.6" class="g-blush" fill-opacity=".4"/><ellipse cx="80" cy="69" rx="4.6" ry="2.6" class="g-blush" fill-opacity=".4"/>
      <g class="g-brows" fill="none" stroke="${MANE}" stroke-width="1.7" stroke-linecap="round" opacity=".8"><path d="M44 51.5q4.5-2.6 9-.8"/><path d="M67 50.7q4.5-1.8 9 .8"/></g>
      <g class="g-eyes">
        <g class="g-eyes-open">
          <ellipse cx="48.5" cy="59" rx="4.3" ry="5.2" fill="${MANE}"/><ellipse cx="71.5" cy="59" rx="4.3" ry="5.2" fill="${MANE}"/>
          <circle cx="50" cy="57" r="1.6" fill="#fff"/><circle cx="73" cy="57" r="1.6" fill="#fff"/>
        </g>
        <g class="g-eyes-happy" fill="none" stroke="${MANE}" stroke-width="2.6" stroke-linecap="round"><path d="M44 60.5q4.5-5.5 9 0"/><path d="M67 60.5q4.5-5.5 9 0"/></g>
        <g class="g-eyes-shut" fill="none" stroke="${MANE}" stroke-width="2.4" stroke-linecap="round"><path d="M44 59.5q4.5 4 9 0"/><path d="M67 59.5q4.5 4 9 0"/></g>
        <g class="g-x g-eyes-tiny" fill="${MANE}"><circle cx="48.5" cy="59" r="1.8"/><circle cx="71.5" cy="59" r="1.8"/></g>
        <g class="g-x g-shine" fill="#fff"><circle cx="46.4" cy="61.6" r="1.1"/><circle cx="69.4" cy="61.6" r="1.1"/><circle cx="51.2" cy="55.6" r=".8"/><circle cx="74.2" cy="55.6" r=".8"/></g>
      </g>
      <ellipse cx="60" cy="74" rx="10.5" ry="9" fill="${CREAM}"/>
      <path d="M56.6 69q3.4-1.5 6.8 0q-1.2 3.2-3.4 3.6q-2.2-.4-3.4-3.6z" fill="${MANE}"/>
      <path class="g-mouth-grin" d="M55 75.4q5 5.6 10 0z" fill="#7d2b3b" stroke="${MANE}" stroke-width="1.4" stroke-linejoin="round"/>
      <path class="g-mouth-w" d="M55.5 75.5q2.3 2.4 4.5-.3q2.2 2.7 4.5.3" fill="none" stroke="${MANE}" stroke-width="1.6" stroke-linecap="round"/>
      <path class="g-mouth-smile" d="M60 72.4v1.8M54.6 74q2.6 3.4 5.4 .4q2.8 3 5.4 -.4" fill="none" stroke="${MANE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="g-mouth-o"><ellipse cx="60" cy="77" rx="3" ry="2.7" fill="#7d2b3b"/><ellipse cx="60" cy="78.4" rx="2" ry="1.1" fill="#f27b8c"/></g>
      ${BIRD}
    </g>
    ${MEGA}
    ${paw(40, 'g-paw-l')}${paw(80, 'g-paw-r')}
    ${REPOST}
    <g class="g-rings"><path d="M4 53q-5 9 0 18"/><path d="M116 53q5 9 0 18"/></g>
    <g class="g-notes"><g class="g-note n1"><path d="M108 40v-9l6-2v9" fill="none" stroke="#2f6fde" stroke-width="1.6"/><circle cx="106.6" cy="40.5" r="2.2" fill="#2f6fde"/><circle cx="112.6" cy="38.5" r="2.2" fill="#2f6fde"/></g>
      <g class="g-note n2"><path d="M117 52v-8" fill="none" stroke="#2f6fde" stroke-width="1.6"/><circle cx="115.6" cy="52.5" r="2.2" fill="#2f6fde"/></g></g>
  </svg>`;

  const box = document.createElement('aside');
  box.className = 'ask pre';
  box.setAttribute('aria-label', 'Ask Lio about the paper');
  box.innerHTML = `
    <button class="ask-btn g-cub" type="button" aria-label="Ask Lio about the paper" aria-expanded="false">${CUB}<span class="g-hearts" aria-hidden="true"><i>♥</i><i>♥</i></span><span class="g-stars" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i></span><span class="g-burst" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i><i>✦</i></span><span class="g-quest" aria-hidden="true"><i>?</i></span></button>
    <div class="ask-card" role="dialog" aria-label="Ask Lio">
      <div class="ask-top"><span class="ask-tag">Ask Lio</span>
        <button class="ask-hide" type="button">Hide Lio</button>
        <button class="ask-close" type="button" aria-label="Close">${ICON('M6 6l12 12M18 6L6 18')}</button></div>
      <div class="ask-text"></div>
      <form class="ask-form" autocomplete="off">
        <input type="text" maxlength="200" placeholder="Ask a question…" aria-label="Ask a question about the paper">
        <button type="submit" aria-label="Ask">${ICON('M5 12h13M12 6l6 6-6 6')}</button>
      </form>
      <div class="ask-chips" aria-label="Example questions"></div>
      <p class="sr-only ask-live" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(box);

  const $ = s => box.querySelector(s);
  const btn = $('.ask-btn'), card = $('.ask-card'), tagEl = $('.ask-tag'), text = $('.ask-text');
  const form = $('.ask-form'), input = form.querySelector('input'), chips = $('.ask-chips'), live = $('.ask-live');
  const escHTML = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plain = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
  const wide = window.matchMedia('(min-width: 901px)');
  const eyes = $('.g-eyes'), head = $('.g-head');
  function flash(cls, ms) { box.classList.remove(cls); void box.offsetWidth; box.classList.add(cls); setTimeout(() => box.classList.remove(cls), ms); }

  // ---------- opening and closing ----------
  function setOpen(open) {
    box.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
    // each opening starts fresh: the last question and its answer are gone
    if (open) { qa = null; asking++; input.value = ''; intro(); fillChips(); input.focus({ preventScroll: true }); }
  }
  btn.addEventListener('click', () => {
    if (box.classList.contains('gone')) { setGone(false); flash('giggle', 900); return; }
    const open = !box.classList.contains('open'), first = !greeted; setOpen(open);
    if (open) { flash('giggle', 900); if (first && !U.reduced) flash('hello', 1300); }   // the first time, he waves hello
  });
  $('.ask-close').addEventListener('click', () => { setOpen(false); btn.focus(); });
  // Escape closes his card only when focus is in it (or nowhere): elsewhere it belongs to that control (search, menus)
  addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('open') && (box.contains(document.activeElement) || document.activeElement === document.body)) { setOpen(false); btn.focus(); } });

  // ---------- example questions for the section in view (js/qa-seeds.js) ----------
  const EXAMPLES = ['Where does the data come from?', 'Will the dataset be released?', 'Why only clips up to 30 s?'];
  const ALIAS = { 'model-fig': 'arch' }; // the suggestion lists predate the figure's current id
  function section() {
    const S = window.LIO_SUGGEST || {}, y = innerHeight * 0.42;
    let best = null, bestD = Infinity;
    for (const id of Object.keys(S)) {
      const node = id === 'head' ? document.querySelector('.head') : document.getElementById(ALIAS[id] || id);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }
  let chipsFor;
  function fillChips() {
    const id = section();
    chips.classList.toggle('on', !qa);
    if (id === chipsFor) return;
    chipsFor = id;
    const list = (id && window.LIO_SUGGEST[id]) || EXAMPLES;
    chips.innerHTML = list.slice(0, 3).map(q => `<button type="button">${escHTML(q)}</button>`).join('');
  }
  chips.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { input.value = b.textContent; ask(); } });

  // he introduces himself the first time the card opens; after that it starts with the question box
  let greeted = false;
  function intro() {
    tagEl.textContent = 'Ask Lio';
    text.innerHTML = greeted ? '' : "<p>Hi, I'm <b>Lio</b>! Ask me anything about the paper: the data, the scaling laws or the results.</p>";
    greeted = true;
  }

  // ---------- asking ----------
  let qa = null, asking = 0;
  form.addEventListener('submit', e => { e.preventDefault(); ask(); });
  async function ask() {
    const q = input.value.trim();
    if (!q) return;
    if (GO_AWAY.test(q)) { input.value = ''; goAway(); return; }
    const id = ++asking;
    chips.classList.remove('on');
    tagEl.textContent = 'Your question';
    text.innerHTML = `<p class="ask-q">“${escHTML(q)}”</p><p class="ask-hint">Hmm, let me look that up…</p>`;
    box.classList.add('thinking');
    let res;
    try {
      [res] = await Promise.all([window.LioQA.ask(q), new Promise(r => setTimeout(r, U.reduced ? 0 : 500))]);
    } catch (e) { res = { seed: null, error: true }; }
    box.classList.remove('thinking');
    if (id !== asking) return;
    qa = { q, seed: res.seed, error: res.error };
    input.value = '';
    render();
    // a ready answer makes him cheer, paws up with a burst of sparkles; without one he tilts his head, curious
    box.classList.remove('giggle', 'cheer', 'curious');
    if (res.seed) { flash('giggle', 1200); flash('cheer', 1300); } else flash('curious', 1800);
    if (!U.reduced) flash('talking', 1400);
  }

  // parts cited as "Page · …" jump to that part of the page (when it is on the page)
  const PAGE_PARTS = [
    [/^Page header/, 'top'], [/BibTeX/, 'bibtex'], [/Compared with Other Corpora/, 'compare'], [/Usage/, 'usage'],
    [/Scaling chart|Figure 3/, 'scale-fig'], [/Compute-optimal allocation/, 'alloc'], [/State of the Art/, 'sota-fig'],
    [/Compact Models/, 'table-fig'], [/Pipeline at a Glance/, 'flow'],
  ];
  // parts cited as "Paper · …" link into the PDF (js/paper-links.js)
  function citeHTML(cite) {
    const L = window.PAPER_LINKS, pdf = window.PAPER_PDF;
    return cite.split(/;\s*/).map(part => {
      const plain = escHTML(part);
      if (/^Page\b/.test(part)) {
        const hit = PAGE_PARTS.find(([re, id]) => re.test(part) && document.getElementById(id));
        return hit ? `<button type="button" class="ask-jump ask-pagelink" data-fig="${hit[1]}">${plain}</button>` : plain;
      }
      if (!L || !pdf || !/^Paper\b/.test(part)) return plain;
      const href = t => t.dest ? `${pdf}#nameddest=${t.dest}` : `${pdf}#page=${t.page}`;
      const a = (label, t) => t ? `<a href="${href(t)}" target="_blank" rel="noopener">${label}</a>` : label;
      let linked = 0;
      const out = plain
        .replace(/§(\d+(?:\.\d+)*)/g, (m, n) => { const t = L['§' + n] || L['§' + n.split('.')[0]]; if (t) linked++; return a(m, t); })
        .replace(/Appendix ([A-H](?:\.\d+)?)/g, (m, n) => { const t = L['Appendix ' + n] || L['Appendix ' + n[0]]; if (t) linked++; return a(m, t); })
        .replace(/(Table|Figure) (\d+)\b(?!\.\d)/g, m => { const t = L[m]; if (t) linked++; return a(m, t); })
        .replace(/Abstract/g, m => { const t = L[m]; if (t) linked++; return a(m, t); });
      // nothing named: fall back to the page number if there is one
      if (!linked) { const p = part.match(/p\. (\d+)/); if (p) return plain.replace(/p\. \d+/, a('p. ' + p[1], { page: +p[1] })); }
      return out;
    }).join('; ');
  }

  // ---------- every reply: hand the question to a general assistant ----------
  // the paper's public link, once there is one (js/paper-links.js); until then the project page
  const PAPER_PUBLIC_URL = window.PAPER_PDF && new URL(window.PAPER_PDF, 'https://projects.laion.ai/clap2/').href;
  // logos from Simple Icons (CC0), drawn in the brand colour
  const ASSISTANTS = [
    ['Claude', 'https://claude.ai/new?q=', '#d97757', 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'],
    ['ChatGPT', 'https://chatgpt.com/?q=', 'currentColor', 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'],
  ];
  const askPrompt = q => `I'm reading the paper "${document.title}" (${PAPER_PUBLIC_URL ? 'PDF: ' + PAPER_PUBLIC_URL : 'project page: https://projects.laion.ai/clap2/'}). Please answer my question based on the paper.\n\nQuestion: ${q}`;
  function assistantsHTML(q) {
    const enc = encodeURIComponent(askPrompt(q));
    return `<p class="ask-ext"><span>Let's ask:</span>${ASSISTANTS.map(([n, u, c, d]) =>
      `<a href="${u}${enc}" target="_blank" rel="noopener"><svg class="ask-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="${c}" d="${d}"/></svg>${n}</a>`).join('')}</p>`;
  }

  // is this answer shown somewhere on the page? Map what it cites (and says) to a figure.
  const STOP_RULES = [
    ['bibtex', /\b(bibtex|cite this|citation)\b/i],
    ['game', /\bretriev/i],
    ['alloc', /Compute-Optimal|allocat|C<sup>0\.5|C\^0\.5|budget/i],
    ['compare', /Table 1\b|other (audio–text )?(datasets|corpora)/i],
    ['table-fig', /Table 2\b|per domain|speech, music/i],
    ['arch', /Table 3\b|§4\b|NaFlex|model sizes?|parameters? (split|ratio)/i],
    ['scale-fig', /§5\b|Scaling Analysis|power law|doubling/i],
    ['sota-fig', /§6\b|HEAR|Pareto|MAEB-30/i],
    ['flow', /§3(\.\d)?\b|Figure 2\b|Appendix [ABC]\b|dedup|caption|taxonomy|collected|YouTube/i],
  ];
  function figFor(e) {
    if (!e) return null;
    const text = `${e.cite || ''} ${e.html || e.snippet || ''}`;
    for (const [id, re] of STOP_RULES) if (re.test(text) && document.getElementById(id)) return id;
    return null;
  }
  text.addEventListener('click', ev => {
    const j = ev.target.closest('.ask-jump');
    if (!j) return;
    document.getElementById(j.dataset.fig).scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth', block: 'start' });
    if (!wide.matches) setOpen(false); // on phones the card would cover the figure
  });

  function render() {
    const e = qa.seed;
    let html = `<p class="ask-q">“${escHTML(qa.q)}”</p>`;
    if (e) html += `<p class="ask-a">${e.html}</p>` + (e.cite && e.cite !== 'Lio' ? `<p class="ask-cite">${citeHTML(e.cite)}</p>` : '');
    else html += qa.error
      ? '<p>Oops, my notes got stuck for a second. Try again in a moment!</p>'
      : '<p>Ooh, good question! That one isn\'t in my notes yet. Try asking it another way, or ask Claude or ChatGPT below.</p>';
    const fig = figFor(e);
    if (fig) {
      const up = document.getElementById(fig).getBoundingClientRect().top < 0;
      html += `<p class="ask-jumpline"><button type="button" class="ask-jump" data-fig="${fig}">See it on the page ${up ? '↑' : '↓'}</button></p>`;
    }
    if (!qa.error) html += assistantsHTML(qa.q);
    text.innerHTML = html;
    live.textContent = plain(html);
  }

  // ---------- eyes follow the pointer; the idle fidgets below add a glance (pose.look) or a head tilt ----------
  let mouse = null, mouseAt = -Infinity;
  const pose = { look: [0, 0], tilt: 0 };
  // a finger on a touch screen is scrolling, not pointing: only a mouse or pen gets looked at
  addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; mouse = [e.clientX, e.clientY]; mouseAt = performance.now(); requestAnimationFrame(aim); }, { passive: true });
  function aim() {
    let ex = 0, ey = 0, hr = 0;
    if (mouse) {
      const a = btn.getBoundingClientRect();
      const dx = mouse[0] - (a.left + a.width / 2), dy = mouse[1] - (a.top + a.height * .5);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
      ex = dx / d * 2.4 * k; ey = dy / d * 2 * k; hr = dx / d * 5 * k;
    }
    eyes.style.transform = `translate(${(ex + pose.look[0]).toFixed(2)}px, ${(ey + pose.look[1]).toFixed(2)}px)`;
    head.style.transform = `rotate(${(hr + pose.tilt).toFixed(2)}deg)`;
  }
  // ---------- what the bubble says while he listens or is impressed: a different word each time ----------
  const SAY = {
    listen: ['♪ Listening', '♪ Ooh, nice', '♪ So good', '♪ Vibing', '♪ All ears', '♪ Tuned in', '♪ Love this one'],
    wow: ['Wow!', 'Whoa!', 'Ooh!', 'Neat!', 'Amazing!', 'So cool!', 'Look at that!'],
    bye: ['Bye!', 'See you!', 'Okay, bye!', 'Bye bye!'],
    eager: ['Got a question?', 'Ask me anything!', 'Curious? Ask me!', 'I know lots!', 'Try me! ✨', 'Psst… ask me!'],
    jam: ['♪ La la la', '♪ Doo-be-doo', '♪ Humming along', '♪ Tra la la'],
  };
  function say(kind) {
    const list = SAY[kind], last = btn.dataset[kind];
    let next;
    do next = list[Math.floor(Math.random() * list.length)]; while (next === last && list.length > 1);
    btn.dataset[kind] = next;
  }

  // ---------- listening: while a clip on the page plays, he nods along ----------
  // the players use detached `new Audio()` objects, so every media element is caught at play()
  const playing = new Set(), watched = new WeakSet();
  let quiet;
  function sync() {
    clearTimeout(quiet);
    // a short grace period, so switching clips (pause, new src, play) doesn't make him blink awake
    if (playing.size) { if (!box.classList.contains('listening')) say('listen'); box.classList.add('listening'); }
    else quiet = setTimeout(() => box.classList.remove('listening'), 250);
  }
  // only clips with at least a second left to play (a length not known yet counts as long)
  const long = m => !(m.duration - m.currentTime < 1);
  function watch(m) {
    if (watched.has(m)) return;
    watched.add(m);
    m.addEventListener('playing', () => { if (long(m)) playing.add(m); else playing.delete(m); sync(); });
    for (const ev of ['pause', 'ended', 'emptied', 'error']) m.addEventListener(ev, () => { playing.delete(m); sync(); });
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { watch(this); return play.apply(this, arguments); };
  document.addEventListener('play', e => { const m = e.target; if (m instanceof HTMLMediaElement) { watch(m); if (long(m)) { playing.add(m); sync(); } } }, true);

  // ---------- impressed: while a figure animation runs (U.busy in js/util.js), wide eyes and an "oh!" ----------
  // figures start and stop as they scroll in and out, so he only reacts to one still running after a moment,
  // and once impressed stays so for a bit: scrolling fast up and down doesn't flicker him in and out of it
  // A figure that impressed him once doesn't again for a couple of minutes (scrolling back past it, say)
  const running = new Set(), wowed = new Map(), WOW_IN = 450, WOW_HOLD = 1400, WOW_AGAIN = 120000;
  let wowT, wowAt = 0;
  document.addEventListener('figure-anim', e => {
    const { key, on, ms } = e.detail;
    if (on && ms >= 1000 && !(performance.now() - wowed.get(key) < WOW_AGAIN)) running.add(key); else running.delete(key);
    const wow = box.classList.contains('wow');
    clearTimeout(wowT);
    if (running.size && !wow) wowT = setTimeout(() => { say('wow'); box.classList.add('wow'); wowAt = performance.now(); running.forEach(k => wowed.set(k, wowAt)); }, WOW_IN);
    else if (!running.size && wow) wowT = setTimeout(() => box.classList.remove('wow'), Math.max(0, WOW_HOLD - (performance.now() - wowAt)));
  });

  // ---------- the end of the page: he waves and makes the case for reading the paper ----------
  const pitch = document.createElement('div');
  pitch.className = 'ask-pitch';
  pitch.setAttribute('role', 'status');
  pitch.innerHTML = `
    <button class="ask-close" type="button" aria-label="Close">${ICON('M6 6l12 12M18 6L6 18')}</button>
    <p><b>You made it to the end!</b> This page only shows the highlights. The paper has the rest: every curation step, all the scaling runs and the full benchmark tables.</p>
    <p class="ask-pitch-acts"><a class="ask-pitch-go" href="${window.PAPER_PDF}" target="_blank" rel="noopener" type="application/pdf">Read the full paper ↗</a></p>`;
  box.appendChild(pitch);
  // liked it? he hands over the share menu too (js/share.js)
  if (window.SHARE) {
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'ask-pitch-share';
    share.textContent = 'Share';
    window.SHARE.wire(share, window.SHARE.page);
    pitch.querySelector('.ask-pitch-acts').append(share);
  }
  let pitched = false; // once closed, followed or swapped for the card, he doesn't ask again this visit
  // he steps aside so he stands next to the footer's paper thumbnail rather than on it
  const thumb = document.querySelector('.paper-thumb');
  function walk(on) {
    let x = 0;
    if (on && thumb && innerWidth > 600) {
      const t = thumb.getBoundingClientRect(), b = btn.getBoundingClientRect();
      if (t.left < b.right && t.right > b.left) x = b.right - t.left + 16;
    }
    box.style.setProperty('--walk', -x + 'px');
  }
  function showPitch(on) {
    on = on && !pitched && !box.classList.contains('open') && !box.classList.contains('gone');
    if (on) walk(true);
    box.classList.toggle('pitch', on);
  }
  U.onWidth(() => { if (box.classList.contains('pitch')) walk(true); });
  const endPitch = () => { pitched = true; showPitch(false); };
  pitch.querySelector('.ask-close').addEventListener('click', () => { endPitch(); btn.focus(); });
  pitch.querySelector('.ask-pitch-go').addEventListener('click', () => { flash('giggle', 900); endPitch(); });
  btn.addEventListener('click', () => { if (box.classList.contains('pitch')) endPitch(); });
  // he speaks up once the BibTeX block scrolls in, and stays up through the footer
  const ends = ['#bibtex', 'footer'].map(q => document.querySelector(q)).filter(Boolean), atEnd = new Set();
  ends.forEach(el => U.watchView(el, v => { atEnd[v ? 'add' : 'delete'](el); showPitch(atEnd.size > 0); }, .1));

  // ---------- idle life: he blinks at random (now and then twice) and once in a long while does one small thing ----------
  (function blink() {
    setTimeout(() => {
      if (!U.reduced && !document.hidden) { flash('blink', 170); if (Math.random() < .15) setTimeout(() => flash('blink', 170), 260); }
      blink();
    }, 3500 + Math.random() * 4500);
  })();
  const has = c => box.classList.contains(c);
  const watching = () => performance.now() - mouseAt < 2500;   // eyes on the pointer: no glancing around
  let scrolledAt = -Infinity;   // the reader is scrolling or reading: he keeps still
  addEventListener('scroll', () => { scrolledAt = performance.now(); }, { passive: true });
  function posed(steps) {   // [[look, tilt, ms], …], then back to rest
    let t = 0;
    for (const [look, tilt, ms] of [...steps, [[0, 0], 0, 0]]) { setTimeout(() => { pose.look = look; pose.tilt = tilt; aim(); }, t); t += ms; }
  }
  // name: [weight, start]; a start returning false is skipped (and another one follows next time).
  // Mostly small ones (an ear flick, a look aside, a slow tilt); the bigger bits are rare treats
  const side = () => Math.random() < .5 ? -1 : 1;
  const FIDGETS = {
    twitch: [4, () => flash('twitch', 450)],
    ears: [2, () => flash('f-ears', 950)],
    glance: [4, () => { if (watching()) return false; const s = side(); posed([[[2 * s, .3], 0, 1100]]); }],
    tilt: [2.5, () => posed([[[0, -.3], 5 * side(), 1800]])],
    notice: [.8, () => { if (watching()) return false; posed([[[.6, -2.2], -2, 1300]]); flash('f-brows', 1300); }],
    smile: [1.5, () => flash('f-smile', 1600)],
    wiggle: [.6, () => flash('f-wiggle', 900)],
    hum: [.4, () => flash('f-hum', 2400)],
    phones: [.4, () => flash('f-phones', 1300)],
    drum: [.3, () => flash('f-drum', 1150)],
    wave: [.3, () => flash('f-wave', 1300)],
    bounce: [.2, () => flash('f-bounce', 1000)],
  };
  const BUSY = ['open', 'listening', 'wow', 'thinking', 'talking', 'jam', 'gone', 'bye', 'curious', 'cheer', 'hello', 'giggle', 'pitch', 'react'];
  // resting face: a content closed smile, relaxed eyes and soft cheeks whenever no mood, reaction or fidget that
  // changes his face is on (css: .rest). Ear and paw fidgets and blinks keep it, so his face doesn't flicker
  const FACE = ['eager', 'f-smile', 'f-hum', 'f-wave', 'f-bounce', 'f-brows'];
  const ACTIVE = c => FACE.includes(c) || /^(r|run)-/.test(c);
  const restFace = () => box.classList.toggle('rest', !BUSY.some(has) && ![...box.classList].some(ACTIVE));
  new MutationObserver(restFace).observe(box, { attributes: true, attributeFilter: ['class'] });
  restFace();
  let lastFidget;
  // one every 15 to 35 s; while the reader scrolls he waits until the page has been still for a few seconds
  (function fidget(ms) {
    setTimeout(() => {
      if (performance.now() - scrolledAt < 4000) return fidget(5000);
      if (!U.reduced && !document.hidden && !BUSY.some(has)) {
        const names = Object.keys(FIDGETS).filter(n => n !== lastFidget);
        let r = Math.random() * names.reduce((t, n) => t + FIDGETS[n][0], 0);
        const pick = names.find(n => (r -= FIDGETS[n][0]) < 0) || names[0];
        if (FIDGETS[pick][1]() !== false) lastFidget = pick;
      }
      fidget(15000 + Math.random() * 20000);
    }, ms);
  })(15000 + Math.random() * 20000);

  // ---------- reactions: sharing the page or switching light/dark mode gets a short bit from him, one of three
  // at random (never the same twice in a row). Theme lines are [to light, to dark, extra]; share lines [line, extra] ----------
  const REACT_MS = 2400;
  const REACTS = {
    theme: {
      orb: ['Good morning!', 'Hello, moon!', () => posed([[[-2.4, -1], -3, 500], [[0, -2.6], 0, 700], [[2.4, -1], 3, 800]])],
      rub: ['Whoa, bright!', 'Eyes adjusting…', () => { setTimeout(() => flash('blink', 170), 1950); setTimeout(() => flash('blink', 170), 2200); }],
      pupils: ['So bright!', 'Ooh, cozy ✨'],
    },
    share: {
      bird: ['Tweet tweet!', () => posed([[[0, -2.6], 0, 1900]])],
      repost: ['Repost!'],
      mega: ['Tell everyone!', () => posed([[[1, 0], -4, 1900]])],
    },
  };
  const lastReact = {};
  let reactT;
  function react(kind) {
    if (has('gone')) return;
    const root = document.documentElement;
    const dark = kind === 'theme' && (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    const names = Object.keys(REACTS[kind]).filter(n => n !== lastReact[kind]);
    const name = lastReact[kind] = names[Math.floor(Math.random() * names.length)];
    const [a, b, c] = REACTS[kind][name], run = kind === 'theme' ? c : b;
    clearTimeout(reactT);
    box.classList.remove('jam', 'react', ...[...box.classList].filter(k => k.startsWith('r-')));
    void box.offsetWidth;   // restart the animations if one was still playing
    btn.dataset.react = dark ? b : a;
    box.classList.toggle('to-dark', dark);
    box.classList.add('react', 'r-' + name);
    if (!U.reduced && run) run(dark);
    reactT = setTimeout(() => box.classList.remove('react', 'r-' + name), REACT_MS);
  }
  addEventListener('themechange', () => react('theme'));
  document.addEventListener('page-share', () => react('share'));

  // the example questions follow the section being read while the card is open
  addEventListener('scroll', () => { if (box.classList.contains('open') && !qa) fillChips(); }, { passive: true });

  // ---------- the nodding and hopping loops only run while they show, plus a moment to ease out (css/ask.css) ----------
  const RUN = { 'run-nod': ['listening', 'talking', 'f-hum', 'jam'], 'run-hop': ['wow'] }, stopRun = {};
  new MutationObserver(() => {
    for (const [run, states] of Object.entries(RUN)) {
      const on = states.some(s => box.classList.contains(s)), has = box.classList.contains(run);
      if (on) { clearTimeout(stopRun[run]); stopRun[run] = 0; if (!has) box.classList.add(run); }
      else if (has && !stopRun[run]) stopRun[run] = setTimeout(() => { stopRun[run] = 0; box.classList.remove(run); }, 700);
    }
  }).observe(box, { attributes: true, attributeFilter: ['class'] });

  // ---------- eager: the reader has seen most of the page without asking him anything, so he perks up and offers to help ----------
  // The page is cut into 100 slices; twice a second the slices on screen count as seen, but only once the
  // view has stayed roughly still for a second (less than half a screen per look, two looks in a row), so
  // flicking past doesn't count, and slices seen before don't count again, so scrolling up and down doesn't either.
  const EAGER_AT = .7, SLICES = 100;   // he perks up once 70% of the page has been seen
  const seen = new Uint8Array(SLICES);
  let seenN = 0, lookY = scrollY, still = 0, asked = false;
  const look = setInterval(() => {
    if (asked) { clearInterval(look); return; }
    const moved = Math.abs(scrollY - lookY);
    lookY = scrollY;
    still = moved > innerHeight / 2 ? 0 : still + 1;
    if (document.hidden || still < 2) return;
    const H = document.documentElement.scrollHeight;
    const a = Math.floor(scrollY / H * SLICES), b = Math.min(SLICES, Math.ceil((scrollY + innerHeight) / H * SLICES));
    for (let i = Math.max(0, a); i < b; i++) if (!seen[i]) { seen[i] = 1; seenN++; }
    if (seenN >= EAGER_AT * SLICES && !['open', 'gone'].some(c => box.classList.contains(c))) {
      clearInterval(look);
      say('eager'); box.classList.add('eager');
    }
  }, 500);
  // once he's been clicked or asked, he's done offering for the rest of the visit
  const heard = () => { asked = true; box.classList.remove('eager'); };
  btn.addEventListener('click', heard);
  form.addEventListener('submit', heard);

  // ---------- jamming: after two minutes without the reader doing anything he hums a tune to himself, eyes happy,
  // nodding along; any activity and he's all ears again ----------
  const IDLE_MS = 120000;
  let idle;
  function rest() {
    clearTimeout(idle);
    idle = setTimeout(() => {
      // not while he's busy, talking to the reader or hiding
      if (['open', 'listening', 'wow', 'thinking', 'gone', 'bye'].some(c => box.classList.contains(c))) rest();
      else { say('jam'); box.classList.add('jam'); }
    }, IDLE_MS);
  }
  function wake() {
    if (box.classList.contains('jam')) { box.classList.remove('jam'); if (!U.reduced) flash('f-wiggle', 900); }
    rest();
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) addEventListener(ev, wake, { passive: true, capture: true });
  rest();

  // ---------- go away: asked to leave (typed, or "Hide Lio"), he waves bye and sinks below the edge until only
  // his ears peek out; tapping them brings him back. Remembered for the rest of the visit ----------
  // the whole message has to be the request, so questions like "Leave-one-out results?" or "Hide speech?" still get answers
  const GO_AWAY = /^\s*(please\s+)?(go away|leave( me alone)?|bye|good ?bye|hide|shoo|get lost|disappear|go home|be quiet)(\s+(now|lio|please))*[\s.!]*$/i;
  let leaving;
  function goAway() {
    clearTimeout(leaving);
    chips.classList.remove('on');
    live.textContent = 'Lio is hidden. Tap his ears at the bottom of the screen to bring him back.';
    const hadFocus = box.contains(document.activeElement);
    setOpen(false);
    if (hadFocus) btn.focus({ preventScroll: true });   // focus stays on his ears instead of falling back to the page top
    box.classList.remove('eager', 'jam');
    say('bye');
    box.classList.add('bye');
    leaving = setTimeout(() => { box.classList.remove('bye'); setGone(true); }, U.reduced ? 600 : 1300);
  }
  function setGone(on) {
    box.classList.toggle('gone', on);
    if (on) box.classList.remove('pitch');
    btn.setAttribute('aria-label', on ? 'Bring Lio back' : 'Ask Lio about the paper');
    try { if (on) sessionStorage.setItem('lio-gone', '1'); else sessionStorage.removeItem('lio-gone'); } catch (e) {}
  }
  $('.ask-hide').addEventListener('click', goAway);
  try { if (sessionStorage.getItem('lio-gone')) setGone(true); } catch (e) {}
  setTimeout(() => box.classList.remove('pre'), U.reduced ? 0 : 400);
})();
