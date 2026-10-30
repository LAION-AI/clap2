"""Keep order for duplicates: one clip per duplicate group survives, public datasets first."""
import numpy as np
import polars as pl
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

PUBLIC = ["academic", "internet"]
COLUMNS = ["clip_id", "audio_id", "group", "has_model_caption", "text_len", "orig_channels", "orig_sample_rate"]
ORDER = [~pl.col("group").is_in(PUBLIC), "has_model_caption", "text_len", "orig_channels", "orig_sample_rate", "audio_id"]
DESCENDING = [False, False, True, True, True, False]


def removed(clips, by):
    """(clip_id, kept_clip_id) of every clip in `clips` (with COLUMNS) that is not the first of its group `by`."""
    kept = pl.col("clip_id").sort_by(ORDER, descending=DESCENDING).first().over(by)
    out = clips.with_columns(kept_clip_id=kept).filter(pl.col("clip_id") != pl.col("kept_clip_id"))
    return out.select("clip_id", "kept_clip_id")


def removed_linked(clips, a, b):
    """removed() over the connected components of the edges a[i] - b[i] between audio_ids."""
    ids, idx = np.unique(np.concatenate([a, b]), return_inverse=True)
    graph = coo_matrix((np.ones(a.size), (idx[: a.size], idx[a.size :])), shape=(ids.size, ids.size))
    component = pl.DataFrame({"audio_id": ids, "component": connected_components(graph, directed=False)[1]})
    linked = clips.join(component, on="audio_id")
    assert linked.height == ids.size, "edge endpoints missing from clips"
    return removed(linked, "component")

