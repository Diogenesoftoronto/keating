"""Offline journal-to-NativeEvent binding. Never samples, tokenizes, or spends.

The three inline generation/parse/probability attestations are contracts for the
pinned sampling adapter. Existing unattested raw records remain unavailable.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys

import native_training as nt

VERSION = "native-capture-binding/v1"
PHASES = ("prepared", "sampled", "parsed")
SEMANTICS = "verified_actual_sampler"
ROLES = {"assistant_text", "assistant_tool_call"}


class BindingError(ValueError):
    """Malformed, contradictory, missing, or ambiguous binding evidence."""


def require(condition, code):
    if not condition:
        raise BindingError(code)


def text(value):
    return type(value) is str and bool(value.strip())


def digest(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def sealed(value, field):
    require(type(value) is dict and value.get(field) == nt.native_hash(
        {k: v for k, v in value.items() if k != field}), "invalid_" + field)


def journal_hash(value):
    """native_capture.append_capture uses Python JSON, insertion order preserved.

    Do not replace this with native_hash: the producer's float formatting differs.
    """
    body = {k: v for k, v in value.items() if k != "record_sha256"}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, allow_nan=False,
                                    separators=(",", ":")).encode()).hexdigest()


def bridge_hash(value):
    """Exact benchmark_tinker_bridge.digest convention, without importing it."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def _constant(_):
    raise BindingError("nonfinite_json_number")


def load_journal(path):
    """Read, never repair/rewrite, original JSONL with duplicate-key rejection."""
    with Path(path).open() as stream:
        return [json.loads(line, object_pairs_hook=_pairs, parse_constant=_constant)
                for line in stream if line.strip()]


