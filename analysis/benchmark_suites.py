# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2,<3",
#     "pandas==2.*",
#     "marimo==0.23.1",
#     "matplotlib==3.10.*",
#     "typer>=0.12",
# ]
# ///
"""The frozen teaching benchmarks: what is in them, and what running one costs.

Reads the suites under scripts/training/benchmarks/. Both loaders verify a
sha256 manifest as they read, so this notebook doubles as an integrity check.
No model is called and nothing is written.
"""

import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from collections import Counter
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt

    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts" / "training"))

    import benchmark as bench
    import benchmark_v3 as bench_v3

    SUITES = ROOT / "scripts" / "training" / "benchmarks"

    # House palette, matching scripts/render-case-study-charts.py.
    INK, MUTED, GRID = "#254e63", "#536570", "#dce4e8"
    BLUE, TEAL, ORANGE = "#0072B2", "#00836B", "#C97900"
    PURPLE, GRAY, PALE = "#93679F", "#89969C", "#eef3f5"
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "text.color": INK,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "axes.edgecolor": GRID,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.spines.left": False,
        "axes.titlesize": 12,
        "axes.titleweight": "bold",
        "axes.titlecolor": INK,
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "svg.hashsalt": "keating-benchmark-suites-notebook-v1",
    })
    return BLUE, Counter, GRAY, ORANGE, PURPLE, SUITES, TEAL, bench, bench_v3, mo, plt


@app.cell
def _(mo):
    mo.md(
        """
        # The frozen teaching benchmarks

        Five suites live under `scripts/training/benchmarks/`, and they are **two
        different generations with two different loaders**. Knowing which is which is
        the first thing to understand here:

        | | suites | loader | shape |
        |---|---|---|---|
        | v1 / v2 | `teaching-v1`, `teaching-v2` | `benchmark.load_suite` | single-turn; needs `cases.json` + `rubric.json` + `context.json` |
        | v3 family | `teaching-v3`, `-natural`, `-profiles` | `benchmark_v3.load_cases` | multi-turn episodes; ships `cases.json` only |

        Pointing `load_suite` at a v3 directory fails immediately — the rubric and
        frozen-context files it requires were never part of that schema. They are not
        the same benchmark in two formats; they measure different things.

        **Both loaders verify sha256 as they read.** `load_suite` checks every frozen
        file against `manifest.json`; `load_cases` checks `cases.json` against its own
        manifest entry and refuses to continue on a mismatch ("Frozen case definition
        changed; version the suite explicitly"). If the cells below run at all, the
        suites on disk are byte-identical to what was frozen.
        """
    )
    return


@app.cell
def _(mo):
    suite_name = mo.ui.dropdown(["teaching-v1", "teaching-v2"], value="teaching-v1",
                                label="Suite (single-turn generation)")
    subset = mo.ui.radio(["core", "full"], value="core", label="Subset", inline=True)
    temperature = mo.ui.slider(0.0, 2.0, step=0.05, value=0.1, label="Temperature")
    seed = mo.ui.number(0, 9999, value=42, label="Seed")
    input_rate = mo.ui.slider(0.1, 10.0, step=0.01, value=1.16,
                              label="Input rate (USD per million)")
    output_rate = mo.ui.slider(0.1, 20.0, step=0.01, value=2.88,
                               label="Output rate (USD per million)")
    mo.vstack([suite_name, subset, temperature, seed, input_rate, output_rate])
    return input_rate, output_rate, seed, subset, suite_name, temperature


@app.cell
def _(SUITES, bench, input_rate, output_rate, seed, subset, suite_name, temperature):
    suite = bench.load_suite(SUITES / suite_name.value)
    plan = bench.make_plan(suite, subset.value, temperature.value, int(seed.value))
    estimate = bench.estimate_cost(plan, input_rate.value, output_rate.value)
    return estimate, plan, suite


