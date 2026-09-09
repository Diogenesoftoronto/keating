#!/usr/bin/env python3
"""Publish the frozen authored development benchmark, never model measurements."""
import hashlib
import json
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BENCHMARK = ROOT / "scripts/training/benchmarks/teaching-v1"
DEFAULT_REPORT = ROOT / "web/public/reports/learning-to-teach/report-data.json"
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


def digest_bytes(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def canonical_digest(value: object) -> str:
    return digest_bytes(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode())


def export_benchmark(benchmark_dir: Path, report_path: Path) -> dict:
    manifest = json.loads((benchmark_dir / "manifest.json").read_text())
    frozen = {}
    for filename in ("cases.json", "rubric.json", "context.json"):
        body = (benchmark_dir / filename).read_bytes()
        if digest_bytes(body) != manifest["files"][filename]:
            raise ValueError(f"Frozen benchmark hash mismatch: {filename}")
        frozen[filename] = json.loads(body)
    definition, rubric, context = (frozen[name] for name in ("cases.json", "rubric.json", "context.json"))
    if (definition["benchmark_id"] != manifest["benchmark_id"]
        or rubric["benchmark_id"] != manifest["benchmark_id"]
        or definition["version"] != manifest["version"]
        or rubric["version"] != manifest["version"]):
        raise ValueError("Benchmark IDs or versions disagree")
    if (definition["provenance"]["kind"] != "newly-authored-evaluation"
        or definition["provenance"]["private_data"] is not False
        or context["provenance"]["private_context"] is not False):
        raise ValueError("Only authored cases and public default application context may be exported")
    state = context["provenance"]["application_state"]
    if (state["persona"] != "DEFAULT_TEACHER_PERSONA" or state["speechEnabled"]
        or any(state[key] for key in ("learnerContext", "sessionStartContext", "runtime", "course", "activeTeachingRevision"))):
        raise ValueError("Benchmark context contains non-default learner or runtime state")
    prompt = context["system_prompt"]
    digest = digest_bytes(prompt.encode())
    if digest != context["system_prompt_sha256"] or canonical_digest(context["tools"]) != context["tool_schema_sha256"]:
        raise ValueError("Prompt or canonical tool schema hash mismatch")
    cases = definition["cases"]
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Benchmark case IDs must be unique")
    if not set(definition["core_case_ids"]).issubset({case["id"] for case in cases}):
        raise ValueError("The core subset references an unavailable case")
    labels = {"teaching": "Teaching choices", "openui": "OpenUI activities", "grading": "Submitted work", "tools": "Durable tools", "identity": "Identity and purpose", "long-context": "Long conversations"}
    categories = [{"id": category, "label": labels.get(category, category), "count": sum(case["category"] == category for case in cases)}
                  for category in dict.fromkeys(case["category"] for case in cases)]
    data = json.loads(report_path.read_text())
    if data.get("benchmark", {}).get("results") is not None:
        raise ValueError("This definition exporter must not erase existing benchmark measurements")
    data["benchmark"] = {
        "id": definition["benchmark_id"], "version": definition["version"],
        "title": definition["title"], "description": definition["description"],
        "status": "not_measured", "results": None,
        "case_count": len(cases), "core_count": len(definition["core_case_ids"]),
        "dimension_count": len(rubric["dimensions"]),
        "core_case_ids": definition["core_case_ids"], "categories": categories,
        "cases": cases, "case_definition": definition, "rubric": rubric, "context": context,
        "manifest": manifest,
        "system_prompt_sha256": digest, "tool_schema_sha256": context["tool_schema_sha256"],
    }
    prompts = data.setdefault("system_prompts", {})
    if digest in prompts:
        if prompts[digest]["text"] != prompt:
            raise ValueError("Existing historical prompt entry disagrees with its digest")
        # Historical labels describe the earlier reports. Preserve them verbatim.
    else:
        prompts[digest] = {
            "sha256": digest, "text": prompt, "bytes": len(prompt.encode()),
            "tool_count": len(context["tools"]), "label": "Frozen development benchmark system prompt",
            "scope": "Default application context. Tool schemas are supplied separately; no private learner context is included.",
        }
    report_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return {"benchmark_id": definition["benchmark_id"], "cases": len(cases), "status": "not_measured", "private_context": False, "system_prompt_sha256": digest}


@app.command()
def main(benchmark_dir: Path = DEFAULT_BENCHMARK, report_path: Path = DEFAULT_REPORT):
    typer.echo(json.dumps(export_benchmark(benchmark_dir, report_path)))


if __name__ == "__main__":
    app()
