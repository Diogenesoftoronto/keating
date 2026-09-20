"""Authored fixtures only: no real approvals, extraction, provider or training."""
from copy import deepcopy
import hashlib
import json
import math
import unittest
from unittest.mock import patch

import native_feature_rewards_v2 as v2
import native_training as nt
import native_custom_update as custom
import native_observer as observer
from observer_core import TEMPLATE, boundary_view, digest
import test_native_custom_update as cf
import test_native_hindsight as hf


def inputs():
    original = hf.fixtures.fixture_episode
    request = "Please give only a hint. My work is 2+3=5."
    def episode(*args, **kwargs):
        value = json.loads(json.dumps(original(*args, **kwargs)).replace("INITIAL_LEARNER", request))
        hf.fixtures.reseal_episode(value)
        return value
    with patch.object(hf.fixtures, "fixture_episode", episode):
        raw = cf.inputs()
    ep, capture, review = raw[0][0], raw[1]["captures"][0], raw[2]["reviews"][0]
    owner = nt.validate_episode(ep)
    feature = next(f for f in nt.feature_inputs(owner) if f["event_id"] == capture["event_id"] and f["boundary"] == "delivered")
    delivery = owner.events[feature["delivery_event_id"]]
    review["feedback"]["checks"] = {"math_correctness": {"verdict": "pass", "reasoning": "AUTHORED independent check",
        "citations": [{"event_id": delivery["event_id"], "event_hash": delivery["hash"], "quote": delivery["payload"]["visibleText"]}]}}
    review.update(nt.seal(review, "review_hash"))
    raw[3] = hf.manifest_for(nt.build_exports(*raw[:3]))
    manifest = {"schema_version": 1, "evidence": "model_extraction", "dimensions": {"hidden": 4096, "width": 65536, "top_k": 50},
        "observer_model": "Qwen/Qwen3.5-9B-Base", "tokenizer_model": "Qwen/Qwen3.5-9B-Base",
        "sae_model": "Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50", "observer_revision": "1" * 40,
        "tokenizer_revision": "2" * 40, "sae_revision": "3" * 40, "layer": 12,
        "module": "language_model.layers.12", "sae_file": "layer12.sae.pt", "dtype": "float32", "sae_dtype": "float32",
        "device": "cpu", "hook": "residual_post_block", "pooling": "mean_of_unique_selected_tokens",
        "encoding": "affine_then_signed_topk_no_relu_no_centering", "truncation": False, "chat_template_applied": False,
        "template": TEMPLATE, "template_sha256": hashlib.sha256(TEMPLATE.encode()).hexdigest(), "max_tokens": 32768,
        "sae_sha256": "4" * 64, "config_sha256": "5" * 64, "tokenizer_chat_template_sha256": "6" * 64,
        "model_files_sha256": {"AUTHORED": "a" * 64}, "tokenizer_files_sha256": {"AUTHORED": "b" * 64},
        "implementation_files_sha256": {"observer_core.py": "c" * 64, "observer_extract.py": "d" * 64},
        "software": {k: "AUTHORED" for k in ("torch", "transformers", "numpy", "tokenizers")}}
    model = {"coefficients": [2.] + [0.] * 65535, "intercept": 0., "classes": [0, 1],
        "preprocessing": {"scale": [1.] * 65536, "mean": None}, "calibration_coefficient": 1., "calibration_intercept": 0.}
    card_feature = {"definition": "Giving the final answer before it is requested, in the supplied context.",
        "target": v2.TARGET, "boundary": "delivered", "observer_manifest_sha256": digest(manifest)}
    split = {"group_assignment": {"tr": "train", "cal": "calibration", "held1": "test", "held2": "test"},
        "rows": {str(i): {"group": "held1" if i < 2 else "held2", "split": "test"} for i in range(4)}}
    report = {"schema_version": 1, "target": v2.TARGET, "boundary": "delivered", "observer_manifest": manifest,
        "split_manifest": split, "split_manifest_sha256": digest(split), "counts": {"train": 2, "calibration": 2, "test": 4},
        "protocol": {"test_used_for_selection": False}, "baselines": {"sae": {"model": model, "feature_card": card_feature,
            "predictions": [{"record_id": str(i), "label": i % 2, "probability": .9 if i % 2 else .1} for i in range(4)]}}}
    card = nt.seal({"kind": v2.VERSION, "concept": v2.CONCEPT, "status": "approved_for_offline_reward",
        "independent": True, "approver": {"kind": "human", "id": "AUTHORED-test-not-permission"},
        "approved_at": "2026-09-13T13:00:00Z", "rubric_revision": review["rubric_revision"], "correctness_check": "math_correctness",
        "probe": {"mode": "sae", "report_sha256": digest(report), "model_sha256": digest(model),
            "feature_card_sha256": digest(card_feature), "observer_manifest_sha256": digest(manifest)},
        "acceptance": {"max_brier": .1, "max_ece": .2, "min_auc": .8, "min_test_families": 2},
        "scope": {"datasets": [None] if ep["source"].get("dataset") is None else [ep["source"]["dataset"]],
            "surfaces": ["interactive"], "request_modes": ["hint_only", "worked_requested"], "require_learner_work": True,
            "heldout_family_aliases": ["held1", "held2"], "actor_model_id": raw[4]["model"]["id"],
            "learner_model_id": ep["learner_policy"]["model"], "tokenizer": raw[4]["tokenizer"],
            "runtime_source_hashes_sha256": nt.native_hash(ep["runtime"]["source_hashes"])},
        "rule": {"penalty": 1., "gamma": 0., "horizon": 1, "baseline": 0, "advantage_cap": 3., "normalization": v2.NORMALIZATION}}, "card_hash")
    prefix = next(f for f in nt.feature_inputs(owner) if f["event_id"] == capture["event_id"] and f["boundary"] == "pre_action")
    first = next(e for e in ep["ledger"] if e["kind"] == "learner_initial_message")
    citation = {"event_id": first["event_id"], "event_hash": first["hash"], "quote": request, "start": 0, "end": len(request)}
    context = nt.seal({"capture_hash": capture["capture_hash"], "pre_action_feature_hash": prefix["feature_hash"],
        "independent": True, "current_request_attested": True, "reviewer": {"kind": "human", "id": "AUTHORED-context-review"},
        "request_mode": "hint_only", "learner_work": "present", "request_citations": [citation], "work_citations": [citation]}, "context_hash")
    return raw, dict(probe_report=report, card=card, approved_card_hash=card["card_hash"], contexts=[context])


