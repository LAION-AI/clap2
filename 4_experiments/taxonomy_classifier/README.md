# Taxonomy classifier head

`labels.parquet` and `relabelled.parquet` hold one row per labelled clip: `audio` (FLAC or WAV bytes), `l3` (a taxonomy
path of depth at most 3, as in `1_preprocessing/4_annotation/0_taxonomy/taxonomy.yaml`) and `archive` (the recording or
tar the clip comes from; the split is by `md5(archive) % 10`: 0 test, 1 held out, the rest training).

```bash
export PYTHONPATH=.
for s in labels relabelled; do
  for g in 0 1 2 3; do CUDA_VISIBLE_DEVICES=$g python 4_experiments/taxonomy_classifier/embed.py $s.parquet feats_$s --part $g/4 & done; wait
done
# first head: 40 epochs, batch 8192
python 4_experiments/taxonomy_classifier/train.py labels.parquet feats_labels head_v1.safetensors
# released head: warm start on the relabelled set, 60 epochs, batch 4096
python 4_experiments/taxonomy_classifier/train.py relabelled.parquet feats_relabelled head.safetensors --init head_v1.safetensors --epochs 60 --batch 4096
```

`classify.py` reads `head.safetensors` from `laion/audio-taxonomy-classifier`; a head trained here has the same format.
