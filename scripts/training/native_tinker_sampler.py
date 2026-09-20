# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["tinker==0.27.1", "tinker-cookbook==0.5.7", "transformers==5.3.0", "torch==2.10.0", "typer>=0.12"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Pinned, capped Qwen sampling through the existing local TLS/OpenAI handler.

No client is created by importing, drafting, inspecting, or auditing this module.
Only an operator-started bridge receiving a valid request can dispatch. See the
companion documentation for the source audit and externally funded ledger contract.
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, ROUND_CEILING
import hashlib
import hmac
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import ssl
import subprocess
import threading
import time
import uuid

import native_training as nt
from native_tinker_update import BudgetLedger, BUDGET_KIND, checkpoint, dollars, need, sealed
from native_capture import append_capture

MODEL = "Qwen/Qwen3.5-9B-Base"
HF_REVISION = "68c46c4b3498877f3ef123c856ecfde50c39f404"
RENDERER = "qwen3_5_disable_thinking"
VERSIONS = {"tinker": "0.27.1", "tinker-cookbook": "0.5.7", "transformers": "5.3.0"}
HF_HASHES = {
    "tokenizer.json": "fe000e3ed39ed12b8d2481d527d44f93c65d37e87645d2dcc80d1bf9d50d2927",
    "tokenizer_config.json": "3891e840d7dc5fca0af33d3a25083a735e36fe06214e3f707024820cb6b9f89c",
}
HF_TEMPLATE_HASH = "a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715"
# Audited from PyPI's SHA256-verified 0.27.1 / 0.5.7 wheels, not moving main.
SOURCE_HASHES = {
    "tinker/types/_pydantic_types/sampling_params.py": "ec8bef759540135ae37df47b78e76553d4b1213974f223e4c271734c1afeffb0",
    "tinker/types/sampled_sequence.py": "8f0909fb811e238317e0dbf937697186a5aa2a444a2044adb9c9cad545529c0e",
    "tinker/proto/response_conv.py": "7a39e1719df5c70350221ee23ace40d572d325b59d97f53cbf96098c823be681",
    "tinker/lib/public_interfaces/sampling_client.py": "86a5bb4a90cddb3528b10ea93d13bd1bf0ec7aaa7ea3072110beeeeafe1c975e",
    "tinker/lib/public_interfaces/service_client.py": "cd54efc12ce8982f26a49a9bab67e14db6606a5ca7681c6671ef77ab319e0efe",
    "tinker/lib/internal_client_holder.py": "b74b910177bdc9724707d7e8a8496fb805c07c86baaf0fb68a740c020013e785",
    "tinker_cookbook/renderers/qwen3_5.py": "aa786b03f97a016f65ed43f687e738fd52eedb0dc6240e9e2698f9e1a3253f81",
    "tinker_cookbook/renderers/qwen3.py": "ec26c77a2de649fc1994063f7c07ac2dcd3b6996fcb4ce707ecc1d6d5b68802a",
    "tinker_cookbook/renderers/base.py": "ee9beaaf1bfc467c2f340b33a3cd5dd76a1c4225412ff1382f9f618432a3a560",
    "tinker_cookbook/renderers/__init__.py": "eed8ac75b889e60dfa4b69bbd9ebb39c18cc1070542a65321104f0d6c798627d",
}
IM_END, TOOL_OPEN, TOOL_CLOSE = 248046, 248058, 248059
IDENTITY = {"temperature": 1.0, "top_p": 1.0, "top_k": -1}
RENDERER_HASH = nt.native_hash({k: v for k, v in SOURCE_HASHES.items() if k.startswith("tinker_cookbook/")})


