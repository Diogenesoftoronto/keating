# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2,<3",
#     "pandas==2.*",
#     "marimo==0.23.1",
#     "matplotlib==3.10.*",
# ]
# ///
"""How the pilot turns teacher/student logprobs into clipped token advantages.

Wraps scripts/training/sdpo_math.py, which is pure stdlib. Nothing here touches
the network, a checkpoint, or the budget ledger.
"""

import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import random
    import sys
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt

    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts" / "training"))

    from sdpo_math import datum_vectors, prepare_advantages

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
        "svg.hashsalt": "keating-sdpo-advantages-notebook-v1",
    })
    return (
        GRAY,
        GRID,
        INK,
        MUTED,
        ORANGE,
        PALE,
        PURPLE,
        TEAL,
        BLUE,
        datum_vectors,
        mo,
        plt,
        prepare_advantages,
        random,
    )


@app.cell
def _(mo):
    mo.md(
        r"""
        # SDPO advantages: teacher minus student

        `prepare_advantages(teacher_logprobs, current_logprobs, running_mean_abs)`
        is the whole of the pilot's credit assignment. It does four things, in order:

        1. **Difference.** `raw = teacher - student`, per token. A positive value means
           the teacher found the token more likely than the student did.
        2. **Track scale.** An exponential moving average of the *unclipped* mean
           absolute advantage, `alpha = 0.1`, seeded from the first batch.
        3. **Clip symmetrically** at `3 x EMA`.
        4. **Deliberately not** center or standardize — the docstring says so, and the
           chart below shows the batch mean staying wherever the data put it.

        The EMA and the `3x` multiple are constants inside the module, so the sliders
        below drive its *inputs*. The one alpha slider is labelled "what-if" and feeds
        a shadow trace only; it never changes what `prepare_advantages` computes.
        """
    )
    return


@app.cell
def _(mo):
    n_tokens = mo.ui.slider(8, 512, value=96, label="Completion tokens per batch")
    spread = mo.ui.slider(0.02, 2.0, step=0.02, value=0.35, label="Teacher-student spread (sigma)")
    n_outliers = mo.ui.slider(0, 24, value=4, label="Strong-disagreement tokens per batch")
    n_batches = mo.ui.slider(1, 60, value=15, label="Successive batches")
    rng_seed = mo.ui.number(0, 9999, value=7, label="Seed")
    shadow_alpha = mo.ui.slider(0.01, 0.9, step=0.01, value=0.1, label="What-if EMA alpha (shadow trace only)")
    mo.vstack([n_tokens, spread, n_outliers, n_batches, rng_seed, shadow_alpha])
    return n_batches, n_outliers, n_tokens, rng_seed, shadow_alpha, spread


@app.cell
def _(
    n_batches,
    n_outliers,
    n_tokens,
    prepare_advantages,
    random,
    rng_seed,
    shadow_alpha,
    spread,
):
    def synthetic_batch(stream):
        """Plausible logprobs: both models confident, teacher occasionally far off."""
        teacher, student = [], []
        for index in range(n_tokens.value):
            base = -(abs(stream.gauss(2.2, 0.9)) + 0.05)
            gap = stream.gauss(0.0, spread.value) * (8.0 if index < n_outliers.value else 1.0)
            student.append(base)
            # Logprobs must stay nonpositive; _finite() rejects anything above zero.
            teacher.append(min(base + gap, -1e-12))
        return teacher, student

    source = random.Random(rng_seed.value)
    running, shadow, batch_trace, last_batch = None, None, [], None
    for _ in range(n_batches.value):
        teacher_lp, student_lp = synthetic_batch(source)
        clipped_adv, running, metrics = prepare_advantages(teacher_lp, student_lp, running)
        shadow = (
            metrics["batch_mean_abs"]
            if shadow is None
            else (1 - shadow_alpha.value) * shadow + shadow_alpha.value * metrics["batch_mean_abs"]
        )
        batch_trace.append({**metrics, "shadow_mean_abs": shadow})
        last_batch = (teacher_lp, student_lp, clipped_adv, metrics)

    raw_last = [t - s for t, s in zip(last_batch[0], last_batch[1])]
    return batch_trace, last_batch, raw_last


