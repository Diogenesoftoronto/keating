# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy==2.2.6", "matplotlib==3.10.*", "torch==2.8.0+cpu"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Read-only authored F/S/anchor arithmetic through the actual loss kernel.

CPU tensors only. No model weights, hosted clients, credentials or budget files.
"""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    from pathlib import Path
    import sys
    import math
    import marimo as mo
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    import torch

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "training"))
    import native_combined_loss as loss_math

    palette = {"feature": "#0072B2", "sd": "#00836B", "anchor": "#C97900", "total": "#93679F"}
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False,
                         "axes.spines.right": False, "axes.titleweight": "bold",
                         "svg.hashsalt": "keating-feature-hindsight-authored-v1"})

    def authored_action(ratio, feature, teacher_gap, count=3, action_id="authored-action"):
        targets = list(range(100, 100 + count))
        roles = ["assistant_text"] * count
        current = loss_math.TargetScores([1, 2, *targets], ["prompt", "tool_result", *roles],
            [False, False, *([True] * count)],
            torch.tensor([float("nan"), float("nan"), *([-4 + math.log(ratio)] * count)],
                         dtype=torch.float64, requires_grad=True))
        def packet(value):
            return loss_math.TargetScores(targets, roles, [True] * count,
                                          torch.tensor([value] * count, dtype=torch.float64))
        return loss_math.ActionInput(action_id, targets, current, packet(-4), "actual_sampler",
                                     feature, packet(-4 + teacher_gap), packet(-4))

    return authored_action, loss_math, mo, np, palette, pd, plt, sys


@app.cell
def _(mo):
    mo.md("""# What do feature feedback and hindsight change?

    **Authored arithmetic · zero model runs · zero real people.** These controls
    call `native_combined_loss`, the same local kernel available to the trainer.
    The scores and feature advantages below are invented. No source classifier
    is being treated as an approved reward.

    **F** supplies one fixed action advantage. **S** compares the frozen
    teacher's probability with the current student's probability of the original
    token. The optional **anchor** penalizes squared log-probability drift from
    a reference on these observed targets; it is not full-vocabulary KL.

    Prompt, learner and tool-result tokens remain context. Only original
    actor-authored text or tool-call tokens can be training targets.
    """)
    return


@app.cell
def _(mo):
    mode = mo.ui.radio(["F-only", "S-only", "F+S"], value="F+S", label="Enabled signals")
    feature_value = mo.ui.slider(-2., 2., step=.1, value=-.6, label="Authored action advantage F")
    teacher_gap = mo.ui.slider(-1., 1., step=.1, value=.6, label="Teacher − behavior log probability (nats)")
    ratio = mo.ui.slider(.5, 1.5, step=.02, value=1., label="Current / actual-sampler token probability")
    feature_weight = mo.ui.slider(.05, 1., step=.05, value=1., label="F coefficient")
    sd_weight = mo.ui.slider(.05, 1., step=.05, value=1., label="S coefficient")
    anchor_weight = mo.ui.slider(0., 1., step=.05, value=.1, label="Reference coefficient")
    epsilon = mo.ui.slider(.01, .3, step=.01, value=.2, label="Ratio clip width")
    missing_feature = mo.ui.checkbox(False, label="Feature advantage is unknown")
    mo.vstack([mode, mo.hstack([feature_value, teacher_gap]), ratio,
               mo.hstack([feature_weight, sd_weight]), mo.hstack([anchor_weight, epsilon]), missing_feature])
    return anchor_weight, epsilon, feature_value, feature_weight, missing_feature, mode, ratio, sd_weight, teacher_gap


@app.cell
def _(anchor_weight, epsilon, feature_weight, loss_math, mode, sd_weight):
    recipe = loss_math.LossConfig(
        mode.value, feature_weight.value if mode.value != "S-only" else 0,
        sd_weight.value if mode.value != "F-only" else 0, anchor_weight.value,
        epsilon=epsilon.value, feature_cap=3., sd_cap=3.,
        anchor_assumption=loss_math.ANCHOR_ASSUMPTION if anchor_weight.value else None)
    return (recipe,)


@app.cell
def _(authored_action, feature_value, loss_math, missing_feature, ratio, recipe, teacher_gap):
    action = authored_action(ratio.value, None if missing_feature.value else feature_value.value, teacher_gap.value)
    result = loss_math.combined_loss([action], recipe)
    gradients = loss_math.logprob_gradient_diagnostics(result, [action]) if result["status"] == "computed" else None
    return action, gradients, result


@app.cell
def _(action, gradients, mo, pd, result):
    if result["status"] == "abstained":
        _display = mo.callout(f"No update: {result['reason']}. Unknown evidence stays unknown.", kind="warn")
    else:
        _rows = []
        for _index, (_token, _role, _mask) in enumerate(zip(action.current.target_ids,
                action.current.token_roles, action.current.completion_mask)):
            _rows.append({"token ID": _token, "role": _role, "trained": _mask,
                "d(loss)/d(current logp)": gradients["components"]["total"]["per_action"][action.action_id][_index]})
        _display = mo.vstack([mo.md(f"**Loss: {result['metrics']['loss_total']:.5f}.** "
            "A negative derivative increases this token's log probability under gradient descent; "
            "a positive derivative decreases it."), mo.ui.table(pd.DataFrame(_rows), selection=None),
            mo.md(f"F/S gradient cosine: **{gradients['feature_sd_cosine']}**. "
                  "This measures derivatives with respect to supplied log probabilities, not model parameters.")])
    _display
    return


@app.cell
def _(authored_action, feature_value, loss_math, missing_feature, np, recipe, teacher_gap):
    sweep_rows = []
    for _ratio in np.linspace(.5, 1.5, 81):
        _action = authored_action(float(_ratio), None if missing_feature.value else feature_value.value, teacher_gap.value)
        _result = loss_math.combined_loss([_action], recipe)
        _row = {"ratio": float(_ratio), "status": _result["status"]}
        if _result["status"] == "computed":
            _gradient = loss_math.logprob_gradient_diagnostics(_result, [_action])
            for _name in ("feature", "sd", "anchor"):
                _component = _result["weighted_components"][_name]
                _row[_name] = float(_component.detach()) if _component is not None else np.nan
            _row["total"] = float(_result["loss"].detach())
            _row["gradient"] = sum(_gradient["components"]["total"]["per_action"][_action.action_id][2:])
        sweep_rows.append(_row)
    return (sweep_rows,)


@app.cell
def _(epsilon, mo, palette, pd, plt, ratio, sweep_rows):
    _frame = pd.DataFrame(sweep_rows)
    if "total" not in _frame:
        _chart = mo.md("The sweep abstains because the enabled feature signal is unknown.")
    else:
        loss_figure, _axes = plt.subplots(1, 2, figsize=(11, 4.2))
        for _key, _color in palette.items():
            _axes[0].plot(_frame["ratio"], _frame[_key], label=_key, color=_color,
                          linewidth=2.5 if _key == "total" else 1.7)
        _axes[0].set(title="Authored weighted loss terms", ylabel="Loss", xlabel="Current / sampler probability")
        _axes[0].legend(frameon=False)
        _axes[1].plot(_frame["ratio"], _frame["gradient"], color=palette["total"])
        _axes[1].set(title="Actual detached-signal derivative", ylabel="Sum of current logp derivatives",
                     xlabel="Current / sampler probability")
        for _axis in _axes:
            _axis.axhline(0, color="#89969C", linewidth=.7)
            _axis.axvspan(1 - epsilon.value, 1 + epsilon.value, color="#eef3f5", zorder=-1)
            _axis.axvline(ratio.value, color="#536570", linestyle=":", linewidth=1)
        loss_figure.tight_layout()
        _chart = loss_figure
    _chart
    return


@app.cell
def _(authored_action, feature_value, loss_math, missing_feature, mo, pd, ratio, recipe, teacher_gap):
    _comparisons = []
    for _count in (3, 30):
        _action = authored_action(ratio.value, None if missing_feature.value else feature_value.value,
                                  teacher_gap.value, count=_count)
        _result = loss_math.combined_loss([_action], recipe)
        _comparisons.append({"Completion tokens": _count, "Status": _result["status"],
                             "Action loss": _result["metrics"].get("loss_total")})
    mo.vstack([mo.md("## Length and evidence boundaries"), mo.ui.table(pd.DataFrame(_comparisons), selection=None),
        mo.md("""Repeating the same scores across more completion tokens preserves the action's
        total loss. Each action contributes its completion mean, then the batch averages actions.
        A reward copied onto 30 tokens does not become 30 independent observations.

        The S advantage is recomputed at every sweep point but **detached inside each
        backward calculation**. Consequently the plotted loss curve's ordinary slope
        need not equal the autograd derivative. The right graph comes from autograd.

        These independent fixed caps differ from `prepare_advantages`' alpha-0.1 EMA
        and three-times-EMA clip. Favorable PPO movement saturates at the appropriate
        bound; movement in the wrong direction can still receive a corrective gradient.
        """)])
    return


@app.cell
def _(mo, sys):
    _clients = [name for name in ("tinker", "httpx", "requests") if name in sys.modules]
    mo.md(f"CPU Torch is used for arithmetic. Hosted clients imported: **{_clients or 'none'}**. "
          "This notebook has no training dispatch or model download operation.")
    return


if __name__ == "__main__":
    app.run()
