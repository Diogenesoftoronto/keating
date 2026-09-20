# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["tinker==0.27.1", "tinker-cookbook==0.5.7", "transformers==5.3.0", "torch==2.10.0", "typer>=0.12"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Prove native hindsight prefixes and prepare signals for the existing updater.

Local rendering only: no service, scoring, credentials, budget or optimizer path.
native_tinker_update owns frozen-teacher scoring and funded SDPO execution.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

import native_training as nt
import native_tinker_update as nu
import native_tinker_sampler as ns

VERSION = "native-hindsight/v3"
ROOT = Path(__file__).resolve().parents[2]
CONTEXT_TOKENS = 32768
FEEDBACK_INTRO = (
    "A versioned projection of retrospective evidence follows as JSON data. "
    "It contains the actual next learner intent and independently reviewed verdicts. "
    "The delivered tutor transcript, artifacts and unrestricted review prose are withheld. "
    "Citation offsets and hashes identify private evidence; they are not quotations. "
    "Reassess the original action using this evidence, without copying the learner or inventing learning. "
    "A delivery receipt establishes delivery only. Unknown assessment stays unknown. "
    "The original actor completion will now be replayed unchanged.\n"
)
PROJECTION_VERSION = "native-hindsight-teacher-feedback/v1"
PROJECTION_CONTRACT = {
    "kind": PROJECTION_VERSION,
    "intro_sha256": hashlib.sha256(FEEDBACK_INTRO.encode()).hexdigest(),
    "events": "one_actual_next_learner_intent_and_its_delivery_reference_only",
    "review": "bounded_check_codes_and_verdicts_no_reasoning_or_quoted_text",
    "citations": "visible_text_only_before_review_cut_python_character_offsets_and_sha256",
    "limits": {"checks": 24, "citations": 16, "span_characters": 160,
               "total_span_characters": 1024, "learner_intent_bytes": 16384},
    "verdicts": ["pass", "fail", "unknown", "unavailable", "not_applicable", "abstain",
                 "pass_with_limits", "chat_only", "delivered_but_role_failed",
                 "mechanics_only_learning_unknown"],
    "review_tags": {"learner_role_fidelity": ["passed", "failed", "unknown", "requires_audit"],
                    "status": ["requires_audit", "reviewed", "unknown"],
                    "purpose": ["sdpo_mechanics_canary_only"]},
}


def _text_fields(value, path):
    """Traverse only a caller-selected public text field, never a raw event."""
    if type(value) is str:
        yield path, value
    elif type(value) is list:
        for index, item in enumerate(value):
            yield from _text_fields(item, path + [index])
    elif type(value) is dict:
        for key, item in value.items():
            yield from _text_fields(item, path + [key])


def _citation_fields(event):
    payload, kind = event["payload"], event["kind"]
    if kind == "learner_initial_message":
        yield ["payload", "text"], payload["text"]
    elif kind == "learner_intent":
        intent = payload["intent"]
        if intent["kind"] in {"message", "ui_action"}:
            field = "text" if intent["kind"] == "message" else "payload"
            yield from _text_fields(intent[field], ["payload", "intent", field])
    elif kind == "delivered_observation":
        yield ["payload", "visibleText"], payload["visibleText"]
        for index, document in enumerate(payload["documents"]):
            for field in ("heading", "body"):
                yield from _text_fields(document[field], ["payload", "documents", index, field])
    elif kind == "actor_message":
        content = payload["message"]["content"]
        if type(content) is str:
            yield ["payload", "message", "content"], content
        else:
            for index, block in enumerate(content):
                if block.get("type") == "text":
                    yield ["payload", "message", "content", index, "text"], block["text"]


