#!/usr/bin/env bash
# Start one caption server per GPU on ports 8000+i, run COMMAND with CAPTION_SERVERS once all are healthy, stop them.
# Usage: serve.sh {qwen|moss} COMMAND...
#   qwen: QWEN_ENV = prefix of an env with vllm[audio]==0.24.0 (Qwen/Qwen3-Omni-30B-A3B-Instruct)
#   moss: MOSS_ENV = prefix of an env with the MOSS-Audio sglang fork, CUDA_HOME = a CUDA toolkit of its torch's
#         CUDA version (for its JIT kernels):
#         pip install "sglang[all] @ git+https://github.com/OpenMOSS/sglang.git@moss-audio#subdirectory=python"
set -euo pipefail
model=$1; shift
n=$(nvidia-smi -L | wc -l)
pids=()
for ((i = 0; i < n; i++)); do
  case $model in
    qwen) CUDA_VISIBLE_DEVICES=$i VLLM_USE_FLASHINFER_SAMPLER=0 \
            "${QWEN_ENV:?}/bin/vllm" serve Qwen/Qwen3-Omni-30B-A3B-Instruct --port $((8000 + i)) --dtype bfloat16 \
            --generation-config vllm --gpu-memory-utilization 0.92 --max-model-len 8192 --max-num-seqs 512 \
            --max-num-batched-tokens 32768 --enable-prefix-caching --enable-chunked-prefill \
            --limit-mm-per-prompt '{"audio": 1}' --trust-remote-code & ;;
    moss) CUDA_VISIBLE_DEVICES=$i SGLANG_DISABLE_CUDNN_CHECK=1 PATH="${MOSS_ENV:?}/bin:$PATH" sglang serve \
            --model-path OpenMOSS-Team/MOSS-Audio-8B-Thinking --port $((8000 + i)) --trust-remote-code & ;;
    *) echo "unknown model $model" >&2; exit 1 ;;
  esac
  pids+=($!)
done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
for ((i = 0; i < n; i++)); do
  until curl -sf "localhost:$((8000 + i))/health" >/dev/null; do kill -0 "${pids[i]}"; sleep 10; done
done
CAPTION_SERVERS=$(for ((i = 0; i < n; i++)); do echo "http://localhost:$((8000 + i))"; done) "$@"
