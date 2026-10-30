# Training

Models are trained with upstream [OpenCLIP](https://github.com/mlfoundations/open_clip); the five model configs
`naflexclap_xxs`, `naflexclap_xs`, `naflexclap_small`, `naflexclap_medium` and `naflexclap_large` are added by
[PR #1230](https://github.com/mlfoundations/open_clip/pull/1230).

```bash
# Environment (FFmpeg decodes the audio)
conda create -n clap2 python=3.12 ffmpeg -y && conda activate clap2
pip install "open_clip_torch[training,audio] @ git+https://github.com/mlfoundations/open_clip@refs/pull/1230/head"
```

`train.sh MODEL DATA NAME [flags]` trains on all GPUs of the machine with `torchrun` (multi-node: the standard torchrun
flags in `TORCHRUN`). It reads the shards `OUT/train` of `1_preprocessing` (clips of at most 30 s, caption in the JSON `text`),
batches them by audio length in one 30 s bucket of 1504 audio tokens (32 clips per GPU under a budget of 49,152
tokens), and uses AdamW (beta 0.9 / 0.98, weight decay 0.2), gradient clipping at 1.0, bfloat16 autocast and
OpenCLIP's learnable logit scale (initialised at 1/0.07, capped at 100). Runs resume from their last checkpoint in
`$LOGS/NAME`.

The scaling runs use a warmup-stable-decay schedule: one constant-LR trunk per regime and, for every budget D, a
branch that resumes the trunk at 80 % of D and decays the LR linearly to zero over the last 20 %.

| Regime | D | Peak LR | Warmup (steps) | Global batch | Virtual epoch |
|---|---|---|---|---|---|
| short | 1M-32M | 4e-4 | 350 | 922 | 200,000 |
| long | 64M-1024M | 7.5e-4 | 2,800 | 3,686 | 3,200,000 |

`wsd.py MODEL D GPUS` prints the trunk and branch commands; it sets the token budget per GPU to 1504 x round(batch /
GPUS), which gives the nearest multiple of GPUS as the global batch:

```bash
python 2_training/wsd.py naflexclap_xs 8e6 8 --data OUT/train
```

Checkpoints are evaluated with `3_evaluation`.