def _bounded_citation(citation, events, latest_sequence, limits):
    nu.need(type(citation) is dict and set(citation) <= {
        "event_id", "event_hash", "quote", "field_path", "start", "end"}, "citation_schema")
    event = events.get(citation.get("event_id"))
    nu.need(event is not None and event["sequence"] <= latest_sequence
            and event["hash"] == citation.get("event_hash"), "citation_event_boundary")
    quote = citation.get("quote")
    nu.need(type(quote) is str and 0 < len(quote) <= limits["span_characters"], "citation_span_bound")
    explicit = {"field_path", "start", "end"} & set(citation)
    nu.need(not explicit or explicit == {"field_path", "start", "end"}, "citation_offsets_required")
    matches = []
    for path, text in _citation_fields(event):
        if explicit:
            start, end = citation["start"], citation["end"]
            nu.need(type(start) is int and type(end) is int and 0 <= start < end, "citation_offsets_required")
            if path == citation["field_path"] and end <= len(text) and text[start:end] == quote:
                matches.append((path, start, end))
        else:
            start = text.find(quote)
            while start >= 0 and len(matches) < 2:
                matches.append((path, start, start + len(quote)))
                start = text.find(quote, start + 1)
    nu.need(len(matches) == 1, "citation_span_missing_or_ambiguous")
    path, start, end = matches[0]
    # Quotes remain in the original private review. No string-overlap ban:
    # even a complete short answer may legitimately recur in learner evidence.
    return {"event_id": event["event_id"], "event_hash": event["hash"], "field_path": path,
            "start": start, "end": end, "span_sha256": hashlib.sha256(quote.encode()).hexdigest()}


def teacher_feedback_projection(checked, capture, feature, review):
    """Allowlist the teacher view after shared episode/capture/review validation.

    The full feedback packet remains the updater's private provenance contract.
    Citations can identify action/artifact spans, but never forward their text.
    """
    packet = nt.feedback_packet(feature, review)
    latest = checked.events[feature["latest_allowed_event_id"]]
    delivery = checked.events[feature["delivery_event_id"]]
    references = [e for e in feature["input_events"] if e["kind"] == "learner_delivery_evidence"]
    nu.need(len(references) == 1 and references[0]["event_id"] == latest["event_id"]
            and latest["hash"] == feature["latest_allowed_event_hash"], "projection_delivery_boundary")
    reference = references[0]
    intent_id = reference["payload"]["intent_event_id"]
    intent = checked.events.get(intent_id)
    nu.need(intent is not None and intent["kind"] == "learner_intent"
            and delivery["sequence"] < intent["sequence"] < latest["sequence"]
            and intent["payload"]["intent"]["kind"] in {"message", "ui_action"}
            and intent["payload"]["observation_hash"] == delivery["payload"]["observationHash"],
            "projection_next_intent_boundary")
    nu.need({"event_id": intent_id, "kind": "learner_intent", "payload": intent["payload"]}
            in feature["input_events"], "projection_next_intent_source")
    limits = PROJECTION_CONTRACT["limits"]
    learner_intent = copy.deepcopy(intent["payload"]["intent"])
    nu.need(len(nt.native_json(learner_intent).encode()) <= limits["learner_intent_bytes"],
            "projected_learner_intent_overflow")
    # The only raw actor event eligible for citation is this captured action.
    # Earlier visible events may be cited, never earlier private state/results.
    events = {e["event_id"]: checked.events[e["event_id"]] for e in feature["input_events"]
              if e["kind"] in {"learner_initial_message", "learner_intent", "delivered_observation"}}
    events[capture["actor_event_id"]] = checked.events[capture["actor_event_id"]]
    feedback = review.get("feedback")
    nu.need(feedback is None or type(feedback) is dict, "projected_review_object_required")
    feedback = feedback or {}
    source_checks = feedback.get("checks", {})
    nu.need(type(source_checks) is dict and len(source_checks) <= limits["checks"], "projected_checks_bound")
    checks, span_count, span_characters = [], 0, 0
    for name, check in source_checks.items():
        nu.need(type(name) is str and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name) is not None
                and type(check) is dict and check.get("verdict") in PROJECTION_CONTRACT["verdicts"],
                "projected_check_code_required")
        citations = check.get("citations", [])
        nu.need(type(citations) is list, "citation_schema")
        spans = []
        for citation in citations:
            span = _bounded_citation(citation, events, latest["sequence"], limits)
            span_count += 1
            span_characters += span["end"] - span["start"]
            nu.need(span_count <= limits["citations"] and span_characters <= limits["total_span_characters"],
                    "citation_total_bound")
            spans.append(span)
        checks.append({"name": name, "verdict": check["verdict"], "citations": spans})
    tags = {}
    scope = feedback.get("scope") if type(feedback.get("scope")) is dict else {}
    for key, allowed in PROJECTION_CONTRACT["review_tags"].items():
        values = [v[key] for v in (feedback, scope) if key in v]
        if values:
            nu.need(all(value in allowed and value == values[0] for value in values), "projected_review_tag")
            tags[key] = values[0]
    return nt.seal({"schema_version": 1, "kind": PROJECTION_VERSION,
        "contract_hash": nt.native_hash(PROJECTION_CONTRACT),
        "source_feedback_hash": packet["feedback_hash"], "feature_hash": feature["feature_hash"],
        "review_hash": review["review_hash"], "capture_hash": capture["capture_hash"],
        "episode_id": feature["episode_id"], "branch_id": feature["branch_id"],
        "latest_allowed_event_id": latest["event_id"], "latest_allowed_event_hash": latest["hash"],
        "next_learner_event": {"event_id": intent_id, "event_hash": intent["hash"], "intent": learner_intent},
        "learner_delivery_evidence": {"event_id": latest["event_id"], "event_hash": latest["hash"],
                                      **copy.deepcopy(reference["payload"])},
        "review": {"accepted": review["accepted"], **tags, "checks": checks},
        "outcome": None, "outcome_status": "unknown"}, "projection_hash")


