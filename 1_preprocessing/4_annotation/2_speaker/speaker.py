"""Speaker age and gender (audeering wav2vec2) and median voice pitch (torchcrepe) on the first 5 s of predicted speech."""
from functools import partial

import numpy as np
import polars as pl
import torch
import torch.nn as nn
import torchcrepe
from transformers import Wav2Vec2Model, Wav2Vec2PreTrainedModel

from common.annotate import normalize, predicted, run
from common.audio import fixed

SR, SECONDS = 16000, 5
GENDER = ["female", "male", "child"]
SCHEMA = {"pred_age": pl.Float32, "pred_gender": pl.String, "pitch_hz": pl.Float32}


class Head(nn.Module):
    def __init__(self, c, n):
        super().__init__()
        self.dense, self.out_proj = nn.Linear(c.hidden_size, c.hidden_size), nn.Linear(c.hidden_size, n)

    def forward(self, h):
        return self.out_proj(torch.tanh(self.dense(h)))


class AgeGender(Wav2Vec2PreTrainedModel):
    """The model-card head: mean-pooled wav2vec2 states -> age in [0, 1] and female/male/child logits."""

    def __init__(self, config):
        super().__init__(config)
        self.wav2vec2 = Wav2Vec2Model(config)
        self.age, self.gender = Head(config, 1), Head(config, 3)
        self.post_init()

    def forward(self, x):
        h = self.wav2vec2(x)[0].mean(1)
        return self.age(h), self.gender(h)


def model(dev):
    ag = AgeGender.from_pretrained("audeering/wav2vec2-large-robust-24-ft-age-gender", dtype=torch.bfloat16).to(dev).eval()

    @torch.inference_mode()
    def infer(x):
        x = x.to(dev, non_blocking=True)
        age, gender = ag(normalize(x).bfloat16())
        f0, per = torchcrepe.predict(x, SR, hop_length=SR // 5, fmin=50, fmax=550, model="tiny",
                                     return_periodicity=True, device=dev, pad=True)
        f0, voiced = f0.cpu().numpy(), per.cpu().numpy() > 0.5
        return {"pred_age": (age.float().squeeze(1) * 100).tolist(), "pred_gender": [GENDER[i] for i in gender.argmax(1).tolist()],
                "pitch_hz": [float(np.median(f[v])) if v.any() else None for f, v in zip(f0, voiced)]}
    return infer


if __name__ == "__main__":
    run("annotation/speaker", predicted("Speech"), partial(fixed, sr=SR, seconds=SECONDS), model, SCHEMA, size=64)
