import copy
import json
import tempfile
import unittest
from pathlib import Path

from quiz_boosting_model import main


class QuizBoostingModelTests(unittest.TestCase):
    def test_real_depth_three_export_is_independent_of_validation_labels(self):
        dataset = {"schemaVersion": 1, "policy": {"maxTreeDepth": 3},
                   "features": ["jevProbability", "questionLength"], "observations": [
                       {"rowId": str(i), "groupId": str(i), "split": "fit" if i < 40 else "validation",
                        "label": i % 2, "features": {"jevProbability": 0.8, "questionLength": 5 + 50 * (i % 2)}}
                       for i in range(60)]}
        with tempfile.TemporaryDirectory() as directory:
            source, first, second = (Path(directory) / name for name in ("input.json", "first.json", "second.json"))
            source.write_text(json.dumps(dataset))
            self.assertEqual(main([str(source), str(first)]), 0)
            initial = json.loads(first.read_text())
            self.assertEqual(initial["framework"]["version"], "1.2.10")
            self.assertEqual(initial["framework"]["parameters"]["depth"], 3)
            self.assertEqual(len(initial["model"]["oblivious_trees"]), 300)
            self.assertTrue(all(len(tree["splits"]) <= 3 for tree in initial["model"]["oblivious_trees"]))
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            changed = copy.deepcopy(dataset)
            for row in changed["observations"]:
                if row["split"] == "validation":
                    row["label"] = 1 - row["label"]
            source.write_text(json.dumps(changed))
            main([str(source), str(second)])
            self.assertEqual(initial["model"]["oblivious_trees"], json.loads(second.read_text())["model"]["oblivious_trees"])
            preserved = first.read_bytes()
            with self.assertRaises(FileExistsError):
                main([str(source), str(first)])
            self.assertEqual(first.read_bytes(), preserved)

    def test_refuses_an_incompatible_depth_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            source.write_text(json.dumps({"policy": {"maxTreeDepth": 4}}))
            with self.assertRaises(ValueError):
                main([str(source), str(Path(directory) / "output.json")])


if __name__ == "__main__":
    unittest.main()
