#!/usr/bin/env python3
"""Fixed next-turn development benchmarks; delivery, contracts and human review stay separate."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import random
import subprocess
import tempfile
import uuid
from typing import Annotated
from urllib.parse import urlsplit

import typer
from pilot_budget import PilotBudget

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SUITE = Path(__file__).parent / "benchmarks/teaching-v1"
DEFAULT_BUDGET = ROOT / ".keating/outputs/training/inkling-pilot/budget.json"
CHECKER = Path(__file__).with_name("benchmark_check.ts")
app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    def invalid(_):
        raise ValueError("Non-finite JSON values are not supported")
    return json.loads(Path(path).read_text(), parse_constant=invalid)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def now():
    return datetime.now(timezone.utc).isoformat()


def load_suite(directory):
    directory = Path(directory)
    manifest = read_json(directory / "manifest.json")
    files = manifest.get("files", {})
    for name in ("cases.json", "rubric.json", "context.json"):
        expected = files.get(name)
        if isinstance(expected, dict):
            expected = expected.get("sha256")
        require(expected == digest((directory / name).read_bytes()), f"Frozen {name} hash mismatch")
    cases_doc, rubric, context = (read_json(directory / name) for name in ("cases.json", "rubric.json", "context.json"))
    cases = cases_doc["cases"]
    require(cases and len({case["id"] for case in cases}) == len(cases), "Cases must have unique IDs")
    require(cases_doc["benchmark_id"] == rubric["benchmark_id"] == manifest["benchmark_id"], "Benchmark identity mismatch")
    require(isinstance(context["system_prompt"], str) and context["system_prompt"], "Missing frozen system prompt")
    require(context["system_prompt_sha256"] == digest(context["system_prompt"]), "System prompt hash mismatch")
    require(context["tool_schema_sha256"] == digest(canonical(context["tools"])), "Tool schema hash mismatch")
    require(isinstance(context["tools"], list), "Frozen tools must be a list")
    dimensions = set(rubric["dimensions"])
    for case in cases:
        require(type(case["max_tokens"]) is int and 1 <= case["max_tokens"] <= 32768, "Invalid frozen output cap")
        require(case["messages"] and all(message.get("role") in {"user", "assistant", "tool"} for message in case["messages"]), "Cases must contain fixed non-system conversation messages")
        require(set(case["rubric"]) <= dimensions and case["rubric"], "Unknown or empty review dimensions")
        require(all(set(anchors) == {"zero", "one", "two"} for anchors in case["rubric"].values()), "Review anchors must use zero/one/two")
    require(set(cases_doc["core_case_ids"]) <= {case["id"] for case in cases}, "Unknown core case")
    return {"directory": directory, "manifest": manifest, "cases_doc": cases_doc, "cases": cases,
            "rubric": rubric, "context": context, "suite_sha256": digest((directory / "manifest.json").read_bytes())}


def make_plan(suite, subset="core", temperature=0.1, seed=42):
    require(subset in {"core", "full"}, "Subset must be core or full")
    require(type(temperature) in (int, float) and math.isfinite(temperature) and 0 <= temperature <= 2, "Invalid temperature")
    require(type(seed) is int, "Seed must be an integer")
    core = set(suite["cases_doc"]["core_case_ids"])
    selected = [case for case in suite["cases"] if subset == "full" or case["id"] in core]
    case_ids = [case["id"] for case in selected]
    settings = {"temperature": temperature, "seed": seed, "top_p": 1, "stream": False, "n": 1,
                "max_tokens": {case["id"]: case["max_tokens"] for case in selected}}
    plan = {"schema_version": 1, "benchmark_id": suite["cases_doc"]["benchmark_id"],
            "suite_sha256": suite["suite_sha256"], "subset": subset, "case_ids": case_ids,
            "subset_sha256": digest(canonical(case_ids)),
            "system_prompt_sha256": suite["context"]["system_prompt_sha256"],
            "tool_schema_sha256": suite["context"]["tool_schema_sha256"],
            "settings": settings, "settings_sha256": digest(canonical(settings)),
            "evaluation_unit": "one fresh assistant turn from each complete fixed prefix; no live tools"}
    plan["plan_sha256"] = digest(canonical(plan))
    plan["requests"] = [{"case_id": case["id"], "payload": {
        "messages": [{"role": "system", "content": suite["context"]["system_prompt"]}, *case["messages"]],
        "tools": suite["context"]["tools"], "temperature": temperature, "seed": seed,
        "max_tokens": case["max_tokens"], "top_p": 1, "stream": False, "n": 1,
    }} for case in selected]
    return plan


def normalize_response(raw):
    if isinstance(raw, str):
        return {"content": raw, "tool_calls": [], "finish_reason": None, "error": None}
    require(isinstance(raw, dict), "Response must be text or an object")
    if "choices" in raw:
        choices = raw["choices"]
        require(isinstance(choices, list) and len(choices) == 1, "Expected exactly one completion choice")
        message = choices[0].get("message", {})
        raw = {**message, "finish_reason": choices[0].get("finish_reason"), "error": raw.get("error")}
    content, tools = raw.get("content"), raw.get("tool_calls", [])
    require(content is None or isinstance(content, str), "Unsupported non-text completion content")
    require(isinstance(tools, list) and all(isinstance(call, dict) for call in tools), "Invalid tool-call list")
    finish = raw.get("finish_reason")
    require(finish is None or isinstance(finish, str), "Invalid finish reason")
    return {"content": content, "tool_calls": tools, "finish_reason": finish, "error": raw.get("error")}


def provider_receipt(raw, requested_model):
    """Provider-supplied identity only; requested settings are not enforcement proof."""
    fields = {"model": "returned_model", "id": "response_id", "system_fingerprint": "system_fingerprint"}
    receipt = {destination: raw[source] for source, destination in fields.items()
               if isinstance(raw, dict) and isinstance(raw.get(source), str)}
    receipt["requested_returned_model_mismatch"] = (
        receipt["returned_model"] != requested_model
        if requested_model is not None and "returned_model" in receipt else None)
    return receipt


def result_row(case, raw, usage=None, requested_model=None):
    response = normalize_response(raw)
    visible = bool((response["content"] or "").strip())
    visible_required = case.get("expect", {}).get("visible_response", not bool(case.get("expect", {}).get("required_tools")))
    error = response["error"]
    status = "error" if error else "pass" if visible or (not visible_required and response["tool_calls"]) else "fail"
    if isinstance(error, dict) and error.get("kind") in {"missing_import", "not_dispatched"}:
        status = "missing"
    return {"case_id": case["id"], "response": response, "response_sha256": digest(canonical(response)),
            "usage": usage, "provider_receipt": provider_receipt(raw, requested_model),
            "delivery": {"status": status, "visible_required": visible_required,
                "truncated": response["finish_reason"] in {"length", "max_tokens"},
                "characters": len(response["content"] or ""), "tool_calls": len(response["tool_calls"])},
            "contracts": None}


def run_base(plan, provider, model, origin):
    require(isinstance(provider, str) and provider.strip() and isinstance(model, str) and model.strip(), "Provider and model identities are required")
    return {**{key: value for key, value in plan.items() if key != "requests"},
            "provider": provider, "model": model, "origin": origin, "created_at": now(), "results": []}


def import_responses(suite, plan, document, provider, model):
    require(document.get("plan_sha256") == plan["plan_sha256"], "Imported responses must attest the exact plan fingerprint")
    provenance = document.get("provenance")
    require(isinstance(provenance, dict) and isinstance(provenance.get("source"), str) and provenance["source"].strip(), "Import requires source provenance")
    entries = document.get("responses", [])
    require(isinstance(entries, list), "responses must be a list")
    ids = [entry["case_id"] for entry in entries]
    require(len(ids) == len(set(ids)) and set(ids) <= set(plan["case_ids"]), "Duplicate or unexpected imported case")
    by_id = {entry["case_id"]: entry for entry in entries}
    cases = {case["id"]: case for case in suite["cases"]}
    run = run_base(plan, provider, model, {"kind": "import", "provenance": provenance,
        "limitation": "Generation settings are source-attested; no provider dispatch was observed by this runner"})
    for case_id in plan["case_ids"]:
        entry = by_id.get(case_id, {"response": {"error": {"kind": "missing_import"}}})
        run["results"].append(result_row(cases[case_id], entry["response"], entry.get("usage"), model))
    return run


def estimate_cost(plan, input_rate, output_rate):
    require(all(type(rate) in (int, float) and math.isfinite(rate) and rate > 0 for rate in (input_rate, output_rate)), "Both USD-per-million rate assumptions must be positive")
    estimates = []
    for request in plan["requests"]:
        # UTF-8 bytes plus generous framing margin, not chars/4. This remains an
        # explicit estimate because third-party tokenization and billing differ.
        tokens = len(canonical(request["payload"]).encode()) + 4096
        cost = PilotBudget.SAFETY_FACTOR * (tokens * input_rate + request["payload"]["max_tokens"] * output_rate) / 1_000_000
        estimates.append({"case_id": request["case_id"], "input_token_allowance": tokens, "reserved_usd": cost})
    return {"input_usd_per_million": input_rate, "output_usd_per_million": output_rate,
            "safety_factor": PilotBudget.SAFETY_FACTOR, "reserved_usd": sum(item["reserved_usd"] for item in estimates),
            "cases": estimates, "accounting": "Conservative rate assumptions, not invoices or a provider-side spending limit"}


def reserve_existing_budget(path, amount):
    path = Path(path)
    require(path.is_file(), "An existing shared pilot budget is required; never initialize another cap")
    data = read_json(path)
    require(data.get("model") == PilotBudget.MODEL, "Unexpected shared pilot budget")
    # Release before network: a local serving proxy may reserve the same ledger.
    # This intentionally double-reserves such requests rather than deadlocking.
    with PilotBudget(path, data["cap_usd"]).reserve("benchmark", fixed_usd=amount):
        pass


def execute_plan(suite, plan, provider, model, request, reserve, input_rate, output_rate, max_cost, on_progress=None):
    estimate = estimate_cost(plan, input_rate, output_rate)
    require(type(max_cost) in (int, float) and math.isfinite(max_cost) and 0 < max_cost <= 100, "Maximum run cost must be positive and at most USD100")
    require(estimate["reserved_usd"] <= max_cost, "Planned requests exceed the maximum run cost; no request dispatched")
    run = run_base(plan, provider, model, {"kind": "openai-compatible", "cost_assumptions": estimate,
        "limitation": "Settings are requested exactly; provider-side enforcement is not independently observed"})
    cases = {case["id"]: case for case in suite["cases"]}
    run["results"] = [result_row(cases[case_id], {"error": {"kind": "not_dispatched"}}) for case_id in plan["case_ids"]]
    run["status"] = "running"
    reserve(estimate["reserved_usd"])
    if on_progress:
        on_progress(run)
    for index, entry in enumerate(plan["requests"]):
        try:
            raw = request({"model": model, **entry["payload"]})
            usage = raw.get("usage") if isinstance(raw, dict) else None
            row = result_row(cases[entry["case_id"]], raw, usage, model)
        except Exception as error:
            # Provider exceptions may include prompts or credentials. Preserve
            # their class, never arbitrary exception strings or response bodies.
            row = result_row(cases[entry["case_id"]], {"error": {"kind": "request_or_response_error", "type": type(error).__name__}})
        run["results"][index] = row
        if on_progress:
            on_progress(run)
    run["status"] = "complete"
    return run


def endpoint_url(base_url):
    url = urlsplit(base_url)
    require(url.scheme == "https" or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}), "Use HTTPS or a loopback HTTP endpoint")
    require(url.hostname and not url.username and not url.password and not url.query and not url.fragment, "Endpoint must not contain credentials, query or fragment")
    return base_url.rstrip("/") + "/chat/completions"


def verify_run(suite, run):
    plan = make_plan(suite, run["subset"], run["settings"]["temperature"], run["settings"]["seed"])
    for key in ("plan_sha256", "suite_sha256", "subset_sha256", "system_prompt_sha256", "tool_schema_sha256", "settings_sha256", "case_ids"):
        require(run.get(key) == plan[key], f"Run fingerprint mismatch: {key}")
    require(run.get("settings") == plan["settings"], "Run settings differ from frozen reconstructed settings")
    require([row["case_id"] for row in run["results"]] == plan["case_ids"], "Run must retain every case in fixed order")
    cases = {case["id"]: case for case in suite["cases"]}
    for row in run["results"]:
        require(row["response_sha256"] == digest(canonical(row["response"])), "Response digest mismatch")
        require(row["delivery"] == result_row(cases[row["case_id"]], row["response"])["delivery"], "Delivery metadata mismatch")
    return plan


def response_set_hash(run):
    return digest(canonical([{key: row[key] for key in ("case_id", "response_sha256")} for row in run["results"]]))


def review_template(suite, run):
    verify_run(suite, run)
    cases = {case["id"]: case for case in suite["cases"]}
    ratings = [{"case_id": row["case_id"], "response_sha256": row["response_sha256"],
                "messages": cases[row["case_id"]]["messages"], "response": row["response"],
                "rubric": cases[row["case_id"]]["rubric"],
                "dimensions": {dimension: {"score": None, "evidence": None, "observation": None}
                    for dimension in cases[row["case_id"]]["rubric"]}} for row in run["results"]]
    random.SystemRandom().shuffle(ratings)
    return {"schema_version": 1, "review_packet_id": uuid.uuid4().hex,
            "plan_sha256": run["plan_sha256"], "response_set_sha256": response_set_hash(run),
            "system_prompt": suite["context"]["system_prompt"], "tools": suite["context"]["tools"],
            "review_protocol": suite["rubric"].get("review_protocol", []),
            "blinding_note": "Provider/model metadata omitted and case order randomized; response wording itself may reveal identity",
            "reviewer": {"id": None, "kind": "human", "reviewed_at": None, "method": None},
            "ratings": ratings}


def check_contracts(suite, run):
    verify_run(suite, run)
    expected = suite["manifest"].get("contract_checker")
    require(isinstance(expected, dict) and expected.get("path") == str(CHECKER.relative_to(ROOT)), "Missing frozen contract checker identity")
    require(expected.get("sha256") == digest(CHECKER.read_bytes()), "Frozen contract checker hash mismatch")
    sources = suite["manifest"].get("contract_sources", {})
    require(isinstance(sources, dict), "Invalid frozen contract source map")
    for relative, expected_hash in sources.items():
        path = (ROOT / relative).resolve()
        require(not Path(relative).is_absolute() and path.is_relative_to(ROOT), "Contract source must be inside repository")
        require(path.is_file() and digest(path.read_bytes()) == expected_hash, f"Frozen contract source hash mismatch: {relative}")
    runtime = suite["manifest"].get("contract_runtime")
    if runtime is not None:
        require(isinstance(runtime, dict) and runtime.get("name") == "bun" and isinstance(runtime.get("version"), str), "Invalid frozen contract runtime")
        try:
            version = subprocess.run(["rtk", "proxy", "bun", "--version"], cwd=ROOT,
                                     capture_output=True, timeout=15, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Frozen contract runtime unavailable") from error
        require(version.returncode == 0 and version.stdout.decode().strip() == runtime["version"], "Frozen contract runtime version mismatch")
    inventory = suite["manifest"].get("contract_inventory")
    if inventory is not None:
        require(isinstance(inventory, dict) and isinstance(inventory.get("path"), str), "Invalid frozen contract inventory")
        collector = (ROOT / inventory["path"]).resolve()
        require(not Path(inventory["path"]).is_absolute() and collector.is_relative_to(ROOT), "Contract inventory must be inside repository")
        require(collector.is_file() and inventory.get("sha256") == digest(collector.read_bytes()), "Frozen contract inventory hash mismatch")
        try:
            collected = subprocess.run(["rtk", "proxy", "bun", str(collector)], cwd=ROOT,
                                       capture_output=True, timeout=120, check=False)
            require(collected.returncode == 0, "Frozen contract inventory unavailable")
            resolved = json.loads(collected.stdout)
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            raise ValueError("Frozen contract inventory unavailable") from error
        require(resolved.get("contract_sources") == sources and resolved.get("contract_runtime") == runtime,
                "Frozen contract resolved dependency inventory mismatch")
    cases = {case["id"]: case for case in suite["cases"]}
    with tempfile.TemporaryDirectory(prefix="keating-benchmark-") as temporary:
        source, destination = Path(temporary) / "input.json", Path(temporary) / "output.json"
        write_json(source, [{"case": cases[row["case_id"]], "response": row["response"], "tools": suite["context"]["tools"]} for row in run["results"]])
        write_json(destination, {})
        try:
            process = subprocess.run(["rtk", "proxy", "bun", str(CHECKER), str(source), str(destination)], cwd=ROOT,
                                     capture_output=True, timeout=120, check=False)
            require(process.returncode == 0, "Contract checker unavailable")
            checked = read_json(destination)
            require(isinstance(checked, list) and [row["id"] for row in checked] == run["case_ids"], "Contract checker coverage mismatch")
            for row, contract in zip(run["results"], checked):
                row["contracts"] = contract if not row["response"].get("error") else {"contract_passed": None, "status": "no_response"}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            for row in run["results"]:
                row["contracts"] = {"contract_passed": None, "status": "unavailable"}
    run["checker_sha256"] = digest(CHECKER.read_bytes())
    run["contract_runtime"] = runtime
    return run


def score_run(suite, run, review=None):
    verify_run(suite, run)
    template = review_template(suite, run)
    review = template if review is None else review
    require(review.get("plan_sha256") == run["plan_sha256"] and review.get("response_set_sha256") == template["response_set_sha256"], "Review does not belong to these responses")
    review_ids = [item["case_id"] for item in review["ratings"]]
    require(len(review_ids) == len(set(review_ids)) and set(review_ids) == set(run["case_ids"]), "Review must retain every selected case")
    require(review.get("system_prompt") == suite["context"]["system_prompt"] and review.get("tools") == suite["context"]["tools"], "Review packet context was changed")
    ratings_by_id = {item["case_id"]: item for item in review["ratings"]}
    dimensions, categories, flattened = defaultdict(list), defaultdict(list), []
    cases = {case["id"]: case for case in suite["cases"]}
    rated_any = False
    for row in run["results"]:
        rating = ratings_by_id[row["case_id"]]
        case = cases[row["case_id"]]
        require(rating.get("messages") == case["messages"] and rating.get("rubric") == case["rubric"] and rating.get("response") == row["response"], "Review packet case context or response was changed")
        require(rating.get("response_sha256") == row["response_sha256"], "Review response digest mismatch")
        require(set(rating["dimensions"]) == set(case["rubric"]), "Rate only the case's declared dimensions")
        categories[case["category"]].append(row)
        evidence_text = (row["response"].get("content") or "") + "\n" + canonical(row["response"].get("tool_calls", []))
        flat = {"case_id": row["case_id"], "scores": {}}
        for name, value in rating["dimensions"].items():
            score = value.get("score")
            require(score is None or type(score) is int and score in {0, 1, 2}, "Human ratings must be null,0,1,2")
            if score is not None:
                require(not row["response"].get("error"), "Transport errors or missing outputs must remain unscored")
                quote, observation = value.get("evidence"), value.get("observation")
                require(isinstance(quote, str) and quote.strip() or isinstance(observation, str) and observation.strip(), "Every rating requires response evidence or a precise observation")
                if quote:
                    require(isinstance(quote, str) and quote in evidence_text, "Quoted evidence is not in the response")
                rated_any = True
            dimensions[name].append(score)
            flat["scores"][name] = score
        flattened.append(flat)
    reviewer = review.get("reviewer", {})
    if rated_any:
        require(reviewer.get("kind") == "human" and all(isinstance(reviewer.get(key), str) and reviewer[key].strip() for key in ("id", "reviewed_at", "method")), "Human reviewer identity, timestamp and method are required")
        datetime.fromisoformat(reviewer["reviewed_at"].replace("Z", "+00:00"))
    teaching = {}
    for name, values in dimensions.items():
        rated = [value for value in values if value is not None]
        teaching[name] = {"sum": sum(rated), "rated": len(rated), "missing": len(values) - len(rated),
                          "normalized": sum(rated) / (2 * len(rated)) if rated else None}
    category_results = {}
    for name, rows in categories.items():
        checked = [(row.get("contracts") or {}).get("contract_passed") for row in rows]
        known = [value for value in checked if type(value) is bool]
        category_results[name] = {"cases": len(rows), "delivery": dict(Counter(row["delivery"]["status"] for row in rows)),
            "truncated": sum(row["delivery"]["truncated"] for row in rows),
            "contracts": {"passed": sum(known), "checked": len(known), "missing": len(rows) - len(known),
                          "pass_rate": sum(known) / len(known) if known else None}}
    return {**{key: run[key] for key in ("benchmark_id", "suite_sha256", "subset_sha256", "system_prompt_sha256", "tool_schema_sha256", "settings_sha256", "case_ids", "provider", "model", "plan_sha256")},
            "response_set_sha256": response_set_hash(run), "checker_sha256": run.get("checker_sha256"),
            "categories": category_results, "teaching": teaching, "ratings": flattened, "reviewer": reviewer,
            "note": "Public development benchmark; no overall teaching score, human-learning claim or promotion gate"}


def compare_scores(left, right):
    for key in ("benchmark_id", "suite_sha256", "subset_sha256", "system_prompt_sha256", "tool_schema_sha256", "settings_sha256", "case_ids"):
        require(left.get(key) == right.get(key) and left.get(key) is not None, f"Comparison mismatch: {key}")
    require(left.get("checker_sha256") == right.get("checker_sha256"), "Contract checker versions differ")
    require([row["case_id"] for row in left["ratings"]] == left["case_ids"] == [row["case_id"] for row in right["ratings"]], "Comparison case coverage mismatch")
    paired = defaultdict(list)
    for a, b in zip(left["ratings"], right["ratings"]):
        require(set(a["scores"]) == set(b["scores"]), "Comparison review dimensions differ")
        for name in a["scores"]:
            require(all(value is None or type(value) is int and value in {0, 1, 2} for value in (a["scores"][name], b["scores"][name])), "Invalid comparison rating")
            paired[name].append((a["scores"][name], b["scores"][name]))
    results = {}
    for name, pairs in paired.items():
        present = [(a, b) for a, b in pairs if a is not None and b is not None]
        results[name] = {"paired": len(present), "unpaired_or_missing": len(pairs) - len(present),
            "left": sum(a for a, _ in present) / (2 * len(present)) if present else None,
            "right": sum(b for _, b in present) / (2 * len(present)) if present else None,
            "right_minus_left": sum(b - a for a, b in present) / (2 * len(present)) if present else None}
    return {"plan_sha256": left["plan_sha256"], "left": {key: left[key] for key in ("provider", "model", "reviewer", "categories")},
            "right": {key: right[key] for key in ("provider", "model", "reviewer", "categories")},
            "paired_teaching": results, "note": "Identical fixed contexts/settings; quality deltas use jointly human-rated dimensions only"}


@app.command("validate")
def validate_cli(suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE):
    loaded = load_suite(suite)
    print(canonical({"benchmark_id": loaded["cases_doc"]["benchmark_id"], "cases": len(loaded["cases"]), "suite_sha256": loaded["suite_sha256"]}))


@app.command("plan")
def plan_cli(out: Annotated[Path, typer.Option("--out")], suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE,
             subset: Annotated[str, typer.Option("--subset")] = "core",
             temperature: Annotated[float, typer.Option("--temperature")] = 0.1,
             seed: Annotated[int, typer.Option("--seed")] = 42,
             input_rate: Annotated[float | None, typer.Option("--input-rate")] = None,
             output_rate: Annotated[float | None, typer.Option("--output-rate")] = None,
             max_cost: Annotated[float | None, typer.Option("--max-cost")] = None):
    plan = make_plan(load_suite(suite), subset, temperature, seed)
    if any(value is not None for value in (input_rate, output_rate, max_cost)):
        plan["cost_estimate"] = estimate_cost(plan, input_rate, output_rate)
        if max_cost is not None:
            require(math.isfinite(max_cost) and 0 < max_cost <= 100, "Invalid maximum cost")
            plan["cost_estimate"]["within_max_cost"] = plan["cost_estimate"]["reserved_usd"] <= max_cost
            plan["cost_estimate"]["max_cost_usd"] = max_cost
    write_json(out, plan)
    print(canonical({"plan_sha256": plan["plan_sha256"], "cases": len(plan["case_ids"]), "provider_calls": 0,
                     "estimated_reservation_usd": plan.get("cost_estimate", {}).get("reserved_usd")}))


@app.command("run")
def run_cli(out: Annotated[Path, typer.Option("--out")], provider: Annotated[str, typer.Option("--provider")],
            model: Annotated[str, typer.Option("--model")], base_url: Annotated[str, typer.Option("--base-url")],
            api_key_env: Annotated[str, typer.Option("--api-key-env")],
            input_rate: Annotated[float, typer.Option("--input-rate", help="Assumed USD per million input tokens")],
            output_rate: Annotated[float, typer.Option("--output-rate", help="Assumed USD per million output tokens")],
            max_cost: Annotated[float, typer.Option("--max-cost")],
            suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE,
            subset: Annotated[str, typer.Option("--subset")] = "core",
            budget_file: Annotated[Path, typer.Option("--budget-file")] = DEFAULT_BUDGET,
            temperature: Annotated[float, typer.Option("--temperature")] = 0.1,
            seed: Annotated[int, typer.Option("--seed")] = 42):
    import httpx
    require(not out.exists(), "Output exists; refusing a duplicate benchmark run")
    require(re.fullmatch(r"[A-Z][A-Z0-9_]*", api_key_env), "Specify an environment variable name, never a key")
    key = os.environ.get(api_key_env)
    require(bool(key), "The configured API key environment variable is empty")
    url = endpoint_url(base_url)
    loaded = load_suite(suite)
    plan = make_plan(loaded, subset, temperature, seed)
    # Claim the output before reserving money or opening a provider request.
    # Rewrite it atomically after each case so interruptions retain receipts.
    write_json(out, {"status": "prepared", "plan_sha256": plan["plan_sha256"], "results": []})
    def progress(value):
        temporary = out.with_name(out.name + ".next")
        write_json(temporary, value)
        os.replace(temporary, out)
    with httpx.Client(timeout=180, follow_redirects=False) as client:
        def request(payload):
            response = client.post(url, headers={"Authorization": "Bearer " + key}, json=payload)
            if response.status_code != 200:
                return {"error": {"kind": "http_error", "status": response.status_code}}
            document = response.json()
            if isinstance(document, dict) and document.get("error"):
                return {"error": {"kind": "provider_error", "status": response.status_code}}
            return document
        result = execute_plan(loaded, plan, provider, model, request,
            lambda cost: reserve_existing_budget(budget_file, cost), input_rate, output_rate, max_cost, progress)
    result["origin"].update({"endpoint": url, "api_key_env": api_key_env})
    progress(result)
    print(canonical({"output": str(out), "cases": len(result["results"]), "delivery": dict(Counter(row["delivery"]["status"] for row in result["results"]))}))


@app.command("import-responses", help="Import {plan_sha256,provenance:{source:...},responses:[{case_id,response,usage?}]}; omissions stay missing.")
def import_cli(source: Annotated[Path, typer.Option("--source")], out: Annotated[Path, typer.Option("--out")],
               provider: Annotated[str, typer.Option("--provider")], model: Annotated[str, typer.Option("--model")],
               suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE,
               subset: Annotated[str, typer.Option("--subset")] = "core",
               temperature: Annotated[float, typer.Option("--temperature")] = 0.1,
               seed: Annotated[int, typer.Option("--seed")] = 42):
    loaded = load_suite(suite)
    write_json(out, import_responses(loaded, make_plan(loaded, subset, temperature, seed), read_json(source), provider, model))


@app.command("contracts")
def contracts_cli(run: Annotated[Path, typer.Option("--run")], out: Annotated[Path, typer.Option("--out")],
                  suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE):
    write_json(out, check_contracts(load_suite(suite), read_json(run)))


@app.command("review-template")
def review_cli(run: Annotated[Path, typer.Option("--run")], out: Annotated[Path, typer.Option("--out")],
               suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE):
    write_json(out, review_template(load_suite(suite), read_json(run)))


@app.command("score")
def score_cli(run: Annotated[Path, typer.Option("--run")], out: Annotated[Path, typer.Option("--out")],
              review: Annotated[Path | None, typer.Option("--review")] = None,
              suite: Annotated[Path, typer.Option("--suite")] = DEFAULT_SUITE):
    write_json(out, score_run(load_suite(suite), read_json(run), read_json(review) if review else None))


@app.command("compare")
def compare_cli(left: Annotated[Path, typer.Option("--left")], right: Annotated[Path, typer.Option("--right")],
                out: Annotated[Path, typer.Option("--out")]):
    write_json(out, compare_scores(read_json(left), read_json(right)))


if __name__ == "__main__":
    app()
