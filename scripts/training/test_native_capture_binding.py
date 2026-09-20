"""Entirely authored ledger/journal attestations. No real model calls or data.

Fixture captures retain kind=authored_fixture and can never become live training
examples. The real journal writer and exporter are exercised without an SDK.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import native_capture_binding as nb
from native_capture import append_capture
import native_training as nt
import test_native_training as fixtures


def _parsed(message):
    result = {"role": "assistant", "content": "".join(b["text"] for b in message["content"] if b["type"] == "text")}
    calls = [{"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["arguments"])}}
             for b in message["content"] if b["type"] == "toolCall"]
    if calls:
        result["tool_calls"] = calls
    return result


def raw_record(common, **values):
    result = {"schema_version": 1, "captured_at": fixtures.STAMP, **common, **values}
    result["record_sha256"] = nb.journal_hash(result)
    return result


def fixture(attested=True, branch="a"):
    episode = fixtures.fixture_episode(branch)
    messages = [e["payload"]["message"] for e in episode["ledger"] if e["kind"] == "actor_message"]
    ids = {nt.native_hash(m): f"authored-response-{i}" for i, m in enumerate(messages)}
    def with_id(message):
        value = deepcopy(message)
        if value.get("role") == "assistant":
            value["responseId"] = ids[nt.native_hash(message)]
        return value
    for event in episode["ledger"]:
        if event["kind"] == "runtime_step":
            event["payload"]["messages"] = [with_id(m) for m in event["payload"]["messages"]]
        elif event["kind"] == "actor_message":
            event["payload"]["message"] = with_id(event["payload"]["message"])
    requests, receipts, records = [], [], []
    for index, request in enumerate(episode["runtime"]["requests"]):
        request = deepcopy(request)
        message = with_id(messages[index])
        data = request["data"]
        data["index"] = 7 + index * 4  # occurrence index deliberately differs
        data["context"]["messages"] = [with_id(m) for m in data["context"]["messages"]]
        body = {"model": fixtures.MODEL["id"], "messages": [{"role": "user", "content": "AUTHORED_REQUEST_" + str(index)}],
                "max_tokens": 10, "temperature": 1, "top_p": 1}
        data["payload"] = body
        requests.append(request)
        receipts.extend([{"kind": "provider_attempt", "data": {"index": data["index"]}}, request,
            {"kind": "provider_response", "data": {"index": data["index"], "response_id": message["responseId"],
                "message_sha256": nt.native_hash(message), "stop_reason": message["stopReason"]}}])
        common = {"response_id": message["responseId"], "request_sha256": nb.bridge_hash(body),
                  "base_model": fixtures.MODEL["id"], "renderer": "authored-renderer",
                  "recorder_sha256": "c" * 64, "capture_helper_sha256": "d" * 64, "training_eligible": False}
        prompt, completion = [10 + index, 11, 12], [20 + index, 21, 22]
        params = {"max_tokens": 10, "temperature": 1.0, "top_p": 1.0, "top_k": -1, "stop": [999], "seed": None}
        generation = nt.seal({"schema_version": 1, "kind": "authored_fixture", "response_id": message["responseId"],
            "request_sha256": common["request_sha256"], "recorded_before_sample": True,
            "actor": {**fixtures.MODEL, "revision": "a" * 40},
            "native_model": {"id": fixtures.MODEL["id"], "revision": "a" * 40},
            "tokenizer": {"id": "authored-tokenizer", "revision": "b" * 40, "chat_template_hash": "b" * 64},
            "renderer": {"id": "authored-renderer", "revision": "e" * 40, "parser_revision": "f" * 40, "source_sha256": "e" * 64},
            "prompt_token_ids_hash": nt.native_hash(prompt), "sampling_params_hash": nt.native_hash(params)}, "generation_hash")
        role_list = ["assistant_text", "assistant_tool_call", "assistant_tool_call"] if index == 0 else ["assistant_text"] * 3
        parsed = _parsed(message)
        roles = nt.seal({"schema_version": 1, "source": "original_completion_token_spans", "recorded_at_parse": True,
            "generation_hash": generation["generation_hash"], "completion_token_ids_hash": nt.native_hash(completion),
            "parsed_message_hash": nt.native_hash(parsed), "parser_revision": "f" * 40, "roles": role_list}, "roles_hash")
        logprobs = [-0.2, -1.0, -0.5]
        probability = nt.seal({"schema_version": 1, "recorded_at_sampling": True, "semantics": "actual_sampler",
            "generation_hash": generation["generation_hash"], "completion_token_ids_hash": nt.native_hash(completion),
            "logprobs_hash": nt.native_hash(logprobs), "sampling_params_hash": nt.native_hash(params),
            "all_generation_transforms_recorded": True,
            "evidence": {"source": "AUTHORED_UNIT_TEST_ONLY", "revision": "fixture-v1", "sha256": "f" * 64}}, "probability_hash")
        records += [raw_record(common, phase="prepared", original_request=body, prompt_token_ids=prompt, sampling_params=params,
                              num_samples=1, include_prompt_logprobs=False, topk_prompt_logprobs=0,
                              **({"generation_attestation": generation} if attested else {})),
                    raw_record(common, phase="sampled", completion_token_ids=completion, provider_logprobs=logprobs,
                               stop_reason="stop", token_roles=None,
                               probability_semantics=nb.SEMANTICS if attested else "provider_reported_not_yet_verified_as_actual_sampler",
                               **({"probability_attestation": probability} if attested else {})),
                    raw_record(common, phase="parsed", message=parsed, parse_finished=True,
                               **({"token_role_attestation": roles} if attested else {}))]
    episode["runtime"].update(requests=requests, receipts=receipts)
    fixtures.reseal_episode(episode)
    return deepcopy(episode), deepcopy(records)


def rehash(records):
    for record in records:
        for name, key in (("generation_attestation", "generation_hash"), ("token_role_attestation", "roles_hash"),
                          ("probability_attestation", "probability_hash")):
            if name in record:
                record[name] = nt.seal(record[name], key)
        record["record_sha256"] = nb.journal_hash(record)


def sampler_binding_fixture(directory, missing_logprobs=False):
    """Run the actual bridge journal writer and role wrapper with authored doubles.

    Runtime receipts are explicitly authored offline fixtures. No journal field,
    attestation, or original array is patched after the bridge emitted it.
    """
    import native_tinker_sampler as ns
    from native_tinker_update import BudgetLedger

    model = {"provider": "tinker", "id": ns.MODEL, "revision": "authored-fixture"}
    with patch.object(fixtures, "MODEL", model):
        episode = fixtures.fixture_episode(reply="")
    calls = []
    captures = []
    runtime = episode["runtime"]
    config = ns.sampler_config()
    config["model"]["sampler_checkpoint"] = "tinker://authored-fixture:train:0/sampler_weights/frozen-001"
    config["allocation"] = {"id": "authored-local-grant", "ledger_path": str(directory / "allocation.json"),
        "budget_project_id": "authored-interop", "cap_usd": "1"}
    config = nt.seal(config, "config_hash")
    ledger = BudgetLedger(directory / "allocation.json", "authored-interop", ns.MODEL, "1")
    with ledger.locked(): pass  # temporary authored allocation, never shared money

    class FakeSampler:
        evidence_kind = "authored_fixture"
        audit = {"kind": "authored_fixture", "scope": "no real model or provider evidence"}

        def __init__(self, _): self.index = -1

        def prepare(self, messages, tools):
            self.index += 1
            self.prompt = [31, 32 + self.index, 33]
            self.ids = ([ns.TOOL_OPEN, 41, ns.TOOL_CLOSE, ns.IM_END] if self.index == 0 else [51, 52, ns.IM_END])
            self.lps = None if missing_logprobs else [-0.25] * len(self.ids)
            captures.append({"prompt": list(self.prompt), "completion": list(self.ids), "logprobs": self.lps})
            return NS(to_ints=lambda: list(self.prompt))

        def params(self, settings):
            return NS(model_dump=lambda **_: {**settings, "stop": [ns.IM_END], "seed": settings.get("seed")})

        def connect(self):
            run = list(nt.load_json(ledger.path)["runs"].values())[-1]
            assert run["dispatched"] == ["create_client"]
            calls.append("connect")
            return self

        def sample(self, prompt, **kwargs):
            assert prompt.to_ints() == self.prompt
            assert kwargs["num_samples"] == 1 and kwargs["include_prompt_logprobs"] is False
            run = list(nt.load_json(ledger.path)["runs"].values())[-1]
            assert run["dispatched"][-1] == "sample"
            # Prepared evidence must already be durable before this mock dispatch.
            assert nb.load_journal(bridge.raw_path)[-1]["phase"] == "prepared"
            calls.append("sample")
            sequence = NS(tokens=list(self.ids), logprobs=self.lps, stop_reason="stop", sequence_id="authored-sequence")
            return NS(result=lambda **_: NS(sequences=[sequence]))

        def parse(self, tokens):
            assert nb.load_journal(bridge.raw_path)[-1]["phase"] == "sampled"
            assert tokens == self.ids
            calls.append("parse")
            if self.index == 0:
                raw = "<tool_call><function=read><parameter=path>fixtures/task.txt</parameter></function></tool_call>"
                function = {"name": "read", "arguments": '{"path":"fixtures/task.txt"}'}
                message = {"content": "", "tool_calls": [NS(model_dump=lambda **_: {"function": function})]}
            else:
                raw = "LATER_TUTOR_MUST_NOT_LEAK"
                message = {"content": raw}
            def decode(ids, **kwargs):
                assert ids == self.ids[:-1]
                assert kwargs == {"skip_special_tokens": False, "clean_up_tokenization_spaces": False}
                return raw
            # No encode method exists: reconstructing token IDs would fail here.
            tokenizer = NS(all_special_ids=[ns.IM_END, ns.TOOL_OPEN, ns.TOOL_CLOSE], decode=decode)
            renderer = NS(parse_response=lambda ids: (message, NS(is_clean=True)))
            return ns.parse_original_completion(tokens, tokenizer, renderer)

    bridge = ns.QwenCaptureBridge(config, b"AUTHORED-private-bearer-" * 2, directory / "bridge", sampler_factory=FakeSampler)
    requests, receipts = [], []

    def openai(message):
        if message["role"] == "assistant": return _parsed(message)
        content = "".join(block["text"] for block in message["content"])
        if message["role"] == "toolResult":
            return {"role": "tool", "tool_call_id": message["toolCallId"], "content": content}
        return {"role": message["role"], "content": content}

    for index in range(sum(e["kind"] == "runtime_step" for e in episode["ledger"])):
        step = [e for e in episode["ledger"] if e["kind"] == "runtime_step"][index]
        message_index, old = next((i, m) for i, m in enumerate(step["payload"]["messages"])
                                  if i >= step["payload"]["message_start_index"] and m["role"] == "assistant")
        context = {"systemPrompt": "An authored tutor fixture.", "messages": deepcopy(step["payload"]["messages"][:message_index]),
                   "tools": [{"name": "read", "description": "Read the task."}]}
        body = {"model": ns.MODEL, "messages": [{"role": "system", "content": context["systemPrompt"]},
                *[openai(m) for m in context["messages"]]], "max_tokens": 20,
                "tools": [{"type": "function", "function": {"name": "read", "description": "Read the task.",
                    "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}]}
        response = bridge.complete(body)
        parsed = response["choices"][0]["message"]
        content = [{"type": "text", "text": parsed["content"]}] if parsed.get("content") else []
        content += [{"type": "toolCall", "id": c["id"], "name": c["function"]["name"],
                     "arguments": json.loads(c["function"]["arguments"])} for c in parsed.get("tool_calls", [])]
        delivered = {**old, "content": content, "responseId": response["id"]}
        old_hash = nt.native_hash(old)
        tool_id = content[0]["id"] if index == 0 else None

        def replace(value):
            if type(value) is list: return [replace(v) for v in value]
            if type(value) is not dict: return value
            if value.get("role") == "assistant" and nt.native_hash(value) == old_hash: return deepcopy(delivered)
            if tool_id and value.get("type") == "toolCall" and value.get("id") == "call-0":
                return {**value, "id": tool_id}
            if tool_id and value.get("role") == "toolResult" and value.get("toolCallId") == "call-0":
                return {**value, "toolCallId": tool_id}
            return {k: replace(v) for k, v in value.items()}

        # Author runtime evidence around the actual mock bridge response, including
        # repeated history and tool receipts, never around fabricated journal IDs.
        episode["ledger"] = replace(episode["ledger"])
        provider_index = 9 + index * 4
        request = {"kind": "provider_request", "data": {"index": provider_index,
            "model": {"provider": "tinker", "id": ns.MODEL}, "context": context, "payload": deepcopy(body)}}
        requests.append(request)
        receipts.extend([deepcopy(request), {"kind": "provider_response", "data": {"index": provider_index,
            "response_id": response["id"], "message_sha256": nt.native_hash(delivered), "stop_reason": delivered["stopReason"]}}])

    runtime.update(requests=requests, receipts=receipts)
    fixtures.reseal_episode(episode)
    return episode, nb.load_journal(bridge.raw_path), bridge.raw_path, calls, captures


class NativeCaptureBindingTests(unittest.TestCase):
    def test_authored_capture_binds_actual_request_response_and_exports_fixture_only(self):
        episode, records = fixture()
        original = deepcopy((episode, records))
        result = nb.bind_captures([episode], records)
        self.assertEqual((episode, records), original)
        self.assertEqual(nb.summarize(result)["status_counts"], {"available": 0, "fixture_only": 2, "unavailable": 0})
        captures = result["captures"]["captures"]
        for index, (binding, capture) in enumerate(zip(result["bindings"], captures)):
            self.assertEqual(binding["request_index"], index)
            self.assertEqual(binding["provider_call_index"], 7 + index * 4)
            self.assertEqual(capture["source"]["kind"], "authored_fixture")
            self.assertEqual(capture["source"]["id_namespace"], "bridge")
            self.assertEqual(capture["completion_token_ids"], records[index*3+1]["completion_token_ids"])
            self.assertEqual(capture["behavior_logprobs"], records[index*3+1]["provider_logprobs"])
            self.assertEqual(capture["request_hash"], nt.native_hash(episode["runtime"]["requests"][index]))
            nt.validate_capture(nt.validate_episode(episode), capture)
            self.assertIsNone(binding["outcome"])
        review = fixtures.fixture_review(episode, captures[0])
        exports = nt.build_exports([episode], result["captures"], {"schema_version": 1, "reviews": [review]})
        self.assertEqual(exports["sft"][0]["status"], "fixture_only")
        self.assertFalse(exports["sft"][0]["training_eligible"])
        self.assertEqual(exports["sft"][0]["segment"]["loss_mask"], [0, 0, 1, 1, 1])

    def test_current_null_roles_and_unverified_semantics_stay_unavailable(self):
        episode, records = fixture(attested=False)
        result = nb.bind_captures([episode], records)
        self.assertEqual(result["captures"]["captures"], [])
        self.assertEqual(nb.summarize(result)["unavailable_reasons"], ["actual_sampler_semantics_unverified",
            "missing_generation_attestation", "original_parser_token_roles_unavailable"])
        self.assertIsNone(records[1]["token_roles"])
        self.assertNotIn("behavior_logprobs", records[1])

    def test_actual_sampler_emitted_phases_bind_and_export_authored_original_tokens(self):
        root = Path(__file__).resolve().parents[2] / ".keating" / "tmp"
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="binder-interop-", dir=root) as directory:
            episode, records, journal, calls, originals = sampler_binding_fixture(Path(directory))
            before = journal.read_bytes()
            result = nb.bind_captures([episode], records)
            self.assertEqual(calls, ["connect", "sample", "parse", "sample", "parse"])
            self.assertEqual([r["phase"] for r in records], ["prepared", "sampled", "parsed"] * 2)
            self.assertEqual(nb.summarize(result)["status_counts"], {"available": 0, "fixture_only": 2, "unavailable": 0})
            self.assertEqual(journal.read_bytes(), before)
            for index, capture in enumerate(result["captures"]["captures"]):
                self.assertEqual(capture["source"]["kind"], "authored_fixture")
                self.assertEqual(capture["prompt_token_ids"], originals[index]["prompt"])
                self.assertEqual(capture["completion_token_ids"], originals[index]["completion"])
                self.assertEqual(capture["behavior_logprobs"], originals[index]["logprobs"])
                self.assertIn(":train:0/", capture["actor"]["revision"])
            captured = result["captures"]["captures"][0]
            self.assertEqual(set(captured["completion_token_roles"]), {"assistant_tool_call"})
            review = fixtures.fixture_review(episode, captured)
            exports = nt.build_exports([episode], result["captures"], {"schema_version": 1, "reviews": [review]})
            self.assertEqual(exports["sft"][0]["segment"]["loss_mask"], [0, 0, 1, 1, 1, 1])
            self.assertEqual(exports["sft"][0]["status"], "fixture_only")
            self.assertFalse(exports["sft"][0]["training_eligible"])
            self.assertIsNone(result["bindings"][0]["outcome"])

    def test_actual_sampler_missing_logprobs_remain_unavailable_after_binding(self):
        root = Path(__file__).resolve().parents[2] / ".keating" / "tmp"
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="binder-interop-", dir=root) as directory:
            episode, records, journal, _, _ = sampler_binding_fixture(Path(directory), missing_logprobs=True)
            before = journal.read_bytes()
            result = nb.bind_captures([episode], records)
            self.assertEqual(result["captures"]["captures"], [])
            for binding in result["bindings"]:
                self.assertEqual(binding["status"], "unavailable")
                self.assertIn("missing_original_behavior_logprobs", binding["reasons"])
                self.assertIn("actual_sampler_semantics_unverified", binding["reasons"])
                self.assertIn("generating_adapter_marked_capture_unavailable", binding["reasons"])
            self.assertNotIn("probability_attestation", records[1])
            self.assertEqual(journal.read_bytes(), before)

    def test_sampler_raw_identity_label_and_unsealed_pins_cannot_upgrade_old_records(self):
        episode, records = fixture(attested=False)
        for record in records:
            record["pins"] = {"model": {"id": "AUTHORED", "sampler_checkpoint": "tinker://authored/sampler_weights/step0"}}
            record["source_audit"] = {"scope": "identity_transforms_only_not_backend_weight_attestation"}
            if record["phase"] == "sampled":
                record.update(sequence_count=1, sequence_index=0, probability_semantics="provider_raw_identity_sampling")
            if record["phase"] == "parsed":
                record.update(token_roles=["assistant_text"]*3, original_token_capture_eligible=True,
                    role_assignment="homogeneous_original_sequence_including_actor_terminator/v1",
                    all_generation_transforms_recorded=True, probability_semantics="provider_raw_identity_sampling")
        rehash(records)
        original = deepcopy(records)
        result = nb.bind_captures([episode], records)
        self.assertEqual(result["captures"]["captures"], [])
        self.assertEqual(records, original)
        self.assertIn("actual_sampler_semantics_unverified", result["bindings"][0]["reasons"])

    def test_sampling_parameters_cardinality_and_stop_are_not_silently_changed(self):
        for mutate, code in (
            (lambda r: r[0]["sampling_params"].pop("stop"), "full_sampling_params_required"),
            (lambda r: r[0]["sampling_params"].update(temperature=0.7), "sampler_payload_settings_mismatch"),
            (lambda r: r[0]["sampling_params"].update(max_tokens=2), "completion_limit_alignment"),
            (lambda r: r[1].update(sequence_count=2, sequence_index=0), "ambiguous_sampled_sequence"),
            (lambda r: r[1].update(sequence_count=1, sequence_index=1), "ambiguous_sampled_sequence"),
            (lambda r: r[2].update(token_roles=["assistant_text"]*3), "contradictory_parser_roles"),
        ):
            with self.subTest(code=code):
                episode, records = fixture(); mutate(records); rehash(records)
                with self.assertRaisesRegex(nb.BindingError, code): nb.bind_captures([episode], records)
        for update, reason in (({"stop_reason": "length"}, "completion_did_not_stop_cleanly"),
                               ({"original_token_capture_eligible": False}, "generating_adapter_marked_capture_unavailable")):
            episode, records = fixture()
            records[1 if "stop_reason" in update else 2].update(update); rehash(records)
            result = nb.bind_captures([episode], records)
            self.assertIn(reason, result["bindings"][0]["reasons"])
            self.assertIsNone(result["bindings"][0]["capture_hash"])

    def test_real_journal_writer_hash_roundtrip_and_duplicate_json_keys(self):
        episode, records = fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "raw.jsonl"
            for record in records:
                append_capture(path, {k: v for k, v in record.items() if k != "record_sha256"})
            loaded = nb.load_journal(path)
            self.assertEqual(nb.bind_captures([episode], loaded)["binding_hash"], nb.bind_captures([episode], records)["binding_hash"])
            path.write_text('{"schema_version":1,"schema_version":2}\n')
            with self.assertRaisesRegex(nb.BindingError, "duplicate_json_key"):
                nb.load_journal(path)

    def test_journal_tamper_missing_duplicate_or_reordered_phase(self):
        episode, records = fixture()
        bad = deepcopy(records); bad[1]["completion_token_ids"][0] = 909
        with self.assertRaisesRegex(nb.BindingError, "journal_hash_mismatch"):
            nb.bind_captures([episode], bad)
        for bad in (records[:-1], [records[0], records[0], *records[1:]], [records[1], records[0], *records[2:]]):
            with self.assertRaisesRegex(nb.BindingError, "missing_duplicate_or_reordered_journal_phase"):
                nb.bind_captures([episode], bad)

    def test_duplicate_request_response_and_missing_runtime_identity_reject(self):
        for mode in ("request", "response", "missing_response", "null_response_id"):
            episode, records = fixture()
            receipts = episode["runtime"]["receipts"]
            if mode == "request":
                receipts.insert(2, deepcopy(receipts[1]))
                episode["runtime"]["requests"].insert(1, deepcopy(receipts[1]))
            elif mode == "response":
                receipts.insert(3, deepcopy(receipts[2]))
            elif mode == "missing_response":
                receipts.pop(2)
            else:
                receipts[2]["data"]["response_id"] = None
            with self.assertRaises(nb.BindingError):
                nb.bind_captures([episode], records)

    def test_payload_context_and_message_hash_must_match_even_after_rehash(self):
        for mode, code in (("payload", "bridge_runtime_payload"), ("context", "request_context_not_actor_prefix"),
                           ("message_hash", "provider_response_message_hash"), ("request_projection", "runtime_requests_not_receipt_projection")):
            episode, records = fixture()
            request = episode["runtime"]["requests"][0]
            if mode == "payload": request["data"]["payload"]["model"] = "other"
            if mode == "context": request["data"]["context"]["messages"].append({"role": "user", "content": "FUTURE_LEAK"})
            if mode == "message_hash": episode["runtime"]["receipts"][2]["data"]["message_sha256"] = "0" * 64
            if mode == "request_projection": episode["runtime"]["requests"] = []
            with self.assertRaisesRegex(nb.BindingError, code): nb.bind_captures([episode], records)

    def test_parsed_text_tool_id_and_arguments_must_equal_delivered_message(self):
        for mode in ("text", "id", "arguments"):
            episode, records = fixture()
            parsed = records[2]["message"]
            if mode == "text": parsed["content"] += "MUTATED"
            if mode == "id": parsed["tool_calls"][0]["id"] = "fictional-call"
            if mode == "arguments": parsed["tool_calls"][0]["function"]["arguments"] = '{"path":"changed"}'
            rehash(records)
            with self.assertRaisesRegex(nb.BindingError, "parsed_message_not_delivered_message"):
                nb.bind_captures([episode], records)

    def test_cross_branch_response_ids_are_never_joined_by_text_or_time(self):
        first, records = fixture()
        second, _ = fixture(branch="b")
        with self.assertRaisesRegex(nb.BindingError, "cross_episode_ambiguous_response_id"):
            nb.bind_captures([first, second], records)
        with self.assertRaisesRegex(nb.BindingError, "duplicate_episode_branch"):
            nb.bind_captures([first, first], records)

    def test_original_role_attestation_cannot_retokenize_skip_or_target_tool_results(self):
        for mutation, code in ((lambda a: a.update(source="retokenized_text"), "parser_owned_roles"),
                               (lambda a: a.update(roles=["assistant_text"]), "token_role_alignment"),
                               (lambda a: a.update(roles=["tool_result"]*3), "token_role_alignment"),
                               (lambda a: a.update(roles=["learner"]*3), "token_role_alignment"),
                               (lambda a: a.update(completion_token_ids_hash="0"*64), "original_token_role_pin")):
            episode, records = fixture(); mutation(records[2]["token_role_attestation"]); rehash(records)
            with self.assertRaisesRegex(nb.BindingError, code): nb.bind_captures([episode], records)
        episode, records = fixture()
        records[2]["token_role_attestation"]["roles"][0] = None; rehash(records)
        result = nb.bind_captures([episode], records)
        self.assertIn("original_parser_token_roles_unavailable", result["bindings"][0]["reasons"])

    def test_generation_pin_and_true_fixture_kind_are_mandatory(self):
        for mutation, code in ((lambda a: a.update(recorded_before_sample=False), "generation_attestation_schema"),
                               (lambda a: a.update(prompt_token_ids_hash="0"*64), "generation_input_pin"),
                               (lambda a: a["actor"].update(id="Qwen/Qwen3.5-9B-Base"), "actor_alias_cannot_be_rewritten"),
                               (lambda a: a["tokenizer"].update(revision="main"), "pinned_tokenizer"),
                               (lambda a: a["tokenizer"].update(revision="tinker://authored/sampler_weights/latest"), "pinned_tokenizer"),
                               (lambda a: a["tokenizer"].update(revision="tinker://authored:train:/sampler_weights/step0"), "pinned_tokenizer"),
                               (lambda a: a.update(kind="provider_capture"), "fixture_cannot_claim_provider_origin")):
            episode, records = fixture(); mutation(records[0]["generation_attestation"]); rehash(records)
            with self.assertRaisesRegex(nb.BindingError, code): nb.bind_captures([episode], records)

    def test_probabilities_never_inferred_from_settings_or_missing_values(self):
        episode, records = fixture()
        records[1].pop("probability_attestation"); records[1]["probability_semantics"] = "provider_reported_not_yet_verified_as_actual_sampler"; rehash(records)
        result = nb.bind_captures([episode], records)
        self.assertIn("actual_sampler_semantics_unverified", result["bindings"][0]["reasons"])
        episode, records = fixture()
        records[1]["probability_semantics"] = "unverified"; rehash(records)
        with self.assertRaisesRegex(nb.BindingError, "probability_semantics_not_verified"): nb.bind_captures([episode], records)
        episode, records = fixture()
        records[1]["provider_logprobs"] = None
        records[1]["probability_attestation"]["logprobs_hash"] = nt.native_hash(None); rehash(records)
        self.assertIn("missing_original_behavior_logprobs", nb.bind_captures([episode], records)["bindings"][0]["reasons"])
        episode, records = fixture()
        records[1]["provider_logprobs"] = [-0.1]; rehash(records)
        with self.assertRaisesRegex(nb.BindingError, "raw_probability_alignment_or_value"): nb.bind_captures([episode], records)

    def test_failed_followup_has_binding_evidence_but_no_delivered_capture(self):
        episode, records = fixture()
        step = [e for e in episode["ledger"] if e["kind"] == "runtime_step"][-1]
        step["payload"]["status"] = "failed"
        end = episode["ledger"][-1]
        last_state = [e for e in episode["ledger"] if e["kind"] == "state_snapshot"][-1]
        episode["ledger"] = episode["ledger"][:last_state["sequence"] + 1] + [end]
        episode["outcome"] = "provider_failure"
        episode["runtime"].update(status="failed", error_code="provider_timeout")
        end["payload"].update(outcome="provider_failure", runtime_error="provider_timeout")
        fixtures.reseal_episode(episode)
        result = nb.bind_captures([episode], records)
        self.assertEqual(len(result["captures"]["captures"]), 1)
        self.assertIn("actor_action_not_delivered", result["bindings"][1]["reasons"])
        self.assertIsNone(result["bindings"][1]["delivery_event_hash"])
        self.assertIsNone(result["bindings"][1]["outcome"])

    def test_cli_private_export_preserves_journal_and_rejects_overwrite(self):
        episode, records = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); ep = root / "episode.json"; journal = root / "raw.jsonl"; output = root / "bound"
            ep.write_text(nt.native_json(episode))
            for record in records: append_capture(journal, {k:v for k,v in record.items() if k != "record_sha256"})
            before = journal.read_bytes()
            env = {k:v for k,v in os.environ.items() if k not in {"PYTHONHOME", "PYTHONPATH", "TINKER_API_KEY"}}
            command = [sys.executable, nb.__file__, "export", "--episode", str(ep), "--journal", str(journal), "--output", str(output)]
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["status_counts"]["fixture_only"], 2)
            self.assertEqual(journal.read_bytes(), before)
            self.assertEqual((output / "captures.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(nt.load_json(output / "exports.json")["sft"], [])  # review absent
            self.assertEqual(subprocess.run(command, env=env, capture_output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
