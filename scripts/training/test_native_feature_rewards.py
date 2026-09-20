"""Entirely authored evidence and approvals; never model results or live permissions."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import native_feature_rewards as fr
import native_observer as observer
import native_training as nt
import native_tinker_update as update
from observer_core import digest as observer_hash
import test_native_training as fixtures
import test_native_tinker_update as update_fixtures


def fixture_inputs(branch="a", multiple=False):
    """Two chronological actions with unequal completion lengths, mock SDK only."""
    model, tokenizer = update_fixtures.MODEL, update_fixtures.TOKENIZER
    with patch.object(fixtures, "MODEL", model), patch.object(fixtures, "TOKENIZER", tokenizer):
        episode = fixtures.fixture_episode(branch=branch)
        if multiple:
            # Add a genuinely separate authored actor message to the same
            # delivered runtime step, retaining the subsequent message prefix.
            extra = {"role": "assistant", "content": [{"type": "text", "text": "MOCK extra actor segment"}],
                     "model": model["id"], "provider": model["provider"], "stopReason": "stop"}
            for event in episode["ledger"]:
                if event["kind"] == "runtime_step":
                    event["payload"]["messages"].insert(3, deepcopy(extra))
                    if event["payload"]["index"]:
                        event["payload"]["message_start_index"] += 1
            extra_event = deepcopy(next(e for e in episode["ledger"] if e["kind"] == "actor_message"))
            extra_event["payload"] = {"step": 0, "message": extra}
            position = next(i for i, e in enumerate(episode["ledger"]) if e["kind"] == "state_snapshot")
            episode["ledger"].insert(position, extra_event)
            fixtures.reseal_episode(episode)
            template = deepcopy(episode["runtime"]["requests"][0])
            requests = []
            for step in episode["runtime"]["steps"]:
                for index, message in enumerate(step["messages"]):
                    if index >= step["message_start_index"] and message["role"] == "assistant":
                        request = deepcopy(template)
                        request["data"]["index"] = len(requests)
                        request["data"]["context"]["messages"] = deepcopy(step["messages"][:index])
                        requests.append(request)
            episode["runtime"]["requests"] = requests
        episode["measurement"] = episode["runtime"]["measurement"] = "model_episode"
        episode["source"]["dataset"] = "MOCK-authored"
        episode["ledger"][0]["payload"]["source"] = deepcopy(episode["source"])
        fixtures.reseal_episode(episode)
        checked = nt.validate_episode(episode)
        first = fixtures.fixture_capture(episode)
    first["source"]["kind"] = "provider_capture"
    first = nt.seal(first, "capture_hash")
    second = deepcopy(first)
    step = checked.steps[1]
    second.update(checked.ref(step))
    index = len(step["payload"]["messages"]) - 1
    event = next(e for e in episode["ledger"] if e["kind"] == "actor_message" and e["payload"]["step"] == 1)
    request_index = len(episode["runtime"]["requests"]) - 1
    request = episode["runtime"]["requests"][request_index]
    second.update(capture_id="MOCK-second-capture-" + branch, message_index=index,
        message_hash=nt.native_hash(step["payload"]["messages"][index]),
        actor_event_id=event["event_id"], actor_event_hash=event["hash"], request_index=request_index,
        request_hash=nt.native_hash(request), context_hash=nt.native_hash(request["data"]["context"]),
        delivery_event_hash=checked.deliveries[step["event_id"]]["hash"],
        prompt_token_ids=[10, 11, 12, 13], completion_token_ids=[30, 31, 32, 33, 34],
        completion_token_roles=["assistant_text"] * 5, behavior_logprobs=[-0.5] * 5)
    second = nt.seal(second, "capture_hash")
    captures = {"schema_version": 1, "captures": [first, second]}
    features = nt.feature_inputs(checked)
    reviews = []
    for i, capture in enumerate(captures["captures"]):
        feature = next(f for f in features if f["event_id"] == capture["event_id"] and f["boundary"] == "delivered")
        delivery = checked.events[feature["delivery_event_id"]]
        citation = {"event_id": delivery["event_id"], "event_hash": delivery["hash"],
                    "quote": delivery["payload"]["visibleText"]}
        checks = {k: {"verdict": "pass", "reasoning": "MOCK independently authored judgment", "citations": [citation]}
                  for k in ("math_correctness", "evidence_discipline")}
        reviews.append(nt.seal({"schema_version": 1, "review_id": f"MOCK-review-{branch}-{i}", "kind": "segment",
            "capture_hash": capture["capture_hash"], **checked.ref(checked.steps[i]),
            "independent": True, "reviewer": {"kind": "human", "id": "MOCK-reviewer"},
            "reviewed_at": fixtures.STAMP, "rubric_revision": "MOCK-rubric-v1", "boundary": "delivered",
            "evidence_hash": feature["feature_hash"], "latest_allowed_event_id": feature["latest_allowed_event_id"],
            "accepted": True, "feedback": {"checks": checks, "learning_outcome": None}}, "review_hash"))
    reviews = {"schema_version": 1, "reviews": reviews}
    _, _, config, _ = update_fixtures.inputs("ppo")
    config["capture_hashes"] = [c["capture_hash"] for c in captures["captures"]]
    config = nt.seal(config, "config_hash")
    probes, pins = {}, {}
    for head, boundary in fr.HEADS.items():
        manifest = {"evidence": "authored_fixture", "module": "MOCK-layer", "layer": 1, "pooling": "MOCK-phase-mean"}
        feature_card = {"definition": "MOCK " + head, "target": head, "boundary": boundary,
            "observer_manifest_sha256": observer_hash(manifest),
            "permitted_use": "Research classification; not a validated reward"}
        model_record = {"coefficients": [0.1], "intercept": 0, "preprocessing": {"scale": [1]},
                        "calibration_coefficient": 1, "calibration_intercept": 0}
        split = {"MOCK": "Not an actual fitted probe"}
        report = {"schema_version": 1, "evidence": "authored_fixture", "boundary": boundary, "target": head,
            "observer_manifest": manifest, "counts": {"train": 20, "calibration": 10, "test": 10},
            "protocol": {"test_used_for_selection": False}, "split_manifest": split,
            "split_manifest_sha256": observer_hash(split), "baselines": {"sae": {
                "feature_card": feature_card, "model": model_record}}}
        probes[head] = {"report": report, "mode": "sae"}
        pins[head] = {"report_sha256": observer_hash(report), "mode": "sae", "model_sha256": observer_hash(model_record),
                      "feature_card_sha256": observer_hash(feature_card), "observer_manifest_sha256": observer_hash(manifest)}
    card = nt.seal({"schema_version": 1, "purpose": fr.VERSION, "status": "approved_for_feature_reward",
        "frozen": True, "independent": True, "approver": {"kind": "human", "id": "MOCK-approver-not-authorization"},
        "approved_at": "2026-09-12T12:00:00Z", "rubric_revision": "MOCK-rubric-v1", "probe_pins": pins,
        "evaluation": {"artifact_sha256": "e" * 64, "protocol_revision": "MOCK-heldout-evaluation",
            "heldout_family_aliases": ["MOCK-release-holdout"], "gates": {g: True for g in sorted(fr.GATES)}},
        "scope": {"datasets": ["MOCK-authored"], "surfaces": ["interactive"], "actor_model_id": model["id"],
            "learner_model_id": episode["learner_policy"]["model"], "tokenizer": tokenizer,
            "runtime_source_hashes_sha256": nt.native_hash(episode["runtime"]["source_hashes"])},
        "rule": {"gamma": 0.5, "horizon": 2, "excess_penalty": 0.6, "minimum_need_mass": 0.1,
            "failure_reward": -1, "advantage_cap": 3, "baseline": {"kind": "frozen_constant", "value": 0.1, "revision": "MOCK-v1"},
            "assessment_checks": ["math_correctness", "evidence_discipline"], "normalization": fr.NORMALIZATION}}, "card_hash")
    measurements = []
    source = {"dataset": "MOCK-authored", "measurement": episode["measurement"], "episode_hash": nt.native_hash(episode)}
    for i, review in enumerate(reviews["reviews"]):
        probabilities = ([0.8, 0.2, 0.9, 0.1, 0.5] if i == 0 else [0.5, 0.5, 0.6, 0.2, 0.0])
        predictions = {}
        for (head, boundary), probability in zip(fr.HEADS.items(), probabilities):
            feature = next(f for f in features if f["event_id"] == review["event_id"] and f["boundary"] == boundary)
            projected = observer.project_feature(feature, family=episode["family"], source=source)
            predictions[head] = nt.seal({**{k: pins[head][k] for k in
                ("report_sha256", "model_sha256", "observer_manifest_sha256")},
                "native_feature_hash": feature["feature_hash"], "input_sha256": observer_hash(projected),
                "scorer_revision": "MOCK-authored-no-scoring", "probability": probability,
                "abstention_reason": None}, "prediction_hash")
        measurements.append(nt.seal({"schema_version": 1, "episode_hash": nt.native_hash(episode),
            **{k: review[k] for k in update.REF_KEYS}, "review_hash": review["review_hash"],
            "card_hash": card["card_hash"], "predictions": predictions}, "measurement_hash"))
    data = {"episodes": [episode], "captures": captures, "reviews": reviews, "probes": probes,
            "evaluation_card": card, "approved_card_hash": card["card_hash"], "measurements": measurements,
            "update_config": config}
    refresh_manifest(data)
    return data


def refresh_manifest(data):
    bundle = nt.build_exports(data["episodes"], data["captures"], data["reviews"])
    episode = data["episodes"][0]
    data["split_manifest"] = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"],
        "registry_revision": "MOCK-registry", "approved_by": "MOCK-split-reviewer", "episodes": bundle["episodes"],
        "families": [{"family": episode["family"], "split": "train", "protected": False,
            "aliases": [episode["family"], "MOCK-family-alias"], "sources": [{"dataset": "MOCK-authored", "revision": "MOCK-v1",
                "record_id": "MOCK-row", "original_split": "train", "record_sha256": "d" * 64}]}]}, "split_hash")


def approve_fixture(data):
    """Test-only reapproval; production must supply a separately trusted hash."""
    data["evaluation_card"] = nt.seal(data["evaluation_card"], "card_hash")
    data["approved_card_hash"] = data["evaluation_card"]["card_hash"]
    for measurement in data["measurements"]:
        measurement["card_hash"] = data["approved_card_hash"]
        measurement.update(nt.seal(measurement, "measurement_hash"))


def seal_measurement(data, index=0):
    row = data["measurements"][index]
    for p in row["predictions"].values():
        p.update(nt.seal(p, "prediction_hash"))
    row.update(nt.seal(row, "measurement_hash"))


def reseal_review(data, index=0):
    review = data["reviews"]["reviews"][index]
    review.update(nt.seal(review, "review_hash"))
    data["measurements"][index]["review_hash"] = review["review_hash"]
    seal_measurement(data, index)
    refresh_manifest(data)


class FeatureRewardTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture_inputs()

    def run_connection(self):
        return fr.build_feature_signals(**self.data)

    def test_returns_feed_existing_ppo_with_equal_action_means(self):
        before = deepcopy(self.data)
        result = self.run_connection()
        self.assertEqual(before, self.data)
        a, b = result["actions"]
        self.assertAlmostEqual(a["reward"], 0.44)
        self.assertAlmostEqual(a["action_return"], 0.64)
        self.assertAlmostEqual(a["advantage"], 0.54)
        self.assertAlmostEqual(b["advantage"], 0.3)
        plan = update.prepare_update(result["export"], self.data["split_manifest"],
                                     self.data["update_config"], result["signals"])
        self.assertEqual(plan["normalization"], fr.NORMALIZATION)
        for i, row in enumerate(plan["rows"]):
            segment = row["record"]["segment"]
            values = row["signal"]["advantages"]
            self.assertEqual(len(values), 3 if i == 0 else 5)
            self.assertEqual(values, [result["actions"][i]["advantage"]] * len(values))
            datum = update.datum(update_fixtures.SDK, segment, len(plan["rows"]), values)
            weights = datum.loss_fn_inputs["advantages"].data
            self.assertEqual(weights[:len(segment["prompt_token_ids"]) - 1], [0] * (len(segment["prompt_token_ids"]) - 1))
            self.assertAlmostEqual(sum(weights), result["actions"][i]["advantage"] / 2)
            self.assertEqual(row["signal"]["provenance"]["aggregation"], fr.NORMALIZATION)
        self.assertFalse(result["training_executed"])
        self.assertIsNone(result["learning_outcome"])
        self.assertTrue(all(f["outcome"] is None for f in result["export"]["observer_inputs"]))

    def test_fixed_card_cannot_be_replaced_by_a_self_resealed_rule(self):
        self.data["evaluation_card"]["rule"]["gamma"] = 1
        self.data["evaluation_card"] = nt.seal(self.data["evaluation_card"], "card_hash")
        with self.assertRaisesRegex(fr.FeatureRewardError, "approved_card_pin"):
            self.run_connection()

    def test_classification_card_does_not_authorize_rewards(self):
        self.data["evaluation_card"]["status"] = "classification_only"
        approve_fixture(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "reward_use_approval"):
            self.run_connection()

    def test_independent_model_approval_does_not_require_a_human_gate(self):
        self.data["evaluation_card"]["approver"] = {"kind": "independent_model", "id": "MOCK-evaluator",
            "model": {"provider": "MOCK", "id": "separate-reward-evaluator", "revision": "MOCK-frozen-v1"}}
        approve_fixture(self.data)
        self.assertEqual(len(self.run_connection()["signals"]["signals"]), 2)

    def test_actor_or_learner_cannot_approve_its_own_reward_card(self):
        for name in ("qwen3.5-9b-base", "provider/AUTHORED-LEARNER"):
            self.data["evaluation_card"]["approver"] = {"kind": "independent_model", "id": "MOCK-evaluator",
                "model": {"provider": "MOCK", "id": name, "revision": "MOCK-v1"}}
            approve_fixture(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "approval_self_review_alias"):
                self.run_connection()

    def test_no_default_approval_or_model_drift(self):
        for mutation, code in ((lambda d: d.update(approved_card_hash=None), "approved_card_pin"),
            (lambda d: d["probes"]["need_rigor"]["report"]["baselines"]["sae"]["model"].update(intercept=99), "probe_report_pin")):
            self.data = fixture_inputs()
            mutation(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, code):
                self.run_connection()

    def test_approval_must_precede_episode(self):
        self.data["evaluation_card"]["approved_at"] = "2026-09-14T00:00:00Z"
        approve_fixture(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "approval_after_episode"):
            self.run_connection()

    def test_fixed_scope_checks_surface_dataset_actor_and_runtime(self):
        for field, value, code in (("surfaces", ["chat"], "approved_surface_scope"),
                ("datasets", ["unrelated"], "approved_episode_scope"),
                ("actor_model_id", "other-actor", "approved_actor_scope"),
                ("runtime_source_hashes_sha256", "0" * 64, "approved_episode_scope")):
            self.data = fixture_inputs()
            self.data["evaluation_card"]["scope"][field] = value
            approve_fixture(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, code):
                self.run_connection()

    def test_holdout_aliases_and_protected_families_reject(self):
        self.data["evaluation_card"]["evaluation"]["heldout_family_aliases"] = ["MOCK-family-alias"]
        approve_fixture(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "evaluation_family_leakage"):
            self.run_connection()
        self.data = fixture_inputs()
        self.data["split_manifest"]["families"][0]["protected"] = True
        self.data["split_manifest"] = nt.seal(self.data["split_manifest"], "split_hash")
        with self.assertRaisesRegex(update.UpdateError, "protected_family"):
            self.run_connection()

    def test_failed_or_unknown_eval_gate_rejects_even_after_reapproval(self):
        for value in (False, None, 1, "true"):
            self.data["evaluation_card"]["evaluation"]["gates"]["calibration"] = value
            approve_fixture(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "evaluation_gates_required"):
                self.run_connection()

    def test_resealed_future_prediction_is_rejected(self):
        features = nt.feature_inputs(nt.validate_episode(self.data["episodes"][0]))
        future = next(f for f in features if f["boundary"] == "retrospective")
        self.data["measurements"][0]["predictions"]["need_rigor"]["native_feature_hash"] = future["feature_hash"]
        seal_measurement(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "prediction_probe_or_causal_pin"):
            self.run_connection()

    def test_resealed_foreign_action_prediction_is_rejected(self):
        self.data["measurements"][0]["predictions"]["action_rigor"] = deepcopy(
            self.data["measurements"][1]["predictions"]["action_rigor"])
        seal_measurement(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "prediction_probe_or_causal_pin"):
            self.run_connection()

    def test_cross_branch_measurement_rejected(self):
        self.data["measurements"][0]["branch_id"] = "other-branch"
        seal_measurement(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "measurement_cross_branch_or_duplicate"):
            self.run_connection()

    def test_duplicate_measurement_rejected(self):
        self.data["measurements"].append(deepcopy(self.data["measurements"][0]))
        with self.assertRaisesRegex(fr.FeatureRewardError, "measurement_cross_branch_or_duplicate"):
            self.run_connection()

    def test_changed_projection_and_observer_rejected(self):
        for field, code in (("input_sha256", "prediction_input_pin"), ("observer_manifest_sha256", "prediction_probe_or_causal_pin")):
            self.data = fixture_inputs()
            self.data["measurements"][0]["predictions"]["need_scaffolding"][field] = "0" * 64
            seal_measurement(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, code):
                self.run_connection()

    def test_stale_review_pin_is_rejected(self):
        self.data["reviews"]["reviews"][0]["feedback"]["checks"]["math_correctness"]["reasoning"] = "Changed judgment"
        self.data["reviews"]["reviews"][0] = nt.seal(self.data["reviews"]["reviews"][0], "review_hash")
        refresh_manifest(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "measurement_review_pin"):
            self.run_connection()

    def test_future_review_citation_and_changed_quote_rejected(self):
        for future in (True, False):
            self.data = fixture_inputs()
            citation = self.data["reviews"]["reviews"][0]["feedback"]["checks"]["math_correctness"]["citations"][0]
            if future:
                citation.update(self.data["reviews"]["reviews"][1]["feedback"]["checks"]["math_correctness"]["citations"][0])
            else:
                citation["quote"] = "NEVER DELIVERED"
            reseal_review(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "assessment_cross_branch_or_future" if future else "assessment_quote_binding"):
                self.run_connection()

    def test_receipt_is_not_a_pedagogical_assessment(self):
        self.data["reviews"]["reviews"][0]["feedback"] = {"delivery_status": "completed", "learning_outcome": None}
        reseal_review(self.data)
        result = self.run_connection()
        self.assertEqual(result["actions"][0]["reward_abstention"], "unknown_assessment")
        self.assertIsNone(result["actions"][0]["reward"])
        self.assertEqual(len(result["signals"]["signals"]), 1)

    def test_unknown_need_is_not_negative_or_zero(self):
        p = self.data["measurements"][1]["predictions"]["need_rigor"]
        p.update(probability=None, abstention_reason="Insufficient calibrated evidence")
        seal_measurement(self.data, 1)
        result = self.run_connection()
        self.assertEqual(result["actions"][1]["reward_abstention"], "unknown_need")
        self.assertTrue(all(a["action_return"] is None for a in result["actions"]))
        self.assertEqual(result["signals"]["signals"], [])
        with self.assertRaisesRegex(update.UpdateError, "signal"):
            update.prepare_update(result["export"], self.data["split_manifest"], self.data["update_config"], result["signals"])

    def test_zero_need_mass_abstains(self):
        for head in ("need_rigor", "need_scaffolding"):
            self.data["measurements"][0]["predictions"][head]["probability"] = 0
        seal_measurement(self.data)
        self.assertEqual(self.run_connection()["actions"][0]["reward_abstention"], "insufficient_need_mass")

    def test_unknown_assessment_abstains_before_failure_penalty(self):
        checks = self.data["reviews"]["reviews"][0]["feedback"]["checks"]
        checks["math_correctness"]["verdict"] = "unknown"
        checks["evidence_discipline"]["verdict"] = "fail"
        self.data["reviews"]["reviews"][0]["accepted"] = False
        reseal_review(self.data)
        self.assertEqual(self.run_connection()["actions"][0]["reward_abstention"], "unknown_assessment")

    def test_additional_unknown_review_check_still_abstains(self):
        checks = self.data["reviews"]["reviews"][0]["feedback"]["checks"]
        checks["artifact_quality"] = {"verdict": "unknown", "reasoning": "Not yet assessed", "citations": []}
        reseal_review(self.data)
        self.assertEqual(self.run_connection()["actions"][0]["reward_abstention"], "unknown_assessment")

    def test_actor_or_learner_alias_is_not_an_independent_reviewer(self):
        for name in ("qwen3.5-9b-base", "provider/AUTHORED-LEARNER"):
            self.data = fixture_inputs()
            self.data["reviews"]["reviews"][0]["reviewer"] = {"kind": "independent_model", "id": "MOCK-self-review",
                "model": {"provider": "MOCK", "id": name, "revision": "MOCK-v1"}}
            reseal_review(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "assessment_self_review_alias"):
                self.run_connection()

    def test_prior_learner_message_is_valid_review_context_not_an_outcome(self):
        episode = self.data["episodes"][0]
        prior = next(e for e in episode["ledger"] if e["kind"] == "learner_intent")
        self.data["reviews"]["reviews"][1]["feedback"]["checks"]["math_correctness"]["citations"].append({
            "event_id": prior["event_id"], "event_hash": prior["hash"], "quote": prior["payload"]["intent"]["text"]})
        reseal_review(self.data, 1)
        result = self.run_connection()
        self.assertEqual(len(result["signals"]["signals"]), 2)
        self.assertIsNone(result["learning_outcome"])

    def test_rejected_incorrect_action_uses_declared_failure_penalty(self):
        review = self.data["reviews"]["reviews"][0]
        review["accepted"] = False
        review["feedback"]["checks"]["math_correctness"]["verdict"] = "fail"
        reseal_review(self.data)
        result = self.run_connection()
        self.assertEqual(result["actions"][0]["reward"], -1)
        self.assertAlmostEqual(result["actions"][0]["advantage"], -0.9)
        plan = update.prepare_update(result["export"], self.data["split_manifest"], self.data["update_config"], result["signals"])
        self.assertEqual(plan["rows"][0]["signal"]["review_decision"], "rejected")

    def test_review_disagreement_never_flips_advantage_to_force_acceptance(self):
        review = self.data["reviews"]["reviews"][0]
        review["accepted"] = False
        review["feedback"]["checks"]["agency"] = deepcopy(review["feedback"]["checks"]["math_correctness"])
        review["feedback"]["checks"]["agency"]["verdict"] = "fail"
        reseal_review(self.data)
        action = self.run_connection()["actions"][0]
        self.assertGreater(action["action_return"], 0)
        self.assertIsNone(action["advantage"])
        self.assertEqual(action["signal_abstention"], "rejected_action_requires_negative_advantage")

    def test_accepted_review_with_failed_check_rejects(self):
        self.data["reviews"]["reviews"][0]["feedback"]["checks"]["math_correctness"]["verdict"] = "fail"
        reseal_review(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "assessment_review_decision_conflict"):
            self.run_connection()

    def test_unknown_missing_records_preserve_timeline(self):
        self.data["measurements"].pop(1)
        result = self.run_connection()
        self.assertEqual(len(result["actions"]), 2)
        self.assertEqual(result["actions"][1]["reward_abstention"], "missing_measurement")
        self.assertIsNone(result["actions"][0]["action_return"])

    def test_measurement_input_order_does_not_change_action_order(self):
        expected = self.run_connection()
        self.data["measurements"].reverse()
        self.assertEqual(expected, self.run_connection())

    def test_branch_returns_never_include_sibling_actions(self):
        other = fixture_inputs("b")
        for i, measurement in enumerate(other["measurements"]):
            for head in ("action_scaffolding", "action_rigor"):
                measurement["predictions"][head]["probability"] = 0
            seal_measurement(other, i)
        for name in ("episodes", "measurements"):
            self.data[name].extend(other[name])
        for name in ("captures", "reviews"):
            self.data[name][name].extend(other[name][name])
        self.data["update_config"]["capture_hashes"].extend(other["update_config"]["capture_hashes"])
        self.data["update_config"] = nt.seal(self.data["update_config"], "config_hash")
        refresh_manifest(self.data)
        result = self.run_connection()
        first = [a for a in result["actions"] if a["branch_id"] == "a"]
        second = [a for a in result["actions"] if a["branch_id"] == "b"]
        self.assertAlmostEqual(first[0]["action_return"], 0.64)
        self.assertAlmostEqual(second[0]["action_return"], -0.3)
        for signal in result["signals"]["signals"]:
            evidence = signal["advantage_provenance"]["return_evidence"]
            self.assertTrue(all(e["branch_id"] == signal["review"]["branch_id"] for e in evidence))

    def test_unknown_unselected_future_still_blocks_selected_return(self):
        self.data["update_config"]["capture_hashes"] = self.data["update_config"]["capture_hashes"][:1]
        self.data["update_config"] = nt.seal(self.data["update_config"], "config_hash")
        self.data["measurements"].pop(1)
        result = self.run_connection()
        self.assertEqual(result["signals"]["signals"], [])
        self.assertEqual(len(result["actions"]), 2)

    def test_missing_review_abstains_without_dropping_action_from_horizon(self):
        self.data["reviews"]["reviews"].pop(1)
        self.data["measurements"].pop(1)
        refresh_manifest(self.data)
        result = self.run_connection()
        self.assertEqual(result["actions"][1]["reward_abstention"], "missing_independent_review")
        self.assertIsNone(result["actions"][0]["action_return"])

    def test_multiple_actor_segments_do_not_duplicate_one_delivery_reward(self):
        self.data = fixture_inputs(multiple=True)
        result = self.run_connection()
        self.assertEqual(result["actions"][0]["reward_abstention"], "multiple_actor_segments_in_delivery")
        self.assertIsNone(result["actions"][0]["reward"])
        self.assertEqual(len(result["signals"]["signals"]), 1)

    def test_selected_hosted_catalog_weights_cannot_enter_training(self):
        self.data["update_config"]["model"]["revision"] = "hostedrevisionunattested"
        self.data["update_config"] = nt.seal(self.data["update_config"], "config_hash")
        with self.assertRaisesRegex(update.UpdateError, "immutable_initial_training_checkpoint_required"):
            self.run_connection()

    def test_gamma_zero_uses_known_prefix_without_unknown_future(self):
        self.data["evaluation_card"]["rule"]["gamma"] = 0
        approve_fixture(self.data)
        self.data["measurements"].pop(1)
        result = self.run_connection()
        self.assertAlmostEqual(result["actions"][0]["action_return"], 0.44)
        self.assertEqual(len(result["signals"]["signals"]), 1)

    def test_advantage_clipping_does_not_modify_raw_reward(self):
        self.data["evaluation_card"]["rule"]["advantage_cap"] = 0.25
        approve_fixture(self.data)
        action = self.run_connection()["actions"][0]
        self.assertAlmostEqual(action["reward"], 0.44)
        self.assertAlmostEqual(action["action_return"], 0.64)
        self.assertEqual(action["advantage"], 0.25)

    def test_fixed_baseline_and_numeric_bounds(self):
        for field, value in (("gamma", True), ("horizon", 0), ("horizon", 13), ("excess_penalty", -1),
                             ("advantage_cap", 0), ("minimum_need_mass", 0), ("normalization", "token_sum")):
            self.data = fixture_inputs()
            self.data["evaluation_card"]["rule"][field] = value
            approve_fixture(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "bounded_reward_rule"):
                self.run_connection()
        self.data = fixture_inputs()
        self.data["evaluation_card"]["rule"]["baseline"]["kind"] = "retrospective_estimator"
        approve_fixture(self.data)
        with self.assertRaisesRegex(fr.FeatureRewardError, "prefix_only_constant"):
            self.run_connection()

    def test_invalid_prediction_never_becomes_abstention(self):
        for value in (True, 1.01, -0.1, "0.5"):
            self.data = fixture_inputs()
            self.data["measurements"][0]["predictions"]["need_rigor"]["probability"] = value
            seal_measurement(self.data)
            with self.assertRaisesRegex(fr.FeatureRewardError, "probability_or_abstention"):
                self.run_connection()

    def test_import_needs_no_provider_or_scientific_packages(self):
        directory = Path(__file__).resolve().parent
        command = [sys.executable, "-S", "-c",
            "import sys; sys.path.insert(0, sys.argv[1]); import native_feature_rewards; "
            "assert not {'torch','numpy','tinker','httpx','requests','sklearn'} & set(sys.modules)", str(directory)]
        subprocess.run(command, check=True, capture_output=True)


class DiscountedReturnsTests(unittest.TestCase):
    def test_known_finite_horizon_and_terminal_tail(self):
        values = fr.discounted_action_returns([1, 0.5, -1], gamma=0.5, horizon=2, terminal=True)
        self.assertEqual([v["value"] for v in values], [1.25, 0, -1])

    def test_failed_tail_stays_unknown_but_complete_prefix_can_be_used(self):
        values = fr.discounted_action_returns([1, -1], gamma=1, horizon=2, terminal=False)
        self.assertEqual(values[0]["value"], 0)
        self.assertIsNone(values[1]["value"])
        self.assertEqual(values[1]["reason"], "unobserved_tail")

    def test_unknowns_propagate_only_through_declared_horizon(self):
        values = fr.discounted_action_returns([1, None, 1], gamma=0.5, horizon=2, terminal=True)
        self.assertEqual([v["value"] for v in values], [None, None, 1])
        values = fr.discounted_action_returns([1, None], gamma=0, horizon=12, terminal=False)
        self.assertEqual([v["value"] for v in values], [1, None])

    def test_nonfinite_and_wrong_types_rejected(self):
        for rewards in ([float("nan")], [float("inf")], [True], [], [0] * 13):
            with self.assertRaises(fr.FeatureRewardError):
                fr.discounted_action_returns(rewards, gamma=1, horizon=1, terminal=True)


if __name__ == "__main__":
    unittest.main()
