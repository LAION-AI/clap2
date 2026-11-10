# Design studies

Each study is a data preparation plus a `2_training/train.sh` run of the M tier of the cosine grid
(`ratio_m_base`, see `4_experiments/audio_text_ratio` for installing the config) on the 500M selection, with a cosine
schedule. Runs in the 30 s bucket have a global batch of about 3,400 clips. Studies with audio up to 120 s use one
120 s bucket instead (6008 audio tokens, 8 clips per GPU). `prepare.py` derives the study shards from exported shards.

```bash
E=1_preprocessing/7_keep_30s/export.py; P=4_experiments/design_studies/prepare.py; T=2_training/train.sh
NGPU=8   # GPUs of the run
python $E work d30 --max-seconds 30 && python $E work d120 --max-seconds 120
L30="--naflex-max-tokens-per-batch $((1504 * 3400 / NGPU))"
L120="--naflex-seq-lens 6008 --naflex-max-tokens-per-batch 48064"
D256="--lr 1e-3 --warmup 5000 --train-num-samples 6400000 --epochs 40"
D128="--lr 2e-3 --warmup 3774 --train-num-samples 6400000 --epochs 20"
# audio duration, D = 256M
$T ratio_m_base d120/train dur_120s $L120 $D256        # up to 120 s
$T ratio_m_base d30/train dur_drop $L30 $D256          # drop audio above 30 s
$T ratio_m_base d120/train dur_crop $L30 $D256         # crop to 30 s (the first 30 s of longer clips)
python $P short_oversampling d120/train d120_short && $T ratio_m_base d120_short dur_short_oversampling $L120 $D256
# data domain, D = 256M: keep music, speech and other clips with probability 1, 0.6 and 0.964
python $P domain d120/train d120_domain && $T ratio_m_base d120_domain domain $L120 $D256
# captions, D = 128M: the fixed per-clip mix of the export, short captions only, long captions only
$T ratio_m_base d120/train cap_mix $L120 $D128
for c in short long; do python $P $c d120/train d120_$c && $T ratio_m_base d120_$c cap_$c $L120 $D128; done
```

Short-clip oversampling keeps clips with probability 0.79, 1.0, 0.83, 0.53 and 0.36 for durations up to 7.68, 11.52,
23.36 and 34.24 s and above. MAEB-30 (%):

| Study | D | Variant | MAEB-30 | Speech | Music | Sound |
|---|---|---|---|---|---|---|
| Duration | 256M | up to 120 s | 43.0 | 40.2 | 68.4 | 26.2 |
| | 256M | drop audio above 30 s | 47.1 | 45.8 | 72.3 | 26.1 |
| | 256M | crop to 30 s | 46.5 | 45.1 | 70.6 | 26.4 |
| | 256M | short-clip oversampling | 41.9 | 39.0 | 67.3 | 24.8 |
| Domain | 256M | rebalanced | 41.7 | | | |
| Captions | 128M | 50 % short, 50 % long | 39.1 | 34.9 | 66.3 | 24.6 |
| | 128M | short only | 38.6 | 34.1 | 66.7 | 23.9 |
| | 128M | long only | 38.5 | 34.5 | 65.7 | 23.4 |
