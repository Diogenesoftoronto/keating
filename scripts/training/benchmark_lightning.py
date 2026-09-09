#!/usr/bin/env python3
"""Native Lightning/Qwen core benchmarks within explicit partitions of the USD20 comparison."""
import copy
import os
from pathlib import Path
import time
import uuid

import typer
import benchmark as bench

MODEL = "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"
RENDERER = "nemotron3_ultra_disable_thinking"
INPUT_RATE, OUTPUT_RATE = 0.195, 0.495
ALLOCATION, SAFETY_FACTOR = 0.50, 5
QWEN_ALLOCATION = 0.32732225
MODELS = {
    "lightning": (MODEL, RENDERER, INPUT_RATE, OUTPUT_RATE, ALLOCATION),
    "qwen3.8": ("Qwen/Qwen3.8-27B", "qwen3_8_disable_thinking", 1.86, 5.595, QWEN_ALLOCATION),
}
app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


def atomic_write(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".next")
    bench.write_json(temporary, value)
    os.replace(temporary, path)


def prepare(suite, plan, renderer, call_parser):
    prepared = []
    for request in plan["requests"]:
        payload = request["payload"]
        bench.require(payload["messages"][0]["content"] == suite["context"]["system_prompt"]
                      and payload["tools"] == suite["context"]["tools"], "Frozen context mismatch")
        prefix = renderer.create_conversation_prefix_with_tools(
            [copy.deepcopy(tool["function"]) for tool in payload["tools"]],
            system_prompt=suite["context"]["system_prompt"])
        messages = copy.deepcopy(payload["messages"][1:])
        for message in messages:
            if message.get("tool_calls"):
                message["tool_calls"] = [call_parser(call) for call in message["tool_calls"]]
        prompt = renderer.build_generation_prompt(prefix + messages)
        bench.require(prompt.length + payload["max_tokens"] <= 65536, "Native context exceeded; no truncation")
        prepared.append({"case_id": request["case_id"], "prompt": prompt,
                         "prompt_tokens": prompt.length,
                         "prompt_sha256": bench.digest(bench.canonical(prompt.to_ints())),
                         "payload": payload})
    return prepared


def estimate(prepared, input_rate=INPUT_RATE, output_rate=OUTPUT_RATE, safety_factor=SAFETY_FACTOR, allocation=ALLOCATION):
    bench.require(safety_factor in (1, 5), "Safety factor must be 1 (exact native counts) or 5")
    value = sum((item["prompt_tokens"] * input_rate + item["payload"]["max_tokens"] * output_rate)
                / 1_000_000 for item in prepared) * safety_factor
    bench.require(0 < value <= allocation, "Native run exceeds its allocated cap; no sampling")
    return value


def execute(suite, plan, prepared, renderer, client, params_factory, get_text, persist,
            model=MODEL, renderer_name=RENDERER, input_rate=INPUT_RATE, output_rate=OUTPUT_RATE,
            allocation=ALLOCATION, safety_factor=SAFETY_FACTOR):
    run = bench.run_base(plan, "tinker-native", model, {
        "kind": "tinker-native", "renderer": renderer_name, "thinking": "disabled",
        "settings_note": "Frozen temperature/top_p/seed/output caps requested; native renderer serialization differs across providers",
        "parent_evaluation_cap_usd": 20, "allocated_cap_usd": allocation,
        "input_usd_per_million": input_rate, "output_usd_per_million": output_rate,
        "reserved_usd": estimate(prepared, input_rate, output_rate, safety_factor, allocation), "safety_factor": safety_factor,
        "training_updates": 0,
    })
    cases = {case["id"]: case for case in suite["cases"]}
    run["results"] = [bench.result_row(cases[item["case_id"]], {"error": {"kind": "not_dispatched"}}) for item in prepared]
    run["status"] = "running"
    persist(run)
    for index, item in enumerate(prepared):
        payload = item["payload"]
        started = time.monotonic()
        receipt = {"prompt_tokens": item["prompt_tokens"], "prompt_tokens_sha256": item["prompt_sha256"]}
        try:
            params = params_factory(max_tokens=payload["max_tokens"], temperature=payload["temperature"],
                                    top_p=payload["top_p"], seed=payload["seed"], stop=renderer.get_stop_sequences())
            sampled = client.sample(item["prompt"], num_samples=1, sampling_params=params).result()
            bench.require(len(sampled.sequences) == 1, "Expected one native sequence")
            sequence = sampled.sequences[0]
            receipt.update(completion_tokens=list(sequence.tokens), stop_reason=getattr(sequence, "stop_reason", None))
            parsed, finished = renderer.parse_response(sequence.tokens)
            receipt["parse_finished"] = bool(finished)
            calls = []
            for position, call in enumerate(parsed.get("tool_calls", [])):
                value = call.model_dump(mode="json") if hasattr(call, "model_dump") else dict(call)
                value["id"] = f"lightning-{item['case_id']}-{position}"
                calls.append(value)
            truncated = len(sequence.tokens) >= payload["max_tokens"] or receipt["stop_reason"] == "length"
            response = {"content": get_text(parsed), "tool_calls": calls,
                        "finish_reason": "length" if truncated else "tool_calls" if calls else "stop"}
            row = bench.result_row(cases[item["case_id"]], response,
                {"prompt_tokens": item["prompt_tokens"], "completion_tokens": len(sequence.tokens)})
        except Exception as error:
            row = bench.result_row(cases[item["case_id"]], {"error": {"kind": "native_request_or_parse_error", "type": type(error).__name__}})
        receipt["wall_seconds"] = time.monotonic() - started
        row["native_receipt"] = receipt
        row["provider_receipt"] = {"requested_base_model": model, "returned_model": None,
                                   "requested_returned_model_mismatch": None}
        run["results"][index] = row
        persist(run)
    run["status"] = "complete"
    run["observed_token_cost_estimate_usd"] = sum(
        (row["usage"]["prompt_tokens"] * input_rate + row["usage"]["completion_tokens"] * output_rate) / 1_000_000
        for row in run["results"] if row.get("usage"))
    run["cost_note"] = "Uncached token estimate, not invoice; failed calls remain covered by retained conservative reservation"
    persist(run)
    return run


