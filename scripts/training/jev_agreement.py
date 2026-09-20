#!/usr/bin/env python3
"""Compare judges on immutable captured generation; agreement is not correctness.

See jev_agreement.md for corpus preparation, dry runs, response-tape replay and
explicit hosted execution. This module never runs or resamples a tutor.
"""
import argparse
from collections import Counter, defaultdict
import copy
import math
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import benchmark as bench
import benchmark_judge as incumbent
import benchmark_judge_systemone as jev

VERSION = "jev-agreement-v1"
SUITES = tuple(f"teaching-v{i}" for i in range(1, 5))
NOTICE = "Agreement with an AI incumbent is not correctness, human ratings, or evidence of human learning."


def fingerprint(value):
    return bench.digest(bench.canonical(value))


def normalize_packet(packet):
    """Retain new messages once, bind each to its original step, preserve full state separately."""
    original, result = packet["case"], packet["result"]
    transcript, origins = [], []
    for step in result["steps"]:
        for index, message in enumerate(step.get("messages", [])):
            if index < step.get("message_start_index", len(step.get("messages", []))):
                continue
            role = {"toolResult": "tool"}.get(message.get("role"), message.get("role"))
            if role not in ("assistant", "tool", "user"):
                continue
            content = message.get("content", "")
            # Text blocks are concatenated without inventing evidence from reasoning blocks.
            if isinstance(content, list):
                content = "\n".join(block["text"] for block in content
                                    if isinstance(block, dict) and block.get("type") == "text")
            transcript.append({"role": role, "content": content})
            origins.append({"step_index": step["index"], "message_index": index,
                            "completed": step["status"] == "completed"})
    case = {"id": original["id"], "rubric": {rule["dimension"]: rule["criteria"]
            for rule in original["rubric"]}, "reference": original.get("reference"),
            "scenario": original["steps"], "reference_material": {
                "evidence_steps": {rule["dimension"]: rule["evidence_steps"] for rule in original["rubric"]},
                "transcript_origins": origins,
                "step_observations": [{key: step[key] for key in ("index", "kind", "status", "state", "files", "action_result") if key in step}
                                      for step in result["steps"]]},
            "evaluation_boundary": "Compare rubric judgments only. Cite a new assistant/tool message from the dimension's completed evidence_steps. Scripted learners do not measure human learning."}
    return case, transcript, origins


def prepare(config):
    """Explicit source selection keeps unrelated private artifacts out of hosted requests."""
    rows = []
    for source in config["sources"]:
        suite = source["suite"]
        bench.require(suite in SUITES, "Unknown suite")
        path = Path(source["path"])
        files = sorted(path.glob("*.review-packet.json")) if path.is_dir() else [path]
        bench.require(bool(files), "No captured generation files found")
        cases_path = Path(source.get("cases", Path(__file__).parent / "benchmarks" / suite / "cases.json"))
        cases = {case["id"]: case for case in bench.read_json(cases_path)["cases"]}
        for file in files:
            data = bench.read_json(file)
            if "result" in data and "case" in data:
                case, transcript, origins = normalize_packet(data)
                entries = [(case, transcript, origins, data, data["result"].get("measurement", "unknown"))]
            else:
                entries = []
                for item in data.get("rows", data.get("results", [])):
                    case = cases[item["case_id"]]
                    transcript = item.get("transcript")
                    if transcript is None:
                        response = item.get("response")
                        bench.require(isinstance(response, dict), "Missing captured candidate response")
                        transcript = [{"role": "assistant", **response}]
                    entries.append((case, transcript, None, item, "model_episode"))
            for case, transcript, origins, full_state, measurement in entries:
                incumbent.material(case, transcript)
                row = {"suite": suite, "case": case, "transcript": transcript,
                       "origins": origins, "full_state": full_state, "measurement": measurement,
                       "source": {"path": str(file), "sha256": bench.digest(file.read_bytes())},
                       "candidate_model": data.get("model", data.get("arm", {}).get("model"))}
                row["id"] = suite + ":" + case["id"] + ":" + fingerprint(row)[:16]
                rows.append(row)
    bench.require(rows and len({row["id"] for row in rows}) == len(rows), "Empty or duplicate corpus")
    return {"version": VERSION, "notice": NOTICE, "rows": rows, "corpus_sha256": fingerprint(rows)}


