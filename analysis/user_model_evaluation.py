# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "matplotlib==3.10.*", "numpy==2.2.6", "scikit-learn==1.7.2"]
# ///
"""Read-only authored profile/panel demonstration. No human data or provider calls."""
import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    from copy import deepcopy
    from pathlib import Path
    import sys
    import marimo as mo
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "training"))
    import user_model_evaluation as ume
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False,
                         "axes.spines.right": False, "svg.hashsalt": "keating-user-model-fixture-v1"})
    return deepcopy, mo, np, pd, plt, ume


@app.cell
def _(mo):
    mo.md("""# Authored profiles, paired measurements

    **AUTHORED FIXTURE — zero real respondents.** Every person, answer, prediction,
    and outcome below was invented to demonstrate the measurement contracts.
    These graphs are arithmetic examples, not human findings or evidence of
    simulator quality. This notebook changes memory only and never calls a model.

    Follow research-plan sections **5 → 12 → 13**: keep unknowns in a finite set
    of profile hypotheses, compare the same people across conditions, then test
    predictions against separately held-out answers when actual evidence exists.
    """)
    return


@app.cell
def _(mo):
    ask_weight = mo.ui.slider(.05, .95, step=.05, value=.6, label="Authored weight of 'ask' hypothesis")
    ada_weight = mo.ui.slider(.1, .9, step=.05, value=.5, label="Authored panel weight of Ada")
    repetitions = mo.ui.slider(1, 8, value=1, label="Repeat the same authored continuations")
    mo.vstack([ask_weight, ada_weight, repetitions])
    return ada_weight, ask_weight, repetitions


@app.cell
def _(ada_weight, ask_weight, deepcopy, repetitions, ume):
    example = ume.authored_fixture()
    for _profile in example["profiles"]:
        _profile["hypotheses"][0]["weight"] = ask_weight.value
        _profile["hypotheses"][1]["weight"] = 1 - ask_weight.value
    _profiles = ume.prepare_profiles(example["evidence"], example["profiles"], origin="authored_fixture")
    # Explicitly rebuild this authored example's bindings after changing its
    # hypothetical weights. External measured artifacts must retain frozen hashes.
    for _row in example["holdout"]["predictions"] + example["panel"]["continuations"]:
        _row["profile_sha256"] = _profiles[_row["person_id"]]["profile_sha256"]
    example["panel"]["respondent_weights"] = {
        "fixture-ada": ada_weight.value,
        "fixture-ben": (1 - ada_weight.value) * .6,
        "fixture-cy": (1 - ada_weight.value) * .4,
    }
    _original = deepcopy(example["panel"]["continuations"])
    for _repetition in range(1, repetitions.value):
        for _original_row in _original:
            _copy = deepcopy(_original_row)
            _copy["id"] += f"-copy-{_repetition}"
            _copy["replicate_id"] += f"-copy-{_repetition}"
            example["panel"]["continuations"].append(_copy)
    measured = ume.evaluate(example, samples=1000, seed=42, bins=5)
    return (measured,)


@app.cell
def _(measured, mo, pd):
    _profile = measured["profiles"]["fixture-ada"]
    _rows = [{"hypothesis": _h["id"], "weight": _h["weight"],
              "observed preference (authored evidence)": _h["traits"]["preferred_format"]["value"],
              "confidence": "unknown", "next move": _h["traits"]["next_move"]["kind"]}
             for _h in _profile["hypotheses"]]
    mo.vstack([
        mo.md(f"""## Finite profile uncertainty

        Profile entropy: **{_profile['entropy_nats']:.3f} nats**. Confidence stays
        unknown while the explicitly authored behavior hypothesis varies.
        Weights are assumptions here, not a fitted posterior."""),
        mo.ui.table(pd.DataFrame(_rows), selection=None),
    ])
    return


@app.cell
def _(measured, mo, np, pd, plt):
    _panel = measured["panel"]
    _people = pd.DataFrame(_panel["per_respondent"])
    _fig, _ax = plt.subplots(figsize=(8, 3.5))
    _x = np.arange(len(_people))
    _ax.bar(_x, _people["weight"] * _people["delta"], color=["#0072B2", "#C97900", "#00836B"])
    _ax.axhline(0, color="#536570", lw=1)
    _ax.set_xticks(_x, _people["person_id"])
    _ax.set_ylabel("Weight × authored (B − A)")
    _ax.set_title("Authored contributions to the synthetic panel effect")
    _fig.tight_layout()
    mo.vstack([
        mo.md(f"""## Same people, more continuations

        **0 real respondents · {_panel['authored_person_count']} authored people ·
        {_panel['continuation_count']} authored continuations.** Weighting ESS:
        **{_panel['weighting_ess']:.2f}**. Authored B − A effect:
        **{_panel['full_panel_effect']:.3f}**.

        Increasing identical repetitions changes the continuation count. It does
        not change this effect, ESS, or the respondent bootstrap interval:
        **{_panel['bootstrap']['interval_95']}**. This interval demonstrates
        resampling mechanics only; it is not population evidence."""),
        _fig,
        mo.ui.table(_people, selection=None),
    ])
    return


@app.cell
def _(measured, mo, pd, plt):
    _known = measured["holdouts"]["known_respondent"]
    _new = measured["holdouts"]["new_person"]
    _bins = pd.DataFrame(_known["answer_weighted_metrics"]["reliability_bins"]).dropna()
    _fig, _ax = plt.subplots(figsize=(6, 3.6))
    _ax.plot([0, 1], [0, 1], linestyle="--", color="#89969C", label="Perfect calibration reference")
    _ax.scatter(_bins["mean_probability"], _bins["positive_fraction"],
                s=80, color="#0072B2", label="Authored known-person answers")
    _ax.set(xlim=(-.03, 1.03), ylim=(-.03, 1.03), xlabel="Profile-mixture prediction",
            ylabel="Fraction of authored positive labels", title="Authored reliability-bin demonstration")
    _ax.legend(loc="lower right", fontsize=8)
    _fig.tight_layout()
    mo.vstack([
        mo.md(f"""## Keep the holdouts distinct

        Known-person fixture: {_known['scored_person_count']} authored people,
        person-mean Brier **{_known['person_mean_brier']:.4f}**.
        New-person fixture: {_new['scored_person_count']} authored person,
        person-mean Brier **{_new['person_mean_brier']:.4f}**, and
        **{_new['unknown_answer_count']} unknown answer** excluded from scoring.

        There are no actual respondent answers here. Empirical calibration,
        disclosure timing, and prediction quality remain unmeasured. See
        `docs/user-model-evaluation.md` for input lineage and holdout requirements."""),
        _fig,
    ])
    return


if __name__ == "__main__":
    app.run()
