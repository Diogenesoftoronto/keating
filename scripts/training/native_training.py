"""Offline, fail-closed projections of native_episode.ts ledgers. No model calls.

Hashes bind supplied evidence; they do not authenticate the capture operator.
See docs/native-training-exports.md for the external capture/review trust boundary.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import sys


class ExportError(ValueError):
    """Invalid evidence, rather than merely unavailable evidence."""


def require(condition, code):
    if not condition:
        raise ExportError(code)


def _string(value):
    # JSON.stringify escapes lone UTF-16 surrogates, but not ordinary Unicode.
    result = json.dumps(value, ensure_ascii=False)
    return "".join(f"\\u{ord(c):04x}" if 0xD800 <= ord(c) <= 0xDFFF else c for c in result)


def native_json(value):
    """Insertion-ordered JSON.stringify-compatible encoding of ledger JSON.

    Reject non-JSON values and unsafe integers. Numeric property names follow JS
    enumeration order. Decimal/exponent formatting follows ECMAScript thresholds.
    A producer hash mismatch always fails closed; keys are never sorted wholesale.
    """
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is str:
        return _string(value)
    if type(value) is int:
        require(abs(value) <= 2**53 - 1, "unsafe_json_integer")
        return str(value)
    if type(value) is float:
        require(math.isfinite(value), "nonfinite_json_number")
        if value == 0:
            return "0"
        sign = "-" if value < 0 else ""
        mantissa, _, exponent = repr(abs(value)).lower().partition("e")
        whole, _, fraction = mantissa.partition(".")
        digits = (whole + fraction).lstrip("0")
        decimal = len(whole) + int(exponent or 0)
        decimal -= len(whole + fraction) - len(digits)
        digits = digits.rstrip("0")
        if 1e-6 <= abs(value) < 1e21:
            if decimal <= 0:
                return sign + "0." + "0" * -decimal + digits
            if decimal >= len(digits):
                return sign + digits + "0" * (decimal - len(digits))
            return sign + digits[:decimal] + "." + digits[decimal:]
        exp = decimal - 1
        return sign + digits[0] + ("." + digits[1:] if len(digits) > 1 else "") + f"e{exp:+d}"
    if type(value) is list:
        return "[" + ",".join(native_json(v) for v in value) + "]"
    require(type(value) is dict and all(type(k) is str for k in value), "not_json_object")
    numeric = sorted((k for k in value if re.fullmatch(r"0|[1-9][0-9]*", k)
                      and int(k) < 2**32 - 1), key=int)
    keys = numeric + [k for k in value if k not in numeric]
    return "{" + ",".join(_string(k) + ":" + native_json(value[k]) for k in keys) + "}"


def native_hash(value):
    return hashlib.sha256(native_json(value).encode("utf-8")).hexdigest()


def seal(value, field="hash"):
    """Return a copy with a content hash; useful for external capture producers."""
    result = deepcopy(value)
    result.pop(field, None)
    result[field] = native_hash(result)
    return result


def _sealed(value, field):
    require(type(value) is dict and value.get(field) == native_hash(
        {k: v for k, v in value.items() if k != field}), f"invalid_{field}")


def _text(value):
    return type(value) is str and bool(value.strip())


def _digest(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _keys(value, required, optional=""):
    require(type(value) is dict and set(required.split()) <= set(value)
            and set(value) <= set((required + " " + optional).split()), "unexpected_or_missing_evidence_fields")


def _time(value):
    require(type(value) is str, "invalid_timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ExportError("invalid_timestamp") from exc
    require(result.tzinfo is not None, "timestamp_requires_timezone")
    return result


def _content(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b["text"] for b in content if isinstance(b, dict)
                         and b.get("type") == "text" and isinstance(b.get("text"), str))
    return ""


EVENT_FIELDS = set("event_id episode_id branch_id parent_event_id sequence timestamp origin kind visibility payload payload_hash previous_hash hash".split())
KINDS = {
    "scenario_admitted": ("controller", "evaluator"),
    "learner_initial_message": ("learner", "learner"),
    "runtime_step": ("runtime", "evaluator"),
    "actor_message": ("runtime", "evaluator"),
    "tool_call": ("runtime", "evaluator"),
    "tool_result": ("runtime", "evaluator"),
    "state_snapshot": ("runtime", "evaluator"),
    "action_receipt": ("runtime", "evaluator"),
    "source_observation": ("runtime", "learner"),
    "delivered_observation": ("runtime", "learner"),
    "learner_intent": ("learner", "learner"),
    "invalid_learner_intent": ("learner", "evaluator"),
    "learner_provider_failure": ("controller", "evaluator"),
    "episode_end": ("controller", "evaluator"),
}
OUTCOMES = set("complete learner_stop tutor_failure provider_failure invalid_learner_action delivery_failure budget_exhausted assessment_unavailable".split())


def _observation(value):
    require(type(value) is dict and set(value) == set(
        "schema_version observationHash step visibleText documents availableActions".split()), "observation_fields")
    require(value["schema_version"] == 1 and type(value["visibleText"]) is str,
            "invalid_observation")
    require(value["observationHash"] == native_hash({k: v for k, v in value.items()
                                                     if k != "observationHash"}), "observation_hash")
    require(type(value["documents"]) is list and type(value["availableActions"]) is list, "observation_lists")
    docs = {}
    for doc in value["documents"]:
        require(type(doc) is dict and set(doc) == {"id", "revision", "heading", "body"}, "document_fields")
        require(_text(doc["id"]) and doc["id"] not in docs and type(doc["revision"]) is int
                and doc["revision"] >= 0 and type(doc["heading"]) is str and type(doc["body"]) is list
                and all(type(s) is str for s in doc["body"]), "invalid_document")
        docs[doc["id"]] = doc
    controls = set()
    for control in value["availableActions"]:
        require(type(control) is dict and set(control) <= set(
            "actionId documentId documentRevision nodeId type choices".split())
            and set("actionId documentId documentRevision nodeId type".split()) <= set(control), "control_fields")
        doc = docs.get(control["documentId"])
        require(doc is not None and doc["revision"] == control["documentRevision"]
                and _text(control["nodeId"]) and control["type"] in {"submit-answer", "choose-option", "update-notes"}, "invalid_control")
        expected = f'{doc["id"]}:{doc["revision"]}:{control["nodeId"]}:{control["type"]}'
        require(control["actionId"] == expected and expected not in controls, "control_identity")
        controls.add(expected)
        for choice in control.get("choices", []):
            require(type(choice) is dict and set(choice) == {"id", "label"}
                    and _text(choice["id"]) and type(choice["label"]) is str, "choice_fields")


def _intent(value, observation):
    require(type(value) is dict, "invalid_intent")
    kind = value.get("kind")
    if kind in {"stop", "reopen", "new_session"}:
        require(set(value) == {"kind"}, "intent_fields")
    elif kind == "message":
        require(set(value) == {"kind", "text"} and _text(value["text"])
                and len(value["text"]) <= 65536 and not re.match(r"\s*[!/]", value["text"]), "invalid_message_intent")
    else:
        require(kind == "ui_action" and set(value) == {"kind", "actionId", "payload"}, "intent_fields")
        control = next((c for c in observation["availableActions"] if c["actionId"] == value["actionId"]), None)
        require(control is not None, "unavailable_action")
        field = {"submit-answer": "answer", "choose-option": "optionIds", "update-notes": "value"}[control["type"]]
        require(type(value["payload"]) is dict and set(value["payload"]) == {field}, "learner_cannot_grade")
        if field == "optionIds":
            ids = value["payload"][field]
            require(type(ids) is list and all(type(i) is str for i in ids)
                    and len(set(ids)) == len(ids) and set(ids) <= {c["id"] for c in control.get("choices", [])}, "unknown_choice")
        else:
            require(type(value["payload"][field]) is str, "invalid_action_payload")


@dataclass
class Episode:
    """Validated snapshot. Call validate_episode again after modifying evidence."""
    value: dict
    events: dict
    steps: list
    deliveries: dict
    next_intents: dict
    executions: dict

    def ref(self, event):
        return {"episode_id": self.value["id"], "branch_id": self.value["branch_id"],
                "family": self.value["family"], "event_id": event["event_id"],
                "event_hash": event["hash"], "payload_hash": event["payload_hash"]}


def _step_evidence(payload):
    expected = []
    if payload["kind"] in {"message", "ui_action"}:
        for message in payload["messages"][payload["message_start_index"]:]:
            if message.get("role") == "assistant":
                expected.append(("actor_message", {"step": payload["index"], "message": message}))
                if isinstance(message.get("content"), list):
                    for block in message["content"]:
                        if isinstance(block, dict) and block.get("type") == "toolCall":
                            expected.append(("tool_call", {"step": payload["index"], "call": block}))
            elif message.get("role") == "toolResult":
                expected.append(("tool_result", {"step": payload["index"], "message": message}))
    require(type(payload.get("files")) is list and type(payload.get("state")) is dict, "step_state_files")
    for file in payload["files"]:
        require(type(file) is dict and _text(file.get("path")) and type(file.get("content")) is str
                and file.get("sha256") == hashlib.sha256(file["content"].encode()).hexdigest(), "state_file_hash")
    expected.append(("state_snapshot", {"step": payload["index"], "session_id": payload["state"].get("sessionId"),
                     "files": [{"path": f["path"], "sha256": f["sha256"]} for f in payload["files"]]}))
    return expected


def _source_delivery(payload, opening, runtime):
    """Bind initial environment context to the actual Pi custom-entry receipt."""
    messages = payload['messages'][payload['message_start_index']:]
    require(len(messages) == 1 and messages[0].get('role') == 'custom', 'source_must_not_generate_actor')
    message = messages[0]
    require(message.get('customType') == 'keating-benchmark-source-document-v1'
            and message.get('display') is True, 'source_custom_message')
    details = message.get('details')
    _keys(details, 'origin fingerprint document opening_message surface')
    require(details['origin'] == 'environment' and details['opening_message'] == opening
            and details['surface'] in {'chat', 'interactive'}, 'source_context_mismatch')
    require(details['fingerprint'] == native_hash({
        'document': details['document'], 'opening_message': opening, 'surface': details['surface']}),
        'source_fingerprint_mismatch')
    doc = details['document']
    require(type(doc) is dict and doc.get('revision') == 0 and doc.get('lifecycle') == 'ready'
            and type(doc.get('nodes')) is list and doc['nodes'], 'source_document_state')
    parts = [doc.get('title'), doc.get('description')]
    for node in doc['nodes']:
        require(type(node) is dict and node.get('type') == 'question'
                and node.get('kind') in {'choice', 'text'}
                and set(node) <= {'type', 'id', 'kind', 'prompt', 'header', 'choices', 'allowText'}
                and node.get('allowText', False) is False, 'source_document_private_fields')
        parts.extend([node.get('header'), node.get('prompt')])
        for choice in node.get('choices', []):
            require(type(choice) is dict and set(choice) == {'id', 'label'}, 'source_choice_fields')
            parts.append(f"({choice['id']}) {choice['label']}")
    public = '\n'.join(p for p in parts if isinstance(p, str) and p)
    require(message.get('content') == f'Learner opening:\n{opening}\n\nSource activity:\n{public}',
            'source_content_mismatch')
    receipts = [r.get('data', {}).get('entry') for r in runtime.get('receipts', [])
                if r.get('kind') == 'source_document_delivered']
    require(len(receipts) == 1 and type(receipts[0]) is dict, 'source_delivery_receipt_missing')
    entry = receipts[0]
    require(entry.get('type') == 'custom_message' and _text(entry.get('id'))
            and all(entry.get(k) == message.get(k) for k in ('customType', 'content', 'details', 'display')),
            'source_delivery_receipt_mismatch')
    return message


def validate_episode(value):
    """Validate the producer's ordered hash chain and actual receipt transitions."""
    value = deepcopy(value)
    require(type(value) is dict and value.get("schema_version") == 1, "episode_schema")
    require(all(_text(value.get(k)) for k in ("id", "branch_id", "family")), "episode_identity")
    ledger, runtime = value.get("ledger"), value.get("runtime")
    require(type(ledger) is list and len(ledger) >= 3 and type(runtime) is dict, "episode_structure")
    require(value.get("outcome") in OUTCOMES and runtime.get("id") == value["id"]
            and runtime.get("measurement") == value.get("measurement")
            and value["measurement"] in {"offline_integration", "model_episode"}, "runtime_identity")
    require(type(runtime.get("steps")) is list and type(runtime.get("requests")) is list
            and type(runtime.get("source_hashes")) is dict and runtime["source_hashes"]
            and all(_digest(h) for h in runtime["source_hashes"].values()), "runtime_structure")
    events, steps, deliveries, next_intents, executions = {}, [], {}, {}, {}
    previous = None
    for index, event in enumerate(ledger):
        require(type(event) is dict and set(event) == EVENT_FIELDS, "event_fields")
        require(event["event_id"] == f'{value["id"]}-{value["branch_id"]}-{index}'
                and event["event_id"] not in events and type(event["sequence"]) is int
                and event["sequence"] == index and event["episode_id"] == value["id"]
                and event["branch_id"] == value["branch_id"], "event_identity_or_order")
        require(event["parent_event_id"] == (previous["event_id"] if previous else None)
                and event["previous_hash"] == (previous["hash"] if previous else None), "broken_causal_chain")
        require(event["kind"] in KINDS and (event["origin"], event["visibility"]) == KINDS[event["kind"]], "event_kind_or_visibility")
        require(type(event["payload"]) is dict and event["payload_hash"] == native_hash(event["payload"]), "payload_hash")
        _sealed(event, "hash")
        stamp = _time(event["timestamp"])
        require(previous is None or stamp >= _time(previous["timestamp"]), "time_reversal")
        events[event["event_id"]] = event
        previous = event
    require(ledger[0]["kind"] == "scenario_admitted" and ledger[1]["kind"] == "learner_initial_message"
            and ledger[-1]["kind"] == "episode_end", "episode_boundaries")
    admitted, end = ledger[0]["payload"], ledger[-1]["payload"]
    require(admitted.get("family") == value["family"] and admitted.get("source") == value.get("source")
            and admitted.get("learner_policy") == value.get("learner_policy")
            and _digest(admitted.get("scenario_hash")), "admission_mismatch")
    require(end.get("outcome") == value["outcome"] and end.get("assessment") == value.get("assessment")
            and end.get("runtime_error") == runtime.get("error_code")
            and end.get("runtime_source_hash") == native_hash(runtime["source_hashes"]), "end_mismatch")
    require(end.get("assessment_status") == "unavailable" and end.get("assessment") is None,
            "unsupported_assessment_contract")
    require(runtime.get("status") in {"completed", "failed"}, "runtime_status")
    pending, current, observation, action, can_decide = ledger[1], None, None, None, False
    require(set(pending["payload"]) == {"text"} and _text(pending["payload"]["text"]), "opening_message")
    expected_evidence = []
    for event in ledger[2:-1]:
        kind, payload = event["kind"], event["payload"]
        if expected_evidence:
            expected_kind, expected_payload = expected_evidence.pop(0)
            require(kind == expected_kind and native_hash(payload) == native_hash(expected_payload), "runtime_detail_mismatch")
            continue
        if current is not None and current["payload"]["kind"] == "ui_action" and "action_result" in current["payload"] and action is None:
            require(kind == "action_receipt", "missing_action_receipt")
        if kind == "runtime_step":
            require(pending is not None and not can_decide, "runtime_without_intent")
            intent = ({"kind": "message", **pending["payload"]} if pending["kind"] == "learner_initial_message"
                      else pending["payload"]["intent"])
            source_step = (payload.get('kind') == 'source_document' and not steps
                           and pending['kind'] == 'learner_initial_message')
            require(payload.get("index") == len(steps) and type(payload.get("index")) is int
                    and (payload.get("kind") == intent["kind"] or source_step)
                    and intent["kind"] != "stop", "step_intent_mismatch")
            require(payload.get("status") in {"completed", "failed"}
                    and type(payload.get("messages")) is list and type(payload.get("message_start_index")) is int
                    and 0 <= payload["message_start_index"] <= len(payload["messages"]), "step_structure")
            require(all(type(m) is dict for m in payload["messages"]), "message_structure")
            if payload["kind"] in {"message", "ui_action", "source_document"}:
                before = steps[-1]["payload"]["messages"] if steps else []
                require(payload["message_start_index"] == len(before)
                        and native_hash(payload["messages"][:len(before)]) == native_hash(before), "changed_or_reused_message_prefix")
            if payload['status'] == 'completed' and source_step:
                _source_delivery(payload, intent['text'], runtime)
            elif payload["status"] == "completed" and intent["kind"] == "message":
                require(any(m.get("role") == "user" and _content(m) == intent["text"]
                            for m in payload["messages"][payload["message_start_index"]:]), "message_not_delivered")
            executions[pending["event_id"]] = event
            steps.append(event)
            current, pending, observation, action = event, None, None, None
            # Failed follow-up inference still leaves actual messages/state and
            # may follow a successfully persisted learner submission.
            expected_evidence = _step_evidence(payload)
        elif kind == "action_receipt":
            require(current is not None and ledger[event["sequence"] - 1]["kind"] == "state_snapshot"
                    and current["payload"]["kind"] == "ui_action" and "action_result" in current["payload"], "orphan_action_receipt")
            result = current["payload"].get("action_result")
            require(payload.get("result") == result and payload.get("status") == (
                result.get("status", "unavailable") if isinstance(result, dict) else "unavailable"), "action_receipt_mismatch")
            action = event
        elif kind in {"delivered_observation", "source_observation"}:
            require(current is not None and current["event_id"] not in deliveries
                    and current["payload"]["status"] == "completed" and not can_decide, "delivery_without_completed_step")
            predecessor = ledger[event["sequence"] - 1]
            require(predecessor is action if current["payload"]["kind"] == "ui_action"
                    else predecessor["kind"] == "state_snapshot", "delivery_order")
            if current["payload"]["kind"] == "ui_action":
                require(action is not None and action["payload"]["status"] in {"accepted", "completed"}, "unsuccessful_delivery")
            _observation(payload)
            require((kind == 'source_observation') == (current['payload']['kind'] == 'source_document'),
                    'source_observation_role_mismatch')
            if kind == 'source_observation':
                message = current['payload']['messages'][current['payload']['message_start_index']]
                require(payload['visibleText'] == message['content'], 'source_observation_content_mismatch')
                doc = message['details']['document']
                require(([d['id'] for d in payload['documents']] == [doc['id']]
                         and all(d['revision'] == 0 for d in payload['documents']))
                        if message['details']['surface'] == 'interactive'
                        else not payload['documents'] and not payload['availableActions'], 'source_observation_surface')
            require(payload["step"] == current["payload"]["index"], "observation_step_mismatch")
            deliveries[current["event_id"]] = event
            observation, can_decide = event, True
        elif kind in {"learner_intent", "invalid_learner_intent"}:
            require(can_decide and observation is not None and payload.get("observation_hash") == observation["payload"]["observationHash"], "stale_learner_observation")
            if kind == "learner_intent":
                require(set(payload) == {"observation_hash", "intent"}, "learner_intent_fields")
                _intent(payload["intent"], observation["payload"])
                next_intents[current["event_id"]] = event
                pending, can_decide = event, False
        elif kind == "learner_provider_failure":
            require(can_decide, "orphan_learner_failure")
            can_decide = False
        else:
            raise ExportError("unexpected_episode_boundary")
    require(not expected_evidence, "missing_runtime_detail")
    require(current is None or current["payload"]["kind"] != "ui_action"
            or "action_result" not in current["payload"] or action is not None, "missing_action_receipt")
    require(native_hash([e["payload"] for e in steps]) == native_hash(runtime["steps"]), "runtime_steps_mismatch")
    require(not any(e["payload"]["status"] == "failed" for e in steps[:-1]), "continued_after_failure")
    if any(e["payload"]["status"] == "failed" for e in steps):
        require(runtime["status"] == "failed", "failed_step_successful_runtime")
    if value["outcome"] == "learner_stop":
        require(pending is not None and pending["payload"].get("intent", {}).get("kind") == "stop", "stop_without_intent")
    return Episode(value, events, steps, deliveries, next_intents, executions)