def enforce_steps(row, receipt):
    """Apply the same step-evidence boundary to both judges; invalid evidence is missing, not zero."""
    if not row.get("origins"):
        return receipt
    receipt = copy.deepcopy(receipt)
    rules = row["case"]["reference_material"]["evidence_steps"]
    for rating in receipt["ratings"]:
        if rating["score"] is None:
            continue
        evidence = rating["evidence"]
        index = evidence.get("transcript_index")
        origin = row["origins"][index] if type(index) is int and 0 <= index < len(row["origins"]) else None
        # Missing-behavior assertions from the flat protocol have no step attribution;
        # do not invent one. They remain unavailable in v3/v4 comparisons.
        requires_multiple = row["suite"] == "teaching-v4" and len(rules[rating["dimension"]]) > 1
        if requires_multiple or not origin or not origin["completed"] or origin["step_index"] not in rules[rating["dimension"]]:
            rating.update(score=None, uncertainty="Evidence lacks a valid completed rubric step",
                          support="unverifiable", evidence={"kind": "abstain", "quote": None,
                          "transcript_index": None, "observation": "Evidence-step boundary rejected the rating"})
            receipt.setdefault("agreement_abstentions", {})[rating["dimension"]] = (
                "v4-requires-evidence-from-every-scoped-step" if requires_multiple else "invalid-step-evidence")
    return receipt


def agreement(pairs):
    """Nominal Cohen kappa excludes abstentions; report missingness beside that denominator."""
    scored = [(a, b) for a, b in pairs if a is not None and b is not None]
    n = len(scored)
    a_counts, b_counts = Counter(a for a, _ in scored), Counter(b for _, b in scored)
    observed = sum(a == b for a, b in scored) / n if n else None
    expected = sum(a_counts[k] * b_counts[k] for k in (0, 1, 2)) / n ** 2 if n else None
    return {"pairs": len(pairs), "both_scored": n,
            "incumbent_abstentions": sum(a is None for a, _ in pairs),
            "jev_abstentions": sum(b is None for _, b in pairs),
            "both_abstain": sum(a is None and b is None for a, b in pairs),
            "exact_agreement": observed,
            "cohen_kappa": (observed - expected) / (1 - expected) if n and expected < 1 else None,
            "kappa_unavailable_reason": "no paired scores" if not n else "constant identical ratings" if expected == 1 else None,
            "confusion": {str(a): {str(b): sum(x == a and y == b for x, y in scored)
                                   for b in (0, 1, 2)} for a in (0, 1, 2)}}


def costs(receipts, rates, mode):
    receipts = [receipt for receipt in receipts if receipt.get("provider_calls", 1) > 0]
    tokens = {key: 0 for key in ("input_tokens", "output_tokens")}
    usage_complete = True
    for receipt in receipts:
        if receipt.get("usage_complete") is False:
            usage_complete = False
        usage = receipt.get("usage") or receipt.get("partial_usage") or {}
        for key in tokens:
            value = usage.get(key)
            if type(value) is not int or value < 0:
                usage_complete = False
            else:
                tokens[key] += value
    latencies = [r["wall_seconds"] for r in receipts if type(r.get("wall_seconds")) in (int, float)]
    estimate = (sum(tokens[key] * rates[key] / 1e6 for key in tokens)
                if rates and usage_complete and receipts else None)
    return {"calls": sum(receipt.get("provider_calls", 1) for receipt in receipts),
            "reviews": len(receipts), "tokens": tokens, "usage_complete": usage_complete,
            "estimated_usd": estimate, "pricing": rates,
            "cost_basis": "explicit token-rate estimate; not an invoice" if estimate is not None else "unavailable",
            "hosted_mean_seconds": sum(latencies) / len(latencies) if mode == "live" and latencies else None,
            "replay_seconds": sum(latencies) if mode == "replay" else None}


