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
"""Pricing the pilot's reserved tokens, against a synthetic in-memory ledger.

READ-ONLY BY CONSTRUCTION. This notebook builds a ledger dict in memory and hands
it to estimate_cost.estimate(). It never opens the real budget file and never
calls PilotBudget.reserve(), so it cannot move the authorized $100 cap.
"""

import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt

    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts" / "training"))

    from estimate_cost import RATES, SOURCE, estimate
    from pilot_budget import PilotBudget

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
        "svg.hashsalt": "keating-pilot-costs-notebook-v1",
    })
    return BLUE, GRAY, ORANGE, PilotBudget, PURPLE, RATES, SOURCE, TEAL, estimate, mo, plt


@app.cell
def _(PilotBudget, RATES, SOURCE, mo):
    mo.md(
        f"""
        # What the pilot reserves, and what it would actually cost

        Two different rate tables govern the pilot, and confusing them is the easiest
        mistake to make here:

        | | prefill | sample | train |
        |---|---|---|---|
        | `PilotBudget` reserves at | {PilotBudget.PREFILL} | {PilotBudget.SAMPLE} | {PilotBudget.TRAIN} |
        | `estimate_cost.RATES` prices at | {RATES["prefill"]} | {RATES["sample"]} | {RATES["train"]} |
        | ratio | {PilotBudget.PREFILL / RATES["prefill"]:.0f}x | {PilotBudget.SAMPLE / RATES["sample"]:.0f}x | {PilotBudget.TRAIN / RATES["train"]:.0f}x |

        USD per million tokens. The ledger reserves at **undiscounted list price**; the
        estimator prices at the rate actually being charged, which already includes the
        temporary 50% discount (`estimate_cost.py` warns: "Do not halve again"). On top
        of that, every reservation carries a **{PilotBudget.SAFETY_FACTOR}x** safety
        factor. Reserved dollars are therefore about
        **{2 * PilotBudget.SAFETY_FACTOR}x** the expected token bill, by design —
        the ledger is meant to run out long before the money does.

        Price source: {SOURCE}

        > This notebook builds its ledger in memory. It does not read or write
        > `budget.json`, and `PilotBudget.reserve()` is never called.
        """
    )
    return


@app.cell
def _(mo):
    prefill_tokens = mo.ui.slider(0, 20_000_000, step=100_000, value=4_000_000,
                                  label="Prefill tokens reserved")
    sample_tokens = mo.ui.slider(0, 10_000_000, step=50_000, value=1_200_000,
                                 label="Sampled output tokens reserved")
    train_tokens = mo.ui.slider(0, 10_000_000, step=50_000, value=900_000,
                                label="Training tokens reserved")
    cap_usd = mo.ui.slider(1, 100, value=100, label="Authorized cap (USD)")
    mo.vstack([prefill_tokens, sample_tokens, train_tokens, cap_usd])
    return cap_usd, prefill_tokens, sample_tokens, train_tokens


@app.cell
def _(PilotBudget, cap_usd, estimate, prefill_tokens, sample_tokens, train_tokens):
    # Mirrors PilotBudget's pessimistic arithmetic without touching the real ledger.
    reserved_usd = PilotBudget.SAFETY_FACTOR * (
        prefill_tokens.value * PilotBudget.PREFILL
        + sample_tokens.value * PilotBudget.SAMPLE
        + train_tokens.value * PilotBudget.TRAIN
    ) / 1_000_000

    synthetic_ledger = {
        "model": PilotBudget.MODEL,
        "cap_usd": cap_usd.value,
        "reserved_usd": reserved_usd,
        "events": [{
            # Same shape PilotBudget.reserve() appends (pilot_budget.py:53).
            "operation": "synthetic-notebook-event",
            "reserved_usd": reserved_usd,
            "prefill_tokens": int(prefill_tokens.value),
            "sample_tokens": int(sample_tokens.value),
            "train_tokens": int(train_tokens.value),
        }],
    }
    cost_report = estimate(synthetic_ledger)
    scenarios = cost_report["cache_scenarios"]
    return cost_report, reserved_usd, scenarios


