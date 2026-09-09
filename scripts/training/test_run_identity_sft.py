import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from run_identity_sft import load_dataset


class IdentityRunnerTests(unittest.TestCase):
    def test_tampered_examples_cannot_reach_training(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent = {"model": "thinkingmachines/Inkling-Small", "system_prompt_sha256": hashlib.sha256(b"exact prompt").hexdigest()}
            manifest = {"base_model": parent["model"], "system_prompt_sha256": parent["system_prompt_sha256"], "output_sha256": {}}
            for split in ("train", "validation"):
                row = {"family": split, "tools": [], "messages": [
                    {"role": "system", "content": "exact prompt"},
                    {"role": "user", "content": "Who are you?"},
                    {"role": "assistant", "content": "The latest version of Keating Bot."}]}
                body = (json.dumps(row) + "\n").encode()
                (root / f"{split}.jsonl").write_bytes(body)
                manifest["output_sha256"][f"{split}.jsonl"] = hashlib.sha256(body).hexdigest()
            (root / "manifest.json").write_text(json.dumps(manifest))
            rows, _ = load_dataset(root, parent)
            self.assertEqual(len(rows["train"]), 1)
            with self.assertRaisesRegex(ValueError, "base models differ"):
                load_dataset(root, {**parent, "model": "another-model"})
            (root / "train.jsonl").write_text("tampered")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_dataset(root, parent)


if __name__ == "__main__":
    unittest.main()
