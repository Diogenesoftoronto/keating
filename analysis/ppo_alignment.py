# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2,<3",
#     "pandas==2.*",
#     "marimo==0.23.1",
#     "matplotlib==3.10.*",
# ]
# ///
"""Sampler/trainer alignment diagnostics, and why the prompt mask matters.

Wraps scripts/training/ppo_diagnostics.py, which is pure stdlib. Nothing here
touches the network, a checkpoint, or the budget ledger.
"""

import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import math
    import random
    import sys
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt

    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts" / "training"))

    from ppo_diagnostics import completion_alignment

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
        "svg.hashsalt": "keating-ppo-alignment-notebook-v1",
    })
    return BLUE, GRAY, ORANGE, PALE, PURPLE, TEAL, completion_alignment, math, mo, plt, random


@app.cell
def _(mo):
    mo.md(
        r"""
        # Sampler / trainer alignment

        When a rollout is sampled and then scored again for training, the two logprob
        vectors should agree if they came from the same checkpoint on the same tokens.
        `completion_alignment(...)` measures the disagreement — and is careful about
        *which* positions it measures.

        The subtlety it exists to expose: the trainer's target vector starts at the
        **second prompt token**, so the completion begins at index `prompt_token_count - 1`.
        Compare the full vector instead, with zeros standing in for prompt positions, and
        the summary statistics move a long way for no real reason. Both are computed
        below, side by side.

        `kl_sample_train_v2` here is `0.5 * mean(difference^2)` — a first-order proxy,
        not an exact distribution KL. The module's own caveats are printed verbatim at
        the end rather than paraphrased.
        """
    )
    return


@app.cell
def _(mo):
    prompt_count = mo.ui.slider(2, 400, value=120, label="Prompt tokens")
    completion_count = mo.ui.slider(4, 400, value=60, label="Completion tokens")
    trainer_drift = mo.ui.slider(0.0, 0.6, step=0.005, value=0.02,
                                 label="Rollout vs trainer drift (sigma)")
    sampler_drift = mo.ui.slider(0.0, 0.6, step=0.005, value=0.01,
                                 label="Rollout vs current sampler drift (sigma)")
    align_seed = mo.ui.number(0, 9999, value=11, label="Seed")
    mo.vstack([prompt_count, completion_count, trainer_drift, sampler_drift, align_seed])
    return align_seed, completion_count, prompt_count, sampler_drift, trainer_drift


@app.cell
def _(
    align_seed,
    completion_alignment,
    completion_count,
    prompt_count,
    random,
    sampler_drift,
    trainer_drift,
):
    source = random.Random(align_seed.value)

    def nudge(values, sigma):
        # Logprobs must stay finite and nonpositive; _logprobs() rejects anything above zero.
        return [min(value + source.gauss(0.0, sigma), -1e-12) for value in values]

    rollout_lp = [-(abs(source.gauss(0.55, 0.32)) + 0.01) for _ in range(completion_count.value)]
    prompt_targets = [-(abs(source.gauss(0.8, 0.4)) + 0.01) for _ in range(prompt_count.value - 1)]
    trainer_completion = nudge(rollout_lp, trainer_drift.value)
    training_targets = prompt_targets + trainer_completion
    sampler_lp = nudge(rollout_lp, sampler_drift.value)

    report = completion_alignment(
        prompt_count.value, completion_count.value, rollout_lp, training_targets, sampler_lp
    )
    return report, rollout_lp, trainer_completion


