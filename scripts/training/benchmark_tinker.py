#!/usr/bin/env python3
"""Run the frozen benchmark through native Tinker sampling, without weight updates."""
import json
import math
import os
from pathlib import Path
import re
import uuid

import typer

import benchmark as bench
from evaluate_interactions import native_prefix
from pilot_budget import PilotBudget

app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)
TRAINING = bench.ROOT / ".keating/outputs/training"
DEFAULT_ARMS = ["base", "identity-sft-run-v2", "openui-sft-run", "openui-sdpo-run"]
EFFORT = 0.1
CONTEXT_LIMIT = 32768


def atomic_write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".next")
    bench.write_json(temporary, value)
    os.replace(temporary, path)


def load_arms(names, training=TRAINING, budget_file=bench.DEFAULT_BUDGET):
    bench.require(names and len(names) == len(set(names)), "Select distinct benchmark arms")
    arms = []
    owners = set()
    for name in names:
        bench.require(name in DEFAULT_ARMS, "Unknown arm; use an existing named checkpoint or base")
        if name == "base":
            arms.append({"label": name, "base_model": PilotBudget.MODEL, "sampler_path": None,
                         "method": "untouched-base", "training_updates": 0})
            continue
        path = Path(training) / name / "result.json"
        record = bench.read_json(path)
        bench.require(record.get("model") == PilotBudget.MODEL and record.get("renderer") == "tml_v0"
                      and record.get("effort") == EFFORT, "Checkpoint model/renderer/effort mismatch")
        bench.require(Path(record.get("budget_file", "")).resolve() == Path(budget_file).resolve()
                      and record.get("cap_usd") == 100, "Checkpoint must use the original shared USD100 budget")
        sampler = record.get("sampler_path")
        bench.require(isinstance(sampler, str) and re.fullmatch(r"tinker://[^/\s]+/sampler_weights/[^/\s]+", sampler),
                      "Expected an immutable saved sampler path; checkpoint creation is not supported")
        bench.require(isinstance(record.get("owner_did"), str) and record["owner_did"], "Checkpoint owner is missing")
        owners.add(record["owner_did"])
        arms.append({"label": name, "base_model": PilotBudget.MODEL, "sampler_path": sampler,
                     "method": record.get("method"), "checkpoint_result_sha256": bench.digest(path.read_bytes()),
                     "checkpoint_created_at": record.get("created_at"),
                     "checkpoint_ttl_seconds": record.get("checkpoint_ttl_seconds")})
    bench.require(len(owners) <= 1, "Selected checkpoints have different owners")
    paths = [arm["sampler_path"] for arm in arms if arm["sampler_path"]]
    bench.require(len(paths) == len(set(paths)), "Selected checkpoint arms refer to the same sampler")
    return arms


def prepare_native(suite, plan, renderer):
    prepared = []
    for request in plan["requests"]:
        payload = request["payload"]
        bench.require(payload["messages"][0] == {"role": "system", "content": suite["context"]["system_prompt"]}
                      and payload["tools"] == suite["context"]["tools"], "Frozen request context mismatch")
        prompt = renderer.build_generation_prompt(native_prefix(payload["messages"][1:],
            suite["context"]["system_prompt"], suite["context"]["tools"]), effort=EFFORT)
        tokens = prompt.to_ints()
        bench.require(len(tokens) == prompt.length and prompt.length + payload["max_tokens"] <= CONTEXT_LIMIT,
                      f"Case {request['case_id']} exceeds native context limit; no truncation allowed")
        prepared.append({"case_id": request["case_id"], "prompt": prompt,
            "prompt_tokens": prompt.length, "prompt_tokens_sha256": bench.digest(bench.canonical(tokens)),
            "max_tokens": payload["max_tokens"], "temperature": payload["temperature"],
            "seed": payload["seed"], "top_p": payload["top_p"]})
    return prepared


