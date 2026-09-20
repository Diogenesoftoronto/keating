"""Authored mock provider evidence, never a real capture or permission to train.

Production-shaped assertions below exercise the trust boundary with a fake SDK.
No test reads keys or contacts Tinker; actual SDK value construction is optional.
"""
from copy import deepcopy
import asyncio
from decimal import Decimal
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import native_training as nt
import native_tinker_update as nu
import test_native_training as fixtures


MODEL = {"provider": "tinker", "id": "Qwen/Qwen3.5-9B-Base", "revision": "tinker://mock-behavior/sampler_weights/step0"}
TOKENIZER = {"id": "Qwen/Qwen3.5-9B-Base", "revision": "mock-tokenizer-commit", "chat_template_hash": "b" * 64}


def inputs(method="sdpo", behavior=True, accepted=True):
    with patch.object(fixtures, "MODEL", MODEL), patch.object(fixtures, "TOKENIZER", TOKENIZER):
        episode = fixtures.fixture_episode()
        episode["measurement"] = episode["runtime"]["measurement"] = "model_episode"
        capture = fixtures.fixture_capture(episode)
        capture["source"]["kind"] = "provider_capture"
        if not behavior:
            capture["behavior_logprobs"] = None
        capture = nt.seal(capture, "capture_hash")
        review = fixtures.fixture_review(episode, capture)
        review["reviewer"] = {"kind": "human", "id": "MOCK-independent-reviewer"}
        review["accepted"] = accepted
        review = nt.seal(review, "review_hash")
        bundle = fixtures.export([episode], [capture], [review])
    manifest = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"], "registry_revision": "MOCK-registry",
        "approved_by": "MOCK-admission-reviewer", "episodes": bundle["episodes"], "families": [{
            "family": episode["family"], "split": "train", "protected": False, "aliases": [episode["family"]],
            "sources": [{"dataset": "MOCK-authored", "revision": "MOCK-v1", "record_id": "MOCK-case-1",
                         "original_split": "train", "record_sha256": "d" * 64}]}]}, "split_hash")
    config = nt.seal({"schema_version": 1, "method": method,
        "model": {**MODEL, "revision": "tinker://mock-initial/weights/step0"}, "tokenizer": TOKENIZER,
        "project_id": "MOCK-project", "capture_hashes": [capture["capture_hash"]],
        "allowed_behavior_revisions": [MODEL["revision"]], "learning_rate": 1e-5, "epsilon": 0.2,
        "max_abs_log_ratio": 2, "advantage_cap": 3, "ttl_seconds": 3600, "timeout_seconds": 30,
        "rates": {"model_id": MODEL["id"], "source": "MOCK-not-market-prices", "verified_on": "2026-09-13",
                  "prefill_usd_per_million": "1.00", "train_usd_per_million": "3.00", "fixed_usd": "0.10", "safety_factor": 5}}, "config_hash")
    feature = next(f for f in bundle["observer_inputs"] if f["boundary"] == "retrospective")
    packet = nt.feedback_packet(feature, review)
    prefix = nt.seal({"prompt_token_ids": [30, 31, 32, 33, 34], "completion_token_ids": capture["completion_token_ids"],
        "tokenizer": TOKENIZER, "original_request_hash": capture["request_hash"], "feedback_hash": packet["feedback_hash"],
        "conditioning": nu.CONDITIONING, "renderer": {"id": "MOCK-feedback-renderer", "revision": "MOCK-v1"}}, "prefix_hash")
    signals = nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"], "signals": [{
        "capture_hash": capture["capture_hash"], "review": review, "teacher_prefix": prefix,
        "advantages": [1.0, -2.0, 0.25] if accepted else [0.0, -2.0, -0.25], "advantage_provenance": {"review_hash": review["review_hash"],
            "feature_hash": feature["feature_hash"], "estimator_revision": "MOCK-v1", "baseline_revision": "MOCK-v1",
            "aggregation": "per-action"}}]}, "signals_hash")
    return bundle, manifest, config, signals


class FakeFuture:
    def __init__(self, value):
        self.value = value

    def result(self, timeout=None):
        assert timeout == 30
        return self.value


class FakeInput:
    @classmethod
    def from_ints(cls, values):
        return NS(to_ints=lambda: values)


SDK = NS(TensorData=NS, Datum=NS, AdamParams=NS, ModelInput=FakeInput)


