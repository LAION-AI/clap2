#!/usr/bin/env bash
# Caption a clip list with both captioners in the three prompt modes (none, raw, natural), rank the six long captions
# per clip with Gemini, and summarize. Run from the repo root; CLIPS is a parquet with tar and key columns.
# Usage: QWEN_ENV=... MOSS_ENV=... GEMINI_API_KEY=... run.sh WORK CLIPS OUT
set -euo pipefail
export WORK=$1 CLIPS=$2 OUT=$3
for m in qwen moss; do
    M=$m bash 1_preprocessing/6_captioning/serve.sh $m bash -c 'for mode in none raw natural; do
        python 1_preprocessing/6_captioning/caption.py "$WORK" --model $M --clips "$CLIPS" --mode $mode --out "$OUT/$M/$mode"
    done'
done
python 4_experiments/metadata_prompt/rank.py "$WORK" --clips "$CLIPS" --captions "$OUT" --out "$OUT/judgments.jsonl"
python 4_experiments/metadata_prompt/summarize.py "$OUT/judgments.parquet"