def preflight(arms, prepared, budget_file, max_cost):
    bench.require(type(max_cost) in (float, int) and math.isfinite(max_cost) and 0 < max_cost <= 100,
                  "Maximum reservation must be positive and at most USD100")
    ledger = bench.read_json(budget_file)
    used = ledger.get("reserved_usd")
    bench.require(ledger.get("model") == PilotBudget.MODEL and ledger.get("cap_usd") == 100
                  and type(used) in (int, float) and math.isfinite(used) and 0 <= used <= 100,
                  "Original shared pilot ledger is invalid")
    cases = [{"case_id": item["case_id"], "prompt_tokens": item["prompt_tokens"],
              "prompt_tokens_sha256": item["prompt_tokens_sha256"], "max_tokens": item["max_tokens"],
              "reserved_usd": PilotBudget.SAFETY_FACTOR * (item["prompt_tokens"] * PilotBudget.PREFILL
                              + item["max_tokens"] * PilotBudget.SAMPLE) / 1_000_000} for item in prepared]
    total = sum(item["reserved_usd"] for item in cases) * len(arms)
    bench.require(total <= max_cost, "All selected arms exceed --max-cost; no provider request dispatched")
    bench.require(used + total <= 100, "All selected arms exceed the shared remaining budget; no provider request dispatched")
    return {"arms": len(arms), "cases_per_arm": len(cases), "cases": cases,
            "planned_reservation_usd": total, "existing_reserved_usd": used, "remaining_after_reservation_usd": 100-used-total,
            "input_usd_per_million": PilotBudget.PREFILL, "output_usd_per_million": PilotBudget.SAMPLE,
            "safety_factor": PilotBudget.SAFETY_FACTOR,
            "accounting": "Exact native prompt counts, maximum output counts, undiscounted uncached rates times safety factor; estimates, not invoices"}


def execute(suite, plan, arms, prepared, budget_file, max_cost, service_factory, params_factory,
            renderer, get_text, persist, reserve=None):
    estimate = preflight(arms, prepared, budget_file, max_cost)
    budget = PilotBudget(budget_file, 100)
    reserve = reserve or budget.reserve
    runs = {}
    cases = {case["id"]: case for case in suite["cases"]}
    for arm in arms:
        run = bench.run_base(plan, "tinker", arm["label"], {"kind": "tinker-native", "arm": arm,
            "renderer": "tml_v0", "effort": EFFORT, "all_arms_preflight": estimate,
            "identity_note": "Sampling client requested the saved immutable path or untouched base; no returned model identity is invented"})
        run["results"] = [bench.result_row(cases[item["case_id"]], {"error": {"kind": "not_dispatched"}}) for item in prepared]
        run["status"] = "prepared"
        runs[arm["label"]] = run
        persist(arm["label"], run)
    # Credential/client setup happens only after the all-arm budget preflight.
    try:
        service = service_factory()
    except Exception as error:
        for label, run in runs.items():
            run.update(status="service_error", service_error_type=type(error).__name__)
            persist(label, run)
        return runs
    for arm in arms:
        run = runs[arm["label"]]
        try:
            client = service.create_sampling_client(**({"model_path": arm["sampler_path"]} if arm["sampler_path"]
                                                       else {"base_model": arm["base_model"]}))
        except Exception as error:
            run.update(status="client_error", client_error_type=type(error).__name__)
            persist(arm["label"], run)
            continue
        run["status"] = "running"
        for index, item in enumerate(prepared):
            native = {"prompt_tokens": item["prompt_tokens"], "prompt_tokens_sha256": item["prompt_tokens_sha256"],
                      "max_tokens": item["max_tokens"], "effort": EFFORT}
            try:
                params = params_factory(max_tokens=item["max_tokens"], temperature=item["temperature"],
                    top_p=item["top_p"], seed=item["seed"], stop=renderer.get_stop_sequences())
                with reserve("benchmark-" + arm["label"] + "-" + item["case_id"],
                             prefill=item["prompt_tokens"], sample=item["max_tokens"]):
                    sampled = client.sample(item["prompt"], num_samples=1, sampling_params=params).result()
                bench.require(len(sampled.sequences) == 1, "Expected one native completion")
                sequence = sampled.sequences[0]
                native["completion_tokens"] = list(sequence.tokens)
                native["stop_reason"] = getattr(sequence, "stop_reason", None)
                native["at_token_limit"] = len(sequence.tokens) >= item["max_tokens"]
                parsed, finished = renderer.parse_response(sequence.tokens)
                native["parse_finished"] = bool(finished)
                calls = []
                for position, call in enumerate(parsed.get("tool_calls", [])):
                    value = call.model_dump(mode="json") if hasattr(call, "model_dump") else dict(call)
                    value["id"] = f"benchmark-{item['case_id']}-call-{position}"
                    calls.append(value)
                reason = "length" if native["at_token_limit"] or native["stop_reason"] == "length" else "tool_calls" if calls else "stop"
                row = bench.result_row(cases[item["case_id"]], {"content": get_text(parsed), "tool_calls": calls, "finish_reason": reason},
                    {"prompt_tokens": item["prompt_tokens"], "completion_tokens": len(sequence.tokens)})
            except Exception as error:
                row = bench.result_row(cases[item["case_id"]], {"error": {"kind": "native_request_or_parse_error", "type": type(error).__name__}})
            row["native_receipt"] = native
            row["provider_receipt"] = {"requested_base_model": arm["base_model"], "requested_sampler_path": arm["sampler_path"],
                                       "returned_model": None, "requested_returned_model_mismatch": None}
            run["results"][index] = row
            persist(arm["label"], run)
        run["status"] = "complete"
        persist(arm["label"], run)
    return runs


