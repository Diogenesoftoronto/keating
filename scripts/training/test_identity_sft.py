import copy
import json
from pathlib import Path
import tempfile
import unittest

from prepare_identity_sft import DEFAULT_DATA, compile_dataset, sha, validate_catalog


class IdentityDatasetTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(DEFAULT_DATA.read_text())

    def test_question_family_leak_is_rejected_even_with_new_wording(self):
        self.catalog["validation"][0]["family"] = self.catalog["train"][0]["family"]
        with self.assertRaisesRegex(ValueError, "family crosses"):
            validate_catalog(self.catalog)

    def test_missing_fact_provenance_is_rejected(self):
        self.catalog["train"][0]["sources"] = ["unverified_claim"]
        with self.assertRaisesRegex(ValueError, "source references"):
            validate_catalog(self.catalog)

    def test_compilation_preserves_prompt_and_rejects_model_or_source_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.md"
            source.write_text("Grounded app fact.")
            catalog = copy.deepcopy(self.catalog)
            catalog["sources"] = {key: {"path": "source.md", "anchor": "Grounded app fact."}
                                  for key in catalog["sources"]}
            catalog_path = root / "catalog.json"
            catalog_path.write_text(json.dumps(catalog))
            prompt = root / "system.txt"
            prompt.write_text("The exact application prompt.\n")
            tools = root / "tool-schemas.json"
            tools.write_text("[]")
            Path(str(prompt) + ".metadata.json").write_text(json.dumps({
                "verifiedEqualToOriginalWebBuilder": True,
                "promptSha256": sha(prompt.read_bytes()),
                "sourceSha256": {"source.md": sha(source.read_bytes())},
                "toolSchemas": {"sha256": sha(tools.read_bytes())},
            }))
            model = root / "model.json"
            model.write_text(json.dumps({"model": catalog["base_model"]}))
            splits, manifest = compile_dataset(catalog_path, prompt, model, root)
            self.assertEqual(splits["train"][0]["messages"][0]["content"], prompt.read_text())
            self.assertEqual(splits["train"][0]["messages"][-1]["content"], catalog["train"][0]["assistant"])
            self.assertEqual(manifest["counts"], {"train": 36, "validation": 12})
            model.write_text('{"model":"another-model"}')
            with self.assertRaisesRegex(ValueError, "model and identity"):
                compile_dataset(catalog_path, prompt, model, root)
            model.write_text(json.dumps({"model": catalog["base_model"]}))
            source.write_text("Changed app behavior.")
            with self.assertRaisesRegex(ValueError, "Prompt source changed"):
                compile_dataset(catalog_path, prompt, model, root)


if __name__ == "__main__":
    unittest.main()
