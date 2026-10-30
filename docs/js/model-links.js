// Source page of every model and dataset named in the tables and figures, keyed by the name shown on the page.
// Hugging Face pages where they exist, otherwise the official download page, code repository or paper
// (the paper for training mixes that were never released).
// MAEB entries follow the references in MTEB's model registry (mteb/models/model_implementations).
(function () {
  const HF = id => 'https://huggingface.co/' + id;
  const L = {
    // ours (laion/clap2-<size>-audioxl-s1B)
    ...Object.fromEntries([['XXS', 'xxs'], ['XS', 'xs'], ['S', 'small'], ['M', 'medium'], ['L', 'large']]
      .map(([s, r]) => ['CLAP2-' + s, HF(`laion/clap2-${r}-audioxl-s1B`)])),

    // MAEB-30
    'LCO-Embedding-Omni-7B': HF('LCO-Embedding/LCO-Embedding-Omni-7B'),
    'LCO-Embedding-Omni-3B': HF('LCO-Embedding/LCO-Embedding-Omni-3B'),
    'e5-omni-7B': HF('Haon-Chen/e5-omni-7B'),
    'e5-omni-3B': HF('Haon-Chen/e5-omni-3B'),
    'BidirLM-Omni-2.5B': HF('BidirLM/BidirLM-Omni-2.5B-Embedding'),
    'jina-v5-omni-small': HF('jinaai/jina-embeddings-v5-omni-small'),
    'jina-v5-omni-nano': HF('jinaai/jina-embeddings-v5-omni-nano'),
    'jina-embeddings-v5-omni-nano': HF('jinaai/jina-embeddings-v5-omni-nano'),
    'OmniEmbed-v0.1': HF('Tevatron/OmniEmbed-v0.1'),
    'fusion-embedding-2-2b': HF('EximiusLabs/fusion-embedding-2-2b-preview'),
    'Qwen2-Audio-7B': HF('Qwen/Qwen2-Audio-7B'),
    'Qwen2.5-Omni-3B': HF('Qwen/Qwen2.5-Omni-3B'),
    'EBind': HF('encord-team/ebind-full'),
    'LAION Larger CLAP': HF('laion/larger_clap_general'),
    'LAION-CLAP': HF('laion/clap-htsat-unfused'),
    'LAION-CLAP HTSAT unfused': HF('laion/clap-htsat-unfused'),
    'MS-CLAP 2023': 'https://github.com/microsoft/CLAP',
    'MuQ-MuLan-large': HF('OpenMuQ/MuQ-MuLan-large'),
    'wav2clip': 'https://github.com/descriptinc/lyrebird-wav2clip',
    'SpeechT5 multimodal': HF('microsoft/speecht5_asr'),
    'GLAP': HF('mispeech/GLAP'),
    'M2D-CLAP': 'https://github.com/nttcslab/m2d',
    'TP-CLAP': HF('mohanli/TP-CLAP'),
    'CLAP-IPA small': HF('anyspeech/clap-ipa-small-speech'),
    'AudioVerse CLAP': HF('Jazzcharles/clap-audioverse'),
    'MS-CLAP 2022': 'https://github.com/microsoft/CLAP',

    // HEAR (audio-only encoders; HEAR 2021 entries link to their submission code)
    'USAD 2.0-XXLarge+': HF('MIT-SLS/USAD2-XXLarge-Plus'),
    'USAD 2.0-XLarge+': HF('MIT-SLS/USAD2-XLarge-Plus'),
    'USAD 2.0-Large+': HF('MIT-SLS/USAD2-Large-Plus'),
    'USAD 2.0-XLarge': HF('MIT-SLS/USAD2-XLarge'),
    'USAD 2.0-Large': HF('MIT-SLS/USAD2-Large'),
    'USAD 2.0-Base': HF('MIT-SLS/USAD2-Base'),
    'USAD 2.0-Small': HF('MIT-SLS/USAD2-Small'),
    'USAD-Large': HF('MIT-SLS/USAD-Large'),
    'USAD-Base': HF('MIT-SLS/USAD-Base'),
    'USAD-Small': HF('MIT-SLS/USAD-Small'),
    'AF3 Whisper encoder': HF('nvidia/audio-flamingo-3'),
    'Dasheng-1.2B': HF('mispeech/dasheng-1.2B'),
    'Dasheng-Base': HF('mispeech/dasheng-base'),
    'GURA Fuse Cat H+w+C': 'https://github.com/tony10101105/HEAR-2021-NeurIPS-Challenge---NTU-GURA',
    'GURA Fuse wav2vec2': 'https://github.com/tony10101105/HEAR-2021-NeurIPS-Challenge---NTU-GURA',
    'GURA Hubert': 'https://github.com/tony10101105/HEAR-2021-NeurIPS-Challenge---NTU-GURA',
    'RedRice ced_base': HF('mispeech/ced-base'),
    'RedRice ced_small': HF('mispeech/ced-small'),
    'RedRice ced_mini': HF('mispeech/ced-mini'),
    'RedRice EfficientNet-B2': 'https://github.com/RicherMans/HEAR2021_EfficientLatent',
    'Hybrid BYOL-S/CvT': 'https://github.com/GasserElbanna/serab-byols',
    'BYOL-S/CvT': 'https://github.com/GasserElbanna/serab-byols',
    'Logitech SERAB BYOL-S': 'https://github.com/GasserElbanna/serab-byols',
    'BEATs Iter3+': 'https://github.com/microsoft/unilm/tree/master/beats',
    'CP-JKU mn40_as': 'https://github.com/fschmid56/EfficientAT_HEAR',
    'CP-JKU PaSST': 'https://github.com/kkoutini/passt_hear21',
    'OpenL3': 'https://github.com/marl/openl3-hear',
    'wav2vec2': 'https://github.com/hearbenchmark/hear-baseline',
    'CREPE': 'https://github.com/hearbenchmark/hear-baseline',
    'AMAAI wav2vec2': 'https://github.com/KinWaiCheuk/my_package',

    // dataset pipeline: captioning
    'Qwen3-Omni': HF('Qwen/Qwen3-Omni-30B-A3B-Instruct'),
    'MOSS-Audio': HF('OpenMOSS-Team/MOSS-Audio-8B-Thinking'),
    // dataset pipeline: annotation (sample metadata)
    'Dasheng-0.6B': HF('mispeech/dasheng-0.6B'),
    'MMS-LID-4017': HF('facebook/mms-lid-4017'),
    'emotion2vec+ large': HF('emotion2vec/emotion2vec_plus_large'),
    'wav2vec2 age & gender': HF('audeering/wav2vec2-large-robust-24-ft-age-gender'),
    'MAEST': HF('mtg-upf/discogs-maest-30s-pw-129e'),
    'CREPE pitch': 'https://github.com/marl/crepe',
  };
  // datasets: ours (laion/laion-audio-xl-<size>), the dataset comparison, and the retrieval test sets
  const HFD = id => 'https://huggingface.co/datasets/' + id;
  const arxiv = id => 'https://arxiv.org/abs/' + id;
  Object.assign(L, {
    'LAION-Audio-XL': HFD('laion/laion-audio-xl'),
    'LAION-Audio-XL-500M': HFD('laion/laion-audio-xl-500m'),
    'Clotho': 'https://zenodo.org/records/4783391',
    'AudioCaps': 'https://audiocaps.github.io/',
    'WavCaps': HFD('cvssp/WavCaps'),
    'LAION-Audio-630K': 'https://github.com/LAION-AI/audio-dataset',
    'Auto-ACD': HFD('Loie/Auto-ACD'),
    'SALMONN-2': arxiv('2607.17079'),
    'Audio Flamingo 3': HFD('nvidia/AudioSkills'),
    'AutoReCap-XL': 'https://github.com/snap-research/GenAU',
    'LAION-BVD': HFD('laion/BVD-A-10M'),
    'Dasheng mix': arxiv('2406.06992'),
    'SLAP (MovieGen Audio)': arxiv('2601.12594'),
    'Bagpiper': HFD('espnet/Bagpiper_PreTrain_Data_Collection'),
    'GLAP mix': arxiv('2506.11350'),
    'MACS': 'https://zenodo.org/records/5114771',
    'JamAlt lyrics': HFD('jamendolyrics/jam-alt'),
    'FLEURS': HFD('google/fleurs'),
  });
  window.DATA.links = L;
})();
