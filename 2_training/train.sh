#!/bin/bash
# Train a CLAP2 model with upstream OpenCLIP on all GPUs of this machine (resumes from $LOGS/NAME when it exists).
#   2_training/train.sh MODEL DATA NAME [OpenCLIP flags]
# DATA is a folder of WebDataset shards 000000.tar, 000001.tar, ... (OUT/train of 1_preprocessing/run.sh).
# Multi-node: put the standard torchrun flags in TORCHRUN, e.g. TORCHRUN="--nnodes 4 --node-rank 0 --master-addr host".
set -euo pipefail
model=$1 data=$2 name=$3
shift 3
n=$(find "$data" -maxdepth 1 -name '[0-9]*.tar' | wc -l)
last=$(printf %06d $((n - 1)))
[ -f "$data/000000.tar" ] && [ -f "$data/$last.tar" ] || { echo "$data: no 000000..$last.tar" >&2; exit 1; }
torchrun --nproc-per-node "${GPUS:-gpu}" ${TORCHRUN:-} -m open_clip_train.main \
    --model "$model" --train-data "$data/{000000..$last}.tar" --dataset-type webdataset-audio --dataset-resampled \
    --naflex-seq-lens 1504 --naflex-max-tokens-per-batch 49152 --naflex-batch-divisor 1 --length-bucketing \
    --beta1 0.9 --beta2 0.98 --wd 0.2 --grad-clip-norm 1.0 --precision amp_bfloat16 --local-loss --gather-with-grad \
    --workers 8 --logs "${LOGS:-logs}" --name "$name" --save-most-recent --resume latest "$@"