def validate_config(config):
    """Accept the existing SDPO config with this renderer's exact Base pins."""
    config = copy.deepcopy(config)
    nu.validate_config(config)
    nu.need(config["method"] == "sdpo", "existing_sdpo_config_required")
    nu.need(config["model"]["id"] == ns.MODEL and config["tokenizer"] == {
        "id": ns.MODEL, "revision": ns.HF_REVISION, "chat_template_hash": ns.HF_TEMPLATE_HASH},
        "hindsight_base_tokenizer_pin")
    nu.need(config["model"]["revision"].split("/")[-1] not in {"latest", "current"},
            "immutable_initial_training_checkpoint_required")
    return config


class QwenFeedbackRenderer:
    """Use the exact original actor renderer and verify the captured prefix IDs."""
    def __init__(self):
        self.base = ns.PinnedQwenSampler()  # Local pinned files, no service or secret.
        self.audit = self.base.audit
    def render(self, messages, tools):
        return list(self.base.prepare(messages, tools).to_ints())


def prepare_hindsight(episode, capture, review, config, *, renderer=None):
    """Rebuild public artifact/next-event evidence from the actual validated ledger.

    Rejected actions retain diagnostic feedback only. prepare_signals admits
    accepted records through the existing SDPO guards. An injected renderer
    is a trusted test seam, never a provider attestation.
    """
    episode, capture, review = copy.deepcopy((episode, capture, review))
    config = validate_config(config)
    checked = nt.validate_episode(episode)
    step = nt.validate_capture(checked, capture)
    nu.need(episode["measurement"] == "model_episode" and capture["source"]["kind"] == "provider_capture",
            "actual_native_provider_capture_required")
    source = capture["source"]
    nu.need(all(nu.digest(source.get(k)) for k in ("generation_hash", "roles_hash", "probability_hash"))
            and type(source.get("raw_record_hashes")) is dict
            and set(source["raw_record_hashes"]) == {"prepared", "sampled", "parsed"}
            and all(nu.digest(v) for v in source["raw_record_hashes"].values()), "generation_behavior_attestation_required")
    nu.need(capture["actor"]["provider"] == "tinker" and capture["actor"]["id"] == config["model"]["id"]
            and capture["actor"]["revision"] in config["allowed_behavior_revisions"]
            and capture["tokenizer"] == config["tokenizer"], "actor_teacher_tokenizer_mismatch")
    nu.logprobs(capture.get("behavior_logprobs"), len(capture["completion_token_ids"]))
    renderer_pin = {"id": ns.RENDERER, "revision": ns.RENDERER_HASH}
    nu.need(source.get("renderer", {}).get("id") == renderer_pin["id"]
            and source.get("renderer", {}).get("revision") == renderer_pin["revision"], "captured_renderer_mismatch")
    delivery = checked.deliveries[step["event_id"]]
    actions = [e for e in episode["ledger"][step["sequence"] + 1:delivery["sequence"]] if e["kind"] == "actor_message"]
    nu.need(len(actions) == 1 and actions[0]["event_id"] == capture["actor_event_id"], "ambiguous_multi_action_feedback_boundary")
    # Reuse all independent-review, branch, delivery and acceptance checks.
    bundle = nt.build_exports([episode], {"schema_version": 1, "captures": [capture]},
                              {"schema_version": 1, "reviews": [review]})
    features = [f for f in bundle["observer_inputs"] if f["event_id"] == capture["event_id"]
                and f["boundary"] == "retrospective"]
    nu.need(len(features) == 1 and review.get("boundary") == "retrospective", "unique_delivered_next_event_required")
    feature = features[0]
    packet = nt.feedback_packet(feature, review)
    projection = teacher_feedback_projection(checked, capture, feature, review)
    request = episode["runtime"]["requests"][capture["request_index"]]
    payload = request["data"].get("payload")
    nu.need(type(payload) is dict and type(payload.get("messages")) is list
            and payload.get("model") == capture["actor"]["id"], "original_provider_payload_required")
    messages, tools = copy.deepcopy(payload["messages"]), copy.deepcopy(payload.get("tools", []))
    nu.need(type(tools) is list and (payload.get("tool_choice") != "none" or not tools), "ambiguous_original_tool_context")
    renderer = renderer or QwenFeedbackRenderer()
    original_ids = renderer.render(copy.deepcopy(messages), copy.deepcopy(tools))
    nu.need(nu.tokens(original_ids) and original_ids == capture["prompt_token_ids"], "original_rendered_prefix_mismatch")
    teacher_messages = messages + [{"role": "user", "content": FEEDBACK_INTRO + nt.native_json(projection)}]
    prefix_ids = renderer.render(copy.deepcopy(teacher_messages), copy.deepcopy(tools))
    completion = copy.deepcopy(capture["completion_token_ids"])
    nu.need(nu.tokens(prefix_ids) and prefix_ids != original_ids, "distinct_teacher_prefix_required")
    # SDK 0.27.1 compute_logprobs internally requests one extra sample token.
    # Budget/scoring remain exclusively the existing updater's responsibility.
    nu.need(len(prefix_ids) + len(completion) + 1 <= CONTEXT_TOKENS, "hindsight_context_overflow")
    prefix = nt.seal({"prompt_token_ids": prefix_ids, "completion_token_ids": completion,
                      "tokenizer": capture["tokenizer"], "original_request_hash": capture["request_hash"],
                      "feedback_hash": packet["feedback_hash"], "conditioning": nu.CONDITIONING,
                      "teacher_feedback_projection": projection,
                      "rendered_messages_hash": nt.native_hash(teacher_messages),
                      "renderer": renderer_pin}, "prefix_hash")
    student = nt.actor_segment(capture)
    teacher_ids = prefix_ids + completion
    teacher_mask = [0] * (len(prefix_ids) - 1) + [1] * len(completion)
    return nt.seal({"schema_version": 1, "kind": VERSION, "config_hash": config["config_hash"],
                    "producer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "capture_hash": capture["capture_hash"], "capture_source": source,
                    "feature": feature, "feedback": packet, "review": review, "teacher_prefix": prefix,
                    "feedback_projection": projection, "feedback_projection_contract": copy.deepcopy(PROJECTION_CONTRACT),
                    "student_segment": student, "teacher_input_tokens": teacher_ids[:-1],
                    "teacher_target_tokens": teacher_ids[1:], "teacher_loss_mask": teacher_mask,
                    "original_completion_hash": nt.native_hash(completion),
                    "original_rendered_prefix_ids": original_ids,
                    "teacher_rendered_messages": teacher_messages, "teacher_tools": tools,
                    "renderer_audit": copy.deepcopy(renderer.audit),
                    "review_decision": "accepted" if review["accepted"] else "rejected",
                    "teacher_snapshot_owner": nu.VERSION,
                    "teacher_snapshot": None, "teacher_scores": None,
                    "hosted_weight_revision_attested": False}, "proof_hash")


