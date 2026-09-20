"""Publish only authored generation tasks and their bound, blinded reviews."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/training"))
from research_generation import validate_generation_data


def verified_bundle(directory):
    audit = json.loads((directory / "private/audit.json").read_text())
    claimed = audit.pop("audit_sha256")
    canonical = json.dumps(audit, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    assert hashlib.sha256(canonical).hexdigest() == claimed
    for name, expected in audit["files_sha256"].items():
        path = directory / name
        assert path.resolve().is_relative_to(directory.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, name
    return {**audit, "audit_sha256": claimed}


def curate_generation_examples(work, output):
    assert not output.exists(), "Choose a fresh public output"
    prepared = work / "review"
    reviewed = work / "review-summary"
    prepare_audit = verified_bundle(prepared)
    review_audit = verified_bundle(reviewed)
    assert review_audit["prepare_audit_sha256"] == prepare_audit["audit_sha256"]
    decoded = json.loads((prepared / "private/decoded-results.json").read_text())
    summary = json.loads((reviewed / "summary.json").read_text())
    job = json.loads((work / "prepared/generation-job.json").read_text())
    state = json.loads((work / "runpod-job/state.json").read_text())
    assert state["phase"] == "terminated"
    assert job["job_sha256"] == summary["job_sha256"] == decoded["job_sha256"]
    judged = {row["id"]: row for row in summary["rows"]}
    rows = []
    for source in decoded["rows"]:
        grade = judged[source["id"]]
        for key in ("case_id", "category", "family_id", "condition"):
            assert source[key] == grade[key]
        row = {key: deepcopy(source[key]) for key in ("id", "case_id", "category", "family_id", "condition",
            "learner_prompt", "raw_output", "generated_ids", "generated_token_count", "stop_reason",
            "identical_to_baseline", "first_divergent_position")}
        row.update(criteria=deepcopy(grade["criteria"]), all_three=deepcopy(grade["all_three"]))
        rows.append(row)
    data = {"schema_version": 1, "kind": "public_controlled_generation_review", "rows": rows,
        "totals": summary["totals"], "reviewers": summary["reviewers"], "counting": summary["counting"],
        "all_three_rule": summary["all_three_rule"], "primary": summary["primary"],
        "source": "Authored tasks; actual Qwen Base generations; two blinded model-assisted reviews.",
        "experiment": {key: job["generation_spec"][key] for key in ("layer", "selected_feature", "unrelated_feature", "epsilon", "seed", "max_new_tokens", "control_semantic_status", "selected_semantic_status")},
        "provenance": {"job_sha256": job["job_sha256"], "result_sha256": decoded["result_sha256"],
            "archive_sha256": state["outputs_sha256"], "prepare_audit_sha256": prepare_audit["audit_sha256"],
            "review_audit_sha256": review_audit["audit_sha256"], "review_files_sha256": review_audit["review_files_sha256"],
            "tokenizer_assets": prepare_audit["tokenizer_assets"], "decode_options": prepare_audit["decode_options"],
            "first_divergence_indexing": prepare_audit["first_divergence_indexing"],
            "completed_tasks": state["validated_completed_trials"], "planned_tasks": 8,
            "execution_complete": state["experiment_valid"], "source_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}}
    if "coverage" in summary:
        data["coverage"] = summary["coverage"]
    compaction_path = prepared / "private/compaction.json"
    if compaction_path.exists():
        compaction = json.loads(compaction_path.read_text())
        for name, key in [("blind-packet.json", "source_sha256"), ("unique-blind-packet.json", "unique_packet_sha256")]:
            assert hashlib.sha256((prepared / name).read_bytes()).hexdigest() == compaction[key]
        expansions = []
        for suffix in ("a", "b"):
            path = work / f"grades-{suffix}.expansion.json"
            expansion = json.loads(path.read_text())
            assert expansion["compaction_sha256"] == hashlib.sha256(compaction_path.read_bytes()).hexdigest()
            assert expansion["expanded_review_sha256"] == hashlib.sha256((work / f"grades-{suffix}.json").read_bytes()).hexdigest()
            assert expansion["source_review_sha256"] == hashlib.sha256((work / f"grades-{suffix}-unique.json").read_bytes()).hexdigest()
            expansions.append(hashlib.sha256(path.read_bytes()).hexdigest())
        data["review_compaction"] = {key: compaction[key] for key in ("method", "source_rows", "unique_rows")}
        data["provenance"]["compaction_sha256"] = hashlib.sha256(compaction_path.read_bytes()).hexdigest()
        data["provenance"]["expansion_sha256"] = expansions
    validate_generation_data(data)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"rows": len(rows), "completed_tasks": state["validated_completed_trials"], "output": str(output)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    curate_generation_examples(args.work.resolve(), args.output.resolve())
