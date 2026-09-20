# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Authored tensor cases only: no model, provider, or human observations."""
from dataclasses import replace
import importlib.util
import math
from pathlib import Path
import subprocess
import sys
import unittest

import native_combined_loss as ncl


class ImportAndConfigTests(unittest.TestCase):
    def test_import_and_config_do_not_import_torch_or_provider_clients(self):
        script = """
import builtins
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name.split('.')[0] in {'torch', 'tinker', 'httpx', 'requests'}:
        raise AssertionError('Unexpected import: ' + name)
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
from native_combined_loss import LossConfig
LossConfig('F-only', 1, 0).validate()
"""
        run = subprocess.run([sys.executable, "-c", script],
                             cwd=Path(__file__).parent, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_mode_requires_exact_enabled_components(self):
        for mode, f, s in (("F-only", 0, 0), ("F-only", 1, 1), ("S-only", 1, 0),
                           ("F+S", 1, 0), ("F+S", 0, 1), ("other", 1, 1)):
            with self.subTest(mode=mode, f=f, s=s), self.assertRaises(ValueError):
                ncl.LossConfig(mode, f, s).validate()

    def test_coefficients_are_bounded_not_silently_normalized(self):
        for name in ("feature_coefficient", "sd_coefficient", "anchor_coefficient"):
            for bad in (-.1, 1.01, float("nan"), float("inf"), True):
                with self.subTest(name=name, bad=bad), self.assertRaises(ValueError):
                    replace(ncl.LossConfig("F+S", 1, 1), **{name: bad}).validate()
        config = ncl.LossConfig("F+S", 1, 1, 1, anchor_assumption=ncl.ANCHOR_ASSUMPTION)
        config.validate()  # These coefficients are not probability weights.

    def test_caps_epsilon_and_staleness_are_finite_and_explicitly_bounded(self):
        bounds = {"feature_cap": (.01, 100), "sd_cap": (.01, 100),
                  "epsilon": (.01, .3), "max_abs_log_ratio": (.01, 10)}
        for name, (low, high) in bounds.items():
            for bad in (0, low / 2, high + .01, float("nan"), float("inf"), True):
                with self.subTest(name=name, bad=bad), self.assertRaises(ValueError):
                    replace(ncl.LossConfig("S-only", 0, 1), **{name: bad}).validate()
            for valid in (low, high):
                replace(ncl.LossConfig("S-only", 0, 1), **{name: valid}).validate()

    def test_anchor_assumption_must_be_explicit_and_match_enabled_term(self):
        for coefficient, assumption in ((1, None), (1, "full_vocabulary_kl"),
                                         (0, ncl.ANCHOR_ASSUMPTION)):
            with self.subTest(coefficient=coefficient, assumption=assumption), self.assertRaises(ValueError):
                ncl.LossConfig("F-only", 1, 0, coefficient, anchor_assumption=assumption).validate()


@unittest.skipUnless(importlib.util.find_spec("torch"), "Optional torch is not installed")
class CombinedLossTests(unittest.TestCase):
    def setUp(self):
        import torch
        self.torch = torch

    def packet(self, values, ids=None, roles=None, mask=None, dtype=None):
        count = len(values)
        return ncl.TargetScores(
            ids if ids is not None else list(range(101, 101 + count)),
            roles if roles is not None else ["assistant_text"] * count,
            mask if mask is not None else [True] * count,
            self.torch.tensor(values, dtype=dtype or self.torch.float64, requires_grad=True),
        )

    def action(self, action_id="a", count=1, s=-2., b=-2., q=-1., feature=1., reference=-3.):
        return ncl.ActionInput(
            action_id=action_id, original_target_ids=list(range(101, 101 + count)),
            current=self.packet([s] * count), behavior=self.packet([b] * count),
            behavior_distribution="actual_sampler", feature_advantage=feature,
            teacher=self.packet([q] * count), reference=self.packet([reference] * count),
        )

    def config(self, mode="F+S", **kwargs):
        return replace(ncl.LossConfig(mode, int(mode != "S-only"), int(mode != "F-only")), **kwargs)

    def result(self, actions, mode="F+S", **kwargs):
        return ncl.combined_loss(actions, self.config(mode, **kwargs))

    def test_feature_gradient_signs_and_fixed_scalar_detachment(self):
        for advantage in (-1., 1.):
            with self.subTest(advantage=advantage):
                feature = self.torch.tensor(advantage, dtype=self.torch.float64, requires_grad=True)
                action = self.action(feature=feature)
                self.result([action], "F-only")["loss"].backward()
                self.assertAlmostEqual(action.current.logprobs.grad.item(), -advantage)
                self.assertIsNone(feature.grad)
                self.assertIsNone(action.behavior.logprobs.grad)

    def test_sd_gradient_signs_and_both_scores_detached_in_advantage(self):
        for advantage in (-1., 1.):
            with self.subTest(advantage=advantage):
                action = self.action(q=-2 + advantage)
                self.result([action], "S-only")["loss"].backward()
                # Differentiating through teacher-current would give the wrong derivative.
                self.assertAlmostEqual(action.current.logprobs.grad.item(), -advantage)
                self.assertIsNone(action.teacher.logprobs.grad)
                self.assertIsNone(action.behavior.logprobs.grad)

    def test_sd_recomputed_from_current_not_behavior_or_cached_advantage(self):
        first = self.result([self.action(s=-2, b=-2, q=-1)], "S-only")
        second = self.result([self.action(s=-1.8, b=-2, q=-1)], "S-only")
        self.assertEqual(first["actions"][0]["advantages"]["sd"], [1.])
        self.assertAlmostEqual(second["actions"][0]["advantages"]["sd"][0], .8)

    def test_sign_correct_clipping_at_both_tails_for_both_components(self):
        for mode in ("F-only", "S-only"):
            for ratio, advantage, saturated in ((1.5, 1, True), (.5, -1, True),
                                                 (.5, 1, False), (1.5, -1, False)):
                with self.subTest(mode=mode, ratio=ratio, advantage=advantage):
                    student = -2 + math.log(ratio)
                    action = self.action(s=student, q=student + advantage, feature=advantage)
                    result = self.result([action], mode)
                    result["loss"].backward()
                    self.assertAlmostEqual(action.current.logprobs.grad.item(),
                                           0 if saturated else -ratio * advantage)
                    term = "feature" if mode == "F-only" else "sd"
                    self.assertEqual(result["actions"][0]["clip_active_fraction"][term], int(saturated))
                    self.assertAlmostEqual(result["loss"].item(),
                                           -min(ratio * advantage, min(1.2, max(.8, ratio)) * advantage))

    def test_f_plus_s_clips_separate_terms_before_weighting(self):
        # At the upper tail, +F saturates while -S still has a gradient.
        # Summing these advantages before clipping would erase this signal.
        s = -2 + math.log(1.5)
        action = self.action(s=s, q=s - 1, feature=1)
        result = self.result([action], feature_coefficient=.25, sd_coefficient=.75)
        self.assertAlmostEqual(result["components"]["feature"].item(), -1.2)
        self.assertAlmostEqual(result["components"]["sd"].item(), 1.5)
        self.assertAlmostEqual(result["loss"].item(), .25 * -1.2 + .75 * 1.5)
        result["loss"].backward()
        self.assertAlmostEqual(action.current.logprobs.grad.item(), .75 * 1.5)

    def test_independent_fixed_caps_apply_to_both_signs(self):
        for sign in (-1, 1):
            action = self.action(s=-5, b=-5, q=-5 + 4 * sign, feature=10 * sign)
            result = self.result([action], feature_cap=.25, sd_cap=.5)
            self.assertEqual(result["advantage_recipe"], "independent_fixed_caps/v1")
            self.assertEqual(result["actions"][0]["advantages"], {"feature": [.25 * sign], "sd": [.5 * sign]})
            result["loss"].backward()
            self.assertAlmostEqual(action.current.logprobs.grad.item(), -.75 * sign)

    def test_action_length_does_not_change_aggregate_weight(self):
        short, long = self.action("short"), self.action("long", count=3)
        result = self.result([short, long], "F-only")
        self.assertAlmostEqual(result["loss"].item(), -1)
        result["loss"].backward()
        self.assertAlmostEqual(short.current.logprobs.grad.sum().item(), -.5)
        self.assertAlmostEqual(long.current.logprobs.grad.sum().item(), -.5)
        self.assertEqual(result["actions"][0]["token_loss_weight"], .5)
        self.assertAlmostEqual(result["actions"][1]["token_loss_weight"], 1 / 6)
        self.assertEqual(result["metrics"]["completion_token_count"], 4)

    def test_repeating_completion_preserves_each_component_mean(self):
        kwargs = {"anchor_coefficient": .2, "anchor_assumption": ncl.ANCHOR_ASSUMPTION}
        short = self.result([self.action(count=1)], **kwargs)
        long = self.result([self.action(count=7)], **kwargs)
        for key in ("feature", "sd", "anchor"):
            self.assertAlmostEqual(short["components"][key].item(), long["components"][key].item())
        self.assertAlmostEqual(short["loss"].item(), long["loss"].item())

    def test_reference_anchor_is_logged_target_mse_with_detached_reference(self):
        for student, reference in ((-2, -3), (-3, -2)):
            action = self.action(s=student, b=student, reference=reference, feature=0)
            result = self.result([action], "F-only", anchor_coefficient=.4,
                                 anchor_assumption=ncl.ANCHOR_ASSUMPTION)
            self.assertAlmostEqual(result["components"]["anchor"].item(), .5)
            result["loss"].backward()
            self.assertAlmostEqual(action.current.logprobs.grad.item(), .4 * (student - reference))
            self.assertIsNone(action.reference.logprobs.grad)

    def test_enabled_scoring_paths_required_and_disabled_paths_not_needed(self):
        bare = replace(self.action(), teacher=None, reference=None, feature_advantage=None)
        for mode in ("S-only", "F+S"):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "teacher TargetScores"):
                self.result([bare], mode)
        with self.assertRaisesRegex(ValueError, "reference TargetScores"):
            self.result([replace(bare, feature_advantage=1)], "F-only", anchor_coefficient=.2,
                        anchor_assumption=ncl.ANCHOR_ASSUMPTION)
        self.assertEqual(self.result([replace(bare, feature_advantage=1)], "F-only")["status"], "computed")

    def test_different_prefix_lengths_and_masked_nans_preserve_target_alignment(self):
        action = self.action(count=2)
        current = self.packet([float("nan")] * 4 + [-2., -2.],
                              [1, 2, 3, 4, 101, 102],
                              ["prompt", "tool_result", "learner", "padding", "assistant_text", "assistant_tool_call"],
                              [False] * 4 + [True, True])
        teacher = self.packet([float("nan"), -1., -1.], [5, 101, 102],
                              ["prompt", "assistant_text", "assistant_tool_call"], [False, True, True])
        reference = self.packet([float("nan"), -3., -3.], [6, 101, 102],
                                ["prompt", "assistant_text", "assistant_text"], [False, True, True])
        behavior = self.packet([float("nan"), -2., -2.], [7, 101, 102],
                               ["learner", "assistant_text", "assistant_text"], [False, True, True])
        action = replace(action, current=current, teacher=teacher, reference=reference, behavior=behavior)
        result = self.result([action], anchor_coefficient=.5, anchor_assumption=ncl.ANCHOR_ASSUMPTION)
        self.assertTrue(math.isfinite(result["loss"].item()))
        result["loss"].backward()
        self.assertEqual(current.logprobs.grad[:4].tolist(), [0.] * 4)
        self.assertEqual(current.logprobs.grad[4:].tolist(), [-.75, -.75])
        for packet in (teacher, reference, behavior):
            self.assertIsNone(packet.logprobs.grad)

    def test_each_scoring_path_rejects_changed_or_reordered_original_ids(self):
        for path in ("current", "behavior", "teacher", "reference"):
            for wrong_ids in ([102, 101], [101, 999]):
                action = self.action(count=2)
                packet = replace(getattr(action, path), target_ids=wrong_ids)
                with self.subTest(path=path, ids=wrong_ids), self.assertRaisesRegex(ValueError, "original target alignment"):
                    self.result([replace(action, **{path: packet})], anchor_coefficient=.2,
                                anchor_assumption=ncl.ANCHOR_ASSUMPTION)

    def test_non_actor_roles_cannot_become_targets(self):
        for path in ("current", "behavior", "teacher", "reference"):
            for role in ("prompt", "tool_result", "learner", "padding"):
                action = self.action()
                packet = replace(getattr(action, path), token_roles=[role])
                with self.subTest(path=path, role=role), self.assertRaisesRegex(ValueError, "excluded"):
                    self.result([replace(action, **{path: packet})], anchor_coefficient=.2,
                                anchor_assumption=ncl.ANCHOR_ASSUMPTION)

    def test_masks_and_tensor_lengths_are_strict(self):
        action = self.action()
        malformed = (
            {"completion_mask": [False]}, {"completion_mask": [1]}, {"completion_mask": []},
            {"token_roles": []}, {"token_roles": ["unknown"]},
            {"logprobs": self.torch.tensor([[-2.]])}, {"logprobs": self.torch.tensor([-2., -2.])},
            {"logprobs": self.torch.tensor([-2])}, {"target_ids": [True]},
        )
        for fields in malformed:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.result([replace(action, current=replace(action.current, **fields))])

    def test_no_empty_or_missing_completion(self):
        with self.assertRaisesRegex(ValueError, "Nonempty action batch"):
            self.result([])
        with self.assertRaisesRegex(ValueError, "Nonempty original"):
            self.result([replace(self.action(), original_target_ids=[])])
        with self.assertRaisesRegex(ValueError, "original target alignment"):
            self.result([replace(self.action(count=2), original_target_ids=[101])])

    def test_nonfinite_or_invalid_selected_logprob_rejected_in_every_enabled_path(self):
        for path in ("current", "behavior", "teacher", "reference"):
            for bad in (float("nan"), float("inf"), float("-inf"), .01, -1e6 - 1):
                with self.subTest(path=path, bad=bad), self.assertRaisesRegex(ValueError, "selected logprobs"):
                    self.result([replace(self.action(), **{path: self.packet([bad])})],
                                anchor_coefficient=.2, anchor_assumption=ncl.ANCHOR_ASSUMPTION)

    def test_missing_feature_abstains_whole_batch_without_reweighting_or_s_fallback(self):
        actions = [self.action("known"), self.action("unknown", feature=None)]
        result = self.result(actions)
        self.assertEqual(result["status"], "abstained")
        self.assertEqual(result["reason"], "unknown_feature_advantage")
        self.assertEqual(result["unknown_feature_actions"], ["unknown"])
        self.assertIsNone(result["loss"])
        self.assertTrue(all(x is None for x in result["components"].values()))
        self.assertTrue(all(a.current.logprobs.grad is None for a in actions))
        self.assertEqual(self.result(actions, "S-only")["status"], "computed")

    def test_known_zero_feature_does_not_drop_action_from_denominator(self):
        result = self.result([self.action("one"), self.action("zero", feature=0)], "F-only")
        self.assertAlmostEqual(result["loss"].item(), -.5)
        self.assertEqual(self.result([self.action(feature=0)])["status"], "computed")

    def test_all_known_signals_zero_abstain_but_saturated_gradients_are_reported(self):
        result = self.result([self.action(feature=0, q=-2)])
        self.assertEqual(result["reason"], "zero_training_signal")
        self.assertIsNone(result["loss"])
        saturated_action = self.action(s=-2 + math.log(1.5))
        saturated = self.result([saturated_action], "F-only")
        self.assertEqual(saturated["status"], "computed")
        gradient = ncl.logprob_gradient_diagnostics(saturated, [saturated_action])
        self.assertEqual(gradient["components"]["total"]["l2_norm"], 0)

    def test_invalid_feature_is_not_unknown_or_zero(self):
        for bad in (float("nan"), float("inf"), True, [1.],
                    self.torch.tensor([1.]), self.torch.tensor(float("nan"))):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "Feature advantage"):
                self.result([self.action(feature=bad)])

    def test_unknown_feature_does_not_hide_other_malformed_inputs(self):
        with self.assertRaisesRegex(ValueError, "teacher original target alignment"):
            self.result([self.action("unknown", feature=None),
                         replace(self.action("invalid"), teacher=self.packet([-1.], ids=[999]))])

    def test_behavior_distribution_and_actual_probabilities_control_ratio(self):
        with self.assertRaisesRegex(ValueError, "Actual behavior"):
            self.result([replace(self.action(), behavior_distribution="raw_base_model")])
        unit = self.result([self.action()], "F-only")
        action = self.action(b=-2 - math.log(.9))
        result = self.result([action], "F-only")
        self.assertAlmostEqual(unit["actions"][0]["ratio_min"], 1)
        self.assertAlmostEqual(result["actions"][0]["ratio_min"], .9)
        result["loss"].backward()
        self.assertAlmostEqual(action.current.logprobs.grad.item(), -.9)

    def test_staleness_both_directions_rejected_before_exponentiation(self):
        for s, b in ((-1, -1000), (-1000, -1)):
            with self.subTest(s=s, b=b), self.assertRaisesRegex(ValueError, "Stale or unstable"):
                self.result([self.action(s=s, b=b)], "F-only")

    def test_unique_actions_distinct_tensors_and_current_autograd_required(self):
        first = self.action()
        for actions in ([first, self.action()], [first, replace(first, action_id="b")],
                        [replace(first, action_id=" ")],
                        [replace(first, current=replace(first.current, logprobs=first.current.logprobs.detach()))]):
            with self.subTest(ids=[a.action_id for a in actions]), self.assertRaises(ValueError):
                self.result(actions)

    def test_half_scores_compute_in_float32_and_float64_is_retained(self):
        for dtype, expected in ((self.torch.float32, self.torch.float32),
                                (self.torch.float64, self.torch.float64)):
            action = self.action()
            action = replace(action, current=self.packet([-2.], dtype=dtype),
                             teacher=self.packet([-1.], dtype=self.torch.float16))
            result = self.result([action])
            self.assertEqual(result["loss"].dtype, expected)
            result["loss"].backward()
            self.assertTrue(self.torch.isfinite(action.current.logprobs.grad).all())

    def test_low_precision_current_gradient_storage_rejected(self):
        # Arithmetic promotion alone gives a finite loss but an infinite
        # float16 leaf gradient at these admitted cap/log-ratio bounds.
        for dtype in (self.torch.float16, self.torch.bfloat16):
            action = replace(self.action(b=-11, feature=-100), current=self.packet([-1.], dtype=dtype))
            with self.subTest(dtype=dtype), self.assertRaisesRegex(ValueError, "gradient storage"):
                self.result([action], "F-only", feature_cap=100)

    def test_float32_gradients_finite_at_cap_and_ratio_bound(self):
        action = replace(self.action(b=-11, feature=-100), current=self.packet([-1.], dtype=self.torch.float32))
        result = self.result([action], "F-only", feature_cap=100)
        diagnostic = ncl.logprob_gradient_diagnostics(result, [action])
        self.assertTrue(math.isfinite(diagnostic["components"]["total"]["l2_norm"]))
        result["loss"].backward()
        self.assertTrue(self.torch.isfinite(action.current.logprobs.grad).all())
        self.assertAlmostEqual(action.current.logprobs.grad.item(), 100 * math.exp(10), delta=.5)

    def test_gradient_diagnostics_are_local_and_leave_backward_available(self):
        for sign, expected_cosine in ((1., 1.), (-1., -1.)):
            action = self.action(feature=sign)
            result = self.result([action], feature_coefficient=.25, sd_coefficient=.5)
            diagnostic = ncl.logprob_gradient_diagnostics(result, [action])
            self.assertEqual(diagnostic["coordinate_system"], "supplied_current_target_logprobs")
            self.assertFalse(diagnostic["full_parameter_gradients"])
            self.assertAlmostEqual(diagnostic["feature_sd_cosine"], expected_cosine)
            self.assertIsNone(diagnostic["components"]["anchor"])
            self.assertAlmostEqual(diagnostic["components"]["feature"]["l2_norm"], 1)
            expected = -.25 * sign - .5
            self.assertAlmostEqual(diagnostic["components"]["total"]["per_action"]["a"][0], expected)
            self.assertIsNone(action.current.logprobs.grad)
            result["loss"].backward()
            self.assertAlmostEqual(action.current.logprobs.grad.item(), expected)

    def test_zero_component_gradient_has_no_defined_cosine(self):
        action = self.action(feature=0)
        result = self.result([action])
        diagnostic = ncl.logprob_gradient_diagnostics(result, [action])
        self.assertIsNone(diagnostic["feature_sd_cosine"])
        self.assertEqual(diagnostic["components"]["feature"]["l2_norm"], 0)

    def test_diagnostics_reject_abstention_or_reordered_actions(self):
        action = self.action(feature=None)
        with self.assertRaisesRegex(ValueError, "abstained"):
            ncl.logprob_gradient_diagnostics(self.result([action]), [action])
        actions = [self.action("a"), self.action("b")]
        result = self.result(actions)
        with self.assertRaisesRegex(ValueError, "Diagnostic action alignment"):
            ncl.logprob_gradient_diagnostics(result, actions[::-1])


if __name__ == "__main__":
    unittest.main()
