# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["tinker==0.27.1", "torch==2.10.0+cpu", "tinker-cookbook==0.5.7", "transformers==5.3.0", "typer>=0.12"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""A separately versioned custom-loss consumer. Default CLI only prepares a plan.

No API accepts a precomputed plan as authority. Original envelopes are rebuilt
and admitted by the existing native validators. See docs/native-custom-update.md.
"""
from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
from dataclasses import asdict
from decimal import Decimal, ROUND_CEILING
import hashlib
import importlib.metadata
import os
from pathlib import Path
import re

import native_combined_loss as loss_core
import native_training as nt
import native_tinker_update as base

VERSION = "native-custom-update/v1"
FEATURE_VERSION = "native-action-feature-advantages/v1"
HINDSIGHT_VERSION = "native-hindsight/v3"
PROJECTION_VERSION = "native-hindsight-teacher-feedback/v1"
PROJECTION_HASH = "0912a4c75f99aef1123cf5708df1b2e8f7380ce4f60a6f251bb5e2abf9bcae58"
SOURCE_PINS = {
    "native_tinker_update.py": "11dce4a7f1c7e8815838c0e0efceee61f60d0f22c663fc20d4fd527bb7e4a6cc",
    "native_combined_loss.py": "719140df07f6c6c2dd5b9c0f13427b8e37b8ee0cb643755c49e9dcf82d64214c",
    "native_hindsight.py": "7bf64a71f99da680b4f05c75c14cbefbd1616143264820fa2ec4a5793c92bb2e",
}
SDK_SOURCE_PINS = {
    **base.SDK_SOURCE_HASHES,
    "tinker/lib/public_interfaces/sampling_client.py": "86a5bb4a90cddb3528b10ea93d13bd1bf0ec7aaa7ea3072110beeeeafe1c975e",
    "tinker/lib/api_future_impl.py": "aebd8e2eddb0e0e3c4a5fcb9df1aa1bb4b7bed9b4bec8374bb494931566fc943",
    "tinker/lib/retry_handler.py": "8dba752fbf61860c53a76a61aeff950e62ecc0f01fc28b5992347a5785809abf",
    "tinker/lib/public_interfaces/api_future.py": "c1458f4648b3556857a916ee413f06dda9f0cd42953e85d89adc7e37683a0967",
}


class CustomAbstention(base.UpdateError):
    """An unavailable/zero local signal; never permission to run an optimizer."""


def audit_sources():
    for name, expected in SOURCE_PINS.items():
        base.need(hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() == expected,
                  "custom_dependency_source_pin_mismatch")


def audit_sdk():
    base.audit_sdk()
    distribution = importlib.metadata.distribution("tinker")
    for name, expected in SDK_SOURCE_PINS.items():
        base.need(hashlib.sha256(Path(distribution.locate_file(name)).read_bytes()).hexdigest() == expected,
                  "custom_sdk_source_pin_mismatch")


def validate_custom_config(config, base_config):
    base.validate_config(base_config)
    base.sealed(config, "custom_config_hash")
    base.need(set(config) == {"schema_version", "kind", "base_config_hash", "loss", "hindsight",
                             "reference", "scoring_rates", "custom_config_hash"}
              and type(config["schema_version"]) is int and config["schema_version"] == 1
              and config["kind"] == VERSION and config["base_config_hash"] == base_config["config_hash"],
              "custom_config_schema_or_base_pin")
    try:
        settings = loss_core.LossConfig(**config["loss"])
        settings.validate()
    except (TypeError, ValueError):
        raise base.UpdateError("invalid_custom_loss_settings") from None
    base.need(set(config["loss"]) == set(asdict(settings)), "all_loss_settings_must_be_explicit")
    base.need(settings.epsilon == base_config["epsilon"]
              and settings.max_abs_log_ratio == base_config["max_abs_log_ratio"]
              and max(settings.feature_cap, settings.sd_cap) <= base_config["advantage_cap"],
              "custom_settings_cannot_relax_base_bounds")
    hindsight = settings.sd_coefficient > 0
    base.need(base_config["method"] == ("sdpo" if hindsight else "ppo"), "base_method_for_custom_mode")
    base.need(config["hindsight"] == ({"producer": HINDSIGHT_VERSION, "projection": PROJECTION_VERSION,
                                      "contract_hash": PROJECTION_HASH} if hindsight else None),
              "corrected_hindsight_contract_required")
    base.need(config["reference"] == ({"kind": "initial_actor_snapshot_original_context"}
                                      if settings.anchor_coefficient else None), "reference_context_required")
    rates = config["scoring_rates"]
    if hindsight or settings.anchor_coefficient:
        base.need(type(rates) is dict and set(rates) == {"sample_usd_per_million", "model_id", "source", "verified_on"}
                  and rates["model_id"] == base_config["model"]["id"] and base.text(rates["source"])
                  and type(rates["verified_on"]) is str and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rates["verified_on"]),
                  "scoring_sample_rate_provenance_required")
        base.need(base.dollars(rates["sample_usd_per_million"]) > 0, "positive_scoring_sample_rate_required")
    else:
        base.need(rates is None, "unused_scoring_rates")
    return settings


def _feature_plan(bundle, splits, config, signals):
    """Explicit scalar-to-token projection, then the unchanged PPO validator."""
    base.sealed(signals, "features_hash")
    base.need(signals.get("schema_version") == 1 and signals.get("kind") == FEATURE_VERSION
              and signals.get("export_hash") == bundle["export_hash"]
              and type(signals.get("signals")) is list, "action_feature_envelope")
    records, projected = {}, []
    candidates = {r["segment"]["capture_hash"]: r for r in bundle.get("policy_segments", bundle["sft"])}
    for signal in signals["signals"]:
        base.need(type(signal) is dict, "action_feature_record")
        key = signal.get("capture_hash")
        base.need(key in config["capture_hashes"] and key not in records, "extra_or_duplicate_action_feature")
        base.need(key in candidates, "missing_feature_capture")
        value = signal.get("action_advantage")
        if value is None:
            raise CustomAbstention("unknown_action_feature_advantage")
        base.need(base.number(value, -config["advantage_cap"], config["advantage_cap"]), "invalid_action_feature_advantage")
        provenance = signal.get("advantage_provenance", {})
        base.need(provenance.get("unit") == "action_advantage"
                  and provenance.get("aggregation") == "per_action_completion_mean"
                  and type(provenance.get("horizon_actions")) is int and 1 <= provenance["horizon_actions"] <= 64
                  and base.number(provenance.get("discount"), 0, 1)
                  and base.text(provenance.get("source_revision")), "action_feature_estimator_contract")
        records[key] = signal
        projected.append({"capture_hash": key, "review": signal.get("review"),
                          "advantage_provenance": provenance,
                          "advantages": [value] * len(candidates[key]["segment"]["completion_token_ids"])})
    base.need(set(records) == set(config["capture_hashes"]), "missing_action_feature")
    ppo_config = nt.seal({**config, "method": "ppo"}, "config_hash")
    ppo_signals = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"], "signals": projected}, "signals_hash")
    return base.prepare_update(bundle, splits, ppo_config, ppo_signals), records


def prepare_custom_update(episodes, captures, reviews, splits, base_config, custom_config,
                          feature_signals=None, *, renderer=None):
    """Pure plan from original envelopes, not a claimed validated plan.

