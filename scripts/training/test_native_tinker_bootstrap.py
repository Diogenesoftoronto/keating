"""Mock-only bootstrap execution; optional installed SDK audit creates no client."""
import asyncio
from copy import deepcopy
import importlib.util
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import native_tinker_bootstrap as nb
import native_training as nt
from native_tinker_update import BUDGET_KIND, BudgetLedger, UpdateError, write_private


class Response(NS):
    def model_dump(self, mode):
        assert mode == "json"
        return deepcopy(vars(self))


class MockBootstrap:
    """Only creation, identity and saves exist; any training/sampling call fails."""
    def __init__(self, ledger, plan, fail=None):
        self.ledger, self.plan, self.fail = ledger, plan, fail
        self.calls, self.arguments = [], {}
        self.holder = NS(execute_with_retries=self.retrying)

    async def retrying(self, operation, *args, **kwargs):
        raise AssertionError("original SDK retry loop must be replaced before saves")

    def check(self, phase, **arguments):
        run = nt.load_json(self.ledger)["runs"][self.plan["plan_hash"]]
        assert run["reserved_usd"] == "1"
        assert run["dispatched"] == self.plan["phases"][:len(self.calls)+1]
        assert run["dispatched"][-1] == phase
        self.calls.append(phase)
        self.arguments[phase] = arguments
        if self.fail == phase:
            raise RuntimeError("SECRET-PROVIDER-MESSAGE")

    def factory(self, **kwargs):
        self.check("create_service", **kwargs)
        return self

    def create_lora_training_client(self, base_model, **kwargs):
        self.check("create_trainer", base_model=base_model, **kwargs)
        return self

    def get_info(self):
        self.check("get_info")
        assert self.holder.execute_with_retries is nb._single_attempt
        model = nb.MODEL if self.fail != "wrong_identity" else "OTHER-MODEL"
        value = {"model_id": "MOCK-model", "model_data": {"model_name": model, "tokenizer_id": nb.MODEL}}
        return NS(model_data=NS(**value["model_data"]), model_dump=lambda **_: deepcopy(value))

    def save_state(self, name, **kwargs):
        self.check("save_state", name=name, **kwargs)
        return NS(result=lambda timeout: self.saved("save_state", timeout))

    def save_weights_for_sampler(self, name, **kwargs):
        self.check("save_sampler", name=name, **kwargs)
        return NS(result=lambda timeout: self.saved("save_sampler", timeout))

    def saved(self, phase, timeout):
        assert timeout == 240
        if self.fail == phase + "_timeout":
            raise TimeoutError("SECRET-TIMEOUT-MESSAGE")
        kind = "weights" if phase == "save_state" else "sampler_weights"
        path = f"tinker://MOCK-model/{kind}/initial"
        if self.fail == phase + "_invalid_path":
            path = "invalid-provider-checkpoint"
        return Response(path=path)


class NativeTinkerBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ledger, self.output = self.root / "allocation.json", self.root / "bootstrap"
        self.environment = patch.dict(os.environ, {"TINKER_API_KEY": "MOCK-not-a-key"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def fund(self, project=None, cap="1", model=nb.MODEL):
        # Explicit parent-grant fixture, not new money created by the bootstrap.
        write_private(self.ledger, nt.seal({"kind": BUDGET_KIND,
            "project_id": project or "account-default", "model_id": model,
            "cap_usd": cap, "runs": {}}, "ledger_hash"))

    def run_mock(self, plan=None, fail=None, output=None):
        plan = plan or nb.bootstrap_plan()
        self.fake = MockBootstrap(self.ledger, plan, fail)
        return nb.bootstrap_qwen(plan, ledger_path=self.ledger, output_dir=output or self.output,
            sdk=NS(), service_factory=self.fake.factory)

    def test_default_and_explicit_project_fresh_checkpoint_calls_and_ttl(self):
        for index, project in enumerate((None, "MOCK-project")):
            with self.subTest(project=project):
                self.fund(project)
                plan = nb.bootstrap_plan(project)
                result = self.run_mock(plan, output=self.root / str(index))
                self.assertEqual(self.fake.calls, plan["phases"])
                self.assertEqual(result["status"], "complete")
                self.assertEqual(result["training_steps"], 0)
                self.assertEqual(result["sample_tokens"], 0)
                self.assertEqual(result["acknowledged_phases"], plan["phases"])
                service = self.fake.arguments["create_service"]
                self.assertEqual(service["max_retries"], 0)
                self.assertEqual(service["timeout"], 60)
                if project is None:
                    self.assertNotIn("project_id", service)
                else:
                    self.assertEqual(service["project_id"], project)
                created = self.fake.arguments["create_trainer"]
                self.assertEqual((created["base_model"], created["rank"], created["seed"]), (nb.MODEL, 32, 42))
                for phase in ("save_state", "save_sampler"):
                    self.assertEqual(self.fake.arguments[phase]["ttl_seconds"], 86400)
                self.assertFalse(self.fake.arguments["save_state"]["overwrite"])
                run = nt.load_json(self.ledger)["runs"][plan["plan_hash"]]
                self.assertEqual(run["status"], "complete")
                self.assertFalse(run["optimizer_acknowledged"])
                self.assertEqual((self.root / str(index) / "result.json").stat().st_mode & 0o777, 0o600)

    def test_missing_allocation_never_creates_new_money_or_dispatches(self):
        with self.assertRaisesRegex(UpdateError, "parent_funded_ledger_required"):
            self.run_mock()
        self.assertFalse(self.ledger.exists())
        self.assertFalse(self.output.exists())
        self.assertEqual(self.fake.calls, [])

    def test_shared_or_wrong_allocation_and_exhausted_cap_stop_before_client(self):
        for index, mode in enumerate(("shared", "wrong_project", "exhausted")):
            self.fund(model="shared-runpod-and-tinker" if mode == "shared" else nb.MODEL,
                      project="wrong" if mode == "wrong_project" else None)
            if mode == "exhausted":
                BudgetLedger(self.ledger, "account-default", nb.MODEL, "1").reserve(nt.seal({
                    "kind": "MOCK-prior", "phases": ["sample"], "cost": {"reserved_usd": "0.01"}}, "plan_hash"))
            before = self.ledger.read_bytes()
            with self.assertRaises(UpdateError):
                self.run_mock(output=self.root / str(index))
            self.assertEqual(self.fake.calls, [])
            self.assertEqual(self.ledger.read_bytes(), before)

    def test_ambient_project_cannot_override_explicit_account_default(self):
        self.fund()
        with patch.dict(os.environ, {"TINKER_PROJECT_ID": "unintended-project"}):
            with self.assertRaisesRegex(UpdateError, "account_default_requires_unset"):
                self.run_mock()
        self.assertEqual(self.fake.calls, [])
        self.assertFalse(self.output.exists())
        self.fund("explicit-project")
        with patch.dict(os.environ, {"TINKER_PROJECT_ID": "unintended-project"}):
            result = self.run_mock(nb.bootstrap_plan("explicit-project"))
        self.assertEqual(result["project_id"], "explicit-project")

    def test_plan_changes_and_missing_key_reject_without_reservation(self):
        self.fund()
        for field, value in (("model", "other"), ("ttl_seconds", None), ("rank", 128), ("phases", ["optimizer"])):
            plan = nb.bootstrap_plan(); plan[field] = value
            with self.assertRaisesRegex(UpdateError, "bootstrap_plan_mismatch"):
                self.run_mock(nt.seal(plan, "plan_hash"))
            self.assertEqual(self.fake.calls, [])
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(UpdateError, "TINKER_API_KEY_required"):
                self.run_mock()
        self.assertEqual(nt.load_json(self.ledger)["runs"], {})

    def test_sdk_audit_failure_precedes_reservation_and_service_creation(self):
        self.fund()
        before = self.ledger.read_bytes()
        with patch.object(nb, "audit_sdk", side_effect=UpdateError("sdk_source_mismatch")):
            with self.assertRaisesRegex(UpdateError, "sdk_source_mismatch"):
                nb.bootstrap_qwen(nb.bootstrap_plan(), ledger_path=self.ledger, output_dir=self.output)
        self.assertEqual(self.ledger.read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_duplicate_success_or_failed_plan_never_dispatches_twice(self):
        for index, failure in enumerate((None, "save_sampler_timeout")):
            self.fund()
            if failure:
                with self.assertRaises(UpdateError): self.run_mock(fail=failure, output=self.root / f"first-{index}")
            else:
                self.run_mock(output=self.root / f"first-{index}")
            before = self.ledger.read_bytes()
            with self.assertRaisesRegex(UpdateError, "duplicate_plan_no_automatic_retry"):
                self.run_mock(output=self.root / f"retry-{index}")
            self.assertEqual(self.fake.calls, [])
            self.assertEqual(self.ledger.read_bytes(), before)

    def test_sampler_timeout_retains_training_checkpoint_and_unknown_pending_save(self):
        self.fund()
        with self.assertRaisesRegex(UpdateError, "bootstrap_failed_see_private_result"):
            self.run_mock(fail="save_sampler_timeout")
        result = nt.load_json(self.output / "result.json")
        self.assertEqual(result["status"], "failed_unknown")
        self.assertEqual(result["training_checkpoint"], "tinker://MOCK-model/weights/initial")
        self.assertEqual(result["save_state_response"]["path"], result["training_checkpoint"])
        self.assertEqual(result["last_dispatched"], "save_sampler")
        self.assertNotIn("save_sampler", result["acknowledged_phases"])
        self.assertNotIn("sampler_checkpoint", result)
        self.assertNotIn("SECRET", (self.output / "result.json").read_text())
        run = nt.load_json(self.ledger)["runs"][nb.bootstrap_plan()["plan_hash"]]
        self.assertEqual((run["status"], run["reserved_usd"]), ("failed_unknown", "1"))

    def test_state_timeout_and_wrong_identity_prevent_sampler_save(self):
        for index, fail in enumerate(("save_state_timeout", "wrong_identity", "create_trainer")):
            self.fund()
            output = self.root / str(index)
            with self.assertRaises(UpdateError): self.run_mock(fail=fail, output=output)
            self.assertNotIn("save_sampler", self.fake.calls)
            result = nt.load_json(output / "result.json")
            self.assertNotIn("training_checkpoint", result)
            self.assertNotIn("SECRET", (output / "result.json").read_text())

    def test_acknowledged_but_invalid_save_response_is_preserved_for_reconciliation(self):
        self.fund()
        with self.assertRaises(UpdateError): self.run_mock(fail="save_sampler_invalid_path")
        result = nt.load_json(self.output / "result.json")
        self.assertEqual(result["save_sampler_response"]["path"], "invalid-provider-checkpoint")
        self.assertIn("save_sampler", result["acknowledged_phases"])
        self.assertNotIn("sampler_checkpoint", result)
        self.assertIn("training_checkpoint", result)

    def test_checkpoint_retry_override_is_instance_local_and_calls_once_on_failure(self):
        class Holder:
            async def execute_with_retries(self, operation): raise AssertionError("retry loop")
        holder, untouched = Holder(), Holder()
        original = Holder.execute_with_retries
        nb.disable_checkpoint_retries(NS(holder=holder))
        calls = []
        async def reject():
            calls.append("submission")
            raise TimeoutError("unknown remote completion")
        with self.assertRaises(TimeoutError): asyncio.run(holder.execute_with_retries(reject))
        self.assertEqual(calls, ["submission"])
        self.assertIs(Holder.execute_with_retries, original)
        self.assertNotIn("execute_with_retries", untouched.__dict__)

    def test_plan_cli_runs_without_sdk_key_or_ledger_and_rejects_overwrite(self):
        environment = {k:v for k,v in os.environ.items() if k not in {"TINKER_API_KEY", "PYTHONHOME", "PYTHONPATH"}}
        command = [sys.executable, nb.__file__, "--output", str(self.output)]
        result = subprocess.run(command, env=environment, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "planned_no_dispatch")
        self.assertEqual(nt.load_json(self.output / "plan.json"), nb.bootstrap_plan())
        self.assertFalse(self.ledger.exists())
        self.assertEqual(subprocess.run(command, env=environment, capture_output=True).returncode, 1)
        with patch.dict(sys.modules, {"tinker": None}), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(nb.bootstrap_plan()["cost"]["reserved_usd"], "1")

    @unittest.skipUnless(importlib.util.find_spec("tinker"), "optional pinned SDK not installed")
    def test_installed_0271_signatures_and_source_audit_without_client_creation(self):
        import tinker
        from tinker.lib.internal_client_holder import InternalClientHolder
        nb.audit_sdk()
        # No __init__, thread, client, auth, or network: verify the pinned class
        # permits the same instance-local override used after real creation.
        holder = object.__new__(InternalClientHolder)
        holder.close = lambda: None  # no initialized SDK resources to clean up
        original = InternalClientHolder.execute_with_retries
        nb.disable_checkpoint_retries(NS(holder=holder))
        self.assertIs(holder.execute_with_retries, nb._single_attempt)
        self.assertIs(InternalClientHolder.execute_with_retries, original)
        expected = {
            tinker.ServiceClient: {"project_id", "user_metadata", "kwargs"},
            tinker.ServiceClient.create_lora_training_client: {"base_model", "rank", "seed", "train_mlp", "train_attn", "train_unembed", "user_metadata"},
            tinker.TrainingClient.get_info: {"self"},
            tinker.TrainingClient.save_state: {"name", "ttl_seconds", "overwrite"},
            tinker.TrainingClient.save_weights_for_sampler: {"name", "ttl_seconds"},
        }
        for method, parameters in expected.items():
            self.assertTrue(parameters <= set(inspect.signature(method).parameters), method.__name__)
        # Bind real method signatures to the exact mock-observed call arguments.
        self.fund(); self.run_mock()
        inspect.signature(tinker.ServiceClient).bind(**self.fake.arguments["create_service"])
        for phase, method in (("create_trainer", tinker.ServiceClient.create_lora_training_client),
                              ("save_state", tinker.TrainingClient.save_state),
                              ("save_sampler", tinker.TrainingClient.save_weights_for_sampler)):
            inspect.signature(method).bind(None, **self.fake.arguments[phase])


if __name__ == "__main__":
    unittest.main()
