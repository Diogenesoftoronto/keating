#!/usr/bin/env python3
"""Cross-provider core benchmark, native API receipts, separate authorized USD20 batch."""
from concurrent.futures import ThreadPoolExecutor
import copy
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import re
import stat
import threading
import time
from urllib.parse import quote, urlsplit
import uuid

import typer

import benchmark as bench

app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)
ALLOWED_PARAMS = {
    "openai-responses": {"temperature", "top_p", "reasoning", "text", "service_tier", "parallel_tool_calls"},
    "anthropic": {"temperature", "top_p", "top_k", "thinking", "output_config"},
    "gemini": {"temperature", "topP", "topK", "seed", "thinkingConfig"},
    "openai-chat": {"temperature", "top_p", "seed", "reasoning_effort", "service_tier", "parallel_tool_calls"},
}


def arm_id(arm):
    return re.sub(r"[^a-z0-9]+", "-", arm["label"].lower()).strip("-")


def native_params(arm):
    params = arm.get("native_params", {})
    if arm["provider"] == "gemini" and "generationConfig" in params:
        bench.require(set(params) == {"generationConfig"}, "Gemini native params may only override generationConfig")
        return params["generationConfig"]
    return params


def atomic_write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".next")
    bench.write_json(temporary, value)
    os.replace(temporary, path)


