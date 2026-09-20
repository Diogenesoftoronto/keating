# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = []
# ///
"""Offline MathDial delivered-action review packets and native_training export.

This validates evidence and explicit reviewer judgments; it does not grade text.
No provider calls, fabricated labels, token reconstruction, or runtime writes.
"""
from copy import deepcopy
from datetime import datetime
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import native_training as nt

VERSION = "mathdial-delivered-review-v1"
RUBRIC = {
    "math_correctness": "Independently work through the question. Check every delivered arithmetic claim, quantity, and explanation; do not assume the source answer or simulated learner is correct.",
    "support_quality": "Assess whether the response addresses the actual initial error with a usable question, explanation, or scaffold. Explain why the chosen support fits the available evidence.",
    "learner_agency": "Assess whether the assistance leaves meaningful learner work and respects any stated help preference. Answer presence alone is not a failure; justify appropriateness in context.",
    "evidence_discipline": "Check that claims about understanding, grading, tools, or state are supported by the delivered evidence. Simulated agreement is not a learning assessment.",
}


def require(condition, code):
    if not condition:
        raise nt.ExportError(code)


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def text(value):
    return type(value) is str and bool(value.strip())


def exact_keys(value, keys):
    require(type(value) is dict and set(value) == set(keys.split()), "review_fields")