def _visible(event):
    # Never serialize runtime.messages, state/files, scenario metadata or review
    # labels as observer inputs. Delivered content is the producer's allowlist.
    if event["kind"] in {"learner_initial_message", "source_observation", "delivered_observation", "learner_intent"}:
        return {"event_id": event["event_id"], "kind": event["kind"], "payload": deepcopy(event["payload"])}
    return None


def _feedback_delivery(episode, step):
    intent = episode.next_intents.get(step["event_id"])
    if not intent or intent["payload"]["intent"]["kind"] not in {"message", "ui_action"}:
        return None
    execution = episode.executions.get(intent["event_id"])
    if not execution:
        return None
    receipt = execution
    if execution["payload"]["kind"] == "ui_action":
        # Delivery is distinct from a successful tutor follow-up. Bound the
        # search to this step, never borrowing a receipt from a later action.
        receipt = None
        for event in episode.value["ledger"][execution["sequence"] + 1:]:
            if event["kind"] in {"runtime_step", "episode_end"}:
                break
            if event["kind"] == "action_receipt":
                receipt = event
                break
        if receipt is None or receipt["payload"]["status"] not in {"accepted", "completed"}:
            return None
    elif execution["event_id"] not in episode.deliveries:
        return None
    return intent, receipt


def feature_inputs(episode):
    """Three event-level measurement inputs, with no private review material.

    Reopen/new_session and UI updates without new actor output are context, not
    fresh tutor actions. Retrospective views require a delivered learner response.
    """
    rows = []
    for step in episode.steps:
        payload = step["payload"]
        if (step["event_id"] not in episode.deliveries or payload["kind"] not in {"message", "ui_action"}
                or not any(m.get("role") == "assistant" for m in payload["messages"][payload["message_start_index"]:])):
            continue
        prefix = [v for e in episode.value["ledger"][:step["sequence"]] if (v := _visible(e)) is not None]
        delivery = episode.deliveries[step["event_id"]]
        for boundary in ("pre_action", "delivered", "retrospective"):
            inputs, latest = deepcopy(prefix), episode.value["ledger"][step["sequence"] - 1]
            if boundary != "pre_action":
                inputs.append(_visible(delivery))
                latest = delivery
            if boundary == "retrospective":
                feedback = _feedback_delivery(episode, step)
                if feedback is None:
                    continue
                intent, latest = feedback
                inputs.append(_visible(intent))
                inputs.append({"event_id": latest["event_id"], "kind": "learner_delivery_evidence",
                               "payload": {"status": "delivered", "intent_event_id": intent["event_id"]}})
            rows.append(seal({"schema_version": 1, **episode.ref(step), "boundary": boundary,
                              "latest_allowed_event_id": latest["event_id"], "latest_allowed_event_hash": latest["hash"],
                              "delivery_event_id": delivery["event_id"], "input_events": inputs,
                              "outcome": None, "outcome_status": "unknown"}, "feature_hash"))
    return rows