def fixture():
    # Source-only fixture setup, performed before its capture is constructed.
    original = hf.fixtures.fixture_episode
    def tagged(*args, **kwargs):
        ep = original(*args, **kwargs)
        ep["source"]["dataset"] = "AUTHORED"
        ep["ledger"][0]["payload"]["source"] = deepcopy(ep["source"])
        hf.fixtures.reseal_episode(ep)
        return ep
    with patch.object(hf.fixtures, "fixture_episode", tagged):
        return inputs()


def measure(raw, kw):
    plan = v2.prepare_measurement_v2(*raw[:5], **kw, prepared_at="2026-09-13T13:01:00Z")
    if not plan["projection"]["records"]:
        return dict(measurement_plan=plan, measurement=None, artifact=None, prepared_at="2026-09-13T13:04:00Z")
    manifest = kw["probe_report"]["observer_manifest"]
    rows = []
    for record in plan["projection"]["records"]:
        view = boundary_view(record)
        spans = view["spans"]
        rows.append({"record_id": record["record_id"], "record_sha256": digest(record),
            "observer_manifest_sha256": digest(manifest), "view": view, "text": view["text"],
            "boundary": record["boundary"], "family_id": record["family_id"], "pooling": manifest["pooling"],
            "sae_width": 65536, "raw": [0.] * 4096, "input_token_ids": list(range(len(spans))),
            "selected_token_indices": list(range(len(spans))), "sae": {str(i): .4 if i == 0 else 0. for i in range(50)},
            "sparse_tokens": [{"token_index": i, "indices": list(range(50)), "values": [.4] + [0.] * 49,
                "character_offsets": [span["start"], span["end"]]} for i, span in enumerate(spans)]})
    artifact = {"manifest": manifest, "manifest_sha256": digest(manifest), "input_sha256": digest(plan["projection"]), "rows": rows}
    measurement = nt.seal({"plan_hash": plan["plan_hash"], "artifact_sha256": digest(artifact),
        "scorer_source_sha256": plan["scorer_source_sha256"], "started_at": "2026-09-13T13:02:00Z",
        "completed_at": "2026-09-13T13:03:00Z", "predictions": [{"record_id": row["record_id"],
            "row_sha256": digest(row), "probability": 1 / (1 + math.exp(-.8)), "abstention_reason": None} for row in rows]}, "measurement_hash")
    return dict(measurement_plan=plan, measurement=measurement, artifact=artifact, prepared_at="2026-09-13T13:04:00Z")