def _stamp(value):
    require(text(value), "journal_timestamp_required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise BindingError("invalid_journal_timestamp") from None
    require(parsed.tzinfo is not None, "journal_timezone_required")
    return parsed


def _tokens(value):
    return type(value) is list and bool(value) and all(type(v) is int and 0 <= v < 2**31 for v in value)


def _groups(records):
    require(type(records) is list and records, "missing_journal_records")
    groups = defaultdict(list)
    for record in records:
        require(type(record) is dict and record.get("schema_version") == 1
                and record.get("phase") in PHASES and text(record.get("response_id")), "journal_record_schema")
        require(record.get("record_sha256") == journal_hash(record), "journal_hash_mismatch")
        require(record.get("training_eligible") is False and all(text(record.get(k)) for k in ("base_model", "renderer"))
                and all(digest(record.get(k)) for k in ("request_sha256", "recorder_sha256", "capture_helper_sha256")), "raw_journal_provenance")
        _stamp(record.get("captured_at"))
        groups[record["response_id"]].append(record)
    for rows in groups.values():
        require([r["phase"] for r in rows] == list(PHASES), "missing_duplicate_or_reordered_journal_phase")
        first = rows[0]
        for row in rows[1:]:
            require(all(row[k] == first[k] for k in ("response_id", "request_sha256", "base_model", "renderer",
                        "recorder_sha256", "capture_helper_sha256")), "mixed_journal_provenance")
        require(all(_stamp(a["captured_at"]) <= _stamp(b["captured_at"]) for a, b in zip(rows, rows[1:])), "journal_time_reversal")
        require(type(first.get("original_request")) is dict and bridge_hash(first["original_request"]) == first["request_sha256"], "original_request_hash")
    return groups


def _runtime_index(episodes):
    """Response IDs join occurrences. Numeric provider call indices are local to
    an episode and need not equal the position in runtime.requests.
    """
    responses = defaultdict(list)
    identities = set()
    for episode in episodes:
        identity = (episode.value["id"], episode.value["branch_id"])
        require(identity not in identities, "duplicate_episode_branch")
        identities.add(identity)
        runtime = episode.value["runtime"]
        require(runtime.get("source_provenance", {}).get("unchanged_at_end") is True
                and runtime["source_provenance"].get("changed_paths") == [], "runtime_source_not_stable")
        receipts = runtime.get("receipts")
        require(type(receipts) is list and all(type(r) is dict for r in receipts), "runtime_receipts_required")
        requests = [(position, r) for position, r in enumerate(receipts) if r.get("kind") == "provider_request"]
        require(nt.native_hash([r for _, r in requests]) == nt.native_hash(runtime["requests"]), "runtime_requests_not_receipt_projection")
        by_index = {}
        for request_index, (receipt_index, request) in enumerate(requests):
            data = request.get("data", {})
            index = data.get("index")
            require(type(index) is int and index >= 0 and index not in by_index, "duplicate_or_invalid_provider_request_index")
            require(type(data.get("context")) is dict and type(data["context"].get("messages")) is list
                    and type(data.get("payload")) is dict, "provider_payload_and_full_context_required")
            by_index[index] = (request_index, receipt_index, request)
        response_indices = set()
        for receipt_index, response in enumerate(receipts):
            if response.get("kind") != "provider_response":
                continue
            data = response.get("data", {})
            index, response_id = data.get("index"), data.get("response_id")
            require(type(index) is int and index in by_index and index not in response_indices, "missing_duplicate_or_ambiguous_provider_response")
            response_indices.add(index)
            request_index, request_receipt_index, request = by_index[index]
            require(request_receipt_index < receipt_index and text(response_id) and digest(data.get("message_sha256")), "provider_response_identity_required")
            messages = []
            for step in episode.steps:
                payload = step["payload"]
                if payload["kind"] not in {"message", "ui_action"}:
                    continue
                for message_index in range(payload["message_start_index"], len(payload["messages"])):
                    message = payload["messages"][message_index]
                    if message.get("role") == "assistant" and message.get("responseId") == response_id:
                        messages.append((step, message_index, message))
            require(len(messages) == 1, "missing_or_ambiguous_actor_response_id")
            step, message_index, message = messages[0]
            require(nt.native_hash(message) == data["message_sha256"]
                    and data.get("stop_reason") == message.get("stopReason"), "provider_response_message_hash")
            require(nt.native_hash(request["data"]["context"]["messages"]) == nt.native_hash(step["payload"]["messages"][:message_index]), "request_context_not_actor_prefix")
            require(message.get("provider") == request["data"].get("model", {}).get("provider")
                    and message.get("model") == request["data"].get("model", {}).get("id"), "runtime_actor_model_mismatch")
            actor_events = [e for e in episode.events.values() if e["kind"] == "actor_message"
                            and e["payload"].get("step") == step["payload"]["index"]
                            and e["payload"].get("message", {}).get("responseId") == response_id]
            require(len(actor_events) == 1 and nt.native_hash(actor_events[0]["payload"]["message"]) == nt.native_hash(message), "actor_event_occurrence_mismatch")
            responses[response_id].append({"episode": episode, "step": step, "message_index": message_index,
                "message": message, "actor_event": actor_events[0], "request_index": request_index,
                "provider_call_index": index, "request": request, "provider_response": response,
                "provider_response_receipt_index": receipt_index})
    require(all(len(v) == 1 for v in responses.values()), "cross_episode_ambiguous_response_id")
    return {key: rows[0] for key, rows in responses.items()}


def _parsed_matches(parsed, message):
    """Compare OpenAI-to-Pi content losslessly; no string/token reconstruction.

    Pi's provider/usage/signature metadata is pinned by its full message hash.
    Only text and function calls are supported for this first binding contract.
    """
    require(type(parsed) is dict and set(parsed) <= {"role", "content", "tool_calls"}
            and parsed.get("role") == "assistant" and (parsed.get("content") is None or type(parsed["content"]) is str), "parsed_message_schema")
    content = message.get("content")
    require(type(content) is list, "pi_content_schema")
    if any(type(b) is not dict or b.get("type") not in {"text", "toolCall"} for b in content):
        return False
    text_parts, native_calls = [], []
    for block in content:
        if block["type"] == "text":
            require(type(block.get("text")) is str, "pi_text_schema")
            text_parts.append(block["text"])
        else:
            require(all(text(block.get(k)) for k in ("id", "name")) and type(block.get("arguments")) is dict, "pi_tool_call_schema")
            native_calls.append({k: block[k] for k in ("id", "name", "arguments")})
    calls = parsed.get("tool_calls", [])
    require(type(calls) is list, "parsed_tool_calls_schema")
    openai_calls = []
    for call in calls:
        require(type(call) is dict and set(call) == {"id", "type", "function"}
                and call["type"] == "function" and text(call["id"])
                and type(call["function"]) is dict and set(call["function"]) == {"name", "arguments"}
                and text(call["function"]["name"]) and type(call["function"]["arguments"]) is str, "parsed_tool_call_schema")
        arguments = json.loads(call["function"]["arguments"], object_pairs_hook=_pairs, parse_constant=_constant)
        require(type(arguments) is dict, "parsed_tool_arguments_object")
        openai_calls.append({"id": call["id"], "name": call["function"]["name"], "arguments": arguments})
    require(len({c["id"] for c in openai_calls}) == len(openai_calls), "duplicate_tool_call_id")
    require("".join(text_parts) == (parsed.get("content") or "")
            and nt.native_hash(native_calls) == nt.native_hash(openai_calls), "parsed_message_not_delivered_message")
    return True


def _revision(value):
    return type(value) is str and (re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value) is not None
        or (re.fullmatch(r"tinker://[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/sampler_weights/[A-Za-z0-9_.-]+", value) is not None
            and value.rsplit("/", 1)[-1] not in {"latest", "current", "recent"}))