class BatchBudget:
    """This new ledger never reads, copies, or resets the original training ledger."""
    def __init__(self, path, cap=20.0):
        bench.require(math.isfinite(cap) and 0 < cap <= 20, "New batch cap must be at most USD20")
        self.path, self.mutex = Path(path), threading.Lock()
        bench.write_json(self.path, {"purpose": "separately authorized cross-provider benchmark", "cap_usd": cap,
                                    "estimated_usage_cost_usd": 0.0, "reserved_usd": 0.0, "events": []})

    @contextmanager
    def locked(self):
        with self.mutex:
            fd = os.open(str(self.path) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
            with os.fdopen(fd, "w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                data = bench.read_json(self.path)
                yield data
                atomic_write(self.path, data)

    def reserve(self, label, case_id, amount):
        bench.require(math.isfinite(amount) and amount > 0, "Invalid request reservation")
        with self.locked() as data:
            if data["estimated_usage_cost_usd"] + data["reserved_usd"] + amount > data["cap_usd"]:
                return None
            token = uuid.uuid4().hex
            data["reserved_usd"] += amount
            data["events"].append({"id": token, "arm": label, "case_id": case_id, "reserved_usd": amount,
                                   "status": "reserved", "estimated_usage_cost_usd": None})
            return token

    def settle(self, token, actual):
        # Missing usage never releases the reservation, including failed requests.
        if actual is None:
            return
        bench.require(math.isfinite(actual) and actual >= 0, "Invalid usage cost")
        with self.locked() as data:
            event = next(row for row in data["events"] if row["id"] == token)
            bench.require(event["status"] == "reserved", "Reservation already settled")
            data["reserved_usd"] -= event["reserved_usd"]
            data["estimated_usage_cost_usd"] += actual
            event.update(status="settled", estimated_usage_cost_usd=actual,
                         estimate_exceeded=actual > event["reserved_usd"])


def validate_arm(arm):
    bench.require(isinstance(arm, dict) and isinstance(arm.get("label"), str) and 1 <= len(arm["label"]) <= 80 and arm_id(arm), "Invalid arm label")
    bench.require(arm.get("provider") in ALLOWED_PARAMS and isinstance(arm.get("model"), str) and arm["model"], "Invalid provider/model")
    for name in ("input_rate", "output_rate"):
        bench.require(type(arm.get(name)) in (float, int) and math.isfinite(arm[name]) and arm[name] > 0, "Positive per-million rates required")
    params = native_params(arm)
    bench.require(isinstance(params, dict) and set(params) <= ALLOWED_PARAMS[arm["provider"]], "Native params must contain generation controls only")
    bench.canonical(params)
    if arm.get("base_url"):
        parsed = urlsplit(arm["base_url"])
        bench.require(parsed.scheme == "https" and parsed.hostname and not any((parsed.username, parsed.password, parsed.query, parsed.fragment)), "Use a credential-free HTTPS base URL")
    bench.require(bool(arm.get("key_file")) != bool(arm.get("api_key_env")), "Choose a private key file or environment-variable name")


def load_key(arm):
    if arm.get("api_key_env"):
        name = arm["api_key_env"]
        bench.require(re.fullmatch(r"[A-Z][A-Z0-9_]*", name), "Invalid credential environment name")
        value = os.environ.get(name, "")
    else:
        fd = os.open(arm["key_file"], os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as source:
            info = os.fstat(source.fileno())
            bench.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600,
                          "Credential must be an operator-owned regular mode0600 file")
            value = source.read(8193).strip()
    bench.require(isinstance(value, str) and 1 <= len(value) <= 8192 and "\n" not in value, "Missing or invalid provider credential")
    return value


def arguments(call):
    raw = call["function"]["arguments"]
    return json.loads(raw) if isinstance(raw, str) else raw


def native_messages(messages, provider):
    converted, calls = [], {}
    for message in messages:
        role, content = message["role"], message.get("content") or ""
        if provider == "openai-responses":
            if role == "tool":
                converted.append({"type": "function_call_output", "call_id": message["tool_call_id"], "output": content})
                continue
            if content:
                converted.append({"role": role, "content": content})
            for call in message.get("tool_calls", []):
                converted.append({"type": "function_call", "call_id": call["id"], "name": call["function"]["name"],
                                  "arguments": bench.canonical(arguments(call))})
            continue
        parts = []
        if role == "tool":
            if provider == "anthropic":
                parts.append({"type": "tool_result", "tool_use_id": message["tool_call_id"], "content": content})
            else:
                parts.append({"functionResponse": {"name": calls[message["tool_call_id"]], "response": {"result": content}}})
            role = "user"
        else:
            if content:
                parts.append({"type": "text", "text": content} if provider == "anthropic" else {"text": content})
            for call in message.get("tool_calls", []):
                calls[call["id"]] = call["function"]["name"]
                parts.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": arguments(call)}
                             if provider == "anthropic" else {"functionCall": {"name": call["function"]["name"], "args": arguments(call)}})
        native_role = "model" if provider == "gemini" and role == "assistant" else role
        content_key = "parts" if provider == "gemini" else "content"
        if converted and converted[-1]["role"] == native_role:
            converted[-1][content_key].extend(parts)
        else:
            converted.append({"role": native_role, content_key: parts})
    return converted


def build_request(arm, request):
    source = request["payload"]
    provider, model = arm["provider"], arm["model"]
    system = source["messages"][0]["content"]
    history = source["messages"][1:]
    declarations = [tool["function"] for tool in source["tools"]]
    params = copy.deepcopy(native_params(arm))
    if provider == "openai-chat":
        payload = copy.deepcopy(source)
        # Parameters are selected explicitly in native_params, including support for seed.
        for name in ("temperature", "top_p", "seed"):
            payload.pop(name, None)
        payload.update(model=model, **params)
        token_parameter = arm.get("output_token_parameter", "max_tokens" if arm.get("base_url") and urlsplit(arm["base_url"]).hostname != "api.openai.com" else "max_completion_tokens")
        bench.require(token_parameter in {"max_tokens", "max_completion_tokens"}, "Invalid output token parameter")
        payload[token_parameter] = payload.pop("max_tokens")
        endpoint = arm.get("base_url", "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    elif provider == "openai-responses":
        payload = {"model": model, "instructions": system, "input": native_messages(history, provider),
                   "tools": [{"type": "function", "name": tool["name"], "description": tool.get("description", ""),
                              "parameters": tool["parameters"], "strict": False} for tool in declarations],
                   "max_output_tokens": source["max_tokens"], "store": False, "stream": False, **params}
        endpoint = arm.get("base_url", "https://api.openai.com/v1").rstrip("/") + "/responses"
    elif provider == "anthropic":
        payload = {"model": model, "system": system, "messages": native_messages(history, provider),
                   "tools": [{"name": tool["name"], "description": tool.get("description", ""),
                              "input_schema": tool["parameters"]} for tool in declarations],
                   "max_tokens": source["max_tokens"], "stream": False, **params}
        endpoint = arm.get("base_url", "https://api.anthropic.com/v1").rstrip("/") + "/messages"
    else:
        payload = {"systemInstruction": {"parts": [{"text": system}]}, "contents": native_messages(history, provider),
                   "tools": [{"functionDeclarations": [{"name": tool["name"], "description": tool.get("description", ""),
                       "parametersJsonSchema": tool["parameters"]} for tool in declarations]}],
                   "generationConfig": {"maxOutputTokens": source["max_tokens"], "candidateCount": 1, **params}}
        endpoint = arm.get("base_url", "https://generativelanguage.googleapis.com/v1beta").rstrip("/") + "/models/" + quote(model.removeprefix("models/"), safe="") + ":generateContent"
    return {"case_id": request["case_id"], "endpoint": endpoint, "payload": payload,
            "native_request_sha256": bench.digest(bench.canonical(payload))}


def compatibility(arm, plan):
    params = native_params(arm)
    effective = {"temperature": params.get("temperature"), "top_p": params.get("topP" if arm["provider"] == "gemini" else "top_p"),
                 "seed": params.get("seed"), "max_output_tokens": plan["settings"]["max_tokens"], "stream": False, "n": 1}
    for key in ("reasoning", "reasoning_effort", "thinking", "thinkingConfig", "output_config", "text"):
        if key in params:
            effective[key] = params[key]
    deviations = [{"setting": key, "requested": plan["settings"][key], "applied": effective[key],
                   "reason": "Provider-native control omitted/default or explicitly adapted; no silent retry"}
                  for key in ("temperature", "top_p", "seed") if effective[key] != plan["settings"][key]]
    return effective, {"identical_generation_settings": not deviations, "deviations": deviations,
        "note": "Same frozen inputs; provider templates, reasoning and available controls differ. Cross-provider results are descriptive, not proof of identical generation enforcement."}


def normalize(provider, raw, case_id):
    text, calls = [], []
    usage = raw.get("usage") or {}
    reason, returned, response_id = None, raw.get("model"), raw.get("id")
    if provider == "openai-chat":
        response = bench.normalize_response(raw)
        prompt, output = usage.get("prompt_tokens"), usage.get("completion_tokens")
        cached = usage.get("prompt_tokens_details", {}).get("cached_tokens", 0)
        reasoning = usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0)
    elif provider == "openai-responses":
        for item in raw.get("output", []):
            if item.get("type") == "message":
                for block in item.get("content", []):
                    if block.get("type") == "output_text":
                        text.append(block.get("text", ""))
                    elif block.get("type") == "refusal":
                        text.append(block.get("refusal", ""))
            elif item.get("type") == "function_call":
                calls.append({"id": item.get("call_id", f"{case_id}-call-{len(calls)}"), "type": "function",
                              "function": {"name": item["name"], "arguments": item["arguments"]}})
        reason = "length" if (raw.get("incomplete_details") or {}).get("reason") == "max_output_tokens" else "tool_calls" if calls else "stop"
        prompt, output = usage.get("input_tokens"), usage.get("output_tokens")
        cached = usage.get("input_tokens_details", {}).get("cached_tokens", 0)
        reasoning = usage.get("output_tokens_details", {}).get("reasoning_tokens", 0)
    elif provider == "anthropic":
        for block in raw.get("content", []):
            if block.get("type") == "text":
                text.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                calls.append({"id": block["id"], "type": "function", "function": {"name": block["name"], "arguments": bench.canonical(block["input"])}})
        reason = "length" if raw.get("stop_reason") == "max_tokens" else "tool_calls" if calls else "stop"
        prompt = usage.get("input_tokens")
        cached, created = usage.get("cache_read_input_tokens", 0), usage.get("cache_creation_input_tokens", 0)
        if type(prompt) is int:
            prompt += cached + created
        output, reasoning = usage.get("output_tokens"), None
    else:
        usage = raw.get("usageMetadata", {})
        candidates = raw.get("candidates", [])
        bench.require(len(candidates) <= 1, "Expected one Gemini candidate")
        candidate = candidates[0] if candidates else {}
        for block in candidate.get("content", {}).get("parts", []):
            if "text" in block and not block.get("thought"):
                text.append(block["text"])
            elif "functionCall" in block:
                call = block["functionCall"]
                calls.append({"id": call.get("id", f"{case_id}-call-{len(calls)}"), "type": "function",
                              "function": {"name": call["name"], "arguments": bench.canonical(call.get("args", {}))}})
        reason = "length" if candidate.get("finishReason") == "MAX_TOKENS" else "tool_calls" if calls else "stop"
        returned, response_id = raw.get("modelVersion"), raw.get("responseId")
        prompt, output = usage.get("promptTokenCount"), usage.get("candidatesTokenCount", 0)
        cached, reasoning = usage.get("cachedContentTokenCount", 0), usage.get("thoughtsTokenCount", 0)
        if type(output) is int and type(reasoning) is int:
            output += reasoning
    if provider != "openai-chat":
        response = {"content": "\n".join(text), "tool_calls": calls, "finish_reason": reason}
    standardized = {"prompt_tokens": prompt, "completion_tokens": output, "cached_input_tokens": cached,
                    "reasoning_tokens": reasoning, "raw": usage}
    receipt = {"model": returned, "id": response_id}
    if isinstance(raw.get("system_fingerprint"), str):
        receipt["system_fingerprint"] = raw["system_fingerprint"]
    return response, standardized, receipt


def estimate_request(arm, wire):
    allowance = len(bench.canonical(wire["payload"]).encode()) + 4096
    body = wire["payload"]
    cap = body.get("max_completion_tokens", body.get("max_tokens", body.get("max_output_tokens", body.get("generationConfig", {}).get("maxOutputTokens"))))
    return (allowance * arm["input_rate"] + cap * arm["output_rate"]) / 1e6


def usage_cost(arm, usage):
    prompt, output = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if not all(type(value) is int and value >= 0 for value in (prompt, output)):
        return None
    # Treat cached reads as full-price input conservatively. No cache-write request is added.
    creation = usage.get("raw", {}).get("cache_creation_input_tokens", 0)
    surcharge = creation * arm["input_rate"] if type(creation) is int and creation > 0 else 0
    return (prompt * arm["input_rate"] + output * arm["output_rate"] + surcharge) / 1e6


def safe_error(raw, status):
    result = {"kind": "http_error" if status != 200 else "provider_error", "status": status}
    detail = raw.get("error") if isinstance(raw, dict) else None
    if isinstance(detail, dict):
        for name in ("code", "type", "status", "param"):
            value = detail.get(name)
            if type(value) is int or isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.\[\]-]{0,100}", value):
                result["provider_" + name] = value
    return {"error": result}


