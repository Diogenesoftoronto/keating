"""Offline arithmetic, provenance, grouping, and leakage contracts."""
from copy import deepcopy
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

import user_model_evaluation as ume


class UserModelEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = ume.authored_fixture()

    def report(self):
        return ume.evaluate(self.fixture, samples=100, seed=7, bins=4)

    def profiles(self):
        return ume.prepare_profiles(self.fixture["evidence"], self.fixture["profiles"], origin="authored_fixture")

    def test_fixture_is_pure_and_never_reports_real_people(self):
        before = deepcopy(self.fixture)
        report = self.report()
        self.assertEqual(self.fixture, before)
        self.assertIn("AUTHORED FIXTURE", report["notice"])
        self.assertEqual(report["panel"]["real_respondent_count"], 0)
        self.assertEqual(report["panel"]["authored_person_count"], 3)
        self.assertEqual(report["panel"]["continuation_count"], 24)
        self.assertEqual(sum(h["actual_respondent_count"] for h in report["holdouts"].values()), 0)

    def test_profiles_keep_unknowns_observations_and_authored_assumptions(self):
        profile = self.profiles()["fixture-ada"]
        for h in profile["hypotheses"]:
            self.assertEqual(h["traits"]["confidence"], {"kind": "unknown", "value": None})
            self.assertEqual(h["traits"]["preferred_format"]["kind"], "observed")
            self.assertEqual(h["traits"]["next_move"]["kind"], "authored_assumption")
        self.assertAlmostEqual(profile["entropy_nats"], -.6 * math.log(.6) - .4 * math.log(.4))
        self.assertAlmostEqual(ume.profile_mixture(profile, {"ask": .25, "try": .75}), .45)

    def test_invalid_weights_are_not_renormalized(self):
        for weights in ({}, {"a": .2, "b": .2}, {"a": -1, "b": 2}, {"a": 0, "b": 1},
                        {"a": True}, {"a": float("nan")}, {"a": float("inf")}, {"a": "1"}):
            with self.subTest(weights=weights), self.assertRaises(ValueError):
                ume.normalized_weights(weights)
        self.assertEqual(ume.normalized_weights({"a": .2, "b": .8}), {"a": .2, "b": .8})

    def test_unknown_cannot_be_filled_without_explicit_assumption(self):
        self.fixture["profiles"][0]["hypotheses"][0]["traits"]["confidence"]["value"] = "confident"
        with self.assertRaisesRegex(ValueError, "Unknown must retain null"):
            self.profiles()

    def test_assumption_cannot_override_evidence(self):
        self.fixture["profiles"][0]["hypotheses"][0]["traits"]["preferred_format"] = {
            "kind": "authored_assumption", "value": "verbose", "rationale": "unsupported"}
        with self.assertRaisesRegex(ValueError, "cannot replace observed"):
            self.profiles()

    def test_observed_value_must_match_its_source(self):
        self.fixture["profiles"][0]["hypotheses"][0]["traits"]["preferred_format"]["value"] = "verbose"
        with self.assertRaisesRegex(ValueError, "contradicts"):
            self.profiles()

    def test_missing_trait_is_not_silently_dropped(self):
        del self.fixture["profiles"][0]["hypotheses"][0]["traits"]["confidence"]
        with self.assertRaisesRegex(ValueError, "same fields"):
            self.profiles()

    def test_cross_person_conditioning_rejected(self):
        self.fixture["profiles"][0]["evidence_ids"] = [self.fixture["evidence"][1]["id"]]
        with self.assertRaisesRegex(ValueError, "Cross-person"):
            self.profiles()

    def test_conflicting_evidence_requires_adjudication(self):
        extra = deepcopy(self.fixture["evidence"][0])
        extra.update(id="conflict", value="long")
        self.fixture["evidence"].append(extra)
        self.fixture["profiles"][0]["evidence_ids"].append("conflict")
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.profiles()

    def test_duplicate_evidence_or_hypothesis_rejected(self):
        for field in ("evidence", "hypothesis"):
            self.fixture = ume.authored_fixture()
            values = self.fixture["evidence"] if field == "evidence" else self.fixture["profiles"][0]["hypotheses"]
            values.append(deepcopy(values[0]))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "Duplicate"):
                self.profiles()

    def test_missing_extra_or_nonfinite_conditional_probability_rejected(self):
        profile = self.profiles()["fixture-ada"]
        for values in ({"ask": .5}, {"ask": .5, "try": .2, "other": .1},
                       {"ask": float("inf"), "try": .2}, {"ask": True, "try": .2}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                ume.profile_mixture(profile, values)

    def test_target_answer_cannot_enter_conditioning_directly_or_via_lineage(self):
        target = self.fixture["holdout"]["answers"][0]["id"]
        self.fixture["evidence"][0]["source_answer_ids"].append(target)
        with self.assertRaisesRegex(ValueError, "leaked through evidence lineage"):
            self.report()

    def test_fitting_cannot_use_a_held_out_answer(self):
        for key in ("fit_answer_ids", "calibration_answer_ids"):
            self.fixture = ume.authored_fixture()
            self.fixture["holdout"][key].append(self.fixture["holdout"]["answers"][0]["id"])
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "previously used"):
                self.report()

    def test_fit_calibration_people_are_disjoint(self):
        self.fixture["holdout"]["calibration_person_ids"].append("fixture-ada")
        with self.assertRaisesRegex(ValueError, "people overlap"):
            self.report()

    def test_new_person_holdout_rejects_any_seen_person(self):
        self.fixture["holdout"]["fit_person_ids"].append("fixture-cy")
        with self.assertRaisesRegex(ValueError, "Holdout person leaked"):
            self.report()

    def test_known_person_holdout_requires_prior_person(self):
        self.fixture["holdout"]["predictions"][0]["holdout"] = "new_person"
        with self.assertRaisesRegex(ValueError, "Holdout person leaked"):
            self.report()

    def test_prediction_cannot_match_a_different_persons_answer(self):
        self.fixture["holdout"]["predictions"][0]["person_id"] = "fixture-ben"
        with self.assertRaisesRegex(ValueError, "Cross-person prediction"):
            self.report()

    def test_predictions_require_exact_profile_snapshot(self):
        self.fixture["holdout"]["predictions"][0]["profile_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "profile/evidence changed"):
            self.report()

    def test_unknown_actual_is_missing_not_negative(self):
        new = self.report()["holdouts"]["new_person"]
        self.assertEqual(new["prediction_count"], 2)
        self.assertEqual(new["unknown_answer_count"], 1)
        self.assertEqual(new["answer_weighted_metrics"]["n"], 1)
        self.assertAlmostEqual(new["answer_weighted_metrics"]["brier"], .55 ** 2)
        self.assertIsNone(new["person_brier_bootstrap"]["interval_95"])

    def test_no_actual_answers_yields_no_calibration(self):
        for answer in self.fixture["holdout"]["answers"]:
            answer["value"] = None
        for result in self.report()["holdouts"].values():
            self.assertIsNone(result["answer_weighted_metrics"])
            self.assertIsNone(result["person_mean_brier"])
            self.assertEqual(result["scored_person_count"], 0)

    def test_answer_and_person_weighted_brier_stay_distinct(self):
        answer = deepcopy(self.fixture["holdout"]["answers"][0])
        answer["id"] = "another-ada-answer"
        pred = deepcopy(self.fixture["holdout"]["predictions"][0])
        pred["answer_id"] = answer["id"]
        self.fixture["holdout"]["answers"].append(answer)
        self.fixture["holdout"]["predictions"].append(pred)
        known = self.report()["holdouts"]["known_respondent"]
        self.assertAlmostEqual(known["answer_weighted_metrics"]["brier"], (2 * .55 ** 2 + .45 ** 2) / 3)
        self.assertAlmostEqual(known["person_mean_brier"], (.55 ** 2 + .45 ** 2) / 2)
        self.assertEqual(known["scored_person_count"], 2)
        self.assertEqual(known["person_brier_bootstrap"]["unit"], "person")

    def test_shared_calibration_contract_including_endpoints_and_empty_bins(self):
        from observer_probes import calibration_metrics
        for pred, p in zip(self.fixture["holdout"]["predictions"], (1., 0., .5, .5)):
            pred["conditional_probabilities"] = {"ask": p, "try": p}
        metrics = self.report()["holdouts"]["known_respondent"]["answer_weighted_metrics"]
        self.assertEqual(metrics, calibration_metrics([1, 0], [1, 0], 4))
        self.assertEqual(metrics["reliability_bins"][-1]["count"], 1)
        self.assertIsNone(metrics["reliability_bins"][1]["mean_probability"])

    def test_weighted_panel_arithmetic_and_ess(self):
        panel = self.report()["panel"]
        self.assertAlmostEqual(panel["full_panel_effect"], .5 - .3 + .2)
        self.assertAlmostEqual(panel["weighting_ess"], 1 / (.5 ** 2 + .3 ** 2 + .2 ** 2))
        self.assertEqual(panel["available_paired_respondents"], 3)
        self.assertEqual(panel["bootstrap"]["unit"], "person")

    def test_conditional_profiles_are_mixed_before_people(self):
        for row in self.fixture["panel"]["continuations"]:
            row["value"] = int(row["arm"] == "B" and row["hypothesis_id"] == "try")
        self.assertAlmostEqual(self.report()["panel"]["full_panel_effect"], .4)

    def test_replicating_continuations_does_not_inflate_people_ess_or_ci(self):
        original = self.report()["panel"]
        for row in deepcopy(self.fixture["panel"]["continuations"]):
            row["id"] += "-duplicate-draw"
            row["replicate_id"] += "-duplicate-draw"
            self.fixture["panel"]["continuations"].append(row)
        after = self.report()["panel"]
        for key in ("respondent_count", "weighting_ess", "full_panel_effect", "bootstrap"):
            self.assertEqual(original[key], after[key])
        self.assertEqual(after["continuation_count"], 2 * original["continuation_count"])

    def test_unbalanced_hypothesis_replicates_do_not_change_profile_mass(self):
        for row in deepcopy(self.fixture["panel"]["continuations"]):
            if row["hypothesis_id"] == "try":
                row["id"] += "-extra"
                row["replicate_id"] += "-extra"
                self.fixture["panel"]["continuations"].append(row)
        for row in self.fixture["panel"]["continuations"]:
            row["value"] = int(row["arm"] == "B" and row["hypothesis_id"] == "try")
        self.assertAlmostEqual(self.report()["panel"]["full_panel_effect"], .4)

    def test_changed_pair_profile_condition_or_simulation_contract_is_rejected(self):
        for key in ("profile_sha256", "condition_sha256", "simulation_sha256"):
            self.fixture = ume.authored_fixture()
            self.fixture["panel"]["continuations"][1][key] = "changed"
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.report()

    def test_cross_person_pair_and_missing_arm_are_rejected(self):
        self.fixture["panel"]["continuations"][1]["person_id"] = "fixture-ben"
        with self.assertRaisesRegex(ValueError, "A/B changed person"):
            self.report()
        self.fixture = ume.authored_fixture()
        self.fixture["panel"]["continuations"].pop()
        with self.assertRaisesRegex(ValueError, "Unpaired"):
            self.report()

    def test_duplicate_replicate_cannot_be_counted_as_another_person(self):
        extra = deepcopy(self.fixture["panel"]["continuations"][0])
        extra["id"] = "different-id-same-draw"
        self.fixture["panel"]["continuations"].append(extra)
        with self.assertRaisesRegex(ValueError, "Duplicate person/profile/replicate"):
            self.report()

    def test_missing_hypothesis_or_entire_person_is_rejected(self):
        self.fixture["panel"]["continuations"] = [r for r in self.fixture["panel"]["continuations"] if r["hypothesis_id"] != "try"]
        with self.assertRaisesRegex(ValueError, "Every respondent hypothesis"):
            self.report()

    def test_missing_outcome_preserves_denominators_and_blocks_full_effect(self):
        self.fixture["panel"]["continuations"][0]["value"] = None
        result = self.report()["panel"]
        self.assertIsNone(result["full_panel_effect"])
        self.assertEqual(result["missing_outcomes_by_arm"], {"A": 1, "B": 0})
        self.assertEqual(result["available_paired_respondents"], 2)
        self.assertAlmostEqual(result["available_respondent_weight"], .5)
        self.assertAlmostEqual(result["available_pair_effect"], (-.3 + .2) / .5)
        self.assertEqual(result["continuation_count"], 24)

    def test_all_missing_panel_has_no_effect_or_interval(self):
        for row in self.fixture["panel"]["continuations"]:
            row["value"] = None
        panel = self.report()["panel"]
        self.assertIsNone(panel["full_panel_effect"])
        self.assertIsNone(panel["available_pair_effect"])
        self.assertIsNone(panel["bootstrap"]["interval_95"])

    def test_one_person_cannot_have_a_population_interval(self):
        interval = ume.respondent_bootstrap([{"person_id": "p", "weight": 1, "value": .4}], samples=100)
        self.assertIsNone(interval["interval_95"])
        self.assertEqual(interval["reason"], "fewer_than_two_people")

    def test_bootstrap_order_invariant_seeded_and_rejects_duplicate_people(self):
        rows = [{"person_id": "a", "weight": .8, "value": .5}, {"person_id": "b", "weight": .2, "value": -.1}]
        self.assertEqual(ume.respondent_bootstrap(rows, samples=100, seed=3),
                         ume.respondent_bootstrap(list(reversed(rows)), samples=100, seed=3))
        with self.assertRaisesRegex(ValueError, "Aggregate once per person"):
            ume.respondent_bootstrap([rows[0], rows[0]], samples=100)
        for samples in (True, 0, 99, 20001):
            with self.subTest(samples=samples), self.assertRaises(ValueError):
                ume.respondent_bootstrap(rows, samples=samples)

    def test_synthetic_answers_cannot_be_claimed_as_observed(self):
        self.fixture["mode"] = "observed_panel"
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.report()

    def test_model_answer_is_never_an_actual_holdout_label(self):
        self.fixture["holdout"]["answers"][0]["provenance"]["kind"] = "simulated"
        with self.assertRaises(ValueError):
            self.report()

    def test_invalid_and_unregistered_answer_records_rejected(self):
        self.fixture["holdout"]["answers"][0]["value"] = True
        with self.assertRaisesRegex(ValueError, "binary or null"):
            self.report()
        self.fixture = ume.authored_fixture()
        self.fixture["holdout"]["predictions"].pop()
        with self.assertRaisesRegex(ValueError, "Every registered target"):
            self.report()

    def test_snapshot_mutation_rejected_by_standalone_interfaces(self):
        profiles = self.profiles()
        profiles["fixture-ada"]["hypotheses"][0]["traits"]["confidence"] = {
            "kind": "authored_assumption", "value": "confident", "rationale": "changed after admission"}
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            ume.profile_mixture(profiles["fixture-ada"], {"ask": .2, "try": .8})
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            ume.paired_panel(profiles, self.fixture["panel"], origin="authored_fixture", samples=100)
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            ume.evaluate_answers(profiles, self.fixture["holdout"], origin="authored_fixture",
                                 all_evidence=self.fixture["evidence"], samples=100)

    def test_both_panel_and_hypothesis_weights_are_validated(self):
        for target in ("panel", "hypothesis"):
            self.fixture = ume.authored_fixture()
            if target == "panel":
                self.fixture["panel"]["respondent_weights"]["fixture-ada"] = .8
            else:
                self.fixture["profiles"][0]["hypotheses"][0]["weight"] = .8
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "sum to one"):
                self.report()

    def test_arm_scores_must_be_bounded_finite_numbers(self):
        for value in (True, -1, 2, float("nan"), float("inf")):
            self.fixture = ume.authored_fixture()
            self.fixture["panel"]["continuations"][0]["value"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.report()

    def test_standalone_panel_cannot_relabel_fixture_people_as_observed(self):
        with self.assertRaisesRegex(ValueError, "provenance"):
            ume.paired_panel(self.profiles(), self.fixture["panel"], origin="observed", samples=100)

    def test_declared_answer_exposure_cannot_hide_a_seen_person(self):
        for key in ("fit_answer_ids", "calibration_answer_ids"):
            self.fixture = ume.authored_fixture()
            self.fixture["holdout"][key].append("fixture-cy-initial-answer")
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "unregistered"):
                self.report()

    def rebind_profiles(self):
        profiles = self.profiles()
        for row in self.fixture["holdout"]["predictions"] + self.fixture["panel"]["continuations"]:
            row["profile_sha256"] = profiles[row["person_id"]]["profile_sha256"]
        return profiles

    def test_unselected_lineage_still_exposes_a_development_person(self):
        for kind in ("fit", "calibration"):
            self.fixture = ume.authored_fixture()
            profile = self.fixture["profiles"][2]
            profile["evidence_ids"] = []
            for hypothesis in profile["hypotheses"]:
                hypothesis["traits"]["preferred_format"] = {"kind": "unknown", "value": None}
            self.fixture["holdout"][kind + "_answer_ids"].append("fixture-cy-initial-answer")
            self.rebind_profiles()
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "unregistered"):
                self.report()

    def test_admitted_roundoff_does_not_push_unit_probability_above_one(self):
        for offset in (-5e-10, 5e-10):
            with self.subTest(offset=offset):
                self.fixture = ume.authored_fixture()
                self.fixture["profiles"][0]["hypotheses"][0]["weight"] += offset
                profiles = self.rebind_profiles()
                self.assertEqual(ume.profile_mixture(profiles["fixture-ada"], {"ask": 1., "try": 1.}), 1.)
                for prediction in self.fixture["holdout"]["predictions"]:
                    prediction["conditional_probabilities"] = {"ask": 1., "try": 1.}
                metrics = self.report()["holdouts"]["known_respondent"]["answer_weighted_metrics"]
                self.assertEqual(metrics["brier"], .5)

    def test_unselected_lineage_does_not_become_conditioning_evidence(self):
        profile = self.fixture["profiles"][2]
        profile["evidence_ids"] = []
        for hypothesis in profile["hypotheses"]:
            hypothesis["traits"]["preferred_format"] = {"kind": "unknown", "value": None}
        profiles = self.rebind_profiles()
        self.assertEqual(self.report()["holdouts"]["new_person"]["person_count"], 1)
        self.assertEqual(profiles["fixture-cy"]["evidence"], [])
        self.fixture["holdout"]["fit_answer_ids"].append("fixture-cy-initial-answer")
        self.fixture["holdout"]["fit_person_ids"].append("fixture-cy")
        for prediction in self.fixture["holdout"]["predictions"]:
            if prediction["person_id"] == "fixture-cy":
                prediction["holdout"] = "known_respondent"
        report = self.report()
        self.assertEqual(report["holdouts"]["new_person"]["person_count"], 0)
        self.assertEqual(report["holdouts"]["known_respondent"]["person_count"], 3)
        self.assertEqual(self.profiles()["fixture-cy"], profiles["fixture-cy"])

    def test_standalone_holdout_requires_full_inventory_and_matches_selected_records(self):
        profiles = self.profiles()
        with self.assertRaises(TypeError):
            ume.evaluate_answers(profiles, self.fixture["holdout"], origin="authored_fixture", samples=100)
        with self.assertRaisesRegex(ValueError, "Selected evidence missing"):
            ume.evaluate_answers(profiles, self.fixture["holdout"], origin="authored_fixture",
                                 all_evidence=[], samples=100)
        changed = deepcopy(self.fixture["evidence"])
        changed[0]["source_answer_ids"].append("different-answer-ancestry")
        with self.assertRaisesRegex(ValueError, "Selected evidence missing or changed"):
            ume.evaluate_answers(profiles, self.fixture["holdout"], origin="authored_fixture",
                                 all_evidence=changed, samples=100)

    def test_roundoff_normalization_is_positive_idempotent_and_preserves_ratios(self):
        rng = random.Random(83)
        for count in (2, 3, 10, 30):
            for _ in range(20):
                mass = [10 ** rng.uniform(-200, 0) for _ in range(count)]
                total = math.fsum(mass)
                raw = {str(i): value / total * (1 - 5e-10) for i, value in enumerate(mass)}
                before = dict(raw)
                weights = ume.normalized_weights(raw)
                self.assertEqual(raw, before)
                self.assertEqual(math.fsum(weights.values()), 1.)
                self.assertTrue(all(0 < value <= 1 for value in weights.values()))
                self.assertEqual(ume.normalized_weights(weights), weights)
                self.assertEqual(ume.normalized_weights(dict(reversed(list(raw.items())))), weights)
                for key in raw:
                    self.assertAlmostEqual(weights[key], raw[key] / math.fsum(raw.values()), places=15)

    def test_admission_seals_effective_weights_and_entropy(self):
        self.fixture["profiles"][0]["hypotheses"][0]["weight"] += 5e-10
        before = deepcopy(self.fixture)
        profile = self.profiles()["fixture-ada"]
        weights = {h["id"]: h["weight"] for h in profile["hypotheses"]}
        self.assertEqual(math.fsum(weights.values()), 1.)
        self.assertAlmostEqual(weights["ask"], (.6 + 5e-10) / (1 + 5e-10), places=15)
        self.assertEqual(profile["entropy_nats"], -math.fsum(w * math.log(w) for w in weights.values()))
        ume.check_profile_snapshot(profile)
        original_fields = {key: profile[key] for key in self.fixture["profiles"][0]}
        readmitted = ume.prepare_profiles(profile["evidence"], [original_fields], origin="authored_fixture")
        self.assertEqual(readmitted["fixture-ada"], profile)
        self.assertEqual(self.fixture, before)

    def test_actual_invalid_probabilities_and_outside_tolerance_weights_are_never_clipped(self):
        profile = self.profiles()["fixture-ada"]
        for probability in (1 + 1e-12, -1e-12):
            with self.subTest(probability=probability), self.assertRaisesRegex(ValueError, "Finite number"):
                ume.profile_mixture(profile, {"ask": probability, "try": 1.})
        for offset in (-2e-9, 2e-9):
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, "sum to one"):
                ume.normalized_weights({"ask": .6 + offset, "try": .4})

    def test_roundoff_at_both_weight_levels_keeps_panel_boundary_scores_valid(self):
        self.fixture["profiles"][0]["hypotheses"][0]["weight"] += 5e-10
        self.fixture["panel"]["respondent_weights"]["fixture-ada"] += 5e-10
        self.rebind_profiles()
        for row in self.fixture["panel"]["continuations"]:
            row["value"] = int(row["arm"] == "B")
        panel = self.report()["panel"]
        self.assertEqual(panel["full_panel_effect"], 1.)
        self.assertEqual(panel["bootstrap"]["interval_95"], [1., 1.])

    def test_profile_information_consumes_normalized_admission_without_snapshot_drift(self):
        import profile_information as pi
        for offset in (-5e-10, 5e-10):
            with self.subTest(offset=offset):
                self.fixture = ume.authored_fixture()
                self.fixture["profiles"][0]["hypotheses"][0]["weight"] += offset
                profile = self.profiles()["fixture-ada"]
                self.assertEqual(pi.admitted_profile(profile), profile)
                request = pi.authored_fixture()["update"]
                request["profile"] = profile
                request["model"]["profile_sha256"] = profile["profile_sha256"]
                update = pi.update_profile(**request)
                self.assertEqual(update["status"], "updated")
                posterior = update["posterior_profile"]
                self.assertEqual(pi.admitted_profile(posterior), posterior)
                self.assertEqual(ume.profile_mixture(posterior, {"ask": 1., "try": 1.}), 1.)

    def test_cli_local_json_and_demo_are_identical(self):
        script = Path(ume.__file__)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "authored.json"
            path.write_text(json.dumps(self.fixture))
            result = subprocess.run([sys.executable, str(script), "evaluate", str(path), "--samples", "100"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), ume.evaluate(self.fixture, samples=100))
            path.write_text('{"mode":"observed_panel"}')
            invalid = subprocess.run([sys.executable, str(script), "evaluate", str(path)], capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)


if __name__ == "__main__":
    unittest.main()
