"""Offline W6 connection: approved feature scores -> action returns -> PPO signals.

No probe fitting/scoring, token reconstruction, provider clients or file writes.
Caller-supplied approval hashes are trust anchors, not cryptographic signatures.
"""
from copy import deepcopy
from datetime import datetime

import native_observer as observer
import native_tinker_update as update
import native_training as nt
from observer_core import digest as observer_hash


VERSION = "native-feature-rewards/v1"
NORMALIZATION = "mean_of_action_completion_means"
HEADS = {
    "need_scaffolding": "pre_action", "need_rigor": "pre_action",
    "action_scaffolding": "delivered", "action_rigor": "delivered",
    "excessive_help": "delivered",
}
GATES = {"calibration", "independent_evaluation", "domain_and_surface_transfer"}


class FeatureRewardError(ValueError):
    """Malformed or conflicting evidence; missing evidence instead abstains."""


def _require(condition, code):
    if not condition:
        raise FeatureRewardError(code)


def _keys(value, names):
    _require(type(value) is dict and set(value) == set(names.split()), "record_fields")


def _seal(value, field):
    _require(type(value) is dict and update.digest(value.get(field)) and
             value[field] == nt.native_hash({k: v for k, v in value.items() if k != field}),
             "invalid_" + field)


def _stamp(value):
    _require(update.text(value), "timestamp_required")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    _require(stamp.tzinfo is not None, "timestamp_timezone_required")
    return stamp


def _strings(values):
    return (type(values) is list and bool(values) and all(update.text(v) for v in values)
            and len(values) == len(set(values)))


def validate_reward_card(card, probes, approved_card_hash):
    """Require an externally approved, frozen reward-use card, not a fit report."""
    _seal(card, "card_hash")
    _require(update.digest(approved_card_hash) and card["card_hash"] == approved_card_hash,
             "approved_card_pin")
    _keys(card, "schema_version purpose status frozen independent approver approved_at rubric_revision "
          "probe_pins evaluation scope rule card_hash")
    _require(card["schema_version"] == 1 and card["purpose"] == VERSION and
             card["status"] == "approved_for_feature_reward" and card["frozen"] is True and
             card["independent"] is True, "reward_use_approval_required")
    approver = card["approver"]
    _require(type(approver) is dict and approver.get("kind") in {"human", "independent_model"},
             "independent_approval_identity")
    _keys(approver, "kind id model" if approver["kind"] == "independent_model" else "kind id")
    _require(update.text(approver["id"]) and update.text(card["rubric_revision"]), "independent_approval_identity")
    _stamp(card["approved_at"])
    evaluation = card["evaluation"]
    _keys(evaluation, "artifact_sha256 protocol_revision heldout_family_aliases gates")
    _require(update.digest(evaluation["artifact_sha256"]) and update.text(evaluation["protocol_revision"])
             and _strings(evaluation["heldout_family_aliases"]), "evaluation_evidence_required")
    _require(type(evaluation["gates"]) is dict and set(evaluation["gates"]) == GATES and
             all(v is True for v in evaluation["gates"].values()), "evaluation_gates_required")
    scope = card["scope"]
    _keys(scope, "datasets surfaces actor_model_id learner_model_id tokenizer runtime_source_hashes_sha256")
    _require(_strings(scope["datasets"]) and _strings(scope["surfaces"]) and
             set(scope["surfaces"]) <= {"chat", "interactive"} and
             update.text(scope["actor_model_id"]) and update.text(scope["learner_model_id"]) and
             type(scope["tokenizer"]) is dict and update.digest(scope["runtime_source_hashes_sha256"]), "approved_scope_required")
    if approver["kind"] == "independent_model":
        _keys(approver["model"], "provider id revision")
        _require(all(update.text(v) for v in approver["model"].values()), "approval_model_pin")
        identity = lambda name: name.strip().casefold().rsplit("/", 1)[-1]
        _require(identity(approver["model"]["id"]) not in {
            identity(scope["actor_model_id"]), identity(scope["learner_model_id"])}, "approval_self_review_alias")
    _require(type(probes) is dict and set(probes) == set(HEADS) and
             type(card["probe_pins"]) is dict and set(card["probe_pins"]) == set(HEADS), "five_probe_heads_required")
    for head, boundary in HEADS.items():
        entry, pin = probes[head], card["probe_pins"][head]
        _keys(entry, "report mode")
        _keys(pin, "report_sha256 mode model_sha256 feature_card_sha256 observer_manifest_sha256")
        report, mode = entry["report"], entry["mode"]
        _require(type(report) is dict and mode in {"text", "raw", "sae"} and pin["mode"] == mode
                 and observer_hash(report) == pin["report_sha256"], "probe_report_pin")
        baseline = report.get("baselines", {}).get(mode, {})
        feature_card, model = baseline.get("feature_card", {}), baseline.get("model", {})
        _require(bool(model) and observer_hash(model) == pin["model_sha256"] and
                 observer_hash(feature_card) == pin["feature_card_sha256"] and
                 observer_hash(report.get("observer_manifest")) == pin["observer_manifest_sha256"], "probe_model_or_observer_pin")
        _require(report.get("schema_version") == 1 and report.get("boundary") == boundary and
                 feature_card.get("boundary") == boundary and feature_card.get("target") == report.get("target") and
                 update.text(report.get("target")) and update.text(feature_card.get("definition")) and
                 feature_card.get("observer_manifest_sha256") == pin["observer_manifest_sha256"], "probe_boundary_or_definition")
        _require(report.get("protocol", {}).get("test_used_for_selection") is False and
                 report.get("split_manifest_sha256") == observer_hash(report.get("split_manifest")) and
                 all(type(report.get("counts", {}).get(s)) is int and report["counts"][s] > 0
                     for s in ("train", "calibration", "test")), "heldout_probe_protocol_required")
    rule = card["rule"]
    _keys(rule, "gamma horizon excess_penalty minimum_need_mass failure_reward advantage_cap baseline assessment_checks normalization")
    _require(update.number(rule["gamma"], 0, 1) and type(rule["horizon"]) is int and
             1 <= rule["horizon"] <= 12 and update.number(rule["excess_penalty"], 0, 1) and
             update.number(rule["minimum_need_mass"], 0.001, 2) and
             update.number(rule["failure_reward"], -1, -0.001) and
             update.number(rule["advantage_cap"], 0.01, 100) and
             _strings(rule["assessment_checks"]) and rule["normalization"] == NORMALIZATION, "bounded_reward_rule_required")
    _keys(rule["baseline"], "kind value revision")
    _require(rule["baseline"]["kind"] == "frozen_constant" and
             update.number(rule["baseline"]["value"], -12, 12) and
             update.text(rule["baseline"]["revision"]), "prefix_only_constant_baseline_required")
    return deepcopy(rule)