class FakeService:
    """Every dispatch observes the already-persisted full reservation."""
    def __init__(self, path, plan, fail=None):
        self.path, self.plan, self.fail = path, plan, fail
        self.calls, self.batches = [], []
        self.current = [-1.0, -1.5, -1.0]
        self.teacher = [-0.1, -1.9, -0.2]
        self.holder = NS(execute_with_retries=lambda operation: None)

    def checked(self, phase):
        if phase != "create_service":
            assert self.holder.execute_with_retries is nu._single_attempt
        ledger = nt.load_json(self.path)
        run = ledger["runs"][self.plan["plan_hash"]]
        assert run["reserved_usd"] == self.plan["cost"]["reserved_usd"]
        assert run["dispatched"][-1] == phase
        self.calls.append(phase)
        if self.fail == phase:
            raise RuntimeError("SECRET-PROVIDER-ERROR-MUST-NOT-APPEAR")

    def factory(self):
        self.checked("create_service")
        return self

    def create_training_client_from_state(self, path, **kwargs):
        self.checked("create_trainer")
        assert path == self.plan["config"]["model"]["revision"]
        assert kwargs["base_model"] == MODEL["id"]
        return self

    def get_info(self):
        self.checked("get_info")
        return NS(model_id="mock-training-client", model_data=NS(model_name=MODEL["id"], tokenizer_id=TOKENIZER["id"]))

    def save_weights_for_sampler(self, name, **kwargs):
        phase = "freeze_teacher" if name.endswith("-teacher") else "save_sampler"
        self.checked(phase)
        return FakeFuture(NS(path="tinker://mock-training/sampler_weights/" + name))

    def create_sampling_client(self, model_path, retry_config):
        self.checked("create_teacher")
        assert model_path.endswith("-teacher")
        assert retry_config.enable_retry_logic is False
        return self

    def compute_logprobs(self, model_input):
        self.checked("teacher_score_0")
        self.teacher_input = model_input.to_ints()
        assert self.teacher_input == [30, 31, 32, 33, 34, 20, 21, 22]
        return FakeFuture([None, -0.1, -0.2, -0.3, -0.4] + self.teacher)

    def result(self, data, scores=None):
        return FakeFuture(NS(loss_fn_outputs=[{"logprobs": NS(data=[-0.1, -0.2] + (scores or self.current))} for _ in data], metrics={"loss:sum": 1.0}))

    def forward(self, data, loss_fn):
        self.checked("student_forward")
        assert loss_fn == "cross_entropy"
        self.batches.append(data)
        return self.result(data)

    def forward_backward(self, data, loss_fn, **kwargs):
        self.checked("forward_backward")
        self.batches.append(data)
        self.loss, self.loss_config = loss_fn, kwargs
        return self.result(data, [-1.0, -1.5, -0.5] if self.fail == "student_changed" else None)

    def optim_step(self, adam_params):
        self.checked("optimizer")
        assert adam_params.learning_rate == 1e-5
        return FakeFuture(NS())

    def save_state(self, name, **kwargs):
        self.checked("save_state")
        return FakeFuture(NS(path="tinker://mock-training/weights/" + name))


class NativeTinkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.budget = self.root / "budget.json"
        self.output = self.root / "output"

    def run_mock(self, data, fail=None, cap="1.00"):
        plan = nu.prepare_update(*data)
        fake = FakeService(self.budget, plan, fail)
        self.fake = fake
        result = nu.execute_update(*data, budget_path=self.budget, cap_usd=cap, output_dir=self.output,
                                   sdk=SDK, service_factory=fake.factory, retry_config_factory=NS)
        return result, fake

    def reseal_bundle(self, data):
        bundle, manifest, config, signals = data
        bundle = nt.seal(bundle, "export_hash")
        manifest.update(export_hash=bundle["export_hash"], episodes=bundle["episodes"])
        signals["export_hash"] = bundle["export_hash"]
        return bundle, nt.seal(manifest, "split_hash"), config, nt.seal(signals, "signals_hash")

    def test_sdpo_uses_frozen_teacher_current_student_actual_behavior_and_exact_masks(self):
        data = inputs()
        result, fake = self.run_mock(data)
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["optimizer_acknowledged"])
        self.assertEqual(fake.calls, nu.prepare_update(*data)["phases"])
        self.assertEqual(fake.calls.count("optimizer"), 1)
        datum = fake.batches[-1][0]
        self.assertEqual(datum.model_input.to_ints(), [10, 11, 12, 20, 21])
        values = datum.loss_fn_inputs
        self.assertEqual(values["target_tokens"].data, [11, 12, 20, 21, 22])
        self.assertEqual(values["logprobs"].data, [0, 0, -0.4, -0.8, -1.0])
        for actual, expected in zip(values["advantages"].data, [0, 0, 0.9/3, -0.4/3, 0.8/3]):
            self.assertAlmostEqual(actual, expected)
        self.assertEqual(fake.loss_config["loss_fn_config"], {"clip_low_threshold": 0.8, "clip_high_threshold": 1.2})
        self.assertIsNone(result["assessment"])
        self.assertIsNone(result["teacher_captures"][0]["provider_response_id"])
        self.assertIn("local_operation_id", result["teacher_captures"][0])
        self.assertNotEqual(result["score_records"][0]["student_model"], result["score_records"][0]["behavior_model"])

    def test_sft_missing_behavior_allowed_but_only_completion_targets_weighted(self):
        data = inputs("sft", behavior=False)
        result, fake = self.run_mock(data)
        self.assertEqual(fake.loss, "cross_entropy")
        self.assertNotIn("create_teacher", fake.calls)
        self.assertNotIn("student_forward", fake.calls)
        values = fake.batches[-1][0].loss_fn_inputs
        self.assertEqual(values["weights"].data, [0, 0, 1/3, 1/3, 1/3])
        self.assertNotIn("logprobs", values)
        self.assertEqual(result["teacher_captures"], [])

    def test_ppo_requires_external_advantage_provenance(self):
        data = inputs("ppo")
        _, fake = self.run_mock(data)
        self.assertNotIn("create_teacher", fake.calls)
        self.assertEqual(fake.batches[-1][0].loss_fn_inputs["advantages"].data, [0, 0, 1/3, -2/3, 0.25/3])
        data[3]["signals"][0].pop("advantage_provenance")
        with self.assertRaisesRegex(nu.UpdateError, "advantage_provenance"):
            nu.prepare_update(*data[:3], nt.seal(data[3], "signals_hash"))

    def test_cap_checked_before_any_client_or_trainer(self):
        with self.assertRaisesRegex(nu.UpdateError, "budget_cap_exceeded_before_dispatch"):
            self.run_mock(inputs(), cap="0.01")
        self.assertEqual(self.fake.calls, [])
        self.assertFalse(self.budget.exists())

    def test_explicit_account_default_omits_sdk_project_and_uses_default_budget_identity(self):
        # Exercise the production ServiceClient keyword path with an entirely
        # mocked SDK; the fake checks reservation before any provider operation.
        for index, mode in enumerate(("absent", "null", "explicit", "legacy_explicit")):
            with self.subTest(mode=mode):
                self.budget = self.root / f"budget-{index}.json"
                self.output = self.root / f"output-{index}"
                data = inputs("sft")
                config = data[2]
                if mode in {"absent", "null"}:
                    config["project_selection"] = "account_default"
                    if mode == "absent": config.pop("project_id")
                    else: config["project_id"] = None
                elif mode == "explicit":
                    config["project_selection"] = "explicit"
                data = (*data[:2], nt.seal(config, "config_hash"), data[3])
                fake = FakeService(self.budget, nu.prepare_update(*data))
                observed = []
                def constructor(**kwargs):
                    observed.append(kwargs)
                    return fake.factory()
                sdk = NS(**vars(SDK), ServiceClient=constructor)
                default = mode in {"absent", "null"}
                env = {"TINKER_API_KEY": "MOCK-not-a-key"}
                if not default: env["TINKER_PROJECT_ID"] = "unused-ambient-project"
                with patch.dict(os.environ, env, clear=True), patch.object(nu.importlib.metadata, "version", return_value="0.27.1"):
                    result = nu.execute_update(*data, budget_path=self.budget, cap_usd="1.00", output_dir=self.output,
                        sdk=sdk, retry_config_factory=NS)
                self.assertEqual(result["status"], "complete")
                self.assertEqual(len(observed), 1)
                self.assertEqual(observed[0]["max_retries"], 0)
                if default:
                    self.assertNotIn("project_id", observed[0])
                else:
                    self.assertEqual(observed[0]["project_id"], "MOCK-project")
                self.assertEqual(nt.load_json(self.budget)["project_id"], "account-default" if default else "MOCK-project")
                self.assertEqual(result["project_selection"], "account_default" if default else "explicit")
                self.assertEqual(result["project_id"], None if default else "MOCK-project")

    def test_account_default_rejects_ambient_project_before_reservation_or_output(self):
        data = inputs()
        data[2].update(project_selection="account_default", project_id=None)
        data = (*data[:2], nt.seal(data[2], "config_hash"), data[3])
        with patch.dict(os.environ, {"TINKER_PROJECT_ID": "ambient-would-override"}):
            # Planning remains pure and records the deliberate selection.
            plan = nu.prepare_update(*data)
            fake = FakeService(self.budget, plan)
            with self.assertRaisesRegex(nu.UpdateError, "account_default_requires_unset_TINKER_PROJECT_ID"):
                nu.execute_update(*data, budget_path=self.budget, cap_usd="1.00", output_dir=self.output,
                    sdk=SDK, service_factory=fake.factory, retry_config_factory=NS)
        self.assertEqual(fake.calls, [])
        self.assertFalse(self.budget.exists())
        self.assertFalse(self.output.exists())

    def test_project_selection_cannot_be_implicit_ambiguous_or_malformed(self):
        for change in ({"project_id": None}, {"project_selection": "account_default"},
                       {"project_selection": "auto"}, {"project_selection": None},
                       {"project_selection": "explicit", "project_id": ""},
                       {"project_selection": "explicit", "project_id": " project "}):
            with self.subTest(change=change):
                data = inputs(); data[2].update(change)
                with self.assertRaisesRegex(nu.UpdateError, "explicit_project_selection_required"):
                    nu.prepare_update(*data[:2], nt.seal(data[2], "config_hash"), data[3])
        data = inputs(); data[2].pop("project_id")
        with self.assertRaisesRegex(nu.UpdateError, "explicit_project_selection_required"):
            nu.prepare_update(*data[:2], nt.seal(data[2], "config_hash"), data[3])

    def test_failed_dispatch_retains_full_reservation_and_never_logs_provider_error(self):
        with self.assertRaisesRegex(nu.UpdateError, "update_failed"):
            self.run_mock(inputs(), fail="student_forward")
        report = nt.load_json(self.output / "result.json")
        self.assertEqual(report["status"], "failed_unknown")
        self.assertFalse(report["optimizer_acknowledged"])
        self.assertNotIn("SECRET", (self.output / "result.json").read_text())
        run = next(iter(nt.load_json(self.budget)["runs"].values()))
        self.assertEqual(run["reserved_usd"], self.fake.plan["cost"]["reserved_usd"])
        self.assertNotIn("optimizer", self.fake.calls)
        ledger = nu.BudgetLedger(self.budget, "MOCK-project", MODEL["id"], "1.00")
        with self.assertRaisesRegex(nu.UpdateError, "duplicate_plan"):
            ledger.reserve(self.fake.plan)

    def test_checkpoint_failure_preserves_acknowledged_update(self):
        with self.assertRaises(nu.UpdateError):
            self.run_mock(inputs(), fail="save_state")
        report = nt.load_json(self.output / "result.json")
        self.assertTrue(report["optimizer_acknowledged"])
        self.assertEqual(report["status"], "failed_unknown")
        self.assertTrue(next(iter(nt.load_json(self.budget)["runs"].values()))["optimizer_acknowledged"])

    def test_teacher_alignment_nonfinite_and_student_change_block_optimizer(self):
        for bad, code in (([-0.1], "teacher_sequence_alignment"), ([float("nan"), -1, -2], "logprob_alignment_or_value")):
            data = inputs()
            fake = FakeService(self.budget, nu.prepare_update(*data))
            fake.teacher = bad
            with self.assertRaises(nu.UpdateError):
                nu.execute_update(*data, budget_path=self.budget, cap_usd="1.00", output_dir=self.output,
                                  sdk=SDK, service_factory=fake.factory, retry_config_factory=NS)
            self.assertNotIn("optimizer", fake.calls)
            self.assertEqual(nt.load_json(self.output / "result.json")["error_code"], code)
            # Use a separate ledger/run directory, never delete a reservation.
            self.budget = self.root / "budget-second.json"
            self.output = self.root / "output-second"
        self.budget = self.root / "budget-changed.json"; self.output = self.root / "output-changed"
        with self.assertRaises(nu.UpdateError):
            self.run_mock(inputs(), fail="student_changed")
        self.assertNotIn("optimizer", self.fake.calls)

    def test_missing_capture_reviews_behavior_and_fixtures_reject_before_dispatch(self):
        for method in ("ppo", "sdpo"):
            with self.assertRaisesRegex(nu.UpdateError, "missing_original_behavior"):
                nu.prepare_update(*inputs(method, behavior=False))
        for field, value, code in (("status", "fixture_only", "unavailable"), ("review_hash", None, "review_and_runtime"),
                                   ("branch_id", "other", "cross_branch")):
            data = inputs()
            data[0]["sft"][0][field] = value
            with self.assertRaisesRegex(nu.UpdateError, code):
                nu.prepare_update(*self.reseal_bundle(data))
        data = inputs(); data[0]["sft"] = []
        with self.assertRaisesRegex(nu.UpdateError, "missing_accepted_capture"):
            nu.prepare_update(*self.reseal_bundle(data))

    def test_tool_results_learner_tokens_masks_and_reconstructed_tokens_reject(self):
        for field, value, code in (("loss_mask", [1, 1, 1, 1, 1], "causal_alignment"),
                                  ("completion_token_roles", ["tool_result"] * 3, "non_actor"),
                                  ("completion_token_roles", ["learner"] * 3, "non_actor"),
                                  ("prompt_token_ids", [], "original_actor"),
                                  ("target_tokens", [11, 12, 25, 26, 27], "causal_alignment")):
            data = inputs(); data[0]["sft"][0]["segment"][field] = value
            with self.assertRaisesRegex(nu.UpdateError, code):
                nu.prepare_update(*self.reseal_bundle(data))

    def test_tamper_source_holdout_alias_leakage_and_episode_pin(self):
        data = inputs(); data[0]["sft"][0]["training_eligible"] = False
        with self.assertRaisesRegex(nu.UpdateError, "invalid_export_hash"):
            nu.prepare_update(*data)
        for change, code in ((lambda m: m["families"][0]["sources"][0].update(original_split="test"), "protected_source"),
                             (lambda m: m["families"][0].update(protected=True), "protected_family"),
                             (lambda m: m["families"][0].update(split="validation"), "nontraining_family"),
                             (lambda m: m["episodes"][0].update(ledger_head="f"*64), "episode_split_binding"),
                             (lambda m: m["families"].append({**deepcopy(m["families"][0]), "family": "alias", "aliases": ["alias", "authored-family"], "split": "test"}), "cross_family_alias")):
            data = inputs(); manifest = deepcopy(data[1]); change(manifest)
            with self.assertRaisesRegex(nu.UpdateError, code):
                nu.prepare_update(data[0], nt.seal(manifest, "split_hash"), *data[2:])

    def test_teacher_prefix_and_review_temporal_binding(self):
        for field, value in (("feedback_hash", "e"*64), ("completion_token_ids", [1, 2, 3]),
                             ("original_request_hash", "f"*64), ("conditioning", "feedback_after_completion")):
            data = inputs(); signal = data[3]["signals"][0]
            signal["teacher_prefix"][field] = value
            signal["teacher_prefix"] = nt.seal(signal["teacher_prefix"], "prefix_hash")
            with self.assertRaises(nu.UpdateError):
                nu.prepare_update(*data[:3], nt.seal(data[3], "signals_hash"))
        data = inputs(); data[3]["signals"][0]["review"]["latest_allowed_event_id"] = "future"
        with self.assertRaisesRegex(nu.UpdateError, "invalid_review_hash"):
            nu.prepare_update(*data[:3], nt.seal(data[3], "signals_hash"))

    def test_budget_shared_sample_api_phase_order_and_total_cap(self):
        ledger = nu.BudgetLedger(self.budget, "MOCK-project", MODEL["id"], "1.00")
        plan = nt.seal({"operation": "sample", "cost": {"reserved_usd": "0.60"}, "phases": ["create_sampler", "sample"]}, "plan_hash")
        ledger.reserve(plan)
        with self.assertRaisesRegex(nu.UpdateError, "duplicate_or_unplanned"):
            ledger.before(plan, "sample")
        ledger.before(plan, "create_sampler"); ledger.before(plan, "sample"); ledger.mark(plan, status="complete")
        other = nt.seal({**plan, "operation": "sample-2"}, "plan_hash")
        with self.assertRaisesRegex(nu.UpdateError, "budget_cap_exceeded"):
            ledger.reserve(other)
        with self.assertRaisesRegex(nu.UpdateError, "budget_identity"):
            nu.BudgetLedger(self.budget, "MOCK-project", "OtherModel", "1.00").reserve(other)
        self.assertEqual(self.budget.stat().st_mode & 0o777, 0o600)

    def test_stale_student_and_missing_teacher_prefix_stop_before_backward(self):
        data = inputs()
        fake = FakeService(self.budget, nu.prepare_update(*data))
        fake.current = [-10, -1, -2]
        with self.assertRaises(nu.UpdateError):
            nu.execute_update(*data, budget_path=self.budget, cap_usd="1.00", output_dir=self.output,
                              sdk=SDK, service_factory=fake.factory, retry_config_factory=NS)
        self.assertNotIn("forward_backward", fake.calls)
        self.assertEqual(nt.load_json(self.output / "result.json")["error_code"], "stale_behavior_batch_rejected")
        data = inputs(); data[3]["signals"][0].pop("teacher_prefix")
        with self.assertRaisesRegex(nu.UpdateError, "invalid_prefix_hash"):
            nu.prepare_update(*data[:3], nt.seal(data[3], "signals_hash"))

    def test_plan_requires_pinned_initial_weights_and_prices_all_work(self):
        data = inputs()
        plan = nu.prepare_update(*data)
        self.assertEqual(plan["cost"]["teacher_prefill_tokens"], 8)
        self.assertEqual(plan["cost"]["train_token_allowance"], 10)
        self.assertEqual(Decimal(plan["cost"]["reserved_usd"]), Decimal("0.500190"))
        data[2]["model"]["revision"] = "main"
        with self.assertRaisesRegex(nu.UpdateError, "immutable_initial"):
            nu.prepare_update(data[0], data[1], nt.seal(data[2], "config_hash"), data[3])

    def test_two_process_reservations_cannot_oversubscribe_cap(self):
        # Both contenders pass a distinct plan; only one fits the shared cap.
        command = '''
import sys
sys.path.insert(0, sys.argv[1])
import native_training as nt
from native_tinker_update import BudgetLedger, UpdateError
plan = nt.seal({"operation": sys.argv[3], "cost": {"reserved_usd": "0.60"}, "phases": ["sample"]}, "plan_hash")
try:
    BudgetLedger(sys.argv[2], "MOCK-project", "MOCK-model", "1.00").reserve(plan)
except UpdateError:
    sys.exit(2)
'''
        env = {k: v for k, v in os.environ.items() if k not in {"PYTHONHOME", "PYTHONPATH", "TINKER_API_KEY"}}
        processes = [subprocess.Popen([sys.executable, "-c", command, str(Path(nu.__file__).parent), str(self.budget), str(i)],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for i in range(2)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(stdout, b""); self.assertEqual(stderr, b"")
        self.assertEqual(sorted(p.returncode for p in processes), [0, 2])
        self.assertEqual(len(nt.load_json(self.budget)["runs"]), 1)

    def test_dry_cli_requires_no_sdk_key_ledger_or_network(self):
        paths = []
        for name, value in zip(("exports", "splits", "config", "signals"), inputs()):
            path = self.root / (name + ".json"); nu.write_private(path, value); paths += ["--" + name, str(path)]
        env = {k: v for k, v in os.environ.items() if k not in {"PYTHONHOME", "PYTHONPATH", "TINKER_API_KEY"}}
        result = subprocess.run([sys.executable, str(Path(nu.__file__)), *paths], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "planned_no_dispatch")
        self.assertFalse(self.budget.exists())
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {"tinker": None}):
            self.assertEqual(nu.prepare_update(*inputs())["updates"], 1)

    @unittest.skipUnless(importlib.util.find_spec("tinker"), "optional pinned SDK not installed")
    def test_pinned_sdk_signatures_and_disabled_sampling_retry_configuration(self):
        import inspect
        import tinker
        from tinker.lib.retry_handler import RetryConfig
        self.assertEqual(nu.importlib.metadata.version("tinker"), "0.27.1")
        expected = {
            tinker.ServiceClient.create_training_client_from_state: {"path", "base_model", "user_metadata"},
            tinker.ServiceClient.create_sampling_client: {"model_path", "retry_config"},
            tinker.SamplingClient.compute_logprobs: {"prompt"},
            tinker.TrainingClient.forward: {"data", "loss_fn"},
            tinker.TrainingClient.forward_backward: {"data", "loss_fn", "loss_fn_config"},
            tinker.TrainingClient.optim_step: {"adam_params"},
            tinker.TrainingClient.save_state: {"name", "ttl_seconds"},
            tinker.TrainingClient.save_weights_for_sampler: {"name", "ttl_seconds"},
        }
        for method, parameters in expected.items():
            self.assertTrue(parameters <= set(inspect.signature(method).parameters), method.__name__)
        self.assertFalse(RetryConfig(enable_retry_logic=False).enable_retry_logic)

    @unittest.skipUnless(importlib.util.find_spec("tinker"), "optional pinned SDK not installed")
    def test_real_sdk_constructs_typed_data_without_a_client(self):
        import tinker
        segment = inputs()[0]["sft"][0]["segment"]
        value = nu.datum(tinker, segment, 1, [1, -1, 0])
        self.assertEqual(value.model_input.to_ints(), segment["input_tokens"])
        for actual, expected in zip(value.loss_fn_inputs["logprobs"].data, [0, 0, -0.4, -0.8, -1]):
            self.assertAlmostEqual(actual, expected, places=6)


class NegativePolicyContracts(unittest.TestCase):
    def test_rejected_action_is_negative_policy_evidence_only(self):
        bundle, manifest, config, signals = inputs("ppo", accepted=False)
        self.assertEqual(bundle["sft"], [])
        plan = nu.prepare_update(bundle, manifest, config, signals)
        self.assertEqual(plan["projection"], "policy_segments")
        self.assertEqual(plan["rows"][0]["signal"]["review_decision"], "rejected")
        self.assertTrue(all(v <= 0 for v in plan["rows"][0]["signal"]["advantages"]))
        for method in ("sft", "sdpo"):
            changed = nt.seal({**config, "method": method}, "config_hash")
            with self.assertRaises(nu.UpdateError):
                nu.prepare_update(bundle, manifest, changed, signals)

    def test_rejection_cannot_reward_tokens_or_invent_acceptance(self):
        bundle, manifest, config, signals = inputs("ppo", accepted=False)
        for values in ([0, 0, 0], [1, -2, -0.25]):
            bad = deepcopy(signals)
            bad["signals"][0]["advantages"] = values
            with self.assertRaisesRegex(nu.UpdateError, "rejected_action_requires_negative_advantages"):
                nu.prepare_update(bundle, manifest, config, nt.seal(bad, "signals_hash"))
        bundle["policy_segments"][0]["review_decision"] = "accepted"
        bundle = nt.seal(bundle, "export_hash")
        manifest = nt.seal({**manifest, "export_hash": bundle["export_hash"]}, "split_hash")
        signals = nt.seal({**signals, "export_hash": bundle["export_hash"]}, "signals_hash")
        with self.assertRaisesRegex(nu.UpdateError, "independent_review_decision_mismatch"):
            nu.prepare_update(bundle, manifest, config, signals)

    def test_submission_failure_does_not_retry_or_patch_other_holders(self):
        import asyncio
        old = lambda operation: None
        first, other = NS(holder=NS(execute_with_retries=old)), NS(holder=NS(execute_with_retries=old))
        nu.disable_internal_retries(first)
        calls = []
        async def fail():
            calls.append("submitted")
            raise TimeoutError("unknown remote outcome")
        with self.assertRaises(TimeoutError):
            asyncio.run(first.holder.execute_with_retries(fail))
        self.assertEqual(calls, ["submitted"])
        self.assertIs(other.holder.execute_with_retries, old)

    @unittest.skipUnless(importlib.util.find_spec("tinker"), "optional pinned SDK not installed")
    def test_actual_sdk_retry_seam_is_source_pinned(self):
        nu.audit_sdk()


class HostedCheckpointPaths(unittest.TestCase):
    def test_provider_session_suffix_is_preserved(self):
        # Shape returned by the first real save_state, not the old mock-only ID.
        path = "tinker://b0a238b0-9465-5079-9d45-a3b128b0b605:train:0/weights/native-initial"
        self.assertTrue(nu.checkpoint(path))
        self.assertTrue(nu.checkpoint(path.replace("/weights/", "/sampler_weights/"), "sampler_weights"))
        for bad in (path + "/extra", path + "?key=x", path.replace(":train:0", ":"),
                    path.replace(":train:0", "::train:0"), path.replace("tinker://", "https://")):
            self.assertFalse(nu.checkpoint(bad))


if __name__ == "__main__":
    unittest.main()
