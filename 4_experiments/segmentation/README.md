# Segmentation of long recordings

Three ways to cut long YouTube recordings (`0_download/raw/youtube.py`; `IN` holds only `IN/YouTube/*.tar`) into clips, compared by
training XS for 8M samples with three seeds on each:

- `random`: crops of N(30, 10) s, clipped to [5, 120] s, at uniform positions;
- `quality`: the same candidate crops, keeping those with at most half of the frames below -60 dB, a mean frame
  level of at least -40 dB and at most 5 % clipped samples;
- `silence`: cuts at silences (`common.cut`, scanned at 8 kHz).

Each method cuts as many clips from a recording as it has silence segments; `--keep` subsamples all methods to the
same size (about 1M clips each). The clips are captioned with Qwen3-Omni from the audio alone.

```bash
NGPU=8   # GPUs of the run
for m in random quality silence; do
  python 4_experiments/segmentation/segment.py cut IN seg/$m --method $m --keep 0.04
  python 1_preprocessing/1_filter_silent/stats.py seg/$m && mkdir -p seg/$m/annotation
  bash 1_preprocessing/6_captioning/serve.sh qwen python 1_preprocessing/6_captioning/caption.py \
    seg/$m --model qwen --clips seg/$m/clips.parquet --mode none
  python 4_experiments/segmentation/segment.py text seg/$m seg/$m/data
  for s in 0 1 2; do   # cosine schedule, global batch 922
    2_training/train.sh naflexclap_xs seg/$m/data seg_${m}_s$s --seed $s --lr 5e-4 --warmup 943 \
      --train-num-samples 1000000 --epochs 8 --naflex-max-tokens-per-batch $((1504 * 922 / NGPU))
  done
done
python 4_experiments/segmentation/figure.py   # results.csv: MAEB-30 of the nine runs (seeds 42, 1, 2, 3 averaged)
```
