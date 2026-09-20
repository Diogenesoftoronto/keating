"""Offline contracts for the separately funded instruction-model learner."""
import copy
import importlib.metadata
import json
import os
from pathlib import Path
import ssl
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import native_training as nt
from native_tinker_update import BudgetLedger, write_private
import native_tinker_learner as nl


class Prompt:
    def __init__(self, count):
        self.ids = list(range(count))
    def to_ints(self):
        return self.ids


class Sampler:
    audit = {"kind": "injected_offline_fixture"}
    def __init__(self, config, owner):
        self.owner = owner
        owner.calls.append("local_factory")
    def prepare(self, messages):
        self.owner.messages = messages
        return Prompt(self.owner.prompt_count)
    def connect(self):
        self.owner.calls.append("connect")
        ledger = nt.load_json(self.owner.child)
        run = list(ledger["runs"].values())[-1]
        assert run["dispatched"] == ["create_client"]
        assert float(run["reserved_usd"]) > 0
        if self.owner.connect_delay:
            time.sleep(self.owner.connect_delay)
        if self.owner.fail_connect:
            raise RuntimeError("secret-provider-token-do-not-log")
        return object()
    def sample(self, client, prompt, settings, timeout):
        self.owner.calls.append("sample")
        run = list(nt.load_json(self.owner.child)["runs"].values())[-1]
        assert run["dispatched"][-1] == "sample"
        if self.owner.fail_sample:
            raise RuntimeError("secret-provider-token-do-not-log")
        return SimpleNamespace(sequences=self.owner.sequences)
    def decode(self, tokens):
        self.owner.decoded_ids = tokens
        return self.owner.text