def _generation(prepared, occurrence):
    value = prepared.get("generation_attestation")
    if value is None:
        return None
    sealed(value, "generation_hash")
    require(value.get("schema_version") == 1 and value.get("kind") in {"provider_capture", "authored_fixture"}
            and value.get("recorded_before_sample") is True, "generation_attestation_schema")
    require(value.get("response_id") == prepared["response_id"] and value.get("request_sha256") == prepared["request_sha256"]
            and value.get("prompt_token_ids_hash") == nt.native_hash(prepared["prompt_token_ids"])
            and value.get("sampling_params_hash") == nt.native_hash(prepared["sampling_params"]), "generation_input_pin")
    actor, native, tokenizer, renderer = (value.get(k, {}) for k in ("actor", "native_model", "tokenizer", "renderer"))
    require(all(text(actor.get(k)) for k in ("provider", "id")) and _revision(actor.get("revision"))
            and native.get("id") == prepared["base_model"] and native.get("revision") == actor["revision"], "pinned_actor_required")
    require(all(actor[k] == occurrence["request"]["data"]["model"].get(k) for k in ("provider", "id")), "actor_alias_cannot_be_rewritten")
    require(text(tokenizer.get("id")) and _revision(tokenizer.get("revision"))
            and digest(tokenizer.get("chat_template_hash")), "pinned_tokenizer_required")
    require(renderer.get("id") == prepared["renderer"] and _revision(renderer.get("revision"))
            and _revision(renderer.get("parser_revision")) and digest(renderer.get("source_sha256")), "pinned_renderer_required")
    fixture = occurrence["episode"].value["measurement"] == "offline_integration"
    require((value["kind"] == "authored_fixture") == fixture, "fixture_cannot_claim_provider_origin")
    return value


def _roles(parsed, sampled, generation):
    value = parsed.get("token_role_attestation")
    if value is None:
        return None
    sealed(value, "roles_hash")
    require(value.get("schema_version") == 1 and value.get("source") == "original_completion_token_spans"
            and value.get("recorded_at_parse") is True, "parser_owned_roles_required")
    require(value.get("generation_hash") == generation["generation_hash"]
            and value.get("completion_token_ids_hash") == nt.native_hash(sampled["completion_token_ids"])
            and value.get("parsed_message_hash") == nt.native_hash(parsed["message"])
            and value.get("parser_revision") == generation["renderer"]["parser_revision"], "original_token_role_pin")
    roles = value.get("roles")
    require(type(roles) is list and len(roles) == len(sampled["completion_token_ids"])
            and all(r in ROLES or r is None for r in roles), "token_role_alignment")
    require(sampled.get("token_roles") is None or sampled["token_roles"] == roles, "contradictory_original_roles")
    require(parsed.get("token_roles") is None or parsed["token_roles"] == roles, "contradictory_parser_roles")
    return value


def _probabilities(sampled, prepared, generation):
    value = sampled.get("probability_attestation")
    if value is None:
        return None
    sealed(value, "probability_hash")
    require(value.get("schema_version") == 1 and value.get("recorded_at_sampling") is True
            and value.get("semantics") == "actual_sampler" and sampled.get("probability_semantics") == SEMANTICS,
            "probability_semantics_not_verified")
    require(value.get("generation_hash") == generation["generation_hash"]
            and value.get("completion_token_ids_hash") == nt.native_hash(sampled["completion_token_ids"])
            and value.get("logprobs_hash") == nt.native_hash(sampled.get("provider_logprobs"))
            and value.get("sampling_params_hash") == nt.native_hash(prepared["sampling_params"]), "actual_sampler_probability_pin")
    evidence = value.get("evidence", {})
    require(all(text(evidence.get(k)) for k in ("source", "revision")) and digest(evidence.get("sha256")), "probability_evidence_required")
    require(value.get("all_generation_transforms_recorded") is True, "sampling_transforms_unavailable")
    return value


