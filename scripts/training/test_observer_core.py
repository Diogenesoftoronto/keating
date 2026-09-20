# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "transformers==5.3.0", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""CPU fixtures: test mechanics, NOT Qwen checkpoint extraction or pedagogy."""
import copy
import importlib.util
import unittest

import observer_core as core
from observer_extract import extract_record, pinned_revision


def projection():
    return {"record_id": "sample", "family_id": "family", "boundary": "delivered",
            "latest_allowed_event_id": "answer", "labels": {"concept": 1},
            "label_provenance": {"concept": "authored"},
            "events": [{"event_id": "question", "phase": "pre_action", "visibility": "public",
                        "kind": "learner_message", "text": "Hint please."},
                       {"event_id": "private", "phase": "pre_action", "visibility": "private",
                        "kind": "assessment", "text": "SECRET_RUBRIC"},
                       {"event_id": "answer", "phase": "delivered", "visibility": "public",
                        "kind": "actor_message", "text": "Try equal units."},
                       {"event_id": "future", "phase": "retrospective", "visibility": "public",
                        "kind": "learner_message", "text": "SECRET_FUTURE"}],
            "spans": [{"event_id": "answer", "start": 0, "end": 16}]}


class BoundaryTests(unittest.TestCase):
    def test_only_permitted_prefix_and_span(self):
        view = core.boundary_view(projection())
        self.assertNotIn("SECRET", view["text"])
        self.assertNotIn("concept", view["text"])
        span = view["spans"][0]
        self.assertEqual(view["text"][span["start"]:span["end"]], "Try equal units.")
        changed = projection()
        changed["events"][-1]["text"] = "A completely different future outcome"
        self.assertEqual(view, core.boundary_view(changed))

    def test_three_phases_and_no_future_pooling(self):
        for phase, event, text in [("pre_action", "question", "Hint please."),
                                   ("delivered", "answer", "Try equal units."),
                                   ("retrospective", "future", "SECRET_FUTURE")]:
            row = projection()
            row.update(boundary=phase, latest_allowed_event_id=event,
                       spans=[{"event_id": event, "start": 0, "end": len(text)}])
            self.assertEqual(core.boundary_view(row)["boundary"], phase)
        row["latest_allowed_event_id"] = "answer"
        with self.assertRaisesRegex(ValueError, "requested public boundary"):
            core.boundary_view(row)

    def test_reject_invalid_visibility_and_unmapped_boundaries(self):
        mutations = [lambda r: r.update(boundary="unknown"),
                     lambda r: r.update(latest_allowed_event_id="missing"),
                     lambda r: r["spans"][0].update(event_id="private"),
                     lambda r: r["spans"][0].update(event_id="future"),
                     lambda r: r["events"][0].update(phase="retrospective"),
                     lambda r: r["events"][2].update(kind="tool_internal"),
                     lambda r: r["events"][2].update(kind="delivered_artifact"),
                     lambda r: r["spans"][0].update(start=True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                row = projection()
                mutate(row)
                with self.assertRaises(ValueError):
                    core.boundary_view(row)

    def test_offset_mapping_unicode_mask_and_cut_token(self):
        text = "é + 二"
        spans = [{"start": 0, "end": len(text)}]
        offsets = [(0, 0), (0, 1), (2, 3), (4, 5), (0, 0)]
        self.assertEqual(core.token_spans(text, offsets, spans, [1, 1, 1, 1, 0]), [1, 2, 3])
        with self.assertRaisesRegex(ValueError, "fully mapped"):
            core.token_spans(text, offsets, spans, [1, 1, 1, 0, 0])
        with self.assertRaisesRegex(ValueError, "cuts through"):
            core.token_spans("hello", [(0, 5)], [{"start": 1, "end": 4}], [1])

    def test_revision_must_be_immutable(self):
        import argparse
        with self.assertRaises(argparse.ArgumentTypeError):
            pinned_revision("main")
        self.assertEqual(pinned_revision("a" * 40), "a" * 40)

    def test_cli_validation_and_bad_spans_never_load_weights(self):
        import contextlib
        import io
        import json
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        import observer_extract
        with tempfile.TemporaryDirectory(prefix="observer-validation-") as directory:
            source, output = Path(directory) / "input.json", Path(directory) / "output.json"
            row = projection()
            source.write_text(json.dumps({"records": [row]}))
            args = [str(source), str(output), "--model-revision", "a" * 40,
                    "--tokenizer-revision", "a" * 40, "--sae-revision", "b" * 40,
                    "--sae-sha256", "c" * 64, "--layer", "12",
                    "--module", "language_model.layers.12", "--validate-only"]
            with patch.object(observer_extract, "load_observer", side_effect=AssertionError("Must not load")):
                with contextlib.redirect_stdout(io.StringIO()):
                    observer_extract.main(args)
                self.assertFalse(output.exists())
                row["spans"][0]["event_id"] = "future"
                source.write_text(json.dumps({"records": [row]}))
                with self.assertRaises(ValueError):
                    observer_extract.main(args[:-1])
                self.assertFalse(output.exists())


@unittest.skipUnless(importlib.util.find_spec("torch"), "CPU torch optional; run this file with uv --script")
class TensorTests(unittest.TestCase):
    def setUp(self):
        import torch
        self.torch = torch
        torch.manual_seed(7)
        self.spec = core.SAESpec(hidden=4, width=8, top_k=3)
        self.state = {"W_enc": torch.randn(8, 4), "W_dec": torch.randn(4, 8),
                      "b_enc": torch.randn(8), "b_dec": torch.randn(4)}

    def model(self, tuple_output=False, fail=False, repeat=False):
        torch = self.torch

        class Block(torch.nn.Module):
            def forward(self, x):
                return (x * 2, "unchanged-cache") if tuple_output else x * 2

        class Model(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.emb = torch.nn.Embedding(256, 4)
                self.block = Block()

            def forward(self, input_ids, attention_mask=None, use_cache=False):
                output = self.block(self.emb(input_ids))
                if repeat:
                    self.block(self.emb(input_ids))
                if fail:
                    raise RuntimeError("deliberate forward failure")
                return output

        return Model()

    def test_tensor_and_tuple_preserve_batch_and_restore_flags(self):
        torch = self.torch
        for tuple_output in (False, True):
            model = self.model(tuple_output)
            model.train()
            model.emb.eval()
            ids = torch.tensor([[1, 2, 3], [4, 5, 6]])
            actual = core.capture_residual(model, model.block, {"input_ids": ids})
            torch.testing.assert_close(actual, model.emb(ids).detach() * 2)
            self.assertEqual(actual.shape, (2, 3, 4))
            self.assertFalse(actual.requires_grad)
            self.assertTrue(model.training)
            self.assertFalse(model.emb.training)
            self.assertFalse(model.block._forward_hooks)

    def test_hook_cleanup_on_exception_and_repeated_invocation(self):
        for fail, repeat in ((True, False), (False, True)):
            model = self.model(fail=fail, repeat=repeat)
            with self.assertRaises((RuntimeError, ValueError)):
                core.capture_residual(model, model.block, {"input_ids": self.torch.tensor([[1]])})
            self.assertFalse(model.block._forward_hooks)
            self.assertTrue(model.training)

    def test_official_signed_topk_no_centering_and_chunking(self):
        torch = self.torch
        h = torch.randn(2, 5, 4)
        state = copy.deepcopy(self.state)
        state["b_enc"].fill_(-100)
        state["b_dec"].fill_(999)
        core.validate_sae(state, self.spec)
        expected_values, expected_indices = (h @ state["W_enc"].T + state["b_enc"]).topk(3, dim=-1)
        indices, values = core.encode_topk(h, state, self.spec, chunk_tokens=2)
        torch.testing.assert_close(indices, expected_indices)
        torch.testing.assert_close(values, expected_values)
        self.assertTrue((values < 0).all())

    def test_strict_shapes_finiteness_and_hidden_mismatch(self):
        for key in self.state:
            state = copy.deepcopy(self.state)
            state[key] = state[key][:-1]
            with self.assertRaises(ValueError):
                core.validate_sae(state, self.spec)
        state = copy.deepcopy(self.state)
        state["W_enc"][0, 0] = float("nan")
        with self.assertRaises(ValueError):
            core.validate_sae(state, self.spec)
        with self.assertRaises(ValueError):
            core.encode_topk(self.torch.ones(1, 5), self.state, self.spec)

    def test_intervention_scale_controls_mask_tuple_and_cleanup(self):
        torch = self.torch
        directions = core.intervention_directions(self.state, 1, self.spec, seed=19)
        again = core.intervention_directions(self.state, 1, self.spec, seed=19)
        torch.testing.assert_close(directions["random"], again["random"])
        for direction in directions.values():
            self.assertAlmostEqual(direction.norm().item(), 1.0, places=6)
        model = self.model(tuple_output=True)
        ids = torch.tensor([[1, 2]])
        baseline, _ = model(ids)
        scale = core.residual_scale(baseline)
        with core.intervene(model.block, directions["feature"], epsilon=.02, scale=scale,
                            token_mask=torch.tensor([[True, False]])):
            patched, cache = model(ids)
        self.assertEqual(cache, "unchanged-cache")
        self.assertAlmostEqual((patched[0, 0] - baseline[0, 0]).norm().item(), .02 * scale, places=6)
        torch.testing.assert_close(patched[0, 1], baseline[0, 1])
        self.assertFalse(model.block._forward_hooks)
        with self.assertRaises(RuntimeError):
            with core.intervene(model.block, directions["random"], epsilon=0, scale=scale,
                                token_mask=torch.tensor([[True, True]])):
                raise RuntimeError("deliberate")
        self.assertFalse(model.block._forward_hooks)

    def test_full_extraction_on_toy_observer(self):
        torch = self.torch

        class CharacterTokenizer:
            def __call__(self, text, **kwargs):
                return {"input_ids": torch.tensor([[ord(c) for c in text]]),
                        "attention_mask": torch.ones(1, len(text), dtype=torch.long),
                        "offset_mapping": torch.tensor([[(i, i + 1) for i in range(len(text))]])}

        model = self.model(tuple_output=True)
        manifest = {"evidence": "toy_model_not_qwen"}
        record = projection()
        record["split"] = "calibration"
        row = extract_record(model, CharacterTokenizer(), model.block, self.state, record, manifest, spec=self.spec)
        self.assertEqual(row["split"], "calibration")
        self.assertEqual(len(row["raw"]), 4)
        self.assertEqual(len(row["sparse_tokens"]), 16)
        self.assertNotIn("SECRET", row["text"])
        self.assertEqual(row["observer_manifest_sha256"], core.digest(manifest))
        for token in row["sparse_tokens"]:
            self.assertEqual(len(token["indices"]), 3)
        with self.assertRaisesRegex(ValueError, "untruncated"):
            extract_record(model, CharacterTokenizer(), model.block, self.state, projection(), manifest,
                           spec=self.spec, max_tokens=1)

    @unittest.skipUnless(importlib.util.find_spec("transformers"), "Optional pinned Transformers runtime")
    def test_real_transformers_wrapper_with_tiny_random_weights(self):
        # Exercises the actual wrapper/module API; never loads published weights.
        from transformers import AutoModel, Qwen3_5Config
        import tempfile
        torch = self.torch
        config = Qwen3_5Config(
            text_config={"hidden_size": 16, "intermediate_size": 32, "num_hidden_layers": 1,
                         "num_attention_heads": 2, "num_key_value_heads": 2, "head_dim": 8,
                         "vocab_size": 256, "layer_types": ["full_attention"],
                         "rope_parameters": {"rope_type": "default", "rope_theta": 10000.0,
                                             "partial_rotary_factor": 1.0, "mrope_section": [1, 1, 2]}},
            vision_config={"depth": 1, "hidden_size": 16, "intermediate_size": 32,
                           "num_heads": 2, "out_hidden_size": 16})
        model = AutoModel.from_config(config)
        block = model.get_submodule("language_model.layers.0")
        self.assertEqual(type(block).__name__, "Qwen3_5DecoderLayer")
        h = core.capture_residual(model, block, {"input_ids": torch.tensor([[1, 2]]),
                                               "attention_mask": torch.ones(1, 2, dtype=torch.long)})
        self.assertEqual(h.shape, (1, 2, 16))
        self.assertTrue(torch.isfinite(h).all())
        self.assertFalse(block._forward_hooks)
        with tempfile.TemporaryDirectory(prefix="observer-tiny-checkpoint-") as directory:
            model.save_pretrained(directory)
            restored, loading = AutoModel.from_pretrained(directory, local_files_only=True,
                                                          output_loading_info=True, dtype=torch.float32)
            self.assertFalse(loading["missing_keys"])
            self.assertFalse(loading["mismatched_keys"])
            reloaded = core.capture_residual(restored, restored.get_submodule("language_model.layers.0"),
                                             {"input_ids": torch.tensor([[1, 2]]),
                                              "attention_mask": torch.ones(1, 2, dtype=torch.long)})
            torch.testing.assert_close(h, reloaded)


if __name__ == "__main__":
    unittest.main()