def discounted_action_returns(rewards, *, gamma, horizon, terminal):
    """Finite-horizon returns; unknown rewards and unobserved tails stay unknown.

    Every item is one chronological delivered action from ONE branch. The main
    entrypoint constructs this list from the validated ledger, never caller order.
    """
    _require(type(rewards) is list and 1 <= len(rewards) <= 12 and
             all(v is None or update.number(v, -1, 1) for v in rewards), "bounded_action_rewards_required")
    _require(update.number(gamma, 0, 1) and type(horizon) is int and 1 <= horizon <= 12 and
             type(terminal) is bool, "bounded_return_settings_required")
    results = []
    for start in range(len(rewards)):
        width = 1 if gamma == 0 else horizon
        stop = min(len(rewards), start + width)
        indices = list(range(start, stop))
        reason = ("unknown_reward_in_horizon" if any(rewards[i] is None for i in indices) else
                  "unobserved_tail" if not terminal and start + width > len(rewards) else None)
        value = None if reason else sum(gamma ** (i - start) * rewards[i] for i in indices)
        results.append({"value": value, "reason": reason, "action_indices": indices})
    return results


def _assessment(review, episode, feature, checks, actor_model_id):
    """Read explicit independent review checks; never infer success from a receipt."""
    reviewer = review["reviewer"]
    if reviewer["kind"] == "independent_model":
        identity = lambda name: name.strip().casefold().rsplit("/", 1)[-1]
        _require(identity(reviewer["model"]["id"]) not in {
            identity(actor_model_id), identity(episode.value["learner_policy"]["model"])}, "assessment_self_review_alias")
    supplied = review.get("feedback", {}).get("checks")
    if supplied is None:
        return None
    _require(type(supplied) is dict and bool(supplied), "assessment_checks_object")
    latest = episode.events[feature["latest_allowed_event_id"]]["sequence"]
    action = episode.events[feature["event_id"]]
    action_ids = {feature["delivery_event_id"]} | {
        e["event_id"] for e in episode.value["ledger"][action["sequence"]:latest + 1]
        if e["kind"] == "actor_message" and e["payload"]["step"] == action["payload"]["index"]}
    verdicts = {}
    for name, item in supplied.items():
        _keys(item, "verdict reasoning citations")
        _require(item["verdict"] in {"pass", "fail", "unknown"} and update.text(item["reasoning"])
                 and type(item["citations"]) is list, "assessment_verdict_required")
        action_cited = False
        for citation in item["citations"]:
            _keys(citation, "event_id event_hash quote")
            event = episode.events.get(citation["event_id"])
            _require(event is not None and event["hash"] == citation["event_hash"] and
                     event["sequence"] <= latest, "assessment_cross_branch_or_future")
            if event["kind"] == "learner_initial_message":
                visible = event["payload"]["text"]
            elif event["kind"] == "learner_intent" and event["payload"]["intent"]["kind"] == "message":
                visible = event["payload"]["intent"]["text"]
            elif event["kind"] == "delivered_observation":
                observation = event["payload"]
                visible = "\n".join([observation["visibleText"], *[
                    "\n".join([d["heading"], *d["body"]]) for d in observation["documents"]]])
            elif event["kind"] == "actor_message" and event["event_id"] in action_ids:
                message = event["payload"]["message"]
                content = message.get("content", "")
                visible = content if type(content) is str else "\n".join(
                    b["text"] for b in content if b.get("type") == "text")
            else:
                raise FeatureRewardError("assessment_nonsemantic_evidence")
            _require(update.text(citation["quote"]) and citation["quote"] in visible, "assessment_quote_binding")
            action_cited |= event["event_id"] in action_ids
        _require(item["verdict"] == "unknown" or action_cited, "assessment_action_citation_required")
        verdicts[name] = item["verdict"]
    # The independent review, not the probe score, determines action acceptance.
    if "fail" in verdicts.values():
        _require(review["accepted"] is False, "assessment_review_decision_conflict")
    elif "unknown" not in verdicts.values():
        _require(review["accepted"] is True, "assessment_review_decision_conflict")
    if "unknown" in verdicts.values() or any(k not in verdicts for k in checks):
        return None
    return all(verdicts[k] == "pass" for k in checks)