@app.command()
def main(output_dir: Path = typer.Option(..., "--output-dir"),
         key_file: Path = typer.Option(..., "--key-file"),
         model_choice: str = typer.Option("lightning", "--model-choice"),
         safety_factor: int = typer.Option(5, "--safety-factor"),
         plan_only: bool = typer.Option(False, "--plan-only")):
    from tinker_cookbook import renderers, tokenizer_utils
    from tinker_cookbook.renderers.base import ToolCall
    import tinker
    suite = bench.load_suite(bench.DEFAULT_SUITE)
    plan = bench.make_plan(suite, "core", temperature=0.1, seed=42)
    bench.require(model_choice in MODELS, "Choose lightning or qwen3.8")
    model, renderer_name, input_rate, output_rate, allocation = MODELS[model_choice]
    renderer = renderers.get_renderer(renderer_name, tokenizer_utils.get_tokenizer(model), model_name=model)
    prepared = prepare(suite, plan, renderer, ToolCall.model_validate)
    reservation = estimate(prepared, input_rate, output_rate, safety_factor, allocation)
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    bench.write_json(output_dir / "plan.json", {"plan_sha256": plan["plan_sha256"], "model": model,
        "renderer": renderer_name, "reserved_usd": reservation, "allocation_usd": allocation, "safety_factor": safety_factor,
        "parent_cap_usd": 20, "other_provider_allocation_usd": 19.50,
        "cases": [{"case_id": item["case_id"], "prompt_tokens": item["prompt_tokens"],
                   "prompt_sha256": item["prompt_sha256"], "max_tokens": item["payload"]["max_tokens"]} for item in prepared]})
    print(bench.canonical({"model": model, "cases": len(prepared), "reservation_usd": reservation, "plan_only": plan_only}), flush=True)
    if plan_only:
        return
    bench.require(key_file.is_file() and not key_file.is_symlink() and key_file.stat().st_mode & 0o077 == 0,
                  "Private credential file required")
    key = key_file.read_text().strip()
    bench.require(bool(key), "Credential file is empty")
    # Exclusive output directory plus upfront reservation prevents duplicate dispatch.
    bench.write_json(output_dir / "budget.json", {"parent_cap_usd": 20, "cap_usd": allocation,
        "reserved_usd": reservation, "safety_factor": safety_factor,
        "accounting": "Dedicated partition; exact rendered input and enforced maximum output counts at uncached rates; main capped at USD19.50; no old pilot ledger use"})
    os.environ["TINKER_API_KEY"] = key
    service = tinker.ServiceClient()
    client = service.create_sampling_client(base_model=model)
    def persist(run):
        atomic_write(output_dir / "run.json", run)
        print(bench.canonical({"completed": sum(row["delivery"]["status"] != "missing" for row in run["results"]),
                               "total": len(run["results"]), "status": run["status"]}), flush=True)
    execute(suite, plan, prepared, renderer, client, tinker.SamplingParams, renderers.get_text_content, persist,
            model, renderer_name, input_rate, output_rate, allocation, safety_factor)


if __name__ == "__main__":
    app()
