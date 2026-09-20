# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["tinker==0.27.1", "torch==2.10.0+cpu", "numpy==2.2.6"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Authored envelopes and the installed SDK algorithm with local transport only.

No ServiceClient, HTTP client, credential, actual reservation, or hosted model.
The ledger is the existing implementation with its storage replaced by memory.
"""
import asyncio
from contextlib import contextmanager, redirect_stdout
from copy import deepcopy
from dataclasses import asdict
from decimal import Decimal
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import MethodType, SimpleNamespace as NS
import unittest
from unittest.mock import patch

import native_combined_loss as core
import native_custom_update as custom
import native_training as nt
import native_tinker_update as base
import test_native_hindsight as authored


def inputs(mode="F+S", anchor=False, accepted=True):
    episode, capture, review = authored.inputs(accepted=accepted)
    captures = {"schema_version": 1, "captures": [capture]}
    reviews = {"schema_version": 1, "reviews": [review]}
    bundle = nt.build_exports([episode], captures, reviews)
    splits = authored.manifest_for(bundle)
    config = nt.seal({**authored.config_for(capture), "method": "ppo" if mode == "F-only" else "sdpo"}, "config_hash")
    settings = core.LossConfig(mode, int(mode != "S-only"), int(mode != "F-only"),
                               anchor_coefficient=.25 if anchor else 0, max_abs_log_ratio=2,
                               anchor_assumption=core.ANCHOR_ASSUMPTION if anchor else None)
    custom_config = nt.seal({"schema_version": 1, "kind": custom.VERSION,
        "base_config_hash": config["config_hash"], "loss": asdict(settings),
        "hindsight": {"producer": custom.HINDSIGHT_VERSION, "projection": custom.PROJECTION_VERSION,
                       "contract_hash": custom.PROJECTION_HASH} if settings.sd_coefficient else None,
        "reference": {"kind": "initial_actor_snapshot_original_context"} if anchor else None,
        "scoring_rates": {"model_id": config["model"]["id"], "source": "AUTHORED-not-market-prices",
                          "verified_on": "2026-09-13", "sample_usd_per_million": "7.00"}
                         if settings.sd_coefficient or anchor else None}, "custom_config_hash")
    features = nt.seal({"schema_version": 1, "kind": custom.FEATURE_VERSION, "export_hash": bundle["export_hash"],
        "signals": [{"capture_hash": capture["capture_hash"], "review": review,
            "action_advantage": 1. if accepted else -1., "advantage_provenance": {
                "review_hash": review["review_hash"], "feature_hash": review["evidence_hash"],
                "estimator_revision": "AUTHORED-estimator/v1", "baseline_revision": "AUTHORED-baseline/v1",
                "aggregation": "per_action_completion_mean", "unit": "action_advantage", "discount": .9,
                "horizon_actions": 1, "source_revision": "AUTHORED-review-only"}}]}, "features_hash") if settings.feature_coefficient else None
    return [[episode], captures, reviews, splits, config, custom_config, features]


def refresh_config(raw):
    raw[4] = nt.seal(raw[4], "config_hash")
    raw[5] = nt.seal({**raw[5], "base_config_hash": raw[4]["config_hash"]}, "custom_config_hash")


class PlanTests(unittest.TestCase):
    def plan(self, raw):
        return custom.prepare_custom_update(*raw, renderer=authored.Renderer())

    def test_all_modes_and_anchors_reuse_admission_and_provenance(self):
        for mode in ("F-only", "S-only", "F+S"):
            for anchor in (False, True):
                with self.subTest(mode=mode, anchor=anchor):
                    raw = inputs(mode, anchor)
                    unchanged = deepcopy(raw)
                    plan = self.plan(raw)
                    self.assertEqual(raw, unchanged)
                    self.assertEqual(plan["consumer"], custom.VERSION)
                    self.assertEqual(plan["phases"].count("custom_forward"), 1)
                    self.assertNotIn("student_forward", plan["phases"])
                    self.assertEqual(plan["phases"].count("custom_backward"), 1)
                    self.assertEqual(plan["updates"], 1)
                    self.assertIsNone(plan["assessment"])
                    if mode != "F-only":
                        proof = plan["prefix_proofs"]["proofs"][0]
                        self.assertEqual(proof["kind"], "native-hindsight/v3")
                        self.assertEqual(proof["feedback_projection"]["contract_hash"], custom.PROJECTION_HASH)
                        self.assertEqual(proof["student_segment"]["completion_token_ids"], [20, 21, 22])
                        self.assertEqual(proof["teacher_prefix"]["completion_token_ids"], [20, 21, 22])

    def test_sampling_extra_tokens_and_exact_custom_cost_no_extra_forward(self):
        raw = inputs(anchor=True)
        plan = self.plan(raw)
        cost = plan["cost"]
        self.assertEqual(cost["train_token_allowance"], 10)  # five shifted targets, two server passes
        self.assertEqual(cost["teacher_prefill_tokens"], 8)
        self.assertEqual(cost["reference_prefill_tokens"], 6)
        self.assertEqual(cost["scoring_sample_tokens"], 2)
        expected = (Decimal('.1') + Decimal(10 * 3 + 14 * 1 + 2 * 7) / Decimal(1_000_000)) * 5
        self.assertEqual(Decimal(cost["reserved_usd"]), expected)

    def test_f_only_accepts_independently_rejected_negative_action_but_s_does_not(self):
        self.assertEqual(self.plan(inputs("F-only", accepted=False))["rows"][0]["action_feature"]["action_advantage"], -1)
        with self.assertRaisesRegex(base.UpdateError, "missing_accepted_capture"):
            self.plan(inputs("F+S", accepted=False))

    def test_feature_scalar_projection_is_explicit_unscaled_and_supported(self):
        plan = self.plan(inputs("F-only"))
        item = plan["rows"][0]
        self.assertEqual(item["signal"]["advantages"], [1, 1, 1])
        self.assertEqual(item["action_feature"]["advantage_provenance"]["unit"], "action_advantage")

    def test_missing_unknown_or_unproven_feature_never_becomes_zero(self):
        for problem in ("missing", "unknown", "nonfinite", "provenance", "review", "duplicate", "extra"):
            raw = inputs()
            signals = raw[6]["signals"]
            if problem == "missing": signals.clear()
            elif problem == "unknown": signals[0]["action_advantage"] = None
            elif problem == "nonfinite": signals[0]["action_advantage"] = float("nan")
            elif problem == "provenance": signals[0]["advantage_provenance"].pop("baseline_revision")
            elif problem == "review": signals[0]["advantage_provenance"]["review_hash"] = "f" * 64
            elif problem == "duplicate": signals.append(deepcopy(signals[0]))
            else: signals[0]["capture_hash"] = "e" * 64
            with self.subTest(problem=problem), self.assertRaises((ValueError, TypeError)):
                raw[6] = nt.seal(raw[6], "features_hash")
                self.plan(raw)

    def test_existing_capture_and_split_guards_still_apply(self):
        for problem in ("protected", "test_split", "alias", "missing_behavior", "capture_tamper"):
            raw = inputs("F-only")
            if problem == "protected": raw[3]["families"][0]["protected"] = True
            elif problem == "test_split": raw[3]["families"][0]["split"] = "test"
            elif problem == "alias": raw[3]["families"][0]["aliases"] = ["different"]
            elif problem == "missing_behavior": raw[1]["captures"][0]["behavior_logprobs"] = None
            else: raw[1]["captures"][0]["completion_token_ids"][0] = 999
            raw[3] = nt.seal(raw[3], "split_hash")
            with self.subTest(problem=problem), self.assertRaises(ValueError):
                self.plan(raw)

    def test_corrected_projection_pin_is_mandatory(self):
        raw = inputs()
        raw[5]["hindsight"]["contract_hash"] = "0" * 64
        refresh_config(raw)
        with self.assertRaisesRegex(base.UpdateError, "corrected_hindsight"):
            self.plan(raw)

    def test_pre_action_review_cannot_supply_an_action_feature(self):
        raw = inputs("F-only")
        review = authored.fixtures.fixture_review(raw[0][0], raw[1]["captures"][0], boundary="pre_action")
        raw[2]["reviews"] = [nt.seal({**review, "reviewer": {"kind": "human", "id": "AUTHORED-independent"}}, "review_hash")]
        # The shared raw export validator rejects this before any downstream
        # split/hash mismatch could hide the missing post-action evidence.
        with self.assertRaisesRegex(ValueError, "review_temporal_boundary"):
            self.plan(raw)

    def test_default_cli_only_prepares_private_authored_plan(self):
        raw = inputs("F-only")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = []
            for name, value in zip(("episode", "captures", "reviews", "splits", "base-config", "custom-config", "features"),
                                   [raw[0][0], *raw[1:]]):
                path = root / (name + ".json")
                path.write_text(nt.native_json(value))
                args += ["--" + name, str(path)]
            output = root / "planned"
            stream = io.StringIO()
            with redirect_stdout(stream), patch.object(base.BudgetLedger, "reserve", side_effect=AssertionError("No reservation")), \
                    patch.object(custom, "execute_custom_update", side_effect=AssertionError("No execution")):
                self.assertEqual(custom.main(args + ["--output", str(output)]), 0)
            self.assertIn("planned_no_dispatch", stream.getvalue())
            self.assertTrue((output / "plan.json").exists())
            self.assertFalse((output / "result.json").exists())
            self.assertEqual((output / "plan.json").stat().st_mode & 0o777, 0o600)

    def test_explicit_config_cannot_relax_base_bounds_or_imply_missing_rate(self):
        for problem in ("cap", "epsilon", "staleness", "rate", "base_pin", "implicit", "anchor_context"):
            raw = inputs(anchor=True)
            if problem == "cap": raw[5]["loss"]["sd_cap"] = 4
            elif problem == "epsilon": raw[5]["loss"]["epsilon"] = .3
            elif problem == "staleness": raw[5]["loss"]["max_abs_log_ratio"] = 3
            elif problem == "rate": raw[5]["scoring_rates"] = None
            elif problem == "base_pin": raw[5]["base_config_hash"] = "0" * 64
            elif problem == "implicit": raw[5]["loss"].pop("feature_cap")
            else: raw[5]["reference"]["kind"] = "teacher_feedback_context"
            raw[5] = nt.seal(raw[5], "custom_config_hash")
            with self.subTest(problem=problem), self.assertRaises(ValueError):
                self.plan(raw)

    def test_f_plan_imports_no_optional_model_or_provider_libraries(self):
        script = """
