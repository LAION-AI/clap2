#!/bin/bash
# The whole pipeline: a folder of WebDataset tar folders IN -> LAION-Audio-XL shards OUT/{train,valid,test}, scratch in WORK.
#   bash 1_preprocessing/run.sh IN WORK OUT
# Needs OLAF (upstream Olaf build, see 2_deduplication/1_fingerprint/extract.py), EVAL_DL (benchmark download folder)
# and QWEN_ENV / MOSS_ENV (captioning server environments, see 6_captioning/serve.sh). Every step resumes where it stopped.
# target and budget in 5_selection/config.yaml and --holdout of 7_keep_30s/export.py are set for the paper's selection:
# set them for your pool.
set -euo pipefail
IN=$(realpath "$1") WORK=$(realpath -m "$2") OUT=$(realpath -m "$3")
cd "$(dirname "$0")/.."
export PYTHONPATH="$PWD${PYTHONPATH:+:$PYTHONPATH}"
NGPU=$(nvidia-smi -L | wc -l)
P=1_preprocessing D=1_preprocessing/2_deduplication E=1_preprocessing/3_remove_eval_data A=1_preprocessing/4_annotation
C=1_preprocessing/6_captioning

gpus() {  # one process per GPU, pinned to its share of the cores (nproc would obey OMP_NUM_THREADS)
    local pids=() c=$(($(OMP_NUM_THREADS= OMP_THREAD_LIMIT= nproc) / NGPU))
    for g in $(seq 0 $((NGPU - 1))); do
        CUDA_VISIBLE_DEVICES=$g taskset -c $((g * c))-$((g * c + c - 1)) python "$@" --part $g/$NGPU & pids+=($!)
    done
    for p in "${pids[@]}"; do wait "$p"; done
}

# 0 convert to 32 kHz 16-bit mono, cut long audio; 1 signal statistics and the silence gate
python $P/0_convert/convert.py "$IN" "$WORK"
python $P/1_filter_silent/stats.py "$WORK"

# 2 deduplication: hash matching, fingerprints, SemDeDup
python $D/0_hash_matching/exact.py "$WORK"
PYTHONPATH="$OLAF:$PYTHONPATH" python $D/1_fingerprint/extract.py "$WORK"
python $D/1_fingerprint/match.py "$WORK"
gpus $D/2_semdedup/embed.py "$WORK"
python $D/2_semdedup/cluster.py "$WORK"

# 3 remove evaluation data
python $E/0_eval_items/build.py --downloads "$EVAL_DL" --out "$WORK/eval/registry"
make -C $E/fpscan -j
python $E/1_identifiers.py extract "$WORK"
python $E/1_identifiers.py join "$WORK"
python $E/2_fingerprints.py index "$WORK"
python $E/2_fingerprints.py scan "$WORK"
gpus $E/3_neural.py embed "$WORK"
gpus $E/3_neural.py scan "$WORK"
gpus $E/4_exhaustive.py "$WORK"
python $E/5_decide.py "$WORK"

# 4 annotation (emotion2vec runs in its own process: importing funasr breaks trust_remote_code models such as MAEST)
gpus $A/0_taxonomy/classify.py "$WORK"
python $A/4_music/tempo_key.py "$WORK" &
tempo=$!
for s in 1_language/language 2_speaker/speaker 3_emotion/emotion 4_music/maest 5_species/perch; do
    gpus $A/$s.py "$WORK"
done
wait $tempo

# 5 selection; 6 captioning of the selected clips without text; 7 keep up to 30 s
python $P/5_selection/selection.py "$WORK"
python $C/split.py "$WORK"
for m in qwen moss; do
    bash $C/serve.sh $m python $C/caption.py "$WORK" --model $m --clips "$WORK/caption_split/$m.parquet"
done
python $P/7_keep_30s/export.py "$WORK" "$OUT"
