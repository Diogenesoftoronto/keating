#!/usr/bin/env python3
"""Bounded identity SFT branch and paired checks; shares the original pilot budget."""
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import typer

from pilot_budget import PilotBudget
from run_tinker import write_json
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


def identity_match(text):
    words = " ".join(text.casefold().split())
    return "keating bot" in words and "latest version" in words


def load_dataset(directory, parent):
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["base_model"] != parent["model"] or manifest["base_model"] != PilotBudget.MODEL:
        raise ValueError("Dataset and checkpoint base models differ")
    if manifest["system_prompt_sha256"] != parent["system_prompt_sha256"]:
        raise ValueError("Identity training must keep the existing Keating system prompt")
    rows = {}
    for split in ("train", "validation"):
        body = (directory / f"{split}.jsonl").read_bytes()
        if hashlib.sha256(body).hexdigest() != manifest["output_sha256"][f"{split}.jsonl"]:
            raise ValueError("Dataset artifact hash mismatch")
        rows[split] = [json.loads(line) for line in body.splitlines()]
        if not rows[split]:
            raise ValueError("Empty dataset split")
    if {r["family"] for r in rows["train"]} & {r["family"] for r in rows["validation"]}:
        raise ValueError("Training and validation question families overlap")
    expected_tools = rows["train"][0]["tools"]
    for row in rows["train"] + rows["validation"]:
        if [m["role"] for m in row["messages"]] != ["system", "user", "assistant"]:
            raise ValueError("Expected single-turn supervised messages")
        if hashlib.sha256(row["messages"][0]["content"].encode()).hexdigest() != manifest["system_prompt_sha256"]:
            raise ValueError("A dataset row changed the system prompt")
        if row["tools"] != expected_tools:
            raise ValueError("A dataset row changed the tool declarations")
    return rows, manifest


