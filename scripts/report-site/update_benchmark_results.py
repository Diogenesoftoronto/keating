#!/usr/bin/env python3
"""Attach verified benchmark responses while keeping teaching ratings unreviewed."""
from collections import Counter
import json
import math
from pathlib import Path
import re
from statistics import median
import sys
from typing import Annotated

import typer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/training"))
import benchmark as bench

DEFAULT_REPORT = ROOT / "web/public/reports/learning-to-teach/report-data.json"
LABELS = {"base": "Base Inkling Small", "identity-sft-run-v2": "Identity SFT", "openui-sft-run": "OpenUI SFT", "openui-sdpo-run": "OpenUI SFT + SDPO"}
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


def safe_identifier(value: object, field: str) -> str:
    bench.require(isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._+:/-]{0,159}", value)), f"Invalid {field}")
    bench.require(not value.startswith(("/", "http:", "https:", "tinker:", "did:")), f"Private address is not a public {field}")
    return value


def public_response(source: dict) -> dict:
    """Keep model output exact, excluding arbitrary transport metadata and error text."""
    calls = []
    for call in source["tool_calls"]:
        function = call.get("function", {})
        name = safe_identifier(function.get("name", call.get("name", "")), "tool name")
        arguments = function.get("arguments", call.get("arguments"))
        bench.require(isinstance(arguments, (str, dict)), "Tool arguments must remain JSON source or an object")
        result = {"function": {"name": name, "arguments": arguments}}
        # Native benchmark IDs are derived from the public case, not provider sessions.
        if isinstance(call.get("id"), str) and re.fullmatch(r"benchmark-[a-z0-9-]+-call-[0-9]+", call["id"]):
            result["id"] = call["id"]
        if call.get("type") == "function":
            result["type"] = "function"
        calls.append(result)
    error = source.get("error")
    if error:
        error = {key: value for key, value in error.items() if key in {"kind", "type"} and isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value)} if isinstance(error, dict) else {}
        source_status = source.get("error", {}).get("status") if isinstance(source.get("error"), dict) else None
        if type(source_status) is int and 100 <= source_status <= 599:
            error["status"] = source_status
        if not error:
            error = {"kind": "provider_error"}
    return {"content": source["content"], "tool_calls": calls, "finish_reason": source["finish_reason"], "error": error}


def public_contract(source: dict) -> dict:
    passed = source.get("contract_passed")
    bench.require(passed is None or type(passed) is bool, "Invalid contract pass value")
    checks = []
    for item in source.get("checks", []):
        bench.require(item.get("status") in {"pass", "fail", "not_applicable"}, "Invalid named check status")
        bench.require(isinstance(item.get("name"), str) and isinstance(item.get("evidence"), str), "Missing named check evidence")
        checks.append({key: item[key] for key in ("name", "status", "evidence")})
    if type(passed) is bool:
        bench.require(bool(checks) and passed == all(item["status"] != "fail" for item in checks), "Contract aggregate disagrees with named checks")
    ui = source.get("openui", {})
    return {
        "contract_passed": passed,
        "status": source.get("status", "checked" if type(passed) is bool else "unavailable"),
        "checks": checks,
        "openui": {
            "surfaces": [{key: surface[key] for key in ("id", "complete", "format", "compiled", "error") if key in surface} for surface in ui.get("surfaces", [])],
            "document_count": len(ui.get("documents", [])),
            "actions": [{key: action[key] for key in ("type", "node_id", "replayed") if key in action} for action in ui.get("actions", [])],
        },
    }


def public_timing(row: dict) -> dict | None:
    timing = row.get("timing") or {}
    seconds = timing.get("wall_time_seconds")
    if seconds is None:
        return None
    bench.require(type(seconds) in (int, float) and math.isfinite(seconds) and seconds >= 0, "Invalid response wall time")
    tokens = (row.get("usage") or {}).get("completion_tokens")
    bench.require(tokens is None or type(tokens) is int and tokens >= 0, "Invalid reported output token count")
    return {"wall_time_seconds": seconds, "reported_output_tokens": tokens,
            "end_to_end_output_tokens_per_second": tokens / seconds if tokens is not None and seconds > 0 else None,
            "measurement": "Full request and response processing time. Output counts may include reasoning; tokens per second here is not decode throughput."}


