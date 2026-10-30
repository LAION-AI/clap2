"""Bioacoustic classes: Perch 2.0 on the centre 5 s of predicted animal sound (32 kHz); top-5 classes, names and logits."""
import numpy as np
import polars as pl

from common.annotate import predicted, run
from common.audio import fixed, info

SR, SECONDS, BATCH = 32000, 5, 64
SCHEMA = {"perch_top_species_id": pl.List(pl.Int32), "perch_top_species": pl.List(pl.String), "perch_top_logit": pl.List(pl.Float32)}


def window(audio):
    sr, _, frames = info(audio)
    return fixed(audio, SR, SECONDS, max(0.0, (frames / sr - SECONDS) / 2))


def model(dev):
    from perch_hoplite.zoo import model_configs
    perch = model_configs.load_model_by_name("perch_v2")
    (names,) = [c.classes for c in perch.class_list.values()]  # the one class list shipped with the model

    def infer(x):
        n = len(x)
        x = np.pad(x.numpy(), ((0, BATCH - n), (0, 0)))  # one fixed shape, so the graph is traced once
        logits = np.asarray(perch.batch_embed(x).logits["label"]).reshape(BATCH, -1)[:n]
        assert logits.shape[1] == len(names)
        top = np.argsort(-logits, 1)[:, :5]
        return {"perch_top_species_id": top.tolist(), "perch_top_species": [[names[j] for j in row] for row in top],
                "perch_top_logit": np.take_along_axis(logits, top, 1).tolist()}
    return infer


if __name__ == "__main__":
    run("annotation/species", predicted("Animal  -  bioacoustics"), window, model, SCHEMA, size=BATCH)
