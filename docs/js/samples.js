/* ================= training samples: a shuffle wall of clips, and one clip's captions and stored metadata ================= */
(function samples() {
  const S = window.DATA.samples;
  const wall = document.getElementById('wall');
  const shuffleBtn = document.getElementById('wall-shuffle');
  const card = document.getElementById('smp');
  if (!S || !card) return;

  const NAMES = { sound: 'Sound', music: 'Music', speech: 'Speech' };
  const COLORS = { sound: 'var(--sfx)', music: 'var(--music)', speech: 'var(--speech)' };
  const WALL_N = 6;   // cards shown at once
  const LANGS = { fij: 'Fijian', ja: 'Japanese', en: 'English', de: 'German', fr: 'French', es: 'Spanish' };
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  const BARS = 72;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = p => (p * 100 >= 10 ? Math.round(p * 100) : (p * 100).toFixed(1)) + '%';
  const time = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const words = t => t.trim().split(/\s+/).length;
  const kHz = hz => (hz / 1000).toFixed(1) + ' kHz';

  // one audio element for the wall and the detail card; nothing loads until a clip is played
  const audio = new Audio();
  audio.preload = 'none';
  let owner = null;   // { src, on(), off() } of whatever is playing
  function play(src, on, off) {
    if (owner && owner.src === src && !audio.paused) { audio.pause(); return; }
    audio.pause();
    owner = { src, on, off };
    audio.src = src;
    audio.play().catch(() => {});
  }
  U.solo(audio);
  audio.addEventListener('play', () => owner && owner.on());
  ['pause', 'ended'].forEach(ev => audio.addEventListener(ev, () => owner && owner.off()));
  audio.addEventListener('timeupdate', () => owner && owner.tick && owner.tick());

  // label, confidence bar and percentage; the first row of a list is highlighted
  const bars = (rows, cls = '') => `<ul class="smp-bars ${cls}">${rows.map(([n, p], i) =>
    `<li${i ? '' : ' class="lead"'}><span>${esc(n)}</span><i style="--f:${p.toFixed(3)}"></i><b>${pct(p)}</b></li>`).join('')}</ul>`;
  const item = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;

  // every clip gets the same boxes in the same places; tags a clip doesn't have show as a dash
  const NA = '<span class="smp-na">—</span>';
  function metaBoxes(m) {
    const path = m.tax_l3.split('/');
    const top3 = m.tax_l1_top3.slice(0, 3);
    while (top3.length < 3) top3.push(null);   // keep three rows so the box height never changes
    const catRows = `<ul class="smp-bars">${top3.map((r, i) => r
      ? `<li${i ? '' : ' class="lead"'}><span>${esc(r[0])}</span><i style="--f:${r[1].toFixed(3)}"></i><b>${pct(r[1])}</b></li>`
      : '<li class="empty" aria-hidden="true"><span>—</span></li>').join('')}</ul>`;
    const category = `<div class="smp-sec"><h4>Category</h4>${catRows}<p class="smp-path">${path.map(esc).join('<span>›</span>')} <em>${pct(m.tax_l3_prob)}</em></p><p class="smp-by">by an MLP on ${U.modelLink('Dasheng-0.6B')} features</p></div>`;
    const sp = !!m.lang_id, mu = !!m.maest_tags;
    let domain;
    if (sp) domain = `<div class="smp-sec"><h4>Speech</h4><dl class="smp-kv">${
      item('Language', `${esc(LANGS[m.lang_id] || m.lang_id)} <em>${pct(m.lang_prob)}</em>`)}${
      item('Speaker', `${esc(m.gender)}, about ${Math.round(m.age)}`)}${
      item('Emotion', esc(m.emo_label))}${item('Pitch', Math.round(m.pitch_hz) + ' Hz')}</dl><p class="smp-by">by ${[...['MMS-LID-4017', 'emotion2vec+ large', 'wav2vec2 age & gender'].map(n => U.modelLink(n, esc(n))), U.modelLink('CREPE pitch', 'CREPE')].join(', ')}</p></div>`;
    else if (mu) domain = `<div class="smp-sec"><h4>Music</h4><dl class="smp-kv">${
      item('Genre', `${esc(m.maest_tags[0].split('---').pop())} <em>${pct(m.maest_probs[0])}</em>`)}${
      item('Also', m.maest_tags.slice(1, 3).map(t => esc(t.split('---').pop())).join(', '))}${
      item('Tempo', Math.round(m.tempo_bpm) + ' BPM')}${item('Key', esc(m.music_key))}</dl><p class="smp-by">by ${U.modelLink('MAEST')} (genre), librosa (tempo, key)</p></div>`;
    else domain = `<div class="smp-sec off"><h4>Speech or music</h4><p class="smp-none">No speech or music tags: the clip is neither.</p></div>`;
    const signal = `<div class="smp-sec"><h4>Signal</h4><dl class="smp-kv">${item('Sample rate', `${m.sr_orig / 1000} kHz → 32 kHz mono`)}${item('Loudness', `RMS ${m.rms_db.toFixed(1)} dB, peak ${m.peak_db.toFixed(1)} dB`)}${item('Bandwidth', kHz(m.bandwidth_hz))}${item('Spectral centroid', kHz(m.spectral_centroid_hz))}${item('Silence', m.silence_pct + '%')}${item('Clipping', m.clip_pct + '%')}</dl><p class="smp-by">computed from the waveform</p></div>`;
    return { category, domain, signal };
  }

  function show(s, measuring) {
    audio.pause();
    if (!measuring) shown = s;
    const m = s.meta;
    const yt = `https://www.youtube.com/watch?v=${encodeURIComponent(m.youtube_id)}&t=${Math.floor(m.start_sec)}s`;
    const by = `<a class="mlink" href="https://huggingface.co/${esc(m.captioning_model)}" target="_blank" rel="noopener">${esc(m.captioning_model.split('/').pop())}</a>`;
    const box = metaBoxes(m);
    card.innerHTML = `
      <div class="smp-player">
        <button type="button" class="smp-play" aria-label="Play clip">${ICON_PLAY}</button>
        <div class="smp-wave"><svg viewBox="0 0 ${BARS * 4} 40" preserveAspectRatio="none" aria-hidden="true"></svg></div>
        <span class="smp-time"><span>0:00</span> / ${time(m.duration)}</span>
        <a class="smp-src" href="${yt}" target="_blank" rel="noopener" title="Source on YouTube: ${esc(m.youtube_title)}, ${time(m.start_sec)}–${time(m.end_sec)}" aria-label="Source on YouTube: ${esc(m.youtube_title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>
      </div>
      <div class="smp-body">
        <div class="smp-grid">
          <div class="smp-col">
          <div class="smp-sec smp-short"><h4>Short caption <span>${words(m.short_caption)} words</span></h4><p>${esc(m.short_caption)}</p><p class="smp-by">by ${by}</p></div>
          <div class="smp-sec smp-cap"><h4>Long caption <span>${words(m.long_caption)} words</span></h4><p class="smp-long">${esc(m.long_caption)}</p><p class="smp-by">by ${by}</p></div>
          ${box.category}
          </div>
          <div class="smp-col">${box.domain}${box.signal}</div>
        </div>
      </div>`;

    U.clampText(card.querySelector('.smp-long'));
    if (!measuring) sizeBoxes();

    // waveform from the clip
    const svg = card.querySelector('.smp-wave svg');
    const rects = Array.from({ length: BARS }, (_, i) => U.el('rect', { x: i * 4, y: 19, width: 2.6, height: 2, rx: 1.3 }, svg));
    if (!measuring) U.audioPeaks(s.src, BARS).then(pk => pk.forEach((p, i) => {
      const h = Math.max(2, p * 38);
      rects[i].setAttribute('y', 20 - h / 2);
      rects[i].setAttribute('height', h);
    })).catch(() => {});

    const btn = card.querySelector('.smp-play'), player = card.querySelector('.smp-player');
    const now = card.querySelector('.smp-time span');
    btn.onclick = () => {
      play(s.src,
        () => { btn.innerHTML = ICON_PAUSE; btn.setAttribute('aria-label', 'Pause clip'); player.classList.add('playing'); },
        () => { btn.innerHTML = ICON_PLAY; btn.setAttribute('aria-label', 'Play clip'); player.classList.remove('playing'); });
      owner.tick = () => {
        now.textContent = time(audio.currentTime);
        player.style.setProperty('--p', audio.duration ? audio.currentTime / audio.duration : 0);
      };
    };
  }

  // the wall: up to WALL_N clip cards; Shuffle draws a new random set when there are more clips than that
  let shown = null, cards = [];
  // the card is as tall as its tallest clip, so switching clips never moves the page below it;
  // each clip is rendered once without loading audio to measure it
  let listed = [];
  let boxH = [];
  function sizeBoxes() {
    card.querySelectorAll('.smp-sec').forEach((b, i) => { b.style.minHeight = boxH[i] ? boxH[i] + 'px' : ''; });
  }
  function reserve() {
    if (!listed.length || card.offsetParent === null) return;
    card.style.minHeight = '';
    boxH = [];
    let h = 0;
    listed.forEach(x => {
      show(x, true);
      card.querySelectorAll('.smp-sec').forEach((b, i) => { boxH[i] = Math.max(boxH[i] || 0, b.offsetHeight); });
    });
    show(shown || listed[0]);
    h = card.offsetHeight;
    card.style.minHeight = h + 'px';
  }
  U.onWidth(reserve);

  function pick(s) {
    show(s);
    cards.forEach(c => { const on = c.s === s; c.li.classList.toggle('sel', on); c.pickBtn.setAttribute('aria-pressed', on); });
  }
  function fill(list) {
    audio.pause();
    wall.innerHTML = '';
    cards = list.map(s => {
      const m = s.meta;
      const li = document.createElement('li');
      li.style.setProperty('--cat', COLORS[s.cat] || 'var(--other)');
      li.innerHTML = `<button type="button" class="wall-pick" aria-pressed="false"><i aria-hidden="true"></i>${NAMES[s.cat] || esc(m.tax_l1)}</button>`;
      const pickBtn = li.querySelector('.wall-pick');
      pickBtn.title = `${time(m.duration)} · ${m.short_caption}`;
      pickBtn.addEventListener('click', () => pick(s));
      wall.appendChild(li);
      return { s, li, pickBtn };
    });
    listed = list;
    shown = null;
    pick(list[0]);
    reserve();
  }
  function shuffled() {
    const a = S.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, WALL_N);
  }
  shuffleBtn.addEventListener('click', () => fill(shuffled()));
  // the first sound clip leads, matching the caption card in the pipeline figure
  const featured = S.find(s => s.cat === 'sound') || S[0];
  const start = () => [featured, ...S.filter(s => s !== featured)].slice(0, WALL_N);
  let built = false;   // built on first open, so a collapsed row downloads nothing

  // the samples stay collapsed behind one panel until opened from the panel, and collapse back from the bar above the card
  const body = document.getElementById('smp-body'), openBtn = document.getElementById('smp-open');
  const row = document.getElementById('sample');
  function setOpen(open, scroll) {
    if (open && !built) { built = true; fill(start()); }
    // keep the row where it is on screen: the panel turns into a much taller card, and some browsers
    // otherwise hold the content below in place and scroll past the card
    const before = row.getBoundingClientRect().top;
    body.hidden = !open;
    wall.hidden = !open;
    openBtn.hidden = open;
    shuffleBtn.hidden = !open || S.length <= WALL_N;
    openBtn.setAttribute('aria-expanded', open);
    if (open) reserve();
    if (!open) audio.pause();
    if (open && scroll) row.scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth', block: 'start' });
    else { const shift = row.getBoundingClientRect().top - before; if (shift) scrollBy({ top: shift, behavior: 'instant' }); }
  }
  openBtn.addEventListener('click', () => setOpen(true));
  // collapse back to the panel, keeping the row in view
  document.getElementById('smp-collapse').addEventListener('click', () => {
    setOpen(false);
    openBtn.focus({ preventScroll: true });
    if (row.getBoundingClientRect().top < 0) row.scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth', block: 'start' });
  });
})();
