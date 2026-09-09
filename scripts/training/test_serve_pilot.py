"""Provider-free serving checks: ownership, authorization, bounds and accounting."""
from contextlib import contextmanager
from dataclasses import replace
import http.client
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from serve_pilot import Checkpoint, MAX_BODY, MAX_COMPLETION, MAX_PROMPT, MODEL_ALIAS, NativeSampler, Pilot, RequestError, load_budget, load_token, make_server


class FakeSampler:
    def __init__(self):
        self.calls = []
        self.prompt_tokens = 8
        self.fail = False
        self.tool_calls = []
        self.prepared = []

    def prepare(self, messages, tools):
        self.prepared.append((messages, tools))
        return messages, self.prompt_tokens

    def sample(self, prompt, max_tokens, temperature):
        self.calls.append((prompt, max_tokens, temperature))
        if self.fail:
            raise RuntimeError("secret provider details must not escape")
        return {"text": "A test answer", "completion_tokens": 3, "tool_calls": self.tool_calls,
                "finish_reason": "tool_calls" if self.tool_calls else "stop"}


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.token = b"a" * 48
        self.sampler = FakeSampler()
        self.reservations = []
        self.reservation_active = False
        self.deny_budget = False
        @contextmanager
        def reserve(prompt, completion):
            if self.deny_budget:
                raise ValueError("Budget exhausted")
            self.reservations.append((prompt, completion))
            self.reservation_active = True
            try:
                yield
            finally:
                self.reservation_active = False
        self.checkpoint = Checkpoint("did:plc:owner", "thinkingmachines/Inkling-Small", "tinker://run/sampler_weights/frozen", "tml_v0", 0.1)
        self.pilot = Pilot(self.checkpoint, self.token, self.sampler, reserve)
        self.body = {"model": MODEL_ALIAS, "messages": [{"role": "user", "content": "Teach fractions"}]}
        self.tools = [{"type": "function", "function": {"name": "plan", "description": "Plan a lesson",
                       "parameters": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}, "strict": False}}]
        self.tool_call = {"id": "call_1", "type": "function", "function": {"name": "plan", "arguments": '{"topic":"fractions"}'}}

    def test_only_alias_and_no_owner_or_checkpoint_override(self):
        for alteration in ({"model": self.checkpoint.sampler_path}, {"owner_did": "did:plc:other"},
                           {"sampler_path": "tinker://other/sampler_weights/other"}, {"reasoning_effort": "high"}):
            with self.assertRaises(RequestError):
                self.pilot.complete({**self.body, **alteration})
        self.assertEqual(self.sampler.calls, [])
        self.assertEqual(self.reservations, [])

    def test_limits_prevent_sampling(self):
        for alteration in ({"max_tokens": MAX_COMPLETION + 1}, {"max_tokens": True}, {"temperature": float("nan")},
                           {"temperature": float("inf")}, {"temperature": -1}, {"stream": "false"},
                           {"messages": [{"role": "tool", "content": "x"}]}):
            with self.assertRaises(RequestError):
                self.pilot.complete({**self.body, **alteration})
        self.sampler.prompt_tokens = MAX_PROMPT + 1
        with self.assertRaises(RequestError):
            self.pilot.complete(self.body)
        self.assertEqual(self.sampler.calls, [])
        self.assertEqual(self.reservations, [])

    def test_reserve_before_dispatch_and_retain_failure_reservation(self):
        original = self.sampler.sample
        def sample(*args):
            self.assertTrue(self.reservation_active)
            return original(*args)
        self.sampler.sample = sample
        self.pilot.complete(self.body)
        self.sampler.fail = True
        with self.assertRaises(RuntimeError):
            self.pilot.complete(self.body)
        self.assertEqual(self.reservations, [(8, MAX_COMPLETION), (8, MAX_COMPLETION)])
        self.deny_budget = True
        with self.assertRaises(ValueError):
            self.pilot.complete(self.body)
        self.assertEqual(len(self.sampler.calls), 2)
        self.assertFalse(self.pilot.generation_lock.locked())

    def test_single_generation(self):
        self.pilot.generation_lock.acquire()
        with self.assertRaises(RequestError) as error:
            self.pilot.complete(self.body)
        self.assertEqual(error.exception.status, 429)
        self.pilot.generation_lock.release()
        self.assertEqual(self.sampler.calls, [])

    def test_no_non_loopback_server(self):
        for host in ("0.0.0.0", "localhost", "::", "::1"):
            with self.assertRaises(ValueError):
                make_server(self.pilot, host=host, port=0)

    def test_native_sampling_uses_frozen_checkpoint_and_training_renderer(self):
        calls = {}
        prompt = SimpleNamespace(length=8)
        class Renderer:
            def build_generation_prompt(inner, messages, **kwargs):
                calls["messages"] = messages
                calls["effort"] = kwargs["effort"]
                return prompt
            def get_stop_sequences(inner):
                return [151645]
            def parse_response(inner, tokens):
                calls["decoded_tokens"] = tokens
                return {"role": "assistant", "content": "rendered answer", "tool_calls": [self.tool_call]}, "stop"
        class Client:
            async def sample_async(inner, rendered_prompt, **kwargs):
                calls["prompt"] = rendered_prompt
                calls["sampling"] = kwargs
                return SimpleNamespace(sequences=[SimpleNamespace(tokens=[1, 2], stop_reason="stop")])
        class Service:
            def create_sampling_client(inner, **kwargs):
                calls["checkpoint"] = kwargs
                return Client()
        def get_renderer(name, tokenizer, **kwargs):
            calls["renderer"] = (name, tokenizer, kwargs)
            return Renderer()
        renderers = SimpleNamespace(get_renderer=get_renderer, get_text_content=lambda message: message["content"])
        modules = {"tinker": SimpleNamespace(ServiceClient=Service, SamplingParams=lambda **kwargs: kwargs),
                   "tinker_cookbook": SimpleNamespace(renderers=renderers),
                   "tinker_cookbook.tokenizer_utils": SimpleNamespace(get_tokenizer=lambda model: "tokenizer:" + model)}
        with patch.dict("sys.modules", modules), patch.dict("os.environ", {"TINKER_API_KEY": "test-only"}):
            sampler = NativeSampler(self.checkpoint)
            messages = [{"role": "system", "content": "Exact Keating system\n  preserve whitespace."}, *self.body["messages"]]
            rendered, length = sampler.prepare(messages, self.tools)
            result = sampler.sample(rendered, 64, 1.0)
        self.assertEqual(calls["checkpoint"], {"model_path": self.checkpoint.sampler_path})
        self.assertEqual(calls["renderer"][0], "tml_v0")
        self.assertEqual(calls["renderer"][2], {"model_name": self.checkpoint.model})
        self.assertIs(calls["prompt"], prompt)
        self.assertEqual(length, 8)
        self.assertEqual(calls["effort"], 0.1)
        self.assertEqual(calls["messages"][0], messages[0])
        self.assertEqual(calls["messages"][1]["role"], "tool_declare")
        self.assertEqual(json.loads(calls["messages"][1]["content"]), self.tools)
        self.assertEqual(calls["messages"][2:], messages[1:])
        self.assertEqual(len(messages), 2)
        self.assertEqual(calls["sampling"]["sampling_params"],
                         {"max_tokens": 64, "temperature": 1.0, "top_p": 1.0, "stop": [151645]})
        self.assertEqual(result["text"], "rendered answer")
        self.assertEqual(result["tool_calls"][0]["function"], self.tool_call["function"])
        self.assertTrue(result["tool_calls"][0]["id"].startswith("call_"))
        self.assertNotEqual(result["tool_calls"][0]["id"], self.tool_call["id"])
        self.assertEqual(result["finish_reason"], "tool_calls")

    def test_tool_round_trip_preserves_messages_and_schemas(self):
        messages = [{"role": "system", "content": "Keating\n" + "Exact prompt. " * 5000},
                    {"role": "user", "content": [{"type": "text", "text": "Teach fractions"}]},
                    {"role": "assistant", "content": None, "tool_calls": [self.tool_call]},
                    {"role": "tool", "content": "A fractions lesson", "tool_call_id": "call_1"}]
        request = {**self.body, "messages": messages, "tools": self.tools, "tool_choice": "auto", "store": False}
        self.sampler.tool_calls = [{**self.tool_call, "id": "call_2"}]
        result = self.pilot.complete(request)
        self.assertEqual(self.sampler.prepared[0], (messages, self.tools))
        self.assertEqual(result["choices"][0]["message"]["tool_calls"], self.sampler.tool_calls)
        self.assertEqual(result["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(request["messages"][0]["content"], messages[0]["content"])

    def test_tool_validation_and_choice_fail_closed(self):
        for alteration in ({"tool_choice": "required"}, {"tool_choice": {"type": "function", "function": {"name": "plan"}}},
                           {"store": True}, {"tools": [{"type": "web_search"}]}, {"tools": self.tools * 2},
                           {"messages": [*self.body["messages"], {"role": "tool", "content": "x", "tool_call_id": "unknown"}]}):
            with self.assertRaises(RequestError):
                self.pilot.complete({**self.body, **alteration})
        self.assertEqual(self.sampler.calls, [])
        self.sampler.tool_calls = [self.tool_call]
        with self.assertRaises(RequestError) as error:
            self.pilot.complete({**self.body, "tools": self.tools, "tool_choice": "none"})
        self.assertEqual(error.exception.status, 502)
        self.assertEqual(self.sampler.prepared[-1][1], [])
        self.sampler.tool_calls = [self.tool_call, {**self.tool_call, "id": "call_2"}]
        with self.assertRaises(RequestError):
            self.pilot.complete({**self.body, "tools": self.tools, "parallel_tool_calls": False})

    def test_token_and_checkpoint_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            token_path = directory / "token"
            token_path.write_bytes(self.token)
            token_path.chmod(0o600)
            self.assertEqual(load_token(token_path), self.token)
            token_path.chmod(0o644)
            with self.assertRaises(ValueError):
                load_token(token_path)
            token_path.chmod(0o600)
            symlink = directory / "linked"
            symlink.symlink_to(token_path)
            with self.assertRaises(OSError):
                load_token(symlink)
            result_path = directory / "result.json"
            result_path.write_text(json.dumps(self.checkpoint.__dict__))
            checkpoint = Checkpoint.load(directory)
            result_path.write_text(json.dumps({**self.checkpoint.__dict__, "owner_did": "did:plc:other"}))
            self.assertEqual(checkpoint.owner_did, "did:plc:owner")
            result_path.write_text(json.dumps({**self.checkpoint.__dict__, "sampler_path": "https://attacker.test"}))
            with self.assertRaises(ValueError):
                Checkpoint.load(directory)

    def test_checkpoint_public_alias_is_validated_and_defaults_for_old_results(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            result_path = directory / "result.json"
            original = {name: value for name, value in self.checkpoint.__dict__.items() if name != "public_model_id"}
            result_path.write_text(json.dumps(original))
            self.assertEqual(Checkpoint.load(directory).public_model_id, MODEL_ALIAS)
            result_path.write_text(json.dumps({**original, "public_model_id": "keating-bot-latest"}))
            selected = Checkpoint.load(directory)
            self.assertEqual(selected.public_model_id, "keating-bot-latest")
            self.assertEqual(selected.sampler_path, self.checkpoint.sampler_path)
            for bad in ("tinker://run/sampler_weights/frozen", "https://other.test", "", None, "A" * 65):
                result_path.write_text(json.dumps({**original, "public_model_id": bad}))
                with self.assertRaises(ValueError):
                    Checkpoint.load(directory)

    def test_child_run_reuses_explicit_existing_budget(self):
        from pilot_budget import PilotBudget
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            original = directory / "original-budget.json"
            child = directory / "identity-sft-run"
            child.mkdir()
            with self.assertRaises(ValueError):
                load_budget(child, self.checkpoint)
            with self.assertRaises(ValueError):
                load_budget(child, self.checkpoint, original)
            self.assertFalse(original.exists())
            with PilotBudget(original).reserve("test-initialization"):
                pass
            with load_budget(child, self.checkpoint, original).reserve("serve", prefill=50, sample=20):
                pass
            ledger = json.loads(original.read_text())
            self.assertEqual([event["operation"] for event in ledger["events"]], ["test-initialization", "serve"])
            self.assertGreater(ledger["reserved_usd"], 0)
            self.assertFalse((child / "budget.json").exists())
            ledger["model"] = "another/model"
            original.write_text(json.dumps(ledger))
            with self.assertRaises(ValueError):
                load_budget(child, self.checkpoint, original)

    def test_http_authorization_cors_alias_json_sse_and_redaction(self):
        server = make_server(self.pilot, port=0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def request(method, path, body=None, auth=True, headers=None):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            values = {"Content-Type": "application/json"}
            if auth:
                values["Authorization"] = "Bearer " + self.token.decode()
            values.update(headers or {})
            connection.request(method, path, json.dumps(body) if body is not None else None, values)
            response = connection.getresponse()
            result = (response.status, response.read().decode(), dict(response.headers))
            connection.close()
            return result
        try:
            for route in ("/v1/models", "/v1/chat/completions"):
                status, _, _ = request("GET" if route.endswith("models") else "POST", route, auth=False)
                self.assertEqual(status, 401)
            status, response, _ = request("GET", "/v1/models")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response)["data"][0]["id"], MODEL_ALIAS)
            self.assertNotIn(self.checkpoint.owner_did, response)
            self.assertNotIn(self.checkpoint.sampler_path, response)
            self.assertEqual(request("GET", "/v1/models", headers={"Origin": "https://attacker.test"})[0], 403)
            self.assertEqual(request("GET", "/v1/models", headers={"Authorization": "Bearer wrong"})[0], 401)
            self.assertEqual(request("GET", "/v1/models", headers={"Host": "attacker.test"})[0], 403)
            status, _, headers = request("OPTIONS", "/v1/chat/completions", auth=False,
                                         headers={"Origin": "http://localhost:3000", "Access-Control-Request-Headers": "authorization,content-type,x-stainless-lang,x-stainless-package-version,x-stainless-retry-count"})
            self.assertEqual(status, 204)
            self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:3000")
            self.assertIn("x-stainless-runtime-version", headers["Access-Control-Allow-Headers"])
            self.assertEqual(request("OPTIONS", "/v1/chat/completions", auth=False,
                headers={"Origin": "http://localhost:3000", "Access-Control-Request-Headers": "x-unrecognized-secret"})[0], 403)
            status, response, _ = request("POST", "/v1/chat/completions", self.body)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response)["usage"]["total_tokens"], 11)
            status, response, headers = request("POST", "/v1/chat/completions",
                {**self.body, "stream": True, "stream_options": {"include_usage": True}})
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "text/event-stream")
            self.assertTrue(response.endswith("data: [DONE]\n\n"))
            self.assertIn('"total_tokens": 11', response)
            self.sampler.tool_calls = [self.tool_call]
            status, response, _ = request("POST", "/v1/chat/completions",
                {**self.body, "tools": self.tools, "tool_choice": "auto", "stream": True})
            self.assertEqual(status, 200)
            event = json.loads(response.split("\n\n")[0][6:])
            self.assertEqual(event["choices"][0]["delta"]["tool_calls"], [{"index": 0, **self.tool_call}])
            self.assertIn('"finish_reason": "tool_calls"', response)
            self.sampler.tool_calls = []
            oversized = {**self.body, "messages": [{"role": "user", "content": "a" * MAX_BODY}]}
            self.assertEqual(request("POST", "/v1/chat/completions", oversized)[0], 413)
            self.sampler.fail = True
            status, response, _ = request("POST", "/v1/chat/completions", self.body)
            self.assertEqual(status, 503)
            self.assertNotIn("secret provider details", response)
            self.sampler.fail = False
            self.pilot.checkpoint = replace(self.checkpoint, public_model_id="keating-bot-latest")
            status, response, _ = request("GET", "/v1/models")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response)["data"][0]["id"], "keating-bot-latest")
            self.assertEqual(json.loads(response)["data"][0]["display_name"], "Keating Bot (latest)")
            self.assertEqual(request("POST", "/v1/chat/completions", self.body)[0], 400)
            status, response, _ = request("POST", "/v1/chat/completions", {**self.body, "model": "keating-bot-latest"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(response)["model"], "keating-bot-latest")
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
