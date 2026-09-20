# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "numpy==2.2.6", "pandas==2.*", "matplotlib==3.10.*"]
# ///
"""Read-only inspection of actual, blindly graded checkpoint responses."""
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
    from matplotlib.colors import ListedColormap
    report = json.loads((Path(__file__).resolve().parents[1] / "docs/generated/feature-hindsight-evaluation.json").read_text())
    arms = list(report["by_arm"])
    rows = pd.DataFrame(report["rows"])
    plt.rcParams.update({"font.family":"DejaVu Sans", "axes.spines.top":False,
        "axes.spines.right":False,"axes.spines.left":False,"svg.hashsalt":"keating-behavior-v1",
        "axes.titleweight":"bold","text.color":"#254e63","axes.labelcolor":"#254e63"})
    return ListedColormap, arms, mo, np, pd, plt, report, rows


@app.cell
def _(mo):
    mo.md("""
    # Did the saved updates change tutoring?

    **No improvement is established in this small comparison.** Initial, F-only,
    and F+S pass 10/16 responses; S-only passes 9/16. Each trained arm produces
    exactly the starting response in 14/16 matched task/seed pairs.

    These are **64 actual responses, eight authored families, two seeds and four
    immutable samplers**. Grades were locked before revealing checkpoint labels.
    Two automated reviewers independently graded eight overlapping responses;
    all eight overall verdicts agreed. One disputed hint-length criterion stays
    unknown on four identical replies; their correctness independently fails.

    The starting checkpoint had already received a feature update. F, S and F+S
    each add one update on the same two native actions. This compares small
    update effects, not a fresh base model against a fully trained tutor.
    """)
    return


@app.cell
def _(mo):
    category = mo.ui.dropdown(["all", "hint", "worked", "retention"], value="all", label="Task type")
    category
    return (category,)


@app.cell
def _(ListedColormap, arms, category, np, plt, rows):
    filtered = rows if category.value == "all" else rows[rows.category == category.value]
    totals = filtered.groupby("arm")["task_pass"].agg(["sum","count"]).reindex(arms)
    matrix = filtered.pivot(index=["case_id","seed"],columns="arm",values="task_pass").reindex(columns=arms)
    fig_behavior, (ax_totals, ax_cases) = plt.subplots(1,2,figsize=(11,6),gridspec_kw={"width_ratios":[1,1.3]},layout="constrained")
    colors = ["#89969C", "#0072B2", "#C97900", "#00836B"]
    ax_totals.bar(arms, totals["count"], color="#eef3f5")
    ax_totals.bar(arms, totals["sum"], color=colors)
    for _i, (_arm,_row) in enumerate(totals.iterrows()):
        ax_totals.text(_i,_row["sum"]+.12,f'{int(_row["sum"])}/{int(_row["count"])}',ha="center")
    ax_totals.set(ylim=(0,totals["count"].max()+1),ylabel="Passed / all scheduled responses",title="Frozen criteria, blinded grades")
    ax_cases.imshow(matrix.to_numpy(dtype=float),vmin=0,vmax=1,aspect="auto",cmap=ListedColormap(["#efd2aa","#00836B"]))
    ax_cases.set_xticks(np.arange(len(arms)),arms)
    ax_cases.set_yticks(np.arange(len(matrix)),[f"{c} · seed {s}" for c,s in matrix.index])
    ax_cases.set_title("Each matched pair: teal pass, tan fail")
    fig_behavior
    return (filtered,)


@app.cell
def _(arms, mo, report):
    mo.ui.table([{"arm":a,**report["paired_against_initial"][a]} for a in arms[1:]], selection=None)
    return


@app.cell
def _(filtered, mo):
    mo.ui.table(filtered[["case_id","family_id","category","seed","arm","task_pass"]], selection=None)
    return


@app.cell
def _(mo, report):
    mo.md("""
    ## What this comparison supports

    Four hint requests test useful guidance without giving away the requested
    decision. Two worked-answer requests prevent blanket withholding from
    scoring well. Two other tasks check matrix transposition and list aliasing.
    Failures include disclosure of a search decision, omitted restrictions,
    incorrect chemistry terminology, incomplete calculations and format errors.

    The four arms used identical messages and decoding settings within each
    case/seed. Every response completed; none was replaced. These are compact
    chat calls through the real capture bridge, without interactive tools or a
    learner simulator. This measures generated response behavior; delayed human
    learning and the full native interactive pilot remain unmeasured.

    Filter the views above to inspect task categories. Filtering changes only
    this display; it never changes the frozen grades or calls a provider.
    """)
    return


if __name__ == "__main__":
    app.run()
