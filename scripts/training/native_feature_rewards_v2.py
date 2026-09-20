"""One contextual excessive-help head -> action advantages; entirely offline.

Approvals are externally supplied trust anchors, not signatures or self-issued
permissions. Historical episodes may predate approval; target measurement may not.
"""
from copy import deepcopy
from pathlib import Path
import hashlib
import math

import native_training as nt
import native_tinker_update as update
import native_observer as observer
import native_feature_rewards as legacy
import observer_probes as probes
import observer_report as extraction
from observer_core import digest
from native_feature_rewards import (
    FeatureRewardError, _require as need, _seal, _stamp, _assessment,
    discounted_action_returns,
)

VERSION = "native-feature-rewards/v2"
CONCEPT = "premature_answer_delivery"
TARGET = "premature_answer"
FEATURE_VERSION = "native-action-feature-advantages/v1"
NORMALIZATION = "mean_of_action_completion_means"


def _independent(reviewer, actor, learner):
    need(type(reviewer) is dict and reviewer.get("kind") in {"human", "independent_model"}
         and update.text(reviewer.get("id")), "independent_reviewer_required")
    if reviewer["kind"] == "independent_model":
        model = reviewer.get("model", {})
        need(all(update.text(model.get(k)) for k in ("provider", "id", "revision")), "reviewer_model_pin")
        identity = lambda s: s.strip().casefold().rsplit("/", 1)[-1]
        need(identity(model["id"]) not in {identity(actor), identity(learner)}, "self_review")


def validate_reward_card_v2(card, report, approved_card_hash):
    _seal(card, "card_hash")
    need(card["card_hash"] == approved_card_hash and update.digest(approved_card_hash), "approved_card_pin")
    need(card.get("kind") == VERSION and card.get("concept") == CONCEPT
         and card.get("status") == "approved_for_offline_reward" and card.get("independent") is True,
         "single_concept_reward_approval_required")
    _stamp(card["approved_at"])
    scope, pin, rule = card["scope"], card["probe"], card["rule"]
    _independent(card["approver"], scope["actor_model_id"], scope["learner_model_id"])
    need(pin.get("mode") == "sae" and pin.get("report_sha256") == digest(report), "single_sae_report_pin")
    baseline = report.get("baselines", {}).get("sae", {})
    model, feature_card = baseline.get("model", {}), baseline.get("feature_card", {})
    need(report.get("target") == feature_card.get("target") == TARGET
         and report.get("boundary") == feature_card.get("boundary") == "delivered"
         and update.text(feature_card.get("definition")), "not_a_premature_answer_head")
    need(pin.get("model_sha256") == digest(model) and pin.get("feature_card_sha256") == digest(feature_card)
         and pin.get("observer_manifest_sha256") == digest(report["observer_manifest"])
         and feature_card.get("observer_manifest_sha256") == pin["observer_manifest_sha256"], "probe_artifact_pin")
    extraction.validate_manifest(report["observer_manifest"])
    need(report["observer_manifest"]["layer"] == 12, "layer12_head_required")
    width = report["observer_manifest"]["dimensions"]["width"]
    need(model.get("classes") == [0, 1] and len(model.get("coefficients", [])) == width
         and len(model.get("preprocessing", {}).get("scale", [])) == width, "probe_dimensions")
    numbers = [*model["coefficients"], model.get("intercept"), model.get("calibration_coefficient"),
               model.get("calibration_intercept")]
    need(all(type(x) in (int, float) and math.isfinite(x) for x in numbers)
         and all(type(x) in (int, float) and math.isfinite(x) and x > 0
                 for x in model["preprocessing"]["scale"]), "finite_calibrated_probe_required")
    need(report.get("protocol", {}).get("test_used_for_selection") is False
         and report.get("split_manifest_sha256") == digest(report["split_manifest"]), "frozen_grouped_probe_protocol")
    groups = report["split_manifest"]["group_assignment"]
    need(set(groups.values()) == {"train", "calibration", "test"}, "three_probe_splits_required")
    predictions = baseline["predictions"]
    ids = [p["record_id"] for p in predictions]
    need(ids and len(ids) == len(set(ids)) and len(ids) == report["counts"]["test"], "evaluation_predictions_required")
    rows = report["split_manifest"]["rows"]
    need(all(i in rows and rows[i]["split"] == groups[rows[i]["group"]] == "test" for i in ids), "test_family_binding")
    metrics = probes.calibration_metrics([p["label"] for p in predictions], [p["probability"] for p in predictions])
    thresholds = card["acceptance"]
    need(all(update.number(thresholds.get(k), 0, 1) for k in ("max_brier", "max_ece", "min_auc"))
         and type(thresholds.get("min_test_families")) is int and thresholds["min_test_families"] >= 2,
         "explicit_evaluation_thresholds_required")
    need(metrics["roc_auc"] is not None and metrics["roc_auc"] >= thresholds["min_auc"]
         and metrics["brier"] <= thresholds["max_brier"] and metrics["ece"] <= thresholds["max_ece"]
         and len({rows[i]["group"] for i in ids}) >= thresholds["min_test_families"], "probe_evaluation_failed")
    for k in ("datasets", "surfaces", "request_modes", "heldout_family_aliases"):
        need(type(scope.get(k)) is list and scope[k] and all(update.text(v) for v in scope[k])
             and len(scope[k]) == len(set(scope[k])), "explicit_context_scope_required")
    need(set(scope["surfaces"]) <= {"chat", "interactive"}
         and set(scope["request_modes"]) <= {"hint_only", "worked_requested"}
         and type(scope.get("require_learner_work")) is bool, "request_scope_required")
    need(update.text(card.get("rubric_revision")) and update.text(card.get("correctness_check")), "correctness_rubric_required")
    need(update.number(rule.get("penalty"), 0.001, 1) and update.number(rule.get("gamma"), 0, 1)
         and type(rule.get("horizon")) is int and 1 <= rule["horizon"] <= 12
         and update.number(rule.get("advantage_cap"), 0.01, 100)
         and rule.get("baseline") == 0 and rule.get("normalization") == NORMALIZATION,
         "bounded_penalty_and_zero_baseline_required")
    return rule