@app.cell
def _(estimate, mo, plan, suite):
    mo.md(
        f"""
        ### {suite["cases_doc"]["title"]}

        {suite["cases_doc"]["description"]}

        - Benchmark id: `{suite["cases_doc"]["benchmark_id"]}` (version
          {suite["cases_doc"]["version"]}, status **{suite["cases_doc"]["status"]}**)
        - Cases in suite: **{len(suite["cases"])}**, of which
          **{len(suite["cases_doc"]["core_case_ids"])}** are core
        - Selected by this plan: **{len(plan["case_ids"])}**
        - Reserved for one run: **${estimate["reserved_usd"]:,.2f}** at a
          **{estimate["safety_factor"]}x** safety factor

        **Evaluation unit.** {plan["evaluation_unit"]}

        The plan is content-addressed end to end — `suite_sha256`
        `{plan["suite_sha256"][:16]}…`, `settings_sha256`
        `{plan["settings_sha256"][:16]}…`, `plan_sha256`
        `{plan["plan_sha256"][:16]}…`. Move the temperature or seed slider and the
        settings and plan digests change, but the suite digest does not. That is the
        point: results are only comparable when all three match.

        > {estimate["accounting"]}
        """
    )
    return


@app.cell
def _(BLUE, ORANGE, estimate, plt):
    _rows = sorted(estimate["cases"], key=lambda item: item["reserved_usd"])
    _names = [item["case_id"] for item in _rows]
    _reserved = [item["reserved_usd"] for item in _rows]
    _allowance = [item["input_token_allowance"] for item in _rows]

    _fig, (_ax_cost, _ax_tokens) = plt.subplots(
        1, 2, figsize=(11, max(3.2, 0.26 * len(_rows) + 1.4)), sharey=True
    )
    _ax_cost.barh(_names, _reserved, color=BLUE)
    _ax_cost.set_xlabel("USD reserved")
    _ax_cost.set_title("Reserved per case")
    _ax_tokens.barh(_names, _allowance, color=ORANGE)
    _ax_tokens.set_xlabel("Input token allowance")
    _ax_tokens.set_title("Allowance per case")
    _ax_tokens.tick_params(axis="y", labelleft=False)
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo):
    mo.md(
        """
        The allowance is deliberately crude: `estimate_cost` measures the canonical
        JSON payload in **UTF-8 bytes plus a 4096-token framing margin**, not
        `chars / 4`. Its own comment explains why — third-party tokenization and
        billing differ, so an over-estimate that is honest about being an estimate
        beats a precise-looking number that is wrong in the provider's favour.
        """
    )
    return


@app.cell
def _(Counter, PURPLE, plt, suite):
    dimension_labels = {key: value["label"] for key, value in suite["rubric"]["dimensions"].items()}
    coverage = Counter()
    for _case in suite["cases"]:
        coverage.update(_case["rubric"].keys())
    _ordered = sorted(coverage.items(), key=lambda item: item[1])

    _fig, _ax = plt.subplots(figsize=(7.6, 0.34 * len(_ordered) + 1.6))
    _ax.barh([item[0] for item in _ordered], [item[1] for item in _ordered], color=PURPLE)
    _ax.set_xlabel("Cases scoring this dimension")
    _ax.set_title("Rubric dimension coverage")
    _fig.tight_layout()
    _fig
    return coverage, dimension_labels


@app.cell
def _(coverage, dimension_labels, mo, suite):
    mo.md(
        f"""
        ### What the rubric actually measures

        {chr(10).join(f"- **{name}** — {label} ({coverage.get(name, 0)} cases)"
                      for name, label in dimension_labels.items())}

        Scale: `{suite["rubric"]["scale"]}`. Not every case scores every dimension;
        a case declares only the dimensions it is built to discriminate, and
        `load_suite` rejects any case naming a dimension the rubric does not define.

        **The rubric's own limitations, quoted:**

        {chr(10).join(f"- {line}" for line in suite["rubric"]["limitations"])}
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## The v3 generation: multi-turn episodes

        v3 cases are not single prompts. Each is a scripted episode of 4–12 learner
        turns, with a rubric attached to *evidence steps* — a rule names which turns
        may be used as evidence for scoring it. `load_cases` enforces that every
        `evidence_steps` index is in range, that criteria keys are exactly
        `{"0", "1", "2"}`, and that any `state_checks` path stays under `.keating/`.
        """
    )
    return


