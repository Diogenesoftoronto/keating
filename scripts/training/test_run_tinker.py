import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from run_tinker import completion_lps, messages_for, read_seed, write_json, load_parent, MODEL, rollout_batches


class RunnerTests(unittest.TestCase):
    def test_child_keeps_owner_prompt_and_original_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            budget = root / "budget.json"
            budget.write_text(json.dumps({"model": MODEL, "cap_usd": 100}))
            parent = {"owner_did": "owner", "model": MODEL, "renderer": "tml_v0",
                      "effort": .1, "system_prompt_sha256": "prompt", "tools_sha256": "tools",
                      "training_state_path": "tinker://run/weights/state",
                      "sampler_path": "tinker://run/sampler_weights/sample"}
            (root / "result.json").write_text(json.dumps(parent))
            self.assertEqual(load_parent(root, "owner", "prompt", "tools", budget, 100), parent)
            self.assertEqual(load_parent(root, "owner", "changed", "tools", budget, 100, True), parent)
            with self.assertRaises(ValueError):load_parent(root, "other", "changed", "tools", budget, 100, True)
            for owner, prompt, path, cap in [("other", "prompt", budget, 100),
                                              ("owner", "changed", budget, 100),
                                              ("owner", "prompt", root / "new.json", 100),
                                              ("owner", "prompt", budget, 99)]:
                with self.assertRaises(ValueError):
                    load_parent(root, owner, prompt, "tools", path, cap)

    def test_rollouts_refresh_before_staleness_exceeds_three(self):
        for steps in range(1,33):
            batches=rollout_batches(steps)
            self.assertEqual([i for batch in batches for i in batch], list(range(steps)))
            self.assertTrue(all(i-batch[0] <= 3 for batch in batches for i in batch))
        for steps in [0,33]:
            with self.assertRaises(ValueError):rollout_batches(steps)

    def test_native_tool_call_receipt_serializes_without_losing_arguments(self):
        class NativeCall:
            def model_dump(self, mode):
                return {"function": {"name": "quiz", "arguments": '{"topic":"fractions"}'}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evaluation.json"
            write_json(path, {"tool_calls": [NativeCall()]})
            value = json.loads(path.read_text())
            self.assertEqual(value["tool_calls"][0]["function"]["arguments"], '{"topic":"fractions"}')

    def test_historical_hint_is_teacher_only(self):
        row = {"prompt": [{"role": "user", "content": "Question"}],
               "hint": "Explicit correction", "historical_response": "Old answer"}
        prompt = "Exact application prompt\n"
        student = messages_for(row, prompt)
        teacher = messages_for(row, prompt, True)
        self.assertNotIn(row["hint"], json.dumps(student))
        self.assertIn(row["hint"], json.dumps(teacher))
        self.assertEqual(student[0], teacher[0])
        self.assertEqual(student[0]["content"], prompt)
        self.assertEqual(student[1:], teacher[2:])
        self.assertIn("historical", teacher[1]["content"])

    def test_logprobs_alignment_fails_closed(self):
        self.assertEqual(completion_lps([None, -1, -2, -3], 2, 2), [-2, -3])
        for values in [[None, -1, None], [None, -1], [None, -1, float("nan")], [None, -1, .1]]:
            with self.assertRaises(ValueError):
                completion_lps(values, 2, 1)

    def test_dataset_tampering_and_family_leak_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = {"output_sha256": {}}
            for split in ["train", "validation"]:
                content = json.dumps({"family_id": "same", "split": split}) + "\n"
                (root / f"{split}.jsonl").write_text(content)
                manifest["output_sha256"][f"{split}.jsonl"] = hashlib.sha256(content.encode()).hexdigest()
            (root / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "families overlap"):
                read_seed(root)
            (root / "train.jsonl").write_text("tampered")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                read_seed(root)


if __name__ == "__main__":
    unittest.main()