import builtins
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name.split('.')[0] in {'torch', 'tinker', 'transformers', 'httpx', 'requests'}:
        raise AssertionError('unexpected optional import: ' + name)
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
from test_native_custom_update import inputs
from native_custom_update import prepare_custom_update
prepare_custom_update(*inputs('F-only'))
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parent,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class MemoryLedger(base.BudgetLedger):
    """Reuse actual reservation/ordering/ack code, replace only filesystem storage."""
    @contextmanager
    def locked(self):
        value = deepcopy(getattr(self, "value", {"kind": base.BUDGET_KIND, "project_id": self.project,
                    "model_id": self.model, "cap_usd": self.cap, "runs": {}}))
        yield value
        self.value = nt.seal(value, "ledger_hash")


class Immediate:
    def __init__(self, value): self.value = value
    def result(self, timeout=None): return self.value
    async def result_async(self, timeout=None): return self.value


class LocalHolder:
    def __init__(self):
        self.execute_with_retries = lambda: None
        self._client_config = NS(fwdbwd_max_chunk_bytes_count=10_000_000, fwdbwd_max_chunk_len=128)
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
    def run_coroutine_threadsafe(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop)
    def close(self):
        async def finish():
            tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            for t in tasks: t.cancel()
            if tasks: await asyncio.gather(*tasks, return_exceptions=True)
        self.run_coroutine_threadsafe(finish()).result(timeout=5)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(timeout=5)
        self.loop.close()


