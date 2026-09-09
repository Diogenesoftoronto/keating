import copy
from types import SimpleNamespace
import unittest
import benchmark_lightning as lightning


class LightningTests(unittest.TestCase):
    def test_native_prefix_preserves_prompt_schema_and_history(self):
        prompt = SimpleNamespace(length=12, to_ints=lambda: [1] * 12)
        captured = {}
        def prefix(tools, system_prompt):
            captured.update(tools=tools, system=system_prompt)
            return [{"role": "system", "content": system_prompt}]
        def build(messages):
            captured["messages"] = messages
            return prompt
        tools = [{"type": "function", "function": {"name": "quiz", "description": "quiz", "parameters": {"type": "object"}}}]
        history = [{"role": "user", "content": "Exact history"}]
        suite = {"context": {"system_prompt": "Exact\n prompt", "tools": tools}}
        payload = {"messages": [{"role": "system", "content": "Exact\n prompt"}, *history], "tools": tools, "max_tokens": 700}
        prepared = lightning.prepare(suite, {"requests": [{"case_id": "one", "payload": payload}]},
            SimpleNamespace(create_conversation_prefix_with_tools=prefix, build_generation_prompt=build), lambda value: value)
        self.assertEqual(captured["tools"], [tools[0]["function"]])
        self.assertEqual(captured["system"], "Exact\n prompt")
        self.assertEqual(captured["messages"][1:], history)
        self.assertLess(lightning.estimate(prepared), .5)
        prompt.length = 65536
        with self.assertRaisesRegex(ValueError, "context exceeded"):
            lightning.prepare(suite, {"requests": [{"case_id": "one", "payload": payload}]},
                SimpleNamespace(create_conversation_prefix_with_tools=prefix, build_generation_prompt=build), lambda value: value)

    def test_overspend_and_empty_plan_rejected(self):
        for prepared in ([], [{"prompt_tokens": 1_000_000, "payload": {"max_tokens": 100_000}}]):
            with self.assertRaises(ValueError):
                lightning.estimate(prepared)
        qwen = [{"prompt_tokens": 135634, "payload": {"max_tokens": 13400}}]
        self.assertLess(lightning.estimate(qwen, 1.86, 5.595, 1, lightning.QWEN_ALLOCATION), lightning.QWEN_ALLOCATION)
        with self.assertRaises(ValueError):
            lightning.estimate(qwen, 1.86, 5.595, 5, lightning.QWEN_ALLOCATION)
        with self.assertRaises(ValueError):
            lightning.estimate(qwen, 1.86, 5.595, 0, lightning.QWEN_ALLOCATION)

    def test_failure_keeps_receipts_without_secret_and_no_retry(self):
        from unittest.mock import patch
        cases = [{"id": "one", "expect": {"visible_response": True}}, {"id": "two", "expect": {"visible_response": True}}]
        prepared = [{"case_id": c["id"], "prompt": None, "prompt_tokens": 12, "prompt_sha256": "hash",
                     "payload": {"max_tokens": 700, "temperature": .1, "top_p": 1, "seed": 42}} for c in cases]
        calls, saved = [], []
        def sample(*args, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise RuntimeError("secret-never-output")
            return SimpleNamespace(result=lambda: SimpleNamespace(sequences=[SimpleNamespace(tokens=[1, 2], stop_reason="stop")]))
        renderer = SimpleNamespace(get_stop_sequences=lambda: ["stop"], parse_response=lambda tokens: ({"content": "Answer"}, True))
        with patch.object(lightning.bench, "run_base", return_value={"results": []}):
            run = lightning.execute({"cases": cases}, {}, prepared, renderer, SimpleNamespace(sample=sample),
                lambda **kwargs: kwargs, lambda parsed: parsed["content"], lambda value: saved.append(copy.deepcopy(value)))
        self.assertEqual(len(calls), 2)
        self.assertEqual([r["delivery"]["status"] for r in run["results"]], ["error", "pass"])
        self.assertNotIn("secret-never-output", str(run))
        self.assertEqual(saved[0]["results"][1]["delivery"]["status"], "missing")
        self.assertIn("wall_seconds", run["results"][1]["native_receipt"])


if __name__ == "__main__":
    unittest.main()
