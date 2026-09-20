"""Small authored evidence tests; no inference or claimed empirical ratings."""
from copy import deepcopy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import native_update_report as report
from native_training import seal


class NativeUpdateReportTests(unittest.TestCase):
    def setUp(self):
        self.suite = {"schema_version": 1, "id": "authored-fixture", "cases": [],
                      "comparison": {"arms": list(report.ARMS), "replicates_per_case_per_arm": 1,
                                     "planned_generations": 6, "execution_order": []}}
        self.evaluation = {"schema_version": 1, "suite_sha256": "a" * 64,
            "arms": {"original_checkpoint": "tinker://fixture:train:0/sampler_weights/original",
                     "updated_checkpoint": "tinker://fixture:train:0/sampler_weights/updated"}, "rows": []}
        self.reviews = {"schema_version": 1, "rows": []}
        for index in range(3):
            case_id = f"authored-{index}"
            self.suite["cases"].append({"id": case_id, "family": "shared-fixture" if index < 2 else "other-fixture",
                "category": "math_transfer" if index < 2 else "unrelated_retention",
                "actor": {"opening_message": f"Authored arithmetic task {index}"},
                "evaluation_only": {"criteria": [{"id": "correct", "pass_when": "Authored correctness check"},
                                                   {"id": "format", "pass_when": "Authored format check"}]}})
            for arm in report.ARMS:
                self.suite["comparison"]["execution_order"].append({"case_id": case_id, "arm": arm})
                self.evaluation["rows"].append({"case_id": case_id, "arm": arm, "status": "returned",
                    "error_type": None, "source_file": "authored:never-follow-this-path",
                    "response": {"choices": [{"message": {"role": "assistant", "content": "Authored answer"}}],
                                 "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13}}})
                self.reviews["rows"].append({"case_id": case_id, "arm": arm,
                    "criteria": {"correct": True, "format": False}, "rationale": "Authored review."})
        self.plan = seal({"schema_version": 1, "config": {"method": "ppo", "epsilon": .2}}, "plan_hash")
        # Ratios .7, 1, 1.3: both ends outside bounds, only the negative low
        # and positive high advantages enter the clipped surrogate branch.
        ratios = [.7, 1, 1.3, .7, 1.3, 1.3]
        self.update = seal({"schema_version": 1, "status": "complete", "optimizer_acknowledged": True,
            "sampler_checkpoint": self.evaluation["arms"]["updated_checkpoint"], "plan_hash": self.plan["plan_hash"],
            "loss_metrics": {"clip_fraction": .99, "mean_ratio": .02}, "score_records": [{"capture_hash": "b" * 64,
                "completion_token_ids": list(range(6)), "behavior_logprobs": [-2.] * 6,
                "student_logprobs": [-2 + math.log(r) for r in ratios],
                "detached_advantages": [-1, -1, 1, 1, -1, 0]}]}, "result_hash")

    def build(self):
        return report.build_update_report(self.suite, self.evaluation, self.reviews, self.update,
                                          suite_sha256="a" * 64, plan=self.plan)

    def test_missing_failure_and_partial_review_preserve_denominators(self):
        self.evaluation["rows"].pop()  # third case updated unattempted
        self.evaluation["rows"][2].update(status="failed", response=None, error_type="AuthoredTimeout")
        self.reviews["rows"] = [self.reviews["rows"][0], self.reviews["rows"][1]]
        self.reviews["rows"][0]["criteria"] = {"correct": True}
        value = self.build()
        old, new = value["denominators"]
        self.assertEqual((old["planned"], old["attempted"], old["returned"], old["failed"]), (3, 3, 2, 1))
        self.assertEqual((new["planned"], new["attempted"], new["unattempted"]), (3, 2, 1))
        self.assertEqual((old["known_criteria"], old["unknown_criteria"]), (1, 5))
        self.assertEqual(value["paired"][0]["deltas"], {"correct": 0, "format": None})
        self.assertIsNone(value["paired"][1]["matched_pass_count_difference"])
        self.assertIsNone(value["rows"][-1]["pass_count"])
        self.assertIsNone(value["rows"][-1]["completion_tokens"])
        self.assertEqual(value["independent_family_count"], 2)
        self.assertEqual(value["families"][0]["case_ids"], ["authored-0", "authored-1"])

    def test_ratios_clipping_signs_and_raw_metrics_are_separate(self):
        diagnostics = self.build()["update"]
        row = diagnostics["captures"][0]
        self.assertEqual(row["completion_tokens"], 6)
        self.assertAlmostEqual(row["fraction_ratio_outside_bounds"], 5/6)
        self.assertAlmostEqual(row["fraction_surrogate_clipped"], 2/6)
        self.assertAlmostEqual(row["mean_probability_ratio"], 6.3/6)
        self.assertAlmostEqual(row["max_abs_log_ratio"], abs(math.log(.7)))
        self.assertAlmostEqual(diagnostics["tokens"][0]["student_minus_behavior_probability"], -.3 * math.exp(-2))
        self.assertEqual(diagnostics["raw_provider_metrics"]["clip_fraction"], .99)
        self.assertEqual(diagnostics["provider_reduction_scope"], "unverified")
        self.assertEqual(diagnostics["score_phase"], "pre_optimizer_student_vs_original_behavior")

    def test_no_plan_does_not_assume_epsilon(self):
        value = report.collect_update_diagnostics(self.update)
        self.assertIsNone(value["epsilon"])
        self.assertIsNone(value["captures"][0]["fraction_ratio_outside_bounds"])
        self.assertIsNone(value["captures"][0]["fraction_surrogate_clipped"])
        self.assertIsNotNone(value["captures"][0]["mean_probability_ratio"])

    def test_ties_and_posthoc_rationales_do_not_change_frozen_scores(self):
        rationale = "However, this authored response is false outside the narrow fixture criteria."
        self.reviews["rows"][0]["rationale"] = rationale
        before = deepcopy((self.suite, self.evaluation, self.reviews, self.update))
        value = self.build()
        self.assertEqual(value["headline"], "No detected improvement on the frozen rubric")
        self.assertEqual(value["fully_observed_tied_cases"], 3)
        self.assertEqual(value["posthoc_reviewer_observations"][0]["rationale"], rationale)
        self.assertFalse(value["posthoc_reviewer_observations"][0]["changes_frozen_scores"])
        self.assertEqual(value["rows"][0]["pass_count"], 1)
        self.assertEqual((self.suite, self.evaluation, self.reviews, self.update), before)

    def test_unknown_and_duplicate_result_or_review_rows_reject(self):
        for document in (self.evaluation, self.reviews):
            for change in ("duplicate", "unknown_case", "unknown_arm"):
                with self.subTest(document=document is self.evaluation, change=change):
                    saved = deepcopy(document["rows"])
                    if change == "duplicate":
                        document["rows"].append(deepcopy(document["rows"][0]))
                    else:
                        document["rows"][0]["case_id" if change == "unknown_case" else "arm"] = "unknown"
                    with self.assertRaisesRegex(ValueError, "unknown or duplicate"):
                        self.build()
                    document["rows"] = saved

    def test_unknown_criterion_and_numeric_boolean_reject(self):
        for criteria in ({"unknown": True}, {"correct": 1}, {"correct": "true"}):
            self.reviews["rows"][0]["criteria"] = criteria
            with self.assertRaisesRegex(ValueError, "unknown criterion or non-boolean"):
                self.build()

    def test_judgments_require_returned_evidence(self):
        self.evaluation["rows"].pop(0)
        with self.assertRaisesRegex(ValueError, "judgment without returned evidence"):
            self.build()

    def test_missing_usage_never_retokenizes_response(self):
        self.evaluation["rows"][0]["response"].pop("usage")
        value = self.build()
        self.assertIsNone(value["rows"][0]["completion_tokens"])
        self.assertEqual(value["denominators"][0]["completion_usage_known"], 2)

    def test_usage_and_status_contradictions_reject(self):
        row = self.evaluation["rows"][0]
        for usage in ([], {"completion_tokens": True}, {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 99}):
            row["response"]["usage"] = usage
            with self.assertRaisesRegex(ValueError, "usage"):
                self.build()
        row.update(status="failed", error_type="AuthoredFailure")
        with self.assertRaisesRegex(ValueError, "failed result"):
            self.build()

    def test_suite_and_checkpoint_hash_mismatch_reject(self):
        self.evaluation["suite_sha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "suite byte hash"):
            self.build()
        self.evaluation["suite_sha256"] = "a" * 64
        self.evaluation["arms"]["updated_checkpoint"] += "wrong"
        with self.assertRaisesRegex(ValueError, "evaluation/update checkpoint"):
            self.build()

    def test_plan_and_result_tampering_reject(self):
        self.plan["config"]["epsilon"] = .1
        with self.assertRaisesRegex(ValueError, "invalid plan_hash"):
            self.build()
        self.plan = seal(self.plan, "plan_hash")
        with self.assertRaisesRegex(ValueError, "update/plan hash mismatch"):
            self.build()
        self.update["score_records"][0]["student_logprobs"][0] = -1
        with self.assertRaisesRegex(ValueError, "invalid result_hash"):
            self.build()

    def test_malformed_or_duplicate_score_records_reject(self):
        original = deepcopy(self.update)
        for change in ("unaligned", "nonfinite", "positive", "duplicate", "overflow"):
            with self.subTest(change=change):
                self.update = deepcopy(original)
                row = self.update["score_records"][0]
                if change == "unaligned":
                    row["behavior_logprobs"].pop()
                elif change == "duplicate":
                    self.update["score_records"].append(deepcopy(row))
                elif change == "overflow":
                    row["behavior_logprobs"][0] = -1000
                else:
                    row["student_logprobs"][0] = float("nan") if change == "nonfinite" else .1
                # Nonfinite values cannot even be sealed; either boundary must reject.
                with self.assertRaises(ValueError):
                    self.update = seal(self.update, "result_hash")
                    self.build()

    def test_load_byte_hash_and_missing_review_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            suite_bytes = (json.dumps(self.suite) + "\n").encode()
            (root / "suite.json").write_bytes(suite_bytes)
            self.evaluation["suite_sha256"] = hashlib.sha256(suite_bytes).hexdigest()
            for name, value in (("results", self.evaluation), ("result", self.update), ("plan", self.plan)):
                (root / f"{name}.json").write_text(json.dumps(value))
            value = report.load_update_report(root / "suite.json", root / "results.json", root / "reviews.json", root / "result.json")
            self.assertEqual(value["inputs"]["reviews"]["status"], "missing")
            self.assertEqual(value["denominators"][0]["known_criteria"], 0)
            self.assertEqual(value["denominators"][0]["returned"], 3)
            report.check_report_seal(value, "report_hash")
            (root / "suite.json").write_bytes(suite_bytes + b" ")
            with self.assertRaisesRegex(ValueError, "suite byte hash"):
                report.load_update_report(root / "suite.json", root / "results.json", root / "reviews.json", root / "result.json")

    def test_duplicate_json_keys_are_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text('{"rows":[],"rows":[]}')
            with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
                report.read_report_evidence(path)

    def test_import_defers_plotting_and_provider_libraries(self):
        command = [sys.executable, "-c", "import native_update_report, sys; assert not ({'pandas','numpy','matplotlib','tinker','torch','httpx'} & set(sys.modules))"]
        result = subprocess.run(command, cwd=Path(report.__file__).parent, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(all(importlib.util.find_spec(name) for name in ("pandas", "numpy", "matplotlib")), "optional plotting libraries absent")
    def test_private_report_renders_unknowns_escapes_evidence_and_refuses_overwrite(self):
        self.reviews["rows"][0]["rationale"] = '<script>alert("authored")</script>'
        value = self.build()
        value["report_hash"] = report.native_hash(value)
        temporary = report.REPO / ".keating" / "tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary) as directory:
            output = Path(directory) / "report"
            entry = report.write_update_report(value, output)
            page = entry.read_text()
            self.assertIn("No detected improvement", page)
            self.assertIn("Rubric blind spots", page)
            self.assertIn("&lt;script&gt;", page)
            self.assertNotIn('<script>alert', page)
            self.assertNotIn('<script src=', page)
            self.assertEqual(len(list(output.glob("*.png"))), 3)
            self.assertEqual(len(list(output.glob("*.svg"))), 3)
            self.assertEqual(entry.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                report.write_update_report(value, output)
            with self.assertRaisesRegex(ValueError, "ignored .keating"):
                report.write_update_report(value, report.REPO / "docs" / "not-allowed")


if __name__ == "__main__":
    unittest.main()
