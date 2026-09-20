# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "numpy==2.2.6", "pandas==2.*", "matplotlib==3.10.*"]
# ///
"""Inspect the actual SAE reward update; all controls are offline calculations."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    from pathlib import Path
    import marimo as mo
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    _root = Path(__file__).resolve().parents[1]
    _work = _root / ".keating/native-learning/premature-answer-native-measurement-v1"
    _fit = _root / ".keating/native-learning/premature-answer-execution-v1"
    mo.stop(not (_work / "analysis.json").exists(), mo.md(
        "This notebook reads the private, measured research artifacts. "
        "See `docs/premature-answer-reward.md` for results and artifact locations. "
        "It does not download weights or launch training."))
    summary = json.loads((_work / "analysis.json").read_text())
    result = json.loads((_work / "feature-update/consumer/result.json").read_text())
    probe = json.loads((_fit / "probe-report.json").read_text())
    plt.rcParams.update({"svg.hashsalt": "keating-premature-reward-notebook-v1",
        "font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False})
    return mo, np, pd, plt, probe, result, summary


@app.cell
def _(mo, summary):
    mo.md(f"""
    # From a real tutor action to an SAE reward

    The learner asked for a hint for **63 − 28**, leaving the difference unstated.
    Keating suggested subtracting 30 and adding back 2. The frozen Qwen3.5-9B-Base
    layer-12 SAE head assigned **{summary['premature_answer_probability']:.2%}**
    probability to premature answer delivery.

    The recorded update used **F=1, S=0, anchor=0.1** on 50 original actor tokens.
    Its penalty was **{summary['action_advantage']:.5f}**. This is a narrow risk
    penalty; a small penalty is not evidence of good teaching or learning.
    No later learner event exists for this action, so hindsight was disabled.

    Everything below reads saved results. Sliders recompute a hypothetical loss
    gradient on the same recorded scores; they never train, spend, or alter files.
    """)
    return


@app.cell
def _(mo, pd, plt, probe):
    _table = pd.DataFrame([{"readout": _name, "Brier": _row["test"]["brier"],
        "AUC": _row["test"]["roc_auc"], "accuracy": _row["test"]["accuracy_at_0_5"]}
        for _name, _row in probe["baselines"].items()])
    _fig, _ax = plt.subplots(figsize=(7, 3))
    _ax.bar(_table["readout"], _table["Brier"], color=["#89969C", "#0072B2", "#00836B"])
    _ax.set(title="Held-out concept classification · 24 examples / six task families",
        ylabel="Brier score (lower is better)")
    mo.vstack([_fig, mo.ui.table(_table, selection=None), mo.md(
        "These 120 examples were authored, with task families split before fitting. "
        "The fixed L1 text baseline collapsed to an intercept. This does not show "
        "superiority over a tuned text classifier, causal features, or human learning.")])
    return


@app.cell
def _(mo):
    feature_weight = mo.ui.slider(0, 1, step=.05, value=1, label="Feature penalty weight")
    anchor_weight = mo.ui.slider(0, 1, step=.05, value=.1, label="Anchor weight")
    mo.hstack([feature_weight, anchor_weight])
    return anchor_weight, feature_weight


@app.cell
def _(anchor_weight, feature_weight, mo, np, plt, result, summary):
    _key = result["score_records"][0]["action_id"]
    _components = result["diagnostics"]["components"]
    _n = summary["completion_tokens"]
    _feature = np.array(_components["feature"]["per_action"][_key])[-_n:]
    _anchor = np.array(_components["anchor"]["per_action"][_key])[-_n:]
    _recorded = np.array(_components["total"]["per_action"][_key])[-_n:]
    _proposed = feature_weight.value * _feature + anchor_weight.value * _anchor
    _fig, _ax = plt.subplots(figsize=(9, 3.5))
    _ax.plot(np.arange(1, _n+1), _recorded, color="#89969C", linestyle="--", label="Recorded update")
    _ax.plot(np.arange(1, _n+1), _proposed, color="#00836B", label="What-if weights on recorded scores")
    _ax.set(xlabel="Original actor completion token", ylabel="Loss gradient in log-probability space")
    _ax.legend()
    mo.vstack([_fig, mo.md(f"""
    What-if action penalty: **{-feature_weight.value * summary['premature_answer_probability']:.5f}**.
    The anchor resists moving recorded token probabilities away from the frozen
    initial policy. All **{summary['masked_context_tokens']:,}** context targets
    remain masked. A positive plotted derivative means gradient descent lowers
    that token's log probability in this surrogate. This is not a forecast of
    model-parameter changes or future tutoring performance.
    """)])
    return


if __name__ == "__main__":
    app.run()