@app.command()
def main(
    dataset: Path = typer.Option(..., exists=True, file_okay=False),
    parent_run: Path = typer.Option(..., exists=True, file_okay=False),
    run_dir: Path = typer.Option(...),
    epochs: int = typer.Option(2, min=1, max=4),
    learning_rate: float = typer.Option(1e-4),
    batch_size: int = typer.Option(10, min=1, max=10),
    short_context_repeats: int = typer.Option(0, min=0, max=4),
    budget_file: Path | None = typer.Option(None, exists=True, dir_okay=False),
    dry_run: bool = typer.Option(False, "--dry-run"),
):
    """Train a bounded SFT branch and compare identity without changing the prompt."""
    if not 1 <= epochs <= 4 or not math.isfinite(learning_rate) or not 0 < learning_rate <= 3e-4:
        raise ValueError("Bounded pilot allows 1-4 epochs and learning rate at most 3e-4")
    parent = json.loads((parent_run / "result.json").read_text())
    budget_path = budget_file or parent_run / "budget.json"
    ledger = json.loads(budget_path.read_text())
    budget = PilotBudget(budget_path, ledger["cap_usd"])
    rows, manifest = load_dataset(dataset, parent)
    import tinker
    from tinker_cookbook import renderers, tokenizer_utils
    from tinker_cookbook.supervised.common import datum_from_model_input_weights
    tokenizer = tokenizer_utils.get_tokenizer(parent["model"])
    renderer = renderers.get_renderer(parent["renderer"], tokenizer, model_name=parent["model"])

    def messages(row, include_answer=True):
        result = list(row["messages"] if include_answer else row["messages"][:-1])
        result.insert(1, {"role": "tool_declare", "content": json.dumps(row["tools"], separators=(",", ":"))})
        return result

    datums = {}
    for split in rows:
        datums[split] = []
        for row in rows[split]:
            tokens, weights = renderer.build_supervised_example(messages(row),
                train_on_what=renderers.TrainOnWhat.LAST_ASSISTANT_MESSAGE, effort=parent["effort"])
            if tokens.length > 32768 or weights.sum().item() <= 0:
                raise ValueError("Invalid supervised token bound or empty assistant target")
            datums[split].append(datum_from_model_input_weights(tokens, weights, reduction="mean"))
    # Supplement the same training answers with short contexts so identity does
    # not depend exclusively on a long roleplay prompt. No validation answer is
    # used, and application evaluation still uses the unchanged original prompt.
    supplemental = []
    for row in rows["train"]:
        if {"identity", "generative_learning"} & set(row["sources"]):
            tokens, weights = renderer.build_supervised_example(row["messages"][1:],
                train_on_what=renderers.TrainOnWhat.LAST_ASSISTANT_MESSAGE, effort=parent["effort"])
            supplemental.append(datum_from_model_input_weights(tokens, weights, reduction="mean"))
    datums["train"].extend(supplemental * short_context_repeats)
    tokens_per_epoch = sum(d.model_input.length for d in datums["train"])
    preflight = {"base_model": parent["model"], "public_model_id": manifest["public_model_id"],
        "owner_did": parent["owner_did"], "epochs": epochs,
        "learning_rate": learning_rate, "batch_size": batch_size,
        "short_context_repeats": short_context_repeats,
        "supplemental_training_examples": len(supplemental) * short_context_repeats,
        "counts": manifest["counts"], "training_tokens_per_epoch": tokens_per_epoch,
        "training_reservation_usd": epochs * tokens_per_epoch * PilotBudget.TRAIN * PilotBudget.SAFETY_FACTOR / 1e6,
        "budget_file": str(budget_path.resolve()), "cap_usd": budget.cap,
        "prior_reservation_usd": ledger["reserved_usd"],
        "system_prompt_sha256": parent["system_prompt_sha256"],
        "identity_instruction_added_to_system_prompt": False}
    if dry_run:
        print(json.dumps(preflight))
        return
    if not os.environ.get("TINKER_API_KEY"):
        raise ValueError("Server-held Tinker key is required")
    run_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    write_json(run_dir / "preflight.json", preflight)
    write_json(run_dir / "dataset-manifest.json", manifest)
    metadata = {"owner_did": parent["owner_did"], "product": "keating", "purpose": "identity-sft"}
    with budget.reserve("identity-sft-checkpoint-storage", fixed_usd=1):
        service = tinker.ServiceClient(user_metadata=metadata)
        # Branch weights, deliberately start a fresh SFT optimizer rather than
        # carrying the earlier PPO optimizer's moments into this objective.
        trainer = service.create_training_client_from_state(parent["training_state_path"], user_metadata=metadata)
    baseline = service.create_sampling_client(model_path=parent["sampler_path"])

    def evaluate(sampler, label):
        evidence = []
        cases = [(r["id"], "application", r["messages"][1]["content"], messages(r, False)) for r in rows["validation"]]
        # No identity in either the system prompt or the neutral questions.
        for question in ("Who are you?", "What is your name?", "Which assistant am I speaking with?"):
            cases.append(("neutral-" + str(len(cases)), "no-system-prompt", question,
                          [{"role": "user", "content": question}]))
        cases.append(("control-arithmetic", "application-control", "What is 7 times 8? Answer briefly.",
                      messages(rows["validation"][0], False)[:-1] + [{"role": "user", "content": "What is 7 times 8? Answer briefly."}]))
        for case_id, mode, question, conversation in cases:
            prompt = renderer.build_generation_prompt(conversation, effort=parent["effort"])
            with budget.reserve("identity-" + label + "-sample", prefill=prompt.length, sample=256):
                sequence = sampler.sample(prompt, num_samples=1, sampling_params=tinker.SamplingParams(
                    max_tokens=256, temperature=0, seed=42, stop=renderer.get_stop_sequences())).result().sequences[0]
            response = renderer.parse_response(sequence.tokens)[0]
            text = renderers.get_text_content(response)
            evidence.append({"case_id": case_id, "mode": mode, "question": question,
                             "response": response, "identity_match": identity_match(text),
                             "stop_reason": sequence.stop_reason, "output_tokens": len(sequence.tokens)})
            write_json(run_dir / (label + ".json"), evidence)
        return evidence

    baseline_evidence = evaluate(baseline, "baseline")
    metrics = []
    for epoch in range(epochs):
        for start in range(0, len(datums["train"]), batch_size):
            batch = datums["train"][start:start + batch_size]
            with budget.reserve("identity-sft-update", train=sum(d.model_input.length for d in batch)):
                backward = trainer.forward_backward(batch, loss_fn="cross_entropy").result()
                trainer.optim_step(tinker.AdamParams(learning_rate=learning_rate)).result()
            metrics.append({"epoch": epoch + 1, "batch_start": start, "provider_metrics": backward.metrics})
            write_json(run_dir / "steps.json", metrics)
            print(json.dumps({"completed_epoch": epoch + 1, "batch_start": start}), flush=True)
        state = trainer.save_state(f"identity-epoch-{epoch+1}", ttl_seconds=86400).result().path
        sampler_path = trainer.save_weights_for_sampler(f"identity-epoch-{epoch+1}", ttl_seconds=86400).result().path
        write_json(run_dir / "checkpoint.json", {"training_state_path": state, "sampler_path": sampler_path})
    candidate = service.create_sampling_client(model_path=sampler_path)
    candidate_evidence = evaluate(candidate, "candidate")
    def identity_score(evidence, mode):
        ids = {"v01", "v09", "v10"}
        selected = [e for e in evidence if e["mode"] == mode and (mode == "no-system-prompt" or e["case_id"] in ids)]
        return {"matched": sum(e["identity_match"] for e in selected), "total": len(selected)}
    scores = {label: {mode: identity_score(evidence, mode) for mode in ("application", "no-system-prompt")}
              for label, evidence in (("baseline", baseline_evidence), ("candidate", candidate_evidence))}
    learned = scores["candidate"]["application"]["matched"] > scores["baseline"]["application"]["matched"]
    result = {**parent, "public_model_id": manifest["public_model_id"], "public_model_name": manifest["public_model_name"],
        "sampler_path": sampler_path, "training_state_path": state, "parent_sampler_path": parent["sampler_path"],
        "baseline_path": parent["sampler_path"], "method": "supervised-identity-faq",
        "budget_file": str(budget_path.resolve()), "dataset_id": manifest["dataset_id"],
        "identity_scores": scores, "identity_improvement_verified": learned,
        "quality_improvement_verified": False, "epochs": epochs,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "limitations": ["Small authored FAQ seed, not evidence of general teaching improvement",
                        "Exact same application prompt before and after; neutral probes have no system prompt",
                        "Substring identity checks require reading the saved responses for semantic confirmation",
                        "Tool execution and broad tutoring regression evaluation are separate gates"]}
    result.pop("resumed_sampler_path", None)
    write_json(run_dir / "result.json", result)
    print(json.dumps({"identity_scores": scores, "identity_improvement_verified": learned,
                      "run_dir": str(run_dir)}), flush=True)


if __name__ == "__main__":
    app()
