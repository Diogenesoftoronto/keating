"""Pinned TutorMoments import and leakage-free next-tutor-turn benchmark plans.

No provider calls. This diagnostic is not the upstream multi-turn oracle replay.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DATASET = "allenai/tutormoments-preview"
REVISION = "66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc"
SHA256 = "c447459f80cf6b138512171a015879aaeab09cef7857e9c03655ad64a75c230f"
URL = f"https://huggingface.co/datasets/{DATASET}/resolve/{REVISION}/moments.jsonl"
DEFAULT = ROOT / ".keating/datasets/tutormoments/moments.jsonl"


def validate_records(records):
    """Reject duplicate IDs, inconsistent labels and context beyond the cut."""
    seen = set()
    for record in records:
        key = record["id"]
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError("Invalid or duplicate moment ID")
        seen.add(key)
        if record["dimension"] not in ("scaffolding", "rigor") or record["rubric"]["gold"] != record["dimension"]:
            raise ValueError("Inconsistent gold dimension")
        cut = record["provenance"]["cut_turn"]
        previous = 0
        if not record["context"]:
            raise ValueError("Empty context")
        for turn in record["context"]:
            number = turn["turn_number"]
            if type(number) is not int or not 1 <= number <= cut or number < previous:
                raise ValueError("Out-of-order or post-cut context")
            if turn["role"] not in ("tutor", "student") or not isinstance(turn["text"], str):
                raise ValueError("Invalid context turn")
            previous = number
    return records


def load_moments(path=DEFAULT):
    body = Path(path).read_bytes()
    if hashlib.sha256(body).hexdigest() != SHA256:
        raise ValueError("TutorMoments file hash mismatch; do not silently update the frozen set")
    records = validate_records([json.loads(line) for line in body.splitlines() if line.strip()])
    if Counter(r["dimension"] for r in records) != {"scaffolding": 260, "rigor": 260}:
        raise ValueError("Expected the balanced 520-moment release")
    return records


def fetch(path=DEFAULT):
    path = Path(path)
    if path.exists():
        return load_moments(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=120) as response:
        body = response.read()
    if hashlib.sha256(body).hexdigest() != SHA256:
        raise ValueError("Downloaded file hash mismatch")
    # Exclusive creation avoids replacing a concurrent download or user file.
    with path.open("xb") as output:
        output.write(body)
    return load_moments(path)


def tutor_request(record, system_prompt):
    """Only the frozen pre-cut context reaches the tutor; no rubric or oracle."""
    return {"case_id": record["id"], "payload": {"messages": [
        {"role": "system", "content": system_prompt},
        *[{"role": {"tutor": "assistant", "student": "user"}[t["role"]],
           "content": t["text"]} for t in record["context"]],
    ]}}


def make_plan(records, system_prompt):
    validate_records(records)
    return {
        "schema_version": 1,
        "benchmark_id": "keating-tutormoments-next-turn-v1",
        "evaluation_unit": "One next tutor response to frozen context; not the official multi-turn replay",
        "source": {"dataset": DATASET, "revision": REVISION, "sha256": SHA256, "license": "CC-BY-4.0"},
        "requests": [tutor_request(r, system_prompt) for r in records],
        "evaluation_only": [{"case_id": r["id"], "dimension": r["dimension"],
            "rubric": r["rubric"], "provenance": r["provenance"],
            "student": r["student"]} for r in records],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "inspect", "plan"))
    parser.add_argument("--data", type=Path, default=DEFAULT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--system-prompt", type=Path)
    args = parser.parse_args()
    rows = fetch(args.data) if args.command == "fetch" else load_moments(args.data)
    if args.command == "plan":
        if not args.output or not args.system_prompt:
            parser.error("plan requires --output and --system-prompt")
        plan = make_plan(rows, args.system_prompt.read_text())
        # Evaluator material deliberately goes to a different file from requests.
        args.output.mkdir(parents=True, exist_ok=False)
        evaluation = plan.pop("evaluation_only")
        (args.output / "requests.json").write_text(json.dumps(plan, indent=2))
        (args.output / "evaluation-only.json").write_text(json.dumps(evaluation, indent=2))
    print(json.dumps({"moments": len(rows), "dimensions": Counter(r["dimension"] for r in rows),
                      "revision": REVISION, "sha256": SHA256}))


if __name__ == "__main__":
    main()