class LocalService:
    """Real SDK custom algorithm and value types; no SDK client is constructed."""
    def __init__(self, sdk, plan, ledger, fail=None):
        from tinker.lib.public_interfaces.training_client import TrainingClient
        self.sdk, self.plan, self.ledger, self.fail = sdk, plan, ledger, fail
        self.holder = LocalHolder()
        self.calls, self.sent_weights, self.prefixes = [], [], []
        self.forward_backward_custom_async = MethodType(TrainingClient.forward_backward_custom_async, self)
        self._get_custom_loss_forward_data = MethodType(TrainingClient._get_custom_loss_forward_data, self)
        self._chunked_requests_generator = MethodType(TrainingClient._chunked_requests_generator, self)
        self.current = [-1., -1.5, -1.]
        if fail == "stale": self.current = [-100., -1.5, -1.]
        if fail == "nonfinite": self.current = [float("nan"), -1.5, -1.]

    def check(self, phase):
        run = self.ledger.value["runs"][self.plan["plan_hash"]]
        assert run["dispatched"][-1] == phase
        assert run["reserved_usd"] == self.plan["cost"]["reserved_usd"]
        self.calls.append(phase)
        if phase != "create_service": assert self.holder.execute_with_retries is base._single_attempt
        if self.fail == phase: raise RuntimeError("PRIVATE-FAULT-TEXT-MUST-NOT-LEAK")

    def factory(self): self.check("create_service"); return self
    def create_training_client_from_state(self, path, **kwargs):
        self.check("create_trainer")
        assert path == self.plan["config"]["model"]["revision"]
        return self
    def get_info(self):
        self.check("get_info")
        return NS(model_id="AUTHORED-trainer", model_data=NS(model_name=self.plan["config"]["model"]["id"],
                     tokenizer_id="wrong" if self.fail == "tokenizer" else self.plan["config"]["tokenizer"]["id"]))
    def save_weights_for_sampler(self, name, **kwargs):
        role = name.rsplit("-", 1)[-1]
        self.check("freeze_" + role if role in {"teacher", "reference"} else "save_sampler")
        if self.fail == "same_snapshot" and role == "reference": name = name.rsplit("-", 1)[0] + "-teacher"
        return Immediate(NS(path="tinker://AUTHORED:train:0/sampler_weights/" + name))
    def create_sampling_client(self, model_path, retry_config):
        role = model_path.rsplit("-", 1)[-1]
        self.check("create_" + role)
        assert retry_config.enable_retry_logic is False
        def compute(prompt):
            self.check(role + "_score_0")
            self.prefixes.append((role, prompt.to_ints()))
            scores = self.current if self.fail == "zero_sd" else ([-.1, -1.9, -.2] if role == "teacher" else [-2., -2., -2.])
            if self.fail == "teacher_alignment": scores = scores[:-1]
            return Immediate([None] + [-.1] * (prompt.length - 4) + scores)
        return NS(holder=self.holder, compute_logprobs=compute)
    def output(self, batch, backward=False):
        rows = []
        for datum, row in zip(batch, self.plan["rows"]):
            count = len(row["record"]["segment"]["completion_token_ids"])
            prefix = [float("nan") if self.fail == "masked_nan" else -.1] * (datum.model_input.length - count)
            selected = list(self.current[:count])
            if backward and self.fail == "score_drift": selected[0] -= .01
            rows.append({"logprobs": self.sdk.TensorData(data=prefix + selected, dtype="float32")})
        return NS(loss_fn_outputs=rows, metrics={"server_loss": float("nan") if self.fail == "metrics" else 1.})
    async def forward_async(self, batch, loss_fn, loss_fn_config=None):
        self.check("custom_forward")
        assert all(set(d.loss_fn_inputs) == {"target_tokens", "weights"} for d in batch)
        assert all(v == 0 for d in batch for v in d.loss_fn_inputs["weights"].data)
        if self.fail == "timeout": await asyncio.sleep(60)
        return Immediate(self.output(batch))
    async def forward_backward_async(self, batch, loss_fn, loss_fn_config=None):
        self.check("custom_backward")
        self.sent_weights = [list(d.loss_fn_inputs["weights"].data) for d in batch]
        return Immediate(self.output(batch, backward=True))
    def optim_step(self, params):
        self.check("optimizer")
        assert params.learning_rate == self.plan["config"]["learning_rate"]
        return Immediate(NS())
    def save_state(self, name, **kwargs):
        self.check("save_state")
        return Immediate(NS(path="invalid" if self.fail == "saved_path" else "tinker://AUTHORED:train:0/weights/" + name))