def sampler_config(value=None):
    """Draft unknown account/funding fields, or validate a sealed operator config."""
    if value is None:
        return {
            "schema_version": 1, "kind": "native-tinker-sampler/v1",
            "project_selection": "account_default", "project_id": None, "public_model_id": MODEL,
            "model": {"id": MODEL, "hf_revision": HF_REVISION, "sampler_checkpoint": None},
            "tokenizer": {"id": MODEL, "revision": HF_REVISION, "chat_template_hash": HF_TEMPLATE_HASH},
            "renderer": {"name": RENDERER, "source_hash": RENDERER_HASH},
            "versions": dict(VERSIONS), "sampling": dict(IDENTITY),
            "limits": {"context_tokens": 32768, "max_output_tokens": 2048, "timeout_seconds": 240},
            "allocation": {"id": None, "ledger_path": None, "budget_project_id": None, "cap_usd": None},
            "pricing": {"input_usd_per_million": "0.66", "output_usd_per_million": "1.995",
                        "setup_upper_bound_usd": "0", "safety_factor": 5,
                        "source": "https://tinker-docs.thinkingmachines.ai/tinker/models/",
                        "verified_on": "2026-09-13"},
        }
    value = copy.deepcopy(value)
    sealed(value, "config_hash")
    draft = sampler_config()
    need(set(value) == set(draft) | {"config_hash"}, "sampler_config_fields")
    need(value["schema_version"] == 1 and value["kind"] == draft["kind"], "sampler_config_schema")
    need((value["project_selection"] == "account_default" and value["project_id"] is None)
         or (value["project_selection"] == "explicit" and type(value["project_id"]) is str
             and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", value["project_id"])), "explicit_project_selection_required")
    for field in ("public_model_id",):
        need(type(value[field]) is str and re.fullmatch(r"[A-Za-z0-9_.:/-]{1,180}", value[field]), "explicit_" + field)
    for field in ("tokenizer", "renderer", "versions", "sampling"):
        need(value[field] == draft[field], "unsupported_" + field + "_pin")
    model = value["model"]
    need(type(model) is dict and set(model) == set(draft["model"])
         and model["id"] == MODEL and model["hf_revision"] == HF_REVISION
         and checkpoint(model["sampler_checkpoint"], "sampler_weights"), "immutable_qwen_sampler_required")
    need(model["sampler_checkpoint"].split("/")[-1] not in {"latest", "current"}, "mutable_sampler_name")
    lim = value["limits"]
    need(type(lim) is dict and set(lim) == set(draft["limits"])
         and all(type(v) is int for v in lim.values())
         and 1 <= lim["max_output_tokens"] <= 16000
         and lim["max_output_tokens"] < lim["context_tokens"] <= 65536
         and 1 <= lim["timeout_seconds"] <= 300, "bounded_sampler_limits_required")
    alloc = value["allocation"]
    need(type(alloc) is dict and set(alloc) == set(draft["allocation"]), "allocation_fields")
    need(all(type(alloc[k]) is str and alloc[k].strip() for k in ("id", "ledger_path", "budget_project_id")),
         "explicit_parent_allocation_required")
    need(0 < dollars(alloc["cap_usd"]) <= 100, "allocation_cap_required")
    price = value["pricing"]
    need(type(price) is dict and set(price) == set(draft["pricing"]), "pricing_fields")
    need(dollars(price["input_usd_per_million"]) > 0 and dollars(price["output_usd_per_million"]) > 0
         and dollars(price["setup_upper_bound_usd"]) >= 0, "positive_conservative_rates_required")
    need(type(price["safety_factor"]) is int and 1 <= price["safety_factor"] <= 100
         and type(price["source"]) is str and bool(price["source"].strip())
         and type(price["verified_on"]) is str and re.fullmatch(r"\d{4}-\d{2}-\d{2}", price["verified_on"]),
         "pricing_provenance_required")
    return value


def parse_original_completion(tokens, tokenizer, renderer):
    """Classify homogeneous ORIGINAL tokens while parsing; never encode output.

    The actor's terminal im_end token and whitespace belong to its homogeneous
    action segment. Mixed segments, reasoning, unknown special tokens, incomplete
    blocks and parser normalization remain unavailable for the first training run.
    """
    need(type(tokens) is list and tokens and all(type(t) is int and 0 <= t < 2**31 for t in tokens),
         "invalid_sampled_tokens")
    if hasattr(tokenizer, "__len__"):
        # HF may rebuild the vocabulary on __len__; size it once per completion.
        vocabulary_size = len(tokenizer)
        need(all(t < vocabulary_size for t in tokens), "sampled_id_outside_pinned_tokenizer")
    message, termination = renderer.parse_response(list(tokens))
    clean = getattr(termination, "is_clean", False) is True
    content = message.get("content", "")
    if isinstance(content, str):
        text = content
        thinking = False
    else:
        text = "".join(part["text"] for part in content if part.get("type") == "text")
        thinking = any(part.get("type") != "text" for part in content)
    calls = [c.model_dump(mode="json", exclude_none=True) for c in message.get("tool_calls", [])]
    result = {"message": {"role": "assistant", "content": text or None},
              "parse_finished": clean, "token_roles": None, "role_unavailable_reason": None}
    if calls:
        for index, call in enumerate(calls):
            call["id"] = "call_" + uuid.uuid4().hex  # transport IDs; not sampled tokens
            call["type"] = "function"
        result["message"]["tool_calls"] = calls
    reason = None
    if not clean or tokens[-1] != IM_END or tokens.count(IM_END) != 1:
        reason = "incomplete_or_nonterminal_stop"
    elif message.get("unparsed_tool_calls"):
        reason = "unparsed_tool_call"
    elif thinking:
        reason = "reasoning_or_nontext_part"
    else:
        raw = tokenizer.decode(tokens[:-1], skip_special_tokens=False, clean_up_tokenization_spaces=False)
        # HF all_special_ids covers named roles, not every special AddedToken.
        # In this snapshot it lists 8 IDs, while the actual table contains 21.
        special_ids = set(tokenizer.all_special_ids)
        special_ids.update(index for index, spec in getattr(tokenizer, "added_tokens_decoder", {}).items()
                           if getattr(spec, "special", False))
        special = set(tokens[:-1]) & special_ids
        if special - {TOOL_OPEN, TOOL_CLOSE}:
            reason = "unknown_or_nondelivered_special_token"
        elif not calls and not special and raw == text and text.strip():
            result["token_roles"] = ["assistant_text"] * len(tokens)
        elif calls and not text.strip():
            blocks = re.findall(r"<tool_call>.*?</tool_call>", raw, re.DOTALL)
            leftover = re.sub(r"<tool_call>.*?</tool_call>", "", raw, flags=re.DOTALL)
            ambiguous = len(blocks) != len(calls) or bool(leftover.strip())
            for block in blocks:
                names = re.findall(r"<parameter=([^>\n]+)>", block)
                ambiguous |= len(names) != len(set(n.strip() for n in names))
                ambiguous |= block.count("<tool_call>") != 1 or block.count("<function=") != 1
            if not ambiguous:
                result["token_roles"] = ["assistant_tool_call"] * len(tokens)
            else:
                reason = "ambiguous_tool_serialization"
        else:
            reason = "mixed_or_normalized_completion"
    result["role_unavailable_reason"] = reason
    result["unparsed_tool_calls"] = bool(message.get("unparsed_tool_calls"))
    return result


class PinnedQwenSampler:
    """Local rendering is separate from funded service/client creation."""

    def __init__(self, config=None, *, download_tokenizer=False):
        # An account-free local audit does not need fictional checkpoint pins.
        self.config = None if config is None else sampler_config(config)
        self.audit = self.audit_installation()
        # These imports load libraries, not a Tinker service or sampler client.
        import tinker
        from huggingface_hub import hf_hub_download
        from tinker_cookbook.renderers.qwen3_5 import Qwen3_5DisableThinkingRenderer
        from tinker_cookbook.renderers.base import ToolCall
        files = {}
        for name, expected in HF_HASHES.items():
            path = Path(hf_hub_download(MODEL, name, revision=HF_REVISION,
                                       local_files_only=not download_tokenizer))
            need(hashlib.sha256(path.read_bytes()).hexdigest() == expected, "hf_tokenizer_file_changed")
            files[name] = path
        # Read only the two verified snapshot files. Do not load another mutable
        # config or custom Python implementation from the repository.
        from transformers import PreTrainedTokenizerFast
        from tokenizers import AddedToken
        tokenizer_config = json.loads(files["tokenizer_config.json"].read_text())
        tokenizer_config["added_tokens_decoder"] = {
            int(index): AddedToken(**spec) for index, spec in tokenizer_config["added_tokens_decoder"].items()
        }
        self.tokenizer = PreTrainedTokenizerFast(tokenizer_file=str(files["tokenizer.json"]),
            **tokenizer_config)
        need(hashlib.sha256(self.tokenizer.chat_template.encode()).hexdigest() == HF_TEMPLATE_HASH,
             "hf_template_changed")
        for name, expected in (("<|im_end|>", IM_END), ("<tool_call>", TOOL_OPEN), ("</tool_call>", TOOL_CLOSE)):
            need(self.tokenizer.encode(name, add_special_tokens=False) == [expected], "special_token_identity_changed")
        self.renderer = Qwen3_5DisableThinkingRenderer(self.tokenizer)
        self.call_parser, self.sdk = ToolCall.model_validate, tinker
        self.audit.update(tokenizer_files=dict(HF_HASHES), hf_chat_template_hash=HF_TEMPLATE_HASH)
        self.evidence_kind = "provider_capture"

    @staticmethod
    def audit_installation():
        for package, version in VERSIONS.items():
            need(importlib.metadata.version(package) == version, "installed_version_mismatch_" + package)
        for relative, expected in SOURCE_HASHES.items():
            distribution = "tinker-cookbook" if relative.startswith("tinker_cookbook/") else "tinker"
            path = importlib.metadata.distribution(distribution).locate_file(relative)
            need(hashlib.sha256(Path(path).read_bytes()).hexdigest() == expected, "installed_sdk_renderer_source_changed")
        return {"kind": "qwen-identity-sampling-source-audit/v1", "versions": dict(VERSIONS),
                "source_hashes": dict(SOURCE_HASHES), "identity_settings": dict(IDENTITY),
                "sdk_arrays": "provider_int32_tokens_and_float32_logprobs_copied_without_rescoring",
                "scope": "identity_transforms_only_not_backend_weight_attestation"}

    def prepare(self, messages, tools):
        from benchmark_tinker_bridge import native_conversation
        conversation = native_conversation(messages, tools, self.renderer, self.call_parser)
        prompt = self.renderer.build_generation_prompt(conversation)
        return prompt

    def connect(self):
        """Called only after the bridge's ledger reservation and phase gate."""
        need(self.config is not None, "funded_bridge_config_required")
        from tinker.lib.retry_handler import RetryConfig
        need(bool(os.environ.get("TINKER_API_KEY")), "TINKER_API_KEY_required")
        project_args = {"project_id": self.config["project_id"]} if self.config["project_selection"] == "explicit" else {}
        service = self.sdk.ServiceClient(api_key=os.environ["TINKER_API_KEY"], **project_args, max_retries=0,
            timeout=self.config["limits"]["timeout_seconds"])
        client = service.create_sampling_client(model_path=self.config["model"]["sampler_checkpoint"],
            retry_config=RetryConfig(enable_retry_logic=False))
        need(client.get_base_model() == MODEL, "provider_sampler_base_model_mismatch")
        return client

    def params(self, settings):
        return self.sdk.SamplingParams(**settings, stop=self.renderer.get_stop_sequences())

    def parse(self, tokens):
        return parse_original_completion(tokens, self.tokenizer, self.renderer)


class QwenCaptureBridge:
    """One alias, one immutable config, serialized paid boundaries and raw journal."""

    def __init__(self, config, token, state_dir, *, sampler_factory=PinnedQwenSampler):
        # Copy/seal protects against external config mutation. Do not expose a
        # mutable config reference to transport callbacks.
        self._config_json = nt.native_json(sampler_config(config))
        need(type(token) is bytes and len(token) >= 32, "private_bearer_required")
        self.token = token
        self.state = self.ignored_path(state_dir)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        need(not (self.state.stat().st_mode & 0o077), "state_directory_must_be_private")
        self.raw_path = self.state / "raw-captures.jsonl"
        self.factory, self.sampler, self.client = sampler_factory, None, None
        self.lock = threading.Lock()
        self.halted = False

    @property
    def config(self):
        return json.loads(self._config_json)

    @staticmethod
    def ignored_path(value):
        root = Path(__file__).resolve().parents[2]
        path = Path(value).absolute()
        resolved = path.resolve()
        need(resolved.is_relative_to(root / ".keating"), "output_must_be_in_ignored_keating")
        # Resolving outside via a symlink is rejected. Require git's actual ignore
        # rule as well, so an unignored tracked directory cannot host private data.
        check = subprocess.run(["git", "check-ignore", "--quiet", "--no-index", str(resolved)],
                               cwd=root, capture_output=True)
        need(check.returncode == 0, "output_must_be_gitignored")
        return resolved

    def authorized(self, header):
        return isinstance(header, str) and hmac.compare_digest(header.encode(), b"Bearer " + self.token)

    def validate_request(self, body):
        from serve_pilot import RequestError, validate_messages, validate_tools
        allowed = {"model", "messages", "tools", "max_tokens", "max_completion_tokens", "temperature", "top_p",
                   "top_k", "seed", "stream", "stream_options", "store", "tool_choice", "parallel_tool_calls"}
        def reject(condition, code):
            if not condition:
                raise RequestError(400, code)
        reject(type(body) is dict and not set(body) - allowed
               and body.get("model") == self.config["public_model_id"], "model_alias_or_fields")
        reject(not ("max_tokens" in body and "max_completion_tokens" in body), "one_completion_limit")
        limit = body.get("max_tokens", body.get("max_completion_tokens"))
        reject(type(limit) is int and 1 <= limit <= self.config["limits"]["max_output_tokens"], "explicit_bounded_max_tokens")
        for key, value in IDENTITY.items():
            reject(type(body.get(key, value)) in (int, float) and body.get(key, value) == value, "identity_sampling_only")
        reject(type(body.get("stream", False)) is bool and body.get("store", False) is False, "stream_or_store")
        options = body.get("stream_options", {})
        reject(type(options) is dict and not set(options) - {"include_usage"}
               and type(options.get("include_usage", False)) is bool, "stream_options")
        reject(body.get("parallel_tool_calls", True) is True, "no_constrained_tool_decoding")
        reject(body.get("tool_choice", "auto") in ("auto", "none"), "no_forced_tool_choice")
        settings = {**IDENTITY, "max_tokens": limit}
        if "seed" in body:
            reject(type(body["seed"]) is int and 0 <= body["seed"] < 2**31, "invalid_seed")
            settings["seed"] = body["seed"]
        tools = validate_tools(body.get("tools", []))
        return validate_messages(body.get("messages")), ([] if body.get("tool_choice") == "none" else tools), settings

    def funded_ledger(self):
        alloc = self.config["allocation"]
        path = self.ignored_path(alloc["ledger_path"])
        # Parent must initialize/fund this dedicated allocation. Unlike BudgetLedger
        # itself, the bridge never silently creates a new budget from its config.
        need(path.is_file(), "parent_funded_ledger_required")
        ledger = json.loads(path.read_text())
        sealed(ledger, "ledger_hash")
        need(ledger.get("kind") == BUDGET_KIND and ledger.get("project_id") == alloc["budget_project_id"]
             and ledger.get("model_id") == MODEL and ledger.get("cap_usd") == str(dollars(alloc["cap_usd"])),
             "funded_allocation_identity_mismatch")
        return BudgetLedger(path, alloc["budget_project_id"], MODEL, alloc["cap_usd"])

    def cost_plan(self, request_id, request_hash, prompt_count, settings):
        config = self.config
        need(type(prompt_count) is int and prompt_count > 0
             and prompt_count + settings["max_tokens"] <= config["limits"]["context_tokens"], "context_limit_before_dispatch")
        price = config["pricing"]
        setup = dollars(price["setup_upper_bound_usd"]) if self.client is None else Decimal(0)
        cost = setup + (Decimal(prompt_count) * dollars(price["input_usd_per_million"])
            + Decimal(settings["max_tokens"]) * dollars(price["output_usd_per_million"])) / Decimal(1000000)
        cost = (cost * price["safety_factor"]).quantize(Decimal("0.00000001"), rounding=ROUND_CEILING)
        return nt.seal({"kind": "native-sampler-reservation/v1", "response_id": request_id,
            "request_sha256": request_hash, "config_hash": config["config_hash"],
            "allocation_id": config["allocation"]["id"], "project_selection": config["project_selection"],
            "project_id": config["project_id"],
            "prompt_tokens": prompt_count, "max_output_tokens": settings["max_tokens"],
            "sampling_params": settings, "phases": (["create_client"] if self.client is None else []) + ["sample"],
            "cost": {"reserved_usd": str(cost), "basis": "full_prompt_plus_max_output_no_cache_discount",
                     "pricing": price}}, "plan_hash")

    def complete(self, body):
        from benchmark_tinker_bridge import digest
        from serve_pilot import RequestError
        body = copy.deepcopy(body)
        messages, tools, settings = self.validate_request(body)
        with self.lock:
            need(not self.halted, "sampler_halted_after_unknown_failure")
            ledger = self.funded_ledger()
            if self.sampler is None:
                self.sampler = self.factory(self.config)
            prompt = self.sampler.prepare(messages, tools)
            prompt_ids = list(prompt.to_ints())
            need(prompt_ids and all(type(v) is int and 0 <= v < 2**31 for v in prompt_ids), "native_prompt_tokens_required")
            params = self.sampler.params(settings)
            serialized = params.model_dump(mode="json")
            need(all(serialized.get(k) == v for k, v in settings.items())
                 and serialized.get("stop") == [IM_END]
                 and set(serialized) <= set(IDENTITY) | {"max_tokens", "seed", "stop"}, "serialized_sampling_changed")
            request_id = "chatcmpl-" + uuid.uuid4().hex
            plan = self.cost_plan(request_id, digest(body), len(prompt_ids), serialized)
            ledger.reserve(plan)  # MUST precede ServiceClient/create_sampling_client/sample.
            config = self.config
            common = {"response_id": request_id, "request_sha256": digest(body),
                "base_model": MODEL, "public_model_id": config["public_model_id"], "renderer": RENDERER,
                "actor": {"provider": "tinker", "id": body["model"], "revision": config["model"]["sampler_checkpoint"]},
                "recorder_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "capture_helper_sha256": hashlib.sha256(Path(__file__).with_name("native_capture.py").read_bytes()).hexdigest(),
                "config_hash": config["config_hash"], "sampler_checkpoint": config["model"]["sampler_checkpoint"],
                "project_selection": config["project_selection"], "project_id": config["project_id"], "reservation": plan,
                "pins": {"model": config["model"], "tokenizer": config["tokenizer"],
                         "renderer": config["renderer"], "versions": config["versions"]},
                "source_audit": self.sampler.audit, "training_eligible": False}
            def emit(record):
                append_capture(self.raw_path, {**common, **record})
            try:
                if self.client is None:
                    ledger.before(plan, "create_client")
                    self.client = self.sampler.connect()
                # The pinned local source audit and provider base-model check have
                # now executed. Attest before sampling, never by upgrading a log.
                generation = nt.seal({"schema_version": 1,
                    "kind": getattr(self.sampler, "evidence_kind", "authored_fixture"),
                    "response_id": request_id, "request_sha256": common["request_sha256"],
                    "recorded_before_sample": True, "actor": common["actor"],
                    "native_model": {"id": MODEL, "revision": config["model"]["sampler_checkpoint"]},
                    "tokenizer": config["tokenizer"],
                    "renderer": {"id": RENDERER, "revision": RENDERER_HASH,
                        "parser_revision": nt.native_hash({"recorder": common["recorder_sha256"], "renderer": RENDERER_HASH}),
                        "source_sha256": SOURCE_HASHES["tinker_cookbook/renderers/qwen3_5.py"]},
                    "prompt_token_ids_hash": nt.native_hash(prompt_ids),
                    "sampling_params_hash": nt.native_hash(serialized)}, "generation_hash")
                emit({"phase": "prepared", "original_request": body, "prompt_token_ids": prompt_ids,
                      "sampling_params": serialized, "num_samples": 1, "include_prompt_logprobs": False,
                      "topk_prompt_logprobs": 0, "generation_attestation": generation})
                ledger.before(plan, "sample")
                response = self.client.sample(prompt, num_samples=1, sampling_params=params,
                    include_prompt_logprobs=False, topk_prompt_logprobs=0).result(timeout=config["limits"]["timeout_seconds"])
                # Preserve every sequence before enforcing cardinality or invoking
                # any parser. Nonfinite provider floats get a lossless hex diagnostic
                # because append_capture deliberately forbids non-JSON numbers.
                for index, seq in enumerate(response.sequences):
                    ids = list(seq.tokens)
                    lps = None if seq.logprobs is None else list(seq.logprobs)
                    finite = lps is not None and all(type(v) in (int, float) and math.isfinite(v) for v in lps)
                    probability = {}
                    if finite and len(lps) == len(ids) and all(v <= 0 for v in lps):
                        probability["probability_attestation"] = nt.seal({
                            "schema_version": 1, "recorded_at_sampling": True, "semantics": "actual_sampler",
                            "generation_hash": generation["generation_hash"],
                            "completion_token_ids_hash": nt.native_hash(ids), "logprobs_hash": nt.native_hash(lps),
                            "sampling_params_hash": nt.native_hash(serialized), "all_generation_transforms_recorded": True,
                            "evidence": {"source": "https://pypi.org/project/tinker/0.27.1/; SOURCE_HASHES and source_audit in this record",
                                         "revision": nt.native_hash(self.sampler.audit),
                                         "sha256": nt.native_hash(self.sampler.audit)}}, "probability_hash")
                    emit({"phase": "sampled", "sequence_index": index, "sequence_count": len(response.sequences),
                          "sequence_id": getattr(seq, "sequence_id", None), "completion_token_ids": ids,
                          "provider_logprobs": lps if finite else None,
                          "provider_logprobs_hex": None if lps is None else [float(v).hex() for v in lps],
                          "stop_reason": seq.stop_reason,
                          "probability_semantics": "verified_actual_sampler" if probability else "provider_reported_not_yet_verified_as_actual_sampler",
                          "token_roles": None, **probability})
                need(len(response.sequences) == 1, "exactly_one_native_sequence_required")
                sequence = response.sequences[0]
                ids = list(sequence.tokens)
                lps = None if sequence.logprobs is None else list(sequence.logprobs)
                parsed = self.sampler.parse(ids)
                probabilities_ok = (lps is not None and len(lps) == len(ids)
                    and all(type(v) in (int, float) and math.isfinite(v) and v <= 0 for v in lps))
                reasons = [] if parsed["role_unavailable_reason"] is None else [parsed["role_unavailable_reason"]]
                if not probabilities_ok:
                    reasons.append("missing_invalid_or_unaligned_logprobs")
                if len(ids) > settings["max_tokens"] or sequence.stop_reason != "stop":
                    reasons.append("output_limit_or_stop_reason")
                eligible = not reasons and parsed["token_roles"] is not None
                roles = nt.seal({"schema_version": 1, "source": "original_completion_token_spans", "recorded_at_parse": True,
                    "generation_hash": generation["generation_hash"], "completion_token_ids_hash": nt.native_hash(ids),
                    "parsed_message_hash": nt.native_hash(parsed["message"]),
                    "parser_revision": generation["renderer"]["parser_revision"],
                    "roles": parsed["token_roles"] if parsed["token_roles"] is not None else [None] * len(ids)}, "roles_hash")
                emit({"phase": "parsed", **parsed, "original_token_capture_eligible": eligible,
                      "unavailable_reasons": reasons, "all_generation_transforms_recorded": True,
                      "token_role_attestation": roles,
                      "role_assignment": "homogeneous_original_sequence_including_actor_terminator/v1"})
                need(parsed["parse_finished"] and not parsed["unparsed_tool_calls"], "incomplete_or_malformed_qwen_completion")
                ledger.mark(plan, status="complete")
                message = parsed["message"]
                return {"id": request_id, "object": "chat.completion", "created": int(time.time()),
                    "model": config["public_model_id"], "choices": [{"index": 0, "message": message,
                    "finish_reason": "tool_calls" if message.get("tool_calls") else "stop"}],
                    "usage": {"prompt_tokens": len(prompt_ids), "completion_tokens": len(ids),
                              "total_tokens": len(prompt_ids) + len(ids)}}
            except Exception as error:
                # A timeout can leave an SDK request running. Hold its full reserve
                # and stop accepting more work until the parent reconciles it.
                self.halted = True
                ledger.mark(plan, status="failed_unknown")
                emit({"phase": "failed", "error_kind": type(error).__name__,
                      "original_token_capture_eligible": False})
                raise RequestError(503, "Native sampler failed; reservation retained") from None

    def server(self, cert, key, port=0):
        from serve_pilot import make_server, RequestError
        server = make_server(self, host="127.0.0.1", port=port)
        base = server.RequestHandlerClass
        bridge = self
        class Handler(base):
            def do_GET(self):
                try:
                    self.check_auth()
                    if self.path != "/v1/models":
                        raise RequestError(404, "Not found")
                    cfg = bridge.config
                    self.json_response(200, {"object": "list", "data": [{"id": cfg["public_model_id"],
                        "object": "model", "owned_by": "local-native-tinker-bridge",
                        "context_window": cfg["limits"]["context_tokens"],
                        "max_tokens": cfg["limits"]["max_output_tokens"],
                        "reasoning": False, "input": ["text"]}]})
                except RequestError as error:
                    self.json_response(error.status, {"error": {"message": error.message}})
        server.RequestHandlerClass = Handler
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=cert, keyfile=key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        return server


def sampler_cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    draft = sub.add_parser("draft", help="Unfunded template; no invented account or checkpoint")
    draft.add_argument("--output", required=True)
    for name in ("seal-config", "inspect", "audit", "serve"):
        command = sub.add_parser(name)
        command.add_argument("--config", required=name != "audit")
        if name in ("seal-config", "audit"):
            command.add_argument("--output", required=True)
        if name == "audit":
            command.add_argument("--download-tokenizer", action="store_true", help="Public pinned HF files only; no Tinker calls")
        if name == "serve":
            command.add_argument("--state", required=True)
            command.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    from native_tinker_update import write_private
    if args.command == "draft":
        output = sampler_config()
    elif args.command == "audit":
        config = None if args.config is None else json.loads(Path(args.config).read_text())
        output = PinnedQwenSampler(config, download_tokenizer=args.download_tokenizer).audit
    else:
        raw = json.loads(Path(args.config).read_text())
        config = sampler_config(nt.seal(raw, "config_hash") if args.command == "seal-config" else raw)
        output = config
        if args.command == "inspect":
            print(json.dumps({"config_hash": config["config_hash"], "project_selection": config["project_selection"],
                "project_id": config["project_id"],
                "sampler_checkpoint": config["model"]["sampler_checkpoint"], "public_model_id": config["public_model_id"],
                "dispatch_performed": False, "bootstrap_implemented": False}))
            return
        if args.command == "serve":
            from benchmark_tinker_bridge import create_material
            state = QwenCaptureBridge.ignored_path(args.state)
            need(not state.exists(), "new_private_state_directory_required")
            # Funding is checked on every request before client construction.
            token, token_path, cert, key = create_material(state)
            bridge = QwenCaptureBridge(config, token, state)
            bridge.funded_ledger()
            server = bridge.server(cert, key, args.port)
            print(json.dumps({"base_url": f"https://localhost:{server.server_port}/v1", "model": config["public_model_id"],
                "token_file": str(token_path), "cert_file": str(cert), "raw_captures": str(bridge.raw_path)}), flush=True)
            try:
                server.serve_forever()
            finally:
                server.server_close()
            return
    destination = QwenCaptureBridge.ignored_path(args.output)
    need(not destination.exists(), "output_exists")
    write_private(destination, output)
    print(str(destination))


if __name__ == "__main__":
    sampler_cli()
