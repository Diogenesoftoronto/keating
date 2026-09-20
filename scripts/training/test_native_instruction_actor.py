"""Offline funding, protocol and real-Pi plumbing; never hosted inference."""
import copy
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import native_instruction_actor as na
import native_training as nt
from native_tinker_update import BudgetLedger, write_private


TOOL = {"type": "function", "function": {"name": "read", "description": "Read a workspace file.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}
CALL = {"id": "call_actual_fixture_id", "type": "function",
        "function": {"name": "read", "arguments": '{"path":"notes.md"}'}}


class Prompt:
    def __init__(self, count):
        self.ids = list(range(count))
    def to_ints(self):
        return self.ids


class FixtureSampler:
    audit = {"kind": "authored_offline_sampler_fixture", "not_provider_inference": True}
    def __init__(self, config, owner):
        self.config, self.owner = config, owner
        owner.calls.append("factory")
    def prepare(self, messages, tools):
        self.owner.messages, self.owner.tools = messages, tools
        return Prompt(self.owner.prompt_count)
    def connect(self, plan):
        na.require_dispatch(self.config, plan, "create_client")
        self.owner.calls.append("connect")
        if self.owner.connect_delay:
            time.sleep(self.owner.connect_delay)
        if self.owner.fail_connect:
            raise RuntimeError("credential-do-not-log")
        return object()
    def sample(self, client, prompt, settings, timeout, plan):
        na.require_dispatch(self.config, plan, "sample")
        self.owner.calls.append("sample")
        if self.owner.fail_sample:
            raise RuntimeError("credential-do-not-log")
        if self.owner.sample_delay:
            time.sleep(self.owner.sample_delay)
        if self.owner.responses:
            self.owner.parsed["message"] = self.owner.responses.pop(0)
        return SimpleNamespace(sequences=self.owner.sequences)
    def parse(self, tokens):
        self.owner.parsed_ids = tokens
        if self.owner.fail_parse:
            raise ValueError("authored malformed tool call")
        return copy.deepcopy(self.owner.parsed)


class ActorTests(unittest.TestCase):
    def setUp(self):
        base = na.nl.ROOT / ".keating" / "native-learning"
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="instruction-actor-offline-", dir=base)
        self.root = Path(self.temp.name)
        self.parent, self.child = self.root / "parent.json", self.root / "child.json"
        self.grant = nt.seal({"kind": "authored-test-grant", "phases": ["allocate"],
                              "cost": {"reserved_usd": "1"}}, "plan_hash")
        cfg = na.actor_config()
        cfg["allocation"] = {"id": self.grant["plan_hash"], "ledger_path": str(self.child),
                             "budget_project_id": "actor-offline-test", "cap_usd": "1",
                             "parent_ledger_path": str(self.parent)}
        cfg["limits"]["max_output_tokens"] = 20
        self.config = nt.seal(cfg, "config_hash")
        self.body = {"model": na.MODEL, "messages": [{"role": "system", "content": "Actual runtime policy."},
                      {"role": "user", "content": "Help me reason about equal pieces."}],
                     "tools": [], "max_tokens": 20, "temperature": 1, "stream": False}
        self.parsed = {"message": {"role": "assistant", "content": "Are the pieces the same size?"},
                       "parse_finished": True, "unparsed_tool_calls": False, "tool_id_sources": [],
                       "raw_text": "Are the pieces the same size?"}
        self.sequences = [SimpleNamespace(tokens=[101, 102, na.nl.IM_END], logprobs=[-1., -2., -.1],
                                         stop_reason="stop", sequence_id="authored-fixture")]
        self.calls, self.responses = [], []
        self.prompt_count = 20
        self.connect_delay = self.sample_delay = 0
        self.fail_connect = self.fail_sample = self.fail_parse = False
    def tearDown(self):
        self.temp.cleanup()
    def fund(self):
        parent = BudgetLedger(self.parent, na.nl.PARENT_PROJECT, na.nl.PARENT_MODEL, "100")
        parent.reserve(self.grant)
        parent.before(self.grant, "allocate")
        parent.mark(self.grant, status="complete")
        child = BudgetLedger(self.child, "actor-offline-test", na.MODEL, self.config["allocation"]["cap_usd"])
        with child.locked() as value:
            value["parent_allocation"] = {"ledger_path": str(self.parent), "plan_hash": self.grant["plan_hash"]}
    def bridge(self, name="server", token=b"private-offline-bearer-" * 3):
        return na.InstructionActorBridge(self.config, token, self.root / name,
                                         sampler_factory=lambda cfg: FixtureSampler(cfg, self))
    def records(self, bridge):
        return [json.loads(line) for line in bridge.raw_path.read_text().splitlines()]
    def change_ledger(self, path, mutate):
        value = nt.load_json(path)
        mutate(value)
        write_private(path, nt.seal(value, "ledger_hash"))
    def test_missing_funding_never_constructs_sampler_or_credentials(self):
        bridge = self.bridge()
        with self.assertRaises(ValueError):
            bridge.complete(self.body)
        self.assertEqual(self.calls, [])
        self.assertFalse(self.child.exists())
    def test_parent_grant_required_and_model_and_cap_must_match(self):
        self.fund()
        original_parent, original_child = nt.load_json(self.parent), nt.load_json(self.child)
        changes = [(self.parent, lambda v: v.update(runs={})),
                   (self.parent, lambda v: v.update(cap_usd="101")),
                   (self.parent, lambda v: v["runs"][self.grant["plan_hash"]].update(status="reserved")),
                   (self.child, lambda v: v.update(model_id="Qwen/Qwen3.5-9B-Base")),
                   (self.child, lambda v: v.update(cap_usd="2")),
                   (self.child, lambda v: v["parent_allocation"].update(plan_hash="f" * 64))]
        for index, (path, mutate) in enumerate(changes):
            with self.subTest(index=index):
                self.change_ledger(path, mutate)
                with self.assertRaises(ValueError):
                    self.bridge(str(index)).complete(self.body)
                self.assertEqual(self.calls, [])
                write_private(self.parent, original_parent)
                write_private(self.child, original_child)
    def test_cap_rejected_before_connect_or_sample(self):
        self.config["allocation"]["cap_usd"] = "0.000001"
        self.config = nt.seal(self.config, "config_hash")
        self.fund()
        with self.assertRaisesRegex(ValueError, "cap_exceeded"):
            self.bridge().complete(self.body)
        self.assertEqual(self.calls, ["factory"])
        self.assertEqual(nt.load_json(self.child)["runs"], {})
    def test_context_overflow_never_reserves_or_dispatches(self):
        self.fund()
        self.prompt_count = self.config["limits"]["context_tokens"]
        with self.assertRaisesRegex(ValueError, "context_overflow"):
            self.bridge().complete(self.body)
        self.assertEqual(nt.load_json(self.child)["runs"], {})
        self.assertNotIn("connect", self.calls)
    def test_pins_condition_and_limits_fail_closed(self):
        changes = [lambda v: v["model"].update(id="Qwen/Qwen3.5-9B-Base"),
                   lambda v: v["tokenizer"].update(revision="main"),
                   lambda v: v["condition"].update(training_eligible=True),
                   lambda v: v["condition"].update(prompt_sha256="0" * 64),
                   lambda v: v["limits"].update(timeout_seconds=0),
                   lambda v: v.update(max_provider_calls=True),
                   lambda v: v.update(max_provider_calls=13),
                   lambda v: v["sampling"].update(top_p=.9)]
        for mutate in changes:
            value = copy.deepcopy(self.config)
            mutate(value)
            with self.assertRaises(ValueError):
                na.actor_config(nt.seal(value, "config_hash"))
    def test_invalid_requests_rejected_before_factory_or_funding(self):
        changes = [{"model": "invented"}, {"seed": 0}, {"seed": False}, {"temperature": .1}, {"top_p": .9},
                   {"top_k": 1}, {"temperature": True}, {"top_p": float("nan")}, {"max_tokens": True},
                   {"max_tokens": 21}, {"max_completion_tokens": 10}, {"stream": 1}, {"store": True},
                   {"stream_options": {"include_usage": 1}}, {"parallel_tool_calls": False},
                   {"tool_choice": "required"}, {"response_format": {"type": "json_object"}},
                   {"tools": [{**TOOL, "function": {**TOOL["function"], "strict": True}}]},
                   {"messages": [{"role": "user", "content": [{"type": "image_url", "image_url": "x"}]}]}]
        bridge = self.bridge()
        for change in changes:
            with self.subTest(change=change), self.assertRaises(Exception):
                bridge.complete({**self.body, **change})
        self.assertEqual(self.calls, [])
    def test_history_preserves_real_tool_ids_and_only_real_matching_results(self):
        self.body["messages"] += [{"role": "assistant", "content": None, "tool_calls": [CALL]},
                                  {"role": "tool", "tool_call_id": CALL["id"], "content": "Actual file text."}]
        messages, _, _ = na.validate_request(self.body, self.config)
        self.assertEqual(messages[-1]["tool_call_id"], CALL["id"])
        for change in [{"tool_call_id": "invented"}, {"name": "invented"}]:
            altered = copy.deepcopy(self.body)
            altered["messages"][-1].update(change)
            with self.assertRaises(Exception):
                na.validate_request(altered, self.config)
        altered = copy.deepcopy(self.body)
        altered["messages"].insert(2, {"role": "system", "content": "late system"})
        with self.assertRaises(ValueError):
            na.validate_request(altered, self.config)
    def test_text_and_eval_journal_are_exact_never_training_evidence(self):
        self.fund()
        bridge = self.bridge()
        original = copy.deepcopy(self.body)
        result = bridge.complete(self.body)
        self.assertEqual(self.body, original)
        self.assertEqual(result["choices"][0]["message"], self.parsed["message"])
        self.assertEqual(result["usage"], {"prompt_tokens": 20, "completion_tokens": 3, "total_tokens": 23})
        self.assertEqual(self.parsed_ids, self.sequences[0].tokens)
        records = self.records(bridge)
        self.assertEqual([v["phase"] for v in records], ["prepared", "sampled", "parsed", "returned"])
        previous = None
        for record in records:
            na.sealed(record, "record_hash")
            self.assertEqual(record["previous_hash"], previous)
            previous = record["record_hash"]
            self.assertEqual(record["origin"], "actor")
            self.assertFalse(record["training_eligible"])
            self.assertFalse(record["actor_training_eligible"])
            self.assertFalse(record["original_token_capture_eligible"])
            self.assertNotIn("probability_attestation", record)
        self.assertEqual(records[0]["original_request"], original)
        self.assertEqual(records[0]["effective_messages"][0], original["messages"][0])
        self.assertEqual(records[0]["effective_messages"][1]["content"], na.ACTOR_PROMPT)
        self.assertEqual(records[0]["sampling"], {**na.IDENTITY, "max_tokens": 20, "seed": None, "stop": [na.nl.IM_END]})
        self.assertEqual(bridge.raw_path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(bridge.token.decode(), bridge.raw_path.read_text())
    def test_tool_schema_and_ids_remain_exact_through_response_and_sse(self):
        self.fund()
        self.body["tools"] = [TOOL]
        self.parsed["message"] = {"role": "assistant", "content": None, "tool_calls": [CALL]}
        bridge = self.bridge()
        result = bridge.complete(self.body)
        self.assertEqual(self.tools, [TOOL])
        events = na.sse_response(result, True).decode().split("\n\n")
        chunks = [json.loads(v[6:]) for v in events if v.startswith("data: {")]
        self.assertEqual(chunks[0]["choices"][0]["delta"]["tool_calls"][0], {"index": 0, **CALL})
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(chunks[2]["usage"], result["usage"])
        self.assertEqual(chunks[2]["choices"], [])
        self.assertIn("data: [DONE]", events)
        self.assertEqual(self.records(bridge)[-1]["original_response"]["choices"][0]["message"]["tool_calls"], [CALL])
    def test_tool_choice_none_renders_no_tools(self):
        self.fund()
        self.body.update(tools=[TOOL], tool_choice="none")
        self.bridge().complete(self.body)
        self.assertEqual(self.tools, [])
    def test_undeclared_tool_call_never_becomes_runtime_execution(self):
        self.fund()
        self.parsed["message"] = {"role": "assistant", "content": None, "tool_calls": [CALL]}
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "failed_unknown"):
            bridge.complete(self.body)
        self.assertTrue(bridge.halted.is_set())
        self.assertFalse(any(v["phase"] == "returned" for v in self.records(bridge)))
    def test_parse_failure_retains_original_tokens_and_halts_without_repair(self):
        self.fund()
        self.fail_parse = True
        bridge = self.bridge()
        with self.assertRaisesRegex(ValueError, "failed_unknown"):
            bridge.complete(self.body)
        sampled = next(v for v in self.records(bridge) if v["phase"] == "sampled")
        self.assertEqual(sampled["completion_token_ids"], self.sequences[0].tokens)
        with self.assertRaises(ValueError):
            bridge.complete(self.body)
        self.assertEqual(self.calls.count("sample"), 1)
    def test_missing_logprobs_remain_unknown_but_eval_text_is_usable(self):
        self.fund()
        self.sequences[0].logprobs = None
        bridge = self.bridge()
        bridge.complete(self.body)
        self.assertIsNone(self.records(bridge)[1]["provider_logprobs"])
        self.assertFalse(self.records(bridge)[1]["training_eligible"])
    def test_overflow_and_truncated_tool_call_are_not_repaired(self):
        self.fund()
        self.sequences[0].tokens = [101] * 21
        self.sequences[0].stop_reason = "length"
        bridge = self.bridge()
        with self.assertRaises(ValueError):
            bridge.complete(self.body)
        self.assertEqual(self.records(bridge)[1]["completion_token_ids"], [101] * 21)
        self.assertTrue(bridge.halted.is_set())
    def test_provider_failure_redacts_error_and_blocks_restart_on_same_allocation(self):
        self.fund()
        self.fail_sample = True
        bridge = self.bridge()
        with self.assertRaises(ValueError):
            bridge.complete(self.body)
        run = next(iter(nt.load_json(self.child)["runs"].values()))
        self.assertEqual(run["status"], "failed_unknown")
        self.assertGreater(float(run["reserved_usd"]), 0)
        self.assertNotIn("credential-do-not-log", bridge.raw_path.read_text())
        with self.assertRaisesRegex(ValueError, "unreconciled"):
            self.bridge("new-state").complete(self.body)
        self.assertEqual(self.calls.count("sample"), 1)
    def test_slow_client_cannot_launch_late_sample_after_deadline(self):
        self.config["limits"]["timeout_seconds"] = 1
        self.config = nt.seal(self.config, "config_hash")
        self.connect_delay = 1.2
        self.fund()
        bridge = self.bridge()
        with self.assertRaises(ValueError):
            bridge.complete(self.body)
        time.sleep(.3)
        self.assertNotIn("sample", self.calls)
        self.assertTrue(bridge.halted.is_set())
    def test_call_horizon_survives_new_bridge_state(self):
        self.config["max_provider_calls"] = 1
        self.config = nt.seal(self.config, "config_hash")
        self.fund()
        self.bridge().complete(self.body)
        with self.assertRaisesRegex(ValueError, "call_horizon"):
            self.bridge("new-state").complete(self.body)
        self.assertEqual(self.calls.count("sample"), 1)
    def test_two_successes_reuse_client_but_reserve_each_request(self):
        self.fund()
        bridge = self.bridge()
        bridge.complete(self.body)
        bridge.complete(self.body)
        self.assertEqual(self.calls.count("connect"), 1)
        self.assertEqual(self.calls.count("sample"), 2)
        runs = list(nt.load_json(self.child)["runs"].values())
        self.assertEqual([v["phases"] for v in runs], [["create_client", "sample"], ["sample"]])
    def test_state_is_private_exclusive_and_config_copied(self):
        bridge = self.bridge()
        self.config["condition"]["training_eligible"] = True
        self.assertFalse(bridge.config["condition"]["training_eligible"])
        self.config = bridge.config
        with self.assertRaises(FileExistsError):
            self.bridge()
        with self.assertRaises(ValueError):
            na.InstructionActorBridge(self.config, bridge.token, na.nl.ROOT / "docs" / "actor-output")
    def test_failed_local_delivery_persists_halt_without_fabricated_receipt(self):
        self.fund()
        bridge = self.bridge()
        result = bridge.complete(self.body)
        bridge.delivery_failed(result)
        self.assertEqual(self.records(bridge)[-1]["phase"], "delivery_failed")
        self.assertFalse(self.records(bridge)[-1]["runtime_receipt_available"])
        with self.assertRaisesRegex(ValueError, "unreconciled"):
            self.bridge("new-state").complete(self.body)
    def test_delayed_delivery_failure_marks_its_own_request(self):
        self.fund()
        bridge = self.bridge()
        first = bridge.complete(self.body)
        bridge.complete(self.body)
        bridge.delivery_failed(first)
        runs = list(nt.load_json(self.child)["runs"].values())
        self.assertEqual([r["status"] for r in runs], ["failed_unknown", "complete"])
    def test_parent_funding_rechecked_between_client_and_sample(self):
        self.fund()
        original = FixtureSampler.connect
        owner = self
        def connect(sampler, plan):
            client = original(sampler, plan)
            owner.change_ledger(owner.parent, lambda v: v["runs"][owner.grant["plan_hash"]].update(status="failed_unknown"))
            return client
        with patch.object(FixtureSampler, "connect", connect):
            with self.assertRaisesRegex(ValueError, "failed_unknown"):
                self.bridge().complete(self.body)
        self.assertIn("connect", self.calls)
        self.assertNotIn("sample", self.calls)
    def tls_server(self):
        from benchmark_tinker_bridge import create_material
        token, _, cert, key = create_material(self.root / "tls")
        bridge = self.bridge("tls", token)
        server = bridge.server(cert, key)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return bridge, server, cert
    def test_local_tls_auth_sse_and_strict_json_before_dispatch(self):
        self.fund()
        bridge, server, cert = self.tls_server()
        endpoint = f"https://localhost:{server.server_port}/v1/chat/completions"
        def request(raw, auth, extra=None):
            return urllib.request.urlopen(urllib.request.Request(endpoint, data=raw, headers={
                "Authorization": "Bearer " + auth, "Content-Type": "application/json", **(extra or {})}),
                context=ssl.create_default_context(cafile=cert), timeout=5)
        for raw, auth, extra, code in [(b"{}", "invalid", {}, 401),
                (b'{"model":"a","model":"b"}', bridge.token.decode(), {}, 400),
                (b'{"temperature":NaN}', bridge.token.decode(), {}, 400),
                (b'{}', bridge.token.decode(), {"Origin": "https://unrelated.example"}, 401)]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                request(raw, auth, extra)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.calls, [])
        body = {**self.body, "stream": True, "stream_options": {"include_usage": True}}
        with request(json.dumps(body).encode(), bridge.token.decode()) as response:
            self.assertEqual(response.headers.get_content_type(), "text/event-stream")
            data = response.read().decode()
        self.assertIn('"completion_tokens": 3', data)
        self.assertTrue(data.endswith("data: [DONE]\n\n"))
    @unittest.skipUnless(shutil.which("bun"), "Bun production runtime required")
    def test_real_pi_consumes_actor_sse_calls_read_and_returns_actual_receipt(self):
        self.config["limits"]["max_output_tokens"] = 512
        self.config = nt.seal(self.config, "config_hash")
        self.fund()
        call = copy.deepcopy(CALL)
        call["function"]["arguments"] = '{"path":"fixtures/notes.md"}'
        self.responses = [{"role": "assistant", "content": None, "tool_calls": [call]},
                          {"role": "assistant", "content": "Compare the two equal pieces."}]
        bridge, server, cert = self.tls_server()
        script = r'''
import { runHarnessEpisode } from './scripts/training/benchmark_harness_v3.ts';
const result = await runHarnessEpisode({id:'authored-instruction-actor-plumbing',
 transport:{kind:'provider',provider:'instruction-actor-offline',model:process.env.ACTOR_MODEL,
 endpoint:process.env.ACTOR_URL,apiKeyEnv:'ACTOR_FIXTURE_TOKEN',thinking:'off',
 modelMetadata:{contextWindow:32768,maxTokens:512,reasoning:false}},
 steps:[{kind:'message',text:'Read fixtures/notes.md and help me compare the pieces.'}],
 seed_files:{'fixtures/notes.md':'Authored fixture: two equal pieces.'},allowed_tools:['read'],surface:'chat',
 limits:{max_provider_calls:2,max_tool_calls:1,max_output_tokens:512,turn_timeout_ms:20000}});
// A full runtime trace can exceed a megabyte. Return only the actual receipt
// evidence under test, avoiding a large console write at process exit.
console.log(JSON.stringify({status:result.status,error_code:result.error_code,request_count:result.requests.length,
 tool_results:result.steps.flatMap(step => step.messages).filter(message => message.role === 'toolResult')}));
'''
        env = {k: v for k, v in os.environ.items() if k not in {"PYTHONHOME", "PYTHONPATH"}}
        env.update(NODE_EXTRA_CA_CERTS=str(cert), ACTOR_FIXTURE_TOKEN=bridge.token.decode(),
                   ACTOR_URL=f"https://localhost:{server.server_port}/v1", ACTOR_MODEL=na.MODEL)
        result = subprocess.run(["rtk", "proxy", "bun", "--eval", script], cwd=na.nl.ROOT,
                                env=env, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stderr[-1500:])
        value = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(value["status"], "completed", value.get("error_code"))
        self.assertEqual(value["request_count"], 2)
        self.assertIn("Authored fixture: two equal pieces.", json.dumps(value["tool_results"]))
        self.assertIn(CALL["id"], json.dumps(value["tool_results"]))
        self.assertTrue(value["tool_results"])
        self.assertFalse(any(message.get("isError") for message in value["tool_results"]))
        self.assertTrue(any(m["role"] == "tool" and m["tool_call_id"] == CALL["id"] for m in self.messages))
        self.assertEqual(self.calls.count("sample"), 2)
        self.assertFalse(any(v["training_eligible"] for v in self.records(bridge)))