def _pin(episode, record):
    event = episode.events.get(record.get("event_id"))
    require(event is not None and all(record.get(k) == v for k, v in episode.ref(event).items()), "event_pin_mismatch")
    return event


def _tokens(value):
    return type(value) is list and bool(value) and all(type(v) is int and 0 <= v <= 2**53 - 1 for v in value)


def _logprobs(value, count):
    require(type(value) is list and len(value) == count and all(type(v) in {int, float}
            and math.isfinite(v) and v <= 0 for v in value), "logprob_alignment_or_value")


def _model(value):
    require(type(value) is dict and all(_text(value.get(k)) for k in ("provider", "id", "revision")), "model_provenance")


def _tokenizer(value):
    require(type(value) is dict and all(_text(value.get(k)) for k in ("id", "revision"))
            and _digest(value.get("chat_template_hash")), "tokenizer_provenance")


def validate_capture(episode, capture):
    """Verify externally recorded IDs, request/message binding and sampler facts."""
    _keys(capture, "schema_version capture_id episode_id branch_id family event_id event_hash payload_hash "
          "delivery_event_hash runtime_hash message_index message_hash actor_event_id actor_event_hash "
          "request_index request_hash context_hash actor tokenizer source prompt_token_ids completion_token_ids "
          "completion_token_roles sampler capture_hash", "behavior_logprobs loss_mask")
    _sealed(capture, "capture_hash")
    require(capture.get("schema_version") == 1 and _text(capture.get("capture_id")), "capture_schema")
    step = _pin(episode, capture)
    require(step["kind"] == "runtime_step" and step["payload"]["kind"] in {"message", "ui_action"}
            and step["event_id"] in episode.deliveries, "capture_requires_delivered_actor_step")
    delivery = episode.deliveries[step["event_id"]]
    require(capture.get("delivery_event_hash") == delivery["hash"]
            and capture.get("runtime_hash") == native_hash(episode.value["runtime"]), "capture_runtime_pin")
    runtime, payload = episode.value["runtime"], step["payload"]
    require(runtime.get("source_provenance", {}).get("unchanged_at_end") is True
            and runtime["source_provenance"].get("changed_paths") == [], "runtime_source_not_stable")
    index = capture.get("message_index")
    require(type(index) is int and payload["message_start_index"] <= index < len(payload["messages"]), "capture_message_index")
    message = payload["messages"][index]
    require(message.get("role") == "assistant" and message.get("stopReason") not in {"error", "aborted"}
            and capture.get("message_hash") == native_hash(message), "capture_not_actor_message")
    actor_events = [e for e in episode.value["ledger"][step["sequence"] + 1:delivery["sequence"]]
                    if e["kind"] == "actor_message"]
    ordinal = sum(m.get("role") == "assistant" for m in payload["messages"][payload["message_start_index"]:index])
    actor_event = actor_events[ordinal]
    require(capture.get("actor_event_id") == actor_event["event_id"]
            and capture.get("actor_event_hash") == actor_event["hash"], "capture_actor_event_pin")
    request_index = capture.get("request_index")
    require(type(request_index) is int and 0 <= request_index < len(runtime["requests"]), "capture_request_index")
    request = runtime["requests"][request_index]
    require(request.get("kind") == "provider_request" and capture.get("request_hash") == native_hash(request), "capture_request_pin")
    data = request.get("data", {})
    context = data.get("context", {})
    require(type(context.get("messages")) is list and native_hash(context["messages"]) == native_hash(payload["messages"][:index])
            and capture.get("context_hash") == native_hash(context), "capture_not_actual_prefix")
    _model(capture.get("actor"))
    _tokenizer(capture.get("tokenizer"))
    require(all(capture["actor"][k] == data.get("model", {}).get(k) for k in ("provider", "id")), "capture_actor_request_mismatch")
    require(message.get("model") == capture["actor"]["id"] and message.get("provider") == capture["actor"]["provider"], "capture_actor_message_mismatch")
    source = capture.get("source", {})
    require(source.get("kind") in {"provider_capture", "authored_fixture"}
            and source.get("recorded_at_generation") is True
            and all(_text(source.get(k)) for k in ("recorder_revision", "request_id", "response_id")), "capture_source")
    _time(source.get("captured_at"))
    require((source["kind"] == "authored_fixture") == (episode.value["measurement"] == "offline_integration"), "fixture_cannot_claim_model_capture")
    require(_tokens(capture.get("prompt_token_ids")) and _tokens(capture.get("completion_token_ids")), "original_token_ids_required")
    count = len(capture["completion_token_ids"])
    roles = capture.get("completion_token_roles")
    require(type(roles) is list and len(roles) == count and all(r in {"assistant_text", "assistant_tool_call"} for r in roles), "non_actor_targets")
    content = message.get("content")
    if "assistant_tool_call" in roles:
        require(type(content) is list and any(b.get("type") == "toolCall" for b in content if isinstance(b, dict)), "tool_tokens_without_tool_call")
    sampler = capture.get("sampler", {})
    require(sampler.get("distribution") == "actual_sampler" and type(sampler.get("settings")) is dict
            and sampler.get("all_generation_transforms_recorded") is True, "sampler_provenance")
    for key, upper in (("temperature", None), ("top_p", 1)):
        val = sampler["settings"].get(key)
        require(type(val) in {int, float} and math.isfinite(val) and val > 0 and (upper is None or val <= upper), "sampler_settings")
    behavior = capture.get("behavior_logprobs")
    if behavior is not None:
        _logprobs(behavior, count)
    expected = [0] * (len(capture["prompt_token_ids"]) - 1) + [1] * count
    if "loss_mask" in capture:
        require(capture["loss_mask"] == expected and all(type(v) is int for v in capture["loss_mask"]), "prompt_target_mask")
    return step


