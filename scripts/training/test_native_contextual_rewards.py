# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.10.0+cpu", "numpy==2.2.6", "typer>=0.12"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Authored trajectories/classifications. No inference, real approval or spend."""
from copy import deepcopy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import benchmark_response_grading as grading
import native_contextual_rewards as rewards
import native_custom_update as custom
import native_training as nt
import test_native_custom_update as fixtures
import test_native_hindsight as hindsight


def inputs(learner="I keep subtracting the coefficient and it is still wrong.", mode="F+S", accepted=True):
    original = hindsight.fixtures.fixture_episode
    def episode(*args, **kwargs):
        value = json.loads(json.dumps(original(*args, **kwargs)).replace("INITIAL_LEARNER", learner))
        hindsight.fixtures.reseal_episode(value)
        return value
    with patch.object(hindsight.fixtures, "fixture_episode", episode):
        raw = fixtures.inputs(mode, accepted=accepted)
    spec = nt.seal({"kind": rewards.VERSION, "classifier": {
        "kind": "model_api", "id": "AUTHORED-independent-classifier", "revision": "AUTHORED-v1",
        "protocol": grading.PROTOCOL, "artifact_sha256": "a" * 64, "calibration_sha256": "b" * 64,
        "minimum_confidence": .8}, "reward_scale": 1.,
        "excluded_family_aliases": ["AUTHORED-probe-calibration", "AUTHORED-probe-test"],
        "excluded_sources": []}, "spec_hash")
    return raw, spec


class Classifier:
    def __init__(self, need="explanation_needed", fit="appropriate", move="explanation", substantive=True):
        self.need, self.fit, self.move, self.substantive = need, fit, move, substantive
        self.calls = []
    def __call__(self, request):
        self.calls.append(deepcopy(request))
        if request["stage"] == "need":
            message = next(m for m in request["input"]["messages"] if m["role"] == "user")
            return {"need": self.need, "confidence": .95, "reason": "AUTHORED prefix judgment",
                    "evidence": [{k: message[k] for k in ("message_index", "text")} |
                                 {"start": 0, "end": len(message["text"])}]}
        text = request["input"]["response"]
        return {"legible": True, "meta": False, "correct": True, "confidence": .95,
                "reason": "AUTHORED response judgment", "moves": [{"kind": self.move,
                    "start": 0, "end": len(text), "text": text, "fit": self.fit,
                    "substantive": self.substantive, "reason": "AUTHORED contextual fit"}]}