@app.cell
def _(last_batch, mo, raw_last):
    final = last_batch[3]
    multiple = final["clip_threshold"] / final["running_mean_abs"] if final["running_mean_abs"] else float("nan")
    mo.md(
        f"""
        ### The module's own numbers, read back from its metrics dict

        | Invariant | Measured |
        |---|---|
        | `ema_alpha` | **{final["ema_alpha"]}** |
        | `clip_threshold / running_mean_abs` | **{multiple:.6f}** |
        | Batch mean advantage (would be 0 if centered) | **{sum(raw_last) / len(raw_last):+.4f}** |

        Final batch: **{final["tokens"]}** tokens, **{final["clipped_tokens"]}** clipped
        (**{final["clipped_fraction"]:.1%}**). Largest magnitude
        **{final["max_abs_before"]:.3f}** before clipping, **{final["max_abs_after"]:.3f}** after.
        """
    )
    return


@app.cell
def _(BLUE, GRAY, ORANGE, last_batch, plt, raw_last):
    threshold = last_batch[3]["clip_threshold"]
    fig_dist, ax_dist = plt.subplots(figsize=(7.2, 4))
    ax_dist.hist(raw_last, bins=40, color=BLUE, edgecolor="white", label="raw teacher - student")
    ax_dist.axvline(threshold, color=ORANGE, linewidth=1.6, label=f"clip at +/-3 x EMA = +/-{threshold:.3f}")
    ax_dist.axvline(-threshold, color=ORANGE, linewidth=1.6)
    ax_dist.axvspan(threshold, max(max(raw_last), threshold), color=GRAY, alpha=0.18)
    ax_dist.axvspan(min(min(raw_last), -threshold), -threshold, color=GRAY, alpha=0.18)
    ax_dist.set_xlabel("Token advantage")
    ax_dist.set_ylabel("Tokens")
    ax_dist.set_title("Raw advantages and the symmetric clip band (final batch)")
    ax_dist.legend(frameon=False)
    fig_dist.tight_layout()
    fig_dist
    return


@app.cell
def _(GRAY, ORANGE, PURPLE, TEAL, batch_trace, plt):
    steps = range(1, len(batch_trace) + 1)
    fig_ema, ax_ema = plt.subplots(figsize=(7.2, 4))
    ax_ema.plot(steps, [m["batch_mean_abs"] for m in batch_trace], color=GRAY,
                linewidth=1, linestyle=":", label="per-batch mean |advantage|")
    ax_ema.plot(steps, [m["running_mean_abs"] for m in batch_trace], color=TEAL,
                linewidth=2, label="running EMA (alpha 0.1, as coded)")
    ax_ema.plot(steps, [m["shadow_mean_abs"] for m in batch_trace], color=PURPLE,
                linewidth=1.6, linestyle="--", label="what-if EMA (slider; not used by the code)")
    ax_ema.set_xlabel("Batch")
    ax_ema.set_ylabel("Mean |advantage|")
    ax_ema.set_title("The EMA smooths batch noise; the clip band follows it")
    ax_ema.legend(frameon=False, loc="upper left")

    ax_clip = ax_ema.twinx()
    ax_clip.plot(steps, [m["clipped_fraction"] for m in batch_trace], color=ORANGE, linewidth=1.4)
    ax_clip.set_ylabel("Clipped fraction", color=ORANGE)
    ax_clip.tick_params(axis="y", colors=ORANGE)
    ax_clip.spines["right"].set_visible(True)
    ax_clip.spines["right"].set_color(ORANGE)
    fig_ema.tight_layout()
    fig_ema
    return