def _context(context, owner, feature, capture, card):
    if context is None:
        return "missing_request_context"
    _seal(context, "context_hash")
    need(context.get("capture_hash") == capture["capture_hash"]
         and context.get("pre_action_feature_hash") == feature["feature_hash"]
         and context.get("independent") is True and context.get("current_request_attested") is True,
         "context_capture_or_prefix_pin")
    _independent(context["reviewer"], card["scope"]["actor_model_id"], card["scope"]["learner_model_id"])
    need(context.get("request_mode") in {"hint_only", "worked_requested", "unknown"}
         and context.get("learner_work") in {"present", "absent", "unknown"}, "context_verdict_required")
    for name in ("request_citations", "work_citations"):
        citations = context.get(name)
        need(type(citations) is list, "context_citations_required")
        for citation in citations:
            event = owner.events.get(citation.get("event_id"))
            need(event is not None and event["hash"] == citation.get("event_hash")
                 and event["sequence"] <= owner.events[feature["latest_allowed_event_id"]]["sequence"], "context_cross_branch_or_future")
            payload = event["payload"]
            text = payload["text"] if event["kind"] == "learner_initial_message" else (
                payload["intent"]["text"] if event["kind"] == "learner_intent" and payload["intent"]["kind"] == "message" else None)
            start, end = citation.get("start"), citation.get("end")
            need(text is not None and type(start) is int and type(end) is int and 0 <= start < end <= len(text)
                 and update.text(citation.get("quote")) and text[start:end] == citation["quote"], "context_learner_quote_required")
    if context["request_mode"] == "unknown" or not context["request_citations"]:
        return "unknown_request"
    if context["request_mode"] not in card["scope"]["request_modes"]:
        return "request_outside_scope"
    if card["scope"]["require_learner_work"] and (
            context["learner_work"] != "present" or not context["work_citations"]):
        return "missing_learner_work"
    return None