def actor_segment(capture):
    """Causal shift from captured IDs only; tool/learner context has zero mask."""
    prompt, completion = capture["prompt_token_ids"], capture["completion_token_ids"]
    tokens = prompt + completion
    return {"capture_hash": capture["capture_hash"], "prompt_token_ids": prompt,
            "completion_token_ids": completion, "completion_token_roles": capture["completion_token_roles"],
            "input_tokens": tokens[:-1], "target_tokens": tokens[1:],
            "loss_mask": [0] * (len(prompt) - 1) + [1] * len(completion),
            "behavior_logprobs": capture.get("behavior_logprobs"),
            "actor": capture["actor"], "tokenizer": capture["tokenizer"], "sampler": capture["sampler"],
            "capture_source": capture["source"], "request_hash": capture["request_hash"],
            "context_hash": capture["context_hash"]}


def _independent(review, captures, episodes):
    _sealed(review, "review_hash")
    require(review.get("schema_version") == 1 and _text(review.get("review_id"))
            and review.get("independent") is True and _text(review.get("rubric_revision")), "independent_review_required")
    reviewer = review.get("reviewer", {})
    require(reviewer.get("kind") in {"human", "independent_model", "authored_fixture"}
            and _text(reviewer.get("id")), "reviewer_provenance")
    _time(review.get("reviewed_at"))
    require((reviewer["kind"] == "authored_fixture") == all(e.value["measurement"] == "offline_integration" for e in episodes), "fixture_review_scope")
    if reviewer["kind"] == "independent_model":
        _model(reviewer.get("model"))
        name = reviewer["model"]["id"]
        require(all(name != c["actor"]["id"] for c in captures)
                and all(name != e.value["learner_policy"]["model"] for e in episodes), "self_review")


