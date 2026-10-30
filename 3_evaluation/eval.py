"""Run the commands of README.md: MSEB and HEAR, MAEB over four seeds, and the MAEB means."""
import argparse
import statistics
import subprocess
from pathlib import Path

from mteb.results import TaskResult

MODELS = ["naflexclap_xxs", "naflexclap_xs", "naflexclap_small", "naflexclap_medium", "naflexclap_large"]


def clip_benchmark(model, pretrained, *args):
    """One `clip_benchmark eval` call for a CLAP2 model."""
    cmd = ["clip_benchmark", "eval", "--model_type", "clap2", "--model", model, "--pretrained", pretrained]
    subprocess.run([*cmd, *args, "--skip_existing"], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", nargs="+", default=MODELS)
    ap.add_argument("--pretrained", default="laion_audio_xl_s1b", help="OpenCLIP tag or checkpoint file")
    a = ap.parse_args()
    for m in a.models:
        for b in ("mseb", "hear"):
            clip_benchmark(m, a.pretrained, "--dataset", b, "--dataset_root", f"data/{b}",
                           "--output", f"results/{m}/{{dataset}}.json")
        for s in (42, 1, 2, 3):
            clip_benchmark(m, a.pretrained, "--dataset", "maeb", "--seed", str(s), "--batch_size", "8",
                           "--output", f"results/{m}/maeb_seed{s}/{{dataset}}.json")
        files = list(Path("results", m).glob("maeb_seed*/*/native_mteb_*/results/*/*/[A-Z]*.json"))
        assert len(files) == 4 * 30, f"{m}: {len(files)} MAEB results, expected 4 seeds x 30 tasks"
        print(m, 100 * statistics.mean(TaskResult.from_disk(f).get_score() for f in files))


if __name__ == "__main__":
    main()