class LearnerTests(unittest.TestCase):
    def setUp(self):
        base = nl.ROOT / ".keating" / "native-learning"
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="learner-offline-test-", dir=base)
        self.root = Path(self.temp.name)
        self.parent, self.child = self.root / "parent.json", self.root / "child.json"
        self.calls = []
        self.prompt_count, self.connect_delay = 20, 0
        self.fail_connect = self.fail_sample = False
        self.text = '  {"kind":"message","text":"I am still unsure."}\n'
        self.sequences = [SimpleNamespace(tokens=[101, 102, nl.IM_END], logprobs=[-1., -2., -.1],
                                         sequence_id="fixture-sequence", stop_reason="stop")]
        self.grant = nt.seal({"kind": "authored-test-grant", "phases": ["allocate"],
                              "cost": {"reserved_usd": "1"}}, "plan_hash")
        cfg = nl.learner_config()
        cfg["allocation"] = {"id": self.grant["plan_hash"], "ledger_path": str(self.child),
                             "budget_project_id": "learner-test", "cap_usd": "1",
                             "parent_ledger_path": str(self.parent)}
        cfg["limits"]["max_output_tokens"] = 20
        self.config = nt.seal(cfg, "config_hash")
        self.body = {"model": nl.MODEL, "messages": [{"role": "system", "content": "Continue the learner."},
                      {"role": "user", "content": '{"context":{"initial_material":"A task"}}'}],
                     "temperature": 1, "max_tokens": 10}
    def tearDown(self):
        self.temp.cleanup()
    def fund(self):
        parent = BudgetLedger(self.parent, nl.PARENT_PROJECT, nl.PARENT_MODEL, "100")
        parent.reserve(self.grant)
        parent.before(self.grant, "allocate")
        parent.mark(self.grant, status="complete")
        child = BudgetLedger(self.child, "learner-test", nl.MODEL, self.config["allocation"]["cap_usd"])
        with child.locked() as value:
            value["parent_allocation"] = {"ledger_path": str(self.parent), "plan_hash": self.grant["plan_hash"]}
    def bridge(self, state="server"):
        return nl.LearnerBridge(self.config, b"local-fixture-bearer-" * 3, self.root / state,
                                sampler_factory=lambda cfg: Sampler(cfg, self))
    def records(self, bridge):
        return [json.loads(line) for line in bridge.raw_path.read_text().splitlines()]
    def mutate_child(self, fn):
        value = nt.load_json(self.child)
        fn(value)
        write_private(self.child, nt.seal(value, "ledger_hash"))

    def test_no_service_or_local_factory_without_existing_ledgers(self):
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "funded_ledgers"):
            bridge.complete(self.body)
        self.assertEqual(self.calls, [])
        self.assertFalse(self.child.exists())
        self.assertEqual(self.records(bridge), [])

    def test_unfunded_child_cannot_borrow_parent_cap(self):
        self.fund()
        value = nt.load_json(self.parent)
        value["runs"] = {}
        write_private(self.parent, nt.seal(value, "ledger_hash"))
        with self.assertRaisesRegex(ValueError, "completed_parent_grant"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, [])

    def test_parent_binding_and_child_model_must_match(self):
        self.fund()
        self.mutate_child(lambda v: v.update(model_id="Qwen/Qwen3.5-9B-Base"))
        with self.assertRaisesRegex(ValueError, "child_identity"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, [])

    def test_parent_hash_cannot_be_swapped(self):
        self.fund()
        self.mutate_child(lambda v: v["parent_allocation"].update(plan_hash="f" * 64))
        with self.assertRaisesRegex(ValueError, "child_identity"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, [])

    def test_cap_rejection_precedes_connect_and_sample(self):
        self.config["allocation"]["cap_usd"] = "0.000001"
        self.config = nt.seal(self.config, "config_hash")
        self.fund()
        with self.assertRaisesRegex(ValueError, "cap_exceeded_before_dispatch"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, ["local_factory"])
        self.assertEqual(nt.load_json(self.child)["runs"], {})

    def test_context_overflow_rejected_without_reserve_or_dispatch(self):
        self.fund()
        self.prompt_count = 32768
        with self.assertRaisesRegex(ValueError, "context_overflow"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, ["local_factory"])
        self.assertEqual(nt.load_json(self.child)["runs"], {})

    def test_model_tokenizer_renderer_versions_and_pricing_are_fixed(self):
        changes = [("model", "id", "Qwen/Qwen3.5-9B-Base"),
                   ("model", "hf_revision", "main"), ("tokenizer", "revision", "main"),
                   ("renderer", "name", "qwen3_5"), ("versions", "tinker", "0.28.0"),
                   ("pricing", "safety_factor", 1), ("sampling", "top_p", 0.8)]
        for field, key, value in changes:
            with self.subTest(field=field, key=key):
                cfg = copy.deepcopy(self.config)
                cfg[field][key] = value
                with self.assertRaisesRegex(ValueError, "unsupported_learner_pin"):
                    nl.learner_config(nt.seal(cfg, "config_hash"))

    def test_limits_are_finite_integral_bounded(self):
        for key, value in [("context_tokens", 65537), ("max_output_tokens", 4097),
                           ("max_output_tokens", True), ("timeout_seconds", 0)]:
            with self.subTest(key=key, value=value):
                cfg = copy.deepcopy(self.config)
                cfg["limits"][key] = value
                with self.assertRaises(ValueError):
                    nl.learner_config(nt.seal(cfg, "config_hash"))

    def test_request_denies_tools_schema_and_provider_controls_before_factory(self):
        self.fund()
        bridge = self.bridge()
        for patch_body in ({"model": "Qwen/Qwen3.5-9B-Base"}, {"tools": [{"name": "run"}]},
                           {"response_format": {"type": "json_object"}}, {"api_key": "secret"},
                           {"stream": True}, {"store": True}, {"max_tokens": True}, {"max_tokens": 21},
                           {"temperature": 0}, {"messages": [{"role": "tool", "content": "answer"}]},
                           {"messages": [{"role": "user", "content": "x", "answer_key": "hidden"}]}):
            with self.subTest(fields=sorted(patch_body)):
                with self.assertRaises(ValueError):
                    bridge.complete({**self.body, **patch_body})
        self.assertEqual(self.calls, [])

    def test_actual_raw_json_and_original_arrays_retained_never_actor_eligible(self):
        self.fund()
        before_parent = self.parent.read_bytes()
        bridge = self.bridge()
        result = bridge.complete(self.body)
        self.assertEqual(result["choices"][0]["message"]["content"], self.text)
        self.assertEqual(self.decoded_ids, [101, 102])
        self.assertEqual(self.calls, ["local_factory", "connect", "sample"])
        records = self.records(bridge)
        self.assertEqual([r["phase"] for r in records], ["prepared", "sampled", "returned"])
        self.assertEqual(records[0]["original_request"], self.body)
        self.assertEqual(records[1]["completion_token_ids"], [101, 102, nl.IM_END])
        self.assertEqual(records[1]["provider_logprobs"], [-1., -2., -.1])
        self.assertEqual(records[2]["original_response"], result)
        previous = None
        for record in records:
            self.assertEqual(record["previous_hash"], previous)
            nl.sealed(record, "record_hash")
            self.assertFalse(record["actor_training_eligible"])
            self.assertFalse(record["training_eligible"])
            previous = record["record_hash"]
        self.assertEqual(self.parent.read_bytes(), before_parent)
        self.assertEqual(bridge.raw_path.stat().st_mode & 0o777, 0o600)

    def test_invalid_json_is_returned_without_repair(self):
        self.fund()
        self.text = '```json\n{"kind":message INVALID}\n```'
        bridge = self.bridge()
        result = bridge.complete(self.body)
        self.assertEqual(result["choices"][0]["message"]["content"], self.text)
        self.assertFalse(self.records(bridge)[-1]["json_repaired"])
        self.assertEqual(self.calls.count("sample"), 1)

    def test_missing_logprobs_do_not_become_actor_evidence(self):
        self.fund()
        self.sequences[0].logprobs = None
        bridge = self.bridge()
        bridge.complete(self.body)
        sample = self.records(bridge)[1]
        self.assertIsNone(sample["provider_logprobs"])
        self.assertFalse(sample["actor_training_eligible"])

    def test_truncated_text_remains_raw_and_declares_length(self):
        self.fund()
        self.sequences[0].tokens = [101, 102]
        self.sequences[0].stop_reason = "length"
        self.text = '{"kind":"message","text":"I'
        result = self.bridge().complete(self.body)
        self.assertEqual(result["choices"][0]["finish_reason"], "length")
        self.assertEqual(result["choices"][0]["message"]["content"], self.text)

    def test_output_overflow_is_journaled_then_halts(self):
        self.fund()
        self.sequences[0].tokens = [101] * 11
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "failed_unknown"):
            bridge.complete(self.body)
        self.assertEqual(len(self.records(bridge)[1]["completion_token_ids"]), 11)
        self.assertTrue(bridge.halted.is_set())

    def test_unknown_failure_retains_reserve_blocks_retry_and_redacts_errors(self):
        self.fund()
        self.fail_sample = True
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "failed_unknown") as error:
            bridge.complete(self.body)
        self.assertNotIn("secret-provider", str(error.exception))
        self.assertNotIn("secret-provider", bridge.raw_path.read_text())
        run = list(nt.load_json(self.child)["runs"].values())[0]
        self.assertEqual(run["status"], "failed_unknown")
        self.assertGreater(float(run["reserved_usd"]), 0)
        with self.assertRaisesRegex(ValueError, "halted"):
            bridge.complete(self.body)
        with self.assertRaisesRegex(ValueError, "unreconciled"):
            self.bridge("restart").complete(self.body)
        self.assertEqual(self.calls.count("sample"), 1)

    def test_slow_connect_cannot_sample_after_deadline(self):
        self.config["limits"]["timeout_seconds"] = 1
        self.config = nt.seal(self.config, "config_hash")
        self.fund()
        self.connect_delay = 1.2
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "failed_unknown"):
            bridge.complete(self.body)
        time.sleep(.3)
        self.assertEqual(self.calls, ["local_factory", "connect"])
        self.assertEqual(list(nt.load_json(self.child)["runs"].values())[0]["dispatched"], ["create_client"])

    def test_second_successful_request_reuses_client_with_new_reservation(self):
        self.fund()
        bridge = self.bridge()
        bridge.complete(self.body)
        bridge.complete(self.body)
        self.assertEqual(self.calls.count("connect"), 1)
        self.assertEqual(self.calls.count("sample"), 2)
        runs = list(nt.load_json(self.child)["runs"].values())
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[1]["phases"], ["sample"])

    def test_config_is_copied_and_existing_journal_never_overwritten(self):
        bridge = self.bridge()
        self.config["limits"]["max_output_tokens"] = 4096
        self.assertEqual(bridge.config["limits"]["max_output_tokens"], 20)
        copy_config = bridge.config
        copy_config["model"]["id"] = "other"
        self.assertEqual(bridge.config["model"]["id"], nl.MODEL)
        with self.assertRaises(FileExistsError):
            nl.LearnerBridge(bridge.config, b"a" * 40, bridge.state)

    def test_output_outside_ignored_tree_rejected(self):
        with self.assertRaisesRegex(ValueError, "private_ignored"):
            nl.private_path("/tmp/learner-secrets")
        (self.root / "link").symlink_to(self.root / "child.json")
        with self.assertRaisesRegex(ValueError, "private_ignored"):
            nl.private_path(self.root / "link")

    def test_tls_auth_funding_and_response_are_local_only(self):
        from benchmark_tinker_bridge import create_material
        self.fund()
        token, token_file, certificate, key = create_material(self.root / "tls")
        bridge = nl.LearnerBridge(self.config, token, self.root / "tls",
                                 sampler_factory=lambda cfg: Sampler(cfg, self))
        server = bridge.server(certificate, key)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        endpoint = f"https://localhost:{server.server_port}/v1/chat/completions"
        context = ssl.create_default_context(cafile=certificate)
        def request(body, bearer):
            return urllib.request.urlopen(urllib.request.Request(endpoint, data=body,
                headers={"Authorization": "Bearer " + bearer, "Content-Type": "application/json"}),
                context=context, timeout=5)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(json.dumps(self.body).encode(), "invalid-secret")
            self.assertEqual(error.exception.code, 401)
            self.assertEqual(self.calls, [])
            raw = json.dumps(self.body).encode()
            with request(raw, token.decode()) as response:
                output = json.load(response)
            self.assertEqual(output["choices"][0]["message"]["content"], self.text)
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(b'{"model":"x","model":"y"}', token.decode())
            self.assertEqual(error.exception.code, 400)
            self.assertNotIn(token.decode(), bridge.raw_path.read_text())
            self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