def feedback_packet(feature, review):
    """Build the exact packet to be scored by an external frozen teacher.

    Call with a validated retrospective feature and matching independent review.
    No outcome is inferred from a learner's prose or a delivery acknowledgement.
    """
    _sealed(feature, "feature_hash")
    _sealed(review, "review_hash")
    require(feature["boundary"] == "retrospective" and review.get("evidence_hash") == feature["feature_hash"], "feedback_boundary")
    return seal({"schema_version": 1, "feature_hash": feature["feature_hash"],
                 "review_hash": review["review_hash"], "input_events": feature["input_events"],
                 "review_feedback": review.get("feedback"), "outcome": None,
                 "outcome_status": "unknown"}, "feedback_hash")


def teacher_request(capture, packet, model, prompt_token_ids):
    """Project scoring envelope; the external scorer must record actual prefix IDs."""
    return {"model": model, "tokenizer": capture["tokenizer"],
            "original_request_hash": capture["request_hash"], "feedback": packet,
            "prompt_token_ids": prompt_token_ids, "completion_token_ids": capture["completion_token_ids"],
            "conditioning": "original_context_then_feedback_then_original_completion"}


def _teacher(capture, packet, teacher):
    _keys(teacher, "schema_version capture_hash teacher_hash model tokenizer prompt_token_ids completion_token_ids "
          "completion_logprobs feedback_hash original_request_hash conditioning frozen request_id response_id "
          "recorder_revision scoring_request_hash recorded_at_scoring captured_at")
    _sealed(teacher, "teacher_hash")
    _model(teacher.get("model"))
    _tokenizer(teacher.get("tokenizer"))
    require(teacher["tokenizer"] == capture["tokenizer"] and teacher["model"]["id"] == capture["actor"]["id"], "teacher_tokenizer_or_model")
    require(_tokens(teacher.get("prompt_token_ids")) and teacher.get("completion_token_ids") == capture["completion_token_ids"], "teacher_completion_alignment")
    _logprobs(teacher.get("completion_logprobs"), len(capture["completion_token_ids"]))
    require(teacher.get("feedback_hash") == packet["feedback_hash"]
            and teacher.get("capture_hash") == capture["capture_hash"]
            and teacher.get("original_request_hash") == capture["request_hash"]
            and teacher.get("conditioning") == "original_context_then_feedback_then_original_completion"
            and teacher.get("frozen") is True, "teacher_feedback_or_conditioning")
    require(teacher.get("schema_version") == 1 and teacher.get("recorded_at_scoring") is True
            and all(_text(teacher.get(k)) for k in ("request_id", "response_id", "recorder_revision"))
            and teacher.get("scoring_request_hash") == native_hash(teacher_request(
                capture, packet, teacher["model"], teacher["prompt_token_ids"])), "teacher_scoring_provenance")
    _time(teacher.get("captured_at"))
    return {**deepcopy(teacher), "loss_mask": [0] * (len(teacher["prompt_token_ids"]) - 1)
            + [1] * len(teacher["completion_token_ids"])}