def verified_observations(path: Path, runs: list[dict]) -> dict:
    source = bench.read_json(path)
    bench.require(source.get("review_kind") == "ai_qualitative", "Qualitative notes must identify AI review")
    rows = {(run["model"], row["case_id"]): row for run in runs for row in run["results"]}
    observations = []
    for item in source.get("observations", []):
        bench.require(all(isinstance(item.get(key), str) and item[key].strip() for key in ("case_id", "title", "text")), "A reading note needs a case, title, and text")
        bench.require(isinstance(item.get("evidence"), list) and bool(item["evidence"]), "Every AI reading note needs actual response evidence")
        evidence = []
        for entry in item["evidence"]:
            row = rows.get((entry.get("requested_model"), item["case_id"]))
            bench.require(row is not None and not row["response"].get("error"), "Reading note references an unavailable response")
            quote = entry.get("quote")
            response_text = (row["response"].get("content") or "") + "\n" + bench.canonical(row["response"].get("tool_calls", []))
            bench.require(isinstance(quote, str) and bool(quote.strip()) and quote in response_text, "AI review quote is not present in the named model and case")
            evidence.append({"requested_model": entry["requested_model"], "label": LABELS.get(entry["requested_model"], entry["requested_model"]), "quote": quote, "response_sha256": row["response_sha256"]})
        observations.append({"case_id": item["case_id"], "title": item["title"], "text": item["text"], "evidence": evidence})
    bench.require(bool(observations), "AI reading notes are empty")
    return {"review_kind": "ai_qualitative", "observations": observations,
            "limitation": "AI qualitative interpretation with quote-verified evidence. This is not a human rubric rating or a causal diagnosis of training."}


def verified_cost(path: Path, runs: list[dict]) -> dict:
    source = bench.read_json(path)
    rows = [row for run in runs for row in run["results"]]
    for row in rows:
        bench.require(isinstance(row.get("usage"), dict) and all(type(row["usage"].get(key)) is int and row["usage"][key] >= 0 for key in ("prompt_tokens", "completion_tokens")), "Cost requires observed usage for every included response")
    counts = {"input_tokens": sum(row["usage"]["prompt_tokens"] for row in rows), "output_tokens": sum(row["usage"]["completion_tokens"] for row in rows)}
    bench.require(all(source.get(key) == value for key, value in counts.items()), "Cost token counts disagree with the actual response receipts")
    rates = source["rates_usd_per_million"]
    bench.require(all(type(rates.get(key)) in (int, float) and math.isfinite(rates[key]) and rates[key] > 0 for key in ("input", "cached_input", "output")), "Cost rates must be finite and positive")
    bench.require(rates["cached_input"] <= rates["input"] and source.get("cache_hits_measured") is False, "Only explicitly unmeasured cache scenarios are supported")
    estimates = {"all_cached": (counts["input_tokens"] * rates["cached_input"] + counts["output_tokens"] * rates["output"]) / 1e6,
                 "uncached": (counts["input_tokens"] * rates["input"] + counts["output_tokens"] * rates["output"]) / 1e6}
    def same(actual, expected, label):
        bench.require(type(actual) in (int, float) and math.isfinite(actual) and math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), f"Cost mismatch: {label}")
    for key, value in estimates.items():
        same(source["estimated_token_cost_usd"].get(key), value, key)
    preflight = runs[0].get("origin", {}).get("all_arms_preflight")
    bench.require(isinstance(preflight, dict) and all(run.get("origin", {}).get("all_arms_preflight") == preflight for run in runs), "Cost requires a shared native preflight receipt")
    bench.require(preflight.get("arms") == len(runs) and preflight.get("cases_per_arm") == len(runs[0]["results"]), "Cost preflight does not cover these model arms and cases")
    discount = source.get("discount_already_in_rates")
    bench.require(type(discount) in (int, float) and 0 <= discount < 1, "Invalid included pricing discount")
    same(rates["input"], preflight["input_usd_per_million"] * (1 - discount), "input discount")
    same(rates["output"], preflight["output_usd_per_million"] * (1 - discount), "output discount")
    same(source.get("safety_reservation_usd"), preflight["planned_reservation_usd"], "safety reservation")
    same(source.get("budget_reserved_after_usd"), preflight["existing_reserved_usd"] + preflight["planned_reservation_usd"], "reservation after benchmark")
    same(source.get("budget_cap_usd"), 100, "original spend cap")
    same(source.get("headroom_usd"), 100 - source["budget_reserved_after_usd"], "remaining headroom")
    bench.require(source.get("pricing_source") == "https://tinker-docs.thinkingmachines.ai/tinker/models/", "Unexpected pricing source")
    return {
        "source": "Actual native token counts priced as scenarios; no invoice reconciliation",
        **counts, "rates_usd_per_million": {key: rates[key] for key in ("input", "cached_input", "output")},
        "pricing_source": source["pricing_source"], "discount_already_in_rates": discount,
        "cache_hits_measured": False, "estimated_token_cost_usd": estimates,
        **{key: source[key] for key in ("safety_reservation_usd", "budget_reserved_after_usd", "budget_cap_usd", "headroom_usd")},
        "limitations": "Cache hits were not measured. The discount is included once. Estimates exclude storage and are not billed amounts; safety reservations are budget controls.",
    }


