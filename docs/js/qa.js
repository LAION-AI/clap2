// Ask Lio: finds the passages of the paper that best match a reader's question, cited as
// "Paper · §3.2 Title · p. 4".
// Runs in the browser with no server. The passages come from js/qa-index.js (phones) or
// js/qa-index-full.js (wider screens: adds table rows), both built by tools/build_qa_index.py
// and loaded on the first question.
//  1. The question: reader shorthand normalised ("avg", "yt", "1e12", "16x16", "maeb30", British
//     spellings), spelling correction against the documents' words (common English words are left
//     alone), chat filler dropped, acronym and reader-to-paper synonym expansion.
//  2. First stage: BM25F over passage text and section titles with a Porter stemmer and small
//     priors (main text over appendix, own results over related work).
//  3. Second stage: the best 30 are re-scored by how much of the question one or two adjacent
//     sentences cover and, for "how many" questions, by a number next to the word asked about.
//     On the desktop index a table row named by the question with a column it names
//     ("M's music score") answers with one cell.
//  4. A weak match is refused rather than shown (coverage of the question, unknown words).
//  5. Hand-written answers (js/qa-seeds.js, checked against the PDFs) cover common questions;
//     the matching one also steers retrieval towards the passages that back it up. An answer must
//     give the kind of thing asked for ("how many X": a number and X; "what share": a percentage),
//     and one written for "what is X" does not answer a question about something else as well.
//     Table rows answer only questions their table covers (catalogue rows: questions about sources).
// Snippets are the sentences that cover the question (and hold the number asked for).
// Quality is measured with tools/qa_eval.js; parameters are tuned with tools/qa_tune.js.
window.LioQA = (() => {
  // ---------- words ----------
  const STOP = new Set((('a an the of to in on for and or is are was were be been being it its this that these those what which who whom whose how why ' +
    'when where do does did done doing have has had having can could would should will shall may might must with by from as at into about than then there their they ' +
    'them we our ours you your yours i me my mine he she his her so if not no yes vs per via also just any some much many more most such very ' +
    'tell explain lio please paper papers thesis work works working get got give gives know want like use used using us one ones thing things way ' +
    'kind sort really actually exactly anything something everything happen happens let lets say says said make makes made need needs ' +
    'here other others own same well even still only each every both either neither again ever way ways good bad better best ' +
    'gave given giving take takes took taken taking go goes went gone going put puts become became whats hows wheres whos ' +
    'myself yourself itself themselves ourselves himself herself ' +
    'show shows showed shown see seen look looks find told stand stands think thought means meant ' +
    // chat filler: "so where did u get 1 billion audio files from lol", "ok cool"
    'ok okay cool lol haha nice wow hmm um uh pls plz thx btw guys hey yeah yep nope cheers awesome great sure hi hello thanks thank u ur r ya').split(' ')));
  // (the last few, "good", "best", ..., matter for the hand-written answers, which see all words)
  // Greek letters by name, so "alpha" finds "α = 0.0603" and "tau" Kendall's "τ"
  const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', η: 'eta', θ: 'theta', λ: 'lambda', μ: 'mu', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', ω: 'omega' };
  const words = s => (s.toLowerCase().replace(/[αβγδεηθλμρστφω]/g, c => ' ' + GREEK[c] + ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\^\{|_\{|\}/g, '').replace(/%/g, ' percent ').replace(/(\w)['’]s\b/g, '$1').match(/[a-z0-9]+/g) || []);

  // Porter (1980) stemmer, compact
  const stem = (() => {
    const c = '[^aeiou]', v = '[aeiouy]', C = c + '[^aeiouy]*', V = v + '[aeiou]*';
    const gt0 = new RegExp('^(' + C + ')?' + V + C), eq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$'),
      gt1 = new RegExp('^(' + C + ')?' + V + C + V + C), hasV = new RegExp('^(' + C + ')?' + v);
    const S2 = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
      ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' };
    const S3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
    const re2 = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
    const re3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
    const re4 = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
    // words Porter would merge with unrelated ones ("optimizer" and "optimal" both become "optim")
    const cache = new Map(Object.entries({
      optimizer: 'optimizer', optimizers: 'optimizer', optimiser: 'optimizer', optimisers: 'optimizer',
      optimal: 'optimal', optimum: 'optimal', optima: 'optimal', optimally: 'optimal',
      general: 'general', generally: 'general', generalize: 'generaliz', generalization: 'generaliz',
      universal: 'universal', university: 'university', news: 'news', params: 'paramet', param: 'paramet',
    }));
    return w => {
      if (w.length < 3 || /\d/.test(w)) return w;
      if (cache.has(w)) return cache.get(w);
      let s = w, m;
      const y = s[0] === 'y';
      if (y) s = 'Y' + s.slice(1);
      if (/sses$|ies$/.test(s)) s = s.slice(0, -2); else if (/[^s]s$/.test(s)) s = s.slice(0, -1);
      if ((m = /^(.+?)eed$/.exec(s))) { if (gt0.test(m[1])) s = s.slice(0, -1); }
      else if ((m = /^(.+?)(ed|ing)$/.exec(s)) && hasV.test(m[1])) {
        s = m[1];
        if (/(at|bl|iz)$/.test(s)) s += 'e';
        else if (/([^aeiouylsz])\1$/.test(s)) s = s.slice(0, -1);
        else if (new RegExp('^' + C + v + '[^aeiouwxy]$').test(s)) s += 'e';
      }
      if ((m = /^(.+?)y$/.exec(s)) && hasV.test(m[1])) s = m[1] + 'i';
      if ((m = re2.exec(s)) && gt0.test(m[1])) s = m[1] + S2[m[2]];
      if ((m = re3.exec(s)) && gt0.test(m[1])) s = m[1] + S3[m[2]];
      if ((m = re4.exec(s))) { if (gt1.test(m[1])) s = m[1]; }
      else if ((m = /^(.+?)(s|t)(ion)$/.exec(s)) && gt1.test(m[1] + m[2])) s = m[1] + m[2];
      if ((m = /^(.+?)e$/.exec(s)) && (gt1.test(m[1]) || (eq1.test(m[1]) && !new RegExp('^' + C + v + '[^aeiouwxy]$').test(m[1])))) s = m[1];
      if (/ll$/.test(s) && gt1.test(s)) s = s.slice(0, -1);
      if (y) s = 'y' + s.slice(1);
      cache.set(w, s);
      return s;
    };
  })();
  // "emotion2vec" and "qwen3" also count as "emotion" and "qwen"
  // ... and "ModernBERT" also as "BERT"
  const tokens = s => words(s.replace(/([a-z])([A-Z]{3,})\b/g, '$1$2 $2')).flatMap(w => (/^[a-z]{4,}\d/.test(w) ? [w, w.match(/^[a-z]+/)[0]] : [w])).filter(w => !STOP.has(w)).map(stem);
  const sentences = t => t.split(/(?<=[.!?])\s+(?=[A-Z(\["“])/);

  // reader words that the documents say differently (stems on both sides, added at half weight;
  // "word:1" adds a word at full weight when it is what the documents use for the thing asked)
  const SYN = Object.entries({
    optimizer: 'adamw:1', optimiser: 'adamw:1',
    licence: 'license licens', copyright: 'license creative commons', legal: 'license creative commons', cc: 'creative commons',
    duplicate: 'deduplication', duplicates: 'deduplication', dedup: 'deduplication', dedupe: 'deduplication', dedupl: 'deduplication',
    contamination: 'quarantine benchmark evaluation', leak: 'quarantine benchmark evaluation leaked', leakage: 'quarantine benchmark evaluation',
    test: 'evaluation benchmark', overlap: 'quarantine benchmark',
    youtube: 'youtube video', download: 'release public', downloadable: 'release public', open: 'release public', available: 'release public',
    weights: 'checkpoints', checkpoint: 'checkpoints', github: 'code release',
    big: 'size larg', huge: 'size larg', large: 'size', size: 'parameters', parameter: 'size', parameters: 'size', params: 'parameters size',
    gpu: 'compute flops', compute: 'flops', cost: 'compute node hours', expensive: 'compute node hours', hours: 'hours', time: 'hours',
    long: 'duration seconds', length: 'duration seconds', duration: 'seconds', clip: 'clips', clips: 'audio samples',
    label: 'taxonomy annotation', labels: 'taxonomy annotation', categories: 'taxonomy', category: 'taxonomy', classify: 'taxonomy classifier',
    benchmark: 'maeb hear', benchmarks: 'maeb hear', accuracy: 'score maeb', performance: 'score maeb', perform: 'score maeb', results: 'maeb score',
    caption: 'captions', captioning: 'captions', description: 'caption', descriptions: 'captions',
    text: 'caption', encoder: 'tower', encoders: 'tower', architecture: 'naflex transformer tower',
    loss: 'objective infonce', objective: 'loss infonce', contrastive: 'clip infonce',
    lr: 'learning rate', schedule: 'warmup cosine decay', scheduler: 'warmup cosine decay',
    music: 'music', song: 'music', songs: 'music', speech: 'speech', voice: 'speech', sound: 'sound sounds',
    segment: 'segmentation silence', cut: 'segmentation silence', split: 'segmentation',
    limitation: 'limitations future', limitations: 'future', weakness: 'limitations', weaknesses: 'limitations',
    seed: 'seeds', seeds: 'seed', random: 'seed', repeat: 'seed',
    scaling: 'scale', law: 'power doubling', laws: 'power doubling', doubling: 'doubling',
    allocate: 'allocation compute optimal', allocation: 'compute optimal', budget: 'compute optimal allocation', spend: 'compute allocation',
    bigger: 'model size', smaller: 'model size', data: 'samples',
    storage: 'storage format webdataset', disk: 'storage tb', stored: 'storage format', format: 'webdataset flac',
    ai: 'generative', chatgpt: 'generative', generative: 'generative',
    zeroshot: 'zero shot', retrieval: 'retrieval', clustering: 'clustering',
    share: 'percent mixture', percentage: 'percent', proportion: 'percent mixture', fraction: 'percent',
    come: 'source collection', origin: 'source collection', where: 'source',
    generate: 'captioner', generated: 'captioner', wrote: 'captioner',
    metadata: 'metadata enrichment', annotate: 'annotation', annotations: 'annotation',
    spoken: 'speech', detect: 'predict', identify: 'predict', recognize: 'predict', recognise: 'predict',
    tokenizer: 'vocabulary',
  }).reduce((m, [k, v]) => (m.set(stem(k), v.split(' ').map(x => x.split(':')).map(([w, f]) => [stem(w), f ? +f : .5]).filter(([w]) => w !== stem(k))), m), new Map());

  // ---------- hand-written answers (js/qa-seeds.js and js/qa-seeds-more.js) ----------
  // Each answer lists example phrasings `q`; a question is matched against all phrasings of all
  // answers (seedFor below). Function words and chat filler are dropped, but question words such as
  // "who", "why" and "work" are kept: "who are you?" and "how does it work?" have nothing else.
  const SEED_STOP = new Set(('a an the of to in on at for and or is are was were be been being am do does did done can could would ' +
    'should will shall may might must has have had it its this that these those there their them they i me my your yours u ur r we our ' +
    'us so if then just also some any really actually exactly ok okay cool lol haha wow hmm um uh pls plz please btw guys yeah yep ' +
    'nope awesome sure tell explain know want wondering curious kind sort bit little').split(' '));
  const seedWords = s => words(s.replace(/([a-z])([A-Z]{3,})\b/g, '$1$2 $2')).flatMap(w => (/^[a-z]{4,}\d/.test(w) ? [w, w.match(/^[a-z]+/)[0]] : [w])).filter(w => !SEED_STOP.has(w));
  const seedToks = s => seedWords(s).map(stem);
  const SEEDS = [...(window.LIO_SEEDS || []), ...(window.LIO_SEEDS_MORE || []), ...(window.LIO_SEEDS_FACTS || [])].filter(s => s && s.a && Array.isArray(s.q) && s.q.length)
    .map(s => ({ ...s, notSet: s.not && new Set(s.not.map(w => w.toLowerCase())) }));
  // ids used by more than one answer (tools/seed_check.js --lint reports them)
  const DUP_IDS = (() => { const seen = new Map(); SEEDS.forEach(s => seen.set(s.id, (seen.get(s.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
  // the phrasing collection: one entry per phrasing, idf over answers (a word all phrasings of one
  // answer share counts once), so words that name one topic weigh most
  const PH = [], PDF = new Map();
  SEEDS.forEach((s, si) => {
    const vocab = new Set();
    s.ph = s.q.map(t => {
      const tk = [...new Set(seedToks(t))];
      tk.forEach(w => vocab.add(w));
      const alt = new Set();
      tk.forEach(w => (SYN.get(w) || []).forEach(([x]) => alt.add(x)));
      const p = { si, t, set: new Set(tk), alt };
      PH.push(p);
      return p;
    });
    vocab.forEach(w => PDF.set(w, (PDF.get(w) || 0) + 1));
    s.vocab = vocab;
    // words of the answer itself: partial evidence for the questions it speaks to
    s.avocab = new Set(seedToks(s.a.replace(/<[^>]+>/g, ' ')));
  });
  const NS = SEEDS.length || 1;
  // question words and other words the passage search ignores ("how", "work", "use") still count,
  // at a lower weight, so "how does it work?" can match but "limitations of this work" is about limitations
  const STOP_STEMS = new Set([...STOP].map(stem));
  // ... and the one-letter model sizes ("M", "L"), rare among the phrasings but rarely what a
  // question is about ("How did M do on MAEB?" asks about MAEB)
  const SIZES = new Set(['m', 'l', 's', 'xs', 'xxs']);
  const wSeed = w => (STOP_STEMS.has(w) ? P.seedStop : SIZES.has(w) ? P.seedSize : 1);
  const pIdf = w => Math.log(1 + (NS - (PDF.get(w) || 0) + .5) / ((PDF.get(w) || 0) + .5)) * wSeed(w);
  const P_IDF_MAX = Math.log(1 + (NS + .5) / .5);

  // ---------- passage index ----------
  // ranking and answer thresholds, tuned on the dev half of tools/qa_eval.json
  const P = {
    k1: 1.6, b: .5,
    wSec: 1.6,        // a section-title word counts this much more than a word in the text
    appendix: .85,    // appendix passages answer details; general questions belong to the main text
    related: .75,     // background and related work describe other people's results
    define: 1.3,      // "what is X?": passages that spell out the acronym X
    caption: .9, table: .8, paper: 1.3,
    coverTab: .6,     // how much of the question a table row must cover (catalogue rows: see CAT_Q)
    cell: 1, cellPos: 0, // single-cell table answers (desktop index) and where they are shown
    rowIdf: 3,        // how rare a word must be to pull in the table row it names
    minScore: 4, rel: .45, cover: .5, coverTop: .45, coverOOV: .65,
    typoMin: 4,
    snipNum: .5, snipVal: .5, snipAnyNum: .3, // snippet sentence: weight of a number next to the asked word, and of matching-word weight
    // hand-written answers: similarity of the question to an answer's best example phrasing
    seedMin: .5,      // ... must reach this (0..1)
    seedMargin: .03,  // ... and beat the best different answer by this much
    seedQ: .5,        // weight of question coverage against phrasing coverage (geometric mean)
    seedAns: .3,      // credit for a question word found only in the answer text, not the phrasing
    seedSyn: .6,      // credit for a word matched through a synonym or acronym
    seedNew: .8,      // weight of a question word no phrasing uses, relative to the rarest phrasing word
    seedStop: .5,     // weight of words the passage search ignores ("how", "work", "use")
    seedAny: .2,      // share of the score from the answer's distinctive overlap (all its phrasings and its text)
    seedStray: 3, seedStrayIdf: 2.4, // a question word rules out a definitional answer when rare among the phrasings and in the documents
    seedVouch: .85,   // similarity above which the answer-kind checks (seedFits) are skipped
    seedSize: .15,    // weight of the model sizes "M", "L", "S", "XS", "XXS"
    seedTieMean: .03, // ... else the mean similarity over all its phrasings must differ by this
    seedTie: 1,       // answers within the margin: the best phrasing's question coverage must differ by this (1: skip this test)
    seedKnown: 0,     // phrasing words also count as known for the passage refusal (they always do for seed matching)
    seedW: .15, seedCap: 1.5, // weight of the words of a matching hand-written answer in passage ranking, capped at this share of the question's own score
    weakIdf: 3,       // questions whose words weigh less than this in all count as vague
    vague: 1,         // questions with no content words: show passages backing the hand-written answer (0: none)
    dup: .5,          // word overlap above which two passages count as the same text
    rerank: 30,       // second stage: how many first-stage passages are re-scored
    sent: 1, pair: .85, // weight of the best sentence window's coverage; a two-sentence window counts .85
    num: .3, numWin: 3, numBare: .5, // "how many" questions: bonus for a number within numWin words of a question word       // spelling correction for unknown words of at least this many letters (0: off)
  };
  let PROSE = new Set(); // words of the prose and captions: a word known only from a table row is still "unknown"
  let ready = null, docs = [], df = new Map(), avg = 0, N = 0, D = null, ABBR = new Map(), LONG = [], VOC = new Map(), LOWER = new Set();
  const FIX = new Map(); // misspelled word -> the document word it stands for ('' when none is close)
  function wantFull() {
    try {
      const c = navigator.connection;
      return window.matchMedia('(min-width: 901px)').matches && !(c && (c.saveData || /2g/.test(c.effectiveType || '')));
    } catch (e) { return false; }
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => (window.QA_INDEX ? res() : rej(new Error('index')));
      s.onerror = () => { s.remove(); rej(new Error('index')); };
      document.head.appendChild(s);
    });
  }
  // the desktop index adds table rows; phones and data-saver get the compact one
  function load() {
    return ready || (ready = (window.QA_INDEX ? Promise.resolve()
      : (wantFull() ? loadScript('js/qa-index-full.js').catch(() => loadScript('js/qa-index.js')) : loadScript('js/qa-index.js'))
    ).then(build, e => { ready = null; throw e; }));
  }
  function build() {
    D = window.QA_INDEX;
    df = new Map();
    const secTok = D.sections.map(s => tokens(s.replace(/^([A-H]|\d+)(\.\d+)*\s+/, '')));
    docs = D.chunks.map(([d, s, p, t, k = 0, cols]) => {
      const tk = tokens(t), tf = new Map();
      tk.forEach(w => tf.set(w, (tf.get(w) || 0) + 1));
      secTok[s].forEach(w => tf.set(w, (tf.get(w) || 0) + P.wSec));
      tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1));
      const sec = D.sections[s], app = /^[A-H](\.|\s)/.test(sec), rel = /^2(\.\d)?\s/.test(sec);
      // table rows: the words of each row's first cell ("AudioSet", "Ours M") name what the row is about
      const keys = k === 2 ? new Set(t.slice(t.indexOf(']: ') >= 0 ? t.indexOf(']: ') + 3 : t.indexOf(': ') + 2).split(' ; ').flatMap(r => tokens(r.split(' | ')[0]))) : null;
      // desktop index, tables with one name per column: rows as cells, for single-cell answers
      let grid = null;
      if (cols) {
        const names = cols.split('|'), i0 = t.indexOf(']: ');
        grid = { head: t.slice(0, t.indexOf(' [')), names, ntk: names.map(n => tokens(n)),
          rows: t.slice(i0 + 3).split(' ; ').map(r => r.split(' | ')).filter(c => c.length === names.length) };
      }
      // the catalogue of the data's sources: its rows answer questions about the sources only
      const cat = k === 2 && /^[^:]*catalog/i.test(t);
      return { d, s, p, t, k, tf, keys, grid, cat, len: tk.length, set: new Set(tk),
        prior: (app ? P.appendix : rel ? P.related : 1) * (k === 1 ? P.caption : k === 2 ? P.table : 1) * (d === 0 ? P.paper : 1) };
    });
    PROSE = new Set();
    docs.forEach(x => { if (x.k !== 2) x.tf.forEach((_, w) => PROSE.add(w)); });
    // surface words of the prose, for spelling correction
    LOWER = new Set();
    docs.forEach(x => { if (x.k !== 2) (x.t.match(/(?<![A-Za-z])[a-z]+(?![A-Za-z])/g) || []).forEach(w => LOWER.add(w)); });
    VOC = new Map();
    docs.forEach(x => { if (x.k !== 2) words(x.t).forEach(w => { if (w.length > 3 && !/\d/.test(w)) VOC.set(w, (VOC.get(w) || 0) + 1); }); });
    FIX.clear();
    ALLW = null;
    N = docs.length;
    avg = docs.reduce((a, x) => a + x.len, 0) / N;
    ABBR = new Map(); LONG = [];
    Object.entries(D.abbr || {}).forEach(([a, long]) => {
      const key = words(a).join('');
      const lt = tokens(long);
      if (!key || !lt.length) return;
      ABBR.set(key, lt);
      LONG.push([lt, words(a).map(stem)]);
    });
  }
  const idf = w => Math.log(1 + (N - (df.get(w) || 0) + .5) / ((df.get(w) || 0) + .5));
  const IDF_OOV = () => Math.log(1 + (N + .5) / .5);

  // "does it work for music?", "how good is it on speech?": a question about performance
  const PERF = new Set(['work', 'works', 'good', 'well', 'handle', 'capable', 'better', 'best', 'bad', 'strong', 'weak', 'score', 'scores', 'perform', 'performs', 'performance', 'accuracy', 'results']);
  const PERF_TERMS = ['perform', 'score', 'benchmark', 'result'].map(stem);

  function queryTerms(q) {
    const all = words(q);
    const upper = new Set((q.match(/[A-Za-z0-9]*[A-Z][A-Za-z0-9]*/g) || []).flatMap(words));
    const raw = all.filter(w => !STOP.has(w));
    const base = raw.map(stem);
    const wt = new Map(); // stem -> weight
    const alt = new Map(); // base stem -> the stems that stand in for it
    base.forEach(w => { wt.set(w, 1); alt.set(w, new Set()); });
    const add = (w, x, from) => {
      if (!wt.has(w) || wt.get(w) < x) wt.set(w, x);
      if (from && from !== w) alt.get(from).add(w);
    };
    raw.forEach((r, i) => {
      (SYN.get(base[i]) || []).forEach(([x, f]) => add(x, f, base[i]));
      // "clips" is not CLIP: a word the documents also write in lower case expands only when typed in capitals
      const acr = a => ABBR.has(a) && (upper.has(a) || !LOWER.has(a)) ? ABBR.get(a) : null;
      const exp = acr(r) || (r.endsWith('s') && !LOWER.has(r) ? acr(r.slice(0, -1)) : null);
      if (exp) exp.forEach(x => add(x, .5, base[i]));
    });
    // "MAEB-30" arrives as two words: look the pair up as one acronym
    let longForm = null;
    raw.forEach((r, i) => { longForm = longForm || ABBR.get(r) || (i && ABBR.get(raw[i - 1] + r)) || null; });
    for (let i = 1; i < raw.length; i++) {
      const exp = ABBR.get(raw[i - 1] + raw[i]);
      if (exp) exp.forEach(x => add(x, .5, base[i - 1]));
    }
    // "what is MAEB?": the passage that spells the acronym out is the one that defines it
    const define = /^(what(s| is| are| does)|define|definition|meaning)\b/.test(all.join(' ')) ? longForm : null;
    // "warmup stable decay" -> WSD
    const bset = new Set(base);
    LONG.forEach(([lt, ab]) => { if (lt.length > 1 && lt.every(x => bset.has(x))) ab.forEach(x => add(x, .7, lt[0])); });
    // a compound the documents write as one word
    for (let i = 1; i < raw.length; i++) { const j = stem(raw[i - 1] + raw[i]); if (df.has(j)) add(j, 1, base[i - 1]); }
    if (all.some(w => PERF.has(w))) PERF_TERMS.forEach(x => add(x, .4));
    const bigrams = [];
    for (let i = 1; i < base.length; i++) bigrams.push(base[i - 1] + ' ' + base[i]);
    // "how many parameters", "what percentage", "how long": the answer is a number
    return { base: [...new Set(base)], wt, alt, bigrams, define, numeric: numericAsk(all), line: all.join(' ') };
  }

  // "how many parameters", "what percentage", "how long": the answer is a number next to the
  // thing asked about (the first word after "how many") or next to a unit
  const UNITS = {
    long: 'second seconds minute minutes hour hours words steps days', short: 'second seconds words',
    large: 'tb gb parameters million billion samples', big: 'tb gb parameters million billion samples', much: 'tb gb hours',
    fast: 'faster speed second throughput', often: 'times passes', accurate: 'error percent', old: 'years',
    percentage: 'percent', share: 'percent', fraction: 'percent', proportion: 'percent',
  };
  const NUMW = new Set('two three four five six seven eight nine ten eleven twelve dozen hundred thousand'.split(' ').map(w => stem(w)));
  const MAG = new Set('million millions billion billions thousand hundred trillion'.split(' ').map(w => stem(w)));
  function numericAsk(all) {
    const s = all.join(' ');
    const m = /\b(?:how (many|much|long|short|large|big|fast|often|old|accurate)|what (percentage|share|fraction|proportion|number|amount)|number of)\b(.*)$/.exec(s);
    if (!m) return null;
    const kind = m[1] || m[2] || 'many';
    const next = words(m[3]).filter(w => !STOP.has(w))[0];
    const head = new Set();
    if (next && !(kind in UNITS && ['long', 'short', 'fast', 'often', 'old', 'accurate'].includes(kind))) head.add(stem(next));
    (UNITS[kind] || '').split(' ').filter(Boolean).forEach(u => head.add(stem(u)));
    return { kind, head, pct: /percent|share|fraction|proportion/.test(kind) };
  }

  // hint: the text of the hand-written answer, if one matched; its words pull in the passages
  // that back it up, at a low weight so the question's own words still decide
  function rank(q, hint) {
    const Q = queryTerms(q);
    // "the data": words so common they say little; the hand-written answer leads instead
    Q.weak = !!hint && Q.base.reduce((a, w) => a + qIdf(w), 0) < P.weakIdf;
    const hw = new Map();
    if (hint && P.seedW) {
      const plain = hint.replace(/<[^>]+>/g, ' ');
      tokens(plain).forEach(w => { if (!Q.wt.has(w) && df.has(w)) hw.set(w, P.seedW); });
    }
    const { wt } = Q;
    const bm = (x, w, wgt) => { const f = x.tf.get(w); return f ? wgt * idf(w) * f * (P.k1 + 1) / (f + P.k1 * (1 - P.b + P.b * x.len / avg)) : 0; };
    const scored = [];
    for (const x of docs) {
      let sc = 0, sh = 0;
      wt.forEach((wgt, w) => { sc += bm(x, w, wgt); });
      hw.forEach((wgt, w) => { sh += bm(x, w, wgt); });
      // the answer's words back up the question's, never outweigh them (none of their own
      // when the question has no words to match)
      sc += Q.base.length && !Q.weak ? Math.min(sh, P.seedCap * sc) : sh;
      if (!sc) continue;
      if (Q.define && Q.define.every(w => x.tf.has(w))) sc *= P.define;
      scored.push({ x, sc: sc * x.prior });
    }
    scored.sort((a, b) => b.sc - a.sc);
    // second stage: the best few are re-scored by how much of the question one or two adjacent
    // sentences answer, and, for "how many" questions, whether a number stands next to a word
    // of the question
    if (P.sent || P.num) {
      const top = scored.slice(0, P.rerank);
      top.forEach(r => {
        const f = focus(r.x, Q);
        r.sc0 = r.sc;
        r.focus = f;
        r.sc *= (1 + P.sent * f.cov) * (1 + P.num * f.num);
      });
      top.sort((a, b) => b.sc - a.sc);
      scored.splice(0, top.length, ...top);
    }
    // near-identical passages: keep the better-ranked one
    const out = [];
    for (const r of scored) {
      if (out.some(o => jac(o.x.set, r.x.set) > P.dup)) continue;
      if (out.length === 3) { if (scored.indexOf(r) > P.rerank) break; continue; }
      out.push(r);
    }
    // desktop index: a table row named by a rare word of the question ("Is AudioSet in the
    // data?") is shown as the last answer, after the prose
    const row = scored.find(r => r.x.keys && Q.base.some(w => r.x.keys.has(w) && idf(w) > P.rowIdf));
    if (row && !out.includes(row)) { if (out.length === 3) out.pop(); out.push(row); row.row = true; }
    // "What is M's music score on MAEB?": a table row named by the question ("Ours M") with a
    // column it names ("Music") answers with one cell, shown first
    const cell = P.cell && cellFor(Q, scored);
    if (cell) {
      const i = out.findIndex(o => o.x === cell.x);
      if (i >= 0) out.splice(i, 1); else if (out.length === 3) out.pop();
      const r = scored.find(o => o.x === cell.x) || { x: cell.x, sc: 0 };
      r.cell = cell; r.row = true;
      // a comparison ("the gap to LAION-CLAP") needs prose; the cell then comes second
      const cmp = /\b(gap|compare[ds]?|comparison|difference|differ|versus|vs|than|beat|beats|outperform)\b/.test(words(q).join(' '));
      out.splice(Math.min(P.cellPos + (cmp ? 1 : 0), out.length), 0, r);
    }
    return { results: out, all: scored, ...Q };
  }
  const GENERIC = new Set(['model', 'models', 'our', 'ours', 'total', 'mean', 'all']);
  function cellFor(Q, scored) {
    const want = new Set(Q.base);
    Q.base.forEach(b => (Q.alt.get(b) || []).forEach(a => { if ((Q.wt.get(a) || 0) >= .5) want.add(a); }));
    Q.wt.forEach((f, w) => { if (f >= .7) want.add(w); });
    let best = null;
    for (const x of docs) {
      if (!x.grid) continue;
      const cols = [];
      x.grid.ntk.forEach((nt, j) => { if (j && nt.length && nt.some(w => want.has(w))) cols.push(j); });
      if (!cols.length) continue;
      for (const cells of x.grid.rows) {
        const kt = tokens(cells[0]).filter(w => !GENERIC.has(w));
        if (!kt.length || !kt.every(w => want.has(w))) continue;
        const sc = kt.length + cols.length + (x.d === 0 ? .5 : 0);
        if (!best || sc > best.sc) best = { x, cells, cols, sc };
      }
    }
    return best;
  }
  // sentences of a passage as token lists (cached)
  function sents(x) {
    return x.sn || (x.sn = (x.k === 2 ? x.t.split(' ; ') : sentences(x.t)).map(t => ({ t, tk: tokens(t) })));
  }
  // weight of each word of the question for coverage: unknown words weigh like the rarest word
  // (a reader word the documents say differently, "big" for "size", weighs like the documents' word)
  const qIdf = w => {
    if (PROSE.has(w)) return idf(w);
    const sy = (SYN.get(w) || []).filter(([x, f]) => f >= .5 && PROSE.has(x));
    return sy.length ? Math.max(...sy.map(([x]) => idf(x))) : IDF_OOV();
  };
  // the window of one or two adjacent sentences that covers the most of the question
  // -> {cov: 0..1, i: first sentence, n: 1 or 2, num: a number next to a question word}
  function focus(x, Q) {
    const ss = sents(x);
    const groups = Q.base.map(b => [qIdf(b), [[b, 1], ...[...(Q.alt.get(b) || [])].map(a => [a, Math.min(.7, Q.wt.get(a) || .5)])]]);
    const all = groups.reduce((a, g) => a + g[0], 0) || 1;
    const covOf = set => groups.reduce((a, [v, alts]) => a + v * alts.reduce((m, [w, f]) => (set.has(w) && f > m ? f : m), 0), 0) / all;
    const sets = ss.map(s => new Set(s.tk));
    let best = { cov: -1, i: 0, n: 1 };
    const cov1 = [], numS = ss.map(() => 0);
    sets.forEach((st, i) => {
      const c1 = cov1[i] = covOf(st);
      if (c1 > best.cov) best = { cov: c1, i, n: 1 };
      if (i + 1 < sets.length) {
        const c2 = covOf(new Set([...st, ...sets[i + 1]])) * P.pair;
        if (c2 > best.cov + 1e-9) best = { cov: c2, i, n: 2 };
      }
    });
    best.num = 0;
    const nq = Q.numeric;
    if (nq && nq.head.size) {
      // the head word and its stand-ins
      const hs = new Set(nq.head);
      nq.head.forEach(h => (Q.alt.get(h) || []).forEach(a => hs.add(a)));
      for (let i = 0; i < ss.length; i++) {
        const tk = ss[i].tk;
        for (let j = 0; j < tk.length; j++) {
          const isNum = /^\d/.test(tk[j]);
          if (!isNum && !NUMW.has(tk[j])) continue;
          const pct = tk[j + 1] === 'percent' || (tk[j + 1] && /^\d/.test(tk[j + 1]) && tk[j + 2] === 'percent');
          if (pct !== nq.pct) continue; // "51% of parameters" does not say how many parameters
          // "153M", "1.47 billion", "364,955,979" and "five" read as counts; a bare "8" is weaker
          const v = !isNum || /^\d+[kmbt]$/.test(tk[j]) || MAG.has(tk[j + 1]) || /^\d{3}$/.test(tk[j + 1] || '') ? 1 : P.numBare;
          if (v <= numS[i]) continue;
          for (let k = Math.max(0, j - P.numWin); k <= Math.min(tk.length - 1, j + P.numWin + 1); k++) if (k !== j && hs.has(tk[k])) { numS[i] = v; break; }
        }
        best.num = Math.max(best.num, numS[i]);
      }
    }
    best.cov1 = cov1; best.numS = numS;
    return best;
  }
  function jac(a, b) { let i = 0; a.forEach(w => { if (b.has(w)) i++; }); return i / (a.size + b.size - i); }

  // how much of what the question asks about a passage covers: a word counts fully when the
  // passage has it, partly when it has a stand-in, and unknown words count fully against it
  function coverage(x, base, alt) {
    let all = 0, hit = 0;
    base.forEach(w => {
      const v = qIdf(w);
      all += v;
      if (x.tf.has(w)) hit += v;
      else if (alt && [...(alt.get(w) || [])].some(a => x.tf.has(a))) hit += .7 * v;
    });
    return all ? hit / all : 0;
  }

  // ---------- display ----------
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const scripts = h => h.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
  function mark(text, wt) {
    return scripts(esc(text).replace(/[A-Za-z0-9][A-Za-z0-9-]*/g, w => {
      const parts = words(w);
      return parts.length && parts.some(p => !STOP.has(p) && wt.has(stem(p))) ? `<mark>${w}</mark>` : w;
    })).replace(/<mark>([^<]*)<\/mark>(\s+)<mark>/g, '<mark>$1$2'); // one highlight for "learning rate"
  }
  // the one or two sentences of a passage that answer best
  function snippet(x, wt, bigrams, Q, cell) {
    if (cell) { // one cell: "Table 2 (MAEB benchmark results): Ours M · Music 76.1"
      const g = x.grid;
      return `${g.head}: ${cell.cells[0]} · ${cell.cols.map(j => g.names[j] + ' ' + cell.cells[j]).join(', ')}`;
    }
    if (x.k === 2) { // table: its title and the rows that match
      const [head, rows] = [x.t.slice(0, x.t.indexOf(': ')), x.t.slice(x.t.indexOf(': ') + 2).split(' ; ')];
      const good = rows.filter(r => tokens(r).some(w => wt.has(w)));
      return head + ': ' + (good.length ? good : rows).slice(0, 3).join(' ; ');
    }
    const sents = sentences(x.t);
    const val = s => {
      const tk = tokens(s);
      let v = 0;
      new Set(tk).forEach(w => { if (wt.has(w)) v += idf(w) * wt.get(w); });
      for (let i = 1; i < tk.length; i++) if (bigrams.includes(tk[i - 1] + ' ' + tk[i])) v += 2;
      return v;
    };
    // a sentence answers when it covers the question (and, for "how many", holds the number);
    // the summed weight of its matching words breaks ties
    const f = focus(x, Q), raw = sents.map(val), mx = Math.max(...raw, 1e-9);
    // "how many / how much / how often": a sentence with a number in it, even when it is not next to the word asked about
    const numQ = Q.numeric || /\bhow (many|much|often)\b/.test(Q.line || '');
    const cmx = Math.max(...f.cov1, 1e-9);
    const vs = raw.map((v, i) => f.cov1[i] + P.snipNum * f.numS[i] + P.snipVal * v / mx +
      (numQ && /\d/.test(sents[i].replace(/\b(19|20)\d\d\b/g, '')) ? P.snipAnyNum * f.cov1[i] / cmx : 0));
    const n = s => s.split(/\s+/).length;
    let bi = 0;
    vs.forEach((v, i) => { if (v > vs[bi]) bi = i; });
    const pick = [bi];
    // add a neighbour when the best sentence is short, preferring the one that matches more
    if (n(sents[bi]) < 30) {
      const next = bi + 1 < sents.length ? vs[bi + 1] : -1, prev = bi > 0 ? vs[bi - 1] : -1;
      if (next >= 0 && (next >= prev || prev < 0)) pick.push(bi + 1);
      else if (prev >= 0) pick.unshift(bi - 1);
    }
    let out = pick.map(i => sents[i]).join(' ');
    const w = out.split(/\s+/);
    if (w.length > 75) out = w.slice(0, 75).join(' ') + ' …';
    return (pick[0] > 0 ? '… ' : '') + out;
  }
  // passages are cited with their section, table and page ("Paper · §3.2 Title · p. 4"), which link into the paper
  function cite(x) {
    const sec = D.sections[x.s];
    const label = /^\d/.test(sec) ? '§' + sec : /^[A-H](\.|\s)/.test(sec) ? 'Appendix ' + sec : sec;
    const tab = x.k === 2 ? (x.t.match(/^Table [A-H]?\d+(\.\d+)?/) || [''])[0] : '';
    return `Paper · ${label}${tab ? ' · ' + tab : ''} · p. ${x.p}`;
  }

  // ---------- answering ----------
  // a word the documents never use, with no stand-in they do use
  // the words of the hand-written answers' phrasings ("demo", "ring", "bibtex") are known too: they
  // name things on the page, not in the documents
  const SEEDWORDS = new Set(SEEDS.flatMap(s => s.q.flatMap(t => words(t))));
  // numbers with a unit or magnitude ("84M", "1.38M" -> "38m", "30s", "8B", "10k", "2x") are values, not unknown words
  const NUM_UNIT = /^\d+(k|m|b|bn|t|s|ms|h|hr|hrs|min|mins|sec|secs|gb|tb|mb|kb|x|d|hz|khz|th|st|nd|rd|p)$/;
  const known = (w, seedWords) => STOP.has(w) || (seedWords && SEEDWORDS.has(w)) || (/^[a-z]{4,}\d/.test(w) && PROSE.has(stem(w.match(/^[a-z]+/)[0]))) || /^\d+$/.test(w) || NUM_UNIT.test(w) || w.length <= 2 || PROSE.has(stem(w)) || ABBR.has(w) ||
    (SYN.get(stem(w)) || []).some(([x, f]) => f >= .5 && PROSE.has(x));
  function oovWords(q, seedWords) {
    return words(q).filter(w => !known(w, seedWords));
  }
  // Damerau-Levenshtein distance, at most `max` (returns max + 1 beyond that)
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let pp = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const c = [i];
      let lo = i;
      for (let j = 1; j <= b.length; j++) {
        c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) c[j] = Math.min(c[j], pp[j - 2] + 1);
        lo = Math.min(lo, c[j]);
      }
      if (lo > max) return max + 1;
      pp = p; p = c;
    }
    return p[b.length];
  }
  // "paramters" -> "parameters": an unknown word one typo (two for long words) away from a
  // document word with the same first letter; the most frequent such word wins
  // common English words the typo fixer leaves alone: frequent words (the first 15,000 entries of
  // BERT's uncased vocabulary, roughly by frequency) one typo away from a word of the documents
  // (regenerate with tools/common_words.js after the documents change)
  const COMMON = new Set((''
    + 'absolutely accelerated accepts accordingly achieved adam adams addiction advance advanced afterward aggregate agreements agrees ahmed aided '
    + 'aired alfonso algorithms alien aliens allegations alone alter alto amounts angel angie angles anglo animals ankle answer appeal appeals '
    + 'approached arch archie archived area armed arms arrow artists arts assignments assumed assure attacking attributes audition aurora averaged '
    + 'avoid babe bach backs backwards bald bands bang bank bare bark bart basel bases basic basil basin bass bates bath bats beam beams bean beans '
    + 'bear beard bearing bears beast became beck beef beer bees begin behavioral behaviour beings belt bend benefits bent beta beth bind binding '
    + 'birds bitch bite bits bitter black blacks block blow blues blur boards boat boats boeing bolt bond booth boyd brad brand bread bring buck '
    + 'buildings bust butter cafe cage cake calculated cameo camp camps cancer cane cannon cape capt capture care cares cars casa casey cash cast '
    + 'caste catching cats cause causes caution cave caves cease challenged challenger challenges chan chances chang channel character charge '
    + 'charges charging charity charted chase cheek cheeks chef chick chile chill chin chip chips choose chuck circle circulation cities city clad '
    + 'claims clan clash classified clause claws clay cleaned cleared clearing closed closer closes closet cloth coaching coast coat codes cody '
    + 'cohen coke cold cole collecting collective collectors collision colt colts coming commercially commercials companions compatible competed '
    + 'competes competition compilation completed completely compositions computer concepts concert conditions cone conference confluence '
    + 'connection connections connects consent conservation conservatives consistently constantly consultant consulting container contents contest '
    + 'contestant continue continuing continuously contract contributed contributing contributions contributor control convent conviction cooked '
    + 'cooler coordinate coordinated coordinator copa cope cops core corps correspondent costa couldn counter counterparts county couple coupled '
    + 'court courts cove crap crept crop cross cubs cupped cups cure currents curse curved cute dana dane date dawn deal death deaths decade '
    + 'decades decide decides decoration decorations decrease decreased dedication defend defending definition delay delays demonstrate '
    + 'demonstrated derives descendants designated designer destination detention determined developmental developments devoted dial diamond dies '
    + 'differently difficulty direction discharged discussed distances distinctive distraction divide documents doesn dogs dome dominated dong dose '
    + 'dots double doubles doubted dove downs drain draw draws dripping duel dull dying dynamics earl ease east eden edged edith effectively '
    + 'efficiency eighth eighty electronics enabled encoded encounter encountered environment environments equations esther estimated evacuated '
    + 'evacuation evan ever exists exit experienced experiences experts explain export exposed expressing expression extant extends extensively '
    + 'extinction extract faced faces facilities faction facto factory facts fade fails fake fall fame fare farm farms farther fate favour feast '
    + 'feat feature featured fell fellow fellows females fever figured filed film filmed films filter finale finals fine finishes finn fire fired '
    + 'fires firm firms fist fists flag flame flames flats flavor flee flesh flies float floods floor flour flows flush fond forced ford fork '
    + 'formal former fort forth forum foster foul foundations framed fred freed frequently frog froze fuel fund funding funds gabe gage gale game '
    + 'gang garde gary gates gave gavin gaze gazed gene genera generals generations genres ghost giles glad glow glowing gold gone goods grab grain '
    + 'gram gran graphic greg grew grim grin grip gross grounds growl grown guru hadn hale hall halt hands hang hank hans hardy hare harm harp '
    + 'harsh hart hasn hate haven head heal heard hears heart heat heir hell help henri herb herd hero hers highlighted highlights hire hole holes '
    + 'holt holy hong hood householder households hugh hunt hunter hypothesis ideal ideas ignore impacts importance importantly impressive indeed '
    + 'independence independently indicates indication indies individuals indo industries inferior influenced influences initiatives instances '
    + 'instructed instruction instructor intel intelligent interactions interval inventor investigate investigator involve involved isolated issued '
    + 'italia jason joan john joins jude judges judgment keen kent king know knows lace lacks lake lane lang laps laser lasted late lawn lawyer '
    + 'lawyers leaders leah lean leaned leaning leans leap leapt lease leased leave leaving leeds legs lengthy lens lets letter licence licked lied '
    + 'life lift lifted lifts liked likes lime lined liner lines lion lips lisa listen listing live lives load lock locking logic lone lords lose '
    + 'loser loses lost lots lover lovers lowe luck luke lung lust lyric mack maid mail maine maker makers males mall mann manor manuel maple mara '
    + 'marc march marched marching mare marker market markings mars marx mary mask mass masses mate materials maternal mates math mayor meal meals '
    + 'measurement meat mechanism medal media megan member mention mere merger merry mess messages methods mighty mike mile minimal miss missed '
    + 'mist mitch moan modes module moist mona monk moon moore moral moses motel motivated motivation moves movie name named nate natives nato neal '
    + 'nearby necessarily nest newer nice nina nods noises nose notes noting notre objects observations observer occurrence occurs offerings '
    + 'officially officials opens operas operated operates operation operational optical option originally outline owen pace pack packages packed '
    + 'pact paid pain paint pale pants para paris park parking parks particularly party passed paths pays penn percy performances performer '
    + 'performers performs permission perth phase picking picks pilot pilots pink piper pits pius place placed planes planted plates platform '
    + 'pleased plug pocket poet poker poles police poll polls polo pools poor porch porto ports pose posed positioned positively post posts powder '
    + 'powers practiced practices precious prefer presenter presents preserved pretending prevented preventing previously print prints priory '
    + 'procession producer producers production productions products progressed project prominence prominently promoted promotes promotional '
    + 'proposition prosecution protection protective protest protested protocol prove proved provider providers publications publisher publishers '
    + 'publishes publishing pull purse pushed qualify quartet questioned quit quite race racer rack radio rage raised rand rang ranger rangers '
    + 'ranks rape rated rates rats react reacted reads ready real rear receiver recorder recreational reed refuse refused refusing regain regent '
    + 'region registered regulations reich reid relate relates relation relationships relatives relaxed relay relief remote rent repeatedly '
    + 'replaced replied reply reportedly reporter representative representatives represented represents reputation requirement researcher resided '
    + 'resolve resolved resort resources responses retain retaining retains reveals reviewer revolution rights ringing riot rise rises rite road '
    + 'robe robot rode role roles rome roof room roots ropes rose ross rouge route routes rude ruins ruled ruler rulers rush rusty sack safe sage '
    + 'sake sale sales sand satisfied save saved scan scanning scar scare scared scars scent scope scorer scrapped screams screens sealed sean '
    + 'searched seas seated seating seats sections seek seeks seem seems sees segment select sell sends sensed senses sent sentence sentenced '
    + 'separated separating serie series served server servers seth settling shade shades shaft shake shakes shall shame shane shaped shapes shark '
    + 'sharks sharp shaw shawn shed shelf shifts shipped ships shire shirt shit shoe shoes shoot shooter shop shops shore shores shorts shots '
    + 'shouldn shout shoved shower shut side sides sighed sight signals significance singles site sites sits sitting sized skill skip slam slate '
    + 'slaves slid slip slipped slot slowed smell snap snow soap sofa sold sole sometime sore sort sorts spain spare spat speakers spend spill spin '
    + 'spinning spit spite spoke sport spot spots spring springs spun staged stake stakes stall stan standards stare stared stares staring stark '
    + 'starr starred starring stars start starter startled states stating statue stay stayed stays steep stem stepped steven stick sting stock '
    + 'stoke stole stool stop store stores storey stream strengthened struggled stuck studios styled styles submarines substantially suck sued suit '
    + 'suited suits summer sunset supervisor supplied supporter supporters surf surge surprise surprising surroundings swan swift swiss swore '
    + 'tablet takes tale tales talk talking talks tank tanks tape tapes tasted tate teams tear techniques teen temperatures tends tent terra tests '
    + 'texas thai thank thee theme theo thick thin things thinks thirds though threats threw throughout thus tide tiger tigers tile tiles tips tire '
    + 'tired tires toes tool topic towel toxic trace tracks tract tracy traded trades traditionally traditions trail trailed trailing trails '
    + 'trainer traits tram trans transformed transportation transported treat treaty tree trent trey trick tries truck turin turning undergoing '
    + 'understood uniforms units unity unreleased updates upward user users vague vale valued valve variables variant varied vary vera verb visions '
    + 'vocal vote voted voter voters wade wage wagner wait waiting wall walt wang wants ward wards warm warn warned wars waved waves wear weaver '
    + 'week weekly wells went weren werner whale wheat whispers white widow wife wild wine wipe wire wise wish witch woke woods word wore world '
    + 'worlds worn wouldn wound wrapped wright writings yeah ').trim().split(' '));
  // ... but not a common English word the documents happen not to use ("slip" is not "slap"): it
  // stays unknown, so the refusal check sees it
  function correct(w) {
    if (FIX.has(w)) return FIX.get(w);
    let best = '', bc = 0;
    if (w.length >= P.typoMin && !/\d/.test(w) && !COMMON.has(w)) {
      const max = w.length >= 10 ? 2 : 1;
      VOC.forEach((c, v) => { if (v[0] === w[0] && c > bc && dist(w, v, max) <= max) { best = v; bc = c; } });
    }
    FIX.set(w, best);
    return best;
  }
  // corrects in place, keeping the case of the rest (capitals tell acronyms from words)
  const fixTypos = q => q.replace(/[A-Za-z][A-Za-z0-9]*/g, t => { const w = t.toLowerCase(); return /[^a-z0-9]/.test(w) || known(w, true) ? t : correct(w) || t; });

  // reader shorthand -> the documents' words, before spelling correction and the unknown-word check
  const SHORT = {
    avg: 'average', avgs: 'averages', max: 'maximum', min: 'minimum', yt: 'YouTube', configs: 'configurations', config: 'configuration',
    cfg: 'configuration', secs: 'seconds', sec: 'seconds', mins: 'minutes', hrs: 'hours', hr: 'hours', won: 'best', winner: 'best',
    diff: 'difference', perf: 'performance', approx: 'approximately', info: 'information', num: 'number', dims: 'dimensions', dim: 'dimension',
    temp: 'temperature', lang: 'language', langs: 'languages', vid: 'video', vids: 'videos', pct: 'percent', abt: 'about', bc: 'because', cuz: 'because',
  };
  // British and American spellings: an unknown word whose other spelling the documents or the answers use
  const VARIANTS = [[/our(s|ed|ing)?$/, 'or$1'], [/or(s|ed|ing)?$/, 'our$1'], [/is(e|es|ed|ing|ation|ations)$/, 'iz$1'], [/iz(e|es|ed|ing|ation|ations)$/, 'is$1'],
    [/ys(e|es|ed|ing)$/, 'yz$1'], [/yz(e|es|ed|ing)$/, 'ys$1'], [/tre(s)?$/, 'ter$1'], [/ter(s)?$/, 'tre$1'], [/ll(ed|ing|er)$/, 'l$1'], [/([^l])l(ed|ing|er)$/, '$1ll$2'],
    [/ogue(s)?$/, 'og$1'], [/og(s)?$/, 'ogue$1']];
  let ALLW = null; // every word of the documents, as typed ("qwen3", "maeb")
  function normalize(q) {
    if (!ALLW) { ALLW = new Set(); docs.forEach(x => words(x.t).forEach(w => ALLW.add(w))); }
    return q
      // "1e12" -> "10^{12}", "3e9" -> "3 × 10^{9}" (the documents' notation)
      .replace(/\b(\d+(?:\.\d+)?)[eE]\+?(\d{1,2})\b/g, (_, m, e) => (+m === 1 ? '' : m + ' × ') + '10^{' + e + '}')
      // "16x16" -> "16 × 16"
      .replace(/\b(\d+)\s*[x×*]\s*(\d+)\b/g, '$1 × $2')
      // "30s", "30 secs" -> "30 seconds"
      .replace(/\b(\d+(?:\.\d+)?)\s?(?:s|secs?)\b/g, '$1 seconds')
      .replace(/\b(\d+(?:\.\d+)?)\s?mins?\b/g, '$1 minutes')
      // "classify sounds without training": the documents call it zero-shot
      .replace(/\bwithout (?:any |extra |additional |further )?(?:re-?)?(?:training|fine-?tuning|finetuning)\b/gi, 'zero-shot')
      // "wat is maeb30": chat spellings of "what" (lower case only: "WAT" is Common Crawl's metadata format)
      .replace(/\b(wat|wut|wht|whta|waht)\b/g, 'what')
      .replace(/[A-Za-z][A-Za-z0-9]*/g, t => {
        const w = t.toLowerCase();
        if (SHORT[w] && !(t === t.toUpperCase() && t.length > 1 && ABBR.has(w))) return SHORT[w];
        // "maeb30" -> "maeb 30" when the documents write it apart ("MAEB-30"), not "qwen3"
        const m = /^([a-z]{3,})(\d+)$/.exec(w);
        if (m && !ALLW.has(w) && (ALLW.has(m[1]) || ABBR.has(m[1]))) return t.slice(0, m[1].length) + ' ' + m[2];
        if (w.length > 4 && !/\d/.test(w) && !known(w, true)) {
          for (const [re, to] of VARIANTS) {
            const v = w.replace(re, to);
            if (v !== w && known(v, true)) return v;
          }
        }
        return t;
      });
  }
  // the question's words for matching phrasings, each with the words that stand in for it:
  // [{w, v (weight), alts: [[stem, credit]]}]
  function seedQuery(q) {
    const raw = seedWords(q), upper = new Set((q.match(/[A-Za-z0-9]*[A-Z][A-Za-z0-9]*/g) || []).flatMap(words));
    const groups = new Map();
    raw.forEach(r => {
      const b = stem(r);
      if (groups.has(b)) return;
      const alts = new Map([[b, 1]]);
      const put = (x, f) => { if (!alts.has(x) || alts.get(x) < f) alts.set(x, f); };
      (SYN.get(b) || []).forEach(([x, f]) => put(x, P.seedSyn * Math.min(1, f + .5)));
      // acronyms, as in the passage search ("clips" is not CLIP)
      const exp = ABBR.has(r) && (upper.has(r) || !LOWER.has(r)) ? ABBR.get(r) : null;
      if (exp) exp.forEach(x => put(x, P.seedSyn));
      const v = PDF.has(b) ? pIdf(b) : P_IDF_MAX * P.seedNew * wSeed(b);
      groups.set(b, { w: b, v, alts: [...alts] });
    });
    return [...groups.values()];
  }
  // similarity of the question to every answer: the best phrasing's geometric mean of how much of
  // the question it covers and how much of it the question covers, both weighted by idf over the
  // phrasings -> [{s, sim, p}] sorted, best first
  function seedScores(q) {
    const G = seedQuery(q);
    if (!G.length) return [];
    const all = G.reduce((a, g) => a + g.v, 0);
    const qset = new Set();
    G.forEach(g => g.alts.forEach(([x]) => qset.add(x)));
    const out = [];
    SEEDS.forEach(s => {
      // distinctive overlap: how much of the question any phrasing of this answer (or, partly, its text) covers
      let any = 0;
      G.forEach(g => {
        let c = 0;
        for (const [x, f] of g.alts) if (s.vocab.has(x) && f > c) c = f;
        if (c < P.seedAns && g.alts.some(([x]) => s.avocab.has(x))) c = P.seedAns;
        any += g.v * c;
      });
      any /= all;
      let best = 0, bp = null, bcq = 0, sum = 0;
      for (const p of s.ph) {
        let hit = 0;
        G.forEach(g => {
          let c = 0;
          for (const [x, f] of g.alts) if (p.set.has(x) && f > c) c = f;
          if (c < 1 && p.alt.has(g.w)) c = Math.max(c, P.seedSyn);
          if (c < P.seedAns && g.alts.some(([x]) => s.avocab.has(x))) c = P.seedAns;
          hit += g.v * c;
        });
        const cq = hit / all;
        let pa = 0, ph = 0;
        p.set.forEach(w => { const v = pIdf(w); pa += v; if (qset.has(w) || (SYN.get(w) || []).some(([x]) => qset.has(x))) ph += v; });
        const cp = pa ? ph / pa : 0;
        const sim = cq && cp ? Math.pow(cq, P.seedQ) * Math.pow(cp, 1 - P.seedQ) : 0;
        sum += sim;
        if (sim > best) { best = sim; bp = p; bcq = cq; }
      }
      if (best > 0) out.push({ s, sim: (1 - P.seedAny) * best + P.seedAny * any, p: bp, cq: bcq, mean: sum / s.ph.length });
    });
    return out.sort((a, b) => b.sim - a.sim);
  }
  // Does an answer give the kind of thing the question asks for? Topic similarity alone matches
  // "how many GPUs did L train on" to an answer about L, and "how much of the data is from Common
  // Crawl" to one that explains Common Crawl:
  //  - "how many X" / "number of X": the answer has a number and names X (the last word of the
  //    phrase after "how many": "how many audio samples" -> samples) or a stand-in for it;
  //    "how much": a number
  //  - "what share / percentage / fraction": the answer has a percentage
  //  - an answer matched through a definitional phrasing ("what is a GFLOP?", "GFLOPs meaning")
  //    explains one thing: it answers "what is X", not a question that also asks about something
  //    neither its phrasings nor its text mention ("what will the error be at 10^14 GFLOPs")
  const DEF_Q = /^(what(s| is| are| was| were| does| do)|who(s| is| are| was)|define|definition|meaning)\b/;
  const DEF_P = /^\s*(?:what(?:'s| is| are) (?:an? |the )?\S+(?: \S+){0,3}|what (?:does|do) (?:an? |the )?\S+(?: \S+){0,3} mean|who (?:is|are) \S+(?: \S+){0,3}|\S+(?: \S+){0,3} meaning|define \S+(?: \S+){0,3})\s*\??\s*$/i;
  // prepositions the stop list keeps (they carry meaning for the passage search), but no topic
  const PREP = new Set('after before during while within without instead between among across against along around behind beyond toward towards upon onto through throughout since until'.split(' ').map(w => stem(w)));
  const UNITS_COUNT = new Set('hours minutes seconds days weeks gpus nodes gb tb bytes flops gflops parameters params tokens steps epochs words languages classes tasks percent'.split(' ').map(w => stem(w)));
  // what a count of audio is a count of: "how many samples" is answered by "151M duplicates removed"
  const ITEMS = new Set('sample samples clip clips file files recording recordings pair pairs item items example examples duplicate duplicates audio audios'.split(' ').map(w => stem(w)));
  const PCT_Q = /\b(percent|percentage|share|fraction|proportion|ratio)\b/;
  function seedFits(q, raw) {
    const line = raw.join(' ');
    const nq = /\b(how many|how much|number of|count of)\b/.exec(line);
    let head = null;
    if (nq) {
      // the thing counted follows directly ("how many audio samples", "how much compute"), not after
      // a verb ("how much does the score improve")
      const after = words(line.slice(nq.index + nq[0].length));
      const run = [];
      for (let i = 0; i < after.length && !STOP.has(after[i]); i++) run.push(after[i]);
      // English puts the noun after its modifiers ("how many audio samples"), but a verb may follow
      // ("how many audio tokens fit"): any word of the phrase but the first one will do
      if (nq[1] !== 'how much' && run.length) head = (run.length > 1 ? run.slice(1) : run).filter(w => !/^\d/.test(w) && !SIZES.has(w));
    }
    const pct = (PCT_Q.test(line) && /^(what|how|which)\b/.test(line)) || /\bhow much of\b/.test(line);
    const def = DEF_Q.test(line);
    const G = seedQuery(q);
    return r => {
      // a near-copy of one of the answer's own phrasings: its author vouches for it
      if (r.sim >= P.seedVouch) return true;
      const s = r.s, text = s.a.replace(/<[^>]+>/g, ' ');
      const has = w => { const b = stem(w); return s.avocab.has(b) || s.vocab.has(b) || (SYN.get(b) || []).some(([x, f]) => f >= .5 && (s.avocab.has(x) || s.vocab.has(x))); };
      if (nq && !/\d/.test(text)) return false;
      // (unless the answer's own phrasing asks "how many" too: "how many captioning setups" answers "how many captioning
      // systems"; not for units: "how many samples" does not answer "how many hours")
      const pq = r.p ? words(r.p.t).join(' ') : '';
      if (head && head.length && !(/\b(how many|number of)\b/.test(pq) && !head.some(w => UNITS_COUNT.has(stem(w)))) && !head.some(w => has(w) || (ITEMS.has(stem(w)) && [...ITEMS].some(x => s.avocab.has(x))))) return false;
      if (pct && !/%|percent/.test(text)) return false;
      if (!def && r.p && DEF_P.test(r.p.t)) {
        // a word of the question (not a function word) that neither the answer's phrasings nor its text use
        // and that is rare among the phrasings (so says something specific: "error", "prompt"; not "model", "train")
        const stray = G.some(g => g.v >= P.seedStray && qIdf(g.w) >= P.seedStrayIdf && !STOP_STEMS.has(g.w) && !SIZES.has(g.w) && !PREP.has(g.w) && !g.alts.some(([x]) => s.vocab.has(x) || s.avocab.has(x)));
        if (stray) return false;
      }
      return true;
    };
  }
  function seedFor(q) {
    const raw = words(q);
    // a question about something neither the documents nor any phrasing mention gets no canned answer
    if (oovWords(q, true).length) return null;
    const line = ' ' + raw.join(' ') + ' ';
    // `not` and `notPhrase` rule an answer out ("when exactly ... released" is not about what is released)
    const allowed = s => !(s.notSet && raw.some(w => s.notSet.has(w))) &&
      !(s.notPhrase && s.notPhrase.some(ph => line.includes(' ' + words(ph).join(' ') + ' ')));
    const fits = seedFits(q, raw);
    const sc = seedScores(q).filter(r => allowed(r.s) && fits(r));
    if (!sc.length || sc[0].sim < P.seedMin) return null;
    // close runners-up (answers with a different text: one answer may be listed twice): the one
    // whose best phrasing covers most of the question wins; none when that does not tell them apart
    const close = sc.filter(r => r.s.a !== sc[0].s.a && sc[0].sim - r.sim < P.seedMargin);
    if (!close.length) return sc[0].s;
    if (!P.seedTie) return null;
    // ... and when they cover it equally, the answer most of whose phrasings are close to it (the
    // general one: "silence" is about segmenting, not about what silence cutting costs)
    const by = [sc[0], ...close].sort((a, b) => b.cq - a.cq);
    if (by[0].cq - by[1].cq >= P.seedTie) return by[0].s;
    const tied = by.filter(r => by[0].cq - r.cq < P.seedTie).sort((a, b) => b.mean - a.mean);
    return tied[0].mean - tied[1].mean >= P.seedTieMean ? tied[0].s : null;
  }

  // questions about what the data contains: "which sources", "how many clips / hours", "is X included"
  const CAT_Q = /\b(sources?|datasets?|included?|includes|contains?|contained|in there|in it|in the (data|dataset|mix|corpus|training data)|part of|comes? from|how many (clips|hours|samples|files|recordings|sources|datasets)|how much (audio|data)|share|percent|percentage|fraction|proportion|catalogue|catalog|list)\b/;
  // a catalogue row the question names in full ("is Freesound in there"), not by one word of its name ("Free ST Chinese")
  // -> 2: a row named in full, 1: rows named only in part, 0: none named
  const namesRow = (x, Q) => {
    const b = new Set(Q.base);
    let part = 0;
    for (const r of x.t.slice(x.t.indexOf(': ') + 2).split(' ; ')) {
      const k = tokens(r.split(' | ')[0]), n = k.filter(w => b.has(w)).length;
      if (k.length && n === k.length) return 2;
      if (n) part = 1;
    }
    return part;
  };
  async function ask(q) {
    await load();
    q = normalize(q);
    if (P.typoMin) q = fixTypos(q);
    const oov = oovWords(q, P.seedKnown);
    const seed = seedFor(q);
    const Q = rank(q, seed && seed.a), { results, base, wt, alt, bigrams } = Q;
    // "how does it work?": nothing to match but the hand-written answer, which vouches for the topic
    const vague = (!base.length || Q.weak) && seed;
    // thresholds apply to the first-stage score, which the second stage only reorders
    const s0 = r => (r.sc0 === undefined ? r.sc : r.sc0);
    const top = results.reduce((m, r) => Math.max(m, s0(r)), 0);
    // a weak match is worse than none: say so rather than quote something unrelated
    const need = oov.length ? P.coverOOV : 0;
    // table rows answer questions about what is in the table: a catalogue row (a source of the
    // data) only a question about the sources, clips or hours (or one naming the row in full),
    // other rows only a question they cover well ("sampling temperature of the judge" is not the
    // model's logit temperature)
    const tabOK = (r, cov) => r.x.k !== 2 || (r.x.cat ? namesRow(r.x, Q) === 2 || (CAT_Q.test(qline) && namesRow(r.x, Q) !== 1) : cov >= Math.max(need, P.coverTab));
    const passOf = (R, top) => (r, i) => {
      if (vague) return P.vague && s0(r) >= P.minScore * P.vague && s0(r) >= top * P.rel;
      const cov = coverage(r.x, base, alt);
      if (r.cell) return !need || cov >= P.coverOOV;
      if (!tabOK(r, cov)) return false;
      if (r.row) return cov >= Math.max(need, P.cover);
      return s0(r) >= P.minScore && s0(r) >= top * P.rel && cov >= Math.max(need, i ? P.cover : P.coverTop);
    };
    const qline = words(q).join(' ');
    let kept = results.filter(passOf(Q, top));
    // the answer's words can pull in passages the question does not cover; then show the passages
    // the question finds on its own, if they pass the usual checks
    if (seed && !vague && !kept.length) {
      const R0 = rank(q), top0 = R0.results.reduce((m, r) => Math.max(m, s0(r)), 0);
      kept = R0.results.filter(passOf(R0, top0));
    }
    const shown = [];
    kept.forEach(r => {
      const snip = snippet(r.x, wt, bigrams, Q, r.cell), set = new Set(tokens(snip));
      // a sentence shown already is not shown twice
      if (shown.some(o => jac(o.set, set) > .6)) return;
      shown.push({ r, snip, set });
    });
    const hits = shown.map(({ r, snip }) => ({
      doc: 'Paper', cite: cite(r.x), sec: D.sections[r.x.s], snippet: mark(snip, wt), full: mark(r.x.t, wt), score: r.sc,
    }));
    return { seed: seed && { html: seed.a, cite: seed.src || '' }, hits };
  }
  // for tools/qa_eval.js and tools/qa_tune.js
  function _set(params) { Object.assign(P, params); if (D) build(); }

  return { ask, load, _rank: rank, _tokens: tokens, _stem: stem, _seedFor: seedFor, _seedScores: seedScores, _seedQuery: seedQuery, _seeds: SEEDS, _dupIds: DUP_IDS, _P: P, _set, _coverage: coverage, _oov: q => oovWords(q, true), _fix: q => fixTypos(normalize(q)), _norm: q => normalize(q),
    _debug: (q, n = 8) => { const R = rank(fixTypos(normalize(q))), out = [];
      return [JSON.stringify([...R.wt].map(([w, f]) => w + ':' + f)) + (R.numeric ? ' numeric ' + R.numeric.kind + ' ' + [...R.numeric.head] : ''),
        ...R.all.slice(0, n).map(r => `${r.sc.toFixed(2)} cov ${coverage(r.x, R.base, R.alt).toFixed(2)} f ${r.focus ? r.focus.cov.toFixed(2) + (r.focus.num ? 'N' : '') : '-'} ${cite(r.x)} | ${r.x.t.slice(0, 90)}`)]; } };
})();
