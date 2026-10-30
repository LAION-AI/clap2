"""GPU feeding: spawned DataLoader workers decode whole tars and yield fixed-size batches; the GPU loop only runs forwards."""
import numpy as np
import torch

from common.tars import samples


class _Batches(torch.utils.data.IterableDataset):
    def __init__(self, pairs, fn, size, keep):
        self.pairs, self.fn, self.size, self.keep = pairs, fn, size, keep

    def __iter__(self):
        w = torch.utils.data.get_worker_info()
        for tar, out in self.pairs[w.id :: w.num_workers] if w else self.pairs:
            keys, xs = [], []
            for key, audio, _ in samples(tar):
                if not self.keep(tar, key):
                    continue
                keys.append(key)
                xs.append(self.fn(audio))
                if len(xs) == self.size:
                    yield out, keys, torch.from_numpy(np.stack(xs)), False
                    keys, xs = [], []
            yield out, keys, torch.from_numpy(np.stack(xs)) if xs else None, True


def batches(pairs, fn, size, workers, keep):
    """Yield (output path, keys, batch of fn(audio) or None, last batch of this tar); keep(tar, key) filters clips."""
    return torch.utils.data.DataLoader(_Batches(pairs, fn, size, keep), batch_size=None, num_workers=workers, pin_memory=True,
                                       prefetch_factor=4 if workers else None,
                                       multiprocessing_context="spawn" if workers else None)