def report(corpus, reviews, *, rates=None, mode="replay"):
    dimensions, suites, disagreements = defaultdict(list), defaultdict(list), []
    for row, pair in zip(corpus["rows"], reviews, strict=True):
        left = {x["dimension"]: x for x in pair["incumbent"]["ratings"]}
        right = {x["dimension"]: x for x in pair["jev"]["ratings"]}
        differences = []
        for dimension in row["case"]["rubric"]:
            values = (left[dimension]["score"], right[dimension]["score"])
            dimensions[row["suite"] + "/" + dimension].append(values)
            suites[row["suite"]].append(values)
            if values[0] != values[1]:
                differences.append(dimension)
        if differences:
            disagreements.append({"row": row, "dimensions": differences, "reviews": pair})
    expense = {name: costs([pair[name] for pair in reviews], (rates or {}).get(name), mode)
               for name in ("incumbent", "jev")}
    delta = {field: expense["jev"][field] - expense["incumbent"][field]
             if expense["jev"][field] is not None and expense["incumbent"][field] is not None else None
             for field in ("estimated_usd", "hosted_mean_seconds")}
    missing = [suite for suite in SUITES if suite not in suites]
    errors = sum(pair[name]["status"] != "reviewed" for pair in reviews for name in ("incumbent", "jev"))
    return {"version": VERSION, "notice": NOTICE, "mode": mode, "corpus_sha256": corpus["corpus_sha256"],
            "corpus_selection": {key: copy.deepcopy(corpus[key])
                                 for key in ("parent_corpus_sha256", "selection", "excluded") if key in corpus},
            "generation_calls": 0, "missing_suites": missing, "judge_errors": errors,
            "gate": {"status": "measurement-only", "passed": False,
                     "reason": "No predeclared agreement acceptance threshold or human correctness standard is supplied."},
            "adaptation_limits": ["v3 missing-behavior ratings lack step attribution and abstain.",
                                  "v4 uses its native multi-step and persisted-state evidence validator; missing required evidence abstains.",
                                  "Offline integration tapes remain labeled synthetic plumbing; they do not establish model teaching quality."],
            "coverage": {suite: {"rows": sum(row["suite"] == suite for row in corpus["rows"]),
                                  "measurements": dict(Counter(row["measurement"] for row in corpus["rows"] if row["suite"] == suite))}
                         for suite in SUITES},
            "per_dimension": {key: agreement(value) for key, value in sorted(dimensions.items())},
            "per_suite": {key: agreement(value) for key, value in sorted(suites.items())},
            "cost_latency": expense, "jev_minus_incumbent": delta,
            "disagreements": disagreements, "reviews": reviews}


def run(corpus, dispatches, *, models=None, rates=None, mode="replay", checkpoint=None):
    bench.require(corpus["corpus_sha256"] == fingerprint(corpus["rows"]), "Corpus digest mismatch")
    models = models or {"incumbent": incumbent.JUDGE_MODEL, "jev": jev.SYSTEM_ONE_MODEL}
    # Every transport, including response tapes and injected/direct clients,
    # must prove the same declared comparator identity.
    dispatches = {**dispatches, "incumbent": exact_model_dispatch(dispatches["incumbent"], models["incumbent"])}
    reviews = []
    for row in corpus["rows"]:
        pair = {}
        for name, judge in (("incumbent", incumbent), ("jev", jev)):
            if row["suite"] == "teaching-v4":
                import jev_agreement_v4
                pair[name] = jev_agreement_v4.judge(row, name, models[name], dispatches[name])
            else:
                receipt = judge.judge_case(row["case"], row["transcript"], dispatches[name],
                                          judge_model=models[name], candidate_model=row.get("candidate_model"))
                pair[name] = enforce_steps(row, receipt)
        reviews.append(pair)
        if checkpoint:
            checkpoint(row, pair)
    return report(corpus, reviews, rates=rates, mode=mode)


def validate_endpoint(endpoint, *, allow_direct=False):
    parsed = urlsplit(endpoint)
    bench.require(parsed.scheme == "https" and parsed.hostname and not parsed.username
                  and not parsed.password and not parsed.query and not parsed.fragment,
                  "Judgement endpoint must be HTTPS without credentials, query or fragment")
    bench.require(parsed.hostname != "api.typesafe.ai" or allow_direct,
                  "Direct SystemOne requires --allow-direct-systemone; prefer Not Organic")
    return endpoint


def command_dispatch(argv):
    """Account-owned bridge: one JSON request on stdin and one JSON response on stdout."""
    bench.require(isinstance(argv, list) and argv and all(isinstance(arg, str) and arg for arg in argv),
                  "Dispatch command must be a nonempty JSON argv array; use no secrets in argv")
    def dispatch(payload):
        result = subprocess.run(argv, input=bench.canonical(payload), text=True,
                                capture_output=True, timeout=180, check=False)
        bench.require(result.returncode == 0, "Authenticated judgement bridge failed")
        # Never surface stderr or malformed stdout: either may contain user state or credentials.
        import json
        try:
            return json.loads(result.stdout)
        except ValueError:
            raise ValueError("Authenticated judgement bridge returned invalid JSON") from None
    return dispatch