def bind_captures(episodes, records):
    """Pure binder API. Returns captures envelope, binding records and a seal.

    Each supplied journal response must join exactly once; scope journal/episodes
    explicitly. Missing/ambiguous joins are errors, unavailable attestations are
    status rows. Never import the SDK or rewrite raw evidence.
    """
    episodes, records = deepcopy((episodes, records))
    require(type(episodes) is list and episodes, "episodes_required")
    checked = [nt.validate_episode(e) for e in episodes]
    groups, occurrences = _groups(records), _runtime_index(checked)
    require(set(groups) == set(occurrences), "missing_journal_or_runtime_response")
    captures, bindings = [], []
    for response_id, rows in groups.items():
        prepared, sampled, parsed = rows
        occurrence = occurrences[response_id]
        episode, step = occurrence["episode"], occurrence["step"]
        request, message = occurrence["request"], occurrence["message"]
        require(bridge_hash(request["data"]["payload"]) == prepared["request_sha256"]
                and nt.native_hash(request["data"]["payload"]) == nt.native_hash(prepared["original_request"]), "bridge_runtime_payload_mismatch")
        require(_tokens(prepared.get("prompt_token_ids")) and _tokens(sampled.get("completion_token_ids")), "original_token_ids_unavailable")
        require(("sequence_count" not in sampled and "sequence_index" not in sampled)
                or (type(sampled.get("sequence_count")) is int and sampled["sequence_count"] == 1
                    and type(sampled.get("sequence_index")) is int and sampled["sequence_index"] == 0),
                "ambiguous_sampled_sequence")
        require(type(prepared.get("sampling_params")) is dict and prepared.get("num_samples") == 1
                and prepared.get("include_prompt_logprobs") is False and prepared.get("topk_prompt_logprobs") == 0, "full_sampling_request_required")
        params = prepared["sampling_params"]
        require({"max_tokens", "temperature", "top_p", "top_k", "seed", "stop"} <= set(params), "full_sampling_params_required")
        require(type(params.get("max_tokens")) is int and params["max_tokens"] > 0
                and len(sampled["completion_token_ids"]) <= params["max_tokens"], "completion_limit_alignment")
        body = prepared["original_request"]
        require(not ("max_tokens" in body and "max_completion_tokens" in body)
                and params["max_tokens"] == body.get("max_tokens", body.get("max_completion_tokens"))
                and all(params[k] == body.get(k, 1.0) for k in ("temperature", "top_p"))
                and ("seed" not in body or params["seed"] == body["seed"]), "sampler_payload_settings_mismatch")
        require(type(params["top_k"]) is int and (params["top_k"] == -1 or params["top_k"] > 0)
                and (params["seed"] is None or type(params["seed"]) is int), "sampling_parameters")
        for key in ("temperature", "top_p"):
            value = params.get(key)
            require(type(value) in {int, float} and math.isfinite(value) and value >= 0
                    and (key != "top_p" or 0 < value <= 1), "sampling_parameters")
        behavior = sampled.get("provider_logprobs")
        if behavior is not None:
            require(type(behavior) is list and len(behavior) == len(sampled["completion_token_ids"])
                    and all(type(v) in {int, float} and math.isfinite(v) and v <= 0 for v in behavior), "raw_probability_alignment_or_value")
        require(type(parsed.get("parse_finished")) is bool, "parse_status_required")
        supported = _parsed_matches(parsed.get("message"), message)
        delivery = episode.deliveries.get(step["event_id"])
        generation = _generation(prepared, occurrence)
        roles = _roles(parsed, sampled, generation) if generation else None
        probabilities = _probabilities(sampled, prepared, generation) if generation else None
        require(generation is not None or (parsed.get("token_role_attestation") is None
                and sampled.get("probability_attestation") is None), "orphan_generation_attestation")
        reasons = []
        if generation is None:
            reasons.append("missing_generation_attestation")
        if roles is None or any(r is None for r in roles["roles"]):
            reasons.append("original_parser_token_roles_unavailable")
        if probabilities is None:
            reasons.append("actual_sampler_semantics_unverified")
        if behavior is None:
            reasons.append("missing_original_behavior_logprobs")
        if not parsed["parse_finished"] or not supported:
            reasons.append("unsupported_or_incomplete_parser_output")
        if sampled.get("stop_reason") != "stop":
            reasons.append("completion_did_not_stop_cleanly")
        if parsed.get("original_token_capture_eligible") is False or parsed.get("unavailable_reasons"):
            reasons.append("generating_adapter_marked_capture_unavailable")
        if delivery is None or message.get("stopReason") in {"error", "aborted"}:
            reasons.append("actor_action_not_delivered")
        if params["temperature"] == 0:
            reasons.append("greedy_sampler_not_supported_by_export_contract")
        binding = {"response_id": response_id, **episode.ref(step), "status": "unavailable", "reasons": reasons,
            "runtime_hash": nt.native_hash(episode.value["runtime"]),
            "request_index": occurrence["request_index"], "provider_call_index": occurrence["provider_call_index"],
            "request_hash": nt.native_hash(request), "context_hash": nt.native_hash(request["data"]["context"]),
            "payload_sha256": prepared["request_sha256"], "message_index": occurrence["message_index"],
            "message_hash": nt.native_hash(message), "actor_event_id": occurrence["actor_event"]["event_id"],
            "actor_event_hash": occurrence["actor_event"]["hash"], "delivery_event_hash": delivery["hash"] if delivery else None,
            "provider_response_receipt_index": occurrence["provider_response_receipt_index"],
            "provider_response_hash": nt.native_hash(occurrence["provider_response"]),
            "raw_record_hashes": {r["phase"]: r["record_sha256"] for r in rows}, "capture_hash": None,
            "outcome": None, "outcome_status": "unknown"}
        if not reasons:
            source = {"kind": generation["kind"], "recorded_at_generation": True,
                "recorder_revision": prepared["recorder_sha256"], "request_id": response_id, "response_id": response_id,
                "id_namespace": "bridge", "captured_at": sampled["captured_at"],
                "renderer": generation["renderer"], "native_model": generation["native_model"],
                "generation_hash": generation["generation_hash"], "roles_hash": roles["roles_hash"],
                "probability_hash": probabilities["probability_hash"], "raw_record_hashes": binding["raw_record_hashes"]}
            capture = nt.seal({"schema_version": 1, "capture_id": "bound-" + nt.native_hash(binding), **episode.ref(step),
                **{k: binding[k] for k in ("delivery_event_hash", "runtime_hash", "message_index", "message_hash",
                                         "actor_event_id", "actor_event_hash", "request_index", "request_hash", "context_hash")},
                "actor": generation["actor"], "tokenizer": generation["tokenizer"], "source": source,
                "prompt_token_ids": prepared["prompt_token_ids"], "completion_token_ids": sampled["completion_token_ids"],
                "completion_token_roles": roles["roles"], "behavior_logprobs": behavior,
                "sampler": {"distribution": "actual_sampler", "all_generation_transforms_recorded": True,
                            "settings": params}}, "capture_hash")
            nt.validate_capture(episode, capture)
            captures.append(capture)
            binding.update(status="fixture_only" if generation["kind"] == "authored_fixture" else "available", capture_hash=capture["capture_hash"])
        bindings.append(binding)
    return nt.seal({"schema_version": 1, "binder": VERSION,
        "captures": {"schema_version": 1, "captures": captures, "teacher_captures": []},
        "bindings": bindings}, "binding_hash")


