"""Contextual tutoring judgments -> native action advantages, without training IO.

Uses the benchmark's classifier protocol on separately admitted training episodes.
No benchmark responses, fixed learner continuations, or synthetic token scores are
accepted as training evidence. Saved judgments are replayed at consumption.
"""
from copy import deepcopy
import argparse
import hashlib
from pathlib import Path

import benchmark_response_grading as grading
import benchmark_v4 as v4
import native_observer as observer
import native_training as nt
import native_tinker_update as base
# Audits use native JSON's numeric convention (1.0 serializes as 1). Use
# the same hash encoder so saving/reloading cannot change a classifier receipt.
from native_training import native_hash as digest

VERSION = "native-contextual-rewards/v1"
FEATURE_VERSION = "native-action-feature-advantages/v1"
NORMALIZATION = "per_action_completion_mean"


def protected_benchmark_families():
    """Load only identities from both frozen versions, never their labels/text."""
    suites = [v4.load_suite(path) for path in (v4.SUITE, v4.HISTORICAL_SUITE)]
    aliases = {c["family"] for suite in suites for c in suite["cases"]}
    aliases.update(c["id"] for suite in suites for c in suite["cases"])
    return aliases, [suite["manifest_sha256"] for suite in suites]


def validate_spec(spec, config):
    base.sealed(spec, "spec_hash")
    base.need(set(spec) == {"kind", "classifier", "reward_scale", "excluded_family_aliases",
                           "excluded_sources", "spec_hash"} and spec["kind"] == VERSION,
              "contextual_reward_spec_required")
    grading.validate_classifier(spec["classifier"])
    base.need(base.number(spec["reward_scale"], 0.001, min(1, config["advantage_cap"])),
              "bounded_contextual_reward_scale")
    aliases = spec["excluded_family_aliases"]
    base.need(type(aliases) is list and aliases and all(base.text(x) for x in aliases)
              and len(set(aliases)) == len(aliases), "classifier_holdout_aliases_required")
    sources = spec["excluded_sources"]
    base.need(type(sources) is list, "classifier_holdout_sources_required")
    for source in sources:
        base.need(set(source) == {"dataset", "record_id", "record_sha256"}
                  and base.text(source["dataset"]) and base.text(source["record_id"])
                  and base.digest(source["record_sha256"]), "invalid_classifier_holdout_source")


