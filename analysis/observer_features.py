# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "numpy==2.2.6", "pandas==2.3.3", "matplotlib==3.10.8", "scikit-learn==1.7.2"]
# ///
"""Read-only observer workbench. No torch, checkpoint download or provider calls."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    import os
    import sys
    from pathlib import Path
    import marimo as mo
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/training"))
    from observer_probes import authored_fixture, fit_probes
    plt.rcParams.update({"axes.spines.top": False, "axes.spines.right": False,
                         "font.family": "DejaVu Sans", "text.color": "#254e63",
                         "axes.labelcolor": "#536570", "axes.edgecolor": "#dce4e8",
                         "svg.hashsalt": "keating-observer-features-v1"})
    return Path, authored_fixture, fit_probes, json, mo, np, os, pd, plt


@app.cell
def _(mo):
    mo.md("""
    # Observer features: what can we measure?

    The frozen observer reads **approved interaction evidence**. A small probe
    learns a specific label from text, raw residual vectors, or sparse SAE
    coordinates. Its score is not a measurement of a learner's mind.

    **This notebook never loads Qwen, downloads weights, or calls providers.**
    The default graphs measure classifiers fitted locally to an **authored
    fixture**. Both labels and numeric vectors are invented for checking the
    workflow. They are not Qwen activations, expert judgments, or learning results.

    Open `docs/observer-pipeline.md` for the explicit extraction and fitting CLIs.
    An existing report can be inspected below without fitting it again.
    """)
    return


@app.cell
def _(mo, os):
    report_path = mo.ui.text(value=os.environ.get("KEATING_OBSERVER_REPORT", ""), label="Existing probe report JSON (blank = authored demonstration)", full_width=True)
    report_path
    return (report_path,)


@app.cell
def _(Path, authored_fixture, fit_probes, json, report_path):
    _path = report_path.value.strip()
    load_error = None
    report = None
    if _path:
        try:
            report = json.loads(Path(_path).expanduser().read_text())
            if report.get("schema_version") != 1 or set(report.get("baselines", {})) != {"text", "raw", "sae"}:
                raise ValueError("Expected an observer_probes report")
        except (OSError, ValueError) as _error:
            load_error = str(_error)
            report = None
    else:
        report = fit_probes(authored_fixture(), "premature_answer", boundary="delivered",
                            definition="Answer supplied despite an explicit request for a hint.")
    return load_error, report


@app.cell
def _(load_error, mo, report):
    if load_error:
        mo.output.replace(mo.md(f"Report unavailable: `{load_error}`. Actual measurements remain **unknown**."))
    elif report:
        _fixture = report["evidence"] != "model_extraction"
        _constant_modes = [_name for _name, _result in report["baselines"].items()
                           if _result["feature_card"]["nonzero_coefficients"] == 0]
        _constant_note = (f"**Baseline limitation:** {', '.join(_constant_modes)} learned no nonzero coefficients under this fixed regularization setting. Its predictions are constant; this is not a strong fitted baseline."
                          if _constant_modes else "")
        mo.output.replace(mo.md(f"""
        **Evidence: {report['evidence']}**

        {'Actual Qwen extraction, calibration on real labels, intervention effects, and human learning outcomes: **unknown**.' if _fixture else 'This file reports observer extraction and held-out classification. Human learning and causal intervention effects remain **unknown**.'}

        Target: **{report['target']}** · Boundary: **{report['boundary']}**

        {report['definition']}

        Unknown labels excluded: **{report['unknown_labels_excluded']}**.
        Calibration learns only from its own split; the test split is reserved
        for reporting. Source families and declared identity aliases stay together.

        Brier score measures squared probability error; lower is better.
        Classification accuracy alone can hide an imbalanced target.

        {_constant_note}
        """))
    return


@app.cell
def _(mo, pd, report):
    mo.stop(report is None)
    score_table = pd.DataFrame([{"baseline": _name, **{_k: _v for _k, _v in _result["test"].items()
                                                       if _k != "reliability_bins"}}
                               for _name, _result in report["baselines"].items()])
    mo.ui.table(score_table, selection=None)
    return (score_table,)


@app.cell
def _(mo, np, plt, report):
    mo.stop(report is None)
    _fig, _axes = plt.subplots(1, 2, figsize=(11, 4))
    _colors = ["#0072B2", "#00836B", "#C97900"]
    for _i, ((_name, _result), _color) in enumerate(zip(report["baselines"].items(), _colors)):
        _brier = _result["test"]["brier"]
        _axes[0].bar(_i, _brier, color=_color)
        _ci = _result["test_brier_bootstrap"]["interval_95"]
        if _ci:
            _axes[0].vlines(_i, _ci[0], _ci[1], color="#254e63", linewidth=2)
        _bins = [_b for _b in _result["test"]["reliability_bins"] if _b["count"]]
        _axes[1].plot([_b["mean_probability"] for _b in _bins],
                      [_b["positive_fraction"] for _b in _bins], "o-", color=_color, label=_name)
    _axes[0].set_xticks(np.arange(3), list(report["baselines"]))
    _axes[0].set_ylabel("Held-out Brier score (lower is better)")
    _axes[0].set_title("95% intervals resample source families")
    _axes[1].plot([0, 1], [0, 1], "--", color="#89969C")
    _axes[1].set(xlim=(0, 1), ylim=(0, 1), xlabel="Mean predicted probability", ylabel="Observed positive fraction")
    _axes[1].legend()
    _fig.suptitle("Authored fixture demonstration" if report["evidence"] != "model_extraction" else "Loaded observer report")
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo, plt, report):
    mo.stop(report is None)
    _fig, _axes = plt.subplots(1, 2, figsize=(11, 3.5))
    _axes[0].bar(list(report["counts"]), list(report["counts"].values()), color="#00836B")
    _axes[0].set(title="Known labels used by split", ylabel="Examples")
    _groups = report["split_manifest"]["group_assignment"]
    _axes[1].bar(list(report["counts"]), [sum(_v == _s for _v in _groups.values()) for _s in report["counts"]], color="#0072B2")
    _axes[1].set(title="Independent connected groups", ylabel="Groups")
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo):
    baseline = mo.ui.dropdown(options=["text", "raw", "sae"], value="sae", label="Inspect feature card")
    baseline
    return (baseline,)


@app.cell
def _(baseline, mo, plt, report):
    mo.stop(report is None)
    _card = report["baselines"][baseline.value]["feature_card"]
    _features = _card["top_coefficients"][:12]
    _fig, _ax = plt.subplots(figsize=(9, max(2.5, len(_features) * .3)))
    _ax.barh([_f["feature"] for _f in _features], [_f["weight"] for _f in _features], color="#93679F")
    _ax.set_xlabel("Classifier coefficient on its fitted preprocessing scale")
    _ax.set_title("Readable coefficients do not establish causal mechanisms")
    _fig.tight_layout()
    mo.vstack([_fig, mo.md(_card["permitted_use"]), mo.ui.table(_card["failure_cases"], selection=None)])
    return


@app.cell
def _(mo):
    mo.md("""
    ## Read the right event boundary

    | Need | Delivered action | Retrospective result |
    |---|---|---|
    | Prefix before teaching | Prefix + tutor text + received artifact | Delivered action + next learner evidence |
    | Future outcomes excluded | Undelivered artifacts excluded | Future evidence stays retrospective |

    Extraction stores exact text, character spans, selected tokens, sparse indices
    and values, model/tokenizer/SAE hashes and latest permitted event. A selected
    span must map fully to tokens; truncation and unmapped boundaries fail.

    **Next empirical checks:** collect reviewed native traces, extract the pinned
    Qwen layer, assess text/raw/SAE probes on the same grouped labels, then test a
    decoder direction against opposite-sign and seeded norm-matched random
    controls. Independently judge generated behavior and preserve fluency and
    correctness measurements. This notebook reports no intervention outcome.
    """)
    return


if __name__ == "__main__":
    app.run()