def prepare_signals(episodes, captures, reviews, splits, config, *, renderer=None):
    """Return exports, sealed signals/proofs and the EXISTING validated plan.

    Inputs are original native_training envelopes and an externally approved
    split manifest. No admission, review, score, funding or snapshot is invented.
    """
    episodes, captures, reviews, splits = copy.deepcopy((episodes, captures, reviews, splits))
    config = validate_config(config)
    bundle = nt.build_exports(episodes, captures, reviews)
    # Reject unadmitted/rejected selections before loading local model libraries.
    families = nu.validate_splits(bundle, splits)
    accepted = {row["segment"]["capture_hash"]: row for row in bundle["sft"]}
    capture_map = {c["capture_hash"]: c for c in captures["captures"]}
    episode_map = {(e["id"], e["branch_id"]): e for e in episodes}
    review_map = {r["review_hash"]: r for r in reviews["reviews"] if r.get("kind") == "segment"}
    selected = []
    for key in config["capture_hashes"]:
        row = accepted.get(key)
        nu.need(row is not None, "missing_accepted_capture_export")
        nu.need(families[row["family"]]["split"] == "train", "nontraining_family")
        capture = capture_map[key]
        episode = episode_map[(row["episode_id"], row["branch_id"])]
        review = review_map[row["review_hash"]]
        selected.append((episode, capture, review))
    renderer = renderer or QwenFeedbackRenderer()
    proofs = [prepare_hindsight(*item, config, renderer=renderer) for item in selected]
    signals = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"], "signals": [{
        "capture_hash": p["capture_hash"], "review": p["review"], "teacher_prefix": p["teacher_prefix"]}
        for p in proofs]}, "signals_hash")
    # Actual handoff gate, not an approximation of validate_signal or SDPO.
    plan = nu.prepare_update(bundle, splits, config, signals)
    proof_bundle = nt.seal({"schema_version": 1, "kind": VERSION,
        "export_hash": bundle["export_hash"], "signals_hash": signals["signals_hash"],
        "split_hash": splits["split_hash"], "config_hash": config["config_hash"],
        "update_plan_hash": plan["plan_hash"], "proofs": proofs}, "proofs_hash")
    return {"exports": bundle, "signals": signals, "prefix_proofs": proof_bundle, "update_plan": plan}


