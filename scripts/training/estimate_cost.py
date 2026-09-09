"""Price the pilot's reserved token quantities, separately from its safety reserve."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import typer

from pilot_budget import PilotBudget


# Published Inkling-Small 64K prices, verified 2026-09-06.
# These ALREADY include the temporary 50% discount. Do not halve again.
RATES = {"prefill": 0.58, "cached_prefill": 0.116, "sample": 1.44, "train": 1.73}
SOURCE = "https://tinker-docs.thinkingmachines.ai/tinker/models/"


def estimate(ledger):
    if ledger.get("model") != PilotBudget.MODEL:
        raise ValueError("Prices apply only to Inkling-Small 64K")
    counts = {kind: 0 for kind in ("prefill", "sample", "train")}
    for event in ledger["events"]:
        for kind in counts:
            quantity = event[kind + "_tokens"]
            if type(quantity) is not int or quantity < 0:
                raise ValueError("Invalid reserved token count")
            counts[kind] += quantity
    scenarios = []
    for hit_fraction in (0, 0.5, 0.8, 1):
        prefill = counts["prefill"] * (
            (1 - hit_fraction) * RATES["prefill"] + hit_fraction * RATES["cached_prefill"]
        ) / 1_000_000
        sample = counts["sample"] * RATES["sample"] / 1_000_000
        train = counts["train"] * RATES["train"] / 1_000_000
        scenarios.append({"assumed_prefill_cache_hit_fraction": hit_fraction,
                          "prefill_usd": prefill, "sample_usd": sample,
                          "train_usd": train, "token_total_usd": prefill + sample + train})
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": ledger["model"], "price_source": SOURCE,
        "prices_verified_on": "2026-09-06", "temporary_discount_already_applied": 0.5,
        "rates_usd_per_million": RATES,
        "reserved_token_counts": counts,
        "safety_reservation_usd": ledger["reserved_usd"],
        "authorized_cap_usd": ledger["cap_usd"],
        "actual_billed_usd": None, "measured_cache_hit_fraction": None,
        "cache_scenarios": scenarios,
        "limitations": [
            "Scenarios price local token reservations, not actual provider usage or an invoice.",
            "Cache fractions are scenarios, not measured hits; repeated prompts do not prove hits.",
            "Output counts are request maxima; failed requests remain reserved.",
            "Forward-only alignment is conservatively retained at the training rate.",
            "Caching discounts apply only to prefill, not training or generated output.",
            "Checkpoint storage is additional at USD 0.10/GB-month; GB-hours are not yet known.",
            "The safety reservation includes padding and storage buffers and is not estimated spend.",
        ],
    }


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(budget_file: Path = typer.Option(...), output: Path = typer.Option(...)):
    if budget_file.resolve() == output.resolve():
        raise ValueError("The cost report must not overwrite the authorization ledger")
    report = estimate(json.loads(budget_file.read_text()))
    fd = os.open(output, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
    print(json.dumps({"report": str(output), "cache_scenarios": report["cache_scenarios"]}))


if __name__ == "__main__":
    app()
