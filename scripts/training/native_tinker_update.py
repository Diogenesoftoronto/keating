# /// script
# requires-python = ">=3.11"
# dependencies = ["tinker==0.27.1"]
# ///
"""One bounded update from validated native exports; planning is network-free.

Never reconstruct original tokens or sampler probabilities. See the schema and
trust boundaries in docs/native-tinker-update.md. No old PilotBudget dependency.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import fcntl
import hashlib
import importlib.metadata
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from contextlib import contextmanager

import native_training as nt
from sdpo_math import prepare_advantages

VERSION = "native-tinker-update/v1"
SDK_VERSION = "0.27.1"
SDK_SOURCE_HASHES = {
    "tinker/lib/public_interfaces/service_client.py": "cd54efc12ce8982f26a49a9bab67e14db6606a5ca7681c6671ef77ab319e0efe",
    "tinker/lib/public_interfaces/training_client.py": "92a0b666a1006fe648e985c85c71e63d8eedaa114b0e91167ae14a029bbf31d6",
    "tinker/lib/internal_client_holder.py": "b74b910177bdc9724707d7e8a8496fb805c07c86baaf0fb68a740c020013e785",
}
BUDGET_KIND = "native-research-budget/v1"
CONDITIONING = "original_context_then_feedback_then_original_completion"
REF_KEYS = ("episode_id", "branch_id", "family", "event_id", "event_hash", "payload_hash")


class UpdateError(ValueError):
    """Invalid or unavailable input. Messages contain codes, never credentials."""


def need(condition, code):
    if not condition:
        raise UpdateError(code)


def sealed(value, field):
    need(type(value) is dict and value.get(field) == nt.native_hash(
        {k: v for k, v in value.items() if k != field}), "invalid_" + field)


def text(value):
    return type(value) is str and bool(value.strip())


def digest(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def tokens(value):
    return type(value) is list and bool(value) and all(type(v) is int and 0 <= v < 2**31 for v in value)


def logprobs(value, count):
    need(type(value) is list and len(value) == count and all(number(v, -1e6, 0) for v in value),
         "logprob_alignment_or_value")
    return value


def dollars(value):
    need(type(value) is str and re.fullmatch(r"[0-9]+(?:\.[0-9]{1,8})?", value) is not None, "decimal_usd_string_required")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise UpdateError("invalid_usd") from None
    need(result.is_finite() and 0 <= result <= Decimal("1000000"), "invalid_usd")
    return result


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def checkpoint(value, kind="weights"):
    # Hosted training-run IDs include a session suffix, e.g. UUID:train:0.
    # This is an opaque Tinker identifier, not an HTTP hostname/port.
    return type(value) is str and kind in {"weights", "sampler_weights"} and re.fullmatch(
        r"tinker://[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/" + kind + r"/[A-Za-z0-9_.-]+", value) is not None


def validate_config(config):
    sealed(config, "config_hash")
    need(config.get("schema_version") == 1 and config.get("method") in {"sft", "ppo", "sdpo"}, "config_schema")
    model, tokenizer = config.get("model", {}), config.get("tokenizer", {})
    need(model.get("provider") == "tinker" and text(model.get("id"))
         and checkpoint(model.get("revision")), "immutable_initial_training_checkpoint_required")
    # Older configs already pin an explicit project_id. Account Default must be
    # selected deliberately; absent selection never authorizes an ambient project.
    selection = config.get("project_selection", "explicit")
    project_id = config.get("project_id")
    need((selection == "account_default" and project_id is None)
         or (selection == "explicit" and type(project_id) is str
             and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", project_id)), "explicit_project_selection_required")
    need(all(text(tokenizer.get(k)) for k in ("id", "revision"))
         and digest(tokenizer.get("chat_template_hash")), "project_tokenizer_pin_required")
    selected = config.get("capture_hashes")
    need(type(selected) is list and 1 <= len(selected) <= 8 and all(digest(v) for v in selected)
         and len(set(selected)) == len(selected), "select_one_to_eight_unique_captures")
    revisions = config.get("allowed_behavior_revisions")
    need(type(revisions) is list and revisions and all(text(v) for v in revisions), "behavior_revision_allowlist_required")
    need(number(config.get("learning_rate"), 1e-8, 1e-3)
         and number(config.get("epsilon"), 0.01, 0.3)
         and number(config.get("max_abs_log_ratio"), 0.01, 10)
         and number(config.get("advantage_cap"), 0.01, 100), "bounded_update_settings_required")
    need(type(config.get("ttl_seconds")) is int and 60 <= config["ttl_seconds"] <= 86400
         and type(config.get("timeout_seconds")) is int and 1 <= config["timeout_seconds"] <= 600, "bounded_lifetime_required")
    rates = config.get("rates", {})
    need(rates.get("model_id") == model["id"] and text(rates.get("source"))
         and type(rates.get("verified_on")) is str
         and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rates["verified_on"]) is not None, "model_rate_provenance_required")
    for field in ("prefill_usd_per_million", "train_usd_per_million", "fixed_usd"):
        need(dollars(rates.get(field)) > 0, "positive_rate_and_fixed_reserve_required")
    need(number(rates.get("safety_factor"), 1, 100), "safety_factor_required")


def validate_splits(bundle, manifest):
    """Check externally approved family/source assignment pinned to this export.

    This is an admission attestation, not an inferred split or a licensing grant.
    Every known alias/source record must stay in one family and one split.
    """
    sealed(manifest, "split_hash")
    need(manifest.get("schema_version") == 1 and manifest.get("export_hash") == bundle["export_hash"]
         and text(manifest.get("registry_revision")) and text(manifest.get("approved_by")), "split_export_pin")
    entries = manifest.get("families")
    need(type(entries) is list and entries, "family_registry_required")
    families, aliases, sources = {}, {}, {}
    for entry in entries:
        family, split = entry.get("family"), entry.get("split")
        need(text(family) and family not in families and split in {"train", "validation", "test", "reference"}
             and type(entry.get("protected")) is bool, "family_identity_or_split")
        ids = entry.get("aliases")
        need(type(ids) is list and family in ids and all(text(a) for a in ids)
             and len(set(ids)) == len(ids), "family_aliases_required")
        for alias in ids:
            need(alias not in aliases, "cross_family_alias_leakage")
            aliases[alias] = family
        members = entry.get("sources")
        need(type(members) is list and members, "source_provenance_required")
        for member in members:
            need(all(text(member.get(k)) for k in ("dataset", "revision", "record_id", "original_split"))
                 and digest(member.get("record_sha256")), "source_record_pin_required")
            # Revision changes and renamed IDs cannot put the same source text
            # into train and holdout. Family aliases catch known reformulations.
            for identity in ((member["dataset"], member["record_id"]), ("sha256", member["record_sha256"])):
                need(identity not in sources or sources[identity] == family, "cross_family_source_leakage")
                sources[identity] = family
            if split == "train":
                need(member["original_split"] == "train", "protected_source_split")
        need(split != "train" or not entry["protected"], "protected_family")
        families[family] = entry
    proofs = manifest.get("episodes")
    need(type(proofs) is list and nt.native_hash(proofs) == nt.native_hash(bundle["episodes"]), "episode_split_binding")
    need(all(e.get("family") in families for e in proofs), "unregistered_episode_family")
    return families


def validate_segment(row, episode, config, *, policy=False):
    if policy:
        need(config["method"] == "ppo" and row.get("review_decision") in {"accepted", "rejected"}, "policy_review_decision_required")
    else:
        need(row.get("review_decision", "accepted") == "accepted", "sft_projection_must_be_accepted")
    need(row.get("status") == "available" and row.get("training_eligible") is True
         and episode.get("measurement") == "model_episode", "unavailable_or_fixture_capture")
    need(all(text(row.get(k)) for k in REF_KEYS[:4]) and all(digest(row.get(k)) for k in REF_KEYS[4:])
         and digest(row.get("review_hash")), "review_and_runtime_pin_required")
    segment = row.get("segment", {})
    prompt, completion = segment.get("prompt_token_ids"), segment.get("completion_token_ids")
    need(tokens(prompt) and tokens(completion), "original_actor_token_capture_required")
    need(len(prompt) + len(completion) <= 32768, "segment_token_limit")
    roles = segment.get("completion_token_roles")
    need(type(roles) is list and len(roles) == len(completion)
         and all(r in {"assistant_text", "assistant_tool_call"} for r in roles), "non_actor_targets")
    mask = [0] * (len(prompt) - 1) + [1] * len(completion)
    need(segment.get("input_tokens") == (prompt + completion)[:-1]
         and segment.get("target_tokens") == (prompt + completion)[1:]
         and segment.get("loss_mask") == mask
         and all(type(v) is int for v in segment["loss_mask"]), "causal_alignment_mask")
    source, actor, sampler = (segment.get(k, {}) for k in ("capture_source", "actor", "sampler"))
    need(source.get("kind") == "provider_capture" and source.get("recorded_at_generation") is True
         and all(text(source.get(k)) for k in ("request_id", "response_id", "recorder_revision", "captured_at")), "generation_provenance_required")
    need(actor.get("provider") == "tinker" and actor.get("id") == config["model"]["id"]
         and actor.get("revision") in config["allowed_behavior_revisions"], "behavior_model_mismatch")
    need(segment.get("tokenizer") == config["tokenizer"] and all(digest(segment.get(k)) for k in
         ("capture_hash", "context_hash", "request_hash")), "tokenizer_or_request_mismatch")
    need(sampler.get("distribution") == "actual_sampler" and sampler.get("all_generation_transforms_recorded") is True
         and type(sampler.get("settings")) is dict, "actual_sampler_required")
    settings = sampler["settings"]
    need(number(settings.get("temperature"), 1e-6, 100) and number(settings.get("top_p"), 1e-6, 1), "sampler_settings")
    behavior = segment.get("behavior_logprobs")
    if behavior is not None:
        logprobs(behavior, len(completion))
    need(config["method"] == "sft" or behavior is not None, "missing_original_behavior_logprobs")
    return segment


def validate_signal(row, signal, features, config, *, policy=False):
    """Admit independent feedback and an externally rendered teacher prefix."""
    segment = row["segment"]
    need(signal.get("capture_hash") == segment["capture_hash"], "signal_capture_pin")
    review = signal.get("review", {})
    sealed(review, "review_hash")
    need(review.get("review_hash") == row["review_hash"] and review.get("capture_hash") == segment["capture_hash"]
         and review.get("independent") is True and type(review.get("accepted")) is bool
         and review.get("kind") == "segment" and text(review.get("rubric_revision"))
         and all(review.get(k) == row[k] for k in REF_KEYS), "independent_review_required")
    decision = row["review_decision"] if policy else "accepted"
    need(review["accepted"] is (decision == "accepted"), "independent_review_decision_mismatch")
    need(review["accepted"] or (policy and config["method"] == "ppo"), "independent_accepted_review_required")
    reviewer = review.get("reviewer", {})
    need(reviewer.get("kind") in {"human", "independent_model"} and text(reviewer.get("id")), "independent_reviewer_required")
    if reviewer["kind"] == "independent_model":
        need(text(reviewer.get("model", {}).get("id")) and reviewer["model"]["id"] != config["model"]["id"], "self_review")
    feature = features.get(review.get("evidence_hash"))
    need(feature is not None and feature.get("boundary") == review.get("boundary")
         and feature.get("latest_allowed_event_id") == review.get("latest_allowed_event_id")
         and all(feature.get(k) == row[k] for k in REF_KEYS), "review_temporal_boundary")
    if config["method"] == "ppo":
        values = signal.get("advantages")
        need(type(values) is list and len(values) == len(segment["completion_token_ids"])
             and all(number(v, -config["advantage_cap"], config["advantage_cap"]) for v in values), "independent_advantages_required")
        if decision == "rejected":
            need(all(v <= 0 for v in values) and any(v < 0 for v in values), "rejected_action_requires_negative_advantages")
        provenance = signal.get("advantage_provenance", {})
        need(provenance.get("review_hash") == review["review_hash"]
             and provenance.get("feature_hash") == feature["feature_hash"]
             and all(text(provenance.get(k)) for k in ("estimator_revision", "baseline_revision", "aggregation")), "advantage_provenance_required")
        return {"advantages": values, "review_hash": review["review_hash"], "review": review,
                "review_decision": decision, "provenance": provenance,
                "kind": "independent_behavioral_review_advantages"}
    need(feature["boundary"] == "retrospective", "retrospective_feedback_required")
    packet = nt.feedback_packet(feature, review)
    prefix = signal.get("teacher_prefix", {})
    sealed(prefix, "prefix_hash")
    need(tokens(prefix.get("prompt_token_ids")) and prefix.get("tokenizer") == segment["tokenizer"]
         and prefix.get("original_request_hash") == segment["request_hash"]
         and prefix.get("feedback_hash") == packet["feedback_hash"]
         and prefix.get("conditioning") == CONDITIONING
         and all(text(prefix.get("renderer", {}).get(k)) for k in ("id", "revision")), "teacher_prefix_provenance")
    need(prefix.get("completion_token_ids") == segment["completion_token_ids"], "teacher_target_alignment")
    need(len(prefix["prompt_token_ids"]) + len(prefix["completion_token_ids"]) <= 32768, "teacher_context_limit")
    return {"feedback": packet, "teacher_prefix": prefix}


def prepare_update(bundle, manifest, config, signals=None):
    """Pure notebook/CLI entry point. Returns a sealed, fully validated plan."""
    bundle, manifest, config, signals = deepcopy((bundle, manifest, config, signals))
    sealed(bundle, "export_hash")
    need(bundle.get("schema_version") == 1 and type(bundle.get("episodes")) is list
         and type(bundle.get("sft")) is list and type(bundle.get("observer_inputs")) is list, "native_export_schema")
    validate_config(config)
    need("policy_segments" not in bundle or type(bundle["policy_segments"]) is list, "policy_segments_schema")
    policy = config["method"] == "ppo" and "policy_segments" in bundle
    projection = "policy_segments" if policy else "sft"
    families = validate_splits(bundle, manifest)
    episodes = {(e.get("id"), e.get("branch_id")): e for e in bundle["episodes"]}
    need(len(episodes) == len(bundle["episodes"]), "duplicate_episode")
    candidates = {}
    for row in bundle[projection]:
        need(type(row) is dict, "invalid_segment_record")
        key = row.get("segment", {}).get("capture_hash")
        need(digest(key) and key not in candidates, "duplicate_or_missing_capture")
        candidates[key] = row
    features = {}
    for feature in bundle["observer_inputs"]:
        sealed(feature, "feature_hash")
        need(feature.get("outcome") is None and feature.get("outcome_status") == "unknown", "unexpected_assessment_contract")
        features[feature["feature_hash"]] = feature
    signal_map = {}
    if signals is not None:
        sealed(signals, "signals_hash")
        need(signals.get("schema_version") == 1 and signals.get("export_hash") == bundle["export_hash"]
             and type(signals.get("signals")) is list, "signals_export_pin")
        for signal in signals["signals"]:
            key = signal.get("capture_hash")
            need(digest(key) and key not in signal_map, "duplicate_signal")
            signal_map[key] = signal
    rows = []
    for key in config["capture_hashes"]:
        row = candidates.get(key)
        need(row is not None, "missing_reviewed_policy_capture_export" if policy else "missing_accepted_capture_export")
        episode = episodes.get((row.get("episode_id"), row.get("branch_id")))
        need(episode is not None and row.get("family") == episode.get("family"), "cross_branch_or_family")
        need(families[row["family"]]["split"] == "train", "nontraining_family")
        need(any(f.get("boundary") == "delivered" and all(f.get(k) == row[k] for k in REF_KEYS)
                 for f in features.values()), "missing_successful_actor_delivery")
        validate_segment(row, episode, config, policy=policy)
        item = {"record": row}
        if config["method"] != "sft":
            need(key in signal_map, "missing_independent_signal_or_teacher_prefix")
            item["signal"] = validate_signal(row, signal_map[key], features, config, policy=policy)
        rows.append(item)
    total = sum(len(r["record"]["segment"]["input_tokens"]) for r in rows)
    teacher_tokens = sum(len(r["signal"]["teacher_prefix"]["prompt_token_ids"]) +
                         len(r["record"]["segment"]["completion_token_ids"]) for r in rows) if config["method"] == "sdpo" else 0
    need(total + teacher_tokens <= 65536, "batch_token_limit")
    # Charge all forward work at the full training rate, without discounts.
    train_tokens = total * (1 if config["method"] == "sft" else 2)
    rates = config["rates"]
    raw = dollars(rates["fixed_usd"]) + (Decimal(train_tokens) * dollars(rates["train_usd_per_million"])
          + Decimal(teacher_tokens) * dollars(rates["prefill_usd_per_million"])) / Decimal(1000000)
    reserve = (raw * Decimal(str(rates["safety_factor"]))).quantize(Decimal("0.000001"), rounding=ROUND_CEILING)
    phases = ["create_service", "create_trainer", "get_info"]
    if config["method"] == "sdpo":
        phases += ["freeze_teacher", "create_teacher"] + [f"teacher_score_{i}" for i in range(len(rows))]
    if config["method"] != "sft":
        phases += ["student_forward"]
    phases += ["forward_backward", "optimizer", "save_state", "save_sampler"]
    return nt.seal({"schema_version": 1, "consumer": VERSION, "config": config,
        "projection": projection, "sdk_source_hashes": dict(SDK_SOURCE_HASHES),
        "submission_retry_policy": "single_attempt_per_holder",
        "export_hash": bundle["export_hash"], "split_hash": manifest["split_hash"],
        "signals_hash": signals["signals_hash"] if signals else None, "rows": rows,
        "cost": {"reserved_usd": str(reserve), "train_token_allowance": train_tokens,
                 "teacher_prefill_tokens": teacher_tokens, "rates": rates,
                 "accounting": "local pessimistic reservation; not an invoice or provider spending limit"},
        "phases": phases, "updates": 1, "normalization": "mean_of_action_completion_means",
        "optimizer_state": "reset_from_pinned_weights", "assessment": None}, "plan_hash")


def write_private(path, value):
    """Atomic private output; caller decides whether replacement is allowed."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="." + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(nt.native_json(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class BudgetLedger:
    """Independent project/model cap. Reservations never auto-refund on errors."""
    def __init__(self, path, project, model, cap):
        self.path, self.project, self.model = Path(path), project, model
        self.cap = str(dollars(cap))
        need(dollars(cap) > 0, "positive_cap_required")

    @contextmanager
    def locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(str(self.path) + ".lock", "a", opener=lambda p, flags: os.open(p, flags, 0o600)) as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            if self.path.exists():
                ledger = nt.load_json(self.path)
                sealed(ledger, "ledger_hash")
                need(ledger.get("kind") == BUDGET_KIND and ledger.get("project_id") == self.project
                     and ledger.get("model_id") == self.model and ledger.get("cap_usd") == self.cap
                     and type(ledger.get("runs")) is dict, "budget_identity_or_cap_mismatch")
            else:
                ledger = {"kind": BUDGET_KIND, "project_id": self.project,
                          "model_id": self.model, "cap_usd": self.cap, "runs": {}}
            yield ledger
            write_private(self.path, nt.seal(ledger, "ledger_hash"))

    def reserve(self, plan):
        sealed(plan, "plan_hash")
        need(type(plan.get("phases")) is list and plan["phases"]
             and all(text(p) for p in plan["phases"]) and len(set(plan["phases"])) == len(plan["phases"])
             and dollars(plan.get("cost", {}).get("reserved_usd")) > 0, "bounded_reservation_plan_required")
        key = plan["plan_hash"]
        with self.locked() as ledger:
            need(key not in ledger["runs"], "duplicate_plan_no_automatic_retry")
            held = sum((dollars(r["reserved_usd"]) for r in ledger["runs"].values()), Decimal(0))
            need(held + dollars(plan["cost"]["reserved_usd"]) <= dollars(self.cap), "budget_cap_exceeded_before_dispatch")
            ledger["runs"][key] = {"reserved_usd": plan["cost"]["reserved_usd"], "status": "reserved",
                "phases": plan["phases"], "dispatched": [], "optimizer_acknowledged": False, "reserved_at": timestamp()}

    def before(self, plan, phase):
        sealed(plan, "plan_hash")
        with self.locked() as ledger:
            run = ledger["runs"].get(plan["plan_hash"])
            need(run is not None and run["reserved_usd"] == plan["cost"]["reserved_usd"]
                 and run["phases"] == plan["phases"]
                 and run["status"] in {"reserved", "dispatching"}, "active_reservation_required")
            need(sum((dollars(r["reserved_usd"]) for r in ledger["runs"].values()), Decimal(0)) <= dollars(self.cap), "budget_cap_exceeded")
            index = len(run["dispatched"])
            need(index < len(run["phases"]) and phase == run["phases"][index], "duplicate_or_unplanned_dispatch")
            run["status"] = "dispatching"
            run["dispatched"].append(phase)

    def mark(self, plan, **fields):
        sealed(plan, "plan_hash")
        need(set(fields) <= {"status", "optimizer_acknowledged"}, "unsupported_budget_transition")
        need("status" not in fields or fields["status"] in {"complete", "failed_unknown"}, "unsupported_budget_status")
        need("optimizer_acknowledged" not in fields or type(fields["optimizer_acknowledged"]) is bool, "invalid_optimizer_ack")
        with self.locked() as ledger:
            run = ledger["runs"][plan["plan_hash"]]
            need(fields.get("status") != "complete" or run["dispatched"] == run["phases"], "incomplete_budget_dispatch")
            need(not fields.get("optimizer_acknowledged") or "optimizer" in run["dispatched"], "optimizer_not_dispatched")
            need(not run["optimizer_acknowledged"] or fields.get("optimizer_acknowledged", True), "cannot_erase_optimizer_ack")
            run.update(fields)