def public_generation_settings(run: dict) -> dict:
    origin = run.get("origin", {})
    if origin.get("kind") == "cross-provider-native":
        bench.require(origin.get("requested_settings") == run["settings"], "Native requested settings differ from the verified benchmark plan")
        effective = origin.get("effective_settings")
        compatibility = origin.get("compatibility")
        bench.require(isinstance(effective, dict) and isinstance(compatibility, dict), "Native provider run requires effective settings and compatibility receipts")
        allowed = {"temperature", "top_p", "seed", "max_output_tokens", "max_tokens", "stream", "n", "reasoning", "thinking", "reasoning_effort", "thinking_budget", "thinking_level", "include_thoughts", "thinkingConfig", "output_config", "text", "renderer"}
        bench.require(set(effective) <= allowed, "Unsupported effective-setting field")
        # Generation controls only. Never copy request bodies, auth, URLs, or provider sessions.
        def valid_control(value):
            if value is None or isinstance(value, bool): return True
            if isinstance(value, str): return len(value) <= 160 and not value.startswith(("http:", "https:", "tinker:", "did:", "/"))
            if type(value) in (int, float): return math.isfinite(value)
            if isinstance(value, dict): return all(isinstance(key, str) and key not in {"api_key", "authorization", "endpoint", "url", "messages", "tools"} and valid_control(child) for key, child in value.items())
            return False
        bench.require(all(valid_control(value) for value in effective.values()), "Invalid public generation controls")
        deviations = []
        for item in compatibility.get("deviations", []):
            bench.require(isinstance(item.get("setting"), str) and isinstance(item.get("reason"), str)
                          and valid_control(item.get("requested")) and valid_control(item.get("applied")), "Invalid generation-setting deviation")
            deviations.append({key: item.get(key) for key in ("setting", "requested", "applied", "reason")})
        identical = compatibility.get("identical_generation_settings")
        bench.require(type(identical) is bool and (not identical or not deviations), "Generation-compatibility receipt is inconsistent")
        return {"kind": "cross-provider-native", "provider_api": safe_identifier(origin.get("provider_api"), "provider API"),
                "requested_settings": run["settings"], "effective_settings": effective,
                "compatibility": {"identical_generation_settings": identical, "deviations": deviations,
                    "note": "Same frozen inputs; native provider controls or defaults may differ. This is a descriptive comparison, not a fully controlled sampling comparison."}}
    if origin.get("kind") == "tinker-native":
        return {"kind": "tinker-native", "provider_api": "Tinker native sampling", "requested_settings": run["settings"],
                "effective_settings": {"temperature": run["settings"]["temperature"], "top_p": run["settings"]["top_p"], "seed": run["settings"]["seed"],
                    "max_output_tokens": run["settings"]["max_tokens"], "reasoning": {"effort": origin.get("effort")}},
                "compatibility": {"identical_generation_settings": True, "deviations": [], "note": "The original four Inkling arms used the same native sampling controls; provider internals were not independently verified."}}
    return {"kind": "requested-settings-only", "requested_settings": run["settings"], "effective_settings": None,
            "compatibility": {"identical_generation_settings": False, "deviations": [], "note": "Requested controls are recorded; effective provider controls were not independently established."}}