def _admit(episodes, captures, reviews, split_manifest, base_config, probe_report, card, approved_card_hash, contexts):
    rule = validate_reward_card_v2(card, probe_report, approved_card_hash)
    update.validate_config(base_config)
    need(base_config["method"] in {"ppo", "sdpo"} and rule["advantage_cap"] <= base_config["advantage_cap"], "consumer_config_required")
    need(1 <= len(episodes) <= 8 and type(contexts) is list and len(contexts) <= 96, "bounded_inputs")
    bundle = nt.build_exports(episodes, captures, reviews)
    families = update.validate_splits(bundle, split_manifest)
    scope = card["scope"]
    need(base_config["model"]["id"] == scope["actor_model_id"] and base_config["tokenizer"] == scope["tokenizer"], "actor_scope_mismatch")
    cm = {c["capture_hash"]: c for c in captures["captures"]}
    contexts_map = {c["capture_hash"]: c for c in contexts}
    need(len(contexts_map) == len(contexts) and set(contexts_map) <= set(cm), "duplicate_or_unbound_context")
    rm = {r["capture_hash"]: r for r in reviews["reviews"] if r["kind"] == "segment"}
    policy = {r["segment"]["capture_hash"]: r for r in bundle["policy_segments"]}
    features = {f["feature_hash"]: f for f in bundle["observer_inputs"]}
    actions, records = [], []
    for episode in episodes:
        owner = nt.validate_episode(episode)
        family = families[episode["family"]]
        protected = set(scope["heldout_family_aliases"]) | {g for g, s in probe_report["split_manifest"]["group_assignment"].items() if s != "train"}
        aliases = set(family["aliases"]) | {"family:" + a for a in family["aliases"]}
        need(family["split"] == "train" and not family["protected"] and not aliases & protected, "protected_reward_family")
        need(episode["source"].get("dataset") in scope["datasets"]
             and episode["learner_policy"]["model"] == scope["learner_model_id"]
             and nt.native_hash(episode["runtime"]["source_hashes"]) == scope["runtime_source_hashes_sha256"], "episode_scope_mismatch")
        fs = [f for f in features.values() if f["episode_id"] == episode["id"] and f["branch_id"] == episode["branch_id"]]
        for delivered in sorted((f for f in fs if f["boundary"] == "delivered"), key=lambda f: owner.events[f["event_id"]]["sequence"]):
            step = owner.events[delivered["event_id"]]["payload"]
            actor_count = sum(m.get("role") == "assistant" for m in step["messages"][step["message_start_index"]:])
            matched = [c for c in cm.values() if all(c[k] == delivered[k] for k in update.REF_KEYS)]
            capture = matched[0] if len(matched) == 1 else None
            key = capture["capture_hash"] if capture else None
            review, row = rm.get(key), policy.get(key)
            reason = None
            prefix = next(f for f in fs if f["event_id"] == delivered["event_id"] and f["boundary"] == "pre_action")
            document = owner.events[delivered["delivery_event_id"]]["payload"]
            surface = "interactive" if document["documents"] else "chat"
            if actor_count != 1 or len(matched) > 1:
                reason = "multiple_actor_segments_in_delivery"
            elif surface not in scope["surfaces"]:
                reason = "surface_outside_scope"
            elif capture is None or row is None or not row["training_eligible"]:
                reason = "missing_eligible_original_capture"
            elif review is None:
                reason = "missing_independent_review"
            else:
                need(review["rubric_revision"] == card["rubric_revision"], "correctness_review_rubric_pin")
                # Even a retrospective review must cite correctness by delivery,
                # not future learner agreement or an invented learning outcome.
                correct = _assessment(review, owner, delivered, [card["correctness_check"]], scope["actor_model_id"])
                reason = "unknown_correctness" if correct is None else "failed_correctness" if not correct else None
                context_reason = _context(contexts_map.get(key), owner, prefix, capture, card)
                reason = reason or context_reason
            projected = observer.project_feature(delivered, episode["family"], {
                "dataset": episode["source"].get("dataset"), "measurement": episode["measurement"], "episode_hash": nt.native_hash(episode)})
            action = {**{k: delivered[k] for k in update.REF_KEYS}, "capture_hash": key,
                "native_feature_hash": delivered["feature_hash"], "review_hash": review["review_hash"] if review else None,
                "context_hash": contexts_map[key]["context_hash"] if key in contexts_map else None,
                "request_mode": contexts_map[key]["request_mode"] if key in contexts_map else "unknown",
                "record_id": projected["record_id"], "abstention": reason,
                "terminal": episode["outcome"] in {"complete", "learner_stop"} and episode["runtime"]["status"] == "completed"}
            actions.append(action)
            if reason is None:
                records.append(projected)
    need(len(actions) <= 96 and set(base_config["capture_hashes"]) <= {a["capture_hash"] for a in actions}, "selected_action_missing")
    return bundle, actions, records, rm