@unittest.skipUnless(importlib.util.find_spec("tinker") and importlib.util.find_spec("torch"), "Optional pinned SDK/Torch unavailable")
class ConsumerTests(unittest.TestCase):
    def setUp(self):
        import tinker
        self.sdk = tinker
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def setup_run(self, mode="F+S", anchor=False, fail=None, raw=None):
        self.raw = raw or inputs(mode, anchor)
        if fail == "timeout":
            self.raw[4]["timeout_seconds"] = 1
            refresh_config(self.raw)
        self.plan = custom.prepare_custom_update(*self.raw, renderer=authored.Renderer())
        self.ledger = MemoryLedger(self.root / "unused-budget-path", "MOCK-project", self.plan["config"]["model"]["id"], "100")
        self.service = LocalService(self.sdk, self.plan, self.ledger, fail)
        self.addCleanup(self.service.holder.close)

    def execute(self, output="run", expected=None):
        with patch("socket.create_connection", side_effect=AssertionError("Network forbidden")):
            return custom.execute_custom_update(*self.raw, budget_path=self.root / "unused-budget-path", cap_usd="100",
                output_dir=self.root / output, expected_plan_hash=expected,
                sdk=self.sdk, service_factory=self.service.factory, renderer=authored.Renderer(),
                ledger_factory=lambda *args: self.ledger)

    def test_installed_sdk_source_audit_and_real_custom_callback_for_all_modes(self):
        custom.audit_sdk()
        for index, (mode, anchor) in enumerate((m, a) for m in ("F-only", "S-only", "F+S") for a in (False, True)):
            with self.subTest(mode=mode, anchor=anchor):
                self.setup_run(mode, anchor)
                result = self.execute(output=str(index), expected=self.plan["plan_hash"])
                self.assertEqual(result["status"], "complete")
                self.assertTrue(result["optimizer_acknowledged"])
                self.assertEqual(self.service.calls, self.plan["phases"])
                self.assertEqual(result["callback_count"], 1)
                self.assertFalse(result["diagnostics"]["full_parameter_gradients"])
                self.assertFalse((self.root / "unused-budget-path").exists())

    def test_actual_sdk_transports_negative_derivative_without_double_mean(self):
        self.setup_run("F-only")
        self.service.current = list(self.plan["rows"][0]["record"]["segment"]["behavior_logprobs"])
        result = self.execute()
        weights = self.service.sent_weights[0]
        self.assertEqual(weights[:2], [0., 0.])
        # Current is explicitly matched to captured behavior: -dL/ds=1/3.
        for value in weights[2:]: self.assertAlmostEqual(value, 1 / 3, places=6)
        self.assertAlmostEqual(result["metrics"]["loss_feature"], -1)

    def test_actual_sdk_preserves_equal_action_weight_for_ragged_completions(self):
        raw = inputs("F-only")
        episode, capture, review = authored.inputs(branch="b")
        for key in ("completion_token_ids", "completion_token_roles", "behavior_logprobs"):
            capture[key] = capture[key][:1]
        capture = nt.seal(capture, "capture_hash")
        review = nt.seal({**review, "capture_hash": capture["capture_hash"]}, "review_hash")
        raw[0].append(episode)
        raw[1]["captures"].append(capture)
        raw[2]["reviews"].append(review)
        bundle = nt.build_exports(*raw[:3])
        raw[3] = authored.manifest_for(bundle)
        raw[4]["capture_hashes"].append(capture["capture_hash"])
        refresh_config(raw)
        signal = deepcopy(raw[6]["signals"][0])
        signal.update(capture_hash=capture["capture_hash"], review=review)
        signal["advantage_provenance"].update(review_hash=review["review_hash"], feature_hash=review["evidence_hash"])
        raw[6]["signals"].append(signal)
        raw[6] = nt.seal({**raw[6], "export_hash": bundle["export_hash"]}, "features_hash")
        self.setup_run(raw=raw)
        self.service.current = list(self.plan["rows"][0]["record"]["segment"]["behavior_logprobs"])
        result = self.execute()
        short, long = sorted(self.service.sent_weights, key=len)
        self.assertAlmostEqual(sum(short), .5, places=6)
        self.assertAlmostEqual(sum(long), .5, places=6)
        self.assertAlmostEqual(result["metrics"]["loss_feature"], -1, places=6)

    def test_corrected_teacher_and_original_reference_are_separate_frozen_roles(self):
        self.setup_run(anchor=True)
        result = self.execute()
        self.assertEqual(self.service.prefixes, [("teacher", [30, 31, 32, 33, 34, 20, 21, 22]),
                                                 ("reference", [10, 11, 12, 20, 21, 22])])
        self.assertEqual(len({r["model"]["revision"] for r in result["frozen_scores"]}), 2)
        self.assertTrue(all(r["provider_request_id"] is None for r in result["frozen_scores"]))

    def test_masked_nan_stays_context_and_never_enters_gradient_transport(self):
        self.setup_run(fail="masked_nan")
        result = self.execute()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(self.service.sent_weights[0][:2], [0., 0.])

    def test_preoptimizer_failures_retain_reservation_and_prevent_optimizer(self):
        for index, fail in enumerate(("tokenizer", "same_snapshot", "teacher_alignment", "stale", "nonfinite",
                                     "score_drift", "metrics", "custom_forward", "custom_backward")):
            with self.subTest(fail=fail):
                self.setup_run(anchor=True, fail=fail)
                with self.assertRaisesRegex(base.UpdateError, "retained_reservation"):
                    self.execute(output=str(index))
                self.assertNotIn("optimizer", self.service.calls)
                held = self.ledger.value["runs"][self.plan["plan_hash"]]
                self.assertEqual(held["status"], "failed_unknown")
                self.assertEqual(held["reserved_usd"], self.plan["cost"]["reserved_usd"])
                self.assertFalse(held["optimizer_acknowledged"])
                self.assertNotIn("PRIVATE-FAULT", (self.root / str(index) / "result.json").read_text())

    def test_callback_abstention_stops_before_backward_and_optimizer(self):
        self.setup_run("S-only", fail="zero_sd")
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertIn("custom_forward", self.service.calls)
        self.assertNotIn("custom_backward", self.service.calls)
        report = nt.load_json(self.root / "run" / "result.json")
        self.assertTrue(report["abstained"])
        self.assertEqual(report["error_code"], "zero_training_signal")

    def test_unknown_feature_abstains_before_any_ledger_or_client(self):
        self.setup_run()
        self.raw[6]["signals"][0]["action_advantage"] = None
        self.raw[6] = nt.seal(self.raw[6], "features_hash")
        with self.assertRaises(custom.CustomAbstention): self.execute()
        self.assertFalse(hasattr(self.ledger, "value"))
        self.assertEqual(self.service.calls, [])

    def test_timeout_covers_first_sdk_forward_and_blocks_later_phases(self):
        self.setup_run(fail="timeout")
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertIn("custom_forward", self.service.calls)
        self.assertNotIn("custom_backward", self.service.calls)
        self.assertNotIn("optimizer", self.service.calls)

    def test_optimizer_ack_preserved_if_save_fails_and_duplicate_plan_cannot_retry(self):
        self.setup_run(fail="save_state")
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertTrue(self.ledger.value["runs"][self.plan["plan_hash"]]["optimizer_acknowledged"])
        calls = list(self.service.calls)
        with self.assertRaisesRegex(base.UpdateError, "duplicate_plan"):
            self.execute(output="retry")
        self.assertEqual(calls, self.service.calls)

    def test_optimizer_exception_is_unacknowledged_and_never_saved(self):
        self.setup_run(fail="optimizer")
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertIn("optimizer", self.service.calls)
        self.assertNotIn("save_state", self.service.calls)
        self.assertFalse(self.ledger.value["runs"][self.plan["plan_hash"]]["optimizer_acknowledged"])

    def test_changed_raw_capture_or_expected_plan_rejected_before_reservation(self):
        self.setup_run()
        with self.assertRaisesRegex(base.UpdateError, "custom_plan_changed"):
            self.execute(expected="0" * 64)
        self.raw[1]["captures"][0]["completion_token_ids"][0] = 999
        with self.assertRaises(ValueError): self.execute()
        self.assertFalse(hasattr(self.ledger, "value"))
        self.assertEqual(self.service.calls, [])

    def test_single_chunk_guard_prevents_unplanned_multiple_submissions(self):
        self.setup_run("F-only")
        self.service._chunked_requests_generator = lambda data: iter([(data, 1), (data, 1)])
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertNotIn("custom_forward", self.service.calls)

    def test_doubled_sdk_gradient_transport_is_rejected(self):
        self.setup_run("F-only")
        real = self.service.forward_backward_custom_async
        async def altered(data, callback):
            def scaled(batch, values):
                loss, metrics = callback(batch, values)
                return 2 * loss, metrics
            return await real(data, scaled)
        self.service.forward_backward_custom_async = altered
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertNotIn("custom_backward", self.service.calls)
        self.assertEqual(nt.load_json(self.root / "run" / "result.json")["error_code"], "custom_gradient_transport_mismatch")

    def test_ambient_project_cannot_redirect_account_default(self):
        raw = inputs("F-only")
        raw[4].update(project_selection="account_default", project_id=None)
        refresh_config(raw)
        self.setup_run(raw=raw)
        with patch.dict("os.environ", {"TINKER_PROJECT_ID": "unexpected"}), self.assertRaisesRegex(base.UpdateError, "account_default"):
            self.execute()
        self.assertEqual(self.service.calls, [])

    def test_duplicate_callback_cannot_submit_gradients(self):
        self.setup_run("F-only")
        real = self.service.forward_backward_custom_async
        async def duplicate(data, callback):
            def twice(batch, values):
                callback(batch, values)
                return callback(batch, values)
            return await real(data, twice)
        self.service.forward_backward_custom_async = duplicate
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertNotIn("custom_backward", self.service.calls)
        self.assertEqual(nt.load_json(self.root / "run" / "result.json")["error_code"], "duplicate_custom_callback")

    def test_source_pin_failure_prevents_any_reservation(self):
        self.setup_run()
        with patch.dict(custom.SDK_SOURCE_PINS, {"tinker/lib/public_interfaces/training_client.py": "0" * 64}), self.assertRaisesRegex(base.UpdateError, "source_pin"):
            self.execute()
        self.assertFalse(hasattr(self.ledger, "value"))
        self.assertEqual(self.service.calls, [])

    def test_saved_checkpoint_validation_preserves_optimizer_ack(self):
        self.setup_run(fail="saved_path")
        with self.assertRaises(base.UpdateError): self.execute()
        self.assertTrue(self.ledger.value["runs"][self.plan["plan_hash"]]["optimizer_acknowledged"])
        self.assertNotIn("save_sampler", self.service.calls)


if __name__ == "__main__":
    unittest.main()
