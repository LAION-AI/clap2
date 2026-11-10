# Scaling law

Methodology and fitting procedure follow [scaling-laws-for-comparison](https://github.com/LAION-AI/scaling-laws-for-comparison).
`points.csv` holds the 96 runs (scores 0-1, validation loss). `flops.py` checks their compute `C`. `fit.py` fits
`L(C) = A (C + e^B)^-alpha + E` to the compute-Pareto frontier (1000 bootstraps of 3200 curve_fit starts each, plus a
hold-out fit on `C <= 1e11`). The fit takes about 120 CPU hours, or 18 with `--targets maeb30`. `plot.py` draws the figures.