@app.cell
def _(SUITES, bench_v3):
    v3_names = ["teaching-v3", "teaching-v3-natural", "teaching-v3-profiles"]
    v3_suites = {name: bench_v3.load_cases(SUITES / name / "cases.json") for name in v3_names}
    v3_rows = [
        {
            "suite": name,
            "cases": len(cases),
            "families": len({case["family"] for case in cases}),
            "categories": len({case["category"] for case in cases}),
            "median steps": sorted(len(case["steps"]) for case in cases)[len(cases) // 2],
            "rubric rules": sum(len(case["rubric"]) for case in cases),
            "state checks": sum(len(case["state_checks"]) for case in cases),
        }
        for name, cases in v3_suites.items()
    ]
    return v3_rows, v3_suites


@app.cell
def _(mo, v3_rows):
    mo.vstack([mo.md("### The three v3 suites"), mo.ui.table(v3_rows, selection=None)])
    return


@app.cell
def _(Counter, GRAY, TEAL, plt, v3_suites):
    _fig, (_ax_steps, _ax_dims) = plt.subplots(1, 2, figsize=(11, 4.6))

    for _offset, (_name, _cases) in enumerate(v3_suites.items()):
        # The loader bounds *message* steps, not total steps: a case may also
        # carry non-message steps (state checks and the like) beyond these.
        _lengths = [sum(step["kind"] == "message" for step in case["steps"])
                    for case in _cases]
        _ax_steps.scatter([_offset + 0.0] * len(_lengths), _lengths, alpha=0.45,
                          color=TEAL, s=38)
    _ax_steps.set_xticks(range(len(v3_suites)))
    _ax_steps.set_xticklabels([name.replace("teaching-", "") for name in v3_suites],
                              fontsize=9)
    _ax_steps.axhline(4, color=GRAY, linestyle="--", linewidth=1.2)
    _ax_steps.axhline(12, color=GRAY, linestyle="--", linewidth=1.2)
    _ax_steps.set_ylabel("Message steps per case")
    _ax_steps.set_title("Episode length (loader enforces 4–12)")

    _coverage = Counter()
    for _suite_cases in v3_suites.values():
        for _case in _suite_cases:
            _coverage.update(rule["dimension"] for rule in _case["rubric"])
    _ordered = sorted(_coverage.items(), key=lambda item: item[1])
    _ax_dims.barh([item[0] for item in _ordered], [item[1] for item in _ordered],
                  color=TEAL)
    _ax_dims.set_xlabel("Rules across all v3 suites")
    _ax_dims.set_title("v3 dimensions")
    _ax_dims.tick_params(axis="y", labelsize=8)

    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo, v3_suites):
    _sample = v3_suites["teaching-v3-profiles"][0]
    _opening = next(step for step in _sample["steps"] if step.get("kind") == "message")
    _rule = _sample["rubric"][0]
    mo.md(
        f"""
        ### One case, end to end

        **{_sample["title"]}** (`{_sample["id"]}`, family `{_sample["family"]}`,
        category `{_sample["category"]}`)

        Opening learner turn:

        > {_opening["text"]}

        First rubric rule — dimension **{_rule["dimension"]}**, scored on steps
        `{_rule.get("evidence_steps")}`:

        | score | criterion |
        |---|---|
        | 0 | {_rule["criteria"]["0"]} |
        | 1 | {_rule["criteria"]["1"]} |
        | 2 | {_rule["criteria"]["2"]} |

        The case also fixes `reference.facts` and an explicit
        `contextual_inference_limit`, so a reviewer can tell a wrong answer from an
        answer that merely went beyond what the transcript supports.
        """
    )
    return


if __name__ == "__main__":
    app.run()
