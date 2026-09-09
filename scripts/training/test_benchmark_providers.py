"""Offline native translation and separate-budget invariants; no provider calls."""
import copy
from pathlib import Path
import tempfile
import unittest

import benchmark as bench
import benchmark_providers as providers


class ProviderBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.suite = bench.load_suite(bench.DEFAULT_SUITE)
        self.plan = bench.make_plan(self.suite)

    def arm(self, provider="openai-responses", params=None):
        return {"label": "Test model", "provider": provider, "model": "test-model", "key_file": "/unused/key",
                "input_rate": 1.0, "output_rate": 2.0, "native_params": params or {}}

    def test_exact_frozen_context_and_caps_in_every_native_wire_format(self):
        request = self.plan["requests"][0]
        original = copy.deepcopy(request)
        for provider in providers.ALLOWED_PARAMS:
            arm = self.arm(provider)
            providers.validate_arm(arm)
            wire = providers.build_request(arm, request)["payload"]
            prompt = self.suite["context"]["system_prompt"]
            declarations = self.suite["context"]["tools"]
            if provider == "openai-responses":
                self.assertEqual(wire["instructions"], prompt)
                self.assertEqual(wire["max_output_tokens"], request["payload"]["max_tokens"])
                self.assertTrue(all(tool["strict"] is False for tool in wire["tools"]))
                self.assertEqual(wire["tools"][0]["parameters"], declarations[0]["function"]["parameters"])
            elif provider == "anthropic":
                self.assertEqual(wire["system"], prompt)
                self.assertEqual(wire["tools"][0]["input_schema"], declarations[0]["function"]["parameters"])
                self.assertNotIn("seed", wire)
            elif provider == "gemini":
                self.assertEqual(wire["systemInstruction"]["parts"][0]["text"], prompt)
                self.assertEqual(wire["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"], declarations[0]["function"]["parameters"])
                self.assertEqual(wire["generationConfig"]["maxOutputTokens"], request["payload"]["max_tokens"])
            else:
                self.assertEqual(wire["messages"], request["payload"]["messages"])
                self.assertEqual(wire["tools"], declarations)
            self.assertNotIn("rubric", wire)
        self.assertEqual(request, original)

    def test_nested_gemini_params_keep_caps_and_disclose_unsupported_controls(self):
        arm = self.arm("gemini", {"generationConfig": {"temperature": .1, "topP": 1, "seed": 42, "thinkingConfig": {"thinkingLevel": "low"}}})
        providers.validate_arm(arm)
        body = providers.build_request(arm, self.plan["requests"][0])["payload"]
        self.assertEqual(body["generationConfig"]["maxOutputTokens"], 700)
        self.assertEqual(body["generationConfig"]["thinkingConfig"], {"thinkingLevel": "low"})
        effective, note = providers.compatibility(self.arm("anthropic", {"thinking": {"type": "adaptive"}}), self.plan)
        self.assertIsNone(effective["seed"])
        self.assertIsNone(effective["temperature"])
        self.assertFalse(note["identical_generation_settings"])
        self.assertEqual(effective["max_output_tokens"], self.plan["settings"]["max_tokens"])
        with self.assertRaises(ValueError):
            providers.validate_arm(self.arm("gemini", {"generationConfig": {"maxOutputTokens": 4}}))

    def test_openai_null_incomplete_details_and_thinking_usage(self):
        response, usage, receipt = providers.normalize("openai-responses", {
            "model": "test-model-actual", "id": "response-1", "incomplete_details": None,
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "A helpful explanation"}]}],
            "usage": {"input_tokens": 100, "output_tokens": 20, "output_tokens_details": {"reasoning_tokens": 3}}}, "case")
        self.assertEqual(response["content"], "A helpful explanation")
        self.assertEqual(response["finish_reason"], "stop")
        self.assertEqual(usage["completion_tokens"], 20)
        self.assertEqual(receipt["model"], "test-model-actual")
        _, usage, _ = providers.normalize("gemini", {"candidates": [{"content": {"parts": [{"text": "hidden", "thought": True}, {"text": "visible"}]}}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20, "thoughtsTokenCount": 7}}, "case")
        self.assertEqual(usage["completion_tokens"], 27)
        response, _, _ = providers.normalize("anthropic", {"content": [{"type": "thinking", "thinking": "hidden"},
            {"type": "tool_use", "id": "call-1", "name": "feedback", "input": {"signal": "up"}}],
            "usage": {"input_tokens": 4, "cache_read_input_tokens": 96, "output_tokens": 12}}, "case")
        self.assertEqual(response["content"], "")
        self.assertEqual(response["tool_calls"][0]["function"]["name"], "feedback")

    def test_separate_ledger_gates_before_dispatch_and_settles_known_usage(self):
        budget = providers.BatchBudget(self.path / "budget.json", .001)
        calls = []
        run = providers.run_arm(self.suite, self.plan, self.arm(), budget, lambda *_: None, lambda *_: calls.append(1))
        self.assertEqual(calls, [])
        self.assertEqual(run["status"], "budget_limited")
        self.assertTrue(all(row["delivery"]["status"] == "missing" for row in run["results"]))
        budget = providers.BatchBudget(self.path / "another.json", 19.5)
        reservation = budget.reserve("a", "x", 10)
        self.assertIsNone(budget.reserve("b", "y", 10))
        budget.settle(reservation, .1)
        self.assertIsNotNone(budget.reserve("b", "y", 10))
        state = bench.read_json(budget.path)
        self.assertEqual(state["estimated_usage_cost_usd"], .1)
        self.assertEqual(state["reserved_usd"], 10)

    def test_failed_requests_retain_all_cases_and_reservations_without_secrets(self):
        budget = providers.BatchBudget(self.path / "budget.json", 19.5)
        def fail(*_):
            raise RuntimeError("private-secret-value")
        run = providers.run_arm(self.suite, self.plan, self.arm(), budget, lambda *_: None, fail)
        bench.verify_run(self.suite, run)
        self.assertEqual(len(run["results"]), 8)
        self.assertTrue(all(row["delivery"]["status"] == "error" for row in run["results"]))
        self.assertNotIn("private-secret-value", bench.canonical(run))
        self.assertGreater(bench.read_json(budget.path)["reserved_usd"], 0)
        self.assertTrue(all(row["timing"]["wall_time_seconds"] >= 0 for row in run["results"]))
        error = providers.safe_error({"error": {"message": "private-secret-value", "type": "invalid_request_error", "param": "tools[0].parameters"}}, 400)
        self.assertNotIn("private-secret-value", bench.canonical(error))
        self.assertEqual(error["error"]["provider_type"], "invalid_request_error")


if __name__ == "__main__":
    unittest.main()
