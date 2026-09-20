# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["marimo==0.23.1", "pandas==2.*", "numpy==2.2.6", "matplotlib==3.10.*"]
# ///
"""Read-only, wholly authored finite-profile workbench; zero real people.

Wraps scripts/training/profile_information.py. All inputs live in memory;
no evidence files, credentials, providers, or budget ledgers are accessed.
"""
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
    import profile_information as profile_math
    import user_model_evaluation as ume

    palette = {"prior": "#0072B2", "posterior": "#00836B", "cost": "#C97900",
               "information": "#93679F", "muted": "#536570"}
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False,
                         "axes.spines.right": False, "axes.titleweight": "bold",
                         "svg.hashsalt": "keating-profile-information-fixture-v1"})
    return deepcopy, mo, np, palette, pd, plt, profile_math, ume


@app.cell
def _(mo):
    mo.md("""# What would another answer tell us?

    **AUTHORED FIXTURE · 0 real people.** The profile, preference evidence,
    answer, likelihoods, utilities, and costs here are invented arithmetic inputs.
    These are not human findings or calibrated predictions about a person.
    Controls change memory only; this notebook never asks a question or calls a model.

    Research-plan **5.1 → 13.3**: retain a finite set of profile hypotheses,
    update their weights from a supplied answer, then compare questions by their
    expected information and decision value. The calculations call the real
    `profile_information` functions.

    The fixture's recorded preference is **brief explanations**. Its `ask` and
    `try` hypotheses are explicit assumptions about a next move. **Confidence
    remains unknown**, even when an answer makes one hypothesis more probable.
    """)
    return


@app.cell
def _(mo):
    prior_ask = mo.ui.slider(.05, .95, step=.05, value=.6, label="Authored prior weight: ask")
    likelihood_ask = mo.ui.slider(0., 1., step=.05, value=.8, label="P(clarification | ask), authored")
    likelihood_try = mo.ui.slider(0., 1., step=.05, value=.2, label="P(clarification | try), authored")
    supplied_answer = mo.ui.dropdown(["clarification", "attempt", "missing"], value="clarification",
                                     label="Supplied authored answer")
    unknown_likelihood = mo.ui.checkbox(False, label="Treat the try hypothesis's likelihoods as unknown")
    mo.vstack([mo.md("## 1. Supply an authored answer"), prior_ask, likelihood_ask,
               likelihood_try, supplied_answer, unknown_likelihood,
               mo.md("Each complete row uses `P(attempt) = 1 − P(clarification)`. "
                     "Checking unknown replaces the entire try row with nulls.")])
    return likelihood_ask, likelihood_try, prior_ask, supplied_answer, unknown_likelihood


@app.cell
def _(deepcopy, likelihood_ask, likelihood_try, prior_ask, profile_math, supplied_answer, ume, unknown_likelihood):
    authored_template = profile_math.authored_fixture()
    _original = authored_template["update"]["profile"]
    _raw = {key: deepcopy(_original[key]) for key in profile_math.PROFILE_FIELDS}
    _raw["hypotheses"][0]["weight"] = prior_ask.value
    _raw["hypotheses"][1]["weight"] = 1 - prior_ask.value
    _raw["weight_provenance"] = {
        "kind": "authored_assumption", "source": "analysis/profile_information.py prior control v1"}
    before_profile = ume.prepare_profiles(_original["evidence"], [_raw], origin="authored_fixture")[_raw["person_id"]]

    question_model = deepcopy(authored_template["update"]["model"])
    question_model["profile_sha256"] = before_profile["profile_sha256"]
    question_model["provenance"] = {
        "kind": "authored_assumption", "source": "analysis/profile_information.py likelihood controls v1"}
    question_model["likelihoods"] = {
        "ask": {"clarification": likelihood_ask.value, "attempt": 1 - likelihood_ask.value},
        "try": {"clarification": likelihood_try.value, "attempt": 1 - likelihood_try.value},
    }
    if unknown_likelihood.value:
        question_model["likelihoods"]["try"] = {"clarification": None, "attempt": None}
    _observation = deepcopy(authored_template["update"]["observation"])
    _observation["value"] = None if supplied_answer.value == "missing" else supplied_answer.value
    answer_update = profile_math.update_profile(before_profile, question_model, _observation)
    information = profile_math.expected_information_gain(before_profile, question_model)
    return answer_update, authored_template, before_profile, information, question_model