def summarize(result):
    return {"binding_hash": result["binding_hash"], "responses": len(result["bindings"]),
        "captures": len(result["captures"]["captures"]),
        "status_counts": {status: sum(b["status"] == status for b in result["bindings"])
                          for status in ("available", "fixture_only", "unavailable")},
        "unavailable_reasons": sorted({r for b in result["bindings"] for r in b["reasons"]})}


def _write(path, value):
    # Output directory is new and private; each file must also be new.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(nt.native_json(value) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "export"))
    parser.add_argument("--episode", type=Path, action="append", required=True)
    parser.add_argument("--journal", type=Path, action="append", required=True)
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        episodes = [nt.load_json(path) for path in args.episode]
        result = bind_captures(episodes, [row for path in args.journal for row in load_journal(path)])
        exports = nt.build_exports(episodes, result["captures"], nt.load_json(args.reviews) if args.reviews else None)
        if args.command == "export":
            require(args.output is not None and not args.output.exists(), "new_output_directory_required")
            args.output.mkdir(parents=True, mode=0o700, exist_ok=False)
            _write(args.output / "bindings.json", result)
            _write(args.output / "captures.json", result["captures"])
            _write(args.output / "exports.json", exports)
        print(nt.native_json({**summarize(result), "export_hash": exports["export_hash"]}))
        return 0
    except (BindingError, nt.ExportError) as error:
        code = str(error)
        print("capture binding rejected: " + (code if re.fullmatch(r"[a-z0-9_]+", code) else "invalid_evidence"), file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError):
        print("capture binding rejected: malformed_evidence_or_io_failure", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