class ContextualTrainingTests(unittest.TestCase):
    def prepare(self, raw, spec, classifier=None):
        return rewards.prepare_rewards(*raw[:5], spec, classifier or Classifier())

    def test_same_explanation_positive_after_failure_negative_when_taking_over(self):
        failure, spec = inputs()
        working, other_spec = inputs("I divided both sides by 3. Now I am checking my answer.")
        supported = self.prepare(failure, spec)
        takeover = self.prepare(working, other_spec, Classifier("room_to_reason", "overhelp"))
        a, b = supported["records"][0], takeover["records"][0]
        self.assertEqual(a["response"]["text"], b["response"]["text"])
        self.assertEqual((a["reward"], b["reward"]), (1, -1))
        self.assertNotEqual(a["context"], b["context"])
        for raw, audit, value in ((failure, supported, 1), (working, takeover, -1)):
            plan = custom.prepare_custom_update(*raw[:6], audit, renderer=hindsight.Renderer())
            self.assertEqual(plan["rows"][0]["action_feature"]["action_advantage"], value)
            self.assertEqual(plan["contextual_reward_hash"], audit["audit_hash"])

    def test_withholding_needed_explanation_penalized_and_useful_question_rewarded(self):
        raw, spec = inputs()
        self.assertEqual(self.prepare(raw, spec, Classifier(fit="underhelp", move="withholding"))
                         ["records"][0]["reward"], -1)
        self.assertEqual(self.prepare(raw, spec, Classifier(need="clarification_needed", move="diagnostic_question"))
                         ["records"][0]["reward"], 1)

    def test_need_action_and_hindsight_have_separate_event_boundaries(self):
        raw, spec = inputs()
        classifier = Classifier()
        audit = self.prepare(raw, spec, classifier)
        before, delivered = map(nt.native_json, classifier.calls)
        self.assertNotIn("VISIBLE_ARTIFACT", before)
        self.assertIn("VISIBLE_ARTIFACT", delivered)
        for hidden in ("LEARNER_FUTURE", "LATER_TUTOR_MUST_NOT_LEAK", "GOLD_PRIVATE_FUTURE", "TOOL_PRIVATE_RESULT", "STATE_PRIVATE"):
            self.assertNotIn(hidden, before + delivered)
        renderer = hindsight.Renderer()
        plan = custom.prepare_custom_update(*raw[:6], audit, renderer=renderer)
        self.assertIn("LEARNER_FUTURE", json.dumps(renderer.calls[1]))
        self.assertNotIn("AUTHORED response judgment", json.dumps(renderer.calls[1]))
        self.assertEqual(plan["rows"][0]["record"]["segment"]["completion_token_ids"], [20, 21, 22])
        self.assertEqual(plan["rows"][0]["record"]["segment"]["loss_mask"], [0, 0, 1, 1, 1])

    def test_unknown_abstains_and_vague_known_action_is_zero(self):
        raw, spec = inputs()
        unknown = self.prepare(raw, spec, Classifier(need="unknown"))
        self.assertIsNone(unknown["feature_signals"])
        self.assertIsNone(unknown["records"][0]["reward"])
        with self.assertRaisesRegex(ValueError, "contextual_reward_abstention"):
            custom.prepare_custom_update(*raw[:6], unknown, renderer=hindsight.Renderer())
        vague = self.prepare(raw, spec, Classifier(substantive=False))
        self.assertEqual(vague["feature_signals"]["signals"][0]["action_advantage"], 0)

    def test_v4_alias_and_classifier_holdout_rejected_before_any_calls(self):
        family = sorted(rewards.protected_benchmark_families()[0])[0]
        for alias in (family, "family:" + family, "AUTHORED-probe-calibration"):
            raw, spec = inputs()
            raw[3]["families"][0]["aliases"].append(alias)
            raw[3] = nt.seal(raw[3], "split_hash")
            classifier = Classifier()
            with self.assertRaisesRegex(ValueError, "protected_contextual_reward_family"):
                self.prepare(raw, spec, classifier)
            self.assertEqual(classifier.calls, [])

    def test_renamed_holdout_record_rejected_by_hash(self):
        raw, spec = inputs()
        spec["excluded_sources"] = [{"dataset": "renamed", "record_id": "renamed",
                                      "record_sha256": raw[3]["families"][0]["sources"][0]["record_sha256"]}]
        spec = nt.seal(spec, "spec_hash")
        with self.assertRaisesRegex(ValueError, "protected_contextual_reward_source"):
            self.prepare(raw, spec)

    def test_exact_span_and_future_evidence_rejected(self):
        for kind in ("future", "span"):
            raw, spec = inputs()
            classifier = Classifier()
            def invalid(request):
                result = classifier(request)
                if request["stage"] == "need" and kind == "future":
                    result["evidence"][0]["message_index"] = 999
                if request["stage"] == "reaction" and kind == "span":
                    result["moves"][0]["text"] = "invented quotation"
                return result
            with self.assertRaises(ValueError):
                self.prepare(raw, spec, invalid)

    def test_fixture_and_uncalibrated_labels_diagnostic_only(self):
        for field, value in (("kind", "fixture"), ("calibration_sha256", None)):
            raw, spec = inputs()
            spec["classifier"][field] = value
            spec = nt.seal(spec, "spec_hash")
            result = self.prepare(raw, spec)
            self.assertIsNone(result["feature_signals"])
            self.assertEqual(result["records"][0]["abstention"], "fixture_or_uncalibrated_classifier")

    def test_resealed_reward_or_context_tamper_rejected_at_training_entry(self):
        for field in ("reward", "context", "features"):
            raw, spec = inputs()
            audit = self.prepare(raw, spec)
            if field == "reward": audit["records"][0]["reward"] = -1
            elif field == "context": audit["records"][0]["context"]["messages"][0]["text"] += " future"
            else:
                audit["feature_signals"]["signals"][0]["action_advantage"] = -1
                audit["feature_signals"] = nt.seal(audit["feature_signals"], "features_hash")
            audit = nt.seal(audit, "audit_hash")
            with self.assertRaisesRegex(ValueError, "contextual_reward_reconstruction_mismatch"):
                custom.prepare_custom_update(*raw[:6], audit, renderer=hindsight.Renderer())

    def test_one_scalar_per_action_not_per_span(self):
        raw, spec = inputs()
        classifier = Classifier()
        def many_moves(request):
            result = classifier(request)
            if request["stage"] == "reaction":
                result["moves"].append({**result["moves"][0], "kind": "worked_step"})
            return result
        audit = self.prepare(raw, spec, many_moves)
        self.assertEqual(len(audit["records"][0]["reaction"]["moves"]), 2)
        self.assertEqual(audit["feature_signals"]["signals"][0]["action_advantage"], 1)
        response = audit["records"][0]["response"]
        self.assertTrue(any(s["kind"] == "delivered_artifact" for s in response["spans"]))
        self.assertTrue(all(0 <= s["start"] < s["end"] <= len(response["text"]) for s in response["spans"]))

    def test_rejected_action_negative_f_only_but_no_sft_or_hindsight_admission(self):
        raw, spec = inputs(mode="F-only", accepted=False)
        audit = self.prepare(raw, spec, Classifier(fit="underhelp", move="withholding"))
        plan = custom.prepare_custom_update(*raw[:6], audit)
        self.assertEqual(plan["rows"][0]["action_feature"]["action_advantage"], -1)
        positive = self.prepare(raw, spec)
        self.assertIsNone(positive["feature_signals"])
        raw, spec = inputs(accepted=False)
        audit = self.prepare(raw, spec, Classifier(fit="underhelp"))
        with self.assertRaisesRegex(ValueError, "missing_accepted_capture"):
            custom.prepare_custom_update(*raw[:6], audit, renderer=hindsight.Renderer())

    def test_cli_classifier_receipt_to_custom_training_plan_without_dispatch(self):
        raw, spec = inputs(mode="F-only")
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as output:
            root = Path(directory)
            files = dict(zip(("episode", "captures", "reviews", "splits", "base-config", "custom-config"),
                             [raw[0][0], *raw[1:6]]))
            files["spec"] = spec
            files["classifier-config"] = {"classifier": spec["classifier"], "max_calls": 2, "timeout_seconds": 10,
                "command": [sys.executable, "-B", "-c",
                    "import sys,json; sys.path.insert(0," + repr(str(Path(__file__).parent)) + "); "
                    "from test_native_contextual_rewards import Classifier; "
                    "print(json.dumps(Classifier()(json.load(sys.stdin))))"]}
            for name, value in files.items():
                (root / (name + ".json")).write_text(json.dumps(value))
            shared = [item for name in ("episode", "captures", "reviews", "splits", "base-config")
                      for item in ("--" + name, str(root / (name + ".json")))]
            audit_path = root / "contextual.json"
            rewards.main([*shared, "--spec", str(root / "spec.json"), "--classifier-config",
                          str(root / "classifier-config.json"), "--output", str(audit_path)])
            self.assertEqual(custom.main([*shared, "--custom-config", str(root / "custom-config.json"),
                              "--features", str(audit_path), "--output", str(root / "plan")]), 0, output.getvalue())
            plan = nt.load_json(root / "plan/plan.json")
            self.assertEqual(plan["contextual_reward_hash"], nt.load_json(audit_path)["audit_hash"])
            self.assertEqual(plan["rows"][0]["action_feature"]["action_advantage"], 1)
            self.assertFalse((root / "plan/result.json").exists())

    @unittest.skipUnless(importlib.util.find_spec("torch"), "CPU torch is not installed")
    def test_contextual_signal_reaches_real_custom_callback_gradient_and_prompt_mask(self):
        import torch
        for mode in ("F-only", "F+S"):
            for fit, sign in (("appropriate", -1), ("underhelp", 1)):
                raw, spec = inputs(mode=mode)
                audit = self.prepare(raw, spec, Classifier(fit=fit))
                plan = custom.prepare_custom_update(*raw[:6], audit, renderer=hindsight.Renderer())
                segment = plan["rows"][0]["record"]["segment"]
                values = segment["behavior_logprobs"]
                current = torch.tensor([-8., -9., *values], requires_grad=True)
                datum = NS(model_input=NS(to_ints=lambda: segment["input_tokens"]),
                           loss_fn_inputs={"target_tokens": NS(data=segment["target_tokens"])})
                callback = custom.make_callback(plan, [values], [], {})
                loss, _ = callback([datum], [current])
                loss.backward()
                self.assertEqual(current.grad[:2].tolist(), [0., 0.])
                self.assertTrue(all(sign * g > 0 for g in current.grad[2:].tolist()))


if __name__ == "__main__":
    unittest.main()