@app.cell
def _(mo, report):
    completion_only = report["completion_only"]
    unmasked = report["unmasked_zero_prompt_reference"]
    inflation = (
        unmasked["kl_sample_train_v2"] / completion_only["kl_sample_train_v2"]
        if completion_only["kl_sample_train_v2"] else float("inf")
    )
    mo.md(
        f"""
        ### Masked completion versus the zero-filled full vector

        | Metric | Completion only | Full vector, prompt zero-filled |
        |---|---|---|
        | tokens compared | {completion_only["tokens"]} | {unmasked["tokens"]} |
        | `kl_sample_train_v2` | **{completion_only["kl_sample_train_v2"]:.6f}** | **{unmasked["kl_sample_train_v2"]:.6f}** |
        | mean abs logprob difference | {completion_only["mean_abs_logprob_difference"]:.4f} | {unmasked["mean_abs_logprob_difference"]:.4f} |
        | p95 abs difference | {completion_only["p95_abs_logprob_difference"]:.4f} | {unmasked["p95_abs_logprob_difference"]:.4f} |
        | fraction ratio outside 0.8-1.2 | {completion_only["fraction_ratio_outside_0_8_to_1_2"]:.1%} | {unmasked["fraction_ratio_outside_0_8_to_1_2"]:.1%} |

        `prompt_target_tokens_excluded` = **{report["prompt_target_tokens_excluded"]}**;
        completion is **{report["completion_fraction_of_target_positions"]:.1%}** of target positions.

        The zero-filled reading is **{inflation:.1f}x** the real one here — entirely an
        artifact of counting prompt positions the model was never scored on. Drag the
        prompt slider up and watch the gap widen.
        """
    )
    return


@app.cell
def _(BLUE, GRAY, ORANGE, math, plt, report, rollout_lp, trainer_completion):
    ratios = [math.exp(-(sampled - evaluated))
              for sampled, evaluated in zip(rollout_lp, trainer_completion)]
    outside = report["completion_only"]["fraction_ratio_outside_0_8_to_1_2"]

    fig_ratio, ax_ratio = plt.subplots(figsize=(7.2, 4))
    ax_ratio.hist(ratios, bins=36, color=BLUE, edgecolor="white")
    ax_ratio.axvspan(0.8, 1.2, color=GRAY, alpha=0.16, label="0.8-1.2 band")
    ax_ratio.axvline(0.8, color=ORANGE, linewidth=1.4)
    ax_ratio.axvline(1.2, color=ORANGE, linewidth=1.4)
    ax_ratio.axvline(1.0, color=GRAY, linewidth=1, linestyle=":")
    ax_ratio.set_xlabel("Probability ratio, exp(trainer - rollout)")
    ax_ratio.set_ylabel("Completion tokens")
    ax_ratio.set_title(f"Ratio spread: {outside:.1%} of tokens fall outside 0.8-1.2")
    ax_ratio.legend(frameon=False)
    fig_ratio.tight_layout()
    fig_ratio
    return


@app.cell
def _(BLUE, PURPLE, TEAL, ORANGE, plt, report):
    views = [
        ("completion only\n(rollout vs trainer)", report["completion_only"], BLUE),
        ("rollout vs\ncurrent sampler", report["rollout_vs_current_sampler"], TEAL),
        ("current sampler\nvs trainer", report["current_sampler_vs_trainer"], PURPLE),
        ("full vector\n(zero-filled prompt)", report["unmasked_zero_prompt_reference"], ORANGE),
    ]
    fig_kl, ax_kl = plt.subplots(figsize=(7.2, 4))
    ax_kl.bar(
        [name for name, _, _ in views],
        [metrics["kl_sample_train_v2"] for _, metrics, _ in views],
        color=[color for _, _, color in views],
    )
    for position, (_, metrics, _) in enumerate(views):
        ax_kl.text(position, metrics["kl_sample_train_v2"],
                   f'{metrics["kl_sample_train_v2"]:.5f}',
                   ha="center", va="bottom", fontsize=9)
    ax_kl.set_ylabel("kl_sample_train_v2")
    ax_kl.set_title("The same rollout, measured four ways")
    ax_kl.tick_params(axis="x", labelsize=9)
    fig_kl.tight_layout()
    fig_kl
    return


@app.cell
def _(mo, report):
    mo.md(
        "### Limitations, quoted from `ppo_diagnostics.completion_alignment`\n\n"
        + "\n".join(f"- {line}" for line in report["limitations"])
        + "\n\nThe module states no numeric pass gate, and neither does this notebook. "
        "A near-zero completion-only reading is *consistent with* same-checkpoint "
        "token alignment; comparing different checkpoints measures policy change and "
        "must not be reported as an alignment check."
    )
    return


if __name__ == "__main__":
    app.run()
