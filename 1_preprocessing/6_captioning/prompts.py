"""Caption prompt: system prompt and one user instruction asking for a JSON object with a short and a long caption."""

SYSTEM = (
    "You are an expert audio analyst. Describe audio accurately and concisely. Never invent details you cannot hear."
)

SHORT = (
    "Write one sentence of at least 10 words (never fewer) and no more than 13, naming the sound sources, their "
    "action, and one specific descriptive detail. If your first draft is under 10 words, add one more concrete "
    "audible detail before answering — do not pad with filler words. Plain, specific, factual — only what is clearly "
    "audible."
)

LONG = (
    "Describe the audible content of the clip in concise flowing prose of up to 60 words. Cover the sound sources "
    "and events, their order and overlap, the acoustic setting, and the audible character of speech or music when "
    "present.\n"
    "Use only as many words as the audible content supports. Simple clips may need one short sentence; busy clips "
    "should still be summarized concisely.\n"
    "Begin directly with a sound or its source. Each identification should be as specific as the audio supports; "
    "use a broader sound category whenever a precise source is uncertain.\n"
    "Before answering, retain only sentences and clauses that contribute a positive audible observation. The final "
    "word should complete the last audible detail."
)

PROMPT = "\n".join([
    "Listen to the audio clip and describe it by filling in a JSON object.",
    "",
    "The JSON object must contain exactly these string fields:",
    "",
    f'- "short": {SHORT}',
    "",
    f'- "long": {LONG}',
    "",
    "Write both captions in English.",
    'Return ONLY a single JSON object with exactly these keys ("short", "long"), each mapping to a plain-text string '
    "caption. Start your reply with '{' and end it with '}'. Do not add markdown, code fences, comments, or any text "
    "outside the JSON object.",
])
