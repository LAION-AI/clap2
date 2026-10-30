"""Music genre and style: MAEST Discogs-400 on the first 10 s of predicted music (16 kHz); top-5 labels and probabilities."""
import polars as pl
import torch
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

from common.annotate import predicted, run
from common.audio import fixed

SR, SECONDS, NAME = 16000, 10, "mtg-upf/discogs-maest-30s-pw-129e"
SCHEMA = {"maest_tags": pl.List(pl.String), "maest_probs": pl.List(pl.Float32)}
FE = AutoFeatureExtractor.from_pretrained(NAME, trust_remote_code=True)


def window(audio):
    return FE(fixed(audio, SR, SECONDS), sampling_rate=SR, return_tensors="np")["input_values"][0]


def model(dev):
    maest = AutoModelForAudioClassification.from_pretrained(NAME, trust_remote_code=True, dtype=torch.bfloat16).to(dev).eval()

    @torch.inference_mode()
    def infer(x):
        p, i = maest(input_values=x.to(dev, torch.bfloat16, non_blocking=True)).logits.float().sigmoid().topk(5, -1)
        return {"maest_tags": [[maest.config.id2label[j] for j in row] for row in i.tolist()], "maest_probs": p.tolist()}
    return infer


if __name__ == "__main__":
    run("annotation/maest", predicted("Music"), window, model, SCHEMA, size=64)
