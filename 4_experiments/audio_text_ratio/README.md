# Audio:text parameter ratio

`configs/` holds the XS and M tiers of the cosine-schedule grid (`ratio_xs_base`, `ratio_m_base`, audio:text 2.36:1) and
three re-allocations of each at the same non-embedding total and embedding width (`3to2`, `1to1`, `1to2`). They are
OpenCLIP model configs. Copy them next to OpenCLIP's own:

```bash
cp 4_experiments/audio_text_ratio/configs/*.json "$(python -c 'import open_clip, os; print(os.path.dirname(open_clip.__file__))')/model_configs/"
```

Every config is trained with a cosine schedule at D = 16M, 32M and 64M, and `ratio_xs_base` and `ratio_xs_1to1` also at
512M (global batch 1843, 2765, 2765 and 3686 clips):

```bash
NGPU=8   # GPUs of the run
batch() { echo "--naflex-max-tokens-per-batch $((1504 * $1 / NGPU))"; }
for c in ratio_xs_base ratio_xs_3to2 ratio_xs_1to1 ratio_xs_1to2 ratio_m_base ratio_m_3to2 ratio_m_1to1 ratio_m_1to2; do
  2_training/train.sh $c OUT/train ${c}_16M $(batch 1843) --lr 5e-4 --warmup 943 --train-num-samples 1600000 --epochs 10
  2_training/train.sh $c OUT/train ${c}_32M $(batch 2765) --lr 1e-3 --warmup 1183 --train-num-samples 3200000 --epochs 10
  2_training/train.sh $c OUT/train ${c}_64M $(batch 2765) --lr 1e-3 --warmup 2367 --train-num-samples 6400000 --epochs 10
done
for c in ratio_xs_base ratio_xs_1to1; do
  2_training/train.sh $c OUT/train ${c}_512M $(batch 3686) --lr 1e-3 --warmup 5000 --train-num-samples 12800000 --epochs 40
done
```

MAEB-30 (%, mean over seeds 42, 1, 2, 3, from `3_evaluation` with `--model <config> --pretrained logs/<name>/checkpoints/epoch_<n>.pt`):

| D | Tier | 2.36:1 | 1.5:1 | 1:1 | 1:2 |
|---|---|---|---|---|---|
| 16M | XS | 34.6 | 34.6 | 34.4 | 33.5 |
| 32M | XS | 36.4 | 36.2 | 36.5 | 35.9 |
| 64M | XS | 38.5 | 38.8 | 37.9 | 37.7 |
| 512M | XS | 47.3 | | 45.1 | |
| 16M | M | 35.4 | 35.7 | 36.1 | 34.6 |
| 32M | M | 36.8 | 36.7 | 37.3 | 36.3 |
| 64M | M | 39.5 | 38.7 | 39.6 | 39.3 |