@app.cell
def _(answer_update, before_profile, mo, np, palette, pd, plt):
    _after = answer_update["posterior_profile"]
    _before_weights = {h["id"]: h["weight"] for h in before_profile["hypotheses"]}
    _after_weights = {h["id"]: h["weight"] for h in _after["hypotheses"]}
    _names = list(_before_weights)
    _x = np.arange(len(_names))
    _updated = answer_update["status"] == "updated"
    _after_label = "After authored answer" if _updated else "Unchanged: update abstained"
    _fig, _ax = plt.subplots(figsize=(8, 3.5))
    _ax.bar(_x - .18, [_before_weights[h] for h in _names], .36,
            color=palette["prior"], label="Before answer")
    # Only an exact zero posterior can remove a hypothesis; abstentions keep the prior.
    _ax.bar(_x + .18, [_after_weights.get(h, 0.) for h in _names], .36,
            color=palette["posterior"], label=_after_label)
    _ax.set(xticks=_x, xticklabels=_names, ylim=(0, 1.08), ylabel="Hypothesis weight",
            title="Authored profile weights · 0 real people")
    _ax.legend(loc="upper center", ncols=2, fontsize=9)
    _fig.tight_layout()
    _evidence = answer_update["evidence_probability"]
    _evidence_text = "unavailable" if _evidence is None else f"{_evidence:.4f}"
    _status = "updated" if _updated else f"abstained: {answer_update['reason']}"
    _traits = [{"hypothesis": h["id"], "weight": h["weight"],
                "brief preference": "retained authored evidence",
                "confidence": "unknown", "next move": "authored assumption",
                "answer record": "authored evidence appended" if _updated else "none appended"}
               for h in _after["hypotheses"]]
    mo.vstack([
        mo.md(f"""**Update: {_status}.** Model probability of the supplied answer:
        **{_evidence_text}**. Profile entropy: **{answer_update['prior_entropy_nats']:.3f} →
        {answer_update['posterior_entropy_nats']:.3f} nats**.

        `update_profile` computes weights proportional to **prior × likelihood**.
        Missing answers or likelihoods preserve unknowns. An impossible answer
        causes abstention; it does not create a successful observation. Try both
        likelihood sliders at zero with a clarification answer.
        """),
        _fig, mo.ui.table(pd.DataFrame(_traits), selection=None),
    ])
    return


@app.cell
def _(before_profile, information, mo, np, palette, pd, plt, profile_math, question_model):
    _fig, _ax = plt.subplots(figsize=(8, 3.6))
    _ax.set_title("Authored next-answer prediction · 0 real people")
    if information["status"] == "computed":
        _table = profile_math.likelihood_model(before_profile, question_model)
        _branches = information["branches"]
        _names = [_b["outcome"] for _b in _branches]
        _x = np.arange(len(_names))
        _ax.bar(_x - .24, [_table["ask"][a] for a in _names], .24,
                label="Conditional on ask", color=palette["prior"], alpha=.65)
        _ax.bar(_x, [_table["try"][a] for a in _names], .24,
                label="Conditional on try", color=palette["information"], alpha=.65)
        _ax.bar(_x + .24, [_b["probability"] for _b in _branches], .24,
                label="Profile mixture", color=palette["posterior"])
        _ax.set(xticks=_x, xticklabels=_names, ylim=(0, 1.12), ylabel="Probability before seeing the answer")
        _ax.legend(loc="upper center", ncols=3, fontsize=8)
        _answer_entropy = profile_math.entropy({b["outcome"]: b["probability"]
                                                for b in _branches if b["probability"] > 0})
        _explanation = mo.md(f"""Answer entropy: **{_answer_entropy:.3f} nats**.
        Expected profile entropy after an answer: **{information['expected_posterior_entropy_nats']:.3f} nats**.
        Information gain: **{information['information_gain_nats']:.3f} nats**.

        A variable reply is not necessarily informative about a profile. Set both
        likelihood sliders to 0.5: replies are uncertain, but the hypotheses make
        identical predictions, so expected information gain is zero. A single
        answer can increase profile entropy; the expected change averages all answers.
        """)
        _rows = [{"possible answer": b["outcome"], "probability": b["probability"],
                  "ask posterior": b["posterior_weights"].get("ask", 0.) if b["posterior_weights"] else None,
                  "try posterior": b["posterior_weights"].get("try", 0.) if b["posterior_weights"] else None,
                  "profile entropy (nats)": b["entropy_nats"],
                  "status": b["reason"] or "counterfactual only"} for b in _branches]
        _branch_view = mo.ui.table(pd.DataFrame(_rows), selection=None)
    else:
        _ax.set_axis_off()
        _ax.text(.5, .5, "Prediction and information gain unavailable\nUnknown likelihoods remain unknown",
                 ha="center", va="center", transform=_ax.transAxes, color=palette["muted"])
        _explanation = mo.md(f"**Abstained: {information['reason']}.** No complete predictive distribution is available.")
        _branch_view = mo.md("No counterfactual posterior is fabricated.")
    _fig.tight_layout()
    mo.vstack([mo.md("""## 2. Inspect predictive uncertainty

        `expected_information_gain` starts from the **before-answer profile**.
        It enumerates possible answers and their posterior weights without adding
        any evidence. These are hypothetical branches, not repeated observed answers.
        """), _fig, _explanation, _branch_view])
    return


