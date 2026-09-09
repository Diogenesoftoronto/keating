"""Provider-free benchmark invariants: frozen context, failures, budgets and review evidence."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from typer.testing import CliRunner
import benchmark as bench
from pilot_budget import PilotBudget


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        cases = [{"id": name, "category": category, "messages": [{"role": "user", "content": "Explain " + name + " 😀"}],
                  "max_tokens": cap, "expect": expectation,
                  "rubric": {"correctness": {"zero": "Wrong", "one": "Partial", "two": "Sound"}}}
                 for name, category, cap, expectation in [
                     ("text", "teaching", 700, {"visible_response": True, "allowed_tools": []}),
                     ("tool", "tools", 900, {"visible_response": False, "required_tools": [{"name": "feedback"}]}),
                     ("long", "teaching", 6500, {"visible_response": True, "allowed_tools": []})]]
        context = {"system_prompt": "EXACT system\n  Preserve whitespace.", "tools": [{"type": "function", "function": {
            "name": "feedback", "description": "Feedback tool", "parameters": {"type": "object", "properties": {}}}}]}
        context.update(system_prompt_sha256=bench.digest(context["system_prompt"]), tool_schema_sha256=bench.digest(bench.canonical(context["tools"])))
        documents = {"cases.json": {"benchmark_id": "test-v1", "cases": cases, "core_case_ids": ["text", "tool"]},
                     "rubric.json": {"benchmark_id": "test-v1", "dimensions": {"correctness": {}}, "review_protocol": ["Use evidence"]},
                     "context.json": context}
        for name, document in documents.items():
            bench.write_json(self.directory / name, document)
        manifest = {"benchmark_id": "test-v1", "files": {name: bench.digest((self.directory / name).read_bytes()) for name in documents},
                    "contract_checker": {"path": str(bench.CHECKER.relative_to(bench.ROOT)), "sha256": bench.digest(bench.CHECKER.read_bytes())}}
        bench.write_json(self.directory / "manifest.json", manifest)
        self.suite = bench.load_suite(self.directory)
        self.plan = bench.make_plan(self.suite, "full")

    def imported(self, responses=None, model="model-a"):
        if responses is None:
            responses = [{"case_id": case_id, "response": {"content": "A sound explanation", "finish_reason": "stop"}}
                         for case_id in self.plan["case_ids"]]
        return bench.import_responses(self.suite, self.plan, {"plan_sha256": self.plan["plan_sha256"],
            "provenance": {"source": "offline test fixture"}, "responses": responses}, "provider", model)

    def rated(self, run, score=2):
        review = bench.review_template(self.suite, run)
        review["reviewer"] = {"id": "reviewer-1", "kind": "human", "reviewed_at": "2026-09-07T12:00:00Z", "method": "Read full blinded packet"}
        for rating in review["ratings"]:
            rating["dimensions"]["correctness"] = {"score": score, "evidence": "sound explanation", "observation": None}
        return review

    def test_exact_payload_and_frozen_caps_without_evaluator_data(self):
        self.assertEqual(self.plan["settings"]["top_p"], 1)
        for request, case in zip(self.plan["requests"], self.suite["cases"]):
            payload = request["payload"]
            self.assertEqual(payload["messages"], [{"role": "system", "content": self.suite["context"]["system_prompt"]}, *case["messages"]])
            self.assertEqual(payload["tools"], self.suite["context"]["tools"])
            self.assertEqual(payload["max_tokens"], case["max_tokens"])
            self.assertEqual((payload["temperature"], payload["seed"], payload["top_p"]), (0.1, 42, 1))
            self.assertFalse({"expect", "rubric", "teacher_hints"} & set(payload))
        self.assertEqual(self.plan["requests"][-1]["payload"]["max_tokens"], 6500)
        (self.directory / "context.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            bench.load_suite(self.directory)

    def test_import_preserves_missing_errors_empty_tools_and_truncation(self):
        tool = {"id": "c1", "type": "function", "function": {"name": "feedback", "arguments": "{}"}}
        run = self.imported([{"case_id": "text", "response": {"content": "", "finish_reason": "length"}},
                             {"case_id": "tool", "response": {"content": None, "tool_calls": [tool], "finish_reason": "tool_calls"}}])
        self.assertEqual([row["delivery"]["status"] for row in run["results"]], ["fail", "pass", "missing"])
        self.assertTrue(run["results"][0]["delivery"]["truncated"])
        self.assertEqual(run["results"][1]["response"]["tool_calls"], [tool])
        self.assertEqual(bench.score_run(self.suite, run)["teaching"]["correctness"]["normalized"], None)
        duplicate = [{"case_id": "text", "response": "x"}] * 2
        with self.assertRaises(ValueError):
            self.imported(duplicate)
        with self.assertRaises(ValueError):
            bench.import_responses(self.suite, self.plan, {"plan_sha256": "wrong"}, "a", "b")

    def test_reservation_happens_before_requests_and_failures_are_retained(self):
        calls, reservations, receipts = [], [], []
        def request(payload):
            self.assertEqual(len(reservations), 1)
            calls.append(payload)
            if len(calls) == 2:
                raise RuntimeError("PRIVATE-CREDENTIAL-must-not-be-logged")
            return {"choices": [{"message": {"content": "answer"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 20},
                    "model": "resolved-model", "id": "response-123", "system_fingerprint": "fp-123", "private_header": "do-not-copy"}
        run = bench.execute_plan(self.suite, self.plan, "other-provider", "other-model", request,
            reservations.append, 1.5, 2.5, 1, lambda run: receipts.append(copy.deepcopy(run)))
        self.assertEqual(len(calls), 3)
        self.assertEqual(run["results"][1]["delivery"]["status"], "error")
        self.assertNotIn("PRIVATE-CREDENTIAL", bench.canonical(run))
        self.assertEqual(run["status"], "complete")
        self.assertEqual([row["delivery"]["status"] for row in receipts[0]["results"]], ["missing"] * 3)
        self.assertEqual(receipts[1]["results"][0]["response"]["content"], "answer")
        self.assertTrue(all(payload["model"] == "other-model" for payload in calls))
        self.assertEqual(run["results"][0]["provider_receipt"], {"returned_model": "resolved-model",
            "response_id": "response-123", "system_fingerprint": "fp-123", "requested_returned_model_mismatch": True})
        packet = bench.review_template(self.suite, run)
        self.assertNotIn("resolved-model", bench.canonical(packet))
        self.assertNotIn("response-123", bench.canonical(packet))
        self.assertNotIn("do-not-copy", bench.canonical(run))

    def test_cost_validation_prevents_all_network_and_uses_utf8_allowance(self):
        called = []
        for input_rate, output_rate, cap in [(0, 1, 1), (1, float("nan"), 1), (1, 1, 0), (1, 1, .000001)]:
            with self.assertRaises(ValueError):
                bench.execute_plan(self.suite, self.plan, "p", "m", called.append, called.append, input_rate, output_rate, cap)
        self.assertEqual(called, [])
        estimate = bench.estimate_cost(self.plan, 1, 2)
        for entry, request in zip(estimate["cases"], self.plan["requests"]):
            self.assertEqual(entry["input_token_allowance"], len(bench.canonical(request["payload"]).encode()) + 4096)
        with self.assertRaises(ValueError):
            bench.reserve_existing_budget(self.directory / "absent-budget.json", .2)
        ledger = self.directory / "budget.json"
        with PilotBudget(ledger).reserve("existing"):
            pass
        bench.reserve_existing_budget(ledger, .4)
        self.assertEqual(bench.read_json(ledger)["reserved_usd"], .4)

    def test_review_packet_is_complete_blind_and_requires_actual_evidence(self):
        run = self.imported()
        packet = bench.review_template(self.suite, run)
        self.assertNotIn("provider", packet)
        self.assertNotIn("model", packet)
        self.assertEqual(packet["system_prompt"], self.suite["context"]["system_prompt"])
        for rating in packet["ratings"]:
            self.assertIn("messages", rating)
            self.assertIn("response", rating)
            self.assertIn("rubric", rating)
        review = self.rated(run)
        score = bench.score_run(self.suite, run, review)
        self.assertEqual(score["teaching"]["correctness"], {"sum": 6, "rated": 3, "missing": 0, "normalized": 1})
        for mutation in ("reviewer", "evidence", "response", "boolean"):
            invalid = copy.deepcopy(review)
            if mutation == "reviewer":
                invalid["reviewer"]["id"] = None
            elif mutation == "response":
                invalid["ratings"][0]["response"]["content"] = "different response"
            elif mutation == "boolean":
                invalid["ratings"][0]["dimensions"]["correctness"]["score"] = True
            else:
                invalid["ratings"][0]["dimensions"]["correctness"]["evidence"] = "invented quote"
            with self.assertRaises(ValueError):
                bench.score_run(self.suite, run, invalid)

    def test_unknowns_and_transport_errors_cannot_become_teaching_scores(self):
        run = self.imported([{"case_id": "text", "response": {"error": {"kind": "provider_error"}}}])
        review = bench.review_template(self.suite, run)
        result = bench.score_run(self.suite, run, review)
        self.assertEqual(result["teaching"]["correctness"]["missing"], 3)
        self.assertIsNone(result["teaching"]["correctness"]["normalized"])
        review["ratings"][0]["dimensions"]["correctness"].update(score=0, observation="No output")
        with self.assertRaises(ValueError):
            bench.score_run(self.suite, run, review)

    def test_stored_hash_does_not_hide_settings_or_response_tampering(self):
        for key in ("settings", "response"):
            run = self.imported()
            if key == "settings":
                run["settings"]["max_tokens"]["text"] = 12
            else:
                run["results"][0]["response"]["content"] = "Changed"
            with self.assertRaises(ValueError):
                bench.verify_run(self.suite, run)

    def test_comparison_requires_same_frozen_inputs_and_joint_review_coverage(self):
        left, right = self.imported(model="left"), self.imported(model="right")
        a, b = self.rated(left, 2), self.rated(right, 1)
        b["ratings"][0]["dimensions"]["correctness"]["score"] = None
        score_a, score_b = bench.score_run(self.suite, left, a), bench.score_run(self.suite, right, b)
        compared = bench.compare_scores(score_a, score_b)
        self.assertEqual(compared["paired_teaching"]["correctness"]["paired"], 2)
        self.assertEqual(compared["paired_teaching"]["correctness"]["right_minus_left"], -.5)
        for field in ("suite_sha256", "settings_sha256", "tool_schema_sha256", "subset_sha256"):
            changed = copy.deepcopy(score_b)
            changed[field] = "changed"
            with self.assertRaises(ValueError):
                bench.compare_scores(score_a, changed)

    def test_checker_failure_stays_unknown_and_frozen_hash_is_enforced(self):
        run = self.imported()
        with patch.object(bench.subprocess, "run", return_value=SimpleNamespace(returncode=1)) as process:
            result = bench.check_contracts(self.suite, run)
            self.assertEqual(process.call_args.args[0][:3], ["rtk", "proxy", "bun"])
        self.assertTrue(all(row["contracts"]["contract_passed"] is None for row in result["results"]))
        self.suite["manifest"]["contract_checker"]["sha256"] = "bad"
        with patch.object(bench.subprocess, "run") as process:
            with self.assertRaises(ValueError):
                bench.check_contracts(self.suite, self.imported())
            process.assert_not_called()

    def test_cli_offline_plan_has_concrete_cost_without_key_or_provider(self):
        destination = self.directory / "plan.json"
        result = CliRunner().invoke(bench.app, ["plan", "--suite", str(self.directory), "--out", str(destination),
            "--input-rate", "1", "--output-rate", "2", "--max-cost", "1"])
        self.assertEqual(result.exit_code, 0, result.output)
        document = bench.read_json(destination)
        self.assertTrue(document["cost_estimate"]["within_max_cost"])
        self.assertEqual(document["case_ids"], ["text", "tool"])
        with self.assertRaises(FileExistsError):
            bench.write_json(destination, {})
        for endpoint in ("http://remote.test/v1", "https://key@remote.test/v1", "https://remote.test/v1?key=secret"):
            with self.assertRaises(ValueError):
                bench.endpoint_url(endpoint)

    def test_transitive_source_and_runtime_drift_fail_before_contract_scoring(self):
        source = "scripts/training/benchmark_check.ts"
        self.suite["manifest"]["contract_sources"] = {source: "wrong-hash"}
        with patch.object(bench.subprocess, "run") as process:
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                bench.check_contracts(self.suite, self.imported())
            process.assert_not_called()
        self.suite["manifest"]["contract_sources"][source] = bench.digest((bench.ROOT / source).read_bytes())
        self.suite["manifest"]["contract_runtime"] = {"name": "bun", "version": "1.3.13"}
        with patch.object(bench.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"1.3.12\n")) as process:
            with self.assertRaisesRegex(ValueError, "runtime version mismatch"):
                bench.check_contracts(self.suite, self.imported())
            self.assertEqual(process.call_count, 1)
        with patch.object(bench.subprocess, "run", side_effect=[SimpleNamespace(returncode=0, stdout=b"1.3.13\n"),
                                                              SimpleNamespace(returncode=1)]) as process:
            result = bench.check_contracts(self.suite, self.imported())
            self.assertEqual(process.call_count, 2)
            self.assertTrue(all(row["contracts"]["contract_passed"] is None for row in result["results"]))

    def test_resolved_inventory_drift_fails_closed(self):
        collector = bench.ROOT / "scripts/training/benchmark_dependencies.ts"
        self.suite["manifest"]["contract_inventory"] = {"path": str(collector.relative_to(bench.ROOT)),
                                                          "sha256": bench.digest(collector.read_bytes())}
        with patch.object(bench.subprocess, "run", return_value=SimpleNamespace(returncode=0,
                stdout=b'{"contract_sources":{"new-dependency.ts":"hash"},"contract_runtime":null}')) as process:
            with self.assertRaisesRegex(ValueError, "dependency inventory mismatch"):
                bench.check_contracts(self.suite, self.imported())
            self.assertEqual(process.call_count, 1)
        self.suite["manifest"]["contract_inventory"]["sha256"] = "changed"
        with patch.object(bench.subprocess, "run") as process:
            with self.assertRaisesRegex(ValueError, "inventory hash mismatch"):
                bench.check_contracts(self.suite, self.imported())
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