def datum(sdk, segment, batch_size, advantages=None):
    count = len(segment["completion_token_ids"])
    scale = count * batch_size
    inputs = {"target_tokens": sdk.TensorData(data=segment["target_tokens"], dtype="int64")}
    if advantages is None:
        inputs["weights"] = sdk.TensorData(data=[v / scale for v in segment["loss_mask"]], dtype="float32")
    else:
        padding = [0.0] * (len(segment["prompt_token_ids"]) - 1)
        inputs["logprobs"] = sdk.TensorData(data=padding + segment["behavior_logprobs"], dtype="float32")
        inputs["advantages"] = sdk.TensorData(data=padding + [v / scale for v in advantages], dtype="float32")
    return sdk.Datum(model_input=sdk.ModelInput.from_ints(segment["input_tokens"]), loss_fn_inputs=inputs)


def completion_scores(output, rows):
    need(len(output.loss_fn_outputs) == len(rows), "student_batch_alignment")
    result = []
    for row, item in zip(rows, output.loss_fn_outputs):
        segment = row["record"]["segment"]
        values = list(item["logprobs"].data)
        need(len(values) == len(segment["target_tokens"]), "student_target_alignment")
        logprobs(values, len(segment["target_tokens"]))
        result.append(logprobs(values[len(segment["prompt_token_ids"]) - 1:], len(segment["completion_token_ids"])))
    return result


