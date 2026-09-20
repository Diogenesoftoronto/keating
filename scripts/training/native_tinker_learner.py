# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["tinker==0.27.1", "tinker-cookbook==0.5.7", "transformers==5.3.0", "torch==2.10.0", "typer>=0.12", "certifi"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Separate funded instruction-model learner; never an actor training capture.

Import, draft, audit and plan are account-free. Only a valid request to an
operator-started server can create a Tinker service, after reservation.
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, ROUND_CEILING
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.metadata
import json
import logging
import math
import os
from pathlib import Path
import queue
import re
import ssl
import subprocess
import threading
import time
import uuid

import native_training as nt
from native_tinker_update import BudgetLedger, BUDGET_KIND, dollars, need, sealed, write_private
from research_access import certificate_context, skate_secret

ROOT = Path(__file__).resolve().parents[2]
MODEL = "Qwen/Qwen3.5-9B"
HF_REVISION = "c202236235762e1c871ad0ccb60c8ee5ba337b9a"
HF_HASHES = {
    "tokenizer.json": "5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42",
    "tokenizer_config.json": "316230d6a809701f4db5ea8f8fc862bc3a6f3229c937c174e674ff3ca0a64ac8",
    "chat_template.jinja": "a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715",
}
VERSIONS = {"tinker": "0.27.1", "tinker-cookbook": "0.5.7", "transformers": "5.3.0"}
SOURCE_HASHES = {
    "tinker/lib/retry_handler.py": "8dba752fbf61860c53a76a61aeff950e62ecc0f01fc28b5992347a5785809abf",
    "tinker/lib/public_interfaces/sampling_client.py": "86a5bb4a90cddb3528b10ea93d13bd1bf0ec7aaa7ea3072110beeeeafe1c975e",
    "tinker/lib/public_interfaces/service_client.py": "cd54efc12ce8982f26a49a9bab67e14db6606a5ca7681c6671ef77ab319e0efe",
    "tinker/lib/internal_client_holder.py": "b74b910177bdc9724707d7e8a8496fb805c07c86baaf0fb68a740c020013e785",
    "tinker_cookbook/renderers/qwen3_5.py": "aa786b03f97a016f65ed43f687e738fd52eedb0dc6240e9e2698f9e1a3253f81",
    "tinker_cookbook/renderers/qwen3.py": "ec26c77a2de649fc1994063f7c07ac2dcd3b6996fcb4ce707ecc1d6d5b68802a",
    "tinker_cookbook/renderers/base.py": "ee9beaaf1bfc467c2f340b33a3cd5dd76a1c4225412ff1382f9f618432a3a560",
    "tinker_cookbook/renderers/__init__.py": "eed8ac75b889e60dfa4b69bbd9ebb39c18cc1070542a65321104f0d6c798627d",
}
RENDERER = "qwen3_5_disable_thinking"
RENDERER_HASH = nt.native_hash({k: v for k, v in SOURCE_HASHES.items() if k.startswith("tinker_cookbook/")})
IM_END = 248046
MAX_BODY = 512 * 1024
PARENT_PROJECT = "keating-native-research-2026-09-13"
PARENT_MODEL = "shared-runpod-and-tinker"
RETRY_SCOPE = (
    "Application dispatch once; HTTP max_retries=0 and sampling RetryConfig.enable_retry_logic=False. "
    "SDK 0.27.1 still has holder.execute_with_retries and sampling backpressure/billing loops. "
    "Deadline does not prove remote cancellation; halt and retain full reservation."
)