def prepare_measurement_v2(episodes, captures, reviews, split_manifest, base_config, *,
                           probe_report, card, approved_card_hash, contexts, prepared_at):
    """Freeze exact eligible native projections before target measurement; no IO."""
    bundle, actions, records, _ = _admit(episodes, captures, reviews, split_manifest, base_config,
                                        probe_report, card, approved_card_hash, contexts)
    need(_stamp(card["approved_at"]) <= _stamp(prepared_at), "measurement_plan_before_approval")
    return nt.seal({"kind": "native-feature-measurement-plan/v2", "card_hash": card["card_hash"],
        "prepared_at": prepared_at, "config_hash": base_config["config_hash"], "export_hash": bundle["export_hash"],
        "split_hash": split_manifest["split_hash"], "actions": actions, "projection": {"schema_version": 1, "records": records},
        "scorer_source_sha256": hashlib.sha256(Path(probes.__file__).read_bytes()).hexdigest(),
        "producer_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "dependency_source_hashes": {Path(m.__file__).name: hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
                                    for m in (nt, update, observer, probes, extraction, legacy)}}, "plan_hash")


def validate_measurement_basis(manifest, report_manifest, card):
    """Allow a reviewed exporter revision, preserving every model/basis field."""
    extraction.validate_manifest(manifest)
    actual, fitted = deepcopy(manifest), deepcopy(report_manifest)
    field = 'layer_selection_implementation_sha256'
    if actual.get(field) != fitted.get(field):
        pin = card.get('measurement_layer_selection_sha256')
        need(update.digest(pin) and actual.get(field) == pin, 'measurement_exporter_not_approved')
        actual.pop(field, None)
        fitted.pop(field, None)
    need(actual == fitted, 'measurement_observer_pin')


