"""Clip metadata appended to the caption prompt: nothing, the whole metadata JSON (raw), or selected fields in words."""
import json
import re

import pycountry

from prompts import PROMPT

MODES = ("none", "raw", "natural")
HEADER = ("Automated audio analysis (may be imperfect — use only as supporting context, describe what you actually "
          "hear rather than restating these labels verbatim):")
BINOMIAL = re.compile(r"^[A-Z][a-z']+ [a-z][a-z'-]+$")


def _present(value):
    return value is not None and str(value).strip() not in ("", "[]")


def _quote(text):
    return "'" + str(text).strip()[:120].replace("\\", "\\\\").replace("'", "\\'") + "'"


def _category(m):
    leaf = m["tax_l3"].rsplit("/", 1)[-1].strip()
    return "Sound category: " + (f"{m['tax_l1']} ({leaf})" if leaf and leaf != m["tax_l1"] else m["tax_l1"])


def _voice(m):
    if m["pred_gender"] == "child":
        return "Voice: Child's voice"
    age = m.get("pred_age")
    group = "Adult" if age is None else "Young adult" if age < 30 else "Adult" if age <= 60 else "Older adult"
    return f"Voice: {group} {m['pred_gender']} voice"


def _transcript(m):
    text = str(m["transcription_diarized"]).strip()[:120]
    turns = re.findall(r"\[S(\d+)\]\s*([^\[]+?)\s*(?=\[|$)", text)
    return "Diarized transcript: " + (", ".join(f"S{s}: '{u.strip()}'" for s, u in turns) if turns else _quote(text))


FIELDS = (  # (keys that must be present, the line in words, or a false value to leave the field out)
    (("source",), lambda m: f"Source dataset: {str(m['source']).strip()}"),
    (("tax_l1", "tax_l3"), _category),
    (("duration",), lambda m: "Clip length: " + ("Short" if m["duration"] < 10 else "Medium" if m["duration"] < 30
                                                  else "Long")),
    (("rms_db",), lambda m: "Loudness: " + ("Quiet" if m["rms_db"] < -35 else "Moderate" if m["rms_db"] < -18
                                             else "Loud")),
    (("pred_tempo_bpm",), lambda m: "Tempo: " + ("Slow" if m["pred_tempo_bpm"] < 90
                                                  else "Moderate" if m["pred_tempo_bpm"] <= 120 else "Fast/Upbeat")),
    (("music_key",), lambda m: f"Key: {str(m['music_key']).strip().title()}"),
    (("maest_tags",), lambda m: "Style: " + ", ".join(str(t).split("---")[-1].strip() for t in m["maest_tags"][:3])),
    (("lang_id", "lang_prob"), lambda m: m["lang_prob"] >= 0.5 and "Language: " + getattr(
        pycountry.languages.get(alpha_3=m["lang_id"]), "name", m["lang_id"])),
    (("pred_gender",), _voice),
    (("emo_label",), lambda m: str(m["emo_label"]).lower() not in ("neutral", "unknown")
     and f"Vocal emotion: {m['emo_label']}"),
    (("n_speakers",), lambda m: m["n_speakers"] >= 0 and f"Number of speakers: {int(m['n_speakers'])}"),
    (("youtube_title",), lambda m: f"YouTube title: {_quote(m['youtube_title'])}"),
    (("transcription_diarized",), _transcript),
    (("perch_top_species", "perch_top_logit"), lambda m: m["perch_top_logit"][0] >= 10
     and BINOMIAL.match(m["perch_top_species"][0]) and f"Likely species: {m['perch_top_species'][0]}"),
)


def _block(meta, mode):
    if mode == "raw":
        return f"{HEADER}\n{json.dumps(meta, ensure_ascii=False)}"
    lines = [line for keys, fn in FIELDS
             if all(_present(meta.get(k)) for k in keys) and (line := fn(meta))]
    return f"{HEADER}\n" + "\n".join(f"- {line}" for line in lines) if lines else ""


def prompt(meta, mode):
    """User prompt for one clip: the caption instruction plus, unless mode is 'none', its metadata block."""
    assert mode in MODES, mode
    block = "" if mode == "none" else _block(meta, mode)
    return f"{PROMPT}\n\n{block}" if block else PROMPT