def source_pins():
    return {Path(module.__file__).name: hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
            for module in (grading, observer, nt, base)} | {
                Path(__file__).name: hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def _action_view(owner, capture):
    """Receipt-backed semantic text and offsets, cut before the next learner event."""
    features = [f for f in nt.feature_inputs(owner) if f["event_id"] == capture["event_id"]]
    prefix = next(f for f in features if f["boundary"] == "pre_action")
    delivered = next(f for f in features if f["boundary"] == "delivered")
    projected = {f["boundary"]: observer.project_feature(f, capture["family"], {})
                 for f in (prefix, delivered)}
    messages = [{"message_index": i, "role": "user" if e["kind"] == "learner_message" else
                 "assistant" if e["kind"] == "actor_message" else "artifact", "text": e["text"],
                 "event_id": e["native_event_id"], "event_hash": owner.events[e["native_event_id"]]["hash"]}
                for i, e in enumerate(projected["pre_action"]["events"])]
    context = {"projection": "native-visible-prefix/v1", "messages": messages,
               "latest_allowed_event_id": prefix["latest_allowed_event_id"],
               "feature_hash": prefix["feature_hash"]}
    context["context_sha256"] = digest(context)
    text, spans = "", []
    for event in projected["delivered"]["events"]:
        if event["phase"] != "delivered":
            continue
        start = len(text) + (1 if text else 0)
        text += ("\n" if text else "") + event["text"]
        spans.append({"start": start, "end": len(text), "event_id": event["native_event_id"],
                      "event_hash": owner.events[event["native_event_id"]]["hash"], "kind": event["kind"]})
    step = owner.events[capture["event_id"]]["payload"]
    count = sum(m.get("role") == "assistant" for m in step["messages"][step["message_start_index"]:])
    return context, {"text": text, "spans": spans, "feature_hash": delivered["feature_hash"],
                     "latest_allowed_event_id": delivered["latest_allowed_event_id"]}, count


def prepare_rewards(episodes, captures, reviews, splits, config, spec, classify):
    """Classify admitted actions, or reconstruct them from saved classifier outputs.

    Each grade 0/1/2 maps to -scale/0/+scale. Unknown stays missing. This is
    an immediate, zero-baseline action signal, not a predicted learning outcome.
    The callback is a trusted model/probe adapter; hashes establish provenance,
    not the semantic truth of its judgments or calibration quality.
    """
    base.validate_config(config)
    validate_spec(spec, config)
    base.need(1 <= len(episodes) <= 8, "bounded_contextual_episodes")
    bundle = nt.build_exports(episodes, captures, reviews)
    families = base.validate_splits(bundle, splits)
    protected, suite_pins = protected_benchmark_families()
    protected.update(spec["excluded_family_aliases"])
    protected |= {"family:" + alias for alias in list(protected)}
    excluded = spec["excluded_sources"]
    owners = {(ep["id"], ep["branch_id"]): nt.validate_episode(ep) for ep in episodes}
    episode_map = {(ep["id"], ep["branch_id"]): ep for ep in episodes}
    for entry in families.values():
        if entry["split"] == "train":
            base.need(not set(entry["aliases"]) & protected, "protected_contextual_reward_family")
            base.need(not any(s["record_sha256"] == h["record_sha256"] or
                               (s["dataset"], s["record_id"]) == (h["dataset"], h["record_id"])
                               for s in entry["sources"] for h in excluded), "protected_contextual_reward_source")
    policy = {r["segment"]["capture_hash"]: r for r in bundle["policy_segments"]}
    captured = {c["capture_hash"]: c for c in captures["captures"]}
    reviewed = {r["capture_hash"]: r for r in reviews["reviews"] if r["kind"] == "segment"}
    base.need(len(config["capture_hashes"]) <= 96, "bounded_contextual_actions")
    classifier = spec["classifier"]
    identity = lambda name: name.strip().casefold().rsplit("/", 1)[-1]
    records, signals = [], []
    # Admit the complete batch before the first classifier call.
    selected = []
    for key in config["capture_hashes"]:
        base.need(key in policy and key in captured and key in reviewed, "missing_contextual_policy_capture")
        row, capture, review = policy[key], captured[key], reviewed[key]
        ep = episode_map[(capture["episode_id"], capture["branch_id"])]
        base.need(families[ep["family"]]["split"] == "train", "nontraining_contextual_family")
        ppo_config = {**config, "method": "ppo"}
        base.validate_segment(row, next(e for e in bundle["episodes"] if
                              (e["id"], e["branch_id"]) == (ep["id"], ep["branch_id"])), ppo_config, policy=True)
        base.need(identity(classifier["id"]) not in {identity(config["model"]["id"]),
                  identity(ep["learner_policy"]["model"])}, "independent_contextual_classifier_required")
        owner = owners[(ep["id"], ep["branch_id"])]
        context, response, actor_count = _action_view(owner, capture)
        selected.append((key, row, review, context, response, actor_count))
    for key, row, review, context, response, actor_count in selected:
        record = {"capture_hash": key, "context": context, "response": response,
                  "need": None, "reaction": None, "score": None, "reward": None, "abstention": None}
        if actor_count != 1:
            record["abstention"] = "ambiguous_multi_action_delivery"
        elif not response["text"] or not any(m["role"] == "user" for m in context["messages"]):
            record["abstention"] = "missing_visible_context_or_action"
        else:
            request = {"protocol": grading.PROTOCOL, "system": grading.SYSTEM, "stage": "need", "input": context}
            need = classify(deepcopy(request))
            grading.validate_need(need, context)
            record.update(need=deepcopy(need), need_request_sha256=digest(request), need_output_sha256=digest(need))
            request = {"protocol": grading.PROTOCOL, "system": grading.SYSTEM, "stage": "reaction",
                       "input": {"context": context, "need": need, "response": response["text"],
                                 "reference": {}, "delivered_spans": response["spans"]}}
            reaction = classify(deepcopy(request))
            grading.validate_reaction(reaction, response)
            score = grading.response_score(need, reaction, classifier["minimum_confidence"])
            record.update(reaction=deepcopy(reaction), reaction_request_sha256=digest(request),
                          reaction_output_sha256=digest(reaction), score=score,
                          reward=None if score is None else spec["reward_scale"] * (score - 1))
            if score is None:
                record["abstention"] = "unknown_contextual_judgment"
            elif classifier["kind"] == "fixture" or classifier["calibration_sha256"] is None:
                record["abstention"] = "fixture_or_uncalibrated_classifier"
            elif not review["accepted"] and record["reward"] >= 0:
                record["abstention"] = "rejected_action_requires_negative_advantage"
        record["record_hash"] = digest(record)
        records.append(record)
        if record["abstention"] is None:
            signals.append({"capture_hash": key, "review": deepcopy(review), "action_advantage": record["reward"],
                "advantage_provenance": {"unit": "action_advantage", "aggregation": NORMALIZATION,
                    "estimator_revision": VERSION, "baseline_revision": "fixed-zero/immediate/v1",
                    "source_revision": source_pins()[Path(__file__).name], "horizon_actions": 1, "discount": 0,
                    "review_hash": review["review_hash"], "feature_hash": review["evidence_hash"],
                    "spec_hash": spec["spec_hash"], "classifier_sha256": digest(classifier),
                    "contextual_record_hash": record["record_hash"]}})
    missing = [r["capture_hash"] for r in records if r["abstention"]]
    envelope = None if missing else nt.seal({"schema_version": 1, "kind": FEATURE_VERSION,
        "export_hash": bundle["export_hash"], "signals": signals}, "features_hash")
    return nt.seal({"kind": VERSION, "spec": deepcopy(spec), "export_hash": bundle["export_hash"],
        "split_hash": splits["split_hash"], "config_hash": config["config_hash"],
        "source_pins": source_pins(), "protected_suite_hashes": suite_pins, "records": records,
        "selected_abstentions": missing, "feature_signals": envelope,
        "training_executed": False, "learning_outcome": None}, "audit_hash")


def consume_rewards(episodes, captures, reviews, splits, config, audit):
    """Rebuild all projections and arithmetic before passing scalars to training."""
    base.sealed(audit, "audit_hash")
    outputs = iter([v for r in audit["records"] if r["need"] is not None for v in (r["need"], r["reaction"])])
    try:
        rebuilt = prepare_rewards(episodes, captures, reviews, splits, config, audit["spec"], lambda _: next(outputs))
    except StopIteration as exc:
        raise base.UpdateError("missing_contextual_classifier_output") from exc
    base.need(rebuilt == audit, "contextual_reward_reconstruction_mismatch")
    base.need(rebuilt["feature_signals"] is not None, "contextual_reward_abstention")
    return rebuilt["feature_signals"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode", type=Path, action="append", required=True)
    for name in ("captures", "reviews", "splits", "base-config", "spec", "classifier-config", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args(argv)
    base.need(not args.output.exists(), "new_contextual_output_required")
    spec, adapter = nt.load_json(args.spec), nt.load_json(args.classifier_config)
    base.need(adapter["classifier"] == spec["classifier"], "contextual_adapter_pin")
    report = prepare_rewards([nt.load_json(p) for p in args.episode], nt.load_json(args.captures),
        nt.load_json(args.reviews), nt.load_json(args.splits), nt.load_json(args.base_config), spec,
        grading.command_classifier(adapter))
    base.write_private(args.output, report)
    print(nt.native_json({"status": "classified_no_training", "audit_hash": report["audit_hash"],
                         "actions": len(report["records"]), "abstentions": len(report["selected_abstentions"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