def run_arm(suite, plan, arm, budget, persist, dispatch):
    effective, deviations = compatibility(arm, plan)
    run = bench.run_base(plan, arm["provider"], arm["model"], {"kind": "cross-provider-native", "arm_label": arm["label"],
        "provider_api": arm["provider"], "requested_settings": plan["settings"], "effective_settings": effective,
        "compatibility": deviations, "native_params": arm.get("native_params", {}),
        "rates_usd_per_million": {"input": arm["input_rate"], "output": arm["output_rate"]}})
    cases = {case["id"]: case for case in suite["cases"]}
    run["results"] = [bench.result_row(cases[case_id], {"error": {"kind": "not_dispatched"}}) for case_id in plan["case_ids"]]
    run["status"] = "running"
    persist(arm["label"], run)
    for index, request in enumerate(plan["requests"]):
        wire = build_request(arm, request)
        allowance = estimate_request(arm, wire)
        token = budget.reserve(arm["label"], request["case_id"], allowance)
        if token is None:
            run["status"] = "budget_limited"
            run["budget_note"] = "Remaining cases were not dispatched; existing requests and uncertain failures retain their budget allocation"
            break
        usage, actual, receipt = None, None, {}
        started = time.monotonic()
        try:
            raw = dispatch(arm, wire)
            if raw.get("error"):
                response = {"error": raw["error"]}
            else:
                response, usage, receipt = normalize(arm["provider"], raw, request["case_id"])
                actual = usage_cost(arm, usage)
            row = bench.result_row(cases[request["case_id"]], response, usage, arm["model"])
        except Exception as error:
            row = bench.result_row(cases[request["case_id"]], {"error": {"kind": "request_or_normalization_error", "type": type(error).__name__}})
        budget.settle(token, actual)
        row["provider_receipt"] = bench.provider_receipt(receipt, arm["model"])
        row["native_request_sha256"] = wire["native_request_sha256"]
        row["timing"] = {"wall_time_seconds": time.monotonic() - started, "measurement": "End-to-end request and response processing; not decode throughput"}
        row["cost_receipt"] = {"reservation_usd": allowance, "estimated_usage_cost_usd": actual, "usage_measured": actual is not None}
        run["results"][index] = row
        persist(arm["label"], run)
    if run["status"] == "running":
        run["status"] = "complete"
    persist(arm["label"], run)
    return run


