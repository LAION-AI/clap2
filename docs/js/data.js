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
    L: [[9.031, 0.2913], [9.332, 0.3067], [9.633, 0.326], [9.934, 0.3361], [10.235, 0.3522], [10.536, 0.3742], [10.837, 0.4043], [11.138, 0.4512], [11.439, 0.4888], [11.74, 0.522], [12.041, 0.5358]],
  },
  // Fitted scaling law reported in the paper: L(C) = A (C + e^B)^-alpha + E, C in GFLOPs.
  fit: { A: 2.22, B: 19.76, alpha: 0.0574, E: 0 },
  samplesSeen: ['1M', '2M', '4M', '8M', '16M', '32M', '64M', '128M', '256M', '512M', '1024M'],

  // Audio-text datasets (Table: LAION-Audio-XL compared to existing datasets)
  // access: 'public' = public (audio, captions with links to the audio, or a mix of public datasets),
  // 'closed' = not released, 'released' = ours (laion/laion-audio-xl)
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
    { name: 'LAION-Audio-XL-500M', hours: 3.35e6, captions: 970e6, audio: 500e6, ours: true, access: 'released' },
    { name: 'LAION-Audio-XL', hours: 1.39e6, captions: 707e6, audio: 365e6, ours: true, access: 'released' },
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
  // { src, caption, source, license, from }: a LAION-Audio-XL clip with its source page, licence and source dataset
  // (shown under the player). Keys are "<group>/<category>" or "<group>/<category>/<class>"; a category without
  // an entry borrows a clip from its classes, otherwise it has no demo clip.
  // Written by tools/import_taxonomy_audio.py, which keeps entries it does not replace.
  // taxonomy-audio:start
  taxonomyAudio: {
    "speech/Noisy in-the-wild speech": {"sample": "03-speech"},
    "music/World / regional music": {"sample": "02-music"},
    "animal/Amphibians/Neotropical frogs": {"src": "assets/audio/taxonomy/174580894-neotropical-frogs.mp3", "caption": "A frog croaks in a rhythmic, pulsing pattern with a low, guttural tone.", "source": "https://xeno-canto.org/sounds/uploaded/AQWMZXSOED/XC637467-Caprimulgus%20europaeus%20European%20Nightjar%20song%202005-06-10%200130%20Penderi%2C%20Valles%20pagasts%2056.484899%2C%2024.782388%20%28not%20seen%20bird%20a%29%20Telinga%205W.mp3", "license": "", "from": "Common Crawl"},
    "animal/Birds/Kookaburras": {"src": "assets/audio/taxonomy/62753960-kookaburras.mp3", "caption": "A group of kookaburras emit rapid, high-pitched cackling calls in a chaotic chorus.", "source": null, "license": "CC BY-NC-SA 3.0", "from": "BirdSet_XCL"},
    "animal/Birds/Large bird wing beats in flight": {"src": "assets/audio/taxonomy/579716923-large-bird-wing-beats-in-flight.mp3", "caption": "A large bird flaps its wings with deep, rhythmic thumps in an open outdoor space.", "source": "https://www.youtube.com/watch?v=vx9RZeYcx4U&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "animal/Birds/Owls": {"src": "assets/audio/taxonomy/88201192-owls.mp3", "caption": "An owl named Bubo bubo hoots five times in a row.", "source": "https://www.jagd.it/wp-content/uploads/2021/01/uhu-2.mp3?_=1", "license": "", "from": "Common Crawl"},
    "animal/Birds/Penguins": {"src": "assets/audio/taxonomy/75837364-penguins.mp3", "caption": "Penguins braying loudly in a colony.", "source": null, "license": "CC BY-NC-SA", "from": "NatureLM_AnimalSoundArchive"},
    "animal/Insects/Single cricket chirping indoors": {"src": "assets/audio/taxonomy/271140494-single-cricket-chirping-indoors.mp3", "caption": "A single cricket chirps rapidly and continuously in a quiet indoor space.", "source": "https://www.youtube.com/watch?v=n1M3Ir8hVxQ&t=1452s", "license": "CC BY 3.0", "from": "YouTube"},
    "animal/Mammals/Domestic cats": {"src": "assets/audio/taxonomy/79228448-domestic-cats.mp3", "caption": "A cat purrs rhythmically and deeply, its chest vibrating with a continuous low-frequency rumble.", "source": null, "license": "CC0 1.0", "from": "TACOS"},
    "animal/Mammals/Large animal exertive breathing": {"src": "assets/audio/taxonomy/945364479-large-animal-exertive-breathing.mp3", "caption": "A large animal breathes heavily and rhythmically in a quiet outdoor setting.", "source": "https://www.youtube.com/watch?v=2r24BrgcAfw&t=17249s", "license": "CC BY 3.0", "from": "YouTube"},
    "animal/Mammals/Large aquatic mammal water movement": {"src": "assets/audio/taxonomy/583241533-large-aquatic-mammal-water-movement.mp3", "caption": "A large aquatic mammal breathes and moves in water, creating splashing sounds.", "source": "https://www.youtube.com/watch?v=yRDXMAo7PNA&t=31s", "license": "CC BY 3.0", "from": "YouTube"},
    "animal/Mammals/Wild felid snarl": {"src": "assets/audio/taxonomy/1345987453-wild-felid-snarl.mp3", "caption": "A lion snarls and growls with distinct snarling sounds", "source": "https://www.youtube.com/watch?v=IwKDe2ADuE8&t=56s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Appliances/Sewing machine": {"src": "assets/audio/taxonomy/1246427528-sewing-machine.mp3", "caption": "Sewing machine operates with rhythmic whirring and clicking, overlaid by a woman speaking Norwegian.", "source": "https://www.youtube.com/watch?v=YRfwPIeybQo&t=583s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Bathroom/Toilet flush": {"src": "assets/audio/taxonomy/923191807-toilet-flush.mp3", "caption": "Toilet flushes with echoing sound, repeated four times.", "source": "https://www.youtube.com/watch?v=Ws_cfVnHdT4&t=19048s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Bottle handling": {"src": "assets/audio/taxonomy/112902802-bottle-handling.mp3", "caption": "A person twists and pops a plastic bottle cap repeatedly.", "source": "http://iainmccurdy.org/soundlibrary/Sailing/Sailing022.wav", "license": "", "from": "Common Crawl"},
    "domestic/Clock ticking / chiming/Mechanical clock ticking": {"src": "assets/audio/taxonomy/625648300-mechanical-clock-ticking.mp3", "caption": "A mechanical clock ticks steadily before chiming a single high-pitched note.", "source": "https://www.youtube.com/watch?v=k64C538L3Io&t=749s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Doors / windows / barriers/Heavy metal gate operation": {"src": "assets/audio/taxonomy/424143286-heavy-metal-gate-operation.mp3", "caption": "A heavy metal gate clanks open and shut while crickets chirp in the background.", "source": "https://www.youtube.com/watch?v=9_q5K77i3a4&t=399s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Kitchen / food preparation/Mechanical kitchen timer ticking": {"src": "assets/audio/taxonomy/288445105-mechanical-kitchen-timer-ticking.mp3", "caption": "A mechanical kitchen timer ticks steadily before abruptly buzzing and stopping.", "source": "https://www.youtube.com/watch?v=uuqJfzBxfnE&t=178s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Miscellaneous household/Metal filing cabinet drawer operation": {"src": "assets/audio/taxonomy/958046452-metal-filing-cabinet-drawer-operation.mp3", "caption": "A metal filing cabinet drawer slides open and shut with a loud squeak.", "source": "https://www.youtube.com/watch?v=M76hilgz-Sg&t=545s", "license": "CC BY 3.0", "from": "YouTube"},
    "domestic/Toys and games/Toy train operating sound": {"src": "assets/audio/taxonomy/1374343477-toy-train-operating-sound.mp3", "caption": "A toy train emits a high-pitched whistle, then hisses and clanks as it moves.", "source": "https://www.youtube.com/watch?v=5ietnM2pYyQ&t=1131s", "license": "CC BY 3.0", "from": "YouTube"},
    "human/Breathing/Deliberate breathing exercise": {"src": "assets/audio/taxonomy/262232689-deliberate-breathing-exercise.mp3", "caption": "A person performs rhythmic, deliberate breathing exercises with deep, forceful breaths.", "source": "https://www.youtube.com/watch?v=4-RklC7r26k&t=1776s", "license": "CC BY 3.0", "from": "YouTube"},
    "human/Crowd human activity/Concert crowd roar / stadium cheer": {"src": "assets/audio/taxonomy/179211994-concert-crowd-roar-stadium-cheer.mp3", "caption": "A large crowd cheers and claps, then a bass guitar plays a single note.", "source": "http://a22.phobos.apple.com/us/r1000/042/Music/v4/a5/47/c2/a547c2a6-6ed6-9f2f-dfb0-39e158b12fcc/mzaf_2137186386366036213.plus.aac.p.m4a", "license": "", "from": "Common Crawl"},
    "human/Eating / drinking/Slurping noodles": {"src": "assets/audio/taxonomy/1399182168-slurping-noodles.mp3", "caption": "A male speaker says 'スパイスが', followed by slurping sounds and a sigh.", "source": "https://www.youtube.com/watch?v=lhNP1Jo2Jes&t=113s", "license": "CC BY 3.0", "from": "YouTube"},
    "human/Footsteps on wooden indoor staircase": {"src": "assets/audio/taxonomy/367784906-footsteps-on-wooden-indoor-staircase.mp3", "caption": "A person walks up a wooden staircase, footsteps creaking, ending with a sigh.", "source": "https://www.youtube.com/watch?v=G8oMsub9AWM&t=156s", "license": "CC BY 3.0", "from": "YouTube"},
    "human/Infant / baby sounds": {"src": "assets/audio/taxonomy/97423108-infant-baby-sounds.mp3", "caption": "A baby makes a series of gurgling and cooing sounds.", "source": "https://vsezvuki.com/data/2022-10/sound_31416.mp3", "license": "", "from": "Common Crawl"},
    "human/Laughter/Child solo laughter": {"src": "assets/audio/taxonomy/92157828-child-solo-laughter.mp3", "caption": "A child laughs with high-pitched, continuous, clear laughter.", "source": "https://www.kasman.sk/download/mobil_zvuk/Baby2.amr", "license": "", "from": "Common Crawl"},
    "human/Locomotion (human body)/Footsteps on snow": {"src": "assets/audio/taxonomy/106507285-footsteps-on-snow.mp3", "caption": "Footsteps crunching on snow with a rhythmic pace.", "source": "https://makimaki-hanamaki.com/wp-content/uploads/2024/01/shinsetsu.mp3?_=18", "license": "", "from": "Common Crawl"},
    "human/Vocalization (non-speech)/Beatboxing": {"src": "assets/audio/taxonomy/1298749728-beatboxing.mp3", "caption": "A beatboxer performs rapid vocal percussion and mimics a DJ scratching a record.", "source": "https://www.youtube.com/watch?v=y9Jx79cjoiU&t=212s", "license": "CC BY 3.0", "from": "YouTube"},
    "industrial/Electrical equipment hum / transformer buzz": {"src": "assets/audio/taxonomy/229409014-electrical-equipment-hum-transformer-buzz.mp3", "caption": "A transformer emits a steady electrical buzz, then a loud distorted chord abruptly plays.", "source": "http://www.techlib.com/files/pichum.wav", "license": "", "from": "Common Crawl"},
    "industrial/Engines/Diesel engine complete shutdown": {"src": "assets/audio/taxonomy/102500092-diesel-engine-complete-shutdown.mp3", "caption": "A diesel engine starts, idles roughly, and then shuts off after a person flushes a toilet.", "source": "https://free-sound-effects.net/mp3/03/free-sound-1674978947.mp3", "license": "", "from": "Common Crawl"},
    "industrial/Factory / production line/Industrial slide rail operating sound": {"src": "assets/audio/taxonomy/639504735-industrial-slide-rail-operating-sound.mp3", "caption": "A mechanical sliding sound repeats, then a man speaks in Arabic.", "source": "https://www.youtube.com/watch?v=AAcckzm5pmI&t=208s", "license": "CC BY 3.0", "from": "YouTube"},
    "industrial/Hand tools/Hand-operated water pump rhythmic clanking": {"src": "assets/audio/taxonomy/281331651-hand-operated-water-pump-rhythmic-clanking.mp3", "caption": "A hand-operated water pump clanks rhythmically while people speak Khmer.", "source": "https://www.youtube.com/watch?v=-YrgCq_H3DI&t=89s", "license": "CC BY 3.0", "from": "YouTube"},
    "industrial/Heavy machinery / construction/Large diesel engine idle": {"src": "assets/audio/taxonomy/468622136-large-diesel-engine-idle.mp3", "caption": "A large diesel engine idles steadily, then a pneumatic hiss releases.", "source": "https://www.youtube.com/watch?v=JEtILQVjqBc&t=1128s", "license": "CC BY 3.0", "from": "YouTube"},
    "industrial/Power tools/Pencil sharpener whirring": {"src": "assets/audio/taxonomy/88361821-pencil-sharpener-whirring.mp3", "caption": "A pencil sharpener whirs and a rooster crows loudly.", "source": "https://dzwoneknatelefon.com/wp-content/uploads/2021/11/Teleranek-TVP.mp3", "license": "", "from": "Common Crawl"},
    "industrial/Printing / copying/Printing press rhythmic clacking": {"src": "assets/audio/taxonomy/407135626-printing-press-rhythmic-clacking.mp3", "caption": "A printing press clacks rhythmically, followed by a loud crash and heavy footsteps.", "source": "https://www.youtube.com/watch?v=gMtuKl5_JEk&t=75s", "license": "CC BY 3.0", "from": "YouTube"},
    "industrial/Vintage electromechanical device operation": {"src": "assets/audio/taxonomy/412226915-vintage-electromechanical-device-operation.mp3", "caption": "A vintage CB radio emits mechanical clicks and whirs, accompanied by a male voice saying 'Let's see...'", "source": "https://www.youtube.com/watch?v=jImQ58-H5MA&t=717s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Dial-up modem / data transmission tone": {"src": "assets/audio/taxonomy/94139381-dial-up-modem-data-transmission-tone.mp3", "caption": "A dial-up modem connects with electronic tones and a loud, harsh screech.", "source": "https://se7en.ru/files/v90r.wav", "license": "", "from": "Common Crawl"},
    "interface/Electronic glitches/Sustained low-frequency electronic drone": {"src": "assets/audio/taxonomy/1143978086-sustained-low-frequency-electronic-drone.mp3", "caption": "A sustained low-frequency electronic drone with three distinct clicks.", "source": "https://www.youtube.com/watch?v=yEfhXqjv5mA&t=4254s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Keystrokes / typing/Single mechanical keyboard keystroke": {"src": "assets/audio/taxonomy/356591295-single-mechanical-keyboard-keystroke.mp3", "caption": "A mechanical keyboard is being typed on with crisp, individual keystrokes.", "source": "https://www.youtube.com/watch?v=nwWn09wcaBI&t=2535s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Malfunction / error alert beeps": {"src": "assets/audio/taxonomy/105004079-malfunction-error-alert-beeps.mp3", "caption": "Four electronic beeps sound at regular intervals over a low hum.", "source": "https://fordonsradio.se/wp-content/uploads/2010/10/TUC3.mp3", "license": "", "from": "Common Crawl"},
    "interface/Medical devices/Heart monitor beeping": {"src": "assets/audio/taxonomy/710507968-heart-monitor-beeping.mp3", "caption": "A heart monitor beeps rhythmically while a woman speaks in Hungarian.", "source": "https://www.youtube.com/watch?v=DsjsThtw6iU&t=479s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Phone interfaces/Telephone receiver placing sounds": {"src": "assets/audio/taxonomy/710491744-telephone-receiver-placing-sounds.mp3", "caption": "Pigeon cooing, phone clicks, and Indonesian conversation.", "source": "https://www.youtube.com/watch?v=DsI56FRFX3E&t=2514s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Rhythmic mechanical clicking": {"src": "assets/audio/taxonomy/1389226476-rhythmic-mechanical-clicking.mp3", "caption": "Electronic clicks rapidly increase in speed and volume.", "source": "https://www.youtube.com/watch?v=VNk6V40NewM&t=602s", "license": "CC BY 3.0", "from": "YouTube"},
    "interface/Telecom / broadcast signals/Morse code transmission": {"src": "assets/audio/taxonomy/130879002-morse-code-transmission.mp3", "caption": "An electronic device transmits a Morse code SOS signal with static interference.", "source": "http://www.k5cm.com/audio/arrl%20fmt%20april%202010/snips%20by%20k5cm/w6oqi-apr-2010-80m%20snip.wav", "license": "", "from": "Common Crawl"},
    "music/Choral / choir music/Hindu kirtan call-and-response devotional": {"src": "assets/audio/taxonomy/1267766941-hindu-kirtan-call-and-response-devotional.mp3", "caption": "A large group chants devotional mantras with rhythmic hand claps and wooden percussion.", "source": "https://www.youtube.com/watch?v=91NyHDid9T0&t=123s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Electronic music/Kazakh electronic pop song": {"src": "assets/audio/taxonomy/446687419-kazakh-electronic-pop-song.mp3", "caption": "A woman and a man sing in Kazakh over upbeat electronic music.", "source": "https://www.youtube.com/watch?v=rUvKtnChSWQ&t=839s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Folk / traditional music/Bagpipe folk dance music": {"src": "assets/audio/taxonomy/583446616-bagpipe-folk-dance-music.mp3", "caption": "Bagpipes play a loud, reedy melody with a rhythmic drum beat underneath.", "source": "https://www.youtube.com/watch?v=yZVRC58DrwE&t=446s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Folk / traditional music/Flamenco vocal performance": {"src": "assets/audio/taxonomy/201759238-flamenco-vocal-performance.mp3", "caption": "Female vocalist sings a Flamenco-style melody with rhythmic accompaniment.", "source": "https://p.scdn.co/mp3-preview/a8d9bb37067312b79eef1ab840d87fcc894b402c?cid=131c6d692c854016958c04417165ba30", "license": "", "from": "Common Crawl"},
    "music/Jazz / blues-based music/Dixieland jazz ensemble": {"src": "assets/audio/taxonomy/135293301-dixieland-jazz-ensemble.mp3", "caption": "A lively Dixieland jazz band plays a fast, upbeat tune featuring a prominent trumpet solo.", "source": "https://citizen-dj.labs.loc.gov/audio/samplepacks/loc-jukebox-blues/Clarinet-marmalade-blues_jukebox-29613_002_00-00-31.mp3", "license": "", "from": "Common Crawl"},
    "music/Jazz / blues-based music/Gypsy jazz / Hot Club jazz": {"src": "assets/audio/taxonomy/127008702-gypsy-jazz-hot-club-jazz.mp3", "caption": "A lively Gypsy jazz tune features a virtuosic acoustic guitar solo over a walking bass and rhythmic strumming.", "source": "https://cnpmusic.com/plans/gypsy_licks/dorado_schmitt/davidswing2.mp3", "license": "", "from": "Common Crawl"},
    "music/Jazz / blues-based music/Jazz vocal scat / wordless vocal": {"src": "assets/audio/taxonomy/180431444-jazz-vocal-scat-wordless-vocal.mp3", "caption": "A female vocalist sings jazz scat with a piano, bass, and drums playing behind her.", "source": "http://a523.phobos.apple.com/us/r1000/097/Music/v4/8d/90/44/8d9044ca-b054-9637-072b-3f881cdaea24/mzaf_8025447954461182121.aac.m4a", "license": "", "from": "Common Crawl"},
    "music/Meditative / wellness music/Singing bowl meditative drone": {"src": "assets/audio/taxonomy/1149915615-singing-bowl-meditative-drone.mp3", "caption": "A singing bowl drones while birds chirp and water trickles nearby.", "source": "https://www.youtube.com/watch?v=5kK3CJpgI6Q&t=1947s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Meditative / wellness music/Tibetan singing bowl strike": {"src": "assets/audio/taxonomy/145661245-tibetan-singing-bowl-strike.mp3", "caption": "A Tibetan singing bowl is struck, producing a sustained resonant tone.", "source": "https://www.lecive-nastroje.cz/download/3109-17-1-3199.mp3", "license": "", "from": "Common Crawl"},
    "music/Percussion-only / rhythm ensemble music/Darbuka / doumbek solo": {"src": "assets/audio/taxonomy/1164794571-darbuka-doumbek-solo.mp3", "caption": "A darbuka drum is played in a rapid, complex, and rhythmic solo.", "source": "https://www.youtube.com/watch?v=TwZULqBgMVU&t=154s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Religious / spiritual music/Hindu devotional chant / mantra": {"src": "assets/audio/taxonomy/519447241-hindu-devotional-chant-mantra.mp3", "caption": "A group chants a Hindu mantra, followed by a bansuri solo.", "source": "https://www.youtube.com/watch?v=r1EP79J6-Bs&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Solo instrumental music/Shakuhachi / Japanese bamboo flute solo": {"src": "assets/audio/taxonomy/568483542-shakuhachi-japanese-bamboo-flute-solo.mp3", "caption": "A shakuhachi flute plays a slow, breathy melody with a single resonant bell strike.", "source": "https://www.youtube.com/watch?v=mNlltkzM_kU&t=132s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/Solo vocal music/Beatboxing vocal percussion solo": {"src": "assets/audio/taxonomy/720115128-beatboxing-vocal-percussion-solo.mp3", "caption": "A person beatboxes rapidly with their mouth and nose, creating complex percussive sounds and vocal effects.", "source": "https://www.youtube.com/watch?v=LZWN7j1XH-g&t=278s", "license": "CC BY 3.0", "from": "YouTube"},
    "music/World / regional music/Argentine tango": {"src": "assets/audio/taxonomy/135890883-argentine-tango.mp3", "caption": "An accordion plays a lively tango melody with a rhythmic piano accompaniment.", "source": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview128/v4/9c/a6/c2/9ca6c2a3-cbea-a189-3fa0-9673a6b800e7/mzaf_6682643103626080740.plus.aac.p.m4a", "license": "", "from": "Common Crawl"},
    "nature/Fire/Crackling fire": {"src": "assets/audio/taxonomy/908079738-crackling-fire.mp3", "caption": "A metal object clanks, then a crackling fire burns with a low rumble.", "source": "https://www.youtube.com/watch?v=8m95EBXqbPo&t=1531s", "license": "CC BY 3.0", "from": "YouTube"},
    "nature/Geological / earth/Glacier calving": {"src": "assets/audio/taxonomy/160247021-glacier-calving.mp3", "caption": "A glacier calving produces a loud, continuous rushing sound.", "source": "http://cyberforest.nenv.k.u-tokyo.ac.jp/tabushima-sound/20250113/20250113095919tabushima.mp3", "license": "", "from": "Common Crawl"},
    "nature/Vegetation / forest movement/Footsteps on dry autumn leaves": {"src": "assets/audio/taxonomy/1270562905-footsteps-on-dry-autumn-leaves.mp3", "caption": "A person walks on dry leaves with crisp footsteps.", "source": "https://www.youtube.com/watch?v=Dbo3SOxqwMg&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "nature/Water/Indoor rushing water through enclosed space": {"src": "assets/audio/taxonomy/684576677-indoor-rushing-water-through-enclosed-space.mp3", "caption": "Rushing water sound from a waterfall or stream, steady and continuous", "source": "https://www.youtube.com/watch?v=hW5cSywOZvo&t=10927s", "license": "CC BY 3.0", "from": "YouTube"},
    "nature/Water/Powerful waterfall roar": {"src": "assets/audio/taxonomy/495238875-powerful-waterfall-roar.mp3", "caption": "A powerful waterfall roars continuously, then a low electronic hum begins.", "source": "https://www.youtube.com/watch?v=b_Ellj3UaLU&t=5084s", "license": "CC BY 3.0", "from": "YouTube"},
    "nature/Water/Shoreline / lake water lapping": {"src": "assets/audio/taxonomy/456897943-shoreline-lake-water-lapping.mp3", "caption": "Water lapping and ducks quacking in a natural setting.", "source": "https://www.youtube.com/watch?v=zLgdMOnpZGs&t=15613s", "license": "CC BY 3.0", "from": "YouTube"},
    "nature/Weather/Rain": {"src": "assets/audio/taxonomy/183547309-rain.mp3", "caption": "Rain falls steadily, then a loud clap of thunder suddenly echoes.", "source": "https://audio-ssl.itunes.apple.com/apple-assets-us-std-000001/AudioPreview18/v4/36/1e/9b/361e9b39-ef69-11a0-a2a6-f1dc115207dd/mzaf_5123105292631877285.plus.aac.p.m4a", "license": "", "from": "Common Crawl"},
    "nature/Wind/Skydiving freefall wind rush": {"src": "assets/audio/taxonomy/1311615169-skydiving-freefall-wind-rush.mp3", "caption": "Wind rushes during freefall, followed by a kalimba playing a tune.", "source": "https://www.youtube.com/watch?v=LGkNBnDGK7M&t=201s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Ambiences / soundscapes/Elevator interior ambience": {"src": "assets/audio/taxonomy/1049072806-elevator-interior-ambience.mp3", "caption": "An elevator door slides open, a chime sounds, and a female voice announces in Korean that the elevator is going up.", "source": "https://www.youtube.com/watch?v=dKEfalJvuMY&t=18s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Cinematic / trailer sound design/Cinematic electronic tension swell": {"src": "assets/audio/taxonomy/92254148-cinematic-electronic-tension-swell.mp3", "caption": "A low-frequency drone swells and fades, creating cinematic tension.", "source": "https://audio-ssl.itunes.apple.com/apple-assets-us-std-000001/Music7/v4/d9/86/d0/d986d0f7-7b02-573f-782d-8cfbf1ebfb82/mzaf_3742964173205854524.plus.aac.p.m4a", "license": "", "from": "Common Crawl"},
    "sfx/Cinematic SFX/Cinematic dark industrial soundscape": {"src": "assets/audio/taxonomy/1122243806-cinematic-dark-industrial-soundscape.mp3", "caption": "Cinematic dark industrial soundscape with metallic clanking and a heavy crash.", "source": "https://www.youtube.com/watch?v=RTJhb4te8Qk&t=218s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Cinematic deep impact boom": {"src": "assets/audio/taxonomy/364684572-cinematic-deep-impact-boom.mp3", "caption": "A deep cinematic boom resonates and fades into silence.", "source": "https://www.youtube.com/watch?v=Diqi6sVSXzE&t=2838s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Cinematic sound design/Cinematic suspense drone": {"src": "assets/audio/taxonomy/154469377-cinematic-suspense-drone.mp3", "caption": "A deep, low-frequency drone swells and fades with a metallic resonance.", "source": "https://freesound.org/data/previews/16/16539_2518-lq.ogg", "license": "", "from": "Common Crawl"},
    "sfx/Electric motor whine ascending": {"src": "assets/audio/taxonomy/658130955-electric-motor-whine-ascending.mp3", "caption": "Electric motor whine ascending and descending rapidly", "source": "https://www.youtube.com/watch?v=IOfb3yeBKak&t=3318s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Foley/Bullwhip crack": {"src": "assets/audio/taxonomy/97510784-bullwhip-crack.mp3", "caption": "Bullwhip cracks six times, ending with a thud.", "source": "https://v1.cdnpk.net/videvo_files/audio/premium/audio0316/watermarked/_Soundstorm 6_Whips-Bullwhip-Ext-CU-FastA_B05-09478_preview.mp3", "license": "", "from": "Common Crawl"},
    "sfx/Liquid sounds/Liquid pouring / glugging": {"src": "assets/audio/taxonomy/252990099-liquid-pouring-glugging.mp3", "caption": "Bubbling water and mournful howls echo in an underwater setting.", "source": "https://www.youtube.com/watch?v=abNqYeZ5W0E&t=33616s", "license": "CC BY 3.0", "from": "YouTube"},
    "sfx/Science fiction / futuristic electronic sound effect": {"src": "assets/audio/taxonomy/121056065-science-fiction-futuristic-electronic-sound-effect.mp3", "caption": "Synthesized sci-fi sound effect rises then crashes with explosive force.", "source": "https://pic.ibaotu.com/00/43/88/04Y888piCHbV.mp3", "license": "", "from": "Common Crawl"},
    "sfx/Video game sound effect/Retro video game action sound montage": {"src": "assets/audio/taxonomy/1068060387-retro-video-game-action-sound-montage.mp3", "caption": "A retro video game sound effect plays, featuring a descending electronic tone and a rapid digital blip.", "source": "https://www.youtube.com/watch?v=6zBfRD6qevM&t=107s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/Amharic broadcast news speech": {"src": "assets/audio/taxonomy/468369204-amharic-broadcast-news-speech.mp3", "caption": "A male news reporter speaks in Amharic about a political rally in Meskel Square.", "source": "https://www.youtube.com/watch?v=J0YbBn8AUJo&t=2170s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/Armenian language monologue": {"src": "assets/audio/taxonomy/1380966921-armenian-language-monologue.mp3", "caption": "A male speaker talks in Armenian about a legal mechanism and business development.", "source": "https://www.youtube.com/watch?v=H1LKfl6pTK8&t=583s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/Automated phone paging announcement": {"src": "assets/audio/taxonomy/105170449-automated-phone-paging-announcement.mp3", "caption": "A female voice repeatedly says 'Nitaiji, please pick up the phone' over a chime.", "source": "https://freedownloadmobileringtones.com/wp-content/uploads/2015/04/Nitai-ji-please-pick-up-the-phone-FDMR-saying-25.mp3", "license": "", "from": "Common Crawl"},
    "speech/French children's story narration": {"src": "assets/audio/taxonomy/522087997-french-children-s-story-narration.mp3", "caption": "A female narrator tells a French children's story about a dragon and two princesses.", "source": "https://www.youtube.com/watch?v=AGxIblDe5Tg&t=2072s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/German-language studio read speech": {"src": "assets/audio/taxonomy/691784312-german-language-studio-read-speech.mp3", "caption": "A male voice reads a German-language advertisement for empty freight car storage space.", "source": "https://www.youtube.com/watch?v=q25cg0yxLMs&t=304s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/Korean sports commentary": {"src": "assets/audio/taxonomy/269563000-korean-sports-commentary.mp3", "caption": "Male and female commentators discuss a volleyball play, Hwang Kyung-min's spike.", "source": "https://www.youtube.com/watch?v=ltleHyGE-Wk&t=1115s", "license": "CC BY 3.0", "from": "YouTube"},
    "speech/Language learning multilingual dialogue": {"src": "assets/audio/taxonomy/172287572-language-learning-multilingual-dialogue.mp3", "caption": "Male and female speakers converse in Tatar, discussing a night out and coffee shop.", "source": "https://rfe-audio-ns.akamaized.net/tb/2024/11/20/189cf2fb-a354-4f8a-8014-33426d51bb9f_hq.mp3?download=1", "license": "", "from": "Common Crawl"},
    "speech/Non-English broadcast news speech/Armenian broadcast news": {"src": "assets/audio/taxonomy/123021567-armenian-broadcast-news.mp3", "caption": "Armenian news anchor delivers a formal report on a court case involving Hovhannisyan, ending with a beep.", "source": "https://lratvakan.am/media/62564/28_hh_agn.mp3", "license": "", "from": "Common Crawl"},
    "speech/Non-English transit PA announcement": {"src": "assets/audio/taxonomy/186120526-non-english-transit-pa-announcement.mp3", "caption": "A female voice announces Kairakuen station in Japanese and English, doors open left.", "source": "http://blog-imgs-1.fc2.com/n/s/t/nstation/20070312233627.mp3", "license": "", "from": "Common Crawl"},
    "speech/Sanskrit / Vedic oral recitation": {"src": "assets/audio/taxonomy/793221266-sanskrit-vedic-oral-recitation.mp3", "caption": "A male voice chants Sanskrit verses, then speaks in English about a room darkening.", "source": "https://www.youtube.com/watch?v=7jzMhiR_k6M&t=1453s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Athletics / track and field/Discus throw": {"src": "assets/audio/taxonomy/892414001-discus-throw.mp3", "caption": "A discus is thrown, followed by buzzing insects and wind.", "source": "https://www.youtube.com/watch?v=m2eq3quCeZk&t=333s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Field hockey": {"src": "assets/audio/taxonomy/645489988-field-hockey.mp3", "caption": "A crowd shouts and a whistle blows, followed by a male speaker announcing a field hockey tournament.", "source": "https://www.youtube.com/watch?v=ApsxxVcgK7E&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Foosball game": {"src": "assets/audio/taxonomy/197559296-foosball-game.mp3", "caption": "A foosball table is played with a ball hitting the table and players talking in Cantonese.", "source": "https://imgs.shundecity.com/luvUTUQEEaFYsYiToVrIiA66DhF7", "license": "", "from": "Common Crawl"},
    "sports/Ice hockey game ambience": {"src": "assets/audio/taxonomy/158089474-ice-hockey-game-ambience.mp3", "caption": "A hockey puck strikes the boards, followed by a man speaking in Dutch.", "source": "https://freesound.org/data/previews/172/172616_670687-lq.ogg", "license": "", "from": "Common Crawl"},
    "sports/Polo match gameplay sounds": {"src": "assets/audio/taxonomy/902985916-polo-match-gameplay-sounds.mp3", "caption": "Polo mallet strikes a ball rhythmically, followed by two whooshing sounds.", "source": "https://www.youtube.com/watch?v=18UXRVJ1LPM&t=255s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Racket / ball sports/Table tennis gameplay sounds": {"src": "assets/audio/taxonomy/1301348823-table-tennis-gameplay-sounds.mp3", "caption": "Table tennis gameplay sounds followed by a male voice speaking Czech introducing a player and their Spanish partner.", "source": "https://www.youtube.com/watch?v=3y57kq4SXvg&t=29s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Rounders gameplay sounds": {"src": "assets/audio/taxonomy/467971158-rounders-gameplay-sounds.mp3", "caption": "Umpire announces scores, crowd cheers, child shouts 'Go the Dragons!'", "source": "https://www.youtube.com/watch?v=IfS-On5sVa8&t=1569s", "license": "CC BY 3.0", "from": "YouTube"},
    "sports/Throwing sports/Axe throwing": {"src": "assets/audio/taxonomy/926821294-axe-throwing.mp3", "caption": "People talking and laughing, followed by an axe hitting a target.", "source": "https://www.youtube.com/watch?v=bb75sBAo4Rk&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Crowds (urban)/Outdoor market / bazaar crowd ambience": {"src": "assets/audio/taxonomy/1240031377-outdoor-market-bazaar-crowd-ambience.mp3", "caption": "A crowd of people talk in a busy market where a man repeatedly shouts 'shatlat' in Nepali.", "source": "https://www.youtube.com/watch?v=Nfc32QnBjRI&t=156s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Outdoor recreation / sport sounds/Amusement park ride machinery": {"src": "assets/audio/taxonomy/411919413-amusement-park-ride-machinery.mp3", "caption": "Woman speaks, children play, loud mechanical sounds", "source": "https://www.youtube.com/watch?v=j4aLBKHXJGA&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Public transit / stations/Rolling luggage in transit hub": {"src": "assets/audio/taxonomy/845144289-rolling-luggage-in-transit-hub.mp3", "caption": "Rolling luggage and a female voice speaking Basque in a transit hub.", "source": "https://www.youtube.com/watch?v=goTlblbkCik&t=55s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Rail transport/Passing train": {"src": "assets/audio/taxonomy/310257720-passing-train.mp3", "caption": "A train passes by with a Doppler effect and crows cawing.", "source": "https://www.youtube.com/watch?v=LgmgSXIYpKk&t=1132s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Road vehicles/Military tracked vehicle engine": {"src": "assets/audio/taxonomy/131160622-military-tracked-vehicle-engine.mp3", "caption": "A military tracked vehicle engine idles and then revs up, its deep rumble growing louder.", "source": "https://download.ferraricostruzioni.com/materiale-fcm/FERRARI/REMOLITE/VIDEO/DISC%20HILLER_FRONT%20MOUNT.mp4", "license": "", "from": "Common Crawl"},
    "urban/Sirens / alarms (urban)/Air raid siren": {"src": "assets/audio/taxonomy/79232260-air-raid-siren.mp3", "caption": "An air raid siren descends in pitch over 25 seconds.", "source": null, "license": "CC BY 4.0", "from": "TACOS"},
    "urban/Street commerce / vendors/Mobile music source (vehicle or pedestrian)": {"src": "assets/audio/taxonomy/537790459-mobile-music-source-vehicle-or-pedestrian.mp3", "caption": "A street vendor plays a loud, repetitive melody on a horn while car horns beep in the background.", "source": "https://www.youtube.com/watch?v=LPqO1qppgrQ&t=0s", "license": "CC BY 3.0", "from": "YouTube"},
    "urban/Train braking screech": {"src": "assets/audio/taxonomy/415138720-train-braking-screech.mp3", "caption": "A train's screeching brakes and high-pitched whine fade out on a city street.", "source": "https://www.youtube.com/watch?v=lJbO674RqMY&t=147s", "license": "CC BY 3.0", "from": "YouTube"}
  },
  // taxonomy-audio:end

  // MAEB-30 mean (paper Table 2). params in millions: audio and text parts only, as in the paper.
  maeb: [
    { n: 'LCO-Embedding-Omni-7B', p: 7700, s: 53.5 },
    { n: 'e5-omni-7B', p: 7700, s: 52.5 },
    { n: 'BidirLM-Omni-2.5B', p: 2000, s: 52.4 },
    { n: 'LCO-Embedding-Omni-3B', p: 3700, s: 52.3 },
    { n: 'jina-v5-omni-small', p: 1300, s: 50.4 },
    { n: 'e5-omni-3B', p: 3700, s: 48.0 },
    { n: 'OmniEmbed-v0.1', p: 7800, s: 43.9 },
    { n: 'fusion-embedding-2-2b', p: 2400, s: 40.2 },
    { n: 'Qwen2-Audio-7B', p: 7800, s: 34.5 },
    { n: 'Qwen2.5-Omni-7B', p: 7700, s: 24.2 },
    { n: 'jina-v5-omni-nano', p: 855, s: 51.8 },
    { n: 'EmbeddingGemma 2', p: 577, s: 49.4 },
    { n: 'GLAP', p: 855, s: 44.1 },
    { n: 'M2D-CLAP', p: 199, s: 38.0 },
    { n: 'MS-CLAP 2023', p: 160, s: 37.3 },
    { n: 'TP-CLAP', p: 198, s: 37.2 },
    { n: 'CLAP-IPA small', p: 174, s: 36.5 },
    { n: 'LAION Larger CLAP', p: 194, s: 36.2 },
    { n: 'LAION-CLAP', p: 153, s: 35.2 },
    { n: 'MuQ-MuLan-large', p: 630, s: 28.9 },
    { n: 'wav2clip', p: 75, s: 28.3 },
    { n: 'SpeechT5', p: 180, s: 26.7 },
  ],

  // HEAR mean over 17 tasks (paper Table 13 and Fig. 6). t: true = audio-text model.
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
    { n: 'OpenL3', p: 4.7, s: 70.8 },
    { n: 'CP-JKU PaSST', p: 86, s: 70.0 },
    { n: 'wav2vec2', p: 315, s: 67.7 },
    { n: 'CREPE', p: 22.2, s: 54.6 },
    { n: 'e5-omni-7B', p: 7700, s: 81.2, t: true },
    { n: 'jina-v5-omni-nano', p: 855, s: 80.7, t: true },
    { n: 'M2D-CLAP', p: 199, s: 80.6, t: true },
    { n: 'BidirLM-Omni-2.5B', p: 2000, s: 80.3, t: true },
    { n: 'LCO-Embedding-Omni-7B', p: 7700, s: 79.8, t: true },
    { n: 'OmniEmbed-v0.1', p: 7800, s: 79.7, t: true },
    { n: 'e5-omni-3B', p: 3700, s: 79.7, t: true },
    { n: 'LCO-Embedding-Omni-3B', p: 3700, s: 79.5, t: true },
    { n: 'Qwen2-Audio-7B', p: 7800, s: 79.5, t: true },
    { n: 'jina-v5-omni-small', p: 1300, s: 78.1, t: true },
    { n: 'TP-CLAP', p: 198, s: 76.6, t: true },
    { n: 'Qwen2.5-Omni-7B', p: 7700, s: 75.2, t: true },
    { n: 'MS-CLAP 2023', p: 160, s: 75.1, t: true },
    { n: 'Qwen2.5-Omni-3B', p: 3700, s: 74.1, t: true },
    { n: 'GLAP', p: 855, s: 71.8, t: true },
    { n: 'fusion-embedding-2-2b', p: 2400, s: 71.2, t: true },
    { n: 'LAION Larger CLAP', p: 194, s: 69.5, t: true },
    { n: 'MuQ-MuLan-large', p: 630, s: 69.3, t: true },
    { n: 'LAION-CLAP', p: 153, s: 69.2, t: true },
    { n: 'EmbeddingGemma 2', p: 577, s: 69.1, t: true },
    { n: 'CLAP-IPA small', p: 174, s: 67.4, t: true },
    { n: 'SpeechT5', p: 180, s: 67.3, t: true },
    { n: 'MS-CLAP 2022', p: 196, s: 63.2, t: true },
    { n: 'wav2clip', p: 75, s: 56.8, t: true },
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
  // arXiv dates as far as known. TP-CLAP is left out until its date is known.
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
    ['jina-embeddings-v5-omni-nano', 855, 51.8, 53.5, 73.8, 24.7],
    ['EmbeddingGemma 2', 577, 49.4, 56.6, 61.4, 15.7],
    ['GLAP', 855, 44.1, 42.4, 69.6, 23.4],
    ['M2D-CLAP', 199, 38.0, 30.0, 69.7, 29.9],
    ['MS-CLAP 2023', 160, 37.3, 29.2, 68.0, 30.9],
    ['TP-CLAP', 198, 37.2, 28.6, 67.0, 33.3],
    ['CLAP-IPA small', 174, 36.5, 41.4, 50.5, 8.1],
    ['LAION Larger CLAP', 194, 36.2, 27.1, 70.3, 29.6],
    ['LAION-CLAP HTSAT unfused', 153, 35.2, 26.4, 68.4, 28.3],
    ['MuQ-MuLan-large', 630, 28.9, 23.1, 64.9, 10.6],
    ['wav2clip', 75, 28.3, 24.1, 58.0, 11.3],
    ['SpeechT5', 180, 26.7, 26.0, 46.5, 9.1],
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
  // SpeechT5 for pair classification).
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
    {"id": "03-speech", "cat": "speech", "src": "assets/audio/samples/03-speech.mp3", "meta": {"start_sec": 984.16, "end_sec": 1010.01, "youtube_id": "zHbtJ3ZdsxM", "youtube_title": "【AERO Tools 最強ブロワMK-1 vs RYOBIブロワー 】  車の洗車や車内のペットの毛や埃の掃除に最適 マキタ互換バッテリーの使用時間とモーターの耐久性検証", "tax_l1": "Speech", "tax_l1_prob": 0.8839, "tax_l1_top3": [["Speech", 0.8839], ["Urban & transport", 0.0337], ["Sound effects & designed sounds", 0.0252]], "tax_l3": "Speech/Noisy in-the-wild speech/Speech in motorsport environment", "tax_l3_prob": 0.2347, "age": 37.9, "gender": "male", "lang_id": "fij", "lang_prob": 0.073, "pitch_hz": 414.4, "emo_label": "sad", "top_energy_offsets_s": "15.0|24.0|18.0", "decode_ok": true, "audio_valid": true, "duration": 25.85, "n_samples": 1240800, "rms_db": -15.1653, "mean_rms_db": -18.5936, "peak_db": 0.0, "peak": 1.0, "dynamic_range_db": 15.1653, "dc_offset": 0.0002, "silence_pct": 0.0, "clip_pct": 0.0, "bandwidth_hz": 9303.2002, "spectral_centroid_hz": 1540.1075, "sr_orig": 48000, "json_variant": "speech", "short_caption": "Two men discuss a leaf blower's effectiveness, its motor whirring loudly.", "long_caption": "Two men speak in Japanese about a leaf blower's effectiveness, its loud motor whirring continuously in the background. They discuss how it removes water and debris from hard-to-reach areas, preventing water accumulation inside a car. The conversation also touches on the device's durability and battery life.", "captioning_model": "OpenMOSS-Team/MOSS-Audio-8B-Thinking"}},
    {"id": "02-music", "cat": "music", "src": "assets/audio/samples/02-music.mp3", "meta": {"start_sec": 48.32, "end_sec": 77.9, "youtube_id": "SDG7AXvQb2s", "youtube_title": "13.07.2021 pm (Baraut)", "tax_l1": "Music", "tax_l1_prob": 0.8008, "tax_l1_top3": [["Music", 0.8008], ["Urban & transport", 0.0944], ["Sound effects & designed sounds", 0.0209]], "tax_l3": "Music/World & regional music", "tax_l3_prob": 0.4958, "maest_tags": ["Latin---Batucada", "Folk, World, & Country---Folk", "Folk, World, & Country---African", "Latin---Salsa", "Latin---Cumbia"], "maest_probs": [0.419, 0.065, 0.052, 0.039, 0.033], "tempo_bpm": 133.9, "music_key": "G# major", "top_energy_offsets_s": "16.0|17.0|18.0", "decode_ok": true, "audio_valid": true, "duration": 29.58, "n_samples": 1419840, "rms_db": -12.3906, "mean_rms_db": -13.3027, "peak_db": 0.0, "peak": 1.0, "dynamic_range_db": 12.3906, "dc_offset": 0.0, "silence_pct": 0.0, "clip_pct": 0.0003, "bandwidth_hz": 9511.7002, "spectral_centroid_hz": 2076.1541, "sr_orig": 48000, "json_variant": "music", "short_caption": "A Latin batucada percussion ensemble plays a fast, rhythmic, and energetic piece.", "long_caption": "A Latin batucada percussion ensemble plays a fast, rhythmic, and energetic piece. The music features a dense layering of various drums and metallic percussion instruments. Towards the end, a male voice speaks in Spanish, followed by a female voice saying 'gracias'.", "captioning_model": "Qwen/Qwen3-Omni-30B-A3B-Instruct"}},
    {"id": "01-sound", "cat": "sound", "src": "assets/audio/samples/01-sound.mp3", "meta": {"start_sec": 0.0, "end_sec": 28.24, "youtube_id": "juAgwGFeJ6s", "youtube_title": "Т32 БАЗОЕВ Т. - ГРЕБЕННИКОВ С.", "tax_l1": "Sports & recreation", "tax_l1_prob": 0.991, "tax_l1_top3": [["Sports & recreation", 0.991]], "tax_l3": "Sports & recreation/Indoor sports practice ambience", "tax_l3_prob": 1.0, "decode_ok": true, "audio_valid": true, "duration": 28.24, "n_samples": 1355520, "rms_db": -24.3016, "mean_rms_db": -26.3885, "peak_db": -5.7775, "peak": 0.5142, "dynamic_range_db": 18.524, "dc_offset": 0.0, "silence_pct": 0.0045, "clip_pct": 0.0, "bandwidth_hz": 9023.9502, "spectral_centroid_hz": 2628.9014, "sr_orig": 48000, "json_variant": "sound_event", "tax_relabeled": true, "short_caption": "A crowd cheers and shouts during a table tennis match with racket and ball sounds.", "long_caption": "The audio captures the energetic atmosphere of an indoor table tennis match. The sharp, rapid sounds of a paddle striking a ball are prominent, accompanied by the squeaking of athletic shoes on a hard floor. Overlapping these game sounds, a crowd can be heard cheering and shouting in excitement, creating a lively and competitive ambience.", "captioning_model": "Qwen/Qwen3-Omni-30B-A3B-Instruct"}},
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
