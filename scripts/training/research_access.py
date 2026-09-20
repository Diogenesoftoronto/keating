# /// script
# requires-python = ">=3.11"
# dependencies = ["tinker>=0.16", "certifi"]
# ///
"""Read-only research account preflight. Loads named Skate secrets only in memory."""
import argparse
import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import ssl


ROOT = Path(__file__).resolve().parents[2]
SECRET_NAMES = {
    "tinker": "thinking_machines_api_key@default",
    "runpod": "runpod_api_key@secrets",
}


def skate_secret(provider):
    result = subprocess.run(["skate", "get", SECRET_NAMES[provider]], capture_output=True, text=True, timeout=15)
    if result.returncode or not result.stdout.strip():
        raise ValueError("Skate credential unavailable")
    value = result.stdout.strip()
    if value.startswith("{") or "\n" in value:
        raise ValueError("Expected a plain API key in the named Skate entry")
    return value


def certificate_context():
    import certifi
    # uv's portable Python does not reliably discover this workstation's CA path.
    # Preserve a deliberately configured enterprise CA bundle when present.
    bundle = os.environ.get("SSL_CERT_FILE") or certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", bundle)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", bundle)
    return ssl.create_default_context(cafile=bundle)


def read_json(url, key=None):
    headers = {"User-Agent": "keating-research-preflight/1.0"}
    if key:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, context=certificate_context(), timeout=30) as response:
        return json.load(response)


def check_tinker():
    import tinker
    certificate_context()
    service = tinker.ServiceClient(api_key=skate_secret("tinker"))
    models = sorted(model.model_name for model in service.get_server_capabilities().supported_models)
    return {"authenticated": True, "supported_models": models,
            "reference_observer_base_supported": "Qwen/Qwen3.5-9B-Base" in models,
            "operations": ["get_server_capabilities"], "billable_work_launched": False}


def check_runpod():
    value = read_json("https://api.runpod.io/v2/pods", skate_secret("runpod"))
    return {"authenticated": True, "api_version": "v2", "pods": [
        {field: pod.get(field) for field in ("id", "name", "status", "desiredStatus", "costPerHr")}
        for pod in value["pods"]], "operations": ["GET /v2/pods"], "billable_work_launched": False}


def pilot_budgets():
    rows = []
    for path in sorted((ROOT / ".keating/outputs/training").glob("*/budget.json")):
        value = json.loads(path.read_text())
        cap, reserved = value.get("cap_usd"), value.get("reserved_usd")
        if isinstance(cap, (float, int)) and isinstance(reserved, (float, int)):
            rows.append({"path": str(path.relative_to(ROOT)), "model": value.get("model"),
                         "cap_usd": cap, "reserved_usd": reserved, "unreserved_usd": cap - reserved})
    return rows


def preflight():
    certificate_context()
    report = {"schema_version": 1, "checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "credential_names": SECRET_NAMES, "budget_ledgers": pilot_budgets(),
              "notes": ["Account access is not new spending authorization.",
                        "Reservations are local safeguards, not invoices or a provider spending limit."]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        checks = {name: pool.submit(check) for name, check in (("tinker", check_tinker), ("runpod", check_runpod))}
        for name, future in checks.items():
            try:
                report[name] = future.result()
            except Exception as error:
                # Provider errors can include authenticated URLs, request bodies or headers.
                # Emit only the class/status; never exception strings or SDK response objects.
                report[name] = {"authenticated": False, "error_type": type(error).__name__,
                                "http_status": getattr(error, "status_code", getattr(error, "code", None))}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write a new sanitized preflight JSON file")
    args = parser.parse_args()
    if args.output and args.output.exists():
        parser.error("Output already exists")
    result = preflight()
    body = json.dumps(result, indent=2) + "\n"
    if args.output:
        with args.output.open("x") as target:
            target.write(body)
    print(body, end="")
    raise SystemExit(0 if all(result[name]["authenticated"] for name in SECRET_NAMES) else 1)
