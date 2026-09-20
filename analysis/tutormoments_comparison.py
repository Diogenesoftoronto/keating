# /// script
# requires-python = ">=3.12"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*", "typer>=0.12"]
# ///
"""Inspect original moments beside synthetic Keating episodes, without inference."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from pathlib import Path
    import marimo as mo
    import pandas as pd
    import numpy as np
    import matplotlib.pyplot as plt
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "scripts/training"))
    import tutormoments as tm
    import benchmark_v3 as v3
    adapted = v3.load_cases(root / "scripts/training/benchmarks/tutormoments-keating-v1/cases.json")
    originals = {r["id"]: r for r in tm.load_moments()} if tm.DEFAULT.exists() else {}
    return adapted, mo, np, originals, pd, plt, tm


@app.cell
def _(mo, originals, tm):
    mo.md(f"""
    # TutorMoments → Keating events

    The **vanilla release** stays byte-identical: 520 frozen moments with the
    original oracle student persona, reference continuation and annotations.
    The **Keating development pilot** rewrites six source situations into twelve
    synthetic episodes, including session reopen variants. These use the existing
    v3 harness and its real tool results. No model calls run from this notebook.

    Vanilla cache: **{len(originals)} moments**. If absent, run
    `devenv tasks run keating:tutormoments`, then reopen this notebook.
    Revision: `{tm.REVISION}`. Source: [Ai2 TutorMoments](https://tutormoments.allen.ai/).

    This is an **evaluator view**. Gold labels and future continuations shown here
    must never be injected into a tutor request. No scores have been measured;
    source labels do not automatically become validated labels for adapted turns.
    """)
    return


@app.cell
def _(adapted, mo):
    selected = mo.ui.dropdown({c["title"]: c["id"] for c in adapted}, value=adapted[0]["title"], label="Episode")
    selected
    return (selected,)


@app.cell
def _(adapted, mo, originals, pd, selected):
    episode = next(c for c in adapted if c["id"] == selected.value)
    source = originals.get(episode["source"]["moment_id"])
    mo.vstack([
        mo.md(f"### Changes\n{episode['source']['adaptation']}\n\nSource moment: `{episode['source']['moment_id']}`"),
        mo.ui.table(pd.DataFrame([
            {"step": i, "event": s["kind"], "learner text": s.get("text", "Session reopens through the real harness")}
            for i, s in enumerate(episode["steps"])])),
        mo.accordion({"Original pre-cut transcript (evaluation view)": mo.ui.table(pd.DataFrame(source["context"])) if source else mo.md("Fetch the vanilla cache first."),
                     "Source gold and adaptation provenance": mo.json(episode["source"]),
                     "Keating evaluation rubric": mo.json(episode["rubric"])}),
    ])
    return


@app.cell
def _(adapted, mo, np, originals, pd, plt):
    counts = pd.DataFrame([
        {"dimension": d, "vanilla": sum(r["dimension"] == d for r in originals.values()),
         "adapted episodes": sum(c["source"]["source_dimension"] == d for c in adapted)}
        for d in ("scaffolding", "rigor")])
    _fig, _axes = plt.subplots(1, 2, figsize=(9, 3))
    for _axis, _key in zip(_axes, ("vanilla", "adapted episodes")):
        _axis.bar(np.arange(len(counts)), counts[_key], color=["#0072B2", "#00836B"])
        _axis.set_xticks([0, 1], counts["dimension"])
        _axis.set_title(_key)
        _axis.set_ylabel("Cases (different protocols)")
    _fig.tight_layout()
    mo.vstack([_fig, mo.md("Compare matched source IDs first. Keep model, prompt policy and scoring protocol recorded; do not subtract incompatible aggregate scores or treat fixed learner replies as learning gains.")])
    return


if __name__ == "__main__":
    app.run()