def pinned_environment():
    try:
        return all(importlib.metadata.version(k) == v for k, v in na.nl.VERSIONS.items())
    except importlib.metadata.PackageNotFoundError:
        return False


@unittest.skipUnless(pinned_environment(), "pinned Tinker/cookbook/Transformers required")
class LocalPinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.object(na.nl, "skate_secret", side_effect=AssertionError("credentials forbidden")):
            cls.sampler = na.PinnedActorSampler()
    def test_real_tokenizer_tools_schema_and_history(self):
        messages = [{"role": "system", "content": "Exact runtime policy."},
                    {"role": "user", "content": "Read notes.md."},
                    {"role": "assistant", "content": None, "tool_calls": [CALL]},
                    {"role": "tool", "tool_call_id": CALL["id"], "content": "Actual contents."}]
        original = copy.deepcopy(messages)
        ids = self.sampler.prepare(na.prompted_messages(messages), [TOOL]).to_ints()
        text = self.sampler.decode(ids)
        self.assertEqual(messages, original)
        for expected in [na.ACTOR_PROMPT, "Exact runtime policy.", "Read a workspace file.", "notes.md", "Actual contents."]:
            self.assertIn(expected, text)
        self.assertIn("<function=read>", text)
        self.assertTrue(text.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n"))
    def test_original_xml_tokens_parse_with_one_transport_id_no_encoding_repair(self):
        text = '<tool_call>\n<function=read>\n<parameter=path>\nnotes.md\n</parameter>\n</function>\n</tool_call>'
        tokens = self.sampler.tokenizer.encode(text, add_special_tokens=False) + [na.nl.IM_END]
        original = tokens.copy()
        parsed = self.sampler.parse(tokens)
        self.assertEqual(tokens, original)
        self.assertTrue(parsed["parse_finished"])
        self.assertEqual(parsed["raw_text"], text)
        call = parsed["message"]["tool_calls"][0]
        self.assertEqual(json.loads(call["function"]["arguments"]), {"path": "notes.md"})
        self.assertEqual(parsed["tool_id_sources"], ["bridge_transport"])
        self.assertRegex(call["id"], r"^call_[a-f0-9]{32}$")
        delta = json.loads(na.sse_response({"id": "x", "created": 1, "model": na.MODEL,
            "choices": [{"message": parsed["message"], "finish_reason": "tool_calls"}]}, False).decode().splitlines()[0][6:])
        self.assertEqual(delta["choices"][0]["delta"]["tool_calls"][0]["id"], call["id"])
    def test_parser_provided_id_is_preserved(self):
        from tinker_cookbook.renderers.base import ToolCall
        message = {"content": "", "tool_calls": [ToolCall.model_validate(CALL)]}
        with patch.object(self.sampler.renderer, "parse_response", return_value=(message, SimpleNamespace(is_clean=True))):
            parsed = self.sampler.parse([101, na.nl.IM_END])
        self.assertEqual(parsed["message"]["tool_calls"][0]["id"], CALL["id"])
        self.assertEqual(parsed["tool_id_sources"], ["parser"])
    def test_duplicate_xml_parameter_is_rejected_instead_of_silently_overwritten(self):
        text = '<tool_call><function=read><parameter=path>a</parameter><parameter=path>b</parameter></function></tool_call>'
        tokens = self.sampler.tokenizer.encode(text, add_special_tokens=False) + [na.nl.IM_END]
        with self.assertRaisesRegex(ValueError, "duplicate_tool_parameter"):
            self.sampler.parse(tokens)
    def test_real_malformed_and_unterminated_xml_remain_unparsed(self):
        for text in ['<tool_call>broken</tool_call>', '<tool_call><function=read><parameter=path>notes.md</parameter>']:
            with self.subTest(text=text):
                ids = self.sampler.tokenizer.encode(text, add_special_tokens=False) + [na.nl.IM_END]
                result = self.sampler.parse(ids)
                self.assertTrue(result["unparsed_tool_calls"])
                self.assertEqual(result["raw_text"], text)
                self.assertFalse(result["message"].get("tool_calls"))
    def test_actual_sdk_sampling_defaults_without_remote_client(self):
        import tinker
        sampler = object.__new__(na.PinnedActorSampler)
        sampler.sdk, sampler.config = tinker, {"config_hash": "fixture"}
        captured = {}
        def sample(prompt, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(result=lambda timeout: "offline")
        settings = {**na.IDENTITY, "max_tokens": 20}
        plan = {"prompt_tokens": 10, "prompt_token_ids_hash": nt.native_hash(Prompt(10).to_ints()),
                "sampling": {**settings, "seed": None, "stop": [na.nl.IM_END]}}
        with patch.object(na, "require_dispatch") as gate:
            result = sampler.sample(SimpleNamespace(sample=sample), Prompt(10), settings, 5, plan)
        self.assertEqual(result, "offline")
        gate.assert_called_once_with(sampler.config, plan, "sample")
        self.assertEqual(captured["sampling_params"].model_dump(mode="json"), plan["sampling"])
        self.assertEqual(captured["num_samples"], 1)
        self.assertIs(captured["include_prompt_logprobs"], False)
    def test_direct_client_creation_without_reserved_plan_cannot_read_credentials(self):
        self.sampler.config = {"config_hash": "fixture"}
        with patch.object(na.nl, "skate_secret", side_effect=AssertionError("credentials forbidden")):
            with self.assertRaises(ValueError):
                self.sampler.connect({})
        self.sampler.config = None


if __name__ == "__main__":
    unittest.main()