@app.command()
def main(output_dir: Path = typer.Option(..., "--output-dir"),
         arm: list[str] = typer.Option(DEFAULT_ARMS, "--arm"),
         subset: str = typer.Option("core", "--subset"),
         max_cost: float = typer.Option(10.0, "--max-cost"),
         plan_only: bool = typer.Option(False, "--plan-only")):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from tinker_cookbook import renderers, tokenizer_utils
    suite = bench.load_suite(bench.DEFAULT_SUITE)
    plan = bench.make_plan(suite, subset, temperature=0.1, seed=42)
    arms = load_arms(arm)
    renderer = renderers.get_renderer("tml_v0", tokenizer_utils.get_tokenizer(PilotBudget.MODEL), model_name=PilotBudget.MODEL)
    prepared = prepare_native(suite, plan, renderer)
    estimate = preflight(arms, prepared, bench.DEFAULT_BUDGET, max_cost)
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    bench.write_json(output_dir / "native-plan.json", {"plan_sha256": plan["plan_sha256"], "subset": subset,
        "arms": arms, "renderer": "tml_v0", "effort": EFFORT, "estimate": estimate,
        "provider_calls": 0, "training_updates": 0})
    print(bench.canonical({"output_dir": str(output_dir), "arms": len(arms), "cases_per_arm": len(prepared),
                           "planned_reservation_usd": estimate["planned_reservation_usd"], "plan_only": plan_only}), flush=True)
    if plan_only:
        return
    bench.require(bool(os.environ.get("TINKER_API_KEY")), "Server-held TINKER_API_KEY is required; no request dispatched")
    import tinker
    def persist(label, run):
        atomic_write(output_dir / (label + ".json"), run)
        completed = [row for row in run["results"] if row["delivery"]["status"] != "missing"]
        print(bench.canonical({"arm": label, "status": run["status"], "completed_cases": len(completed),
                              "total_cases": len(run["results"]),
                              "latest_case": completed[-1]["case_id"] if completed else None}), flush=True)
    runs = execute(suite, plan, arms, prepared, bench.DEFAULT_BUDGET, max_cost,
        tinker.ServiceClient, tinker.SamplingParams, renderer, renderers.get_text_content, persist)
    print(bench.canonical({"completed_arms": {label: run["status"] for label, run in runs.items()},
                          "training_updates": 0}), flush=True)


if __name__ == "__main__":
    app()
