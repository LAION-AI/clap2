# Evaluation

The models are evaluated on MAEB, MSEB and HEAR with [CLIP_benchmark](https://github.com/LAION-AI/CLIP_benchmark)
(audio support: [PR #154](https://github.com/LAION-AI/CLIP_benchmark/pull/154)). Each task writes the native results of
its benchmark library into its own directory, and `--skip_existing` resumes. Audio is processed at its native length.

MAEB scores are the mean over the probe and clustering seeds 42, 1, 2 and 3.

```bash
# Environment (MSEB needs Python 3.12; FFmpeg decodes the audio; OpenCLIP comes last)
conda create -n clip_benchmark python=3.12 ffmpeg -y && conda activate clip_benchmark
pip install "clip-benchmark[audio,hear] @ git+https://github.com/LAION-AI/CLIP_benchmark@dffcbf193b341124b499feacb4dd922dc25c655a"
pip install --no-deps heareval==2021.1.3
pip install "open_clip_torch[audio]>=4.2.1"
for size in xxs xs small medium large; do
  m=hf-hub:laion/clap2-$size-audioxl-s1B r=results/clap2-$size-audioxl-s1B
  for b in mseb hear; do
    clip_benchmark eval --model_type clap2 --model $m \
      --dataset $b --dataset_root data/$b --output "$r/{dataset}.json" --skip_existing
  done
  for s in 42 1 2 3; do
    clip_benchmark eval --model_type clap2 --model $m \
      --dataset maeb --seed $s --batch_size 8 \
      --output "$r/maeb_seed$s/{dataset}.json" --skip_existing
  done
  python -c "import pathlib, statistics as s; from mteb.results import TaskResult as T; print('$r', 100 * s.mean(T.from_disk(f).get_score() for f in pathlib.Path('$r').glob('maeb_seed*/*/native_mteb_*/results/*/*/[A-Z]*.json')))"
done
```

A checkpoint of `2_training/train.sh` is evaluated with `--model naflexclap_<size> --pretrained logs/<name>/checkpoints/epoch_<n>.pt`.
`eval.py` runs the same commands from Python.