@app.cell
def _(mo):
    question_seconds = mo.ui.slider(0, 60, step=1, value=2, label="Authored help-choice cost (seconds)")
    utility_per_second = mo.ui.slider(0., .1, step=.005, value=.01, label="Authored utility points per second")
    utility_per_nat = mo.ui.slider(0., 1., step=.05, value=.1, label="Authored utility points per nat")
    identical_decision = mo.ui.checkbox(False, label="Use one action with the same utility under both hypotheses")
    mo.vstack([mo.md("""## 3. Is a question worth asking?

    Compare help-choice with a free, uninformative question whose answer
    probabilities are 0.5 under either hypothesis. Selection uses the same
    **before-answer profile**. Utilities are authored scores; costs are hypothetical
    seconds. No time, money, or provider calls are spent by the calculation.
    """), question_seconds, utility_per_second, utility_per_nat, identical_decision])
    return identical_decision, question_seconds, utility_per_nat, utility_per_second


@app.cell
def _(authored_template, before_profile, deepcopy, identical_decision, profile_math, question_model,
      question_seconds, utility_per_nat, utility_per_second):
    _decision = deepcopy(authored_template["selection"]["decision"])
    _decision["profile_sha256"] = before_profile["profile_sha256"]
    if identical_decision.value:
        _decision["actions"] = {"same_action": {"ask": .7, "try": .7}}
    _decision["provenance"] = {
        "kind": "authored_assumption", "source": "analysis/profile_information.py decision control v1"}
    _policy = deepcopy(authored_template["selection"]["policy"])
    _policy["utility_per_nat"] = utility_per_nat.value
    _policy["utility_per_cost_unit"] = utility_per_second.value
    _policy["provenance"] = {
        "kind": "authored_assumption", "source": "analysis/profile_information.py cost controls v1"}
    _uninformative = deepcopy(authored_template["selection"]["questions"][1]["model"])
    _uninformative["profile_sha256"] = before_profile["profile_sha256"]
    _questions = [{"model": question_model, "cost": {"amount": question_seconds.value, "unit": "second"}},
                  {"model": _uninformative, "cost": {"amount": 0., "unit": "second"}}]
    selection_result = profile_math.select_question(before_profile, _questions, _decision, _policy)
    return (selection_result,)


