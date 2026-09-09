#!/usr/bin/env python3
"""Compare a saved sampler and restored trainer without gradients or updates."""
from typing import Annotated
import typer
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from pilot_budget import PilotBudget
from ppo_diagnostics import completion_alignment
from sdpo_math import datum_vectors


def write_private(path, value):
    temporary = path.with_suffix(".next")
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(value, output, indent=2, allow_nan=False)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(
    run_dir: Annotated[Path, typer.Option("--run-dir")],
    project_id: Annotated[str | None, typer.Option("--project-id", help="Omit to use the same default project as the pilot")] = None,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
):
    # Reuse the existing authorization ledger; never create or raise a cap.
    budget_path = run_dir / "budget.json"
    budget_state = json.loads(budget_path.read_text())
    if budget_state.get("model") != PilotBudget.MODEL:
        raise ValueError("Budget is not for the pilot model")
    budget = PilotBudget(budget_path, budget_state["cap_usd"])
    checkpoint_path = run_dir / "checkpoint.json"
    if not checkpoint_path.exists():
        checkpoint_path = run_dir / "result.json"
    checkpoint = json.loads(checkpoint_path.read_text())
    state_path, sampler_path = checkpoint["training_state_path"], checkpoint["sampler_path"]
    if not state_path.startswith("tinker://") or not sampler_path.startswith("tinker://"):
        raise ValueError("Expected saved Tinker state and sampler paths")
    rollout_path = run_dir / "rollout-0.json"
    rollout = json.loads(rollout_path.read_text())
    prompt, tokens, old_lps = rollout["prompt_tokens"], rollout["completion_tokens"], rollout["rollout_logprobs"]
    vectors = datum_vectors(prompt, tokens, old_lps, [0.0] * len(tokens))
    preflight = json.loads((run_dir / "preflight.json").read_text())
    if preflight.get("model") != PilotBudget.MODEL:
        raise ValueError("Run model does not match budget")
    output_path = run_dir / "alignment-diagnostic.json"
    if output_path.exists():
        raise ValueError("Alignment diagnostic already exists; refusing a duplicate paid run")
    request_summary = {
        "prompt_tokens": len(prompt), "completion_tokens": len(tokens),
        "sampler_prefill_tokens": len(prompt) + len(tokens),
        "trainer_forward_tokens": len(vectors["input_tokens"]),
        "estimated_additional_reservation_usd": PilotBudget.SAFETY_FACTOR * (
            (len(prompt) + len(tokens)) * PilotBudget.PREFILL
            + len(vectors["input_tokens"]) * PilotBudget.TRAIN) / 1_000_000,
        "budget_cap_usd": budget_state["cap_usd"],
        "budget_reserved_usd": budget_state["reserved_usd"],
        "optimizer_updates": 0,
    }
    if dry_run:
        print(json.dumps(request_summary))
        return
    if not os.environ.get("TINKER_API_KEY"):
        raise ValueError("Server-side TINKER_API_KEY required")
    import tinker

    with budget.reserve("alignment-load-existing-state"):
        service = tinker.ServiceClient(project_id=project_id, user_metadata={
            "owner_did": preflight["owner_did"], "product": "keating",
            "purpose": "forward-only-sampler-trainer-alignment",
        })
        trainer = service.create_training_client_from_state(state_path)
        sampler = service.create_sampling_client(model_path=sampler_path)
    full = tinker.ModelInput.from_ints(prompt + tokens)
    with budget.reserve("alignment-sampler-logprobs", prefill=full.length):
        sampler_full_lps = sampler.compute_logprobs(full).result()
    if len(sampler_full_lps) != len(prompt) + len(tokens):
        raise ValueError("Sampler logprob sequence length mismatch")
    sampler_lps = sampler_full_lps[len(prompt):]
    datum = tinker.Datum(
        model_input=tinker.ModelInput.from_ints(vectors["input_tokens"]),
        loss_fn_inputs={
            "target_tokens": tinker.TensorData(data=vectors["target_tokens"], dtype="int64"),
            "weights": tinker.TensorData(data=vectors["weights"], dtype="float32"),
        },
    )
    with budget.reserve("alignment-trainer-forward-only", train=len(vectors["input_tokens"])):
        forward = trainer.forward([datum], loss_fn="cross_entropy").result()
    training_lps = list(forward.loss_fn_outputs[0]["logprobs"].data)
    diagnostic = completion_alignment(len(prompt), len(tokens), old_lps, training_lps, sampler_lps)
    artifact = {
        "schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
        "owner_did": preflight["owner_did"], "model": preflight["model"],
        "rollout_checkpoint": rollout["rollout_checkpoint"],
        "evaluated_sampler_path": sampler_path, "restored_training_state_path": state_path,
        "rollout_sha256": hashlib.sha256(rollout_path.read_bytes()).hexdigest(),
        "checkpoint_record_sha256": hashlib.sha256(checkpoint_path.read_bytes()).hexdigest(),
        "execution": "trainer.forward cross_entropy; no backward or optimizer calls",
        "request_summary": request_summary, "diagnostic": diagnostic,
        "current_sampler_completion_logprobs": sampler_lps,
        "trainer_completion_logprobs": training_lps[len(prompt) - 1:],
        "provider_forward_metrics": forward.metrics,
        "limitations": [
            "Measures final checkpoint sampler/trainer alignment on one historical rollout.",
            "Does not reconstruct the discarded first-update backward outputs.",
            "Old rollout versus final checkpoint differences include intended policy changes.",
            "No model quality or learning-effectiveness conclusion follows from this diagnostic.",
        ],
    }
    write_private(output_path, artifact)
    print(json.dumps({"output": str(output_path),
                      "current_sampler_vs_trainer": diagnostic["current_sampler_vs_trainer"],
                      "optimizer_updates": 0}))


if __name__ == "__main__":
    app()