@app.cell
def _(cap_usd, cost_report, mo, reserved_usd, scenarios):
    no_cache = scenarios[0]["token_total_usd"]
    full_cache = scenarios[-1]["token_total_usd"]
    headroom = cap_usd.value - reserved_usd
    mo.md(
        f"""
        ### This reservation

        - Safety reservation against the cap: **${reserved_usd:,.2f}** of **${cap_usd.value}**
          ({reserved_usd / cap_usd.value:.0%} consumed, **${headroom:,.2f}** left)
        - Priced token cost, no prefill cache hits: **${no_cache:,.2f}**
        - Priced token cost, every prefill cached: **${full_cache:,.2f}**
        - Ratio of reserved to priced (no cache): **{reserved_usd / no_cache:.1f}x**

        {"**The reservation alone exceeds the cap.** A real run would be refused before dispatch." if headroom < 0 else "Within cap."}

        Rates verified **{cost_report["prices_verified_on"]}**, with a
        **{cost_report["temporary_discount_already_applied"]:.0%}** provider discount
        already baked into them.

        `actual_billed_usd` is `{cost_report["actual_billed_usd"]}` and
        `measured_cache_hit_fraction` is `{cost_report["measured_cache_hit_fraction"]}` —
        the module leaves both null on purpose. These are scenarios, not invoices.
        """
    )
    return


@app.cell
def _(BLUE, ORANGE, TEAL, plt, scenarios):
    labels = [f'{item["assumed_prefill_cache_hit_fraction"]:.0%}' for item in scenarios]
    prefill_usd = [item["prefill_usd"] for item in scenarios]
    sample_usd = [item["sample_usd"] for item in scenarios]
    train_usd = [item["train_usd"] for item in scenarios]

    fig_stack, ax_stack = plt.subplots(figsize=(7.2, 4))
    ax_stack.bar(labels, prefill_usd, color=BLUE, label="prefill")
    ax_stack.bar(labels, sample_usd, bottom=prefill_usd, color=TEAL, label="sample")
    ax_stack.bar(labels, train_usd,
                 bottom=[p + s for p, s in zip(prefill_usd, sample_usd)],
                 color=ORANGE, label="train")
    for position, item in enumerate(scenarios):
        ax_stack.text(position, item["token_total_usd"], f'${item["token_total_usd"]:,.2f}',
                      ha="center", va="bottom", fontsize=9)
    ax_stack.set_xlabel("Assumed prefill cache hit fraction")
    ax_stack.set_ylabel("USD")
    ax_stack.set_title("Priced token cost by cache scenario")
    ax_stack.legend(frameon=False)
    fig_stack.tight_layout()
    fig_stack
    return


@app.cell
def _(GRAY, PURPLE, cap_usd, plt, reserved_usd, scenarios):
    fractions = [item["assumed_prefill_cache_hit_fraction"] for item in scenarios]
    totals = [item["token_total_usd"] for item in scenarios]

    fig_gap, ax_gap = plt.subplots(figsize=(7.2, 4))
    ax_gap.plot(fractions, totals, color=PURPLE, marker="o", linewidth=2,
                label="priced token cost")
    ax_gap.axhline(reserved_usd, color=GRAY, linewidth=1.6, linestyle="--",
                   label=f"safety reservation ${reserved_usd:,.2f}")
    ax_gap.axhline(cap_usd.value, color=GRAY, linewidth=1.6, linestyle=":",
                   label=f"authorized cap ${cap_usd.value}")
    ax_gap.fill_between(fractions, totals, [reserved_usd] * len(totals),
                        color=GRAY, alpha=0.12)
    ax_gap.set_xlabel("Assumed prefill cache hit fraction")
    ax_gap.set_ylabel("USD")
    ax_gap.set_title("Reservation headroom: shaded area is padding, not spend")
    ax_gap.legend(frameon=False)
    fig_gap.tight_layout()
    fig_gap
    return


@app.cell
def _(cost_report, mo):
    mo.md(
        "### Limitations, quoted from `estimate_cost.estimate`\n\n"
        + "\n".join(f"- {line}" for line in cost_report["limitations"])
    )
    return


@app.cell
def _(mo):
    import sys as _sys

    _leaked = [name for name in ("torch", "tinker", "tinker_cookbook", "httpx") if name in _sys.modules]
    mo.md(
        f"""
        ### Isolation check

        Heavy or network-capable modules loaded in this kernel: **{_leaked or "none"}**.

        `pilot_budget` and `estimate_cost` import only stdlib plus `typer`, so reaching
        the provider from this notebook is not possible. Spending against the real
        ledger goes through the CLI, which reserves before it dispatches.
        """
    )
    return


if __name__ == "__main__":
    app.run()