def pinned_environment():
    try:
        return all(importlib.metadata.version(k) == v for k, v in nl.VERSIONS.items())
    except importlib.metadata.PackageNotFoundError:
        return False


@unittest.skipUnless(pinned_environment(), "pinned Tinker/cookbook/Transformers environment required")
class LocalPinTests(unittest.TestCase):
    def test_real_instruction_tokenizer_and_renderer_without_credentials_or_service(self):
        with patch.object(nl, "skate_secret", side_effect=AssertionError("credential access forbidden")):
            sampler = nl.PinnedInstructionSampler()
        messages = [{"role": "system", "content": "Continue as the learner."},
                    {"role": "user", "content": "I added the denominators."}]
        ids = sampler.prepare(messages).to_ints()
        text = sampler.decode(ids)
        self.assertTrue(text.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n"))
        rendered = sampler.tokenizer.apply_chat_template(messages, tokenize=True,
                           add_generation_prompt=True, enable_thinking=False)
        self.assertEqual(ids, rendered["input_ids"])
        self.assertIn("SDK 0.27.1 still", sampler.audit["retry_scope"])
        self.assertEqual(sampler.audit["hf_revision"], nl.HF_REVISION)

    def test_actual_sdk_serialization_including_default_seed_without_network(self):
        import tinker
        sampler = object.__new__(nl.PinnedInstructionSampler)
        sampler.sdk = tinker
        captured = {}
        def sample(prompt, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(result=lambda timeout: "offline-result")
        settings = {"temperature": 1, "top_p": 1, "top_k": -1, "max_tokens": 100}
        result = sampler.sample(SimpleNamespace(sample=sample), Prompt(10), settings, 5)
        self.assertEqual(result, "offline-result")
        self.assertEqual(captured["sampling_params"].model_dump(mode="json"),
                         {**settings, "seed": None, "stop": [nl.IM_END]})
        self.assertEqual(captured["num_samples"], 1)
        self.assertIs(captured["include_prompt_logprobs"], False)

    def test_sdk_model_identity_and_outer_retry_settings_without_real_client(self):
        from tinker.lib.retry_handler import RetryConfig
        sampler = object.__new__(nl.PinnedInstructionSampler)
        sampler.config = {"project_selection": "account_default", "project_id": None,
                          "limits": {"timeout_seconds": 120}}
        key = "private-injected-test-key"
        sampler.secret_loader = lambda: key
        calls = []
        class Service:
            def create_sampling_client(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(get_base_model=lambda: nl.MODEL)
        def service_factory(**kwargs):
            calls.append(kwargs)
            return Service()
        sampler.sdk = SimpleNamespace(ServiceClient=service_factory)
        with patch.dict(os.environ, {}, clear=True):
            sampler.connect()
        self.assertEqual(calls[0]["max_retries"], 0)
        self.assertEqual(calls[0]["api_key"], key)
        self.assertEqual(calls[1]["base_model"], nl.MODEL)
        self.assertIsInstance(calls[1]["retry_config"], RetryConfig)
        self.assertFalse(calls[1]["retry_config"].enable_retry_logic)


if __name__ == "__main__":
    unittest.main()
