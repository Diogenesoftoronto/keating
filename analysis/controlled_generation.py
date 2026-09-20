# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "matplotlib==3.10.*", "numpy==2.*", "pandas==2.*"]
# ///
"""Explore saved controlled SAE generations and blinded reviews without inference."""
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
    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "keating-controlled-generation-notebook-v1",
                         "axes.spines.top": False, "axes.spines.right": False})
    source_path = Path(__file__).resolve().parents[1] / "docs/research-story/generation-examples.json"
    return json, mo, np, pd, plt, source_path


@app.cell
def _(mo):
    mo.md("""
    # Does moving a feature change the answer?

    A **probe** reads a model's internal representation. An **intervention** changes
    one direction in that representation before the next token is selected.
    This notebook compares saved baseline, positive, negative, random and comparison-feature
    generations, then inspects the two blinded reviews of each answer.

    Every control here filters existing evidence. No model is loaded, no provider is called,
    and no budget is spent. Editing a chart does not run another experiment.
    """)
    return


@app.cell
def _(json, mo, source_path):
    mo.stop(not source_path.is_file(), mo.md("The reviewed generation export is not available yet. Run the verified review/export workflow described in `docs/observer-generation-job.md` first."))
    generation_data = json.loads(source_path.read_text())
    generation_rows = generation_data["rows"]
    return generation_data, generation_rows


@app.cell
def _(generation_data, generation_rows, mo):
    _completed = len({r["case_id"] for r in generation_rows})
    _exp = generation_data["experiment"]
    mo.md(f"""**{_completed} of 8 planned task families** have complete five-condition comparisons.
    These are greedy continuations of the pinned Base observer, capped at **{_exp['max_new_tokens']} tokens**.
    The selected layer is **{_exp['layer']}**, feature **{_exp['selected_feature']}**, with relative
    intervention strength **{_exp['epsilon']}**. Positive and negative directions use the same
    calibration scale. See the report's limitations for evaluation scope and missing work.""")
    return


@app.cell
def _(generation_rows, mo):
    _cases = {r["family_id"].replace("-", " "): r["case_id"] for r in generation_rows}
    _conditions = {"Baseline": "baseline", "Selected +": "selected_positive", "Selected −": "selected_negative",
                   "Random": "random", "Comparison feature": "unrelated"}
    task_choice = mo.ui.dropdown(_cases, value=next(iter(_cases)), label="Task")
    intervention_choice = mo.ui.dropdown(_conditions, value="Selected −", label="Compare with baseline")
    mo.hstack([task_choice, intervention_choice])
    return intervention_choice, task_choice


@app.cell
def _(generation_rows, intervention_choice, mo, task_choice):
    selected_generation = next(r for r in generation_rows if r["case_id"] == task_choice.value and r["condition"] == intervention_choice.value)
    baseline_generation = next(r for r in generation_rows if r["case_id"] == task_choice.value and r["condition"] == "baseline")
    mo.vstack([mo.md("### The learner request"), mo.plain_text(selected_generation["learner_prompt"]),
        mo.hstack([mo.vstack([mo.md("### Baseline"), mo.plain_text(baseline_generation["raw_output"])]),
                   mo.vstack([mo.md("### Selected condition"), mo.plain_text(selected_generation["raw_output"])])], widths="equal")])
    return baseline_generation, selected_generation


@app.cell
def _(mo, pd, selected_generation):
    _rows = []
    for _criterion, _item in selected_generation["criteria"].items():
        for _review in _item["reviews"]:
            _rows.append({"criterion": _criterion, "reviewer": _review["reviewer"], "verdict": _review["verdict"], "reason": _review["reason"], "agreement": _item["consensus"]["verdict"]})
    mo.ui.table(pd.DataFrame(_rows), selection=None)
    return


@app.cell
def _(baseline_generation, mo, np, selected_generation):
    _baseline = np.asarray(baseline_generation["generated_ids"], dtype=np.int64)
    _selected = np.asarray(selected_generation["generated_ids"], dtype=np.int64)
    _n = min(len(_baseline), len(_selected))
    _different = np.flatnonzero(_baseline[:_n] != _selected[:_n])
    _first = int(_different[0]) + 1 if len(_different) else (_n + 1 if len(_baseline) != len(_selected) else None)
    mo.md(f"""**Generated tokens:** {len(_selected)} · **Stop reason:** `{selected_generation['stop_reason']}`

    **First changed token:** {_first if _first is not None else 'none; identical sequence'}.
    Token positions count from one. A changed sequence shows an effect on greedy output;
    the review asks whether that change helped with the task.""")
    return


@app.cell
def _(generation_data, mo, pd, plt):
    _totals = pd.DataFrame(generation_data["totals"])
    _plot = _totals[(_totals.reviewer == "consensus") & (_totals.category == "hint") & (_totals.metric == "request_match")]
    _fig, _ax = plt.subplots(figsize=(9, 4.5))
    _ax.barh(_plot.condition, _plot.numerator, color="#00836B")
    for _i, _row in enumerate(_plot.itertuples()):
        _ax.text(_row.numerator + .08, _i, f"{_row.numerator}/{_row.denominator}; {_row.unknown} unknown", va="center", fontsize=9)
    _ax.set_xlim(0, 6)
    _ax.set_xticks(range(5))
    _ax.set_title("Does the answer respect a request for a hint?", loc="left", fontweight="bold", color="#254e63")
    _ax.set_xlabel("Passes among completed hint tasks · agreement between two reviewers")
    _fig.tight_layout()
    mo.vstack([_fig, mo.md("Counts retain unknowns. The task family is the paired comparison unit; the five conditions are not five independent tasks.")])
    return


if __name__ == "__main__":
    app.run()
