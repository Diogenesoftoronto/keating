# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "scikit-learn==1.7.2"]
# ///
"""Authored fixtures verify split, masking and calibration mechanics only."""
import copy
import importlib.util
import unittest

import observer_probes as probes


class SplitTests(unittest.TestCase):
    def test_family_alias_closure_and_deterministic_membership(self):
        rows = probes.authored_fixture()["rows"]
        rows[0]["group_ids"] = ["person:shared"]
        rows[3]["group_ids"] = ["person:shared", "template:shared"]
        rows[6]["group_ids"] = ["template:shared"]
        split = probes.split_groups(rows)
        groups = {split["rows"][r["record_id"]]["group"] for r in rows[:9]}
        self.assertEqual(len(groups), 1)
        self.assertEqual(split, probes.split_groups(list(reversed(rows))))
        for family in {r["family_id"] for r in rows}:
            self.assertEqual(len({split["rows"][r["record_id"]]["split"] for r in rows if r["family_id"] == family}), 1)

    def test_declared_split_cannot_split_siblings(self):
        rows = probes.authored_fixture()["rows"]
        split = probes.split_groups(rows)
        for row in rows:
            row["split"] = split["rows"][row["record_id"]]["split"]
        self.assertEqual(probes.split_groups(rows)["method"], "declared")
        rows[0]["split"] = "test" if rows[1]["split"] != "test" else "train"
        with self.assertRaisesRegex(ValueError, "crosses declared"):
            probes.split_groups(rows)


@unittest.skipUnless(importlib.util.find_spec("sklearn") and importlib.util.find_spec("numpy"),
                     "Probe extras optional; run this file with uv --script")
class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = probes.authored_fixture()
        cls.report = cls.fit(cls.artifact)

    @staticmethod
    def fit(artifact):
        return probes.fit_probes(artifact, "premature_answer", boundary="delivered",
                                 definition="Answer supplied despite an explicit request for a hint.")

    def test_unknown_mask_and_heldout_predictions(self):
        self.assertEqual(self.report["unknown_labels_excluded"], 30)
        self.assertEqual(sum(self.report["counts"].values()), 60)
        test_ids = {k for k, v in self.report["split_manifest"]["rows"].items() if v["split"] == "test"}
        for result in self.report["baselines"].values():
            self.assertTrue(all(p["record_id"] in test_ids for p in result["predictions"]))
            self.assertTrue(0 <= result["test"]["brier"] <= 1)
            self.assertEqual(result["test"]["n"], self.report["counts"]["test"])

    def test_test_labels_and_features_do_not_change_fitted_models(self):
        changed = copy.deepcopy(self.artifact)
        for row in changed["rows"]:
            if self.report["split_manifest"]["rows"][row["record_id"]]["split"] == "test":
                value = row["labels"]["premature_answer"]
                row["labels"]["premature_answer"] = None if value is None else 1 - value
                row["text"] = "Completely different test text ONLY_TEST_LEAK_SENTINEL"
                row["raw"] = [100, -100, 20]
                row["sae"] = {"7": 900}
        report = self.fit(changed)
        for mode in ("text", "raw", "sae"):
            self.assertEqual(report["baselines"][mode]["model"], self.report["baselines"][mode]["model"])

    def test_unknown_examples_do_not_affect_fit_or_metrics(self):
        changed = copy.deepcopy(self.artifact)
        for row in changed["rows"]:
            if row["labels"]["premature_answer"] is None:
                row["raw"] = [999, 999, 999]
                row["text"] = "UNLABELED_SENTINEL"
                row["sae"] = {"7": 999}
        report = self.fit(changed)
        self.assertEqual(report["baselines"], self.report["baselines"])

    def test_exported_coefficients_reproduce_test_probabilities(self):
        import numpy as np
        by_id = {r["record_id"]: r for r in self.artifact["rows"]}
        for mode, result in self.report["baselines"].items():
            rows = [by_id[p["record_id"]] for p in result["predictions"]]
            actual = probes.predict_probe(result["model"], rows, mode, width=8)
            np.testing.assert_allclose(actual, [p["probability"] for p in result["predictions"]], atol=1e-12)

    def test_reproducible_report_and_metrics(self):
        self.assertEqual(self.report, self.fit(copy.deepcopy(self.artifact)))
        metrics = probes.calibration_metrics([0, 1], [0.0, 1.0])
        self.assertEqual(metrics["brier"], 0)
        self.assertEqual(metrics["ece"], 0)
        self.assertEqual(metrics["accuracy_at_0_5"], 1)
        self.assertIsNone(probes.calibration_metrics([1], [.3])["roc_auc"])
        self.assertIsNone(probes.bootstrap_brier([1], [.3], ["family"])["interval_95"])

    def test_bad_labels_missing_provenance_and_manifest_fail_closed(self):
        mutations = [lambda a: a["rows"][0]["labels"].update(premature_answer=.5),
                     lambda a: a["rows"][0].update(label_provenance={}),
                     lambda a: a["rows"][0].update(observer_manifest_sha256="different"),
                     lambda a: a.update(manifest_sha256="tampered")]
        for mutate in mutations:
            changed = copy.deepcopy(self.artifact)
            mutate(changed)
            with self.assertRaises(ValueError):
                self.fit(changed)

    def test_missing_class_does_not_trigger_test_informed_resplitting(self):
        changed = copy.deepcopy(self.artifact)
        for row in changed["rows"]:
            row["labels"]["premature_answer"] = 0
        with self.assertRaisesRegex(ValueError, "both classes"):
            self.fit(changed)

    def test_cli_json_report_is_reproducible_and_refuses_overwrite(self):
        import contextlib
        import io
        import json
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory(prefix="observer-probes-") as directory:
            source, output = Path(directory) / "features.json", Path(directory) / "report.json"
            source.write_text(json.dumps(self.artifact))
            args = [str(source), str(output), "--target", "premature_answer", "--boundary", "delivered",
                    "--definition", self.report["definition"]]
            with contextlib.redirect_stdout(io.StringIO()):
                probes.main(args)
            self.assertEqual(json.loads(output.read_text()), self.report)
            with self.assertRaises(FileExistsError):
                probes.main(args)


if __name__ == "__main__":
    unittest.main()