def audit_sdk():
    """Verify the installed implementation of the private retry seam offline."""
    distribution = importlib.metadata.distribution("tinker")
    need(distribution.version == SDK_VERSION, "pinned_tinker_sdk_required")
    for relative, expected in SDK_SOURCE_HASHES.items():
        need(hashlib.sha256(Path(distribution.locate_file(relative)).read_bytes()).hexdigest() == expected,
             "pinned_tinker_sdk_source_required")


async def _single_attempt(operation, *args, **kwargs):
    return await operation(*args, **kwargs)


def disable_internal_retries(client):
    """Instance-only 0.27.1 seam, installed BEFORE create/load of weights.

    ServiceClient's holder is also used by its trainer. This covers load, gradient,
    optimizer and save submission loops above HTTP; future polling remains intact.
    Kept here to avoid importing bootstrap, which imports this budget module.
    Never patch SDK classes globally or restore retries while a future is pending.
    """
    holder = client.holder
    need(callable(getattr(holder, "execute_with_retries", None)), "sdk_retry_boundary_missing")
    holder.execute_with_retries = _single_attempt
    return holder


def execute_update(bundle, manifest, config, signals, *, budget_path, cap_usd, output_dir,
                   sdk=None, service_factory=None, retry_config_factory=None):
    """Revalidate raw inputs immediately before reservation. No API accepts a
    caller-forged precomputed plan. Dependency injection is for offline tests.
    """
    plan = prepare_update(bundle, manifest, config, signals)
    config, rows = plan["config"], plan["rows"]
    output = Path(output_dir)
    need(not output.exists(), "new_output_directory_required")
    selection = config.get("project_selection", "explicit")
    need(selection != "account_default" or not os.environ.get("TINKER_PROJECT_ID"),
         "account_default_requires_unset_TINKER_PROJECT_ID")
    project = {"project_id": config["project_id"]} if selection == "explicit" else {}
    ledger = BudgetLedger(budget_path, config.get("project_id") or "account-default", config["model"]["id"], cap_usd)
    # Explicit route: env only. No default SDK credentials, keyring or logging.
    if service_factory is None:
        need(text(os.environ.get("TINKER_API_KEY")), "TINKER_API_KEY_required")
        try:
            installed_version = importlib.metadata.version("tinker")
        except importlib.metadata.PackageNotFoundError:
            raise UpdateError("pinned_tinker_sdk_required") from None
        need(installed_version == SDK_VERSION, "pinned_tinker_sdk_required")
    if sdk is None:
        audit_sdk()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    write_private(output / "plan.json", plan)
    ledger.reserve(plan)  # must finish before SDK/client/trainer/forward creation
    report = {"schema_version": 1, "consumer": VERSION, "plan_hash": plan["plan_hash"],
              "export_hash": plan["export_hash"], "status": "reserved", "optimizer_acknowledged": False,
              "project_selection": selection, "project_id": config.get("project_id"),
              "projection": plan["projection"], "submission_retry_policy": plan["submission_retry_policy"],
              "teacher_captures": [], "score_records": [], "assessment": None, "assessment_status": "unknown"}
    timeout = config["timeout_seconds"]

    def call(phase, operation, future=False):
        ledger.before(plan, phase)
        report["last_dispatched"] = phase
        write_private(output / "result.json", report)
        result = operation()
        return result.result(timeout=timeout) if future else result

    try:
        if sdk is None:
            import tinker as sdk  # deferred: no heavy imports/credentials in plan mode
        if retry_config_factory is None:
            from tinker.lib.retry_handler import RetryConfig
            retry_config_factory = RetryConfig
        service = call("create_service", lambda: service_factory() if service_factory else sdk.ServiceClient(
            api_key=os.environ["TINKER_API_KEY"], **project, max_retries=0, timeout=timeout))
        holder = disable_internal_retries(service)
        trainer = call("create_trainer", lambda: service.create_training_client_from_state(config["model"]["revision"],
            base_model=config["model"]["id"], user_metadata={"native_plan_hash": plan["plan_hash"]}))
        need(trainer.holder is holder, "unexpected_training_holder")
        info = call("get_info", trainer.get_info)
        need(info.model_data.model_name == config["model"]["id"]
             and info.model_data.tokenizer_id == config["tokenizer"]["id"], "server_model_or_tokenizer_mismatch")
        report["training_client_id"] = info.model_id
        teacher_scores = []
        name = "native-" + plan["plan_hash"][:24]
        if config["method"] == "sdpo":
            frozen = call("freeze_teacher", lambda: trainer.save_weights_for_sampler(name + "-teacher", ttl_seconds=config["ttl_seconds"]), True)
            need(checkpoint(frozen.path, "sampler_weights"), "invalid_teacher_checkpoint")
            teacher_model = {**config["model"], "revision": frozen.path}
            report["teacher_model"] = teacher_model
            teacher = call("create_teacher", lambda: service.create_sampling_client(model_path=frozen.path,
                retry_config=retry_config_factory(enable_retry_logic=False)))
            for index, item in enumerate(rows):
                segment, signal = item["record"]["segment"], item["signal"]
                prefix = signal["teacher_prefix"]["prompt_token_ids"]
                target = segment["completion_token_ids"]
                request = nt.teacher_request(segment, signal["feedback"], teacher_model, prefix)
                raw = call(f"teacher_score_{index}", lambda: teacher.compute_logprobs(sdk.ModelInput.from_ints(prefix + target)), True)
                need(len(raw) == len(prefix) + len(target), "teacher_sequence_alignment")
                scores = logprobs(list(raw[len(prefix):]), len(target))
                teacher_scores.append(scores)
                # compute_logprobs exposes values, not provider request/response
                # IDs. These are explicitly local operation IDs, never forged
                # provider capture IDs or a native_training teacher_captures file.
                report["teacher_captures"].append({"capture_hash": segment["capture_hash"], "model": teacher_model,
                    "scoring_request_hash": nt.native_hash(request), "request": request,
                    "completion_logprobs": scores, "recorded_at_scoring": True, "frozen": True,
                    "local_operation_id": f'{plan["plan_hash"]}:teacher_score_{index}',
                    "provider_request_id": None, "provider_response_id": None, "captured_at": timestamp(),
                    "recorder_revision": VERSION, "feedback": signal["feedback"]})
        batch = [datum(sdk, item["record"]["segment"], len(rows)) for item in rows]
        current_scores, advantages = None, None
        if config["method"] != "sft":
            forward = call("student_forward", lambda: trainer.forward(batch, loss_fn="cross_entropy"), True)
            current_scores = completion_scores(forward, rows)
            advantages = []
            for index, (item, current) in enumerate(zip(rows, current_scores)):
                segment = item["record"]["segment"]
                behavior = segment["behavior_logprobs"]
                need(max(abs(c - b) for c, b in zip(current, behavior)) <= config["max_abs_log_ratio"], "stale_behavior_batch_rejected")
                if config["method"] == "sdpo":
                    values, _, stats = prepare_advantages(teacher_scores[index], current)
                    values = [max(-config["advantage_cap"], min(config["advantage_cap"], v)) for v in values]
                else:
                    values, stats = item["signal"]["advantages"], None
                advantages.append(values)
                report["score_records"].append({"capture_hash": segment["capture_hash"], "student_model": config["model"],
                    "behavior_model": segment["actor"], "sampler": segment["sampler"], "tokenizer": segment["tokenizer"],
                    "completion_token_ids": segment["completion_token_ids"], "student_logprobs": current,
                    "behavior_logprobs": behavior, "detached_advantages": values, "advantage_metrics": stats,
                    **({"review_decision": item["signal"]["review_decision"], "review_hash": item["signal"]["review_hash"],
                        "advantage_provenance": item["signal"]["provenance"],
                        "signal_kind": item["signal"]["kind"]} if config["method"] == "ppo" else {})})
            batch = [datum(sdk, item["record"]["segment"], len(rows), a) for item, a in zip(rows, advantages)]
        loss = "cross_entropy" if config["method"] == "sft" else "ppo"
        kwargs = {} if loss == "cross_entropy" else {"loss_fn_config": {
            "clip_low_threshold": 1 - config["epsilon"], "clip_high_threshold": 1 + config["epsilon"]}}
        backward = call("forward_backward", lambda: trainer.forward_backward(batch, loss_fn=loss, **kwargs), True)
        scored_again = completion_scores(backward, rows)
        need(type(backward.metrics) is dict and all(number(v, -1e300, 1e300) for v in backward.metrics.values()), "nonfinite_training_metrics")
        if current_scores is not None:
            need(all(abs(a - b) <= 1e-4 for x, y in zip(current_scores, scored_again) for a, b in zip(x, y)), "student_changed_between_scoring_and_backward")
        report["loss_metrics"] = backward.metrics
        call("optimizer", lambda: trainer.optim_step(sdk.AdamParams(learning_rate=config["learning_rate"],
             beta1=0.9, beta2=0.95, eps=1e-8, weight_decay=0.0, grad_clip_norm=1.0)), True)
        report["optimizer_acknowledged"] = True
        ledger.mark(plan, optimizer_acknowledged=True)
        write_private(output / "result.json", report)
        saved = call("save_state", lambda: trainer.save_state(name + "-updated", ttl_seconds=config["ttl_seconds"]), True)
        need(checkpoint(saved.path), "invalid_saved_checkpoint")
        report["training_checkpoint"] = saved.path
        sampled = call("save_sampler", lambda: trainer.save_weights_for_sampler(name + "-updated", ttl_seconds=config["ttl_seconds"]), True)
        need(checkpoint(sampled.path, "sampler_weights"), "invalid_sampler_checkpoint")
        report.update(status="complete", sampler_checkpoint=sampled.path, completed_at=timestamp())
        ledger.mark(plan, status="complete")
    except BaseException as error:
        # A timeout is not evidence that a dispatched operation did not happen.
        report["status"] = "failed_unknown"
        report["error_code"] = str(error) if isinstance(error, UpdateError) else "provider_or_io_failure"
        ledger.mark(plan, status="failed_unknown", optimizer_acknowledged=report["optimizer_acknowledged"])
        write_private(output / "result.json", nt.seal(report, "result_hash"))
        raise UpdateError("update_failed_see_private_result_and_retained_reservation") from None
    report = nt.seal(report, "result_hash")
    write_private(output / "result.json", report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", type=Path, required=True)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--signals", type=Path)
    parser.add_argument("--execute", action="store_true", help="Spend only after reserving the full plan")
    parser.add_argument("--budget-ledger", type=Path)
    parser.add_argument("--cap-usd")
    parser.add_argument("--output", type=Path, help="NEW directory for plan/result (required for execution)")
    args = parser.parse_args(argv)
    try:
        bundle, splits, config = (nt.load_json(p) for p in (args.exports, args.splits, args.config))
        signals = nt.load_json(args.signals) if args.signals else None
        if args.execute:
            need(args.budget_ledger is not None and args.cap_usd is not None and args.output is not None,
                 "execute_requires_budget_ledger_cap_and_output")
            result = execute_update(bundle, splits, config, signals, budget_path=args.budget_ledger,
                                    cap_usd=args.cap_usd, output_dir=args.output)
            print(nt.native_json({k: result[k] for k in ("status", "optimizer_acknowledged", "plan_hash", "result_hash")}))
        else:
            plan = prepare_update(bundle, splits, config, signals)
            if args.cap_usd is not None:
                need(dollars(plan["cost"]["reserved_usd"]) <= dollars(args.cap_usd), "plan_exceeds_cap")
            if args.output:
                need(not args.output.exists(), "new_output_directory_required")
                args.output.mkdir(parents=True, mode=0o700, exist_ok=False)
                write_private(args.output / "plan.json", plan)
            print(nt.native_json({"status": "planned_no_dispatch", "plan_hash": plan["plan_hash"],
                                  "method": config["method"], "segments": len(plan["rows"]), "cost": plan["cost"]}))
        return 0
    except (UpdateError, nt.ExportError) as error:
        code = str(error)
        code = code if re.fullmatch(r"[a-z0-9_]+", code) else "invalid_evidence"
        print("native update rejected: " + code, file=sys.stderr)
        return 2
    except (OSError, KeyError, TypeError, ValueError):
        # Never echo untrusted JSON fields, secrets, provider exceptions or traces.
        print("native update rejected; validate evidence/config and inspect private result if dispatch began", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