def public_text(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "\n".join(b["text"] for b in content if isinstance(b, dict)
        and b.get("type") == "text" and isinstance(b.get("text"), str)) if isinstance(content, list) else ""


def model_identity(name):
    # Declared IDs are evidence, not authenticated identity. Prevent trivial
    # case/provider-prefix aliases from bypassing the upstream exact-ID check.
    return name.strip().casefold().rsplit("/", 1)[-1] if text(name) else None


def source_binding(scenario, source_jsonl, source_review):
    """Read the pinned source asset; exclude its future dialogue from the packet."""
    source = scenario.get("source", {})
    require(source.get("dataset") == "mathdial", "mathdial_only")
    match = re.fullmatch(r"train\.jsonl#row=(\d+)", source.get("record_id", ""))
    require(match is not None and re.fullmatch(r"[a-f0-9]{40}", source.get("revision", "")), "source_identity")
    body = Path(source_jsonl).read_bytes()
    asset_hash = hashlib.sha256(body).hexdigest()
    private = scenario["evaluation_only"]
    require(asset_hash == private["asset"]["sha256"] and private["asset"]["path"] == "train.jsonl", "source_asset_hash")
    lines = body.splitlines()
    require(int(match[1]) < len(lines), "source_row_missing")
    original = json.loads(lines[int(match[1])])
    require(canonical_hash(original) == source["sha256"] and original == private["original"], "source_record_hash")
    for name in ("question", "student_incorrect_solution", "ground_truth"):
        require(text(original.get(name)), "source_context_missing")
    expected = "Task supplied in the source:\n" + original["question"] + "\n\nConversation available before your next tutoring response:\nLearner: " + original["student_incorrect_solution"]
    require(scenario["actor"] == {"opening_message": expected}, "source_actor_projection")
    require(private["cut"] == {"field": "student_incorrect_solution", "policy": "before-original-conversation"}, "source_cut")
    require(source_review.get("decision") == "approved" and source_review.get("approved") is True
        and source_review.get("reviewer_source_kind") == "model_review"
        and source_review.get("source_sha256") == source["sha256"]
        and source_review.get("content_sha256") == canonical_hash(scenario), "source_review_binding")
    require(private["admission"].get("purpose") == "development"
        and private["admission"].get("protected") is False, "development_admission_required")
    return {"source_asset_sha256": asset_hash, "source_record_sha256": source["sha256"],
            "source_revision": source["revision"], "source_record_id": source["record_id"],
            "source_review_hash": nt.native_hash(source_review)}, {
                "question": original["question"], "initial_incorrect_solution": original["student_incorrect_solution"],
                "reference_solution": original["ground_truth"],
                "reference_status": "Source reference for independent checking, not an observed native outcome"}


def prepare_review(episode, scenario, source_jsonl, source_review, captures=None, *, step_index=0, _allow_fixture=False):
    """Prepare a pending, delivered-only packet. Captures may be unavailable."""
    checked = nt.validate_episode(episode)
    fixture = episode["measurement"] == "offline_integration"
    require(not fixture or _allow_fixture, "authored_episode_test_only")
    source_pins, task = source_binding(scenario, source_jsonl, source_review)
    require(episode["source"] == scenario["source"] and episode["family"] == scenario["family"]
        and episode["ledger"][0]["payload"]["scenario_hash"] == nt.native_hash(scenario), "episode_scenario_binding")
    initial = episode["ledger"][1]
    require(initial["payload"]["text"] == scenario["actor"]["opening_message"], "episode_opening_binding")
    envelope = deepcopy(captures) if captures is not None else {"schema_version": 1, "captures": []}
    require(not envelope.get("teacher_captures"), "teacher_captures_outside_review_scope")
    # Reuse upstream validation of original token/message/request bindings.
    nt.build_exports([episode], envelope)
    require(type(step_index) is int and 0 <= step_index < len(checked.steps), "chat_step_unavailable")
    step = checked.steps[step_index]
    require(step["payload"]["kind"] == "message", "chat_step_required")
    feature = next((f for f in nt.feature_inputs(checked) if f["event_id"] == step["event_id"]
                    and f["boundary"] == "delivered"), None)
    require(feature is not None, "delivered_action_unavailable")
    delivery = checked.deliveries[step["event_id"]]
    observation = delivery["payload"]
    actors = [e for e in episode["ledger"][step["sequence"] + 1:delivery["sequence"]] if e["kind"] == "actor_message"]
    units = []
    for actor in actors:
        message = actor["payload"]["message"]
        require(text(message.get("model")) and text(message.get("provider")), "actor_identity_unavailable")
        matches = [c for c in envelope["captures"] if c["actor_event_id"] == actor["event_id"]]
        require(len(matches) <= 1, "duplicate_actor_capture")
        capture = matches[0] if matches else None
        units.append({"target_id": actor["event_id"], "actor_event_hash": actor["hash"],
            "actor_payload_hash": actor["payload_hash"],
            "actor": deepcopy(capture["actor"]) if capture else {"provider": message["provider"], "id": message["model"], "revision": None},
            "actor_text": public_text(message),
            "tool_calls": [deepcopy(b) for b in message.get("content", []) if isinstance(b, dict) and b.get("type") == "toolCall"],
            "capture_hash": capture["capture_hash"] if capture else None,
            "sft_capture_status": "validated_original_capture" if capture else "unavailable"})
    require(units, "no_actor_output")
    require(text(episode.get("learner_policy", {}).get("model")), "learner_identity_unavailable")
    context_evidence = []
    for item in feature["input_events"]:
        event = checked.events[item["event_id"]]
        payload = item["payload"]
        visible = (payload.get("visibleText", "") if item["kind"] == "delivered_observation" else
            payload.get("intent", {}).get("text", "") if item["kind"] == "learner_intent" else payload.get("text", ""))
        context_evidence.append({"event_id": event["event_id"], "event_hash": event["hash"], "text": visible})
    packet = {"schema_version": 1, "kind": "pending_independent_episode_review", "version": VERSION, "step_index": step_index,
        "evidence_kind": "authored_fixture" if fixture else "model_episode",
        "visibility": "evaluator_only", "rubric": deepcopy(RUBRIC), "rubric_hash": nt.native_hash(RUBRIC),
        "bindings": {"episode_hash": nt.native_hash(episode), "ledger_head": episode["ledger"][-1]["hash"],
            "runtime_hash": nt.native_hash(episode["runtime"]), "scenario_hash": nt.native_hash(scenario),
            "scenario_content_sha256": canonical_hash(scenario), "captures_hash": nt.native_hash(envelope), **source_pins},
        "step_ref": checked.ref(step), "feature": feature, "context_evidence": context_evidence,
        "initial_event": {"event_id": initial["event_id"], "event_hash": initial["hash"], "text": initial["payload"]["text"]},
        "delivery_event": {"event_id": delivery["event_id"], "event_hash": delivery["hash"], "observation": deepcopy(observation)},
        "private_math_reference": task, "targets": units,
        "learner_model": episode["learner_policy"]["model"],
        "artifact_review_required": bool(observation["documents"] or observation["availableActions"]),
        "learning_outcome": None,
        "limits": ["Selected delivered tutor action only; later learner turns and source future dialogue are excluded. Earlier simulated learner turns are context, not learning outcomes.",
                   "Review each actor segment and the delivered observation. Source references can be wrong; independently check the mathematics.",
                   "New artifacts need separate review. Identity comparisons and hashes do not authenticate the capture or reviewer."]}
    return nt.seal(packet, "packet_hash")


def review_form(packet):
    """Unknown/pending placeholders are not accepted reviews or training labels."""
    return {"schema_version": 1, "packet_hash": packet["packet_hash"],
        "reviewer": {"kind": "independent_model", "id": None,
            "model": {"provider": None, "id": None, "revision": None}},
        "reviewed_at": None, "independence_statement": None,
        "judgments": [{"target_id": t["target_id"], "decision": "pending",
            "checks": {k: {"verdict": "unknown", "reasoning": "", "citations": []} for k in RUBRIC}}
            for t in packet["targets"]]}


def validate_reviewer(form, packet):
    exact_keys(form, "schema_version packet_hash reviewer reviewed_at independence_statement judgments")
    require(form["schema_version"] == 1 and form["packet_hash"] == packet["packet_hash"], "judgment_packet_binding")
    require(text(form["independence_statement"]), "independence_statement_required")
    reviewer = form["reviewer"]
    if packet["evidence_kind"] == "authored_fixture":
        exact_keys(reviewer, "kind id")
        require(reviewer["kind"] == "authored_fixture" and text(reviewer["id"]), "fixture_reviewer_required")
    else:
        exact_keys(reviewer, "kind id model")
        require(reviewer["kind"] == "independent_model" and text(reviewer["id"]), "independent_model_reviewer_required")
        exact_keys(reviewer["model"], "provider id revision")
        require(all(text(v) for v in reviewer["model"].values()), "reviewer_model_provenance")
        identity = model_identity(reviewer["model"]["id"])
        require(identity != model_identity(packet["learner_model"]) and
            all(identity != model_identity(t["actor"]["id"]) for t in packet["targets"]), "self_review")
    require(text(form["reviewed_at"]), "review_time_required")
    stamp = datetime.fromisoformat(form["reviewed_at"].replace("Z", "+00:00"))
    require(stamp.tzinfo is not None, "review_time_timezone")


def validate_judgment(judgment, target, packet):
    exact_keys(judgment, "target_id decision checks")
    require(judgment["target_id"] == target["target_id"], "judgment_target_binding")
    require(judgment["decision"] in {"accept", "reject", "abstain"}, "explicit_review_decision_required")
    require(type(judgment["checks"]) is dict and set(judgment["checks"]) == set(RUBRIC), "rubric_checks_required")
    initial, delivery = packet["initial_event"], packet["delivery_event"]
    texts = {e["event_id"]: (e["event_hash"], e["text"]) for e in packet["context_evidence"]}
    texts.update({initial["event_id"]: (initial["event_hash"], initial["text"]),
        target["target_id"]: (target["actor_event_hash"], target["actor_text"]),
        delivery["event_id"]: (delivery["event_hash"], delivery["observation"]["visibleText"])})
    verdicts = []
    for check in judgment["checks"].values():
        exact_keys(check, "verdict reasoning citations")
        verdict = check["verdict"]
        require(verdict in {"pass", "fail", "unknown"} and text(check["reasoning"]), "reasoned_verdict_required")
        require(type(check["citations"]) is list, "citations_required")
        action_cited = False
        for citation in check["citations"]:
            exact_keys(citation, "event_id event_hash quote")
            evidence = texts.get(citation["event_id"])
            require(evidence is not None and citation["event_hash"] == evidence[0]
                and text(citation["quote"]) and citation["quote"] in evidence[1], "citation_not_in_reviewed_evidence")
            action_cited |= citation["event_id"] in {target["target_id"], delivery["event_id"]}
        require(verdict == "unknown" or action_cited, "action_evidence_required")
        verdicts.append(verdict)
    expected = "reject" if "fail" in verdicts else "abstain" if "unknown" in verdicts else "accept"
    require(judgment["decision"] == expected, "decision_verdict_conflict")
    require(judgment["decision"] != "accept" or not packet["artifact_review_required"], "separate_artifact_review_required")


def compile_review(packet, form, episode, scenario, source_jsonl, source_review, captures=None, *, _allow_fixture=False):
    """Check explicit judgments, then reuse native_training's exact review gate."""
    current = prepare_review(episode, scenario, source_jsonl, source_review, captures,
        step_index=packet.get("step_index"), _allow_fixture=_allow_fixture)
    require(packet == current, "stale_or_changed_review_packet")
    validate_reviewer(form, packet)
    require(type(form["judgments"]) is list and
        [j.get("target_id") for j in form["judgments"]] == [t["target_id"] for t in packet["targets"]], "missing_duplicate_or_reordered_judgments")
    reviews, statuses = [], []
    for target, judgment in zip(packet["targets"], form["judgments"]):
        validate_judgment(judgment, target, packet)
        emitted = bool(target["capture_hash"]) and judgment["decision"] != "abstain"
        statuses.append({"target_id": target["target_id"], "decision": judgment["decision"],
            "training_review": "emitted" if emitted else "unavailable",
            "reason": None if emitted else "missing_original_capture" if not target["capture_hash"] else "reviewer_abstained"})
        if not emitted:
            continue
        feedback = {"reviewer_source_kind": "authored_fixture" if packet["evidence_kind"] == "authored_fixture" else "model_review",
            "packet_hash": packet["packet_hash"], "source_bindings": packet["bindings"],
            "independence_statement": form["independence_statement"], "checks": deepcopy(judgment["checks"]),
            "learning_outcome": None, "scope": "selected delivered chat action; no simulated learner success inference"}
        feature = packet["feature"]
        reviews.append(nt.seal({"schema_version": 1,
            "review_id": "native-review-" + nt.native_hash({"packet": packet["packet_hash"], "form": form, "target": target["target_id"]})[:24],
            "kind": "segment", "capture_hash": target["capture_hash"], **packet["step_ref"],
            "independent": True, "rubric_revision": VERSION + ":" + packet["rubric_hash"],
            "reviewer": deepcopy(form["reviewer"]), "reviewed_at": form["reviewed_at"],
            "boundary": "delivered", "evidence_hash": feature["feature_hash"],
            "latest_allowed_event_id": feature["latest_allowed_event_id"],
            "accepted": judgment["decision"] == "accept", "feedback": feedback}, "review_hash"))
    envelope = {"schema_version": 1, "reviews": reviews}
    exports = nt.build_exports([episode], captures, envelope)
    return nt.seal({"schema_version": 1, "reviewer_source_kind": "authored_fixture" if packet["evidence_kind"] == "authored_fixture" else "model_review",
        "packet_hash": packet["packet_hash"], "reviewer": deepcopy(form["reviewer"]),
        "reviewed_at": form["reviewed_at"], "independence_statement": form["independence_statement"],
        "judgments": deepcopy(form["judgments"]), "statuses": statuses,
        "training_reviews": envelope, "sft_eligible_records": sum(r["training_eligible"] for r in exports["sft"]),
        "learning_outcome": None, "limitations": packet["limits"]}, "audit_hash")


def write_new(path, value):
    body = json.dumps(value, ensure_ascii=True, allow_nan=False, indent=2) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(body)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "finalize"))
    parser.add_argument("--step-index", type=int, default=0, help="Zero-based chat step to prepare; finalize uses the packet's bound step")
    for name in ("episode", "scenario", "source-jsonl", "source-review", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("captures", "packet", "judgments", "form-output", "reviews-output"):
        parser.add_argument("--" + name, type=Path)
    args = parser.parse_args(argv)
    if args.command == "finalize" and (args.packet is None or args.judgments is None):
        parser.error("finalize requires --packet and --judgments")
    try:
        inputs = (nt.load_json(args.episode), nt.load_json(args.scenario), args.source_jsonl,
                  nt.load_json(args.source_review), nt.load_json(args.captures) if args.captures else None)
        if args.command == "prepare":
            require(args.packet is None and args.judgments is None and args.reviews_output is None, "prepare_arguments")
            result = prepare_review(*inputs, step_index=args.step_index)
            extra = (args.form_output, review_form(result)) if args.form_output else None
        else:
            require(args.form_output is None, "finalize_arguments")
            result = compile_review(nt.load_json(args.packet), nt.load_json(args.judgments), *inputs)
            extra = (args.reviews_output, result["training_reviews"]) if args.reviews_output else None
        paths = [args.output] + ([extra[0]] if extra else [])
        require(len({p.resolve() for p in paths}) == len(paths) and all(not p.exists() and not p.is_symlink() for p in paths), "output_already_exists_or_duplicate")
        for path in paths:
            require(path.parent.is_dir(), "output_parent_missing")
        write_new(args.output, result)
        if extra:
            write_new(*extra)
        print(json.dumps({"status": "pending_review" if args.command == "prepare" else "review_recorded",
                          "hash": result.get("packet_hash") if args.command == "prepare" else result["audit_hash"]}))
        return 0
    except (nt.ExportError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "rejected", "reason": str(exc) if isinstance(exc, nt.ExportError) else type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