def verified_external_cost(paths: list[Path], runs: list[dict]) -> dict:
    """Price provider receipts and held failure reservations on the separate USD20 authorization."""
    external = [run for run in runs if run["model"] not in LABELS]
    by_arm = {(run["origin"].get("arm_label"), run["model"]): run for run in external}
    bench.require(len(by_arm) == len(external), "External cost arms are ambiguous")
    seen, batches = set(), []
    def same(actual, expected, label):
        bench.require(type(actual) in (int, float) and math.isfinite(actual) and math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), f"External cost mismatch: {label}")
    for path in paths:
        source = bench.read_json(path)
        cap = source.get("budget_cap_usd")
        bench.require(type(cap) in (int, float) and math.isfinite(cap) and 0 < cap <= 20, "External cost batch exceeds the separate USD20 authorization")
        public_arms = []
        for item in source["arms"]:
            key = (item.get("label"), item.get("requested_model"))
            bench.require(key in by_arm and key not in seen, "Missing or repeated external cost arm")
            seen.add(key); run = by_arm[key]
            rates = run["origin"].get("rates_usd_per_million")
            bench.require(isinstance(rates, dict) and item.get("rates_usd_per_million") == rates, "External rates disagree with dispatched arm metadata")
            bench.require(all(type(rates.get(name)) in (int, float) and math.isfinite(rates[name]) and rates[name] > 0 for name in ("input", "output")), "Invalid external rates")
            counts = {"input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0}
            estimated, held, measured = 0.0, 0.0, 0
            for row in run["results"]:
                usage = row.get("usage") or {}
                for target, key_name in (("input_tokens", "prompt_tokens"), ("output_tokens", "completion_tokens"), ("cached_input_tokens", "cached_input_tokens")):
                    value = usage.get(key_name)
                    bench.require(value is None or type(value) is int and value >= 0, "Invalid observed provider token count")
                    counts[target] += value or 0
                receipt = row.get("cost_receipt")
                if not receipt:
                    bench.require(row["delivery"]["status"] == "missing", "A dispatched external request has no cost receipt")
                    continue
                reserved = receipt.get("reservation_usd")
                bench.require(type(reserved) in (int, float) and math.isfinite(reserved) and reserved >= 0, "Invalid external reservation")
                actual = receipt.get("estimated_usage_cost_usd")
                if actual is None:
                    bench.require(receipt.get("usage_measured") is False, "Missing cost marked measured")
                    held += reserved; continue
                bench.require(receipt.get("usage_measured") is True and all(type(usage.get(name)) is int for name in ("prompt_tokens", "completion_tokens")), "Priced external request lacks observed usage")
                creation = usage.get("raw", {}).get("cache_creation_input_tokens", 0)
                bench.require(type(creation) is int and creation >= 0, "Invalid observed cache creation count")
                expected = ((usage["prompt_tokens"] + creation) * rates["input"] + usage["completion_tokens"] * rates["output"]) / 1e6
                same(actual, expected, "priced response usage")
                estimated += actual; measured += 1
            for key_name, count in counts.items(): same(item.get(key_name), count, key_name)
            same(item.get("estimated_usage_cost_usd"), estimated, "arm usage cost")
            same(item.get("reserved_usd"), held, "arm held reservations")
            public_arms.append({"label": safe_identifier(item["label"], "cost arm label"), "requested_model": run["model"],
                **counts, "estimated_usage_cost_usd": estimated, "reserved_usd": held, "measured_requests": measured,
                "cases": len(run["results"]), "rates_usd_per_million": {name: rates[name] for name in ("input", "output")}})
        total = sum(arm["estimated_usage_cost_usd"] for arm in public_arms)
        held = sum(arm["reserved_usd"] for arm in public_arms)
        same(source.get("estimated_usage_cost_usd"), total, "batch usage cost")
        same(source.get("reserved_usd"), held, "batch held reservations")
        same(source.get("headroom_usd"), cap - total - held, "batch headroom")
        batches.append({"budget_cap_usd": cap, "estimated_usage_cost_usd": total, "reserved_usd": held,
                       "headroom_usd": cap - total - held, "arms": public_arms})
    bench.require(seen == set(by_arm), "Cost files must cover every included external arm exactly once")
    caps = sum(batch["budget_cap_usd"] for batch in batches)
    bench.require(caps <= 20 + 1e-8, "Combined external batch caps exceed USD20")
    estimated = sum(batch["estimated_usage_cost_usd"] for batch in batches)
    held = sum(batch["reserved_usd"] for batch in batches)
    return {"authorized_cap_usd": 20, "allocated_batch_caps_usd": caps, "estimated_usage_cost_usd": estimated,
            "reserved_usd": held, "headroom_usd": 20 - estimated - held, "batches": batches,
            "limitations": "Separate USD20 evaluation authorization. Provider usage is conservatively priced without cache-read discounts, not a reconciled invoice. Failed or unmetered requests retain reservations. The original USD100 ledger is unchanged."}


def export_results(run_paths: list[Path], suite_dir: Path, report_path: Path, observations_path: Path | None = None, cost_path: Path | None = None, external_cost_paths: list[Path] | None = None) -> dict:
    bench.require(bool(run_paths), "Supply at least one checked run")
    suite = bench.load_suite(suite_dir)
    data = bench.read_json(report_path)
    definition = data.get("benchmark")
    bench.require(isinstance(definition, dict), "Publish the frozen benchmark definition before results")
    for key, expected in (("manifest", suite["manifest"]), ("case_definition", suite["cases_doc"]), ("rubric", suite["rubric"]), ("context", suite["context"])):
        bench.require(definition.get(key) == expected, f"Published benchmark {key} differs from the frozen suite")
    arms, scores, runs = [], [], []
    for path in run_paths:
        run = bench.read_json(path)
        bench.verify_run(suite, run)
        bench.require(run.get("checker_sha256") == suite["manifest"]["contract_checker"]["sha256"], "Run must have checks from the frozen checker")
        bench.require(all(isinstance(row.get("contracts"), dict) for row in run["results"]), "Run is missing contract check results")
        score = bench.score_run(suite, run)
        if scores:
            bench.compare_scores(scores[0], score)
            bench.require(run["plan_sha256"] == runs[0]["plan_sha256"], "Run plans differ")
        scores.append(score); runs.append(run)
        requested = safe_identifier(run["model"], "requested model label")
        bench.require(not any(arm["requested_model"] == requested for arm in arms), "Repeated model labels would make the comparison ambiguous")
        rows = []
        for row in run["results"]:
            response = public_response(row["response"])
            rows.append({
                "case_id": row["case_id"], "response": response,
                "response_sha256": row["response_sha256"],
                "public_response_sha256": bench.digest(bench.canonical(response)),
                "delivery": {key: row["delivery"][key] for key in ("status", "visible_required", "truncated", "characters", "tool_calls")},
                "contracts": public_contract(row["contracts"]),
                "timing": public_timing(row),
                "human_scores": None,
            })
        known = [row["contracts"]["contract_passed"] for row in rows if type(row["contracts"]["contract_passed"]) is bool]
        counts = Counter(row["delivery"]["status"] for row in rows)
        timed = [row for row in rows if row["timing"] is not None]
        response_timing = [row["timing"] for row in timed if row["delivery"]["status"] in {"pass", "fail"}]
        response_rates = [value["end_to_end_output_tokens_per_second"] for value in response_timing if value["end_to_end_output_tokens_per_second"] is not None]
        delivered_timing = [row["timing"] for row in timed if row["delivery"]["status"] == "pass"]
        delivered_rates = [value["end_to_end_output_tokens_per_second"] for value in delivered_timing if value["end_to_end_output_tokens_per_second"] is not None]
        arm = {
            "id": f"arm-{len(arms) + 1}", "label": LABELS.get(requested, safe_identifier(run.get("origin", {}).get("arm_label", requested), "arm label")), "requested_model": requested,
            "provider": safe_identifier(run["provider"], "provider label"),
            "generation": public_generation_settings(run),
            "run_sha256": bench.digest(Path(path).read_bytes()), "response_set_sha256": bench.response_set_hash(run),
            "summary": {"cases": len(rows), "delivery": {key: counts.get(key, 0) for key in ("pass", "fail", "error", "missing")},
                "truncated": sum(row["delivery"]["truncated"] for row in rows),
                "contracts": {"passed": sum(known), "checked": len(known), "missing": len(rows) - len(known)},
                "timing": {"timed_requests": len(timed), "cases": len(rows), "delivered_measured": len(delivered_timing),
                    "response_measured": len(response_timing),
                    "median_response_wall_time_seconds": median(value["wall_time_seconds"] for value in response_timing) if response_timing else None,
                    "median_response_end_to_end_output_tokens_per_second": median(response_rates) if response_rates else None,
                    "response_output_rate_measured": len(response_rates),
                    "median_delivered_wall_time_seconds": median(value["wall_time_seconds"] for value in delivered_timing) if delivered_timing else None,
                    "median_delivered_end_to_end_output_tokens_per_second": median(delivered_rates) if delivered_rates else None,
                    "output_rate_measured": len(delivered_rates), "error_requests": counts.get("error", 0),
                    "scope": "Response medians include all non-error responses, including delivery failures, and exclude provider errors or missing requests. Delivered-only medians are retained separately. These are end-to-end request rates, not decode throughput or time to first token."}},
            "responses": rows,
        }
        access = run.get("origin", {}).get("access_failure")
        if access is not None:
            bench.require(isinstance(access, dict) and access.get("reason") in {"insufficient_provider_credit", "provider_permission_denied", "model_unavailable"}, "Unknown provider access failure classification")
            bench.require(isinstance(access.get("note"), str) and bool(access["note"].strip()) and counts.get("pass", 0) == 0, "Access-failure annotation conflicts with delivered results")
            arm["access_failure"] = {"reason": access["reason"], "note": access["note"]}
        checkpoint_hash = run.get("origin", {}).get("arm", {}).get("checkpoint_result_sha256")
        if isinstance(checkpoint_hash, str) and re.fullmatch(r"[a-f0-9]{64}", checkpoint_hash):
            arm["checkpoint_result_sha256"] = checkpoint_hash
        arms.append(arm)
    bench.require(any(row["delivery"]["status"] in {"pass", "fail"} for run in runs for row in run["results"]), "No model response was collected; do not publish measurements for failed access")
    first = runs[0]
    definition["results"] = {
        **{key: first[key] for key in ("plan_sha256", "suite_sha256", "subset_sha256", "settings_sha256", "case_ids", "settings")},
        "system_prompt_sha256": first["system_prompt_sha256"], "tool_schema_sha256": first["tool_schema_sha256"],
        "checker_sha256": first["checker_sha256"],
        "teaching_status": "unreviewed", "human_scores": None, "arms": arms,
        "scope": "One actual continuation per fixed prefix, ending at the first assistant output or native tool call. No next assistant reply is sampled after a tool returns. A tool-only delivery failure does not establish inability to teach after tool execution. Native tool checks execute only in isolated memory; report previews do not call models.",
        "identity_note": "Labels identify requested base/checkpoint arms. Private sampler addresses and provider session metadata are omitted.",
        "comparison_kind": "descriptive-cross-provider" if any(arm["generation"]["kind"] == "cross-provider-native" for arm in arms) else "shared-native-controls",
    }
    if observations_path is not None:
        definition["results"]["qualitative_review"] = verified_observations(observations_path, runs)
    if cost_path is not None:
        definition["results"]["cost"] = verified_cost(cost_path, [run for run in runs if run["model"] in LABELS])
    if external_cost_paths:
        definition["results"]["external_cost"] = verified_external_cost(external_cost_paths, runs)
    definition["status"] = "responses_collected"
    definition["teaching_status"] = "unreviewed"
    definition["human_scores"] = None
    report_path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return {"status": definition["status"], "arms": len(arms), "cases_per_arm": len(first["case_ids"]), "teaching_status": "unreviewed"}


@app.command()
def main(run: Annotated[list[Path], typer.Option("--run")], suite: Annotated[Path, typer.Option("--suite")] = bench.DEFAULT_SUITE,
         report_path: Annotated[Path, typer.Option("--report-path")] = DEFAULT_REPORT,
         observations: Annotated[Path | None, typer.Option("--observations")] = None,
         cost_file: Annotated[Path | None, typer.Option("--cost-file")] = None,
         external_cost_file: Annotated[list[Path] | None, typer.Option("--external-cost-file")] = None):
    typer.echo(json.dumps(export_results(run, suite, report_path, observations, cost_file, external_cost_file)))


if __name__ == "__main__":
    app()