def prepare_feature_reward_v2(episodes, captures, reviews, split_manifest, base_config, *,
                              probe_report, card, approved_card_hash, contexts, measurement_plan,
                              measurement, artifact, prepared_at):
    """Validate measured predictions and emit the unchanged custom F+S envelope.

Missing/unknown evidence yields no consumable envelope for the selected batch.
Conflicting hashes, future evidence and numerically false predictions raise.
"""
    _seal(measurement_plan, "plan_hash")
    args = dict(probe_report=probe_report, card=card, approved_card_hash=approved_card_hash, contexts=contexts)
    expected = prepare_measurement_v2(episodes, captures, reviews, split_manifest, base_config,
                                     **args, prepared_at=measurement_plan["prepared_at"])
    need(measurement_plan == expected, "measurement_plan_binding")
    bundle, actions, _, rm = _admit(episodes, captures, reviews, split_manifest, base_config,
                                   probe_report, card, approved_card_hash, contexts)
    predictions, measured_rows = {}, {}
    if measurement is not None:
        _seal(measurement, "measurement_hash")
        need(measurement.get("plan_hash") == expected["plan_hash"]
             and measurement.get("artifact_sha256") == digest(artifact)
             and measurement.get("scorer_source_sha256") == expected["scorer_source_sha256"], "measurement_binding")
        need(_stamp(expected["prepared_at"]) <= _stamp(measurement["started_at"])
             <= _stamp(measurement["completed_at"]) <= _stamp(prepared_at), "measurement_time_order")
        need(artifact["manifest_sha256"] == digest(artifact["manifest"]), "measurement_observer_pin")
        validate_measurement_basis(artifact["manifest"], probe_report["observer_manifest"], card)
        extraction.validate_rows(artifact, expected["projection"])
        measured_rows = {r["record_id"]: r for r in artifact["rows"]}
        predictions = {p["record_id"]: p for p in measurement["predictions"]}
        need(len(predictions) == len(measurement["predictions"]) and set(predictions) == set(measured_rows), "prediction_rows_binding")
        for key, row in measured_rows.items():
            prediction = predictions[key]
            need(prediction.get("row_sha256") == digest(row), "prediction_row_hash")
            p = prediction.get("probability")
            if p is None:
                need(update.text(prediction.get("abstention_reason")), "prediction_abstention_required")
            else:
                need(update.number(p, 0, 1) and prediction.get("abstention_reason") is None, "calibrated_probability_required")
                actual = probes.predict_probe(probe_report["baselines"]["sae"]["model"], [row], "sae", width=row["sae_width"])[0]
                need(math.isclose(p, actual, rel_tol=1e-10, abs_tol=1e-12), "prediction_replay_mismatch")
    else:
        need(artifact is None, "unbound_measurement_artifact")
        need(_stamp(expected["prepared_at"]) <= _stamp(prepared_at), "reward_time_order")
    rule, signals = card["rule"], []
    for action in actions:
        p = predictions.get(action["record_id"], {}).get("probability")
        action["abstention"] = action["abstention"] or ("missing_or_unknown_prediction" if p is None else None)
        action["probability"] = p
        action["request_gate"] = 1 if action["request_mode"] == "hint_only" else 0
        action["reward"] = None if action["abstention"] else -rule["penalty"] * action["request_gate"] * p
    for identity in dict.fromkeys((a["episode_id"], a["branch_id"]) for a in actions):
        branch = [a for a in actions if (a["episode_id"], a["branch_id"]) == identity]
        returns = discounted_action_returns([a["reward"] for a in branch], gamma=rule["gamma"], horizon=rule["horizon"], terminal=branch[-1]["terminal"])
        for action, result in zip(branch, returns):
            advantage = None if result["value"] is None else max(-rule["advantage_cap"], result["value"])
            action.update(action_return=result["value"], action_advantage=advantage, return_abstention=result["reason"])
            key = action["capture_hash"]
            if key not in base_config["capture_hashes"] or advantage is None:
                continue
            review = rm[key]
            if not review["accepted"] and advantage >= 0:
                action.update(action_advantage=None, return_abstention="rejected_action_requires_negative_advantage")
                continue
            signals.append({"capture_hash": key, "review": deepcopy(review), "action_advantage": advantage,
                "advantage_provenance": {"unit": "action_advantage", "aggregation": "per_action_completion_mean",
                    "estimator_revision": VERSION, "baseline_revision": "fixed-zero/v1", "source_revision": expected["scorer_source_sha256"],
                    "horizon_actions": rule["horizon"], "discount": rule["gamma"], "review_hash": review["review_hash"],
                    "feature_hash": review["evidence_hash"], "card_hash": card["card_hash"], "measurement_plan_hash": expected["plan_hash"],
                    "measurement_hash": measurement["measurement_hash"], "concept": CONCEPT,
                    "return_evidence": [deepcopy(branch[i]) for i in result["action_indices"]]}})
    by_capture = {s["capture_hash"]: s for s in signals}
    missing = [h for h in base_config["capture_hashes"] if h not in by_capture]
    envelope = None if missing else nt.seal({"schema_version": 1, "kind": FEATURE_VERSION,
        "export_hash": bundle["export_hash"], "signals": [by_capture[h] for h in base_config["capture_hashes"]]}, "features_hash")
    return nt.seal({"kind": VERSION, "card_hash": card["card_hash"], "measurement_plan_hash": expected["plan_hash"],
        "prepared_at": prepared_at, "normalization": NORMALIZATION, "actions": actions,
        "selected_abstentions": missing, "feature_signals": envelope, "learning_outcome": None,
        "training_executed": False}, "audit_hash")