@app.command()
def main(config: Path = typer.Option(..., "--config"), output_dir: Path = typer.Option(..., "--output-dir"),
         max_cost: float = typer.Option(20, "--max-cost"), concurrency: int = typer.Option(3, "--concurrency"),
         plan_only: bool = typer.Option(False, "--plan-only")):
    configuration = bench.read_json(config)
    arms = configuration.get("arms", configuration.get("models", []))
    bench.require(arms and len({arm["label"] for arm in arms}) == len(arms), "Select distinct arms")
    bench.require(1 <= concurrency <= 8, "Concurrency must be between1 and8")
    bench.require(math.isfinite(max_cost) and 0 < max_cost <= 20, "Batch cost cap cannot exceed USD20")
    for arm in arms:
        validate_arm(arm)
    bench.require(len({arm_id(arm) for arm in arms}) == len(arms), "Arm filenames collide")
    suite = bench.load_suite(bench.DEFAULT_SUITE)
    plan = bench.make_plan(suite, "core")
    wires = {arm["label"]: [build_request(arm, request) for request in plan["requests"]] for arm in arms}
    estimates = {arm["label"]: sum(estimate_request(arm, wire) for wire in wires[arm["label"]]) for arm in arms}
    keys = {} if plan_only else {arm["label"]: load_key(arm) for arm in arms}
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    bench.write_json(output_dir / "batch-plan.json", {"plan_sha256": plan["plan_sha256"] if isinstance(plan, dict) else None,
        "budget_cap_usd": max_cost, "arms": [{"label": arm["label"], "provider": arm["provider"], "model": arm["model"],
        "conservative_reservation_usd": estimates[arm["label"]], "effective_settings": compatibility(arm, plan)[0],
        "compatibility": compatibility(arm, plan)[1]} for arm in arms],
        "note": "Per-request byte allowance; known usage settles at conservative uncached prices. Uncertain failures keep their reservation. A batch exceeding this preflight sum can still fit after settlement."})
    for arm in arms:
        bench.write_json(output_dir / (arm_id(arm) + ".native-requests.json"), wires[arm["label"]])
    if plan_only:
        print(bench.canonical({"provider_calls": 0, "arms": len(arms), "conservative_total_usd": sum(estimates.values())}))
        return
    import httpx
    budget = BatchBudget(output_dir / "budget.json", max_cost)
    def persist(label, run):
        atomic_write(output_dir / (arm_id({"label": label}) + ".json"), run)
        completed = sum(row["delivery"]["status"] != "missing" for row in run["results"])
        print(bench.canonical({"arm": label, "status": run["status"], "completed": completed, "total": len(run["results"])}), flush=True)
    with httpx.Client(timeout=180, follow_redirects=False) as client:
        def dispatch(arm, wire):
            key = keys[arm["label"]]
            headers = {"anthropic-version": "2023-06-01", "x-api-key": key} if arm["provider"] == "anthropic" else {"x-goog-api-key": key} if arm["provider"] == "gemini" else {"Authorization": "Bearer " + key}
            response = client.post(wire["endpoint"], headers=headers, json=wire["payload"])
            if response.status_code != 200:
                try:
                    body = response.json()
                except ValueError:
                    body = None
                return safe_error(body, response.status_code)
            raw = response.json()
            if not isinstance(raw, dict) or raw.get("error"):
                return safe_error(raw, response.status_code)
            return raw
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            runs = list(pool.map(lambda arm: run_arm(suite, plan, arm, budget, persist, dispatch), arms))
    ledger = bench.read_json(budget.path)
    summaries = []
    for arm, run in zip(arms, runs):
        usage = [row["usage"] for row in run["results"] if row.get("usage")]
        events = [event for event in ledger["events"] if event["arm"] == arm["label"]]
        summaries.append({"label": arm["label"], "requested_model": arm["model"],
            "input_tokens": sum(item.get("prompt_tokens") or 0 for item in usage),
            "output_tokens": sum(item.get("completion_tokens") or 0 for item in usage),
            "cached_input_tokens": sum(item.get("cached_input_tokens") or 0 for item in usage),
            "estimated_usage_cost_usd": sum(event["estimated_usage_cost_usd"] or 0 for event in events),
            "reserved_usd": sum(event["reserved_usd"] for event in events if event["status"] == "reserved"),
            "rates_usd_per_million": {"input": arm["input_rate"], "output": arm["output_rate"]}})
    bench.write_json(output_dir / "cost-summary.json", {"budget_cap_usd": ledger["cap_usd"],
        "reserved_usd": ledger["reserved_usd"], "estimated_usage_cost_usd": ledger["estimated_usage_cost_usd"],
        "headroom_usd": ledger["cap_usd"] - ledger["reserved_usd"] - ledger["estimated_usage_cost_usd"], "arms": summaries,
        "limitations": "Provider usage priced conservatively without cache-read discounts, not an invoice. Missing usage and failed requests retain reservations. Separate user-authorized USD20 batch; original USD100 training ledger untouched."})
    print(bench.canonical({"completed_arms": len(runs), "estimated_usage_cost_usd": ledger["estimated_usage_cost_usd"], "held_reservations_usd": ledger["reserved_usd"]}), flush=True)


if __name__ == "__main__":
    app()