def _scores(measurement, features, episode, card):
    _seal(measurement, "measurement_hash")
    _keys(measurement, "schema_version episode_hash episode_id branch_id family event_id event_hash payload_hash "
          "review_hash card_hash predictions measurement_hash")
    _require(measurement["schema_version"] == 1 and measurement["card_hash"] == card["card_hash"] and
             measurement["episode_hash"] == nt.native_hash(episode.value), "measurement_episode_or_card_pin")
    _require(type(measurement["predictions"]) is dict and set(measurement["predictions"]) <= set(HEADS), "prediction_heads")
    values = {}
    for head, prediction in measurement["predictions"].items():
        _seal(prediction, "prediction_hash")
        _keys(prediction, "report_sha256 model_sha256 observer_manifest_sha256 native_feature_hash "
              "input_sha256 scorer_revision probability abstention_reason prediction_hash")
        feature, pin = features[HEADS[head]], card["probe_pins"][head]
        _require(all(prediction[k] == pin[k] for k in
                     ("report_sha256", "model_sha256", "observer_manifest_sha256")) and
                 prediction["native_feature_hash"] == feature["feature_hash"], "prediction_probe_or_causal_pin")
        source = {"dataset": episode.value["source"].get("dataset"),
                  "measurement": episode.value["measurement"], "episode_hash": nt.native_hash(episode.value)}
        projected = observer.project_feature(feature, family=episode.value["family"], source=source)
        _require(prediction["input_sha256"] == observer_hash(projected) and
                 update.text(prediction["scorer_revision"]), "prediction_input_pin")
        probability = prediction["probability"]
        _require((probability is None and update.text(prediction["abstention_reason"])) or
                 (update.number(probability, 0, 1) and prediction["abstention_reason"] is None), "probability_or_abstention")
        values[head] = probability
    return values


