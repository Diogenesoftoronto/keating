"""Native benchmark dispatch invariants; all sampling and reservations are injected."""
from contextlib import contextmanager
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

import benchmark as bench
import benchmark_tinker as native
from pilot_budget import PilotBudget


class Prompt:
    def __init__(self, count=40):
        self.length = count

    def to_ints(self):
        return list(range(self.length))


class Renderer:
    def __init__(self, count=40):
        self.count = count
        self.conversations = []

    def build_generation_prompt(self, messages, effort):
        self.conversations.append((messages, effort))
        return Prompt(self.count)

    def get_stop_sequences(self):
        return [999]

    def parse_response(self, tokens):
        return {"content": "A useful response.", "tool_calls": []}, True


class NativeBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.budget_file = self.directory / "budget.json"
        with PilotBudget(self.budget_file).reserve("existing"):
            pass
        cases = [{"id": label, "category": "teaching", "messages": [{"role": "user", "content": "Help me with " + label}],
                  "max_tokens": cap, "expect": {"visible_response": True, "allowed_tools": []},
                  "rubric": {"correctness": {"zero": "Wrong", "one": "Partial", "two": "Sound"}}}
                 for label, cap in [("brief", 700), ("exam", 6500)]]
        context = {"system_prompt": "Exact app prompt\n  preserve its whitespace", "tools": [{"type": "function", "function": {
            "name": "feedback", "parameters": {"type": "object", "properties": {}}}}]}
        context.update(system_prompt_sha256=bench.digest(context["system_prompt"]), tool_schema_sha256=bench.digest(bench.canonical(context["tools"])))
        self.suite = {"cases": cases, "cases_doc": {"benchmark_id": "test-native-v1", "core_case_ids": [c["id"] for c in cases]},
                      "context": context, "suite_sha256": "frozen-suite", "rubric": {"review_protocol": []}}
        self.plan = bench.make_plan(self.suite)
        self.renderer = Renderer()
        self.prepared = native.prepare_native(self.suite, self.plan, self.renderer)
        self.arms = [{"label": "base", "base_model": PilotBudget.MODEL, "sampler_path": None},
                     {"label": "openui-sft-run", "base_model": PilotBudget.MODEL, "sampler_path": "tinker://fixed/sampler_weights/final"}]

    def execute(self, service_factory, persist=lambda *_: None, reserve=None, max_cost=10):
        return native.execute(self.suite, self.plan, self.arms, self.prepared, self.budget_file, max_cost,
            service_factory, lambda **kwargs: kwargs, self.renderer, lambda parsed: parsed["content"], persist, reserve)

    def test_native_prefix_keeps_exact_prompt_tools_messages_and_effort(self):
        for (messages, effort), case in zip(self.renderer.conversations, self.suite["cases"]):
            self.assertEqual(messages[0], {"role": "system", "content": self.suite["context"]["system_prompt"]})
            self.assertEqual(messages[1]["role"], "tool_declare")
            self.assertEqual(json.loads(messages[1]["content"]), self.suite["context"]["tools"])
            self.assertEqual(messages[2:], case["messages"])
            self.assertEqual(effort, .1)
            self.assertNotIn("rubric", json.dumps(messages))
        self.assertEqual([item["max_tokens"] for item in self.prepared], [700, 6500])
        self.assertEqual(self.prepared[0]["prompt_tokens_sha256"], bench.digest(bench.canonical(list(range(40)))))
        with self.assertRaisesRegex(ValueError, "context limit"):
            native.prepare_native(self.suite, self.plan, Renderer(32700))

    def test_all_arm_preflight_fails_before_service_creation(self):
        called = []
        for cap in (0, float("nan"), .000001):
            with self.assertRaises(ValueError):
                self.execute(lambda: called.append("service"), max_cost=cap)
        ledger = bench.read_json(self.budget_file)
        ledger["reserved_usd"] = 99.99999
        self.budget_file.write_text(json.dumps(ledger))
        with self.assertRaisesRegex(ValueError, "remaining budget"):
            self.execute(lambda: called.append("service"))
        self.assertEqual(called, [])

    def test_exact_tokens_max_outputs_and_all_arms_count_in_preflight(self):
        estimate = native.preflight(self.arms, self.prepared, self.budget_file, 10)
        expected = 2 * 5 * (2 * 40 * PilotBudget.PREFILL + (700 + 6500) * PilotBudget.SAMPLE) / 1e6
        self.assertAlmostEqual(estimate["planned_reservation_usd"], expected)
        self.assertEqual(bench.read_json(self.budget_file)["reserved_usd"], 0)

    def test_one_reservation_per_sample_and_base_is_not_a_checkpoint(self):
        calls, clients, reservations, receipts = [], [], [], []
        active = []
        @contextmanager
        def reserve(label, **counts):
            self.assertFalse(active)
            active.append(label)
            reservations.append(counts)
            try:
                yield
            finally:
                active.pop()
        def sample(prompt, **kwargs):
            self.assertEqual(len(active), 1)
            calls.append(kwargs)
            return SimpleNamespace(result=lambda: SimpleNamespace(sequences=[SimpleNamespace(tokens=[10, 11], stop_reason="stop")]))
        class Service:
            def create_sampling_client(self, **kwargs):
                clients.append(kwargs)
                return SimpleNamespace(sample=sample)
        runs = self.execute(Service, lambda label, run: receipts.append((label, copy.deepcopy(run))), reserve)
        self.assertEqual(clients, [{"base_model": PilotBudget.MODEL}, {"model_path": self.arms[1]["sampler_path"]}])
        self.assertEqual(len(calls), len(reservations), 4)
        for call, reserved in zip(calls, reservations):
            self.assertEqual(call["num_samples"], 1)
            settings = call["sampling_params"]
            self.assertEqual((settings["temperature"], settings["top_p"], settings["seed"], settings["stop"]), (.1, 1, 42, [999]))
            self.assertEqual(reserved, {"prefill": 40, "sample": settings["max_tokens"]})
        for label, run in runs.items():
            bench.verify_run(self.suite, run)
            self.assertEqual(run["plan_sha256"], self.plan["plan_sha256"])
            self.assertEqual([r["delivery"]["status"] for r in run["results"]], ["pass", "pass"])
            self.assertEqual(run["results"][0]["native_receipt"]["completion_tokens"], [10, 11])
        self.assertEqual([r["delivery"]["status"] for r in receipts[0][1]["results"]], ["missing", "missing"])

    def test_sampling_errors_preserve_coverage_and_do_not_log_secret_exception(self):
        calls = []
        def sample(*_, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise RuntimeError("secret-do-not-log")
            return SimpleNamespace(result=lambda: SimpleNamespace(sequences=[SimpleNamespace(tokens=[1], stop_reason="length")]))
        service = SimpleNamespace(create_sampling_client=lambda **_: SimpleNamespace(sample=sample))
        runs = self.execute(lambda: service)
        self.assertNotIn("secret-do-not-log", bench.canonical(runs))
        self.assertEqual(runs["base"]["results"][0]["delivery"]["status"], "error")
        self.assertTrue(runs["base"]["results"][1]["delivery"]["truncated"])
        self.assertEqual(len(runs["openui-sft-run"]["results"]), 2)
        self.assertEqual(len(bench.read_json(self.budget_file)["events"]), 5)

    def test_unavailable_checkpoint_keeps_not_dispatched_placeholders_without_reservation(self):
        def fail(**_):
            raise RuntimeError("private-provider-details")
        runs = self.execute(lambda: SimpleNamespace(create_sampling_client=fail))
        for run in runs.values():
            self.assertEqual(run["status"], "client_error")
            self.assertEqual([r["delivery"]["status"] for r in run["results"]], ["missing", "missing"])
        self.assertEqual(bench.read_json(self.budget_file)["reserved_usd"], 0)
        self.assertNotIn("private-provider-details", bench.canonical(runs))

    def test_service_failure_preserves_all_arms_without_leaking_exception(self):
        saved = []
        def unavailable():
            raise RuntimeError("secret-session-details")
        runs = self.execute(unavailable, lambda label, run: saved.append((label, copy.deepcopy(run))))
        self.assertEqual(len(saved), 4)
        for run in runs.values():
            self.assertEqual(run["status"], "service_error")
            self.assertEqual([r["delivery"]["status"] for r in run["results"]], ["missing", "missing"])
        self.assertNotIn("secret-session-details", bench.canonical(runs))
        self.assertEqual(bench.read_json(self.budget_file)["reserved_usd"], 0)

    def test_native_parse_failure_retains_sampled_tokens_and_counts_reservation(self):
        def parse_failure(_):
            raise ValueError("private-parse-details")
        self.renderer.parse_response = parse_failure
        sampled = SimpleNamespace(sequences=[SimpleNamespace(tokens=[8, 9, 10], stop_reason="stop")])
        service = SimpleNamespace(create_sampling_client=lambda **_: SimpleNamespace(
            sample=lambda *_, **__: SimpleNamespace(result=lambda: sampled)))
        runs = self.execute(lambda: service)
        row = runs["base"]["results"][0]
        self.assertEqual(row["native_receipt"]["completion_tokens"], [8, 9, 10])
        self.assertEqual(row["delivery"]["status"], "error")
        self.assertNotIn("private-parse-details", bench.canonical(runs))
        self.assertGreater(bench.read_json(self.budget_file)["reserved_usd"], 0)
        bench.verify_run(self.suite, runs["base"])

    def test_checkpoint_loading_requires_original_immutable_compatible_artifact(self):
        folder = self.directory / "openui-sft-run"
        folder.mkdir()
        record = {"model": PilotBudget.MODEL, "renderer": "tml_v0", "effort": .1,
                  "budget_file": str(self.budget_file), "cap_usd": 100, "owner_did": "did:plc:fixture",
                  "sampler_path": "tinker://fixed/sampler_weights/final", "method": "sft"}
        (folder / "result.json").write_text(json.dumps(record))
        arms = native.load_arms(["base", "openui-sft-run"], self.directory, self.budget_file)
        self.assertEqual(arms[1]["sampler_path"], record["sampler_path"])
        for change in ({"budget_file": "/some/other/budget.json"}, {"sampler_path": "tinker://fixed/weights/optimizer"}, {"effort": .2}):
            (folder / "result.json").write_text(json.dumps({**record, **change}))
            with self.assertRaises(ValueError):
                native.load_arms(["openui-sft-run"], self.directory, self.budget_file)
        with self.assertRaises(ValueError):
            native.load_arms(["base", "base"], self.directory, self.budget_file)


if __name__ == "__main__":
    unittest.main()