class RewardV2Tests(unittest.TestCase):
    def setUp(self):
        self.raw, self.kw = fixture()

    def run_reward(self, measured=None):
        return v2.prepare_feature_reward_v2(*self.raw[:5], **self.kw, **(measured or measure(self.raw, self.kw)))

    def test_historical_capture_reaches_existing_f_plus_s_unchanged(self):
        before = deepcopy((self.raw, self.kw))
        result = self.run_reward()
        self.assertEqual(before, (self.raw, self.kw))
        self.assertFalse(result["selected_abstentions"])
        self.assertAlmostEqual(result["feature_signals"]["signals"][0]["action_advantage"], -1 / (1 + math.exp(-.8)))
        plan = custom.prepare_custom_update(*self.raw[:6], result["feature_signals"], renderer=hf.Renderer())
        self.assertEqual(plan["normalization"], "mean_action_of_completion_means")
        self.assertEqual(plan["rows"][0]["record"]["segment"]["completion_token_ids"], [20, 21, 22])
        self.assertIsNone(result["learning_outcome"])
        self.assertFalse(result["training_executed"])

    def test_no_context_abstains_without_manufacturing_a_request(self):
        self.kw["contexts"] = []
        result = self.run_reward()
        self.assertIsNone(result["feature_signals"])
        self.assertEqual(result["actions"][0]["abstention"], "missing_request_context")

    def test_unknown_request_and_missing_work_abstain(self):
        for field, value in (("request_mode", "unknown"), ("learner_work", "absent")):
            with self.subTest(field=field):
                raw, kw = fixture()
                kw["contexts"][0][field] = value
                kw["contexts"][0] = nt.seal(kw["contexts"][0], "context_hash")
                result = v2.prepare_feature_reward_v2(*raw[:5], **kw, **measure(raw, kw))
                self.assertIsNone(result["feature_signals"])

    def test_correctness_unknown_abstains_and_explicit_failure_denies(self):
        for verdict in ("unknown", "fail"):
            with self.subTest(verdict=verdict):
                raw, kw = fixture()
                r = raw[2]["reviews"][0]
                r["feedback"]["checks"]["math_correctness"]["verdict"] = verdict
                if verdict == "fail": r["accepted"] = False
                r.update(nt.seal(r, "review_hash"))
                raw[3] = hf.manifest_for(nt.build_exports(*raw[:3]))
                result = v2.prepare_feature_reward_v2(*raw[:5], **kw, **measure(raw, kw))
                self.assertIsNone(result["feature_signals"])
                self.assertEqual(result["actions"][0]["abstention"], "failed_correctness" if verdict == "fail" else "unknown_correctness")

    def test_probability_cannot_be_resealed_into_a_desired_reward(self):
        m = measure(self.raw, self.kw)
        m["measurement"]["predictions"][0]["probability"] = .01
        m["measurement"] = nt.seal(m["measurement"], "measurement_hash")
        with self.assertRaisesRegex(ValueError, "prediction_replay_mismatch"): self.run_reward(m)

    def test_future_context_rejected(self):
        e = next(e for e in self.raw[0][0]["ledger"] if e["kind"] == "learner_intent")
        c = self.kw["contexts"][0]
        c["request_citations"] = [{"event_id": e["event_id"], "event_hash": e["hash"], "quote": "LEARNER_FUTURE"}]
        c.update(nt.seal(c, "context_hash"))
        with self.assertRaisesRegex(ValueError, "context_cross_branch_or_future"): self.run_reward()

    def test_changed_measurement_branch_or_span_rejected(self):
        m = measure(self.raw, self.kw)
        m["artifact"]["rows"][0]["view"]["text"] += " FUTURE"
        m["measurement"]["artifact_sha256"] = digest(m["artifact"])
        m["measurement"] = nt.seal(m["measurement"], "measurement_hash")
        with self.assertRaisesRegex(ValueError, "temporal projection"): self.run_reward(m)

    def test_measurement_before_approval_rejected(self):
        m = measure(self.raw, self.kw)
        m["measurement"]["started_at"] = "2026-09-13T12:00:00Z"
        m["measurement"] = nt.seal(m["measurement"], "measurement_hash")
        with self.assertRaisesRegex(ValueError, "measurement_time_order"): self.run_reward(m)

    def test_unknown_prediction_does_not_become_zero(self):
        m = measure(self.raw, self.kw)
        m["measurement"]["predictions"][0].update(probability=None, abstention_reason="outside_calibration")
        m["measurement"] = nt.seal(m["measurement"], "measurement_hash")
        self.assertIsNone(self.run_reward(m)["feature_signals"])

    def test_explicit_worked_request_uses_zero_context_gate(self):
        c = self.kw["contexts"][0]
        c["request_mode"] = "worked_requested"
        c.update(nt.seal(c, "context_hash"))
        result = self.run_reward()
        self.assertEqual(result["actions"][0]["request_gate"], 0)
        self.assertEqual(result["feature_signals"]["signals"][0]["action_advantage"], 0.)

    def test_character_span_must_match_actual_quote(self):
        c = self.kw["contexts"][0]
        c["request_citations"][0]["start"] = 1
        c.update(nt.seal(c, "context_hash"))
        with self.assertRaisesRegex(ValueError, "context_learner_quote_required"): self.run_reward()

    def test_unknown_later_action_propagates_through_horizon(self):
        self.kw["card"]["rule"].update(gamma=.9, horizon=2)
        self.kw["card"] = nt.seal(self.kw["card"], "card_hash")
        self.kw["approved_card_hash"] = self.kw["card"]["card_hash"]
        result = self.run_reward()
        self.assertIsNone(result["feature_signals"])
        self.assertEqual(result["actions"][0]["return_abstention"], "unknown_reward_in_horizon")

    def test_probing_label_and_unapproved_card_cannot_be_substituted(self):
        self.kw["probe_report"]["target"] = "move.probing"
        with self.assertRaisesRegex(ValueError, "single_sae_report_pin"): self.run_reward()

    def test_even_reapproved_probing_report_is_not_the_required_concept(self):
        report = self.kw["probe_report"]
        report["target"] = "move.probing"
        report["baselines"]["sae"]["feature_card"]["target"] = "move.probing"
        self.kw["card"]["probe"]["report_sha256"] = digest(report)
        self.kw["card"]["probe"]["feature_card_sha256"] = digest(report["baselines"]["sae"]["feature_card"])
        self.kw["card"] = nt.seal(self.kw["card"], "card_hash")
        self.kw["approved_card_hash"] = self.kw["card"]["card_hash"]
        with self.assertRaisesRegex(ValueError, "not_a_premature_answer_head"): self.run_reward()

    def test_resealed_foreign_context_cannot_bind_to_selected_capture(self):
        context = self.kw["contexts"][0]
        context["pre_action_feature_hash"] = "f" * 64
        context.update(nt.seal(context, "context_hash"))
        with self.assertRaisesRegex(ValueError, "context_capture_or_prefix_pin"): self.run_reward()

    def test_failed_probe_quality_denies_even_with_trusted_card(self):
        self.kw["card"]["acceptance"]["max_brier"] = .001
        self.kw["card"] = nt.seal(self.kw["card"], "card_hash")
        self.kw["approved_card_hash"] = self.kw["card"]["card_hash"]
        with self.assertRaisesRegex(ValueError, "probe_evaluation_failed"): self.run_reward()

    def test_independent_model_approval_is_supported_not_human_only(self):
        self.kw["card"]["approver"] = {"kind": "independent_model", "id": "AUTHORED-review",
            "model": {"provider": "AUTHORED", "id": "independent-review-model", "revision": "frozen"}}
        self.kw["card"] = nt.seal(self.kw["card"], "card_hash")
        self.kw["approved_card_hash"] = self.kw["card"]["card_hash"]
        self.assertIsNotNone(self.run_reward()["feature_signals"])


if __name__ == "__main__":
    unittest.main()
