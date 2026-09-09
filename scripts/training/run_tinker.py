#!/usr/bin/env python3
"""Bounded account-owned SDPO-inspired Tinker pilot, using fresh hint-seeded rollouts.

This is not a reproduction of Trajectory SDPO++ or a production learning service.
Historical feedback is teacher-only context about a historical answer. No old
answer is represented as a rollout from the trainable model.
"""
from typing import Annotated
import typer
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re

from pilot_budget import PilotBudget
from sdpo_math import prepare_advantages, datum_vectors
from ppo_diagnostics import completion_alignment


MODEL = PilotBudget.MODEL
RENDERER = "tml_v0"
EFFORT = 0.1


def write_json(path, value):
    path = Path(path)
    temp = path.with_suffix(".next")
    fd = os.open(temp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(value, output, ensure_ascii=False, indent=2,
                  default=lambda obj: obj.model_dump(mode="json"))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temp, path)


def read_seed(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    splits = {}
    for split in ("train", "validation"):
        path = directory / f"{split}.jsonl"
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != manifest["output_sha256"][path.name]:
            raise ValueError("Seed hash mismatch")
        rows = [json.loads(line) for line in body.splitlines() if line.strip()]
        if not rows or any(r["split"] != split for r in rows):
            raise ValueError("Seed split is empty or mislabeled")
        splits[split] = rows
    if {r["family_id"] for r in splits["train"]} & {r["family_id"] for r in splits["validation"]}:
        raise ValueError("Training/validation families overlap")
    return splits, manifest


def messages_for(row, system_prompt, hinted=False, tools=None):
    messages = [{"role": "system", "content": system_prompt}]
    if tools:
        messages.append({"role": "tool_declare", "content": json.dumps(tools, separators=(",", ":"), allow_nan=False)})
    if hinted:
        # The actual Keating system message is byte-identical for teacher and
        # student. Retrospective feedback is separate, teacher-only input data.
        context = json.dumps({"historical_response": row["historical_response"],
                              "later_feedback_on_that_response": row["hint"]}, ensure_ascii=False)
        messages.append({"role": "user", "content":
            "Retrospective feedback on a historical response (training context):\n" + context})
    messages.extend(row["prompt"])
    return messages


def completion_lps(values, prompt_length, count):
    result = values[prompt_length:prompt_length + count]
    if len(result) != count or any(v is None or not math.isfinite(v) or v > 0 for v in result):
        raise ValueError("Missing, misaligned, or invalid completion log probabilities")
    return result


def load_parent(directory, owner_did, prompt_hash, tools_hash, budget_path, cap_usd, allow_prompt_update=False):
    parent = json.loads((directory / "result.json").read_text())
    expected = {"owner_did": owner_did, "model": MODEL, "renderer": RENDERER,
                "effort": EFFORT, "system_prompt_sha256": prompt_hash,
                "tools_sha256": tools_hash}
    if allow_prompt_update:
        expected.pop("system_prompt_sha256")
    if any(parent.get(key) != value for key, value in expected.items()):
        raise ValueError("Parent owner, model, prompt, tools or renderer differs")
    for field, kind in (("training_state_path", "weights"), ("sampler_path", "sampler_weights")):
        if not re.fullmatch(r"tinker://[^/]+/" + kind + r"/[^/]+", parent.get(field, "")):
            raise ValueError("Parent must contain saved training and sampler checkpoints")
    original_budget = Path(parent.get("budget_file", directory / "budget.json"))
    if budget_path.resolve() != original_budget.resolve():
        raise ValueError("A child run must retain its parent's shared budget")
    ledger = json.loads(budget_path.read_text())
    if ledger.get("model") != MODEL or ledger.get("cap_usd") != cap_usd:
        raise ValueError("Parent budget model/cap cannot change")
    return parent


def rollout_batches(steps, batch_size=4):
    if not 1 <= steps <= 32 or not 1 <= batch_size <= 4:
        raise ValueError("Use 1-32 updates and rollout batches of at most four")
    return [list(range(start, min(start + batch_size, steps))) for start in range(0, steps, batch_size)]


def verified_prompt_revision(path, prompt_hash, tools_hash):
    metadata = json.loads(Path(str(path) + ".metadata.json").read_text())
    if metadata.get("verifiedEqualToOriginalWebBuilder") is not True or metadata["promptSha256"] != prompt_hash or metadata["toolSchemas"]["sha256"] != tools_hash:
        raise ValueError("Prompt revision requires a verified application export")
    root = Path(__file__).resolve().parents[2]
    for relative, expected in metadata["sourceSha256"].items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected:
            raise ValueError("Stale application export: " + relative)


def planned_reservation(prompts, rows, steps, max_tokens, parent):
    # Worst-case output lengths, the same undiscounted rates and 5x safety factor
    # as the shared ledger. Keep a separate $2 buffer for subsequent comparison.
    def price(prefill=0, sample=0, train=0):
        return PilotBudget.SAFETY_FACTOR * (prefill * PilotBudget.PREFILL + sample * PilotBudget.SAMPLE + train * PilotBudget.TRAIN) / 1e6
    total = 1.0
    for step in range(steps):
        student, teacher = prompts[rows["train"][step % len(rows["train"])]["id"]]
        total += price(prefill=student.length, sample=max_tokens)
        total += price(prefill=student.length + teacher.length + 2 * max_tokens)
        total += price(train=student.length + max_tokens - 1)
    for row in rows["validation"]:
        prompt = prompts[row["id"]][0]
        total += 2 * price(prefill=prompt.length, sample=max_tokens)
        total += price(prefill=2 * (prompt.length + max_tokens))
    largest = max(p.length for pair in prompts.values() for p in pair)
    total += (7 if parent else 1) * price(prefill=largest, sample=max_tokens)
    return total


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(
    seed_dir: Annotated[Path, typer.Option("--seed-dir")],
    run_dir: Annotated[Path, typer.Option("--run-dir")],
    owner_did: Annotated[str, typer.Option("--owner-did")],
    system_prompt_path: Annotated[Path, typer.Option("--system-prompt", help="Exact prompt exported from the Keating web prompt builder")],
    tools: Annotated[Path, typer.Option("--tools", help="Actual tool schemas exported from Keating")],
    project_id: Annotated[str | None, typer.Option("--project-id")] = None,
    cap_usd: Annotated[float, typer.Option("--cap-usd")] = 100,
    steps: Annotated[int, typer.Option("--steps")] = 2,
    max_tokens: Annotated[int, typer.Option("--max-tokens")] = 1024,
    dry_run: Annotated[bool, typer.Option("--dry-run")] = False,
    finish_existing: Annotated[bool, typer.Option("--finish-existing", help="Finish evaluation/resume from completed updates; retain the same budget")] = False,
    parent_run: Annotated[Path | None, typer.Option("--parent-run", help="Continue SDPO with optimizer state, or branch from SFT with fresh moments")] = None,
    budget_file: Annotated[Path | None, typer.Option("--budget-file", help="Existing shared ledger; required for a child run")] = None,
    allow_prompt_update: Annotated[bool, typer.Option("--allow-prompt-update", help="Record an explicit transition to a verified current application prompt")] = False,
):
    if not re.fullmatch(r"did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.:%_-]+)", owner_did):
        raise ValueError("An actual test account DID is required")
    if not 1 <= steps <= 32 or not 32 <= max_tokens <= 2048:
        raise ValueError("Pilot is limited to 1-32 steps and 32-2048 output tokens")
    if not math.isfinite(cap_usd) or not 0 < cap_usd <= 100:
        raise ValueError("Budget exceeds the authorized USD 100")
    rows, seed_manifest = read_seed(seed_dir)
    system_prompt = system_prompt_path.read_text()
    if not system_prompt.strip():
        raise ValueError("The Keating system prompt is empty")
    prompt_hash = hashlib.sha256(system_prompt.encode()).hexdigest()
    tools_body = tools.read_bytes()
    tool_schemas = json.loads(tools_body)
    if not isinstance(tool_schemas, list) or not tool_schemas or any(
        tool.get("type") != "function" or not tool.get("function", {}).get("name") for tool in tool_schemas
    ):
        raise ValueError("Actual Keating function schemas are required")
    tools_hash = hashlib.sha256(tools_body).hexdigest()
    if parent_run is not None and budget_file is None:
        raise ValueError("A child run requires the existing shared --budget-file")
    budget_path = budget_file or run_dir / "budget.json"
    parent = load_parent(parent_run, owner_did, prompt_hash, tools_hash, budget_path, cap_usd, allow_prompt_update) if parent_run else None
    if allow_prompt_update:
        verified_prompt_revision(system_prompt_path, prompt_hash, tools_hash)
    # Imports do not contact the GPU service. Tokenizer download is public.
    import tinker
    from tinker_cookbook import renderers, tokenizer_utils
    tokenizer = tokenizer_utils.get_tokenizer(MODEL)
    renderer = renderers.get_renderer(RENDERER, tokenizer, model_name=MODEL)
    prompts = {}
    for row in rows["train"] + rows["validation"]:
        prompts[row["id"]] = [renderer.build_generation_prompt(messages_for(row, system_prompt, hint, tool_schemas), effort=EFFORT)
                              for hint in (False, True)]
        if any(p.length + max_tokens > 32768 for p in prompts[row["id"]]):
            raise ValueError("A seed exceeds the pilot token bound; do not silently truncate evidence")
    summary = {"owner_did": owner_did, "model": MODEL, "renderer": RENDERER,
               "steps": steps, "maximum_output_tokens": max_tokens, "effort": EFFORT,
               "seed_counts": {k: len(v) for k, v in rows.items()},
               "maximum_prompt_tokens": max(p.length for pair in prompts.values() for p in pair),
               "cap_usd": cap_usd, "quality_claim": "pipeline proof only"}
    summary["system_prompt_sha256"] = prompt_hash
    summary["tools_sha256"] = tools_hash
    summary["tool_count"] = len(tool_schemas)
    summary["rollout_refresh_interval"] = 4
    summary["planned_maximum_reservation_usd"] = planned_reservation(prompts, rows, steps, max_tokens, parent)
    if budget_path.exists() and not finish_existing:
        ledger = json.loads(budget_path.read_text())
        if ledger["reserved_usd"] + summary["planned_maximum_reservation_usd"] + 2 > cap_usd:
            raise ValueError("Planned run would leave less than $2 for evaluation/serving; reduce --steps")
    if parent:
        summary["parent_system_prompt_sha256"] = parent["system_prompt_sha256"]
        summary["prompt_updated"] = parent["system_prompt_sha256"] != prompt_hash
        summary["optimizer_restored"] = parent.get("method", "").startswith("sdpo")
        summary["parent_sampler_path"] = parent["sampler_path"]
        summary["parent_training_state_path"] = parent["training_state_path"]
        summary["budget_file"] = str(budget_path.resolve())
    if dry_run:
        print(json.dumps(summary))
        return
    if not os.environ.get("TINKER_API_KEY"):
        raise ValueError("Server-side TINKER_API_KEY is required")
    if finish_existing:
        if json.loads((run_dir / "preflight.json").read_text()) != summary:
            raise ValueError("Existing run does not match supplied owner, inputs or configuration")
        if not budget_path.is_file():
            raise ValueError("Existing budget is required")
    else:
        run_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
        write_json(run_dir / "preflight.json", summary)
        write_json(run_dir / "seed-manifest.json", seed_manifest)
        write_json(run_dir / "system-prompt.json", {"text": system_prompt, "sha256": prompt_hash})
        write_json(run_dir / "tool-schemas.json", tool_schemas)
    budget = PilotBudget(budget_path, cap_usd)
    # TTL 24h, rank 16. This intentionally over-reserves storage relative to the
    # small adapter; no unlimited storage retention is enabled by this pilot.
    if not finish_existing:
        with budget.reserve("checkpoint-storage-reserve", fixed_usd=1):
            pass
    metadata = {"owner_did": owner_did, "product": "keating",
                "purpose": "sdpo-pipeline-pilot", "budget_usd": str(cap_usd)}
    service = tinker.ServiceClient(project_id=project_id, user_metadata=metadata)
    def sample(client, prompt, label, seed=42):
        with budget.reserve(label, prefill=prompt.length, sample=max_tokens):
            result = client.sample(prompt, num_samples=1, sampling_params=tinker.SamplingParams(
                max_tokens=max_tokens, temperature=1, top_p=1,
                stop=renderer.get_stop_sequences(), seed=seed,
            )).result()
        sequence = result.sequences[0]
        if not sequence.tokens or sequence.logprobs is None or len(sequence.tokens) != len(sequence.logprobs):
            raise ValueError("Sampling did not return aligned tokens and rollout logprobs")
        return sequence

    if not finish_existing:
        if parent:
            # SDPO is a continuation; SFT starts a new optimizer for PPO.
            restore = service.create_training_client_from_state_with_optimizer if summary["optimizer_restored"] else service.create_training_client_from_state
            trainer = restore(parent["training_state_path"], user_metadata=metadata)
            checkpoint = parent["sampler_path"]
        else:
            trainer = service.create_lora_training_client(MODEL, rank=16, seed=42, user_metadata=metadata)
            checkpoint = trainer.save_weights_for_sampler("baseline", ttl_seconds=86400).result().path
        baseline = service.create_sampling_client(model_path=checkpoint)
        baseline_path = checkpoint
        write_json(run_dir / "baseline.json", {"sampler_path": checkpoint, "owner_did": owner_did})
        metrics, running_mean = [], None
        if parent and summary["optimizer_restored"]:
            parent_steps = json.loads((parent_run / "steps.json").read_text())
            running_mean = parent_steps[-1]["clip"]["running_mean_abs"]

        def fresh_rollouts():
            for batch in rollout_batches(steps):
                batch_checkpoint = checkpoint
                rollout_client = service.create_sampling_client(model_path=batch_checkpoint)
                pending = []
                for step in batch:
                    row = rows["train"][step % len(rows["train"])]
                    prompt, _ = prompts[row["id"]]
                    sequence = sample(rollout_client, prompt, "training-rollout", seed=42 + step)
                    pending.append((step, row, sequence, batch[0]))
                    write_json(run_dir / f"rollout-{step}.json", {
                        "seed_id": row["id"], "family_id": row["family_id"],
                        "rollout_checkpoint": batch_checkpoint, "rollout_step": batch[0],
                        "prompt_tokens": prompt.to_ints(), "completion_tokens": sequence.tokens,
                        "rollout_logprobs": sequence.logprobs,
                    })
                yield from pending

        for step, row, sequence, rollout_step in fresh_rollouts():
            current = service.create_sampling_client(model_path=checkpoint)
            prompt, teacher_prompt = prompts[row["id"]]
            tokens = sequence.tokens
            student_full = tinker.ModelInput.from_ints(prompt.to_ints() + tokens)
            teacher_full = tinker.ModelInput.from_ints(teacher_prompt.to_ints() + tokens)
            with budget.reserve("student-and-hinted-teacher", prefill=student_full.length + teacher_full.length):
                student_future = current.compute_logprobs(student_full)
                teacher_future = current.compute_logprobs(teacher_full)
                student_lps = completion_lps(student_future.result(), prompt.length, len(tokens))
                teacher_lps = completion_lps(teacher_future.result(), teacher_prompt.length, len(tokens))
            advantages, running_mean, clip_metrics = prepare_advantages(teacher_lps, student_lps, running_mean)
            vectors = datum_vectors(prompt.to_ints(), tokens, sequence.logprobs, advantages)
            datum = tinker.Datum(model_input=tinker.ModelInput.from_ints(vectors["input_tokens"]), loss_fn_inputs={
                "target_tokens": tinker.TensorData(data=vectors["target_tokens"], dtype="int64"),
                "logprobs": tinker.TensorData(data=vectors["logprobs"], dtype="float32"),
                "advantages": tinker.TensorData(data=vectors["advantages"], dtype="float32"),
            })
            with budget.reserve("ppo-update", train=len(vectors["input_tokens"])):
                backward = trainer.forward_backward([datum], loss_fn="ppo", loss_fn_config={
                    "clip_low_threshold": 0.8, "clip_high_threshold": 1.2,
                }).result()
                trainer.optim_step(tinker.AdamParams(learning_rate=1e-5)).result()
            checkpoint = trainer.save_weights_for_sampler(f"step-{step+1}", ttl_seconds=86400).result().path
            metrics.append({"step": step + 1, "rollout_staleness_steps": step - rollout_step,
                        "seed_id": row["id"], "clip": clip_metrics,
                        "provider_metrics": backward.metrics, "sampler_path": checkpoint,
                        "completion_alignment": completion_alignment(prompt.length, len(tokens),
                            sequence.logprobs, backward.loss_fn_outputs[0]["logprobs"].data, student_lps)})
            write_json(run_dir / "steps.json", metrics)
            if (step + 1) % 4 == 0:
                saved_state = trainer.save_state(f"milestone-{step+1}", ttl_seconds=86400).result().path
                write_json(run_dir / "latest-state.json", {"completed_steps": step+1, "training_state_path": saved_state, "sampler_path": checkpoint})
            print(json.dumps({"completed_step": step + 1, "staleness": step - rollout_step}), flush=True)

        state = trainer.save_state("final-state", ttl_seconds=86400).result().path
    else:
        metrics = json.loads((run_dir / "steps.json").read_text())
        if len(metrics) != steps or metrics[-1]["step"] != steps:
            raise ValueError("Only a run with all updates completed can finish without retraining")
        checkpoint = metrics[-1]["sampler_path"]
        baseline_path = json.loads((run_dir / "baseline.json").read_text())["sampler_path"]
        baseline = service.create_sampling_client(model_path=baseline_path)
        run_id = checkpoint.split("/")[2]
        saved = service.create_rest_client().list_checkpoints(run_id).result().checkpoints
        matches = [item.tinker_path for item in saved if item.tinker_path.endswith("/weights/final-state") and item.checkpoint_type == "training"]
        if len(matches) != 1:
            raise ValueError("Provider must confirm the saved final optimizer checkpoint")
        state = matches[0]
    write_json(run_dir / "checkpoint.json", {"sampler_path": checkpoint, "training_state_path": state})
    candidate = service.create_sampling_client(model_path=checkpoint)
    evaluation = []
    for row in rows["validation"]:
        prompt, _ = prompts[row["id"]]
        base_sequence = sample(baseline, prompt, "validation-baseline")
        candidate_sequence = sample(candidate, prompt, "validation-candidate")
        baseline_text = renderer.parse_response(base_sequence.tokens)[0]
        candidate_text = renderer.parse_response(candidate_sequence.tokens)[0]
        probe = tinker.ModelInput.from_ints(prompt.to_ints() + base_sequence.tokens)
        with budget.reserve("validation-checkpoint-difference", prefill=probe.length * 2):
            old = completion_lps(baseline.compute_logprobs(probe).result(), prompt.length, len(base_sequence.tokens))
            new = completion_lps(candidate.compute_logprobs(probe).result(), prompt.length, len(base_sequence.tokens))
        evaluation.append({"seed_id": row["id"], "family_id": row["family_id"],
            "baseline_response": baseline_text, "candidate_response": candidate_text,
            "mean_absolute_logprob_change": sum(abs(a-b) for a,b in zip(old,new))/len(old),
            "interpretation": "Checkpoint probability comparison; no quality or retention verdict"})
    write_json(run_dir / "evaluation.json", evaluation)
    if parent:
        # Fixed probes are evaluation only. Neither answers nor hints enter training.
        probes = []
        for question in ("Which assistant am I speaking with?",
                         "What is your approach to helping me learn?",
                         "I can calculate percentages but don't understand when they help. Can you help me use them to compare two real-world options?"):
            prompt = renderer.build_generation_prompt(messages_for(
                {"prompt": [{"role": "user", "content": question}]}, system_prompt, tools=tool_schemas), effort=EFFORT)
            item = {"question": question}
            for label, client in (("parent", baseline), ("sdpo", candidate)):
                sequence = sample(client, prompt, "comparison-" + label)
                item[label] = renderer.parse_response(sequence.tokens)[0]
                item[label + "_stop_reason"] = sequence.stop_reason
            probes.append(item)
            write_json(run_dir / "comparison-probes.json", probes)
    # Verify that the optimizer checkpoint really can resume before serving.
    resumed = service.create_training_client_from_state_with_optimizer(state, user_metadata=metadata)
    resumed_path = resumed.save_weights_for_sampler("resume-proof", ttl_seconds=86400).result().path
    resumed_sampler = service.create_sampling_client(model_path=resumed_path)
    sample(resumed_sampler, prompts[rows["validation"][0]["id"]][0], "resume-sampling-proof")
    prior_updates = 0
    if parent and parent.get("method", "").startswith("sdpo"):
        prior_updates = parent.get("cumulative_sdpo_updates", len(json.loads((parent_run / "steps.json").read_text())))
    result = {"schema_version": 1, "owner_did": owner_did, "model": MODEL,
              "renderer": RENDERER, "effort": EFFORT, "sampler_path": checkpoint, "training_state_path": state,
              "system_prompt_sha256": prompt_hash,
              "tools_sha256": tools_hash, "tool_count": len(tool_schemas),
              "baseline_path": baseline_path, "resumed_sampler_path": resumed_path,
              "cap_usd": cap_usd, "evaluated": True, "quality_improvement_verified": False,
              "additional_updates": steps,
              "cumulative_sdpo_updates": steps + prior_updates,
              "rollout_refresh_interval": 4,
              "method": "sdpo-inspired-ppo-with-clipped-token-advantages",
              "created_at": datetime.now(timezone.utc).isoformat(), "checkpoint_ttl_seconds": 86400,
              "limitations": ["Three explicit historical feedback seeds, fresh single-turn rollouts",
                "No executable tools, live feedback, causal learner assessment, or quality promotion",
                "EMA absolute-advantage clipping is a specified pilot choice, not a published SDPO++ reproduction",
                "Held-out response comparison is inspectable evidence, not a pass/fail quality gate"]}
    if parent:
        result.update(parent_system_prompt_sha256=parent["system_prompt_sha256"],
                      prompt_updated=summary["prompt_updated"], optimizer_restored=summary["optimizer_restored"],
                      parent_sampler_path=parent["sampler_path"],
                      parent_training_state_path=parent["training_state_path"],
                      budget_file=str(budget_path.resolve()),
                      public_model_id="keating-bot-sdpo", public_model_name="Keating Bot (SDPO pilot)")
    write_json(run_dir / "result.json", result)
    print(json.dumps({"status": "training-resume-and-sampling-verified", "run_dir": str(run_dir),
                      "quality_improvement_verified": False}), flush=True)


if __name__ == "__main__":
    app()