def build_feature_signals(episodes, captures, reviews, *, probes, evaluation_card,
                          approved_card_hash, measurements, update_config, split_manifest):
    """Rebuild native evidence, audit rewards/returns, emit the existing signals schema.

    Input envelopes for captures/reviews are native_training.build_exports inputs.
    measurements is a list of sealed, externally scored action records. No inputs
    are modified. Call prepare_update separately with the returned export/signals
    and an approved split manifest; this function never constructs a client.
    """
    episodes, captures, reviews, probes, card, measurements, config = deepcopy(
        (episodes, captures, reviews, probes, evaluation_card, measurements, update_config))
    _require(type(episodes) is list and 1 <= len(episodes) <= 8 and type(measurements) is list
             and len(measurements) <= 96, "bounded_input_required")
    rule = validate_reward_card(card, probes, approved_card_hash)
    update.validate_config(config)
    _require(config["method"] == "ppo" and rule["advantage_cap"] <= config["advantage_cap"], "ppo_cap_required")
    bundle = nt.build_exports(episodes, captures, reviews)
    families = update.validate_splits(bundle, split_manifest)
    _require(config["model"]["id"] == card["scope"]["actor_model_id"] and
             config["tokenizer"] == card["scope"]["tokenizer"], "approved_actor_scope")
    owners = {(e["id"], e["branch_id"]): nt.validate_episode(e) for e in episodes}
    for episode in owners.values():
        _require(_stamp(card["approved_at"]) <= _stamp(episode.value["ledger"][0]["timestamp"]), "approval_after_episode")
        family = families[episode.value["family"]]
        _require(family["split"] == "train" and family["protected"] is False, "training_family_required")
        _require(not set(family["aliases"]) & set(card["evaluation"]["heldout_family_aliases"]), "evaluation_family_leakage")
        scope = card["scope"]
        _require(episode.value["source"].get("dataset") in scope["datasets"] and
                 episode.value["learner_policy"]["model"] == scope["learner_model_id"] and
                 nt.native_hash(episode.value["runtime"]["source_hashes"]) == scope["runtime_source_hashes_sha256"], "approved_episode_scope")
        for delivery in episode.deliveries.values():
            surface = "interactive" if delivery["payload"]["documents"] else "chat"
            _require(surface in scope["surfaces"], "approved_surface_scope")
    feature_map = {f["feature_hash"]: f for f in bundle["observer_inputs"]}
    by_action = {}
    for feature in feature_map.values():
        by_action.setdefault(tuple(feature[k] for k in update.REF_KEYS[:2]) + (feature["event_id"],), {})[feature["boundary"]] = feature
    policy_rows = {r["segment"]["capture_hash"]: r for r in bundle["policy_segments"]}
    raw_captures = {c["capture_hash"]: c for c in (captures or {}).get("captures", [])}
    selected = config["capture_hashes"]
    _require(all(h in raw_captures for h in selected), "selected_capture_missing")
    review_map = {r["capture_hash"]: r for r in (reviews or {}).get("reviews", []) if r["kind"] == "segment"}
    measurements_by_action = {}
    for measurement in measurements:
        _seal(measurement, "measurement_hash")
        key = tuple(measurement.get(k) for k in ("episode_id", "branch_id", "event_id"))
        _require(key in by_action and key not in measurements_by_action, "measurement_cross_branch_or_duplicate")
        features = by_action[key]
        _require(all(measurement.get(k) == features["delivered"][k] for k in update.REF_KEYS), "measurement_event_pin")
        matching = [r for h, r in review_map.items() if all(r[k] == measurement[k] for k in update.REF_KEYS)]
        _require(any(r["review_hash"] == measurement.get("review_hash") for r in matching), "measurement_review_pin")
        owner = owners[key[:2]]
        # Check even unselected/abstaining records; malformed evidence is not missing evidence.
        scores = _scores(measurement, features, owner, card)
        measurements_by_action[key] = (measurement, scores)
    audits, signals = [], []
    for identity, owner in owners.items():
        ordered = sorted((fs for key, fs in by_action.items() if key[:2] == identity),
                         key=lambda fs: owner.events[fs["delivered"]["event_id"]]["sequence"])
        _require(len(ordered) <= 12, "action_limit")
        actions = []
        for features in ordered:
            delivered = features["delivered"]
            key = (*identity, delivered["event_id"])
            step = owner.events[delivered["event_id"]]["payload"]
            actor_count = sum(m.get("role") == "assistant" for m in step["messages"][step["message_start_index"]:])
            caps = [c for c in raw_captures.values() if all(c[k] == delivered[k] for k in update.REF_KEYS)]
            capture = caps[0] if len(caps) == 1 else None
            row = policy_rows.get(capture["capture_hash"]) if capture else None
            review = review_map.get(capture["capture_hash"]) if capture else None
            measurement, scores = measurements_by_action.get(key, (None, {}))
            reason, reward, assessment = None, None, None
            if actor_count != 1 or len(caps) > 1:
                reason = "multiple_actor_segments_in_delivery"
            elif capture is None:
                reason = "missing_original_capture"
            elif review is None:
                reason = "missing_independent_review"
            else:
                _require(review["rubric_revision"] == card["rubric_revision"], "review_rubric_pin")
                assessment = _assessment(review, owner, feature_map[review["evidence_hash"]],
                                         rule["assessment_checks"], config["model"]["id"])
                if measurement is not None:
                    _require(measurement["review_hash"] == review["review_hash"], "measurement_review_pin")
                if row is None or not row["training_eligible"]:
                    reason = "evaluation_or_fixture_only"
                elif measurement is None:
                    reason = "missing_measurement"
                elif any(scores.get(k) is None for k in ("need_scaffolding", "need_rigor")):
                    reason = "unknown_need"
                elif scores["need_scaffolding"] + scores["need_rigor"] < rule["minimum_need_mass"]:
                    reason = "insufficient_need_mass"
                elif assessment is None:
                    reason = "unknown_assessment"
                elif any(scores.get(k) is None for k in HEADS):
                    reason = "unknown_delivered_action"
                else:
                    update.validate_segment(row, bundle["episodes"][list(owners).index(identity)], config, policy=True)
                    mass = scores["need_scaffolding"] + scores["need_rigor"]
                    match = sum(scores["need_" + c] * scores["action_" + c] for c in ("scaffolding", "rigor")) / mass
                    reward = match - rule["excess_penalty"] * scores["excessive_help"] if assessment else rule["failure_reward"]
            actions.append({**{k: delivered[k] for k in update.REF_KEYS},
                "capture_hash": capture["capture_hash"] if capture else None,
                "review_hash": review["review_hash"] if review else None,
                "measurement_hash": measurement["measurement_hash"] if measurement else None,
                "assessment_passed": assessment, "reward": reward, "reward_abstention": reason})
        if not actions:
            continue
        terminal = owner.value["outcome"] in {"complete", "learner_stop"} and owner.value["runtime"]["status"] == "completed"
        returns = discounted_action_returns([a["reward"] for a in actions], gamma=rule["gamma"],
                                             horizon=rule["horizon"], terminal=terminal)
        for action, action_return in zip(actions, returns):
            value = action_return["value"]
            advantage = None if value is None else max(-rule["advantage_cap"], min(
                rule["advantage_cap"], value - rule["baseline"]["value"]))
            capture_hash = action["capture_hash"]
            review = review_map.get(capture_hash)
            reason = action_return["reason"]
            if advantage is not None and review["accepted"] is False and advantage >= 0:
                reason, advantage = "rejected_action_requires_negative_advantage", None
            action.update(action_return=value, advantage=advantage, signal_abstention=reason,
                return_event_ids=[actions[i]["event_id"] for i in action_return["action_indices"]])
            if capture_hash not in selected or advantage is None:
                continue
            row = policy_rows[capture_hash]
            provenance = {"review_hash": review["review_hash"], "feature_hash": review["evidence_hash"],
                "estimator_revision": VERSION, "baseline_revision": rule["baseline"]["revision"],
                "aggregation": NORMALIZATION, "card_hash": card["card_hash"], "config_hash": config["config_hash"],
                "action_return": value, "action_advantage": advantage, "rule": rule,
                "return_evidence": [{k: actions[i][k] for k in (*update.REF_KEYS, "capture_hash", "review_hash",
                    "measurement_hash", "assessment_passed", "reward")} for i in action_return["action_indices"]]}
            signals.append({"capture_hash": capture_hash, "review": review,
                "advantages": [advantage] * len(row["segment"]["completion_token_ids"]),
                "advantage_provenance": provenance})
            update.validate_signal(row, signals[-1], feature_map, config, policy=True)
        audits.extend(actions)
    signal_map = {s["capture_hash"]: s for s in signals}
    signal_envelope = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"],
        "signals": [signal_map[h] for h in selected if h in signal_map]}, "signals_hash")
    return nt.seal({"schema_version": 1, "version": VERSION, "card_hash": card["card_hash"],
        "config_hash": config["config_hash"], "normalization": NORMALIZATION,
        "export": bundle, "signals": signal_envelope, "actions": audits,
        "selected_abstentions": [h for h in selected if h not in signal_map],
        "learning_outcome": None, "training_executed": False}, "audit_hash")
