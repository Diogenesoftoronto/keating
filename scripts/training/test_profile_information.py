"""Deterministic authored checks; no real people, inference, or network calls."""
from copy import deepcopy
from itertools import permutations
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import profile_information as pi
import user_model_evaluation as ume


class ProfileInformationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = pi.authored_fixture()
        self.request = self.fixture["update"]
        self.selection = self.fixture["selection"]

    def update(self):
        return pi.update_profile(**self.request)

    def select(self):
        return pi.select_question(**self.selection)

    def test_bayes_rule_matches_analytic_answer_and_upstream_contract(self):
        result = self.update()
        self.assertEqual(result["status"], "updated")
        self.assertAlmostEqual(result["evidence_probability"], .56)
        self.assertAlmostEqual(result["log_evidence_probability"], math.log(.56))
        profile = result["posterior_profile"]
        weights = {h["id"]: h["weight"] for h in profile["hypotheses"]}
        self.assertAlmostEqual(weights["ask"], 6 / 7)
        self.assertAlmostEqual(weights["try"], 1 / 7)
        self.assertEqual(pi.admitted_profile(profile), profile)
        self.assertAlmostEqual(ume.profile_mixture(profile, {"ask": 1, "try": 0}), 6 / 7)

    def test_old_facts_unknowns_and_assumptions_unchanged(self):
        before = deepcopy(self.request)
        result = self.update()
        self.assertEqual(self.request, before)
        posterior = result["posterior_profile"]
        for old, new in zip(before["profile"]["hypotheses"], posterior["hypotheses"]):
            for key, value in old["traits"].items():
                self.assertEqual(new["traits"][key], value)
            self.assertEqual(new["traits"]["confidence"], {"kind": "unknown", "value": None})
            self.assertEqual(new["traits"]["next_move"]["kind"], "authored_assumption")
            self.assertEqual(new["traits"]["answer:help-choice"]["kind"], "observed")
        old_evidence = {e["id"]: e for e in before["profile"]["evidence"]}
        for evidence in posterior["evidence"]:
            if evidence["id"] in old_evidence:
                self.assertEqual(evidence, old_evidence[evidence["id"]])
        self.assertEqual(posterior["weight_provenance"]["kind"], "authored_assumption")
        self.assertEqual(posterior["person_provenance"]["kind"], "authored_fixture")

    def test_certain_hypothesis_is_not_promoted_to_observed(self):
        self.request["model"]["likelihoods"]["try"] = {"clarification": 0, "attempt": 1}
        result = self.update()
        self.assertEqual(result["dropped_hypotheses"], ["try"])
        hypothesis, = result["posterior_profile"]["hypotheses"]
        self.assertEqual(hypothesis["weight"], 1)
        self.assertEqual(hypothesis["traits"]["next_move"]["kind"], "authored_assumption")
        self.assertEqual(pi.admitted_profile(result["posterior_profile"]), result["posterior_profile"])

    def test_zero_probability_evidence_abstains_and_keeps_original_profile(self):
        for h in self.request["model"]["likelihoods"]:
            self.request["model"]["likelihoods"][h] = {"clarification": 0, "attempt": 1}
        result = self.update()
        self.assertEqual(result["reason"], "zero_probability_evidence")
        self.assertEqual(result["evidence_probability"], 0)
        self.assertEqual(result["posterior_profile"], self.request["profile"])
        self.assertEqual(result["observation"], self.request["observation"])

    def test_missing_answer_or_observation_never_becomes_evidence(self):
        self.request["observation"]["value"] = None
        result = self.update()
        self.assertEqual(result["reason"], "missing_answer")
        self.assertEqual(result["posterior_profile"], self.request["profile"])
        self.request["observation"] = None
        result = self.update()
        self.assertEqual(result["reason"], "missing_observation")
        self.assertEqual(result["posterior_profile"], self.request["profile"])

    def test_unknown_likelihood_does_not_mean_zero(self):
        self.request["model"]["likelihoods"]["try"]["clarification"] = None
        result = self.update()
        self.assertEqual(result["reason"], "unknown_likelihood")
        self.assertIsNone(result["evidence_probability"])
        self.assertEqual(result["posterior_profile"], self.request["profile"])

    def test_known_observed_column_can_update_but_partial_model_cannot_rank_question(self):
        for row in self.request["model"]["likelihoods"].values():
            row["attempt"] = None
        self.assertEqual(self.update()["status"], "updated")
        result = pi.expected_information_gain(self.request["profile"], self.request["model"])
        self.assertEqual(result["reason"], "unknown_likelihood")
        self.assertIsNone(result["information_gain_nats"])

    def test_tiny_evidence_computed_in_log_space(self):
        result = pi.bayes_weights({"a": .6, "b": .4}, {"a": 1e-300, "b": 1e-300})
        self.assertEqual(result["status"], "updated")
        self.assertAlmostEqual(result["weights"]["a"], .6)
        self.assertAlmostEqual(result["log_evidence_probability"], math.log(1e-300))

    def test_positive_mass_below_float_resolution_is_not_silently_pruned(self):
        result = pi.bayes_weights({"a": 5e-324, "b": 1.0}, {"a": 5e-324, "b": 1.0})
        self.assertEqual(result["reason"], "numerical_resolution")
        self.assertIsNone(result["weights"])
        self.assertEqual(result["dropped_hypotheses"], [])

    def test_unit_evidence_roundoff_has_bounded_probability_and_normalized_posterior(self):
        prior = {"a": .39439511895781065, "b": .6056048810421895}
        result = pi.bayes_weights(prior, {"a": 1., "b": 1.})
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["evidence_probability"], 1.)
        self.assertEqual(result["log_evidence_probability"], 0.)
        self.assertEqual(math.fsum(result["weights"].values()), 1.)
        self.assertEqual(ume.normalized_weights(result["weights"]), result["weights"])

    def test_constant_likelihood_preserves_evidence_at_endpoints_and_subnormal_scale(self):
        prior = {str(i): .25 for i in range(4)}
        for probability in (0., 5e-324, 1e-300, .25, math.nextafter(1., 0.), 1.):
            with self.subTest(probability=probability):
                result = pi.bayes_weights(prior, dict.fromkeys(prior, probability))
                self.assertEqual(result["evidence_probability"], probability)
                if probability == 0:
                    self.assertEqual(result["reason"], "zero_probability_evidence")
                    self.assertIsNone(result["weights"])
                else:
                    self.assertEqual(result["status"], "updated")
                    self.assertEqual(result["weights"], prior)
                    self.assertEqual(result["log_evidence_probability"], math.log(probability))

    def test_prior_roundoff_is_normalized_without_mutating_inputs(self):
        for offset in (-5e-10, 5e-10):
            with self.subTest(offset=offset):
                prior = {"a": .6 + offset, "b": .4}
                likelihoods = {"a": .8, "b": .2}
                before = deepcopy((prior, likelihoods))
                result = pi.bayes_weights(prior, likelihoods)
                canonical = ume.normalized_weights(prior)
                expected_evidence = canonical["a"] * .8 + canonical["b"] * .2
                self.assertAlmostEqual(result["evidence_probability"], expected_evidence, places=15)
                self.assertAlmostEqual(result["weights"]["a"], canonical["a"] * .8 / expected_evidence, places=15)
                self.assertEqual(math.fsum(result["weights"].values()), 1.)
                self.assertEqual(ume.normalized_weights(result["weights"]), result["weights"])
                self.assertEqual((prior, likelihoods), before)

    def test_matched_hypothesis_permutations_do_not_change_bayes_result(self):
        rows = [("a", .6 + 5e-10, .8), ("b", .3, 1e-300), ("c", .1, 0.)]
        expected = pi.bayes_weights({h: w for h, w, _ in rows}, {h: p for h, _, p in rows})
        self.assertEqual(expected["dropped_hypotheses"], ["c"])
        for ordered in permutations(rows):
            prior = {h: w for h, w, _ in ordered}
            for likelihood_order in permutations(rows):
                likelihoods = {h: p for h, _, p in likelihood_order}
                self.assertEqual(pi.bayes_weights(prior, likelihoods), expected)

    def test_complete_likelihood_rows_use_canonical_weights_and_preserve_zero(self):
        model = self.request["model"]
        model["outcomes"].append("impossible")
        model["likelihoods"] = {
            "ask": {"clarification": .6 + 5e-10, "attempt": .4, "impossible": 0.},
            "try": {"clarification": .2, "attempt": .8 - 5e-10, "impossible": 0.}}
        before = deepcopy(model)
        table = pi.likelihood_model(self.request["profile"], model)
        for h, row in table.items():
            self.assertEqual(math.fsum(row.values()), 1.)
            self.assertEqual(row["impossible"], 0.)
            self.assertEqual({k: p for k, p in row.items() if p > 0},
                             ume.normalized_weights({k: p for k, p in model["likelihoods"][h].items() if p > 0}))
        self.assertEqual(model, before)

    def test_matched_model_row_permutation_preserves_update_and_information(self):
        original_update = self.update()
        original_info = pi.expected_information_gain(self.request["profile"], self.request["model"])
        model = self.request["model"]
        model["likelihoods"] = {h: dict(reversed(list(row.items())))
                                for h, row in reversed(list(model["likelihoods"].items()))}
        reordered_update = self.update()
        self.assertEqual(reordered_update, original_update)
        self.assertEqual(pi.expected_information_gain(self.request["profile"], model), original_info)
        model["outcomes"].reverse()
        reordered_info = pi.expected_information_gain(self.request["profile"], model)
        # Array order remains source provenance, while the keyed arithmetic is invariant.
        for key in ("branches", "information_gain_nats", "expected_posterior_entropy_nats"):
            self.assertEqual(reordered_info[key], original_info[key])

    def test_invalid_probability_near_boundary_is_rejected_before_normalizing(self):
        for value in (math.nextafter(1., math.inf), math.nextafter(0., -math.inf)):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "Finite number"):
                    pi.bayes_weights({"a": .6, "b": .4}, {"a": value, "b": 1.})
                model = deepcopy(self.request["model"])
                model["likelihoods"]["ask"] = {"clarification": value, "attempt": 0. if value > 1 else 1.}
                with self.assertRaisesRegex(ValueError, "Finite number"):
                    pi.likelihood_model(self.request["profile"], model)

    def test_one_realization_may_increase_entropy(self):
        before = {"a": .9, "b": .1}
        result = pi.bayes_weights(before, {"a": .1, "b": .9})
        self.assertGreater(pi.entropy(result["weights"]), pi.entropy(before))

    def test_invalid_prior_and_likelihoods_fail(self):
        for prior in ({"a": .2, "b": .2}, {"a": 0, "b": 1}, {"a": True}):
            with self.subTest(prior=prior), self.assertRaises(ValueError):
                pi.bayes_weights(prior, {key: .5 for key in prior})
        for value in (True, -.1, 1.1, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                pi.bayes_weights({"a": 1}, {"a": value})
        with self.assertRaisesRegex(ValueError, "One likelihood"):
            pi.bayes_weights({"a": .5, "b": .5}, {"a": .5})

    def test_likelihood_complete_support_and_mass_required(self):
        for variant in ("mass", "partial_mass", "outcome", "hypothesis", "duplicate_outcome"):
            model = deepcopy(self.request["model"])
            if variant == "mass":
                model["likelihoods"]["ask"]["attempt"] = .1
            elif variant == "partial_mass":
                model["outcomes"].append("unknown-to-model")
                for row in model["likelihoods"].values():
                    row["unknown-to-model"] = None
                model["likelihoods"]["ask"]["attempt"] = .5
            elif variant == "outcome":
                del model["likelihoods"]["ask"]["attempt"]
            elif variant == "hypothesis":
                del model["likelihoods"]["ask"]
            else:
                model["outcomes"].append("attempt")
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                pi.expected_information_gain(self.request["profile"], model)

    def test_profile_revalidation_rejects_resealed_but_false_observation(self):
        profile = self.request["profile"]
        profile["hypotheses"][0]["traits"]["preferred_format"]["value"] = "long"
        profile["profile_sha256"] = ume.fingerprint({k: v for k, v in profile.items() if k not in {"profile_sha256", "entropy_nats"}})
        with self.assertRaisesRegex(ValueError, "contradicts"):
            pi.admitted_profile(profile)

    def test_profile_hash_and_derived_entropy_are_both_checked(self):
        for key, value in (("profile_sha256", "invalid"), ("entropy_nats", 100)):
            profile = deepcopy(self.request["profile"])
            profile[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                pi.admitted_profile(profile)

    def test_model_requires_exact_person_and_current_conditioning_profile(self):
        for key in ("person_id", "profile_sha256"):
            model = deepcopy(self.request["model"])
            model[key] = "other"
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "changed person"):
                pi.update_profile(self.request["profile"], model, self.request["observation"])

    def test_invalid_likelihood_provenance_fails(self):
        self.request["model"]["provenance"] = {"kind": "observed", "source": "unsupported claim"}
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.update()

    def test_answer_cannot_cross_person_question_or_origin(self):
        for key, value in (("person_id", "other"), ("question_id", "other"),
                           ("provenance", {"kind": "simulated", "source": "model reply"})):
            observation = deepcopy(self.request["observation"])
            observation[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                pi.update_profile(self.request["profile"], self.request["model"], observation)

    def test_answer_identity_and_categorical_support_are_explicit(self):
        for key, value in (("source_answer_ids", []), ("value", "undeclared outcome"), ("value", True)):
            observation = deepcopy(self.request["observation"])
            observation[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                pi.update_profile(self.request["profile"], self.request["model"], observation)

    def test_protected_answer_and_derived_lineage_rejected(self):
        self.request["observation"]["source_answer_ids"].append("protected-ancestor")
        self.request["forbidden_answer_ids"] = ["protected-ancestor"]
        with self.assertRaisesRegex(ValueError, "Protected held-out"):
            self.update()
        self.request["forbidden_answer_ids"] = ["fixture-ada-initial-answer"]
        with self.assertRaisesRegex(ValueError, "Held-out answer leaked"):
            self.update()

    def test_reused_answer_lineage_cannot_be_counted_twice(self):
        result = self.update()
        self.request["profile"] = result["posterior_profile"]
        self.request["model"]["profile_sha256"] = result["posterior_profile"]["profile_sha256"]
        with self.assertRaisesRegex(ValueError, "already conditioned"):
            self.update()

    def test_same_question_is_not_independent_new_evidence(self):
        result = self.update()
        self.request["profile"] = result["posterior_profile"]
        self.request["model"]["profile_sha256"] = result["posterior_profile"]["profile_sha256"]
        self.request["observation"].update(id="another-answer", source_answer_ids=["another-answer"])
        with self.assertRaisesRegex(ValueError, "Question already recorded"):
            self.update()
        info = pi.expected_information_gain(self.request["profile"], self.request["model"])
        self.assertEqual(info["reason"], "question_already_recorded")

    def test_posterior_is_compatible_with_next_conditional_update(self):
        result = self.update()
        self.request["profile"] = result["posterior_profile"]
        self.request["model"].update(profile_sha256=result["posterior_profile"]["profile_sha256"],
                                     question_id="fresh-occasion", revision="authored-new-conditional-model")
        self.request["observation"].update(id="second-answer", source_answer_ids=["second-answer"], question_id="fresh-occasion")
        next_result = self.update()
        self.assertEqual(next_result["status"], "updated")
        self.assertEqual(len(next_result["posterior_profile"]["evidence"]), 3)
        self.assertEqual(next_result["parent_profile_sha256"], result["posterior_profile"]["profile_sha256"])

    def test_eig_agrees_with_analytic_entropy_difference(self):
        info = pi.expected_information_gain(self.request["profile"], self.request["model"])
        h_answer = -.56 * math.log(.56) - .44 * math.log(.44)
        h_conditional = -.8 * math.log(.8) - .2 * math.log(.2)
        self.assertAlmostEqual(info["information_gain_nats"], h_answer - h_conditional)
        self.assertAlmostEqual(math.fsum(b["probability"] for b in info["branches"]), 1)
        self.assertTrue(info["counterfactual"])

    def test_perfect_question_reveals_prior_entropy(self):
        self.request["model"]["likelihoods"] = {"ask": {"clarification": 1, "attempt": 0},
                                                 "try": {"clarification": 0, "attempt": 1}}
        info = pi.expected_information_gain(self.request["profile"], self.request["model"])
        self.assertAlmostEqual(info["information_gain_nats"], info["prior_entropy_nats"])
        self.assertEqual(info["expected_posterior_entropy_nats"], 0)

    def test_impossible_branch_contributes_zero_without_fabricated_posterior(self):
        for row in self.request["model"]["likelihoods"].values():
            row.update(clarification=0, attempt=1)
        info = pi.expected_information_gain(self.request["profile"], self.request["model"])
        impossible = next(b for b in info["branches"] if b["outcome"] == "clarification")
        self.assertEqual(impossible["probability"], 0)
        self.assertIsNone(impossible["posterior_weights"])
        self.assertAlmostEqual(info["information_gain_nats"], 0)

    def test_question_score_uses_declared_utility_and_cost_conversion(self):
        result = self.select()
        self.assertFalse(result["executes"])
        self.assertEqual(result["selected_question_id"], "help-choice")
        self.assertAlmostEqual(result["baseline_decision"]["expected_utility"], .6)
        question = next(q for q in result["questions"] if q["question_id"] == "help-choice")
        self.assertAlmostEqual(question["expected_utility_after"], .8)
        self.assertAlmostEqual(question["expected_utility_gain"], .2)
        self.assertAlmostEqual(question["net_score"], .2 + .1 * question["information"]["information_gain_nats"] - .02)
        decisions = {b["decision"]["action_id"] for b in question["information"]["branches"]}
        self.assertEqual(decisions, {"explain", "offer_attempt"})

    def test_information_without_decision_value_does_not_justify_collection(self):
        self.selection["decision"]["actions"] = {"same_action": {"ask": .7, "try": .7}}
        result = self.select()
        self.assertEqual(result["status"], "abstained")
        question = next(q for q in result["questions"] if q["question_id"] == "help-choice")
        self.assertGreater(question["information"]["information_gain_nats"], 0)
        self.assertEqual(question["reason"], "no_decision_value")

    def test_cost_and_minimum_gain_can_choose_no_question(self):
        self.selection["questions"][0]["cost"]["amount"] = 100
        result = self.select()
        self.assertIsNone(result["selected_question_id"])
        self.assertEqual(result["questions"][0]["reason"], "cost_exceeds_value")
        self.selection["questions"][0]["cost"]["amount"] = 0
        self.selection["policy"]["minimum_expected_utility_gain"] = .3
        self.assertEqual(self.select()["questions"][0]["reason"], "no_decision_value")

    def test_unknown_question_not_ranked_as_if_known(self):
        self.selection["questions"][0]["model"]["likelihoods"]["ask"]["attempt"] = None
        result = self.select()
        question = next(q for q in result["questions"] if q["question_id"] == "help-choice")
        self.assertEqual(question["reason"], "unknown_likelihood")
        self.assertIsNone(question["net_score"])
        self.assertIsNone(result["selected_question_id"])

    def test_decision_requires_complete_utilities_and_matching_snapshot(self):
        for field, value in (("actions", {"a": {"ask": None, "try": .5}}),
                             ("actions", {"a": {"ask": .5}}), ("profile_sha256", "wrong"), ("person_id", "wrong")):
            decision = deepcopy(self.selection["decision"])
            decision[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                pi.select_question(self.selection["profile"], self.selection["questions"], decision, self.selection["policy"])

    def test_mixed_cost_units_and_invalid_conversions_rejected(self):
        self.selection["questions"][0]["cost"]["unit"] = "USD"
        with self.assertRaisesRegex(ValueError, "cost units differ"):
            self.select()
        self.selection = pi.authored_fixture()["selection"]
        self.selection["policy"]["utility_unit"] = "another-score"
        with self.assertRaisesRegex(ValueError, "utility units differ"):
            self.select()
        for value in (None, -1, True, float("nan"), float("inf")):
            selection = pi.authored_fixture()["selection"]
            selection["policy"]["utility_per_cost_unit"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                pi.select_question(**selection)

    def test_ties_are_stable_and_input_order_does_not_change_selection(self):
        duplicate = deepcopy(self.selection["questions"][0])
        duplicate["model"]["question_id"] = "a-tied-question"
        self.selection["questions"].append(duplicate)
        forward = self.select()
        self.selection["questions"].reverse()
        reverse = self.select()
        self.assertEqual(forward["selected_question_id"], "a-tied-question")
        self.assertEqual(reverse["selected_question_id"], forward["selected_question_id"])
        self.assertEqual(forward["questions"], reverse["questions"])

    def test_duplicate_questions_rejected_and_empty_candidates_abstain(self):
        self.selection["questions"].append(deepcopy(self.selection["questions"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate candidate"):
            self.select()
        self.selection["questions"] = []
        self.assertEqual(self.select()["status"], "abstained")

    def test_selection_is_counterfactual_and_does_not_mutate_or_create_evidence(self):
        before = deepcopy(self.selection)
        result = self.select()
        self.assertEqual(self.selection, before)
        self.assertNotIn("posterior_profile", result)
        self.assertNotIn("observation", result)
        self.assertEqual(self.selection["profile"]["evidence"], before["profile"]["evidence"])

    def test_cli_roundtrips_local_authored_json_and_invalid_input_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "authored.json"
            for command, payload, expected in (("update", self.request, self.update()),
                                                ("select", self.selection, self.select())):
                path.write_text(json.dumps(payload))
                proc = subprocess.run([sys.executable, pi.__file__, command, str(path)], capture_output=True, text=True)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(json.loads(proc.stdout), expected)
            path.write_text("{}")
            proc = subprocess.run([sys.executable, pi.__file__, "update", str(path)], capture_output=True, text=True)
            self.assertNotEqual(proc.returncode, 0)
            demo = subprocess.run([sys.executable, pi.__file__, "demo"], capture_output=True, text=True)
            self.assertEqual(demo.returncode, 0, demo.stderr)
            self.assertIn("AUTHORED FIXTURE", json.loads(demo.stdout)["notice"])


if __name__ == "__main__":
    unittest.main()
