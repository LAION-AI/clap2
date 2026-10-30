"""Download LAION-Audio-XL (WebDataset tars of 32 kHz FLAC + JSON) from Hugging Face into out/<config>/.

Without a local copy:
    from datasets import load_dataset
    ds = load_dataset("laion/laion-audio-xl", "open", split="train", streaming=True)  # or "sharealike", "noncommercial"
"""
import argparse

from huggingface_hub import snapshot_download

CONFIGS = ["open", "sharealike", "noncommercial"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out")
    p.add_argument("--configs", nargs="+", choices=CONFIGS, default=CONFIGS)
    p.add_argument("--workers", type=int, default=16)
    a = p.parse_args()
    snapshot_download("laion/laion-audio-xl", repo_type="dataset", local_dir=a.out, max_workers=a.workers,
                      allow_patterns=[f"{c}/*" for c in a.configs] + ["*.md"])


if __name__ == "__main__":
    main()
