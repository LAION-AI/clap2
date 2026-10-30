/* ================= listening game: real retrieval queries from the MAEB test sets ================= */
// Each round is one example from DATA.retrieval: the query, and as options the correct item plus the
// wrong items the models put first. The reader picks one; then the models' ranks are shown.
(function game() {
  const R = window.DATA.retrieval;
  const body = document.getElementById('gm-body');
  const score = document.getElementById('gm-score');

  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  const BARS = 40;
  const fmtN = n => n.toLocaleString('en-US');
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // one audio element for the game; starting a clip stops the previous one
  const audio = new Audio();
  audio.preload = 'none';
  let playing = null;
  function stop() {
    if (!playing) return;
    audio.pause();
    playing.btn.innerHTML = ICON_PLAY;
    playing.btn.setAttribute('aria-label', playing.label);
    playing.box.classList.remove('playing');
    playing.box.style.setProperty('--p', 0);
    playing = null;
  }
  audio.addEventListener('ended', stop);
  U.solo(audio, stop);
  audio.addEventListener('timeupdate', () => {
    if (playing && audio.duration) playing.box.style.setProperty('--p', audio.currentTime / audio.duration);
  });

  // play button and waveform drawn from the clip itself
  function clip(src, label) {
    const box = el('div', 'rt-clip');
    const btn = el('button', 'rt-play');
    btn.type = 'button';
    btn.innerHTML = ICON_PLAY;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => {
      if (playing && playing.btn === btn) { stop(); return; }
      stop();
      audio.src = src;
      audio.play().catch(stop);
      playing = { btn, box, label };
      btn.innerHTML = ICON_PAUSE;
      btn.setAttribute('aria-label', 'Pause');
      box.classList.add('playing');
    });
    const svg = U.el('svg', { class: 'rt-wave', viewBox: `0 0 ${BARS * 4} 24`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const rects = Array.from({ length: BARS }, (_, i) => U.el('rect', { x: i * 4, y: 11, width: 2.4, height: 2, rx: 1.2 }, svg));
    U.audioPeaks(src, BARS).then(pk => pk.forEach((p, i) => {
      const h = Math.max(2, p * 22);
      rects[i].setAttribute('y', 12 - h / 2);
      rects[i].setAttribute('height', h);
    })).catch(() => {});
    box.append(btn, svg);
    return box;
  }

  // the correct item plus each model's wrong first pick, without repeats, in random order
  function options(ex) {
    const t2a = ex.dir === 't2a';
    const seen = new Set([ex.target]);
    const opts = [{ v: ex.target, ok: true }];
    R.models.forEach(m => {
      const t = ex.top[m.id], v = t2a ? t.src : t.text;
      if (v && !seen.has(v)) { seen.add(v); opts.push({ v, ok: false }); }
    });
    return shuffle(opts);
  }

  const ours = R.models.find(m => m.ours);
  let rounds, at, you, clap;

  function setScore() {
    score.innerHTML = at < rounds.length
      ? `<span>Round <b>${at + 1}</b>/${rounds.length}</span><span>You <b>${you}</b></span><span class="ours">CLAP2 <b>${clap}</b></span>`
      : '';
  }

  function round() {
    stop();
    setScore();
    const ex = rounds[at], t2a = ex.dir === 't2a';
    const cat = R.categories.find(c => c.id === ex.cat);
    body.innerHTML = '';
    const [ds] = ex.source.split(', ');
    const k = el('p', 'gm-k');
    k.innerHTML = `${cat.short || cat.name} · ${U.modelLink(ds)}${ex.source.slice(ds.length)}`;
    body.append(k, el('p', 'gm-ask', t2a ? 'Which clip matches this text?' : 'Which line is being sung?'));
    const q = el('div', 'gm-q');
    if (t2a) q.append(el('p', 'gm-query', `“${ex.query}”`));
    else { const c = clip(ex.query, 'Play the sung line'); c.classList.add('gm-qclip'); q.append(c); }
    body.append(q);

    const list = el('div', 'gm-opts');
    const opts = options(ex);
    const cards = opts.map((o, i) => {
      const letter = 'ABC'[i];
      const card = el('div', 'gm-opt');
      const pick = el('button', 'gm-pick');
      pick.type = 'button';
      if (t2a) {
        card.append(el('span', 'gm-l', letter), clip(o.v, `Play clip ${letter}`), pick);
        pick.textContent = 'Pick';
        pick.setAttribute('aria-label', `Pick clip ${letter}`);
      } else {
        // a lyric: the whole card is the button
        card.classList.add('txt');
        pick.append(el('span', 'gm-l', letter), el('span', 'gm-lyric', o.v));
        card.append(pick);
      }
      pick.addEventListener('click', () => reveal(ex, opts, cards, i));
      list.append(card);
      return card;
    });
    body.append(list);
  }

  function reveal(ex, opts, cards, chosen) {
    const right = opts[chosen].ok;
    if (right) you++;
    if (ex.top[ours.id].rank === 1) clap++;
    setScore();
    cards.forEach((c, i) => {
      c.classList.add(opts[i].ok ? 'right' : i === chosen ? 'wrong' : 'dim');
      c.querySelector('.gm-pick').disabled = true;
    });
    const res = el('div', 'gm-res');
    res.append(el('p', 'gm-verdict ' + (right ? 'yes' : 'no'), right ? 'Correct!' : 'Not this one.'));
    // where each model ranked the correct item among the whole test set
    const ranks = el('ul', 'gm-ranks');
    R.models.forEach(m => {
      const r = ex.top[m.id].rank;
      const li = el('li', (m.ours ? 'ours ' : '') + (r === 1 ? 'top' : 'miss'));
      li.innerHTML = `<span>${m.ours ? 'CLAP2' : m.name}</span><b>#${fmtN(r)}</b>`;
      ranks.append(li);
    });
    res.append(el('p', 'gm-k', `Rank of the correct item${ex.pool ? ` among ${fmtN(ex.pool)}` : ''}:`), ranks);
    if (ex.note) res.append(el('p', 'gm-note', ex.note));
    const last = at === rounds.length - 1;
    const next = el('button', 'gm-next', last ? 'See result' : 'Next round');
    next.type = 'button';
    next.addEventListener('click', () => { at++; last ? end() : round(); body.querySelector('button')?.focus({ preventScroll: true }); });
    res.append(next);
    body.append(res);
    next.focus({ preventScroll: true });
  }

  function end() {
    stop();
    setScore();
    body.innerHTML = '';
    const n = rounds.length;
    const done = el('div', 'gm-end');
    done.innerHTML = `<p class="gm-final"><span>You <b>${you}</b>/${n}</span><span class="ours">CLAP2 <b>${clap}</b>/${n}</span></p>
      <p class="gm-ask">${you > clap ? 'You beat it. Sharp ears!' : you === clap ? 'A draw with the model.' : 'The model wins this time.'}</p>
      <p class="gm-note">Real queries from the MAEB test sets, hand-picked and failure cases included. Each model ranked the full test set; the options here are only the correct item and the models' wrong first picks.</p>`;
    const again = el('button', 'gm-next', 'Play again');
    again.type = 'button';
    again.addEventListener('click', start);
    const acts = el('div', 'gm-acts');
    acts.append(again);
    if (window.SHARE) {
      const share = el('button', 'gm-next gm-share', 'Share your score');
      share.type = 'button';
      window.SHARE.wire(share, () => window.SHARE.score(you, clap, n));
      acts.append(share);
    }
    done.append(acts);
    body.append(done);
  }

  function start() {
    // the first round is always a sound example; the rest come shuffled
    const [first, ...rest] = R.examples;
    rounds = [first, ...shuffle(rest.slice())];
    at = 0; you = 0; clap = 0;
    round();
  }
  start();
})();