def build_exports(episodes, captures=None, reviews=None):
    """Notebook/CLI API. Invalid evidence raises; absent evidence is unavailable.

    episodes: raw run-result dicts. captures/reviews: version-1 envelopes with
    respectively 'captures'/'reviews' arrays (or None). Never invokes a provider.
    """
    checked = [validate_episode(e) for e in episodes]
    require(checked, "no_episodes")
    by_identity = {(e.value["id"], e.value["branch_id"]): e for e in checked}
    require(len(by_identity) == len(checked), "duplicate_episode_branch")
    features = [f for e in checked for f in feature_inputs(e)]
    feature_map = {(f["episode_id"], f["branch_id"], f["event_id"], f["boundary"]): f for f in features}
    def feature_for(record, boundary):
        return feature_map.get((record["episode_id"], record["branch_id"], record["event_id"], boundary))
    envelopes = []
    teacher_rows = []
    for envelope, key in ((captures, "captures"), (reviews, "reviews")):
        if envelope is None:
            envelopes.append([])
        else:
            allowed = {"schema_version", key} | ({"teacher_captures"} if key == "captures" else set())
            require(type(envelope) is dict and set(envelope) <= allowed and {"schema_version", key} <= set(envelope)
                    and envelope["schema_version"] == 1 and type(envelope[key]) is list, f"{key}_envelope")
            if key == "captures":
                teacher_rows = deepcopy(envelope.get("teacher_captures", []))
                require(type(teacher_rows) is list, "teacher_captures_envelope")
            envelopes.append(deepcopy(envelope[key]))
    capture_rows, review_rows = envelopes
    cap_map, owners, positions, ids = {}, {}, set(), set()
    for capture in capture_rows:
        require(type(capture) is dict, "capture_object")
        owner = by_identity.get((capture.get("episode_id"), capture.get("branch_id")))
        require(owner is not None, "capture_wrong_branch")
        validate_capture(owner, capture)
        pos = (capture["episode_id"], capture["branch_id"], capture["event_id"], capture["message_index"])
        require(pos not in positions and capture["capture_id"] not in ids, "duplicate_capture")
        positions.add(pos); ids.add(capture["capture_id"])
        cap_map[capture["capture_hash"]], owners[capture["capture_hash"]] = capture, owner
    teachers = {}
    for teacher in teacher_rows:
        _sealed(teacher, "teacher_hash")
        key = teacher.get("capture_hash")
        require(key in cap_map and key not in teachers, "teacher_capture_ref")
        teachers[key] = teacher
    accepted, comparisons, review_ids = {}, [], set()
    for review in review_rows:
        require(type(review) is dict and review.get("review_id") not in review_ids, "duplicate_review")
        review_ids.add(review.get("review_id"))
        if review.get("kind") == "segment":
            _keys(review, "schema_version review_id kind capture_hash episode_id branch_id family event_id event_hash "
                  "payload_hash independent rubric_revision reviewer reviewed_at boundary evidence_hash latest_allowed_event_id "
                  "accepted review_hash", "feedback")
            capture = cap_map.get(review.get("capture_hash"))
            require(capture is not None, "review_missing_capture")
            owner = owners[capture["capture_hash"]]
            _independent(review, [capture], [owner])
            _pin(owner, review)
            require(review["event_id"] == capture["event_id"], "review_event_mismatch")
            feature = feature_for(capture, review.get("boundary"))
            require(review.get("boundary") in {"delivered", "retrospective"} and feature is not None
                    and review.get("evidence_hash") == feature["feature_hash"]
                    and review.get("latest_allowed_event_id") == feature["latest_allowed_event_id"], "review_temporal_boundary")
            require(type(review.get("accepted")) is bool, "review_decision")
            require(capture["capture_hash"] not in accepted, "duplicate_segment_review")
            accepted[capture["capture_hash"]] = review
        elif review.get("kind") == "preference":
            _keys(review, "schema_version review_id kind chosen_capture_hash rejected_capture_hash independent "
                  "rubric_revision reviewer reviewed_at boundary evidence_hash review_hash", "feedback")
            comparisons.append(review)
        else:
            raise ExportError("unknown_review_kind")
    result = {"schema_version": 1, "episodes": [{"id": e.value["id"], "branch_id": e.value["branch_id"],
               "family": e.value["family"], "ledger_head": e.value["ledger"][-1]["hash"],
               "runtime_hash": native_hash(e.value["runtime"]), "measurement": e.value["measurement"],
               "outcome": e.value["outcome"], "assessment": None} for e in checked],
              "observer_inputs": features, "sft": [], "policy_segments": [], "preferences": [], "hindsight": [], "availability": []}
    def unavailable(owner, event, projection, reason, **extra):
        result["availability"].append({**owner.ref(event), "projection": projection,
                                       "status": "unavailable", "reason": reason, **extra})
    for owner in checked:
        for step in owner.steps:
            if feature_for(owner.ref(step), "delivered") is None:
                unavailable(owner, step, "observer", "no_delivered_actor_action")
                continue
            payload = step["payload"]
            for index, message in enumerate(payload["messages"]):
                if index < payload["message_start_index"] or message.get("role") != "assistant":
                    continue
                pos = (owner.value["id"], owner.value["branch_id"], step["event_id"], index)
                if pos not in positions:
                    for projection in ("sft", "hindsight"):
                        unavailable(owner, step, projection, "missing_original_actor_capture", message_index=index)
    for key, capture in cap_map.items():
        owner = owners[key]; event = owner.events[capture["event_id"]]
        review = accepted.get(key)
        if key in teachers:
            require(review is not None and review["accepted"] and review["boundary"] == "retrospective",
                    "teacher_without_retrospective_acceptance")
            _teacher(capture, feedback_packet(feature_for(capture, "retrospective"), review), teachers[key])
        # A rejected demonstration can supply negative policy feedback. Keep its
        # decision explicit and separate from SFT acceptance; consumers must check
        # the sealed independent review and the sign of the requested update.
        if review is not None:
            eligible_policy = owner.value["measurement"] == "model_episode"
            result["policy_segments"].append({**owner.ref(event),
                "status": "available" if eligible_policy else "fixture_only",
                "training_eligible": eligible_policy, "review_hash": review["review_hash"],
                "review_decision": "accepted" if review["accepted"] else "rejected",
                "segment": actor_segment(capture)})
        if not review or not review["accepted"]:
            for projection in ("sft", "hindsight"):
                unavailable(owner, event, projection, "missing_independent_acceptance", capture_hash=key)
            continue
        eligible = owner.value["measurement"] == "model_episode"
        base = {**owner.ref(event), "status": "available" if eligible else "fixture_only",
                "training_eligible": eligible, "review_hash": review["review_hash"], "segment": actor_segment(capture)}
        result["sft"].append(deepcopy(base))
        reason = ("missing_behavior_logprobs" if capture.get("behavior_logprobs") is None else
                  "missing_retrospective_review" if review["boundary"] != "retrospective" else
                  "missing_teacher_capture" if key not in teachers else None)
        if reason:
            unavailable(owner, event, "hindsight", reason, capture_hash=key)
            continue
        packet = feedback_packet(feature_for(capture, "retrospective"), review)
        base.update({"feedback": packet, "teacher": _teacher(capture, packet, teachers[key]),
                     "outcome": None, "outcome_status": "unknown", "normalization": "per_action_masked_mean"})
        result["hindsight"].append(base)
    for review in comparisons:
        chosen, rejected = (cap_map.get(review.get(k)) for k in ("chosen_capture_hash", "rejected_capture_hash"))
        require(chosen is not None and rejected is not None and chosen is not rejected, "preference_capture_refs")
        a, b = owners[chosen["capture_hash"]], owners[rejected["capture_hash"]]
        _independent(review, [chosen, rejected], [a, b])
        require(a.value["family"] == b.value["family"] and a.value["source"] == b.value["source"]
                and a.value["branch_id"] != b.value["branch_id"], "preference_family_or_branch")
        require(all(chosen[k] == rejected[k] for k in ("context_hash", "prompt_token_ids", "tokenizer", "actor"))
                and a.value["runtime"]["source_hashes"] == b.value["runtime"]["source_hashes"], "preference_prefix_mismatch")
        require(chosen["completion_token_ids"] != rejected["completion_token_ids"], "preference_identical_completion")
        pair_features = [feature_for(c, review.get("boundary")) for c in (chosen, rejected)]
        require(review.get("boundary") in {"delivered", "retrospective"} and all(pair_features), "preference_boundary")
        require(review.get("evidence_hash") == native_hash({"chosen": pair_features[0]["feature_hash"],
                                                            "rejected": pair_features[1]["feature_hash"]}), "preference_evidence")
        eligible = a.value["measurement"] == b.value["measurement"] == "model_episode"
        result["preferences"].append({"family": a.value["family"], "review_hash": review["review_hash"],
            "status": "available" if eligible else "fixture_only", "training_eligible": eligible,
            "chosen_ref": a.ref(a.events[chosen["event_id"]]), "rejected_ref": b.ref(b.events[rejected["event_id"]]),
            "chosen": actor_segment(chosen), "rejected": actor_segment(rejected)})
    return seal(result, "export_hash")


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    def constant(_value):
        raise ExportError("nonfinite_json_number")
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=constant)


