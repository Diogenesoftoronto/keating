# /// script
# requires-python = ">=3.11"
# dependencies = ["tinker==0.27.1", "certifi"]
# ///
"""Create one immutable, untrained Qwen adapter and sampler with bounded storage.

The default CLI writes a plan only. Execution requires an allocated budget;
this creates no training example, sample, gradient, or optimizer update.
"""
import argparse
from copy import deepcopy
import hashlib
import importlib.metadata
import os
from pathlib import Path
import re

import native_training as nt
from native_tinker_update import BudgetLedger, UpdateError, checkpoint, need, write_private

MODEL = "Qwen/Qwen3.5-9B-Base"
SDK_SOURCES = {
    "tinker/lib/public_interfaces/service_client.py": "cd54efc12ce8982f26a49a9bab67e14db6606a5ca7681c6671ef77ab319e0efe",
    "tinker/lib/public_interfaces/training_client.py": "92a0b666a1006fe648e985c85c71e63d8eedaa114b0e91167ae14a029bbf31d6",
    "tinker/lib/internal_client_holder.py": "b74b910177bdc9724707d7e8a8496fb805c07c86baaf0fb68a740c020013e785",
}


def bootstrap_plan(project_id=None):
    need(project_id is None or type(project_id) is str and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", project_id), "invalid_project")
    return nt.seal({
        "schema_version": 1, "kind": "native-tinker-bootstrap/v1",
        "model": MODEL, "rank": 32, "seed": 42, "ttl_seconds": 86400,
        "project_selection": "account_default" if project_id is None else "explicit",
        "project_id": project_id, "sdk_version": "0.27.1",
        "sdk_source_hashes": dict(SDK_SOURCES),
        "phases": ["create_service", "create_trainer", "get_info", "save_state", "save_sampler"],
        "retry_policy": "http_zero_checkpoint_submission_single_attempt",
        "cost": {"reserved_usd": "1", "purpose": "Checkpoint bootstrap and at most one day of storage",
                 "source": "https://tinker-docs.thinkingmachines.ai/tinker/models/",
                 "verified_on": "2026-09-13", "storage_usd_per_gb_month": "0.10",
                 "sample_tokens": 0, "training_tokens": 0},
    }, "plan_hash")


def audit_sdk():
    """Read installed code only; no client construction or credential access."""
    distribution = importlib.metadata.distribution("tinker")
    need(distribution.version == "0.27.1", "sdk_version_mismatch")
    for relative, expected in SDK_SOURCES.items():
        need(hashlib.sha256(Path(distribution.locate_file(relative)).read_bytes()).hexdigest() == expected,
             "sdk_source_mismatch")


async def _single_attempt(operation, *args, **kwargs):
    return await operation(*args, **kwargs)


def disable_checkpoint_retries(trainer):
    """0.27.1 saves retry above HTTP. Limit this trainer's holder only.

    This deliberately version-pinned private seam changes submission retries,
    not future-result polling. No global SDK class is patched. Leave it installed
    on failure so a timed-out save cannot restart its internal submission loop.
    Creating the trainer/session already uses the HTTP max_retries=0 setting.
    """
    holder = trainer.holder
    need(callable(getattr(holder, "execute_with_retries", None)), "sdk_retry_boundary_missing")
    holder.execute_with_retries = _single_attempt


def bootstrap_qwen(plan, *, ledger_path, output_dir, sdk=None, service_factory=None):
    plan = deepcopy(plan)
    need(type(plan) is dict and plan == bootstrap_plan(plan.get("project_id")), "bootstrap_plan_mismatch")
    # This is a pre-funded $1 subledger, never the $100 shared allocation ledger.
    # Parent initializes it with project=<project-id or account-default>, model=MODEL,
    # cap="1" only after reserving the matching grant from the shared budget.
    need(Path(ledger_path).is_file(), "parent_funded_ledger_required")
    need(bool(os.environ.get("TINKER_API_KEY", "").strip()), "TINKER_API_KEY_required")
    need(plan["project_selection"] != "account_default" or not os.environ.get("TINKER_PROJECT_ID"),
         "account_default_requires_unset_TINKER_PROJECT_ID")
    if sdk is None:
        audit_sdk()
    directory = Path(output_dir)
    directory.mkdir(parents=True, mode=0o700, exist_ok=False)
    write_private(directory / "plan.json", plan)
    ledger = BudgetLedger(ledger_path, plan["project_id"] or "account-default", MODEL, "1")
    ledger.reserve(plan)
    result = {"schema_version": 1, "plan_hash": plan["plan_hash"], "status": "reserved",
              "measurement": "untrained_checkpoint_bootstrap", "training_steps": 0,
              "sample_tokens": 0, "ttl_seconds_requested": plan["ttl_seconds"],
              "project_selection": plan["project_selection"], "project_id": plan["project_id"],
              "acknowledged_phases": [], "last_dispatched": None}

    def dispatch(phase):
        ledger.before(plan, phase)
        result["last_dispatched"] = phase
        write_private(directory / "result.json", result)

    try:
        write_private(directory / "result.json", result)
        if sdk is None:
            import tinker as sdk
        factory = service_factory or sdk.ServiceClient
        dispatch("create_service")
        project = {"project_id": plan["project_id"]} if plan["project_selection"] == "explicit" else {}
        service = factory(api_key=os.environ["TINKER_API_KEY"], **project,
                          max_retries=0, timeout=60, user_metadata={"research_plan": plan["plan_hash"]})
        result["acknowledged_phases"].append("create_service")
        dispatch("create_trainer")
        trainer = service.create_lora_training_client(MODEL, rank=plan["rank"], seed=plan["seed"],
                    train_mlp=True, train_attn=True, train_unembed=True,
                    user_metadata={"research_plan": plan["plan_hash"], "purpose": "untrained bootstrap"})
        result["acknowledged_phases"].append("create_trainer")
        disable_checkpoint_retries(trainer)
        dispatch("get_info")
        info = trainer.get_info()
        result["provider_model_info"] = info.model_dump(mode="json")
        result["acknowledged_phases"].append("get_info")
        write_private(directory / "result.json", result)
        need(info.model_data.model_name == MODEL and info.model_data.tokenizer_id == MODEL,
             "provider_model_identity_mismatch")
        name = "native-initial-" + plan["plan_hash"][:16]
        result["checkpoint_name"] = name
        dispatch("save_state")
        initial = trainer.save_state(name, ttl_seconds=plan["ttl_seconds"], overwrite=False).result(timeout=240)
        result["save_state_response"] = initial.model_dump(mode="json")
        result["acknowledged_phases"].append("save_state")
        write_private(directory / "result.json", result)
        need(checkpoint(initial.path), "invalid_training_checkpoint")
        result["training_checkpoint"] = initial.path
        result["status"] = "training_checkpoint_saved"
        write_private(directory / "result.json", result)
        dispatch("save_sampler")
        sampler = trainer.save_weights_for_sampler(name, ttl_seconds=plan["ttl_seconds"]).result(timeout=240)
        result["save_sampler_response"] = sampler.model_dump(mode="json")
        result["acknowledged_phases"].append("save_sampler")
        write_private(directory / "result.json", result)
        need(checkpoint(sampler.path, "sampler_weights"), "invalid_sampler_checkpoint")
        result.update(status="complete", sampler_checkpoint=sampler.path)
        write_private(directory / "result.json", result)
        ledger.mark(plan, status="complete")
        return result
    except BaseException as error:
        result.update(status="failed_unknown", error_type=type(error).__name__)
        # Preserve every acknowledged save even if the following operation failed.
        # A timed-out operation may still complete remotely; never retry or refund.
        try:
            write_private(directory / "result.json", result)
        finally:
            ledger.mark(plan, status="failed_unknown")
        raise UpdateError("bootstrap_failed_see_private_result_and_retained_reservation") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", help="Omit to explicitly use the authenticated account's Default project")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--allocated-ledger", type=Path)
    args = parser.parse_args(argv)
    if args.execute and not args.allocated_ledger:
        parser.error("--execute requires --allocated-ledger funded from the shared research budget")
    try:
        plan = bootstrap_plan(args.project_id)
        if not args.execute:
            args.output.mkdir(parents=True, mode=0o700, exist_ok=False)
            write_private(args.output / "plan.json", plan)
            print(nt.native_json({"status": "planned_no_dispatch", "plan_hash": plan["plan_hash"], "cost": plan["cost"]}))
            return 0
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        result = bootstrap_qwen(plan, ledger_path=args.allocated_ledger, output_dir=args.output)
        print(nt.native_json(result))
        return 0
    except Exception as error:
        print(nt.native_json({"status": "bootstrap_rejected_or_failed", "error_type": type(error).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