@app.cell
def _(mo):
    mo.md(
        r"""
        ## How the trainer actually sees a rollout

        `datum_vectors(prompt_tokens, completion_tokens, rollout_logprobs, advantages)`
        packs one training datum. Two things happen at once, and the grid below is the
        clearest way to see them:

        - **Causal shift.** Inputs are every token but the last; targets are every token
          but the first. Position *i* predicts the token at *i + 1*.
        - **Prompt mask.** The first `len(prompt) - 1` target positions are prompt tokens
          the model was never asked to produce, so their weight, advantage, and logprob
          are all zero-filled. Only completion targets carry gradient.

        Shaded columns are masked. The teal rule marks the first completion target.
        """
    )
    return


@app.cell
def _(mo):
    prompt_len = mo.ui.slider(2, 10, value=4, label="Prompt tokens")
    completion_len = mo.ui.slider(1, 10, value=5, label="Completion tokens")
    mo.hstack([prompt_len, completion_len], justify="start")
    return completion_len, prompt_len


@app.cell
def _(GRID, INK, MUTED, PALE, TEAL, completion_len, datum_vectors, plt, prompt_len):
    prompt_ids = [101 + offset for offset in range(prompt_len.value)]
    completion_ids = [901 + offset for offset in range(completion_len.value)]
    rollout_lp = [-0.15 - 0.11 * offset for offset in range(len(completion_ids))]
    token_adv = [round(0.9 - 0.4 * offset, 3) for offset in range(len(completion_ids))]
    vectors = datum_vectors(prompt_ids, completion_ids, rollout_lp, token_adv)

    grid_rows = [
        ("input_tokens", vectors["input_tokens"], "{:d}"),
        ("target_tokens", vectors["target_tokens"], "{:d}"),
        ("weights", vectors["weights"], "{:.0f}"),
        ("advantages", vectors["advantages"], "{:+.2f}"),
        ("logprobs", vectors["logprobs"], "{:+.2f}"),
    ]
    span = len(vectors["input_tokens"])
    fig_grid, ax_grid = plt.subplots(figsize=(max(6.5, 0.95 * span), 3.4))
    for row_index, (row_label, row_values, row_format) in enumerate(grid_rows):
        row_y = len(grid_rows) - 1 - row_index
        for col_index, cell_value in enumerate(row_values):
            is_masked = vectors["weights"][col_index] == 0.0
            ax_grid.add_patch(plt.Rectangle(
                (col_index, row_y), 1, 1,
                facecolor=PALE if is_masked else "white", edgecolor=GRID, linewidth=1))
            ax_grid.text(col_index + 0.5, row_y + 0.5, row_format.format(cell_value),
                         ha="center", va="center", fontsize=9,
                         color=MUTED if is_masked else INK)
        ax_grid.text(-0.25, row_y + 0.5, row_label, ha="right", va="center", fontsize=9, color=MUTED)

    boundary = len(prompt_ids) - 1
    ax_grid.plot([boundary, boundary], [0, len(grid_rows)], color=TEAL, linewidth=2)
    ax_grid.text(boundary, len(grid_rows) + 0.18, "first completion target",
                 color=TEAL, fontsize=9, ha="center")
    ax_grid.set_xlim(-2.4, span)
    ax_grid.set_ylim(0, len(grid_rows) + 0.7)
    ax_grid.axis("off")
    ax_grid.set_title("datum_vectors: causal shift with prompt targets masked")
    fig_grid.tight_layout()
    fig_grid
    return


@app.cell
def _(completion_len, mo, prompt_len):
    mo.md(
        f"""
        With **{prompt_len.value}** prompt and **{completion_len.value}** completion tokens,
        every vector has length **{prompt_len.value + completion_len.value - 1}**
        (`len(prompt) + len(completion) - 1`), of which
        **{prompt_len.value - 1}** leading positions are masked and
        **{completion_len.value}** carry gradient.

        Try setting the prompt to 2 tokens: exactly one masked column remains, which is
        the minimum the causal shift can produce.
        """
    )
    return


if __name__ == "__main__":
    app.run()
