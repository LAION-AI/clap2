"""Source-specific text rules: native metadata of one recording (`path` and any source fields) -> `text` plus parsed fields."""
import ast
import csv
import html
import json
import re
from functools import cache
from pathlib import Path
from xml.etree import ElementTree

import polars as pl
import yaml

RULES = {}

def rule(f):
    """Register f(meta, root[, arg]) -> dict with `text` under its name; root is the source's download folder."""
    RULES[f.__name__] = f
    return f

@cache
def table(path, key, sep=","):
    """Rows of a delimited text file as {row[key]: row}."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        return {r[key]: r for r in csv.DictReader(f, delimiter=sep)}

@cache
def pairs(path, sep=None):
    """Lines `id<sep>text` (Kaldi `text` files, `id|text` metadata) as {id: text}."""
    with open(path, encoding="utf-8-sig") as f:
        return dict(l.rstrip("\r\n").split(sep, 1) for l in f if l.strip())

def sidecar(m, root, ext):
    """Content of the file next to the audio with the same stem and extension `ext`."""
    return (root / m["path"]).with_suffix(ext).read_text(encoding="utf-8-sig").strip()

def stem(m):
    """File name of the audio without extension."""
    return Path(m["path"]).stem

def folder(m, up=1):
    """Name of the folder `up` levels above the audio file."""
    return Path(m["path"]).parts[-1 - up]

def words(s):
    """Label to words: underscores, hyphens and repeated spaces to single spaces."""
    return re.sub(r"[_\-\s]+", " ", s).strip()

def speech(language, transcript):
    """Text of transcribed speech."""
    return f'Speech in {language}: "{transcript}"' if transcript else f"Speech in {language}"

def transcribed(t, language, **fields):
    """Rule result for transcribed speech."""
    return {**fields, "transcript": t, "text": speech(language, t)}

@cache
def _line_index(root):
    return {k.removesuffix(".wav"): v.strip() for p in sorted(root.rglob("line_index*.tsv")) for k, v in pairs(p, "\t").items()}

@rule
def line_index(m, root, language):
    return transcribed(_line_index(root)[stem(m)], language)

@cache
def _kaldi(root):
    return {k: v.strip() for p in sorted(root.rglob("text")) if p.is_file() for k, v in pairs(p).items()}

@rule
def kaldi(m, root, language):
    return transcribed(_kaldi(root)[stem(m)], language)

@cache
def _utt_spk_text(root):
    return {k: v.split("\t") for p in sorted(root.rglob("utt_spk_text.tsv")) for k, v in pairs(p, "\t").items()}

@rule
def utt_spk_text(m, root, language):
    spk, t = _utt_spk_text(root)[stem(m)]
    return transcribed(t, language, speaker_id=spk)

@rule
def transcript_txt(m, root, language):
    return transcribed(sidecar(m, root, ".txt"), language)

@rule
def iisc_mile(m, root, language):
    p = root / m["path"]
    return transcribed((p.parent.parent / "trans_files" / f"{p.stem}.txt").read_text(encoding="utf-8").strip(), language)

@cache
def _nchlt(root):
    return {Path(r.attrib["audio"]).name: (s.attrib, r.findtext("orth").strip()) for x in sorted(root.rglob("transcriptions/*.xml"))
            for s in ElementTree.parse(x).getroot() for r in s}

@rule
def nchlt(m, root, language):
    spk, t = _nchlt(root)[Path(m["path"]).name]
    return transcribed(t, language, speaker_id=spk["id"], speaker_gender=spk["gender"], speaker_age=int(spk["age"]))

@rule
def vivae(m, root):
    speaker, emotion, intensity, _ = stem(m).split("_")
    how = {"low": "mildly", "moderate": "moderately", "strong": "strongly", "peak": "intensely"}[intensity]
    what = "a sense of achievement" if emotion == "achievement" else emotion
    return {"speaker": speaker, "emotion": emotion, "intensity": intensity, "text": f"A vocal burst {how} expressing {what}"}

@rule
def nemo(m, root):
    return {"text": f"Polish emotional speech expressing {'surprise' if m['emotion'] == 'surprised' else m['emotion']}."}

@rule
def openslr_143(m, root):
    (sex, t), = [(s, r[stem(m)]["sentence"]) for s in ("Male", "Female")
                 if stem(m) in (r := table(root / f"male-female-data/{s}Voice.tsv", "audio_id", "\t"))]
    return transcribed(t, "Nepali", speaker_gender=sex.lower())

@rule
def arca23k(m, root):
    label = words(table(root / "ARCA23K.ground_truth/train.csv", "fname")[stem(m)]["label"])
    return {"label": label, "text": f"Sound of {label.lower()}"}

@rule
def bsd10k(m, root):
    r = table(root / "metadata/BSD10k_metadata.csv", "sound_id")[stem(m)]
    c = table(root / "metadata/BST_description.csv", "ClassKey")[r["class"]]
    return {"class": r["class"], "title": r["title"], "tags": r["tags"], "uploader": r["uploader"], "license": r["license"],
            "text": f"{c['TopLevel']}: {c['SecondLevel'].lower()}. {c['Description']}"}

@cache
def cadenzaclip_meta(root):
    return {r["signal"]: r for s in ("train", "valid") for r in json.loads((root / f"cadenza_data/metadata/{s}_metadata.json").read_text())}

@rule
def cadenzaclip(m, root):
    lyrics = cadenzaclip_meta(root)[stem(m).removesuffix("_unproc")]["prompt"].strip()
    return {"lyrics": lyrics, "text": f'Singing with the lyrics "{lyrics}"'}

# Coswara recording task -> description
COSWARA_TEXT = {"breathing-deep": "Deep breathing respiratory sound recording for health analysis",
                "breathing-shallow": "Shallow breathing respiratory sound recording for health analysis",
                "cough-heavy": "Heavy coughing sound recording for respiratory health diagnosis",
                "cough-shallow": "Light coughing sound recording for respiratory health diagnosis",
                "counting-normal": "Normal-paced counting speech recording for voice analysis",
                "counting-fast": "Fast-paced counting speech recording for voice analysis",
                "vowel-a": "Sustained vowel 'A' vocalization for voice quality assessment",
                "vowel-e": "Sustained vowel 'E' vocalization for voice quality assessment",
                "vowel-o": "Sustained vowel 'O' vocalization for voice quality assessment"}

@rule
def coswara(m, root):
    r = table(root / "iiscleap/iiscleap-Coswara-Data-bf300ae/combined_data.csv", "id")[folder(m)]
    return {"sound_type": stem(m), "covid_status": r["covid_status"], "gender": r["g"], "age": r["a"], "text": COSWARA_TEXT[stem(m)]}

# DEMAND environment folder -> recording location (from DEMAND.pdf)
DEMAND_TEXT = {"DKITCHEN": "Background environmental noise recorded inside a domestic kitchen",
               "DLIVING": "Background environmental noise recorded inside a domestic living room",
               "DWASHING": "Background environmental noise recorded in a domestic washing room (laundry room)",
               "NFIELD": "Background outdoor noise recorded on an open sports field",
               "NPARK": "Background outdoor noise recorded in a city park",
               "NRIVER": "Background outdoor noise of flowing water recorded next to a river",
               "OHALLWAY": "Background noise recorded in an office building hallway",
               "OMEETING": "Background noise recorded in an office meeting room", "OOFFICE": "Background noise recorded in a small office",
               "PCAFETER": "Background crowd noise recorded in a busy office cafeteria",
               "PRESTO": "Background crowd noise recorded in a university restaurant at lunchtime",
               "PSTATION": "Background crowd noise recorded in the main transfer area of a busy subway station",
               "SCAFE": "Background street noise recorded from the terrace of a cafe on a public square",
               "SPSQUARE": "Background street noise recorded on a public town square",
               "STRAFFIC": "Background street noise recorded at a busy traffic intersection",
               "TBUS": "Background noise recorded inside a public transit bus while driving",
               "TCAR": "Background noise recorded inside a private passenger car while driving",
               "TMETRO": "Background noise recorded inside a running subway train"}

@rule
def demand(m, root):
    return {"environment": folder(m), "channel": int(stem(m).removeprefix("ch")), "text": DEMAND_TEXT[folder(m)]}

# EmoGator category codes 01-30 (README order)
EMOGATOR_EMO = ["adoration", "amusement", "anger", "awe", "confusion", "contempt", "contentment", "desire", "disappointment", "disgust",
                "distress", "ecstasy", "elation", "embarrassment", "fear", "guilt", "interest", "neutral", "pain", "pride", "realization",
                "relief", "romantic love", "sadness", "serenity", "shame", "negative surprise", "positive surprise", "sympathy", "triumph"]

@rule
def emogator(m, root):
    contributor, code, instance = stem(m).split("-")
    e = EMOGATOR_EMO[int(code) - 1]
    return {"emotion": e, "contributor_id": contributor, "instance": instance,
            "text": "A neutral vocal burst" if e == "neutral" else f"A vocal burst expressing {e}"}

@rule
def fsd50k(m, root):
    r = table(root / "FSD50K.ground_truth/dev.csv", "fname")[stem(m)]
    return {"labels": r["labels"], "split": r["split"], "text": words(r["labels"].replace(",", " ")).capitalize()}

@rule
def homburg(m, root):
    genre = folder(m)
    assert genre in ("alternative", "blues", "electronic", "folkcountry", "funksoulrnb", "jazz", "pop", "raphiphop", "rock"), genre
    return {"genre": genre, "text": f"{genre.title()} music excerpt for genre classification: {stem(m)}"}

@cache
def ismir2004genre_dev(root):
    with open(root / "ismir04_genre/metadata/development/tracklist.csv", encoding="utf-8") as f:
        return {r[5]: r[0] for r in csv.reader(f)}

@rule
def ismir2004genre(m, root):
    split, rel = m["path"].split("/audio/", 1)[1].split("/", 1)
    genre = ismir2004genre_dev(root)[rel] if split == "development" else rel.split("/")[0]
    return {"genre": genre, "split": split, "text": f"{genre.replace('_', ' or ').capitalize()} music"}

@rule
def jamendo_alt(m, root):
    r = table(root / "metadata.csv", "Filepath")[Path(m["path"]).name]
    return {"artist": r["Artist"], "title": r["Title"], "genre": r["Genre"], "language": r["Language"], "license": r["LicenseType"],
            "lyrics": (root / "lyrics" / f"{stem(m)}.txt").read_text(encoding="utf-8").strip(),
            "text": f"'{r['Title']}' by {r['Artist']}, a {r['Genre'].lower()} song with aligned lyrics"}

@rule
def mast_rhythm(m, root):
    item, rhy, take, *grade = stem(m).split("_")
    if take.startswith("ref"):
        return {"pattern": f"{item}_{rhy}", "role": "reference",
                "text": "A rhythmic pattern played by a jury member as the reference in a conservatory entrance exam"}
    grade, = grade
    return {"pattern": f"{item}_{rhy}", "role": "performance", "grade": grade,
            "text": f"A candidate reproducing a rhythmic pattern in a conservatory entrance exam, graded {grade}"}

# MUSAN source folder -> source site
MUSAN_SITE = {"fma": "Free Music Archive", "fma-western-art": "Free Music Archive (western art)", "hd-classical": "HD Classical Music",
              "jamendo": "Jamendo", "rfm": "incompetech royalty-free music (Kevin MacLeod)", "librivox": "LibriVox audiobooks",
              "us-gov": "US government hearings, committees and debates", "free-sound": "Freesound", "sound-bible": "SoundBible"}
MUSAN_UNANNOTATED = {*(f"music-fma-{i:04d}" for i in (27, 28, 85, 125, 126, 127)), *(f"music-jamendo-{i:04d}" for i in (107, 110, *range(210, 217))), "speech-librivox-0029"}

@cache
def musan_ann(path):
    with open(path, encoding="utf-8") as f:
        return {t[0]: t[1:] for l in f if (t := l.split())}

@rule
def musan(m, root):
    p = Path(m["path"])
    kind, src = p.parts[-3:-1]
    ann = {} if src in ("sound-bible", "us-gov") else musan_ann(root / p.parent / "ANNOTATIONS")  # these two folders have no ANNOTATIONS
    assert p.stem in ann or kind == "noise" or src == "us-gov" or p.stem in MUSAN_UNANNOTATED, p.stem  # noise: only background clips are listed
    a = ann[p.stem] if p.stem in ann else None
    if kind == "music" and a:
        what = f"A {' / '.join(a[0].split(','))} music track {'with' if a[1] == 'Y' else 'without'} vocals" + (f" by {words(a[2])}" if len(a) > 2 else "")
    elif kind == "music":
        what = "A music track"
    elif src == "us-gov":
        what = "English speech"
    elif kind == "speech":
        what = f"Read speech in {a[1].capitalize()} by a {'male' if a[0] == 'm' else 'female'} speaker" if a else "Read speech"
    else:
        what = "A sound effect recording" if src == "sound-bible" else f"A {'background' if a is not None else 'foreground'} noise recording"
    return {"category": kind, "source": src, "text": f"{what} (from {MUSAN_SITE[src]})."}

# NIGENS class folder -> class name
NIGENS_CLASS = {"alarm": "Alarm", "baby": "Crying baby", "crash": "Crash", "dog": "Barking dog", "engine": "Running engine",
                "femaleScream": "Female scream", "femaleSpeech": "Female speech", "fire": "Burning fire", "footsteps": "Footsteps",
                "general": "General", "knock": "Knocking on door", "maleScream": "Male scream", "maleSpeech": "Male speech",
                "phone": "Ringing phone", "piano": "Piano"}

@rule
def nigens(m, root):
    return {"class": NIGENS_CLASS[folder(m)], "text": NIGENS_CLASS[folder(m)]}

# PCD track suffix -> content (O = orchestra, P = piano, OP = mix)
PCD_TRACK = {"O": "orchestra only", "P": "solo piano only", "OP": "piano and orchestra", "O_reverb": "orchestra only, with added reverb",
             "P_reverb": "solo piano only, with added reverb", "OP_reverb": "piano and orchestra, with added reverb",
             "O_soni": "sonification of the orchestra part", "P_soni": "sonification of the piano part"}

@rule
def pcd(m, root):
    ex = folder(m)
    track = stem(m).removeprefix(ex + "_")
    r = table(root / "PCD_2.0.1/metadata.csv", "excerpt_name", ";")[ex]
    return {"excerpt": ex, "track": track, "text": f"{ex.split('_')[0]} {r['full_name'].strip().replace(';', ', ')}, "
                                                    f"measures {r['start_measure']}-{r['end_measure']}: {PCD_TRACK[track]}"}

# DCASE urban scene label -> where it was recorded
TAU_SCENE = {"airport": "at an airport", "bus": "inside a bus", "metro": "in a metro/subway", "metro_station": "at a metro station",
             "park": "in a park", "public_square": "in a public square", "shopping_mall": "in a shopping mall",
             "street_pedestrian": "on a pedestrian street", "street_traffic": "on a street with traffic", "tram": "inside a tram"}

@rule
def tau_urban_acoustic_scenes_2019(m, root):
    scene, city, *_, device = stem(m).split("-")
    return {"scene": scene, "city": city, "device": device, "text": f"Ambient sounds recorded {TAU_SCENE[scene]}"}

UIOWA_DYN = {"pp": "pianissimo", "mf": "mezzo-forte", "ff": "fortissimo"}

@rule
def uiowa_mis(m, root):
    first, *rest = stem(m).split(".")
    inst = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", first).lower()
    notes = [t for t in rest if re.fullmatch(r"([A-G]b?\d)+", t)]
    dyn = [UIOWA_DYN[t] for t in rest if t in UIOWA_DYN]
    parts = [f"Individual {inst} note sample", *(f"playing {n}" for n in notes[:1]), *(f"at {d}" for d in dyn[:1])]
    return {"instrument": inst, "text": " ".join(parts) + " from the University of Iowa Musical Instrument Samples, recorded in anechoic chamber"}

@rule
def vocalset(m, root):
    singer, context, technique = Path(m["path"]).parts[-4:-1]
    return {"singer": singer, "context": context, "technique": technique,
            "text": f"{words(technique).capitalize()} {words(context)} by a {singer.rstrip('0123456789')} singer"}

@rule
def watkins(m, root):
    species = words(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", folder(m, 2)))
    return {"species": species, "year": folder(m), "text": f"Underwater vocalization of a {species}."}

# ASVP-ESD emotion code -> (emotion, typical non-speech sound)
ASVP_EMO = {"01": ("boredom", ", a sigh"), "02": ("neutral emotion", ", calm speech"), "03": ("happiness", ", a laugh"),
            "04": ("sadness", ", crying"), "05": ("anger", ", a grunt"), "06": ("fear", ", a scream"), "07": ("disgust", ""),
            "08": ("surprise", ", a gasp"), "09": ("excitement", ""), "10": ("pleasure", ""), "11": ("pain", ", a groan"),
            "12": ("disappointment", ""), "13": ("breathing", ", a breath")}

@rule
def asvp_esd(m, root):
    _, channel, code, intensity, *_ = stem(m).split("-")
    emotion, sound = ASVP_EMO[code]
    text = f"A person expressing {emotion} through speech" if channel == "01" else f"A non-speech vocal expression of {emotion}{sound}"
    return {"emotion": emotion, "category": "Speech" if channel == "01" else "NonSpeech", "intensity": intensity, "text": text}

@cache
def arabic_speech_tr(path):
    with open(path, encoding="utf-8") as f:
        return dict(l.split('"')[1::2] for l in f if l.strip())

@rule
def arabic_speech(m, root):
    p = Path(m["path"])
    t = arabic_speech_tr(root / p.parent.parent / "orthographic-transcript.txt")[p.name]
    return {"transcript": t, "text": speech("Arabic", t)}

@cache
def birdset_xcl_meta(root):
    cols = ["filepath", "ebird_code", "ebird_code_secondary", "call_type", "quality", "recordist", "license"]
    return {r["filepath"]: r for r in pl.read_parquet(root / "XCL/XCL_metadata.parquet", columns=cols).to_dicts()}

def birdset_xcl_name(root, code):
    r = table(root / "ebird_taxonomy_2022.csv", "SPECIES_CODE")[code]
    return f"{r['COMMON_NAME']} ({r['SCIENTIFIC_NAME']})"

@rule
def birdset_xcl(m, root):
    r = birdset_xcl_meta(root)[Path(m["path"]).name]
    also = [birdset_xcl_name(root, c) for c in r["ebird_code_secondary"] or [] if c != r["ebird_code"]]
    call = f": {r['call_type']}" if r["call_type"] and r["call_type"] != "uncertain" else ""
    return {**{k: r[k] for k in ("ebird_code", "call_type", "quality", "recordist", "license")},
            "text": f"A bird sound recording of {birdset_xcl_name(root, r['ebird_code'])}{call}." + (f" Also audible: {', '.join(also)}." if also else "")}

@cache
def commonvoice_fr_tsv(root):
    d = root / "cv-corpus-8.0-2022-01-19_FR_wav"
    out = {}
    for s in ("validated", "invalidated", "other"):
        with open(d / f"{s}.tsv", encoding="utf-8") as f:
            out |= {Path(r["path"]).stem: r for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}
    return out

@rule
def commonvoice_fr(m, root):
    r = commonvoice_fr_tsv(root)[stem(m)]
    return {"transcript": r["sentence"], "speaker_id": r["client_id"], "gender": r["gender"], "age": r["age"], "accents": r["accents"],
            "text": speech("French", r["sentence"])}

@cache
def datased_events(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.setdefault(r["sound_name"], {})[r["class_name"]] = None
    return out

@rule
def datased(m, root):
    p = root / m["path"]
    events = list(datased_events(p.parent.parent / "SED_ground_truth/Monophonic_sound_detection.csv")[p.name])
    return {"events": events, "text": f"Environmental noise recording containing: {', '.join(events)}"}

# HLS-CMDS auscultation landmark codes (README; apex is "A" in file names, "Apex" in Mix.csv)
HLS_LOC = {"RUSB": "right upper sternal border", "LUSB": "left upper sternal border", "LLSB": "lower left sternal border",
           "RC": "right costal margin", "LC": "left costal margin", "Apex": "apex", "A": "apex", "RUA": "right upper anterior",
           "LUA": "left upper anterior", "RMA": "right mid anterior", "LMA": "left mid anterior", "RLA": "right lower anterior",
           "LLA": "left lower anterior"}

# HLS-CMDS sound type codes in the HS/LS file names (<gender>_<code>_<location>.wav)
HLS_TYPE = {"HS": ("Heart", {"N": "Normal", "AF": "Atrial Fibrillation", "AVB": "AV Block", "ESM": "Early Systolic Murmur",
                             "LDM": "Late Diastolic Murmur", "LSM": "Late Systolic Murmur", "MSM": "Mid Systolic Murmur",
                             "S3": "S3", "S4": "S4", "T": "Tachycardia"}),
            "LS": ("Lung", {"N": "Normal", "CC": "Coarse Crackles", "FC": "Fine Crackles", "PR": "Pleural Rub", "R": "Rhonchi",
                            "W": "Wheezing"})}

@cache
def hls_cmds_mix(root):
    with open(root / "Mix.csv", encoding="utf-8-sig") as f:
        return {r[k]: (r, k) for r in csv.DictReader(f) for k in ("Heart Sound ID", "Lung Sound ID", "Mixed Sound ID")}

@rule
def hls_cmds_heart_lung_sounds(m, root):
    kind = Path(m["path"]).parent.name
    if kind in HLS_TYPE:
        gender, code, loc = stem(m).split("_")
        sounds = {HLS_TYPE[kind][0]: HLS_TYPE[kind][1][code]}
    else:
        r, col = hls_cmds_mix(root)[stem(m)]
        gender, loc = r["Gender"], r["Location"]
        sounds = {o: r[f"{o} Sound Type"] for o in (["Heart", "Lung"] if col == "Mixed Sound ID" else [col.split()[0]])}
    desc = " mixed with ".join(f"{t} {o.lower()} sound" for o, t in sounds.items())
    return {"gender": gender, "location": loc, **{f"{o.lower()}_sound": t for o, t in sounds.items()},
            "text": f"{desc}, recorded with a digital stethoscope from a clinical manikin at the {HLS_LOC[loc]}"}

@rule
def multilingual_librispeech(m, root):
    p = Path(m["path"])
    language = p.parts[0].split("_")[1]
    t = pairs(root / p.parts[0] / p.parts[1] / "transcripts.txt", "\t")[p.stem]
    return {"transcript": t, "speaker_id": p.stem.split("_")[0], "language": language, "text": speech(language.capitalize(), t)}

@rule
def openslr_120_himia_cw(m, root):
    t = pairs(root / "transcription.txt", "\t")[Path(m["path"]).name]
    spk = table(root / "speaker_information.txt", "index", "\t")[stem(m)[:4]]
    return {"transcript": t, "speaker_id": stem(m)[:4], "speaker_gender": spk["gender"].lower(), "speaker_age": spk["Age"],
            "text": speech("Mandarin Chinese", t)}

@rule
def openslr_149_tibetan_greetings(m, root):
    p = root / m["path"]
    syl, = p.parent.glob("*.txt")
    t = pairs(syl, " ")[p.stem].strip()
    return {"transcript": t, "dialect": folder(m), "text": speech("Tibetan", t)}

@rule
def vivos(m, root):
    t = pairs(root / "vivos" / Path(m["path"]).parts[1] / "prompts.txt", " ")[stem(m)]
    return {"transcript": t, "speaker_id": folder(m), "text": speech("Vietnamese", t)}

@rule
def yesno_hebrew_asr(m, root):
    t = " ".join({"1": "yes", "0": "no"}[b] for b in stem(m).split("_"))
    return {"transcript": t, "text": speech("Hebrew", t)}

@rule
def vocalsketch(m, root):
    p = root / m["path"]
    if folder(m) == "sound_recordings":
        r = table(p.parent.parent / "sound_recordings.csv", "filename")[p.name]
        return {"label": r["sound_label"], "audio_type": "reference", "text": f"Reference sound ({r['audio_concept_subset']}): {r['sound_label']}"}
    label = p.stem.rsplit(" - ", 1)[0]
    return {"label": label, "audio_type": "vocal_imitation", "text": f'A vocal sketch (human voice imitation) of "{label}"'}

EMOLIA_LANG = {"en": "English", "zh": "Chinese", "de": "German", "fr": "French", "ja": "Japanese", "ko": "Korean"}

@rule
def emolia_balanced_5m(m, root):
    t = m["text"].strip()
    return {"transcript": t, "text": speech(EMOLIA_LANG[m["language"]], t)}

@cache
def avcaps_captions(root, split):
    return json.loads((root / f"{split}_captions.json").read_text(encoding="utf-8"))

@rule
def avcaps(m, root):
    split = folder(m).removesuffix("_videos")
    caps = avcaps_captions(root, split)[stem(m)]["audio_captions"]
    return {"split": split, "video_id": stem(m), "audio_captions": caps, "text": caps[0]}

CHIMEHOME_LABEL = {"c": "child speech", "m": "adult male speech", "f": "adult female speech", "v": "video game or TV sounds",
                   "p": "percussive sounds", "b": "broadband noise from household appliances", "o": "other identifiable sounds"}

@rule
def chimehome(m, root):
    label = pairs((root / m["path"]).with_name(stem(m).removesuffix(".48kHz") + ".csv"), ",")["majorityvote"]
    names = [CHIMEHOME_LABEL[c] for c in label]
    text = f"A sound of {' and '.join(filter(None, [', '.join(names[:-1]), names[-1]]))}" if names else ""
    return {"label": label, "text": text}

@rule
def deeply_nonverbal_vocal(m, root):
    speaker, _, _, sex, age, _, _, _ = stem(m).split("_")
    sex = ("female", "male")[int(sex)]
    return {"label": folder(m), "speaker_id": speaker, "sex": sex, "age": int(age), "text": f"A {sex} {words(folder(m))}"}

@rule
def fsdkaggle2019_v2(m, root):
    split = folder(m).split(".")[1].removeprefix("audio_")
    r = table(root / f"FSDKaggle2019.meta/{split}_post_competition.csv", "fname")[Path(m["path"]).name]
    return {"split": split, "labels": r["labels"], "license": r["license"], "text": ", ".join(words(l) for l in r["labels"].split(","))}

HUMBUGDB_GENUS = {"an": "Anopheles", "ae": "Aedes", "ma": "Mansonia"}  # genus abbreviations in the metadata csv

@rule
def humbugdb(m, root):
    r = table(root / "neurips_2021_zenodo_0_0_1.csv", "id")[stem(m)]
    species = re.sub(r"^(an|ae|ma) ", lambda g: HUMBUGDB_GENUS[g[1]] + " ", r["species"]).capitalize()
    mosquito = "Mosquito wingbeat sound" + (f", {species}" if species else "")
    return {"sound_type": r["sound_type"], "species": species, "country": r["country"],
            "text": mosquito if r["sound_type"] == "mosquito" else ""}

@rule
def ismir2004tempo(m, root):
    if not m["path"].startswith("BallroomData/"):
        return {"text": ""}
    style = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", folder(m)).replace("-", " ").lower()
    return {"dance_style": style, "text": f"A {style} ballroom dance excerpt"}

@rule
def kitchen20(m, root):
    p = Path(m["path"])
    r = table(root / p.parent.parent / "kitchen20.csv", "path")[f"audio/{p.name}"]
    return {"category": r["category"], "fold": r["fold"], "text": f"Kitchen sound: {words(r['category'])}"}

@rule
def mavd_traffic(m, root):
    p = Path(m["path"])
    rows = (root / p.parent.name.replace("audio", "annotations") / f"{p.stem}.txt").read_text().splitlines()
    labels = [r.split("\t")[2].strip() for r in rows if r.strip()]
    parts = {}
    for label in labels:
        source, _, part = label.partition("/")
        parts.setdefault(source, set()).update([words(part)] if part else [])
    events = [f"{s} ({', '.join(sorted(c))})" if c else s for s, c in parts.items()]
    return {"labels": sorted(set(labels)), "text": "Traffic sounds featuring " + ", ".join(events)}

@rule
def musifeast_17(m, root):
    r = table(root / "1. MUSIFEAST-17 Stimuli and Information/MUSIFEAST-17 Stimuli Collection/MUSIFEAST17_metadata.csv",
              "CLIP_NAME")[stem(m)]
    return {"genre": r["GENRE"], "familiarity": r["FAMILIARITY"], "title": r["TRACK_TITLE"], "artist": r["ARTIST"],
            "text": f"{r['GENRE']} music: {r['TRACK_TITLE']} by {r['ARTIST']}"}

@rule
def nsynth(m, root):
    family, source, _, pitch, velocity = re.fullmatch(r"([a-z_]+?)_(acoustic|electronic|synthetic)_(\d+)-(\d+)-(\d+)", stem(m)).groups()
    return {"instrument_family": family, "instrument_source": source, "pitch": int(pitch), "velocity": int(velocity),
            "text": f"This music note is produced by {words(family)} with pitch {int(pitch)} and velocity {int(velocity)}"}

@rule
def panama_katydid(m, root):
    kind = Path(m["path"]).parts[1]
    if kind == "soundscape":
        return {"recording_type": kind, "text": ""}
    species = folder(m).replace("_", '"')
    return {"recording_type": kind, "species": species, "text": f"Panamanian katydid vocalization, {species}"}

STARSS22_CLASS = ["female speech", "male speech", "clapping", "telephone", "laughter", "domestic sounds", "footsteps",
                  "door opening or closing", "music", "musical instrument", "water tap", "bell", "knock"]

@rule
def starss22(m, root):
    p = Path(m["path"])
    rows = (root / "metadata_dev" / p.parent.name / f"{p.stem}.csv").read_text().split()
    classes = [STARSS22_CLASS[c] for c in sorted({int(r.split(",")[1]) for r in rows})]
    assert classes, m["path"]
    return {"classes": classes, "text": "Sound events: " + ", ".join(classes)}

@rule
def tau_urban_acoustic_scenes_2019_mobile(m, root):
    scene, city, _, _, device = stem(m).split("-")
    return {"scene": scene, "city": city, "device": device, "text": f"Acoustic scene: {words(scene)}"}

@rule
def urban_sed(m, root):
    p = Path(m["path"])
    rows = (root / "URBAN-SED_v2.0.0/annotations" / p.parent.name / f"{p.stem}.txt").read_text().splitlines()
    labels = list(dict.fromkeys(r.split("\t")[2].strip() for r in rows if r.strip()))
    assert labels, m["path"]
    return {"labels": labels, "text": "Urban sound events: " + ", ".join(words(l) for l in labels)}

@rule
def vocalsound(m, root):
    speaker, _, label = stem(m).split("_")
    label = "throat clearing" if label == "throatclearing" else label
    sex = {"f": "female", "m": "male"}[speaker[0]]
    return {"speaker_id": speaker, "label": label, "sex": sex, "text": f"A {sex} {label}"}

ZEBRA_FINCH_2018_TYPE = {"Ag": "Wsst (aggressive) call", "Be": "begging call", "DC": "distance call", "Di": "distress call",
                         "LT": "long tonal call", "Ne": "nest call", "So": "song", "Te": "tet call", "Th": "thuk call",
                         "Tu": "tuck call", "Wh": "whine call",
                         "WC": "call"}  # first two letters of the call type (Library_notes.pdf); WC (3 files) is not defined there

@rule
def zebra_finch_2018(m, root):
    bird, _, vt, _ = re.fullmatch(r"([A-Za-z0-9]+)_(\d+)[-_](.+?)[-_](\w+)", stem(m)).groups()
    kind = ZEBRA_FINCH_2018_TYPE[vt[:2]]
    return {"bird_id": bird, "vocalization_type": kind, "text": f"A {kind} of a zebra finch"}

@cache
def afrispeech_rows(root):
    return {Path(k).stem: r for p in sorted(root.glob("transcripts/*/*.csv")) for k, r in table(p, "audio_paths").items()}

@rule
def afrispeech_200(m, root):
    r = afrispeech_rows(root)[stem(m)]
    t = r["transcript"].strip()
    return {"accent": r["accent"], "domain": r["domain"], "country": r["country"], "transcript": t, "text": speech("English", t)}

BARKOPEDIA_DOG_LABELS = {"train": "train/train_label.csv", "validation": "validation/valid_labels.csv"}

@rule
def barkopedia_dog(m, root):
    split = Path(m["path"]).parts[0]
    if split == "test":
        return {"split": split, "text": ""}
    r = table(root / BARKOPEDIA_DOG_LABELS[split], "audio_id")[stem(m)]
    return {"split": split, "activity": r["activity"], "environment": r["environement"],
            "text": f"Dog sounds, activity: {r['activity']}, environment: {r['environement']}"}

CAFE_FRENCH_EMOTION = {"C": "anger", "D": "disgust", "J": "happiness", "N": "neutral", "P": "fear", "S": "surprise", "T": "sadness"}
CAFE_FRENCH_SENTENCE = {"1": "Un cheval fou dans mon jardin", "2": "Deux ânes aigris au pelage brun",
                        "3": "Trois cygnes aveugles au bord du lac", "4": "Quatre vieilles truies éléphantesques",
                        "5": "Cinq pumas fiers et passionnés", "6": "Six ours aimants domestiqués"}

@rule
def cafe_french(m, root):
    actor, emotion, *level, sentence = stem(m).split("-")
    t, emotion = CAFE_FRENCH_SENTENCE[sentence], CAFE_FRENCH_EMOTION[emotion]
    return {"speaker": actor, "gender": "male" if int(actor) % 2 else "female", "emotion": emotion,
            "intensity": {"": "none", "1": "low", "2": "high"}["".join(level)], "transcript": t,
            "text": f"{speech('French', t)}, emotion: {emotion}"}

@rule
def conet_project(m, root):
    disc, track, title = re.fullmatch(r"tcp_d(\d)_(\d+)_(.+?)_irdial_?", stem(m)).groups()
    return {"disc": int(disc), "track": int(track), "station": words(title), "text": f"Shortwave numbers station recording: {words(title)}"}

@cache
def deeply_korean_meta(root):
    return json.loads((root / "Korean_Read_Speech_Corpus.json").read_text(encoding="utf-8"))

@rule
def deeply_korean(m, root):
    r = deeply_korean_meta(root)[folder(m)][stem(m)]
    return {"speaker": r["subjectID"] + r["speaker"], "text_sentiment": r["text_sentiment"], "voice_sentiment": r["voice_sentiment"],
            "transcript": r["text"], "text": speech("Korean", r["text"])}

EUROSPEECH_LANG = {"bs": "Bosnian", "bg": "Bulgarian", "hr": "Croatian", "da": "Danish", "et": "Estonian", "fi": "Finnish",
                   "fr": "French", "de": "German", "el": "Greek", "is": "Icelandic", "it": "Italian", "lv": "Latvian",
                   "lt": "Lithuanian", "mt": "Maltese", "no": "Norwegian", "pt": "Portuguese", "sr": "Serbian", "sk": "Slovak",
                   "sl": "Slovenian", "sv": "Swedish", "en": "English", "uk": "Ukrainian"}

@rule
def eurospeech_22_languages_61k_hrs_32k_hrs_high_quality(m, root):
    return {"text": speech(EUROSPEECH_LANG[m["language"]], m["human_transcript"])}

HEARTBEAT_SOUNDS_KAGGLE_LABEL = {"normal": "normal heartbeat", "murmur": "heart murmur", "extrastole": "extrasystole",
                                 "extrahls": "extra heart sound", "artifact": "noise artifact"}

@rule
def heartbeat_sounds_kaggle(m, root):
    label = stem(m).split("_")[0]
    if label in ("Aunlabelledtest", "Bunlabelledtest"):
        return {"set": folder(m), "text": ""}
    return {"set": folder(m), "label": label, "text": f"Stethoscope heart sound recording: {HEARTBEAT_SOUNDS_KAGGLE_LABEL[label]}"}

@rule
def malayalam_smc(m, root):
    r = table(root / "msc-reviewed-speech-v1.0+20200825/metadata.tsv", "speechpath", "\t")["audio/" + Path(m["path"]).name]
    return {"speaker_id": r["speaker_id"], "category": r["category"], "transcript": r["transcript"], "text": speech("Malayalam", r["transcript"])}

MULTILINGUAL_TEDX_LANG = {"ar": "Arabic", "de": "German", "el": "Greek", "es": "Spanish", "fr": "French", "it": "Italian",
                          "pt": "Portuguese", "ru": "Russian"}

@cache
def multilingual_tedx_talks(split_dir):
    segments = (split_dir / "txt/segments").read_text(encoding="utf-8").splitlines()
    lines = (split_dir / f"txt/{split_dir.name}.{split_dir.parent.parent.name[:2]}").read_text(encoding="utf-8").splitlines()
    assert len(segments) == len(lines), split_dir
    talks = {}
    for s, t in zip(segments, lines):
        talks.setdefault(s.split()[1], []).append(t.strip())
    return {k: " ".join(v) for k, v in talks.items()}

@rule
def multilingual_tedx(m, root):
    p = root / m["path"]
    lang = MULTILINGUAL_TEDX_LANG[Path(m["path"]).parts[0][:2]]
    t = multilingual_tedx_talks(p.parent.parent)[p.stem]
    return {"talk_id": p.stem, "split": p.parent.parent.name, "language": lang, "transcript": t, "text": speech(lang, t)}

@rule
def seniortalk_chinese_elderly_speech_55_5hrs_202_speakers_75(m, root):
    return {"transcript": m["text"], "text": speech("Chinese", m["text"])}

@rule
def speech_emotion_kaggle(m, root):
    r = table(root / "speech_emotions.csv", "set_id")[folder(m)]
    return {"set_id": folder(m), "emotion": stem(m), "gender": r["gender"].lower(), "transcript": r["text"],
            "text": f"{speech('English', r['text'])}, emotion: {stem(m)}"}

@rule
def tedlium3(m, root):
    if m["text"] == "ignore_time_segment_in_scoring":
        return {"text": ""}
    return {"transcript": m["text"], "text": speech("English", m["text"])}

@cache
def tibetan_tibmd_transcripts(task_dir):
    return {k: v for p in sorted(task_dir.glob("*.txt")) for k, v in pairs(p).items()}

@rule
def tibetan_tibmd(m, root):
    p = Path(m["path"])
    t = tibetan_tibmd_transcripts(root / p.parent.parent)[p.stem]
    return {"dialect": p.parts[1], "speaker": p.parts[-4], "task": p.parts[-3], "transcript": t, "text": speech("Tibetan", t)}

@cache
def voa_ukrainian_index(root):
    with open(root / "voa_dataset.jsonl", encoding="utf-8") as f:
        index = {Path(r["file"]).stem: r["text"] for r in map(json.loads, f)}
    assert len(index) == 326860, len(index)
    return index

@rule
def voa_ukrainian(m, root):
    index = voa_ukrainian_index(root)
    t = index[stem(m)] if stem(m) in index else ""  # 3,265 of the 133,284 Zenodo chunks have no row in voa_dataset.jsonl
    return {"transcript": t, "text": speech("Ukrainian", t)}

@rule
def manatee_vocalizations(m, root):
    top, = {"manatee vocalizations", "no manatee vocalizations"} & set(Path(m["path"]).parts)
    if top == "manatee vocalizations":
        return {"label": "true vocalization", "text": "Underwater hydrophone recording of a West Indian manatee (Trichechus manatus) vocalization; short tonal chirps and squeaks."}
    return {"label": "false vocalization", "text": "Underwater hydrophone recording from a manatee habitat; ambient water noise, no manatee vocalization."}

# AdoVoc Pro file-name codes: vocal resource prefixes, singer tokens, subset folder suffixes
ADOVOC_RES = {"MS": "upper mordent (mordente superior)", "MI": "lower mordent (mordente inferior)", "VM": "marked vibrato (vibrato marcado)",
              "AS": "breathy attack (ataque soplado)", "JP": "jipio (flamenco cry)", "BB": "other attack (counter-example labelled 'BB')"}
ADOVOC_SINGER = {"A": ("Alba", "female"), "C": ("Cris", "female"), "J": ("Joaquin", "male"), "alba": ("Alba", "female"),
                 "cris": ("Cris", "female"), "joaquin": ("Joaquin", "male")}
ADOVOC_SUBSET = {"mono": "monophonic exercise recording (scale, demonstration or isolated example)",
                 "true": "short isolated example containing one instance", "performance": "real performance with guitar accompaniment"}

@rule
def adovoc_pro(m, root):
    parts = Path(m["path"]).parts[1:]
    if parts[0] == "fandango_performance":
        return {"subset": "fandango_performance", "text": "A live flamenco cante in the Fandango de Huelva style, voice with guitar (leakage between the vocal and guitar microphones)."}
    toks = stem(m).split("_")
    sub = "true" if parts[1].endswith("_true") and len(parts) > 3 else parts[1].split("_", 1)[-1]
    res = toks[0] if toks[0] in ADOVOC_RES else parts[1].split("_")[0]
    si = next((i for i, t in enumerate(toks) if i and (t in ADOVOC_SINGER or t.startswith("alba"))), None)
    singer, gender = ADOVOC_SINGER["alba" if toks[si].startswith("alba") else toks[si]] if si else (None, None)
    vowel = next((t.lower() for t in toks[(si or 0) + 1:] if len(t) == 1 and t.lower() in "aeiou"), None)
    who = f" sung by {singer} ({gender} flamenco singer)" if singer else ""
    on = f" on the vowel '{vowel}'" if vowel else ""
    return {"subset": sub, "vocal_resource": res, "singer": singer, "gender": gender, "vowel": vowel,
            "text": f"Flamenco singing: a {ADOVOC_SUBSET[sub]}, vocal resource {ADOVOC_RES[res]}{who}{on}."}

@rule
def bengalese_finches_2013(m, root):
    bird = folder(m)
    species = {"BF": "Bengalese finch (Lonchura striata domestica)", "WM": "white-rumped munia (Lonchura striata), the wild ancestor of the Bengalese finch"}[bird[:2]]
    return {"bird_id": bird, "species": species, "text": f"Song of a {species}, recorded from a single bird ({bird})."}

@cache
def _cmu_mosei(root):
    with open(root / "label.csv", newline="", encoding="utf-8") as f:
        return {(r["video_id"], r["clip_id"]): r for r in csv.DictReader(f)}

@rule
def cmu_mosei(m, root):
    r = _cmu_mosei(root)[(folder(m), stem(m))]
    return {"video_id": r["video_id"], "source_clip_id": int(r["clip_id"]), "split": r["mode"], "sentiment": float(r["label"]),
            "annotation": r["annotation"], "transcript": r["text"], "text": speech("English", r["text"])}

# zip folder prefix (Stowell et al. 2018) -> species
CHIFFCHAFF_SPECIES = {"chiffchaff": "Common chiffchaff (Phylloscopus collybita)", "pipit": "Tree pipit (Anthus trivialis)", "littleowl": "Little owl (Athene noctua)"}

@rule
def chiffchaff(m, root):
    species, kind = folder(m).split("-")
    bird = stem(m).split("_")[-2].upper()
    call = f"{CHIFFCHAFF_SPECIES[species]} vocalisation from individual {bird}"
    text = {"fg": f"A {call}, recorded in the wild.", "bg": f"Ambient outdoor background sound recorded shortly before or after a {call}."}[kind]
    return {"species": CHIFFCHAFF_SPECIES[species], "recording_type": kind, "individual_id": bird, "text": text}

DCASE2013_EVENTS = {"alert": "an alert/alarm sound", "clearthroat": "someone clearing their throat", "cough": "someone coughing",
                    "doorslam": "a door slamming", "drawer": "a drawer opening or closing", "keyboard": "keyboard typing", "keys": "keys jangling",
                    "knock": "a knock on a door", "laughter": "laughter", "mouse": "mouse clicking", "pageturn": "page turning",
                    "pendrop": "a pen dropping", "phone": "a phone ringing", "printer": "a printer printing", "speech": "speech", "switch": "a switch clicking"}

@rule
def dcase2013_isolatedevents(m, root):
    event = re.match(r"[a-z]+", stem(m)).group()
    return {"event": event, "text": f"Sound of {DCASE2013_EVENTS[event]}"}

@rule
def emosynth(m, root):
    r = table(root / "emoSynth-DB/all_data/audio_labels.csv", "audio_file")[Path(m["path"]).name]
    return {"valence": float(r["valence"]), "arousal": float(r["arousal"]),
            "text": f"Synthesized emotional audio: {words(stem(m))}, rated valence {r['round_val']} and arousal {r['round_ar']} on a 1-5 scale"}

# IDMT-SMT-Audio-Effects top folders (German) -> what is played
IDMT_SMT_INSTRUMENT = {"Bass monophon": "single bass guitar notes", "Gitarre monophon": "single electric guitar notes", "Gitarre polyphon": "electric guitar chords"}

@rule
def idmt_smt_audioeffects(m, root):
    inst, samples, fx = Path(m["path"]).parts[-4:-1]
    assert samples == "Samples", m["path"]
    effect = "no effect" if fx == "NoFX" else re.sub(r"(?<=[a-z])(?=[A-Z])", " ", fx).lower() + " effect"
    what = IDMT_SMT_INSTRUMENT[words(inst).rstrip("2")]
    return {"instrument": what, "effect": fx, "text": f"Recording of {what} with {effect}"}

IMPROVISINGDUOS_STYLE = {"F": "A free jazz improvisation", "S": "An improvisation on the jazz standard Autumn Leaves"}
IMPROVISINGDUOS_INSTR = {"ElecPiano": "electric piano", "DoubleBass": "double bass", "ElecGuitar": "electric guitar", "ElecBass": "electric bass",
               "TenorSax": "tenor saxophone", "SopSax": "soprano saxophone", "AltoSax": "alto saxophone", "Cello": "cello",
               "Clarinet": "clarinet", "Flute": "flute", "Drums": "drums", "Trumpet": "trumpet", "Violin": "violin"}

@rule
def improvisingduos(m, root):
    style, a, b, track = re.fullmatch(r"([FS])[-_]([A-Za-z]+)_([A-Za-z]+)-Track(\d+)", stem(m)).groups()
    return {"style": {"F": "free", "S": "standard (Autumn Leaves)"}[style], "instruments": [IMPROVISINGDUOS_INSTR[a], IMPROVISINGDUOS_INSTR[b]], "track": int(track),
            "text": f"{IMPROVISINGDUOS_STYLE[style]} by a duo of {IMPROVISINGDUOS_INSTR[a]} and {IMPROVISINGDUOS_INSTR[b]} (session track {int(track)}, one of the session's separate microphone tracks)."}

KNOCKING_EMOTION = {"anger": "angry", "fear": "fearful", "happiness": "happy", "neutral": "neutral", "sadness": "sad"}

@rule
def knocking_emotional(m, root):
    emotion = KNOCKING_EMOTION[folder(m)]
    return {"emotion": emotion, "text": f"Knocking sound effect with {emotion} emotional intention."}

@cache
def _mdbdrums_instruments(yaml):
    return dict(re.findall(r"filename: (\S+)\n\s+instrument: (.+)", yaml.read_text(encoding="utf-8")))

@rule
def mdbdrums(m, root):
    if folder(m) == "full_mix":
        track, what = stem(m).removesuffix("_MIX"), "The full mix"
    else:
        track = folder(m, 2)
        inst = _mdbdrums_instruments(root / Path(m["path"]).parents[1] / f"{track}_METADATA.yaml")[Path(m["path"]).name]
        what = f"A multitrack stem ({inst})" if folder(m).endswith("_STEMS") else f"A raw multitrack recording ({inst})"
    genre = track.removeprefix("MusicDelta_")
    return {"track": track, "genre": genre, "text": f"{what} of the {genre} track {track} from MedleyDB (MDB Drums drum transcription dataset)."}

# class id in the Nonspeech7k file name -> (label, verb)
NONSPEECH7K = [("breath", "breathing"), ("cough", "coughing"), ("crying", "crying"), ("laugh", "laughing"), ("screaming", "screaming"),
               ("sneeze", "sneezing"), ("yawn", "yawning")]

@rule
def nonspeech7k(m, root):
    label, verb = NONSPEECH7K[int(stem(m).rsplit("_", 2)[1])]
    return {"label": label, "text": f"A person {verb}"}

# SUBESCO file-name emotion codes
SUBESCO_EMOTION = {"ANGRY": "anger", "DISGUST": "disgust", "FEAR": "fear", "HAPPY": "happiness", "NEUTRAL": "neutral", "SAD": "sadness", "SURPRISE": "surprise"}

@rule
def subesco(m, root):
    sex, num, name, _, sentence, emo, take = stem(m).split("_")
    return {"speaker": f"{sex}_{num}_{name}", "gender": {"F": "female", "M": "male"}[sex], "sentence": int(sentence), "take": int(take),
            "emotion": SUBESCO_EMOTION[emo], "text": f"Bangla emotional speech expressing {SUBESCO_EMOTION[emo]}."}

TAU_2019_SCENES = {"airport": "an airport", "bus": "a bus", "metro": "a metro/subway", "metro_station": "a metro station", "park": "a park",
                   "public_square": "a public square", "shopping_mall": "an indoor shopping mall", "street_pedestrian": "a pedestrian street",
                   "street_traffic": "a street with traffic", "tram": "a tram", "beach": "a beach", "library": "a library", "office": "an office",
                   "public_event": "a public event"}

@rule
def tau_urban_acoustic_scenes_2019_openset_dev(m, root):
    d, name = root / "TAU-urban-acoustic-scenes-2019-openset-development", f"audio/{Path(m['path']).name}"
    scene = table(d / "meta.csv", "filename", "\t")[name]["scene_label"]
    known = scene != "unknown"
    if not known:
        scene = table(d / "meta_unknown.csv", "filename", "\t")[name]["scene_label_original"]
    return {"scene": scene, "known_scene": known, "text": f"Ambient sounds recorded in {TAU_2019_SCENES[scene]}"}

@rule
def thorsten_emotional(m, root):
    style = m["style"].split(" | ")[0]
    return {"emotion": style, "transcript": m["text"], "text": f'{speech("German", m["text"])} ({style})'}

@rule
def urdu_emotional(m, root):
    emotion = folder(m).lower()
    return {"emotion": emotion, "text": f"Urdu emotional speech expressing {emotion}."}

@rule
def voxceleb1(m, root):
    r = table(root / "vox1_meta.csv", "VoxCeleb1 ID", "\t")[folder(m, 2)]
    sex, name = {"m": "male", "f": "female"}[r["Gender"]], words(r["VGGFace1 ID"])
    return {"speaker_id": folder(m, 2), "name": name, "gender": sex, "nationality": r["Nationality"], "video_id": folder(m),
            "text": f"A recording of {name}, a {sex} from {r['Nationality']}"}

@cache
def _african_french(root):
    rows = [re.match(r"(\S+)\s*(.*)", l).groups() for f in (root / "African_Accented_French/transcripts").rglob("*")
            if f.is_file() and not f.name.startswith(".") for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
    index = {re.sub(r"\.(tdf|wav)$", "", k.rsplit("/", 1)[-1]): t.strip() for k, t in rows if "answers" not in k}  # Yaounde answers: rows hold the question asked
    assert len(index) == 11362, len(index)
    return index

@rule
def african_french(m, root):
    t = _african_french(root)
    s = t[stem(m)] if stem(m) in t else ""  # 3,214 CA16 recordings have no row, nor have the 2,098 Yaounde answers
    return {"split": Path(m["path"]).parts[2], "transcript": s, "text": speech("French", s)}

@cache
def _armenian(root):
    with open(root / "armenian_speech_crowdsourcing_data/pitched.jsonl", encoding="utf-8") as f:
        return {Path(r["audio_filepath"]).name: r["text"] for r in map(json.loads, f)}

@rule
def armenian_speech_crowdsourcing(m, root):
    t = _armenian(root)[Path(m["path"]).name]
    return {"transcript": t, "text": speech("Armenian", t)}

@rule
def bird_species_audio(m, root):
    r = table(root / "bird_songs_metadata.csv", "id")[stem(m).split("-")[0]]
    return {"species": f"{r['genus']} {r['species']}", "name": r["name"], "sound_type": r["sound_type"], "recordist": r["recordist"],
            "country": r["country"], "location": r["location"], "license": r["license"],
            "text": f"{r['name']} ({r['genus']} {r['species']}) {r['sound_type']}, recorded in {r['location']}, {r['country']}"}

# CatMeows file-name codes and archive folders
CATMEOWS_CONTEXT = {"B": "being brushed", "F": "waiting for food", "I": "isolated in an unfamiliar environment"}
CATMEOWS_BREED = {"MC": "Maine Coon", "EU": "European Shorthair"}
CATMEOWS_SEX = {"FI": "an intact female", "FN": "a neutered female", "MI": "an intact male", "MN": "a neutered male"}
CATMEOWS_KIND = {"dataset": "A meow", "sequences": "A sequence of meows", "other_vocalizations": "A non-meow vocalization"}

@rule
def catmeows(m, root):
    ctx, cat, breed, sex, owner, _ = stem(m).split("_")
    return {"context": CATMEOWS_CONTEXT[ctx], "cat_id": cat, "breed": CATMEOWS_BREED[breed], "sex": sex, "owner_id": owner,
            "text": f"{CATMEOWS_KIND[folder(m)]} of {CATMEOWS_SEX[sex]} {CATMEOWS_BREED[breed]} cat {CATMEOWS_CONTEXT[ctx]}"}

# Parent_Child_Vocal_Interaction.json codes (README "How to decode"): speaker a = parent, b = child
DEEPLY_ROLE = {"a": "parent", "b": "child"}
DEEPLY_ACT = {"a": ["singing", "reading aloud", "speaking"], "b": ["singing", "reading aloud", "crying", "refusing", "speaking"]}
DEEPLY_PLACE = ["a studio apartment", "a dance studio", "an anechoic chamber"]

@cache
def _deeply(root):
    return json.loads((root / "Parent_Child_Vocal_Interaction.json").read_text(encoding="utf-8"))

@rule
def deeply_parent_child_vocal_interaction(m, root):
    r = _deeply(root)[folder(m)][stem(m)]
    spk, lab = r["speaker"], str(r["label"]).zfill(len(r["speaker"]))
    assert len(lab) == len(spk), r
    who = " and a ".join(f"{DEEPLY_ROLE[s]} {DEEPLY_ACT[s][int(l)]}" for s, l in zip(spk, lab))
    return {"subject_id": r["subjectID"], "speaker": spk, "label": lab, "noise": r["noise"], "distance": r["distance"], "device": r["device"],
            "text": f"A {who} in Korean, recorded in {DEEPLY_PLACE[r['location']]}."}

@cache
def _golos(root):
    out = {}
    for p in root.rglob("manifest.jsonl"):
        with open(p, encoding="utf-8") as f:
            out |= {r["id"]: r["text"] for r in map(json.loads, f)}
    return out

@rule
def golos(m, root):
    t = _golos(root)[stem(m)]
    return {"domain": "farfield" if "farfield" in Path(m["path"]).parts else "crowd", "transcript": t, "text": speech("Russian", t)}

@rule
def kaggle_emergency_vehicle_siren(m, root):
    label = folder(m)
    return {"label": label, "text": {"ambulance": "An ambulance siren", "firetruck": "A fire truck siren", "traffic": "Road traffic noise without an emergency siren"}[label]}

# lung sound type codes in the KAUH file names
LUNG_SOUND = {"N": "normal", "Crep": "crepitations", "C": "crackles", "E": "expiratory", "I": "inspiratory", "W": "wheezes", "B": "bronchial", "Bronchial": "bronchial"}

@rule
def lung_sound(m, root):
    fid, rest = stem(m).split("_", 1)
    diag, sound, loc, age, sex = [x.strip() for x in rest.split(",")]
    sounds, diag = ", ".join(LUNG_SOUND[s] for s in sound.split()), "normal" if diag == "N" else diag
    return {"file_id": fid, "diagnosis": diag, "sound_type": sounds, "location": loc, "age": int(age), "gender": {"M": "male", "F": "female"}[sex],
            "text": f"Lung sounds recorded with an electronic stethoscope on the chest ({sounds}; diagnosis: {diag})"}

# letter codes of the 13 feeling categories of Cowen et al. 2020 (www.ocf.berkeley.edu/~acowen/music.html)
MUSIC_BERKELEY_FEELING = {"A": "amusing", "B": "annoying", "C": "anxious", "D": "beautiful", "E": "calm", "F": "dreamy", "G": "energizing",
                  "H": "erotic", "I": "indignant", "J": "joyful", "K": "sad", "L": "scary", "M": "triumphant"}

@rule
def music_berkeley_emotions(m, root):
    feeling = MUSIC_BERKELEY_FEELING[m["label"]]
    return {"feeling": feeling, "text": f"A short music excerpt that listeners rated as {feeling}."}

@cache
def _samromur(root):
    tsv, = root.rglob("metadata.tsv")
    with open(tsv, newline="", encoding="utf-8") as f:
        return {r["filename"]: r for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}

@rule
def openslr_128_samromur_unverified_icelandic(m, root):
    md = _samromur(root)
    if Path(m["path"]).name not in md:
        return {"has_metadata": False, "text": speech("Icelandic", "")}
    r = md[Path(m["path"]).name]
    return {"has_metadata": True, "speaker_id": r["speaker_id"], "gender": r["gender"], "age": r["age"], "is_valid": r["is_valid"],
            "transcript": r["sentence"], "text": speech("Icelandic", r["sentence"])}

# SMIIP-TV utt2info.zh values -> English
SMIIP_ENV = {"室内(宿舍,卧室)": "indoors in a dormitory or bedroom", "室内(办公室,会议室,教室,客厅)": "indoors in an office, meeting room, classroom or living room",
             "街道": "on a street", "室内(厨房)": "in a kitchen", "楼道走廊": "in a stairwell or corridor", "室内(空旷有回声)": "in an empty, echoing room",
             "室内(实验室)": "in a laboratory", "公园/广场/操场": "in a park, square or sports ground", "学校/单位餐厅": "in a school or workplace canteen",
             "车内(轿车)": "inside a car", "饭店": "in a restaurant", "工地/田地": "at a construction site or in a field",
             "超市/商店": "in a supermarket or shop", "车内(公交车)": "inside a bus", "大型商场": "in a shopping mall", "机场/火车站": "at an airport or train station"}
SMIIP_STATE = {"正常": "normal", "睡觉": "sleepy", "吃饭": "eating", "嗓子干哑": "hoarse throat", "运动": "after exercise", "感冒/发烧": "cold or fever", "其他": "other"}
SMIIP_NOISE = {"正常": "normal", "安静": "quiet", "较大": "noisy", "极大": "extremely noisy"}

@cache
def _smiip(root, name):
    with open(root / "release_v1/meta_info" / name, encoding="utf-8") as f:
        return {r[0]: r for r in (l.rstrip("\n").split(", ") for l in list(f)[1:])}

@rule
def openslr_156_smiip_tv(m, root):
    s, _, _, _, kind, prompt = re.fullmatch(r"(\d{4})_(\d{8})_(\d)_(\d)_(t[di])_(\d+)", stem(m)).groups()
    _, gender, region, age = _smiip(root, "spk2info")["spk" + s]
    _, env, state, noise = _smiip(root, "utt2info.zh")[stem(m)]
    what = "a fixed text-dependent phrase" if kind == "td" else "a free (text-independent) sentence"
    feel = "" if SMIIP_STATE[state] == "normal" else f" The speaker reported being {SMIIP_STATE[state]}."
    return {"speaker_id": "spk" + s, "gender": gender, "age": int(age), "region": region, "content": kind, "environment": SMIIP_ENV[env],
            "physical_state": SMIIP_STATE[state], "noise_level": SMIIP_NOISE[noise],
            "text": f"A {age}-year-old {gender} speaker from {region}, China, says {what} in Mandarin Chinese into a smartphone {SMIIP_ENV[env]}; {SMIIP_NOISE[noise]} background noise.{feel}"}

@cache
def _parlament(root):
    rows = [(re.fullmatch(r"parlament_v1\.0_(\w+)\.transcription", f.name).group(1), re.fullmatch(r"<s> (.*) </s> \((\S+)\)", l.strip()).groups())
            for f in root.glob("parlament_v1.0_*.transcription") for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
    return {i: (subset, t) for subset, (t, i) in rows}

@rule
def parlamentparla(m, root):
    subset, t = _parlament(root)[stem(m)]
    return {"subset": subset, "session_id": stem(m).split("_")[0], "transcript": t, "text": speech("Catalan", t)}

# source_database prefix of the real RIR room ids
RIRS_NOISES_DB = {"RVB2014": "the REVERB 2014 challenge", "RWCP": "the RWCP sound scene database", "air": "the Aachen impulse response (AIR) database"}

@cache
def _rirs_noises(root):
    def rows(rel):
        for l in (root / "RIRS_NOISES" / rel).read_text().splitlines():
            t = l.split()
            yield {t[i][2:]: t[i + 1] for i in range(0, len(t) - 1, 2)}, t[-1]
    meta = {}
    for size in ("small", "medium", "large"):
        d = f"simulated_rirs/{size}room"
        rooms = {r[0]: [float(x) for x in r[1:]] for r in (l.split() for l in (root / "RIRS_NOISES" / d / "room_info").read_text().splitlines())}
        for o, p in rows(f"{d}/rir_list"):
            length, width, height, *_, absorb = rooms[o["room-id"]]
            meta[p] = {"category": "simulated_rir", "room_size_class": size, "rir_id": o["rir-id"], "room_id": o["room-id"],
                       "text": f"A simulated room impulse response of a {size} room ({length:.1f} m x {width:.1f} m x {height:.1f} m, wall absorption {absorb:.2f}), generated with the image method."}
    for o, p in rows("real_rirs_isotropic_noises/rir_list"):
        meta[p] = {"category": "real_rir", "rir_id": o["rir-id"], "room_id": o["room-id"],
                   "text": f"A measured room impulse response from {RIRS_NOISES_DB[o['room-id'].split('_')[0]]} (room/setup {o['room-id']})."}
    for o, p in rows("real_rirs_isotropic_noises/noise_list"):
        meta[p] = {"category": "isotropic_noise", "noise_id": o["noise-id"], "room_linkage": o["room-linkage"],
                   "text": f"Isotropic background noise recorded in the room {o['room-linkage']} of {RIRS_NOISES_DB[o['room-linkage'].split('_')[0]]}."}
    for o, p in rows("pointsource_noises/noise_list"):
        meta[p] = {"category": "pointsource_noise", "noise_id": o["noise-id"], "bg_fg_type": o["bg-fg-type"],
                   "text": f"A {o['bg-fg-type']} noise recording from Freesound (MUSAN corpus), used as a point-source noise."}
    return meta

@rule
def rirs_noises(m, root):
    return _rirs_noises(root)[m["path"]]

@rule
def seoul_corpus(m, root):
    spk, g, age, ig, n = re.fullmatch(r"(s\d\d)([mf])(\d\d)([mf])(\d)", stem(m)).groups()
    sex = {"m": "male", "f": "female"}
    return {"speaker_id": spk, "speaker_gender": sex[g], "speaker_age": int(age), "interviewer_gender": sex[ig], "file_number": int(n),
            "text": f"Spontaneous Korean conversational speech from a sociolinguistic interview in the Seoul Corpus: a {age}-year-old {sex[g]} speaker talking with a {sex[ig]} interviewer."}

@rule
def spoken_language_id(m, root):
    lang, sex, rest = Path(m["path"]).name.split("_", 2)
    speaker, fragment, _ = rest.split(".")
    language, gender = {"en": "English", "de": "German", "es": "Spanish"}[lang], {"f": "female", "m": "male"}[sex]
    return {"language": language, "gender": gender, "speaker_id": speaker, "fragment": fragment, "text": f"Speech in {language} by a {gender} speaker"}

@cache
def _tedx(root):
    with open(root / "tedx_spanish_corpus/files/TEDx_Spanish.transcription", encoding="utf-8") as f:
        return {i: t for t, i in (l.rstrip("\n").rsplit(" ", 1) for l in f if l.strip())}

@rule
def tedx_spanish(m, root):
    t = _tedx(root)[stem(m)]
    return {"speaker_id": stem(m)[5:10], "gender": {"F": "female", "M": "male"}[stem(m)[5]], "transcript": t, "text": speech("Spanish", t)}

@rule
def timers_and_such(m, root):
    r = table(root / f"{folder(m)}.csv", "path")[m["path"]]
    return {"split": folder(m), "speaker_id": r["speakerId"], "intent": re.search(r"'intent': '(\w+)'", r["semantics"]).group(1),
            "semantics": r["semantics"], "transcript": r["transcription"], "text": speech("English", r["transcription"])}

@rule
def voc_als(m, root):
    subject, task = stem(m).split("_")
    group = {"PZ": "a person with amyotrophic lateral sclerosis (ALS)", "CT": "a healthy control speaker"}[subject[:2]]
    what = f"Sustained phonation of the vowel /{task[-1].lower()}/" if task.startswith("phonation") else f"Rapid repetition of the syllable /{task[-2:].lower()}/"
    return {"subject_id": subject, "group": "ALS" if subject.startswith("PZ") else "control", "task": task, "text": f"{what} by {group}"}

def _b3_oxford(names):
    return names[0] if len(names) == 1 else " and ".join(names) if len(names) == 2 else f"{', '.join(names[:-1])}, and {names[-1]}"

@rule
def openaoe_egocentric(m, root):
    p = root / Path(m["path"]).parent / "ego_annotation/ego_action_annotation.json"
    if not p.exists():  # samples without an action annotation
        return {"text": ""}
    ann = json.loads(p.read_text(encoding="utf-8"))
    scenes = [s["scene"] for s in ann]
    scene = max(scenes, key=scenes.count)
    acts = list(dict.fromkeys(a["description"].strip().rstrip(".") for s in ann for a in s["atomic_action"]))
    return {"scene": scene, "actions": acts, "text": f"First-person egocentric recording ({scene}). " + " ".join(f"{a}." for a in acts)}

@cache
def _anuraset(root):
    names = {r["CODE"]: r["SPECIES"] for r in table(root / "species.csv", "CODE").values()}
    return names, {f"{r['fname']}_{r['min_t']}_{r['max_t']}": r for r in table(root / "anuraset/metadata.csv", "sample_name").values()}

@rule
def anuraset(m, root):
    names, rows = _anuraset(root)
    r = rows[stem(m)]
    sp = [names[c] for c in sorted(names) if r[c] == "1"]
    text = (f"A sound of a {sp[0]} frog calling" if len(sp) == 1 else
            f"Sounds of {', '.join(sp[:-1])} and {sp[-1]} frogs calling" if sp else "A sound from a frog recording")
    return {"site": r["site"], "subset": r["subset"], "species": sp, "text": text}

# CMU-MOSI sentiment score (-3..3) rounded to the 7 classes of the MOSI paper
CMU_MOSI_SENTIMENT = {-3: "strongly negative", -2: "negative", -1: "weakly negative", 0: "neutral", 1: "weakly positive", 2: "positive", 3: "strongly positive"}

@cache
def _cmu_mosi(root):
    with open(root / "label.csv", newline="", encoding="utf-8") as f:
        return {f"{r['video_id']}/{r['clip_id']}": r for r in csv.DictReader(f)}

@rule
def cmu_mosi(m, root):
    r = _cmu_mosi(root)[f"{folder(m)}/{stem(m)}"]
    s = CMU_MOSI_SENTIMENT[round(float(r["label"]))]
    return {"video_id": r["video_id"], "source_clip_id": r["clip_id"], "split": r["mode"], "sentiment_score": float(r["label"]), "sentiment": s,
            "transcript": r["text"], "text": f"{speech('English', r['text'])} (sentiment: {s})"}

# Dagstuhl ChoirSet file name codes: DCS_<piece>_<ensemble>_<take>_<singer>_<microphone>
CHOIRSET_PIECE = {"LI": "Locus Iste by Anton Bruckner", "SE": "a singing exercise"}
CHOIRSET_GROUP = {"Basses": "bass section", "FullChoir": "full choir", "QuartetA": "quartet A", "QuartetB": "quartet B"}
CHOIRSET_VOICE = {"S": "soprano", "A": "alto", "T": "tenor", "B": "bass"}
CHOIRSET_MIC = {"DYN": "dynamic", "HSM": "headset", "LRX": "larynx", "STM": "stereo main", "STL": "stereo left", "STR": "stereo right"}

@rule
def choirset(m, root):
    _, piece, group, take, singer, mic = stem(m).split("_")
    who = "The whole ensemble" if singer.startswith("Stereo") else f"The {CHOIRSET_VOICE[singer[0]]} singer {singer}"
    return {"piece": piece, "ensemble": group, "take": take, "singer": singer, "microphone": mic,
            "text": f"{who} of the {CHOIRSET_GROUP[group]} sings {CHOIRSET_PIECE[piece]} a cappella, recorded with a {CHOIRSET_MIC[mic]} microphone."}

DCASE2013_SCENES_PLACE = {"bus": "inside a bus", "busystreet": "on a busy street", "office": "in an office", "openairmarket": "in an open air market",
                          "park": "in a park", "quietstreet": "on a quiet street", "restaurant": "in a restaurant", "supermarket": "in a supermarket",
                          "tube": "inside a tube train", "tubestation": "in a tube station"}

@rule
def dcase2013_scenes(m, root):
    scene = re.match(r"[a-z]+", stem(m))[0]
    return {"scene": scene, "text": f"Ambient sounds recorded {DCASE2013_SCENES_PLACE[scene]}"}

# EDANSA label columns that occur in labels.csv; a parent tag is dropped when one of its children is present
EDANSA_2019_NAME = {"Anth": "anthropophony", "Bio": "biophony", "Geo": "geophony", "Sil": "silence", "Auto": "ground vehicle", "Airc": "aircraft",
                    "Mach": "machinery", "Flare": "gas flare", "Bird": "bird", "Mam": "mammal", "Bug": "insect", "Wind": "wind", "Rain": "rain",
                    "Water": "water", "Truck": "truck", "Car": "car", "Helo": "helicopter", "Jet": "jet aircraft", "Corv": "corvid", "SongB": "songbird",
                    "DGS": "duck, goose, or swan", "Grous": "grouse or ptarmigan", "Loon": "loon", "SeaB": "seabird", "Rapt": "raptor",
                    "ShorB": "shorebird", "Woof": "canid", "Fly": "fly"}
EDANSA_2019_PARENT = {"Auto": "Anth", "Airc": "Anth", "Mach": "Anth", "Flare": "Anth", "Truck": "Auto", "Car": "Auto", "Helo": "Airc", "Jet": "Airc",
                      "Bird": "Bio", "Mam": "Bio", "Bug": "Bio", "Corv": "Bird", "SongB": "Bird", "DGS": "Bird", "Grous": "Bird", "Loon": "Bird",
                      "SeaB": "Bird", "Rapt": "Bird", "ShorB": "Bird", "Woof": "Mam", "Fly": "Bug", "Wind": "Geo", "Rain": "Geo", "Water": "Geo"}

@rule
def edansa_2019(m, root):
    r = table(root / "EDANSA-2019/labels.csv", "Clip Path")[Path(m["path"]).relative_to("EDANSA-2019/data").as_posix()]
    on = [c for c in list(r)[9:] if r[c] == "1"]
    parents = {EDANSA_2019_PARENT[c] for c in on if c in EDANSA_2019_PARENT}
    leaves = [c for c in on if c not in parents and not (c == "Sil" and len(on) > 1)]
    what = _b3_oxford([EDANSA_2019_NAME[c] for c in leaves] or ["environmental sounds"])
    return {"region": r["region"], "site": r["Site ID"], "split": r["set"], "labels": leaves, "text": f"A sound of {what} recorded in the Arctic Alaska"}

EMOUERJ_EMOTION = {"a": "anger", "h": "happiness", "n": "neutral", "s": "sadness"}

@rule
def emouerj(m, root):
    s = stem(m)
    emotion = EMOUERJ_EMOTION[s[3]]
    return {"speaker": s[:3], "gender": {"m": "male", "w": "female"}[s[0]], "emotion": emotion, "text": f"Portuguese emotional speech expressing {emotion}."}

@rule
def freefield1010(m, root):
    j = json.loads(sidecar(m, root, ".json"))
    tags = [words(t) for t in j["tags"] if t != "field-recording"]
    what = " and ".join([", ".join(tags[:-1]), tags[-1]]) if len(tags) > 1 else "".join(tags)
    return {"freesound_id": j["id"], "licence": j["license"], "tags": tags, "text": f"A field recording of {what}." if tags else "A field recording."}

# IDMT-SMT-Bass plucking (PS) and expression (ES) style codes, from the Zenodo record description
IDMT_SMT_BASS_PLUCK = {"FS": "fingerstyle", "PK": "picked", "MU": "muted", "ST": "slap-thumb", "SP": "slap-pluck"}
IDMT_SMT_BASS_EXPR = {"NO": "normal", "VI": "vibrato", "VIF": "fast vibrato", "VIS": "slow vibrato", "BE": "bending", "BES": "semi-tone bending",
                      "BEQ": "quarter-note bending", "HA": "harmonics", "DN": "dead-note", "SLU": "slide up", "SLD": "slide down"}

@rule
def idmt_smt_bass(m, root):
    bass, eq, ps, es, string, fret = re.fullmatch(r"BS_(\d)_EQ_(\d)_(?:PS_)?([A-Z]{2})_(?:ES_)?([A-Z]{2,3})_(\d)_(\d+)", stem(m)).groups()
    return {"bass": bass, "pickup_setting": eq, "plucking_style": ps, "expression_style": es, "string": string, "fret": fret,
            "text": f"A single electric bass guitar note, {IDMT_SMT_BASS_PLUCK[ps]} plucking style, {IDMT_SMT_BASS_EXPR[es]} expression style (string {string}, fret {fret})."}

@cache
def _insectset32(root):
    names = re.findall(r"^([A-Z][a-z]+ [^\t]+)\t+\d+\t+\d+:\d\d", (root / "README.txt").read_text(encoding="utf-8"), re.M)
    return {n.replace(" ", ""): n for n in names}

@rule
def insectset32(m, root):
    sp = _insectset32(root)[folder(m)]
    return {"species": sp, "order": folder(m, 2), "text": f"Insect sound recording, {sp}"}

# LM-SSD signal types, from the Zenodo record description
LM_SVR_SIGNAL = {"CM": "Singing voice recorded with a close-up microphone", "LM": "Singing voice recorded with a larynx microphone",
                 "GL": "Guitar recorded with the left microphone", "GR": "Guitar recorded with the right microphone", "GP": "Guitar recorded with its pickup",
                 "MixA": "Mix of singing and guitar without effects", "MixB": "Mix of singing and guitar with equalization, compression, reverb and saturation"}
LM_SVR_SEX = {"M": "male", "F": "female"}

@rule
def lm_svr(m, root):
    uid, song, sig, crosstalk, *singers, take = stem(m).split("_")
    who = " and ".join(f"{LM_SVR_SEX[s[1]]} singer {s}" for s in singers)
    return {"song": song, "signal": sig, "crosstalk": crosstalk, "singers": singers, "take": take,
            "lyrics": (root / f"LM-SSD/lyrics/{song}.txt").read_text(encoding="utf-8").strip(), "text": f"{LM_SVR_SIGNAL[sig]}, performed by {who}."}

MELD_SPLIT = {"train_splits": "train", "dev_splits_complete": "dev", "output_repeated_splits_test": "test"}
MELD_TONE = {"anger": "angry", "disgust": "disgusted", "fear": "fearful", "joy": "joyful", "neutral": "neutral", "sadness": "sad", "surprise": "surprised"}

@cache
def _meld(root, split):
    return {f"dia{r['Dialogue_ID']}_utt{r['Utterance_ID']}": r for r in table(root / f"MELD.Raw/{split}_sent_emo.csv", "Sr No.").values()}

@rule
def meld(m, root):
    rows = _meld(root, MELD_SPLIT[folder(m)])
    if stem(m) not in rows:  # 4 dev videos (dia49_utt4/5, dia66_utt9/10) have no annotation row
        return {"text": speech("English", "")}
    r = rows[stem(m)]
    return {"speaker": r["Speaker"], "emotion": r["Emotion"], "sentiment": r["Sentiment"], "season": r["Season"], "episode": r["Episode"],
            "transcript": r["Utterance"], "text": f'{r["Speaker"]} speaks in a {MELD_TONE[r["Emotion"]]} tone ({r["Sentiment"]} sentiment) in a scene from '
                                                  f'the English TV sitcom Friends (season {r["Season"]}, episode {r["Episode"]}), saying: "{r["Utterance"]}"'}

@rule
def magnatagatune(m, root):
    info = table(root / "clip_info_final.csv", "mp3_path", "\t")[m["path"]]
    tags = [t for t, v in table(root / "annotations_final.csv", "mp3_path", "\t")[m["path"]].items() if t not in ("clip_id", "mp3_path") and v == "1"]
    text = f'Music track: "{info["title"]}" by {info["artist"]} from the album {info["album"]}'
    return {"source_clip_id": info["clip_id"], "title": info["title"], "artist": info["artist"], "album": info["album"], "tags": tags,
            "text": f"{text}. Tags: {', '.join(tags)}." if tags else text}

# folder S<n>(...) of the zip; S8 holds noise and unknown-species events
NORTH_AMERICAN_BIRD_SPECIES_LABEL = {"S1": "Blue Jay", "S2": "Song Sparrow", "S3": "Great Blue Heron", "S4": "American Crow", "S5": "Cedar Waxwing",
                                     "S6": "House Finch", "S7": "Indigo Bunting", "S8": "noise or an unknown bird species", "S9": "Marsh Wren",
                                     "S10": "Common Yellowthroat", "S11": "Chipping Sparrow", "S12": "American Yellow Warbler"}

@rule
def north_american_bird_species(m, root):
    label = NORTH_AMERICAN_BIRD_SPECIES_LABEL[folder(m).split("(")[0]]
    return {"label": label, "text": f"Audio recording of {label}"}

@rule
def phonation(m, root):
    p = re.match(r"[A-Ha-h]\d#?(?=[_ ]|$)", stem(m))
    mode = re.search(r"breathy|neutral|flow|pressed", stem(m))
    detail = (f" at pitch {p[0].upper()}" if p else "") + (f" in {mode[0]} phonation" if mode else "")
    return {"pitch": p[0].upper() if p else None, "phonation_mode": mode[0] if mode else None, "text": f"A female singer sustaining sung vowels{detail}."}

@cache
def _slakh2100(path):
    pat = r"^  (S\d+):\n    audio_rendered: true\n(?:    .*\n)*?    inst_class: (.*)\n(?:    .*\n)*?    midi_program_name: (.*)\n"
    return {s: (c, p) for s, c, p in re.findall(pat, path.read_text(encoding="utf-8"), re.M)}

@rule
def slakh2100(m, root):
    p = Path(m["path"])
    track = p.parent if p.stem == "mix" else p.parent.parent
    stems = _slakh2100(root / track / "metadata.yaml")
    base = {"track": track.name, "split": track.parent.name}
    if p.stem == "mix":
        names = sorted({prog for _, prog in stems.values()})
        return {**base, "instruments": names, "text": f"A multi-instrument music mix rendered from MIDI with {', '.join(names)}."}
    cls, prog = stems[p.stem]
    return {**base, "inst_class": cls, "program": prog, "text": f"A {prog} ({cls}) part rendered from MIDI."}

TAU_URBAN_ACOUSTIC_SCENES_2020_3CLASS_PLACE = {"airport": "an airport", "bus": "inside a bus", "metro": "travelling by an underground metro",
                                               "metro_station": "a metro station", "park": "an urban park", "public_square": "a public square",
                                               "shopping_mall": "an indoor shopping mall", "street_pedestrian": "a pedestrian street",
                                               "street_traffic": "a street with medium level of traffic", "tram": "travelling by a tram"}
TAU_URBAN_ACOUSTIC_SCENES_2020_3CLASS_CLASS = {"indoor": "an indoor", "outdoor": "an outdoor", "transportation": "a transportation"}

@rule
def tau_urban_acoustic_scenes_2020_3class(m, root):
    p = Path(m["path"])
    cls = table(root / p.parts[0] / "meta.csv", "filename", "\t")[f"audio/{p.name}"]["scene_label"]
    scene, city = p.stem.split("-")[:2]
    return {"scene": scene, "scene_class": cls, "city": city,
            "text": f"Ambient sounds from {TAU_URBAN_ACOUSTIC_SCENES_2020_3CLASS_PLACE[scene]}, {TAU_URBAN_ACOUSTIC_SCENES_2020_3CLASS_CLASS[cls]} acoustic scene"}

@rule
def thorsten_german(m, root):
    t = pairs(root / "thorsten-de/metadata_train.csv", "|")[stem(m)]
    return {"transcript": t, "text": speech("German", t)}

@cache
def _usm_sed(root, split):
    scenes = {}
    with open(root / f"usm_{split}.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter=";"):
            scenes.setdefault(r["usm_id"], []).append(r)
    return scenes

@rule
def usm_sed(m, root):
    scene, _, *k = stem(m).split("_")
    rows = _usm_sed(root, folder(m))[scene]
    if k:
        r = rows[int(k[1])]
        return {"split": folder(m), "usm_id": scene, "label": r["class_usm"], "fsd50k_file": r["file"], "licence": r["licence"],
                "text": f"A sound recording of {r['class_usm']}"}
    labels = sorted({r["class_usm"] for r in rows})
    return {"split": folder(m), "usm_id": scene, "labels": labels, "text": f"Audio with {_b3_oxford(labels)} present"}

@rule
def covers80(m, root):
    artist, album, _ = stem(m).split("+")
    song = words(folder(m))
    return {"song": song, "artist": words(artist), "album": words(album), "text": f'"{song}" performed by {words(artist)}'}

@rule
def aishell3(m, root):
    p = Path(m["path"])
    toks = pairs(root / p.parts[0] / "content.txt", "\t")[p.name].split()
    age, gender, accent = pairs(root / "spk-info.txt")[folder(m)].split()
    chars = "".join(toks[::2])
    return {"speaker": folder(m), "gender": gender, "age_group": age, "accent": accent, "pinyin": " ".join(toks[1::2]),
            "transcript": chars, "text": speech("Mandarin Chinese", chars)}

@rule
def assamese_tts(m, root):
    t = table(root / "df.csv", "filename")[Path(m["path"]).name]["text"]
    return {"speaker": stem(m).split("_")[1], "transcript": t, "text": speech("Assamese", t)}

@rule
def dave_diagnostic_audio_visual_evaluation_neurips_2025(m, root):
    cls = stem(m).split("+")[-1].rsplit("_", 1)[0]
    return {"audio_class": cls, "split": folder(m).removesuffix("_files"), "text": f"An environmental sound recording of a {words(cls)}"}

DRONE_AUDIO_DETECTION_LABEL = {"0": "no drone", "1": "drone"}

@rule
def drone_audio_detection(m, root):
    label = DRONE_AUDIO_DETECTION_LABEL[m["label"]]
    return {"label": label, "text": f"A recording of {label}"}

FSDKAGGLE2018_META = {"FSDKaggle2018.audio_train": "train_post_competition.csv", "FSDKaggle2018.audio_test": "test_post_competition_scoring_clips.csv"}

@rule
def fsdkaggle2018(m, root):
    r = table(root / "FSDKaggle2018.meta" / FSDKAGGLE2018_META[folder(m)], "fname")[Path(m["path"]).name]
    return {"label": r["label"], "freesound_id": r["freesound_id"], "licence": r["license"], "text": f"A recording of {words(r['label'])}"}

HEROICO_SPANISH_TRANSCRIPTS = {"Answers_Spanish": "heroico-answers", "Recordings_Spanish": "heroico-recordings", "usma": "usma-prompts"}

@cache
def _heroico_spanish(root, name):
    lines = (root / f"LDC2006S37/data/transcripts/{name}.txt").read_text(encoding="latin-1").splitlines()
    return {"/".join(k.split("/")[-2:]): v.strip() for k, v in (l.split("\t", 1) for l in lines if l.strip())}

@rule
def heroico_spanish(m, root):
    section = next(s for s in HEROICO_SPANISH_TRANSCRIPTS if f"/{s}/" in m["path"])
    rows = _heroico_spanish(root, HEROICO_SPANISH_TRANSCRIPTS[section])
    key = f"{folder(m)}/{stem(m)}" if section == "Answers_Spanish" else re.sub("^t", "s", stem(m))  # t*: throat microphone of prompt s*
    t = "" if key == "17/51" else rows[key]  # the one recording without a transcript row
    return {"section": section, "speaker": folder(m), "transcript": t, "text": speech("Spanish", t)}

@rule
def jl_corpus_emotions(m, root):
    speaker, emotion, sentence, take = stem(m).split("_")
    t = sidecar(m, root, ".txt")
    return {"speaker": speaker, "emotion": emotion, "sentence_id": sentence, "take": take, "transcript": t,
            "text": f'Emotional speech in New Zealand English expressing {emotion} by a {speaker.rstrip("0123456789")} speaker: "{t}"'}

@rule
def kazakh_speech(m, root):
    t = (root / f"ISSAI_KSC_335RS_v1.1_flac/Transcriptions/{stem(m)}.txt").read_text(encoding="utf-8").strip()
    return {"transcript": t, "text": speech("Kazakh", t)}

@rule
def magicdata(m, root):
    p = Path(m["path"])
    t = table(root / p.parts[0] / "TRANS.txt", "UtteranceID", "\t")[p.name]["Transcription"]
    return {"speaker": folder(m), "split": p.parts[0], "transcript": t, "text": speech("Mandarin Chinese", t)}

@cache
def _malromur_icelandic(root):
    rows = {}
    for l in (root / "info.txt").read_text(encoding="utf-8").splitlines():
        name, env, _, gender, age, rest = l.split(",", 5)
        text, dur, cls = rest.rsplit(",", 2)
        rows[name] = {"environment": env, "gender": gender, "age": age, "transcript": text}
    return rows

@rule
def malromur_icelandic(m, root):
    r = _malromur_icelandic(root)[stem(m)]
    return {**r, "text": speech("Icelandic", r["transcript"])}

@rule
def openslr_130_samromur_l2(m, root):
    r = table(root / "samromur_L2_22.09/metadata.tsv", "filename", "\t")[Path(m["path"]).name]
    return {"speaker": r["speaker_id"], "gender": r["gender"], "age": r["age"], "native_language": r["native_language"], "split": r["status"],
            "transcript": r["sentence"], "text": speech("Icelandic", r["sentence"])}

# ReaLISED file name codes abc_123_45_67_8, from the record README; "00"/"0" = no information
REALISED_EVENT = {"bea": "beater", "coo": "cooking", "cup": "cupboard/wardrobe", "dis": "dishwasher", "doo": "door", "dra": "drawer",
                  "fur": "furniture movement", "mic": "microwave", "obj": "object falling", "smo": "smoke extractor", "spe": "speech", "swi": "switch",
                  "tel": "television", "vac": "vacuum cleaner", "wal": "walking", "was": "washing machine", "wat": "water tap", "win": "window"}
REALISED_ACTION = {"00": "", "01": "close", "02": "open", "03": "throw", "04": "turn on", "05": "turn off", "06": "move", "07": "plug", "08": "unplug",
                   "09": "raise", "10": "lower"}
REALISED_MATERIAL = {"00": "", "01": "wood", "02": "glass", "03": "metal", "04": "plastic", "05": "ceramic", "06": "synthetic", "07": "cardboard",
                     "08": "marble", "09": "floating platform", "10": "platelet", "11": "wicker", "12": "carpet", "13": "medium-density fibreboard"}
REALISED_INTENSITY = {"0": "", "1": "low intensity", "2": "medium intensity", "3": "high intensity"}

@rule
def realised(m, root):
    ev, clip, act, mat, inten = stem(m).split("_")
    details = [x for x in (REALISED_ACTION[act], REALISED_MATERIAL[mat], REALISED_INTENSITY[inten]) if x]
    return {"event_class": REALISED_EVENT[ev], "action": REALISED_ACTION[act], "material": REALISED_MATERIAL[mat], "intensity": REALISED_INTENSITY[inten],
            "text": f"A real-life indoor sound event recording of {REALISED_EVENT[ev]}" + (f" ({', '.join(details)})" if details else "")}

@rule
def silbo_gomero(m, root):
    sub = Path(m["path"]).parts[0]
    rows = table(root / sub / "transc.csv", "path")
    key = f"clips/{Path(m['path']).name}"
    if key not in rows:  # 75 fragment clips 02-fragment-109..183 are listed as 03-fragment-... in transc.csv
        return {"subset": sub, "text": speech("Silbo Gomero / Spanish", "")}
    r = rows[key]
    return {"subset": sub, "author": r["author"], "transcript": r["transcription"], "text": speech("Silbo Gomero / Spanish", r["transcription"])}

@rule
def toads_frogs_anuran(m, root):
    cls = stem(m).split(" (")[0]
    return {"class_id": cls, "text": f"Anuran (frog/toad) call, species class {cls}"}

@rule
def synthetic_vocal_bursts(m, root):
    return {"text": m["caption"] or m["transcription"]}

@rule
def arcticbirdsounds(m, root):
    year, plot, start, idx = stem(m).split("_")
    site, sp = table(root / "DataS1/site_infos.csv", "plot")[plot], table(root / "DataS1/annotations_details.csv", "tag")
    tags = sorted({r["tag"] for r in table(root / m["path"].replace(".flac", "-tags.csv"), "id").values()})
    named = [f'{sp[t]["vernacular_name"]} ({sp[t]["scientific_name"]})' for t in tags if t in sp and sp[t]["scientific_name"]]
    what = f"vocalisations of {', '.join(named)}" if named else f"annotated sounds: {', '.join(tags)}" if tags else "no annotated vocalisation"
    return {"plot": plot, "year": year, "tags": tags, "text": f'An Arctic tundra field recording from {site["site"]} ({site["bioclimate_zone"]}, plot {plot}) with {what}.'}

# filename compounds the Berklee44 file names glue together
BERKLEE44_COMPOUNDS = {"cookietinspin": "cookie tin spin", "drillinginstyrofoam": "drilling in styrofoam", "brassbowlsrubbing": "brass bowls rubbing",
                       "brassbowlhit": "brass bowl hit", "policesiren": "police siren", "machinedrill": "machine drill", "powertool": "power tool",
                       "garbagecan": "garbage can", "waterbottle": "water bottle", "cookietin": "cookie tin", "brassbowl": "brass bowl",
                       "femalevoices": "female voices", "femalevoice": "female voice", "bottlecap": "bottle cap", "windup": "wind up"}

@rule
def berklee44(m, root):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", re.sub(r"[^\w\s-]", "", re.sub(r"[_+]", " ", stem(m)))).lower()
    for k, v in BERKLEE44_COMPOUNDS.items():
        s = s.replace(k, v)
    s = " ".join(re.sub(r"-+\s*$", "", re.sub(r"(\w+?)\d+$", r"\1", re.sub(r"\s*\d+\s*$", "", re.sub(r"\d+[a-z]$", "", s)))).split())
    return {"volume": folder(m), "text": f"Sound of {'an' if s[0] in 'aeiou' else 'a'} {s}"}

@rule
def coughvid(m, root):
    j = json.loads(sidecar(m, root, ".json"))
    assert ("status" in j) == ("gender" in j), m["path"]  # both come from the questionnaire, which 13,770 of 34,434 recordings lack
    who = ["a", j["status"] if "status" in j else "", "subject", f"aged {j['age']}" if "age" in j else "", f"by a {j['gender']} speaker" if "gender" in j else ""]
    return {**j, "text": f"A cough recording of {' '.join(filter(None, who))} from the COVID-19 cough audio classification dataset"}

CHOPIN22_PIECES = {"Chopin_Ballade": "Ballade in F major Op. 38", "Chopin_Etude": "Etude in E major Op. 10 No. 3"}

@rule
def chopin22(m, root):
    pianist = stem(m).rsplit("_p", 1)[1]
    return {"piece": CHOPIN22_PIECES[folder(m)], "pianist": pianist, "text": f"Piano performance of Frédéric Chopin's {CHOPIN22_PIECES[folder(m)]} by pianist {pianist}"}

DCASE2018_TASK5_LABELS = {"absence": "Absence (nobody present in the room)", "cooking": "Cooking", "dishwashing": "Dishwashing", "eating": "Eating",
                          "other": "Other (present but not doing any relevant activity)", "social_activity": "Social activity (visit, phone call)",
                          "vacuum_cleaner": "Vacuum cleaning", "watching_tv": "Watching TV", "working": "Working (typing, mouse click, ...)"}

@rule
def dcase2018_task5(m, root):
    label, session = pairs(root / "DCASE2018-task5-dev/meta.txt", "\t")["audio/" + Path(m["path"]).name].split("\t")
    return {"label": label, "session": session, "text": DCASE2018_TASK5_LABELS[label]}

# EmoDB file names: speaker (2) + sentence code (3) + emotion letter (German initial) + version
EMODB_EMOTIONS = {"W": "anger", "L": "boredom", "E": "disgust", "A": "fear", "F": "happiness", "T": "sadness", "N": "neutral"}
EMODB_SENTENCES = {"a01": "Der Lappen liegt auf dem Eisschrank.", "a02": "Das will sie am Mittwoch abgeben.", "a04": "Heute abend könnte ich es ihm sagen.",
                   "a05": "Das schwarze Stück Papier befindet sich da oben neben dem Holzstück.", "a07": "In sieben Stunden wird es soweit sein.",
                   "b01": "Was sind denn das für Tüten, die da unter dem Tisch stehen.", "b02": "Sie haben es gerade hochgetragen und jetzt gehen sie wieder runter.",
                   "b03": "An den Wochenenden bin ich jetzt immer nach Hause gefahren und habe Agnes besucht.",
                   "b09": "Ich will das eben wegbringen und dann mit Karl was trinken gehen.", "b10": "Die wird auf dem Platz sein, wo wir sie immer hinlegen."}

@rule
def emodb(m, root):
    s = stem(m)
    emotion, sentence = EMODB_EMOTIONS[s[5]], EMODB_SENTENCES[s[2:5]]
    return {"speaker": s[:2], "emotion": emotion, "transcript": sentence, "text": f'German emotional speech expressing {emotion}: "{sentence}"'}

@rule
def emozionalmente(m, root):
    r = table(root / "emozionalmente_dataset/metadata/samples.csv", "file_name")[Path(m["path"]).name]
    return {"actor": r["actor"], "emotion": r["emotion_expressed"], "transcript": r["sentence"],
            "text": f'Italian emotional speech expressing {r["emotion_expressed"]}: "{r["sentence"]}"'}

# IDMT-SMT-Drums file names: <kit><nn>_<nn>#<instrument>[#train]
IDMT_SMT_DRUMS_KITS = {"RealDrum": "real drum kit", "TechnoDrum": "techno drum machine", "WaveDrum": "sampled drum kit"}
IDMT_SMT_DRUMS_PARTS = {"HH": "hi-hat", "KD": "kick drum", "SD": "snare drum", "MIX": "kick drum, snare drum and hi-hat"}

@rule
def idmt_smt_drums(m, root):
    name, part, *train = stem(m).split("#")
    kit = re.sub(r"\d+_\d+$", "", name)
    return {"kit": kit, "instrument": part, "text": f"{'Isolated strokes' if train else 'A drum pattern'} of {IDMT_SMT_DRUMS_PARTS[part]} on a {IDMT_SMT_DRUMS_KITS[kit]}"}

@cache
def insectset_species(root):
    readme = (root / "README.txt").read_text(encoding="utf-8").split("InsectSet66:")[-1]
    return {s.replace(" ", ""): s for s in re.findall(r"^([A-Z][a-z]+ [a-z0-9]+)\s+\d+\s+\d+:\d\d:\d\d", readme, re.M)}

@rule
def insectset47(m, root):
    species = insectset_species(root)[stem(m).split("_")[0]]
    return {"species": species, "text": f"Insect sound recording of {species}"}

@cache
def lp_musiccaps_mtt_captions(root):
    return {r["path"]: r for f in root.glob("*.parquet") for r in pl.read_parquet(f, columns=["path", "track_id", "title", "artist_name", "caption_writing"]).to_dicts()}

@rule
def lp_musiccaps_mtt(m, root):
    caps = lp_musiccaps_mtt_captions(root)
    if m["path"] not in caps:
        return {"text": ""}
    return {**caps[m["path"]], "text": caps[m["path"]]["caption_writing"]}

@rule
def marmosets2016(m, root):
    label = words(folder(m))
    return {"label": label, "text": f"A Marmoset (Callithrix jacchus) {label.rstrip(' 0123456789')} vocalization"}

@rule
def picidaedataset(m, root):
    if folder(m) == "Silence":
        return {"label": "Silence", "text": "Silence"}
    species, kind = folder(m).split("-")
    species = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", species)
    return {"species": species, "kind": kind, "text": f"{kind.capitalize()} of a {species}"}

@cache
def sonycust_rows(root):
    rows = {}
    with open(root / "annotations.csv", newline="") as f:
        for r in csv.DictReader(f):
            rows.setdefault(r["audio_filename"], []).append(r)
    return rows

@rule
def sonycust(m, root):
    rows = sonycust_rows(root)[Path(m["path"]).name]
    gt = [r for r in rows if r["annotator_id"] == "0"]
    cols = [c for c in rows[0] if c.endswith("_presence") and "-" in c.split("_")[0]]
    labels = [words(c.split("_")[1]) for c in cols if (gt[0][c] == "1" if gt else sum(r[c] == "1" for r in rows) >= 2)]
    what = " and ".join(labels) if len(labels) < 3 else ", ".join(labels[:-1]) + ", and " + labels[-1]
    return {"labels": labels, "split": rows[0]["split"], "sensor_id": rows[0]["sensor_id"],
            "text": f"Urban sound recording containing {what}" if labels else "Urban environmental audio recording from New York City"}

TAU_URBAN_ACOUSTIC_SCENES_2020_MOBILE_PLACES = {"airport": "at an airport", "bus": "inside a bus", "metro": "in a metro/subway", "metro_station": "at a metro station",
                                                 "park": "in a park", "public_square": "in a public square", "shopping_mall": "in a shopping mall",
                                                 "street_pedestrian": "on a pedestrian street", "street_traffic": "on a street with traffic", "tram": "inside a tram"}

@rule
def tau_urban_acoustic_scenes_2020_mobile(m, root):
    scene, city, *_, device = stem(m).split("-")
    return {"scene": scene, "city": city, "device": device, "text": f"Ambient sounds recorded {TAU_URBAN_ACOUSTIC_SCENES_2020_MOBILE_PLACES[scene]}"}

TINYSOL_DYNAMICS = {"pp": "pianissimo", "p": "piano", "mf": "mezzo-forte", "ff": "fortissimo"}

@rule
def tinysol(m, root):
    r = table(root / "TinySOL_metadata.csv", "Path")[m["path"]]
    instrument, technique = r["Instrument (in full)"], r["Technique (in full)"]
    return {"instrument": instrument, "technique": technique, "pitch": r["Pitch"], "dynamics": r["Dynamics"],
            "text": f"An isolated {instrument} note, {r['Pitch']}, played {technique} at {TINYSOL_DYNAMICS[r['Dynamics']]} dynamics"}

@cache
def wabad_annotations(root):
    sites, species = {}, {}
    with open(root / "Pooled annotations.csv", encoding="cp1252", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            sites[r["Recording site"]] = r
            species.setdefault(r["Recording"], []).append(r["Species"])
    return sites, species

@rule
def wabad(m, root):
    sites, species = wabad_annotations(root)
    site, name = folder(m, 2), Path(m["path"]).name
    sp = sorted(dict.fromkeys(species[name]), key=species[name].count, reverse=True) if name in species else []
    where = f"at site {site} in {sites[site]['Country']} ({sites[site]['Biome']})"
    names = ", ".join(sp[:6]) + (f" and {len(sp) - 6} other species" if len(sp) > 6 else "")
    text = f"A passive acoustic monitoring recording {where} with vocalisations of {names}." if sp else \
        f"A passive acoustic monitoring recording {where}; no bird vocalisation is annotated in it."
    return {"site": site, "country": sites[site]["Country"], "biome": sites[site]["Biome"], "species": sp, "text": text}

EARS_EMOTIONS = {"adoration": "expressing adoration and affection", "amazement": "expressing amazement and wonder", "amusement": "expressing amusement and lightheartedness",
                 "anger": "expressing anger and frustration", "confusion": "expressing confusion and uncertainty", "contentment": "expressing contentment and satisfaction",
                 "cuteness": "expressing delight at something cute", "desire": "expressing desire and longing", "disappointment": "expressing disappointment",
                 "disgust": "expressing disgust and revulsion", "distress": "expressing distress and anxiety", "embarassment": "expressing embarrassment",
                 "extasy": "expressing ecstasy and extreme excitement", "fear": "expressing fear and apprehension", "guilt": "expressing guilt and remorse",
                 "interest": "expressing interest and curiosity", "neutral": "speaking in a neutral tone", "pain": "expressing pain and discomfort",
                 "pride": "expressing pride and accomplishment", "realization": "expressing a moment of realization", "relief": "expressing relief",
                 "sadness": "expressing sadness and melancholy", "serenity": "expressing serenity and calmness"}
EARS_STYLES = {"fast": "at a fast pace", "slow": "at a slow pace", "loud": "loudly", "whisper": "in a whisper", "highpitch": "with a high pitch",
               "lowpitch": "with a low pitch", "regular": "at a normal pace and volume"}
EARS_SOUNDS = {"nonverbal_cheering": "cheering enthusiastically", "nonverbal_crying": "crying", "nonverbal_laughter_closed": "laughing with mouth closed",
               "nonverbal_laughter_open": "laughing with mouth open", "nonverbal_screaming": "screaming", "nonverbal_yelling": "yelling",
               "vegetative_coughing": "coughing", "vegetative_eating": "eating", "vegetative_sneezing": "sneezing", "vegetative_throat": "clearing their throat",
               "vegetative_yawning": "yawning", "interjection_agreement": "making sounds of agreement", "interjection_anger": "making angry interjections",
               "interjection_congratulations": "expressing congratulations", "interjection_filler": "using filler words and hesitation sounds",
               "interjection_greetings": "greeting someone", "melodic_happy_birthday": "singing Happy Birthday"}
# speaker_statistics.json answers as phrases ("prefer not to answer" adds nothing)
EARS_GENDERS = {"male": "man", "female": "woman", "non-binary / third gender": "person", "prefer not to answer": "person"}
EARS_ETHNICITIES = {"white or caucasian": "A Caucasian", "black or african american": "An African American", "hispanic or latino": "A Hispanic", "asian": "An Asian",
                    "prefer not to answer": "A"}
EARS_AGES = {"18-25": " in their early twenties", "26-35": " in their late twenties to early thirties", "36-45": " in their late thirties to mid forties",
             "46-55": " in their late forties to mid fifties", "56-65": " in their late fifties to early sixties", "66-75": " in their late sixties to mid seventies",
             "prefer not to answer": ""}
EARS_ACCENTS = {"american english": ", with an American accent", "british english": ", with a British accent", "german": ", with a German accent",
                "mandarin": ", with a Mandarin Chinese accent", "spanish": ", with a Spanish accent", "ukrainian": ", with a Ukrainian accent",
                "russian": ", with a Russian accent", "dari": ", with a Dari accent", "prefer not to answer": ""}

@cache
def ears_meta(root):
    return json.loads((root / "speaker_statistics.json").read_text()), json.loads((root / "transcripts.json").read_text())

@rule
def ears(m, root):
    speakers, transcripts = ears_meta(root)
    s, name = speakers[folder(m)], stem(m)
    kind, *rest = name.split("_")
    what = (f"{'speaking freely' if rest[1] == 'freeform' else 'reading sentences'} while {EARS_EMOTIONS[rest[0]]}" if kind == "emo"
            else f"reading {'the Rainbow Passage' if kind == 'rainbow' else 'sentences'} {EARS_STYLES[rest[1]]}" if kind in ("rainbow", "sentences")
            else "speaking spontaneously about various topics" if kind == "freeform" else EARS_SOUNDS[name])
    text = f"{EARS_ETHNICITIES[s['ethnicity']]} {EARS_GENDERS[s['gender']]}{EARS_AGES[s['age']]} {what}{EARS_ACCENTS[s['native language']]}"
    t = transcripts[name] if kind == "rainbow" or "sentences" in name else ""  # the free speech and non-speech sounds have no transcript
    return {"speaker": folder(m), **s, "transcript": t, "text": f'{text}: "{t}"' if t else text}

@rule
def aishell_1(m, root):
    tr = pairs(root / "data_aishell/transcript/aishell_transcript_v0.8.txt")
    assert len(tr) == 141600, len(tr)
    t = tr[stem(m)].strip() if stem(m) in tr else ""  # 325 of the 141,925 recordings have no transcript
    return {"speaker": folder(m), "transcript": t, "text": speech("Chinese", t)}

@rule
def althingi_icelandic(m, root):
    (t,) = [r[stem(m)]["normalized_text"] for s in ("train", "dev", "test") if stem(m) in (r := table(root / f"corpus/files/metadata_{s}.tsv", "audio_id", "\t"))]
    return {"speaker": folder(m, 2), "transcript": t, "text": speech("Icelandic", t)}

@rule
def audio_classifier(m, root):
    speaker = stem(m).strip("0123456789")
    return {"speaker": speaker, "text": f"Speech by {speaker} (motivational speaker identification clip)"}

@rule
def bibletts(m, root):
    language, t = Path(m["path"]).parts[0], sidecar(m, root, ".txt")
    return {"language": language, "split": folder(m, 2), "book": folder(m), "transcript": t, "text": speech(words(language).title(), t)}

CCMUSIC_COLLECTIONS = {"ctis": "Chinese Traditional Instrument Sound", "cpop": "Chinese Pop Music"}

@rule
def ccmusic(m, root):
    p = Path(m["path"]).parts
    collection = p[2] if p[1] == "ccm" else CCMUSIC_COLLECTIONS[p[1]]
    return {"collection": collection, "text": f"{collection}: {words(stem(m))}"}

CHORALEBRICKS_INSTRUMENTS = {"fl": "flute", "ob": "oboe", "eh": "English horn", "cl": "clarinet", "bcl": "bass clarinet", "as": "alto saxophone",
                             "ts": "tenor saxophone", "bs": "baritone saxophone", "ss": "soprano saxophone", "bsn": "bassoon", "tp": "trumpet",
                             "fh": "flugelhorn", "bar": "baritone", "fho": "French horn", "tb": "trombone", "tba": "tuba"}
CHORALEBRICKS_VOICES = {"01": "soprano", "02": "alto", "03": "tenor", "04": "bass"}

@rule
def choralebricks(m, root):
    voice, instrument = stem(m).split("_")
    composer, piece = folder(m, 2).split("_")
    piece, instrument = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", piece), CHORALEBRICKS_INSTRUMENTS[instrument]
    return {"composer": composer, "piece": piece, "voice": CHORALEBRICKS_VOICES[voice], "instrument": instrument,
            "text": f"{instrument[0].upper() + instrument[1:]} playing the {CHORALEBRICKS_VOICES[voice]} part of the chorale {piece} by {composer}"}

@rule
def dcase2024_task7_soundscenesynthesis(m, root):
    r = table(root / folder(m, 2) / "caption.csv", "file")[Path(m["path"]).name]
    return {**r, "text": r["caption"]}

@rule
def fakeavceleb(m, root):
    category, ethnicity, gender, speaker = Path(m["path"]).parts[-5:-1]
    real = category.endswith("RealAudio")
    return {"category": category, "ethnicity": ethnicity, "gender": gender, "speaker": speaker,
            "text": f"{'Real' if real else 'Synthesized (deepfake)'} speech of a {'man' if gender == 'men' else 'woman'} ({ethnicity})"}

@cache
def hifi_tts_manifests(root):
    return {j["audio_filepath"]: j for f in root.glob("hi_fi_tts_v0/*_manifest_*.json") for j in map(json.loads, f.read_text(encoding="utf-8").splitlines())}

@rule
def hifi_tts(m, root):
    j = hifi_tts_manifests(root)[m["path"].removeprefix("hi_fi_tts_v0/")]
    return {"speaker": folder(m, 2).split("_")[0], "quality": folder(m, 2).split("_")[1], "transcript": j["text"],
            "transcript_original": j["text_no_preprocessing"], "text": speech("English", j["text"])}

@rule
def jsut_japanese(m, root):
    t = pairs(root / "jsut_ver1.1" / folder(m, 2) / "transcript_utf8.txt", ":")[stem(m)]
    return {"subcorpus": folder(m, 2), "transcript": t, "text": speech("Japanese", t)}

@rule
def nar_nonspeech(m, root):
    category = stem(m).rstrip("0123456789")
    return {"category": category, "text": f"A short non-speech sound event from the NAR humanoid-robot corpus, category '{category}', "
                                          "captured on a NAO robot's on-board microphones in a domestic environment"}

@rule
def openslr_131_samromur_mimic(m, root):
    r = table(root / "samromur_mimic_22.09/metadata.tsv", "filename", "\t")[Path(m["path"]).name]
    return {"speaker": r["speaker_id"], "gender": r["gender"], "age": r["age"], "native_language": r["native_language"],
            "transcript": r["sentence"], "text": speech("Icelandic", r["sentence"])}

@rule
def physionet_heart2016(m, root):
    label = {"-1": "normal", "1": "abnormal"}[pairs(root / folder(m) / "REFERENCE.csv", ",")[stem(m)]]
    return {"label": label, "database": folder(m), "text": f"A heart sound (phonocardiogram) recording, {label}"}

@rule
def rescuespeech(m, root):
    (r,) = [t[n] for s in ("train", "dev", "test") if (n := Path(m["path"]).name) in (t := table(root / f"Task_ASR/{s}.tsv", "path", "\t"))]
    return {"speaker": r["client_id"], "transcript": r["sentence"], "text": speech("German", r["sentence"])}

@rule
def synbad(m, root):
    r = table(root / "SynBAD/localization_sensitivity/metadata.csv", "file_name")[Path(m["path"]).name]
    return {**r, "text": f"Synthetic binaural rendering of {r['source']} at azimuth {r['az']} and elevation {r['el']} degrees"}

@rule
def thchs30(m, root):
    t, pinyin = (root / f"{m['path']}.trn").read_text(encoding="utf-8").splitlines()[:2]
    return {"speaker": stem(m).split("_")[0], "pinyin": pinyin, "transcript": t, "text": speech("Chinese", t)}

@cache
def _tunisian_msa(root):
    d = root / "Tunisian_MSA/data"
    rows = pairs(d / "transcripts/train/recordings.tsv", "\t") | pairs(d / "transcripts/train/answers.tsv", "\t")
    rows |= {k: v for f in d.rglob("*_recordings.tsv") for k, v in pairs(f, "\t").items()}  # one file per test speaker
    assert len(rows) == 3780, len(rows)
    return rows

@rule
def tunisian_msa(m, root):
    split, part = Path(m["path"]).parts[3], folder(m, 2)
    key = f"{folder(m, 3)}_{folder(m)}_{part}_{stem(m)}" if part == "Answers_Arabic" else stem(m)
    t = "" if split == "devtest" and part == "Answers_Arabic" else _tunisian_msa(root)[key]  # the 50 devtest answers have no transcript
    return {"split": split, "speaker": folder(m) if split == "test" else f"{folder(m, 3)}_{folder(m)}", "transcript": t, "text": speech("Arabic", t)}

VOXFORGE_LANGUAGES = {"en": "English", "fr": "French", "es": "Spanish", "de": "German", "it": "Italian", "nl": "Dutch", "ru": "Russian", "pt": "Portuguese",
                      "tr": "Turkish", "el": "Greek", "bg": "Bulgarian", "ca": "Catalan", "uk": "Ukrainian", "sq": "Albanian", "he": "Hebrew", "fa": "Persian",
                      "hr": "Croatian"}

@rule
def voxforge(m, root):
    p = Path(m["path"]).parts
    t = {k.rsplit("/", 1)[-1]: v for k, v in pairs(root.joinpath(*p[:-2], "etc/PROMPTS")).items()}[stem(m)]
    return {"language": p[0], "speaker": p[-3].split("-")[0], "transcript": t, "text": speech(VOXFORGE_LANGUAGES[p[0]], t)}

@rule
def escorpus_pe(m, root):
    _, v, a, d = stem(m).split("_")[1].split("-")
    return {"valence": int(v), "arousal": int(a), "dominance": int(d),
            "text": f"Emotional speech in Peruvian Spanish (valence {int(v)}/5, arousal {int(a)}/5, dominance {int(d)}/5)"}

@cache
def rows_by(path, key, sep=","):
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=sep):
            out.setdefault(r[key], []).append(r)
    return out

@rule
def aam(m, root):
    track, inst = stem(m).split("_")
    parts = sorted(p.stem.split("_")[1] for p in (root / m["path"]).parent.glob(f"{track}_*.flac")
                   if not p.stem.endswith("_mix")) if inst == "mix" else [inst]
    names = [re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s).lower() for s in parts]
    return {"track": track, "instruments": parts, "text": f"Music mix of {', '.join(names)}" if inst == "mix" else f"Solo {names[0]} track"}

ATT_HACK_ATTITUDE = {"a1": "friendly", "a2": "distant", "a3": "dominant", "a4": "seductive"}

@rule
def att_hack(m, root):
    speaker, att, sentence, version = stem(m).split("_")
    t = ((root / m["path"]).parent.parent / "txt" / f"{stem(m)}.txt").read_text(encoding="utf-8").strip()
    return {"speaker": speaker, "attitude": ATT_HACK_ATTITUDE[att], "sentence": sentence, "transcript": t,
            "text": f"French {ATT_HACK_ATTITUDE[att]} speech by {speaker}: {t}"}

CSD_CHORAL_PIECE = {"ER": "El Rossinyol, a traditional Catalan song", "LI": "Locus Iste by Anton Bruckner",
                    "ND": "Niño Dios d'Amor Herido by Francisco Guerrero"}

@rule
def csd_choral(m, root):
    _, piece, voice, singer = stem(m).split("_")
    return {"piece": piece, "section": voice, "singer_index": int(singer),
            "text": f"One {voice} singer of a choir singing {CSD_CHORAL_PIECE[piece]}"}

@rule
def closermusicdb(m, root):
    r = table(root / "closermusicdb.csv", "FILENAME")[Path(m["path"]).name]
    tags = sorted(ast.literal_eval(r["TAGS"]))
    return {"bpm": r["BPM"], "tags": tags, "text": f"Music track at {round(float(r['BPM']))} BPM tagged as {', '.join(tags)}"}

DCASE2025_ASD_MACHINE = {
    "ToyCar": "toy car operating sound", "ToyTrain": "toy train operating sound", "fan": "industrial fan operating sound",
    "gearbox": "gearbox operating sound", "bearing": "bearing operating sound", "slider": "slide rail operating sound",
    "valve": "valve operating sound with open/close patterns", "AutoTrash": "automatic trash can sound opening and closing",
    "HomeCamera": "home security camera sound rotating", "ToyPet": "toy pet sound walking and yelping",
    "ToyRCCar": "toy radio-controlled car sound driving", "BandSealer": "endless bandsealer operating sound",
    "Polisher": "electronic polisher sound brushing metal", "ScrewFeeder": "automatic screw feeder sound",
    "CoffeeGrinder": "coffee grinder sound grinding beans"}

@rule
def dcase2025_asd(m, root):
    machine, part = Path(m["path"]).parts[-3:-1]
    f = stem(m).split("_")
    if part == "supplemental":
        return {"machine_type": machine, "condition": f[2], "text": f"Clean {DCASE2025_ASD_MACHINE[machine]} without environmental noise"
                if f[2] == "machine" else f"Factory environmental noise recorded for the {machine} machine"}
    status = f[4].replace("anomaly", "anomalous").capitalize()
    return {"machine_type": machine, "domain": f[2], "split": f[3], "condition": f[4], "attributes": "_".join(f[6:]),
            "text": f"{status} {DCASE2025_ASD_MACHINE[machine]}" + (" in target domain" if f[2] == "target" else "")}

EMO_SOUNDSCAPES_SCHAFER = {"human": "human sounds", "indicator": "sounds as indicators", "mechanical": "mechanical sounds",
                           "nature": "natural sounds", "quiet": "quiet and silence", "society": "sounds and society"}

@rule
def emo_soundscapes(m, root):
    cats = [w for w in stem(m).split("_") if w in EMO_SOUNDSCAPES_SCHAFER] if stem(m).startswith("mix_") else [folder(m)]
    assert cats, m["path"]
    what = ", ".join(EMO_SOUNDSCAPES_SCHAFER[c] for c in cats)
    return {"categories": cats, "text": f"Soundscape mix of {what}" if stem(m).startswith("mix_") else f"Soundscape of {what}"}

@rule
def giant_otter(m, root):
    call = stem(m).split("_", 1)[1]
    return {"call_type": call, "text": f"Giant otter vocalization: {call}"}

IDMT_SMT_GUITAR_EXCITATION = {"PK": "picked", "FS": "finger-plucked", "MU": "muted"}
IDMT_SMT_GUITAR_EXPRESSION = {"NO": "", "BE": " with bending", "SL": " with slide", "VI": " with vibrato",
                              "HA": " as harmonics", "DN": " as dead notes"}

@rule
def idmt_smt_guitar(m, root):
    p = Path(m["path"])
    if p.parts[1] == "dataset4":
        bpm = p.stem.rsplit("_", 1)[1].removesuffix("BPM")
        return {"style": folder(m, 2), "guitar": p.parts[2], "tempo_bpm": int(bpm),
                "text": f"Guitar accompaniment in {words(folder(m, 2))} style at {bpm} BPM"}
    x = root / p.parent.parent / "annotation" / f"{p.stem}.xml"
    ev = list(ElementTree.parse(x).iter("event")) if x.exists() else []
    styles = sorted({IDMT_SMT_GUITAR_EXCITATION[e.findtext("excitationStyle")] + IDMT_SMT_GUITAR_EXPRESSION[e.findtext("expressionStyle")] for e in ev})
    return {"pitches": [int(e.findtext("pitch")) for e in ev], "styles": styles,
            "text": f"Electric guitar playing {len(ev)} notes: {', '.join(styles)}" if ev else "Electric guitar playing a lick"}

ISOVAT_DIMENSION = {"A": "arousal", "V": "valence", "T": "tension"}
ISOVAT_LEVEL = {"H": "high", "M": "medium", "L": "low"}

@rule
def isovat(m, root):
    dim, group, level = stem(m).split("-")
    return {"dimension": ISOVAT_DIMENSION[dim], "set": int(group), "level": ISOVAT_LEVEL[level],
            "text": f"Music clip expressing {ISOVAT_LEVEL[level]} {ISOVAT_DIMENSION[dim]}"}

@rule
def libritts(m, root):
    t = sidecar(m, root, ".normalized.txt")
    return {"speaker": stem(m).split("_")[0], "transcript": t, "text": speech("English", t)}

@rule
def mimii(m, root):
    machine, mid, cond = Path(m["path"]).parts[-4:-1]
    return {"machine_type": machine, "machine_id": mid, "condition": cond,
            "text": f"Industrial {machine} machine sound, {cond} operation"}

@rule
def medleysolosdb(m, root):
    r = table(root / "Medley-solos-DB_metadata.csv", "uuid4")[stem(m).split("_")[-1]]
    return {"instrument": r["instrument"], "subset": r["subset"], "song_id": r["song_id"], "text": f"This is the sound of a {r['instrument']}."}

@rule
def openmic(m, root):
    r = table(root / "openmic-2018/openmic-2018-metadata.csv", "sample_key")[stem(m)]
    genres = [g["genre_title"] for g in ast.literal_eval(r["track_genres"])]
    inst = sorted(x["instrument"] for x in rows_by(root / "openmic-2018/openmic-2018-aggregated-labels.csv", "sample_key")[stem(m)]
                  if float(x["relevance"]) > 0.5)
    what = f"{', '.join(genres)} music" if genres else "Music"
    return {"instruments": inst, "genres": genres, "track_title": r["track_title"], "artist_name": r["artist_name"],
            "licence": r["license_title"], "text": f"{what} featuring {' and '.join(inst)}" if inst else f"{what} recording with unidentified instruments"}

@rule
def soundingearth(m, root):
    x = ElementTree.parse(root / folder(m) / f"{folder(m)}_meta.xml").getroot()
    parts = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x.findtext(k)))).strip() for k in ("title", "description") if x.findtext(k)]
    return {"title": x.findtext("title"), "licence_url": x.findtext("licenseurl"), "text": ". ".join(parts)}

TESS_EMOTION = {"angry": "anger", "disgust": "disgust", "fear": "fear", "happy": "happiness", "neutral": "neutral emotion",
                "pleasant_surprise": "pleasant surprise", "pleasant_surprised": "pleasant surprise", "sad": "sadness"}

@rule
def tess(m, root):
    speaker, emotion = folder(m).split("_", 1)
    word = stem(m).split("_")[1]
    e = TESS_EMOTION[emotion.lower()]
    return {"speaker": speaker, "emotion": e, "word": word, "text": f'English emotional speech expressing {e}: "Say the word {word}"'}

TOYADMOS_MACHINE = {"ToyCar": "toy car", "ToyConveyor": "toy conveyor", "ToyTrain": "toy train"}

@rule
def toyadmos(m, root):
    _, machine, case, cond, mode, ch, _ = stem(m).split("_")
    what = ("Environmental background noise" if cond == "noise" else
            f"Operating sound of a {TOYADMOS_MACHINE[machine]} {'running normally' if cond == 'normal' else f'with induced anomaly {cond}'}")
    run = "individual operation" if mode == "IND" else "continuous recording"
    return {"machine_type": machine, "case": case, "condition": cond, "recording_mode": mode, "channel": ch,
            "text": f"{what}, ToyADMOS {TOYADMOS_MACHINE[machine]} {case}, {run}, microphone {ch[2:]} of 4"}

@rule
def urban_sound_sight(m, root):
    ev = rows_by(root / "annotations/audio_annotations.csv", "filename")[stem(m)]
    names = [f"a {lab}" for lab in sorted({r["label"] for r in ev} - {"-1"})]
    names += ["a distant vehicle"] if any(r["non_identifiable_vehicle_sound"] == "1" for r in ev) else []
    return {"labels": names, "text": f"The sound of {' and '.join(names)} passing by" if names else "An urban traffic scene without vehicle sound events"}

EXPRESSO_STYLE = {
    "angry": "angry", "animal": "animal voice", "animal_directed": "speaking to an animal", "animaldir": "speaking to an animal",
    "awe": "awe-inspired", "bored": "bored", "calm": "calm", "child": "child voice", "child_directed": "speaking to a child",
    "childdir": "speaking to a child", "confused": "confused", "default": "neutral", "desire": "desiring", "disgusted": "disgusted",
    "enunciated": "enunciated", "fast": "fast-paced", "fearful": "fearful", "happy": "happy", "laughing": "laughing",
    "narration": "narrative", "nonverbal": "non-verbal", "non_verbal": "non-verbal", "projected": "projected voice", "sad": "sad",
    "sarcastic": "sarcastic", "singing": "singing", "sleepy": "sleepy", "sympathetic": "sympathetic", "whisper": "whispering"}

@rule
def expresso_new(m, root):
    p = Path(m["path"])
    if "read" in p.parts:
        style, t = folder(m, 2), pairs(root / "expresso/read_transcriptions.txt", "\t")[p.stem]
        return {"speaker": folder(m, 3), "style": style, "transcription": t, "text": f"{t} (spoken in a {EXPRESSO_STYLE[style]} style)"}
    styles = (folder(m).split("-") * 2)[:2]
    return {"speakers": folder(m, 2).split("-"), "styles": styles,
            "text": f"Improvised dialogue between two speakers, styles: {', '.join(dict.fromkeys(EXPRESSO_STYLE[x] for x in styles))}"}

@rule
def aishell_4(m, root):
    tg = (root / m["path"]).parent.parent / "TextGrid" / f"{stem(m)}.TextGrid"
    iv = re.findall(r'xmin = ([\d.]+)\s*\n\s*xmax = [\d.]+\s*\n\s*text = "([^"]*)"', tg.read_text(encoding="utf-8"))
    t = " ".join(s for s in (re.sub(r"<[^>]*>", "", s).strip() for _, s in sorted(iv, key=lambda x: float(x[0]))) if s)
    return {"meeting_id": stem(m), "transcript": t, "text": speech("Mandarin Chinese", t)}

@rule
def amdo_tibetan_xbmu_amdo31(m, root):
    t = pairs(root / "xbmu_amdo31/data/transcript/transcript_clean.txt", " ")[stem(m).split("-")[-1]]
    return {"speaker": folder(m), "transcript": t, "text": speech("Amdo Tibetan", t)}

BAVED_WORD = {"0": "Like", "1": "Unlike", "2": "This", "3": "The movie", "4": "Wonderful", "5": "Acceptable", "6": "Bad"}
BAVED_LEVEL = {"0": "low", "1": "neutral", "2": "high"}

@rule
def baved_arabic_emotions(m, root):
    speaker, gender, age, word, level, record = stem(m).split("-")
    g = {"f": "female", "m": "male"}[gender]
    return {"speaker_id": speaker, "gender": g, "age": int(age), "word": BAVED_WORD[word], "emotion": BAVED_LEVEL[level],
            "text": f'Emotional speech expressing {BAVED_LEVEL[level]} by a {g} speaker (word: "{BAVED_WORD[word]}")'}

@rule
def birdclef_2021(m, root):
    r = table(root / "train_metadata.csv", "filename")[Path(m["path"]).name]
    return {"primary_label": r["primary_label"], "common_name": r["common_name"], "scientific_name": r["scientific_name"],
            "licence": r["license"], "url": r["url"], "text": f"Bird call of {r['common_name']} ({r['scientific_name']})"}

@cache
def cityspeechmix_rows(root):
    return {k: r for r in table(root / "metadata.csv", "fname").values() for k in (r["fname"], r["sonyc_file"], r["librispeech_file"])}

@rule
def cityspeechmix(m, root):
    r, kind = cityspeechmix_rows(root)[Path(m["path"]).name], folder(m)
    noise = " and ".join(x for x in (r["label1_audioset"], r["label2_audioset"]) if x != "NaN")
    if kind == "librispeech_for_mixing":
        return {"clip_type": kind, "transcript": r["script"], "text": speech("English", r["script"])}
    if kind == "sonyc_librispeech_mixtures":
        return {"clip_type": kind, "transcript": r["script"], "labels": noise, "text": f"{speech('English', r['script'])}, mixed with urban sound: {noise}"}
    return {"clip_type": kind, "labels": noise, "text": f"Urban sound recording: {noise}"}

@rule
def desed_synthetic(m, root):
    labels = sorted({words(r["event_label"]).lower() for r in rows_by(root / "synthetic_dataset.csv", "filename", "\t")[Path(m["path"]).name]})
    return {"labels": labels, "text": f"Synthetic domestic soundscape with {', '.join(labels)}"}

@rule
def easycall_corpus(m, root):
    spk, cmd = folder(m, 2), words(re.sub(r"_\d+$", "", stem(m).split("_", 2)[2]))
    who = "healthy" if spk[1] == "c" else "dysarthric"
    return {"speaker_id": spk, "speaker_group": who, "transcript": cmd, "text": f"{speech('Italian', cmd)} by a {who} speaker"}

@rule
def fan_anomaly_sound(m, root):
    *label, _, fan, _ = stem(m).split("_")
    what = f"{label[0].replace('anomaly', 'anomalous').capitalize()} industrial fan sound" if label else "Industrial fan sound"
    return {"split": folder(m), "label": label[0] if label else "unknown", "fan_id": f"id_{fan}", "text": what}

@rule
def grid_av_speech(m, root):
    al = (root / "alignments" / folder(m) / f"{stem(m)}.align").read_text().split()
    t = " ".join(w for w in al[2::3] if w not in ("sil", "sp"))
    return {"speaker_id": folder(m), "transcript": t, "text": speech("English", t)}

@rule
def hindi_asr_1111h(m, root):
    top = Path(m["path"]).parts[0]
    t = pairs(root / top / "text", " ")[stem(m)].strip() if top.startswith("GV_") else ""
    return {"subset": top, "transcript": t, "text": speech("Hindi", t)}

AIRS_RESPIRATORY_SOUND = {"cough": "forced cough", "vowel": "sustained vowel phonation"}

@rule
def kaggle_airs_respiratory(m, root):
    return {"participant": folder(m), "sound_type": stem(m), "text": f"A {AIRS_RESPIRATORY_SOUND[stem(m)]} recorded for respiratory sound screening"}

@rule
def kids_speech(m, root):
    kind, _, age, group = Path(m["path"]).parts[:4]
    child = "boy" if group.startswith("Boys") else "girl"
    act = "reading a sentence aloud" if kind.startswith("Read") else "answering a question spontaneously"
    return {"speech_type": "read" if kind.startswith("Read") else "spontaneous", "age": int(age[:-1]), "gender": child,
            "speaker_id": folder(m, 2), "text": f"A Telugu-speaking {child} aged {age[:-1]}, {act} in English"}

@rule
def mimii_due(m, root):
    _, section, domain, split, status, *attr = stem(m).split("_")
    return {"machine_type": folder(m, 2), "section": section, "domain": domain, "condition": status, "attributes": "_".join(attr[1:]),
            "text": f"{status.replace('anomaly', 'anomalous').capitalize()} {folder(m, 2)} operating sound ({domain} domain)"}

@rule
def openslr_103_code_switching(m, root):
    pack, split = Path(m["path"]).parts[:2]
    t = pairs(root / pack / split / "transcription.txt", " ")[stem(m)].strip()
    lang = pack.split("_")[0]
    return {"language": lang, "split": split, "transcript": t, "text": speech(lang, t)}

@rule
def openslr_138_shalcas22a(m, root):
    code = stem(m).split("_")[3]
    t = re.sub(r"[-|/]+", " ", pairs(root / "SHALCAS22A/content.txt", "\t")[code]).strip()
    return {"speaker_id": folder(m), "content_id": code, "transcript": t, "text": speech("Mandarin Chinese", t)}

@cache
def ruls_manifest(path):
    with open(path, encoding="utf-8") as f:
        return {j["audio_filepath"]: j for j in map(json.loads, f)}

@rule
def russian_librispeech(m, root):
    split, rel = m["path"].split("/", 1)
    r = ruls_manifest(root / split / "manifest.json")[rel]
    return {"split": split, "speaker_id": folder(m, 2), "transcript": r["text"], "transcript_original": r["text_no_preprocessing"],
            "text": speech("Russian", r["text"])}

@cache
def sinhala_lines(path):
    lines = dict(re.findall(r'\( (\S+) " (.*?) " \)', Path(path).read_text(encoding="utf-8")))
    assert len(lines) == 1251, len(lines)
    return lines

@rule
def sinhala_tts(m, root):
    lines = sinhala_lines(root / "si_lk.lines.txt")
    t = lines[stem(m)].strip() if stem(m) in lines else ""  # 813 of the 2,064 recordings have no line
    return {"speaker_id": stem(m).split("_")[1], "transcript": t, "text": speech("Sinhala", t)}

@rule
def tacos(m, root):
    t = table(root / "annotations_weak.csv", "filename")[Path(m["path"]).name]["text"]
    return {"freesound_id": int(stem(m)), "text": t}

@rule
def usda_insect_sounds(m, root):
    page = (root / "soundlibrary.html").read_text(encoding="latin-1")
    seg = re.split(r"<br|</td>", page.split(f'href="{Path(m["path"]).name}"', 1)[1].split(">", 1)[1], maxsplit=1)[0]
    return {"text": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", seg))).split(" [")[0].strip()}

@rule
def vystadial_czech_english_dialogues(m, root):
    lang = {"data_voip_cs": "Czech", "data_voip_en": "English"}[Path(m["path"]).parts[0]]
    t = sidecar(m, root, ".wav.trn")
    return {"language": lang, "transcript": t, "text": speech(lang, t)}

@cache
def thuyg20_trans(root):
    return {Path(k).stem: v.strip() for s in ("train", "cv", "test") for k, v in pairs(root / f"data_thuyg20/trans/trans.{s}", " ").items()}

@rule
def thuyg20(m, root):
    subset = Path(m["path"]).parts[0]
    t = thuyg20_trans(root)[stem(m)] if subset == "data_thuyg20" else ""  # the speaker-recognition pack has no transcripts
    return {"subset": subset, "speaker_id": stem(m).split("_")[0], "transcript": t, "text": speech("Uyghur", t)}

@cache
def acm_mirum_tempo(root):
    return {r["REF-ITEM+7Digital-ID"].rsplit("-", 1)[1]: r for r in table(root / "dataset-acm_mirum-HEAD/acm-mirum2012-testset.txt", "REF-ITEM+7Digital-ID", "\t").values()}

@rule
def acm_mirum(m, root):
    r = acm_mirum_tempo(root)[stem(m).removesuffix(".clip")]
    song = r["REF-ITEM+7Digital-ID"].removeprefix("track-").rsplit("-", 1)[0].replace("+", " ")
    bpm = float(r["REF-TEMPO"])
    return {"song": song, "tempo_bpm": bpm, "text": f"Music excerpt ({song}) with a tempo of {bpm:g} BPM"}

@cache
def captdure_captions(root):
    caps = {}
    for f in ("single_source_caption.csv", "mixture_source_caption.csv"):
        with open(root / f, encoding="utf-8-sig", newline="") as h:
            for _, wav, _, en in list(csv.reader(h, delimiter="\t"))[1:]:
                caps.setdefault(Path(wav).name, []).append(en)
    return caps

@rule
def captdure(m, root):
    caps = captdure_captions(root)[Path(m["path"]).name]
    return {"captions": caps, "text": caps[0]}

# Emotional/ sentence ids 1-100, 101-200, 201-300, 301-400
CSD_KOREAN_EMO = ("neutral", "happy", "angry", "sad")

@rule
def csd_korean(m, root):
    p = root / m["path"]
    t = (p.parent.parent / "transcript" / f"{p.stem}.txt").read_text(encoding="utf-8-sig").strip()
    emo = {"emotion": CSD_KOREAN_EMO[(int(p.stem[3:]) - 1) // 100]} if "/Emotional/" in m["path"] else {}
    return {"speaker": p.stem[:3], "transcript": t, **emo, "text": speech("Korean", t)}

COCHLSCENE_PLACE = {"Bus": "inside a bus", "Cafe": "a cafe", "Car": "inside a car", "CrowdedIndoor": "a crowded indoor space",
                    "Elevator": "inside an elevator", "Kitchen": "a kitchen", "Park": "a park", "ResidentialArea": "a residential area",
                    "Restaurant": "a restaurant", "Restroom": "a restroom", "Street": "a street", "Subway": "inside a subway train",
                    "SubwayStation": "a subway station"}

@rule
def cochlscene(m, root):
    return {"scene": folder(m), "split": folder(m, 2), "text": f"Acoustic scene recording from {COCHLSCENE_PLACE[folder(m)]}"}

DCASE23_MACHINE = {"ToyCar": "toy car", "ToyTrain": "toy train", "bearing": "bearing", "fan": "fan", "gearbox": "gearbox",
                   "slider": "slide rail", "valve": "valve"}

@rule
def dcase23_task2(m, root):
    machine, split = folder(m, 2), folder(m)
    _, section, domain, split_, cond, idx, *attrs = stem(m).split("_")
    assert split_ == split and cond in ("normal", "anomaly"), m["path"]
    how = "normal operation" if cond == "normal" else "an anomalous (faulty) condition"
    return {"machine_type": machine, "section": section, "domain": domain, "condition": cond, "attributes": "_".join(attrs), "split": split,
            "text": f"Operating sound of a {DCASE23_MACHINE[machine]} with factory background noise, {how} ({domain} domain, DCASE 2023 Task 2)."}

@rule
def e_gmd(m, root):
    r = table(root / "e-gmd-v1.0.0/e-gmd-v1.0.0.csv", "audio_filename")[m["path"].removeprefix("e-gmd-v1.0.0/")]
    genre = words(r["style"].partition("/")[0])
    return {"drummer": r["drummer"], "style": r["style"], "bpm": int(r["bpm"]), "beat_type": r["beat_type"], "kit_name": r["kit_name"],
            "split": r["split"], "text": f'An electronic drum kit performance: {r["drummer"]} plays a {r["bpm"]} BPM {genre} {r["beat_type"]} in '
                                         f'{r["time_signature"].replace("-", "/")} time, rendered with the "{r["kit_name"]}" drum kit sound.'}

@rule
def groovemd(m, root):
    r = table(root / "groove/info.csv", "audio_filename")[m["path"].removeprefix("groove/")]
    return {"drummer": r["drummer"], "style": r["style"], "bpm": int(r["bpm"]), "beat_type": r["beat_type"], "split": r["split"],
            "text": f"Drum performance in {r['style'].lower()} style at {r['bpm']} BPM"}

@cache
def inatsounds_clips(root):
    out = {}
    for s in ("train", "val", "test"):
        d = json.loads((root / f"{s}.json").read_text())
        lic, cat, aud = {x["id"]: x["url"] for x in d["licenses"]}, {c["id"]: c for c in d["categories"]}, {a["id"]: a for a in d["audio"]}
        out |= {aud[a["audio_id"]]["file_name"]: (cat[a["category_id"]], aud[a["audio_id"]], lic) for a in d["annotations"]}
    return out

@rule
def inatsounds(m, root):
    c, a, lic = inatsounds_clips(root)[m["path"]]
    name = f"{c['name']} ({c['common_name']})" if c["common_name"] else c["name"]
    return {"species": c["name"], "common_name": c["common_name"], "supercategory": c["supercategory"], "rights_holder": a["rights_holder"],
            "licence_url": lic[a["license"]], "text": f"{name} vocalization"}

@rule
def isolated_urban_sound(m, root):
    name = re.fullmatch(r"([A-Za-z_]+?)(?:_bg)?\d+\.?", stem(m)).group(1)
    label = words(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)).lower()
    what = {"event": "sound", "background": "background ambience"}[folder(m)]
    return {"label": label, "kind": folder(m), "text": f"{label.capitalize()} {what}"}

@cache
def macs_files(root):
    return {f["filename"]: f["annotations"] for f in yaml.safe_load((root / "MACS.yaml").read_text())["files"]}

@rule
def macs(m, root):
    a = macs_files(root)[Path(m["path"]).name]
    return {"scene_label": Path(m["path"]).name.split("-")[0], "captions": [x["sentence"] for x in a],
            "tags": sorted({t for x in a for t in x["tags"]}), "text": a[0]["sentence"]}

def mir_1k_lyrics(p):
    return p.read_text(encoding="big5").strip().replace("_", " ")

@rule
def mir_1k(m, root):
    if folder(m) == "LyricsWav":
        song = stem(m).rsplit("_", 1)[0]
        t = " ".join(mir_1k_lyrics(p) for p in sorted((root / "MIR-1K/Lyrics").glob(f"{song}_*.txt", case_sensitive=False)))
        assert t, m["path"]
        return {"lyrics": t, "text": speech("Chinese", t)}
    t = mir_1k_lyrics(root / "MIR-1K/Lyrics" / f"{stem(m)}.txt")
    return {"lyrics": t, "text": f'Chinese karaoke singing with instrumental accompaniment, lyrics: "{t}"'}

@rule
def mridangam_tani_avarthanam(m, root):
    p = root / m["path"]
    lab, = p.parent.parent.glob(f"label*/{p.stem.split('_', 2)[2]}.txt")
    bol = lab.read_text().strip()
    text = "A mridangam tani-avarthanam phrase performed by Umayalpuram K. Sivaraman"
    return {"tani_label_transcription": bol, "text": f"{text}. Bol transcription: {bol}." if bol else f"{text}."}

OPENSET_UNWANTED = {"car_horn": "a car horn", "clapping": "clapping", "cough": "coughing", "door_slam": "a door slamming",
                    "engine": "an engine", "keyboard_tap": "keyboard tapping", "music": "music playing", "pots_and_pans": "pots and pans",
                    "steps": "footsteps", "water": "water running"}

@rule
def openset_fewshot_audio(m, root):
    c = folder(m)
    if folder(m, 2) == "pattern_sounds":
        return {"class": c, "text": f"Pattern sound category {c.removeprefix('pattern_')} from domestic alarm classification"}
    return {"class": c, "text": f"Sound of {OPENSET_UNWANTED[c]}"}

REEFSET_PLACE = {"belize": "Belize", "bermuda": "Bermuda", "florida_boats": "Florida", "florida_cmi": "Florida", "hawaii_himb": "Hawaii",
                 "hawaii_kaneohe": "Hawaii", "indonesia_bombs": "Indonesia", "kenya": "Kenya", "mozambique": "Mozambique",
                 "palmyra_hydromoth": "Palmyra Atoll", "palmyra_other": "Palmyra Atoll", "philippines_cmi": "the Philippines",
                 "tanzania": "Tanzania", "thailand": "Thailand", "usvi_butler-bay": "the US Virgin Islands", "usvi_stcroix": "the US Virgin Islands"}
# label prefix of the 37 ReefSet classes (ambient, anthrop_*, bioph[_*], geoph_*)
REEFSET_KIND = {"ambient": "the ambient reef soundscape with no distinct sound event", "anthrop": "a human-made sound",
                "bioph": "a fish or invertebrate sound", "geoph": "a geophysical sound"}

@rule
def reefset(m, root):
    _, ds, sharer, label = stem(m).split(".")
    kind, _, what = label.partition("_")
    sound = REEFSET_KIND[kind] + (f' of the type "{words(what)}"' if what else "")
    return {"label": label, "dataset": ds, "data_sharer": sharer, "location": REEFSET_PLACE[ds],
            "text": f"A short underwater hydrophone recording from a coral reef in {REEFSET_PLACE[ds]} with {sound}."}

@rule
def speech_accent(m, root):
    r = table(root / "speakers_all.csv", "filename")[stem(m)]
    passage = " ".join((root / "reading-passage.txt").read_text().split())
    where = f" from {r['country']}" if r["country"] else ""
    return {"native_language": r["native_language"], "country": r["country"], "birthplace": r["birthplace"], "sex": r["sex"], "age": r["age"],
            "transcript": passage, "text": f'English speech with {r["native_language"]} accent{where}: "{passage}"'}

TUT2017_SCENE = {"bus": "Ambient sounds recorded inside a bus traveling in the city",
                 "cafe/restaurant": "Ambient sounds recorded in a small cafe or restaurant",
                 "car": "Ambient sounds recorded inside a car, driving or traveling as a passenger in the city",
                 "city_center": "Ambient sounds recorded outdoors in a city center",
                 "forest_path": "Ambient sounds recorded outdoors on a forest path",
                 "grocery_store": "Ambient sounds recorded in a medium size grocery store",
                 "home": "Ambient sounds recorded at home indoors", "beach": "Ambient sounds recorded outdoors at a lakeside beach",
                 "library": "Ambient sounds recorded in a library", "metro_station": "Ambient sounds recorded at a metro station",
                 "office": "Ambient sounds recorded in an office with multiple persons during a typical work day",
                 "residential_area": "Ambient sounds recorded outdoors in a residential area",
                 "train": "Ambient sounds recorded while traveling inside a train",
                 "tram": "Ambient sounds recorded while traveling inside a tram",
                 "park": "Ambient sounds recorded outdoors in an urban park"}

@rule
def tut2017(m, root):
    scene, location = pairs(root / "TUT-acoustic-scenes-2017-development/meta.txt", "\t")[f"audio/{Path(m['path']).name}"].split("\t")
    return {"scene": scene, "location": location, "text": TUT2017_SCENE[scene]}

@rule
def turkish_makam_acapella_sections(m, root):
    name = words(re.sub(r"^\d+_|_from_.*$", "", stem(m)))
    return {"singer": folder(m), "section": name, "text": f"Solo a cappella Turkish makam singing by {folder(m)}: {name}"}

@rule
def vad_multi_species(m, root):
    sp = json.loads(sidecar(m, root, ".json"))["species"]
    return {"species": sp, "text": f"A recording of a {words(sp)}"}

@cache
def wavcaps_captions(root):
    return {(f.parent.name, Path(d["id"]).stem): d["caption"]
            for f in root.glob("json_files/*/*_final.json") for d in json.loads(f.read_text())["data"]}

@rule
def wavcaps(m, root):
    origin = folder(m).removesuffix("_flac")
    return {"origin": origin, "text": wavcaps_captions(root)[origin, stem(m)]}

ALFFA_LANG = {"data_readspeech_am": "Amharic", "data_broadcastnews_sw": "Swahili", "data_readspeech_wo": "Wolof"}

@rule
def alffa(m, root):
    p = Path(m["path"])
    split = p.parts[:p.parts.index("data") + 2]
    t = pairs(root.joinpath(*split, "text"))[p.stem].strip()
    return {"language": ALFFA_LANG[p.parts[0]], "split": split[-1], "transcript": t, "text": speech(ALFFA_LANG[p.parts[0]], t)}

# Turkish folder names of the Kaggle Animal-Sound-Dataset
ANIMALS_SOUND = {"Aslan": "lion", "Esek": "donkey", "Inek": "cow", "Kedi": "cat", "Kopek": "dog", "Koyun": "sheep", "Kurbaga": "frog",
                 "Kus": "bird", "Maymun": "monkey", "Tavuk": "chicken"}

@rule
def animals_sound(m, root):
    animal = ANIMALS_SOUND[folder(m)]
    return {"animal_species": animal, "text": f"A recording of a {animal} animal sound"}

@cache
def bd4sk_kurdish_trans(root):
    with open(root / "BD-4SK-ASR-HEAD/KSTT_train.transcription", encoding="utf-8") as f:
        return dict(re.fullmatch(r"<s> (.*) </s> \((\S+)\)", l.strip()).groups()[::-1] for l in f if l.strip())

@rule
def bd4sk_kurdish(m, root):
    t = bd4sk_kurdish_trans(root)[stem(m)]
    return {"transcript_romanized": t, "text": f'A speaker reading a Central Kurdish (Sorani) sentence, transliterated as "{t.lower()}".'}

@rule
def birdclef_2022(m, root):
    r = table(root / "train_metadata.csv", "filename")[m["path"].removeprefix("train_audio/")]
    return {"primary_label": r["primary_label"], "secondary_labels": r["secondary_labels"], "type": r["type"], "common_name": r["common_name"],
            "scientific_name": r["scientific_name"], "author": r["author"], "licence_url": r["license"], "url": r["url"],
            "text": f"A field recording of a {r['common_name']} ({r['scientific_name']}) from the Kaggle BirdCLEF 2022 dataset, "
                    f"source Xeno-Canto recording {stem(m)}"}

@cache
def cmu_an4_trans(root):
    out = {}
    for s in ("train", "test"):
        with open(root / f"an4-HEAD/etc/an4_{s}.transcription", encoding="utf-8") as f:
            out |= {u: t for t, u in (re.fullmatch(r"(?:<s> )?(.*?)(?: </s>)? \((\S+)\)", l.strip()).groups() for l in f if l.strip())}
    return out

@rule
def cmu_an4(m, root):
    t = cmu_an4_trans(root)[stem(m)]
    return {"speaker_id": folder(m), "transcript": t, "text": speech("English", t)}

@cache
def commonvoice_22_0_languages(root):
    return ast.literal_eval((root / "languages.py").read_text().split("=", 1)[1])

@cache
def commonvoice_22_0_rows(root, locale, split):
    with open(root / f"transcript/{locale}/{split}.tsv", encoding="utf-8", newline="") as f:
        return {r["path"]: r for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}

@rule
def commonvoice_22_0(m, root):
    _, locale, split, *_ = m["path"].split("/")
    r = commonvoice_22_0_rows(root, locale, split)[f"{Path(m['path']).name}.mp3"]
    return {"locale": locale, "split": split, "client_id": r["client_id"], "sentence_id": r["sentence_id"], "age": r["age"],
            "gender": r["gender"], "accents": r["accents"], "up_votes": r["up_votes"], "down_votes": r["down_votes"],
            "transcript": r["sentence"], "text": speech(commonvoice_22_0_languages(root)[locale], r["sentence"])}

ENGLISH_DIALECTS = {"ir": "Irish", "mi": "Midlands", "no": "Northern", "sc": "Scottish", "so": "Southern", "we": "Welsh"}

@rule
def english_dialects(m, root):
    name = Path(m["path"]).name
    dialect, sex = ENGLISH_DIALECTS[name[:2]], {"m": "male", "f": "female"}[name[2]]
    return {"dialect": dialect.lower(), "gender": sex, "transcript": m["text"],
            "text": f'Speech in English, {dialect.lower()} dialect by a {sex} speaker: "{m["text"]}"'}

@cache
def human_vocality_primitives_meta(root):
    return {k: r for f in root.glob("*Metadata*.csv") for k, r in table(f, "file_name").items()}

@rule
def human_vocality_primitives(m, root):
    r = human_vocality_primitives_meta(root)[Path(m["path"]).name]
    return {"phonation_type": r["phonation_type"], "airflow_type": r["airflow_type"], "gesture_type": r["gesture_type"], "text": r["content"]}

@rule
def kaggle_ai_mechanic(m, root):
    label = stem(m).split(".")[0].lower()
    return {"label": label, "split": folder(m), "text": f"An engine fault diagnostic audio recording labelled '{label}'"}

@rule
def kaggle_submarine_sonar(m, root):
    c = re.sub(r"-samples.*$", "", folder(m))
    return {"sonar_class": c, "text": f"A sonar recording: {c.lower()}"}

@rule
def ljspeech(m, root):
    raw, norm = pairs(root / "LJSpeech-1.1/metadata.csv", "|")[stem(m)].split("|")
    return {"raw_text": raw, "transcript": norm, "speaker": "LJ", "text": speech("English", norm)}

@cache
def mlsp_2013_bird_labels(root):
    d = root / "mlsp_contest_dataset/essential_data"
    names = {r["rec_id"]: r["filename"] for r in table(d / "rec_id2filename.txt", "rec_id").values()}
    species = {r["class_id"]: r["species"] for r in table(d / "species_list.txt", "class_id").values()}
    rows = [l.strip().split(",") for l in (d / "rec_labels_test_hidden.txt").read_text().splitlines()[1:] if l.strip()]
    return {Path(names[r[0]]).stem: None if r[1:] == ["?"] else [species[c] for c in r[1:] if c] for r in rows}

@rule
def mlsp_2013_bird(m, root):
    sp = mlsp_2013_bird_labels(root)[stem(m)]
    return {"species": sp, "text": f"A field recording with calls of {', '.join(sp)}" if sp else ""}

MEDIASPEECH_LANG = {"AR": "Arabic", "ES": "Spanish", "FR": "French", "TR": "Turkish"}

@rule
def mediaspeech(m, root):
    t, lang = sidecar(m, root, ".txt"), MEDIASPEECH_LANG[folder(m)]
    return {"language": lang, "transcript": t, "text": speech(lang, t)}

@rule
def openslr_112_samromur_icelandic(m, root):
    r = table(root / "metadata.tsv", "filename", "\t")[Path(m["path"]).name]
    return {"speaker_id": r["speaker_id"], "gender": r["gender"], "age": r["age"], "transcript": r["sentence_norm"],
            "text": speech("Icelandic", r["sentence_norm"])}

@rule
def openslr_142_mc_speech(m, root):
    t = pairs(root / "mcspeech/transcripts.tsv", "\t")[stem(m)].strip()
    return {"transcript": t, "text": speech("Polish", t)}

@rule
def openslr_58_pansori_tedxkr(m, root):
    p = root / m["path"]
    t = pairs(p.parent / f"{p.stem.rsplit('-', 1)[0]}.trans.txt")[p.stem].strip()
    return {"speaker": folder(m, 2), "video_id": folder(m), "transcript": t, "text": speech("Korean", t)}

@cache
def primewords_chinese_meta(root):
    return {r["file"]: r for r in json.loads((root / "primewords_md_2018_set1/set1_transcript.json").read_text())}

@rule
def primewords_chinese(m, root):
    r = primewords_chinese_meta(root)[Path(m["path"]).name]
    return {"speaker_id": r["user_id"], "utterance_id": r["id"], "transcript": r["text"], "text": speech("Chinese", r["text"])}

@cache
def saspeech_automatic(root):
    lines = {}
    with open(root / "saspeech_automatic_data/metadata.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter="|", quoting=csv.QUOTE_NONE):
            lines.setdefault(r["file_id"], []).append((float(r["start_time"]), r["transcript"]))
    return {k: " ".join(t for _, t in sorted(v)) for k, v in lines.items()}

@rule
def saspeech(m, root):
    subset = folder(m, 2)
    t = (pairs(root / "saspeech_gold_standard/metadata.csv", "|")[stem(m)].split("|")[0] if subset == "saspeech_gold_standard"
         else saspeech_automatic(root)[stem(m)])
    return {"subset": subset, "transcript": t, "text": speech("Hebrew", t)}

@rule
def tau_sebin_2021(m, root):
    p = Path(m["path"])
    ev = list(csv.DictReader((root / "metadata" / p.parent.name / f"{p.stem}.csv").read_text().splitlines()))
    labs = list(dict.fromkeys(r["sound_event_recording"] for r in ev))
    return {"subset": p.parent.name, "labels": labs, "events": ev,
            "text": f"A synthetic binaural recording of sound events in a simulated room: {', '.join(labs) if labs else 'no events'}."}

TORGO_MIC = {"head": "head-mounted microphone", "array": "array microphone"}

@rule
def torgo(m, root):
    spk, ses, mdir, f = m["path"].split("/")
    p = root / spk / ses / "prompts" / f"{Path(f).stem}.txt"
    pr = p.read_text(encoding="utf-8", errors="replace").strip() if p.exists() else None
    gender, control, mic = "female" if spk[0] == "F" else "male", "C" in spk, mdir.split("_")[1][:-3]
    who = f"A {gender} speaker " + ("without dysarthria (control)" if control else "with dysarthria (cerebral palsy or ALS)")
    said = ("speaking (no prompt file for this recording)" if pr is None else "describing a picture" if pr.startswith("input/images/")
            else f"performing a non-word task: {pr.strip('[]')}" if pr.startswith("[") else f'saying: "{pr}"')
    return {"speaker_id": spk, "gender": gender, "condition": "control" if control else "dysarthric", "session": ses, "mic_type": mic,
            "prompt": pr, "text": f"{who} {said} ({TORGO_MIC[mic]})."}

# Ukrainian_STT folders without etc/txt.done.data (first 3, 614 recordings) or with 250 recordings missing from it
UKRAINIAN_STT_GAPS = {"16142076537800", "16142472703788", "16142476907527", "16142418568060", "16143326670302", "16143326696532", "16143326774787",
                      "16143327138002", "16143327949694"}

@cache
def ukrainian_stt_lines(path):
    """Lines `<audio path>.wav text`; the paths may hold spaces."""
    with open(path, encoding="utf-8") as f:
        return {f"{k}.wav": v.strip() for k, v in (l.split(".wav", 1) for l in f if l.strip())}

@rule
def ukrainian_stt(m, root):
    p = Path(m["path"])
    gap, f = p.parts[-3] in UKRAINIAN_STT_GAPS, root / p.parent.parent / "etc/txt.done.data"
    d = ukrainian_stt_lines(f) if f.exists() or not gap else {}
    key = ("/" + "/".join(p.parts[1:])).encode("cp437").decode("utf-8")  # zipfile unpacks the zip's UTF-8 names as cp437
    t = d[key] if key in d or not gap else ""
    return {"speaker_id": p.stem.split("_")[2], "source_category": p.parts[-4], "transcript": t, "text": speech("Ukrainian", t)}

@rule
def aed(m, root):
    event = words(stem(m).rsplit("_", 1)[0])
    return {"event": event, "text": f"Sound of {event}"}

@rule
def css10(m, root):
    ds, rel = m["path"].split("/", 1)
    transcript = pairs(root / ds / "transcript.txt", "|")[rel].split("|")[0]
    language = ds.split("-")[0].title()
    return {"language": language.lower(), "transcript": transcript, "text": speech(language, transcript)}

@rule
def cornell_bird_identification(m, root):
    r = table(root / "train.csv", "filename")[Path(m["path"]).name]
    assert r["ebird_code"] == folder(m)
    parts = [f"{r['species']} ({r['sci_name']})", r["type"] and f"vocalization type: {r['type']}",
             r["location"].strip() and f"recorded at {r['location'].strip()}", r["description"] != "Not specified" and r["description"][:200]]
    keep = ("species", "sci_name", "ebird_code", "type", "location", "country", "latitude", "longitude", "rating", "license", "xc_id", "url")
    return {**{k: r[k] for k in keep}, "text": ". ".join(p for p in parts if p)}

DCASE5_LABELS = {"Speech": "speech", "Dishes": "dishes", "AlarmClock": "alarm clock", "FootSteps": "footsteps", "Doorbell": "doorbell"}

@cache
def _dcase5_mixtures(root):
    with open(root / "metadata/mixtures_metadata.jsonl") as f:
        return {j["mixture_path"]: [e["label"] for e in j["fg_events"]] for j in map(json.loads, f)}

@rule
def dcase_5class_separation(m, root):
    kind = m["path"].split("/")[0]
    if kind == "noise":
        return {"text": "Background noise"}
    labels = [DCASE5_LABELS[l] for l in (_dcase5_mixtures(root)[m["path"]] if kind == "mixtures" else [folder(m)])]
    return {"labels": labels, "text": f"Audio mixture with {', '.join(labels)}" if kind == "mixtures" else f"Sound of {labels[0]}"}

@rule
def fma(m, root):
    r = table(root / "fma_metadata/raw_tracks.csv", "track_id")[str(int(stem(m)))]
    genres = [g["genre_title"] for g in ast.literal_eval(r["track_genres"])] if r["track_genres"] else []
    head = " ".join(filter(None, [f'"{r["track_title"]}"' if r["track_title"] else "A track", r["artist_name"] and f"by {r['artist_name']}",
                                  r["album_title"] and f'from the album "{r["album_title"]}"']))
    desc = " ".join(filter(None, ["instrumental" if r["track_instrumental"] == "1" else "", ", ".join(genres), "music track"]))
    return {"track_id": int(stem(m)), "title": r["track_title"], "artist": r["artist_name"], "album": r["album_title"], "genres": genres,
            "licence_url": r["license_url"], "text": f"{head}, {'an' if desc[0].lower() in 'aeiou' else 'a'} {desc}."}

GUITARSET_STYLE = {"BN": "bossa nova", "Funk": "funk", "Jazz": "jazz", "Rock": "rock", "SS": "singer-songwriter"}
GUITARSET_REC = {"mic": "microphone", "mix": "pickup mix", "hex_cln": "hexaphonic pickup"}

@rule
def guitarset(m, root):
    player, piece, mode, rec = stem(m).split("_", 3)
    style, tempo, key = piece.split("-")
    style = GUITARSET_STYLE[style.rstrip("0123456789")]
    return {"player": player, "style": style, "tempo": int(tempo), "key": key, "mode": mode, "recording": GUITARSET_REC[rec],
            "text": f"Acoustic guitar {'comping' if mode == 'comp' else 'solo'} in {style} style, key of {key}, {tempo} BPM ({GUITARSET_REC[rec]})"}

IRMAS_INST = {"cel": "cello", "cla": "clarinet", "flu": "flute", "gac": "acoustic guitar", "gel": "electric guitar", "org": "organ",
              "pia": "piano", "sax": "saxophone", "tru": "trumpet", "vio": "violin", "voi": "singing voice"}
IRMAS_GENRE = {"cou_fol": "country-folk", "cla": "classical", "pop_roc": "pop-rock", "lat_sou": "latin-soul", "jaz_blu": "jazz-blues"}
IRMAS_DRUMS = {"dru": ", with drums", "nod": ", without drums"}

@rule
def irmas(m, root):
    if "TrainingData" in m["path"]:
        tags = re.findall(r"\[(\w+?)\]", stem(m))
        inst, genre = IRMAS_INST[tags[0]], IRMAS_GENRE[tags[-1]]
        drums = IRMAS_DRUMS[tags[1]] if len(tags) == 3 else ""
        return {"instrument": inst, "genre": genre, "text": f"A 3-second excerpt of {genre} music in which the {inst} is the predominant instrument{drums}."}
    insts = [IRMAS_INST[c] for c in sidecar(m, root, ".txt").split()]
    return {"instruments": insts, "text": f"An excerpt of music featuring {', '.join(insts)}."}

JGDB_GM = (
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2",
    "Harpsichord", "Clavinet", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)",
    "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics", "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)",
    "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass",
    "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani", "String Ensemble 1", "String Ensemble 2", "Synth Strings 1",
    "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit", "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
    "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2", "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe",
    "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)",
    "Lead 8 (bass + lead)", "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)",
    "Pad 7 (halo)", "Pad 8 (sweep)", "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)",
    "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal", "Guitar Fret Noise",
    "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot")
JGDB_SYNTH = {"fluid128": "Timidity++ and the FluidR3 GM soundfont", "win128": "Microsoft DirectMusic"}

@rule
def jgdb(m, root):
    synth, variant, program = JGDB_SYNTH[folder(m, 2)], folder(m), int(stem(m).rsplit("testfile", 1)[1])
    tempo = "" if variant == "orig" else f", with its tempo changing every 2 s by up to {10 * int(variant[3])}% (stretch curve {variant[1]})"
    return {"gm_program": program, "instrument": JGDB_GM[program], "synthesizer": synth, "tempo_variant": variant,
            "text": f"A random sequence of short notes played on a synthesized General MIDI {JGDB_GM[program]} (program {program}), rendered with {synth}{tempo}."}

MAD_CLASSES = ("Communication", "Gunshot", "Footsteps", "Shelling", "Vehicle", "Helicopter", "Fighter")

@rule
def mad_military(m, root):
    p = Path(m["path"])
    r = table(root / p.parents[2] / f"{p.parts[-3]}.csv", "path")["/".join(p.parts[-3:])]
    return {"label": MAD_CLASSES[int(r["label"])], "youtube_title": r["youtube title"], "youtube_url": r["youtube url"], "text": MAD_CLASSES[int(r["label"])]}

@rule
def ms_snsd(m, root):
    if folder(m).startswith("clean"):
        return {"text": "Clean speech recording of a person speaking"}
    noise = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", re.sub(r"_?\d+$", "", stem(m))).lower()
    return {"noise_type": noise, "text": f"Environmental noise recording of {noise}"}

NABAT_SPECIES = {"ANPA": ("Antrozous pallidus", "Pallid bat"), "CORA": ("Corynorhinus rafinesquii", "Rafinesque's big-eared bat"),
                 "COTO": ("Corynorhinus townsendii", "Townsend's big-eared bat"), "EPFU": ("Eptesicus fuscus", "Big brown bat"),
                 "EUFL": ("Eumops floridanus", "Florida bonneted bat"), "EUMA": ("Euderma maculatum", "Spotted bat"),
                 "EUPE": ("Eumops perotis", "Greater mastiff bat"), "IDPH": ("Idionycteris phyllotis", "Allen's big-eared bat"),
                 "LABL": ("Lasiurus blossevillii", "Western red bat"), "LABO": ("Lasiurus borealis", "Eastern red bat"),
                 "LACI": ("Lasiurus cinereus", "Hoary bat"), "LAIN": ("Lasiurus intermedius", "Northern yellow bat"),
                 "LANO": ("Lasionycteris noctivagans", "Silver-haired bat"), "LASE": ("Lasiurus seminolus", "Seminole bat"),
                 "LAXA": ("Lasiurus xanthinus", "Western yellow bat"), "MYAU": ("Myotis austroriparius", "Southeastern myotis"),
                 "MYCA": ("Myotis californicus", "California bat"), "MYCI": ("Myotis ciliolabrum", "Western small-footed myotis"),
                 "MYEV": ("Myotis evotis", "Western long-eared bat"), "MYGR": ("Myotis grisescens", "Gray bat"),
                 "MYLE": ("Myotis leibii", "Eastern small-footed bat"), "MYLU": ("Myotis lucifugus", "Little brown bat"),
                 "MYSE": ("Myotis septentrionalis", "Northern long-eared bat"), "MYSO": ("Myotis sodalis", "Indiana bat"),
                 "MYTH": ("Myotis thysanodes", "Fringed bat"), "MYVE": ("Myotis velifer", "Cave bat"),
                 "MYVO": ("Myotis volans", "Long-legged bat"), "MYYU": ("Myotis yumanensis", "Yuma bat"),
                 "NYFE": ("Nyctinomops femorosaccus", "Pocketed free-tailed bat"), "NYHU": ("Nycticeius humeralis", "Evening bat"),
                 "NYMA": ("Nyctinomops macrotis", "Big free-tailed bat"), "PAHE": ("Parastrellus hesperus", "Canyon bat"),
                 "PESU": ("Perimyotis subflavus", "Tricolored bat"), "TABR": ("Tadarida brasiliensis", "Brazilian free-tailed bat")}

@rule
def nabat(m, root):
    code = stem(m).split("-")[0]
    if code == "NOISE":
        return {"species_code": code, "text": "Noise/background recording without a bat call"}
    species, common = NABAT_SPECIES[code]
    return {"species_code": code, "species": species, "common_name": common, "text": f"{species} ({common}) bat echolocation call"}

SINGAPURA_COARSE = {"1": "engine", "2": "machinery impact", "3": "non-machinery impact", "4": "powered saw", "5": "alert signal", "6": "music",
                    "7": "human voice", "8": "human movement", "9": "animal", "10": "water", "11": "weather", "12": "brake", "13": "train"}
# 13-2 occurs in labels_public.csv but not in the published taxonomy
SINGAPURA_FINE = {
    "1-1": "small engine", "1-2": "medium engine", "1-3": "large engine", "2-1": "rock drill", "2-2": "jackhammer", "2-3": "hoe ram",
    "2-4": "pile driver", "3-1": "glass breaking", "3-2": "car crash", "3-3": "explosion", "4-1": "chainsaw", "4-2": "small/medium rotating saw",
    "4-3": "large rotating saw", "5-1": "car horn", "5-2": "car alarm", "5-3": "siren", "5-4": "reverse beeper", "6-1": "stationary music",
    "6-2": "mobile music", "7-1": "talking", "7-2": "shouting", "7-3": "large crowd", "7-4": "amplified speech", "7-5": "singing",
    "8-1": "footsteps", "8-2": "clapping", "9-1": "dog barking", "9-2": "bird chirping", "9-3": "insect chirping", "10-1": "hose pump",
    "11-1": "rain", "11-2": "thunder", "11-3": "wind", "12-1": "friction brake", "12-2": "exhaust brake", "13-1": "electric train",
    "13-2": "train", "X-1": "screeching", "X-2": "plastic crinkling", "X-3": "cleaning", "X-4": "gear"}
SINGAPURA_DAY = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
SINGAPURA_MONTH = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

@cache
def _singapura_events(root):
    events = {}
    with open(root / "labels_public.tab", newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            events.setdefault(r["filename"], []).append(r)
    return events

def _singapura_name(code):
    coarse, fine = code.split("-")
    return f"{SINGAPURA_COARSE[coarse]} (unspecified)" if fine == "X" else SINGAPURA_FINE[code]

@rule
def singapura(m, root):
    split = m["path"].split("/")[0]
    r = table(root / f"{split}_metadata_public.tab", "filename")[Path(m["path"]).name]
    when = (f"on {SINGAPURA_DAY[int(r['day'])]} {r['date']} {SINGAPURA_MONTH[int(r['month']) - 1]} {r['year']} "
            f"at {int(r['hour']):02d}:{int(r['minute']):02d} Singapore time")
    meta = {"sensor_id": r["sensor_id"], "town": r["town"], "split": split}
    if split == "unlabelled":
        return {**meta, "text": f"A 10-second urban sound recording from acoustic sensor {r['sensor_id']} in {r['town']}, Singapore, {when}."}
    ev = sorted(_singapura_events(root)[r["filename"]], key=lambda e: (float(e["onset"]), int(e["annotator"])))
    heard = list(dict.fromkeys(f"{_singapura_name(e['event_label'])} ({e['proximity']})" for e in ev if e["event_label"] != "0-0"))
    said = f"Annotated sound events: {', '.join(heard)}." if heard else "The annotators heard none of the labelled urban sound classes."
    return {**meta, "events": [{k: e[k] for k in ("annotator", "event_label", "proximity", "onset", "offset")} for e in ev],
            "text": f"A 10-second urban sound recording from an acoustic sensor in {r['town']}, Singapore, {when}. {said}"}

@rule
def taffc(m, root):
    r = table(root / "panda_dataset_taffc_metadata.csv", "Song")[stem(m)]
    genre, moods = r["GenresStr"].split(";")[0].strip().lower(), r["MoodsStr"].replace(";", ",").lower()
    return {"artist": r["Artist"], "title": r["Title"], "quadrant": r["Quadrant"], "genres": r["GenresStr"], "moods": r["MoodsStr"],
            "text": f"'{r['Title']}' by {r['Artist']}, a {genre} track with {moods} mood"}

@rule
def tut_sound_events_2017(m, root):
    p = Path(m["path"])
    lines = (root / p.parents[2] / "meta/street" / f"{p.stem}.ann").read_text().splitlines()
    labels = list(dict.fromkeys(e[4] for e in sorted((l.split("\t") for l in lines if l.strip()), key=lambda e: float(e[2]))))
    return {"labels": labels, "text": f"Street scene with {', '.join(labels[:-1]) + ' and ' if len(labels) > 1 else ''}{labels[-1]}."}

SARKI_FORM = {"sarki": "şarkı", "turku": "türkü"}
SARKI_METU = str.maketrans("UOSCGI", "üöşçğı")

@rule
def turkish_sarki_vocal(m, root):
    makam, form, usul = Path(m["path"]).parts[1].split("--")[:3]
    section = re.search(r"_\d+_([a-z]+)\d*(?:_\d+)?_from_", stem(m)).group(1)
    lyrics_file = (root / m["path"]).with_suffix(".txtMETU")
    lyrics = lyrics_file.read_text(encoding="utf-8").strip().translate(SARKI_METU) if lyrics_file.exists() else ""
    text = f"A {section} section of a Turkish {SARKI_FORM[form]} in makam {makam} and usul {usul}"
    return {"makam": makam, "form": form, "usul": usul, "section": section, "lyrics": lyrics, "text": text + (f': "{lyrics}"' if lyrics else ".")}

VIS_ACTION = {"hit": "hitting", "scratch": "scratching"}

@rule
def visuallyindicatedsounds(m, root):
    rec = stem(m).rsplit("_", 1)[0]
    rows = [l.split() for l in (root / Path(m["path"]).parent / f"{rec}_times.txt").read_text().splitlines() if l.strip()]
    materials = list(dict.fromkeys(r[-3] for r in rows if r[-3] != "None"))
    actions = [VIS_ACTION[a] for a in VIS_ACTION if any(r[-2] == a for r in rows)]
    assert materials and actions, rec
    return {"recording_id": rec, "materials": materials, "actions": actions,
            "text": f"A person {' and '.join(actions)} {', '.join(materials)} with a drumstick"}

GIBBON_TEXT = {
    "gibbons": "Yellow-cheeked crested gibbon vocalization",
    "crestedgibbons": "Yellow-cheeked crested gibbon vocalization",
    "gibbon": "Crested gibbon vocalization of another gibbon species, recorded in Vietnam",
    "noise": "Tropical forest sounds without a gibbon call",
    "soundfiles": "Dawn soundscape of a tropical forest in Jahoo, Cambodia, from a passive acoustic monitoring recorder; "
                  "southern yellow-cheeked crested gibbons (Nomascus gabriellae) live here and may be calling."}

@rule
def yellow_cheeked_crested_gibbon(m, root):
    return {"label": folder(m), "text": GIBBON_TEXT[folder(m).lower()]}

JAZZNET_NAMES = {"maj": "major", "min": "minor", "aug": "augmented", "dim": "diminished", "dim7": "diminished seventh",
                 "maj7": "major seventh", "min7": "minor seventh", "seventh": "dominant seventh", "sixth": "sixth",
                 "min7b5": "half-diminished seventh", "sus2": "suspended second", "sus4": "suspended fourth", "ionian": "Ionian",
                 "dorian": "Dorian", "phrygian": "Phrygian", "lydian": "Lydian", "mixolydian": "Mixolydian", "aeolian": "Aeolian",
                 "locrian": "Locrian", "pentatonic": "pentatonic"}
JAZZNET_INTERVALS = {"min2": "minor second", "maj2": "major second", "min3": "minor third", "maj3": "major third", "perf4": "perfect fourth",
                     "tritone": "tritone", "perf5": "perfect fifth", "aug6": "augmented sixth", "min6": "minor sixth", "maj6": "major sixth",
                     "maj7_2": "major seventh", "octave": "octave"}

def _jazznet_an(word):
    return f"{'an' if word[0] in ('AEF' if word[0].isupper() else 'aeiou') else 'a'} {word}"

@rule
def jazznet(m, root):
    r = table(root / "full.csv", "name")[stem(m)]
    key, kind, mode = r["name"].split("-")[0], r["type"], r["mode"]
    meta = {"jazznet_id": int(r["id"]), "pattern_type": kind, "mode": mode, "key": key, "octave": int(r["octave"]),
            "inversion": int(r["inversion"]), "split": r["split"]}
    q = mode.rsplit("-", 1)[0]
    if kind == "progression":
        roman, quality = (mode[:-4], f" {'major' if mode.endswith('maj') else 'minor'}") if mode.endswith(("-maj", "-min")) else (mode, "")
        text = f"A solo piano plays the chord progression {roman} in {key}{quality}."
    elif q in JAZZNET_INTERVALS:
        text = f"A solo piano plays {_jazznet_an(JAZZNET_INTERVALS[q])} interval on {key}, two notes played {'together' if kind == 'chord' else 'one after the other'}."
    else:
        text = f"A solo piano plays {_jazznet_an(key)} {JAZZNET_NAMES[q]} {kind}, {'all notes together' if kind == 'chord' else 'one note at a time'}."
    return {**meta, "text": text}

@rule
def aru_english_liverpool(m, root):
    speaker, lst, sentence = re.fullmatch(r"(ID\d+)_ARU_.* - List (\d+) - Sentence (\d+) - Version .*", stem(m)).groups()
    return {"speaker_id": speaker, "harvard_list": int(lst), "harvard_sentence": int(sentence),
            "text": f"Speech in English: IEEE Harvard sentence {sentence} of list {lst}, read by speaker {speaker} in an anechoic room"}

@rule
def brspeech_df(m, root):
    if m["label"] == "bonafide":
        return {"text": "Bona fide speech in Portuguese"}
    return {"tts_model": m["model"], "text": f"Synthetic speech in Portuguese generated by the TTS system {m['model']}"}

@rule
def birdclef_2023(m, root):
    r = table(root / "train_metadata.csv", "filename")["/".join(Path(m["path"]).parts[-2:])]
    types = [t for t in ast.literal_eval(r["type"]) if t]
    keep = ("primary_label", "secondary_labels", "scientific_name", "common_name", "latitude", "longitude", "author", "license", "rating", "url")
    return {**{k: r[k] for k in keep}, "text": f"A recording of {r['common_name']} ({r['scientific_name']})" + (f": {', '.join(types)}" if types else "")}

@rule
def cn_celeb(m, root):
    speaker, genre = re.fullmatch(r"(?:(id\d+)-)?([a-z_]+)-\d+-\d+", stem(m)).groups()
    speaker = folder(m) if speaker is None else speaker
    return {"speaker_id": speaker, "genre": genre, "text": f"Chinese celebrity audio, genre: {words(genre)}"}

@rule
def commonvoice_en(m, root):
    split = folder(m)
    r = table(root / f"{split}.csv", "filename")[f"{split}/{Path(m['path']).name}"]
    return {**{k: r[k] for k in ("age", "gender", "accent", "up_votes", "down_votes")}, "split": split, "transcript": r["text"],
            "text": speech("English", r["text"])}

@cache
def _epadb_scores(root):
    with open(root / "speechocean762/resource/scores.json", encoding="utf-8") as f:
        return json.load(f)

@rule
def epadb(m, root):
    s = _epadb_scores(root)[stem(m)]
    return {"transcript": s["text"], **{k: s[k] for k in ("accuracy", "completeness", "fluency", "prosodic", "total")},
            "text": f"{speech('English', s['text'])} (non-native speaker, first language Mandarin; pronunciation score {s['total']}/10)"}

GALGAME_TONE = ("an angry tone", "a disgusted tone", "an embarrassed tone", "a fearful tone", "a happy tone", "a sad tone", "a surprised tone",
                "a neutral tone", "a sexual scene (moaning)", "an oral-sex scene")

@rule
def galgame_speech_ser_japanese_visual_novel_speech_emotion(m, root):
    tone = GALGAME_TONE[int(m["cls"])]
    return {"emotion_id": int(m["cls"]), "transcript": m["txt"], "text": f'A Japanese visual-novel voice actor speaking a line in {tone}: "{m["txt"]}"'}

HIMIA_SPEED = {"N": "normal", "F": "fast", "S": "slow"}

@rule
def hi_mia(m, root):
    speaker, point, mic, utt = stem(m).split("_")
    speed = HIMIA_SPEED[utt[0]]
    return {"speaker_id": speaker, "point_id": int(point), "mic_id": int(mic), "speaking_speed": speed,
            "text": f'{speech("Chinese", "你好,米雅")}, the wake word spoken at {speed} speed, recorded by a {"Hi-Fi microphone" if mic == "00" else "microphone array"} in a home'}

ICBHI_LOCATION = {"Tc": "trachea", "Al": "anterior left", "Ar": "anterior right", "Pl": "posterior left", "Pr": "posterior right",
                  "Ll": "lateral left", "Lr": "lateral right"}
ICBHI_DEVICE = {"AKGC417L": "an AKG C417L microphone", "LittC2SE": "a Littmann Classic II SE stethoscope",
                "Litt3200": "a Littmann 3200 electronic stethoscope", "Meditron": "a WelchAllyn Meditron stethoscope"}

@rule
def icbhi_respiratory(m, root):
    patient, index, location, mode, device = stem(m).split("_")
    diagnosis = pairs(root / Path(m["path"]).parents[1] / "patient_diagnosis.csv", ",")[patient]
    cycles = [l.split() for l in sidecar(m, root, ".txt").splitlines()]
    crackles, wheezes = sum(c[2] == "1" for c in cycles), sum(c[3] == "1" for c in cycles)
    return {"patient_id": patient, "diagnosis": diagnosis, "chest_location": ICBHI_LOCATION[location], "device": device,
            "num_cycles": len(cycles), "num_crackle_cycles": crackles, "num_wheeze_cycles": wheezes,
            "text": f"Lung sounds recorded at the {ICBHI_LOCATION[location]} chest position with {ICBHI_DEVICE[device]}, patient diagnosis: {diagnosis}; "
                    f"{len(cycles)} respiratory cycles, {crackles} with crackles, {wheezes} with wheezes"}

@rule
def kaggle_animal_sounds(m, root):
    animal = re.sub(r"\d+$", "", stem(m))
    return {"animal_class": animal, "text": f"A {animal} vocalization"}

KAGGLE_VEHICLE_CLASSES = ("car", "truck, bus or van", "motorcycle")

@cache
def _kaggle_vehicle_classes(root):
    with open(root / "vehicle_type_sound_dataset/labels.csv", newline="", encoding="utf-8-sig") as f:
        return {Path(r["file_path"].replace("\\", "/")).name: KAGGLE_VEHICLE_CLASSES[int(r["class"])] for r in csv.DictReader(f)}

@rule
def kaggle_vehicle_type_sound(m, root):
    vehicle = _kaggle_vehicle_classes(root)[Path(m["path"]).name]
    return {"vehicle_type": vehicle, "text": f"A passing {vehicle}"}

@rule
def librispeech(m, root):
    t = pairs((root / m["path"]).parent / f"{folder(m, 2)}-{folder(m)}.trans.txt")[stem(m)]
    return {"speaker_id": folder(m, 2), "chapter_id": folder(m), "transcript": t, "text": speech("English", t)}

MSWC_LANG = {
    "ar": "Arabic", "as": "Assamese", "br": "Breton", "ca": "Catalan", "cnh": "Hakha Chin", "cs": "Czech", "cv": "Chuvash", "cy": "Welsh",
    "de": "German", "dv": "Dhivehi", "el": "Greek", "en": "English", "eo": "Esperanto", "es": "Spanish", "et": "Estonian", "eu": "Basque",
    "fa": "Persian", "fr": "French", "fy-NL": "Frisian", "ga-IE": "Irish", "gn": "Guarani", "ha": "Hausa", "ia": "Interlingua",
    "id": "Indonesian", "it": "Italian", "ka": "Georgian", "ky": "Kyrgyz", "lt": "Lithuanian", "lv": "Latvian", "mn": "Mongolian",
    "mt": "Maltese", "nl": "Dutch", "or": "Odia", "pl": "Polish", "pt": "Portuguese", "rm-sursilv": "Romansh Sursilvan",
    "rm-vallader": "Romansh Vallader", "ro": "Romanian", "ru": "Russian", "rw": "Kinyarwanda", "sah": "Sakha", "sk": "Slovak", "sl": "Slovenian",
    "sv-SE": "Swedish", "ta": "Tamil", "tr": "Turkish", "tt": "Tatar", "uk": "Ukrainian", "vi": "Vietnamese", "zh-CN": "Chinese"}
MSWC_GENDER = {"MALE": "male ", "FEMALE": "female ", "OTHER": "", "NAN": ""}

@rule
def mswc(m, root):
    lang, _, word, name = Path(m["path"]).parts[-4:]
    r = table(root / "splits" / f"{lang}_splits.csv", "LINK")[f"{word}/{name}"]
    return {"language": lang, "word": word, "split": r["SET"].lower(), "valid": r["VALID"] == "True", "speaker_id": r["SPEAKER"],
            "speaker_gender": r["GENDER"].lower(), "text": f'A {MSWC_GENDER[r["GENDER"]]}speaker says the single word "{word}" in {MSWC_LANG[lang]}.'}

MOBVOI_KEYWORD = {0: "Hi Xiaowen", 1: "Nihao Wenwen"}

@cache
def _mobvoi(root):
    out = {}
    for kind in ("p", "n"):
        for split in ("train", "dev", "test"):
            with open(root / f"mobvoi_hotword_dataset_resources/{kind}_{split}.json", encoding="utf-8") as f:
                out |= {r["utt_id"]: {**r, "split": split} for r in json.load(f)}
    return out

@rule
def mobvoihotwords(m, root):
    r = _mobvoi(root)[stem(m)]
    if r["keyword_id"] == -1:
        return {**r, "text": f"{speech('Chinese', '')} without a wake word"}
    return {**r, "text": f'{speech("Chinese", MOBVOI_KEYWORD[r["keyword_id"]])} (wake word, {r["distance"]} from the device, {r["noise_type"]} noise at {r["noise_volume"]})'}

NAFP_BACKGROUND = {"audioset_subway_metro_underground_not_music": "Subway, metro or underground background noise", "pub_noise_8k": "Pub background noise"}

@rule
def neural_audio_fingerprint(m, root):
    parts = Path(m["path"]).parts
    if "ir" in parts:
        return {"text": "Room impulse response"}
    return {"text": f"{folder(m).capitalize()} noise" if folder(m, 2) == "random_noise" else NAFP_BACKGROUND[folder(m)]}

@rule
def openslr_115_emov_db(m, root):
    speaker, emotion = folder(m).split("_")
    return {"speaker_id": speaker, "emotion": emotion.lower(), "text": f"Acted emotional speech in English, {emotion.lower()} tone"}

@cache
def _quran(root):
    with open(root / "audio/data/quran_.json", encoding="utf-8") as f:
        q = json.load(f)
    out = {}
    for s in q.values():
        for a in s["ayahs"].values():
            out |= {p: {"reciter": r, "transcript": a["ayah_ar"], "translation": a["ayah_en"]} for r, p in a["audio_ayah_path"].items()}
            out |= {w["audio_word_path"]: {"transcript": w["word_ar"], "translation": w["word_en"]} for w in a["words"]}
    return out

@rule
def quran_audio_text(m, root):
    r = _quran(root)[m["path"]]
    what = f"recited by {words(r['reciter']).title()}" if "reciter" in r else "a single word"
    return {**r, "text": f'Quran recitation in Arabic, {what}: "{r["transcript"]}"'}

@cache
def _somos_mos(root):
    return {k: v for s in ("train", "valid", "test") for k, v in pairs(root / f"training_files/split1/full/{s}_mos_list.txt", ",").items()}

@rule
def somos(m, root):
    sentence, system = stem(m).removeprefix("gt_").rsplit("_", 1)
    said, mos = pairs(root / "transcript/additional_sentences.txt", "\t"), float(_somos_mos(root)[Path(m["path"]).name])
    t = said[sentence] if sentence.startswith(("LJ", "general_", "wiki_")) else ""  # the other 1,681 sentences are only in the Blizzard Challenge data
    kind = "Natural" if system == "000" else f"Synthetic (TTS system {system})"
    return {"sentence_id": sentence, "system_id": system, "mean_mos": mos, "transcript": t,
            "text": f"{kind} English speech, mean opinion score {mos:.1f} of 5" + (f': "{t}"' if t else "")}

@rule
def sound_effect_variations(m, root):
    kind, label = m["path"].split("/")[0], folder(m)
    return {"set": kind, "label": label, "text": f"Footsteps ({label})" if kind == "Footstep-set" else f"{label.capitalize()} sound effect"}

@rule
def vcc2016_edinburgh(m, root):
    return {"speaker_id": folder(m), "text": f"{speech('English', '')} by a {'female' if folder(m)[1] == 'F' else 'male'} speaker"}

@rule
def whale_detection_challenge(m, root):
    if folder(m) == "test":
        return {"text": ""}
    label = table(root / "data/train.csv", "clip_name")[Path(m["path"]).name]["label"]
    return {"label": int(label), "text": "North Atlantic right whale up-call recorded by a marine buoy" if label == "1"
            else "Underwater sound recorded by a marine buoy, without a right whale call"}

@rule
def starrail_voice_honkai_star_rail_game_voice_lines(m, root):
    return {"character": m["speaker"], "voice_type": m["voice_type"], "transcript": m["transcription"],
            "text": speech(m["language"].split("(")[0], m["transcription"])}