def ignored_path(value):
    path = Path(value).absolute()
    nu.need(path == path.resolve() and path.is_relative_to(ROOT / ".keating"), "ignored_private_path_required")
    result = subprocess.run(["git", "check-ignore", "--quiet", "--no-index", str(path)], cwd=ROOT, capture_output=True)
    nu.need(result.returncode == 0, "ignored_private_path_required")
    return path


def write_once(path, value):
    raw = (nt.native_json(value) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def write_prepared(output_dir, prepared):
    """Exclusive private journal; a final manifest marks a complete write."""
    output = ignored_path(output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name, key in (("exports.json", "exports"), ("signals.json", "signals"),
                      ("prefix-proofs.json", "prefix_proofs"), ("update-plan.json", "update_plan")):
        write_once(output / name, prepared[key])
    write_once(output / "prepared.json", nt.seal({"schema_version": 1, "kind": VERSION,
        "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.glob("*.json"))},
        "status": "prepared_only", "provider_dispatched": False}, "prepared_hash"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="command", required=True).add_parser("signals")
    command.add_argument("--episode", action="append", required=True)
    for field in ("captures", "reviews", "splits", "config", "output"):
        command.add_argument("--" + field, required=True)
    args = parser.parse_args(argv)
    result = prepare_signals([nt.load_json(p) for p in args.episode],
        *[nt.load_json(getattr(args, k)) for k in ("captures", "reviews", "splits", "config")])
    write_prepared(args.output, result)
    print(json.dumps({"status": "prepared_only", "provider_dispatched": False,
        "signals_hash": result["signals"]["signals_hash"], "plan_hash": result["update_plan"]["plan_hash"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"error": "Hindsight preparation rejected; no provider dispatch"}))
        raise SystemExit(1) from None