def inspect_exports(result):
    return {"schema_version": 1, "export_hash": result["export_hash"],
            "episodes": len(result["episodes"]), "observer_inputs": len(result["observer_inputs"]),
            "projections": {k: {"records": len(result[k]), "training_eligible": sum(r["training_eligible"] for r in result[k])}
                            for k in ("sft", "policy_segments", "preferences", "hindsight") if k in result},
            "unavailable": result["availability"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "export"))
    parser.add_argument("--episode", type=Path, action="append", required=True, help="Repeat for comparison branches")
    parser.add_argument("--captures", type=Path)
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--output", type=Path, help="New JSON file; existing files are never overwritten")
    args = parser.parse_args(argv)
    if args.command == "export" and args.output is None:
        parser.error("export requires --output")
    try:
        result = build_exports([load_json(p) for p in args.episode],
                               load_json(args.captures) if args.captures else None,
                               load_json(args.reviews) if args.reviews else None)
        summary = inspect_exports(result)
        if args.output:
            # Validate everything before opening; exclusive creation preserves other workers' artifacts.
            import os
            body = json.dumps(result if args.command == "export" else summary, ensure_ascii=True,
                              allow_nan=False, indent=2) + "\n"
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as target:
                target.write(body)
        print(json.dumps(summary))
        return 0
    except (ExportError, OSError, ValueError, KeyError, TypeError) as error:
        # Error types/codes suffice; never dump learner data or full provider requests.
        print(json.dumps({"status": "rejected", "reason": str(error) if isinstance(error, ExportError)
                          else type(error).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
