import copy
import json
from pathlib import Path
import ssl
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from benchmark_tinker_bridge import Bridge, RequestError, create_material, create_server, native_conversation, validate_payload


def payload():
    return {"model": "inkling-small-base", "messages": [{"role": "system", "content": "Exact Keating prompt"},
        {"role": "user", "content": [{"type": "text", "text": "Why do gear ratios change?"}]}],
        "max_tokens": 3000, "stream": True, "stream_options": {"include_usage": True}, "store": False,
        "tools": [{"type": "function", "function": {"name": "feedback", "description": "Record feedback",
                   "parameters": {"type": "object", "properties": {"signal": {"type": "string"}}, "required": ["signal"]}}}]}


class FakePrompt:
    length = 7
    def to_ints(self): return [1, 2, 3, 4, 5, 6, 7]


class FakeSampler:
    def __init__(self, spec, key_env): self.spec = spec
    def prepare(self, messages, tools): return FakePrompt()
    def sample(self, prompt, settings):
        return {"text": "Let us compare wheel turns.", "tool_calls": [{"id": "native-call", "type": "function",
                "function": {"name": "feedback", "arguments": '{"signal":"confused"}'}}],
                "completion_tokens": 3, "parse_finished": True, "stop_reason": "stop", "finish_reason": "tool_calls"}


class BridgeTests(unittest.TestCase):
    def test_real_pi_payload_and_explicit_unsupported_settings(self):
        spec, messages, tools, settings = validate_payload(payload())
        self.assertEqual(settings, {"max_tokens": 3000, "temperature": 1., "top_p": 1.})
        self.assertEqual(messages, payload()["messages"])
        self.assertEqual(tools, payload()["tools"])
        for patch in ({"max_tokens": 0}, {"max_completion_tokens": 3000}, {"reasoning_effort": "high"},
                      {"parallel_tool_calls": False}, {"tool_choice": "required"}, {"store": True}, {"unexpected": 1}):
            with self.subTest(patch=patch), self.assertRaises(RequestError): validate_payload({**payload(), **patch})
        self.assertEqual(validate_payload({**payload(), "temperature": .3, "top_p": .8, "seed": 42})[3],
                         {"max_tokens": 3000, "temperature": .3, "top_p": .8, "seed": 42})

    def test_native_tool_history_keeps_prompt_schema_and_real_call_ids(self):
        class Renderer:
            def create_conversation_prefix_with_tools(self, tools, system_prompt):
                self.tools, self.system_prompt = tools, system_prompt
                return [{"role": "system", "content": system_prompt}]
        body = payload()
        body["messages"] += [{"role": "assistant", "content": None, "tool_calls": [{"id": "call-7", "type": "function",
            "function": {"name": "feedback", "arguments": '{"signal":"confused"}'}}]},
            {"role": "tool", "tool_call_id": "call-7", "content": "Recorded confused feedback."}]
        original = copy.deepcopy(body)
        from tinker_cookbook.renderers.base import ToolCall
        renderer = Renderer()
        history = native_conversation(body["messages"], body["tools"], renderer, ToolCall.model_validate)
        self.assertEqual(renderer.system_prompt, "Exact Keating prompt")
        self.assertEqual(renderer.tools, [body["tools"][0]["function"]])
        self.assertEqual(history[-1]["name"], "feedback")
        self.assertEqual(history[-1]["tool_call_id"], "call-7")
        self.assertEqual(history[-2]["tool_calls"][0].id, "call-7")
        self.assertEqual(body, original)

    def test_native_usage_and_failed_requests_remain_truthful(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Bridge(b"opaque-token", directory, sampler_factory=FakeSampler)
            result = bridge.complete(payload())
            self.assertEqual(result["usage"], {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10})
            rows = [json.loads(line) for line in (Path(directory) / "usage.jsonl").read_text().splitlines()]
            self.assertEqual([row["status"] for row in rows], ["started", "completed"])
            self.assertIsNone(rows[-1]["reasoning_tokens"])
            self.assertFalse(rows[-1]["cache_hits_measured"])
            self.assertNotIn("cached_input_tokens", result["usage"])
            self.assertNotIn("Exact Keating prompt", json.dumps(rows))
            def fail(*args): raise RuntimeError("private-provider-details")
            bridge.sampler_factory = fail
            with self.assertRaises(RuntimeError): bridge.complete({**payload(), "model": "qwen3-8-27b"})
            last = json.loads((Path(directory) / "usage.jsonl").read_text().splitlines()[-1])
            self.assertEqual(last["status"], "error")
            self.assertIsNone(last["output_tokens"])
            self.assertNotIn("private-provider-details", json.dumps(last))

    def test_tls_auth_streamed_tools_and_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "bridge"
            token, token_file, certificate, key = create_material(state)
            bridge = Bridge(token, state, sampler_factory=FakeSampler)
            server = create_server(bridge, certificate, key)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                context = ssl.create_default_context(cafile=str(certificate))
                endpoint = f"https://127.0.0.1:{server.server_port}/v1"
                request = urllib.request.Request(endpoint + "/chat/completions", data=json.dumps(payload()).encode(),
                    headers={"Authorization": "Bearer " + token.decode(), "Content-Type": "application/json"})
                with urllib.request.urlopen(request, context=context) as response:
                    chunks = response.read().decode()
                self.assertIn('"tool_calls"', chunks)
                self.assertIn('"completion_tokens": 3', chunks)
                self.assertIn("data: [DONE]", chunks)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(endpoint + "/models", context=context)
                self.assertEqual(error.exception.code, 401)
                self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__": unittest.main()