def learner_config(value=None):
    draft = {
        "schema_version": 1, "kind": "native-tinker-learner/v1",
        "model": {"id": MODEL, "hf_revision": HF_REVISION,
                  "provider_weight_revision": "not_attested_by_tinker_base_model_api"},
        "tokenizer": {"id": MODEL, "revision": HF_REVISION, "files": dict(HF_HASHES)},
        "renderer": {"name": RENDERER, "source_hash": RENDERER_HASH},
        "versions": dict(VERSIONS),
        "project_selection": "account_default", "project_id": None,
        "sampling": {"temperature": 1, "top_p": 1, "top_k": -1},
        "limits": {"context_tokens": 32768, "max_output_tokens": 2048, "timeout_seconds": 120},
        "allocation": {"id": None, "ledger_path": None, "budget_project_id": None,
                       "cap_usd": None, "parent_ledger_path": None},
        "pricing": {"input_usd_per_million": "0.66", "output_usd_per_million": "1.995",
                    "safety_factor": 5, "setup_upper_bound_usd": "0",
                    "source": "https://tinker-docs.thinkingmachines.ai/tinker/models/",
                    "verified_on": "2026-09-13"},
    }
    if value is None:
        return draft
    value = copy.deepcopy(value)
    sealed(value, "config_hash")
    need(set(value) == set(draft) | {"config_hash"}, "learner_config_fields")
    for field in ("schema_version", "kind", "model", "tokenizer", "renderer", "versions", "sampling", "pricing"):
        need(nt.native_json(value[field]) == nt.native_json(draft[field]), "unsupported_learner_pin_" + field)
    need((value["project_selection"] == "account_default" and value["project_id"] is None)
         or (value["project_selection"] == "explicit" and type(value["project_id"]) is str
             and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", value["project_id"])), "explicit_project_selection_required")
    lim = value["limits"]
    need(type(lim) is dict and set(lim) == set(draft["limits"])
         and all(type(v) is int for v in lim.values())
         and 1 <= lim["max_output_tokens"] <= 4096
         and lim["max_output_tokens"] < lim["context_tokens"] <= 65536
         and 1 <= lim["timeout_seconds"] <= 300, "bounded_learner_limits_required")
    alloc = value["allocation"]
    need(type(alloc) is dict and set(alloc) == set(draft["allocation"]), "allocation_fields")
    need(type(alloc["id"]) is str and re.fullmatch(r"[a-f0-9]{64}", alloc["id"]), "parent_grant_hash_required")
    need(type(alloc["budget_project_id"]) is str
         and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", alloc["budget_project_id"])
         and alloc["budget_project_id"] != PARENT_PROJECT, "dedicated_child_project_required")
    need(0 < dollars(alloc["cap_usd"]) <= 100, "bounded_child_cap_required")
    for key in ("ledger_path", "parent_ledger_path"):
        need(type(alloc[key]) is str and Path(alloc[key]).is_absolute(), "absolute_ledger_path_required")
        private_path(alloc[key])
    need(Path(alloc["ledger_path"]).resolve() != Path(alloc["parent_ledger_path"]).resolve(), "dedicated_child_ledger_required")
    return value


def private_path(value):
    path = Path(value).absolute()
    need(path == path.resolve() and path.is_relative_to(ROOT / ".keating"), "private_ignored_path_required")
    result = subprocess.run(["git", "check-ignore", "--quiet", "--no-index", str(path)],
                            cwd=ROOT, capture_output=True)
    need(result.returncode == 0, "private_ignored_path_required")
    return path


def funded_ledger(config):
    """Validate two existing ledgers. Never mint authority from a config cap."""
    alloc = config["allocation"]
    paths = [private_path(alloc[k]) for k in ("ledger_path", "parent_ledger_path")]
    for path in paths:
        need(path.is_file() and not path.stat().st_mode & 0o077, "private_parent_funded_ledgers_required")
    child, parent = [nt.load_json(path) for path in paths]
    for value in (child, parent):
        sealed(value, "ledger_hash")
        need(value.get("kind") == BUDGET_KIND and type(value.get("runs")) is dict, "funded_ledger_schema")
    need(parent.get("project_id") == PARENT_PROJECT and parent.get("model_id") == PARENT_MODEL
         and parent.get("cap_usd") == "100", "shared_research_budget_identity_required")
    need(sum((dollars(r["reserved_usd"]) for r in parent["runs"].values()), Decimal(0)) <= 100,
         "shared_parent_cap_exceeded")
    grant = parent["runs"].get(alloc["id"])
    need(grant is not None and grant.get("status") == "complete"
         and grant.get("dispatched") == grant.get("phases") and bool(grant.get("phases"))
         and dollars(grant["reserved_usd"]) >= dollars(alloc["cap_usd"]), "completed_parent_grant_required")
    need(child.get("project_id") == alloc["budget_project_id"] and child.get("model_id") == MODEL
         and child.get("cap_usd") == str(dollars(alloc["cap_usd"]))
         and child.get("parent_allocation") == {"ledger_path": str(paths[1]), "plan_hash": alloc["id"]},
         "funded_child_identity_or_parent_mismatch")
    # A failed or interrupted process cannot be hidden by starting another bridge.
    need(all(r.get("status") == "complete" for r in child["runs"].values()), "child_has_unreconciled_run")
    return BudgetLedger(paths[0], alloc["budget_project_id"], MODEL, alloc["cap_usd"])


def validate_request(body, config):
    allowed = {"model", "messages", "max_tokens", "temperature", "tools", "stream", "store"}
    need(type(body) is dict and not set(body) - allowed and body.get("model") == MODEL, "learner_request_fields_or_model")
    limit = body.get("max_tokens")
    need(type(limit) is int and 1 <= limit <= config["limits"]["max_output_tokens"], "learner_max_tokens_bound")
    need(type(body.get("temperature", 1)) in (int, float) and body.get("temperature", 1) == 1,
         "fixed_learner_temperature_required")
    need(body.get("stream", False) is False and body.get("store", False) is False
         and type(body.get("tools", [])) is list and not body.get("tools", []), "learner_text_only_no_tools")
    messages = body.get("messages")
    need(type(messages) is list and 1 <= len(messages) <= 128, "learner_messages_required")
    for message in messages:
        need(type(message) is dict and set(message) == {"role", "content"}
             and message["role"] in {"system", "user", "assistant"}
             and type(message["content"]) is str and bool(message["content"].strip()), "learner_text_messages_only")
    need(messages[-1]["role"] == "user", "learner_final_user_message_required")
    need(len(json.dumps(body, ensure_ascii=False, allow_nan=False).encode()) <= MAX_BODY, "learner_body_limit")
    return copy.deepcopy(messages), {**config["sampling"], "max_tokens": limit}


def cost_plan(config, body, prompt_ids, *, create_client=True, request_id=None):
    _, settings = validate_request(body, config)
    need(type(prompt_ids) is list and prompt_ids and all(type(v) is int and 0 <= v < 2**31 for v in prompt_ids),
         "original_prompt_ids_required")
    need(len(prompt_ids) + settings["max_tokens"] <= config["limits"]["context_tokens"], "learner_context_overflow")
    price = config["pricing"]
    total = ((Decimal(len(prompt_ids)) * dollars(price["input_usd_per_million"])
              + Decimal(settings["max_tokens"]) * dollars(price["output_usd_per_million"])) / 1000000
             + (dollars(price["setup_upper_bound_usd"]) if create_client else 0)) * price["safety_factor"]
    return nt.seal({"kind": "native-learner-reservation/v1", "request_id": request_id or uuid.uuid4().hex,
                    "request_hash": nt.native_hash(body), "config_hash": config["config_hash"],
                    "allocation_id": config["allocation"]["id"], "prompt_tokens": len(prompt_ids),
                    "sampling": settings, "phases": (["create_client"] if create_client else []) + ["sample"],
                    "cost": {"reserved_usd": str(total.quantize(Decimal("0.00000001"), rounding=ROUND_CEILING)),
                             "basis": "full_prompt_and_max_output_no_cache_discount", "pricing": price}}, "plan_hash")


class PinnedInstructionSampler:
    """Local verified renderer first; service creation only from funded connect()."""
    def __init__(self, config=None, *, download_tokenizer=False, secret_loader=None):
        self.config = None if config is None else learner_config(config)
        self.secret_loader = secret_loader or (lambda: os.environ.get("TINKER_API_KEY") or skate_secret("tinker"))
        for package, version in VERSIONS.items():
            need(importlib.metadata.version(package) == version, "learner_package_pin_changed")
        for name, digest in SOURCE_HASHES.items():
            package = "tinker-cookbook" if name.startswith("tinker_cookbook/") else "tinker"
            path = Path(importlib.metadata.distribution(package).locate_file(name))
            need(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "learner_sdk_source_changed")
        certificate_context()
        from huggingface_hub import hf_hub_download
        from transformers import PreTrainedTokenizerFast
        from tokenizers import AddedToken
        from tinker_cookbook.renderers.qwen3_5 import Qwen3_5DisableThinkingRenderer
        import tinker
        files = {}
        for name, digest in HF_HASHES.items():
            path = Path(hf_hub_download(MODEL, name, revision=HF_REVISION, token=False,
                                       local_files_only=not download_tokenizer))
            need(hashlib.sha256(path.read_bytes()).hexdigest() == digest, "learner_tokenizer_file_changed")
            files[name] = path
        options = json.loads(files["tokenizer_config.json"].read_text())
        options["added_tokens_decoder"] = {int(k): AddedToken(**v) for k, v in options["added_tokens_decoder"].items()}
        self.tokenizer = PreTrainedTokenizerFast(tokenizer_file=str(files["tokenizer.json"]), **options)
        need(hashlib.sha256(self.tokenizer.chat_template.encode()).hexdigest() == HF_HASHES["chat_template.jinja"],
             "learner_chat_template_changed")
        need(self.tokenizer.encode("<|im_end|>", add_special_tokens=False) == [IM_END], "learner_stop_token_changed")
        self.renderer = Qwen3_5DisableThinkingRenderer(self.tokenizer)
        self.sdk = tinker
        self.audit = {"versions": VERSIONS, "source_hashes": SOURCE_HASHES, "tokenizer_files": HF_HASHES,
                      "hf_revision": HF_REVISION, "retry_scope": RETRY_SCOPE,
                      "hosted_weights": "model_name_checked_no_provider_revision_attestation"}

    def prepare(self, messages):
        return self.renderer.build_generation_prompt(messages)

    def connect(self):
        need(self.config is not None, "funded_config_required")
        from tinker.lib.retry_handler import RetryConfig
        # SDK exception diagnostics can include request bodies. Our journal records
        # original input privately; neither provider errors nor credentials go to logs.
        for name in ("tinker", "httpx", "httpcore"):
            logging.getLogger(name).disabled = True
            logging.getLogger(name).setLevel(logging.CRITICAL + 1)
        args = {"project_id": self.config["project_id"]} if self.config["project_selection"] == "explicit" else {}
        if not args:
            need(not os.environ.get("TINKER_PROJECT_ID"), "account_default_conflicts_with_environment_project")
        key = self.secret_loader()
        need(type(key) is str and bool(key.strip()), "learner_credential_unavailable")
        service = self.sdk.ServiceClient(api_key=key, max_retries=0,
                    timeout=self.config["limits"]["timeout_seconds"], **args)
        client = service.create_sampling_client(base_model=MODEL, retry_config=RetryConfig(enable_retry_logic=False))
        need(client.get_base_model() == MODEL, "provider_instruction_model_mismatch")
        return client

    def sample(self, client, prompt, settings, timeout):
        params = self.sdk.SamplingParams(**settings, seed=None, stop=[IM_END])
        need(params.model_dump(mode="json") == {**settings, "seed": None, "stop": [IM_END]},
             "learner_sampling_serialization_changed")
        return client.sample(prompt, num_samples=1, sampling_params=params,
                             include_prompt_logprobs=False, topk_prompt_logprobs=0).result(timeout=timeout)

    def decode(self, tokens):
        # Only the known terminal delimiter is removed. JSON, whitespace, failed
        # tool syntax and accidental thinking remain exactly as generated text.
        return self.tokenizer.decode(tokens, skip_special_tokens=False, clean_up_tokenization_spaces=False)


class LearnerBridge:
    def __init__(self, config, token, state_dir, *, sampler_factory=PinnedInstructionSampler):
        self._config = nt.native_json(learner_config(config))
        need(type(token) is bytes and len(token) >= 32, "private_learner_bearer_required")
        self.token = token
        self.state = private_path(state_dir)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        need(not self.state.stat().st_mode & 0o077, "private_learner_state_required")
        self.raw_path = self.state / "learner-journal.jsonl"
        fd = os.open(self.raw_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)  # New state only; never overwrite or reuse an uncertain journal.
        self.factory, self.sampler, self.client = sampler_factory, None, None
        self.lock = threading.Lock()
        self.halted = threading.Event()
        self.previous_hash = None

    @property
    def config(self):
        return json.loads(self._config)

    def emit(self, record):
        value = nt.seal({"kind": "native-learner-journal/v1", "origin": "simulated_learner",
                        "training_eligible": False, "actor_training_eligible": False,
                        "previous_hash": self.previous_hash, "recorded_at": time.time(), **record}, "record_hash")
        raw = (nt.native_json(value) + "\n").encode()
        fd = os.open(self.raw_path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        with os.fdopen(fd, "ab") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        self.previous_hash = value["record_hash"]

    def complete(self, body):
        body = copy.deepcopy(body)
        cfg = self.config
        messages, settings = validate_request(body, cfg)
        with self.lock:
            need(not self.halted.is_set(), "learner_halted_after_unknown_failure")
            ledger = funded_ledger(cfg)  # Before constructing sampler or reading any credential.
            if self.sampler is None:
                self.sampler = self.factory(cfg)
            prompt = self.sampler.prepare(messages)
            ids = list(prompt.to_ints())
            plan = cost_plan(cfg, body, ids, create_client=self.client is None)
            ledger.reserve(plan)  # Before ServiceClient, create_sampling_client, or sample.
            common = {"request_id": plan["request_id"], "config_hash": cfg["config_hash"],
                      "model": cfg["model"], "tokenizer": cfg["tokenizer"], "renderer": cfg["renderer"],
                      "reservation": plan, "source_audit": self.sampler.audit}
            try:
                self.emit({**common, "phase": "prepared", "original_request": body,
                           "prompt_token_ids": ids, "sampling": {**settings, "seed": None, "stop": [IM_END]}})
                result_queue = queue.Queue(maxsize=1)
                def dispatch():
                    try:
                        if self.client is None:
                            ledger.before(plan, "create_client")
                            client = self.sampler.connect()
                        else:
                            client = self.client
                        if self.halted.is_set():
                            return  # Slow service creation must not launch a late sample.
                        ledger.before(plan, "sample")
                        result = self.sampler.sample(client, prompt, settings, cfg["limits"]["timeout_seconds"])
                        result_queue.put((client, result, None))
                    except Exception as error:
                        result_queue.put((None, None, type(error).__name__))
                threading.Thread(target=dispatch, daemon=True, name="funded-learner-request").start()
                try:
                    client, response, failure = result_queue.get(timeout=cfg["limits"]["timeout_seconds"])
                except queue.Empty:
                    raise TimeoutError("learner_deadline") from None
                need(failure is None, "learner_provider_request_failed")
                sequences = list(response.sequences)
                for index, sequence in enumerate(sequences):
                    tokens = list(sequence.tokens)
                    probs = None if sequence.logprobs is None else list(sequence.logprobs)
                    finite = probs is not None and all(type(x) in (int, float) and math.isfinite(x) for x in probs)
                    self.emit({**common, "phase": "sampled", "sequence_index": index,
                               "sequence_id": getattr(sequence, "sequence_id", None),
                               "completion_token_ids": tokens, "provider_logprobs": probs if finite else None,
                               "provider_logprobs_hex": None if probs is None else [float(x).hex() for x in probs],
                               "logprob_semantics": "provider_reported_not_actor_training_evidence",
                               "stop_reason": sequence.stop_reason})
                need(len(sequences) == 1, "one_learner_sequence_required")
                sequence = sequences[0]
                tokens = list(sequence.tokens)
                need(tokens and all(type(v) is int and 0 <= v < 2**31 for v in tokens)
                     and len(tokens) <= settings["max_tokens"], "learner_output_overflow_or_invalid_ids")
                content = self.sampler.decode(tokens[:-1] if tokens[-1] == IM_END else tokens)
                need(type(content) is str, "learner_decoded_text_required")
                result = {"id": "chatcmpl-" + plan["request_id"], "object": "chat.completion",
                          "created": int(time.time()), "model": MODEL,
                          "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                                       "finish_reason": "stop" if sequence.stop_reason == "stop" else "length"}],
                          "usage": {"prompt_tokens": len(ids), "completion_tokens": len(tokens),
                                    "total_tokens": len(ids) + len(tokens)}}
                self.emit({**common, "phase": "returned", "original_response": result,
                           "json_repaired": False, "constrained_decoding": False})
                ledger.mark(plan, status="complete")
                self.client = client
                return result
            except Exception as error:
                self.halted.set()
                ledger.mark(plan, status="failed_unknown")
                self.emit({**common, "phase": "failed_unknown", "error_kind": type(error).__name__,
                           "reservation_retained": True, "remote_cancellation_confirmed": False})
                raise ValueError("learner_failed_unknown_reservation_retained") from None

    def server(self, certificate, key, port=0):
        bridge = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_):
                pass
            def send_json(self, status, body):
                raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(raw)
                self.close_connection = True
            def authorized(self):
                headers = self.headers.get_all("Authorization", [])
                return len(headers) == 1 and hmac.compare_digest(headers[0].encode(), b"Bearer " + bridge.token)
            def do_GET(self):
                if not self.authorized():
                    return self.send_json(401, {"error": {"message": "Unauthorized"}})
                if self.path != "/v1/models":
                    return self.send_json(404, {"error": {"message": "Not found"}})
                self.send_json(200, {"object": "list", "data": [{"id": MODEL, "object": "model",
                                "owned_by": "native-instruction-learner"}]})
            def do_POST(self):
                if not self.authorized():
                    return self.send_json(401, {"error": {"message": "Unauthorized"}})
                if self.path != "/v1/chat/completions":
                    return self.send_json(404, {"error": {"message": "Not found"}})
                try:
                    sizes = self.headers.get_all("Content-Length", [])
                    need(not self.headers.get("Transfer-Encoding") and len(sizes) == 1
                         and re.fullmatch(r"[0-9]{1,7}", sizes[0]), "bounded_body_required")
                    size = int(sizes[0])
                    need(0 < size <= MAX_BODY, "bounded_body_required")
                    self.connection.settimeout(10)
                    raw = self.rfile.read(size)
                    need(len(raw) == size, "incomplete_request_body")
                    def unique(pairs):
                        obj = {}
                        for k, v in pairs:
                            need(k not in obj, "duplicate_json_key")
                            obj[k] = v
                        return obj
                    body = json.loads(raw, object_pairs_hook=unique,
                                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite_json")))
                    result = bridge.complete(body)
                except Exception:
                    # No exception text, provider body, headers, token or URL is reflected.
                    return self.send_json(503 if bridge.halted.is_set() else 400,
                                          {"error": {"message": "Learner halted; reservation retained" if bridge.halted.is_set()
                                                      else "Learner request or funding rejected"}})
                self.send_json(200, result)
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        return server


def learner_cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("draft")
    audit = sub.add_parser("audit")
    audit.add_argument("--download-tokenizer", action="store_true")
    for name in ("seal-config", "plan", "serve"):
        command = sub.add_parser(name)
        command.add_argument("--config", required=True)
        if name == "seal-config":
            command.add_argument("--output", required=True)
        if name == "plan":
            command.add_argument("--request", required=True)
        if name == "serve":
            command.add_argument("--state", required=True)
            command.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    if args.command == "draft":
        print(json.dumps(learner_config(), indent=2))
        return
    if args.command == "audit":
        print(json.dumps(PinnedInstructionSampler(download_tokenizer=args.download_tokenizer).audit, indent=2))
        return
    config = nt.load_json(args.config)
    if args.command == "seal-config":
        config = nt.seal(config, "config_hash")
        learner_config(config)
        write_private(private_path(args.output), config)
        print(json.dumps({"config_hash": config["config_hash"]}))
        return
    config = learner_config(config)
    if args.command == "plan":
        body = nt.load_json(args.request)
        messages, _ = validate_request(body, config)
        sampler = PinnedInstructionSampler(config)
        print(json.dumps(cost_plan(config, body, list(sampler.prepare(messages).to_ints())), indent=2))
        return
    funded_ledger(config)
    from benchmark_tinker_bridge import create_material
    token, token_file, cert, key = create_material(private_path(args.state))
    bridge = LearnerBridge(config, token, args.state)
    server = bridge.server(cert, key, args.port)
    manifest = {"endpoint": f"https://localhost:{server.server_port}/v1/chat/completions",
                "model": MODEL, "revision": "native-instruction-learner-config:" + config["config_hash"],
                "json_mode": "prompt_only", "temperature": 1,
                "max_tokens": config["limits"]["max_output_tokens"],
                "token_file": str(token_file), "cert_file": str(cert), "raw_journal": str(bridge.raw_path),
                "config_hash": config["config_hash"], "retry_scope": RETRY_SCOPE,
                "actor_training_eligible": False}
    write_private(Path(args.state) / "learner-server.json", manifest)
    print(json.dumps(manifest), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        learner_cli()
    except Exception:
        print(json.dumps({"error": "Learner configuration or operation failed; inspect private ledger/journal"}))
        raise SystemExit(1) from None
