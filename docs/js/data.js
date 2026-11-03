// All numbers are taken from the thesis / paper tables and figures.
window.DATA = {
  // Model sizes in the scaling-law runs (Table: model tiers). id is the internal key (paper tiers XXS..L),
  // label is what the page shows: the size in the model name CLAP2-<label>
  sizes: [
    { id: 'XXS', label: 'XXS', params: 27.3, color: '#0b7a3b' },
    { id: 'XS', label: 'XS', params: 48.3, color: '#7cb518' },
    { id: 'S', label: 'S', params: 103.9, color: '#e8a600' },
    { id: 'M', label: 'M', params: 152.8, color: '#ef6c1a' },
    { id: 'L', label: 'L', params: 340.1, color: '#c1121f' },
  ],

  // MAEB-30 mean score vs. compute, one point per samples-seen scale
  // (1M, 2M, ..., 1024M). [log10(GFLOPs), score]. Extracted from the vector figure.
  curves: {
    XXS: [[7.894, 0.2839], [8.195, 0.2988], [8.496, 0.3181], [8.798, 0.338], [9.099, 0.3444], [9.4, 0.3625], [9.701, 0.3795], [10.002, 0.4025], [10.303, 0.4288], [10.604, 0.4491], [10.905, 0.4623]],
    XS: [[8.147, 0.2877], [8.448, 0.3092], [8.749, 0.329], [9.05, 0.3467], [9.351, 0.3623], [9.653, 0.3639], [9.954, 0.3878], [10.255, 0.4201], [10.556, 0.4633], [10.857, 0.48], [11.158, 0.4908]],
    S: [[8.491, 0.2972], [8.793, 0.3179], [9.093, 0.3307], [9.395, 0.3535], [9.696, 0.3585], [9.997, 0.3846], [10.298, 0.4022], [10.599, 0.4437], [10.9, 0.4683], [11.201, 0.5083], [11.502, 0.5181]],
    M: [[8.661, 0.2989], [8.962, 0.3105], [9.264, 0.3271], [9.565, 0.3493], [9.866, 0.3584], [10.167, 0.3708], [10.468, 0.4001], [10.769, 0.4494], [11.07, 0.4794], [11.371, 0.5025], [11.672, 0.5231]],
    L: [[9.031, 0.2913], [9.332, 0.3067], [9.633, 0.326], [9.934, 0.3361], [10.235, 0.3522], [10.536, 0.3742], [10.837, 0.4043], [11.138, 0.4512], [11.439, 0.4888], [11.74, 0.522]],
  },
  // Fitted scaling law reported in the paper: L(C) = A (C + e^B)^-alpha + E, C in GFLOPs.
  fit: { A: 2.38, B: 20.03, alpha: 0.0603, E: 0 },
  samplesSeen: ['1M', '2M', '4M', '8M', '16M', '32M', '64M', '128M', '256M', '512M', '1024M'],

  // Audio-text datasets (Table: LAION-Audio-XL compared to existing datasets)
  // access: 'public' = public (audio, captions with links to the audio, or a mix of public datasets),
  // 'closed' = not released, 'planned' = ours
  datasets: [
    { name: 'Clotho', hours: 37, captions: 30e3, audio: 6e3, access: 'public' },
    { name: 'AudioCaps', hours: 143, captions: 57e3, audio: 51e3, access: 'public' },
    { name: 'WavCaps', hours: 7.6e3, captions: 403e3, audio: 403e3, access: 'public' },
    { name: 'LAION-Audio-630K', hours: 4.3e3, captions: 634e3, audio: 634e3, access: 'public' },
    { name: 'Auto-ACD', hours: 5.3e3, captions: 1.9e6, audio: 1.9e6, access: 'public' },
    { name: 'SALMONN-2', hours: 18.2e3, captions: 8.9e6, audio: null, access: 'public' },
    { name: 'Audio Flamingo 3', hours: 54.4e3, captions: 26.8e6, audio: null, access: 'public' },
    { name: 'LAION-BVD', hours: 27e3, captions: 10e6, audio: 10e6, access: 'public' },
    { name: 'AutoReCap-XL', hours: 124e3, captions: 47e6, audio: 47e6, access: 'public' },
    { name: 'Dasheng mix', hours: 272e3, captions: null, audio: 97e6, access: 'public' },
    { name: 'SLAP (MovieGen Audio)', hours: 1e6, captions: 109e6, audio: 109e6, access: 'closed' },
    { name: 'Bagpiper', hours: 933e3, captions: 392e6, audio: 392e6, access: 'public' },
    { name: 'GLAP mix', hours: 435e3, captions: 445e6, audio: 445e6, access: 'public' },
    { name: 'LAION-Audio-XL-500M', hours: 3.35e6, captions: 970e6, audio: 500e6, ours: true, access: 'planned' },
    { name: 'LAION-Audio-XL', hours: 1.39e6, captions: 707e6, audio: 365e6, ours: true, access: 'planned' },
  ],

  // Sound taxonomy (thesis, appendix C.1 and its radial figure): 4,416 nodes, 4,085 leaves, 11 top-level groups,
  // 837 second-level categories. cats: the second-level categories the figure names, [name, leaves, audio samples
  // by predicted label]; more: [omitted categories, their leaves]. Names cut short in the figure are written out.
  taxonomy: {
    nodes: 4416, leaves: 4085, cats: 837, levels: [11, 837, 3150, 393, 25], classes: 3718,
    // share of clips by predicted top-level label: the deduplicated pool and LAION-Audio-XL
    mix: { pool: { speech: 75.3, music: 11.7 }, final: { speech: 44.8, music: 22.4, sfx: 16.6, other: 16.2 } },
    groups: [
      { id: 'speech', name: 'Speech', more: [346, 396], cats: [
        ['Noisy in-the-wild speech', 98, 84e6], ['Non-English broadcast', 32, 10e6], ['Instructional / tutorial', 27, 98e6],
        ['Emotional / expressive speech', 21, 11e6], ['Acted / dramatic speech', 20, 22e6], ["Let's play / video game commentary", 20, 14e6],
        ['Isolated word / phrase', 10, 28e6], ['Audiobook narration', 10, 6.2e6], ['Monologue / spoken word', 4, 80e6],
        ['Non-English monologue', 2, 42e6], ['Public speaking / lecture', 2, 40e6], ['Spontaneous conversation', 1, 99e6],
        ['Dialogue / multi-party conversation', 1, 56e6], ['Vlog / social media speech', 1, 29e6]] },
      { id: 'music', name: 'Music', more: [62, 823], cats: [
        ['World / regional music', 204, 9.2e6], ['Solo instrumental music', 194, 23e6], ['Folk / traditional music', 163, 5.6e6],
        ['Rock / metal-based music', 100, 12e6], ['Electronic music', 96, 25e6], ['Jazz / blues-based music', 90, 6.8e6],
        ['Film / game / media scores', 22, 22e6]] },
      { id: 'sfx', name: 'Designed sound effects', more: [147, 204], cats: [
        ['Foley', 163, 9.5e6], ['Cinematic SFX', 49, 22e6], ['Synthesized / abstract', 32, 2.4e6], ['Cinematic / trailer sounds', 24, 257e3],
        ['Ambiences / soundscapes', 16, 4.6e6], ['Interface / UI sounds', 11, 8e3], ['Game SFX', 10, 39e6], ['Gunshots / gunfire', 9, 1.8e6],
        ['Fantasy / sci-fi', 8, 356e3], ['Video game sound effects', 5, 4.4e6]] },
      { id: 'human', name: 'Human non-speech', more: [28, 109], cats: [
        ['Vocalization (non-speech)', 96, 2.6e6], ['Locomotion (human)', 37, 3.5e6], ['Crowd human activity', 33, 4.6e6],
        ['Coughing / sneezing', 17, 282e3]] },
      { id: 'animal', name: 'Animal / bioacoustics', more: [0, 0], cats: [
        ['Birds', 127, 10e6], ['Mammals', 71, 6.3e6], ['Amphibians', 19, 213e3], ['Insects', 16, 948e3], ['Reptiles', 4, 23],
        ['Livestock / domesticated', 1, 1e3], ['Mixed multi-species vocalizations', 1, 404], ['Aquatic (non-mammal)', 1, 0]] },
      { id: 'urban', name: 'Urban / transport', more: [34, 89], cats: [
        ['Road vehicles', 77, 15e6], ['Rail transport', 28, 4.1e6], ['Public transit / stations', 14, 958e3], ['Construction', 13, 63e3],
        ['Urban park ambience', 1, 856e3]] },
      { id: 'domestic', name: 'Domestic / household', more: [62, 83], cats: [
        ['Kitchen / food preparation', 44, 1.3e6], ['Doors / windows', 25, 1.3e6], ['Appliances', 15, 260e3], ['Bathroom', 9, 453e3],
        ['Toys and games', 7, 41e3], ['Paper / book handling', 1, 1.3e6], ['General household activity', 1, 444e3]] },
      { id: 'industrial', name: 'Industrial / mechanical', more: [32, 45], cats: [
        ['Machinery (generic)', 35, 3.0e6], ['Hand tools', 16, 8e3], ['Factory / production line', 11, 38e3], ['Engines', 7, 283e3],
        ['Power tools', 5, 230e3]] },
      { id: 'interface', name: 'Interface / electronic', more: [17, 32], cats: [
        ['UI sounds', 16, 2.5e6], ['Alarms / warning signals', 8, 1.0e6], ['Phone interfaces', 8, 124e3], ['Keystrokes / typing', 4, 1.4e6]] },
      { id: 'nature', name: 'Nature / environmental', more: [0, 0], cats: [
        ['Water', 16, 5.6e6], ['Weather', 9, 1.5e6], ['Wind', 8, 460e3], ['Geological / earth', 5, 553], ['Fire', 4, 737e3],
        ['Vegetation / forest', 4, 34e3], ['Park outdoor nature ambience', 1, 22e3], ['Water, birdsong and leaves', 1, 17e3]] },
      { id: 'sports', name: 'Sports / recreation', more: [32, 32], cats: [
        ['Throwing sports', 4, 2.2e6], ['Athletics / track and field', 3, 212e3], ['Racket / ball sports', 2, 200e3],
        ['Field hockey', 1, 825e3], ['Basketball', 1, 424e3]] },
    ],
  },

  // Demo clips for taxonomy categories, keyed "<group id>/<category name as in taxonomy.groups>".
  // An entry is either { sample: '<id in samples>' } (reuses a training sample shown on the page) or
  // { src, caption }. Categories without an entry have no demo clip.
  // Written by tools/import_taxonomy_audio.py, which keeps entries it does not replace.
  // taxonomy-audio:start
  taxonomyAudio: {
    "speech/Noisy in-the-wild speech": {"sample": "03-speech"},
    "music/World / regional music": {"sample": "02-music"},
    "music/Choral / choir music": {"src": "assets/audio/taxonomy/a-south-african-isicathamiya-choir-singing-harmoniously-in-a.mp3", "caption": "A South African isicathamiya choir singing harmoniously in a traditional acapella style", "example": true},
    "sfx/Cartoon / comedic sound effects": {"src": "assets/audio/taxonomy/a-accordion-is-speaking.mp3", "caption": "A accordion is Speaking", "example": true},
    "speech/Public speaking / lecturing": {"src": "assets/audio/taxonomy/a-audience-is-applausing-while-a-angry-man-is-speaking-in-th.mp3", "caption": "A audience is applausing while a angry man is speaking in the end", "example": true},
    "human/Infant / baby sounds": {"src": "assets/audio/taxonomy/a-baby-s-giggles-during-peek-a-boo-play.mp3", "caption": "A baby s giggles during peek-a-boo play", "example": true},
    "sfx/Foley": {"src": "assets/audio/taxonomy/a-balloon-popping-with-a-cheerful-bang.mp3", "caption": "A balloon popping with a cheerful bang", "example": true},
    "music/Jazz / blues-based music": {"src": "assets/audio/taxonomy/a-beautiful-jazz-music-made-by-piano.mp3", "caption": "A beautiful jazz music made by piano", "example": true},
    "animal/Birds": {"src": "assets/audio/taxonomy/a-bird-s-chirp-greeting-the-morning-sun.mp3", "caption": "A bird s chirp greeting the morning sun", "example": true},
    "urban/Road vehicles": {"src": "assets/audio/taxonomy/a-car-engine-purring-softly-at-a-red-light.mp3", "caption": "A car engine purring softly at a red light", "example": true},
    "animal/Mammals": {"src": "assets/audio/taxonomy/a-cat-purring-contentedly-in-a-cozy-home.mp3", "caption": "A cat purring contentedly in a cozy home", "example": true},
    "music/Pop music": {"src": "assets/audio/taxonomy/a-catchy-pop-song-with-infectious-hooks-and-a-memorable-chor.mp3", "caption": "A catchy pop song with infectious hooks and a memorable chorus, sticking in the mind", "example": true},
    "music/Hip-hop / rap-based music": {"src": "assets/audio/taxonomy/a-catchy-trap-beat-with-edm-synthesizers-in-the-mix-creating.mp3", "caption": "A catchy trap beat with EDM Synthesizers in the mix, creating a unique electronic sound with ethereal quality", "example": true},
    "music/Solo instrumental music": {"src": "assets/audio/taxonomy/a-cheerful-ukulele-strumming-in-a-beachside-jam-spreading-a-.mp3", "caption": "A cheerful ukulele strumming in a beachside jam, spreading a carefree and sunny vibe", "example": true},
    "animal/Amphibians": {"src": "assets/audio/taxonomy/a-choir-of-frogs-singing-in-a-pond.mp3", "caption": "A choir of frogs singing in a pond", "example": true},
    "sfx/Fantasy / sci-fi": {"src": "assets/audio/taxonomy/a-chorus-of-laughter-from-creatures-of-folklore-each-with-it.mp3", "caption": "A chorus of laughter from creatures of folklore, each with its own unique sound", "example": true},
    "music/Orchestral music": {"src": "assets/audio/taxonomy/a-classical-orchestra-performing-a-grand-symphony.mp3", "caption": "A classical orchestra performing a grand symphony", "example": true},
    "domestic/Kitchen / food preparation": {"src": "assets/audio/taxonomy/a-coffee-machine-brewing-a-fresh-cup.mp3", "caption": "A coffee machine brewing a fresh cup", "example": true},
    "domestic/Object handling / placement sounds": {"src": "assets/audio/taxonomy/a-corkboard-being-pinned-with-notes.mp3", "caption": "A corkboard being pinned with notes", "example": true},
    "nature/Fire": {"src": "assets/audio/taxonomy/a-crackling-campfire-in-the-midst-of-a-peaceful-forest.mp3", "caption": "A crackling campfire in the midst of a peaceful forest", "example": true},
    "urban/Church bell ringing": {"src": "assets/audio/taxonomy/a-distant-church-bell-chiming-noon.mp3", "caption": "A distant church bell chiming noon", "example": true},
    "industrial/Power tools": {"src": "assets/audio/taxonomy/a-distant-lawnmower-on-a-sunny-day.mp3", "caption": "A distant lawnmower on a sunny day", "example": true},
    "urban/Sirens / alarms (urban)": {"src": "assets/audio/taxonomy/a-distant-siren-wailing-through-the-city.mp3", "caption": "A distant siren wailing through the city", "example": true},
    "nature/Weather": {"src": "assets/audio/taxonomy/a-distant-thunderstorm-rumbling-softly.mp3", "caption": "A distant thunderstorm rumbling softly", "example": true},
    "domestic/Doors / windows / locks": {"src": "assets/audio/taxonomy/a-door-creaking-open-slowly.mp3", "caption": "A door creaking open slowly", "example": true},
    "domestic/Doors / windows / barriers": {"src": "assets/audio/taxonomy/a-doorbell-ringing-to-announce-a-guest.mp3", "caption": "A doorbell ringing to announce a guest", "example": true},
    "music/Religious / spiritual music": {"src": "assets/audio/taxonomy/a-dramatic-and-powerful-church-organ-in-a-majestic-cathedral.mp3", "caption": "A dramatic and powerful church organ in a majestic cathedral, elevating spiritual experiences", "example": true},
    "music/Country music": {"src": "assets/audio/taxonomy/a-fast-paced-banjo-picking-in-a-bluegrass-jam-session-creati.mp3", "caption": "A fast-paced banjo picking in a bluegrass jam session, creating a toe-tapping and lively atmosphere", "example": true},
    "music/Folk / traditional music": {"src": "assets/audio/taxonomy/a-folk-band-playing-foot-stomping-tunes-at-a-barn-dance-brin.mp3", "caption": "A folk band playing foot-stomping tunes at a barn dance, bringing people together with infectious melodies", "example": true},
    "music/Electronic music": {"src": "assets/audio/taxonomy/a-fusion-band-blending-jazz-funk-and-electronic-elements-cre.mp3", "caption": "A fusion band blending jazz, funk, and electronic elements, creating a genre-defying musical journey", "example": true},
    "nature/Wind": {"src": "assets/audio/taxonomy/a-gentle-breeze-rustling-through-trees.mp3", "caption": "A gentle breeze rustling through trees", "example": true},
    "sfx/Foley / physical impact sounds": {"src": "assets/audio/taxonomy/a-gentle-tap-of-fingers-on-a-tabletop.mp3", "caption": "A gentle tap of fingers on a tabletop", "example": true},
    "human/Screaming / shouting": {"src": "assets/audio/taxonomy/a-girl-screaming-in-reaction-to-something-horrifying.mp3", "caption": "A girl screaming in reaction to something horrifying", "example": true},
    "music/Classical / art music": {"src": "assets/audio/taxonomy/a-grand-piano-performing-a-romantic-concerto-its-powerful-an.mp3", "caption": "A grand piano performing a romantic concerto, its powerful and emotive performance filling the concert hall", "example": true},
    "music/Percussion-only / rhythm ensemble music": {"src": "assets/audio/taxonomy/a-group-of-friends-drumming-on-african-djembe-drums-connecti.mp3", "caption": "A group of friends drumming on African djembe drums, connecting with the rhythms of their ancestors", "example": true},
    "music/Beat-driven / rhythmic music": {"src": "assets/audio/taxonomy/a-group-of-friends-drumming-on-african-djembe-drums-creating.mp3", "caption": "A group of friends drumming on African djembe drums, creating lively and rhythmic beats that connect with the soul", "example": true},
    "music/Band / group performance": {"src": "assets/audio/taxonomy/a-group-of-friends-jamming-together-with-diverse-instruments.mp3", "caption": "A group of friends jamming together with diverse instruments, creating a harmonious fusion of styles", "example": true},
    "music/Film / game / media score": {"src": "assets/audio/taxonomy/a-hauntingly-beautiful-violin-melody-in-a-film-score-evoking.mp3", "caption": "A hauntingly beautiful violin melody in a film score, evoking deep emotions and enhancing storytelling", "example": true},
    "domestic/Appliances": {"src": "assets/audio/taxonomy/a-humming-refrigerator-in-a-quiet-kitchen.mp3", "caption": "A humming refrigerator in a quiet kitchen", "example": true},
    "human/Vocalization (non-speech)": {"src": "assets/audio/taxonomy/a-kid-is-whistling-in-a-studio.mp3", "caption": "A kid is whistling in a studio", "example": true},
    "sfx/Ambiences / soundscapes": {"src": "assets/audio/taxonomy/a-modern-synthesizer-creating-futuristic-soundscapes-transpo.mp3", "caption": "A modern synthesizer creating futuristic soundscapes, transporting listeners to a world of electronic wonders", "example": true},
    "interface/Phone interfaces": {"src": "assets/audio/taxonomy/a-phone-ringing-in-an-empty-hallway.mp3", "caption": "A phone ringing in an empty hallway", "example": true},
    "music/Children's music": {"src": "assets/audio/taxonomy/a-playful-glockenspiel-in-a-whimsical-children-s-song-sparki.mp3", "caption": "A playful glockenspiel in a whimsical children s song, sparking imaginations", "example": true},
    "music/Rock / metal-based music": {"src": "assets/audio/taxonomy/a-psychedelic-rock-band-pushing-sonic-boundaries-with-experi.mp3", "caption": "A psychedelic rock band pushing sonic boundaries with experimental guitar riffs and effects", "example": true},
    "music/Dance / club music": {"src": "assets/audio/taxonomy/a-thunderous-bassline-driving-an-energetic-dance-track-rever.mp3", "caption": "A thunderous bassline driving an energetic dance track, reverberating through the body and igniting the dance floor", "example": true},
    "domestic/Clock ticking / chiming": {"src": "assets/audio/taxonomy/a-ticking-clock-on-the-wall.mp3", "caption": "A ticking clock on the wall", "example": true},
    "human/Locomotion (human body)": {"src": "assets/audio/taxonomy/a-toddler-s-footsteps-on-a-wooden-floor.mp3", "caption": "A toddler s footsteps on a wooden floor", "example": true},
    "domestic/Toys and games": {"src": "assets/audio/taxonomy/a-toy-train-chugging-on-its-tracks.mp3", "caption": "A toy train chugging on its tracks", "example": true},
    "urban/Rail transport": {"src": "assets/audio/taxonomy/a-train-whistle-blowing-in-the-distance.mp3", "caption": "A train whistle blowing in the distance", "example": true},
    "nature/Water": {"src": "assets/audio/taxonomy/a-waterfall-cascading-down-rocky-cliffs.mp3", "caption": "A waterfall cascading down rocky cliffs", "example": true},
    "human/Crowd human activity": {"src": "assets/audio/taxonomy/an-excited-crowd-cheering-at-a-sports-game.mp3", "caption": "An excited crowd cheering at a sports game", "example": true},
    "interface/Keystrokes / typing": {"src": "assets/audio/taxonomy/an-old-fashioned-typewriter-clacking.mp3", "caption": "An old-fashioned typewriter clacking", "example": true},
    "animal/Insects": {"src": "assets/audio/taxonomy/bees-buzzing-among-colorful-wildflowers.mp3", "caption": "Bees buzzing among colorful wildflowers", "example": true},
    "urban/Urban park ambience": {"src": "assets/audio/taxonomy/children-laughing-and-playing-in-a-sunny-park.mp3", "caption": "Children laughing and playing in a sunny park", "example": true},
    "music/Solo vocal music": {"src": "assets/audio/taxonomy/children-singing-a-happy-nursery-rhyme.mp3", "caption": "Children singing a happy nursery rhyme", "example": true},
    "sfx/Liquid sounds": {"src": "assets/audio/taxonomy/cracking-open-a-fizzy-soda-can.mp3", "caption": "Cracking open a fizzy soda can", "example": true},
    "human/Laughter": {"src": "assets/audio/taxonomy/laughter-and-chatter-at-a-lively-party.mp3", "caption": "Laughter and chatter at a lively party", "example": true},
    "urban/Parade or outdoor festival crowd ambience": {"src": "assets/audio/taxonomy/laughter-and-cheers-at-a-festive-carnival.mp3", "caption": "Laughter and cheers at a festive carnival", "example": true},
    "nature/Vegetation / forest movement": {"src": "assets/audio/taxonomy/leaves-crunching-underfoot-in-the-woods.mp3", "caption": "Leaves crunching underfoot in the woods", "example": true},
    "music/Ambient music": {"src": "assets/audio/taxonomy/musical-constellations-twinkling-in-the-night-sky-forming-a-.mp3", "caption": "Musical constellations twinkling in the night sky, forming a cosmic melody", "example": true},
    "domestic/Paper / book handling": {"src": "assets/audio/taxonomy/pages-turning-in-a-captivating-book.mp3", "caption": "Pages turning in a captivating book", "example": true},
    "domestic/Cleaning": {"src": "assets/audio/taxonomy/the-clatter-of-dishes-in-a-bustling-diner.mp3", "caption": "The clatter of dishes in a bustling diner", "example": true},
    "interface/Electronic glitches": {"src": "assets/audio/taxonomy/the-crackle-of-vinyl-playing-on-a-record-player.mp3", "caption": "The crackle of vinyl playing on a record player", "example": true},
    "nature/Geological / earth": {"src": "assets/audio/taxonomy/the-heartbeat-of-the-earth-itself-pulsating-through-the-land.mp3", "caption": "The heartbeat of the Earth itself, pulsating through the landscape with a rhythmic cadence", "example": true},
    "domestic/Home media / entertainment": {"src": "assets/audio/taxonomy/the-hum-of-an-old-record-player.mp3", "caption": "The hum of an old record player", "example": true},
    "sfx/Synthesized / abstract": {"src": "assets/audio/taxonomy/the-hypnotic-pulse-of-electronic-dance-music-with-infectious.mp3", "caption": "The hypnotic pulse of electronic dance music, with infectious beats and mesmerizing synths setting the dance floor on fire", "example": true},
    "domestic/Keys jingle": {"src": "assets/audio/taxonomy/the-jingle-of-keys-in-someone-s-hand.mp3", "caption": "The jingle of keys in someone s hand", "example": true},
    "sfx/Cork pop from bottle": {"src": "assets/audio/taxonomy/the-pop-of-a-cork-from-a-champagne-bottle.mp3", "caption": "The pop of a cork from a champagne bottle", "example": true},
    "music/Meditative / wellness music": {"src": "assets/audio/taxonomy/the-resonating-sound-of-tibetan-singing-bowls-inducing-a-sen.mp3", "caption": "The resonating sound of Tibetan singing bowls, inducing a sense of tranquility and mindfulness", "example": true},
    "music/Small ensemble / chamber music": {"src": "assets/audio/taxonomy/the-rich-resonance-of-a-cello-in-a-chamber-ensemble.mp3", "caption": "The rich resonance of a cello in a chamber ensemble", "example": true},
    "sports/Basketball": {"src": "assets/audio/taxonomy/the-swish-of-a-basketball-through-the-air.mp3", "caption": "The swish of a basketball through the air", "example": true},
    "sfx/Cinematic SFX": {"src": "assets/audio/taxonomy/the-whoosh-of-a-kite-soaring-in-the-sky.mp3", "caption": "The whoosh of a kite soaring in the sky", "example": true},
    "domestic/Indoor water fountain ambience": {"src": "assets/audio/taxonomy/water-splashing-in-a-playful-fountain.mp3", "caption": "Water splashing in a playful fountain", "example": true}
  },
  // taxonomy-audio:end

  // MAEB-30 mean (Table: MAEB-30 results). params in millions.
  maeb: [
    { n: 'LCO-Embedding-Omni-7B', p: 8900, s: 53.5 },
    { n: 'e5-omni-7B', p: 8900, s: 52.5 },
    { n: 'BidirLM-Omni-2.5B', p: 2400, s: 52.4 },
    { n: 'LCO-Embedding-Omni-3B', p: 4700, s: 52.3 },
    { n: 'jina-v5-omni-small', p: 1600, s: 50.4 },
    { n: 'e5-omni-3B', p: 4700, s: 48.0 },
    { n: 'OmniEmbed-v0.1', p: 8900, s: 43.9 },
    { n: 'fusion-embedding-2-2b', p: 2800, s: 40.2 },
    { n: 'Qwen2-Audio-7B', p: 7000, s: 34.5 },
    { n: 'EBind', p: 1800, s: 32.8 },
    { n: 'Qwen2.5-Omni-7B', p: 10700, s: 24.2 },
    { n: 'Qwen2.5-Omni-3B', p: 5500, s: 23.4 },
    { n: 'jina-v5-omni-nano', p: 986, s: 51.8 },
    { n: 'EmbeddingGemma 2', p: 744, s: 49.4 },
    { n: 'GLAP', p: 855, s: 44.1 },
    { n: 'M2D-CLAP', p: 199, s: 38.0 },
    { n: 'MS-CLAP 2023', p: 160, s: 37.3 },
    { n: 'TP-CLAP', p: 198, s: 37.2 },
    { n: 'CLAP-IPA small', p: 174, s: 36.5 },
    { n: 'LAION Larger CLAP', p: 194, s: 36.2 },
    { n: 'AudioVerse CLAP', p: 144, s: 36.0 },
    { n: 'LAION-CLAP', p: 153, s: 35.2 },
    { n: 'MuQ-MuLan-large', p: 630, s: 28.9 },
    { n: 'wav2clip', p: 163, s: 28.3 },
    { n: 'SpeechT5 multimodal', p: 298, s: 26.7 },
  ],

  // HEAR mean over 17 tasks (Table: HEAR results). t: true = audio-text model.
  hear: [
    { n: 'USAD 2.0-XXLarge+', p: 1000, s: 86.8 },
    { n: 'USAD 2.0-XLarge+', p: 695, s: 86.8 },
    { n: 'USAD 2.0-Large+', p: 336, s: 86.4 },
    { n: 'AF3 Whisper encoder', p: 637, s: 85.6 },
    { n: 'USAD 2.0-Large', p: 336, s: 84.8 },
    { n: 'USAD 2.0-XLarge', p: 695, s: 84.5 },
    { n: 'USAD 2.0-Base', p: 97, s: 83.8 },
    { n: 'Dasheng-1.2B', p: 1200, s: 83.7 },
    { n: 'USAD 2.0-Small', p: 25, s: 83.0 },
    { n: 'USAD-Large', p: 330, s: 81.8 },
    { n: 'USAD-Base', p: 94, s: 81.4 },
    { n: 'Dasheng-Base', p: 86, s: 81.4 },
    { n: 'USAD-Small', p: 24, s: 80.1 },
    { n: 'GURA Fuse Cat H+w+C', p: 1300, s: 79.6 },
    { n: 'RedRice ced_base', p: 86, s: 79.0 },
    { n: 'Hybrid BYOL-S/CvT', p: 5, s: 77.9 },
    { n: 'RedRice ced_small', p: 22, s: 77.1 },
    { n: 'BYOL-S/CvT', p: 5, s: 76.2 },
    { n: 'BEATs Iter3+', p: 90, s: 75.7 },
    { n: 'RedRice ced_mini', p: 9.6, s: 75.4 },
    { n: 'CP-JKU mn40_as', p: 68.4, s: 73.4 },
    { n: 'Logitech SERAB BYOL-S', p: 5.3, s: 73.4 },
    { n: 'GURA Fuse wav2vec2', p: 315, s: 73.2 },
    { n: 'OpenL3', p: 4.7, s: 70.8 },
    { n: 'CP-JKU PaSST', p: 86, s: 70.0 },
    { n: 'wav2vec2', p: 315, s: 67.7 },
    { n: 'GURA Hubert', p: 963, s: 67.5 },
    { n: 'RedRice EfficientNet-B2', p: 7.7, s: 66.0 },
    { n: 'CREPE', p: 22.2, s: 54.6 },
    { n: 'AMAAI wav2vec2', p: 95, s: 48.6 },
    { n: 'jina-v5-omni-nano', p: 986, s: 80.7, t: true },
    { n: 'M2D-CLAP', p: 199, s: 80.6, t: true },
    { n: 'BidirLM-Omni-2.5B', p: 2400, s: 80.3, t: true },
    { n: 'LCO-Embedding-Omni-7B', p: 8900, s: 79.8, t: true },
    { n: 'LCO-Embedding-Omni-3B', p: 4700, s: 79.5, t: true },
    { n: 'Qwen2-Audio-7B', p: 7000, s: 79.5, t: true },
    { n: 'jina-v5-omni-small', p: 1600, s: 78.1, t: true },
    { n: 'e5-omni-7B', p: 8900, s: 81.2, t: true },
    { n: 'e5-omni-3B', p: 4700, s: 79.7, t: true },
    { n: 'OmniEmbed-v0.1', p: 8900, s: 79.7, t: true },
    { n: 'Qwen2.5-Omni-7B', p: 10700, s: 75.2, t: true },
    { n: 'Qwen2.5-Omni-3B', p: 5500, s: 74.1, t: true },
    { n: 'MS-CLAP 2023', p: 160, s: 75.1, t: true },
    { n: 'GLAP', p: 855, s: 71.8, t: true },
    { n: 'fusion-embedding-2-2b', p: 2800, s: 71.2, t: true },
    { n: 'MuQ-MuLan-large', p: 630, s: 69.3, t: true },
    { n: 'EmbeddingGemma 2', p: 744, s: 69.1, t: true },
    { n: 'SpeechT5 multimodal', p: 298, s: 67.3, t: true },
    { n: 'LAION-CLAP', p: 153, s: 69.2, t: true },
    { n: 'LAION Larger CLAP', p: 194, s: 69.5, t: true },
    { n: 'EBind', p: 1800, s: 65.0, t: true },
    { n: 'MS-CLAP 2022', p: 196, s: 63.2, t: true },
    { n: 'wav2clip', p: 163, s: 56.8, t: true },
  ],

  ours: [
    { n: 'CLAP2-XXS', id: 'XXS', label: 'XXS', p: 27.3, maeb: 46.2, hear: 79.1 },
    { n: 'CLAP2-XS', id: 'XS', label: 'XS', p: 48.3, maeb: 49.1, hear: 80.6 },
    { n: 'CLAP2-S', id: 'S', label: 'S', p: 103.9, maeb: 51.8, hear: 81.8 },
    { n: 'CLAP2-M', id: 'M', label: 'M', p: 152.8, maeb: 52.3, hear: 81.4 },
    { n: 'CLAP2-L', id: 'L', label: 'L', p: 340.1, maeb: 53.6, hear: 81.9 },
  ],

  // First public release (paper or checkpoint) of the CLAP-style models in the MAEB-30 list, as a
  // fractional year, for the progress chart. VERIFY before publishing: filled in from the papers'
  // arXiv dates as far as known. TP-CLAP and AudioVerse CLAP are left out until their dates are known.
  releases: [
    ['wav2clip', 2021.8],
    ['LAION-CLAP', 2022.85],
    ['LAION Larger CLAP', 2023.3],
    ['MS-CLAP 2023', 2023.7],
    ['M2D-CLAP', 2024.45],
    ['CLAP-IPA small', 2024.55],
    ['MuQ-MuLan-large', 2025.05],
    ['GLAP', 2025.45],
  ],
  oursRelease: 2026.8,

  // Paper Table 2, audio-text models below 1B parameters: [name, params (M), mean, speech, music, sound]
  maebSmall: [
    ['jina-embeddings-v5-omni-nano', 986, 51.8, 53.5, 73.8, 24.7],
    ['EmbeddingGemma 2', 744, 49.4, 56.6, 61.4, 15.7],
    ['GLAP', 855, 44.1, 42.4, 69.6, 23.4],
    ['M2D-CLAP', 199, 38.0, 30.0, 69.7, 29.9],
    ['MS-CLAP 2023', 160, 37.3, 29.2, 68.0, 30.9],
    ['TP-CLAP', 198, 37.2, 28.6, 67.0, 33.3],
    ['CLAP-IPA small', 174, 36.5, 41.4, 50.5, 8.1],
    ['LAION Larger CLAP', 194, 36.2, 27.1, 70.3, 29.6],
    ['AudioVerse CLAP', 144, 36.0, 27.8, 64.2, 32.7],
    ['LAION-CLAP HTSAT unfused', 153, 35.2, 26.4, 68.4, 28.3],
    ['MuQ-MuLan-large', 630, 28.9, 23.1, 64.9, 10.6],
    ['wav2clip', 163, 28.3, 24.1, 58.0, 11.3],
    ['SpeechT5 multimodal', 298, 26.7, 26.0, 46.5, 9.1],
  ],
  maebOurs: [
    ['CLAP2-XXS', 27, 46.2, 46.0, 69.2, 23.9],
    ['CLAP2-XS', 48, 49.1, 48.8, 72.1, 26.9],
    ['CLAP2-S', 104, 51.8, 52.4, 74.2, 27.6],
    ['CLAP2-M', 153, 52.3, 52.4, 76.1, 28.1],
    ['CLAP2-L', 340, 53.6, 54.6, 76.2, 27.9],
  ],

  // Contribution radar, after paper Fig. 1 but with our M model: MAEB-30 task-type means from paper Table 2 (multilabel is
  // part of classification, reranking part of retrieval; clustering is left out). best: per axis, the best of the other models
  // below 500M parameters (CLAP-IPA small for retrieval and zero-shot, LAION Larger CLAP for classification,
  // SpeechT5 multimodal for pair classification).
  radar: {
    axes: ['Retrieval', 'Classification', 'Pair classification', 'Zero-shot'],
    sub: ['10 tasks', '12 tasks', '3 tasks', '2 tasks'],
    models: [
      { n: 'CLAP2-M', v: [52.6, 59.8, 61.8, 56.5], k: 'ours', mean: 52.3 },
      { n: 'Previous best <500M', v: [41.2, 52.2, 58.0, 53.5], k: 'best' },
      { n: 'LAION Larger CLAP 194M', v: [25.0, 52.2, 54.8, 15.4], k: 'laion' },
      { n: 'GLAP 855M', v: [47.3, 46.0, 56.4, 54.5], k: 'glap' },
    ],
  },

  // Thesis Fig. "compute-optimal allocation": best run per budget among the long WSD runs.
  // [log10 GFLOPs, N_opt (M params), D_opt (samples), interior minimum]
  allocation: [
    [9.676, 27.3, 64e6, false], [9.984, 27.3, 128e6, false], [10.285, 27.3, 256e6, false],
    [10.552, 48.3, 256e6, true], [10.852, 48.3, 512e6, true], [11.140, 103.9, 512e6, true],
    [11.436, 103.9, 1024e6, false], [11.704, 152.8, 1024e6, false],
  ],
  // N_opt = 180M (C/1e12)^0.405, D_opt = 1.8B (C/1e12)^0.583, fitted on C in [5e9, 5.5e11]
  allocFit: { n0: 180e6, a: 0.405, d0: 1.8e9, b: 0.583, lo: 5e9, hi: 5.5e11 },

  // Model tiers (thesis Tables "model tiers" and "forward-pass compute per tier"). Per tower: width d,
  // depth L, heads h, SwiGLU hidden size ff, parameters p in millions (audio includes the MAP pool and
  // projection; text includes pool and projection but not the token embeddings). emb: shared embedding
  // width; tok: the 50,260 x d_t token-embedding table (total minus both towers); gf: forward GFLOPs per
  // clip at the training length distribution (all: the reported total).
  arch: [
    { id: 'XXS', a: { d: 224, L: 12, h: 4, ff: 640, p: 8.3 }, t: { d: 224, L: 12, h: 4, ff: 640, p: 7.8 }, emb: 224, tok: 11.3, total: 27.3, gf: { a: 21.6, t: 4.6, all: 26.1 } },
    { id: 'XS', a: { d: 320, L: 12, h: 5, ff: 896, p: 16.6 }, t: { d: 320, L: 12, h: 5, ff: 896, p: 15.7 }, emb: 320, tok: 16.1, total: 48.3, gf: { a: 38.0, t: 8.8, all: 46.8 } },
    { id: 'S', a: { d: 512, L: 12, h: 8, ff: 1408, p: 41.8 }, t: { d: 512, L: 11, h: 8, ff: 1408, p: 36.4 }, emb: 512, tok: 25.7, total: 103.9, gf: { a: 83.8, t: 19.6, all: 103.4 } },
    { id: 'M', a: { d: 640, L: 12, h: 10, ff: 1728, p: 64.4 }, t: { d: 640, L: 11, h: 10, ff: 1728, p: 56.2 }, emb: 640, tok: 32.2, total: 152.8, gf: { a: 123.1, t: 29.8, all: 152.9 } },
    { id: 'L', a: { d: 1024, L: 12, h: 16, ff: 2816, p: 166.5 }, t: { d: 960, L: 11, h: 15, ff: 2560, p: 125.4 }, emb: 960, tok: 48.3, total: 340.1, gf: { a: 292.8, t: 65.1, all: 357.9 } },
  ],

  // Training samples of LAION-Audio-XL (plan500m_30s shards) with their captions and stored metadata.
  // Generated by tools/import_samples.py; audio (mono MP3) in assets/audio/samples/.
  samples: [
    {"id": "01-sound", "cat": "sound", "src": "assets/audio/samples/01-sound.mp3", "meta": {"start_sec": 0.0, "end_sec": 28.24, "youtube_id": "juAgwGFeJ6s", "youtube_title": "Т32 БАЗОЕВ Т. - ГРЕБЕННИКОВ С.", "tax_l1": "Sports & recreation", "tax_l1_prob": 0.991, "tax_l1_top3": [["Sports & recreation", 0.991]], "tax_l3": "Sports & recreation/Indoor sports practice ambience", "tax_l3_prob": 1.0, "decode_ok": true, "audio_valid": true, "duration": 28.24, "n_samples": 1355520, "rms_db": -24.3016, "mean_rms_db": -26.3885, "peak_db": -5.7775, "peak": 0.5142, "dynamic_range_db": 18.524, "dc_offset": 0.0, "silence_pct": 0.0045, "clip_pct": 0.0, "bandwidth_hz": 9023.9502, "spectral_centroid_hz": 2628.9014, "sr_orig": 48000, "json_variant": "sound_event", "tax_relabeled": true, "short_caption": "A crowd cheers and shouts during a table tennis match with racket and ball sounds.", "long_caption": "The audio captures the energetic atmosphere of an indoor table tennis match. The sharp, rapid sounds of a paddle striking a ball are prominent, accompanied by the squeaking of athletic shoes on a hard floor. Overlapping these game sounds, a crowd can be heard cheering and shouting in excitement, creating a lively and competitive ambience.", "captioning_model": "Qwen/Qwen3-Omni-30B-A3B-Instruct"}},
    {"id": "02-music", "cat": "music", "src": "assets/audio/samples/02-music.mp3", "meta": {"start_sec": 48.32, "end_sec": 77.9, "youtube_id": "SDG7AXvQb2s", "youtube_title": "13.07.2021 pm (Baraut)", "tax_l1": "Music", "tax_l1_prob": 0.8008, "tax_l1_top3": [["Music", 0.8008], ["Urban & transport", 0.0944], ["Sound effects & designed sounds", 0.0209]], "tax_l3": "Music/World & regional music", "tax_l3_prob": 0.4958, "maest_tags": ["Latin---Batucada", "Folk, World, & Country---Folk", "Folk, World, & Country---African", "Latin---Salsa", "Latin---Cumbia"], "maest_probs": [0.419, 0.065, 0.052, 0.039, 0.033], "tempo_bpm": 133.9, "music_key": "G# major", "top_energy_offsets_s": "16.0|17.0|18.0", "decode_ok": true, "audio_valid": true, "duration": 29.58, "n_samples": 1419840, "rms_db": -12.3906, "mean_rms_db": -13.3027, "peak_db": 0.0, "peak": 1.0, "dynamic_range_db": 12.3906, "dc_offset": 0.0, "silence_pct": 0.0, "clip_pct": 0.0003, "bandwidth_hz": 9511.7002, "spectral_centroid_hz": 2076.1541, "sr_orig": 48000, "json_variant": "music", "short_caption": "A Latin batucada percussion ensemble plays a fast, rhythmic, and energetic piece.", "long_caption": "A Latin batucada percussion ensemble plays a fast, rhythmic, and energetic piece. The music features a dense layering of various drums and metallic percussion instruments. Towards the end, a male voice speaks in Spanish, followed by a female voice saying 'gracias'.", "captioning_model": "Qwen/Qwen3-Omni-30B-A3B-Instruct"}},
    {"id": "03-speech", "cat": "speech", "src": "assets/audio/samples/03-speech.mp3", "meta": {"start_sec": 984.16, "end_sec": 1010.01, "youtube_id": "zHbtJ3ZdsxM", "youtube_title": "【AERO Tools 最強ブロワMK-1 vs RYOBIブロワー 】  車の洗車や車内のペットの毛や埃の掃除に最適 マキタ互換バッテリーの使用時間とモーターの耐久性検証", "tax_l1": "Speech", "tax_l1_prob": 0.8839, "tax_l1_top3": [["Speech", 0.8839], ["Urban & transport", 0.0337], ["Sound effects & designed sounds", 0.0252]], "tax_l3": "Speech/Noisy in-the-wild speech/Speech in motorsport environment", "tax_l3_prob": 0.2347, "age": 37.9, "gender": "male", "lang_id": "fij", "lang_prob": 0.073, "pitch_hz": 414.4, "emo_label": "sad", "top_energy_offsets_s": "15.0|24.0|18.0", "decode_ok": true, "audio_valid": true, "duration": 25.85, "n_samples": 1240800, "rms_db": -15.1653, "mean_rms_db": -18.5936, "peak_db": 0.0, "peak": 1.0, "dynamic_range_db": 15.1653, "dc_offset": 0.0002, "silence_pct": 0.0, "clip_pct": 0.0, "bandwidth_hz": 9303.2002, "spectral_centroid_hz": 1540.1075, "sr_orig": 48000, "json_variant": "speech", "short_caption": "Two men discuss a leaf blower's effectiveness, its motor whirring loudly.", "long_caption": "Two men speak in Japanese about a leaf blower's effectiveness, its loud motor whirring continuously in the background. They discuss how it removes water and debris from hard-to-reach areas, preventing water accumulation inside a car. The conversation also touches on the device's durability and battery life.", "captioning_model": "OpenMOSS-Team/MOSS-Audio-8B-Thinking"}},
  ],

  // Text-to-audio and audio-to-text retrieval on MAEB test sets: selected examples, not averages.
  // rank: position of the correct item in each model's ranking over the whole test set (1 = retrieved first).
  // Ours = CLAP2-L (340M) after 1,024M samples seen; GLAP = mispeech/GLAP; LAION = laion/larger_clap_general.
  // Generated from the server export (export_project_page.tar.gz); audio in assets/audio/retrieval/.
  // Re-import with tools/import_retrieval.py (export folder, project root).
  retrieval: {
    models: [
      { id: 'ours', name: 'CLAP2-L (340M)', sub: '1B samples seen', ours: true, logo: 'assets/logos/laion-audio-icon.svg' },
      { id: 'laion', name: 'LAION Larger CLAP', sub: 'larger_clap_general', logo: 'assets/logos/laion.svg' },
      { id: 'glap', name: 'GLAP', sub: '855M parameters' },
    ],
    categories: [
      { id: 'speech', name: 'Speech', text: 'Text → audio on FLEURS: a sentence has to find its spoken recording, in English and German.' },
      { id: 'music', name: 'Music', text: 'Audio → text on JamAlt: a sung line has to find its lyric among all lyric lines of the test set.' },
      { id: 'sound', name: 'Sound', text: 'Text → audio on Clotho and MACS. Three of the four captions only match if the order of events is right.' },
      { id: 'failure', name: 'Failure cases', short: 'Failures', text: 'Queries where CLAP2 ranks the correct item far down while a baseline gets it first.' },
    ],
    examples: [
      {"cat": "sound", "short": "Engine start", "source": "Clotho", "pool": 1045, "dir": "t2a", "query": "Clicking sounds are following by a revving engine, and then a low hum and a single, loud click", "target": "assets/audio/retrieval/01-target.mp3", "top": {"ours": {"rank": 1, "text": "A person puts a key into the ignition of a car and starts it", "ok": true, "src": "assets/audio/retrieval/01-target.mp3"}, "glap": {"rank": 67, "text": "A jackhammer is making loud sound while a saw makes high pitch and low murmuring in the background", "ok": false, "src": "assets/audio/retrieval/01-glap.mp3"}, "laion": {"rank": 64, "text": "A steady beeping goes on rhythmically along with tapping in the background", "ok": false, "src": "assets/audio/retrieval/01-laion.mp3"}}, "note": "Needs the order of events"},
      {"cat": "sound", "short": "Beep, then footsteps", "source": "MACS", "pool": 393, "dir": "t2a", "query": "starts with a beep sound then footsteps luggage with wheels dragged along hard floor baby crying and an adult talking at the end", "target": "assets/audio/retrieval/02-target.mp3", "top": {"ours": {"rank": 1, "text": "starts with a beep sound then footsteps luggage with wheels dragged along hard floor baby crying and an adult talking at the end", "ok": true, "src": "assets/audio/retrieval/02-target.mp3"}, "glap": {"rank": 17, "text": "traffic noise and adults chatting", "ok": false, "src": "assets/audio/retrieval/02-glap.mp3"}, "laion": {"rank": 1, "text": "starts with a beep sound then footsteps luggage with wheels dragged along hard floor baby crying and an adult talking at the end", "ok": true, "src": "assets/audio/retrieval/02-target.mp3"}}, "note": "Needs the order of events"},
      {"cat": "sound", "short": "Birds, then a shout", "source": "MACS", "pool": 393, "dir": "t2a", "query": "birds singing and child shouting at the end", "target": "assets/audio/retrieval/03-target.mp3", "top": {"ours": {"rank": 2, "text": "children playing and yelling while a person walks past", "ok": false, "src": "assets/audio/retrieval/03-ours.mp3"}, "glap": {"rank": 20, "text": "children speaking and many different bird sounds and wind", "ok": false, "src": "assets/audio/retrieval/03-glap.mp3"}, "laion": {"rank": 9, "text": "children speaking and many different bird sounds and wind", "ok": false, "src": "assets/audio/retrieval/03-glap.mp3"}}, "note": "Needs the order of events"},
      {"cat": "sound", "short": "Microphone and voices", "source": "MACS", "pool": 393, "dir": "t2a", "query": "a person speaks using a microphone and a few children and adults talk nearby", "target": "assets/audio/retrieval/10-target.mp3", "top": {"ours": {"rank": 1, "text": "a person speaks using a microphone and a few children and adults talk nearby", "ok": true, "src": "assets/audio/retrieval/10-target.mp3"}, "glap": {"rank": 272, "text": "kid is talking to someone in the park", "ok": false, "src": "assets/audio/retrieval/10-glap.mp3"}, "laion": {"rank": 16, "text": "a lot of people having a conversation probably in the large public area", "ok": false, "src": "assets/audio/retrieval/10-laion.mp3"}}},
      {"cat": "music", "short": "English song 1", "source": "JamAlt lyrics, English", "pool": null, "dir": "a2t", "query": "assets/audio/retrieval/04-query.mp3", "target": "The dead not so accursed", "top": {"ours": {"rank": 1, "text": "The dead not so accursed", "ok": true}, "glap": {"rank": 27, "text": "(Through all the lies and pain, oh)", "ok": false}, "laion": {"rank": 722, "text": "Now you barely look at me", "ok": false}}},
      {"cat": "music", "short": "English song 2", "source": "JamAlt lyrics, English", "pool": null, "dir": "a2t", "query": "assets/audio/retrieval/05-query.mp3", "target": "Doesn't listen, full of blow holes", "top": {"ours": {"rank": 1, "text": "Doesn't listen, full of blow holes", "ok": true}, "glap": {"rank": 72, "text": "I stayed with you through all the lies and pain, oh", "ok": false}, "laion": {"rank": 852, "text": "You're like the sun", "ok": false}}},
      {"cat": "music", "short": "French song", "source": "JamAlt lyrics, French", "pool": null, "dir": "a2t", "query": "assets/audio/retrieval/06-query.mp3", "target": "Ton cœur battrait plus fort, quand arrive l'été", "top": {"ours": {"rank": 1, "text": "Ton cœur battrait plus fort, quand arrive l'été", "ok": true}, "glap": {"rank": 82, "text": "Apaisé, vulnérable, attendant providence", "ok": false}, "laion": {"rank": 551, "text": "Comme un suppo à t'foutre dans le fion", "ok": false}}},
      {"cat": "speech", "short": "Lions, English", "source": "FLEURS, English", "pool": null, "dir": "t2a", "query": "lion prides act much like packs of wolves or dogs animals surprisingly similar to lions but not other big cats in behavior and also very deadly to their prey", "target": "assets/audio/retrieval/07-target.mp3", "top": {"ours": {"rank": 1, "text": "lion prides act much like packs of wolves or dogs animals surprisingly similar to lions but not other big cats in behavior and also very deadly to their prey", "ok": true, "src": "assets/audio/retrieval/07-target.mp3"}, "glap": {"rank": 3, "text": "oliver sacks in his paper the president's speech indicated how people who are unable to understand speech because of brain damage are nevertheless able to assess sincerity accurately", "ok": false, "src": "assets/audio/retrieval/07-glap.mp3"}, "laion": {"rank": 201, "text": "scotturb bus 403 travels regularly to sintra stopping at cabo da roca", "ok": false, "src": "assets/audio/retrieval/07-laion.mp3"}}},
      {"cat": "speech", "short": "Lions, German", "source": "FLEURS, German", "pool": null, "dir": "t2a", "query": "löwenrudel agieren ähnlich wie wolfs- oder hunderudel tiere die den löwen aber nicht anderen großkatzen im verhalten überraschend ähneln und ebenso tödlich gegenüber ihrer beute sind", "target": "assets/audio/retrieval/08-target.mp3", "top": {"ours": {"rank": 1, "text": "löwenrudel agieren ähnlich wie wolfs- oder hunderudel tiere die den löwen aber nicht anderen großkatzen im verhalten überraschend ähneln und ebenso tödlich gegenüber ihrer beute sind", "ok": true, "src": "assets/audio/retrieval/08-target.mp3"}, "glap": {"rank": 7, "text": "am 15. august 1940 fielen die alliierten in südfrankreich ein die invasion wurde operation dragoon genannt", "ok": false, "src": "assets/audio/retrieval/08-glap.mp3"}, "laion": {"rank": 73, "text": "europa ist ein relativ kleiner kontinent hat aber zahlreiche unabhängige länder normalerweise müsste man mehrfach visa beantragen und mehrere passkontrollen durchlaufen wenn man durch mehrere länder reisen möchte", "ok": false, "src": "assets/audio/retrieval/08-laion.mp3"}}},
      {"cat": "speech", "short": "Civilization, English", "source": "FLEURS, English", "pool": null, "dir": "t2a", "query": "the word civilization comes from the latin civilis meaning civil related to the latin civis meaning citizen and civitas meaning city or city-state and that also somehow defines the size of the society", "target": "assets/audio/retrieval/09-target.mp3", "top": {"ours": {"rank": 1, "text": "the word civilization comes from the latin civilis meaning civil related to the latin civis meaning citizen and civitas meaning city or city-state and that also somehow defines the size of the society", "ok": true, "src": "assets/audio/retrieval/09-target.mp3"}, "glap": {"rank": 73, "text": "although ai has a strong connotation of science fiction ai forms a very important branch of computer science dealing with behavior learning and intelligent adaptation in a machine", "ok": false, "src": "assets/audio/retrieval/09-glap.mp3"}, "laion": {"rank": 177, "text": "as a result two fish species have become extinct and two others have become endangered including the humpback chub", "ok": false, "src": "assets/audio/retrieval/09-laion.mp3"}}},
      {"cat": "failure", "short": "Bending metal", "source": "Clotho", "pool": 1045, "dir": "t2a", "query": "A small, thin sheet of metal is being bent back and forth", "target": "assets/audio/retrieval/11-target.mp3", "top": {"ours": {"rank": 521, "text": "Some grinding and some shoveling with a person talking at the end", "ok": false, "src": "assets/audio/retrieval/11-ours.mp3"}, "glap": {"rank": 1, "text": "Metal is bending back and forth in a continuous pattern", "ok": true, "src": "assets/audio/retrieval/11-target.mp3"}, "laion": {"rank": 1, "text": "Metal is bending back and forth in a continuous pattern", "ok": true, "src": "assets/audio/retrieval/11-target.mp3"}}},
      {"cat": "failure", "short": "Heavy rain", "source": "Clotho", "pool": 1045, "dir": "t2a", "query": "Rain falls with great force against the pavement", "target": "assets/audio/retrieval/12-target.mp3", "top": {"ours": {"rank": 547, "text": "An open air vehicle is travelling with tires rolling along a gravel roadway", "ok": false, "src": "assets/audio/retrieval/12-ours.mp3"}, "glap": {"rank": 6, "text": "Water is running and splashing at the same level of volume", "ok": false, "src": "assets/audio/retrieval/12-glap.mp3"}, "laion": {"rank": 1, "text": "Heavy rain pouring down from the sky to the ground", "ok": true, "src": "assets/audio/retrieval/12-target.mp3"}}},
      {"cat": "failure", "short": "Sung line", "source": "JamAlt lyrics, English", "pool": null, "dir": "a2t", "query": "assets/audio/retrieval/13-query.mp3", "target": "Tears are like diamonds in my eyes", "top": {"ours": {"rank": 76, "text": "Tears roll down my eyes (down my eyes)", "ok": false}, "glap": {"rank": 1, "text": "Tears are like diamonds in my eyes", "ok": true}, "laion": {"rank": 295, "text": "I took all the blame", "ok": false}}},
    ],
  },
};