S modes locally rebuild Meitner's projection and prefixes. An injected renderer
is a trusted offline test seam, not an attestation of real tokenizer execution.
"""
    episodes, captures, reviews, splits, base_config, custom_config, feature_signals = deepcopy(
        (episodes, captures, reviews, splits, base_config, custom_config, feature_signals))
    audit_sources()
    settings = validate_custom_config(custom_config, base_config)
    bundle = nt.build_exports(episodes, captures, reviews)
    feature_plan, feature_map, prepared = None, {}, None
    contextual_hash = None
    if settings.feature_coefficient and type(feature_signals) is dict and feature_signals.get("kind") == "native-contextual-rewards/v1":
        import native_contextual_rewards as contextual
        contextual_hash = feature_signals["audit_hash"]
        feature_signals = contextual.consume_rewards(episodes, captures, reviews, splits, base_config, feature_signals)
    if settings.feature_coefficient:
        feature_plan, feature_map = _feature_plan(bundle, splits, base_config, feature_signals)
    else:
        base.need(feature_signals is None, "unexpected_disabled_feature_signals")
    if settings.sd_coefficient:
        import native_hindsight as hindsight
        base.need(hindsight.VERSION == HINDSIGHT_VERSION and hindsight.PROJECTION_VERSION == PROJECTION_VERSION
                  and nt.native_hash(hindsight.PROJECTION_CONTRACT) == PROJECTION_HASH, "hindsight_implementation_contract")
        prepared = hindsight.prepare_signals(episodes, captures, reviews, splits, base_config, renderer=renderer)
        base.need(prepared["exports"] == bundle, "hindsight_export_drift")
        admitted = prepared["update_plan"]
    else:
        admitted = feature_plan
    rows = deepcopy(admitted["rows"])
    if feature_plan is not None:
        feature_rows = {r["record"]["segment"]["capture_hash"]: r["record"] for r in feature_plan["rows"]}
        for item in rows:
            row = item["record"]
            key = row["segment"]["capture_hash"]
            other = feature_rows[key]
            base.need(other["segment"] == row["segment"]
                      and all(other[k] == row[k] for k in (*base.REF_KEYS, "review_hash")), "combined_signal_action_mismatch")
            item["action_feature"] = feature_map[key]
    actor_tokens = sum(len(r["record"]["segment"]["input_tokens"]) for r in rows)
    teacher_tokens = sum(len(r["signal"]["teacher_prefix"]["prompt_token_ids"])
                         + len(r["record"]["segment"]["completion_token_ids"]) for r in rows) if settings.sd_coefficient else 0
    reference_tokens = sum(len(r["record"]["segment"]["prompt_token_ids"])
                           + len(r["record"]["segment"]["completion_token_ids"]) for r in rows) if settings.anchor_coefficient else 0
    for item in rows:
        segment = item["record"]["segment"]
        prefixes = ([item["signal"]["teacher_prefix"]["prompt_token_ids"]] if settings.sd_coefficient else [])
        if settings.anchor_coefficient:
            prefixes.append(segment["prompt_token_ids"])
        base.need(all(len(p) + len(segment["completion_token_ids"]) + 1 <= 32768 for p in prefixes), "scoring_extra_token_context_limit")
    sample_tokens = len(rows) * (int(settings.sd_coefficient > 0) + int(settings.anchor_coefficient > 0))
    base.need(actor_tokens + teacher_tokens + reference_tokens + sample_tokens <= 65536, "custom_batch_token_limit")
    rates = base_config["rates"]
    raw = base.dollars(rates["fixed_usd"]) + (
        Decimal(2 * actor_tokens) * base.dollars(rates["train_usd_per_million"])
        + Decimal(teacher_tokens + reference_tokens) * base.dollars(rates["prefill_usd_per_million"])
        + Decimal(sample_tokens) * (base.dollars(custom_config["scoring_rates"]["sample_usd_per_million"]) if sample_tokens else 0)
    ) / Decimal(1000000)
    reserved = (raw * Decimal(str(rates["safety_factor"]))).quantize(Decimal("0.000001"), rounding=ROUND_CEILING)
    phases = ["create_service", "create_trainer", "get_info"]
    for role, enabled in (("teacher", settings.sd_coefficient), ("reference", settings.anchor_coefficient)):
        if enabled:
            phases += ["freeze_" + role, "create_" + role] + [f"{role}_score_{i}" for i in range(len(rows))]
    phases += ["custom_forward", "custom_backward", "optimizer", "save_state", "save_sampler"]
    return nt.seal({"schema_version": 1, "consumer": VERSION, "config": base_config,
        **({"contextual_reward_hash": contextual_hash} if contextual_hash else {}),
        "custom_config": custom_config, "base_plan_hash": admitted["plan_hash"],
        "feature_plan_hash": feature_plan["plan_hash"] if feature_plan else None,
        "prefix_proofs": prepared["prefix_proofs"] if prepared else None,
        "source_pins": {**SOURCE_PINS, "native_custom_update.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        "sdk_source_hashes": SDK_SOURCE_PINS, "export_hash": bundle["export_hash"], "split_hash": splits["split_hash"],
        "features_hash": feature_signals["features_hash"] if feature_signals else None,
        "raw_input_hash": nt.native_hash([episodes, captures, reviews]), "rows": rows,
        "phases": phases, "submission_retry_policy": "single_attempt_per_holder",
        "updates": 1, "normalization": "mean_action_of_completion_means",
        "advantage_recipe": loss_core.ADVANTAGE_RECIPE, "optimizer_state": "reset_from_pinned_weights",
        "cost": {"reserved_usd": str(reserved), "train_token_allowance": 2 * actor_tokens,
                 "teacher_prefill_tokens": teacher_tokens, "reference_prefill_tokens": reference_tokens,
                 "scoring_sample_tokens": sample_tokens, "rates": rates, "scoring_rates": custom_config["scoring_rates"],
                 "accounting": "one SDK forward plus one summed-CE forward/backward; local gradients are not a second update; allowance not invoice"},
        "assessment": None, "assessment_status": "unknown"}, "plan_hash")


def custom_datums(sdk, rows):
    # No pre-scaled advantages, behavior inputs, or extra weights. The pinned SDK
    # adds zero forward weights and replaces them with -dLoss/dLogprobs later.
    return [sdk.Datum(model_input=sdk.ModelInput.from_ints(item["record"]["segment"]["input_tokens"]),
                      loss_fn_inputs={"target_tokens": sdk.TensorData(
                          data=item["record"]["segment"]["target_tokens"], dtype="int64")}) for item in rows]


def _check_data(data, rows):
    base.need(len(data) == len(rows), "custom_batch_alignment")
    for datum, item in zip(data, rows):
        segment = item["record"]["segment"]
        base.need(datum.model_input.to_ints() == segment["input_tokens"]
                  and list(datum.loss_fn_inputs["target_tokens"].data) == segment["target_tokens"]
                  and set(datum.loss_fn_inputs) <= {"target_tokens", "weights"}, "custom_datum_alignment")


def make_callback(plan, teacher_scores, reference_scores, local):
    """A single-use callback; preserves SDK leaves and never calls backward."""
    import torch
    settings = loss_core.LossConfig(**plan["custom_config"]["loss"])
    rows = plan["rows"]

    def callback(data, logprobs):
        base.need(local.get("callback_count", 0) == 0, "duplicate_custom_callback")
        local["callback_count"] = 1
        _check_data(data, rows)
        base.need(len(logprobs) == len(rows), "custom_score_batch_alignment")
        actions = []
        for index, (item, current) in enumerate(zip(rows, logprobs)):
            segment = item["record"]["segment"]
            ids, roles = segment["completion_token_ids"], segment["completion_token_roles"]
            def packet(values):
                return loss_core.TargetScores(ids, roles, [True] * len(ids), torch.tensor(values, dtype=current.dtype, device=current.device))
            actions.append(loss_core.ActionInput(segment["capture_hash"], ids,
                loss_core.TargetScores(segment["target_tokens"], ["prompt"] * (len(segment["prompt_token_ids"]) - 1) + roles,
                                       [bool(v) for v in segment["loss_mask"]], current),
                packet(segment["behavior_logprobs"]), segment["sampler"]["distribution"],
                feature_advantage=item["action_feature"]["action_advantage"] if settings.feature_coefficient else None,
                teacher=packet(teacher_scores[index]) if settings.sd_coefficient else None,
                reference=packet(reference_scores[index]) if settings.anchor_coefficient else None))
        result = loss_core.combined_loss(actions, settings)
        if result["status"] != "computed":
            raise CustomAbstention(result["reason"])
        diagnostic = loss_core.logprob_gradient_diagnostics(result, actions)
        if diagnostic["components"]["total"]["l2_norm"] == 0:
            raise CustomAbstention("zero_logprob_gradient")
        local.update(score_records=result["actions"], diagnostics=diagnostic, metrics=result["metrics"],
                     student_scores=[a.current.logprobs.detach()[torch.tensor(a.current.completion_mask,
                                      device=a.current.logprobs.device)].cpu().tolist() for a in actions])
        return result["loss"], result["metrics"]
    return callback


def run_custom_step(trainer, data, plan, callback, local, before):
    """Instance-only phase gates around the pinned SDK's real async method.

