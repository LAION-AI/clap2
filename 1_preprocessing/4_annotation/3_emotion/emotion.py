"""Speech emotion: emotion2vec+ large (funasr) on the first 5 s of predicted speech; one of nine labels."""
from functools import partial

import numpy as np
import polars as pl

from common.annotate import predicted, run
from common.audio import fixed

SR, SECONDS = 16000, 5
LABELS = ["angry", "disgusted", "fearful", "happy", "neutral", "other", "sad", "surprised", "unknown"]
SCHEMA = {"emo_label": pl.String}


def model(dev):
    from funasr import AutoModel
    emo = AutoModel(model="emotion2vec/emotion2vec_plus_large", hub="hf", device=str(dev), disable_update=True)

    def infer(x):
        clips = [np.trim_zeros(r, "b") if r.any() else r for r in x.numpy()]  # an all-zero window stays 5 s long
        out = emo.generate(clips, granularity="utterance", extract_embedding=False)
        assert all(len(o["scores"]) == len(LABELS) for o in out)
        return {"emo_label": [LABELS[int(np.argmax(o["scores"]))] for o in out]}
    return infer


if __name__ == "__main__":
    run("annotation/emotion", predicted("Speech"), partial(fixed, sr=SR, seconds=SECONDS), model, SCHEMA, size=64)