def exact_model_dispatch(dispatch, expected):
    """A gateway alias may transport a request, but cannot silently replace its judge."""
    def checked(payload):
        bench.require(payload.get("model") == expected, "Incumbent request model differs from declared comparator")
        raw = dispatch(payload)
        bench.require(isinstance(raw, dict) and raw.get("model") == expected,
                      "Incumbent bridge returned a missing or different model identity")
        return raw
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "plan", "replay", "live"))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--incumbent-tape", type=Path)
    parser.add_argument("--jev-tape", type=Path)
    parser.add_argument("--incumbent-key-file", type=Path)
    parser.add_argument("--incumbent-dispatch-command", type=Path,
                        help="JSON argv file for an authenticated Responses API bridge; mutually exclusive with --incumbent-key-file")
    parser.add_argument("--jev-key-file", type=Path)
    parser.add_argument("--jev-endpoint")
    parser.add_argument("--jev-dispatch-command", type=Path,
                        help="JSON argv file for an authenticated stdin/stdout bridge; credentials stay in its session store")
    parser.add_argument("--allow-direct-systemone", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--rates", type=Path)
    parser.add_argument("--jev-model", default=jev.SYSTEM_ONE_MODEL)
    parser.add_argument("--incumbent-model", default=incumbent.JUDGE_MODEL)
    args = parser.parse_args()
    bench.require(not args.out.exists(), "Output already exists")
    source = bench.read_json(args.source)
    if args.command == "prepare":
        bench.write_json(args.out, prepare(source))
        return
    bench.require(source["corpus_sha256"] == fingerprint(source["rows"]), "Corpus digest mismatch")
    models = {"incumbent": args.incumbent_model, "jev": args.jev_model}
    if args.command == "plan":
        requests, errors = [], []
        for row in source["rows"]:
            try:
                if row["suite"] == "teaching-v4":
                    import jev_agreement_v4
                    plan, _, questions, _, _ = jev_agreement_v4.typed_plan(row, models["jev"])
                    requests.append({"row_id": row["id"], "incumbent": jev_agreement_v4.build_incumbent_request(row, models["incumbent"]),
                                     "jev": [jev.request_body(batch, plan) for batch in jev.batch_questions(questions)],
                                     "eligible_for_execution": row["full_state"]["result"].get("measurement") == "model_episode" and
                                     row["full_state"]["result"].get("status") == "completed"})
                else:
                    requests.append({"row_id": row["id"], "incumbent": incumbent.build_request(row["case"], row["transcript"], models["incumbent"]),
                                     "jev": jev.build_requests(row["case"], row["transcript"], models["jev"])})
            except ValueError:
                errors.append({"row_id": row["id"], "error": "request-state-invalid-or-over-budget"})
        bench.write_json(args.out, {"version": VERSION, "corpus_sha256": source["corpus_sha256"],
                                   "provider_calls": 0, "requests": requests, "errors": errors,
                                   "note": "Evidence narrowing may require additional Jev requests."})
        return
    rates = bench.read_json(args.rates) if args.rates else None
    if rates:
        for rate in rates.values():
            bench.require(set(rate) == {"input_tokens", "output_tokens"}
                          and all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in rate.values()),
                          "Rates must be nonnegative USD per million input/output tokens")
    if args.command == "replay":
        bench.require(args.incumbent_tape and args.jev_tape, "Both response tapes required")
        dispatches = {"incumbent": jev.fixture_dispatch(bench.read_json(args.incumbent_tape)),
                      "jev": jev.fixture_dispatch(bench.read_json(args.jev_tape))}
    else:
        bench.require(args.execute, "Hosted execution requires --execute")
        bench.require(bool(args.incumbent_key_file) != bool(args.incumbent_dispatch_command),
                      "Choose exactly one incumbent authenticated bridge or private key file")
        if args.incumbent_dispatch_command:
            incumbent_dispatch = command_dispatch(bench.read_json(args.incumbent_dispatch_command))
        else:
            incumbent_dispatch = incumbent.transport(args.incumbent_key_file)
        if args.jev_dispatch_command:
            bench.require(not args.jev_key_file and not args.jev_endpoint,
                          "Choose an authenticated bridge or an explicit key/endpoint transport")
            jev_dispatch = command_dispatch(bench.read_json(args.jev_dispatch_command))
        else:
            bench.require(args.jev_key_file and args.jev_endpoint, "Explicit Jev gateway endpoint and key file required")
            endpoint = validate_endpoint(args.jev_endpoint, allow_direct=args.allow_direct_systemone)
            jev_dispatch = jev.transport(args.jev_key_file, endpoint=endpoint)
        dispatches = {"incumbent": incumbent_dispatch, "jev": jev_dispatch}
    checkpoint_dir = args.out.with_suffix(".receipts")
    checkpoint_dir.mkdir(parents=True, exist_ok=False)
    def save(row, pair):
        bench.write_json(checkpoint_dir / (fingerprint(row) + ".json"), {"row": row, "reviews": pair})
    result = run(source, dispatches, models=models, rates=rates, mode=args.command, checkpoint=save)
    bench.write_json(args.out, result)
    print(bench.canonical({"rows": len(source["rows"]), "judge_errors": result["judge_errors"],
                           "disagreements": len(result["disagreements"]), "report": str(args.out)}))


if __name__ == "__main__":
    main()