One enclosing timeout covers the SDK's first forward, local callback and final
backward future. Hooks remain installed after failure to block late dispatch.
"""
    timeout = plan["config"]["timeout_seconds"]
    forward, backward = trainer.forward_async, trainer.forward_backward_async

    async def gated_forward(batch, loss_fn, loss_fn_config=None):
        _check_data(batch, plan["rows"])
        base.need(loss_fn == "cross_entropy" and loss_fn_config is None, "custom_forward_backend")
        base.need(len(list(trainer._chunked_requests_generator(batch))) == 1, "custom_forward_requires_one_chunk")
        base.need(all(all(v == 0 for v in d.loss_fn_inputs["weights"].data) for d in batch), "custom_forward_zero_weights")
        before("custom_forward")
        return await forward(batch, loss_fn, loss_fn_config)

    async def gated_backward(batch, loss_fn, loss_fn_config=None):
        _check_data(batch, plan["rows"])
        base.need(local.get("callback_count") == 1 and "diagnostics" in local, "missing_custom_callback")
        base.need(loss_fn == "cross_entropy" and loss_fn_config is None, "custom_backward_backend")
        base.need(len(list(trainer._chunked_requests_generator(batch))) == 1, "custom_backward_requires_one_chunk")
        import torch
        for datum, item in zip(batch, plan["rows"]):
            key = item["record"]["segment"]["capture_hash"]
            expected = -torch.tensor(local["diagnostics"]["components"]["total"]["per_action"][key], dtype=torch.float64)
            weights = torch.tensor(datum.loss_fn_inputs["weights"].data, dtype=torch.float64)
            base.need(weights.shape == expected.shape and bool(torch.isfinite(weights).all())
                      and bool(torch.allclose(weights, expected, rtol=1e-6, atol=1e-8)), "custom_gradient_transport_mismatch")
        before("custom_backward")
        return await backward(batch, loss_fn, loss_fn_config)

    trainer.forward_async, trainer.forward_backward_async = gated_forward, gated_backward

    async def run():
        future = await trainer.forward_backward_custom_async(data, callback)
        return await future.result_async()

    # The SDK's synchronous custom wrapper calls .result() without a timeout
    # before returning its future. Use its async implementation directly.
    operation = trainer.holder.run_coroutine_threadsafe(asyncio.wait_for(run(), timeout=timeout))
    return operation.result(timeout=timeout)


def execute_custom_update(episodes, captures, reviews, splits, base_config, custom_config, feature_signals=None, *,
                          budget_path, cap_usd, output_dir, expected_plan_hash=None,
                          renderer=None, sdk=None, service_factory=None, ledger_factory=None):
    """Revalidate raw evidence. Factories/renderer are trusted offline test seams."""
    plan = prepare_custom_update(episodes, captures, reviews, splits, base_config, custom_config, feature_signals, renderer=renderer)
    base.need(expected_plan_hash is None or expected_plan_hash == plan["plan_hash"], "custom_plan_changed")
    config, rows = plan["config"], plan["rows"]
    settings = loss_core.LossConfig(**plan["custom_config"]["loss"])
    output = Path(output_dir)
    base.need(not output.exists(), "new_output_directory_required")
    selection = config.get("project_selection", "explicit")
    base.need(selection != "account_default" or not os.environ.get("TINKER_PROJECT_ID"),
              "account_default_requires_unset_TINKER_PROJECT_ID")
    if service_factory is None:
        base.need(base.text(os.environ.get("TINKER_API_KEY")), "TINKER_API_KEY_required")
    audit_sdk()  # Always audit the installed custom implementation, including in SDK contract tests.
    if sdk is None:
        import tinker as sdk
    from tinker.lib.retry_handler import RetryConfig
    ledger = (ledger_factory or base.BudgetLedger)(budget_path, config.get("project_id") or "account-default", config["model"]["id"], cap_usd)
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    base.write_private(output / "plan.json", plan)
    ledger.reserve(plan)
    report = {"schema_version": 1, "consumer": VERSION, "plan_hash": plan["plan_hash"],
              "status": "reserved", "optimizer_acknowledged": False, "export_hash": plan["export_hash"],
              "custom_config_hash": custom_config["custom_config_hash"], "base_plan_hash": plan["base_plan_hash"],
              "project_selection": selection, "project_id": config.get("project_id"),
              "submission_retry_policy": plan["submission_retry_policy"], "frozen_scores": [],
              "assessment": None, "assessment_status": "unknown"}
    local = {}

    def before(phase):
        ledger.before(plan, phase)
        report["last_dispatched"] = phase
        base.write_private(output / "result.json", report)

    def call(phase, operation, future=False):
        before(phase)
        value = operation()
        return value.result(timeout=config["timeout_seconds"]) if future else value

    try:
        project = {"project_id": config["project_id"]} if selection == "explicit" else {}
        service = call("create_service", lambda: service_factory() if service_factory else sdk.ServiceClient(
            api_key=os.environ["TINKER_API_KEY"], **project, max_retries=0, timeout=config["timeout_seconds"]))
        holder = base.disable_internal_retries(service)
        trainer = call("create_trainer", lambda: service.create_training_client_from_state(config["model"]["revision"],
            base_model=config["model"]["id"], user_metadata={"native_custom_plan_hash": plan["plan_hash"]}))
        base.need(trainer.holder is holder, "unexpected_training_holder")
        info = call("get_info", trainer.get_info)
        base.need(info.model_data.model_name == config["model"]["id"]
                  and info.model_data.tokenizer_id == config["tokenizer"]["id"], "server_model_or_tokenizer_mismatch")
        report["training_client_id"] = info.model_id
        name = "native-custom-" + plan["plan_hash"][:24]
        scores, frozen_paths = {"teacher": [], "reference": []}, set()
        for role, enabled in (("teacher", settings.sd_coefficient), ("reference", settings.anchor_coefficient)):
            if not enabled:
                continue
            frozen = call("freeze_" + role, lambda role=role: trainer.save_weights_for_sampler(name + "-" + role, ttl_seconds=config["ttl_seconds"]), True)
            base.need(base.checkpoint(frozen.path, "sampler_weights") and frozen.path not in frozen_paths, "distinct_frozen_snapshot_required")
            frozen_paths.add(frozen.path)
            client = call("create_" + role, lambda: service.create_sampling_client(model_path=frozen.path,
                           retry_config=RetryConfig(enable_retry_logic=False)))
            base.need(client.holder is holder, "unexpected_scoring_holder")
            for index, item in enumerate(rows):
                segment = item["record"]["segment"]
                prefix = item["signal"]["teacher_prefix"]["prompt_token_ids"] if role == "teacher" else segment["prompt_token_ids"]
                ids = segment["completion_token_ids"]
                values = call(f"{role}_score_{index}", lambda: client.compute_logprobs(sdk.ModelInput.from_ints(prefix + ids)), True)
                base.need(len(values) == len(prefix) + len(ids), "frozen_scoring_sequence_alignment")
                selected = base.logprobs(list(values[len(prefix):]), len(ids))
                scores[role].append(selected)
                report["frozen_scores"].append({"role": role, "model": {**config["model"], "revision": frozen.path},
                    "capture_hash": segment["capture_hash"], "original_target_ids": ids, "prompt_token_ids": prefix,
                    "original_request_hash": segment["request_hash"], "completion_logprobs": selected,
                    "prefix_hash": item["signal"]["teacher_prefix"]["prefix_hash"] if role == "teacher" else None,
                    "local_operation_id": f'{plan["plan_hash"]}:{role}_score_{index}',
                    "provider_request_id": None, "provider_response_id": None})
        data = custom_datums(sdk, rows)
        callback = make_callback(plan, scores["teacher"], scores["reference"], local)
        backward = run_custom_step(trainer, data, plan, callback, local, before)
        base.need(local.get("callback_count") == 1 and "student_scores" in local, "custom_callback_missing")
        base.need(len(backward.loss_fn_outputs) == len(rows), "backward_batch_alignment")
        for item, result, current in zip(rows, backward.loss_fn_outputs, local["student_scores"]):
            segment = item["record"]["segment"]
            values = list(result["logprobs"].data)
            base.need(len(values) == len(segment["target_tokens"]), "backward_target_alignment")
            selected = base.logprobs(values[len(segment["prompt_token_ids"]) - 1:], len(current))
            base.need(all(abs(a - b) <= 1e-4 for a, b in zip(current, selected)), "student_changed_before_optimizer")
            base.need(max(abs(a - b) for a, b in zip(selected, segment["behavior_logprobs"])) <= config["max_abs_log_ratio"], "stale_backward_before_optimizer")
        base.need(type(backward.metrics) is dict and all(base.number(v, -1e300, 1e300) for v in backward.metrics.values()), "nonfinite_custom_metrics")
        report.update(local, loss_metrics=backward.metrics)
        call("optimizer", lambda: trainer.optim_step(sdk.AdamParams(learning_rate=config["learning_rate"],
             beta1=.9, beta2=.95, eps=1e-8, weight_decay=0., grad_clip_norm=1.)), True)
        report["optimizer_acknowledged"] = True
        ledger.mark(plan, optimizer_acknowledged=True)
        base.write_private(output / "result.json", report)
        saved = call("save_state", lambda: trainer.save_state(name + "-updated", ttl_seconds=config["ttl_seconds"]), True)
        base.need(base.checkpoint(saved.path), "invalid_saved_checkpoint")
        report["training_checkpoint"] = saved.path
        sampled = call("save_sampler", lambda: trainer.save_weights_for_sampler(name + "-updated", ttl_seconds=config["ttl_seconds"]), True)
        base.need(base.checkpoint(sampled.path, "sampler_weights"), "invalid_saved_sampler")
        report.update(status="complete", sampler_checkpoint=sampled.path, completed_at=base.timestamp())
        ledger.mark(plan, status="complete")
    except BaseException as error:
        report.update(status="failed_unknown", error_code=str(error) if isinstance(error, base.UpdateError) else "custom_provider_or_io_failure",
                      abstained=isinstance(error, CustomAbstention), **local)
        ledger.mark(plan, status="failed_unknown", optimizer_acknowledged=report["optimizer_acknowledged"])
        base.write_private(output / "result.json", nt.seal(report, "result_hash"))
        raise base.UpdateError("custom_update_failed_see_private_result_retained_reservation") from None
    report = nt.seal(report, "result_hash")
    base.write_private(output / "result.json", report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode", type=Path, action="append", required=True)
    for name in ("captures", "reviews", "splits", "base-config", "custom-config"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--features", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--budget-ledger", type=Path)
    parser.add_argument("--cap-usd")
    parser.add_argument("--expected-plan-hash")
    args = parser.parse_args(argv)
    try:
        raw = ([nt.load_json(p) for p in args.episode], nt.load_json(args.captures), nt.load_json(args.reviews),
               nt.load_json(args.splits), nt.load_json(args.base_config), nt.load_json(args.custom_config),
               nt.load_json(args.features) if args.features else None)
        if args.execute:
            base.need(args.output is not None and args.budget_ledger is not None and args.cap_usd is not None,
                      "execution_output_ledger_and_cap_required")
            result = execute_custom_update(*raw, budget_path=args.budget_ledger, cap_usd=args.cap_usd,
                                            output_dir=args.output, expected_plan_hash=args.expected_plan_hash)
            print(nt.native_json({"status": result["status"], "result_hash": result["result_hash"]}))
        else:
            plan = prepare_custom_update(*raw)
            if args.cap_usd is not None:
                base.need(base.dollars(plan["cost"]["reserved_usd"]) <= base.dollars(args.cap_usd), "plan_exceeds_cap")
            if args.output is not None:
                base.need(not args.output.exists(), "new_output_directory_required")
                args.output.mkdir(parents=True, mode=0o700, exist_ok=False)
                base.write_private(args.output / "plan.json", plan)
            print(nt.native_json({"status": "planned_no_dispatch", "plan_hash": plan["plan_hash"], "cost": plan["cost"]}))
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(str(error) if isinstance(error, base.UpdateError) else "invalid_custom_input_or_io")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
