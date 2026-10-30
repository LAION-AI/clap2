"""Spoken language: MMS-LID-4017 on the first 5 s of predicted speech (16 kHz); top label and its probability."""
from functools import partial

import polars as pl
import torch
from transformers import Wav2Vec2ForSequenceClassification

from common.annotate import normalize, predicted, run
from common.audio import fixed

SR, SECONDS = 16000, 5
SCHEMA = {"lang_id": pl.String, "lang_prob": pl.Float32}


def model(dev):
    lid = Wav2Vec2ForSequenceClassification.from_pretrained(
        "facebook/mms-lid-4017", dtype=torch.bfloat16, attn_implementation="sdpa").to(dev).eval()

    @torch.inference_mode()
    def infer(x):
        p, i = lid(normalize(x.to(dev, non_blocking=True)).bfloat16()).logits.float().softmax(-1).max(-1)
        return {"lang_id": [lid.config.id2label[j] for j in i.tolist()], "lang_prob": p.tolist()}
    return infer


if __name__ == "__main__":
    run("annotation/language", predicted("Speech"), partial(fixed, sr=SR, seconds=SECONDS), model, SCHEMA, size=64)
