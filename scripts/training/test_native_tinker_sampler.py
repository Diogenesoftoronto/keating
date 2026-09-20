"""Authored offline samples; no Tinker account, inference or model downloads."""
import copy
from decimal import Decimal
import hashlib
import http.client
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import native_tinker_sampler as ns
from native_tinker_update import BudgetLedger, UpdateError
from benchmark_tinker_bridge import MODELS, create_material, native_conversation
from serve_pilot import RequestError


class SamplerContractTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".keating" / "tmp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="native-sampler-test-", dir=root)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.config = ns.sampler_config()
        self.config["public_model_id"] = "authored-qwen-alias"
        self.config["model"]["sampler_checkpoint"] = "tinker://authored-fixture/sampler_weights/frozen-001"
        self.config["allocation"] = {"id": "authored-allocation", "ledger_path": str(self.path / "budget.json"),
                                     "budget_project_id": "local-only-budget", "cap_usd": "1"}
        self.config = ns.nt.seal(self.config, "config_hash")
        self.ledger = BudgetLedger(self.path / "budget.json", "local-only-budget", ns.MODEL, "1")
        # Test-only parent funding fixture. The production bridge never does this.
        with self.ledger.locked():
            pass
        self.events = []
        self.sequence = SimpleNamespace(tokens=[11, 12, ns.IM_END], logprobs=[-0.1, -0.2, -0.3],
                                        sequence_id="authored-sequence", stop_reason="stop")
        self.body = {"model": "authored-qwen-alias", "messages": [{"role": "system", "content": "Exact task."},
                    {"role": "user", "content": "Authored small question?"}], "max_tokens": 20}
        self.parse_error = False
        self.sample_error = False
        self.extra_sequence = False
        self.prompt_count = 4
        self.before_parse = None

    def make_bridge(self, state=None):
        owner = self
        class FakeSampler:
            audit = {"kind": "authored_mock_not_provider_evidence"}
            def __init__(self, config):
                owner.events.append("local_renderer")
            def prepare(self, messages, tools):
                return SimpleNamespace(to_ints=lambda: list(range(owner.prompt_count)))
            def params(self, settings):
                return SimpleNamespace(model_dump=lambda **_: {**settings, "stop": [ns.IM_END], "seed": settings.get("seed")})
            def connect(self):
                budget = json.loads(owner.ledger.path.read_text())
                run = list(budget["runs"].values())[-1]
                owner.assertEqual(run["dispatched"], ["create_client"])
                owner.assertGreater(Decimal(run["reserved_usd"]), 0)
                owner.events.append("create_client")
                return self
            def sample(self, prompt, **kwargs):
                run = list(json.loads(owner.ledger.path.read_text())["runs"].values())[-1]
                owner.assertEqual(run["dispatched"][-1], "sample")
                owner.events.append("sample")
                owner.assertEqual(kwargs["num_samples"], 1)
                owner.assertFalse(kwargs["include_prompt_logprobs"])
                if owner.sample_error:
                    raise TimeoutError("secret-should-not-appear")
                seqs = [owner.sequence] * (2 if owner.extra_sequence else 1)
                return SimpleNamespace(result=lambda **_: SimpleNamespace(sequences=seqs))
            def parse(self, tokens):
                owner.events.append("parse")
                if owner.before_parse:
                    owner.before_parse()
                if owner.parse_error:
                    raise ValueError("secret-should-not-appear")
                return {"message": {"role": "assistant", "content": "Authored reply."},
                        "parse_finished": True, "token_roles": ["assistant_text"] * len(tokens),
                        "role_unavailable_reason": None, "unparsed_tool_calls": False}
        return ns.QwenCaptureBridge(self.config, b"t" * 40, state or self.path / "state", sampler_factory=FakeSampler)

    def records(self, bridge):
        return [json.loads(line) for line in bridge.raw_path.read_text().splitlines()]

    def test_draft_leaves_checkpoint_and_funding_unknown(self):
        draft = ns.sampler_config()
        self.assertIsNone(draft["model"]["sampler_checkpoint"])
        self.assertIsNone(draft["allocation"]["cap_usd"])
        self.assertEqual(draft["project_selection"], "account_default")
        self.assertIsNone(draft["project_id"])
        with self.assertRaises(UpdateError):
            ns.sampler_config(ns.nt.seal(draft, "config_hash"))

    def test_pins_and_project_selection_fail_closed(self):
        mutations = [("model", "id", "Qwen/not-the-requested-model"),
                     ("model", "sampler_checkpoint", "tinker://run/sampler_weights/latest"),
                     ("tokenizer", "revision", "main"), ("renderer", "name", "qwen3_5"),
                     ("sampling", "temperature", 0.7), ("versions", "tinker", "0.0.0")]
        for field, key, value in mutations:
            with self.subTest(field=field, key=key):
                cfg = copy.deepcopy(self.config); cfg[field][key] = value
                with self.assertRaises(UpdateError):
                    ns.sampler_config(ns.nt.seal(cfg, "config_hash"))
        cfg = copy.deepcopy(self.config); cfg["project_id"] = "invented-default"
        with self.assertRaises(UpdateError):
            ns.sampler_config(ns.nt.seal(cfg, "config_hash"))
        cfg["project_selection"] = "explicit"
        self.assertEqual(ns.sampler_config(ns.nt.seal(cfg, "config_hash"))["project_id"], "invented-default")

    def test_reservation_precedes_client_and_sample_and_journal_precedes_parser(self):
        bridge = self.make_bridge()
        self.before_parse = lambda: self.assertEqual([v["phase"] for v in self.records(bridge)], ["prepared", "sampled"])
        result = bridge.complete(self.body)
        self.assertEqual(self.events, ["local_renderer", "create_client", "sample", "parse"])
        rows = self.records(bridge)
        self.assertEqual([r["phase"] for r in rows], ["prepared", "sampled", "parsed"])
        self.assertEqual(rows[1]["completion_token_ids"], self.sequence.tokens)
        self.assertEqual(rows[1]["provider_logprobs"], self.sequence.logprobs)
        self.assertEqual(rows[0]["original_request"], self.body)
        self.assertTrue(rows[2]["original_token_capture_eligible"])
        self.assertTrue(all(not row["training_eligible"] for row in rows))
        self.assertTrue(all(row["response_id"] == result["id"] for row in rows))
        self.assertEqual(result["model"], self.body["model"])
        self.assertIsNone(rows[0]["project_id"])
        self.assertEqual(rows[0]["project_selection"], "account_default")
        self.assertEqual(rows[0]["reservation"]["cost"]["reserved_usd"], "0.00021270")
        self.assertEqual(bridge.raw_path.stat().st_mode & 0o777, 0o600)
        for row in rows:
            claimed = row.pop("record_sha256")
            body = json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            self.assertEqual(claimed, hashlib.sha256(body.encode()).hexdigest())

    def test_absent_parent_ledger_never_constructs_client_or_renderer(self):
        self.ledger.path.unlink()
        with self.assertRaisesRegex(UpdateError, "parent_funded_ledger_required"):
            self.make_bridge().complete(self.body)
        self.assertEqual(self.events, [])

    def test_wrong_ledger_identity_fails_before_client(self):
        cfg = copy.deepcopy(self.config); cfg["allocation"]["budget_project_id"] = "other-local-identity"
        self.config = ns.nt.seal(cfg, "config_hash")
        with self.assertRaisesRegex(UpdateError, "identity_mismatch"):
            self.make_bridge().complete(self.body)
        self.assertEqual(self.events, [])

    def test_cap_rejection_no_billable_boundary(self):
        plan = ns.nt.seal({"phases": ["external-work"], "cost": {"reserved_usd": "1"}}, "plan_hash")
        self.ledger.reserve(plan)
        with self.assertRaisesRegex(UpdateError, "budget_cap_exceeded"):
            self.make_bridge().complete(self.body)
        self.assertEqual(self.events, ["local_renderer"])

    def test_context_rejection_before_reservation(self):
        self.prompt_count = 32768
        with self.assertRaisesRegex(UpdateError, "context_limit"):
            self.make_bridge().complete(self.body)
        self.assertEqual(json.loads(self.ledger.path.read_text())["runs"], {})
        self.assertNotIn("create_client", self.events)

    def test_config_copy_and_no_global_models_mutation(self):
        before = copy.deepcopy(MODELS)
        bridge = self.make_bridge()
        self.config["public_model_id"] = "changed"
        exposed = bridge.config; exposed["model"]["sampler_checkpoint"] = "bad"
        self.assertEqual(bridge.complete(self.body)["model"], self.body["model"])
        self.assertEqual(MODELS, before)

    def test_reuse_has_a_new_reservation_without_second_client(self):
        bridge = self.make_bridge()
        first = bridge.complete(self.body); second = bridge.complete(self.body)
        self.assertNotEqual(first["id"], second["id"])
        runs = list(json.loads(self.ledger.path.read_text())["runs"].values())
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[1]["dispatched"], ["sample"])
        self.assertEqual(self.events.count("create_client"), 1)

    def test_timeout_retains_full_reservation_and_halts_new_requests(self):
        self.sample_error = True
        bridge = self.make_bridge()
        with self.assertRaises(RequestError):
            bridge.complete(self.body)
        with self.assertRaisesRegex(UpdateError, "halted"):
            bridge.complete(self.body)
        self.assertEqual(self.events.count("sample"), 1)
        run = next(iter(json.loads(self.ledger.path.read_text())["runs"].values()))
        self.assertEqual(run["status"], "failed_unknown")
        self.assertEqual(run["reserved_usd"], "0.00021270")
        self.assertNotIn("secret-should-not-appear", bridge.raw_path.read_text())

    def test_parser_failure_preserves_original_arrays(self):
        self.parse_error = True
        bridge = self.make_bridge()
        with self.assertRaises(RequestError):
            bridge.complete(self.body)
        rows = self.records(bridge)
        self.assertEqual(rows[1]["completion_token_ids"], self.sequence.tokens)
        self.assertEqual(rows[-1]["phase"], "failed")
        self.assertFalse(rows[-1]["original_token_capture_eligible"])

    def test_all_unexpected_sequences_recorded_before_rejection(self):
        self.extra_sequence = True
        bridge = self.make_bridge()
        with self.assertRaises(RequestError):
            bridge.complete(self.body)
        sampled = [r for r in self.records(bridge) if r["phase"] == "sampled"]
        self.assertEqual(len(sampled), 2)
        self.assertNotIn("parse", self.events)

    def test_missing_invalid_and_misaligned_probabilities_remain_unavailable(self):
        for index, lps in enumerate((None, [-1.0], [-0.1, 0.2, -0.3], [-0.1, float("nan"), -0.3])):
            with self.subTest(lps=lps):
                self.sequence.logprobs = lps
                bridge = self.make_bridge(self.path / f"state-{index}")
                bridge.complete(self.body)
                rows = self.records(bridge)
                self.assertFalse(rows[-1]["original_token_capture_eligible"])
                self.assertIn("missing_invalid_or_unaligned_logprobs", rows[-1]["unavailable_reasons"])
                if lps is not None and any(math != math for math in lps):
                    self.assertEqual(rows[1]["provider_logprobs_hex"][1], "nan")

    def test_request_sampling_transforms_and_alias_rejected(self):
        bridge = self.make_bridge()
        for field, value in (("temperature", 0.5), ("temperature", True), ("top_p", .99),
                             ("top_k", 5), ("model", "other"), ("logit_bias", {}),
                             ("parallel_tool_calls", False), ("max_tokens", 99999)):
            with self.subTest(field=field):
                body = {**self.body, field: value}
                with self.assertRaises(RequestError):
                    bridge.complete(body)
        self.assertEqual(self.events, [])

    def test_native_history_preserves_system_tools_and_original_call_ids(self):
        messages = [{"role": "system", "content": "actual-system"},
                    {"role": "user", "content": "authored task"},
                    {"role": "assistant", "content": None, "tool_calls": [{"id": "call-original", "type": "function",
                     "function": {"name": "read", "arguments": '{"path":"note.txt"}'}}]},
                    {"role": "tool", "tool_call_id": "call-original", "content": "actual tool result"}]
        tools = [{"type": "function", "function": {"name": "read", "description": "read a task file",
                 "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}]
        original = copy.deepcopy(messages)
        captured = {}
        def prefix(specs, system_prompt):
            captured.update(specs=specs, system=system_prompt)
            return [{"role": "system", "content": system_prompt}]
        converted = native_conversation(messages, tools, SimpleNamespace(create_conversation_prefix_with_tools=prefix), lambda c: c)
        self.assertEqual(captured, {"specs": [tools[0]["function"]], "system": "actual-system"})
        self.assertEqual(converted[-1]["name"], "read")
        self.assertEqual(converted[-1]["tool_call_id"], "call-original")
        self.assertEqual(messages, original)

    def test_roles_come_from_original_ids_never_output_encoding(self):
        class Tokenizer:
            all_special_ids = [ns.IM_END, ns.TOOL_OPEN, ns.TOOL_CLOSE, 248068]
            def encode(self, *_args, **_kwargs):
                raise AssertionError("Output must never be retokenized")
            def decode(self, tokens, **kwargs):
                return "An authored reply."
        renderer = SimpleNamespace(parse_response=lambda ids: ({"content": "An authored reply."}, SimpleNamespace(is_clean=True)))
        tokens = [1, 2, 3, ns.IM_END]
        result = ns.parse_original_completion(tokens, Tokenizer(), renderer)
        self.assertEqual(result["token_roles"], ["assistant_text"] * len(tokens))
        self.assertEqual(tokens, [1, 2, 3, ns.IM_END])

    def test_long_completion_sizes_vocabulary_once_and_rejects_out_of_range(self):
        # HF __len__ can rebuild a large vocabulary. Check work counts, not
        # wall-clock time, while exercising the highest valid and first bad ID.
        vocabulary_size = ns.IM_END + 100
        class Tokenizer:
            all_special_ids = [ns.IM_END]
            def __init__(self):
                self.size_queries = 0
            def __len__(self):
                self.size_queries += 1
                return vocabulary_size
            def encode(self, *_args, **_kwargs):
                raise AssertionError("Output must never be retokenized")
            def decode(self, *_args, **_kwargs):
                return "An authored long reply."
        for valid in (True, False):
            with self.subTest(valid=valid):
                tokenizer = Tokenizer()
                parsed_ids = []
                def parse(ids):
                    parsed_ids.append(list(ids))
                    return {"content": "An authored long reply."}, SimpleNamespace(is_clean=True)
                renderer = SimpleNamespace(parse_response=parse)
                tokens = [1] * 821 + [vocabulary_size - 1 if valid else vocabulary_size, ns.IM_END]
                original = list(tokens)
                if valid:
                    result = ns.parse_original_completion(tokens, tokenizer, renderer)
                    self.assertEqual(result["token_roles"], ["assistant_text"] * 823)
                    self.assertEqual(parsed_ids, [original])
                else:
                    with self.assertRaisesRegex(UpdateError, "sampled_id_outside_pinned_tokenizer"):
                        ns.parse_original_completion(tokens, tokenizer, renderer)
                    self.assertEqual(parsed_ids, [])
                self.assertEqual(tokens, original)
                self.assertEqual(tokenizer.size_queries, 1)

    def test_mixed_reasoning_truncation_and_duplicate_xml_unavailable(self):
        call = SimpleNamespace(model_dump=lambda **_: {"function": {"name": "read", "arguments": "{}"}})
        tool = "<tool_call><function=read></function></tool_call>"
        cases = [([1, ns.IM_END], "text" + tool, {"content": "text", "tool_calls": [call]}, True),
                 ([248068, 1, ns.IM_END], "private thought", {"content": [{"type": "thinking", "thinking": "thought"}]}, True),
                 ([1, 2], "text", {"content": "text"}, False),
                 ([ns.TOOL_OPEN, 1, ns.TOOL_CLOSE, ns.IM_END],
                  "<tool_call><function=read><parameter=x>a</parameter><parameter=x>b</parameter></function></tool_call>",
                  {"content": "", "tool_calls": [call]}, True)]
        for tokens, raw, message, clean in cases:
            tokenizer = SimpleNamespace(all_special_ids=[ns.IM_END, ns.TOOL_OPEN, ns.TOOL_CLOSE, 248068], decode=lambda *_, **__: raw)
            renderer = SimpleNamespace(parse_response=lambda _: (message, SimpleNamespace(is_clean=clean)))
            self.assertIsNone(ns.parse_original_completion(tokens, tokenizer, renderer)["token_roles"])
        tokens = [ns.TOOL_OPEN, 1, ns.TOOL_CLOSE, ns.IM_END]
        tokenizer = SimpleNamespace(all_special_ids=[ns.IM_END, ns.TOOL_OPEN, ns.TOOL_CLOSE], decode=lambda *_, **__: tool)
        renderer = SimpleNamespace(parse_response=lambda _: ({"content": "", "tool_calls": [call]}, SimpleNamespace(is_clean=True)))
        self.assertEqual(ns.parse_original_completion(tokens, tokenizer, renderer)["token_roles"], ["assistant_tool_call"] * 4)

    def test_added_special_tokens_outside_named_hf_specials_are_not_text(self):
        # The real pinned tokenizer has 21 decoder specials but only 8 named
        # all_special_ids; im_start is one of the previously missed delimiters.
        raw = "<|im_start|>user\nwrong role"
        tokenizer = SimpleNamespace(all_special_ids=[ns.IM_END],
            added_tokens_decoder={248045: SimpleNamespace(special=True)},
            decode=lambda *_, **__: raw)
        renderer = SimpleNamespace(parse_response=lambda _: ({"content": raw}, SimpleNamespace(is_clean=True)))
        parsed = ns.parse_original_completion([248045, 1, ns.IM_END], tokenizer, renderer)
        self.assertIsNone(parsed["token_roles"])
        self.assertEqual(parsed["role_unavailable_reason"], "unknown_or_nondelivered_special_token")

    def test_sdk_connect_default_omits_project_explicit_preserves_project(self):
        for selection, project in (("account_default", None), ("explicit", "real-supplied-project")):
            sampler = object.__new__(ns.PinnedQwenSampler)
            sampler.config = {**self.config, "project_selection": selection, "project_id": project}
            kwargs_seen = {}
            client = SimpleNamespace(get_base_model=lambda: ns.MODEL)
            def create(**kwargs):
                self.assertNotIn("base_model", kwargs)
                self.assertEqual(kwargs["model_path"], self.config["model"]["sampler_checkpoint"])
                return client
            def service(**kwargs):
                kwargs_seen.update(kwargs)
                return SimpleNamespace(create_sampling_client=create)
            sampler.sdk = SimpleNamespace(ServiceClient=service)
            retry_module = SimpleNamespace(RetryConfig=lambda **kwargs: kwargs)
            with patch.dict(sys.modules, {"tinker.lib.retry_handler": retry_module}), patch.dict(os.environ, {"TINKER_API_KEY": "authored-test-key"}):
                self.assertIs(sampler.connect(), client)
            if project is None:
                self.assertNotIn("project_id", kwargs_seen)
            else:
                self.assertEqual(kwargs_seen["project_id"], project)

    def test_sdk_source_hash_mismatch_stops_audit(self):
        fake = self.path / "wrong-source.py"; fake.write_text("authored wrong source")
        with patch.object(ns.importlib.metadata, "version", side_effect=lambda p: ns.VERSIONS[p]), \
             patch.object(ns.importlib.metadata, "distribution", return_value=SimpleNamespace(locate_file=lambda _: fake)):
            with self.assertRaisesRegex(UpdateError, "source_changed"):
                ns.PinnedQwenSampler.audit_installation()

    def test_inline_attestations_pass_actual_binder_validators(self):
        import native_capture_binding as binder
        bridge = self.make_bridge()
        bridge.complete(self.body)
        prepared, sampled, parsed = self.records(bridge)
        occurrence = {"request": {"data": {"model": {"provider": "tinker", "id": self.body["model"]}}},
                      "episode": SimpleNamespace(value={"measurement": "offline_integration"})}
        generation = binder._generation(prepared, occurrence)
        self.assertEqual(generation["kind"], "authored_fixture")
        self.assertEqual(generation["actor"]["id"], self.body["model"])
        self.assertEqual(sampled["probability_semantics"], binder.SEMANTICS)
        probability = binder._probabilities(sampled, prepared, generation)
        roles = binder._roles(parsed, sampled, generation)
        self.assertEqual(probability["logprobs_hash"], ns.nt.native_hash(self.sequence.logprobs))
        self.assertEqual(roles["roles"], ["assistant_text"] * 3)
        self.assertEqual(roles["completion_token_ids_hash"], ns.nt.native_hash(self.sequence.tokens))
        # New response IDs, wrong tokens or altered params cannot reuse proofs.
        tampered = copy.deepcopy(sampled); tampered["completion_token_ids"][0] += 1
        with self.assertRaises(binder.BindingError):
            binder._probabilities(tampered, prepared, generation)
        with self.assertRaises(binder.BindingError):
            binder._roles(parsed, tampered, generation)

    def test_missing_logprobs_never_get_probability_attestation(self):
        self.sequence.logprobs = None
        bridge = self.make_bridge(); bridge.complete(self.body)
        prepared, sampled, parsed = self.records(bridge)
        self.assertIn("generation_attestation", prepared)
        self.assertIn("token_role_attestation", parsed)
        self.assertNotIn("probability_attestation", sampled)
        self.assertNotEqual(sampled["probability_semantics"], "verified_actual_sampler")

    def test_audit_only_sampler_cannot_connect(self):
        sampler = object.__new__(ns.PinnedQwenSampler); sampler.config = None
        with self.assertRaisesRegex(UpdateError, "funded_bridge_config_required"):
            sampler.connect()

    def test_output_symlink_escape_rejected(self):
        escaped = self.path / "escape"; escaped.symlink_to("/tmp", target_is_directory=True)
        with self.assertRaisesRegex(UpdateError, "ignored_keating"):
            ns.QwenCaptureBridge.ignored_path(escaped / "private.json")

    def test_real_local_tls_handler_auth_models_and_buffered_sse(self):
        state = self.path / "tls"
        token, _, cert, key = create_material(state)
        bridge = self.make_bridge(state); bridge.token = token
        server = bridge.server(cert, key)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        context = ssl.create_default_context(cafile=str(cert))
        def request(method, path, body=None, authorized=True):
            connection = http.client.HTTPSConnection("localhost", server.server_port, context=context, timeout=5)
            headers = {"Content-Type": "application/json"}
            if authorized:
                headers["Authorization"] = "Bearer " + token.decode()
            connection.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
            response = connection.getresponse(); result = (response.status, response.read().decode()); connection.close()
            return result
        self.assertEqual(request("GET", "/v1/models", authorized=False)[0], 401)
        status, text = request("GET", "/v1/models")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(text)["data"][0]["id"], self.body["model"])
        self.assertEqual(self.events, [])
        status, text = request("POST", "/v1/chat/completions", {**self.body, "stream": True, "stream_options": {"include_usage": True}})
        self.assertEqual(status, 200)
        self.assertIn("data: [DONE]", text)
        events = [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: {")]
        self.assertEqual(events[0]["id"], self.records(bridge)[0]["response_id"])
        self.assertEqual(events[-1]["usage"]["completion_tokens"], 3)


if __name__ == "__main__":
    unittest.main()
