# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "numpy==2.2.6", "pandas==2.*", "matplotlib==3.10.*"]
# ///
"""Actual combined native update: inspect saved signals and change weights offline."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    from pathlib import Path
    import marimo as mo
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    _source = Path(__file__).resolve().parents[1] / "docs/generated/native-combined-update.json"
    summary = json.loads(_source.read_text())
    plt.rcParams.update({"svg.hashsalt":"keating-combined-results-notebook-v1",
        "font.family":"DejaVu Sans", "axes.spines.top":False, "axes.spines.right":False})
    return mo, np, pd, plt, summary


@app.cell
def _(mo, summary):
    mo.md(f"""
    # Two teaching actions, two kinds of feedback

    In the actual native episode, the tutor suggested breaking **28** into chunks
    to calculate **63 − 28**, then suggested subtracting **20** and **8**.
    The simulated learner first asked about the approach, then calculated **43**
    and **35**. One malformed learner response required the allowed repair.

    The frozen SAE probe measured premature-answer risk on each delivered hint.
    The hindsight teacher scored the original tutor tokens after seeing the actual
    next learner event. The student received the original prefix alone.

    Recorded F/S gradient cosine: **{summary['feature_sd_cosine']:.3f}** in
    **token log-probability space**. This is not model-parameter gradient cosine.
    The run verifies a combined update, with no claim of human learning or
    held-out teaching improvement.
    """)
    return


@app.cell
def _(mo, pd, summary):
    _rows = [{"action": _i+1, "actor tokens": _a["completion_tokens"],
        "masked context targets": _a["masked_context_tokens"],
        "feature advantage": _a["feature_advantage"],
        "gradient replay error": _a["analytic_gradient_max_error"]}
        for _i, _a in enumerate(summary["actions"])]
    mo.ui.table(pd.DataFrame(_rows), selection=None)
    return


@app.cell
def _(mo, pd, summary):
    mo.vstack([mo.md("## Three actual update arms\nAll start from the same earlier F-updated weights, "
        "with a fresh optimizer. Each trains the same two actions once. These are execution "
        "checks; different objectives' loss values do not rank teaching quality."),
        mo.ui.table(pd.DataFrame([{
            "arm": _arm["arm"], "optimizer acknowledged": _arm["optimizer_acknowledged"],
            "actor targets": _arm["completion_tokens"], "masked targets": _arm["masked_context_targets"],
            "gradient replay error": _arm["gradient_replay_max_error"],
        } for _arm in summary["arms"]]), selection=None)])
    return


@app.cell
def _(mo):
    feature_weight = mo.ui.slider(0, 1, step=.05, value=1, label="Feature weight")
    hindsight_weight = mo.ui.slider(0, 1, step=.05, value=1, label="Hindsight weight")
    mo.hstack([feature_weight, hindsight_weight])
    return feature_weight, hindsight_weight


@app.cell
def _(feature_weight, hindsight_weight, mo, np, plt, summary):
    _fig, _axes = plt.subplots(1, len(summary["actions"]), figsize=(11, 3.5), squeeze=False, layout="constrained")
    for _i, _action in enumerate(summary["actions"]):
        _ax = _axes[0, _i]
        _x = np.arange(1, _action["completion_tokens"]+1)
        _f = feature_weight.value * np.array(_action["feature_gradient"])
        _s = hindsight_weight.value * np.array(_action["sd_gradient"])
        _total = _f + _s + np.array(_action["weighted_anchor_gradient"])
        _ax.plot(_x, _f, color="#00836B", label="Feature")
        _ax.plot(_x, _s, color="#C97900", label="Hindsight")
        _ax.plot(_x, _total, color="#0072B2", label="Combined + recorded anchor")
        _ax.axhline(0, color="#89969C", linewidth=.6)
        _ax.set(title=f"Action {_i+1}", xlabel="Original completion token", ylabel="d loss / d log probability")
        _ax.legend(fontsize=8)
    mo.vstack([_fig, mo.md("The sliders recompute gradients on the saved scores. "
        "The anchor remains at its recorded weight of 0.1. Positive derivatives "
        "push token log probabilities down under this surrogate; negative ones push "
        "them up. No provider calls, optimizer steps, or file writes occur here.")])
    return


if __name__ == "__main__":
    app.run()
