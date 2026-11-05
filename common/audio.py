"""Audio decode, resample and FLAC encode. decode() reads any format (0_download); load() reads pipeline FLAC/WAV."""
import io
import itertools

import av
import numpy as np
import soundfile as sf
import soxr

SR = 32000


def decode(src, max_seconds=None, until=None):
    """(frames x channels float32, sample rate) of the first audio stream of a path or bytes; 0 frames if it has none.
    ValueError if longer than max_seconds; decoding stops once `until` seconds are decoded."""
    with av.open(io.BytesIO(src) if isinstance(src, bytes) else src, metadata_errors="ignore") as c:
        if not c.streams.audio:
            return np.zeros((0, 1), np.float32), 0
        s = c.streams.audio[0]
        if max_seconds is not None and (c.duration or 0) > max_seconds * av.time_base:
            raise ValueError(f"longer than {max_seconds} s")
        r = av.AudioResampler(format="flt")  # packed: planar frames with > 8 channels crash to_ndarray
        rate, x, n = s.codec_context.sample_rate, [], 0
        for f in itertools.chain(c.decode(s), [None]):
            for g in r.resample(f):
                x.append(g.to_ndarray().reshape(-1, g.layout.nb_channels))
                n += len(x[-1])
            if until is not None and n >= until * rate:
                break
    return (np.concatenate(x) if x else np.zeros((0, 1), np.float32)), rate


def load(data, sr=SR, seconds=None, offset=0.0):
    """Mono float32 at `sr`, optionally only `seconds` from `offset`."""
    with sf.SoundFile(io.BytesIO(data)) as f:
        f.seek(int(offset * f.samplerate))
        x = f.read(-1 if seconds is None else int(seconds * f.samplerate), dtype="float32", always_2d=True).mean(1)
        rate = f.samplerate
    assert x.size, "empty audio"
    return x if rate == sr else soxr.resample(x, rate, sr, "HQ").astype(np.float32)


def info(data):
    """(sample rate, channels, frames) from the header."""
    with sf.SoundFile(io.BytesIO(data)) as f:
        return f.samplerate, f.channels, f.frames


def flac(x, sr=SR):
    """16-bit FLAC bytes."""
    b = io.BytesIO()
    sf.write(b, np.clip(x, -1, 1), sr, format="FLAC", subtype="PCM_16")
    return b.getvalue()


def fixed(data, sr, seconds, offset=0.0):
    """Mono float32 of `seconds` from `offset` of audio bytes at `sr`, zero-padded to exactly that length."""
    x = load(data, sr, seconds, offset)
    n = int(sr * seconds)
    return np.pad(x[:n], (0, max(0, n - x.size)))
