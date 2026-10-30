"""Print the train.sh commands of one warmup-stable-decay run: the constant-LR trunk and the cooldown branch to D."""
import argparse
import os

# regime: largest D, peak LR, warmup steps, global batch (clips), virtual epoch (clips), trunk save spacing
REGIMES = {"short": (32_000_000, 4e-4, 350, 922, 200_000, 4), "long": (1_024_000_000, 7.5e-4, 2800, 3686, 3_200_000, 8)}
COOLDOWN = 0.2  # share of D
TOKENS = 1504  # audio tokens of the 30 s bucket of train.sh


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("model", help="naflexclap_xxs, _xs, _small, _medium or _large")
    ap.add_argument("samples", type=float, help="D, the clips seen including the cooldown, e.g. 8e6")
    ap.add_argument("gpus", type=int, help="GPUs of the run (all nodes)")
    ap.add_argument("--data", required=True, help="folder of shards, OUT/train of 1_preprocessing/run.sh")
    ap.add_argument("--logs", default="logs")
    a = ap.parse_args()
    regime = "short" if a.samples <= REGIMES["short"][0] else "long"
    top, lr, warmup, batch, epoch, every = REGIMES[regime]
    fork, cool = round((1 - COOLDOWN) * a.samples / epoch), round(COOLDOWN * a.samples / epoch)
    assert a.samples <= top and fork % every == 0 and (fork + cool) * epoch == a.samples, "D does not fit the regime"
    trunk, branch = f"{a.model}_{regime}", f"{a.model}_{a.samples / 1e6:g}M"
    clips = round(batch / a.gpus)
    common = f"--lr {lr} --warmup {warmup} --train-num-samples {epoch} --naflex-max-tokens-per-batch {TOKENS * clips}"
    print(f"# {regime} regime: global batch {clips * a.gpus} = {clips} clips x {a.gpus} GPUs")
    print(f"LOGS={a.logs} 2_training/train.sh {a.model} {a.data} {trunk} --lr-scheduler const {common} "
          f"--epochs {fork} --save-frequency {every}")
    link = f"{a.logs}/{branch}/checkpoints/epoch_latest.pt"
    print(f"mkdir -p {a.logs}/{branch}/checkpoints && [ -e {link} ] || "
          f"ln -s {os.path.abspath(a.logs)}/{trunk}/checkpoints/epoch_{fork}.pt {link}")
    print(f"LOGS={a.logs} 2_training/train.sh {a.model} {a.data} {branch} --lr-scheduler const-cooldown {common} "
          f"--epochs {fork + cool} --epochs-cooldown {cool} --save-frequency 0")


if __name__ == "__main__":
    main()