@app.cell
def _(mo, np, palette, pd, plt, selection_result):
    _questions = selection_result["questions"]
    _x = np.arange(len(_questions))
    _labels = ["Help-choice" if q["question_id"] == "help-choice" else "Uninformative" for q in _questions]
    _fig, (_info_ax, _value_ax) = plt.subplots(1, 2, figsize=(10, 3.8))
    _info_values = [q["information"]["information_gain_nats"] for q in _questions]
    _info_ax.bar(_x, [v if v is not None else np.nan for v in _info_values],
                 color=palette["information"], width=.5)
    _info_ax.set(title="Expected information", ylabel="Nats", ylim=(0, .75))
    for _i, _q in enumerate(_questions):
        if _q["net_score"] is None:
            _info_ax.text(_i, .03, "unknown", ha="center", color=palette["muted"])
            _value_ax.text(_i, 0, "not evaluated", ha="center", va="bottom", color=palette["muted"], fontsize=8)
            continue
        _gain = _q["expected_utility_gain"]
        _information_value = _q["information_value"]
        _value_ax.bar(_i, _gain, width=.5, color=palette["posterior"], label="Decision gain")
        _value_ax.bar(_i, _information_value, bottom=_gain, width=.5,
                      color=palette["information"], label="Information value")
        _value_ax.bar(_i, -_q["cost_value"], width=.5,
                      color=palette["cost"], label="Cost penalty")
        _value_ax.scatter([_i], [_q["net_score"]], color=palette["muted"], marker="D", zorder=4,
                          label="Net score")
    for _ax in (_info_ax, _value_ax):
        _ax.set_xticks(_x, _labels)
        _ax.set_xlim(-.6, len(_questions) - .4)
    _value_ax.axhline(0, color=palette["muted"], lw=1)
    _value_ax.set(title="Decision value after cost", ylabel="Authored utility points")
    # Keep roundoff near zero from filling the whole chart. Raw scores remain in
    # the table; only the viewport has a minimum span, with no score clipping.
    _known = [q for q in _questions if q["net_score"] is not None]
    _bottom = min([-.05, *[-q["cost_value"] for q in _known]])
    _top = max([.05, *[q["expected_utility_gain"] + q["information_value"] for q in _known]])
    _value_ax.set_ylim(_bottom * 1.3, _top * 1.3)
    _handles, _legend_names = _value_ax.get_legend_handles_labels()
    _legend = dict(zip(_legend_names, _handles))
    if _legend:
        _value_ax.legend(_legend.values(), _legend.keys(), fontsize=7, loc="best")
    _fig.suptitle("Authored question comparison · 0 real people", fontsize=13, fontweight="bold")
    _fig.tight_layout()
    _chosen = selection_result["selected_question_id"] or "none — abstained"
    _rows = [{"question": q["question_id"], "information (nats)": q["information"]["information_gain_nats"],
              "decision gain": q["expected_utility_gain"], "seconds": q["cost"]["amount"],
              "net utility": q["net_score"], "eligible": q["eligible"],
              "reason": q["reason"] or "positive decision gain and net value"} for q in _questions]
    mo.vstack([_fig, mo.md(f"""**Selected question: {_chosen}.**

    `net score = decision gain + (utility/nat × information) − (utility/second × seconds)`.
    Information and time get explicit conversions to the same utility unit.
    The no-question option scores zero. A question also needs positive decision
    gain: selecting the same-action control makes even an informative question
    ineligible. Raising the cost can make asking nothing preferable.
    """), mo.ui.table(pd.DataFrame(_rows), selection=None)])
    return


@app.cell
def _(answer_update, before_profile, mo, pd, selection_result):
    mo.vstack([mo.md("""## Inspect the bindings

    Changing authored weights creates a newly admitted profile and explicitly
    rebinds this fixture's likelihood and decision models. A real archived record
    must retain its original bindings. `update_profile` retains the answer's
    provenance and source ancestry; counterfactual question branches add no evidence.
    """), mo.ui.table(pd.DataFrame([
        {"record": "Before-answer profile", "sha256": before_profile["profile_sha256"]},
        {"record": "Returned profile", "sha256": answer_update["posterior_profile"]["profile_sha256"]},
        {"record": "Likelihood model", "sha256": answer_update["likelihood_sha256"]},
        {"record": "Decision model", "sha256": selection_result["decision_sha256"]},
    ]), selection=None), mo.md("""All displayed evidence remains authored: **0 real people**.
    Real respondent evidence, likelihood calibration, consent eligibility, and
    revocation remain external. See `docs/profile-information.md` for the contracts.

    Offline smoke, using the repository's existing dependency cache:

    ```sh
    rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv MPLBACKEND=Agg uv run --offline --script analysis/profile_information.py
    ```
    """)])
    return


if __name__ == "__main__":
    app.run()
