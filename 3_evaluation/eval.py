"""Run the commands of README.md: MSEB and HEAR, MAEB over four seeds, and the MAEB means."""
import argparse
import statistics
import subprocess
from pathlib import Path

from mteb.results import TaskResult

MODELS = [f"hf-hub:laion/clap2-{size}-audioxl-s1B" for size in ("xxs", "xs", "small", "medium", "large")]


def clip_benchmark(model, pretrained, *args):
    """One `clip_benchmark eval` call for a CLAP2 model."""
    cmd = ["clip_benchmark", "eval", "--model_type", "clap2", "--model", model, "--pretrained", pretrained]
    subprocess.run([*cmd, *args, "--skip_existing"], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", nargs="+", default=MODELS, help="hf-hub:<repo>, or naflexclap_<size> with --pretrained")
    ap.add_argument("--pretrained", default="", help="checkpoint file or OpenCLIP tag; ignored for hf-hub models")
    a = ap.parse_args()
    for m in a.models:
        r = Path("results", m.removeprefix("hf-hub:laion/"))
        for b in ("mseb", "hear"):
            clip_benchmark(m, a.pretrained, "--dataset", b, "--dataset_root", f"data/{b}",
                           "--output", f"{r}/{{dataset}}.json")
        for s in (42, 1, 2, 3):
            clip_benchmark(m, a.pretrained, "--dataset", "maeb", "--seed", str(s), "--batch_size", "8",
                           "--output", f"{r}/maeb_seed{s}/{{dataset}}.json")
        files = list(r.glob("maeb_seed*/*/native_mteb_*/results/*/*/[A-Z]*.json"))
        assert len(files) == 4 * 30, f"{m}: {len(files)} MAEB results, expected 4 seeds x 30 tasks"
        print(r.name, 100 * statistics.mean(TaskResult.from_disk(f).get_score() for f in files))


if __name__ == "__main__":
    main()
